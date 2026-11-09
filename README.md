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

> Yayın notu: `app.js` / `style.css` değiştiğinde `index.html` içindeki `?v=` etiketini artırın; aksi halde tarayıcılar eski dosyayı önbellekten kullanabilir.

## Stok ve Alımlar
- Tablolar: `stock_items`, `stock_moves`, `boms` (ürün / proje / PCB dizgi), `bom_lines`, `v_bom_lines`, `pcb_boards`, `pcb_log`, `motor_tests`, `suppliers`, `purchases`.
- Stok yalnızca `stock_move()` fonksiyonuyla değişir (giriş, çıkış, sayım; her değişiklik hareket kaydı bırakır).
- Alım talebini her rol açabilir; durumu Üretim, Sipariş + Support ve Yönetici değiştirir. Bir parçaya bağlı talep "Alındı" olunca stoğa otomatik girer.
- İlk veri: yönetici `#/stok-aktar` sayfasından `acrome-stok-aktarim.json` dosyasını bir kez yükler (`stock_admin_import`).

### Stok ayrımı, parça kodları, site hesapları (6 Kasım 2026)
- Mekanik stok (`#/mekanik-stok`) ve Elektronik stok (`#/elektronik-stok`: elektronik + komponent + hazır) ayrı sayfalar; sayımlar da ayrı (`#/mekanik-sayim`, `#/elektronik-sayim`). "Kritik" filtresi = stok < minimum.
- Parça kodu: `TÜR-ÜRÜN-SIRA` (TÜR: M mekanik, E elektronik, K komponent, H hazır, D diğer · ÜRÜN: BB, BBT, PEN, STW, STP, DLT, C1D, C2D, ARM, SMD, SPR, ORT, PCB, GEN). Yeni parçada boş bırakılırsa `stock_next_code` verir.
- BOM detayında Mekanik / Elektronik sekmeleri.
- Alımlarda "İlgili ürün / proje" (`purchases.bom_id`), listede hızlı "Acil" işareti ve filtreler; `#/alim-rapor` aylık alım raporu.
- Tedarikçi site hesapları `supplier_accounts` tablosunda; RLS `can_purchase()` (Satın alma, Depo / Stok, Üretim, Sipariş, Yönetici). Kimlik no / kart bilgisi tutulmaz.

### Haftalık çalışma planı (6 Kasım 2026; kodda att_*, eski #/yoklama adresleri de açılır)
- `#/calisma-plani`: ortak haftalık tablo (Pzt–Cum). Herkes tabloyu görür; kişi yalnızca kendi satırını (e-posta eşleşmesiyle, `att_me()`), yöneticiler tüm satırları düzenler. Kodlar: x geldi, G geç geldi, - gelmedi, İ izinli, R raporlu, U uzaktan, / yarım gün, T tatil / çalışma günü değil.
- `#/calisma-raporu` (yönetici): aylık kişi bazında sayılar, katılım oranı, gün gün tablo, CSV.
- `#/calisma-kisiler` (yönetici): satırlar ve e-postalar. Hesabı olmayanlar için yeni rol **Personel**: yalnızca yoklamayı görür.
- Hatırlatma: iş günü 16:00 (`att_remind`, pg_cron) bugünkü hücresi boş olanlara e-posta (`mail_outbox` → `notify-mail`). Herkes için T girilen gün (tatil) e-posta gitmez.

### Daily notları (7 Kasım 2026)
- `#/daily`: günlük toplantı notları; kişi başına gün kartı (Yapılanlar / Yapılacaklar), haftalık hedef, önceki günün yapılacakları, notlarda arama. `#/daily/k<id>`: kişinin haftalık geçmişi (Excel düzeni).
- Tablolar `daily_notes(person_id, day)`, `daily_goals(person_id, week)`; kişiler `att_people` (ayrılanlar pasif). Yazma: kendi kartı + yönetici.
- `#/daily-aktar` (yönetici): DailyMeetings Excel'inden üretilen JSON'u `daily_admin_import()` ile aktarır (var olan notların üzerine yazmaz).

