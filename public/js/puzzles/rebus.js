import { h } from '../util.js';
import { answerBox } from './text_answer.js';

export function render(p, ctx) {
  return h('div',
    h('div.rebus', p.data.rebus),
    answerBox(p, ctx, 'What does it spell?'),
  );
}
