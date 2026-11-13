# Plan: talep–sipariş bağı, proforma şartı, tutarla ödeme planı, tahsilat grafikleri (12.11.2026)

Durum: yalnız plan, kod yazılmadı. Önceki plan: docs/plan-2026-11-11-siparis-akisi.md (Aşama 2 yapıldı, 1 ve 3 bekliyor).
Canlı: main c6c8496, v=20261111e.

## İş 1 — Talepte bağlı siparişler tablosu
Sorun: talepte tek "Bağlı sipariş" seçimi var (purchases.deal_id) ve yalnız numara + müşteri görünüyor; hangi sipariş
olduğunu anlamak için üretim tarafına bakmak gerekiyor. Bir talep birden çok siparişle ilgili olabiliyor.
- Yeni tablo `purchase_deals` (purchase_id, deal_id, note). Mevcut `purchases.deal_id` dolu olanlar
  buraya taşınır (şu an canlıda hiçbiri dolu değil); eski sütun okunmaya devam eder, sonra kaldırılır.
- Talep formunda "Bağlı siparişler" tablosu: varsayılan 2 satır, "+ Satır ekle", satır sil. Sütunlar: sipariş (seçim), not.
- Seçilen siparişin altında ayrıntı: müşteri, ülke, açıklama, ürünler ve adetleri, planlanan / istenen sevk tarihi,
  durum (üretimde / gönderildi) ve sipariş sayfasına bağlantı.
- Talep listesinde sipariş sütunu / filtresi; sipariş sayfasında "Bu siparişe bağlı alım talepleri" paneli.
- Yetki: yazma talebi düzenleyebilenle aynı (can_purchase ya da talep sahibi + durum talep). Muhasebe siparişleri
  okuyamadığı için ayrıntı bir RPC'den gelir (deal_payment_report'taki gibi).
- Doğrulama: geri alınan blokta rol taklidi; test kopyasında form.
- Not: Aşama 3'teki (malzeme ihtiyacı) "siparişe bağlı açık talepler yolda sayılır" hesabı bu tabloyu kullanacak.

## İş 2 — Proforma yüklenmeden "Proforma alındı" durumuna geçilemesin
- Sunucu: purchase_trg içinde, durum 'proforma'ya geçerken talepte kind='proforma' dosya yoksa hata.
- Arayüz: durum seçicide "Proforma alındı" seçilince dosya yoksa uyarı, "Durumu kaydet" kapalı; Belgeler paneline yönlendirir.
- Eski kayıtlar: zaten 'proforma' durumunda olup dosyası olmayanlar dokunulmadan kalır (kural yalnız geçişte çalışır).
- Excel içe aktarma / tedarik planından toplu talep açma bu durumu kullanıyorsa etkilenmemeli; kontrol edilecek.

## İş 3 — Ödeme planında oran ya da tutar
- `deal_payments.amount numeric` eklenir; satırda pct ya da amount'tan biri dolu olur (ikisi birden değil).
- Formda her satırda "Oran %" ve "Tutar" kutuları: birini yazınca diğeri sipariş toplamından hesaplanıp gösterilir.
  Kaydedilen, kullanıcının yazdığı alandır.
- Kayıt öncesi kontrol: satırların toplam tutarı sipariş tutarına eşit olmalı (yuvarlama payı 0,01). Fark varsa
  "X eksik / fazla" diye gösterir, kaydetmez. Sunucuda aynı kontrol (save_deal_payments).
- Rapor: tutar = amount varsa o, yoksa toplam × oran.
- Açık nokta: sipariş tutarı sonradan değişirse tutarla girilen satırlar toplamı tutmaz → sipariş kaydı sırasında aynı
  kontrol çalışır, plan düzeltilmeden kaydedilmez.

