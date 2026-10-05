// Gezi ekranı: Plan · Harita · Bütçe · Bilgiler

import { h, fill, toast, openSheet, closeSheet, setTitle, onLeave, linkBtn, emptyState, tappable } from '../ui.js';
import { getTrip, saveTrip, deleteTrip, getSettings } from '../store.js';
import { computeTimeline, gmapsDayLink, gmapsDir, bestInsertIndex, PACES, TRANSPORTS, LEG_EMOJI } from '../planner.js';
import { computeBudget, STAYS, stayOf, FOODS, foodOf, savingTips, factorNote } from '../budget.js';
import { buildTips } from '../tips.js';
import { refreshWeather, addParking } from '../tripgen.js';
import { typeLabel, catEmoji, cuisineLabel } from '../places.js';
import { showPlaceDetail, wikiMoreLabel, parkLink } from '../details.js';
import { wxPill } from '../components.js';
import { createMap, numIcon, emojiIcon, meIcon, popupFor, DAY_COLORS } from '../map.js';
import { WX } from '../api.js';
import { fmtDur, fmtKm, fmtClock, fmtMoney, fmtNum, fmtDay, fmtDayLong, fmtRange, todayISO, currencySymbol } from '../util.js';
import { t, getLang, locale } from '../i18n.js';

const TABS = [['plan', t('Plan')], ['harita', t('Harita')], ['butce', t('Bütçe')], ['bilgi', t('Bilgiler')]];
const color = di => DAY_COLORS[di % DAY_COLORS.length];
const dayLabel = n => t('{n}. gün', { n });

export function renderTrip(root, id, tab) {
  tab = tab || 'plan';
  const trip = getTrip(id);
  if (!trip) {
    root.append(emptyState(t('Gezi bulunamadı'), t('Silinmiş olabilir.'), h('a', { class: 'btn', href: '#/geziler' }, t('Gezilerime dön'))));
    return;
  }
  setTitle(trip.name);
  const body = h('div', { class: 'trip-body' });
  const render = { plan: renderPlanTab, harita: renderMapTab, butce: renderBudgetTab, bilgi: renderInfoTab }[tab] || renderPlanTab;
  const ctx = {
    trip, settings: getSettings(), body,
    save() { trip.updatedAt = Date.now(); saveTrip(trip); },
    rerender() {
      const y = window.scrollY; body.replaceChildren(); render(body, ctx); window.scrollTo(0, y);
      if (tab === 'plan') maybeAddParking(ctx);
    },
  };
  root.append(
    tripHeader(trip),
    h('nav', { class: 'subnav', 'aria-label': t('Gezi bölümleri') }, TABS.map(([k, label]) =>
      h('a', { href: `#/gezi/${id}/${k}`, class: k === tab ? 'on' : null, 'aria-current': k === tab ? 'page' : null }, label))),
    body,
  );
  render(body, ctx);
  if (tab !== 'harita') maybeRefreshWeather(ctx);
  if (tab === 'plan' || tab === 'harita') maybeAddParking(ctx, tab === 'plan');
}

// Plan değiştiyse (durak eklendi/taşındı) otoparkı henüz aranmamış duraklar için arar.
async function maybeAddParking(ctx, rerender = true) {
  if (ctx.trip.transport !== 'araba' || !navigator.onLine) return;
  try {
    if (await addParking(ctx.trip)) {
      ctx.save();
      if (rerender && ctx.body.isConnected) ctx.rerender();
    }
  } catch { /* otoparksız devam */ }
}

async function maybeRefreshWeather(ctx) {
  const trip = ctx.trip;
  if (!navigator.onLine || trip.endDate < todayISO()) return;
  const age = Date.now() - (trip.weather?.fetchedAt || 0);
  if (trip.weather?.source === 'forecast' && age < 6 * 3600e3) return;
  if (trip.weather?.source === 'archive' && age < 24 * 3600e3) return;
  try {
    await refreshWeather(trip);
    ctx.save();
    if (ctx.body.isConnected) ctx.rerender();
  } catch { /* eski veriyle devam */ }
}

function tripHeader(trip) {
  const tr = trip.travelers;
  const who = [t('{n} yetişkin', { n: tr.adults }), tr.children ? t('{n} çocuk', { n: tr.children }) : null].filter(Boolean).join(', ');
  const tp = TRANSPORTS[trip.transport];
  return h('section', { class: 'trip-head' },
    h('div', { class: 'muted small' }, `📍 ${trip.dest.label || trip.dest.name}`),
    h('div', { class: 'trip-meta' },
      h('span', {}, fmtRange(trip.startDate, trip.endDate)),
      h('span', {}, trip.days.length === 1 ? t('Günübirlik') : t('{d} gün, {n} gece', { d: trip.days.length, n: trip.days.length - 1 })),
      h('span', {}, who),
      h('span', {}, `${tp.emoji} ${tp.label}`),
      h('span', {}, PACES[trip.pace]?.label || '')));
}

