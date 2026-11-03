# Acrome Üretim Planlama

Excel'deki "Production Planning" dosyasının yerini alan web uygulaması.

- **Rapor:** sevkiyat takvimi, yıllık/aylık ciro, açık fırsatlar, ülke dağılımı, ürün bazlı üretim ihtiyacı
- **Kayıtlar:** üretimdeki siparişler, fırsatlar, gönderilenler, kaybedilenler, arşiv (arama, filtre, CSV)
- **Veri girişi:** doğrulamalı form (numara biçimi, tekrar kontrolü, tarih tutarlılığı, para birimi)
- **Kaynak tablolar:** müşteriler, ürünler, ülkeler
- **Değişiklik geçmişi** ve **rol bazlı yetki** (İzleyici, Satış, Üretim, Yönetici)

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
| Onay bekliyor | Hiçbir veriyi göremez |
| İzleyici | Rapor ve kayıtları görür |
| Satış | Fırsat/sipariş ekler ve düzenler, müşteri ekler |
| Üretim | Planlanan sevk, sevk tarihi, durum ve gecikme açıklamasını günceller |
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
