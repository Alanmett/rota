// Keşfet: bulunduğun yerin (ya da seçtiğin bir yerin) çevresinde ne var?

import { h, fill, toast, openSheet, closeSheet, segmented, chips, stepper, spinner, onLeave } from '../ui.js';
import { reverseGeocode, weatherNow, WX } from '../api.js';
import { CATS, fetchPlaces, isSight, catEmoji } from '../places.js';
import { PACES, TRANSPORTS } from '../planner.js';
import { getNear, saveNear, getSettings } from '../store.js';
import { generateTrip } from '../tripgen.js';
import { showPlaceDetail, addToTripSheet } from '../details.js';
import { placeSearch, placeCard } from '../components.js';
import { createMap, emojiIcon, meIcon, popupFor } from '../map.js';
import { todayISO, fmtClock, fmtDur } from '../util.js';
import { t } from '../i18n.js';
import { getPosition } from '../geo.js';

// Mesafe kaydırıcısının durakları (km); kısa mesafelerde daha ince ayar
const STOPS = [1, 2, 3, 5, 7, 10, 15, 20, 30, 40, 50, 75, 100, 150, 200];
const driveMin = km => (km * 1.3) / (km <= 15 ? 30 : 65) * 60 + 5;
const CAT_OPTIONS = Object.entries(CATS).map(([value, c]) => ({ value, ...c }));

const saved = getNear() || {};
const state = {
  loc: saved.loc || null,
  radius: saved.radius || 10,
  cats: saved.cats || ['tarihi', 'muze', 'dogal', 'manzara'],
  hidden: !!saved.hidden,
  results: null, weather: null, view: 'list', sort: 'rank', showAll: false,
};
const persist = () => saveNear({ loc: state.loc, radius: state.radius, cats: state.cats, hidden: state.hidden });

// Öner ekranından "Çevresini keşfet" ile gelindiğinde konumu ayarlar.
export function setNearLocation(loc) {
  state.loc = loc; state.results = null; state.weather = null;
  if (state.radius > 20) state.radius = 10;
  persist();
}

function radiusControl() {
  const value = h('b', {});
  const hint = h('span', { class: 'muted small' });
  const upd = () => {
    value.textContent = `${state.radius} km`;
    hint.textContent = state.radius <= 3 ? t('yürüme mesafesi · küçük yerler dahil') : t('arabayla en fazla ~{d}', { d: fmtDur(driveMin(state.radius)) });
  };
  const idx = Math.max(0, STOPS.findIndex(s => s >= state.radius));
  const input = h('input', {
    type: 'range', class: 'range', min: '0', max: String(STOPS.length - 1), step: '1', value: String(idx), 'aria-label': t('Mesafe'),
    oninput: e => { state.radius = STOPS[+e.target.value]; upd(); },
    onchange: persist,
  });
  upd();
  return h('div', { class: 'range-row' }, h('div', { class: 'range-head' }, value, hint), input,
    h('p', { class: 'muted small' }, t('Uzak bir yer mi arıyorsun? "Öner" sekmesi yol süresine göre gidilecek yer önerir.')));
}

