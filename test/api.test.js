import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../server/db.js";
import { createApp } from "../server/app.js";
import { checkText } from "../server/filter.js";

// Fast klokke: tirsdag kl. 12:00 i Oslo. Kan flyttes i testene.
let clock = Date.parse("2026-10-20T10:00:00Z");
let server, base;

before(async () => {
  const app = createApp({ db: openDb(), now: () => clock });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());

// Liten klient som husker sin egen cookie.
function client() {
  let cookie = "";
  return async (path, { method = "GET", body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { cookie, ...(method === "GET" ? {} : { "Content-Type": "application/json" }) },
      body: method === "GET" ? undefined : JSON.stringify(body || {}),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, body: await res.json() };
  };
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

const post = (kid, groupId, text = "Jeg lærte å sykle i dag!") =>
  kid("/posts", { method: "POST", body: { groupId, kind: "laerte", text, color: "gul", sticker: "🚲" } });

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
