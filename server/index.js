import { openDb } from "./db.js";
import { createApp } from "./app.js";
import { createMailer } from "./mail.js";
import { appUrl, APP_NAME } from "./config.js";

const port = Number(process.env.PORT) || 3000;
const db = openDb(process.env.DB_PATH || "data/some.db");
const app = createApp({
  db,
  mediaDir: process.env.MEDIA_DIR || "data/media",
  secureCookies: process.env.NODE_ENV === "production",
  registrationCode: process.env.REGISTRATION_CODE || "",
  // Beredskap: adresser som varsles når ingen administrator har tatt ansvar for en alvorlig sak.
  alarmEmails: (process.env.BEREDSKAP_EPOST || "").split(",").map((s) => s.trim()).filter(Boolean),
  ackMinutes: Number(process.env.KVITTERING_MINUTTER) || 15,
  appUrl: appUrl(),
  mailer: createMailer(),
});

// Bak en proxy (f.eks. Render, Fly eller nginx) trenger vi riktig klient-IP til innloggingsbremsen.
if (process.env.TRUST_PROXY) app.set("trust proxy", 1);

// Rydd bort filer fra slettede innlegg og opplastinger som aldri ble delt.
app.locals.sweepMedia();
setInterval(app.locals.sweepMedia, 15 * 60 * 1000).unref();
// E-post om nye beskjeder i voksenkontakten (for dem som har slått det på).
setInterval(() => app.locals.emailAdultMessages().catch((err) => console.error(err)), 5 * 60 * 1000).unref();

// Alvorlige saker uten kvittering varsles videre på vaktlisten. Sjekkes hvert minutt.
// Stopper jobben opp, svarer /healthz med feil, og Render starter appen på nytt.
const escalate = () => app.locals.escalateIncidents().catch((err) => console.error(err));
escalate();
setInterval(escalate, 60 * 1000).unref();

// Slett gamle tekniske data én gang i døgnet (og ved oppstart).
app.locals.cleanup();
setInterval(app.locals.cleanup, 24 * 60 * 60 * 1000).unref();

app.listen(port, "0.0.0.0", () => {
  console.log(`${APP_NAME} kjører på ${appUrl()}`);
  if (!process.env.SMTP_HOST) console.log("E-post er ikke satt opp (SMTP_HOST). Lenker for nytt passord og bekreftelse av e-post skrives til loggen.");
});
