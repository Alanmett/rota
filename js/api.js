// Ücretsiz, anahtar gerektirmeyen veri kaynakları:
// OpenStreetMap (Overpass, Nominatim), Wikipedia/Wikidata, Open-Meteo, OSRM, frankfurter (döviz).

import { sleep, toISODate, parseISODate } from './util.js';
import { t, getLang, locale } from './i18n.js';

// Kullanıcının dili önce, sonra yaygın diller (yer adları ve Wikipedia için)
const langChain = () => [...new Set([getLang(), 'en', 'de', 'fr', 'it', 'tr'])];

async function fetchJSON(url, opts = {}, timeout = 20000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; }
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(t('Zaman aşımı'));
    if (!navigator.onLine) { const err = new Error(t('İnternet bağlantısı yok')); err.offline = true; throw err; }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Overpass (mekân ayrıntıları: çalışma saati, lokantalar) ----------
// Ücretsiz sunucu IP başına 2 eşzamanlı sorguya izin verir ve yoğun saatlerde yavaşlar;
// bu yüzden sadece dar alan sorguları gönderilir, uzun beklenmez.
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

// Sorgular sıraya konur (aynı anda tek sorgu): saat, lokanta ve otopark sorguları birlikte gidince
// sunucu üçüncüsünü "çok fazla istek" (429) diye reddediyordu.
let overpassQueue = Promise.resolve();
export function overpass(query, timeout = 25000, maxServers = OVERPASS.length) {
  const run = overpassQueue.then(() => overpassNow(query, timeout, maxServers));
  overpassQueue = run.catch(() => {});
  return run;
}

async function overpassNow(query, timeout, maxServers) {
  let last;
  for (const url of OVERPASS.slice(0, maxServers)) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await fetchJSON(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
        }, timeout);
      } catch (e) {
        last = e;
        if (e.offline) break;
        if (e.status === 429 && attempt === 0) { await sleep(4000); continue; } // yer açılmasını bekle, bir kez daha dene
        break;
      }
    }
    if (last?.offline) break;
  }
  throw new Error(t('Harita verisi sunucusuna ulaşılamadı ({err}). Biraz sonra tekrar dene.', { err: last?.message || t('bilinmeyen hata') }));
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

// Yarıçaptaki, istenen türden (ya da onun bir alt türünden: "Protestan kilisesi" → "kilise binası") yerler.
// Sorgu yapısı ölçülerek seçildi: önce madde sayısıyla eler, ad/etiket işi yapmaz → yoğun şehirde bile 1–4 sn.
export async function wikidataAround(lat, lon, radiusKm, typeIds, minSitelinks = 1) {
  const list = typeIds.map(t => 'wd:' + t).join(',');
  const q = `SELECT DISTINCT ?item ?coord ?sl ?k WHERE {
  SERVICE wikibase:around { ?item wdt:P625 ?coord . bd:serviceParam wikibase:center "Point(${lon.toFixed(5)} ${lat.toFixed(5)})"^^geo:wktLiteral . bd:serviceParam wikibase:radius "${radiusKm}" . }
  ?item wikibase:sitelinks ?sl . FILTER(?sl >= ${minSitelinks})
  ?item wdt:P31 ?t . OPTIONAL { ?t wdt:P279 ?super . }
  FILTER(?t IN (${list}) || ?super IN (${list}))
  BIND(IF(?t IN (${list}), ?t, ?super) AS ?k)
} LIMIT 5000`;
  const r = await fetchJSON(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
    headers: { Accept: 'application/sparql-results+json' },
  }, 25000);
  const items = new Map();
  for (const b of r.results.bindings) {
    const qid = b.item.value.split('/').pop();
    let it = items.get(qid);
    if (!it) {
      const m = b.coord.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
      if (!m) continue;
      it = { qid, lat: +m[2], lon: +m[1], sitelinks: +b.sl.value, types: [] };
      items.set(qid, it);
    }
    const k = b.k.value.split('/').pop();
    if (!it.types.includes(k)) it.types.push(k);
  }
  return [...items.values()];
}

// Seçilen yerlerin adları (Türkçe varsa Türkçe) ve Türkçe Wikipedia maddesi.
export async function wikidataLabels(qids) {
  if (!qids.length) return new Map();
  // trTitle: kullanıcının dilindeki Wikipedia maddesi (ad tarihsel olarak "tr" kaldı)
  const q = `SELECT ?item ?label ?tr WHERE {
  VALUES ?item { ${qids.map(x => 'wd:' + x).join(' ')} }
  OPTIONAL { ?tr schema:about ?item ; schema:isPartOf <https://${getLang()}.wikipedia.org/> . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${langChain().join(',')}". ?item rdfs:label ?label . }
}`;
  const r = await fetchJSON(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
    headers: { Accept: 'application/sparql-results+json' },
  }, 15000);
  const out = new Map();
  for (const b of r.results.bindings) {
    const qid = b.item.value.split('/').pop();
    out.set(qid, {
      label: b.label?.value || qid,
      trTitle: b.tr ? decodeURIComponent(b.tr.value.split('/wiki/')[1] || '').replace(/_/g, ' ') : null,
    });
  }
  return out;
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

