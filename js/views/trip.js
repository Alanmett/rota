// Gezi ekranı: Plan · Harita · Bütçe · Bilgiler

import { h, fill, toast, openSheet, closeSheet, setTitle, onLeave, linkBtn, emptyState, tappable } from '../ui.js';
import { getTrip, saveTrip, deleteTrip, getSettings } from '../store.js';
import { computeTimeline, gmapsDayLink, gmapsDir, bestInsertIndex, PACES, TRANSPORTS, LEG_EMOJI } from '../planner.js';
import { computeBudget } from '../budget.js';
import { buildTips } from '../tips.js';
import { refreshWeather } from '../tripgen.js';
import { typeLabel, catEmoji, cuisineLabel } from '../places.js';
import { showPlaceDetail } from '../details.js';
import { wxPill } from '../components.js';
import { createMap, numIcon, emojiIcon, meIcon, popupFor, DAY_COLORS } from '../map.js';
import { WX } from '../api.js';
import { fmtDur, fmtKm, fmtClock, fmtMoney, fmtNum, fmtDay, fmtDayLong, fmtRange, todayISO, currencySymbol } from '../util.js';

const TABS = [['plan', 'Plan'], ['harita', 'Harita'], ['butce', 'Bütçe'], ['bilgi', 'Bilgiler']];
const color = di => DAY_COLORS[di % DAY_COLORS.length];

export function renderTrip(root, id, tab) {
  tab = tab || 'plan';
  const trip = getTrip(id);
  if (!trip) {
    root.append(emptyState('Gezi bulunamadı', 'Silinmiş olabilir.', h('a', { class: 'btn', href: '#/geziler' }, 'Gezilerime dön')));
    return;
  }
  setTitle(trip.name);
  const body = h('div', { class: 'trip-body' });
  const render = { plan: renderPlanTab, harita: renderMapTab, butce: renderBudgetTab, bilgi: renderInfoTab }[tab] || renderPlanTab;
  const ctx = {
    trip, settings: getSettings(), body,
    save() { trip.updatedAt = Date.now(); saveTrip(trip); },
    rerender() { const y = window.scrollY; body.replaceChildren(); render(body, ctx); window.scrollTo(0, y); },
  };
  root.append(
    tripHeader(trip),
    h('nav', { class: 'subnav', 'aria-label': 'Gezi bölümleri' }, TABS.map(([k, label]) =>
      h('a', { href: `#/gezi/${id}/${k}`, class: k === tab ? 'on' : null, 'aria-current': k === tab ? 'page' : null }, label))),
    body,
  );
  render(body, ctx);
  if (tab !== 'harita') maybeRefreshWeather(ctx);
}

async function maybeRefreshWeather(ctx) {
  const t = ctx.trip;
  if (!navigator.onLine || t.endDate < todayISO()) return;
  const age = Date.now() - (t.weather?.fetchedAt || 0);
  if (t.weather?.source === 'forecast' && age < 6 * 3600e3) return;
  if (t.weather?.source === 'archive' && age < 24 * 3600e3) return;
  try {
    await refreshWeather(t);
    ctx.save();
    if (ctx.body.isConnected) ctx.rerender();
  } catch { /* eski veriyle devam */ }
}

function tripHeader(t) {
  const tr = t.travelers;
  const who = [`${tr.adults} yetişkin`, tr.children ? `${tr.children} çocuk` : null].filter(Boolean).join(', ');
  const tp = TRANSPORTS[t.transport];
  return h('section', { class: 'trip-head' },
    h('div', { class: 'muted small' }, `📍 ${t.dest.label || t.dest.name}`),
    h('div', { class: 'trip-meta' },
      h('span', {}, fmtRange(t.startDate, t.endDate)),
      h('span', {}, t.days.length === 1 ? 'Günübirlik' : `${t.days.length} gün, ${t.days.length - 1} gece`),
      h('span', {}, who),
      h('span', {}, `${tp.emoji} ${tp.label}`),
      h('span', {}, PACES[t.pace]?.label || '')));
}