// ---------------- Plan ----------------
function renderPlanTab(body, ctx) {
  const { trip } = ctx;
  if (trip.partial) {
    body.append(h('div', { class: 'note warn' }, t('Plan hazırlanırken veri kaynaklarından biri yanıt vermedi; bazı yerler eksik olabilir. Birkaç dakika sonra yeniden plan yapmayı deneyebilirsin.')));
  }
  if (trip.days.every(d => !d.stops.length)) {
    body.append(h('div', { class: 'note warn' }, t('Plana yer eklenemedi. Aşağıdaki listeden ekleyebilir ya da daha geniş bir alanla yeniden plan yapabilirsin.')));
  }
  trip.days.forEach((_, di) => body.append(dayCard(ctx, di)));
  const alts = altSection(ctx);
  if (alts) body.append(alts);
  body.append(h('div', { class: 'danger-zone' },
    h('button', { class: 'btn small', onclick: () => rename(ctx) }, '✏️ ' + t('Adını değiştir')),
    h('button', { class: 'btn small danger-text', onclick: () => remove(ctx) }, '🗑️ ' + t('Geziyi sil'))));
}

function dayCard(ctx, di) {
  const { trip } = ctx;
  const day = trip.days[di];
  const tl = computeTimeline(trip, di);
  const wx = trip.weather?.days?.[day.date];
  const list = h('ol', { class: 'timeline' });
  let n = 0;
  if (di === 0 && trip.origin && day.stops.length) {
    list.append(h('li', { class: 'tl-start' }, h('div', { class: 'tl-time' }, fmtClock(day.startMin)), h('div', { class: 'tl-num me', 'aria-hidden': 'true' }), h('div', { class: 'tl-body' }, h('div', { class: 'tl-meta' }, t('Bulunduğun yerden çıkış')))));
  }
  for (const it of tl.items) {
    if (it.kind === 'leg') {
      list.append(h('li', { class: 'tl-leg' }, h('span', { class: 'line' }), h('span', { class: 'txt' }, `${LEG_EMOJI[it.mode]} ${fmtDur(it.min)} · ${fmtKm(it.km)}`)));
    } else if (it.kind === 'lunch') {
      list.append(mealItem(t('Öğle yemeği'), it.start, day.lunch));
    } else {
      n++;
      if (it.parkHere) { const pk = parkingItem(trip, it.id); if (pk) list.append(pk); }
      list.append(stopItem(ctx, di, day.stops.indexOf(it.id), it, n));
    }
  }
  if (day.stops.length && day.dinner?.length) list.append(mealItem(t('Akşam yemeği'), null, day.dinner));

  const total = tl.visitMin + tl.travelMin;
  const limit = di === 0 && trip.kind === 'today' ? Infinity : PACES[trip.pace].budget * 1.2;
  const route = gmapsDayLink(trip, di);
  return h('section', { class: 'day', style: `--day:${color(di)}` },
    h('header', { class: 'day-head' },
      h('div', {}, h('div', { class: 'day-num' }, dayLabel(di + 1)), h('div', { class: 'day-date' }, fmtDayLong(day.date))),
      wx && wxPill(wx, trip.weather.source)),
    day.stops.length ? list : h('p', { class: 'muted day-empty' }, t('Bu güne henüz yer eklenmedi. Aşağıdaki "Vakit kalırsa" listesinden ekleyebilirsin.')),
    day.stops.length > 0 && h('footer', { class: 'day-foot' },
      h('span', {}, t('Gezi {v} · yol {r} · bitiş ~{e}', { v: fmtDur(tl.visitMin), r: fmtDur(tl.travelMin), e: fmtClock(tl.end) })),
      total > limit && h('span', { class: 'badge warn' }, t('Yoğun gün')),
      route && linkBtn('🗺️ ' + t('Günün rotası (Google Maps)'), route, 'btn small')));
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
    h('button', { class: 'icon-btn', 'aria-label': t('{p}: seçenekler', { p: p.name }), onclick: () => stopMenu(ctx, di, si) }, '⋯'));
}

