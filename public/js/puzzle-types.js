// Field definitions that drive the admin puzzle editor form.
// kinds: text, textarea, number, list (one per line), image, choices, groups
const prompt = { key: 'prompt', kind: 'textarea', label: 'Question / prompt' };
const image = { key: 'image', kind: 'image', label: 'Image (optional)' };
const hint = { key: 'hint', kind: 'text', label: 'Hint (optional, shown up front)' };
const explanation = { key: 'explanation', kind: 'textarea', label: 'Explanation / fun fact (shown after answering)' };
const attempts = { key: 'attempts', kind: 'number', label: 'Guesses allowed', min: 1, max: 10 };

export const TYPE_FIELDS = {
  multiple_choice: [prompt, image, { key: 'choices', kind: 'choices', label: 'Choices (select the correct one)' }, explanation],
  text_answer: [prompt, image, { key: 'answers', kind: 'list', label: 'Accepted answers — one per line (first one is shown as "the answer"). Matching ignores case, accents, punctuation and a leading "the/a/an".' }, hint, attempts, explanation],
  scramble: [prompt, { key: 'answer', kind: 'text', label: 'Answer (gets scrambled automatically)', upper: true }, { key: 'alsoAccept', kind: 'list', label: 'Also accept (optional, one per line)' }, hint, attempts, explanation],
  wordle: [prompt, { key: 'word', kind: 'text', label: 'Secret word (3–10 letters, A–Z only)', upper: true }, hint, { key: 'maxGuesses', kind: 'number', label: 'Max guesses', min: 1, max: 10 }, explanation],
  connections: [prompt, { key: 'groups', kind: 'groups', label: 'Groups (easiest → hardest)' }, { key: 'maxMistakes', kind: 'number', label: 'Mistakes allowed', min: 1, max: 10 }, explanation],
};

// One-line "what's the answer" summary for lists and the review table
export function answerSummary(p) {
  switch (p.type) {
    case 'multiple_choice': return (p.choices || [])[Number(p.answer)] ?? '—';
    case 'text_answer': return (p.answers || []).join(' / ');
    case 'scramble': return p.answer || '—';
    case 'wordle': return p.word || '—';
    case 'connections': return (p.groups || []).map(g => `${g.name}: ${(g.words || []).join(', ')}`).join(' | ');
    default: return '';
  }
}

export function promptSummary(p) {
  if (p.title) return p.title;
  if (p.type === 'scramble') return `Scramble: ${p.answer || ''}`;
  if (p.type === 'wordle') return `Wordle: ${p.word || ''}`;
  if (p.type === 'connections') return `Connections: ${(p.groups || []).map(g => g.name).join(' · ')}`;
  return p.prompt || '(no prompt)';
}
