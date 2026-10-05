// Ücretsiz, anahtar gerektirmeyen veri kaynakları:
// OpenStreetMap (Overpass, Nominatim), Wikipedia/Wikidata, Open-Meteo, OSRM, REST Countries.

import { sleep, toISODate, parseISODate } from './util.js';

async function fetchJSON(url, opts = {}, timeout = 20000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; }
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Zaman aşımı');
    if (!navigator.onLine) throw new Error('İnternet bağlantısı yok');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Overpass (mekân ayrıntıları: çalışma saati, lokantalar) ----------
// Ücretsiz sunucu IP başına 2 eşzamanlı sorguya izin verir ve yoğun saatlerde yavaşlar;
// bu yüzden sadece dar alan sorguları gönderilir, uzun beklenmez.
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

export async function overpass(query, timeout = 25000) {
  let last;
  for (const url of OVERPASS) {
    try {
      return await fetchJSON(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      }, timeout);
    } catch (e) {
      last = e;
      if (e.message === 'İnternet bağlantısı yok') break;
    }
  }
  throw new Error(`Harita verisi sunucusuna ulaşılamadı (${last?.message || 'bilinmeyen hata'}). Biraz sonra tekrar dene.`);
}

// ---------- Wikidata (görülmeye değer yerler + önem sırası) ----------
// "sitelinks" = kaç dilde Wikipedia makalesi var; bir yerin ne kadar bilindiğinin iyi bir göstergesi.
// OSM'den gelen yerlerin Wikidata kimliklerinden "kaç dilde maddesi var" sayısını toplu çeker.
export async function wikidataSitelinkCounts(qids) {
  const q = `SELECT ?item ?sl WHERE { VALUES ?item { ${qids.map(x => 'wd:' + x).join(' ')} } ?item wikibase:sitelinks ?sl . }`;
  const r = await fetchJSON(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
    headers: { Accept: 'application/sparql-results+json' },
  }, 15000);
  return new Map(r.results.bindings.map(b => [b.item.value.split('/').pop(), +b.sl.value]));
}

export async function wikidataAround(lat, lon, radiusKm, typeIds) {
  const q = `SELECT ?item ?itemLabel ?coord ?type ?sl ?tr ?en WHERE {
  SERVICE wikibase:around { ?item wdt:P625 ?coord . bd:serviceParam wikibase:center "Point(${lon.toFixed(5)} ${lat.toFixed(5)})"^^geo:wktLiteral . bd:serviceParam wikibase:radius "${radiusKm}" . }
  VALUES ?type { ${typeIds.map(t => 'wd:' + t).join(' ')} }
  ?item wdt:P31 ?type ; wikibase:sitelinks ?sl .
  FILTER(?sl >= 1)
  OPTIONAL { ?tr schema:about ?item ; schema:isPartOf <https://tr.wikipedia.org/> . }
  OPTIONAL { ?en schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "tr,en,de,fr,it". }
} ORDER BY DESC(?sl) LIMIT 600`;
  const r = await fetchJSON(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
    headers: { Accept: 'application/sparql-results+json' },
  }, 30000);
  return r.results.bindings.map(b => {
    const m = b.coord.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
    return {
      qid: b.item.value.split('/').pop(),
      label: b.itemLabel.value,
      lat: m ? +m[2] : null, lon: m ? +m[1] : null,
      type: b.type.value.split('/').pop(),
      sitelinks: +b.sl.value,
      trTitle: b.tr ? decodeURIComponent(b.tr.value.split('/wiki/')[1] || '').replace(/_/g, ' ') : null,
      hasEn: !!b.en,
    };
  }).filter(x => x.lat != null);
}

// ---------- Nominatim (yer arama) ----------
const NOM = 'https://nominatim.openstreetmap.org';
let nomLast = 0;
async function nomThrottle() { // kullanım kuralı: saniyede en fazla 1 istek
  const w = nomLast + 1100 - Date.now();
  if (w > 0) await sleep(w);
  nomLast = Date.now();
}

