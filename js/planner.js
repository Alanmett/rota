// Gün gün plan: yakın yerleri aynı güne toplar, kapalı günlere koymaz,
// yol süresini ve günlük tempo sınırını hesaba katar.

import { haversineKm, parseISODate, fmtClock } from './util.js';
import { hoursOn } from './hours.js';
import { isShop } from './places.js';
import { t } from './i18n.js';

export const PACES = {
  rahat: { label: t('Rahat'), sub: t('3–4 yer/gün'), budget: 300 },
  normal: { label: t('Normal'), sub: t('4–6 yer/gün'), budget: 420 },
  yogun: { label: t('Yoğun'), sub: t('Sabah–akşam'), budget: 540 },
};

export const TRANSPORTS = {
  araba: { label: t('Araba'), emoji: '🚗', gmode: 'driving' },
  toplu: { label: t('Toplu taşıma'), emoji: '🚌', gmode: 'transit' },
  yuruyus: { label: t('Yürüyerek'), emoji: '🚶', gmode: 'walking' },
};

export const LEG_EMOJI = { walk: '🚶', car: '🚗', transit: '🚌' };

// İki nokta arası tahmini yol: kuş uçuşu × 1,3 (yol eğriliği), ulaşım türüne göre hız.
export function leg(a, b, transport) {
  const km = haversineKm(a, b) * 1.3;
  if (km <= 1.2) return { km, min: Math.max(2, Math.round(km / 4.5 * 60)), mode: 'walk' };
  if (transport === 'araba') return { km, min: Math.round(km <= 15 ? km / 30 * 60 + 8 : km / 65 * 60 + 10), mode: 'car' };
  if (transport === 'yuruyus' && km <= 2.5) return { km, min: Math.round(km / 4.5 * 60), mode: 'walk' };
  return { km, min: Math.round(km / 18 * 60 + 10), mode: 'transit' };
}

// Aynı günde aynı türün tekrarı ne kadar cezalandırılsın (aynı dağın iki zirvesi neredeyse hiç anlamlı değil).
const REPEAT = { peak: 0.15, volcano: 0.15, plateau: 0.2, national_park: 0.2, nature_reserve: 0.3 };

// İsviçre, Almanya ve Avusturya'da mağazalar pazar günü kapalı. Çalışma saati kayıtlı olmayan AVM ve mağazalar
// o gün plana konmaz (saati kayıtlı olanlar, ör. pazar da açık outletler, saatine göre planlanır).
const SUNDAY_SHUT_CC = new Set(['ch', 'li', 'de', 'at']);
const SUNDAY_SHUT_TYPES = new Set(['mall', 'outlet', 'department_store', 'shopping_street']);
export const sundayShut = (p, date, cc) => !p.hours && date.getDay() === 0 && SUNDAY_SHUT_CC.has(cc) && SUNDAY_SHUT_TYPES.has(p.type);
const MARKETS = new Set(['market', 'flea_market']);

function openOn(p, iso, cc) {
  if (!p.hours) return !sundayShut(p, parseISODate(iso), cc);
  const r = hoursOn(p.hours, parseISODate(iso));
  return !r.known || r.open;
}

function adjustedScore(p, o) {
  let v = p.score;
  if (o.travelers?.children) {
    if (p.cats.some(c => c === 'aile' || c === 'park' || c === 'plaj')) v *= 1.4;
    if (p.type === 'museum') v *= 0.85;
  }
  return v;
}

const pathLen = (ids, byId, origin) => {
  let s = 0, prev = origin;
  for (const id of ids) { const p = byId[id]; if (prev) s += haversineKm(prev, p); prev = p; }
  return s;
};

// 2-opt: ziyaret sırasını yolu kısaltacak şekilde düzeltir.
function improveOrder(ids, byId, origin) {
  if (ids.length < 3) return ids;
  let best = ids.slice(), bestLen = pathLen(best, byId, origin), improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        const len = pathLen(cand, byId, origin);
        if (len + 1e-9 < bestLen) { best = cand; bestLen = len; improved = true; }
      }
    }
  }
  return best;
}