// Arabayla varılan duraktan önce: nereye park edilecek
function parkingItem(trip, id) {
  const lots = trip.parking?.[id];
  if (lots === undefined) return null; // henüz aranmadı; arka planda aranıyor
  return h('li', { class: 'tl-park' }, h('span', { class: 'line' }),
    h('div', { class: 'park-box' },
      lots.length ? lots.map(parkLink) : h('span', { class: 'muted small' }, '🅿️ ' + t('Yakında kayıtlı otopark bulunamadı'))));
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
        : h('div', { class: 'tl-meta' }, t("Yakında kayıtlı lokanta bulunamadı; Google Maps'te çevrene bak."))));
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
      h('button', { class: 'menu-item', onclick: () => { closeSheet(); showPlaceDetail(p, { date: day.date }); } }, 'ℹ️ ' + t('Detaylar')),
      si > 0 && h('button', { class: 'menu-item', onclick: act(() => swap(si, si - 1)) }, '⬆️ ' + t('Önce git')),
      si < day.stops.length - 1 && h('button', { class: 'menu-item', onclick: act(() => swap(si, si + 1)) }, '⬇️ ' + t('Sonra git')),
      trip.days.map((d, j) => j !== di && h('button', {
        class: 'menu-item',
        onclick: act(() => { day.stops.splice(si, 1); d.stops.splice(bestInsertIndex(d.stops, p, trip.places), 0, id); }),
      }, '📅 ' + t('{n}. güne taşı', { n: j + 1 }), h('small', {}, fmtDay(d.date)))),
      linkBtn('🧭 ' + t('Yol tarifi'), gmapsDir(p), 'menu-item'),
      h('button', { class: 'menu-item danger-text', onclick: act(() => { day.stops.splice(si, 1); trip.alternatives.unshift(id); }) }, '➖ ' + t('Plandan çıkar')))));
}

function altSection(ctx) {
  const { trip } = ctx;
  const alts = trip.alternatives.map(id => trip.places[id]).filter(Boolean);
  if (!alts.length) return null;
  return h('section', { class: 'alts' },
    h('h2', { class: 'h-sec' }, t('Vakit kalırsa')),
    h('p', { class: 'muted small' }, t('Plana sığmayan diğer yerler. Eklemek için + düğmesine dokun.')),
    alts.map(p => h('div', { class: 'alt-row' },
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, catEmoji(p)),
      tappable({ class: 'alt-main', onclick: () => showPlaceDetail(p) },
        h('div', { class: 'pc-name' }, p.name),
        h('div', { class: 'muted small' }, `${typeLabel(p)} · ~${fmtDur(p.dur)}`)),
      h('button', { class: 'icon-btn add', 'aria-label': t('{p}: plana ekle', { p: p.name }), onclick: () => addAlt(ctx, p.id) }, '+'))));
}

function addAlt(ctx, id) {
  const { trip } = ctx;
  const p = trip.places[id];
  const doAdd = di => {
    trip.alternatives = trip.alternatives.filter(x => x !== id);
    const stops = trip.days[di].stops;
    stops.splice(bestInsertIndex(stops, p, trip.places), 0, id);
    ctx.save(); ctx.rerender();
    toast(t('{p} eklendi: {n}. gün', { p: p.name, n: di + 1 }));
  };
  if (trip.days.length === 1) return doAdd(0);
  openSheet(h('div', {},
    h('h2', { class: 'sheet-title' }, t('Hangi güne eklensin?')),
    h('div', { class: 'menu' }, trip.days.map((d, j) => h('button', { class: 'menu-item', onclick: () => { closeSheet(); doAdd(j); } },
      `${dayLabel(j + 1)} · ${fmtDay(d.date)}`, h('small', {}, t('{n} yer', { n: d.stops.length })))))));
}

function rename(ctx) {
  const input = h('input', { type: 'text', value: ctx.trip.name, maxlength: '80', 'aria-label': t('Gezi adı') });
  openSheet(h('form', {
    onsubmit: e => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      ctx.trip.name = v; ctx.save(); closeSheet(); setTitle(v);
    },
  }, h('h2', { class: 'sheet-title' }, t('Gezinin adı')), input, h('button', { class: 'btn primary wide', type: 'submit', style: 'margin-top:12px' }, t('Kaydet'))));
  requestAnimationFrame(() => input.select());
}

function remove(ctx) {
  openSheet(h('div', {},
    h('h2', { class: 'sheet-title' }, t('Gezi silinsin mi?')),
    h('p', { class: 'muted' }, t('"{name}" bu cihazdan silinecek. Bu işlem geri alınamaz.', { name: ctx.trip.name })),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: closeSheet }, t('Vazgeç')),
      h('button', { class: 'btn danger', onclick: () => { deleteTrip(ctx.trip.id); closeSheet(); toast(t('Gezi silindi')); location.hash = '#/geziler'; } }, t('Sil')))));
}

