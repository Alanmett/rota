// Tahmini bütçe. Her kalemin nasıl hesaplandığı açıkça yazılır; kullanıcı her kalemi elle değiştirebilir.
// Fiyatlar kullanıcının yaşadığı ülkeye göre girilir, gidilen ülkenin fiyat seviyesine göre ölçeklenir.

import { fmtMoney } from './util.js';
import { isPaid, isShop, MUZEKART_TYPES } from './places.js';
import { computeTimeline } from './planner.js';
import { t } from './i18n.js';

// Yemek düzeni (gezide trip.level olarak saklanır)
export const FOODS = {
  piknik: { label: t('Kendin hazırla (market, piknik)') },
  ekonomik: { label: t('Ekonomik (market + ucuz lokanta)') },
  orta: { label: t('Orta (restoran)') },
  konforlu: { label: t('Konforlu') },
};
export const foodOf = trip => (FOODS[trip.level] ? trip.level : 'ekonomik');

// Konaklama türleri: kamp ve hostel kişi başı, otel türleri oda başı (2 yetişkin bir oda)
export const STAYS = {
  kamp: { label: t('Kamp'), perPerson: true },
  hostel: { label: t('Hostel / gençlik pansiyonu'), perPerson: true },
  ekonomik: { label: t('Ekonomik otel / pansiyon'), perPerson: false },
  orta: { label: t('Orta otel'), perPerson: false },
  konforlu: { label: t('Konforlu otel'), perPerson: false },
  yok: { label: t('Konaklama yok (akraba, arkadaş)'), perPerson: false },
};
export const stayOf = trip => trip.stay || (STAYS[trip.level] ? trip.level : 'ekonomik');

// Fiyat seviyeleri, İsviçre = 100. Yemek/genel: Eurostat restoran fiyat endeksinden kabaca.
// Konaklama ayrı tutulur; ucuz otellerde fark daha büyük (kullanıcı verisi: Annecy'de ucuz otel 50–60 €).
const FOOD_LEVEL = {
  ch: 100, li: 100, mc: 100, dk: 85, lu: 76, gb: 70, nl: 70, be: 70, fr: 67, at: 67, de: 64, it: 61,
  sm: 60, va: 60, es: 55, gr: 52, si: 52, hr: 52, pt: 48, cz: 42, hu: 36, pl: 36, tr: 30,
};
const LODGING_LEVEL = {
  ch: 100, li: 100, mc: 110, dk: 80, lu: 75, gb: 75, nl: 70, be: 65, fr: 58, at: 60, de: 55, it: 58,
  sm: 55, va: 60, es: 50, gr: 45, si: 45, hr: 50, pt: 45, cz: 40, hu: 35, pl: 35, tr: 25,
};
export function priceFactor(trip, settings, kind = 'food', cc = trip.dest.cc) {
  const table = kind === 'lodging' ? LODGING_LEVEL : FOOD_LEVEL;
  const dest = table[cc], home = table[settings.homeCountry];
  return dest && home ? dest / home : 1;
}
// Rota gezilerinde her gün ve her yer kendi ülkesinin fiyat seviyesiyle hesaplanır
const dayCc = (trip, d) => d.cc || trip.dest.cc;
const placeCc = (trip, p) => trip.route?.cities?.[p.city]?.cc || trip.dest.cc;

// Gidilen ülkenin para birimi (bütçenin yanında yaklaşık karşılığını göstermek için)
const EURO = ['fr', 'de', 'it', 'at', 'es', 'pt', 'nl', 'be', 'lu', 'si', 'hr', 'gr', 'mc', 'sm', 'va'];
const EU = new Set(['fr', 'de', 'it', 'at', 'es', 'pt', 'nl', 'be', 'lu', 'si', 'hr', 'gr', 'cz', 'hu', 'pl', 'dk']);
export function destCurrency(cc) {
  if (EURO.includes(cc)) return 'EUR';
  return { ch: 'CHF', li: 'CHF', tr: 'TRY', gb: 'GBP', cz: 'CZK', hu: 'HUF', pl: 'PLN', dk: 'DKK' }[cc] || null;
}

