// Tüm veriler cihazda (localStorage) saklanır. Hesap ya da sunucu yok.

import { t } from './i18n.js';

const K = { trips: 'rota.trips.v1', settings: 'rota.settings.v1', near: 'rota.near.v1' };

// Yaşanılan ülkeye göre başlangıç fiyatları (tahmini; kullanıcı Ayarlar'dan günceller).
export const COUNTRY_PRESETS = {
  ch: {
    label: t('İsviçre'), currency: 'CHF',
    budget: {
      fuelPrice: 2.15,        // / litre (kullanıcı verisi, Ekim 2026 ortalaması)
      consumption: 7,         // L / 100 km
      // konaklama / gece: kamp ve hostel kişi başı, diğerleri oda başı
      stay: { kamp: 20, hostel: 45, ekonomik: 90, orta: 170, konforlu: 300 },
      food: { piknik: 15, ekonomik: 30, orta: 65, konforlu: 130 },  // kişi / gün
      ticketAvg: 15,          // ücretli yer başına, yetişkin
      transitPerPersonDay: 35,
      parkingPerDay: 20,
      bufferPct: 10,
    },
  },
  tr: {
    label: t('Türkiye'), currency: 'TRY',
    budget: {
      fuelPrice: 60, consumption: 7,
      stay: { kamp: 250, hostel: 500, ekonomik: 1500, orta: 3000, konforlu: 6000 },
      food: { piknik: 300, ekonomik: 600, orta: 1300, konforlu: 2600 },
      ticketAvg: 400, transitPerPersonDay: 250, parkingPerDay: 150, bufferPct: 10,
    },
  },
};

export const DEFAULT_SETTINGS = {
  homeCountry: 'ch',
  currency: 'CHF',
  lang: null,          // null: ilk açılışta otomatik (i18n.js)
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

export function getSettings() {
  const saved = read(K.settings, null);
  if (!saved) return structuredClone(DEFAULT_SETTINGS);
  // Varsayılan fiyatlar yaşanılan ülkenin (para biriminin) hazır değerlerinden gelir
  const preset = Object.values(COUNTRY_PRESETS).find(p => p.currency === saved.currency) || COUNTRY_PRESETS.ch;
  // Kullanıcı fiyatlara hiç dokunmadıysa her zaman güncel varsayılanlar (eski sürümün pahalı değerleri kalmasın)
  if (!saved.pricesReviewed) delete saved.budget;
  // Eski sürüm yalnız otel fiyatı tutuyordu: kullanıcının girdiği değerleri yeni yapıya taşı
  if (saved.budget?.hotel && !saved.budget.stay) {
    saved.budget.stay = { ...saved.budget.hotel };
    delete saved.budget.hotel;
  }
  return merge({ ...DEFAULT_SETTINGS, budget: structuredClone(preset.budget) }, saved);
}
export const saveSettings = s => write(K.settings, s);

const allTrips = () => read(K.trips, {});
export const listTrips = () => Object.values(allTrips());
export const getTrip = id => allTrips()[id] || null;
export function saveTrip(trip) {
  const all = allTrips();
  all[trip.id] = trip;
  if (!write(K.trips, all)) throw new Error(t('Gezi kaydedilemedi (cihaz depolaması dolu olabilir).'));
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
  if (d.app !== 'rota') throw new Error(t('Bu dosya bir Rota yedeği değil.'));
  write(K.trips, { ...allTrips(), ...(d.trips || {}) });
  if (d.settings) write(K.settings, d.settings);
  return Object.keys(d.trips || {}).length;
}
