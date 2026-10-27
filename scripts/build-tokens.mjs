// Bygger public/tokens.css fra design/tokens.json, som er den samme tokenfila som designsystemet bruker.
// Sjekker også at tekst og flater holder WCAG-kontrast i begge moduser, og stopper hvis ikke.
//   npm run tokens          skriv public/tokens.css
//   npm run tokens -- --check   bare sjekk at fila er oppdatert (brukes av testene)
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const tokens = JSON.parse(readFileSync(new URL("design/tokens.json", ROOT), "utf8"));
const [light, dark] = tokens.color.themes.map((t) => t.id);

const value = (t, theme) => (typeof t.value === "string" ? t.value : t.value[theme] ?? t.value[light]);
const css = (v) => v.replace(/\{([\w.-]+)\}/g, "var(--$1)");

export function buildCss() {
  const decl = (list, theme) => list.map((t) => `  --${t.name}: ${css(value(t, theme))};`).join("\n");
  const colors = tokens.color.tokens;
  const shadows = tokens.shadow.tokens;
  // I mørk modus deklareres bare det som er annerledes enn i lys.
  const differs = (t) => typeof t.value !== "string" && value(t, dark) !== value(t, light);
  const fixed = [...tokens.spacing.tokens, ...tokens.radius.tokens];
  const fam = Object.entries(tokens.type.families).map(([k, v]) => `  --font-${k}: ${v};`).join("\n");
  // Tekststørrelsene: --fs-<stil>, og --fs-display-sm for den største overskriften på mobil.
  const sizes = tokens.type.groups.flatMap((g) => g.styles).flatMap((st) => [
    `  --fs-${st.name}: ${st.rem};`, ...(st.remMobile ? [`  --fs-${st.name}-sm: ${st.remMobile};`] : [])]).join("\n");
  return `/* quiply — generert fra design/tokens.json med «npm run tokens». Ikke rediger for hånd. */
:root {
${decl(colors, light)}
${decl(shadows, light)}
${decl(fixed, light)}
${fam}
${sizes}
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root {
${decl(colors.filter(differs), dark).replace(/^/gm, "  ")}
${decl(shadows.filter(differs), dark).replace(/^/gm, "  ")}
    color-scheme: dark;
  }
}
`;
}

// ---------- Kontrast (WCAG 2) ----------
function resolve(name, theme, seen = 0) {
  const t = tokens.color.tokens.find((x) => x.name === name);
  if (!t || seen > 16) throw new Error(`Ukjent farge: ${name}`);
  const v = value(t, theme);
  const alias = v.match(/^\{([\w.-]+)\}$/);
  return alias ? resolve(alias[1], theme, seen + 1) : v;
}
const lum = (hex) => {
  const c = hex.replace("#", "").match(/../g).map((x) => parseInt(x, 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Tekst på flatene den står på (4,5:1), og markeringer som må synes (3:1).
const PAIRS = [
  ...["bg", "surface", "surface-2"].flatMap((g) => ["text", "text-2", "text-3"].map((f) => [f, g, 4.5])),
  ["on-bg", "bg", 4.5], ["on-bg-2", "bg", 4.5],
  ["accent-ink", "accent", 4.5], ["accent-soft-ink", "accent-soft", 4.5], ["danger", "danger-soft", 4.5], ["danger-ink", "danger", 4.5],
  ["warn", "warn-soft", 4.5], ["bubble-ink", "bubble", 4.5], ["bubble-mine-ink", "bubble-mine", 4.5],
  ["accent", "surface", 3], ["accent", "bg", 3], ["brand", "bg", 3], ["icon-mark", "icon-tile", 3],
];
export function checkContrast() {
  const fails = [];
  for (const theme of [light, dark]) {
    for (const [fg, bg, min] of PAIRS) {
      const r = ratio(resolve(fg, theme), resolve(bg, theme));
      if (r < min) fails.push(`${theme}: ${fg} på ${bg} er ${r.toFixed(2)}:1 (krav ${min}:1)`);
    }
  }
  return fails;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fails = checkContrast();
  if (fails.length) { console.error("For lav kontrast:\n" + fails.join("\n")); process.exit(1); }
  const out = new URL("public/tokens.css", ROOT);
  if (process.argv.includes("--check")) {
    if (readFileSync(out, "utf8") !== buildCss()) { console.error("public/tokens.css er utdatert. Kjør npm run tokens."); process.exit(1); }
    console.log("public/tokens.css er oppdatert, og kontrasten holder.");
  } else {
    writeFileSync(out, buildCss());
    console.log("Skrev public/tokens.css. Kontrasten holder i begge moduser.");
  }
}
