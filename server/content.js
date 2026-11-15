'use strict';
/*
 * Moves content between the repo's content/ folder (JSON files, version
 * controlled) and the SQLite database (what the app actually serves and what
 * the admin UI edits).
 *
 *   content/paths.json             - the six paths (name, emoji, colors, blurb)
 *   content/<slug>/day-NN.json     - puzzles for one path on one day
 *   content/_shared/day-NN.json    - Christmas / faith bonus puzzles every path gets
 */
const fs = require('fs');
const path = require('path');
const { db } = require('./db');
const { types } = require('./puzzles');

const CONTENT_DIR = process.env.CONTENT_DIR || path.join(__dirname, '..', 'content');
const COMMON_KEYS = ['id', 'section', 'type', 'title', 'points', 'status'];
const SHARED = '_shared';

function splitPuzzle(p) {
  const data = {};
  for (const [k, v] of Object.entries(p)) if (!COMMON_KEYS.includes(k)) data[k] = v;
  return data;
}

function puzzleRowToJson(row) {
  return {
    id: row.id,
    section: row.section,
    type: row.type,
    ...(row.title ? { title: row.title } : {}),
    points: row.points,
    status: row.status,
    ...JSON.parse(row.data),
  };
}

/**
 * Upsert a bundle { paths: [...], days: [{path, day, title, intro, puzzles: [...]}] }.
 * Puzzles/days edited in the admin UI are left alone unless force = true.
 */
function importBundle(bundle, { force = false } = {}) {
  const stats = { paths: 0, days: 0, added: 0, updated: 0, skippedEdited: 0, errors: [] };
  const upsertPath = db.prepare(`
    INSERT INTO paths (slug, name, emoji, color, tagline, description, sort)
    VALUES (@slug, @name, @emoji, @color, @tagline, @description, @sort)
    ON CONFLICT(slug) DO UPDATE SET name=excluded.name, emoji=excluded.emoji, color=excluded.color,
      tagline=excluded.tagline, description=excluded.description, sort=excluded.sort`);
  const insertPathIfMissing = db.prepare(`
    INSERT OR IGNORE INTO paths (slug, name, emoji, color, tagline, description, sort)
    VALUES (@slug, @name, @emoji, @color, @tagline, @description, @sort)`);
  const getDay = db.prepare('SELECT edited FROM days WHERE path_slug = ? AND day = ?');
  const upsertDay = db.prepare(`
    INSERT INTO days (path_slug, day, title, intro, edited) VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(path_slug, day) DO UPDATE SET title=excluded.title, intro=excluded.intro, edited=0`);
  const getPuzzle = db.prepare('SELECT edited FROM puzzles WHERE id = ?');
  const upsertPuzzle = db.prepare(`
    INSERT INTO puzzles (id, path_slug, day, section, position, type, title, points, status, data, edited, updated_at)
    VALUES (@id, @path_slug, @day, @section, @position, @type, @title, @points, @status, @data, 0, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET path_slug=excluded.path_slug, day=excluded.day, section=excluded.section,
      position=excluded.position, type=excluded.type, title=excluded.title, points=excluded.points,
      status=excluded.status, data=excluded.data, edited=0, updated_at=excluded.updated_at`);

  db.transaction(() => {
    for (const p of bundle.paths || []) {
      const row = {
        slug: p.slug, name: p.name, emoji: p.emoji || '🎄', color: p.color || '#c0392b',
        tagline: p.tagline || '', description: p.description || '', sort: p.sort ?? 0,
      };
      // Path display info edited in the admin wins unless forced
      (force ? upsertPath : insertPathIfMissing).run(row);
      stats.paths++;
    }
    for (const d of bundle.days || []) {
      const day = Number(d.day);
      if (!(day >= 1 && day <= 25)) { stats.errors.push(`${d.path}: bad day "${d.day}"`); continue; }
      const existingDay = getDay.get(d.path, day);
      if (d.title || d.intro) {
        if (!existingDay || !existingDay.edited || force) upsertDay.run(d.path, day, d.title || '', d.intro || '');
      }
      stats.days++;
      (d.puzzles || []).forEach((p, i) => {
        if (!p.id) { stats.errors.push(`${d.path} day ${day}: puzzle #${i + 1} has no id`); return; }
        if (!types[p.type]) { stats.errors.push(`${p.id}: unknown type "${p.type}"`); return; }
        const existing = getPuzzle.get(p.id);
        if (existing && existing.edited && !force) { stats.skippedEdited++; return; }
        upsertPuzzle.run({
          id: p.id, path_slug: d.path, day, section: p.section || 'main', position: i,
          type: p.type, title: p.title || '', points: p.points ?? types[p.type].points,
          status: p.status || 'ready', data: JSON.stringify(splitPuzzle(p)),
        });
        existing ? stats.updated++ : stats.added++;
      });
    }
  })();
  return stats;
}

function readContentDir(dir = CONTENT_DIR) {
  const bundle = { paths: [], days: [] };
  const pathsFile = path.join(dir, 'paths.json');
  if (fs.existsSync(pathsFile)) bundle.paths = JSON.parse(fs.readFileSync(pathsFile, 'utf8'));
  if (!fs.existsSync(dir)) return bundle;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(dir, entry.name)).sort()) {
      const m = f.match(/^day-(\d{1,2})\.json$/);
      if (!m) continue;
      const file = path.join(dir, entry.name, f);
      try {
        const json = JSON.parse(fs.readFileSync(file, 'utf8'));
        bundle.days.push({ path: entry.name, day: Number(json.day || m[1]), ...json });
      } catch (e) {
        throw new Error(`Could not parse ${file}: ${e.message}`);
      }
    }
  }
  return bundle;
}

function importFromContentDir(opts) {
  return importBundle(readContentDir(), opts);
}

function exportBundle() {
  const paths = db.prepare('SELECT slug, name, emoji, color, tagline, description, sort FROM paths ORDER BY sort, slug').all();
  const days = new Map();
  const key = (p, d) => `${p}|${d}`;
  for (const d of db.prepare('SELECT * FROM days ORDER BY path_slug, day').all()) {
    days.set(key(d.path_slug, d.day), { path: d.path_slug, day: d.day, title: d.title, intro: d.intro, puzzles: [] });
  }
  const sectionOrder = { main: 0, christmas: 1, faith: 2 };
  const puzzles = db.prepare('SELECT * FROM puzzles ORDER BY path_slug, day, position, id').all()
    .sort((a, b) => a.path_slug.localeCompare(b.path_slug) || a.day - b.day ||
      (sectionOrder[a.section] ?? 9) - (sectionOrder[b.section] ?? 9) || a.position - b.position);
  for (const p of puzzles) {
    const k = key(p.path_slug, p.day);
    if (!days.has(k)) days.set(k, { path: p.path_slug, day: p.day, title: '', intro: '', puzzles: [] });
    days.get(k).puzzles.push(puzzleRowToJson(p));
  }
  return { exportedAt: new Date().toISOString(), paths, days: [...days.values()] };
}

module.exports = {
  CONTENT_DIR, SHARED, importBundle, importFromContentDir, readContentDir,
  exportBundle, puzzleRowToJson, splitPuzzle,
};
