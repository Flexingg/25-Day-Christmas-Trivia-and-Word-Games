'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-test-'));

const test = require('node:test');
const assert = require('node:assert');
const { types, normalize } = require('../server/puzzles');
const dictionary = require('../server/dictionary');
const { setSetting } = require('../server/db');

test('normalize ignores case, accents, punctuation and leading articles', () => {
  assert.equal(normalize('  Buenos Días! '), 'buenos dias');
  assert.equal(normalize('The Beatles'), 'beatles');
  assert.equal(normalize('1,000'), '1000');
  assert.equal(normalize('To glorify God, and to enjoy him forever.'), 'to glorify god and to enjoy him forever');
});

test('wordle scores repeated letters correctly', () => {
  const st = types.wordle.initialState();
  const d = { word: 'EGRET', maxGuesses: 6 };
  types.wordle.submit(d, { guess: 'EERIE' }, st);
  assert.deepEqual(st.guesses[0].result, ['correct', 'present', 'correct', 'absent', 'absent']);
  const r = types.wordle.submit(d, { guess: 'egret' }, st);
  assert.equal(r.done, true);
  assert.equal(r.correct, true);
});

test('wordle rejects wrong length and ends after max guesses', () => {
  const st = types.wordle.initialState();
  const d = { word: 'QUERY', maxGuesses: 2, dictionary: 'off' };
  assert.throws(() => types.wordle.submit(d, { guess: 'ABC' }, st));
  assert.equal(types.wordle.submit(d, { guess: 'AAAAA' }, st).done, false);
  const r = types.wordle.submit(d, { guess: 'BBBBB' }, st);
  assert.equal(r.done, true);
  assert.equal(r.correct, false);
});

test('connections finds groups, detects one-away, counts mistakes', () => {
  const d = {
    groups: [
      { name: 'A', words: ['a1', 'a2', 'a3', 'a4'] },
      { name: 'B', words: ['b1', 'b2', 'b3', 'b4'] },
    ],
    maxMistakes: 2,
  };
  assert.deepEqual(types.connections.validate(d), []);
  const st = types.connections.initialState();
  let r = types.connections.submit(d, { words: ['A1', 'A2', 'A3', 'B1'] }, st);
  assert.equal(r.feedback, 'One away…');
  assert.equal(st.mistakes, 1);
  r = types.connections.submit(d, { words: ['A1', 'A2', 'A3', 'A4'] }, st);
  assert.equal(r.done, false);
  r = types.connections.submit(d, { words: ['B1', 'B2', 'B3', 'B4'] }, st);
  assert.equal(r.done, true);
  assert.equal(r.correct, true);
  const pub = types.connections.publicData(d, 'x');
  assert.equal(pub.words.length, 8);
  assert.ok(!JSON.stringify(pub).includes('"A"'), 'group names must not leak');
});

test('public data never contains answers', () => {
  const mc = types.multiple_choice.publicData({ prompt: 'q', choices: ['x', 'y'], answer: 1, explanation: 'secret' });
  assert.equal(mc.answer, undefined);
  assert.ok(!JSON.stringify(mc).includes('secret'));
  const w = types.wordle.publicData({ word: 'EGRET' });
  assert.ok(!JSON.stringify(w).includes('EGRET'));
  const t = types.text_answer.publicData({ prompt: 'q', answers: ['Tux'] });
  assert.ok(!JSON.stringify(t).includes('Tux'));
  const s = types.scramble.publicData({ answer: 'HOME RUN' }, 'id1');
  assert.notEqual(s.scrambled, 'HOME RUN');
  assert.equal(s.scrambled.replace(/ /g, '').split('').sort().join(''), 'HOMERUN'.split('').sort().join(''));
});

test('text answer allows limited attempts', () => {
  const d = { prompt: 'q', answers: ['Buenos días'], attempts: 2 };
  const st = types.text_answer.initialState();
  assert.equal(types.text_answer.submit(d, { answer: 'hola' }, st).done, false);
  assert.throws(() => types.text_answer.submit(d, { answer: 'HOLA' }, st), /already/);
  const r = types.text_answer.submit(d, { answer: 'buenos dias' }, st);
  assert.equal(r.correct, true);
});

test('all content/ files are valid', () => {
  const { readContentDir } = require('../server/content');
  const bundle = readContentDir();
  const ids = new Set();
  for (const d of bundle.days) {
    for (const p of d.puzzles) {
      assert.ok(types[p.type], `${p.id}: unknown type`);
      assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
      ids.add(p.id);
      if (p.status !== 'draft') {
        const { id, section, type, title, points, status, ...data } = p; // eslint-disable-line no-unused-vars
        assert.deepEqual(types[p.type].validate(data), [], `${p.id} is invalid`);
      }
    }
  }
});

