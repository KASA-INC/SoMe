// Røyktester i en ekte nettleser (Chromium via Playwright). Kjøres med `npm run test:browser`.
// De fanger feil som bare finnes i klienten (public/app.js), som API-testene ikke ser.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { openDb } from "../../server/db.js";
import { createApp } from "../../server/app.js";

const fixture = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

// Fast klokke: tirsdag kl. 12:00 i Oslo, som i API-testene.
const clock = Date.parse("2026-10-20T10:00:00Z");
const mediaDir = mkdtempSync(join(tmpdir(), "some-browser-media-"));
const outbox = []; // e-poster som appen «sender» i testene
const mailer = { send: async (mail) => { outbox.push(mail); } };
const push = { send: async () => ({ gone: false }) };

// I skymiljøet ligger Chromium her. Lokalt brukes Playwrights egen, eller CHROMIUM_PATH.
const executablePath = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

let server, base, browser;
before(async () => {
  const app = createApp({
    db: openDb(), push, mediaDir, mailer, now: () => clock, appUrl: "https://some.example",
    mediaLimits: { videoSeconds: 30, videoMb: 5, imageMb: 5 },
  });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://localhost:${server.address().port}`;
  // En vanlig Chromium må ha --headless=new. Playwrights egen bruker sitt eget «headless shell».
  browser = await chromium.launch(executablePath ? { executablePath, args: ["--headless=new"] } : {});
});
after(async () => {
  await browser?.close();
  server?.close();
  rmSync(mediaDir, { recursive: true, force: true });
});

// Test med nettleserøkter som feiler ved JavaScript-feil eller feil i konsollen.
// Ved første feil lukkes økten, så testen stopper med en gang og viser feilen i stedet for å vente til tidsavbrudd.
function browserTest(name, fn) {
  test(name, async (t) => {
    t.errors = [];
    t.contexts = [];
    let failure;
    try { await fn(t); } catch (err) { failure = err; }
    await Promise.all(t.contexts.map((c) => c.close()));
    if (t.errors.length) throw new Error(`Nettleseren fikk feil:\n${t.errors.join("\n")}`, { cause: failure });
    if (failure) throw failure;
  });
}

// Ny nettleserøkt med egen cookie. Den forventede 401 fra /api/me når man ikke er logget inn, er ikke en feil.
async function session(t) {
  const context = await browser.newContext({ baseURL: base, reducedMotion: "reduce" });
  context.setDefaultTimeout(10_000);
  t.contexts.push(context);
  const page = await context.newPage();
  const fail = (msg) => { t.errors.push(msg); context.close().catch(() => {}); };
  page.on("pageerror", (err) => fail(`pageerror: ${err.stack || err.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const url = msg.location()?.url || "";
    if (/status of 401/.test(msg.text()) && url.endsWith("/api/me")) return;
    fail(`console: ${msg.text()} (${url})`);
  });
  // API-kall med samme cookie som nettleseren.
  const api = async (path, { method = "GET", body } = {}) => {
    const res = await context.request.fetch(`/api${path}`, {
      method, headers: method === "GET" ? {} : { "Content-Type": "application/json" }, data: method === "GET" ? undefined : body || {},
    });
    assert.ok(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`);
    return res.json();
  };
  return { page, api };
}

const ready = (page) => page.locator("#splash").waitFor({ state: "detached" });

