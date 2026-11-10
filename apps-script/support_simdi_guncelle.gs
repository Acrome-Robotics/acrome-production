// === Acrome Support · siteden "Şimdi güncelle" ===
// Bu dosyayı mevcut Apps Script projesine (support maillerini okuyan proje) yeni bir dosya olarak ekleyin.
// Gmail'de hiçbir şey değiştirmez; yalnız mevcut mail senkronu fonksiyonunu siteden çağrılabilir yapar.
//
// 1) SYNC_FN: her gün ≈09:00 / ≈16:00 çalışan mail senkronu fonksiyonunun adı
//    (Apps Script > soldaki saat simgesi "Tetikleyiciler" > "İşlev" sütununda yazan ad).
// 2) TOKEN_PROP: support-mail-ingest'e gönderilen anahtarın "Proje Ayarları > Komut dosyası özellikleri"ndeki adı.
//    Anahtar kodun içinde sabit yazılıysa getToken_() içinde o sabiti döndürün.
const SYNC_FN = 'BURAYA_FONKSIYON_ADI';
const TOKEN_PROP = 'BURAYA_OZELLIK_ADI';

function getToken_() { return PropertiesService.getScriptProperties().getProperty(TOKEN_PROP); }

function doPost(e) {
  const out = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const tok = getToken_();
    if (!tok || body.token !== tok) return out({ ok: false, error: 'yetkisiz' });
    if (typeof globalThis[SYNC_FN] !== 'function') return out({ ok: false, error: 'SYNC_FN bulunamadı: ' + SYNC_FN });
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return out({ ok: false, error: 'senkron zaten çalışıyor' });
    try {
      const t0 = Date.now();
      globalThis[SYNC_FN]();
      return out({ ok: true, sure_sn: Math.round((Date.now() - t0) / 1000) });
    } finally { lock.releaseLock(); }
  } catch (err) {
    return out({ ok: false, error: String((err && err.message) || err) });
  }
}
