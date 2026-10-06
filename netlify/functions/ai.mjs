// Rota YZ ara sunucusu (Netlify Function).
// Claude API anahtarı burada, Netlify ortam değişkeninde durur; uygulamanın koduna (herkese açık) hiç girmez.
// Yalnızca tanımlı işler yapılır (gezi isteğini anlamak, günlük rehber yazmak); serbest soru sorulamaz.
//
// Netlify'da ayarlanacak ortam değişkenleri:
//   ANTHROPIC_API_KEY   console.anthropic.com'dan alınan anahtar
//   ROTA_ACCESS_CODE    uygulamada Ayarlar > Yapay zekâ'ya girilen erişim kodu (kendi belirlediğin bir parola)
//   AI_MODEL            (isteğe bağlı) varsayılan: claude-haiku-4-5-20251001

const API = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const ALLOWED_ORIGINS = ['https://alanmett.github.io', 'http://localhost:8080'];
const LANG_NAMES = { tr: 'Turkish', en: 'English', fr: 'French' };
const INTERESTS = ['tarihi', 'muze', 'dogal', 'manzara', 'dini', 'plaj', 'park', 'aile', 'sarap', 'alisveris'];

const env = name => (globalThis.Netlify?.env?.get?.(name) ?? process.env[name] ?? '').trim();

function corsHeaders(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[\w-]+\.netlify\.app$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'content-type, x-rota-code',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } });

// Zamanlamaya dayalı tahmini zorlaştırmak için sabit süreli karşılaştırma
function sameText(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function callClaude({ system, user, tool, maxTokens }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9500); // Netlify'ın 10 sn sınırından önce temiz hata
  let r;
  try {
    r = await fetch(API, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env('AI_MODEL') || DEFAULT_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
        ...(tool ? { tools: [tool], tool_choice: { type: 'tool', name: tool.name } } : {}),
      }),
    });
  } catch (e) {
    throw Object.assign(new Error('timeout'), { code: e.name === 'AbortError' ? 'timeout' : 'network' });
  } finally {
    clearTimeout(timer);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message || '';
    const code = r.status === 401 ? 'bad_key'
      : r.status === 429 ? 'rate_limited'
      : r.status === 529 || r.status === 503 ? 'overloaded'
      : /credit balance/i.test(msg) ? 'no_credit'
      : 'upstream';
    throw Object.assign(new Error(msg || code), { code });
  }
  if (!tool) return { ok: true };
  const block = data.content?.find(b => b.type === 'tool_use');
  if (!block) throw Object.assign(new Error('no tool output'), { code: 'upstream' });
  return block.input;
}

// ---------- 1. Gezi isteğini anlamak ----------
const TRIP_TOOL = {
  name: 'trip_request',
  description: 'Structured version of the user\'s trip request, used to fill the trip planner form.',
  input_schema: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['tek', 'rota'], description: 'tek = one town/region as base; rota = several places visited in sequence' },
      places: {
        type: 'array', maxItems: 10,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Geocodable town or city name. For a region, use its typical base town (Kapadokya → Göreme, Toskana → Siena, Lavaux → Cully).' },
            country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code, lowercase' },
            nights: { type: 'integer', minimum: 0, maximum: 14, description: 'Only for rota: nights to stay there (0 = short stop on the way)' },
          },
          required: ['name', 'country'],
        },
      },
      startHome: { type: 'boolean', description: 'rota: the trip starts from the user\'s home' },
      back: { type: 'boolean', description: 'rota: return to the start at the end' },
      startDate: { type: 'string', description: 'YYYY-MM-DD; resolve relative dates from today; if not given, the next Saturday' },
      days: { type: 'integer', minimum: 1, maximum: 14, description: 'tek: number of days' },
      adults: { type: 'integer', minimum: 1, maximum: 20 },
      children: { type: 'integer', minimum: 0, maximum: 10 },
      elderly: { type: 'boolean' },
      pet: { type: 'boolean' },
      transport: { type: 'string', enum: ['araba', 'toplu', 'yuruyus'], description: 'araba = car, toplu = public transport, yuruyus = on foot' },
      interests: {
        type: 'array', items: { type: 'string', enum: INTERESTS },
        description: 'tarihi=history, muze=museums, dogal=nature, manzara=viewpoints, dini=religious buildings, plaj=beaches, park=parks & gardens, aile=family fun, sarap=wineries/breweries/distilleries, alisveris=shopping',
      },
      pace: { type: 'string', enum: ['rahat', 'normal', 'yogun'], description: 'relaxed / normal / intense' },
      food: { type: 'string', enum: ['piknik', 'ekonomik', 'orta', 'konforlu'], description: 'self-catering / budget / mid-range restaurants / upscale' },
      stay: { type: 'string', enum: ['kamp', 'hostel', 'ekonomik', 'orta', 'konforlu', 'yok'], description: 'camping / hostel / budget hotel / mid hotel / comfortable hotel / none (friends, relatives)' },
      hidden: { type: 'boolean', description: 'true if the user prefers lesser-known, quiet, off-the-beaten-path places' },
      summary: { type: 'string', description: 'One short sentence, in the user\'s language, saying what you understood' },
      unclear: { type: 'string', description: 'Optional, in the user\'s language: what was unclear or assumed (empty if nothing)' },
    },
    required: ['mode', 'places', 'summary'],
  },
};

