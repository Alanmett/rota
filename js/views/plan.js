// Planla: tek bir yere belirli tarihlerde gezi, ya da birkaç şehirden geçen rota.
// Rota modunda şehirler haritaya dokunarak ya da aranarak işaretlenir; uygulama en kısa sırayı ve gerçek yolu
// bulur, geceleri dağıtır ve her şehir için Planla'daki tüm kurallarla gün gün plan çıkarır.

import { h, fill, toast, segmented, chips, stepper, spinner, section, row, dateField, onLeave } from '../ui.js';
import { CATS, SIGHT_CATS } from '../places.js';
import { PACES, TRANSPORTS } from '../planner.js';
import { FOODS, STAYS } from '../budget.js';
import { getSettings } from '../store.js';
import { generateTrip } from '../tripgen.js';
import { generateRoute, MAX_ROUTE_DAYS, MAX_ROUTE_STOPS } from '../route.js';
import { placeSearch } from '../components.js';
import { createMap, numIcon, meIcon } from '../map.js';
import { reverseGeocode, geocode, defaultRadiusFor } from '../api.js';
import { aiReady, aiParseTrip } from '../ai.js';
import { todayISO, dateRange, parseISODate, toISODate, fmtDMY } from '../util.js';
import { t } from '../i18n.js';

const SCOPES = [
  { value: 5, label: t('Merkez'), sub: '5 km' },
  { value: 15, label: t('Şehir'), sub: '15 km' },
  { value: 40, label: t('Çevresi'), sub: '40 km' },
  { value: 80, label: t('Bölge'), sub: '80 km' },
];

let form = null; // sekmeler arası geçişte doldurulan bilgiler kaybolmasın
const initForm = () => {
  const s = getSettings();
  return {
    mode: 'tek',
    dest: null, startDate: todayISO(), endDate: todayISO(), adults: 2, children: 0, elderly: false, pet: false,
    transport: s.transport, interests: ['tarihi', 'muze', 'dogal', 'manzara'], pace: 'normal', level: 'ekonomik', radiusKm: 15, stay: 'ekonomik',
    hidden: false,
    route: { start: s.home ? 'home' : 'none', startPlace: null, back: true, cities: [], optimize: true },
  };
};

// Öner ekranından gelen yerle formu önceden doldurur.
export function prefillPlan(values) { form = { ...initForm(), ...values }; }

const routeCity = r => ({
  name: r.name, label: r.label || r.name, lat: r.lat, lon: r.lon, cc: r.cc || '', kind: r.kind || 'town',
  wikidata: r.wikidata || null, wikipedia: r.wikipedia || null, nights: r.kind === 'city' ? 2 : 1,
});

// Öner ekranından "Rotaya ekle": durak sayısını döndürür (sığmadıysa 0)
export function addToRoute(place) {
  form ||= initForm();
  form.mode = 'rota';
  if (form.route.cities.length >= MAX_ROUTE_STOPS) return 0;
  form.route.cities.push(routeCity(place));
  return form.route.cities.length;
}

export function renderPlan(root) {
  form ||= initForm();
  if (form.startDate < todayISO()) form.startDate = todayISO();
  if (form.endDate < form.startDate) form.endDate = form.startDate;
  let cleanup = null;
  const rerender = () => { cleanup?.(); root.replaceChildren(); renderPlan(root); window.scrollTo(0, 0); };
  root.append(aiAskCard(rerender));
  if (form.aiNote) root.append(aiNoteCard());
  root.append(h('section', { class: 'form-sec' },
    segmented([{ value: 'tek', label: t('Tek yer') }, { value: 'rota', label: t('Birkaç yer (rota)') }], form.mode, v => { form.mode = v; rerender(); }),
    h('p', { class: 'muted small' }, form.mode === 'rota'
      ? t('Görmek istediğin şehirleri haritada işaretle; sırayı, yolu ve her şehirde ne göreceğini ben planlayayım.')
      : t('Tek bir şehir ya da bölgede, belirli günlerde gezi.'))));
  cleanup = form.mode === 'rota' ? renderRouteForm(root) : renderSingleForm(root);
}

