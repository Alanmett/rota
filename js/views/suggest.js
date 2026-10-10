// Öner: "Nereye gidelim?" Yol süresine, ulaşıma, ülkeye ve ilgiye göre gidilecek yer önerileri.

import { h, fill, toast, openSheet, closeSheet, segmented, chips, spinner, tappable, linkBtn, onLeave } from '../ui.js';
import { reverseGeocode, wikiForTags } from '../api.js';
import { suggest, KINDS, COUNTRY_NAMES, flag } from '../suggest.js';
import { flightsUrl } from '../flights.js';
import { getSettings, getPref, savePref } from '../store.js';
import { prefillPlan, addToRoute } from './plan.js';
import { mountToday } from '../today.js';
import { getPosition } from '../geo.js';
import { setNearLocation } from './near.js';
import { placeSearch } from '../components.js';
import { wikiMoreLabel } from '../details.js';
import { createMap, emojiIcon, meIcon, popupFor } from '../map.js';
import { fmtDur, fmtKm, toISODate } from '../util.js';
import { t, getLang } from '../i18n.js';

const TIMES = [
  { value: '0-1', label: t('1 saate kadar'), min: 0, max: 1 },
  { value: '1-2', label: t('{a}–{b} saat', { a: 1, b: 2 }), min: 1, max: 2 },
  { value: '2-3', label: t('{a}–{b} saat', { a: 2, b: 3 }), min: 2, max: 3 },
  { value: '3-4', label: t('{a}–{b} saat', { a: 3, b: 4 }), min: 3, max: 4 },
  { value: '4-6', label: t('{a}–{b} saat', { a: 4, b: 6 }), min: 4, max: 6 },
  { value: '6-10', label: t('{a}–{b} saat', { a: 6, b: 10 }), min: 6, max: 10 }, // uçakla uzak yerler için
  { value: 'ozel', label: t('Özel…') },
];
const MODE_ICON = { araba: '🚗', tren: '🚆', ucak: '✈️' };
const MAIN_COUNTRIES = ['CH', 'IT', 'FR', 'DE', 'AT', 'TR'];
const LENGTHS = [{ value: 'gun', label: t('Günübirlik') }, { value: 'hafta', label: t('Hafta sonu') }, { value: 'uzun', label: t('3+ gün') }];

const saved = getPref('suggest', {});
const state = {
  origin: saved.origin || null, time: saved.time || '2-3', min: saved.min ?? 2, max: saved.max ?? 3,
  mode: saved.mode || null, countries: saved.countries || [], kinds: saved.kinds || ['s', 'n'], len: saved.len || 'gun',
  showAllCountries: false, results: null, view: 'list',
  resultMode: null, noAirport: false, // sonuçların hangi ulaşımla hesaplandığı (sonradan seçim değişse de simge/açıklama doğru kalsın)
};
const persist = () => savePref('suggest', { origin: state.origin, time: state.time, min: state.min, max: state.max, mode: state.mode, countries: state.countries, kinds: state.kinds, len: state.len });

const hoursOf = p => p.hours ?? p.est;
const decimal = v => (getLang() === 'en' ? String(v) : String(v).replace('.', ','));

