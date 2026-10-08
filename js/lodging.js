// Konaklama önerileri: OpenStreetMap'teki oteller, pansiyonlar, hosteller ve kamp alanları (Nominatim).
// Gezide seçilen konaklama türüne göre süzülür, o günlerde gezilecek yerlerin ortasına yakınlığa göre sıralanır.
// Fiyat bilgisi ücretsiz bir kaynakta yok; fiyatlar için tarihleri dolu Booking.com bağlantısı verilir.

import { nominatimNearby } from './api.js';
import { haversineKm } from './util.js';
import { t } from './i18n.js';

export const LODGING_TYPES = {
  hotel: t('Otel'), guest_house: t('Pansiyon'), hostel: t('Hostel'), motel: t('Motel'), camp_site: t('Kamp alanı'),
  apartment: t('Apart'), chalet: t('Dağ evi'), alpine_hut: t('Dağ kulübesi'),
};

// Konaklama türü → aranacak OSM türleri ve arama yarıçapı (m)
const QUERIES = {
  kamp: { q: ['camp site'], r: 8000 },
  hostel: { q: ['hostel', 'guest house'], r: 4000 },
  ekonomik: { q: ['guest house', 'hotel'], r: 3000 },
  orta: { q: ['hotel'], r: 3000 },
  konforlu: { q: ['hotel'], r: 3000 },
};

function score(l, stay) {
  const st = l.stars;
  let s = 0;
  if (stay === 'ekonomik') s += (['guest_house', 'motel', 'hostel'].includes(l.type) ? 1.5 : 0) + (st && st <= 2 ? 1 : 0) - (st >= 4 ? 1.5 : 0);
  if (stay === 'orta') s += (st === 3 ? 2 : st === 2 || st === 4 ? 0.8 : 0) + (l.type === 'guest_house' ? 0.5 : 0) - (st === 5 ? 0.5 : 0);
  if (stay === 'konforlu') s += (st >= 4 ? 2 : st === 3 ? 0.5 : 0) - (l.type === 'hostel' ? 2 : 0);
  if (stay === 'hostel') s += l.type === 'hostel' ? 2 : 0;
  if (stay === 'kamp') s += (st || 0) * 0.2;
  // Bilgisi eksiksiz olan (sitesi, telefonu olan) yerler daha güvenilir
  s += (l.website ? 0.6 : 0) + (l.phone ? 0.3 : 0) + (l.wikidata ? 0.5 : 0);
  return s - l.dist * (stay === 'kamp' ? 0.3 : 0.8);
}

// center: { lat, lon } → en uygun 3 yer (bulunamazsa boş dizi)
export async function fetchLodging(center, stay) {
  const cfg = QUERIES[stay];
  if (!cfg) return [];
  const seen = new Map();
  for (const radius of [cfg.r, cfg.r * 2.5]) { // yakında az yer varsa alan genişletilir
    for (const q of cfg.q) {
      const rows = await nominatimNearby(q, center.lat, center.lon, radius, 30);
      for (const r of rows) {
        if (r.category !== 'tourism' || !LODGING_TYPES[r.type] || !r.name) continue;
        const ex = r.extratags || {};
        const stars = parseInt(ex.stars, 10);
        const l = {
          id: (r.osm_type || 'n')[0] + r.osm_id, name: r.name, lat: +r.lat, lon: +r.lon, type: r.type,
          stars: Number.isFinite(stars) && stars > 0 && stars <= 5 ? stars : null,
          website: ex.website || ex['contact:website'] || null, phone: ex.phone || ex['contact:phone'] || null,
          wikidata: ex.wikidata || null,
        };
        l.dist = Math.round(haversineKm(center, l) * 10) / 10;
        seen.set(l.id, l);
      }
    }
    if (seen.size >= 3) break;
  }
  return [...seen.values()].map(l => ({ l, s: score(l, stay) })).sort((a, b) => b.s - a.s).slice(0, 3).map(x => x.l);
}

// Booking.com araması (tarihler ve kişi sayısı dolu); fiyatları görmek için
export function bookingUrl(query, checkin, checkout, travelers) {
  const u = new URL('https://www.booking.com/searchresults.html');
  u.searchParams.set('ss', query);
  if (checkin) u.searchParams.set('checkin', checkin);
  if (checkout) u.searchParams.set('checkout', checkout);
  u.searchParams.set('group_adults', String(travelers?.adults || 2));
  u.searchParams.set('group_children', String(travelers?.children || 0));
  u.searchParams.set('no_rooms', String(Math.max(1, Math.ceil((travelers?.adults || 2) / 2))));
  return u.toString();
}
