# Rota: kişisel gezi planlayıcı

Telefonda uygulama gibi çalışan (PWA) gezi planlayıcı. Günübirlik ve uzun geziler için:

- **Keşfet:** Bulunduğun yerin ya da seçtiğin bir yerin çevresindeki tarihi, doğal ve görülecek yerler; tek dokunuşla "bugün için plan".
- **Planla:** Yer + tarih + kimlerle + ilgi alanı + tempo → gün gün, saat saat plan. Plana öğle ve akşam yemeği önerileri, yol süreleri ve açılış saati uyarıları eklenir.
- **Bütçe:** Yakıt, konaklama, yemek, giriş ücretleri; her kalem düzenlenebilir. Para birimi ve fiyatlar yaşanılan ülkeye göre (İsviçre / Türkiye).
- **Bilgiler:** Hava tahmini; gidilen yere, mevsime ve kişilere özel uyarılar (vinyet, ZTL, Müzekart, roaming, acil numaralar…).
- İnternetsiz açılır, veriler sadece cihazda saklanır, hesap gerekmez.

## Veri kaynakları (hepsi ücretsiz, anahtarsız)

| Ne | Kaynak |
|---|---|
| Bilinen yerler + önem sırası | Wikidata (kaç dilde Wikipedia maddesi var) |
| Ayrıntı: çalışma saati, küçük müzeler, lokantalar | OpenStreetMap (Overpass) |
| Yer arama | Nominatim |
| Açıklama ve fotoğraf | Wikipedia |
| Hava | Open-Meteo |
| Yol mesafesi | OSRM |

Ücretsiz OSM sunucusu yoğun saatlerde yavaşlar ve geniş alan sorgularını kaldırmaz. Bu yüzden OSM yalnızca merkezin 10 km çevresinde kullanılır. OSM yanıt vermezse uygulama Wikidata ile devam eder ve bunu kullanıcıya söyler.

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
