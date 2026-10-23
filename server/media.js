// Kontroll og rensing av opplastede bilder og videoer, uten eksterne avhengigheter.
//
// - Bilder: JPEG og WebP. Alle APPn-/COM-segmenter i JPEG og EXIF-/XMP-biter i WebP (EXIF, GPS, XMP,
//   kommentarer) fjernes.
// - Video: MP4/MOV (ISO BMFF, det iPhone og Android tar opp). Lengden leses fra moov/mvhd,
//   og metadata-bokser (udta/meta, der bl.a. GPS-posisjon ligger) gjøres om til "free".

export class MediaError extends Error {}

export function isJpeg(buf) {
  return buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

export function stripJpegMetadata(buf) {
  if (!isJpeg(buf)) throw new MediaError("Bildet må være JPEG");
  const out = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) throw new MediaError("Ødelagt bilde");
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; } // fyllbyte
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) throw new MediaError("Ødelagt bilde");
    // SOS: resten er bildedata. Kopier alt derfra.
    if (marker === 0xda) {
      out.push(buf.subarray(i));
      return Buffer.concat(out);
    }
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  throw new MediaError("Ødelagt bilde");
}

export function isWebp(buf) {
  return buf.length >= 20 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP";
}

// WebP er en RIFF-fil med biter (chunks). Vi beholder bare selve bildet (VP8, VP8L, alfa og VP8X-hodet)
// og fargeprofilen. EXIF og XMP, der GPS kan ligge, og alt vi ikke kjenner, fjernes. Animasjon avvises.
const WEBP_KEEP = new Set(["VP8X", "VP8 ", "VP8L", "ALPH", "ICCP"]);
export function stripWebpMetadata(buf) {
  if (!isWebp(buf)) throw new MediaError("Bildet må være JPEG eller WebP");
  const end = Math.min(buf.length, 8 + buf.readUInt32LE(4));
  const out = [];
  let images = 0;
  let i = 12;
  while (i + 8 <= end) {
    const type = buf.toString("latin1", i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    const next = i + 8 + size + (size & 1);
    if (i + 8 + size > end) throw new MediaError("Ødelagt bilde");
    if (type === "ANIM" || type === "ANMF") throw new MediaError("Animerte bilder kan ikke lastes opp");
    if (WEBP_KEEP.has(type)) {
      const chunk = Buffer.from(buf.subarray(i, Math.min(next, end)));
      if (type === "VP8X") chunk[8] &= ~(0x08 | 0x04 | 0x02); // ingen EXIF, XMP eller animasjon
      if (type === "VP8 " || type === "VP8L") images++;
      out.push(chunk);
    }
    i = next;
  }
  if (images !== 1) throw new MediaError("Ødelagt bilde");
  const body = Buffer.concat(out);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(4 + body.length, 4);
  head.write("WEBP", 8, "latin1");
  return Buffer.concat([head, body]);
}

function* boxes(buf, start, end) {
  let i = start;
  while (i + 8 <= end) {
    let size = buf.readUInt32BE(i);
    const type = buf.toString("latin1", i + 4, i + 8);
    let header = 8;
    if (size === 1) {
      if (i + 16 > end) return;
      size = Number(buf.readBigUInt64BE(i + 8));
      header = 16;
    } else if (size === 0) {
      size = end - i;
    }
    if (size < header || i + size > end) throw new MediaError("Ødelagt video");
    yield { type, start: i, body: i + header, end: i + size };
    i += size;
  }
}

const METADATA_BOXES = new Set(["udta", "meta", "uuid"]);

// Gjør boksen om til en tom "free"-boks: avspillere hopper over den, og innholdet er nullet ut.
function neutralize(buf, box) {
  buf.write("free", box.start + 4, "latin1");
  buf.fill(0, box.body, box.end);
}

// Leser lengden og fjerner metadata. Endrer bufferen på stedet (samme størrelse).
export function inspectVideo(buf) {
  const top = [...boxes(buf, 0, buf.length)];
  const ftyp = top[0];
  if (!ftyp || ftyp.type !== "ftyp") throw new MediaError("Videoen må være MP4 eller MOV");
  const moov = top.find((b) => b.type === "moov");
  if (!moov) throw new MediaError("Fant ikke videoinformasjon");

  let duration = null;
  let hasVideo = false;
  for (const box of boxes(buf, moov.body, moov.end)) {
    if (box.type === "mvhd") {
      const version = buf[box.body];
      const timescale = version === 1 ? buf.readUInt32BE(box.body + 20) : buf.readUInt32BE(box.body + 12);
      const units = version === 1 ? Number(buf.readBigUInt64BE(box.body + 24)) : buf.readUInt32BE(box.body + 16);
      if (timescale > 0) duration = units / timescale;
    } else if (box.type === "trak") {
      for (const child of boxes(buf, box.body, box.end)) {
        if (METADATA_BOXES.has(child.type)) neutralize(buf, child);
        if (child.type === "mdia") {
          for (const m of boxes(buf, child.body, child.end)) {
            if (m.type === "hdlr" && buf.toString("latin1", m.body + 8, m.body + 12) === "vide") hasVideo = true;
          }
        }
      }
    } else if (METADATA_BOXES.has(box.type)) {
      neutralize(buf, box);
    }
  }
  for (const box of top) if (METADATA_BOXES.has(box.type)) neutralize(buf, box);

  if (duration === null) throw new MediaError("Fant ikke lengden på videoen");
  if (!hasVideo) throw new MediaError("Fila inneholder ikke video");
  return { duration };
}
