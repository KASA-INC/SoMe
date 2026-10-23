import { createHmac, randomBytes } from "node:crypto";

// Engangskoder etter RFC 6238 (TOTP), slik Google Authenticator, Microsoft Authenticator,
// 1Password og iPhones innebygde passordapp lager dem: 6 sifre, 30 sekunder, HMAC-SHA1.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP = 30;

export function base32(buf) {
  let bits = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}

function fromBase32(text) {
  let bits = "";
  for (const ch of text.replace(/[\s=]/g, "").toUpperCase()) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error("Ugyldig nøkkel");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export const newSecret = () => base32(randomBytes(20));

export function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", fromBase32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const n = (mac.readUInt32BE(offset) & 0x7fffffff) % 1e6;
  return String(n).padStart(6, "0");
}

// Godtar koden for nå og ett steg før og etter (klokker går litt ulikt). Returnerer steget, eller null.
// En kode som allerede er brukt (steg ≤ lastStep), godtas ikke igjen.
export function verifyCode(secret, code, now = Date.now(), lastStep = 0) {
  const clean = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const current = Math.floor(now / 1000 / STEP);
  for (const step of [current - 1, current, current + 1]) {
    if (step > lastStep && codeAt(secret, step) === clean) return step;
  }
  return null;
}

export const otpauthUri = (secret, account, issuer) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;
