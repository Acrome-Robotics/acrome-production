// Sürüm aracı (bağımlılıksız). Kullanım: node tools/surum.js bump [--kuru] | yaz [<sürüm>] | liste | kontrol | push <uzak_sha> <yerel_sha>
// bump   : index.html'deki style.css / config.js / app.js ?v= değerlerini YYYYMMDDHHMM yapar (aynı dakikada ise mevcut +1), sürümü yazdırır
// yaz    : docs/SURUMLER.md'yi git geçmişinden ("Surum: <v>" satırlı commit'ler) üretir; liste: aynısını ekrana yazar
// kontrol: index.html'deki üç ?v= değeri aynı mı
// push   : itilen değişiklikte varlık değişmişse index.html'deki ?v= uzaktakinden farklı olmalı (revert / merge dahil)
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.resolve(__dirname, '..');
const IDX = path.join(root, 'index.html'), LOG = path.join(root, 'docs', 'SURUMLER.md');
const RE = /((?:style\.css|config\.js|app\.js)\?v=)([^"'&\s]+)/g;
const git = a => cp.execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const p2 = n => String(n).padStart(2, '0');
const cmd = process.argv[2];

if (cmd === 'bump') {
  const d = new Date(), s = fs.readFileSync(IDX, 'utf8'), all = [...s.matchAll(RE)];
  if (all.length !== 3) { console.error(`index.html'de 3 adet ?v= bekleniyordu, ${all.length} bulundu`); process.exit(1); }
  let v = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}`;
  let cur = /^\d+$/.test(all[0][2]) ? BigInt(all[0][2]) : 0n;
  try { for (const m of git(['log', '-100', '--format=%B']).matchAll(/^Surum: (\d{12})\s*$/gm)) if (BigInt(m[1]) > cur) cur = BigInt(m[1]); } catch { /* geçmiş yok */ }   // revert sonrası eski numara tekrar kullanılmasın
  if (BigInt(v) <= cur) v = String(cur + 1n);   // aynı dakikada ikinci commit: numara hep artar
  if (process.argv.includes('--kuru')) console.log(`[kuru] ${v} yazılacaktı`);
  else fs.writeFileSync(IDX, s.replace(RE, `$1${v}`));
  console.log(v);
} else if (cmd === 'yaz' || cmd === 'liste') {
  // kayıt git geçmişinden türetilir: prepare-commit-msg her sürüm commit'ine "Surum: <v>" satırı ekler
  let raw = [];
  try { raw = git(['log', '--reverse', '--format=%ad%x1f%B%x1e', '--date=format:%d.%m.%Y %H:%M']).split('\x1e').map(x => x.trim()).filter(Boolean); } catch { /* henüz commit yok */ }
  const rows = raw.map(x => {
    const [d, body] = x.split('\x1f'), m = /^Surum: (\d{12})\s*$/m.exec(body || '');
    return m ? `| ${m[1]} | ${d} | ${body.split(/\r?\n/)[0].replace(/\|/g, '/')} |` : null;
  }).filter(Boolean);
  const cur = process.argv[3], d = new Date();
  if (cur) rows.push(`| ${cur} | ${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())} | (bu commit; mesajı bir sonraki commit'te yazılır) |`);
  const txt = '# Sürümler\n\nindex.html\'deki `?v=` değeri her varlık değişikliğinde commit kancası tarafından otomatik artırılır; tablo git geçmişinden üretilir (`node tools/surum.js liste`).\n\n| Sürüm | Tarih | Commit mesajı |\n|---|---|---|\n' + rows.join('\n') + '\n';
  if (cmd === 'yaz') { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.writeFileSync(LOG, txt); } else console.log(rows.join('\n'));
} else if (cmd === 'push') {
  const [rs, ls] = process.argv.slice(3), zero = /^0+$/;
  if (!ls || zero.test(ls)) process.exit(0);
  let base = rs;
  if (!rs || zero.test(rs)) { try { base = git(['merge-base', ls, 'origin/main']); } catch { process.exit(0); } }
  let changed = '', a, b; const ver = t => (/app\.js\?v=([^"'&\s]+)/.exec(t) || [])[1];
  try { changed = git(['diff', '--name-only', base, ls, '--', 'app.js', 'style.css', 'config.js']); a = ver(git(['show', base + ':index.html'])); b = ver(git(['show', ls + ':index.html'])); } catch { process.exit(0); }   // uzak commit yerelde yoksa denetlenemez
  if (changed && a === b) { console.error(`push: ${changed.split(/\r?\n/).join(', ')} değişiyor ama index.html ?v= aynı kalıyor (${b}). 'node tools/surum.js bump' çalıştırıp index.html'i commit edin.`); process.exit(1); }
} else if (cmd === 'kontrol') {
  const vs = [...new Set([...fs.readFileSync(IDX, 'utf8').matchAll(RE)].map(m => m[2]))];
  if (vs.length !== 1) { console.error('index.html: üç ?v= değeri aynı olmalı: ' + vs.join(', ')); process.exit(1); }
  console.log('sürüm denetimi tamam: ' + vs[0]);
} else { console.error('kullanım: node tools/surum.js bump [--kuru] | yaz [<sürüm>] | liste | kontrol | push <uzak_sha> <yerel_sha>'); process.exit(2); }
