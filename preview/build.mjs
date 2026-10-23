// Bygger forhåndsvisningen av appen som en privat artifact i Claude, der man kan kommentere direkte på elementene.
// Alt bygges fra filene i public/, så forhåndsvisningen alltid viser det som ligger i repoet.
//   node preview/build.mjs   ->  preview/dist/ (index.html + om.html, hvem.html, sikkerhet.html, personvern.html, miljo.html, img/)
//
// Forskjeller fra den ekte appen:
// - Det finnes ingen server. preview/mock.js svarer på kallene til /api med eksempeldata fra preview/fixtures.json.
// - CSS, skrift, figurer og skript legges rett inn i sidene, fordi artifact-visningen bare tillater det.
// - Lenker til /om osv. peker på de andre sidene i forhåndsvisningen.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, rmSync } from "node:fs";

const PUB = new URL("../public/", import.meta.url);
const OUT = new URL("dist/", import.meta.url);
const read = (f) => readFileSync(new URL(f, PUB), "utf8");
const dataUri = (f, type) => `data:${type};base64,${readFileSync(new URL(f, PUB)).toString("base64")}`;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(new URL("img/", OUT), { recursive: true });
for (const f of readdirSync(new URL("img/", PUB))) copyFileSync(new URL(`img/${f}`, PUB), new URL(`img/${f}`, OUT));

const PAGES = { "/om": "om.html", "/hvem": "hvem.html", "/sikkerhet": "sikkerhet.html", "/personvern": "personvern.html", "/miljo": "miljo.html" };
// Lenker inne i forhåndsvisningen. Hovedsiden er «./».
function relink(s, quote) {
  for (const [path, file] of Object.entries(PAGES)) {
    s = s.replaceAll(`${quote}${path}${quote}`, `${quote}${file}${quote}`).replaceAll(`${quote}${path}#`, `${quote}${file}#`);
  }
  return s.replaceAll(`${quote}/#`, `${quote}./#`).replaceAll(`${quote}/${quote}`, `${quote}./${quote}`);
}

const css = (read("tokens.css") + "\n" + read("style.css"))
  .replace('url("fonts/red-hat-display.woff2")', `url("${dataUri("fonts/red-hat-display.woff2", "font/woff2")}")`);

const brandJs = read("brand.js").replace(/^export /gm, "");
const footerBody = read("footer.js")
  .replace(/^import[\s\S]*?from "\.\/[a-z]+\.js";\n/gm, "")
  .replace(/^export /gm, "");
const footerJs = `const fillFooter = (() => {\n${relink(footerBody, '"')}\nreturn fillFooter;\n})();`;

const avatars = Object.fromEntries(readdirSync(new URL("avatars/", PUB)).filter((f) => f.endsWith(".svg"))
  .map((f) => [f.replace(".svg", ""), dataUri(`avatars/${f}`, "image/svg+xml")]));
let appJs = read("app.js").replace(/^import[\s\S]*?from "\.\/[a-z]+\.js";\n/gm, "");
const avatarUrl = "`/avatars/${id}.svg`";
if (!appJs.includes(avatarUrl)) throw new Error("Fant ikke figur-adressen i app.js");
appJs = appJs.replace(avatarUrl, "PREVIEW_AVATARS[id]");
appJs = relink(appJs, '"');
appJs = `const PREVIEW_AVATARS = ${JSON.stringify(avatars)};\n${appJs}\nwindow.__quipuRestart = () => { stopTimers(); start(); };`;

// Plukker ut <title> og <body> fra en side i public/ og setter inn stil og skript.
function page(file, { scripts }) {
  const html = read(file);
  const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
  const bodyTag = html.match(/<body[^>]*>/)[0];
  let body = html.slice(html.indexOf(bodyTag) + bodyTag.length, html.lastIndexOf("</body>"));
  body = body.replace(/\s*<script[^>]*><\/script>/g, "");
  body = relink(body, '"');
  return { head: `${title}\n<meta name="color-scheme" content="light dark">\n<style>\n${css}\n</style>`, bodyTag, body: `${body}\n${scripts}\n` };
}

const fixtures = readFileSync(new URL("fixtures.json", import.meta.url), "utf8");
const mock = readFileSync(new URL("mock.js", import.meta.url), "utf8");
const switcher = `
<div class="preview-bar" role="region" aria-label="Forhåndsvisning">
  <span>Eksempeldata · vis som</span>
  <button type="button" data-as="child">Barn</button>
  <button type="button" data-as="parent">Foresatt</button>
  <button type="button" data-as="">Logget ut</button>
</div>
<style>
  .preview-bar { position: fixed; z-index: 100; left: 50%; transform: translateX(-50%); bottom: calc(8px + env(safe-area-inset-bottom, 0px));
    display: flex; gap: 4px; white-space: nowrap; align-items: center; justify-content: center; max-width: calc(100% - 16px);
    padding: 4px 6px 4px 12px; border-radius: 999px; background: var(--ink); color: var(--cream); font: 600 12px/1.2 var(--font-sans); box-shadow: var(--shadow-lg); opacity: .92; }
  .preview-bar button { font: inherit; color: inherit; background: transparent; border: 1px solid rgba(248, 248, 244, .35); border-radius: 999px; padding: 5px 10px; cursor: pointer; }
  .preview-bar button:hover { background: rgba(248, 248, 244, .14); }
  body.no-scroll .preview-bar { display: none; } /* ikke over knappene i et åpent ark */
  body { padding-bottom: 48px; }
</style>
<script>document.querySelector(".preview-bar").addEventListener("click", (e) => { const b = e.target.closest("button[data-as]"); if (b) window.__quipuPreview.as(b.dataset.as || null); });</script>`;

// Hovedsiden publiseres som artifact-siden: skjelettet lager <html>, <head> og <body>, så her står bare innholdet.
const main = page("index.html", {
  scripts: `<script>window.__QUIPU_FIXTURES__ = ${fixtures.trim()};</script>\n<script>\n${mock}\n</script>\n<script type="module">\n${brandJs}\n${footerJs}\n${appJs}\n</script>\n${switcher}`,
});
writeFileSync(new URL("index.html", OUT), `${main.head}\n${main.body}`);
// De andre sidene er egne filer med eget skjelett.
for (const file of Object.values(PAGES)) {
  const p = page(file, { scripts: `<script type="module">\n${brandJs}\n${footerJs}\n</script>` });
  writeFileSync(new URL(file, OUT), `<!doctype html>\n<html lang="no">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${p.head}\n</head>\n${p.bodyTag}\n${p.body}</body>\n</html>\n`);
}
console.log("Skrev preview/dist/");