// ---------- newer puzzle types ----------

test('rebus accepts listed answers and never leaks them', () => {
  const d = { prompt: 'q', rebus: '🐴 + 👞', answers: ['horseshoe', 'horse shoe'], attempts: 2 };
  assert.deepEqual(types.rebus.validate(d), []);
  assert.ok(types.rebus.validate({ ...d, rebus: '' }).length);
  assert.ok(!JSON.stringify(types.rebus.publicData(d, 'r1')).includes('horseshoe'));
  const st = types.rebus.initialState();
  assert.equal(types.rebus.submit(d, { answer: 'cow' }, st).done, false);
  const r = types.rebus.submit(d, { answer: 'Horse Shoe!' }, st);
  assert.equal(r.correct, true);
});

test('verse: blanks, alternates, locking, word bank and partial credit', () => {
  const d = { prompt: 'q', reference: 'Isaiah 9:6', translation: 'ESV', text: 'For to us a [child|baby] is born, to us a [son] is given', attempts: 2, explanation: 'e' };
  assert.deepEqual(types.verse.validate(d), []);
  assert.ok(types.verse.validate({ ...d, text: 'no blanks here' }).length);
  assert.ok(types.verse.validate({ ...d, text: 'oops [open' }).length);
  const pub = types.verse.publicData(d, 'v1');
  assert.equal(pub.blanks, 2);
  assert.ok(!JSON.stringify(pub).match(/child|baby|"son"/), 'blank answers must not leak');
  assert.equal(pub.bank, undefined);
  const bank = types.verse.publicData({ ...d, wordBank: true, decoys: ['daughter'] }, 'v1').bank;
  assert.deepEqual([...bank].sort(), ['child', 'daughter', 'son']);

  // first try: one right, one wrong -> right one locks
  let st = types.verse.initialState();
  assert.throws(() => types.verse.submit(d, { answers: ['', ''] }, st), /at least one/);
  let r = types.verse.submit(d, { answers: ['Baby', 'daughter'] }, st);
  assert.equal(r.done, false);
  assert.deepEqual(types.verse.clientState(d, st).solved, { 0: 'child' });
  assert.deepEqual(st.lastWrong, [1]);
  // solved blanks are ignored on later submissions; finishing the rest wins
  r = types.verse.submit(d, { answers: ['junk', 'SON'] }, st);
  assert.equal(r.correct, true);
  assert.equal(r.done, true);

  // running out of tries gives partial credit
  st = types.verse.initialState();
  types.verse.submit(d, { answers: ['child', 'x'] }, st);
  r = types.verse.submit(d, { answers: ['', 'y'] }, st);
  assert.equal(r.done, true);
  assert.equal(r.correct, false);
  assert.equal(r.fraction, 0.5);
  assert.deepEqual(types.verse.reveal(d, st).blanks, ['child', 'son']);
});

test('timeline: shuffled start, per-position feedback, partial credit', () => {
  const d = { prompt: 'q', items: [{ label: 'A', detail: '1990' }, { label: 'B', detail: '1991' }, { label: 'C' }, { label: 'D' }], attempts: 2 };
  assert.deepEqual(types.timeline.validate(d), []);
  assert.ok(types.timeline.validate({ ...d, items: [{ label: 'A' }, { label: 'a' }] }).length);
  for (const id of ['t1', 't2', 't3', 't4', 't5']) {
    const pub = types.timeline.publicData(d, id);
    assert.notDeepEqual(pub.order, ['A', 'B', 'C', 'D'], 'must not start solved');
    assert.deepEqual([...pub.order].sort(), ['A', 'B', 'C', 'D']);
    assert.ok(!JSON.stringify(pub).includes('1990'), 'details must not leak');
  }
  const st = types.timeline.initialState();
  assert.throws(() => types.timeline.submit(d, { order: ['A', 'B', 'C'] }, st));
  let r = types.timeline.submit(d, { order: ['A', 'B', 'D', 'C'] }, st);
  assert.equal(r.done, false);
  assert.deepEqual(st.attempts[0].result, [true, true, false, false]);
  assert.throws(() => types.timeline.submit(d, { order: ['A', 'B', 'D', 'C'] }, st), /already/);
  r = types.timeline.submit(d, { order: ['B', 'A', 'C', 'D'] }, st);
  assert.equal(r.done, true);
  assert.equal(r.correct, false);
  assert.equal(r.fraction, 0.5); // best attempt had 2 of 4 in place
  const win = types.timeline.initialState();
  assert.equal(types.timeline.submit(d, { order: ['A', 'B', 'C', 'D'] }, win).correct, true);
  assert.equal(types.timeline.reveal(d, win).items[0].detail, '1990');
});

