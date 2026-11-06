/* Acrome Üretim Planlama — tek sayfa uygulama */
(() => {
'use strict';

// ---------------------------------------------------------------- sabitler
const STAGES = { qualify:'1 · Nitelendirme', advance:'2 · İlerliyor', closing:'3 · Kapanış', won:'Kazanıldı', lost:'Kaybedildi' };
const STATUSES = { pipeline:'Fırsat', production:'Üretimde', shipped:'Gönderildi', lost:'Kaybedildi', archived:'Arşiv' };
const ROLES = { pending:'Erişim kapalı', viewer:'İzleyici', sales:'Satış', production:'Üretim', support:'Sipariş + Support', admin:'Yönetici' };
const CATS = { sistem:'Deney setleri', kontrolcu:'Kontrolcüler', smd:'SMD' };
const CURRENCIES = ['USD','EUR','GBP','TRY'];
const MONTHS = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
const RE_ORDER = /^ACRPO-I?[0-9]{1,4}(-(SP|P)[0-9]{1,2})?$/;
const RE_OPP = /^PROS-[0-9]{2}(-[0-9]{1,3}){1,2}$/;
const MIN_DATE = '2020-01-01', MAX_DATE = '2035-12-31';
// Sevk tarihi bilinmiyorsa: sevk ayı (ayın 15'i) → istenen sevk → sipariş tarihi
const shipDate = d => d.ship_date || (d.ship_month ? d.ship_month + '-15' : null) || d.requested_ship_date || d.order_date || null;
const shipBasis = d => d.ship_date ? 'day' : d.ship_month ? 'month' : 'est';
const fmtM = m => m ? ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'][+m.slice(5,7)-1] + ' ' + m.slice(0,4) : '—';
const fmtShip = d => d.ship_date ? fmtD(d.ship_date) : d.ship_month ? fmtM(d.ship_month) + ' <span class="sub">(ay)</span>' : '—';

// ---------------------------------------------------------------- tema
const THEMES = { system:'Sistem', light:'Açık', dark:'Koyu' };
function getTheme(){ try { return localStorage.getItem('theme') || 'system'; } catch { return 'system'; } }
function setTheme(t){
  if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch {}
  qa('.theme button').forEach(b => b.setAttribute('aria-pressed', b.dataset.th === t));
}
const themeSwitch = () => `<div class="theme" role="group" aria-label="Görünüm">${Object.entries(THEMES).map(([k,v]) => `<button type="button" data-th="${k}" aria-pressed="${getTheme()===k}">${v}</button>`).join('')}</div>`;
document.addEventListener('click', e => { const b = e.target.closest('.theme button'); if (b) setTheme(b.dataset.th); });
setTheme(getTheme());

// ---------------------------------------------------------------- durum
const S = { session:null, profile:null, deals:[], customers:[], products:[], countries:[], issues:[], loaded:false };
const sb = window.MOCK_DB || window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseKey);
const $app = document.getElementById('app');

// ---------------------------------------------------------------- yardımcılar
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Date().toISOString().slice(0,10);
const fmtUSD = n => n == null ? '—' : '$' + Math.round(n).toLocaleString('tr-TR');
const fmtK = n => n == null ? '—' : (Math.abs(n) >= 1e6 ? '$' + (n/1e6).toLocaleString('tr-TR',{maximumFractionDigits:2}) + ' milyon' : Math.abs(n) >= 1e3 ? '$' + Math.round(n/1e3).toLocaleString('tr-TR') + ' bin' : '$' + Math.round(n));
const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('tr-TR',{day:'2-digit',month:'short',year:'numeric'}) : '—';
const fmtN = n => (+n).toLocaleString('tr-TR',{maximumFractionDigits:1});
const days = (a,b) => Math.round((new Date(b+'T00:00:00') - new Date(a+'T00:00:00'))/864e5);
const addDays = (d,n) => { const x = new Date(d+'T00:00:00'); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10); };
const yearOf = d => d ? +d.slice(0,4) : null;
const can = (...roles) => S.profile && roles.includes(S.profile.role);
const pill = st => `<span class="pill st-${st}">${STATUSES[st]||st}</span>`;
const prodName = c => (S.products.find(p => p.code === c) || {}).name || c;
const ctryName = c => (S.countries.find(x => x.code === c) || {}).name || c || '—';
const custName = d => d.customer_name || (S.customers.find(c => c.id === d.customer_id)||{}).name || '—';
const refNo = d => d.order_no || d.opp_no || '—';
function toast(msg, bad){ const t = document.getElementById('toast'); t.textContent = msg; t.className = 'show' + (bad?' bad':''); clearTimeout(t._h); t._h = setTimeout(()=> t.className='', 3500); }
function q(sel, root=document){ return root.querySelector(sel); }
function qa(sel, root=document){ return [...root.querySelectorAll(sel)]; }
function dbErr(e){
  const m = e?.message || String(e);
  if (/deals_order_no_uq/.test(m)) return 'Bu sipariş numarası zaten kayıtlı.';
  if (/deals_opp_no_uq/.test(m)) return 'Bu PROS numarası zaten kayıtlı.';
  if (/customers_name_uq/.test(m)) return 'Bu müşteri zaten kayıtlı.';
  if (/row-level security|permission/.test(m)) return 'Bu işlem için yetkiniz yok.';
  if (/stage_status_ok/.test(m)) return 'Aşama ile durum uyumsuz (sipariş = Kazanıldı, kayıp = Kaybedildi olmalı).';
  return m;
}

// ---------------------------------------------------------------- veri
async function loadAll(){
  const [d,c,p,k,i] = await Promise.all([
    sb.from('v_deals').select('*').order('id').range(0, 4999),
    sb.from('customers').select('*').order('name'),
    sb.from('products').select('*').order('sort'),
    sb.from('countries').select('*').order('name'),
    sb.from('import_issues').select('*').order('id'),
  ]);
  for (const r of [d,c,p,k,i]) if (r.error) throw r.error;
  S.deals = d.data; S.customers = c.data; S.products = p.data; S.countries = k.data; S.issues = i.data; S.loaded = true;
  await loadSupport();
  await loadRma();
}

// ---------------------------------------------------------------- oturum
async function boot(){
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  sb.auth.onAuthStateChange((ev, session) => {
    const had = !!S.session; S.session = session;
    if (ev === 'PASSWORD_RECOVERY') { location.hash = '#/sifre'; }
    if (!!session !== had) start();
  });
  start();
}
async function start(){
  if (!S.session) return renderAuth();
  const { data, error } = await sb.from('profiles').select('*').eq('id', S.session.user.id).maybeSingle();
  if (error) { $app.innerHTML = `<div class="boot">Profil okunamadı: ${esc(error.message)}</div>`; return; }
  S.profile = data || { role:'pending', email:S.session.user.email };
  if (S.profile.role === 'pending') return renderPending();
  try { await loadAll(); } catch(e){ $app.innerHTML = `<div class="boot">Veri okunamadı: ${esc(dbErr(e))}</div>`; return; }
  window.onhashchange = route; route();
}

function renderAuth(mode='in'){
  const up = mode === 'up', reset = mode === 'reset';
  $app.innerHTML = `<div class="auth"><div class="box">
    <div class="brand" style="padding:0">${logo()}<div>Acrome<small>Üretim planlama · Support</small></div></div>
    <h1 style="margin-top:18px">${reset?'Şifre sıfırla':up?'Hesap oluştur':'Giriş yap'}</h1>
    <p class="note">${up?'@acrome.net adresinle hesap açınca raporları ve kayıtları hemen görebilirsin. Veri girişi için yöneticiden Satış veya Üretim rolü iste.':reset?'E-posta adresine sıfırlama bağlantısı gönderilir.':'Acrome ekip hesabınla giriş yap.'}</p>
    <form id="af" novalidate>
      ${up?`<label class="f">Ad soyad<input name="name" type="text" required autocomplete="name"></label>`:''}
      <label class="f">E-posta${up?' <span class="hint">@acrome.net adresin</span>':''}<input name="email" type="email" required autocomplete="email" ${up?'placeholder="ad.soyad@acrome.net"':''}></label>
      ${reset?'':`<label class="f">Şifre${up?' <span class="hint">en az 8 karakter</span>':''}<input name="pw" type="password" required minlength="${up?8:1}" autocomplete="${up?'new-password':'current-password'}"></label>`}
      <div class="err-box" id="aerr"></div>
      <button class="btn primary" type="submit">${reset?'Bağlantı gönder':up?'Hesap oluştur':'Giriş yap'}</button>
    </form>
    ${themeSwitch()}
    <p class="note" style="margin-top:16px">${up||reset?`<button class="linkbtn" data-m="in">Girişe dön</button>`:`<button class="linkbtn" data-m="up">Hesap oluştur</button> · <button class="linkbtn" data-m="reset">Şifremi unuttum</button>`}</p>
  </div></div>`;
  qa('[data-m]').forEach(b => b.onclick = () => renderAuth(b.dataset.m));
  q('#af').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target); const err = q('#aerr'); err.textContent = '';
    const email = String(f.get('email')||'').trim(), pw = String(f.get('pw')||'');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = 'Geçerli bir e-posta gir.'; return; }
    if (up && !/@acrome\.net$/i.test(email)) { err.textContent = 'Yalnızca @acrome.net adresiyle hesap açılabilir.'; return; }
    let r;
    if (reset) { r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if (!r.error) { err.style.color='var(--green)'; err.textContent='Bağlantı gönderildi, e-postanı kontrol et.'; return; } }
    else if (up) {
      if (pw.length < 8) { err.textContent = 'Şifre en az 8 karakter olmalı.'; return; }
      r = await sb.auth.signUp({ email, password: pw, options:{ data:{ full_name:String(f.get('name')||'').trim() }, emailRedirectTo: location.origin + location.pathname } });
      if (!r.error && !r.data.session) { err.style.color='var(--green)'; err.textContent='Hesap oluşturuldu. E-postana gelen bağlantıyla doğrula, sonra giriş yap.'; return; }
    } else r = await sb.auth.signInWithPassword({ email, password: pw });
    if (r.error) err.textContent = /Database error saving new user|acrome\.net/.test(r.error.message) ? 'Yalnızca @acrome.net adresiyle hesap açılabilir.' : /Invalid login/.test(r.error.message) ? 'E-posta veya şifre hatalı.' : /not confirmed/.test(r.error.message) ? 'E-posta adresini henüz doğrulamadın.' : r.error.message;
  };
}
function renderPending(){
  $app.innerHTML = `<div class="auth"><div class="box"><h1>Erişimin kapalı</h1>
    <p>Hesabın (<b>${esc(S.profile.email)}</b>) şu an verilere erişemiyor. Yöneticiyle iletişime geç.</p>
    <p class="note">Rol verildikten sonra sayfayı yenile.</p>
    <p><button class="btn" id="rl">Yenile</button> <button class="btn" id="lo">Çıkış yap</button></p></div></div>`;
  q('#rl').onclick = start; q('#lo').onclick = () => sb.auth.signOut();
}
const logo = () => `<svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="6" fill="var(--brand)"/><path d="M8 23 16 8l8 15" stroke="var(--brand-ink)" stroke-width="3" fill="none"/></svg>`;

// ---------------------------------------------------------------- iskelet
function shell(active, html){
  const cnt = st => S.deals.filter(d => d.status === st).length;
  const openIssues = S.issues.filter(i => !i.resolved).length;
  const nav = [
    ['rapor','Rapor'],
    ['gonderim','Aylık gönderim raporu'],
    ['kayitlar/production','Üretimdeki siparişler', cnt('production')],
    ['kayitlar/pipeline','Açık fırsatlar', cnt('pipeline')],
    ['kayitlar/shipped','Gönderilenler', cnt('shipped')],
    ['kayitlar/all','Tüm kayıtlar', S.deals.length],
    ...(can('sales','support','admin') ? [['yeni','Yeni kayıt']] : []),
    ['hr'],
    ['support','Support', supOpenCount() || ''],
    ['rma','RMA', (S.rmas||[]).filter(rmaOpen).length || ''],
    ['bildirimler','Bildirimler', S.unread || ''],
    ['hr'],
    ['kaynaklar','Kaynak tablolar'],
    ['uyarilar','Veri kontrolü', (openIssues + liveProblemCount()) || ''],
    ['gecmis','Değişiklik geçmişi'],
    ...(can('admin') ? [['kullanicilar','Kullanıcılar']] : []),
    ...(can('admin') && !S.deals.length ? [['ice-aktar','Excel verisini içe aktar']] : []),
    ...(can('admin') && S.deals.length ? [['excel','Excel\'den güncelle']] : []),
  ];
  $app.innerHTML = `<div class="topbar"><div class="brand" style="padding:0">${logo()} Acrome</div><button class="btn sm" id="menu" aria-expanded="false">Menü</button></div>
  <div class="shell"><aside class="side" id="side">
    <div class="brand">${logo()}<div>Acrome<small>Üretim planlama · Support</small></div></div>
    <nav class="nav">${nav.map(n => n[0]==='hr' ? '<hr>' : `<a href="#/${n[0]}" class="${active===n[0]?'on':''}">${n[1]}<span class="count">${n[2]??''}</span></a>`).join('')}</nav>
    <div class="me"><b>${esc(S.profile.full_name || S.profile.email)}</b>${ROLES[S.profile.role]} · <button class="linkbtn" id="lo">Çıkış</button><br>${themeSwitch()}</div>
  </aside><main class="main" id="main">${html}</main></div>`;
  q('#lo').onclick = () => sb.auth.signOut();
  q('#menu').onclick = e => { const s = q('#side'); s.classList.toggle('open'); e.target.setAttribute('aria-expanded', s.classList.contains('open')); };
  qa('#side a').forEach(a => a.onclick = () => q('#side').classList.remove('open'));
}