async function parseTrip(p) {
  const text = String(p.text || '').slice(0, 1200).trim();
  if (!text) throw Object.assign(new Error('empty'), { code: 'bad_request' });
  const lang = LANG_NAMES[p.lang] || 'Turkish';
  const system = [
    'You turn a traveller\'s free-text wish into a structured request for the Rota trip planner app.',
    `Today is ${p.today} (${p.weekday}). The user lives in country "${p.homeCountry}" and ${p.hasHome ? 'has' : 'has not'} saved a home location.`,
    `Write "summary" and "unclear" in ${lang}.`,
    'Only fill fields the user stated or clearly implied; leave the rest out (the app has defaults).',
    'Use mode "rota" when the user names several towns to visit one after another; use "tek" for a single town or region.',
    'For rota: if nights per place are not given, use 1 for small towns, 2 for big cities or rich regions, and 0 for places described as a quick stop on the way.',
    'If the user mentions starting from home and has a home location, set startHome true.',
    'Never invent places the user did not ask for. Do not plan the trip yourself; the app does that with real data.',
  ].join('\n');
  return callClaude({ system, user: text, tool: TRIP_TOOL, maxTokens: 800 });
}

// ---------- 2. Günlük rehber ----------
const DAY_TOOL = {
  name: 'day_guide',
  description: 'A short, local, practical guide text for one day of the trip.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Evocative title for the day, max 8 words' },
      text: { type: 'string', description: '2 short paragraphs (90–150 words total) about the day\'s places: why they matter, what to notice, how the day flows' },
      dishes: {
        type: 'array', maxItems: 3,
        items: { type: 'object', properties: { name: { type: 'string' }, note: { type: 'string', description: 'max 12 words' } }, required: ['name', 'note'] },
        description: 'Local dishes or drinks typical of this specific region worth trying today',
      },
      tip: { type: 'string', description: 'One practical insider tip for this day (max 30 words)' },
    },
    required: ['title', 'text', 'dishes', 'tip'],
  },
};

async function dayGuide(p) {
  const lang = LANG_NAMES[p.lang] || 'Turkish';
  const d = p.day || {};
  const stops = (d.stops || []).slice(0, 12).map(s => `- ${String(s.name).slice(0, 80)} (${String(s.type || '').slice(0, 40)})`).join('\n');
  const system = [
    'You are a knowledgeable local guide writing short day texts for the Rota travel app.',
    `Write everything in ${lang}. Warm, concrete and specific; no clichés, no emojis, no markdown.`,
    'Talk only about the places listed for the day and the area they are in. Never invent places, events or shops.',
    'Never state opening hours, prices, phone numbers, exact distances or travel times: the app shows real data for those.',
    'If you are not sure about a fact, leave it out.',
  ].join('\n');
  const user = [
    `Day ${d.n} of ${p.totalDays}, ${d.date} (${d.weekday}).`,
    d.where ? `Base / area: ${String(d.where).slice(0, 80)}.` : '',
    d.drive ? `Travel today: ${String(d.drive).slice(0, 80)}.` : '',
    d.weather ? `Weather: ${String(d.weather).slice(0, 60)}.` : '',
    `Travellers: ${String(p.travelers || '').slice(0, 80)}. Getting around: ${String(p.transport || '').slice(0, 30)}.`,
    stops ? `Places planned today, in order:\n${stops}` : 'No sightseeing planned today (mostly a travel day).',
  ].filter(Boolean).join('\n');
  return callClaude({ system, user, tool: DAY_TOOL, maxTokens: 700 });
}

const TASKS = {
  ping: () => callClaude({ system: 'Reply with OK.', user: 'ping', maxTokens: 1 }),
  parse: parseTrip,
  day: dayGuide,
};

export default async req => {
  const headers = corsHeaders(req.headers.get('origin') || '');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return json({ error: 'method' }, 405, headers);
  if (!env('ANTHROPIC_API_KEY') || !env('ROTA_ACCESS_CODE')) return json({ error: 'not_configured' }, 503, headers);
  if (!sameText(req.headers.get('x-rota-code') || '', env('ROTA_ACCESS_CODE'))) return json({ error: 'unauthorized' }, 401, headers);
  const raw = await req.text();
  if (raw.length > 30000) return json({ error: 'too_large' }, 413, headers);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'bad_request' }, 400, headers); }
  const task = TASKS[body.task];
  if (!task) return json({ error: 'bad_request' }, 400, headers);
  try {
    return json({ result: await task(body.payload || {}) }, 200, headers);
  } catch (e) {
    const code = e.code || 'upstream';
    console.error('ai', body.task, code, e.message);
    return json({ error: code }, code === 'bad_request' ? 400 : 502, headers);
  }
};