test('who_said_it: one shot, partial credit, derives people', () => {
  const d = { prompt: 'q', quotes: [{ quote: 'one', who: 'Meg' }, { quote: 'two', who: 'Rafa' }, { quote: 'three', who: 'Meg' }] };
  assert.deepEqual(types.who_said_it.validate(d), []);
  assert.ok(types.who_said_it.validate({ ...d, people: ['Meg'] }).length, 'Rafa missing from people');
  const pub = types.who_said_it.publicData(d);
  assert.deepEqual(pub.people, ['Meg', 'Rafa']);
  assert.ok(!JSON.stringify(pub.quotes).includes('Meg'));
  let st = types.who_said_it.initialState();
  assert.throws(() => types.who_said_it.submit(d, { picks: ['Meg', 'Rafa'] }, st));
  assert.throws(() => types.who_said_it.submit(d, { picks: ['Meg', 'Rafa', 'Bob'] }, st));
  let r = types.who_said_it.submit(d, { picks: ['Meg', 'Meg', 'Meg'] }, st);
  assert.equal(r.done, true);
  assert.equal(r.correct, false);
  assert.ok(Math.abs(r.fraction - 2 / 3) < 1e-9);
  assert.deepEqual(types.who_said_it.reveal(d, st).results.map(x => x.right), [true, false, true]);
  st = types.who_said_it.initialState();
  r = types.who_said_it.submit(d, { picks: ['meg', 'rafa', 'MEG'] }, st);
  assert.equal(r.correct, true);
  assert.equal(r.fraction, 1);
});

test('spelling bee: validation rules, feedback, finishing', () => {
  const d = { prompt: 'q', center: 'T', outer: 'MISLEO', minLength: 4, words: ['MISTLETOE', 'STOLE', 'MOIST', 'LOST', 'TILE'], target: 3 };
  assert.deepEqual(types.spelling_bee.validate(d), []);
  assert.ok(types.spelling_bee.validate({ ...d, outer: 'MISLE' }).length, 'needs 6 outer letters');
  assert.ok(types.spelling_bee.validate({ ...d, outer: 'MISLET' }).length, 'letters must be distinct');
  assert.ok(types.spelling_bee.validate({ ...d, words: ['STOLE', 'SOLE'] }).length, 'SOLE has no center letter and is too short');
  assert.ok(types.spelling_bee.validate({ ...d, words: ['STOLE', 'STONE'] }).length, 'N is not in the hive');
  assert.ok(types.spelling_bee.validate({ ...d, target: 9 }).length);
  const pub = types.spelling_bee.publicData(d, 'b1');
  assert.equal(pub.center, 'T');
  assert.deepEqual([...pub.outer].sort(), 'EILMOS'.split(''));
  assert.ok(!JSON.stringify(pub).includes('STOLE'));

  const st = types.spelling_bee.initialState();
  const msg = (sub) => { try { types.spelling_bee.submit(d, sub, st); } catch (e) { return e.message; } return null; };
  assert.match(msg({ word: 'tis' }), /Too short/);
  assert.match(msg({ word: 'solo' }), /Missing center/);
  assert.match(msg({ word: 'stone' }), /Bad letters/);
  assert.match(msg({ word: 'ttlt' }), /^Not in word list/);
  assert.match(msg({ word: 'tote' }), /Real word, but not on today’s list/);
  assert.match(msg({ word: 'molest' }), /Missing center|Bad letters|Not in word list/);
  assert.equal(st.found.length, 0, 'neither rejection counts as found');
  let r = types.spelling_bee.submit(d, { word: 'mistletoe' }, st);
  assert.equal(r.feedback, 'Pangram! 🐝');
  assert.equal(r.done, false);
  assert.match(msg({ word: 'MISTLETOE' }), /Already found/);
  types.spelling_bee.submit(d, { word: 'stole' }, st);
  assert.equal(types.spelling_bee.clientState(d, st).found.length, 2);
  r = types.spelling_bee.submit(d, { finish: true }, st);
  assert.equal(r.done, true);
  assert.equal(r.correct, false);
  assert.ok(Math.abs(r.fraction - 2 / 3) < 1e-9);
  assert.deepEqual(types.spelling_bee.reveal(d, st).pangrams, ['MISTLETOE']);

  // finding every word ends it; default target is half the list (rounded up)
  const all = { ...d, target: undefined };
  const st2 = types.spelling_bee.initialState();
  for (const w of d.words.slice(0, 4)) types.spelling_bee.submit(all, { word: w }, st2);
  r = types.spelling_bee.submit(all, { word: 'tile' }, st2);
  assert.equal(r.done, true);
  assert.equal(r.correct, true);
  assert.equal(types.spelling_bee.publicData(all, 'b1').target, 3);
});

