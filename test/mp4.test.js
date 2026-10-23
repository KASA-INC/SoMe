// Tester lesing og skriving av MP4 (public/mp4.js), som brukes når telefonen gjør videoer mindre.
// Selve omkodingen bruker WebCodecs i nettleseren og testes ikke her.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { demux, mux, videoEntry } from "../public/mp4.js";
import { inspectVideo } from "../server/media.js";

const fixture = (name) => new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
const withData = (bytes, t) => ({ ...t, samples: t.samples.map((s) => ({ ...s, data: bytes.subarray(s.offset, s.offset + s.size) })) });

test("mp4: leser video, lyd, B-bilder og rotasjon fra en MOV som fra en iPhone", () => {
  const m = demux(fixture("rotated-audio.mov"));
  const video = m.tracks.find((t) => t.kind === "video");
  const audio = m.tracks.find((t) => t.kind === "audio");
  assert.match(video.codec, /^avc1\.64/);
  assert.deepEqual([video.width, video.height, video.rotation], [96, 64, 270]);
  assert.equal(video.samples.length, 15);
  assert.ok(video.samples.some((s) => s.cts !== s.dts), "B-bilder gir ulik visnings- og dekodetid");
  assert.ok(video.samples[0].key);
  assert.ok(audio.samples.length > 10);
});

test("mp4: å pakke ut og sette sammen igjen gir de samme bildene, tidene og lyden", () => {
  for (const name of ["rotated-audio.mov", "short.mp4", "long.mp4"]) {
    const bytes = fixture(name);
    const before = demux(bytes);
    const out = mux({ timescale: before.timescale, tracks: before.tracks.map((t) => withData(bytes, t)) });
    const after = demux(out);
    assert.equal(after.tracks.length, before.tracks.length, name);
    before.tracks.forEach((t, i) => {
      const u = after.tracks[i];
      assert.equal(u.kind, t.kind);
      assert.equal(u.codec, t.codec);
      assert.equal(u.rotation, t.rotation);
      assert.deepEqual(u.samples.map((s) => [s.dts, s.cts, s.duration, s.key]), t.samples.map((s) => [s.dts, s.cts, s.duration, s.key]), `${name}: tidene`);
      u.samples.forEach((s, k) => assert.deepEqual(out.subarray(s.offset, s.offset + s.size), bytes.subarray(t.samples[k].offset, t.samples[k].offset + t.samples[k].size)));
    });
    // Serveren godtar fila, og lengden stemmer.
    const original = inspectVideo(Buffer.from(bytes)).duration;
    assert.ok(Math.abs(inspectVideo(Buffer.from(out)).duration - original) < 0.1, name);
  }
});

test("mp4: ny fil med nedskalert video får riktig rotasjon og mål", () => {
  const bytes = fixture("rotated-audio.mov");
  const m = demux(bytes);
  const video = withData(bytes, m.tracks.find((t) => t.kind === "video"));
  const avcC = demux(bytes).tracks[0].description;
  const out = mux({ timescale: m.timescale, tracks: [{ ...video, width: 48, height: 32, entry: videoEntry(video.codec, 48, 32, avcC), edts: null }] });
  const again = demux(out).tracks[0];
  assert.deepEqual([again.width, again.height, again.rotation, again.codec], [48, 32, 270, video.codec]);
});
