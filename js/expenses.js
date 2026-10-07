// Gezi sırasındaki harcamalar. Tutarlar yaşanılan ülkenin para biriminde saklanır (bütçeyle karşılaştırmak için);
// yerel parayla (ör. euro) girilen tutar güncel kurla çevrilir, asıl tutar da not edilir.

import { h, toast, openSheet, closeSheet } from './ui.js';
import { getSettings, saveTrip } from './store.js';
import { exchangeRate } from './api.js';
import { destCurrency } from './budget.js';
import { todayISO, uid } from './util.js';
import { t, locale } from './i18n.js';

// Harcama türü → bütçedeki hangi kalemlerle karşılaştırılır
export const EXP_CATS = {
  food: { label: t('Yeme-içme'), emoji: '🍽️', lines: ['food'] },
  hotel: { label: t('Konaklama'), emoji: '🛏️', lines: ['hotel'] },
  transport: { label: t('Ulaşım'), emoji: '🚗', lines: ['fuel', 'toll', 'parking', 'transit', 'intercity'] },
  tickets: { label: t('Giriş ücretleri'), emoji: '🎟️', lines: ['tickets'] },
  shopping: { label: t('Alışveriş'), emoji: '🛍️', lines: ['shopping'] },
  other: { label: t('Diğer'), emoji: '🧾', lines: [] },
};

export const expensesOf = trip => trip.expenses || [];
export const spentTotal = trip => expensesOf(trip).reduce((s, e) => s + e.amount, 0);
export function spentByCat(trip) {
  const out = {};
  for (const e of expensesOf(trip)) out[e.cat] = (out[e.cat] || 0) + e.amount;
  return out;
}

const fmtCur = (v, cur) => new Intl.NumberFormat(locale(), { style: 'currency', currency: cur, maximumFractionDigits: v % 1 ? 2 : 0 }).format(v);
export const fmtOrig = e => (e.orig ? fmtCur(e.orig.amount, e.orig.cur) : '');

// Hızlı ekleme penceresi (Bütçe sekmesinden ve "Bugün" kartından açılır)
export function expenseSheet(trip, onSaved) {
  const home = getSettings().currency;
  const iso = todayISO();
  const today = trip.days.find(d => d.date === iso);
  const ccs = trip.route ? trip.days.map(d => d.cc) : [trip.dest.cc];
  const curs = [...new Set([home, ...ccs.map(destCurrency)].filter(Boolean))];
  // Varsayılan para birimi: bugün bulunulan ülkeninki (yoksa yaşanılan ülkeninki)
  let cur = destCurrency(today?.cc || trip.dest.cc) || home;
  if (!curs.includes(cur)) cur = home;
  let cat = 'food';

  const amount = h('input', { type: 'text', inputmode: 'decimal', class: 'exp-amount', placeholder: '0', 'aria-label': t('Tutar'), autocomplete: 'off' });
  const note = h('input', { type: 'text', maxlength: '60', placeholder: t('Not (isteğe bağlı)'), 'aria-label': t('Not') });
  const curBox = h('div', { class: 'chips' });
  const catBox = h('div', { class: 'chips' });
  const pick = (box, list, get, set) => {
    const render = () => box.replaceChildren(...list.map(([v, label]) => h('button', {
      type: 'button', class: 'chip' + (get() === v ? ' on' : ''), 'aria-pressed': String(get() === v),
      onclick: () => { set(v); render(); },
    }, label)));
    render();
  };
  pick(curBox, curs.map(c => [c, c]), () => cur, v => { cur = v; });
  pick(catBox, Object.entries(EXP_CATS).map(([k, c]) => [k, `${c.emoji} ${c.label}`]), () => cat, v => { cat = v; });
  const btn = h('button', { class: 'btn primary wide', type: 'submit' }, t('Kaydet'));

  async function save(e) {
    e.preventDefault();
    const v = parseFloat(amount.value.replace(/'/g, '').replace(/\s/g, '').replace(',', '.'));
    if (!(v > 0)) { toast(t('Önce tutarı yaz.')); amount.focus(); return; }
    let value = v;
    if (cur !== home) {
      btn.disabled = true;
      const rate = await exchangeRate(cur, home);
      btn.disabled = false;
      if (!rate) { toast(t('Kur alınamadı; tutarı {c} olarak gir.', { c: home }), 4000); return; }
      value = v * rate;
    }
    trip.expenses = [...expensesOf(trip), {
      id: uid(), at: Date.now(), date: iso, cat,
      amount: Math.round(value * 100) / 100,
      orig: cur !== home ? { amount: v, cur } : null,
      note: note.value.trim(),
    }];
    trip.updatedAt = Date.now();
    saveTrip(trip);
    closeSheet();
    toast(t('Harcama eklendi'));
    onSaved?.();
  }

  openSheet(h('form', { class: 'exp-form', onsubmit: save },
    h('h2', { class: 'sheet-title' }, '➕ ' + t('Harcama ekle')),
    h('label', { class: 'field' }, h('span', {}, t('Tutar')), amount),
    curs.length > 1 && curBox,
    h('div', { class: 'field' }, h('span', {}, t('Ne için?')), catBox),
    h('label', { class: 'field' }, h('span', {}, t('Not')), note),
    btn));
  requestAnimationFrame(() => amount.focus());
}

export function removeExpense(trip, id) {
  trip.expenses = expensesOf(trip).filter(e => e.id !== id);
  trip.updatedAt = Date.now();
  saveTrip(trip);
}