### Sipariş üretim aşamaları (7 Kasım 2026)
- Sipariş başına 5 aşama: Mekanik montaj → Elektronik → Yazılım / test → Paketleme → Gönderim. Durumlar: Bekliyor, Devam ediyor, Bitti, Gerekmiyor; her aşamada not.
- `#/uretim-pano`: üretimdeki siparişler bulundukları aşamaya göre sütunlarda (sevk tarihi yakın olan üstte); "Bitti" deyince sipariş sonraki bölüme geçer. Sipariş sayfasında "Üretim aşamaları" paneli ve aşama geçmişi; Üretimdeki siparişler listesinde "Aşama" sütunu; Bugün'de "Bölümümde sıradaki siparişler".
- Yetki: her bölüm kendi aşamasını günceller. Kullanıcılar sayfasında kişiye **Üretim bölümü** seçilir (`profiles.departments`); bölümü boş olan Üretim rolü tüm aşamaları, Sipariş rolü Gönderim'i, Yönetici hepsini günceller (`can_stage`).
- Tablolar `deal_stages(deal_id, stage)`, `deal_stage_events`; yazma yalnız `deal_stage_set()` ile. Gönderim "Bitti" → sevk tarihi zorunlu, sipariş "Gönderildi"ye geçer.

### Masraf formu (7 Kasım 2026)
- `#/masraf`: her kullanıcı (Personel dahil) kendi masraf formunu gönderir: başlık, not ve kalemler (tarih, tür, açıklama, tutar + para birimi, proje/sipariş, fiş/fatura fotoğrafı veya PDF). Fotoğraflar yüklenmeden önce küçültülür. Kendi gönderdiklerini ve durumunu görür; muhasebe incelemeden geri çekebilir.
- `#/masraf-liste` (Muhasebe + Yönetici): tüm formlar, durum/ay/kişi filtresi, CSV. Form sayfasında Onayla / Reddet (not zorunlu) / Ödendi (tarih). Muhasebeye yeni form, gönderene karar için site içi bildirim (e-posta yok).
- Yeni rol **Muhasebe**. Tablolar `expense_reports`, `expense_items`; yazma `expense_submit()`, `expense_review()`. Fişler özel `masraf` deposunda (`<kullanıcı id>/...`); kişi kendi dosyalarını, Muhasebe ve Yönetici hepsini görür.

- Muhasebe rolü (yalnız bu rolü olan): menüde Alımlar (talepler, aylık alım raporu, tedarikçiler — salt okuma), Ekip ve Bildirimler. Alım talebine herkes yorum yazabilir (`purchase_comments`, `purchase_comment_add()`); talep sahibine ve Satın alma rolüne site içi bildirim gider.
- Üretim aşaması "Bitti"/"Gerekmiyor" olunca sıradaki aşamanın bölümündeki kişilere site içi bildirim (`kind = 'asama'`; e-posta gitmez). Panoda siparişin o aşamada kaç gündür beklediği görünür.
- Sistem e-postalarının göndereni `Acrome <noreply@acrome.net>` (notify-mail, `MAIL_FROM` ile değiştirilebilir).
- Haftalık yedek sürüm 2: `sema` alanında veritabanı yapısı (`backup_schema_ddl()`: tablolar, kısıtlar, indeksler, fonksiyonlar, görünümler, tetikleyiciler, RLS, yetkiler, depolama, cron). Vault anahtarları ve Edge Function sırları yedekte yoktur.

### Rol önizleme (geçici, geliştirme kontrolü)
- Yönetici, sol alttaki "Rol önizleme" ile rolleri (ve üretim bölümünü) seçip siteyi o rolle görür. Yalnız arayüz değişir; veri ve kayıtlar yönetici yetkisiyle yapılır. Tarayıcıda `rolePreview` anahtarında tutulur; üstteki şeritten çıkılır. Sonra kaldırılacak.