export function buildItinerary(places, dates, o) {
  const tr = o.travelers || {};
  const factor = (tr.elderly ? 0.8 : 1) * (tr.children ? 0.9 : 1);
  const maxLeg = o.transport === 'araba' ? 75 : o.transport === 'toplu' ? 50 : 35;
  const byId = Object.fromEntries(places.map(p => [p.id, p]));
  const ranked = places
    .filter(p => p.type !== 'water') // göllerin koordinatı suyun ortası; plana durak olarak konmaz
    .filter(p => !(tr.elderly && ['peak', 'gorge', 'canyon', 'volcano'].includes(p.type)))
    .map(p => ({ p, v: adjustedScore(p, o) }))
    .sort((a, b) => b.v - a.v);
  // Alışveriş başka ilgi alanlarıyla birlikte seçildiyse her güne en fazla bir alışveriş durağı eklenir ve gün ona
  // göre hafif tutulur; yalnızca alışveriş seçildiyse alışveriş yerleri normal duraklar gibi planlanır.
  // ("gezi": her aramaya eklenen genel turistik yerler; ilgi alanı sayılmaz)
  const reserve = ranked.some(x => isShop(x.p)) && ranked.some(x => !isShop(x.p) && x.p.cats[0] !== 'gezi');
  const pool = (reserve ? ranked.filter(x => !isShop(x.p)) : ranked).slice(0, Math.max(40, dates.length * 15));
  const free = new Map(pool.map(x => [x.p.id, x]));
  const freeShops = new Map(reserve ? ranked.filter(x => isShop(x.p)).slice(0, Math.max(8, dates.length * 4)).map(x => [x.p.id, x]) : []);
  // "Mutlaka görülmeli" adayları: en önemli yerler her günün çıkış noktası olur ki yakınlık hesabı yüzünden dışarıda kalmasın.
  const mustSee = new Set(pool.slice(0, Math.max(3, dates.length * 2)).map(x => x.p.id));
  const days = [];
  const tripTypes = {}; // tüm gezide hangi türden kaç yer seçildi

  dates.forEach((iso, i) => {
    const first = i === 0;
    const budget = (first && o.firstDayBudget != null ? o.firstDayBudget : PACES[o.pace]?.budget ?? 420) * factor;
    const origin = first ? o.origin : null;
    const stops = [];
    const dayTypes = {};
    const shopsOpen = [...freeShops.values()].filter(x => openOn(x.p, iso, o.cc));
    const sightBudget = budget - (shopsOpen.length ? 90 : 0); // alışverişe yer ayır
    let used = 0, cur = origin;
    for (;;) {
      let best = null, bestVal = -Infinity, bestLeg = null;
      const seedFromMust = !cur && [...free.keys()].some(id => mustSee.has(id) && openOn(free.get(id).p, iso, o.cc));
      for (const x of free.values()) {
        if (!openOn(x.p, iso, o.cc)) continue;
        if (seedFromMust && !mustSee.has(x.p.id)) continue;
        const lg = cur ? leg(cur, x.p, o.transport) : { min: 0 };
        if (cur && lg.min > maxLeg) continue;
        if (stops.length && used + lg.min + x.p.dur > sightBudget) continue;
        // Çeşitlilik: aynı günde aynı türden (ör. art arda camiler) her tekrar değeri belirgin düşürür.
        const variety = (REPEAT[x.p.type] ?? 0.5) ** (dayTypes[x.p.type] || 0) * 0.85 ** (tripTypes[x.p.type] || 0);
        const val = (cur ? x.v / (1 + lg.min / 20) : x.v) * variety;
        if (val > bestVal) { bestVal = val; best = x; bestLeg = lg; }
      }
      if (!best) break;
      stops.push(best.p.id);
      used += bestLeg.min + best.p.dur;
      cur = best.p;
      dayTypes[best.p.type] = (dayTypes[best.p.type] || 0) + 1;
      tripTypes[best.p.type] = (tripTypes[best.p.type] || 0) + 1;
      free.delete(best.p.id);
      if (stops.length >= 10) break;
    }
    // Günün alışveriş durağı: günün yerlerine en az sapmayla ulaşılan en iyi yer
    if (shopsOpen.length) {
      const anchors = [...stops.map(id => byId[id]), ...(origin ? [origin] : [])];
      let best = null, bestVal = -Infinity;
      for (const x of shopsOpen) {
        const detour = anchors.length ? Math.min(...anchors.map(a => leg(a, x.p, o.transport).min)) : 0;
        if (detour > maxLeg) continue;
        const val = x.v / (1 + detour / 20);
        if (val > bestVal) { bestVal = val; best = x; }
      }
      if (best) { stops.push(best.p.id); freeShops.delete(best.p.id); }
    }
    days.push({ date: iso, stops: improveOrder(stops, byId, origin), startMin: first && o.startMin != null ? o.startMin : 570 });
  });

  return { days, alternatives: [...[...free.values()].slice(0, 15), ...[...freeShops.values()].slice(0, 5)].map(x => x.p.id) };
}

