import { h, api, ApiError, toast } from './util.js';
import { TYPE_FIELDS, answerSummary, promptSummary } from './puzzle-types.js';

const view = document.getElementById('admin-view');
const tabsEl = document.getElementById('tabs');
const SHARED = '_shared';
const SECTION_ICONS = { main: '⭐', christmas: '🎄', faith: '✝️' };

let TYPES = {};      // from /api/admin/types
let overview = null; // from /api/admin/overview

// ---------- boot / auth ----------
async function boot() {
  const me = await api('GET', '/api/admin/me');
  if (!me.isAdmin) return loginView();
  document.getElementById('logout').classList.remove('hidden');
  document.getElementById('logout').onclick = async () => { await api('POST', '/api/admin/logout'); location.reload(); };
  TYPES = await api('GET', '/api/admin/types');
  if (me.defaultPassword) toast('⚠️ ADMIN_PASSWORD is still the default "changeme" — set it in docker-compose!', 6000);
  window.addEventListener('hashchange', route);
  route();
}

function loginView() {
  const pw = h('input.ainput', { type: 'password', placeholder: 'Admin password' });
  const err = h('div');
  const go = async () => {
    try { await api('POST', '/api/admin/login', { password: pw.value }); location.reload(); }
    catch (e) { err.replaceChildren(h('div.errors', e.message)); }
  };
  pw.addEventListener('keydown', e => e.key === 'Enter' && go());
  view.replaceChildren(h('div.panel.login', h('h2', '🎅 Admin login'), pw, err, h('button.btn', { style: { marginTop: '10px' }, onclick: go }, 'Log in')));
  pw.focus();
}

// ---------- routing ----------
const TABS = [['calendar', '📅 Calendar'], ['review', '🔎 Review'], ['progress', '🏆 Progress'], ['settings', '⚙️ Settings']];

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const tab = parts[0] || 'calendar';
  tabsEl.replaceChildren(...TABS.map(([k, label]) =>
    h('a' + ((tab === k || (tab === 'day' && k === 'calendar')) ? '.on' : ''), { href: `#/${k}` }, label)));
  try {
    overview = await api('GET', '/api/admin/overview');
    if (tab === 'day') await dayView(parts[1], Number(parts[2]));
    else if (tab === 'review') await reviewView(parts[1]);
    else if (tab === 'progress') await progressView();
    else if (tab === 'settings') await settingsView();
    else await calendarView(parts[1]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return loginView();
    console.error(e);
    view.replaceChildren(h('div.errors', e.message));
  }
}

const pathInfo = (slug) => overview.paths.find(p => p.slug === slug);

function pathChips(current, hrefFor) {
  return h('div.chips', overview.paths.map(p =>
    h('a.chip' + (p.slug === current ? '.on' : ''), { href: hrefFor(p.slug), style: { '--c': p.color } }, `${p.emoji} ${p.name}`)));
}

function previewHref(slug, day) {
  const target = slug === SHARED ? overview.paths.find(p => p.slug !== SHARED)?.slug : slug;
  return `/#/p/${target}${day ? `/d/${day}` : ''}?preview=1`;
}

// ---------- calendar (per path overview) ----------
async function calendarView(slug) {
  slug = slug || overview.paths.find(p => p.slug !== SHARED)?.slug || SHARED;
  const p = pathInfo(slug);
  if (!p) throw new Error('Unknown path');
  const unlocked = overview.calendar.unlockedThrough;
  const totalReady = p.days.reduce((a, d) => a + d.ready, 0);
  const emptyDays = p.days.filter(d => d.ready === 0).length;

  view.replaceChildren(
    pathChips(slug, s => `#/calendar/${s}`),
    h('div.panel',
      h('div.row',
        h('h2', { style: { margin: 0 } }, `${p.emoji} ${p.name}`),
        h('span.spacer'),
        h('a.btn.secondary.small', { href: `#/review/${slug}` }, '🔎 Review all'),
        h('a.btn.small', { href: previewHref(slug), target: '_blank' }, '👀 Preview as player')),
      h('p.muted', p.slug === SHARED
        ? 'Puzzles here appear on EVERY path for that day — use this for the general Christmas and Bible/Presbyterian bonus questions.'
        : p.tagline),
      h('p', `${totalReady} ready puzzles · ${emptyDays} days with nothing yet · Today: ${overview.calendar.today} (days 1–${unlocked} unlocked for players)`),
      p.slug !== SHARED ? pathSettingsForm(p) : null),
    h('div.dgrid', p.days.map(d =>
      h('a.dcell' + (d.ready + d.draft === 0 ? '.empty' : '') + (d.day <= unlocked ? '.unlocked' : ''),
        { href: `#/day/${slug}/${d.day}`, style: { '--c': p.color } },
        h('div.n', `Dec ${d.day}`),
        h('div.t', d.title || ' '),
        h('div.c',
          ...Object.entries(d.bySection).filter(([, n]) => n).map(([s, n]) => h('span', `${SECTION_ICONS[s]}${n}`)),
          d.draft ? h('span.badge.draft', `${d.draft} draft`) : null,
          d.ready + d.draft === 0 ? h('span.muted', 'empty') : null)))),
  );
}