// ---------------- Plan ----------------
function renderPlanTab(body, ctx) {
  const { trip } = ctx;
  if (trip.partial) {
    body.append(h('div', { class: 'note warn' }, 'Plan hazırlanırken ayrıntılı harita verisi sunucusu yanıt vermedi; plan yalnızca bilinen yerlerle yapıldı ve küçük müzeler, seyir noktaları eksik olabilir. Birkaç dakika sonra yeniden plan yapmayı deneyebilirsin.'));
  }
  if (trip.days.every(d => !d.stops.length)) {
    body.append(h('div', { class: 'note warn' }, 'Plana yer eklenemedi. Aşağıdaki listeden ekleyebilir ya da daha geniş bir alanla yeniden plan yapabilirsin.'));
  }
  trip.days.forEach((_, di) => body.append(dayCard(ctx, di)));
  const alts = altSection(ctx);
  if (alts) body.append(alts);
  body.append(h('div', { class: 'danger-zone' },
    h('button', { class: 'btn small', onclick: () => rename(ctx) }, '✏️ Adını değiştir'),
    h('button', { class: 'btn small danger-text', onclick: () => remove(ctx) }, '🗑️ Geziyi sil')));
}

function dayCard(ctx, di) {
  const { trip } = ctx;
  const day = trip.days[di];
  const tl = computeTimeline(trip, di);
  const wx = trip.weather?.days?.[day.date];
  const list = h('ol', { class: 'timeline' });
  let n = 0;
  if (di === 0 && trip.origin && day.stops.length) {
    list.append(h('li', { class: 'tl-start' }, h('div', { class: 'tl-time' }, fmtClock(day.startMin)), h('div', { class: 'tl-num me', 'aria-hidden': 'true' }), h('div', { class: 'tl-body' }, h('div', { class: 'tl-meta' }, 'Bulunduğun yerden çıkış'))));
  }
  for (const it of tl.items) {
    if (it.kind === 'leg') {
      list.append(h('li', { class: 'tl-leg' }, h('span', { class: 'line' }), h('span', { class: 'txt' }, `${LEG_EMOJI[it.mode]} ${fmtDur(it.min)} · ${fmtKm(it.km)}`)));
    } else if (it.kind === 'lunch') {
      list.append(mealItem('Öğle yemeği', it.start, day.lunch));
    } else {
      n++;
      list.append(stopItem(ctx, di, day.stops.indexOf(it.id), it, n));
    }
  }
  if (day.stops.length && day.dinner?.length) list.append(mealItem('Akşam yemeği', null, day.dinner));

  const total = tl.visitMin + tl.travelMin;
  const limit = di === 0 && trip.kind === 'today' ? Infinity : PACES[trip.pace].budget * 1.2;
  const route = gmapsDayLink(trip, di);
  return h('section', { class: 'day', style: `--day:${color(di)}` },
    h('header', { class: 'day-head' },
      h('div', {}, h('div', { class: 'day-num' }, `${di + 1}. gün`), h('div', { class: 'day-date' }, fmtDayLong(day.date))),
      wx && wxPill(wx, trip.weather.source)),
    day.stops.length ? list : h('p', { class: 'muted day-empty' }, 'Bu güne henüz yer eklenmedi. Aşağıdaki "Vakit kalırsa" listesinden ekleyebilirsin.'),
    day.stops.length > 0 && h('footer', { class: 'day-foot' },
      h('span', {}, `Gezi ${fmtDur(tl.visitMin)} · yol ${fmtDur(tl.travelMin)} · bitiş ~${fmtClock(tl.end)}`),
      total > limit && h('span', { class: 'badge warn' }, 'Yoğun gün'),
      route && linkBtn('🗺️ Günün rotası (Google Maps)', route, 'btn small')));
}

