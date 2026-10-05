// Mekân türleri, OpenStreetMap sorguları, sınıflandırma ve puanlama.

import { overpass, wikidataAround, wikidataLabels, wikidataSitelinkCounts, nominatimNearby } from './api.js';
import { bboxAround, haversineKm, normName } from './util.js';
import { t, getLang } from './i18n.js';

export const CATS = {
  tarihi: { label: t('Tarihi'), emoji: '🏛️' },
  muze: { label: t('Müze'), emoji: '🖼️' },
  dogal: { label: t('Doğa'), emoji: '🌲' },
  manzara: { label: t('Manzara'), emoji: '🌄' },
  dini: { label: t('Dini yapı'), emoji: '🕌' },
  plaj: { label: t('Plaj & koy'), emoji: '🏖️' },
  park: { label: t('Park & bahçe'), emoji: '🌳' },
  aile: { label: t('Aile & eğlence'), emoji: '🎡' },
  alisveris: { label: t('Alışveriş'), emoji: '🛍️' },
  yemek: { label: t('Yemek'), emoji: '🍽️' },
  kafe: { label: t('Kafe'), emoji: '☕' },
};
export const SIGHT_CATS = ['tarihi', 'muze', 'dogal', 'manzara', 'dini', 'plaj', 'park', 'aile', 'alisveris'];
// Alışveriş yeri mi (tarihi çarşı gibi hem tarihi hem alışveriş olan yerler gezilecek yer sayılır)
export const isShop = p => p.cats[0] === 'alisveris';

// tür: [etiket, ortalama ziyaret süresi (dk), genelde ücretli mi]
export const TYPES = {
  museum: ['Müze', 90, true], gallery: ['Sanat galerisi', 45, false],
  castle: ['Kale', 75, true], fort: ['Tabya / kale', 60, false], ruins: ['Harabe', 60, false],
  archaeological_site: ['Antik kent / ören yeri', 120, true], monument: ['Anıt', 15, false],
  memorial: ['Anma yeri', 15, false], city_gate: ['Kent kapısı', 15, false], citywalls: ['Surlar', 30, false],
  tomb: ['Türbe / anıt mezar', 20, false], aqueduct: ['Su kemeri', 20, false], palace: ['Saray', 120, true],
  manor: ['Konak', 45, false], caravanserai: ['Kervansaray / han', 40, false], monastery: ['Manastır', 60, true],
  church: ['Kilise', 30, false], mosque: ['Cami', 30, false], synagogue: ['Sinagog', 30, false],
  worship: ['İbadethane', 30, false], bridge: ['Tarihi köprü', 15, false], tower: ['Kule', 40, true],
  clock_tower: ['Saat kulesi', 15, false], madrasa: ['Medrese', 30, false], hammam: ['Tarihi hamam', 30, false],
  kulliye: ['Külliye', 60, false], bedesten: ['Bedesten / tarihi çarşı', 45, false], old_town: ['Tarihi kent dokusu', 90, false],
  lighthouse: ['Deniz feneri', 20, false], plateau: ['Yayla', 120, false],
  historic: ['Tarihi yer', 30, false],
  waterfall: ['Şelale', 60, false], cave_entrance: ['Mağara', 75, true], gorge: ['Kanyon', 120, true],
  canyon: ['Kanyon', 120, true], hot_spring: ['Kaplıca / termal', 120, true], spring: ['Kaynak', 30, false],
  arch: ['Doğal kaya kemeri', 30, false], peak: ['Zirve', 120, false], volcano: ['Volkanik dağ', 120, false],
  water: ['Göl', 60, false], nature: ['Doğal alan', 60, false],
  nature_reserve: ['Tabiat parkı / koruma alanı', 120, true], national_park: ['Milli park', 180, true],
  beach: ['Plaj', 150, false], bay: ['Koy', 120, false], viewpoint: ['Seyir noktası', 25, false],
  park: ['Park', 45, false], garden: ['Bahçe', 45, false],
  zoo: ['Hayvanat bahçesi', 150, true], theme_park: ['Tema park', 240, true], aquarium: ['Akvaryum', 90, true],
  water_park: ['Su parkı', 240, true], attraction: ['Gezilecek yer', 40, false],
  outlet: ['Outlet', 150, false], mall: ['Alışveriş merkezi', 90, false], department_store: ['Büyük mağaza', 60, false],
  market: ['Pazar yeri', 45, false], market_hall: ['Kapalı çarşı / hal', 45, false], bazaar: ['Çarşı', 60, false],
  flea_market: ['Bit pazarı', 60, false], shopping_street: ['Alışveriş caddesi', 60, false],
  restaurant: ['Restoran', 60, false], cafe: ['Kafe', 40, false],
};

