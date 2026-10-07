// Gezi ekranı: Plan · Harita · Bütçe · Hazırlık · Bilgiler

import { h, fill, toast, openSheet, closeSheet, setTitle, onLeave, linkBtn, emptyState, tappable, spinner } from '../ui.js';
import { buildPacking, packState, packingProgress, PACK_CATS } from '../packing.js';
import { tripText, shareText, downloadICS } from '../share.js';
import { getTrip, saveTrip, deleteTrip, getSettings } from '../store.js';
import { computeTimeline, gmapsDayLink, gmapsDir, bestInsertIndex, PACES, TRANSPORTS, LEG_EMOJI } from '../planner.js';
import { computeBudget, STAYS, stayOf, FOODS, foodOf, savingTips, factorNote, destCurrency, ticketInfo } from '../budget.js';
import { tripTips } from '../tips.js';
import { refreshWeather, addParking } from '../tripgen.js';
import { typeLabel, catEmoji, cuisineLabel } from '../places.js';
import { showPlaceDetail, wikiMoreLabel, parkLink } from '../details.js';
import { wxPill } from '../components.js';
import { createMap, numIcon, emojiIcon, meIcon, popupFor, DAY_COLORS } from '../map.js';
import { WX, exchangeRate, countryInfo, staySafeFor } from '../api.js';
import { aiReady, aiDayGuide, aiSafety, guideSig } from '../ai.js';
import { fmtDur, fmtKm, fmtClock, fmtMoney, fmtNum, fmtDay, fmtDayLong, fmtRange, todayISO, currencySymbol } from '../util.js';
import { t, getLang, locale } from '../i18n.js';

const TABS = [['plan', t('Plan')], ['harita', t('Harita')], ['butce', t('Bütçe')], ['hazirlik', t('Hazırlık')], ['bilgi', t('Bilgiler')]];
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
  const render = { plan: renderPlanTab, harita: renderMapTab, butce: renderBudgetTab, hazirlik: renderPackTab, bilgi: renderInfoTab }[tab] || renderPlanTab;
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
  if (tab === 'bilgi') { maybeAddCountry(ctx); maybeLoadSafety(ctx); }
}

// ---- Güvenlik (Wikivoyage "Stay safe" + YZ özeti) ----
const SAFETY_ICON = { theft: '👜', scam: '🎭', traffic: '🚦', night: '🌙', nature: '⛰️', health: '🩺', transport: '🚆', other: '⚠️' };

function safetyPlaces(trip) {
  if (trip.route) return trip.route.cities.filter(c => c.nights > 0).slice(0, 6).map(c => ({ key: c.key, name: c.name, wikidata: c.wikidata, cc: c.cc }));
  return [{ key: 'dest', name: trip.dest.name, wikidata: trip.dest.wikidata, cc: trip.dest.cc }];
}

async function maybeLoadSafety(ctx) {
  const { trip } = ctx;
  if (!navigator.onLine) return;
  trip.safety ||= {};
  const needs = s => !s || (!s.none && aiReady() && (!s.items || s.lang !== getLang()));
  const todo = safetyPlaces(trip).filter(p => needs(trip.safety[p.key]));
  if (!todo.length) return;
  ctx.safetyLoading = true;
  if (ctx.body.isConnected) ctx.rerender();
  for (const p of todo) {
    try {
      const src = await staySafeFor(p);
      if (!src) { trip.safety[p.key] = { place: p.name, none: true, at: Date.now() }; continue; }
      const base = { place: p.name, title: src.title, scope: src.scope, url: src.url, at: Date.now() };
      // Aynı kaynak (ör. iki şehir için aynı ülke sayfası) zaten özetlendiyse YZ'ye tekrar sorma
      const same = Object.values(trip.safety).find(s => s.title === src.title && s.items && s.lang === getLang());
      if (same) { trip.safety[p.key] = { ...same, place: p.name }; continue; }
      if (aiReady()) {
        try {
          const r = await aiSafety(src.title, src.scope, src.text);
          trip.safety[p.key] = { ...base, summary: String(r.summary || ''), items: (r.items || []).slice(0, 6), lang: getLang() };
          continue;
        } catch (e) { base.error = e.message; }
      }
      trip.safety[p.key] = { ...base, excerpt: src.text.slice(0, 700) };
    } catch { /* bir sonraki açılışta yeniden denenir */ }
  }
  ctx.safetyLoading = false;
  ctx.save();
  if (ctx.body.isConnected) ctx.rerender();
}

