// Gezinin içeriğine göre "dikkat edilecekler" listesi.
// Kurallar plana, mevsime, havaya, kişilere, gidilen ülkeye ve kullanıcının yaşadığı ülkeye bakar;
// genel geçer laf yerine o geziye özel uyarı üretir.

import { fmtDay, fmtDur, parseISODate } from './util.js';
import { TYPES, MUZEKART_TYPES, DRINK_TYPES } from './places.js';
import { t, locale } from './i18n.js';

const RAINY = c => (c >= 61 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
const SCHENGEN = new Set(['at', 'be', 'bg', 'hr', 'cz', 'dk', 'ee', 'fi', 'fr', 'de', 'gr', 'hu', 'is', 'it', 'lv', 'li', 'lt', 'lu', 'mt', 'nl', 'no', 'pl', 'pt', 'ro', 'sk', 'si', 'es', 'se', 'ch']);

// Birden fazla ülkeden geçen rotalarda her ülkenin uyarıları; aynı uyarı bir kez gösterilir,
// aynı başlıklı ama ülkeye özel olanların başlığına ülke adı eklenir.
export function tripTips(trip, settings = {}) {
  const ccs = trip.route ? [...new Set(trip.days.map(d => d.cc).filter(Boolean))] : [];
  if (ccs.length <= 1) return buildTips(trip, settings);
  const names = new Intl.DisplayNames([locale()], { type: 'region' });
  const seen = new Set(), titles = new Set(), out = [];
  for (const cc of ccs) {
    const view = { ...trip, dest: { ...trip.dest, cc }, country: trip.countries?.[cc] || null };
    for (const tip of buildTips(view, settings)) {
      if (seen.has(tip.title + tip.text)) continue;
      seen.add(tip.title + tip.text);
      out.push(titles.has(tip.title) ? { ...tip, title: `${tip.title} · ${names.of(cc.toUpperCase())}` } : tip);
      titles.add(tip.title);
    }
  }
  return out;
}

export function buildTips(trip, settings = {}) {
  const tips = [];
  const add = (icon, title, text, level = 'info') => tips.push({ icon, title, text, level });
  const home = settings.homeCountry || 'ch';
  const cc = trip.dest.cc || home;
  const abroad = cc !== home;
  const car = trip.transport === 'araba';
  const stops = trip.days.flatMap(d => d.stops.map(id => trip.places[id])).filter(Boolean);
  const types = new Set(stops.map(p => p.type));
  const cats = new Set(stops.flatMap(p => p.cats));
  const months = trip.days.map(d => parseISODate(d.date).getMonth());
  const winter = months.some(m => m >= 10 || m <= 3);
  const sunday = trip.days.some(d => parseISODate(d.date).getDay() === 0);
  const wx = trip.weather?.days ? Object.values(trip.weather.days) : [];
  const forecast = trip.weather?.source === 'forecast';

  // ---- Plana özel ----
  const noHours = stops.filter(p => !p.hours && TYPES[p.type]?.[2]);
  if (noHours.length) {
    const names = noHours.slice(0, 3).map(p => p.name).join(', ') + (noHours.length > 3 ? t(' ve {n} yer daha', { n: noHours.length - 3 }) : '');
    add('🕘', t('Çalışma saatlerini teyit et'),
      t("{names} için kayıtlı çalışma saati yok. Gitmeden önce Google Maps'ten ya da resmi sitesinden kontrol et.", { names }), 'warn');
  }
  if (wx.length) {
    const rainy = wx.filter(w => (w.pop ?? 0) >= 60 || RAINY(w.code));
    if (forecast && rainy.length) add('🌧️', t('Yağmur bekleniyor'), t('{days} için yağış ihtimali yüksek. O günlere müze gibi kapalı mekânları kaydırmayı düşün.', { days: rainy.map(w => fmtDay(w.date)).join(', ') }), 'warn');
    if (wx.some(w => w.tmax >= 32)) add('☀️', t('Sıcak hava'), t('Öğle sıcağında (12:00–16:00) açık hava gezilerinden kaçın, onları sabah erkene al. Su, şapka ve güneş kremi şart.'), 'warn');
    if (wx.some(w => w.tmin <= 2)) add('🧥', t('Soğuk'), t('Sıcaklık sıfıra yaklaşıyor. Katmanlı giyin; sabah erken ve akşam saatleri özellikle soğuk olur.'));
  }
  if (types.has('mosque')) {
    add('🕌', t('Cami ziyareti'), t('Ayakkabı çıkarılır. Omuz ve dizler kapalı olmalı; kadınlardan başörtüsü beklenir (girişte genelde örtü verilir). Namaz vakitlerinde, özellikle Cuma öğle namazında turist girişi kısıtlanır.'));
  }
  if (types.has('church') || types.has('monastery')) {
    add('⛪', t('Kilise ziyareti'), t('Omuz ve dizlerin kapalı olması beklenir; ayin sırasında gezmek uygun karşılanmaz.'));
  }
  if (types.has('museum')) add('📅', t('Müzelerin kapalı günü'), t('Birçok müze haftada bir gün (çoğunlukla pazartesi) kapalıdır, resmî tatillerde saatler değişebilir. Plandaki uyarılara bak.'));
  if (cats.has('dogal')) add('📶', t('Doğada telefon çekmeyebilir'), t('Şelale, kanyon ve dağlık yerlerde sinyal olmayabilir. Haritayı önceden çevrimdışı indir, yanına su ve rahat ayakkabı al, birine nereye gittiğini söyle.'));
  if (types.has('beach') || types.has('bay')) add('🏖️', t('Plaj'), t('Gölge az olabilir; şemsiye ve deniz ayakkabısı işe yarar. Mavi Bayraklı plajlar düzenli denetlenir.'));
  const shopping = cats.has('alisveris') || trip.interests?.includes('alisveris');
  if (shopping && sunday && ['de', 'at'].includes(cc)) {
    add('🛍️', t('Pazar günü mağazalar kapalı'), t("Almanya ve Avusturya'da pazar günleri mağazalar ve AVM'ler kapalıdır (istasyon ve havalimanı dükkânları hariç). Alışverişi başka bir güne koy."), 'warn');
  }
  if (shopping && cc === 'tr' && (types.has('bazaar') || types.has('bedesten') || types.has('market_hall'))) {
    add('🧿', t('Çarşıda pazarlık'), t('Kapalı çarşı ve bedestenlerde pazarlık olağandır; birkaç dükkânda fiyat sorduktan sonra karar ver.'));
  }
  const drinks = stops.some(p => DRINK_TYPES.has(p.type)) || trip.interests?.includes('sarap');
  if (drinks) {
    add('🍷', t('Tadım ziyaretleri'), t('Bağ evleri, şaraphaneler ve bira üreticilerinin çoğu ziyaretçiyi randevuyla kabul eder, pazar günü kapalı olabilir; birkaç gün önceden ara ya da sitesinden yer ayır. Hasat dönemi (eylül–ekim) en canlı ama en kalabalık zamandır.'));
    if (car) add('🚗', t('Tadım ve araba'), t('Avrupa ülkelerinin çoğunda alkol sınırı 0,5 promil, yeni sürücülerde daha düşük ya da sıfır. Tadımda tükürme kabı kullanılabilir; en iyisi grupta içmeyen bir sürücü olması.'), 'warn');
  }
  if ((shopping || drinks) && abroad && home === 'ch') {
    add('🛃', t("İsviçre'ye dönüşte gümrük"), t("Yurt dışından getirdiğin mallar kişi başı günlük toplam 150 CHF'ye kadar KDV'siz. Aşarsan tutarın tamamı için İsviçre KDV'si ödenir; QuickZoll uygulamasıyla önceden beyan edebilirsin. Et (kişi başı 1 kg), alkol ve tütün için ayrıca miktar sınırları var.")
      + (drinks ? ' ' + t("Alkolde gümrüksüz miktar kişi başı: %18'e kadar (şarap, bira) 5 litre, daha sert içkilerde 1 litre.") : ''), 'warn');
  }
  // Rota: çok uzun yol günleri
  const longDays = trip.route ? trip.days.filter(d => (d.drive || 0) > 480) : [];
  if (longDays.length) {
    add('🛣️', t('Çok uzun yol günleri'), t('{days} günlerinde 8 saatten fazla yol var. Arada bir şehirde gece kalmak (rotaya bir durak ekleyip 1 gece vermek) daha güvenli ve keyifli olur.', { days: longDays.map(d => fmtDay(d.date)).join(', ') }), 'warn');
  }
  if (trip.route && trip.days.some(d => d.sleep)) {
    add('🛏️', t('Rotada konaklama'), t('Her gece farklı yerde kalacaksan konaklamaları önceden ayır ve geç varacağın günlerde otele haber ver. Arabayla geziyorsan otoparkı olan yerleri seç.'));
  }
  if (car && trip.drive && trip.drive.min > 180) add('⏱️', t('Uzun sürüş'), t('Evden tek yön yaklaşık {d} sürüş var. İlk ve son günü hafif tut, en geç 2 saatte bir mola ver.', { d: fmtDur(trip.drive.min) }), 'warn');

  // ---- Kişilere özel ----
  if (trip.travelers.children) add('🧒', t('Çocuklarla'), t('Müze ziyaretlerini kısa tut, aralara park ya da mola koy. Öğleden sonra enerji düşer; yorucu yerleri sabaha al.'));
  if (trip.travelers.elderly) add('🦯', t('Hareket kısıtı'), t('Zorlu tırmanış gerektiren yerleri (zirve, kanyon) plana koymadım. Tarihi yerlerde zemin bozuk olabilir; erişim bilgisi için yerin detayına bak.'));
  if (trip.travelers.pet) add('🐕', t('Evcil hayvan'), t('Müzelere ve kapalı mekânların çoğuna evcil hayvan alınmaz. Konaklamada kabul edilip edilmediğini önceden sor; sıcakta arabada asla bırakma.'));

  // ---- Gidilen ülkeye özel ----
  if (cc === 'ch') {
    if (car) add('🛣️', t('Otoyol vinyeti'), t('İsviçre otoyollarında yıllık vinyet zorunlu (e-vinyet olarak da alınabiliyor). Şehir merkezlerinde park pahalı ve kısıtlı; Park+Ride çoğu zaman daha mantıklı.'));
    else add('🚆', t('Toplu taşıma'), t('SBB uygulamasıyla tren, otobüs ve gemi biletlerini tek yerden al.') + ' ' + (settings.halfFare
      ? t("Halbtax'ın varsa biletlerin çoğu yarı fiyat.")
      : t('Sık geziyorsan Halbtax (yarı fiyat kartı) ve tasarruflu günlük biletler (Spartageskarte) ciddi fark yaratır.')));
    if (types.has('museum')) add('🎟️', t('İsviçre Müze Pasaportu'), t("Yıllık Schweizer Museumspass ile ülke genelinde 500'den fazla müzeye girilebiliyor. Yılda birkaç müze geziyorsan kendini çıkarır."));
    if (sunday) add('🛒', t('Pazar günü'), t("İsviçre'de pazar günleri dükkânların çoğu kapalı; açık olanlar genelde büyük tren istasyonlarında ve benzinliklerde. Erzakını önceden al."));
    if (cats.has('dogal') || types.has('viewpoint')) {
      add('🏔️', t('Dağda hava'), t('Dağda hava hızla değişir: bir kat fazla giysi, yağmurluk ve güneş kremi al. Teleferik ve dağ trenleri pahalıdır, indirimlerini önceden araştır. Yürüyüşe çıkmadan MeteoSwiss uygulamasına bak.'));
      if (winter && car) add('❄️', t('Dağ geçitleri'), t('Yüksek dağ geçitlerinin çoğu kışın kapalıdır; kış lastiği zorunlu sayılır. Yola çıkmadan yol durumunu kontrol et.'), 'warn');
    }
    add('🆘', t('Acil durum'), t('Genel acil 112 · Polis 117 · İtfaiye 118 · Ambulans 144 · Dağda hava ambulansı Rega 1414.'));
  } else if (cc === 'tr') {
    if (stops.some(p => MUZEKART_TYPES.has(p.type))) add('🎟️', 'Müzekart', t("Bakanlığa bağlı müze ve ören yerlerinde Müzekart ile girilir; özel, vakıf ve belediye müzelerinde ve Milli Saraylar'da genelde geçmez. Birden fazla müze gezeceksen çoğunlukla kendini çıkarır."));
    if (car) add('🛣️', t('HGS ve yol'), t('Otoyol ve köprülerden geçeceksen HGS etiketi gerekir (kiralık araçta genelde takılıdır, bakiyesini sor). Uzun yolda en geç 2 saatte bir mola ver.'));
    if (car && cats.has('dogal') && winter) add('❄️', t('Kış yolları'), t('Dağ ve yayla yolları kışın kapalı ya da buzlu olabilir. Kış lastiği ve zincir bulundur.'), 'warn');
    add('🆘', t('Acil durum'), t('Tüm acil durumlar için 112. Gece ya da tatil günü eczane gerekirse "nöbetçi eczane + ilçe adı" diye ara.'));
  } else if (car) {
    if (cc === 'it') add('🚫', t('ZTL bölgeleri'), t('İtalyan şehirlerinin tarihi merkezlerinde ZTL (trafiğe kapalı bölge) var; kameralar plakayı okur ve ceza aylar sonra eve gelir. Arabayı merkezin dışına bırak. Otoyollar ücretli.'), 'warn');
    if (cc === 'fr') add('🛣️', t('Fransa yolları'), t("Otoyolların çoğu ücretli (péage), kartla ödenir. Paris, Lyon, Strazburg gibi şehirlerde Crit'Air çevre etiketi gerekiyor."), 'warn');
    if (cc === 'at') add('🛣️', t('Avusturya vinyeti'), t('Avusturya otoyollarında vinyet zorunlu (dijital olarak önceden alınabilir). Bazı tüneller ayrıca ücretli.'), 'warn');
    if (cc === 'de') add('🌿', t('Çevre etiketi'), t('Birçok Alman şehrinin merkezine girmek için yeşil Umweltplakette gerekiyor. Otoyollar binek araçlar için ücretsiz.'));
  }

  // ---- Yurt dışı (yaşadığın ülkeye göre) ----
  if (abroad) {
    const c = trip.country;
    if (home === 'ch' && SCHENGEN.has(cc)) {
      add('🪪', t('Kimlik'), t('Schengen içinde sınır kontrolü genelde yok ama denetim olabilir: kimliğini ya da pasaportunu ve varsa İsviçre oturum izni kartını yanında taşı.'));
    } else {
      add('🛂', t('Pasaport ve vize'), t("Pasaportunun dönüş tarihinden sonra en az 3–6 ay geçerli olması istenir (ülkeye göre değişir). Vatandaşlığına göre vize gerekip gerekmediğini gitmeden kontrol et; İsviçre'de oturuyorsan oturum iznini de yanına al."), 'warn');
    }
    if (home === 'ch') add('📱', t('Dolaşım (roaming)'), t('İsviçre AB üyesi olmadığı için AB\'nin "evdeki gibi dolaşım" kuralı İsviçre hatlarına uygulanmaz. Tarifeni kontrol et ya da gitmeden yurt dışı paketi veya eSIM al.'), 'warn');
    else add('📱', t('Telefon ve internet'), (c?.idd ? t('Ülke kodu {c}.', { c: c.idd }) + ' ' : '') + t("Yurt dışı paketini ya da yerel SIM/eSIM'i önceden ayarla; haritayı çevrimdışı indir."));
    if (home === 'ch') add('🏥', t('Sağlık'), t("Sağlık sigortası kartının arkası Avrupa Sağlık Sigortası Kartı'dır (AB ülkelerinde acil tedavi için). AB dışına gidiyorsan seyahat sigortanı kontrol et."));
    if (c?.currencies?.length) add('💱', t('Para'), t('Para birimi: {c}. Kartının yurt dışı kullanıma açık olduğundan emin ol; döviz kuru farkı için kartlı ödemede yerel parayı seç.', { c: c.currencies.join(', ') }));
    if (c?.driveSide === 'left') add('🚗', t('Trafik soldan akar'), t('Bu ülkede araçlar yolun solundan gider. Araba kiralayacaksan ve karşıdan karşıya geçerken dikkat et.'), 'warn');
    if (!['tr', 'ch'].includes(cc)) add('🆘', t('Acil durum'), c?.region === 'Europe' ? t("Avrupa'da genel acil numara 112.") : t('Yerel acil durum numarasını gitmeden öğren (Wikivoyage sayfasında yazar).'));
  }
  return tips;
}