const TYPE_EMOJI = {
  museum: '🏛️', gallery: '🖼️', castle: '🏰', fort: '🏰', ruins: '🏛️', archaeological_site: '🏺',
  palace: '👑', mosque: '🕌', church: '⛪', synagogue: '🕍', monastery: '⛪', bridge: '🌉', tower: '🗼',
  clock_tower: '🕰️', madrasa: '🕌', kulliye: '🕌', hammam: '♨️', caravanserai: '🏛️', bedesten: '🛍️', old_town: '🏘️',
  lighthouse: '🗼', plateau: '⛰️',
  waterfall: '💧', cave_entrance: '🕳️', gorge: '🏞️', canyon: '🏞️', hot_spring: '♨️', spring: '💧',
  peak: '⛰️', volcano: '🌋', water: '🏞️', nature_reserve: '🌲', national_park: '🌲',
  beach: '🏖️', bay: '🏝️', viewpoint: '🌄', park: '🌳', garden: '🌷',
  zoo: '🦁', theme_park: '🎢', aquarium: '🐠', water_park: '🌊', restaurant: '🍽️', cafe: '☕',
  outlet: '🛍️', mall: '🏬', department_store: '🏬', market: '🧺', market_hall: '🧺', bazaar: '🛍️', flea_market: '🧺',
  shopping_street: '🛍️',
};

export const typeLabel = p => t(TYPES[p.type]?.[0] || 'Yer');
export const catEmoji = p => TYPE_EMOJI[p.type] || CATS[p.cats?.[0]]?.emoji || '📍';
export const isSight = p => p.cats.some(c => c !== 'yemek' && c !== 'kafe');
export function isPaid(p) {
  const f = p.tags?.fee;
  if (f === 'no') return false;
  if (f === 'yes' || p.tags?.charge) return true;
  return !!TYPES[p.type]?.[2];
}
export const MUZEKART_TYPES = new Set(['museum', 'archaeological_site', 'palace']);

// {b}: alan filtresi, {n}: geniş aramalarda yalnızca "öne çıkan" (Wikidata kaydı olan) yerler
const CLAUSES = {
  tarihi: [
    'nwr["historic"~"^(castle|fort|ruins|archaeological_site|monument|city_gate|citywalls|tomb|aqueduct|palace|caravanserai|monastery|church|mosque|manor)$"]["name"]{n}{b};',
    'nwr["historic"]["wikidata"]{b};',
    'nwr["amenity"="place_of_worship"]["wikipedia"]{b};',
    'nwr["amenity"="place_of_worship"]["heritage"]{b};',
  ],
  muze: ['nwr["tourism"~"^(museum|gallery)$"]["name"]{b};'],
  dogal: [
    'nwr["natural"~"^(waterfall|cave_entrance|gorge|canyon|hot_spring|arch|spring)$"]["name"]{b};',
    'nwr["waterway"="waterfall"]["name"]{b};',
    'nwr["natural"~"^(peak|volcano|water)$"]["wikidata"]{b};',
    'nwr["leisure"="nature_reserve"]["name"]{b};',
    'nwr["boundary"="national_park"]["name"]{b};',
    'nwr["boundary"="protected_area"]["wikidata"]{b};',
  ],
  manzara: ['nwr["tourism"="viewpoint"]["name"]{b};'],
  dini: [
    'nwr["amenity"="place_of_worship"]["wikidata"]{b};',
    'nwr["amenity"="place_of_worship"]["historic"]["name"]{b};',
  ],
  plaj: ['nwr["natural"~"^(beach|bay)$"]["name"]{b};', 'nwr["leisure"="beach_resort"]["name"]{b};'],
  park: [
    'nwr["leisure"~"^(park|garden)$"]["name"]["wikidata"]{b};',
    'nwr["leisure"~"^(park|garden)$"]["tourism"="attraction"]["name"]{b};',
  ],
  aile: ['nwr["tourism"~"^(zoo|theme_park|aquarium)$"]["name"]{b};', 'nwr["leisure"="water_park"]["name"]{b};'],
  alisveris: [], // her mesafede Nominatim'den (fetchShopping)
  yemek: ['nwr["amenity"="restaurant"]["name"]{b};'],
  kafe: ['nwr["amenity"="cafe"]["name"]{b};'],
};

