// Öner'de "Uçak": havalimanı veri setinden (data/airports.json, tools/build-airports.ps1 üretir) kapıdan kapıya süre tahmini.
// Ücretsiz bir tarife kaynağı yok; bu yüzden süre parça parça hesaplanır: havalimanına yol + giriş/güvenlik + uçuş
// + inişten sonra bagaj/çıkış + havalimanından varış yerine yol. Direkt uçuş garantisi verilmez; yalnızca iki uçtan
// biri büyük bir havalimanıysa ve öteki de yeterince işlekse öneri çıkar (küçük pistler arası uçuş genelde yoktur).

import { haversineKm } from './util.js';

const MAX_ACCESS_KM = 160;  // çıkış yerinden havalimanına en çok bu kadar kuş uçuşu
const MAX_ARRIVAL_KM = 80;  // varış havalimanından gidilecek yere en çok bu kadar
const MIN_FROM_PAX = 1000;  // çıkış havalimanı: yılda en az bu kadar bin yolcu
const MIN_TO_PAX = 700;     // varış havalimanı
const HUB_PAX = 3000;       // uçuşun en az bir ucu bu kadar işlek olmalı
const MIN_FLIGHT_KM = 400;  // bundan kısa mesafeye uçak çoğu zaman yok ve değmez (Zürih–Floransa ~420 km hâlâ uçuluyor)

let cache = null;
export async function loadAirports() {
  if (cache) return cache;
  const d = await (await fetch('data/airports.json')).json();
  cache = d.items.map(a => ({ q: a[0], iata: a[1], name: a[2], lat: a[3], lon: a[4], cc: a[5], paxK: a[6] }));
  return cache;
}

// Kapıdan havalimanına (ya da tersi): tren/araba karışık, kuş uçuşunun ~1,3 katı yol, 85 km/sa; 0,3 sa park/yürüme/bekleme
const access = km => 0.3 + km * 1.3 / 85;
// Büyük havalimanında giriş, güvenlik ve kapıya yürüyüş daha uzun sürer
const checkin = a => (a.paxK >= 5000 ? 1.5 : 1.25);
const ARRIVAL = 0.6; // iniş sonrası kapıya yürüyüş, bagaj, çıkış
// Varış havalimanı seçerken küçük havalimanları geri plana atılır: Ciampino ya da Orly gibi ikinci havalimanlarına
// yalnızca birkaç düşük maliyetli hat uçar; Roma'ya giden çoğu uçuş Fiumicino'ya iner. (Süreye eklenmez, yalnızca seçimde sayılır.)
const smallPenalty = a => (a.paxK < 2000 ? 1.2 : a.paxK < 5000 ? 0.7 : a.paxK < 15000 ? 0.4 : a.paxK < 40000 ? 0.3 : 0);
// Kalkış-iniş dahil uçuş süresi (blok süresi): Zürih–Barselona ~1 sa 45 dk, Zürih–İstanbul ~3 sa 15 dk
export const flightHours = km => 0.7 + km / 800;

// origin: { lat, lon } → { from: [havalimanları], best(dest) }; best() en kısa kapıdan kapıya yolu verir (yoksa null)
export async function flightFinder(origin) {
  const airports = await loadAirports();
  const from = airports
    .map(a => ({ a, d: haversineKm(origin, a) }))
    .filter(x => x.d <= MAX_ACCESS_KM && x.a.paxK >= MIN_FROM_PAX)
    .sort((x, y) => x.d - y.d)
    .slice(0, 6)
    .map(x => ({ a: x.a, t: access(x.d) + checkin(x.a) }));
  const to = airports.filter(a => a.paxK >= MIN_TO_PAX);
  return {
    from: from.map(x => x.a),
    best(dest) {
      let best = null, bestScore = Infinity;
      for (const ta of to) {
        const dd = haversineKm(dest, ta);
        if (dd > MAX_ARRIVAL_KM) continue;
        for (const o of from) {
          if (o.a === ta || Math.max(o.a.paxK, ta.paxK) < HUB_PAX) continue;
          const gc = haversineKm(o.a, ta);
          if (gc < MIN_FLIGHT_KM) continue;
          const flight = flightHours(gc);
          const hours = o.t + flight + ARRIVAL + access(dd);
          const score = hours + smallPenalty(ta) + smallPenalty(o.a) * 0.5;
          if (score < bestScore) { best = { hours, flight, km: gc, from: o.a, to: ta }; bestScore = score; }
        }
      }
      return best;
    },
  };
}

// Tarihsiz arama; fiyat ve direkt uçuş olup olmadığı burada görülür
export const flightsUrl = (a, b) => `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${a.iata} to ${b.iata}`)}`;