// En az ek yol çıkaracak konuma ekler.
export function bestInsertIndex(stops, p, places) {
  if (!stops.length) return 0;
  let bestI = stops.length, bestCost = Infinity;
  for (let i = 0; i <= stops.length; i++) {
    const a = places[stops[i - 1]], b = places[stops[i]];
    const cost = (a ? haversineKm(a, p) : 0) + (b ? haversineKm(p, b) : 0) - (a && b ? haversineKm(a, b) : 0);
    if (cost < bestCost) { bestCost = cost; bestI = i; }
  }
  return bestI;
}

// Saat saat akış: yol süreleri, öğle yemeği arası, açılış/kapanış uyarıları.
// Arabalı gezide park yeri gereken durakların kimlikleri (otopark aramak için).
export function parkingStops(trip) {
  if (trip.transport !== 'araba') return [];
  const ids = [];
  trip.days.forEach((_, di) => { for (const it of computeTimeline(trip, di).items) if (it.kind === 'stop' && it.parkHere) ids.push(it.id); });
  return ids;
}

export function computeTimeline(trip, di) {
  const day = trip.days[di];
  const date = parseISODate(day.date);
  const items = [];
  // clock: günün o anki saati (dakika). "t" adı çeviri fonksiyonuna ait.
  let clock = day.startMin ?? 570, prev = di === 0 && trip.origin ? trip.origin : null;
  let lunchDone = false, visitMin = 0, travelMin = 0;
  const lunch = () => { items.push({ kind: 'lunch', start: clock }); clock += 60; lunchDone = true; };

  for (const id of day.stops) {
    const p = trip.places[id];
    if (!p) continue;
    if (!lunchDone && clock >= 12 * 60 + 15) lunch();
    const lg = prev ? leg(prev, p, trip.transport) : null;
    if (lg) { items.push({ kind: 'leg', ...lg }); clock += lg.min; travelMin += lg.min; }
    if (!lunchDone && clock >= 11 * 60 + 30 && clock + p.dur > 14 * 60) lunch();
    const start = clock, end = clock + p.dur, warn = [];
    const hrs = hoursOn(p.hours, date);
    if (hrs.known) {
      if (!hrs.open) warn.push(t('Bu gün kapalı görünüyor'));
      else if (!hrs.ranges.some(([a, b]) => start >= a - 1 && end <= b + 1)) {
        const r = hrs.ranges.find(([, b]) => b > start);
        warn.push(!r ? t('Bu saatte kapalı olabilir') : start < r[0] ? t('Açılış {x}', { x: fmtClock(r[0]) }) : t('Kapanış {x}, vakit dar', { x: fmtClock(r[1]) }));
      }
    } else if (sundayShut(p, date, trip.dest?.cc)) warn.push(t('Pazar günü mağazalar genelde kapalı'));
    else if (MARKETS.has(p.type)) warn.push(t('Pazarın kurulduğu gün ve saatleri kontrol et'));
    // Arabayla varılan durak (günün ilki ya da araba gerektiren bir yolun sonu) → park yeri gerekir.
    // Yürüme mesafesindeki sonraki duraklar için araba aynı yerde kalır.
    const parkHere = trip.transport === 'araba' && (lg ? lg.mode === 'car' : true);
    items.push({ kind: 'stop', id, place: p, start, end, warn, parkHere });
    clock = end; visitMin += p.dur; prev = p;
  }
  if (!lunchDone && day.stops.length && clock >= 11 * 60 + 30 && clock <= 15 * 60) lunch();
  return { items, end: clock, visitMin, travelMin };
}

const ll = p => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
export const gmapsDir = p => `https://www.google.com/maps/dir/?api=1&destination=${ll(p)}`;
export const gmapsSearch = p => `https://www.google.com/maps/search/${encodeURIComponent(p.name)}/@${ll(p)},17z`;

// Günün tüm duraklarını Google Maps'te tek rota olarak açar.
// Başlangıç kullanıcının konumuysa adrese yazılmaz; Maps cihazın konumunu kendisi kullanır.
export function gmapsDayLink(trip, di) {
  const pts = trip.days[di].stops.map(id => trip.places[id]).filter(Boolean);
  if (!pts.length) return null;
  const fromHere = di === 0 && trip.origin;
  const rest = fromHere ? pts : pts.slice(1);
  if (!rest.length) return gmapsDir(pts[0]);
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  if (!fromHere) u.searchParams.set('origin', ll(pts[0]));
  u.searchParams.set('destination', ll(rest[rest.length - 1]));
  const way = rest.slice(0, -1).slice(0, 9);
  if (way.length) u.searchParams.set('waypoints', way.map(ll).join('|'));
  const mode = TRANSPORTS[trip.transport]?.gmode;
  if (mode && !(mode === 'transit' && way.length)) u.searchParams.set('travelmode', mode);
  return u.toString();
}