function classify(t) {
  const cats = [];
  const add = c => { if (!cats.includes(c)) cats.push(c); };
  let type;
  const rel = t.religion;
  if (t.amenity === 'restaurant') { add('yemek'); type = 'restaurant'; }
  else if (t.amenity === 'cafe') { add('kafe'); type = 'cafe'; }
  else if (t.shop === 'mall') { add('alisveris'); type = OUTLET_NAME.test(t.name || '') ? 'outlet' : 'mall'; }
  else if (t.shop === 'department_store') { add('alisveris'); type = 'department_store'; }
  else if (t.amenity === 'marketplace') { add('alisveris'); type = 'market'; }
  else if (t.tourism === 'museum' || t.tourism === 'gallery') { add('muze'); type = t.tourism; }
  else if (['zoo', 'theme_park', 'aquarium'].includes(t.tourism) || t.leisure === 'water_park') {
    add('aile'); type = t.leisure === 'water_park' ? 'water_park' : t.tourism;
  }
  else if (t.amenity === 'place_of_worship') {
    add('dini'); type = rel === 'muslim' ? 'mosque' : rel === 'christian' ? 'church' : rel === 'jewish' ? 'synagogue' : 'worship';
  }
  else if (t.historic) {
    add('tarihi'); type = TYPES[t.historic] ? t.historic : 'historic';
    if (['mosque', 'church', 'monastery', 'synagogue'].includes(t.historic)) add('dini');
  }
  else if (t.natural === 'beach' || t.natural === 'bay' || t.leisure === 'beach_resort') { add('plaj'); type = t.natural === 'bay' ? 'bay' : 'beach'; }
  else if (t.waterway === 'waterfall' || t.natural) { add('dogal'); type = t.waterway === 'waterfall' ? 'waterfall' : (TYPES[t.natural] ? t.natural : 'nature'); }
  else if (t.boundary === 'national_park') { add('dogal'); type = 'national_park'; }
  else if (t.leisure === 'nature_reserve' || t.boundary === 'protected_area') { add('dogal'); type = 'nature_reserve'; }
  else if (t.tourism === 'viewpoint') { add('manzara'); type = 'viewpoint'; }
  else if (t.leisure === 'park' || t.leisure === 'garden') { add('park'); type = t.leisure; }
  else { add('gezi'); type = 'attraction'; }
  if (t.historic || (t.amenity === 'place_of_worship' && (t.wikipedia || t.heritage))) add('tarihi');
  if (t.tourism === 'viewpoint') add('manzara');
  return { cats, type };
}

const TYPE_BOOST = {
  archaeological_site: 1.5, palace: 1.5, castle: 1, museum: 1.5, waterfall: 1, national_park: 1, gorge: 1, old_town: 1.5,
  canyon: 1, cave_entrance: 0.8, viewpoint: 0.3, monument: -0.5, memorial: -0.8, tomb: -0.3, worship: -0.5, park: -0.3,
};

// Önem ölçüsü: bir yerin kaç dilde Wikipedia maddesi olduğu. Her kaynaktan gelen yer bu ortak ölçüyle puanlanır;
// böylece OSM'de çok ayrıntılı etiketlenmiş küçük bir müze, dünyaca bilinen bir yerin önüne geçmez.
const popularity = (sitelinks, hasTr) => 2.2 * Math.log(1 + sitelinks) + (hasTr ? 0.5 : 0);

// OSM'nin kendi sinyalleri (koruma statüsü, turistik etiketi vb.); önem puanı ayrıca eklenir.
function osmBase(t, type) {
  let s = 1;
  if (t.heritage) s += 1;
  if (t.tourism === 'attraction') s += 0.5;
  if (t.image || t.wikimedia_commons) s += 0.3;
  if (t.website || t['contact:website']) s += 0.2;
  if (t.opening_hours) s += 0.2;
  return s + (TYPE_BOOST[type] || 0);
}
// Wikidata sayısı alınamazsa kullanılacak kaba tahmin
const wikiFallback = t => (t.wikipedia ? 2.5 : 0) + (t.wikidata ? 1 : 0);

const KEEP = ['name', 'name:tr', 'name:en', 'name:fr', 'opening_hours', 'website', 'contact:website', 'phone', 'contact:phone',
  'wikipedia', 'wikidata', 'fee', 'charge', 'cuisine', 'addr:street', 'addr:housenumber', 'addr:district', 'addr:city',
  'addr:province', 'description', 'description:tr', 'image', 'wikimedia_commons', 'religion', 'historic', 'tourism',
  'natural', 'amenity', 'leisure', 'ele', 'heritage', 'wheelchair', 'diet:vegetarian'];

function parseElements(elements) {
  const out = [];
  const lang = getLang();
  for (const el of elements || []) {
    const t = el.tags || {};
    const name = t[`name:${lang}`] || t.name;
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (!name || lat == null || lon == null || GENERIC_NAME.test(name)) continue;
    const { cats, type } = classify(t);
    const tags = {};
    for (const k of KEEP) if (t[k] != null) tags[k] = t[k];
    const base = osmBase(t, type);
    out.push({
      id: el.type[0] + el.id, name, lat, lon, cats, type,
      dur: TYPES[type]?.[1] || 40, score: base + wikiFallback(t), _base: base, hours: t.opening_hours || null, tags,
    });
  }
  return out;
}

