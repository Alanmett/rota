// Uygulama girişi: sayfa yönlendirme, alt menü, çevrimdışı göstergesi, service worker.

import { h, $, initSheet, closeSheet, runLeave, setTitle } from './ui.js';
import { renderSuggest } from './views/suggest.js';
import { renderNear } from './views/near.js';
import { renderPlan } from './views/plan.js';
import { renderTrips } from './views/trips.js';
import { renderTrip } from './views/trip.js';
import { renderSettings } from './views/settings.js';
import { getSettings } from './store.js';
import { setCurrency } from './util.js';
import { t } from './i18n.js';

setCurrency(getSettings().currency);
// index.html'deki sabit metinler (sekme adları vb.)
for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
document.querySelector('.tabbar').setAttribute('aria-label', t('Ana menü'));
document.querySelector('#sheet').setAttribute('aria-label', t('Ayrıntılar'));

const routes = [
  [/^#\/oner$/, renderSuggest, 'oner', t('Nereye gidelim?')],
  [/^#\/kesfet$/, renderNear, 'kesfet', t('Keşfet')],
  [/^#\/planla$/, renderPlan, 'planla', t('Gezi planla')],
  [/^#\/geziler$/, renderTrips, 'geziler', t('Gezilerim')],
  [/^#\/gezi\/([\w-]+)(?:\/(plan|harita|butce|bilgi))?$/, renderTrip, 'geziler', t('Gezi')],
  [/^#\/ayarlar$/, renderSettings, 'ayarlar', t('Ayarlar')],
];

let lastTripId = null;
function route() {
  const hash = location.hash || '#/oner';
  const r = routes.find(([re]) => re.test(hash));
  if (!r) { location.replace('#/oner'); return; }
  const [re, fn, tab, title] = r;
  const args = hash.match(re).slice(1);
  runLeave();
  closeSheet();
  for (const a of document.querySelectorAll('.tabbar a')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  setTitle(title);
  const page = h('div', { class: 'page' });
  $('#view').replaceChildren(page);
  try {
    fn(page, ...args);
  } catch (e) {
    console.error(e);
    page.append(h('p', { class: 'error' }, t('Bir hata oluştu: {e}', { e: e.message })));
  }
  // Gezi içindeki sekmeler arasında geçerken sayfa başa atlamasın
  const tripId = fn === renderTrip ? args[0] : null;
  if (!(tripId && tripId === lastTripId)) window.scrollTo(0, 0);
  lastTripId = tripId;
}

initSheet();
window.addEventListener('hashchange', route);
route();

const net = $('#net-status');
const updNet = () => { net.hidden = navigator.onLine; };
window.addEventListener('online', updNet);
window.addEventListener('offline', updNet);
updNet();

navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
