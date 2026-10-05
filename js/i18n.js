// Dil desteği. Kaynak dil Türkçe: t(metin) çevirisi varsa çeviriyi, yoksa Türkçeyi döndürür.
// Eksik çevirileri bulmak için: tools/i18n-check.ps1
// {ad} biçimindeki yer tutucular değişkenlerle doldurulur. Dil değişince sayfa yeniden yüklenir.

import en from './i18n/en.js';
import fr from './i18n/fr.js';

export const LANGS = { tr: 'Türkçe', en: 'English', fr: 'Français' };
const DICTS = { tr: null, en, fr };
const LOCALES = { tr: 'tr-TR', en: 'en-GB', fr: 'fr-CH' };

function detect() {
  try {
    const saved = JSON.parse(localStorage.getItem('rota.settings.v1'))?.lang;
    if (saved && LANGS[saved]) return saved;
    // Uygulamayı zaten kullanan biri (kayıtlı verisi olan) Türkçe başlamıştı; yeni kullanıcıda telefonun dili
    if (Object.keys(localStorage).some(k => k.startsWith('rota.'))) return 'tr';
  } catch { /* depolama yoksa telefonun diline bak */ }
  const n = (navigator.language || 'tr').slice(0, 2).toLowerCase();
  return LANGS[n] ? n : 'tr';
}

let lang = detect();
document.documentElement.lang = lang;

export const getLang = () => lang;
export const locale = () => LOCALES[lang];

// Çeviride tekil/çoğul: "{n} {n:night|nights}" → n=1 ise "night", değilse "nights" (Fransızcada 0 ve 1 tekil).
const singular = n => (lang === 'fr' ? Math.abs(n) < 2 : n === 1);

export function t(s, vars) {
  let out = DICTS[lang]?.[s] ?? s;
  if (vars) {
    out = out.replace(/\{(\w+):([^|}]*)\|([^}]*)\}/g, (m, k, one, many) => (vars[k] == null ? m : singular(Number(vars[k])) ? one : many));
    out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  }
  return out;
}
