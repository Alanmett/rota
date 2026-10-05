// Genel yardımcılar: mesafe, biçimlendirme, tarih.

export const toRad = d => d * Math.PI / 180;

export function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bboxAround(lat, lon, km) {
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.cos(toRad(lat)));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
}

export function fmtKm(km) {
  if (km == null) return '';
  if (km < 1) return `${Math.max(10, Math.round(km * 100) * 10)} m`;
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`;
}

export function fmtDur(min) {
  min = Math.round(min);
  if (min < 60) return `${min} dk`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} sa ${m} dk` : `${h} sa`;
}

export function fmtClock(min) {
  if (Math.round(min) === 1440) return '24:00';
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Para birimi kullanıcının yaşadığı ülkeye göre (Ayarlar) değişir.
let currency = 'CHF';
let money = new Intl.NumberFormat('tr-TR', { style: 'currency', currency, maximumFractionDigits: 0 });
export function setCurrency(code) {
  currency = code;
  money = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: code, maximumFractionDigits: 0 });
}
export const currencySymbol = () => ({ CHF: 'CHF', TRY: '₺', EUR: '€' })[currency] || currency;
export const fmtMoney = n => money.format(Math.round(n || 0));
export const fmtNum = n => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(n || 0));

export const toISODate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function parseISODate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export const todayISO = () => toISODate(new Date());

export function dateRange(startISO, endISO) {
  const out = [];
  const d = parseISODate(startISO), end = parseISODate(endISO);
  while (d <= end && out.length < 31) { out.push(toISODate(d)); d.setDate(d.getDate() + 1); }
  return out;
}

const dfShort = new Intl.DateTimeFormat('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' });
const dfLong = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
const dfDM = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
export const fmtDay = iso => dfShort.format(parseISODate(iso));
export const fmtDayLong = iso => dfLong.format(parseISODate(iso));
export function fmtRange(a, b) {
  if (a === b) return dfShort.format(parseISODate(a));
  return `${dfDM.format(parseISODate(a))} – ${dfDM.format(parseISODate(b))}`;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function normName(s) {
  return (s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// OSM'den gelen web adreslerini güvenli hale getirir (javascript: vb. engellenir).
export function safeUrl(u) {
  if (!u) return null;
  u = String(u).trim().split(';')[0];
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(u)) return 'https://' + u;
  return null;
}
