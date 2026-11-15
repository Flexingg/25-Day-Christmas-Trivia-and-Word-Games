import { h } from '../util.js';

// Shared by text_answer and scramble
export function answerBox(p, ctx, placeholder = 'Your answer…') {
  const wrap = h('div');
  if (p.status !== 'done') {
    const input = h('input', { type: 'text', placeholder, autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
    const go = () => input.value.trim() && ctx.submit({ answer: input.value });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    const left = p.data.attempts - (p.state.tries?.length || 0);
    wrap.append(
      h('div.answer-row', input, h('button.btn', { onclick: go }, 'Submit')),
      h('div.muted', { style: { fontSize: '.8rem', marginTop: '6px' } }, `${left} ${left === 1 ? 'guess' : 'guesses'} left`),
    );
  }
  if (p.state.tries?.length) {
    const wrong = p.correct ? p.state.tries.slice(0, -1) : p.state.tries;
    if (wrong.length) wrap.append(h('div.tries', wrong.map(t => h('span', t))));
  }
  return wrap;
}

export function render(p, ctx) {
  return answerBox(p, ctx);
}
