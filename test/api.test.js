import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { openDb } from "../server/db.js";
import { createApp } from "../server/app.js";
import { checkText } from "../server/filter.js";
import { createVapidKeys, encryptPayload, vapidHeader } from "../server/push.js";
import { codeAt } from "../server/totp.js";
import { createECDH, createDecipheriv, createPublicKey, hkdfSync, randomBytes, verify } from "node:crypto";

const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url));

// Fast klokke: tirsdag kl. 12:00 i Oslo. Kan flyttes i testene.
let clock = Date.parse("2026-10-20T10:00:00Z");
let server, base;
const mediaDir = mkdtempSync(join(tmpdir(), "some-media-"));
const mediaLimits = { videoSeconds: 30, videoMb: 1, imageMb: 1 };
const outbox = []; // e-poster som appen «sender» i testene
const mailer = { send: async (mail) => { outbox.push(mail); } };
const pushed = []; // push-varsler som appen «sender» i testene
const push = { send: async (subscription, message) => { pushed.push({ endpoint: subscription.endpoint, ...message }); return { gone: subscription.endpoint.endsWith("/borte") }; } };

let app, db;
before(async () => {
  db = openDb();
  app = createApp({ db, push, mediaDir, mediaLimits, now: () => clock, mailer, appUrl: "https://some.example" });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://localhost:${server.address().port}/api`;
});
after(() => {
  server.close();
  rmSync(mediaDir, { recursive: true, force: true });
});

// Liten klient som husker sin egen cookie.
function client() {
  let cookie = "";
  const call = async (path, { method = "GET", body, raw, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        cookie,
        ...(method === "GET" ? {} : raw ? { "X-Upload": "1", "Content-Type": "application/octet-stream" } : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: method === "GET" ? undefined : raw ?? JSON.stringify(body || {}),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const isJson = (res.headers.get("content-type") || "").includes("json");
    return { status: res.status, headers: res.headers, body: isJson ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
  return call;
}

// Åpner den siste bekreftelseslenken som ble «sendt» til adressen.
async function verifyEmail(email) {
  const mail = outbox.findLast((m) => m.to === email && /#verify=/.test(m.text));
  const token = mail.text.match(/#verify=([0-9a-f]{64})/)[1];
  assert.equal((await client()("/email/verify", { method: "POST", body: { token } })).status, 200);
}

async function registerParent(c, email, displayName = "Mamma") {
  assert.equal((await c("/register", { method: "POST", body: { password: "hemmelig123", displayName, email } })).status, 201);
  await verifyEmail(email);
}

async function setupFamily(prefix) {
  const parent = client();
  await registerParent(parent, `${prefix}@example.com`);
  const { body: g } = await parent("/groups", { method: "POST", body: { name: "Klasse 4B" } });
  assert.equal((await parent("/children", { method: "POST", body: { username: `${prefix}-ola`, password: "ola12345", displayName: "Ola", avatar: "c03" } })).status, 201);
  const { body: { children } } = await parent("/children");
  await parent("/groups/join", { method: "POST", body: { code: g.inviteCode, childId: children[0].id } });
  const kid = client();
  assert.equal((await kid("/login", { method: "POST", body: { username: `${prefix}-ola`, password: "ola12345" } })).status, 200);
  const { body: { me } } = await kid("/me");
  return { parent, kid, code: g.inviteCode, childId: children[0].id, groupId: me.groups[0].id };
}

const post = (kid, groupId, text = "Jeg lærte å sykle i dag!", mediaId) =>
  kid("/posts", { method: "POST", body: { groupId, kind: "laerte", text, color: "gul", sticker: "🚲", mediaId } });

const upload = (kid, buf) => kid("/media", { method: "POST", raw: buf });

// JPEG med et EXIF-segment (APP1) som inneholder en "GPS-posisjon".
function jpegWithExif() {
  const jpg = fixture("plain.jpg");
  const payload = Buffer.from("Exif\0\0GPS 59.9139 10.7522");
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.alloc(2), payload]);
  app1.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)]);
}

test("filteret stopper stygge ord og personopplysninger", () => {
  assert.ok(checkText("du er dum"));
  assert.ok(checkText("ring meg på 987 65 432"));
  assert.ok(checkText("mail: ola@example.com"));
  assert.ok(checkText("jeg bor i Storgata 5"));
  assert.ok(checkText("se www.example.com"));
  assert.ok(checkText("legg meg til på snap"));
  assert.equal(checkText("Jeg tegnet en drage i dag"), null);
  assert.equal(checkText("Takk til Emma for hjelpen!"), null);
});

test("man må være logget inn", async () => {
  const anon = client();
  assert.equal((await anon("/feed")).status, 401);
  assert.equal((await anon("/children")).status, 401);
});

test("endringer krever JSON (CSRF-vern)", async () => {
  const res = await fetch(`${base}/login`, { method: "POST", body: "username=a&password=b", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  assert.equal(res.status, 415);
});

test("barn i samme gruppe ser hverandres innlegg, uten reaksjoner eller tall", async () => {
  const a = await setupFamily("a");
  const b = client();
  await registerParent(b, "b-far@example.com", "Pappa");
  await b("/children", { method: "POST", body: { username: "b-kari", password: "kari1234", displayName: "Kari", avatar: "c04" } });
  const { body: { children } } = await b("/children");
  await b("/groups/join", { method: "POST", body: { code: a.code, childId: children[0].id } });
  await a.parent(`/groups/${a.groupId}/members/${children[0].id}`, { method: "POST", body: { action: "approve" } });
  const kari = client();
  await kari("/login", { method: "POST", body: { username: "b-kari", password: "kari1234" } });

  assert.equal((await post(a.kid, a.groupId)).status, 201);
  const { body } = await kari("/feed");
  assert.equal(body.posts.length, 1);
  assert.equal(body.posts[0].author, "Ola");
  assert.equal(body.posts[0].mine, false);
  for (const key of Object.keys(body.posts[0])) assert.doesNotMatch(key, /like|reaction|count|view/i);
});

test("barn utenfor gruppa ser ingenting", async () => {
  const a = await setupFamily("c");
  const other = await setupFamily("d");
  await post(a.kid, a.groupId);
  const { body } = await other.kid("/feed");
  assert.equal(body.posts.length, 0);
  assert.equal((await post(other.kid, a.groupId)).status, 403);
});

test("innlegg blir stoppet av filteret og av grensen per dag", async () => {
  const a = await setupFamily("e");
  const bad = await post(a.kid, a.groupId, "Du er dum");
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "FILTER");
  assert.equal((await a.kid("/posts", { method: "POST", body: { groupId: a.groupId, kind: "sint", text: "Hei hei", color: "gul" } })).status, 400);
  await a.parent(`/children/${a.childId}`, { method: "PATCH", body: { postsPerDay: 2 } });
  assert.equal((await post(a.kid, a.groupId)).status, 201);
  assert.equal((await post(a.kid, a.groupId)).status, 201);
  const third = await post(a.kid, a.groupId);
  assert.equal(third.status, 429);
  assert.equal(third.body.code, "POST_LIMIT");
});

test("ubrukte innlegg fra i går kan brukes i dag, men aldri mer enn dobbelt", async () => {
  const a = await setupFamily("e2");
  const start = clock;
  try {
    // Dag 1: kontoen er ny, så ingenting er spart.
    assert.equal((await a.kid("/me")).body.me.status.postsLeft, 5);
    for (let i = 0; i < 5; i++) assert.equal((await post(a.kid, a.groupId)).status, 201);
    assert.equal((await post(a.kid, a.groupId)).status, 429);
    // Dag 2: alt ble brukt i går, så det er bare dagens 5. Ingen innlegg denne dagen.
    clock = start + 864e5;
    let s = (await a.kid("/me")).body.me.status;
    assert.deepEqual([s.postsLeft, s.postsCarried], [5, 0]);
    // Dag 3: 5 spart fra i går gir 10, og ikke mer.
    clock = start + 2 * 864e5;
    s = (await a.kid("/me")).body.me.status;
    assert.deepEqual([s.postsLeft, s.postsCarried, s.postAllowance], [10, 5, 10]);
    for (let i = 0; i < 10; i++) assert.equal((await post(a.kid, a.groupId)).status, 201);
    assert.equal((await post(a.kid, a.groupId)).status, 429);
  } finally {
    clock = start;
  }
});

test("rapportert innlegg skjules og kan gjenopprettes av gruppeeieren", async () => {
  const a = await setupFamily("f");
  await a.parent("/children", { method: "POST", body: { username: "f-per", password: "per12345", displayName: "Per", avatar: "c02" } });
  const { body: { children } } = await a.parent("/children");
  const per = children.find((c) => c.displayName === "Per");
  await a.parent("/groups/join", { method: "POST", body: { code: a.code, childId: per.id } });
  const perClient = client();
  await perClient("/login", { method: "POST", body: { username: "f-per", password: "per12345" } });

  await post(a.kid, a.groupId);
  const { body: { posts: [p] } } = await perClient("/feed");
  assert.equal((await perClient(`/posts/${p.id}/report`, { method: "POST" })).status, 200);
  assert.equal((await perClient("/feed")).body.posts.length, 0);

  const { body: groupPosts } = await a.parent(`/groups/${a.groupId}/posts`);
  assert.equal(groupPosts.posts[0].status, "hidden");
  assert.equal(groupPosts.posts[0].reports, 1);
  await a.parent(`/posts/${p.id}/moderate`, { method: "POST", body: { action: "restore" } });
  assert.equal((await perClient("/feed")).body.posts.length, 1);
});

test("åpningstider og daglig tidsgrense håndheves på serveren", async () => {
  const a = await setupFamily("g");
  await a.parent(`/children/${a.childId}`, { method: "PATCH", body: { dailyMinutes: 2 } });

  await a.kid("/heartbeat", { method: "POST" });
  clock += 60e3;
  await a.kid("/heartbeat", { method: "POST" });
  const blocked = await a.kid("/feed");
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, "TIME_UP");

  await a.parent(`/children/${a.childId}`, { method: "PATCH", body: { dailyMinutes: 20 } });
  assert.equal((await a.kid("/feed")).status, 200);

  clock = Date.parse("2026-10-20T20:30:00Z"); // 22:30 i Oslo
  const night = await a.kid("/feed");
  assert.equal(night.status, 403);
  assert.equal(night.body.code, "CLOSED");
  clock = Date.parse("2026-10-20T10:00:00Z");
});

test("foresatte kan ikke styre andres barn", async () => {
  const a = await setupFamily("h");
  const b = await setupFamily("i");
  assert.equal((await b.parent(`/children/${a.childId}`, { method: "PATCH", body: { dailyMinutes: 120 } })).status, 404);
  assert.equal((await b.parent(`/children/${a.childId}`, { method: "DELETE" })).status, 404);
  assert.equal((await b.parent(`/groups/${a.groupId}/posts`)).status, 404);
});

test("barn kan ikke bruke foresatt-funksjoner", async () => {
  const a = await setupFamily("j");
  assert.equal((await a.kid("/children")).status, 403);
  assert.equal((await a.kid("/groups", { method: "POST", body: { name: "Hemmelig" } })).status, 403);
});

test("innloggingen bremses etter mange feil", async () => {
  const c = client();
  for (let i = 0; i < 5; i++) assert.equal((await c("/login", { method: "POST", body: { username: "ingen", password: "feil" } })).status, 401);
  assert.equal((await c("/login", { method: "POST", body: { username: "ingen", password: "feil" } })).status, 429);
});

test("bilde: EXIF/GPS fjernes, og bare gruppa ser det etter godkjenning", async () => {
  const a = await setupFamily("m");
  const outsider = await setupFamily("n");
  await a.parent("/children", { method: "POST", body: { username: "m-per", password: "per12345", displayName: "Per", avatar: "c02" } });
  const per = (await a.parent("/children")).body.children.find((c) => c.displayName === "Per");
  await a.parent("/groups/join", { method: "POST", body: { code: a.code, childId: per.id } });
  const perClient = client();
  await perClient("/login", { method: "POST", body: { username: "m-per", password: "per12345" } });

  const up = await upload(a.kid, jpegWithExif());
  assert.equal(up.status, 201);
  assert.equal(up.body.type, "image");
  const created = await post(a.kid, a.groupId, "Noe jeg tegnet i dag", up.body.id);
  assert.equal(created.status, 201);
  assert.equal(created.body.pending, true);

  // Forfatteren ser innlegget (som venter), de andre i gruppa ser det ikke ennå.
  const own = (await a.kid("/feed")).body.posts[0];
  assert.deepEqual(own.media, { id: up.body.id, type: "image", pending: true });
  assert.equal((await perClient("/feed")).body.posts.length, 0);
  assert.equal((await perClient(`/media/${up.body.id}`)).status, 404);

  // Gruppeeieren godkjenner.
  const { body: g } = await a.parent("/groups");
  assert.equal(g.groups[0].pendingMedia, 1);
  const postId = (await a.parent(`/groups/${a.groupId}/posts`)).body.posts[0].id;
  await a.parent(`/posts/${postId}/moderate`, { method: "POST", body: { action: "approve" } });

  assert.equal((await perClient("/feed")).body.posts[0].media.pending, false);
  const file = await perClient(`/media/${up.body.id}`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "image/jpeg");
  assert.equal(file.body.includes("GPS 59.9139"), false);
  assert.equal(file.body[0], 0xff);
  assert.equal(file.body[1], 0xd8);

  // Barn i andre grupper, og utloggede, får ikke tak i fila.
  assert.equal((await outsider.kid(`/media/${up.body.id}`)).status, 404);
  assert.equal((await client()(`/media/${up.body.id}`)).status, 401);
});

test("video: lengden sjekkes på serveren, GPS fjernes og Range virker", async () => {
  const a = await setupFamily("v");
  await a.parent(`/groups/${a.groupId}`, { method: "PATCH", body: { mediaReview: false } });

  const tooLong = await upload(a.kid, fixture("long.mp4"));
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.code, "TOO_LONG");
  assert.match(tooLong.body.error, /45 sekunder\. Maks er 30/);

  const up = await upload(a.kid, fixture("short.mov"));
  assert.equal(up.status, 201);
  assert.equal(up.body.type, "video");
  const created = await post(a.kid, a.groupId, "Se hva jeg bygde!", up.body.id);
  assert.equal(created.body.pending, false);

  const file = await a.kid(`/media/${up.body.id}`);
  assert.equal(file.headers.get("content-type"), "video/mp4");
  assert.equal(file.body.includes("59.9139"), false);
  const part = await a.kid(`/media/${up.body.id}`, { headers: { Range: "bytes=0-99" } });
  assert.equal(part.status, 206);
  assert.equal(part.body.length, 100);
});

