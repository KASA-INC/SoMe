import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('parent', 'child')),
  display_name TEXT NOT NULL,
  email TEXT, -- bare for foresatte, brukes til innlogging og «Glemt passord»
  -- 1 når foresatte har åpnet bekreftelseslenken. Uten bekreftet e-post kan man ikke lage barn eller grupper.
  email_verified INTEGER NOT NULL DEFAULT 0,
  avatar TEXT NOT NULL DEFAULT '🙂',
  parent_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  -- Grenser som foresatte styrer (gjelder bare barn)
  daily_minutes INTEGER NOT NULL DEFAULT 20,
  open_from TEXT NOT NULL DEFAULT '07:00',
  open_to TEXT NOT NULL DEFAULT '20:00',
  posts_per_day INTEGER NOT NULL DEFAULT 5,
  -- 1 når barnet har sett introduksjonen (bl.a. at voksne kan lese det som deles)
  onboarded INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Engangslenker for å bekrefte en e-postadresse (ny konto eller ny adresse). Bare en hash av koden lagres.
CREATE TABLE IF NOT EXISTS email_verifications (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Engangslenker for å sette nytt passord. Bare en hash av koden lagres.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 1: bilder og video vises ikke for andre barn før gruppeeieren har godkjent dem
  media_review INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 0: venter på at gruppeeieren godkjenner barnet. Barnet ser ingenting i gruppa før det er godkjent.
  approved INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  sticker TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL,
  day TEXT NOT NULL, -- dato i appens tidssone, brukes til grensen for innlegg per dag
  -- visible: vises, hidden: rapportert og venter på en voksen, removed: fjernet
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'removed')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_group_time ON posts (group_id, created_at);
CREATE INDEX IF NOT EXISTS posts_author_day ON posts (author_id, day);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Bilde eller video. Lastes opp først (post_id NULL), og knyttes til et innlegg når det deles.
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY, -- tilfeldig, brukes også som filnavn
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('image', 'video')),
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  duration REAL,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Voksenkontakt: meldinger mellom foresatte i en gruppe. Barna ser dem aldri.
CREATE TABLE IF NOT EXISTS adult_messages (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS adult_messages_group ON adult_messages (group_id, id);

-- Hvor langt hver foresatt har lest i voksenkontakten, for å vise antall uleste.
CREATE TABLE IF NOT EXISTS adult_reads (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, user_id)
);

-- Push-varsler: ett abonnement per enhet der en foresatt har slått på varsler.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Invitasjoner fra en foresatt til en annen. Lenken lar den inviterte lage konto uten registreringskode.
-- Bare en hash av koden lagres. Raden slettes når invitasjonen er brukt eller har gått ut.
CREATE TABLE IF NOT EXISTS parent_invites (
  token_hash TEXT PRIMARY KEY,
  inviter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE, -- invitasjon til en bestemt gruppe (valgfritt)
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Foresatte for et barn. Den som laget barnekontoen, står også i users.parent_id (første foresatt).
-- Flere foresatte kommer til med en delingslenke fra en som allerede er foresatt, og alle har samme tilgang.
CREATE TABLE IF NOT EXISTS guardians (
  child_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (child_id, parent_id)
);
CREATE INDEX IF NOT EXISTS guardians_parent ON guardians (parent_id);

-- Engangslenker for å dele et barn med en annen foresatt. Bare en hash av koden lagres.
CREATE TABLE IF NOT EXISTS child_shares (
  token_hash TEXT PRIMARY KEY,
  child_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inviter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Administrasjon. Bare den som drifter quipu, er administrator (settes med «npm run admin», aldri i appen).
-- Statistikk lagres som dagssummer uten navn eller id-er, så ingen kan spores.
CREATE TABLE IF NOT EXISTS daily_stats (
  day TEXT PRIMARY KEY,
  active_children INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  posts INTEGER NOT NULL,
  posts_media INTEGER NOT NULL,
  reports INTEGER NOT NULL,
  new_parents INTEGER NOT NULL,
  new_children INTEGER NOT NULL
);
-- E-postadresser som ikke kan registreres igjen etter utestenging. Bare en hash lagres.
CREATE TABLE IF NOT EXISTS banned_emails (
  email_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
-- Alt en administrator gjør, logges.
CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- Bremsen mot gjetting av passord (se auth.js). Nøkkelen er en hash, så ingen IP-adresser lagres.
CREATE TABLE IF NOT EXISTS login_failures (
  key_hash TEXT PRIMARY KEY,
  first INTEGER NOT NULL,
  count INTEGER NOT NULL
);

-- Barn kan si fra om noe direkte til dem som drifter quipu, utenom gruppa og foresatte
-- (for eksempel når problemet er en voksen). Bare administrator ser disse.
CREATE TABLE IF NOT EXISTS safety_reports (
  id INTEGER PRIMARY KEY,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT ''
);

-- Alvorlige saker (trusler, ekkel kontakt, farlige bilder) som noen må ta ansvar for.
-- En sak er åpen til en administrator har kvittert. Uten kvittering varsles neste på vaktlisten.
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('post', 'safety')), -- meldt innlegg eller «Si fra om noe annet»
  ref_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  step INTEGER NOT NULL DEFAULT 0,       -- hvor langt ned på vaktlisten varselet har gått
  next_at INTEGER NOT NULL,              -- når neste varsel sendes hvis ingen har kvittert
  acked_at INTEGER,
  acked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (kind, ref_id)
);
-- Hvert varsel som er sendt for en sak. «Sendt» betyr ikke lest: bare kvitteringen i incidents gjør det.
CREATE TABLE IF NOT EXISTS incident_alerts (
  id INTEGER PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recipient TEXT NOT NULL,               -- e-postadresse, eller «push» med enhet
  channel TEXT NOT NULL,                 -- email eller push
  step INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT NOT NULL DEFAULT ''
);

-- Foresatte som er invitert til en gruppe. Med invitasjonen kan de melde inn barnet uten invitasjonskode.
-- Har eieren av gruppa invitert, slipper barnet rett inn (auto_approve). Ellers må eieren godkjenne som vanlig.
CREATE TABLE IF NOT EXISTS group_invitations (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  inviter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  auto_approve INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, group_id)
);