// Foresatt: registrering via API, bekreftelseslenken fra e-posten åpnes i nettleseren.
async function parent(t, email, displayName) {
  const s = await session(t);
  await s.api("/register", { method: "POST", body: { password: "hemmelig123", displayName, email } });
  const mail = outbox.findLast((m) => m.to === email && /#verify=/.test(m.text));
  const token = mail.text.match(/#verify=([0-9a-f]{64})/)[1];
  await s.page.goto(`/#verify=${token}`);
  await ready(s.page);
  await s.page.getByText("E-postadressen er bekreftet").waitFor();
  await s.page.getByRole("tab", { name: "Barn" }).waitFor();
  return s;
}

async function addChild(api, username, displayName) {
  await api("/children", { method: "POST", body: { username, password: "barn12345", displayName, avatar: "c03" } });
  const { children } = await api("/children");
  const child = children.find((c) => c.username === username);
  await api(`/children/${child.id}`, { method: "PATCH", body: { openFrom: "00:00", openTo: "23:59" } });
  return child;
}

// Innlogging i appen. Første gang et barn logger inn, vises introduksjonen.
async function login(t, username, password) {
  const s = await session(t);
  await s.page.goto("/");
  await ready(s.page);
  await s.page.locator('input[name="login"]').fill(username);
  await s.page.locator('input[name="password"]').fill(password);
  await s.page.getByRole("button", { name: "Logg inn" }).click();
  return s;
}

async function childLogin(t, username, { firstTime = false } = {}) {
  const s = await login(t, username, "barn12345");
  if (firstTime) {
    for (let i = 0; i < 3; i++) await s.page.getByRole("button", { name: "Neste" }).click();
    await s.page.getByRole("button", { name: "Jeg forstår" }).click();
  }
  await s.page.locator(".composer-inline").waitFor();
  return s;
}

let group; // gruppa som lages i første test og brukes videre

browserTest("foresatt registrerer seg, lager gruppe og barn og setter åpningstider", async (t) => {
  const owner = await parent(t, "eier@example.com", "Mamma");
  group = await owner.api("/groups", { method: "POST", body: { name: "Klasse 4B" } });
  const child = await addChild(owner.api, "ola", "Ola");
  await owner.api("/groups/join", { method: "POST", body: { code: group.inviteCode, childId: child.id } });

  // Det samme vises i appen.
  await owner.page.reload();
  await owner.page.locator(".card", { hasText: "Ola" }).first().waitFor();
  const { children } = await owner.api("/children");
  assert.equal(children[0].openFrom, "00:00");
  assert.equal(children[0].openTo, "23:59");
});

browserTest("barn deler et innlegg med bilde", async (t) => {
  const { page } = await childLogin(t, "ola", { firstTime: true });
  await page.locator(".composer-inline textarea").click();
  const preview = page.locator(".composer-inline .preview");
  // Først velges et bilde og fjernes igjen, så velges det på nytt.
  await page.locator("#fileInput").setInputFiles(fixture("plain.jpg"));
  await preview.getByText("Bilde lagt til").waitFor();
  await preview.getByRole("button", { name: "Fjern" }).click();
  await preview.waitFor({ state: "hidden" });
  await page.locator("#fileInput").setInputFiles(fixture("plain.jpg"));
  await preview.getByText("Bilde lagt til").waitFor();
  await page.locator(".composer-inline textarea").fill("Jeg tegnet en drage i dag");
  await page.locator(".composer-foot .btn", { hasText: "Del" }).click();
  const post = page.locator(".post", { hasText: "Jeg tegnet en drage i dag" });
  await post.locator(".media img").waitFor();
  assert.match(await post.locator(".media img").getAttribute("src"), /^\/api\/media\//);
});

browserTest("barn bytter profilbilde", async (t) => {
  const { page, api } = await childLogin(t, "ola");
  await page.locator(".avatar-btn").click();
  const sheet = page.getByRole("dialog", { name: "Velg profilbilde" });
  await sheet.locator('.avatar-pick button[aria-label="Profilbilde 7"]').click();
  await sheet.getByRole("button", { name: "Bruk dette" }).click();
  await page.getByText("Profilbildet er byttet").waitFor();
  await page.locator('.avatar-btn img[src="/avatars/c07.svg"]').waitFor();
  assert.equal((await api("/me")).me.avatar, "c07");
});

browserTest("eieren godkjenner barnet til en annen familie", async (t) => {
  const other = await parent(t, "far@example.com", "Pappa");
  const kari = await addChild(other.api, "kari", "Kari");
  await other.api("/groups/join", { method: "POST", body: { code: group.inviteCode, childId: kari.id } });

  const { page } = await login(t, "eier@example.com", "hemmelig123");
  await page.getByRole("tab", { name: /Grupper/ }).click();
  const pending = page.locator(".pending-members .list-row", { hasText: "Kari" });
  await pending.getByText("Foresatt: Pappa · far@example.com").waitFor();
  await pending.getByRole("button", { name: "Godta" }).click();
  await page.getByText("Kari er med i Klasse 4B").waitFor();
  await page.locator(".pending-members").waitFor({ state: "detached" });
});
