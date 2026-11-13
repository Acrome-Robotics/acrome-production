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
Canlıda (main 980e906, v=20261113e):
- Dalga 1: liste varsayılanları (Gönderilenler bu ay, Tüm kayıtlar yeniden eskiye), zil + açılır bildirim kutusu, taleplerde tedarikçiye göre gruplama.
- Dalga 2: faturada Satın alma notu (`purchase_invoice_note_set`), proforma şartı (`purchase_trg`), her aktif ürüne boş ürün BOM'u + tetikleyici.
- Dalga 3: ödeme planında oran ya da tutar, TCMB döviz satış kuruyla USD (`fx-rate` Edge Function, `fx_rates`, `deals.fx_*`), grafikli Tahsilat raporu.
  Kur günü: sipariş tarihinden önceki son bülten. Kursuz eski kayıtta yalnız tarih değişince tutar değişmez.
  Doğrulanamadı: `fx-rate` canlıda TCMB'ye ulaşabiliyor mu (giriş yapmış kullanıcı gerekir).
- Dalga 4a: talep–sipariş bağı (`purchase_deals`, `purchase_deals_set`, `purchase_deal_info`); 15 eski bağ taşındı.
- Dalga 4b (13.11, main 980e906, v=20261113e): checklist + test raporu canlıda. 13 şablon / 247 madde Excel'deki gibi (kullanıcı kararı;
  sağlama toplamıyla doğrulandı), üretimdeki 10 sipariş için 35 checklist açıldı, `uretim` deposu kuruldu.
  Kullanıcıda: BBT / Ball&Beam / 3DOF adetleri (çoğu 0), paketleme listeleri (aktarılmadı), Son Kontrol çevirileri, ürün–şablon eşlemeleri.
  Sonra düzeltilebilir bulgular: doldurulmuş checklist'i üretim rolünün silebilmesi, eşzamanlı kayıtta son yazan kazanır,
  seri no eki tutarsızlığı, kaydedilmemiş değişiklik uyarısı.
Kullanıcıya açık: "SMD" BOM'u (id 18) ve "4-Axis Robot Arm" BOM'u hangi ürüne ait; "Excel'den güncelle" işlevinin sunucu fonksiyonu (`admin_sync`) canlıda yok.

## Yeni istekler (13.11 gece) — yalnız plan, kod yazılmadı
Hepsi Talepler sayfası (`viewPurchases`, `viewPurchase`); tek dalga, SQL yalnız G1'de.
- G1 Genel kullanım: bağlı sipariş yerine "Genel kullanım" seçilebilsin (birkaç siparişi etkileyen ya da ofis içi alım).
  `purchases.general_use boolean not null default false`; talep formunda "Bağlı siparişler" tablosunun üstünde onay kutusu
  (işaretliyken sipariş satırları da eklenebilir: "genel + şu siparişler"). Liste ve sipariş gruplarında "Genel kullanım" etiketi.
- G2 Gruplama seçimi: bugünkü "Tedarikçiye göre grupla" kutusu yerine seçim kutusu: Gruplama yok / Tedarikçi / Bağlı sipariş / Aciliyet
  (tercih `savePref('alim_grupla')`, eski true/false değeri Tedarikçi / yok sayılır). Bağlı siparişe göre: her sipariş bir grup
  (başlıkta sipariş no + müşteri + durum), "Genel kullanım" grubu, en sonda "Siparişe bağlı değil". Birden çok siparişe bağlı talep
  her siparişin grubunda görünür ("2 siparişe bağlı" notuyla); alt toplam satırı talebi bir kez sayar.
- G3 Acil ihtiyaç: Aciliyet gruplamasında "Acil" ve "Acil değil" grupları, başlıkta talep sayısı ve toplam (para birimine göre ayrı, `sumPur`).
  Ayrıca sayfa üstündeki göstergelere "Acil açık talepler: N · toplam" kutusu (durumu açık olanlar: PUR_OPEN).
- G4 Talep eden süzgeci: listede yalnız o anda (seçili sekme ve diğer süzgeçlerle) talebi olan kişiler; talebi kalmayan kişi seçiliyse süzgeç temizlenir.
- G5 "Açık talepler" sekmesinde yıl, birim ve ürün (BOM) süzgeçleri gösterilmez ve uygulanmaz; sipariş süzgeci kalır.
  Diğer sekmelerde (Alınanlar, Tümü…) yıl / birim / ürün süzgeçleri kalır — kullanıcı yalnız açık talepler dedi; doğrulanacak.
- Kur: kullanıcı "bir önceki günün kuru" dedi; canlıdaki kural zaten bu (sipariş tarihinden önceki son TCMB bülteni). Değişiklik yok.
- Depolama (karar verildi 13.11, ayrıntı plan-2026-11-13-basecamp-siparis.md B7): canlıda 8 dosya, 1,4 MB; veritabanı 53 MB.
  Muhasebe / satış belgeleri Supabase'te; ürün dosyaları Drive bağlantısı; yöneticiye kullanım göstergesi, dolunca arşivleme.
- Yöntem (kullanıcıyla konuşuldu): küçük işler doğrudan şef tarafından yapılır; ajan + bağımsız inceleme yalnız büyük ya da
  para / yetki / veri taşıma içeren işlerde. Bu grup küçük: doğrudan yapılacak, tek inceleme.

## Silinenler + menü (13.11 gece)
- Silinen sipariş / fırsat önce Silinenler'e düşer (`deals.deleted_at`, `deleted_by`; `sql/2026-11-13_silinenler.sql`, canlıya uygulandı).
  Silinenler'i yalnız satış ve yönetici görür; ikisi de taşır, geri alır, kalıcı siler (kullanıcı kararı). Kalıcı silme yalnız Silinenler'den (RLS).
  Orders / production taşıyamaz (`deals_validate`). Tahsilat raporu, talep–sipariş bağı ve checklist açma silinmişleri dışlar.
  SQL'de rol bazında denendi (geri alınan işlemle); arayüz gerçek hesapla denenmedi. Menü: Satış → Silinenler.
- Tedarik planı menüde Üretim'den Alımlar altına taşındı.
