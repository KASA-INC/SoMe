import nodemailer from "nodemailer";

// Sender e-post via SMTP (Gmail, Outlook, Brevo, Domeneshop m.fl.).
// Uten SMTP_HOST skrives e-posten til serverloggen i stedet, slik at den som drifter
// tjenesten kan finne lenken der (f.eks. under «Logs» i Render).
// Lenkekoder (64 tegn hex) byttes ut før tekst skrives til loggen.
export const hideTokens = (text) => text.replace(/([#=])[0-9a-f]{64}/g, "$1[skjult]");

export function createMailer(env = process.env) {
  if (!env.SMTP_HOST) {
    return {
      configured: false,
      async send({ to, subject, text }) {
        // Bare tekstversjonen skrives til loggen (HTML og logo hoppes over). Koder i lenker skjules, så ingen som
        // leser loggen kan bruke dem: nytt passord og bekreftelse lages med «npm run reset-link» og «npm run verify-email».
        console.warn(`[e-post ikke satt opp] Til: ${to}\nEmne: ${subject}\n${hideTokens(text)}`);
      },
    };
  }
  const port = Number(env.SMTP_PORT) || 587;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  const from = env.MAIL_FROM || env.SMTP_USER;
  return {
    configured: true,
    async send({ to, subject, text, html, attachments }) {
      await transport.sendMail({ from, to, subject, text, html, attachments });
    },
  };
}