// ---- YZ: anlat, formu doldursun ----
// YZ isteği yapılandırır; yerler haritada aranır (gerçek koordinatlar), form doldurulur ve kullanıcı kontrol edip planı oluşturur.
// Sohbet gibi: Enter gönderir ve kutu temizlenir; gönderilenler üstte görünür, sonraki mesajlar öncekilere eklenir.
function aiAskCard(rerender) {
  form.aiHistory ||= [];
  const history = form.aiHistory;
  const box = h('textarea', {
    class: 'ai-text', rows: '3', maxlength: '1200', value: form.aiText || '', enterkeyhint: 'send', 'aria-label': t('Gezini anlat'),
    placeholder: history.length
      ? t('Eklemek ya da değiştirmek istediğin bir şey var mı? (ör. "bir de çocuğumuz var", "3 değil 4 gün olsun")')
      : t('Örn: "Ekim sonunda eşimle 3 gün Kapadokya, ekonomik otel, şaraphaneler ve az bilinen yerler" ya da "Evden çıkıp 6 günde Bursa, Konya ve Kapadokya, sonra eve dönüş"'),
    oninput: e => { form.aiText = e.target.value; },
    // Enter: gönder · Shift+Enter: yeni satır (yazı birleştirilirken basılan Enter sayılmaz)
    onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); go(); } },
  });
  const out = h('div', { 'aria-live': 'polite' });
  const btn = h('button', { class: 'btn primary', type: 'button', onclick: go }, '✨ ' + (history.length ? t('Gönder') : t('YZ formu doldursun')));
  const reset = () => { form.aiHistory = []; form.aiText = ''; form.aiNote = null; rerender(); };
  return h('section', { class: 'card ai-ask' },
    h('h2', { class: 'h-sec' }, '✨ ' + t('Anlat, ben planlayayım')),
    history.length > 0 && h('div', { class: 'ai-thread' }, history.map(m => h('p', { class: 'ai-msg' }, m))),
    box,
    aiReady() ? h('div', { class: 'btn-row' }, btn,
      history.length > 0 && h('button', { class: 'btn small', type: 'button', onclick: reset }, '🗑️ ' + t('Yeni istek')))
      : h('p', { class: 'muted small' }, t('Bu özellik için Ayarlar > Yapay zekâ bölümünde erişim kodunu gir.'), ' ', h('a', { href: '#/ayarlar' }, t('Ayarlar') + ' →')),
    aiReady() && h('p', { class: 'muted small' }, t('Enter ile gönder · Shift+Enter yeni satır')),
    out);

  async function go() {
    if (btn.disabled || !aiReady()) return;
    const text = box.value.trim();
    if (text.length < 3) { toast(t('Önce gezini birkaç kelimeyle anlat.')); return; }
    btn.disabled = true;
    out.replaceChildren(spinner(t('YZ isteğini anlıyor…')));
    try {
      const r = await aiParseTrip(text, history);
      out.replaceChildren(spinner(t('Yerler haritada bulunuyor…')));
      const found = [], missing = [];
      for (const p of (r.places || []).slice(0, MAX_ROUTE_STOPS)) {
        try {
          const g = (await geocode(p.name, (p.country || '').toLowerCase()))[0];
          if (g) found.push({ ...g, nights: Number.isInteger(p.nights) ? p.nights : null }); else missing.push(p.name);
        } catch { missing.push(p.name); }
      }
      if (!found.length) throw new Error(t('Bahsettiğin yerleri haritada bulamadım; yer adlarını açıkça yazıp tekrar dene.'));
      applyAi(r, found);
      form.aiNote = { summary: r.summary || '', unclear: r.unclear || '', missing };
      // Başarılı: mesaj sohbete eklenir, kutu temizlenir (hata olursa yazılan kutuda kalır)
      history.push(text);
      form.aiText = '';
      rerender();
      // Bilgisayarda kutu yazmaya hazır kalsın; telefonda klavye açılıp YZ'nin özetini örtmesin
      if (matchMedia('(pointer: fine)').matches) setTimeout(() => document.querySelector('.ai-text')?.focus({ preventScroll: true }), 0);
    } catch (e) {
      out.replaceChildren(h('p', { class: 'error' }, e.message));
      btn.disabled = false;
    }
  }
}

