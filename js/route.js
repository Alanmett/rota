// Birkaç yerden oluşan rota: işaretlenen şehirleri en kısa yola göre sıralar, gerçek yol sürelerini alır,
// geceleri günlere dağıtır ve her şehir için (Planla'daki tüm kurallarla) gün gün plan çıkarır.
//
// Gün türleri: varış günü (önceki şehirden yol + yol üstü uğramalar + varılan şehirde kalan vakit),
// kalış günü (tam gün o şehir), dönüş günü (sabah son şehir + yol üstü uğramalar + eve yol).
// 0 gece verilen yerler "yol üstü uğrama"dır: o yoldan geçilen gün birkaç saat gezilir.

import { fetchPlaces, stripPlace, isSight } from './places.js';
import { buildItinerary, PACES } from './planner.js';
import { drivingMatrix, drivingRoute, defaultRadiusFor, countryInfo, wikiForTags, wikiSearch } from './api.js';
import { addFoodSuggestions, refreshWeather } from './tripgen.js';
import { addLodging } from './lodging.js';
import { saveTrip } from './store.js';
import { haversineKm, parseISODate, toISODate, uid, sleep } from './util.js';
import { t } from './i18n.js';

export const MAX_ROUTE_DAYS = 21;
export const MAX_ROUTE_STOPS = 10;

// Gerçek yol alınamazsa kaba tahmin: kuş uçuşu × 1,25, ortalama 75 km/sa
const estKm = (a, b) => haversineKm(a, b) * 1.25;
const estMin = km => km / 75 * 60 + 10;
// Toplu taşımada şehirler arası süre: yol mesafesinden kabaca (tren/otobüs + istasyona ulaşım)
const transitMin = km => km / 80 * 60 + 30;

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map(p => [x, ...p]));
}

// En kısa sıra: başlangıç (varsa) sabit, dönüş varsa yol başlangıca kapanır. 8 durağa kadar tüm sıralar denenir,
// fazlasında en yakın komşu + 2-opt.
function bestOrder(n, cost, hasStart, back) {
  const total = ord => {
    let s = hasStart ? cost('s', ord[0]) : 0;
    for (let i = 1; i < ord.length; i++) s += cost(ord[i - 1], ord[i]);
    if (back) s += cost(ord[ord.length - 1], 's');
    return s;
  };
  const idx = [...Array(n).keys()];
  if (n <= 8) {
    let best = idx, bestCost = Infinity;
    for (const p of permutations(idx)) { const c = total(p); if (c < bestCost) { bestCost = c; best = p; } }
    return best;
  }
  const left = new Set(idx), ord = [];
  let cur = hasStart ? 's' : 0;
  if (!hasStart) { ord.push(0); left.delete(0); }
  while (left.size) {
    let b = null, bc = Infinity;
    for (const j of left) { const c = cost(cur, j); if (c < bc) { bc = c; b = j; } }
    ord.push(b); left.delete(b); cur = b;
  }
  let improved = true, best = ord, bestCost = total(ord);
  while (improved) {
    improved = false;
    for (let i = 0; i < n - 1; i++) for (let k = i + 1; k < n; k++) {
      const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
      const c = total(cand);
      if (c + 1e-6 < bestCost) { best = cand; bestCost = c; improved = true; }
    }
  }
  return best;
}

const pt = (p, city) => ({ name: p.name, lat: p.lat, lon: p.lon, cc: p.cc || '', city, ...(p.home ? { home: true } : {}) });

