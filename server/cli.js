// Verktøy for den som drifter tjenesten. Kjøres på serveren, f.eks. i Render sin «Shell»:
//   npm run reset-link -- <e-post eller brukernavn>
// Skriver ut en engangslenke (gyldig i én time) for å sette nytt passord.
import { openDb } from "./db.js";
import { createApp } from "./app.js";
import { appUrl } from "./config.js";

const [command, username] = process.argv.slice(2);
if (command !== "reset-link" || !username) {
  console.log("Bruk: npm run reset-link -- <e-post eller brukernavn>");
  process.exit(1);
}

const db = openDb(process.env.DB_PATH || "data/some.db");
const login = username.trim().toLowerCase();
const user = db.prepare(`SELECT id, role, display_name FROM users WHERE ${login.includes("@") ? "email" : "username"} = ?`).get(login);
if (!user) {
  console.error(`Fant ingen bruker med «${username}».`);
  process.exit(1);
}
if (user.role !== "parent") {
  console.error("Det er en barnekonto. Barnets foresatte kan sette nytt passord under «Barn» → grenser og passord.");
  process.exit(1);
}
const app = createApp({ db, mediaDir: process.env.MEDIA_DIR || "data/media", appUrl: appUrl() });
console.log(`Lenke for å sette nytt passord for ${user.display_name} (gyldig i én time):\n${app.locals.createResetLink(user.id)}`);