### Üretim tedarik planı (8 Kasım 2026)
- `#/tedarik`: plan listesi; `#/tedarik/yeni`: ürün adetleri (üretimdeki siparişlerden dolar, stok için artırılabilir) → `supply_plan_calc()` BOM × adet − stok = net eksik; parça kartındaki **sipariş katı**, **minimum sipariş** ve **teslim süresi** (`stock_items.order_multiple / min_order / lead_days`) ile yuvarlar. Alternatif gruplarda (ör. aktüatör boyu) satırdan seçilir.
- Kalemler tedarikçiye göre **alım paketlerinde** toplanır (PCB'ler "PCB dizgi"); paket adı değiştirilebilir, kalem başka pakete taşınabilir. Tutarlar USD (planda 1 USD / 1 EUR = TL kuru girilir).
- Akış: taslak → yöneticiye ve muhasebeye gönder (site içi bildirim) → yönetici onaylar / not ile geri gönderir → Satın alma veya yönetici "Alım taleplerini oluştur" → her kalem `purchases` satırı olur (`plan_id`, `package`). Alımlarda paket filtresi ve 📦 etiketi; `#/alimlar?plan=<id>`.
- Görebilen: Yönetici, Muhasebe, Satın alma, Üretim, Depo / Stok, Sipariş. Hazırlayan: Yönetici, Üretim, Satın alma, Depo / Stok, Sipariş. Veritabanı: `sql/2026-11-07_tedarik_plani.sql`.

## Yedekleme ve senkronlar (7 Kasım 2026)
Sistem kullanıcının bilgisayarına bağlı değildir.
- **Yedek:** Google Apps Script (Serhan'ın hesabında, proje "AcromeERPYedek") her pazar 03:00 `backup-export`'u çağırır, Drive'da "Acrome Site Yedekleri" klasörüne `json.gz` kaydeder (son 12). Her ayın 1'i 04:00 `backup-restore-test` son yedeği ayrı `restore_test` şemasına yükleyip canlıyla satır satır karşılaştırır ve şemayı siler (sonuç `backup_checks`). Kimlik: Vault `backup_token` (Apps Script'te `BACKUP_TOKEN`).
- **Support mailleri:** aynı Apps Script her gün ≈09:00 ve ≈16:00 support@acrome.net maillerini okur (Gmail'de hiçbir şey değiştirmez) ve `support-mail-ingest`'e gönderir. Yeni konular `needs_triage = true` açılır.
- **Basecamp:** `basecamp-sync` edge function'ı resmi Basecamp API'siyle (salt okuma) Supports panosunu okur; pg_cron `basecamp-support-senkronu` 09:36 ve 16:36. OAuth bilgileri Vault'ta (`basecamp_*`); bağlamak için SQL Editor'da `select public.basecamp_connect_url('<client id>', '<client secret>');` ve dönen linki açmak yeterli.
- **Yapay zekâ:** Claude zamanlanmış görevi ("Support yapay zekâ özeti", 09:45 ve 16:45) yalnız Supabase'i okur/yazar: yeni konuları sınıflandırır/birleştirir, özet, sonraki adım ve cevap taslağı yazar, siparişle eşleştirir. Görev çalışmasa da mailler ve bildirimler gelmeye devam eder.

## Milestone 1 — 7 Kasım 2026 (`milestone-1-2026-11-07`)
Geri dönülebilir sabit nokta. Kapsam: satış/sipariş, support + RMA, stok (mekanik/elektronik, sayım), BOM, alımlar + aylık alım raporu, tedarikçiler (gruplar, site hesapları), PCB, motor testleri, çalışma planı + aylık rapor, daily notları, Bugün sayfası, çoklu rol (Personel dahil), e-posta bildirimleri (notify-mail).
- **Kod:** `git checkout milestone-1-2026-11-07` (GitHub'da `milestone-1-2026-11-07` dalı; etiket gönderimi kapalı olduğu için dal olarak saklandı).
- **Veri:** Supabase'te `snap_20261107` şemasında tüm public tabloların kopyası var. Tek tablo geri yükleme: `truncate public.X cascade; insert into public.X select * from snap_20261107.X;` (yalnızca yönetici, önce yeni bir yedek alın).
- **Şema:** Supabase migration geçmişinde son kayıt `milestone_snapshot_20261107`.

## Faturalar, alım belgeleri ve durum geçmişi (9 Kasım 2026)
- **Aylık alım raporu** artık muhasebenin "Alımların Raporu" Excel'iyle aynı: fatura bazında (`purchase_invoices`), muhasebe ayına (`period`) göre, iade faturaları düşülerek. Temmuz 2025 – Kasım 2026 Excel'den aktarıldı (676 fatura + 4 iade; 17 ayın toplamı Özet sayfasıyla birebir).
- Bir aya tıklayınca o ayın faturaları (tarih, tedarikçi, genel toplam, fatura no, açıklama) ve tedarikçiye göre dağılım görünür. "Excel indir" muhasebenin düzeninde (her ay bir sayfa + Özet) dosya üretir.
- Faturaları Muhasebe ve Yönetici ekler / değiştirir; Satın alma görür. Faturaya alım talepleri bağlanabilir (`purchase_invoice_link`).
- Eski kalem bazlı rapor "Alım taleplerine göre" sekmesinde (ürün / proje dağılımı).
- **Belgeler**: alım talebine proforma / fatura / irsaliye (PDF veya foto, en fazla 10 MB) eklenir; `alim` deposu, `purchase_files`.
- **Durum**: alım sayfasında durum seçilir ve "Durumu kaydet" ile onaylanır. Her değişiklik `purchase_events`'e yazılır. "Alındı"dan sipariş öncesi bir duruma dönülürse stoğa girmiş adet geri düşülür ("Eski / kapandı"da düşülmez).
- Veritabanı: `sql/2026-11-09_faturalar_belgeler.sql`.

## Test & support önerileri (10 Kasım 2026)

- **Geri düğmesi:** site içinde gezildiyse her sayfanın üstünde "← Geri"; bir önceki açılan sayfaya döner.
- **Ürün dokümanları:** Webflow'daki 40 PDF (courseware, user manual, infosheet, API, troubleshoot) metni `product_docs` / `product_doc_chunks` tablolarında; `doc_search(ürün, sorgu)` ile aranır. Support yapay zekâ özeti ürün bazında bu dokümanlardan sayfa numarasıyla alıntı yapar. PDF'leri `docs-ingest` edge function'ı indirir. SQL: `sql/2026-11-10_urun_dokuman_kutuphanesi.sql`.
- **PCB takip:** Teslim eden / alan ekip listesinden, sabit yerlerden (Stok, Ürün, Hurda…) ya da daha önce yazılan adlardan seçilir; listede yoksa "Diğer…" ile elle yazılır. Kişi, kart ve sebebe göre filtre. Kaydı açan ya da kayıtta adı geçen kişi kaydını düzeltebilir; stok yetkilileri hepsini. Numara sunucuda verilir.
- **Geç kalma / telafi (`#/gec-kalma`):** G seçilince geliş saati sorulur; hücreden "saat gir" ile çıkış saati de eklenir. Hafta sonu / tatilde çalışma telafi sayılır. Ay sonu: geç süre − telafi = net eksik. Kişi kendini, muhasebe ve yöneticiler herkesi görür. Mesai saatleri Kişiler sayfasından (varsayılan 09:00–18:00). SQL: `sql/2026-11-10_pcb_calisma_saatleri.sql`.
- **Stok sayfaları:** "Mekanik sayım" / "Elektronik sayım" menüden kalktı; stok sayfasının içinde "Parça listesi | Sayım / giriş-çıkış" sekmesi oldu (adresler aynı).
- **Mekanik / elektronik ayrımı:** Kullanıcının üretim bölümü yalnız Mekanik ise Bugün sayfasında ve sayım bildirimlerinde yalnız mekanik stok, yalnız Elektronik ise yalnız elektronik stok çıkar; ikisi ya da hiçbiri seçiliyse ikisi birden. SQL: `sql/2026-11-10_stok_bolum_ayrimi.sql`.
- **PCB adları:** Aynı kişinin / yerin farklı yazımları tek ada çevrildi (ör. "Parsa Payedeh" → "Parsa Payandeh", "Stok(Q.C)" → "Stok (Q.C)").
- **Ay sonu geç kalma bildirimi:** Her ayın son günü 10:00'da o ayın net eksiği / saati girilmemiş geç günü olan kişiye kendi özeti, yöneticilere ve muhasebeye tek özet; yalnız sitede (e-posta yok). SQL: `sql/2026-11-10_pcb_ad_duzeltme_gec_bildirimi.sql`.
- **Bildirimler:** Bugün sayfasının en altında son bildirimler listesi (okunmamışlar önce, tıklayınca okundu sayılır).
- **Alım durumu:** Durum artık açılır listeden seçilir ("Talebin durumu"), "Durumu kaydet" ile kaydedilir.