function safetySection(ctx) {
  const { trip } = ctx;
  const seen = new Set(), cards = [];
  for (const p of safetyPlaces(trip)) {
    const s = trip.safety?.[p.key];
    if (!s || s.none || seen.has(s.title)) continue;
    seen.add(s.title);
    cards.push(h('section', { class: 'card safety' },
      h('h2', { class: 'h-sec' }, '🛡️ ' + t('Güvenlik · {p}', { p: s.scope === 'country' ? s.title : p.name })),
      s.summary && h('p', {}, s.summary),
      s.items?.length > 0 && h('div', { class: 'safety-list' }, s.items.map(i => h('div', { class: 'tip' },
        h('span', { class: 'tip-icon', 'aria-hidden': 'true' }, SAFETY_ICON[i.topic] || '⚠️'),
        h('div', {}, h('b', {}, i.title), h('p', {}, i.text))))),
      s.excerpt && h('p', { class: 'small' }, s.excerpt + '…'),
      s.excerpt && h('p', { class: 'muted small' }, s.error ? '⚠️ ' + s.error
        : t('Metin İngilizce. YZ açıksa senin dilinde kısa maddeler halinde özetlenir (Ayarlar > Yapay zekâ).')),
      s.scope === 'country' && h('p', { class: 'muted small' }, t('Bu yer için ayrı bilgi yok; ülke geneli için olanlar gösteriliyor.')),
      h('p', { class: 'muted small' }, t('Kaynak: Wikivoyage ({x})', { x: s.title }) + (s.items ? ' · ' + t('YZ özeti') : '') + ' · ',
        h('a', { href: s.url, target: '_blank', rel: 'noopener' }, t('Tamamını oku') + ' ↗'))));
  }
  if (!cards.length && ctx.safetyLoading) return h('section', { class: 'card' }, spinner(t('Güvenlik bilgileri hazırlanıyor…')));
  return cards;
}

// Yurt dışı gezisinde ülke bilgisi alınamamışsa (servis o an yanıt vermediyse) yeniden dener.
async function maybeAddCountry(ctx) {
  const { trip, settings } = ctx;
  if (!navigator.onLine) return;
  if (trip.route) {
    trip.countries ||= {};
    const missing = [...new Set(trip.days.map(d => d.cc))].filter(cc => cc && cc !== settings.homeCountry && !trip.countries[cc]);
    if (!missing.length) return;
    await Promise.all(missing.map(cc => countryInfo(cc).then(c => { trip.countries[cc] = c; }).catch(() => {})));
    ctx.save();
    if (ctx.body.isConnected) ctx.rerender();
    return;
  }
  if (trip.country || !trip.dest.cc || trip.dest.cc === settings.homeCountry) return;
  try {
    trip.country = await countryInfo(trip.dest.cc);
    ctx.save();
    if (ctx.body.isConnected) ctx.rerender();
  } catch { /* bilgisiz devam */ }
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
  const nights = trip.route ? trip.days.filter(d => d.sleep).length : trip.days.length - 1;
  return h('section', { class: 'trip-head' },
    h('div', { class: 'muted small' }, `${trip.route ? '🗺️' : '📍'} ${trip.dest.label || trip.dest.name}`),
    h('div', { class: 'trip-meta' },
      h('span', {}, fmtRange(trip.startDate, trip.endDate)),
      h('span', {}, trip.days.length === 1 ? t('Günübirlik') : t('{d} gün, {n} gece', { d: trip.days.length, n: nights })),
      h('span', {}, who),
      h('span', {}, `${tp.emoji} ${tp.label}`),
      h('span', {}, PACES[trip.pace]?.label || ''),
      trip.hidden && h('span', {}, '🔎 ' + t('Az bilinen yerler'))),
    h('div', { class: 'btn-row trip-actions' },
      h('button', { class: 'btn small', type: 'button', onclick: () => shareText(trip.name, tripText(trip, getSettings())) }, '📤 ' + t('Paylaş')),
      h('button', { class: 'btn small', type: 'button', onclick: () => downloadICS(trip) }, '📅 ' + t('Takvime ekle'))));
}