function route(){
  const [p, a] = location.hash.replace(/^#\/?/,'').split('?')[0].split('/');
  window.scrollTo(0,0);
  switch(p){
    case 'kayitlar': return viewList(a || 'all');
    case 'gonderim': return viewShipments();
    case 'yeni': return can('sales','support','admin') ? viewForm(null) : viewReport();
    case 'kayit': return viewDetail(+a);
    case 'duzenle': return viewForm(+a);
    case 'kaynaklar': return viewSources(a || 'musteriler');
    case 'uyarilar': return viewIssues();
    case 'gecmis': return viewAudit();
    case 'kullanicilar': return can('admin') ? viewUsers() : viewReport();
    case 'sifre': return viewNewPassword();
    case 'ice-aktar': return can('admin') ? viewImport() : viewReport();
    case 'excel': return can('admin') ? viewSync() : viewReport();
    case 'support': return a ? viewTicket(+a) : viewSupport();
    case 'support-yeni': return canSup() ? viewTicketNew() : viewSupport();
    case 'bildirimler': return viewNotifications();
    case 'rma': return a ? viewRmaForm(+a) : viewRma();
    case 'rma-rapor': return viewRmaReport(a);
    case 'rma-yeni': { if (!canRma()) return viewRma(); const m = /^([td])(\d+)$/.exec(a||''); return viewRmaForm(null, m ? (m[1]==='t' ? { ticket_id:+m[2] } : { deal_id:+m[2] }) : {}); }
    default: return viewReport();
  }
}

// ---------------------------------------------------------------- RAPOR
let repYear = new Date().getFullYear();
function viewReport(){
  if (!S.deals.length) return shell('rapor', `<h1>Henüz kayıt yok</h1><p class="lede">${can('admin') ? 'Excel\'den hazırlanan veri dosyasını yükleyerek başla.' : 'Yönetici Excel verisini yükleyince rapor burada görünecek.'}</p>${can('admin') ? '<a class="btn primary" href="#/ice-aktar">Excel verisini içe aktar</a>' : ''}`);
  const Y = repYear, T = today();
  const live = S.deals.filter(d => !d.is_internal);
  const booked = y => live.filter(d => ['production','shipped'].includes(d.status) && yearOf(d.order_date) === y);
  const bookedY = booked(Y), bookedP = booked(Y-1);
  const sum = a => a.reduce((s,d) => s + (+d.amount_usd||0), 0);
  const prod = S.deals.filter(d => d.status === 'production');
  const late = prod.filter(d => d.requested_ship_date && d.requested_ship_date < T);
  const pipe = S.deals.filter(d => d.status === 'pipeline');
  const shippedY = S.deals.filter(d => d.status === 'shipped' && yearOf(shipDate(d)) === Y);
  const years = [...new Set(S.deals.map(d => yearOf(d.order_date)).filter(Boolean))].sort();
  const delta = sum(bookedP) ? Math.round((sum(bookedY)/sum(bookedP) - 1)*100) : null;

  // aylık
  const monthly = y => { const m = Array(12).fill(0); booked(y).forEach(d => m[+d.order_date.slice(5,7)-1] += +d.amount_usd||0); return m; };
  const mY = monthly(Y), mP = monthly(Y-1), mMax = Math.max(1, ...mY, ...mP);

  // ürün adetleri
  const units = {};
  const add = (d, key) => Object.entries(d.items||{}).forEach(([c,q]) => { units[c] = units[c] || {y:0, prod:0, pipe:0}; units[c][key] += +q; });
  booked(Y).forEach(d => add(d,'y')); prod.forEach(d => add(d,'prod')); pipe.forEach(d => add(d,'pipe'));
  const prodRows = S.products.filter(p => units[p.code]).map(p => ({...p, ...units[p.code], need: units[p.code].prod + units[p.code].pipe*0.1}));

  // ülkeler
  const byC = {}; bookedY.forEach(d => { const k = d.country || '—'; byC[k] = (byC[k]||0) + (+d.amount_usd||0); });
  const topC = Object.entries(byC).sort((a,b) => b[1]-a[1]).slice(0,8); const cMax = Math.max(1, ...topC.map(x=>x[1]));

  // fırsat aşamaları
  const byStage = ['qualify','advance','closing'].map(s => { const a = pipe.filter(d => d.stage === s); return [s, a.length, sum(a)]; });
  const sMax = Math.max(1, ...byStage.map(x=>x[2]));

  shell('rapor', `
  <div class="pagehead"><div><h1>Üretim ve satış raporu</h1><p class="lede">Rakamlar canlı veritabanından hesaplanır. Ciro, kazanılan siparişlerin sipariş tarihine göre toplamıdır (dahili siparişler hariç).</p></div>
    <label class="f" style="width:140px">Yıl<select id="yr">${years.map(y=>`<option ${y===Y?'selected':''}>${y}</option>`).join('')}</select></label></div>

  ${board(prod)}

  <div class="kpis">
    <div class="kpi"><div class="v">${fmtK(sum(bookedY))}</div><div class="l">${Y} sipariş cirosu</div><div class="d">${delta==null?'':`${delta>=0?'+':''}${delta}% · ${Y-1}: ${fmtK(sum(bookedP))}`}</div></div>
    <div class="kpi"><div class="v">${bookedY.length}</div><div class="l">${Y} kazanılan sipariş</div><div class="d">${shippedY.length} gönderildi</div></div>
    <div class="kpi"><div class="v">${prod.length}</div><div class="l">Üretimde</div><div class="d">${fmtK(sum(prod))} değerinde</div></div>
    <div class="kpi ${late.length?'alert':''}"><div class="v">${late.length}</div><div class="l">İstenen tarihi geçmiş</div><div class="d">${late.length?fmtK(sum(late)):'Geciken yok'}</div></div>
    <div class="kpi"><div class="v">${fmtK(sum(pipe))}</div><div class="l">Açık fırsat</div><div class="d">${pipe.length} fırsat</div></div>
  </div>

  <div class="grid g2">
    <section class="panel"><h2>Aylık sipariş cirosu</h2>
      <div class="legend"><span><i style="background:var(--data)"></i>${Y}</span><span><i style="background:var(--line)"></i>${Y-1}</span></div>
      <div class="bars" role="img" aria-label="${Y} ve ${Y-1} aylık sipariş cirosu">${mY.map((v,i)=>`<div class="m" title="${MONTHS[i]}: ${Y} ${fmtUSD(v)} · ${Y-1} ${fmtUSD(mP[i])}"><div class="pair"><div class="b prev" style="height:${mP[i]/mMax*100}%"></div><div class="b" style="height:${v/mMax*100}%"></div></div><div class="lbl">${MONTHS[i]}</div></div>`).join('')}</div>
    </section>
    <section class="panel"><h2>Açık fırsatlar (aşamaya göre)</h2>
      <div class="hbars">${byStage.map(([s,n,v]) => `<div class="hbar"><span class="k">${STAGES[s]} <span class="note">(${n})</span></span><span class="t"><i style="width:${v/sMax*100}%"></i></span><span class="n">${fmtK(v)}</span></div>`).join('')}</div>
      <h2 class="mt">${Y} ciro – ilk 8 ülke</h2>
      <div class="hbars">${topC.length ? topC.map(([c,v]) => `<div class="hbar"><span class="k">${esc(ctryName(c))}</span><span class="t"><i style="width:${v/cMax*100}%"></i></span><span class="n">${fmtK(v)}</span></div>`).join('') : '<p class="note">Bu yıl sipariş yok.</p>'}</div>
    </section>
  </div>

  <section class="mt"><h2>Ürün adetleri ve üretim ihtiyacı</h2>
    <p class="note" style="margin-top:-6px">Üretim ihtiyacı = üretimdeki siparişler + açık fırsatların %10'u (Excel'deki "Kaç üretelim" hesabı).</p>
    <div class="tablewrap"><table><thead><tr><th class="nosort">Ürün</th><th class="nosort num">${Y} sipariş</th><th class="nosort num">Üretimde</th><th class="nosort num">Fırsatlarda</th><th class="nosort num">Üretim ihtiyacı</th></tr></thead>
    <tbody>${prodRows.map(p => `<tr style="cursor:default"><td>${esc(p.name)} <span class="sub">${CATS[p.category]}</span></td><td class="num">${fmtN(p.y)}</td><td class="num">${fmtN(p.prod)}</td><td class="num">${fmtN(p.pipe)}</td><td class="num"><b>${Math.ceil(p.need)}</b></td></tr>`).join('')}</tbody></table></div>
  </section>`);
  q('#yr').onchange = e => { repYear = +e.target.value; viewReport(); };
  qa('.tl-row').forEach(r => r.onclick = () => location.hash = '#/kayit/' + r.dataset.id);
}

function board(prod){
  const T = today(), from = addDays(T, -45), to = addDays(T, 120), span = days(from, to);
  const pos = d => Math.max(0, Math.min(100, days(from, d)/span*100));
  const rows = [...prod].sort((a,b) => (a.requested_ship_date||'9999') < (b.requested_ship_date||'9999') ? -1 : 1);
  const ticks = []; { const d = new Date(from+'T00:00:00'); d.setDate(1); d.setMonth(d.getMonth()+1); while (d.toISOString().slice(0,10) < to) { const s = d.toISOString().slice(0,10); ticks.push(`<span style="left:${pos(s)}%">${MONTHS[d.getMonth()]}${d.getMonth()===0?' '+d.getFullYear():''}</span>`); d.setMonth(d.getMonth()+1);} }
  return `<section class="board"><div class="board-head"><h2>Sevkiyat takvimi — üretimdeki siparişler</h2>
    <div class="legend"><span><i style="background:var(--data-soft);border:1px solid var(--data)"></i>Sipariş → istenen sevk</span><span><i style="background:var(--amber-soft);border:1px solid var(--amber)"></i>14 gün içinde</span><span><i style="background:var(--red-soft);border:1px solid var(--red)"></i>Gecikmiş</span><span><i style="background:var(--violet);transform:rotate(45deg)"></i>Planlanan sevk</span></div></div>
    ${rows.length ? `<div class="tl" style="--lab:260px">
      <div class="tl-scale"><div></div><div class="ticks">${ticks.join('')}</div></div>
      ${rows.map(d => {
        const due = d.requested_ship_date, st = d.order_date || from;
        const left = pos(st), right = due ? pos(due) : left;
        const rem = due ? days(T, due) : null;
        const cls = rem == null ? '' : rem < 0 ? 'late' : rem <= 14 ? 'soon' : '';
        return `<div class="tl-row" data-id="${d.id}" title="${esc(refNo(d))} · ${esc(custName(d))}">
          <div class="tl-lab"><b>${esc(custName(d))}</b><span>${esc(refNo(d))} · ${esc(d.description)}</span></div>
          <div class="tl-track"><div class="tl-today" style="left:${pos(T)}%"></div>
            <div class="tl-bar ${cls}" style="left:${left}%;width:${Math.max(.6,right-left)}%"></div>
            ${due?`<div class="tl-due" style="left:${right}%"></div>`:''}
            ${d.planned_ship_date?`<div class="tl-plan" style="left:${pos(d.planned_ship_date)}%" title="Planlanan: ${fmtD(d.planned_ship_date)}"></div>`:''}
            <div class="tl-days ${cls}" style="left:${Math.min(right,88)}%">${rem==null?'tarih yok':rem<0?`${-rem} gün gecikti`:rem===0?'bugün':`${rem} gün`}</div>
          </div></div>`; }).join('')}
    </div>` : '<p class="tl-empty">Üretimde sipariş yok.</p>'}
  </section>`;
}

// ---------------------------------------------------------------- LİSTE
const listState = { q:'', year:'', month:'', basis:'', country:'', product:'', sort:'date', dir:-1 };
const MONTHS_LONG = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const BASES = { order:['Sipariş tarihi', d => d.order_date || d.lead_date], ship:['Sevk tarihi', d => shipDate(d)], due:['İstenen sevk', d => d.requested_ship_date], lead:['Fırsat girişi', d => d.lead_date || d.order_date] };
const defBasis = tab => tab === 'shipped' ? 'ship' : tab === 'pipeline' || tab === 'lost' || tab === 'archived' ? 'lead' : 'order';
function viewList(tab){
  const T = today();
  const tabs = { production:'Üretimde', pipeline:'Fırsatlar', shipped:'Gönderilenler', lost:'Kaybedilenler', archived:'Arşiv', all:'Tümü' };
  const base = tab === 'all' ? S.deals : S.deals.filter(d => d.status === tab);
  if (listState._tab !== tab) { listState._tab = tab; listState.basis = defBasis(tab); listState.year = ''; listState.month = ''; }
  const bdate = BASES[listState.basis][1];
  const years = [...new Set(base.map(d => yearOf(bdate(d))).filter(Boolean))].sort().reverse();
  const ctrs = [...new Set(base.map(d => d.country).filter(Boolean))].sort((a,b)=>ctryName(a).localeCompare(ctryName(b),'tr'));
  const draw = () => {
    const s = listState, ql = s.q.toLocaleLowerCase('tr');
    let rows = base.filter(d =>
      (!ql || [d.order_no,d.opp_no,custName(d),d.description,d.details,d.reseller,d.notes].join(' ').toLocaleLowerCase('tr').includes(ql)) &&
      (!s.year || yearOf(bdate(d)) === +s.year) &&
      (!s.month || (bdate(d) && +bdate(d).slice(5,7) === +s.month)) &&
      (!s.country || d.country === s.country) &&
      (!s.product || (d.items||{})[s.product]));
    const key = { date: d => d.order_date || d.lead_date || '', due: d => d.requested_ship_date || '9999', cust: d => custName(d).toLocaleLowerCase('tr'), amt: d => +d.amount_usd||0, ref: d => refNo(d) }[s.sort];
    rows.sort((a,b) => { const x = key(a), y = key(b); return (x<y?-1:x>y?1:0) * s.dir; });
    const total = rows.reduce((t,d) => t + (+d.amount_usd||0), 0);
    const ar = k => s.sort===k ? `<span class="ar">${s.dir>0?'▲':'▼'}</span>` : '';
    q('#tbl').innerHTML = rows.length ? `<table><thead><tr>
      <th data-s="ref">No ${ar('ref')}</th><th data-s="cust">Müşteri ${ar('cust')}</th><th class="nosort">Açıklama / ürünler</th>
      ${tab==='all'?'<th class="nosort">Durum</th>':''}
      <th data-s="date">${tab==='pipeline'?'Giriş':'Sipariş'} ${ar('date')}</th><th data-s="due">İstenen sevk ${ar('due')}</th>
      ${tab==='shipped'?'<th class="nosort">Sevk</th>':''}${tab==='pipeline'?'<th class="nosort">Aşama</th>':''}
      <th data-s="amt" class="num">Tutar ${ar('amt')}</th></tr></thead><tbody>
      ${rows.map(d => { const lt = d.status==='production' && d.requested_ship_date && d.requested_ship_date < T;
        return `<tr data-id="${d.id}"><td class="mono">${esc(refNo(d))}${d.order_no&&d.opp_no?`<div class="sub">${esc(d.opp_no)}</div>`:''}</td>
        <td>${esc(custName(d))}<div class="sub">${esc(ctryName(d.country))}</div></td>
        <td>${esc(d.description)}<div class="items">${Object.entries(d.items||{}).map(([c,q])=>`<span>${fmtN(q)}× ${esc(prodName(c))}</span>`).join('')}</div></td>
        ${tab==='all'?`<td>${pill(d.status)}</td>`:''}
        <td>${fmtD(d.order_date || d.lead_date)}</td><td class="${lt?'late-txt':''}">${fmtD(d.requested_ship_date)}${lt?`<div class="sub late-txt">${days(d.requested_ship_date,T)} gün gecikti</div>`:''}</td>
        ${tab==='shipped'?`<td>${fmtShip(d)}</td>`:''}${tab==='pipeline'?`<td>${STAGES[d.stage]}</td>`:''}
        <td class="num">${fmtUSD(d.amount_usd)}${d.currency!=='USD'&&d.amount_orig?`<div class="sub">${fmtN(d.amount_orig)} ${d.currency}</div>`:''}</td></tr>`; }).join('')}
      <tr class="tfoot"><td colspan="${tab==='all'||tab==='shipped'||tab==='pipeline'?6:5}">${rows.length} kayıt${s.year||s.month?` · ${BASES[s.basis][0].toLocaleLowerCase('tr')}: ${s.month?MONTHS_LONG[s.month-1]+' ':''}${s.year||'tüm yıllar'}`:''}</td><td class="num">${fmtUSD(total)}</td></tr>
      </tbody></table>` : `<div class="empty">Bu filtrelerle kayıt yok.${can('sales','support','admin')?' <a href="#/yeni">Yeni kayıt ekle</a>':''}</div>`;
    qa('#tbl th[data-s]').forEach(th => th.onclick = () => { const k = th.dataset.s; if (s.sort===k) s.dir*=-1; else { s.sort=k; s.dir = k==='cust'||k==='ref'||k==='due' ? 1 : -1; } draw(); });
    qa('#tbl tr[data-id]').forEach(tr => tr.onclick = () => location.hash = '#/kayit/' + tr.dataset.id);
    q('#csv').onclick = () => csv(rows, `acrome-${tab}-${T}.csv`);
  };
  if (tab === 'production' && listState.sort === 'date') { listState.sort = 'due'; listState.dir = 1; }
  shell('kayitlar/' + tab, `<div class="pagehead"><div><h1>${{production:'Üretimdeki siparişler',pipeline:'Açık fırsatlar',shipped:'Gönderilen siparişler',lost:'Kaybedilen fırsatlar',archived:'Arşiv',all:'Tüm kayıtlar'}[tab]}</h1>
    <p class="lede">${tab==='archived'?'Excel\'in eski yıllarında kalan ve 2026 listesine taşınmamış fırsatlar.':'Satıra tıklayınca kaydın detayı açılır.'}</p></div>
    <div style="display:flex;gap:8px"><button class="btn" id="csv">CSV indir</button>${can('sales','support','admin')?'<a class="btn primary" href="#/yeni">Yeni kayıt</a>':''}</div></div>
    <div class="toolbar"><div class="seg">${Object.entries(tabs).map(([k,v])=>`<button data-t="${k}" class="${k===tab?'on':''}">${v}</button>`).join('')}</div></div>
    <div class="toolbar">
      <input type="search" id="fq" placeholder="Ara: no, müşteri, açıklama…" value="${esc(listState.q)}" aria-label="Ara">
      <select id="fb" aria-label="Tarih esası" title="Yıl ve ay filtresi bu tarihe göre uygulanır">${Object.entries(BASES).map(([k,[l]])=>`<option value="${k}" ${listState.basis===k?'selected':''}>Tarih: ${l}</option>`).join('')}</select>
      <select id="fy" aria-label="Yıl"><option value="">Tüm yıllar</option>${years.map(y=>`<option ${+listState.year===y?'selected':''}>${y}</option>`).join('')}</select>
      <select id="fm" aria-label="Ay"><option value="">Tüm aylar</option>${MONTHS_LONG.map((m,i)=>`<option value="${i+1}" ${+listState.month===i+1?'selected':''}>${m}</option>`).join('')}</select>
      <select id="fc" aria-label="Ülke"><option value="">Tüm ülkeler</option>${ctrs.map(c=>`<option value="${c}" ${listState.country===c?'selected':''}>${esc(ctryName(c))}</option>`).join('')}</select>
      <select id="fp" aria-label="Ürün"><option value="">Tüm ürünler</option>${S.products.map(p=>`<option value="${p.code}" ${listState.product===p.code?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
    </div><div class="tablewrap" id="tbl"></div>`);
  qa('[data-t]').forEach(b => b.onclick = () => location.hash = '#/kayitlar/' + b.dataset.t);
  q('#fq').oninput = e => { listState.q = e.target.value; draw(); };
  q('#fy').onchange = e => { listState.year = e.target.value; draw(); };
  q('#fm').onchange = e => { listState.month = e.target.value; draw(); };
  q('#fb').onchange = e => { listState.basis = e.target.value; viewList(tab); };
  q('#fc').onchange = e => { listState.country = e.target.value; draw(); };
  q('#fp').onchange = e => { listState.product = e.target.value; draw(); };
  draw();
}
function csv(rows, name){
  const cols = [['No',refNo],['PROS',d=>d.opp_no],['Müşteri',custName],['Ülke',d=>ctryName(d.country)],['Açıklama',d=>d.description],['Aşama',d=>STAGES[d.stage]],['Durum',d=>STATUSES[d.status]],
    ['Fırsat girişi',d=>d.lead_date],['Sipariş tarihi',d=>d.order_date],['İstenen sevk',d=>d.requested_ship_date],['Planlanan sevk',d=>d.planned_ship_date],['Sevk tarihi',d=>d.ship_date],['Sevk ayı',d=>d.ship_month],
    ['Tutar USD',d=>d.amount_usd],['Para birimi',d=>d.currency],['Orijinal tutar',d=>d.amount_orig],...S.products.map(p=>[p.name,d=>(d.items||{})[p.code]||'']),['Detay',d=>d.details],['Ödeme',d=>d.payment_terms],['Not',d=>d.notes]];
  const cell = v => { v = v==null?'':String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v; };
  const txt = '﻿' + [cols.map(c=>c[0]).join(';'), ...rows.map(r => cols.map(c => cell(c[1](r))).join(';'))].join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt],{type:'text/csv;charset=utf-8'})); a.download = name; a.click();
}

// ---------------------------------------------------------------- AYLIK GÖNDERİM RAPORU
const shipState = { year: null, month: '', exactOnly: false, cat: 'all' };
function viewShipments(){
  const all = S.deals.filter(d => d.status === 'shipped' && shipDate(d));
  const years = [...new Set(all.map(d => yearOf(shipDate(d))))].sort();
  if (!shipState.year || !years.includes(shipState.year)) shipState.year = years.includes(new Date().getFullYear()) ? new Date().getFullYear() : years[years.length-1];
  const st = shipState, Y = st.year;
  const pool = all.filter(d => yearOf(shipDate(d)) === Y && (!st.exactOnly || shipBasis(d) !== 'est'));
  const inMonth = d => !st.month || +shipDate(d).slice(5,7) === +st.month;
  const rows = pool.filter(inMonth).sort((a,b) => shipDate(a) < shipDate(b) ? -1 : 1);
  const live = rows.filter(d => !d.is_internal);
  const sum = a => a.reduce((t,d) => t + (+d.amount_usd||0), 0);
  const est = rows.filter(d => shipBasis(d) === 'est').length, monthOnly = rows.filter(d => shipBasis(d) === 'month').length;
  const prods = S.products.filter(p => st.cat === 'all' || p.category === st.cat);
  const unitsOf = arr => { const u = {}; arr.forEach(d => Object.entries(d.items||{}).forEach(([c,q]) => u[c] = (u[c]||0) + +q)); return u; };
  const sysUnits = Object.entries(unitsOf(rows)).filter(([c]) => (S.products.find(p=>p.code===c)||{}).category === 'sistem').reduce((t,[,q]) => t+q, 0);

  // aylık seriler
  const byM = Array.from({length:12}, (_,i) => pool.filter(d => +shipDate(d).slice(5,7) === i+1));
  const mVal = byM.map(a => sum(a.filter(d=>!d.is_internal))), mMax = Math.max(1, ...mVal);
  const mUnits = byM.map(unitsOf);
  const usedProds = prods.filter(p => mUnits.some(u => u[p.code]));
  const canShip = can('production','sales','support','admin');

  shell('gonderim', `
  <div class="pagehead"><div><h1>Aylık gönderim raporu</h1>
    <p class="lede">Gönderilmiş siparişler sevk ayına göre. Gün bilinmiyorsa sevk ayı (Excel'in aylık toplamlarından) kullanılır; o da yoksa istenen sevk tarihi kullanılır ve ≈ ile gösterilir.</p></div>
    <div style="display:flex;gap:8px"><button class="btn" id="scsv">CSV indir</button></div></div>
  <div class="toolbar">
    <label class="f" style="width:120px">Yıl<select id="sy">${years.map(y=>`<option ${y===Y?'selected':''}>${y}</option>`).join('')}</select></label>
    <label class="f" style="width:150px">Ay<select id="sm"><option value="">Tüm yıl</option>${MONTHS.map((m,i)=>`<option value="${i+1}" ${+st.month===i+1?'selected':''}>${['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'][i]}</option>`).join('')}</select></label>
    <label class="f" style="width:170px">Ürün grubu<select id="sc"><option value="all">Tümü</option>${Object.entries(CATS).map(([k,v])=>`<option value="${k}" ${st.cat===k?'selected':''}>${v}</option>`).join('')}</select></label>
    <label style="display:flex;gap:6px;align-items:center;margin-top:20px;font-size:13px"><input type="checkbox" id="sx" ${st.exactOnly?'checked':''}> Tahmini olanları hariç tut</label>
  </div>
  ${est || monthOnly ? `<div class="banner">${rows.length} gönderimin ${rows.length-est-monthOnly} tanesinde sevk günü, <b>${monthOnly}</b> tanesinde yalnızca sevk ayı biliniyor${est?`; <b>${est}</b> tanesi istenen sevk tarihine göre tahmini sayıldı (≈)`:''}.${canShip?' Listeden gerçek sevk gününü girebilirsin.':''}</div>` : ''}

  <div class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">
    <div class="kpi"><div class="v">${rows.length}</div><div class="l">Gönderilen sipariş</div><div class="d">${st.month?MONTHS[st.month-1]+' '+Y:Y}</div></div>
    <div class="kpi"><div class="v">${fmtK(sum(live))}</div><div class="l">Gönderilen tutar</div><div class="d">dahili siparişler hariç</div></div>
    <div class="kpi"><div class="v">${fmtN(sysUnits)}</div><div class="l">Deney seti adedi</div><div class="d">kontrolcü ve SMD hariç</div></div>
    <div class="kpi"><div class="v">${new Set(rows.map(d=>d.country).filter(Boolean)).size}</div><div class="l">Ülke</div><div class="d">${new Set(rows.map(d=>d.customer_id)).size} müşteri</div></div>
  </div>

  <section class="panel"><h2>${Y} aylık gönderim tutarı</h2>
    <p class="note" style="margin-top:-6px">Bir aya tıklayınca liste o aya filtrelenir.</p>
    <div class="bars" style="height:200px">${mVal.map((v,i)=>`<button class="m" data-m="${i+1}" style="border:0;background:${+st.month===i+1?'var(--brand-soft)':'none'};cursor:pointer;border-radius:4px;padding:2px 0" title="${MONTHS[i]}: ${byM[i].length} sipariş, ${fmtUSD(v)}" aria-label="${MONTHS[i]}: ${byM[i].length} sipariş"><span style="font-size:11px;color:var(--muted)">${byM[i].length||''}</span><div class="pair"><div class="b" style="height:${v/mMax*100}%;width:60%;max-width:28px"></div></div><div class="lbl">${MONTHS[i]}</div></button>`).join('')}</div>
  </section>

  <section class="mt"><h2>Aylara göre gönderilen ürün adetleri — ${Y}</h2>
    <div class="tablewrap"><table><thead><tr><th class="nosort">Ürün</th>${MONTHS.map((m,i)=>`<th class="nosort num" style="${+st.month===i+1?'color:var(--brand)':''}">${m}</th>`).join('')}<th class="nosort num">Toplam</th></tr></thead><tbody>
    ${usedProds.length ? usedProds.map(p => { const t = mUnits.reduce((s,u)=>s+(u[p.code]||0),0); return `<tr style="cursor:default"><td>${esc(p.name)}</td>${mUnits.map((u,i)=>`<td class="num" style="${+st.month===i+1?'background:var(--brand-soft)':''}">${u[p.code]?fmtN(u[p.code]):''}</td>`).join('')}<td class="num"><b>${fmtN(t)}</b></td></tr>`; }).join('') : `<tr><td colspan="14" class="empty">Bu yıl ürün kalemi olan gönderim yok.</td></tr>`}
    </tbody></table></div></section>

  <section class="mt"><h2>Gönderilen siparişler${st.month?' — '+MONTHS[st.month-1]+' '+Y:' — '+Y}</h2>
    <div class="tablewrap">${rows.length ? `<table><thead><tr><th class="nosort">Sevk</th><th class="nosort">No</th><th class="nosort">Müşteri</th><th class="nosort">Açıklama / ürünler</th><th class="nosort num">Tutar</th></tr></thead><tbody>
    ${rows.map(d => `<tr data-id="${d.id}"><td style="white-space:nowrap">${d.ship_date ? fmtD(d.ship_date) : `${d.ship_month ? fmtShip(d) : `<span title="Sevk tarihi girilmemiş; istenen sevk tarihi">≈ ${fmtD(shipDate(d))}</span>`}${canShip?`<div><input type="date" class="shipin" data-sid="${d.id}" max="${today()}" min="${d.order_date||MIN_DATE}" aria-label="Gerçek sevk tarihi" style="min-height:28px;padding:2px 6px;font-size:12px;margin-top:4px;width:140px"></div>`:''}`}</td>
      <td class="mono">${esc(refNo(d))}</td><td>${esc(custName(d))}<div class="sub">${esc(ctryName(d.country))}</div></td>
      <td>${esc(d.description)}<div class="items">${Object.entries(d.items||{}).map(([c,q])=>`<span>${fmtN(q)}× ${esc(prodName(c))}</span>`).join('')}</div></td>
      <td class="num">${fmtUSD(d.amount_usd)}${d.is_internal?'<div class="sub">dahili</div>':''}</td></tr>`).join('')}
    <tr class="tfoot"><td colspan="4">${rows.length} sipariş</td><td class="num">${fmtUSD(sum(live))}</td></tr></tbody></table>` : '<div class="empty">Bu dönemde gönderim yok.</div>'}</div></section>`);

  q('#sy').onchange = e => { st.year = +e.target.value; viewShipments(); };
  q('#sm').onchange = e => { st.month = e.target.value; viewShipments(); };
  q('#sc').onchange = e => { st.cat = e.target.value; viewShipments(); };
  q('#sx').onchange = e => { st.exactOnly = e.target.checked; viewShipments(); };
  qa('.bars [data-m]').forEach(b => b.onclick = () => { st.month = String(+st.month === +b.dataset.m ? '' : b.dataset.m); viewShipments(); });
  qa('tr[data-id]').forEach(tr => tr.onclick = e => { if (!e.target.classList.contains('shipin')) location.hash = '#/kayit/' + tr.dataset.id; });
  qa('.shipin').forEach(inp => inp.onchange = async () => {
    const d = S.deals.find(x => x.id === +inp.dataset.sid); const v = inp.value; if (!v) return;
    if (v > today()) return toast('Sevk tarihi gelecekte olamaz', true);
    if (d.order_date && v < d.order_date) return toast('Sevk tarihi sipariş tarihinden önce olamaz', true);
    const { items, customer_name, ...deal } = d;
    const { error } = await sb.rpc('save_deal', { p_deal: { ...deal, ship_date: v }, p_items: null, p_customer_name: null, p_customer_country: null });
    if (error) return toast(dbErr(error), true);
    d.ship_date = v; toast(`${refNo(d)} sevk tarihi kaydedildi`); viewShipments();
  });
  q('#scsv').onclick = () => {
    const cols = [['Sevk tarihi',d=>d.ship_date||''],['Sevk ayı',d=>d.ship_month||''],['Tarih esası',d=>({day:'Sevk tarihi',month:'Sevk ayı',est:'İstenen sevk (tahmini)'})[shipBasis(d)]],['Rapor tarihi',shipDate],['No',refNo],['Müşteri',custName],['Ülke',d=>ctryName(d.country)],['Açıklama',d=>d.description],['Tutar USD',d=>d.amount_usd],['Dahili',d=>d.is_internal?'Evet':''],...S.products.map(p=>[p.name,d=>(d.items||{})[p.code]||''])];
    const cell = v => { v = v==null?'':String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v; };
    const txt = '﻿' + [cols.map(c=>c[0]).join(';'), ...rows.map(r => cols.map(c => cell(c[1](r))).join(';'))].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt],{type:'text/csv;charset=utf-8'})); a.download = `acrome-gonderim-${Y}${st.month?'-'+String(st.month).padStart(2,'0'):''}.csv`; a.click();
  };
}

// ---------------------------------------------------------------- DETAY
function viewDetail(id){
  const d = S.deals.find(x => x.id === id);
  if (!d) return shell('', `<h1>Kayıt bulunamadı</h1><p><a href="#/kayitlar/all">Tüm kayıtlara dön</a></p>`);
  const iss = S.issues.filter(i => i.deal_id === id && !i.resolved);
  const kv = (k,v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : '';
  shell('kayitlar/' + d.status, `
  <p><a href="#/kayitlar/${d.status}">← ${STATUSES[d.status]} listesi</a></p>
  <div class="pagehead"><div><h1>${esc(custName(d))}</h1><p class="lede"><span class="mono">${esc(refNo(d))}</span>${d.order_no&&d.opp_no?` · ${esc(d.opp_no)}`:''} · ${esc(d.description)}</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${pill(d.status)}
    ${can('sales','support','admin') && d.status==='pipeline' ? `<a class="btn primary" href="#/duzenle/${d.id}?siparis">Siparişe çevir</a>`:''}
    ${can('production') && d.status==='production' ? `<a class="btn primary" href="#/duzenle/${d.id}">Sevk bilgisi gir</a>`:''}
    ${can('sales','support','admin','production') ? `<a class="btn" href="#/duzenle/${d.id}">Düzenle</a>`:''}
    ${can('admin') ? `<button class="btn danger" id="del">Sil</button>`:''}</div></div>
  ${iss.length ? `<div class="banner"><b>Excel'den aktarımda düzeltilen alanlar:</b><br>${iss.map(i=>esc(i.message)).join('<br>')}</div>`:''}
  <div class="grid g2">
    <section class="panel"><h2>Bilgiler</h2><dl class="kv">
      ${kv('Ülke', esc(ctryName(d.country)))}${kv('Aşama', STAGES[d.stage])}${kv('Teklif no', esc(d.quote_no))}${kv('Bayi / aracı', esc(d.reseller))}
      ${kv('Fırsat girişi', d.lead_date && fmtD(d.lead_date))}${kv('Beklenen PO', d.expected_po_date && fmtD(d.expected_po_date))}${kv('Sipariş tarihi', d.order_date && fmtD(d.order_date))}
      ${kv('İstenen sevk', d.requested_ship_date && fmtD(d.requested_ship_date))}${kv('Planlanan sevk', d.planned_ship_date && fmtD(d.planned_ship_date))}${kv('Sevk tarihi', d.ship_date && fmtD(d.ship_date))}${kv('Sevk ayı', !d.ship_date && d.ship_month && fmtM(d.ship_month))}
      ${kv('Gecikme açıklaması', esc(d.delay_reason))}
    </dl></section>
    <section class="panel"><h2>Tutar ve ürünler</h2><dl class="kv">
      ${kv('Tutar (USD)', fmtUSD(d.amount_usd))}${d.currency!=='USD'?kv('Orijinal tutar', fmtN(d.amount_orig)+' '+d.currency):''}${kv('SMD satışı', d.smd_sales_usd!=null && fmtUSD(d.smd_sales_usd))}${kv('Ödeme planı', esc(d.payment_terms))}${d.is_internal?kv('Tür','Dahili (Acrome içi)'):''}
    </dl>
    ${Object.keys(d.items||{}).length ? `<table class="mt"><tbody>${Object.entries(d.items).map(([c,q])=>`<tr style="cursor:default"><td>${esc(prodName(c))}</td><td class="num">${fmtN(q)}</td></tr>`).join('')}</tbody></table>`:'<p class="note">Ürün kalemi yok.</p>'}
    </section>
  </div>
  ${rmaBox({ deal_id:d.id }, (S.rmas||[]).filter(x => x.deal_id === d.id), 'mt')}
  ${(S.tickets||[]).some(x => x.deal_id === d.id) ? `<section class="panel mt"><h2>Support konuları</h2><ul class="sugg">${S.tickets.filter(x => x.deal_id === d.id).map(x => `<li><a href="#/support/${x.id}"><span class="mono">#${x.id}</span> ${esc(x.subject)}</a> ${supPill(x.status)} <span class="sub">${fmtD(x.opened_at.slice(0,10))}</span></li>`).join('')}</ul></section>` : ''}
  <section class="panel mt"><h2>Açıklama ve notlar</h2><dl class="kv">${kv('Detay', esc(d.details))}${kv('Not', esc(d.notes))}${kv('Kaynak', esc(d.source))}${kv('Son güncelleme', new Date(d.updated_at).toLocaleString('tr-TR'))}</dl></section>`);
  const del = q('#del');
  if (del) del.onclick = async () => {
    if (del.dataset.c !== '1') { del.dataset.c = '1'; del.textContent = 'Silmeyi onayla'; return; }
    const { error } = await sb.from('deals').delete().eq('id', id);
    if (error) return toast(dbErr(error), true);
    S.deals = S.deals.filter(x => x.id !== id); toast('Kayıt silindi'); location.hash = '#/kayitlar/' + d.status;
  };
}

// ---------------------------------------------------------------- FORM
function viewForm(id){
  const ex = id ? S.deals.find(x => x.id === id) : null;
  if (id && !ex) return viewDetail(id);
  if (!can('sales','support','admin','production')) return viewDetail(id);
  const convert = /siparis/.test(location.hash);
  const prodOnly = can('production');
  const d = ex ? structuredClone(ex) : { status:'pipeline', stage:'qualify', currency:'USD', items:{}, lead_date: today() };
  if (convert) { d.status = 'production'; d.stage = 'won'; d.order_date = d.order_date || today(); }
  let kind = ['production','shipped'].includes(d.status) ? 'order' : 'opp';
  const cust = ex ? S.customers.find(c => c.id === ex.customer_id) : null;

  const stageOpts = () => kind==='order' ? ['won'] : ['qualify','advance','closing','lost'];
  const statusOpts = () => kind==='order' ? ['production','shipped'] : ['pipeline','lost','archived'];
  const dis = f => prodOnly && !['planned_ship_date','ship_date','ship_month','status','delay_reason'].includes(f) ? 'disabled' : '';
  const v = k => esc(d[k] ?? '');
  const dt = (k, label, hint) => `<label class="f">${label}${hint?` <span class="hint">${hint}</span>`:''}<input type="date" name="${k}" value="${v(k)}" min="${MIN_DATE}" max="${MAX_DATE}" ${dis(k)}><span class="err" data-e="${k}"></span></label>`;

  const html = () => `
  <p><a href="${ex?'#/kayit/'+ex.id:'#/kayitlar/all'}">← Vazgeç</a></p>
  <h1>${convert?'Fırsatı siparişe çevir':ex?'Kaydı düzenle':'Yeni kayıt'}</h1>
  <p class="lede">${prodOnly?'Üretim rolüyle yalnızca planlanan sevk, sevk tarihi, durum ve gecikme açıklamasını değiştirebilirsin.':'Kırmızı işaretli alanlar düzeltilmeden kayıt yapılamaz. Aynı kurallar veritabanında da uygulanır.'}</p>
  ${!ex ? `<div class="typepick"><button type="button" data-k="opp" class="${kind==='opp'?'on':''}"><b>Fırsat</b><span>Teklif aşamasındaki iş, PROS numarasıyla</span></button><button type="button" data-k="order" class="${kind==='order'?'on':''}"><b>Sipariş</b><span>Kazanılmış iş, ACRPO numarasıyla üretime girer</span></button></div>`:''}
  ${ex && S.issues.some(i => i.deal_id === ex.id && !i.resolved) ? `<div class="banner"><b>Bu kayıtla ilgili açık uyarılar</b><ul style="margin:6px 0 8px;padding-left:18px">${S.issues.filter(i => i.deal_id === ex.id && !i.resolved).map(i=>`<li>${esc(i.message)}</li>`).join('')}</ul>
    <label style="display:flex;gap:6px;align-items:center;font-weight:600"><input type="checkbox" id="resolveIss" checked> Kaydedince bu uyarıları düzeltildi say</label></div>` : ''}
  ${ex ? liveIssuesFor(ex).map(c => `<div class="banner info">Otomatik kontrol: <b>${esc(c.title)}</b> — ${esc(c.fix)}</div>`).join('') : ''}
  <form id="df" class="form" novalidate><div>
    <section class="fs"><h2>Müşteri ve numaralar</h2>
      <div class="row r2">
        <label class="f">Müşteri<input type="text" name="customer" list="custlist" value="${esc(cust?.name || '')}" autocomplete="off" ${dis('customer')} required><span class="hint">Listeden seç; listede yoksa yeni müşteri olarak eklenir</span><span class="err" data-e="customer"></span></label>
        <label class="f">Ülke<select name="country" ${dis('country')}><option value="">Seç…</option>${S.countries.map(c=>`<option value="${c.code}" ${d.country===c.code?'selected':''}>${esc(c.name)}</option>`).join('')}</select><span class="err" data-e="country"></span></label>
      </div>
      <datalist id="custlist">${S.customers.map(c=>`<option value="${esc(c.name)}">`).join('')}</datalist>
      <div class="row">
        <label class="f">PROS no <span class="hint">PROS-26-12</span><input type="text" name="opp_no" value="${v('opp_no')}" placeholder="PROS-26-…" ${dis('opp_no')}><span class="err" data-e="opp_no"></span></label>
        <label class="f">Sipariş no <span class="hint">ACRPO-550</span><input type="text" name="order_no" value="${v('order_no')}" placeholder="ACRPO-…" ${dis('order_no')}><span class="err" data-e="order_no"></span></label>
        <label class="f">Teklif no<input type="text" name="quote_no" value="${v('quote_no')}" ${dis('quote_no')}></label>
      </div>
      <div class="row r1"><label class="f">Açıklama<input type="text" name="description" value="${v('description')}" maxlength="300" ${dis('description')} required><span class="err" data-e="description"></span></label></div>
      <div class="row r2">
        <label class="f">Bayi / aracı<input type="text" name="reseller" value="${v('reseller')}" ${dis('reseller')}></label>
        <label class="f" style="flex-direction:row;align-items:center;gap:8px;margin-top:22px"><input type="checkbox" name="is_internal" ${d.is_internal?'checked':''} ${dis('is_internal')}> Dahili sipariş (Acrome içi, ciroya sayılmaz)</label>
      </div>
    </section>

    <section class="fs"><h2>Aşama ve tarihler</h2>
      <div class="row">
        <label class="f">Durum<select name="status" ${dis('status')}>${statusOpts().map(s=>`<option value="${s}" ${d.status===s?'selected':''}>${STATUSES[s]}</option>`).join('')}</select></label>
        <label class="f">Aşama<select name="stage" ${dis('stage')}>${stageOpts().map(s=>`<option value="${s}" ${d.stage===s?'selected':''}>${STAGES[s]}</option>`).join('')}</select></label>
        <span></span>
      </div>
      <div class="row">${kind==='opp' ? dt('lead_date','Fırsat girişi') + dt('expected_po_date','Beklenen PO tarihi') : dt('order_date','Sipariş tarihi')}${dt('requested_ship_date','İstenen sevk')}</div>
      ${kind==='order' ? `<div class="row">${dt('planned_ship_date','Planlanan sevk','üretim doldurur')}${dt('ship_date','Sevk tarihi','gönderildiğinde')}<label class="f">Sevk ayı <span class="hint">gün bilinmiyorsa</span><input type="month" name="ship_month" value="${v('ship_month')}" min="2020-01" max="2035-12" ${dis('ship_month')}><span class="err" data-e="ship_month"></span></label></div>
      <div class="row r1"><label class="f">Gecikme açıklaması<input type="text" name="delay_reason" value="${v('delay_reason')}" ${dis('delay_reason')}></label></div>` : ''}
    </section>

    <section class="fs"><h2>Ürünler</h2><div class="prodgrid">
      ${Object.entries(CATS).map(([cat,cl]) => `<div class="cat">${cl}</div>` + S.products.filter(p=>p.category===cat && (p.active || (d.items||{})[p.code])).map(p => `<label>${esc(p.name)}<input type="number" min="0" max="1000" step="any" inputmode="decimal" name="item_${p.code}" value="${(d.items||{})[p.code]||''}" ${dis('items')} aria-label="${esc(p.name)} adedi"></label>`).join('')).join('')}
    </div><span class="err" data-e="items"></span></section>

    <section class="fs"><h2>Tutar ve ödeme</h2>
      <div class="row r4">
        <label class="f">Para birimi<select name="currency" ${dis('currency')}>${CURRENCIES.map(c=>`<option ${d.currency===c?'selected':''}>${c}</option>`).join('')}</select></label>
        <label class="f orig">Orijinal tutar<input type="number" name="amount_orig" min="0" step="0.01" value="${v('amount_orig')}" ${dis('amount_orig')}><span class="err" data-e="amount_orig"></span></label>
        <label class="f orig">Kur (1 birim = ? USD)<input type="number" name="rate" min="0" step="0.0001" ${dis('amount_orig')}></label>
        <label class="f">Tutar (USD)<input type="number" name="amount_usd" step="0.01" value="${v('amount_usd')}" ${dis('amount_usd')}><span class="err" data-e="amount_usd"></span></label>
      </div>
      <div class="row r2">
        <label class="f">SMD satış tutarı (USD)<input type="number" name="smd_sales_usd" min="0" step="0.01" value="${v('smd_sales_usd')}" ${dis('smd_sales_usd')}></label>
        <label class="f">Ödeme planı<input type="text" name="payment_terms" value="${v('payment_terms')}" placeholder="%50 ön ödeme, %50 teslimatta" ${dis('payment_terms')}></label>
      </div>
      <div class="row r2">
        <label class="f">Detay<textarea name="details" ${dis('details')}>${v('details')}</textarea></label>
        <label class="f">Not<textarea name="notes" ${dis('notes')}>${v('notes')}</textarea></label>
      </div>
    </section></div>

    <aside class="sticky"><section class="fs"><h2>Kontrol listesi</h2><ul class="checklist" id="chk"></ul>
      <button class="btn primary" type="submit" style="width:100%;justify-content:center" id="save">${ex?'Değişiklikleri kaydet':'Kaydı oluştur'}</button>
      <p class="note" style="margin-top:10px">Kayıt sonrası değişiklik geçmişine kim ve ne zaman değiştirdi bilgisi yazılır.</p></section></aside>
  </form>`;

  const mount = () => {
    shell(ex ? 'kayitlar/'+ex.status : 'yeni', html());
    qa('[data-k]').forEach(b => b.onclick = () => { collect(); kind = b.dataset.k;
      if (kind==='order'){ d.status='production'; d.stage='won'; d.order_date = d.order_date || today(); } else { d.status='pipeline'; d.stage='qualify'; d.lead_date = d.lead_date || today(); }
      mount(); });
    const f = q('#df');
    f.addEventListener('input', onChange); f.addEventListener('change', onChange);
    f.onsubmit = submit;
    onChange();
  };
  const F = () => q('#df');
  function collect(){
    const f = F(); if (!f) return;
    for (const el of f.elements) {
      if (!el.name || el.name === 'rate') continue;
      if (el.name.startsWith('item_')) { const c = el.name.slice(5); d.items = d.items || {}; if (el.value) d.items[c] = +el.value; else delete d.items[c]; continue; }
      if (el.type === 'checkbox') d[el.name] = el.checked; else d[el.name] = el.value.trim();
    }
  }
  function normNo(el, re, prefix){
    let s = el.value.toUpperCase().replace(/\s+/g,' ').trim();
    if (prefix==='ACRPO') s = s.replace(/^ACRPO\s*-?\s*/,'ACRPO-').replace(/\s*-\s*/g,'-').replace(/ /g,'-');
    if (prefix==='PROS') s = s.replace(/^PROS\s*-?\s*/,'PROS-').replace(/[\s.]+/g,'-').replace(/-+/g,'-');
    if (s !== el.value) el.value = s;
  }
  function onChange(e){
    const f = F();
    if (e && e.target.name === 'order_no') normNo(e.target, RE_ORDER, 'ACRPO');
    if (e && e.target.name === 'opp_no') normNo(e.target, RE_OPP, 'PROS');
    if (e && e.target.name === 'customer') { const c = S.customers.find(x => x.name.toLocaleLowerCase('tr') === e.target.value.trim().toLocaleLowerCase('tr')); if (c && c.country && !f.country.value) f.country.value = c.country; }
    if (e && (e.target.name === 'status')) { if (f.status.value === 'lost') f.stage.value = 'lost'; else if (f.stage.value === 'lost' && kind==='opp') f.stage.value = 'closing'; }
    if (e && e.target.name === 'stage') { if (f.stage.value === 'lost') f.status.value = 'lost'; else if (f.status.value === 'lost') f.status.value = 'pipeline'; }
    const cur = f.currency.value;
    qa('.orig', f).forEach(l => l.style.display = cur === 'USD' ? 'none' : '');
    if (e && ['amount_orig','rate'].includes(e.target.name) && f.rate.value && f.amount_orig.value) f.amount_usd.value = (+f.amount_orig.value * +f.rate.value).toFixed(2);
    validate(false);
  }
  function validate(show){
    collect();
    const f = F(), errs = {}, T = today();
    const custTxt = (d.customer||'').trim();
    const existingCust = S.customers.find(c => c.name.toLocaleLowerCase('tr') === custTxt.toLocaleLowerCase('tr'));
    if (custTxt.length < 2) errs.customer = 'Müşteri adı gir.';
    if (!d.country) errs.country = existingCust ? 'Ülke seç.' : 'Yeni müşteri için ülke zorunlu.';
    if ((d.description||'').length < 2) errs.description = 'Kısa bir açıklama yaz.';
    if (d.opp_no && !RE_OPP.test(d.opp_no)) errs.opp_no = 'Biçim: PROS-26-12 veya PROS-26-05-03';
    if (d.order_no && !RE_ORDER.test(d.order_no)) errs.order_no = 'Biçim: ACRPO-550, ACRPO-I27 veya ACRPO-488-SP1';
    if (d.order_no && S.deals.some(x => x.order_no === d.order_no && x.id !== d.id)) errs.order_no = 'Bu sipariş numarası başka bir kayıtta var.';
    if (d.opp_no && !d.order_no && S.deals.some(x => x.opp_no === d.opp_no && !x.order_no && x.id !== d.id)) errs.opp_no = 'Bu PROS numarası başka bir fırsatta var.';
    if (kind==='opp' && d.status==='pipeline' && !d.opp_no) errs.opp_no = 'Açık fırsat için PROS numarası zorunlu.';
    if (kind==='order' && !d.order_no && !d.is_internal) errs.order_no = 'Sipariş için ACRPO numarası zorunlu.';
    if (kind==='order' && !d.order_date) errs.order_date = 'Sipariş tarihi zorunlu.';
    for (const k of ['lead_date','order_date','expected_po_date','requested_ship_date','planned_ship_date','ship_date']) if (d[k] && (d[k] < MIN_DATE || d[k] > MAX_DATE)) errs[k] = `${MIN_DATE.slice(0,4)}–${MAX_DATE.slice(0,4)} arasında olmalı.`;
    if (d.requested_ship_date && d.order_date && d.requested_ship_date < d.order_date) errs.requested_ship_date = 'Sipariş tarihinden önce olamaz.';
    if (d.ship_date && d.order_date && d.ship_date < d.order_date) errs.ship_date = 'Sipariş tarihinden önce olamaz.';
    if (d.ship_date && d.ship_date > addDays(T,1)) errs.ship_date = 'Gelecek tarih olamaz; planlanan sevk alanını kullan.';
    if (d.status === 'shipped' && !d.ship_date && !d.ship_month) errs.ship_date = 'Gönderildi için sevk tarihi (ya da en azından sevk ayı) zorunlu.';
    if (d.ship_month && !/^20[2-3][0-9]-(0[1-9]|1[0-2])$/.test(d.ship_month)) errs.ship_month = 'Ay seç.';
    if (d.ship_date && d.ship_month && d.ship_date.slice(0,7) !== d.ship_month) errs.ship_month = 'Sevk tarihiyle aynı ay olmalı (ya da boş bırak).';
    if (d.amount_usd !== '' && d.amount_usd != null && (isNaN(+d.amount_usd) || Math.abs(+d.amount_usd) >= 1e7)) errs.amount_usd = '10 milyondan küçük olmalı (iade için eksi girilebilir).';
    if (d.currency !== 'USD' && !d.amount_orig) errs.amount_orig = `${d.currency} tutarını gir.`;
    const badQty = Object.entries(d.items||{}).find(([,q]) => isNaN(+q) || +q < 0 || +q > 1000 || Math.round(+q*100) !== +q*100);
    if (badQty) errs.items = `${prodName(badQty[0])}: adet 0–1000 arası olmalı.`;
    if (kind==='order' && !Object.keys(d.items||{}).length && !d.amount_usd) errs.items = 'Sipariş için en az bir ürün ya da tutar gir.';

    qa('[data-e]', f).forEach(s => { const k = s.dataset.e; const m = errs[k]; s.textContent = show || f.dataset.tried ? (m||'') : '';
      const inp = f.elements[k] || f.elements['item_'+k]; if (inp && inp.setAttribute) inp.setAttribute('aria-invalid', !!(m && (show || f.dataset.tried))); });
    const checks = [
      ['Müşteri ve ülke', !errs.customer && !errs.country],
      [kind==='order'?'Sipariş numarası (benzersiz)':'PROS numarası (benzersiz)', !errs.order_no && !errs.opp_no],
      ['Açıklama', !errs.description],
      ['Tarihler tutarlı', !['lead_date','order_date','expected_po_date','requested_ship_date','planned_ship_date','ship_date'].some(k=>errs[k])],
      ['Ürün adetleri', !errs.items],
      ['Tutar ve para birimi', !errs.amount_usd && !errs.amount_orig],
    ];
    q('#chk').innerHTML = checks.map(([t,ok]) => `<li class="${ok?'ok':(f.dataset.tried?'bad':'')}">${t}</li>`).join('') + (!existingCust && custTxt.length>=2 ? `<li class="ok">Yeni müşteri eklenecek: ${esc(custTxt)}</li>` : '');
    return errs;
  }
  async function submit(e){
    e.preventDefault(); const f = F(); f.dataset.tried = '1';
    const errs = validate(true);
    if (Object.keys(errs).length) { toast(`${Object.keys(errs).length} alan düzeltilmeli`, true); const first = qa('[aria-invalid=true]', f)[0]; first && first.focus(); return; }
    const btn = q('#save'); btn.disabled = true; btn.textContent = 'Kaydediliyor…';
    const existingCust = S.customers.find(c => c.name.toLocaleLowerCase('tr') === d.customer.toLocaleLowerCase('tr'));
    const payload = {};
    for (const k of ['id','order_no','opp_no','country','description','stage','status','quote_no','lead_date','order_date','expected_po_date','requested_ship_date','planned_ship_date','ship_date','ship_month','details','delay_reason','payment_terms','notes','reseller','amount_usd','currency','amount_orig','smd_sales_usd','is_internal'])
      payload[k] = d[k] === '' ? null : d[k] ?? null;
    if (kind==='opp') { payload.order_date = d.order_date || null; }
    if (payload.currency === 'USD') payload.amount_orig = null;
    payload.customer_id = existingCust ? existingCust.id : null;
    const { data, error } = await sb.rpc('save_deal', { p_deal: payload, p_items: prodOnly ? null : (d.items||{}), p_customer_name: existingCust ? null : d.customer, p_customer_country: d.country || null });
    if (error) { btn.disabled = false; btn.textContent = ex ? 'Değişiklikleri kaydet' : 'Kaydı oluştur'; return toast(dbErr(error), true); }
    const ri = q('#resolveIss');
    if (ex && ri && ri.checked) { const ids = S.issues.filter(i => i.deal_id === ex.id && !i.resolved).map(i => i.id); if (ids.length) await sb.from('import_issues').update({ resolved:true }).in('id', ids); }
    await loadAll();
    toast(ex ? 'Değişiklikler kaydedildi' : 'Kayıt oluşturuldu');
    location.hash = '#/kayit/' + data;
  }
  mount();
}

// ---------------------------------------------------------------- KAYNAK TABLOLAR
function viewSources(tab){
  const tabs = { musteriler:'Müşteriler', urunler:'Ürünler', ulkeler:'Ülkeler' };
  let body = '';
  if (tab === 'musteriler') {
    const agg = {}; S.deals.forEach(d => { const a = agg[d.customer_id] = agg[d.customer_id] || {n:0, won:0, amt:0, last:''}; a.n++; if (['production','shipped'].includes(d.status)) { a.won++; a.amt += +d.amount_usd||0; } const dt = d.order_date||d.lead_date||''; if (dt > a.last) a.last = dt; });
    body = `<div class="toolbar"><input type="search" id="sq" placeholder="Müşteri ara…" aria-label="Müşteri ara"></div>
    <div class="tablewrap"><table><thead><tr><th class="nosort">Müşteri</th><th class="nosort">Ülke</th><th class="nosort num">Kayıt</th><th class="nosort num">Sipariş</th><th class="nosort num">Toplam ciro</th><th class="nosort">Son hareket</th>${can('sales','support','admin')?'<th class="nosort"></th>':''}</tr></thead>
    <tbody id="sb">${S.customers.map(c => { const a = agg[c.id]||{n:0,won:0,amt:0,last:''}; return `<tr data-n="${esc(c.name.toLocaleLowerCase('tr'))}" style="cursor:default"><td>${esc(c.name)}</td><td>${esc(ctryName(c.country))}</td><td class="num">${a.n}</td><td class="num">${a.won}</td><td class="num">${fmtUSD(a.amt)}</td><td>${fmtD(a.last)}</td>${can('sales','support','admin')?`<td><button class="btn sm" data-ec="${c.id}">Düzenle</button></td>`:''}</tr>`; }).join('')}</tbody></table></div>`;
  } else if (tab === 'urunler') {
    body = `<p class="note">Yeni ürün kolonu eklemek için Excel'de sütun açmak yerine buraya ürün eklenir; tüm formlar ve raporlar otomatik güncellenir.</p>
    <div class="tablewrap"><table><thead><tr><th class="nosort">Kod</th><th class="nosort">Ad</th><th class="nosort">Grup</th><th class="nosort">Durum</th>${can('admin')?'<th class="nosort"></th>':''}</tr></thead><tbody>
    ${S.products.map(p => `<tr style="cursor:default"><td class="mono">${p.code}</td><td>${esc(p.name)}</td><td>${CATS[p.category]}</td><td>${p.active?'Aktif':'Pasif'}</td>${can('admin')?`<td><button class="btn sm" data-tp="${p.code}">${p.active?'Pasifleştir':'Aktifleştir'}</button></td>`:''}</tr>`).join('')}</tbody></table></div>
    ${can('admin')?`<form class="fs mt" id="pf" novalidate><h2>Ürün ekle</h2><div class="row r4">
      <label class="f">Kod <span class="hint">BÜYÜK_HARF</span><input name="code" type="text" required pattern="[A-Z0-9_]{2,20}"></label>
      <label class="f">Ad<input name="name" type="text" required></label>
      <label class="f">Grup<select name="category">${Object.entries(CATS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
      <label class="f">Sıra<input name="sort" type="number" value="50"></label></div><button class="btn primary">Ürünü ekle</button></form>`:''}`;
  } else {
    const used = new Set(S.deals.map(d=>d.country));
    body = `<div class="tablewrap"><table><thead><tr><th class="nosort">Kod</th><th class="nosort">Ülke</th><th class="nosort num">Kayıt</th></tr></thead><tbody>
    ${S.countries.map(c => `<tr style="cursor:default"><td class="mono">${c.code}</td><td>${esc(c.name)}</td><td class="num">${S.deals.filter(d=>d.country===c.code).length||''}</td></tr>`).join('')}</tbody></table></div>`;
  }
  shell('kaynaklar', `<div class="pagehead"><div><h1>Kaynak tablolar</h1><p class="lede">Formlardaki açılır listeler bu tablolardan gelir; böylece aynı müşteri, ülke ya da ürün farklı yazılamaz.</p></div></div>
    <div class="toolbar"><div class="seg">${Object.entries(tabs).map(([k,v])=>`<button data-st="${k}" class="${k===tab?'on':''}">${v}</button>`).join('')}</div></div>${body}`);
  qa('[data-st]').forEach(b => b.onclick = () => location.hash = '#/kaynaklar/' + b.dataset.st);
  const sq = q('#sq'); if (sq) sq.oninput = () => { const v = sq.value.toLocaleLowerCase('tr'); qa('#sb tr').forEach(r => r.style.display = r.dataset.n.includes(v) ? '' : 'none'); };
  qa('[data-ec]').forEach(b => b.onclick = () => editCustomer(+b.dataset.ec, b.closest('tr')));
  qa('[data-tp]').forEach(b => b.onclick = async () => { const p = S.products.find(x=>x.code===b.dataset.tp); const { error } = await sb.from('products').update({ active: !p.active }).eq('code', p.code); if (error) return toast(dbErr(error), true); await loadAll(); viewSources('urunler'); });
  const pf = q('#pf'); if (pf) pf.onsubmit = async e => { e.preventDefault(); const f = new FormData(pf); const code = String(f.get('code')).trim().toUpperCase(), name = String(f.get('name')).trim();
    if (!/^[A-Z0-9_]{2,20}$/.test(code)) return toast('Kod 2–20 karakter, büyük harf/rakam/alt çizgi olmalı', true); if (name.length < 2) return toast('Ürün adı gir', true);
    const { error } = await sb.from('products').insert({ code, name, category: f.get('category'), sort: +f.get('sort')||50 }); if (error) return toast(dbErr(error), true); await loadAll(); toast('Ürün eklendi'); viewSources('urunler'); };
}
function confirmInline(btn, label){ if (btn.dataset.c === '1') return true; btn.dataset.c = '1'; btn.textContent = 'Onayla'; toast(label); return false; }
function editCustomer(id, tr){
  const c = S.customers.find(x => x.id === id);
  tr.innerHTML = `<td><input type="text" value="${esc(c.name)}" id="cn"></td><td><select id="cc">${S.countries.map(k=>`<option value="${k.code}" ${c.country===k.code?'selected':''}>${esc(k.name)}</option>`).join('')}</select></td><td colspan="4">${can('admin')?`<label class="f" style="font-weight:500">Bu müşteriyi şununla birleştir<select id="cm"><option value="">—</option>${S.customers.filter(x=>x.id!==id).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>`:''}</td><td style="white-space:nowrap"><button class="btn sm primary" id="cs">Kaydet</button> <button class="btn sm" id="cx">Vazgeç</button></td>`;
  q('#cx').onclick = () => viewSources('musteriler');
  q('#cs').onclick = async () => { const name = q('#cn').value.trim(); if (name.length < 2) return toast('Müşteri adı gir', true);
    const cm = q('#cm'); if (cm && cm.value) { const target = S.customers.find(x => x.id === +cm.value); if (!confirmInline(q('#cs'), `"${c.name}" kayıtları "${target.name}" altına taşınsın mı? Tekrar bas`)) return; return mergeCustomers(+cm.value, id, () => viewSources('musteriler')); }
    const { error } = await sb.from('customers').update({ name, country: q('#cc').value }).eq('id', id); if (error) return toast(dbErr(error), true); await loadAll(); toast('Müşteri güncellendi'); viewSources('musteriler'); };
}

// ---------------------------------------------------------------- VERİ KONTROLÜ
const fold = x => String(x||'').toLocaleLowerCase('tr').replace(/ı/g,'i').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');
const CHECKS = [
  { id:'noship', title:'Gönderilmiş ama sevk tarihi de sevk ayı da yok', fix:'Sevk tarihini ya da en azından sevk ayını gir.', test: d => d.status==='shipped' && !d.ship_date && !d.ship_month, show: d => `İstenen sevk: ${fmtD(d.requested_ship_date)}` },
  { id:'noorderno', title:'Kazanılmış ama sipariş numarası yok', fix:'ACRPO numarasını gir.', test: d => d.stage==='won' && !d.order_no && !d.is_internal, show: d => d.notes ? esc(d.notes.split('\n').find(l=>/Excel sipariş no/.test(l))||'') : '' },
  { id:'noorderdate', title:'Siparişte sipariş tarihi yok', fix:'Sipariş tarihini gir.', test: d => ['production','shipped'].includes(d.status) && !d.order_date, show: () => '' },
  { id:'nocountry', title:'Ülke boş', fix:'Ülkeyi seç.', test: d => !d.country, show: () => '' },
  { id:'lostzero', title:'Kaybedilen fırsatta teklif tutarı yok', fix:'Teklif tutarını gir; kayıp tutarı ve kazanma oranı buna göre hesaplanır.', test: d => d.status==='lost' && !(+d.amount_usd), show: () => '' },
  { id:'reqbefore', title:'İstenen sevk, sipariş tarihinden önce', fix:'Tarihlerden birini düzelt.', test: d => d.requested_ship_date && d.order_date && d.requested_ship_date < d.order_date, show: d => `Sipariş ${fmtD(d.order_date)} · İstenen ${fmtD(d.requested_ship_date)}` },
  { id:'longlate', title:'Üretimde, istenen tarihten 60 günden fazla geçmiş', fix:'Gönderildiyse durumu güncelle; değilse yeni istenen tarihi gir.', test: d => d.status==='production' && d.requested_ship_date && days(d.requested_ship_date, today()) > 60, show: d => `${days(d.requested_ship_date, today())} gün gecikti` },
  { id:'stale', title:'12 aydan eski açık fırsat', fix:'Hâlâ açık mı? Değilse Kaybedildi ya da Arşiv yap.', test: d => d.status==='pipeline' && (d.lead_date||d.order_date) && days(d.lead_date||d.order_date, today()) > 365, show: d => `Giriş: ${fmtD(d.lead_date||d.order_date)}` },
  { id:'nodesc', title:'Açıklama yok', fix:'Kısa bir açıklama yaz.', test: d => !d.description || d.description==='(açıklama yok)', show: () => '' },
];
function liveIssuesFor(d){ return CHECKS.filter(c => c.test(d)); }
function dupCustomers(){
  const g = {}; S.customers.forEach(c => { const k = fold(c.name); if (k.length >= 2) (g[k] = g[k] || []).push(c); });
  return Object.values(g).filter(a => a.length > 1);
}
function liveProblemCount(){ return S.deals.reduce((n,d) => n + (liveIssuesFor(d).length ? 1 : 0), 0) + dupCustomers().length; }

function viewIssues(){
  const open = S.issues.filter(i => !i.resolved);
  const groups = CHECKS.map(c => [c, S.deals.filter(c.test)]).filter(([,a]) => a.length);
  const dups = dupCustomers();
  const dealCount = cid => S.deals.filter(d => d.customer_id === cid).length;
  const editable = can('sales','support','admin','production');
  shell('uyarilar', `<div class="pagehead"><div><h1>Veri kontrolü</h1><p class="lede">Otomatik kontroller her açılışta yeniden hesaplanır: kaydı düzelttiğinde o satır listeden kendiliğinden düşer. Excel aktarım notları ise kayıt düzenlenip "düzeltildi" işaretlenince kapanır.</p></div></div>
  ${!groups.length && !dups.length && !open.length ? '<div class="panel empty">Açık sorun yok.</div>' : ''}
  ${groups.map(([c, arr]) => `<details class="panel" style="margin-bottom:12px" ${arr.length<=15?'open':''}><summary style="cursor:pointer;font-weight:650">${esc(c.title)} <span class="pill st-lost" style="margin-left:6px">${arr.length}</span><div class="note" style="font-weight:400">${esc(c.fix)}</div></summary>
    <div class="tablewrap mt"><table><tbody>${arr.map(d => `<tr data-id="${d.id}"><td class="mono" style="width:150px">${esc(refNo(d))}</td><td>${esc(custName(d))}<div class="sub">${esc(d.description)}</div></td><td class="sub">${c.show(d)}</td><td style="width:90px">${editable?`<a class="btn sm" href="#/duzenle/${d.id}">Düzelt</a>`:''}</td></tr>`).join('')}</tbody></table></div></details>`).join('')}
  ${dups.length ? `<details class="panel" style="margin-bottom:12px" open><summary style="cursor:pointer;font-weight:650">Aynı müşteri farklı yazılmış olabilir <span class="pill st-lost" style="margin-left:6px">${dups.length}</span><div class="note" style="font-weight:400">Birleştirince tüm siparişler seçilen kayda taşınır, diğer kayıt silinir.${can('admin')?'':' Birleştirmeyi yönetici yapabilir.'}</div></summary>
    <div class="tablewrap mt"><table><tbody>${dups.map(a => { const sorted = [...a].sort((x,y) => dealCount(y.id) - dealCount(x.id)); const keep = sorted[0];
      return `<tr style="cursor:default"><td>${sorted.map(c => `${esc(c.name)} <span class="sub">(${dealCount(c.id)} kayıt, ${esc(ctryName(c.country))})</span>`).join('<br>')}</td>
      <td style="width:260px">${can('admin') ? sorted.slice(1).map(c => `<button class="btn sm" data-merge="${keep.id}:${c.id}">"${esc(c.name)}" → "${esc(keep.name)}"</button>`).join(' ') : ''}</td></tr>`; }).join('')}</tbody></table></div></details>` : ''}
  ${open.length ? `<details class="panel" open><summary style="cursor:pointer;font-weight:650">Excel aktarım notları <span class="pill st-archived" style="margin-left:6px">${open.length}</span><div class="note" style="font-weight:400">Aktarırken otomatik düzeltilen ya da boş bırakılan alanlar. Kayıt doğruysa "Doğru" de.</div></summary>
  <div class="tablewrap mt"><table><tbody>
  ${open.map(i => { const d = S.deals.find(x => x.id === i.deal_id); return `<tr data-id="${i.deal_id}"><td class="mono" style="width:150px">${esc(d?refNo(d):i.record_key)}<div class="sub">${esc(d?custName(d):'')}</div></td><td>${esc(i.message)}</td><td style="width:170px;white-space:nowrap">${editable?`<a class="btn sm" href="#/duzenle/${i.deal_id}">Düzelt</a> <button class="btn sm" data-ok="${i.id}">Doğru</button>`:''}</td></tr>`; }).join('')}</tbody></table></div></details>` : ''}`);
  qa('tr[data-id]').forEach(tr => tr.onclick = e => { if (!e.target.closest('button,a')) location.hash = '#/kayit/' + tr.dataset.id; });
  qa('[data-ok]').forEach(b => b.onclick = async () => { const { error } = await sb.from('import_issues').update({ resolved:true }).eq('id', +b.dataset.ok); if (error) return toast(dbErr(error), true); S.issues.find(i=>i.id===+b.dataset.ok).resolved = true; viewIssues(); });
  qa('[data-merge]').forEach(b => b.onclick = () => mergeCustomers(...b.dataset.merge.split(':').map(Number), viewIssues, b));
}
async function mergeCustomers(keep, drop, after, btn){
  if (btn && btn.dataset.c !== '1') { btn.dataset.c = '1'; btn.textContent = 'Birleştirmeyi onayla'; return; }
  const { data, error } = await sb.rpc('merge_customers', { p_keep: keep, p_drop: drop });
  if (error) return toast(dbErr(error), true);
  await loadAll(); toast(`${data} kayıt birleştirildi`); after();
}

// ---------------------------------------------------------------- GEÇMİŞ
async function viewAudit(){
  shell('gecmis', `<div class="pagehead"><div><h1>Değişiklik geçmişi</h1><p class="lede">Son 200 değişiklik. Hangi alanın neyken neye değiştiği gösterilir.</p></div></div><div class="tablewrap" id="au"><div class="empty">Yükleniyor…</div></div>`);
  const { data, error } = await sb.from('audit_log').select('*').neq('changed_by', null).order('id', { ascending:false }).limit(200);
  if (error) { q('#au').innerHTML = `<div class="empty">${esc(dbErr(error))}</div>`; return; }
  const skip = new Set(['updated_at','updated_by','created_at','created_by']);
  const diff = r => { if (r.action !== 'UPDATE') return r.action === 'INSERT' ? 'Yeni kayıt' : 'Silindi'; const o = r.old_data||{}, n = r.new_data||{}; return Object.keys(n).filter(k => !skip.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k])).map(k => `<b>${esc(k)}</b>: ${esc(o[k]??'—')} → ${esc(n[k]??'—')}`).join('<br>') || '—'; };
  const label = r => { const x = r.new_data || r.old_data || {}; if (r.table_name === 'deals') return esc(x.order_no || x.opp_no || '#'+x.id); if (r.table_name === 'deal_items') { const d = S.deals.find(y=>y.id===x.deal_id); return esc((d?refNo(d):'#'+x.deal_id) + ' · ' + prodName(x.product_code)); } return esc(x.name || x.id); };
  q('#au').innerHTML = data.length ? `<table><thead><tr><th class="nosort">Zaman</th><th class="nosort">Kişi</th><th class="nosort">Kayıt</th><th class="nosort">Değişiklik</th></tr></thead><tbody>${data.map(r => `<tr style="cursor:default"><td style="white-space:nowrap">${new Date(r.changed_at).toLocaleString('tr-TR')}</td><td>${esc(r.changed_by_email||'—')}</td><td>${label(r)}</td><td>${diff(r)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Henüz arayüzden yapılmış bir değişiklik yok.</div>';
}

// ---------------------------------------------------------------- KULLANICILAR
async function viewUsers(){
  shell('kullanicilar', `<div class="pagehead"><div><h1>Kullanıcılar</h1><p class="lede">@acrome.net adresiyle açılan her hesap İzleyici olarak başlar: rapor ve kayıtları görür, değiştiremez. Veri girecek kişilere buradan Satış veya Üretim rolü ver. Birinin erişimini kapatmak için rolünü "Erişim kapalı" yap.</p></div></div>
  <div class="panel" style="margin-bottom:16px"><dl class="kv"><dt>Erişim kapalı</dt><dd>Giriş yapabilir ama hiçbir veriyi göremez.</dd><dt>İzleyici</dt><dd>Rapor ve kayıtları görür, değiştiremez.</dd><dt>Satış</dt><dd>Fırsat ve sipariş girer, düzenler; müşteri ekler.</dd><dt>Üretim</dt><dd>Yalnızca planlanan sevk, sevk tarihi, durum (Üretimde ↔ Gönderildi) ve gecikme açıklamasını değiştirir.</dd><dt>Sipariş + Support</dt><dd>Satış rolünün tüm yetkileri (fırsat, sipariş, müşteri) + support konularını düzenler: durum, sorumlu, not, kapatma, birleştirme.</dd><dt>Yönetici</dt><dd>Her şey + silme, ürün yönetimi, rol verme.</dd></dl><p class="note" style="margin:10px 0 0">Support konularını herkes görür; yalnızca <b>Sipariş + Support</b> ve <b>Yönetici</b> düzenler.</p></div>
  <div class="tablewrap" id="us"><div class="empty">Yükleniyor…</div></div>`);
  const { data, error } = await sb.from('profiles').select('*').order('created_at');
  if (error) { q('#us').innerHTML = `<div class="empty">${esc(dbErr(error))}</div>`; return; }
  q('#us').innerHTML = `<table><thead><tr><th class="nosort">Ad</th><th class="nosort">E-posta</th><th class="nosort">Kayıt</th><th class="nosort">Rol</th></tr></thead><tbody>${data.map(u => `<tr style="cursor:default"><td>${esc(u.full_name||'')}</td><td>${esc(u.email)}</td><td>${fmtD(u.created_at.slice(0,10))}</td><td><select data-u="${u.id}" ${u.id===S.profile.id?'disabled title="Kendi rolünü değiştiremezsin"':''} aria-label="${esc(u.email)} rolü">${Object.entries(ROLES).map(([k,v])=>`<option value="${k}" ${u.role===k?'selected':''}>${v}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table>`;
  qa('[data-u]').forEach(s => s.onchange = async () => { const { error } = await sb.from('profiles').update({ role: s.value }).eq('id', s.dataset.u); if (error) return toast(dbErr(error), true); toast('Rol güncellendi'); });
}

function viewNewPassword(){
  shell('', `<h1>Yeni şifre belirle</h1><form id="np" class="fs" style="max-width:420px" novalidate><label class="f">Yeni şifre <span class="hint">en az 8 karakter</span><input type="password" name="pw" minlength="8" autocomplete="new-password"></label><p><button class="btn primary">Şifreyi kaydet</button></p></form>`);
  q('#np').onsubmit = async e => { e.preventDefault(); const pw = e.target.pw.value; if (pw.length < 8) return toast('Şifre en az 8 karakter olmalı', true); const { error } = await sb.auth.updateUser({ password: pw }); if (error) return toast(error.message, true); toast('Şifre güncellendi'); location.hash = '#/rapor'; };
}

// ---------------------------------------------------------------- İÇE AKTARMA (tek seferlik)
function viewImport(){
  shell('ice-aktar', `<h1>Excel verisini içe aktar</h1>
  <p class="lede">Claude'un Excel'den hazırladığı <b>acrome-import.json</b> dosyasını seç. Dosya yalnızca tarayıcından veritabanına gönderilir. İçe aktarma boş veritabanında bir kez çalışır.</p>
  <div class="fs" style="max-width:560px"><label class="f">Veri dosyası<input type="file" id="imf" accept=".json,application/json"></label>
  <p id="imi" class="note"></p><button class="btn primary" id="imb" disabled>İçe aktar</button></div>`);
  let data = null;
  q('#imf').onchange = async e => {
    const f = e.target.files[0]; data = null; q('#imb').disabled = true;
    try { data = JSON.parse(await f.text()); } catch { q('#imi').textContent = 'Dosya okunamadı: geçerli bir JSON değil.'; return; }
    if (!Array.isArray(data.deals)) { q('#imi').textContent = 'Bu dosya beklenen biçimde değil.'; data = null; return; }
    q('#imi').textContent = `${data.deals.length} kayıt, ${data.items.length} ürün kalemi, ${data.customers.length} müşteri, ${data.issues.length} uyarı bulundu.`;
    q('#imb').disabled = false;
  };
  q('#imb').onclick = async () => {
    const b = q('#imb'); b.disabled = true; b.textContent = 'Aktarılıyor…';
    const { data: res, error } = await sb.rpc('admin_import', { j: data });
    if (error) { b.disabled = false; b.textContent = 'İçe aktar'; return toast(dbErr(error), true); }
    await loadAll(); toast(`${res.deals} kayıt aktarıldı`); location.hash = '#/rapor';
  };
}

// ---------------------------------------------------------------- EXCEL'DEN GÜNCELLEME (yeni satırlar)
const XL_PROD = {'BB':'BB','BBT':'BBT','1D Copter':'COPTER1D','2D-3D Copter':'COPTER3D','{2D}-3D Copter':'COPTER3D','2D Copter':'COPTER3D','Delta':'DELTA','STW':'STEWART','Pend':'PEND','MRK':'MRK',
  '4-DoF Acrobot':'ACROBOT','ACROBOT':'ACROBOT','4-Axis':'ARM4','Ard':'ARD','rPi':'RPI','myRIO':'MYRIO','LV':'MYRIO','Mat':'MATLAB','+':'CTRL_PLUS',
  'SMD-RED EDU Kit':'SMD_EDU','EDU Kit':'SMD_EDU','SMD-RED StarterKit':'SMD_STARTER','Starter Kit':'SMD_STARTER','SMD-Other':'SMD_OTHER','SMD-RED Other':'SMD_OTHER','SMD-RED base kit':'SMD_BASE'};
const XL_CTRY = {USA:'US',US:'US','US-NC':'US',TUR:'TR',TR:'TR','İZMİR':'TR',GER:'DE',Germany:'DE',GR:'DE',FRA:'FR',France:'FR',FR:'FR',Fransa:'FR',IND:'IN',India:'IN',CA:'CA',Canada:'CA',UK:'GB',
  Switzerland:'CH',SWI:'CH',CH:'CH',SWZ:'CH',MAL:'MY',Malaysia:'MY',BRA:'BR',BRE:'BR',ITA:'IT',Italy:'IT',TW:'TW',HOL:'NL',NL:'NL',KOR:'KR','S.Korea':'KR',Korea:'KR',KOREA:'KR',BEL:'BE',BE:'BE',
  KSA:'SA',UAE:'AE',VN:'VN',VIET:'VN',Sweden:'SE',SWE:'SE',Ireland:'IE',Avustralya:'AU',POL:'PL',CHN:'CN',POR:'PT',MO:'MA',SG:'SG',MX:'MX',Mexico:'MX',SA:'ZA',EG:'EG',BAH:'BH',SLO:'SI',NZ:'NZ',
  FIN:'FI',SPA:'ES',RO:'RO',ROM:'RO',ROMANIA:'RO',NO:'NO',KOSOVA:'XK',ERM:'AM',ARM:'AM',JAPAN:'JP',Ecuador:'EC',EC:'EC',Pakistan:'PK',Palestine:'PS',CHL:'CL',Oman:'OM',AZE:'AZ',Qatar:'QA'};
const XL_SKIP = ['Current Total','Expected Total','Kaç üretelim','Birim maliyeti','Toplam Maliyeti','GRAND TOTAL','TOPLAM','Kesinleşen','Faturalandırılan','Ayı Ciro','-Shipped'];
const XL_MONTHS = ['ocak','şubat','mart','nisan','mayıs','haziran','temmuz','ağustos','eylül','ekim','kasım','aralık'];

async function loadXLSX(){
  if (window.XLSX) return;
  await new Promise((res, rej) => { const el = document.createElement('script'); el.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; el.onload = res; el.onerror = () => rej(new Error('Excel okuyucu yüklenemedi')); document.head.appendChild(el); });
}
function xlNum(v){
  if (typeof v === 'number') return v;
  if (v == null || v === '') return null;
  let t = String(v).replace(/[$€£₺\s]/g,'').replace(/USD|TL|EUR|GBP/gi,'');
  if (!t) return null;
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g,'').replace(',','.') : t.replace(/,/g,'');
  else if (t.includes(',')) t = /,\d{3}$/.test(t) ? t.replace(/,/g,'') : t.replace(',','.');
  const n = Number(t); return isFinite(n) ? n : null;
}
function xlDate(v, notes, label){
  if (v == null || v === '' || v === '-') return null;
  if (typeof v === 'number') { if (v > 20000 && v < 80000) { const p = XLSX.SSF.parse_date_code(v); return `${p.y}-${String(p.m).padStart(2,'0')}-${String(p.d).padStart(2,'0')}`; } notes.push(`${label}: okunamayan değer "${v}"`); return null; }
  let t = String(v).trim().replace('//','/');
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = t.match(/^(\d{1,2})([./])(\d{1,2})\2(\d{4})$/))) {
    const a = +m[1], b = +m[3]; y = +m[4];
    if (m[2] === '.' || a > 12) { d = a; mo = b; } else { mo = a; d = b; }
  } else { notes.push(`${label} (Excel): ${t}`); return null; }
  if (y > 2030) { notes.push(`${label}: yıl ${y} → ${2000 + y % 100} düzeltildi`); y = 2000 + y % 100; }
  const dt = new Date(Date.UTC(y, mo-1, d));
  if (dt.getUTCMonth() !== mo-1) { notes.push(`${label} (Excel): ${t}`); return null; }
  return dt.toISOString().slice(0,10);
}
function xlIds(a){
  a = String(a || '');
  const acr = a.match(/ACRPO[\s-]*(I?\d+)(?:[\s-]*(SP\d+|P\d+)\b)?/i);
  const pr = a.match(/PROS[\s-]*(\d{2})[\s-]*(\d+)(?:[\s-]+(\d+))?/i);
  return [acr ? 'ACRPO-' + acr[1].toUpperCase() + (acr[2] ? '-' + acr[2].toUpperCase() : '') : null,
          pr ? 'PROS-' + [pr[1],pr[2],pr[3]].filter(Boolean).map(x => x.padStart(2,'0')).join('-') : null];
}
function xlStage(t){
  t = String(t || '').trim().toLowerCase();
  if (['won','recieved','received','sp','problem'].includes(t)) return 'won';
  if (t.includes('lost')) return 'lost'; if (t.includes('advance')) return 'advance';
  if (t.includes('closing') || t === 'boiling') return 'closing'; if (t.includes('qualify')) return 'qualify';
  return null;
}
function xlCustomer(eu){
  const parts = eu.split('/').map(x => x.trim());
  let country = null, name = eu;
  if (parts.length > 1) { const last = parts[parts.length-1].split(/\s+/)[0]; if (XL_CTRY[parts[parts.length-1]] || XL_CTRY[last]) { country = XL_CTRY[parts[parts.length-1]] || XL_CTRY[last]; name = parts.slice(0,-1).join(' / '); } }
  name = name.replace(/^[\s-]+|[\s-]+$/g,'') || eu;
  const known = S.customers.find(c => fold(c.name) === fold(name));
  if (known) { name = known.name; country = country || known.country; }
  if (!country) { const low = eu.toLocaleLowerCase('tr'); for (const [kw,cc] of [['malaysia','MY'],['oman','OM'],['usa','US'],['acrome','TR'],['üniversitesi','TR'],['ankara','TR']]) if (low.includes(kw)) { country = cc; break; } }
  return { name, country };
}
// Excel sayfasını satır listesine çevir (Python aktarımıyla aynı kurallar)
function xlParse(rows, sheetName, formulas){
  const out = []; let hdr = null, section = null;
  const norm = v => v == null ? null : String(v).replace(/\s+/g,' ').trim();
  // aylık toplam formüllerinden satır → ay (yalnızca .xlsx)
  const rowMonth = {}; const yr = /^\d{4}$/.test(sheetName) ? +sheetName : null;
  const hdrRow = rows.find(r => r.some(v => norm(v) === 'End User')) || [];
  const amtCol = hdrRow.findIndex(v => norm(v) === 'Order Amount');
  if (formulas && yr && amtCol >= 0) for (const [r, cells] of Object.entries(formulas)) {
    const label = cells.label; if (!label) continue;
    const mi = XL_MONTHS.findIndex(m => label.toLocaleLowerCase('tr').replace('mayısayı','mayıs ayı').startsWith(m)); if (mi < 0) continue;
    for (const { col, f } of cells.fs) { if (col !== amtCol) continue; const set = new Set();
      f.replace(/[A-Z]+(\d+)\s*:\s*[A-Z]+(\d+)/g, (_, a, b) => { for (let i = +a; i <= +b; i++) set.add(i); return ''; }).replace(/[A-Z]+(\d+)/g, (_, a) => { set.add(+a); return ''; });
      set.forEach(i => rowMonth[i] = `${yr}-${String(mi+1).padStart(2,'0')}`); }
  }
  rows.forEach((row, ri) => {
    const texts = row.map(norm);
    if (texts.includes('End User')) {
      hdr = {}; texts.forEach((t,i) => { if (t) hdr[i] = t; }); hdr[0] = 'OrderNo';
      const a = texts[0] || '';
      section = /Gönderilmiş/.test(a) ? 'shipped' : /Gelecek|Opp/.test(a) ? 'pipeline' : /Gönderilecek|\^a\^/.test(a) ? 'active' : (section || 'active');
      return;
    }
    if (!hdr) return;
    if (texts[0] === 'Shipped' && !texts.slice(1,5).some(Boolean)) { section = 'shipped'; return; }
    const joined = texts.filter(Boolean).join(' ');
    if (!joined || XL_SKIP.some(k => joined.includes(k)) || ['Total','Expected'].includes(texts[0])) return;
    if (texts.filter(Boolean).every(t => /^Column \d+$/.test(t))) return;
    const r = {}; for (const [i,h] of Object.entries(hdr)) if (row[i] != null && row[i] !== '') r[h] = row[i];
    const eu = norm(r['End User']) || ''; const desc = norm(r['Order Description'] || r['Lead Description']) || '';
    if (!eu || eu === 'Ün' || eu === 'BB' || /^[\d.,]+$/.test(eu)) return;
    const notes = [];
    const [o, p] = xlIds(r.OrderNo);
    const rawStage = norm(r['Stage'] || r['1-Qualify']) || '';
    let stage = xlStage(rawStage);
    let status = stage === 'lost' ? 'lost' : section === 'shipped' ? 'shipped' : section === 'active' ? 'production' : stage === 'won' ? 'production' : 'pipeline';
    if (!stage) stage = ['production','shipped'].includes(status) ? 'won' : 'qualify';
    const cust = xlCustomer(eu);
    let cur = 'USD', orig = null; const n1 = r['NOT1'], n2 = norm(r['NOT2']);
    if (['GBP','TL','EUR','TRY'].includes(n2)) { cur = n2 === 'TL' ? 'TRY' : n2; orig = xlNum(n1); } else [n1, r['NOT2']].forEach(x => { if (x != null && x !== '') notes.push(String(x)); });
    const items = {}; for (const [h,c] of Object.entries(XL_PROD)) { const q = xlNum(r[h]); if (q) items[c] = q; }
    const issues = [];
    const dt = (k, l) => { const before = notes.length; const v = xlDate(r[k], notes, l); if (notes.length > before) issues.push(notes[notes.length-1]); return v; };
    const rec = { _row: ri + 1, _section: section, order_no: o, opp_no: p, customer: cust.name, country: cust.country, end_user: eu, description: desc || '(açıklama yok)', stage, status,
      quote_no: norm(r['Quote No']), order_date: dt('Order Date [mm/dd/yyyy]','Sipariş tarihi'), lead_date: dt('Lead Entry [mm/dd/yyyy]','Fırsat girişi'),
      expected_po_date: dt('PO Date (Expectation)','Beklenen PO'), requested_ship_date: dt('Requested Shipment Date','İstenen sevk') || dt('Requested Shipment Date (if any)','İstenen sevk'),
      planned_ship_date: dt('Planned Shipment Date (to be filled by manufacturing)','Planlanan sevk'), ship_date: dt('Shipment Date','Sevk tarihi'),
      ship_month: rowMonth[ri + 1] || null,
      details: norm(r['Additional Description']), delay_reason: norm(r['Explanation If Delay']), payment_terms: norm(r['Ödeme Bilgisi']),
      amount_usd: xlNum(r['Order Amount']), currency: cur, amount_orig: orig, smd_sales_usd: xlNum(r['SMD Sales Total']),
      is_internal: /-I\d/.test(o || '') || /Acrome/i.test(eu), items, issues, notes: notes.join('\n') || null,
      source: `Excel güncelleme ${today()} ${sheetName}!${ri + 1}` };
    const rm = (rec.details || '').match(/(?:Reseller|Distribütör|Distributör|Satıcı)\s*:?\s*([^\n.]+)/i); rec.reseller = rm ? rm[1].trim() : null;
    if (rawStage === 'Problem') rec.notes = [rec.notes, 'Excel aşaması: Problem'].filter(Boolean).join('\n');
    if (!rec.country) issues.push(`Ülke belirlenemedi: "${eu}"`);
    if (rec.status === 'shipped' && !rec.ship_date && !rec.ship_month) issues.push('Gönderilmiş ama Excel\'de sevk tarihi yok');
    if (rec.status === 'pipeline' && !rec.opp_no) issues.push('Fırsatın PROS numarası yok');
    out.push(rec);
  });
  return out;
}
function xlMatch(recs){
  const byOrder = {}, byOpp = {}, byCD = {};
  S.deals.forEach(d => { if (d.order_no) byOrder[d.order_no] = d; if (d.opp_no) (byOpp[d.opp_no] = byOpp[d.opp_no] || []).push(d); byCD[fold(custName(d)) + '|' + fold(d.description)] = d; });
  const res = { add: [], convert: [], diff: [], same: [], clash: [], dupInFile: 0 };
  const seen = new Set();
  const F = [['status','Durum',v=>STATUSES[v]],['stage','Aşama',v=>STAGES[v]],['order_date','Sipariş tarihi',fmtD],['requested_ship_date','İstenen sevk',fmtD],['planned_ship_date','Planlanan sevk',fmtD],['ship_date','Sevk tarihi',fmtD],['ship_month','Sevk ayı',fmtM],['amount_usd','Tutar',fmtUSD]];
  for (const r of recs) {
    const k = r.order_no || r.opp_no || fold(r.customer) + '|' + fold(r.description);
    if (seen.has(k)) { res.dupInFile++; continue; } seen.add(k);
    let d = r.order_no ? byOrder[r.order_no] : null, conv = null;
    if (!d && r.order_no && r.opp_no) conv = (byOpp[r.opp_no] || []).find(x => !x.order_no);
    if (!d && !conv && !r.order_no && r.opp_no) d = (byOpp[r.opp_no] || [])[0];
    if (!d && !conv) d = byCD[fold(r.customer) + '|' + fold(r.description)];
    if (conv) { res.convert.push({ r, d: conv }); continue; }
    if (!d) { res.add.push({ r }); continue; }
    if (r.order_no && d.order_no === r.order_no && fold(custName(d)).slice(0,4) !== fold(r.customer).slice(0,4) && fold(d.description).slice(0,8) !== fold(r.description).slice(0,8)) { res.clash.push({ r, d }); continue; }
    const changes = F.filter(([f]) => r[f] != null && r[f] !== '' && String(r[f]) !== String(d[f] ?? '') && !(f === 'amount_usd' && Math.abs(+r[f] - +d[f]) < 0.5)
      && !(f === 'ship_month' && d.ship_date) && !(f === 'status' && d.status === 'archived'));
    if (changes.length) res.diff.push({ r, d, changes: changes.map(([f,l,fmt]) => ({ f, l, from: fmt(d[f]), to: fmt(r[f]) })) });
    else res.same.push({ r, d });
  }
  return res;
}
function viewSync(){
  shell('excel', `<h1>Excel'den güncelle</h1>
  <p class="lede">Excel'e girişe devam ederken sitedeki veriyi güncel tutmak için: Google Sheets'te ilgili sayfayı <b>Dosya → İndir → .xlsx</b> (önerilen) ya da <b>.csv</b> olarak indir ve buraya yükle. Sistem kayıtları ACRPO / PROS numarasına göre karşılaştırır; <b>yalnızca yeni satırları ekler</b>, mevcut kayıtlara dokunmaz.</p>
  <div class="fs" style="max-width:720px">
    <div class="row r2"><label class="f">Dosya (.xlsx veya .csv)<input type="file" id="xf" accept=".xlsx,.xls,.csv,text/csv"></label>
    <label class="f">Sayfa<select id="xs" disabled><option>Önce dosya seç</option></select></label></div>
    <p class="note" id="xi">.xlsx dosyasında tarihler ve Excel'in aylık toplam formülleri de okunur (sevk ayı buradan çıkar). .csv'de tarihler ay/gün/yıl kabul edilir.</p>
  </div><div id="xr"></div>`);
  let wb = null, isCsv = false;
  const run = () => {
    const name = q('#xs').value; const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:null, blankrows:true });
    let formulas = null;
    if (!isCsv) { formulas = {}; for (const addr of Object.keys(ws)) { if (addr[0] === '!') continue; const c = ws[addr], rr = XLSX.utils.decode_cell(addr).r + 1;
      if (c.t === 's' && /Ay[ıi]\s*:?\s*$|Ayı\s*:/.test(String(c.v)) ) (formulas[rr] = formulas[rr] || { fs: [] }).label = String(c.v).trim();
      if (c.f) (formulas[rr] = formulas[rr] || { fs: [] }).fs.push({ col: XLSX.utils.decode_cell(addr).c, f: c.f }); } }
    const recs = xlParse(rows, isCsv ? (q('#xs').dataset.year || '') : name, formulas);
    renderSync(recs, xlMatch(recs), name);
  };
  q('#xf').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    q('#xi').textContent = 'Okunuyor…';
    try { await loadXLSX(); } catch (err) { q('#xi').textContent = err.message; return; }
    isCsv = /\.csv$/i.test(f.name);
    try { wb = isCsv ? XLSX.read(await f.text(), { type:'string', raw:true }) : XLSX.read(await f.arrayBuffer(), { type:'array', cellFormula:true, cellDates:false }); }
    catch (err) { q('#xi').textContent = 'Dosya okunamadı: ' + err.message; return; }
    const names = wb.SheetNames.filter(n => !/^W\d/.test(n));
    const sel = q('#xs'); sel.disabled = false;
    sel.innerHTML = names.map(n => `<option ${n === '2026' || (isCsv) ? 'selected' : ''}>${esc(n)}</option>`).join('');
    if (isCsv) { const m = f.name.match(/(20\d\d)/); sel.dataset.year = m ? m[1] : ''; }
    q('#xi').textContent = `${f.name}: ${names.length} sayfa.`;
    sel.onchange = run; run();
  };
}
function renderSync(recs, m, sheet){
  const T = (arr, cols, key, checked) => arr.length ? `<div class="tablewrap"><table><thead><tr><th class="nosort" style="width:34px"><input type="checkbox" data-all="${key}" ${checked?'checked':''} aria-label="Hepsini seç"></th>${cols.map(c=>`<th class="nosort">${c}</th>`).join('')}</tr></thead><tbody>${arr.map((x,i) => `<tr style="cursor:default"><td><input type="checkbox" data-k="${key}" data-i="${i}" ${checked?'checked':''} aria-label="Seç"></td>${x.cells}</tr>`).join('')}</tbody></table></div>` : '<p class="note">Yok.</p>';
  const addRows = m.add.map(({r}) => ({ cells: `<td class="mono">${esc(r.order_no || r.opp_no || '—')}</td><td>${esc(r.customer)}<div class="sub">${esc(ctryName(r.country))}</div></td><td>${esc(r.description)}<div class="items">${Object.entries(r.items).map(([c,q])=>`<span>${fmtN(q)}× ${esc(prodName(c))}</span>`).join('')}</div></td><td>${pill(r.status)}</td><td>${fmtD(r.order_date || r.lead_date)}</td><td class="num">${fmtUSD(r.amount_usd)}</td><td class="sub">${r.issues.map(esc).join('<br>')}</td>` }));
  const convRows = m.convert.map(({r,d}) => ({ cells: `<td class="mono">${esc(d.opp_no)} → ${esc(r.order_no)}</td><td>${esc(custName(d))}</td><td>${esc(r.description)}</td><td>${pill(d.status)} → ${pill(r.status)}</td><td class="num">${fmtUSD(r.amount_usd)}</td>` }));
  const diffRows = m.diff.map(({r,d,changes}) => ({ cells: `<td class="mono"><a href="#/kayit/${d.id}">${esc(refNo(d))}</a>${d.updated_by?'<div class="sub" style="color:var(--amber)">sitede düzenlenmiş</div>':''}</td><td>${esc(custName(d))}</td><td>${changes.map(c=>`<div><b>${c.l}:</b> ${esc(c.from)} → ${esc(c.to)}</div>`).join('')}</td>` }));
  q('#xr').innerHTML = `
    <div class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="kpi"><div class="v">${m.add.length}</div><div class="l">Yeni kayıt</div><div class="d">eklenecek</div></div>
      <div class="kpi"><div class="v">${m.convert.length}</div><div class="l">Fırsattan siparişe dönen</div><div class="d">mevcut fırsat güncellenecek</div></div>
      <div class="kpi"><div class="v">${m.diff.length}</div><div class="l">Excel'de farklı görünen</div><div class="d">varsayılan: dokunulmaz</div></div>
      <div class="kpi"><div class="v">${m.same.length}</div><div class="l">Aynı</div><div class="d">${recs.length} satır okundu · ${sheet}</div></div>
    </div>
    ${m.clash.length ? `<div class="banner mt"><b>Numara çakışması (${m.clash.length}):</b> Excel'deki satır, sitede başka müşteriye ait bir sipariş numarasını kullanıyor. Bunlar uygulanmaz; Excel'de numarayı düzelt.<br>${m.clash.map(({r,d}) => `${esc(r.order_no)}: Excel "${esc(r.customer)} – ${esc(r.description)}" · Site "${esc(custName(d))} – ${esc(d.description)}"`).join('<br>')}</div>` : ''}
    <section class="mt"><h2>Yeni kayıtlar</h2>${T(addRows, ['No','Müşteri','Açıklama','Durum','Tarih','Tutar','Not'], 'add', true)}</section>
    <section class="mt"><h2>Fırsattan siparişe dönenler</h2><p class="note">Excel'de ACRPO numarası almış, sitede hâlâ fırsat olan kayıtlar. Yeni kayıt açılmaz; mevcut fırsat siparişe çevrilir.</p>${T(convRows, ['Numara','Müşteri','Açıklama','Durum','Tutar'], 'conv', true)}</section>
    <section class="mt"><h2>Excel'de farklı görünenler</h2><p class="note">Sitede düzeltilmiş veriyi bozmamak için bunlar varsayılan olarak <b>uygulanmaz</b>. Excel'deki değer doğruysa işaretle.</p>${T(diffRows, ['Kayıt','Müşteri','Fark (site → Excel)'], 'diff', false)}</section>
    <div class="mt" style="display:flex;gap:10px;align-items:center"><button class="btn primary" id="xa">Seçilenleri uygula</button><span class="note" id="xn"></span></div>`;
  const count = () => { const n = k => qa(`[data-k="${k}"]:checked`).length; q('#xn').textContent = `${n('add')} yeni, ${n('conv')} dönüşüm, ${n('diff')} güncelleme uygulanacak.`; };
  qa('[data-all]').forEach(a => a.onchange = () => { qa(`[data-k="${a.dataset.all}"]`).forEach(c => c.checked = a.checked); count(); });
  qa('[data-k]').forEach(c => c.onchange = count); count();
  q('#xa').onclick = async () => {
    const pick = k => qa(`[data-k="${k}"]:checked`).map(c => +c.dataset.i);
    const strip = r => { const { _row, _section, end_user, ...x } = r; return x; };
    const inserts = pick('add').map(i => strip(m.add[i].r));
    const updates = [
      ...pick('conv').map(i => { const { r, d } = m.convert[i]; const fields = { order_no: r.order_no, stage: 'won', status: r.status };
        for (const f of ['order_date','requested_ship_date','planned_ship_date','ship_date','amount_usd','payment_terms']) if (r[f] != null) fields[f] = r[f];
        return { id: d.id, fields, items: Object.keys(d.items||{}).length ? undefined : r.items }; }),
      ...pick('diff').map(i => { const { r, d, changes } = m.diff[i]; const fields = {}; changes.forEach(c => fields[c.f] = r[c.f]); if (fields.status && ['production','shipped'].includes(fields.status)) fields.stage = 'won'; if (fields.status === 'lost') fields.stage = 'lost'; return { id: d.id, fields }; }),
    ];
    if (!inserts.length && !updates.length) return toast('Seçili satır yok', true);
    const b = q('#xa'); b.disabled = true; b.textContent = 'Uygulanıyor…';
    const { data, error } = await sb.rpc('admin_sync', { p: { inserts, updates } });
    if (error) { b.disabled = false; b.textContent = 'Seçilenleri uygula'; return toast(dbErr(error), true); }
    await loadAll(); toast(`${data.inserted} yeni kayıt eklendi, ${data.updated} kayıt güncellendi`); viewSync();
  };
}

// ================================================================ SUPPORT
const SUP_STATUS = { new:'Yeni', ours:'Bizde', customer:'Müşteride', closed:'Kapandı' };
const SUP_STATUS_HINT = { new:'Henüz kimse cevap vermedi', ours:'Cevap / iş Acrome\'da', customer:'Müşteriden cevap bekleniyor', closed:'Çözüldü' };
const SUP_CAT = { support:'Teknik destek', sales:'Satış', admin:'İdari / ödeme', other:'Diğer' };
const SUP_PRIO = { low:'Düşük', normal:'Normal', high:'Yüksek' };
const SUP_SRC = { gmail:'E-posta', basecamp:'Basecamp', note:'Not', call:'Telefon', meet:'Meet' };
const supPill = st => `<span class="pill sp-${st}" title="${SUP_STATUS_HINT[st]||''}">${SUP_STATUS[st]||st}</span>`;
const supState = { tab:'open', cat:'support', product:'', who:'', q:'', hits:null, sort:'act' };
let supPeople = null;

async function loadSupport(){
  const { data, error } = await sb.from('support_tickets')
    .select('id,subject,category,status,priority,product,customer_name,organization,country,contact_email,assignee,summary,resolution,tags,gmail_thread_ids,basecamp_urls,opened_at,last_activity_at,last_inbound_at,last_outbound_at,closed_at,created_at,updated_at,deal_id,deal_link_source,ai_updated_at')
    .order('last_activity_at', { ascending:false }).range(0, 4999);
  if (error) { S.tickets = S.tickets || []; S.supErr = error.message; return; }
  S.tickets = data; S.supErr = null;
  const n = await sb.from('support_notifications').select('id', { count:'exact', head:true }).is('read_at', null);
  S.unread = n.error ? 0 : (n.count || 0);
  const ss = await sb.from('support_sync_state').select('key,updated_at');
  S.syncAt = Object.fromEntries((ss.data||[]).map(r => [r.key, r.updated_at]));
}
// son senkron satırı: 14 saatten eskiyse uyarı (günde 2 çalışma: 09:30 / 16:30)
function syncLine(){
  const z = S.syncAt || {}, old = t => !t || (Date.now() - new Date(t)) > 14 * 36e5;
  const one = (k, label, hint) => `${label}: ${z[k] ? fmtDT(z[k]) : '—'}${old(z[k]) ? ` <b class="warn-t">· gecikti${hint ? ' (' + hint + ')' : ''}</b>` : ''}`;
  return `<p class="note syncline">Son senkron · ${one('gmail','Mail')} · ${one('basecamp_cards','Basecamp','bilgisayar kapalı olabilir; açılınca kaldığı yerden devam eder')}</p>`;
}
async function people(){
  if (supPeople) return supPeople;
  const { data } = await sb.rpc('support_people');
  supPeople = data || []; return supPeople;
}
const personName = id => (supPeople||[]).find(p => p.id === id)?.name || '';
const ago = ts => {
  if (!ts) return '—';
  const d = Math.floor((Date.now() - new Date(ts)) / 864e5);
  return d <= 0 ? 'bugün' : d === 1 ? 'dün' : d < 30 ? d + ' gün önce' : d < 365 ? Math.floor(d/30) + ' ay önce' : Math.floor(d/365) + ' yıl önce';
};
const fmtDT = ts => ts ? new Date(ts).toLocaleString('tr-TR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
const daysSince = ts => ts ? Math.floor((Date.now() - new Date(ts)) / 864e5) : null;
// bekleme uyarısı: bizde ise müşteri mesajından beri, müşterideyse bizim cevaptan beri
function supWait(t){
  if (t.status === 'new' || t.status === 'ours') {
    const d = daysSince(t.last_inbound_at || t.opened_at);
    return d >= 2 ? { cls:'late-txt', txt:`${d} gündür cevap bekliyor` } : null;
  }
  if (t.status === 'customer') {
    const d = daysSince(t.last_outbound_at || t.last_activity_at);
    return d >= 7 ? { cls:'amber-txt', txt:`${d} gündür müşteride · takip et` } : null;
  }
  return null;
}
const dealNo = id => (S.deals.find(d => d.id === id) || {}).order_no || ('#' + id);
const canSup = () => can('support','admin');
const supOrgKey = t => { const d = (t.contact_email||'').split('@')[1]||''; const free = /^(gmail|hotmail|outlook|yahoo|icloud|live|163|qq)\./i.test(d); return { org: fold(String(t.organization||'').replace(/\(.*?\)/g,'')), dom: free ? '' : d.toLowerCase() }; };
// e-posta akışına göre durum: cevap bekliyor mu, cevaplandı mı, hiç mail yok mu
function mailState(t){
  const i = t.last_inbound_at, o = t.last_outbound_at;
  if (!i && !o) return { cls:'sub', txt:'Mail yok' };
  if (i && (!o || i > o)) { const d = daysSince(i); return { cls: t.status === 'closed' ? 'sub' : d >= 2 ? 'late-txt' : 'amber-txt', txt:`Müşteri yazdı, cevap yok${d?` · ${d} gün`:''}` }; }
  const d = daysSince(o); return { cls:'ok-txt', txt:`Cevaplandı${d?` · ${d} gün önce`:' · bugün'}` };
}
const supOpenCount = () => (S.tickets||[]).filter(t => t.category === 'support' && (t.status === 'new' || t.status === 'ours')).length;

async function viewSupport(){
  if (!S.tickets) await loadSupport();
  await people();
  const s = supState;
  const tabs = { open:'Açık', ours:'Bizde', customer:'Müşteride', closed:'Kapanan', all:'Tümü' };
  const T = S.tickets || [];
  const sup = T.filter(t => t.category === 'support');
  const mon = new Date().toISOString().slice(0,7);
  const kOurs = sup.filter(t => t.status === 'new' || t.status === 'ours');
  const kLate = kOurs.filter(t => supWait(t));
  const kCust = sup.filter(t => t.status === 'customer');
  const kNewM = sup.filter(t => (t.opened_at||'').slice(0,7) === mon);
  const kClosedM = sup.filter(t => (t.closed_at||'').slice(0,7) === mon);
  const prods = [...new Set(T.map(t => t.product).filter(Boolean))];

  const draw = () => {
    const ql = s.q.trim().toLocaleLowerCase('tr');
    const hitMap = new Map((s.hits||[]).map(h => [h.ticket_id, h]));
    let rows = T.filter(t =>
      (s.cat === 'all' || t.category === s.cat) &&
      (s.tab === 'all' || (s.tab === 'open' ? t.status !== 'closed' : s.tab === 'ours' ? (t.status === 'ours' || t.status === 'new') : t.status === s.tab)) &&
      (!s.product || t.product === s.product) &&
      (!s.who || (s.who === 'me' ? t.assignee === S.profile.id : s.who === 'none' ? !t.assignee : t.assignee === s.who)) &&
      (!ql || hitMap.has(t.id) || ('#' + t.id + ' ' + [t.subject,t.customer_name,t.organization,t.country,t.contact_email,t.summary,t.resolution,(t.tags||[]).join(' '),prodName(t.product)].join(' ')).toLocaleLowerCase('tr').includes(ql)));
    if (ql && s.hits) rows.sort((a,b) => ((hitMap.get(b.id)?.rank)||0) - ((hitMap.get(a.id)?.rank)||0));
    else rows.sort((a,b) => s.sort === 'open' ? (b.opened_at||'').localeCompare(a.opened_at||'') : (b.last_activity_at||'').localeCompare(a.last_activity_at||''));
    q('#stbl').innerHTML = rows.length ? `<table><thead><tr><th class="nosort">#</th><th class="nosort">Konu</th><th class="nosort">Müşteri</th><th class="nosort">Ürün</th><th class="nosort">Durum</th><th class="nosort">E-posta</th><th class="nosort">Sorumlu</th><th class="nosort">Son hareket</th></tr></thead><tbody>
      ${rows.map(t => { const w = supWait(t), h = hitMap.get(t.id);
        return `<tr data-tid="${t.id}"><td class="mono">#${t.id}</td>
        <td><b style="font-weight:600">${esc(t.subject)}</b>${t.priority==='high'?' <span class="pill sp-high">Acil</span>':''}
          ${t.summary?`<div class="sub clamp">${esc(t.summary)}</div>`:''}
          ${h && h.snippet ? `<div class="sub hit">… ${esc(h.snippet).replace(/&lt;&lt;/g,'<mark>').replace(/&gt;&gt;/g,'</mark>')} …</div>`:''}
          ${(t.tags||[]).length?`<div class="items">${t.tags.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:''}</td>
        <td>${esc(t.organization || t.customer_name || '—')}<div class="sub">${esc([t.organization?t.customer_name:'', t.country].filter(Boolean).join(' · '))}</div></td>
        <td>${t.product?esc(prodName(t.product)):'<span class="sub">—</span>'}</td>
        <td>${supPill(t.status)}${s.cat==='all'&&t.category!=='support'?`<div class="sub">${SUP_CAT[t.category]}</div>`:''}</td>
        <td><span class="${mailState(t).cls}" style="font-size:13px">${mailState(t).txt}</span>${t.deal_id?`<div class="sub">${esc(dealNo(t.deal_id))}</div>`:''}</td>
        <td>${esc(personName(t.assignee)) || '<span class="sub">—</span>'}</td>
        <td style="white-space:nowrap">${ago(t.last_activity_at)}${w?`<div class="sub ${w.cls}">${w.txt}</div>`:''}</td></tr>`; }).join('')}
      <tr class="tfoot"><td colspan="8">${rows.length} konu${ql?` · "${esc(s.q)}" araması${s.hits?' (mesaj içerikleri dahil)':''}`:''}</td></tr></tbody></table>`
      : `<div class="empty">${ql ? 'Aramayla eşleşen konu yok.' : 'Bu filtrelerle konu yok.'}</div>`;
    qa('#stbl tr[data-tid]').forEach(tr => tr.onclick = () => location.hash = '#/support/' + tr.dataset.tid);
  };

  shell('support', `<div class="pagehead"><div><h1>Support</h1><p class="lede">support@acrome.net konuları, cevaplar ve notlar tek yerde. Yeni mailler otomatik eklenir; arama mail içeriklerinde de yapılır.</p>${syncLine()}</div>
    <div style="display:flex;gap:8px"><button class="btn" id="scsv">CSV indir</button>${canSup()?'<a class="btn primary" href="#/support-yeni">Yeni konu</a>':''}</div></div>
    ${S.supErr ? `<div class="banner">Support verisi okunamadı: ${esc(S.supErr)}</div>` : ''}
    <div class="kpis">
      <div class="kpi ${kOurs.length?'alert':''}"><div class="v">${kOurs.length}</div><div class="l">Bizde bekleyen</div><div class="d">${kLate.length?kLate.length+' konu 2+ gündür bekliyor':'Geciken yok'}</div></div>
      <div class="kpi"><div class="v">${kCust.length}</div><div class="l">Müşteride</div><div class="d">${kCust.filter(t=>supWait(t)).length} konu takip bekliyor</div></div>
      <div class="kpi"><div class="v">${kNewM.length}</div><div class="l">Bu ay açılan</div><div class="d">Teknik destek</div></div>
      <div class="kpi"><div class="v">${kClosedM.length}</div><div class="l">Bu ay kapanan</div><div class="d">Toplam ${sup.length} destek konusu</div></div>
      <div class="kpi"><div class="v">${sup.filter(t=>t.status==='closed').length}</div><div class="l">Çözülen (tümü)</div><div class="d">${T.length} kayıt (tüm kategoriler)</div></div>
    </div>
    <div class="toolbar"><div class="seg">${Object.entries(tabs).map(([k,v])=>`<button data-st="${k}" class="${k===s.tab?'on':''}">${v}</button>`).join('')}</div></div>
    <div class="toolbar">
      <input type="search" id="sq" placeholder="Ara: müşteri, ürün, arıza, mail içeriği…" value="${esc(s.q)}" aria-label="Support ara" style="max-width:360px">
      <select id="sc" aria-label="Kategori"><option value="all">Tüm kategoriler</option>${Object.entries(SUP_CAT).map(([k,v])=>`<option value="${k}" ${s.cat===k?'selected':''}>${v}</option>`).join('')}</select>
      <select id="sp" aria-label="Ürün"><option value="">Tüm ürünler</option>${S.products.filter(p=>prods.includes(p.code)).map(p=>`<option value="${p.code}" ${s.product===p.code?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
      <select id="sw" aria-label="Sorumlu"><option value="">Tüm sorumlular</option><option value="me" ${s.who==='me'?'selected':''}>Bana atananlar</option><option value="none" ${s.who==='none'?'selected':''}>Atanmamış</option>${supPeople.map(p=>`<option value="${p.id}" ${s.who===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
      <select id="so" aria-label="Sıralama"><option value="act" ${s.sort==='act'?'selected':''}>Son harekete göre</option><option value="open" ${s.sort==='open'?'selected':''}>Açılış tarihine göre</option></select>
    </div><div class="tablewrap" id="stbl"></div>`);
  qa('[data-st]').forEach(b => b.onclick = () => { s.tab = b.dataset.st; viewSupport(); });
  let h;
  q('#sq').oninput = e => {
    s.q = e.target.value; s.hits = null; draw(); clearTimeout(h);
    if (s.q.trim().length >= 2) h = setTimeout(async () => {
      const qq = s.q; const { data, error } = await sb.rpc('support_search', { q: qq });
      if (!error && qq === s.q) { s.hits = data; draw(); }
    }, 350);
  };
  q('#sc').onchange = e => { s.cat = e.target.value; draw(); };
  q('#sp').onchange = e => { s.product = e.target.value; draw(); };
  q('#sw').onchange = e => { s.who = e.target.value; draw(); };
  q('#so').onchange = e => { s.sort = e.target.value; draw(); };
  q('#scsv').onclick = () => {
    const cols = ['id','subject','category','status','product','customer_name','organization','country','contact_email','assignee','opened_at','last_activity_at','closed_at','summary','resolution','tags'];
    const val = (t,c) => c === 'assignee' ? personName(t.assignee) : c === 'tags' ? (t.tags||[]).join('; ') : t[c] ?? '';
    const body = [cols.join(','), ...T.map(t => cols.map(c => `"${String(val(t,c)).replace(/"/g,'""')}"`).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + body], { type:'text/csv' })); a.download = `acrome-support-${today()}.csv`; a.click();
  };
  draw();
  if (s.q.trim().length >= 2 && !s.hits) q('#sq').dispatchEvent(new Event('input'));
}

async function viewTicket(id){
  if (!S.tickets) await loadSupport();
  await people();
  shell('support', `<div class="empty">Yükleniyor…</div>`);
  const [tr, mr, er] = await Promise.all([
    sb.from('support_tickets').select('*').eq('id', id).maybeSingle(),
    sb.from('support_messages').select('id,source,direction,from_name,from_email,to_emails,sent_at,subject,body,url,attachments,created_by').eq('ticket_id', id).order('sent_at'),
    sb.from('support_events').select('*').eq('ticket_id', id).order('at'),
  ]);
  const t = tr.data;
  if (tr.error || !t) return shell('support', `<h1>Konu bulunamadı</h1><p><a href="#/support">Support listesine dön</a></p>`);
  const msgs = mr.data || [], evs = (er.data || []).filter(e => e.kind !== 'created');
  const sugg = t.deal_id ? [] : ((await sb.from('support_deal_suggestions').select('deal_id,score,reason').eq('ticket_id', id).order('score', { ascending:false })).data || []);
  sb.from('support_notifications').update({ read_at: new Date().toISOString() }).eq('ticket_id', id).is('read_at', null).then(r => { if (!r.error && S.unread) loadSupport(); });
  const idx = S.tickets.findIndex(x => x.id === id); if (idx >= 0) S.tickets[idx] = { ...S.tickets[idx], ...t };

  const evText = e => e.kind === 'status' ? `Durum: ${SUP_STATUS[e.old_value]||e.old_value||'—'} → <b>${SUP_STATUS[e.new_value]||e.new_value}</b>`
    : e.kind === 'assignee' ? `Sorumlu: ${esc(e.old_value||'—')} → <b>${esc(e.new_value||'—')}</b>`
    : e.kind === 'merged' ? `Birleştirildi: ${esc(e.old_value)} "${esc(e.new_value||'')}"`
    : e.kind === 'category' ? `Kategori: ${SUP_CAT[e.old_value]||e.old_value} → <b>${SUP_CAT[e.new_value]||e.new_value}</b>` : esc(e.kind);
  const items = [...msgs.map(m => ({ at:m.sent_at, m })), ...evs.map(e => ({ at:e.at, e }))].sort((a,b) => b.at.localeCompare(a.at));
  const who = m => m.direction === 'in' ? 'Müşteri' : m.direction === 'out' ? 'Acrome' : SUP_SRC[m.source] || 'Dahili';
  const mine = m => canSup() && ['note','call','meet'].includes(m.source) && (m.created_by === S.profile.id || can('admin'));
  const msgHtml = m => {
    const long = (m.body||'').length > 900;
    return `<article class="msg msg-${m.direction} src-${m.source}">
      <header><span class="who">${who(m)}</span> <b>${esc(m.from_name || m.from_email || personName(m.created_by) || '')}</b>
        ${m.from_email && m.from_name ? `<span class="sub">&lt;${esc(m.from_email)}&gt;</span>` : ''}
        <span class="when">${fmtDT(m.sent_at)} · ${SUP_SRC[m.source]||m.source}${m.url?` · <a href="${esc(m.url)}" target="_blank" rel="noopener">aç ↗</a>`:''}
        ${mine(m)?` · <button class="linkbtn" data-delm="${m.id}">sil</button>`:''}</span></header>
      ${m.to_emails ? `<div class="sub">Kime: ${esc(m.to_emails)}</div>` : ''}
      <div class="body ${long?'clip':''}">${esc(m.body || '(boş)')}</div>
      ${long ? '<button class="linkbtn more">Tamamını göster</button>' : ''}
      ${(m.attachments||[]).length ? `<div class="items" style="margin-top:6px">${m.attachments.map(a => `<span>📎 ${esc(a.name||a)}</span>`).join('')}</div>` : ''}
    </article>`;
  };
  const myKey = supOrgKey(t);
  const hist = (S.tickets||[]).filter(h => h.id !== t.id && h.category !== 'other' && (() => { const k = supOrgKey(h); return (myKey.org && myKey.org.length > 3 && k.org === myKey.org) || (myKey.dom && k.dom === myKey.dom); })())
    .sort((a,b) => (b.product===t.product) - (a.product===t.product) || b.opened_at.localeCompare(a.opened_at));
  const opt = (o, v, blank) => (blank?`<option value="">${blank}</option>`:'') + Object.entries(o).map(([k,l]) => `<option value="${k}" ${v===k?'selected':''}>${l}</option>`).join('');
  const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,16); };

  shell('support', `
  <p><a href="#/support">← Support listesi</a></p>
  <div class="pagehead"><div><h1>${esc(t.subject)}</h1>
    <p class="lede"><span class="mono">#${t.id}</span> · ${esc([t.organization, t.customer_name, t.country].filter(Boolean).join(' · ') || 'Müşteri belirtilmemiş')} · açıldı ${fmtD(t.opened_at.slice(0,10))}</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${supPill(t.status)}
      ${!canSup()?'':t.status!=='closed'?`<button class="btn primary" id="tclose">Kapat</button>`:`<button class="btn" id="treopen">Yeniden aç</button>`}
      ${can('admin')?`<button class="btn danger" id="tdel">Sil</button>`:''}</div></div>
  <div class="grid sup-grid">
    <div>
      ${aiPanel(t, msgs.length)}
      ${t.summary ? `<section class="panel mt"><h2>Özet</h2><p style="margin:0;white-space:pre-wrap">${esc(t.summary)}</p>${t.resolution?`<h2 class="mt">Çözüm</h2><p style="margin:0;white-space:pre-wrap">${esc(t.resolution)}</p>`:''}</section>` : ''}
      <section class="panel mt"><h2>Zaman çizelgesi <span class="sub">(${msgs.length} mesaj · en yeni üstte)</span></h2>
        <div class="timeline">${items.length ? items.map(x => x.m ? msgHtml(x.m) : `<div class="ev"><span>${fmtDT(x.e.at)}</span> · ${esc(x.e.actor_name||'')} · ${evText(x.e)}</div>`).join('') : '<p class="note">Henüz mesaj yok.</p>'}</div>
      </section>
      ${hist.length ? `<section class="panel mt"><h2>Bu müşterinin destek geçmişi <span class="sub">(${hist.length} konu)</span></h2>
        <div class="tablewrap"><table><tbody>${hist.map(h => `<tr data-hid="${h.id}"><td class="mono">#${h.id}</td><td>${esc(h.subject)}<div class="sub">${h.product?esc(prodName(h.product)):'Ürün yok'} · açıldı ${fmtD(h.opened_at.slice(0,10))}</div></td><td>${supPill(h.status)}</td>${canSup()?`<td><button class="btn sm" data-merge="${h.id}" title="#${h.id} bu konunun içine taşınır">Buraya birleştir</button></td>`:''}</tr>`).join('')}</tbody></table></div>
        <p class="note">Aynı kurum veya aynı e-posta alan adından gelen diğer konular. Aynı ürün için olanları birleştirince tek bir support geçmişi oluşur.</p></section>` : ''}
      ${canSup() ? `<section class="panel mt"><h2>Not ekle</h2>
        <form id="nf" class="fs" novalidate>
          <div class="row r2"><label class="f">Tür<select name="src"><option value="note">Not</option><option value="call">Telefon görüşmesi</option><option value="meet">Meet / toplantı</option></select></label>
          <label class="f">Zaman<input type="datetime-local" name="at" value="${nowLocal()}"></label></div>
          <label class="f">Not <span class="hint">mail dışında konuşulanlar, yapılan iş, karar</span><textarea name="body" rows="4" required></textarea></label>
          <div class="row r2"><label class="f">Durumu da değiştir<select name="st"><option value="">Değiştirme</option>${opt(SUP_STATUS, '')}</select></label><div></div></div>
          <p><button class="btn primary">Notu kaydet</button></p>
        </form></section>
      <section class="panel mt"><h2>Konu numarasıyla birleştir</h2>
        <form id="mf" class="fs" novalidate><div class="row r2"><label class="f">Birleştirilecek konu no <span class="hint">virgülle birden fazla</span><input type="text" name="ids" placeholder="ör. 13, 33" inputmode="numeric"></label><div></div></div>
        <p class="note">Seçilen konuların mesajları ve geçmişi bu konuya (#${t.id}) taşınır; eski konular silinir, özetleri buraya not olarak eklenir.</p><p><button class="btn">Birleştir</button></p></form></section>` : ''}
    </div>
    <aside>
      ${dealPanel(t, sugg)}
      ${rmaBox({ ticket_id:t.id }, (S.rmas||[]).filter(x => x.ticket_id === t.id))}
      <section class="panel mt"><h2>Takip</h2>
        <form id="tf" class="fs" novalidate><fieldset ${canSup()?'':'disabled'} style="border:0;padding:0;margin:0;min-width:0">
          <label class="f">Durum<select name="status">${opt(SUP_STATUS, t.status)}</select></label>
          <label class="f">Sorumlu<select name="assignee"><option value="">—</option>${supPeople.map(p=>`<option value="${p.id}" ${t.assignee===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>
          <label class="f">Öncelik<select name="priority">${opt(SUP_PRIO, t.priority)}</select></label>
          <label class="f">Kategori<select name="category">${opt(SUP_CAT, t.category)}</select></label>
          <label class="f">Ürün<select name="product"><option value="">—</option>${S.products.map(p=>`<option value="${p.code}" ${t.product===p.code?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>
          <label class="f">Müşteri (kişi)<input type="text" name="customer_name" value="${esc(t.customer_name||'')}"></label>
          <label class="f">Kurum / bayi<input type="text" name="organization" value="${esc(t.organization||'')}"></label>
          <label class="f">Ülke<input type="text" name="country" value="${esc(t.country||'')}"></label>
          <label class="f">E-posta<input type="email" name="contact_email" value="${esc(t.contact_email||'')}"></label>
          <label class="f">Etiketler <span class="hint">virgülle ayır</span><input type="text" name="tags" value="${esc((t.tags||[]).join(', '))}"></label>
          <label class="f">Özet<textarea name="summary" rows="4">${esc(t.summary||'')}</textarea></label>
          <label class="f">Çözüm <span class="hint">kapanınca ne yapıldı</span><textarea name="resolution" rows="3">${esc(t.resolution||'')}</textarea></label>
          ${canSup()?'<p><button class="btn primary">Kaydet</button></p>':'<p class="note">Düzenlemek için yöneticiden <b>Sipariş + Support</b> rolü iste.</p>'}
        </fieldset></form>
        <dl class="kv mt">
          <dt>Son müşteri</dt><dd>${fmtDT(t.last_inbound_at)}</dd>
          <dt>Son Acrome</dt><dd>${fmtDT(t.last_outbound_at)}</dd>
          ${t.closed_at?`<dt>Kapandı</dt><dd>${fmtDT(t.closed_at)}</dd>`:''}
          ${(t.gmail_thread_ids||[]).length?`<dt>Gmail</dt><dd>${t.gmail_thread_ids.map(g=>`<a href="https://mail.google.com/mail/u/0/#all/${esc(g)}" target="_blank" rel="noopener">${esc(g)}</a>`).join('<br>')}</dd>`:''}
          ${(t.basecamp_urls||[]).length?`<dt>Basecamp</dt><dd>${t.basecamp_urls.map(u=>`<a href="${esc(u)}" target="_blank" rel="noopener">bağlantı ↗</a>`).join('<br>')}</dd>`:''}
        </dl>
      </section>
    </aside>
  </div>`);

  qa('.msg .more').forEach(b => b.onclick = () => { b.previousElementSibling.classList.remove('clip'); b.remove(); });
  const upd = async (fields, msg) => {
    const { error } = await sb.from('support_tickets').update(fields).eq('id', id);
    if (error) return toast(dbErr(error), true);
    toast(msg || 'Kaydedildi'); await loadSupport(); viewTicket(id);
  };
  const cl = q('#tclose'); if (cl) cl.onclick = () => {
    if (!q('#tf').resolution.value.trim()) { q('#tf').resolution.focus(); return toast('Kapatmadan önce "Çözüm" alanına ne yapıldığını yaz, sonra Kapat\'a tekrar bas.', true); }
    upd({ status:'closed', resolution: q('#tf').resolution.value.trim() }, 'Konu kapatıldı');
  };
  const ro = q('#treopen'); if (ro) ro.onclick = () => upd({ status:'ours' }, 'Konu yeniden açıldı');
  const dl = q('#tdel'); if (dl) dl.onclick = async () => {
    if (!confirmInline(dl, 'Silmek için tekrar bas')) return;
    const { error } = await sb.from('support_tickets').delete().eq('id', id);
    if (error) return toast(dbErr(error), true);
    S.tickets = S.tickets.filter(x => x.id !== id); toast('Konu silindi'); location.hash = '#/support';
  };
  const doMerge = async (ids, btn) => {
    const { error } = await sb.rpc('support_merge', { keep:id, drops:ids });
    if (error) { if (btn) btn.disabled = false; return toast(dbErr(error), true); }
    toast(`#${ids.join(', #')} bu konuya birleştirildi`); await loadSupport(); viewTicket(id);
  };
  qa('[data-merge]').forEach(b => b.onclick = e => { e.stopPropagation(); if (!confirmInline(b, `#${b.dataset.merge} bu konuya taşınacak, onaylamak için tekrar bas`)) return; b.disabled = true; doMerge([+b.dataset.merge], b); });
  qa('tr[data-hid]').forEach(r => r.onclick = () => location.hash = '#/support/' + r.dataset.hid);
  const mf = q('#mf'); if (mf) mf.onsubmit = e => { e.preventDefault(); const ids = [...new Set(e.target.ids.value.split(/[^0-9]+/).filter(Boolean).map(Number))].filter(x => x !== id); if (!ids.length) return toast('Konu numarası gir', true); const b = e.target.querySelector('button'); if (!confirmInline(b, 'Onaylamak için tekrar bas')) return; b.disabled = true; doMerge(ids, b); };
  q('#aicopy') && (q('#aicopy').onclick = () => { navigator.clipboard.writeText(t.ai_reply || '').then(() => toast('Taslak kopyalandı'), () => toast('Kopyalanamadı', true)); });
  if (!canSup()) return;
  const link = async (dealId, src) => {
    const { error } = await sb.from('support_tickets').update({ deal_id: dealId, deal_link_source: dealId ? src : null }).eq('id', id);
    if (error) return toast(dbErr(error), true);
    toast(dealId ? 'Sipariş bağlandı' : 'Sipariş bağlantısı kaldırıldı'); await loadSupport(); viewTicket(id);
  };
  qa('[data-link]').forEach(b => b.onclick = () => link(+b.dataset.link, 'manual'));
  q('#dunlink') && (q('#dunlink').onclick = () => link(null));
  q('#dform') && (q('#dform').onsubmit = e => { e.preventDefault(); const v = e.target.no.value.trim().toUpperCase().replace(/^(ACRPO)?[- ]?/, 'ACRPO-'); const d = S.deals.find(x => (x.order_no || '').toUpperCase() === v); if (!d) return toast('Bu numarada sipariş bulunamadı', true); link(d.id, 'manual'); });
  q('#tf').onsubmit = e => {
    e.preventDefault(); const f = e.target;
    const v = n => f[n].value.trim() || null;
    upd({ status:f.status.value, assignee:v('assignee'), priority:f.priority.value, category:f.category.value, product:v('product'),
      customer_name:v('customer_name'), organization:v('organization'), country:v('country'), contact_email:v('contact_email'),
      tags: f.tags.value.split(',').map(x => x.trim()).filter(Boolean), summary:v('summary'), resolution:v('resolution') });
  };
  q('#nf').onsubmit = async e => {
    e.preventDefault(); const f = e.target; const body = f.body.value.trim();
    if (!body) return toast('Not boş olamaz', true);
    const at = f.at.value ? new Date(f.at.value).toISOString() : new Date().toISOString();
    const { error } = await sb.from('support_messages').insert({ ticket_id:id, source:f.src.value, direction:'internal', sent_at:at, body,
      from_name: S.profile.full_name || S.profile.email, from_email: S.profile.email });
    if (error) return toast(dbErr(error), true);
    if (f.st.value && f.st.value !== t.status) return upd({ status:f.st.value }, 'Not eklendi');
    toast('Not eklendi'); await loadSupport(); viewTicket(id);
  };
  qa('[data-delm]').forEach(b => b.onclick = async () => {
    if (!confirmInline(b, 'Silmek için tekrar bas')) return;
    const { error } = await sb.from('support_messages').delete().eq('id', +b.dataset.delm);
    if (error) return toast(dbErr(error), true);
    toast('Not silindi'); viewTicket(id);
  });
}

function aiPanel(t, n){
  if (!t.ai_summary) return `<section class="panel ai"><h2>Yapay zekâ özeti</h2><p class="note" style="margin:0">Bu konunun özeti henüz hazırlanmadı. Her gün 09:30 ve 16:30'daki senkronda, yeni mail gelen konularla birlikte sırayla hazırlanır.</p></section>`;
  const stale = t.ai_msg_count != null && n > t.ai_msg_count;
  return `<section class="panel ai"><h2>Yapay zekâ özeti</h2><p class="note" style="margin:-6px 0 10px">${fmtDT(t.ai_updated_at)} itibarıyla tüm geçmişten${stale?' · <span class="amber-txt">sonra yeni mesaj geldi, bir sonraki senkronda güncellenecek</span>':''}</p>
    <p style="margin:0;white-space:pre-wrap">${esc(t.ai_summary)}</p>
    ${t.ai_next_step ? `<h3 class="mt">Önerilen adım</h3><p style="margin:0;white-space:pre-wrap">${esc(t.ai_next_step)}</p>` : ''}
    ${t.ai_reply ? `<h3 class="mt">Önerilen dönüş <button class="btn sm" id="aicopy" style="margin-left:8px">Kopyala</button></h3><div class="draft">${esc(t.ai_reply)}</div><p class="note" style="margin:6px 0 0">Taslaktır; göndermeden önce kontrol edin. Mail sistemden gönderilmez.</p>` : ''}
  </section>`;
}
function dealPanel(t, sugg){
  const d = t.deal_id ? S.deals.find(x => x.id === t.deal_id) : null;
  const items = d => Object.entries(d.items||{}).map(([c,q])=>`${fmtN(q)}× ${esc(prodName(c))}`).join(', ');
  const src = { order_no:'sipariş numarasından', auto:'müşteri + ürün eşleşmesinden', manual:'elle' };
  if (d) return `<section class="panel"><h2>Sipariş</h2><dl class="kv">
      <dt>Sipariş</dt><dd><a href="#/kayit/${d.id}" class="mono">${esc(d.order_no || d.opp_no)}</a></dd>
      <dt>Müşteri</dt><dd>${esc(custName(d))}${d.reseller?` <span class="sub">(${esc(d.reseller)})</span>`:''}</dd>
      ${items(d)?`<dt>Ürünler</dt><dd>${items(d)}</dd>`:''}
      <dt>Sipariş / sevk</dt><dd>${fmtD(d.order_date)} / ${fmtShip(d)}</dd></dl>
      <p class="note">Eşleşme: ${src[t.deal_link_source] || '—'}${canSup()?` · <button class="linkbtn" id="dunlink">kaldır</button>`:''}</p></section>`;
  const opts = sugg.map(s => { const x = S.deals.find(y => y.id === s.deal_id); return x ? `<li><a href="#/kayit/${x.id}" class="mono">${esc(x.order_no)}</a> ${esc(custName(x))} <span class="sub">${fmtD(x.order_date)} · ${esc(s.reason||'')}</span>${canSup()?` <button class="btn sm" data-link="${x.id}">Bağla</button>`:''}</li>` : ''; }).join('');
  return `<section class="panel"><h2>Sipariş</h2>
    ${opts ? `<p class="note" style="margin-top:0">Hangi sipariş olduğu kesin değil. Olası siparişler:</p><ul class="sugg">${opts}</ul>` : '<p class="note" style="margin-top:0">Bu konu bir siparişle eşleşmedi.</p>'}
    <div class="banner" style="margin:8px 0 0">Emin değilseniz müşteriye <b>sipariş numarasını</b> (ACRPO-…) veya cihazın <b>seri numarasını</b> sorun.</div>
    ${canSup() ? `<form id="dform" class="fs" novalidate style="margin-top:10px"><label class="f">Sipariş no ile bağla<input name="no" type="text" placeholder="ACRPO-512" list="dealnos"></label><datalist id="dealnos">${S.deals.filter(x=>x.order_no).slice(-400).map(x=>`<option value="${esc(x.order_no)}">${esc(custName(x))}</option>`).join('')}</datalist><p style="margin:6px 0 0"><button class="btn sm">Bağla</button></p></form>` : ''}
  </section>`;
}

// ---------------------------------------------------------------- BİLDİRİMLER
const PUSH_FN = APP_CONFIG.supabaseUrl + '/functions/v1/support-push';
const b64ToU8 = b => { const p = '='.repeat((4 - b.length % 4) % 4); const r = atob((b + p).replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from([...r].map(c => c.charCodeAt(0))); };
async function enablePush(btn){
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return toast('Bu tarayıcı bildirim desteklemiyor. iPhone\'da önce siteyi Paylaş → Ana Ekrana Ekle ile ekleyip oradan açın.', true);
  btn.disabled = true;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    if (await Notification.requestPermission() !== 'granted') throw new Error('Bildirim izni verilmedi');
    const tok = (await sb.auth.getSession()).data.session?.access_token;
    const { publicKey } = await (await fetch(PUSH_FN + '?action=publicKey', { headers:{ apikey: APP_CONFIG.supabaseKey, Authorization: 'Bearer ' + tok } })).json();
    if (!publicKey) throw new Error('Bildirim servisine ulaşılamadı');
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: b64ToU8(publicKey) });
    const j = sub.toJSON();
    const { error } = await sb.from('push_subscriptions').upsert({ endpoint:j.endpoint, p256dh:j.keys.p256dh, auth:j.keys.auth, user_agent:navigator.userAgent.slice(0,200) }, { onConflict:'endpoint' });
    if (error) throw error;
    toast('Bu cihazda bildirimler açıldı'); viewNotifications();
  } catch(e) { btn.disabled = false; toast(e.message || String(e), true); }
}
async function viewNotifications(){
  shell('bildirimler', `<div class="empty">Yükleniyor…</div>`);
  const [nr, sr] = await Promise.all([
    sb.from('support_notifications').select('id,ticket_id,created_at,read_at').order('created_at', { ascending:false }).limit(100),
    sb.from('push_subscriptions').select('id,user_agent,created_at').order('created_at'),
  ]);
  const ns = nr.data || [], subs = sr.data || [];
  const tk = id => (S.tickets||[]).find(t => t.id === id);
  let here = false; try { const reg = await navigator.serviceWorker?.getRegistration('sw.js'); here = !!(reg && await reg.pushManager.getSubscription()); } catch {}
  shell('bildirimler', `<div class="pagehead"><div><h1>Bildirimler</h1><p class="lede">Bir support konusuna müşteriden yeni mail geldiğinde, yalnızca konunun sorumlusuna bildirim gider (sorumlusu olmayan konularda bildirim gitmez). Bildirimde yalnızca yeni mail geldiği yazar; ayrıntı sitede.</p></div></div>
    <section class="panel"><h2>Bu cihaz</h2>
      <p class="note" style="margin-top:0">${here ? 'Bu cihazda bildirimler açık.' : 'Bu cihazda bildirim almak için aç. Telefon ve bilgisayarda ayrı ayrı açılır.'} Kayıtlı cihaz sayın: ${subs.length}.</p>
      <p style="display:flex;gap:8px;flex-wrap:wrap">${here ? '' : '<button class="btn primary" id="pon">Bu cihazda bildirimleri aç</button>'}<button class="btn" id="ptest">Test bildirimi gönder</button>${ns.some(n=>!n.read_at)?'<button class="btn" id="pread">Hepsini okundu say</button>':''}${ns.some(n=>n.read_at)?'<button class="btn" id="pdelr">Okunanları sil</button>':''}${ns.length?'<button class="btn danger" id="pdelall">Tümünü sil</button>':''}</p>
    </section>
    <div class="tablewrap mt">${ns.length ? `<table><tbody>${ns.map(n => { const t = tk(n.ticket_id); return `<tr data-nt="${n.ticket_id||''}" class="${n.read_at?'':'unread'}"><td style="white-space:nowrap">${fmtDT(n.created_at)}</td><td>${n.ticket_id ? `Yeni support maili · <span class="mono">#${n.ticket_id}</span> ${esc(t ? t.subject : '')}` : 'Test bildirimi'}</td><td>${n.read_at ? '<span class="sub">okundu</span>' : '<b>yeni</b>'}</td><td style="width:1%"><button class="btn ndel" data-nid="${n.id}" title="Bildirimi sil" aria-label="Bildirimi sil">Sil</button></td></tr>`; }).join('')}</tbody></table>` : '<div class="empty">Henüz bildirim yok.</div>'}</div>`);
  q('#pon') && (q('#pon').onclick = e => enablePush(e.target));
  q('#ptest').onclick = async e => { e.target.disabled = true; const { data, error } = await sb.rpc('support_push_test'); e.target.disabled = false; if (error) return toast(dbErr(error), true); toast('Test gönderildi'); await loadSupport(); viewNotifications(); };
  q('#pread') && (q('#pread').onclick = async () => { await sb.from('support_notifications').update({ read_at: new Date().toISOString() }).is('read_at', null); await loadSupport(); viewNotifications(); });
  const ndel = async (qb, msg) => { const { error } = await qb; if (error) return toast(dbErr(error), true); toast(msg); await loadSupport(); viewNotifications(); };
  q('#pdelr') && (q('#pdelr').onclick = () => ndel(sb.from('support_notifications').delete().not('read_at', 'is', null), 'Okunan bildirimler silindi'));
  q('#pdelall') && (q('#pdelall').onclick = e => { if (e.target.dataset.ok) return ndel(sb.from('support_notifications').delete().gte('id', 0), 'Tüm bildirimler silindi'); e.target.dataset.ok = 1; e.target.textContent = 'Emin misin? Tekrar bas'; });
  qa('.ndel').forEach(b => b.onclick = e => { e.stopPropagation(); ndel(sb.from('support_notifications').delete().eq('id', +b.dataset.nid), 'Bildirim silindi'); });
  qa('tr[data-nt]').forEach(r => r.onclick = () => r.dataset.nt && (location.hash = '#/support/' + r.dataset.nt));
}

async function viewTicketNew(){
  await people();
  shell('support', `<p><a href="#/support">← Support listesi</a></p><h1>Yeni support konusu</h1>
  <p class="lede">Mail dışında gelen (telefon, Meet, Basecamp, yüz yüze) bir konuyu kaydetmek için. Mailden gelenler otomatik eklenir.</p>
  <form id="tn" class="fs" style="max-width:760px" novalidate>
    <label class="f">Konu<input type="text" name="subject" required></label>
    <div class="row r2"><label class="f">Kategori<select name="category">${Object.entries(SUP_CAT).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
    <label class="f">Ürün<select name="product"><option value="">—</option>${S.products.map(p=>`<option value="${p.code}">${esc(p.name)}</option>`).join('')}</select></label></div>
    <div class="row r2"><label class="f">Müşteri (kişi)<input type="text" name="customer_name"></label><label class="f">Kurum / bayi<input type="text" name="organization"></label></div>
    <div class="row r2"><label class="f">Ülke<input type="text" name="country"></label><label class="f">E-posta<input type="email" name="contact_email"></label></div>
    <div class="row r2"><label class="f">Sorumlu<select name="assignee"><option value="">—</option>${supPeople.map(p=>`<option value="${p.id}" ${p.id===S.profile.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>
    <label class="f">Kaynak<select name="src"><option value="note">Not</option><option value="call">Telefon</option><option value="meet">Meet</option></select></label></div>
    <label class="f">Talep / ilk not<textarea name="body" rows="5"></textarea></label>
    <p><button class="btn primary">Konuyu aç</button></p>
  </form>`);
  q('#tn').onsubmit = async e => {
    e.preventDefault(); const f = e.target; const v = n => f[n].value.trim() || null;
    if (!v('subject')) return toast('Konu boş olamaz', true);
    const { data, error } = await sb.from('support_tickets').insert({ subject:v('subject'), category:f.category.value, product:v('product'), customer_name:v('customer_name'),
      organization:v('organization'), country:v('country'), contact_email:v('contact_email'), assignee:v('assignee'), status:'ours' }).select('id').single();
    if (error) return toast(dbErr(error), true);
    if (v('body')) await sb.from('support_messages').insert({ ticket_id:data.id, source:f.src.value, direction:'internal', body:v('body'), from_name:S.profile.full_name || S.profile.email, from_email:S.profile.email });
    await loadSupport(); toast('Konu açıldı'); location.hash = '#/support/' + data.id;
  };
}

// ================================================================ RMA
function rmaBox(link, list, cls){
  if (!list.length && !canRma()) return '';
  return `<section class="panel ${cls||'mt'}"><h2>RMA</h2>${list.length ? `<ul class="sugg">${list.map(r => `<li><a href="#/rma/${r.id}" class="mono">${esc(r.code)}</a> ${rmaPill(r.status)} <span class="sub">${fmtD(r.requested_at)}</span></li>`).join('')}</ul>` : '<p class="note" style="margin-top:0">Bu kayda bağlı RMA yok.</p>'}
    ${canRma() ? `<p style="margin:8px 0 0"><a class="btn sm" href="#/rma-yeni/${link.ticket_id ? 't' + link.ticket_id : 'd' + link.deal_id}">RMA aç</a></p>` : ''}</section>`;
}
const RMA_ST = { requested:'Talep', approved:'Onaylandı', in_transit:'Ürün yolda', received:'Teslim alındı', diagnosis:'Teşhis', quote:'Teklif / onay bekleniyor', repair:'Tamirde', test:'Test', shipped_back:'Geri gönderildi', closed:'Kapandı', cancelled:'İptal' };
const RMA_FLOW = ['requested','approved','in_transit','received','diagnosis','quote','repair','test','shipped_back','closed'];
const RMA_OUT = { repaired:'Tamir edildi', replaced:'Değiştirildi', refunded:'İade edildi', not_repairable:'Tamir edilemedi', no_fault:'Arıza bulunamadı' };
const RMA_COST = { customs_duty:'Gümrük vergisi', vat:'KDV', broker:'Gümrük müşaviri', freight_in:'Navlun (geliş)', freight_out:'Navlun (gidiş)', courier:'Kurye / kargo', insurance:'Sigorta', parts:'Parça', labor:'İşçilik', other:'Diğer' };
const RMA_REGIME = { returned_goods:'Geri gelen eşya', inward_processing:'Dahilde işleme', outward_processing:'Hariçte işleme', temporary:'Geçici ithalat / ihracat', none:'Gümrük yok (yurt içi)', other:'Diğer' };
const CURR = ['TRY','USD','EUR','GBP'];
const rmaPill = st => `<span class="pill rp-${['closed','cancelled'].includes(st)?'done':['received','diagnosis','quote','repair','test'].includes(st)?'in':'out'}">${RMA_ST[st]||st}</span>`;
const rmaOpen = r => !r.is_draft && !['closed','cancelled'].includes(r.status);
const rmaAtUs = r => ['received','diagnosis','quote','repair','test'].includes(r.status);
const rmaLate = r => rmaOpen(r) && r.estimated_ready_at && r.estimated_ready_at < today() && !r.shipped_back_at;
const dDiff = (a, b) => a && b ? Math.round((new Date(b) - new Date(a)) / 864e5) : null;
const fmtTRY = n => n ? (+n).toLocaleString('tr-TR', { maximumFractionDigits:0 }) + ' ₺' : '—';
const canRma = () => can('support','admin');
const rmaState = { tab:'open', q:'' };

async function loadRma(){
  const { data, error } = await sb.from('v_rma').select('*').order('requested_at', { ascending:false }).order('id', { ascending:false });
  S.rmas = error ? [] : data; S.rmaErr = error ? error.message : null;
}
// ürün bazlı geçmiş ortalama tamir süresi (geliş → tamir bitişi), tahmini süre önerisi için
function avgRepairDays(product){
  const xs = (S.rmas||[]).filter(r => r.product === product && r.received_at && r.repaired_at).map(r => dDiff(r.received_at, r.repaired_at));
  return xs.length ? Math.round(xs.reduce((a,b) => a+b, 0) / xs.length) : null;
}

async function viewRma(){
  await loadRma();
  const R = S.rmas, s = rmaState;
  const tabs = { open:'Açık', atus:'Ürün bizde', late:'Gecikenler', closed:'Kapanan', draft:'Taslaklar', all:'Tümü' };
  const mon = today().slice(0,7);
  const closedM = R.filter(r => r.status === 'closed' && (r.delivered_at||'').slice(0,7) === mon);
  const tat = R.filter(r => r.received_at && r.shipped_back_at).map(r => dDiff(r.received_at, r.shipped_back_at));
  const draw = () => {
    const ql = s.q.trim().toLocaleLowerCase('tr');
    const rows = R.filter(r => (s.tab === 'all' || (s.tab === 'draft' ? r.is_draft : s.tab === 'open' ? rmaOpen(r) && !r.is_draft : s.tab === 'atus' ? rmaAtUs(r) : s.tab === 'late' ? rmaLate(r) : !rmaOpen(r)))
      && (!ql || [r.code, r.customer, r.serial_no, r.fault_reported, r.diagnosis, r.failed_component, r.root_cause, prodName(r.product), r.order_no, r.invoice_in_no, r.invoice_out_no, r.import_decl_no, r.export_decl_no].join(' ').toLocaleLowerCase('tr').includes(ql)));
    q('#rtbl').innerHTML = rows.length ? `<table><thead><tr><th class="nosort">RMA</th><th class="nosort">Müşteri</th><th class="nosort">Ürün / seri no</th><th class="nosort">Durum</th><th class="nosort">Garanti</th><th class="nosort">Ürün geliş</th><th class="nosort">Tahmini hazır</th><th class="nosort num">Maliyet</th></tr></thead><tbody>
      ${rows.map(r => `<tr data-rid="${r.id}"><td class="mono" style="white-space:nowrap">${esc(r.code)}${r.is_draft?' <span class="pill rp-draft">Taslak</span>':''}<div class="sub">${fmtD(r.requested_at)}</div></td>
        <td>${esc(r.customer || '—')}${r.ticket_id?`<div class="sub">Support #${r.ticket_id}</div>`:''}</td>
        <td>${r.product?esc(prodName(r.product)):'—'}${r.serial_no?`<div class="sub mono">${esc(r.serial_no)}</div>`:''}</td>
        <td>${rmaPill(r.status)}${r.outcome?`<div class="sub">${RMA_OUT[r.outcome]}</div>`:''}${r.failed_component?`<div class="sub">${esc(r.failed_component)}</div>`:''}</td>
        <td>${r.in_warranty == null ? '<span class="sub">—</span>' : r.in_warranty ? '<span class="ok-txt">Garanti içi</span>' : '<span class="amber-txt">Garanti dışı</span>'}${r.warranty_end?`<div class="sub">${fmtD(r.warranty_end)}'e kadar</div>`:''}</td>
        <td>${fmtD(r.received_at)}</td>
        <td class="${rmaLate(r)?'late-txt':''}">${fmtD(r.estimated_ready_at)}${rmaLate(r)?`<div class="sub late-txt">${dDiff(r.estimated_ready_at, today())} gün gecikti</div>`:''}</td>
        <td class="num">${fmtTRY(r.cost_try)}${r.missing_fx?'<div class="sub amber-txt">kur eksik</div>':''}</td></tr>`).join('')}
      <tr class="tfoot"><td colspan="8">${rows.length} RMA</td></tr></tbody></table>`
      : `<div class="empty">${R.length ? 'Bu filtrede RMA yok.' : 'Henüz RMA kaydı yok. Support konusundan, sipariş sayfasından veya “Yeni RMA” ile açabilirsiniz.'}</div>`;
    qa('#rtbl tr[data-rid]').forEach(tr => tr.onclick = () => location.hash = '#/rma/' + tr.dataset.rid);
  };
  shell('rma', `<div class="pagehead"><div><h1>RMA</h1><p class="lede">Tamir / iade kayıtları: tarihler, garanti, faturalar, gümrük ve tüm masraflar. Kod: sipariş no + RMA sırası (ör. ACRPO-512-RMA#1).</p></div>
    <div style="display:flex;gap:8px"><a class="btn" href="#/rma-rapor">3 aylık rapor</a>${canRma()?'<a class="btn primary" href="#/rma-yeni">Yeni RMA</a>':''}</div></div>
    ${S.rmaErr ? `<div class="banner">RMA verisi okunamadı: ${esc(S.rmaErr)}</div>` : ''}
    <div class="kpis">
      <div class="kpi"><div class="v">${R.filter(rmaOpen).length}</div><div class="l">Açık RMA</div><div class="d">${R.filter(r => rmaOpen(r) && r.in_warranty).length} garanti içi</div></div>
      <div class="kpi"><div class="v">${R.filter(rmaAtUs).length}</div><div class="l">Ürün bizde</div><div class="d">Teslim alındı → test</div></div>
      <div class="kpi ${R.filter(rmaLate).length?'alert':''}"><div class="v">${R.filter(rmaLate).length}</div><div class="l">Tahmini süreyi aşan</div><div class="d">Hâlâ gönderilmedi</div></div>
      <div class="kpi"><div class="v">${tat.length ? Math.round(tat.reduce((a,b)=>a+b,0)/tat.length) : '—'}</div><div class="l">Ort. dönüş (gün)</div><div class="d">Geliş → geri gönderim</div></div>
      <div class="kpi"><div class="v">${closedM.length}</div><div class="l">Bu ay kapanan</div><div class="d">Toplam maliyet ${fmtTRY(R.reduce((a,r)=>a+(+r.cost_try||0),0))}</div></div>
    </div>
    <div class="toolbar"><div class="seg">${Object.entries(tabs).map(([k,v])=>`<button data-rt="${k}" class="${k===s.tab?'on':''}">${v}</button>`).join('')}</div>
      <input type="search" id="rq" placeholder="Ara: RMA, müşteri, seri no, fatura, beyanname…" value="${esc(s.q)}" aria-label="RMA ara" style="max-width:360px"></div>
    <div class="tablewrap" id="rtbl"></div>`);
  qa('[data-rt]').forEach(b => b.onclick = () => { s.tab = b.dataset.rt; viewRma(); });
  q('#rq').oninput = e => { s.q = e.target.value; draw(); };
  draw();
}

// 3 aylık RMA raporu (çeyrek: talep tarihine göre)
const quarterOf = d => `${d.slice(0,4)}-Ç${Math.floor((+d.slice(5,7) - 1) / 3) + 1}`;
async function viewRmaReport(qsel){
  await loadRma();
  const { data: costs } = await sb.from('rma_costs').select('rma_id,kind,direction,amount_try,currency,fx_rate');
  const qs = [...new Set((S.rmas||[]).map(r => quarterOf(r.requested_at)))].sort().reverse();
  const cur = qsel && qs.includes(decodeURIComponent(qsel)) ? decodeURIComponent(qsel) : (qs[0] || quarterOf(today()));
  const R = (S.rmas||[]).filter(r => quarterOf(r.requested_at) === cur);
  const ids = new Set(R.map(r => r.id));
  const C = (costs||[]).filter(c => ids.has(c.rma_id) && c.direction === 'cost');
  const sum = a => a.reduce((x,y) => x + (+y||0), 0);
  const tat = R.filter(r => r.received_at && r.shipped_back_at).map(r => dDiff(r.received_at, r.shipped_back_at));
  const rep = R.filter(r => r.received_at && r.repaired_at).map(r => dDiff(r.received_at, r.repaired_at));
  const grp = (arr, key) => { const m = new Map(); arr.forEach(r => { const k = (key(r) || '').trim() || '— (girilmemiş)'; m.set(k, (m.get(k)||0) + 1); }); return [...m.entries()].sort((a,b) => b[1]-a[1]); };
  const byKind = Object.keys(RMA_COST).map(k => [RMA_COST[k], sum(C.filter(c => c.kind === k).map(c => c.amount_try))]).filter(x => x[1]);
  const tbl = (head, rows) => rows.length ? `<table><thead><tr>${head.map(h=>`<th class="nosort">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p class="note">Veri yok.</p>';
  shell('rma', `<p><a href="#/rma">← RMA listesi</a></p>
  <div class="pagehead"><div><h1>RMA raporu · ${cur}</h1><p class="lede">Talep tarihi bu çeyrekte olan RMA'lar${R.some(r=>r.is_draft)?' (geçmişten çıkarılan taslaklar dahil)':''}.</p></div>
    <div style="display:flex;gap:8px;align-items:center"><select id="rq" aria-label="Çeyrek">${(qs.length?qs:[cur]).map(x=>`<option ${x===cur?'selected':''}>${x}</option>`).join('')}</select><button class="btn" onclick="window.print()">Yazdır / PDF</button></div></div>
  <div class="kpis">
    <div class="kpi"><div class="v">${R.length}</div><div class="l">RMA</div><div class="d">${R.filter(r=>r.status==='closed').length} kapandı · ${R.filter(rmaOpen).length} açık</div></div>
    <div class="kpi"><div class="v">${R.filter(r=>r.in_warranty).length}</div><div class="l">Garanti içi</div><div class="d">${R.filter(r=>r.in_warranty===false).length} garanti dışı</div></div>
    <div class="kpi"><div class="v">${rep.length?Math.round(sum(rep)/rep.length):'—'}</div><div class="l">Ort. tamir (gün)</div><div class="d">Geliş → tamir bitti</div></div>
    <div class="kpi"><div class="v">${tat.length?Math.round(sum(tat)/tat.length):'—'}</div><div class="l">Ort. dönüş (gün)</div><div class="d">Geliş → geri gönderim</div></div>
    <div class="kpi"><div class="v">${fmtTRY(sum(C.map(c=>c.amount_try)))}</div><div class="l">Toplam masraf</div><div class="d">${C.filter(c=>c.currency!=='TRY'&&!c.fx_rate).length?'Kuru eksik satırlar hariç':'Tüm satırlar dahil'}</div></div>
  </div>
  <div class="grid sup-grid">
    <div>
      <section class="panel"><h2>Sorunlu parçalar</h2><div class="tablewrap">${tbl(['Arızalı parça / bileşen','Adet'], grp(R, r=>r.failed_component).map(([k,n])=>[esc(k), n]))}</div></section>
      <section class="panel mt"><h2>Sorunu ne çıkardı</h2><div class="tablewrap">${tbl(['Kök neden','Adet'], grp(R, r=>r.root_cause).map(([k,n])=>[esc(k), n]))}</div></section>
      <section class="panel mt"><h2>Bu çeyreğin RMA'ları</h2><div class="tablewrap">${tbl(['RMA','Müşteri','Ürün','Durum','Arızalı parça','Kök neden','Masraf'], R.map(r=>[`<a href="#/rma/${r.id}" class="mono">${esc(r.code)}</a>${r.is_draft?' <span class="pill rp-draft">Taslak</span>':''}`, esc(r.customer||'—'), r.product?esc(prodName(r.product)):'—', RMA_ST[r.status], esc(r.failed_component||'—'), esc(r.root_cause||'—'), fmtTRY(r.cost_try)]))}</div></section>
    </div>
    <aside>
      <section class="panel"><h2>Ürüne göre</h2><div class="tablewrap">${tbl(['Ürün','RMA'], grp(R, r=>prodName(r.product)).map(([k,n])=>[esc(k), n]))}</div></section>
      <section class="panel mt"><h2>Masraf kalemleri</h2><div class="tablewrap">${tbl(['Kalem','Tutar'], byKind.map(([k,v])=>[k, fmtTRY(v)]))}</div></section>
      <section class="panel mt"><h2>Sonuç</h2><div class="tablewrap">${tbl(['Sonuç','Adet'], grp(R.filter(r=>r.outcome), r=>RMA_OUT[r.outcome]).map(([k,n])=>[k,n]))}</div></section>
    </aside>
  </div>`);
  q('#rq').onchange = e => location.hash = '#/rma-rapor/' + encodeURIComponent(e.target.value);
}

async function viewRmaForm(id, preset){
  if (!S.rmas) await loadRma();
  await people();
  let r;
  if (id) {
    const { data } = await sb.from('v_rma').select('*').eq('id', id).maybeSingle();
    if (!data) return shell('rma', `<h1>RMA bulunamadı</h1><p><a href="#/rma">RMA listesine dön</a></p>`);
    r = data;
  } else {
    r = { status:'requested', requested_at: today(), invoice_in_currency:'USD', invoice_out_currency:'USD', charged_currency:'USD', ...preset };
    if (r.ticket_id && !r.deal_id) { const t = (S.tickets||[]).find(x => x.id === r.ticket_id); if (t) Object.assign(r, { deal_id:t.deal_id || null, product:r.product || t.product, customer_name: t.organization || t.customer_name }); }
    if (r.deal_id) { const d = S.deals.find(x => x.id === r.deal_id); if (d) { r.customer_name = r.customer_name || custName(d); if (!r.product) r.product = Object.keys(d.items||{})[0] || null; } }
  }
  const [cr, er] = id ? await Promise.all([
    sb.from('rma_costs').select('*').eq('rma_id', id).order('doc_date', { ascending:true, nullsFirst:true }).order('id'),
    sb.from('rma_events').select('*').eq('rma_id', id).order('at', { ascending:false }),
  ]) : [{ data:[] }, { data:[] }];
  const costs = cr.data || [], evs = er.data || [];
  const d = r.deal_id ? S.deals.find(x => x.id === r.deal_id) : null;
  const avg = r.product ? avgRepairDays(r.product) : null;
  const ed = canRma();
  const v = k => esc(r[k] ?? '');
  const sel = (name, o, val, blank) => `<select name="${name}">${blank!==undefined?`<option value="">${blank}</option>`:''}${Object.entries(o).map(([k,l])=>`<option value="${k}" ${val===k?'selected':''}>${l}</option>`).join('')}</select>`;
  const cur = (name, val) => `<select name="${name}">${CURR.map(c=>`<option ${c===(val||'USD')?'selected':''}>${c}</option>`).join('')}</select>`;
  const dt = (name, label, hint) => `<label class="f">${label}${hint?` <span class="hint">${hint}</span>`:''}<input type="date" name="${name}" value="${v(name)}"></label>`;
  const tx = (name, label, hint, type='text') => `<label class="f">${label}${hint?` <span class="hint">${hint}</span>`:''}<input type="${type}" name="${name}" value="${v(name)}" ${type==='number'?'step="any"':''}></label>`;
  const ta = (name, label, rows=3) => `<label class="f">${label}<textarea name="${name}" rows="${rows}">${v(name)}</textarea></label>`;
  const nextSt = RMA_FLOW[RMA_FLOW.indexOf(r.status) + 1];
  const warrantyTxt = r.in_warranty == null ? (d ? 'Sevk tarihi yok, hesaplanamadı' : 'Sipariş bağlı değil') : `${r.in_warranty ? 'Garanti içi' : 'Garanti dışı'} · bitiş ${fmtD(r.warranty_end)} (${(r.deal_country||'').toUpperCase()==='TR'?'yurt içi 2 yıl':'yurt dışı 1 yıl'})`;
  const totals = (() => { const c = costs.filter(x=>x.direction==='cost'), i = costs.filter(x=>x.direction==='income'); const sum = a => a.reduce((s,x)=>s+(+x.amount_try||0),0); return { c:sum(c), i:sum(i), miss:costs.filter(x=>x.currency!=='TRY'&&!x.fx_rate).length }; })();

  shell('rma', `<p><a href="#/rma">← RMA listesi</a></p>
  <div class="pagehead"><div><h1>${id ? esc(r.code) : 'Yeni RMA'}</h1>
    <p class="lede">${esc(r.customer || r.customer_name || 'Müşteri belirtilmemiş')}${r.order_no?` · <a href="#/kayit/${r.deal_id}" class="mono">${esc(r.order_no)}</a>`:''}${r.ticket_id?` · <a href="#/support/${r.ticket_id}">Support #${r.ticket_id}</a>`:''}</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${r.is_draft?'<span class="pill rp-draft">Taslak</span>':''}${id?rmaPill(r.status):''}
      ${id && ed && r.is_draft ? '<button class="btn" id="rconfirm">Taslağı onayla</button>' : ''}
      ${id && ed && nextSt && r.status!=='cancelled' ? `<button class="btn primary" id="rnext">→ ${RMA_ST[nextSt]}</button>` : ''}
      ${id && (can('admin') || (ed && r.is_draft)) ? '<button class="btn danger" id="rdel">Sil</button>' : ''}</div></div>
  ${r.is_draft ? `<div class="banner">Bu kayıt geçmiş support konusundan otomatik çıkarılmış bir <b>taslak</b>. Bilgileri kontrol edip “Taslağı onayla” deyin; yanlışsa silin.</div>` : ''}
  ${id && rmaLate(r) ? `<div class="banner">Tahmini hazır olma tarihi (${fmtD(r.estimated_ready_at)}) geçti; ürün henüz geri gönderilmedi.</div>` : ''}
  <div class="grid sup-grid">
  <div>
  <form id="rf" class="fs plain" novalidate><fieldset ${ed?'':'disabled'} style="border:0;padding:0;margin:0;min-width:0">
    <section class="panel"><h2>Genel</h2>
      <div class="row r2"><label class="f">Durum${sel('status', RMA_ST, r.status)}</label><label class="f">Sorumlu<select name="assignee"><option value="">—</option>${supPeople.map(p=>`<option value="${p.id}" ${r.assignee===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label></div>
      <div class="row r2"><label class="f">Sipariş no <span class="hint">RMA kodu buna göre verilir</span><input name="order" list="rdeals" value="${esc(d ? d.order_no : '')}" placeholder="ACRPO-512"></label>
        <label class="f">Support konusu no<input name="ticket_id" type="number" value="${v('ticket_id')}" placeholder="ör. 13"></label></div>
      <datalist id="rdeals">${S.deals.filter(x=>x.order_no).slice(-500).map(x=>`<option value="${esc(x.order_no)}">${esc(custName(x))}</option>`).join('')}</datalist>
      <div class="row r2">${tx('customer_name','Müşteri')}<label class="f">Ürün<select name="product"><option value="">—</option>${S.products.map(p=>`<option value="${p.code}" ${r.product===p.code?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label></div>
      <div class="row r2">${tx('serial_no','Seri numarası')}<label class="f">Garanti <span class="hint">${esc(warrantyTxt)}</span><select name="warranty_override"><option value="">Otomatik (sevk tarihinden)</option><option value="true" ${r.warranty_override===true?'selected':''}>Garanti içi say</option><option value="false" ${r.warranty_override===false?'selected':''}>Garanti dışı say</option></select></label></div>
      ${ta('fault_reported','Müşterinin bildirdiği arıza')}
    </section>
    <section class="panel mt"><h2>Tarihler</h2>
      <div class="row r3">${dt('requested_at','Talep')}${dt('approved_at','Onay (RMA no verildi)')}${dt('customer_shipped_at','Müşteri gönderdi')}</div>
      <div class="row r3">${dt('received_at','Ürün geliş')}${dt('diagnosed_at','Teşhis')}<label class="f">Tahmini tamir süresi (gün) ${avg!=null?`<span class="hint">bu üründe ort. ${avg} gün</span>`:''}<input type="number" name="estimated_repair_days" min="0" value="${v('estimated_repair_days')}"></label></div>
      <div class="row r3"><label class="f">Tahmini hazır <span class="hint">geliş + süre</span><input type="date" value="${v('estimated_ready_at')}" disabled></label>${dt('repaired_at','Tamir bitti')}${dt('shipped_back_at','Geri gönderildi')}</div>
      <div class="row r3">${dt('delivered_at','Müşteriye teslim')}<div></div><div></div></div>
    </section>
    <section class="panel mt"><h2>Teşhis ve tamir</h2>
      ${ta('diagnosis','Bulunan arıza')}
      <div class="row r2 req">${tx('failed_component','Arızalı parça / bileşen','zorunlu · ör. pendulum kontrol kartı, SMD, motor')}${tx('root_cause','Sorunu ne çıkardı (kök neden)','zorunlu · ör. limit switch kablosu, aşırı akım, nakliye')}</div>
      <p class="note" style="margin:-4px 0 10px">Bu iki alan doldurulmadan "Test", "Geri gönderildi" ve "Kapandı" aşamalarına geçilemez; 3 aylık raporda sorunlu parçalar buradan çıkar.</p>
      ${tx('parts_replaced','Değişen / gönderilen parçalar')}
      <div class="row r2">${tx('labor_hours','İşçilik (saat)','','number')}<label class="f">Sonuç${sel('outcome', RMA_OUT, r.outcome||'', '—')}</label></div>${ta('repair_note','Tamir notu',2)}
    </section>
    <section class="panel mt"><h2>Kargo</h2>
      <div class="row r2">${tx('in_carrier','Geliş kargo firması')}${tx('in_tracking','Geliş takip no')}</div>
      <div class="row r2">${tx('out_carrier','Gidiş kargo firması')}${tx('out_tracking','Gidiş takip no')}</div>
    </section>
    <section class="panel mt"><h2>Faturalar <span class="sub">(elle girilir)</span></h2>
      <h3>Gelen fatura <span class="sub">(müşteri / bayi proforma veya ticari fatura)</span></h3>
      <div class="row r4">${tx('invoice_in_no','No')}${dt('invoice_in_date','Tarih')}${tx('invoice_in_amount','Tutar','','number')}<label class="f">Para birimi${cur('invoice_in_currency', r.invoice_in_currency)}</label></div>
      <h3 class="mt">Giden fatura <span class="sub">(Acrome'un kestiği; garanti içiyse bedelsiz)</span></h3>
      <div class="row r4">${tx('invoice_out_no','No')}${dt('invoice_out_date','Tarih')}${tx('invoice_out_amount','Tutar','','number')}<label class="f">Para birimi${cur('invoice_out_currency', r.invoice_out_currency)}</label></div>
      <div class="row r4">${tx('charged_to_customer','Müşteriye yansıtılan','','number')}<label class="f">Para birimi${cur('charged_currency', r.charged_currency)}</label><div></div><div></div></div>
    </section>
    <section class="panel mt"><h2>Gümrük</h2>
      <div class="row r2"><label class="f">Rejim${sel('customs_regime', RMA_REGIME, r.customs_regime||'', '—')}</label>${tx('original_export_decl','İlk ihracat beyannamesi no','geri gelen eşya muafiyeti için')}</div>
      <div class="row r4">${tx('import_decl_no','Giriş beyannamesi')}${dt('import_decl_date','Tarih')}${tx('export_decl_no','Çıkış beyannamesi')}${dt('export_decl_date','Tarih')}</div>
      <p class="note" style="margin:0">Geri gelen eşya: ihracattan sonra 3 yıl içinde ve aynı haliyle dönen ürün vergiden muaf olabilir; ihracatta alınan KDV iadesi için teminat gerekebilir. Uygulamayı gümrük müşavirinizle teyit edin.</p>
    </section>
    <section class="panel mt"><h2>Not</h2>${ta('notes','Genel not',2)}</section>
    ${ed ? `<p class="mt"><button class="btn primary">${id?'Kaydet':'RMA aç'}</button></p>` : '<p class="note">Düzenlemek için <b>Sipariş + Support</b> veya <b>Yönetici</b> rolü gerekir.</p>'}
  </fieldset></form>
  </div>
  <aside>
    ${id ? `<section class="panel"><h2>Masraflar</h2>
      <dl class="kv"><dt>Toplam masraf</dt><dd><b>${fmtTRY(totals.c)}</b></dd>${totals.i?`<dt>Gelir</dt><dd>${fmtTRY(totals.i)}</dd>`:''}</dl>
      ${totals.miss?`<p class="note amber-txt">${totals.miss} satırda kur girilmemiş; TL toplamına dahil değil.</p>`:''}
      ${costs.length?`<ul class="sugg">${costs.map(c=>`<li>${RMA_COST[c.kind]||c.kind}${c.direction==='income'?' <span class="sub">(gelir)</span>':''}: <b>${fmtN(c.amount)} ${esc(c.currency)}</b>${c.currency!=='TRY'?` <span class="sub">× ${c.fx_rate??'?'} = ${fmtTRY(c.amount_try)}</span>`:''}<div class="sub">${[c.doc_no, c.doc_date?fmtD(c.doc_date):'', c.note].filter(Boolean).map(esc).join(' · ')}${ed?` · <button class="linkbtn" data-delc="${c.id}">sil</button>`:''}</div></li>`).join('')}</ul>`:'<p class="note">Henüz masraf yok.</p>'}
      ${ed ? `<form id="cf" class="fs mt" novalidate>
        <div class="row r2"><label class="f">Tür${sel('kind', RMA_COST, 'customs_duty')}</label><label class="f">Yön<select name="direction"><option value="cost">Masraf</option><option value="income">Gelir</option></select></label></div>
        <div class="row r2"><label class="f">Tutar<input type="number" step="any" name="amount" required></label><label class="f">Para birimi${cur('currency','TRY')}</label></div>
        <div class="row r2"><label class="f">Kur <span class="hint">TRY dışı için, o günün</span><input type="number" step="any" name="fx_rate"></label><label class="f">Belge tarihi<input type="date" name="doc_date" value="${today()}"></label></div>
        <label class="f">Belge no <span class="hint">fatura / beyanname / dekont</span><input name="doc_no"></label>
        <label class="f">Not<input name="note"></label>
        <p style="margin:6px 0 0"><button class="btn">Masraf ekle</button></p></form>` : ''}
    </section>
    <section class="panel mt"><h2>Süreler</h2><dl class="kv">
      <dt>Talep → geliş</dt><dd>${dDiff(r.requested_at, r.received_at) ?? '—'} gün</dd>
      <dt>Geliş → tamir</dt><dd>${dDiff(r.received_at, r.repaired_at) ?? '—'} gün</dd>
      <dt>Geliş → gönderim</dt><dd>${dDiff(r.received_at, r.shipped_back_at) ?? '—'} gün</dd></dl></section>
    <section class="panel mt"><h2>Geçmiş</h2>${evs.length?`<div class="timeline">${evs.map(e=>`<div class="ev"><span>${fmtDT(e.at)}</span> · ${esc(e.actor_name||'')} · ${e.kind==='created'?'RMA açıldı':`Durum: ${RMA_ST[e.old_value]||e.old_value||'—'} → <b>${RMA_ST[e.new_value]||e.new_value}</b>`}</div>`).join('')}</div>`:'<p class="note">—</p>'}</section>` : `<section class="panel"><h2>Bilgi</h2><p class="note" style="margin:0">RMA açıldıktan sonra masraf satırları (gümrük, KDV, navlun, parça…) eklenebilir. Kod, sipariş numarasına göre otomatik verilir.</p></section>`}
  </aside></div>`);

  if (!ed) return;
  const collect = f => {
    const o = {}; const g = n => f[n] ? f[n].value.trim() : '';
    for (const k of ['customer_name','product','serial_no','fault_reported','failed_component','requested_at','approved_at','customer_shipped_at','received_at','diagnosed_at','repaired_at','shipped_back_at','delivered_at','diagnosis','root_cause','parts_replaced','outcome','repair_note','in_carrier','in_tracking','out_carrier','out_tracking','invoice_in_no','invoice_in_date','invoice_in_currency','invoice_out_no','invoice_out_date','invoice_out_currency','charged_currency','customs_regime','original_export_decl','import_decl_no','import_decl_date','export_decl_no','export_decl_date','notes','assignee','status']) o[k] = g(k) || null;
    for (const k of ['labor_hours','invoice_in_amount','invoice_out_amount','charged_to_customer','estimated_repair_days','ticket_id']) o[k] = g(k) === '' ? null : +g(k);
    o.warranty_override = g('warranty_override') === '' ? null : g('warranty_override') === 'true';
    if (!o.requested_at) o.requested_at = today();
    const on = g('order').toUpperCase();
    if (on) { const dd = S.deals.find(x => (x.order_no||'').toUpperCase() === on || (x.order_no||'').toUpperCase() === 'ACRPO-' + on.replace(/^ACRPO[- ]?/,'')); if (!dd) throw new Error('Bu numarada sipariş bulunamadı: ' + on); o.deal_id = dd.id; } else o.deal_id = null;
    return o;
  };
  q('#rf').onsubmit = async e => {
    e.preventDefault(); let o; try { o = collect(e.target); } catch (err) { return toast(err.message, true); }
    const res = id ? await sb.from('rma').update(o).eq('id', id).select('id').single() : await sb.from('rma').insert(o).select('id').single();
    if (res.error) return toast(dbErr(res.error), true);
    toast(id ? 'Kaydedildi' : 'RMA açıldı'); await loadRma(); location.hash = '#/rma/' + res.data.id; if (id) viewRmaForm(id);
  };
  q('#rnext') && (q('#rnext').onclick = async () => { const { error } = await sb.from('rma').update({ status: nextSt }).eq('id', id); if (error) return toast(dbErr(error), true); toast(RMA_ST[nextSt]); await loadRma(); viewRmaForm(id); });
  q('#rconfirm') && (q('#rconfirm').onclick = async () => { const { error } = await sb.from('rma').update({ is_draft:false }).eq('id', id); if (error) return toast(dbErr(error), true); toast('Taslak onaylandı'); await loadRma(); viewRmaForm(id); });
  q('#rdel') && (q('#rdel').onclick = async e => { if (!confirmInline(e.target, 'Silmek için tekrar bas')) return; const { error } = await sb.from('rma').delete().eq('id', id); if (error) return toast(dbErr(error), true); toast('RMA silindi'); await loadRma(); location.hash = '#/rma'; });
  q('#cf') && (q('#cf').onsubmit = async e => {
    e.preventDefault(); const f = e.target; const amt = +f.amount.value;
    if (!f.amount.value || isNaN(amt)) return toast('Tutar gir', true);
    const row = { rma_id:id, kind:f.kind.value, direction:f.direction.value, amount:amt, currency:f.currency.value, fx_rate: f.fx_rate.value ? +f.fx_rate.value : null, doc_no:f.doc_no.value.trim()||null, doc_date:f.doc_date.value||null, note:f.note.value.trim()||null };
    if (row.currency !== 'TRY' && !row.fx_rate) toast('Kur girilmedi; TL toplamına sonra eklenecek', false);
    const { error } = await sb.from('rma_costs').insert(row); if (error) return toast(dbErr(error), true);
    toast('Masraf eklendi'); await loadRma(); viewRmaForm(id);
  });
  qa('[data-delc]').forEach(b => b.onclick = async () => { if (!confirmInline(b, 'Silmek için tekrar bas')) return; const { error } = await sb.from('rma_costs').delete().eq('id', +b.dataset.delc); if (error) return toast(dbErr(error), true); await loadRma(); viewRmaForm(id); });
}

boot();
})();
