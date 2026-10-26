// Lager bildene som brukes i e-post: logoen og knappene. Gmail på iPhone snur fargene i e-poster
// i mørk modus, men lar bilder være, så logo og knapp ligger som bilder for å beholde riktige farger.
// Kjør på nytt hvis logoen eller en knappetekst endres (krever Playwright og Chromium):
//   npm install --no-save playwright && node scripts/email-assets.mjs
import { chromium } from "playwright";
import * as brand from "../public/brand.js";
import { EMAIL_BUTTONS } from "../server/email.js";

const out = new URL("../server/assets/", import.meta.url).pathname;
const CREAM = "#f8f8f4", FERSKEN = "#ff9e8a", INK = "#161619";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium", args: ["--headless=new"] });

async function shoot(html, file) {
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}#x{display:inline-block}</style><div id="x">${html}</div>`);
  await page.locator("#x").screenshot({ path: out + file, omitBackground: true });
  await page.close();
}

// Liggende logo i kremhvitt: Q-merket og ordbildet. Vises 138 × 50 px.
const [, , vw, vh] = brand.WORDMARK_VIEWBOX.split(" ").map(Number);
const H = 50, wordH = 27, wordW = (wordH * vw) / vh;
await shoot(`<svg width="${H + 9 + wordW}" height="${H}" style="display:block">
  <svg width="${H}" height="${H}" viewBox="${brand.MARK_TIGHT_VIEWBOX}"><path fill="${CREAM}" fill-rule="evenodd" d="${brand.MARK_PATH}"/></svg>
  <svg x="${H + 9}" y="${(H - wordH) / 2 + 2}" width="${wordW}" height="${wordH}" viewBox="${brand.WORDMARK_VIEWBOX}"><path fill="${CREAM}" fill-rule="evenodd" d="${brand.WORDMARK_PATH}"/></svg>
</svg>`, "email-logo.png");

// Knapper: fersken med nesten svart tekst, som i appens mørke modus.
for (const [label, file] of Object.entries(EMAIL_BUTTONS)) {
  await shoot(`<div style="background:${FERSKEN};color:${INK};border-radius:999px;padding:14px 28px;
    font:600 16px/20px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;white-space:nowrap">${label}</div>`, file);
}
await browser.close();
console.log("Laget bilder i server/assets/");