// ---------------- Hazırlık ("Yanına al" listesi) ----------------
function renderPackTab(body, ctx) {
  const { trip, settings } = ctx;
  const st = packState(trip);
  const items = buildPacking(trip, settings);
  const custom = st.custom || [];
  const all = [...items.map(i => i.id), ...custom.map(c => c.id)];
  const count = h('b', {});
  const bar = h('progress', { max: String(all.length || 1) });
  const upd = () => {
    const n = all.filter(id => st.done[id]).length;
    count.textContent = t('{n}/{m} hazır', { n, m: all.length });
    bar.value = n;
  };
  const toggle = (id, on) => { if (on) st.done[id] = true; else delete st.done[id]; ctx.save(); upd(); };
  const row = (i, extra) => h('label', { class: 'check pack-item' },
    h('input', { type: 'checkbox', checked: !!st.done[i.id], onchange: e => toggle(i.id, e.target.checked) }),
    h('span', {}, i.text, i.note && h('small', { class: 'muted' }, i.note)),
    extra);

  const groups = Object.entries(PACK_CATS).map(([cat, c]) => {
    const list = items.filter(i => i.cat === cat);
    return list.length > 0 && h('section', { class: 'card pack-group' }, h('h2', { class: 'h-sec' }, `${c.emoji} ${c.label}`), list.map(i => row(i)));
  });

  const input = h('input', { type: 'text', maxlength: '80', placeholder: t('Ör. fotoğraf makinesi, dürbün…'), 'aria-label': t('Kendi maddeni ekle') });
  const addCustom = () => {
    const text = input.value.trim();
    if (!text) return;
    st.custom = [...(st.custom || []), { id: 'c' + Date.now().toString(36), text }];
    ctx.save(); ctx.rerender();
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } });
  const removeCustom = id => { st.custom = st.custom.filter(c => c.id !== id); delete st.done[id]; ctx.save(); ctx.rerender(); };

  const shareList = () => {
    const lines = [`🧳 ${trip.name} · ${t('Yanına al')}`];
    for (const [cat, c] of Object.entries(PACK_CATS)) {
      const list = items.filter(i => i.cat === cat);
      if (!list.length) continue;
      lines.push('', `${c.emoji} ${c.label}`, ...list.map(i => `${st.done[i.id] ? '☑' : '☐'} ${i.text}`));
    }
    if (custom.length) lines.push('', `✍️ ${t('Kendi eklediklerin')}`, ...custom.map(i => `${st.done[i.id] ? '☑' : '☐'} ${i.text}`));
    shareText(t('Yanına al'), lines.join('\n'));
  };

  fill(body,
    h('section', { class: 'card pack-head' },
      h('div', { class: 'cost-head' }, h('div', {}, h('div', { class: 'muted small' }, '🧳 ' + t('Yanına al')), count),
        h('button', { class: 'btn small', type: 'button', onclick: shareList }, '📤 ' + t('Paylaş'))),
      bar,
      h('p', { class: 'muted small' }, t('Liste gezinin ülkelerine, mevsimine, hava tahminine, aracına, kişilere ve planlanan yerlere göre hazırlandı; plan değişince kendini günceller.'))),
    groups,
    h('section', { class: 'card pack-group' },
      h('h2', { class: 'h-sec' }, '✍️ ' + t('Kendi eklediklerin')),
      custom.map(c => row(c, h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('{p}: sil', { p: c.text }), onclick: e => { e.preventDefault(); removeCustom(c.id); } }, '✕'))),
      h('div', { class: 'pack-add' }, input, h('button', { class: 'btn small', type: 'button', onclick: addCustom }, t('Ekle')))));
  upd();
}

