// Ayarlar: dil, yaşanılan ülke, ev konumu, fiyatlar, indirim kartları, yedekleme.

import { h, toast, segmented, section } from '../ui.js';
import { getSettings, saveSettings, exportData, importData, COUNTRY_PRESETS } from '../store.js';
import { TRANSPORTS } from '../planner.js';
import { placeSearch } from '../components.js';
import { todayISO, setCurrency, currencySymbol } from '../util.js';
import { t, getLang, LANGS } from '../i18n.js';

export function renderSettings(root) {
  const s = getSettings();
  const persist = (msg = t('Kaydedildi')) => { saveSettings(s); toast(msg); };
  const rerender = () => { root.replaceChildren(); renderSettings(root); };

  const homeBox = h('div');
  const renderHome = () => homeBox.replaceChildren(s.home
    ? h('div', { class: 'picked' },
      h('span', { 'aria-hidden': 'true' }, '🏠'),
      h('div', {}, h('b', {}, s.home.label), h('div', { class: 'muted small' }, t('Arabayla gidişlerde yakıt ve süre buradan hesaplanır.'))),
      h('button', { class: 'icon-btn', 'aria-label': t('Ev konumunu kaldır'), onclick: () => { s.home = null; persist(t('Ev konumu kaldırıldı')); renderHome(); } }, '✕'))
    : placeSearch({ placeholder: t('Oturduğun şehir ya da semt'), onPick: r => { s.home = { lat: r.lat, lon: r.lon, label: r.label }; persist(t('Ev konumu kaydedildi')); renderHome(); } }));
  renderHome();

  const cur = currencySymbol();
  const num = (label, get, set, suffix) => h('label', { class: 'field' },
    h('span', {}, label),
    h('div', { class: 'input-suffix' },
      h('input', {
        type: 'text', inputmode: 'decimal', value: String(get()).replace('.', getLang() === 'en' ? '.' : ','),
        onchange: e => {
          const v = parseFloat(e.target.value.replace(/'/g, '').replace(',', '.'));
          if (Number.isNaN(v) || v < 0) { e.target.value = String(get()); return; }
          set(v); s.pricesReviewed = true; persist();
        },
      }),
      suffix && h('span', {}, suffix)));
  const b = s.budget;
  const isCH = s.homeCountry === 'ch';

  const fileInput = h('input', {
    type: 'file', accept: 'application/json,.json', hidden: true,
    onchange: async e => {
      const f = e.target.files?.[0];
      if (!f) return;
      try { const n = importData(await f.text()); toast(t('{n} gezi içe aktarıldı', { n })); location.hash = '#/geziler'; }
      catch (err) { toast(t('İçe aktarılamadı: {e}', { e: err.message }), 4000); }
      e.target.value = '';
    },
  });

  root.append(
    section('🌐 ' + t('Dil') + (getLang() !== 'en' ? ' · Language' : ''),
      segmented(Object.entries(LANGS).map(([value, label]) => ({ value, label })), getLang(), v => {
        s.lang = v;
        saveSettings(s);
        location.reload(); // tüm metinler yeni dilde yüklensin
      })),
    section(t('Yaşadığın ülke'),
      segmented(Object.entries(COUNTRY_PRESETS).map(([value, p]) => ({ value, label: p.label, sub: p.currency })), s.homeCountry, v => {
        const p = COUNTRY_PRESETS[v];
        s.homeCountry = v; s.currency = p.currency; s.budget = structuredClone(p.budget); s.pricesReviewed = false; s.museumCard = false;
        setCurrency(p.currency);
        persist(t('{c} seçildi; fiyatlar {cur} olarak ayarlandı', { c: p.label, cur: p.currency }));
        rerender();
      }),
      h('p', { class: 'muted small' }, t('Para birimi, başlangıç fiyatları ve "yurt dışı" uyarıları buna göre belirlenir.'))),
    section(t('Ev konumu'), homeBox, h('p', { class: 'muted small' }, t('Tam adres gerekmez, şehir ya da semt yeterli. Yalnızca bu cihazda saklanır.'))),
    section(t('Genelde nasıl gezersin?'), segmented(Object.entries(TRANSPORTS).map(([value, x]) => ({ value, label: x.label })), s.transport, v => { s.transport = v; persist(); })),
    section(t('İndirim kartların'),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: s.museumCard, onchange: e => { s.museumCard = e.target.checked; persist(); } }),
        isCH ? t('İsviçre Müze Pasaportum var (Museumspass)') : t('Müzekartım var')),
      isCH && h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: s.halfFare, onchange: e => { s.halfFare = e.target.checked; persist(); } }),
        t('Halbtax (yarı fiyat kartı) var')),
      h('p', { class: 'muted small' }, t('Bütçede bu kartların geçtiği yerler ücretsiz ya da indirimli sayılır.'))),
    section(t('Fiyatlar'),
      !s.pricesReviewed && h('div', { class: 'note warn' }, t('Bunlar başlangıç için konmuş tahmini değerler. Kendi bildiğin fiyatlara göre düzelt; bütçe hesapları bunlara dayanır.')),
      h('div', { class: 'price-grid' },
        num(t('Yakıt fiyatı'), () => b.fuelPrice, v => { b.fuelPrice = v; }, `${cur}/L`),
        num(t('Aracın tüketimi'), () => b.consumption, v => { b.consumption = v; }, 'L/100 km'),
        num(t('Otopark (günlük)'), () => b.parkingPerDay, v => { b.parkingPerDay = v; }, cur),
        num(t('Toplu taşıma'), () => b.transitPerPersonDay, v => { b.transitPerPersonDay = v; }, t('{c}/kişi/gün', { c: cur })),
        num(t('Ortalama giriş bileti'), () => b.ticketAvg, v => { b.ticketAvg = v; }, cur),
        num(t('Beklenmedik gider payı'), () => b.bufferPct, v => { b.bufferPct = v; }, '%')),
      h('h3', { class: 'h-sub' }, t('Konaklama (oda / gece)')),
      h('div', { class: 'price-grid three' },
        num(t('Ekonomik'), () => b.hotel.ekonomik, v => { b.hotel.ekonomik = v; }, cur),
        num(t('Orta'), () => b.hotel.orta, v => { b.hotel.orta = v; }, cur),
        num(t('Konforlu'), () => b.hotel.konforlu, v => { b.hotel.konforlu = v; }, cur)),
      h('h3', { class: 'h-sub' }, t('Yeme-içme (kişi / gün)')),
      h('div', { class: 'price-grid three' },
        num(t('Ekonomik'), () => b.food.ekonomik, v => { b.food.ekonomik = v; }, cur),
        num(t('Orta'), () => b.food.orta, v => { b.food.orta = v; }, cur),
        num(t('Konforlu'), () => b.food.konforlu, v => { b.food.konforlu = v; }, cur)),
      !s.pricesReviewed && h('button', { class: 'btn small', onclick: () => { s.pricesReviewed = true; persist(t('Fiyatlar onaylandı')); root.querySelector('.note.warn')?.remove(); } }, t('Fiyatlar güncel, uyarıyı kaldır'))),
    section(t('Yedekleme'),
      h('p', { class: 'muted small' }, t('Gezilerin yalnızca bu cihazda saklanıyor. Telefon değiştirirken ya da tarayıcı verilerini silmeden önce yedek al.')),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn', onclick: () => {
            const url = URL.createObjectURL(new Blob([exportData()], { type: 'application/json' }));
            const a = h('a', { href: url, download: `rota-backup-${todayISO()}.json` });
            document.body.append(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          },
        }, '⬇️ ' + t('Yedeği indir')),
        h('button', { class: 'btn', onclick: () => fileInput.click() }, '⬆️ ' + t('Yedekten yükle')),
        fileInput)),
    section(t('Hakkında'),
      h('p', { class: 'small' }, t("Rota, ücretsiz ve açık veri kaynaklarıyla çalışır: mekânlar OpenStreetMap ve Wikidata'dan, açıklamalar Wikipedia'dan, hava durumu Open-Meteo'dan, yol mesafesi OSRM'den, tren süreleri İsviçre'nin açık tarife verisinden gelir.")),
      h('p', { class: 'muted small' }, t('Hesap yok, takip yok. Konumun yalnızca arama yaparken bu servislere gönderilir; gezilerin ve ayarların cihazında kalır.'))),
  );
}
