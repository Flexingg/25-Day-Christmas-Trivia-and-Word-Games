'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

const { db, DATA_DIR, getSetting, setSetting, getSecret } = require('./db');
const { calendarInfo, unlockedThrough, LAST_DAY } = require('./dates');
const { types, SECTIONS, getType, clientPuzzle, SubmissionError } = require('./puzzles');
const content = require('./content');
const dictionary = require('./dictionary');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (ADMIN_PASSWORD === 'changeme') {
  console.warn('⚠️  ADMIN_PASSWORD is not set — using "changeme". Set it in docker-compose / your .env!');
}

// ---------- first boot: load content/ into the database ----------
if (db.prepare('SELECT COUNT(*) AS n FROM paths').get().n === 0) {
  const stats = content.importFromContentDir();
  console.log('Seeded database from content/:', stats);
}

// The pseudo-path that holds bonus puzzles every player gets
db.prepare(`INSERT OR IGNORE INTO paths (slug, name, emoji, color, tagline, sort)
  VALUES (?, 'Everyone (shared bonus)', '🎁', '#1f6f43', 'Christmas & faith bonus puzzles shown on every path', 0)`).run(content.SHARED);

// ---------- auth (tiny signed cookies, no extra deps) ----------
const SECRET = getSecret();
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const adminToken = () => sign('admin:' + ADMIN_PASSWORD);
const pathToken = (slug, pin) => sign(`path:${slug}:${pin}`);

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, name, value, maxAgeDays = 120) {
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeDays * 86400}`);
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const isAdmin = (req) => safeEqual(parseCookies(req).rc_admin || '', adminToken());

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required' });
  next();
}

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

function getPath(slug) {
  const p = db.prepare('SELECT * FROM paths WHERE slug = ?').get(slug);
  if (!p || slug === content.SHARED) throw new HttpError(404, 'No such path');
  return p;
}

// Resolves who is playing. Preview mode (?preview=1) is admin-only: it ignores
// the calendar, shows drafts, and saves progress to a separate sandbox.
function playerContext(req, slug) {
  const p = getPath(slug);
  const preview = req.query.preview === '1';
  if (preview) {
    if (!isAdmin(req)) throw new HttpError(401, 'Admin login required for preview');
    return { path: p, player: `${slug}~preview`, preview: true, unlocked: LAST_DAY };
  }
  if (p.pin && !safeEqual(parseCookies(req)[`rc_p_${slug}`] || '', pathToken(slug, p.pin))) {
    throw new HttpError(403, 'PIN required', { needPin: true });
  }
  return { path: p, player: slug, preview: false, unlocked: unlockedThrough() };
}

// ---------- puzzle queries ----------
const SECTION_ORDER = Object.keys(SECTIONS);

function sortPuzzles(list) {
  return list.sort((a, b) =>
    SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) ||
    (a.path_slug === content.SHARED) - (b.path_slug === content.SHARED) ||
    a.position - b.position || a.id.localeCompare(b.id));
}

function puzzlesFor(slug, { day = null, includeDrafts = false } = {}) {
  const rows = db.prepare(`
    SELECT * FROM puzzles
    WHERE path_slug IN (?, ?) ${day ? 'AND day = ?' : ''} ${includeDrafts ? '' : "AND status = 'ready'"}
  `).all(...[slug, content.SHARED, ...(day ? [day] : [])]);
  return sortPuzzles(rows);
}

function progressMap(player) {
  const map = new Map();
  for (const r of db.prepare('SELECT * FROM progress WHERE player = ?').all(player)) map.set(r.puzzle_id, r);
  return map;
}

function dayMeta(slug, day) {
  const own = db.prepare('SELECT title, intro FROM days WHERE path_slug = ? AND day = ?').get(slug, day);
  const shared = db.prepare('SELECT title, intro FROM days WHERE path_slug = ? AND day = ?').get(content.SHARED, day);
  return {
    title: own?.title || shared?.title || `Day ${day}`,
    intro: own?.intro || shared?.intro || '',
  };
}

function pathSummary(slug, player, opts = {}) {
  const puzzles = puzzlesFor(slug, opts);
  const prog = progressMap(player);
  const days = [];
  for (let d = 1; d <= LAST_DAY; d++) {
    const ps = puzzles.filter(p => p.day === d);
    const done = ps.filter(p => prog.get(p.id)?.status === 'done');
    days.push({
      day: d,
      total: ps.length,
      done: done.length,
      score: done.reduce((s, p) => s + (prog.get(p.id).score || 0), 0),
      possible: ps.reduce((s, p) => s + p.points, 0),
    });
  }
  const score = days.reduce((s, d) => s + d.score, 0);
  const completeDays = days.filter(d => d.total > 0 && d.done === d.total).length;
  return { days, score, completeDays };
}

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '15mb' }));

const api = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);

// --- player API ---
api.get('/meta', wrap((req, res) => {
  const paths = db.prepare('SELECT * FROM paths WHERE slug != ? ORDER BY sort, name').all(content.SHARED);
  res.json({
    calendar: calendarInfo(),
    isAdmin: isAdmin(req),
    sections: SECTIONS,
    paths: paths.map(p => {
      const s = pathSummary(p.slug, p.slug);
      return {
        slug: p.slug, name: p.name, emoji: p.emoji, color: p.color, tagline: p.tagline,
        hasPin: !!p.pin, score: s.score, completeDays: s.completeDays,
      };
    }),
  });
}));

api.post('/paths/:slug/unlock', wrap((req, res) => {
  const p = getPath(req.params.slug);
  if (p.pin && String(req.body.pin || '') !== p.pin) throw new HttpError(403, 'Wrong PIN', { needPin: true });
  setCookie(res, `rc_p_${p.slug}`, pathToken(p.slug, p.pin || ''));
  res.json({ ok: true });
}));

api.get('/paths/:slug', wrap((req, res) => {
  const ctx = playerContext(req, req.params.slug);
  const summary = pathSummary(ctx.path.slug, ctx.player, { includeDrafts: ctx.preview });
  res.json({
    path: { slug: ctx.path.slug, name: ctx.path.name, emoji: ctx.path.emoji, color: ctx.path.color, tagline: ctx.path.tagline, description: ctx.path.description },
    preview: ctx.preview,
    calendar: calendarInfo(),
    unlockedThrough: ctx.unlocked,
    score: summary.score,
    completeDays: summary.completeDays,
    days: summary.days.map(d => ({ ...d, ...dayMeta(ctx.path.slug, d.day), unlocked: d.day <= ctx.unlocked })),
  });
}));

api.get('/paths/:slug/days/:day', wrap((req, res) => {
  const ctx = playerContext(req, req.params.slug);
  const day = Number(req.params.day);
  if (!(day >= 1 && day <= LAST_DAY)) throw new HttpError(404, 'No such day');
  if (day > ctx.unlocked) throw new HttpError(403, `Day ${day} isn't unlocked yet — no peeking! 🎁`, { locked: true });
  const prog = progressMap(ctx.player);
  const puzzles = puzzlesFor(ctx.path.slug, { day, includeDrafts: ctx.preview });
  res.json({
    path: { slug: ctx.path.slug, name: ctx.path.name, emoji: ctx.path.emoji, color: ctx.path.color },
    preview: ctx.preview,
    day,
    ...dayMeta(ctx.path.slug, day),
    unlockedThrough: ctx.unlocked,
    sections: SECTIONS,
    puzzles: puzzles.map(p => clientPuzzle(p, prog.get(p.id))),
  });
}));

