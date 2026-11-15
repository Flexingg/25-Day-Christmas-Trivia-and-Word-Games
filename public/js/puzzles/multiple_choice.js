import { h } from '../util.js';

export function render(p, ctx) {
  const done = p.status === 'done';
  return h('div.choices', p.data.choices.map((c, i) => {
    const cls = !done ? '' : i === p.reveal.answerIndex ? '.right' : i === p.state.picked ? '.wrong' : '';
    return h('button.choice' + cls, {
      disabled: done,
      onclick: () => ctx.submit({ choice: i }),
    }, String.fromCharCode(65 + i) + '.  ' + c);
  }));
}