function applyAi(r, places) {
  const s = getSettings();
  const pick = (v, ok) => (ok.includes(v) ? v : undefined);
  const set = (k, v) => { if (v !== undefined && v !== null) form[k] = v; };
  set('adults', Number.isInteger(r.adults) ? Math.max(1, Math.min(20, r.adults)) : undefined);
  set('children', Number.isInteger(r.children) ? Math.max(0, Math.min(10, r.children)) : undefined);
  set('elderly', typeof r.elderly === 'boolean' ? r.elderly : undefined);
  set('pet', typeof r.pet === 'boolean' ? r.pet : undefined);
  set('transport', pick(r.transport, Object.keys(TRANSPORTS)));
  set('pace', pick(r.pace, Object.keys(PACES)));
  set('level', pick(r.food, Object.keys(FOODS)));
  set('stay', pick(r.stay, Object.keys(STAYS)));
  set('hidden', typeof r.hidden === 'boolean' ? r.hidden : undefined);
  const interests = (r.interests || []).filter(c => SIGHT_CATS.includes(c));
  if (interests.length) form.interests = interests;
  if (/^\d{4}-\d{2}-\d{2}$/.test(r.startDate || '') && r.startDate >= todayISO()) form.startDate = r.startDate;

  const rota = (r.mode === 'rota' && (places.length > 1 || r.startHome)) || places.length > 1;
  if (rota) {
    form.mode = 'rota';
    form.route.cities = places.map(p => ({ ...routeCity(p), ...(p.nights != null ? { nights: p.nights } : {}) }));
    if (r.startHome && s.home) form.route.start = 'home';
    if (typeof r.back === 'boolean') form.route.back = r.back;
    form.route.optimize = true;
    if (form.transport === 'yuruyus') form.transport = 'araba';
  } else {
    form.mode = 'tek';
    form.dest = places[0];
    form.radiusKm = defaultRadiusFor(places[0].kind);
    const days = Number.isInteger(r.days) ? Math.max(1, Math.min(14, r.days)) : 1;
    const end = parseISODate(form.startDate); end.setDate(end.getDate() + days - 1);
    form.endDate = toISODate(end);
  }
}

function aiNoteCard() {
  const n = form.aiNote;
  return h('section', { class: 'note ai-note' },
    h('b', {}, '✨ ' + t('YZ şöyle anladı:')), ' ', n.summary,
    n.unclear && h('p', { class: 'small' }, '❔ ' + n.unclear),
    n.missing?.length > 0 && h('p', { class: 'small' }, '⚠️ ' + t('Haritada bulunamayan yerler: {x}', { x: n.missing.join(', ') })),
    h('p', { class: 'small' }, t('Aşağıdaki formu kontrol et, istersen değiştir; sonra en alttaki düğmeyle planı oluştur.')),
    h('button', { class: 'link-btn', type: 'button', onclick: e => { form.aiNote = null; e.target.closest('.ai-note').remove(); } }, t('Kapat')));
}

