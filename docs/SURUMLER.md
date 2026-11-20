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
| 202611201420 | 20.11.2026 14:20 | (bu commit; mesajı bir sonraki commit'te yazılır) |
