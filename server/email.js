import { readFileSync } from "node:fs";
import { APP_NAME, CONTACT_EMAIL } from "./config.js";

// Felles mal for e-post fra appen: en HTML-versjon med logo og knapp, og en ren tekstversjon
// for e-postprogrammer som ikke viser HTML. Logoen legges ved inni e-posten (cid), så den vises
// selv om programmet blokkerer bilder fra nettet.
const LOGO = readFileSync(new URL("./assets/email-logo.png", import.meta.url));
const LOGO_CID = "logo@quipu";

// Farger fra quipu-paletten (lys modus).
const C = {
  bg: "#f9dccc", card: "#f8f8f4", text: "#161619", muted: "#383638", button: "#145b5e", buttonInk: "#f8f8f4", line: "#f7a98e",
};

const escape = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

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

  const p = (s, style = "") =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:${C.text};${style}">${escape(s)}</p>`;
  const buttonHtml = button ? `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px">
            <tr><td style="border-radius:12px;background:${C.button}">
              <a href="${escape(button.url)}" style="display:inline-block;padding:14px 26px;font-size:16px;font-weight:600;color:${C.buttonInk};text-decoration:none;border-radius:12px">${escape(button.label)}</a>
            </td></tr>
          </table>
          <p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:${C.muted}">Virker ikke knappen? Kopier denne lenken inn i nettleseren:<br>
            <a href="${escape(button.url)}" style="color:${C.button};word-break:break-all">${escape(button.url)}</a></p>` : "";

  const html = `<!doctype html>
<html lang="no">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escape(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
        <tr><td align="center" style="padding:0 0 24px">
          <img src="cid:${LOGO_CID}" width="138" height="50" alt="${escape(APP_NAME)}" style="display:block;border:0;width:138px;height:auto">
        </td></tr>
        <tr><td style="background:${C.card};border-radius:20px;padding:32px 28px">
          <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;color:${C.text}">${escape(heading)}</h1>
          ${paragraphs.map((s) => p(s)).join("\n          ")}
          ${buttonHtml}
          ${note ? p(note, `font-size:14px;color:${C.muted};margin:0`) : ""}
        </td></tr>
        <tr><td align="center" style="padding:24px 12px 0;font-size:13px;line-height:1.5;color:${C.muted}">
          ${escape(APP_NAME)} – det rolige stedet for klassen.<br>
          Spørsmål? Skriv til <a href="mailto:${CONTACT_EMAIL}" style="color:${C.button}">${CONTACT_EMAIL}</a>.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { text, html, attachments: [{ filename: "quipu.png", content: LOGO, cid: LOGO_CID, contentType: "image/png" }] };
}