// ---- Ortak bölümler ----
function commonSections({ route }) {
  const check = (label, key) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: form[key], onchange: e => { form[key] = e.target.checked; } }), label);
  const transports = Object.entries(TRANSPORTS).filter(([k]) => !route || k !== 'yuruyus');
  if (route && form.transport === 'yuruyus') form.transport = 'araba';
  const foodBox = h('div');
  const renderFood = () => foodBox.replaceChildren(h('div', { class: 'chips' }, Object.entries(FOODS).map(([k, x]) => h('button', {
    type: 'button', class: 'chip' + (form.level === k ? ' on' : ''), 'aria-pressed': String(form.level === k),
    onclick: () => { form.level = k; renderFood(); },
  }, x.label))));
  renderFood();
  return {
    who: section(t('Kimlerle?'),
      row(t('Yetişkin'), stepper(form.adults, 1, 20, v => { form.adults = v; }, t('Yetişkin'))),
      row(t('Çocuk'), stepper(form.children, 0, 10, v => { form.children = v; }, t('Çocuk'))),
      check(t('Yaşlı ya da hareket kısıtı olan biri var'), 'elderly'),
      check(t('Evcil hayvan geliyor'), 'pet')),
    how: section(t('Nasıl gezeceksin?'), segmented(transports.map(([value, x]) => ({ value, label: x.label })), form.transport, v => { form.transport = v; })),
    what: section(t('Neler ilgini çeker?'), chips(SIGHT_CATS.map(c => ({ value: c, ...CATS[c] })), form.interests, v => { form.interests = v; }),
      h('p', { class: 'muted small' }, t('Öğle ve akşam yemeği önerileri otomatik eklenir. Alışverişi seçersen her güne bir alışveriş durağı (outlet, AVM, çarşı ya da pazar) eklenir.')),
      segmented([{ value: false, label: '⭐ ' + t('Öne çıkanlar') }, { value: true, label: '🔎 ' + t('Az bilinenler') }], form.hidden, v => { form.hidden = v; }),
      h('p', { class: 'muted small' }, t('"Az bilinenler" kalabalık turistik yerler yerine gözden kaçan, sakin yerleri öne çıkarır.'))),
    pace: section(t('Tempo'), segmented(Object.entries(PACES).map(([value, p]) => ({ value, label: p.label, sub: p.sub })), form.pace, v => { form.pace = v; })),
    stayChips,
    food: section(t('Yemekler nasıl olsun?'), foodBox),
  };
}

function stayChips() {
  const wrap = h('div', { class: 'chips' });
  const render = () => wrap.replaceChildren(...Object.entries(STAYS).map(([k, s]) => h('button', {
    type: 'button', class: 'chip' + (form.stay === k ? ' on' : ''), 'aria-pressed': String(form.stay === k),
    onclick: () => { form.stay = k; render(); },
  }, s.label)));
  render();
  return wrap;
}

const travelers = () => ({ adults: form.adults, children: form.children, elderly: form.elderly, pet: form.pet });

