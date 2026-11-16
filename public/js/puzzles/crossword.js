import { h } from '../util.js';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

export function render(p, ctx) {
  const done = p.status === 'done';
  const { rows, cols, layout, numbers, across, down, maxChecks } = p.data;
  const key = `rc_xw_${p.id}`;
  const isWhite = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols && layout[r][c] !== '#';

  // which entry covers each cell, per direction
  const entryAt = { A: {}, D: {} };
  for (const [dir, list] of [['A', across], ['D', down]]) {
    for (const e of list) for (let i = 0; i < e.len; i++) {
      entryAt[dir][dir === 'A' ? `${e.r},${e.c + i}` : `${e.r + i},${e.c}`] = { ...e, dir };
    }
  }
  const numAt = {};
  for (const n of numbers) numAt[`${n.r},${n.c}`] = n.n;

  // letters the player has typed (saved on this device so a reload doesn't lose them)
  let letters = Array.from({ length: rows }, () => Array(cols).fill(''));
  try {
    const saved = JSON.parse(store.get(key) || 'null');
    if (Array.isArray(saved)) saved.forEach((row, r) => [...String(row)].forEach((ch, c) => { if (letters[r] && /[A-Z]/.test(ch)) letters[r][c] = ch; }));
  } catch { /* ignore */ }
  const save = () => store.set(key, JSON.stringify(letters.map(r => r.map(ch => ch || ' ').join(''))));

  const grid = h('div.xgrid', { style: { '--cols': cols } });
  const cellEls = {};

  if (done) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!isWhite(r, c)) { grid.append(h('div.xcell.blk')); continue; }
      const sol = p.reveal.grid[r][c];
      grid.append(h('div.xcell' + (letters[r][c] === sol ? '.ok' : '.missed'),
        numAt[`${r},${c}`] ? h('span.xnum', numAt[`${r},${c}`]) : null, h('span.xl', sol)));
    }
    return h('div', grid, h('div.muted', { style: { fontSize: '.8rem', marginTop: '6px', textAlign: 'center' } }, 'Green = yours was right. Amber = filled in for you.'),
      h('div.xclues', clueList(across, 'Across'), clueList(down, 'Down')));
  }

  let wrong = new Set((p.state.wrong || []).map(([r, c]) => `${r},${c}`));
  let dir = 'A';
  let cur = (() => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (isWhite(r, c)) return [r, c]; return [0, 0]; })();
  if (!entryAt.A[cur.join(',')] && entryAt.D[cur.join(',')]) dir = 'D';

  const clueBar = h('div.xbar');
  const clueLists = { A: {}, D: {} };

  const curEntry = () => entryAt[dir][cur.join(',')];

  const paint = () => {
    const en = curEntry();
    const inEntry = new Set();
    if (en) for (let i = 0; i < en.len; i++) inEntry.add(dir === 'A' ? `${en.r},${en.c + i}` : `${en.r + i},${en.c}`);
    for (const k of Object.keys(cellEls)) {
      const [r, c] = k.split(',').map(Number);
      const el = cellEls[k];
      el.className = 'xcell' + (inEntry.has(k) ? ' hl' : '') + (k === cur.join(',') ? ' cur' : '') + (wrong.has(k) ? ' bad' : '');
      el.querySelector('.xl').textContent = letters[r][c];
    }
    if (en) {
      const clue = (dir === 'A' ? across : down).find(e => e.n === en.n);
      clueBar.replaceChildren(
        h('button.xnav', { type: 'button', 'aria-label': 'Previous clue', onclick: () => stepClue(-1) }, '‹'),
        h('div.xclue-now', h('span', h('b', `${en.n}-${dir === 'A' ? 'Across' : 'Down'} `), clue?.clue || '')),
        h('button.xnav', { type: 'button', 'aria-label': 'Next clue', onclick: () => stepClue(1) }, '›'));
    }
    for (const d of ['A', 'D']) for (const [n, li] of Object.entries(clueLists[d])) li.classList.toggle('on', !!en && d === dir && Number(n) === en.n);
  };

  const select = (r, c, toggle) => {
    const k = `${r},${c}`;
    if (toggle && k === cur.join(',') && entryAt.A[k] && entryAt.D[k]) dir = dir === 'A' ? 'D' : 'A';
    else if (!entryAt[dir][k]) dir = dir === 'A' ? 'D' : 'A'; // this cell only belongs to the other direction
    cur = [r, c];
    paint();
    kb.focus({ preventScroll: true });
  };

  const allEntries = () => [...across.map(e => ({ ...e, dir: 'A' })), ...down.map(e => ({ ...e, dir: 'D' }))];
  const stepClue = (delta) => {
    const list = allEntries();
    const en = curEntry();
    const i = list.findIndex(e => e.dir === dir && e.n === en?.n);
    const next = list[(i + delta + list.length) % list.length];
    dir = next.dir; cur = [next.r, next.c]; paint();
    kb.focus({ preventScroll: true });
  };

  // move along the current entry; stays put at its ends
  const advance = (delta) => {
    const [r, c] = cur;
    const nr = dir === 'D' ? r + delta : r, nc = dir === 'A' ? c + delta : c;
    if (isWhite(nr, nc) && entryAt[dir][`${nr},${nc}`]) cur = [nr, nc];
  };
  const typeLetter = (ch) => {
    const [r, c] = cur;
    letters[r][c] = ch; wrong.delete(`${r},${c}`); save();
    advance(1); paint();
  };
  const backspace = () => {
    const [r, c] = cur;
    if (!letters[r][c]) advance(-1);
    const [r2, c2] = cur;
    letters[r2][c2] = ''; wrong.delete(`${r2},${c2}`); save(); paint();
  };
  const arrow = (dr, dc) => {
    let [r, c] = cur;
    do { r += dr; c += dc; } while (r >= 0 && r < rows && c >= 0 && c < cols && !isWhite(r, c));
    if (isWhite(r, c)) { cur = [r, c]; if (dc && entryAt.A[`${r},${c}`]) dir = 'A'; else if (dr && entryAt.D[`${r},${c}`]) dir = 'D'; paint(); }
  };

  // A hidden input summons the phone keyboard. It always holds a sentinel so Backspace is detectable.
  const SENT = '·';
  const kb = h('input.xkb', { type: 'text', value: SENT, autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: false, 'aria-label': 'Type crossword letters' });
  kb.addEventListener('input', () => {
    const v = kb.value; kb.value = SENT;
    const typed = v.split(SENT).join('').toUpperCase().replace(/[^A-Z]/g, '');
    if (!typed && !v.includes(SENT)) backspace();
    else for (const ch of typed) typeLetter(ch);
  });
  kb.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const arrows = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    if (arrows[e.key]) { e.preventDefault(); arrow(...arrows[e.key]); }
    else if (e.key === 'Backspace') { e.preventDefault(); backspace(); }
    else if (e.key === ' ') { e.preventDefault(); select(cur[0], cur[1], true); }
    else if (e.key === 'Enter') e.preventDefault();
  });

  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!isWhite(r, c)) { grid.append(h('div.xcell.blk')); continue; }
    const el = h('div.xcell', { onclick: () => select(r, c, true) },
      numAt[`${r},${c}`] ? h('span.xnum', numAt[`${r},${c}`]) : null, h('span.xl'));
    cellEls[`${r},${c}`] = el;
    grid.append(el);
  }

  const jump = (e, d) => { dir = d; cur = [e.r, e.c]; paint(); kb.focus({ preventScroll: true }); grid.scrollIntoView({ block: 'nearest' }); };
  function clueList(list, title, d) {
    return h('div.xcol', h('h4', title), h('ul', list.map(e => {
      const li = h('li', { onclick: d ? () => jump(e, d) : null }, h('b', e.n), ' ', e.clue);
      if (d) clueLists[d][e.n] = li;
      return li;
    })));
  }

  const left = maxChecks - (p.state.checks || 0);
  let confirming = false;
  const giveUpBtn = h('button.btn.secondary.small', { type: 'button', onclick: () => {
    if (!confirming) { confirming = true; giveUpBtn.textContent = 'Tap again to give up'; return; }
    ctx.submit({ giveUp: true });
  } }, 'Give up');

  const wrap = h('div.xw', kb, clueBar, grid,
    h('div.ccontrols',
      h('button.btn', { type: 'button', onclick: () => ctx.submit({ cells: letters.map(r => r.map(ch => ch || ' ').join('')) }) }, 'Check'),
      giveUpBtn),
    h('div.muted', { style: { fontSize: '.8rem', textAlign: 'center' } },
      `${left} ${left === 1 ? 'check' : 'checks'} left · tap a square to type · tap it again to switch across/down`,
      p.state.checks ? ` · last check: ${p.state.wrong.length} wrong, ${p.state.empty} empty` : ''),
    h('div.xclues', clueList(across, 'Across', 'A'), clueList(down, 'Down', 'D')));
  paint();
  return wrap;
}
