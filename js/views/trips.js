// Gezilerim: kayıtlı geziler (yaklaşan / geçmiş).

import { h, emptyState } from '../ui.js';
import { listTrips, getSettings } from '../store.js';
import { computeBudget } from '../budget.js';
import { fmtRange, fmtMoney, todayISO } from '../util.js';
import { t } from '../i18n.js';

function tripCard(trip, settings) {
  const n = trip.days.reduce((s, d) => s + d.stops.length, 0);
  const len = trip.days.length === 1 ? t('günübirlik') : t('{n} gün', { n: trip.days.length });
  let cost = '';
  try { cost = ` · 💰 ~${fmtMoney(computeBudget(trip, settings).total)}`; } catch { /* eski kayıt; maliyetsiz göster */ }
  return h('a', { class: 'trip-card', href: `#/gezi/${trip.id}` },
    h('span', { class: 'emoji', 'aria-hidden': 'true' }, trip.kind === 'today' ? '☀️' : '🧳'),
    h('div', { class: 'pc-main' },
      h('div', { class: 'trip-name' }, trip.name),
      h('div', { class: 'muted small' }, `${fmtRange(trip.startDate, trip.endDate)} · ${len} · ${t('{n} yer', { n })}${cost}`)),
    h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
}

export function renderTrips(root) {
  const trips = listTrips();
  const settings = getSettings();
  const card = trip => tripCard(trip, settings);
  if (!trips.length) {
    root.append(emptyState(t('Henüz gezin yok'),
      t('Nereye gideceğini bilmiyorsan Öner sekmesi yer önerir; biliyorsan Planla ile gezini hazırla.'),
      h('a', { class: 'btn primary', href: '#/oner' }, '✨ ' + t('Bana yer öner')),
      h('a', { class: 'btn', href: '#/planla' }, t('Gezi planla'))));
    return;
  }
  const today = todayISO();
  const upcoming = trips.filter(x => x.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = trips.filter(x => x.endDate < today).sort((a, b) => b.startDate.localeCompare(a.startDate));
  if (upcoming.length) root.append(h('section', {}, h('h2', { class: 'h-sec' }, t('Yaklaşan')), upcoming.map(card)));
  if (past.length) root.append(h('section', {}, h('h2', { class: 'h-sec' }, t('Geçmiş')), past.map(card)));
}
