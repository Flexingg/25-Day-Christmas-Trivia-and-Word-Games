import { h } from '../util.js';

export function render(p, ctx) {
  const done = p.status === 'done';

  if (done) {
    const picks = p.state.picks || [];
    return h('div.who-list', p.reveal.results.map((r, i) => h('div.who-q' + (r.right ? '.right' : '.wrong'),
      h('div.who-quote', `“${r.quote}”`),
      h('div.who-result', r.right ? `✅ ${r.who}` : `❌ You said ${picks[i] || '—'} — it was ${r.who}`))));
  }

  const picks = p.data.quotes.map(() => null);
  const submitBtn = h('button.btn', { disabled: true, onclick: () => ctx.submit({ picks }) }, 'Submit');
  const rows = p.data.quotes.map((quote, qi) => {
    const buttons = p.data.people.map(person => h('button.who-pick', {
      type: 'button',
      onclick: () => {
        picks[qi] = person;
        buttons.forEach(b => b.classList.toggle('sel', b.textContent === picks[qi]));
        submitBtn.disabled = picks.some(x => !x);
      },
    }, person));
    return h('div.who-q', h('div.who-quote', `“${quote}”`), h('div.who-picks', buttons));
  });

  return h('div', h('div.who-list', rows),
    h('div.ccontrols', submitBtn),
    h('div.muted', { style: { fontSize: '.8rem', textAlign: 'center' } }, 'One shot, so choose carefully!'));
}
