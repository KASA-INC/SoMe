import express from "express";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkText } from "./filter.js";
import { isJpeg, isWebp, stripJpegMetadata, stripWebpMetadata, inspectVideo, MediaError } from "./media.js";
import { createMailer } from "./mail.js";
import { renderEmail } from "./email.js";
import { createPushSender, createVapidKeys } from "./push.js";
import { newSecret, verifyCode, otpauthUri } from "./totp.js";
import { APP_NAME, CONTACT_EMAIL } from "./config.js";
import {
  COOKIE, hashPassword, verifyPassword, createSession, destroySession, userFromToken,
  readCookie, sessionCookie, createLimiter, deviceLabel, sha256,
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
// Hva barnet kan si fra om. Alvorlige saker vises først for administrator.
export const REPORT_CATEGORIES = {
  mobbing: { label: "Mobbing eller utestenging", serious: false },
  trussel: { label: "Trusler eller vold", serious: true },
  kontakt: { label: "Noen vil møte meg, ber om bilder eller er ekkel", serious: true },
  bilde: { label: "Ekkelt eller farlig bilde eller video", serious: true },
  annet: { label: "Noe annet", serious: false },
};
export const COLORS = ["lilla", "bla", "gronn", "gul", "oransje", "rosa"];
export const STICKERS = ["", "⚽", "🏀", "🎮", "🎨", "📚", "🎵", "🎬", "🍕", "🚲", "🐶", "☀️"];
// Profilbilder til barna: «Critters» fra DiceBear (CC0), farget med paletten. Filene ligger i public/avatars/
// og lages med scripts/avatars.mjs. Foresatte får en tilfeldig figur automatisk.
export const AVATARS = Array.from({ length: 24 }, (_, i) => `c${String(i + 1).padStart(2, "0")}`);

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
const INVITE_DAYS = 14; // så lenge en invitasjon til en annen foresatt virker
const INVITES_PER_DAY = 40;
const INVITE_EMAILS_MAX = 30; // adresser i én invitasjon
const SHARE_DAYS = 7; // så lenge en lenke for å dele et barn med en annen foresatt virker
const SHARES_PER_DAY = 10;
const CLEANUP_DAYS = 30;
// Innlegg og meldinger i voksenkontakten, med bilder og video, slettes etter 60 dager. Det er lenge nok til at
// foresatte rekker å se dem og barn rekker å si fra, og barna etterlater seg ikke et arkiv.
const KEEP_DAYS = 60;
// Administratorloggen, alvorlige saker med varsler og behandlede meldinger fra barn slettes etter ett år.
const ADMIN_RETENTION_DAYS = 365;

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
  db, mediaDir, mediaLimits = DEFAULT_MEDIA_LIMITS, now = Date.now, secureCookies = false, registrationCode = "", push,
  alarmEmails = [], ackMinutes = 15,
  appUrl = "http://localhost:3000", mailer = createMailer(),
}) {
  const app = express();
  const { tooManyAttempts, recordFailure, clearFailures, sweep: sweepFailures } = createLimiter(db, now);
  // Foresatte har kortere innlogging enn barn, fordi kontoen styrer barna. Barn som må logge inn ofte,
  // skriver gjerne passordet ned.
  const SESSION_DAYS = { parent: 14, child: 30 };
  // Lager en innlogging og setter informasjonskapselen. Returnerer navnet på enheten.
  function startSession(req, res, user) {
    const days = SESSION_DAYS[user.role] || 14;
    const device = deviceLabel(req.headers["user-agent"]);
    const token = createSession(db, user.id, { days, device, now: now() });
    res.set("Set-Cookie", sessionCookie(token, secureCookies, days));
    return device;
  }
  // Kort e-post om noe som har skjedd med kontoen. Ingen lenker med koder.
  async function notifyAccount(to, subject, heading, paragraphs, { notYou = true } = {}) {
    if (!to) return;
    try {
      await mailer.send({ to, subject, ...renderEmail({ preheader: subject, heading, paragraphs: notYou ? [...paragraphs,
        `Var det ikke deg? Bytt passord med en gang under Konto eller med «Glemt passord», og skriv til ${CONTACT_EMAIL}.`] : paragraphs }) });
    } catch (err) {
      console.error("Klarte ikke å sende e-post:", err.message);
    }
  }
  const when = (t) => new Date(t).toLocaleString("nb-NO", { timeZone: "Europe/Oslo", dateStyle: "long", timeStyle: "short" });
  app.disable("x-powered-by");
  mkdirSync(mediaDir, { recursive: true });

  const clock = (ts = now()) => {
    const s = new Date(ts).toLocaleString("sv-SE", { timeZone: TZ });
    return { day: s.slice(0, 10), hm: s.slice(11, 16) };
  };

  const q = (sql) => db.prepare(sql);
  let lastEscalation = null; // når varslingsjobben sist kjørte ferdig (null til den har kjørt én gang)

  // Nøklene til push-varsler lages første gang og lagres i databasen, så ingenting må settes opp.
  function vapidKeys() {
    const row = q("SELECT value FROM app_settings WHERE key = 'vapid'").get();
    if (row) return JSON.parse(row.value);
    const keys = createVapidKeys();
    q("INSERT INTO app_settings (key, value) VALUES ('vapid', ?)").run(JSON.stringify(keys));
    return keys;
  }
  const pushSender = push || createPushSender(vapidKeys);

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
    const token = readCookie(req, COOKIE);
    req.user = userFromToken(db, token);
    req.sessionHash = token ? sha256(token) : null;
    if (req.user) q("UPDATE sessions SET last_seen = ? WHERE token_hash = ? AND last_seen < ?").run(now(), req.sessionHash, now() - 5 * 60e3);
    // En utestengt konto regnes som utlogget (øktene slettes også når den stenges).
    if (req.user?.suspended_at) req.user = null;
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
  // Svarer 503 hvis varslingen av alvorlige saker har stoppet opp, så Render starter appen på nytt.
  app.get("/healthz", (req, res) => {
    q("SELECT 1").get();
    if (lastEscalation !== null && now() - lastEscalation > 5 * 60e3) {
      return res.status(503).json({ ok: false, error: "Varslingen av alvorlige saker har ikke kjørt på over 5 minutter" });
    }
    res.json({ ok: true });
  });

  app.get("/api/signup-info", (req, res) => res.json({ codeRequired: !!registrationCode }));

  const isBanned = (email) => !!q("SELECT 1 FROM banned_emails WHERE email_hash = ?").get(sha256(String(email).trim().toLowerCase()));

  // Invitasjon fra en annen foresatt: gyldig, ubrukt og ikke utløpt.
  const findInvite = (token) => typeof token === "string" && /^[0-9a-f]{64}$/.test(token)
    ? q(`SELECT i.*, u.display_name AS inviter_name, g.name AS group_name, g.owner_id AS group_owner
        FROM parent_invites i JOIN users u ON u.id = i.inviter_id LEFT JOIN groups g ON g.id = i.group_id
        WHERE i.token_hash = ? AND i.expires_at > ?`).get(sha256(token), now())
    : undefined;
  const INVITE_GONE = "Invitasjonen er brukt eller har gått ut. Be den som inviterte deg om en ny.";

  // Husker at en foresatt er invitert til en gruppe. Har eieren invitert, slipper barnet rett inn.
  function rememberGroupInvite(userId, groupId, inviterId, ownerId) {
    q(`INSERT INTO group_invitations (user_id, group_id, inviter_id, auto_approve, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, group_id) DO UPDATE SET inviter_id = excluded.inviter_id,
        auto_approve = MAX(auto_approve, excluded.auto_approve)`)
      .run(userId, groupId, inviterId, inviterId === ownerId ? 1 : 0, now());
  }

  // Registreringssiden viser hvem som har invitert deg, og til hvilken gruppe. Krever ikke innlogging.
  app.get("/api/invites/:token", (req, res) => {
    const invite = findInvite(req.params.token);
    if (!invite) fail(404, INVITE_GONE);
    res.json({ inviter: invite.inviter_name, email: invite.email || "", group: invite.group_name || null });
  });

  // En som allerede har konto, åpner en gruppeinvitasjon: hen blir invitert til gruppa.
  app.post("/api/invites/:token/accept", parent, (req, res) => {
    const invite = findInvite(req.params.token);
    if (!invite) fail(404, INVITE_GONE);
    if (invite.group_id) rememberGroupInvite(req.user.id, invite.group_id, invite.inviter_id, invite.group_owner);
    q("DELETE FROM parent_invites WHERE token_hash = ?").run(invite.token_hash);
    res.json({ ok: true, group: invite.group_name || null });
  });

  async function sendInviteEmail(to, inviter, group, url, existing) {
    const where = group ? `gruppa ${group.name} i ${APP_NAME}` : APP_NAME;
    try {
      await mailer.send({
        to,
        subject: group ? `${inviter.display_name} inviterer deg til ${group.name} i ${APP_NAME}` : `${inviter.display_name} inviterer deg til ${APP_NAME}`,
        ...renderEmail({
          preheader: existing ? "Logg inn og meld barnet ditt inn i gruppa." : "Lag en foresatt-konto med lenken.",
          heading: `${inviter.display_name} inviterer deg til ${group ? group.name : APP_NAME}`,
          paragraphs: existing
            ? [`${inviter.display_name} (${inviter.email}) har invitert deg og barnet ditt til ${where}.`,
              "Logg inn og gå til Barn. Der kan du melde barnet ditt inn i gruppa uten invitasjonskode."]
            : [`${APP_NAME} er en rolig sosial app for klassen, uten likes, reklame og sporing. Foresatte lager kontoer til barna og bestemmer hvilke grupper de er med i.`,
              `${inviter.display_name} (${inviter.email}) har invitert deg til ${where}.`],
          button: existing ? { label: `Åpne ${APP_NAME}`, url: appUrl } : { label: "Lag konto", url },
          note: existing ? undefined : `Invitasjonen virker i ${INVITE_DAYS} dager og kan brukes én gang. Kjenner du ikke ${inviter.display_name}, kan du se bort fra denne e-posten.`,
        }),
      });
      return mailer.configured === false ? "not_sent" : "sent"; // uten SMTP havner e-posten bare i serverloggen
    } catch (err) {
      console.error("Klarte ikke å sende e-post:", err.message);
      return "not_sent";
    }
  }

  // En foresatt inviterer andre foresatte, til quipu eller til en gruppe. Med e-postadresser sendes én invitasjon
  // til hver. Uten adresser lages én lenke som kan deles som melding.
  app.post("/api/invites", parent, async (req, res) => {
    let group = null;
    if (req.body.groupId !== undefined && req.body.groupId !== null) {
      group = q("SELECT * FROM groups WHERE id = ?").get(req.body.groupId);
      if (!group || !canTalk(req.user.id, group)) fail(404, "Fant ikke gruppa");
    }
    const raw = Array.isArray(req.body.emails) ? req.body.emails : req.body.email ? [req.body.email] : [];
    if (raw.length > INVITE_EMAILS_MAX) fail(400, `Du kan invitere ${INVITE_EMAILS_MAX} adresser om gangen`);
    const emails = [...new Set(raw.map((e) => (typeof e === "string" ? e.trim().toLowerCase() : "")))];
    const bad = emails.find((e) => !EMAIL.test(e));
    if (bad !== undefined) fail(400, `Sjekk e-postadressen ${bad || "(tom)"}`);
    const recent = q("SELECT COUNT(*) AS n FROM parent_invites WHERE inviter_id = ? AND created_at > ?").get(req.user.id, now() - 864e5).n;
    if (recent + Math.max(1, emails.length) > INVITES_PER_DAY) fail(429, `Du kan lage ${INVITES_PER_DAY} invitasjoner i døgnet. Prøv igjen i morgen.`);

    const createInvite = (email) => {
      const token = randomBytes(32).toString("hex");
      q("INSERT INTO parent_invites (token_hash, inviter_id, email, group_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(sha256(token), req.user.id, email, group?.id ?? null, now(), now() + INVITE_DAYS * 864e5);
      // Koden ligger etter # så den aldri havner i serverlogger.
      return `${appUrl.replace(/\/$/, "")}/#invitasjon=${token}`;
    };
    if (!emails.length) return res.status(201).json({ url: createInvite(null), results: [] });

    const results = [];
    for (const email of emails) {
      if (isBanned(email)) { results.push({ email, status: "blocked" }); continue; }
      const existing = q("SELECT id, role FROM users WHERE email = ?").get(email);
      if (existing) {
        // Har adressen allerede konto, trengs ingen ny konto. Gjelder det en gruppe, blir hen invitert til den.
        if (!group || existing.role !== "parent" || existing.id === req.user.id) { results.push({ email, status: "exists" }); continue; }
        rememberGroupInvite(existing.id, group.id, req.user.id, group.owner_id);
        results.push({ email, status: await sendInviteEmail(email, req.user, group, null, true) === "sent" ? "invited" : "invited_not_sent" });
        continue;
      }
      const url = createInvite(email);
      const status = await sendInviteEmail(email, req.user, group, url, false);
      // Kom ikke e-posten fram, får den som inviterer lenken, så hen kan sende den selv.
      results.push(status === "sent" ? { email, status } : { email, status, url });
    }
    res.status(201).json({ results });
  });

  // Invitasjoner og delingslenker jeg har sendt som ikke er brukt ennå. De kan trekkes tilbake.
  app.get("/api/invites", parent, (req, res) => {
    const invites = q(`SELECT i.token_hash, i.email, i.created_at, i.expires_at, g.name AS group_name FROM parent_invites i
      LEFT JOIN groups g ON g.id = i.group_id WHERE i.inviter_id = ? AND i.expires_at > ? ORDER BY i.created_at DESC`).all(req.user.id, now());
    const shares = q(`SELECT s.token_hash, s.email, s.created_at, s.expires_at, c.display_name AS child_name FROM child_shares s
      JOIN users c ON c.id = s.child_id WHERE s.inviter_id = ? AND s.expires_at > ? ORDER BY s.created_at DESC`).all(req.user.id, now());
    res.json({
      links: [
        ...invites.map((i) => ({ id: `i${i.token_hash.slice(0, 16)}`, kind: "invite", email: i.email || "", group: i.group_name || null, createdAt: i.created_at, expiresAt: i.expires_at })),
        ...shares.map((x) => ({ id: `s${x.token_hash.slice(0, 16)}`, kind: "share", email: x.email || "", child: x.child_name, createdAt: x.created_at, expiresAt: x.expires_at })),
      ].sort((a, b) => b.createdAt - a.createdAt),
    });
  });
  app.delete("/api/invites/:id", parent, (req, res) => {
    const m = req.params.id.match(/^([is])([0-9a-f]{16})$/);
    if (!m) fail(404, "Fant ikke lenken");
    q(`DELETE FROM ${m[1] === "i" ? "parent_invites" : "child_shares"} WHERE inviter_id = ? AND substr(token_hash, 1, 16) = ?`).run(req.user.id, m[2]);
    res.json({ ok: true });
  });

  // Gruppeinvitasjoner den innloggede foresatte har fått. Kan skjules.
  app.delete("/api/invitations/:groupId", parent, (req, res) => {
    q("DELETE FROM group_invitations WHERE user_id = ? AND group_id = ?").run(req.user.id, req.params.groupId);
    res.json({ ok: true });
  });

  // Foresatte logger inn med e-post. Brukernavnet lages automatisk og vises ikke,
  // men databasen krever et unikt brukernavn på alle kontoer (barna bruker sitt).
  app.post("/api/register", async (req, res) => {
    const { password } = req.body;
    // Med en invitasjon fra en annen foresatt trengs ikke registreringskoden.
    const invite = req.body.invite ? findInvite(req.body.invite) : undefined;
    if (req.body.invite && !invite) fail(400, INVITE_GONE);
    // En delingslenke for et barn virker også som invitasjon.
    const share = req.body.share ? findShare(req.body.share) : undefined;
    if (req.body.share && !share) fail(400, SHARE_GONE);
    if (typeof req.body.email === "string" && isBanned(req.body.email)) fail(403, `Denne e-postadressen kan ikke brukes i ${APP_NAME}.`);
    if (!invite && !share && registrationCode && !safeEqual(String(req.body.code || "").trim(), registrationCode)) {
      fail(403, "Feil registreringskode. Be en foresatt som allerede bruker quipu, om en invitasjon.");
    }
    const displayName = validateDisplayName(req.body.displayName);
    const email = validateEmail(req.body.email);
    validateNewPassword(password);
    let username;
    do username = `foresatt-${randomBytes(5).toString("hex")}`;
    while (q("SELECT 1 FROM users WHERE username = ?").get(username));
    const { lastInsertRowid } = q(`INSERT INTO users (username, password_hash, role, display_name, email, avatar, invited_by, created_at)
      VALUES (?, ?, 'parent', ?, ?, ?, ?, ?)`).run(username, hashPassword(password), displayName, email, AVATARS[randomInt(AVATARS.length)], invite?.inviter_id ?? null, now());
    if (invite) {
      q("DELETE FROM parent_invites WHERE token_hash = ?").run(invite.token_hash);
      if (invite.group_id) rememberGroupInvite(lastInsertRowid, invite.group_id, invite.inviter_id, invite.group_owner);
    }
    if (share) await addGuardian(share, { id: lastInsertRowid, display_name: displayName, email });
    startSession(req, res, { id: lastInsertRowid, role: "parent" });
    await sendVerification({ id: lastInsertRowid, display_name: displayName }, email);
    res.status(201).json({ ok: true });
  });

  // Én innlogging for alle: foresatte skriver e-post, barn skriver brukernavn.
  // Foresatte som registrerte seg før e-post kom, kan også bruke brukernavnet sitt.
  app.post("/api/login", async (req, res) => {
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
    if (user.suspended_at) {
      fail(403, user.role === "child"
        ? "Kontoen er stengt. Snakk med en voksen."
        : `Kontoen er stengt fordi den ikke fulgte reglene. Ta kontakt med ${CONTACT_EMAIL} hvis du mener dette er feil.`, "SUSPENDED");
    }
    // Ny innlogging fra en type enhet foresatte ikke allerede er logget inn på: e-post om det.
    const known = new Set(q("SELECT device FROM sessions WHERE user_id = ? AND expires_at > ?").all(user.id, now()).map((r) => r.device));
    const device = startSession(req, res, user);
    if (user.role === "parent" && !known.has(device)) {
      await notifyAccount(user.email, `Ny innlogging i ${APP_NAME}`, "Ny innlogging",
        [`Hei ${user.display_name}! Noen logget inn på ${APP_NAME}-kontoen din fra ${device}, ${when(now())}.`,
          "Var det deg, trenger du ikke gjøre noe. Under Konto ser du alle innloggingene og kan logge dem ut."]);
    }
    res.json({ ok: true });
  });

  // Innloggingene til en foresatt, så hen kan se dem og logge ut enheter hen ikke kjenner igjen.
  app.get("/api/sessions", parentAny, (req, res) => {
    res.json({
      sessions: q("SELECT token_hash, device, created_at, last_seen FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen DESC")
        .all(req.user.id, now()).map((x) => ({
          id: x.token_hash.slice(0, 16), device: x.device || "Ukjent enhet", createdAt: x.created_at, lastSeen: x.last_seen,
          current: x.token_hash === req.sessionHash,
        })),
    });
  });
  app.delete("/api/sessions/:id", parentAny, (req, res) => {
    if (!/^[0-9a-f]{16}$/.test(req.params.id)) fail(404, "Fant ikke innloggingen");
    q("DELETE FROM sessions WHERE user_id = ? AND substr(token_hash, 1, 16) = ? AND token_hash != ?").run(req.user.id, req.params.id, req.sessionHash);
    res.json({ ok: true });
  });
  app.post("/api/sessions/others", parentAny, (req, res) => {
    const { changes } = q("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(req.user.id, req.sessionHash);
    res.json({ ok: true, loggedOut: changes });
  });

  app.post("/api/logout", (req, res) => {
    const token = readCookie(req, COOKIE);
    if (token) destroySession(db, token);
    res.set("Set-Cookie", sessionCookie(null, secureCookies)).json({ ok: true });
  });

  app.get("/api/me", needUser(), (req, res) => {
    const me = publicUser(req.user);
    if (req.user.role === "parent") {
      me.isAdmin = !!req.user.is_admin;
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
    res.json({ me, kinds: KINDS, colors: COLORS, stickers: STICKERS, avatars: AVATARS, media: mediaLimits, reportCategories: REPORT_CATEGORIES });
  });

  // Barnet bytter profilbilde selv.
  app.post("/api/me/avatar", needUser("child"), (req, res) => {
    if (!AVATARS.includes(req.body.avatar)) fail(400, "Ugyldig profilbilde");
    q("UPDATE users SET avatar = ? WHERE id = ?").run(req.body.avatar, req.user.id);
    res.json({ ok: true });
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
    if (isBanned(email)) fail(403, `Denne e-postadressen kan ikke brukes i ${APP_NAME}.`);
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
  app.post("/api/email/verify", async (req, res) => {
    const token = typeof req.body.token === "string" ? req.body.token : "";
    const row = /^[0-9a-f]{64}$/.test(token) &&
      q("SELECT * FROM email_verifications WHERE token_hash = ? AND expires_at > ?").get(sha256(token), now());
    if (!row) fail(400, "Lenken er utløpt eller allerede brukt. Logg inn og be om en ny.", "VERIFY_INVALID");
    if (q("SELECT 1 FROM users WHERE email = ? AND id != ?").get(row.email, row.user_id)) fail(409, "E-postadressen er allerede i bruk");
    const before = q("SELECT * FROM users WHERE id = ?").get(row.user_id);
    q("UPDATE users SET email = ?, email_verified = 1 WHERE id = ?").run(row.email, row.user_id);
    q("DELETE FROM email_verifications WHERE user_id = ?").run(row.user_id);
    if (before.email && before.email !== row.email) {
      // Ny e-postadresse: andre enheter logges ut (ikke den som bekreftet), og den gamle adressen får beskjed.
      q("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(row.user_id, req.sessionHash || "");
      await notifyAccount(before.email, `E-postadressen din i ${APP_NAME} er endret`, "Ny e-postadresse",
        [`Hei ${before.display_name}! E-postadressen til ${APP_NAME}-kontoen din ble endret fra ${before.email} til ${row.email} ${when(now())}. Andre enheter er logget ut.`]);
    }
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
  app.post("/api/me/password", parentAny, async (req, res) => {
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
    startSession(req, res, req.user);
    await notifyAccount(req.user.email, `Passordet ditt i ${APP_NAME} er endret`, "Passordet er endret",
      [`Hei ${req.user.display_name}! Passordet til ${APP_NAME}-kontoen din ble endret ${when(now())}. Alle andre enheter er logget ut.`]);
    res.json({ ok: true });
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

  app.post("/api/password/reset", async (req, res) => {
    const token = typeof req.body.token === "string" ? req.body.token : "";
    const row = /^[0-9a-f]{64}$/.test(token) &&
      q("SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > ?").get(sha256(token), now());
    if (!row) fail(400, "Lenken er utløpt eller allerede brukt. Be om en ny.", "RESET_INVALID");
    validateNewPassword(req.body.password);
    // Lenken kom til e-postadressen, så den er bekreftet også.
    q("UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?").run(hashPassword(req.body.password), row.user_id);
    q("DELETE FROM password_resets WHERE user_id = ?").run(row.user_id);
    q("DELETE FROM sessions WHERE user_id = ?").run(row.user_id);
    const user = q("SELECT * FROM users WHERE id = ?").get(row.user_id);
    clearFailures(`${user.username.toLowerCase()}|${req.ip}`);
    if (user.email) clearFailures(`${user.email}|${req.ip}`);
    startSession(req, res, user);
    await notifyAccount(user.email, `Passordet ditt i ${APP_NAME} er endret`, "Passordet er endret",
      [`Hei ${user.display_name}! Passordet til ${APP_NAME}-kontoen din ble satt på nytt med «Glemt passord» ${when(now())}. Alle andre enheter er logget ut.`]);
    res.json({ ok: true });
  });

  // Foresatte kan slette sin egen konto. Barnekontoene og alt innholdet slettes også.
  // Innsyn og dataportabilitet: alt quipu har om deg og barna dine, som én JSON-fil.
  app.get("/api/me/export", parentAny, (req, res) => {
    const me = req.user;
    const children = q("SELECT u.* FROM users u JOIN guardians gd ON gd.child_id = u.id AND gd.parent_id = ?").all(me.id);
    const postsBy = (id) => q(`SELECT p.id, g.name AS gruppe, p.kind AS merkelapp, p.text AS tekst, p.status, p.created_at AS tidspunkt,
      (SELECT md.type FROM media md WHERE md.post_id = p.id) AS vedlegg FROM posts p JOIN groups g ON g.id = p.group_id
      WHERE p.author_id = ? ORDER BY p.created_at`).all(id).map((p) => ({ ...p, tidspunkt: new Date(p.tidspunkt).toISOString() }));
    const iso = (t) => (t ? new Date(t).toISOString() : null);
    const data = {
      laget: new Date(now()).toISOString(),
      tjeneste: APP_NAME,
      konto: { navn: me.display_name, epost: me.email, laget: iso(me.created_at), epostVarsler: me.notify_email },
      innlogginger: q("SELECT device AS enhet, created_at, last_seen FROM sessions WHERE user_id = ?").all(me.id)
        .map((x) => ({ enhet: x.enhet, startet: iso(x.created_at), sistBrukt: iso(x.last_seen) })),
      barn: children.map((c) => ({
        navn: c.display_name, brukernavn: c.username, laget: iso(c.created_at),
        grenser: { minutterPerDag: c.daily_minutes, apenFra: c.open_from, apenTil: c.open_to, innleggPerDag: c.posts_per_day },
        foresatte: guardiansOf(c.id).map((g) => g.display_name),
        grupper: q("SELECT g.name, m.approved FROM memberships m JOIN groups g ON g.id = m.group_id WHERE m.user_id = ?").all(c.id)
          .map((g) => ({ navn: g.name, godkjent: !!g.approved })),
        innlegg: postsBy(c.id),
        skjermtid: q("SELECT day AS dag, minutes AS minutter FROM usage WHERE user_id = ? ORDER BY day").all(c.id),
      })),
      grupperJegEier: q("SELECT name AS navn, created_at FROM groups WHERE owner_id = ?").all(me.id).map((g) => ({ navn: g.navn, laget: iso(g.created_at) })),
      mineBeskjederIVoksenkontakt: q(`SELECT g.name AS gruppe, m.text AS tekst, m.created_at FROM adult_messages m JOIN groups g ON g.id = m.group_id
        WHERE m.author_id = ? ORDER BY m.created_at`).all(me.id).map((m) => ({ gruppe: m.gruppe, tekst: m.tekst, tidspunkt: iso(m.created_at) })),
      merknad: "Bilder og video er ikke med i fila. Skriv til " + CONTACT_EMAIL + " hvis du vil ha dem.",
    };
    res.set("Content-Disposition", `attachment; filename="quipu-data-${clock().day}.json"`).json(data);
  });

  // Barn med andre foresatte beholdes (de får en ny første foresatt). Barn der du er eneste foresatt, slettes.
  app.delete("/api/me", parentAny, (req, res) => {
    for (const { child_id } of q("SELECT child_id FROM guardians WHERE parent_id = ?").all(req.user.id)) {
      if (guardiansOf(child_id).length > 1) leaveChild(child_id, req.user.id);
      else q("DELETE FROM users WHERE id = ?").run(child_id);
    }
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

  // Feeden spør jevnlig om det er kommet noe nytt fra de andre siden innlegget med id «since».
  // Bare et tall, så barnet selv velger når de nye innleggene skal vises.
  app.get("/api/feed/new", child, (req, res) => {
    const since = Number(req.query.since) || 0;
    const { n } = q(`SELECT COUNT(*) AS n ${POST_JOINS}
      WHERE p.id > ? AND p.author_id != ? AND p.status = 'visible' AND p.created_at >= ?
        AND p.group_id IN (SELECT group_id FROM memberships WHERE user_id = ? AND approved = 1)
        AND (md.id IS NULL OR md.approved = 1)`).get(since, req.user.id, now() - FEED_DAYS * 864e5, req.user.id);
    res.json({ count: n });
  });

  // ---------- Bilder og video ----------
  const maxUploadBytes = Math.max(mediaLimits.videoMb, mediaLimits.imageMb) * 1024 * 1024;

  // Barn laster opp bilder og video til innlegg. Foresatte laster opp bilder til voksenkontakten.
  const uploader = (req, res, next) => (req.user?.role === "parent" ? verifiedGate : childGate)(req, res, next);
  app.post("/api/media", needUser(), uploader, express.raw({ type: () => true, limit: maxUploadBytes }), (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) fail(400, "Fila er tom");
    const pending = q("SELECT COUNT(*) AS n FROM media WHERE owner_id = ? AND post_id IS NULL AND adult_message_id IS NULL").get(req.user.id).n;
    if (pending >= MAX_PENDING_UPLOADS) {
      q("DELETE FROM media WHERE owner_id = ? AND post_id IS NULL AND adult_message_id IS NULL").run(req.user.id);
      sweepMedia();
    }

    let media;
    try {
      if (isJpeg(buf) || isWebp(buf)) {
        if (buf.length > mediaLimits.imageMb * 1024 * 1024) fail(413, `Bildet er for stort. Maks ${mediaLimits.imageMb} MB.`);
        media = isJpeg(buf)
          ? { type: "image", mime: "image/jpeg", data: stripJpegMetadata(buf), duration: null }
          : { type: "image", mime: "image/webp", data: stripWebpMetadata(buf), duration: null };
      } else if (req.user.role === "parent") {
        fail(400, "Bare bilder kan deles i voksenkontakten");
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
    const m = q(`SELECT md.*, p.group_id AS groupId, p.status, am.group_id AS adultGroupId FROM media md
      LEFT JOIN posts p ON p.id = md.post_id LEFT JOIN adult_messages am ON am.id = md.adult_message_id
      WHERE md.id = ?`).get(req.params.id);
    if (!m) fail(404, "Finnes ikke");
    const me = req.user;
    if (me.role === "child") childGate(req, res, () => {});
    const adultGroup = m.adultGroupId && q("SELECT * FROM groups WHERE id = ?").get(m.adultGroupId);
    // Administratoren kan se bilder og video i innlegg som er meldt.
    const reportedForAdmin = !!me.is_admin && me.role === "parent" && m.post_id
      && !!q("SELECT 1 FROM reports WHERE post_id = ? AND resolved = 0").get(m.post_id);
    const allowed = reportedForAdmin || m.owner_id === me.id || (adultGroup ? me.role === "parent" && canTalk(me.id, adultGroup) : m.groupId && m.status !== "removed" && (
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
    q("DELETE FROM media WHERE post_id IS NULL AND adult_message_id IS NULL AND created_at < ?").run(now() - 3600e3);
    const keep = new Set(q("SELECT id FROM media").all().map((r) => r.id));
    for (const file of readdirSync(mediaDir)) {
      if (!keep.has(file)) {
        try { unlinkSync(join(mediaDir, file)); } catch { /* allerede borte */ }
      }
    }
  }
  app.locals.sweepMedia = sweepMedia;

  // ---------- Alvorlige saker: varsling, kvittering og eskalering ----------
  // En alvorlig melding blir en sak. Vakthavende varsles straks. Har ingen kvittert innen ackMinutes,
  // varsles neste på vaktlisten, så neste, og til slutt alle administratorer og beredskapsadressene
  // (BEREDSKAP_EPOST), på nytt hvert ackMinutes til noen kvitterer. Et sendt varsel er ikke en kvittering.
  const oncall = () => q(`SELECT * FROM users WHERE is_admin = 1 AND suspended_at IS NULL AND oncall_rank IS NOT NULL
    ORDER BY oncall_rank, id`).all();
  // Hvem som varsles på hvert steg: 0 = vakthavende, 1 = reserve, …, deretter alle + beredskap.
  function recipientsFor(step) {
    const list = oncall();
    if (step < list.length) return { users: [list.at(step)], extra: [] };
    const all = q("SELECT * FROM users WHERE is_admin = 1 AND suspended_at IS NULL").all();
    return { users: all, extra: alarmEmails };
  }
  async function alertStep(incident, step) {
    const cat = REPORT_CATEGORIES[incident.category]?.label || incident.category;
    const late = step > 0 ? ` Ingen har tatt ansvar for den på ${Math.round((now() - incident.created_at) / 60e3)} minutter.` : "";
    const subject = `Alvorlig melding i ${APP_NAME}: ta ansvar nå`;
    const text = `${cat}, kom inn ${when(incident.created_at)}.${late}`;
    const log = (userId, recipient, channel, ok, error = "") => {
      if (!ok) console.error(`Varsel om alvorlig sak ${incident.id} til ${recipient} feilet: ${error}`);
      q(`INSERT INTO incident_alerts (incident_id, user_id, recipient, channel, step, sent_at, ok, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(incident.id, userId, recipient, channel, step, now(), ok ? 1 : 0, error);
    };
    const { users, extra } = recipientsFor(step);
    const email = async (to, userId) => {
      try {
        if (mailer.configured === false) throw new Error("e-post er ikke satt opp");
        await mailer.send({ to, subject, ...renderEmail({
          preheader: text,
          heading: "En alvorlig melding venter på at noen tar ansvar",
          paragraphs: [text, "Logg inn, åpne Admin og trykk «Jeg tar ansvar». Til noen har gjort det, går varselet videre til neste på vaktlisten.",
            "Er et barn i fare nå, ring 112 først."],
          button: { label: `Åpne ${APP_NAME}`, url: appUrl },
        }) });
        log(userId, to, "email", true);
      } catch (err) {
        log(userId, to, "email", false, err.message);
      }
    };
    for (const u of users) {
      if (u.email) await email(u.email, u.id);
      for (const sub of q("SELECT * FROM push_subscriptions WHERE user_id = ?").all(u.id)) {
        try {
          const { gone } = await pushSender.send(sub, { title: subject, body: text, url: "/#admin", tag: `sak-${incident.id}`, topic: `sak-${incident.id}` });
          if (gone) q("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
          log(u.id, `push ${sub.id}`, "push", !gone, gone ? "enheten finnes ikke lenger" : "");
        } catch (err) {
          log(u.id, `push ${sub.id}`, "push", false, err.message);
        }
      }
    }
    for (const to of extra) await email(to, null);
    if (!users.length && !extra.length) log(null, "ingen", "email", false, "ingen administrator eller beredskapsadresse å varsle");
  }
  async function openIncident(kind, refId, category) {
    if (q("SELECT 1 FROM incidents WHERE kind = ? AND ref_id = ?").get(kind, refId)) return;
    const { lastInsertRowid } = q("INSERT INTO incidents (kind, ref_id, category, created_at, next_at) VALUES (?, ?, ?, ?, ?)")
      .run(kind, refId, category, now(), now() + ackMinutes * 60e3);
    await alertStep(q("SELECT * FROM incidents WHERE id = ?").get(lastInsertRowid), 0);
  }
  // Kjøres hvert minutt (se index.js): saker uten kvittering går videre på vaktlisten.
  async function escalateIncidents() {
    for (const inc of q("SELECT * FROM incidents WHERE acked_at IS NULL AND next_at <= ?").all(now())) {
      const step = inc.step + 1;
      q("UPDATE incidents SET step = ?, next_at = ? WHERE id = ?").run(step, now() + ackMinutes * 60e3, inc.id);
      await alertStep(inc, step);
    }
    lastEscalation = now(); // /healthz sjekker at jobben går
  }
  app.locals.escalateIncidents = escalateIncidents;

  // ---------- Administrasjon ----------
  // Bare for den som drifter quipu: statistikk som tall, meldte innlegg og utestenging.
  // Administrator må ha to-trinns innlogging, og skrive inn en engangskode på hver enhet minst hver 12. time.
  const MFA_HOURS = 12;
  const isAdmin = (req, res, next) => {
    if (!req.user.is_admin) fail(404, "Finnes ikke");
    next();
  };
  const admin = [parent, isAdmin, (req, res, next) => {
    if (!req.user.totp_secret) fail(403, "Slå på to-trinns innlogging for å bruke administrasjonen.", "MFA_SETUP");
    const s = q("SELECT mfa_at FROM sessions WHERE token_hash = ?").get(req.sessionHash);
    if (!s?.mfa_at || now() - s.mfa_at > MFA_HOURS * 3600e3) fail(403, "Skriv inn koden fra autentiseringsappen.", "MFA_REQUIRED");
    next();
  }];
  const markMfa = (req, step) => {
    q("UPDATE sessions SET mfa_at = ? WHERE token_hash = ?").run(now(), req.sessionHash);
    q("UPDATE users SET totp_last_step = ? WHERE id = ?").run(step, req.user.id);
  };

  // Ny nøkkel til autentiseringsappen. Den tas i bruk først når en kode fra appen er bekreftet.
  app.post("/api/admin/mfa/setup", parent, isAdmin, (req, res) => {
    if (req.user.totp_secret) fail(409, "To-trinns innlogging er allerede slått på.");
    const secret = newSecret();
    q("UPDATE users SET totp_pending = ? WHERE id = ?").run(secret, req.user.id);
    res.json({ secret, uri: otpauthUri(secret, req.user.email, APP_NAME) });
  });
  app.post("/api/admin/mfa/confirm", parent, isAdmin, (req, res) => {
    const pending = q("SELECT totp_pending FROM users WHERE id = ?").get(req.user.id).totp_pending;
    if (!pending) fail(400, "Start på nytt.");
    const step = verifyCode(pending, req.body.code, now());
    if (step === null) fail(400, "Feil kode. Sjekk at klokka på telefonen stemmer, og prøv koden som vises nå.");
    q("UPDATE users SET totp_secret = ?, totp_pending = NULL WHERE id = ?").run(pending, req.user.id);
    markMfa(req, step);
    adminLog(req, "slo på to-trinns innlogging", req.user.display_name);
    res.json({ ok: true });
  });
  app.post("/api/admin/mfa", parent, isAdmin, (req, res) => {
    const key = `mfa|${req.user.id}`;
    if (tooManyAttempts(key)) fail(429, "For mange forsøk. Vent litt og prøv igjen.");
    const step = req.user.totp_secret && verifyCode(req.user.totp_secret, req.body.code, now(), req.user.totp_last_step);
    if (step === null || step === undefined || step === false) {
      recordFailure(key);
      fail(400, "Feil kode. Prøv koden som vises nå.");
    }
    clearFailures(key);
    markMfa(req, step);
    res.json({ ok: true });
  });
  const adminLog = (req, action, target, detail = "") =>
    q("INSERT INTO admin_log (admin_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)").run(req.user.id, action, target, detail, now());

  // Dagssummer for dager som er ferdige. Kjøres før gamle skjermtidsdata slettes, så tallene tas vare på.
  function recordDailyStats() {
    const { day: today } = clock();
    const days = q(`SELECT day FROM usage WHERE day < ? UNION SELECT day FROM posts WHERE day < ?
      EXCEPT SELECT day FROM daily_stats`).all(today, today).map((r) => r.day);
    for (const day of days) {
      // Tidspunkter telles på Oslo-dagen. Vinduet er romslig, og clock() avgjør hvilken dag de hører til.
      const from = Date.parse(`${day}T00:00:00Z`) - 3 * 3600e3;
      const onDay = (rows) => rows.filter((r) => clock(r.t).day === day).length;
      const created = (role) => onDay(q("SELECT created_at AS t FROM users WHERE role = ? AND created_at >= ? AND created_at < ?").all(role, from, from + 30 * 3600e3));
      const u = q("SELECT COUNT(*) AS n, COALESCE(SUM(minutes), 0) AS m FROM usage WHERE day = ? AND minutes > 0").get(day);
      const p = q("SELECT COUNT(*) AS n, COUNT(md.id) AS media FROM posts p LEFT JOIN media md ON md.post_id = p.id WHERE p.day = ?").get(day);
      const r = onDay(q("SELECT created_at AS t FROM reports WHERE created_at >= ? AND created_at < ?").all(from, from + 30 * 3600e3));
      q(`INSERT OR IGNORE INTO daily_stats (day, active_children, minutes, posts, posts_media, reports, new_parents, new_children)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(day, u.n, u.m, p.n, p.media, r, created("parent"), created("child"));
    }
  }
  app.locals.recordDailyStats = recordDailyStats;

  app.get("/api/admin/stats", admin, (req, res) => {
    const count = (sql, ...a) => q(sql).get(...a).n;
    const { day } = clock();
    recordDailyStats();
    res.json({
      totals: {
        parents: count("SELECT COUNT(*) AS n FROM users WHERE role = 'parent'"),
        parentsVerified: count("SELECT COUNT(*) AS n FROM users WHERE role = 'parent' AND email_verified = 1"),
        children: count("SELECT COUNT(*) AS n FROM users WHERE role = 'child'"),
        groups: count("SELECT COUNT(*) AS n FROM groups"),
        invitedParents: count("SELECT COUNT(*) AS n FROM users WHERE invited_by IS NOT NULL"),
        sharedChildren: count("SELECT COUNT(*) AS n FROM (SELECT child_id FROM guardians GROUP BY child_id HAVING COUNT(*) > 1)"),
        openReports: count("SELECT COUNT(DISTINCT post_id) AS n FROM reports WHERE resolved = 0"),
        openSafety: count("SELECT COUNT(*) AS n FROM safety_reports WHERE resolved_at IS NULL"),
        openIncidents: count("SELECT COUNT(*) AS n FROM incidents WHERE acked_at IS NULL"),
        suspended: count("SELECT COUNT(*) AS n FROM users WHERE suspended_at IS NOT NULL"),
        pushDevices: count("SELECT COUNT(*) AS n FROM push_subscriptions"),
      },
      today: {
        day,
        activeChildren: count("SELECT COUNT(*) AS n FROM usage WHERE day = ? AND minutes > 0", day),
        minutes: count("SELECT COALESCE(SUM(minutes), 0) AS n FROM usage WHERE day = ?", day),
        posts: count("SELECT COUNT(*) AS n FROM posts WHERE day = ?", day),
      },
      days: q("SELECT * FROM daily_stats ORDER BY day DESC LIMIT 30").all().map((d) => ({
        day: d.day, activeChildren: d.active_children, minutes: d.minutes, posts: d.posts, postsMedia: d.posts_media,
        reports: d.reports, newParents: d.new_parents, newChildren: d.new_children,
      })),
    });
  });

  // Meldte innlegg fra alle grupper. Administratoren ser bare innlegg noen har meldt, ikke resten.
  app.get("/api/admin/reports", admin, (req, res) => {
    const posts = q(`SELECT ${POST_FIELDS}, u.username, u.id AS authorId, u.suspended_at AS authorSuspended,
        (SELECT COUNT(*) FROM reports r WHERE r.post_id = p.id AND r.resolved = 0) AS reports,
        (SELECT MIN(created_at) FROM reports r WHERE r.post_id = p.id) AS reportedAt,
        (SELECT group_concat(DISTINCT category) FROM reports r WHERE r.post_id = p.id) AS categories,
        p.hold, p.status AS postStatus
      ${POST_JOINS}
      WHERE (EXISTS (SELECT 1 FROM reports r WHERE r.post_id = p.id AND r.resolved = 0) AND p.status != 'removed') OR p.hold = 1
      LIMIT 200`).all().map((p) => {
      const categories = (p.categories || "annet").split(",");
      return withMedia({ ...p, authorSuspended: !!p.authorSuspended, hold: !!p.hold, categories, serious: categories.some((c) => REPORT_CATEGORIES[c]?.serious) });
    });
    // Alvorlige saker først, så de eldste.
    posts.sort((a, b) => (b.serious - a.serious) || (a.reportedAt - b.reportedAt));
    res.json({ posts, categories: REPORT_CATEGORIES });
  });

  app.post("/api/admin/posts/:id", admin, (req, res) => {
    const post = q("SELECT * FROM posts WHERE id = ?").get(req.params.id);
    if (!post) fail(404, "Fant ikke innlegget");
    const action = req.body.action;
    if (!["remove", "restore", "hold", "release"].includes(action)) fail(400, "Ugyldig valg");
    if (action === "hold" || action === "release") {
      // Bevar som dokumentasjon i en alvorlig sak. Innlegget skjules for barna, men slettes ikke.
      q("UPDATE posts SET hold = ?, status = CASE WHEN ? THEN 'removed' ELSE status END WHERE id = ?").run(action === "hold" ? 1 : 0, action === "hold" ? 1 : 0, post.id);
      adminLog(req, action === "hold" ? "bevarte innlegg" : "sluttet å bevare innlegg", `innlegg ${post.id}`, post.text.slice(0, 80));
      return res.json({ ok: true });
    }
    q("UPDATE posts SET status = ? WHERE id = ?").run(action === "remove" ? "removed" : "visible", post.id);
    q("UPDATE reports SET resolved = 1 WHERE post_id = ?").run(post.id);
    adminLog(req, action === "remove" ? "fjernet innlegg" : "viste innlegg igjen", `innlegg ${post.id}`, post.text.slice(0, 80));
    res.json({ ok: true });
  });

  // Alvorlige saker med varslene som er sendt. Åpne (ikke kvittert) først.
  app.get("/api/admin/incidents", admin, (req, res) => {
    const rows = q(`SELECT i.*, u.display_name AS ackedBy FROM incidents i LEFT JOIN users u ON u.id = i.acked_by
      ORDER BY i.acked_at IS NOT NULL, i.created_at DESC LIMIT 50`).all();
    res.json({
      incidents: rows.map((i) => ({
        id: i.id, kind: i.kind, refId: i.ref_id, category: i.category, label: REPORT_CATEGORIES[i.category]?.label || i.category,
        createdAt: i.created_at, step: i.step, nextAt: i.next_at, ackedAt: i.acked_at, ackedBy: i.ackedBy || "",
        alerts: q(`SELECT a.recipient, a.channel, a.step, a.sent_at AS sentAt, a.ok, a.error, u.display_name AS name FROM incident_alerts a
          LEFT JOIN users u ON u.id = a.user_id WHERE a.incident_id = ? ORDER BY a.id`).all(i.id).map((a) => ({ ...a, ok: !!a.ok })),
      })),
      ackMinutes,
      oncall: oncall().map((u) => ({ id: u.id, displayName: u.display_name, rank: u.oncall_rank })),
      admins: q("SELECT id, display_name, oncall_rank FROM users WHERE is_admin = 1 AND suspended_at IS NULL ORDER BY display_name").all()
        .map((u) => ({ id: u.id, displayName: u.display_name, rank: u.oncall_rank })),
      alarmEmails: alarmEmails.length,
    });
  });
  // Kvittering: denne administratoren tar ansvar for saken. Stopper eskaleringen.
  app.post("/api/admin/incidents/:id/ack", admin, (req, res) => {
    const inc = q("SELECT * FROM incidents WHERE id = ?").get(req.params.id);
    if (!inc) fail(404, "Fant ikke saken");
    if (inc.acked_at) return res.json({ ok: true, ackedBy: q("SELECT display_name FROM users WHERE id = ?").get(inc.acked_by)?.display_name || "" });
    q("UPDATE incidents SET acked_at = ?, acked_by = ? WHERE id = ?").run(now(), req.user.id, inc.id);
    adminLog(req, "tok ansvar for alvorlig sak", `sak ${inc.id}`, `${REPORT_CATEGORIES[inc.category]?.label || inc.category}, ${Math.round((now() - inc.created_at) / 60e3)} min etter meldingen`);
    res.json({ ok: true, ackedBy: req.user.display_name });
  });
  // Vaktlisten: rekkefølgen administratorene varsles i. Tom liste = alle varsles med en gang.
  app.put("/api/admin/oncall", admin, (req, res) => {
    const ids = Array.isArray(req.body.order) ? req.body.order.map(Number) : [];
    const admins = new Set(q("SELECT id FROM users WHERE is_admin = 1").all().map((u) => u.id));
    if (ids.some((id) => !admins.has(id)) || new Set(ids).size !== ids.length) fail(400, "Vaktlisten kan bare ha administratorer, én gang hver");
    q("UPDATE users SET oncall_rank = NULL WHERE is_admin = 1").run();
    ids.forEach((id, i) => q("UPDATE users SET oncall_rank = ? WHERE id = ?").run(i + 1, id));
    adminLog(req, "endret vaktlisten", ids.map((id) => q("SELECT display_name FROM users WHERE id = ?").get(id).display_name).join(" → ") || "tom");
    res.json({ ok: true });
  });

  // «Si fra om noe annet» fra barn. Alvorlige først, og åpne før behandlede.
  app.get("/api/admin/safety", admin, (req, res) => {
    const rows = q(`SELECT s.*, u.display_name AS childName, u.username, r.display_name AS resolvedBy FROM safety_reports s
      JOIN users u ON u.id = s.reporter_id LEFT JOIN users r ON r.id = s.resolved_by
      ORDER BY s.resolved_at IS NOT NULL, s.created_at DESC LIMIT 100`).all();
    res.json({
      reports: rows.map((s) => ({
        id: s.id, category: s.category, serious: !!REPORT_CATEGORIES[s.category]?.serious, text: s.text, createdAt: s.created_at,
        child: { id: s.reporter_id, displayName: s.childName, username: s.username, guardians: guardiansOf(s.reporter_id).map((g) => g.display_name) },
        resolved: !!s.resolved_at, resolvedBy: s.resolvedBy || "", note: s.note,
      })).sort((a, b) => (a.resolved - b.resolved) || (b.serious - a.serious)),
      categories: REPORT_CATEGORIES,
    });
  });
  app.post("/api/admin/safety/:id", admin, (req, res) => {
    const row = q("SELECT * FROM safety_reports WHERE id = ?").get(req.params.id);
    if (!row) fail(404, "Fant ikke meldingen");
    const note = String(req.body.note || "").trim().slice(0, 500);
    q("UPDATE safety_reports SET resolved_at = ?, resolved_by = ?, note = ? WHERE id = ?").run(now(), req.user.id, note, row.id);
    adminLog(req, "behandlet melding fra barn", `melding ${row.id}`, note);
    res.json({ ok: true });
  });

  // Søk etter kontoer for å stenge eller åpne dem.
  app.get("/api/admin/users", admin, (req, res) => {
    const term = String(req.query.q || "").trim().toLowerCase();
    if (term.length < 2) return res.json({ users: [] });
    const like = `%${term.replace(/[%_]/g, "")}%`;
    const users = q(`SELECT id, role, username, display_name, email, created_at, suspended_at, suspended_reason, suspended_cause FROM users
      WHERE lower(display_name) LIKE ? OR lower(username) LIKE ? OR lower(COALESCE(email, '')) LIKE ? OR CAST(id AS TEXT) = ?
      ORDER BY role, display_name LIMIT 50`).all(like, like, like, term);
    res.json({
      users: users.map((u) => ({
        id: u.id, role: u.role, username: u.username, displayName: u.display_name, email: u.email || "",
        createdAt: u.created_at, suspended: !!u.suspended_at, suspendedReason: u.suspended_reason || "", suspendedCause: u.suspended_cause || "",
        // For barn: foresatte. For foresatte: barna.
        related: u.role === "child"
          ? guardiansOf(u.id).map((g) => g.display_name)
          : q("SELECT c.display_name FROM guardians gd JOIN users c ON c.id = gd.child_id WHERE gd.parent_id = ?").all(u.id).map((c) => c.display_name),
      })),
    });
  });

  // Stenger en konto. En foresatt mister også e-postadressen (kan ikke registrere seg på nytt med den).
  // Barn der den stengte er eneste foresatt som ikke er stengt, stenges også. Barn med en annen foresatt beholder kontoen.
  app.post("/api/admin/users/:id/suspend", admin, (req, res) => {
    const u = q("SELECT * FROM users WHERE id = ?").get(req.params.id);
    if (!u) fail(404, "Fant ikke kontoen");
    if (u.id === req.user.id) fail(400, "Du kan ikke stenge din egen konto");
    const reason = String(req.body.reason || "").trim().slice(0, 300);
    if (reason.length < 3) fail(400, "Skriv en kort grunn");
    const suspend = (id, cause) => {
      q("UPDATE users SET suspended_at = ?, suspended_reason = ?, suspended_cause = ? WHERE id = ? AND suspended_at IS NULL").run(now(), reason, cause, id);
      q("DELETE FROM sessions WHERE user_id = ?").run(id);
      q("DELETE FROM push_subscriptions WHERE user_id = ?").run(id);
    };
    suspend(u.id, "admin");
    const alsoSuspended = [];
    if (u.role === "parent") {
      if (u.email) q("INSERT OR IGNORE INTO banned_emails (email_hash, created_at) VALUES (?, ?)").run(sha256(u.email), now());
      for (const { child_id } of q("SELECT child_id FROM guardians WHERE parent_id = ?").all(u.id)) {
        const active = q(`SELECT COUNT(*) AS n FROM guardians gd JOIN users p ON p.id = gd.parent_id
          WHERE gd.child_id = ? AND p.suspended_at IS NULL`).get(child_id).n;
        if (!active) {
          suspend(child_id, "parent");
          alsoSuspended.push(q("SELECT display_name FROM users WHERE id = ?").get(child_id).display_name);
        }
      }
    }
    adminLog(req, "stengte", `${u.role === "child" ? "barn" : "foresatt"} ${u.display_name} (${u.id})`,
      reason + (alsoSuspended.length ? ` · også stengt: ${alsoSuspended.join(", ")}` : ""));
    // Begrunnelse og klagemulighet: til den foresatte selv, eller til foresatte til et barn som er stengt.
    const appeal = `Mener du dette er feil, kan du klage. Skriv til ${CONTACT_EMAIL} og fortell hvorfor, så ser vi på saken på nytt.`;
    if (u.role === "parent") {
      notifyAccount(u.email, `Kontoen din i ${APP_NAME} er stengt`, "Kontoen din er stengt", [
        `Hei ${u.display_name}! Kontoen din i ${APP_NAME} ble stengt ${when(now())}.`, `Grunn: ${reason}`,
        ...(alsoSuspended.length ? [`Barnekontoer der du er eneste foresatt, er også stengt: ${alsoSuspended.join(", ")}.`] : []),
        appeal], { notYou: false });
    } else {
      for (const p of q(`SELECT p.email, p.display_name FROM guardians gd JOIN users p ON p.id = gd.parent_id
        WHERE gd.child_id = ? AND p.suspended_at IS NULL`).all(u.id)) {
        notifyAccount(p.email, `Barnekontoen til ${u.display_name} i ${APP_NAME} er stengt`, "En barnekonto er stengt", [
          `Hei ${p.display_name}! Barnekontoen til ${u.display_name} ble stengt ${when(now())}.`, `Grunn: ${reason}`, appeal], { notYou: false });
      }
    }
    res.json({ ok: true, alsoSuspended });
  });

  app.post("/api/admin/users/:id/unsuspend", admin, (req, res) => {
    const u = q("SELECT * FROM users WHERE id = ?").get(req.params.id);
    if (!u) fail(404, "Fant ikke kontoen");
    q("UPDATE users SET suspended_at = NULL, suspended_reason = NULL, suspended_cause = NULL WHERE id = ?").run(u.id);
    const alsoOpened = [];
    if (u.role === "parent") {
      if (u.email) q("DELETE FROM banned_emails WHERE email_hash = ?").run(sha256(u.email));
      // Barn som ble stengt fordi denne var eneste foresatt, åpnes igjen.
      for (const c of q(`SELECT c.id, c.display_name FROM guardians gd JOIN users c ON c.id = gd.child_id
        WHERE gd.parent_id = ? AND c.suspended_cause = 'parent'`).all(u.id)) {
        q("UPDATE users SET suspended_at = NULL, suspended_reason = NULL, suspended_cause = NULL WHERE id = ?").run(c.id);
        alsoOpened.push(c.display_name);
      }
    }
    adminLog(req, "åpnet", `${u.role === "child" ? "barn" : "foresatt"} ${u.display_name} (${u.id})`, alsoOpened.length ? `også åpnet: ${alsoOpened.join(", ")}` : "");
    res.json({ ok: true, alsoOpened });
  });

  app.get("/api/admin/log", admin, (req, res) => {
    res.json({
      log: q(`SELECT l.action, l.target, l.detail, l.created_at AS createdAt, u.display_name AS admin FROM admin_log l
        LEFT JOIN users u ON u.id = l.admin_id ORDER BY l.id DESC LIMIT 100`).all(),
    });
  });

  // Sletter det vi ikke trenger lenger (se lagringstidene på /personvern):
  // utløpte innlogginger og lenker, skjermtid eldre enn 30 dager, og innlegg som en voksen fjernet for over 30 dager siden.
  function cleanup() {
    const t = now();
    recordDailyStats();
    q("DELETE FROM sessions WHERE expires_at < ?").run(t);
    sweepFailures();
    q("DELETE FROM password_resets WHERE expires_at < ?").run(t);
    q("DELETE FROM email_verifications WHERE expires_at < ?").run(t);
    q("DELETE FROM parent_invites WHERE expires_at < ?").run(t);
    q("DELETE FROM child_shares WHERE expires_at < ?").run(t);
    const cutoff = clock(t - CLEANUP_DAYS * 864e5).day;
    q("DELETE FROM usage WHERE day < ?").run(cutoff);
    q("DELETE FROM posts WHERE status = 'removed' AND hold = 0 AND created_at < ?").run(t - CLEANUP_DAYS * 864e5);
    // Unntak: innlegg som er bevart som dokumentasjon, eller som er meldt og ikke ferdig behandlet.
    q(`DELETE FROM posts WHERE created_at < ? AND hold = 0
      AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.post_id = posts.id AND r.resolved = 0)`).run(t - KEEP_DAYS * 864e5);
    q("DELETE FROM adult_messages WHERE created_at < ?").run(t - KEEP_DAYS * 864e5);
    const yearAgo = t - ADMIN_RETENTION_DAYS * 864e5;
    q("DELETE FROM admin_log WHERE created_at < ?").run(yearAgo);
    q("DELETE FROM incidents WHERE acked_at IS NOT NULL AND acked_at < ?").run(yearAgo); // varslene slettes med saken
    q("DELETE FROM safety_reports WHERE resolved_at IS NOT NULL AND resolved_at < ?").run(yearAgo);
    sweepMedia();
  }
  app.locals.cleanup = cleanup;

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
    const allowed = post.author_id === req.user.id
      || !!q("SELECT 1 FROM guardians WHERE child_id = ? AND parent_id = ?").get(post.author_id, req.user.id);
    if (!allowed) fail(403, "Ikke tilgang");
    // Et innlegg noen har sagt fra om, slettes ikke med en gang: det skjules og ryddes bort etter 30 dager,
    // så den som vurderer saken, fortsatt kan se det (og administrator kan bevare det).
    if (post.hold || q("SELECT 1 FROM reports WHERE post_id = ?").get(post.id)) q("UPDATE posts SET status = 'removed' WHERE id = ?").run(post.id);
    else q("DELETE FROM posts WHERE id = ?").run(post.id);
    sweepMedia();
    res.json({ ok: true });
  });

  // Si fra: innlegget skjules med en gang og venter på at gruppas voksne ser på det.
  app.post("/api/posts/:id/report", needUser("child"), async (req, res) => {
    const post = q(`SELECT p.* FROM posts p JOIN memberships m ON m.group_id = p.group_id AND m.user_id = ? AND m.approved = 1
      WHERE p.id = ?`).get(req.user.id, req.params.id);
    if (!post) fail(404, "Fant ikke innlegget");
    const category = Object.hasOwn(REPORT_CATEGORIES, req.body.category) ? req.body.category : "annet";
    if (!q("SELECT 1 FROM reports WHERE post_id = ? AND reporter_id = ?").get(post.id, req.user.id)) {
      q("INSERT INTO reports (post_id, reporter_id, category, created_at) VALUES (?, ?, ?, ?)").run(post.id, req.user.id, category, now());
    }
    if (REPORT_CATEGORIES[category].serious) await openIncident("post", post.id, category);
    if (post.status === "visible") q("UPDATE posts SET status = 'hidden' WHERE id = ?").run(post.id);
    res.json({ ok: true });
  });

  // Barnet sier fra om noe direkte til dem som drifter quipu, utenom gruppa og foresatte.
  // Brukes når problemet ikke står i et innlegg, eller gjelder en voksen.
  app.post("/api/safety", needUser("child"), async (req, res) => {
    const category = Object.hasOwn(REPORT_CATEGORIES, req.body.category) ? req.body.category : "annet";
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (text.length < 3 || text.length > 1000) fail(400, "Skriv litt om hva som har skjedd (3–1000 tegn)");
    const recent = q("SELECT COUNT(*) AS n FROM safety_reports WHERE reporter_id = ? AND created_at > ?").get(req.user.id, now() - 864e5).n;
    if (recent >= 5) fail(429, "Du har sagt fra mange ganger i dag. Snakk med en voksen du stoler på, eller ring Alarmtelefonen for barn og unge på 116 111.");
    const { lastInsertRowid } = q("INSERT INTO safety_reports (reporter_id, category, text, created_at) VALUES (?, ?, ?, ?)").run(req.user.id, category, text, now());
    if (REPORT_CATEGORIES[category].serious) await openIncident("safety", lastInsertRowid, category);
    res.status(201).json({ ok: true });
  });

  // ---------- Foresatte: barn ----------
  const ownChild = (req) => {
    const c = q(`SELECT u.* FROM users u JOIN guardians gd ON gd.child_id = u.id AND gd.parent_id = ?
      WHERE u.id = ? AND u.role = 'child'`).get(req.user.id, req.params.id ?? req.body.childId);
    if (!c) fail(404, "Fant ikke barnet");
    return c;
  };
  const guardiansOf = (childId) => q(`SELECT u.id, u.display_name, u.email FROM guardians gd JOIN users u ON u.id = gd.parent_id
    WHERE gd.child_id = ? ORDER BY gd.created_at, u.id`).all(childId);

  app.get("/api/children", parent, (req, res) => {
    const children = q(`SELECT u.* FROM users u JOIN guardians gd ON gd.child_id = u.id AND gd.parent_id = ?
      ORDER BY u.display_name`).all(req.user.id);
    res.json({
      children: children.map((c) => ({
        ...childSettings(c),
        status: childStatus(c),
        // Alle foresatte har samme tilgang. Den innloggede står med «me».
        guardians: guardiansOf(c.id).map((g) => ({ id: g.id, displayName: g.display_name, email: g.email, me: g.id === req.user.id })),
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
    const { lastInsertRowid } = q(`INSERT INTO users (username, password_hash, role, display_name, avatar, parent_id, posts_per_day, created_at)
      VALUES (?, ?, 'child', ?, ?, ?, 5, ?)`).run(username, hashPassword(password), displayName, avatar, req.user.id, now());
    q("INSERT INTO guardians (child_id, parent_id, created_at) VALUES (?, ?, ?)").run(lastInsertRowid, req.user.id, now());
    res.status(201).json({ ok: true });
  });

  app.patch("/api/children/:id", parent, async (req, res) => {
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
    // De andre foresatte får vite hva som ble endret, og av hvem.
    const changes = [
      next.daily_minutes !== c.daily_minutes && `skjermtid fra ${c.daily_minutes} til ${next.daily_minutes} minutter per dag`,
      (next.open_from !== c.open_from || next.open_to !== c.open_to) && `åpningstid fra ${c.open_from}–${c.open_to} til ${next.open_from}–${next.open_to}`,
      next.posts_per_day !== c.posts_per_day && `innlegg per dag fra ${c.posts_per_day} til ${next.posts_per_day}`,
      next.display_name !== c.display_name && `navn fra ${c.display_name} til ${next.display_name}`,
      b.password !== undefined && `nytt passord (${next.display_name} ble logget ut)`,
    ].filter(Boolean);
    if (changes.length) {
      for (const g of guardiansOf(c.id).filter((x) => x.id !== req.user.id && x.email)) {
        await notifyAccount(g.email, `${req.user.display_name} endret innstillingene for ${next.display_name}`, `Endringer for ${next.display_name}`,
          [`${req.user.display_name} endret dette for ${next.display_name} i ${APP_NAME} ${when(now())}:`, ...changes.map((x) => `– ${x[0].toUpperCase()}${x.slice(1)}.`)]);
      }
    }
    res.json({ ok: true });
  });

  // Barnekontoen kan bare slettes når det er én foresatt igjen. Ellers må de andre først fjerne seg selv.
  app.delete("/api/children/:id", parent, (req, res) => {
    const c = ownChild(req);
    if (guardiansOf(c.id).length > 1) fail(409, "Barnet har flere foresatte. Kontoen kan bare slettes når du er den eneste. De andre kan fjerne seg selv.");
    q("DELETE FROM users WHERE id = ?").run(c.id);
    sweepMedia();
    res.json({ ok: true });
  });

  // Fjern seg selv som foresatt. Ingen kan fjerne andre foresatte.
  function leaveChild(childId, parentId) {
    const others = guardiansOf(childId).filter((g) => g.id !== parentId);
    if (!others.length) fail(409, "Du er den eneste foresatte. Slett barnekontoen i stedet.");
    q("DELETE FROM guardians WHERE child_id = ? AND parent_id = ?").run(childId, parentId);
    // users.parent_id peker på en som fortsatt er foresatt (og slettes ikke med kontoen til den som gikk).
    q("UPDATE users SET parent_id = ? WHERE id = ? AND parent_id = ?").run(others[0].id, childId, parentId);
  }
  app.post("/api/children/:id/leave", parent, (req, res) => {
    leaveChild(ownChild(req).id, req.user.id);
    res.json({ ok: true });
  });

  // ---------- Dele et barn med en annen foresatt ----------
  const findShare = (token) => typeof token === "string" && /^[0-9a-f]{64}$/.test(token)
    ? q(`SELECT s.*, u.display_name AS inviter_name, c.display_name AS child_name FROM child_shares s
        JOIN users u ON u.id = s.inviter_id JOIN users c ON c.id = s.child_id
        WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(token), now())
    : undefined;
  const SHARE_GONE = "Lenken er brukt eller har gått ut. Be den andre foresatte om en ny.";

  // Gir en foresatt tilgang til barnet og sier fra til de andre foresatte på e-post.
  async function addGuardian(share, parentUser) {
    const before = guardiansOf(share.child_id);
    q("DELETE FROM child_shares WHERE token_hash = ?").run(share.token_hash);
    if (before.some((g) => g.id === parentUser.id)) return;
    q("INSERT INTO guardians (child_id, parent_id, created_at) VALUES (?, ?, ?)").run(share.child_id, parentUser.id, now());
    for (const g of before.filter((x) => x.email)) {
      try {
        await mailer.send({
          to: g.email,
          subject: `${parentUser.display_name} er nå foresatt for ${share.child_name} i ${APP_NAME}`,
          ...renderEmail({
            preheader: "Sjekk at det stemmer.",
            heading: `${parentUser.display_name} har fått tilgang til ${share.child_name}`,
            paragraphs: [
              `${parentUser.display_name} (${parentUser.email}) brukte en delingslenke fra ${share.inviter_name} og er nå foresatt for ${share.child_name} i ${APP_NAME}, med samme tilgang som deg.`,
              `Stemmer ikke dette, skriv til ${CONTACT_EMAIL} med en gang.`,
            ],
            button: { label: `Åpne ${APP_NAME}`, url: appUrl },
          }),
        });
      } catch (err) {
        console.error("Klarte ikke å sende e-post:", err.message);
      }
    }
  }

  app.post("/api/children/:id/share", parent, async (req, res) => {
    const c = ownChild(req);
    const email = req.body.email ? String(req.body.email).trim().toLowerCase() : null;
    if (email && !EMAIL.test(email)) fail(400, "Skriv inn en gyldig e-postadresse");
    if (email && email === req.user.email) fail(400, "Det er din egen adresse");
    if (email && isBanned(email)) fail(403, `Denne e-postadressen kan ikke brukes i ${APP_NAME}.`);
    const recent = q("SELECT COUNT(*) AS n FROM child_shares WHERE inviter_id = ? AND created_at > ?").get(req.user.id, now() - 864e5).n;
    if (recent >= SHARES_PER_DAY) fail(429, `Du kan lage ${SHARES_PER_DAY} delingslenker i døgnet. Prøv igjen i morgen.`);
    const token = randomBytes(32).toString("hex");
    q("INSERT INTO child_shares (token_hash, child_id, inviter_id, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(sha256(token), c.id, req.user.id, email, now(), now() + SHARE_DAYS * 864e5);
    const url = `${appUrl.replace(/\/$/, "")}/#barn=${token}`;
    let status = null;
    if (email) {
      const existing = q("SELECT 1 FROM users WHERE email = ? AND role = 'parent'").get(email);
      try {
        await mailer.send({
          to: email,
          subject: `${req.user.display_name} vil dele ${c.display_name} med deg i ${APP_NAME}`,
          ...renderEmail({
            preheader: `Bli foresatt for ${c.display_name} i ${APP_NAME}.`,
            heading: `Bli foresatt for ${c.display_name}`,
            paragraphs: [
              `${req.user.display_name} (${req.user.email}) vil at du også skal være foresatt for ${c.display_name} i ${APP_NAME}. Da ser du det samme som ${req.user.display_name}: innleggene, gruppene og grensene, og dere kan begge endre dem.`,
              existing ? "Trykk på knappen og logg inn med kontoen din." : "Trykk på knappen og lag en foresatt-konto. Du trenger ingen registreringskode.",
            ],
            button: { label: "Bli foresatt", url },
            note: `Lenken virker i ${SHARE_DAYS} dager og kan brukes én gang. Kjenner du ikke ${req.user.display_name}, kan du se bort fra denne e-posten.`,
          }),
        });
        status = mailer.configured === false ? "not_sent" : "sent";
      } catch (err) {
        console.error("Klarte ikke å sende e-post:", err.message);
        status = "not_sent";
      }
    }
    res.status(201).json({ url, status });
  });

  // Lenken viser hvem som deler hvilket barn. Krever ikke innlogging, så den kan åpnes før man har konto.
  app.get("/api/shares/:token", (req, res) => {
    const share = findShare(req.params.token);
    if (!share) fail(404, SHARE_GONE);
    res.json({ inviter: share.inviter_name, child: share.child_name, email: share.email || "" });
  });

  app.post("/api/shares/:token/accept", parentAny, async (req, res) => {
    const share = findShare(req.params.token);
    if (!share) fail(404, SHARE_GONE);
    await addGuardian(share, req.user);
    res.json({ ok: true, child: share.child_name });
  });

  // ---------- Foresatte: grupper ----------
  // En foresatt kan se en gruppe hvis hen eier den, eller har et barn som er med.
  const visibleGroup = (userId, groupId) => q(`SELECT g.*, (g.owner_id = ?) AS isOwner FROM groups g
    WHERE g.id = ? AND (g.owner_id = ? OR EXISTS (
      SELECT 1 FROM memberships m JOIN guardians gd ON gd.child_id = m.user_id WHERE m.group_id = g.id AND m.approved = 1 AND gd.parent_id = ?))`)
    .get(userId, groupId, userId, userId);

  app.get("/api/groups", parent, (req, res) => {
    const groups = q(`SELECT DISTINCT g.* FROM groups g LEFT JOIN memberships m ON m.group_id = g.id AND m.approved = 1
      LEFT JOIN guardians gd ON gd.child_id = m.user_id
      WHERE g.owner_id = ? OR gd.parent_id = ? ORDER BY g.name`).all(req.user.id, req.user.id);
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
          members: q(`SELECT u.id, u.display_name AS displayName, u.avatar FROM memberships m JOIN users u ON u.id = m.user_id
            WHERE m.group_id = ? AND m.approved = 1 ORDER BY u.display_name`).all(g.id).map((m) => (isOwner ? m : { displayName: m.displayName, avatar: m.avatar })),
          // Eieren ser hvem som vil inn, og hvilken foresatt som spør, så hen kan sjekke at det er en fra klassen.
          pendingMembers: isOwner ? q(`SELECT u.id, u.display_name AS displayName, u.avatar FROM memberships m JOIN users u ON u.id = m.user_id
            WHERE m.group_id = ? AND m.approved = 0 ORDER BY u.display_name`).all(g.id).map((m) => {
            const gs = guardiansOf(m.id);
            return { ...m, parentName: gs.map((x) => x.display_name).join(" og "), parentEmail: gs.map((x) => x.email).filter(Boolean).join(", ") };
          }) : undefined,
          openReports: isOwner ? q(`SELECT COUNT(DISTINCT r.post_id) AS n FROM reports r JOIN posts p ON p.id = r.post_id
            WHERE p.group_id = ? AND r.resolved = 0`).get(g.id).n : undefined,
          // Voksenkontakten finnes for eieren og foresatte med godkjente barn i gruppa.
          adultUnread: canTalk(req.user.id, g) ? unreadAdult(req.user.id, g.id) : undefined,
        };
      }),
      // Grupper den foresatte er invitert til. Barna kan meldes inn uten invitasjonskode.
      invitations: q(`SELECT g.id, g.name, u.display_name AS inviter FROM group_invitations i JOIN groups g ON g.id = i.group_id
        LEFT JOIN users u ON u.id = i.inviter_id WHERE i.user_id = ? ORDER BY g.name`).all(req.user.id),
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
    // Med koden, eller med en invitasjon til gruppa (da trengs ingen kode).
    const invitation = req.body.groupId !== undefined
      ? q("SELECT * FROM group_invitations WHERE user_id = ? AND group_id = ?").get(req.user.id, req.body.groupId)
      : undefined;
    if (req.body.groupId !== undefined && !invitation) fail(404, "Fant ingen invitasjon til den gruppa");
    const g = invitation
      ? q("SELECT * FROM groups WHERE id = ?").get(invitation.group_id)
      : q("SELECT * FROM groups WHERE invite_code = ?").get(String(req.body.code || "").trim().toUpperCase());
    if (!g) fail(404, "Fant ingen gruppe med den koden");
    const existing = q("SELECT approved FROM memberships WHERE group_id = ? AND user_id = ?").get(g.id, c.id);
    if (existing) return res.json({ ok: true, pending: !existing.approved });
    const approved = g.owner_id === req.user.id || invitation?.auto_approve ? 1 : 0;
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

  // Ny invitasjonskode for gruppa. Den gamle slutter å virke med en gang (for eksempel hvis den er spredt).
  app.post("/api/groups/:groupId/code", parent, (req, res) => {
    const g = q("SELECT id FROM groups WHERE id = ? AND owner_id = ?").get(req.params.groupId, req.user.id);
    if (!g) fail(404, "Fant ikke gruppa");
    const code = randomBytes(5).toString("hex").toUpperCase();
    q("UPDATE groups SET invite_code = ? WHERE id = ?").run(code, g.id);
    res.json({ inviteCode: code });
  });

  // Eieren godkjenner eller avslår et barn som venter på å bli med.
  app.post("/api/groups/:groupId/members/:userId", parent, async (req, res) => {
    const g = q("SELECT id FROM groups WHERE id = ? AND owner_id = ?").get(req.params.groupId, req.user.id);
    if (!g) fail(404, "Fant ikke gruppa");
    const action = req.body.action;
    if (action === "remove") {
      // Eieren tar et godkjent barn ut av gruppa. Barnet mister tilgangen med en gang, og foresatte får beskjed.
      const { changes } = q("DELETE FROM memberships WHERE group_id = ? AND user_id = ? AND approved = 1").run(g.id, req.params.userId);
      if (!changes) fail(404, "Fant ikke barnet i gruppa");
      const kid = q("SELECT display_name FROM users WHERE id = ?").get(req.params.userId);
      const name = q("SELECT name FROM groups WHERE id = ?").get(g.id).name;
      for (const p of guardiansOf(Number(req.params.userId)).filter((x) => x.email)) {
        await notifyAccount(p.email, `${kid.display_name} er tatt ut av ${name}`, `${kid.display_name} er tatt ut av ${name}`,
          [`${req.user.display_name}, som eier gruppa ${name} i ${APP_NAME}, tok ${kid.display_name} ut av gruppa ${when(now())}. ${kid.display_name} ser ikke gruppa lenger.`,
            `Lurer du på hvorfor, kan du skrive i voksenkontakten i en annen gruppe, eller kontakte ${req.user.display_name}.`]);
      }
      return res.json({ ok: true });
    }
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
        EXISTS (SELECT 1 FROM guardians gd WHERE gd.child_id = u.id AND gd.parent_id = ?) AS byMyChild
      ${POST_JOINS}
      WHERE p.group_id = ? AND (p.status = 'visible' OR (? AND p.status = 'hidden'))
        AND (md.id IS NULL OR md.approved = 1 OR ? OR EXISTS (SELECT 1 FROM guardians gd WHERE gd.child_id = u.id AND gd.parent_id = ?))
      ORDER BY (p.status = 'hidden') DESC, (md.approved = 0) DESC, p.created_at DESC LIMIT 100`)
      .all(req.user.id, g.id, g.isOwner ? 1 : 0, g.isOwner ? 1 : 0, req.user.id);
    res.json({ isOwner: !!g.isOwner, posts: posts.map((p) => withMedia({ ...p, byMyChild: !!p.byMyChild })) });
  });

  // Samme som for barna: antall nye innlegg i gruppa siden innlegget med id «since», med de samme
  // reglene for hva den foresatte får se.
  app.get("/api/groups/:groupId/posts/new", parent, (req, res) => {
    const g = visibleGroup(req.user.id, req.params.groupId);
    if (!g) fail(404, "Fant ikke gruppa");
    const since = Number(req.query.since) || 0;
    const { n } = q(`SELECT COUNT(*) AS n ${POST_JOINS}
      WHERE p.group_id = ? AND p.id > ? AND (p.status = 'visible' OR (? AND p.status = 'hidden'))
        AND (md.id IS NULL OR md.approved = 1 OR ? OR EXISTS (SELECT 1 FROM guardians gd WHERE gd.child_id = u.id AND gd.parent_id = ?))`)
      .get(g.id, since, g.isOwner ? 1 : 0, g.isOwner ? 1 : 0, req.user.id);
    res.json({ count: n });
  });

  // ---------- Voksenkontakt ----------
  // Meldinger mellom foresatte i en gruppe: eieren og foresatte med et godkjent barn i gruppa. Barna ser det aldri.
  const canTalk = (userId, g) => g.owner_id === userId || !!q(`SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ? AND m.approved = 1 AND EXISTS (SELECT 1 FROM guardians gd WHERE gd.child_id = u.id AND gd.parent_id = ?)`).get(g.id, userId);
  const unreadAdult = (userId, groupId) => q(`SELECT COUNT(*) AS n FROM adult_messages
    WHERE group_id = ? AND author_id != ? AND id > COALESCE((SELECT last_id FROM adult_reads WHERE group_id = ? AND user_id = ?), 0)`)
    .get(groupId, userId, groupId, userId).n;
  function adultGroup(req) {
    const g = q("SELECT * FROM groups WHERE id = ?").get(req.params.groupId);
    if (!g || !canTalk(req.user.id, g)) fail(404, "Fant ikke gruppa");
    return g;
  }

  app.get("/api/groups/:groupId/adult", parent, (req, res) => {
    const g = adultGroup(req);
    const messages = q(`SELECT m.id, m.text, m.created_at AS createdAt, u.display_name AS author, u.avatar,
        (m.author_id = ?) AS mine, md.id AS imageId
      FROM adult_messages m JOIN users u ON u.id = m.author_id LEFT JOIN media md ON md.adult_message_id = m.id
      WHERE m.group_id = ? ORDER BY m.id DESC LIMIT 200`).all(req.user.id, g.id);
    // Å åpne voksenkontakten betyr at man har lest alt.
    const last = messages[0]?.id || 0;
    q(`INSERT INTO adult_reads (group_id, user_id, last_id) VALUES (?, ?, ?)
      ON CONFLICT (group_id, user_id) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)`).run(g.id, req.user.id, last);
    res.json({
      group: { id: g.id, name: g.name, isOwner: g.owner_id === req.user.id },
      messages: messages.map((m) => ({ ...m, mine: !!m.mine, canDelete: !!m.mine || g.owner_id === req.user.id })),
    });
  });

  app.post("/api/groups/:groupId/adult", parent, async (req, res) => {
    const g = adultGroup(req);
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    const { mediaId } = req.body;
    const image = mediaId !== undefined && mediaId !== null && q(`SELECT id FROM media
      WHERE id = ? AND owner_id = ? AND type = 'image' AND post_id IS NULL AND adult_message_id IS NULL`).get(String(mediaId), req.user.id);
    if (mediaId && !image) fail(400, "Fant ikke bildet. Prøv å legge det til på nytt.");
    if (text.length > 1000) fail(400, "Meldingen kan ha maks 1000 tegn");
    if (!text && !image) fail(400, "Skriv en beskjed eller legg ved et bilde");
    const { lastInsertRowid } = q("INSERT INTO adult_messages (group_id, author_id, text, created_at) VALUES (?, ?, ?, ?)")
      .run(g.id, req.user.id, text, now());
    if (image) q("UPDATE media SET adult_message_id = ?, approved = 1 WHERE id = ?").run(lastInsertRowid, image.id);
    await pushAdultMessage(g, req.user, text || "📷 Bilde");
    res.status(201).json({ ok: true });
  });

  // ---------- Varsler om nye beskjeder i voksenkontakten ----------
  // Hver foresatt velger selv: e-post (av, kort tid etter, eller én gang om dagen) og push-varsel per enhet.
  const NOTIFY_EMAIL = ["off", "soon", "daily"];
  const SOON_MINUTES = 10; // vent litt, så flere beskjeder havner i samme e-post
  const DAILY_AT = "18:00";

  // Foresatte som har tilgang til voksenkontakten i gruppa (eieren og foresatte med godkjente barn).
  const adultsInGroup = (g) => q(`SELECT u.* FROM users u WHERE u.role = 'parent' AND (u.id = ? OR EXISTS (
      SELECT 1 FROM memberships m JOIN guardians gd ON gd.child_id = m.user_id WHERE m.group_id = ? AND m.approved = 1 AND gd.parent_id = u.id))`)
    .all(g.owner_id, g.id);

  async function pushAdultMessage(g, author, text) {
    const message = {
      title: `Ny beskjed i ${g.name}`,
      body: `${author.display_name}: ${text.length > 120 ? `${text.slice(0, 119)}…` : text}`,
      url: `/#voksen=${g.id}`,
      tag: `voksen-${g.id}`,
      topic: `voksen-${g.id}`,
    };
    const subs = adultsInGroup(g).filter((u) => u.id !== author.id)
      .flatMap((u) => q("SELECT * FROM push_subscriptions WHERE user_id = ?").all(u.id));
    await Promise.all(subs.map(async (sub) => {
      try {
        const { gone } = await pushSender.send(sub, message);
        if (gone) q("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
      } catch (err) {
        console.error("Klarte ikke å sende push-varsel:", err.message);
      }
    }));
  }

  // Kjøres jevnlig (se index.js): sender e-post om beskjeder den foresatte ikke har lest eller fått e-post om.
  async function emailAdultMessages() {
    const { day, hm } = clock();
    const parents = q("SELECT * FROM users WHERE role = 'parent' AND email_verified = 1 AND notify_email != 'off'").all();
    for (const p of parents) {
      if (p.notify_email === "daily" && (hm < DAILY_AT || p.notify_daily_day === day)) continue;
      const groups = q(`SELECT g.* FROM groups g WHERE g.owner_id = ? OR EXISTS (SELECT 1 FROM memberships m JOIN guardians gd ON gd.child_id = m.user_id
        WHERE m.group_id = g.id AND m.approved = 1 AND gd.parent_id = ?) ORDER BY g.name`).all(p.id, p.id);
      const sections = groups.map((g) => {
        const r = q("SELECT last_id, notified_id FROM adult_reads WHERE group_id = ? AND user_id = ?").get(g.id, p.id);
        const since = Math.max(r?.last_id || 0, r?.notified_id || 0);
        const messages = q(`SELECT m.id, m.text, m.created_at, u.display_name AS author FROM adult_messages m JOIN users u ON u.id = m.author_id
          WHERE m.group_id = ? AND m.id > ? AND m.author_id != ? ORDER BY m.id`).all(g.id, since, p.id);
        return { g, messages };
      }).filter((s) => s.messages.length);
      if (p.notify_email === "daily") q("UPDATE users SET notify_daily_day = ? WHERE id = ?").run(day, p.id);
      if (!sections.length) continue;
      const oldest = Math.min(...sections.flatMap((s) => s.messages.map((m) => m.created_at)));
      if (p.notify_email === "soon" && now() - oldest < SOON_MINUTES * 60e3) continue;

      const total = sections.reduce((n, s) => n + s.messages.length, 0);
      const lines = sections.flatMap(({ g, messages }) => messages.slice(-5).map((m) =>
        `${m.author} i ${g.name}: ${!m.text ? "📷 Bilde" : `«${m.text.length > 200 ? `${m.text.slice(0, 199)}…` : m.text}»`}`));
      if (total > lines.length) lines.push(`… og ${total - lines.length} til.`);
      try {
        await mailer.send({
          to: p.email,
          subject: total === 1 ? `Ny beskjed i voksenkontakten i ${APP_NAME}` : `${total} nye beskjeder i voksenkontakten i ${APP_NAME}`,
          ...renderEmail({
            preheader: lines[0],
            heading: total === 1 ? "Ny beskjed fra de andre foresatte" : `${total} nye beskjeder fra de andre foresatte`,
            paragraphs: lines,
            button: { label: "Åpne voksenkontakten", url: `${appUrl.replace(/\/$/, "")}/#voksen=${sections[0].g.id}` },
            note: "Du får denne e-posten fordi du har slått på e-post om beskjeder i voksenkontakten. Du kan endre det under Konto i quipu.",
          }),
        });
      } catch (err) {
        console.error("Klarte ikke å sende e-post:", err.message);
        continue;
      }
      for (const { g, messages } of sections) {
        q(`INSERT INTO adult_reads (group_id, user_id, last_id, notified_id) VALUES (?, ?, 0, ?)
          ON CONFLICT (group_id, user_id) DO UPDATE SET notified_id = MAX(notified_id, excluded.notified_id)`).run(g.id, p.id, messages.at(-1).id);
      }
    }
  }
  app.locals.emailAdultMessages = emailAdultMessages;

  app.get("/api/notify", parentAny, (req, res) => {
    res.json({ email: req.user.notify_email, pushKey: vapidKeys().publicKey });
  });

  app.patch("/api/notify", parentAny, (req, res) => {
    if (!NOTIFY_EMAIL.includes(req.body.email)) fail(400, "Ugyldig valg");
    q("UPDATE users SET notify_email = ? WHERE id = ?").run(req.body.email, req.user.id);
    res.json({ ok: true });
  });

  // Push-abonnement for denne enheten. Endepunktet er en adresse hos Apple, Google eller Mozilla.
  app.post("/api/push/subscribe", parentAny, (req, res) => {
    const { endpoint, keys } = req.body;
    let url;
    try { url = new URL(endpoint); } catch { fail(400, "Ugyldig abonnement"); }
    if (url.protocol !== "https:" || endpoint.length > 1000 || !/^[\w-]{80,100}$/.test(keys?.p256dh || "") || !/^[\w-]{16,32}$/.test(keys?.auth || "")) {
      fail(400, "Ugyldig abonnement");
    }
    q(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
      .run(req.user.id, endpoint, keys.p256dh, keys.auth, now());
    res.status(201).json({ ok: true });
  });

  app.post("/api/push/unsubscribe", parentAny, (req, res) => {
    q("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").run(String(req.body.endpoint || ""), req.user.id);
    res.json({ ok: true });
  });

  app.get("/api/groups/:groupId/adult/new", parent, (req, res) => {
    const g = adultGroup(req);
    const since = Number(req.query.since) || 0;
    const { n } = q("SELECT COUNT(*) AS n FROM adult_messages WHERE group_id = ? AND id > ? AND author_id != ?").get(g.id, since, req.user.id);
    res.json({ count: n });
  });

  // Egne meldinger kan slettes, og eieren av gruppa kan slette alle.
  app.delete("/api/adult/:id", parent, (req, res) => {
    const m = q(`SELECT m.id FROM adult_messages m JOIN groups g ON g.id = m.group_id
      WHERE m.id = ? AND (m.author_id = ? OR g.owner_id = ?)`).get(req.params.id, req.user.id, req.user.id);
    if (!m) fail(404, "Fant ikke meldingen");
    q("DELETE FROM adult_messages WHERE id = ?").run(m.id);
    sweepMedia();
    res.json({ ok: true });
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
