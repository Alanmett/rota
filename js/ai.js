// Yapay zekâ: Netlify'daki ara sunucu üzerinden Claude'a sorar (anahtar sunucuda durur, uygulamada değil).
// YZ verinin yerine geçmez: yerler, saatler, yollar ve fiyatlar gerçek kaynaklardan gelir; YZ isteği anlar ve anlatır.

import { getSettings } from './store.js';
import { t, getLang } from './i18n.js';
import { parseISODate, todayISO } from './util.js';

// Netlify'da açılacak sitenin adresi (Ayarlar'dan değiştirilebilir)
export const DEFAULT_AI_ENDPOINT = 'https://rota-alanmett.netlify.app/.netlify/functions/ai';

function endpoint() {
  const s = getSettings();
  if (s.aiEndpoint) {
    const u = s.aiEndpoint.trim().replace(/\/+$/, '');
    return /\/\.netlify\/functions\/ai$/.test(u) ? u : `${u}/.netlify/functions/ai`;
  }
  // Uygulama Netlify'daki kopyasından açıldıysa aynı sitedeki sunucu
  if (location.hostname.endsWith('.netlify.app')) return '/.netlify/functions/ai';
  return DEFAULT_AI_ENDPOINT;
}

export const aiReady = () => !!getSettings().aiCode;

const ERRORS = {
  unauthorized: () => t('Erişim kodu yanlış. Ayarlar > Yapay zekâ bölümünden kontrol et.'),
  not_configured: () => t("YZ sunucusu henüz ayarlanmamış (Netlify'da anahtar ya da erişim kodu eksik)."),
  bad_key: () => t("Claude API anahtarı geçersiz. Netlify'daki ANTHROPIC_API_KEY değerini kontrol et."),
  no_credit: () => t('Claude API hesabında kredi kalmamış. console.anthropic.com > Billing bölümünden yükleyebilirsin.'),
  rate_limited: () => t('Çok sık istek gönderildi; biraz bekleyip tekrar dene.'),
  overloaded: () => t('YZ şu an çok yoğun; biraz sonra tekrar dene.'),
  timeout: () => t('YZ zamanında yanıt vermedi; tekrar dene.'),
};

export async function aiCall(task, payload, timeoutMs = 20000) {
  const s = getSettings();
  if (!s.aiCode) throw new Error(t('YZ özelliklerini kullanmak için Ayarlar > Yapay zekâ bölümüne erişim kodunu gir.'));
  if (!navigator.onLine) throw new Error(t('YZ için internet bağlantısı gerekli.'));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let r;
  try {
    r = await fetch(endpoint(), {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-rota-code': s.aiCode },
      body: JSON.stringify({ task, payload }),
    });
  } catch {
    throw new Error(t('YZ sunucusuna ulaşılamadı. Netlify sitesinin adresini ve internet bağlantını kontrol et.'));
  } finally {
    clearTimeout(timer);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error((ERRORS[data.error] || (() => t('YZ isteği başarısız oldu ({e}).', { e: data.error || r.status })))());
  return data.result;
}

const weekday = iso => new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(parseISODate(iso));

// Serbest metin → planlama formu için yapılandırılmış istek
export function aiParseTrip(text) {
  const s = getSettings();
  return aiCall('parse', { text, lang: getLang(), today: todayISO(), weekday: weekday(todayISO()), homeCountry: s.homeCountry, hasHome: !!s.home });
}

// Bir günün kısa rehber metni. Gezinin yalnızca gerekli kısmı gönderilir (ev konumu gönderilmez).
export function aiDayGuide(trip, di, ctx) {
  const day = trip.days[di];
  const where = day.sleep?.name || day.to?.name || trip.dest?.name || '';
  return aiCall('day', {
    lang: getLang(),
    totalDays: trip.days.length,
    travelers: ctx.travelers,
    transport: ctx.transport,
    day: {
      n: di + 1, date: day.date, weekday: weekday(day.date), where,
      drive: ctx.drive || '', weather: ctx.weather || '',
      stops: day.stops.map(id => trip.places[id]).filter(Boolean).map(p => ({ name: p.name, type: ctx.typeOf(p) })),
    },
  });
}

// Rehber yazıldıktan sonra günün durakları değiştiyse metin eskimiştir
export const guideSig = day => day.stops.join(',');
