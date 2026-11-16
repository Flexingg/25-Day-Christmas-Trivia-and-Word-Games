import { h } from '../util.js';

export function render(p, ctx) {
  const done = p.status === 'done';
  const history = p.state.attempts || [];
  const last = history[history.length - 1];

  const historyBox = history.length
    ? h('div.tl-history', history.map(a => h('div', a.result.map(ok => ok ? '🟩' : '🟥').join(''))))
    : null;

  if (done) {
    return h('div',
      h('ol.tl-list.final', p.reveal.items.map(it => h('li.tl-row.locked',
        h('span.tl-label', it.label), it.detail ? h('span.tl-detail', it.detail) : null))),
      historyBox);
  }

  // Start from the player's last attempt; spots they got right are locked (Wordle style)
  let order = last ? last.order.slice() : p.data.order.slice();
  const locked = last ? last.result.slice() : order.map(() => false);
  const list = h('ol.tl-list');

  // swap with the nearest unlocked neighbour in that direction
  const move = (i, dir) => {
    let j = i + dir;
    while (j >= 0 && j < order.length && locked[j]) j += dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    draw();
  };
  const canMove = (i, dir) => {
    let j = i + dir;
    while (j >= 0 && j < order.length && locked[j]) j += dir;
    return j >= 0 && j < order.length;
  };

  const draw = () => {
    list.replaceChildren(order.map((label, i) => {
      const wrongBefore = last && !last.result[i] && last.order[i] === label;
      return h('li.tl-row' + (locked[i] ? '.locked' : wrongBefore ? '.bad' : ''),
        h('span.tl-num', i + 1),
        h('span.tl-label', label),
        locked[i] ? h('span.tl-lock', '🔒') : h('span.tl-btns',
          h('button.tl-btn', { type: 'button', 'aria-label': `Move ${label} up`, disabled: !canMove(i, -1), onclick: () => move(i, -1) }, '▲'),
          h('button.tl-btn', { type: 'button', 'aria-label': `Move ${label} down`, disabled: !canMove(i, 1), onclick: () => move(i, 1) }, '▼')));
    }));
  };
  draw();

  const left = p.data.attempts - history.length;
  return h('div', list,
    h('div.ccontrols', h('button.btn', { onclick: () => ctx.submit({ order }) }, 'Check order')),
    h('div.muted', { style: { fontSize: '.8rem', textAlign: 'center' } }, `${left} ${left === 1 ? 'try' : 'tries'} left`),
    historyBox);
}
