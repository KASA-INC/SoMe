// Gjør videoer mindre på telefonen før opplasting, med WebCodecs i nettleseren. Serveren gjør ingen
// konvertering. Videoen skaleres ned til 1280 punkter på den lengste siden og lagres som H.264 med
// rundt 2 Mbit/s. 30 sekunder blir da rundt 8 MB, mot 30–60 MB fra en mobil. Lyden kopieres som den er.
//
// Kan ikke nettleseren gjøre det, eller blir fila ikke mindre, lastes originalen opp som før.
import { demux, mux, videoEntry } from "./mp4.js";

const MAX_SIDE = 1280;
const BITRATE = 2_000_000;
const MAX_INPUT_MB = 300;
const KEY_EVERY = 2; // sekunder mellom hvert fullstendige bilde, så avspillingen kan hoppe i videoen
// H.264 Main og Baseline nivå 3.1 dekker 1280x720 og spilles av overalt.
const OUTPUT_CODECS = ["avc1.4D401F", "avc1.42E01F"];

const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const pause = () => new Promise((r) => setTimeout(r, 0));

// Gir en mindre MP4 som Blob, eller null hvis originalen bør brukes. onProgress får et tall fra 0 til 1.
// codecs kan settes i testene (Chromium uten H.264 bruker VP9).
export async function shrinkVideo(file, { onProgress = () => {}, codecs = OUTPUT_CODECS } = {}) {
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined" || typeof OffscreenCanvas === "undefined") return null;
  // Hele fila leses inn i minnet. Svært store filer (4K) kan bli for mye for en telefon.
  if (file.size > MAX_INPUT_MB * 1024 * 1024) return null;
  let decoder, encoder;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const movie = demux(bytes);
    const video = movie.tracks.find((t) => t.kind === "video");
    const audio = movie.tracks.find((t) => t.kind === "audio");
    if (!video || !video.samples.length) return null;

    const seconds = (video.samples.at(-1).dts + video.samples.at(-1).duration) / video.timescale;
    const scale = Math.min(1, MAX_SIDE / Math.max(video.width, video.height));
    const width = even(video.width * scale), height = even(video.height * scale);
    // Allerede liten nok: ingen grunn til å bruke strøm på å kode den på nytt.
    const videoBytes = video.samples.reduce((n, s) => n + s.size, 0);
    if (scale === 1 && videoBytes * 8 / seconds < BITRATE * 1.3) return null;

    const decodeConfig = { codec: video.codec, codedWidth: video.width, codedHeight: video.height, description: video.description };
    if (!(await VideoDecoder.isConfigSupported(decodeConfig)).supported) return null;
    const fps = video.samples.length / seconds;
    let encodeConfig = null;
    for (const codec of codecs) {
      const config = { codec, width, height, bitrate: BITRATE, bitrateMode: "variable", framerate: Math.round(fps) || 30,
        ...(codec.startsWith("avc") ? { avc: { format: "avc" } } : {}) };
      if ((await VideoEncoder.isConfigSupported(config)).supported) { encodeConfig = config; break; }
    }
    if (!encodeConfig) return null;

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const us = (t) => Math.round(t * 1e6 / video.timescale);
    const encoded = [];
    let description, failure = null, frames = 0;

    encoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (meta?.decoderConfig?.description && !description) {
          const d = meta.decoderConfig.description;
          description = new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d.slice(0));
        }
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        encoded.push({ data, timestamp: chunk.timestamp, key: chunk.type === "key" });
        onProgress(Math.min(1, encoded.length / video.samples.length));
      },
      error: (e) => (failure = e),
    });
    encoder.configure(encodeConfig);
    decoder = new VideoDecoder({
      output: (frame) => {
        ctx.drawImage(frame, 0, 0, width, height);
        const small = new VideoFrame(canvas, { timestamp: frame.timestamp, duration: frame.duration ?? undefined });
        frame.close();
        encoder.encode(small, { keyFrame: frames % Math.max(1, Math.round(fps * KEY_EVERY)) === 0 });
        small.close();
        frames++;
      },
      error: (e) => (failure = e),
    });
    decoder.configure(decodeConfig);

    for (const s of video.samples) {
      if (failure) throw failure;
      // Ikke for mange bilder i kø om gangen, så minnet holder også på eldre telefoner.
      while (decoder.decodeQueueSize > 8 || encoder.encodeQueueSize > 8) await pause();
      decoder.decode(new EncodedVideoChunk({
        type: s.key ? "key" : "delta", timestamp: us(s.cts), duration: us(s.duration), data: bytes.subarray(s.offset, s.offset + s.size),
      }));
    }
    await decoder.flush();
    await encoder.flush();
    if (failure) throw failure;
    if (!encoded.length || (encodeConfig.codec.startsWith("avc") && !description)) return null;

    // Tidene tilbake i sporets tidsskala, med første bilde på 0. Bildene kommer i dekoderekkefølge.
    // Visningstidene sortert gir dekodetidene, og forskjellen blir ctts hvis koderen har brukt B-bilder.
    // Den gamle redigeringslista (edts) for video trengs ikke: den hoppet bare over forsinkelsen fra B-bildene i originalen.
    const ticks = (t) => Math.round(t * video.timescale / 1e6);
    const start = Math.min(...encoded.map((c) => ticks(c.timestamp)));
    const shown = encoded.map((c) => ticks(c.timestamp) - start);
    const decodeTimes = [...shown].sort((a, b) => a - b);
    const frameTicks = Math.max(1, Math.round(video.timescale / fps));
    const videoSamples = encoded.map((c, i) => ({
      data: c.data, key: c.key, dts: decodeTimes[i], cts: shown[i],
      duration: i + 1 < decodeTimes.length ? decodeTimes[i + 1] - decodeTimes[i] : frameTicks,
    }));
    const tracks = [{
      kind: "video", timescale: video.timescale, width, height, rotation: video.rotation,
      entry: videoEntry(encodeConfig.codec, width, height, description), samples: videoSamples,
    }];
    if (audio) {
      tracks.push({
        kind: "audio", timescale: audio.timescale, edts: audio.edts, entry: audio.entry,
        samples: audio.samples.map((s) => ({ data: bytes.subarray(s.offset, s.offset + s.size), dts: s.dts, cts: s.cts, duration: s.duration })),
      });
    }
    const out = mux({ timescale: movie.timescale, tracks });
    return out.length < file.size * 0.9 ? new Blob([out], { type: "video/mp4" }) : null;
  } catch (err) {
    console.warn("Klarte ikke å gjøre videoen mindre, bruker originalen:", err);
    return null;
  } finally {
    for (const c of [decoder, encoder]) if (c && c.state !== "closed") try { c.close(); } catch {}
  }
}