## İş 4 — Tahsilat raporu (grafikli), Rapor menüsünde
- Yeni sayfa "Tahsilat raporu" (#/tahsilat-rapor), Rapor menüsüne; günlük işaretleme sayfası "Tahsilat takibi" aynen kalır.
- Görünüm seçici: Aylık / Çeyreklik / Yıllık. Her dönem için iki çubuk: beklenen (vadesi o dönemde) ve gelen (o dönemde tahsil edilen).
  Gecikmiş kısım ayrı renkte. Altında dönem tablosu ve CSV.
- Yıl seçici; çubuğa tıklayınca o dönemin ödemeleri listelenir.
- Grafikler mevcut gönderim raporundaki çubuk stiliyle (ek kütüphane yok).
- Veri: deal_payment_report() yeterli; yeni SQL gerekmez (İş 3'ten sonra amount'u da kapsar).

## Sıra ve bağımlılık
2 (küçük, bağımsız) → 3 → 4 (3'ün tutar alanını kullanır) → 1 (en büyük). Her iş ayrı commit; SQL önce, kod sonra; her yayın öncesi onay.

## Kararlar (kullanıcı, 12.11)
- Tüm siparişler USD kaydedilir: sipariş başka para biriminde ise o günün resmi kuru çekilip USD'ye çevrilir → İş 5.
  Bu yüzden ödeme planı, tahsilat takibi ve grafikler tek para biriminde (USD) olur.
- İş 1: adet siparişlere bölünmez; `purchase_deals`'ta qty sütunu yok, yalnız "ilgili siparişler" listesi (+ isteğe bağlı not).

- İş 6 (12.11): Excel referans alınır. Excel'de yazılım varyantı (Matlab / Python / LabVIEW) ayrımı yalnız Delta Robot'ta
  ("Delta Robot Python+Matlab+Labview", "Delta Robot Python") ve birkaç siparişte elle eklenmiş SD kart satırı olarak var;
  ayrı varyant şablonu kurulmaz. Delta'nın iki şablonu Excel'deki gibi aktarılır, diğer farklar sipariş bazında elle satır
  eklenerek karşılanır. Çıktı İngilizce. Her ürün adedi (seri no) için ayrı checklist.

## İş 5 — Resmi kurla USD'ye çevirme
- Kaynak: TCMB günlük kurları (today.xml / tarihli arşiv). Tarayıcıdan doğrudan çekilemez (CORS) → Supabase Edge Function
  `fx-rate` çeker, `fx_rates(day, currency, try_rate)` tablosuna yazar; USD karşılığı çapraz kurdan (EUR/TRY ÷ USD/TRY).
- Sipariş formu: para birimi USD değilse orijinal tutar + sipariş tarihi girilince kur otomatik gelir, USD tutarı hesaplanır;
  kur ve kaynağı kayıtta saklanır (deals.fx_rate, fx_date). Elle kur kutusu yalnız kur çekilemezse açılır.
- Ödeme planı ve rapor `amount_usd` üzerinden hesaplanır (şu an USD dışı siparişte orijinal tutarı kullanıyor; değişecek).
- Hafta sonu / tatil: bir önceki iş gününün kuru. Eski kayıtlara dokunulmaz.
- Kur: TCMB döviz satış (karar 12.11).

## İş 6 — Checklist (müşteriye giden belge) — Parsa
Kaynak Excel: `Downloads\Checklist.xlsx` (164 sayfa). Yapısı:
- `Products`: ürün başına şablon. Her üründe "Components / Qty / Checklist (Acrome ✓, Customer ✓)" tablosu ve ayrı
  "Packaging Checklist (Components / Qty)". Ürünler: Stewart PRO (+V2, Spare Parts), Ball Balancing Table, Ball&Beam, Pendulum,
  Delta Robot, 1DOF/2DOF Copter, 3DOF Helicopter, 4DOF Robot Arm, Mobile Robotic Kits; kontrolcü seçenekleri satır olarak
  (Arduino Mega/Shield, myRIO, Acrome Controller, Raspberry Pi; adet 0/1).
- `SMD`: SMD Education / Starter / AMR Kit şablonları.
- `Update`: şablonların güncel hâli (seri no ACRPO -01 … biçimi).
- `TestChecklist`: ürün başına test maddeleri (Motor / POT / TS / Limit Switch / Cable / Ball / Board / PID / Calibration Check + açıklama).
- `Final Control`: Stewart "Son Kontrol Dokümanı" (Mekanik, Elektrik ve kablolama, Fonksiyonel ve yazılımsal testler,
  Paketleme ve sevkiyat; durum + not; genel sonuç UYGUN / RED / ŞARTLI KABUL; kontrol eden imza).
- Geri kalan ~160 sayfa: sipariş başına doldurulmuş checklist ("Checked by", "Product Serial Number: ACRPO544 -07", tarih).

Plan:
- Tablolar: `checklist_templates` (ürün kodu, kontrolcü varyantı, ad, sürüm no, yazılım versiyonu etiketi, aktif) +
  `checklist_template_lines` (bölüm: bileşen / paketleme / test / son kontrol, madde, varsayılan adet, sıra).
  `deal_checklists` (sipariş, ürün, seri no, şablon sürümü, kontrol eden, tarih, yazılım versiyonu, genel sonuç, not) +
  `deal_checklist_lines` (şablondan kopya: bölüm, madde, adet, Acrome ✓, durum, açıklama).
- Şablon yönetimi sayfası (Üretim → Checklist şablonları): ürün başına şablon, satır ekle / sil / sırala, adet.
  Değişiklik yeni sürüm açar; eski siparişlerin checklist'i kendi kopyasında kalır. Yazılım versiyonuna bağlı maddeler için
  şablona "yazılım versiyonu" etiketi; yeni versiyon çıkınca şablon kopyalanıp düzenlenir.
- Otomatik oluşturma: sipariş üretime girince (ya da "Üretime al" — Aşama 1) sipariş kalemlerinden her ürün adedi için bir
  checklist açılır; kontrolcü kalemine (ARD / RPI / MYRIO) göre varyant seçilir; seri no ACRPO<no>-<sıra> önerilir.
- Sipariş bazında elle değişiklik: satır ekle / çıkar, adet değiştir, not (şablonu etkilemez).
- Doldurma: üretim / test rolü maddeleri işaretler; "Checked by" ve tarih otomatik.
- Çıktı: yazdırılabilir A4 sayfa (tarayıcıdan PDF), Acrome logosu, İngilizce başlıklar (müşteri belgesi), "Customer" sütunu boş
  kutular, imza alanı. Stewart için Son Kontrol Dokümanı ayrı sayfa.
- İlk veri: Excel'in `Update` / `Products` / `SMD` / `TestChecklist` / `Final Control` sayfalarından şablonlar içe aktarılır
  (bir kerelik betik). Eski 160 sipariş sayfası aktarılmaz (istenirse sonra).
- Sıra: şablon tabloları + içe aktarma → şablon sayfası → siparişte otomatik oluşturma + doldurma → çıktı.

## İş 7 — Test raporu ve test notu — Parsa
Mevcut: sipariş sayfasında "Yazılım / test" aşamasında 300 karakterlik tek satır not var; test raporu alanı yok.
- Sipariş (ya da seri no / checklist) başına test notu (uzun metin) + test raporu dosyası yükleme (PDF / foto; `alim` deposu
  gibi ayrı `uretim` deposu, yetki: üretim + yönetici yazar, sipariş okuyabilen okur).
- Checklist'in test bölümüyle aynı ekranda; çıktıda test notu isteğe bağlı görünür.

## Güncel sıra
2 (proforma şartı) → 3 (oran / tutar) → 5 (kur) → 4 (grafik) → 1 (talep–sipariş) → 6 (checklist) → 7 (test raporu).
Önceki plandan: Aşama 1 (üretime alınacaklar) İş 6'dan önce, Aşama 3 (malzeme ihtiyacı tablosu, Özlem) İş 1'den sonra.

## Kullanıcının karar vereceği
- Önceki oturumdan açık: dekont onayı e-posta da göndersin mi; onay talebin durumunu değiştirsin mi.

## Durum (13.11.2026 akşam) — ekip şefi turu
Canlıda (main 9b1c1cc, v=20261113d):
- Dalga 1: liste varsayılanları (Gönderilenler bu ay, Tüm kayıtlar yeniden eskiye), zil + açılır bildirim kutusu, taleplerde tedarikçiye göre gruplama.
- Dalga 2: faturada Satın alma notu (`purchase_invoice_note_set`), proforma şartı (`purchase_trg`), her aktif ürüne boş ürün BOM'u + tetikleyici.
- Dalga 3: ödeme planında oran ya da tutar, TCMB döviz satış kuruyla USD (`fx-rate` Edge Function, `fx_rates`, `deals.fx_*`), grafikli Tahsilat raporu.
  Kur günü: sipariş tarihinden önceki son bülten. Kursuz eski kayıtta yalnız tarih değişince tutar değişmez.
  Doğrulanamadı: `fx-rate` canlıda TCMB'ye ulaşabiliyor mu (giriş yapmış kullanıcı gerekir).
- Dalga 4a: talep–sipariş bağı (`purchase_deals`, `purchase_deals_set`, `purchase_deal_info`); 15 eski bağ taşındı.
Bekleyen: Dalga 4b checklist + test raporu — dal `is-6` (worktree `.claude/worktrees/is-6`), kod + 3 SQL hazır, incelendi, canlıda DEĞİL.
- Yayın öncesi karar: tohumdaki 0 adetler (BBT 16/18, 3DOF tümü; Excel `Update` sayfasından) nasıl ele alınacak.
- Sonra düzeltilebilir bulgular: doldurulmuş checklist'i üretim rolünün silebilmesi, eşzamanlı kayıtta son yazan kazanır,
  seri no eki tutarsızlığı, kaydedilmemiş değişiklik uyarısı. Uygulama sırası: checklist.sql → test_raporu.sql → tohum → kod.
Kullanıcıya açık: "SMD" BOM'u (id 18) ve "4-Axis Robot Arm" BOM'u hangi ürüne ait; "Excel'den güncelle" işlevinin sunucu fonksiyonu (`admin_sync`) canlıda yok.