// Türkçe ek farklarını tolere eden ad karşılaştırması: "Cinci Han" ≈ "Cinci Hanı", "Kale" ≈ "Kalesi".
const tokMatch = (x, y) => x === y || (Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x)) && Math.abs(x.length - y.length) <= 3);
function sameName(a, b) {
  if (a === b) return true;
  if ((a.length > 5 && b.includes(a)) || (b.length > 5 && a.includes(b))) return true;
  const ta = a.split(' '), tb = b.split(' ');
  return ta.length === tb.length && ta.every((t, i) => tokMatch(t, tb[i]));
}

// Aynı yerin birden fazla kaydı (nokta + alan, OSM + Wikidata, "X Evi" / "X Müzesi") tek kayda indirilir.
function dedupe(list) {
  list.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const p of list) {
    const n = normName(p.name);
    const first = n.split(' ')[0];
    const dup = kept.find(k => {
      const d = haversineKm(k, p);
      if (d < 0.4 && sameName(k._n, n)) return true;
      return first.length >= 5 && k._n.split(' ')[0] === first && d < 0.06;
    });
    if (dup) {
      for (const c of p.cats) if (!dup.cats.includes(c)) dup.cats.push(c);
      if (!dup.hours && p.hours) dup.hours = p.hours; // Wikidata kaydına OSM'deki çalışma saatini taşı
      dup.tags = { ...p.tags, ...dup.tags };
      continue;
    }
    p._n = n;
    kept.push(p);
  }
  for (const p of kept) delete p._n;
  return kept;
}

const query = (parts, limit) =>
  `[out:json][timeout:25];(${parts.join('')})->.r;node.r;out body ${limit};(way.r;relation.r;);out tags center ${limit};`;

// Wikidata türü → [kategori, bizim tür]. Kimlikler Wikidata'da tek tek doğrulandı.
const WD_TYPES = {
  Q33506: ['muze', 'museum'], Q207694: ['muze', 'museum'], Q3329412: ['muze', 'museum'], Q1007870: ['muze', 'gallery'],
  Q839954: ['tarihi', 'archaeological_site'], Q15661340: ['tarihi', 'archaeological_site'], Q109607: ['tarihi', 'ruins'],
  Q23413: ['tarihi', 'castle'], Q17715832: ['tarihi', 'castle'], Q57821: ['tarihi', 'fort'], Q1785071: ['tarihi', 'fort'],
  Q16560: ['tarihi', 'palace'], Q381885: ['tarihi', 'tomb'], Q838159: ['tarihi', 'tomb'], Q162875: ['tarihi', 'tomb'],
  Q1404229: ['tarihi', 'tomb'], Q12280: ['tarihi', 'bridge'], Q474: ['tarihi', 'aqueduct'], Q4989906: ['tarihi', 'monument'],
  Q132834: ['tarihi', 'madrasa'], Q28077: ['tarihi', 'hammam'], Q12518: ['tarihi', 'tower'], Q853854: ['tarihi', 'clock_tower'],
  Q1081138: ['tarihi', 'historic'], Q1802963: ['tarihi', 'manor'], Q1497375: ['tarihi', 'historic'],
  Q186347: ['tarihi', 'caravanserai'], Q256020: ['tarihi', 'caravanserai'], Q71974: ['tarihi', 'kulliye'],
  Q829896: ['tarihi', 'bedesten'], Q15243209: ['tarihi', 'old_town'], Q676050: ['tarihi', 'old_town'],
  Q32815: ['dini', 'mosque'], Q16970: ['dini', 'church'], Q2977: ['dini', 'church'], Q108325: ['dini', 'church'],
  Q44613: ['dini', 'monastery'], Q34627: ['dini', 'synagogue'],
  Q34038: ['dogal', 'waterfall'], Q35509: ['dogal', 'cave_entrance'], Q2232001: ['dogal', 'cave_entrance'],
  Q150784: ['dogal', 'canyon'], Q46169: ['dogal', 'national_park'], Q179049: ['dogal', 'nature_reserve'],
  Q23397: ['dogal', 'water'], Q8502: ['dogal', 'peak'], Q177380: ['dogal', 'hot_spring'], Q124714: ['dogal', 'spring'],
  Q75520: ['dogal', 'plateau'],
  Q6017969: ['manzara', 'viewpoint'], Q1440300: ['manzara', 'viewpoint'], Q39715: ['manzara', 'lighthouse'],
  Q40080: ['plaj', 'beach'], Q39594: ['plaj', 'bay'], Q22698: ['park', 'park'], Q1107656: ['park', 'garden'],
  Q43501: ['aile', 'zoo'], Q2416723: ['aile', 'theme_park'], Q2281788: ['aile', 'aquarium'],
  Q11315: ['alisveris', 'mall'], Q31374404: ['alisveris', 'mall'], Q54927709: ['alisveris', 'outlet'],
  Q216107: ['alisveris', 'department_store'], Q2080521: ['alisveris', 'market_hall'], Q219760: ['alisveris', 'bazaar'],
  Q385870: ['alisveris', 'flea_market'], Q21000333: ['alisveris', 'shopping_street'],
  Q570116: ['gezi', 'attraction'],
};
const GENERIC = new Set(['attraction', 'historic', 'bridge']); // birden fazla tür varsa daha özel olan seçilir
const NOISY_NATURE = new Set(['peak', 'water', 'plateau', 'spring']); // botların ürettiği tek satırlık maddeler çok
const MINOR_IF_OBSCURE = new Set(['mosque', 'church', 'tomb', 'bridge', 'clock_tower', 'monument', 'park']);
const GENERIC_NAME = /^(köprü|cami|camii|mescit|kilise|türbe|çeşme|han|hamam|kale|bridge|mosque|church)(\s*\d+)?$/i;

