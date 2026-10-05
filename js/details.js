// Mekân detay penceresi ve "geziye ekle" akışı.

import { h, fill, openSheet, closeSheet, toast, linkBtn } from './ui.js';
import { wikiForTags } from './api.js';
import { hoursOn, isOpenAt, fmtRanges } from './hours.js';
import { typeLabel, catEmoji, cuisineLabel, stripPlace, fetchParkingNear, PARKING_LABEL } from './places.js';
import { gmapsDir, gmapsSearch, bestInsertIndex } from './planner.js';
import { listTrips, saveTrip } from './store.js';
import { fmtKm, fmtDay, fmtDayLong, fmtRange, todayISO, parseISODate, safeUrl } from './util.js';
import { t, getLang } from './i18n.js';

const WHEEL = { yes: t('Tekerlekli sandalyeye uygun'), limited: t('Tekerlekli sandalye için kısmen uygun'), no: t('Tekerlekli sandalyeye uygun değil') };

function hoursText(p, iso) {
  if (!p.hours) return t('Çalışma saati kayıtlı değil, gitmeden kontrol et.');
  const date = iso ? parseISODate(iso) : new Date();
  const r = hoursOn(p.hours, date);
  const label = iso ? fmtDayLong(iso) : t('Bugün');
  if (!r.known) return t('Kayıtlı saat: {h}', { h: p.hours });
  if (!r.open) return t('{day}: kapalı', { day: label }) + ` · (${p.hours})`;
  const now = !iso && isOpenAt(p.hours, date);
  return `${label}: ${fmtRanges(r.ranges)}${now ? ' · ' + t('şu an açık') : ''}`;
}

function editLink(p) {
  const osm = { n: 'node', w: 'way', r: 'relation' }[p.id[0]];
  return osm
    ? h('a', { href: `https://www.openstreetmap.org/${osm}/${p.id.slice(1)}`, target: '_blank', rel: 'noopener' }, t("OpenStreetMap'te düzeltebilirsin"))
    : h('a', { href: `https://www.wikidata.org/wiki/${p.tags.wikidata}`, target: '_blank', rel: 'noopener' }, t("Wikidata'da düzeltebilirsin"));
}

export const wikiMoreLabel = w => t("Wikipedia'da devamı") + (w.lang !== getLang() ? ` (${w.lang.toUpperCase()})` : '') + ' →';

// Otopark satırı: dokununca yol tarifi doğrudan otoparka verilir.
export function parkLink(l) {
  const walk = Math.max(1, Math.round(l.dist * 1.3 / 4.5 * 60));
  const bits = [
    l.name ? PARKING_LABEL[l.kind] : null,
    t('{m} dk yürüme', { m: walk }),
    l.fee === 'yes' ? t('ücretli') : l.fee === 'no' ? t('ücretsiz') : null,
    l.capacity ? t('{n} araçlık', { n: l.capacity }) : null,
  ].filter(Boolean);
  return h('a', { class: 'park', href: gmapsDir(l), target: '_blank', rel: 'noopener' },
    h('b', {}, '🅿️ ' + (l.name || PARKING_LABEL[l.kind])),
    h('span', { class: 'muted' }, bits.join(' · ')));
}

