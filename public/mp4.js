// Leser og skriver MP4/MOV-filer i nettleseren, uten kode fra andre. Brukes av video.js til å gjøre
// videoer mindre før opplasting: demux() finner bildene og lyden i fila, mux() setter sammen en ny fil.
// Ingen avhengighet til nettleseren, så fila kan testes i Node.
//
// MP4 består av bokser: 4 byte lengde, 4 bokstaver type, og så innholdet (som kan være flere bokser).
// Viktige bokser: moov (alt om sporene), trak (ett spor), stbl (tabellene som sier hvor hvert bilde
// ligger i fila og når det skal vises) og mdat (selve dataene).

const u16 = (b, i) => (b[i] << 8) | b[i + 1];
const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const i32 = (b, i) => (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3];
const u64 = (b, i) => u32(b, i) * 2 ** 32 + u32(b, i + 4);
const fourcc = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
const hex2 = (n) => n.toString(16).padStart(2, "0").toUpperCase();

export class Mp4Error extends Error {}

function* boxes(b, start, end) {
  let i = start;
  while (i + 8 <= end) {
    let size = u32(b, i);
    let header = 8;
    if (size === 1) {
      size = u64(b, i + 8);
      header = 16;
    } else if (size === 0) {
      size = end - i;
    }
    if (size < header || i + size > end) throw new Mp4Error("Ødelagt video");
    yield { type: fourcc(b, i + 4), start: i, body: i + header, end: i + size };
    i += size;
  }
}
const child = (b, box, type) => box && [...boxes(b, box.body, box.end)].find((c) => c.type === type);
const path = (b, box, ...types) => types.reduce((at, t) => child(b, at, t), box);

// Tid og tidsskala fra mvhd eller mdhd (samme oppsett i begge).
function timing(b, box) {
  const v1 = b[box.body] === 1;
  return { timescale: u32(b, box.body + (v1 ? 20 : 12)), duration: v1 ? u64(b, box.body + 24) : u32(b, box.body + 16) };
}

// Rotasjonen fra matrisen i tkhd: 0, 90, 180 eller 270 grader. iPhone lagrer stående video liggende og roterer ved avspilling.
function rotation(b, tkhd) {
  const m = tkhd.body + (b[tkhd.body] === 1 ? 52 : 40);
  const a = i32(b, m), bb = i32(b, m + 4);
  if (a === 0 && bb > 0) return 90;
  if (a === 0 && bb < 0) return 270;
  if (a < 0) return 180;
  return 0;
}

const VISUAL_ENTRY = 78; // fast del av en VisualSampleEntry før boksene inni den
function codecString(b, entry) {
  const type = fourcc(b, entry.start + 4);
  const inner = (t) => [...boxes(b, entry.body + VISUAL_ENTRY, entry.end)].find((c) => c.type === t);
  if (type === "avc1" || type === "avc3") {
    const c = inner("avcC");
    if (!c) throw new Mp4Error("Mangler avcC");
    return { codec: `${type}.${hex2(b[c.body + 1])}${hex2(b[c.body + 2])}${hex2(b[c.body + 3])}`, description: b.slice(c.body, c.end) };
  }
  if (type === "hvc1" || type === "hev1") {
    const c = inner("hvcC");
    if (!c) throw new Mp4Error("Mangler hvcC");
    const p = c.body;
    const space = ["", "A", "B", "C"][b[p + 1] >> 6];
    const tier = (b[p + 1] >> 5) & 1 ? "H" : "L";
    let compat = u32(b, p + 2), reversed = 0;
    for (let i = 0; i < 32; i++) { reversed = (reversed << 1) | (compat & 1); compat >>>= 1; }
    const constraints = [...b.subarray(p + 6, p + 12)];
    while (constraints.length && constraints.at(-1) === 0) constraints.pop();
    const tail = constraints.map((x) => `.${x.toString(16).toUpperCase()}`).join("");
    return { codec: `${type}.${space}${b[p + 1] & 31}.${(reversed >>> 0).toString(16).toUpperCase()}.${tier}${b[p + 12]}${tail}`, description: b.slice(p, c.end) };
  }
  if (type === "vp09") {
    const c = inner("vpcC");
    if (!c) throw new Mp4Error("Mangler vpcC");
    const two = (n) => String(n).padStart(2, "0");
    return { codec: `vp09.${two(b[c.body + 4])}.${two(b[c.body + 5])}.${two(b[c.body + 6] >> 4)}`, description: undefined };
  }
  throw new Mp4Error(`Ukjent videoformat: ${type}`);
}

