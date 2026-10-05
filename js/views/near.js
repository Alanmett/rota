// Keşfet: bulunduğun yerin (ya da seçtiğin bir yerin) çevresinde ne var?

import { h, fill, toast, openSheet, closeSheet, segmented, chips, stepper, spinner, onLeave } from '../ui.js';
import { reverseGeocode, weatherNow, WX } from '../api.js';
import { CATS, fetchPlaces, isSight } from '../places.js';
import { PACES, TRANSPORTS } from '../planner.js';
import { getNear, saveNear, getSettings } from '../store.js';
import { generateTrip } from '../tripgen.js';
import { showPlaceDetail, addToTripSheet } from '../details.js';
import { placeSearch, placeCard } from '../components.js';
import { createMap, emojiIcon, meIcon, popupFor } from '../map.js';
import { catEmoji } from '../places.js';
import { todayISO, fmtClock } from '../util.js';

const RADII = [
  { value: 2, label: 'Yürüme', sub: '2 km' },
  { value: 10, label: 'Şehir içi', sub: '10 km' },
  { value: 50, label: 'Günübirlik', sub: '50 km' },
  { value: 120, label: 'Uzun yol', sub: '120 km' },
];
const CAT_OPTIONS = Object.entries(CATS).map(([value, c]) => ({ value, ...c }));

const saved = getNear() || {};
const state = {
  loc: saved.loc || null,
  radius: saved.radius || 10,
  cats: saved.cats || ['tarihi', 'muze', 'dogal', 'manzara'],
  results: null, weather: null, view: 'list', sort: 'rank', showAll: false,
};
const persist = () => saveNear({ loc: state.loc, radius: state.radius, cats: state.cats });