test("opplasting avviser for store filer, feil filtyper og manglende X-Upload", async () => {
  const a = await setupFamily("w");
  const big = Buffer.concat([fixture("short.mp4"), Buffer.alloc(1.2 * 1024 * 1024)]);
  assert.equal((await upload(a.kid, big)).status, 413);
  assert.equal((await upload(a.kid, Buffer.from("<html>hei</html>"))).status, 400);
  const noHeader = await a.kid("/media", { method: "POST", raw: fixture("plain.jpg"), headers: { "X-Upload": "0" } });
  assert.equal(noHeader.status, 415);
  // Foresatte kan laste opp bilder (til voksenkontakten), men ikke video.
  assert.equal((await upload(a.parent, fixture("plain.jpg"))).status, 201);
  assert.equal((await upload(a.parent, fixture("short.mp4"))).status, 400);
  // Man kan ikke dele andres opplasting.
  const other = await setupFamily("x");
  const up = await upload(other.kid, fixture("plain.jpg"));
  assert.equal((await post(a.kid, a.groupId, "Hei alle sammen", up.body.id)).status, 400);
});

test("filer slettes fra disken når innlegget slettes", async () => {
  const a = await setupFamily("y");
  const up = await upload(a.kid, fixture("plain.jpg"));
  await post(a.kid, a.groupId, "Bildet mitt", up.body.id);
  assert.ok(readdirSync(mediaDir).includes(up.body.id));
  const postId = (await a.kid("/feed")).body.posts[0].id;
  await a.kid(`/posts/${postId}`, { method: "DELETE" });
  assert.equal(readdirSync(mediaDir).includes(up.body.id), false);
});