export function showPlaceDetail(p, { date, actions = [], parking = false } = {}) {
  const tg = p.tags || {};
  const info = h('div', { class: 'wiki' }, h('p', { class: 'muted small' }, t('Bilgi yükleniyor…')));
  const web = safeUrl(tg.website || tg['contact:website']);
  const phone = tg.phone || tg['contact:phone'];
  const addr = [tg['addr:street'] && `${tg['addr:street']} ${tg['addr:housenumber'] || ''}`.trim(), tg['addr:district'], tg['addr:city'] || tg['addr:province']].filter(Boolean).join(', ');
  const facts = [
    ['🕘', hoursText(p, date)],
    tg.fee === 'yes' && ['🎟️', t('Giriş ücretli')],
    tg.fee === 'no' && ['🎟️', t('Giriş ücretsiz')],
    tg.cuisine && ['🍴', cuisineLabel(tg.cuisine)],
    tg.ele && ['⛰️', t('Yükseklik {m} m', { m: tg.ele })],
    WHEEL[tg.wheelchair] && ['♿', WHEEL[tg.wheelchair]],
    addr && ['📍', addr],
    phone && ['📞', h('a', { href: `tel:${phone.split(';')[0].replace(/[^\d+]/g, '')}` }, phone.split(';')[0])],
    web && ['🔗', h('a', { href: web, target: '_blank', rel: 'noopener' }, t('Resmi site'))],
  ].filter(Boolean);
  const park = parking ? h('div', { class: 'park-box' }, h('p', { class: 'muted small' }, t('Otoparklar aranıyor…'))) : null;

  openSheet(h('div', { class: 'detail' },
    h('div', { class: 'detail-head' },
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, catEmoji(p)),
      h('div', {}, h('h2', {}, p.name), h('div', { class: 'muted small' }, typeLabel(p), p.dist != null ? ' · ' + t('{d} uzakta', { d: fmtKm(p.dist) }) : ''))),
    info,
    h('ul', { class: 'facts' }, facts.map(([i, txt]) => h('li', {}, h('span', { 'aria-hidden': 'true' }, i), h('span', {}, txt)))),
    park,
    h('div', { class: 'btn-row' },
      linkBtn('🧭 ' + t('Yol tarifi'), gmapsDir(p), 'btn primary'),
      linkBtn('⭐ ' + t('Google yorumları'), gmapsSearch(p)),
      ...actions),
    h('p', { class: 'muted small source' }, t('Bilgi yanlış ya da eksikse') + ' ', editLink(p), '.'),
  ));

  if (park) {
    fetchParkingNear([{ key: 'p', lat: p.lat, lon: p.lon }], 700).then(r => {
      if (!park.isConnected) return;
      const lots = r.p || [];
      fill(park, h('h3', { class: 'h-sub' }, t('Yakındaki otoparklar')),
        lots.length ? lots.map(parkLink) : h('p', { class: 'muted small' }, t('Yakında kayıtlı otopark bulunamadı')));
    }).catch(() => park.replaceChildren());
  }

  wikiForTags({ wikidata: tg.wikidata, wikipedia: tg.wikipedia }).then(w => {
    if (!info.isConnected) return;
    const desc = tg[`description:${getLang()}`] || tg.description;
    if (!w) { info.replaceChildren(desc ? h('p', {}, desc) : h('p', { class: 'muted small' }, t('Bu yer için ansiklopedik bilgi bulunamadı.'))); return; }
    fill(info,
      w.thumb && h('img', { src: w.thumb, alt: '', loading: 'lazy' }),
      h('p', {}, w.extract),
      h('a', { href: w.url, target: '_blank', rel: 'noopener', class: 'small' }, wikiMoreLabel(w)));
  }).catch(() => info.replaceChildren());
}

// Keşfet ekranındaki bir yeri mevcut bir geziye ekler.
export function addToTripSheet(p) {
  const trips = listTrips().filter(tr => tr.endDate >= todayISO()).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const add = (tr, di) => {
    tr.places[p.id] = stripPlace(p);
    const stops = tr.days[di].stops;
    if (!stops.includes(p.id)) stops.splice(bestInsertIndex(stops, p, tr.places), 0, p.id);
    tr.alternatives = tr.alternatives.filter(x => x !== p.id);
    tr.updatedAt = Date.now();
    saveTrip(tr);
    closeSheet();
    toast(t('"{p}" eklendi: {trip} · {n}. gün', { p: p.name, trip: tr.name, n: di + 1 }));
  };
  const pickDay = tr => {
    if (tr.days.length === 1) return add(tr, 0);
    openSheet(h('div', {}, h('h2', { class: 'sheet-title' }, t('Hangi güne?')),
      h('div', { class: 'menu' }, tr.days.map((d, j) => h('button', { class: 'menu-item', onclick: () => add(tr, j) },
        `${t('{n}. gün', { n: j + 1 })} · ${fmtDay(d.date)}`, h('small', {}, t('{n} yer', { n: d.stops.length })))))));
  };
  openSheet(h('div', {}, h('h2', { class: 'sheet-title' }, t('Hangi geziye eklensin?')),
    trips.length
      ? h('div', { class: 'menu' }, trips.map(tr => h('button', { class: 'menu-item', onclick: () => pickDay(tr) }, tr.name, h('small', {}, fmtRange(tr.startDate, tr.endDate)))))
      : h('p', { class: 'muted' }, t('Yaklaşan bir gezin yok. Önce "Bugün için plan yap" ile ya da Planla sekmesinden bir gezi oluştur.'))));
}
