# Sürümler

index.html'deki `?v=` değeri her varlık değişikliğinde commit kancası tarafından otomatik artırılır; tablo git geçmişinden üretilir (`node tools/surum.js liste`).

| Sürüm | Tarih | Commit mesajı |
|---|---|---|
| 202611192354 | 19.11.2026 23:54 | İnceleme düzeltmeleri: şartlı kabul kaydı geri almada korunur (voided), plan okunamazsa salt okunur, seçici listesi kırpılmaz, INSERT ile alındı da kontrol bekler, tarayıcı doğrulaması açık; kancalar LF + çalıştırılabilir, bayat sürüm satırı ve aynı dakika sorunu, push sürüm denetimi |
| 202611200036 | 20.11.2026 00:36 | Küçük iyileştirmeler: fırsat aşaması detaydan, Gönderildi onay penceresi (sevk tarihi + ödeme planı uyarısı), sipariş verildi termin ipucu, hatalı alan işareti, boş bölümle yürürlüğe alma uyarısı, aşama yetki mesajında bölüm adı |
| 202611200046 | 20.11.2026 00:46 | BOM'dan siparişe bağlı talep, sipariş detayında malzeme ve kalite zaman çizelgesi, siparişe kalite projesi + proje riskleri, Son hareketler küçültülebilir; bildirim dağılımı (toplu talepte tek özet) sql |
| 202611200055 | 20.11.2026 00:55 | Stok: kritik / stoğu biten parçadan tek tıkla alım talebi (miktar min-stok, son tedarikçi ve fiyat) |
| 202611200105 | 20.11.2026 01:05 | (bu commit; mesajı bir sonraki commit'te yazılır) |
