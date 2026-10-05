// Tahmini bütçe. Her kalemin nasıl hesaplandığı açıkça yazılır; kullanıcı her kalemi elle değiştirebilir.

import { fmtMoney } from './util.js';
import { isPaid, MUZEKART_TYPES } from './places.js';
import { leg } from './planner.js';
import { t } from './i18n.js';

export const LEVELS = { ekonomik: t('Ekonomik'), orta: t('Orta'), konforlu: t('Konforlu') };

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
    add('parking', t('Otopark'), days * b.parkingPerDay, t('{d} gün × {p}', { d: days, p: fmtMoney(b.parkingPerDay) }));
  } else {
    const half = settings.halfFare && trip.dest.cc === 'ch';
    if (trip.kind !== 'today') add('intercity', t('Şehirlerarası bilet (tren, otobüs, uçak)'), 0, t('Bilet fiyatını elle gir'));
    add('transit', t('Yerel ulaşım'), days * people * b.transitPerPersonDay * (half ? 0.5 : 1),
      t('{d} gün × {n} kişi × {p}', { d: days, n: people, p: fmtMoney(b.transitPerPersonDay) }) + (half ? ' × ½ (Halbtax)' : ''));
  }

  if (nights > 0) {
    const rooms = Math.max(1, Math.ceil(A / 2));
    add('hotel', t('Konaklama'), nights * rooms * b.hotel[trip.level],
      t('{n} gece × {r} oda × {p}', { n: nights, r: rooms, p: fmtMoney(b.hotel[trip.level]) }));
  }

  add('food', t('Yeme-içme'), days * (A + C * 0.6) * b.food[trip.level],
    t('{d} gün × {a} yetişkin', { d: days, a: A }) + (C ? t(' + {c} çocuk (yarım porsiyon sayıldı)', { c: C }) : '') + ` × ${fmtMoney(b.food[trip.level])}`);

  const stops = trip.days.flatMap(d => d.stops.map(id => trip.places[id])).filter(Boolean);
  const paid = stops.filter(isPaid);
  // Müze kartı yalnızca kartın ülkesinde geçer: TR → Müzekart (müze, ören yeri, saray), CH → Müze Pasaportu (müzeler).
  const cardTypes = trip.dest.cc === 'tr' ? MUZEKART_TYPES : new Set(['museum']);
  const cardName = trip.dest.cc === 'tr' ? 'Müzekart' : t('Müze Pasaportu');
  const covered = settings.museumCard && trip.dest.cc === settings.homeCountry ? paid.filter(p => cardTypes.has(p.type)).length : 0;
  const count = paid.length - covered;
  add('tickets', t('Giriş ücretleri'), count * (A + C * 0.5) * b.ticketAvg,
    t('{n} ücretli yer × ort. {p}', { n: count, p: fmtMoney(b.ticketAvg) }) + (C ? t(' (çocuk yarım)') : '')
    + (covered ? t(' · {n} yer {card} ile sayılmadı', { n: covered, card: cardName }) : ''));

  for (const l of lines) { l.overridden = ov[l.key] != null; l.amount = l.overridden ? ov[l.key] : l.auto; }
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const buffer = Math.round(subtotal * b.bufferPct / 100);
  const total = subtotal + buffer;
  return { lines, subtotal, buffer, total, perPerson: total / Math.max(1, people) };
}
