'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'christmas.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS paths (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  emoji       TEXT DEFAULT '🎄',
  color       TEXT DEFAULT '#c0392b',
  tagline     TEXT DEFAULT '',
  description TEXT DEFAULT '',
  sort        INTEGER DEFAULT 0,
  pin         TEXT DEFAULT ''
);

-- Optional per-day title / intro text for a path (path_slug '_shared' = applies to everyone)
CREATE TABLE IF NOT EXISTS days (
  path_slug TEXT NOT NULL,
  day       INTEGER NOT NULL,
  title     TEXT DEFAULT '',
  intro     TEXT DEFAULT '',
  edited    INTEGER DEFAULT 0,
  PRIMARY KEY (path_slug, day)
);

-- path_slug '_shared' puzzles show up on every path for that day
CREATE TABLE IF NOT EXISTS puzzles (
  id         TEXT PRIMARY KEY,
  path_slug  TEXT NOT NULL,
  day        INTEGER NOT NULL,
  section    TEXT NOT NULL DEFAULT 'main',
  position   INTEGER NOT NULL DEFAULT 0,
  type       TEXT NOT NULL,
  title      TEXT DEFAULT '',
  points     INTEGER NOT NULL DEFAULT 1,
  status     TEXT NOT NULL DEFAULT 'ready',
  data       TEXT NOT NULL DEFAULT '{}',
  edited     INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_puzzles_path_day ON puzzles(path_slug, day);

-- player = path slug (or "<slug>~preview" for the admin's preview sandbox)
CREATE TABLE IF NOT EXISTS progress (
  player       TEXT NOT NULL,
  puzzle_id    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'in_progress',
  correct      INTEGER NOT NULL DEFAULT 0,
  score        INTEGER NOT NULL DEFAULT 0,
  attempts     INTEGER NOT NULL DEFAULT 0,
  state        TEXT NOT NULL DEFAULT '{}',
  started_at   TEXT,
  completed_at TEXT,
  PRIMARY KEY (player, puzzle_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`);

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value == null ? null : String(value));
}

// A persistent secret for signing cookies (survives restarts, unique per install).
function getSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  let s = getSetting('session_secret');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    setSetting('session_secret', s);
  }
  return s;
}

module.exports = { db, DATA_DIR, getSetting, setSetting, getSecret };
