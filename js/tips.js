// Gezinin içeriğine göre "dikkat edilecekler" listesi.
// Kurallar plana, mevsime, havaya, kişilere, gidilen ülkeye ve kullanıcının yaşadığı ülkeye bakar;
// genel geçer laf yerine o geziye özel uyarı üretir.

import { fmtDay, fmtDur, parseISODate } from './util.js';
import { TYPES, MUZEKART_TYPES } from './places.js';

const RAINY = c => (c >= 61 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
const SCHENGEN = new Set(['at', 'be', 'bg', 'hr', 'cz', 'dk', 'ee', 'fi', 'fr', 'de', 'gr', 'hu', 'is', 'it', 'lv', 'li', 'lt', 'lu', 'mt', 'nl', 'no', 'pl', 'pt', 'ro', 'sk', 'si', 'es', 'se', 'ch']);

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
    add('🕘', 'Çalışma saatlerini teyit et',
      `${noHours.slice(0, 3).map(p => p.name).join(', ')}${noHours.length > 3 ? ` ve ${noHours.length - 3} yer daha` : ''} için kayıtlı çalışma saati yok. Gitmeden önce Google Maps'ten ya da resmi sitesinden kontrol et.`, 'warn');
  }
  if (wx.length) {
    const rainy = wx.filter(w => (w.pop ?? 0) >= 60 || RAINY(w.code));
    if (forecast && rainy.length) add('🌧️', 'Yağmur bekleniyor', `${rainy.map(w => fmtDay(w.date)).join(', ')} için yağış ihtimali yüksek. O günlere müze gibi kapalı mekânları kaydırmayı düşün.`, 'warn');
    if (wx.some(w => w.tmax >= 32)) add('☀️', 'Sıcak hava', 'Öğle sıcağında (12:00–16:00) açık hava gezilerinden kaçın, onları sabah erkene al. Su, şapka ve güneş kremi şart.', 'warn');
    if (wx.some(w => w.tmin <= 2)) add('🧥', 'Soğuk', 'Sıcaklık sıfıra yaklaşıyor. Katmanlı giyin; sabah erken ve akşam saatleri özellikle soğuk olur.');
  }
  if (types.has('mosque')) {
    add('🕌', 'Cami ziyareti', 'Ayakkabı çıkarılır. Omuz ve dizler kapalı olmalı; kadınlardan başörtüsü beklenir (girişte genelde örtü verilir). Namaz vakitlerinde, özellikle Cuma öğle namazında turist girişi kısıtlanır.');
  }
  if (types.has('church') || types.has('monastery')) {
    add('⛪', 'Kilise ziyareti', 'Omuz ve dizlerin kapalı olması beklenir; ayin sırasında gezmek uygun karşılanmaz.');
  }
  if (types.has('museum')) add('📅', 'Müzelerin kapalı günü', 'Birçok müze haftada bir gün (çoğunlukla pazartesi) kapalıdır, resmî tatillerde saatler değişebilir. Plandaki uyarılara bak.');
  if (cats.has('dogal')) add('📶', 'Doğada telefon çekmeyebilir', 'Şelale, kanyon ve dağlık yerlerde sinyal olmayabilir. Haritayı önceden çevrimdışı indir, yanına su ve rahat ayakkabı al, birine nereye gittiğini söyle.');
  if (types.has('beach') || types.has('bay')) add('🏖️', 'Plaj', 'Gölge az olabilir; şemsiye ve deniz ayakkabısı işe yarar. Mavi Bayraklı plajlar düzenli denetlenir.');
  if (car && trip.drive && trip.drive.min > 180) add('⏱️', 'Uzun sürüş', `Evden tek yön yaklaşık ${fmtDur(trip.drive.min)} sürüş var. İlk ve son günü hafif tut, en geç 2 saatte bir mola ver.`, 'warn');

  // ---- Kişilere özel ----
  if (trip.travelers.children) add('🧒', 'Çocuklarla', 'Müze ziyaretlerini kısa tut, aralara park ya da mola koy. Öğleden sonra enerji düşer; yorucu yerleri sabaha al.');
  if (trip.travelers.elderly) add('🦯', 'Hareket kısıtı', 'Zorlu tırmanış gerektiren yerleri (zirve, kanyon) plana koymadım. Tarihi yerlerde zemin bozuk olabilir; erişim bilgisi için yerin detayına bak.');
  if (trip.travelers.pet) add('🐕', 'Evcil hayvan', 'Müzelere ve kapalı mekânların çoğuna evcil hayvan alınmaz. Konaklamada kabul edilip edilmediğini önceden sor; sıcakta arabada asla bırakma.');

  // ---- Gidilen ülkeye özel ----
  if (cc === 'ch') {
    if (car) add('🛣️', 'Otoyol vinyeti', 'İsviçre otoyollarında yıllık vinyet zorunlu (e-vinyet olarak da alınabiliyor). Şehir merkezlerinde park pahalı ve kısıtlı; Park+Ride çoğu zaman daha mantıklı.');
    else add('🚆', 'Toplu taşıma', `SBB uygulamasıyla tren, otobüs ve gemi biletlerini tek yerden al. ${settings.halfFare ? 'Halbtax\'ın varsa biletlerin çoğu yarı fiyat.' : 'Sık geziyorsan Halbtax (yarı fiyat kartı) ve tasarruflu günlük biletler (Spartageskarte) ciddi fark yaratır.'}`);
    if (types.has('museum')) add('🎟️', 'İsviçre Müze Pasaportu', 'Yıllık Schweizer Museumspass ile ülke genelinde 500\'den fazla müzeye girilebiliyor. Yılda birkaç müze geziyorsan kendini çıkarır.');
    if (sunday) add('🛒', 'Pazar günü', 'İsviçre\'de pazar günleri dükkânların çoğu kapalı; açık olanlar genelde büyük tren istasyonlarında ve benzinliklerde. Erzakını önceden al.');
    if (cats.has('dogal') || types.has('viewpoint')) {
      add('🏔️', 'Dağda hava', 'Dağda hava hızla değişir: bir kat fazla giysi, yağmurluk ve güneş kremi al. Teleferik ve dağ trenleri pahalıdır, indirimlerini önceden araştır. Yürüyüşe çıkmadan MeteoSwiss uygulamasına bak.');
      if (winter && car) add('❄️', 'Dağ geçitleri', 'Yüksek dağ geçitlerinin çoğu kışın kapalıdır; kış lastiği zorunlu sayılır. Yola çıkmadan yol durumunu kontrol et.', 'warn');
    }
    add('🆘', 'Acil durum', 'Genel acil 112 · Polis 117 · İtfaiye 118 · Ambulans 144 · Dağda hava ambulansı Rega 1414.');
  } else if (cc === 'tr') {
    if (stops.some(p => MUZEKART_TYPES.has(p.type))) add('🎟️', 'Müzekart', 'Bakanlığa bağlı müze ve ören yerlerinde Müzekart ile girilir; özel, vakıf ve belediye müzelerinde ve Milli Saraylar\'da genelde geçmez. Birden fazla müze gezeceksen çoğunlukla kendini çıkarır.');
    if (car) add('🛣️', 'HGS ve yol', 'Otoyol ve köprülerden geçeceksen HGS etiketi gerekir (kiralık araçta genelde takılıdır, bakiyesini sor). Uzun yolda en geç 2 saatte bir mola ver.');
    if (car && cats.has('dogal') && winter) add('❄️', 'Kış yolları', 'Dağ ve yayla yolları kışın kapalı ya da buzlu olabilir. Kış lastiği ve zincir bulundur.', 'warn');
    add('🆘', 'Acil durum', 'Tüm acil durumlar için 112. Gece ya da tatil günü eczane gerekirse "nöbetçi eczane + ilçe adı" diye ara.');
  } else if (car) {
    if (cc === 'it') add('🚫', 'ZTL bölgeleri', 'İtalyan şehirlerinin tarihi merkezlerinde ZTL (trafiğe kapalı bölge) var; kameralar plakayı okur ve ceza aylar sonra eve gelir. Arabayı merkezin dışına bırak. Otoyollar ücretli.', 'warn');
    if (cc === 'fr') add('🛣️', 'Fransa yolları', 'Otoyolların çoğu ücretli (péage), kartla ödenir. Paris, Lyon, Strazburg gibi şehirlerde Crit\'Air çevre etiketi gerekiyor.', 'warn');
    if (cc === 'at') add('🛣️', 'Avusturya vinyeti', 'Avusturya otoyollarında vinyet zorunlu (dijital olarak önceden alınabilir). Bazı tüneller ayrıca ücretli.', 'warn');
    if (cc === 'de') add('🌿', 'Çevre etiketi', 'Birçok Alman şehrinin merkezine girmek için yeşil Umweltplakette gerekiyor. Otoyollar binek araçlar için ücretsiz.');
  }

  // ---- Yurt dışı (yaşadığın ülkeye göre) ----
  if (abroad) {
    const c = trip.country;
    if (home === 'ch' && SCHENGEN.has(cc)) {
      add('🪪', 'Kimlik', 'Schengen içinde sınır kontrolü genelde yok ama denetim olabilir: kimliğini ya da pasaportunu ve varsa İsviçre oturum izni kartını yanında taşı.');
    } else {
      add('🛂', 'Pasaport ve vize', 'Pasaportunun dönüş tarihinden sonra en az 3–6 ay geçerli olması istenir (ülkeye göre değişir). Vatandaşlığına göre vize gerekip gerekmediğini gitmeden kontrol et; İsviçre\'de oturuyorsan oturum iznini de yanına al.', 'warn');
    }
    if (home === 'ch') add('📱', 'Dolaşım (roaming)', 'İsviçre AB üyesi olmadığı için AB\'nin "evdeki gibi dolaşım" kuralı İsviçre hatlarına uygulanmaz. Tarifeni kontrol et ya da gitmeden yurt dışı paketi veya eSIM al.', 'warn');
    else add('📱', 'Telefon ve internet', `${c?.idd ? `Ülke kodu ${c.idd}. ` : ''}Yurt dışı paketini ya da yerel SIM/eSIM'i önceden ayarla; haritayı çevrimdışı indir.`);
    if (home === 'ch') add('🏥', 'Sağlık', 'Sağlık sigortası kartının arkası Avrupa Sağlık Sigortası Kartı\'dır (AB ülkelerinde acil tedavi için). AB dışına gidiyorsan seyahat sigortanı kontrol et.');
    if (c?.currencies?.length) add('💱', 'Para', `Para birimi: ${c.currencies.join(', ')}. Kartının yurt dışı kullanıma açık olduğundan emin ol; döviz kuru farkı için kartlı ödemede yerel parayı seç.`);
    if (c?.driveSide === 'left') add('🚗', 'Trafik soldan akar', 'Bu ülkede araçlar yolun solundan gider. Araba kiralayacaksan ve karşıdan karşıya geçerken dikkat et.', 'warn');
    if (!['tr', 'ch'].includes(cc)) add('🆘', 'Acil durum', c?.region === 'Europe' ? 'Avrupa\'da genel acil numara 112.' : 'Yerel acil durum numarasını gitmeden öğren (Wikivoyage sayfasında yazar).');
  }
  return tips;
}
