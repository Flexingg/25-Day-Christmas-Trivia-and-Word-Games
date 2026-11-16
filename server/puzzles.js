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
 *                       Optional extras: `fraction` (0..1) gives partial credit once the
 *                       puzzle is done (score = round(points * fraction); without it a
 *                       correct puzzle earns full points and a wrong one 0), and
 *                       `good: true` tints in-progress feedback green.
 *   reveal(d,st)    - answer + explanation, sent once the puzzle is done
 *
 * To add a new puzzle type: add it here, add a renderer in
 * public/js/puzzles/<type>.js and a field definition in public/js/puzzle-types.js.
 */
const crypto = require('crypto');
const dictionary = require('./dictionary');

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

// ---------- helpers for the newer types ----------

// "For to us a [child|baby] is born" -> text pieces + blanks with their accepted alternates
function parseVerse(text) {
  const parts = [];
  const re = /\[([^\]]*)\]/g;
  let last = 0, m;
  while ((m = re.exec(String(text ?? '')))) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ alts: m[1].split('|').map(a => a.trim()).filter(Boolean) });
    last = re.lastIndex;
  }
  if (last < String(text ?? '').length) parts.push({ text: text.slice(last) });
  return { parts, blanks: parts.filter(p => p.alts).map(p => p.alts) };
}

// Standard crossword numbering: a cell starts an entry when the previous cell in that
// direction is an edge/black square and the entry is at least 2 letters long.
function crosswordLayout(grid) {
  const rows = (Array.isArray(grid) ? grid : []).map(r => String(r).trim().toUpperCase());
  const H = rows.length, W = rows[0]?.length || 0;
  const white = (r, c) => r >= 0 && r < H && c >= 0 && c < W && rows[r][c] !== '#';
  const across = [], down = [], numbers = [];
  let n = 0;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (!white(r, c)) continue;
      const startsAcross = !white(r, c - 1) && white(r, c + 1);
      const startsDown = !white(r - 1, c) && white(r + 1, c);
      if (!startsAcross && !startsDown) continue;
      n++;
      numbers.push({ r, c, n });
      if (startsAcross) {
        let len = 0; while (white(r, c + len)) len++;
        across.push({ n, r, c, len });
      }
      if (startsDown) {
        let len = 0; while (white(r + len, c)) len++;
        down.push({ n, r, c, len });
      }
    }
  }
  return { rows, H, W, white, across, down, numbers };
}

function beeLetters(d) {
  const center = lettersOnly(d.center).slice(0, 1);
  const outer = lettersOnly(Array.isArray(d.outer) ? d.outer.join('') : d.outer);
  return { center, outer, all: center + outer };
}

function whoPeople(d) {
  const given = asList(d.people);
  if (given.length) return given;
  const seen = [];
  for (const q of d.quotes || []) {
    const who = String(q.who || '').trim();
    if (who && !seen.some(x => normalize(x) === normalize(who))) seen.push(who);
  }
  return seen;
}

const WORDLE_DICTIONARIES = ['en', 'es', 'any', 'off'];

// Is this guess an acceptable Wordle guess for this puzzle? (dictionary check, plus per-puzzle extra words)
function wordleAccepts(d, guess) {
  const mode = WORDLE_DICTIONARIES.includes(d.dictionary) ? d.dictionary : 'en';
  if (mode === 'off') return true;
  if (asList(d.allowWords).some(w => lettersOnly(w) === guess)) return true;
  return dictionary.isWord(guess, mode);
}