export function renderNear(root) {
  const locCard = h('section', { class: 'card loc-card' });
  const results = h('div', { class: 'results' });
  const goBtn = h('button', { class: 'btn primary wide sticky-cta', onclick: search }, t('Çevremi keşfet'));
  let map = null;

  function renderLoc(searching = false) {
    const wx = state.weather;
    const home = getSettings().home;
    fill(locCard,
      h('div', { class: 'loc-line' },
        h('span', { class: 'loc-pin', 'aria-hidden': 'true' }, state.loc?.home ? '🏠' : '📍'),
        h('div', {},
          h('div', { class: 'loc-name' }, state.loc ? state.loc.label : t('Konum seçilmedi')),
          wx
            ? h('div', { class: 'muted small' }, `${WX(wx.code)[0]} ${Math.round(wx.temp)}° ${WX(wx.code)[1]} · ${t('bugün')} ${Math.round(wx.tmin)}°/${Math.round(wx.tmax)}°${wx.pop >= 30 ? ` · ${t('yağış')} ${wx.pop}%` : ''}`)
            : !state.loc && h('div', { class: 'muted small' }, t('Konumunu kullan ya da bir yer ara.')))),
      h('div', { class: 'btn-row' },
        home && h('button', { class: 'btn', onclick: () => setLoc({ lat: home.lat, lon: home.lon, name: home.label, label: home.label, cc: getSettings().homeCountry, gps: false, home: true }) }, '🏠 ' + t('Ev')),
        h('button', { class: 'btn', onclick: useGps }, '◎ ' + t('Konumumu kullan')),
        h('button', { class: 'btn', onclick: () => renderLoc(!searching) }, searching ? t('Vazgeç') : '🔎 ' + t('Başka yer'))),
      searching && placeSearch({ placeholder: t('Şehir, ilçe, semt…'), autofocus: true, onPick: r => setLoc({ ...r, gps: false }) }),
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

  async function useGps() {
    locCard.querySelector('.loc-name').textContent = t('Konum alınıyor…');
    const pos = await getPosition();
    if (!pos) { renderLoc(); return; }
    let info = null;
    try { info = await reverseGeocode(pos.lat, pos.lon); } catch { /* adsız devam */ }
    setLoc({ ...(info || {}), ...pos, name: info?.name || t('Bulunduğun yer'), label: info?.label || t('Bulunduğun yer'), cc: info?.cc || '', gps: true });
  }

  async function search() {
    if (!state.loc) return toast(t('Önce konum seç.'));
    if (!state.cats.length) return toast(t('En az bir ilgi alanı seç.'));
    goBtn.disabled = true;
    results.replaceChildren(spinner(t('Çevrendeki yerler aranıyor…')));
    try {
      const found = await fetchPlaces({ lat: state.loc.lat, lon: state.loc.lon, radiusKm: state.radius, cats: state.cats, hidden: state.hidden });
      state.results = found;
      state.showAll = false;
      renderResults();
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Çalışma saatleri sonradan gelirse "Şu an açık" bilgisini güncelle
      found.hoursReady?.then(() => { if (state.results === found && results.isConnected && state.view === 'list') renderResults(); });
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
        h('h2', {}, t('Bu alanda kayıtlı yer bulunamadı')),
        h('p', { class: 'muted' }, t('Mesafeyi artırmayı ya da başka ilgi alanları seçmeyi dene.'))));
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
        list.length > shown.length && h('button', { class: 'btn wide', onclick: () => { state.showAll = true; renderResults(); } }, t('Tümünü göster ({n})', { n: list.length })));
    }
    fill(results,
      h('div', { class: 'results-head' },
        h('b', {}, t('{n} yer bulundu', { n: all.length })),
        segmented([{ value: 'list', label: t('Liste') }, { value: 'map', label: t('Harita') }], state.view, v => { state.view = v; renderResults(); })),
      sights > 0 && h('button', { class: 'btn primary wide', onclick: planTodaySheet }, '✨ ' + t('Bunlardan bugün için plan yap')),
      state.view === 'list' && segmented([{ value: 'rank', label: t('Önerilen sıra') }, { value: 'near', label: t('En yakın') }], state.sort, v => { state.sort = v; renderResults(); }),
      all.partial && h('div', { class: 'note warn' }, t('Veri kaynaklarından biri şu an yanıt vermedi; liste eksik olabilir. Biraz sonra tekrar aramayı dene.')),
      content,
      h('p', { class: 'muted small source' }, state.radius > 3
        ? t("Wikipedia'da maddesi olan, bilinen yerler gösteriliyor. Küçük müzeler ve seyir noktaları için mesafeyi 3 km'ye indir.")
        : t('Veriler OpenStreetMap ve Wikidata gönüllülerinden gelir; küçük yerlerde eksik olabilir.')),
    );
  }

  function drawMap(el, list) {
    map = createMap(el, state.loc, state.radius <= 2 ? 15 : 12);
    if (!map) return;
    const bounds = [[state.loc.lat, state.loc.lon]];
    L.marker([state.loc.lat, state.loc.lon], { icon: meIcon() }).addTo(map).bindPopup(state.loc.gps ? t('Buradasın') : state.loc.label);
    for (const p of list.slice(0, 150)) {
      L.marker([p.lat, p.lon], { icon: emojiIcon(catEmoji(p)) }).addTo(map)
        .bindPopup(popupFor(p, null, () => showPlaceDetail(p, { actions: [h('button', { class: 'btn', onclick: () => addToTripSheet(p) }, '＋ ' + t('Geziye ekle'))], parking: getSettings().transport === 'araba' })));
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
      h('h2', { class: 'sheet-title' }, t('Bugün için plan')),
      h('p', { class: 'muted' }, left < 120
        ? t('Saat epey geç oldu. {x} sonrası için kısa bir plan çıkaracağım; ileri bir gün için Planla sekmesini kullan.', { x: fmtClock(startMin) })
        : t('Bulduğum yerlerden, saat {x} itibarıyla başlayan bir rota çıkaracağım.', { x: fmtClock(startMin) })),
      h('h3', { class: 'h-sec' }, t('Nasıl gezeceksin?')),
      segmented(Object.entries(TRANSPORTS).map(([value, x]) => ({ value, label: x.label })), transport, v => { transport = v; }),
      h('h3', { class: 'h-sec' }, t('Tempo')),
      segmented(Object.entries(PACES).map(([value, p]) => ({ value, label: p.label, sub: p.sub })), pace, v => { pace = v; }),
      h('div', { class: 'row' }, h('span', {}, t('Yetişkin')), stepper(adults, 1, 20, v => { adults = v; }, t('Yetişkin'))),
      h('div', { class: 'row' }, h('span', {}, t('Çocuk')), stepper(children, 0, 10, v => { children = v; }, t('Çocuk'))),
      h('button', { class: 'btn primary wide', onclick: go }, t('Planı oluştur'))));

    async function go() {
      const body = h('div', {}, spinner(t('Plan hazırlanıyor…')));
      openSheet(body);
      try {
        const trip = await generateTrip({
          kind: 'today', name: `${t('Bugün')} · ${state.loc.name}`, dest: state.loc,
          origin: state.loc.gps ? { lat: state.loc.lat, lon: state.loc.lon } : null,
          startDate: todayISO(), endDate: todayISO(),
          travelers: { adults, children, elderly: false, pet: false },
          transport, pace, level: 'ekonomik', radiusKm: state.radius, interests: state.cats, hidden: state.hidden,
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
    h('section', {}, h('h2', { class: 'h-sec' }, t('Ne kadar uzağa?')), radiusControl()),
    h('section', {}, h('h2', { class: 'h-sec' }, t('Ne görmek istersin?')), chips(CAT_OPTIONS, state.cats, v => { state.cats = v; persist(); }),
      h('div', { style: 'margin-top:10px' }, segmented([{ value: false, label: '⭐ ' + t('Öne çıkanlar') }, { value: true, label: '🔎 ' + t('Az bilinenler') }], state.hidden, v => { state.hidden = v; persist(); }))),
    goBtn,
    results,
  );
  renderLoc();
  if (state.loc && !state.weather) loadWeather();
  if (state.results) renderResults();
  onLeave(() => { map?.remove(); map = null; });
}
