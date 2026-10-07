// Paylaşma: gezi planını (ya da hazırlık listesini) okunaklı metin olarak WhatsApp, e-posta vb. ile gönderir;
// günleri takvim dosyası (.ics) olarak verir. Ev konumu hiçbir yere yazılmaz.

import { h, toast, openSheet } from './ui.js';
import { computeTimeline, gmapsDayLink, TRANSPORTS } from './planner.js';
import { computeBudget } from './budget.js';
import { fmtDur, fmtClock, fmtMoney, fmtRange, fmtDayLong, parseISODate, toISODate } from './util.js';
import { t } from './i18n.js';

const APP_URL = 'https://alanmett.github.io/rota/';

export function tripText(trip, settings) {
  const tr = trip.travelers;
  const nights = trip.route ? trip.days.filter(d => d.sleep).length : trip.days.length - 1;
  const who = [t('{n} yetişkin', { n: tr.adults }), tr.children ? t('{n} çocuk', { n: tr.children }) : null].filter(Boolean).join(', ');
  const tp = TRANSPORTS[trip.transport];
  const b = computeBudget(trip, settings);
  const place = trip.dest.label || trip.dest.name;
  const lines = [
    `🗺️ ${trip.name}`,
    place !== trip.name ? `📍 ${place}` : null,
    `📅 ${fmtRange(trip.startDate, trip.endDate)} · ${trip.days.length === 1 ? t('Günübirlik') : t('{d} gün, {n} gece', { d: trip.days.length, n: nights })} · ${who}`,
    `${tp.emoji} ${tp.label}`,
    `💰 ${t('Tahmini maliyet')}: ${fmtMoney(b.total)} (${t('kişi başı ~{p}', { p: fmtMoney(b.perPerson) })})`,
  ].filter(Boolean);
  trip.days.forEach((day, di) => {
    const where = trip.route ? day.sleep?.name || day.to?.name : '';
    lines.push('', `— ${t('{n}. gün', { n: di + 1 })} · ${fmtDayLong(day.date)}${where ? ` · ${where}` : ''} —`);
    for (const it of computeTimeline(trip, di).items) {
      if (it.kind === 'stop') lines.push(`${fmtClock(it.start)} ${it.place.name}`);
      else if (it.kind === 'lunch') lines.push(`${fmtClock(it.start)} 🍽️ ${t('Öğle yemeği')}${day.lunch?.[0] ? ` (${day.lunch[0].name})` : ''}`);
      else if (it.kind === 'leg' && it.road) lines.push(`🚗 ${it.to || ''} · ${fmtDur(it.min)}`);
      else if (it.kind === 'sleep') lines.push(`🛏️ ${t('Gece: {p}', { p: it.place.name })}`);
      else if (it.kind === 'end') lines.push(`🏁 ${t('Varış: {p}', { p: it.place.name })}`);
    }
    if (!day.stops.length && !trip.route) lines.push(t('Serbest gün'));
    const link = gmapsDayLink(trip, di);
    if (link) lines.push(`🧭 ${t('Günün rotası')}: ${link}`);
  });
  lines.push('', t('Rota ile planlandı · {u}', { u: APP_URL }));
  return lines.join('\n');
}

// Paylaşım menüsü (telefonda WhatsApp, Mesajlar, e-posta…); yoksa panoya kopyalar, o da olmazsa metni gösterir
export async function shareText(title, text) {
  if (navigator.share) {
    try { await navigator.share({ title, text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast(t('Panoya kopyalandı; istediğin yere yapıştırabilirsin.'), 3500);
  } catch {
    const ta = h('textarea', { class: 'ai-text', rows: '12', readonly: true }, text);
    openSheet(h('div', {}, h('h2', { class: 'sheet-title' }, title), h('p', { class: 'muted small' }, t('Metni seçip kopyala.')), ta));
    requestAnimationFrame(() => ta.select());
  }
}

// ---- Takvim (.ics) ----
const icsEscape = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// RFC 5545: satırlar 75 baytı geçmesin; devam satırları boşlukla başlar (çok baytlı harfler bölünmesin diye karakterle)
const fold = line => {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > 73) { out.push(cur); cur = ' ' + ch; } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
};
const ymd = iso => iso.replace(/-/g, '');

export function tripICS(trip) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const ev = trip.days.map((day, di) => {
    const next = parseISODate(day.date); next.setDate(next.getDate() + 1);
    const where = (trip.route ? day.sleep?.name || day.to?.name : trip.dest.name) || '';
    const plan = computeTimeline(trip, di).items.filter(x => x.kind === 'stop').map(x => `${fmtClock(x.start)} ${x.place.name}`);
    const link = gmapsDayLink(trip, di);
    return [
      'BEGIN:VEVENT',
      `UID:${trip.id}-${di}@rota`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(day.date)}`,
      `DTEND;VALUE=DATE:${ymd(toISODate(next))}`,
      `SUMMARY:${icsEscape(`${trip.name} · ${t('{n}. gün', { n: di + 1 })}${where ? ` · ${where}` : ''}`)}`,
      where ? `LOCATION:${icsEscape(where)}` : null,
      `DESCRIPTION:${icsEscape([...plan, link ? `${t('Günün rotası')}: ${link}` : null].filter(Boolean).join('\n'))}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    ].filter(Boolean).map(fold).join('\r\n');
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rota//Gezi planlayici//TR', 'CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR', ''].join('\r\n');
}

export function downloadICS(trip) {
  const url = URL.createObjectURL(new Blob([tripICS(trip)], { type: 'text/calendar;charset=utf-8' }));
  const name = (trip.name || 'rota').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'rota';
  const a = h('a', { href: url, download: `${name}.ics` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(t('Takvim dosyası indirildi; açınca günler takvimine eklenir.'), 4000);
}
