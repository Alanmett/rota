// Planla: belirli bir yere, belirli tarihlerde gezi.

import { h, toast, segmented, chips, stepper, spinner, section, row, dateField } from '../ui.js';
import { CATS, SIGHT_CATS } from '../places.js';
import { PACES, TRANSPORTS } from '../planner.js';
import { FOODS, STAYS } from '../budget.js';
import { getSettings } from '../store.js';
import { generateTrip } from '../tripgen.js';
import { placeSearch } from '../components.js';
import { reverseGeocode, defaultRadiusFor } from '../api.js';
import { todayISO, dateRange } from '../util.js';
import { t } from '../i18n.js';

const SCOPES = [
  { value: 5, label: t('Merkez'), sub: '5 km' },
  { value: 15, label: t('Şehir'), sub: '15 km' },
  { value: 40, label: t('Çevresi'), sub: '40 km' },
  { value: 80, label: t('Bölge'), sub: '80 km' },
];

let form = null; // sekmeler arası geçişte doldurulan bilgiler kaybolmasın
const initForm = () => ({
  dest: null, startDate: todayISO(), endDate: todayISO(), adults: 2, children: 0, elderly: false, pet: false,
  transport: getSettings().transport, interests: ['tarihi', 'muze', 'dogal', 'manzara'], pace: 'normal', level: 'ekonomik', radiusKm: 15, stay: 'ekonomik',
});

// Öner ekranından gelen yerle formu önceden doldurur.
export function prefillPlan(values) { form = { ...initForm(), ...values }; }

export function renderPlan(root) {
  form ||= initForm();
  if (form.startDate < todayISO()) form.startDate = todayISO();
  if (form.endDate < form.startDate) form.endDate = form.startDate;

  const destBox = h('div');
  const scopeBox = h('div');
  const dur = h('p', { class: 'muted small' });
  const staySec = h('div');
  const foodBox = h('div');
  const out = h('div', { 'aria-live': 'polite' });

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
        h('button', { class: 'btn small', type: 'button', onclick: useGps }, '◎ ' + t('Bulunduğum yer')));
    }
  }

  function useGps() {
    if (!('geolocation' in navigator)) return toast(t('Bu cihaz konum özelliğini desteklemiyor.'));
    toast(t('Konum alınıyor…'));
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      let info = null;
      try { info = await reverseGeocode(lat, lon, 10); } catch { /* adsız devam */ }
      pick({ ...(info || {}), lat, lon, name: info?.name || t('Bulunduğun yer'), label: info?.label || t('Bulunduğun yer'), kind: info?.kind || 'town' });
    }, () => toast(t('Konum alınamadı; yeri yazarak arayabilirsin.')), { timeout: 15000, maximumAge: 300000 });
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
  const check = (label, key) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: form[key], onchange: e => { form[key] = e.target.checked; } }), label);
  const submit = h('button', { class: 'btn primary wide', type: 'button', onclick: go }, t('Planı oluştur'));

  root.append(
    section(t('Nereye?'), destBox),
    section(t('Ne zaman?'), h('div', { class: 'two' },
      h('div', { class: 'field' }, h('span', {}, t('Gidiş')), start),
      h('div', { class: 'field' }, h('span', {}, t('Dönüş')), end)), dur),
    section(t('Kimlerle?'),
      row(t('Yetişkin'), stepper(form.adults, 1, 20, v => { form.adults = v; }, t('Yetişkin'))),
      row(t('Çocuk'), stepper(form.children, 0, 10, v => { form.children = v; }, t('Çocuk'))),
      check(t('Yaşlı ya da hareket kısıtı olan biri var'), 'elderly'),
      check(t('Evcil hayvan geliyor'), 'pet')),
    section(t('Nasıl gezeceksin?'), segmented(Object.entries(TRANSPORTS).map(([value, x]) => ({ value, label: x.label })), form.transport, v => { form.transport = v; })),
    section(t('Neler ilgini çeker?'), chips(SIGHT_CATS.map(c => ({ value: c, ...CATS[c] })), form.interests, v => { form.interests = v; }),
      h('p', { class: 'muted small' }, t('Öğle ve akşam yemeği önerileri otomatik eklenir. Alışverişi seçersen her güne bir alışveriş durağı (outlet, AVM, çarşı ya da pazar) eklenir.'))),
    section(t('Tempo'), segmented(Object.entries(PACES).map(([value, p]) => ({ value, label: p.label, sub: p.sub })), form.pace, v => { form.pace = v; })),
    staySec,
    section(t('Yemekler nasıl olsun?'), foodBox),
    section(t('Ne kadar geniş bir alan?'), scopeBox, h('p', { class: 'muted small' }, t('Arabayla çevreyi gezeceksen geniş, şehir içinde kalacaksan dar alan seç.'))),
    submit,
    out,
  );
  const renderStay = () => staySec.replaceChildren(section(t('Nerede kalacaksın?'),
    h('div', { class: 'chips' }, Object.entries(STAYS).map(([k, s]) => h('button', {
      type: 'button', class: 'chip' + (form.stay === k ? ' on' : ''), 'aria-pressed': String(form.stay === k),
      onclick: () => { form.stay = k; renderStay(); },
    }, s.label)))));
  const renderFood = () => foodBox.replaceChildren(h('div', { class: 'chips' }, Object.entries(FOODS).map(([k, x]) => h('button', {
    type: 'button', class: 'chip' + (form.level === k ? ' on' : ''), 'aria-pressed': String(form.level === k),
    onclick: () => { form.level = k; renderFood(); },
  }, x.label))));
  renderDest(); renderScope(); renderStay(); renderFood(); updDur();

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
        startDate: form.startDate, endDate: form.endDate,
        travelers: { adults: form.adults, children: form.children, elderly: form.elderly, pet: form.pet },
        transport: form.transport, pace: form.pace, level: form.level, stay: form.stay, radiusKm: form.radiusKm, interests: form.interests,
      }, getSettings(), msg => out.replaceChildren(spinner(msg)));
      form = null;
      location.hash = `#/gezi/${trip.id}`;
    } catch (e) {
      out.replaceChildren(h('p', { class: 'error' }, e.message));
      submit.disabled = false;
    }
  }
}