function stopItem(ctx, di, si, it, n) {
  const p = it.place;
  return h('li', { class: 'tl-stop' },
    h('div', { class: 'tl-time' }, fmtClock(it.start)),
    h('div', { class: 'tl-num', style: `background:${color(di)}` }, String(n)),
    tappable({ class: 'tl-body', onclick: () => showPlaceDetail(p, { date: ctx.trip.days[di].date }) },
      h('div', { class: 'tl-name' }, p.name),
      h('div', { class: 'tl-meta' }, `${catEmoji(p)} ${typeLabel(p)} · ~${fmtDur(p.dur)}`),
      it.warn.map(w => h('div', { class: 'tl-warn' }, `⚠️ ${w}`))),
    h('button', { class: 'icon-btn', 'aria-label': `${p.name} seçenekleri`, onclick: () => stopMenu(ctx, di, si) }, '⋯'));
}

function mealItem(label, start, options) {
  return h('li', { class: 'tl-meal' },
    h('div', { class: 'tl-time' }, start != null ? fmtClock(start) : ''),
    h('div', { class: 'tl-num meal', 'aria-hidden': 'true' }, '🍽️'),
    h('div', { class: 'tl-body' },
      h('div', { class: 'tl-name' }, label),
      options?.length
        ? h('div', { class: 'meal-opts' }, options.map(f => h('button', { class: 'chip small', onclick: () => showPlaceDetail(f) },
          f.name, f.tags?.cuisine ? h('span', { class: 'muted' }, ` · ${cuisineLabel(f.tags.cuisine)}`) : null)))
        : h('div', { class: 'tl-meta' }, 'Yakında kayıtlı lokanta bulunamadı; Google Maps\'te çevrene bak.')));
}

function stopMenu(ctx, di, si) {
  const { trip } = ctx;
  const day = trip.days[di];
  const id = day.stops[si];
  const p = trip.places[id];
  const act = fn => () => { closeSheet(); fn(); ctx.save(); ctx.rerender(); };
  const swap = (a, b) => { [day.stops[a], day.stops[b]] = [day.stops[b], day.stops[a]]; };
  openSheet(h('div', {},
    h('h2', { class: 'sheet-title' }, p.name),
    h('div', { class: 'menu' },
      h('button', { class: 'menu-item', onclick: () => { closeSheet(); showPlaceDetail(p, { date: day.date }); } }, 'ℹ️ Detaylar'),
      si > 0 && h('button', { class: 'menu-item', onclick: act(() => swap(si, si - 1)) }, '⬆️ Önce git'),
      si < day.stops.length - 1 && h('button', { class: 'menu-item', onclick: act(() => swap(si, si + 1)) }, '⬇️ Sonra git'),
      trip.days.map((d, j) => j !== di && h('button', {
        class: 'menu-item',
        onclick: act(() => { day.stops.splice(si, 1); d.stops.splice(bestInsertIndex(d.stops, p, trip.places), 0, id); }),
      }, `📅 ${j + 1}. güne taşı`, h('small', {}, fmtDay(d.date)))),
      linkBtn('🧭 Yol tarifi', gmapsDir(p), 'menu-item'),
      h('button', { class: 'menu-item danger-text', onclick: act(() => { day.stops.splice(si, 1); trip.alternatives.unshift(id); }) }, '➖ Plandan çıkar'))));
}

function altSection(ctx) {
  const { trip } = ctx;
  const alts = trip.alternatives.map(id => trip.places[id]).filter(Boolean);
  if (!alts.length) return null;
  return h('section', { class: 'alts' },
    h('h2', { class: 'h-sec' }, 'Vakit kalırsa'),
    h('p', { class: 'muted small' }, 'Plana sığmayan diğer yerler. Eklemek için + düğmesine dokun.'),
    alts.map(p => h('div', { class: 'alt-row' },
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, catEmoji(p)),
      tappable({ class: 'alt-main', onclick: () => showPlaceDetail(p) },
        h('div', { class: 'pc-name' }, p.name),
        h('div', { class: 'muted small' }, `${typeLabel(p)} · ~${fmtDur(p.dur)}`)),
      h('button', { class: 'icon-btn add', 'aria-label': `${p.name} plana ekle`, onclick: () => addAlt(ctx, p.id) }, '+'))));
}

