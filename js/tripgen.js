// Formdaki bilgilerden gezi oluşturur: yerleri bulur, günlere dağıtır, yemek molası,
// hava, yol mesafesi ve gidilecek yer bilgisini ekler, cihaza kaydeder.

import { fetchPlaces, fetchFoodNear, stripPlace, isSight } from './places.js';
import { buildItinerary, computeTimeline } from './planner.js';
import { weatherDaily, driveRoute, countryInfo, wikiForTags, wikiSearch } from './api.js';
import { saveTrip } from './store.js';
import { dateRange, uid } from './util.js';

export async function generateTrip(f, settings, progress = () => {}) {
  const dates = dateRange(f.startDate, f.endDate);
  let found = f.places;
  if (!found) {
    progress('Gezilecek yerler aranıyor…');
    found = await fetchPlaces({ lat: f.dest.lat, lon: f.dest.lon, radiusKm: f.radiusKm, cats: f.interests });
  }
  const sights = found.filter(isSight);
  if (!sights.length) throw new Error('Bu bölgede seçtiğin ilgi alanlarına uygun yer bulunamadı. Alanı genişletmeyi ya da başka ilgi alanları seçmeyi dene.');

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

  progress('Yemek molası için yakındaki lokantalar aranıyor…');
  try { await addFoodSuggestions(trip); } catch (e) { console.warn('yemek', e); }

  progress('Hava durumuna bakılıyor…');
  try { await refreshWeather(trip); } catch (e) { console.warn('hava', e); }

  if (trip.transport === 'araba' && settings.home && trip.kind !== 'today') {
    progress('Evden yol mesafesi hesaplanıyor…');
    try { trip.drive = await driveRoute(settings.home, trip.dest); } catch (e) { console.warn('rota', e); }
  }

  progress('Gidilecek yer hakkında bilgi toplanıyor…');
  if (trip.dest.cc && trip.dest.cc !== settings.homeCountry) {
    try { trip.country = await countryInfo(trip.dest.cc); } catch (e) { console.warn('ülke', e); }
  }
  try {
    trip.destInfo = (await wikiForTags({ wikidata: trip.dest.wikidata, wikipedia: trip.dest.wikipedia })) || (await wikiSearch(trip.dest.name));
  } catch (e) { console.warn('wiki', e); }

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
