// Birden fazla ekranda kullanılan parçalar.

import { h, spinner, tappable } from './ui.js';
import { geocode, WX } from './api.js';
import { hoursOn, isOpenAt, fmtRanges } from './hours.js';
import { typeLabel, catEmoji } from './places.js';
import { showPlaceDetail } from './details.js';
import { fmtKm } from './util.js';

// Yer arama: kullanım kuralı gereği her tuşta değil, "Ara"ya basınca arar.
export function placeSearch({ placeholder, onPick, autofocus = false }) {
  const input = h('input', { type: 'search', placeholder, enterkeyhint: 'search', autocomplete: 'off', 'aria-label': placeholder });
  const list = h('div', { class: 'search-results', 'aria-live': 'polite' });
  const form = h('form', {
    class: 'search-row',
    onsubmit: async e => {
      e.preventDefault();
      const q = input.value.trim();
      if (q.length < 2) return;
      list.replaceChildren(spinner('Aranıyor…'));
      try {
        const rs = await geocode(q);
        if (!rs.length) { list.replaceChildren(h('p', { class: 'muted small' }, 'Sonuç bulunamadı. Yazımı kontrol et ya da daha genel bir ad dene.')); return; }
        list.replaceChildren(...rs.map(r => h('button', {
          type: 'button', class: 'search-item',
          onclick: () => { list.replaceChildren(); input.value = r.name; onPick(r); },
        }, h('b', {}, r.name), h('span', { class: 'muted' }, r.detail))));
      } catch (err) {
        list.replaceChildren(h('p', { class: 'error' }, `Arama yapılamadı: ${err.message}`));
      }
    },
  }, input, h('button', { class: 'btn', type: 'submit' }, 'Ara'));
  if (autofocus) requestAnimationFrame(() => input.focus());
  return h('div', { class: 'place-search' }, form, list);
}

export function openStatus(p) {
  if (!p.hours) return null;
  const now = new Date();
  const r = hoursOn(p.hours, now);
  if (!r.known) return null;
  if (!r.open) return { cls: 'bad', text: 'Bugün kapalı' };
  return isOpenAt(p.hours, now) ? { cls: 'ok', text: 'Şu an açık' } : { cls: '', text: `Bugün ${fmtRanges(r.ranges)}` };
}

export function placeCard(p, { onAdd } = {}) {
  const st = openStatus(p);
  const notable = p.tags?.wikipedia || p.tags?.wikidata;
  return h('div', { class: 'place-card' },
    tappable({ class: 'pc-tap', onclick: () => showPlaceDetail(p, { actions: onAdd ? [h('button', { class: 'btn', onclick: onAdd }, '＋ Geziye ekle')] : [] }) },
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, catEmoji(p)),
      h('div', { class: 'pc-main' },
        h('div', { class: 'pc-name' }, p.name),
        h('div', { class: 'pc-meta' },
          h('span', {}, typeLabel(p)),
          p.dist != null && h('span', {}, fmtKm(p.dist)),
          st && h('span', { class: `badge ${st.cls}` }, st.text),
          notable && h('span', { class: 'badge star' }, 'Öne çıkan')))),
    onAdd && h('button', { class: 'icon-btn add', 'aria-label': `${p.name} geziye ekle`, onclick: onAdd }, '+'));
}

export function wxPill(w, source) {
  const [icon] = WX(w.code);
  const approx = source === 'archive';
  return h('span', { class: 'wx', title: approx ? 'Geçen yıl aynı gün' : 'Hava tahmini' },
    `${approx ? '≈ ' : ''}${icon} ${Math.round(w.tmin)}°/${Math.round(w.tmax)}°`,
    !approx && w.pop != null && w.pop >= 20 ? ` · %${w.pop}` : '');
}