function addAlt(ctx, id) {
  const { trip } = ctx;
  const p = trip.places[id];
  const doAdd = di => {
    trip.alternatives = trip.alternatives.filter(x => x !== id);
    const stops = trip.days[di].stops;
    stops.splice(bestInsertIndex(stops, p, trip.places), 0, id);
    ctx.save(); ctx.rerender();
    toast(`${p.name}, ${di + 1}. güne eklendi`);
  };
  if (trip.days.length === 1) return doAdd(0);
  openSheet(h('div', {},
    h('h2', { class: 'sheet-title' }, 'Hangi güne eklensin?'),
    h('div', { class: 'menu' }, trip.days.map((d, j) => h('button', { class: 'menu-item', onclick: () => { closeSheet(); doAdd(j); } },
      `${j + 1}. gün · ${fmtDay(d.date)}`, h('small', {}, `${d.stops.length} yer`))))));
}

function rename(ctx) {
  const input = h('input', { type: 'text', value: ctx.trip.name, maxlength: '80', 'aria-label': 'Gezi adı' });
  openSheet(h('form', {
    onsubmit: e => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      ctx.trip.name = v; ctx.save(); closeSheet(); setTitle(v);
    },
  }, h('h2', { class: 'sheet-title' }, 'Gezinin adı'), input, h('button', { class: 'btn primary wide', type: 'submit', style: 'margin-top:12px' }, 'Kaydet')));
  requestAnimationFrame(() => input.select());
}

function remove(ctx) {
  openSheet(h('div', {},
    h('h2', { class: 'sheet-title' }, 'Gezi silinsin mi?'),
    h('p', { class: 'muted' }, `"${ctx.trip.name}" bu cihazdan silinecek. Bu işlem geri alınamaz.`),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: closeSheet }, 'Vazgeç'),
      h('button', { class: 'btn danger', onclick: () => { deleteTrip(ctx.trip.id); closeSheet(); toast('Gezi silindi'); location.hash = '#/geziler'; } }, 'Sil'))));
}