// ---------------- Harita ----------------
function renderMapTab(body, ctx) {
  const { trip } = ctx;
  let filter = 'all', map = null, layer = null;
  const chipsRow = h('div', { class: 'chips day-chips' });
  const mapEl = h('div', { class: 'map map-tall' });

  const draw = () => {
    chipsRow.replaceChildren(...[['all', t('Tümü')], ...trip.days.map((_, i) => [i, dayLabel(i + 1)])].map(([v, label]) =>
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
          .bindPopup(popupFor(p, t('{d}. gün · {s}. durak', { d: di + 1, s: i + 1 }), () => showPlaceDetail(p, { date: d.date }))).addTo(layer);
        bounds.push([p.lat, p.lon]);
      });
      if (filter === di) {
        for (const f of [...(d.lunch || []).slice(0, 2), ...(d.dinner || []).slice(0, 2)]) {
          L.marker([f.lat, f.lon], { icon: emojiIcon('🍽️') }).bindPopup(popupFor(f, t('Yemek önerisi'), () => showPlaceDetail(f))).addTo(layer);
        }
        for (const id of d.stops) {
          for (const l of (trip.parking?.[id] || []).slice(0, 1)) {
            const el = document.createElement('div');
            el.append(parkLink(l));
            L.marker([l.lat, l.lon], { icon: emojiIcon('🅿️') }).bindPopup(el).addTo(layer);
          }
        }
      }
    });
    if (trip.origin && (filter === 'all' || filter === 0)) {
      L.marker([trip.origin.lat, trip.origin.lon], { icon: meIcon() }).bindPopup(t('Başlangıç')).addTo(layer);
      bounds.push([trip.origin.lat, trip.origin.lon]);
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
  };

  body.append(chipsRow, mapEl, h('p', { class: 'muted small' }, t('Numaralar ziyaret sırasını gösterir. Bir güne dokunursan o günün yemek önerileri de görünür.')));
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
  const nights = trip.days.length - 1;
  const stay = stayOf(trip);
  const country = trip.dest.cc ? new Intl.DisplayNames([locale()], { type: 'region' }).of(trip.dest.cc.toUpperCase()) : '';
  const note = trip.dest.cc ? factorNote(trip, settings, country) : null;
  const tips = savingTips(trip, settings);
  fill(body,
    h('section', { class: 'card total-card' },
      h('div', { class: 'muted small' }, t('Tahmini toplam')),
      h('div', { class: 'big' }, fmtMoney(b.total)),
      h('div', { class: 'muted small' }, t('Kişi başı yaklaşık {p} · {n} kişi', { p: fmtMoney(b.perPerson), n: people }))),
    nights > 0 && h('section', { class: 'card' },
      h('h2', { class: 'h-sec' }, t('Nerede kalacaksın?')),
      h('div', { class: 'chips' }, Object.entries(STAYS).map(([k, s]) => h('button', {
        type: 'button', class: 'chip' + (stay === k ? ' on' : ''), 'aria-pressed': String(stay === k),
        onclick: () => { trip.stay = k; delete trip.budgetOverrides.hotel; ctx.save(); ctx.rerender(); },
      }, s.label)))),
    h('section', { class: 'card' },
      h('h2', { class: 'h-sec' }, t('Yemekler nasıl olsun?')),
      h('div', { class: 'chips' }, Object.entries(FOODS).map(([k, x]) => h('button', {
        type: 'button', class: 'chip' + (foodOf(trip) === k ? ' on' : ''), 'aria-pressed': String(foodOf(trip) === k),
        onclick: () => { trip.level = k; delete trip.budgetOverrides.food; ctx.save(); ctx.rerender(); },
      }, x.label)))),
    !settings.pricesReviewed && h('div', { class: 'note warn' },
      t('Fiyatlar varsayılan değerlerle hesaplandı. Doğru sonuç için Ayarlar sekmesinden benzin, konaklama ve yemek fiyatlarını kendine göre güncelle.'), ' ',
      h('a', { href: '#/ayarlar' }, t('Ayarlar') + ' →')),
    note && h('div', { class: 'note' }, note),
    h('section', { class: 'card budget-lines' },
      b.lines.map(l => budgetLine(l, ctx)),
      h('div', { class: 'budget-row' },
        h('div', {}, h('div', { class: 'bl-label' }, t('Beklenmedik giderler')), h('div', { class: 'muted small' }, t('Ara toplamın %{p} kadarı', { p: settings.budget.bufferPct }))),
        h('b', { class: 'money-fixed' }, fmtMoney(b.buffer)))),
    h('p', { class: 'muted small' }, t('Tutarlara dokunup değiştirebilirsin; değişiklik sadece bu geziye kaydedilir. Gezi sırasındaki harcama takibi sonraki sürümde gelecek.')),
    tips.length > 0 && h('section', {},
      h('h2', { class: 'h-sec' }, t('Tasarruf için')),
      tips.map(x => h('div', { class: 'tip' }, h('span', { class: 'tip-icon', 'aria-hidden': 'true' }, '💡'), h('p', {}, x)))),
  );
}