export async function geocode(q, cc = '') {
  await nomThrottle();
  const u = `${NOM}/search?format=jsonv2&addressdetails=1&extratags=1&limit=6&accept-language=${getLang()}&q=${encodeURIComponent(q)}`
    + (/^[a-z]{2}$/.test(cc) ? `&countrycodes=${cc}` : '');
  return (await fetchJSON(u)).map(normPlace);
}

export async function reverseGeocode(lat, lon, zoom = 14) {
  await nomThrottle();
  const u = `${NOM}/reverse?format=jsonv2&addressdetails=1&extratags=1&zoom=${zoom}&accept-language=${getLang()}&lat=${lat}&lon=${lon}`;
  const r = await fetchJSON(u);
  return r && !r.error ? normPlace(r) : null;
}

// Bir noktanın çevresindeki belirli türden yerler (ör. "parking", "restaurant"), ayrıntı etiketleriyle.
// Overpass'e göre çok daha güvenilir ve hızlı (ölçüm: ~0,4 sn); kullanım kuralı gereği saniyede en fazla 1 istek.
export async function nominatimNearby(what, lat, lon, radiusM, limit = 20) {
  await nomThrottle();
  const dLat = radiusM / 111320, dLon = radiusM / (111320 * Math.cos(lat * Math.PI / 180));
  const vb = [lon - dLon, lat + dLat, lon + dLon, lat - dLat].map(x => x.toFixed(5)).join(',');
  const u = `${NOM}/search?format=jsonv2&q=${encodeURIComponent(what)}&viewbox=${vb}&bounded=1&extratags=1&limit=${limit}&accept-language=${getLang()}`;
  return fetchJSON(u, {}, 10000);
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

async function wikidataSitelinks(qid, langs) {
  const u = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(qid)}&props=sitelinks&sitefilter=${langs.map(l => l + 'wiki').join('%7C')}&format=json&origin=*`;
  const r = await fetchJSON(u, {}, 12000);
  const sl = r.entities?.[qid]?.sitelinks || {};
  return Object.fromEntries(langs.map(l => [l, sl[l + 'wiki']?.title || null]));
}

// Kullanıcının dilinde makale varsa onu, yoksa İngilizcesini getirir.
export async function wikiForTags({ wikidata, wikipedia }) {
  const langs = [...new Set([getLang(), 'en'])];
  if (wikidata) {
    try {
      const s = await wikidataSitelinks(wikidata, langs);
      for (const l of langs) if (s[l]) { const r = await wikiSummary(l, s[l]); if (r) return r; }
    } catch { /* aşağıdaki yolu dene */ }
  }
  if (wikipedia) {
    const m = wikipedia.match(/^([a-z-]{2,12}):(.+)$/);
    if (m) return wikiSummary(m[1], m[2]);
  }
  return null;
}

export async function wikiSearch(q, lang = getLang()) {
  const u = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=1&format=json&origin=*`;
  const r = await fetchJSON(u, {}, 12000);
  const title = r.query?.search?.[0]?.title;
  return title ? wikiSummary(lang, title) : null;
}

// ---------- Open-Meteo (hava) ----------
export function WX(code) {
  if (code === 0) return ['☀️', t('Açık')];
  if (code <= 2) return ['🌤️', t('Parçalı bulutlu')];
  if (code === 3) return ['☁️', t('Kapalı')];
  if (code <= 48) return ['🌫️', t('Sisli')];
  if (code <= 57) return ['🌦️', t('Çisenti')];
  if (code <= 67) return ['🌧️', t('Yağmurlu')];
  if (code <= 77) return ['❄️', t('Karlı')];
  if (code <= 82) return ['🌧️', t('Sağanak')];
  if (code <= 86) return ['🌨️', t('Kar sağanağı')];
  return ['⛈️', t('Gök gürültülü')];
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

// ---------- Döviz kuru (Avrupa Merkez Bankası, frankfurter.dev; ücretsiz, anahtarsız) ----------
// Günde bir kez sorulur ve cihazda saklanır; internet yoksa son bilinen kur kullanılır.
export async function exchangeRate(from, to) {
  if (from === to) return 1;
  const KEY = 'rota.fx.v1', k = `${from}>${to}`;
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* boş başla */ }
  const hit = cache[k];
  if (hit && Date.now() - hit.t < 864e5) return hit.r;
  try {
    const r = await fetchJSON(`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`, {}, 8000);
    const rate = r.rates?.[to];
    if (rate) {
      cache[k] = { r: rate, t: Date.now() };
      try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* önemsiz */ }
      return rate;
    }
  } catch { /* eski kurla devam */ }
  return hit?.r ?? null;
}

