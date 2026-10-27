// Lager profilbildene til barna: 24 «Critters» fra DiceBear (CC0 1.0), farget med quiply-paletten.
// Filene legges i public/avatars/ og sendes fra vår egen server, så ingenting hentes fra andre nettsteder.
// Kjør på nytt hvis settet skal endres:
//   npm install --no-save @dicebear/core@10.7.0 @dicebear/styles@10.6.0 && node scripts/avatars.mjs
import { writeFileSync } from "node:fs";
import { Avatar, Style } from "@dicebear/core";
import definition from "@dicebear/styles/critters.json" with { type: "json" };

// a = aubergine, f = fersken (samme trinn som i design/tokens.json).
const P = { a900: "#2e0d26", a800: "#3b1432", a600: "#4a1d3f", a300: "#be8daf", f800: "#de6a54", f600: "#ff9e8a", f400: "#ffc4b7", f200: "#fee7e2", n300: "#b6b3b2", cream: "#f8f8f4", ink: "#161619" };

// [bakgrunn, kropp, aksent]: lys kropp på mørk eller sterk bakgrunn, så ansiktet (strek i nesten svart) synes godt.
const COMBOS = [
  ["a600", "f400", "f200"], ["a600", "cream", "f400"], ["a600", "f600", "f200"], ["a600", "a300", "cream"], ["a600", "f200", "f600"], ["a600", "n300", "cream"],
  ["f600", "f200", "f400"], ["f600", "cream", "a300"], ["f600", "a300", "cream"], ["f600", "f200", "a300"], ["f600", "n300", "f200"], ["f600", "cream", "f200"],
  ["a800", "f600", "f200"], ["a800", "f400", "cream"], ["a800", "a300", "f200"], ["a800", "cream", "f600"], ["a800", "f200", "f400"], ["a800", "n300", "f400"],
  ["f800", "f200", "cream"], ["f800", "cream", "f400"], ["f800", "f400", "f200"], ["f800", "a300", "f200"], ["f800", "cream", "a300"], ["f800", "f200", "a300"],
];
// Bare blide fjes: ingen sinte, triste eller søvnige varianter.
const EYES = ["round", "dots", "bigPupils", "sideeye", "happy", "wink", "wide", "trio", "uneven", "four"];
const MOUTHS = ["smile", "tinySmile", "grin", "laugh", "teeth", "ooh", "smirk", "catMouth", "tongue", "blep", "open", "tooth"];

const style = new Style(definition);
const out = new URL("../public/avatars/", import.meta.url);
COMBOS.forEach(([bg, body, accent], i) => {
  const id = `c${String(i + 1).padStart(2, "0")}`;
  const svg = new Avatar(style, {
    seed: `quiply-${id}`,
    backgroundColor: P[bg], bodyColor: P[body], accentColor: P[accent], inkColor: P.ink,
    eyesVariant: EYES, mouthVariant: MOUTHS, animationVariant: "none",
  }).toString()
    // Farger som ligger fast i tegningene, byttes til palettfarger.
    .replaceAll("#ffffff", P.cream).replaceAll("#fb7185", P.f800);
  const stray = [...new Set(svg.match(/#[0-9a-f]{6}/gi))].filter((c) => !Object.values(P).includes(c.toLowerCase()));
  if (stray.length) throw new Error(`${id} har farger utenfor paletten: ${stray}`);
  writeFileSync(new URL(`${id}.svg`, out), svg);
});
console.log(`Laget ${COMBOS.length} profilbilder i public/avatars/`);