function normPlace(r) {
  const a = r.address || {};
  const name = r.name || (r.display_name || '').split(',')[0].trim();
  const area = a.town || a.city || a.province || a.state || a.county || '';
  const parts = (r.display_name || '').split(',').map(s => s.trim()).filter(Boolean);
  return {
    name,
    label: [name, area && area !== name ? area : null].filter(Boolean).join(', '),
    detail: parts.slice(1, 4).join(', '),
    lat: +r.lat, lon: +r.lon,
    cc: (a.country_code || '').toLowerCase(),
    country: a.country || '',
    kind: r.addresstype || r.type || '',
    wikidata: r.extratags?.wikidata || null,
    wikipedia: r.extratags?.wikipedia || null,
  };
}

export async function geocode(q) {
  await nomThrottle();
  const u = `${NOM}/search?format=jsonv2&addressdetails=1&extratags=1&limit=6&accept-language=tr&q=${encodeURIComponent(q)}`;
  return (await fetchJSON(u)).map(normPlace);
}

export async function reverseGeocode(lat, lon, zoom = 14) {
  await nomThrottle();
  const u = `${NOM}/reverse?format=jsonv2&addressdetails=1&extratags=1&zoom=${zoom}&accept-language=tr&lat=${lat}&lon=${lon}`;
  const r = await fetchJSON(u);
  return r && !r.error ? normPlace(r) : null;
}

export function defaultRadiusFor(kind) {
  return ({
    city: 15, town: 15, municipality: 15, island: 15,
    village: 5, hamlet: 5, suburb: 5, quarter: 5, neighbourhood: 5,
    county: 40, district: 40, province: 40, state: 40, national_park: 40,
    region: 80,
  })[kind] ?? 15;
}

// ---------- Wikipedia / Wikidata ----------
const wikiCache = new Map();

export async function wikiSummary(lang, title) {
  const key = `${lang}:${title}`;
  if (wikiCache.has(key)) return wikiCache.get(key);
  const u = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  try {
    const r = await fetchJSON(u, {}, 12000);
    const out = r.type === 'disambiguation' || !r.extract ? null : {
      title: r.title, extract: r.extract, thumb: r.thumbnail?.source || null,
      url: r.content_urls?.mobile?.page || r.content_urls?.desktop?.page, lang,
    };
    wikiCache.set(key, out);
    return out;
  } catch {
    return null;
  }
}

async function wikidataSitelinks(qid) {
  const u = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(qid)}&props=sitelinks&sitefilter=trwiki%7Cenwiki&format=json&origin=*`;
  const r = await fetchJSON(u, {}, 12000);
  const sl = r.entities?.[qid]?.sitelinks || {};
  return { tr: sl.trwiki?.title || null, en: sl.enwiki?.title || null };
}

// Türkçe makale varsa onu, yoksa İngilizcesini getirir.
export async function wikiForTags({ wikidata, wikipedia }) {
  if (wikidata) {
    try {
      const s = await wikidataSitelinks(wikidata);
      if (s.tr) { const r = await wikiSummary('tr', s.tr); if (r) return r; }
      if (s.en) { const r = await wikiSummary('en', s.en); if (r) return r; }
    } catch { /* aşağıdaki yolu dene */ }
  }
  if (wikipedia) {
    const m = wikipedia.match(/^([a-z-]{2,12}):(.+)$/);
    if (m) return wikiSummary(m[1], m[2]);
  }
  return null;
}

export async function wikiSearch(q, lang = 'tr') {
  const u = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=1&format=json&origin=*`;
  const r = await fetchJSON(u, {}, 12000);
  const t = r.query?.search?.[0]?.title;
  return t ? wikiSummary(lang, t) : null;
}

