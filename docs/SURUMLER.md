# Sürümler

index.html'deki `?v=` değeri her varlık değişikliğinde commit kancası tarafından otomatik artırılır; tablo git geçmişinden üretilir (`node tools/surum.js liste`).

| Sürüm | Tarih | Commit mesajı |
|---|---|---|
| 202611192354 | 19.11.2026 23:54 | İnceleme düzeltmeleri: şartlı kabul kaydı geri almada korunur (voided), plan okunamazsa salt okunur, seçici listesi kırpılmaz, INSERT ile alındı da kontrol bekler, tarayıcı doğrulaması açık; kancalar LF + çalıştırılabilir, bayat sürüm satırı ve aynı dakika sorunu, push sürüm denetimi |
| 202611200036 | 20.11.2026 00:36 | Küçük iyileştirmeler: fırsat aşaması detaydan, Gönderildi onay penceresi (sevk tarihi + ödeme planı uyarısı), sipariş verildi termin ipucu, hatalı alan işareti, boş bölümle yürürlüğe alma uyarısı, aşama yetki mesajında bölüm adı |
| 202611200046 | 20.11.2026 00:46 | BOM'dan siparişe bağlı talep, sipariş detayında malzeme ve kalite zaman çizelgesi, siparişe kalite projesi + proje riskleri, Son hareketler küçültülebilir; bildirim dağılımı (toplu talepte tek özet) sql |
| 202611200055 | 20.11.2026 00:55 | Stok: kritik / stoğu biten parçadan tek tıkla alım talebi (miktar min-stok, son tedarikçi ve fiyat) |
| 202611200105 | 20.11.2026 01:05 | Cihaz geçmişi: #/cihaz/<seri no> (checklist, aşama, sevk, motor testi, support, RMA tek zaman çizgisinde; toleranslı eşleşme), seri no linkleri ve aramada Cihaz |
| 202611200107 | 20.11.2026 01:07 | Tedarikçi karnesi: son 12 ay zamanında teslim, giriş kontrolü, uygunsuzluk (detayda panel, listede özet); ağırlıklı puan Kalite kararına kadar yok |
| 202611200110 | 20.11.2026 01:10 | Süreç hedefleri: otomatik ölçüt (zamanında sevk, RMA kapanış, support ilk cevap, giriş red, tedarikçi zamanında); kpi_auto değeri forma önerir, kaydedilince donar. SQL önce uygulanmalı |
| 202611200112 | 20.11.2026 01:12 | Denetim paketi: #/kalite/denetim yazdırılabilir özet (dokümanlar, uygunsuzluk/DF, kalibrasyon, süreç hedefleri, açık riskler, tedarikçi değerlendirme + karne) |
| 202611200114 | 20.11.2026 01:14 | Atölye QR etiketi: parça ve cihaz sayfasında QR etiketi yazdır (sayfa linki; qrcode-generator yalnız basarken yüklenir) |
| 202611200120 | 20.11.2026 01:20 | Düzeltmeler: hedef dönem başı (ay sonu taşması), RMA'da ilk ölçüm tarihi kesimi ve support ilk cevap = müşterinin ilk mesajından, motor testi sipariş kodu toleranslı, karnede uygunsuzluk başına sayım + sayfalı okuma; duman testine yeni sayfalar |
| 202611201102 | 20.11.2026 11:02 | Rol açıklamaları koda uyduruldu; Sipariş verildi bildirimi SQL'i (henüz uygulanmadı) |
| 202611201332 | 20.11.2026 13:32 | Alımlar: durum süzgeci sekmeye göre (Açık: sipariş öncesi aşamalar, Yolda'da yok, Teslim alınanlar: giriş kontrolü) |
| 202611201420 | 20.11.2026 14:20 | Kalite: proje sayfasında form kayıtları, süreç sayfasında form kayıtları süzgeci ve gecikme, form yer tutucuları, sabit+ek satır, gerçek tarih, zorunlu alan, durum geçmişi, CI seçimi, proje kalite sorumlusu; PCB sürümleri karta göre gruplu |
| 202611201426 | 20.11.2026 14:26 | Kalite formları: eski tarih biçimleri (/, -) okunur, okunamayan tarih metin kutusunda kalır; yazdırmada boş tarih maskesi basılmaz; boş form çıktısında otomatik doldurma yok |
| 202611201459 | 20.11.2026 14:59 | Eğitimler sayfası (kişi kendi eğitimini tamamlar, talep, bütçe yalnız muhasebe/yönetici/satış), RK-03 canlı risk kaydı (aksiyon tarihi, sorumlu, hatırlatma), tedarikçi risk seviyesi ve tek kaynak |
| 202611201600 | 20.11.2026 16:00 | Kalite: form sayfasında son 5 kayıt, projeye özel form (projectOnly), tedarikçi alanı ERP listesinden, karne ERP'den doldur, Üretim sürecinde sıcaklık/nem grafiği, stok sayfasında müşteri mülkiyeti bağlantısı |
| 202611202313 | 20.11.2026 23:13 | Kalite: bilgi varlığı (RK-03) ve tedarikçi (RK-04) risk kayıtları ayrıldı; içerikteki &lt; çift kaçmıyor |
| 202611202320 | 20.11.2026 23:20 | Kalite: proje kodu 2–10 harf/rakam; çok sütunlu kayıtlar tam genişlik; proje belgesi geçmişi en yeni üstte |
| 202611202329 | 20.11.2026 23:29 | Kalite: revizyon arşivi — eski revizyon salt okunur açılır; yeni revizyonda eski hal otomatik saklanır |
| 202611210011 | 21.11.2026 00:11 | Üretim: Tedarik ilk aşama + üretim maliyeti sütunu; Support: SUP kayıt kodu, müşteriye kayıt e-postası, Kaynak'ta E-posta |
| 202611210018 | 21.11.2026 00:18 | Tedarik: geri doldurma eski aşama zamanıyla, satın almacılara Tedarik görünür; maliyet notu, e-posta notunda Gmail bağlantısı yok; geri alma SQL'i tam |
| 202611210038 | 21.11.2026 00:38 | Support: müşteri e-postası support@acrome.net göndereniyle; yeni konu sayfası İngilizce, müşteriye giden alanlar işaretli + e-posta önizlemesi |
| 202611210141 | 21.11.2026 01:41 | Sol menü küçültülebilir (ikon şeridi, orta alan genişler, tercih kişiye özel); iptal edilen tedarik planı yönetici tarafından yeniden açılır ya da kalıcı silinir |
| 202611210151 | 21.11.2026 01:51 | Canlı tazeleme: yeni sürümde sayfa kendisi yenilenir (form açıksa şerit), başkasının değişikliğinde veri arka planda yüklenip sayfa yeniden çizilir |
| 202611210215 | 21.11.2026 02:15 | Orta alan: paneller küçülünce 1760 px'e kadar genişler, daha geniş ekranda ortalanır |
| 202611211526 | 21.11.2026 15:26 | Bugün: kalite uyarıları (açık uygunsuzluk, kalibrasyon, incelemede form, geciken hedef ölçümü) |
| 202611231317 | 23.11.2026 13:17 | Geri bildirimler 1. ve 2. grup: K-15 arşiv Göster hatası, K-10 Yeni kayıt, uygulama adı Acrome ERP App, Kalite Panosu düzeni, prosedür görünümü |
| 202611231411 | 23.11.2026 14:11 | Giriş kontrolü tek kayıt (FR-KD-01), Stok > Giriş kontrolleri, Şartlı kabuller Stok menüsünde, FR-KY-01 şirket geneli |
| 202611231442 | 23.11.2026 14:42 | Kalite Panosu: bana atanmış formlar ve görevler (K-3); denetim paketinde proje süzgeci (K-7); sağlık özetine veritabanı boyutu uyarısı |
| 202611231616 | 23.11.2026 16:16 | Yeni Acrome logosu: açık ve koyu temaya göre ayrı görsel; sekme ve ana ekran simgeleri |
| 202611231656 | 23.11.2026 16:56 | Açılış ekranı: koyu zeminde çizilen altıgen ve logo animasyonu |
| 202611261246 | 26.11.2026 12:46 | Stajyerler: Muhasebe/Yönetici listesi, eksik belge ve bilgi uyarısı, gizli linkli stajyer formu |
| 202611261331 | 26.11.2026 13:31 | (bu commit; mesajı bir sonraki commit'te yazılır) |