// Gün gün arabayla gidilen km: zaman çizelgesindeki araba yolları (rotada şehirler arası gerçek yol dahil)
function carKmByDay(trip) {
  return trip.days.map((_, di) => computeTimeline(trip, di).items
    .filter(x => x.kind === 'leg' && x.mode === 'car').reduce((s, x) => s + x.km, 0));
}

// Bir yerin giriş ücreti için kişi başı tahmini tutar; ücretsizse ya da müze kartıyla giriliyorsa bunu söyler.
export function ticketInfo(p, trip, settings) {
  if (!isPaid(p)) return null;
  const cc = placeCc(trip, p);
  const cardTypes = cc === 'tr' ? MUZEKART_TYPES : new Set(['museum']);
  if (settings.museumCard && cc === settings.homeCountry && cardTypes.has(p.type)) {
    return { card: cc === 'tr' ? 'Müzekart' : t('Müze Pasaportu') };
  }
  return { price: unitPrice(settings.budget.ticketAvg * priceFactor(trip, settings, 'food', cc)) };
}
// Ölçeklenen birim fiyatlar okunur kalsın: 10 ve üstü tam sayıya, altı yarıma yuvarlanır
const unitPrice = v => (v >= 10 ? Math.round(v) : Math.round(v * 2) / 2);

// Her kalem günlere bir ağırlık dizisiyle dağıtılır (toplamı 1); planda "bu gün ~X" göstermek için.
const even = n => Array(n).fill(1 / n);
const share = arr => { const s = arr.reduce((a, b) => a + b, 0); return s > 0 ? arr.map(x => x / s) : even(arr.length); };
const ends = n => share(Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0) + (i === n - 1 ? 1 : 0)));

