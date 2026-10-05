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

// Restoran ve otel fiyat seviyesi, İsviçre = 100 (Eurostat fiyat seviyesi endeksinden kabaca; tahmin içindir)
const PRICE_LEVEL = {
  ch: 100, li: 100, mc: 100, dk: 85, lu: 76, gb: 70, nl: 70, be: 70, fr: 67, at: 67, de: 64, it: 61,
  sm: 60, va: 60, es: 55, gr: 52, si: 52, hr: 52, pt: 48, cz: 42, hu: 36, pl: 36, tr: 30,
};
export function priceFactor(trip, settings) {
  const dest = PRICE_LEVEL[trip.dest.cc], home = PRICE_LEVEL[settings.homeCountry];
  return dest && home ? dest / home : 1;
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
  const f = priceFactor(trip, settings);
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
    add('parking', t('Otopark'), days * b.parkingPerDay * f, t('{d} gün × {p}', { d: days, p: fmtMoney(b.parkingPerDay * f) }));
  } else {
    const half = settings.halfFare && trip.dest.cc === 'ch';
    if (trip.kind !== 'today') add('intercity', t('Şehirlerarası bilet (tren, otobüs, uçak)'), 0, t('Bilet fiyatını elle gir'));
    add('transit', t('Yerel ulaşım'), days * people * b.transitPerPersonDay * f * (half ? 0.5 : 1),
      t('{d} gün × {n} kişi × {p}', { d: days, n: people, p: fmtMoney(b.transitPerPersonDay * f) }) + (half ? ' × ½ (Halbtax)' : ''));
  }

  const stay = stayOf(trip);
  if (nights > 0 && stay !== 'yok') {
    const price = (b.stay?.[stay] ?? 0) * f;
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
  const food = b.food[fk] ?? b.food.ekonomik;
  add('food', t('Yeme-içme'), days * (A + C * 0.6) * food * f,
    `${FOODS[fk].label} · ` + t('{d} gün × {a} yetişkin', { d: days, a: A }) + (C ? t(' + {c} çocuk (yarım porsiyon sayıldı)', { c: C }) : '') + ` × ${fmtMoney(food * f)}`);

  const stops = trip.days.flatMap(d => d.stops.map(id => trip.places[id])).filter(Boolean);
  const paid = stops.filter(isPaid);
  // Müze kartı yalnızca kartın ülkesinde geçer: TR → Müzekart (müze, ören yeri, saray), CH → Müze Pasaportu (müzeler).
  const cardTypes = trip.dest.cc === 'tr' ? MUZEKART_TYPES : new Set(['museum']);
  const cardName = trip.dest.cc === 'tr' ? 'Müzekart' : t('Müze Pasaportu');
  const covered = settings.museumCard && trip.dest.cc === settings.homeCountry ? paid.filter(p => cardTypes.has(p.type)).length : 0;
  const count = paid.length - covered;
  add('tickets', t('Giriş ücretleri'), count * (A + C * 0.5) * b.ticketAvg * f,
    t('{n} ücretli yer × ort. {p}', { n: count, p: fmtMoney(b.ticketAvg * f) }) + (C ? t(' (çocuk yarım)') : '')
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

// "İtalya'da fiyatlar ~%40 daha düşük hesaplandı" gibi açıklama
export function factorNote(trip, settings, countryName) {
  const f = priceFactor(trip, settings);
  if (Math.abs(f - 1) < 0.03) return null;
  const pct = Math.round(Math.abs(1 - f) * 100);
  return f < 1
    ? t('{c} için konaklama, yemek ve giriş fiyatları yaşadığın ülkeye göre ~%{p} daha düşük hesaplandı.', { c: countryName, p: pct })
    : t('{c} için konaklama, yemek ve giriş fiyatları yaşadığın ülkeye göre ~%{p} daha yüksek hesaplandı.', { c: countryName, p: pct });
}