function readTrack(b, trak) {
  const tkhd = child(b, trak, "tkhd");
  const mdia = child(b, trak, "mdia");
  const hdlr = child(b, mdia, "hdlr");
  const handler = hdlr && fourcc(b, hdlr.body + 8);
  if (handler !== "vide" && handler !== "soun") return null;
  const { timescale } = timing(b, child(b, mdia, "mdhd"));
  const stbl = path(b, mdia, "minf", "stbl");
  const table = (t) => child(b, stbl, t);
  const stsd = table("stsd");
  const entry = stsd && [...boxes(b, stsd.body + 8, stsd.end)][0];
  if (!entry || !tkhd || !timescale) throw new Mp4Error("Ødelagt video");

  // Lengden på hvert bilde eller lydstykke.
  const stsz = table("stsz");
  if (!stsz) throw new Mp4Error("Ukjent tabell for størrelser");
  const fixed = u32(b, stsz.body + 4), count = u32(b, stsz.body + 8);
  const sizes = Array.from({ length: count }, (_, i) => fixed || u32(b, stsz.body + 12 + 4 * i));

  // Hvor hver bit (chunk) ligger, og hvor mange stykker som er i hver bit.
  const stco = table("stco"), co64 = table("co64");
  const chunks = stco ? Array.from({ length: u32(b, stco.body + 4) }, (_, i) => u32(b, stco.body + 8 + 4 * i))
    : co64 ? Array.from({ length: u32(b, co64.body + 4) }, (_, i) => u64(b, co64.body + 8 + 8 * i)) : null;
  const stsc = table("stsc");
  if (!chunks || !stsc) throw new Mp4Error("Ødelagt video");
  const runs = Array.from({ length: u32(b, stsc.body + 4) }, (_, i) => ({ first: u32(b, stsc.body + 8 + 12 * i), per: u32(b, stsc.body + 12 + 12 * i) }));
  const offsets = [];
  for (let c = 0, r = 0; c < chunks.length && offsets.length < count; c++) {
    while (r + 1 < runs.length && runs[r + 1].first <= c + 1) r++;
    let at = chunks[c];
    for (let k = 0; k < runs[r].per && offsets.length < count; k++) { offsets.push(at); at += sizes[offsets.length - 1]; }
  }
  if (offsets.length !== count) throw new Mp4Error("Ødelagt video");

  // Tidene: stts gir varigheten til hvert stykke (rekkefølgen de dekodes i), ctts hvor mye senere det vises.
  const expand = (box, signed) => {
    const out = [];
    if (!box) return out;
    for (let i = 0, n = u32(b, box.body + 4); i < n; i++) {
      const times = u32(b, box.body + 8 + 8 * i), value = signed ? i32(b, box.body + 12 + 8 * i) : u32(b, box.body + 12 + 8 * i);
      for (let k = 0; k < times && out.length < count; k++) out.push(value);
    }
    return out;
  };
  const durations = expand(table("stts"), false);
  const shifts = expand(table("ctts"), true);
  const stss = table("stss");
  const keys = stss ? new Set(Array.from({ length: u32(b, stss.body + 4) }, (_, i) => u32(b, stss.body + 8 + 4 * i) - 1)) : null;
  const samples = [];
  let dts = 0;
  for (let i = 0; i < count; i++) {
    const duration = durations[i] ?? durations.at(-1) ?? 0;
    samples.push({ offset: offsets[i], size: sizes[i], dts, cts: dts + (shifts[i] || 0), duration, key: keys ? keys.has(i) : true });
    dts += duration;
  }

  const edts = child(b, trak, "edts");
  const track = {
    kind: handler === "vide" ? "video" : "audio", timescale, samples,
    entry: b.slice(entry.start, entry.end), edts: edts ? b.slice(edts.start, edts.end) : null,
  };
  if (track.kind === "video") {
    Object.assign(track, codecString(b, entry), {
      width: u16(b, entry.body + 24), height: u16(b, entry.body + 26), rotation: rotation(b, tkhd),
    });
  }
  return track;
}

