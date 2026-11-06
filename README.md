# Acrome Üretim Planlama

Excel'deki "Production Planning" dosyasının yerini alan web uygulaması.

- **Aylık gönderim raporu:** yıl/ay filtresi, aylık tutar grafiği, aylara göre ürün adetleri, gönderilen sipariş listesi ve sevk tarihi girişi
- **Rapor:** sevkiyat takvimi, yıllık/aylık ciro, açık fırsatlar, ülke dağılımı, ürün bazlı üretim ihtiyacı
- **Kayıtlar:** üretimdeki siparişler, fırsatlar, gönderilenler, kaybedilenler, arşiv (arama, filtre, CSV)
- **Veri girişi:** doğrulamalı form (numara biçimi, tekrar kontrolü, tarih tutarlılığı, para birimi)
- **Kaynak tablolar:** müşteriler, ürünler, ülkeler
- **Değişiklik geçmişi** ve **rol bazlı yetki** (İzleyici, Satış, Üretim, Yönetici)
- **Support:** support@acrome.net konuları, mail ve Basecamp geçmişi, notlar, durum takibi (Yeni / Bizde / Müşteride / Kapandı), mail içeriklerinde arama

## Mimari

| Katman | Teknoloji |
|---|---|
| Arayüz | Tek sayfa HTML/JS (derleme gerektirmez), GitHub Pages |
| Veritabanı | Supabase (PostgreSQL, Frankfurt) |
| Güvenlik | Supabase Auth + Row Level Security, veritabanı tarafında doğrulama tetikleyicileri |

`config.js` içindeki anahtar, Supabase'in tarayıcıda kullanılmak üzere tasarlanmış **publishable** anahtarıdır. Veriye erişim yalnızca giriş yapmış ve yönetici tarafından rol verilmiş kullanıcılara açıktır.

## Roller

| Rol | Yetki |
|---|---|
| Erişim kapalı | Giriş yapar ama veri göremez (yönetici kapatırsa) |
| İzleyici | Rapor ve kayıtları görür (her yeni @acrome.net hesabının varsayılanı) |
| Satış | Fırsat/sipariş ekler ve düzenler, müşteri ekler |
| Üretim | Planlanan sevk, sevk tarihi, durum ve gecikme açıklamasını günceller |
| Sipariş + Support | Satış yetkilerinin tamamı + support konularını düzenleme, not, kapatma, birleştirme |
| Yönetici | Her şey + silme, ürün yönetimi, rol verme |

## Başka bir yere taşımak (ör. Firebase web.app)

Dosyalar statik olduğu için herhangi bir statik barındırmaya kopyalanabilir:

```bash
npm i -g firebase-tools
firebase login
firebase init hosting   # public klasörü: .
firebase deploy
```

Yeni adresi Supabase panelinde **Authentication → URL Configuration → Redirect URLs** listesine eklemeyi unutma.

## Support modülü

| Tablo | İçerik |
|---|---|
| `support_tickets` | Konu başına bir kayıt: durum, kategori, ürün, müşteri, sorumlu, özet, çözüm, Gmail thread / Basecamp bağlantıları |
| `support_messages` | Mail, Basecamp yorumu, not, telefon/Meet kaydı; tam metin arama dizinli |
| `support_events` | Durum / sorumlu / kategori değişiklik geçmişi (tetikleyiciyle) |

- Yeni mailler zamanlanmış görevle `support_ingest(jsonb)` fonksiyonu üzerinden eklenir (yalnızca sunucu tarafı çağırabilir). Aynı mail iki kez eklenmez (`external_id`).
- Müşteriden yeni mail gelince konu otomatik "Bizde"ye, Acrome cevap verince "Müşteride"ye geçer.
- Arama: `support_search(q)` konu alanlarında ve mesaj gövdelerinde önek eşleşmeli arar.
- Support konularını tüm roller görür; yalnızca **Sipariş + Support** ve **Yönetici** düzenler. Mail kayıtlarını yalnızca yönetici değiştirebilir, notu yazan kişi kendi notunu silebilir.
- `support_merge(keep, drops[])`: aynı müşterinin aynı ürün için açılmış konularını tek konuda toplar; eski konuların özeti ve çözümü not olarak kalır. Konu sayfasında "Bu müşterinin destek geçmişi" listesi ve "Buraya birleştir" düğmesi var.

## RMA modülü

| Tablo | İçerik |
|---|---|
| `rma` | RMA kaydı: kod (`<sipariş no>-RMA#<sıra>`), durum, support konusu, sipariş, ürün/seri no, arıza/teşhis, tüm tarihler, kargo, gelen/giden fatura (elle), gümrük rejimi ve beyannameler |
| `rma_costs` | Masraf satırları: gümrük vergisi, KDV, müşavir, navlun, kargo, sigorta, parça, işçilik; para birimi + kur → TL karşılığı |
| `rma_events` | Durum geçmişi |
| `v_rma` | Garanti hesabı (sevk tarihinden yurt içi 2 yıl, yurt dışı 1 yıl), toplam maliyet |

- Durum ilerledikçe ilgili tarih boşsa o günün tarihiyle dolar; tahmini hazır tarihi = ürün geliş + tahmini tamir süresi.
- Düzenleme: Sipariş + Support ve Yönetici; diğer roller görür. Support konusundan ve sipariş sayfasından "RMA aç".
