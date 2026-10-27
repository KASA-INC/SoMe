import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Serveren sender Content-Security-Policy med default-src 'self'. Da blokkerer nettleseren style-attributter,
// <style>- og <script>-blokker skrevet rett i HTML-en. Alt slikt må ligge i style.css og egne .js-filer.
// (Forhåndsvisningen har ikke CSP-en, så der ville feilen ikke synes.)
const dir = new URL("../public/", import.meta.url);
for (const file of readdirSync(dir).filter((f) => f.endsWith(".html"))) {
  test(`${file} har ikke stil eller skript som CSP-en blokkerer`, () => {
    const html = readFileSync(new URL(file, dir), "utf8");
    assert.doesNotMatch(html, /\sstyle=["']/, "style-attributt");
    assert.doesNotMatch(html, /<style[\s>]/, "<style>-blokk");
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, "<script> uten src");
    assert.doesNotMatch(html, /\son[a-z]+=["']/, "onclick og lignende");
  });
}
