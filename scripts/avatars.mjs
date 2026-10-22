// Lager profilbildene til barna: 24 «Critters» fra DiceBear (CC0 1.0), farget med quipu-paletten.
// Filene legges i public/avatars/ og sendes fra vår egen server, så ingenting hentes fra andre nettsteder.
// Kjør på nytt hvis settet skal endres:
//   npm install --no-save @dicebear/core@10.7.0 @dicebear/styles@10.6.0 && node scripts/avatars.mjs
import { writeFileSync } from "node:fs";
import { Avatar, Style } from "@dicebear/core";
import definition from "@dicebear/styles/critters.json" with { type: "json" };

const P = { p900: "#1f3437", p800: "#1f4144", p600: "#145b5e", p300: "#94a5a8", c800: "#b86351", c600: "#f3785b", c400: "#f7a98e", c200: "#f9dccc", n300: "#b6b3b2", cream: "#f8f8f4", ink: "#161619" };

// [bakgrunn, kropp, aksent]: lys kropp på mørk eller sterk bakgrunn, så ansiktet (strek i nesten svart) synes godt.
const COMBOS = [
  ["p600", "c400", "c200"], ["p600", "cream", "c400"], ["p600", "c600", "c200"], ["p600", "p300", "cream"], ["p600", "c200", "c600"], ["p600", "n300", "cream"],
  ["c600", "c200", "c400"], ["c600", "cream", "p300"], ["c600", "p300", "cream"], ["c600", "c200", "p300"], ["c600", "n300", "c200"], ["c600", "cream", "c200"],
  ["p800", "c600", "c200"], ["p800", "c400", "cream"], ["p800", "p300", "c200"], ["p800", "cream", "c600"], ["p800", "c200", "c400"], ["p800", "n300", "c400"],
  ["c800", "c200", "cream"], ["c800", "cream", "c400"], ["c800", "c400", "c200"], ["c800", "p300", "c200"], ["c800", "cream", "p300"], ["c800", "c200", "p300"],
];
// Bare blide fjes: ingen sinte, triste eller søvnige varianter.
const EYES = ["round", "dots", "bigPupils", "sideeye", "happy", "wink", "wide", "trio", "uneven", "four"];
const MOUTHS = ["smile", "tinySmile", "grin", "laugh", "teeth", "ooh", "smirk", "catMouth", "tongue", "blep", "open", "tooth"];

const style = new Style(definition);
const out = new URL("../public/avatars/", import.meta.url);
COMBOS.forEach(([bg, body, accent], i) => {
  const id = `c${String(i + 1).padStart(2, "0")}`;
  const svg = new Avatar(style, {
    seed: `quipu-${id}`,
    backgroundColor: P[bg], bodyColor: P[body], accentColor: P[accent], inkColor: P.ink,
    eyesVariant: EYES, mouthVariant: MOUTHS, animationVariant: "none",
  }).toString()
    // Farger som ligger fast i tegningene, byttes til palettfarger.
    .replaceAll("#ffffff", P.cream).replaceAll("#fb7185", P.c800);
  const stray = [...new Set(svg.match(/#[0-9a-f]{6}/gi))].filter((c) => !Object.values(P).includes(c.toLowerCase()));
  if (stray.length) throw new Error(`${id} har farger utenfor paletten: ${stray}`);
  writeFileSync(new URL(`${id}.svg`, out), svg);
});
console.log(`Laget ${COMBOS.length} profilbilder i public/avatars/`);