// Rota özeti: şehirler sırasıyla, gece sayıları, yol süreleri ve konaklama araması
function routeCard(trip) {
  const r = trip.route;
  const seq = [r.start && { ...r.start, key: 's' }, ...r.cities, r.end && { ...r.end, key: 'e' }].filter(Boolean);
  const road = (a, b) => r.roads?.[`${a.key}>${b.key}`];
  const rows = [];
  seq.forEach((c, i) => {
    if (i > 0) {
      const rd = road(seq[i - 1], c);
      if (rd) rows.push(h('div', { class: 'rt-leg muted small' }, `${trip.transport === 'araba' ? '🚗' : '🚆'} ${fmtDur(rd.min)} · ${fmtKm(rd.km)}`));
    }
    const ends = c.key === 's' || c.key === 'e';
    rows.push(h('div', { class: 'rt-city' },
      h('span', { class: 'rt-dot' + (ends ? ' end' : ''), 'aria-hidden': 'true' }, ends ? '🏁' : String(+c.key + 1)),
      h('div', { class: 'rt-main' },
        h('b', {}, c.name),
        h('div', { class: 'muted small' }, ends ? (c.key === 's' ? t('Başlangıç') : t('Dönüş'))
          : c.nights ? t('{n} {n:gece|gece}', { n: c.nights }) : t('Yol üstü uğrama'))),
      !ends && c.nights > 0 && linkBtn('🛏️ ' + t('Konaklama ara'), `https://www.google.com/maps/search/${encodeURIComponent(t('otel'))}/@${c.lat},${c.lon},13z`, 'btn small')));
  });
  // Şehir listesi gerektiğinde açılır; kapalıyken tek satır özet (plan yukarıda başlasın)
  return h('details', { class: 'card route-card' },
    h('summary', { class: 'ov-row' },
      h('span', { class: 'ov-ico', 'aria-hidden': 'true' }, '🗺️'),
      h('div', { class: 'ov-main' },
        h('b', {}, t('Rota · {n} durak', { n: r.cities.length })),
        r.totalKm > 0 && h('div', { class: 'muted small' }, t('Toplam yol {km} · {d}', { km: fmtKm(r.totalKm), d: fmtDur(r.totalMin) }))),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '⌄')),
    r.reordered && h('p', { class: 'muted small' }, t('Duraklar en kısa yola göre yeniden sıralandı.')),
    h('div', { class: 'rt-list' }, rows),
    h('a', { class: 'cost-more small', href: `#/gezi/${trip.id}/harita` }, t('Rotayı haritada gör') + ' →'));
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
  ctx.budget = computeBudget(trip, ctx.settings);
  body.append(overviewCard(ctx));
  if (trip.route) body.append(routeCard(trip));
  trip.days.forEach((_, di) => body.append(dayCard(ctx, di)));
  const alts = altSection(ctx);
  if (alts) body.append(alts);
  body.append(h('div', { class: 'danger-zone' },
    h('button', { class: 'btn small', onclick: () => rename(ctx) }, '✏️ ' + t('Adını değiştir')),
    h('button', { class: 'btn small danger-text', onclick: () => remove(ctx) }, '🗑️ ' + t('Geziyi sil'))));
}

