# Sipariş akışı planı (11.11.2026)

İstek: onaylanan satış ile üretime alınan sipariş ayrı listelerde görünsün; onayda ödeme planı girilsin ve
tahsilat raporu olsun; alımlar siparişe bağlansın, "bu siparişin bitmesi için şu alımlar lazım" görülsün.

Kararlar (kullanıcı, 11.11):
- "Üretime al" düğmesi: satış (orders), üretim ve yönetici.
- Ödemenin geldiğini işaretleme: satış (orders), muhasebe ve yönetici.
- Ortak stok, siparişlere planlanan sevk tarihi sırasıyla dağıtılır; rezervasyon tablosu yok, her açılışta hesaplanır.

Canlıdaki durum (11.11): 12 sipariş "Üretimde", yalnız 1'inde üretim aşaması başlamış. `payment_terms` 342 siparişin
9'unda dolu, serbest metin. `purchases.deal_id` var ama 1669 talebin hiçbirinde dolu değil. Tedarik planı ürün adedine göre çalışıyor, siparişe göre değil.

Ön koşul: "Diğer ürün + not" işinin (sql/2026-11-11_diger_urun_notu.sql + app.js) yayına alınması.

## Aşama 1 — Üretime alınacaklar / Üretimde ayrımı
- `deals.production_started_at timestamptz` + `production_started_by`. Durum `production` aynı kalır, böylece raporlar ve
  "açık sipariş" hesapları değişmez. Ayrım bu alana göre yapılır.
- Geçiş: aşaması başlamış siparişlere `production_started_at` = ilk aşama zamanı; diğerleri boş kalır, yani "Üretime alınacaklar"a düşer.
- Menü (Üretim): "Üretime alınacaklar" (onaylı, başlamamış; sevk tarihine göre) ve "Üretimdeki siparişler".
- Sipariş detayında "Üretime al" düğmesi (orders/production/admin) → RPC `start_production(deal_id)`, `deal_stage_events`'e satır yazar.
  Geri alma yalnız yönetici.
- Üretim panosu yalnız üretime alınanları gösterir.
- Doğrulama: SQL rol taklidiyle geri alınan blokta; arayüz sahte veriyle test kopyasında.

## Aşama 2 — Ödeme planı ve tahsilat raporu
- Tablo `deal_payments`: deal_id, sıra, açıklama (örn. "%50 ön ödeme"), vade türü (sabit tarih / sevkten N gün sonra),
  vade tarihi, tutar, para birimi, geldi tarihi, gelen tutar, not, işaretleyen. RLS: orders/muhasebe/admin.
- Sipariş formunda (sipariş türünde) satır satır ödeme planı. Toplam sipariş tutarını tutmuyorsa uyarı verir, kaydı engellemez.
  Eski `payment_terms` metni "not" olarak kalır.
- "Sevkten N gün" satırları, sevk tarihi girilince vade tarihini kendiliğinden alır (hesap sunucuda).
- Rapor ekranı "Tahsilat takibi" (Satış ve Rapor menüleri): Gecikmiş / Bu ay beklenen / Sonraki aylar / Gelenler;
  toplamlar para birimine göre ayrı; müşteri filtresi; satırdan "Geldi" işaretleme (kısmi tutar olabilir); CSV.
- "Bugün" sayfasında gecikmiş tahsilat sayısı.
- Doğrulama: geri alınan blokta rol bazlı yazma/okuma, vade hesabı; test kopyasında form + rapor.

## Aşama 3 — Alımların siparişe bağlanması ve malzeme ihtiyacı
- Hesap (RPC `deal_material_need`): açık siparişler planlanan sevk sırasıyla dizilir. Her siparişin ürün adetleri × ürün BOM'u
  ihtiyacı verir. Ortak stok sırayla düşülür. Siparişe bağlı açık talepler (`purchases.deal_id`) "yolda" sayılır. Sonuç: hazır / yolda / eksik.
- Sipariş detayında "Malzeme durumu" paneli: parça, gereken, stoktan ayrılan, yolda (talep durumuyla), eksik.
  "Eksikler için talep aç" düğmesi, talepleri `deal_id` ile oluşturur (proje BOM'undaki "BOM eksiği" akışı gibi).
- "Üretime alınacaklar" listesinde malzeme sütunu: "Hazır" / "3 yolda" / "5 eksik".
- BOM'u olmayan ürünler (SMD, Diğer) "BOM yok" diye gösterilir; proje BOM'u bağlıysa o BOM kullanılır.
- Alım talebi listesinde siparişe göre filtre.
- Doğrulama: küçük sahte veriyle (2 sipariş, ortak parça) dağıtımın sevk sırasına uyduğu SQL testinde görülür.

## Sıra
Önce Diğer'in yayını, sonra 1 → 2 → 3. Her aşama ayrı commit ve ayrı yayın. Her yayın öncesinde kullanıcıdan onay alınır.
1 ve 2 birbirinden bağımsız; 3, 1'in listesini kullanır.
