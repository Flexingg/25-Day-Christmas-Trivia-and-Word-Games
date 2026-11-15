import { h } from '../util.js';

const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
let active = null; // the wordle that receives physical keyboard input

document.addEventListener('keydown', (e) => {
  if (!active || !active.el.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (e.key === 'Enter') { e.preventDefault(); active.press('ENTER'); }
  else if (e.key === 'Backspace') { e.preventDefault(); active.press('DEL'); }
  else if (/^[a-z]$/i.test(e.key)) active.press(e.key.toUpperCase());
});

export function render(p, ctx) {
  const { length, maxGuesses } = p.data;
  const guesses = p.state.guesses || [];
  const done = p.status === 'done';
  let current = '';

  // keyboard colours: best result seen per letter
  const rank = { absent: 1, present: 2, correct: 3 };
  const keyState = {};
  for (const g of guesses) [...g.guess].forEach((ch, i) => {
    if ((rank[g.result[i]] || 0) > (rank[keyState[ch]] || 0)) keyState[ch] = g.result[i];
  });

  const grid = h('div.wgrid');
  const rows = [];
  for (let r = 0; r < maxGuesses; r++) {
    const row = h('div.wrow');
    for (let c = 0; c < length; c++) {
      const g = guesses[r];
      row.append(h('div.wcell' + (g ? '.' + g.result[c] : ''), g ? g.guess[c] : ''));
    }
    rows.push(row);
    grid.append(row);
  }

  const paint = () => {
    const row = rows[guesses.length];
    if (!row) return;
    [...row.children].forEach((cell, i) => {
      cell.textContent = current[i] || '';
      cell.classList.toggle('filled', !!current[i]);
    });
  };

  const self = {
    id: p.id,
    el: grid,
    press(k) {
      if (done) return;
      if (k === 'ENTER') {
        if (current.length !== length) {
          rows[guesses.length]?.classList.remove('shake');
          void rows[guesses.length]?.offsetWidth;
          rows[guesses.length]?.classList.add('shake');
          return ctx.say(`Need ${length} letters`, false);
        }
        return ctx.submit({ guess: current });
      }
      if (k === 'DEL') current = current.slice(0, -1);
      else if (current.length < length) current += k;
      paint();
    },
  };

  const wrap = h('div.wordle', { onpointerdown: () => { active = self; } }, grid);
  if (!done) {
    if (!active || !active.el.isConnected || active.id === p.id) active = self;
    const kb = h('div.keyboard');
    ROWS.forEach((letters, i) => {
      const row = h('div.krow');
      if (i === 2) row.append(h('button.key.wide', { onclick: () => self.press('ENTER') }, 'ENTER'));
      for (const ch of letters) row.append(h('button.key' + (keyState[ch] ? '.' + keyState[ch] : ''), { onclick: () => self.press(ch) }, ch));
      if (i === 2) row.append(h('button.key.wide', { onclick: () => self.press('DEL') }, '⌫'));
      kb.append(row);
    });
    wrap.append(kb);
  }
  return wrap;
}