// Finner spor, kodek og alle bilder og lydstykker i en MP4- eller MOV-fil.
export function demux(bytes) {
  const top = [...boxes(bytes, 0, bytes.length)];
  const moov = top.find((x) => x.type === "moov");
  const mvhd = child(bytes, moov, "mvhd");
  if (!moov || !mvhd) throw new Mp4Error("Fant ikke videoinformasjon");
  const tracks = [...boxes(bytes, moov.body, moov.end)].filter((x) => x.type === "trak").map((t) => readTrack(bytes, t)).filter(Boolean);
  const { timescale, duration } = timing(bytes, mvhd);
  return { timescale, duration, tracks };
}

// ---------- Skriving ----------
const enc = new TextEncoder();
function cat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}
function nums(bits, ...values) {
  const out = new Uint8Array(values.length * bits / 8);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => (bits === 32 ? view.setUint32(i * 4, v >>> 0) : bits === 16 ? view.setUint16(i * 2, v) : view.setUint8(i, v)));
  return out;
}
const box = (type, ...parts) => { const body = cat(parts.flat()); return cat([nums(32, body.length + 8), enc.encode(type), body]); };
const full = (type, version, flags, ...parts) => box(type, nums(32, (version << 24) | flags), ...parts);

// Matrisen i tkhd for en rotasjon, med forskyvning regnet ut fra de nye målene.
function matrix(rot, w, h) {
  const one = 0x10000, [a, b, c, d, x, y] = {
    0: [one, 0, 0, one, 0, 0], 90: [0, one, -one, 0, h * one, 0], 180: [-one, 0, 0, -one, w * one, h * one], 270: [0, -one, one, 0, 0, w * one],
  }[rot];
  return nums(32, a, b, 0, c, d, 0, x, y, 0x40000000);
}

// Lager en ny sample entry for video (avc1 med avcC, eller vp09 med vpcC, som bare brukes i testene).
export function videoEntry(codec, width, height, description) {
  const type = codec.slice(0, 4);
  const inner = type === "vp09"
    ? full("vpcC", 1, 0, nums(8, ...codec.split(".").slice(1, 3).map(Number), Number(codec.split(".")[3]) << 4 | 0x2, 1, 1, 1), nums(16, 0))
    : box(type === "avc1" || type === "avc3" ? "avcC" : "hvcC", description);
  return box(type, new Uint8Array(6), nums(16, 1), new Uint8Array(16), nums(16, width, height), nums(32, 0x480000, 0x480000, 0),
    nums(16, 1), new Uint8Array(32), nums(16, 0x18, 0xffff), inner);
}

// Run-length-koding av en liste, slik stts og ctts lagrer den.
function runs(values) {
  const out = [];
  for (const v of values) {
    if (out.length && out.at(-1)[1] === v) out.at(-1)[0]++;
    else out.push([1, v]);
  }
  return out;
}