async function fetchWikidataPlaces(lat, lon, radiusKm, sightCats) {
  const want = new Set([...sightCats, 'gezi']);
  const ids = Object.keys(WD_TYPES).filter(q => want.has(WD_TYPES[q][0]) || (WD_TYPES[q][0] === 'dini' && want.has('tarihi')));
  // Geniş alanda yalnızca daha bilinen yerler (aksi halde binlerce küçük kayıt gelir).
  const minSl = radiusKm <= 15 ? 1 : radiusKm <= 60 ? 3 : 5;
  const items = await wikidataAround(lat, lon, radiusKm, ids, minSl);
  const typed = [];
  for (const it of items) {
    const mapped = it.types.map(t => WD_TYPES[t]).filter(Boolean);
    const best = mapped.find(([, type]) => !GENERIC.has(type)) || mapped[0];
    if (best) typed.push({ ...it, cat: best[0], type: best[1] });
  }
  // Ad sorgusu yalnızca en önemli 200 yer için
  typed.sort((a, b) => b.sitelinks - a.sitelinks);
  const top = typed.slice(0, 200);
  const labels = await wikidataLabels(top.map(r => r.qid));
  const out = [];
  for (const it of top) {
    const lb = labels.get(it.qid);
    if (!lb || /^Q\d+$/.test(lb.label)) continue;
    const r = { ...it, label: lb.label, trTitle: lb.trTitle };
    if (NOISY_NATURE.has(r.type) && !r.trTitle && r.sitelinks < 3) continue;
    if (GENERIC_NAME.test(r.label)) continue; // "Köprü 2", "Cami" gibi adsız kayıtlar
    if (r.cat === 'alisveris' && NOT_SHOPPING.test(r.label)) continue;
    const cats = [r.cat];
    if (r.cat === 'dini') cats.push('tarihi'); // Wikipedia'da maddesi olan cami/kilise çoğunlukla tarihi
    if (r.type === 'bedesten') cats.push('alisveris');
    let s = 1 + popularity(r.sitelinks, !!r.trTitle) + (TYPE_BOOST[r.type] || 0);
    if (r.type === 'archaeological_site' && r.sitelinks < 3) s -= 2; // görünür kalıntısı olmayan antik yerleşimler
    if (MINOR_IF_OBSCURE.has(r.type) && r.sitelinks <= 1) s -= 1.2; // tek maddeli mahalle camisi, küçük köprü vb.
    out.push({
      id: 'q' + r.qid.slice(1), name: r.label.split(/\s*[,(]/)[0].trim() || r.label, lat: r.lat, lon: r.lon,
      cats, type: r.type, dur: TYPES[r.type]?.[1] || 40, score: s, hours: null, _sl: r.sitelinks,
      tags: { wikidata: r.qid, ...(r.trTitle ? { wikipedia: `${getLang()}:${r.trTitle}` } : {}) },
    });
  }
  return out;
}

// Kaynak stratejisi (ölçümle belirlendi): Wikidata her mesafede hızlı ve güvenilir (Zürih 10 km: <1 sn).
// Ücretsiz OSM sunucuları şehir ölçeğinde alan taramasında sık sık zaman aşımına düşüyor; bu yüzden OSM'den
// alan taraması yalnızca yürüme mesafesinde yapılır, diğer durumlarda sadece nokta atışı sorgular (çalışma saati).
const OSM_DETAIL_MAX_KM = 3;

// Seçilen yerlerin OSM'deki çalışma saatini, Wikidata kimliğiyle ve çok küçük alanlarda arayarak ekler.
// Ucuz bir sorgudur; sunucu yanıt vermezse sessizce atlanır.
export async function enrichHours(places, limit = 60) {
  const need = places.filter(p => !p.hours && /^Q\d+$/.test(p.tags?.wikidata || '')).slice(0, limit);
  if (!need.length) return;
  const parts = need.map(p => `nwr(around:300,${p.lat.toFixed(5)},${p.lon.toFixed(5)})["wikidata"="${p.tags.wikidata}"];`);
  const data = await overpass(`[out:json][timeout:12];(${parts.join('')});out tags;`, 12000, 1);
  const byQ = new Map();
  for (const el of data.elements || []) if (el.tags?.wikidata) byQ.set(el.tags.wikidata, el.tags);
  for (const p of need) {
    const t = byQ.get(p.tags.wikidata);
    if (!t) continue;
    if (t.opening_hours) p.hours = t.opening_hours;
    for (const k of ['website', 'contact:website', 'phone', 'fee', 'wheelchair', 'addr:street', 'addr:housenumber', 'addr:city']) {
      if (t[k] && !p.tags[k]) p.tags[k] = t[k];
    }
  }
}

// ---------- Alışveriş ----------
// AVM ve outletler, pazar yerleri. Kaynak Nominatim (OSM): AVM'lerin çoğunun Wikidata kaydı yok (ör. FoxTown),
// Overpass ise geniş alanda güvenilmez. Ünlü çarşılar, alışveriş caddeleri ve büyük mağazalar Wikidata'dan gelir.
const OUTLET_NAME = /outlet|factory stores?|designer village|\bvillage\b/i;
const NOT_SHOPPING = /raststätte|rastplatz|autogrill|area di servizio|aire de service|tankstelle|parking|parcheggio/i;

function nomShop(r, i, n, type) {
  const ex = r.extratags || {};
  const tags = { name: r.name };
  for (const k of ['opening_hours', 'website', 'contact:website', 'phone', 'wikidata', 'wheelchair']) if (ex[k]) tags[k] = ex[k];
  // Nominatim sonuçları önem sırasıyla gelir; sıradaki yeri de hesaba katılır
  const base = 1 + (1 - i / n) * 0.8 + (type === 'outlet' ? 1.5 : 0) + (ex.opening_hours ? (type === 'market' ? 0.6 : 0.2) : 0)
    + (ex.website || ex['contact:website'] ? 0.2 : 0);
  return {
    id: (r.osm_type || 'n')[0] + r.osm_id, name: r.name, lat: +r.lat, lon: +r.lon, cats: ['alisveris'], type,
    dur: TYPES[type][1], score: base + (ex.wikidata ? 1.5 : 0), _base: base, hours: ex.opening_hours || null, tags,
  };
}

async function fetchShopping(lat, lon, radiusKm) {
  const out = [];
  const malls = (await nominatimNearby('mall', lat, lon, radiusKm * 1000, 40))
    .filter(r => r.category === 'shop' && r.type === 'mall' && r.name && !NOT_SHOPPING.test(r.name));
  malls.forEach((r, i) => out.push(nomShop(r, i, malls.length, OUTLET_NAME.test(r.name) ? 'outlet' : 'mall')));
  // Pazar yerleri: uzaktaki semt pazarına gidilmez; en fazla 10 km
  try {
    const markets = (await nominatimNearby('marketplace', lat, lon, Math.min(radiusKm, 10) * 1000, 25))
      .filter(r => r.category === 'amenity' && r.type === 'marketplace' && r.name && !NOT_SHOPPING.test(r.name));
    markets.forEach((r, i) => out.push(nomShop(r, i, markets.length, 'market')));
  } catch { /* AVM'lerle devam */ }
  return out;
}

export async function fetchPlaces({ lat, lon, radiusKm, cats }) {
  const sight = cats.filter(c => SIGHT_CATS.includes(c));
  const food = cats.filter(c => c === 'yemek' || c === 'kafe');
  if (!sight.length && !food.length) return [];
  const parts = [];
  if (sight.length && radiusKm <= OSM_DETAIL_MAX_KM) {
    const b = '(' + bboxAround(lat, lon, radiusKm).map(x => x.toFixed(5)).join(',') + ')';
    for (const c of sight) for (const q of CLAUSES[c]) parts.push(q.replaceAll('{b}', b).replaceAll('{n}', ''));
    parts.push(`nwr["tourism"="attraction"]["name"]${b};`);
  }
  if (food.length) {
    const a = `(around:${Math.round(Math.min(radiusKm * 1000, 2000))},${lat.toFixed(5)},${lon.toFixed(5)})`;
    for (const c of food) for (const q of CLAUSES[c]) parts.push(q.replaceAll('{b}', a).replaceAll('{n}', ''));
  }
  let osmErr = null, wdErr = null, shopErr = null;
  const [osmDetail, wd, shops] = await Promise.all([
    parts.length ? overpass(query(parts, 1000), 20000).then(d => parseElements(d.elements)).catch(e => { osmErr = e; return []; }) : [],
    sight.length ? fetchWikidataPlaces(lat, lon, radiusKm, sight).catch(e => { wdErr = e; return []; }) : [],
    sight.includes('alisveris') ? fetchShopping(lat, lon, radiusKm).catch(e => { shopErr = e; return []; }) : [],
  ]);
  const osm = [...osmDetail, ...shops];
  if (!osm.length && !wd.length && (osmErr || wdErr || shopErr)) throw osmErr || wdErr || shopErr;

  // OSM yerlerini ortak önem ölçüsüyle puanla: Wikidata kimliği olanların madde sayısını topluca çek.
  const sl = new Map(wd.map(w => [w.tags.wikidata, w._sl]));
  const missing = [...new Set(osm.map(p => p.tags.wikidata).filter(q => q && /^Q\d+$/.test(q) && !sl.has(q)))].slice(0, 250);
  if (missing.length) {
    try { for (const [q, n] of await wikidataSitelinkCounts(missing)) sl.set(q, n); } catch { /* kaba tahminle devam */ }
  }
  for (const p of osm) {
    const n = sl.get(p.tags.wikidata);
    if (n != null) p.score = p._base + popularity(n, (p.tags.wikipedia || '').startsWith(`${getLang()}:`));
  }

  // Aynı Wikidata kimliğine sahip OSM kaydı varsa birleştir (OSM'nin saat bilgisi + Wikidata'nın türü/kategorisi).
  const osmByQ = new Map(osm.filter(p => p.tags.wikidata).map(p => [p.tags.wikidata, p]));
  const merged = [...osm];
  for (const w of wd) {
    const o = osmByQ.get(w.tags.wikidata);
    if (o) {
      for (const c of w.cats) if (!o.cats.includes(c)) o.cats.push(c);
      if (w.tags.wikipedia && !o.tags.wikipedia?.startsWith(`${getLang()}:`)) o.tags.wikipedia = w.tags.wikipedia;
    } else merged.push(w);
  }

  const want = new Set(cats);
  const origin = { lat, lon };
  const list = merged.filter(p => p.cats.some(c => want.has(c)) || p.cats[0] === 'gezi');
  for (const p of list) p.dist = haversineKm(origin, p);
  const result = dedupe(list.filter(p => p.dist <= radiusKm * 1.08));
  // Wikidata çöktüyse liste eksiktir; OSM'nin çökmesi yalnızca yürüme mesafesinde ayrıntı kaybıdır.
  result.partial = !!wdErr || !!shopErr || (!!osmErr && radiusKm <= OSM_DETAIL_MAX_KM);
  // Çalışma saatleri arka planda eklenir; çağıran isterse bekler (plan), istemezse listeyi hemen gösterir (Keşfet).
  result.hoursReady = sight.length
    ? enrichHours([...result].sort((a, b) => b.score - a.score)).catch(() => {})
    : Promise.resolve();
  return result;
}

const LOCAL_CUISINE = /turkish|kebab|regional|local|fish|seafood|pide|kofte|meatball|lahmacun|manti|anatolian|ottoman|homestyle|meyhane|doner|swiss|fondue|raclette|alpine/i;
function foodScore(f) {
  const t = f.tags;
  let s = 0;
  if (t.cuisine) s += 1;
  if (LOCAL_CUISINE.test(t.cuisine || '')) s += 1;
  if (t.wikidata) s += 2;
  if (t.opening_hours) s += 0.3;
  if (t.website || t['contact:website']) s += 0.3;
  if (/lokanta|ocakbaşı|kebap|pide|köfte|balık|ev yemek/i.test(f.name)) s += 0.5;
  return s;
}

// Nominatim sonucunu uygulamadaki yer biçimine çevirir (lokanta önerileri için)
function nomToPlace(r) {
  const ex = r.extratags || {};
  const tags = { name: r.name };
  for (const k of ['cuisine', 'opening_hours', 'website', 'contact:website', 'phone', 'wikidata', 'diet:vegetarian']) if (ex[k]) tags[k] = ex[k];
  return {
    id: (r.osm_type || 'n')[0] + r.osm_id, name: r.name, lat: +r.lat, lon: +r.lon,
    cats: ['yemek'], type: 'restaurant', dur: 60, score: 0, hours: ex.opening_hours || null, tags,
  };
}

// Her nokta (öğle/akşam molası yeri) için yakındaki en uygun 3 restoran.
// Kaynak Nominatim: ölçümlerde Overpass sık sık zaman aşımına düştü, Nominatim ~0,4 sn'de yanıt verdi.
// Bir nokta başarısız olursa o nokta sonuçta yer almaz (sonra yeniden denenebilir).
export async function fetchFoodNear(points, radiusM = 800) {
  const res = {};
  for (const p of points) {
    try {
      const rows = (await nominatimNearby('restaurant', p.lat, p.lon, radiusM, 25))
        .filter(r => r.category === 'amenity' && r.type === 'restaurant' && r.name);
      res[p.key] = rows.map(nomToPlace)
        .map(f => ({ f, d: haversineKm(p, f) }))
        .filter(x => x.d <= radiusM / 1000 * 1.2)
        .map(x => ({ f: x.f, s: foodScore(x.f) - x.d * 2 }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 3)
        .map(x => x.f);
    } catch { /* bu nokta atlanır */ }
  }
  return res;
}

// ---------- Otoparklar ----------
// Herkese açık otoparklar; özel, müşteriye özel ve izinli olanlar elenir.
// Kapalı otopark ve Park+Ride önde, sokak kenarı en sonda; kapasite ve yakınlık da hesaba katılır.
const CLOSED_ACCESS = new Set(['private', 'customers', 'no', 'delivery', 'permit', 'residents', 'employees']);

function parkingKind(tg) {
  if (tg.park_ride && tg.park_ride !== 'no') return 'pr';
  if (tg.parking === 'multi-storey' || tg.parking === 'underground' || tg.parking === 'rooftop') return 'garage';
  if (tg.parking === 'street_side' || tg.parking === 'lane' || tg.parking === 'layby') return 'street';
  return 'surface';
}
const PARK_BASE = { garage: 2, pr: 2.5, surface: 1, street: 0.2 };
export const PARKING_LABEL = { garage: t('Kapalı otopark'), pr: 'Park+Ride', surface: t('Açık otopark'), street: t('Yol kenarı park') };

export async function fetchParkingNear(points, radiusM = 600) {
  const res = {};
  for (const p of points) {
    try {
      const rows = (await nominatimNearby('parking', p.lat, p.lon, radiusM, 25))
        .filter(r => r.category === 'amenity' && r.type === 'parking');
      const lots = [];
      for (const r of rows) {
        const tg = { ...(r.extratags || {}), name: r.name || r.extratags?.operator || null };
        if (CLOSED_ACCESS.has(tg.access)) continue;
        if (tg.name && /^\d+$/.test(tg.name)) tg.name = null; // "911" gibi anlamsız adlar
        // Şirket otoparkları (… AG, GmbH, SA) çoğunlukla çalışanlara ait; ücret bilgisi yoksa geri planda kalsın
        const company = tg.name && /\b(AG|GmbH|SA|Sàrl|S\.p\.A\.|Srl|Ltd)\b/.test(tg.name) && !tg.fee;
        const kind = parkingKind(tg);
        const cap = parseInt(tg.capacity, 10);
        lots.push({
          id: (r.osm_type || 'n')[0] + r.osm_id, lat: +r.lat, lon: +r.lon, kind, name: tg.name || null,
          fee: tg.fee === 'yes' ? 'yes' : tg.fee === 'no' ? 'no' : null,
          capacity: Number.isFinite(cap) ? cap : null,
          base: PARK_BASE[kind] + (tg.name ? 0.5 : 0) + (Number.isFinite(cap) ? Math.min(cap, 500) / 250 : 0) - (company ? 2 : 0),
        });
      }
      res[p.key] = lots
        .map(l => ({ l, d: haversineKm(p, l) }))
        .filter(x => x.d <= radiusM / 1000 * 1.2 && (x.l.kind !== 'street' || x.l.name))
        .map(x => ({ ...x.l, dist: x.d, s: x.l.base - x.d * 3 }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 2)
        .map(({ s, base, ...rest }) => rest);
    } catch { /* bu nokta atlanır; bir sonraki açılışta yeniden aranır */ }
  }
  return res;
}

export const stripPlace = p => ({
  id: p.id, name: p.name, lat: p.lat, lon: p.lon, cats: p.cats, type: p.type, dur: p.dur,
  score: Math.round(p.score * 10) / 10, hours: p.hours, tags: p.tags,
});

const CUISINE = {
  turkish: 'Türk mutfağı', kebab: 'Kebap', regional: 'Yöresel', local: 'Yöresel', fish: 'Balık', seafood: 'Deniz ürünleri',
  pizza: 'Pizza', burger: 'Burger', italian: 'İtalyan', chinese: 'Çin', japanese: 'Japon', sushi: 'Suşi',
  steak_house: 'Et lokantası', meat: 'Et', grill: 'Izgara', vegetarian: 'Vejetaryen', vegan: 'Vegan', pide: 'Pide',
  lahmacun: 'Lahmacun', kofte: 'Köfte', meatball: 'Köfte', international: 'Dünya mutfağı', breakfast: 'Kahvaltı',
  dessert: 'Tatlı', ice_cream: 'Dondurma', sandwich: 'Sandviç', chicken: 'Tavuk', mediterranean: 'Akdeniz',
  greek: 'Yunan', indian: 'Hint', mexican: 'Meksika', french: 'Fransız', asian: 'Asya', doner: 'Döner',
  homestyle: 'Ev yemekleri', coffee_shop: 'Kahve', manti: 'Mantı', swiss: 'İsviçre mutfağı', fondue: 'Fondü',
  german: 'Alman', austrian: 'Avusturya', spanish: 'İspanyol', thai: 'Tay', vietnamese: 'Vietnam',
};
export const cuisineLabel = c => (c || '').split(';').slice(0, 2).map(x => (CUISINE[x.trim()] ? t(CUISINE[x.trim()]) : x.trim().replace(/_/g, ' '))).join(', ');
