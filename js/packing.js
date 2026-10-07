// "Yanına al" hazırlık listesi: gezinin ülkelerine, mevsimine, havasına, aracına, kişilerine ve planlanan
// yerlere göre kurallarla oluşturulur (YZ gerekmez). İşaretler ve kullanıcının eklediği maddeler gezide saklanır.

import { parseISODate } from './util.js';
import { t } from './i18n.js';

export const PACK_CATS = {
  belge: { label: t('Belgeler'), emoji: '📄' },
  para: { label: t('Para ve iletişim'), emoji: '💳' },
  arac: { label: t('Araç'), emoji: '🚗' },
  saglik: { label: t('Sağlık'), emoji: '🩺' },
  giyim: { label: t('Giyim'), emoji: '👕' },
  elektronik: { label: t('Elektronik'), emoji: '🔌' },
  cocuk: { label: t('Çocuklar için'), emoji: '🧒' },
  hayvan: { label: t('Evcil hayvan'), emoji: '🐕' },
  konak: { label: t('Konaklama'), emoji: '⛺' },
  diger: { label: t('Diğer'), emoji: '🧳' },
};

const SCHENGEN = new Set(['at', 'be', 'cz', 'de', 'dk', 'es', 'fr', 'gr', 'hr', 'hu', 'it', 'li', 'lu', 'nl', 'pl', 'pt', 'si', 'ch']);
const EU = new Set(['at', 'be', 'cz', 'de', 'dk', 'es', 'fr', 'gr', 'hr', 'hu', 'it', 'lu', 'nl', 'pl', 'pt', 'si']);
const EURO = new Set(['at', 'be', 'de', 'es', 'fr', 'gr', 'hr', 'it', 'lu', 'nl', 'pt', 'si', 'mc', 'sm', 'va']);
const E_VIGNETTE = { at: t('Avusturya otoyol vinyeti (dijital, önceden internetten alınabilir)'), si: t('Slovenya e-vinyeti'), cz: t('Çekya e-vinyeti'), hu: t('Macaristan e-vinyeti') };
const NATURE = new Set(['peak', 'gorge', 'canyon', 'waterfall', 'nature_reserve', 'national_park', 'volcano', 'plateau', 'cave_entrance', 'nature']);

