import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../server/db.js";
import { createApp } from "../server/app.js";
import { checkText } from "../server/filter.js";
import { createVapidKeys, encryptPayload, vapidHeader } from "../server/push.js";
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
  // Foresatte laster ikke opp; det gjør bare barn.
  assert.equal((await upload(a.parent, fixture("plain.jpg"))).status, 403);
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