export function renderNear(root) {
  const locCard = h('section', { class: 'card loc-card' });
  const results = h('div', { class: 'results' });
  const goBtn = h('button', { class: 'btn primary wide', onclick: search }, 'Çevremi keşfet');
  let map = null;

  function renderLoc(searching = false) {
    const wx = state.weather;
    fill(locCard,
      h('div', { class: 'loc-line' },
        h('span', { class: 'loc-pin', 'aria-hidden': 'true' }, '📍'),
        h('div', {},
          h('div', { class: 'loc-name' }, state.loc ? state.loc.label : 'Konum seçilmedi'),
          wx
            ? h('div', { class: 'muted small' }, `${WX(wx.code)[0]} ${Math.round(wx.temp)}° ${WX(wx.code)[1]} · bugün ${Math.round(wx.tmin)}°/${Math.round(wx.tmax)}°${wx.pop >= 30 ? ` · yağış %${wx.pop}` : ''}`)
            : !state.loc && h('div', { class: 'muted small' }, 'Konumunu kullan ya da bir yer ara.'))),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: useGps }, '◎ Konumumu kullan'),
        h('button', { class: 'btn', onclick: () => renderLoc(!searching) }, searching ? 'Vazgeç' : '🔎 Başka yer')),
      searching && placeSearch({ placeholder: 'Şehir, ilçe, semt…', autofocus: true, onPick: r => setLoc({ ...r, gps: false }) }),
    );
  }

  function setLoc(loc) {
    state.loc = loc; state.results = null; state.weather = null;
    persist(); renderLoc(); results.replaceChildren(); loadWeather();
  }

  async function loadWeather() {
    if (!state.loc) return;
    try { state.weather = await weatherNow(state.loc.lat, state.loc.lon); if (locCard.isConnected) renderLoc(); } catch { /* hava olmadan devam */ }
  }

  function useGps() {
    if (!('geolocation' in navigator)) return toast('Bu cihaz konum özelliğini desteklemiyor.');
    locCard.querySelector('.loc-name').textContent = 'Konum alınıyor…';
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      let info = null;
      try { info = await reverseGeocode(lat, lon); } catch { /* adsız devam */ }
      setLoc({ ...(info || {}), lat, lon, name: info?.name || 'Bulunduğun yer', label: info?.label || 'Bulunduğun yer', cc: info?.cc || '', gps: true });
    }, err => {
      renderLoc();
      toast(err.code === 1 ? 'Konum izni verilmedi. Tarayıcı ayarlarından izin verebilir ya da yer arayabilirsin.' : 'Konum alınamadı. Bir yer arayarak devam edebilirsin.', 4500);
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
  }

  async function search() {
    if (!state.loc) return toast('Önce konum seç.');
    if (!state.cats.length) return toast('En az bir ilgi alanı seç.');
    goBtn.disabled = true;
    results.replaceChildren(spinner(state.radius > 30 ? 'Geniş alanda aranıyor, biraz sürebilir…' : 'Çevrendeki yerler aranıyor…'));
    try {
      state.results = await fetchPlaces({ lat: state.loc.lat, lon: state.loc.lon, radiusKm: state.radius, cats: state.cats });
      state.showAll = false;
      renderResults();
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      results.replaceChildren(h('p', { class: 'error' }, e.message));
    } finally {
      goBtn.disabled = false;
    }
  }

  function sortedList() {
    const list = [...(state.results || [])];
    if (state.sort === 'near') return list.sort((a, b) => a.dist - b.dist);
    const k = state.radius * 0.6;
    return list.sort((a, b) => b.score / (1 + b.dist / k) - a.score / (1 + a.dist / k));
  }

  function renderResults() {
    map?.remove(); map = null;
    const all = state.results || [];
    if (!all.length) {
      results.replaceChildren(h('div', { class: 'empty' },
        h('h2', {}, 'Bu alanda kayıtlı yer bulunamadı'),
        h('p', { class: 'muted' }, 'Mesafeyi artırmayı ya da başka ilgi alanları seçmeyi dene.')));
      return;
    }
    const list = sortedList();
    const sights = all.filter(isSight).length;
    let content;
    if (state.view === 'map') {
      content = h('div', { class: 'map' });
      setTimeout(() => { if (content.isConnected) drawMap(content, list); });
    } else {
      const shown = state.showAll ? list : list.slice(0, 40);
      content = h('div', { class: 'cards' },
        shown.map(p => placeCard(p, { onAdd: () => addToTripSheet(p) })),
        list.length > shown.length && h('button', { class: 'btn wide', onclick: () => { state.showAll = true; renderResults(); } }, `Tümünü göster (${list.length})`));
    }
    fill(results,
      h('div', { class: 'results-head' },
        h('b', {}, `${all.length} yer bulundu`),
        segmented([{ value: 'list', label: 'Liste' }, { value: 'map', label: 'Harita' }], state.view, v => { state.view = v; renderResults(); })),
      sights > 0 && h('button', { class: 'btn primary wide', onclick: planTodaySheet }, '✨ Bunlardan bugün için plan yap'),
      state.view === 'list' && segmented([{ value: 'rank', label: 'Öne çıkanlar' }, { value: 'near', label: 'En yakın' }], state.sort, v => { state.sort = v; renderResults(); }),
      all.partial && h('div', { class: 'note warn' }, 'Veri kaynaklarından biri şu an yanıt vermedi; liste eksik olabilir. Biraz sonra tekrar aramayı dene.'),
      content,
      h('p', { class: 'muted small source' }, state.radius > 10
        ? 'Merkezin 10 km dışında yalnızca Wikipedia\'da maddesi olan, bilinen yerler gösterilir.'
        : 'Veriler OpenStreetMap ve Wikidata gönüllülerinden gelir; küçük yerlerde eksik olabilir.'),
    );
  }

  function drawMap(el, list) {
    map = createMap(el, state.loc, state.radius <= 2 ? 15 : 12);
    if (!map) return;
    const bounds = [[state.loc.lat, state.loc.lon]];
    L.marker([state.loc.lat, state.loc.lon], { icon: meIcon() }).addTo(map).bindPopup(state.loc.gps ? 'Buradasın' : state.loc.label);
    for (const p of list.slice(0, 150)) {
      L.marker([p.lat, p.lon], { icon: emojiIcon(catEmoji(p)) }).addTo(map)
        .bindPopup(popupFor(p, null, () => showPlaceDetail(p, { actions: [h('button', { class: 'btn', onclick: () => addToTripSheet(p) }, '＋ Geziye ekle')] })));
      bounds.push([p.lat, p.lon]);
    }
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
  }

  function planTodaySheet() {
    const settings = getSettings();
    let transport = state.radius <= 2 ? 'yuruyus' : settings.transport, pace = 'normal', adults = 2, children = 0;
    const now = new Date();
    let startMin = Math.ceil((now.getHours() * 60 + now.getMinutes() + 15) / 15) * 15;
    if (startMin < 570) startMin = 570;
    const left = 21 * 60 - startMin;
    openSheet(h('div', {},
      h('h2', { class: 'sheet-title' }, 'Bugün için plan'),
      h('p', { class: 'muted' }, left < 120
        ? `Saat epey geç oldu. ${fmtClock(startMin)} sonrası için kısa bir plan çıkaracağım; ileri bir gün için Planla sekmesini kullan.`
        : `Bulduğum yerlerden, saat ${fmtClock(startMin)}'dan başlayan bir rota çıkaracağım.`),
      h('h3', { class: 'h-sec' }, 'Nasıl gezeceksin?'),
      segmented(Object.entries(TRANSPORTS).map(([value, t]) => ({ value, label: t.label })), transport, v => { transport = v; }),
      h('h3', { class: 'h-sec' }, 'Tempo'),
      segmented(Object.entries(PACES).map(([value, p]) => ({ value, label: p.label, sub: p.sub })), pace, v => { pace = v; }),
      h('div', { class: 'row' }, h('span', {}, 'Yetişkin'), stepper(adults, 1, 20, v => { adults = v; }, 'Yetişkin')),
      h('div', { class: 'row' }, h('span', {}, 'Çocuk'), stepper(children, 0, 10, v => { children = v; }, 'Çocuk')),
      h('button', { class: 'btn primary wide', onclick: go }, 'Planı oluştur')));

    async function go() {
      const body = h('div', {}, spinner('Plan hazırlanıyor…'));
      openSheet(body);
      try {
        const trip = await generateTrip({
          kind: 'today', name: `Bugün · ${state.loc.name}`, dest: state.loc,
          origin: state.loc.gps ? { lat: state.loc.lat, lon: state.loc.lon } : null,
          startDate: todayISO(), endDate: todayISO(),
          travelers: { adults, children, elderly: false, pet: false },
          transport, pace, level: 'orta', radiusKm: state.radius, interests: state.cats,
          places: state.results, startMin, firstDayBudget: Math.max(90, Math.min(PACES[pace].budget, left)),
        }, settings, msg => body.replaceChildren(spinner(msg)));
        closeSheet();
        location.hash = `#/gezi/${trip.id}`;
      } catch (e) {
        body.replaceChildren(h('p', { class: 'error' }, e.message));
      }
    }
  }

  root.append(
    locCard,
    h('section', {}, h('h2', { class: 'h-sec' }, 'Ne kadar uzağa?'), segmented(RADII, state.radius, v => { state.radius = v; persist(); })),
    h('section', {}, h('h2', { class: 'h-sec' }, 'Ne görmek istersin?'), chips(CAT_OPTIONS, state.cats, v => { state.cats = v; persist(); })),
    goBtn,
    results,
  );
  renderLoc();
  if (state.loc && !state.weather) loadWeather();
  if (state.results) renderResults();
  onLeave(() => { map?.remove(); map = null; });
}