// Planın başında tek kart: maliyet, güvenlik ve YZ rehberi; her biri tek satır, ayrıntısı kendi sekmesinde.
// (Plan, telefonda ilk ekranda başlasın diye kısa tutuldu.)
function overviewCard(ctx) {
  const { trip, budget: b } = ctx;
  const parts = b.lines.filter(l => l.amount > 0).map(l => `${l.label} ${fmtMoney(l.amount)}`);
  if (b.buffer) parts.push(`${t('Beklenmedik giderler')} ${fmtMoney(b.buffer)}`);
  const open = b.lines.filter(l => !l.amount && !l.overridden).map(l => l.label); // otoyol, bilet, alışveriş gibi elle girilenler
  const nSafety = Object.values(trip.safety || {}).reduce((s, x) => s + (x.items?.length || 0), 0);
  const chev = h('span', { class: 'chev', 'aria-hidden': 'true' }, '›');
  return h('section', { class: 'card overview' },
    h('a', { class: 'ov-row', href: `#/gezi/${trip.id}/butce` },
      h('span', { class: 'ov-ico', 'aria-hidden': 'true' }, '💰'),
      h('div', { class: 'ov-main' },
        h('div', { class: 'muted small' }, t('Tahmini maliyet')),
        h('b', { class: 'ov-big' }, fmtMoney(b.total)), h('span', { class: 'muted small' }, '  ' + t('kişi başı ~{p}', { p: fmtMoney(b.perPerson) }))),
      chev),
    (parts.length > 0 || open.length > 0) && h('details', { class: 'ov-details small' },
      h('summary', {}, t('Maliyet kalemleri')),
      parts.length > 0 && h('p', {}, parts.join(' · ')),
      open.length > 0 && h('p', { class: 'muted' }, t('Henüz dahil değil: {x}', { x: open.join(', ') }))),
    h('a', { class: 'ov-row', href: `#/gezi/${trip.id}/bilgi` },
      h('span', { class: 'ov-ico', 'aria-hidden': 'true' }, '🛡️'),
      h('div', { class: 'ov-main' },
        h('b', {}, t('Güvenlik ve dikkat edilecekler')),
        h('div', { class: 'muted small' }, nSafety ? t('{n} güvenlik uyarısı · hava · ülke bilgisi', { n: nSafety }) : t('Kapkaç, dolandırıcılık, hava, ülke bilgisi'))),
      chev.cloneNode(true)),
    h('a', { class: 'ov-row', href: `#/gezi/${trip.id}/hazirlik` },
      h('span', { class: 'ov-ico', 'aria-hidden': 'true' }, '🧳'),
      h('div', { class: 'ov-main' }, h('b', {}, t('Yanına al')), h('div', { class: 'muted small' }, t('{n}/{m} hazır', packingProgress(trip, ctx.settings)))),
      chev.cloneNode(true)),
    guideRow(ctx));
}

// ---- YZ gün rehberi ----
// YZ'ye gönderilen bilgi: günün yerleri, nerede olunduğu, yol, hava ve kişi sayısı (ev konumu gönderilmez)
function guideInput(trip, di) {
  const day = trip.days[di], tr = trip.travelers;
  const w = trip.weather?.days?.[day.date];
  const tl = computeTimeline(trip, di);
  const road = tl.items.filter(x => x.kind === 'leg' && x.road).reduce((s, x) => s + x.min, 0);
  return {
    travelers: `${tr.adults} adults${tr.children ? `, ${tr.children} children` : ''}${tr.elderly ? ', someone with limited mobility' : ''}${tr.pet ? ', a pet' : ''}`,
    transport: { araba: 'car', toplu: 'public transport', yuruyus: 'on foot' }[trip.transport] || trip.transport,
    drive: road ? `${day.from?.name || ''} → ${day.sleep?.name || day.to?.name || ''}, about ${Math.round(road / 60 * 10) / 10} h on the road` : '',
    weather: w ? `${Math.round(w.tmin)}–${Math.round(w.tmax)} °C, ${WX(w.code)[1]}${w.pop != null ? `, rain chance ${w.pop}%` : ''}${trip.weather.source === 'archive' ? ' (last year, indicative)' : ''}` : '',
    typeOf: p => typeLabel(p),
  };
}

async function writeGuides(ctx, days, onProgress) {
  const { trip } = ctx;
  trip.ai ||= { days: [] };
  let done = 0, err = null;
  for (let i = 0; i < days.length; i += 3) { // aynı anda en fazla 3 istek
    await Promise.all(days.slice(i, i + 3).map(async di => {
      try {
        const g = await aiDayGuide(trip, di, guideInput(trip, di));
        trip.ai.days[di] = { title: String(g.title || ''), text: String(g.text || ''), dishes: (g.dishes || []).slice(0, 3), tip: String(g.tip || ''), sig: guideSig(trip.days[di]) };
      } catch (e) { err = e; }
      onProgress?.(++done, days.length);
    }));
  }
  trip.ai.lang = getLang(); trip.ai.at = Date.now();
  ctx.save();
  return err;
}