-- Innstillinger for tjenesten, f.eks. nøklene til push-varsler.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0,
  last_beat INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
`;

export function openDb(path = ":memory:") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Legg til kolonner i databaser som ble laget før kolonnene fantes.
function migrate(db) {
  const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!columns("groups").includes("media_review")) {
    db.exec("ALTER TABLE groups ADD COLUMN media_review INTEGER NOT NULL DEFAULT 1");
  }
  if (!columns("users").includes("onboarded")) {
    db.exec("ALTER TABLE users ADD COLUMN onboarded INTEGER NOT NULL DEFAULT 0");
  }
  // Sletting ved lang inaktivitet: når kontoen sist ble brukt, og når gruppa sist hadde noe nytt.
  // Fra før regnes alt som brukt i dag, så ingenting slettes før det har gått et helt år (seks måneder for grupper).
  if (!columns("users").includes("last_active")) {
    db.exec("ALTER TABLE users ADD COLUMN last_active INTEGER; ALTER TABLE users ADD COLUMN deletion_warned_at INTEGER");
    db.prepare("UPDATE users SET last_active = ?").run(Date.now());
  }
  if (!columns("groups").includes("last_activity")) {
    db.exec("ALTER TABLE groups ADD COLUMN last_activity INTEGER; ALTER TABLE groups ADD COLUMN deletion_warned_at INTEGER");
    db.prepare("UPDATE groups SET last_activity = ?").run(Date.now());
  }
  if (!columns("users").includes("email")) {
    db.exec("ALTER TABLE users ADD COLUMN email TEXT");
  }
  if (!columns("users").includes("email_verified")) {
    db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns("users").includes("notify_email")) {
    // off, soon (kort tid etter nye beskjeder, samlet) eller daily (én gang om dagen)
    db.exec("ALTER TABLE users ADD COLUMN notify_email TEXT NOT NULL DEFAULT 'soon'");
    db.exec("ALTER TABLE users ADD COLUMN notify_daily_day TEXT");
  }
  if (!columns("adult_reads").includes("notified_id")) {
    // Siste melding den foresatte har fått e-post om, så samme melding ikke sendes to ganger.
    db.exec("ALTER TABLE adult_reads ADD COLUMN notified_id INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns("media").includes("adult_message_id")) {
    // Bilder i voksenkontakten knyttes til en melding i stedet for et innlegg.
    db.exec("ALTER TABLE media ADD COLUMN adult_message_id INTEGER REFERENCES adult_messages(id) ON DELETE CASCADE");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS media_adult_message ON media (adult_message_id) WHERE adult_message_id IS NOT NULL");
  if (!columns("users").includes("is_admin")) {
    db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
    // Utestengt: når, hvorfor, og om det var fordi den eneste foresatte ble utestengt («parent»).
    db.exec("ALTER TABLE users ADD COLUMN suspended_at INTEGER");
    db.exec("ALTER TABLE users ADD COLUMN suspended_reason TEXT");
    db.exec("ALTER TABLE users ADD COLUMN suspended_cause TEXT");
  }
  if (!columns("users").includes("totp_secret")) {
    // To-trinns innlogging (engangskode fra en app) for administrator.
    db.exec("ALTER TABLE users ADD COLUMN totp_secret TEXT");
    db.exec("ALTER TABLE users ADD COLUMN totp_pending TEXT");
    db.exec("ALTER TABLE users ADD COLUMN totp_last_step INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns("users").includes("oncall_rank")) {
    // Vaktliste for administratorer: 1 = vakthavende, 2 = reserve, osv. NULL = ikke på vaktlisten.
    db.exec("ALTER TABLE users ADD COLUMN oncall_rank INTEGER");
  }
  if (!columns("sessions").includes("device")) {
    // Når innloggingen startet, sist ble brukt, og hvilken type enhet (for eksempel «iPhone · Safari»).
    db.exec("ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0");
    db.exec("ALTER TABLE sessions ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0");
    db.exec("ALTER TABLE sessions ADD COLUMN device TEXT NOT NULL DEFAULT ''");
  }
  if (!columns("sessions").includes("mfa_at")) {
    db.exec("ALTER TABLE sessions ADD COLUMN mfa_at INTEGER"); // når engangskoden sist ble skrevet inn på denne enheten
  }
  if (!columns("reports").includes("category")) {
    db.exec("ALTER TABLE reports ADD COLUMN category TEXT NOT NULL DEFAULT 'annet'");
  }
  if (!columns("posts").includes("hold")) {
    // Bevart som dokumentasjon i en alvorlig sak: slettes ikke av oppryddingen før administrator slipper det.
    db.exec("ALTER TABLE posts ADD COLUMN hold INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns("parent_invites").includes("group_id")) {
    db.exec("ALTER TABLE parent_invites ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE");
  }
  if (!columns("users").includes("invited_by")) {
    // Hvem som inviterte en foresatt, så man kan se hvem som har kommet inn gjennom hvem.
    db.exec("ALTER TABLE users ADD COLUMN invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL");
  }
  if (!columns("memberships").includes("approved")) {
    db.exec("ALTER TABLE memberships ADD COLUMN approved INTEGER NOT NULL DEFAULT 1");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (email) WHERE email IS NOT NULL");
  // Versjon 1: standard innlegg per dag gikk fra 2 til 5. Barn som sto på den gamle standarden, flyttes én gang.
  if (db.prepare("PRAGMA user_version").get().user_version < 1) {
    db.exec("UPDATE users SET posts_per_day = 5 WHERE role = 'child' AND posts_per_day = 2; PRAGMA user_version = 1");
  }
  // Versjon 2: e-postbekreftelse kom. Foresatte som allerede hadde e-post, regnes som bekreftet.
  if (db.prepare("PRAGMA user_version").get().user_version < 2) {
    db.exec("UPDATE users SET email_verified = 1 WHERE role = 'parent' AND email IS NOT NULL; PRAGMA user_version = 2");
  }
  // Versjon 3: barnas emoji-profilbilder ble byttet ut med tegnede figurer (c01–c24). Hver emoji får sin egen figur.
  if (db.prepare("PRAGMA user_version").get().user_version < 3) {
    const OLD = ["🦊", "🐼", "🐸", "🐯", "🐧", "🦖", "🐙", "🦉", "⚡", "🎧", "🚀", "🌊", "🔥", "🌙", "🎮", "🎸"];
    const update = db.prepare("UPDATE users SET avatar = ? WHERE role = 'child' AND avatar = ?");
    OLD.forEach((emoji, i) => update.run(`c${String(i + 1).padStart(2, "0")}`, emoji));
    db.exec("UPDATE users SET avatar = 'c01' WHERE role = 'child' AND avatar NOT GLOB 'c[0-9][0-9]'; PRAGMA user_version = 3");
  }
  // Versjon 4: foresatte får også en figur (valgt automatisk ut fra kontoen) i stedet for emoji.
  if (db.prepare("PRAGMA user_version").get().user_version < 4) {
    db.exec(`UPDATE users SET avatar = printf('c%02d', (id % 24) + 1) WHERE role = 'parent' AND avatar NOT GLOB 'c[0-9][0-9]';
      PRAGMA user_version = 4`);
  }
  // Versjon 5: et barn kan ha flere foresatte. Den som laget kontoen, blir første foresatt.
  if (db.prepare("PRAGMA user_version").get().user_version < 5) {
    db.exec(`INSERT OR IGNORE INTO guardians (child_id, parent_id, created_at)
      SELECT id, parent_id, created_at FROM users WHERE role = 'child' AND parent_id IS NOT NULL; PRAGMA user_version = 5`);
  }
  // Nattpause: åpningstider som gir under 10 timers pause, eller er åpne mellom 23 og 06, settes til standard 07–20.
  if (db.prepare("PRAGMA user_version").get().user_version < 6) {
    db.exec(`UPDATE users SET open_from = '07:00', open_to = '20:00' WHERE role = 'child' AND (open_from < '06:00' OR open_to > '23:00'
      OR (CAST(substr(open_to, 1, 2) AS INTEGER) * 60 + CAST(substr(open_to, 4, 2) AS INTEGER))
       - (CAST(substr(open_from, 1, 2) AS INTEGER) * 60 + CAST(substr(open_from, 4, 2) AS INTEGER)) > 840);
      PRAGMA user_version = 6`);
  }
}