// ---------- OSRM (sürüş mesafesi) ----------
export async function driveRoute(a, b) {
  const u = `https://router.project-osrm.org/route/v1/driving/${a.lon.toFixed(5)},${a.lat.toFixed(5)};${b.lon.toFixed(5)},${b.lat.toFixed(5)}?overview=false`;
  const r = await fetchJSON(u, {}, 15000);
  const rt = r.routes?.[0];
  return rt ? { km: rt.distance / 1000, min: rt.duration / 60 } : null;
}

const osrmCoords = pts => pts.map(p => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');

// Noktalar arası tüm yol süreleri (dk) ve mesafeleri (km): rota sıralaması için
export async function drivingMatrix(pts) {
  const r = await fetchJSON(`https://router.project-osrm.org/table/v1/driving/${osrmCoords(pts)}?annotations=duration,distance`, {}, 20000);
  if (r.code !== 'Ok') throw new Error('osrm');
  return { min: r.durations.map(row => row.map(s => (s == null ? null : s / 60))), km: r.distances.map(row => row.map(m => (m == null ? null : m / 1000))) };
}

// Sıralı noktalardan geçen gerçek yol: her bacağın süresi/mesafesi ve haritada çizmek için sadeleştirilmiş çizgi
export async function drivingRoute(pts) {
  const r = await fetchJSON(`https://router.project-osrm.org/route/v1/driving/${osrmCoords(pts)}?overview=simplified&geometries=geojson`, {}, 25000);
  const rt = r.routes?.[0];
  if (!rt) throw new Error('osrm');
  return {
    legs: rt.legs.map(l => ({ km: l.distance / 1000, min: l.duration / 60 })),
    // [lat, lon] dizisi, 4 basamak (~10 m) yeterli; cihazda yer kaplamasın
    geo: rt.geometry.coordinates.map(([x, y]) => [Math.round(y * 1e4) / 1e4, Math.round(x * 1e4) / 1e4]),
  };
}

// ---------- Ülke bilgisi (yurt dışı gezileri için; Wikidata, anahtarsız) ----------
// Eskiden REST Countries kullanılıyordu; servis 2026'da eski sürümlerini kapattı ve yenisi API anahtarı istiyor.
// Ülke ve para birimi adları tarayıcının kendi çevirisinden (Intl), başkent ve diller Wikidata'dan gelir.
const PHONE = { ch: '+41', li: '+423', it: '+39', va: '+39', sm: '+378', fr: '+33', mc: '+377', de: '+49', at: '+43', tr: '+90',
  es: '+34', pt: '+351', nl: '+31', be: '+32', lu: '+352', cz: '+420', si: '+386', hr: '+385', gr: '+30', gb: '+44',
  hu: '+36', pl: '+48', dk: '+45' };
const RIGHT_HAND = 'Q14565199'; // Wikidata: sağdan akan trafik

export async function countryInfo(cc) {
  const code = cc.toUpperCase();
  const q = `SELECT ?capitalLabel ?curCode ?langLabel ?side ?idd ?europe WHERE {
  ?c wdt:P297 "${code.replace(/[^A-Z]/g, '')}" .
  OPTIONAL { ?c wdt:P36 ?capital . }
  OPTIONAL { ?c wdt:P38 ?cur . ?cur wdt:P498 ?curCode . }
  OPTIONAL { ?c wdt:P37 ?lang . }
  OPTIONAL { ?c wdt:P1622 ?side . }
  OPTIONAL { ?c wdt:P474 ?idd . }
  BIND(EXISTS { ?c wdt:P30 wd:Q46 } AS ?europe)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${langChain().join(',')}". }
}`;
  const r = await fetchJSON(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
    headers: { Accept: 'application/sparql-results+json' },
  }, 12000);
  const rows = r.results.bindings;
  if (!rows.length) throw new Error('ülke bulunamadı');
  const uniq = key => [...new Set(rows.map(b => b[key]?.value).filter(Boolean))];
  const curNames = new Intl.DisplayNames([locale()], { type: 'currency' });
  const symbol = c => { try { return new Intl.NumberFormat(locale(), { style: 'currency', currency: c }).formatToParts(0).find(p => p.type === 'currency')?.value; } catch { return null; } };
  const idds = uniq('idd');
  const side = uniq('side')[0];
  return {
    name: new Intl.DisplayNames([locale()], { type: 'region' }).of(code) || code,
    currencies: uniq('curCode').filter(c => /^[A-Z]{3}$/.test(c)).map(c => {
      const s = symbol(c);
      return `${curNames.of(c)} (${c}${s && s !== c ? ', ' + s : ''})`;
    }),
    languages: uniq('langLabel').filter(l => !/^Q\d+$/.test(l)),
    driveSide: side ? (side.endsWith(RIGHT_HAND) ? 'right' : 'left') : null,
    idd: PHONE[cc] || (idds.length === 1 ? idds[0] : ''),
    region: uniq('europe')[0] === 'true' ? 'Europe' : '',
    capital: uniq('capitalLabel')[0] || '',
  };
}
