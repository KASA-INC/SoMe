import { readFileSync, existsSync } from "node:fs";
import { APP_NAME, CONTACT_EMAIL } from "./config.js";

// Felles mal for e-post fra appen: en HTML-versjon og en ren tekstversjon.
//
// Mørk modus: Gmail på iPhone snur alle farger i e-poster når telefonen står i mørk modus, men lar
// bilder være. Derfor:
// - Bakgrunnen er vanlig petrol, satt både som farge og som background-image (gradient), som Gmail ikke snur.
// - All tekst er kremhvit og ligger inni .gm-screen/.gm-diff. Blandingsmodusene snur Gmails snuing
//   tilbake, så teksten forblir lys. Andre e-postprogrammer ser ikke klassene (u + .body treffer bare Gmail).
// - Logo og knapper er bilder (se scripts/email-assets.mjs). De legges ved inni e-posten (cid),
//   så de vises selv om programmet blokkerer bilder fra nettet.

const ASSETS = new URL("./assets/", import.meta.url);

// Knappetekster som finnes som bilde. Andre tekster får en vanlig HTML-knapp.
export const EMAIL_BUTTONS = {
  "Bekreft e-postadressen": "button-verify.png",
  "Velg nytt passord": "button-reset.png",
  "Åpne Grupper": "button-groups.png",
  [`Åpne ${APP_NAME}`]: "button-open.png",
};

const C = { bg: "#145b5e", text: "#f8f8f4", button: "#f3785b", buttonInk: "#161619" };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
// Farge som Gmail ikke snur: samme farge som både bakgrunnsfarge og gradient.
const lockedBg = (color) => `background-color:${color};background-image:linear-gradient(${color},${color})`;

const images = new Map();
function image(file) {
  if (!images.has(file)) {
    const path = new URL(file, ASSETS);
    images.set(file, existsSync(path) ? readFileSync(path) : null);
  }
  return images.get(file);
}

// Bredde og høyde fra PNG-hodet. Bildene er laget i dobbel oppløsning, så de vises i halv størrelse.
const pngSize = (buf) => ({ width: buf.readUInt32BE(16) / 2, height: buf.readUInt32BE(20) / 2 });

const escape = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

// Tekst inni dette beholder fargen i Gmail sin mørke modus (se øverst).
const keepText = (html) => `<div class="gm-screen"><div class="gm-diff">${html}</div></div>`;

/**
 * @param {object} o
 * @param {string} o.preheader  Kort tekst som vises etter emnet i innboksen.
 * @param {string} o.heading
 * @param {string[]} o.paragraphs  Ren tekst. Settes inn escapet, så navn fra brukere er trygge.
 * @param {{ label: string, url: string }} [o.button]
 * @param {string} [o.note]  Liten tekst under knappen, f.eks. hvor lenge lenken virker.
 */
export function renderEmail({ preheader, heading, paragraphs, button, note }) {
  const text = [
    heading,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    ...(button ? [`${button.label}: ${button.url}`, ""] : []),
    ...(note ? [note, ""] : []),
    `Spørsmål? Skriv til ${CONTACT_EMAIL}.`,
  ].join("\n");

  const attachments = [];
  const embed = (file, cid) => {
    const content = image(file);
    if (!content) return null;
    attachments.push({ filename: file, content, cid, contentType: "image/png" });
    return { cid, ...pngSize(content) };
  };

  const logo = embed("email-logo.png", "logo@quipu");
  const p = (s, size = 16) => `<p style="margin:0 0 16px;font-size:${size}px;line-height:1.5;color:${C.text}">${escape(s)}</p>`;
  const link = (url) => `<a href="${escape(url)}" style="color:${C.text};text-decoration:underline;word-break:break-all">${escape(url)}</a>`;

  let buttonHtml = "";
  if (button) {
    const img = EMAIL_BUTTONS[button.label] && embed(EMAIL_BUTTONS[button.label], "button@quipu");
    const inner = img
      ? `<img src="cid:${img.cid}" width="${img.width}" height="${img.height}" alt="${escape(button.label)}" style="display:block;border:0">`
      : `<span style="display:inline-block;padding:14px 26px;border-radius:12px;${lockedBg(C.button)};color:${C.buttonInk};font-size:16px;font-weight:600">${escape(button.label)}</span>`;
    buttonHtml = `
          <tr><td style="padding:8px 0 20px"><a href="${escape(button.url)}" style="text-decoration:none">${inner}</a></td></tr>
          <tr><td>${keepText(`<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:${C.text}">Virker ikke knappen? Kopier denne lenken inn i nettleseren:<br>${link(button.url)}</p>`)}</td></tr>`;
  }

  const html = `<!doctype html>
<html lang="no">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="only light">
<meta name="supported-color-schemes" content="light">
<title>${escape(heading)}</title>
<style>
  u + .body .gm-screen { background: #000; mix-blend-mode: screen; }
  u + .body .gm-diff { background: #000; mix-blend-mode: difference; }
</style>
</head>
<body class="body" style="margin:0;padding:0;${lockedBg(C.bg)};font-family:${FONT}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="${lockedBg(C.bg)}">
    <tr><td align="center" style="padding:36px 20px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;font-family:${FONT}">
        <tr><td style="padding:0 0 32px">${logo
          ? `<img src="cid:${logo.cid}" width="${logo.width}" height="${logo.height}" alt="${escape(APP_NAME)}" style="display:block;border:0">`
          : keepText(`<strong style="font-size:24px;color:${C.text}">${escape(APP_NAME)}</strong>`)}</td></tr>
        <tr><td>${keepText(`<h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;font-weight:700;color:${C.text}">${escape(heading)}</h1>
          ${paragraphs.map((s) => p(s)).join("\n          ")}`)}</td></tr>${buttonHtml}
        ${note ? `<tr><td>${keepText(p(note, 14))}</td></tr>` : ""}
        <tr><td style="padding:24px 0 0">${keepText(`<p style="margin:0;font-size:13px;line-height:1.5;color:${C.text}">Spørsmål? Skriv til <a href="mailto:${CONTACT_EMAIL}" style="color:${C.text};text-decoration:underline">${CONTACT_EMAIL}</a>.</p>`)}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { text, html, attachments };
}
