/* Acrome Üretim Planlama — tek sayfa uygulama */
(() => {
'use strict';

// ---------------------------------------------------------------- sabitler
const STAGES = { qualify:'1 · Nitelendirme', advance:'2 · İlerliyor', closing:'3 · Kapanış', won:'Kazanıldı', lost:'Kaybedildi' };
const STATUSES = { pipeline:'Fırsat', production:'Üretimde', shipped:'Gönderildi', lost:'Kaybedildi', archived:'Arşiv' };
const ROLES = { pending:'Erişim kapalı', viewer:'İzleyici', sales:'Satış', production:'Üretim', admin:'Yönetici' };
const CATS = { sistem:'Deney setleri', kontrolcu:'Kontrolcüler', smd:'SMD' };
const CURRENCIES = ['USD','EUR','GBP','TRY'];
const MONTHS = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
const RE_ORDER = /^ACRPO-I?[0-9]{1,4}(-(SP|P)[0-9]{1,2})?$/;
const RE_OPP = /^PROS-[0-9]{2}(-[0-9]{1,3}){1,2}$/;
const MIN_DATE = '2020-01-01', MAX_DATE = '2035-12-31';

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
    <div class="brand" style="padding:0">${logo()}<div>Acrome<small>Üretim planlama</small></div></div>
    <h1 style="margin-top:18px">${reset?'Şifre sıfırla':up?'Hesap oluştur':'Giriş yap'}</h1>
    <p class="note">${up?'@acrome.net adresinle hesap açınca raporları ve kayıtları hemen görebilirsin. Veri girişi için yöneticiden Satış veya Üretim rolü iste.':reset?'E-posta adresine sıfırlama bağlantısı gönderilir.':'Acrome ekip hesabınla giriş yap.'}</p>
    <form id="af" novalidate>
      ${up?`<label class="f">Ad soyad<input name="name" type="text" required autocomplete="name"></label>`:''}
      <label class="f">E-posta${up?' <span class="hint">@acrome.net adresin</span>':''}<input name="email" type="email" required autocomplete="email" ${up?'placeholder="ad.soyad@acrome.net"':''}></label>
      ${reset?'':`<label class="f">Şifre${up?' <span class="hint">en az 8 karakter</span>':''}<input name="pw" type="password" required minlength="${up?8:1}" autocomplete="${up?'new-password':'current-password'}"></label>`}
      <div class="err-box" id="aerr"></div>
      <button class="btn primary" type="submit">${reset?'Bağlantı gönder':up?'Hesap oluştur':'Giriş yap'}</button>
    </form>
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
    ...(can('sales','admin') ? [['yeni','Yeni kayıt']] : []),
    ['hr'],
    ['kaynaklar','Kaynak tablolar'],
    ['uyarilar','Veri uyarıları', openIssues || ''],
    ['gecmis','Değişiklik geçmişi'],
    ...(can('admin') ? [['kullanicilar','Kullanıcılar']] : []),
    ...(can('admin') && !S.deals.length ? [['ice-aktar','Excel verisini içe aktar']] : []),
  ];
  $app.innerHTML = `<div class="topbar"><div class="brand" style="padding:0">${logo()} Acrome</div><button class="btn sm" id="menu" aria-expanded="false">Menü</button></div>
  <div class="shell"><aside class="side" id="side">
    <div class="brand">${logo()}<div>Acrome<small>Üretim planlama</small></div></div>
    <nav class="nav">${nav.map(n => n[0]==='hr' ? '<hr>' : `<a href="#/${n[0]}" class="${active===n[0]?'on':''}">${n[1]}<span class="count">${n[2]??''}</span></a>`).join('')}</nav>
    <div class="me"><b>${esc(S.profile.full_name || S.profile.email)}</b>${ROLES[S.profile.role]} · <button class="linkbtn" id="lo">Çıkış</button></div>
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
    case 'yeni': return can('sales','admin') ? viewForm(null) : viewReport();
    case 'kayit': return viewDetail(+a);
    case 'duzenle': return viewForm(+a);
    case 'kaynaklar': return viewSources(a || 'musteriler');
    case 'uyarilar': return viewIssues();
    case 'gecmis': return viewAudit();
    case 'kullanicilar': return can('admin') ? viewUsers() : viewReport();
    case 'sifre': return viewNewPassword();
    case 'ice-aktar': return can('admin') ? viewImport() : viewReport();
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
  const shippedY = S.deals.filter(d => d.status === 'shipped' && yearOf(d.ship_date || d.requested_ship_date || d.order_date) === Y);
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
      <div class="legend"><span><i style="background:var(--brand)"></i>${Y}</span><span><i style="background:var(--line)"></i>${Y-1}</span></div>
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
    <div class="legend"><span><i style="background:var(--brand-soft);border:1px solid var(--brand)"></i>Sipariş → istenen sevk</span><span><i style="background:var(--amber-soft);border:1px solid var(--amber)"></i>14 gün içinde</span><span><i style="background:var(--red-soft);border:1px solid var(--red)"></i>Gecikmiş</span><span><i style="background:var(--violet);transform:rotate(45deg)"></i>Planlanan sevk</span></div></div>
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
const listState = { q:'', year:'', country:'', product:'', sort:'date', dir:-1 };
function viewList(tab){
  const T = today();
  const tabs = { production:'Üretimde', pipeline:'Fırsatlar', shipped:'Gönderilenler', lost:'Kaybedilenler', archived:'Arşiv', all:'Tümü' };
  const base = tab === 'all' ? S.deals : S.deals.filter(d => d.status === tab);
  const years = [...new Set(base.map(d => yearOf(d.order_date || d.lead_date)).filter(Boolean))].sort().reverse();
  const ctrs = [...new Set(base.map(d => d.country).filter(Boolean))].sort((a,b)=>ctryName(a).localeCompare(ctryName(b),'tr'));
  const draw = () => {
    const s = listState, ql = s.q.toLocaleLowerCase('tr');
    let rows = base.filter(d =>
      (!ql || [d.order_no,d.opp_no,custName(d),d.description,d.details,d.reseller,d.notes].join(' ').toLocaleLowerCase('tr').includes(ql)) &&
      (!s.year || yearOf(d.order_date || d.lead_date) === +s.year) &&
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
        ${tab==='shipped'?`<td>${fmtD(d.ship_date)}</td>`:''}${tab==='pipeline'?`<td>${STAGES[d.stage]}</td>`:''}
        <td class="num">${fmtUSD(d.amount_usd)}${d.currency!=='USD'&&d.amount_orig?`<div class="sub">${fmtN(d.amount_orig)} ${d.currency}</div>`:''}</td></tr>`; }).join('')}
      <tr class="tfoot"><td colspan="${tab==='all'||tab==='shipped'||tab==='pipeline'?6:5}">${rows.length} kayıt</td><td class="num">${fmtUSD(total)}</td></tr>
      </tbody></table>` : `<div class="empty">Bu filtrelerle kayıt yok.${can('sales','admin')?' <a href="#/yeni">Yeni kayıt ekle</a>':''}</div>`;
    qa('#tbl th[data-s]').forEach(th => th.onclick = () => { const k = th.dataset.s; if (s.sort===k) s.dir*=-1; else { s.sort=k; s.dir = k==='cust'||k==='ref'||k==='due' ? 1 : -1; } draw(); });
    qa('#tbl tr[data-id]').forEach(tr => tr.onclick = () => location.hash = '#/kayit/' + tr.dataset.id);
    q('#csv').onclick = () => csv(rows, `acrome-${tab}-${T}.csv`);
  };
  if (tab === 'production' && listState.sort === 'date') { listState.sort = 'due'; listState.dir = 1; }
  shell('kayitlar/' + tab, `<div class="pagehead"><div><h1>${{production:'Üretimdeki siparişler',pipeline:'Açık fırsatlar',shipped:'Gönderilen siparişler',lost:'Kaybedilen fırsatlar',archived:'Arşiv',all:'Tüm kayıtlar'}[tab]}</h1>
    <p class="lede">${tab==='archived'?'Excel\'in eski yıllarında kalan ve 2026 listesine taşınmamış fırsatlar.':'Satıra tıklayınca kaydın detayı açılır.'}</p></div>
    <div style="display:flex;gap:8px"><button class="btn" id="csv">CSV indir</button>${can('sales','admin')?'<a class="btn primary" href="#/yeni">Yeni kayıt</a>':''}</div></div>
    <div class="toolbar"><div class="seg">${Object.entries(tabs).map(([k,v])=>`<button data-t="${k}" class="${k===tab?'on':''}">${v}</button>`).join('')}</div></div>
    <div class="toolbar">
      <input type="search" id="fq" placeholder="Ara: no, müşteri, açıklama…" value="${esc(listState.q)}" aria-label="Ara">
      <select id="fy" aria-label="Yıl"><option value="">Tüm yıllar</option>${years.map(y=>`<option ${+listState.year===y?'selected':''}>${y}</option>`).join('')}</select>
      <select id="fc" aria-label="Ülke"><option value="">Tüm ülkeler</option>${ctrs.map(c=>`<option value="${c}" ${listState.country===c?'selected':''}>${esc(ctryName(c))}</option>`).join('')}</select>
      <select id="fp" aria-label="Ürün"><option value="">Tüm ürünler</option>${S.products.map(p=>`<option value="${p.code}" ${listState.product===p.code?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
    </div><div class="tablewrap" id="tbl"></div>`);
  qa('[data-t]').forEach(b => b.onclick = () => location.hash = '#/kayitlar/' + b.dataset.t);
  q('#fq').oninput = e => { listState.q = e.target.value; draw(); };
  q('#fy').onchange = e => { listState.year = e.target.value; draw(); };
  q('#fc').onchange = e => { listState.country = e.target.value; draw(); };
  q('#fp').onchange = e => { listState.product = e.target.value; draw(); };
  draw();
}
function csv(rows, name){
  const cols = [['No',refNo],['PROS',d=>d.opp_no],['Müşteri',custName],['Ülke',d=>ctryName(d.country)],['Açıklama',d=>d.description],['Aşama',d=>STAGES[d.stage]],['Durum',d=>STATUSES[d.status]],
    ['Fırsat girişi',d=>d.lead_date],['Sipariş tarihi',d=>d.order_date],['İstenen sevk',d=>d.requested_ship_date],['Planlanan sevk',d=>d.planned_ship_date],['Sevk tarihi',d=>d.ship_date],
    ['Tutar USD',d=>d.amount_usd],['Para birimi',d=>d.currency],['Orijinal tutar',d=>d.amount_orig],...S.products.map(p=>[p.name,d=>(d.items||{})[p.code]||'']),['Detay',d=>d.details],['Ödeme',d=>d.payment_terms],['Not',d=>d.notes]];
  const cell = v => { v = v==null?'':String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v; };
  const txt = '﻿' + [cols.map(c=>c[0]).join(';'), ...rows.map(r => cols.map(c => cell(c[1](r))).join(';'))].join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt],{type:'text/csv;charset=utf-8'})); a.download = name; a.click();
}

