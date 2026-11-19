// Duman testi (bağımlılıksız; Node 22+ ve yerel Chrome/Edge gerekir): uygulamayı sahte veriyle (AcromeERP-tasarim/mock-*.js) headless açar,
// route()'taki tüm rotaları birkaç rolle gezer; konsol hatası / yakalanmamış istisna / boş sayfa sayar.
// Kullanım: node tools/duman.js [--hizli] [--taban-yaz] [--rol=admin]   (ortam: DUMAN_MOCK=<mock klasörü>, CHROME=<tarayıcı yolu>)
// Bilinen (kabul edilmiş) hatalar tools/duman-bilinen.json'da tutulur; yalnız YENİ hata testi düşürür.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), cp = require('child_process');
const root = process.env.DUMAN_KOK ? path.resolve(process.env.DUMAN_KOK) : path.resolve(__dirname, '..');   // DUMAN_KOK: deneme için başka app.js klasörü
const args = process.argv.slice(2), has = a => args.includes(a), opt = k => (args.find(a => a.startsWith(k + '=')) || '').split('=')[1];
const BASE_FILE = path.join(__dirname, 'duman-bilinen.json');

const mockDir = [process.env.DUMAN_MOCK, path.join(__dirname, '..', '..', 'AcromeERP-tasarim')].filter(Boolean).map(d => path.resolve(d)).find(d => fs.existsSync(path.join(d, 'mock.js')));
const chrome = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .filter(Boolean).find(p => fs.existsSync(p));
if (!mockDir || !chrome || typeof WebSocket === 'undefined') {
  console.warn(`duman: ATLANDI (${!mockDir ? 'sahte veri klasörü yok (DUMAN_MOCK)' : !chrome ? 'Chrome/Edge bulunamadı (CHROME)' : 'Node 22+ gerekir'}). Yalnız sözdizimi ve sürüm denetimi yapıldı.`);
  process.exit(0);
}

const ROLES = { admin: ['admin'], satis: ['sales', 'orders'], uretim: ['production'], alim: ['purchasing', 'stock'], kalite: ['kalite'], muhasebe: ['muhasebe'] };
const roleNames = opt('--rol') ? [opt('--rol')] : has('--hizli') ? ['admin', 'satis'] : ['admin', 'satis', 'uretim', 'alim'];
const WAIT = +process.env.DUMAN_BEKLE || 350;

// rotalar: route() gövdesindeki case 'x' ve p === 'x' ifadeleri + sahte veride var olan birkaç ayrıntı sayfası
const src = fs.readFileSync(path.join(root, 'app.js'), 'utf8'), i0 = src.indexOf('function route(){'), i1 = src.indexOf('\n}\n', i0), body = src.slice(i0, i1);
const routes = [...new Set([...body.matchAll(/case '([a-z0-9-]+)'/g), ...body.matchAll(/p === '([a-z0-9-]+)'/g)].map(m => m[1]))];
if (!routes.length) { console.error('duman: route() içinde rota bulunamadı (app.js yapısı değişti mi?)'); process.exit(1); }
const extra = ['kayit/1', 'support/1', 'alimlar/1', 'rma/1', 'stok/1', 'bom/1', 'kalite/i/ACR-LS-UY-01', 'kalite/m/uygunsuzluk', 'kalite/belgeler', 'kayitlar/production', 'kayitlar/pipeline', 'cihaz/ACRPO917-0101', 'kalite/denetim', 'kalite/hedefler', 'tedarikciler/1'];