// ---------------- Harita ----------------
function renderMapTab(body, ctx) {
  const { trip } = ctx;
  let filter = 'all', map = null, layer = null;
  const chipsRow = h('div', { class: 'chips day-chips' });
  const mapEl = h('div', { class: 'map map-tall' });

  const draw = () => {
    chipsRow.replaceChildren(...[['all', 'Tümü'], ...trip.days.map((_, i) => [i, `${i + 1}. gün`])].map(([v, label]) =>
      h('button', { class: 'chip' + (filter === v ? ' on' : ''), style: v === 'all' ? null : `--chip:${color(v)}`, 'aria-pressed': String(filter === v), onclick: () => { filter = v; draw(); } }, label)));
    if (!map) return;
    layer.clearLayers();
    const bounds = [];
    trip.days.forEach((d, di) => {
      if (filter !== 'all' && filter !== di) return;
      const pts = d.stops.map(id => trip.places[id]).filter(Boolean);
      const line = (di === 0 && trip.origin ? [trip.origin, ...pts] : pts).map(p => [p.lat, p.lon]);
      if (line.length > 1) L.polyline(line, { color: color(di), weight: 4, opacity: 0.75, dashArray: '6 8' }).addTo(layer);
      pts.forEach((p, i) => {
        L.marker([p.lat, p.lon], { icon: numIcon(i + 1, color(di)) })
          .bindPopup(popupFor(p, `${di + 1}. gün · ${i + 1}. durak`, () => showPlaceDetail(p, { date: d.date }))).addTo(layer);
        bounds.push([p.lat, p.lon]);
      });
      if (filter === di) {
        for (const f of [...(d.lunch || []).slice(0, 2), ...(d.dinner || []).slice(0, 2)]) {
          L.marker([f.lat, f.lon], { icon: emojiIcon('🍽️') }).bindPopup(popupFor(f, 'Yemek önerisi', () => showPlaceDetail(f))).addTo(layer);
        }
      }
    });
    if (trip.origin && (filter === 'all' || filter === 0)) {
      L.marker([trip.origin.lat, trip.origin.lon], { icon: meIcon() }).bindPopup('Başlangıç').addTo(layer);
      bounds.push([trip.origin.lat, trip.origin.lon]);
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
  };

  body.append(chipsRow, mapEl, h('p', { class: 'muted small' }, 'Numaralar ziyaret sırasını gösterir. Bir güne dokunursan o günün yemek önerileri de görünür.'));
  draw();
  setTimeout(() => {
    if (!mapEl.isConnected) return;
    map = createMap(mapEl, trip.dest);
    if (!map) return;
    layer = L.layerGroup().addTo(map);
    onLeave(() => map.remove());
    draw();
  });
}

// ---------------- Bütçe ----------------
function renderBudgetTab(body, ctx) {
  const { trip, settings } = ctx;
  const b = computeBudget(trip, settings);
  const people = trip.travelers.adults + (trip.travelers.children || 0);
  fill(body,
    h('section', { class: 'card total-card' },
      h('div', { class: 'muted small' }, 'Tahmini toplam'),
      h('div', { class: 'big' }, fmtMoney(b.total)),
      h('div', { class: 'muted small' }, `Kişi başı yaklaşık ${fmtMoney(b.perPerson)} · ${people} kişi`)),
    !settings.pricesReviewed && h('div', { class: 'note warn' },
      'Fiyatlar varsayılan değerlerle hesaplandı. Doğru sonuç için ', h('a', { href: '#/ayarlar' }, 'Ayarlar'),
      ' sekmesinden benzin, konaklama ve yemek fiyatlarını kendine göre güncelle.'),
    trip.dest.cc && trip.dest.cc !== settings.homeCountry && h('div', { class: 'note' }, 'Fiyatlar yaşadığın ülkeye göre ayarlı; başka ülkede fiyatlar çok farklı olabilir. Kalemleri elle düzenlemeni öneririm.'),
    h('section', { class: 'card budget-lines' },
      b.lines.map(l => budgetLine(l, ctx)),
      h('div', { class: 'budget-row' },
        h('div', {}, h('div', { class: 'bl-label' }, 'Beklenmedik giderler'), h('div', { class: 'muted small' }, `Ara toplamın %${settings.budget.bufferPct}'u`)),
        h('b', { class: 'money-fixed' }, fmtMoney(b.buffer)))),
    h('p', { class: 'muted small' }, 'Tutarlara dokunup değiştirebilirsin; değişiklik sadece bu geziye kaydedilir. Gezi sırasındaki harcama takibi sonraki sürümde gelecek.'),
  );
}

function budgetLine(l, ctx) {
  const input = h('input', {
    class: 'money-input', type: 'text', inputmode: 'numeric', value: fmtNum(l.amount), 'aria-label': `${l.label} tutarı`,
    onfocus: e => e.target.select(),
    onchange: e => {
      const v = parseInt(e.target.value.replace(/\D/g, ''), 10);
      if (Number.isNaN(v)) { e.target.value = fmtNum(l.amount); return; }
      ctx.trip.budgetOverrides[l.key] = v; ctx.save(); ctx.rerender();
    },
  });
  return h('div', { class: 'budget-row' },
    h('div', {},
      h('div', { class: 'bl-label' }, l.label),
      h('div', { class: 'muted small' }, l.overridden ? `Elle girildi · otomatik hesap: ${fmtMoney(l.auto)}` : l.detail),
      l.overridden && h('button', { class: 'link-btn', onclick: () => { delete ctx.trip.budgetOverrides[l.key]; ctx.save(); ctx.rerender(); } }, 'Otomatiğe dön')),
    h('div', { class: 'money' }, input, h('span', { 'aria-hidden': 'true' }, currencySymbol())));
}

// ---------------- Bilgiler ----------------
function renderInfoTab(body, ctx) {
  const { trip } = ctx;
  const d = trip.destInfo;
  if (d) {
    body.append(h('section', { class: 'card wiki-card' },
      d.thumb && h('img', { src: d.thumb, alt: '', class: 'wiki-thumb', loading: 'lazy' }),
      h('h2', {}, d.title),
      h('p', {}, d.extract),
      h('a', { href: d.url, target: '_blank', rel: 'noopener', class: 'small' }, `Wikipedia'da devamı${d.lang !== 'tr' ? ' (İngilizce)' : ''} →`)));
  }

  if (trip.weather?.days) {
    const archive = trip.weather.source === 'archive';
    body.append(h('section', { class: 'card' },
      h('h2', { class: 'h-sec' }, archive ? 'Hava (geçen yıl aynı günler)' : 'Hava tahmini'),
      archive && h('p', { class: 'muted small' }, 'Gezine 16 günden fazla var. Fikir vermesi için geçen yılın aynı günleri gösteriliyor; gezi yaklaşınca gerçek tahmin gelir.'),
      h('div', { class: 'wx-list' }, trip.days.map(day => {
        const w = trip.weather.days[day.date];
        if (!w) return null;
        const [icon, label] = WX(w.code);
        return h('div', { class: 'wx-row' },
          h('span', {}, fmtDay(day.date)),
          h('span', {}, `${icon} ${label}`),
          h('span', {}, `${Math.round(w.tmin)}° / ${Math.round(w.tmax)}°`),
          h('span', { class: 'muted' }, w.pop != null ? `%${w.pop}` : w.rain != null ? `${w.rain} mm` : ''));
      }))));
  } else if (trip.endDate >= todayISO()) {
    body.append(h('div', { class: 'note' }, 'Hava bilgisi şu an alınamadı; internet varken gezi sayfasını açınca güncellenir.'));
  }

  if (trip.country) {
    const c = trip.country;
    body.append(h('section', { class: 'card' },
      h('h2', { class: 'h-sec' }, `Ülke bilgisi · ${c.name}`),
      h('dl', { class: 'kv' },
        c.capital && [h('dt', {}, 'Başkent'), h('dd', {}, c.capital)],
        c.currencies.length && [h('dt', {}, 'Para birimi'), h('dd', {}, c.currencies.join(', '))],
        c.languages.length && [h('dt', {}, 'Dil'), h('dd', {}, c.languages.join(', '))],
        c.driveSide && [h('dt', {}, 'Trafik'), h('dd', {}, c.driveSide === 'left' ? 'Soldan akar' : 'Sağdan akar')],
        c.idd && [h('dt', {}, 'Telefon kodu'), h('dd', {}, c.idd)])));
  }

  body.append(h('section', {},
    h('h2', { class: 'h-sec' }, 'Dikkat edilecekler'),
    buildTips(trip, ctx.settings).map(t => h('div', { class: `tip ${t.level}` },
      h('span', { class: 'tip-icon', 'aria-hidden': 'true' }, t.icon),
      h('div', {}, h('b', {}, t.title), h('p', {}, t.text))))));

  const q = encodeURIComponent(trip.dest.name);
  body.append(h('section', { class: 'card' },
    h('h2', { class: 'h-sec' }, 'Daha fazlası'),
    h('div', { class: 'menu' },
      trip.dest.cc === 'tr' && linkBtn('📘 Wikivoyage rehberi (Türkçe)', `https://tr.wikivoyage.org/w/index.php?search=${q}`, 'menu-item'),
      linkBtn('📗 Wikivoyage rehberi (İngilizce, daha kapsamlı)', `https://en.wikivoyage.org/w/index.php?search=${q}`, 'menu-item'),
      linkBtn('🗺️ Bölgeyi Google Maps\'te aç', `https://www.google.com/maps/@${trip.dest.lat},${trip.dest.lon},13z`, 'menu-item'))));
}
