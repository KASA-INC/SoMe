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
  avatar TEXT NOT NULL DEFAULT '🙂',
  parent_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  -- Grenser som foresatte styrer (gjelder bare barn)
  daily_minutes INTEGER NOT NULL DEFAULT 20,
  open_from TEXT NOT NULL DEFAULT '07:00',
  open_to TEXT NOT NULL DEFAULT '20:00',
  posts_per_day INTEGER NOT NULL DEFAULT 2,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  return db;
}
