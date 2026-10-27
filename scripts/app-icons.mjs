// Lager appikonene i public/icons/ fra logoen i brand.js og fargene i design/tokens.json.
// Lys modus: champ merke på serenity. Mørk modus: champ merke på nesten svart.
// Kjør på nytt hvis logoen eller ikonfargene endres (krever Playwright og Chromium):
//   npm install --no-save playwright && node scripts/app-icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import * as brand from "../public/brand.js";

const tokens = JSON.parse(readFileSync(new URL("../design/tokens.json", import.meta.url), "utf8"));
const colors = Object.fromEntries(tokens.color.tokens.map((t) => [t.name, t.value]));
const hex = (v, theme) => {
  const x = typeof v === "string" ? v : v[theme];
  const ref = x.match(/^\{(.+)\}$/);
  return ref ? hex(colors[ref[1]], theme) : x;
};
const tile = { light: hex(colors["icon-tile"], "light"), dark: hex(colors["icon-tile"], "dark") };
const mark = { light: hex(colors["icon-mark"], "light"), dark: hex(colors["icon-mark"], "dark") };
const out = new URL("../public/icons/", import.meta.url);
const [x, y, size] = brand.MARK_VIEWBOX.split(" ").map(Number);
const rx = Math.round(size * 0.221); // samme runding som iOS bruker på ikoner

// Nettleserfanen: SVG som bytter farge med modusen.
writeFileSync(new URL("icon.svg", out), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${brand.MARK_VIEWBOX}">
  <style>
    /* Lys modus: champ merke på serenity. Mørk modus: champ merke på nesten svart. Lages av scripts/app-icons.mjs. */
    .tile { fill: ${tile.light}; } .mark { fill: ${mark.light}; }
    @media (prefers-color-scheme: dark) { .tile { fill: ${tile.dark}; } .mark { fill: ${mark.dark}; } }
  </style>
  <rect class="tile" x="${x}" y="${y}" width="${size}" height="${size}" rx="${rx}"/>
  <path class="mark" fill-rule="evenodd" d="${brand.MARK_PATH}"/>
</svg>
`);

// PNG-ene på hjemskjermen er den lyse varianten: iOS og Android lar ikke nettapper ha egne mørke ikoner.
// Maskable: Android kan klippe ikonet til en sirkel, så merket må ligge innenfor de midterste 80 %.
const cx = x + size / 2, cy = y + size / 2;
const maskSize = 1980;
const maskBox = `${cx - maskSize / 2} ${cy - maskSize / 2} ${maskSize} ${maskSize}`;
const svg = ({ box = brand.MARK_VIEWBOX, round = true }) => {
  const [bx, by, bs] = box.split(" ").map(Number);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="100%" height="100%" style="display:block">
    <rect x="${bx}" y="${by}" width="${bs}" height="${bs}" rx="${round ? Math.round(bs * 0.221) : 0}" fill="${tile.light}"/>
    <path fill="${mark.light}" fill-rule="evenodd" d="${brand.MARK_PATH}"/></svg>`;
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium", args: ["--headless=new"] });
for (const [file, px, opts] of [
  ["icon-192.png", 192, {}],
  ["icon-512.png", 512, {}],
  ["apple-touch-icon.png", 180, { round: false }], // iOS runder hjørnene selv
  ["icon-maskable-512.png", 512, { box: maskBox, round: false }],
]) {
  const page = await browser.newPage({ viewport: { width: px, height: px } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg(opts)}`);
  await page.screenshot({ path: new URL(file, out).pathname, omitBackground: opts.round !== false });
  await page.close();
}
await browser.close();
console.log("Skrev public/icons/");