test("registreringskode kreves når den er satt", async () => {
  const app = createApp({ db: openDb(), mediaDir, registrationCode: "hemmelig-kode" });
  const srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const url = `http://localhost:${srv.address().port}`;
  const register = (code) => fetch(`${url}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: `kode-${code || "ingen"}`, password: "hemmelig123", displayName: "Voksen", email: `kode-${code || "ingen"}@example.com`, code }),
  });
  try {
    assert.deepEqual(await (await fetch(`${url}/api/signup-info`)).json(), { codeRequired: true });
    assert.equal((await register()).status, 403);
    assert.equal((await register("feil")).status, 403);
    assert.equal((await register("hemmelig-kode")).status, 201);
    assert.equal((await fetch(`${url}/healthz`)).status, 200);
  } finally {
    srv.close();
  }
});

test("barnet ser introduksjonen én gang, og det huskes på serveren", async () => {
  const a = await setupFamily("o");
  assert.equal((await a.kid("/me")).body.me.onboarded, false);
  assert.equal((await a.kid("/onboarded", { method: "POST" })).status, 200);
  assert.equal((await a.kid("/me")).body.me.onboarded, true);
  // Foresatte har ingen introduksjon å bekrefte.
  assert.equal((await a.parent("/onboarded", { method: "POST" })).status, 403);
});

test("glemt passord: lenke på e-post, nytt passord, engangsbruk og utlogging", async () => {
  const a = await setupFamily("p");
  const otherDevice = client();
  await otherDevice("/login", { method: "POST", body: { login: "p@example.com", password: "hemmelig123" } });

  // Ukjent e-post gir samme svar, men ingen e-post.
  outbox.length = 0;
  const unknown = await client()("/password/forgot", { method: "POST", body: { email: "finnes-ikke@example.com" } });
  assert.equal(unknown.status, 200);
  assert.equal(outbox.length, 0);

  const anon = client();
  assert.equal((await anon("/password/forgot", { method: "POST", body: { email: "P@Example.com " } })).status, 200);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, "p@example.com");
  const token = outbox[0].text.match(/https:\/\/some\.example\/#reset=([0-9a-f]{64})/)[1];

  assert.equal((await anon("/password/reset", { method: "POST", body: { token, password: "kort" } })).status, 400);
  const ok = await anon("/password/reset", { method: "POST", body: { token, password: "nytt-passord-123" } });
  assert.equal(ok.status, 200);
  assert.equal((await anon("/me")).body.me.email, "p@example.com"); // logget inn
  assert.equal((await otherDevice("/me")).status, 401); // andre enheter logget ut
  assert.equal((await client()("/login", { method: "POST", body: { login: "p@example.com", password: "hemmelig123" } })).status, 401);
  assert.equal((await client()("/login", { method: "POST", body: { login: "p@example.com", password: "nytt-passord-123" } })).status, 200);

  // Lenken kan bare brukes én gang.
  const again = await anon("/password/reset", { method: "POST", body: { token, password: "enda-et-passord" } });
  assert.equal(again.status, 400);
  assert.equal(again.body.code, "RESET_INVALID");
});

test("glemt passord: lenken går ut etter en time", async () => {
  const a = await setupFamily("q");
  outbox.length = 0;
  await client()("/password/forgot", { method: "POST", body: { email: "q@example.com" } });
  const token = outbox[0].text.match(/#reset=([0-9a-f]{64})/)[1];
  clock += 61 * 60e3;
  const res = await client()("/password/reset", { method: "POST", body: { token, password: "nytt-passord-123" } });
  clock -= 61 * 60e3;
  assert.equal(res.status, 400);
  assert.equal((await a.parent("/me")).status, 200);
});

test("foresatte kan bytte passord og e-post når de er logget inn", async () => {
  const a = await setupFamily("r");
  assert.equal((await a.parent("/me")).body.me.email, "r@example.com");
  assert.equal((await a.parent("/me/password", { method: "POST", body: { current: "feil-passord", password: "nytt-passord-123" } })).status, 400);
  assert.equal((await a.parent("/me/password", { method: "POST", body: { current: "hemmelig123", password: "nytt-passord-123" } })).status, 200);
  assert.equal((await a.parent("/me")).status, 200); // fortsatt logget inn på denne enheten
  assert.equal((await client()("/login", { method: "POST", body: { login: "r@example.com", password: "nytt-passord-123" } })).status, 200);

  assert.equal((await a.parent("/me", { method: "PATCH", body: { email: "ikke-en-epost" } })).status, 400);
  assert.equal((await a.parent("/me", { method: "PATCH", body: { email: "p@example.com" } })).status, 409); // tatt
  assert.equal((await a.parent("/me", { method: "PATCH", body: { email: "Ny@Example.com" } })).status, 200);
  assert.equal((await a.parent("/me")).body.me.email, "r@example.com"); // gammel adresse til den nye er bekreftet
  await verifyEmail("ny@example.com");
  // Lenken ble åpnet på en annen enhet: de andre innloggingene er logget ut, og den gamle adressen fikk beskjed.
  assert.equal((await a.parent("/me")).status, 401);
  assert.match(outbox.findLast((m) => m.to === "r@example.com").subject, /E-postadressen din i quipu er endret/);
  assert.equal((await a.parent("/login", { method: "POST", body: { login: "ny@example.com", password: "nytt-passord-123" } })).status, 200);
  assert.equal((await a.parent("/me")).body.me.email, "ny@example.com");
  // Barn har verken e-post eller tilgang til dette.
  assert.equal((await a.kid("/me/password", { method: "POST", body: { current: "ola12345", password: "nytt-passord-123" } })).status, 403);
});

test("registrering krever gyldig e-post", async () => {
  const c = client();
  const res = await c("/register", { method: "POST", body: { username: "uten-epost", password: "hemmelig123", displayName: "Voksen" } });
  assert.equal(res.status, 400);
});

test("foresatte logger inn med e-post, barn med brukernavn", async () => {
  const a = await setupFamily("s");
  // Registreringen trenger ikke brukernavn, og e-post er ikke følsom for store bokstaver.
  assert.equal((await client()("/login", { method: "POST", body: { login: " S@Example.com ", password: "hemmelig123" } })).status, 200);
  assert.equal((await client()("/login", { method: "POST", body: { login: "s@example.com", password: "feil-passord" } })).status, 401);
  assert.equal((await client()("/login", { method: "POST", body: { login: "s-ola", password: "ola12345" } })).status, 200);
  assert.match((await a.parent("/me")).body.me.username, /^foresatt-[0-9a-f]{10}$/);
});

test("foresatte fra før e-post kom kan fortsatt logge inn med brukernavn", async () => {
  const db = openDb();
  const app = createApp({ db, mediaDir, mailer });
  const srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const { hashPassword } = await import("../server/auth.js");
  db.prepare("INSERT INTO users (username, password_hash, role, display_name, created_at) VALUES ('gammel', ?, 'parent', 'Gammel', 0)")
    .run(hashPassword("hemmelig123"));
  try {
    const res = await fetch(`http://localhost:${srv.address().port}/api/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: "Gammel", password: "hemmelig123" }),
    });
    assert.equal(res.status, 200);
  } finally {
    srv.close();
  }
});

test("merkelapp er valgfri, og nye merkelapper finnes", async () => {
  const a = await setupFamily("t");
  await a.parent(`/children/${a.childId}`, { method: "PATCH", body: { postsPerDay: 5 } });
  const none = await a.kid("/posts", { method: "POST", body: { groupId: a.groupId, text: "Er det noen som vil spille fotball i friminuttet?", color: "bla" } });
  assert.equal(none.status, 201);
  const q = await a.kid("/posts", { method: "POST", body: { groupId: a.groupId, kind: "sporsmal", text: "Hva er leksene til fredag?", color: "gul" } });
  assert.equal(q.status, 201);
  const kinds = (await a.kid("/feed")).body.posts.map((p) => p.kind).sort();
  assert.deepEqual(kinds, ["", "sporsmal"]);
  assert.equal((await a.kid("/me")).body.kinds.sporsmal, "Spørsmål");
  // Ukjente merkelapper avvises fortsatt, også navn som finnes på alle objekter.
  assert.equal((await a.kid("/posts", { method: "POST", body: { groupId: a.groupId, kind: "toString", text: "Hei hei", color: "gul" } })).status, 400);
});

test("foresatte må bekrefte e-posten før de kan lage barn og grupper", async () => {
  const p = client();
  outbox.length = 0;
  assert.equal((await p("/register", { method: "POST", body: { password: "hemmelig123", displayName: "Ny", email: "v1@example.com" } })).status, 201);
  assert.equal(outbox.length, 1);
  assert.match(outbox[0].text, /#verify=[0-9a-f]{64}/);
  let { body: { me } } = await p("/me");
  assert.equal(me.emailVerified, false);
  const blocked = await p("/groups", { method: "POST", body: { name: "6A" } });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, "EMAIL_UNVERIFIED");
  assert.equal((await p("/children")).status, 403);

  // Skrivefeil ved registrering: adressen kan rettes før den er bekreftet, og det kommer en ny lenke.
  assert.equal((await p("/me", { method: "PATCH", body: { email: "v2@example.com" } })).status, 200);
  ({ body: { me } } = await p("/me"));
  assert.equal(me.email, "v2@example.com");
  await verifyEmail("v2@example.com");
  ({ body: { me } } = await p("/me"));
  assert.equal(me.emailVerified, true);
  assert.equal((await p("/groups", { method: "POST", body: { name: "6A" } })).status, 201);

  // Lenken virker bare én gang.
  const token = outbox.findLast((m) => m.to === "v2@example.com").text.match(/#verify=([0-9a-f]{64})/)[1];
  assert.equal((await client()("/email/verify", { method: "POST", body: { token } })).status, 400);

  // Ny adresse på en bekreftet konto tas først i bruk når den nye lenken er åpnet.
  const change = await p("/me", { method: "PATCH", body: { email: "v3@example.com" } });
  assert.equal(change.body.pendingEmail, "v3@example.com");
  ({ body: { me } } = await p("/me"));
  assert.deepEqual([me.email, me.pendingEmail, me.emailVerified], ["v2@example.com", "v3@example.com", true]);
  await verifyEmail("v3@example.com");
  assert.equal((await p("/me")).status, 401, "andre enheter logges ut ved ny e-post");
  await p("/login", { method: "POST", body: { login: "v3@example.com", password: "hemmelig123" } });
  ({ body: { me } } = await p("/me"));
  assert.deepEqual([me.email, me.pendingEmail], ["v3@example.com", ""]);
});

test("barn må godkjennes av gruppeeieren før de ser noe i gruppa", async () => {
  const a = await setupFamily("g1");
  await post(a.kid, a.groupId, "Hei fra klassen!");
  const b = client();
  await registerParent(b, "g1-far@example.com", "Pappa");
  await b("/children", { method: "POST", body: { username: "g1-lise", password: "lise1234", displayName: "Lise", avatar: "c04" } });
  const { body: { children: [lise] } } = await b("/children");
  outbox.length = 0;
  const join = await b("/groups/join", { method: "POST", body: { code: a.code, childId: lise.id } });
  assert.equal(join.body.pending, true);
  // Eieren får beskjed på e-post.
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, "g1@example.com");

  const kid = client();
  await kid("/login", { method: "POST", body: { username: "g1-lise", password: "lise1234" } });
  assert.equal((await kid("/feed")).body.posts.length, 0);
  assert.equal((await kid("/me")).body.me.groups.length, 0);
  assert.equal((await post(kid, a.groupId)).status, 403);
  assert.equal((await b(`/groups/${a.groupId}/posts`)).status, 404);
  assert.equal((await b("/children")).body.children[0].groups[0].pending, true);

  // Eieren ser forespørselen, med navn og e-post på den foresatte. Andre kan ikke godkjenne.
  const { body: { groups } } = await a.parent("/groups");
  const g = groups.find((x) => x.id === a.groupId);
  assert.deepEqual(g.pendingMembers.map((m) => [m.displayName, m.parentEmail]), [["Lise", "g1-far@example.com"]]);
  assert.equal(g.members.length, 1);
  assert.equal((await b(`/groups/${a.groupId}/members/${lise.id}`, { method: "POST", body: { action: "approve" } })).status, 404);

  assert.equal((await a.parent(`/groups/${a.groupId}/members/${lise.id}`, { method: "POST", body: { action: "approve" } })).status, 200);
  assert.equal((await kid("/feed")).body.posts.length, 1);
  assert.equal((await b("/children")).body.children[0].groups[0].pending, false);
});