function beeWords(d) { return [...new Set(asList(d.words).map(lettersOnly).filter(Boolean))]; }
function beeTarget(d) {
  const n = Number(d.target);
  return Number.isInteger(n) && n > 0 ? n : Math.ceil(beeWords(d).length / 2);
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
    defaults: { prompt: 'Guess the hidden word.', word: '', hint: '', explanation: '', maxGuesses: 6, dictionary: 'en', allowWords: [] },
    validate(d) {
      const errs = [];
      const w = lettersOnly(d.word);
      if (w.length < 3 || w.length > 10) errs.push('Word must be 3–10 letters (A–Z only).');
      if (w !== String(d.word || '').toUpperCase()) errs.push('Word should be letters only (no spaces/accents).');
      if (d.dictionary !== undefined && !WORDLE_DICTIONARIES.includes(d.dictionary)) errs.push('Word check must be English, Spanish, English or Spanish, or Off.');
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
      // Only real words (the secret word always counts). Thrown before anything is recorded, so it costs no guess.
      if (guess !== word && !wordleAccepts(d, guess)) throw new SubmissionError('Not in word list');
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

  rebus: {
    label: 'Emoji rebus',
    points: 1,
    defaults: { prompt: 'What do these emoji spell out?', rebus: '', answers: [''], hint: '', explanation: '', attempts: 3 },
    validate(d) {
      const errs = [];
      if (!String(d.rebus || '').trim()) errs.push('Add the emoji rebus (e.g. 🐴 + 👞).');
      if (!asList(d.answers).length) errs.push('Add at least one accepted answer.');
      return errs;
    },
    publicData: (d) => ({ ...common(d), rebus: String(d.rebus || ''), attempts: Number(d.attempts) || 3 }),
    initialState: () => ({ tries: [] }),
    clientState: (d, st) => ({ tries: st.tries || [] }),
    submit: (d, sub, st) => freeTextSubmit(asList(d.answers), Number(d.attempts) || 3, sub, st),
    reveal: (d) => ({ answer: asList(d.answers)[0], alsoAccepted: asList(d.answers).slice(1), explanation: d.explanation || '' }),
  },

  verse: {
    label: 'Fill in the verse',
    points: 1,
    defaults: {
      prompt: 'Fill in the missing words.', reference: '', translation: 'ESV', text: '',
      wordBank: false, decoys: [], attempts: 3, explanation: '',
    },
    validate(d) {
      const errs = [];
      const text = String(d.text || '');
      const { blanks } = parseVerse(text);
      if (!text.trim()) errs.push('Verse text is required.');
      else if (!blanks.length) errs.push('Put the missing words in [square brackets], e.g. "For to us a [child] is born".');
      if ((text.match(/\[/g) || []).length !== (text.match(/\]/g) || []).length || blanks.length !== (text.match(/\[/g) || []).length) {
        errs.push('Square brackets are unbalanced.');
      }
      if (blanks.some(b => !b.length)) errs.push('Every [blank] needs at least one word inside it.');
      return errs;
    },
    publicData(d, id) {
      const { parts, blanks } = parseVerse(d.text);
      let i = 0;
      const out = {
        ...common(d),
        reference: d.reference || '',
        translation: d.translation || '',
        // text pieces as strings, blanks as { blank: index }
        parts: parts.map(p => (p.alts ? { blank: i++ } : p.text)),
        blanks: blanks.length,
        attempts: Number(d.attempts) || 3,
        wordBank: !!d.wordBank,
      };
      if (d.wordBank) out.bank = seededShuffle([...blanks.map(b => b[0]), ...asList(d.decoys)], id);
      return out;
    },
    initialState: () => ({ solved: {}, tries: 0, lastWrong: [] }),
    clientState: (d, st) => ({ solved: st.solved || {}, tries: st.tries || 0, lastWrong: st.lastWrong || [] }),
    submit(d, sub, st) {
      const { blanks } = parseVerse(d.text);
      const answers = Array.isArray(sub.answers) ? sub.answers : [];
      st.solved = st.solved || {};
      const open = blanks.map((_, i) => i).filter(i => st.solved[i] == null);
      const filled = open.filter(i => String(answers[i] ?? '').trim());
      if (!filled.length) throw new SubmissionError('Fill in at least one blank first!');
      st.lastWrong = [];
      for (const i of filled) {
        const n = normalize(answers[i]);
        if (blanks[i].some(a => normalize(a) === n)) st.solved[i] = blanks[i][0];
        else st.lastWrong.push(i);
      }
      st.tries = (st.tries || 0) + 1;
      const solved = Object.keys(st.solved).length;
      if (solved === blanks.length) return { done: true, correct: true, feedback: 'Correct! 🎉' };
      const left = (Number(d.attempts) || 3) - st.tries;
      if (left <= 0) return { done: true, correct: false, fraction: solved / blanks.length, feedback: `Out of tries — ${solved} of ${blanks.length} blanks right.` };
      return { done: false, correct: false, feedback: `${solved} of ${blanks.length} blanks right — ${left} ${left === 1 ? 'try' : 'tries'} left.` };
    },
    reveal(d, st) {
      const { blanks } = parseVerse(d.text);
      return {
        reference: d.reference || '', translation: d.translation || '',
        blanks: blanks.map(b => b[0]),
        solved: Object.keys(st.solved || {}).map(Number),
        explanation: d.explanation || '',
      };
    },
  },

  timeline: {
    label: 'Timeline (put in order)',
    points: 2,
    defaults: {
      prompt: 'Put these in order, earliest first.',
      items: [{ label: '', detail: '' }, { label: '', detail: '' }, { label: '', detail: '' }],
      attempts: 3, explanation: '',
    },
    validate(d) {
      const errs = [];
      const items = Array.isArray(d.items) ? d.items : [];
      if (items.length < 2) errs.push('Needs at least 2 items.');
      if (items.some(i => !String(i?.label || '').trim())) errs.push('Every item needs a label.');
      const labels = items.map(i => normalize(i?.label));
      if (new Set(labels).size !== labels.length) errs.push('Item labels must all be different.');
      return errs;
    },
    publicData(d, id) {
      const labels = d.items.map(i => String(i.label).trim());
      let order = seededShuffle(labels, id);
      // never hand out the puzzle already solved
      for (let k = 1; k < 20 && labels.length > 1 && order.every((l, i) => l === labels[i]); k++) order = seededShuffle(labels, `${id}:${k}`);
      return { ...common(d), order, attempts: Number(d.attempts) || 3 };
    },
    initialState: () => ({ attempts: [] }),
    clientState: (d, st) => ({ attempts: st.attempts || [] }),
    submit(d, sub, st) {
      const labels = d.items.map(i => String(i.label).trim());
      const order = (Array.isArray(sub.order) ? sub.order : []).map(l => String(l).trim());
      if (order.length !== labels.length || [...order].sort().join('\n') !== [...labels].sort().join('\n')) {
        throw new SubmissionError('Something is off with that order. Reload and try again.');
      }
      st.attempts = st.attempts || [];
      if (st.attempts.some(a => a.order.join('\n') === order.join('\n'))) throw new SubmissionError('You already tried that order.');
      const result = order.map((l, i) => l === labels[i]);
      st.attempts.push({ order, result });
      const right = result.filter(Boolean).length;
      if (right === labels.length) return { done: true, correct: true, feedback: 'In perfect order! 🎉' };
      const left = (Number(d.attempts) || 3) - st.attempts.length;
      if (left <= 0) {
        const best = Math.max(...st.attempts.map(a => a.result.filter(Boolean).length));
        return { done: true, correct: false, fraction: best / labels.length, feedback: 'Out of tries.' };
      }
      return { done: false, correct: false, feedback: `${right} of ${labels.length} in the right spot — ${left} ${left === 1 ? 'try' : 'tries'} left.` };
    },
    reveal: (d) => ({
      items: d.items.map(i => ({ label: String(i.label).trim(), detail: String(i.detail || '').trim() })),
      explanation: d.explanation || '',
    }),
  },

  who_said_it: {
    label: 'Who said it?',
    points: 2,
    defaults: {
      prompt: 'Who said it?',
      people: [],
      quotes: [{ quote: '', who: '' }, { quote: '', who: '' }],
      explanation: '',
    },
    validate(d) {
      const errs = [];
      const quotes = Array.isArray(d.quotes) ? d.quotes : [];
      if (!quotes.length) errs.push('Add at least one quote.');
      if (quotes.some(q => !String(q?.quote || '').trim())) errs.push('Every quote needs text.');
      if (quotes.some(q => !String(q?.who || '').trim())) errs.push('Every quote needs a person.');
      if (asList(d.people).length) {
        const known = asList(d.people).map(normalize);
        const missing = quotes.filter(q => q?.who && !known.includes(normalize(q.who))).map(q => q.who);
        if (missing.length) errs.push(`These people aren't in the list of people: ${[...new Set(missing)].join(', ')}.`);
      } else if (new Set(quotes.map(q => normalize(q?.who))).size < 2) errs.push('Needs at least 2 different people.');
      return errs;
    },
    publicData(d) {
      return { ...common(d), people: whoPeople(d), quotes: d.quotes.map(q => String(q.quote).trim()) };
    },
    initialState: () => ({ picks: null }),
    clientState: (d, st) => ({ picks: st.picks || null }),
    submit(d, sub, st) {
      const people = whoPeople(d);
      const picks = Array.isArray(sub.picks) ? sub.picks : [];
      if (picks.length !== d.quotes.length || picks.some(p => !String(p ?? '').trim())) throw new SubmissionError('Pick a person for every quote!');
      if (picks.some(p => !people.some(x => normalize(x) === normalize(p)))) throw new SubmissionError('Pick people from the list.');
      st.picks = picks.map(p => people.find(x => normalize(x) === normalize(p)));
      const right = d.quotes.filter((q, i) => normalize(q.who) === normalize(st.picks[i])).length;
      const all = right === d.quotes.length;
      return { done: true, correct: all, fraction: right / d.quotes.length, feedback: all ? 'You know them well! 🎉' : `${right} of ${d.quotes.length} right.` };
    },
    reveal: (d, st) => ({
      results: d.quotes.map((q, i) => ({ quote: String(q.quote).trim(), who: String(q.who).trim(), right: normalize(q.who) === normalize(st.picks?.[i]) })),
      explanation: d.explanation || '',
    }),
  },

  spelling_bee: {
    label: 'Spelling Bee',
    points: 3,
    defaults: { prompt: 'Make words using the letters. Every word must include the center letter.', center: '', outer: '', words: [], minLength: 4, explanation: '' },
    validate(d) {
      const errs = [];
      const { center, outer, all } = beeLetters(d);
      const words = asList(d.words).map(lettersOnly);
      if (center.length !== 1 || outer.length !== 6 || new Set(all).size !== 7) {
        errs.push('Needs 1 center letter and 6 different outer letters (7 distinct letters in all).');
        return errs;
      }
      const minLen = Number(d.minLength) || 4;
      if (!words.length) errs.push('Add the accepted words.');
      for (const w of words) {
        if (w.length < minLen) errs.push(`"${w}" is shorter than the minimum length (${minLen}).`);
        else if (![...w].every(ch => all.includes(ch))) errs.push(`"${w}" uses letters that aren't in the honeycomb.`);
        else if (!w.includes(center)) errs.push(`"${w}" doesn't contain the center letter ${center}.`);
      }
      if (new Set(words).size !== words.length) errs.push('Some words are listed twice.');
      const t = beeTarget(d);
      if (words.length && (t < 1 || t > words.length)) errs.push('Target must be between 1 and the number of words.');
      return errs;
    },
    publicData(d, id) {
      const { center, outer } = beeLetters(d);
      return {
        ...common(d), center, outer: seededShuffle(outer.split(''), id),
        minLength: Number(d.minLength) || 4, target: beeTarget(d), total: beeWords(d).length,
      };
    },
    initialState: () => ({ found: [] }),
    clientState: (d, st) => ({ found: st.found || [] }),
    submit(d, sub, st) {
      st.found = st.found || [];
      const { center, all } = beeLetters(d);
      const words = beeWords(d);
      const target = beeTarget(d);
      const finish = (all_found) => {
        const found = st.found.length;
        const correct = found >= target;
        return {
          done: true, correct, fraction: Math.min(1, found / target),
          feedback: all_found ? 'Queen Bee! You found every word! 🐝' : correct ? `You hit the target with ${found} words! 🐝` : `Finished with ${found} of ${target} needed.`,
        };
      };
      if (sub.finish) return finish(false);
      const w = lettersOnly(sub.word);
      if (!w) throw new SubmissionError('Spell a word first!');
      if (w.length < (Number(d.minLength) || 4)) throw new SubmissionError(`Too short — words need ${Number(d.minLength) || 4}+ letters`);
      if (![...w].every(ch => all.includes(ch))) throw new SubmissionError('Bad letters — only use the 7 shown');
      if (!w.includes(center)) throw new SubmissionError('Missing center letter');
      if (st.found.includes(w)) throw new SubmissionError('Already found');
      if (!words.includes(w)) {
        // A real word that just isn't on the admin's list: friendly note, no penalty, not counted
        if (dictionary.isWord(w, 'en') && !dictionary.isBlocked(w)) throw new SubmissionError('Real word, but not on today’s list');
        throw new SubmissionError('Not in word list');
      }
      st.found.push(w);
      if (st.found.length === words.length) return finish(true);
      const pangram = [...all].every(ch => w.includes(ch));
      return { done: false, correct: false, good: true, feedback: pangram ? 'Pangram! 🐝' : w.length >= 7 ? 'Amazing!' : w.length >= 5 ? 'Great!' : 'Good!' };
    },
    reveal(d, st) {
      const { all } = beeLetters(d);
      const words = beeWords(d);
      return {
        words: words.slice().sort(), found: st.found || [],
        pangrams: words.filter(w => [...all].every(ch => w.includes(ch))),
        target: beeTarget(d), explanation: d.explanation || '',
      };
    },
  },

  crossword: {
    label: 'Mini crossword',
    points: 3,
    defaults: {
      prompt: 'Fill in the crossword.', grid: [], across: [], down: [], maxChecks: 3, explanation: '',
    },
    validate(d) {
      const errs = [];
      const rows = (Array.isArray(d.grid) ? d.grid : []).map(r => String(r).trim().toUpperCase());
      if (rows.length < 2) { errs.push('Grid needs at least 2 rows.'); return errs; }
      if (rows.some(r => r.length !== rows[0].length)) errs.push('Every grid row must be the same length.');
      if (rows.some(r => /[^A-Z#]/.test(r))) errs.push('Grid rows may only contain letters A–Z and # for black squares.');
      if (rows.length > 15 || rows[0].length > 15) errs.push('Grid can be at most 15×15.');
      if (errs.length) return errs;
      const lay = crosswordLayout(rows);
      if (!lay.across.length && !lay.down.length) errs.push('Grid has no words (need runs of 2+ letters).');
      const ac = asList(d.across).length, dc = asList(d.down).length;
      if (ac !== lay.across.length) errs.push(`This grid has ${lay.across.length} across entries (${lay.across.map(e => e.n).join(', ')}) but ${ac} across clues.`);
      if (dc !== lay.down.length) errs.push(`This grid has ${lay.down.length} down entries (${lay.down.map(e => e.n).join(', ')}) but ${dc} down clues.`);
      for (let r = 0; r < lay.H; r++) for (let c = 0; c < lay.W; c++) {
        if (!lay.white(r, c)) continue;
        const inAcross = lay.white(r, c - 1) || lay.white(r, c + 1);
        const inDown = lay.white(r - 1, c) || lay.white(r + 1, c);
        if (!inAcross && !inDown) errs.push(`The letter at row ${r + 1}, column ${c + 1} isn't part of any word.`);
      }
      return errs;
    },
    publicData(d) {
      const lay = crosswordLayout(d.grid);
      const clues = (entries, list) => entries.map((e, i) => ({ ...e, clue: asList(list)[i] || '' }));
      return {
        ...common(d),
        rows: lay.H, cols: lay.W,
        layout: lay.rows.map(r => r.replace(/[^#]/g, '.')),
        numbers: lay.numbers,
        across: clues(lay.across, d.across),
        down: clues(lay.down, d.down),
        maxChecks: Number(d.maxChecks) || 3,
      };
    },
    initialState: () => ({ checks: 0, wrong: [], empty: 0, frac: 0 }),
    clientState: (d, st) => ({ checks: st.checks || 0, wrong: st.wrong || [], empty: st.empty || 0 }),
    submit(d, sub, st) {
      const lay = crosswordLayout(d.grid);
      st.checks = st.checks || 0;
      const max = Number(d.maxChecks) || 3;
      if (sub.giveUp) return { done: true, correct: false, fraction: st.frac || 0, feedback: 'Puzzle ended.' };
      if (!Array.isArray(sub.cells)) throw new SubmissionError('Fill in some letters first!');
      let whites = 0, right = 0, empty = 0;
      const wrong = [];
      for (let r = 0; r < lay.H; r++) for (let c = 0; c < lay.W; c++) {
        if (!lay.white(r, c)) continue;
        whites++;
        const ch = String(sub.cells[r] ?? '')[c]?.toUpperCase();
        if (!ch || ch === ' ') empty++;
        else if (ch === lay.rows[r][c]) right++;
        else wrong.push([r, c]);
      }
      if (empty === whites) throw new SubmissionError('Fill in some letters first!');
      if (!wrong.length && !empty) return { done: true, correct: true, feedback: 'Solved! 🎉' };
      st.checks++;
      st.wrong = wrong; st.empty = empty; st.frac = right / whites;
      const left = max - st.checks;
      if (left <= 0) return { done: true, correct: false, fraction: st.frac, feedback: 'Out of checks.' };
      const bits = [];
      if (wrong.length) bits.push(`${wrong.length} wrong`);
      if (empty) bits.push(`${empty} empty`);
      return { done: false, correct: false, feedback: `${bits.join(', ')} — ${left} ${left === 1 ? 'check' : 'checks'} left.` };
    },
    reveal: (d) => ({ grid: crosswordLayout(d.grid).rows, explanation: d.explanation || '' }),
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
