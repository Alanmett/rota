// Leaflet + OpenStreetMap harita yardımcıları.

import { t } from './i18n.js';

export const DAY_COLORS = ['#0f766e', '#c2410c', '#6d28d9', '#0369a1', '#be123c', '#4d7c0f', '#a16207', '#475569'];

export function createMap(el, center, zoom = 13) {
  if (!window.L) {
    el.classList.add('map-error');
    el.textContent = t('Harita yüklenemedi. İnternet bağlantını kontrol et.');
    return null;
  }
  const map = L.map(el, { zoomControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' + t('katkıcıları'),
  }).addTo(map);
  if (center) map.setView([center.lat, center.lon], zoom);
  else map.setView([39, 35], 5);
  setTimeout(() => map.invalidateSize(), 60);
  return map;
}

export const numIcon = (n, color) => L.divIcon({
  className: 'pin-num', html: `<span style="background:${color}">${n}</span>`,
  iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14],
});
export const emojiIcon = e => L.divIcon({
  className: 'pin-emoji', html: `<span>${e}</span>`, iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -15],
});
export const meIcon = () => L.divIcon({ className: 'pin-me', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9] });

// Açılır pencere içeriği DOM ile kurulur (mekân adları dışarıdan geldiği için HTML olarak basılmaz).
export function popupFor(p, subtitle, onOpen) {
  const el = document.createElement('div');
  el.className = 'popup';
  const b = document.createElement('b');
  b.textContent = p.name;
  el.append(b);
  if (subtitle) { const s = document.createElement('small'); s.textContent = subtitle; el.append(s); }
  if (onOpen) {
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = t('Detay');
    btn.addEventListener('click', onOpen);
    el.append(btn);
  }
  return el;
}
