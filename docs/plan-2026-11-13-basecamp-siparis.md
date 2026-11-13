# Plan: Basecamp "Orders : To-dos" yerine ERP — eksikler (13.11.2026)

Kaynak: Basecamp şablonu "ACRPO Sipariş TO DO listesi" (To-do List Templates, 24 madde, 3 bölüm) + Orders & Deliveries
projesindeki açık siparişler (ACRPO550, 548, 544…) ve son yorumlar. ERP tarafı `app.js` / `sql/` taranarak karşılaştırıldı.
Yalnız plan; kod yazılmadı.

## Basecamp'te bugün nasıl işliyor
- Her sipariş bir to-do listesi: ad = sipariş no (ACRPO550, ACRPO528-P2, ACRPO356-SP4), açıklama = müşteri / ülke + tek cümle.
- 24 madde üç bölümde; her maddede atanan kişi, tamamlanınca haber alanlar, ilerleme (ör. 16/24).
- Asıl iş maddelerin altındaki yorumlarda yürüyor: @ ile kişi çağırma, taslak fatura PDF'i onaya ekleme, tevkifat ve TC / vergi no
  soruları, kargo takip linki, teslim onayı sorgusu, birim fiyat düzeltme isteği.
- Ayrı şablonlar: Amazon EU, Robotshop USA (pazaryeri siparişleri); n11 siparişleri ana şablonla açılıyor.

## Şablon (eksiksiz) ve ERP karşılığı
Var / Kısmen / Yok; "nerede" sütunu ERP'deki yeri.

**Satış birimi**
| # | Madde | Basecamp içeriği | ERP | Eksik |
|---|---|---|---|---|
| 1 | Müşteri Sipariş Formu | Müşteri PO dosyası | Yok | Siparişe dosya eklenemiyor (dosya yalnız alım, fatura, checklist) |
| 2 | Sevk Adresi Bilgileri | SOLD TO: firma, yetkili, e-posta, adres, posta kodu, telefon; müşteri PO no (kolide ve tüm evrakta); ücretsiz / ticari; Incoterms DAP/DDP/EXW; taşıyıcı (FF) firma; EXW için müşteri hesap no | Kısmen: müşteri, ülke, bayi (`reseller`) | Kişi / adres / iletişim, müşteri PO no, ücretsiz-ticari (yalnız `is_internal`), Incoterms, FF firma, EXW hesap no |
| 3 | Fatura Bilgileri | Satış temsilcisi, ACRPO no, sevk haftası, ödeme şartı; BILL TO bloğu; ürün, adet, kargo, toplam; fatura notu | Kısmen: `order_no`, `planned_ship_date`, ürün adetleri, tutar + kur, `payment_terms`, ödeme planı | Satış temsilcisi, BILL TO, ayrı kargo bedeli, fatura notu |
| 4 | Taşıyıcı Firma (FF) Teklifi (büyük siparişler) | Teklif | Yok | Kargo / FF alanları yalnız RMA'da |
| 5 | Ekstra Müşteri Belge Talepleri | Serbest not | Kısmen: `details`, `notes` | Ayrı alan / takip |
| 6 | Siparişe Konu Ürün Bilgileri | Ürün ayrıntısı, üretime haber | Kısmen: `deal_items`; üretime girince checklist açılıyor | Sipariş açılınca üretime bildirim yok |