const page = role => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><link rel="icon" href="data:,"></head><body>
<div id="app"><div class="boot">Yükleniyor…</div></div><div id="toast" role="status"></div>
${['mock-ortak', 'mock-satis', 'mock-alim', 'mock-ekip', 'mock'].map(f => `<script src="${f}.js"></script>`).join('\n')}
<script>{ const M = window.MOCK, me = M.T.profiles.find(p => p.id === M.ME), r = ${JSON.stringify(ROLES[role] || [role])}; me.roles = r; me.role = r.includes('admin') ? 'admin' : r[0]; }</script>
<script src="app.js"></script></body></html>`;
const MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), name = path.basename(u.pathname);
  if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': MIME['.html'] }); return res.end(page(u.searchParams.get('rol') || 'admin')); }
  const f = [path.join(root, name), path.join(mockDir, name)].find(p => /^[A-Za-z0-9._-]+$/.test(name) && fs.existsSync(p) && (name.startsWith('mock') ? p.startsWith(mockDir) : p.startsWith(root)));
  if (!f) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(f));
});

const norm = s => String(s).replace(/http:\/\/127\.0\.0\.1:\d+/g, '').replace(/:\d+:\d+/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port;
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'duman-'));
  const ch = cp.spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { ch.kill(); } catch {} try { server.close(); } catch {} setTimeout(() => { try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} }, 800); };
  try {
    let dp = path.join(prof, 'DevToolsActivePort'); for (let i = 0; i < 100 && !fs.existsSync(dp); i++) await sleep(100);
    if (!fs.existsSync(dp)) throw new Error('tarayıcı başlamadı');
    await sleep(200); const [cport, cpath] = fs.readFileSync(dp, 'utf8').trim().split(/\r?\n/);
    const ws = new WebSocket(`ws://127.0.0.1:${cport}${cpath}`); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0; const pend = new Map(); let onEv = () => {};
    ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { const { r, j } = pend.get(d.id); pend.delete(d.id); d.error ? j(new Error(d.error.message)) : r(d.result); } else onEv(d); };
    const send = (method, params = {}, sessionId) => new Promise((r, j) => { const i = ++id; pend.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
    const buckets = new Map();   // oturum -> o anki rotanın hata listesi (roller paralel, her biri kendi sekmesinde)
    onEv = d => { const bucket = buckets.get(d.sessionId); if (!bucket) return; const p = d.params || {};
      if (d.method === 'Runtime.exceptionThrown') bucket.push((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text);
      else if (d.method === 'Runtime.consoleAPICalled' && p.type === 'error') bucket.push(p.args.map(a => a.value ?? a.description ?? '').join(' '));
      else if (d.method === 'Log.entryAdded' && p.entry.level === 'error' && !/favicon/.test(p.entry.url || '')) bucket.push(p.entry.text + (p.entry.url ? ' ' + p.entry.url.replace(/^.*\//, '') : '')); };
    const found = [], t0 = Date.now(); let visited = 0;
    const runRole = async role => {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' }), { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const S = (m, p) => send(m, p, sessionId); await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable');
      const ev = async e => (await S('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;
      const bucket = []; buckets.set(sessionId, bucket); await S('Page.navigate', { url: `http://127.0.0.1:${port}/?rol=${role}` });
      let ok = false; for (let i = 0; i < 80 && !ok; i++) { await sleep(100); ok = await ev(`(() => { const a = document.getElementById('app'); return !!a && a.innerText.trim().length > 30 && !/^Yükleniyor/.test(a.innerText.trim()); })()`).catch(() => false); }
      await sleep(WAIT);
      for (const e of bucket.splice(0)) found.push({ role, route: '(açılış)', err: norm(e) });
      if (!ok) { found.push({ role, route: '(açılış)', err: 'uygulama açılmadı / boş' }); return; }
      for (const r of [...routes, ...extra]) {
        await ev(`location.hash = '#/${r}'`); await sleep(WAIT); visited++;
        const len = await ev(`document.getElementById('app').innerText.trim().length`);
        for (const e of bucket.splice(0)) found.push({ role, route: r, err: norm(e) });
        if (!len) found.push({ role, route: r, err: 'boş sayfa' });
      }
    };
    await Promise.all(roleNames.map(runRole));
    ws.close(); cleanup();
    const key = f => `${f.role}|${f.route}|${f.err}`, uniq = [...new Map(found.map(f => [key(f), f])).values()];
    if (has('--taban-yaz')) { fs.writeFileSync(BASE_FILE, JSON.stringify([...new Set(uniq.map(key))].sort(), null, 1) + '\n'); console.log(`duman: taban yazıldı (${uniq.length} kayıt)`); return process.exit(0); }
    const known = new Set(fs.existsSync(BASE_FILE) ? JSON.parse(fs.readFileSync(BASE_FILE, 'utf8')) : []), fresh = uniq.filter(f => !known.has(key(f)));
    console.log(`duman: ${roleNames.length} rol × ${routes.length + extra.length} rota (${visited} gezinti, ${Math.round((Date.now() - t0) / 1000)} sn); bilinen hata ${uniq.length - fresh.length}, YENİ hata ${fresh.length}`);
    fresh.slice(0, 25).forEach(f => console.log(`  [${f.role}] #/${f.route}: ${f.err}`));
    process.exit(fresh.length ? 1 : 0);
  } catch (e) { cleanup(); console.error('duman: araç hatası: ' + e.message); process.exit(1); }
})();