const XW = ['EGRET', 'A#A#E', 'RIDER', 'T#I#N', 'HOOFS'];

test('crossword: numbering, validation and public data without letters', () => {
  const d = { prompt: 'q', grid: XW, across: ['a1', 'a4', 'a5'], down: ['d1', 'd2', 'd3'], maxChecks: 2 };
  assert.deepEqual(types.crossword.validate(d), []);
  const pub = types.crossword.publicData(d, 'x1');
  assert.deepEqual(pub.across.map(e => [e.n, e.clue]), [[1, 'a1'], [4, 'a4'], [5, 'a5']]);
  assert.deepEqual(pub.down.map(e => [e.n, e.clue]), [[1, 'd1'], [2, 'd2'], [3, 'd3']]);
  assert.deepEqual(pub.layout, ['.....', '.#.#.', '.....', '.#.#.', '.....']);
  assert.ok(!JSON.stringify(pub).match(/EGRET|RIDER|HOOFS/));
  assert.ok(!/[A-Z]{2}/.test(JSON.stringify(pub.layout)));

  // black squares in the middle of a row split entries, 1-letter runs aren't entries
  const lay = types.crossword.publicData({ grid: ['CAT#', 'A#OX', 'RATE', '#OWL'], across: [], down: [] }, 'x');
  assert.deepEqual(lay.across.map(e => [e.n, e.len]), [[1, 3], [3, 2], [5, 4], [7, 3]]);
  assert.deepEqual(lay.down.map(e => [e.n, e.len]), [[1, 3], [2, 4], [4, 3], [6, 2]]);

  assert.match(types.crossword.validate({ ...d, across: ['a1'] }).join(' '), /3 across entries/);
  assert.match(types.crossword.validate({ ...d, down: [] }).join(' '), /3 down entries/);
  assert.ok(types.crossword.validate({ ...d, grid: ['ABC', 'DE'] }).length, 'ragged rows');
  assert.ok(types.crossword.validate({ ...d, grid: ['AB#', '#1C'] }).length, 'bad characters');
});

test('crossword: checks, wrong-cell positions, give up and partial credit', () => {
  const d = { prompt: 'q', grid: XW, across: ['a', 'b', 'c'], down: ['d', 'e', 'f'], maxChecks: 2 };
  const st = types.crossword.initialState();
  assert.throws(() => types.crossword.submit(d, { cells: ['     ', '     ', '     ', '     ', '     '] }, st), /Fill in some/);
  // wrong letter at (0,0), blank at (4,4); 21 white cells in the grid
  const cells = ['XGRET', 'A A E', 'RIDER', 'T I N', 'HOOF '];
  let r = types.crossword.submit(d, { cells }, st);
  assert.equal(r.done, false);
  assert.deepEqual(types.crossword.clientState(d, st).wrong, [[0, 0]]);
  assert.equal(types.crossword.clientState(d, st).empty, 1);
  assert.equal(st.checks, 1);
  // second unsuccessful check ends it with fraction = correct whites / all whites
  r = types.crossword.submit(d, { cells }, st);
  assert.equal(r.done, true);
  assert.equal(r.correct, false);
  assert.ok(Math.abs(r.fraction - 19 / 21) < 1e-9);
  assert.deepEqual(types.crossword.reveal(d, st).grid, XW);

  // lowercase works; a fully right grid wins
  const win = types.crossword.initialState();
  r = types.crossword.submit(d, { cells: XW.map(row => row.toLowerCase().replace('#', ' ')) }, win);
  assert.equal(r.correct, true);

  // giving up uses the last check (or 0)
  assert.equal(types.crossword.submit(d, { giveUp: true }, types.crossword.initialState()).fraction, 0);
  const st3 = types.crossword.initialState();
  types.crossword.submit(d, { cells }, st3);
  assert.ok(types.crossword.submit(d, { giveUp: true }, st3).fraction > 0.9);
});