export function computeBudget(trip, settings) {
  const b = settings.budget, ov = trip.budgetOverrides || {};
  const unit = unitPrice;
  const days = trip.days.length;
  const A = trip.travelers.adults, C = trip.travelers.children || 0;
  const people = A + C;
  const lines = [];
  const add = (key, label, auto, detail, w = even(days)) => lines.push({ key, label, auto: Math.round(auto), detail, w });
  const dayStops = trip.days.map(d => d.stops.map(id => trip.places[id]).filter(Boolean));
  // Günlük fiyat çarpanı (o günün ülkesine göre) ve günlük tutarlar
  const fd = trip.days.map(d => priceFactor(trip, settings, 'food', dayCc(trip, d)));
  const sum = arr => arr.reduce((a, x) => a + x, 0);
  // "3 gün × CHF 12"; ülkeler arasında fiyat değişiyorsa "3 gün × ort. CHF 12"
  const unitText = arr => (new Set(arr).size > 1 ? t('ort. {p}', { p: fmtMoney(sum(arr) / arr.length) }) : fmtMoney(arr[0] ?? 0));

  if (trip.transport === 'araba') {
    const byDay = carKmByDay(trip), home = trip.drive ? trip.drive.km * 2 : 0;
    const km = sum(byDay) + home;
    add('fuel', t('Yakıt'), km * b.consumption / 100 * b.fuelPrice,
      `${Math.round(km)} km × ${b.consumption} L/100 km × ${fmtMoney(b.fuelPrice)}/L` +
      (trip.drive ? t(' (evden gidiş-dönüş {km} km dahil)', { km: Math.round(home) })
        : trip.kind === 'today' || trip.route ? '' : t(' · ev konumu girilmediği için evden gidiş-dönüş dahil değil')),
      share(byDay.map((x, i) => x + ends(days)[i] * home)));
    add('toll', t('Otoyol ve köprü'), 0, t('Güzergâha göre değişir; tutarı elle gir'),
      trip.route ? share(trip.days.map(d => d.drive || 0)) : ends(days));
    const park = fd.map(x => unit(b.parkingPerDay * x));
    add('parking', t('Otopark'), sum(park),
      t('{d} gün × {p}', { d: days, p: unitText(park) }) + t(' · şehre göre çok değişir, gerekirse düzenle'), share(park));
  } else {
    if (trip.kind !== 'today') add('intercity', t('Şehirlerarası bilet (tren, otobüs, uçak)'), 0, t('Bilet fiyatını elle gir'),
      trip.route ? share(trip.days.map(d => d.drive || 0)) : ends(days));
    const halfDay = trip.days.map(d => settings.halfFare && dayCc(trip, d) === 'ch');
    const tr = fd.map((x, i) => unit(b.transitPerPersonDay * x) * (halfDay[i] ? 0.5 : 1));
    add('transit', t('Yerel ulaşım'), sum(tr) * people,
      t('{d} gün × {n} kişi × {p}', { d: days, n: people, p: unitText(fd.map(x => unit(b.transitPerPersonDay * x))) })
      + (halfDay.some(Boolean) ? ' × ½ (Halbtax)' : ''), share(tr));
  }

  // Geceler: tek yer gezisinde son gün hariç her gün; rotada geceyi bir şehirde geçirilen günler
  const stay = stayOf(trip);
  const night = trip.days.map((d, i) => (trip.route ? !!d.sleep : i < days - 1));
  const nights = night.filter(Boolean).length;
  if (nights > 0 && stay !== 'yok') {
    const price = trip.days.map((d, i) => (night[i] ? unit((b.stay?.[stay] ?? 0) * priceFactor(trip, settings, 'lodging', dayCc(trip, d))) : 0));
    const prices = price.filter((_, i) => night[i]);
    const label = STAYS[stay].label;
    const k = STAYS[stay].perPerson ? people : Math.max(1, Math.ceil(A / 2));
    add('hotel', t('Konaklama'), sum(price) * k,
      `${label} · ` + (STAYS[stay].perPerson
        ? t('{n} gece × {k} kişi × {p}', { n: nights, k: people, p: unitText(prices) })
        : t('{n} gece × {r} oda × {p}', { n: nights, r: k, p: unitText(prices) })), share(price));
  }

  const fk = foodOf(trip);
  const food = fd.map(x => unit((b.food[fk] ?? b.food.ekonomik) * x));
  add('food', t('Yeme-içme'), sum(food) * (A + C * 0.6),
    `${FOODS[fk].label} · ` + t('{d} gün × {a} yetişkin', { d: days, a: A }) + (C ? t(' + {c} çocuk (yarım porsiyon sayıldı)', { c: C }) : '') + ` × ${unitText(food)}`,
    share(food));

  // Müze kartı yalnızca kartın ülkesinde geçer: TR → Müzekart (müze, ören yeri, saray), CH → Müze Pasaportu (müzeler).
  const tickets = dayStops.map(ps => ps.map(p => ticketInfo(p, trip, settings)?.price).filter(x => x != null));
  const covered = dayStops.flat().filter(p => ticketInfo(p, trip, settings)?.card).length;
  const count = sum(tickets.map(x => x.length));
  const cardName = settings.homeCountry === 'tr' ? 'Müzekart' : t('Müze Pasaportu');
  add('tickets', t('Giriş ücretleri'), sum(tickets.map(sum)) * (A + C * 0.5),
    t('{n} ücretli yer × ort. {p}', { n: count, p: fmtMoney(count ? sum(tickets.map(sum)) / count : unit(b.ticketAvg * fd[0])) }) + (C ? t(' (çocuk yarım)') : '')
    + (covered ? t(' · {n} yer {card} ile sayılmadı', { n: covered, card: cardName }) : ''), share(tickets.map(sum)));
  const f = fd[0];

  // Alışveriş tamamen kişisel; tutarı kullanıcı girer. Alışveriş durağı olan günlere dağıtılır.
  const shopDays = dayStops.map(ps => ps.filter(isShop).length);
  if (trip.interests?.includes('alisveris') || shopDays.some(Boolean)) {
    add('shopping', t('Alışveriş'), 0, t('Ne kadar harcamayı düşünüyorsan gir'), share(shopDays));
  }

  for (const l of lines) { l.overridden = ov[l.key] != null; l.amount = l.overridden ? ov[l.key] : l.auto; }
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const buffer = Math.round(subtotal * b.bufferPct / 100);
  const total = subtotal + buffer;
  // Günlük tahmini harcama (beklenmedik gider payı dahil; günlerin toplamı genel toplama eşit)
  const k = subtotal ? total / subtotal : 1;
  const perDay = trip.days.map((_, i) => lines.reduce((s, l) => s + l.amount * l.w[i], 0) * k);
  return { lines, subtotal, buffer, total, perPerson: total / Math.max(1, people), factor: f, perDay };
}

