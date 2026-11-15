// Small DOM + fetch helpers shared by the player app and the admin.

// Let append()/replaceChildren() skip null/false (handy for `cond ? el : null`)
for (const fn of ['append', 'replaceChildren']) {
  const orig = Element.prototype[fn];
  Element.prototype[fn] = function (...kids) {
    return orig.apply(this, kids.flat(Infinity).filter(k => k != null && k !== false));
  };
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// h('div.card#id', {onclick}, child, 'text', ...)
export function h(tag, attrs, ...children) {
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9]*)(.*)$/i);
  const el = document.createElement(name || 'div');
  for (const m of rest.matchAll(/([.#])([\w-]+)/g)) {
    if (m[1] === '.') el.classList.add(m[2]); else el.id = m[2];
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
      }
    }
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export class ApiError extends Error {
  constructor(status, body) { super(body?.error || `HTTP ${status}`); this.status = status; this.body = body || {}; }
}

export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}

let toastTimer;
export function toast(msg, ms = 2200) {
  document.querySelector('.toast')?.remove();
  const t = h('div.toast', msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}

export function confetti() {
  const box = h('div', { style: { position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 30, overflow: 'hidden' } });
  const bits = ['🎉', '⭐', '❄️', '🎄', '🎁', '✨'];
  for (let i = 0; i < 40; i++) {
    const s = h('span', { style: {
      position: 'absolute', left: Math.random() * 100 + 'vw', top: '-30px', fontSize: (14 + Math.random() * 16) + 'px',
      transition: `transform ${1.5 + Math.random()}s ease-in, opacity 2.5s`,
    } }, bits[i % bits.length]);
    box.append(s);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      s.style.transform = `translate(${(Math.random() - .5) * 200}px, 110vh) rotate(${Math.random() * 720}deg)`;
      s.style.opacity = '0.2';
    }));
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 3000);
}
