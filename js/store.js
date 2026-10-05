// Tüm veriler cihazda (localStorage) saklanır. Hesap ya da sunucu yok.

const K = { trips: 'rota.trips.v1', settings: 'rota.settings.v1', near: 'rota.near.v1' };

// Yaşanılan ülkeye göre başlangıç fiyatları (tahmini; kullanıcı Ayarlar'dan günceller).
export const COUNTRY_PRESETS = {
  ch: {
    label: 'İsviçre', currency: 'CHF',
    budget: {
      fuelPrice: 1.85,        // / litre
      consumption: 7,         // L / 100 km
      hotel: { ekonomik: 120, orta: 200, konforlu: 350 },   // oda / gece
      food: { ekonomik: 45, orta: 85, konforlu: 150 },      // kişi / gün
      ticketAvg: 15,          // ücretli yer başına, yetişkin
      transitPerPersonDay: 35,
      parkingPerDay: 20,
      bufferPct: 10,
    },
  },
  tr: {
    label: 'Türkiye', currency: 'TRY',
    budget: {
      fuelPrice: 60, consumption: 7,
      hotel: { ekonomik: 2000, orta: 4000, konforlu: 8000 },
      food: { ekonomik: 700, orta: 1400, konforlu: 2800 },
      ticketAvg: 400, transitPerPersonDay: 250, parkingPerDay: 150, bufferPct: 10,
    },
  },
};

export const DEFAULT_SETTINGS = {
  homeCountry: 'ch',
  currency: 'CHF',
  home: null,
  transport: 'araba',
  museumCard: false,   // TR: Müzekart · CH: İsviçre Müze Pasaportu
  halfFare: false,     // CH: Halbtax (toplu taşıma yarı fiyat)
  pricesReviewed: false,
  budget: structuredClone(COUNTRY_PRESETS.ch.budget),
};

function read(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } }
function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }

function merge(def, val) {
  if (val == null) return structuredClone(def);
  if (typeof def !== 'object' || def === null || Array.isArray(def)) return val;
  const out = structuredClone(def);
  for (const k of Object.keys(val)) {
    out[k] = def[k] && typeof def[k] === 'object' && !Array.isArray(def[k]) ? merge(def[k], val[k]) : val[k];
  }
  return out;
}

export const getSettings = () => merge(DEFAULT_SETTINGS, read(K.settings, null));
export const saveSettings = s => write(K.settings, s);

const allTrips = () => read(K.trips, {});
export const listTrips = () => Object.values(allTrips());
export const getTrip = id => allTrips()[id] || null;
export function saveTrip(t) {
  const all = allTrips();
  all[t.id] = t;
  if (!write(K.trips, all)) throw new Error('Gezi kaydedilemedi (cihaz depolaması dolu olabilir).');
}
export function deleteTrip(id) { const all = allTrips(); delete all[id]; write(K.trips, all); }

export const getNear = () => read(K.near, null);
export const saveNear = v => write(K.near, v);

// Ekranların hatırladığı küçük tercihler (son seçilen süre, ülke vb.)
export const getPref = (name, fb) => read(`rota.pref.${name}`, fb);
export const savePref = (name, v) => write(`rota.pref.${name}`, v);

export function exportData() {
  return JSON.stringify({ app: 'rota', version: 1, exportedAt: new Date().toISOString(), settings: read(K.settings, {}), trips: allTrips() }, null, 2);
}
export function importData(text) {
  const d = JSON.parse(text);
  if (d.app !== 'rota') throw new Error('Bu dosya bir Rota yedeği değil.');
  write(K.trips, { ...allTrips(), ...(d.trips || {}) });
  if (d.settings) write(K.settings, d.settings);
  return Object.keys(d.trips || {}).length;
}
