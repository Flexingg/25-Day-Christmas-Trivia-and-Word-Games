import { h, api, ApiError, toast, confetti } from './util.js';
import * as multiple_choice from './puzzles/multiple_choice.js';
import * as text_answer from './puzzles/text_answer.js';
import * as scramble from './puzzles/scramble.js';
import * as wordle from './puzzles/wordle.js';
import * as connections from './puzzles/connections.js';
import * as rebus from './puzzles/rebus.js';
import * as verse from './puzzles/verse.js';
import * as timeline from './puzzles/timeline.js';
import * as who_said_it from './puzzles/who_said_it.js';
import * as spelling_bee from './puzzles/spelling_bee.js';
import * as crossword from './puzzles/crossword.js';

const RENDERERS = { multiple_choice, text_answer, scramble, wordle, connections, rebus, verse, timeline, who_said_it, spelling_bee, crossword };
const TYPE_LABELS = {
  multiple_choice: 'Trivia', text_answer: 'Trivia', scramble: 'Scramble', wordle: 'Wordle', connections: 'Connections',
  rebus: 'Rebus', verse: 'Verse', timeline: 'Timeline', who_said_it: 'Who said it?', spelling_bee: 'Spelling Bee', crossword: 'Crossword',
};
const SECTION_ICONS = { main: '⭐', christmas: '🎄', faith: '✝️' };

const view = document.getElementById('view');
const headerRight = document.getElementById('header-right');

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

// ---------- snow ----------
(function snow() {
  const box = document.getElementById('snow');
  for (let i = 0; i < 40; i++) {
    box.append(h('span', {
      style: {
        left: Math.random() * 100 + 'vw',
        fontSize: (6 + Math.random() * 12) + 'px',
        animationDuration: (8 + Math.random() * 12) + 's',
        animationDelay: (-Math.random() * 20) + 's',
        opacity: String(.3 + Math.random() * .6),
      },
    }, '❄'));
  }
})();

// ---------- routing ----------
function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean);
  return { parts, preview: params.get('preview') === '1' };
}
const q = (preview) => (preview ? '?preview=1' : '');

async function route() {
  const { parts, preview } = parseHash();
  window.scrollTo(0, 0);
  headerRight.replaceChildren();
  try {
    if (parts[0] === 'p' && parts[1] && parts[2] === 'd' && parts[3]) await dayView(parts[1], Number(parts[3]), preview);
    else if (parts[0] === 'p' && parts[1]) await pathView(parts[1], preview);
    else await homeView();
  } catch (e) {
    if (e instanceof ApiError && e.body.needPin) return pinPrompt(parts[1]);
    if (e instanceof ApiError && e.body.locked) {
      view.replaceChildren(h('div.card.center', h('h2', '🎁 Not yet!'), h('p', e.message),
        h('a.btn', { href: `#/p/${parts[1]}${q(preview)}` }, 'Back to calendar')));
      return;
    }
    console.error(e);
    view.replaceChildren(h('div.card.center', h('h2', 'Uh oh 🎅'), h('p', e.message), h('a.btn', { href: '#/' }, 'Home')));
  }
}
window.addEventListener('hashchange', route);

function pinPrompt(slug) {
  const input = h('input', { type: 'password', inputmode: 'numeric', placeholder: 'PIN', style: { width: '100%', padding: '10px', borderRadius: '10px', border: '2px solid #e6dccb' } });
  const msg = h('div.feedback.bad');
  const submit = async () => {
    try {
      await api('POST', `/api/paths/${slug}/unlock`, { pin: input.value });
      bg.remove();
      route();
    } catch (e) { msg.textContent = e.message; }
  };
  input.addEventListener('keydown', e => e.key === 'Enter' && submit());
  const bg = h('div.modal-bg', h('div.modal',
    h('h3', '🔒 Enter your PIN'),
    h('p.muted', 'This calendar is PIN-protected so nobody else plays your puzzles.'),
    input, msg,
    h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } },
      h('button.btn', { onclick: submit }, 'Unlock'),
      h('a.btn.secondary', { href: '#/', onclick: () => bg.remove() }, 'Cancel'))));
  document.body.append(bg);
  view.replaceChildren();
  input.focus();
}

// ---------- home ----------
function daysUntil(fromIso, toIso) {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86400000);
}