// ---------- Open-Meteo (hava) ----------
export function WX(code) {
  if (code === 0) return ['☀️', 'Açık'];
  if (code <= 2) return ['🌤️', 'Parçalı bulutlu'];
  if (code === 3) return ['☁️', 'Kapalı'];
  if (code <= 48) return ['🌫️', 'Sisli'];
  if (code <= 57) return ['🌦️', 'Çisenti'];
  if (code <= 67) return ['🌧️', 'Yağmurlu'];
  if (code <= 77) return ['❄️', 'Karlı'];
  if (code <= 82) return ['🌧️', 'Sağanak'];
  if (code <= 86) return ['🌨️', 'Kar sağanağı'];
  return ['⛈️', 'Gök gürültülü'];
}

export async function weatherNow(lat, lon) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`;
  const r = await fetchJSON(u, {}, 12000);
  return {
    temp: r.current.temperature_2m, code: r.current.weather_code,
    tmax: r.daily.temperature_2m_max[0], tmin: r.daily.temperature_2m_min[0],
    pop: r.daily.precipitation_probability_max?.[0] ?? null,
  };
}

function zipDaily(d, shiftYears = 0) {
  const out = {};
  d.time.forEach((t, i) => {
    const dt = parseISODate(t);
    dt.setFullYear(dt.getFullYear() + shiftYears);
    const iso = toISODate(dt);
    out[iso] = {
      date: iso, code: d.weather_code[i],
      tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i],
      pop: d.precipitation_probability_max?.[i] ?? null,
      rain: d.precipitation_sum?.[i] ?? null,
    };
  });
  return out;
}

// 16 gün içindeyse gerçek tahmin; daha ilerideyse geçen yılın aynı günleri (fikir versin diye).
export async function weatherDaily(lat, lon, startISO, endISO) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = parseISODate(startISO), end = parseISODate(endISO);
  const maxF = new Date(today); maxF.setDate(maxF.getDate() + 15);
  const ll = `latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`;
  if (end >= today && start <= maxF) {
    const s = start < today ? today : start, e = end > maxF ? maxF : end;
    const r = await fetchJSON(`https://api.open-meteo.com/v1/forecast?${ll}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&start_date=${toISODate(s)}&end_date=${toISODate(e)}`, {}, 12000);
    return { source: 'forecast', days: zipDaily(r.daily) };
  }
  if (start > maxF) {
    const back = d => { const x = new Date(d); x.setFullYear(x.getFullYear() - 1); return toISODate(x); };
    const r = await fetchJSON(`https://archive-api.open-meteo.com/v1/archive?${ll}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&start_date=${back(start)}&end_date=${back(end)}`, {}, 15000);
    return { source: 'archive', days: zipDaily(r.daily, 1) };
  }
  return null;
}

// ---------- OSRM (sürüş mesafesi) ----------
export async function driveRoute(a, b) {
  const u = `https://router.project-osrm.org/route/v1/driving/${a.lon.toFixed(5)},${a.lat.toFixed(5)};${b.lon.toFixed(5)},${b.lat.toFixed(5)}?overview=false`;
  const r = await fetchJSON(u, {}, 15000);
  const rt = r.routes?.[0];
  return rt ? { km: rt.distance / 1000, min: rt.duration / 60 } : null;
}

// ---------- REST Countries (yurt dışı bilgileri) ----------
export async function countryInfo(cc) {
  const r = await fetchJSON(`https://restcountries.com/v3.1/alpha/${encodeURIComponent(cc)}?fields=name,translations,currencies,languages,car,idd,region,capital`, {}, 12000);
  const c = Array.isArray(r) ? r[0] : r;
  return {
    name: c.translations?.tur?.common || c.name?.common || cc.toUpperCase(),
    currencies: Object.entries(c.currencies || {}).map(([code, v]) => `${v.name} (${code}${v.symbol ? ', ' + v.symbol : ''})`),
    languages: Object.values(c.languages || {}),
    driveSide: c.car?.side || null,
    idd: (c.idd?.root || '') + (c.idd?.suffixes?.length === 1 ? c.idd.suffixes[0] : ''),
    region: c.region || '',
    capital: c.capital?.[0] || '',
  };
}
