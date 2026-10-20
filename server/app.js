import express from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkText } from "./filter.js";
import { isJpeg, stripJpegMetadata, inspectVideo, MediaError } from "./media.js";
import {
  COOKIE, hashPassword, verifyPassword, createSession, destroySession, userFromToken,
  readCookie, sessionCookie, tooManyAttempts, recordFailure, clearFailures,
} from "./auth.js";

// Innleggstyper: alle innlegg må ha en positiv ramme.
export const KINDS = {
  glad: "Noe jeg er glad for",
  laerte: "Noe jeg lærte",
  takk: "En takk til noen",
  laget: "Noe jeg laget",
};
export const COLORS = ["gul", "gronn", "bla", "rosa", "oransje", "lilla"];
export const STICKERS = ["", "⚽", "🎨", "🎮", "📚", "🍕", "🌞", "🎵", "🏰", "🚲", "🐶", "🌈"];
export const AVATARS = ["🐶", "🐱", "🦊", "🐼", "🐸", "🦄", "🐵", "🐯", "🐰", "🐧", "🐢", "🦖"];

// Grenser for opplasting. Kan endres med miljøvariabler.
export const DEFAULT_MEDIA_LIMITS = {
  videoSeconds: Number(process.env.MAX_VIDEO_SECONDS) || 30,
  videoMb: Number(process.env.MAX_VIDEO_MB) || 50,
  imageMb: Number(process.env.MAX_IMAGE_MB) || 8,
};
const MAX_PENDING_UPLOADS = 3; // opplastinger som ikke er delt ennå
const MEDIA_ID = /^[0-9a-f]{32}$/;