export function buildPacking(trip, settings) {
  const items = [];
  const add = (cat, id, text, note) => items.push({ cat, id, text, note });
  const home = settings.homeCountry || 'ch';
  const ccs = [...new Set((trip.route ? trip.days.map(d => d.cc) : [trip.dest.cc]).filter(Boolean))];
  const foreign = ccs.filter(cc => cc !== home);
  const abroad = foreign.length > 0;
  const car = trip.transport === 'araba';
  const tr = trip.travelers || {};
  const stops = trip.days.flatMap(d => d.stops.map(id => trip.places[id])).filter(Boolean);
  const types = new Set(stops.map(p => p.type));
  const cats = new Set(stops.flatMap(p => p.cats));
  const months = trip.days.map(d => parseISODate(d.date).getMonth()); // 0 = ocak
  const winter = months.some(m => m >= 10 || m <= 2);
  const tickSeason = months.some(m => m >= 3 && m <= 9);
  const wx = trip.weather?.days ? Object.values(trip.weather.days) : [];
  const rainy = wx.some(w => (w.pop ?? 0) >= 50 || (w.rain ?? 0) >= 3);
  const cold = wx.some(w => w.tmin <= 5) || (!wx.length && winter);
  const hot = wx.some(w => w.tmax >= 26) || (!wx.length && months.some(m => m >= 5 && m <= 7));
  const nights = trip.route ? trip.days.filter(d => d.sleep).length : trip.days.length - 1;

  // ---- Belgeler ----
  if (!abroad) add('belge', 'id', t('Kimlik kartı'));
  else if (home === 'ch' && foreign.every(cc => SCHENGEN.has(cc))) {
    add('belge', 'id', t('Kimlik kartı ya da pasaport'), t('Yabancı uyrukluysan İsviçre oturum izni kartını da al.'));
  } else {
    add('belge', 'passport', t('Pasaport'), t('Dönüş tarihinden sonra en az 3–6 ay geçerli olmalı; vize gerekip gerekmediğini kontrol et.'));
    if (home === 'ch') add('belge', 'permit', t('İsviçre oturum izni kartı (yabancı uyrukluysan)'));
  }
  if (abroad && tr.children) add('belge', 'kid-id', t('Çocukların kimliği ya da pasaportu'), t('Yurt dışında çocukların da kendi belgesi olmalı.'));
  if (car) {
    add('belge', 'license', t('Ehliyet ve araç ruhsatı'));
    if (abroad) add('belge', 'greencard', t('Araç sigorta belgesi (yeşil kart)'), foreign.includes('tr') ? t("Türkiye'de geçerli olduğunu kontrol et.") : null);
  }
  if (trip.stay && !['yok', 'kamp'].includes(trip.stay) && nights > 0) add('belge', 'booking', t('Konaklama rezervasyonları (telefonda ya da çıktı)'));
  if (settings.museumCard && ccs.includes(home) && (types.has('museum') || types.has('archaeological_site'))) {
    add('belge', 'museumcard', home === 'tr' ? 'Müzekart' : t('İsviçre Müze Pasaportu'));
  }
  if (!car && ccs.includes('ch')) add('belge', 'sbb', settings.halfFare ? t('Halbtax kartı ve SBB uygulaması') : t('SBB uygulaması (biletler)'));

  // ---- Araç ----
  if (car) {
    // Arabayla evden çıkılıyorsa kendi ülkenin otoyolları da kullanılır (ör. Zürih'ten Fransa'ya giderken İsviçre vinyeti)
    if (ccs.includes('ch') || home === 'ch') add('arac', 'vig-ch', t('İsviçre otoyol vinyeti'), home === 'ch' ? t('Bu yılın vinyeti geçerli mi kontrol et.') : null);
    for (const cc of foreign) if (E_VIGNETTE[cc]) add('arac', `vig-${cc}`, E_VIGNETTE[cc]);
    if (foreign.includes('fr')) add('arac', 'critair', t("Crit'Air çevre etiketi"), t('Paris, Lyon, Strazburg gibi şehirlerin merkezine girmek için; resmî siteden önceden sipariş edilir.'));
    if (foreign.includes('de')) add('arac', 'umwelt', t('Yeşil çevre etiketi (Umweltplakette)'), t('Birçok Alman şehir merkezi için gerekli.'));
    if (ccs.includes('tr')) add('arac', 'hgs', t('HGS etiketi (otoyol ve köprüler için)'), home !== 'tr' ? t("Yabancı plakalı araç için PTT'den alınabilir.") : null);
    if (abroad) add('arac', 'vest', t('Reflektörlü yelek ve üçgen reflektör'), t('Birçok Avrupa ülkesinde araçta bulunması zorunlu.'));
    if (winter) add('arac', 'winter', t('Kış lastiği ya da kar zinciri'), t('Kışın dağ yollarında zorunlu olabilir.'));
  }

  // ---- Para ve iletişim ----
  add('para', 'card', abroad ? t('Banka/kredi kartı (yurt dışı kullanıma açık)') : t('Banka/kredi kartı'));
  const homeCur = home === 'ch' ? 'CHF' : home === 'tr' ? 'TRY' : '';
  const needs = new Set(foreign.map(cc => (EURO.has(cc) ? 'EUR' : cc === 'tr' ? 'TRY' : cc === 'gb' ? 'GBP' : cc === 'ch' || cc === 'li' ? 'CHF' : null)).filter(c => c && c !== homeCur));
  for (const c of needs) add('para', `cash-${c}`, t('Biraz nakit {c}', { c }), c === 'TRY' ? t('Küçük esnafta ve köylerde kart geçmeyebilir.') : null);
  if (abroad && home === 'ch') add('para', 'roaming', t('Yurt dışı internet paketi ya da eSIM'), t("İsviçre hatlarına AB'nin ücretsiz dolaşımı uygulanmaz."));
  if (abroad) add('para', 'offline', t("Google Maps'te çevrimdışı harita indir"));
  if (stops.some(p => p.cats[0] === 'alisveris') && abroad && home === 'ch') add('para', 'receipts', t('Alışveriş fişlerini sakla'), t('Dönüşte gümrük ve KDV iadesi için.'));

  // ---- Sağlık ----
  add('saglik', 'meds', t('Düzenli kullandığın ilaçlar'));
  if (abroad && home === 'ch' && foreign.some(cc => EU.has(cc))) add('saglik', 'ehic', t('Avrupa Sağlık Sigortası Kartı'), t('İsviçre sağlık sigortası kartının arka yüzü.'));
  if (abroad && foreign.some(cc => !EU.has(cc) && cc !== 'ch' && cc !== 'li')) add('saglik', 'insurance', t('Seyahat sağlık sigortası belgesi'));
  if (cats.has('dogal') || cats.has('plaj')) add('saglik', 'firstaid', t('Küçük ilk yardım çantası (yara bandı, ağrı kesici)'));
  if (cats.has('dogal') && tickSeason && ccs.some(cc => ['ch', 'at', 'de', 'cz', 'si', 'li'].includes(cc))) {
    add('saglik', 'ticks', t('Kene kovucu sprey'), t('Ormanlık ve çimenli alanlarda keneler hastalık taşıyabilir; dönüşte vücudunu kontrol et.'));
  }
  if (hot || cats.has('plaj')) add('saglik', 'sun', t('Güneş kremi, güneş gözlüğü ve şapka'));

  // ---- Giyim ----
  if (rainy) add('giyim', 'rain', t('Yağmurluk ya da şemsiye'), t('Hava tahmininde yağmur var.'));
  if (cold) add('giyim', 'warm', t('Mont, bere ve eldiven'));
  if (stops.some(p => NATURE.has(p.type))) add('giyim', 'shoes', t('Rahat yürüyüş ayakkabısı'));
  else add('giyim', 'shoes', t('Rahat ayakkabı'), t('Tarihi yerlerde zemin taş ve engebeli olabilir.'));
  if (types.has('peak') || types.has('viewpoint') || types.has('national_park')) add('giyim', 'layer', t('Bir kat fazla giysi'), t('Yüksekte hava hızla soğuyabilir.'));
  if (types.has('mosque')) add('giyim', 'mosque', t('Omuz ve dizleri örten kıyafet, başörtüsü'), t('Cami ziyaretleri için.'));
  else if (types.has('church') || types.has('monastery')) add('giyim', 'church', t('Omuz ve dizleri örten kıyafet'), t('Kilise ve manastır ziyaretleri için.'));
  if (cats.has('plaj') || types.has('hot_spring')) add('giyim', 'swim', t('Mayo ve havlu'));

  // ---- Elektronik ----
  add('elektronik', 'charger', t('Telefon şarj aleti ve powerbank'));
  if (home === 'ch' && foreign.some(cc => cc !== 'li')) {
    add('elektronik', 'adapter', t('Priz adaptörü (İsviçre fişi → Avrupa)'), t("İsviçre'nin üç uçlu fişleri Avrupa prizlerine uymaz; ince iki uçlu şarj fişleri her yerde uyar."));
  } else if (home !== 'ch' && ccs.includes('ch')) {
    add('elektronik', 'adapter', t('Priz adaptörü (Avrupa fişi → İsviçre)'), t('Kalın topraklı fişler İsviçre prizlerine uymaz; ince iki uçlu şarj fişleri uyar.'));
  }
  if (foreign.includes('gb')) add('elektronik', 'adapter-uk', t('İngiltere priz adaptörü (G tipi)'));

  // ---- Çocuklar, yaşlılar, evcil hayvan ----
  if (tr.children) {
    if (car) add('cocuk', 'seat', t('Çocuk oto koltuğu'));
    add('cocuk', 'snacks', t('Atıştırmalık, su ve yolda oyalanacak şeyler'));
  }
  if (tr.elderly) add('saglik', 'mobility', t('Yürüme desteği ya da katlanır tabure'), t('Uzun yürüyüşlerde ve kuyruklarda işe yarar.'));
  if (tr.pet) {
    if (abroad) add('hayvan', 'petpass', t('Evcil hayvan pasaportu ve kuduz aşısı kaydı'), t('Yurt dışına çıkışta istenir; mikroçip de gerekli.'));
    add('hayvan', 'petfood', t('Mama, su kabı, tasma ve dışkı poşeti'));
  }

  // ---- Konaklama ve yemek ----
  if (trip.stay === 'kamp' && nights > 0) add('konak', 'tent', t('Çadır, uyku tulumu, mat ve fener'));
  if (trip.stay === 'hostel' && nights > 0) add('konak', 'hostel', t('Asma kilit, havlu ve terlik'), t('Hostellerde dolaplar ve havlu çoğu zaman ayrı.'));
  if (trip.level === 'piknik') add('diger', 'picnic', t('Termos, piknik örtüsü ve soğutucu çanta'));
  if (stops.some(p => p.cats[0] === 'sarap') && car) add('diger', 'driver', t('Tadım günü için içmeyen bir sürücü'));
  add('diger', 'bag', t('Gün içi için küçük sırt çantası ve su şişesi'));
  return items;
}

// Gezide saklanan durum: { done: { id: true }, custom: [{ id, text }] }
export const packState = trip => (trip.packing ||= { done: {}, custom: [] });

// { n: işaretli, m: toplam } — "{n}/{m} hazır" metni için
export function packingProgress(trip, settings) {
  const st = trip.packing || { done: {}, custom: [] };
  const all = [...buildPacking(trip, settings).map(i => i.id), ...(st.custom || []).map(c => c.id)];
  return { n: all.filter(id => st.done?.[id]).length, m: all.length };
}
