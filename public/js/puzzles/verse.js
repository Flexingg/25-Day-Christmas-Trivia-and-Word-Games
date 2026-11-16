import { h } from '../util.js';

export function render(p, ctx) {
  const done = p.status === 'done';
  const { parts, blanks, attempts, wordBank, bank = [] } = p.data;
  const solved = p.state.solved || {};
  const wrong = new Set(p.state.lastWrong || []);

  const head = h('div.verse-ref', [p.data.reference, p.data.translation && `(${p.data.translation})`].filter(Boolean).join(' '));

  // Finished: show the whole verse, marking blanks the player got and missed
  if (done) {
    const got = new Set(p.reveal.solved);
    return h('div', head, h('div.verse',
      parts.map(part => typeof part === 'string' ? part
        : h('span.vblank.' + (got.has(part.blank) ? 'ok' : 'missed'), p.reveal.blanks[part.blank]))));
  }

  const values = Array.from({ length: blanks }, () => '');
  const fill = {}; // word bank: blank index -> bank index
  let active = null;
  const inputs = {};
  const verse = h('div.verse');
  const submitBtn = h('button.btn', { onclick: () => ctx.submit({ answers: values }) }, 'Check');
  const bankBox = wordBank ? h('div.verse-bank') : null;

  const firstEmpty = () => { for (let i = 0; i < blanks; i++) if (solved[i] == null && !values[i]) return i; return null; };

  const drawBank = () => {
    if (!bankBox) return;
    const usedBy = new Set(Object.values(fill));
    bankBox.replaceChildren(bank.map((w, bi) => h('button.chip' + (usedBy.has(bi) ? '.used' : ''), {
      type: 'button', disabled: usedBy.has(bi),
      onclick: () => {
        const target = active != null && solved[active] == null && !values[active] ? active : firstEmpty();
        if (target == null) return;
        values[target] = w; fill[target] = bi; active = null;
        drawVerse(); drawBank();
      },
    }, w)));
  };

  const drawVerse = () => {
    verse.replaceChildren(parts.map(part => {
      if (typeof part === 'string') return part;
      const i = part.blank;
      if (solved[i] != null) return h('span.vblank.ok', solved[i]);
      if (wordBank) {
        // tap a filled blank to put its word back in the bank
        return h('button.vblank.slot' + (values[i] ? '.filled' : '') + (wrong.has(i) && !values[i] ? '.bad' : '') + (active === i ? '.active' : ''), {
          type: 'button',
          onclick: () => {
            if (values[i]) { values[i] = ''; delete fill[i]; active = i; } else active = active === i ? null : i;
            drawVerse(); drawBank();
          },
        }, values[i] || ' ');
      }
      const input = h('input.vblank' + (wrong.has(i) ? '.bad' : ''), {
        type: 'text', value: values[i], autocomplete: 'off', autocapitalize: 'off', spellcheck: false, 'aria-label': `Blank ${i + 1}`,
      });
      input.size = Math.max(6, values[i].length + 1);
      input.addEventListener('input', () => { values[i] = input.value; input.size = Math.max(6, input.value.length + 1); input.classList.remove('bad'); });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') ctx.submit({ answers: values }); });
      inputs[i] = input;
      return input;
    }));
  };
  drawVerse(); drawBank();

  const left = attempts - (p.state.tries || 0);
  return h('div', head, verse, bankBox,
    h('div.answer-row', { style: { marginTop: '12px' } }, submitBtn),
    h('div.muted', { style: { fontSize: '.8rem', marginTop: '6px' } },
      `${left} ${left === 1 ? 'try' : 'tries'} left · ${Object.keys(solved).length} of ${blanks} blanks solved`,
      wordBank ? ' · tap a word to fill the next blank' : ''));
}