test("eieren kan avslå en forespørsel", async () => {
  const a = await setupFamily("g2");
  const b = client();
  await registerParent(b, "g2-far@example.com", "Pappa");
  await b("/children", { method: "POST", body: { username: "g2-tor", password: "tor12345", displayName: "Tor", avatar: "c04" } });
  const { body: { children: [tor] } } = await b("/children");
  await b("/groups/join", { method: "POST", body: { code: a.code, childId: tor.id } });
  assert.equal((await a.parent(`/groups/${a.groupId}/members/${tor.id}`, { method: "POST", body: { action: "reject" } })).status, 200);
  assert.equal((await b("/children")).body.children[0].groups.length, 0);
});

test("e-poster har HTML med logo, og navn fra brukere blir escapet", async () => {
  outbox.length = 0;
  const c = client();
  await c("/register", { method: "POST", body: { password: "hemmelig123", displayName: "Ida <b>", email: "html@example.com" } });
  const mail = outbox[0];
  assert.match(mail.html, /<img src="cid:logo@quipu"/);
  assert.match(mail.html, /Hei Ida &lt;b&gt;!/);
  assert.doesNotMatch(mail.html, /Ida <b>/);
  assert.match(mail.html, /href="https:\/\/some\.example\/#verify=[0-9a-f]{64}"/);
  assert.equal(mail.attachments[0].cid, "logo@quipu");
  assert.match(mail.text, /Bekreft e-postadressen: https:\/\/some\.example\/#verify=/);
});

test("sikkerhetsheadere: ingen mellomlagring av API-svar, og nettsiden får ikke posisjon, kamera eller mikrofon", async () => {
  const res = await fetch(base + "/signup-info");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(res.headers.get("permissions-policy"), /geolocation=\(\), camera=\(\), microphone=\(\)/);
  assert.match(res.headers.get("content-security-policy"), /default-src 'self'/);
  const page = await fetch(base.replace(/\/api$/, "") + "/sikkerhet");
  assert.equal(page.status, 200);
});

test("opprydding sletter gammel skjermtid og fjernede innlegg etter 30 dager", async () => {
  const a = await setupFamily("rydd");
  await post(a.kid, a.groupId, "Dette fjernes");
  await a.kid("/heartbeat", { method: "POST" });
  const { body: { posts } } = await a.parent(`/groups/${a.groupId}/posts`);
  await a.parent(`/posts/${posts[0].id}/moderate`, { method: "POST", body: { action: "remove" } });
  const start = clock;
  try {
    clock = start + 31 * 864e5;
    app.locals.cleanup();
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM posts WHERE status = 'removed' AND text = 'Dette fjernes'").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM usage WHERE day = '2026-10-20'").get().n, 0);
  } finally {
    clock = start;
  }
});

test("barnet kan bytte profilbilde selv, men bare til figurene i settet", async () => {
  const a = await setupFamily("av");
  assert.equal((await a.kid("/me/avatar", { method: "POST", body: { avatar: "c17" } })).status, 200);
  assert.equal((await a.kid("/me")).body.me.avatar, "c17");
  assert.equal((await a.kid("/me/avatar", { method: "POST", body: { avatar: "<img>" } })).status, 400);
  assert.equal((await a.parent("/me/avatar", { method: "POST", body: { avatar: "c01" } })).status, 403);
});

test("gamle emoji-profilbilder blir til figurer, også for foresatte", () => {
  const dir = mkdtempSync(join(tmpdir(), "quipu-"));
  const path = join(dir, "old.db");
  // En database fra før figurene kom: versjon 2 med emojier.
  const old = openDb(path);
  old.exec(`INSERT INTO users (username, password_hash, role, display_name, avatar, created_at) VALUES
    ('a', 'x', 'child', 'A', '🐼', 0), ('b', 'x', 'child', 'B', '🙂', 0), ('c', 'x', 'parent', 'C', '🧑', 0);
    PRAGMA user_version = 2`);
  old.close();
  const db2 = openDb(path);
  // Barna får figuren som svarer til emojien, foresatte en figur ut fra kontoen (id 3 → c04).
  assert.deepEqual(db2.prepare("SELECT avatar FROM users ORDER BY username").all().map((r) => r.avatar), ["c02", "c01", "c04"]);
  db2.close();
  rmSync(dir, { recursive: true, force: true });
});

test("feeden kan spørre om det er kommet nye innlegg fra de andre", async () => {
  const a = await setupFamily("fersk");
  const b = client();
  await registerParent(b, "fersk-far@example.com", "Pappa");
  await b("/children", { method: "POST", body: { username: "fersk-siri", password: "siri1234", displayName: "Siri", avatar: "c05" } });
  const { body: { children: [siri] } } = await b("/children");
  await b("/groups/join", { method: "POST", body: { code: a.code, childId: siri.id } });
  await a.parent(`/groups/${a.groupId}/members/${siri.id}`, { method: "POST", body: { action: "approve" } });
  const kid2 = client();
  await kid2("/login", { method: "POST", body: { username: "fersk-siri", password: "siri1234" } });

  await post(a.kid, a.groupId, "Første");
  const { body: { posts } } = await a.kid("/feed");
  const since = posts[0].id;
  assert.equal((await a.kid(`/feed/new?since=${since}`)).body.count, 0);
  await post(a.kid, a.groupId, "Mitt eget teller ikke");
  assert.equal((await a.kid(`/feed/new?since=${since}`)).body.count, 0);
  await post(kid2, a.groupId, "Hei fra Siri");
  await post(kid2, a.groupId, "Og en til");
  assert.equal((await a.kid(`/feed/new?since=${since}`)).body.count, 2);
});

test("foresatte kan også spørre om nye innlegg i en gruppe", async () => {
  const a = await setupFamily("fnytt");
  await post(a.kid, a.groupId, "Første");
  const { body: { posts } } = await a.parent(`/groups/${a.groupId}/posts`);
  const since = posts[0].id;
  assert.equal((await a.parent(`/groups/${a.groupId}/posts/new?since=${since}`)).body.count, 0);
  await post(a.kid, a.groupId, "Andre");
  assert.equal((await a.parent(`/groups/${a.groupId}/posts/new?since=${since}`)).body.count, 1);
  // Andre foresatte uten barn i gruppa får ikke se noe.
  const stranger = client();
  await registerParent(stranger, "fnytt-fremmed@example.com");
  assert.equal((await stranger(`/groups/${a.groupId}/posts/new?since=0`)).status, 404);
});

test("nye foresatte får en figur som profilbilde automatisk", async () => {
  const p = client();
  await registerParent(p, "figur@example.com");
  assert.match((await p("/me")).body.me.avatar, /^c\d{2}$/);
});

