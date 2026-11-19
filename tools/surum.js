// Sürüm aracı (bağımlılıksız). Kullanım: node tools/surum.js bump [--kuru] | yaz [<sürüm>] | liste | kontrol
// bump   : index.html'deki style.css / config.js / app.js ?v= değerlerini YYYYMMDDHHMM yapar, sürümü yazdırır
// yaz    : docs/SURUMLER.md'yi git geçmişinden ("Surum: <v>" satırlı commit'ler) üretir; liste: aynısını ekrana yazar
// kontrol: üç ?v= aynı mı; varlıklar (app.js/style.css/config.js) en son değiştiği commit'te index.html de değişti mi
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.resolve(__dirname, '..');
const IDX = path.join(root, 'index.html'), LOG = path.join(root, 'docs', 'SURUMLER.md');
const RE = /((?:style\.css|config\.js|app\.js)\?v=)([^"'&\s]+)/g;
const git = a => cp.execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const p2 = n => String(n).padStart(2, '0');
const cmd = process.argv[2];

if (cmd === 'bump') {
  const d = new Date(), v = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}`;
  const s = fs.readFileSync(IDX, 'utf8'), n = (s.match(RE) || []).length;
  if (n !== 3) { console.error(`index.html'de 3 adet ?v= bekleniyordu, ${n} bulundu`); process.exit(1); }
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
} else if (cmd === 'kontrol') {
  const vs = [...new Set([...fs.readFileSync(IDX, 'utf8').matchAll(RE)].map(m => m[2]))];
  if (vs.length !== 1) { console.error('index.html: üç ?v= değeri aynı olmalı: ' + vs.join(', ')); process.exit(1); }
  const last = a => git(['log', '-1', '--format=%H', '--', ...a]);
  const asset = last(['app.js', 'style.css', 'config.js']), index = last(['index.html']);
  if (asset && asset !== index) {
    let ok = false; try { cp.execFileSync('git', ['merge-base', '--is-ancestor', asset, index], { cwd: root }); ok = true; } catch { /* değil */ }
    if (!ok) { console.error('app.js / style.css / config.js en son ' + asset.slice(0, 7) + ' commit\'inde değişti ama index.html (?v=) sonrasında güncellenmemiş. Kancalar kurulu mu? (git config core.hooksPath .githooks)'); process.exit(1); }
  }
  console.log('sürüm denetimi tamam: ' + vs[0]);
} else { console.error('kullanım: node tools/surum.js bump [--kuru] | yaz [<sürüm>] | liste | kontrol'); process.exit(2); }
