import { openDb } from "./db.js";
import { createApp } from "./app.js";

const port = Number(process.env.PORT) || 3000;
const db = openDb(process.env.DB_PATH || "data/some.db");
const app = createApp({
  db,
  mediaDir: process.env.MEDIA_DIR || "data/media",
  secureCookies: process.env.NODE_ENV === "production",
});

// Bak en proxy (f.eks. Render, Fly eller nginx) trenger vi riktig klient-IP til innloggingsbremsen.
if (process.env.TRUST_PROXY) app.set("trust proxy", 1);

// Rydd bort filer fra slettede innlegg og opplastinger som aldri ble delt.
app.locals.sweepMedia();
setInterval(app.locals.sweepMedia, 15 * 60 * 1000).unref();

app.listen(port, () => console.log(`SoMe Kids kjører på http://localhost:${port}`));
