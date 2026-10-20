import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../server/db.js";
import { createApp } from "../server/app.js";
import { checkText } from "../server/filter.js";

const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url));

// Fast klokke: tirsdag kl. 12:00 i Oslo. Kan flyttes i testene.
let clock = Date.parse("2026-10-20T10:00:00Z");
let server, base;
const mediaDir = mkdtempSync(join(tmpdir(), "some-media-"));
const mediaLimits = { videoSeconds: 30, videoMb: 1, imageMb: 1 };

before(async () => {
  const app = createApp({ db: openDb(), mediaDir, mediaLimits, now: () => clock });
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

async function setupFamily(prefix) {
  const parent = client();
  assert.equal((await parent("/register", { method: "POST", body: { username: `${prefix}-mor`, password: "hemmelig123", displayName: "Mamma" } })).status, 201);
  const { body: g } = await parent("/groups", { method: "POST", body: { name: "Klasse 4B" } });
  assert.equal((await parent("/children", { method: "POST", body: { username: `${prefix}-ola`, password: "ola12345", displayName: "Ola", avatar: "🐸" } })).status, 201);
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
  await b("/register", { method: "POST", body: { username: "b-far", password: "hemmelig123", displayName: "Pappa" } });
  await b("/children", { method: "POST", body: { username: "b-kari", password: "kari1234", displayName: "Kari", avatar: "🦄" } });
  const { body: { children } } = await b("/children");
  await b("/groups/join", { method: "POST", body: { code: a.code, childId: children[0].id } });
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
  assert.equal((await post(a.kid, a.groupId)).status, 201);
  assert.equal((await post(a.kid, a.groupId)).status, 201);
  const third = await post(a.kid, a.groupId);
  assert.equal(third.status, 429);
  assert.equal(third.body.code, "POST_LIMIT");
});

test("rapportert innlegg skjules og kan gjenopprettes av gruppeeieren", async () => {
  const a = await setupFamily("f");
  await a.parent("/children", { method: "POST", body: { username: "f-per", password: "per12345", displayName: "Per", avatar: "🐼" } });
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
  await a.parent("/children", { method: "POST", body: { username: "m-per", password: "per12345", displayName: "Per", avatar: "🐼" } });
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
    body: JSON.stringify({ username: `kode-${code || "ingen"}`, password: "hemmelig123", displayName: "Voksen", code }),
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
