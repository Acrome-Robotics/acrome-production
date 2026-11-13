# Plan: Talepler — durum süzgeci, termin, "Yolda" takibi (14.11.2026)

## İstek (kullanıcı, 14.11)
- Talepler durumuna göre süzülemiyor.
- "Sipariş verildi"ye geçerken tahmini termin zorunlu olsun. O tarih gelince talebi açana "malzeme bekleniyordu, geldi mi?" bildirimi
  gitsin; geldiyse talebi kendisi kapatabilsin.
- Kelimeler: "Sipariş verildi" = siparişi verildi, ödemesi yapıldı. Ürünün elimize ulaşması ayrı bir kelimeyle: **Teslim alındı**
  (kullanıcı seçimi; durum anahtarı `alindi` aynı kalır, yalnız görünen ad değişir).
- Siparişi verilen ama elimize ulaşmamış malzemeler ayrıca görülüp takip edilsin ("önemli").
- Gelmediyse: talebi açan "Henüz gelmedi" der → satın almaya bildirim; satın alma yeni termin girer, o tarihte tekrar sorulur.

## Akış ve adlar
Talep → Onaylandı → Proforma alındı → EFT bekliyor → **Sipariş verildi** (ödendi, yolda) → **Teslim alındı** (talep kapanır, stoğa girer).
- `PUR_ST` sırası buna göre: EFT bekliyor, Sipariş verildi'den önce gelir (seçim listesi ve süzgeç sırası).
- Etiketler: `siparis_verildi: 'Sipariş verildi'` (ipucu: "ödemesi yapıldı, yolda"), `alindi: 'Teslim alındı'`.
  Form: "Alım tarihi" → "Teslim tarihi" (`purchased_at`, Teslim alındı'ya geçince kendiliğinden bugün).

## 1. SQL `sql/2026-11-14_talep_termin.sql`
- `purchases.expected_at date` (tahmini termin), `purchases.ordered_at date` (Sipariş verildi'ye geçiş günü, kendiliğinden),
  `purchases.eta_notified_on date` (son "geldi mi?" bildirimi; termin değişince sıfırlanır).
- `purchase_trg` (mevcut tetikleyici; canlı tanım `pg_proc`'tan alınıp üzerine eklenir):
  - durum `siparis_verildi` olurken `expected_at` boşsa hata: "Sipariş verildi için tahmini termin zorunlu".
  - `siparis_verildi`ye geçişte `ordered_at := coalesce(ordered_at, current_date)`.
  - `expected_at` değişirse `eta_notified_on := null`.
- `purchase_arrived(p_purchase)` SECURITY DEFINER: talebi açan (`requester` / `created_by`) ya da satın alma rolleri; yalnız
  `siparis_verildi` durumundaki talep → `alindi` (stok girişi mevcut tetikleyiciyle). Satın alma + talep açana "Teslim alındı" bildirimi.
- `purchase_not_arrived(p_purchase, p_note)` SECURITY DEFINER: aynı yetki; olay geçmişine not, satın alma rollerine
  "Termin geçti, henüz gelmedi: <ürün>" bildirimi.
- `purchase_eta_remind()` + `pg_cron` her sabah 07:00 (TR): `siparis_verildi` ve `expected_at <= bugün` ve
  `eta_notified_on is distinct from expected_at` olanlar için talebi açana "Malzeme bekleniyordu, geldi mi? <ürün>" bildirimi
  (bağlantı talebe), `eta_notified_on := expected_at`. Böylece yeni termin girilince o gün tekrar sorulur.

## 2. Arayüz (`app.js`)
- **Durum süzgeci:** Talepler araç çubuğuna "Durum: hepsi / …" seçimi (PUR_ST sırasıyla); sekmeyle birlikte çalışır.
- **Yolda sekmesi:** "Sipariş verildi" durumundakiler ayrı tabloda; Açık talepler'de görünmez, açık talep sayısına ve toplamlarına girmez (kullanıcı, 14.11). Sütun: termin (geçtiyse kırmızı "N gün gecikti"), sipariş verilme tarihi;
  termine göre sıralı. Üstte kutu: "Yolda: N · gecikmiş M".
- **Bugün sayfası:** satın alma / yönetici için "Termini geçen malzemeler" bölümü.
- **Durum değiştirme kutusu:** Sipariş verildi seçilince "Tahmini termin" tarih alanı çıkar, boşken "Durumu kaydet" kapalı.
  Formda satın alma için "Tahmini termin" alanı (yeni termin buradan girilir).
- **Talep sayfası (Sipariş verildi):** talebi açana ve satın almaya iki düğme: **"Teslim alındı, talebi kapat"** ve **"Henüz gelmedi"**
  (isteğe bağlı not). Termin ve sipariş verilme tarihi Özet'te.

## 3. Bekleyen (Supabase connector düzelince)
- G1–G4 yerelde hazır (commit edilmedi): `purchases.general_use boolean not null default false` eklenip birlikte yayınlanacak.
- `basecamp-sync`: forward'ların yalnız yorumları eklenir (mail eklenmez; eskiler kalır — kullanıcı kararı). Yerelde hazır, yüklenecek.

## Doğrulama
- SQL: geri alınan `do $$` bloğunda rol taklidiyle: termin olmadan Sipariş verildi → hata; termin ile → `ordered_at` dolu;
  talep sahibi `purchase_arrived` → `alindi` + stok; yetkisiz kişi → hata; `purchase_eta_remind()` → bildirim bir kez.
- Arayüz: `node --check`, gruplama / süzgeç mantığı sahte veriyle; canlıda sürüm kontrolü. Gerçek hesapla deneme kullanıcıda.
