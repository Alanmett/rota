// Küçük arayüz yardımcıları. Dışarıdan gelen metinler her zaman textContent ile basılır.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  let value;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'value') value = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, kids);
  if (value !== undefined) el.value = value;
  return el;
}

function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false || k === true) continue;
    el.append(k instanceof Node ? k : String(k));
  }
}

// replaceChildren'ın güvenli hali: false/null/undefined çocukları atlar (yerleşik olan bunları metne çevirir).
export function fill(el, ...kids) {
  el.replaceChildren();
  append(el, kids);
  return el;
}

export const $ = (s, r = document) => r.querySelector(s);

// Div gibi öğeleri klavyeyle de tıklanabilir yapar.
export function tappable(attrs, ...kids) {
  const el = h('div', { role: 'button', tabindex: '0', ...attrs }, ...kids);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
  return el;
}

let toastTimer;
export function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export function openSheet(content) {
  const d = $('#sheet');
  $('#sheet-body').replaceChildren(h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }), content);
  if (!d.open) d.showModal();
  d.scrollTop = 0;
}
export function closeSheet() { const d = $('#sheet'); if (d.open) d.close(); }
export function initSheet() {
  const d = $('#sheet');
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
}

const leaveHooks = [];
export function onLeave(fn) { leaveHooks.push(fn); }
export function runLeave() { while (leaveHooks.length) { try { leaveHooks.pop()(); } catch { /* yoksay */ } } }

export function setTitle(t) {
  $('#page-title').textContent = t;
  document.title = t === 'Rota' ? 'Rota' : `${t} · Rota`;
}

export const spinner = text => h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), text);

export function segmented(options, current, onChange) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup' });
  const render = () => wrap.replaceChildren(...options.map(o => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(o.value === current), class: o.value === current ? 'on' : '',
    onclick: () => { if (current === o.value) return; current = o.value; render(); onChange(o.value); },
  }, h('span', {}, o.label), o.sub && h('small', {}, o.sub))));
  render();
  return wrap;
}

export function chips(options, selected, onChange) {
  const set = new Set(selected);
  const wrap = h('div', { class: 'chips' });
  const render = () => wrap.replaceChildren(...options.map(o => h('button', {
    type: 'button', class: 'chip' + (set.has(o.value) ? ' on' : ''), 'aria-pressed': String(set.has(o.value)),
    onclick: () => { set.has(o.value) ? set.delete(o.value) : set.add(o.value); render(); onChange([...set]); },
  }, o.emoji && h('span', { 'aria-hidden': 'true' }, o.emoji), o.label)));
  render();
  return wrap;
}

export function stepper(value, min, max, onChange, label = '') {
  const out = h('output', { 'aria-live': 'polite' }, String(value));
  const set = v => { value = Math.max(min, Math.min(max, v)); out.textContent = value; onChange(value); };
  return h('div', { class: 'stepper' },
    h('button', { type: 'button', 'aria-label': `${label} azalt`, onclick: () => set(value - 1) }, '−'),
    out,
    h('button', { type: 'button', 'aria-label': `${label} artır`, onclick: () => set(value + 1) }, '+'));
}

export const section = (title, ...kids) => h('section', { class: 'form-sec' }, h('h2', { class: 'h-sec' }, title), ...kids);
export const field = (label, control) => h('label', { class: 'field' }, h('span', {}, label), control);
export const row = (label, control) => h('div', { class: 'row' }, h('span', {}, label), control);

export function emptyState(title, text, ...actions) {
  return h('div', { class: 'empty' }, h('h2', {}, title), text && h('p', { class: 'muted' }, text), actions.length && h('div', { class: 'btn-row' }, actions));
}

export const linkBtn = (label, href, cls = 'btn') => h('a', { class: cls, href, target: '_blank', rel: 'noopener' }, label);