**Operasyon birimi** (çoğu muhasebeye atanmış)
| # | Madde | Basecamp içeriği | ERP | Eksik |
|---|---|---|---|---|
| 7 | Fatura Onayı (Satış + Müşteri) | Taslak fatura PDF'i yorumla, onay | Yok | Müşteri faturası kaydı ve onay adımı |
| 8 | İrsaliye / Waybill | Belge | Yok | `FILE_KIND.irsaliye` yalnız alımda |
| 9 | Mikro ihracatsa ETGB formu | Belge | Yok | — |
| 10 | Mikro ihracat değilse yüklenecek belgeler | Belgeler | Yok | — |
| 11 | Alıcı ile iletişim | Takip no, irsaliye, fatura e-postayla | Yok | Siparişte takip no yok (yalnız RMA) |
| 12 | Gönderi evrakları yüklenecek | Belgeler | Yok | — |
| 13 | Teslim Onayı | Kargoyu izle, hasarsız teslimi müşteriyle doğrula; kapanınca kurulum maili | Kısmen: Gönderim aşaması "Gönderildi" + sevk tarihi | Teslim tarihi, hasarsız teslim onayı, kurulum maili hatırlatması |
| 14 | Müşteri Ödemesi | Ödeme durumu, gelince satışa haber, hatırlatma | Var (kısmen): Tahsilat, "Geldi" işareti, rapor, ödeme planı paneli | Ödeme gelince satışa bildirim, gecikme uyarısı |
| 15 | Proforma / Fatura (PDF) | PDF | Yok | Müşteri proforma / fatura kaydı (ERP'deki proforma şartı yalnız alım talebinde) |

**Üretim birimi**
| # | Madde | Basecamp içeriği | ERP | Eksik |
|---|---|---|---|---|
| 16 | Product Test Info | Barkod no; sürücü kartı, kontrol kartı; mekanik montaj, elektronik test (PCB, kablo, yedek kablo, adaptör), yazılım testi tarihleri; fonksiyonel test; sipariş notları | Kısmen: checklist (ünite başına seri no, tarih, kontrol eden, sonuç, test notu); aşama `done_at` | Sürücü / kontrol kartı seri no; tarihler ünite bazında değil |
| 17 | Product Test Video | Herkese açık Drive linki | Yok | Link alanı |
| 18 | Paket Bilgileri | Hibe proje kodu (PR02), koli sayısı, ölçü (cm), ağırlık; REGULAR / MICRO EXPORT / DEMO | Yok | Hepsi; paket ölçüleri Basecamp dokümanında ("Ürün Paket Ölçüleri") |
| 19 | Freight Forwarder Label | Etiket | Yok | — |
| 20 | Kurye kaydının açılması | Kayıt | Yok | — |
| 21 | Ürün barkodlarının hazırlanması | Barkod görünen fotoğraf | Kısmen: checklist foto yükleme | Ayrı adım değil |
| 22 | Ürün paketi ve içeriği fotoğrafları | Paket içi / dışı foto | Kısmen: checklist foto | Ayrı adım değil |
| 23 | Ürünün kuryeye teslimi | Teslim | Kısmen: "Gönderildi" | Kurye firması, teslim kaydı |
| 24 | Sipariş haftaya hazır bilgisi | Satış + muhasebeye haber | Kısmen: `planned_ship_date`, Bugün'de "14 gün içinde sevk" | Açık "hazır" bildirimi |

**Pazaryeri şablonları (ana şablondan farkları)**
- Amazon EU (24): maddeler aynı. Sevk'te müşteri PO no yok. Fatura'da satış temsilcisi yok; BILL TO sabit (Amazon EU S.à r.l.,
  Luxembourg); ödeme şartı Net-15 (300 USD üstü havale); toplam = sipariş formu toplamının %100'ü; ek alanlar: Amazon Order No,
  Amazon IOSS VAT no.
- Robotshop USA (25): Sevk'te yalnız ticari (ücretsiz yok), Incoterms sabit DDP, müşteri PO no yok. Fatura'da satış temsilcisi yok;
  BILL TO sabit (RobotShop inc., Vermont, USA); Net-15; toplam = vergiler hariç toplamın %87'si. Üretim'de ek madde
  "Ürünün Paketlenip Sevk için Verilmesi": ürün bilgileri onayından en geç 2 gün içinde (şablonda silinmiş kullanıcıya atanmış,
  bitiş tarihi 1978 — Basecamp'te temizlenmeli).
- ERP'de karşılığı: satış kanalı seçilince BILL TO, ödeme şartı, Incoterms ve tutar kuralı (%100 / %87 vergisiz) öneri olarak dolsun;
  kanal alanları (Amazon Order No, IOSS) yalnız o kanalda görünsün.

**Genel (madde dışı) eksikler**
- Madde bazında sorumlu kişi ve "tamamlanınca haber ver" yok; siparişte satış temsilcisi alanı yok.
- Siparişte yorum yok (yalnız alım talebinde `purchase_comments`); @ ile kişi çağırma yok.
- Siparişe dosya eklenemiyor.
- Madde bazında termin ve x/24 ilerleme yok (5 aşamalı nokta göstergesi + checklist sayısı var).
- Muhasebe rolü siparişleri okuyamıyor (yalnız tahsilat raporu) — operasyon maddelerinin çoğu muhasebede.
- Satış kanalı yok (doğrudan / bayi / Amazon EU / Robotshop / n11); en yakını serbest metin `reseller`.
- `basecamp-sync` yalnız Support panosunu okuyor, siparişleri okumuyor.

## Önerilen dalgalar (sıra önerisi)
- **B1 Sipariş bilgileri** (satış): müşteri kaydına yetkili, e-posta, adres, posta kodu, telefon; siparişte SOLD TO / BILL TO
  (aynıysa tek), müşteri PO no, satış temsilcisi, ücretsiz / ticari, Incoterms, FF firma, EXW hesap no, kargo bedeli,
  fatura notu, ekstra belge talebi, satış kanalı. Sevk haftası `planned_ship_date`'ten türetilir.
- **B2 Sipariş adımları** (Basecamp to-do karşılığı): sipariş açılınca şablondan adım listesi; her adımda sorumlu rol / kişi,
  durum, termin, tamamlanınca haber alanlar; x/N ilerleme; kanal şablonları (Amazon EU, Robotshop).
  Form alanına dönüşen maddeler (2, 3, 5, 18) adım olmaz; üretim maddeleri mevcut aşama + checklist'e bağlanır, çift giriş yok.
- **B3 Yorum ve dosya**: siparişte ve adımda yorum, @ ile kişi → zil bildirimi; dosya ekleme (PO, proforma, fatura, irsaliye,
  ETGB, gönderi evrakı, FF etiketi) Supabase'te; test videosu ve ürün dosyaları Drive linki.
- **B4 Sevkiyat**: paket bilgileri (koli, ölçü, ağırlık, REGULAR / MICRO / DEMO, hibe proje kodu), ürün paket ölçüleri tablosu
  (öneri değer), kurye firması, takip no, teslim tarihi, hasarsız teslim onayı → "kurulum maili gönder" hatırlatması.
- **B5 Muhasebe**: muhasebe rolüne sipariş okuma ve operasyon adımları; müşteri proforma / fatura kaydı + onay (satış + müşteri),
  (fatura türü / e-Fatura kararı muhasebede, ERP karışmaz); ödeme gelince satışa bildirim, gecikme uyarısı.
- **B6 Test bilgisi**: ünite başına sürücü kartı ve kontrol kartı seri no, ünite bazında montaj / test tarihleri (checklist'e alan).
- **B7 Depolama**: Veri menüsünde yöneticilere kullanım göstergesi (klasör kırılımı + veritabanı) ve eşik uyarısı.
  Arşivleme (eski dosyaları zip indir → depodan sil → kayda "arşivlendi") yer azalınca.

## Kararlar (kullanıcı, 13.11)
- Muhasebe ve satış belgeleri (fatura, proforma, irsaliye, PO…) Supabase'te kalır; ürünle ilgili dosyalar (test videosu,
  ürün dokümanı) Drive'da, ERP'de bağlantı olarak.
- Yöneticiler Veri menüsünde depolama kullanımını görecek; dolunca indirip yedekleme + boşaltma (arşivleme) yapılacak.
- (14.11) Sipariş adımları sadeleşir: form alanına dönüşen maddeler adım olmaz.
- (14.11) Muhasebe siparişleri tutarlarıyla görür (B5).
- (14.11) ERP kurulum maili göndermez; teslim onayı girilince Support'a (Parsa) zil bildirimi gider (B4).
- (14.11) Basecamp'teki açık siparişler taşınmaz; kullanıcı elle taşıdı. basecamp-sync genişletilmez.

## Kullanıcının karar vereceği
- Adımlar 24 maddeyi birebir mi alsın, yoksa form alanına dönüşenler çıkarılıp sadeleşsin mi (öneri: sadeleşsin)?
- Muhasebe rolü siparişleri tutarlarıyla görsün mü?
- "Alıcı ile iletişim" ve kurulum maili: ERP e-posta göndersin mi, yoksa yalnız hatırlatma + kayıt mı?
- Basecamp'teki açık siparişler (Orders : To-dos'ta ~17 liste) ERP'ye taşınacak mı, yoksa yeni siparişlerden mi başlanacak?
- Geçişte Basecamp okunarak (basecamp-sync genişletme) mı, elle mi?

## Yapıldı (13.11 gece): bekleme alanı + bildirimler
- Yeni durum `waiting` ("Beklemede"): yeni sipariş ve siparişe çevrilen PROS önce buraya düşer (`save_deal`); muhasebe + yöneticiye zil bildirimi.
  Satış / yönetici "Üretime al" deyince `production` olur; üretime bildirim gider, checklist'ler o anda açılır.
  Beklemedeki siparişin ödemesi "Geldi" olunca satış + yöneticiye "üretime alınabilir" bildirimi. Fırsat aşamasında bildirim yok.
  SQL: `sql/2026-11-13_bekleme_bildirim.sql` (canlıda, rol bazında denendi, deneme geri alındı). Arayüz gerçek hesapla denenmedi.
- Şablon: ERP'de sipariş adım şablonu henüz yok. Ana şablon ile Amazon EU / Robotshop farkları B1 (satış kanalı alanı) ve B2'de (kanal şablonları) ayrılacak.
