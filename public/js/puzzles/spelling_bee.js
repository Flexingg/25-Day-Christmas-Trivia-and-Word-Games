import { h } from '../util.js';

let active = null; // the bee that receives physical keyboard input
const shuffled = new Map(); // puzzle id -> outer letter order, so a redraw doesn't undo the player's shuffle

document.addEventListener('keydown', (e) => {
  if (!active || !active.el.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (e.key === 'Enter') { e.preventDefault(); active.press('ENTER'); }
  else if (e.key === 'Backspace') { e.preventDefault(); active.press('DEL'); }
  else if (/^[a-z]$/i.test(e.key)) active.press(e.key.toUpperCase());
});

// hexagon positions (percent of the hive box) around the centre one
const SPOTS = [[50, 26], [71, 38], [71, 62], [50, 74], [29, 62], [29, 38]];

export function render(p, ctx) {
  const { center, minLength, target, total } = p.data;
  const done = p.status === 'done';
  const found = p.state.found || [];
  const isPangram = (w) => [...center + p.data.outer.join('')].every(ch => w.includes(ch));

  const progress = h('div.bee-progress',
    h('div.bee-count', `${found.length} / ${target}`, h('span.muted', ` words needed · ${total} possible`)),
    h('div.bee-bar', h('i', { style: { width: Math.min(100, Math.round(100 * found.length / target)) + '%' } })));
  const foundBox = h('div.bee-found', found.map(w => h('span.chip' + (isPangram(w) ? '.pangram' : ''), w)));

  if (done) {
    const got = new Set(found);
    return h('div', progress,
      h('div.bee-found', p.reveal.words.map(w => h('span.chip' + (got.has(w) ? '' : '.missed') + (isPangram(w) ? '.pangram' : ''), w))),
      h('div.muted', { style: { fontSize: '.8rem', marginTop: '6px' } }, 'Gold = pangram (uses all 7 letters). Faded words are ones you missed.'));
  }

  let outer = shuffled.get(p.id) || p.data.outer.slice();
  let current = '';
  const display = h('div.bee-word');
  const hive = h('div.bee-hive');

  const paint = () => {
    display.replaceChildren(current
      ? [...current].map(ch => h('span' + (ch === center ? '.mid' : ''), ch))
      : h('span.placeholder', `Tap letters (${minLength}+ letters)`));
  };
  const drawHive = () => {
    hive.replaceChildren(
      h('button.hex.center', { type: 'button', style: { left: '50%', top: '50%' }, onclick: () => self.press(center) }, center),
      outer.map((ch, i) => h('button.hex', { type: 'button', style: { left: SPOTS[i][0] + '%', top: SPOTS[i][1] + '%' }, onclick: () => self.press(ch) }, ch)));
  };

  const self = {
    id: p.id,
    el: hive,
    press(k) {
      if (k === 'ENTER') {
        if (!current) return ctx.say('Spell a word first!', false);
        const w = current; current = ''; paint();
        return ctx.submit({ word: w });
      }
      if (k === 'DEL') current = current.slice(0, -1);
      else if ((k === center || outer.includes(k)) && current.length < 20) current += k;
      paint();
    },
  };
  if (!active || !active.el.isConnected || active.id === p.id) active = self;
  drawHive(); paint();

  let confirming = false;
  const finishBtn = h('button.btn.secondary.small', { type: 'button', onclick: () => {
    if (!confirming) { confirming = true; finishBtn.textContent = `Tap again to finish with ${found.length}`; return; }
    ctx.submit({ finish: true });
  } }, 'I’m done');

  return h('div.bee', { onpointerdown: () => { active = self; } },
    progress, foundBox, display, hive,
    h('div.ccontrols',
      h('button.btn.secondary', { type: 'button', onclick: () => self.press('DEL') }, 'Delete'),
      h('button.btn.secondary', { type: 'button', 'aria-label': 'Shuffle outer letters', onclick: () => {
        outer = outer.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(v => v[1]);
        shuffled.set(p.id, outer); drawHive();
      } }, '🔀'),
      h('button.btn', { type: 'button', onclick: () => self.press('ENTER') }, 'Enter')),
    h('div.ccontrols', finishBtn));
}
