// Formdaki bilgilerden gezi oluşturur: yerleri bulur, günlere dağıtır, yemek molası,
// hava, yol mesafesi ve gidilecek yer bilgisini ekler, cihaza kaydeder.

import { fetchPlaces, fetchFoodNear, stripPlace, isSight } from './places.js';
import { buildItinerary, computeTimeline } from './planner.js';
import { weatherDaily, driveRoute, countryInfo, wikiForTags, wikiSearch } from './api.js';
import { saveTrip } from './store.js';
import { dateRange, uid, sleep } from './util.js';

export async function generateTrip(f, settings, progress = () => {}) {
  const dates = dateRange(f.startDate, f.endDate);
  let found = f.places;
  if (!found) {
    progress('Gezilecek yerler aranıyor…');
    found = await fetchPlaces({ lat: f.dest.lat, lon: f.dest.lon, radiusKm: f.radiusKm, cats: f.interests });
  }
  const sights = found.filter(isSight);
  if (!sights.length) throw new Error('Bu bölgede seçtiğin ilgi alanlarına uygun yer bulunamadı. Alanı genişletmeyi ya da başka ilgi alanları seçmeyi dene.');

  // Kapalı günleri doğru planlamak için çalışma saatlerini kısa süre bekle (sunucu yavaşsa saatsiz devam).
  if (found.hoursReady) {
    progress('Çalışma saatleri kontrol ediliyor…');
    await Promise.race([found.hoursReady, sleep(6000)]);
  }

  progress('Günler planlanıyor…');
  const plan = buildItinerary(sights, dates, {
    pace: f.pace, transport: f.transport, travelers: f.travelers,
    origin: f.origin || null, startMin: f.startMin, firstDayBudget: f.firstDayBudget,
  });
  const byId = Object.fromEntries(sights.map(p => [p.id, p]));
  const places = {};
  for (const id of [...plan.days.flatMap(d => d.stops), ...plan.alternatives]) places[id] = stripPlace(byId[id]);

  const trip = {
    id: uid(), kind: f.kind || 'plan', name: f.name, createdAt: Date.now(), updatedAt: Date.now(),
    dest: f.dest, origin: f.origin || null, startDate: dates[0], endDate: dates[dates.length - 1],
    travelers: f.travelers, transport: f.transport, pace: f.pace, level: f.level,
    radiusKm: f.radiusKm, interests: f.interests,
    places, days: plan.days.map(d => ({ ...d, lunch: [], dinner: [] })), alternatives: plan.alternatives,
    weather: null, drive: null, country: null, destInfo: null, budgetOverrides: {},
    partial: !!found.partial,
  };

  // Ek bilgiler birbirinden bağımsız; aynı anda istenir. Biri başarısız olursa gezi yine kaydedilir.
  progress('Yemek molaları, hava durumu ve yer bilgisi hazırlanıyor…');
  const soft = (label, fn) => fn().catch(e => console.warn(label, e));
  await Promise.all([
    soft('yemek', () => addFoodSuggestions(trip)),
    soft('hava', () => refreshWeather(trip)),
    trip.transport === 'araba' && settings.home && trip.kind !== 'today'
      ? soft('rota', async () => { trip.drive = await driveRoute(settings.home, trip.dest); }) : null,
    trip.dest.cc && trip.dest.cc !== settings.homeCountry
      ? soft('ülke', async () => { trip.country = await countryInfo(trip.dest.cc); }) : null,
    soft('wiki', async () => {
      trip.destInfo = (await wikiForTags({ wikidata: trip.dest.wikidata, wikipedia: trip.dest.wikipedia })) || (await wikiSearch(trip.dest.name));
    }),
  ]);

  saveTrip(trip);
  return trip;
}

export async function addFoodSuggestions(trip) {
  const points = [];
  trip.days.forEach((d, di) => {
    if (!d.stops.length) return;
    const tl = computeTimeline(trip, di);
    const li = tl.items.findIndex(x => x.kind === 'lunch');
    if (li >= 0) {
      const near = tl.items.slice(0, li).reverse().find(x => x.kind === 'stop') || tl.items.slice(li).find(x => x.kind === 'stop');
      if (near) points.push({ key: `${di}:lunch`, lat: near.place.lat, lon: near.place.lon });
    }
    const last = trip.places[d.stops[d.stops.length - 1]];
    if (tl.end >= 17 * 60 || trip.days.length > 1) points.push({ key: `${di}:dinner`, lat: last.lat, lon: last.lon });
  });
  if (!points.length) return;
  const res = await fetchFoodNear(points);
  trip.days.forEach((d, di) => {
    d.lunch = (res[`${di}:lunch`] || []).map(stripPlace);
    d.dinner = (res[`${di}:dinner`] || []).map(stripPlace);
  });
}

export async function refreshWeather(trip) {
  const w = await weatherDaily(trip.dest.lat, trip.dest.lon, trip.startDate, trip.endDate);
  trip.weather = w ? { ...w, fetchedAt: Date.now() } : null;
}
