// Öner: "Nereye gidelim?" Yol süresine, ulaşıma, ülkeye ve ilgiye göre gidilecek yer önerileri.

import { h, fill, toast, openSheet, closeSheet, segmented, chips, spinner, tappable, linkBtn, onLeave } from '../ui.js';
import { reverseGeocode, wikiForTags } from '../api.js';
import { suggest, KINDS, COUNTRY_NAMES, flag } from '../suggest.js';
import { getSettings, getPref, savePref } from '../store.js';
import { prefillPlan } from './plan.js';
import { setNearLocation } from './near.js';
import { placeSearch } from '../components.js';
import { createMap, emojiIcon, meIcon, popupFor } from '../map.js';
import { fmtDur, fmtKm, toISODate } from '../util.js';

const TIMES = [
  { value: '0-1', label: '1 saate kadar', min: 0, max: 1 },
  { value: '1-2', label: '1–2 saat', min: 1, max: 2 },
  { value: '2-3', label: '2–3 saat', min: 2, max: 3 },
  { value: '3-4', label: '3–4 saat', min: 3, max: 4 },
  { value: '4-6', label: '4–6 saat', min: 4, max: 6 },
  { value: 'ozel', label: 'Özel…' },
];
const MAIN_COUNTRIES = ['CH', 'IT', 'FR', 'DE', 'AT', 'TR'];
const LENGTHS = [{ value: 'gun', label: 'Günübirlik' }, { value: 'hafta', label: 'Hafta sonu' }, { value: 'uzun', label: '3+ gün' }];

const saved = getPref('suggest', {});
const state = {
  origin: saved.origin || null, time: saved.time || '2-3', min: saved.min ?? 2, max: saved.max ?? 3,
  mode: saved.mode || null, countries: saved.countries || [], kinds: saved.kinds || ['s', 'n'], len: saved.len || 'gun',
  showAllCountries: false, results: null, view: 'list',
};
const persist = () => savePref('suggest', { origin: state.origin, time: state.time, min: state.min, max: state.max, mode: state.mode, countries: state.countries, kinds: state.kinds, len: state.len });

const hoursOf = p => p.hours ?? p.est;

