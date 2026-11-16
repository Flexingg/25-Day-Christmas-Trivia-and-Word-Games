// Field definitions that drive the admin puzzle editor form.
// kinds: text, textarea, number, checkbox, list (one per line), image, choices, groups,
//        rows (repeating rows of text boxes: `columns` + `minRows`), grid (crossword rows + live preview)
const prompt = { key: 'prompt', kind: 'textarea', label: 'Question / prompt' };
const image = { key: 'image', kind: 'image', label: 'Image (optional)' };
const hint = { key: 'hint', kind: 'text', label: 'Hint (optional, shown up front)' };
const explanation = { key: 'explanation', kind: 'textarea', label: 'Explanation / fun fact (shown after answering)' };
const attempts = { key: 'attempts', kind: 'number', label: 'Guesses allowed', min: 1, max: 10 };

export const TYPE_FIELDS = {
  multiple_choice: [prompt, image, { key: 'choices', kind: 'choices', label: 'Choices (select the correct one)' }, explanation],
  text_answer: [prompt, image, { key: 'answers', kind: 'list', label: 'Accepted answers — one per line (first one is shown as "the answer"). Matching ignores case, accents, punctuation and a leading "the/a/an".' }, hint, attempts, explanation],
  scramble: [prompt, { key: 'answer', kind: 'text', label: 'Answer (gets scrambled automatically)', upper: true }, { key: 'alsoAccept', kind: 'list', label: 'Also accept (optional, one per line)' }, hint, attempts, explanation],
  wordle: [prompt, { key: 'word', kind: 'text', label: 'Secret word (3–10 letters, A–Z only)', upper: true, wordCheck: true }, hint, { key: 'maxGuesses', kind: 'number', label: 'Max guesses', min: 1, max: 10 },
    { key: 'dictionary', kind: 'select', label: 'Guesses must be real words in…', default: 'en', options: [['en', 'English'], ['es', 'Spanish'], ['any', 'English or Spanish'], ['off', 'Off — any letters']] },
    { key: 'allowWords', kind: 'list', label: 'Extra words to accept as guesses for this puzzle only (optional, one per line). The secret word is always accepted. Words for every puzzle go in Settings.' },
    explanation],
  connections: [prompt, { key: 'groups', kind: 'groups', label: 'Groups (easiest → hardest)' }, { key: 'maxMistakes', kind: 'number', label: 'Mistakes allowed', min: 1, max: 10 }, explanation],
  rebus: [prompt, { key: 'rebus', kind: 'text', wide: true, label: 'Emoji rebus (e.g. 🐴 + 👞)' }, { key: 'answers', kind: 'list', label: 'Accepted answers — one per line (first one is shown as "the answer")' }, hint, attempts, explanation],
  verse: [
    prompt,
    { key: 'reference', kind: 'text', label: 'Reference (e.g. Isaiah 9:6)' },
    { key: 'translation', kind: 'text', label: 'Translation (e.g. ESV)' },
    { key: 'text', kind: 'textarea', label: 'Verse text. Put each missing word in [square brackets]; separate accepted alternates with | like [child|baby].' },
    { key: 'wordBank', kind: 'checkbox', label: 'Use a word bank (tap-to-fill chips instead of typing)' },
    { key: 'decoys', kind: 'list', label: 'Decoy words for the word bank (optional, one per line)' },
    attempts, explanation,
  ],
  timeline: [
    prompt,
    { key: 'items', kind: 'rows', label: 'Items in the CORRECT order (earliest first). The detail (e.g. a year) is only shown after the puzzle ends.', minRows: 3, ordered: true,
      columns: [{ key: 'label', label: 'Label', placeholder: 'Windows 95' }, { key: 'detail', label: 'Detail', placeholder: 'August 1995' }] },
    attempts, explanation,
  ],
  who_said_it: [
    prompt,
    { key: 'people', kind: 'list', label: 'People to choose from — one per line (leave empty to use the names in the quotes below)' },
    { key: 'quotes', kind: 'rows', label: 'Quotes and who said them', minRows: 2,
      columns: [{ key: 'quote', label: 'Quote', wide: true }, { key: 'who', label: 'Who said it', placeholder: 'Name' }] },
    explanation,
  ],
  spelling_bee: [
    prompt,
    { key: 'center', kind: 'text', label: 'Center letter (required in every word)', upper: true, maxlength: 1 },
    { key: 'outer', kind: 'text', label: 'Six outer letters (no spaces)', upper: true, maxlength: 6 },
    { key: 'words', kind: 'beewords', label: 'Words that count — one per line. Other real English words are told "real word, but not on today\'s list" and aren\'t counted.' },
    { key: 'minLength', kind: 'number', label: 'Minimum word length', min: 3, max: 8 },
    { key: 'target', kind: 'number', label: 'Words needed for full credit (blank = half the list)', min: 1 },
    explanation,
  ],
  crossword: [
    prompt,
    { key: 'grid', kind: 'grid', label: 'Grid — one row per line, letters A–Z, # for black squares (all rows the same length)' },
    { key: 'across', kind: 'list', label: 'Across clues — one per line, in numbered order' },
    { key: 'down', kind: 'list', label: 'Down clues — one per line, in numbered order' },
    { key: 'maxChecks', kind: 'number', label: 'Checks allowed', min: 1, max: 10 },
    explanation,
  ],
};

