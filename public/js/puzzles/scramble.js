import { h } from '../util.js';
import { answerBox } from './text_answer.js';

export function render(p, ctx) {
  return h('div',
    h('div.scrambled', p.status === 'done' ? p.reveal.answer : p.data.scrambled),
    answerBox(p, ctx, 'Unscrambled word…'),
  );
}
