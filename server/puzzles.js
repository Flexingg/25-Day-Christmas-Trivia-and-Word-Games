'use strict';
/*
 * Puzzle type registry. Answer checking happens on the server so nobody
 * (looking at you, Thomas) can peek at answers in the browser dev tools.
 *
 * Every type implements:
 *   defaults        - default `data` for a new puzzle of this type (used by admin)
 *   points          - default point value
 *   validate(d)     - returns an array of human-readable problems (empty = OK)
 *   publicData(d,id)- what the player sees before solving (NO answers!)
 *   initialState()  - starting progress state
 *   clientState(d,st) - what of the progress state the player can see
 *   submit(d,sub,st)  - mutates st, returns { done, correct, feedback, ... }
 *   reveal(d,st)    - answer + explanation, sent once the puzzle is done
 *
 * To add a new puzzle type: add it here, add a renderer in
 * public/js/puzzles/<type>.js and a field definition in public/js/puzzle-types.js.
 */
const crypto = require('crypto');

class SubmissionError extends Error {}

// ---------- helpers ----------

function normalize(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/(\d),(\d)/g, '$1$2') // 1,000 -> 1000
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '');
}

function lettersOnly(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
}

function seededRandom(seed) {
  let h = crypto.createHash('sha256').update(String(seed)).digest().readUInt32LE(0);
  return () => { // mulberry32
    h |= 0; h = (h + 0x6D2B79F5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, seed) {
  const rand = seededRandom(seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function scrambleWord(word, seed) {
  if (word.length < 2) return word;
  for (let i = 0; i < 10; i++) {
    const s = seededShuffle(word.split(''), seed + ':' + i).join('');
    if (s !== word) return s;
  }
  return word.split('').reverse().join('');
}

function asList(v) {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split('\n').map(x => x.trim()).filter(Boolean);
  return [];
}

function common(d) {
  return { prompt: d.prompt || '', image: d.image || '', hint: d.hint || '' };
}

// Free-text answers used by text_answer and scramble
function freeTextSubmit(accepted, maxAttempts, sub, st) {
  const guess = String(sub.answer ?? '').trim();
  if (!guess) throw new SubmissionError('Type an answer first!');
  st.tries = st.tries || [];
  const n = normalize(guess);
  if (st.tries.some(t => normalize(t) === n)) throw new SubmissionError('You already tried that one.');
  st.tries.push(guess);
  const correct = accepted.some(a => normalize(a) === n);
  const left = maxAttempts - st.tries.length;
  if (correct) return { done: true, correct: true, feedback: 'Correct! 🎉' };
  if (left <= 0) return { done: true, correct: false, feedback: 'Out of guesses.' };
  return { done: false, correct: false, feedback: `Not quite — ${left} ${left === 1 ? 'try' : 'tries'} left.` };
}

// ---------- types ----------

const types = {
  multiple_choice: {
    label: 'Multiple choice',
    points: 1,
    defaults: { prompt: '', image: '', choices: ['', '', '', ''], answer: 0, explanation: '' },
    validate(d) {
      const errs = [];
      const choices = asList(d.choices);
      if (!d.prompt) errs.push('Prompt is required.');
      if (choices.length < 2) errs.push('Needs at least 2 choices.');
      const a = Number(d.answer);
      if (!Number.isInteger(a) || a < 0 || a >= choices.length) errs.push('Pick which choice is correct.');
      return errs;
    },
    publicData: (d) => ({ ...common(d), choices: asList(d.choices) }),
    initialState: () => ({}),
    clientState: (d, st) => ({ picked: st.picked ?? null }),
    submit(d, sub, st) {
      const choice = Number(sub.choice);
      if (!Number.isInteger(choice) || choice < 0 || choice >= asList(d.choices).length) throw new SubmissionError('Pick an answer.');
      st.picked = choice;
      const correct = choice === Number(d.answer);
      return { done: true, correct, feedback: correct ? 'Correct! 🎉' : 'Not quite!' };
    },
    reveal: (d) => ({ answerIndex: Number(d.answer), answer: asList(d.choices)[Number(d.answer)], explanation: d.explanation || '' }),
  },

  text_answer: {
    label: 'Type the answer',
    points: 1,
    defaults: { prompt: '', image: '', answers: [''], hint: '', explanation: '', attempts: 3 },
    validate(d) {
      const errs = [];
      if (!d.prompt) errs.push('Prompt is required.');
      if (!asList(d.answers).length) errs.push('Add at least one accepted answer.');
      return errs;
    },
    publicData: (d) => ({ ...common(d), attempts: Number(d.attempts) || 3 }),
    initialState: () => ({ tries: [] }),
    clientState: (d, st) => ({ tries: st.tries || [] }),
    submit: (d, sub, st) => freeTextSubmit(asList(d.answers), Number(d.attempts) || 3, sub, st),
    reveal: (d) => ({ answer: asList(d.answers)[0], alsoAccepted: asList(d.answers).slice(1), explanation: d.explanation || '' }),
  },

  scramble: {
    label: 'Word scramble',
    points: 1,
    defaults: { prompt: 'Unscramble the letters:', answer: '', alsoAccept: [], hint: '', explanation: '', attempts: 3 },
    validate(d) {
      const errs = [];
      if (!lettersOnly(d.answer)) errs.push('Answer is required.');
      return errs;
    },
    publicData(d, id) {
      const words = String(d.answer || '').toUpperCase().split(/\s+/).filter(Boolean);
      return {
        ...common(d),
        scrambled: words.map((w, i) => scrambleWord(lettersOnly(w), `${id}:${i}`)).join(' '),
        attempts: Number(d.attempts) || 3,
      };
    },
    initialState: () => ({ tries: [] }),
    clientState: (d, st) => ({ tries: st.tries || [] }),
    submit: (d, sub, st) => freeTextSubmit([d.answer, ...asList(d.alsoAccept)], Number(d.attempts) || 3, sub, st),
    reveal: (d) => ({ answer: String(d.answer).toUpperCase(), explanation: d.explanation || '' }),
  },

  wordle: {
    label: 'Wordle (guess the word)',
    points: 3,
    defaults: { prompt: 'Guess the hidden word.', word: '', hint: '', explanation: '', maxGuesses: 6 },
    validate(d) {
      const errs = [];
      const w = lettersOnly(d.word);
      if (w.length < 3 || w.length > 10) errs.push('Word must be 3–10 letters (A–Z only).');
      if (w !== String(d.word || '').toUpperCase()) errs.push('Word should be letters only (no spaces/accents).');
      return errs;
    },
    publicData: (d) => ({ ...common(d), length: lettersOnly(d.word).length, maxGuesses: Number(d.maxGuesses) || 6 }),
    initialState: () => ({ guesses: [] }),
    clientState: (d, st) => ({ guesses: st.guesses || [] }),
    submit(d, sub, st) {
      const word = lettersOnly(d.word);
      const guess = lettersOnly(sub.guess);
      if (guess.length !== word.length) throw new SubmissionError(`Guess must be ${word.length} letters.`);
      st.guesses = st.guesses || [];
      if (st.guesses.some(g => g.guess === guess)) throw new SubmissionError('Already guessed that.');
      // Standard Wordle scoring, handling repeated letters correctly
      const result = Array(word.length).fill('absent');
      const remaining = {};
      for (let i = 0; i < word.length; i++) {
        if (guess[i] === word[i]) result[i] = 'correct';
        else remaining[word[i]] = (remaining[word[i]] || 0) + 1;
      }
      for (let i = 0; i < word.length; i++) {
        if (result[i] !== 'correct' && remaining[guess[i]] > 0) {
          result[i] = 'present';
          remaining[guess[i]]--;
        }
      }
      st.guesses.push({ guess, result });
      const max = Number(d.maxGuesses) || 6;
      if (guess === word) return { done: true, correct: true, feedback: ['Genius!', 'Magnificent!', 'Impressive!', 'Splendid!', 'Great!', 'Phew!'][Math.min(st.guesses.length - 1, 5)] };
      if (st.guesses.length >= max) return { done: true, correct: false, feedback: 'Out of guesses!' };
      return { done: false, correct: false, feedback: '' };
    },
    reveal: (d) => ({ answer: lettersOnly(d.word), explanation: d.explanation || '' }),
  },

  connections: {
    label: 'Connections (find the groups)',
    points: 3,
    defaults: {
      prompt: 'Find groups of four that share something in common.',
      groups: [
        { name: '', words: ['', '', '', ''] },
        { name: '', words: ['', '', '', ''] },
        { name: '', words: ['', '', '', ''] },
        { name: '', words: ['', '', '', ''] },
      ],
      maxMistakes: 4,
      explanation: '',
    },
    validate(d) {
      const errs = [];
      const groups = Array.isArray(d.groups) ? d.groups : [];
      if (groups.length < 2) errs.push('Needs at least 2 groups.');
      const size = asList(groups[0]?.words).length;
      const all = [];
      groups.forEach((g, i) => {
        const words = asList(g.words);
        if (!g.name) errs.push(`Group ${i + 1} needs a name.`);
        if (words.length !== size || size < 2) errs.push(`Every group needs the same number of words (group ${i + 1} has ${words.length}).`);
        all.push(...words.map(w => w.toUpperCase()));
      });
      if (new Set(all).size !== all.length) errs.push('Every word must be unique across groups.');
      return errs;
    },
    publicData(d, id) {
      const words = d.groups.flatMap(g => asList(g.words).map(w => w.toUpperCase()));
      return {
        prompt: d.prompt || '',
        words: seededShuffle(words, id),
        groupSize: asList(d.groups[0].words).length,
        maxMistakes: Number(d.maxMistakes) || 4,
      };
    },
    initialState: () => ({ found: [], mistakes: 0, guesses: [] }),
    clientState: (d, st) => ({
      found: (st.found || []).map(i => ({ level: i, name: d.groups[i].name, words: asList(d.groups[i].words).map(w => w.toUpperCase()) })),
      mistakes: st.mistakes || 0,
    }),
    submit(d, sub, st) {
      const size = asList(d.groups[0].words).length;
      const pick = (Array.isArray(sub.words) ? sub.words : []).map(w => String(w).toUpperCase());
      if (pick.length !== size || new Set(pick).size !== size) throw new SubmissionError(`Select exactly ${size} words.`);
      st.found = st.found || []; st.guesses = st.guesses || []; st.mistakes = st.mistakes || 0;
      const key = pick.slice().sort().join('|');
      if (st.guesses.includes(key)) throw new SubmissionError('You already tried that combination.');
      st.guesses.push(key);
      const groupWords = d.groups.map(g => asList(g.words).map(w => w.toUpperCase()));
      const hit = groupWords.findIndex((ws, i) => !st.found.includes(i) && pick.every(w => ws.includes(w)));
      if (hit >= 0) {
        st.found.push(hit);
        const done = st.found.length === d.groups.length;
        return { done, correct: done, feedback: done ? 'All groups found! 🎉' : `Yes! ${d.groups[hit].name}` };
      }
      st.mistakes++;
      const oneAway = groupWords.some((ws, i) => !st.found.includes(i) && pick.filter(w => ws.includes(w)).length === size - 1);
      const max = Number(d.maxMistakes) || 4;
      if (st.mistakes >= max) return { done: true, correct: false, feedback: 'Out of mistakes!' };
      return { done: false, correct: false, feedback: oneAway ? 'One away…' : 'Nope!' };
    },
    reveal: (d) => ({
      groups: d.groups.map((g, i) => ({ level: i, name: g.name, words: asList(g.words).map(w => w.toUpperCase()) })),
      explanation: d.explanation || '',
    }),
  },
};

const SECTIONS = {
  main: 'Your Puzzles',
  christmas: 'Christmas Bonus',
  faith: 'Faith & Scripture',
};

function getType(name) {
  const t = types[name];
  if (!t) throw new Error(`Unknown puzzle type "${name}"`);
  return t;
}

// Build the player-facing view of a puzzle + their progress row
function clientPuzzle(p, row) {
  const t = getType(p.type);
  const data = JSON.parse(p.data);
  const st = row ? JSON.parse(row.state) : t.initialState();
  const done = row?.status === 'done';
  return {
    id: p.id,
    type: p.type,
    section: p.section,
    title: p.title,
    points: p.points,
    shared: p.path_slug === '_shared',
    draft: p.status === 'draft',
    data: t.publicData(data, p.id),
    state: t.clientState(data, st),
    status: row ? row.status : 'new',
    correct: !!row?.correct,
    score: row?.score || 0,
    reveal: done ? t.reveal(data, st) : null,
  };
}

module.exports = { types, SECTIONS, getType, clientPuzzle, normalize, SubmissionError, asList };
