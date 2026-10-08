# Rota: kişisel gezi planlayıcı

Telefonda uygulama gibi çalışan (PWA) gezi planlayıcı. Günübirlik ve uzun geziler için:

- **Öner ("Nereye gidelim?"):** Nereden çıkacağın, ne kadar yol göze aldığın ("3–4 saat"), araba ya da tren, ülke ve yer türüne göre gidilecek yer önerir. Araba süreleri OSRM'den, tren süreleri İsviçre tarifesinden (transport.opendata.ch) gerçek değerlerdir.
- **Keşfet:** Bulunduğun yerin ya da seçtiğin bir yerin çevresindeki tarihi, doğal ve görülecek yerler; tek dokunuşla "bugün için plan". "Az bilinenler" seçeneği kalabalık turistik yerler yerine gözden kaçan yerleri öne çıkarır.
- **Rota (Planla → Birkaç yer):** Görmek istediğin şehirleri haritaya dokunarak ya da arayarak işaretle, her birine gece sayısı ver (0 = yol üstü uğrama). Uygulama en kısa sırayı ve gerçek yol rotasını (OSRM) bulur, geceleri günlere dağıtır, her şehir için gün gün plan, yemek, otopark, hava, bütçe (her günün ülkesine göre) ve uyarılar çıkarır. Öner sekmesindeki yerler "Rotaya ekle" ile eklenebilir.
- **Şarap & bira:** Bağlar, şaraphaneler, şampanya evleri, manastır ve tarihi bira üreticileri, damıtımevleri (Wikidata + OSM, tüm ülkeler). Planlarda günde en fazla iki tadım durağı; randevu, alkol-araç ve gümrük uyarıları.
- **Planla:** Yer + tarih + kimlerle + ilgi alanı + tempo → gün gün, saat saat plan. Plana öğle ve akşam yemeği önerileri, yol süreleri ve açılış saati uyarıları eklenir. İsteğe bağlı **alışveriş**: başka ilgi alanlarıyla birlikte seçilirse her güne bir alışveriş durağı (outlet, AVM, çarşı, pazar, alışveriş caddesi) eklenir; tek başına seçilirse alışveriş günü planlanır. İsviçre, Almanya ve Avusturya'da çalışma saati bilinmeyen mağazalar pazar günü plana konmaz.
- **Bütçe:** Yakıt, konaklama, yemek, giriş ücretleri, alışveriş; her kalem düzenlenebilir. Para birimi ve fiyatlar yaşanılan ülkeye göre (İsviçre / Türkiye). Tahmini toplam planın başında, günlük tutar her günün altında, kişi başı giriş ücreti ücretli yerlerin yanında görünür.
- **Bilgiler:** Hava tahmini; gidilen yere, mevsime ve kişilere özel uyarılar (vinyet, ZTL, Müzekart, roaming, acil numaralar…).
- İnternetsiz açılır, veriler sadece cihazda saklanır, hesap gerekmez.
- Türkçe, İngilizce ve Fransızca (Ayarlar → Dil). Yer adları ve Wikipedia özetleri de seçilen dilde gelir.

## Yapay zekâ (isteğe bağlı)

- **Anlat, ben planlayayım (Planla):** Gezi serbest metinle anlatılır; YZ isteği yapılandırır, yerler haritada (Nominatim) aranır ve form doldurulur. Plan yine gerçek verilerle çıkar.
- **YZ gün rehberi (gezi ekranı):** Her gün için kısa yerel rehber metni, yöresel lezzetler ve bir ipucu. Gezide saklanır, internetsiz okunur. Plan değişirse o gün için "yenile" çıkar.
- YZ açılış saati, fiyat, mesafe söylemez; bunlar gerçek kaynaklardan gelir.

Mimari: Claude API anahtarı uygulamada değil, Netlify'daki ara sunucuda (`netlify/functions/ai.mjs`) durur. Sunucu yalnızca tanımlı işleri yapar (`ping`, `parse`, `day`) ve erişim kodu ister. Uygulama GitHub Pages'te kalır; Netlify aynı depodan uygulamanın bir kopyasını ve sunucuyu yayınlar.

