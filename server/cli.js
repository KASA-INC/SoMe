// Verktøy for den som drifter tjenesten. Kjøres på serveren, f.eks. i Render sin «Shell»:
//   npm run reset-link -- <e-post eller brukernavn>   Engangslenke (én time) for å sette nytt passord
//   npm run reset-all -- SLETT-ALT                     Sletter alle kontoer, grupper, innlegg og filer
//   npm run test-mail -- <e-postadresse>               Sender en test-e-post for å sjekke SMTP-oppsettet
//   npm run verify-email -- <e-postadresse>            Bekrefter e-posten til en foresatt manuelt (hvis e-post ikke kom fram)
import { readdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
import { appUrl, APP_NAME } from "./config.js";
import { createMailer } from "./mail.js";
import { renderEmail } from "./email.js";

const CONFIRM_WORD = "SLETT-ALT";
const [command, arg] = process.argv.slice(2);
const mediaDir = process.env.MEDIA_DIR || "data/media";
const db = openDb(process.env.DB_PATH || "data/some.db");

if (command === "reset-link" && arg) resetLink(arg);
else if (command === "reset-all") resetAll(arg);
else if (command === "test-mail" && arg) await testMail(arg);
else if (command === "verify-email" && arg) verifyEmail(arg);
else if (command === "admin" && arg && process.argv[4] === "nullstill") resetMfa(arg);
else if (command === "admin" && arg) setAdmin(arg, process.argv[4] !== "av");
else {
  console.log("Bruk:\n  npm run reset-link -- <e-post eller brukernavn>\n  npm run reset-all -- " + CONFIRM_WORD
    + "\n  npm run test-mail -- <e-postadresse>\n  npm run verify-email -- <e-postadresse>"
    + "\n  npm run admin -- <e-postadresse> [av | nullstill]");
  process.exit(1);
}

function resetLink(username) {
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
  const app = createApp({ db, mediaDir, appUrl: appUrl() });
  console.log(`Lenke for å sette nytt passord for ${user.display_name} (gyldig i én time):\n${app.locals.createResetLink(user.id)}`);
}

function verifyEmail(email) {
  const { changes } = db.prepare("UPDATE users SET email_verified = 1 WHERE email = ? AND role = 'parent'").run(email.trim().toLowerCase());
  if (!changes) {
    console.error(`Fant ingen foresatt med «${email}».`);
    process.exit(1);
  }
  db.prepare("DELETE FROM email_verifications WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email.trim().toLowerCase());
  console.log(`E-postadressen ${email} er bekreftet.`);
}

// Gjør en foresatt til administrator (eller tar det bort med «av»). Finnes bare her, aldri i appen,
// så ingen kan gjøre seg selv til administrator.
function setAdmin(email, on) {
  const { changes } = db.prepare("UPDATE users SET is_admin = ? WHERE email = ? AND role = 'parent'").run(on ? 1 : 0, email.trim().toLowerCase());
  if (!changes) {
    console.error(`Fant ingen foresatt med «${email}».`);
    process.exit(1);
  }
  console.log(on ? `${email} er nå administrator. Fanen «Admin» vises neste gang appen lastes.` : `${email} er ikke administrator lenger.`);
}

// Har administratoren mistet telefonen med autentiseringsappen: slå av to-trinns innlogging,
// så hen kan sette det opp på nytt. Kan bare gjøres på serveren.
function resetMfa(email) {
  const { changes } = db.prepare("UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_last_step = 0 WHERE email = ? AND role = 'parent'").run(email.trim().toLowerCase());
  if (!changes) {
    console.error(`Fant ingen foresatt med «${email}».`);
    process.exit(1);
  }
  db.prepare("UPDATE sessions SET mfa_at = NULL WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email.trim().toLowerCase());
  console.log(`To-trinns innlogging er slått av for ${email}. Den settes opp på nytt under Admin.`);
}

// Sender en test-e-post med samme oppsett som «Glemt passord» bruker.
async function testMail(to) {
  const mailer = createMailer();
  if (!mailer.configured) {
    console.error("E-post er ikke satt opp: SMTP_HOST mangler under Environment i Render.");
    process.exit(1);
  }
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, MAIL_FROM } = process.env;
  console.log(`Sender via ${SMTP_HOST}:${SMTP_PORT || 587} som ${MAIL_FROM || SMTP_USER} til ${to} …`);
  try {
    await mailer.send({
      to,
      subject: `Test fra ${APP_NAME}`,
      ...renderEmail({
        preheader: "E-posten virker.",
        heading: "Hei!",
        paragraphs: [`Dette er en test. Kommer denne fram, virker e-posten fra ${APP_NAME}: bekreftelse av e-post, «Glemt passord» og beskjeder om nye medlemmer.`],
        button: { label: `Åpne ${APP_NAME}`, url: appUrl() },
      }),
    });
    console.log("Sendt! Sjekk innboksen (og søppelpost).");
  } catch (err) {
    console.error(`Klarte ikke å sende: ${err.message}`);
    process.exit(1);
  }
}

// Nullstiller tjenesten. Alt annet (grupper, innlegg, økter, bilder …) henger på brukerne
// og slettes med dem (ON DELETE CASCADE). Til slutt fjernes alle mediefiler fra disken.
function resetAll(confirm) {
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const before = {
    foresatte: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'parent'").get().n,
    barn: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'child'").get().n,
    grupper: count("groups"),
    innlegg: count("posts"),
    "bilder og videoer": count("media"),
  };
  const files = existsSync(mediaDir) ? readdirSync(mediaDir) : [];
  console.log("Dette slettes:", Object.entries(before).map(([k, v]) => `${v} ${k}`).join(", "), `(${files.length} filer)`);

  if (confirm !== CONFIRM_WORD) {
    console.log(`\nIngenting er slettet. Kjør på nytt med bekreftelse for å slette alt:\n  npm run reset-all -- ${CONFIRM_WORD}`);
    process.exit(1);
  }

  db.exec("BEGIN");
  for (const table of ["sessions", "password_resets", "email_verifications", "parent_invites", "child_shares", "group_invitations", "guardians", "admin_log", "banned_emails", "daily_stats", "incident_alerts", "incidents", "safety_reports", "usage", "reports", "media", "posts", "adult_reads", "adult_messages", "memberships", "groups", "users"]) {
    db.exec(`DELETE FROM ${table}`);
  }
  db.exec("COMMIT");
  db.exec("VACUUM");
  for (const file of files) unlinkSync(join(mediaDir, file));

  const left = ["users", "groups", "posts", "media", "sessions"].reduce((n, t) => n + count(t), 0);
  if (left) {
    console.error(`Noe ble ikke slettet (${left} rader igjen).`);
    process.exit(1);
  }
  console.log("Ferdig. Alle kontoer, grupper, innlegg og filer er slettet, og alle er logget ut.");
}
