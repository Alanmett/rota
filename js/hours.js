// OSM "opening_hours" alanı için sade bir çözümleyici.
// Yaygın biçimleri anlar: "Tu-Su 09:00-17:00; Mo off", "Apr-Oct: Mo-Su 08:00-19:00",
// "24/7", "sunrise-sunset", "PH off". Anlamadığı biçimde "bilinmiyor" döner, uydurmaz.

import { fmtClock } from './util.js';

const DAY = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const MON_RE = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const MONTH_TOKEN = new RegExp(`^${MON_RE}`);
const MONTH_PART = new RegExp(`^(${MON_RE})(\\d{1,2})?(?:-(${MON_RE})?(\\d{1,2})?)?$`);
const SUN = { sunrise: 390, dawn: 360, sunset: 1140, dusk: 1170 };

function parseTime(s) {
  if (SUN[s] != null) return SUN[s];
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error('saat');
  return +m[1] * 60 + +m[2];
}

function parseTimes(tok) {
  return tok.split(',').map(part => {
    if (part.endsWith('+') && !part.includes('-')) return [parseTime(part.slice(0, -1)), 1440];
    const m = part.match(/^([\w:]+)-([\w:]+)\+?$/);
    if (!m) throw new Error('aralık');
    const a = parseTime(m[1]);
    let b = parseTime(m[2]);
    if (b <= a) b += 1440; // gece yarısını geçen saatler
    return [a, b];
  });
}

function dayMatch(sel, dow) {
  for (const raw of sel.split(',')) {
    const p = raw.replace(/\[[^\]]*\]/g, '');
    if (p === 'PH' || p === 'SH') continue;
    const m = p.match(/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/);
    if (!m) throw new Error('gün');
    const a = DAY[m[1]], b = m[2] != null ? DAY[m[2]] : a;
    if (a <= b ? dow >= a && dow <= b : dow >= a || dow <= b) return true;
  }
  return false;
}

function monthMatch(sel, date) {
  const md = date.getMonth() * 100 + date.getDate();
  for (const part of sel.split(',')) {
    const m = part.match(MONTH_PART);
    if (!m) throw new Error('ay');
    const sM = MON[m[1]], sD = m[2] ? +m[2] : 1;
    if (!part.includes('-')) {
      if (m[2] ? md === sM * 100 + sD : date.getMonth() === sM) return true;
      continue;
    }
    const eM = m[3] != null ? MON[m[3]] : sM, eD = m[4] ? +m[4] : 31;
    const s = sM * 100 + sD, e = eM * 100 + eD;
    if (s <= e ? md >= s && md <= e : md >= s || md <= e) return true;
  }
  return false;
}

function evaluate(spec, date) {
  const s = spec.replace(/"[^"]*"/g, '').trim();
  if (s === '24/7') return { known: true, open: true, ranges: [[0, 1440]] };
  const dow = date.getDay();
  let result = null;
  for (let rule of s.split(/\s*(?:;|\|\|)\s*/)) {
    rule = rule.trim();
    if (!rule) continue;
    rule = rule
      .replace(/\s*([,-])\s*/g, '$1')
      .replace(new RegExp(`(${MON_RE})\\s+(\\d{1,2})(?=\\D|$)`, 'g'), '$1$2')
      .replace(/:\s+/g, ' ')
      .replace(/^24\/7/, '00:00-24:00');
    let monthSel = null, daySel = null, times = null, closed = false;
    for (const t of rule.split(/\s+/)) {
      if (MONTH_TOKEN.test(t)) { monthSel = t.replace(/:$/, ''); continue; }
      if (/^(Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)/.test(t)) { daySel = t.replace(/:$/, ''); continue; }
      if (/^(off|closed)$/i.test(t)) { closed = true; continue; }
      if (/^open$/i.test(t)) continue;
      if (/^(\d{1,2}:\d{2}|sunrise|sunset|dawn|dusk)/.test(t)) { times = parseTimes(t); continue; }
      throw new Error('desteklenmeyen');
    }
    if (daySel && /^(PH|SH)(,(PH|SH))*$/.test(daySel.replace(/\[[^\]]*\]/g, ''))) continue; // sadece tatil kuralı
    if (monthSel && !monthMatch(monthSel, date)) continue;
    if (daySel && !dayMatch(daySel, dow)) continue;
    result = closed ? { known: true, open: false, ranges: [] } : { known: true, open: true, ranges: times || [[0, 1440]] };
  }
  return result || { known: true, open: false, ranges: [] };
}

export function hoursOn(spec, date) {
  if (!spec) return { known: false };
  try { return evaluate(spec, date); } catch { return { known: false }; }
}

export function isOpenAt(spec, date) {
  const r = hoursOn(spec, date);
  if (!r.known) return null;
  const m = date.getHours() * 60 + date.getMinutes();
  return r.open && r.ranges.some(([a, b]) => m >= a && m < b);
}

export const fmtRanges = rs => rs.map(([a, b]) => `${fmtClock(a)}–${fmtClock(b > 1440 ? b - 1440 : b)}`).join(', ');