Kurulum:
1. console.anthropic.com → hesap (Google ile girilebilir) → Billing'den kredi yükle ve aylık harcama sınırı koy → API Keys'den anahtar oluştur. (claude.ai aboneliği API kullanımını kapsamaz; API ayrı ödenir.)
2. Netlify → Add new site → Import an existing project → GitHub → `Alanmett/rota`. Site adı: `rota-alanmett` (farklıysa uygulamada Ayarlar > Yapay zekâ > Gelişmiş'e site adresini yaz).
3. Netlify → Site configuration → Environment variables: `ANTHROPIC_API_KEY` (anahtar) ve `ROTA_ACCESS_CODE` (kendi belirlediğin parola). İsteğe bağlı `AI_MODEL` (varsayılan `claude-haiku-4-5-20251001`). Sonra Deploys → Trigger deploy.
4. Uygulamada Ayarlar > Yapay zekâ > Erişim kodu → aynı parola → "Bağlantıyı dene".

Netlify kredileri: ücretsiz planda ayda 300 kredi var ve her production deploy 15 kredi. Kredi biterse Netlify siteyi
(dolayısıyla YZ'yi) dönemin sonuna kadar durdurur. Bu yüzden `netlify.toml` içindeki `ignore` komutu Netlify'ın yalnızca
`netlify/` klasörü ya da `netlify.toml` değişince derlemesini sağlar; uygulamadaki değişiklikler (GitHub Pages) kredi harcamaz.
YZ sunucusunda değişiklik gerekiyorsa birkaçını tek seferde göndermek kredi tasarrufu sağlar.

## Çeviriler

Kaynak dil Türkçe: koddaki metinler `t('Türkçe metin')` ile yazılır, çevirileri `js/i18n/en.js` ve `js/i18n/fr.js` içindedir. Tekil/çoğul için: `"{n} {n:night|nights}"`. Yeni metin ekledikten sonra eksik çevirileri bulmak için:

```
powershell -ExecutionPolicy Bypass -File tools/i18n-check.ps1
```

## Veri kaynakları (hepsi ücretsiz, anahtarsız)

| Ne | Kaynak |
|---|---|
| Bilinen yerler + önem sırası | Wikidata (kaç dilde Wikipedia maddesi var) |
| Ayrıntı: çalışma saati, küçük müzeler, lokantalar | OpenStreetMap (Overpass) |
| Yer arama; otopark, lokanta, AVM/outlet ve pazar yerleri | Nominatim |
| Açıklama ve fotoğraf | Wikipedia |
| Hava | Open-Meteo |
| Yol mesafesi | OSRM |
| Ülke bilgisi (başkent, dil, trafik yönü) | Wikidata + tarayıcının kendi çevirileri |
| Döviz kuru | frankfurter.dev (Avrupa Merkez Bankası) |

Ölçümlere göre ücretsiz OSM sunucuları şehir ölçeğindeki alan taramalarında sık sık zaman aşımına düşüyor (Zürih 10 km: 30 saniyede yanıt yok). Bu yüzden:

- Yerler her mesafede Wikidata'dan gelir (Zürih 10 km: 1–4 saniye).
- OSM'den alan taraması yalnızca "Yürüme" (≤3 km) mesafesinde yapılır.
- Bunun dışında OSM'ye yalnızca küçük, nokta atışı sorgular gider: plandaki yerlerin çalışma saatleri ve yemek molası lokantaları. OSM yanıt vermezse bunlar atlanır, plan yine çıkar.

## Yayın

https://alanmett.github.io/rota/ (GitHub Pages, `main` dalı). Güncellemek için değişiklikleri commit'leyip `git push` yapmak yeterli; site 1–2 dakikada yenilenir.

## Gidilecek yer veri seti

`data/destinations.json`, 23 ülkede (İsviçre, komşuları, Türkiye ve Avrupa'nın büyük kısmı) gezi rehberi (Wikivoyage) maddesi olan yaklaşık 16 bin yeri içerir. Wikidata'dan `tools/build-destinations.ps1` ile üretilir; yeniden üretmek için:

```
powershell -ExecutionPolicy Bypass -File tools/build-destinations.ps1
```

Önem sıralaması: kaç dilde gezi rehberi maddesi var, kaç dilde Wikipedia maddesi var, UNESCO mirası mı. Canlı sorgu yerine hazır veri seti kullanılmasının nedeni ölçümdür: aynı sorgu canlı yapıldığında 250 km yarıçap için ~25 sn sürüyordu; hazır veriyle öneriler anında ve internetsiz çalışıyor.

## Bilgisayarda çalıştırma

```
powershell -ExecutionPolicy Bypass -File tools/serve.ps1
```

Sonra tarayıcıda http://localhost:8080 adresini aç.

## Dosyalar

- `js/places.js`: Mekân türleri, sorgular, puanlama, birleştirme
- `js/planner.js`: Gün gün plan algoritması, zaman çizelgesi
- `js/tips.js`: "Dikkat edilecekler" kuralları
- `js/budget.js`: Bütçe hesabı
- `js/views/*`: Ekranlar
- `sw.js`: İnternetsiz çalışma
