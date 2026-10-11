// Bisikletli geziler: Öner, plan ve rota aynı hız ve yokuş varsayımlarını kullanır; planın başındaki uyarılar da buradan gelir.
//   cruise: uzun yolda ortalama km/sa (OSRM bisiklet süresi × factor ile tutarlı)   town: şehir içi kısa etaplarda km/sa
//   factor: OSRM bisiklet süresine çarpan (kavşak ve mola payı; elektrikli destek süreyi kısaltır)
//   climb: net tırmanışın her kaç metresi bir saat ekler   dayMin: bir günde makul en çok sürüş (dakika)

import { fmtDay, fmtDur, fmtKm } from './util.js';
import { t } from './i18n.js';

export const BIKE = {
  bisiklet: { cruise: 16, town: 14, factor: 1.1, climb: 800, dayMin: 300 },
  ebisiklet: { cruise: 21, town: 19, factor: 0.85, climb: 2000, dayMin: 360 },
};
export const isBike = tr => tr === 'bisiklet' || tr === 'ebisiklet';

const STEEP_M = 400;   // bir etapta bu kadar net tırmanış "ciddi" sayılır
const BATTERY_KM = 60; // elektrikli bisikletle bir günde bundan uzun yolda pil uyarısı

const peakText = names => t('Planda zirve ya da dağ durakları var ({x}); bisikletle çok yorucu olabilir. Teleferik ya da tren seçeneğine bak, istersen bu durakları plandan çıkar.', { x: names.slice(0, 3).join(', ') });

// Plana özel uyarılar (genel öğütler tips.js'te). Plan sekmesinin başında gösterilir.
export function bikeWarnings(trip) {
  const B = BIKE[trip.transport];
  if (!B) return [];
  const e = trip.transport === 'ebisiklet';
  const out = [];
  const peaks = [...new Set(trip.days.flatMap(d => d.stops).map(id => trip.places[id]).filter(p => p && (p.type === 'peak' || p.type === 'volcano')).map(p => p.name))];
  if (!trip.route) {
    out.push({ icon: '⏱️', text: t('Duraklar arası süreler kuş uçuşunun 1,3 katı yol ve ortalama {v} km/sa hıza göre tahmin edildi; yokuş, rüzgâr ve mola süreyi uzatır. Bisiklet yolu olup olmadığını ve yokuşları haritada kontrol et.', { v: B.town }) });
    if (peaks.length) out.push({ icon: '⛰️', text: peakText(peaks) });
    return out;
  }
  out.push({ icon: '⏱️', text: t('Şehirler arası süreler bisiklet yollarına göre hesaplandı, iki şehir arasındaki yükseklik farkı eklendi. Aradaki tepeler sayılmadığı için gerçek süre daha uzun olabilir; her etabı bisiklet haritasında kontrol et.') });

  const r = trip.route;
  const long = trip.days.filter(d => (d.drive || 0) > B.dayMin);
  if (long.length) {
    out.push({ icon: '🥵', text: t('Sürüş süresi {d} üzerinde olan günler: {days}. Bir yerde gece kalmayı ya da bir etabı trenle yapmayı düşün.', {
      d: fmtDur(B.dayMin), days: long.map(d => fmtDay(d.date)).join(', '),
    }) });
  }
  const seq = [r.start && { ...r.start, key: 's' }, ...r.cities, r.end && { ...r.end, key: 'e' }].filter(Boolean);
  const steep = [];
  for (let i = 1; i < seq.length; i++) {
    const rd = r.roads?.[`${seq[i - 1].key}>${seq[i].key}`];
    if (rd?.climb >= STEEP_M) steep.push(`${seq[i - 1].name} → ${seq[i].name} (↗ ${rd.climb} m)`);
  }
  if (steep.length) {
    out.push({ icon: '⛰️', text: t('Ciddi tırmanışlı etaplar: {x}. Süreye eklendi ama yine de yorucu olabilir; mola payı bırak.', { x: steep.join(', ') })
      + (e ? '' : ' ' + t('Elektrikli bisiklet bu yokuşları çok kolaylaştırır.')) });
  }
  if (peaks.length) out.push({ icon: '⛰️', text: peakText(peaks) });
  if (e) {
    const far = Math.max(0, ...trip.days.map(d => d.km || 0));
    if (far > BATTERY_KM) {
      out.push({ icon: '🔋', text: t('Elektrikli bisikletin pil menzili destek seviyesine, yokuşa ve yüke göre genelde 40–100 km. En uzun gün {km}; şarj aletini al, konaklamada şarj imkânı sor.', { km: fmtKm(far) }) });
    }
  }
  return out;
}
