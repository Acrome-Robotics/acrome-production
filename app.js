/* Acrome Üretim Planlama — tek sayfa uygulama */
(() => {
'use strict';

// ---------------------------------------------------------------- sabitler
const STAGES = { qualify:'1 · Nitelendirme', advance:'2 · İlerliyor', closing:'3 · Kapanış', won:'Kazanıldı', lost:'Kaybedildi' };
const STATUSES = { pipeline:'Fırsat', production:'Üretimde', shipped:'Gönderildi', lost:'Kaybedildi', archived:'Arşiv' };
const ROLES = { pending:'Erişim kapalı', viewer:'İzleyici', sales:'Satış', production:'Üretim', orders:'Sipariş', support:'Support', purchasing:'Satın alma', stock:'Depo / Stok', muhasebe:'Muhasebe', personel:'Personel', admin:'Yönetici' };
// rol ayrıntıları (Kullanıcılar sayfası)
const ROLE_INFO = { viewer:'Rapor ve kayıtları görür, değiştiremez.', sales:'Fırsat ve sipariş girer, düzenler; müşteri ekler.',
  production:'Üretim alanlarını (planlanan sevk, sevk tarihi, durum, gecikme) değiştirir; sipariş aşamalarını günceller (bölüm seçildiyse yalnız o aşamaları); stok, BOM ve alım taleplerini yönetir.',
  orders:'Fırsat ve siparişlerin tümünü düzenler, müşteri ekler; stok, BOM ve alım taleplerini yönetir.',
  support:'Support konuları ve RMA kayıtlarını düzenler: durum, sorumlu, not, kapatma, birleştirme.',
  purchasing:'Alım taleplerinin durumunu, fiyatını ve tedarikçisini yönetir; tedarikçi ekler.',
  stock:'Stok giriş-çıkış-sayım, BOM, PCB kartları ve motor testlerini yönetir; alım taleplerini günceller. Her ayın ilk cuması sayım e-postası alır.',
  muhasebe:'Masraf formlarının hepsini görür; onaylar, reddeder, ödendi işaretler. Diğer sayfaları izleyici gibi görür.',
  personel:'Yalnızca haftalık çalışma planını, daily notlarını ve kendi masraf formunu görür (atölye, stajyer vb.).',
  admin:'Her şey + silme, ürün yönetimi, rol verme.' };
const staffOnly = () => !!S.profile && userRoles(S.profile).length > 0 && userRoles(S.profile).every(r => r === 'personel');
const userRoles = p => !p ? [] : Array.isArray(p.roles) ? p.roles : p.role === 'pending' ? [] : p.role === 'support' ? ['orders','support'] : [p.role];
// Rol önizleme (yalnız yönetici, geliştirme kontrolü için): arayüzü seçilen rollerle gösterir; veri ve yazma yetkisi yöneticininkidir.
const PV_KEY = 'rolePreview';
const getPreview = () => { try { return JSON.parse(localStorage.getItem(PV_KEY) || 'null'); } catch { return null; } };
const realAdmin = () => userRoles(S.realProfile || S.profile).includes('admin');
const roleLabel = p => userRoles(p).length ? userRoles(p).map(r => ROLES[r] || r).join(' + ') : ROLES.pending;
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
// yoğunluk: Rahat / Kompakt (kompakt: sıkı satırlar, ikincil ayrıntılar gizli, gerekli bilgi kalır)
function getDensity(){ try { return localStorage.getItem('density') || 'comfy'; } catch { return 'comfy'; } }
function setDensity(v){ document.documentElement.classList.toggle('compact', v === 'compact'); try { localStorage.setItem('density', v); } catch {}
  qa('.dens button').forEach(b => b.setAttribute('aria-pressed', b.dataset.dn === v)); }
const densSwitch = () => `<div class="theme dens" role="group" aria-label="Tablo yoğunluğu">${[['comfy','Rahat'],['compact','Kompakt']].map(([k,v]) => `<button type="button" data-dn="${k}" aria-pressed="${getDensity()===k}">${v}</button>`).join('')}</div>`;
document.addEventListener('click', e => { const b = e.target.closest('.dens button'); if (b) setDensity(b.dataset.dn); });
setDensity(getDensity());

// ---------------------------------------------------------------- durum
const S = { session:null, profile:null, deals:[], customers:[], products:[], countries:[], issues:[], loaded:false };
const sb = window.MOCK_DB || window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseKey);
const $app = document.getElementById('app');

// ---------------------------------------------------------------- yardımcılar
const normUrl = u => { u = String(u || '').trim(); return !u ? null : /^https?:\/\//i.test(u) ? u : /^[\w.-]+\.[a-z]{2,}([\/?#].*)?$/i.test(u) ? 'https://' + u : u; };
// Supabase en fazla 1000 satır döndürür; hepsini sayfa sayfa al
async function fetchAll(mk){ const out = []; for (let k = 0; ; k += 1000) { const { data, error } = await mk().range(k, k + 999); if (error) return { data:out, error }; out.push(...(data || [])); if (!data || data.length !== 1000) return { data:out, error:null }; } }
const safeUrl = u => /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '#';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ymd = x => `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
const today = () => ymd(new Date());
const fmtUSD = n => n == null ? '—' : '$' + Math.round(n).toLocaleString('tr-TR');
const fmtK = n => n == null ? '—' : (Math.abs(n) >= 1e6 ? '$' + (n/1e6).toLocaleString('tr-TR',{maximumFractionDigits:2}) + ' milyon' : Math.abs(n) >= 1e3 ? '$' + Math.round(n/1e3).toLocaleString('tr-TR') + ' bin' : '$' + Math.round(n));
const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('tr-TR',{day:'2-digit',month:'short',year:'numeric'}) : '—';
const fmtN = n => (+n).toLocaleString('tr-TR',{maximumFractionDigits:1});
const days = (a,b) => Math.round((new Date(b+'T00:00:00') - new Date(a+'T00:00:00'))/864e5);
const addDays = (d,n) => { const x = new Date(d+'T00:00:00'); x.setDate(x.getDate()+n); return ymd(x); };
const yearOf = d => d ? +d.slice(0,4) : null;
const can = (...roles) => !!S.profile && userRoles(S.profile).some(r => roles.includes(r));
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
  await Promise.all([loadStock(true), loadPurCount(), loadStages(), loadExpPending(), loadAttToday().catch(() => {})]);
  if (isCountDay() && can('stock')) sb.rpc('stock_count_notify_me').then(r => { if (r && r.data) loadSupport(); }, () => {});
}
// aylık stok sayımı: her ayın ilk cuması
const isCountDay = (d = new Date()) => d.getDay() === 5 && d.getDate() <= 7;
const nextCountDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); for (let i = 0; i < 40; i++, d.setDate(d.getDate() + 1)) if (isCountDay(d)) return d; return null; };
const countDayTxt = () => { const d = nextCountDay(); return d ? d.toLocaleDateString('tr-TR', { day:'numeric', month:'long', weekday:'long' }) : ''; };
const countBanner = () => isCountDay() && can('stock', 'production', 'admin') ? `<div class="banner countday"><b>Bugün aylık stok sayımı günü.</b> Rafları sayıp girin: <a href="#/mekanik-sayim">Mekanik sayım</a> · <a href="#/elektronik-sayim">Elektronik sayım</a></div>` : '';

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
  S.profile = data || { role:'pending', email:S.session.user.email }; S.realProfile = S.profile;
  { const pv = getPreview(); if (pv && Array.isArray(pv.roles) && pv.roles.length && userRoles(S.profile).includes('admin'))
      S.profile = { ...S.profile, roles:pv.roles, role:pv.roles.includes('admin') ? 'admin' : pv.roles[0], departments:pv.departments || [], _preview:true }; }
  if (S.profile.role === 'pending' || !userRoles(S.profile).length) return renderPending();
  if (staffOnly()) { Object.assign(S, { deals:[], customers:[], products:[], countries:[], issues:[], items:[], boms:[], tickets:[], rmas:[] });
    try { await loadAttToday(); } catch {} window.onhashchange = route; return route(); }
  try { await loadAll(); } catch(e){ $app.innerHTML = `<div class="boot">Veri okunamadı: ${esc(dbErr(e))}</div>`; return; }
  window.onhashchange = route; route();
}

function renderAuth(mode='in'){
  const up = mode === 'up', reset = mode === 'reset';
  $app.innerHTML = `<div class="auth"><div class="box">
    <div class="brand" style="padding:0">${logo()}<div>Acrome<small>Üretim · Satış · Support</small></div></div>
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
// Acrome logosu (gizli kopyada gradyan kaybolmasın diye her çizimde ayrı kimlik)
let logoN = 0;
const logo = () => { const g = 'lg' + (++logoN); return `<svg width="32" height="32" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E41F2B"/><stop offset="1" stop-color="#A3141F"/></linearGradient></defs><circle cx="32" cy="32" r="31.5" fill="#C41E2A"/><circle cx="32" cy="32" r="31.5" fill="url(#${g})"/><path fill="#fff" d="M14.8 42.5h5.8l13.2-33.1h-5.7zM32.9 12.6l1.3-3 11.1 32.9h-3.8zM14 46h33.8v3.3H14z"/></svg>`; };

// ---------------------------------------------------------------- iskelet
// menü grubu ikonları (16px, çizgi)
const svgI = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  chart: svgI('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>'),
  help: svgI('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7"/><path d="M12 17h.01"/>'),
  wrench: svgI('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z"/>'),
  cart: svgI('<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M3 4h2l2.4 11h11.2L21 8H6.2"/>'),
  box: svgI('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'),
  home: svgI('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
  gear: svgI('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  report: svgI('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 17v-3M12 17v-6M16 17v-2"/>'),
  db: svgI('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
  users: svgI('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>'),
  chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
};
const navClosed = () => { try { return JSON.parse(localStorage.getItem('navClosed') || '[]'); } catch { return []; } };
function shell(active, html){
  const cnt = st => S.deals.filter(d => d.status === st).length;
  const openIssues = S.issues.filter(i => !i.resolved).length;
  // menü: Bugün + ana başlıklar (üretim üstte, rapor en altta veriden önce)
  const ekip = ['Ekip', 'users', [
      ['calisma-plani','Haftalık çalışma planı', attTodayEmpty() ? 1 : '', 'hot'],
      ['daily','Daily notları'],
      ['masraf','Masraf formu'],
      ...(canAcc() ? [['masraf-liste','Masraf formları', S.expPending || '', 'hot']] : []),
      ...(can('admin') ? [['calisma-raporu','Aylık çalışma raporu'], ['calisma-kisiler','Çalışma planı kişileri']] : []),
    ]];
  const nav = staffOnly() ? [ekip] : [
    ['Üretim', 'gear', [
      ['uretim-pano','Üretim panosu', myDeps().length ? S.deals.filter(d => d.status === 'production' && myDeps().includes((curStage(d.id) || [])[0])).length || '' : ''],
      ['kayitlar/production','Üretimdeki siparişler', cnt('production')],
      ['kayitlar/shipped','Gönderilenler', cnt('shipped')],
    ]],
    ['Satış', 'chart', [
      ['kayitlar/pipeline','Açık fırsatlar', cnt('pipeline')],
      ['kayitlar/all','Tüm kayıtlar', S.deals.length],
      ...(can('sales','orders','admin') ? [['yeni','Yeni kayıt']] : []),
    ]],
    ['Support', 'help', [
      ['support','Konular', supOpenCount() || '', 'hot'],
      ...(can('support','admin') ? [['support-yeni','Yeni konu']] : []),
      ['rma','RMA kayıtları', (S.rmas||[]).filter(rmaOpen).length || ''],
      ...(can('support','admin') ? [['rma-yeni','Yeni RMA']] : []),
    ]],
    ['Alımlar', 'cart', [
      ['alimlar','Talepler', S.purOpen || ''],
      ['alim-yeni','Yeni talep'],
      ['tedarikciler','Tedarikçiler'],
      ...(canPurchase() ? [['tedarikciler/hesaplar','Site hesapları', '', '', '', 'tedarikciler-hesap']] : []),
    ]],
    ['Stok', 'box', [
      ['mekanik-stok','Mekanik stok', (S.items||[]).filter(i => critical(i) && grpOfCat(i.category) === 'm').length || ''],
      ...(canStock() ? [['mekanik-sayim','Mekanik sayım', '', '', 'sub']] : []),
      ['elektronik-stok','Elektronik stok', (S.items||[]).filter(i => critical(i) && grpOfCat(i.category) === 'e').length || ''],
      ...(canStock() ? [['elektronik-sayim','Elektronik sayım', '', '', 'sub']] : []),
      ['bom','BOM listesi'],
      ...(/^bom/.test(active) ? [
        ...(S.boms||[]).filter(b => b.kind === 'product').map(b => ['bom/' + b.id, esc(b.name), '', '', 'sub', 'bom-p' + b.id]),
        ['bom/proje','Proje BOM\'ları', (S.boms||[]).filter(b => b.kind === 'project' && b.status === 'aktif').length || '', '', 'sub', 'bom-proje'],
        ...(canStock() ? [['bom-yeni','+ Yeni proje BOM\'u', '', '', 'sub']] : []),
      ] : []),
      ['pcb','PCB kartları'],
      ['motor-test','Motor testleri'],
    ]],
    ekip,
    ['Rapor', 'report', [
      ['rapor','Üretim ve satış raporu'],
      ['gonderim','Aylık gönderim raporu'],
      ['rma-rapor','RMA 3 aylık rapor'],
      ['alim-rapor','Aylık alım raporu'],
    ]],
    ['Veri', 'db', [
      ['bildirimler','Bildirimler', S.unread || '', 'hot'],
      ['kaynaklar','Kaynak tablolar'],
      ['uyarilar','Veri kontrolü', (openIssues + liveProblemCount()) || '', 'hot'],
      ['gecmis','Değişiklik geçmişi'],
      ...(can('admin') ? [['kullanicilar','Kullanıcılar']] : []),
      ...(can('admin') && !S.deals.length ? [['ice-aktar','Excel verisini içe aktar']] : []),
      ...(can('admin') && S.deals.length ? [['excel','Excel\'den güncelle']] : []),
      ...(can('admin') ? [['stok-aktar', (S.items||[]).length ? 'Stok görsellerini yükle' : 'Stok verisini içe aktar']] : []),
    ]],
  ];
  const todayHot = staffOnly() ? 0 : todayCount();
  const home = staffOnly() ? '#/calisma-plani' : '#/bugun';
  $app.innerHTML = `<div class="topbar"><a class="brand homelink" href="${home}" style="padding:0" title="Ana sayfa">${logo()} Acrome</a><button class="btn sm" id="menu" aria-expanded="false">Menü</button></div>
  <div class="shell"><aside class="side" id="side"><button class="btn sm side-close" id="sideclose" type="button">Kapat ✕</button>
    <a class="brand homelink" href="${home}" title="Ana sayfa">${logo()}<div>Acrome<small>Üretim · Satış · Support</small></div></a>
    <nav class="nav">${staffOnly() ? '' : `<a href="#/bugun" class="ntop ${active==='bugun'?'on':''}">${ICON.home}<span>Bugün</span><span class="count${todayHot?' hot':''}">${todayHot||''}</span></a>`}${nav.map(([g, ic, items]) => { const cur = items.some(n => (n[5] || n[0]) === active), closed = !cur && (navClosed().includes(g) || matchMedia('(max-width:820px)').matches), hot = items.reduce((a, n) => a + (n[3] === 'hot' ? (+n[2] || 0) : 0), 0);
      return `<div class="ngroup${cur ? ' cur' : ''}${closed ? ' closed' : ''}" data-g="${g}"><button class="nhead" type="button" aria-expanded="${!closed}">${ICON[ic]||''}<span>${g}</span>${closed && hot ? `<span class="gcount">${hot}</span>` : ''}${ICON.chev}</button><div class="nitems">${items.map(n => n[0] ? `<a href="#/${n[0]}" class="${active===(n[5]||n[0])?'on':''}${n[4]==='sub'?' sub2':''}">${n[1]}<span class="count${n[3]==='hot'&&n[2]?' hot':''}">${n[2]||''}</span></a>` : `<span class="nsoon">${n[1]}</span>`).join('')}</div></div>`; }).join('')}</nav>
    <div class="me"><b>${esc(S.profile.full_name || S.profile.email)}</b>${esc(roleLabel(S.profile))} · <button class="linkbtn" id="lo">Çıkış</button>${realAdmin() ? ` · <a href="#/rol-onizleme">Rol önizleme</a>` : ''}<div class="prefs">${themeSwitch()}${densSwitch()}</div></div>
  </aside><main class="main" id="main">${S.profile._preview ? `<div class="pvbar" role="status"><span>👁 <b>Rol önizleme:</b> ${esc(roleLabel(S.profile))}${myDeps().length ? ' · bölüm: ' + esc(myDeps().map(stgName).join(', ')) : ''}. Yalnız arayüz değişir; veri ve kayıtlar yönetici yetkinle yapılır.</span><span><a href="#/rol-onizleme">Değiştir</a> · <button class="linkbtn" id="pvexit">Önizlemeden çık</button></span></div>` : ''}${html}</main></div>`;
  q('#lo').onclick = () => sb.auth.signOut();
  q('#pvexit') && (q('#pvexit').onclick = () => { try { localStorage.removeItem(PV_KEY); } catch {} location.hash = '#/kullanicilar'; location.reload(); });
  qa('.nhead').forEach(h => h.onclick = () => { const g = h.parentNode, k = g.dataset.g, set = new Set(navClosed());
    g.classList.toggle('closed'); const c = g.classList.contains('closed'); h.setAttribute('aria-expanded', !c); c ? set.add(k) : set.delete(k);
    try { localStorage.setItem('navClosed', JSON.stringify([...set])); } catch {} });
  q('#menu').onclick = e => { const s = q('#side'); s.classList.toggle('open'); e.target.setAttribute('aria-expanded', s.classList.contains('open')); };
  qa('#side a').forEach(a => a.onclick = () => q('#side').classList.remove('open'));
  q('#sideclose').onclick = () => { q('#side').classList.remove('open'); q('#menu').setAttribute('aria-expanded', 'false'); };
}

function route(){
  const [p, a] = location.hash.replace(/^#\/?/,'').split('?')[0].split('/');
  window.scrollTo(0,0); if (typeof closeAttPop === 'function') closeAttPop();
  if (p === 'rol-onizleme' && realAdmin()) return viewRolePreview();
  if (p === 'masraf') return a ? viewExpenseDetail(+a) : viewExpense();
  if (p === 'masraf-liste') return canAcc() ? viewExpenseList() : viewExpense();
  if (staffOnly()) return p === 'sifre' ? viewNewPassword() : p === 'daily' ? viewDaily(a) : viewAttendance(a);
  switch(p){
    case 'calisma-plani': case 'yoklama': return viewAttendance(a);
    case 'daily': return viewDaily(a);
    case 'daily-aktar': return viewDailyImport();
    case 'calisma-raporu': case 'yoklama-rapor': return viewAttReport();
    case 'calisma-kisiler': case 'yoklama-kisiler': return viewAttPeople();
    case 'kayitlar': return viewList(a || 'all');
    case 'gonderim': return viewShipments();
    case 'uretim-pano': case 'pano': return viewBoard();
    case 'yeni': return can('sales','orders','admin') ? viewForm(null) : viewReport();
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
      case 'bugun': return viewToday();
    case 'stok': return a && /^\d+$/.test(a) ? viewStockItem(+a) : viewStock('m');
    case 'mekanik-stok': return viewStock('m');
    case 'elektronik-stok': return viewStock('e');
    case 'stok-yeni': return canStock() ? viewStockItem(null, a) : viewStock(a);
    case 'stok-aktar': return viewStockImport();
    case 'stok-guncelle': case 'mekanik-sayim': return viewStockUpdate('m', a);
    case 'elektronik-sayim': return viewStockUpdate('e', a);
    case 'alim-rapor': return viewPurchaseReport();
    case 'bom': return a === 'proje' ? viewBomList('proje') : a ? viewBom(+a) : viewBomList();
    case 'bom-yeni': return viewBomNew(a);
    case 'pcb': return viewPcb(a);
    case 'motor-test': return viewMotorTests();
    case 'alimlar': return a ? viewPurchase(+a) : viewPurchases();
    case 'alim-yeni': { const m = /^i(\d+)$/.exec(a || ''); const it = m && (S.items||[]).find(i => i.id === +m[1]);
      return viewPurchase(null, it ? { item_id:it.id, item_name:it.name, unit:grpOfCat(it.category) === 'm' ? 'Mekanik' : 'Elektronik', supplier_id:it.supplier_id, unit_price:it.unit_price, currency:it.currency } : {}); }
    case 'tedarikciler': return viewSuppliers(a);
    case 'rapor': return viewReport();
    default: return viewToday();
  }
}

// ---------------------------------------------------------------- BUGÜN (role göre)
// Her rol kendi işini görür: support → kendi konuları + RMA, üretim → sevk takvimi + ürün bizde RMA'lar,
// satış → fırsatlar + yaklaşan sevkler, yönetici → hepsi.
function todaySections(){
  const me = S.profile.id, role = S.profile.role, T = today(), in14 = new Date(Date.now() + 14*864e5).toISOString().slice(0,10);
  const isAdmin = role === 'admin';
  const tk = (S.tickets || []).filter(t => t.category !== 'other');
  const mine = t => isAdmin || t.assignee === me || (t.watchers || []).includes(me);
  const prod = S.deals.filter(d => d.status === 'production' && !d.is_internal);
  const due = d => d.planned_ship_date || d.requested_ship_date;
  const R = (S.rmas || []).filter(r => !r.is_draft);
  const tRow = t => { const w = supWait(t); return { href:'#/support/' + t.id, main:`<span class="mono">#${t.id}</span> ${esc(t.subject)}`, sub:esc(t.organization || t.customer_name || ''), meta: w ? `<span class="${w.cls}">${w.txt.replace(' · takip et','')}</span>` : `<span class="sub">${ago(t.last_activity_at)}</span>`, hot: !!w && (t.status === 'new' || t.status === 'ours') }; };
  const dRow = (d, late) => ({ href:'#/kayit/' + d.id, main:`<span class="mono">${esc(refNo(d))}</span> ${esc(custName(d))}`, sub:esc(d.description || ''), meta: due(d) ? `<span class="${late ? 'late-txt' : ''}">${late ? Math.floor((Date.now() - new Date(due(d))) / 864e5) + ' gün gecikti' : fmtD(due(d))}</span>` : '<span class="sub">tarih yok</span>', hot: late });
  const rRow = r => ({ href:'#/rma/' + r.id, main:`<span class="mono">${esc(r.code)}</span> ${esc(r.customer || r.customer_name || '')}`, sub:[r.product ? prodName(r.product) : '', r.failed_component].filter(Boolean).map(esc).join(' · '), meta: rmaLate(r) ? '<span class="late-txt">süre aşıldı</span>' : rmaPill(r.status), hot: rmaLate(r) });
  const S_ = [];
  { const a = attTodaySection(); if (a) S_.push(a); }
  const sup = can('support','admin'), prodR = can('production','orders','stock','admin'), sales = can('sales','orders','admin'), view = userRoles(S.profile).every(r => r === 'viewer');
  if (sup) {
    const ours = tk.filter(t => mine(t) && (t.status === 'new' || t.status === 'ours')).sort((a,b) => (a.last_inbound_at||a.opened_at||'').localeCompare(b.last_inbound_at||b.opened_at||''));
    S_.push({ id:'sup', title: isAdmin ? 'Cevap bekleyen support konuları' : 'Bana atanmış, cevap bekleyen konular', link:'#/support', rows: ours.map(tRow), empty:'Cevap bekleyen konu yok.', alert:true });
    const fol = tk.filter(t => mine(t) && t.status === 'customer' && supWait(t));
    S_.push({ id:'fol', title:'Müşteride 7+ gün · takip maili atılmalı', link:'#/support', rows: fol.map(tRow), empty:'Takip bekleyen yok.' });
  }
  if (S.unread) S_.push({ id:'not', title:'Okunmamış bildirimler', link:'#/bildirimler', count:S.unread, rows:[{ href:'#/bildirimler', main:`${S.unread} okunmamış bildirim`, sub:'', meta:'', hot:true }], alert:true });
  if (can('production','orders','admin') && prod.length) {
    const deps = myDeps(), ks = deps.length ? deps : can('production','admin') ? STG.map(x => x[0]) : ['gonderim'];
    const sq = prod.filter(d => ks.includes((curStage(d.id) || [])[0])).sort((a,b) => (due(a)||'9999').localeCompare(due(b)||'9999'));
    S_.push({ id:'stg', title: deps.length ? `Bölümümde sıradaki siparişler · ${deps.map(stgName).join(', ')}` : ks.length === 1 ? 'Gönderime hazır siparişler' : 'Üretim aşamaları', link:'#/uretim-pano',
      rows: sq.map(d => { const late = due(d) && due(d) < T; return { href:'#/kayit/' + d.id, main:`<span class="mono">${esc(refNo(d))}</span> ${esc(custName(d))}`, sub:esc(stgNow(d.id)) + (late ? ' · <span class="late-txt">gecikti</span>' : ''), meta:stgDots(d.id), hot: late && deps.length > 0 }; }),
      empty:'Sırada bekleyen sipariş yok.', alert: deps.length > 0 });
  }
  if (prodR || view) {
    const late = prod.filter(d => due(d) && due(d) < T).sort((a,b) => due(a).localeCompare(due(b)));
    S_.push({ id:'late', title:'Geciken siparişler', link:'#/kayitlar/production', rows: late.map(d => dRow(d, true)), empty:'Geciken sipariş yok.', alert:true });
    const soon = prod.filter(d => due(d) && due(d) >= T && due(d) <= in14).sort((a,b) => due(a).localeCompare(due(b)));
    S_.push({ id:'soon', title:'14 gün içinde sevk edilecekler', link:'#/kayitlar/production', rows: soon.map(d => dRow(d, false)), empty:'Önümüzdeki 14 günde sevk yok.' });
    if (can('production','admin')) { const np = prod.filter(d => !d.planned_ship_date);
      if (np.length) S_.push({ id:'np', title:'Planlanan sevk tarihi girilmemiş', link:'#/kayitlar/production', rows: np.map(d => ({ ...dRow(d, false), meta:'<span class="amber-txt">tarih girilmeli</span>' })) }); }
  }
  if (sup || can('production')) {
    const rr = R.filter(r => rmaOpen(r) && (sup || rmaAtUs(r))).sort((a,b) => (rmaLate(b) - rmaLate(a)) || (a.requested_at||'').localeCompare(b.requested_at||''));
    S_.push({ id:'rma', title: sup ? 'Açık RMA\'lar' : 'Tamir bekleyen ürünler (RMA)', link:'#/rma', rows: rr.map(rRow), empty:'Açık RMA yok.' });
  }
  if (sales || view) {
    const pipe = S.deals.filter(d => d.status === 'pipeline');
    const po = pipe.filter(d => d.expected_po_date && d.expected_po_date <= in14).sort((a,b) => a.expected_po_date.localeCompare(b.expected_po_date));
    S_.push({ id:'pipe', title:'Sipariş beklenen fırsatlar (14 gün)', link:'#/kayitlar/pipeline', rows: po.map(d => ({ href:'#/kayit/' + d.id, main:`<span class="mono">${esc(refNo(d))}</span> ${esc(custName(d))}`, sub:`${STAGES[d.stage]||''}${d.amount_usd ? ' · ' + fmtK(+d.amount_usd) : ''}`, meta: d.expected_po_date < T ? `<span class="late-txt">${fmtD(d.expected_po_date)} geçti</span>` : fmtD(d.expected_po_date), hot: d.expected_po_date < T })), empty:'Yakında sipariş beklenen fırsat yok.' });
  }
  // alımlar ve stok
  const PO = (S.purOpenList || []);
  const buyer = can('purchasing', 'admin');
  if (buyer) {
    const op = PO.filter(p => p.kind === 'alim').sort((a,b) => ((b.urgency === 'acil') - (a.urgency === 'acil')) || (a.requested_at||'').localeCompare(b.requested_at||''));
    S_.push({ id:'pur', title:'Açık alım talepleri', link:'#/alimlar', rows: op.map(p => ({ href:'#/alimlar/' + p.id, main:esc(p.item_name), sub:esc([p.project, p.requester_name].filter(Boolean).join(' · ')),
      meta: p.urgency === 'acil' ? '<span class="late-txt">● acil</span>' : `<span class="sub">${PUR_ST[p.status]}</span>`, hot: p.urgency === 'acil' })), empty:'Açık alım talebi yok.', max:5,
      foot: op.length ? `${op.filter(p => p.urgency === 'acil').length} acil · ${fmtTRY(op.reduce((a, p) => a + (+p.total || 0), 0))}` : '' });
    const kc = PO.filter(p => p.kind === 'kontrol');
    if (kc.length) S_.push({ id:'kon', title:'Kontrol edilecek konular', link:'#/alimlar', rows: kc.map(p => ({ href:'#/alimlar/' + p.id, main:esc(p.item_name), sub:'', meta:'', hot:false })) });
  } else {
    const mineP = PO.filter(p => p.created_by === me || p.requester === me);
    S_.push({ id:'myp', title:'Açık alım taleplerim', link:'#/alimlar', rows: mineP.map(p => ({ href:'#/alimlar/' + p.id, main:esc(p.item_name), sub:esc(p.project || ''), meta:`<span class="pill pu-${p.status}">${PUR_ST[p.status]}</span>`, hot:false })), empty:'Açık alım talebiniz yok.', max:5 });
  }
  if (can('stock', 'production', 'admin')) {
    const out = (S.items || []).filter(i => i.qty != null && +i.qty <= 0 && (S.prodItemIds || new Set()).has(i.id));
    S_.push({ max:5, foot: out.length ? `${out.filter(i => grpOfCat(i.category) === 'm').length} mekanik · ${out.filter(i => grpOfCat(i.category) === 'e').length} elektronik` : '', id:'out', title:'Stokta biten parçalar (ürünlerde kullanılan)', link:'#/mekanik-stok', rows: out.map(i => ({ href:'#/stok/' + i.id, main:esc(i.name), sub:esc(i.supplier_text || ''), meta:'<span class="amber-txt">stok 0</span>', hot:false })), empty:'Ürünlerde kullanılan parçalarda biten yok.' });
  }
  if (canAcc() && (S.expPendingList || []).length) S_.push({ id:'exp', title:'Onay bekleyen masraf formları', link:'#/masraf-liste', alert:true,
    rows: S.expPendingList.map(r => ({ href:'#/masraf/' + r.id, main:esc(r.user_name || ''), sub:esc(r.title), meta:`<span class="sub">${sumByCur(r.expense_items)}</span>`, hot:true })) });
  if (isAdmin) { const n = S.issues.filter(i => !i.resolved).length + liveProblemCount();
    if (n) S_.push({ id:'data', title:'Veri kontrolü', link:'#/uyarilar', rows:[{ href:'#/uyarilar', main:`${n} kayıtta eksik veya hatalı bilgi`, sub:'', meta:'', hot:false }] }); }
  return S_;
}
const todayCount = () => { try { return todaySections().reduce((n, x) => n + (x.alert ? x.rows.filter(r => r.hot).length : 0), 0); } catch { return 0; } };
function viewToday(){
  const secs = todaySections(), name = (S.profile.full_name || S.profile.email || '').split(' ')[0];
  const h = new Date().getHours(), hi = h < 12 ? 'Günaydın' : h < 18 ? 'İyi günler' : 'İyi akşamlar';
  const dstr = new Date().toLocaleDateString('tr-TR', { weekday:'long', day:'numeric', month:'long' });
  const hotOf = x => x.alert ? (x.count ?? x.rows.filter(r => r.hot).length) : 0;
  const hotN = secs.reduce((n, x) => n + hotOf(x), 0);
  const panel = x => { const hot = hotOf(x), MAX = x.max || 6, n = x.count ?? x.rows.length;
    return `<section class="panel tday${hot ? ' is-hot' : ''}${x.rows.length ? '' : ' is-empty'}"><header><h2>${x.title}</h2><span class="tcount${hot ? ' hot' : ''}">${n}</span><a class="more" href="${x.link}">Tümü →</a></header>
      ${x.foot ? `<p class="tfoot-note">${x.foot}</p>` : ''}
      ${x.rows.length ? `<ul class="tlist">${x.rows.slice(0, MAX).map(r => `<li><a href="${r.href}"><span class="tm">${r.main}${r.sub ? `<span class="sub">${r.sub}</span>` : ''}</span><span class="tmeta">${r.meta}</span></a></li>`).join('')}</ul>${x.rows.length > MAX ? `<a class="tmore" href="${x.link}">+${x.rows.length - MAX} tane daha</a>` : ''}` : `<p class="tok">✓ ${x.empty}</p>`}</section>`; };
  shell('bugun', `<div class="pagehead"><div><h1>${hi}, ${esc(name)}</h1><p class="lede">${dstr} · ${esc(roleLabel(S.profile))} görünümü · ${hotN ? `<b class="late-txt">${hotN} iş dikkat istiyor</b>` : 'Acil bekleyen iş yok'}</p></div></div>
    ${countBanner()}
    <div class="tgrid">${secs.filter(x => x.rows.length).map(panel).join('')}</div>
    ${secs.some(x => !x.rows.length) ? `<div class="tclear">${secs.filter(x => !x.rows.length).map(x => `<span>✓ ${x.empty}</span>`).join('')}</div>` : ''}`);
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
      ${tab==='shipped'?'<th class="nosort">Sevk</th>':''}${tab==='pipeline'||tab==='production'?'<th class="nosort">Aşama</th>':''}
      <th data-s="amt" class="num">Tutar ${ar('amt')}</th></tr></thead><tbody>
      ${rows.map(d => { const lt = d.status==='production' && d.requested_ship_date && d.requested_ship_date < T;
        return `<tr data-id="${d.id}"><td class="mono">${esc(refNo(d))}${d.order_no&&d.opp_no?`<div class="sub">${esc(d.opp_no)}</div>`:''}</td>
        <td>${esc(custName(d))}<div class="sub">${esc(ctryName(d.country))}</div></td>
        <td>${esc(d.description)}<div class="items">${Object.entries(d.items||{}).map(([c,q])=>`<span>${fmtN(q)}× ${esc(prodName(c))}</span>`).join('')}</div></td>
        ${tab==='all'?`<td>${pill(d.status)}</td>`:''}
        <td>${fmtD(d.order_date || d.lead_date)}</td><td class="${lt?'late-txt':''}">${fmtD(d.requested_ship_date)}${lt?`<div class="sub late-txt">${days(d.requested_ship_date,T)} gün gecikti</div>`:''}</td>
        ${tab==='shipped'?`<td>${fmtShip(d)}</td>`:''}${tab==='pipeline'?`<td>${STAGES[d.stage]}</td>`:''}${tab==='production'?`<td style="white-space:nowrap">${stgDots(d.id)}<div class="sub">${esc(stgNow(d.id))}</div></td>`:''}
        <td class="num">${fmtUSD(d.amount_usd)}${d.currency!=='USD'&&d.amount_orig?`<div class="sub">${fmtN(d.amount_orig)} ${d.currency}</div>`:''}</td></tr>`; }).join('')}
      <tr class="tfoot"><td colspan="${tab==='all'||tab==='shipped'||tab==='pipeline'||tab==='production'?6:5}">${rows.length} kayıt${s.year||s.month?` · ${BASES[s.basis][0].toLocaleLowerCase('tr')}: ${s.month?MONTHS_LONG[s.month-1]+' ':''}${s.year||'tüm yıllar'}`:''}</td><td class="num">${fmtUSD(total)}</td></tr>
      </tbody></table>` : `<div class="empty">Bu filtrelerle kayıt yok.${can('sales','orders','admin')?' <a href="#/yeni">Yeni kayıt ekle</a>':''}</div>`;
    qa('#tbl th[data-s]').forEach(th => th.onclick = () => { const k = th.dataset.s; if (s.sort===k) s.dir*=-1; else { s.sort=k; s.dir = k==='cust'||k==='ref'||k==='due' ? 1 : -1; } draw(); });
    qa('#tbl tr[data-id]').forEach(tr => tr.onclick = () => location.hash = '#/kayit/' + tr.dataset.id);
    q('#csv').onclick = () => csv(rows, `acrome-${tab}-${T}.csv`);
  };
  if (tab === 'production' && listState.sort === 'date') { listState.sort = 'due'; listState.dir = 1; }
  shell('kayitlar/' + tab, `<div class="pagehead"><div><h1>${{production:'Üretimdeki siparişler',pipeline:'Açık fırsatlar',shipped:'Gönderilen siparişler',lost:'Kaybedilen fırsatlar',archived:'Arşiv',all:'Tüm kayıtlar'}[tab]}</h1>
    <p class="lede">${tab==='archived'?'Excel\'in eski yıllarında kalan ve 2026 listesine taşınmamış fırsatlar.':'Satıra tıklayınca kaydın detayı açılır.'}</p></div>
    <div style="display:flex;gap:8px"><button class="btn" id="csv">CSV indir</button>${can('sales','orders','admin')?'<a class="btn primary" href="#/yeni">Yeni kayıt</a>':''}</div></div>
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
  const canShip = can('production','sales','orders','admin');

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
    ${can('sales','orders','admin') && d.status==='pipeline' ? `<a class="btn primary" href="#/duzenle/${d.id}?siparis">Siparişe çevir</a>`:''}
    ${can('production') && d.status==='production' ? `<a class="btn primary" href="#/duzenle/${d.id}">Sevk bilgisi gir</a>`:''}
    ${can('sales','orders','admin','production') ? `<a class="btn" href="#/duzenle/${d.id}">Düzenle</a>`:''}
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
  ${stagePanel(d)}
  ${rmaBox({ deal_id:d.id }, (S.rmas||[]).filter(x => x.deal_id === d.id), 'mt')}
  ${(S.tickets||[]).some(x => x.deal_id === d.id) ? `<section class="panel mt"><h2>Support konuları</h2><ul class="sugg">${S.tickets.filter(x => x.deal_id === d.id).map(x => `<li><a href="#/support/${x.id}"><span class="mono">#${x.id}</span> ${esc(x.subject)}</a> ${supPill(x.status)} <span class="sub">${fmtD(x.opened_at.slice(0,10))}</span></li>`).join('')}</ul></section>` : ''}
  <section class="panel mt"><h2>Açıklama ve notlar</h2><dl class="kv">${kv('Detay', esc(d.details))}${kv('Not', esc(d.notes))}${kv('Kaynak', esc(d.source))}${kv('Son güncelleme', new Date(d.updated_at).toLocaleString('tr-TR'))}</dl></section>`);
  bindStagePanel(d);
  const del = q('#del');
  if (del) del.onclick = async () => {
    if (del.dataset.c !== '1') { del.dataset.c = '1'; del.textContent = 'Silmeyi onayla'; return; }
    const { error } = await sb.from('deals').delete().eq('id', id);
    if (error) return toast(dbErr(error), true);
    S.deals = S.deals.filter(x => x.id !== id); toast('Kayıt silindi'); location.hash = '#/kayitlar/' + d.status;
  };
}

// ---------------------------------------------------------------- ÜRETİM AŞAMALARI (sipariş başına)
// Mekanik montaj → Elektronik → Yazılım / test → Paketleme → Gönderim. Her bölüm kendi aşamasını günceller
// (Kullanıcılar sayfasında kişiye bölüm atanır; bölümü boş olan Üretim rolü tüm aşamaları günceller).
const STG = [['mekanik','Mekanik montaj','Mekanik'], ['elektronik','Elektronik','Elektronik'], ['yazilim','Yazılım / test','Yazılım'], ['paketleme','Paketleme','Paketleme'], ['gonderim','Gönderim','Gönderim']];
const STG_ST = { bekliyor:'Bekliyor', devam:'Devam ediyor', bitti:'Bitti', gerekmiyor:'Gerekmiyor' };
const stgName = k => (STG.find(s => s[0] === k) || [k, k])[1];
const stOf = (id, k) => (S.stages || []).find(s => s.deal_id === id && s.stage === k) || { deal_id:id, stage:k, status:'bekliyor' };
const stgDone = s => s.status === 'bitti' || s.status === 'gerekmiyor';
const curStage = id => STG.find(([k]) => !stgDone(stOf(id, k)));
const myDeps = () => (S.profile && S.profile.departments) || [];
const canStg = k => can('admin') || (k === 'gonderim' && can('orders')) || (can('production') && (!myDeps().length || myDeps().includes(k)));
const stgPill = st => `<span class="pill sg-${st}">${STG_ST[st]}</span>`;
const stgDots = id => `<span class="sgdots" title="${STG.map(([k, n]) => n + ': ' + STG_ST[stOf(id, k).status]).join(' · ')}">${STG.map(([k]) => `<i class="sg-${stOf(id, k).status}"></i>`).join('')}</span>`;
const stgNow = id => { const c = curStage(id); if (!c) return 'Tamamlandı'; const s = stOf(id, c[0]); return c[1] + (s.status === 'devam' ? ' · devam ediyor' : ''); };
async function loadStages(){ const { data, error } = await sb.from('deal_stages').select('*'); S.stages = error ? [] : data || []; }
async function setStage(d, k, status, note, ship){
  const { data, error } = await sb.rpc('deal_stage_set', { p_deal:d.id, p_stage:k, p_status:status, p_note:note ?? null, p_ship_date:ship || null });
  if (error) { toast(dbErr(error), true); return false; }
  S.stages = (S.stages || []).filter(s => !(s.deal_id === d.id && s.stage === k)).concat(data ? [data] : []);
  if (k === 'gonderim' && status === 'bitti') { d.status = 'shipped'; d.ship_date = ship; toast(`${refNo(d)} gönderildi olarak kaydedildi`); }
  else toast(`${refNo(d)} · ${stgName(k)}: ${STG_ST[status]}`);
  return true;
}
// aşama satırındaki butonlar (detay sayfası ve pano kartı ortak)
function stgActions(d, k, compact){
  if (d.status !== 'production' || !canStg(k)) return '';
  const s = stOf(d.id, k), b = (st, t, cls = '') => `<button class="btn sm ${cls}" data-sg="${k}" data-to="${st}" type="button">${t}</button>`;
  if (k === 'gonderim' && s.status !== 'bitti') return `<span class="sgship"><input type="date" data-sd="${k}" value="${today()}" max="${today()}" min="${d.order_date || MIN_DATE}" aria-label="Sevk tarihi"> ${b('bitti', 'Gönderildi', 'primary')}</span>`;
  if (s.status === 'bekliyor') return b('devam', 'Başladı') + b('bitti', 'Bitti', 'primary') + (compact ? '' : b('gerekmiyor', 'Gerekmiyor'));
  if (s.status === 'devam') return b('bitti', 'Bitti', 'primary') + (compact ? '' : b('bekliyor', 'Bekliyor\'a al'));
  return compact ? '' : b(s.status === 'bitti' ? 'devam' : 'bekliyor', 'Geri al');
}
function bindStgActions(root, d, after){
  qa('[data-sg]', root).forEach(btn => btn.onclick = async e => {
    e.preventDefault(); e.stopPropagation();
    const k = btn.dataset.sg, to = btn.dataset.to, wrap = btn.closest('[data-stgrow]') || root;
    const noteEl = q(`[data-sn="${k}"]`, wrap), ship = (q(`[data-sd="${k}"]`, wrap) || {}).value;
    if (k === 'gonderim' && to === 'bitti' && !ship) return toast('Sevk tarihini seç', true);
    btn.disabled = true;
    if (await setStage(d, k, to, noteEl ? noteEl.value : null, ship)) after(); else btn.disabled = false;
  });
  qa('[data-sns]', root).forEach(btn => btn.onclick = async () => { const k = btn.dataset.sns, s = stOf(d.id, k), el = q(`[data-sn="${k}"]`, root);
    if (await setStage(d, k, s.status, el.value)) after(); });
}
const ago2 = t => t ? new Date(t).toLocaleString('tr-TR', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : '';
function stagePanel(d){
  if (d.status !== 'production' && !(S.stages || []).some(s => s.deal_id === d.id)) return '';
  const c = curStage(d.id);
  return `<section class="panel mt" id="stgp"><h2>Üretim aşamaları <span class="sub" style="font-weight:400">· ${d.status === 'production' ? 'şu an: <b>' + esc(stgNow(d.id)) + '</b>' : esc(STATUSES[d.status])}</span></h2>
    <ol class="stglist">${STG.map(([k, n], i) => { const s = stOf(d.id, k), edit = d.status === 'production' && canStg(k);
      return `<li class="stgrow${c && c[0] === k ? ' cur' : ''}" data-stgrow="${k}"><span class="sgn sg-${s.status}">${stgDone(s) ? '✓' : i + 1}</span>
        <div class="stgmain"><div class="stghead"><b>${n}</b> ${stgPill(s.status)} ${s.updated_by_name ? `<span class="sub">${esc(s.updated_by_name)} · ${ago2(s.updated_at)}</span>` : ''}</div>
          ${edit && (!stgDone(s) || s.note) ? `<div class="stgnote"><input type="text" data-sn="${k}" value="${esc(s.note || '')}" placeholder="Not (isteğe bağlı): eksik parça, bekleyen iş…" maxlength="300" aria-label="${n} notu"><button class="btn sm" data-sns="${k}" type="button" title="Yalnız notu kaydet">Notu kaydet</button></div>`
            : s.note ? `<div class="sub">${esc(s.note)}</div>` : ''}</div>
        <div class="stgact">${stgActions(d, k, false)}</div></li>`; }).join('')}</ol>
    ${d.status === 'production' && !STG.some(([k]) => canStg(k)) ? '<p class="note">Aşamaları her bölüm kendisi günceller; sizin rolünüzde aşama güncelleme yetkisi yok.</p>' : ''}
    <details class="mt" id="stgh"><summary>Aşama geçmişi</summary><div class="sub" id="stghb">Yükleniyor…</div></details></section>`;
}
function bindStagePanel(d){
  const p = q('#stgp'); if (!p) return;
  bindStgActions(p, d, () => viewDetail(d.id));
  q('#stgh').addEventListener('toggle', async e => { if (!e.target.open || e.target.dataset.l) return; e.target.dataset.l = 1;
    const { data } = await sb.from('deal_stage_events').select('*').eq('deal_id', d.id).order('at', { ascending:false }).limit(50);
    q('#stghb').innerHTML = (data || []).length ? `<ul class="stgev">${data.map(x => `<li><span class="sub">${ago2(x.at)}</span> <b>${esc(x.actor_name || '')}</b> · ${esc(stgName(x.stage))}: ${esc(STG_ST[x.old_status] || x.old_status || '')} → <b>${esc(STG_ST[x.new_status] || x.new_status)}</b>${x.note ? ` · <i>${esc(x.note)}</i>` : ''}</li>`).join('')}</ul>` : 'Henüz değişiklik yok.'; });
}

// Üretim panosu: üretimdeki siparişler, şu an bulundukları aşamaya göre sütunlarda
const boardState = { mine:false };
async function viewBoard(){
  await loadStages();
  const T = today(), due = d => d.planned_ship_date || d.requested_ship_date;
  const deps = myDeps(), st = boardState;
  const prod = S.deals.filter(d => d.status === 'production').sort((a, b) => (due(a) || '9999').localeCompare(due(b) || '9999'));
  const cols = STG.map(([k, n]) => [k, n, prod.filter(d => (curStage(d.id) || [])[0] === k)]);
  const show = cols.filter(([k]) => !st.mine || !deps.length || deps.includes(k));
  const card = (d, k) => { const s = stOf(d.id, k), late = due(d) && due(d) < T;
    return `<article class="bcard${late ? ' late' : ''}" data-stgrow="${k}" data-bid="${d.id}"><a href="#/kayit/${d.id}" class="bc-top"><span class="mono">${esc(refNo(d))}</span> ${stgDots(d.id)}</a>
      <div class="bc-cust">${esc(custName(d))}</div>
      <div class="items">${Object.entries(d.items || {}).map(([c, qn]) => `<span>${fmtN(qn)}× ${esc(prodName(c))}</span>`).join('') || `<span>${esc(d.description || '')}</span>`}</div>
      <div class="bc-meta">${due(d) ? `<span class="${late ? 'late-txt' : ''}">${late ? days(due(d), T) + ' gün gecikti' : 'Sevk ' + fmtD(due(d))}</span>` : '<span class="sub">sevk tarihi yok</span>'}
        ${s.status === 'devam' ? `<span class="amber-txt">● devam · ${esc((s.updated_by_name || '').split(' ')[0])}</span>` : ''}</div>
      ${s.note ? `<div class="bc-note">${esc(s.note)}</div>` : ''}
      <div class="bc-act">${stgActions(d, k, true)}</div></article>`; };
  shell('uretim-pano', `<div class="pagehead"><div><h1>Üretim panosu</h1><p class="lede">Üretimdeki ${prod.length} sipariş, şu an bulundukları aşamaya göre. Her bölüm kendi sütunundaki siparişi ilerletir; "Bitti" deyince sipariş bir sonraki bölüme geçer. Sıralama: sevk tarihi en yakın üstte.</p></div></div>
    ${deps.length ? `<div class="toolbar"><div class="seg"><button data-bm="0" class="${st.mine ? '' : 'on'}">Tüm aşamalar</button><button data-bm="1" class="${st.mine ? 'on' : ''}">Benim bölümüm (${deps.map(stgName).join(', ')})</button></div></div>` : ''}
    <div class="pboard" style="--bcols:${show.length}">${show.map(([k, n, ds]) => `<section class="bcol${deps.includes(k) ? ' mine' : ''}"><header><h2>${n}</h2><span class="tcount">${ds.length}</span></header>
      ${ds.length ? ds.map(d => card(d, k)).join('') : '<p class="tok">✓ Bu aşamada bekleyen sipariş yok.</p>'}</section>`).join('')}</div>`);
  qa('[data-bm]').forEach(b => b.onclick = () => { st.mine = b.dataset.bm === '1'; viewBoard(); });
  qa('.bcard').forEach(el => { const d = S.deals.find(x => x.id === +el.dataset.bid); bindStgActions(el, d, () => viewBoard()); });
}

// ---------------------------------------------------------------- MASRAF FORMU
// Herkes kendi harcamalarını fiş/fatura görseliyle gönderir; formların hepsini Muhasebe ve Yönetici görür, onaylar, ödendi işaretler.
const EXP_CAT = ['Yemek', 'Ulaşım (taksi, toplu taşıma)', 'Yakıt / otopark / otoyol', 'Konaklama', 'Uçak / tren / otobüs bileti', 'Kargo / posta', 'Malzeme / ofis', 'Temsil / ağırlama', 'Diğer'];
const EXP_ST = { gonderildi:'Onay bekliyor', onaylandi:'Onaylandı', reddedildi:'Reddedildi', odendi:'Ödendi' };
const EXP_CUR = ['TRY', 'USD', 'EUR', 'GBP'];
const canAcc = () => can('muhasebe', 'admin');
const expPill = s => `<span class="pill ex-${s}">${EXP_ST[s] || s}</span>`;
const sumByCur = items => { const m = {}; (items || []).forEach(i => m[i.currency] = (m[i.currency] || 0) + +i.amount); return Object.entries(m).map(([c, v]) => fmtMoney(v, c)).join(' + ') || '—'; };
async function loadExpPending(){
  if (!canAcc()) { S.expPending = 0; S.expPendingList = []; return; }
  const { data } = await sb.from('expense_reports').select('id,title,user_name,created_at,expense_items(amount,currency)').eq('status', 'gonderildi').order('created_at').limit(50);
  S.expPendingList = data || []; S.expPending = S.expPendingList.length;
}
// telefondan çekilen büyük fotoğrafları yüklemeden önce küçült (≈1800 px, JPEG)
async function shrinkReceipt(file){
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400e3 || typeof createImageBitmap !== 'function') return file;
  try { const img = await createImageBitmap(file), k = Math.min(1, 1800 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
    return b && b.size < file.size ? new File([b], file.name.replace(/\.\w+$/, '') + '.jpg', { type:'image/jpeg' }) : file; } catch { return file; }
}
const expItemHtml = i => `<div class="exitem" data-i="${i}">
  <label class="f">Tarih<input type="date" name="day" value="${today()}" max="${today()}" min="${MIN_DATE}" required></label>
  <label class="f">Tür<select name="category">${EXP_CAT.map(c => `<option>${c}</option>`).join('')}</select></label>
  <label class="f exdesc">Açıklama<input name="description" required maxlength="500" placeholder="Ne için? ör. müşteri ziyareti taksi"></label>
  <label class="f">Tutar<span class="examt"><input name="amount" type="number" step="0.01" min="0.01" required inputmode="decimal"><select name="currency" aria-label="Para birimi">${EXP_CUR.map(c => `<option>${c}</option>`).join('')}</select></span></label>
  <label class="f">Proje / sipariş<input name="project" maxlength="120" placeholder="isteğe bağlı"></label>
  <label class="f">Fiş / fatura (foto veya PDF)<input name="file" type="file" accept="image/*,application/pdf"></label>
  <button type="button" class="btn sm exdel" title="Bu kalemi sil" aria-label="Bu kalemi sil">Kalemi sil</button></div>`;
async function viewExpense(){
  const me = S.profile.id;
  shell('masraf', `<div class="empty">Yükleniyor…</div>`);
  const { data } = await sb.from('expense_reports').select('*,expense_items(amount,currency)').eq('user_id', me).order('created_at', { ascending:false }).limit(50);
  const mine = data || [], ay = new Date().toLocaleDateString('tr-TR', { month:'long', year:'numeric' });
  shell('masraf', `<div class="pagehead"><div><h1>Masraf formu</h1><p class="lede">Şirket için kendi cebinden yaptığın harcamaları muhasebeye ilet. Her kalem için fişin/faturanın fotoğrafını ekle; telefondan doğrudan fotoğraf çekebilirsin. Formu yalnızca sen, Muhasebe ve yöneticiler görür.</p></div>${canAcc() ? '<a class="btn" href="#/masraf-liste">Tüm masraf formları</a>' : ''}</div>
    <form id="exf" class="panel" novalidate><h2>Yeni form</h2>
      <div class="grid g2"><label class="f">Form başlığı<input name="title" required maxlength="200" value="${esc(ay)} masrafları"></label>
        <label class="f">Not<input name="note" maxlength="2000" placeholder="isteğe bağlı, muhasebeye"></label></div>
      <p class="note" style="margin:0 0 4px">Gönderen: <b>${esc(S.profile.full_name || S.profile.email)}</b> — muhasebe formu bu adla görür.</p>
      <div id="exitems">${expItemHtml(0)}</div>
      <p style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button type="button" class="btn" id="exadd">+ Kalem ekle</button><span class="sub" id="extot"></span></p>
      <div class="err-box" id="exerr"></div>
      <button class="btn primary" type="submit" id="exsend">Muhasebeye gönder</button></form>
    <section class="mt"><h2>Gönderdiğim formlar</h2><div class="tablewrap">${mine.length ? `<table><thead><tr><th class="nosort">Tarih</th><th class="nosort">Başlık</th><th class="nosort num">Tutar</th><th class="nosort">Durum</th></tr></thead><tbody>
      ${mine.map(r => `<tr data-ex="${r.id}"><td style="white-space:nowrap">${fmtD(r.created_at.slice(0, 10))}</td><td>${esc(r.title)}<div class="sub">${(r.expense_items || []).length} kalem${r.review_note ? ' · ' + esc(r.review_note) : ''}</div></td><td class="num">${sumByCur(r.expense_items)}</td><td>${expPill(r.status)}${r.paid_at ? `<div class="sub">${fmtD(r.paid_at)}</div>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Henüz form göndermedin.</div>'}</div></section>`);
  const box = q('#exitems'); let n = 1;
  const tot = () => { const its = qa('.exitem', box).map(el => ({ amount:+q('[name=amount]', el).value || 0, currency:q('[name=currency]', el).value })).filter(x => x.amount > 0); q('#extot').textContent = its.length ? 'Toplam: ' + sumByCur(its) : ''; };
  const bind = () => { qa('.exdel', box).forEach(b => b.onclick = () => { if (qa('.exitem', box).length > 1) { b.closest('.exitem').remove(); tot(); } else toast('En az bir kalem olmalı', true); });
    qa('[name=amount],[name=currency]', box).forEach(x => x.oninput = tot); };
  bind();
  q('#exadd').onclick = () => { box.insertAdjacentHTML('beforeend', expItemHtml(n++)); bind(); q('.exitem:last-child [name=description]', box).focus(); };
  qa('tr[data-ex]').forEach(tr => tr.onclick = () => location.hash = '#/masraf/' + tr.dataset.ex);
  q('#exf').onsubmit = async e => {
    e.preventDefault(); const err = q('#exerr'), btn = q('#exsend'); err.textContent = '';
    const f = new FormData(e.target), title = String(f.get('title') || '').trim();
    if (!title) { err.textContent = 'Form başlığı gir.'; return; }
    const els = qa('.exitem', box), items = [];
    for (const [k, el] of els.entries()) {
      const v = nm => q(`[name=${nm}]`, el).value.trim(), file = q('[name=file]', el).files[0];
      if (!v('day') || v('day') > today()) { err.textContent = `${k + 1}. kalem: geçerli bir tarih gir.`; return; }
      if (!v('description')) { err.textContent = `${k + 1}. kalem: açıklama yaz.`; return; }
      if (!(+v('amount') > 0)) { err.textContent = `${k + 1}. kalem: tutarı gir.`; return; }
      if (file && file.size > 15e6) { err.textContent = `${k + 1}. kalem: dosya çok büyük (en fazla 15 MB).`; return; }
      items.push({ day:v('day'), category:v('category'), description:v('description'), amount:+v('amount'), currency:v('currency'), project:v('project'), file });
    }
    if (!items.some(x => x.file) && !confirm('Hiçbir kaleme fiş/fatura eklemedin. Yine de gönderilsin mi?')) return;
    btn.disabled = true; btn.textContent = 'Gönderiliyor…';
    try {
      for (const [k, it] of items.entries()) {
        if (!it.file) continue;
        const fl = await shrinkReceipt(it.file), safe = fl.name.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80);
        const path = `${me}/${Date.now()}-${k}-${safe}`;
        const { error } = await sb.storage.from('masraf').upload(path, fl, { contentType:fl.type || 'application/octet-stream', upsert:false });
        if (error) throw new Error(`${k + 1}. kalemin dosyası yüklenemedi: ${error.message}`);
        it.receipt_path = path; it.receipt_name = it.file.name;
      }
      const { data: id, error } = await sb.rpc('expense_submit', { p:{ title, note:String(f.get('note') || ''), items:items.map(({ file, ...x }) => x) } });
      if (error) throw error;
      toast('Masraf formu muhasebeye gönderildi'); location.hash = '#/masraf/' + id;
    } catch (x) { err.textContent = dbErr(x); btn.disabled = false; btn.textContent = 'Muhasebeye gönder'; }
  };
}
async function openReceipt(path){
  const w = window.open('', '_blank');
  const { data, error } = await sb.storage.from('masraf').createSignedUrl(path, 300);
  if (error || !data) { w && w.close(); return toast('Dosya açılamadı: ' + (error ? error.message : ''), true); }
  if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
}
async function viewExpenseDetail(id){
  shell(canAcc() ? 'masraf-liste' : 'masraf', `<div class="empty">Yükleniyor…</div>`);
  const { data: r } = await sb.from('expense_reports').select('*,expense_items(*)').eq('id', id).maybeSingle();
  if (!r) return shell('masraf', `<h1>Form bulunamadı</h1><p><a href="#/masraf">Masraf formuna dön</a></p>`);
  const its = (r.expense_items || []).sort((a, b) => a.day.localeCompare(b.day) || a.id - b.id), own = r.user_id === S.profile.id, acc = canAcc();
  const act = st => `<button class="btn ${st === 'onaylandi' || st === 'odendi' ? 'primary' : st === 'reddedildi' ? 'danger' : ''}" data-ex="${st}">${{ onaylandi:'Onayla', reddedildi:'Reddet', odendi:'Ödendi olarak işaretle', gonderildi:'Onay bekliyor\'a geri al' }[st]}</button>`;
  shell(acc ? 'masraf-liste' : 'masraf', `<p><a href="${acc ? '#/masraf-liste' : '#/masraf'}">← ${acc ? 'Masraf formları' : 'Masraf formum'}</a></p>
    <div class="pagehead"><div><h1>${esc(r.title)}</h1><p class="lede">${esc(r.user_name || '')} · ${fmtDT(r.created_at)} · ${its.length} kalem · <b>${sumByCur(its)}</b></p></div><div>${expPill(r.status)}</div></div>
    ${r.note ? `<div class="banner" style="background:var(--soft)"><b>Not:</b> ${esc(r.note)}</div>` : ''}
    ${r.reviewed_by_name ? `<p class="note">${esc(EXP_ST[r.status])}: ${esc(r.reviewed_by_name)} · ${fmtDT(r.reviewed_at)}${r.paid_at ? ' · ödeme ' + fmtD(r.paid_at) : ''}${r.review_note ? ` — <i>${esc(r.review_note)}</i>` : ''}</p>` : ''}
    <div class="tablewrap"><table><thead><tr><th class="nosort">Tarih</th><th class="nosort">Tür</th><th class="nosort">Açıklama</th><th class="nosort">Proje</th><th class="nosort num">Tutar</th><th class="nosort">Fiş</th></tr></thead><tbody>
      ${its.map(i => `<tr style="cursor:default"><td style="white-space:nowrap">${fmtD(i.day)}</td><td>${esc(i.category)}</td><td>${esc(i.description)}</td><td>${esc(i.project || '')}</td><td class="num" style="white-space:nowrap">${fmtMoney(i.amount, i.currency)}</td><td>${i.receipt_path ? `<button class="btn sm" data-rc="${esc(i.receipt_path)}" title="${esc(i.receipt_name || '')}">Aç</button>` : '<span class="amber-txt">yok</span>'}</td></tr>`).join('')}
      <tr class="tfoot"><td colspan="4">Toplam</td><td class="num">${sumByCur(its)}</td><td></td></tr></tbody></table></div>
    ${acc ? `<section class="panel mt"><h2>Muhasebe</h2><div class="grid g2"><label class="f">Not <span class="hint">reddederken zorunlu; gönderen görür</span><input id="exnote" maxlength="500" value="${esc(r.review_note || '')}"></label>
      ${r.status === 'onaylandi' ? `<label class="f">Ödeme tarihi<input type="date" id="expaid" value="${today()}" max="${today()}"></label>` : ''}</div>
      <p style="display:flex;gap:8px;flex-wrap:wrap">${(r.status === 'gonderildi' ? ['onaylandi', 'reddedildi'] : r.status === 'onaylandi' ? ['odendi', 'gonderildi'] : ['gonderildi']).map(act).join('')}</p></section>` : ''}
    ${own && r.status === 'gonderildi' ? `<p class="mt"><button class="btn danger" id="exrm">Formu geri çek (sil)</button> <span class="sub">Muhasebe incelemeden önce geri çekebilirsin.</span></p>` : ''}`);
  qa('[data-rc]').forEach(b => b.onclick = () => openReceipt(b.dataset.rc));
  qa('[data-ex]').forEach(b => b.onclick = async () => {
    const st = b.dataset.ex, note = (q('#exnote') || {}).value || '';
    if (st === 'reddedildi' && !note.trim()) return toast('Reddetme nedenini Not alanına yaz', true);
    b.disabled = true;
    const { error } = await sb.rpc('expense_review', { p_id:id, p_status:st, p_note:note, p_paid:(q('#expaid') || {}).value || null });
    if (error) { b.disabled = false; return toast(dbErr(error), true); }
    toast('Form: ' + EXP_ST[st]); await loadExpPending(); viewExpenseDetail(id);
  });
  q('#exrm') && (q('#exrm').onclick = async e => {
    if (!e.target.dataset.ok) { e.target.dataset.ok = 1; e.target.textContent = 'Emin misin? Tekrar bas'; return; }
    const paths = its.map(i => i.receipt_path).filter(Boolean);
    const { error } = await sb.from('expense_reports').delete().eq('id', id);
    if (error) return toast(dbErr(error), true);
    if (paths.length) await sb.storage.from('masraf').remove(paths);
    toast('Form geri çekildi'); location.hash = '#/masraf';
  });
}
const expState = { st:'gonderildi', month:'', person:'' };
async function viewExpenseList(){
  shell('masraf-liste', `<div class="empty">Yükleniyor…</div>`);
  const { data } = await sb.from('expense_reports').select('*,expense_items(*)').order('created_at', { ascending:false }).limit(1000);
  const all = data || [], st = expState;
  const months = [...new Set(all.map(r => r.created_at.slice(0, 7)))].sort().reverse(), people = [...new Set(all.map(r => r.user_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  const rows = all.filter(r => (!st.st || r.status === st.st) && (!st.month || r.created_at.startsWith(st.month)) && (!st.person || r.user_name === st.person));
  const items = rows.flatMap(r => (r.expense_items || []).map(i => ({ ...i, r })));
  const pend = all.filter(r => r.status === 'gonderildi'), appr = all.filter(r => r.status === 'onaylandi');
  const tabs = { gonderildi:'Onay bekleyen', onaylandi:'Onaylanan (ödenecek)', odendi:'Ödenen', reddedildi:'Reddedilen', '':'Tümü' };
  const mName = m => new Date(m + '-01T00:00:00').toLocaleDateString('tr-TR', { month:'long', year:'numeric' });
  shell('masraf-liste', `<div class="pagehead"><div><h1>Masraf formları</h1><p class="lede">Personelin gönderdiği masraf formları. Satıra tıklayınca kalemler ve fişler açılır; onay, ret ve ödeme oradan işaretlenir.</p></div><button class="btn" id="excsv">CSV indir (kalemler)</button></div>
    <div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      <div class="kpi"><div class="v">${pend.length}</div><div class="l">Onay bekleyen form</div><div class="d">${sumByCur(pend.flatMap(r => r.expense_items))}</div></div>
      <div class="kpi"><div class="v">${appr.length}</div><div class="l">Onaylı, ödenecek</div><div class="d">${sumByCur(appr.flatMap(r => r.expense_items))}</div></div>
      <div class="kpi"><div class="v">${rows.length}</div><div class="l">Listelenen form</div><div class="d">${sumByCur(items)}</div></div></div>
    <div class="toolbar"><div class="seg">${Object.entries(tabs).map(([k, v]) => `<button data-xs="${k}" class="${st.st === k ? 'on' : ''}">${v}</button>`).join('')}</div></div>
    <div class="toolbar"><select id="xm" aria-label="Ay"><option value="">Tüm aylar</option>${months.map(m => `<option value="${m}" ${st.month === m ? 'selected' : ''}>${mName(m)}</option>`).join('')}</select>
      <select id="xp" aria-label="Kişi"><option value="">Tüm kişiler</option>${people.map(p => `<option ${st.person === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div>
    <div class="tablewrap">${rows.length ? `<table><thead><tr><th class="nosort">Tarih</th><th class="nosort">Kişi</th><th class="nosort">Başlık</th><th class="nosort num">Tutar</th><th class="nosort">Fiş</th><th class="nosort">Durum</th></tr></thead><tbody>
      ${rows.map(r => { const its = r.expense_items || [], miss = its.filter(i => !i.receipt_path).length;
        return `<tr data-ex="${r.id}"><td style="white-space:nowrap">${fmtD(r.created_at.slice(0, 10))}</td><td>${esc(r.user_name || '')}</td><td>${esc(r.title)}<div class="sub">${its.length} kalem</div></td><td class="num" style="white-space:nowrap">${sumByCur(its)}</td><td>${miss ? `<span class="amber-txt">${miss} eksik</span>` : '<span class="sub">tam</span>'}</td><td>${expPill(r.status)}${r.paid_at ? `<div class="sub">${fmtD(r.paid_at)}</div>` : ''}</td></tr>`; }).join('')}
      </tbody></table>` : '<div class="empty">Bu filtrelerle form yok.</div>'}</div>`);
  qa('[data-xs]').forEach(b => b.onclick = () => { st.st = b.dataset.xs; viewExpenseList(); });
  q('#xm').onchange = e => { st.month = e.target.value; viewExpenseList(); };
  q('#xp').onchange = e => { st.person = e.target.value; viewExpenseList(); };
  qa('tr[data-ex]').forEach(tr => tr.onclick = () => location.hash = '#/masraf/' + tr.dataset.ex);
  q('#excsv').onclick = () => {
    const head = ['Form no', 'Gönderim', 'Kişi', 'Form', 'Durum', 'Masraf tarihi', 'Tür', 'Açıklama', 'Proje', 'Tutar', 'Para birimi', 'Fiş', 'Ödeme tarihi'];
    const lines = [head, ...items.map(i => [i.r.id, i.r.created_at.slice(0, 10), i.r.user_name || '', i.r.title, EXP_ST[i.r.status], i.day, i.category, i.description, i.project || '', String(i.amount).replace('.', ','), i.currency, i.receipt_path ? 'var' : 'yok', i.r.paid_at || ''])]
      .map(x => x.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines], { type:'text/csv;charset=utf-8' })); a.download = `masraflar-${st.month || 'tum'}.csv`; a.click();
  };
}

// ---------------------------------------------------------------- ROL ÖNİZLEME (yalnız yönetici)
function viewRolePreview(){
  const pv = getPreview() || { roles:[], departments:[] }, R = Object.keys(ROLE_INFO).filter(k => k !== 'pending');
  shell('rol-onizleme', `<div class="pagehead"><div><h1>Rol önizleme</h1><p class="lede">Rolleri seç, siteyi o rollerdeki bir kişi nasıl görüyorsa öyle gör: menü, Bugün sayfası, butonlar ve düzenleme alanları seçilen rollere göre değişir. Yalnız arayüz değişir; veriler yönetici yetkinle okunur ve yaptığın kayıtlar gerçek olarak kaydedilir. Bu sayfa geliştirme sırasında kontrol içindir.</p></div></div>
    <section class="panel"><h2>Roller</h2><div class="rolechk">${R.map(k => `<label class="chk"><input type="checkbox" data-pr="${k}" ${pv.roles.includes(k) ? 'checked' : ''}> ${ROLES[k]}</label>`).join('')}</div>
      <h2 class="mt">Üretim bölümü <span class="sub" style="font-weight:400">· yalnız Üretim rolünde geçerli, boş = tüm aşamalar</span></h2>
      <div class="rolechk">${STG.map(([k, n]) => `<label class="chk"><input type="checkbox" data-pd="${k}" ${(pv.departments || []).includes(k) ? 'checked' : ''}> ${n}</label>`).join('')}</div>
      <p class="mt" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="pvgo">Bu rollerle gör</button>${S.profile._preview ? '<button class="btn" id="pvoff">Önizlemeyi kapat</button>' : ''}</p>
      <dl class="kv mt">${R.map(k => `<dt>${ROLES[k]}</dt><dd>${ROLE_INFO[k]}</dd>`).join('')}</dl></section>`);
  q('#pvgo').onclick = () => {
    const roles = qa('[data-pr]:checked').map(x => x.dataset.pr), departments = qa('[data-pd]:checked').map(x => x.dataset.pd);
    if (!roles.length) return toast('En az bir rol seç', true);
    try { localStorage.setItem(PV_KEY, JSON.stringify({ roles, departments })); } catch { return toast('Tarayıcı ayarı kaydetmeye izin vermiyor', true); }
    location.hash = '#/bugun'; location.reload();
  };
  q('#pvoff') && (q('#pvoff').onclick = () => { try { localStorage.removeItem(PV_KEY); } catch {} location.hash = '#/kullanicilar'; location.reload(); });
}

// ---------------------------------------------------------------- FORM
function viewForm(id){
  const ex = id ? S.deals.find(x => x.id === id) : null;
  if (id && !ex) return viewDetail(id);
  if (!can('sales','orders','admin','production')) return viewDetail(id);
  const convert = /siparis/.test(location.hash);
  const prodOnly = can('production') && !can('sales','orders','admin');
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
    <div class="tablewrap"><table><thead><tr><th class="nosort">Müşteri</th><th class="nosort">Ülke</th><th class="nosort num">Kayıt</th><th class="nosort num">Sipariş</th><th class="nosort num">Toplam ciro</th><th class="nosort">Son hareket</th>${can('sales','orders','admin')?'<th class="nosort"></th>':''}</tr></thead>
    <tbody id="sb">${S.customers.map(c => { const a = agg[c.id]||{n:0,won:0,amt:0,last:''}; return `<tr data-n="${esc(c.name.toLocaleLowerCase('tr'))}" style="cursor:default"><td>${esc(c.name)}</td><td>${esc(ctryName(c.country))}</td><td class="num">${a.n}</td><td class="num">${a.won}</td><td class="num">${fmtUSD(a.amt)}</td><td>${fmtD(a.last)}</td>${can('sales','orders','admin')?`<td><button class="btn sm" data-ec="${c.id}">Düzenle</button></td>`:''}</tr>`; }).join('')}</tbody></table></div>`;
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
  const editable = can('sales','orders','admin','production');
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
  const R = Object.keys(ROLE_INFO);
  shell('kullanicilar', `<div class="pagehead"><div><h1>Kullanıcılar</h1><p class="lede">@acrome.net adresiyle açılan her hesap erişimsiz başlar; siz rol verince açılır. Bir kişiye birden fazla rol verilebilir; yetkiler toplanır. Hiç rol seçilmezse erişim kapanır.</p></div></div>
  <div class="panel" style="margin-bottom:16px"><dl class="kv">${R.map(k => `<dt>${ROLES[k]}</dt><dd>${ROLE_INFO[k]}</dd>`).join('')}</dl></div>
  <div class="tablewrap" id="us"><div class="empty">Yükleniyor…</div></div>`);
  const { data, error } = await sb.from('profiles').select('*').order('created_at');
  if (error) { q('#us').innerHTML = `<div class="empty">${esc(dbErr(error))}</div>`; return; }
  const multi = data.length && Array.isArray(data[0].roles);
  q('#us').innerHTML = `<table><thead><tr><th class="nosort">Ad</th><th class="nosort">E-posta</th><th class="nosort">Kayıt</th><th class="nosort">Roller</th></tr></thead><tbody>${data.map(u => {
    const mine = u.id === S.profile.id, ur = userRoles(u);
    return `<tr style="cursor:default" data-u="${u.id}"><td>${esc(u.full_name||'')}</td><td>${esc(u.email)}</td><td style="white-space:nowrap">${fmtD(u.created_at.slice(0,10))}</td>
    <td>${multi ? `<div class="rolechk">${R.map(k => `<label class="chk"><input type="checkbox" value="${k}" ${ur.includes(k)?'checked':''} ${mine?'disabled':''}> ${ROLES[k]}</label>`).join('')}</div>${mine ? '<div class="sub">Kendi rollerini değiştiremezsin</div>' : ''}
      ${Array.isArray(u.departments) ? `<div class="depchk"><span class="sub">Üretim bölümü:</span>${STG.map(([k, n]) => `<label class="chk"><input type="checkbox" data-dep="${k}" ${u.departments.includes(k)?'checked':''}> ${n}</label>`).join('')}<span class="sub">(boş = tüm aşamalar)</span></div>` : ''}`
      : `<select ${mine?'disabled':''} aria-label="${esc(u.email)} rolü">${Object.entries({ pending:ROLES.pending, viewer:ROLES.viewer, sales:ROLES.sales, production:ROLES.production, support:'Sipariş + Support', admin:ROLES.admin }).map(([k,v])=>`<option value="${k}" ${u.role===k?'selected':''}>${v}</option>`).join('')}</select>`}</td></tr>`; }).join('')}</tbody></table>
    ${multi ? '' : '<p class="note" style="padding:10px 12px;margin:0">Çoklu rol veritabanında henüz açılmadı; şimdilik tek rol seçilebiliyor.</p>'}`;
  qa('#us tr[data-u]').forEach(tr => {
    const id = tr.dataset.u;
    qa('input[data-dep]', tr).forEach(cb => cb.onchange = async () => {
      const departments = qa('input[data-dep]:checked', tr).map(x => x.dataset.dep);
      const { error } = await sb.from('profiles').update({ departments }).eq('id', id); if (error) return toast(dbErr(error), true);
      if (id === S.profile.id) S.profile.departments = departments;
      toast(departments.length ? 'Bölüm: ' + departments.map(stgName).join(', ') : 'Bölüm kaldırıldı (tüm aşamalar)'); });
    qa('input[type=checkbox]:not([data-dep])', tr).forEach(cb => cb.onchange = async () => {
      const roles = qa('input[type=checkbox]:checked:not([data-dep])', tr).map(x => x.value);
      const { error } = await sb.from('profiles').update({ roles }).eq('id', id); if (error) return toast(dbErr(error), true);
      toast(roles.length ? 'Roller: ' + roles.map(r => ROLES[r]).join(' + ') : 'Erişim kapatıldı'); });
    const sel = q('select', tr);
    sel && (sel.onchange = async () => { const { error } = await sb.from('profiles').update({ role: sel.value }).eq('id', id); if (error) return toast(dbErr(error), true); toast('Rol güncellendi'); });
  });
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
const supState = { tab:'ours', cat:'support', product:'', who:'', q:'', hits:null, sort:'act' };
let supPeople = null;

async function loadSupport(){
  const { data, error } = await sb.from('support_tickets')
    .select('id,subject,category,status,priority,product,customer_name,organization,country,contact_email,assignee,watchers,summary,resolution,tags,gmail_thread_ids,basecamp_urls,opened_at,last_activity_at,last_inbound_at,last_outbound_at,closed_at,created_at,updated_at,deal_id,deal_link_source,ai_updated_at')
    .order('last_activity_at', { ascending:false }).range(0, 4999);
  if (error) { S.tickets = S.tickets || []; S.supErr = error.message; return; }
  S.tickets = data; S.supErr = null;
  const n = await sb.from('support_notifications').select('id', { count:'exact', head:true }).is('read_at', null);
  S.unread = n.error ? 0 : (n.count || 0);
  const ss = await sb.from('support_sync_state').select('key,updated_at');
  S.syncAt = Object.fromEntries((ss.data||[]).map(r => [r.key, r.updated_at]));
  const st = await sb.from('support_settings').select('key,value');
  S.supSet = Object.fromEntries((st.data||[]).map(r => [r.key, r.value]));
}
// son senkron satırı: 14 saatten eskiyse uyarı (günde 2 çalışma: 09:30 / 16:30)
function syncLine(){
  const z = S.syncAt || {}, old = t => !t || (Date.now() - new Date(t)) > 14 * 36e5;
  const one = (k, label, hint) => `<span class="chip${old(z[k]) ? ' warn' : ''}" title="${old(z[k]) ? 'Gecikti' + (hint ? ': ' + hint : '') : 'Güncel'}"><i></i>${label} · ${z[k] ? fmtDT(z[k]) : '—'}${old(z[k]) ? ' · gecikti' : ''}</span>`;
  return `<div class="syncline">${one('gmail','Mail senkronu')}${one('basecamp_cards','Basecamp senkronu','bilgisayar kapalı olabilir; açılınca kaldığı yerden devam eder')}</div>`;
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
  const tabs = { ours:'Yeni + Bizde', customer:'Müşteride', open:'Tüm açık', closed:'Kapanan', all:'Tümü' };
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
      (!s.who || (s.who === 'me' ? (t.assignee === S.profile.id || (t.watchers||[]).includes(S.profile.id)) : s.who === 'none' ? !t.assignee : t.assignee === s.who)) &&
      (!ql || hitMap.has(t.id) || ('#' + t.id + ' ' + [t.subject,t.customer_name,t.organization,t.country,t.contact_email,t.summary,t.resolution,(t.tags||[]).join(' '),prodName(t.product)].join(' ')).toLocaleLowerCase('tr').includes(ql)));
    if (ql && s.hits) rows.sort((a,b) => ((hitMap.get(b.id)?.rank)||0) - ((hitMap.get(a.id)?.rank)||0));
    else rows.sort((a,b) => s.sort === 'open' ? (b.opened_at||'').localeCompare(a.opened_at||'') : (b.last_activity_at||'').localeCompare(a.last_activity_at||''));
    q('#stbl').innerHTML = rows.length ? `<table><thead><tr><th class="nosort">#</th><th class="nosort">Konu</th><th class="nosort">Müşteri</th><th class="nosort">Ürün</th><th class="nosort">Durum</th><th class="nosort">Mail durumu</th><th class="nosort">Sorumlu</th><th class="nosort">Son hareket</th></tr></thead><tbody>
      ${rows.map(t => { const w = supWait(t), h = hitMap.get(t.id);
        return `<tr data-tid="${t.id}"><td class="mono">#${t.id}</td>
        <td><b style="font-weight:600">${esc(t.subject)}</b>${t.priority==='high'?' <span class="pill sp-high">Acil</span>':''}
          ${t.summary?`<div class="sub clamp opt">${esc(t.summary)}</div>`:''}
          ${h && h.snippet ? `<div class="sub hit">… ${esc(h.snippet).replace(/&lt;&lt;/g,'<mark>').replace(/&gt;&gt;/g,'</mark>')} …</div>`:''}
          ${(t.tags||[]).length?`<div class="items opt">${t.tags.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:''}</td>
        <td>${esc(t.organization || t.customer_name || '—')}<div class="sub">${esc([t.organization?t.customer_name:'', t.country].filter(Boolean).join(' · '))}</div></td>
        <td>${t.product?esc(prodName(t.product)):'<span class="sub">—</span>'}</td>
        <td>${supPill(t.status)}${s.cat==='all'&&t.category!=='support'?`<div class="sub">${SUP_CAT[t.category]}</div>`:''}</td>
        <td><span class="${mailState(t).cls}" style="font-size:13px">${mailState(t).txt}</span>${t.deal_id?`<div class="sub">${esc(dealNo(t.deal_id))}</div>`:''}</td>
        <td>${esc(personName(t.assignee)) || '<span class="sub">—</span>'}${(t.watchers||[]).length ? `<div class="sub">+ ${(t.watchers||[]).map(personName).filter(Boolean).map(esc).join(', ')}</div>` : ''}</td>
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
    : e.kind === 'watchers' ? `İlgili kişiler: ${esc(e.old_value||'—')} → <b>${esc(e.new_value||'—')}</b>`
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
        <span class="when">${fmtDT(m.sent_at)} · ${SUP_SRC[m.source]||m.source}${m.url?` · <a href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener">aç ↗</a>`:''}
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
          <div class="f wbox"><span class="wt">İlgili kişiler</span><span class="hint">yeni müşteri mailinde onlara da bildirim gider</span>
            <div class="watchers">${supPeople.filter(p => p.id !== t.assignee).map(p=>`<label class="chk"><input type="checkbox" name="w" value="${p.id}" ${(t.watchers||[]).includes(p.id)?'checked':''}> ${esc(p.name)}</label>`).join('')}</div></div>
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
          ${canSup()?'<p><button class="btn primary">Kaydet</button></p>':'<p class="note">Düzenlemek için yöneticiden <b>Support</b> rolü iste.</p>'}
        </fieldset></form>
        <dl class="kv mt">
          <dt>Son müşteri</dt><dd>${fmtDT(t.last_inbound_at)}</dd>
          <dt>Son Acrome</dt><dd>${fmtDT(t.last_outbound_at)}</dd>
          ${t.closed_at?`<dt>Kapandı</dt><dd>${fmtDT(t.closed_at)}</dd>`:''}
          ${(t.gmail_thread_ids||[]).length?`<dt>Gmail</dt><dd>${t.gmail_thread_ids.map(g=>`<a href="https://mail.google.com/mail/u/0/#all/${esc(g)}" target="_blank" rel="noopener">${esc(g)}</a>`).join('<br>')}</dd>`:''}
          ${(t.basecamp_urls||[]).length?`<dt>Basecamp</dt><dd>${t.basecamp_urls.map(u=>`<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener">bağlantı ↗</a>`).join('<br>')}</dd>`:''}
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
    const assignee = v('assignee');
    const watchers = [...f.querySelectorAll('input[name=w]:checked')].map(x => x.value).filter(x => x !== assignee);
    upd({ status:f.status.value, assignee, watchers, priority:f.priority.value, category:f.category.value, product:v('product'),
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
    sb.from('support_notifications').select('*').order('created_at', { ascending:false }).limit(100),
    sb.from('push_subscriptions').select('id,user_agent,created_at').order('created_at'),
  ]);
  const ns = nr.data || [], subs = sr.data || [];
  const tk = id => (S.tickets||[]).find(t => t.id === id);
  let here = false; try { const reg = await navigator.serviceWorker?.getRegistration('sw.js'); here = !!(reg && await reg.pushManager.getSubscription()); } catch {}
  shell('bildirimler', `<div class="pagehead"><div><h1>Bildirimler</h1><p class="lede">Bir support konusuna müşteriden yeni mail geldiğinde konunun sorumlusuna ve ilgili kişilerine telefon/bilgisayar bildirimi gider. Stok sayımı bildirimleri (Depo / Stok rolü) burada görünür ve kayıtlı e-posta adresine gönderilir.</p></div></div>
    <section class="panel"><h2>Bu cihaz</h2>
      <p class="note" style="margin-top:0">${here ? 'Bu cihazda bildirimler açık.' : 'Bu cihazda bildirim almak için aç. Telefon ve bilgisayarda ayrı ayrı açılır.'} Kayıtlı cihaz sayın: ${subs.length}.</p>
      <p style="display:flex;gap:8px;flex-wrap:wrap">${here ? '' : '<button class="btn primary" id="pon">Bu cihazda bildirimleri aç</button>'}<button class="btn" id="ptest">Test bildirimi gönder</button>${ns.some(n=>!n.read_at)?'<button class="btn" id="pread">Hepsini okundu say</button>':''}${ns.some(n=>n.read_at)?'<button class="btn" id="pdelr">Okunanları sil</button>':''}${ns.length?'<button class="btn danger" id="pdelall">Tümünü sil</button>':''}</p>
    </section>
    <div class="tablewrap mt">${ns.length ? `<table><tbody>${ns.map(n => { const t = tk(n.ticket_id); return `<tr data-nt="${n.ticket_id||''}" data-nl="${esc(n.link||'')}" data-nid2="${n.id}" class="${n.read_at?'':'unread'}"><td style="white-space:nowrap">${fmtDT(n.created_at)}</td><td>${n.ticket_id ? `Yeni support maili · <span class="mono">#${n.ticket_id}</span> ${esc(t ? t.subject : '')}` : n.title ? `${/^sayim/.test(n.kind || '') ? '<b>Stok sayımı</b> · ' : n.kind === 'masraf' ? '<b>Masraf</b> · ' : ''}${esc(n.title)}` : 'Test bildirimi'}</td><td>${n.read_at ? '<span class="sub">okundu</span>' : '<b>yeni</b>'}</td><td style="width:1%"><button class="btn ndel" data-nid="${n.id}" title="Bildirimi sil" aria-label="Bildirimi sil">Sil</button></td></tr>`; }).join('')}</tbody></table>` : '<div class="empty">Henüz bildirim yok.</div>'}</div>`);
  q('#pon') && (q('#pon').onclick = e => enablePush(e.target));
  q('#ptest').onclick = async e => { e.target.disabled = true; const { data, error } = await sb.rpc('support_push_test'); e.target.disabled = false; if (error) return toast(dbErr(error), true); toast('Test gönderildi'); await loadSupport(); viewNotifications(); };
  q('#pread') && (q('#pread').onclick = async () => { await sb.from('support_notifications').update({ read_at: new Date().toISOString() }).is('read_at', null); await loadSupport(); viewNotifications(); });
  const ndel = async (qb, msg) => { const { error } = await qb; if (error) return toast(dbErr(error), true); toast(msg); await loadSupport(); viewNotifications(); };
  q('#pdelr') && (q('#pdelr').onclick = () => ndel(sb.from('support_notifications').delete().not('read_at', 'is', null), 'Okunan bildirimler silindi'));
  q('#pdelall') && (q('#pdelall').onclick = e => { if (e.target.dataset.ok) return ndel(sb.from('support_notifications').delete().gte('id', 0), 'Tüm bildirimler silindi'); e.target.dataset.ok = 1; e.target.textContent = 'Emin misin? Tekrar bas'; });
  qa('.ndel').forEach(b => b.onclick = e => { e.stopPropagation(); ndel(sb.from('support_notifications').delete().eq('id', +b.dataset.nid), 'Bildirim silindi'); });
  qa('tr[data-nt]').forEach(r => r.onclick = async () => { if (r.dataset.nt) return location.hash = '#/support/' + r.dataset.nt;
    if (r.dataset.nl) { await sb.from('support_notifications').update({ read_at: new Date().toISOString() }).eq('id', +r.dataset.nid2).is('read_at', null); loadSupport(); location.hash = r.dataset.nl; } });
}

async function viewTicketNew(){
  if (!S.supSet) await loadSupport();
  await people();
  shell('support-yeni', `<p><a href="#/support">← Support listesi</a></p><h1>Yeni support konusu</h1>
  <p class="lede">Mail dışında gelen (telefon, Meet, Basecamp, yüz yüze) bir konuyu kaydetmek için. Mailden gelenler otomatik eklenir.</p>
  <form id="tn" class="fs" style="max-width:760px" novalidate>
    <label class="f">Konu<input type="text" name="subject" required></label>
    <div class="row r2"><label class="f">Kategori<select name="category">${Object.entries(SUP_CAT).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
    <label class="f">Ürün<select name="product"><option value="">—</option>${S.products.map(p=>`<option value="${p.code}">${esc(p.name)}</option>`).join('')}</select></label></div>
    <div class="row r2"><label class="f">Müşteri (kişi)<input type="text" name="customer_name"></label><label class="f">Kurum / bayi<input type="text" name="organization"></label></div>
    <div class="row r2"><label class="f">Ülke<input type="text" name="country"></label><label class="f">E-posta<input type="email" name="contact_email"></label></div>
    <div class="row r2"><label class="f">Sorumlu<select name="assignee"><option value="">—</option>${supPeople.map(p=>`<option value="${p.id}" ${p.id===((S.supSet||{}).default_assignee||S.profile.id)?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>
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
  shell('rma-rapor', `<p><a href="#/rma">← RMA listesi</a></p>
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

  shell(id ? 'rma' : 'rma-yeni', `<p><a href="#/rma">← RMA listesi</a></p>
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
    ${ed ? `<p class="mt"><button class="btn primary">${id?'Kaydet':'RMA aç'}</button></p>` : '<p class="note">Düzenlemek için <b>Support</b> veya <b>Yönetici</b> rolü gerekir.</p>'}
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

// =====================================================================
// Stok (parçalar, BOM listeleri, PCB kartları, motor testleri) ve Alımlar
// app.js'teki ortak yardımcıları kullanır (sb, S, shell, q, qa, esc, toast, ...)
// =====================================================================
const canStock = () => can('production', 'stock', 'orders', 'admin');
const canPurchase = () => can('production', 'stock', 'purchasing', 'orders', 'admin');
const STK_CAT = { mekanik:'Mekanik', elektronik:'Elektronik', komponent:'Komponent', hazir:'Hazır alınan', diger:'Diğer' };
const MOVE_R = { acilis:'Açılış', sayim:'Sayım', alim:'Alım', uretim:'Üretim', rma:'RMA', duzeltme:'Düzeltme', iade:'İade', diger:'Diğer' };
const PUR_ST = { talep:'Talep', onaylandi:'Onaylandı', proforma:'Proforma alındı', siparis_verildi:'Sipariş verildi', eft_bekliyor:'EFT bekliyor', alindi:'Alındı', reddedildi:'Reddedildi', arsiv:'Eski / kapandı' };
const PUR_OPEN = ['talep', 'onaylandi', 'proforma', 'siparis_verildi', 'eft_bekliyor'];
const PUR_UNIT = ['Mekanik', 'Elektronik', 'SMD', 'Yazılım'];
const PUR_AREA = ['Üretim', 'ARGE', 'Sipariş', 'Tasarım', 'Ofis Kullanımı', 'Deneme'];
const BOM_KIND = { product:'Ürün', project:'Proje', pcb:'PCB dizgi' };
const SECT = { mekanik:'Mekanik', elektronik:'Elektronik', komponent:'Komponent', diger:'Diğer' };
const num0 = v => v == null || v === '' ? null : +String(v).replace(',', '.');
const fmtQ = n => n == null ? '—' : (+n).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
const fmtMoney = (n, cur) => n == null || n === '' ? '—' : (+n).toLocaleString('tr-TR', { maximumFractionDigits: 2 }) + ' ' + ({ TRY:'₺', USD:'$', EUR:'€' }[cur || 'TRY'] || cur);
const purPill = st => `<span class="pill pu-${st}">${PUR_ST[st] || st}</span>`;
const stkSel = (name, o, v, blank) => `<select name="${name}">${blank !== undefined ? `<option value="">${blank}</option>` : ''}${Object.entries(o).map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const arrSel = (name, arr, v, blank) => `<select name="${name}">${blank !== undefined ? `<option value="">${blank}</option>` : ''}${[...new Set([...(v && !arr.includes(v) ? [v] : []), ...arr])].map(x => `<option ${v === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;

// ---------------------------------------------------------------- yükleme
async function loadStock(force){
  if (S.stockLoaded && !force) return;
  const [it, bm, su, pb] = await Promise.all([
    sb.from('stock_items').select('*').order('name').range(0, 9999),
    sb.from('boms').select('*').order('kind').order('name'),
    sb.from('suppliers').select('id,name,kind,grp,blacklisted,blacklist_reason').order('name'),
    sb.from('pcb_boards').select('*').order('pcb').order('version'),
  ]);
  S.items = it.data || []; S.boms = bm.data || []; S.suppliers = su.data || []; S.pcbs = pb.data || [];
  const pl = await sb.from('bom_lines').select('item_id,bom_id').not('item_id', 'is', null).range(0, 9999);
  const prodB = new Set(S.boms.filter(b => b.kind === 'product').map(b => b.id));
  S.prodItemIds = new Set((pl.data || []).filter(l => prodB.has(l.bom_id)).map(l => l.item_id));
  S.stockLoaded = true;
}
async function loadPurCount(){
  const r = await sb.from('purchases').select('id,kind,item_name,project,qty,urgency,status,requested_at,requester,requester_name,created_by').in('status', PUR_OPEN).order('requested_at', { ascending:false }).range(0, 999);
  S.purOpenList = r.error ? [] : (r.data || []);
  S.purOpen = S.purOpenList.filter(p => p.kind === 'alim').length;
}
const itemById = id => (S.items || []).find(i => i.id === id);
const supName = id => (S.suppliers || []).find(s => s.id === id)?.name || '';
const lowStock = i => i.qty != null && ((i.min_qty != null && +i.qty < +i.min_qty) || +i.qty <= 0);

// ---------------------------------------------------------------- PARÇALAR
// Mekanik ve elektronik stok ayrı sayfalar
const STK_GRP = { m:{ key:'mekanik-stok', upd:'mekanik-sayim', title:'Mekanik stok', cats:['mekanik','diger'], newCat:'mekanik' },
                  e:{ key:'elektronik-stok', upd:'elektronik-sayim', title:'Elektronik stok', cats:['elektronik','komponent','hazir'], newCat:'elektronik' } };
const grpOfCat = c => STK_GRP.e.cats.includes(c) ? 'e' : 'm';
const critical = i => i.qty != null && i.min_qty != null && +i.qty < +i.min_qty;
const stkStates = { m:{ cat:'all', q:'', bom:'', only:'' }, e:{ cat:'all', q:'', bom:'', only:'' } };
async function viewStock(g){
  g = g === 'e' ? 'e' : 'm';
  const G = STK_GRP[g], s = stkStates[g];
  await loadStock(true);
  const lines = (await sb.from('bom_lines').select('bom_id,item_id').not('item_id', 'is', null).range(0, 9999)).data || [];
  const usedIn = {}; lines.forEach(l => { (usedIn[l.item_id] = usedIn[l.item_id] || new Set()).add(l.bom_id); });
  const hasImg = new Set(((await sb.from('stock_item_images').select('item_id').range(0, 9999)).data || []).map(x => x.item_id));
  const bomName = id => (S.boms.find(b => b.id === id) || {}).name || '';
  const I = S.items.filter(i => G.cats.includes(i.category));
  const cats = Object.fromEntries(G.cats.filter(c => I.some(i => i.category === c)).map(c => [c, STK_CAT[c]]));
  const val = I.filter(i => (i.currency || 'TRY') === 'TRY').reduce((a, i) => a + (+i.qty || 0) * (+i.unit_price || 0), 0);
  const nCrit = I.filter(critical).length;
  const boms = S.boms.filter(b => b.kind !== 'pcb' || g === 'e');
  shell(G.key, `<div class="pagehead"><div><h1>${G.title}</h1><p class="lede">${g === 'm' ? 'Mekanik parçalar (talaşlı imalat, lazer, pleksi, rulman, bağlantı elemanı…).' : 'Elektronik parçalar, PCB komponentleri ve hazır alınan ürünler.'} Kod biçimi: TÜR-ÜRÜN-SIRA (ör. ${g === 'm' ? 'M-BBT-004' : 'E-STW-002, K-PCB-031'}). Sayım günü: her ayın ilk cuması${isCountDay() ? ' (bugün)' : ' · sonraki: ' + countDayTxt()}.</p></div>
    <div style="display:flex;gap:8px">${canStock() ? `<a class="btn" href="#/${G.upd}">Sayım / giriş-çıkış</a><a class="btn primary" href="#/stok-yeni/${g}">Yeni parça</a>` : ''}</div></div>
  ${countBanner()}
  <div class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">
    <div class="kpi"><div class="v">${I.length}</div><div class="l">Parça kalemi</div><div class="d">${I.filter(i => i.qty == null).length} kalemde stok girilmemiş</div></div>
    <div class="kpi ${nCrit ? 'alert' : ''} kpi-click" id="kcrit" title="Kritik stokları göster"><div class="v">${nCrit}</div><div class="l">Kritik stok</div><div class="d">minimumun altında · göstermek için tıkla</div></div>
    <div class="kpi"><div class="v">${I.filter(i => i.qty != null && +i.qty <= 0).length}</div><div class="l">Stokta yok</div><div class="d">stok 0</div></div>
    <div class="kpi"><div class="v">${fmtTRY(val)}</div><div class="l">Stok değeri</div><div class="d">TL fiyatlı kalemler</div></div>
  </div>
  <div class="toolbar">${Object.keys(cats).length > 1 ? `<div class="seg" id="scat">${Object.entries({ all:'Tümü', ...cats }).map(([k, v]) => `<button data-c="${k}" class="${s.cat === k ? 'on' : ''}">${v}</button>`).join('')}</div>` : ''}
    <div class="seg" id="sonly">${[['', 'Hepsi'], ['crit', 'Kritik'], ['zero', 'Stok 0'], ['nil', 'Girilmemiş']].map(([k, v]) => `<button data-o="${k}" class="${s.only === k ? 'on' : ''}">${v}</button>`).join('')}</div>
    <input type="search" id="sq" placeholder="Ara: kod, ad, malzeme, tedarikçi, konum…" value="${esc(s.q)}">
    <select id="sbom"><option value="">Tüm ürünler / BOM'lar</option>${boms.map(b => `<option value="${b.id}" ${+s.bom === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
  <div class="tablewrap" id="stbl"></div>`);
  const draw = () => {
    const ql = s.q.trim().toLocaleLowerCase('tr');
    const rows = I.filter(i => (s.cat === 'all' || i.category === s.cat) && (!s.bom || (usedIn[i.id] && usedIn[i.id].has(+s.bom)))
      && (!s.only || (s.only === 'crit' ? critical(i) : s.only === 'zero' ? i.qty != null && +i.qty <= 0 : i.qty == null))
      && (!ql || [i.code, i.name, i.mfr_no, i.material, i.process, i.supplier_text, supName(i.supplier_id), i.location, i.description].join(' ').toLocaleLowerCase('tr').includes(ql)))
      .sort((a, b) => (a.code || '').localeCompare(b.code || '', 'tr', { numeric:true }));
    q('#stbl').innerHTML = rows.length ? `<table><thead><tr><th class="nosort">Kod</th><th class="nosort">Parça</th><th class="nosort num">Stok</th><th class="nosort num">Min</th><th class="nosort num">Birim fiyat</th><th class="nosort">Konum</th><th class="nosort">Tedarikçi</th><th class="nosort">Kullanıldığı yer</th></tr></thead><tbody>
      ${rows.slice(0, 600).map(i => `<tr data-iid="${i.id}"><td class="mono" style="white-space:nowrap">${esc(i.code || '—')}</td><td><b style="font-weight:600">${esc(i.name)}</b>${hasImg.has(i.id) ? ' <span class="imgdot" title="Görseli var">◉</span>' : ''}${i.mfr_no ? `<div class="sub mono">${esc(i.mfr_no)}</div>` : ''}${i.material || i.process ? `<div class="sub opt">${esc([i.material, i.process].filter(Boolean).join(' · '))}</div>` : ''}</td>
        <td class="num"><b class="${critical(i) || (i.qty != null && +i.qty <= 0) ? 'late-txt' : ''}" style="font-size:15px">${i.qty == null ? '<span class="sub">—</span>' : fmtQ(i.qty)}</b> <span class="sub">${esc(i.unit || '')}</span></td>
        <td class="num sub">${i.min_qty == null ? '' : fmtQ(i.min_qty)}</td>
        <td class="num">${fmtMoney(i.unit_price, i.currency)}</td><td style="white-space:nowrap">${esc(i.location || '') || '<span class="sub">—</span>'}</td>
        <td><span class="clamp1">${esc(supName(i.supplier_id) || i.supplier_text || '') || '<span class="sub">—</span>'}</span></td>
        <td><span class="sub clamp1">${[...(usedIn[i.id] || [])].map(bomName).filter(Boolean).slice(0, 3).map(esc).join(', ')}${(usedIn[i.id] || new Set()).size > 3 ? '…' : ''}</span></td></tr>`).join('')}</tbody>
      <tfoot><tr class="tfoot"><td colspan="8">${rows.length} kalem${rows.length > 600 ? ' (ilk 600 gösteriliyor; aramayı daraltın)' : ''}</td></tr></tfoot></table>` : '<div class="empty">Kayıt yok.</div>';
    qa('#stbl tr[data-iid]').forEach(r => r.onclick = () => location.hash = '#/stok/' + r.dataset.iid);
  };
  draw();
  qa('#scat button').forEach(b => b.onclick = () => { s.cat = b.dataset.c; qa('#scat button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  const setOnly = v => { s.only = v; qa('#sonly button').forEach(x => x.classList.toggle('on', x.dataset.o === v)); draw(); };
  qa('#sonly button').forEach(b => b.onclick = () => setOnly(b.dataset.o));
  q('#kcrit').onclick = () => setOnly('crit');
  q('#sq').oninput = e => { s.q = e.target.value; draw(); };
  q('#sbom').onchange = e => { s.bom = e.target.value; draw(); };
}


const CODE_GRP = { BB:'Ball Balancing', BBT:'Ball Balancing Table', PEN:'Pendulum', STW:'Stewart', STP:'Stewart PRO', DLT:'Delta', C1D:'1-DOF', C2D:'2-DOF', ARM:'Robot kol', SMD:'SMD', SPR:'Sparkle', ORT:'Ortak (birden fazla ürün)', PCB:'PCB komponenti', GEN:'Genel / diğer' };
async function viewStockItem(id, g){
  await loadStock();
  let i = id ? (await sb.from('stock_items').select('*').eq('id', id).maybeSingle()).data : { category:g === 'e' ? 'elektronik' : 'mekanik', unit:'adet', currency:'TRY' };
  if (!i) return shell('mekanik-stok', `<h1>Parça bulunamadı</h1><p><a href="#/mekanik-stok">Mekanik stok</a> · <a href="#/elektronik-stok">Elektronik stok</a></p>`);
  const G = STK_GRP[grpOfCat(i.category)];
  const [mv, ln, pu] = id ? await Promise.all([
    sb.from('stock_moves').select('*').eq('item_id', id).order('at', { ascending:false }).limit(100),
    sb.from('bom_lines').select('bom_id,qty_per,alt_group').eq('item_id', id),
    sb.from('purchases').select('id,requested_at,item_name,qty,unit_price,total,status,supplier_text').eq('item_id', id).order('requested_at', { ascending:false }).limit(30),
  ]) : [{ data:[] }, { data:[] }, { data:[] }];
  const ed = canStock(), v = k => esc(i[k] ?? '');
  const tx = (k, l, hint) => `<label class="f">${l}${hint ? ` <span class="hint">${hint}</span>` : ''}<input type="text" name="${k}" value="${v(k)}"></label>`;
  const nm = (k, l, hint) => `<label class="f">${l}${hint ? ` <span class="hint">${hint}</span>` : ''}<input type="number" step="any" name="${k}" value="${v(k)}"></label>`;
  shell(G.key, `<p><a href="#/${G.key}">← ${G.title}</a></p>
  <div class="pagehead"><div><h1>${id ? esc(i.name) : 'Yeni parça'}</h1>${id ? `<p class="lede">${STK_CAT[i.category] || ''}${i.source ? ' · kaynak: ' + esc(i.source) : ''}</p>` : ''}</div>
    ${id ? `<div style="display:flex;gap:8px;align-items:center"><span class="stkbig ${lowStock(i) ? 'late-txt' : ''}">${i.qty == null ? '—' : fmtQ(i.qty)} <small>${esc(i.unit || '')}</small></span>
      <a class="btn" href="#/alim-yeni/i${i.id}">Alım talebi</a>${can('admin') ? '<button class="btn danger" id="idel">Sil</button>' : ''}</div>` : ''}</div>
  <div class="grid sup-grid"><div>
    <form id="itf" class="fs" novalidate><fieldset ${ed ? '' : 'disabled'} class="plainfs">
      <div class="row ${i.code ? 'r2' : ''}">${tx('name', 'Parça adı')}${tx('code', 'Parça kodu', i.code ? 'TÜR-ÜRÜN-SIRA' : 'boş bırakılırsa otomatik verilir')}${i.code ? '' : `<label class="f">Kod grubu <span class="hint">hangi ürünün parçası</span><select name="grp">${Object.entries(CODE_GRP).map(([k, l]) => `<option value="${k}" ${k === (i.category === 'komponent' ? 'PCB' : 'ORT') ? 'selected' : ''}>${k} · ${esc(l)}</option>`).join('')}</select></label>`}</div>
      <div class="row">${'<label class="f">Tür' + stkSel('category', STK_CAT, i.category) + '</label>'}${tx('unit', 'Birim', 'adet, metre, kg')}${tx('location', 'Konum / raf')}</div>
      <div class="row">${id ? `<label class="f">Stok <span class="hint">değiştirmek için sağdaki kutuyu kullanın</span><input type="text" value="${i.qty == null ? '' : fmtQ(i.qty)}" disabled></label>` : nm('qty', 'Açılış stoğu')}${nm('min_qty', 'Minimum stok', 'altına düşünce uyarı')}${tx('mfr_no', 'Üretici no')}</div>
      <div class="row">${nm('unit_price', 'Birim fiyat')}<label class="f">Para birimi${stkSel('currency', { TRY:'TRY', USD:'USD', EUR:'EUR' }, i.currency || 'TRY')}</label><label class="f">Tedarikçi<select name="supplier_id"><option value="">—</option>${S.suppliers.map(s => `<option value="${s.id}" ${i.supplier_id === s.id ? 'selected' : ''}>${esc(s.name)}${s.blacklisted ? ' (kara liste)' : ''}</option>`).join('')}</select></label></div>
      <div class="row r2">${tx('material', 'Malzeme')}${tx('process', 'İmalat türü')}</div>
      ${tx('supplier_text', 'Tedarik notu', 'firma, link ya da açıklama')}${tx('link', 'Bağlantı')}
      <label class="f">Açıklama<textarea name="description" rows="2">${v('description')}</textarea></label>
      <label class="f">Not<textarea name="notes" rows="2">${v('notes')}</textarea></label>
      ${ed ? `<p><button class="btn primary">${id ? 'Kaydet' : 'Parçayı ekle'}</button></p>` : '<p class="note">Düzenlemek için Depo / Stok, Üretim, Sipariş ya da Yönetici rolü gerekir.</p>'}
    </fieldset></form>
    ${id ? `<section class="panel mt"><h2>Stok hareketleri</h2>${(mv.data || []).length ? `<div class="tablewrap"><table><thead><tr><th class="nosort">Tarih</th><th class="nosort">Neden</th><th class="nosort num">Değişim</th><th class="nosort num">Sonra</th><th class="nosort">Not</th><th class="nosort">Kim</th></tr></thead><tbody>${mv.data.map(m => `<tr><td>${fmtDT(m.at)}</td><td>${MOVE_R[m.reason] || esc(m.reason)}</td><td class="num ${m.delta < 0 ? 'late-txt' : 'ok-txt'}">${m.delta > 0 ? '+' : ''}${fmtQ(m.delta)}</td><td class="num">${fmtQ(m.qty_after)}</td><td>${esc(m.note || '')}</td><td class="sub">${esc(m.actor_name || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="note">Henüz hareket yok. Excel\'den gelen stok açılış değeri olarak duruyor.</p>'}</section>` : ''}
  </div><aside>
    ${id ? `<section class="panel imgpanel"><div id="iimg" class="note">Görsel yükleniyor…</div>${ed ? '<label class="btn sm" style="margin-top:8px">Görsel değiştir<input type="file" id="iimgf" accept="image/*" hidden></label>' : ''}</section>` : ''}
    ${id && ed ? `<section class="panel mt"><h2>Stok değiştir</h2><form id="mvf" class="fs plain" novalidate>
      <div class="seg" id="mvk" style="margin-bottom:10px"><button type="button" data-k="in" class="on">Giriş</button><button type="button" data-k="out">Çıkış</button><button type="button" data-k="set">Sayım</button></div>
      <label class="f"><span id="mvl">Gelen adet</span><input type="number" step="any" name="n" required></label>
      <label class="f">Neden${stkSel('reason', MOVE_R, 'alim')}</label>
      <label class="f">Not <span class="hint">ör. sipariş no, RMA no</span><input type="text" name="note"></label>
      <p><button class="btn primary">Uygula</button></p></form></section>` : ''}
    ${id ? `<section class="panel mt"><h2>Kullanıldığı BOM'lar</h2>${(ln.data || []).length ? `<ul class="sugg">${ln.data.map(l => { const b = S.boms.find(x => x.id === l.bom_id); return b ? `<li><a href="#/bom/${b.id}">${esc(b.name)}</a> · ürün başına ${fmtQ(l.qty_per)}${l.alt_group ? ' <span class="sub">(seçenekli)</span>' : ''}</li>` : ''; }).join('')}</ul>` : '<p class="note">Bir BOM\'da kullanılmıyor.</p>'}</section>
    <section class="panel mt"><h2>Alımlar</h2>${(pu.data || []).length ? `<ul class="sugg">${pu.data.map(p => `<li><a href="#/alimlar/${p.id}">${fmtD(p.requested_at)}</a> · ${fmtQ(p.qty)} adet · ${fmtMoney(p.total)} ${purPill(p.status)}</li>`).join('')}</ul>` : '<p class="note">Bu parçaya bağlı alım yok.</p>'}</section>` : ''}
  </aside></div>`);
  if (id) sb.from('stock_item_images').select('mime,data').eq('item_id', id).maybeSingle().then(({ data }) => {
    const el = q('#iimg'); if (!el) return; el.innerHTML = data ? `<img src="data:${esc(data.mime)};base64,${esc(data.data)}" alt="${esc(i.name)}" class="partimg">` : 'Görsel yok.'; });
  q('#iimgf') && (q('#iimgf').onchange = async e => { const f = e.target.files[0]; if (!f) return;
    try { const im = await shrinkImage(f); const { error } = await sb.from('stock_item_images').upsert({ item_id:id, mime:im.mime, data:im.data, updated_at:new Date().toISOString() });
      if (error) return toast(dbErr(error), true); toast('Görsel kaydedildi'); q('#iimg').innerHTML = `<img src="data:${im.mime};base64,${im.data}" alt="" class="partimg">`; } catch (err) { toast(err.message, true); } });
  q('#itf').onsubmit = async e => {
    e.preventDefault(); const f = e.target, g = n => f[n] ? f[n].value.trim() : '';
    if (!g('name')) return toast('Parça adı boş olamaz', true);
    const o = { name:g('name'), code:g('code') || null, category:f.category.value, unit:g('unit') || 'adet', location:g('location') || null, min_qty:num0(g('min_qty')),
      mfr_no:g('mfr_no') || null, unit_price:num0(g('unit_price')), currency:f.currency.value, supplier_id:f.supplier_id.value ? +f.supplier_id.value : null,
      material:g('material') || null, process:g('process') || null, supplier_text:g('supplier_text') || null, link:g('link') || null, description:g('description') || null, notes:g('notes') || null };
    if (!o.code && f.grp) { const r = await sb.rpc('stock_next_code', { p_cat:o.category, p_grp:f.grp.value }); if (!r.error && r.data) o.code = r.data; }
    if (!id) {
      const start = num0(g('qty'));
      const { data, error } = await sb.from('stock_items').insert(o).select('id').single();
      if (error) return toast(dbErr(error), true);
      if (start) await sb.rpc('stock_move', { p_item:data.id, p_new_qty:start, p_reason:'acilis', p_note:'Açılış stoğu' });
      toast('Parça eklendi'); S.stockLoaded = false; location.hash = '#/stok/' + data.id; return;
    }
    const { error } = await sb.from('stock_items').update(o).eq('id', id);
    if (error) return toast(dbErr(error), true);
    toast('Kaydedildi'); S.stockLoaded = false; viewStockItem(id);
  };
  let mk = 'in';
  qa('#mvk button').forEach(b => b.onclick = () => { mk = b.dataset.k; qa('#mvk button').forEach(x => x.classList.toggle('on', x === b));
    q('#mvl').textContent = { in:'Gelen adet', out:'Çıkan adet', set:'Sayılan gerçek stok' }[mk];
    q('#mvf').reason.value = { in:'alim', out:'uretim', set:'sayim' }[mk]; });
  q('#mvf') && (q('#mvf').onsubmit = async e => {
    e.preventDefault(); const f = e.target, n = num0(f.n.value);
    if (n == null || n < 0) return toast('Geçerli bir adet girin', true);
    const args = { p_item:id, p_reason:f.reason.value, p_note:f.note.value.trim() || null };
    if (mk === 'set') args.p_new_qty = n; else args.p_delta = mk === 'in' ? n : -n;
    const { error } = await sb.rpc('stock_move', args);
    if (error) return toast(dbErr(error), true);
    toast('Stok güncellendi'); S.stockLoaded = false; viewStockItem(id);
  });
  q('#idel') && (q('#idel').onclick = async () => { const b = q('#idel'); if (!b.dataset.ok) { b.dataset.ok = 1; b.textContent = 'Emin misin? Tekrar bas'; return; }
    const { error } = await sb.from('stock_items').delete().eq('id', id); if (error) return toast(dbErr(error), true); toast('Silindi'); S.stockLoaded = false; location.hash = '#/' + G.key; });
}

// ---------------------------------------------------------------- STOK GÜNCELLEME (mekanik / elektronik ayrı; sayım / giriş / çıkış)
const sgStates = { m:{ cat:'all', q:'', bom:'', mode:'sayim', only:'' }, e:{ cat:'all', q:'', bom:'', mode:'sayim', only:'' } };
async function viewStockUpdate(g, arg){
  g = g === 'e' ? 'e' : 'm';
  if (!canStock()) return viewStock(g);
  const G = STK_GRP[g], s = sgStates[g];
  if (arg === 'eksik') s.only = 'uncounted';
  await loadStock(true);
  const m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
  const counted = new Set(((await sb.from('stock_moves').select('item_id').eq('reason', 'sayim').gte('at', m0.toISOString()).range(0, 9999)).data || []).map(x => x.item_id));
  const lines = (await sb.from('bom_lines').select('bom_id,item_id').not('item_id', 'is', null).range(0, 9999)).data || [];
  const inBom = {}; lines.forEach(l => (inBom[l.bom_id] = inBom[l.bom_id] || new Set()).add(l.item_id));
  const I = S.items.filter(i => G.cats.includes(i.category)), changed = new Map();
  const cats = Object.fromEntries(G.cats.filter(c => I.some(i => i.category === c)).map(c => [c, STK_CAT[c]]));
  const MODES = { sayim:['Sayım', 'Sayılan gerçek adet'], giris:['Giriş', 'Gelen adet'], cikis:['Çıkış', 'Çıkan adet'] };
  shell(G.upd, `<p><a href="#/${G.key}">← ${G.title}</a></p><div class="pagehead"><div><h1>${G.title} — sayım / giriş-çıkış</h1><p class="lede">Yalnızca doldurduğunuz satırlar kaydedilir; her biri parçanın hareket geçmişine işlenir. Bu sayfada yalnızca ${g === 'm' ? 'mekanik' : 'elektronik, komponent ve hazır alınan'} parçalar var. Sayım günü her ayın ilk cuması${isCountDay() ? ' — <b>bugün</b>' : ' · sonraki: ' + countDayTxt()}. Depo sorumlularına (Depo / Stok rolü) e-posta ile: bir gün önce 14:00'te hatırlatma, sayım günü 09:00'da bildirim, 18:00'de sayılmayan parça özeti.</p></div></div>
  ${countBanner()}
  <div class="toolbar"><div class="seg" id="sgm">${Object.entries(MODES).map(([k, v]) => `<button data-m="${k}" class="${s.mode === k ? 'on' : ''}">${v[0]}</button>`).join('')}</div>
    ${Object.keys(cats).length > 1 ? `<div class="seg" id="sgc">${Object.entries({ all:'Tümü', ...cats }).map(([k, v]) => `<button data-c="${k}" class="${s.cat === k ? 'on' : ''}">${v}</button>`).join('')}</div>` : ''}
    <div class="seg" id="sgo">${[['', 'Hepsi'], ['uncounted', 'Bu ay sayılmadı'], ['crit', 'Kritik'], ['nil', 'Girilmemiş']].map(([k, v]) => `<button data-o="${k}" class="${s.only === k ? 'on' : ''}">${v}</button>`).join('')}</div></div>
  <div class="toolbar"><input type="search" id="sgq" placeholder="Ara: kod, ad, konum…" value="${esc(s.q)}">
    <select id="sgb"><option value="">Tüm parçalar</option>${S.boms.filter(b => b.kind !== 'pcb' || g === 'e').map(b => `<option value="${b.id}" ${+s.bom === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
    <input type="text" id="sgn" placeholder="Not (ör. Kasım 2026 sayımı, ACRPO-540 girişi)" style="max-width:340px"></div>
  <p class="note" id="sgprog"></p>
  <div class="tablewrap" id="sgt"></div>
  <div class="savebar" id="sgbar" hidden><span id="sgcnt"></span><button class="btn" id="sgclr">Temizle</button><button class="btn primary" id="sgsave">Kaydet</button></div>`);
  const afterTxt = (i, v) => { if (v == null) return ''; const cur = +i.qty || 0, n = s.mode === 'sayim' ? v : s.mode === 'giris' ? cur + v : cur - v, d = n - cur;
    return `<b>${fmtQ(n)}</b> <span class="sub ${d < 0 ? 'late-txt' : 'ok-txt'}">${d > 0 ? '+' : ''}${fmtQ(d)}</span>`; };
  const bar = () => { q('#sgbar').hidden = !changed.size; q('#sgcnt').textContent = `${changed.size} parça değişecek (${MODES[s.mode][0]})`; };
  const draw = () => {
    const ql = s.q.trim().toLocaleLowerCase('tr');
    const rows = I.filter(i => (s.cat === 'all' || i.category === s.cat) && (!s.bom || (inBom[+s.bom] && inBom[+s.bom].has(i.id)))
      && (!s.only || (s.only === 'crit' ? critical(i) : s.only === 'uncounted' ? !counted.has(i.id) : i.qty == null))
      && (!ql || [i.name, i.code, i.mfr_no, i.location].join(' ').toLocaleLowerCase('tr').includes(ql)))
      .sort((a, b) => (a.code || '').localeCompare(b.code || '', 'tr', { numeric:true }));
    const nc = I.filter(i => counted.has(i.id)).length;
    q('#sgprog').innerHTML = `${MONTHS_LONG[new Date().getMonth()]} sayımı: <b>${nc} / ${I.length}</b> parça sayıldı${nc < I.length ? ` · ${I.length - nc} kaldı` : ' · tamam ✓'}`;
    q('#sgt').innerHTML = rows.length ? `<table><thead><tr><th class="nosort">Kod</th><th class="nosort">Parça</th><th class="nosort">Konum</th><th class="nosort num">Mevcut</th><th class="nosort num">Min</th><th class="nosort num">${MODES[s.mode][1]}</th><th class="nosort num">Sonra</th></tr></thead><tbody>
      ${rows.slice(0, 500).map(i => { const v = changed.get(i.id);
        return `<tr data-i="${i.id}" style="cursor:default"><td class="mono" style="white-space:nowrap">${esc(i.code || '—')}</td><td><b style="font-weight:600">${esc(i.name)}</b>${i.mfr_no ? ` <span class="sub mono">${esc(i.mfr_no)}</span>` : ''}${counted.has(i.id) ? ' <span class="sub ok-txt" title="Bu ay sayıldı">✓ sayıldı</span>' : ''}</td><td class="sub">${esc(i.location || '')}</td>
        <td class="num ${lowStock(i) ? 'late-txt' : ''}">${i.qty == null ? '—' : fmtQ(i.qty)} <span class="sub">${esc(i.unit || '')}</span></td><td class="num sub">${i.min_qty == null ? '' : fmtQ(i.min_qty)}</td>
        <td class="num"><input type="number" step="any" min="0" class="sgin" value="${v ?? ''}" aria-label="${esc(i.name)}"></td><td class="num sgafter">${afterTxt(i, v)}</td></tr>`; }).join('')}</tbody>
      <tfoot><tr class="tfoot"><td colspan="7">${rows.length} kalem</td></tr></tfoot></table>` : '<div class="empty">Kayıt yok.</div>';
    qa('.sgin').forEach(inp => inp.oninput = () => { const tr = inp.closest('tr'), id = +tr.dataset.i, v = num0(inp.value);
      if (v == null) changed.delete(id); else changed.set(id, v); q('.sgafter', tr).innerHTML = afterTxt(itemById(id), v); bar(); });
  };
  draw();
  qa('#sgm button').forEach(b => b.onclick = () => { s.mode = b.dataset.m; qa('#sgm button').forEach(x => x.classList.toggle('on', x === b)); draw(); bar(); });
  qa('#sgc button').forEach(b => b.onclick = () => { s.cat = b.dataset.c; qa('#sgc button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  qa('#sgo button').forEach(b => b.onclick = () => { s.only = b.dataset.o; qa('#sgo button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  q('#sgq').oninput = e => { s.q = e.target.value; draw(); };
  q('#sgb').onchange = e => { s.bom = e.target.value; draw(); };
  q('#sgclr').onclick = () => { changed.clear(); draw(); bar(); };
  q('#sgsave').onclick = async () => { const b = q('#sgsave'); b.disabled = true; b.textContent = 'Kaydediliyor…'; let n = 0, err = null;
    const note = q('#sgn').value.trim() || null, reason = { sayim:'sayim', giris:'alim', cikis:'uretim' }[s.mode];
    for (const [id, v] of changed) { const args = { p_item:id, p_reason:reason, p_note:note };
      if (s.mode === 'sayim') args.p_new_qty = v; else args.p_delta = s.mode === 'giris' ? v : -v;
      const { error } = await sb.rpc('stock_move', args); if (error) { err = error; break; } n++; }
    S.stockLoaded = false;
    if (err) { [...changed.keys()].slice(0, n).forEach(k => changed.delete(k)); b.disabled = false; b.textContent = 'Kaydet';
      toast(`${n} parça kaydedildi; kalanlar kaydedilemedi: ${dbErr(err)}`, true); await loadStock(true); draw(); bar(); return; }
    toast(`${n} parça güncellendi`); viewStockUpdate(g); };
  if (arg === 'eksik') history.replaceState(null, '', '#/' + G.upd);
}

// görseli tarayıcıda küçült (en fazla 480 px, webp)
function shrinkImage(file){
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => { const k = Math.min(1, 480 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/webp', 0.75); URL.revokeObjectURL(img.src); res({ mime:url.slice(5, url.indexOf(';')), data:url.slice(url.indexOf(',') + 1) }); };
    img.onerror = () => rej(new Error('Görsel okunamadı')); img.src = URL.createObjectURL(file); });
}

// ---------------------------------------------------------------- BOM LİSTELERİ
// üretilebilir adet: her satır için floor(stok / ürün başı); seçenekli gruplarda en iyisi; en düşük satır belirler
function bomBuildable(lines){
  const by = {}; const solo = [];
  lines.forEach(l => { if (l.stock_qty == null) return; const c = Math.floor((+l.stock_qty) / (+l.qty_per || 1)); if (l.alt_group) by[l.alt_group] = Math.max(by[l.alt_group] ?? -1, c); else solo.push(c); });
  const all = [...solo, ...Object.values(by)];
  return all.length ? Math.max(0, Math.min(...all)) : null;
}
async function viewBomList(sec){
  await loadStock(true);
  const L = (await sb.from('v_bom_lines').select('bom_id,qty_per,stock_qty,alt_group,price,item_id,pcb_board_id').range(0, 9999)).data || [];
  const by = {}; L.forEach(l => (by[l.bom_id] = by[l.bom_id] || []).push(l));
  const card = b => { const ls = by[b.id] || [], mx = bomBuildable(ls), cost = ls.reduce((a, l) => a + (+l.price || 0) * (+l.qty_per || 0), 0), unk = ls.filter(l => l.stock_qty == null).length;
    const deal = b.deal_id ? S.deals.find(d => d.id === b.deal_id) : null;
    return `<a class="bomcard${mx === 0 ? ' is-zero' : ''}" href="#/bom/${b.id}"><b>${esc(b.name)}</b>
      <span class="sub">${ls.length} kalem${b.kind === 'product' && b.meta && b.meta.hazir_urun_stok != null ? ` · hazır ürün ${fmtQ(b.meta.hazir_urun_stok)}` : ''}${deal ? ' · ' + esc(refNo(deal)) : ''}${b.status !== 'aktif' ? ' · ' + esc(b.status) : ''}</span>
      <span class="bc-row"><span>Üretilebilir</span><b class="${mx === 0 ? 'late-txt' : ''}">${mx == null ? '—' : fmtQ(mx)}</b></span>
      ${cost ? `<span class="bc-row"><span>Kalem maliyeti</span><b>${fmtTRY(cost)}</b></span>` : ''}${unk ? `<span class="sub">${unk} kalemde stok girilmemiş</span>` : ''}</a>`; };
  const group = (k, title, hint) => { const bs = S.boms.filter(b => b.kind === k); return `<section class="mt"><div class="board-head"><h2 style="margin:0">${title} <span class="tcount">${bs.length}</span></h2>${hint || ''}</div>
    ${bs.length ? `<div class="bomgrid">${bs.map(card).join('')}</div>` : '<p class="note">Henüz yok.</p>'}</section>`; };
  shell(sec === 'proje' ? 'bom-proje' : 'bom', `<div class="pagehead"><div><h1>BOM listesi</h1><p class="lede">Ürünlerin, projelerin ve PCB'lerin parça listeleri. "Üretilebilir" = mevcut stokla kaç adet çıkar.</p></div>
    ${canStock() ? '<a class="btn primary" href="#/bom-yeni">Yeni proje BOM\'u</a>' : ''}</div>
    ${sec === 'proje' ? group('project', 'Proje BOM\'ları') + group('product', 'Ürünler') : group('product', 'Ürünler') + group('project', 'Proje BOM\'ları', canStock() ? '<a href="#/bom-yeni">+ Yeni proje BOM\'u</a>' : '')}
    ${group('pcb', 'PCB dizgi listeleri', '<a href="#/pcb">PCB kart stokları →</a>')}`);
}

const bomTabs = {};
async function viewBom(id){
  await loadStock();
  const [br, lr] = await Promise.all([sb.from('boms').select('*').eq('id', id).maybeSingle(), sb.from('v_bom_lines').select('*').eq('bom_id', id).order('section').order('sort')]);
  const b = br.data; if (!b) return shell('bom', `<h1>BOM bulunamadı</h1><p><a href="#/bom">BOM listesine dön</a></p>`);
  const L = lr.data || [], ed = canStock();
  let N = +b.qty_to_build || 1;
  const deal = b.deal_id ? S.deals.find(d => d.id === b.deal_id) : null;
  const mx = bomBuildable(L);
  const meta = b.meta || {};
  const navActive = b.kind === 'product' ? 'bom-p' + b.id : b.kind === 'project' ? 'bom-proje' : 'bom';
  const secG = sc => ['elektronik', 'komponent'].includes(sc) ? 'e' : 'm', TABN = { m:'Mekanik', e:'Elektronik' };
  const cntG = { m:L.filter(l => secG(l.section) === 'm').length, e:L.filter(l => secG(l.section) === 'e').length };
  let tab = bomTabs[id] && cntG[bomTabs[id]] ? bomTabs[id] : cntG.m ? 'm' : 'e';
  shell(navActive, `<p><a href="#/bom">← BOM listesi</a></p>
  <div class="pagehead"><div><h1>${esc(b.name)}</h1><p class="lede">${BOM_KIND[b.kind]} BOM'u${b.product_code ? ' · ' + esc(prodName(b.product_code)) : ''}${deal ? ` · sipariş <a href="#/kayit/${deal.id}">${esc(refNo(deal))}</a> ${esc(custName(deal))}` : ''}${b.source ? ' · kaynak: ' + esc(b.source) : ''}</p></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><a class="btn" href="#/alimlar" id="bpur">Alımları</a>${ed && b.kind !== 'pcb' ? '<a class="btn" href="#/bom-yeni/k' + b.id + '">Kopyasıyla proje BOM\'u aç</a>' : ''}${ed && (b.kind === 'project' || can('admin')) ? '<button class="btn danger" id="bdel">Sil</button>' : ''}</div></div>
  <div class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">
    <div class="kpi ${mx === 0 ? 'alert' : ''}"><div class="v">${mx == null ? '—' : fmtQ(mx)}</div><div class="l">Mevcut stokla üretilebilir</div><div class="d">en az stoklu kalem belirler</div></div>
    <div class="kpi"><div class="l">Hesaplanacak adet</div><div class="v"><input type="number" min="1" step="1" id="bn" value="${N}" class="kpi-in"></div><div class="d">eksikler buna göre</div></div>
    <div class="kpi" id="kmiss"></div><div class="kpi" id="kcost"></div></div>
  ${meta.navlun || meta.paketleme ? `<p class="note">Navlun: Avrupa ${esc(meta.navlun?.avrupa || '—')} · Amerika ${esc(meta.navlun?.amerika || '—')} · Asya ${esc(meta.navlun?.asya || '—')}${meta.paketleme ? ' · Paketleme: ' + esc(meta.paketleme) : ''}${meta.kur ? ' · Kur: ' + esc(meta.kur) : ''} <span class="sub">(BOMLIST maliyet sayfasından)</span></p>` : ''}
  ${meta.hazir_urun_stok != null ? `<p class="note">Excel özetine göre hazır ürün stoğu: <b>${fmtQ(meta.hazir_urun_stok)}</b>${meta.uretilmesi_gereken != null ? ` · üretilmesi gereken: <b>${fmtQ(meta.uretilmesi_gereken)}</b>` : ''}</p>` : ''}
  ${cntG.m && cntG.e ? `<div class="toolbar"><div class="seg" id="btab">${['m', 'e'].map(k => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${TABN[k]} <span class="sub">${cntG[k]}</span></button>`).join('')}</div><span class="sub">Mekanik ve elektronik kalemler ayrı listelenir; eksik ve maliyet seçili bölüm için hesaplanır.</span></div>` : ''}
  <div class="tablewrap" id="btbl"></div>
  ${ed ? `<section class="panel mt"><h2>Kalem ekle</h2><form id="blf" class="fs plain" novalidate><div class="row r4">
    <label class="f" style="grid-column:span 2">Parça <span class="hint">stoktan seçin ya da yeni ad yazın</span><input type="text" name="nm" list="itemlist" autocomplete="off"></label>
    <label class="f">Ürün başına adet<input type="number" step="any" name="qp" value="1"></label><label class="f">Bölüm${stkSel('sec', SECT, b.kind === 'pcb' ? 'komponent' : tab === 'e' ? 'elektronik' : 'mekanik')}</label></div>
    <div class="row r2"><label class="f">Birim fiyat <span class="hint">stokta yoksa</span><input type="number" step="any" name="pr"></label><label class="f">Not<input type="text" name="nt"></label></div>
    <p><button class="btn primary">Ekle</button></p></form><datalist id="itemlist">${S.items.map(i => `<option value="${esc(i.name)}">`).join('')}</datalist></section>` : ''}
  <section class="panel mt"><h2>Bilgiler</h2><form id="bmf" class="fs plain" novalidate><fieldset ${ed ? '' : 'disabled'} class="plainfs"><div class="row r2">
    <label class="f">Ad<input type="text" name="name" value="${esc(b.name)}"></label>
    <label class="f">Durum${stkSel('status', { aktif:'Aktif', taslak:'Taslak', tamamlandi:'Tamamlandı', iptal:'İptal' }, b.status)}</label></div>
    ${b.kind === 'project' ? `<label class="f">Bağlı sipariş<select name="deal_id"><option value="">—</option>${S.deals.filter(d => d.order_no).sort((x, y) => (y.order_no || '').localeCompare(x.order_no || '')).map(d => `<option value="${d.id}" ${b.deal_id === d.id ? 'selected' : ''}>${esc(d.order_no)} · ${esc(custName(d))}</option>`).join('')}</select></label>` : ''}
    <label class="f">Not<textarea name="notes" rows="2">${esc(b.notes || '')}</textarea></label>${ed ? '<p><button class="btn">Kaydet</button></p>' : ''}</fieldset></form></section>
  ${ed && b.kind !== 'pcb' ? `<section class="panel mt"><h2>Üretim kaydı</h2><p class="note" style="margin-top:0">Üretilen adet kadar, stok takibi olan kalemler stoktan düşülür (seçenekli gruplarda seçtiğiniz kalem). Geri almak için parçada "Giriş" yapılabilir.</p>
    <form id="bpf" class="fs plain" novalidate><div class="row r2"><label class="f">Üretilen adet<input type="number" min="1" step="1" name="n" value="1"></label><label class="f">Not <span class="hint">ör. sipariş no</span><input type="text" name="note" value="${deal ? esc(refNo(deal)) : ''}"></label></div>
    <div id="altpick"></div><p><button class="btn">Stoktan düş</button></p></form></section>` : ''}`);
  const groups = [...new Set(L.filter(l => l.alt_group).map(l => l.alt_group))];
  const draw = () => {
    const LT = L.filter(l => secG(l.section) === tab);
    const rows = LT.map(l => { const need = (+l.qty_per || 0) * N, short = l.stock_qty == null ? null : Math.max(0, need - (+l.stock_qty));
      return { ...l, need, short: l.alt_group ? (L.filter(x => x.alt_group === l.alt_group).some(x => x.stock_qty != null && +x.stock_qty >= (+x.qty_per || 0) * N) ? 0 : short) : short }; });
    const missing = rows.filter(r => r.short > 0 && !r.alt_group).length + groups.filter(g => rows.some(r => r.alt_group === g) && rows.filter(r => r.alt_group === g).every(r => r.short > 0)).length;
    const cost = rows.reduce((a, r) => a + (r.alt_group ? 0 : (+r.price || 0) * r.need), 0);
    q('#kmiss').className = 'kpi' + (missing ? ' alert' : ''); q('#kmiss').innerHTML = `<div class="v">${missing}</div><div class="l">Eksik kalem${cntG.m && cntG.e ? ' · ' + TABN[tab] : ''} (${N} adet için)</div><div class="d">${missing ? '<a href="#" id="mkpur">Eksikler için alım talebi aç</a>' : 'Stok yeterli'}</div>`;
    q('#kcost').innerHTML = `<div class="v">${fmtTRY(cost)}</div><div class="l">${cntG.m && cntG.e ? TABN[tab] + ' maliyeti' : 'Kalem maliyeti'} (${N} adet)</div><div class="d">seçenekli kalemler hariç</div>`;
    const sec = [...new Set(rows.map(r => r.section))];
    q('#btbl').innerHTML = `<table><thead><tr><th class="nosort">Kalem</th><th class="nosort num">Ürün başı</th><th class="nosort num">Gereken</th><th class="nosort num">Stok</th><th class="nosort num">Eksik</th><th class="nosort num">Birim fiyat</th><th class="nosort">Konum / tedarik</th>${ed ? '<th class="nosort"></th>' : ''}</tr></thead><tbody>
      ${sec.map(sname => `<tr class="secrow"><td colspan="${ed ? 8 : 7}">${SECT[sname] || sname}</td></tr>` + rows.filter(r => r.section === sname).map(r => `<tr data-lid="${r.id}">
        <td>${r.item_id ? `<a href="#/stok/${r.item_id}">${esc(r.name)}</a>` : r.pcb_board_id ? `<a href="#/pcb">${esc(r.name)}</a> <span class="sub">PCB</span>` : esc(r.name || '')}${r.alt_group ? `<div class="sub">seçenek: ${esc(r.alt_group)}</div>` : ''}${r.notes ? `<div class="sub opt">${esc(r.notes)}</div>` : ''}</td>
        <td class="num">${ed ? `<input type="number" step="any" class="qpin" value="${r.qty_per}" aria-label="Ürün başına adet">` : fmtQ(r.qty_per)}</td><td class="num">${fmtQ(r.need)}</td>
        <td class="num">${r.stock_qty == null ? '<span class="sub">takip yok</span>' : fmtQ(r.stock_qty)}</td>
        <td class="num">${r.short == null ? '' : r.short > 0 ? `<b class="late-txt">${fmtQ(r.short)}</b>` : '<span class="ok-txt">✓</span>'}</td>
        <td class="num">${fmtMoney(r.price)}</td><td><span class="sub">${esc([r.location, r.supplier_text].filter(Boolean).join(' · '))}</span></td>
        ${ed ? '<td><button class="btn sm ldel" title="Kalemi çıkar" aria-label="Kalemi çıkar">Çıkar</button></td>' : ''}</tr>`).join('')).join('')}</tbody>
      <tfoot><tr class="tfoot"><td colspan="${ed ? 8 : 7}">${LT.length} kalem${cntG.m && cntG.e ? ' · ' + TABN[tab] : ''}</td></tr></tfoot></table>`;
    qa('.qpin').forEach(inp => inp.onchange = async () => { const lid = +inp.closest('tr').dataset.lid, v = num0(inp.value);
      const { error } = await sb.from('bom_lines').update({ qty_per:v || 1 }).eq('id', lid); if (error) return toast(dbErr(error), true); const l = L.find(x => x.id === lid); l.qty_per = v || 1; toast('Güncellendi'); draw(); });
    qa('.ldel').forEach(btn => btn.onclick = async () => { const lid = +btn.closest('tr').dataset.lid;
      if (!btn.dataset.ok) { btn.dataset.ok = 1; btn.textContent = 'Emin?'; return; }
      const { error } = await sb.from('bom_lines').delete().eq('id', lid); if (error) return toast(dbErr(error), true); L.splice(L.findIndex(x => x.id === lid), 1); toast('Çıkarıldı'); draw(); });
    q('#mkpur') && (q('#mkpur').onclick = async e => { e.preventDefault();
      const miss = rows.filter(r => r.short > 0 && (!r.alt_group || !rows.filter(x => x.alt_group === r.alt_group).some(x => !x.short)));
      const pick = miss.filter((r, i, a) => !r.alt_group || a.findIndex(x => x.alt_group === r.alt_group) === i);
      if (!confirmTwice(e.target, `${pick.length} kalem için talep açılacak — tekrar tıkla`)) return;
      const rowsIns = pick.map(r => ({ item_name:r.name, item_id:r.item_id, qty:r.short, unit_price:r.price, unit:secG(r.section) === 'm' ? 'Mekanik' : 'Elektronik', area:'Üretim',
        project:b.name + (deal ? ' · ' + refNo(deal) : ''), deal_id:b.deal_id, bom_id:b.id, status:'talep', requester:S.profile.id, requester_name:S.profile.full_name || S.profile.email, note:`BOM eksiği (${N} adet için)` }));
      const { error } = await sb.from('purchases').insert(rowsIns); if (error) return toast(dbErr(error), true);
      toast(`${rowsIns.length} alım talebi açıldı`); location.hash = '#/alimlar'; });
  };
  draw();
  qa('#btab button').forEach(bt => bt.onclick = () => { tab = bomTabs[id] = bt.dataset.t; qa('#btab button').forEach(x => x.classList.toggle('on', x === bt)); if (q('#blf')) q('#blf').sec.value = b.kind === 'pcb' ? 'komponent' : tab === 'e' ? 'elektronik' : 'mekanik'; draw(); });
  q('#bpur').onclick = () => { purState.bom = String(id); purState.tab = 'all'; };
  q('#bn').onchange = async e => { N = Math.max(1, Math.round(+e.target.value || 1)); draw(); if (ed) await sb.from('boms').update({ qty_to_build:N }).eq('id', id); };
  q('#bmf').onsubmit = async e => { e.preventDefault(); const f = e.target;
    const o = { name:f.name.value.trim() || b.name, status:f.status.value, notes:f.notes.value.trim() || null }; if (f.deal_id) o.deal_id = f.deal_id.value ? +f.deal_id.value : null;
    const { error } = await sb.from('boms').update(o).eq('id', id); if (error) return toast(dbErr(error), true); toast('Kaydedildi'); S.stockLoaded = false; viewBom(id); };
  q('#blf') && (q('#blf').onsubmit = async e => { e.preventDefault(); const f = e.target, nm = f.nm.value.trim(); if (!nm) return toast('Parça adı girin', true);
    const it = S.items.find(i => i.name.toLocaleLowerCase('tr') === nm.toLocaleLowerCase('tr'));
    const { error } = await sb.from('bom_lines').insert({ bom_id:id, item_id:it ? it.id : null, item_name:it ? null : nm, qty_per:num0(f.qp.value) || 1, section:f.sec.value,
      unit_price:num0(f.pr.value), notes:f.nt.value.trim() || null, sort:L.length });
    if (error) return toast(dbErr(error), true); toast(it ? 'Stoktaki parça eklendi' : 'Yeni kalem eklendi (stok takibi yok)'); viewBom(id); });
  if (q('#altpick')) q('#altpick').innerHTML = groups.map((g, gi) => `<label class="f">${esc(g)}<select name="alt${gi}">${L.filter(l => l.alt_group === g).map(l => `<option value="${l.id}">${esc(l.name)} (stok ${fmtQ(l.stock_qty)})</option>`).join('')}</select></label>`).join('');
  q('#bpf') && (q('#bpf').onsubmit = async e => { e.preventDefault(); const f = e.target, n = Math.round(+f.n.value || 0); if (n < 1) return toast('Adet girin', true);
    const chosen = new Set(groups.map((g, gi) => +f['alt' + gi].value));
    const use = L.filter(l => l.item_id && (!l.alt_group || chosen.has(l.id)));
    if (!confirmTwice(f.querySelector('button'), `${use.length} kalem stoktan düşülecek — tekrar bas`)) return;
    const { data:k, error } = await sb.rpc('bom_consume', { p_bom:id, p_n:n, p_alts:[...chosen], p_note:f.note.value.trim() || null });
    if (error) { toast(dbErr(error) + ' — hiçbir kalem düşülmedi', true); return viewBom(id); }
    toast(`${k} kalem stoktan düşüldü`); S.stockLoaded = false; viewBom(id); });
  q('#bdel') && (q('#bdel').onclick = async () => { if (!confirmTwice(q('#bdel'), 'Emin misin? Tekrar bas')) return;
    const { error } = await sb.from('boms').delete().eq('id', id); if (error) return toast(dbErr(error), true); toast('Silindi'); S.stockLoaded = false; location.hash = '#/bom'; });
}
function confirmTwice(btn, msg){ if (btn.dataset.ok) return true; btn.dataset.ok = 1; btn.dataset.orig = btn.textContent; btn.textContent = msg; setTimeout(() => { if (btn.isConnected) { delete btn.dataset.ok; btn.textContent = btn.dataset.orig; } }, 6000); return false; }

async function viewBomNew(a){
  if (!canStock()) return viewBomList();
  await loadStock();
  const from = /^k(\d+)$/.exec(a || '') ? +a.slice(1) : null;
  shell('bom-yeni', `<p><a href="#/bom">← BOM listesi</a></p><h1>Yeni proje BOM'u</h1>
  <p class="lede">Bir müşteri siparişi ya da iç proje için parça listesi. İsterseniz bir ürün BOM'unu kopyalayıp üzerinde değişiklik yapabilirsiniz.</p>
  <form id="nbf" class="fs" style="max-width:760px" novalidate>
    <label class="f">Ad<input type="text" name="name" required placeholder="ör. ODTÜ RÜZGEM Stewart, ACRPO-540 özel BBT"></label>
    <div class="row r2"><label class="f">Başlangıç<select name="from"><option value="">Boş liste</option>${S.boms.filter(b => b.kind !== 'pcb').map(b => `<option value="${b.id}" ${from === b.id ? 'selected' : ''}>${esc(b.name)} kopyası</option>`).join('')}</select></label>
    <label class="f">Kaç adet<input type="number" name="n" min="1" step="1" value="1"></label></div>
    <label class="f">Bağlı sipariş <span class="hint">isteğe bağlı</span><select name="deal_id"><option value="">—</option>${S.deals.filter(d => d.order_no).sort((x, y) => (y.order_no || '').localeCompare(x.order_no || '')).map(d => `<option value="${d.id}">${esc(d.order_no)} · ${esc(custName(d))}</option>`).join('')}</select></label>
    <label class="f">Not<textarea name="notes" rows="2"></textarea></label>
    <p><button class="btn primary">Oluştur</button></p></form>`);
  q('#nbf').onsubmit = async e => { e.preventDefault(); const f = e.target, name = f.name.value.trim(); if (!name) return toast('Ad girin', true);
    const src = f.from.value ? S.boms.find(b => b.id === +f.from.value) : null;
    const { data, error } = await sb.from('boms').insert({ kind:'project', name, deal_id:f.deal_id.value ? +f.deal_id.value : null, qty_to_build:Math.max(1, +f.n.value || 1),
      notes:f.notes.value.trim() || null, product_code:src ? src.product_code : null, meta:src ? { kopya:src.name } : {}, source:src ? 'Kopya: ' + src.name : 'Sitede oluşturuldu' }).select('id').single();
    if (error) return toast(dbErr(error), true);
    if (src) { const ls = (await sb.from('bom_lines').select('item_id,pcb_board_id,item_name,qty_per,unit_price,section,alt_group,notes,sort').eq('bom_id', src.id)).data || [];
      if (ls.length) { const r = await sb.from('bom_lines').insert(ls.map(l => ({ ...l, bom_id:data.id }))); if (r.error) toast(dbErr(r.error), true); } }
    toast('Proje BOM\'u oluşturuldu'); S.stockLoaded = false; location.hash = '#/bom/' + data.id; };
}

// ---------------------------------------------------------------- PCB KARTLARI + TAKİP
async function viewPcb(tab){
  await loadStock(true);
  const t = tab || 'kart', ed = canStock();
  let log = [];
  let vers = [];
  if (t === 'versiyon') vers = (await sb.from('pcb_versions').select('*').order('id')).data || [];
  if (t === 'takip') log = (await fetchAll(() => sb.from('pcb_log').select('*').order('at', { ascending:false, nullsFirst:false }).order('id', { ascending:false }))).data || [];
  const P = S.pcbs, F = [['filled', 'Dolu'], ['working', 'Çalışan'], ['faulty', 'Arızalı'], ['empty', 'Boş'], ['need', 'İhtiyaç'], ['urgent_need', 'Acil ihtiyaç'], ['cost_usd', 'Maliyet $']];
  const FS = [['working', 'Q.C geçti'], ['faulty', 'Arızalı'], ['testing', 'Test edilecek'], ['in_apps', 'Uygulamada'], ['empty', 'Boş / lehimsiz'], ['scrap', 'Hurda'], ['shipped', 'Gönderilen'], ['cost_usd', 'Maliyet $']];
  const cell = (p, k) => ed ? `<input type="number" step="any" class="pcin" data-k="${k}" value="${p[k] ?? ''}" aria-label="${k}">` : fmtQ(p[k]);
  shell('pcb', `<div class="pagehead"><div><h1>PCB kartları</h1><p class="lede">Kart stokları (versiyona göre) ve hangi kartın kime / hangi siparişe verildiğinin kaydı.</p></div></div>
  <div class="seg" style="margin-bottom:14px"><a class="segl ${t === 'kart' ? 'on' : ''}" href="#/pcb">Kart stokları</a><a class="segl ${t === 'takip' ? 'on' : ''}" href="#/pcb/takip">Takip kayıtları</a><a class="segl ${t === 'versiyon' ? 'on' : ''}" href="#/pcb/versiyon">Versiyonlar</a></div>
  ${t === 'versiyon' ? `<p class="note" style="margin-top:0">Bilgi amaçlı: hangi kart versiyonu ne için yapıldı, ne zaman kullanıldı, kim tasarladı.</p>${vers.length ? `<div class="tablewrap"><table><thead><tr><th class="nosort">PCB</th><th class="nosort">Versiyon</th><th class="nosort">Açıklama</th><th class="nosort">Kullanım</th><th class="nosort">Başlangıç → bitiş</th><th class="nosort">Tasarımcı</th></tr></thead><tbody>
    ${vers.map((v, k) => `<tr style="cursor:default"><td>${k === 0 || vers[k - 1].pcb !== v.pcb ? `<b style="font-weight:600">${esc(v.pcb || '')}</b>` : ''}</td><td class="mono">${esc(v.version || '')}</td><td class="sub" style="max-width:520px">${esc(v.description || '')}</td><td>${esc(v.usage || '')}</td><td style="white-space:nowrap">${esc(v.started || '—')} → ${esc(v.ended || '—')}</td><td>${esc(v.designer || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Kayıt yok.</div>'}`
  : t === 'kart' ? `<div class="tablewrap"><table><thead><tr><th class="nosort">PCB</th><th class="nosort">Versiyon</th>${F.map(f => `<th class="nosort num">${f[1]}</th>`).join('')}</tr></thead><tbody>
    ${P.filter(p => p.grp !== 'smd').map(p => `<tr data-pid="${p.id}"><td><b style="font-weight:600">${esc(p.pcb)}</b></td><td class="mono">${esc(p.version)}</td>${F.map(f => `<td class="num ${f[0] === 'faulty' && p.faulty > 0 ? 'late-txt' : ''}">${cell(p, f[0])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <h2 class="mt">SMD kartları</h2><div class="tablewrap"><table><thead><tr><th class="nosort">Kart</th>${FS.map(f => `<th class="nosort num">${f[1]}</th>`).join('')}</tr></thead><tbody>
    ${P.filter(p => p.grp === 'smd').map(p => `<tr data-pid="${p.id}"><td><b style="font-weight:600">${esc(p.version)}</b></td>${FS.map(f => `<td class="num">${cell(p, f[0])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    ${ed ? `<section class="panel mt"><h2>Yeni kart / versiyon</h2><form id="pnf" class="fs plain" novalidate><div class="row r4"><label class="f">PCB adı<input type="text" name="pcb" list="pcbnames"></label><label class="f">Versiyon<input type="text" name="version"></label><label class="f">Grup${stkSel('grp', { ana:'Ana kartlar', smd:'SMD' }, 'ana')}</label><div class="f" style="justify-content:flex-end"><button class="btn primary">Ekle</button></div></div></form><datalist id="pcbnames">${[...new Set(P.map(p => p.pcb))].map(n => `<option value="${esc(n)}">`).join('')}</datalist></section>` : ''}`
  : `<div class="toolbar"><input type="search" id="lq" placeholder="Ara: PCB, kişi, sipariş, not…"></div>
    ${ed ? `<section class="panel"><h2>Yeni kayıt</h2><form id="lnf" class="fs plain" novalidate><div class="row r4"><label class="f">PCB<input type="text" name="pcb" list="pcbnames"></label><label class="f">Versiyon<input type="text" name="version"></label><label class="f">Tarih<input type="date" name="at" value="${today()}"></label><label class="f">Sebep<input type="text" name="reason" list="reasons"></label></div>
      <div class="row r4"><label class="f">Teslim eden<input type="text" name="given_by"></label><label class="f">Teslim alan<input type="text" name="received_by"></label><label class="f" style="grid-column:span 2">Not<input type="text" name="note"></label></div><p><button class="btn primary">Kaydet</button></p></form>
      <datalist id="pcbnames">${[...new Set(P.map(p => p.pcb))].map(n => `<option value="${esc(n)}">`).join('')}</datalist><datalist id="reasons">${['Urun', 'Test', 'Arıza', 'Kalıcı Referans', 'Lehimlendi', 'Ureticiden Teslim Alindi', 'Stok', 'Hurda'].map(n => `<option value="${n}">`).join('')}</datalist></section>` : ''}
    <div class="tablewrap mt" id="ltbl"></div>`}`);
  if (t === 'versiyon') return;
  if (t === 'kart') {
    qa('.pcin').forEach(inp => inp.onchange = async () => { const pid = +inp.closest('tr').dataset.pid;
      const { error } = await sb.from('pcb_boards').update({ [inp.dataset.k]:num0(inp.value) }).eq('id', pid); if (error) return toast(dbErr(error), true); toast('Kaydedildi'); });
    q('#pnf') && (q('#pnf').onsubmit = async e => { e.preventDefault(); const f = e.target; if (!f.pcb.value.trim() || !f.version.value.trim()) return toast('PCB adı ve versiyon girin', true);
      const { error } = await sb.from('pcb_boards').insert({ pcb:f.pcb.value.trim(), version:f.version.value.trim(), grp:f.grp.value }); if (error) return toast(dbErr(error), true); toast('Eklendi'); viewPcb(); });
  } else {
    const draw = ql => { const r = log.filter(l => !ql || [l.no, l.pcb, l.version, l.reason, l.given_by, l.received_by, l.note].join(' ').toLocaleLowerCase('tr').includes(ql));
      q('#ltbl').innerHTML = r.length ? `<table><thead><tr><th class="nosort">No</th><th class="nosort">Tarih</th><th class="nosort">PCB</th><th class="nosort">Sebep</th><th class="nosort">Teslim eden → alan</th><th class="nosort">Not</th></tr></thead><tbody>${r.slice(0, 500).map(l => `<tr><td class="mono">${esc(l.no || '')}</td><td style="white-space:nowrap">${fmtD(l.at)}</td><td>${esc(l.pcb || '')} <span class="sub mono">${esc(l.version || '')}</span></td><td>${esc(l.reason || '')}</td><td>${esc(l.given_by || '—')} → ${esc(l.received_by || '—')}</td><td class="sub">${esc(l.note || '')}</td></tr>`).join('')}</tbody><tfoot><tr class="tfoot"><td colspan="6">${r.length} kayıt${r.length > 500 ? ' (ilk 500)' : ''}</td></tr></tfoot></table>` : '<div class="empty">Kayıt yok.</div>'; };
    draw(''); q('#lq').oninput = e => draw(e.target.value.trim().toLocaleLowerCase('tr'));
    q('#lnf') && (q('#lnf').onsubmit = async e => { e.preventDefault(); const f = e.target, g = n => f[n].value.trim() || null; if (!g('pcb')) return toast('PCB girin', true);
      const last = log.map(l => +l.no || 0).reduce((a, b) => Math.max(a, b), 0);
      const { error } = await sb.from('pcb_log').insert({ no:String(last + 1).padStart(7, '0'), pcb:g('pcb'), version:g('version'), at:g('at'), reason:g('reason'), given_by:g('given_by'), received_by:g('received_by'), note:g('note') });
      if (error) return toast(dbErr(error), true); toast('Kaydedildi'); viewPcb('takip'); });
  }
}

// ---------------------------------------------------------------- MOTOR TESTLERİ
async function viewMotorTests(){
  const R = (await sb.from('motor_tests').select('*').order('id', { ascending:false })).data || [], ed = canStock();
  const res = r => { const t = (r.result || '').toUpperCase(); return t.startsWith('GE') ? 'ok-txt' : t.startsWith('UYA') ? 'amber-txt' : t.startsWith('HATA') ? 'late-txt' : ''; };
  shell('motor-test', `<div class="pagehead"><div><h1>Motor testleri</h1><p class="lede">Aktüatör test sonuçları. Hata kodu: 0 sorunsuz · 1 kullanılabilir · 2 kullanılamaz.</p></div></div>
  <div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">${[['GEÇTİ', 'Geçti', ''], ['UYARI', 'Uyarı', ''], ['HATA', 'Hata', 'alert']].map(([k, l, c]) => { const n = R.filter(r => (r.result || '').toUpperCase().startsWith(k.slice(0, 3))).length; return `<div class="kpi ${n && c ? c : ''}"><div class="v">${n}</div><div class="l">${l}</div></div>`; }).join('')}</div>
  ${ed ? `<section class="panel"><h2>Yeni test</h2><form id="mtf" class="fs plain" novalidate><div class="row r4"><label class="f">Barkod no<input type="text" name="barcode"></label><label class="f">Sipariş no<input type="text" name="order_ref"></label><label class="f">Motor tipi<input type="text" name="motor_type" value="BDC"></label><label class="f">Boy / kuvvet<input type="text" name="sf" placeholder='8" 150 lb'></label></div>
    <div class="row r4"><label class="f">Kapalı pot<input type="number" name="pot_closed"></label><label class="f">Açık pot<input type="number" name="pot_open"></label><label class="f">Hız ileri<input type="number" step="any" name="speed_out"></label><label class="f">Hız geri<input type="number" step="any" name="speed_in"></label></div>
    <div class="row r4"><label class="f">Sonuç${stkSel('result', { 'GEÇTİ':'Geçti', 'UYARI':'Uyarı', 'HATA':'Hata' }, 'GEÇTİ')}</label><label class="f">Hata kodu${stkSel('error_code', { 0:'0 · sorunsuz', 1:'1 · kullanılabilir', 2:'2 · kullanılamaz' }, '0')}</label><label class="f" style="grid-column:span 2">Not<input type="text" name="note"></label></div><p><button class="btn primary">Kaydet</button></p></form></section>` : ''}
  <div class="tablewrap mt"><table><thead><tr><th class="nosort">Barkod</th><th class="nosort">Sipariş</th><th class="nosort">Motor</th><th class="nosort num">Pot (kapalı → açık)</th><th class="nosort num">Hız ileri / geri</th><th class="nosort">Sonuç</th><th class="nosort">Not</th></tr></thead><tbody>
  ${R.map(r => `<tr><td class="mono">${esc(r.barcode || '')}</td><td>${esc(r.order_ref || '—')}</td><td>${esc([r.motor_type, r.stroke, r.force].filter(Boolean).join(' · '))}</td><td class="num">${fmtQ(r.pot_closed)} → ${fmtQ(r.pot_open)}${r.pot_diff != null ? ` <span class="sub">(${fmtQ(r.pot_diff)})</span>` : ''}</td><td class="num">${fmtQ(r.speed_out)} / ${fmtQ(r.speed_in)}</td><td><b class="${res(r)}">${esc(r.result || '—')}</b>${r.error_code != null ? ` <span class="sub">kod ${fmtQ(r.error_code)}</span>` : ''}</td><td class="sub">${esc(r.note || '')}</td></tr>`).join('')}</tbody></table></div>`);
  q('#mtf') && (q('#mtf').onsubmit = async e => { e.preventDefault(); const f = e.target, g = n => f[n].value.trim() || null;
    const [stroke, ...force] = (g('sf') || '').split(' ');
    const o = { barcode:g('barcode'), order_ref:g('order_ref'), motor_type:g('motor_type'), stroke:stroke || null, force:force.join(' ') || null, pot_closed:num0(g('pot_closed')), pot_open:num0(g('pot_open')),
      speed_out:num0(g('speed_out')), speed_in:num0(g('speed_in')), result:f.result.value, error_code:+f.error_code.value, note:g('note'), tested_at:today() };
    if (o.pot_closed != null && o.pot_open != null) o.pot_diff = o.pot_open - o.pot_closed;
    const { error } = await sb.from('motor_tests').insert(o); if (error) return toast(dbErr(error), true); toast('Kaydedildi'); viewMotorTests(); });
}

// ---------------------------------------------------------------- ALIMLAR
const purState = { tab:'open', q:'', unit:'', year:'', who:'', bom:'', urg:'' };
async function viewPurchases(){
  await loadStock();
  const { data, error } = await fetchAll(() => sb.from('purchases').select('*').order('requested_at', { ascending:false, nullsFirst:false }).order('id', { ascending:false }));
  const P = error ? [] : data, s = purState, Y = new Date().getFullYear(), mon = today().slice(0, 7);
  const open = P.filter(p => PUR_OPEN.includes(p.status) && p.kind === 'alim');
  const years = [...new Set(P.map(p => (p.requested_at || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const who = [...new Set(P.map(p => p.requester_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  const sumT = a => a.reduce((x, p) => x + (+p.total || 0), 0);
  const tabs = { open:'Açık talepler', kontrol:'Kontrol listesi', alindi:'Alınanlar', reddedildi:'Reddedilen', arsiv:'Eski / kapanmış', all:'Tümü' };
  const tabOf = p => p.kind === 'kontrol' ? 'kontrol' : PUR_OPEN.includes(p.status) ? 'open' : p.status;
  shell('alimlar', `<div class="pagehead"><div><h1>Alımlar</h1><p class="lede">Atölye ihtiyaç ve alım talepleri. Herkes talep açabilir; durumu Satın alma, Depo / Stok, Üretim, Sipariş ve Yönetici günceller. "Alındı" yapılan ve bir parçaya bağlı talep stoğa otomatik girer.</p></div>
    <a class="btn primary" href="#/alim-yeni">Yeni talep</a></div>
  ${P.length ? '' : `<div class="banner">Henüz alım kaydı yok.${can('admin') ? ' <a href="#/stok-aktar">Excel\'den hazırlanan veriyi içe aktar</a>' : ''}</div>`}
  <div class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">
    <div class="kpi ${open.filter(p => p.urgency === 'acil').length ? 'alert' : ''}"><div class="v">${open.length}</div><div class="l">Açık talep</div><div class="d">${open.filter(p => p.urgency === 'acil').length} acil · ${fmtTRY(sumT(open))}</div></div>
    <div class="kpi"><div class="v">${P.filter(p => p.status === 'proforma').length}</div><div class="l">Proforma bekleyen</div><div class="d">${P.filter(p => p.status === 'eft_bekliyor').length} EFT bekliyor</div></div>
    <div class="kpi"><div class="v">${fmtTRY(sumT(P.filter(p => p.status === 'alindi' && (p.purchased_at || p.requested_at || '').slice(0, 7) === mon)))}</div><div class="l">Bu ay alınan</div><div class="d">KDV dahil</div></div>
    <div class="kpi"><div class="v">${fmtTRY(sumT(P.filter(p => p.status === 'alindi' && (p.requested_at || '').startsWith(String(Y)))))}</div><div class="l">${Y} toplam alım</div><div class="d">${P.filter(p => p.status === 'alindi' && (p.requested_at || '').startsWith(String(Y))).length} kalem</div></div></div>
  <div class="toolbar"><div class="seg" id="ptab">${Object.entries(tabs).map(([k, v]) => `<button data-t="${k}" class="${s.tab === k ? 'on' : ''}">${v} <span class="sub">${k === 'all' ? P.length : P.filter(p => tabOf(p) === k).length}</span></button>`).join('')}</div></div>
  <div class="toolbar"><input type="search" id="pq" placeholder="Ara: ürün, proje, tedarikçi, not…" value="${esc(s.q)}">
    <select id="punit"><option value="">Tüm birimler</option>${PUR_UNIT.map(u => `<option ${s.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select>
    <select id="pyear"><option value="">Tüm yıllar</option>${years.map(y => `<option ${s.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select>
    <select id="pwho"><option value="">Talep eden: herkes</option>${who.map(w => `<option ${s.who === w ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select>
    <select id="pbom"><option value="">Tüm ürün / projeler</option>${bomOpts(+s.bom)}</select>
    <div class="seg" id="purg">${[['', 'Hepsi'], ['acil', 'Acil'], ['normal', 'Acil değil']].map(([k, v]) => `<button data-u="${k}" class="${s.urg === k ? 'on' : ''}">${v}</button>`).join('')}</div></div>
  <div class="tablewrap" id="ptbl"></div>`);
  const draw = () => {
    const ql = s.q.trim().toLocaleLowerCase('tr');
    const rows = P.filter(p => (s.tab === 'all' || tabOf(p) === s.tab) && (!s.unit || p.unit === s.unit) && (!s.bom || p.bom_id === +s.bom) && (!s.urg || (s.urg === 'acil') === (p.urgency === 'acil')) && (!s.year || (p.requested_at || '').startsWith(s.year)) && (!s.who || p.requester_name === s.who)
      && (!ql || [p.item_name, p.project, p.supplier_text, supName(p.supplier_id), p.note, p.purpose, p.requester_name].join(' ').toLocaleLowerCase('tr').includes(ql)));
    q('#ptbl').innerHTML = rows.length ? `<table><thead><tr><th class="nosort">Tarih</th><th class="nosort">Ürün / iş</th><th class="nosort num">Adet</th><th class="nosort num">Tutar</th><th class="nosort">Talep eden</th><th class="nosort">Tedarikçi</th><th class="nosort">Durum</th></tr></thead><tbody>
      ${rows.slice(0, 800).map(p => `<tr data-pid="${p.id}"><td style="white-space:nowrap">${fmtD(p.requested_at)}${PUR_OPEN.includes(p.status) && canPurchase() ? ` <button type="button" class="urgbtn${p.urgency === 'acil' ? ' on' : ''}" title="${p.urgency === 'acil' ? 'Aciliyeti kaldır' : 'Acil olarak işaretle'}">Acil</button>` : p.urgency === 'acil' && PUR_OPEN.includes(p.status) ? ' <span class="pill sp-high">Acil</span>' : ''}</td>
        <td><b style="font-weight:600">${esc(p.item_name)}</b>${p.bom_id && bomById(p.bom_id) ? ` <span class="chip bomchip">${esc(bomById(p.bom_id).name)}</span>` : ''}${p.project ? `<div class="sub">${esc(p.project)}</div>` : ''}${p.note ? `<div class="sub clamp opt">${esc(p.note)}</div>` : ''}</td>
        <td class="num">${p.qty == null ? '—' : fmtQ(p.qty)}</td><td class="num">${fmtMoney(p.total, p.currency)}</td><td>${esc(p.requester_name || '') || '<span class="sub">—</span>'}<div class="sub opt">${esc([p.unit, p.area].filter(Boolean).join(' · '))}</div></td>
        <td>${esc(supName(p.supplier_id) || p.supplier_text || '')}${p.link ? `${supName(p.supplier_id) || p.supplier_text ? '<br>' : ''}<a href="${esc(safeUrl(p.link))}" target="_blank" rel="noopener" class="sub" onclick="event.stopPropagation()">bağlantı ↗</a>` : (supName(p.supplier_id) || p.supplier_text ? '' : '<span class="sub">—</span>')}</td>
        <td>${purPill(p.status)}${p.status === 'alindi' && p.purchased_at ? `<div class="sub">${fmtD(p.purchased_at)}</div>` : ''}</td></tr>`).join('')}</tbody>
      <tfoot><tr class="tfoot"><td colspan="3">${rows.length} kayıt${rows.length > 800 ? ' (ilk 800)' : ''}</td><td class="num">${fmtTRY(sumT(rows))}</td><td colspan="3"></td></tr></tfoot></table>` : '<div class="empty">Kayıt yok.</div>';
    qa('#ptbl tr[data-pid]').forEach(r => r.onclick = () => location.hash = '#/alimlar/' + r.dataset.pid);
    qa('#ptbl .urgbtn').forEach(bt => bt.onclick = async e => { e.stopPropagation(); const pr = P.find(x => x.id === +bt.closest('tr').dataset.pid), nu = pr.urgency === 'acil' ? 'normal' : 'acil';
      const { error } = await sb.from('purchases').update({ urgency:nu }).eq('id', pr.id); if (error) return toast(dbErr(error), true); pr.urgency = nu; toast(nu === 'acil' ? 'Acil olarak işaretlendi' : 'Aciliyet kaldırıldı'); loadPurCount(); draw(); });
  };
  draw();
  qa('#ptab button').forEach(b => b.onclick = () => { s.tab = b.dataset.t; qa('#ptab button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  q('#pq').oninput = e => { s.q = e.target.value; draw(); };
  q('#punit').onchange = e => { s.unit = e.target.value; draw(); };
  q('#pyear').onchange = e => { s.year = e.target.value; draw(); };
  q('#pwho').onchange = e => { s.who = e.target.value; draw(); };
  q('#pbom').onchange = e => { s.bom = e.target.value; draw(); };
  qa('#purg button').forEach(b => b.onclick = () => { s.urg = b.dataset.u; qa('#purg button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
}
const bomById = id => (S.boms || []).find(b => b.id === id);
const bomOpts = sel => [['product', 'Ürünler'], ['project', 'Projeler'], ['pcb', 'PCB kartları']].map(([k, l]) => { const bs = (S.boms || []).filter(b => b.kind === k && (k !== 'project' || b.status !== 'iptal' || b.id === sel));
  return bs.length ? `<optgroup label="${l}">${bs.map(b => `<option value="${b.id}" ${sel === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</optgroup>` : ''; }).join('');

async function viewPurchase(id, preset){
  await loadStock();
  const p = id ? (await sb.from('purchases').select('*').eq('id', id).maybeSingle()).data : { kind:'alim', status:'talep', unit:'Mekanik', area:'Üretim', urgency:'normal', currency:'TRY', requested_at:today(), requester_name:S.profile.full_name || S.profile.email, ...(preset || {}) };
  if (!p) return shell('alimlar', `<h1>Kayıt bulunamadı</h1><p><a href="#/alimlar">Alımlara dön</a></p>`);
  const mine = p.created_by === S.profile.id, ed = canPurchase() || !id || (mine && p.status === 'talep');
  const v = k => esc(p[k] ?? '');
  const tx = (k, l, hint, t) => `<label class="f">${l}${hint ? ` <span class="hint">${hint}</span>` : ''}<input type="${t || 'text'}" ${t === 'number' ? 'step="any"' : ''} name="${k}" value="${v(k)}"></label>`;
  const it = p.item_id ? itemById(p.item_id) : null;
  shell(id ? 'alimlar' : 'alim-yeni', `<p><a href="#/alimlar">← Alımlar</a></p>
  <div class="pagehead"><div><h1>${id ? esc(p.item_name) : 'Yeni alım talebi'}</h1>${id ? `<p class="lede">${esc(p.source || 'Sitede açıldı')}${p.requester_name ? ' · talep eden ' + esc(p.requester_name) : ''}</p>` : '<p class="lede">Talep açıldıktan sonra Satın alma (ya da Depo / Stok, Üretim, Sipariş, Yönetici) onaylayıp siparişini takip eder.</p>'}</div>
    ${id ? `<div style="display:flex;gap:8px;align-items:center">${purPill(p.status)}${(can('admin') || (mine && p.status === 'talep')) ? '<button class="btn danger" id="pdel">Sil</button>' : ''}</div>` : ''}</div>
  ${id && canPurchase() ? `<div class="seg pstat" style="margin-bottom:14px;flex-wrap:wrap">${Object.entries(PUR_ST).map(([k, l]) => `<button data-s="${k}" class="${p.status === k ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
  <div class="grid sup-grid"><div><form id="puf" class="fs" novalidate><fieldset ${ed ? '' : 'disabled'} class="plainfs">
    <div class="row">${'<label class="f">Tür' + stkSel('kind', { alim:'Alım', kontrol:'Kontrol / takip' }, p.kind) + '</label>'}<label class="f">Birim${arrSel('unit', PUR_UNIT, p.unit, '—')}</label><label class="f">Kullanım alanı${arrSel('area', PUR_AREA, p.area, '—')}</label></div>
    <div class="row r2">${tx('item_name', 'Ürün / iş adı')}<label class="f">Stoktaki parça <span class="hint">bağlarsanız "Alındı"da stoğa girer</span><input type="text" name="item_link" list="itemlist2" value="${esc(it ? it.name : '')}" autocomplete="off"></label></div>
    <div class="row">${tx('qty', 'Adet', '', 'number')}${tx('unit_price', 'Birim fiyat (KDV dahil)', '', 'number')}<label class="f">Para birimi${stkSel('currency', { TRY:'TRY', USD:'USD', EUR:'EUR' }, p.currency || 'TRY')}</label></div>
    <div class="row r2"><label class="f">İlgili ürün / proje <span class="hint">raporda bu başlıkta görünür</span><select name="bom_id"><option value="">—</option>${bomOpts(p.bom_id)}</select></label>${tx('project', 'Proje / sipariş notu', 'ör. ACRPO-540, ARGE denemesi')}</div>
    <div class="row r2"><label class="f">Aciliyet${stkSel('urgency', { acil:'Acil', normal:'Acil değil' }, p.urgency || 'normal', '—')}</label>${tx('priority', 'Ne zamana', 'ör. 1 hafta içinde')}</div>
    <div class="row r2"><label class="f">Tedarikçi<select name="supplier_id"><option value="">—</option>${S.suppliers.map(s => `<option value="${s.id}" ${p.supplier_id === s.id ? 'selected' : ''}>${esc(s.name)}${s.blacklisted ? ' ⚠ kara liste' : ''}</option>`).join('')}</select></label>${tx('supplier_text', 'Tedarikçi notu', 'listede yoksa')}</div>
    ${tx('link', 'Bağlantı', 'ürün sayfası, proforma, Drive')}
    <div class="row r2">${tx('requester_name', 'Talep eden')}${tx('requested_at', 'Talep tarihi', '', 'date')}</div>
    ${`<div class="row r2">${canPurchase() ? tx('purchased_at', 'Alım tarihi', '', 'date') : ''}<label class="f">Bağlı sipariş<select name="deal_id"><option value="">—</option>${S.deals.filter(d => d.order_no).sort((x, y) => (y.order_no || '').localeCompare(x.order_no || '')).map(d => `<option value="${d.id}" ${p.deal_id === d.id ? 'selected' : ''}>${esc(d.order_no)} · ${esc(custName(d))}</option>`).join('')}</select></label></div>`}
    <label class="f">Kullanım amacı<input type="text" name="purpose" value="${v('purpose')}"></label>
    <label class="f">Not<textarea name="note" rows="3">${v('note')}</textarea></label>
    ${ed ? `<p><button class="btn primary">${id ? 'Kaydet' : 'Talebi aç'}</button></p>` : '<p class="note">Bu kaydı yalnızca Satın alma, Depo / Stok, Üretim, Sipariş ya da Yönetici değiştirebilir.</p>'}
  </fieldset></form><datalist id="itemlist2">${S.items.map(i => `<option value="${esc(i.name)}">`).join('')}</datalist></div>
  <aside>${id ? `<section class="panel"><h2>Özet</h2><dl class="kv"><dt>Tutar</dt><dd><b>${fmtMoney(p.total, p.currency)}</b></dd><dt>Durum</dt><dd>${purPill(p.status)}</dd>${p.purchased_at ? `<dt>Alındı</dt><dd>${fmtD(p.purchased_at)}</dd>` : ''}${p.received_into_stock ? '<dt>Stok</dt><dd class="ok-txt">Stoğa girdi</dd>' : ''}${p.link ? `<dt>Bağlantı</dt><dd><a href="${esc(safeUrl(p.link))}" target="_blank" rel="noopener">aç ↗</a></dd>` : ''}${p.bom_id && bomById(p.bom_id) ? `<dt>Ürün / proje</dt><dd><a href="#/bom/${p.bom_id}">${esc(bomById(p.bom_id).name)}</a></dd>` : ''}${it ? `<dt>Parça</dt><dd><a href="#/stok/${it.id}">${esc(it.name)}</a> · stok ${fmtQ(it.qty)}</dd>` : ''}</dl></section>` : `<section class="panel"><h2>İpucu</h2><p class="note" style="margin:0">Aynı tedarikçiden birden fazla parça istiyorsanız her parçayı ayrı talep olarak açın; böylece her biri ayrı takip edilir ve stoğa ayrı girer.</p></section>`}</aside></div>`);
  q('#puf').onsubmit = async e => {
    e.preventDefault(); const f = e.target, g = n => f[n] ? f[n].value.trim() : '';
    if (!g('item_name')) return toast('Ürün / iş adı girin', true);
    const link = g('item_link'), li = link ? S.items.find(i => i.name.toLocaleLowerCase('tr') === link.toLocaleLowerCase('tr')) : null;
    if (link && !li) return toast('Stoktaki parça listede yok; listeden seçin ya da boş bırakın', true);
    const o = { kind:f.kind.value, unit:f.unit.value || null, area:f.area.value || null, item_name:g('item_name'), item_id:li ? li.id : null, qty:num0(g('qty')), unit_price:num0(g('unit_price')),
      currency:f.currency.value, bom_id:f.bom_id.value ? +f.bom_id.value : null, project:g('project') || null, urgency:f.urgency.value || null, priority:g('priority') || null, supplier_id:f.supplier_id.value ? +f.supplier_id.value : null,
      supplier_text:g('supplier_text') || null, link:normUrl(g('link')), requester_name:g('requester_name') || null, requested_at:g('requested_at') || null, purpose:g('purpose') || null, note:g('note') || null };
    if (o.qty != null && o.unit_price != null) o.total = Math.round(o.qty * o.unit_price * 100) / 100;
    if (f.purchased_at) o.purchased_at = g('purchased_at') || null;
    if (f.deal_id) o.deal_id = f.deal_id.value ? +f.deal_id.value : null;
    if (!id) { o.requester = S.profile.id; o.status = 'talep'; o.source = 'Sitede açıldı';
      const { data, error } = await sb.from('purchases').insert(o).select('id').single(); if (error) return toast(dbErr(error), true);
      toast('Talep açıldı'); location.hash = '#/alimlar/' + data.id; return; }
    const { error } = await sb.from('purchases').update(o).eq('id', id); if (error) return toast(dbErr(error), true); toast('Kaydedildi'); viewPurchase(id);
  };
  qa('.pstat button').forEach(b => b.onclick = async () => { const { error } = await sb.from('purchases').update({ status:b.dataset.s }).eq('id', id); if (error) return toast(dbErr(error), true);
    toast('Durum: ' + PUR_ST[b.dataset.s]); S.stockLoaded = false; loadPurCount(); viewPurchase(id); });
  q('#pdel') && (q('#pdel').onclick = async () => { if (!confirmTwice(q('#pdel'), 'Emin misin? Tekrar bas')) return;
    const { error } = await sb.from('purchases').delete().eq('id', id); if (error) return toast(dbErr(error), true); toast('Silindi'); location.hash = '#/alimlar'; });
}

// ---------------------------------------------------------------- TEDARİKÇİLER + SİTE HESAPLARI
const SUP_KIND = { tedarikci:'Tedarikçi', kargo:'Kargo / lojistik' };
const ACC_KIND = { tedarikci:'Tedarikçi sitesi', kargo:'Kargo', diger:'Diğer (mail, muhasebe, internet…)' };
const tdState = { kind:'', acc:'', grp:'' };
const SUP_GRP = { elektronik:'Elektronik & komponent', robotik:'Robotik & hobi siteleri', elektrik:'Elektrik & otomasyon', motor:'Motor, sürücü & yurt dışı üretici',
  imalat:'Talaşlı imalat, lazer & yüzey işlem', baglanti:'Bağlantı elemanı, rulman & hammadde', baski:'3D baskı & filament', ambalaj:'Ambalaj & sandık',
  pazar:'Pazar yeri & genel alışveriş', kargo:'Kargo & gümrük', hizmet:'Hizmet & diğer' };
const copyTxt = async (t, btn) => { try { await navigator.clipboard.writeText(t || ''); toast('Kopyalandı'); } catch { toast('Kopyalanamadı', true); } };
// tek hesap satırı (şifre gizli, göster / kopyala)
const accCells = a => `<td><b style="font-weight:600">${esc(a.name)}</b>${a.url ? `<div><a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener" class="sub" onclick="event.stopPropagation()">${esc(a.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40))} ↗</a></div>` : ''}</td>
  <td class="mono">${a.username ? `${esc(a.username)} <button type="button" class="linkbtn acopy" data-v="${esc(a.username)}" title="Kullanıcı adını kopyala">kopyala</button>` : '<span class="sub">—</span>'}</td>
  <td class="mono" style="white-space:nowrap">${a.password ? `<span class="pwv" data-pw="${esc(a.password)}">••••••••</span> <button type="button" class="linkbtn pwshow">göster</button> · <button type="button" class="linkbtn acopy" data-v="${esc(a.password)}">kopyala</button>` : '<span class="sub">—</span>'}</td>`;
const bindAccCells = root => {
  qa('.acopy', root).forEach(b => b.onclick = e => { e.stopPropagation(); copyTxt(b.dataset.v); });
  qa('.pwshow', root).forEach(b => b.onclick = e => { e.stopPropagation(); const s = b.previousElementSibling, on = b.textContent === 'göster';
    s.textContent = on ? s.dataset.pw : '••••••••'; b.textContent = on ? 'gizle' : 'göster'; });
};
const accForm = (a, sups) => `<form id="accf" class="fs plain" novalidate><input type="hidden" name="id" value="${a.id || ''}">
  <div class="row r4"><label class="f">Site / hesap adı<input type="text" name="name" value="${esc(a.name || '')}"></label><label class="f">Tür${stkSel('kind', ACC_KIND, a.kind || 'tedarikci')}</label>
    <label class="f" style="grid-column:span 2">Bağlı tedarikçi<select name="supplier_id"><option value="">—</option>${sups.map(s => `<option value="${s.id}" ${a.supplier_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label></div>
  <div class="row r4"><label class="f" style="grid-column:span 2">Adres<input type="text" name="url" value="${esc(a.url || '')}" placeholder="https://"></label><label class="f">Kullanıcı / e-posta<input type="text" name="username" value="${esc(a.username || '')}" autocomplete="off"></label><label class="f">Şifre<input type="text" name="password" value="${esc(a.password || '')}" autocomplete="off"></label></div>
  <div class="row r2"><label class="f">Telefon<input type="text" name="phone" value="${esc(a.phone || '')}"></label><label class="f">Not<input type="text" name="note" value="${esc(a.note || '')}"></label></div>
  <p style="display:flex;gap:8px"><button class="btn primary">${a.id ? 'Kaydet' : 'Hesabı ekle'}</button><button type="button" class="btn" id="acccancel">Vazgeç</button>${a.id ? '<button type="button" class="btn danger" id="accdel">Sil</button>' : ''}</p>
  <p class="note" style="margin:0">Kimlik numarası, kart ya da banka bilgisi buraya yazılmaz.</p></form>`;
const bindAccForm = (box, a, done) => {
  const f = q('#accf', box); if (!f) return;
  q('#acccancel', box).onclick = () => { box.innerHTML = ''; };
  f.onsubmit = async e => { e.preventDefault(); const g = n => f[n].value.trim() || null; if (!g('name')) return toast('Site adı girin', true);
    const o = { name:g('name'), kind:f.kind.value, supplier_id:f.supplier_id.value ? +f.supplier_id.value : null, url:normUrl(g('url')), username:g('username'), password:g('password'), phone:g('phone'), note:g('note'), updated_by:S.profile.id, updated_at:new Date().toISOString() };
    const r = a.id ? await sb.from('supplier_accounts').update(o).eq('id', a.id) : await sb.from('supplier_accounts').insert(o);
    if (r.error) return toast(dbErr(r.error), true); toast('Hesap kaydedildi'); done(); };
  q('#accdel', box) && (q('#accdel', box).onclick = async () => { if (!confirmTwice(q('#accdel', box), 'Emin misin? Tekrar bas')) return;
    const { error } = await sb.from('supplier_accounts').delete().eq('id', a.id); if (error) return toast(dbErr(error), true); toast('Hesap silindi'); done(); });
};

async function viewSuppliers(id){
  const ed = canPurchase();
  const [sr, ar] = await Promise.all([sb.from('suppliers').select('*').order('name'), ed ? sb.from('supplier_accounts').select('*').order('name') : Promise.resolve({ data:[] })]);
  const all = sr.data || [], ACC = ar.error ? [] : (ar.data || []);
  if (id === 'hesaplar') return viewAccounts(all, ACC);
  if (id) {
    const s = id === 'yeni' ? { name:'', kind:'tedarikci' } : all.find(x => x.id === +id);
    if (!s) return shell('tedarikciler', '<h1>Tedarikçi bulunamadı</h1>');
    const pu = s.id ? ((await sb.from('purchases').select('id,requested_at,item_name,qty,total,status').or(`supplier_id.eq.${s.id},supplier_text.ilike.%${s.name.split(' ')[0].replace(/[,%()]/g, '')}%`).order('requested_at', { ascending:false }).limit(50)).data || []) : [];
    const acc = ACC.filter(a => a.supplier_id === s.id);
    const ta = (k, l, r) => `<label class="f">${l}<textarea name="${k}" rows="${r || 2}">${esc(s[k] || '')}</textarea></label>`;
    shell('tedarikciler', `<p><a href="#/tedarikciler">← Tedarikçiler</a></p><div class="pagehead"><div><h1>${s.id ? esc(s.name) : 'Yeni tedarikçi'}</h1>${s.grp ? `<p class="lede">${esc(SUP_GRP[s.grp] || s.grp)}</p>` : ''}${s.blacklisted ? `<p class="lede late-txt">Kara listede: ${esc(s.blacklist_reason || '')}</p>` : ''}</div>${s.id && can('admin') ? '<button class="btn danger" id="sdel">Sil</button>' : ''}</div>
    <div class="grid sup-grid"><div><form id="suf" class="fs" novalidate><fieldset ${ed ? '' : 'disabled'} class="plainfs">
      <div class="row r2"><label class="f">Firma adı<input type="text" name="name" value="${esc(s.name || '')}"></label><label class="f">Tür${stkSel('kind', SUP_KIND, s.kind || 'tedarikci')}</label></div>
      <label class="f">Grup${stkSel('grp', SUP_GRP, s.grp || '', '—')}</label>
      ${ta('contacts', 'İletişim (kişi · telefon)', 3)}<div class="row r2">${ta('emails', 'E-posta')}${ta('websites', 'Web sitesi')}</div>
      <div class="row r2">${ta('parts', 'Alınan parçalar')}${ta('products', 'Hangi ürün')}</div>${ta('notes', 'Not', 3)}
      <div class="row r2"><label class="f">Kara liste${stkSel('blacklisted', { false:'Hayır', true:'Evet' }, String(!!s.blacklisted))}</label><label class="f">Sebep<input type="text" name="blacklist_reason" value="${esc(s.blacklist_reason || '')}"></label></div>
      ${ed ? '<p><button class="btn primary">Kaydet</button></p>' : ''}</fieldset></form>
      ${s.id && ed ? `<section class="panel mt"><div class="board-head"><h2 style="margin:0">Site hesabı <span class="tcount">${acc.length}</span></h2><button class="btn sm" id="accadd">Hesap ekle</button></div>
        <div id="accbox"></div>${acc.length ? `<div class="tablewrap"><table><thead><tr><th class="nosort">Site</th><th class="nosort">Kullanıcı</th><th class="nosort">Şifre</th><th class="nosort">Telefon / not</th><th class="nosort"></th></tr></thead><tbody>${acc.map(a => `<tr data-aid="${a.id}" style="cursor:default">${accCells(a)}<td class="sub">${esc([a.phone, a.note].filter(Boolean).join(' · '))}</td><td><button class="btn sm aedit">Düzenle</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="note">Bu firmaya kayıtlı site hesabı yok.</p>'}
        <p class="note">Hesapları yalnızca Satın alma, Depo / Stok, Üretim, Sipariş ve Yönetici görür.</p></section>
      <section class="panel mt"><h2>Başka bir kayıtla birleştir</h2><p class="note" style="margin-top:0">Aynı firma iki kez kayıtlıysa seçtiğiniz kayıt bu firmaya katılır: alımları, parçaları ve site hesapları buraya taşınır; iletişim, e-posta, web, parça ve notlar eklenir, hiçbir bilgi silinmez. Seçilen kayıt sonra kaldırılır.</p>
        <div class="row r2"><label class="f">Bu firmaya katılacak kayıt<select id="smerge"><option value="">—</option>${all.filter(x => x.id !== s.id).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label><div style="align-self:end"><button class="btn" id="smergeb">Birleştir</button></div></div></section>` : ''}</div>
    <aside><section class="panel"><h2>Alımlar</h2>${pu.length ? `<ul class="sugg">${pu.map(p => `<li><a href="#/alimlar/${p.id}">${esc(p.item_name)}</a> · ${fmtD(p.requested_at)} · ${fmtMoney(p.total)}</li>`).join('')}</ul>` : '<p class="note">Kayıt yok.</p>'}</section></aside></div>`);
    q('#suf').onsubmit = async e => { e.preventDefault(); const f = e.target, g = n => f[n].value.trim() || null; if (!g('name')) return toast('Firma adı girin', true);
      const o = { name:g('name'), kind:f.kind.value, grp:f.grp.value || null, contacts:g('contacts'), emails:g('emails'), websites:g('websites'), parts:g('parts'), products:g('products'), notes:g('notes'), blacklisted:f.blacklisted.value === 'true', blacklist_reason:g('blacklist_reason') };
      const r = s.id ? await sb.from('suppliers').update(o).eq('id', s.id) : await sb.from('suppliers').insert(o).select('id').single();
      if (r.error) return toast(dbErr(r.error), true); toast('Kaydedildi'); S.stockLoaded = false; if (s.id) viewSuppliers(s.id); else location.hash = '#/tedarikciler/' + r.data.id; };
    q('#sdel') && (q('#sdel').onclick = async () => { if (!confirmTwice(q('#sdel'), 'Emin misin? Tekrar bas')) return; const { error } = await sb.from('suppliers').delete().eq('id', s.id); if (error) return toast(dbErr(error), true); toast('Silindi'); location.hash = '#/tedarikciler'; });
    q('#smergeb') && (q('#smergeb').onclick = async e => { const v = +q('#smerge').value; if (!v) return toast('Birleştirilecek kaydı seçin', true);
      if (!confirmTwice(e.target, `"${all.find(x => x.id === v).name}" buraya katılacak — tekrar bas`)) return;
      const { error } = await sb.rpc('supplier_merge', { p_keep:s.id, p_drop:v }); if (error) return toast(dbErr(error), true); toast('Birleştirildi'); S.stockLoaded = false; viewSuppliers(s.id); });
    if (q('#accbox')) { const box = q('#accbox'), open = a => { box.innerHTML = accForm(a, all); bindAccForm(box, a, () => viewSuppliers(s.id)); box.scrollIntoView({ block:'nearest' }); };
      bindAccCells(document); q('#accadd').onclick = () => open({ supplier_id:s.id, kind:s.kind === 'kargo' ? 'kargo' : 'tedarikci', name:s.name, url:(s.websites || '').startsWith('http') ? s.websites : '' });
      qa('.aedit').forEach(b => b.onclick = () => open(ACC.find(a => a.id === +b.closest('tr').dataset.aid))); }
    return;
  }
  const st = tdState;
  shell('tedarikciler', `<div class="pagehead"><div><h1>Tedarikçiler</h1><p class="lede">Firma, iletişim ve alınan parçalar. Kara listedekiler kırmızı.${ed ? ' Sitelerin giriş bilgileri "Site hesapları"nda.' : ''}</p></div><div style="display:flex;gap:8px">${ed ? '<a class="btn" href="#/tedarikciler/hesaplar">Site hesapları</a><a class="btn primary" href="#/tedarikciler/yeni">Yeni tedarikçi</a>' : ''}</div></div>
  <div class="toolbar"><div class="seg wrap" id="tgrp">${[['', 'Hepsi'], ...Object.entries(SUP_GRP), ['_', 'Grupsuz']].filter(([k]) => k !== '_' || all.some(s => !s.grp)).map(([k, v]) => `<button data-g="${k}" class="${st.grp === k ? 'on' : ''}">${v} <span class="sub">${k === '' ? all.length : all.filter(s => (s.grp || '_') === k).length}</span></button>`).join('')}</div></div>
  <div class="toolbar"><input type="search" id="tq" placeholder="Ara: firma, kişi, parça, site…"></div><div class="tablewrap" id="ttbl"></div>`);
  const nAcc = sid => ACC.filter(a => a.supplier_id === sid).length;
  const draw = () => { const ql = (q('#tq').value || '').trim().toLocaleLowerCase('tr');
    const r = all.filter(s => (!st.grp || (s.grp || '_') === st.grp) && (!ql || [s.name, s.contacts, s.parts, s.products, s.emails, s.websites, s.notes].join(' ').toLocaleLowerCase('tr').includes(ql)));
    q('#ttbl').innerHTML = r.length ? `<table><thead><tr><th class="nosort">Firma</th><th class="nosort">İletişim</th><th class="nosort">Alınan parçalar</th><th class="nosort">E-posta / web</th>${ed ? '<th class="nosort">Hesap</th>' : ''}</tr></thead><tbody>${[...Object.keys(SUP_GRP), '_'].map(gk => { const rs = r.filter(s => (s.grp || '_') === gk); return rs.length ? `<tr class="secrow"><td colspan="${ed ? 5 : 4}">${gk === '_' ? 'Grupsuz' : SUP_GRP[gk]} <span class="sub">${rs.length}</span></td></tr>` + rs.map(s => `<tr data-sid="${s.id}"><td><b style="font-weight:600" class="${s.blacklisted ? 'late-txt' : ''}">${esc(s.name)}</b>${s.kind === 'kargo' ? ' <span class="sub">kargo</span>' : ''}${s.blacklisted ? `<div class="sub late-txt">Kara liste: ${esc(s.blacklist_reason || '')}</div>` : ''}</td><td class="sub">${esc(s.contacts || '')}</td><td>${esc(s.parts || '')}${s.products ? `<div class="sub">${esc(s.products)}</div>` : ''}</td><td class="sub">${esc([s.emails, s.websites].filter(Boolean).join(' · '))}</td>${ed ? `<td class="sub">${nAcc(s.id) ? '🔑 ' + nAcc(s.id) : ''}</td>` : ''}</tr>`).join('') : ''; }).join('')}</tbody><tfoot><tr class="tfoot"><td colspan="${ed ? 5 : 4}">${r.length} firma</td></tr></tfoot></table>` : '<div class="empty">Kayıt yok.</div>';
    qa('#ttbl tr[data-sid]').forEach(t => t.onclick = () => location.hash = '#/tedarikciler/' + t.dataset.sid); };
  draw(); q('#tq').oninput = draw;
  qa('#tgrp button').forEach(b => b.onclick = () => { st.grp = b.dataset.g; qa('#tgrp button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
}

function viewAccounts(sups, ACC){
  if (!canPurchase()) return shell('tedarikciler-hesap', '<h1>Erişim yok</h1><p class="lede">Site hesaplarını Satın alma, Depo / Stok, Üretim, Sipariş ve Yönetici rolleri görür.</p>');
  const st = tdState, supN = id => (sups.find(s => s.id === id) || {}).name || '';
  shell('tedarikciler-hesap', `<p><a href="#/tedarikciler">← Tedarikçiler</a></p><div class="pagehead"><div><h1>Site hesapları</h1><p class="lede">Alışveriş yapılan sitelerin, kargo ve diğer hizmetlerin giriş bilgileri. Şifreler gizli gelir; "göster" ya da "kopyala" ile kullanın. Yalnızca Satın alma, Depo / Stok, Üretim, Sipariş ve Yönetici görür.</p></div><button class="btn primary" id="accadd">Yeni hesap</button></div>
  <div id="accbox"></div>
  <div class="toolbar"><div class="seg" id="akind">${[['', 'Hepsi'], ...Object.entries(ACC_KIND).map(([k, v]) => [k, v.split(' (')[0]])].map(([k, v]) => `<button data-k="${k}" class="${st.acc === k ? 'on' : ''}">${v} <span class="sub">${k ? ACC.filter(a => a.kind === k).length : ACC.length}</span></button>`).join('')}</div>
    <input type="search" id="aq" placeholder="Ara: site, kullanıcı, not…"></div><div class="tablewrap" id="atbl"></div>`);
  const box = q('#accbox'), open = a => { box.innerHTML = accForm(a, sups); bindAccForm(box, a, () => viewSuppliers('hesaplar')); box.scrollIntoView({ block:'nearest' }); };
  const draw = () => { const ql = (q('#aq').value || '').trim().toLocaleLowerCase('tr');
    const r = ACC.filter(a => (!st.acc || a.kind === st.acc) && (!ql || [a.name, a.url, a.username, a.note, a.phone, supN(a.supplier_id)].join(' ').toLocaleLowerCase('tr').includes(ql)));
    q('#atbl').innerHTML = r.length ? `<table><thead><tr><th class="nosort">Site</th><th class="nosort">Kullanıcı</th><th class="nosort">Şifre</th><th class="nosort">Firma</th><th class="nosort">Telefon / not</th><th class="nosort"></th></tr></thead><tbody>${r.map(a => `<tr data-aid="${a.id}" style="cursor:default">${accCells(a)}<td>${a.supplier_id ? `<a href="#/tedarikciler/${a.supplier_id}">${esc(supN(a.supplier_id))}</a>` : `<span class="sub">${ACC_KIND[a.kind] ? ACC_KIND[a.kind].split(' (')[0] : ''}</span>`}</td><td class="sub">${esc([a.phone, a.note].filter(Boolean).join(' · '))}</td><td><button class="btn sm aedit">Düzenle</button></td></tr>`).join('')}</tbody><tfoot><tr class="tfoot"><td colspan="6">${r.length} hesap</td></tr></tfoot></table>` : '<div class="empty">Kayıt yok.</div>';
    bindAccCells(q('#atbl')); qa('#atbl .aedit').forEach(b => b.onclick = () => open(ACC.find(a => a.id === +b.closest('tr').dataset.aid))); };
  draw(); q('#aq').oninput = draw;
  q('#accadd').onclick = () => open({ kind:'tedarikci' });
  qa('#akind button').forEach(b => b.onclick = () => { st.acc = b.dataset.k; qa('#akind button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
}

// ---------------------------------------------------------------- AYLIK ALIM RAPORU
const prState = { year:'', month:'' };
async function viewPurchaseReport(){
  await loadStock();
  const { data, error } = await fetchAll(() => sb.from('purchases').select('id,kind,unit,status,item_name,qty,total,currency,purchased_at,requested_at,supplier_id,supplier_text,bom_id,project,urgency').eq('status', 'alindi').order('id'));
  const P = (error ? [] : data || []).filter(p => p.kind !== 'kontrol').map(p => ({ ...p, d:(p.purchased_at && (!p.requested_at || p.purchased_at >= p.requested_at) ? p.purchased_at : p.requested_at || p.purchased_at || '') })).filter(p => p.d);
  const years = [...new Set(P.map(p => p.d.slice(0, 4)))].sort().reverse(), st = prState;
  if (!st.year || !years.includes(st.year)) st.year = years.includes(String(new Date().getFullYear())) ? String(new Date().getFullYear()) : years[0] || String(new Date().getFullYear());
  const Y = P.filter(p => p.d.startsWith(st.year)), sumT = a => a.reduce((x, p) => x + (+p.total || 0), 0);
  const byM = MONTHS.map((_, i) => Y.filter(p => +p.d.slice(5, 7) === i + 1)), mVal = byM.map(sumT), mMax = Math.max(1, ...mVal);
  const units = [...PUR_UNIT, 'Diğer'], unitOf = p => PUR_UNIT.includes(p.unit) ? p.unit : 'Diğer';
  const nowY = String(new Date().getFullYear()), nM = st.year === nowY ? new Date().getMonth() + 1 : 12;
  const prev = P.filter(p => p.d.startsWith(String(+st.year - 1)) && +p.d.slice(5, 7) <= nM);
  const R = st.month ? byM[+st.month - 1] : Y, per = st.month ? MONTHS_LONG[+st.month - 1] + ' ' + st.year : st.year;
  const bomName = id => (S.boms.find(b => b.id === id) || {}).name;
  const grp = (a, key) => { const m = new Map(); a.forEach(p => { const k = key(p) || '—'; const o = m.get(k) || { n:0, t:0 }; o.n++; o.t += +p.total || 0; m.set(k, o); }); return [...m].sort((x, y) => y[1].t - x[1].t); };
  const tbl = (head, rows, tot) => rows.length ? `<table><thead><tr>${head.map((h, i) => `<th class="nosort${i ? ' num' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr style="cursor:default">${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody>${tot ? `<tfoot><tr class="tfoot">${tot.map((c, i) => `<td${i ? ' class="num"' : ''}>${c}</td>`).join('')}</tr></tfoot>` : ''}</table>` : '<div class="empty">Kayıt yok.</div>';
  const top = Math.max(...mVal), topI = mVal.indexOf(top);
  shell('alim-rapor', `<div class="pagehead"><div><h1>Aylık alım raporu</h1><p class="lede">"Alındı" durumundaki alımlar, alım tarihine göre (alım tarihi yoksa ya da talepten önceyse talep tarihine göre). Tutarlar KDV dahil, TL.</p></div><button class="btn" id="pcsv">CSV indir</button></div>
  <div class="toolbar"><label class="f" style="width:120px">Yıl<select id="pry">${years.map(y => `<option ${y === st.year ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
    <label class="f" style="width:150px">Ay<select id="prm"><option value="">Tüm yıl</option>${MONTHS_LONG.map((m, i) => `<option value="${i + 1}" ${+st.month === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select></label></div>
  <div class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">
    <div class="kpi"><div class="l">${st.year} toplam alım</div><div class="v">${fmtTRY(sumT(Y))}</div><div class="d">${Y.length} kalem</div></div>
    <div class="kpi"><div class="l">Aylık ortalama</div><div class="v">${fmtTRY(sumT(Y) / nM)}</div><div class="d">${nM} ay üzerinden</div></div>
    <div class="kpi"><div class="l">En yüksek ay</div><div class="v">${top ? fmtTRY(top) : '—'}</div><div class="d">${top ? MONTHS_LONG[topI] : ''}</div></div>
    <div class="kpi"><div class="l">Geçen yılın aynı dönemi</div><div class="v">${fmtTRY(sumT(prev))}</div><div class="d">${+st.year - 1} · ${nM < 12 ? 'Oca–' + MONTHS[nM - 1] : 'tüm yıl'}${sumT(prev) ? ` · ${sumT(Y) >= sumT(prev) ? '+' : ''}${Math.round((sumT(Y) / sumT(prev) - 1) * 100)}%` : ''}</div></div></div>
  <section class="panel"><h2>${st.year} aylık alım tutarı</h2><p class="note" style="margin-top:-6px">Bir aya tıklayınca aşağıdaki dağılımlar o aya göre gösterilir.</p>
    <div class="bars" style="height:200px">${mVal.map((v, i) => `<button class="m" data-m="${i + 1}" style="border:0;background:${+st.month === i + 1 ? 'var(--brand-soft)' : 'none'};cursor:pointer;border-radius:4px;padding:2px 0" title="${MONTHS_LONG[i]}: ${byM[i].length} kalem, ${fmtTRY(v)}" aria-label="${MONTHS_LONG[i]}: ${fmtTRY(v)}"><span style="font-size:11px;color:var(--muted)">${v ? Math.round(v / 1000) + 'K' : ''}</span><div class="pair"><div class="b" style="height:${v / mMax * 100}%;width:60%;max-width:28px"></div></div><div class="lbl">${MONTHS[i]}</div></button>`).join('')}</div></section>
  <section class="mt"><h2>Aylara ve birime göre — ${st.year}</h2><div class="tablewrap">${tbl(['Ay', ...units, 'Toplam', 'Kalem'],
    byM.map((a, i) => [`<a href="#" data-m2="${i + 1}">${MONTHS_LONG[i]}</a>`, ...units.map(u => { const t = sumT(a.filter(p => unitOf(p) === u)); return t ? fmtTRY(t) : ''; }), `<b>${sumT(a) ? fmtTRY(sumT(a)) : ''}</b>`, a.length || '']),
    ['Toplam', ...units.map(u => fmtTRY(sumT(Y.filter(p => unitOf(p) === u)))), `<b>${fmtTRY(sumT(Y))}</b>`, Y.length])}</div></section>
  <div class="grid g2 mt"><section class="panel"><h2>Ürün / projeye göre — ${per}</h2><div class="tablewrap">${tbl(['Ürün / proje', 'Kalem', 'Tutar'], grp(R, p => bomName(p.bom_id) || (p.project ? 'Diğer: ' + p.project.slice(0, 40) : 'Belirtilmemiş')).slice(0, 25).map(([k, o]) => [esc(k), o.n, fmtTRY(o.t)]))}</div>
      <p class="note">Ürün / proje, alım talebindeki "İlgili ürün / proje" seçiminden gelir. Eski kayıtlarda proje yazısından otomatik eşleştirildi.</p></section>
    <section class="panel"><h2>Tedarikçi grubuna göre — ${per}</h2><div class="tablewrap">${tbl(['Grup', 'Kalem', 'Tutar'], grp(R, p => { const s = (S.suppliers || []).find(x => x.id === p.supplier_id); return s ? SUP_GRP[s.grp] || 'Grupsuz' : 'Tedarikçi seçilmemiş'; }).map(([k, o]) => [esc(k), o.n, fmtTRY(o.t)]))}</div>
      <h2 class="mt">Tedarikçiye göre — ${per}</h2><div class="tablewrap">${tbl(['Tedarikçi', 'Kalem', 'Tutar'], grp(R, p => supName(p.supplier_id) || p.supplier_text).slice(0, 25).map(([k, o]) => [esc(k), o.n, fmtTRY(o.t)]))}</div></section></div>
  <section class="mt"><h2>En yüksek tutarlı alımlar — ${per}</h2><div class="tablewrap">${tbl(['Ürün / iş', 'Tarih', 'Adet', 'Tutar'], [...R].sort((a, b) => (+b.total || 0) - (+a.total || 0)).slice(0, 20).map(p => [`<a href="#/alimlar/${p.id}">${esc(p.item_name)}</a>${p.project ? `<div class="sub">${esc(p.project)}</div>` : ''}`, fmtD(p.d), p.qty == null ? '—' : fmtQ(p.qty), fmtTRY(p.total)]))}</div></section>`);
  q('#pry').onchange = e => { st.year = e.target.value; st.month = ''; viewPurchaseReport(); };
  q('#prm').onchange = e => { st.month = e.target.value; viewPurchaseReport(); };
  qa('.bars [data-m], [data-m2]').forEach(b => b.onclick = e => { e.preventDefault(); const m = b.dataset.m || b.dataset.m2; st.month = +st.month === +m ? '' : m; viewPurchaseReport(); });
  q('#pcsv').onclick = () => { const head = ['Tarih', 'Ürün / iş', 'Birim', 'Ürün / proje', 'Proje notu', 'Tedarikçi', 'Adet', 'Tutar (TL)'];
    const lines = [head, ...R.map(p => [p.d, p.item_name, p.unit || '', bomName(p.bom_id) || '', p.project || '', supName(p.supplier_id) || p.supplier_text || '', p.qty ?? '', p.total ?? ''])]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines], { type:'text/csv;charset=utf-8' })); a.download = `alimlar-${st.year}${st.month ? '-' + String(st.month).padStart(2, '0') : ''}.csv`; a.click(); };
}

// ---------------------------------------------------------------- İÇE AKTARMA (yönetici, tek sefer)
function viewStockImport(){
  if (!can('admin')) return viewStock('m');
  const empty = !(S.items || []).length;
  shell('stok-aktar', `<h1>${empty ? 'Stok ve alım verisini içe aktar' : 'Stok görsellerini yükle'}</h1>
  <p class="lede">Claude'un Excel'lerden hazırladığı dosyaları seçin. Dosyalar yalnızca tarayıcınızdan veritabanına gönderilir.</p>
  ${empty ? `<section class="fs" style="max-width:640px"><h2>1 · Veri</h2><label class="f">acrome-stok-aktarim.json<input type="file" id="sif" accept=".json,application/json"></label><p id="sii" class="note"></p><button class="btn primary" id="sib" disabled>İçe aktar</button></section>` : ''}
  <section class="fs" style="max-width:640px"><h2>${empty ? '2 · ' : ''}Parça görselleri</h2><p class="note" style="margin-top:0">${empty ? 'Önce veriyi aktarın. ' : ''}MekanikStok'taki görseller (küçültülmüş). Aynı parçanın görseli varsa yenisiyle değişir.</p>
    <label class="f">acrome-stok-gorseller.json<input type="file" id="gif" accept=".json,application/json" ${empty ? 'disabled' : ''}></label><p id="gii" class="note"></p><button class="btn primary" id="gib" disabled>Görselleri yükle</button></section>`);
  let data = null, imgs = null;
  q('#sif') && (q('#sif').onchange = async e => { data = null; q('#sib').disabled = true;
    try { data = JSON.parse(await e.target.files[0].text()); } catch { q('#sii').textContent = 'Dosya okunamadı.'; return; }
    if (data.format !== 'acrome-stok-1') { q('#sii').textContent = 'Bu dosya beklenen biçimde değil.'; data = null; return; }
    q('#sii').innerHTML = `${data.stock_items.length} parça · ${data.boms.length} BOM (${data.bom_lines.length} kalem) · ${data.pcb_boards.length} PCB kartı · ${(data.pcb_versions || []).length} PCB versiyonu · ${data.pcb_log.length} PCB takip kaydı · ${data.motor_tests.length} motor testi · ${data.purchases.length} alım · ${data.suppliers.length} tedarikçi`;
    q('#sib').disabled = false; });
  q('#sib') && (q('#sib').onclick = async () => { const b = q('#sib'); b.disabled = true; b.textContent = 'Aktarılıyor…';
    const { data: res, error } = await sb.rpc('stock_admin_import', { j:data });
    if (error) { b.disabled = false; b.textContent = 'İçe aktar'; return toast(dbErr(error), true); }
    if ((data.pcb_versions || []).length) { const r = await sb.from('pcb_versions').insert(data.pcb_versions.map(({ id, ...v }) => v)); if (r.error) toast('PCB versiyonları: ' + dbErr(r.error), true); }
    S.stockLoaded = false; await loadStock(true); await loadPurCount();
    toast(`Aktarıldı: ${res.stock_items || 0} parça, ${res.purchases || 0} alım. Şimdi görselleri yükleyin.`); viewStockImport(); });
  q('#gif').onchange = async e => { imgs = null; q('#gib').disabled = true;
    try { imgs = JSON.parse(await e.target.files[0].text()); } catch { q('#gii').textContent = 'Dosya okunamadı.'; return; }
    if (imgs.format !== 'acrome-stok-gorsel-1') { q('#gii').textContent = 'Bu dosya beklenen biçimde değil.'; imgs = null; return; }
    q('#gii').textContent = `${imgs.images.length} görsel bulundu.`; q('#gib').disabled = false; };
  q('#gib').onclick = async () => { const b = q('#gib'); b.disabled = true; let n = 0;
    const ids = new Set((S.items || []).map(i => i.id)), list = imgs.images.filter(x => ids.has(x.item_id));
    for (let k = 0; k < list.length; k += 15) {
      b.textContent = `Yükleniyor… ${k}/${list.length}`;
      const { error } = await sb.from('stock_item_images').upsert(list.slice(k, k + 15).map(x => ({ item_id:x.item_id, mime:x.mime, data:x.data, updated_at:new Date().toISOString() })));
      if (error) { toast(dbErr(error), true); break; } n += Math.min(15, list.length - k); }
    b.textContent = 'Görselleri yükle'; toast(`${n} görsel yüklendi`); q('#gii').textContent = `${n} görsel yüklendi.`; };
}

// ---------------------------------------------------------------- ÇALIŞMA PLANI (ortak haftalık tablo; kodda 'att')
const ATT = { x:['Geldi','att-x','Geldi'], G:['Geç geldi','att-g','Geç'], '-':['Gelmedi','att-no','Gelmedi'], 'İ':['İzinli','att-i','İzinli'], R:['Raporlu','att-r','Raporlu'], U:['Uzaktan çalıştı','att-u','Uzaktan'], '/':['Yarım gün','att-h','Yarım'], T:['Tatil / çalışma günü değil','att-c','Tatil'] };
// hücre seçici (açılır kutu yerine renkli liste)
let attPop = null;
const closeAttPop = () => { if (!attPop) return; attPop.remove(); attPop = null; document.removeEventListener('mousedown', attOutside, true); window.removeEventListener('scroll', closeAttPop, true); };
function attOutside(e){ if (attPop && !attPop.contains(e.target) && !e.target.closest('.attcell')) closeAttPop(); }
function openAttPop(btn, cur, onPick){
  closeAttPop();
  const el = document.createElement('div'); el.className = 'attpop'; el.setAttribute('role', 'menu');
  el.innerHTML = Object.entries(ATT).map(([k, v]) => `<button type="button" role="menuitem" data-k="${esc(k)}" class="${cur === k ? 'on' : ''}">${attBadge(k)}<span>${v[0]}</span>${cur === k ? '<span class="ck">✓</span>' : ''}</button>`).join('')
    + (cur ? '<button type="button" role="menuitem" data-k="" class="clr">Hücreyi temizle</button>' : '');
  document.body.appendChild(el); attPop = el;
  const r = btn.getBoundingClientRect(), h = el.offsetHeight, w = el.offsetWidth;
  el.style.top = (r.bottom + 6 + h > innerHeight && r.top - h - 6 > 0 ? r.top - h - 6 : r.bottom + 6) + 'px';
  el.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + 'px';
  const items = [...el.querySelectorAll('button')];
  items.forEach(b => b.onclick = () => { closeAttPop(); onPick(b.dataset.k); btn.focus(); });
  el.onkeydown = e => { const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { closeAttPop(); btn.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); }
    else { const b = items.find(x => x.dataset.k && x.dataset.k.toLocaleLowerCase('tr') === e.key.toLocaleLowerCase('tr')); if (b) { e.preventDefault(); b.click(); } } };
  (el.querySelector('button.on') || items[0]).focus();
  setTimeout(() => { document.addEventListener('mousedown', attOutside, true); window.addEventListener('scroll', closeAttPop, true); });
}
const attCell = c => c && ATT[c] ? `<b>${esc(c)}</b><span>${ATT[c][2]}</span>` : '<span>Seç</span>';
const ATT_DN = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum'];
const mondayOf = d => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return ymd(x); };
const fmtDM = d => d.slice(8, 10) + '.' + d.slice(5, 7);
const attBadge = c => c && ATT[c] ? `<span class="attb ${ATT[c][1]}" title="${ATT[c][0]}">${esc(c)}</span>` : '';
const attMine = people => { const e = (S.profile.email || '').toLowerCase(); const m = (people || []).find(p => (p.email || '').toLowerCase() === e); return m ? m.id : null; };
// Bugün kartı ve menü için: bugünün kayıtları
async function loadAttToday(){
  const [p, d] = await Promise.all([sb.from('att_people').select('id,name,email,active,sort').order('sort').order('name'), sb.from('att_days').select('person_id,code').eq('day', today())]);
  S.att = { people:(p.data || []).filter(x => x.active), all:p.data || [], days:d.data || [] };
  S.attMe = attMine(S.att.all);
}
const attTodayEmpty = () => { const wd = new Date().getDay(); return !!S.att && S.attMe != null && wd >= 1 && wd <= 5 && !S.att.days.some(x => x.person_id === S.attMe); };
const attTodaySection = () => {
  if (!S.att || !S.att.people.length) return null;
  const wd = new Date().getDay(); if (wd < 1 || wd > 5) return null;
  const cOf = id => (S.att.days.find(x => x.person_id === id) || {}).code || '';
  const grp = (codes) => S.att.people.filter(p => codes.includes(cOf(p.id))).map(p => esc(p.name));
  const rows = [];
  if (attTodayEmpty()) rows.push({ href:'#/calisma-plani', main:'<b>Bugünkü çalışma planı hücren boş</b>', sub:'Kendi satırından bugünü seç', meta:'<span class="late-txt">doldur</span>', hot:true });
  const add = (label, codes) => { const n = grp(codes); if (n.length) rows.push({ href:'#/calisma-plani', main:label + ` <span class="sub">${n.length}</span>`, sub:n.join(', '), meta:'', hot:false }); };
  add('İşte', ['x', 'G', '/']); add('Uzaktan', ['U']); add('İzinli / raporlu', ['İ', 'R']); add('Gelmedi', ['-']);
  const empty = S.att.people.filter(p => !cOf(p.id)).map(p => esc(p.name));
  if (empty.length) rows.push({ href:'#/calisma-plani', main:`Henüz doldurmayan <span class="sub">${empty.length}</span>`, sub:empty.join(', '), meta:'', hot:false });
  return { id:'att', title:'Bugün ekip', link:'#/calisma-plani', rows, empty:'Kayıt yok.', alert:attTodayEmpty(), count:S.att.people.filter(p => cOf(p.id)).length, max:6 };
};

const attState = { week:'' };
async function viewAttendance(arg){
  const s = attState, td = today();
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) s.week = mondayOf(arg);
  if (!s.week) s.week = mondayOf(td);
  const days = [0, 1, 2, 3, 4].map(i => addDays(s.week, i));
  const [pr, dr, nr] = await Promise.all([sb.from('att_people').select('*').order('sort').order('name'),
    sb.from('att_days').select('person_id,day,code').gte('day', days[0]).lte('day', days[4]), sb.from('att_week_notes').select('person_id,note').eq('week', s.week)]);
  if (pr.error) return shell('calisma-plani', `<h1>Haftalık çalışma planı</h1><div class="empty">${esc(dbErr(pr.error))}</div>`);
  const all = pr.data || [], people = all.filter(p => p.active), D = dr.data || [], N = nr.data || [];
  const me = attMine(all), adm = can('admin'), canEd = pid => adm || pid === me;
  const code = (pid, d) => (D.find(x => x.person_id === pid && x.day === d) || {}).code || '';
  const note = pid => (N.find(x => x.person_id === pid) || {}).note || '';
  const inWeek = days.includes(td), thisWeek = s.week === mondayOf(td);
  const filled = d => people.filter(p => code(p.id, d)).length;
  shell('calisma-plani', `<div class="pagehead"><div><h1>Haftalık çalışma planı</h1><p class="lede">Ortak tablo: herkes kendi satırını doldurur, herkes tabloyu görür. Hücresi boş kalanlara iş günü 16:00'da e-posta hatırlatması gider.</p></div>
    ${adm ? '<div style="display:flex;gap:8px"><a class="btn" href="#/calisma-raporu">Aylık rapor</a><a class="btn" href="#/calisma-kisiler">Kişiler</a></div>' : ''}</div>
  ${me == null && !adm ? `<div class="banner">E-posta adresin (${esc(S.profile.email || '')}) çalışma planı listesinde yok; yöneticiden eklemesini iste.</div>` : ''}
  ${me != null && inWeek && new Date().getDay() >= 1 && new Date().getDay() <= 5 && !code(me, td) ? '<div class="banner countday"><b>Bugünkü hücren boş.</b> Kendi satırında bugünün hücresinden durumunu seç.</div>' : ''}
  <div class="toolbar"><div class="seg"><button id="awp" type="button">← Önceki</button><button id="awt" type="button" class="${thisWeek ? 'on' : ''}">Bu hafta</button><button id="awn" type="button">Sonraki →</button></div>
    <b>${fmtD(days[0])} – ${fmtD(days[4])}</b></div>
  <div class="tablewrap"><table class="att"><thead><tr><th class="nosort">Ad</th>${days.map((d, i) => `<th class="nosort c${d === td ? ' today' : ''}">${ATT_DN[i]} <span class="sub">${fmtDM(d)}</span><div class="sub">${filled(d)}/${people.length}${adm && filled(d) < people.length ? ` · <button type="button" class="linkbtn atthol" data-d="${d}" title="Boş hücrelere T (tatil) yaz: resmi tatil vb.">tatil</button>` : ''}</div></th>`).join('')}<th class="nosort">Açıklama</th></tr></thead><tbody>
    ${people.map(p => `<tr data-p="${p.id}" class="${p.id === me ? 'mine' : ''}" style="cursor:default"><td><b style="font-weight:600">${esc(p.name)}</b>${p.id === me ? ' <span class="sub">(sen)</span>' : ''}</td>
      ${days.map(d => { const c = code(p.id, d); return `<td class="c${d === td ? ' today' : ''}">${canEd(p.id)
        ? `<button type="button" class="attcell ${c ? ATT[c][1] : 'empty'}" data-d="${d}" aria-haspopup="menu" aria-label="${esc(p.name)} ${fmtD(d)}: ${c ? ATT[c][0] : 'boş'}">${attCell(c)}</button>`
        : attBadge(c) || '<span class="sub">·</span>'}</td>`; }).join('')}
      <td>${canEd(p.id) ? `<input type="text" class="attnote" value="${esc(note(p.id))}" placeholder="Part-time günleri, açıklama…">` : `<span class="sub">${esc(note(p.id))}</span>`}</td></tr>`).join('')}
  </tbody></table></div>
  <p class="note">Kodlar: ${Object.entries(ATT).map(([k, v]) => `${attBadge(k)} ${v[0]}`).join(' · ')} · Boş hücre: henüz girilmedi.</p>`);
  const go = w => { s.week = w; viewAttendance(); };
  q('#awp').onclick = () => go(addDays(s.week, -7)); q('#awn').onclick = () => go(addDays(s.week, 7)); q('#awt').onclick = () => go(mondayOf(td));
  qa('.attcell').forEach(btn => btn.onclick = () => { const pid = +btn.closest('tr').dataset.p, d = btn.dataset.d;
    openAttPop(btn, code(pid, d), async v => { if (v === code(pid, d)) return;
    const r = v ? await sb.from('att_days').upsert({ person_id:pid, day:d, code:v, updated_by:S.profile.id, updated_at:new Date().toISOString() }) : await sb.from('att_days').delete().eq('person_id', pid).eq('day', d);
    if (r.error) { toast(dbErr(r.error), true); return viewAttendance(); }
    btn.className = 'attcell ' + (v ? ATT[v][1] : 'empty'); btn.innerHTML = attCell(v); const x = D.find(y => y.person_id === pid && y.day === d);
    if (v) { if (x) x.code = v; else D.push({ person_id:pid, day:d, code:v }); } else if (x) D.splice(D.indexOf(x), 1);
    if (d === td) { await loadAttToday(); } toast('Kaydedildi'); }); });
  qa('.attnote').forEach(inp => inp.onchange = async () => { const pid = +inp.closest('tr').dataset.p, v = inp.value.trim();
    const r = v ? await sb.from('att_week_notes').upsert({ person_id:pid, week:s.week, note:v, updated_by:S.profile.id, updated_at:new Date().toISOString() }) : await sb.from('att_week_notes').delete().eq('person_id', pid).eq('week', s.week);
    if (r.error) return toast(dbErr(r.error), true); toast('Not kaydedildi'); });
  qa('.atthol').forEach(b => b.onclick = async () => { if (!confirmTwice(b, 'tekrar bas')) return; const d = b.dataset.d;
    const rows = people.filter(p => !code(p.id, d)).map(p => ({ person_id:p.id, day:d, code:'T', updated_by:S.profile.id }));
    const { error } = await sb.from('att_days').upsert(rows); if (error) return toast(dbErr(error), true); toast(`${rows.length} kişiye T (tatil) yazıldı`); if (d === td) await loadAttToday(); viewAttendance(); });
}

// aylık rapor (yöneticiler)
const attRep = { month:'' };
async function viewAttReport(){
  if (!can('admin')) return viewAttendance();
  const s = attRep, td = today(); if (!s.month) s.month = td.slice(0, 7);
  const [y, m] = s.month.split('-').map(Number), first = s.month + '-01', last = ymd(new Date(y, m, 0));
  const [pr, dr] = await Promise.all([sb.from('att_people').select('*').order('sort').order('name'), fetchAll(() => sb.from('att_days').select('person_id,day,code').gte('day', first).lte('day', last).order('day'))]);
  const P = (pr.data || []), D = dr.data || [];
  const wd = []; for (let d = new Date(y, m - 1, 1); d.getMonth() === m - 1; d.setDate(d.getDate() + 1)) if (d.getDay() >= 1 && d.getDay() <= 5) wd.push(ymd(d));
  const upto = wd.filter(d => d <= td);
  const code = (pid, d) => (D.find(x => x.person_id === pid && x.day === d) || {}).code || '';
  const rows = P.filter(p => p.active || D.some(x => x.person_id === p.id)).map(p => {
    const c = k => wd.filter(d => code(p.id, d) === k).length;
    const o = { p, x:c('x'), G:c('G'), U:c('U'), h:c('/'), I:c('İ'), R:c('R'), no:c('-'), C:c('T'), bos:upto.filter(d => !code(p.id, d)).length };
    const base = upto.filter(d => !['T', 'İ', 'R'].includes(code(p.id, d))).length;
    o.work = wd.length - o.C; o.rate = base ? Math.round(((o.x + o.G + o.U + o.h * 0.5) / base) * 100) : null; return o; });
  const tot = k => rows.reduce((a, r) => a + r[k], 0);
  const mName = MONTHS_LONG[m - 1] + ' ' + y;
  shell('calisma-raporu', `<p><a href="#/calisma-plani">← Haftalık çalışma planı</a></p><div class="pagehead"><div><h1>Aylık çalışma raporu</h1><p class="lede">${esc(mName)} · ${wd.length} iş günü (bugüne kadar ${upto.length}). Katılım = (geldi + geç + uzaktan + yarım gün × ½) ÷ (geçen iş günü − izin − rapor − tatil).</p></div>
    <button class="btn" id="arcsv">CSV indir</button></div>
  <div class="toolbar"><label class="f" style="width:180px">Ay<input type="month" id="arm" value="${s.month}"></label></div>
  <div class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">
    <div class="kpi"><div class="l">Geç kalma</div><div class="v">${tot('G')}</div><div class="d">bu ay toplam</div></div>
    <div class="kpi ${tot('no') ? 'alert' : ''}"><div class="l">Gelmedi</div><div class="v">${tot('no')}</div><div class="d">habersiz / izinsiz gün</div></div>
    <div class="kpi"><div class="l">İzinli + raporlu</div><div class="v">${tot('I') + tot('R')}</div><div class="d">gün</div></div>
    <div class="kpi ${tot('bos') ? 'alert' : ''}"><div class="l">Boş hücre</div><div class="v">${tot('bos')}</div><div class="d">doldurulmamış iş günü</div></div></div>
  <section class="mt"><h2>Kişi bazında</h2><div class="tablewrap"><table><thead><tr>${['Ad', 'İş günü', 'Geldi', 'Geç', 'Uzaktan', 'Yarım', 'İzinli', 'Raporlu', 'Gelmedi', 'Boş', 'Katılım'].map((h, i) => `<th class="nosort${i ? ' num' : ''}">${h}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(r => `<tr style="cursor:default"><td><b style="font-weight:600">${esc(r.p.name)}</b>${r.p.active ? '' : ' <span class="sub">(pasif)</span>'}</td><td class="num">${r.work}</td><td class="num">${r.x || ''}</td><td class="num ${r.G ? 'late-txt' : ''}">${r.G || ''}</td><td class="num">${r.U || ''}</td><td class="num">${r.h || ''}</td><td class="num">${r.I || ''}</td><td class="num">${r.R || ''}</td><td class="num ${r.no ? 'late-txt' : ''}">${r.no || ''}</td><td class="num ${r.bos ? 'warn-txt' : ''}">${r.bos || ''}</td><td class="num"><b>${r.rate == null ? '—' : r.rate + '%'}</b></td></tr>`).join('')}
  </tbody></table></div></section>
  <section class="mt"><h2>Gün gün</h2><div class="tablewrap"><table class="att attm"><thead><tr><th class="nosort">Ad</th>${wd.map(d => `<th class="nosort c${d === td ? ' today' : ''}">${+d.slice(8)}<div class="sub">${['P','S','Ç','P','C'][(new Date(d + 'T00:00:00').getDay() + 6) % 7]}</div></th>`).join('')}</tr></thead><tbody>
    ${rows.map(r => `<tr style="cursor:default"><td>${esc(r.p.name)}</td>${wd.map(d => `<td class="c${d === td ? ' today' : ''}">${attBadge(code(r.p.id, d)) || (d <= td ? '<span class="sub">·</span>' : '')}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div></section>`);
  q('#arm').onchange = e => { if (e.target.value) { s.month = e.target.value; viewAttReport(); } };
  q('#arcsv').onclick = () => { const head = ['Ad', ...wd, 'Geldi', 'Geç', 'Uzaktan', 'Yarım', 'İzinli', 'Raporlu', 'Gelmedi', 'Boş', 'Katılım %'];
    const lines = [head, ...rows.map(r => [r.p.name, ...wd.map(d => code(r.p.id, d)), r.x, r.G, r.U, r.h, r.I, r.R, r.no, r.bos, r.rate ?? ''])].map(x => x.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines], { type:'text/csv;charset=utf-8' })); a.download = `calisma-raporu-${s.month}.csv`; a.click(); };
}

// kişiler (yöneticiler)
async function viewAttPeople(){
  if (!can('admin')) return viewAttendance();
  const [pr, ur] = await Promise.all([sb.from('att_people').select('*').order('sort').order('name'), sb.from('profiles').select('email,roles')]);
  const P = pr.data || [], acc = new Map((ur.data || []).map(u => [(u.email || '').toLowerCase(), u]));
  const st = p => { const u = p.email && acc.get(p.email.toLowerCase()); return !p.email ? '<span class="warn-txt">e-posta yok · hatırlatma gitmez</span>' : !u ? '<span class="sub">hesabı yok · tabloyu dolduramaz, hatırlatma gider</span>' : (u.roles || []).length ? '<span class="ok-txt">hesabı var</span>' : '<span class="warn-txt">hesabı var, rolü yok</span>'; };
  shell('calisma-kisiler', `<p><a href="#/calisma-plani">← Haftalık çalışma planı</a></p><div class="pagehead"><div><h1>Çalışma planı kişileri</h1><p class="lede">Tablodaki satırlar. Kişi kendi satırını doldurabilmek için bu e-postayla sitede hesap açmalı; hesabına Kullanıcılar sayfasından en az <b>Personel</b> rolü verilmeli (Personel yalnızca çalışma planını görür). Hatırlatma e-postası bu adrese gider.</p></div></div>
  <div class="tablewrap"><table><thead><tr><th class="nosort">Sıra</th><th class="nosort">Ad</th><th class="nosort">E-posta</th><th class="nosort">Durum</th><th class="nosort">Aktif</th><th class="nosort"></th></tr></thead><tbody>
    ${P.filter(p => p.active).map(p => `<tr data-p="${p.id}" style="cursor:default"><td><input type="number" class="ap-sort" value="${p.sort}" style="width:64px"></td><td><input type="text" class="ap-name" value="${esc(p.name)}"></td><td><input type="email" class="ap-mail" value="${esc(p.email || '')}" placeholder="ad@acrome.net"></td><td>${st(p)}</td>
      <td><input type="checkbox" class="ap-act" ${p.active ? 'checked' : ''}></td><td><button class="btn sm ap-save">Kaydet</button></td></tr>`).join('')}
    <tr style="cursor:default"><td><input type="number" id="apn-sort" value="${(P.filter(p => p.active).reduce((a, p) => Math.max(a, p.sort), 0) || 0) + 1}" style="width:64px"></td><td><input type="text" id="apn-name" placeholder="Yeni kişi adı"></td><td><input type="email" id="apn-mail" placeholder="ad@acrome.net"></td><td></td><td></td><td><button class="btn sm primary" id="apn-add">Ekle</button></td></tr>
  </tbody></table></div>
  <p class="note">Ayrılan birinin "Aktif" işaretini kaldırıp Kaydet'e basın: tablodan, hatırlatmalardan ve bu listeden çıkar; geçmiş daily notları ve raporları korunur.</p>
  ${P.some(p => !p.active) ? `<details class="mt"><summary>Ayrılan / pasif kişiler (${P.filter(p => !p.active).length}) · tabloda ve hatırlatmalarda görünmezler</summary>
    <div class="tablewrap mt"><table><tbody>${P.filter(p => !p.active).map(p => `<tr data-p="${p.id}" style="cursor:default"><td>${esc(p.name)}</td><td class="sub">${esc(p.email || '')}</td>
      <td style="white-space:nowrap;text-align:right"><button class="btn sm ap-on">Aktif yap</button> <button class="btn sm danger ap-del">Sil</button></td></tr>`).join('')}</tbody></table></div>
    <p class="note">Silmek kişinin daily notlarını ve çalışma planı kayıtlarını da kalıcı olarak siler; yalnız gizlemek için pasif bırakmak yeterli.</p></details>` : ''}`);
  qa('.ap-on').forEach(b => b.onclick = async () => { const { error } = await sb.from('att_people').update({ active:true }).eq('id', +b.closest('tr').dataset.p);
    if (error) return toast(dbErr(error), true); toast('Aktif yapıldı'); await loadAttToday(); viewAttPeople(); });
  qa('.ap-del').forEach(b => b.onclick = async () => { const id = +b.closest('tr').dataset.p;
    if (!b.dataset.ok) { const { count } = await sb.from('daily_notes').select('id', { count:'exact', head:true }).eq('person_id', id);
      b.dataset.ok = 1; b.textContent = `${count || 0} daily notuyla birlikte sil? Tekrar bas`; return; }
    const { error } = await sb.from('att_people').delete().eq('id', id); if (error) return toast(dbErr(error), true); toast('Kişi ve kayıtları silindi'); viewAttPeople(); });
  qa('.ap-save').forEach(b => b.onclick = async () => { const tr = b.closest('tr'), name = q('.ap-name', tr).value.trim(); if (!name) return toast('Ad girin', true);
    const { error } = await sb.from('att_people').update({ name, email:q('.ap-mail', tr).value.trim().toLowerCase() || null, sort:+q('.ap-sort', tr).value || 100, active:q('.ap-act', tr).checked }).eq('id', +tr.dataset.p);
    if (error) return toast(dbErr(error), true); toast('Kaydedildi'); await loadAttToday(); viewAttPeople(); });
  q('#apn-add').onclick = async () => { const name = q('#apn-name').value.trim(); if (!name) return toast('Ad girin', true);
    const { error } = await sb.from('att_people').insert({ name, email:q('#apn-mail').value.trim().toLowerCase() || null, sort:+q('#apn-sort').value || 100 });
    if (error) return toast(dbErr(error), true); toast('Eklendi'); await loadAttToday(); viewAttPeople(); };
}

// ---------------------------------------------------------------- DAILY NOTLARI (her gün kısa toplantı notu: yapılanlar / yapılacaklar)
const isWorkday = d => { const g = new Date(d + 'T00:00:00').getDay(); return g >= 1 && g <= 5; };
const workdayStep = (d, n) => { let x = d; do { x = addDays(x, n); } while (!isWorkday(x)); return x; };
const dailyState = { day:'', q:'' };
const dlyTxt = t => esc(t || '').replace(/\n/g, '<br>');
async function viewDaily(arg){
  if (arg && /^k\d+$/.test(arg)) return viewDailyPerson(+arg.slice(1));
  const s = dailyState, td = today();
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) s.day = arg;
  if (!s.day) s.day = isWorkday(td) ? td : workdayStep(td, -1);
  const day = s.day, prev = workdayStep(day, -1), week = mondayOf(day);
  const [pr, nr, pn, gr, ar] = await Promise.all([sb.from('att_people').select('*').order('sort').order('name'),
    sb.from('daily_notes').select('*').eq('day', day), sb.from('daily_notes').select('person_id,todo').eq('day', prev),
    sb.from('daily_goals').select('person_id,goal').eq('week', week), sb.from('att_days').select('person_id,code').eq('day', day)]);
  if (pr.error) return shell('daily', `<h1>Daily notları</h1><div class="empty">${esc(dbErr(pr.error))}</div>`);
  const all = pr.data || [], N = nr.data || [], PN = pn.data || [], G = gr.data || [], A = ar.data || [];
  const people = all.filter(p => p.active || N.some(n => n.person_id === p.id));
  const me = attMine(all), adm = can('admin'), canEd = pid => adm || pid === me;
  const note = pid => N.find(n => n.person_id === pid) || {}, prevTodo = pid => (PN.find(n => n.person_id === pid) || {}).todo || '';
  const goal = pid => (G.find(g => g.person_id === pid) || {}).goal || '', planC = pid => (A.find(a => a.person_id === pid) || {}).code || '';
  const dname = new Date(day + 'T00:00:00').toLocaleDateString('tr-TR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const nFilled = people.filter(p => note(p.id).done || note(p.id).todo).length;
  shell('daily', `<div class="pagehead"><div><h1>Daily notları</h1><p class="lede">Günlük toplantının kısa notları: herkes kendi kartına dünü (yapılanlar) ve bugünü (yapılacaklar) yazar. Önceki günün "yapılacakları" kartta referans olarak görünür.</p></div>
    ${adm ? '<a class="btn" href="#/daily-aktar">Excel geçmişini aktar</a>' : ''}</div>
  <div class="toolbar"><div class="seg"><button type="button" id="dlp">← Önceki</button><button type="button" id="dlt" class="${day === td ? 'on' : ''}">Bugün</button><button type="button" id="dln">Sonraki →</button></div>
    <input type="date" id="dld" value="${day}" style="max-width:170px"><b style="text-transform:capitalize">${esc(dname)}</b><span class="sub">${nFilled}/${people.length} kişi yazdı</span>
    <form id="dlsf" style="margin-left:auto;display:flex;gap:6px"><input type="search" id="dlq" placeholder="Notlarda ara…" value="${esc(s.q)}" style="min-width:220px"><button class="btn">Ara</button></form></div>
  <div id="dlres"></div>
  <div class="dgrid">${people.map(p => { const n = note(p.id), ed = canEd(p.id), pc = planC(p.id);
    return `<section class="panel dcard${p.id === me ? ' mine' : ''}" data-p="${p.id}"><header><h2>${esc(p.name)}${p.id === me ? ' <span class="sub">(sen)</span>' : ''}</h2>${pc ? attBadge(pc) + `<span class="sub">${ATT[pc][2]}</span>` : ''}<a class="more" href="#/daily/k${p.id}">Geçmiş →</a></header>
      ${ed ? `<label class="dgoal">Haftalık hedef<input type="text" class="dl-goal" value="${esc(goal(p.id))}" placeholder="Bu haftanın hedefi"></label>` : goal(p.id) ? `<p class="dgoal sub"><b>Haftalık hedef:</b> ${esc(goal(p.id))}</p>` : ''}
      ${prevTodo(p.id) ? `<details class="dprev"${ed && !n.done ? ' open' : ''}><summary>Önceki günün yapılacakları (${fmtDM(prev)})</summary><div>${dlyTxt(prevTodo(p.id))}</div></details>` : ''}
      <div class="dfields">${ed ? `<label>Yapılanlar<textarea class="dl-done" rows="3" placeholder="Dün / bugün ne yapıldı">${esc(n.done || '')}</textarea></label>
        <label>Yapılacaklar<textarea class="dl-todo" rows="3" placeholder="Bugün / sıradaki işler">${esc(n.todo || '')}</textarea></label>`
        : `<div><div class="dlab">Yapılanlar</div>${n.done ? `<div>${dlyTxt(n.done)}</div>` : '<div class="sub">—</div>'}</div><div><div class="dlab">Yapılacaklar</div>${n.todo ? `<div>${dlyTxt(n.todo)}</div>` : '<div class="sub">—</div>'}</div>`}</div>
      <div class="dsave sub" aria-live="polite"></div></section>`; }).join('')}</div>`);
  const go = d => { s.day = d; viewDaily(); };
  q('#dlp').onclick = () => go(workdayStep(day, -1)); q('#dln').onclick = () => go(workdayStep(day, 1)); q('#dlt').onclick = () => go(isWorkday(td) ? td : workdayStep(td, -1));
  q('#dld').onchange = e => e.target.value && go(e.target.value);
  const saved = (card, ok) => { const el = q('.dsave', card); el.textContent = ok ? 'Kaydedildi ✓' : ''; if (ok) setTimeout(() => { if (el.isConnected) el.textContent = ''; }, 2500); };
  qa('.dcard').forEach(card => { const pid = +card.dataset.p;
    const saveNote = async () => { const done = q('.dl-done', card).value.trim() || null, todo = q('.dl-todo', card).value.trim() || null;
      const r = done || todo ? await sb.from('daily_notes').upsert({ person_id:pid, day, done, todo, updated_by:S.profile.id, updated_at:new Date().toISOString() }) : await sb.from('daily_notes').delete().eq('person_id', pid).eq('day', day);
      if (r.error) return toast(dbErr(r.error), true); saved(card, true); };
    if (q('.dl-done', card)) { q('.dl-done', card).onchange = saveNote; q('.dl-todo', card).onchange = saveNote; }
    if (q('.dl-goal', card)) q('.dl-goal', card).onchange = async e => { const v = e.target.value.trim();
      const r = v ? await sb.from('daily_goals').upsert({ person_id:pid, week, goal:v, updated_by:S.profile.id, updated_at:new Date().toISOString() }) : await sb.from('daily_goals').delete().eq('person_id', pid).eq('week', week);
      if (r.error) return toast(dbErr(r.error), true); saved(card, true); }; });
  const search = async () => { const term = q('#dlq').value.trim(); s.q = term; const box = q('#dlres');
    if (term.length < 2) { box.innerHTML = ''; return; }
    const t = term.replace(/[,()%*\\]/g, ' ').trim();
    const { data, error } = await sb.from('daily_notes').select('person_id,day,done,todo').or(`done.ilike.%${t}%,todo.ilike.%${t}%`).order('day', { ascending:false }).limit(80);
    if (error) { box.innerHTML = `<div class="empty">${esc(dbErr(error))}</div>`; return; }
    const nm = id => (all.find(p => p.id === id) || {}).name || '?', rx = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const snip = x => { const i = (x || '').toLocaleLowerCase('tr').indexOf(t.toLocaleLowerCase('tr')); if (i < 0) return ''; const a = Math.max(0, i - 60);
      return (a ? '…' : '') + esc(x.slice(a, i + t.length + 80)).replace(rx, m => `<mark>${m}</mark>`) + '…'; };
    box.innerHTML = `<section class="panel" style="margin-bottom:16px"><div class="board-head"><h2 style="margin:0">"${esc(term)}" için ${data.length}${data.length === 80 ? '+' : ''} sonuç</h2><button type="button" class="linkbtn" id="dlrc">Kapat</button></div>
      ${data.length ? `<ul class="tlist">${data.map(r => `<li><a href="#/daily/${r.day}"><span class="tm"><b>${esc(nm(r.person_id))}</b> <span class="sub">${fmtD(r.day)}</span><span class="sub">${snip(r.done) || snip(r.todo)}</span></span></a></li>`).join('')}</ul>` : '<p class="note">Bulunamadı.</p>'}</section>`;
    q('#dlrc').onclick = () => { s.q = ''; q('#dlq').value = ''; box.innerHTML = ''; }; };
  q('#dlsf').onsubmit = e => { e.preventDefault(); search(); };
  if (s.q) search();
}

// bir kişinin haftalık geçmişi (Excel'deki düzen)
async function viewDailyPerson(pid, weeks = 12){
  const { data:pp } = await sb.from('att_people').select('*').eq('id', pid).maybeSingle();
  if (!pp) return shell('daily', '<h1>Kişi bulunamadı</h1><p><a href="#/daily">Daily notları</a></p>');
  const from = addDays(mondayOf(today()), -7 * (weeks - 1));
  const [nr, gr, cnt] = await Promise.all([fetchAll(() => sb.from('daily_notes').select('day,done,todo').eq('person_id', pid).gte('day', from).order('day', { ascending:false })),
    sb.from('daily_goals').select('week,goal').eq('person_id', pid).gte('week', from), sb.from('daily_notes').select('day', { count:'exact', head:true }).eq('person_id', pid)]);
  const N = nr.data || [], G = gr.data || [], total = cnt.count || 0;
  const wks = []; for (let w = mondayOf(today()); w >= from; w = addDays(w, -7)) wks.push(w);
  const nOf = d => N.find(n => n.day === d) || {}, gOf = w => (G.find(g => g.week === w) || {}).goal || '';
  const shown = wks.filter(w => gOf(w) || [0, 1, 2, 3, 4].some(i => { const n = nOf(addDays(w, i)); return n.done || n.todo; }));
  shell('daily', `<p><a href="#/daily">← Daily notları</a></p><div class="pagehead"><div><h1>${esc(pp.name)} · daily geçmişi</h1><p class="lede">Son ${weeks} hafta · toplam ${total} günlük not${pp.active ? '' : ' · ayrılmış / pasif'}</p></div></div>
  ${shown.length ? `<div class="tablewrap"><table class="dhist"><thead><tr><th class="nosort">Hafta</th>${ATT_DN.map(d => `<th class="nosort">${d}</th>`).join('')}</tr></thead><tbody>
    ${shown.map(w => `<tr style="cursor:default"><td><b>${fmtDM(w)}–${fmtDM(addDays(w, 4))}</b>${gOf(w) ? `<div class="sub">${esc(gOf(w))}</div>` : ''}</td>${[0, 1, 2, 3, 4].map(i => { const d = addDays(w, i), n = nOf(d);
      return `<td>${n.done ? `<div class="dlab">Yapılanlar</div><div>${dlyTxt(n.done)}</div>` : ''}${n.todo ? `<div class="dlab">Yapılacaklar</div><div>${dlyTxt(n.todo)}</div>` : ''}${!n.done && !n.todo ? '<span class="sub">·</span>' : ''}</td>`; }).join('')}</tr>`).join('')}
  </tbody></table></div>` : '<div class="empty">Bu dönemde not yok.</div>'}
  ${total > N.length ? `<p><button class="btn" id="dlmore">Daha eski haftalar</button></p>` : ''}`);
  q('#dlmore') && (q('#dlmore').onclick = () => viewDailyPerson(pid, weeks + 26));
}

// Excel geçmişini aktarma (yönetici)
function viewDailyImport(){
  if (!can('admin')) return viewDaily();
  shell('daily-aktar', `<p><a href="#/daily">← Daily notları</a></p><div class="pagehead"><div><h1>Daily geçmişini aktar</h1><p class="lede">DailyMeetings Excel'inden hazırlanan <b>acrome-daily-aktarim.json</b> dosyasını seçin. Sitede zaten yazılmış notların üzerine yazılmaz; ayrılmış kişiler pasif olarak eklenir. Tekrar çalıştırmak güvenlidir.</p></div></div>
  <section class="panel"><input type="file" id="dif" accept=".json,application/json"> <button class="btn primary" id="dib" disabled>Aktar</button><p class="note" id="dis"></p></section>`);
  let J = null;
  q('#dif').onchange = async e => { try { J = JSON.parse(await e.target.files[0].text()); q('#dis').textContent = `${(J.rows || []).length} kayıt, ${(J.people || []).length} yeni kişi okundu.`; q('#dib').disabled = false; } catch (err) { q('#dis').textContent = 'Dosya okunamadı: ' + err.message; } };
  q('#dib').onclick = async () => { const b = q('#dib'); b.disabled = true; let tot = { people:0, notes:0, goals:0 };
    for (let i = 0; i < J.rows.length; i += 400) { b.textContent = `Aktarılıyor… ${Math.min(i + 400, J.rows.length)}/${J.rows.length}`;
      const { data, error } = await sb.rpc('daily_admin_import', { j:{ people:i ? [] : J.people, rows:J.rows.slice(i, i + 400) } });
      if (error) { toast(dbErr(error), true); b.disabled = false; b.textContent = 'Aktar'; return; }
      tot = { people:tot.people + data.people, notes:tot.notes + data.notes, goals:tot.goals + data.goals }; }
    b.textContent = 'Bitti'; q('#dis').textContent = `${tot.notes} günlük not, ${tot.goals} haftalık hedef, ${tot.people} yeni kişi aktarıldı.`; toast('Aktarım tamamlandı'); };
}

boot();
})();