api.post('/paths/:slug/puzzles/:id/answer', wrap((req, res) => {
  const ctx = playerContext(req, req.params.slug);
  const p = db.prepare('SELECT * FROM puzzles WHERE id = ? AND path_slug IN (?, ?)').get(req.params.id, ctx.path.slug, content.SHARED);
  if (!p || (p.status !== 'ready' && !ctx.preview)) throw new HttpError(404, 'No such puzzle');
  if (p.day > ctx.unlocked) throw new HttpError(403, 'Not unlocked yet');

  const t = getType(p.type);
  const data = JSON.parse(p.data);
  let row = db.prepare('SELECT * FROM progress WHERE player = ? AND puzzle_id = ?').get(ctx.player, p.id);
  if (row?.status === 'done') throw new HttpError(409, 'Already finished this one!');
  const st = row ? JSON.parse(row.state) : t.initialState();

  let result;
  try {
    result = t.submit(data, req.body.submission || {}, st);
  } catch (e) {
    if (e instanceof SubmissionError) throw new HttpError(400, e.message);
    throw e;
  }
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO progress (player, puzzle_id, status, correct, score, attempts, state, started_at, completed_at)
    VALUES (@player, @puzzle_id, @status, @correct, @score, 1, @state, @now, @completed_at)
    ON CONFLICT(player, puzzle_id) DO UPDATE SET status=excluded.status, correct=excluded.correct, score=excluded.score,
      attempts=attempts + 1, state=excluded.state, completed_at=excluded.completed_at`).run({
    player: ctx.player, puzzle_id: p.id,
    status: result.done ? 'done' : 'in_progress',
    correct: result.correct ? 1 : 0,
    score: result.done ? Math.round(p.points * (result.fraction ?? (result.correct ? 1 : 0))) : 0,
    state: JSON.stringify(st), now,
    completed_at: result.done ? now : null,
  });
  row = db.prepare('SELECT * FROM progress WHERE player = ? AND puzzle_id = ?').get(ctx.player, p.id);
  res.json({ feedback: result.feedback, correct: !!result.correct, good: !!result.good, puzzle: clientPuzzle(p, row) });
}));

// --- admin API ---
const admin = express.Router();

admin.post('/login', wrap((req, res) => {
  if (!safeEqual(String(req.body.password || ''), ADMIN_PASSWORD)) throw new HttpError(401, 'Wrong password');
  setCookie(res, 'rc_admin', adminToken(), 30);
  res.json({ ok: true });
}));
admin.post('/logout', (req, res) => { setCookie(res, 'rc_admin', '', 0); res.json({ ok: true }); });
admin.get('/me', (req, res) => res.json({ isAdmin: isAdmin(req), defaultPassword: ADMIN_PASSWORD === 'changeme' }));

admin.use(requireAdmin);

admin.get('/types', (req, res) => {
  res.json(Object.fromEntries(Object.entries(types).map(([k, t]) => [k, { label: t.label, points: t.points, defaults: t.defaults }])));
});

admin.get('/overview', wrap((req, res) => {
  const paths = db.prepare('SELECT * FROM paths ORDER BY slug = ? DESC, sort, name').all(content.SHARED);
  const counts = db.prepare(`
    SELECT path_slug, day, section, status, COUNT(*) AS n FROM puzzles GROUP BY path_slug, day, section, status`).all();
  const titles = db.prepare('SELECT path_slug, day, title FROM days').all();
  res.json({
    calendar: calendarInfo(),
    sections: SECTIONS,
    paths: paths.map(p => ({
      ...p,
      pin: undefined,
      hasPin: !!p.pin,
      days: Array.from({ length: LAST_DAY }, (_, i) => {
        const day = i + 1;
        const c = counts.filter(r => r.path_slug === p.slug && r.day === day);
        const bySection = {};
        for (const s of Object.keys(SECTIONS)) bySection[s] = c.filter(r => r.section === s && r.status === 'ready').reduce((a, r) => a + r.n, 0);
        return {
          day,
          title: titles.find(t => t.path_slug === p.slug && t.day === day)?.title || '',
          ready: c.filter(r => r.status === 'ready').reduce((a, r) => a + r.n, 0),
          draft: c.filter(r => r.status === 'draft').reduce((a, r) => a + r.n, 0),
          bySection,
        };
      }),
    })),
  });
}));

admin.get('/paths/:slug', wrap((req, res) => {
  const p = db.prepare('SELECT * FROM paths WHERE slug = ?').get(req.params.slug);
  if (!p) throw new HttpError(404, 'No such path');
  res.json(p);
}));

admin.put('/paths/:slug', wrap((req, res) => {
  const p = db.prepare('SELECT * FROM paths WHERE slug = ?').get(req.params.slug);
  if (!p) throw new HttpError(404, 'No such path');
  const b = req.body;
  db.prepare(`UPDATE paths SET name=?, emoji=?, color=?, tagline=?, description=?, sort=?, pin=? WHERE slug=?`).run(
    b.name ?? p.name, b.emoji ?? p.emoji, b.color ?? p.color, b.tagline ?? p.tagline,
    b.description ?? p.description, Number(b.sort ?? p.sort), String(b.pin ?? p.pin ?? '').trim(), p.slug);
  res.json(db.prepare('SELECT * FROM paths WHERE slug = ?').get(p.slug));
}));

admin.get('/paths/:slug/days/:day', wrap((req, res) => {
  const { slug } = req.params; const day = Number(req.params.day);
  const meta = db.prepare('SELECT * FROM days WHERE path_slug = ? AND day = ?').get(slug, day) || { title: '', intro: '' };
  const rows = sortPuzzles(db.prepare('SELECT * FROM puzzles WHERE path_slug = ? AND day = ?').all(slug, day));
  const shared = slug === content.SHARED ? [] :
    sortPuzzles(db.prepare('SELECT * FROM puzzles WHERE path_slug = ? AND day = ?').all(content.SHARED, day));
  res.json({
    path: slug, day, title: meta.title, intro: meta.intro, sections: SECTIONS,
    puzzles: rows.map(content.puzzleRowToJson).map((p, i) => ({ ...p, edited: !!rows[i].edited })),
    sharedPuzzles: shared.map(content.puzzleRowToJson),
  });
}));

admin.put('/paths/:slug/days/:day', wrap((req, res) => {
  const { slug } = req.params; const day = Number(req.params.day);
  db.prepare(`INSERT INTO days (path_slug, day, title, intro, edited) VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(path_slug, day) DO UPDATE SET title=excluded.title, intro=excluded.intro, edited=1`)
    .run(slug, day, req.body.title || '', req.body.intro || '');
  res.json({ ok: true });
}));

function validatePuzzleBody(b) {
  const t = types[b.type];
  if (!t) throw new HttpError(400, `Unknown type "${b.type}"`);
  if (!SECTIONS[b.section]) throw new HttpError(400, `Unknown section "${b.section}"`);
  const data = content.splitPuzzle(b);
  for (const k of ['edited', 'path', 'day', 'position', 'updated_at']) delete data[k];
  const problems = t.validate(data);
  // Drafts can be saved half-finished; "ready" puzzles must be valid
  if (problems.length && b.status !== 'draft') throw new HttpError(400, problems.join(' '), { problems });
  return { data, problems };
}

admin.post('/puzzles', wrap((req, res) => {
  const b = req.body;
  const slug = b.path; const day = Number(b.day);
  if (!db.prepare('SELECT 1 FROM paths WHERE slug = ?').get(slug)) throw new HttpError(400, 'Unknown path');
  if (!(day >= 1 && day <= LAST_DAY)) throw new HttpError(400, 'Day must be 1–25');
  const { data, problems } = validatePuzzleBody(b);
  let id = String(b.id || '').trim();
  if (!id) {
    const prefix = `${slug.replace(/^_/, '')}-d${String(day).padStart(2, '0')}-`;
    let n = db.prepare('SELECT COUNT(*) AS n FROM puzzles WHERE path_slug = ? AND day = ?').get(slug, day).n + 1;
    while (db.prepare('SELECT 1 FROM puzzles WHERE id = ?').get(prefix + String(n).padStart(2, '0'))) n++;
    id = prefix + String(n).padStart(2, '0');
  }
  if (db.prepare('SELECT 1 FROM puzzles WHERE id = ?').get(id)) throw new HttpError(400, `ID "${id}" already exists`);
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM puzzles WHERE path_slug = ? AND day = ? AND section = ?').get(slug, day, b.section).n;
  db.prepare(`INSERT INTO puzzles (id, path_slug, day, section, position, type, title, points, status, data, edited, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))`)
    .run(id, slug, day, b.section, pos, b.type, b.title || '', Number(b.points ?? types[b.type].points), b.status || 'ready', JSON.stringify(data));
  res.json({ id, problems });
}));

admin.put('/puzzles/:id', wrap((req, res) => {
  const existing = db.prepare('SELECT * FROM puzzles WHERE id = ?').get(req.params.id);
  if (!existing) throw new HttpError(404, 'No such puzzle');
  // A body with only common fields (e.g. {status:'draft'}) keeps the existing puzzle data;
  // a body with type-specific fields replaces the data entirely (so switching types is clean).
  const META = ['id', 'section', 'type', 'title', 'points', 'status', 'edited', 'path', 'day', 'position', 'updated_at'];
  const hasData = Object.keys(req.body).some(k => !META.includes(k));
  const base = hasData
    ? { section: existing.section, type: existing.type, title: existing.title, points: existing.points, status: existing.status }
    : content.puzzleRowToJson(existing);
  const b = { ...base, ...req.body };
  const { data, problems } = validatePuzzleBody(b);
  const day = Number(b.day ?? existing.day);
  db.prepare(`UPDATE puzzles SET day=?, section=?, type=?, title=?, points=?, status=?, data=?, edited=1, updated_at=datetime('now') WHERE id=?`)
    .run(day, b.section, b.type, b.title || '', Number(b.points), b.status || 'ready', JSON.stringify(data), existing.id);
  res.json({ id: existing.id, problems });
}));

admin.delete('/puzzles/:id', wrap((req, res) => {
  db.prepare('DELETE FROM puzzles WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM progress WHERE puzzle_id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// Body: { ids: [...] } in the desired order (positions are per section, order is what matters)
admin.post('/puzzles/reorder', wrap((req, res) => {
  const upd = db.prepare('UPDATE puzzles SET position = ?, edited = 1 WHERE id = ?');
  db.transaction(() => (req.body.ids || []).forEach((id, i) => upd.run(i, id)))();
  res.json({ ok: true });
}));

// Try an answer against a puzzle without saving anything (admin "test" button)
admin.post('/puzzles/:id/test', wrap((req, res) => {
  const p = db.prepare('SELECT * FROM puzzles WHERE id = ?').get(req.params.id);
  if (!p) throw new HttpError(404, 'No such puzzle');
  const t = getType(p.type);
  const st = req.body.state || t.initialState();
  try {
    const result = t.submit(JSON.parse(p.data), req.body.submission || {}, st);
    res.json({ result, state: st });
  } catch (e) {
    if (e instanceof SubmissionError) throw new HttpError(400, e.message);
    throw e;
  }
}));

admin.get('/review/:slug', wrap((req, res) => {
  const rows = sortPuzzles(db.prepare('SELECT * FROM puzzles WHERE path_slug = ?').all(req.params.slug))
    .sort((a, b) => a.day - b.day);
  res.json(rows.map(r => ({ ...content.puzzleRowToJson(r), day: r.day, edited: !!r.edited, updated_at: r.updated_at })));
}));

admin.get('/progress', wrap((req, res) => {
  const paths = db.prepare('SELECT slug, name, emoji FROM paths WHERE slug != ? ORDER BY sort, name').all(content.SHARED);
  res.json(paths.map(p => {
    const s = pathSummary(p.slug, p.slug);
    const last = db.prepare('SELECT MAX(COALESCE(completed_at, started_at)) AS t FROM progress WHERE player = ?').get(p.slug).t;
    return { ...p, score: s.score, completeDays: s.completeDays, lastActivity: last, days: s.days };
  }));
}));

// Reset progress for a player (optionally one day). ?preview=1 resets the admin sandbox instead.
admin.delete('/progress/:slug', wrap((req, res) => {
  const player = req.params.slug + (req.query.preview === '1' ? '~preview' : '');
  if (req.query.day) {
    const ids = db.prepare('SELECT id FROM puzzles WHERE day = ? AND path_slug IN (?, ?)').all(Number(req.query.day), req.params.slug, content.SHARED).map(r => r.id);
    const del = db.prepare('DELETE FROM progress WHERE player = ? AND puzzle_id = ?');
    db.transaction(() => ids.forEach(id => del.run(player, id)))();
  } else {
    db.prepare('DELETE FROM progress WHERE player = ?').run(player);
  }
  res.json({ ok: true });
}));

admin.get('/settings', (req, res) => {
  res.json({
    event_year: getSetting('event_year', ''),
    date_override: getSetting('date_override', ''),
    dict_allow: getSetting('dict_allow', ''),
    dict_block: getSetting('dict_block', ''),
    calendar: calendarInfo(),
  });
});

admin.put('/settings', wrap((req, res) => {
  const { event_year, date_override, dict_allow, dict_block } = req.body;
  for (const [key, val] of [['dict_allow', dict_allow], ['dict_block', dict_block]]) {
    if (val === undefined) continue;
    if (String(val).length > 20000) throw new HttpError(400, 'That word list is too long');
    // stored as one normalized word per line; the dictionary module notices the change on its next check
    setSetting(key, [...new Set(String(val).split(/[\s,;]+/).map(dictionary.lettersOnly).filter(Boolean))].join('\n'));
  }
  if (event_year !== undefined) {
    if (event_year && !/^\d{4}$/.test(String(event_year))) throw new HttpError(400, 'Year must look like 2026');
    setSetting('event_year', event_year || '');
  }
  if (date_override !== undefined) {
    if (date_override && !/^\d{4}-\d{2}-\d{2}$/.test(date_override)) throw new HttpError(400, 'Date must be YYYY-MM-DD');
    setSetting('date_override', date_override || '');
  }
  res.json({ ok: true, calendar: calendarInfo() });
}));

// Is this word in the dictionary? (soft warning in the puzzle form; never blocks saving)
admin.get('/dictionary/check', wrap((req, res) => {
  const lang = ['en', 'es', 'any'].includes(req.query.lang) ? req.query.lang : 'en';
  const word = dictionary.lettersOnly(req.query.word);
  res.json({ word, lang, isWord: dictionary.isWord(word, lang), blocked: dictionary.isBlocked(word) });
}));

// Every common English word that fits a honeycomb, longest first (pangrams flagged)
admin.post('/dictionary/bee', wrap((req, res) => {
  const center = dictionary.lettersOnly(req.body.center).slice(0, 1);
  const outer = [...new Set(dictionary.lettersOnly(req.body.outer))].filter(ch => ch !== center).join('');
  if (!center || outer.length < 1) throw new HttpError(400, 'Enter the center letter and the outer letters first');
  const words = dictionary.beeSuggestions(center, outer, Number(req.body.minLength) || 4);
  res.json({ words, count: words.length, pangrams: words.filter(w => w.pangram).length });
}));

admin.get('/export', (req, res) => {
  res.setHeader('Content-Disposition', `attachment; filename="randall-christmas-content-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(content.exportBundle());
});

admin.post('/import', wrap((req, res) => {
  res.json(content.importBundle(req.body.bundle || {}, { force: !!req.body.force }));
}));

admin.post('/sync-content', wrap((req, res) => {
  res.json(content.importFromContentDir({ force: !!req.body.force }));
}));

admin.post('/upload', wrap((req, res) => {
  const { filename, dataBase64 } = req.body;
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) throw new HttpError(400, 'Images only (png, jpg, gif, webp)');
  const buf = Buffer.from(String(dataBase64 || '').replace(/^data:[^,]+,/, ''), 'base64');
  if (!buf.length) throw new HttpError(400, 'Empty file');
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  res.json({ url: `/uploads/${name}` });
}));

api.use('/admin', admin);
app.use('/api', api);

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.get(['/admin', '/admin/'], (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.get('/healthz', (req, res) => res.json({ ok: true }));

// errors
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad JSON' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    const c = calendarInfo();
    console.log(`🎄 Randall Christmas running on http://localhost:${PORT}`);
    console.log(`   Today: ${c.today} (${c.timeZone})${c.dateOverridden ? ' [OVERRIDDEN]' : ''} · Event year: ${c.eventYear} · Unlocked through day ${c.unlockedThrough}`);
  });
}

module.exports = app;