function pathSettingsForm(p) {
  const det = h('details', h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, 'Path settings (name, colors, PIN)'));
  const loadAndRender = async () => {
    const full = await api('GET', `/api/admin/paths/${p.slug}`);
    const f = {};
    const field = (key, label, attrs = {}) => h('label.f' + (attrs.wide ? '.wide' : ''), label,
      f[key] = h(attrs.textarea ? 'textarea' : 'input', { type: attrs.type || 'text', value: full[key] ?? '' }));
    const msg = h('div');
    det.append(h('div.form-grid', { style: { marginTop: '10px' } },
      field('name', 'Name'), field('emoji', 'Emoji'), field('color', 'Color', { type: 'color' }), field('sort', 'Sort order', { type: 'number' }),
      field('pin', 'PIN (blank = no PIN)'), field('tagline', 'Tagline', { wide: true }), field('description', 'Description', { wide: true, textarea: true })),
    h('div.row', { style: { marginTop: '10px' } }, h('button.btn.small', {
      onclick: async () => {
        const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
        await api('PUT', `/api/admin/paths/${p.slug}`, body);
        msg.replaceChildren(h('div.ok', 'Saved.'));
      },
    }, 'Save path settings')), msg);
  };
  det.addEventListener('toggle', () => { if (det.open && det.children.length === 1) loadAndRender(); });
  return det;
}

// ---------- day editor ----------
async function dayView(slug, day) {
  const p = pathInfo(slug);
  const data = await api('GET', `/api/admin/paths/${slug}/days/${day}`);
  const title = h('input', { value: data.title || '', placeholder: `Day ${day}` });
  const intro = h('textarea', { placeholder: 'Optional intro shown at the top of the day' }, data.intro || '');
  const saveMsg = h('span.muted');

  const sections = Object.keys(data.sections);
  const sectionBlocks = sections.map(s => {
    const list = data.puzzles.filter(x => x.section === s);
    const typeSel = h('select.ainput', { style: { width: 'auto' } },
      Object.entries(TYPES).map(([k, t]) => h('option', { value: k }, t.label)));
    return h('div',
      h('div.sec-head', h('h3', `${SECTION_ICONS[s]} ${s === 'main' ? `${p.name}’s puzzles` : data.sections[s]}`),
        h('span.muted', `(${list.length})`), h('span.spacer'),
        typeSel,
        h('button.btn.small', { onclick: () => openEditor({ path: slug, day, section: s, type: typeSel.value }) }, '+ Add')),
      list.length ? h('div.plist', list.map((pz, i) => puzzleRow(pz, list, i, slug, day))) : h('p.muted', 'Nothing here yet.'));
  });

  const shared = data.sharedPuzzles.length
    ? h('div.panel', h('h3', '🎁 Shared bonus puzzles also on this day'),
      h('p.muted', 'These come from the "Everyone" path and appear for every player.'),
      h('div.plist', data.sharedPuzzles.map(pz => h('div.prow' + (pz.status === 'draft' ? '.draft' : ''),
        h('div', h('div.m', `${SECTION_ICONS[pz.section]} ${TYPES[pz.type]?.label || pz.type}`), h('div.q', promptSummary(pz)), h('div.a', '✔ ' + answerSummary(pz))),
        h('div.actions', h('a.iconbtn', { href: `#/day/${SHARED}/${day}` }, 'Edit in Shared →'))))))
    : null;

  view.replaceChildren(
    h('div.row',
      h('a.btn.secondary.small', { href: `#/calendar/${slug}` }, `← ${p.emoji} ${p.name}`),
      h('h2', { style: { margin: 0 } }, `December ${day}`),
      h('span.spacer'),
      day > 1 ? h('a.iconbtn', { href: `#/day/${slug}/${day - 1}` }, `← Dec ${day - 1}`) : null,
      day < 25 ? h('a.iconbtn', { href: `#/day/${slug}/${day + 1}` }, `Dec ${day + 1} →`) : null,
      h('a.btn.small', { href: previewHref(slug, day), target: '_blank' }, '👀 Preview')),
    h('div.panel', { style: { marginTop: '12px' } },
      h('div.form-grid', h('label.f', 'Day title', title), h('label.f.wide', 'Intro', intro)),
      h('div.row', { style: { marginTop: '8px' } }, h('button.btn.small', {
        onclick: async () => {
          await api('PUT', `/api/admin/paths/${slug}/days/${day}`, { title: title.value, intro: intro.value });
          saveMsg.textContent = 'Saved ✓';
        },
      }, 'Save title/intro'), saveMsg)),
    h('div.panel', ...sectionBlocks),
    shared,
  );
}

