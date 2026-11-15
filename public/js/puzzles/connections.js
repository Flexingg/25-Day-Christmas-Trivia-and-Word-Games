import { h } from '../util.js';

export function render(p, ctx) {
  const done = p.status === 'done';
  const { groupSize, maxMistakes } = p.data;
  const groups = done ? p.reveal.groups : p.state.found;
  const foundWords = new Set(groups.flatMap(g => g.words));
  let remaining = p.data.words.filter(w => !foundWords.has(w));
  const selected = new Set();

  const wrap = h('div');
  const grid = h('div.cgrid', { style: { '--cols': groupSize } });
  const submitBtn = h('button.btn', { disabled: true, onclick: () => ctx.submit({ words: [...selected] }) }, 'Submit');

  const draw = () => {
    grid.replaceChildren();
    // found groups first (in the order found), then remaining tiles
    const foundLevels = p.state.found.map(g => g.level);
    const shown = done ? [...foundLevels.map(l => groups[l]), ...groups.filter(g => !foundLevels.includes(g.level))] : groups;
    for (const g of shown) {
      grid.append(h(`div.cgroup.l${g.level}`, h('b', g.name), g.words.join(', ')));
    }
    if (!done) {
      for (const w of remaining) {
        grid.append(h('button.ctile' + (selected.has(w) ? '.sel' : ''), {
          onclick: () => {
            if (selected.has(w)) selected.delete(w);
            else if (selected.size < groupSize) selected.add(w);
            draw();
          },
        }, w));
      }
    }
    submitBtn.disabled = selected.size !== groupSize;
  };
  draw();
  wrap.append(grid);

  if (!done) {
    wrap.append(
      h('div.mistakes', 'Mistakes left: ',
        Array.from({ length: maxMistakes }, (_, i) => h('i' + (i < p.state.mistakes ? '.used' : '')))),
      h('div.ccontrols',
        h('button.btn.secondary.small', { onclick: () => { remaining = remaining.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(v => v[1]); draw(); } }, 'Shuffle'),
        h('button.btn.secondary.small', { onclick: () => { selected.clear(); draw(); } }, 'Deselect'),
        submitBtn),
    );
  }
  return wrap;
}
