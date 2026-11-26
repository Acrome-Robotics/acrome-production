// === Acrome ERP · stajyer belge yükleme ===
// Stajyer formu (#/staj-formu) seçilen dosyayı buraya gönderir; dosya "Stajyer Belgeleri" ortak Drive klasöründe
// kişiye ait alt klasöre kaydedilir. Stajyer klasörü görmez, yüklediğini silemez; dosyalar ortak Drive'a aittir.
//
// Kurulum (bir kez):
// 1) script.google.com > Yeni proje, adı "AcromeERP Stajyer Belge". Bu dosyanın içeriğini Code.gs'e yapıştırın.
// 2) Dağıt > Yeni dağıtım > Tür: Web uygulaması. "Şu kullanıcı olarak yürüt: Ben", "Erişimi olanlar: Herkes". Dağıt, izinleri onaylayın.
// 3) Çıkan "Web uygulaması URL'si"ni (…/exec) Claude'a verin; sitenin config.js dosyasına yazılır.
// Kod değişirse: Dağıt > Dağıtımları yönet > kalem > Sürüm: Yeni sürüm (URL aynı kalır).

const FOLDER_ID = '1HwN4oU-hg5mHHsdOdK3PqbowEXk-iWRO';      // Stajyer Belgeleri
const SB_URL = 'https://fjgeoxuyrcsiwghkehap.supabase.co';
const SB_KEY = 'sb_publishable_E8RGxohAauJKQ4n6AuwfFw_HNp8_n3C';   // sitenin config.js'indeki herkese açık anahtar
const DOCS = { kimlik: 'Nüfus cüzdanı', ogrenci: 'Öğrenci belgesi', staj: 'Staj formu', sgk: 'SGK belgesi' };
const TYPES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_BYTES = 10 * 1024 * 1024;

function doPost(e) {
  const out = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  try {
    const b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!keyOk_(b.k)) return out({ ok: false, error: 'Form bağlantısı geçersiz ya da süresi dolmuş.' });
    const tc = String(b.tc || '').replace(/\D/g, '');
    if (!/^[1-9]\d{10}$/.test(tc)) return out({ ok: false, error: 'TC kimlik no 11 haneli olmalı.' });
    if (!DOCS[b.doc]) return out({ ok: false, error: 'Belge türü tanınmadı.' });
    if (!TYPES[b.mime]) return out({ ok: false, error: 'Yalnız PDF, JPG ya da PNG yüklenebilir.' });
    const bytes = Utilities.base64Decode(String(b.data || ''));
    if (!bytes.length || bytes.length > MAX_BYTES) return out({ ok: false, error: 'Dosya en fazla 10 MB olabilir.' });
    const name = String(b.name || '').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 80);
    const lock = LockService.getScriptLock(); lock.waitLock(20000);   // aynı kişi için iki klasör açılmasın
    let folder;
    try { folder = personFolder_(tc, name); } finally { lock.releaseLock(); }
    const stamp = Utilities.formatDate(new Date(), 'Europe/Istanbul', 'yyyy-MM-dd HHmm');
    const file = folder.createFile(Utilities.newBlob(bytes, b.mime, `${DOCS[b.doc]} - ${stamp}.${TYPES[b.mime]}`));
    return out({ ok: true, url: file.getUrl() });
  } catch (err) {
    return out({ ok: false, error: 'Yükleme başarısız: ' + err.message });
  }
}

// klasör adı TC ile başlar (aynı kişi hep aynı klasöre düşer), yanında ad soyad
function personFolder_(tc, name) {
  const root = DriveApp.getFolderById(FOLDER_ID), it = root.searchFolders(`title contains '${tc}'`);
  while (it.hasNext()) { const f = it.next(); if (f.getName().indexOf(tc) === 0) return f; }
  return root.createFolder(`${tc} - ${name || 'Stajyer'}`);
}

function keyOk_(k) {
  if (!/^[0-9a-f]{24}$/.test(String(k || ''))) return false;
  const r = UrlFetchApp.fetch(SB_URL + '/rest/v1/rpc/intern_key_ok', { method: 'post', contentType: 'application/json',
    headers: { apikey: SB_KEY }, payload: JSON.stringify({ k: k }), muteHttpExceptions: true });
  return r.getResponseCode() === 200 && r.getContentText().trim() === 'true';
}