async function homeView() {
  const meta = await api('GET', '/api/meta');
  const c = meta.calendar;
  const last = store.get('rc_last_path');
  const lastPath = meta.paths.find(p => p.slug === last);

  let status;
  if (c.unlockedThrough === 0) {
    const n = daysUntil(c.today, `${c.eventYear}-12-01`);
    status = h('p.countdown', `🎁 ${n} day${n === 1 ? '' : 's'} until the calendar opens on December 1st!`);
  } else if (c.today === `${c.eventYear}-12-25`) {
    status = h('p.countdown', '🎄 Merry Christmas! All 25 days are open. 🎄');
  } else if (c.unlockedThrough >= 25) {
    status = h('p.countdown', 'All 25 days are open — catch up on anything you missed!');
  } else {
    status = h('p.countdown', `Day ${c.unlockedThrough} is open! ${25 - c.unlockedThrough} to go until Christmas.`);
  }

  view.replaceChildren(
    c.dateOverridden ? h('div.banner', `🧪 Test mode: the admin has set "today" to ${c.today}.`) : null,
    h('div.hero',
      h('p', 'A 25-day Advent calendar of trivia & word games for the Randall family.'),
      status,
      lastPath ? h('p', h('a.pill.gold', { href: `#/p/${lastPath.slug}` }, `Continue as ${lastPath.name} →`)) : null,
      h('p', { style: { opacity: .75, fontSize: '.95rem' } }, 'Who’s playing?')),
    h('div.path-grid', meta.paths.map(p =>
      h('a.path-card', { href: `#/p/${p.slug}`, style: { '--c': p.color } },
        p.hasPin ? h('span.lock', '🔒') : null,
        h('div.emoji', p.emoji),
        h('h2', p.name),
        h('p', p.tagline),
        h('div.stats', h('span', `⭐ ${p.score} pts`), h('span', `📅 ${p.completeDays}/25 days`))))),
  );
}