export function renderSuggest(root) {
  mountToday(root); // bir gezinin içindeysen önce bugünün durumu
  const settings = getSettings();
  if (!state.origin && settings.home) state.origin = { ...settings.home, src: 'home' };
  state.mode ||= settings.transport === 'araba' ? 'araba' : 'tren';

  const originBox = h('section', { class: 'card loc-card' });
  const timeBox = h('div');
  const countryBox = h('div');
  const results = h('div', { class: 'results' });
  const goBtn = h('button', { class: 'btn primary wide sticky-cta', onclick: run }, '✨ ' + t('Bana yer öner'));
  let map = null;

  function renderOrigin(searching = false) {
    fill(originBox,
      h('div', { class: 'loc-line' },
        h('span', { class: 'loc-pin', 'aria-hidden': 'true' }, state.origin?.src === 'home' ? '🏠' : '📍'),
        h('div', {},
          h('div', { class: 'muted small' }, t('Nereden çıkacaksın?')),
          h('div', { class: 'loc-name' }, state.origin ? state.origin.label : t('Başlangıç seçilmedi')))),
      h('div', { class: 'btn-row' },
        settings.home && h('button', { class: 'btn small', onclick: () => setOrigin({ ...settings.home, src: 'home' }) }, '🏠 ' + t('Ev')),
        h('button', { class: 'btn small', onclick: useGps }, '◎ ' + t('Konumum')),
        h('button', { class: 'btn small', onclick: () => renderOrigin(!searching) }, searching ? t('Vazgeç') : '🔎 ' + t('Başka yer'))),
      !settings.home && !searching && h('p', { class: 'muted small' }, t("İpucu: Ayarlar'dan ev konumunu eklersen hep oradan hesaplanır.")),
      searching && placeSearch({ placeholder: t('Şehir ya da semt'), autofocus: true, onPick: r => setOrigin({ lat: r.lat, lon: r.lon, label: r.label, src: 'search' }) }),
    );
  }
  function setOrigin(o) { state.origin = o; state.results = null; persist(); renderOrigin(); results.replaceChildren(); }
  async function useGps() {
    const pos = await getPosition();
    if (!pos) return;
    let info = null;
    try { info = await reverseGeocode(pos.lat, pos.lon, 12); } catch { /* adsız */ }
    setOrigin({ ...pos, label: info?.label || t('Bulunduğun yer'), src: 'gps' });
  }

  function renderTime() {
    const custom = state.time === 'ozel';
    const num = (label, key) => h('label', { class: 'field' }, h('span', {}, label),
      h('div', { class: 'input-suffix' },
        h('input', {
          type: 'text', inputmode: 'decimal', value: decimal(state[key]),
          onchange: e => { const v = parseFloat(e.target.value.replace(',', '.')); if (!Number.isNaN(v) && v >= 0 && v <= 24) { state[key] = v; persist(); } else e.target.value = decimal(state[key]); },
        }), h('span', {}, t('saat'))));
    fill(timeBox,
      h('div', { class: 'chips' }, TIMES.map(o => h('button', {
        type: 'button', class: 'chip' + (state.time === o.value ? ' on' : ''), 'aria-pressed': String(state.time === o.value),
        onclick: () => { state.time = o.value; if (o.min != null) { state.min = o.min; state.max = o.max; } persist(); renderTime(); },
      }, o.label))),
      custom && h('div', { class: 'two', style: 'margin-top:10px' }, num(t('En az'), 'min'), num(t('En çok'), 'max')),
      h('p', { class: 'muted small' }, t('Tek yön, kapıdan kapıya yaklaşık süre.')));
  }

  function renderCountries() {
    const codes = state.showAllCountries ? Object.keys(COUNTRY_NAMES) : [...new Set([...MAIN_COUNTRIES, ...state.countries])];
    const set = new Set(state.countries);
    fill(countryBox,
      h('div', { class: 'chips' },
        h('button', { type: 'button', class: 'chip' + (!set.size ? ' on' : ''), onclick: () => { state.countries = []; persist(); renderCountries(); } }, '🌍 ' + t('Farketmez')),
        codes.map(cc => h('button', {
          type: 'button', class: 'chip' + (set.has(cc) ? ' on' : ''), 'aria-pressed': String(set.has(cc)),
          onclick: () => { set.has(cc) ? set.delete(cc) : set.add(cc); state.countries = [...set]; persist(); renderCountries(); },
        }, `${flag(cc)} ${COUNTRY_NAMES[cc]}`)),
        !state.showAllCountries && h('button', { type: 'button', class: 'chip', onclick: () => { state.showAllCountries = true; renderCountries(); } }, t('Diğer ülkeler…'))));
  }

  async function run() {
    if (!state.origin) return toast(t('Önce nereden çıkacağını seç.'));
    if (!state.kinds.length) return toast(t('En az bir yer türü seç.'));
    if (state.max <= state.min) return toast(t('"En çok" süre "en az" süreden büyük olmalı.'));
    goBtn.disabled = true;
    results.replaceChildren(spinner(t('Hazırlanıyor…')));
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const r = await suggest({ origin: state.origin, minH: state.min, maxH: state.max, mode: state.mode, countries: state.countries, kinds: state.kinds },
        msg => results.replaceChildren(spinner(msg)));
      state.results = r.results;
      state.resultMode = state.mode;
      state.noAirport = !!r.noAirport;
      renderResults();
    } catch (e) {
      results.replaceChildren(h('p', { class: 'error' }, t('Öneriler hazırlanamadı: {e}', { e: e.message })));
    } finally {
      goBtn.disabled = false;
    }
  }

  const nearbyText = p => t('Yakınında: {x}', { x: p.nearby.map(x => x.name).join(', ') });

  const resultMode = () => state.resultMode || state.mode;

  function card(p) {
    const hr = hoursOf(p);
    const icon = MODE_ICON[resultMode()] || '🚗';
    return tappable({ class: 'place-card sug-card', onclick: () => detail(p) },
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, flag(p.cc)),
      h('div', { class: 'pc-main' },
        h('div', { class: 'pc-name' }, p.name),
        h('div', { class: 'pc-meta' },
          h('span', {}, `${KINDS[p.kind]?.emoji || ''} ${COUNTRY_NAMES[p.cc] || p.cc}`),
          h('span', { class: 'time' }, `${icon} ${p.real ? '' : '≈ '}${fmtDur(hr * 60)}`),
          p.roadKm ? h('span', {}, fmtKm(p.roadKm)) : null,
          p.flight ? h('span', {}, `${p.flight.from.iata} → ${p.flight.to.iata}`) : null,
          p.transfers != null ? h('span', {}, p.transfers ? t('{n} aktarma', { n: p.transfers }) : t('aktarmasız')) : null),
        h('div', { class: 'pc-meta' },
          p.unesco && h('span', { class: 'badge star' }, 'UNESCO'),
          p.wv >= 3 && h('span', { class: 'badge' }, t('{n} dilde gezi rehberi', { n: p.wv }))),
        p.nearby?.length ? h('div', { class: 'muted small' }, nearbyText(p)) : null,
        state.len === 'gun' && state.min < 2.5 && hr > 2.5 ? h('div', { class: 'tl-warn' }, '⚠️ ' + t('Günübirlik için uzun; bir gece kalmayı düşün')) : null),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
  }

  // Önerileri ekrandan kaldırır; seçimler (başlangıç, süre, ülkeler) yerinde kalır
  function clearResults() {
    map?.remove(); map = null;
    state.results = null;
    results.replaceChildren();
    goBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(t('Liste temizlendi'));
  }
  const clearBtn = () => h('div', { class: 'btn-row' },
    h('button', { class: 'btn small', type: 'button', onclick: clearResults }, '🗑️ ' + t('Listeyi temizle')));

  function renderResults() {
    map?.remove(); map = null;
    const list = state.results || [];
    if (!list.length) {
      fill(results, h('div', { class: 'empty' },
        h('h2', {}, t('Bu aralıkta öneri bulamadım')),
        h('p', { class: 'muted' }, state.noAirport
          ? t("Çıkış yerinin 160 km çevresinde verideki havalimanlarından hiçbiri yok (İsviçre ve komşuları, Türkiye ve Avrupa'nın büyük kısmı kapsanıyor). Başka bir çıkış yeri seçmeyi dene.")
          : t('Süre aralığını genişletmeyi, ülke filtresini kaldırmayı ya da başka yer türleri seçmeyi dene.')),
        resultMode() === 'ucak' && !state.noAirport && h('p', { class: 'muted' },
          t('Uçakla kapıdan kapıya yolculuk, havalimanı yolu ve bekleme dahil genelde 4 saatin altına inmez; daha uzun bir süre aralığı seç.')),
        clearBtn()));
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
        L.marker(b[0], { icon: meIcon() }).addTo(map).bindPopup(t('Başlangıç'));
        for (const p of list) {
          L.marker([p.lat, p.lon], { icon: emojiIcon(KINDS[p.kind]?.emoji || '📍') }).addTo(map)
            .bindPopup(popupFor(p, fmtDur(hoursOf(p) * 60), () => detail(p)));
          b.push([p.lat, p.lon]);
        }
        map.fitBounds(b, { padding: [24, 24] });
      });
    } else {
      content = h('div', { class: 'cards' }, list.map(card));
    }
    fill(results,
      h('div', { class: 'results-head' },
        h('b', {}, t('{n} öneri', { n: list.length })),
        segmented([{ value: 'list', label: t('Liste') }, { value: 'map', label: t('Harita') }], state.view, v => { state.view = v; renderResults(); })),
      clearBtn(),
      state.len === 'gun' && state.min >= 2.5 && h('div', { class: 'note warn' },
        t('Tek yön {a}+ saat, günübirlik için yorucu olur (gidiş-dönüş {b}+ saat yol). Bir gece kalmayı düşün; "Kaç gün?" kısmından "Hafta sonu"nu seçebilirsin.', { a: decimal(state.min), b: decimal(state.min * 2) })),
      content,
      h('p', { class: 'muted small source' }, t('Sıralama: gezi rehberlerinde (Wikivoyage) kaç dilde maddesi olduğu, ne kadar bilindiği ve UNESCO mirası olup olmadığı.') + ' ',
        { tren: t('Tren süreleri İsviçre tarifesinden; "≈" olanlar tahmin.'), araba: t('Araba süreleri trafiksiz; "≈" olanlar tahmin.'),
          ucak: t('Uçak süreleri tahmindir: havalimanına yol, giriş işlemleri, uçuş ve varıştan sonraki yol dahil. Direkt uçuş olup olmadığını uçuş sitesinden kontrol et.') }[resultMode()]));
  }

  function detail(p) {
    const info = h('div', { class: 'wiki' }, h('p', { class: 'muted small' }, t('Bilgi yükleniyor…')));
    const hr = hoursOf(p);
    const way = p.roadKm ? ` · ${fmtKm(p.roadKm)}` : ' · ' + t('kuş uçuşu {k} km', { k: Math.round(p.km) });
    openSheet(h('div', { class: 'detail' },
      h('div', { class: 'detail-head' },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, flag(p.cc)),
        h('div', {}, h('h2', {}, p.name), h('div', { class: 'muted small' }, `${KINDS[p.kind]?.label} · ${COUNTRY_NAMES[p.cc] || p.cc}`))),
      info,
      h('ul', { class: 'facts' },
        h('li', {}, h('span', {}, MODE_ICON[resultMode()] || '🚗'), h('span', {},
          (p.real ? '' : t('Yaklaşık') + ' ') + fmtDur(hr * 60) + way + (p.station ? ' · ' + t('varış: {s}', { s: p.station }) : ''))),
        p.flight ? h('li', {}, h('span', {}, '🛫'), h('span', {},
          t('{a} → {b} · uçuşun kendisi yaklaşık {f}', { a: `${p.flight.from.name} (${p.flight.from.iata})`, b: `${p.flight.to.name} (${p.flight.to.iata})`, f: fmtDur(p.flight.flight * 60) }))) : null,
        p.flight ? h('li', {}, h('span', {}, '⚠️'), h('span', {}, t('Direkt uçuş olup olmadığını ve fiyatı uçuş sitesinden kontrol et.'))) : null,
        p.nearby?.length ? h('li', {}, h('span', {}, '📍'), h('span', {}, nearbyText(p))) : null,
        p.unesco ? h('li', {}, h('span', {}, '🏅'), h('span', {}, t('UNESCO Dünya Mirası'))) : null),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: () => planHere(p) }, '🗺️ ' + t('Buraya gezi planla')),
        h('button', { class: 'btn', onclick: () => exploreHere(p) }, '🧭 ' + t('Çevresini keşfet')),
        h('button', { class: 'btn', onclick: () => routeHere(p) }, '➕ ' + t('Rotaya ekle')),
        p.flight && linkBtn('✈️ ' + t('Uçuşlara bak'), flightsUrl(p.flight.from, p.flight.to)),
        linkBtn('📗 ' + t('Gezi rehberi'), `https://www.wikidata.org/wiki/Special:GoToLinkedPage/${getLang()}wikivoyage/${p.q}`))));
    wikiForTags({ wikidata: p.q }).then(w => {
      if (!info.isConnected) return;
      if (!w) { info.replaceChildren(); return; }
      fill(info, w.thumb && h('img', { src: w.thumb, alt: '', loading: 'lazy' }), h('p', {}, w.extract),
        h('a', { href: w.url, target: '_blank', rel: 'noopener', class: 'small' }, wikiMoreLabel(w)));
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
    prefillPlan({ dest: asDest(p), startDate: start, endDate: toISODate(end), transport: resultMode() === 'araba' ? 'araba' : 'toplu', radiusKm: p.kind === 'n' ? 40 : 15 });
    closeSheet();
    location.hash = '#/planla';
    toast(t('Plan formu dolduruldu; tarihleri ve kişileri kontrol et.'));
  }

  // Birkaç öneriyi toplayıp tek rota yapmak için: yer Planla'daki rota listesine eklenir
  function routeHere(p) {
    const n = addToRoute(asDest(p));
    closeSheet();
    toast(n ? t('{p} rotaya eklendi ({n} durak). Rotayı Planla sekmesinde tamamla.', { p: p.name, n }) : t('Rotada yer kalmadı.'), 4000);
  }

  function exploreHere(p) {
    setNearLocation({ ...asDest(p), gps: false });
    closeSheet();
    location.hash = '#/kesfet';
  }

  // Sıra: nereden → kaç gün → ne kadar yol (gezinin süresi göze alınacak yolu belirler) → nasıl → nereye → ne tür
  root.append(
    originBox,
    h('section', {}, h('h2', { class: 'h-sec' }, t('Kaç gün?')), segmented(LENGTHS, state.len, v => { state.len = v; persist(); if (state.results) renderResults(); })),
    h('section', {}, h('h2', { class: 'h-sec' }, t('Ne kadar yol?')), timeBox),
    h('section', {}, h('h2', { class: 'h-sec' }, t('Nasıl gideceksin?')),
      segmented([{ value: 'araba', label: '🚗 ' + t('Araba') }, { value: 'tren', label: '🚆 ' + t('Tren') }, { value: 'ucak', label: '✈️ ' + t('Uçak') }],
        state.mode, v => { state.mode = v; persist(); })),
    h('section', {}, h('h2', { class: 'h-sec' }, t('Hangi ülke?')), countryBox),
    h('section', {}, h('h2', { class: 'h-sec' }, t('Ne tür bir yer?')),
      chips(Object.entries(KINDS).map(([value, k]) => ({ value, ...k })), state.kinds, v => { state.kinds = v; persist(); })),
    goBtn,
    results,
  );
  renderOrigin(); renderTime(); renderCountries();
  if (state.results) renderResults();
  onLeave(() => { map?.remove(); map = null; });
}
