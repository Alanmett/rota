// "Nereye gidelim?": uygulamayla gelen veri setinden (data/destinations.json, tools/build-destinations.ps1 üretir)
// yol süresine göre gidilecek yer önerir. Önce kuş uçuşu mesafeyle kaba eleme, sonra gerçek süre:
// araba → OSRM, tren → transport.opendata.ch (İsviçre'den kalkışlarda gerçek tarife).

import { haversineKm, sleep } from './util.js';

export const KINDS = {
  s: { label: 'Şehir & kasaba', emoji: '🏘️' },
  n: { label: 'Doğa', emoji: '🏞️' },
  a: { label: 'Gezilecek yer', emoji: '🏛️' },
};

export const COUNTRY_NAMES = {
  CH: 'İsviçre', IT: 'İtalya', FR: 'Fransa', DE: 'Almanya', AT: 'Avusturya', LI: 'Lihtenştayn', TR: 'Türkiye',
  ES: 'İspanya', PT: 'Portekiz', NL: 'Hollanda', BE: 'Belçika', LU: 'Lüksemburg', CZ: 'Çekya', SI: 'Slovenya',
  HR: 'Hırvatistan', GR: 'Yunanistan', GB: 'Birleşik Krallık', MC: 'Monako', HU: 'Macaristan', PL: 'Polonya',
  DK: 'Danimarka', SM: 'San Marino', VA: 'Vatikan',
};

export const flag = cc => String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));

let cache = null;
export async function loadDestinations() {
  if (cache) return cache;
  const d = await (await fetch('data/destinations.json')).json();
  cache = d.items.map(a => ({ q: a[0], name: a[1], lat: a[2], lon: a[3], cc: a[4], kind: a[5], wv: a[6], sl: a[7], unesco: !!a[8], local: a[9] || a[1] }));
  return cache;
}

// Kaba süre tahmini; yalnızca ön eleme ve gerçek süre alınamazsa kullanılır.
export function estimateHours(km, mode) {
  const road = km * 1.3;
  return mode === 'tren' ? road / 95 + 0.3 : road / 80 + 0.1; // tren: İsviçre hatlarına göre kabaca ayarlı
}

// Önem: kaç dilde gezi rehberi maddesi var (ağırlıklı), ne kadar bilinen bir yer, UNESCO mirası mı
const worth = d => 2.5 * Math.log(1 + d.wv) + Math.log(1 + d.sl) + (d.unesco ? 1.5 : 0);

async function carTimes(origin, list) {
  for (let i = 0; i < list.length; i += 90) {
    const chunk = list.slice(i, i + 90);
    const coords = [origin, ...chunk].map(p => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
    try {
      const r = await getJSON(`https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=duration,distance`, 15000);
      if (r.code !== 'Ok') continue;
      chunk.forEach((p, j) => {
        const sec = r.durations[0][j + 1], m = r.distances?.[0][j + 1];
        if (sec != null) { p.hours = sec / 3600; p.roadKm = m / 1000; p.real = true; }
        else p.unreachable = true; // ör. adalar
      });
    } catch { /* tahminle devam */ }
  }
}

const OPENDATA = 'https://transport.opendata.ch/v1';
const parseDur = s => { const m = s?.match(/(\d+)d(\d+):(\d+)/); return m ? +m[1] * 24 + +m[2] + +m[3] / 60 : null; };

async function getJSON(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await (await fetch(url, { signal: ctl.signal })).json(); } finally { clearTimeout(timer); }
}

// Tarife servisi dakikada sınırlı sorguya izin veriyor: az sayıda aday sorulur, sonuçlar cihazda 30 gün saklanır.
const TRAIN_CACHE = 'rota.trainCache.v1';
const readCache = () => { try { return JSON.parse(localStorage.getItem(TRAIN_CACHE)) || {}; } catch { return {}; } };
const writeCache = c => { try { localStorage.setItem(TRAIN_CACHE, JSON.stringify(c)); } catch { /* yer yoksa önemsiz */ } };