function puzzleRow(pz, list, i, slug, day) {
  const move = async (dir) => {
    const ids = list.map(x => x.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api('POST', '/api/admin/puzzles/reorder', { ids });
    route();
  };
  return h('div.prow' + (pz.status === 'draft' ? '.draft' : ''),
    h('div',
      h('div.m', `${TYPES[pz.type]?.label || pz.type} · ${pz.points} pt · ${pz.id}`, pz.status === 'draft' ? ' · ' : '', pz.status === 'draft' ? h('span.badge.draft', 'DRAFT') : null),
      h('div.q', promptSummary(pz)),
      h('div.a', '✔ ' + answerSummary(pz))),
    h('div.actions',
      h('button.iconbtn', { title: 'Move up', onclick: () => move(-1) }, '↑'),
      h('button.iconbtn', { title: 'Move down', onclick: () => move(1) }, '↓'),
      h('button.iconbtn', { onclick: () => openEditor({ ...pz, path: slug, day }) }, '✏️ Edit'),
      h('button.iconbtn', {
        title: 'Toggle draft/ready',
        onclick: async () => {
          try { await api('PUT', `/api/admin/puzzles/${encodeURIComponent(pz.id)}`, { status: pz.status === 'draft' ? 'ready' : 'draft' }); route(); }
          catch (e) { toast(e.message, 4000); }
        },
      }, pz.status === 'draft' ? '✅ Mark ready' : '📝 To draft'),
      h('button.iconbtn', {
        title: 'Duplicate',
        onclick: () => { const copy = { ...pz, path: slug, day, status: 'draft' }; delete copy.id; delete copy.edited; openEditor(copy, true); },
      }, '⧉'),
      h('button.iconbtn.danger', {
        onclick: async () => {
          if (!confirm(`Delete "${promptSummary(pz)}"? This also clears anyone's progress on it.`)) return;
          await api('DELETE', `/api/admin/puzzles/${encodeURIComponent(pz.id)}`);
          route();
        },
      }, '🗑')));
}

// ---------- puzzle editor ----------
function openEditor(initial, forceNew = false) {
  const isNew = forceNew || !initial.id;
  const type0 = initial.type;
  let model = isNew && !initial.prompt && !initial.word && !initial.groups && !initial.answer
    ? { ...structuredClone(TYPES[type0].defaults), ...initial, points: initial.points ?? TYPES[type0].points, status: initial.status || 'ready' }
    : structuredClone(initial);
  delete model.edited;
  let mode = 'form';

  const bg = h('div.amodal-bg');
  const box = h('div.amodal');
  bg.append(box);
  const close = () => bg.remove();
  bg.addEventListener('mousedown', e => { if (e.target === bg && confirm('Close without saving?')) close(); });

  const errors = h('div');
  const body = h('div');

  const common = () => {
    const typeSel = h('select', Object.entries(TYPES).map(([k, t]) => h('option', { value: k, selected: k === model.type }, t.label)));
    typeSel.onchange = () => {
      if (!confirm('Switching type resets the type-specific fields. Continue?')) { typeSel.value = model.type; return; }
      const keep = { id: model.id, path: model.path, day: model.day, section: model.section, title: model.title, status: model.status };
      model = { ...structuredClone(TYPES[typeSel.value].defaults), ...keep, type: typeSel.value, points: TYPES[typeSel.value].points, prompt: model.prompt || TYPES[typeSel.value].defaults.prompt };
      draw();
    };
    const sectionSel = h('select', ['main', 'christmas', 'faith'].map(s => h('option', { value: s, selected: s === model.section }, s)));
    sectionSel.onchange = () => { model.section = sectionSel.value; };
    const statusSel = h('select', ['ready', 'draft'].map(s => h('option', { value: s, selected: s === model.status }, s)));
    statusSel.onchange = () => { model.status = statusSel.value; };
    const titleIn = h('input', { value: model.title || '', placeholder: 'optional label' });
    titleIn.oninput = () => { model.title = titleIn.value; };
    const ptsIn = h('input', { type: 'number', min: 0, value: model.points ?? 1 });
    ptsIn.oninput = () => { model.points = Number(ptsIn.value); };
    const idIn = h('input', { value: model.id || '', placeholder: 'auto', disabled: !isNew });
    idIn.oninput = () => { model.id = idIn.value.trim(); };
    return h('div.form-grid',
      h('label.f', 'Type', typeSel), h('label.f', 'Section', sectionSel), h('label.f', 'Status', statusSel),
      h('label.f', 'Points', ptsIn), h('label.f', 'Short title', titleIn), h('label.f', 'ID', idIn));
  };

  const draw = () => {
    errors.replaceChildren();
    if (mode === 'form') {
      body.replaceChildren(common(), h('hr', { style: { border: 0, borderTop: '1px solid #eee4d3', margin: '14px 0' } }),
        h('div.form-grid', (TYPE_FIELDS[model.type] || []).map(f => fieldEditor(f, model))));
    } else {
      const ta = h('textarea.json', JSON.stringify(stripMeta(model), null, 2));
      ta.oninput = () => {
        try { const parsed = JSON.parse(ta.value); model = { ...parsed, path: model.path, day: model.day }; errors.replaceChildren(); }
        catch (e) { errors.replaceChildren(h('div.errors', 'JSON error: ' + e.message)); }
      };
      body.replaceChildren(h('p.muted', 'Edit the raw puzzle JSON (same format as the content/ files).'), ta);
    }
  };

  const tabs = h('div.tabs2',
    h('button.on', { onclick: e => { mode = 'form'; setTab(e.target); draw(); } }, 'Form'),
    h('button', { onclick: e => { mode = 'json'; setTab(e.target); draw(); } }, 'Raw JSON'));
  const setTab = (btn) => { [...tabs.children].forEach(b => b.classList.toggle('on', b === btn)); };

  const save = async (andClose) => {
    try {
      const payload = { ...model };
      let res;
      if (isNew) {
        res = await api('POST', '/api/admin/puzzles', payload);
        model.id = res.id;
      } else {
        res = await api('PUT', `/api/admin/puzzles/${encodeURIComponent(model.id)}`, stripMeta(payload));
      }
      if (res.problems?.length) {
        errors.replaceChildren(h('div.errors', 'Saved as draft, but not ready yet: ' + res.problems.join(' ')));
        if (andClose) { setTimeout(() => { close(); route(); }, 1200); }
        return;
      }
      toast('Saved ✓');
      if (andClose) { close(); route(); } else if (isNew) { close(); route(); }
    } catch (e) {
      errors.replaceChildren(h('div.errors', e.message + (e.body?.problems ? '' : ''), h('div.muted', 'Tip: set Status to "draft" to save an unfinished puzzle.')));
    }
  };

  box.append(
    h('div.row', h('h3', { style: { margin: 0 } }, isNew ? 'New puzzle' : `Edit ${model.id}`), h('span.spacer'), tabs),
    h('p.muted', `${pathInfo(model.path)?.name || model.path} · December ${model.day}`),
    body, errors,
    h('div.row', { style: { marginTop: '14px' } },
      h('button.btn', { onclick: () => save(true) }, 'Save & close'),
      !isNew ? h('button.btn.secondary', { onclick: () => save(false) }, 'Save') : null,
      h('span.spacer'),
      h('button.btn.secondary', { onclick: close }, 'Cancel')),
  );
  draw();
  document.body.append(bg);
}

function stripMeta(m) {
  const c = { ...m };
  delete c.path; delete c.day; delete c.edited; delete c.updated_at;
  return c;
}

function fieldEditor(f, model) {
  const lab = (...kids) => h('label.f' + (['textarea', 'choices', 'groups', 'list', 'image'].includes(f.kind) || f.wide ? '.wide' : ''), f.label, ...kids);
  switch (f.kind) {
    case 'text': {
      const el = h('input', { value: model[f.key] ?? '' });
      el.oninput = () => { model[f.key] = f.upper ? el.value.toUpperCase() : el.value; if (f.upper) el.value = model[f.key]; };
      return lab(el);
    }
    case 'textarea': {
      const el = h('textarea', model[f.key] ?? '');
      el.oninput = () => { model[f.key] = el.value; };
      return lab(el);
    }
    case 'number': {
      const el = h('input', { type: 'number', min: f.min, max: f.max, value: model[f.key] ?? '' });
      el.oninput = () => { model[f.key] = el.value === '' ? undefined : Number(el.value); };
      return lab(el);
    }
    case 'list': {
      const el = h('textarea', (model[f.key] || []).join('\n'));
      el.oninput = () => { model[f.key] = el.value.split('\n').map(s => s.trim()).filter(Boolean); };
      return lab(el);
    }
    case 'image': {
      const url = h('input', { value: model[f.key] || '', placeholder: 'https://… or upload →' });
      const img = h('img', { style: { maxHeight: '120px', borderRadius: '8px', display: model[f.key] ? 'block' : 'none', marginTop: '6px' }, src: model[f.key] || '' });
      url.oninput = () => { model[f.key] = url.value; img.src = url.value; img.style.display = url.value ? 'block' : 'none'; };
      const file = h('input', { type: 'file', accept: 'image/*' });
      file.onchange = async () => {
        const fl = file.files[0]; if (!fl) return;
        const dataBase64 = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(fl); });
        try {
          const res = await api('POST', '/api/admin/upload', { filename: fl.name, dataBase64 });
          url.value = res.url; url.oninput();
        } catch (e) { toast(e.message); }
      };
      return lab(h('div.row', url, file), img);
    }
    case 'choices': {
      model.choices = model.choices || [];
      const wrap = h('div');
      const draw = () => {
        wrap.replaceChildren(...model.choices.map((c, i) => {
          const radio = h('input', { type: 'radio', name: 'correct', checked: Number(model.answer) === i, title: 'Correct answer' });
          radio.onchange = () => { model.answer = i; };
          const txt = h('input', { type: 'text', value: c, placeholder: `Choice ${String.fromCharCode(65 + i)}` });
          txt.oninput = () => { model.choices[i] = txt.value; };
          const del = h('button.iconbtn.danger', { type: 'button', onclick: () => {
            model.choices.splice(i, 1);
            if (Number(model.answer) >= model.choices.length) model.answer = 0;
            else if (Number(model.answer) > i) model.answer--;
            draw();
          } }, '✕');
          return h('div.choice-row', radio, txt, del);
        }), h('button.iconbtn', { type: 'button', onclick: () => { model.choices.push(''); draw(); } }, '+ Add choice'));
      };
      draw();
      return lab(wrap);
    }
    case 'groups': {
      model.groups = model.groups || [];
      const wrap = h('div');
      const colors = ['#f7da6b', '#a0c35a', '#b0c4ef', '#ba81c5', '#f0a37e', '#8fd3c8'];
      const draw = () => {
        wrap.replaceChildren(...model.groups.map((g, gi) => {
          const name = h('input.ainput', { value: g.name || '', placeholder: 'Group name / connection' });
          name.oninput = () => { g.name = name.value; };
          return h('div.group-box', { style: { borderLeft: `8px solid ${colors[gi % colors.length]}` } },
            h('div.row', h('b', `Group ${gi + 1}`), name,
              h('button.iconbtn.danger', { type: 'button', onclick: () => { model.groups.splice(gi, 1); draw(); } }, '✕')),
            h('div.words', (g.words || []).map((w, wi) => {
              const inp = h('input.ainput', { value: w, placeholder: `Word ${wi + 1}` });
              inp.oninput = () => { g.words[wi] = inp.value.toUpperCase(); inp.value = g.words[wi]; };
              return inp;
            })));
        }),
        h('div.row',
          h('button.iconbtn', { type: 'button', onclick: () => { const size = model.groups[0]?.words?.length || 4; model.groups.push({ name: '', words: Array(size).fill('') }); draw(); } }, '+ Add group'),
          h('button.iconbtn', { type: 'button', onclick: () => { model.groups.forEach(g => g.words.push('')); draw(); } }, '+ word per group'),
          h('button.iconbtn', { type: 'button', onclick: () => { model.groups.forEach(g => g.words.length > 2 && g.words.pop()); draw(); } }, '− word per group')));
      };
      draw();
      return lab(wrap);
    }
    default:
      return h('div', `Unknown field kind ${f.kind}`);
  }
}