test('dictionary: English and Spanish word checks', () => {
  assert.equal(dictionary.isWord('egret', 'en'), true);
  assert.equal(dictionary.isWord('QUERY'), true);
  assert.equal(dictionary.isWord('XYZZQ', 'en'), false);
  assert.equal(dictionary.isWord('LECHE', 'es'), true);
  assert.equal(dictionary.isWord('nieve', 'es'), true);
  assert.equal(dictionary.isWord('NINOS', 'es'), true, 'matches niños without the tilde');
  assert.equal(dictionary.isWord('LECHE', 'en'), false);
  assert.equal(dictionary.isWord('LECHE', 'any'), true);
  assert.equal(dictionary.isWord('EGRET', 'any'), true);
  assert.equal(dictionary.isWord('AB', 'en'), false);
  assert.ok(dictionary.commonWords('en').has('MISTLETOE'));
  assert.equal(dictionary.commonWords('es'), null);
});

test('dictionary: blocked words and custom allow/block lists', () => {
  assert.equal(dictionary.isBlocked('molest'), true);
  assert.equal(dictionary.isWord('MOLEST', 'en'), false);
  assert.equal(dictionary.isBlocked('SLUT'), true);
  assert.equal(dictionary.isBlocked('DEAD'), false);
  assert.equal(dictionary.isBlocked('KILL'), false);
  assert.equal(dictionary.isBlocked('TRIO'), false);

  assert.equal(dictionary.isWord('RIZZ', 'en'), false);
  setSetting('dict_allow', 'rizz\nDistro, clemson');
  assert.equal(dictionary.isWord('RIZZ', 'en'), true, 'allow list takes effect without a restart');
  assert.equal(dictionary.isWord('distro', 'es'), true);
  setSetting('dict_block', 'egret');
  assert.equal(dictionary.isWord('EGRET', 'en'), false);
  assert.equal(dictionary.isBlocked('EGRET'), true);
  setSetting('dict_allow', 'molest');
  assert.equal(dictionary.isWord('MOLEST', 'en'), true, 'an explicit allow beats the built-in blocklist');
  setSetting('dict_allow', ''); setSetting('dict_block', '');
  assert.equal(dictionary.isWord('RIZZ', 'en'), false);
  assert.equal(dictionary.isWord('EGRET', 'en'), true);
});

test('wordle only accepts real words, and a rejected guess costs nothing', () => {
  const d = { word: 'QUERY', maxGuesses: 2 }; // dictionary defaults to English
  const st = types.wordle.initialState();
  assert.throws(() => types.wordle.submit(d, { guess: 'XYZZQ' }, st), /Not in word list/);
  assert.equal(st.guesses.length, 0);
  assert.throws(() => types.wordle.submit(d, { guess: 'XYZZQ' }, st), /Not in word list/);
  assert.equal(types.wordle.submit(d, { guess: 'EGRET' }, st).done, false);
  assert.equal(st.guesses.length, 1);
});

test('wordle always accepts the secret word, even if it is not in the dictionary', () => {
  const d = { word: 'ZZYZX', maxGuesses: 3 };
  const st = types.wordle.initialState();
  assert.throws(() => types.wordle.submit(d, { guess: 'ZZYZY' }, st), /Not in word list/);
  const r = types.wordle.submit(d, { guess: 'zzyzx' }, st);
  assert.equal(r.correct, true);
});

test('wordle dictionary modes: es, any, off, allowWords', () => {
  const guess = (d, g) => { try { types.wordle.submit(d, { guess: g }, types.wordle.initialState()); return true; } catch (e) { return e.message; } };
  assert.equal(guess({ word: 'LECHE', dictionary: 'es' }, 'NIEVE'), true);
  assert.equal(guess({ word: 'LECHE', dictionary: 'es' }, 'EGRET'), 'Not in word list');
  assert.equal(guess({ word: 'LECHE', dictionary: 'any' }, 'EGRET'), true);
  assert.equal(guess({ word: 'LECHE', dictionary: 'off' }, 'XYZZQ'), true);
  assert.equal(guess({ word: 'QUERY' }, 'RIZZY'), 'Not in word list');
  assert.equal(guess({ word: 'QUERY', allowWords: ['rizzy'] }, 'RIZZY'), true);
  assert.ok(types.wordle.validate({ word: 'QUERY', dictionary: 'klingon' }).length);
  assert.deepEqual(types.wordle.validate({ word: 'QUERY', dictionary: 'any' }), []);
});
