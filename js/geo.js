// Telefonun konumu: tek yerden, sebebini söyleyen hata mesajlarıyla.
// Önce hızlı (yaklaşık) konum denenir; zaman aşımı ya da sinyal yoksa bir kez daha hassas konumla denenir.
// İzin verilmemişse iPhone / Android için iznin nasıl açılacağı gösterilir.

import { h, toast, openSheet, closeSheet } from './ui.js';
import { t } from './i18n.js';

const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(navigator.userAgent);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function once(opts) {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, opts));
}

function showHelp(code) {
  const steps = code === 1
    ? isIOS()
      ? [t('iPhone Ayarlar > Gizlilik ve Güvenlik > Konum Servisleri: açık olsun.'),
        t('Aynı yerde aşağıda Safari Web Siteleri > “Uygulamayı Kullanırken” seç.'),
        t("Sonra Safari'de adres çubuğundaki “aA” > Web Sitesi Ayarları > Konum > İzin Ver.")]
      : isAndroid()
        ? [t('Telefonun Ayarlar > Konum: açık olsun.'),
          t("Chrome'da ⋮ > Ayarlar > Site ayarları > Konum: alanmett.github.io “Engellendi” listesindeyse dokunup “İzin ver” seç."),
          standalone() ? t('Ana ekrana eklenmiş uygulamada da aynı Chrome izni geçerlidir.') : null].filter(Boolean)
        : [t('Tarayıcının adres çubuğundaki kilit/ayar simgesinden bu site için konuma izin ver.')]
    : code === 2
      ? [t('Telefonun konum servisi kapalı olabilir: Ayarlar > Konum (Konum Servisleri) açık olsun.'), t('Uçak modu açıksa kapat.')]
      : [t('Konum zamanında alınamadı. Pencere kenarına ya da açık alana geçip tekrar dene.')];
  openSheet(h('div', {},
    h('h2', { class: 'sheet-title' }, code === 1 ? '📍 ' + t('Konum izni gerekli') : '📍 ' + t('Konum alınamadı')),
    h('ol', { class: 'help-steps' }, steps.map(s => h('li', {}, s))),
    h('p', { class: 'muted small' }, t('İstersen konum yerine yeri yazarak da arayabilirsin.')),
    h('button', { class: 'btn primary wide', type: 'button', onclick: closeSheet }, t('Tamam'))));
}

// { lat, lon } döner; alınamazsa sebebini gösterir ve null döner
export async function getPosition() {
  if (!('geolocation' in navigator)) { toast(t('Bu cihaz konum özelliğini desteklemiyor.')); return null; }
  try {
    const p = await navigator.permissions?.query({ name: 'geolocation' });
    if (p?.state === 'denied') { showHelp(1); return null; }
  } catch { /* bazı tarayıcılar bu sorguyu desteklemiyor; doğrudan dene */ }
  toast(t('Konum alınıyor…'), 8000);
  try {
    const pos = await once({ enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }).catch(async e => {
      if (e.code === 1) throw e;
      return once({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }); // ikinci deneme: hassas konum (GPS)
    });
    toast(t('Konum bulundu'), 1500);
    return { lat: pos.coords.latitude, lon: pos.coords.longitude };
  } catch (e) {
    toast('', 1);
    showHelp(e.code || 3);
    return null;
  }
}
