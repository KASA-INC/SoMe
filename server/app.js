import express from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkText } from "./filter.js";
import { isJpeg, stripJpegMetadata, inspectVideo, MediaError } from "./media.js";
import { createMailer } from "./mail.js";
import { renderEmail } from "./email.js";
import { APP_NAME } from "./config.js";
import {
  COOKIE, hashPassword, verifyPassword, createSession, destroySession, userFromToken,
  readCookie, sessionCookie, tooManyAttempts, recordFailure, clearFailures, sha256,
} from "./auth.js";

// Merkelapper barnet kan sette på et innlegg. De er valgfrie: et innlegg uten merkelapp lagres med kind "".
export const KINDS = {
  glad: "Glad for",
  laerte: "Lærte noe",
  takk: "Takk til",
  laget: "Har laget",
  sporsmal: "Spørsmål",
  tips: "Tips",
  gleder: "Gleder meg til",
  opplevd: "Har opplevd",
};
// Bakgrunnsfarge per innlegg velges ikke lenger i appen (alle meldinger er like bobler),
// men feltet godtas fortsatt og lagres for eldre innlegg og klienter.
export const COLORS = ["lilla", "bla", "gronn", "gul", "oransje", "rosa"];
export const STICKERS = ["", "⚽", "🏀", "🎮", "🎨", "📚", "🎵", "🎬", "🍕", "🚲", "🐶", "☀️"];
export const AVATARS = ["🦊", "🐼", "🐸", "🐯", "🐧", "🦖", "🐙", "🦉", "⚡", "🎧", "🚀", "🌊", "🔥", "🌙", "🎮", "🎸"];

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
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const RESET_MINUTES = 60;
const VERIFY_HOURS = 48;

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
  appUrl = "http://localhost:3000", mailer = createMailer(),
}) {
  const app = express();
  app.disable("x-powered-by");
  mkdirSync(mediaDir, { recursive: true });

  const clock = (ts = now()) => {
    const s = new Date(ts).toLocaleString("sv-SE", { timeZone: TZ });
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
      // Nettsiden får ikke bruke posisjon, kamera eller mikrofon (bilder velges med telefonens egen velger).
      "Permissions-Policy": "geolocation=(), camera=(), microphone=(), payment=(), usb=()",
    });
    // I drift: nettleseren skal alltid bruke HTTPS mot quipu i ett år framover.
    if (secureCookies) res.set("Strict-Transport-Security", "max-age=31536000"); // uten includeSubDomains, så e-post- og cPanel-adresser hos Domene.no ikke påvirkes
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
    // Svar med personlige data skal ikke lagres i mellomlagre underveis (bilder og video setter sin egen).
    res.set("Cache-Control", "no-store");
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
    const posted = (d) => q("SELECT COUNT(*) AS n FROM posts WHERE author_id = ? AND day = ?").get(user.id, d).n;
    const postedToday = posted(day);
    // Ubrukte innlegg fra i går kan tas med til i dag, så det aldri blir «bruk dem eller mist dem».
    // Det gir høyst dobbelt så mange som dagsgrensen på én dag.
    const yesterday = new Date(Date.parse(`${day}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
    // Kontoer som ble laget i dag, har ingen gårsdag å spare fra.
    const carried = clock(user.created_at).day < day ? Math.max(0, user.posts_per_day - posted(yesterday)) : 0;
    const postAllowance = user.posts_per_day + carried;
    const open = hm >= user.open_from && hm < user.open_to;
    return {
      open,
      openFrom: user.open_from,
      openTo: user.open_to,
      minutesLeft: Math.max(0, user.daily_minutes - used),
      postsLeft: Math.max(0, postAllowance - postedToday),
      postsToday: postedToday,
      postAllowance,
      postsCarried: carried,
    };
  }

  const childGate = (req, res, next) => {
    const status = childStatus(req.user);
    if (!status.open) fail(403, `${APP_NAME} åpner igjen kl. ${status.openFrom}.`, "CLOSED");
    if (status.minutesLeft <= 0) fail(403, "Du har brukt tiden din for i dag. Vi ses i morgen.", "TIME_UP");
    req.limits = status;
    next();
  };
  const child = [needUser("child"), childGate];
  // Foresatte må ha bekreftet e-posten før de kan lage barn, grupper eller lese innlegg.
  // parentAny brukes der man må slippe til uten: konto, passord, ny bekreftelseslenke og sletting.
  const parentAny = needUser("parent");
  const verifiedGate = (req, res, next) => {
    if (!req.user.email_verified) fail(403, "Bekreft e-postadressen din først. Vi har sendt deg en lenke.", "EMAIL_UNVERIFIED");
    next();
  };
  const parent = [parentAny, verifiedGate];

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

  // Foresatte logger inn med e-post. Brukernavnet lages automatisk og vises ikke,
  // men databasen krever et unikt brukernavn på alle kontoer (barna bruker sitt).
  app.post("/api/register", async (req, res) => {
    const { password } = req.body;
    if (registrationCode && !safeEqual(String(req.body.code || "").trim(), registrationCode)) {
      fail(403, "Feil registreringskode. Spør den som inviterte deg.");
    }
    const displayName = validateDisplayName(req.body.displayName);
    const email = validateEmail(req.body.email);
    validateNewPassword(password);
    let username;
    do username = `foresatt-${randomBytes(5).toString("hex")}`;
    while (q("SELECT 1 FROM users WHERE username = ?").get(username));
    const { lastInsertRowid } = q(`INSERT INTO users (username, password_hash, role, display_name, email, avatar, created_at)
      VALUES (?, ?, 'parent', ?, ?, '🧑', ?)`).run(username, hashPassword(password), displayName, email, now());
    const token = createSession(db, lastInsertRowid);
    await sendVerification({ id: lastInsertRowid, display_name: displayName }, email);
    res.set("Set-Cookie", sessionCookie(token, secureCookies)).status(201).json({ ok: true });
  });

  // Én innlogging for alle: foresatte skriver e-post, barn skriver brukernavn.
  // Foresatte som registrerte seg før e-post kom, kan også bruke brukernavnet sitt.
  app.post("/api/login", (req, res) => {
    const { password } = req.body;
    const login = String(req.body.login ?? req.body.username ?? "").trim().toLowerCase();
    const key = `${login}|${req.ip}`;
    if (tooManyAttempts(key)) fail(429, "For mange forsøk. Vent litt og prøv igjen.");
    const user = login.includes("@")
      ? q("SELECT * FROM users WHERE email = ? AND role = 'parent'").get(login)
      : q("SELECT * FROM users WHERE username = ?").get(login);
    if (!user || typeof password !== "string" || !verifyPassword(password, user.password_hash)) {
      recordFailure(key);
      fail(401, "Feil e-post, brukernavn eller passord");
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
    if (req.user.role === "parent") {
      me.email = req.user.email || "";
      me.emailVerified = !!req.user.email_verified;
      me.pendingEmail = q(`SELECT email FROM email_verifications WHERE user_id = ? AND expires_at > ? AND email != ?
        ORDER BY expires_at DESC LIMIT 1`).get(req.user.id, now(), me.email)?.email || "";
    }
    if (req.user.role === "child") {
      me.status = childStatus(req.user);
      me.onboarded = !!req.user.onboarded;
      me.groups = q(`SELECT g.id, g.name FROM groups g JOIN memberships m ON m.group_id = g.id AND m.approved = 1
        WHERE m.user_id = ? ORDER BY g.name`).all(req.user.id);
    }
    res.json({ me, kinds: KINDS, colors: COLORS, stickers: STICKERS, avatars: AVATARS, media: mediaLimits });
  });

  // Barnet har lest introduksjonen og vet at voksne kan lese det som deles.
  app.post("/api/onboarded", needUser("child"), (req, res) => {
    q("UPDATE users SET onboarded = 1 WHERE id = ?").run(req.user.id);
    res.json({ ok: true });
  });

  // ---------- Passord og e-post ----------
  function validateEmail(value, userId = 0) {
    const email = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!EMAIL.test(email)) fail(400, "Skriv inn en gyldig e-postadresse");
    if (q("SELECT 1 FROM users WHERE email = ? AND id != ?").get(email, userId)) fail(409, "E-postadressen er allerede i bruk");
    return email;
  }

  function validateNewPassword(password) {
    if (typeof password !== "string" || password.length < 8) fail(400, "Passordet må ha minst 8 tegn");
    if (password.length > 200) fail(400, "Passordet er for langt");
  }

  // Lager en engangslenke for å sette nytt passord. Brukes av «Glemt passord» og av cli.js.
  function createResetLink(userId) {
    const token = randomBytes(32).toString("hex");
    q("DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?").run(userId, now());
    q("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .run(sha256(token), userId, now() + RESET_MINUTES * 60e3);
    // Koden ligger etter # så den aldri sendes til serveren i loggede URL-er eller Referer.
    return `${appUrl.replace(/\/$/, "")}/#reset=${token}`;
  }
  app.locals.createResetLink = createResetLink;

  // Sender en lenke som bekrefter at adressen tilhører den foresatte. Brukes ved registrering og ny adresse.
  async function sendVerification(user, email) {
    const token = randomBytes(32).toString("hex");
    q("DELETE FROM email_verifications WHERE user_id = ? OR expires_at < ?").run(user.id, now());
    q("INSERT INTO email_verifications (token_hash, user_id, email, expires_at) VALUES (?, ?, ?, ?)")
      .run(sha256(token), user.id, email, now() + VERIFY_HOURS * 3600e3);
    const link = `${appUrl.replace(/\/$/, "")}/#verify=${token}`;
    try {
      await mailer.send({
        to: email,
        subject: `Bekreft e-postadressen din i ${APP_NAME}`,
        ...renderEmail({
          preheader: "Ett trykk, så er kontoen klar.",
          heading: `Hei ${user.display_name}!`,
          paragraphs: [`Trykk på knappen for å bekrefte at ${email} er din adresse i ${APP_NAME}. Da kan du lage kontoer til barna og bli med i klassens gruppe.`],
          button: { label: "Bekreft e-postadressen", url: link },
          note: `Lenken virker i ${VERIFY_HOURS} timer. Har du ikke laget en konto eller byttet e-post, kan du se bort fra denne e-posten.`,
        }),
      });
    } catch (err) {
      console.error("Klarte ikke å sende e-post:", err.message);
    }
  }

  // Lenken kan åpnes på en annen enhet enn den man er logget inn på, så den krever ikke innlogging.
  app.post("/api/email/verify", (req, res) => {
    const token = typeof req.body.token === "string" ? req.body.token : "";
    const row = /^[0-9a-f]{64}$/.test(token) &&
      q("SELECT * FROM email_verifications WHERE token_hash = ? AND expires_at > ?").get(sha256(token), now());
    if (!row) fail(400, "Lenken er utløpt eller allerede brukt. Logg inn og be om en ny.", "VERIFY_INVALID");
    if (q("SELECT 1 FROM users WHERE email = ? AND id != ?").get(row.email, row.user_id)) fail(409, "E-postadressen er allerede i bruk");
    q("UPDATE users SET email = ?, email_verified = 1 WHERE id = ?").run(row.email, row.user_id);
    q("DELETE FROM email_verifications WHERE user_id = ?").run(row.user_id);
    res.json({ ok: true });
  });

  // Send bekreftelseslenken på nytt (til ny adresse som venter, ellers til adressen som ikke er bekreftet).
  app.post("/api/email/resend", parentAny, async (req, res) => {
    const key = `verify|${req.user.id}`;
    if (tooManyAttempts(key)) fail(429, "Du har bedt om mange lenker. Vent litt og prøv igjen.");
    recordFailure(key);
    const pending = q("SELECT email FROM email_verifications WHERE user_id = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1")
      .get(req.user.id, now())?.email;
    const email = pending || (!req.user.email_verified && req.user.email);
    if (email) await sendVerification(req.user, email);
    res.json({ ok: true });
  });

  // Ny e-post tas først i bruk når lenken til den nye adressen er åpnet. Er den gamle ikke bekreftet ennå
  // (for eksempel en skrivefeil ved registrering), byttes den med en gang, så man kan logge inn med den nye.
  app.patch("/api/me", parentAny, async (req, res) => {
    let pendingEmail = "";
    if (req.body.email !== undefined) {
      const email = validateEmail(req.body.email, req.user.id);
      if (!req.user.email_verified) {
        q("UPDATE users SET email = ? WHERE id = ?").run(email, req.user.id);
        await sendVerification(req.user, email);
      } else if (email !== req.user.email) {
        await sendVerification(req.user, email);
        pendingEmail = email;
      }
    }
    if (req.body.displayName !== undefined) {
      q("UPDATE users SET display_name = ? WHERE id = ?").run(validateDisplayName(req.body.displayName), req.user.id);
    }
    res.json({ ok: true, pendingEmail });
  });

  // Bytt passord når man er logget inn. Krever det gamle passordet.
  app.post("/api/me/password", parentAny, (req, res) => {
    const key = `pw|${req.user.id}`;
    if (tooManyAttempts(key)) fail(429, "For mange forsøk. Vent litt og prøv igjen.");
    if (typeof req.body.current !== "string" || !verifyPassword(req.body.current, req.user.password_hash)) {
      recordFailure(key);
      fail(400, "Nåværende passord er feil");
    }
    validateNewPassword(req.body.password);
    q("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(req.body.password), req.user.id);
    // Logg ut alle andre enheter, men behold denne.
    q("DELETE FROM sessions WHERE user_id = ?").run(req.user.id);
    res.set("Set-Cookie", sessionCookie(createSession(db, req.user.id), secureCookies)).json({ ok: true });
  });

  // Glemt passord: svarer alltid det samme, så ingen kan finne ut hvilke e-poster som finnes.
  app.post("/api/password/forgot", async (req, res) => {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const key = `reset|${req.ip}`;
    if (tooManyAttempts(key)) fail(429, "For mange forsøk. Vent litt og prøv igjen.");
    recordFailure(key); // teller alle forsøk, så man ikke kan sende mange e-poster
    const user = EMAIL.test(email) && q("SELECT * FROM users WHERE email = ? AND role = 'parent'").get(email);
    if (user) {
      const link = createResetLink(user.id);
      try {
        await mailer.send({
          to: email,
          subject: `Nytt passord til ${APP_NAME}`,
          ...renderEmail({
            preheader: "Lenken virker i én time.",
            heading: `Hei ${user.display_name}!`,
            paragraphs: [`Noen, forhåpentligvis du, har bedt om å sette nytt passord for ${APP_NAME}-kontoen din (${email}).`],
            button: { label: "Velg nytt passord", url: link },
            note: `Lenken virker i ${RESET_MINUTES} minutter og kan bare brukes én gang. Var det ikke du, kan du se bort fra denne e-posten. Passordet ditt er ikke endret.`,
          }),
        });
      } catch (err) {
        console.error("Klarte ikke å sende e-post:", err.message);
      }
    }
    res.json({ ok: true });
  });

  app.post("/api/password/reset", (req, res) => {
    const token = typeof req.body.token === "string" ? req.body.token : "";
    const row = /^[0-9a-f]{64}$/.test(token) &&
      q("SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > ?").get(sha256(token), now());
    if (!row) fail(400, "Lenken er utløpt eller allerede brukt. Be om en ny.", "RESET_INVALID");
    validateNewPassword(req.body.password);
    // Lenken kom til e-postadressen, så den er bekreftet også.
    q("UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?").run(hashPassword(req.body.password), row.user_id);
    q("DELETE FROM password_resets WHERE user_id = ?").run(row.user_id);
    q("DELETE FROM sessions WHERE user_id = ?").run(row.user_id);
    const user = q("SELECT username, email FROM users WHERE id = ?").get(row.user_id);
    clearFailures(`${user.username.toLowerCase()}|${req.ip}`);
    if (user.email) clearFailures(`${user.email}|${req.ip}`);
    res.set("Set-Cookie", sessionCookie(createSession(db, row.user_id), secureCookies)).json({ ok: true });
  });

  // Foresatte kan slette sin egen konto. Barnekontoene og alt innholdet slettes også.
  app.delete("/api/me", parentAny, (req, res) => {
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
        AND p.group_id IN (SELECT group_id FROM memberships WHERE user_id = ? AND approved = 1)
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
          fail(400, `Videoen er ${Math.round(duration)} sekunder. Maks er ${mediaLimits.videoSeconds} sekunder. Du kan klippe den i Bilder-appen.`, "TOO_LONG");
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
        ? m.approved && m.status === "visible" && q("SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ? AND approved = 1").get(m.groupId, me.id)
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
    const { groupId, kind, sticker = "", color = COLORS[0], mediaId } = req.body;
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (req.limits.postsLeft <= 0) fail(429, "Du har delt det du kan i dag. Du kan dele mer i morgen.", "POST_LIMIT");
    if (!q("SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ? AND approved = 1").get(groupId, req.user.id)) fail(403, "Du er ikke med i den gruppa");
    const kindKey = kind ?? "";
    if (kindKey !== "" && !Object.hasOwn(KINDS, kindKey)) fail(400, "Ugyldig merkelapp");
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(groupId, req.user.id, kindKey, text, sticker, color, clock().day, now());
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
    const post = q(`SELECT p.* FROM posts p JOIN memberships m ON m.group_id = p.group_id AND m.user_id = ? AND m.approved = 1
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
        groups: q(`SELECT g.id, g.name, (m.approved = 0) AS pending FROM groups g JOIN memberships m ON m.group_id = g.id
          WHERE m.user_id = ? ORDER BY g.name`).all(c.id).map((g) => ({ ...g, pending: !!g.pending })),
      })),
    });
  });

  app.post("/api/children", parent, (req, res) => {
    const { username, password, avatar } = req.body;
    validateCredentials(username, password);
    const displayName = validateDisplayName(req.body.displayName);
    if (!AVATARS.includes(avatar)) fail(400, "Velg et profilbilde");
    q(`INSERT INTO users (username, password_hash, role, display_name, avatar, parent_id, posts_per_day, created_at)
      VALUES (?, ?, 'child', ?, ?, ?, 5, ?)`).run(username, hashPassword(password), displayName, avatar, req.user.id, now());
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
    if (b.avatar !== undefined && !AVATARS.includes(b.avatar)) fail(400, "Ugyldig profilbilde");
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
      SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.group_id = g.id AND m.approved = 1 AND u.parent_id = ?))`)
    .get(userId, groupId, userId, userId);

  app.get("/api/groups", parent, (req, res) => {
    const groups = q(`SELECT DISTINCT g.* FROM groups g LEFT JOIN memberships m ON m.group_id = g.id AND m.approved = 1
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
            WHERE m.group_id = ? AND m.approved = 1 ORDER BY u.display_name`).all(g.id),
          // Eieren ser hvem som vil inn, og hvilken foresatt som spør, så hen kan sjekke at det er en fra klassen.
          pendingMembers: isOwner ? q(`SELECT u.id, u.display_name AS displayName, u.avatar,
              p.display_name AS parentName, p.email AS parentEmail
            FROM memberships m JOIN users u ON u.id = m.user_id JOIN users p ON p.id = u.parent_id
            WHERE m.group_id = ? AND m.approved = 0 ORDER BY u.display_name`).all(g.id) : undefined,
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

  // Med invitasjonskoden ber man om å bli med. Eieren av gruppa må godkjenne barnet før det ser noe.
  // Eierens egne barn slipper rett inn.
  app.post("/api/groups/join", parent, async (req, res) => {
    const c = ownChild(req);
    const g = q("SELECT * FROM groups WHERE invite_code = ?").get(String(req.body.code || "").trim().toUpperCase());
    if (!g) fail(404, "Fant ingen gruppe med den koden");
    const existing = q("SELECT approved FROM memberships WHERE group_id = ? AND user_id = ?").get(g.id, c.id);
    if (existing) return res.json({ ok: true, pending: !existing.approved });
    const approved = g.owner_id === req.user.id ? 1 : 0;
    q("INSERT INTO memberships (group_id, user_id, approved) VALUES (?, ?, ?)").run(g.id, c.id, approved);
    if (!approved) {
      const owner = q("SELECT display_name, email FROM users WHERE id = ?").get(g.owner_id);
      if (owner?.email) {
        try {
          await mailer.send({
            to: owner.email,
            subject: `${c.display_name} vil bli med i ${g.name}`,
            ...renderEmail({
              preheader: "Godkjenn eller avslå under Grupper.",
              heading: `${c.display_name} vil bli med i ${g.name}`,
              paragraphs: [
                `Hei ${owner.display_name}! ${req.user.display_name} (${req.user.email}) har bedt om at barnet ${c.display_name} får bli med i gruppa ${g.name}.`,
                "Sjekk at det er noen fra klassen før du godkjenner. Barnet ser ingenting i gruppa før du har sagt ja.",
              ],
              button: { label: "Åpne Grupper", url: appUrl },
            }),
          });
        } catch (err) {
          console.error("Klarte ikke å sende e-post:", err.message);
        }
      }
    }
    res.json({ ok: true, pending: !approved });
  });

  // Eieren godkjenner eller avslår et barn som venter på å bli med.
  app.post("/api/groups/:groupId/members/:userId", parent, (req, res) => {
    const g = q("SELECT id FROM groups WHERE id = ? AND owner_id = ?").get(req.params.groupId, req.user.id);
    if (!g) fail(404, "Fant ikke gruppa");
    const action = req.body.action;
    if (action !== "approve" && action !== "reject") fail(400, "Ugyldig handling");
    const { changes } = action === "approve"
      ? q("UPDATE memberships SET approved = 1 WHERE group_id = ? AND user_id = ? AND approved = 0").run(g.id, req.params.userId)
      : q("DELETE FROM memberships WHERE group_id = ? AND user_id = ? AND approved = 0").run(g.id, req.params.userId);
    if (!changes) fail(404, "Fant ingen forespørsel");
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
  // extensions: /om viser om.html.
  app.use(express.static(fileURLToPath(new URL("../public", import.meta.url)), { extensions: ["html"] }));

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