const FEED_DAYS = 3; // Bare ferske innlegg: feeden tar slutt.
const FEED_MAX = 30;
const TZ = process.env.TZ_APP || "Europe/Oslo";

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const USERNAME = /^[a-z0-9._-]{3,24}$/i;

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, message, code) => { throw new HttpError(status, message, code); };

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// registrationCode: hvis satt, må foresatte oppgi denne koden for å lage konto.
export function createApp({
  db, mediaDir, mediaLimits = DEFAULT_MEDIA_LIMITS, now = Date.now, secureCookies = false, registrationCode = "",
}) {
  const app = express();
  app.disable("x-powered-by");
  mkdirSync(mediaDir, { recursive: true });

  const clock = () => {
    const s = new Date(now()).toLocaleString("sv-SE", { timeZone: TZ });
    return { day: s.slice(0, 10), hm: s.slice(11, 16) };
  };

  const q = (sql) => db.prepare(sql);

  // ---------- Sikkerhet ----------
  app.use((req, res, next) => {
    res.set({
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    });
    next();
  });
  app.use(express.json({ limit: "10kb" }));
  // CSRF-vern: i tillegg til SameSite=Strict-cookie krever vi JSON på alle endringer.
  // Opplasting sender rå fildata og krever i stedet en egen header, som andre nettsider ikke kan sette.
  app.use("/api", (req, res, next) => {
    if (req.method === "POST" && req.path === "/media") {
      if (req.get("X-Upload") !== "1") return res.status(415).json({ error: "Mangler X-Upload" });
      return next();
    }
    if (req.method !== "GET" && !req.is("application/json")) {
      return res.status(415).json({ error: "Forventet JSON" });
    }
    req.body ??= {};
    next();
  });

  app.use("/api", (req, res, next) => {
    req.user = userFromToken(db, readCookie(req, COOKIE));
    next();
  });

  const needUser = (role) => (req, res, next) => {
    if (!req.user) fail(401, "Du må logge inn");
    if (role && req.user.role !== role) fail(403, "Ikke tilgang");
    next();
  };

  // Barn: åpningstider og daglig tidsgrense håndheves på serveren.
  function childStatus(user) {
    const { day, hm } = clock();
    const used = q("SELECT minutes FROM usage WHERE user_id = ? AND day = ?").get(user.id, day)?.minutes || 0;
    const postedToday = q("SELECT COUNT(*) AS n FROM posts WHERE author_id = ? AND day = ?").get(user.id, day).n;
    const open = hm >= user.open_from && hm < user.open_to;
    return {
      open,
      openFrom: user.open_from,
      openTo: user.open_to,
      minutesLeft: Math.max(0, user.daily_minutes - used),
      postsLeft: Math.max(0, user.posts_per_day - postedToday),
    };
  }

  const childGate = (req, res, next) => {
    const status = childStatus(req.user);
    if (!status.open) fail(403, `Kanalen er stengt nå. Den åpner kl. ${status.openFrom} 🌙`, "CLOSED");
    if (status.minutesLeft <= 0) fail(403, "Tiden for i dag er brukt opp. Vi ses i morgen! 🌳", "TIME_UP");
    req.limits = status;
    next();
  };
  const child = [needUser("child"), childGate];
  const parent = needUser("parent");

  const publicUser = (u) => ({
    id: u.id, username: u.username, role: u.role, displayName: u.display_name, avatar: u.avatar,
  });

  const childSettings = (u) => ({
    ...publicUser(u),
    dailyMinutes: u.daily_minutes, openFrom: u.open_from, openTo: u.open_to, postsPerDay: u.posts_per_day,
  });

  // ---------- Konto ----------
  function validateCredentials(username, password) {
    if (!USERNAME.test(username || "")) fail(400, "Brukernavn: 3–24 tegn, bare bokstaver a–z, tall, punktum, bindestrek og understrek");
    if (typeof password !== "string" || password.length < 8) fail(400, "Passordet må ha minst 8 tegn");
    if (q("SELECT 1 FROM users WHERE username = ?").get(username)) fail(409, "Brukernavnet er tatt");
  }

  function validateDisplayName(name) {
    name = typeof name === "string" ? name.trim() : "";
    if (name.length < 2 || name.length > 20) fail(400, "Visningsnavnet må ha 2–20 tegn");
    const problem = checkText(name);
    if (problem) fail(400, problem);
    return name;
  }

  // Brukes av Render (og andre) for å sjekke at appen kjører.
  app.get("/healthz", (req, res) => {
    q("SELECT 1").get();
    res.json({ ok: true });
  });

  app.get("/api/signup-info", (req, res) => res.json({ codeRequired: !!registrationCode }));

  app.post("/api/register", (req, res) => {
    const { username, password } = req.body;
    if (registrationCode && !safeEqual(String(req.body.code || "").trim(), registrationCode)) {
      fail(403, "Feil registreringskode. Spør den som inviterte deg.");
    }
    validateCredentials(username, password);
    const displayName = validateDisplayName(req.body.displayName);
    const { lastInsertRowid } = q(`INSERT INTO users (username, password_hash, role, display_name, avatar, created_at)
      VALUES (?, ?, 'parent', ?, '🧑', ?)`).run(username, hashPassword(password), displayName, now());
    const token = createSession(db, lastInsertRowid);
    res.set("Set-Cookie", sessionCookie(token, secureCookies)).status(201).json({ ok: true });
  });

  app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    const key = `${String(username).toLowerCase()}|${req.ip}`;
    if (tooManyAttempts(key)) fail(429, "For mange forsøk. Vent litt og prøv igjen.");
    const user = q("SELECT * FROM users WHERE username = ?").get(String(username || ""));
    if (!user || typeof password !== "string" || !verifyPassword(password, user.password_hash)) {
      recordFailure(key);
      fail(401, "Feil brukernavn eller passord");
    }
    clearFailures(key);
    const token = createSession(db, user.id);
    res.set("Set-Cookie", sessionCookie(token, secureCookies)).json({ ok: true });
  });

  app.post("/api/logout", (req, res) => {
    const token = readCookie(req, COOKIE);
    if (token) destroySession(db, token);
    res.set("Set-Cookie", sessionCookie(null, secureCookies)).json({ ok: true });
  });

  app.get("/api/me", needUser(), (req, res) => {
    const me = publicUser(req.user);
    if (req.user.role === "child") {
      me.status = childStatus(req.user);
      me.groups = q(`SELECT g.id, g.name FROM groups g JOIN memberships m ON m.group_id = g.id
        WHERE m.user_id = ? ORDER BY g.name`).all(req.user.id);
    }
    res.json({ me, kinds: KINDS, colors: COLORS, stickers: STICKERS, avatars: AVATARS, media: mediaLimits });
  });

  // Foresatte kan slette sin egen konto. Barnekontoene og alt innholdet slettes også.
  app.delete("/api/me", parent, (req, res) => {
    q("DELETE FROM users WHERE id = ?").run(req.user.id);
    sweepMedia();
    res.set("Set-Cookie", sessionCookie(null, secureCookies)).json({ ok: true });
  });

  // ---------- Barn: feed og innlegg ----------
  app.post("/api/heartbeat", child, (req, res) => {
    const { day } = clock();
    const row = q("SELECT last_beat FROM usage WHERE user_id = ? AND day = ?").get(req.user.id, day);
    // Tell maks ett minutt per ~minutt, uansett hvor ofte klienten pinger.
    if (!row) q("INSERT INTO usage (user_id, day, minutes, last_beat) VALUES (?, ?, 1, ?)").run(req.user.id, day, now());
    else if (now() - row.last_beat >= 55e3) {
      q("UPDATE usage SET minutes = minutes + 1, last_beat = ? WHERE user_id = ? AND day = ?").run(now(), req.user.id, day);
    }
    res.json({ status: childStatus(req.user) });
  });

  const POST_FIELDS = `p.id, p.kind, p.text, p.sticker, p.color, p.created_at AS createdAt, p.status,
    u.display_name AS author, u.avatar, g.id AS groupId, g.name AS groupName,
    md.id AS mediaId, md.type AS mediaType, md.approved AS mediaApproved`;
  const POST_JOINS = `FROM posts p JOIN users u ON u.id = p.author_id JOIN groups g ON g.id = p.group_id
    LEFT JOIN media md ON md.post_id = p.id`;

  const withMedia = ({ mediaId, mediaType, mediaApproved, ...p }) =>
    ({ ...p, media: mediaId ? { id: mediaId, type: mediaType, pending: !mediaApproved } : null });

  // Innlegg med bilde/video som venter på godkjenning, ser bare forfatteren selv.
  app.get("/api/feed", child, (req, res) => {
    const posts = q(`SELECT ${POST_FIELDS}, (p.author_id = ?) AS mine ${POST_JOINS}
      WHERE p.status = 'visible' AND p.created_at >= ?
        AND p.group_id IN (SELECT group_id FROM memberships WHERE user_id = ?)
        AND (md.id IS NULL OR md.approved = 1 OR p.author_id = ?)
      ORDER BY p.created_at DESC LIMIT ?`).all(req.user.id, now() - FEED_DAYS * 864e5, req.user.id, req.user.id, FEED_MAX);
    res.json({ posts: posts.map(({ status, ...p }) => withMedia({ ...p, mine: !!p.mine })), status: req.limits });
  });

  // ---------- Bilder og video ----------
  const maxUploadBytes = Math.max(mediaLimits.videoMb, mediaLimits.imageMb) * 1024 * 1024;

  app.post("/api/media", child, express.raw({ type: () => true, limit: maxUploadBytes }), (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) fail(400, "Fila er tom");
    const pending = q("SELECT COUNT(*) AS n FROM media WHERE owner_id = ? AND post_id IS NULL").get(req.user.id).n;
    if (pending >= MAX_PENDING_UPLOADS) {
      q("DELETE FROM media WHERE owner_id = ? AND post_id IS NULL").run(req.user.id);
      sweepMedia();
    }

    let media;
    try {
      if (isJpeg(buf)) {
        if (buf.length > mediaLimits.imageMb * 1024 * 1024) fail(413, `Bildet er for stort. Maks ${mediaLimits.imageMb} MB.`);
        media = { type: "image", mime: "image/jpeg", data: stripJpegMetadata(buf), duration: null };
      } else if (buf.length > 12 && buf.toString("latin1", 4, 8) === "ftyp") {
        if (buf.length > mediaLimits.videoMb * 1024 * 1024) fail(413, `Videoen er for stor. Maks ${mediaLimits.videoMb} MB.`, "TOO_BIG");
        const { duration } = inspectVideo(buf);
        if (duration > mediaLimits.videoSeconds + 0.5) {
          fail(400, `Videoen er ${Math.round(duration)} sekunder. Maks er ${mediaLimits.videoSeconds} sekunder. Du kan klippe den i Bilder-appen ✂️`, "TOO_LONG");
        }
        media = { type: "video", mime: "video/mp4", data: buf, duration };
      } else {
        fail(400, "Bare bilder og video (MP4/MOV) kan lastes opp");
      }
    } catch (err) {
      if (err instanceof MediaError) fail(400, err.message);
      throw err;
    }

    const id = randomBytes(16).toString("hex");
    writeFileSync(join(mediaDir, id), media.data);
    q(`INSERT INTO media (id, owner_id, type, mime, size, duration, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, req.user.id, media.type, media.mime, media.data.length, media.duration, now());
    res.status(201).json({ id, type: media.type });
  });

  app.get("/api/media/:id", needUser(), (req, res) => {
    if (!MEDIA_ID.test(req.params.id)) fail(404, "Finnes ikke");
    const m = q(`SELECT md.*, p.group_id AS groupId, p.status FROM media md LEFT JOIN posts p ON p.id = md.post_id
      WHERE md.id = ?`).get(req.params.id);
    if (!m) fail(404, "Finnes ikke");
    const me = req.user;
    if (me.role === "child") childGate(req, res, () => {});
    const allowed = m.owner_id === me.id || (m.groupId && m.status !== "removed" && (
      me.role === "child"
        ? m.approved && m.status === "visible" && q("SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ?").get(m.groupId, me.id)
        : visibleGroup(me.id, m.groupId)));
    if (!allowed) fail(404, "Finnes ikke");
    res.type(m.mime).set({ "Cache-Control": "private, max-age=86400", "Content-Disposition": "inline" });
    // sendFile støtter Range-forespørsler, som Safari på iPhone krever for å spille av video.
    res.sendFile(join(mediaDir, m.id), { dotfiles: "deny" });
  });

  // Rydder bort filer som ikke hører til noe lenger, og opplastinger som aldri ble delt.
  function sweepMedia() {
    q("DELETE FROM media WHERE post_id IS NULL AND created_at < ?").run(now() - 3600e3);
    const keep = new Set(q("SELECT id FROM media").all().map((r) => r.id));
    for (const file of readdirSync(mediaDir)) {
      if (!keep.has(file)) {
        try { unlinkSync(join(mediaDir, file)); } catch { /* allerede borte */ }
      }
    }
  }
  app.locals.sweepMedia = sweepMedia;

  app.post("/api/posts", child, (req, res) => {
    const { groupId, kind, sticker = "", color, mediaId } = req.body;
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (req.limits.postsLeft <= 0) fail(429, "Du har delt nok for i dag. Spar resten til i morgen! ✨", "POST_LIMIT");
    if (!q("SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ?").get(groupId, req.user.id)) fail(403, "Du er ikke med i den gruppa");
    if (!KINDS[kind]) fail(400, "Velg hva slags innlegg det er");
    if (!COLORS.includes(color)) fail(400, "Ugyldig farge");
    if (!STICKERS.includes(sticker)) fail(400, "Ugyldig klistremerke");
    if (text.length < 2 || text.length > 200) fail(400, "Innlegget må ha 2–200 tegn");
    const problem = checkText(text);
    if (problem) fail(400, problem, "FILTER");
    if (mediaId !== undefined && mediaId !== null &&
        !q("SELECT 1 FROM media WHERE id = ? AND owner_id = ? AND post_id IS NULL").get(String(mediaId), req.user.id)) {
      fail(400, "Fant ikke bildet eller videoen. Prøv å legge det til på nytt.");
    }
    const { lastInsertRowid } = q(`INSERT INTO posts (group_id, author_id, kind, text, sticker, color, day, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(groupId, req.user.id, kind, text, sticker, color, clock().day, now());
    let pending = false;
    if (mediaId) {
      pending = !!q("SELECT media_review FROM groups WHERE id = ?").get(groupId).media_review;
      q("UPDATE media SET post_id = ?, approved = ? WHERE id = ?").run(lastInsertRowid, pending ? 0 : 1, mediaId);
    }
    res.status(201).json({ ok: true, pending });
  });

  // Barn kan slette sine egne innlegg.
  app.delete("/api/posts/:id", needUser(), (req, res) => {
    const post = q("SELECT * FROM posts WHERE id = ?").get(req.params.id);
    if (!post) fail(404, "Fant ikke innlegget");
    const author = q("SELECT parent_id FROM users WHERE id = ?").get(post.author_id);
    const allowed = post.author_id === req.user.id || author.parent_id === req.user.id;
    if (!allowed) fail(403, "Ikke tilgang");
    q("DELETE FROM posts WHERE id = ?").run(post.id);
    sweepMedia();
    res.json({ ok: true });
  });

  // Si fra: innlegget skjules med en gang og venter på at gruppas voksne ser på det.
  app.post("/api/posts/:id/report", needUser("child"), (req, res) => {
    const post = q(`SELECT p.* FROM posts p JOIN memberships m ON m.group_id = p.group_id AND m.user_id = ?
      WHERE p.id = ?`).get(req.user.id, req.params.id);
    if (!post) fail(404, "Fant ikke innlegget");
    if (!q("SELECT 1 FROM reports WHERE post_id = ? AND reporter_id = ?").get(post.id, req.user.id)) {
      q("INSERT INTO reports (post_id, reporter_id, created_at) VALUES (?, ?, ?)").run(post.id, req.user.id, now());
    }
    if (post.status === "visible") q("UPDATE posts SET status = 'hidden' WHERE id = ?").run(post.id);
    res.json({ ok: true });
  });

  // ---------- Foresatte: barn ----------
  const ownChild = (req) => {
    const c = q("SELECT * FROM users WHERE id = ? AND parent_id = ?").get(req.params.id ?? req.body.childId, req.user.id);
    if (!c) fail(404, "Fant ikke barnet");
    return c;
  };

  app.get("/api/children", parent, (req, res) => {
    const children = q("SELECT * FROM users WHERE parent_id = ? ORDER BY display_name").all(req.user.id);
    res.json({
      children: children.map((c) => ({
        ...childSettings(c),
        status: childStatus(c),
        groups: q(`SELECT g.id, g.name FROM groups g JOIN memberships m ON m.group_id = g.id WHERE m.user_id = ?`).all(c.id),
      })),
    });
  });

  app.post("/api/children", parent, (req, res) => {
    const { username, password, avatar } = req.body;
    validateCredentials(username, password);
    const displayName = validateDisplayName(req.body.displayName);
    if (!AVATARS.includes(avatar)) fail(400, "Velg et dyr");
    q(`INSERT INTO users (username, password_hash, role, display_name, avatar, parent_id, created_at)
      VALUES (?, ?, 'child', ?, ?, ?, ?)`).run(username, hashPassword(password), displayName, avatar, req.user.id, now());
    res.status(201).json({ ok: true });
  });

  app.patch("/api/children/:id", parent, (req, res) => {
    const c = ownChild(req);
    const b = req.body;
    const next = {
      daily_minutes: b.dailyMinutes ?? c.daily_minutes,
      open_from: b.openFrom ?? c.open_from,
      open_to: b.openTo ?? c.open_to,
      posts_per_day: b.postsPerDay ?? c.posts_per_day,
      avatar: b.avatar ?? c.avatar,
      display_name: b.displayName !== undefined ? validateDisplayName(b.displayName) : c.display_name,
    };
    if (!Number.isInteger(next.daily_minutes) || next.daily_minutes < 0 || next.daily_minutes > 120) fail(400, "Tidsgrense må være 0–120 minutter");
    if (!Number.isInteger(next.posts_per_day) || next.posts_per_day < 0 || next.posts_per_day > 10) fail(400, "Innlegg per dag må være 0–10");
    if (!HM.test(next.open_from) || !HM.test(next.open_to) || next.open_from >= next.open_to) fail(400, "Ugyldige åpningstider");
    if (!AVATARS.includes(next.avatar)) fail(400, "Ugyldig dyr");
    q(`UPDATE users SET daily_minutes = ?, open_from = ?, open_to = ?, posts_per_day = ?, avatar = ?, display_name = ? WHERE id = ?`)
      .run(next.daily_minutes, next.open_from, next.open_to, next.posts_per_day, next.avatar, next.display_name, c.id);
    if (b.password !== undefined) {
      if (typeof b.password !== "string" || b.password.length < 8) fail(400, "Passordet må ha minst 8 tegn");
      q("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(b.password), c.id);
      q("DELETE FROM sessions WHERE user_id = ?").run(c.id);
    }
    res.json({ ok: true });
  });

  app.delete("/api/children/:id", parent, (req, res) => {
    q("DELETE FROM users WHERE id = ?").run(ownChild(req).id);
    sweepMedia();
    res.json({ ok: true });
  });

  // ---------- Foresatte: grupper ----------
  // En foresatt kan se en gruppe hvis hen eier den, eller har et barn som er med.
  const visibleGroup = (userId, groupId) => q(`SELECT g.*, (g.owner_id = ?) AS isOwner FROM groups g
    WHERE g.id = ? AND (g.owner_id = ? OR EXISTS (
      SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.group_id = g.id AND u.parent_id = ?))`)
    .get(userId, groupId, userId, userId);

  app.get("/api/groups", parent, (req, res) => {
    const groups = q(`SELECT DISTINCT g.* FROM groups g LEFT JOIN memberships m ON m.group_id = g.id
      LEFT JOIN users u ON u.id = m.user_id
      WHERE g.owner_id = ? OR u.parent_id = ? ORDER BY g.name`).all(req.user.id, req.user.id);
    res.json({
      groups: groups.map((g) => {
        const isOwner = g.owner_id === req.user.id;
        return {
          id: g.id,
          name: g.name,
          isOwner,
          inviteCode: isOwner ? g.invite_code : undefined,
          mediaReview: !!g.media_review,
          pendingMedia: isOwner ? q(`SELECT COUNT(*) AS n FROM media md JOIN posts p ON p.id = md.post_id
            WHERE p.group_id = ? AND md.approved = 0 AND p.status = 'visible'`).get(g.id).n : undefined,
          members: q(`SELECT u.display_name AS displayName, u.avatar FROM memberships m JOIN users u ON u.id = m.user_id
            WHERE m.group_id = ? ORDER BY u.display_name`).all(g.id),
          openReports: isOwner ? q(`SELECT COUNT(DISTINCT r.post_id) AS n FROM reports r JOIN posts p ON p.id = r.post_id
            WHERE p.group_id = ? AND r.resolved = 0`).get(g.id).n : undefined,
        };
      }),
    });
  });

  app.post("/api/groups", parent, (req, res) => {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (name.length < 2 || name.length > 40) fail(400, "Gruppenavnet må ha 2–40 tegn");
    const code = randomBytes(5).toString("hex").toUpperCase();
    q("INSERT INTO groups (name, invite_code, owner_id, created_at) VALUES (?, ?, ?, ?)").run(name, code, req.user.id, now());
    res.status(201).json({ inviteCode: code });
  });

  app.post("/api/groups/join", parent, (req, res) => {
    const c = ownChild(req);
    const g = q("SELECT id FROM groups WHERE invite_code = ?").get(String(req.body.code || "").trim().toUpperCase());
    if (!g) fail(404, "Fant ingen gruppe med den koden");
    q("INSERT OR IGNORE INTO memberships (group_id, user_id) VALUES (?, ?)").run(g.id, c.id);
    res.json({ ok: true });
  });

  app.post("/api/groups/:groupId/leave", parent, (req, res) => {
    const c = ownChild(req);
    q("DELETE FROM memberships WHERE group_id = ? AND user_id = ?").run(req.params.groupId, c.id);
    res.json({ ok: true });
  });

  app.delete("/api/groups/:groupId", parent, (req, res) => {
    const { changes } = q("DELETE FROM groups WHERE id = ? AND owner_id = ?").run(req.params.groupId, req.user.id);
    if (!changes) fail(404, "Fant ikke gruppa");
    sweepMedia();
    res.json({ ok: true });
  });

  app.patch("/api/groups/:groupId", parent, (req, res) => {
    if (typeof req.body.mediaReview !== "boolean") fail(400, "Ugyldig innstilling");
    const { changes } = q("UPDATE groups SET media_review = ? WHERE id = ? AND owner_id = ?")
      .run(req.body.mediaReview ? 1 : 0, req.params.groupId, req.user.id);
    if (!changes) fail(404, "Fant ikke gruppa");
    res.json({ ok: true });
  });

  // Foresatte kan lese alt i gruppene barna er med i. Eieren ser også rapporterte innlegg.
  app.get("/api/groups/:groupId/posts", parent, (req, res) => {
    const g = visibleGroup(req.user.id, req.params.groupId);
    if (!g) fail(404, "Fant ikke gruppa");
    const posts = q(`SELECT ${POST_FIELDS},
        (SELECT COUNT(*) FROM reports r WHERE r.post_id = p.id AND r.resolved = 0) AS reports,
        (u.parent_id = ?) AS byMyChild
      ${POST_JOINS}
      WHERE p.group_id = ? AND (p.status = 'visible' OR (? AND p.status = 'hidden'))
        AND (md.id IS NULL OR md.approved = 1 OR ? OR u.parent_id = ?)
      ORDER BY (p.status = 'hidden') DESC, (md.approved = 0) DESC, p.created_at DESC LIMIT 100`)
      .all(req.user.id, g.id, g.isOwner ? 1 : 0, g.isOwner ? 1 : 0, req.user.id);
    res.json({ isOwner: !!g.isOwner, posts: posts.map((p) => withMedia({ ...p, byMyChild: !!p.byMyChild })) });
  });

  app.post("/api/posts/:id/moderate", parent, (req, res) => {
    const post = q(`SELECT p.* FROM posts p JOIN groups g ON g.id = p.group_id WHERE p.id = ? AND g.owner_id = ?`)
      .get(req.params.id, req.user.id);
    if (!post) fail(404, "Fant ikke innlegget");
    const action = req.body.action;
    if (action === "restore") q("UPDATE posts SET status = 'visible' WHERE id = ?").run(post.id);
    else if (action === "approve") q("UPDATE media SET approved = 1 WHERE post_id = ?").run(post.id);
    else if (action === "remove") {
      q("UPDATE posts SET status = 'removed' WHERE id = ?").run(post.id);
      q("DELETE FROM media WHERE post_id = ?").run(post.id);
      sweepMedia();
    } else fail(400, "Ugyldig handling");
    q("UPDATE reports SET resolved = 1 WHERE post_id = ?").run(post.id);
    res.json({ ok: true });
  });

  // ---------- Statiske filer og feil ----------
  app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));

  app.use("/api", (req, res) => res.status(404).json({ error: "Finnes ikke" }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Ugyldig JSON" });
    if (err.type === "entity.too.large") {
      return res.status(413).json({ error: `Fila er for stor. Video kan være maks ${mediaLimits.videoMb} MB.`, code: "TOO_BIG" });
    }
    console.error(err);
    res.status(500).json({ error: "Noe gikk galt" });
  });

  return app;
}