// ---------------------------------------------------------------- AYLIK GÖNDERİM RAPORU
const shipState = { year: null, month: '', exactOnly: false, cat: 'all' };
const shipDate = d => d.ship_date || d.requested_ship_date || d.order_date || null;
function viewShipments(){
  const all = S.deals.filter(d => d.status === 'shipped' && shipDate(d));
  const years = [...new Set(all.map(d => yearOf(shipDate(d))))].sort();
  if (!shipState.year || !years.includes(shipState.year)) shipState.year = years.includes(new Date().getFullYear()) ? new Date().getFullYear() : years[years.length-1];
  const st = shipState, Y = st.year;
  const pool = all.filter(d => yearOf(shipDate(d)) === Y && (!st.exactOnly || d.ship_date));
  const inMonth = d => !st.month || +shipDate(d).slice(5,7) === +st.month;
  const rows = pool.filter(inMonth).sort((a,b) => shipDate(a) < shipDate(b) ? -1 : 1);
  const live = rows.filter(d => !d.is_internal);
  const sum = a => a.reduce((t,d) => t + (+d.amount_usd||0), 0);
  const est = rows.filter(d => !d.ship_date).length;
  const prods = S.products.filter(p => st.cat === 'all' || p.category === st.cat);
  const unitsOf = arr => { const u = {}; arr.forEach(d => Object.entries(d.items||{}).forEach(([c,q]) => u[c] = (u[c]||0) + +q)); return u; };
  const sysUnits = Object.entries(unitsOf(rows)).filter(([c]) => (S.products.find(p=>p.code===c)||{}).category === 'sistem').reduce((t,[,q]) => t+q, 0);

  // aylık seriler
  const byM = Array.from({length:12}, (_,i) => pool.filter(d => +shipDate(d).slice(5,7) === i+1));
  const mVal = byM.map(a => sum(a.filter(d=>!d.is_internal))), mMax = Math.max(1, ...mVal);
  const mUnits = byM.map(unitsOf);
  const usedProds = prods.filter(p => mUnits.some(u => u[p.code]));
  const canShip = can('production','sales','admin');

  shell('gonderim', `
  <div class="pagehead"><div><h1>Aylık gönderim raporu</h1>
    <p class="lede">Gönderilmiş siparişler sevk ayına göre. Sevk tarihi girilmemiş siparişlerde istenen sevk tarihi kullanılır ve listede ≈ ile gösterilir.</p></div>
    <div style="display:flex;gap:8px"><button class="btn" id="scsv">CSV indir</button></div></div>
  <div class="toolbar">
    <label class="f" style="width:120px">Yıl<select id="sy">${years.map(y=>`<option ${y===Y?'selected':''}>${y}</option>`).join('')}</select></label>
    <label class="f" style="width:150px">Ay<select id="sm"><option value="">Tüm yıl</option>${MONTHS.map((m,i)=>`<option value="${i+1}" ${+st.month===i+1?'selected':''}>${['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'][i]}</option>`).join('')}</select></label>
    <label class="f" style="width:170px">Ürün grubu<select id="sc"><option value="all">Tümü</option>${Object.entries(CATS).map(([k,v])=>`<option value="${k}" ${st.cat===k?'selected':''}>${v}</option>`).join('')}</select></label>
    <label style="display:flex;gap:6px;align-items:center;margin-top:20px;font-size:13px"><input type="checkbox" id="sx" ${st.exactOnly?'checked':''}> Sadece sevk tarihi girilmiş olanlar</label>
  </div>
  ${est ? `<div class="banner">${rows.length} gönderimin <b>${est}</b> tanesinde sevk tarihi girilmemiş; bu kayıtlar istenen sevk tarihine göre sayıldı.${canShip?' Listeden gerçek sevk tarihini girebilirsin.':''}</div>` : ''}

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
    ${rows.map(d => `<tr data-id="${d.id}"><td style="white-space:nowrap">${d.ship_date ? fmtD(d.ship_date) : `<span title="Sevk tarihi girilmemiş; istenen sevk tarihi">≈ ${fmtD(shipDate(d))}</span>${canShip?`<div><input type="date" class="shipin" data-sid="${d.id}" max="${today()}" min="${d.order_date||MIN_DATE}" aria-label="Gerçek sevk tarihi" style="min-height:28px;padding:2px 6px;font-size:12px;margin-top:4px;width:140px"></div>`:''}`}</td>
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
    const cols = [['Sevk tarihi',d=>d.ship_date||''],['Tarih esası',d=>d.ship_date?'Sevk tarihi':'İstenen sevk (tahmini)'],['Rapor tarihi',shipDate],['No',refNo],['Müşteri',custName],['Ülke',d=>ctryName(d.country)],['Açıklama',d=>d.description],['Tutar USD',d=>d.amount_usd],['Dahili',d=>d.is_internal?'Evet':''],...S.products.map(p=>[p.name,d=>(d.items||{})[p.code]||''])];
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
    ${can('sales','admin') && d.status==='pipeline' ? `<a class="btn primary" href="#/duzenle/${d.id}?siparis">Siparişe çevir</a>`:''}
    ${can('production') && d.status==='production' ? `<a class="btn primary" href="#/duzenle/${d.id}">Sevk bilgisi gir</a>`:''}
    ${can('sales','admin','production') ? `<a class="btn" href="#/duzenle/${d.id}">Düzenle</a>`:''}
    ${can('admin') ? `<button class="btn danger" id="del">Sil</button>`:''}</div></div>
  ${iss.length ? `<div class="banner"><b>Excel'den aktarımda düzeltilen alanlar:</b><br>${iss.map(i=>esc(i.message)).join('<br>')}</div>`:''}
  <div class="grid g2">
    <section class="panel"><h2>Bilgiler</h2><dl class="kv">
      ${kv('Ülke', esc(ctryName(d.country)))}${kv('Aşama', STAGES[d.stage])}${kv('Teklif no', esc(d.quote_no))}${kv('Bayi / aracı', esc(d.reseller))}
      ${kv('Fırsat girişi', d.lead_date && fmtD(d.lead_date))}${kv('Beklenen PO', d.expected_po_date && fmtD(d.expected_po_date))}${kv('Sipariş tarihi', d.order_date && fmtD(d.order_date))}
      ${kv('İstenen sevk', d.requested_ship_date && fmtD(d.requested_ship_date))}${kv('Planlanan sevk', d.planned_ship_date && fmtD(d.planned_ship_date))}${kv('Sevk tarihi', d.ship_date && fmtD(d.ship_date))}
      ${kv('Gecikme açıklaması', esc(d.delay_reason))}
    </dl></section>
    <section class="panel"><h2>Tutar ve ürünler</h2><dl class="kv">
      ${kv('Tutar (USD)', fmtUSD(d.amount_usd))}${d.currency!=='USD'?kv('Orijinal tutar', fmtN(d.amount_orig)+' '+d.currency):''}${kv('SMD satışı', d.smd_sales_usd!=null && fmtUSD(d.smd_sales_usd))}${kv('Ödeme planı', esc(d.payment_terms))}${d.is_internal?kv('Tür','Dahili (Acrome içi)'):''}
    </dl>
    ${Object.keys(d.items||{}).length ? `<table class="mt"><tbody>${Object.entries(d.items).map(([c,q])=>`<tr style="cursor:default"><td>${esc(prodName(c))}</td><td class="num">${fmtN(q)}</td></tr>`).join('')}</tbody></table>`:'<p class="note">Ürün kalemi yok.</p>'}
    </section>
  </div>
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
  if (!can('sales','admin','production')) return viewDetail(id);
  const convert = /siparis/.test(location.hash);
  const prodOnly = can('production');
  const d = ex ? structuredClone(ex) : { status:'pipeline', stage:'qualify', currency:'USD', items:{}, lead_date: today() };
  if (convert) { d.status = 'production'; d.stage = 'won'; d.order_date = d.order_date || today(); }
  let kind = ['production','shipped'].includes(d.status) ? 'order' : 'opp';
  const cust = ex ? S.customers.find(c => c.id === ex.customer_id) : null;

  const stageOpts = () => kind==='order' ? ['won'] : ['qualify','advance','closing','lost'];
  const statusOpts = () => kind==='order' ? ['production','shipped'] : ['pipeline','lost','archived'];
  const dis = f => prodOnly && !['planned_ship_date','ship_date','status','delay_reason'].includes(f) ? 'disabled' : '';
  const v = k => esc(d[k] ?? '');
  const dt = (k, label, hint) => `<label class="f">${label}${hint?` <span class="hint">${hint}</span>`:''}<input type="date" name="${k}" value="${v(k)}" min="${MIN_DATE}" max="${MAX_DATE}" ${dis(k)}><span class="err" data-e="${k}"></span></label>`;

  const html = () => `
  <p><a href="${ex?'#/kayit/'+ex.id:'#/kayitlar/all'}">← Vazgeç</a></p>
  <h1>${convert?'Fırsatı siparişe çevir':ex?'Kaydı düzenle':'Yeni kayıt'}</h1>
  <p class="lede">${prodOnly?'Üretim rolüyle yalnızca planlanan sevk, sevk tarihi, durum ve gecikme açıklamasını değiştirebilirsin.':'Kırmızı işaretli alanlar düzeltilmeden kayıt yapılamaz. Aynı kurallar veritabanında da uygulanır.'}</p>
  ${!ex ? `<div class="typepick"><button type="button" data-k="opp" class="${kind==='opp'?'on':''}"><b>Fırsat</b><span>Teklif aşamasındaki iş, PROS numarasıyla</span></button><button type="button" data-k="order" class="${kind==='order'?'on':''}"><b>Sipariş</b><span>Kazanılmış iş, ACRPO numarasıyla üretime girer</span></button></div>`:''}
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
      ${kind==='order' ? `<div class="row">${dt('planned_ship_date','Planlanan sevk','üretim doldurur')}${dt('ship_date','Sevk tarihi','gönderildiğinde')}<span></span></div>
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
    if (d.status === 'shipped' && !d.ship_date) errs.ship_date = 'Gönderildi durumu için sevk tarihi zorunlu.';
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
    for (const k of ['id','order_no','opp_no','country','description','stage','status','quote_no','lead_date','order_date','expected_po_date','requested_ship_date','planned_ship_date','ship_date','details','delay_reason','payment_terms','notes','reseller','amount_usd','currency','amount_orig','smd_sales_usd','is_internal'])
      payload[k] = d[k] === '' ? null : d[k] ?? null;
    if (kind==='opp') { payload.order_date = d.order_date || null; }
    if (payload.currency === 'USD') payload.amount_orig = null;
    payload.customer_id = existingCust ? existingCust.id : null;
    const { data, error } = await sb.rpc('save_deal', { p_deal: payload, p_items: prodOnly ? null : (d.items||{}), p_customer_name: existingCust ? null : d.customer, p_customer_country: d.country || null });
    if (error) { btn.disabled = false; btn.textContent = ex ? 'Değişiklikleri kaydet' : 'Kaydı oluştur'; return toast(dbErr(error), true); }
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
    <div class="tablewrap"><table><thead><tr><th class="nosort">Müşteri</th><th class="nosort">Ülke</th><th class="nosort num">Kayıt</th><th class="nosort num">Sipariş</th><th class="nosort num">Toplam ciro</th><th class="nosort">Son hareket</th>${can('sales','admin')?'<th class="nosort"></th>':''}</tr></thead>
    <tbody id="sb">${S.customers.map(c => { const a = agg[c.id]||{n:0,won:0,amt:0,last:''}; return `<tr data-n="${esc(c.name.toLocaleLowerCase('tr'))}" style="cursor:default"><td>${esc(c.name)}</td><td>${esc(ctryName(c.country))}</td><td class="num">${a.n}</td><td class="num">${a.won}</td><td class="num">${fmtUSD(a.amt)}</td><td>${fmtD(a.last)}</td>${can('sales','admin')?`<td><button class="btn sm" data-ec="${c.id}">Düzenle</button></td>`:''}</tr>`; }).join('')}</tbody></table></div>`;
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
function editCustomer(id, tr){
  const c = S.customers.find(x => x.id === id);
  tr.innerHTML = `<td><input type="text" value="${esc(c.name)}" id="cn"></td><td><select id="cc">${S.countries.map(k=>`<option value="${k.code}" ${c.country===k.code?'selected':''}>${esc(k.name)}</option>`).join('')}</select></td><td colspan="4"></td><td style="white-space:nowrap"><button class="btn sm primary" id="cs">Kaydet</button> <button class="btn sm" id="cx">Vazgeç</button></td>`;
  q('#cx').onclick = () => viewSources('musteriler');
  q('#cs').onclick = async () => { const name = q('#cn').value.trim(); if (name.length < 2) return toast('Müşteri adı gir', true);
    const { error } = await sb.from('customers').update({ name, country: q('#cc').value }).eq('id', id); if (error) return toast(dbErr(error), true); await loadAll(); toast('Müşteri güncellendi'); viewSources('musteriler'); };
}

// ---------------------------------------------------------------- UYARILAR
function viewIssues(){
  const open = S.issues.filter(i => !i.resolved);
  shell('uyarilar', `<div class="pagehead"><div><h1>Veri uyarıları</h1><p class="lede">Excel'den aktarırken otomatik düzeltilen ya da boş bırakılan alanlar. Kaydı kontrol edip doğruysa "Kontrol edildi" de.</p></div></div>
  ${open.length ? `<div class="tablewrap"><table><thead><tr><th class="nosort">Kayıt</th><th class="nosort">Uyarı</th><th class="nosort"></th></tr></thead><tbody>
  ${open.map(i => { const d = S.deals.find(x => x.id === i.deal_id); return `<tr data-id="${i.deal_id}"><td class="mono">${esc(d?refNo(d):i.record_key)}<div class="sub">${esc(d?custName(d):'')}</div></td><td>${esc(i.message)}</td><td>${can('sales','admin','production')?`<button class="btn sm" data-ok="${i.id}">Kontrol edildi</button>`:''}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="panel empty">Açık uyarı yok.</div>'}`);
  qa('tr[data-id]').forEach(tr => tr.onclick = e => { if (!e.target.dataset.ok) location.hash = '#/kayit/' + tr.dataset.id; });
  qa('[data-ok]').forEach(b => b.onclick = async () => { const { error } = await sb.from('import_issues').update({ resolved:true }).eq('id', +b.dataset.ok); if (error) return toast(dbErr(error), true); S.issues.find(i=>i.id===+b.dataset.ok).resolved = true; viewIssues(); });
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
  <div class="panel" style="margin-bottom:16px"><dl class="kv"><dt>Erişim kapalı</dt><dd>Giriş yapabilir ama hiçbir veriyi göremez.</dd><dt>İzleyici</dt><dd>Rapor ve kayıtları görür, değiştiremez.</dd><dt>Satış</dt><dd>Fırsat ve sipariş girer, düzenler; müşteri ekler.</dd><dt>Üretim</dt><dd>Yalnızca planlanan sevk, sevk tarihi, durum (Üretimde ↔ Gönderildi) ve gecikme açıklamasını değiştirir.</dd><dt>Yönetici</dt><dd>Her şey + silme, ürün yönetimi, rol verme.</dd></dl></div>
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

boot();
})();
