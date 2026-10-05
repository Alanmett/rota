// Gezilerim: kayıtlı geziler (yaklaşan / geçmiş).

import { h, emptyState } from '../ui.js';
import { listTrips } from '../store.js';
import { fmtRange, todayISO } from '../util.js';

function tripCard(t) {
  const n = t.days.reduce((s, d) => s + d.stops.length, 0);
  return h('a', { class: 'trip-card', href: `#/gezi/${t.id}` },
    h('span', { class: 'emoji', 'aria-hidden': 'true' }, t.kind === 'today' ? '☀️' : '🧳'),
    h('div', { class: 'pc-main' },
      h('div', { class: 'trip-name' }, t.name),
      h('div', { class: 'muted small' }, `${fmtRange(t.startDate, t.endDate)} · ${t.days.length === 1 ? 'günübirlik' : `${t.days.length} gün`} · ${n} yer`)),
    h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
}

export function renderTrips(root) {
  const trips = listTrips();
  if (!trips.length) {
    root.append(emptyState('Henüz gezin yok',
      'Çevreni keşfedip bugün için plan yapabilir ya da ileri tarihli bir gezi planlayabilirsin.',
      h('a', { class: 'btn primary', href: '#/planla' }, 'Gezi planla'),
      h('a', { class: 'btn', href: '#/kesfet' }, 'Çevremi keşfet')));
    return;
  }
  const today = todayISO();
  const upcoming = trips.filter(t => t.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = trips.filter(t => t.endDate < today).sort((a, b) => b.startDate.localeCompare(a.startDate));
  if (upcoming.length) root.append(h('section', {}, h('h2', { class: 'h-sec' }, 'Yaklaşan'), upcoming.map(tripCard)));
  if (past.length) root.append(h('section', {}, h('h2', { class: 'h-sec' }, 'Geçmiş'), past.map(tripCard)));
}
