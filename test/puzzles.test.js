'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-test-'));

const test = require('node:test');
const assert = require('node:assert');
const { types, normalize } = require('../server/puzzles');

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
  const d = { word: 'QUERY', maxGuesses: 2 };
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