// Standard crossword numbering (kept in step with crosswordLayout() in server/puzzles.js).
// Returns { rows, numbers: {"r,c": n}, across: [n...], down: [n...] }.
export function crosswordNumbers(grid) {
  const rows = (grid || []).map(r => String(r).trim().toUpperCase());
  const white = (r, c) => r >= 0 && r < rows.length && c >= 0 && c < (rows[0] || '').length && rows[r][c] !== '#';
  const out = { rows, numbers: {}, across: [], down: [] };
  let n = 0;
  rows.forEach((row, r) => [...row].forEach((_, c) => {
    if (!white(r, c)) return;
    const a = !white(r, c - 1) && white(r, c + 1), d = !white(r - 1, c) && white(r + 1, c);
    if (!a && !d) return;
    out.numbers[`${r},${c}`] = ++n;
    if (a) out.across.push(n);
    if (d) out.down.push(n);
  }));
  return out;
}

// One-line "what's the answer" summary for lists and the review table
export function answerSummary(p) {
  switch (p.type) {
    case 'multiple_choice': return (p.choices || [])[Number(p.answer)] ?? '—';
    case 'text_answer': return (p.answers || []).join(' / ');
    case 'scramble': return p.answer || '—';
    case 'wordle': return p.word || '—';
    case 'connections': return (p.groups || []).map(g => `${g.name}: ${(g.words || []).join(', ')}`).join(' | ');
    case 'rebus': return (p.answers || []).join(' / ');
    case 'verse': return (String(p.text || '').match(/\[[^\]]*\]/g) || []).map(b => b.slice(1, -1).split('|')[0]).join(', ');
    case 'timeline': return (p.items || []).map(i => i.label).join(' → ');
    case 'who_said_it': return (p.quotes || []).map(q => q.who).join(', ');
    case 'spelling_bee': return `${(p.words || []).length} words: ${(p.words || []).join(', ')}`;
    case 'crossword': return (p.grid || []).join(' / ');
    default: return '';
  }
}

export function promptSummary(p) {
  if (p.title) return p.title;
  if (p.type === 'scramble') return `Scramble: ${p.answer || ''}`;
  if (p.type === 'wordle') return `Wordle: ${p.word || ''}`;
  if (p.type === 'rebus') return `Rebus: ${p.rebus || ''}`;
  if (p.type === 'verse') return `Verse: ${p.reference || ''}`;
  if (p.type === 'spelling_bee') return `Spelling Bee: ${(p.center || '')}${(p.outer || '')}`;
  if (p.type === 'crossword') return `Crossword ${(p.grid || [])[0]?.length || 0}×${(p.grid || []).length}`;
  if (p.type === 'connections') return `Connections: ${(p.groups || []).map(g => g.name).join(' · ')}`;
  return p.prompt || '(no prompt)';
}