// ---------- review table ----------
async function reviewView(slug) {
  slug = slug || overview.paths.find(p => p.slug !== SHARED)?.slug;
  const rows = await api('GET', `/api/admin/review/${slug}`);
  const search = h('input.ainput', { placeholder: 'Search questions & answers…', style: { maxWidth: '320px' } });
  const statusSel = h('select.ainput', { style: { width: 'auto' } }, ['all', 'ready', 'draft'].map(s => h('option', { value: s }, s)));
  const sectionSel = h('select.ainput', { style: { width: 'auto' } }, ['all', 'main', 'christmas', 'faith'].map(s => h('option', { value: s }, s)));
  const tbody = h('tbody');
  const count = h('span.muted');

  const draw = () => {
    const qv = search.value.toLowerCase();
    const filtered = rows.filter(r =>
      (statusSel.value === 'all' || r.status === statusSel.value) &&
      (sectionSel.value === 'all' || r.section === sectionSel.value) &&
      (!qv || JSON.stringify(r).toLowerCase().includes(qv)));
    count.textContent = `${filtered.length} of ${rows.length} puzzles`;
    tbody.replaceChildren(...filtered.map(r => h('tr', { onclick: () => openEditor({ ...r, path: slug }) },
      h('td', r.day), h('td', SECTION_ICONS[r.section] + ' ' + r.section), h('td', TYPES[r.type]?.label || r.type),
      h('td', r.status === 'draft' ? h('span.badge.draft', 'draft') : 'ready'),
      h('td', promptSummary(r), r.type === 'multiple_choice' ? h('div.muted', (r.choices || []).join(' · ')) : null),
      h('td.ans', answerSummary(r)),
      h('td.muted', r.explanation || ''))));
  };
  [search, statusSel, sectionSel].forEach(el => el.addEventListener('input', draw));

  view.replaceChildren(
    pathChips(slug, s => `#/review/${s}`),
    h('div.row', { style: { marginBottom: '10px' } }, search, statusSel, sectionSel, count),
    h('table.review', h('thead', h('tr', ['Day', 'Section', 'Type', 'Status', 'Question', 'Answer', 'Explanation'].map(t => h('th', t)))), tbody),
  );
  draw();
}