export function renderSuggest(root) {
  const settings = getSettings();
  if (!state.origin && settings.home) state.origin = { ...settings.home, src: 'home' };
  state.mode ||= settings.transport === 'araba' ? 'araba' : 'tren';

  const originBox = h('section', { class: 'card loc-card' });
  const timeBox = h('div');
  const countryBox = h('div');
  const results = h('div', { class: 'results' });
  const goBtn = h('button', { class: 'btn primary wide', onclick: run }, '✨ Bana yer öner');
  let map = null;

  function renderOrigin(searching = false) {
    fill(originBox,
      h('div', { class: 'loc-line' },
        h('span', { class: 'loc-pin', 'aria-hidden': 'true' }, state.origin?.src === 'home' ? '🏠' : '📍'),
        h('div', {},
          h('div', { class: 'muted small' }, 'Nereden çıkacaksın?'),
          h('div', { class: 'loc-name' }, state.origin ? state.origin.label : 'Başlangıç seçilmedi'))),
      h('div', { class: 'btn-row' },
        settings.home && h('button', { class: 'btn small', onclick: () => setOrigin({ ...settings.home, src: 'home' }) }, '🏠 Ev'),
        h('button', { class: 'btn small', onclick: useGps }, '◎ Konumum'),
        h('button', { class: 'btn small', onclick: () => renderOrigin(!searching) }, searching ? 'Vazgeç' : '🔎 Başka yer')),
      !settings.home && !searching && h('p', { class: 'muted small' }, 'İpucu: Ayarlar\'dan ev konumunu eklersen hep oradan hesaplanır.'),
      searching && placeSearch({ placeholder: 'Şehir ya da semt', autofocus: true, onPick: r => setOrigin({ lat: r.lat, lon: r.lon, label: r.label, src: 'search' }) }),
    );
  }
  function setOrigin(o) { state.origin = o; state.results = null; persist(); renderOrigin(); results.replaceChildren(); }
  function useGps() {
    if (!('geolocation' in navigator)) return toast('Bu cihaz konum özelliğini desteklemiyor.');
    toast('Konum alınıyor…');
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      let info = null;
      try { info = await reverseGeocode(lat, lon, 12); } catch { /* adsız */ }
      setOrigin({ lat, lon, label: info?.label || 'Bulunduğun yer', src: 'gps' });
    }, () => toast('Konum alınamadı; bir yer arayabilirsin.'), { timeout: 15000, maximumAge: 300000 });
  }

  function renderTime() {
    const custom = state.time === 'ozel';
    const num = (label, key) => h('label', { class: 'field' }, h('span', {}, label),
      h('div', { class: 'input-suffix' },
        h('input', {
          type: 'text', inputmode: 'decimal', value: String(state[key]).replace('.', ','),
          onchange: e => { const v = parseFloat(e.target.value.replace(',', '.')); if (!Number.isNaN(v) && v >= 0 && v <= 24) { state[key] = v; persist(); } else e.target.value = String(state[key]).replace('.', ','); },
        }), h('span', {}, 'saat')));
    fill(timeBox,
      h('div', { class: 'chips' }, TIMES.map(t => h('button', {
        type: 'button', class: 'chip' + (state.time === t.value ? ' on' : ''), 'aria-pressed': String(state.time === t.value),
        onclick: () => { state.time = t.value; if (t.min != null) { state.min = t.min; state.max = t.max; } persist(); renderTime(); },
      }, t.label))),
      custom && h('div', { class: 'two', style: 'margin-top:10px' }, num('En az', 'min'), num('En çok', 'max')),
      h('p', { class: 'muted small' }, 'Tek yön, kapıdan kapıya yaklaşık süre.'));
  }

  function renderCountries() {
    const codes = state.showAllCountries ? Object.keys(COUNTRY_NAMES) : [...new Set([...MAIN_COUNTRIES, ...state.countries])];
    const set = new Set(state.countries);
    fill(countryBox,
      h('div', { class: 'chips' },
        h('button', { type: 'button', class: 'chip' + (!set.size ? ' on' : ''), onclick: () => { state.countries = []; persist(); renderCountries(); } }, '🌍 Farketmez'),
        codes.map(cc => h('button', {
          type: 'button', class: 'chip' + (set.has(cc) ? ' on' : ''), 'aria-pressed': String(set.has(cc)),
          onclick: () => { set.has(cc) ? set.delete(cc) : set.add(cc); state.countries = [...set]; persist(); renderCountries(); },
        }, `${flag(cc)} ${COUNTRY_NAMES[cc]}`)),
        !state.showAllCountries && h('button', { type: 'button', class: 'chip', onclick: () => { state.showAllCountries = true; renderCountries(); } }, 'Diğer ülkeler…')));
  }

  async function run() {
    if (!state.origin) return toast('Önce nereden çıkacağını seç.');
    if (!state.kinds.length) return toast('En az bir yer türü seç.');
    if (state.max <= state.min) return toast('"En çok" süre "en az"dan büyük olmalı.');
    goBtn.disabled = true;
    results.replaceChildren(spinner('Hazırlanıyor…'));
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const r = await suggest({ origin: state.origin, minH: state.min, maxH: state.max, mode: state.mode, countries: state.countries, kinds: state.kinds },
        msg => results.replaceChildren(spinner(msg)));
      state.results = r.results;
      renderResults();
    } catch (e) {
      results.replaceChildren(h('p', { class: 'error' }, `Öneriler hazırlanamadı: ${e.message}`));
    } finally {
      goBtn.disabled = false;
    }
  }

  function card(p) {
    const hr = hoursOf(p);
    const icon = state.mode === 'tren' ? '🚆' : '🚗';
    return tappable({ class: 'place-card sug-card', onclick: () => detail(p) },
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, flag(p.cc)),
      h('div', { class: 'pc-main' },
        h('div', { class: 'pc-name' }, p.name),
        h('div', { class: 'pc-meta' },
          h('span', {}, `${KINDS[p.kind]?.emoji || ''} ${COUNTRY_NAMES[p.cc] || p.cc}`),
          h('span', { class: 'time' }, `${icon} ${p.real ? '' : '≈ '}${fmtDur(hr * 60)}`),
          p.roadKm ? h('span', {}, fmtKm(p.roadKm)) : null,
          p.transfers != null ? h('span', {}, p.transfers ? `${p.transfers} aktarma` : 'aktarmasız') : null),
        h('div', { class: 'pc-meta' },
          p.unesco && h('span', { class: 'badge star' }, 'UNESCO'),
          p.wv >= 3 && h('span', { class: 'badge' }, `${p.wv} dilde gezi rehberi`)),
        p.nearby?.length ? h('div', { class: 'muted small' }, `Yakınında: ${p.nearby.map(x => x.name).join(', ')}`) : null,
        state.len === 'gun' && state.min < 2.5 && hr > 2.5 ? h('div', { class: 'tl-warn' }, '⚠️ Günübirlik için uzun; bir gece kalmayı düşün') : null),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
  }

  function renderResults() {
    map?.remove(); map = null;
    const list = state.results || [];
    if (!list.length) {
      fill(results, h('div', { class: 'empty' },
        h('h2', {}, 'Bu aralıkta öneri bulamadım'),
        h('p', { class: 'muted' }, 'Süre aralığını genişletmeyi, ülke filtresini kaldırmayı ya da başka yer türleri seçmeyi dene.')));
      return;
    }
    let content;
    if (state.view === 'map') {
      content = h('div', { class: 'map' });
      setTimeout(() => {
        if (!content.isConnected) return;
        map = createMap(content, state.origin, 7);
        if (!map) return;
        const b = [[state.origin.lat, state.origin.lon]];
        L.marker(b[0], { icon: meIcon() }).addTo(map).bindPopup('Başlangıç');
        for (const p of list) {
          L.marker([p.lat, p.lon], { icon: emojiIcon(KINDS[p.kind]?.emoji || '📍') }).addTo(map)
            .bindPopup(popupFor(p, `${fmtDur(hoursOf(p) * 60)}`, () => detail(p)));
          b.push([p.lat, p.lon]);
        }
        map.fitBounds(b, { padding: [24, 24] });
      });
    } else {
      content = h('div', { class: 'cards' }, list.map(card));
    }
    fill(results,
      h('div', { class: 'results-head' },
        h('b', {}, `${list.length} öneri`),
        segmented([{ value: 'list', label: 'Liste' }, { value: 'map', label: 'Harita' }], state.view, v => { state.view = v; renderResults(); })),
      state.len === 'gun' && state.min >= 2.5 && h('div', { class: 'note warn' },
        `Tek yön ${state.min}+ saat, günübirlik için yorucu olur (gidiş-dönüş ${state.min * 2}+ saat yol). Bir gece kalmayı düşün; "Kaç gün?" kısmından "Hafta sonu"nu seçebilirsin.`),
      content,
      h('p', { class: 'muted small source' }, 'Sıralama: gezi rehberlerinde (Wikivoyage) kaç dilde maddesi olduğu, ne kadar bilindiği ve UNESCO mirası olup olmadığı. ',
        state.mode === 'tren' ? 'Tren süreleri İsviçre tarifesinden; "≈" olanlar tahmin.' : 'Araba süreleri trafiksiz; "≈" olanlar tahmin.'));
  }

  function detail(p) {
    const info = h('div', { class: 'wiki' }, h('p', { class: 'muted small' }, 'Bilgi yükleniyor…'));
    const hr = hoursOf(p);
    openSheet(h('div', { class: 'detail' },
      h('div', { class: 'detail-head' },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, flag(p.cc)),
        h('div', {}, h('h2', {}, p.name), h('div', { class: 'muted small' }, `${KINDS[p.kind]?.label} · ${COUNTRY_NAMES[p.cc] || p.cc}`))),
      info,
      h('ul', { class: 'facts' },
        h('li', {}, h('span', {}, state.mode === 'tren' ? '🚆' : '🚗'), h('span', {},
          `${p.real ? '' : 'Yaklaşık '}${fmtDur(hr * 60)}${p.roadKm ? ` · ${fmtKm(p.roadKm)}` : ` · kuş uçuşu ${Math.round(p.km)} km`}${p.station ? ` · ${p.station} istasyonuna` : ''}`)),
        p.nearby?.length ? h('li', {}, h('span', {}, '📍'), h('span', {}, `Yakınında: ${p.nearby.map(x => x.name).join(', ')}`)) : null,
        p.unesco ? h('li', {}, h('span', {}, '🏅'), h('span', {}, 'UNESCO Dünya Mirası')) : null),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: () => planHere(p) }, '🗺️ Buraya gezi planla'),
        h('button', { class: 'btn', onclick: () => exploreHere(p) }, '🧭 Çevresini keşfet'),
        linkBtn('📗 Gezi rehberi', `https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwikivoyage/${p.q}`))));
    wikiForTags({ wikidata: p.q }).then(w => {
      if (!info.isConnected) return;
      if (!w) { info.replaceChildren(); return; }
      fill(info, w.thumb && h('img', { src: w.thumb, alt: '', loading: 'lazy' }), h('p', {}, w.extract),
        h('a', { href: w.url, target: '_blank', rel: 'noopener', class: 'small' }, `Wikipedia'da devamı${w.lang !== 'tr' ? ' (İngilizce)' : ''} →`));
    }).catch(() => info.replaceChildren());
  }

  const asDest = p => ({
    name: p.name, label: `${p.name}, ${COUNTRY_NAMES[p.cc] || p.cc}`, detail: COUNTRY_NAMES[p.cc] || '',
    lat: p.lat, lon: p.lon, cc: p.cc.toLowerCase(), kind: p.kind === 's' ? 'city' : 'region', wikidata: p.q,
  });

  function planHere(p) {
    const d = new Date();
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7)); // en yakın cumartesi
    const start = toISODate(d);
    const end = new Date(d);
    end.setDate(end.getDate() + (state.len === 'hafta' ? 1 : state.len === 'uzun' ? 2 : 0));
    prefillPlan({ dest: asDest(p), startDate: start, endDate: toISODate(end), transport: state.mode === 'tren' ? 'toplu' : 'araba', radiusKm: p.kind === 'n' ? 40 : 15 });
    closeSheet();
    location.hash = '#/planla';
    toast('Plan formu dolduruldu; tarihleri ve kişileri kontrol et.');
  }

  function exploreHere(p) {
    setNearLocation({ ...asDest(p), gps: false });
    closeSheet();
    location.hash = '#/kesfet';
  }

  root.append(
    originBox,
    h('section', {}, h('h2', { class: 'h-sec' }, 'Ne kadar yol?'), timeBox),
    h('section', {}, h('h2', { class: 'h-sec' }, 'Nasıl gideceksin?'),
      segmented([{ value: 'araba', label: '🚗 Araba' }, { value: 'tren', label: '🚆 Tren' }], state.mode, v => { state.mode = v; persist(); })),
    h('section', {}, h('h2', { class: 'h-sec' }, 'Hangi ülke?'), countryBox),
    h('section', {}, h('h2', { class: 'h-sec' }, 'Ne tür bir yer?'),
      chips(Object.entries(KINDS).map(([value, k]) => ({ value, ...k })), state.kinds, v => { state.kinds = v; persist(); })),
    h('section', {}, h('h2', { class: 'h-sec' }, 'Kaç gün?'), segmented(LENGTHS, state.len, v => { state.len = v; persist(); if (state.results) renderResults(); })),
    goBtn,
    results,
  );
  renderOrigin(); renderTime(); renderCountries();
  if (state.results) renderResults();
  onLeave(() => { map?.remove(); map = null; });
}
