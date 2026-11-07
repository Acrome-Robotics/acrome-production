# Gece Özeti - 7 Kasım 2026
Durum: Tamamlandı (03:10–03:50). 4 işin hepsi bitti; hiçbiri canlıya alınmadı, onayını bekliyor

## Yapılanlar
- Tedarik planı hesabı (malzeme ihtiyacı) iki bağımsız yöntemle doğrulandı ✅
  - 8 Stewart: 26 kalem, toplam ihtiyaç 1.136, stok düşülünce net eksik 803 (iki yöntem aynı)
  - Üretimdeki tüm siparişler: 166 kalem, ihtiyaç 2.444, net eksik 1.352, eksik olan 79 kalem (iki yöntem aynı)
  - Veritabanı değişikliği hazır: `sql/2026-11-07_tedarik_plani.sql` (henüz uygulanmadı). Yerel bir test veritabanında denendi ✅
    - Hesap fonksiyonu 8 Stewart için referansla aynı sonucu verdi (26 / 1.136 / 803)
    - Sipariş katı (ör. 20'li paket) ve minimum sipariş yuvarlaması, alternatif seçimi (aktüatör boyu), "minimum stoğu da tamamla" doğru çalışıyor
    - Yetkiler: Satış plan yapamıyor; Muhasebe görüyor ama onaylayamıyor; yalnız yönetici onaylıyor; geri gönderirken neden zorunlu; alım taleplerini Satın alma veya yönetici oluşturuyor; aynı plandan ikinci kez talep oluşmuyor
  - Arayüz hazır (Üretim → Tedarik planı) ve deneme verisiyle test edildi ✅ (masaüstü + telefon, 4 rol, hata yok, taşma yok)
    - Plan adı, ürün adetleri (siparişten otomatik), kur, "min. stoğu tamamla" → Hesapla → paketler; paket adı değiştirme, kalemi başka pakete taşıma, sipariş adedini değiştirme, alternatif seçimi
    - Toplam elle doğrulandı: 5 kalemlik örnekte $9.642 (aynı)
    - Plan sayfası: gönder / onayla / geri gönder (not zorunlu) / iptal / alım taleplerini oluştur, CSV, yazdır
    - Alımlar listesinde 📦 paket etiketi ve paket filtresi; parça kartında sipariş katı, minimum sipariş, teslim süresi alanları
  - Bugünkü verilerle eksiklerin tutarı yaklaşık 558.050 ₺ + 2.725 $ (21 eksik kalemin fiyatı yok, bu tutara dahil değil)

- Veri kalitesi raporu hazır: `veri-kalitesi-2026-11-07.xlsx` (8 sayfa). Veritabanında hiçbir kayıt değiştirilmedi ✅
  - Ürün BOM'larında kullanılan 183 stok kartından 123'ü tedarikçi listesine bağlı değil. Tedarik planındaki paketler bu yüzden kısmen serbest metne göre gruplanıyor. 33 bağlantı önerisi hazır (ör. 17 aktüatör → Wenzhou Huifeng Electric, kişi: Ellar Wang)
  - Fiyatı olmayan 12 kart: 8'i atölyede 3D basılıyor; gerçekten alınan 4 karta fiyat girilmeli
  - 10 parça atölyede 3D basılıyor (creality K1 Max). Planda ayrı "İç üretim – 3D baskı" paketine düşüyor, alım talebi açılmıyor (bunu bu gece ekledim)
  - BOM'da stok kartına bağlı olmayan 39 satır var (çoğu kablo ve kart). Mükerrer BOM satırı 3: Stewart'ta 2 PCB, Copter'de 1 PCB iki kez geçiyor
  - 15 olası mükerrer elektronik komponent kartı (ör. "16Mhz Kristal" ve "16Mhz")

- Bugün yazılan kodun bağımsız güvenlik ve hata incelemesi yapıldı: 14 bulgu. Düzeltmeler hazır ama canlıya alınmadı ✅
  - 🔴 **Yüksek – en önce bu:**
    - Alımlar, stok ve tedarik sayfalarında para birimi alanı kaçırılmadan sayfaya basılıyordu. Siteye girebilen herhangi biri, sahte para birimiyle bir alım talebi açıp yönetici o sayfayı açınca onun oturumunda kod çalıştırabilirdi; bu yolla kendine yönetici rolü bile verebilirdi.
    - Canlıda kontrol ettim: hiçbir kayıtta zararlı değer yok, para birimleri yalnız TRY ve USD. Açık kullanılmamış.
    - Düzeltme: arayüzde değer kaçırılıyor (test edildi) ve veritabanına "yalnız TRY, USD, EUR, GBP" kuralı ekleniyor.
  - 🟠 **Masraf formu:**
    - Onaylanmış formun fişi silinip değiştirilebiliyordu; aynı fiş iki formda kullanılabiliyordu.
    - Onay atlanıp doğrudan "ödendi" yapılabiliyordu; ödenmiş form geri alınıp silinebiliyordu.
    - Muhasebe çalışanı kendi formunu onaylayabiliyordu.
    - Hepsi düzeltildi ve yerel test veritabanında denendi.
  - 🟠 **Bölüm kısıtı:** Yalnız "Mekanik" bölümü atanmış biri siparişi doğrudan "Gönderildi" yapabiliyordu. Düzeltildi; ayrıca Gönderim aşaması artık "Gerekmiyor" yapılamıyor.
  - 🟠 **Basecamp bağlantısı:** Bağlantı linki tek seferlik ve zorunlu hale getirildi (Basecamp bu değeri geri gönderiyor, kayıtlarda doğrulandı).
  - 🟡 **Küçükler:**
    - CSV dosyaları Excel'de formül çalıştırmasın diye korundu.
    - 6 MB üstü fiş için açık hata mesajı; yarım kalan yüklemelerde dosyalar temizleniyor.
    - Mail senkronunda adres eşleşmesindeki joker karakter açığı kapatıldı.
    - Tutar alanlarında NaN ve sonsuz değer engellendi.
    - Tedarik planının toplamı artık sunucuda hesaplanıyor.
  - Dosyalar:
    - `sql/2026-11-07b_guvenlik_duzeltmeleri.sql`
    - güncellenmiş `sql/2026-11-07_tedarik_plani.sql` (artık tek işlemde çalışıyor ve tekrar çalıştırılabiliyor)
    - `app.js`
    - `supabase/functions/` (2 sunucu fonksiyonu)
  - Düzeltmelerden sonra tüm site deneme verisiyle yeniden test edildi (10 test: aşama panosu, masraf, muhasebe, tedarik, rol önizleme, logo linki, kişiler, güvenlik başlıkları): hata yok, telefonda taşma yok ✅
  - Sorun bulunmayanlar: rol önizleme, yedek ve geri yükleme fonksiyonları, masraf dosyalarının okunma kuralı, yeni tablolara doğrudan yazma yetkileri.

## Uyuşmazlıklar
- Referansla tutmayan sonuç yok: tedarik hesabı iki yöntemde de aynı çıktı.
- Dikkat: ürün malzeme listeleri ile siparişlerdeki kontrolcü seçimi tutarsız.
  - Stewart'ın malzeme listesinde hem Raspberry Pi hem Arduino Shield var; siparişlerde ise kontrolcü ayrı kalem olarak yazılıyor (ör. ACRPO-546: 4 Stewart + 12 RPI).
  - Sonuç: her Stewart için bir Raspberry Pi sayılıyor; Arduino'lu siparişte bu fazla alıma yol açar. Soru 2'ye bak.

## Yapılacaklar (bugün)
Sen "onay" deyince ben sırayla yaparım (her adımdan sonra kontrol):
1. 🔴 Güvenlik düzeltmeleri veritabanına: `sql/2026-11-07b_guvenlik_duzeltmeleri.sql`
2. Tedarik planı veritabanına: `sql/2026-11-07_tedarik_plani.sql`
3. Düzeltilmiş 2 sunucu fonksiyonu yüklenir (mail senkronu, Basecamp bağlantısı)
4. `gece-2026-11-07` dalı ana dala birleşir → site güncellenir
5. Canlı sitede kontrol: alımlar, masraf, tedarik planı, aşama panosu

Senin yapacakların:
- Muhasebe rolünü ve üretim bölümlerini (Mekanik, Elektronik, Paketleme, Gönderim…) kişilere ata
- Üretimdeki 13 siparişin aşamalarını gir
- Çalışma planı kişilerinde eksik e-postaları tamamla
- noreply@acrome.net takma adı: Google Admin'de alias + Gmail'de "Farklı gönder"
- web.app'e geçiş için Firebase proje kimliğini gönder (bekliyor)


## #4 Sabah brifingindeki Basecamp kısmını sunucuya taşıma — plan (uygulanmadı)
- Bugün brifing Basecamp'i bilgisayarındaki araçla okuyor; araç 5 bölüm üretiyor: atamalarım, gecikenler raporu, bildirimler, aktivite, ping konuşmaları.
- Bu 5 bölümün hepsi Basecamp'in resmi API'sinde var ve dün kurduğumuz salt okuma bağlantısıyla okunabilir:
  - `/my/assignments.json`
  - `/reports/todos/overdue.json`
  - `/my/readings.json` (bildirimler)
  - `/reports/progress.json` (aktivite)
  - `/buckets/<id>/chats/<id>/lines.json` (ping mesajları)
- Yapılacak:
  1. Basecamp senkron fonksiyonuna "brifing" modu eklenir. Bugünkü araçla aynı başlıklarda kısa bir metin üretir; Basecamp'te hiçbir şey okundu işaretlenmez.
  2. Veritabanına bu metni döndüren küçük bir fonksiyon eklenir.
  3. Brifing görevinin Basecamp bölümü önce bu yolu kullanır; olmazsa bilgisayar, o da olmazsa Chrome yedek kalır.
- Süre: yaklaşık 1 saat. Senin onayınla sunucuya yüklenir; gece yapılmadı.

## Önerilerim
- Güvenlik düzeltmesini (1. adım) bugün ilk iş al; diğerleri beklese de bu beklememeli.
- Tedarik planından önce 33 tedarikçi bağlantısını onayla; paketler (Çin motorları vb.) o zaman doğru gruplanır.
- Fiyatı olmayan 4 satın alınan karta fiyat gir; plan tutarı eksik kalmasın.
- Stewart BOM'undaki kontrolcü satırını "alternatif grup" yap (Raspberry Pi / Arduino); planda seçilebilir olur, fazla alım olmaz.
- Brifingin Basecamp kısmını sunucuya taşıyalım (#4, ~1 saat); bilgisayar kapalıyken de çalışır.

## Sana sorularım
1. Onay: yukarıdaki 5 adımı canlıya alayım mı? (hepsi / yalnız güvenlik / bekle)
2. Stewart'ta kontrolcü: BOM'daki Raspberry Pi her Stewart'ta var mı, yoksa siparişteki RPI/ARD satırı mı belirliyor? (çift sayım olabilir)
3. Stewart BOM'unda 2, Copter BOM'unda 1 PCB iki kez yazılmış: gerçekten 2 adet mi, yoksa mükerrer mi?
4. ACROBOT ile ARM4 aynı ürün mü?
5. Stewart PRO, SMD ve Stewart Premium BOM'larında ürün kodu yok: hangi sipariş kodlarına bağlayayım? (ör. SMD → SMD_EDU?)
6. 33 tedarikçi bağlantı önerisini (Excel'de) uygulayayım mı?
7. Alımlardaki tutarlar KDV dahil mi? Stok kartı fiyatları KDV hariç görünüyor.
8. Tedarikçi "CNC" hangi firma? 
