// Lager eksempeldata til forhåndsvisningen: starter den ekte serveren med en tom database i minnet,
// fyller den med en klasse, foresatte, barn, innlegg og voksenkontakt, og lagrer svarene fra API-et
// i preview/fixtures.json. Mock-API-et i forhåndsvisningen (preview/mock.js) svarer med disse.
//   node preview/capture.mjs
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../server/db.js";
import { createApp } from "../server/app.js";
import { codeAt } from "../server/totp.js";

// Fast klokke: en tirsdag kl. 12:00 i Oslo, så appen er åpen. Tidene flyttes til «nå» i nettleseren.
let clock = Date.parse("2026-10-20T10:00:00Z");
const outbox = [];
const mediaDir = mkdtempSync(join(tmpdir(), "quipu-preview-"));
const db = openDb();
const app = createApp({ db, mediaDir, now: () => clock, mailer: { send: async (m) => { outbox.push(m); } }, push: { send: async () => ({}) }, appUrl: "https://www.quipu.no" });
const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
const base = `http://localhost:${server.address().port}/api`;

function client() {
  let cookie = "";
  return async (path, { method = "GET", body } = {}) => {
    const res = await fetch(base + path, { method, headers: { cookie, ...(method === "GET" ? {} : { "Content-Type": "application/json" }) }, body: method === "GET" ? undefined : JSON.stringify(body || {}) });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
    return data;
  };
}

