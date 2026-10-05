// Mekân detay penceresi ve "geziye ekle" akışı.

import { h, fill, openSheet, closeSheet, toast, linkBtn } from './ui.js';
import { wikiForTags } from './api.js';
import { hoursOn, isOpenAt, fmtRanges } from './hours.js';
import { typeLabel, catEmoji, cuisineLabel, stripPlace } from './places.js';
import { gmapsDir, gmapsSearch, bestInsertIndex } from './planner.js';
import { listTrips, saveTrip } from './store.js';
import { fmtKm, fmtDay, fmtDayLong, fmtRange, todayISO, parseISODate, safeUrl } from './util.js';

const WHEEL = { yes: 'Tekerlekli sandalyeye uygun', limited: 'Tekerlekli sandalye için kısmen uygun', no: 'Tekerlekli sandalyeye uygun değil' };

function hoursText(p, iso) {
  if (!p.hours) return 'Çalışma saati kayıtlı değil, gitmeden kontrol et.';
  const date = iso ? parseISODate(iso) : new Date();
  const r = hoursOn(p.hours, date);
  const label = iso ? fmtDayLong(iso) : 'Bugün';
  if (!r.known) return `Kayıtlı saat: ${p.hours}`;
  if (!r.open) return `${label}: kapalı · (${p.hours})`;
  const now = !iso && isOpenAt(p.hours, date);
  return `${label}: ${fmtRanges(r.ranges)}${now ? ' · şu an açık' : ''}`;
}

function editLink(p) {
  const osm = { n: 'node', w: 'way', r: 'relation' }[p.id[0]];
  return osm
    ? h('a', { href: `https://www.openstreetmap.org/${osm}/${p.id.slice(1)}`, target: '_blank', rel: 'noopener' }, 'OpenStreetMap\'te düzeltebilirsin')
    : h('a', { href: `https://www.wikidata.org/wiki/${p.tags.wikidata}`, target: '_blank', rel: 'noopener' }, 'Wikidata\'da düzeltebilirsin');
}

export function showPlaceDetail(p, { date, actions = [] } = {}) {
  const t = p.tags || {};
  const info = h('div', { class: 'wiki' }, h('p', { class: 'muted small' }, 'Bilgi yükleniyor…'));
  const web = safeUrl(t.website || t['contact:website']);
  const phone = t.phone || t['contact:phone'];
  const addr = [t['addr:street'] && `${t['addr:street']} ${t['addr:housenumber'] || ''}`.trim(), t['addr:district'], t['addr:city'] || t['addr:province']].filter(Boolean).join(', ');
  const facts = [
    ['🕘', hoursText(p, date)],
    t.fee === 'yes' && ['🎟️', 'Giriş ücretli'],
    t.fee === 'no' && ['🎟️', 'Giriş ücretsiz'],
    t.cuisine && ['🍴', cuisineLabel(t.cuisine)],
    t.ele && ['⛰️', `Yükseklik ${t.ele} m`],
    WHEEL[t.wheelchair] && ['♿', WHEEL[t.wheelchair]],
    addr && ['📍', addr],
    phone && ['📞', h('a', { href: `tel:${phone.split(';')[0].replace(/[^\d+]/g, '')}` }, phone.split(';')[0])],
    web && ['🔗', h('a', { href: web, target: '_blank', rel: 'noopener' }, 'Resmi site')],
  ].filter(Boolean);

  openSheet(h('div', { class: 'detail' },
    h('div', { class: 'detail-head' },
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, catEmoji(p)),
      h('div', {}, h('h2', {}, p.name), h('div', { class: 'muted small' }, typeLabel(p), p.dist != null ? ` · ${fmtKm(p.dist)} uzakta` : ''))),
    info,
    h('ul', { class: 'facts' }, facts.map(([i, txt]) => h('li', {}, h('span', { 'aria-hidden': 'true' }, i), h('span', {}, txt)))),
    h('div', { class: 'btn-row' },
      linkBtn('🧭 Yol tarifi', gmapsDir(p), 'btn primary'),
      linkBtn('⭐ Google yorumları', gmapsSearch(p)),
      ...actions),
    h('p', { class: 'muted small source' }, 'Bilgi yanlış ya da eksikse ', editLink(p), '.'),
  ));

  wikiForTags({ wikidata: t.wikidata, wikipedia: t.wikipedia }).then(w => {
    if (!info.isConnected) return;
    const desc = t['description:tr'] || t.description;
    if (!w) { info.replaceChildren(desc ? h('p', {}, desc) : h('p', { class: 'muted small' }, 'Bu yer için ansiklopedik bilgi bulunamadı.')); return; }
    fill(info,
      w.thumb && h('img', { src: w.thumb, alt: '', loading: 'lazy' }),
      h('p', {}, w.extract),
      h('a', { href: w.url, target: '_blank', rel: 'noopener', class: 'small' }, `Wikipedia'da devamı${w.lang !== 'tr' ? ' (İngilizce)' : ''} →`));
  }).catch(() => info.replaceChildren());
}

// Keşfet ekranındaki bir yeri mevcut bir geziye ekler.
export function addToTripSheet(p) {
  const trips = listTrips().filter(t => t.endDate >= todayISO()).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const add = (t, di) => {
    t.places[p.id] = stripPlace(p);
    const stops = t.days[di].stops;
    if (!stops.includes(p.id)) stops.splice(bestInsertIndex(stops, p, t.places), 0, p.id);
    t.alternatives = t.alternatives.filter(x => x !== p.id);
    t.updatedAt = Date.now();
    saveTrip(t);
    closeSheet();
    toast(`"${p.name}" ${t.name} · ${di + 1}. güne eklendi`);
  };
  const pickDay = t => {
    if (t.days.length === 1) return add(t, 0);
    openSheet(h('div', {}, h('h2', { class: 'sheet-title' }, 'Hangi güne?'),
      h('div', { class: 'menu' }, t.days.map((d, j) => h('button', { class: 'menu-item', onclick: () => add(t, j) }, `${j + 1}. gün · ${fmtDay(d.date)}`, h('small', {}, `${d.stops.length} yer`))))));
  };
  openSheet(h('div', {}, h('h2', { class: 'sheet-title' }, 'Hangi geziye eklensin?'),
    trips.length
      ? h('div', { class: 'menu' }, trips.map(t => h('button', { class: 'menu-item', onclick: () => pickDay(t) }, t.name, h('small', {}, fmtRange(t.startDate, t.endDate)))))
      : h('p', { class: 'muted' }, 'Yaklaşan bir gezin yok. Önce "Bugün için plan yap" ile ya da Planla sekmesinden bir gezi oluştur.')));
}