async function trainTimes(origin, list) {
  let from;
  try {
    const st = await getJSON(`${OPENDATA}/locations?x=${origin.lat}&y=${origin.lon}&type=station`, 6000);
    from = st.stations?.find(s => s.id && s.name);
  } catch { return; }
  if (!from) return;
  const cache = readCache();
  const now = Date.now();
  const apply = (p, v) => { if (v?.h != null) Object.assign(p, { hours: v.h, real: true, transfers: v.tr, station: v.st }); };
  const todo = [];
  for (const p of list) {
    const hit = cache[`${from.id}>${p.q}`];
    if (hit && now - hit.t < 30 * 864e5) apply(p, hit); else todo.push(p);
  }
  let limited = false;
  const one = async p => {
    if (limited) return;
    try {
      // Yerel ad gönderilir: servis "Lozan"ı değil "Lausanne"ı tanır
      const r = await getJSON(`${OPENDATA}/connections?from=${encodeURIComponent(from.id)}&to=${encodeURIComponent(p.local || p.name)}&limit=2`, 7000);
      if (r.errors?.some(e => /rate limit|too many/i.test(e.message))) { limited = true; return; }
      const c = r.connections?.[0];
      const h = parseDur(c?.duration);
      const to = c?.to?.station?.coordinate;
      // Ad yanlış bir durağa denk geldiyse kullanma: varış durağı hedefe 25 km'den uzaksa
      const v = h != null && to?.x && haversineKm({ lat: to.x, lon: to.y }, p) <= 25
        ? { h, tr: c.transfers, st: c.to.station.name, t: now } : { h: null, t: now };
      cache[`${from.id}>${p.q}`] = v;
      apply(p, v);
    } catch { /* tahminle devam */ }
  };
  const batch = todo.slice(0, 12);
  for (let i = 0; i < batch.length && !limited; i += 3) await Promise.all(batch.slice(i, i + 3).map(one));
  writeCache(cache);
}

export async function suggest({ origin, minH, maxH, mode, countries, kinds, limit = 24 }, progress = () => {}) {
  progress('Gidilecek yerler taranıyor…');
  const all = await loadDestinations();
  const cset = countries?.length ? new Set(countries) : null;
  const kset = new Set(kinds);
  const cands = [];
  for (const d of all) {
    if (cset && !cset.has(d.cc)) continue;
    if (!kset.has(d.kind)) continue;
    const km = haversineKm(origin, d);
    if (km < 3) continue; // bulunduğun yerin kendisi
    const est = estimateHours(km, mode);
    if (est < minH * 0.6 || est > maxH * 1.4) continue;
    cands.push({ ...d, km, est, s: worth(d) });
  }
  cands.sort((a, b) => b.s - a.s);

  // Aynı noktadaki birçok yer (Como, Bellagio, Varenna…) tek kartta toplanır: "yakınında" olarak gösterilir.
  const picked = [];
  for (const c of cands) {
    const near = picked.find(p => haversineKm(p, c) < 12);
    if (near) { if ((near.nearby ||= []).length < 4) near.nearby.push(c); continue; }
    picked.push(c);
    if (picked.length >= (mode === 'tren' ? 40 : 80)) break;
  }

  progress(mode === 'tren' ? 'Tren bağlantıları aranıyor…' : 'Yol süreleri hesaplanıyor…');
  // Tren: önce tahmini süresi aralığa en yakın, en önemli adaylar sorulur
  if (mode === 'tren') {
    const mid = (minH + maxH) / 2;
    const likely = picked.filter(p => p.est >= minH * 0.7 && p.est <= maxH * 1.3)
      .sort((a, b) => (b.s - Math.abs(b.est - mid)) - (a.s - Math.abs(a.est - mid)));
    await trainTimes(origin, likely.slice(0, 30));
  }
  else await carTimes(origin, picked);

  const ok = picked.filter(p => {
    if (p.unreachable) return false;
    const h = p.hours ?? p.est;
    return h >= minH && h <= maxH;
  });
  ok.sort((a, b) => b.s - a.s);
  return { results: ok.slice(0, limit), scanned: cands.length };
}