function guideRow(ctx) {
  const { trip } = ctx;
  const has = trip.ai?.days?.some(Boolean);
  const head = (sub, extra) => h('div', { class: 'ov-row' },
    h('span', { class: 'ov-ico', 'aria-hidden': 'true' }, '✨'),
    h('div', { class: 'ov-main' }, h('b', {}, t('YZ gün rehberi')), h('div', { class: 'muted small' }, sub)),
    extra);
  if (!aiReady()) return head(h('a', { href: '#/ayarlar' }, t('Ayarlar > Yapay zekâ bölümünden aç') + ' →'));
  const status = h('span', { 'aria-live': 'polite' }, has
    ? t('Her günün başında (📖). YZ yazdı; hata içerebilir.')
    : t('Her gün için yerel rehber, yöresel lezzetler, ipucu'));
  const btn = h('button', { class: 'btn small' + (has ? '' : ' primary'), type: 'button', onclick: run }, has ? '↻' : t('Yaz'));
  if (has) btn.setAttribute('aria-label', t('Rehberi yeniden yaz'));
  async function run() {
    btn.disabled = true;
    status.textContent = t('YZ yazıyor…');
    const err = await writeGuides(ctx, trip.days.map((_, i) => i), (n, m) => { status.textContent = t('{n}/{m} gün yazıldı…', { n, m }); });
    if (err && !trip.ai.days.some(Boolean)) { status.textContent = '⚠️ ' + err.message; btn.disabled = false; return; }
    if (err) toast(t('Bazı günler yazılamadı: {e}', { e: err.message }), 5000);
    if (ctx.body.isConnected) ctx.rerender();
  }
  return head(status, btn);
}

