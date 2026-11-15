'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-api-'));
process.env.ADMIN_PASSWORD = 'secret';

const test = require('node:test');
const assert = require('node:assert');
const app = require('../server/index');

let base, server, adminCookie = '';
test.before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function call(method, url, body, cookie = '') {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null), cookie: res.headers.get('set-cookie') };
}

test('admin login', async () => {
  assert.equal((await call('POST', '/api/admin/login', { password: 'nope' })).status, 401);
  const r = await call('POST', '/api/admin/login', { password: 'secret' });
  assert.equal(r.status, 200);
  adminCookie = r.cookie.split(';')[0];
  assert.equal((await call('GET', '/api/admin/overview')).status, 401);
  assert.equal((await call('GET', '/api/admin/overview', null, adminCookie)).status, 200);
});

test('days are locked before December', async () => {
  await call('PUT', '/api/admin/settings', { event_year: '2026', date_override: '2026-11-20' }, adminCookie);
  const r = await call('GET', '/api/paths/meg/days/1');
  assert.equal(r.status, 403);
  assert.equal(r.body.locked, true);
});

test('gating: on Dec 3 days 1-3 open, day 4 locked', async () => {
  await call('PUT', '/api/admin/settings', { date_override: '2026-12-03' }, adminCookie);
  const p = await call('GET', '/api/paths/meg');
  assert.equal(p.body.unlockedThrough, 3);
  assert.equal((await call('GET', '/api/paths/meg/days/3')).status, 200);
  assert.equal((await call('GET', '/api/paths/meg/days/4')).status, 403);
  // admin preview bypasses the lock
  assert.equal((await call('GET', '/api/paths/meg/days/4?preview=1', null, adminCookie)).status, 200);
  assert.equal((await call('GET', '/api/paths/meg/days/4?preview=1')).status, 401);
});

test('answering saves progress and includes shared bonus puzzles', async () => {
  const day = await call('GET', '/api/paths/meg/days/1');
  const ids = day.body.puzzles.map(p => p.id);
  assert.ok(ids.includes('meg-d01-01'));
  assert.ok(ids.includes('shared-d01-01'), 'shared puzzles appear on every path');
  assert.ok(!JSON.stringify(day.body).includes('Hummingbirds can hover'), 'explanations hidden before answering');

  const r = await call('POST', '/api/paths/meg/puzzles/meg-d01-01/answer', { submission: { choice: 1 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.correct, true);
  assert.equal(r.body.puzzle.status, 'done');
  assert.equal(r.body.puzzle.reveal.answerIndex, 1);
  assert.equal((await call('POST', '/api/paths/meg/puzzles/meg-d01-01/answer', { submission: { choice: 1 } })).status, 409);

  // progress is per path: Rafa's shared puzzle is untouched by Meg answering hers
  await call('POST', '/api/paths/meg/puzzles/shared-d01-01/answer', { submission: { choice: 0 } });
  const rafa = await call('GET', '/api/paths/rafa/days/1');
  assert.equal(rafa.body.puzzles.find(p => p.id === 'shared-d01-01').status, 'new');

  const meta = await call('GET', '/api/meta');
  assert.equal(meta.body.paths.find(p => p.slug === 'meg').score, 2);
});

test('cannot answer another path\'s puzzle', async () => {
  const r = await call('POST', '/api/paths/rafa/puzzles/meg-d01-02/answer', { submission: { choice: 2 } });
  assert.equal(r.status, 404);
});

test('drafts are hidden from players', async () => {
  const mom = await call('GET', '/api/paths/mom/days/1');
  assert.ok(!mom.body.puzzles.some(p => p.id === 'mom-d01-02'));
  const prev = await call('GET', '/api/paths/mom/days/1?preview=1', null, adminCookie);
  assert.ok(prev.body.puzzles.some(p => p.id === 'mom-d01-02'));
});

test('PIN protects a path', async () => {
  await call('PUT', '/api/admin/paths/thomas', { pin: '1234' }, adminCookie);
  const r = await call('GET', '/api/paths/thomas');
  assert.equal(r.status, 403);
  assert.equal(r.body.needPin, true);
  assert.equal((await call('POST', '/api/paths/thomas/unlock', { pin: '0000' })).status, 403);
  const ok = await call('POST', '/api/paths/thomas/unlock', { pin: '1234' });
  const cookie = ok.cookie.split(';')[0];
  assert.equal((await call('GET', '/api/paths/thomas', null, cookie)).status, 200);
  await call('PUT', '/api/admin/paths/thomas', { pin: '' }, adminCookie);
});

test('admin CRUD + validation', async () => {
  const bad = await call('POST', '/api/admin/puzzles', { path: 'rafa', day: 5, section: 'main', type: 'wordle', word: 'NO' }, adminCookie);
  assert.equal(bad.status, 400);
  const draft = await call('POST', '/api/admin/puzzles', { path: 'rafa', day: 5, section: 'main', type: 'wordle', word: 'NO', status: 'draft' }, adminCookie);
  assert.equal(draft.status, 200);
  assert.ok(draft.body.problems.length > 0);
  const id = draft.body.id;
  assert.equal(id, 'rafa-d05-01');
  const upd = await call('PUT', `/api/admin/puzzles/${id}`, { type: 'wordle', section: 'main', word: 'BASES', status: 'ready', points: 3 }, adminCookie);
  assert.equal(upd.status, 200);
  // status-only update keeps data
  await call('PUT', `/api/admin/puzzles/${id}`, { status: 'draft' }, adminCookie);
  const review = await call('GET', '/api/admin/review/rafa', null, adminCookie);
  const row = review.body.find(r => r.id === id);
  assert.equal(row.word, 'BASES');
  assert.equal(row.status, 'draft');
  assert.equal((await call('DELETE', `/api/admin/puzzles/${id}`, null, adminCookie)).status, 200);
});

test('export round-trips and sync skips admin edits', async () => {
  const exp = await call('GET', '/api/admin/export', null, adminCookie);
  assert.ok(exp.body.days.length >= 7);
  await call('PUT', '/api/admin/puzzles/dad-d01-06', { type: 'wordle', section: 'main', word: 'TABLE', status: 'ready', points: 3 }, adminCookie);
  const sync = await call('POST', '/api/admin/sync-content', {}, adminCookie);
  assert.ok(sync.body.skippedEdited >= 1);
  const review = await call('GET', '/api/admin/review/dad', null, adminCookie);
  assert.equal(review.body.find(r => r.id === 'dad-d01-06').word, 'TABLE');
});