async function parent(name, email) {
  const c = client();
  await c("/register", { method: "POST", body: { displayName: name, email, password: "hemmelig123" } });
  const token = outbox.findLast((m) => m.to === email).text.match(/#verify=([0-9a-f]{64})/)[1];
  await c("/email/verify", { method: "POST", body: { token } });
  return c;
}
async function kid(p, displayName, username, avatar, code, approve) {
  await p("/children", { method: "POST", body: { displayName, username, password: "passord123", avatar } });
  const { children } = await p("/children");
  const child = children.find((c) => c.username === username);
  if (code) await p("/groups/join", { method: "POST", body: { code, childId: child.id } });
  const k = client();
  await k("/login", { method: "POST", body: { username, password: "passord123" } });
  return { k, id: child.id };
}
const minutes = (n) => { clock += n * 60000; };

const kristin = await parent("Kristin", "kristin@example.com");
const thomas = await parent("Thomas", "thomas@example.com");
const hanne = await parent("Hanne", "hanne@example.com");
const lars = await parent("Lars", "lars@example.com");

const { inviteCode: code6b } = await kristin("/groups", { method: "POST", body: { name: "6B" } });
const { inviteCode: codeKorps } = await thomas("/groups", { method: "POST", body: { name: "Skolekorpset" } });
const { groups } = await kristin("/groups");
const g6b = groups.find((g) => g.name === "6B").id;
const korps = (await thomas("/groups")).groups.find((g) => g.name === "Skolekorpset").id;

const ola = await kid(kristin, "Ola", "ola", "c03", code6b);
const sara = await kid(thomas, "Sara", "sara", "c07", code6b);
const jonas = await kid(hanne, "Jonas", "jonas", "c15", code6b);
const mia = await kid(lars, "Mia", "mia", "c20", code6b);
for (const c of [sara, jonas]) await kristin(`/groups/${g6b}/members/${c.id}`, { method: "POST", body: { action: "approve" } });
// Mia venter på godkjenning, så den visningen også kan kommenteres.
await kristin("/groups/join", { method: "POST", body: { code: codeKorps, childId: ola.id } });
await thomas(`/groups/${korps}/members/${ola.id}`, { method: "POST", body: { action: "approve" } });
await thomas("/groups/join", { method: "POST", body: { code: codeKorps, childId: sara.id } });
await ola.k("/onboarded", { method: "POST" }).catch(() => {});

// To dager med innlegg
clock -= 2 * 24 * 3600000;
const say = (who, groupId, kind, text) => who.k("/posts", { method: "POST", body: { groupId, kind, text } });
await say(sara, g6b, "opplevd", "Vi så en rev på vei hjem fra skolen i dag! Den løp over veien og inn i skogen."); minutes(95);
await say(jonas, g6b, "sporsmal", "Er det noen som vet hva vi skal ha med på turdagen på fredag?"); minutes(12);
await say(ola, g6b, "", "Matpakke, drikke og sitteunderlag tror jeg. Og regntøy hvis det regner."); minutes(60 * 20);
await say(sara, korps, "gleder", "Gleder meg til konserten på lørdag! Vi har øvd så mye på den nye låta."); minutes(70);
await say(jonas, g6b, "laget", "Jeg har bygget en fuglekasse med bestefar. Nå håper jeg noen flytter inn i vår."); minutes(180);
await say(ola, g6b, "takk", "Takk til Sara som hjalp meg med brøkene i matten i dag."); minutes(60 * 20);
await say(sara, g6b, "tips", "Tips: Biblioteket har fått mange nye tegneserier. Jeg anbefaler den om dragene."); minutes(40);

await thomas(`/groups/${g6b}/adult`, { method: "POST", body: { text: "Hei alle! Husk foreldremøtet tirsdag kl. 18 i klasserommet. Det blir kaffe og kake." } }); minutes(25);
await hanne(`/groups/${g6b}/adult`, { method: "POST", body: { text: "Takk! Jeg kan ta med kake. Er det noen som kan kjøre til turdagen på fredag?" } }); minutes(8);
await kristin(`/groups/${g6b}/adult`, { method: "POST", body: { text: "Jeg kan kjøre, har plass til tre barn." } }); minutes(30);

// Jonas melder innlegget om turdagen, så administrasjonen har noe å vise. Kristin er administrator i forhåndsvisningen.
const jonasFeed = await jonas.k("/feed");
await jonas.k(`/posts/${jonasFeed.posts.find((p) => p.author === "Ola").id}/report`, { method: "POST" });
db.prepare("UPDATE users SET is_admin = 1 WHERE email = 'kristin@example.com'").run();
// To-trinns innlogging for administratoren i forhåndsvisningen.
const mfa = await kristin("/admin/mfa/setup", { method: "POST" });
await kristin("/admin/mfa/confirm", { method: "POST", body: { code: codeAt(mfa.secret, Math.floor(clock / 30000)) } });
// Ola sier fra om noe annet, og Kristin har sendt en invitasjon som ikke er brukt.
await ola.k("/safety", { method: "POST", body: { category: "mobbing", text: "Noen i 7A roper stygge ting etter meg i friminuttet" } });
await kristin("/invites", { method: "POST", body: { emails: ["erik@example.com"], groupId: g6b } });
app.locals.recordDailyStats();

const capturedAt = clock;
const childFix = { "/me": await ola.k("/me"), "/feed": await ola.k("/feed") };
childFix["/me"].me.onboarded = false; // introen vises første gang i forhåndsvisningen
const parentFix = {
  "/me": await kristin("/me"), "/children": await kristin("/children"), "/groups": await kristin("/groups"),
  "/notify": await kristin("/notify"),
  "/admin/stats": await kristin("/admin/stats"),
  "/admin/reports": await kristin("/admin/reports"),
  "/admin/log": await kristin("/admin/log"),
  "/admin/safety": await kristin("/admin/safety"),
  "/sessions": await kristin("/sessions"),
  "/invites": await kristin("/invites"),
};
// Alle kontoene, til søket i administrasjonen (søket krever minst to tegn).
const found = new Map();
for (const term of ["example", "ola", "sara", "jonas", "mia"]) for (const u of (await kristin(`/admin/users?q=${term}`)).users) found.set(u.id, u);
parentFix["/admin/users"] = { users: [...found.values()] };
for (const g of parentFix["/groups"].groups) {
  parentFix[`/groups/${g.id}/posts`] = await kristin(`/groups/${g.id}/posts`).catch(() => undefined);
  parentFix[`/groups/${g.id}/adult`] = await kristin(`/groups/${g.id}/adult`).catch(() => undefined);
}
const out = { capturedAt, signupInfo: await client()("/signup-info"), child: childFix, parent: parentFix };
writeFileSync(new URL("fixtures.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
server.close();
rmSync(mediaDir, { recursive: true, force: true });
console.log("Skrev preview/fixtures.json");