// Bütçeyi düşürmek için gezinin içeriğine göre öneriler
export function savingTips(trip, settings) {
  const tips = [];
  const nights = trip.days.length - 1;
  const stay = stayOf(trip);
  const cc = trip.dest.cc;
  if (nights > 0 && ['ekonomik', 'orta', 'konforlu'].includes(stay)) {
    tips.push(t('Hostel ve kamp alanları otellerin yarı fiyatına olabilir; çoğu hostelde aile ve çift odaları da var.'));
  }
  if (cc === 'ch') {
    if (nights > 0) {
      tips.push(t('Konstanz, Como, Mulhouse gibi sınırın hemen öbür tarafındaki yerlerde konaklamak genelde %30–50 daha ucuz.'));
      tips.push(t('Basel, Bern, Cenevre ve Lozan gibi şehirlerde otelde kalanlara ücretsiz toplu taşıma kartı veriliyor; konaklamada sor.'));
    }
    tips.push(t("Öğle yemeği için Coop ve Migros'un restoranları ve hazır yemekleri ucuz bir seçenek."));
  }
  if (nights > 0) tips.push(t('Şehir otelleri hafta sonu, tatil bölgeleri hafta içi genelde daha ucuz.'));
  // Alışverişte KDV iadesi: AB'de oturmayanlar (ör. İsviçre'de yaşayanlar) mağazadan aldığı belgeyi sınırda onaylatarak geri alır
  const shopping = trip.interests?.includes('alisveris') || trip.days.some(d => d.stops.some(id => trip.places[id] && isShop(trip.places[id])));
  if (shopping && settings.homeCountry === 'ch' && EU.has(cc)) {
    tips.push(cc === 'de'
      ? t("Almanya'da alışverişte kasada ihracat fişi (Ausfuhrkassenzettel, “yeşil fiş”) iste ve çıkışta Alman gümrüğüne onaylat; KDV'nin bir kısmı geri alınır. Fiş başına alt sınır var (şu an 50 €); gümrüğün dijital sistemine geçiliyor, güncel kuralı kontrol et.")
      : t("AB ülkelerinde büyük alışverişlerde mağazadan “tax free” (KDV iadesi) formu iste ve çıkışta gümrüğe onaylat. Mağaza başına alt sınır ülkeye göre değişir (Fransa'da yaklaşık 100 €)."));
  }
  return tips;
}

// "Fransa'da konaklama ~%42, yemek ~%33 daha ucuz hesaplandı" gibi açıklama
export function factorNote(trip, settings, countryName) {
  const f = priceFactor(trip, settings), fl = priceFactor(trip, settings, 'lodging');
  if (Math.abs(f - 1) < 0.03 && Math.abs(fl - 1) < 0.03) return null;
  const pct = x => Math.round(Math.abs(1 - x) * 100);
  return f < 1
    ? t('{c} için fiyatlar yaşadığın ülkeye göre daha düşük hesaplandı: konaklama ~%{a}, yemek ve diğer harcamalar ~%{b} daha ucuz.', { c: countryName, a: pct(fl), b: pct(f) })
    : t('{c} için fiyatlar yaşadığın ülkeye göre daha yüksek hesaplandı: konaklama ~%{a}, yemek ve diğer harcamalar ~%{b} daha pahalı.', { c: countryName, a: pct(fl), b: pct(f) });
}
