// "Bugün": bir gezinin içindeyken o günün durumu — şu an neredesin, sıradaki durak, yol tarifi.
// Saat telefonun saatinden alınır; plan saatleri tahmini olduğu için "sıradaki" yaklaşık bir yönlendirmedir.

import { h } from './ui.js';
import { listTrips } from './store.js';
import { computeTimeline, gmapsDir } from './planner.js';
import { expenseSheet, spentTotal } from './expenses.js';
import { fmtClock, fmtMoney, todayISO } from './util.js';
import { t } from './i18n.js';

export const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

// Bugün devam eden gezi ve günün sırası (birden fazlaysa en erken başlayan)
export function ongoingTrip(trips) {
  const iso = todayISO();
  const trip = trips.filter(x => x.startDate <= iso && x.endDate >= iso).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  if (!trip) return null;
  const di = trip.days.findIndex(d => d.date === iso);
  return di >= 0 ? { trip, di } : null;
}

export function dayStatus(trip, di, now = nowMin()) {
  const tl = computeTimeline(trip, di);
  const stops = tl.items.filter(x => x.kind === 'stop');
  const current = stops.find(s => now >= s.start && now < s.end) || null;
  const next = current ? stops[stops.indexOf(current) + 1] || null : stops.find(s => s.start >= now) || null;
  const done = stops.length > 0 && now >= stops[stops.length - 1].end;
  const sleep = tl.items.find(x => x.kind === 'sleep' || x.kind === 'end') || null;
  return { stops, current, next, done, sleep };
}

// Kartı sayfanın başına koyar; harcama eklenince kendini yeniler. Devam eden gezi yoksa hiçbir şey eklemez.
export function mountToday(root) {
  let card = null;
  const refresh = () => { const next = todayCard(listTrips(), refresh); if (card && next) card.replaceWith(next); card = next; };
  card = todayCard(listTrips(), refresh);
  if (card) root.append(card);
}

// Ana sayfada ve Gezilerim'de gösterilen kart
export function todayCard(trips, onChange) {
  const o = ongoingTrip(trips);
  if (!o) return null;
  const { trip, di } = o;
  const st = dayStatus(trip, di);
  const dirBtn = p => h('a', { class: 'btn small primary', href: gmapsDir(p), target: '_blank', rel: 'noopener' }, '🧭 ' + t('Yol tarifi'));
  let body;
  if (!st.stops.length) {
    body = [h('p', {}, st.sleep ? t('Bugün yol günü. Gece: {p}', { p: st.sleep.place.name }) : t('Bugün için planlanmış yer yok; serbest gün.')),
      st.sleep && dirBtn(st.sleep.place)];
  } else if (st.done) {
    body = [h('p', {}, '🎉 ' + t('Günün planı bitti.') + (st.sleep ? ' ' + t('Gece: {p}', { p: st.sleep.place.name }) : '')),
      st.sleep && dirBtn(st.sleep.place)];
  } else {
    body = [
      st.current && h('p', {}, h('span', { class: 'muted' }, t('Şu an') + ': '), h('b', {}, st.current.place.name), h('span', { class: 'muted small' }, ' · ' + t('bitiş ~{x}', { x: fmtClock(st.current.end) }))),
      st.next && h('p', {}, h('span', { class: 'muted' }, t('Sıradaki') + ': '), h('b', {}, st.next.place.name), h('span', { class: 'muted small' }, ` · ${fmtClock(st.next.start)}`)),
      (st.next || st.current) && dirBtn((st.next || st.current).place),
    ];
  }
  const spent = spentTotal(trip);
  return h('section', { class: 'card today-card' },
    h('div', { class: 'today-head' },
      h('span', { class: 'today-dot', 'aria-hidden': 'true' }),
      h('b', {}, t('Bugün')), h('span', { class: 'muted small' }, ` · ${trip.name} · ${t('{n}. gün', { n: di + 1 })}`)),
    body,
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn small', href: `#/gezi/${trip.id}` }, '🗺️ ' + t('Günün planı')),
      h('button', { class: 'btn small', type: 'button', onclick: () => expenseSheet(trip, onChange) }, '➕ ' + t('Harcama')),
      spent > 0 && h('span', { class: 'muted small' }, t('Harcanan {p}', { p: fmtMoney(spent) }))));
}