// ---- Tek yer ----
function renderSingleForm(root) {
  const destBox = h('div');
  const scopeBox = h('div');
  const dur = h('p', { class: 'muted small' });
  const staySec = h('div');
  const out = h('div', { 'aria-live': 'polite' });
  const c = commonSections({ route: false });

  const renderScope = () => scopeBox.replaceChildren(segmented(SCOPES, form.radiusKm, v => { form.radiusKm = v; }));
  const pick = r => { form.dest = r; form.radiusKm = defaultRadiusFor(r.kind); renderDest(); renderScope(); };

  function renderDest() {
    if (form.dest) {
      destBox.replaceChildren(h('div', { class: 'picked' },
        h('span', { 'aria-hidden': 'true' }, '📍'),
        h('div', {}, h('b', {}, form.dest.name), h('div', { class: 'muted small' }, form.dest.detail || '')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Yeri değiştir'), onclick: () => { form.dest = null; renderDest(); } }, '✕')));
    } else {
      destBox.replaceChildren(
        placeSearch({ placeholder: t('Şehir, ilçe, köy, bölge…'), onPick: pick }),
        h('button', { class: 'btn small', type: 'button', onclick: () => locate(pick) }, '◎ ' + t('Bulunduğum yer')));
    }
  }

  const updDur = () => {
    const n = dateRange(form.startDate, form.endDate).length;
    dur.textContent = n === 1 ? t('Günübirlik gezi') : t('{d} gün, {n} gece', { d: n, n: n - 1 });
    staySec.hidden = n === 1;
  };
  const end = dateField(form.endDate, {
    min: form.startDate, label: t('Dönüş'),
    onChange: v => { form.endDate = v && v >= form.startDate ? v : form.startDate; end.set(form.endDate); updDur(); },
  });
  const start = dateField(form.startDate, {
    min: todayISO(), label: t('Gidiş'),
    onChange: v => {
      form.startDate = v || todayISO();
      start.set(form.startDate);
      if (form.endDate < form.startDate) { form.endDate = form.startDate; end.set(form.endDate); }
      end.input.min = form.startDate; updDur();
    },
  });
  const submit = h('button', { class: 'btn primary wide sticky-cta', type: 'button', onclick: go }, t('Planı oluştur'));
  staySec.append(section(t('Nerede kalacaksın?'), c.stayChips()));

  root.append(
    section(t('Nereye?'), destBox),
    section(t('Ne zaman?'), h('div', { class: 'two' },
      h('div', { class: 'field' }, h('span', {}, t('Gidiş')), start),
      h('div', { class: 'field' }, h('span', {}, t('Dönüş')), end)), dur),
    c.who, c.how, c.what, c.pace, staySec, c.food,
    section(t('Ne kadar geniş bir alan?'), scopeBox, h('p', { class: 'muted small' }, t('Arabayla çevreyi gezeceksen geniş, şehir içinde kalacaksan dar alan seç.'))),
    submit,
    out,
  );
  renderDest(); renderScope(); updDur();

  async function go() {
    if (!form.dest) { toast(t('Önce nereye gideceğini seç.')); return; }
    if (!form.interests.length) { toast(t('En az bir ilgi alanı seç.')); return; }
    const n = dateRange(form.startDate, form.endDate).length;
    if (n > 14) { toast(t('Şimdilik en fazla 14 günlük plan yapılabiliyor.')); return; }
    submit.disabled = true;
    out.replaceChildren(spinner(t('Başlıyor…')));
    out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
      const trip = await generateTrip({
        kind: 'plan', name: n === 1 ? t('{p} günübirlik', { p: form.dest.name }) : t('{p} gezisi', { p: form.dest.name }), dest: form.dest,
        startDate: form.startDate, endDate: form.endDate, travelers: travelers(),
        transport: form.transport, pace: form.pace, level: form.level, stay: form.stay, radiusKm: form.radiusKm, interests: form.interests, hidden: form.hidden,
      }, getSettings(), msg => out.replaceChildren(spinner(msg)));
      form = null;
      location.hash = `#/gezi/${trip.id}`;
    } catch (e) {
      out.replaceChildren(h('p', { class: 'error' }, e.message));
      submit.disabled = false;
    }
  }
  return null;
}

function locate(onPick) {
  if (!('geolocation' in navigator)) return toast(t('Bu cihaz konum özelliğini desteklemiyor.'));
  toast(t('Konum alınıyor…'));
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: lat, longitude: lon } = pos.coords;
    let info = null;
    try { info = await reverseGeocode(lat, lon, 10); } catch { /* adsız devam */ }
    onPick({ ...(info || {}), lat, lon, name: info?.name || t('Bulunduğun yer'), label: info?.label || t('Bulunduğun yer'), kind: info?.kind || 'town' });
  }, () => toast(t('Konum alınamadı; yeri yazarak arayabilirsin.')), { timeout: 15000, maximumAge: 300000 });
}