test("voksenkontakt: bare foresatte i gruppa kan lese og skrive, og barna ser det ikke", async () => {
  const a = await setupFamily("vk");
  const b = client();
  await registerParent(b, "vk-far@example.com", "Pappa");
  await b("/children", { method: "POST", body: { username: "vk-tor", password: "tor12345", displayName: "Tor", avatar: "c04" } });
  const { body: { children: [tor] } } = await b("/children");
  await b("/groups/join", { method: "POST", body: { code: a.code, childId: tor.id } });

  // Mens barnet venter på godkjenning, er den foresatte ikke med i voksenkontakten.
  assert.equal((await b(`/groups/${a.groupId}/adult`)).status, 404);
  await a.parent(`/groups/${a.groupId}/members/${tor.id}`, { method: "POST", body: { action: "approve" } });

  assert.equal((await a.parent(`/groups/${a.groupId}/adult`, { method: "POST", body: { text: "Hei! Husk foreldremøtet torsdag." } })).status, 201);
  // Den andre foresatte ser én ulest melding i grupper-lista, og den er lest når voksenkontakten åpnes.
  let g = (await b("/groups")).body.groups.find((x) => x.id === a.groupId);
  assert.equal(g.adultUnread, 1);
  assert.equal((await b(`/groups/${a.groupId}/adult/new?since=0`)).body.count, 1);
  const { body } = await b(`/groups/${a.groupId}/adult`);
  assert.deepEqual(body.messages.map((m) => [m.author, m.text, m.mine, m.canDelete]), [["Mamma", "Hei! Husk foreldremøtet torsdag.", false, false]]);
  g = (await b("/groups")).body.groups.find((x) => x.id === a.groupId);
  assert.equal(g.adultUnread, 0);

  assert.equal((await b(`/groups/${a.groupId}/adult`, { method: "POST", body: { text: "Takk, vi kommer!" } })).status, 201);
  const own = (await b(`/groups/${a.groupId}/adult`)).body.messages[0];
  assert.equal(own.canDelete, true);
  // Barn og fremmede kommer ikke inn.
  assert.equal((await a.kid(`/groups/${a.groupId}/adult`)).status, 403);
  const stranger = client();
  await registerParent(stranger, "vk-fremmed@example.com");
  assert.equal((await stranger(`/groups/${a.groupId}/adult`)).status, 404);
  assert.equal((await stranger(`/adult/${own.id}`, { method: "DELETE" })).status, 404);
  // Eieren kan slette alle meldinger.
  assert.equal((await a.parent(`/adult/${own.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await b(`/groups/${a.groupId}/adult`)).body.messages.length, 1);
});


// Hjelper: en foresatt med et godkjent barn i gruppa til a.
async function secondParent(a, prefix) {
  const b = client();
  await registerParent(b, `${prefix}-far@example.com`, "Pappa");
  await b("/children", { method: "POST", body: { username: `${prefix}-tor`, password: "tor12345", displayName: "Tor", avatar: "c04" } });
  const { body: { children: [tor] } } = await b("/children");
  await b("/groups/join", { method: "POST", body: { code: a.code, childId: tor.id } });
  await a.parent(`/groups/${a.groupId}/members/${tor.id}`, { method: "POST", body: { action: "approve" } });
  return b;
}
// Gjør en foresatt til administrator med to-trinns innlogging, slik det gjøres i appen.
async function makeAdmin(c, email) {
  db.prepare("UPDATE users SET is_admin = 1 WHERE email = ?").run(email);
  const { body } = await c("/admin/mfa/setup", { method: "POST" });
  const res = await c("/admin/mfa/confirm", { method: "POST", body: { code: codeAt(body.secret, Math.floor(clock / 30000)) } });
  assert.equal(res.status, 200);
  return body.secret;
}
const fakeSub = (name) => ({ endpoint: `https://push.example.com/${name}`, keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } });

test("push: innholdet krypteres slik at bare enheten kan lese det (RFC 8291)", () => {
  const ua = createECDH("prime256v1");
  const uaPublic = ua.generateKeys();
  const auth = randomBytes(16);
  const body = encryptPayload(JSON.stringify({ title: "Hei" }), { p256dh: uaPublic.toString("base64url"), auth: auth.toString("base64url") });
  // Dekrypter som en nettleser ville gjort.
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const shared = ua.computeSecret(asPublic);
  const ikm = Buffer.from(hkdfSync("sha256", shared, auth, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const data = body.subarray(21 + idlen);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(data.subarray(-16));
  const plain = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]);
  assert.equal(plain.at(-1), 2);
  assert.deepEqual(JSON.parse(plain.subarray(0, -1)), { title: "Hei" });
});

test("push: VAPID-signaturen kan kontrolleres med den offentlige nøkkelen (RFC 8292)", () => {
  const keys = createVapidKeys();
  const header = vapidHeader("https://push.example.com/abc", keys);
  const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.publicKey);
  const [h, c, sig] = jwt.split(".");
  assert.equal(JSON.parse(Buffer.from(c, "base64url")).aud, "https://push.example.com");
  const pub = Buffer.from(keys.publicKey, "base64url");
  const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") }, format: "jwk" });
  assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")));
});

test("push: nye beskjeder varsler de andre foresatte, ikke forfatteren, og døde abonnementer fjernes", async () => {
  const a = await setupFamily("pv");
  const b = await secondParent(a, "pv");
  const { body: { pushKey } } = await b("/notify");
  assert.match(pushKey, /^[\w-]{87}$/);
  assert.equal((await b("/push/subscribe", { method: "POST", body: { endpoint: "javascript:alert(1)", keys: fakeSub("x").keys } })).status, 400);
  assert.equal((await b("/push/subscribe", { method: "POST", body: fakeSub("pv-far") })).status, 201);
  assert.equal((await b("/push/subscribe", { method: "POST", body: fakeSub("borte") })).status, 201);
  assert.equal((await a.parent("/push/subscribe", { method: "POST", body: fakeSub("pv-mor") })).status, 201);
  pushed.length = 0;
  await a.parent(`/groups/${a.groupId}/adult`, { method: "POST", body: { text: "Foreldremøte torsdag!" } });
  assert.deepEqual(pushed.map((p) => p.endpoint).sort(), ["https://push.example.com/borte", "https://push.example.com/pv-far"]);
  assert.equal(pushed[0].title, "Ny beskjed i Klasse 4B");
  assert.equal(pushed[0].body, "Mamma: Foreldremøte torsdag!");
  assert.equal(pushed[0].url, `/#voksen=${a.groupId}`);
  // «borte» svarte at abonnementet ikke finnes lenger, så det er slettet.
  pushed.length = 0;
  await a.parent(`/groups/${a.groupId}/adult`, { method: "POST", body: { text: "Og en til" } });
  assert.deepEqual(pushed.map((p) => p.endpoint), ["https://push.example.com/pv-far"]);
  // Slått av på enheten: ingen varsler.
  await b("/push/unsubscribe", { method: "POST", body: { endpoint: fakeSub("pv-far").endpoint } });
  pushed.length = 0;
  await a.parent(`/groups/${a.groupId}/adult`, { method: "POST", body: { text: "Tredje" } });
  assert.equal(pushed.length, 0);
});

test("e-post om beskjeder: samlet etter litt, én gang om dagen, eller av", async () => {
  const a = await setupFamily("ev");
  const b = await secondParent(a, "ev");
  const start = clock;
  try {
    assert.equal((await b("/notify")).body.email, "soon");
    await a.parent(`/groups/${a.groupId}/adult`, { method: "POST", body: { text: "Husk gymtøy" } });
    await a.parent(`/groups/${a.groupId}/adult`, { method: "POST", body: { text: "og matpakke" } });
    const mine = () => outbox.filter((m) => m.to === "ev-far@example.com");
    outbox.length = 0;
    await app.locals.emailAdultMessages();
    assert.equal(mine().length, 0); // venter litt, så flere beskjeder kommer i samme e-post
    clock += 11 * 60e3;
    await app.locals.emailAdultMessages();
    assert.equal(mine().length, 1);
    assert.match(mine()[0].subject, /2 nye beskjeder/);
    assert.match(mine()[0].text, /Mamma i Klasse 4B: «Husk gymtøy»/);
    assert.match(mine()[0].html, /cid:button@quipu/);
    assert.equal(outbox.filter((m) => m.to === "ev@example.com").length, 0); // ikke til forfatteren
    await app.locals.emailAdultMessages();
    assert.equal(mine().length, 1); // ikke samme beskjeder to ganger

    // Leser man beskjedene i appen, kommer det ingen e-post om dem.
    await a.parent(`/groups/${a.groupId}/adult`, { method: "POST", body: { text: "Lest i appen" } });
    await b(`/groups/${a.groupId}/adult`);
    clock += 11 * 60e3;
    await app.locals.emailAdultMessages();
    assert.equal(mine().length, 1);

    // Én gang om dagen: først etter kl. 18, og bare én gang.
    assert.equal((await b("/notify", { method: "PATCH", body: { email: "sjelden" } })).status, 400);
    await b("/notify", { method: "PATCH", body: { email: "daily" } });
    await a.parent(`/groups/${a.groupId}/adult`, { method: "POST", body: { text: "Dagens beskjed" } });
    clock = Date.parse("2026-10-21T14:00:00Z"); // 16:00 i Oslo
    await app.locals.emailAdultMessages();
    assert.equal(mine().length, 1);
    clock = Date.parse("2026-10-21T16:30:00Z"); // 18:30 i Oslo
    await app.locals.emailAdultMessages();
    assert.equal(mine().length, 2);
    await a.parent(`/groups/${a.groupId}/adult`, { method: "POST", body: { text: "Enda en" } });
    await app.locals.emailAdultMessages();
    assert.equal(mine().length, 2); // allerede sendt i dag

    // Av: ingen e-post.
    await b("/notify", { method: "PATCH", body: { email: "off" } });
    clock = Date.parse("2026-10-22T16:30:00Z");
    await app.locals.emailAdultMessages();
    assert.equal(mine().length, 2);
  } finally {
    clock = start;
  }
});

test("voksenkontakt: foresatte kan dele bilder, som bare foresatte i gruppa ser", async () => {
  const a = await setupFamily("vb");
  const b = await secondParent(a, "vb");
  // Video er ikke lov i voksenkontakten, bare bilder.
  assert.equal((await upload(b, fixture("short.mp4"))).status, 400);
  const up = await upload(b, jpegWithExif());
  assert.equal(up.status, 201);
  assert.equal((await b(`/groups/${a.groupId}/adult`, { method: "POST", body: { mediaId: up.body.id } })).status, 201);
  const { body: { messages } } = await a.parent(`/groups/${a.groupId}/adult`);
  assert.equal(messages[0].imageId, up.body.id);
  assert.equal(messages[0].text, "");
  // Foresatte i gruppa ser bildet (uten GPS), barna og fremmede gjør ikke.
  const img = await a.parent(`/media/${up.body.id}`);
  assert.equal(img.status, 200);
  assert.equal(img.body.includes("GPS"), false);
  assert.equal((await a.kid(`/media/${up.body.id}`)).status, 404);
  const stranger = client();
  await registerParent(stranger, "vb-fremmed@example.com");
  assert.equal((await stranger(`/media/${up.body.id}`)).status, 404);
  // Bildet kan ikke brukes på nytt, og sletter man meldingen, forsvinner bildet.
  assert.equal((await b(`/groups/${a.groupId}/adult`, { method: "POST", body: { mediaId: up.body.id } })).status, 400);
  assert.equal((await b(`/groups/${a.groupId}/adult`, { method: "POST", body: { text: "" } })).status, 400);
  await b(`/adult/${messages[0].id}`, { method: "DELETE" });
  assert.equal((await a.parent(`/media/${up.body.id}`)).status, 404);
  assert.equal(readdirSync(mediaDir).includes(up.body.id), false);
});

test("invitasjon: en foresatt inviterer en annen, som slipper registreringskoden", async () => {
  const sent = [];
  const db2 = openDb();
  const app2 = createApp({ db: db2, mediaDir, registrationCode: "hemmelig-kode", now: () => clock, appUrl: "https://some.example",
    mailer: { send: async (m) => { sent.push(m); } } });
  const srv = app2.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const url = `http://localhost:${srv.address().port}/api`;
  const call = (cookie = "") => async (path, { method = "GET", body } = {}) => {
    const res = await fetch(url + path, { method, headers: { cookie, ...(method === "GET" ? {} : { "Content-Type": "application/json" }) }, body: method === "GET" ? undefined : JSON.stringify(body || {}) });
    return { status: res.status, cookie: (res.headers.get("set-cookie") || "").split(";")[0], body: await res.json().catch(() => ({})) };
  };
  const anon = call();
  try {
    // Første foresatt kommer inn med koden og bekrefter e-posten.
    const reg = await anon("/register", { method: "POST", body: { displayName: "Kristin", email: "inv-kristin@example.com", password: "hemmelig123", code: "hemmelig-kode" } });
    assert.equal(reg.status, 201);
    const kristin = call(reg.cookie);
    assert.equal((await kristin("/invites", { method: "POST" })).status, 403, "e-posten må være bekreftet først");
    const verify = sent.findLast((m) => m.to === "inv-kristin@example.com").text.match(/#verify=([0-9a-f]{64})/)[1];
    await anon("/email/verify", { method: "POST", body: { token: verify } });

    // Invitasjon på e-post. Lenken har koden etter #.
    const inv = await kristin("/invites", { method: "POST", body: { emails: ["inv-thomas@example.com", " INV-thomas@example.com"] } });
    assert.equal(inv.status, 201);
    assert.deepEqual(inv.body.results, [{ email: "inv-thomas@example.com", status: "sent" }], "dobbelt adresse sendes én gang");
    const mail = sent.findLast((m) => m.to === "inv-thomas@example.com");
    assert.match(mail.subject, /Kristin inviterer deg/);
    const token = mail.text.match(/#invitasjon=([0-9a-f]{64})/)[1];
    assert.match(mail.text, new RegExp(`https://some.example/#invitasjon=${token}`));
    assert.deepEqual((await anon(`/invites/${token}`)).body, { inviter: "Kristin", email: "inv-thomas@example.com", group: null });
    assert.equal((await kristin("/invites", { method: "POST", body: { emails: ["ok@example.com", "ikke-en-adresse"] } })).status, 400);

    // Med invitasjonen trengs ikke koden, og den kan bare brukes én gang.
    const thomas = await anon("/register", { method: "POST", body: { displayName: "Thomas", email: "inv-thomas@example.com", password: "hemmelig123", invite: token } });
    assert.equal(thomas.status, 201);
    assert.equal(db2.prepare("SELECT invited_by FROM users WHERE email = ?").get("inv-thomas@example.com").invited_by,
      db2.prepare("SELECT id FROM users WHERE email = ?").get("inv-kristin@example.com").id);
    assert.equal((await anon(`/invites/${token}`)).status, 404);
    const again = await anon("/register", { method: "POST", body: { displayName: "Hanne", email: "inv-hanne@example.com", password: "hemmelig123", invite: token } });
    assert.equal(again.status, 400);
    assert.match(again.body.error, /brukt eller har gått ut/);

    // Lenke uten e-post går ut etter 14 dager.
    const link = await kristin("/invites", { method: "POST", body: {} });
    assert.deepEqual(link.body.results, []);
    const linkToken = link.body.url.split("=")[1];
    const start = clock;
    clock += 15 * 864e5;
    try {
      assert.equal((await anon(`/invites/${linkToken}`)).status, 404);
      app2.locals.cleanup();
      assert.equal(db2.prepare("SELECT COUNT(*) AS n FROM parent_invites").get().n, 0);
    } finally {
      clock = start;
    }
    // Uten innlogging kan man ikke invitere.
    assert.equal((await anon("/invites", { method: "POST" })).status, 401);
  } finally {
    srv.close();
  }
});

test("invitasjon til en gruppe: nye og eksisterende foresatte kan melde inn barnet uten kode", async () => {
  const a = await setupFamily("gi"); // a.parent eier gruppa
  const eier = a.parent;
  // Ny foresatt via lenke: kontoen lages, og gruppa ligger klar under invitasjoner.
  const link = await eier("/invites", { method: "POST", body: { groupId: a.groupId } });
  assert.equal(link.status, 201);
  const token = link.body.url.split("=")[1];
  const anon = client();
  assert.equal((await anon(`/invites/${token}`)).body.group, "Klasse 4B");
  const ny = client();
  assert.equal((await ny("/register", { method: "POST", body: { displayName: "Ny", email: "gi-ny@example.com", password: "hemmelig123", invite: token } })).status, 201);
  await verifyEmail("gi-ny@example.com");
  assert.deepEqual((await ny("/groups")).body.invitations.map((g) => [g.name, g.inviter]), [["Klasse 4B", "Mamma"]]);
  await ny("/children", { method: "POST", body: { username: "gi-barn", password: "barn12345", displayName: "Barn", avatar: "c05" } });
  const { body: { children } } = await ny("/children");
  // Eieren inviterte, så barnet slipper rett inn.
  assert.deepEqual((await ny("/groups/join", { method: "POST", body: { groupId: a.groupId, childId: children[0].id } })).body, { ok: true, pending: false });

  // En annen foresatt i gruppa inviterer en som allerede har konto: hen får e-post, og eieren må godkjenne.
  const medlem = await secondParent(a, "gi");
  const gammel = client();
  await registerParent(gammel, "gi-gammel@example.com", "Gammel");
  const res = await medlem("/invites", { method: "POST", body: { groupId: a.groupId, emails: ["gi-gammel@example.com", "gi-helt-ny@example.com"] } });
  assert.deepEqual(res.body.results.map((r) => r.status), ["invited", "sent"]);
  assert.match(outbox.findLast((m) => m.to === "gi-gammel@example.com").text, /meld/i);
  await gammel("/children", { method: "POST", body: { username: "gi-barn2", password: "barn12345", displayName: "Barn2", avatar: "c06" } });
  const { body: { children: [b2] } } = await gammel("/children");
  assert.equal((await gammel("/groups/join", { method: "POST", body: { groupId: a.groupId, childId: b2.id } })).body.pending, true);

  // Uten invitasjon går det ikke uten kode, og fremmede kan ikke invitere til gruppa.
  const fremmed = client();
  await registerParent(fremmed, "gi-fremmed@example.com");
  assert.equal((await fremmed("/invites", { method: "POST", body: { groupId: a.groupId } })).status, 404);
  await fremmed("/children", { method: "POST", body: { username: "gi-barn3", password: "barn12345", displayName: "Barn3", avatar: "c07" } });
  const { body: { children: [b3] } } = await fremmed("/children");
  assert.equal((await fremmed("/groups/join", { method: "POST", body: { groupId: a.groupId, childId: b3.id } })).status, 404);

  // En innlogget foresatt som åpner en gruppelenke, blir invitert til gruppa. Invitasjonen kan skjules.
  const link2 = await eier("/invites", { method: "POST", body: { groupId: a.groupId } });
  assert.equal((await fremmed(`/invites/${link2.body.url.split("=")[1]}/accept`, { method: "POST" })).body.group, "Klasse 4B");
  assert.equal((await fremmed("/groups")).body.invitations.length, 1);
  await fremmed(`/invitations/${a.groupId}`, { method: "DELETE" });
  assert.equal((await fremmed("/groups")).body.invitations.length, 0);
});

test("dele et barn: en annen foresatt får samme tilgang, og ingen kan fjerne den andre", async () => {
  const a = await setupFamily("del"); // a.parent er første foresatt for Ola
  const mor = a.parent;
  // Delingslenke på e-post til en som ikke har konto. Lenken slipper registreringskoden og gir tilgang.
  const share = await mor(`/children/${a.childId}/share`, { method: "POST", body: { email: "del-far@example.com" } });
  assert.equal(share.status, 201);
  assert.equal(share.body.status, "sent");
  const token = share.body.url.match(/#barn=([0-9a-f]{64})/)[1];
  assert.match(outbox.findLast((m) => m.to === "del-far@example.com").text, new RegExp(token));
  const anon = client();
  assert.deepEqual((await anon(`/shares/${token}`)).body, { inviter: "Mamma", child: "Ola", email: "del-far@example.com" });
  const far = client();
  assert.equal((await far("/register", { method: "POST", body: { displayName: "Pappa", email: "del-far@example.com", password: "hemmelig123", share: token } })).status, 201);
  await verifyEmail("del-far@example.com");
  // Mor får beskjed, og lenken er brukt opp.
  assert.match(outbox.findLast((m) => m.to === "del@example.com").subject, /Pappa er nå foresatt for Ola/);
  assert.equal((await anon(`/shares/${token}`)).status, 404);

  // Far ser barnet, gruppa, innleggene og voksenkontakten, og kan endre grenser.
  const { body: { children } } = await far("/children");
  assert.deepEqual(children[0].guardians.map((g) => [g.displayName, g.me]), [["Mamma", false], ["Pappa", true]]);
  assert.equal((await far("/groups")).body.groups[0].id, a.groupId);
  assert.equal((await far(`/groups/${a.groupId}/posts`)).status, 200);
  assert.equal((await far(`/groups/${a.groupId}/adult`)).status, 200);
  assert.equal((await far(`/children/${a.childId}`, { method: "PATCH", body: { dailyMinutes: 30 } })).status, 200);
  assert.equal((await mor("/children")).body.children[0].dailyMinutes, 30);

  // Ingen av dem kan slette barnet mens det er to foresatte, og ingen kan fjerne den andre.
  assert.equal((await far(`/children/${a.childId}`, { method: "DELETE" })).status, 409);
  assert.equal((await mor(`/children/${a.childId}`, { method: "DELETE" })).status, 409);
  // Mor fjerner seg selv. Far er nå eneste foresatt og kan slette.
  assert.equal((await mor(`/children/${a.childId}/leave`, { method: "POST" })).status, 200);
  assert.equal((await mor("/children")).body.children.length, 0);
  assert.equal((await mor(`/children/${a.childId}`, { method: "PATCH", body: { dailyMinutes: 10 } })).status, 404);
  assert.equal((await far(`/children/${a.childId}/leave`, { method: "POST" })).status, 409, "den siste kan ikke gå");

  // En som allerede har konto, tar imot en lenke mens hen er innlogget. Sletter hen kontoen sin, beholdes barnet.
  const ny = client();
  await registerParent(ny, "del-ny@example.com", "Ny");
  const link = await far(`/children/${a.childId}/share`, { method: "POST", body: {} });
  assert.equal(link.body.status, null);
  assert.equal((await ny(`/shares/${link.body.url.split("=")[1]}/accept`, { method: "POST" })).body.child, "Ola");
  assert.equal((await far("/me", { method: "DELETE" })).status, 200);
  assert.equal((await ny("/children")).body.children[0].displayName, "Ola");
  assert.equal((await a.kid("/me")).status, 200, "barnet er ikke slettet");
  // Fremmede kan ikke dele et barn som ikke er deres.
  assert.equal((await mor(`/children/${a.childId}/share`, { method: "POST", body: {} })).status, 404);
});

test("migrering: barn fra før flere foresatte fantes, får den som laget dem som foresatt", () => {
  const file = join(mkdtempSync(join(tmpdir(), "some-mig-")), "db.sqlite");
  const old = openDb(file);
  old.exec("DELETE FROM guardians; PRAGMA user_version = 4");
  old.prepare("INSERT INTO users (id, username, password_hash, role, display_name, created_at) VALUES (1, 'p', 'x', 'parent', 'P', 0)").run();
  old.prepare("INSERT INTO users (id, username, password_hash, role, display_name, parent_id, created_at) VALUES (2, 'c', 'x', 'child', 'C', 1, 0)").run();
  old.close();
  const db5 = openDb(file);
  assert.deepEqual({ ...db5.prepare("SELECT child_id, parent_id FROM guardians").get() }, { child_id: 2, parent_id: 1 });
  assert.equal(db5.prepare("PRAGMA user_version").get().user_version, 5);
  db5.close();
  rmSync(dirname(file), { recursive: true, force: true });
});

test("admin: bare administratoren slipper inn, og statistikken er bare tall", async () => {
  const a = await setupFamily("adm");
  const sjef = client();
  await registerParent(sjef, "adm-sjef@example.com", "Sjef");
  assert.equal((await sjef("/admin/stats")).status, 404, "vanlige foresatte ser ikke at admin finnes");
  const secret = await makeAdmin(sjef, "adm-sjef@example.com");
  assert.equal((await sjef("/me")).body.me.isAdmin, true);
  await post(a.kid, a.groupId, "Hei fra statistikken");
  const start = clock;
  clock += 864e5; // neste dag: i går blir en dagssum
  try {
    await sjef("/admin/mfa", { method: "POST", body: { code: codeAt(secret, Math.floor(clock / 30000)) } }); // ny kode etter 12 timer
    const { body } = await sjef("/admin/stats");
    assert.ok(body.totals.children >= 1 && body.totals.groups >= 1);
    const yesterday = body.days.find((d) => d.day === "2026-10-20");
    assert.ok(yesterday.posts >= 1);
    assert.deepEqual(Object.keys(yesterday).sort(), ["activeChildren", "day", "minutes", "newChildren", "newParents", "posts", "postsMedia", "reports"]);
  } finally {
    clock = start;
  }
  assert.equal((await a.parent("/admin/users?q=adm")).status, 404);
  assert.equal((await a.kid("/admin/stats")).status, 403);
});

test("admin: ser meldte innlegg og kan fjerne dem eller vise dem igjen", async () => {
  const a = await setupFamily("admr");
  const b = await secondParent(a, "admr");
  const sjef = client();
  await registerParent(sjef, "admr-sjef@example.com", "Sjef");
  await makeAdmin(sjef, "admr-sjef@example.com");
  const { body: { posts: [p] } } = await (await post(a.kid, a.groupId, "Et innlegg som blir meldt"), a.kid("/feed"));
  // Innlegg som ikke er meldt, ser ikke administratoren.
  assert.equal((await sjef("/admin/reports")).body.posts.some((x) => x.id === p.id), false);
  const tor = client();
  await tor("/login", { method: "POST", body: { username: "admr-tor", password: "tor12345" } });
  await tor(`/posts/${p.id}/report`, { method: "POST" });
  const reported = (await sjef("/admin/reports")).body.posts.find((x) => x.id === p.id);
  assert.equal(reported.text, "Et innlegg som blir meldt");
  assert.equal(reported.reports, 1);
  await sjef(`/admin/posts/${p.id}`, { method: "POST", body: { action: "restore" } });
  assert.equal((await sjef("/admin/reports")).body.posts.some((x) => x.id === p.id), false);
  assert.equal((await tor("/feed")).body.posts.some((x) => x.id === p.id), true);
  assert.match((await sjef("/admin/log")).body.log[0].action, /viste innlegg igjen/);
  void b;
});

test("admin: utestenging av foresatt stenger barn uten annen foresatt, og e-posten kan ikke brukes igjen", async () => {
  const a = await setupFamily("ban"); // mor med Ola
  const sjef = client();
  await registerParent(sjef, "ban-sjef@example.com", "Sjef");
  await makeAdmin(sjef, "ban-sjef@example.com");
  // Lise har to barn: Kari (bare Lise) og Ola deles med mor.
  const lise = client();
  await registerParent(lise, "ban-lise@example.com", "Lise");
  await lise("/children", { method: "POST", body: { username: "ban-kari", password: "kari12345", displayName: "Kari", avatar: "c09" } });
  const link = await a.parent(`/children/${a.childId}/share`, { method: "POST", body: {} });
  await lise(`/shares/${link.body.url.split("=")[1]}/accept`, { method: "POST" });
  const kari = client();
  await kari("/login", { method: "POST", body: { username: "ban-kari", password: "kari12345" } });

  const found = (await sjef("/admin/users?q=ban-lise")).body.users;
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].related.sort(), ["Kari", "Ola"]);
  assert.equal((await sjef(`/admin/users/${found[0].id}/suspend`, { method: "POST", body: {} })).status, 400, "grunn kreves");
  const res = await sjef(`/admin/users/${found[0].id}/suspend`, { method: "POST", body: { reason: "Truende meldinger" } });
  assert.deepEqual(res.body.alsoSuspended, ["Kari"]);
  // Lise og Kari er logget ut og kommer ikke inn. Ola har mor igjen og kan fortsatt logge inn.
  assert.equal((await lise("/me")).status, 401);
  assert.equal((await kari("/me")).status, 401);
  assert.equal((await client()("/login", { method: "POST", body: { login: "ban-lise@example.com", password: "hemmelig123" } })).body.code, "SUSPENDED");
  assert.equal((await client()("/login", { method: "POST", body: { username: "ban-kari", password: "kari12345" } })).status, 403);
  assert.equal((await a.kid("/me")).status, 200);
  // Samme e-post kan ikke brukes til en ny konto eller invitasjon.
  assert.equal((await client()("/register", { method: "POST", body: { displayName: "Lise", email: "BAN-lise@example.com", password: "hemmelig123" } })).status, 403);
  assert.deepEqual((await a.parent("/invites", { method: "POST", body: { emails: ["ban-lise@example.com"] } })).body.results, [{ email: "ban-lise@example.com", status: "blocked" }]);
  assert.equal((await sjef(`/admin/users/${(await sjef("/admin/users?q=ban-sjef")).body.users[0].id}/suspend`, { method: "POST", body: { reason: "test" } })).status, 400);

  // Åpner man Lise igjen, åpnes også Kari.
  assert.deepEqual((await sjef(`/admin/users/${found[0].id}/unsuspend`, { method: "POST" })).body.alsoOpened, ["Kari"]);
  assert.equal((await client()("/login", { method: "POST", body: { username: "ban-kari", password: "kari12345" } })).status, 200);
  assert.equal((await client()("/login", { method: "POST", body: { login: "ban-lise@example.com", password: "hemmelig123" } })).status, 200);
  assert.deepEqual((await sjef("/admin/log")).body.log.slice(0, 2).map((l) => l.action), ["åpnet", "stengte"]);
});

test("admin: to-trinns innlogging kreves, og en kode kan ikke brukes to ganger", async () => {
  const sjef = client();
  await registerParent(sjef, "mfa-sjef@example.com", "Sjef");
  db.prepare("UPDATE users SET is_admin = 1 WHERE email = ?").run("mfa-sjef@example.com");
  assert.equal((await sjef("/admin/stats")).body.code, "MFA_SETUP");
  const { body: setup } = await sjef("/admin/mfa/setup", { method: "POST" });
  assert.match(setup.uri, /^otpauth:\/\/totp\/quipu/);
  assert.equal((await sjef("/admin/mfa/confirm", { method: "POST", body: { code: "000000" } })).status, 400);
  const step = Math.floor(clock / 30000);
  assert.equal((await sjef("/admin/mfa/confirm", { method: "POST", body: { code: codeAt(setup.secret, step) } })).status, 200);
  assert.equal((await sjef("/admin/stats")).status, 200);
  // En ny enhet må skrive inn kode. Samme kode som ble brukt i stad, godtas ikke.
  const annen = client();
  await annen("/login", { method: "POST", body: { login: "mfa-sjef@example.com", password: "hemmelig123" } });
  assert.equal((await annen("/admin/stats")).body.code, "MFA_REQUIRED");
  assert.equal((await annen("/admin/mfa", { method: "POST", body: { code: codeAt(setup.secret, step) } })).status, 400);
  const start = clock;
  clock += 30000;
  try {
    assert.equal((await annen("/admin/mfa", { method: "POST", body: { code: codeAt(setup.secret, step + 1) } })).status, 200);
    assert.equal((await annen("/admin/stats")).status, 200);
    // Etter 12 timer må koden skrives inn igjen.
    clock += 13 * 3600e3;
    assert.equal((await annen("/admin/stats")).body.code, "MFA_REQUIRED");
  } finally {
    clock = start;
  }
});

test("barn kan si fra med kategori, og om noe annet direkte til administrator", async () => {
  const a = await setupFamily("sf");
  const b = await secondParent(a, "sf");
  const sjef = client();
  await registerParent(sjef, "sf-sjef@example.com", "Sjef");
  await makeAdmin(sjef, "sf-sjef@example.com");
  await post(a.kid, a.groupId, "Kom til parken alene i kveld");
  const { body: { posts: [p] } } = await a.kid("/feed");
  const tor = client();
  await tor("/login", { method: "POST", body: { username: "sf-tor", password: "tor12345" } });
  await tor(`/posts/${p.id}/report`, { method: "POST", body: { category: "kontakt" } });
  const rep = await sjef("/admin/reports");
  assert.equal(rep.status, 200, JSON.stringify(rep.body));
  const reported = rep.body.posts.find((x) => x.id === p.id);
  assert.deepEqual(reported.categories, ["kontakt"]);
  assert.equal(reported.serious, true);
  // Forfatteren sletter innlegget, men det er meldt: det skjules og blir liggende. Administrator bevarer det.
  await a.kid(`/posts/${p.id}`, { method: "DELETE" });
  assert.equal(db.prepare("SELECT status FROM posts WHERE id = ?").get(p.id).status, "removed");
  await sjef(`/admin/posts/${p.id}`, { method: "POST", body: { action: "hold" } });
  db.prepare("UPDATE posts SET created_at = created_at - ? WHERE id = ?").run(40 * 864e5, p.id); // eldre enn 30 dager
  app.locals.cleanup();
  assert.ok(db.prepare("SELECT 1 FROM posts WHERE id = ?").get(p.id), "bevart innlegg slettes ikke");
  assert.equal((await sjef("/admin/reports")).body.posts.find((x) => x.id === p.id).hold, true);

  // «Si fra om noe annet» går bare til administrator.
  assert.equal((await tor("/safety", { method: "POST", body: { category: "kontakt", text: "En voksen sendte meg rare meldinger" } })).status, 201);
  assert.equal((await b("/admin/safety")).status, 404);
  const { body: { reports } } = await sjef("/admin/safety");
  const mine = reports.find((r) => r.text === "En voksen sendte meg rare meldinger");
  assert.equal(mine.child.username, "sf-tor");
  assert.equal(mine.serious, true);
  await sjef(`/admin/safety/${mine.id}`, { method: "POST", body: { note: "Snakket med foresatt" } });
  assert.equal((await sjef("/admin/safety")).body.reports.find((r) => r.id === mine.id).resolved, true);
  assert.equal((await b("/safety", { method: "POST", body: { text: "hei" } })).status, 403, "bare barn");
});

test("innlogginger: foresatte ser enhetene sine, kan logge dem ut, og får e-post om nye", async () => {
  const mor = client();
  await registerParent(mor, "inn@example.com", "Mor");
  const iphone = client();
  const ua = { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" };
  const before = outbox.length;
  await iphone("/login", { method: "POST", body: { login: "inn@example.com", password: "hemmelig123" }, headers: ua });
  const mail = outbox.slice(before).find((m) => m.to === "inn@example.com");
  assert.match(mail.text, /iPhone · Safari/);
  // Samme type enhet igjen: ingen ny e-post.
  const n = outbox.length;
  await client()("/login", { method: "POST", body: { login: "inn@example.com", password: "hemmelig123" }, headers: ua });
  assert.equal(outbox.length, n);

  const { body: { sessions } } = await mor("/sessions");
  assert.equal(sessions.length, 3);
  assert.equal(sessions.filter((x) => x.current).length, 1);
  const phone = sessions.find((x) => x.device === "iPhone · Safari");
  await mor(`/sessions/${phone.id}`, { method: "DELETE" });
  assert.equal((await mor("/sessions")).body.sessions.length, 2);
  assert.equal((await mor("/sessions/others", { method: "POST" })).body.loggedOut, 1);
  assert.equal((await mor("/sessions")).body.sessions.length, 1);
  assert.equal((await mor("/me")).status, 200, "denne enheten er fortsatt logget inn");
  // Passordbytte gir e-post.
  await mor("/me/password", { method: "POST", body: { current: "hemmelig123", password: "nytt-passord-456" } });
  assert.match(outbox.findLast((m) => m.to === "inn@example.com").subject, /Passordet ditt i quipu er endret/);
});

test("bremsen mot passordgjetting lagres i databasen og gjelder etter omstart", async () => {
  const p = client();
  await registerParent(p, "brems@example.com", "Brems");
  for (let i = 0; i < 5; i++) await client()("/login", { method: "POST", body: { login: "brems@example.com", password: "feil" } });
  // En ny app med samme database (som etter en omstart) husker forsøkene.
  const app2 = createApp({ db, mediaDir, now: () => clock, mailer });
  const srv = app2.listen(0);
  await new Promise((r) => srv.once("listening", r));
  try {
    const res = await fetch(`http://localhost:${srv.address().port}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "brems@example.com", password: "hemmelig123" }) });
    assert.equal(res.status, 429);
  } finally {
    srv.close();
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE key_hash LIKE '%@%'").get().n, 0, "bare hash lagres");
});

test("grupper og lenker: eieren tar ut barn og bytter kode, og lenker kan trekkes tilbake", async () => {
  const a = await setupFamily("gl");
  const b = await secondParent(a, "gl"); // Tor er med
  const tor = (await b("/children")).body.children[0];
  // Eieren tar Tor ut. Han mister tilgangen med en gang, og foresatte får e-post.
  const owner = (await a.parent("/groups")).body.groups[0];
  assert.ok(owner.members.find((m) => m.displayName === "Tor").id);
  assert.equal((await b("/groups")).body.groups[0].members.every((m) => m.id === undefined), true, "bare eieren ser id-er");
  assert.equal((await b(`/groups/${a.groupId}/members/${tor.id}`, { method: "POST", body: { action: "remove" } })).status, 404, "bare eieren");
  assert.equal((await a.parent(`/groups/${a.groupId}/members/${tor.id}`, { method: "POST", body: { action: "remove" } })).status, 200);
  assert.match(outbox.findLast((m) => m.to === "gl-far@example.com").subject, /Tor er tatt ut av Klasse 4B/);
  assert.equal((await b("/groups")).body.groups.length, 0);
  // Et barn som bare venter, tas ikke ut på denne måten (det avslås).
  await b("/groups/join", { method: "POST", body: { code: a.code, childId: tor.id } });
  assert.equal((await a.parent(`/groups/${a.groupId}/members/${tor.id}`, { method: "POST", body: { action: "remove" } })).status, 404);
  await a.parent(`/groups/${a.groupId}/members/${tor.id}`, { method: "POST", body: { action: "reject" } });

  // Ny kode: den gamle virker ikke lenger.
  const { body: { inviteCode } } = await a.parent(`/groups/${a.groupId}/code`, { method: "POST" });
  assert.notEqual(inviteCode, a.code);
  assert.equal((await b("/groups/join", { method: "POST", body: { code: a.code, childId: tor.id } })).status, 404);
  assert.equal((await b(`/groups/${a.groupId}/code`, { method: "POST" })).status, 404, "bare eieren");

  // Invitasjoner og delingslenker kan trekkes tilbake.
  const inv = await a.parent("/invites", { method: "POST", body: { groupId: a.groupId } });
  const share = await a.parent(`/children/${a.childId}/share`, { method: "POST", body: {} });
  const { body: { links } } = await a.parent("/invites");
  assert.deepEqual(links.map((l) => l.kind).sort(), ["invite", "share"]);
  for (const l of links) await a.parent(`/invites/${l.id}`, { method: "DELETE" });
  assert.equal((await client()(`/invites/${inv.body.url.split("=")[1]}`)).status, 404);
  assert.equal((await client()(`/shares/${share.body.url.split("=")[1]}`)).status, 404);
  assert.equal((await b("/invites")).body.links.length, 0);
});

test("de andre foresatte får e-post når grenser eller passord for barnet endres", async () => {
  const a = await setupFamily("gr");
  const far = client();
  await registerParent(far, "gr-far@example.com", "Pappa");
  const link = await a.parent(`/children/${a.childId}/share`, { method: "POST", body: {} });
  await far(`/shares/${link.body.url.split("=")[1]}/accept`, { method: "POST" });
  const n = outbox.length;
  await far(`/children/${a.childId}`, { method: "PATCH", body: { dailyMinutes: 45, password: "nytt-passord-1" } });
  const mail = outbox.slice(n).find((m) => m.to === "gr@example.com");
  assert.match(mail.subject, /Pappa endret innstillingene for Ola/);
  assert.match(mail.text, /Skjermtid fra 20 til 45 minutter/);
  assert.match(mail.text, /Nytt passord/);
  assert.equal(outbox.slice(n).some((m) => m.to === "gr-far@example.com"), false, "ikke til den som endret");
});

test("eksport: en foresatt laster ned alt quipu har om seg og barna", async () => {
  const a = await setupFamily("eks");
  await post(a.kid, a.groupId, "Dette er mitt innlegg");
  const { status, headers, body } = await a.parent("/me/export");
  assert.equal(status, 200);
  assert.match(headers.get("content-disposition"), /attachment; filename="quipu-data-/);
  assert.equal(body.konto.epost, "eks@example.com");
  assert.equal(body.barn[0].navn, "Ola");
  assert.equal(body.barn[0].innlegg[0].tekst, "Dette er mitt innlegg");
  assert.equal((await a.kid("/me/export")).status, 403);
});
