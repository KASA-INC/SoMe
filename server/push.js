import { createECDH, createPrivateKey, createCipheriv, hkdfSync, randomBytes, sign } from "node:crypto";
import { CONTACT_EMAIL } from "./config.js";

// Push-varsler (Web Push) uten eksterne pakker:
// - VAPID (RFC 8292): serveren signerer hver forespørsel, så push-tjenesten vet at varselet kommer fra quiply.
// - Kryptering (RFC 8291, aes128gcm): innholdet krypteres for den enkelte enheten. Apple, Google og Mozilla,
//   som leverer varslene, ser bare at et varsel sendes, ikke hva det står i det.

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const fromB64url = (s) => Buffer.from(s, "base64url");

// Nøkkelpar for VAPID (P-256). Lages én gang og lagres i databasen.
export function createVapidKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

function vapidPrivateKey({ publicKey, privateKey }) {
  const pub = fromB64url(publicKey);
  return createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: privateKey, x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) },
    format: "jwk",
  });
}

// Authorization-headeren: en kortlivet JWT signert med ES256, pluss den offentlige nøkkelen.
export function vapidHeader(endpoint, keys, now = Date.now()) {
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64url(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: `mailto:${CONTACT_EMAIL}`,
  }));
  const data = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(data), { key: vapidPrivateKey(keys), dsaEncoding: "ieee-p1363" });
  return `vapid t=${data}.${b64url(signature)}, k=${keys.publicKey}`;
}

// Krypterer innholdet for én enhet (abonnementets p256dh- og auth-nøkler).
export function encryptPayload(payload, { p256dh, auth }) {
  const uaPublic = fromB64url(p256dh);
  const authSecret = fromB64url(auth);
  const ecdh = createECDH("prime256v1");
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = randomBytes(16);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02 markerer siste (og eneste) blokk.
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

// Sender ett varsel. Svarer { gone: true } når abonnementet ikke finnes lenger (appen er fjernet o.l.).
export function createPushSender(getKeys) {
  return {
    async send(subscription, message) {
      const res = await fetch(subscription.endpoint, {
        method: "POST",
        headers: {
          Authorization: vapidHeader(subscription.endpoint, getKeys()),
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: "86400",
          Urgency: "normal",
          // Nye varsler for samme gruppe erstatter det forrige hos push-tjenesten, så de ikke hoper seg opp.
          ...(message.topic ? { Topic: message.topic } : {}),
        },
        body: encryptPayload(JSON.stringify(message), subscription),
      });
      if (res.status === 404 || res.status === 410) return { gone: true };
      if (!res.ok) throw new Error(`Push feilet: ${res.status}`);
      return { gone: false };
    },
  };
}