// Setter sammen en MP4 med moov først (så avspillingen kan starte før hele fila er lastet ned) og
// bilder og lyd flettet etter tid. tracks: [{ kind, timescale, entry, edts?, width?, height?, rotation?,
// samples: [{ data, dts, cts, duration, key }] }], der tidene er i sporets egen tidsskala.
export function mux({ timescale, tracks }) {
  const order = tracks.flatMap((t, ti) => t.samples.map((s, si) => ({ ti, si, at: s.dts / t.timescale })))
    .sort((a, b) => a.at - b.at || a.ti - b.ti);
  const lengths = tracks.map((t) => {
    const first = t.samples[0], last = t.samples.at(-1);
    return last.dts + last.duration - first.dts;
  });
  const movieLength = Math.max(...tracks.map((t, i) => Math.round(lengths[i] * timescale / t.timescale)));

  const moov = (base) => {
    const offsets = tracks.map(() => []);
    let at = base;
    for (const { ti, si } of order) { offsets[ti][si] = at; at += tracks[ti].samples[si].data.length; }
    const traks = tracks.map((t, i) => {
      const video = t.kind === "video";
      const s = t.samples;
      const shifts = s.map((x) => x.cts - x.dts);
      const stbl = box("stbl",
        full("stsd", 0, 0, nums(32, 1), t.entry),
        full("stts", 0, 0, ...(() => { const r = runs(s.map((x) => x.duration)); return [nums(32, r.length), ...r.map(([n, v]) => nums(32, n, v))]; })()),
        shifts.some(Boolean) ? full("ctts", 1, 0, ...(() => { const r = runs(shifts); return [nums(32, r.length), ...r.map(([n, v]) => nums(32, n, v))]; })()) : [],
        video && !s.every((x) => x.key) ? full("stss", 0, 0, nums(32, s.filter((x) => x.key).length), ...s.flatMap((x, k) => (x.key ? [nums(32, k + 1)] : []))) : [],
        full("stsc", 0, 0, nums(32, 1, 1, 1, 1)),
        full("stsz", 0, 0, nums(32, 0, s.length), ...s.map((x) => nums(32, x.data.length))),
        full("stco", 0, 0, nums(32, s.length), ...offsets[i].map((o) => nums(32, o))));
      const minf = box("minf", video ? full("vmhd", 0, 1, new Uint8Array(8)) : full("smhd", 0, 0, new Uint8Array(4)),
        box("dinf", full("dref", 0, 0, nums(32, 1), full("url ", 0, 1))), stbl);
      const mdia = box("mdia",
        full("mdhd", 0, 0, nums(32, 0, 0, t.timescale, lengths[i]), nums(16, 0x55c4, 0)),
        full("hdlr", 0, 0, nums(32, 0), enc.encode(video ? "vide" : "soun"), new Uint8Array(12), enc.encode(video ? "Video\0" : "Lyd\0")),
        minf);
      const tkhd = full("tkhd", 0, 3, nums(32, 0, 0, i + 1, 0, Math.round(lengths[i] * timescale / t.timescale), 0, 0), nums(16, 0, 0, video ? 0 : 0x100, 0),
        matrix(video ? t.rotation || 0 : 0, t.width || 0, t.height || 0), nums(32, (t.width || 0) * 0x10000, (t.height || 0) * 0x10000));
      return box("trak", tkhd, t.edts || [], mdia);
    });
    return box("moov",
      full("mvhd", 0, 0, nums(32, 0, 0, timescale, movieLength, 0x10000), nums(16, 0x100), new Uint8Array(10), matrix(0, 0, 0),
        new Uint8Array(24), nums(32, tracks.length + 1)),
      ...traks);
  };

  const ftyp = box("ftyp", enc.encode("isom"), nums(32, 0x200), enc.encode("isomiso2avc1mp41"));
  const size = moov(0).length;
  const head = cat([ftyp, moov(ftyp.length + size + 8)]);
  const dataLength = tracks.reduce((n, t) => n + t.samples.reduce((m, s) => m + s.data.length, 0), 0);
  const out = new Uint8Array(head.length + 8 + dataLength);
  out.set(head, 0);
  out.set(nums(32, dataLength + 8), head.length);
  out.set(enc.encode("mdat"), head.length + 4);
  let at = head.length + 8;
  for (const { ti, si } of order) { const d = tracks[ti].samples[si].data; out.set(d, at); at += d.length; }
  return out;
}
