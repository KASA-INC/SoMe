import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";

const SESSION_DAYS = 30;
export const COOKIE = "some_session";

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(":");
  const hash = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  return timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
}

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// device: kort beskrivelse av enheten (for eksempel «iPhone · Safari»), så foresatte kan se innloggingene sine.
export function createSession(db, userId, { days = SESSION_DAYS, device = "", now = Date.now() } = {}) {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_seen, device) VALUES (?, ?, ?, ?, ?, ?)")
    .run(sha256(token), userId, now + days * 864e5, now, now, device);
  return token;
}

export function destroySession(db, token) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

export function userFromToken(db, token) {
  if (!token) return null;
  return db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(token), Date.now()) || null;
}

export function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function sessionCookie(token, secure, days = SESSION_DAYS) {
  const maxAge = token ? days * 86400 : 0;
  return `${COOKIE}=${token || ""}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

// Bremse mot gjetting av passord og misbruk: 5 feil per nøkkel (for eksempel brukernavn + IP) per 15 minutter.
// Lagres i databasen, så den gjelder også etter omstart og ny versjon. Nøkkelen lagres bare som hash,
// så tabellen inneholder ingen IP-adresser eller e-postadresser.
const WINDOW = 15 * 60 * 1000;
const MAX_FAILURES = 5;

export function createLimiter(db, now = Date.now) {
  const get = (key) => db.prepare("SELECT first, count FROM login_failures WHERE key_hash = ?").get(sha256(key));
  return {
    tooManyAttempts(key) {
      const entry = get(key);
      return !!entry && now() - entry.first <= WINDOW && entry.count >= MAX_FAILURES;
    },
    recordFailure(key) {
      const entry = get(key);
      if (!entry || now() - entry.first > WINDOW) {
        db.prepare("INSERT OR REPLACE INTO login_failures (key_hash, first, count) VALUES (?, ?, 1)").run(sha256(key), now());
      } else {
        db.prepare("UPDATE login_failures SET count = count + 1 WHERE key_hash = ?").run(sha256(key));
      }
    },
    clearFailures(key) {
      db.prepare("DELETE FROM login_failures WHERE key_hash = ?").run(sha256(key));
    },
    sweep() {
      db.prepare("DELETE FROM login_failures WHERE first < ?").run(now() - WINDOW);
    },
  };
}

// Kort, lesbar beskrivelse av enheten fra nettleserens User-Agent. Lagres i stedet for hele teksten.
export function deviceLabel(ua = "") {
  const device = /iPad/.test(ua) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android"
    : /Macintosh|Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Ukjent enhet";
  const browser = /EdgA?\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox|FxiOS/.test(ua) ? "Firefox"
    : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "";
  return browser ? `${device} · ${browser}` : device;
}
