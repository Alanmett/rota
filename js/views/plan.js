// Planla: belirli bir yere, belirli tarihlerde gezi.

import { h, toast, segmented, chips, stepper, spinner, section, field, row } from '../ui.js';
import { CATS, SIGHT_CATS } from '../places.js';
import { PACES, TRANSPORTS } from '../planner.js';
import { LEVELS } from '../budget.js';
import { getSettings } from '../store.js';
import { generateTrip } from '../tripgen.js';
import { placeSearch } from '../components.js';
import { reverseGeocode, defaultRadiusFor } from '../api.js';
import { todayISO, dateRange } from '../util.js';

const SCOPES = [
  { value: 5, label: 'Merkez', sub: '5 km' },
  { value: 15, label: 'Şehir', sub: '15 km' },
  { value: 40, label: 'Çevresi', sub: '40 km' },
  { value: 80, label: 'Bölge', sub: '80 km' },
];

let form = null; // sekmeler arası geçişte doldurulan bilgiler kaybolmasın
const initForm = () => ({
  dest: null, startDate: todayISO(), endDate: todayISO(), adults: 2, children: 0, elderly: false, pet: false,
  transport: getSettings().transport, interests: ['tarihi', 'muze', 'dogal', 'manzara'], pace: 'normal', level: 'orta', radiusKm: 15,
});

export function renderPlan(root) {
  form ||= initForm();
  if (form.startDate < todayISO()) form.startDate = todayISO();
  if (form.endDate < form.startDate) form.endDate = form.startDate;

  const destBox = h('div');
  const scopeBox = h('div');
  const dur = h('p', { class: 'muted small' });
  const out = h('div', { 'aria-live': 'polite' });

  const renderScope = () => scopeBox.replaceChildren(segmented(SCOPES, form.radiusKm, v => { form.radiusKm = v; }));
  const pick = r => { form.dest = r; form.radiusKm = defaultRadiusFor(r.kind); renderDest(); renderScope(); };

  function renderDest() {
    if (form.dest) {
      destBox.replaceChildren(h('div', { class: 'picked' },
        h('span', { 'aria-hidden': 'true' }, '📍'),
        h('div', {}, h('b', {}, form.dest.name), h('div', { class: 'muted small' }, form.dest.detail || '')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Yeri değiştir', onclick: () => { form.dest = null; renderDest(); } }, '✕')));
    } else {
      destBox.replaceChildren(
        placeSearch({ placeholder: 'Şehir, ilçe, köy, bölge…', onPick: pick }),
        h('button', { class: 'btn small', type: 'button', onclick: useGps }, '◎ Bulunduğum yer'));
    }
  }

  function useGps() {
    if (!('geolocation' in navigator)) return toast('Bu cihaz konum özelliğini desteklemiyor.');
    toast('Konum alınıyor…');
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      let info = null;
      try { info = await reverseGeocode(lat, lon, 10); } catch { /* adsız devam */ }
      pick({ ...(info || {}), lat, lon, name: info?.name || 'Bulunduğun yer', label: info?.label || 'Bulunduğun yer', kind: info?.kind || 'town' });
    }, () => toast('Konum alınamadı; yeri yazarak arayabilirsin.'), { timeout: 15000, maximumAge: 300000 });
  }

  const updDur = () => {
    const n = dateRange(form.startDate, form.endDate).length;
    dur.textContent = n === 1 ? 'Günübirlik gezi' : `${n} gün, ${n - 1} gece`;
  };
  const end = h('input', {
    type: 'date', value: form.endDate, min: form.startDate,
    onchange: e => { form.endDate = e.target.value && e.target.value >= form.startDate ? e.target.value : form.startDate; e.target.value = form.endDate; updDur(); },
  });
  const start = h('input', {
    type: 'date', value: form.startDate, min: todayISO(),
    onchange: e => {
      form.startDate = e.target.value || todayISO();
      if (form.endDate < form.startDate) { form.endDate = form.startDate; end.value = form.endDate; }
      end.min = form.startDate; updDur();
    },
  });
  const check = (label, key) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: form[key], onchange: e => { form[key] = e.target.checked; } }), label);
  const submit = h('button', { class: 'btn primary wide', type: 'button', onclick: go }, 'Planı oluştur');

  root.append(
    section('Nereye?', destBox),
    section('Ne zaman?', h('div', { class: 'two' }, field('Gidiş', start), field('Dönüş', end)), dur),
    section('Kimlerle?',
      row('Yetişkin', stepper(form.adults, 1, 20, v => { form.adults = v; }, 'Yetişkin')),
      row('Çocuk', stepper(form.children, 0, 10, v => { form.children = v; }, 'Çocuk')),
      check('Yaşlı ya da hareket kısıtı olan biri var', 'elderly'),
      check('Evcil hayvan geliyor', 'pet')),
    section('Nasıl gezeceksin?', segmented(Object.entries(TRANSPORTS).map(([value, t]) => ({ value, label: t.label })), form.transport, v => { form.transport = v; })),
    section('Neler ilgini çeker?', chips(SIGHT_CATS.map(c => ({ value: c, ...CATS[c] })), form.interests, v => { form.interests = v; }),
      h('p', { class: 'muted small' }, 'Öğle ve akşam yemeği önerileri otomatik eklenir.')),
    section('Tempo', segmented(Object.entries(PACES).map(([value, p]) => ({ value, label: p.label, sub: p.sub })), form.pace, v => { form.pace = v; })),
    section('Bütçe seviyesi', segmented(Object.entries(LEVELS).map(([value, label]) => ({ value, label })), form.level, v => { form.level = v; })),
    section('Ne kadar geniş bir alan?', scopeBox, h('p', { class: 'muted small' }, 'Arabayla çevreyi gezeceksen geniş, şehir içinde kalacaksan dar alan seç.')),
    submit,
    out,
  );
  renderDest(); renderScope(); updDur();

  async function go() {
    if (!form.dest) { toast('Önce nereye gideceğini seç.'); return; }
    if (!form.interests.length) { toast('En az bir ilgi alanı seç.'); return; }
    const n = dateRange(form.startDate, form.endDate).length;
    if (n > 14) { toast('Şimdilik en fazla 14 günlük plan yapılabiliyor.'); return; }
    submit.disabled = true;
    out.replaceChildren(spinner('Başlıyor…'));
    out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
      const trip = await generateTrip({
        kind: 'plan', name: `${form.dest.name} ${n === 1 ? 'günübirlik' : 'gezisi'}`, dest: form.dest,
        startDate: form.startDate, endDate: form.endDate,
        travelers: { adults: form.adults, children: form.children, elderly: form.elderly, pet: form.pet },
        transport: form.transport, pace: form.pace, level: form.level, radiusKm: form.radiusKm, interests: form.interests,
      }, getSettings(), msg => out.replaceChildren(spinner(msg)));
      form = null;
      location.hash = `#/gezi/${trip.id}`;
    } catch (e) {
      out.replaceChildren(h('p', { class: 'error' }, e.message));
      submit.disabled = false;
    }
  }
}