export async function generateRoute(f, settings, progress = () => {}) {
  const car = f.transport === 'araba';
  const start = f.start ? pt(f.start, 's') : null;
  const back = !!(start && f.back);
  const input = f.cities.map(c => ({ ...c }));

  // ---- 1. Yol süreleri ve sıra ----
  progress(t('Rota hesaplanıyor…'));
  const nodes = [...(start ? [start] : []), ...input];
  const at = key => (key === 's' ? 0 : key + (start ? 1 : 0)); // matris sırası
  let mx = null;
  try { mx = await drivingMatrix(nodes); } catch { /* kuş uçuşu tahminle devam */ }
  const roadKm = (a, b) => mx?.km[at(a)]?.[at(b)] ?? estKm(nodes[at(a)], nodes[at(b)]);
  const roadMin = (a, b) => (car ? mx?.min[at(a)]?.[at(b)] ?? estMin(roadKm(a, b)) : transitMin(roadKm(a, b)));
  const order = f.optimize && input.length > 1
    ? bestOrder(input.length, (a, b) => roadMin(a, b), !!start, back)
    : input.map((_, i) => i);
  const reordered = order.some((v, i) => v !== i);
  const cities = order.map((i, k) => ({ ...input[i], key: String(k), _i: i }));
  const end = back ? { ...start, city: 'e' } : null;

  // Tüm şehir çiftleri arası gerçek yol (zaman çizelgesi ve yakıt hesabı bunu kullanır)
  const keyOf = c => c.key;
  const idxOf = key => (key === 's' || key === 'e' ? 's' : cities[+key]._i);
  const keys = [...(start ? ['s'] : []), ...cities.map(keyOf), ...(end ? ['e'] : [])];
  const roads = {};
  for (const a of keys) for (const b of keys) {
    if (a === b || (a === 's' && b === 'e') || (a === 'e' && b === 's')) continue;
    const km = roadKm(idxOf(a), idxOf(b));
    roads[`${a}>${b}`] = { km: Math.round(km), min: Math.round(roadMin(idxOf(a), idxOf(b))) };
  }

  // Haritada çizilecek gerçek yol
  const seq = [...(start ? [start] : []), ...cities, ...(end ? [end] : [])];
  let geo = null;
  if (seq.length >= 2) {
    try { geo = (await drivingRoute(seq)).geo; } catch { geo = null; }
  }

  // ---- 2. Günler ----
  const P = PACES[f.pace]?.budget ?? 420;
  const days = [];
  const date = parseISODate(f.startDate);
  const next = () => { const iso = toISODate(date); date.setDate(date.getDate() + 1); return iso; };
  const chain = (from, pass, to) => {
    const pts = [from, ...pass, to].filter(Boolean);
    let m = 0;
    for (let i = 1; i < pts.length; i++) m += roads[`${pts[i - 1].city ?? pts[i - 1].key}>${pts[i].city ?? pts[i].key}`]?.min ?? 0;
    return m;
  };
  const asPoint = c => pt(c, c.key);
  let from = start, pending = [], lastBase = null;
  for (const c of cities) {
    if (!c.nights) { pending.push(c); continue; }
    days.push({ kind: 'arrive', date: next(), from, pass: pending, base: c, drive: chain(from, pending, asPoint(c)) });
    pending = [];
    for (let k = 1; k < c.nights; k++) days.push({ kind: 'stay', date: next(), base: c, drive: 0 });
    from = asPoint(c); lastBase = c;
  }
  if (end || pending.length || lastBase) {
    days.push({ kind: 'leave', date: next(), from: lastBase ? from : start, pass: pending, base: lastBase, to: end, drive: chain(lastBase ? from : start, pending, end) });
  }
  if (days.length > MAX_ROUTE_DAYS) throw new Error(t('Rota en fazla {n} gün olabilir; gece sayılarını azalt.', { n: MAX_ROUTE_DAYS }));

  // Her günün gezme süresi: yolda geçen vakit düşülür, yol üstü uğramalara birkaç saat ayrılır.
  // Yol üstü uğrama kullanıcı özellikle işaretlediği için yol uzun olsa da en az 75 dk ayrılır (gün uzar, uyarı çıkar).
  const PASS_MIN = 75;
  for (const d of days) {
    const avail = Math.max(0, P - d.drive - (d.drive ? 20 : 0));
    const nPass = d.pass?.length || 0;
    if (d.kind === 'stay') { d.baseBudget = P; continue; }
    if (d.kind === 'arrive') {
      d.passBudget = nPass ? Math.max(PASS_MIN, Math.min(150, (avail * 0.6) / nPass)) : 0;
      d.baseBudget = Math.max(0, avail - d.passBudget * nPass);
    } else { // dönüş günü
      if (!d.to && !nPass) { d.baseBudget = d.base ? P / 2 : 0; d.passBudget = 0; } // yolculuk son şehirde biter
      else {
        d.baseBudget = d.base ? Math.min(nPass ? 120 : 180, avail * 0.5) : 0;
        d.passBudget = nPass ? Math.max(PASS_MIN, Math.min(150, (avail - d.baseBudget) / nPass)) : 0;
      }
    }
    if (d.baseBudget < 60) d.baseBudget = 0;
  }

  // ---- 3. Her şehrin gezilecek yerleri ----
  const need = cities.filter(c => days.some(d => (d.base === c && d.baseBudget > 0) || (d.pass?.includes(c) && d.passBudget > 0)));
  const found = {};
  let partial = false;
  for (let i = 0; i < need.length; i++) {
    const c = need[i];
    progress(t('{c}: gezilecek yerler aranıyor… ({i}/{n})', { c: c.name, i: i + 1, n: need.length }));
    // Gece kalınan yerde çevresi de gezilir (arabayla 15–25 km); yol üstü uğramalarda merkez (5–10 km)
    const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    const radiusKm = c.nights ? clamp(defaultRadiusFor(c.kind), car ? 15 : 8, car ? 25 : 15) : clamp(defaultRadiusFor(c.kind), 5, 10);
    try {
      const res = await fetchPlaces({ lat: c.lat, lon: c.lon, radiusKm, cats: f.interests, hidden: f.hidden });
      found[c.key] = res;
      partial ||= !!res.partial;
    } catch { found[c.key] = []; partial = true; }
  }
  const hours = Object.values(found).map(r => r.hoursReady).filter(Boolean);
  if (hours.length) {
    progress(t('Çalışma saatleri kontrol ediliyor…'));
    await Promise.race([Promise.all(hours), sleep(8000)]);
  }

  // ---- 4. Gün gün plan ----
  progress(t('Günler planlanıyor…'));
  const opts = { pace: f.pace, transport: f.transport, travelers: f.travelers };
  const places = {};
  const add = (p, key) => { places[p.id] = { ...stripPlace(p), city: key }; };
  const baseStops = new Map(), passStops = new Map(); // gün → duraklar
  const alternatives = [];
  const used = new Set(); // birbirine yakın iki şehirde aynı yer iki kez planlanmasın
  for (const c of cities) {
    const sights = (found[c.key] || []).filter(p => isSight(p) && !used.has(p.id));
    const byId = Object.fromEntries(sights.map(p => [p.id, p]));
    const own = days.filter(d => d.base === c);
    if (own.length && sights.length) {
      const plan = buildItinerary(sights, own.map(d => d.date), { ...opts, cc: c.cc, dayBudgets: own.map(d => d.baseBudget) });
      plan.days.forEach((pd, i) => { baseStops.set(own[i], pd.stops); pd.stops.forEach(id => { add(byId[id], c.key); used.add(id); }); });
      for (const id of plan.alternatives.slice(0, 6)) { add(byId[id], c.key); alternatives.push(id); used.add(id); }
    }
    const via = days.find(d => d.pass?.includes(c));
    if (via && via.passBudget > 0 && sights.length) {
      const plan = buildItinerary(sights, [via.date], { ...opts, cc: c.cc, dayBudgets: [via.passBudget] });
      passStops.set(via, [...(passStops.get(via) || []), ...plan.days[0].stops]);
      plan.days[0].stops.forEach(id => { add(byId[id], c.key); used.add(id); });
    }
  }

  const tripDays = days.map(d => {
    const own = baseStops.get(d) || [], via = passStops.get(d) || [];
    const lead = d.base || d.pass?.[0] || d.to;
    return {
      date: d.date,
      stops: d.kind === 'leave' ? [...own, ...via] : [...via, ...own],
      startMin: d.drive > 240 ? 480 : d.kind === 'stay' ? 570 : 540,
      lunch: [], dinner: [],
      from: d.kind === 'stay' ? null : d.from || null,
      sleep: d.kind !== 'leave' && d.base ? asPoint(d.base) : null,
      to: d.kind === 'leave' ? d.to || null : null,
      city: d.kind !== 'leave' && d.base ? d.base.key : null,
      cc: lead?.cc || '',
      drive: Math.round(d.drive),
    };
  });

  const nightCities = cities.filter(c => c.nights);
  const first = nightCities[0] || cities[0];
  const names = [start?.name, ...cities.map(c => c.name), end?.name].filter(Boolean);
  const totalKm = seq.slice(1).reduce((s, p, i) => s + (roads[`${seq[i].city ?? seq[i].key}>${p.city ?? p.key}`]?.km || 0), 0);
  const totalMin = seq.slice(1).reduce((s, p, i) => s + (roads[`${seq[i].city ?? seq[i].key}>${p.city ?? p.key}`]?.min || 0), 0);

  const trip = {
    id: uid(), kind: 'route', name: f.name || names.filter((n, i) => i === 0 || n !== names[i - 1]).join(' → '),
    createdAt: Date.now(), updatedAt: Date.now(),
    dest: { name: first.name, label: names.join(' → '), lat: first.lat, lon: first.lon, cc: first.cc, kind: first.kind, wikidata: first.wikidata, wikipedia: first.wikipedia },
    origin: null, startDate: tripDays[0].date, endDate: tripDays[tripDays.length - 1].date,
    travelers: f.travelers, transport: f.transport, pace: f.pace, level: f.level, stay: f.stay || 'ekonomik',
    radiusKm: null, interests: f.interests, hidden: !!f.hidden,
    route: {
      start, end, back, optimized: !!f.optimize, reordered,
      cities: cities.map(c => ({ key: c.key, name: c.name, label: c.label, lat: c.lat, lon: c.lon, cc: c.cc, kind: c.kind, nights: c.nights, wikidata: c.wikidata || null, wikipedia: c.wikipedia || null })),
      roads, geo, totalKm: Math.round(totalKm), totalMin: Math.round(totalMin),
    },
    places, days: tripDays, alternatives,
    weather: null, drive: null, country: null, countries: {}, destInfo: null, cityInfo: {}, budgetOverrides: {},
    partial,
  };

  // ---- 5. Ek bilgiler (biri başarısız olursa rota yine kaydedilir) ----
  progress(t('Yemek molaları, hava durumu ve yer bilgisi hazırlanıyor…'));
  const soft = (label, fn) => fn().catch(e => console.warn(label, e));
  const foreign = [...new Set(tripDays.map(d => d.cc).filter(cc => cc && cc !== settings.homeCountry))];
  await Promise.all([
    soft('konaklama', () => addLodging(trip)),
    soft('yemek', () => addFoodSuggestions(trip)),
    soft('hava', () => refreshWeather(trip)),
    ...foreign.map(cc => soft('ülke', async () => { trip.countries[cc] = await countryInfo(cc); })),
    ...nightCities.slice(0, 8).map(c => soft('wiki', async () => {
      trip.route.cities[+c.key].info = (await wikiForTags({ wikidata: c.wikidata, wikipedia: c.wikipedia })) || (await wikiSearch(c.name));
    })),
  ]);
  if (foreign.length === 1) trip.country = trip.countries[foreign[0]];
  saveTrip(trip);
  return trip;
}