// ---------- progress ----------
async function progressView() {
  const players = await api('GET', '/api/admin/progress');
  view.replaceChildren(
    h('h2', '🏆 Family progress'),
    ...players.map(p => h('div.panel',
      h('div.row',
        h('h3', { style: { margin: 0 } }, `${p.emoji} ${p.name}`),
        h('span', `⭐ ${p.score} pts`), h('span', `📅 ${p.completeDays}/25 days complete`),
        h('span.muted', p.lastActivity ? `last played ${new Date(p.lastActivity).toLocaleString()}` : 'not started'),
        h('span.spacer'),
        h('button.iconbtn', { onclick: () => resetProgress(p.slug, null, true) }, 'Reset preview sandbox'),
        h('button.iconbtn.danger', { onclick: () => resetProgress(p.slug) }, 'Reset ALL progress')),
      h('div.mini', p.days.map(d => h('i' + (d.total && d.done === d.total ? '.full' : d.done ? '.part' : ''), {
        title: `Dec ${d.day}: ${d.done}/${d.total} done, ${d.score}/${d.possible} pts (click to reset this day)`,
        style: { cursor: d.done ? 'pointer' : 'default' },
        onclick: () => d.done && resetProgress(p.slug, d.day),
      }))))),
  );
}

async function resetProgress(slug, day, preview = false) {
  const what = preview ? `the admin preview sandbox for ${slug}` : day ? `${slug}'s progress on Dec ${day}` : `ALL of ${slug}'s progress`;
  if (!confirm(`Reset ${what}? This can't be undone.`)) return;
  const qs = new URLSearchParams({ ...(day ? { day } : {}), ...(preview ? { preview: 1 } : {}) });
  await api('DELETE', `/api/admin/progress/${slug}?${qs}`);
  toast('Reset ✓');
  route();
}

