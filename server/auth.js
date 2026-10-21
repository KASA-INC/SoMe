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

export function createSession(db, userId) {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(sha256(token), userId, Date.now() + SESSION_DAYS * 864e5);
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

export function sessionCookie(token, secure) {
  const maxAge = token ? SESSION_DAYS * 86400 : 0;
  return `${COOKIE}=${token || ""}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

// Enkel bremse mot gjetting av passord: 5 feil per brukernavn+IP per 15 minutter.
const failures = new Map();
const WINDOW = 15 * 60 * 1000;

export function tooManyAttempts(key) {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.first > WINDOW) return false;
  return entry.count >= 5;
}

export function recordFailure(key) {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.first > WINDOW) failures.set(key, { first: Date.now(), count: 1 });
  else entry.count++;
}

export function clearFailures(key) {
  failures.delete(key);
}
