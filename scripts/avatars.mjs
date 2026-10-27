// Lager profilbildene til barna: 24 «Critters» fra DiceBear (CC0 1.0), farget med quiply-paletten.
// Filene legges i public/avatars/ og sendes fra vår egen server, så ingenting hentes fra andre nettsteder.
// Kjør på nytt hvis settet skal endres:
//   npm install --no-save @dicebear/core@10.7.0 @dicebear/styles@10.6.0 && node scripts/avatars.mjs
import { writeFileSync } from "node:fs";
import { Avatar, Style } from "@dicebear/core";
import definition from "@dicebear/styles/critters.json" with { type: "json" };

// s = serenity, c = champ (samme trinn som i design/tokens.json; c100 er mellom champ-200 og cream).
const P = { s900: "#192230", s800: "#263142", s700: "#364356", s300: "#98a6b9", c500: "#c8ac8b", c300: "#ecd5bb", c200: "#f4e3d1", c100: "#f8eee3", n300: "#babec3", cream: "#fbf6f0", ink: "#0f1621" };

// [bakgrunn, kropp, aksent]: lys kropp på mørk eller sterk bakgrunn, så ansiktet (strek i nesten svart) synes godt.
const COMBOS = [
  ["s700", "c200", "c100"], ["s700", "cream", "c200"], ["s700", "c300", "c100"], ["s700", "s300", "cream"], ["s700", "c100", "c300"], ["s700", "n300", "cream"],
  ["c300", "c100", "c200"], ["c300", "cream", "s300"], ["c300", "s300", "cream"], ["c300", "c100", "s300"], ["c300", "n300", "c100"], ["c300", "cream", "c100"],
  ["s800", "c300", "c100"], ["s800", "c200", "cream"], ["s800", "s300", "c100"], ["s800", "cream", "c300"], ["s800", "c100", "c200"], ["s800", "n300", "c200"],
  ["c500", "c100", "cream"], ["c500", "cream", "c200"], ["c500", "c200", "c100"], ["c500", "s300", "c100"], ["c500", "cream", "s300"], ["c500", "c100", "s300"],
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