// ---------- path (advent calendar) ----------
async function pathView(slug, preview) {
  const data = await api('GET', `/api/paths/${slug}${q(preview)}`);
  const p = data.path;
  if (!preview) store.set('rc_last_path', slug);
  document.documentElement.style.setProperty('--accent', p.color);
  headerRight.append(h('a.pill', { href: '#/' }, '👥 Switch player'));

  // shuffle door order deterministically so it feels like an advent calendar, keeping 25 last
  const order = Array.from({ length: 24 }, (_, i) => i + 1)
    .map(d => [(d * 13 + 5) % 24, d]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  order.push(25);

  view.replaceChildren(
    preview ? h('div.banner', '👀 Admin preview — everything is unlocked, drafts are shown, and progress is saved to a separate sandbox.') : null,
    h('div.path-head',
      h('div.emoji', p.emoji),
      h('div', h('h2', `${p.name}’s Advent Calendar`), h('p', `${p.tagline} · ⭐ ${data.score} pts · ${data.completeDays}/25 days complete`))),
    h('div.cal', order.map(n => {
      const d = data.days[n - 1];
      const pct = d.total ? Math.round(100 * d.done / d.total) : 0;
      const complete = d.total > 0 && d.done === d.total;
      if (!d.unlocked) {
        return h('div.door.locked', { title: `Opens December ${n}`, onclick: () => toast(`🔒 Day ${n} opens December ${n}!`) },
          h('span.num', n), h('span.sub', '🔒'));
      }
      return h(`a.door${complete ? '.complete' : ''}${n === data.unlockedThrough && !preview ? '.today' : ''}`,
        { href: `#/p/${slug}/d/${n}${q(preview)}`, style: { '--c': p.color }, title: d.title },
        h('span.num', n),
        h('span.sub', d.total ? `${d.done}/${d.total}` : 'soon'),
        d.total ? h('span.bar', h('i', { style: { width: pct + '%' } })) : null);
    })),
  );
}

// ---------- day ----------
async function dayView(slug, day, preview) {
  const data = await api('GET', `/api/paths/${slug}/days/${day}${q(preview)}`);
  document.documentElement.style.setProperty('--accent', data.path.color);
  headerRight.append(h('a.pill', { href: `#/p/${slug}${q(preview)}` }, '📅 Calendar'));

  const puzzles = data.puzzles;
  const bySection = {};
  for (const p of puzzles) (bySection[p.section] ||= []).push(p);

  const sectionTitle = (s) => s === 'main' ? `${data.path.name}’s Puzzles` : data.sections[s];

  const content = [];
  if (!puzzles.length) {
    content.push(h('div.card.center', h('p', '🎅 The elves are still wrapping today’s puzzles. Check back soon!')));
  }
  for (const s of Object.keys(data.sections)) {
    if (!bySection[s]) continue;
    content.push(h('h3.section-title', SECTION_ICONS[s] || '🎁', sectionTitle(s)));
    content.push(h('div.puzzles', bySection[s].map(p => puzzleCard(p, slug, preview, puzzles))));
  }

  view.replaceChildren(
    preview ? h('div.banner', '👀 Admin preview (sandbox progress, drafts shown).') : null,
    h('div.day-head',
      h('div.crumbs', `${data.path.emoji} ${data.path.name} · December ${day}`),
      h('h2', data.title),
      data.intro ? h('p', data.intro) : null),
    ...content,
    h('div.day-nav',
      day > 1 ? h('a.btn.secondary', { href: `#/p/${slug}/d/${day - 1}${q(preview)}` }, `← Day ${day - 1}`) : h('span'),
      day < data.unlockedThrough ? h('a.btn.secondary', { href: `#/p/${slug}/d/${day + 1}${q(preview)}` }, `Day ${day + 1} →`) : h('span')),
  );
}

function puzzleCard(initial, slug, preview, allOnDay) {
  const card = h('div.puzzle');
  let busy = false;

  const draw = (p, fb) => {
    const done = p.status === 'done';
    card.className = 'puzzle' + (done ? ` done ${p.correct ? 'right' : 'wrong'}` : '');
    const feedback = h('div.feedback' + (fb ? (fb.good ? '.good' : '.bad') : ''), fb?.msg || '');

    const ctx = {
      say(msg, good) { feedback.textContent = msg; feedback.className = 'feedback ' + (good ? 'good' : 'bad'); },
      async submit(submission) {
        if (busy) return false;
        busy = true;
        try {
          const res = await api('POST', `/api/paths/${slug}/puzzles/${encodeURIComponent(p.id)}/answer${q(preview)}`, { submission });
          Object.assign(p, res.puzzle);
          const idx = allOnDay.findIndex(x => x.id === p.id);
          if (idx >= 0) allOnDay[idx] = res.puzzle;
          draw(res.puzzle, { msg: res.feedback, good: res.correct || res.good || (res.puzzle.status !== 'done' && /^Yes/.test(res.feedback)) });
          if (res.puzzle.status === 'done' && res.correct) confettiSmall();
          if (allOnDay.every(x => x.status === 'done')) {
            setTimeout(() => { confetti(); toast('🎉 Day complete! See you tomorrow!', 3500); }, 400);
          }
          return true;
        } catch (e) {
          if (e instanceof ApiError && e.status < 500) ctx.say(e.message, false);
          else ctx.say('Couldn’t reach the North Pole. Try again?', false);
          return false; // rejected: the renderer keeps what the player typed
        } finally { busy = false; }
      },
    };

    const renderer = RENDERERS[p.type];
    card.replaceChildren(
      h('div.meta',
        h('span', TYPE_LABELS[p.type] || p.type, p.title ? ` · ${p.title}` : ''),
        h('span', p.draft ? h('span.badge.draft', 'DRAFT') : null, ' ',
          done ? (p.correct ? `✅ +${p.score}` : p.score ? `🔸 +${p.score}` : '❌ 0') : `${p.points} pt${p.points === 1 ? '' : 's'}`)),
      p.data.image ? h('img.pimg', { src: p.data.image, alt: '' }) : null,
      p.data.prompt ? h('p.prompt', p.data.prompt) : null,
      p.data.hint && !done ? h('p.hint', `💡 Hint: ${p.data.hint}`) : null,
      renderer ? renderer.render(p, ctx) : h('p', `Unknown puzzle type ${p.type}`),
      feedback,
      done ? revealBox(p) : null,
    );
  };
  draw(initial);
  return card;
}

function revealBox(p) {
  const r = p.reveal || {};
  const showAnswer = r.answer && !(p.type === 'multiple_choice' && p.correct) && !(p.type === 'scramble');
  if (!showAnswer && !r.explanation) return null;
  return h('div.reveal',
    showAnswer ? h('div', p.correct ? 'Answer: ' : 'The answer was: ', h('b', r.answer)) : null,
    r.explanation ? h('div', { style: { marginTop: showAnswer ? '6px' : 0 } }, r.explanation) : null);
}

function confettiSmall() {
  // quick sparkle without the full confetti storm
  toast('✨ Nice!', 1200);
}

route();
