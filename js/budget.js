// Tahmini bütçe. Her kalemin nasıl hesaplandığı açıkça yazılır; kullanıcı her kalemi elle değiştirebilir.
// Fiyatlar kullanıcının yaşadığı ülkeye göre girilir, gidilen ülkenin fiyat seviyesine göre ölçeklenir.

import { fmtMoney } from './util.js';
import { isPaid, MUZEKART_TYPES } from './places.js';
import { leg } from './planner.js';
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
export function priceFactor(trip, settings, kind = 'food') {
  const table = kind === 'lodging' ? LODGING_LEVEL : FOOD_LEVEL;
  const dest = table[trip.dest.cc], home = table[settings.homeCountry];
  return dest && home ? dest / home : 1;
}

// Gidilen ülkenin para birimi (bütçenin yanında yaklaşık karşılığını göstermek için)
const EURO = ['fr', 'de', 'it', 'at', 'es', 'pt', 'nl', 'be', 'lu', 'si', 'hr', 'gr', 'mc', 'sm', 'va'];
export function destCurrency(cc) {
  if (EURO.includes(cc)) return 'EUR';
  return { ch: 'CHF', li: 'CHF', tr: 'TRY', gb: 'GBP', cz: 'CZK', hu: 'HUF', pl: 'PLN', dk: 'DKK' }[cc] || null;
}

function inTripCarKm(trip) {
  let km = 0;
  trip.days.forEach((d, di) => {
    let prev = di === 0 && trip.origin ? trip.origin : null;
    for (const id of d.stops) {
      const p = trip.places[id];
      if (!p) continue;
      if (prev) { const l = leg(prev, p, trip.transport); if (l.mode === 'car') km += l.km; }
      prev = p;
    }
  });
  return km;
}

export function computeBudget(trip, settings) {
  const b = settings.budget, ov = trip.budgetOverrides || {};
  const f = priceFactor(trip, settings), fl = priceFactor(trip, settings, 'lodging');
  // Ölçeklenen birim fiyatlar okunur kalsın: 10 ve üstü tam sayıya, altı yarıma yuvarlanır
  const unit = v => (v >= 10 ? Math.round(v) : Math.round(v * 2) / 2);
  const days = trip.days.length, nights = Math.max(0, days - 1);
  const A = trip.travelers.adults, C = trip.travelers.children || 0;
  const people = A + C;
  const lines = [];
  const add = (key, label, auto, detail) => lines.push({ key, label, auto: Math.round(auto), detail });

  if (trip.transport === 'araba') {
    const local = inTripCarKm(trip), home = trip.drive ? trip.drive.km * 2 : 0, km = local + home;
    add('fuel', t('Yakıt'), km * b.consumption / 100 * b.fuelPrice,
      `${Math.round(km)} km × ${b.consumption} L/100 km × ${fmtMoney(b.fuelPrice)}/L` +
      (trip.drive ? t(' (evden gidiş-dönüş {km} km dahil)', { km: Math.round(home) })
        : trip.kind === 'today' ? '' : t(' · ev konumu girilmediği için evden gidiş-dönüş dahil değil')));
    add('toll', t('Otoyol ve köprü'), 0, t('Güzergâha göre değişir; tutarı elle gir'));
    add('parking', t('Otopark'), days * unit(b.parkingPerDay * f),
      t('{d} gün × {p}', { d: days, p: fmtMoney(unit(b.parkingPerDay * f)) }) + t(' · şehre göre çok değişir, gerekirse düzenle'));
  } else {
    const half = settings.halfFare && trip.dest.cc === 'ch';
    if (trip.kind !== 'today') add('intercity', t('Şehirlerarası bilet (tren, otobüs, uçak)'), 0, t('Bilet fiyatını elle gir'));
    add('transit', t('Yerel ulaşım'), days * people * unit(b.transitPerPersonDay * f) * (half ? 0.5 : 1),
      t('{d} gün × {n} kişi × {p}', { d: days, n: people, p: fmtMoney(unit(b.transitPerPersonDay * f)) }) + (half ? ' × ½ (Halbtax)' : ''));
  }

  const stay = stayOf(trip);
  if (nights > 0 && stay !== 'yok') {
    const price = unit((b.stay?.[stay] ?? 0) * fl);
    const label = STAYS[stay].label;
    if (STAYS[stay].perPerson) {
      add('hotel', t('Konaklama'), nights * people * price,
        `${label} · ` + t('{n} gece × {k} kişi × {p}', { n: nights, k: people, p: fmtMoney(price) }));
    } else {
      const rooms = Math.max(1, Math.ceil(A / 2));
      add('hotel', t('Konaklama'), nights * rooms * price,
        `${label} · ` + t('{n} gece × {r} oda × {p}', { n: nights, r: rooms, p: fmtMoney(price) }));
    }
  }

  const fk = foodOf(trip);
  const food = unit((b.food[fk] ?? b.food.ekonomik) * f);
  add('food', t('Yeme-içme'), days * (A + C * 0.6) * food,
    `${FOODS[fk].label} · ` + t('{d} gün × {a} yetişkin', { d: days, a: A }) + (C ? t(' + {c} çocuk (yarım porsiyon sayıldı)', { c: C }) : '') + ` × ${fmtMoney(food)}`);

  const stops = trip.days.flatMap(d => d.stops.map(id => trip.places[id])).filter(Boolean);
  const paid = stops.filter(isPaid);
  // Müze kartı yalnızca kartın ülkesinde geçer: TR → Müzekart (müze, ören yeri, saray), CH → Müze Pasaportu (müzeler).
  const cardTypes = trip.dest.cc === 'tr' ? MUZEKART_TYPES : new Set(['museum']);
  const cardName = trip.dest.cc === 'tr' ? 'Müzekart' : t('Müze Pasaportu');
  const covered = settings.museumCard && trip.dest.cc === settings.homeCountry ? paid.filter(p => cardTypes.has(p.type)).length : 0;
  const count = paid.length - covered;
  add('tickets', t('Giriş ücretleri'), count * (A + C * 0.5) * unit(b.ticketAvg * f),
    t('{n} ücretli yer × ort. {p}', { n: count, p: fmtMoney(unit(b.ticketAvg * f)) }) + (C ? t(' (çocuk yarım)') : '')
    + (covered ? t(' · {n} yer {card} ile sayılmadı', { n: covered, card: cardName }) : ''));

  for (const l of lines) { l.overridden = ov[l.key] != null; l.amount = l.overridden ? ov[l.key] : l.auto; }
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const buffer = Math.round(subtotal * b.bufferPct / 100);
  const total = subtotal + buffer;
  return { lines, subtotal, buffer, total, perPerson: total / Math.max(1, people), factor: f };
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
