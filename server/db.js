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
  if (!columns("users").includes("email")) {
    db.exec("ALTER TABLE users ADD COLUMN email TEXT");
  }
  if (!columns("users").includes("email_verified")) {
    db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
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
}