function dayGuideBlock(ctx, di) {
  const g = ctx.trip.ai?.days?.[di];
  if (!g) return null;
  const stale = g.sig !== guideSig(ctx.trip.days[di]);
  const refresh = async e => {
    e.target.disabled = true; e.target.textContent = t('YZ yazıyor…');
    const err = await writeGuides(ctx, [di]);
    if (err) toast(err.message, 5000);
    if (ctx.body.isConnected) ctx.rerender();
  };
  return h('details', { class: 'day-guide' },
    h('summary', {}, '📖 ' + g.title),
    g.text.split(/\n+/).filter(Boolean).map(par => h('p', {}, par)),
    g.dishes.length > 0 && h('p', { class: 'small' }, h('b', {}, '🍽️ ' + t('Tadılacaklar') + ': '), g.dishes.map(d => `${d.name} — ${d.note}`).join(' · ')),
    g.tip && h('p', { class: 'small' }, '💡 ' + g.tip),
    stale && aiReady() && h('button', { class: 'link-btn', type: 'button', onclick: refresh }, t('Plan değişti; bu günün rehberini yenile')));
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
  if (day.from) { // rota: günün çıkış noktası (ev ya da önceki gecenin şehri)
    list.append(h('li', { class: 'tl-start' }, h('div', { class: 'tl-time' }, fmtClock(day.startMin)), h('div', { class: 'tl-num me', 'aria-hidden': 'true' }),
      h('div', { class: 'tl-body' }, h('div', { class: 'tl-meta' }, t('{p} çıkış', { p: day.from.name })))));
  }
  for (const it of tl.items) {
    if (it.kind === 'leg') {
      list.append(h('li', { class: 'tl-leg' + (it.road ? ' road' : '') }, h('span', { class: 'line' }),
        h('span', { class: 'txt' }, `${LEG_EMOJI[it.mode]} ${it.to ? it.to + ' · ' : ''}${fmtDur(it.min)} · ${fmtKm(it.km)}`)));
    } else if (it.kind === 'lunch') {
      list.append(mealItem(t('Öğle yemeği'), it.start, day.lunch));
    } else if (it.kind === 'sleep' || it.kind === 'end') {
      list.append(h('li', { class: 'tl-start' }, h('div', { class: 'tl-time' }, fmtClock(it.start)),
        h('div', { class: 'tl-num meal', 'aria-hidden': 'true' }, it.kind === 'sleep' ? '🛏️' : '🏁'),
        h('div', { class: 'tl-body' }, h('div', { class: 'tl-name' }, it.kind === 'sleep' ? t('Gece: {p}', { p: it.place.name }) : t('Varış: {p}', { p: it.place.name })))));
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
  const where = trip.route && (day.sleep?.name || day.to?.name);
  const longDrive = (day.drive || 0) > 480;
  return h('section', { class: 'day', style: `--day:${color(di)}` },
    h('header', { class: 'day-head' },
      h('div', {}, h('div', { class: 'day-num' }, dayLabel(di + 1) + (where ? ` · ${where}` : '')), h('div', { class: 'day-date' }, fmtDayLong(day.date))),
      wx && wxPill(wx, trip.weather.source)),
    longDrive && h('div', { class: 'note warn day-note' }, t('Bu gün {d} yol var. Arada bir şehirde gece kalmayı düşün.', { d: fmtDur(day.drive) })),
    dayGuideBlock(ctx, di),
    day.stops.length || (trip.route && tl.items.length) ? list : h('p', { class: 'muted day-empty' }, t('Bu güne henüz yer eklenmedi. Aşağıdaki "Vakit kalırsa" listesinden ekleyebilirsin.')),
    day.stops.length > 0 && h('footer', { class: 'day-foot' },
      h('span', {}, t('Gezi {v} · yol {r} · bitiş ~{e}', { v: fmtDur(tl.visitMin), r: fmtDur(tl.travelMin), e: fmtClock(tl.end) })),
      trip.days.length > 1 && ctx.budget && h('span', { class: 'day-cost' }, '💰 ' + t('Bu gün ~{p}', { p: fmtMoney(ctx.budget.perDay[di]) })),
      total > limit && h('span', { class: 'badge warn' }, t('Yoğun gün')),
      route && linkBtn('🗺️ ' + t('Günün rotası (Google Maps)'), route, 'btn small')));
}

// Giriş ücreti: tahmini kişi başı tutar, müze kartı ya da ücretsiz
function ticketText(p, ctx) {
  const ti = ticketInfo(p, ctx.trip, ctx.settings);
  if (ti?.card) return ` · 🎟️ ${ti.card}`;
  if (ti?.price) return ` · 🎟️ ${t('~{p}/kişi', { p: fmtMoney(ti.price) })}`;
  return p.tags?.fee === 'no' ? ` · ${t('ücretsiz')}` : '';
}

function stopItem(ctx, di, si, it, n) {
  const p = it.place;
  return h('li', { class: 'tl-stop' },
    h('div', { class: 'tl-time' }, fmtClock(it.start)),
    h('div', { class: 'tl-num', style: `background:${color(di)}` }, String(n)),
    tappable({ class: 'tl-body', onclick: () => showPlaceDetail(p, { date: ctx.trip.days[di].date }) },
      h('div', { class: 'tl-name' }, p.name),
      h('div', { class: 'tl-meta' }, `${catEmoji(p)} ${typeLabel(p)} · ~${fmtDur(p.dur)}${ticketText(p, ctx)}`),
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
        h('div', { class: 'muted small' }, `${typeLabel(p)} · ~${fmtDur(p.dur)}${trip.route?.cities?.[p.city] ? ' · ' + trip.route.cities[p.city].name : ''}`)),
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
    const r = trip.route;
    // Rota: gerçek yol çizgisi ve şehirler (numaralı); duraklar "Tümü"nde küçük simgelerle
    if (r && filter === 'all') {
      const seq = [r.start, ...r.cities, r.end].filter(Boolean);
      L.polyline(r.geo?.length ? r.geo : seq.map(c => [c.lat, c.lon]), { color: '#0f766e', weight: 5, opacity: 0.8 }).addTo(layer);
      r.cities.forEach(c => {
        const el = document.createElement('div');
        el.append(h('b', {}, c.name), h('div', { class: 'muted small' }, c.nights ? t('{n} {n:gece|gece}', { n: c.nights }) : t('Yol üstü uğrama')));
        L.marker([c.lat, c.lon], { icon: numIcon(+c.key + 1, '#0f766e'), zIndexOffset: 500 }).bindPopup(el).addTo(layer);
        bounds.push([c.lat, c.lon]);
      });
      if (r.start) { L.marker([r.start.lat, r.start.lon], { icon: meIcon() }).bindPopup(t('Başlangıç')).addTo(layer); bounds.push([r.start.lat, r.start.lon]); }
    }
    trip.days.forEach((d, di) => {
      if (filter !== 'all' && filter !== di) return;
      const pts = d.stops.map(id => trip.places[id]).filter(Boolean);
      if (r && filter === 'all') {
        pts.forEach(p => L.marker([p.lat, p.lon], { icon: emojiIcon(catEmoji(p)) })
          .bindPopup(popupFor(p, dayLabel(di + 1), () => showPlaceDetail(p, { date: d.date }))).addTo(layer));
        return;
      }
      const ends = [d.from, ...pts, d.to || (pts.length ? null : d.sleep)].filter(Boolean);
      const line = (di === 0 && trip.origin ? [trip.origin, ...pts] : r ? ends : pts).map(p => [p.lat, p.lon]);
      if (line.length > 1) L.polyline(line, { color: color(di), weight: 4, opacity: 0.75, dashArray: '6 8' }).addTo(layer);
      if (r) for (const e of [d.from, d.to, d.sleep].filter(Boolean)) {
        L.marker([e.lat, e.lon], { icon: emojiIcon(e === d.sleep ? '🛏️' : '🏁') }).bindPopup(e.name).addTo(layer);
        bounds.push([e.lat, e.lon]);
      }
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
  const multi = trip.route && new Set(trip.days.map(d => d.cc).filter(Boolean)).size > 1;
  const note = multi ? t('Rota birden fazla ülkeden geçiyor: konaklama, yemek ve diğer harcamalar her günün ülkesindeki fiyat seviyesine göre hesaplandı.')
    : trip.dest.cc ? factorNote(trip, settings, country) : null;
  const tips = savingTips(trip, settings);
  // Gidilen ülkenin parasıyla yaklaşık karşılık (ör. Fransa'da fiyatları euro olarak düşünenler için)
  const local = destCurrency(trip.dest.cc);
  const fx = h('div', { class: 'muted small' });
  if (local && local !== settings.currency) {
    exchangeRate(settings.currency, local).then(rate => {
      if (!rate || !fx.isConnected) return;
      const fmt = new Intl.NumberFormat(locale(), { style: 'currency', currency: local, maximumFractionDigits: 0 });
      fx.textContent = t('≈ {a} · kişi başı ≈ {b} (güncel kurla)', { a: fmt.format(b.total * rate), b: fmt.format(b.perPerson * rate) });
    });
  }
  fill(body,
    h('section', { class: 'card total-card' },
      h('div', { class: 'muted small' }, t('Tahmini toplam')),
      h('div', { class: 'big' }, fmtMoney(b.total)),
      h('div', { class: 'muted small' }, t('Kişi başı yaklaşık {p} · {n} kişi', { p: fmtMoney(b.perPerson), n: people })),
      fx),
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
const wikiCard = d => h('section', { class: 'card wiki-card' },
  d.thumb && h('img', { src: d.thumb, alt: '', class: 'wiki-thumb', loading: 'lazy' }),
  h('h2', {}, d.title),
  h('p', {}, d.extract),
  h('a', { href: d.url, target: '_blank', rel: 'noopener', class: 'small' }, wikiMoreLabel(d)));

const countryCard = c => h('section', { class: 'card' },
  h('h2', { class: 'h-sec' }, t('Ülke bilgisi · {c}', { c: c.name })),
  h('dl', { class: 'kv' },
    c.capital && [h('dt', {}, t('Başkent')), h('dd', {}, c.capital)],
    c.currencies.length && [h('dt', {}, t('Para birimi')), h('dd', {}, c.currencies.join(', '))],
    c.languages.length && [h('dt', {}, t('Dil')), h('dd', {}, c.languages.join(', '))],
    c.driveSide && [h('dt', {}, t('Trafik')), h('dd', {}, c.driveSide === 'left' ? t('Soldan akar') : t('Sağdan akar'))],
    c.idd && [h('dt', {}, t('Telefon kodu')), h('dd', {}, c.idd)]));

function renderInfoTab(body, ctx) {
  const { trip } = ctx;
  if (trip.route) {
    // Rotadaki her şehrin kısa tanıtımı
    for (const c of trip.route.cities) if (c.info) body.append(wikiCard(c.info));
  } else if (trip.destInfo) body.append(wikiCard(trip.destInfo));
  body.append(...[safetySection(ctx)].flat());

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

  if (trip.route) for (const c of Object.values(trip.countries || {})) body.append(countryCard(c));
  else if (trip.country) body.append(countryCard(trip.country));

  body.append(h('section', {},
    h('h2', { class: 'h-sec' }, t('Dikkat edilecekler')),
    tripTips(trip, ctx.settings).map(tip => h('div', { class: `tip ${tip.level}` },
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