// ---- Rota ----
function renderRouteForm(root) {
  const R = form.route;
  const settings = getSettings();
  const c = commonSections({ route: true });
  const startBox = h('div');
  const list = h('div', { class: 'rt-edit' });
  const mapEl = h('div', { class: 'map route-map' });
  const dur = h('p', { class: 'muted small' });
  const staySec = h('div');
  const out = h('div', { 'aria-live': 'polite' });
  let map = null, layer = null;

  const startPoint = () => {
    if (R.start === 'home' && settings.home) return { name: t('Ev'), lat: settings.home.lat, lon: settings.home.lon, cc: settings.homeCountry, home: true };
    if ((R.start === 'gps' || R.start === 'place') && R.startPlace) return R.startPlace;
    return null;
  };

  function renderStart() {
    const opt = (value, label) => h('button', {
      type: 'button', class: 'chip' + (R.start === value ? ' on' : ''), 'aria-pressed': String(R.start === value),
      onclick: () => {
        if (value === 'gps') { locate(p => { R.start = 'gps'; R.startPlace = { name: p.name, lat: p.lat, lon: p.lon, cc: p.cc || '' }; renderStart(); draw(); }); return; }
        R.start = value; if (value !== 'place') R.startPlace = null; renderStart(); draw();
      },
    }, label);
    const sp = startPoint();
    fill(startBox,
      h('div', { class: 'chips' },
        settings.home && opt('home', '🏠 ' + t('Evden')),
        opt('gps', '◎ ' + t('Bulunduğum yer')),
        opt('place', '🔎 ' + t('Başka yer')),
        opt('none', t('İlk duraktan'))),
      R.start === 'place' && !R.startPlace && placeSearch({ placeholder: t('Başlangıç yeri'), onPick: r => { R.startPlace = { name: r.name, lat: r.lat, lon: r.lon, cc: r.cc }; renderStart(); draw(); } }),
      sp && h('p', { class: 'muted small' }, '🏁 ' + (sp.home ? settings.home.label : sp.name)),
      sp && h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: R.back, onchange: e => { R.back = e.target.checked; draw(); } }), t('Sonunda başladığım yere dön')),
      !settings.home && h('p', { class: 'muted small' }, t("Ayarlar'dan ev konumunu girersen rotaya evden başlayabilirsin.")));
  }

  // fromMap: haritaya dokunarak eklendiyse görünüm değişmesin (art arda işaretlemek kolay olsun)
  const addCity = (r, fromMap = false) => {
    if (R.cities.length >= MAX_ROUTE_STOPS) { toast(t('En fazla {n} durak eklenebilir.', { n: MAX_ROUTE_STOPS })); return; }
    R.cities.push(routeCity(r));
    toast(t('{p} rotaya eklendi', { p: r.name }));
    renderList(); draw(!fromMap);
  };

  function renderList() {
    const move = (i, j) => { [R.cities[i], R.cities[j]] = [R.cities[j], R.cities[i]]; renderList(); draw(); };
    const nightText = n => (n ? t('gece') : t('yol üstü uğrama'));
    list.replaceChildren(...R.cities.map((city, i) => {
      const label = h('span', { class: 'muted small' }, nightText(city.nights));
      return h('div', { class: 'rt-item' },
        h('div', { class: 'rt-item-head' },
          h('span', { class: 'rt-dot' }, String(i + 1)),
          h('b', { class: 'rt-name' }, city.name),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('{p}: rotadan çıkar', { p: city.name }), onclick: () => { R.cities.splice(i, 1); renderList(); draw(); } }, '✕')),
        h('div', { class: 'rt-item-ctl' },
          stepper(city.nights, 0, 14, v => { city.nights = v; label.textContent = nightText(v); updDur(); }, t('{p}: gece', { p: city.name })),
          label,
          h('span', { class: 'rt-arrows' },
            i > 0 && h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Önce git'), onclick: () => move(i, i - 1) }, '↑'),
            i < R.cities.length - 1 && h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Sonra git'), onclick: () => move(i, i + 1) }, '↓'))));
    }));
    updDur();
  }

  function draw(fit = true) {
    if (!map) return;
    layer.clearLayers();
    const sp = startPoint();
    const pts = [sp, ...R.cities, sp && R.back ? sp : null].filter(Boolean);
    if (pts.length > 1) L.polyline(pts.map(p => [p.lat, p.lon]), { color: '#0f766e', weight: 3, opacity: 0.7, dashArray: '6 8' }).addTo(layer);
    if (sp) L.marker([sp.lat, sp.lon], { icon: meIcon() }).addTo(layer);
    R.cities.forEach((p, i) => L.marker([p.lat, p.lon], { icon: numIcon(i + 1, '#0f766e') }).addTo(layer));
    const b = pts.map(p => [p.lat, p.lon]);
    if (!fit) return;
    if (b.length > 1) map.fitBounds(b, { padding: [30, 30], maxZoom: 9 });
    else if (b.length === 1) map.setView(b[0], 8);
  }

  const totalDays = () => R.cities.reduce((s, x) => s + (x.nights || 0), 0) + 1;
  const updDur = () => {
    const n = totalDays(), nights = n - 1;
    const end = parseISODate(form.startDate); end.setDate(end.getDate() + n - 1);
    dur.textContent = (n === 1 ? t('Günübirlik gezi') : t('{d} gün, {n} gece', { d: n, n: nights })) + ` · ${t('Dönüş')}: ${fmtDMY(toISODate(end))}`;
    staySec.hidden = nights === 0;
  };
  const start = dateField(form.startDate, { min: todayISO(), label: t('Gidiş'), onChange: v => { form.startDate = v || todayISO(); start.set(form.startDate); updDur(); } });
  const submit = h('button', { class: 'btn primary wide sticky-cta', type: 'button', onclick: go }, '🗺️ ' + t('Rotayı oluştur'));
  staySec.append(section(t('Nerede kalacaksın?'), c.stayChips()));

  root.append(
    section(t('Nereden başlıyorsun?'), startBox),
    section(t('Hangi yerleri görmek istiyorsun?'),
      mapEl,
      h('p', { class: 'muted small' }, t('Haritaya dokunarak ya da aşağıdan arayarak şehir ekle. Her şehre kaç gece kalacağını yaz; 0 gece verdiğin yerlere yol üstünde birkaç saat uğranır.')),
      placeSearch({ placeholder: t('Şehir ya da kasaba ekle…'), onPick: addCity }),
      list,
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: R.optimize, onchange: e => { R.optimize = e.target.checked; } }), t('Sırayı en kısa yola göre düzenle'))),
    section(t('Ne zaman yola çıkıyorsun?'), h('div', { class: 'field' }, h('span', {}, t('Gidiş')), start), dur),
    c.who, c.how, c.what, c.pace, staySec, c.food,
    submit,
    out,
  );
  renderStart(); renderList();

  setTimeout(() => {
    if (!mapEl.isConnected) return;
    const sp = startPoint();
    map = createMap(mapEl, sp || R.cities[0] || { lat: 46.8, lon: 8.2 }, sp || R.cities[0] ? 7 : 5);
    if (!map) return;
    layer = L.layerGroup().addTo(map);
    // Haritaya dokunulan yerin şehri/kasabası rotaya eklenir
    map.on('click', async e => {
      toast(t('Yer bulunuyor…'));
      try {
        const info = await reverseGeocode(e.latlng.lat, e.latlng.lng, 10);
        if (!info?.name) { toast(t('Burada bir yerleşim bulunamadı; biraz daha yakınlaştırıp tekrar dene.')); return; }
        addCity(info, true);
      } catch { toast(t('Yer bulunamadı. İnternet bağlantını kontrol et.')); }
    });
    draw();
  });
  const cleanup = () => { map?.remove(); map = null; };
  onLeave(cleanup);

  async function go() {
    const sp = startPoint();
    if (!R.cities.length || (!sp && R.cities.length < 2)) { toast(t('Rota için en az iki yer gerekli (başlangıç ve bir durak ya da iki durak).')); return; }
    if (!form.interests.length) { toast(t('En az bir ilgi alanı seç.')); return; }
    if (totalDays() > MAX_ROUTE_DAYS) { toast(t('Rota en fazla {n} gün olabilir; gece sayılarını azalt.', { n: MAX_ROUTE_DAYS })); return; }
    submit.disabled = true;
    out.replaceChildren(spinner(t('Başlıyor…')));
    out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
      const trip = await generateRoute({
        startDate: form.startDate, start: sp, back: R.back, cities: R.cities, optimize: R.optimize,
        travelers: travelers(), transport: form.transport, pace: form.pace, level: form.level, stay: form.stay,
        interests: form.interests, hidden: form.hidden,
      }, settings, msg => out.replaceChildren(spinner(msg)));
      form = null;
      location.hash = `#/gezi/${trip.id}`;
    } catch (e) {
      out.replaceChildren(h('p', { class: 'error' }, e.message));
      submit.disabled = false;
    }
  }
  return cleanup;
}
