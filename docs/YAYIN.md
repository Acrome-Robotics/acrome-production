# Yayın ve işletim kuralları

Yayın: `main`'e push → GitHub Pages (~1 dk). Otomatik kontrol bilgisayarda push öncesi git kancalarıyla yapılır (GitHub Actions kullanılmaz).

## Kurulum (her bilgisayarda bir kez)
```
git config core.hooksPath .githooks
```
Gerekenler: Node 22+ ve Chrome ya da Edge. Duman testi sahte veriyi `..\AcromeERP-tasarim\mock-*.js` klasöründen okur (başka yerdeyse `DUMAN_MOCK=<klasör>`; tarayıcı için `CHROME=<yol>`). Bunlar yoksa duman testi uyarıyla atlanır; sözdizimi ve sürüm denetimi yine çalışır.

## Kancalar
- `pre-commit`: `app.js`, `style.css` ya da `config.js` commit'e giriyorsa `index.html`'deki üç `?v=` değerini otomatik `YYYYAAGGSSDD` yapar, `docs/SURUMLER.md`'yi yeniler, ikisini de commit'e ekler. `index.html`'de hazırlanmamış değişiklik varsa durur.
- `prepare-commit-msg`: commit mesajına `Surum: <v>` satırı ekler. Sürüm kaydı bundan üretilir (`node tools/surum.js liste`). Son satır, bir sonraki commit'e kadar "(bu commit)" görünür.
- `pre-push`: `node --check app.js` + `node tools/surum.js kontrol` (üç `?v=` aynı mı, varlık değişince index de güncellendi mi) + `node tools/duman.js` (sahte veriyle tüm rotaları admin, satış, üretim, alım rolleriyle açar; konsol hatası / boş sayfa sayar, ~30 sn).
- Bilinen hatalar `tools/duman-bilinen.json`'da; yalnız YENİ hata push'u durdurur. Tabanı güncellemek: `node tools/duman.js --taban-yaz` (nedenini commit mesajına yazın).
- **Kancayı atlatmak yasak** (`--no-verify`, `core.hooksPath` değiştirme). Kanca bir sorun buluyorsa sorunu düzeltin ya da konuşun.

## Sıra: önce SQL, sonra kod
1. Veritabanı değişikliği geriye uyumlu olsun (yeni tablo / sütun ekle; eskisini hemen silme ya da yeniden adlandırma). SQL `sql/` altına tarihli dosya olarak yazılır, canlıya `apply_migration` ile uygulanır.
2. Riskli değişiklikten önce şema kopyası (snapshot) alın; yanında geri alma SQL'i (`*_geri.sql`) hazır olsun. Önce geri alınan blokta (`raise exception` ile bitirip) deneyin; rol taklidi ile her rolü sınayın.
3. Sonra kod push edilir. Kod, yeni şema yokken de çökmemeli (alan yoksa paneli çizme).
4. Kaldırma işleri iki aşamalıdır: önce kod kullanmayı bıraksın, sonra SQL kaldırsın.

## Geri alma
- Kod: `git revert <commit>` + push (≈1 dk). Sürüm `?v=` yeniden artar, kullanıcılar yeni sürümü alır.
- SQL: ilgili `*_geri.sql` ya da snapshot şemasından geri yükleme. Veri silen değişiklik yapılmaz.

## İşletim görünürlüğü
- E-posta ve zamanlanmış iş hataları `ops_events` tablosuna yazılır (yalnız Yönetici okur). Günlük 07:30'da `ops_health()` sorun bulursa Yönetici'ye tek özet e-posta gider; sorun yoksa hiçbir şey gitmez.
- Yedek: Apps Script (pazar ≈03:00) → Drive'da "Acrome Site Yedekleri" (`backup-export`). Haftalık geri yükleme testi Pazartesi 04:00 pg_cron `backup_restore_test_run()` ile yapılır, sonuç `backup_checks`'e düşer.