// ---------- settings ----------
async function settingsView() {
  const s = await api('GET', '/api/admin/settings');
  const year = h('input', { type: 'number', value: s.event_year || '', placeholder: String(s.calendar.eventYear) });
  const date = h('input', { type: 'date', value: s.date_override || '' });
  const msg = h('div');
  const syncMsg = h('div');
  const force = h('input', { type: 'checkbox' });
  const importFile = h('input', { type: 'file', accept: 'application/json' });
  const importForce = h('input', { type: 'checkbox' });
  const c = s.calendar;

  const statsText = (r) => `Added ${r.added}, updated ${r.updated}, skipped ${r.skippedEdited} edited in admin.` + (r.errors.length ? ` Errors: ${r.errors.join('; ')}` : '');

  view.replaceChildren(
    h('h2', '⚙️ Settings'),
    h('div.panel',
      h('h3', 'Calendar'),
      h('p', `Today is ${c.today} (${c.timeZone})${c.dateOverridden ? ' — OVERRIDDEN' : ''}. Event year ${c.eventYear}. Players can open days 1–${c.unlockedThrough}.`),
      h('div.form-grid',
        h('label.f', 'Event year (blank = current year)', year),
        h('label.f', 'Pretend today is… (testing only — blank = real date)', date)),
      h('div.row', { style: { marginTop: '10px' } },
        h('button.btn.small', {
          onclick: async () => {
            try {
              const r = await api('PUT', '/api/admin/settings', { event_year: year.value, date_override: date.value });
              msg.replaceChildren(h('div.ok', `Saved. Players can now open days 1–${r.calendar.unlockedThrough}.`));
            } catch (e) { msg.replaceChildren(h('div.errors', e.message)); }
          },
        }, 'Save'),
        h('button.btn.secondary.small', { onclick: () => { date.value = ''; } }, 'Clear date override')),
      msg,
      h('p.muted', 'The date override affects everyone — remember to clear it before December 1st! The time zone comes from the TZ environment variable.')),
    h('div.panel',
      h('h3', 'Content'),
      h('p', 'Puzzles live in the database (edited here). The repo’s content/ folder holds the "source" JSON. Use these to move content between them.'),
      h('div.row',
        h('button.btn.small', {
          onclick: async () => {
            try { const r = await api('POST', '/api/admin/sync-content', { force: force.checked }); syncMsg.replaceChildren(h('div.ok', statsText(r))); }
            catch (e) { syncMsg.replaceChildren(h('div.errors', e.message)); }
          },
        }, '⬇️ Sync from repo content/ folder'),
        h('label.row', force, 'Overwrite puzzles I edited in admin')),
      syncMsg,
      h('p.muted', 'Sync adds new puzzles and updates existing ones by ID. It never deletes anything.'),
      h('hr'),
      h('div.row',
        h('a.btn.small', { href: '/api/admin/export' }, '💾 Download export (JSON)'),
        h('span.muted', 'Then run "npm run bundle-to-content -- export.json" to turn it into content/ files you can commit.')),
      h('hr'),
      h('div.row', importFile, h('label.row', importForce, 'Overwrite admin edits'),
        h('button.btn.small.secondary', {
          onclick: async () => {
            const fl = importFile.files[0];
            if (!fl) return toast('Choose a JSON file first');
            try {
              const bundle = JSON.parse(await fl.text());
              const r = await api('POST', '/api/admin/import', { bundle, force: importForce.checked });
              syncMsg.replaceChildren(h('div.ok', 'Import: ' + statsText(r)));
            } catch (e) { syncMsg.replaceChildren(h('div.errors', e.message)); }
          },
        }, '⬆️ Import export file'))),
  );
}

boot().catch(e => { view.replaceChildren(h('div.errors', e.message)); });