function budgetLine(l, ctx) {
  const input = h('input', {
    class: 'money-input', type: 'text', inputmode: 'numeric', value: fmtNum(l.amount), 'aria-label': t('{x}: tutar', { x: l.label }),
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
      h('div', { class: 'muted small' }, l.overridden ? t('Elle girildi · otomatik hesap: {p}', { p: fmtMoney(l.auto) }) : l.detail),
      l.overridden && h('button', { class: 'link-btn', onclick: () => { delete ctx.trip.budgetOverrides[l.key]; ctx.save(); ctx.rerender(); } }, t('Otomatiğe dön'))),
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
      h('a', { href: d.url, target: '_blank', rel: 'noopener', class: 'small' }, wikiMoreLabel(d))));
  }

  if (trip.weather?.days) {
    const archive = trip.weather.source === 'archive';
    body.append(h('section', { class: 'card' },
      h('h2', { class: 'h-sec' }, archive ? t('Hava (geçen yıl aynı günler)') : t('Hava tahmini')),
      archive && h('p', { class: 'muted small' }, t('Gezine 16 günden fazla var. Fikir vermesi için geçen yılın aynı günleri gösteriliyor; gezi yaklaşınca gerçek tahmin gelir.')),
      h('div', { class: 'wx-list' }, trip.days.map(day => {
        const w = trip.weather.days[day.date];
        if (!w) return null;
        const [icon, label] = WX(w.code);
        return h('div', { class: 'wx-row' },
          h('span', {}, fmtDay(day.date)),
          h('span', {}, `${icon} ${label}`),
          h('span', {}, `${Math.round(w.tmin)}° / ${Math.round(w.tmax)}°`),
          h('span', { class: 'muted' }, w.pop != null ? `${w.pop}%` : w.rain != null ? `${w.rain} mm` : ''));
      }))));
  } else if (trip.endDate >= todayISO()) {
    body.append(h('div', { class: 'note' }, t('Hava bilgisi şu an alınamadı; internet varken gezi sayfasını açınca güncellenir.')));
  }

  if (trip.country) {
    const c = trip.country;
    body.append(h('section', { class: 'card' },
      h('h2', { class: 'h-sec' }, t('Ülke bilgisi · {c}', { c: c.name })),
      h('dl', { class: 'kv' },
        c.capital && [h('dt', {}, t('Başkent')), h('dd', {}, c.capital)],
        c.currencies.length && [h('dt', {}, t('Para birimi')), h('dd', {}, c.currencies.join(', '))],
        c.languages.length && [h('dt', {}, t('Dil')), h('dd', {}, c.languages.join(', '))],
        c.driveSide && [h('dt', {}, t('Trafik')), h('dd', {}, c.driveSide === 'left' ? t('Soldan akar') : t('Sağdan akar'))],
        c.idd && [h('dt', {}, t('Telefon kodu')), h('dd', {}, c.idd)])));
  }

  body.append(h('section', {},
    h('h2', { class: 'h-sec' }, t('Dikkat edilecekler')),
    buildTips(trip, ctx.settings).map(tip => h('div', { class: `tip ${tip.level}` },
      h('span', { class: 'tip-icon', 'aria-hidden': 'true' }, tip.icon),
      h('div', {}, h('b', {}, tip.title), h('p', {}, tip.text))))));

  const q = encodeURIComponent(trip.dest.name);
  const lang = getLang();
  body.append(h('section', { class: 'card' },
    h('h2', { class: 'h-sec' }, t('Daha fazlası')),
    h('div', { class: 'menu' },
      lang !== 'en' && linkBtn(`📘 ${t('Wikivoyage gezi rehberi')} (${lang.toUpperCase()})`, `https://${lang}.wikivoyage.org/w/index.php?search=${q}`, 'menu-item'),
      linkBtn(`📗 ${t('Wikivoyage gezi rehberi')} (EN)`, `https://en.wikivoyage.org/w/index.php?search=${q}`, 'menu-item'),
      linkBtn('🗺️ ' + t("Bölgeyi Google Maps'te aç"), `https://www.google.com/maps/@${trip.dest.lat},${trip.dest.lon},13z`, 'menu-item'))));
}
