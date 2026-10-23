import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCss, checkContrast } from "../scripts/build-tokens.mjs";

// public/tokens.css bygges fra design/tokens.json. Glemmer man «npm run tokens», feiler denne.
test("tokens.css er bygget fra design/tokens.json", () => {
  const built = readFileSync(new URL("../public/tokens.css", import.meta.url), "utf8");
  assert.equal(built, buildCss(), "Kjør «npm run tokens»");
});

test("tekst og fyll i tokenene holder kontrastkravene i begge moduser", () => {
  assert.deepEqual(checkContrast(), []);
});
