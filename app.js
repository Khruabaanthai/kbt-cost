/* KBT Cost – tạo bằng src/build.py, sửa ở thư mục src */
/* ---------- helpers ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const nf=new Intl.NumberFormat('vi-VN',{maximumFractionDigits:0});
const nf1=new Intl.NumberFormat('vi-VN',{maximumFractionDigits:2});
const vnd=v=>v==null||v===''?'—':nf.format(v);
const q=v=>v==null||v===''?'—':(typeof v==='number'?nf1.format(v):esc(v));
const pct=v=>v==null||!isFinite(v)?'—':(v*100).toLocaleString('vi-VN',{maximumFractionDigits:1})+'%';
const norm=s=>String(s??'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
const store={get(k,d){try{const v=localStorage.getItem('kbt.'+k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem('kbt.'+k,JSON.stringify(v))}catch(e){}}};
let TARGET=store.get('target',0.35);
const ratio=m=>m.price?m.cost/m.price:null;
const pillFor=r=>r==null?'<span class="pill mute">Chưa có giá bán</span>':`<span class="pill ${r<=TARGET?'good':r<=TARGET+0.1?'warn':'bad'}">${pct(r)}</span>`;
const PLACE='<span class="todo">Bếp chưa cập nhật</span>';


/* ================= KBT Cost – lõi ứng dụng: đăng nhập, dữ liệu, điều hướng ================= */
const APP_VERSION = '1.5.0';
const USER_DOMAIN = (window.KBT_CONFIG && window.KBT_CONFIG.USER_DOMAIN) || 'kbt.app';

/* ---------- dữ liệu & chỉ mục (được gán sau khi tải) ---------- */
let D = null, META = null, BAR = null, SOT = null, BARMETA = null, SOTMETA = null, menuBy, dishBy, nvlBy, btpBy, chartBy, sopBy, used, cats, missingLines, nvlLabel;
let CFG = { nav: { order: {}, names: {}, hidden: [], secNames: {} }, custom: [] }, CUS = {};
const cfgNorm = c => { c = c || {}; c.nav ??= {}; c.nav.order ??= {}; c.nav.names ??= {}; c.nav.hidden ??= []; c.nav.secNames ??= {}; c.custom ??= []; return c; };
let ME = { email: '', role: 'viewer', name: '' };
function setData(d, images) {
  D = d;
  (images || []).forEach(([code, img]) => { const c = d.charts.find(x => x.code === code); if (c) c.img = img; });
  menuBy = Object.fromEntries(D.menu.map(m => [m.code, m]));
  dishBy = Object.fromEntries(D.dishes.map(x => [x.code, x]));
  nvlBy = Object.fromEntries(D.nvl.map(n => [n.code, n]));
  btpBy = Object.fromEntries(D.btp.map(b => [b.code, b]));
  chartBy = {}; D.charts.forEach(c => { chartBy[c.code] ??= c; });
  sopBy = Object.fromEntries(D.sops.map(s => [s.code, s]));
  used = {};
  D.dishes.forEach(x => x.lines.forEach(l => { (used[l.code] ??= { dish: [], btp: [] }).dish.push({ d: x, l }); }));
  D.btp.forEach(b => b.items.forEach(l => { (used[l.code] ??= { dish: [], btp: [] }).btp.push({ b, l }); }));
  cats = [...new Set(D.menu.map(m => m.cat))];
  missingLines = D.dishes.flatMap(x => x.lines.filter(l => !l.price).map(l => ({ d: x, l })));
  nvlLabel = code => { const n = nvlBy[code]; return n ? n.name : (D.dishes.flatMap(x => x.lines).find(l => l.code === code)?.name || code); };
}

/* ---------- bộ nhớ đệm trên máy (IndexedDB) để mở nhanh & xem khi mất mạng ---------- */
const cache = {
  db: null,
  open() { return this.db ||= new Promise((res, rej) => { const r = indexedDB.open('kbt-cost', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async get(k) { try { const db = await this.open(); return await new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); } catch (e) { return undefined; } },
  async set(k, v) { try { const db = await this.open(); await new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch (e) { } },
  async clear() { try { const db = await this.open(); await new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').clear(); t.oncomplete = res; t.onerror = res; }); } catch (e) { } },
};

/* ---------- máy chủ (Supabase) ---------- */
function makeBackend() {
  if (window.KBT_BACKEND) return window.KBT_BACKEND; // dùng khi kiểm thử
  const C = window.KBT_CONFIG || {};
  if (!C.SUPABASE_URL || !C.SUPABASE_ANON_KEY || C.SUPABASE_URL.includes('XXXX')) return null;
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  return {
    async session() { const { data } = await sb.auth.getSession(); return data.session; },
    async signIn(email, password) { const { data, error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; return data.session; },
    async signOut() { await sb.auth.signOut(); },
    async changePassword(pw) { const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw error; },
    async me(session) {
      const { data, error } = await sb.from('kbt_members').select('role,full_name,active').eq('user_id', session.user.id).maybeSingle();
      if (error) throw error;
      return { email: session.user.email, role: data?.role || 'viewer', name: data?.full_name || '', active: data ? data.active !== false : true };
    },
    async dataStamp() { const { data, error } = await sb.from('kbt_dataset').select('key,updated_at').neq('key', 'log').not('key', 'like', 'img:%'); if (error) throw error; return data.length ? data.map(r => r.key + ':' + r.updated_at).sort().join('|') : null; },
    async loadAll() {
      const { data, error } = await sb.from('kbt_dataset').select('key,payload,meta,updated_at').neq('key', 'log');
      if (error) throw error;
      const g = k => data.find(r => r.key === k);
      const main = g('data'), bar = g('bar'), sot = g('sot');
      const cfg = g('cfg'), cus = Object.fromEntries(data.filter(r => r.key.startsWith('cus:')).map(r => [r.key.slice(4), r.payload]));
      if (!main && !bar && !sot && !cfg) return null;
      const m = r => r ? { ...(r.meta || {}), updated_at: r.updated_at } : null;
      return {
        data: main?.payload || null, meta: m(main), bar: bar?.payload || null, barMeta: m(bar), sot: sot?.payload || null, sotMeta: m(sot),
        images: data.filter(r => r.key.startsWith('img:')).map(r => [r.key.slice(4), r.payload.src]),
        cfg: cfg?.payload || null, cus,
        stamp: data.filter(r => !r.key.startsWith('img:')).map(r => r.key + ':' + r.updated_at).sort().join('|'),
      };
    },
    async readLog() { const { data, error } = await sb.from('kbt_dataset').select('payload').eq('key', 'log').maybeSingle(); if (error) throw error; return data?.payload?.items || []; },
    async appendLog(items) {
      const cur = await this.readLog();
      const all = [...items, ...cur].slice(0, 5000);
      const r = await sb.from('kbt_dataset').upsert({ key: 'log', payload: { items: all }, meta: {}, updated_at: new Date().toISOString() }); if (r.error) throw r.error;
    },
    async stampOf(key) { const { data, error } = await sb.from('kbt_dataset').select('updated_at').eq('key', key).maybeSingle(); if (error) throw error; return data?.updated_at || null; },
    async deleteKey(key) { const r = await sb.from('kbt_dataset').delete().eq('key', key); if (r.error) throw r.error; },
    async publishExtra(key, payload, meta) {
      const r = await sb.from('kbt_dataset').upsert({ key, payload, meta, updated_at: new Date().toISOString() }); if (r.error) throw r.error;
    },
    async publish(d, images, meta) {
      const del = await sb.from('kbt_dataset').delete().like('key', 'img:%'); if (del.error) throw del.error;
      const rows = images.map(([code, src]) => ({ key: 'img:' + code, payload: { src }, meta: {} }));
      for (let i = 0; i < rows.length; i += 5) { const r = await sb.from('kbt_dataset').upsert(rows.slice(i, i + 5)); if (r.error) throw r.error; }
      const r = await sb.from('kbt_dataset').upsert({ key: 'data', payload: d, meta, updated_at: new Date().toISOString() }); if (r.error) throw r.error;
    },
  };
}
const API = makeBackend();

/* ---------- màn hình đăng nhập ---------- */
function toEmail(u) { u = u.trim().toLowerCase(); return u.includes('@') ? u : `${u}@${USER_DOMAIN}`; }
function showLogin(msg) {
  document.body.classList.add('locked');
  $('#appRoot').hidden = true; $('#login').hidden = false;
  $('#lgMsg').textContent = msg || ''; $('#lgMsg').hidden = !msg;
  setTimeout(() => $('#lgUser').focus(), 50);
}
$('#lgForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#lgBtn'); btn.disabled = true; btn.textContent = 'Đang đăng nhập…'; $('#lgMsg').hidden = true;
  try {
    if (!navigator.onLine) throw new Error('offline');
    const s = await API.signIn(toEmail($('#lgUser').value), $('#lgPass').value);
    $('#lgPass').value = '';
    await afterLogin(s, true);
  } catch (err) {
    const m = err.message === 'offline' ? 'Máy đang mất mạng. Kết nối Internet rồi đăng nhập lại.'
      : /invalid/i.test(err.message) ? 'Sai tên đăng nhập hoặc mật khẩu. Kiểm tra lại chữ hoa, chữ thường.'
      : 'Không đăng nhập được: ' + err.message;
    $('#lgMsg').textContent = m; $('#lgMsg').hidden = false;
  } finally { btn.disabled = false; btn.textContent = 'Đăng nhập'; }
});
$('#lgShow').addEventListener('click', () => { const p = $('#lgPass'); p.type = p.type === 'password' ? 'text' : 'password'; $('#lgShow').textContent = p.type === 'password' ? 'Hiện' : 'Ẩn'; });

async function afterLogin(session, fresh) {
  try { ME = await API.me(session); await cache.set('me', ME); }
  catch (e) { const c = await cache.get('me'); if (c && c.email === session.user.email) ME = c; else ME = { email: session.user.email, role: 'viewer' }; }
  if (ME.active === false) { await API.signOut(); await cache.clear(); return showLogin('Tài khoản này đã bị khóa. Liên hệ quản trị để mở lại.'); }
  document.body.classList.remove('locked');
  $('#login').hidden = true; $('#appRoot').hidden = false;
  await loadData(fresh);
}

/* ---------- tải dữ liệu ---------- */
function applyAll(all) {
  META = all.meta; BAR = all.bar || null; SOT = all.sot || null; BARMETA = all.barMeta || null; SOTMETA = all.sotMeta || null;
  if (all.data) setData(all.data, all.images); else D = null;
  CFG = cfgNorm(all.cfg); CUS = all.cus || {};
  if (typeof prepBarSot === 'function') prepBarSot();
}
const hasAny = () => !!(D || BAR || SOT || CFG.custom.length);
async function loadData(force) {
  if (typeof EDIT !== 'undefined' && EDIT.on) return;
  const c = await cache.get('dataset');
  if (c && !hasAny()) { applyAll(c); if (hasAny()) renderShell(); }
  if (!navigator.onLine) { if (!hasAny()) renderEmpty('Máy đang mất mạng và chưa có dữ liệu lưu trên máy. Kết nối Internet rồi mở lại app.'); else setSync('Đang xem dữ liệu lưu trên máy (mất mạng)'); return; }
  try {
    const stamp = await API.dataStamp();
    if (!stamp) { if (!hasAny()) renderEmpty(); return; }
    if (!force && c && c.stamp === stamp) { setSync(); return; }
    setSync('Đang tải dữ liệu mới…');
    const all = await API.loadAll();
    if (!all) { renderEmpty(); return; }
    await cache.set('dataset', all);
    applyAll(all); renderShell();
  } catch (e) {
    if (hasAny()) setSync('Không kết nối được máy chủ, đang xem dữ liệu lưu trên máy'); else renderEmpty('Không tải được dữ liệu: ' + e.message);
  }
}
function fmtTime(t) { try { return new Date(t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }); } catch (e) { return t; } }
function setSync(msg) {
  const el = $('#sync'); if (!el) return;
  el.innerHTML = msg ? esc(msg) : META ? `Dữ liệu: ${esc(META.file || 'file định mức')}<br>Cập nhật ${esc(fmtTime(META.updated_at))}${META.by ? ' · ' + esc(META.by) : ''}` : '';
}

/* ---------- khung app & điều hướng ---------- */
const st = { mod: 'tongquan', sel: {} };
let MODS = [];
function isAdmin() { return ME.role === 'admin'; }
const SECS = [{ id: 'bep', name: 'Bếp' }, { id: 'bar', name: 'Bar' }, { id: 'sot', name: 'Bếp tổng' }, { id: 'khac', name: 'Khác' }];
function buildMods() {
  MODS = [];
  if (D) MODS.push(
    { id: 'tongquan', sec: 'bep', name: 'Tổng quan' },
    { id: 'menu', sec: 'bep', name: 'Menu tổng hợp', n: D.menu.length },
    { id: 'cost', sec: 'bep', name: 'Food cost', n: D.dishes.length },
    { id: 'master', sec: 'bep', name: 'Định mức Master', n: D.dishes.reduce((a, x) => a + x.lines.length, 0) },
    { id: 'btp', sec: 'bep', name: 'Bán thành phẩm', n: D.btp.length },
    { id: 'nvl', sec: 'bep', name: 'Danh mục NVL', n: D.nvl.length },
    { id: 'tracuu', sec: 'bep', name: 'Tra cứu NVL' },
    { id: 'chart', sec: 'bep', name: 'Chart món', n: D.charts.length },
    { id: 'daotao', sec: 'bep', name: 'Đào tạo SOP', n: D.sops.length });
  if (BAR) {
    MODS.push({ id: 'bar-tq', sec: 'bar', name: 'Tổng quan' },
      { id: 'bar-menu', sec: 'bar', name: 'Menu & cost', n: BAR.menu.filter(m => !m.off).length },
      { id: 'bar-ct', sec: 'bar', name: 'Công thức pha chế', n: BAR.recipes.length },
      { id: 'bar-nvl', sec: 'bar', name: 'Nguyên liệu bar', n: BAR.nvl.length });
    if (BAR.charts?.length) MODS.push({ id: 'bar-chart', sec: 'bar', name: 'Chart pha chế', n: BAR.charts.length });
    if (BAR.sops?.length) MODS.push({ id: 'bar-sop', sec: 'bar', name: 'Đào tạo SOP', n: BAR.sops.length });
  }
  if (SOT) MODS.push({ id: 'sot-tq', sec: 'sot', name: 'Tổng quan' },
    { id: 'sot-gia', sec: 'sot', name: 'Bảng giá xuống cơ sở', n: SOT.prices.length },
    { id: 'sot-ct', sec: 'sot', name: 'Công thức sốt', n: SOT.recipes.length },
    { id: 'sot-nvl', sec: 'sot', name: 'Danh mục NVL', n: SOT.nvl.length });
  CFG.custom.forEach(c => MODS.push({ id: 'cus-' + c.id, sec: c.sec, name: c.name, n: CUS[c.id]?.rows?.length || 0, cus: true }));
  MODS.forEach(m => { m.orig = m.name; if (CFG.nav.names[m.id]) m.name = CFG.nav.names[m.id]; });
  ALLMODS = MODS.slice();
  MODS = MODS.filter(m => !CFG.nav.hidden.includes(m.id));
  const ord = (sec, id) => { const o = CFG.nav.order[sec] || []; const i = o.indexOf(id); return i < 0 ? 1e3 + ALLMODS.findIndex(m => m.id === id) : i; };
  MODS.sort((a, b) => a.sec === b.sec ? ord(a.sec, a.id) - ord(b.sec, b.id) : 0);
  ALLMODS.sort((a, b) => a.sec === b.sec ? ord(a.sec, a.id) - ord(b.sec, b.id) : 0);
  if (isAdmin()) MODS.push({ id: 'capnhat', sec: 'sys', name: 'Cập nhật dữ liệu' }, { id: 'tuychinh', sec: 'sys', name: 'Tùy chỉnh menu & phân hệ' }, { id: 'nhatky', sec: 'sys', name: 'Nhật ký thay đổi' });
  MODS.push({ id: 'taikhoan', sec: 'sys', name: 'Tài khoản' });
}
let ALLMODS = [];
const secName = x => CFG.nav.secNames[x.id] || x.name;
const secOf = id => MODS.find(m => m.id === id)?.sec;
function renderNav() {
  const secs = SECS.filter(x => MODS.some(m => m.sec === x.id));
  if (!st.sec || !secs.find(x => x.id === st.sec)) st.sec = secs[0]?.id || 'sys';
  $('#secBar').innerHTML = secs.length > 1 ? secs.map(x => `<button type="button" data-sec="${x.id}" aria-pressed="${x.id === st.sec}">${esc(secName(x))}</button>`).join('') : '';
  $('#secBar').hidden = secs.length < 2;
  const nav = $('#navList'); nav.innerHTML = '';
  const list = st.sec === 'sys' ? [] : MODS.filter(m => m.sec === st.sec);
  const sys = MODS.filter(m => m.sec === 'sys');
  list.forEach(m => nav.insertAdjacentHTML('beforeend', `<button id="nav-${m.id}" data-m="${m.id}">${esc(m.name)}${m.n ? `<small>${nf.format(m.n)}</small>` : ''}</button>`));
  if (list.length) nav.insertAdjacentHTML('beforeend', `<div class="navgrp navsys">Hệ thống</div>`);
  sys.forEach(m => nav.insertAdjacentHTML('beforeend', `<button id="nav-${m.id}" class="navsysb" data-m="${m.id}">${esc(m.name)}</button>`));
  document.querySelectorAll('#navList button').forEach(b => b.setAttribute('aria-current', b.dataset.m === st.mod));
}
function renderShell() {
  buildMods();
  $('#who').textContent = $('#whoM').textContent = ME.name || ME.email.replace('@' + USER_DOMAIN, '');
  setSync(); if (typeof drawEditBar === 'function') drawEditBar();
  const h = (location.hash || '').slice(1);
  const want = MODS.find(m => m.id === h) ? h : (MODS.find(m => m.id === st.mod) ? st.mod : store.get('mod', 'tongquan'));
  if (!MODS.length) return;
  go(MODS.find(m => m.id === want) ? want : MODS[0].id);
}
function renderEmpty(msg) {
  D = null; BAR = null; SOT = null; buildMods();
  const nav = $('#navList'); nav.innerHTML = '';
  st.sec = 'sys'; renderNav();
  $('#who').textContent = ME.name || ME.email;
  if (msg) { $('#main').innerHTML = `<div class="empty-state"><h1>Chưa mở được dữ liệu</h1><p>${esc(msg)}</p><button class="btn pri" onclick="loadData(true)">Thử lại</button></div>`; return; }
  if (isAdmin()) go('capnhat');
  else $('#main').innerHTML = `<div class="empty-state"><h1>Chưa có dữ liệu</h1><p>Quản trị chưa tải file định mức lên. Khi có dữ liệu, app sẽ tự hiện các phân hệ tra cứu.</p><button class="btn" onclick="loadData(true)">Kiểm tra lại</button></div>`;
}
function go(mod, sel) {
  if (!VIEWS[mod] && String(mod).startsWith('cus-')) VIEWS[mod] = () => viewCus(mod.slice(4));
  if (!VIEWS[mod] || !MODS.find(m => m.id === mod)) return;
  st.mod = mod; if (sel !== undefined) st.sel[mod] = sel;
  const sc = secOf(mod); if (sc && sc !== 'sys') { st.sec = sc; store.set('last_' + sc, mod); }
  renderNav();
  try { history.replaceState(null, '', '#' + mod); } catch (e) { }
  store.set('mod', mod);
  VIEWS[mod]();
  window.scrollTo(0, 0);
  $('#nav-' + mod)?.scrollIntoView({ block: 'nearest', inline: 'center' });
}
$('#navList').addEventListener('click', e => { const b = e.target.closest('button[data-m]'); if (b) go(b.dataset.m); });
document.addEventListener('click', e => { if (e.target.closest('.edit-toggle')) startEdit(); });
$('#secBar').addEventListener('click', e => {
  const b = e.target.closest('[data-sec]'); if (!b) return;
  const sc = b.dataset.sec, last = store.get('last_' + sc, null);
  go(MODS.find(m => m.id === last && m.sec === sc) ? last : MODS.find(m => m.sec === sc).id);
});
/* chuyển tới trang bar/sốt: hàm cũ gọi st.barTab rồi VIEWS.bar() – đồng bộ lại thanh menu */
function syncNav(id) { if (st.mod === id) return; st.mod = id; const sc = secOf(id); if (sc) { st.sec = sc; store.set('last_' + sc, id); } try { history.replaceState(null, '', '#' + id); } catch (e) { } store.set('mod', id); renderNav(); }

document.addEventListener('click',e=>{const j=e.target.closest('[data-go]');if(j){e.stopPropagation();go(j.dataset.go,j.dataset.sel)}});
const jumpBtns=code=>`<div class="jump">
 <button class="btn" data-go="cost" data-sel="${code}">Cost</button>
 <button class="btn" data-go="chart" data-sel="${code}" ${chartBy[code]?'':'disabled'}>Chart</button>
 <button class="btn" data-go="daotao" data-sel="${code}" ${sopBy[code]?'':'disabled'}>Đào tạo</button></div>`;
const head=(t,p,extra='')=>`<div class="head"><div class="grow"><h1>${t}</h1>${p?`<p>${p}</p>`:''}</div>${extra}</div>`;

/* generic sortable table */
function sortable(el,rows,cols,onRow){
  let key=null,dir=1;
  function draw(){
    let r=rows.slice();
    if(key!=null){const c=cols[key];r.sort((a,b)=>{const x=c.v(a),y=c.v(b);if(x==null)return 1;if(y==null)return -1;return (typeof x==='number'?x-y:String(x).localeCompare(String(y),'vi'))*dir})}
    el.innerHTML=`<div class="tbl"><table><thead><tr>${cols.map((c,i)=>`<th class="s ${c.n?'n':''}" data-i="${i}">${c.h}${key===i?(dir>0?' ▲':' ▼'):''}</th>`).join('')}</tr></thead><tbody>${
      r.length?r.map((x,i)=>`<tr class="${onRow?'click':''}" data-i="${rows.indexOf(x)}">${cols.map(c=>`<td class="${c.n?'n':''} ${c.cls||''}">${c.f?c.f(x):esc(c.v(x))}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${cols.length}" class="empty">Không có dòng nào khớp bộ lọc.</td></tr>`
    }</tbody></table></div>`;
  }
  el.onclick=e=>{const th=e.target.closest('th[data-i]');if(th){const i=+th.dataset.i;dir=key===i?-dir:1;key=i;draw();return}
    const tr=e.target.closest('tr.click');if(tr&&onRow&&!e.target.closest('[data-go]'))onRow(rows[+tr.dataset.i])};
  draw();
}
function searchInput(id,ph,val=''){return `<input type="search" id="${id}" placeholder="${ph}" value="${esc(val)}" autocomplete="off">`}


/* ---------- TỔNG QUAN ---------- */
const VIEWS={};
VIEWS.tongquan=function(){
  const priced=D.menu.filter(m=>m.price);
  const rs=priced.map(ratio);
  const avg=rs.reduce((a,b)=>a+b,0)/rs.length;
  const wAvg=priced.reduce((a,m)=>a+m.cost,0)/priced.reduce((a,m)=>a+m.price,0);
  const over=priced.filter(m=>ratio(m)>TARGET);
  const byCat=cats.map(c=>{const ms=priced.filter(m=>m.cat===c);return {c,n:ms.length,r:ms.length?ms.reduce((a,m)=>a+m.cost,0)/ms.reduce((a,m)=>a+m.price,0):null}}).filter(x=>x.r!=null).sort((a,b)=>b.r-a.r);
  const maxR=Math.max(...byCat.map(x=>x.r),TARGET)*1.1;
  const top=[...priced].sort((a,b)=>ratio(b)-ratio(a)).slice(0,10);
  const noPrice=D.menu.filter(m=>!m.price);
  const chartsNoSteps=D.charts.filter(c=>!c.steps.length).length;
  const sopDone=D.sops.filter(s=>s.steps.length).length;
  $('#main').innerHTML=head('Tổng quan cost nguyên liệu',`Số liệu lấy từ file định mức quản trị tải lên gần nhất. Tỷ lệ cost = cost món ÷ giá bán. Ngưỡng mục tiêu dùng để tô màu toàn bộ app.`,
   `<label class="muted" for="tg">Mục tiêu food cost&nbsp;</label><input type="number" id="tg" min="10" max="80" step="1" value="${Math.round(TARGET*100)}" style="width:80px"> <span class="muted">%</span>`)+
  `<div class="kpis">
    <div class="kpi"><div class="l">Món có định mức</div><div class="v">${D.dishes.length}</div><div class="s">${cats.length} danh mục · ${noPrice.length} món chưa có giá bán</div></div>
    <div class="kpi"><div class="l">Food cost bình quân</div><div class="v">${pct(wAvg)}</div><div class="s">Gia quyền theo giá bán · TB đơn giản ${pct(avg)}</div></div>
    <div class="kpi"><div class="l">Món vượt mục tiêu</div><div class="v" style="color:var(--bad)">${over.length}</div><div class="s">trên ${priced.length} món có giá bán</div></div>
    <div class="kpi"><div class="l">Nguyên liệu · BTP</div><div class="v">${D.nvl.length}</div><div class="s">${D.btp.length} công thức bán thành phẩm</div></div>
  </div>
  <div class="grid2">
    <section class="panel"><h3>Tỷ lệ cost theo danh mục</h3><div class="pad"><div class="bars">${byCat.map(x=>{const cl=x.r<=TARGET?'':x.r<=TARGET+.1?'w':'b';return `<div class="bar"><span class="lb" title="${esc(x.c)}">${esc(x.c)} <span class="muted">(${x.n})</span></span><span class="t"><i class="${cl}" style="width:${x.r/maxR*100}%"></i><span class="tg" style="left:${TARGET/maxR*100}%"></span></span><span class="n" style="text-align:right;font-variant-numeric:tabular-nums">${pct(x.r)}</span></div>`}).join('')}</div>
    <div class="note">Vạch đậm = mục tiêu ${pct(TARGET)}. Cost gia quyền theo tổng giá bán trong danh mục.</div></div></section>
    <section class="panel"><h3>10 món tỷ lệ cost cao nhất</h3><div id="topT"></div></section>
  </div>
  <div class="grid2" style="margin-top:16px">
    <section class="panel"><h3>Cảnh báo dữ liệu</h3><div class="pad" style="display:grid;gap:10px">
      <div><span class="pill ${missingLines.length?'bad':'good'}">${missingLines.length} dòng</span> định mức dùng mã NVL chưa có giá trong Danh mục NVL:
        <div class="note" style="margin-top:4px">${missingLines.map(({d,l})=>`<a href="#" data-go="cost" data-sel="${d.code}">${esc(d.code)}</a> – ${esc(l.code)} ${esc(l.name)}`).join('<br>')||'Không có'}</div></div>
      <div><span class="pill ${noPrice.length?'warn':'good'}">${noPrice.length} món</span> chưa có giá bán nên chưa tính được tỷ lệ: <span class="muted">${noPrice.map(m=>esc(m.code)).join(', ')}</span></div>
      <div><span class="pill ${D.nvl.filter(n=>!n.price).length?'warn':'good'}">${D.nvl.filter(n=>!n.price).length} NVL</span> giá nhập bằng 0: <span class="muted">${D.nvl.filter(n=>!n.price).map(n=>esc(n.code+' '+n.name)).join(', ')}</span></div>
    </div></section>
    <section class="panel"><h3>Tiến độ hồ sơ bếp</h3><div class="pad"><div class="bars">
      ${[['Chart có quy trình',D.charts.length-chartsNoSteps,D.charts.length],['Chart có ảnh chuẩn',D.charts.filter(c=>c.img).length,D.charts.length],['SOP có quy trình',sopDone,D.sops.length]].map(([l,a,b])=>`<div class="bar"><span class="lb">${l}</span><span class="t"><i style="width:${a/b*100}%"></i></span><span style="text-align:right;font-variant-numeric:tabular-nums">${a}/${b}</span></div>`).join('')}
    </div><div class="note">Các mục "→ bếp điền" trong file được coi là chưa cập nhật.</div></div></section>
  </div>`;
  sortable($('#topT'),top,[
    {h:'Mã',v:m=>m.code,cls:'code'},{h:'Món',v:m=>m.name},{h:'Giá bán',n:1,v:m=>m.price,f:m=>vnd(m.price)},{h:'Cost',n:1,v:m=>m.cost,f:m=>vnd(m.cost)},{h:'Tỷ lệ',n:1,v:ratio,f:m=>pillFor(ratio(m))}
  ],m=>go('cost',m.code));
  $('#tg').onchange=e=>{const v=+e.target.value;if(v>0&&v<100){TARGET=v/100;store.set('target',TARGET);VIEWS.tongquan()}};
};

/* ---------- MENU ---------- */
VIEWS.menu=function(){
  const f=st.menuF??={q:'',cat:''};
  $('#main').innerHTML=head('Menu tổng hợp',`${D.menu.length} món, cost và tỷ lệ tự tính từ định mức. Bấm vào món để xem food cost; nút Chart / Đào tạo mở hồ sơ bếp của món.`)+
   `<div class="toolbar">${searchInput('mq','Tìm theo mã hoặc tên món…',f.q)}</div>
    <div class="chips" id="mc" style="margin-bottom:12px"><button class="chip" data-c="" aria-pressed="${!f.cat}">Tất cả</button>${cats.map(c=>`<button class="chip" data-c="${esc(c)}" aria-pressed="${f.cat===c}">${esc(c)}</button>`).join('')}</div>
    <section class="panel" id="mt"></section><div class="note" id="msum"></div>`;
  const draw=()=>{
    const qq=norm(f.q);
    const rows=D.menu.filter(m=>(!f.cat||m.cat===f.cat)&&(!qq||norm(m.code+' '+m.name).includes(qq)));
    const tp=rows.filter(m=>m.price);
    $('#msum').textContent=`${rows.length} món · tổng cost ${vnd(rows.reduce((a,m)=>a+(m.cost||0),0))}đ · tỷ lệ gia quyền ${pct(tp.reduce((a,m)=>a+m.cost,0)/tp.reduce((a,m)=>a+m.price,0))}`;
    sortable($('#mt'),rows,[
      {h:'Mã món',v:m=>m.code,cls:'code'},{h:'Tên món',v:m=>m.name},{h:'Danh mục',v:m=>m.cat,f:m=>`<span class="muted">${esc(m.cat)}</span>`},
      {h:'Giá bán',n:1,v:m=>m.price,f:m=>vnd(m.price)},{h:'Cost',n:1,v:m=>m.cost,f:m=>vnd(m.cost)},{h:'Tỷ lệ cost',n:1,v:ratio,f:m=>pillFor(ratio(m))},
      {h:'Hồ sơ',v:m=>0,f:m=>`<span class="jump"><button class="chip" data-go="chart" data-sel="${m.code}" ${chartBy[m.code]?'':'disabled'}>Chart</button><button class="chip" data-go="daotao" data-sel="${m.code}">Đào tạo</button></span>`}
    ],m=>go('cost',m.code));
  };
  $('#mq').oninput=e=>{f.q=e.target.value;draw()};
  $('#mc').onclick=e=>{const b=e.target.closest('[data-c]');if(!b)return;f.cat=b.dataset.c;$('#mc').querySelectorAll('.chip').forEach(x=>x.setAttribute('aria-pressed',x===b));draw()};
  draw();
};

/* ---------- DANH MỤC NVL ---------- */
VIEWS.nvl=function(){
  const f=st.nvlF??={q:'',g:'',only:''};
  const secs=[...new Set(D.nvl.map(n=>n.sec))];
  $('#main').innerHTML=head('Danh mục nguyên liệu',`Giá nhập, tỷ lệ đạt sau sơ chế và giá/đvt thực tế (= giá nhập ÷ 1000 ÷ TL đạt với đơn vị g/ml). Bấm một dòng để xem các món và BTP đang dùng.`)+
   `<div class="toolbar">${searchInput('nq','Tìm mã hoặc tên nguyên liệu…',f.q)}
     <select id="ng"><option value="">Mọi nhóm</option>${secs.map(s=>`<option ${f.g===s?'selected':''}>${esc(s)}</option>`).join('')}</select>
     <select id="no"><option value="">Tất cả</option><option value="used" ${f.only==='used'?'selected':''}>Đang dùng trong định mức</option><option value="unused" ${f.only==='unused'?'selected':''}>Chưa món nào dùng</option><option value="tl" ${f.only==='tl'?'selected':''}>TL đạt &lt; 100%</option></select></div>
   <section class="panel" id="nt"></section><div class="note" id="nsum"></div>`;
  const draw=()=>{
    const qq=norm(f.q);
    const rows=D.nvl.filter(n=>(!f.g||n.sec===f.g)&&(!qq||norm(n.code+' '+n.name).includes(qq))&&(!f.only||(f.only==='used'?used[n.code]:f.only==='unused'?!used[n.code]:(n.tl!=null&&n.tl<1))));
    $('#nsum').textContent=`${rows.length} / ${D.nvl.length} nguyên liệu`;
    sortable($('#nt'),rows,[
      {h:'Mã NVL',v:n=>n.code,cls:'code'},{h:'Tên nguyên liệu',v:n=>n.name},{h:'ĐVT',v:n=>n.unit},{h:'Nhóm',v:n=>n.grp,f:n=>`<span class="pill ${n.grp==='BTP'?'warn':'mute'}">${esc(n.grp)}</span>`},
      {h:'Giá nhập',n:1,v:n=>n.price,f:n=>n.price?vnd(n.price):'<span class="pill bad">0</span>'},{h:'TL đạt',n:1,v:n=>n.tl,f:n=>n.tl==null?'—':pct(n.tl)},
      {h:'Giá/đvt thực tế',n:1,v:n=>n.unitCost,f:n=>q(n.unitCost)},{h:'Số món dùng',n:1,v:n=>used[n.code]?.dish.length||0,f:n=>used[n.code]?.dish.length||'<span class="muted">0</span>'}
    ],n=>go('tracuu',n.code));
  };
  $('#nq').oninput=e=>{f.q=e.target.value;draw()};
  $('#ng').onchange=e=>{f.g=e.target.value;draw()};
  $('#no').onchange=e=>{f.only=e.target.value;draw()};
  draw();
};

/* ---------- combobox ---------- */
function combo(host,items,label,onPick,ph){
  host.innerHTML=`<div class="combo"><input type="search" id="${host.id}-i" placeholder="${ph}" value="${esc(label)}" autocomplete="off" style="width:100%"><div class="sugg" hidden></div></div>`;
  const inp=host.querySelector('input'),box=host.querySelector('.sugg');let cur=[],on=0;
  const show=()=>{const qq=norm(inp.value);cur=items.filter(x=>!qq||x.k.includes(qq)).slice(0,60);on=0;
    box.innerHTML=cur.map((x,i)=>`<div data-i="${i}" class="${i===0?'on':''}"><span class="code" style="font-family:var(--f-display);color:var(--muted);min-width:64px">${esc(x.code)}</span><span>${esc(x.name)}</span></div>`).join('')||'<div class="muted">Không tìm thấy</div>';box.hidden=false};
  inp.onfocus=()=>{inp.select();show()};inp.oninput=show;
  inp.onkeydown=e=>{if(box.hidden)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();on=Math.max(0,Math.min(cur.length-1,on+(e.key==='ArrowDown'?1:-1)));box.querySelectorAll('[data-i]').forEach((d,i)=>d.classList.toggle('on',i===on));box.querySelector('.on')?.scrollIntoView({block:'nearest'})}
    else if(e.key==='Enter'&&cur[on]){e.preventDefault();box.hidden=true;onPick(cur[on].code)}else if(e.key==='Escape')box.hidden=true};
  box.onmousedown=e=>{const d=e.target.closest('[data-i]');if(d){e.preventDefault();box.hidden=true;onPick(cur[+d.dataset.i].code)}};
  inp.onblur=()=>setTimeout(()=>box.hidden=true,120);
}

/* ---------- TRA CỨU NVL ---------- */
VIEWS.tracuu=function(){
  const codes=Object.keys(used).sort((a,b)=>a.localeCompare(b,'vi',{numeric:true}));
  const items=codes.map(c=>({code:c,name:nvlLabel(c),k:norm(c+' '+nvlLabel(c))}));
  let code=st.sel.tracuu||store.get('tracuu','BN24');if(!used[code])code=codes[0];
  const n=nvlBy[code],u=used[code];
  const tot=u.dish.reduce((a,x)=>a+(x.l.qty||0),0),totAmt=u.dish.reduce((a,x)=>a+(x.l.amount||0),0);
  $('#main').innerHTML=head('Tra cứu nguyên liệu','Chọn một nguyên liệu để xem tất cả món và bán thành phẩm đang dùng nó, kèm định lượng và tiền cost phân bổ.')+
   `<div class="toolbar"><div id="tcb" style="flex:1 1 320px;min-width:0"></div></div>
   <section class="panel"><div class="dhead"><h2>${esc(nvlLabel(code))}</h2><span class="code" style="font-family:var(--f-display);font-size:18px;color:var(--muted)">${esc(code)}</span></div>
    <div class="facts">
     <div><small>Giá nhập</small><b>${n?vnd(n.price):'<span class="pill bad">Chưa có trong danh mục</span>'}</b></div>
     <div><small>ĐVT</small><b>${esc(n?.unit||'—')}</b></div><div><small>TL đạt</small><b>${n?.tl!=null?pct(n.tl):'—'}</b></div>
     <div><small>Số món dùng</small><b>${u.dish.length}</b></div><div><small>Tổng ĐL chuẩn / 1 lượt mỗi món</small><b>${q(tot)}</b></div>
     <div><small>Tổng tiền trong cost món</small><b>${vnd(totAmt)}</b></div><div><small>Dùng trong BTP</small><b>${u.btp.length}</b></div>
    </div><div id="tcd"></div></section>
   ${u.btp.length?`<section class="panel" style="margin-top:16px"><h3>Bán thành phẩm dùng nguyên liệu này</h3><div id="tcbtp"></div></section>`:''}`;
  combo($('#tcb'),items,`${code} — ${nvlLabel(code)}`,c=>{store.set('tracuu',c);go('tracuu',c)},'Gõ mã hoặc tên nguyên liệu…');
  sortable($('#tcd'),u.dish,[
    {h:'Mã món',v:x=>x.d.code,cls:'code'},{h:'Tên món',v:x=>x.d.name},{h:'Danh mục',v:x=>x.d.cat,f:x=>`<span class="muted">${esc(x.d.cat)}</span>`},{h:'ĐVT',v:x=>x.l.unit},
    {h:'Định lượng',n:1,v:x=>x.l.qty,f:x=>q(x.l.qty)},{h:'ĐL kế toán',n:1,v:x=>x.l.qtyAcc,f:x=>q(x.l.qtyAcc)},{h:'Thành tiền',n:1,v:x=>x.l.amount,f:x=>vnd(x.l.amount)},
    {h:'% cost món',n:1,v:x=>x.d.total?x.l.amount/x.d.total:null,f:x=>x.d.total?pct(x.l.amount/x.d.total):'—'}
  ],x=>go('cost',x.d.code));
  if(u.btp.length) sortable($('#tcbtp'),u.btp,[
    {h:'Mã BTP',v:x=>x.b.code,cls:'code'},{h:'Tên BTP',v:x=>x.b.name},{h:'Định lượng',n:1,v:x=>x.l.qty,f:x=>q(x.l.qty)},{h:'Thành tiền',n:1,v:x=>x.l.amount,f:x=>vnd(x.l.amount)}
  ],x=>go('btp',x.b.code));
};

/* ---------- list + detail helper ---------- */
function listDetail(title,desc,items,selKey,render,filterCats){
  const K=i=>i.id??i.code;
  let code=st.sel[selKey];if(!code||!items.find(i=>K(i)===code))code=K(items[0]);st.sel[selKey]=code;
  const f=st[selKey+'F']??={q:'',cat:''};
  $('#main').innerHTML=(typeof title==='object'?title.top:head(title,desc))+`<div class="grid-dt"><section class="panel"><div class="pad" style="display:grid;gap:8px;border-bottom:1px solid var(--line)">${searchInput(selKey+'-q','Tìm mã hoặc tên…',f.q)}${filterCats?`<select id="${selKey}-c"><option value="">Mọi danh mục</option>${filterCats.map(c=>`<option ${f.cat===c?'selected':''}>${esc(c)}</option>`).join('')}</select>`:''}</div><div class="list" id="ld-l"></div></section><section class="panel" id="ld-d" style="min-width:0"></section></div>`;
  const drawList=()=>{const qq=norm(f.q);const r=items.filter(i=>(!f.cat||i.cat===f.cat)&&(!qq||norm((i.code||'')+' '+i.name).includes(qq)));
    $('#ld-l').innerHTML=r.map(i=>`<div class="li" data-c="${esc(K(i))}" aria-selected="${K(i)===st.sel[selKey]}"><span class="c">${esc(i.code||'—')}</span><span class="nm">${esc(i.name)}</span>${i.badge||''}</div>`).join('')||'<div class="empty">Không có kết quả</div>'};
  const drawD=()=>{$('#ld-d').innerHTML=render(items.find(i=>K(i)===st.sel[selKey]));afterRender[selKey]?.()};
  $('#ld-l').onclick=e=>{const d=e.target.closest('[data-c]');if(!d)return;st.sel[selKey]=d.dataset.c;$('#ld-l').querySelectorAll('.li').forEach(x=>x.setAttribute('aria-selected',x===d));drawD();if(innerWidth<900)$('#ld-d').scrollIntoView({behavior:'smooth',block:'start'})};
  $('#'+selKey+'-q').oninput=e=>{f.q=e.target.value;drawList()};
  if(filterCats)$('#'+selKey+'-c').onchange=e=>{f.cat=e.target.value;drawList()};
  drawList();drawD();
  $('#ld-l .li[aria-selected="true"]')?.scrollIntoView({block:'nearest'});
}
const afterRender={};

/* ---------- BTP ---------- */
VIEWS.btp=function(){
  listDetail('Bán thành phẩm',`${D.btp.length} công thức BTP. Giá thành phẩm/kg = tổng chi phí nguyên liệu ÷ sản lượng thành phẩm.`,D.btp,'btp',b=>{
    const u=used[b.code];
    return `<div class="dhead"><h2>${esc(b.name)}</h2><span class="code" style="font-family:var(--f-display);font-size:18px;color:var(--muted)">${esc(b.code)}</span></div>
    <div class="facts"><div><small>Tổng nguyên liệu</small><b>${q(b.totalQty)} g</b></div><div><small>Sản lượng thành phẩm</small><b>${q(b.yld)} g</b></div>
     <div><small>Hiệu suất</small><b>${b.totalQty?pct(b.yld/b.totalQty):'—'}</b></div><div><small>Tổng chi phí</small><b>${vnd(b.totalCost)}</b></div>
     <div><small>Giá thành phẩm / kg</small><b style="color:var(--accent)">${vnd(b.pricePerKg)}</b></div></div>
    <div class="tbl"><table><thead><tr><th>Mã NVL</th><th>Tên nguyên liệu</th><th>ĐVT</th><th class="n">TL đạt</th><th class="n">Định lượng</th><th class="n">Giá nhập</th><th class="n">Thành tiền</th><th class="n">Tỷ trọng</th></tr></thead><tbody>
    ${b.items.map(l=>`<tr class="click" data-go="tracuu" data-sel="${esc(l.code)}"><td class="code">${esc(l.code)}</td><td>${esc(l.name)}</td><td>${esc(l.unit)}</td><td class="n">${pct(l.tl)}</td><td class="n">${q(l.qty)}</td><td class="n">${vnd(l.price)}</td><td class="n">${vnd(l.amount)}</td><td class="n">${b.totalCost?`<span class="share" style="width:${Math.max(2,l.amount/b.totalCost*60)}px"></span>${pct(l.amount/b.totalCost)}`:'—'}</td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="4">Tổng</td><td class="n">${q(b.totalQty)}</td><td></td><td class="n">${vnd(b.totalCost)}</td><td></td></tr></tfoot></table></div>
    <div class="sec"><h4>Món dùng BTP này</h4>${u?.dish.length?u.dish.map(x=>`<button class="chip" data-go="cost" data-sel="${x.d.code}" style="margin:0 6px 6px 0">${esc(x.d.code)} · ${esc(x.d.name)} · ${q(x.l.qty)}${esc(x.l.unit)}</button>`).join(''):'<span class="muted">Chưa món nào trong định mức dùng BTP này.</span>'}</div>`;
  });
};

/* ---------- MASTER ---------- */
VIEWS.master=function(){
  const rows=D.dishes.flatMap(d=>d.lines.map(l=>({d,l})));
  const f=st.masterF??={q:'',cat:''};
  $('#main').innerHTML=head('Định mức tiêu chuẩn (Master)',`${rows.length} dòng định lượng chuẩn theo món. Tìm theo món hoặc theo nguyên liệu; TL đạt lấy từ Danh mục NVL.`)+
   `<div class="toolbar">${searchInput('xq','Tìm mã/tên món hoặc mã/tên nguyên liệu…',f.q)}<select id="xc"><option value="">Mọi danh mục</option>${cats.map(c=>`<option ${f.cat===c?'selected':''}>${esc(c)}</option>`).join('')}</select></div>
   <section class="panel" id="xt"></section><div class="note" id="xsum"></div>`;
  const draw=()=>{const qq=norm(f.q);
    const r=rows.filter(x=>(!f.cat||x.d.cat===f.cat)&&(!qq||norm(x.d.code+' '+x.d.name+' '+x.l.code+' '+x.l.name).includes(qq)));
    const show=r.slice(0,400);
    $('#xsum').textContent=`${r.length} dòng khớp${r.length>400?' · đang hiện 400 dòng đầu, lọc thêm để thu hẹp':''}`;
    sortable($('#xt'),show,[
      {h:'Mã món',v:x=>x.d.code,cls:'code'},{h:'Tên món',v:x=>x.d.name},{h:'Mã NVL',v:x=>x.l.code,cls:'code'},{h:'Tên nguyên liệu',v:x=>x.l.name},{h:'ĐVT',v:x=>x.l.unit},
      {h:'Định lượng',n:1,v:x=>x.l.qty,f:x=>q(x.l.qty)},{h:'TL đạt',n:1,v:x=>x.l.tl,f:x=>pct(x.l.tl)},{h:'Ghi chú',v:x=>x.l.note||''}
    ],x=>go('cost',x.d.code));
  };
  $('#xq').oninput=e=>{f.q=e.target.value;draw()};$('#xc').onchange=e=>{f.cat=e.target.value;draw()};draw();
};

/* ---------- COST ---------- */
VIEWS.cost=function(){
  const items=D.dishes.map(d=>({...d,badge:menuBy[d.code]?.price?pillFor(d.total/menuBy[d.code].price):''}));
  listDetail('Food cost theo món','ĐL kế toán = định lượng ÷ TL đạt · Thành tiền = ĐL kế toán × giá/đvt. Nhập giá bán thử để xem tỷ lệ cost thay đổi thế nào.',items,'cost',d=>{
    const m=menuBy[d.code],price=m?.price||null;
    const lines=[...d.lines].sort((a,b)=>(b.amount||0)-(a.amount||0));
    const miss=d.lines.filter(l=>!l.price);
    const tq=d.lines.reduce((a,l)=>a+(l.qty||0),0),tqa=d.lines.reduce((a,l)=>a+(l.qtyAcc||0),0);
    return `<div class="dhead"><h2>${esc(d.name)}</h2><span class="code" style="font-family:var(--f-display);font-size:18px;color:var(--muted)">${esc(d.code)} · ${esc(d.cat)}</span>${jumpBtns(d.code)}</div>
    <div class="facts"><div><small>Giá bán</small><b>${vnd(price)}</b></div><div><small>Cost món</small><b>${vnd(d.total)}</b></div><div><small>Tỷ lệ cost</small><b>${pillFor(price?d.total/price:null)}</b></div>
     <div><small>Lãi gộp / món</small><b>${price?vnd(price-d.total):'—'}</b></div>
     <div><small>Giá bán thử</small><span><input type="number" id="wp" min="0" step="1000" placeholder="${price||'vd 99000'}" style="width:130px"> <span id="wpo" class="muted"></span></span></div>
     <div><small>Giá bán cần để đạt ${pct(TARGET)}</small><b>${vnd(Math.ceil(d.total/TARGET/1000)*1000)}</b></div></div>
    ${miss.length?`<div class="pad" style="border-bottom:1px solid var(--line)"><span class="pill bad">Thiếu giá</span> ${miss.map(l=>esc(l.code+' '+l.name)).join(', ')} chưa có trong Danh mục NVL nên đang tính 0đ.</div>`:''}
    <div class="tbl"><table><thead><tr><th>Mã NVL</th><th>Tên nguyên liệu</th><th>ĐVT</th><th class="n">Định lượng</th><th class="n">TL đạt</th><th class="n">ĐL kế toán</th><th class="n">Giá nhập</th><th class="n">Giá/đvt</th><th class="n">Thành tiền</th><th class="n">Tỷ trọng</th></tr></thead><tbody>
    ${lines.map(l=>`<tr class="click" data-go="${btpBy[l.code]?'btp':'tracuu'}" data-sel="${esc(l.code)}"><td class="code">${esc(l.code)}</td><td>${esc(l.name)}${l.note?`<div class="note" style="margin:0">${esc(l.note)}</div>`:''}</td><td>${esc(l.unit)}</td><td class="n">${q(l.qty)}</td><td class="n">${pct(l.tl)}</td><td class="n">${q(l.qtyAcc)}</td><td class="n">${l.price?vnd(l.price):'<span class="pill bad">0</span>'}</td><td class="n">${q(l.unitCost)}</td><td class="n">${vnd(l.amount)}</td><td class="n">${d.total?`<span class="share" style="width:${Math.max(2,(l.amount||0)/d.total*60)}px"></span>${pct((l.amount||0)/d.total)}`:'—'}</td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="3">Tổng định lượng / cost món</td><td class="n">${q(tq)}</td><td></td><td class="n">${q(tqa)}</td><td></td><td></td><td class="n">${vnd(d.total)}</td><td></td></tr></tfoot></table></div>
    <div class="note pad" style="margin:0">Bấm một dòng để tra cứu nguyên liệu đó (hoặc mở công thức nếu là BTP có trong tab Bán thành phẩm).</div>`;
  },cats);
  afterRender.cost=()=>{const d=dishBy[st.sel.cost],i=$('#wp');if(!i)return;i.oninput=()=>{const p=+i.value;$('#wpo').innerHTML=p>0?`→ ${pillFor(d.total/p)}`:''}};
  afterRender.cost();
};

/* ---------- CHART ---------- */
VIEWS.chart=function(){
  const ccats=[...new Set(D.charts.map(c=>c.cat))];
  const items=D.charts.map(c=>({...c,badge:c.img?'<span class="pill good">Ảnh</span>':''}));
  listDetail('Chart món bếp',`${D.charts.length} recipe card: nguyên liệu theo đơn vị bếp, quy trình, tiêu chí đạt và trình bày.`,items,'chart',c=>{
    const kv=a=>`<dl class="kv">${a.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${v?esc(v):PLACE}</dd>`).join('')}</dl>`;
    return `<div class="dhead"><h2>${esc(c.name)}</h2><span class="code" style="font-family:var(--f-display);font-size:18px;color:var(--muted)">${esc(c.code)} · ${esc(c.cat)}</span>${dishBy[c.code]?jumpBtns(c.code):''}</div>
    <div class="card"><div>
      <div class="sec"><h4>I. Nguyên liệu</h4>${c.ings.length?`<div class="tbl"><table><thead><tr><th>#</th><th>Tên nguyên liệu</th><th>ĐVT</th><th class="n">Số lượng</th></tr></thead><tbody>${c.ings.map((x,i)=>`<tr><td class="muted">${i+1}</td><td>${esc(x.name)}</td><td>${esc(x.unit)}</td><td class="n">${q(x.qty)}</td></tr>`).join('')}</tbody></table></div>`:PLACE}</div>
      <div class="sec"><h4>II. Quy trình thực hiện</h4>${c.steps.length?`<ol class="steps">${c.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol>`:PLACE}</div>
      <div class="sec"><h4>III. Tiêu chí đạt</h4>${kv(c.crit)}</div>
      <div class="sec"><h4>IV. Trình bày &amp; phục vụ</h4>${kv(c.serve)}</div>
    </div><div class="img">${c.img?`<img src="${c.img}" alt="Ảnh thành phẩm ${esc(c.name)}">`:'<span class="muted" style="text-align:center">Chưa có ảnh thành phẩm<br>(ảnh góc 45°)</span>'}</div></div>`;
  },ccats);
};

/* ---------- ĐÀO TẠO ---------- */
VIEWS.daotao=function(){
  const items=D.sops.map(s=>({...s,badge:s.steps.length?'':'<span class="pill mute">Nháp</span>'}));
  listDetail('Đào tạo SOP',`${D.sops.length} SOP quy trình món tiêu chuẩn. Nguyên liệu chuẩn tự động từ Master; phần còn lại do bếp trưởng bổ sung.`,items,'daotao',s=>{
    const kv=a=>`<dl class="kv">${a.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${v?esc(v):PLACE}</dd>`).join('')}</dl>`;
    return `<div class="dhead"><h2>${esc(s.name)}</h2><span class="code" style="font-family:var(--f-display);font-size:18px;color:var(--muted)">${esc(s.sopCode||'')} · ${esc(s.no)}</span>${jumpBtns(s.code)}</div>
    <div class="facts"><div><small>Mã món</small><b>${esc(s.code)}</b></div><div><small>Danh mục</small><b>${esc(s.cat)}</b></div><div><small>Giá bán</small><b>${esc(s.price)}</b></div></div>
    <div class="sec"><h4>Thông tin món</h4>${kv(s.info)}</div>
    <div class="sec"><h4>I. Mô tả món ăn</h4>${s.desc?esc(s.desc):PLACE}</div>
    <div class="sec"><h4>II. Nguyên liệu chuẩn</h4><div class="tbl"><table><thead><tr><th>#</th><th>Tên nguyên liệu</th><th>ĐVT</th><th class="n">ĐL chuẩn</th><th class="n">ĐL kế toán</th><th>Ghi chú</th></tr></thead><tbody>${s.ings.map((x,i)=>`<tr><td class="muted">${i+1}</td><td>${esc(x.name)}</td><td>${esc(x.unit)}</td><td class="n">${q(x.qty)}</td><td class="n">${q(x.qtyAcc)}</td><td>${esc(x.note||'')}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="sec"><h4>III. Quy trình thực hiện</h4>${s.steps.length?`<div class="tbl"><table><thead><tr><th>Bước</th><th>Thao tác</th><th>TG (phút)</th><th>Nhiệt độ</th><th>Lưu ý kỹ thuật</th></tr></thead><tbody>${s.steps.map((x,i)=>`<tr><td class="muted">${i+1}</td><td>${esc(x.t)}</td><td>${x.time?esc(x.time):'—'}</td><td>${x.temp?esc(x.temp):'—'}</td><td>${x.tip?esc(x.tip):PLACE}</td></tr>`).join('')}</tbody></table></div>`:PLACE}</div>
    <div class="sec"><h4>IV. Tiêu chuẩn chất lượng</h4><div class="tbl"><table><thead><tr><th>Tiêu chí</th><th>Đạt</th><th>Chưa đạt</th></tr></thead><tbody>${s.qual.map(([a,b,c])=>`<tr><td>${esc(a)}</td><td>${b?esc(b):PLACE}</td><td>${c?esc(c):PLACE}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="sec"><h4>V. Trình bày &amp; phục vụ</h4>${kv(s.serve)}</div>
    <div class="sec"><h4>VI. Checklist trước khi ra món</h4><ol class="steps">${['Nguyên liệu đúng định lượng Master','Sơ chế đúng kỹ thuật quy trình III','Nhiệt độ chế biến đúng quy định','Thành phẩm đúng tiêu chuẩn IV','Đĩa sạch, bày đúng chuẩn V','Nhiệt độ ra món đạt yêu cầu','Thời gian ra món đúng hạn'].map(x=>`<li>${x}</li>`).join('')}</ol></div>
    <div class="sec"><h4>VII. Lỗi thường gặp</h4>${s.errs.length?`<div class="tbl"><table><thead><tr><th>Lỗi</th><th>Nguyên nhân</th><th>Cách xử lý</th><th>Phòng tránh</th></tr></thead><tbody>${s.errs.map(r=>`<tr>${r.map(x=>`<td>${esc(x||'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:PLACE}</div>`;
  },cats);
};


/* ================= BAR & SỐT BẾP TỔNG ================= */
let barIdx = null, sotIdx = null;
const nz2 = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]/g, '');
function prepBarSot() {
  if (BAR) {
    BAR.recipes.forEach((r, i) => { r.id = 'r' + i; r.cat = r.sheet; });
    const byCode = {};
    // món trên menu ưu tiên công thức ở sheet không phải BTP
    BAR.recipes.forEach(r => { if (r.code && (!byCode[r.code] || byCode[r.code].sheet === 'BTP')) byCode[r.code] = r; });
    const used = {};
    BAR.recipes.forEach(r => r.items.forEach(l => { if (l.code) (used[l.code] ??= []).push({ r, l }); }));
    const nvl = Object.fromEntries(BAR.nvl.map(n => [n.code, n]));
    barIdx = { byCode, used, nvl };
  }
  if (SOT) {
    SOT.recipes.forEach((r, i) => { r.id = 's' + i; r.cat = r.sheet; });
    const used = {};
    SOT.recipes.forEach(r => r.items.forEach(l => { if (l.code) (used[l.code] ??= []).push({ r, l }); }));
    const priceOf = {};
    SOT.prices.forEach(p => { if (p.recipe != null && SOT.recipes[p.recipe]) priceOf[SOT.recipes[p.recipe].id] = p; });
    const nvl = Object.fromEntries(SOT.nvl.map(n => [n.code, n]));
    sotIdx = { used, priceOf, nvl };
  }
}
const qtyU = l => l.unit || (l.dv === 1 ? 'cái/quả' : 'g/ml');
function tabBar(id, tabs, cur) {
  return `<div class="chips" id="${id}" role="tablist" style="margin-bottom:14px">${tabs.map(([k, l]) => `<button class="chip" role="tab" data-t="${k}" aria-pressed="${k === cur}">${l}</button>`).join('')}</div>`;
}
function recipeTable(r, total) {
  total = total ?? r.items.reduce((a, l) => a + (l.amount || 0), 0);
  return `<div class="tbl"><table><thead><tr><th>Mã NVL</th><th>Tên nguyên liệu</th><th class="n">TL đạt</th><th class="n">Giá nhập</th><th class="n">Giá/đv</th><th class="n">Định lượng</th><th class="n">Thành tiền</th><th class="n">Tỷ trọng</th></tr></thead><tbody>
  ${[...r.items].sort((a, b) => (b.amount || 0) - (a.amount || 0)).map(l => `<tr><td class="code">${esc(l.code || '—')}</td><td>${esc(l.name)}${l.note ? `<div class="note" style="margin:0">${esc(l.note)}</div>` : ''}</td><td class="n">${l.tl != null ? pct(l.tl) : '—'}</td><td class="n">${l.price ? vnd(l.price) : (l.price === 0 ? '<span class="pill mute">0</span>' : '—')}</td><td class="n">${q(l.unitCost)}</td><td class="n">${q(l.qty)} <span class="muted">${qtyU(l)}</span></td><td class="n">${vnd(l.amount)}</td><td class="n">${total ? `<span class="share" style="width:${Math.max(2, (l.amount || 0) / total * 60)}px"></span>${pct((l.amount || 0) / total)}` : '—'}</td></tr>`).join('')}
  </tbody><tfoot><tr><td colspan="5">Tổng</td><td class="n">${q(r.totQty)}</td><td class="n">${vnd(r.total ?? total)}</td><td></td></tr></tfoot></table></div>`;
}

/* ---------- BAR ---------- */
VIEWS.bar = function () {
  if (!BAR) return;
  const tab = st.barTab || 'menu';
  if (tab === 'tq') return VIEWS['bar-tq']();
  syncNav('bar-' + tab);
  const tabs = [['menu', 'Menu & cost'], ['ct', 'Công thức'], ['nvl', 'Nguyên liệu bar']];
  if (BAR.charts?.length) tabs.push(['chart', 'Chart pha chế']);
  if (BAR.sops?.length) tabs.push(['sop', 'Đào tạo SOP']);
  const BT = { menu: ['Menu & cost Bar', 'Giá bán, cost và tỷ lệ cost từng món đồ uống, tráng miệng. Bấm một món để xem công thức.'], ct: ['Công thức pha chế', 'Định lượng, giá nhập, thành tiền và tỷ trọng từng nguyên liệu.'], nvl: ['Nguyên liệu bar', 'Bấm một nguyên liệu để xem các công thức đang dùng.'], chart: ['Chart pha chế', 'Recipe card bar: nguyên liệu, quy trình, tiêu chí đạt và trình bày.'], sop: ['Đào tạo SOP Bar', 'Công thức pha chế tiêu chuẩn cho nhân viên bar.'] };
  const top = head(BT[tab][0], `${BT[tab][1]}${BARMETA?.file ? ' · File: ' + esc(BARMETA.file) : ''}`);
  const bindTabs = () => { };
  if (tab === 'menu') {
    const f = st.barF ??= { q: '', g: '', off: false };
    const grps = [...new Set(BAR.menu.map(m => m.grp).filter(Boolean))];
    $('#main').innerHTML = top + `<div class="toolbar">${searchInput('bq', 'Tìm mã hoặc tên món…', f.q)}
      <select id="bg"><option value="">Mọi nhóm</option>${grps.map(g => `<option ${f.g === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
      <label class="muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="boff" ${f.off ? 'checked' : ''}> Hiện món đã bỏ</label></div>
      <section class="panel" id="bmt"></section><div class="note" id="bms"></div>`;
    const draw = () => {
      const qq = norm(f.q);
      const rows = BAR.menu.filter(m => (f.off || !m.off) && (!f.g || m.grp === f.g) && (!qq || norm((m.code || '') + ' ' + m.name).includes(qq)));
      const pr = rows.filter(m => m.price && m.cost);
      $('#bms').textContent = `${rows.length} món · tỷ lệ cost gia quyền ${pct(pr.reduce((a, m) => a + m.cost, 0) / pr.reduce((a, m) => a + m.price, 0))}`;
      sortable($('#bmt'), rows, [
        { h: 'Mã', v: m => m.code || '', cls: 'code' },
        { h: 'Tên món', v: m => m.name, f: m => `${esc(m.name)}${m.off ? ' <span class="pill mute">Đã bỏ</span>' : ''}${m.isNew ? ' <span class="pill good">Mới</span>' : ''}` },
        { h: 'Nhóm', v: m => m.grp || '', f: m => `<span class="muted">${esc(m.grp || '')}</span>` },
        { h: 'Giá bán', n: 1, v: m => m.price, f: m => vnd(m.price) },
        { h: 'Cost', n: 1, v: m => m.cost, f: m => vnd(m.cost) },
        { h: 'Tỷ lệ cost', n: 1, v: m => m.price && m.cost != null ? m.cost / m.price : null, f: m => m.cost == null ? '<span class="pill mute">Chưa có cost</span>' : pillFor(m.price ? m.cost / m.price : null) },
        { h: 'Ghi chú', v: m => m.note || '', f: m => `<span class="muted">${esc(m.note || '')}</span>` },
      ], m => { const r = barIdx.byCode[m.code]; if (r) { st.barTab = 'ct'; st.sel.barct = r.id; VIEWS.bar(); } else toast('Món này không có công thức pha chế (hàng mua sẵn).'); });
    };
    $('#bq').oninput = e => { f.q = e.target.value; draw(); };
    $('#bg').onchange = e => { f.g = e.target.value; draw(); };
    $('#boff').onchange = e => { f.off = e.target.checked; draw(); };
    bindTabs(); draw(); return;
  }
  if (tab === 'ct') {
    const items = BAR.recipes.map(r => ({ ...r, badge: r.off ? '<span class="pill mute">Dừng bán</span>' : (r.sell && r.total ? pillFor(r.total / r.sell) : '') }));
    listDetail({ top }, '', items, 'barct', r => {
      const menuItem = BAR.menu.find(m => m.code && m.code === r.code && barIdx.byCode[r.code] === BAR.recipes.find(x => x.id === r.id));
      const price = r.sell || menuItem?.price || r.head || null;
      const isBtp = r.sheet === 'BTP' || r.yld;
      const usedIn = r.code ? (barIdx.used[r.code] || []) : [];
      const jb = r.code && (BAR.charts?.some(x => x.code === r.code) || BAR.sops?.some(x => x.code === r.code)) ? `<div class="jump">${BAR.charts?.some(x => x.code === r.code) ? `<button class="btn" data-bj2="chart" data-bc="${esc(r.code)}">Chart</button>` : ''}${BAR.sops?.some(x => x.code === r.code) ? `<button class="btn" data-bj2="sop" data-bc="${esc(r.code)}">Đào tạo</button>` : ''}</div>` : '';
      return `<div class="dhead"><h2>${esc(r.name)}</h2><span class="code" style="font-family:var(--f-display);font-size:18px;color:var(--muted)">${esc(r.code || '—')} · ${esc(r.sheet)}</span>${jb}</div>
      <div class="facts">
        ${isBtp ? `<div><small>Tổng nguyên liệu</small><b>${q(r.totQty)}</b></div><div><small>Thành phẩm</small><b>${q(r.yld)}</b></div><div><small>Giá thành / kg</small><b style="color:var(--accent)">${vnd(r.perKg)}</b></div>`
          : `<div><small>Giá bán</small><b>${vnd(price)}</b></div><div><small>Cost món</small><b>${vnd(r.total)}</b></div><div><small>Tỷ lệ cost</small><b>${r.total != null && price ? pillFor(r.total / price) : '—'}</b></div><div><small>Lãi gộp / ly</small><b>${price && r.total != null ? vnd(price - r.total) : '—'}</b></div>`}
        ${r.off ? '<div><small>Trạng thái</small><b><span class="pill mute">Dừng bán</span></b></div>' : ''}</div>
      ${recipeTable(r, r.total)}
      ${usedIn.length ? `<div class="sec"><h4>Công thức đang dùng ${esc(r.code)}</h4>${usedIn.map(x => `<button class="chip" data-bar-r="${x.r.id}" style="margin:0 6px 6px 0">${esc(x.r.code || '')} · ${esc(x.r.name)} · ${q(x.l.qty)}</button>`).join('')}</div>` : ''}`;
    }, [...new Set(BAR.recipes.map(r => r.sheet))]);
    afterRender.barct = () => { document.querySelectorAll('[data-bar-r]').forEach(b => b.onclick = () => { st.sel.barct = b.dataset.barR; VIEWS.bar(); }); document.querySelectorAll('[data-bj2]').forEach(b => b.onclick = () => { st.barTab = b.dataset.bj2; st.sel[b.dataset.bj2 === 'chart' ? 'barch' : 'barsop'] = b.dataset.bc; VIEWS.bar(); }); };
    afterRender.barct(); bindTabs(); return;
  }
  const barJump = code => { const r = barIdx.byCode[code]; const c = BAR.charts?.find(x => x.code === code); const s = BAR.sops?.find(x => x.code === code);
    return `<div class="jump">${r ? `<button class="btn" data-bj="ct" data-bc="${r.id}">Cost</button>` : ''}${c ? `<button class="btn" data-bj="chart" data-bc="${esc(code)}">Chart</button>` : ''}${s ? `<button class="btn" data-bj="sop" data-bc="${esc(code)}">Đào tạo</button>` : ''}</div>`; };
  const bindJump = () => document.querySelectorAll('[data-bj]').forEach(b => b.onclick = () => { const k = b.dataset.bj; st.barTab = k; st.sel[k === 'ct' ? 'barct' : k === 'chart' ? 'barch' : 'barsop'] = b.dataset.bc; VIEWS.bar(); });
  const kv = a => `<dl class="kv">${a.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v ? esc(v) : PLACE.replace('Bếp', 'Bar')}</dd>`).join('')}</dl>`;
  const TODO = PLACE.replace('Bếp', 'Bar');
  if (tab === 'chart') {
    const items = BAR.charts.map(c => ({ ...c, id: c.code, badge: c.img ? '<span class="pill good">Ảnh</span>' : (c.steps.length ? '' : '<span class="pill mute">Nháp</span>') }));
    listDetail({ top }, '', items, 'barch', c => `<div class="dhead"><h2>${esc(c.name)}</h2><span class="code" style="font-family:var(--f-display);font-size:18px;color:var(--muted)">${esc(c.code)} · ${esc(c.cat || '')}</span>${barJump(c.code)}</div>
      <div class="card"><div>
        <div class="sec"><h4>I. Nguyên liệu</h4>${c.ings.length ? `<div class="tbl"><table><thead><tr><th>#</th><th>Tên nguyên liệu</th><th>ĐVT</th><th class="n">Số lượng</th></tr></thead><tbody>${c.ings.map((x, i) => `<tr><td class="muted">${i + 1}</td><td>${esc(x.name)}</td><td>${esc(x.unit)}</td><td class="n">${q(x.qty)}</td></tr>`).join('')}</tbody></table></div>` : TODO}</div>
        <div class="sec"><h4>II. Quy trình pha chế</h4>${c.steps.length ? `<ol class="steps">${c.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : TODO}</div>
        <div class="sec"><h4>III. Tiêu chí đạt</h4>${kv(c.crit)}</div>
        <div class="sec"><h4>IV. Trình bày &amp; phục vụ</h4>${kv(c.serve)}</div>
      </div><div class="img">${c.img ? `<img src="${c.img}" alt="Ảnh thành phẩm ${esc(c.name)}">` : '<span class="muted" style="text-align:center">Chưa có ảnh thành phẩm</span>'}</div></div>`, [...new Set(BAR.charts.map(c => c.cat).filter(Boolean))]);
    afterRender.barch = bindJump; bindJump(); bindTabs(); return;
  }
  if (tab === 'sop') {
    const items = BAR.sops.map(s => ({ ...s, id: s.code, badge: s.steps.length ? '' : '<span class="pill mute">Nháp</span>' }));
    listDetail({ top }, '', items, 'barsop', s => `<div class="dhead"><h2>${esc(s.name)}</h2><span class="code" style="font-family:var(--f-display);font-size:18px;color:var(--muted)">${esc(s.sopCode || '')} · ${esc(s.no)}</span>${barJump(s.code)}</div>
      <div class="facts"><div><small>Mã món</small><b>${esc(s.code)}</b></div><div><small>Danh mục</small><b>${esc(s.cat || '')}</b></div><div><small>Giá bán</small><b>${esc(s.price || '—')}</b></div></div>
      <div class="sec"><h4>I. Mô tả món</h4>${s.desc ? esc(s.desc) : TODO}</div>
      <div class="sec"><h4>II. Nguyên liệu chuẩn</h4><div class="tbl"><table><thead><tr><th>#</th><th>Tên nguyên liệu</th><th>ĐVT</th><th class="n">Số lượng</th><th>Ghi chú</th></tr></thead><tbody>${s.ings.map((x, i) => `<tr><td class="muted">${i + 1}</td><td>${esc(x.name)}</td><td>${esc(x.unit)}</td><td class="n">${q(x.qty)}</td><td>${esc(x.note || '')}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="sec"><h4>III. Quy trình pha chế</h4>${s.steps.length ? `<div class="tbl"><table><thead><tr><th>Bước</th><th>Thao tác</th><th>Lưu ý</th></tr></thead><tbody>${s.steps.map((x, i) => `<tr><td class="muted">${i + 1}</td><td>${esc(x.t)}</td><td>${x.tip ? esc(x.tip) : '—'}</td></tr>`).join('')}</tbody></table></div>` : TODO}</div>
      <div class="sec"><h4>IV. Tiêu chuẩn chất lượng</h4><div class="tbl"><table><thead><tr><th>Tiêu chí</th><th>Đạt</th><th>Chưa đạt</th></tr></thead><tbody>${s.qual.map(([a, b, c]) => `<tr><td>${esc(a)}</td><td>${b ? esc(b) : TODO}</td><td>${c ? esc(c) : TODO}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="sec"><h4>V. Trình bày &amp; phục vụ</h4>${kv(s.serve)}</div>`, [...new Set(BAR.sops.map(s => s.cat).filter(Boolean))]);
    afterRender.barsop = bindJump; bindJump(); bindTabs(); return;
  }
  // nguyên liệu bar
  const f = st.barNF ??= { q: '', sel: null };
  $('#main').innerHTML = top + `<div class="toolbar">${searchInput('bnq', 'Tìm mã hoặc tên nguyên liệu…', f.q)}</div><div class="grid2"><section class="panel" id="bnt"></section><section class="panel" id="bnu"></section></div>`;
  const showUse = code => {
    const u = barIdx.used[code] || [], n = barIdx.nvl[code];
    $('#bnu').innerHTML = `<h3>${esc(code)} · ${esc(n?.name || '')}</h3>${u.length ? `<div class="tbl"><table><thead><tr><th>Công thức</th><th class="n">Định lượng</th><th class="n">Thành tiền</th></tr></thead><tbody>${u.map(x => `<tr class="click" data-bar-r="${x.r.id}"><td>${esc(x.r.name)} <span class="muted">· ${esc(x.r.sheet)}</span></td><td class="n">${q(x.l.qty)}</td><td class="n">${vnd(x.l.amount)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Chưa công thức nào dùng nguyên liệu này.</div>'}`;
    $('#bnu').querySelectorAll('[data-bar-r]').forEach(t => t.onclick = () => { st.barTab = 'ct'; st.sel.barct = t.dataset.barR; VIEWS.bar(); });
  };
  const draw = () => {
    const qq = norm(f.q);
    const rows = BAR.nvl.filter(n => !qq || norm(n.code + ' ' + n.name).includes(qq));
    sortable($('#bnt'), rows, [
      { h: 'Mã', v: n => n.code, cls: 'code' }, { h: 'Tên hàng', v: n => n.name }, { h: 'ĐVT', v: n => n.unit },
      { h: 'TL đạt', n: 1, v: n => n.tl, f: n => n.tl != null ? pct(n.tl) : '—' }, { h: 'Đơn giá', n: 1, v: n => n.price, f: n => vnd(n.price) },
      { h: 'Số CT dùng', n: 1, v: n => (barIdx.used[n.code] || []).length },
    ], n => { f.sel = n.code; showUse(n.code); });
  };
  $('#bnq').oninput = e => { f.q = e.target.value; draw(); };
  bindTabs(); draw();
  if (f.sel) showUse(f.sel); else $('#bnu').innerHTML = '<div class="empty">Bấm một nguyên liệu để xem các công thức đang dùng.</div>';
};

/* ---------- SỐT BẾP TỔNG ---------- */
VIEWS.sot = function () {
  if (!SOT) return;
  const tab = st.sotTab || 'gia';
  if (tab === 'tq') return VIEWS['sot-tq']();
  syncNav('sot-' + tab);
  const STT = { gia: ['Bảng giá sốt xuống cơ sở', esc(SOT.priceLabel || 'Đơn giá bán sốt bếp tổng xuống cơ sở')], ct: ['Công thức sốt bếp tổng', 'Công thức, thành phẩm, giá thành/kg và các món bếp đang dùng.'], nvl: ['Danh mục NVL bếp tổng', 'Đơn giá gốc và giá bán xuống cơ sở.'] };
  const top = head(STT[tab][0], `${STT[tab][1]}${SOTMETA?.file ? ' · File: ' + esc(SOTMETA.file) : ''}`);
  const bindTabs = () => { };
  const usedInKitchen = code => (D && code) ? D.dishes.filter(x => x.lines.some(l => l.code === code)) : [];
  if (tab === 'gia') {
    const f = st.sotF ??= { q: '', chg: false };
    $('#main').innerHTML = top + `<div class="toolbar">${searchInput('sq', 'Tìm mã hoặc tên sốt…', f.q)}<label class="muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="schg" ${f.chg ? 'checked' : ''}> Chỉ hiện mã đổi giá</label></div>
      <section class="panel" id="spt"></section>${SOT.note ? `<div class="note">${esc(SOT.note)}</div>` : ''}`;
    const draw = () => {
      const qq = norm(f.q);
      const rows = SOT.prices.filter(p => (!qq || norm(p.code + ' ' + p.name).includes(qq)) && (!f.chg || (p.oldPrice && p.price !== p.oldPrice)));
      sortable($('#spt'), rows, [
        { h: 'Mã', v: p => p.code, cls: 'code' }, { h: 'Tên hàng', v: p => p.name }, { h: 'ĐVT', v: p => p.unit },
        { h: 'Giá cũ', n: 1, v: p => p.oldPrice, f: p => p.oldPrice ? vnd(p.oldPrice) : '<span class="muted">—</span>' },
        { h: 'Giá bán mới', n: 1, v: p => p.price, f: p => `<b>${vnd(p.price)}</b>${p.oldPrice && p.price !== p.oldPrice ? ` <span class="pill ${p.price > p.oldPrice ? 'warn' : 'good'}">${p.price > p.oldPrice ? '+' : ''}${vnd(p.price - p.oldPrice)}</span>` : ''}` },
        { h: 'Giá cost/kg', n: 1, v: p => p.unitCost, f: p => vnd(p.unitCost) },
        { h: 'Cost / giá bán', n: 1, v: p => p.ratio, f: p => p.ratio != null ? `<span class="pill ${p.ratio <= 0.5 ? 'good' : p.ratio <= 0.7 ? 'warn' : 'bad'}">${pct(p.ratio)}</span>` : '—' },
        { h: 'Công thức', v: p => p.recipe != null ? 1 : 0, f: p => p.recipe != null ? '<span class="pill good">Có</span>' : '<span class="muted">—</span>' },
      ], p => { if (p.recipe != null) { st.sotTab = 'ct'; st.sel.sotct = SOT.recipes[p.recipe].id; VIEWS.sot(); } else toast('Mã này chưa có công thức trong file (hàng mua sẵn hoặc chưa khai báo).'); });
    };
    $('#sq').oninput = e => { f.q = e.target.value; draw(); };
    $('#schg').onchange = e => { f.chg = e.target.checked; draw(); };
    bindTabs(); draw(); return;
  }
  if (tab === 'ct') {
    const items = SOT.recipes.map(r => ({ ...r, badge: sotIdx.priceOf[r.id] ? '<span class="pill good">Có giá bán</span>' : '' }));
    listDetail({ top }, '', items, 'sotct', r => {
      const p = sotIdx.priceOf[r.id];
      const kit = usedInKitchen(r.code);
      const usedBy = r.code ? (sotIdx.used[r.code] || []).filter(x => x.r.id !== r.id) : [];
      const margin = p && r.perKg ? p.price - r.perKg : null;
      return `<div class="dhead"><h2>${esc(r.name)}</h2><span class="code" style="font-family:var(--f-display);font-size:18px;color:var(--muted)">${esc(r.code || '—')} · ${esc(r.sheet)}</span></div>
      <div class="facts"><div><small>Tổng nguyên liệu</small><b>${q(r.totQty)}</b></div><div><small>Thành phẩm</small><b>${q(r.yld)}</b></div>
        <div><small>Giá thành / kg</small><b style="color:var(--accent)">${vnd(r.perKg)}</b></div>
        ${p ? `<div><small>Giá bán xuống cơ sở</small><b>${vnd(p.price)}</b></div><div><small>Chênh lệch / kg</small><b>${margin != null ? vnd(margin) : '—'}</b></div>` : '<div><small>Giá bán xuống cơ sở</small><b class="muted">Chưa có trong bảng giá</b></div>'}</div>
      ${recipeTable(r, r.total)}
      ${p && r.perKg && p.unitCost && Math.abs(r.perKg - p.unitCost) / p.unitCost > 0.02 ? `<div class="pad"><span class="pill warn">Lệch giá cost</span> Công thức tính ${vnd(r.perKg)}/kg, bảng giá ghi ${vnd(p.unitCost)}/kg. Nên kiểm tra lại.</div>` : ''}
      ${usedBy.length ? `<div class="sec"><h4>Sốt khác dùng ${esc(r.code)}</h4>${usedBy.map(x => `<button class="chip" data-sot-r="${x.r.id}" style="margin:0 6px 6px 0">${esc(x.r.name)} · ${q(x.l.qty)}</button>`).join('')}</div>` : ''}
      ${kit.length ? `<div class="sec"><h4>Món bếp đang dùng (theo định mức)</h4>${kit.map(x => `<button class="chip" data-go="cost" data-sel="${x.code}" style="margin:0 6px 6px 0">${esc(x.code)} · ${esc(x.name)}</button>`).join('')}</div>` : ''}`;
    }, [...new Set(SOT.recipes.map(r => r.sheet))]);
    afterRender.sotct = () => { document.querySelectorAll('[data-sot-r]').forEach(b => b.onclick = () => { st.sel.sotct = b.dataset.sotR; VIEWS.sot(); }); };
    afterRender.sotct(); bindTabs(); return;
  }
  const f = st.sotNF ??= { q: '', sec: '' };
  const secs = [...new Set(SOT.nvl.map(n => n.sec).filter(Boolean))];
  $('#main').innerHTML = top + `<div class="toolbar">${searchInput('snq', 'Tìm mã hoặc tên…', f.q)}<select id="sns"><option value="">Mọi nhóm</option>${secs.map(s => `<option ${f.sec === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div><section class="panel" id="snt"></section>`;
  const draw = () => {
    const qq = norm(f.q);
    const rows = SOT.nvl.filter(n => (!f.sec || n.sec === f.sec) && (!qq || norm(n.code + ' ' + n.name).includes(qq)));
    sortable($('#snt'), rows, [
      { h: 'Mã', v: n => n.code, cls: 'code' }, { h: 'Nguyên liệu', v: n => n.name }, { h: 'ĐVT', v: n => n.unit }, { h: 'Nhóm', v: n => n.sec || '', f: n => `<span class="muted">${esc(n.sec || '')}</span>` },
      { h: 'TL đạt', n: 1, v: n => n.tl, f: n => n.tl != null ? pct(n.tl) : '—' }, { h: 'Đơn giá gốc', n: 1, v: n => n.base, f: n => vnd(n.base) },
      { h: 'Giá bán xuống CS', n: 1, v: n => n.sell, f: n => n.sell ? vnd(n.sell) : '<span class="muted">—</span>' },
      { h: 'Số CT dùng', n: 1, v: n => (sotIdx.used[n.code] || []).length },
    ]);
  };
  $('#snq').oninput = e => { f.q = e.target.value; draw(); };
  $('#sns').onchange = e => { f.sec = e.target.value; draw(); };
  bindTabs(); draw();
};

/* ---------- điều hướng theo phân hệ ---------- */
['menu', 'ct', 'nvl', 'chart', 'sop'].forEach(k => { VIEWS['bar-' + k] = () => { st.barTab = k; VIEWS.bar(); }; });
['gia', 'ct', 'nvl'].forEach(k => { VIEWS['sot-' + k] = () => { st.sotTab = k; VIEWS.sot(); }; });
const barBar = (lbl, n, r, maxR) => { const cl = r <= TARGET ? '' : r <= TARGET + .1 ? 'w' : 'b'; return `<div class="bar"><span class="lb" title="${esc(lbl)}">${esc(lbl)} <span class="muted">(${n})</span></span><span class="t"><i class="${cl}" style="width:${r / maxR * 100}%"></i><span class="tg" style="left:${TARGET / maxR * 100}%"></span></span><span style="text-align:right;font-variant-numeric:tabular-nums">${pct(r)}</span></div>`; };
VIEWS['bar-tq'] = function () {
  if (!BAR) return; syncNav('bar-tq'); st.barTab = 'tq';
  const on = BAR.menu.filter(m => !m.off), pr = on.filter(m => m.price && m.cost != null);
  const w = pr.reduce((a, m) => a + m.cost, 0) / pr.reduce((a, m) => a + m.price, 0);
  const over = pr.filter(m => m.cost / m.price > TARGET);
  const grps = [...new Set(pr.map(m => m.grp).filter(Boolean))].map(g => { const ms = pr.filter(m => m.grp === g); return { g, n: ms.length, r: ms.reduce((a, m) => a + m.cost, 0) / ms.reduce((a, m) => a + m.price, 0) }; }).sort((a, b) => b.r - a.r);
  const maxR = Math.max(TARGET, ...grps.map(x => x.r)) * 1.15;
  const miss = BAR.recipes.flatMap(r => r.items.filter(l => l.price === 0 || l.price == null).map(l => r.code + ' – ' + (l.code || '') + ' ' + l.name));
  const todoC = (BAR.charts || []).filter(c => !c.steps.length).length, todoS = (BAR.sops || []).filter(s => !s.steps.length).length;
  $('#main').innerHTML = head('Tổng quan Bar', `Mục tiêu tỷ lệ cost ${pct(TARGET)} (chỉnh ở Tổng quan Bếp).${BARMETA?.file ? ' File: ' + esc(BARMETA.file) : ''}`) + `
  <div class="kpis"><div class="kpi"><div class="l">Món đang bán</div><div class="v">${on.length}</div><div class="s">${grps.length} nhóm${BAR.menu.length > on.length ? ' · ' + (BAR.menu.length - on.length) + ' món đã bỏ' : ''}</div></div>
    <div class="kpi"><div class="l">Tỷ lệ cost bình quân</div><div class="v">${pct(w)}</div><div class="s">Gia quyền theo giá bán</div></div>
    <div class="kpi"><div class="l">Món vượt mục tiêu</div><div class="v" style="color:var(--bad)">${over.length}</div><div class="s">trên ${pr.length} món có giá</div></div>
    <div class="kpi"><div class="l">Công thức · NVL</div><div class="v">${BAR.recipes.length}</div><div class="s">${BAR.nvl.length} nguyên liệu bar</div></div></div>
  <div class="grid2"><section class="panel"><h3>Tỷ lệ cost theo nhóm</h3><div class="pad"><div class="bars">${grps.map(x => barBar(x.g, x.n, x.r, maxR)).join('')}</div><div class="note">Vạch đậm = mục tiêu ${pct(TARGET)}.</div></div></section>
  <section class="panel"><h3>10 món tỷ lệ cost cao nhất</h3><div id="btop"></div></section></div>
  <section class="panel" style="margin-top:16px"><h3>Cảnh báo & tiến độ</h3><div class="pad" style="display:grid;gap:8px">
    <div><span class="pill ${miss.length ? 'bad' : 'good'}">${miss.length} dòng</span> nguyên liệu chưa có giá nhập${miss.length ? ': <span class="muted">' + miss.slice(0, 12).map(esc).join(' · ') + '</span>' : ''}</div>
    ${BAR.charts?.length ? `<div><span class="pill ${todoC ? 'warn' : 'good'}">${BAR.charts.length - todoC}/${BAR.charts.length}</span> Chart pha chế đã có quy trình</div>` : ''}
    ${BAR.sops?.length ? `<div><span class="pill ${todoS ? 'warn' : 'good'}">${BAR.sops.length - todoS}/${BAR.sops.length}</span> SOP đào tạo đã có quy trình</div>` : ''}</div></section>`;
  sortable($('#btop'), [...pr].sort((a, b) => b.cost / b.price - a.cost / a.price).slice(0, 10), [
    { h: 'Mã', v: m => m.code, cls: 'code' }, { h: 'Món', v: m => m.name }, { h: 'Giá bán', n: 1, v: m => m.price, f: m => vnd(m.price) }, { h: 'Cost', n: 1, v: m => m.cost, f: m => vnd(m.cost) }, { h: 'Tỷ lệ', n: 1, v: m => m.cost / m.price, f: m => pillFor(m.cost / m.price) }
  ], m => { const r = barIdx.byCode[m.code]; if (r) { st.sel.barct = r.id; go('bar-ct'); } });
};
VIEWS['sot-tq'] = function () {
  if (!SOT) return; syncNav('sot-tq'); st.sotTab = 'tq';
  const P = SOT.prices, chg = P.filter(p => p.oldPrice && p.price !== p.oldPrice);
  const withR = P.filter(p => p.ratio != null), avg = withR.reduce((a, p) => a + p.ratio, 0) / (withR.length || 1);
  const hi = withR.filter(p => /^BTP/i.test(p.code)).sort((a, b) => b.ratio - a.ratio).slice(0, 10);
  const lech = P.filter(p => p.recipe != null && SOT.recipes[p.recipe]?.perKg && p.unitCost && Math.abs(SOT.recipes[p.recipe].perKg - p.unitCost) / p.unitCost > 0.02);
  $('#main').innerHTML = head('Tổng quan Bếp tổng', `${esc(SOT.priceLabel || '')}${SOTMETA?.file ? ' · File: ' + esc(SOTMETA.file) : ''}`) + `
  <div class="kpis"><div class="kpi"><div class="l">Mã trong bảng giá</div><div class="v">${P.length}</div><div class="s">${P.filter(p => p.recipe != null).length} mã có công thức</div></div>
    <div class="kpi"><div class="l">Mã đổi giá</div><div class="v">${chg.length}</div><div class="s">so với giá cũ</div></div>
    <div class="kpi"><div class="l">Cost / giá bán TB</div><div class="v">${pct(avg)}</div><div class="s">trung bình đơn giản</div></div>
    <div class="kpi"><div class="l">Công thức sốt</div><div class="v">${SOT.recipes.length}</div><div class="s">${SOT.nvl.length} mã danh mục</div></div></div>
  <div class="grid2"><section class="panel"><h3>Mã đổi giá</h3><div id="schgt"></div></section><section class="panel"><h3>10 sốt tỷ lệ cost cao nhất</h3><div id="shit"></div></section></div>
  ${lech.length ? `<section class="panel" style="margin-top:16px"><h3>Lệch giá cost giữa bảng giá và công thức</h3><div class="pad">${lech.map(p => `<div><span class="code" style="font-family:var(--f-display)">${esc(p.code)}</span> ${esc(p.name)}: bảng giá ${vnd(p.unitCost)}/kg · công thức ${vnd(SOT.recipes[p.recipe].perKg)}/kg</div>`).join('')}</div></section>` : ''}`;
  const open = p => { if (p.recipe != null) { st.sel.sotct = SOT.recipes[p.recipe].id; go('sot-ct'); } };
  sortable($('#schgt'), chg, [{ h: 'Mã', v: p => p.code, cls: 'code' }, { h: 'Tên', v: p => p.name }, { h: 'Giá cũ', n: 1, v: p => p.oldPrice, f: p => vnd(p.oldPrice) }, { h: 'Giá mới', n: 1, v: p => p.price, f: p => `<b>${vnd(p.price)}</b>` }, { h: 'Chênh', n: 1, v: p => p.price - p.oldPrice, f: p => `<span class="pill ${p.price > p.oldPrice ? 'warn' : 'good'}">${p.price > p.oldPrice ? '+' : ''}${vnd(p.price - p.oldPrice)}</span>` }], open);
  sortable($('#shit'), hi, [{ h: 'Mã', v: p => p.code, cls: 'code' }, { h: 'Tên', v: p => p.name }, { h: 'Giá bán', n: 1, v: p => p.price, f: p => vnd(p.price) }, { h: 'Cost/kg', n: 1, v: p => p.unitCost, f: p => vnd(p.unitCost) }, { h: 'Tỷ lệ', n: 1, v: p => p.ratio, f: p => `<span class="pill ${p.ratio <= 0.5 ? 'good' : p.ratio <= 0.7 ? 'warn' : 'bad'}">${pct(p.ratio)}</span>` }], open);
};

/* ================= Bộ tính lại cost (dùng khi sửa trực tiếp trên app) =================
   Công thức giữ đúng như file Excel:
   A – món bếp / bar mẫu mới : ĐL kế toán = ĐL ÷ TL đạt ; Thành tiền = ĐL kế toán × Giá nhập ÷ đv
   B – công thức BTP bếp     : Thành tiền = ĐL × Giá nhập ÷ đv (không tính TL)
   C – bar mẫu cũ / sốt BT   : Thành tiền = ĐL × Giá nhập ÷ đv ÷ TL đạt
   Giá/kg thành phẩm = Tổng tiền ÷ Sản lượng × 1000 */
(function (root) {
  const close = (a, b, tol = 1) => a != null && b != null && Math.abs(a - b) <= tol;
  const r4 = v => v == null || !isFinite(v) ? v : Math.round(v * 1e4) / 1e4;
  const r2 = v => v == null || !isFinite(v) ? v : Math.round(v * 100) / 100;
  const divOf = (price, unitCost, unit, tl, f) => {
    if (price && unitCost) { const d = Math.round(price / (unitCost * (f === 'C' ? (tl || 1) : 1))); if (d >= 900) return 1000; if (d > 0) return d; }
    return /^(g|ml|kg|l|lit|gram)$/i.test(String(unit || '').trim()) ? 1000 : 1000;
  };
  const nvlDiv = n => { if (n.div) return n.div; if (n.price && n.unitCost && n.tl) { const d = Math.round(n.price / (n.unitCost * n.tl)); return d >= 900 ? 1000 : (d || 1000); } return /^(cái|quả|chai|lon|suất|hộp|gói)$/i.test(n.unit || '') ? 1 : 1000; };

  function prepLine(l, f, cat) {
    if (l.f) return;
    l.f = f; l.div = l.div || (l.dv === 1 ? 1 : divOf(l.price, l.unitCost, l.unit, l.tl, f));
    const n = l.code && cat[l.code];
    l.lk = !!(n && close(n.price, l.price, 1) && (f === 'B' || n.tl == null || l.tl == null || Math.abs(n.tl - l.tl) < 1e-6));
  }
  function calcLine(l, cat) {
    const n = l.lk && l.code && cat[l.code];
    if (n) { l.price = n.price; if (l.f !== 'B' && n.tl != null) l.tl = n.tl; }
    const p = l.price || 0, tl = l.tl || 1, q = l.qty || 0, d = l.div || 1000;
    let raw;
    if (l.f === 'A') { l.qtyAcc = r4(q / tl); l.unitCost = r4(p / d); raw = q / tl * p / d; }
    else if (l.f === 'B') { l.unitCost = r4(p / d); raw = q * p / d; }
    else { l.unitCost = r4(p / d / tl); raw = q * p / d / tl; }
    l.amount = r2(raw * (l.k ?? 1));
  }
  /* hệ số hiệu chỉnh: giữ nguyên đúng số trong file khi chưa sửa gì */
  function calib(lines, cont, cat, origTotalKey, perKey) {
    const orig = lines.map(l => l.amount), origTotal = cont[origTotalKey], origPer = perKey ? cont[perKey] : null;
    lines.forEach((l, i) => { const o = orig[i]; l.k = 1; calcLine(l, cat); l.k = o != null && l.amount ? o / l.amount : 1; l.amount = o; });
    const sum = lines.reduce((a, l) => a + (l.amount || 0), 0);
    cont._tk = origTotal != null && sum ? origTotal / sum : 1;
    if (perKey) { const t = origTotal ?? sum; cont._pk = origPer != null && t ? origPer / t : null; }
  }
  const catOf = arr => Object.fromEntries((arr || []).map(n => [n.code, n]));
  function calcNvl(n) { n.div = nvlDiv(n); if (n.price != null && n.tl) n.unitCost = r4(n.price / n.div / n.tl); }

  /* ---------- BẾP ---------- */
  function prepBep(D) {
    if (D._prep) return; const cat = catOf(D.nvl);
    D.nvl.forEach(n => { n.div = nvlDiv(n); });
    D.btp.forEach(b => { b.items.forEach(l => prepLine(l, 'B', cat)); const n = cat[b.code]; b.lk = !!(n && close(n.price, b.pricePerKg, 1)); calib(b.items, b, cat, 'totalCost', 'pricePerKg'); });
    D.dishes.forEach(x => { x.lines.forEach(l => prepLine(l, 'A', cat)); calib(x.lines, x, cat, 'total'); });
    D._prep = true;
  }
  function recalcBep(D) {
    prepBep(D); const cat = catOf(D.nvl);
    D.nvl.forEach(calcNvl);
    for (let pass = 0; pass < 4; pass++) D.btp.forEach(b => {
      b.items.forEach(l => calcLine(l, cat));
      b.totalQty = r2(b.items.reduce((a, l) => a + (l.qty || 0), 0));
      b.totalCost = r2(b.items.reduce((a, l) => a + (l.amount || 0), 0) * (b._tk ?? 1));
      if (b._pk != null) b.pricePerKg = r2(b.totalCost * b._pk);
      const n = cat[b.code]; if (b.lk && n && b.pricePerKg != null) { n.price = b.pricePerKg; calcNvl(n); }
    });
    const menuBy = Object.fromEntries(D.menu.map(m => [m.code, m]));
    D.dishes.forEach(x => {
      x.lines.forEach(l => calcLine(l, cat));
      x.total = r2(x.lines.reduce((a, l) => a + (l.amount || 0), 0) * (x._tk ?? 1));
      const m = menuBy[x.code]; if (m) { m.cost = x.total; if (x.price != null && m.price == null) m.price = x.price; }
    });
    return D;
  }

  /* ---------- BAR ---------- */
  function prepBar(B) {
    if (B._prep) return; const cat = catOf(B.nvl);
    B.nvl.forEach(n => { n.div = nvlDiv(n); });
    B.recipes.forEach(r => { r.items.forEach(l => prepLine(l, B.fmt === 2 ? 'A' : 'C', cat)); const n = r.code && cat[r.code]; r.lk = !!(n && r.perKg && close(n.price, r.perKg, 1)); calib(r.items, r, cat, 'total', r.perKg != null || r.yld ? 'perKg' : null); });
    B._prep = true;
  }
  function recalcBar(B) {
    prepBar(B); const cat = catOf(B.nvl);
    B.nvl.forEach(calcNvl);
    for (let pass = 0; pass < 3; pass++) B.recipes.forEach(r => {
      r.items.forEach(l => calcLine(l, cat));
      r.totQty = r2(r.items.reduce((a, l) => a + (l.qty || 0), 0));
      r.total = r2(r.items.reduce((a, l) => a + (l.amount || 0), 0) * (r._tk ?? 1));
      if (r._pk != null) r.perKg = r2(r.total * r._pk);
      const sell = r.sell; if (sell) r.ratio = r.total / sell;
      const n = r.code && cat[r.code]; if (r.lk && n && r.perKg != null) { n.price = r.perKg; calcNvl(n); }
    });
    const byCode = {}; B.recipes.forEach(r => { if (r.code && !r.yld && (!byCode[r.code] || byCode[r.code].sheet === 'BTP')) byCode[r.code] = r; });
    B.menu.forEach(m => { const r = byCode[m.code]; if (r) { m.cost = r.total; if (r.sell != null) m.price = r.sell; } });
    return B;
  }

  /* ---------- SỐT BẾP TỔNG ---------- */
  function prepSot(S) {
    if (S._prep) return; const cat = Object.fromEntries((S.nvl || []).map(n => [n.code, { ...n, price: n.base }]));
    const recByCode = {}; S.recipes.forEach(r => { if (r.code) (recByCode[r.code] ??= []).push(r); });
    S.recipes.forEach(r => r.items.forEach(l => {
      prepLine(l, 'C', cat);
      const src = l.code && recByCode[l.code]?.length === 1 ? recByCode[l.code][0] : null; // sốt dùng sốt khác
      l.src = src && src !== r && close(src.perKg, l.price, 1) ? S.recipes.indexOf(src) : null;
      if (l.src != null) l.lk = false;
    }));
    S.recipes.forEach(r => calib(r.items, r, cat, 'total', 'perKg'));
    S.prices.forEach(p => { const r = p.recipe != null ? S.recipes[p.recipe] : null; p.lk = !!(r && r.perKg && p.unitCost && Math.abs(r.perKg - p.unitCost) / p.unitCost < 0.005); });
    S._prep = true;
  }
  function recalcSot(S) {
    prepSot(S); const cat = Object.fromEntries((S.nvl || []).map(n => [n.code, { code: n.code, price: n.base, tl: n.tl }]));
    for (let pass = 0; pass < 4; pass++) S.recipes.forEach(r => {
      r.items.forEach(l => { if (l.src != null && S.recipes[l.src]?.perKg != null) l.price = S.recipes[l.src].perKg; calcLine(l, cat); });
      r.totQty = r2(r.items.reduce((a, l) => a + (l.qty || 0), 0));
      r.total = r2(r.items.reduce((a, l) => a + (l.amount || 0), 0) * (r._tk ?? 1));
      if (r._pk != null) r.perKg = r2(r.total * r._pk);
    });
    S.prices.forEach(p => { const r = p.recipe != null ? S.recipes[p.recipe] : null; if (p.lk && r && r.perKg != null) p.unitCost = r.perKg; p.ratio = p.price && p.unitCost != null ? p.unitCost / p.price : p.ratio; });
    return S;
  }

  const api = { recalcBep, recalcBar, recalcSot, prepBep, prepBar, prepSot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KBTEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* ================= SỬA DỮ LIỆU TRỰC TIẾP (chỉ Quản trị) ================= */
const EDIT = { on: false, snap: null, changes: [], dirty: { bep: false, bar: false, sot: false } };
const canEdit = () => isAdmin();
function parseNum(s) {
  s = String(s ?? '').trim().replace(/\s|đ|%/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const v = Number(s); return isFinite(v) ? v : NaN;
}
const parseTl = s => { const v = parseNum(s); if (v == null || isNaN(v)) return v; return v > 1.5 ? v / 100 : v; };
const fmtIn = v => v == null ? '' : (Math.round(v * 100) / 100).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const fmtTl = v => v == null ? '' : (Math.round(v * 1000) / 10).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
function rec(area, what, code, name, field, oldv, newv, ctx = '') {
  const k = [area, what, code, field, ctx].join('|');
  const ex = EDIT.changes.find(c => c.k === k);
  if (ex) { ex.new = newv; if (ex.new === ex.old) EDIT.changes.splice(EDIT.changes.indexOf(ex), 1); }
  else if (oldv !== newv) EDIT.changes.push({ k, area, what, code, name, field, old: oldv, new: newv, ctx });
  EDIT.dirty[area] = EDIT.changes.some(c => c.area === area);
  drawEditBar();
}
function recalc(area) {
  if (area === 'bep') { KBTEngine.recalcBep(D); setData(D); }
  if (area === 'bar') { KBTEngine.recalcBar(BAR); prepBarSot(); }
  if (area === 'sot') { KBTEngine.recalcSot(SOT); prepBarSot(); }
}
function startEdit() {
  if (!canEdit()) return;
  EDIT.snap = { D: D ? structuredClone(D) : null, BAR: BAR ? structuredClone(BAR) : null, SOT: SOT ? structuredClone(SOT) : null };
  if (D) KBTEngine.prepBep(D); if (BAR) KBTEngine.prepBar(BAR); if (SOT) KBTEngine.prepSot(SOT);
  EDIT.on = true; EDIT.changes = []; EDIT.dirty = { bep: false, bar: false, sot: false };
  document.body.classList.add('editing'); drawEditBar(); VIEWS[st.mod]?.();
  toast('Đã bật chế độ sửa. Sửa xong bấm Lưu ở thanh dưới cùng.');
}
function stopEdit(discard) {
  if (discard && EDIT.snap) { D = EDIT.snap.D; BAR = EDIT.snap.BAR; SOT = EDIT.snap.SOT; if (D) setData(D); prepBarSot(); }
  EDIT.on = false; EDIT.snap = null; EDIT.changes = []; EDIT.dirty = { bep: false, bar: false, sot: false };
  document.body.classList.remove('editing'); drawEditBar(); renderShell();
}
function drawEditBar() {
  const el = $('#editbar'); if (!el) return;
  document.querySelectorAll('.edit-toggle').forEach(b => { b.hidden = !canEdit() || EDIT.on; });
  if (!EDIT.on) { el.hidden = true; return; }
  el.hidden = false;
  const n = EDIT.changes.length;
  el.innerHTML = `<div class="eb-in"><div class="eb-t"><b>Chế độ sửa</b><span>${n ? `${n} thay đổi chưa lưu` : 'Chưa có thay đổi. Sửa ở: Danh mục NVL, Food cost, Bán thành phẩm, Menu, Công thức pha chế, Bảng giá sốt…'}</span></div>
    <div class="eb-b">${n ? '<button class="btn" id="ebList">Xem</button>' : ''}<button class="btn" id="ebCancel">${n ? 'Hủy thay đổi' : 'Thoát'}</button><button class="btn pri" id="ebSave" ${n ? '' : 'disabled'}>Lưu &amp; đăng</button></div></div>`;
  $('#ebCancel').onclick = () => { if (!n || confirm('Bỏ ' + n + ' thay đổi chưa lưu?')) stopEdit(true); };
  $('#ebSave').onclick = saveEdit;
  if (n) $('#ebList').onclick = showChanges;
}
const AREA_NAME = { bep: 'Bếp', bar: 'Bar', sot: 'Bếp tổng' };
const FIELD_NAME = { offst: 'Trạng thái', price: 'Giá nhập', base: 'Đơn giá gốc', tl: 'TL đạt', sell: 'Giá bán', qty: 'Định lượng', add: 'Thêm NVL', del: 'Xóa NVL', menuPrice: 'Giá bán', sellCs: 'Giá bán xuống CS', yld: 'Sản lượng', name: 'Tên', unit: 'ĐVT', cat: 'Danh mục', newnvl: 'Thêm NVL mới', delnvl: 'Xóa NVL', newitem: 'Thêm mới', delitem: 'Xóa' };
const fmtChange = c => typeof c.old === 'string' || typeof c.new === 'string' ? (c.old ?? '—') + ' → ' + (c.new ?? '—') : c.field === 'newitem' ? 'tạo mới' : c.field === 'delitem' ? 'đã xóa' : c.field === 'tl' ? pct(c.old) + ' → ' + pct(c.new) : (c.field === 'add' ? '+ ' + q(c.new) : c.field === 'del' ? 'xóa (' + q(c.old) + ')' : (c.old == null ? '—' : q(c.old)) + ' → ' + (c.new == null ? '—' : q(c.new)));
function showChanges() {
  $('#main').innerHTML = head('Thay đổi chưa lưu', 'Kiểm tra lại trước khi bấm Lưu & đăng.') + `<section class="panel"><div class="tbl"><table><thead><tr><th>Khu</th><th>Mã</th><th>Tên</th><th>Nội dung</th><th>Thay đổi</th></tr></thead><tbody>${EDIT.changes.map(c => `<tr><td>${AREA_NAME[c.area]}</td><td class="code">${esc(c.code || '')}</td><td>${esc(c.name || '')}${c.ctx ? `<div class="note" style="margin:0">${esc(c.ctx)}</div>` : ''}</td><td>${esc(FIELD_NAME[c.field] || c.field)}</td><td>${esc(fmtChange(c))}</td></tr>`).join('')}</tbody></table></div></section>`;
}
async function saveEdit() {
  const b = $('#ebSave'); b.disabled = true; b.textContent = 'Đang lưu…';
  try {
    const now = new Date().toISOString(), by = ME.name || ME.email;
    const jobs = [['bep', 'data', () => D, () => META], ['bar', 'bar', () => BAR, () => BARMETA], ['sot', 'sot', () => SOT, () => SOTMETA]].filter(([a]) => EDIT.dirty[a]);
    for (const [a, key, getD, getM] of jobs) {
      const m = getM() || {};
      const live = await API.stampOf(key);
      if (live && m.updated_at && live !== m.updated_at) throw new Error(`Dữ liệu ${AREA_NAME[a]} vừa được cập nhật ở máy khác. Bấm Hủy, tải lại app rồi sửa lại.`);
    }
    for (const [a, key, getD, getM] of jobs) {
      const d = structuredClone(getD()); if (a === 'bep') d.charts.forEach(c => { c.img = null; });
      const m = { ...(getM() || {}) }; delete m.updated_at;
      m.edited_at = now; m.edited_by = by; m.edits = (m.edits || 0) + EDIT.changes.filter(c => c.area === a).length;
      await API.publishExtra(key, d, m);
    }
    try { await API.appendLog(EDIT.changes.map(c => ({ at: now, by, area: c.area, code: c.code, name: c.name, field: c.field, old: c.old, new: c.new, ctx: c.ctx }))); } catch (e) { }
    const n = EDIT.changes.length;
    EDIT.on = false; EDIT.snap = null; EDIT.changes = []; EDIT.dirty = { bep: false, bar: false, sot: false }; document.body.classList.remove('editing'); drawEditBar();
    await loadData(true);
    toast(`Đã lưu ${n} thay đổi. Mọi người sẽ thấy số mới khi mở app.`);
  } catch (e) { b.disabled = false; b.textContent = 'Lưu & đăng'; toast('Chưa lưu được: ' + e.message); }
}

/* ---------- ô nhập & sự kiện chung ---------- */
const inp = (v, attrs, w = 92) => `<input class="ein" inputmode="decimal" value="${esc(v)}" ${attrs} style="width:${w}px">`;
function bindInputs(root, fn) {
  root.querySelectorAll('input.ein').forEach(i => {
    i.onfocus = () => i.select();
    i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); i.blur(); } };
    i.onchange = () => { const r = fn(i); if (r === false) { i.classList.add('bad'); } else i.classList.remove('bad'); };
  });
}
const tin = (v, attrs, w = 160) => `<input class="etx" value="${esc(v)}" ${attrs} style="width:${w}px;max-width:100%">`;
function bindText(root, fn) {
  root.querySelectorAll('input.etx, select.etx').forEach(i => {
    if (i.closest('.newform')) return;
    i.onkeydown = e => { if (e.key === 'Enter' && i.tagName === 'INPUT') { e.preventDefault(); i.blur(); } };
    i.onchange = () => { const r = fn(i); if (r === false) i.classList.add('bad'); else i.classList.remove('bad'); };
  });
}
const COUNT_UNITS = /^(cái|quả|qua|chai|lon|hộp|hop|gói|goi|suất|suat|lát|miếng|cây|bó|túi|vỉ|thanh|con|bình|ly|cốc|phần|đĩa|set|pcs)$/i;
const unitDiv = u => COUNT_UNITS.test(String(u || '').trim()) ? 1 : 1000;
const UNIT_DL = '<datalist id="unitlist"><option value="g"><option value="ml"><option value="kg"><option value="lít"><option value="cái"><option value="quả"><option value="chai"><option value="lon"><option value="hộp"><option value="gói"><option value="suất"></datalist>';
function eachLine(area, code, fn) {
  if (area === 'bep') { D.dishes.forEach(x => x.lines.forEach(l => { if (l.code === code) fn(l); })); D.btp.forEach(b => b.items.forEach(l => { if (l.code === code) fn(l); })); }
  if (area === 'bar') BAR.recipes.forEach(r => r.items.forEach(l => { if (l.code === code) fn(l); }));
  if (area === 'sot') SOT.recipes.forEach(r => r.items.forEach(l => { if (l.code === code) fn(l); }));
}
const flash = el => { if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); };

/* ---------- 1) Danh mục NVL (Bếp / Bar / Bếp tổng) ---------- */
function editNvl(area) {
  const DS = area === 'bep' ? D : area === 'bar' ? BAR : SOT;
  const list = DS.nvl, pk = area === 'sot' ? 'base' : 'price';
  const f = st['enf_' + area] ??= { q: '' };
  const usedN = code => area === 'bep' ? (used?.[code]?.dish.length || 0) + (used?.[code]?.btp.length || 0) : area === 'bar' ? (barIdx.used[code] || []).length : (sotIdx.used[code] || []).length;
  const title = { bep: 'Sửa danh mục NVL Bếp', bar: 'Sửa nguyên liệu Bar', sot: 'Sửa danh mục NVL Bếp tổng' }[area];
  $('#main').innerHTML = head(title, `Sửa ${area === 'sot' ? 'tên, ĐVT, đơn giá gốc, TL đạt, giá bán xuống cơ sở' : 'tên, ĐVT, giá nhập, TL đạt'}. Cost các món và bán thành phẩm dùng nguyên liệu đó tự tính lại. TL đạt nhập theo % (ví dụ 95). ĐVT là cái/quả/chai… thì giá nhập hiểu là giá 1 đơn vị.`) +
    `<div class="toolbar">${searchInput('enq', 'Tìm mã hoặc tên nguyên liệu…', f.q)}<button class="btn pri" id="ennew">+ Thêm nguyên liệu mới</button></div><div id="ennewf"></div><section class="panel"><div class="tbl" id="ent"></div></section><div class="note" id="ens"></div>${UNIT_DL}`;
  const draw = () => {
    const qq = norm(f.q);
    const rows = list.filter(n => !qq || norm(n.code + ' ' + n.name).includes(qq)).slice(0, 300);
    $('#ens').textContent = rows.length >= 300 ? 'Đang hiện 300 dòng đầu, gõ tìm để thu hẹp.' : `${rows.length} nguyên liệu`;
    $('#ent').innerHTML = `<table><thead><tr><th>Mã</th><th>Tên nguyên liệu</th><th>ĐVT</th><th class="n">${area === 'sot' ? 'Đơn giá gốc' : 'Giá nhập'}</th><th class="n">TL đạt %</th>${area === 'sot' ? '<th class="n">Giá bán xuống CS</th>' : '<th class="n">Giá/đvt thực tế</th>'}<th class="n">Số nơi dùng</th></tr></thead><tbody>${rows.map(n => `<tr data-c="${esc(n.code)}"><td class="code">${esc(n.code)}</td><td>${tin(n.name, 'data-t="name"', 230)}</td><td>${tin(n.unit || '', 'data-t="unit" list="unitlist"', 64)}</td>
      <td class="n">${inp(fmtIn(n[pk]), `data-f="${pk}"`, 110)}</td><td class="n">${inp(fmtTl(n.tl), 'data-f="tl"', 64)}</td>
      ${area === 'sot' ? `<td class="n">${inp(fmtIn(n.sell), 'data-f="sell"', 100)}</td>` : `<td class="n" data-uc>${q(n.unitCost)}</td>`}<td class="n">${usedN(n.code) || (`<button class="xdel" data-delnvl="${esc(n.code)}" title="Xóa nguyên liệu chưa dùng">×</button>`)}</td></tr>`).join('')}</tbody></table>`;
    bindInputs($('#ent'), i => {
      const tr = i.closest('tr'), n = list.find(x => x.code === tr.dataset.c), fld = i.dataset.f;
      const v = fld === 'tl' ? parseTl(i.value) : parseNum(i.value);
      if (v != null && (isNaN(v) || v < 0 || (fld === 'tl' && (v <= 0 || v > 1)))) { toast(fld === 'tl' ? 'TL đạt phải từ 1 đến 100%.' : 'Số không hợp lệ.'); return false; }
      const old = n[fld];
      const orig = EDIT.snap[area === 'bep' ? 'D' : area === 'bar' ? 'BAR' : 'SOT'].nvl.find(x => x.code === n.code)?.[fld];
      n[fld] = v; recalc(area);
      rec(area, 'nvl', n.code, n.name, fld, orig ?? old, v);
      i.value = fld === 'tl' ? fmtTl(v) : fmtIn(v);
      const uc = tr.querySelector('[data-uc]'); if (uc) { uc.textContent = q(n.unitCost); flash(uc); }
      const nUsed = usedN(n.code); if (nUsed) toast(`Đã tính lại cost ${nUsed} nơi dùng ${n.code}.`);
    });
    bindText($('#ent'), i => {
      const tr = i.closest('tr'), n = list.find(x => x.code === tr.dataset.c), fld = i.dataset.t, v = i.value.trim();
      if (!v) { toast('Không để trống.'); return false; }
      const o = n[fld]; if (o === v) return;
      n[fld] = v;
      if (fld === 'unit') { const od = n.div; n.div = unitDiv(v); eachLine(area, n.code, l => { l.unit = v; l.div = n.div; }); if (od !== n.div) toast(n.div === 1 ? `Đã đổi sang ${v}: giá nhập hiểu là giá 1 ${v}, định lượng tính theo ${v}.` : `Đã đổi sang ${v}: giá nhập hiểu là giá 1 kg/lít, định lượng tính theo g/ml.`); }
      if (fld === 'name') eachLine(area, n.code, l => { l.name = v; });
      recalc(area); rec(area, 'nvl', n.code, n.name, fld, o, v);
      const uc = tr.querySelector('[data-uc]'); if (uc) { uc.textContent = q(n.unitCost); flash(uc); }
    });
    $('#ent').querySelectorAll('[data-delnvl]').forEach(b => b.onclick = () => { const code = b.dataset.delnvl; const n = list.find(x => x.code === code); if (!confirm('Xóa ' + code + ' ' + n.name + ' khỏi danh mục?')) return; list.splice(list.indexOf(n), 1); recalc(area); rec(area, 'nvl', code, n.name, 'delnvl', n[pk], null); draw(); });
  };
  $('#enq').oninput = e => { f.q = e.target.value; draw(); };
  $('#ennew').onclick = () => {
    $('#ennewf').innerHTML = `<section class="panel" style="margin-bottom:12px"><div class="pad newform"><label>Mã<input id="nnc" class="etx" style="width:110px" placeholder="vd BN500"></label><label>Tên nguyên liệu<input id="nnn" class="etx" style="width:240px"></label><label>ĐVT<input id="nnu" class="etx" list="unitlist" style="width:70px" value="g"></label><label>${area === 'sot' ? 'Đơn giá gốc' : 'Giá nhập'} (đ/kg hoặc đ/cái)<input id="nnp" class="ein" inputmode="decimal" style="width:120px"></label><label>TL đạt %<input id="nnt" class="ein" inputmode="decimal" style="width:70px" value="100"></label><button class="btn pri" id="nnok">Tạo</button><button class="btn" id="nnx">Đóng</button></div></section>`;
    $('#nnx').onclick = () => $('#ennewf').innerHTML = '';
    $('#nnok').onclick = () => {
      const code = $('#nnc').value.trim(), name = $('#nnn').value.trim(), unit = $('#nnu').value.trim() || 'g', price = parseNum($('#nnp').value), tl = parseTl($('#nnt').value) || 1;
      if (!code || !name) return toast('Nhập mã và tên nguyên liệu.');
      if (list.some(x => x.code.toLowerCase() === code.toLowerCase())) return toast('Mã ' + code + ' đã có trong danh mục.');
      if (price != null && isNaN(price)) return toast('Giá không hợp lệ.');
      const n = { code, name, unit, tl, div: unitDiv(unit), note: null, warn: null, sec: area === 'sot' ? 'Nguyên liệu' : (area === 'bep' ? 'NVL THÊM TRÊN APP' : null), grp: area === 'bep' ? (/^BTP/i.test(code) ? 'BTP' : 'BN') : undefined };
      n[pk] = price; list.push(n); recalc(area);
      rec(area, 'nvlnew', code, name, 'newnvl', null, price);
      f.q = code; $('#enq').value = code; $('#ennewf').innerHTML = ''; draw(); toast('Đã thêm ' + code + '. Vào công thức để dùng nguyên liệu này.');
    };
    $('#nnc').focus();
  };
  draw();
}

/* ---------- 2) Công thức: món bếp, BTP, bar, sốt ---------- */
function catalogFor(area) {
  if (area === 'bep') return D.nvl.map(n => ({ code: n.code, name: n.name, unit: n.unit, price: n.price, tl: n.tl, div: n.div }));
  if (area === 'bar') return BAR.nvl.map(n => ({ code: n.code, name: n.name, unit: n.unit, price: n.price, tl: n.tl, div: n.div || 1000 }));
  return SOT.nvl.map(n => ({ code: n.code, name: n.name, unit: n.unit, price: n.base, tl: n.tl, div: 1000 }));
}
function recipeEditor(area, cont, opt) {
  // opt: { lines, f, priceField?, priceLabel?, yld?, title, sub, getOrig(), refresh() }
  const L = opt.lines(), total = opt.total();
  const price = opt.priceField ? opt.getPrice() : null;
  const catSel = opt.cats ? `<select class="etx" data-t="cat">${[...new Set([...opt.cats, opt.getCat() || ''])].filter(Boolean).map(c => `<option ${c === opt.getCat() ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="__new">+ Nhóm mới…</option></select>` : '';
  return `<div class="dhead" style="align-items:center"><div style="flex:1 1 260px;display:grid;gap:6px;min-width:0">${tin(opt.title, 'data-t="name" style="font-size:20px;font-weight:700;width:100%"', 420)}<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="code" style="font-family:var(--f-display);font-size:16px;color:var(--muted)">${esc(opt.code || '—')}</span>${catSel}</div></div>${opt.onDelete ? '<button class="btn" id="edelit" style="color:var(--bad)">Xóa ' + esc(opt.kindName || 'món') + '</button>' : ''}</div>
  <div class="facts">
    ${opt.priceField ? `<div><small>${esc(opt.priceLabel)}</small><span>${inp(fmtIn(price), 'data-h="price"', 120)}</span></div>` : ''}
    ${opt.yld ? `<div><small>Sản lượng thành phẩm</small><span>${inp(fmtIn(cont.yld), 'data-h="yld"', 100)}</span></div>` : ''}
    <div><small>${opt.yld ? 'Tổng chi phí' : 'Cost'}</small><b id="etot">${vnd(total)}</b></div>
    ${opt.yld ? `<div><small>Giá thành / kg</small><b style="color:var(--accent)">${vnd(opt.perKg())}</b></div>` : ''}
    ${opt.priceField && !opt.yld ? `<div><small>Tỷ lệ cost</small><b>${price ? pillFor(total / price) : '—'}</b></div>` : ''}
    ${opt.priceField && opt.yld ? `<div><small>Cost / giá bán</small><b>${price && opt.perKg() ? pct(opt.perKg() / price) : '—'}</b></div>` : ''}
  </div>
  <div class="tbl"><table><thead><tr><th class="hm">Mã NVL</th><th>Tên nguyên liệu</th><th class="hm">ĐVT</th><th class="n hm">TL đạt</th><th class="n hm">Giá nhập</th><th class="n">Định lượng</th><th class="n">Thành tiền</th><th></th></tr></thead><tbody>
  ${L.map((l, i) => `<tr data-i="${i}"><td class="code hm">${esc(l.code || '—')}</td><td>${esc(l.name)}<div class="note sm-only" style="margin:0">${esc(l.code || '')} · ${esc(l.unit || '')}${l.tl != null && l.tl < 1 ? ' · TL ' + pct(l.tl) : ''}</div></td><td class="hm">${esc(l.unit || (l.dv === 1 ? 'cái' : 'g/ml'))}</td><td class="n hm">${l.tl != null ? pct(l.tl) : '—'}</td><td class="n hm">${l.price ? vnd(l.price) : '<span class="pill bad">0</span>'}</td>
    <td class="n">${inp(fmtIn(l.qty), 'data-q', 84)}</td><td class="n">${vnd(l.amount)}</td><td><button class="xdel" data-del="${i}" title="Xóa nguyên liệu này" aria-label="Xóa">×</button></td></tr>`).join('')}
  </tbody></table></div>
  <div class="pad addrow"><div id="eadd" style="flex:1 1 260px;min-width:0"></div>${inp('', 'id="eaddq" placeholder="Định lượng"', 110)}<button class="btn pri" id="eaddb">Thêm nguyên liệu</button></div>
  <div class="note pad" style="margin:0">Giá nhập và TL đạt lấy từ Danh mục NVL, muốn đổi thì sửa ở trang Danh mục NVL. Định lượng nhập theo ĐVT của dòng (g, ml, cái…).</div>`;
}
function bindRecipeEditor(area, cont, opt) {
  const host = $('#ld-d');
  bindText(host, i => {
    const t = i.dataset.t;
    if (t === 'name') { const v = i.value.trim(); if (!v) return false; const o = opt.title; opt.setName(v); rec(area, 'item', opt.code, v, 'name', o, v); opt.refresh(); return; }
    if (t === 'cat') { let v = i.value; if (v === '__new') { v = (prompt('Tên nhóm mới:') || '').trim(); if (!v) { opt.refresh(); return; } } const o = opt.getCat(); opt.setCat(v); rec(area, 'item', opt.code, opt.title, 'cat', o, v); opt.refresh(); return; }
  });
  if (opt.onDelete) $('#edelit').onclick = () => { if (!confirm(`Xóa ${opt.kindName || 'món'} ${opt.code || ''} ${opt.title}? Thao tác này lưu khi bấm Lưu & đăng.`)) return; opt.onDelete(); recalc(area); rec(area, 'item', opt.code, opt.title, 'delitem', opt.title, null); opt.after(); };
  bindInputs(host, i => {
    if (i.dataset.h === 'price') { const v = parseNum(i.value); if (v != null && (isNaN(v) || v < 0)) return false; const o = opt.getPrice(); opt.setPrice(v); recalc(area); rec(area, 'price', opt.code, opt.title, opt.priceKey, o, v); opt.refresh(); return; }
    if (i.dataset.h === 'yld') { const v = parseNum(i.value); if (v == null || isNaN(v) || v <= 0) return false; const o = cont.yld; cont.yld = v; if (cont._pk != null && o) cont._pk = cont._pk * o / v; recalc(area); rec(area, 'yld', opt.code, opt.title, 'yld', o, v); opt.refresh(); return; }
    if (!i.closest('tr')) return;
    const idx = +i.closest('tr').dataset.i, l = opt.lines()[idx];
    const v = parseNum(i.value); if (v == null || isNaN(v) || v < 0) { toast('Định lượng không hợp lệ.'); return false; }
    const o = l.qty; l.qty = v; recalc(area); rec(area, 'qty', opt.code, opt.title, 'qty', o, v, (l.code || '') + ' ' + l.name); opt.refresh();
  });
  host.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const L = opt.lines(), l = L[+b.dataset.del];
    if (!confirm(`Xóa ${l.name} khỏi công thức ${opt.title}?`)) return;
    L.splice(+b.dataset.del, 1); recalc(area); rec(area, 'line', opt.code, opt.title, 'del', l.qty, null, (l.code || '') + ' ' + l.name); opt.refresh();
  });
  const cat = catalogFor(area); let pick = null;
  combo($('#eadd'), cat.map(c => ({ code: c.code, name: c.name, k: norm(c.code + ' ' + c.name) })), '', c => { pick = c; $('#eadd-i').value = c + ' — ' + (cat.find(x => x.code === c)?.name || ''); $('#eaddq').focus(); }, 'Chọn nguyên liệu để thêm…');
  $('#eaddb').onclick = () => {
    const c = cat.find(x => x.code === pick); const v = parseNum($('#eaddq').value);
    if (!c) { toast('Chọn nguyên liệu trong danh sách trước.'); return; }
    if (v == null || isNaN(v) || v <= 0) { toast('Nhập định lượng lớn hơn 0.'); return; }
    if (opt.lines().some(l => l.code === c.code)) { toast(c.code + ' đã có trong công thức, sửa định lượng ở dòng đó.'); return; }
    opt.lines().push({ code: c.code, name: c.name, unit: c.unit, qty: v, tl: c.tl, price: c.price, f: opt.f, div: c.div || 1000, lk: true, k: 1, dv: c.div === 1 ? 1 : 1000, note: null });
    recalc(area); rec(area, 'line', opt.code, opt.title, 'add', null, v, c.code + ' ' + c.name); opt.refresh();
  };
}
function editList(area, key, items, cats, mk, title, desc, nw) {
  st.sel['e_' + key] ??= st.sel[key];
  if (!items.length) { $('#main').innerHTML = head(title, desc, nw ? `<button class="btn pri" id="enewit">+ ${esc(nw.label)}</button>` : '') + '<section class="panel" id="ld-d"><div class="empty">Chưa có mục nào.</div></section>'; }
  else {
    listDetail({ top: head(title, desc, nw ? `<button class="btn pri" id="enewit">+ ${esc(nw.label)}</button>` : '') }, '', items, 'e_' + key, it => { const o = mk(it); afterRender['e_' + key] = () => bindRecipeEditor(area, it._ref, o); return recipeEditor(area, it._ref, o); }, cats);
    afterRender['e_' + key]?.();
  }
  if (nw) $('#enewit').onclick = () => newItemForm(area, key, nw);
}
function newItemForm(area, key, nw) {
  const host = $('#ld-d');
  host.innerHTML = `<div class="dhead"><h2>${esc(nw.label)}</h2></div><div class="pad newform" style="display:flex;flex-wrap:wrap;gap:10px;align-items:end">
    <label>Mã<input id="nic" class="etx" style="width:120px" placeholder="${esc(nw.codeHint || '')}"></label>
    <label>Tên<input id="nin" class="etx" style="width:260px"></label>
    ${nw.cats ? `<label>Nhóm<input id="nig" class="etx" list="nigl" style="width:180px" value="${esc(nw.cats[0] || '')}"><datalist id="nigl">${nw.cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>` : ''}
    ${nw.price ? `<label>${esc(nw.price)}<input id="nip" class="ein" inputmode="decimal" style="width:120px"></label>` : ''}
    ${nw.yld ? `<label>Sản lượng thành phẩm (g)<input id="niy" class="ein" inputmode="decimal" style="width:110px" value="1000"></label>` : ''}
    <button class="btn pri" id="niok">Tạo</button><button class="btn" id="nix">Hủy</button></div><div class="note pad" style="margin:0">Tạo xong, thêm nguyên liệu vào công thức ở màn hình tiếp theo.</div>`;
  host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#nix').onclick = () => VIEWS[st.mod]();
  $('#niok').onclick = () => {
    const code = $('#nic').value.trim(), name = $('#nin').value.trim(), grp = nw.cats ? ($('#nig').value.trim() || 'Khác') : null;
    const price = nw.price ? parseNum($('#nip').value) : null, yld = nw.yld ? parseNum($('#niy').value) : null;
    if (!code || !name) return toast('Nhập mã và tên.');
    if (nw.exists(code)) return toast('Mã ' + code + ' đã có.');
    if (price != null && isNaN(price)) return toast('Giá không hợp lệ.');
    if (nw.yld && (!yld || isNaN(yld) || yld <= 0)) return toast('Nhập sản lượng thành phẩm lớn hơn 0.');
    const sel = nw.create({ code, name, grp, price, yld });
    recalc(area); rec(area, 'item', code, name, 'newitem', null, name);
    st.sel['e_' + key] = sel; VIEWS[st.mod](); toast('Đã tạo ' + code + '. Thêm nguyên liệu vào công thức.');
  };
  $('#nic').focus();
}
function refreshDetail(key) { st.sel[key] = st.sel['e_' + key]; VIEWS[st.mod](); }

const ED = {};
ED.nvl = () => editNvl('bep');
ED['bar-nvl'] = () => { syncNav('bar-nvl'); editNvl('bar'); };
ED['sot-nvl'] = () => { syncNav('sot-nvl'); editNvl('sot'); };
ED.cost = () => {
  const items = D.dishes.map(x => ({ code: x.code, name: x.name, cat: x.cat, _ref: x, badge: menuBy[x.code]?.price ? pillFor(x.total / menuBy[x.code].price) : '' }));
  editList('bep', 'cost', items, cats, it => { const x = it._ref; return { code: x.code, title: x.name, sub: x.code + ' · ' + x.cat, f: 'A', lines: () => x.lines, total: () => x.total, priceField: true, priceKey: 'sell', priceLabel: 'Giá bán', getPrice: () => menuBy[x.code]?.price ?? x.price, setPrice: v => { x.price = v; if (menuBy[x.code]) menuBy[x.code].price = v; }, refresh: () => refreshDetail('cost'),
    setName: v => { x.name = v; if (menuBy[x.code]) menuBy[x.code].name = v; const s = sopBy[x.code]; if (s) s.name = v; }, cats, getCat: () => x.cat, setCat: v => { x.cat = v; if (menuBy[x.code]) menuBy[x.code].cat = v; },
    kindName: 'món', onDelete: () => { D.dishes.splice(D.dishes.indexOf(x), 1); const m = D.menu.findIndex(y => y.code === x.code); if (m >= 0) D.menu.splice(m, 1); }, after: () => { st.sel.e_cost = null; VIEWS[st.mod](); } }; }, 'Sửa món bếp', 'Sửa tên, nhóm, giá bán, định lượng; thêm hoặc xóa nguyên liệu. Cost và tỷ lệ cost tính lại ngay.',
    { label: 'Thêm món mới', codeHint: 'vd MAC99', cats, price: 'Giá bán', exists: c => D.dishes.some(x => x.code.toLowerCase() === c.toLowerCase()), create: ({ code, name, grp, price }) => { D.dishes.push({ code, name, cat: grp, price, lines: [], total: 0, _tk: 1 }); D.menu.push({ code, name, cat: grp, price, cost: 0 }); return code; } });
};
ED.btp = () => {
  const items = D.btp.map(b => ({ code: b.code, name: b.name, _ref: b }));
  editList('bep', 'btp', items, null, it => { const b = it._ref; return { code: b.code, title: b.name, sub: b.code + ' · Bán thành phẩm', f: 'B', lines: () => b.items, total: () => b.totalCost, yld: true, perKg: () => b.pricePerKg, refresh: () => refreshDetail('btp'),
    setName: v => { b.name = v; const n = nvlBy[b.code]; if (n) n.name = v; eachLine('bep', b.code, l => { l.name = v; }); },
    kindName: 'BTP', onDelete: () => { D.btp.splice(D.btp.indexOf(b), 1); }, after: () => { st.sel.e_btp = null; VIEWS[st.mod](); } }; }, 'Sửa bán thành phẩm', 'Sửa tên, định lượng, sản lượng thành phẩm. Giá/kg BTP và cost các món dùng BTP này tự tính lại.',
    { label: 'Thêm BTP mới', codeHint: 'vd BTP500', yld: true, exists: c => D.btp.some(b => b.code.toLowerCase() === c.toLowerCase()) || D.nvl.some(n => n.code.toLowerCase() === c.toLowerCase() && !/^BTP/i.test(n.code)), create: ({ code, name, yld }) => { D.btp.push({ code, name, items: [], totalQty: 0, totalCost: 0, yld, pricePerKg: 0, _tk: 1, _pk: 1000 / yld, lk: true }); if (!D.nvl.some(n => n.code === code)) D.nvl.push({ code, name, unit: 'g', grp: 'BTP', price: 0, tl: 1, div: 1000, sec: 'BÁN THÀNH PHẨM (BTP)' }); else D.nvl.find(n => n.code === code).name = name; return code; } });
};
ED.menu = () => {
  const f = st.emf ??= { q: '' };
  $('#main').innerHTML = head('Sửa giá bán món bếp', 'Sửa giá bán, tỷ lệ cost tính lại ngay.') + `<div class="toolbar">${searchInput('emq', 'Tìm món…', f.q)}</div><section class="panel"><div class="tbl" id="emt"></div></section>`;
  const draw = () => {
    const qq = norm(f.q); const rows = D.menu.filter(m => !qq || norm(m.code + ' ' + m.name).includes(qq));
    $('#emt').innerHTML = `<table><thead><tr><th>Mã</th><th>Tên món</th><th>Danh mục</th><th class="n">Giá bán</th><th class="n">Cost</th><th class="n">Tỷ lệ</th></tr></thead><tbody>${rows.map(m => `<tr data-c="${esc(m.code)}"><td class="code">${esc(m.code)}</td><td>${tin(m.name, 'data-t="name"', 240)}</td><td class="muted">${esc(m.cat)}</td><td class="n">${inp(fmtIn(m.price), '', 110)}</td><td class="n">${vnd(m.cost)}</td><td class="n" data-r>${pillFor(m.price ? m.cost / m.price : null)}</td></tr>`).join('')}</tbody></table>`;
    bindInputs($('#emt'), i => { const tr = i.closest('tr'), m = D.menu.find(x => x.code === tr.dataset.c); const v = parseNum(i.value); if (v != null && (isNaN(v) || v < 0)) return false; const o = m.price; m.price = v; const x = dishBy[m.code]; if (x) x.price = v; rec('bep', 'price', m.code, m.name, 'sell', o, v); tr.querySelector('[data-r]').innerHTML = pillFor(v ? m.cost / v : null); flash(tr.querySelector('[data-r]')); });
    bindText($('#emt'), i => { const tr = i.closest('tr'), m = D.menu.find(x => x.code === tr.dataset.c), v = i.value.trim(); if (!v) return false; const o = m.name; m.name = v; const x = dishBy[m.code]; if (x) x.name = v; rec('bep', 'item', m.code, v, 'name', o, v); });
  };
  $('#emq').oninput = e => { f.q = e.target.value; draw(); }; draw();
};
ED['bar-menu'] = () => {
  syncNav('bar-menu');
  $('#main').innerHTML = head('Sửa giá bán Bar', 'Sửa giá bán, tỷ lệ cost tính lại ngay. Muốn sửa định lượng thì vào Công thức pha chế.') + `<section class="panel"><div class="tbl" id="ebm"></div></section>`;
  $('#ebm').innerHTML = `<table><thead><tr><th>Mã</th><th>Tên món</th><th>Nhóm</th><th class="n">Giá bán</th><th class="n">Cost</th><th class="n">Tỷ lệ</th></tr></thead><tbody>${BAR.menu.map((m, i) => `<tr data-i="${i}"><td class="code">${esc(m.code || '')}</td><td>${tin(m.name, 'data-t="name"', 220)} <label class="muted" style="white-space:nowrap"><input type="checkbox" data-off ${m.off ? 'checked' : ''}> Đã bỏ</label></td><td class="muted">${esc(m.grp || '')}</td><td class="n">${inp(fmtIn(m.price), '', 110)}</td><td class="n">${vnd(m.cost)}</td><td class="n" data-r>${m.cost == null ? '—' : pillFor(m.price ? m.cost / m.price : null)}</td></tr>`).join('')}</tbody></table>`;
  bindInputs($('#ebm'), i => { const tr = i.closest('tr'), m = BAR.menu[+tr.dataset.i]; const v = parseNum(i.value); if (v != null && (isNaN(v) || v < 0)) return false; const o = m.price; m.price = v; const r = barIdx.byCode[m.code]; if (r) r.sell = v; recalc('bar'); rec('bar', 'price', m.code, m.name, 'sell', o, v); tr.querySelector('[data-r]').innerHTML = m.cost == null ? '—' : pillFor(v ? m.cost / v : null); flash(tr.querySelector('[data-r]')); });
  bindText($('#ebm'), i => { const m = BAR.menu[+i.closest('tr').dataset.i], v = i.value.trim(); if (!v) return false; const o = m.name; m.name = v; const r = barIdx.byCode[m.code]; if (r) r.name = v; rec('bar', 'item', m.code, v, 'name', o, v); });
  $('#ebm').querySelectorAll('[data-off]').forEach(c => c.onchange = () => { const m = BAR.menu[+c.closest('tr').dataset.i]; const o = m.off; m.off = c.checked; rec('bar', 'item', m.code, m.name, 'offst', o ? 'Đã bỏ' : 'Đang bán', m.off ? 'Đã bỏ' : 'Đang bán'); });
};
ED['bar-ct'] = () => {
  syncNav('bar-ct');
  const items = BAR.recipes.map(r => ({ id: r.id, code: r.code, name: r.name, cat: r.sheet, _ref: r }));
  const bcats = [...new Set(BAR.recipes.map(r => r.sheet))];
  editList('bar', 'barct', items, bcats, it => { const r = it._ref; const m = BAR.menu.find(x => x.code && x.code === r.code); return { code: r.code, title: r.name, sub: (r.code || '—') + ' · ' + r.sheet, f: BAR.fmt === 2 ? 'A' : 'C', lines: () => r.items, total: () => r.total, yld: !!r.yld, perKg: () => r.perKg, priceField: !r.yld, priceKey: 'sell', priceLabel: 'Giá bán', getPrice: () => r.sell ?? m?.price ?? null, setPrice: v => { r.sell = v; if (m) m.price = v; }, refresh: () => refreshDetail('barct'),
    setName: v => { r.name = v; if (m) m.name = v; (BAR.charts || []).forEach(c => { if (c.code === r.code) c.name = v; }); (BAR.sops || []).forEach(s => { if (s.code === r.code) s.name = v; }); }, cats: bcats, getCat: () => r.sheet, setCat: v => { r.sheet = v; if (m) m.grp = v; },
    kindName: 'món', onDelete: () => { BAR.recipes.splice(BAR.recipes.indexOf(r), 1); if (m) BAR.menu.splice(BAR.menu.indexOf(m), 1); }, after: () => { st.sel.e_barct = null; VIEWS[st.mod](); } }; }, 'Sửa công thức pha chế', 'Sửa tên, nhóm, giá bán, định lượng; thêm hoặc xóa nguyên liệu. Cost món bar tính lại ngay.',
    { label: 'Thêm món bar mới', codeHint: 'vd TTC30', cats: bcats, price: 'Giá bán', exists: c => BAR.recipes.some(r => (r.code || '').toLowerCase() === c.toLowerCase()) || BAR.menu.some(m => (m.code || '').toLowerCase() === c.toLowerCase()), create: ({ code, name, grp, price }) => { BAR.recipes.push({ code, name, sheet: grp, items: [], total: 0, totQty: 0, sell: price, _tk: 1 }); BAR.menu.push({ code, name, grp, price, cost: 0, off: false, isNew: true, note: null }); prepBarSot(); return BAR.recipes[BAR.recipes.length - 1].id; } });
};
ED['sot-ct'] = () => {
  syncNav('sot-ct');
  const items = SOT.recipes.map(r => ({ id: r.id, code: r.code, name: r.name, cat: r.sheet, _ref: r }));
  const scats = [...new Set(SOT.recipes.map(r => r.sheet))];
  editList('sot', 'sotct', items, scats, it => { const r = it._ref; const p = sotIdx.priceOf[r.id]; return { code: r.code, title: r.name, sub: (r.code || '—') + ' · ' + r.sheet, f: 'C', lines: () => r.items, total: () => r.total, yld: true, perKg: () => r.perKg, priceField: !!p, priceKey: 'sellCs', priceLabel: 'Giá bán xuống CS', getPrice: () => p?.price, setPrice: v => { if (p) p.price = v; }, refresh: () => refreshDetail('sotct'),
    setName: v => { r.name = v; if (p) p.name = v; }, cats: scats, getCat: () => r.sheet, setCat: v => { r.sheet = v; },
    kindName: 'sốt', onDelete: () => { const idx = SOT.recipes.indexOf(r); SOT.recipes.splice(idx, 1); SOT.prices.forEach(x => { if (x.recipe === idx) x.recipe = null; else if (x.recipe > idx) x.recipe--; }); SOT.recipes.forEach(y => y.items.forEach(l => { if (l.src === idx) { l.src = null; l.lk = false; } else if (l.src > idx) l.src--; })); }, after: () => { st.sel.e_sotct = null; prepBarSot(); VIEWS[st.mod](); } }; }, 'Sửa công thức sốt bếp tổng', 'Sửa tên, nhóm, định lượng, sản lượng, giá bán xuống cơ sở. Giá thành/kg và bảng giá tự tính lại.',
    { label: 'Thêm sốt mới', codeHint: 'vd BTP600', cats: scats, yld: true, price: 'Giá bán xuống CS (để trống nếu chưa bán)', exists: c => SOT.recipes.some(r => (r.code || '').toLowerCase() === c.toLowerCase()), create: ({ code, name, grp, price, yld }) => { SOT.recipes.push({ code, name, sheet: grp, items: [], total: 0, totQty: 0, yld, perKg: 0, _tk: 1, _pk: 1000 / yld }); const ri = SOT.recipes.length - 1; if (price != null) SOT.prices.push({ code, name, unit: 'kg', oldPrice: null, price, unitCost: 0, ratio: 0, recipe: ri, lk: true }); prepBarSot(); return SOT.recipes[ri].id; } });
};
ED['sot-gia'] = () => {
  syncNav('sot-gia');
  $('#main').innerHTML = head('Sửa bảng giá sốt xuống cơ sở', 'Sửa giá bán mới. Giá cũ giữ nguyên để đối chiếu.') + `<section class="panel"><div class="tbl" id="esg"></div></section>`;
  $('#esg').innerHTML = `<table><thead><tr><th>Mã</th><th>Tên hàng</th><th>ĐVT</th><th class="n">Giá cũ</th><th class="n">Giá bán mới</th><th class="n">Giá cost/kg</th><th class="n">Cost / giá bán</th></tr></thead><tbody>${SOT.prices.map((p, i) => `<tr data-i="${i}"><td class="code">${esc(p.code)}</td><td>${tin(p.name, 'data-t="name"', 240)}</td><td>${tin(p.unit || '', 'data-t="unit" list="unitlist"', 60)}</td><td class="n">${vnd(p.oldPrice)}</td><td class="n">${inp(fmtIn(p.price), '', 110)}</td><td class="n">${vnd(p.unitCost)}</td><td class="n" data-r>${p.ratio != null ? pct(p.ratio) : '—'}</td></tr>`).join('')}</tbody></table>`;
  bindInputs($('#esg'), i => { const tr = i.closest('tr'), p = SOT.prices[+tr.dataset.i]; const v = parseNum(i.value); if (v != null && (isNaN(v) || v < 0)) return false; const o = p.price; p.price = v; recalc('sot'); rec('sot', 'price', p.code, p.name, 'sellCs', o, v); tr.querySelector('[data-r]').textContent = p.ratio != null ? pct(p.ratio) : '—'; flash(tr.querySelector('[data-r]')); });
  $('#esg').insertAdjacentHTML('beforeend', UNIT_DL);
  bindText($('#esg'), i => { const p = SOT.prices[+i.closest('tr').dataset.i], fld = i.dataset.t, v = i.value.trim(); if (!v) return false; const o = p[fld]; p[fld] = v; rec('sot', 'price', p.code, p.name, fld, o, v); });
};
/* gắn vào các trang: đang ở chế độ sửa thì mở trang sửa */
(function wire() {
  const RO = {};
  ['nvl', 'cost', 'btp', 'menu', 'bar-nvl', 'bar-ct', 'bar-menu', 'sot-nvl', 'sot-ct', 'sot-gia'].forEach(k => { RO[k] = VIEWS[k]; VIEWS[k] = () => (EDIT.on && ED[k]) ? ED[k]() : RO[k](); });
  const roBar = VIEWS.bar, roSot = VIEWS.sot;
  VIEWS.bar = () => { const k = 'bar-' + (st.barTab || 'menu'); if (EDIT.on && ED[k]) { st.mod = ''; syncNav(k); return ED[k](); } return roBar(); };
  VIEWS.sot = () => { const k = 'sot-' + (st.sotTab || 'gia'); if (EDIT.on && ED[k]) { st.mod = ''; syncNav(k); return ED[k](); } return roSot(); };
})();

/* ---------- Nhật ký thay đổi ---------- */
VIEWS.nhatky = async function () {
  $('#main').innerHTML = head('Nhật ký thay đổi', 'Các chỉnh sửa trực tiếp trên app, mới nhất ở trên.') + '<section class="panel" id="nkt"><div class="empty">Đang tải…</div></section>';
  try {
    const items = await API.readLog();
    if (!items.length) { $('#nkt').innerHTML = '<div class="empty">Chưa có chỉnh sửa nào trên app.</div>'; return; }
    sortable($('#nkt'), items, [
      { h: 'Thời gian', v: c => c.at, f: c => esc(fmtTime(c.at)) }, { h: 'Người sửa', v: c => c.by }, { h: 'Khu', v: c => AREA_NAME[c.area] || c.area },
      { h: 'Mã', v: c => c.code || '', cls: 'code' }, { h: 'Tên', v: c => c.name || '', f: c => `${esc(c.name || '')}${c.ctx ? `<div class="note" style="margin:0">${esc(c.ctx)}</div>` : ''}` },
      { h: 'Nội dung', v: c => FIELD_NAME[c.field] || c.field }, { h: 'Thay đổi', v: c => 0, f: c => esc(fmtChange(c)) },
    ]);
  } catch (e) { $('#nkt').innerHTML = `<div class="empty">Không tải được nhật ký: ${esc(e.message)}</div>`; }
};

/* ================= XUẤT EXCEL (đọc lại được bằng trang Cập nhật dữ liệu) ================= */
function aoaSheet(rows, widths) { const ws = XLSX.utils.aoa_to_sheet(rows); if (widths) ws['!cols'] = widths.map(w => ({ wch: w })); return ws; }
const stamp = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };
const fmtVN = v => new Intl.NumberFormat('en-US').format(Math.round(v || 0));
function exportBep() {
  const wb = XLSX.utils.book_new();
  const head3 = t => [[`${t} — KHRUA BAAN THAI (xuất từ app KBT Cost ${new Date().toLocaleString('vi-VN')})`], ['Dữ liệu đang dùng trên app. Có thể sửa rồi tải lại vào trang Cập nhật dữ liệu.']];
  // MENU
  const menu = [...head3('MENU TỔNG HỢP'), ['STT', 'Mã Món', 'Tên Món Ăn', 'Danh Mục', 'Giá Bán', 'Cost', 'Tỷ Lệ Cost']];
  let i = 0; cats.forEach(c => { menu.push(['  ▶  ' + c]); D.menu.filter(m => m.cat === c).forEach(m => menu.push([++i, m.code, m.name, m.cat, m.price, m.cost, m.price ? m.cost / m.price : null])); });
  XLSX.utils.book_append_sheet(wb, aoaSheet(menu, [6, 12, 40, 20, 12, 12, 10]), 'MENU_TỔNG_HỢP');
  // DANH MỤC
  const dm = [...head3('DANH MỤC NGUYÊN LIỆU'), ['Mã NVL', 'Tên Nguyên Liệu', 'ĐVT', 'Nhóm', 'Giá Nhập', 'TL Đạt', 'Giá/đvt Thực Tế', 'Ghi Chú', 'Cảnh Báo']];
  [...new Set(D.nvl.map(n => n.sec))].forEach(sc => { dm.push(['  ── ' + (sc || 'KHÁC')]); D.nvl.filter(n => n.sec === sc).forEach(n => dm.push([n.code, n.name, n.unit, n.grp, n.price, n.tl, n.unitCost, n.note, n.warn])); });
  XLSX.utils.book_append_sheet(wb, aoaSheet(dm, [10, 40, 6, 6, 12, 8, 12, 20, 6]), 'DANH_MỤC_NVL');
  // BTP
  const bt = [...head3('BÁN THÀNH PHẨM'), ['KEY', 'Mã NVL', 'Tên Nguyên Liệu', 'ĐVT', 'TL Đạt', 'Định Lượng', 'Giá Nhập', 'Giá/đvt', 'Thành Tiền', 'Ghi Chú']];
  D.btp.forEach(b => {
    bt.push([null, `  [${b.code}]  ${b.name}`], [null, 'STT', 'Tên Nguyên Liệu', 'ĐVT', 'TL Đạt', 'Định Lượng (g)', 'Giá Nhập (đ/kg)', 'Giá/đvt', 'Thành Tiền', 'Ghi Chú']);
    b.items.forEach(l => bt.push([b.code, l.code, l.name, l.unit, l.tl, l.qty, l.price, l.unitCost, l.amount, l.note]));
    bt.push([null, 'TỔNG NGUYÊN LIỆU', null, null, null, b.totalQty, null, null, b.totalCost], [null, '📦  SẢN LƯỢNG THÀNH PHẨM (g)', null, null, null, b.yld], [null, '💰  GIÁ THÀNH PHẨM / Kg', null, null, null, b.pricePerKg], []);
  });
  XLSX.utils.book_append_sheet(wb, aoaSheet(bt, [10, 12, 36, 6, 8, 12, 14, 10, 12, 16]), 'BÁN_THÀNH_PHẨM');
  // COST
  const co = [[null, null, null, 'BẢNG TÍNH FOOD COST — xuất từ app'], [], [null, null, null, 'STT', 'Tên Nguyên Liệu', 'ĐVT', 'Định Lượng', 'TL Đạt (%)', 'ĐL Kế Toán (g)', 'Giá Nhập (đ/kg)', 'Giá/đvt', 'Thành Tiền', 'Ghi Chú']];
  cats.forEach(c => {
    co.push([null, null, null, '▶  ' + c]);
    D.dishes.filter(x => x.cat === c).forEach(x => {
      const pr = menuBy[x.code]?.price ?? x.price ?? 0;
      co.push([null, null, null, `  [${x.code}]  ${x.name}  |  Giá bán: ${fmtVN(pr)}đ`], [null, null, null, 'STT', 'Tên Nguyên Liệu', 'ĐVT', 'Định Lượng', 'TL Đạt (%)', 'ĐL Kế Toán (g)', 'Giá Nhập (đ/kg)', 'Giá/đvt', 'Thành Tiền', 'Ghi Chú']);
      x.lines.forEach((l, k) => co.push([x.code, l.code, x.code + '|' + l.code, k + 1, l.name, l.unit, l.qty, l.tl, l.qtyAcc, l.price, l.unitCost, l.amount, l.note]));
      co.push([null, null, null, 'TỔNG ĐỊNH LƯỢNG / COST MÓN', null, null, x.lines.reduce((a, l) => a + (l.qty || 0), 0), null, null, null, null, x.total], [null, null, null, `% FOOD COST  (Giá bán: ${fmtVN(pr)}đ)`, null, null, null, null, null, null, null, pr ? x.total / pr : null], []);
    });
  });
  XLSX.utils.book_append_sheet(wb, aoaSheet(co, [8, 10, 14, 6, 36, 6, 10, 8, 10, 12, 10, 12, 14]), 'COST');
  XLSX.writeFile(wb, `KBT_DinhMuc_Bep_${stamp()}.xlsx`);
}
function exportBar() {
  const wb = XLSX.utils.book_new();
  const t3 = t => [[`${t} — BAR KHRUA BAAN THAI (xuất từ app KBT Cost)`], ['Có thể sửa rồi tải lại vào trang Cập nhật dữ liệu.']];
  const menu = [...t3('🍹 MENU BAR'), ['STT', 'Mã Món', 'Tên Món', 'Giá Bán', 'Cost', 'Tỷ Lệ']];
  let i = 0;
  const grps = [...new Set(BAR.menu.filter(m => !m.off).map(m => m.grp || 'KHÁC'))];
  grps.forEach(g => { menu.push(['  ▶  ' + g]); BAR.menu.filter(m => !m.off && (m.grp || 'KHÁC') === g).forEach(m => menu.push([++i, m.code, m.name, m.price, m.cost, m.price && m.cost != null ? m.cost / m.price : null])); });
  const off = BAR.menu.filter(m => m.off); if (off.length) { menu.push(['  ▶  ĐÃ BỎ']); off.forEach(m => menu.push([++i, m.code, m.name, m.price, m.cost, m.price && m.cost != null ? m.cost / m.price : null])); }
  XLSX.utils.book_append_sheet(wb, aoaSheet(menu, [6, 12, 36, 12, 12, 10]), 'MENU');
  XLSX.utils.book_append_sheet(wb, aoaSheet([...t3('DANH MỤC NGUYÊN LIỆU BAR'), ['Mã NVL', 'Tên Nguyên Liệu', 'ĐVT', 'Giá Nhập', 'TL Đạt', 'Giá/đvt', 'Cảnh Báo'], ...BAR.nvl.map(n => [n.code, n.name, n.unit, n.price, n.tl, n.unitCost ?? (n.price != null && n.tl ? n.price / (n.div || 1000) / n.tl : null), n.price ? '✅' : '⚠️'])], [10, 40, 8, 12, 8, 10, 6]), 'DANH_MỤC_NVL');
  XLSX.utils.book_append_sheet(wb, aoaSheet([...t3('GIÁ BÁN MÓN'), ['Mã Món', 'Tên Món', 'Giá Bán'], ...BAR.menu.filter(m => m.code).map(m => [m.code, m.name, m.price])], [12, 36, 12]), 'GIÁ_BÁN');
  const co = [[null, null, null, 'FOOD COST BAR — xuất từ app'], [], [null, null, null, 'STT', 'Tên Nguyên Liệu', 'ĐVT', 'Định Lượng', 'TL Đạt', 'ĐL Kế Toán', 'Giá Nhập', 'Giá/đvt', 'Thành Tiền', 'Ghi chú']];
  [...new Set(BAR.recipes.map(r => r.sheet))].forEach(g => {
    co.push([null, null, null, '▶  ' + g]);
    BAR.recipes.filter(r => r.sheet === g && r.code).forEach(r => {
      co.push([null, null, null, `  [${r.code}]  ${r.name}`], [null, null, null, 'STT', 'Tên Nguyên Liệu', 'ĐVT', 'Định Lượng', 'TL Đạt', 'ĐL Kế Toán', 'Giá Nhập', 'Giá/đvt', 'Thành Tiền', '']);
      r.items.forEach((l, k) => { const d = l.div || (l.dv === 1 ? 1 : 1000), tl = l.tl || 1; co.push([r.code, l.code || ('X' + k), r.code + '|' + (l.code || k), k + 1, l.name, l.unit || (d === 1 ? 'cái' : 'ml'), l.qty, l.tl, l.qtyAcc ?? (l.qty != null ? l.qty / tl : null), l.price, l.price != null ? l.price / d : null, l.amount, l.note]); });
      co.push([null, null, null, 'TỔNG COST MÓN', null, null, null, null, null, null, null, r.total], [null, null, null, '% COST', null, null, null, null, null, null, null, r.sell ? r.total / r.sell : null]);
    });
  });
  XLSX.utils.book_append_sheet(wb, aoaSheet(co, [8, 10, 14, 6, 36, 6, 10, 8, 10, 12, 10, 12, 10]), 'COST');
  XLSX.writeFile(wb, `KBT_Menu_Bar_${stamp()}.xlsx`);
}
function exportSot() {
  const wb = XLSX.utils.book_new();
  const dm = [['MÃ NVL', 'Nguyên liệu sử dụng', 'ĐVT', 'Tỷ lệ đạt sau sơ chế', 'Đơn giá gốc sốt bếp tổng', 'Giá bán sốt bếp tổng xuống cơ sở', 'Cost bếp tổng']];
  [...new Set(SOT.nvl.map(n => n.sec))].forEach(sc => { dm.push([null, sc || 'Khác']); SOT.nvl.filter(n => n.sec === sc).forEach(n => dm.push([n.code, n.name, n.unit, n.tl, n.base, n.sell, n.cost])); });
  XLSX.utils.book_append_sheet(wb, aoaSheet(dm, [10, 40, 6, 8, 14, 14, 10]), 'Danh mục');
  const pg = [['KHRUA BAAN THAI — xuất từ app KBT Cost'], ['DANH MỤC VÀ ĐƠN GIÁ BÁN SỐT BẾP TỔNG'], ['STT', 'Mã', 'Tên hàng hoá', 'Đvt', 'Đơn giá bán cũ', SOT.priceLabel || 'Đơn giá bán mới', 'Đơn giá cost', 'Cost'],
    ...SOT.prices.map((p, i) => [i + 1, p.code, p.name, p.unit, p.oldPrice, p.price, p.unitCost, p.ratio])];
  if (SOT.note) pg.push([null, null, SOT.note]);
  XLSX.utils.book_append_sheet(wb, aoaSheet(pg, [5, 10, 40, 6, 12, 14, 12, 8]), 'Đơn giá sốt bếp tổng');
  const used = new Set();
  [...new Set(SOT.recipes.map(r => r.sheet))].forEach(sh => {
    const rows = [];
    SOT.recipes.filter(r => r.sheet === sh).forEach(r => {
      rows.push([r.code, r.name, null, null, null, null, null, r.perKg], ['Mã NVL', 'Tên NVL', 'ĐVĐL', 'TL đạt sau sơ chế', 'Giá Nhập ', 'Giá 1gr/mml', 'ĐL', 'Thành tiền', 'Ghi chú']);
      r.items.forEach(l => rows.push([l.code, l.name, l.div || l.dv || 1000, l.tl, l.price, l.unitCost, l.qty, l.amount, l.note]));
      rows.push([null, null, null, null, null, 'Tổng', r.totQty, r.total], [null, null, null, null, null, 'Số Lượng Thành phẩm', null, r.yld], [null, null, null, null, null, 'Giá Thành Phẩm/Kg', null, r.perKg], []);
    });
    let name = sh.replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31) || 'Công thức'; while (used.has(name)) name = name.slice(0, 28) + ' ' + used.size; used.add(name);
    XLSX.utils.book_append_sheet(wb, aoaSheet(rows, [10, 36, 7, 8, 12, 10, 8, 12, 14]), name);
  });
  XLSX.writeFile(wb, `KBT_Sot_BepTong_${stamp()}.xlsx`);
}
async function doExport(area) {
  try { await loadScript('vendor/xlsx.full.min.js'); ({ bep: exportBep, bar: exportBar, sot: exportSot })[area](); toast('Đã xuất file Excel. Kiểm tra mục Tải về của máy.'); }
  catch (e) { toast('Chưa xuất được: ' + e.message); }
}

/* ================= Tùy chỉnh menu & phân hệ tự tạo (chỉ quản trị) ================= */
const cusNum = v => { if (v == null || v === '') return null; if (typeof v === 'number') return v; const t = String(v).trim().replace(/\s/g, ''); if (!/^-?[\d.,]+%?$/.test(t)) return null; const n = parseNum(t.replace('%', '')); return isNaN(n) ? null : n; };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

/* đọc 1 sheet → {cols, rows}: dòng tiêu đề = dòng đầu tiên có ≥2 ô có chữ */
function sheetToTable(ws) {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: false });
  let h = aoa.findIndex(r => r.filter(v => v != null && String(v).trim() !== '').length >= 2);
  if (h < 0) h = 0;
  const hdr = aoa[h] || [];
  const width = Math.max(hdr.length, ...aoa.slice(h + 1).map(r => r.length), 1);
  const keep = [...Array(width).keys()].filter(i => (hdr[i] != null && String(hdr[i]).trim() !== '') || aoa.slice(h + 1).some(r => r[i] != null && String(r[i]).trim() !== ''));
  const cols = keep.map((i, k) => hdr[i] != null && String(hdr[i]).trim() !== '' ? String(hdr[i]).trim() : 'Cột ' + (k + 1));
  const rows = aoa.slice(h + 1).map(r => keep.map(i => { const v = r[i]; return v == null ? '' : (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : String(v).trim()); }))
    .filter(r => r.some(v => v !== ''));
  return { cols, rows };
}

/* ---------- xem / sửa phân hệ tự tạo ---------- */
function viewCus(id) {
  const c = CFG.custom.find(x => x.id === id), T = CUS[id] || { cols: [], rows: [] };
  if (!c) return;
  const f = (st.cusF ??= {})[id] ??= { q: '' };
  const edit = st.cusEdit === id && isAdmin();
  const actions = isAdmin() ? (edit ? `<button class="btn" id="cusx">Hủy</button><button class="btn pri" id="cusok">Lưu bảng</button>` : `<button class="btn" id="cused">Sửa bảng</button>`) : '';
  $('#main').innerHTML = head(esc(MODS.find(m => m.id === 'cus-' + id)?.name || c.name), c.file ? 'Nguồn: ' + esc(c.file) + (c.sheet ? ' · sheet ' + esc(c.sheet) : '') : '', actions) +
    `<div class="toolbar">${searchInput('cusq', 'Tìm trong bảng…', f.q)}${edit ? '<button class="btn" id="cusaddr">+ Thêm dòng</button><button class="btn" id="cusaddc">+ Thêm cột</button>' : ''}</div><section class="panel" id="cust"></section><div class="note" id="cusn"></div>`;
  let work = edit ? (st.cusDraft ??= structuredClone(T)) : T;
  const draw = () => {
    const q = norm(f.q);
    const idx = work.rows.map((r, i) => i).filter(i => !q || norm(work.rows[i].join(' ')).includes(q));
    if (edit) {
      $('#cust').innerHTML = `<div class="tbl"><table><thead><tr>${work.cols.map((h, j) => `<th><input class="etx" data-h="${j}" value="${esc(h)}" style="width:${Math.max(90, Math.min(220, h.length * 9))}px"> <button class="xdel" data-dc="${j}" title="Xóa cột">×</button></th>`).join('')}<th></th></tr></thead><tbody>${idx.map(i => `<tr data-r="${i}">${work.cols.map((_, j) => `<td><input class="etx" data-c="${j}" value="${esc(work.rows[i][j] ?? '')}" style="width:${Math.max(80, Math.min(260, String(work.rows[i][j] ?? '').length * 8 + 20))}px"></td>`).join('')}<td><button class="xdel" data-dr="${i}" title="Xóa dòng">×</button></td></tr>`).join('')}</tbody></table></div>`;
      $('#cust').querySelectorAll('input[data-h]').forEach(i => i.onchange = () => { work.cols[+i.dataset.h] = i.value.trim() || 'Cột ' + (+i.dataset.h + 1); });
      $('#cust').querySelectorAll('input[data-c]').forEach(i => i.onchange = () => { const r = work.rows[+i.closest('tr').dataset.r], v = i.value.trim(); const n = cusNum(v); r[+i.dataset.c] = n != null && /^-?\d+([.,]\d+)?$/.test(v.replace(/\s/g, '')) ? n : v; });
      $('#cust').querySelectorAll('[data-dr]').forEach(b => b.onclick = () => { work.rows.splice(+b.dataset.dr, 1); draw(); });
      $('#cust').querySelectorAll('[data-dc]').forEach(b => b.onclick = () => { const j = +b.dataset.dc; if (!confirm('Xóa cột "' + work.cols[j] + '"?')) return; work.cols.splice(j, 1); work.rows.forEach(r => r.splice(j, 1)); draw(); });
    } else {
      const cols = work.cols.map((h, j) => { const num = work.rows.length && work.rows.filter(r => r[j] !== '' && r[j] != null).every(r => typeof r[j] === 'number'); return { h: esc(h), n: num, v: r => num ? r[j] : (r[j] === '' ? null : r[j]), f: r => num && r[j] !== '' ? nf.format(r[j]) : esc(r[j] ?? '') }; });
      if (!work.cols.length) $('#cust').innerHTML = '<div class="empty">Bảng chưa có cột nào.' + (isAdmin() ? ' Bấm “Sửa bảng” để thêm.' : '') + '</div>';
      else sortable($('#cust'), idx.map(i => work.rows[i]), cols);
    }
    $('#cusn').textContent = `${nf.format(idx.length)} / ${nf.format(work.rows.length)} dòng`;
  };
  $('#cusq').oninput = e => { f.q = e.target.value; draw(); };
  if ($('#cused')) $('#cused').onclick = () => { st.cusEdit = id; st.cusDraft = null; viewCus(id); };
  if ($('#cusx')) $('#cusx').onclick = () => { st.cusEdit = null; st.cusDraft = null; viewCus(id); };
  if ($('#cusaddr')) $('#cusaddr').onclick = () => { work.rows.unshift(work.cols.map(() => '')); f.q = ''; $('#cusq').value = ''; draw(); $('#cust input[data-c]')?.focus(); };
  if ($('#cusaddc')) $('#cusaddc').onclick = () => { const n = (prompt('Tên cột mới:') || '').trim(); if (!n) return; work.cols.push(n); work.rows.forEach(r => r.push('')); draw(); };
  if ($('#cusok')) $('#cusok').onclick = async () => {
    document.activeElement?.blur?.();
    const b = $('#cusok'); b.disabled = true; b.textContent = 'Đang lưu…';
    try { await API.publishExtra('cus:' + id, work, { by: ME.email, at: new Date().toISOString() }); CUS[id] = work; st.cusEdit = null; st.cusDraft = null; await refreshCache(); buildMods(); renderNav(); viewCus(id); toast('Đã lưu bảng.'); }
    catch (e) { toast('Không lưu được: ' + e.message); b.disabled = false; b.textContent = 'Lưu bảng'; }
  };
  draw();
}
async function refreshCache() { try { const c = await cache.get('dataset'); if (c) { c.cfg = CFG; c.cus = CUS; c.stamp = await API.dataStamp(); await cache.set('dataset', c); } } catch (e) { } }

/* ---------- trang Tùy chỉnh ---------- */
VIEWS.tuychinh = function () {
  if (!isAdmin()) return go('taikhoan');
  const dr = st.cfgDraft ??= structuredClone(CFG);
  st.cfgSec ??= 'bep';
  const sec = st.cfgSec;
  const mods = () => {
    const all = ALLMODS.filter(m => m.sec === sec && (!m.cus || dr.custom.some(c => 'cus-' + c.id === m.id)));
    dr.custom.filter(c => c.sec === sec && !all.some(m => m.id === 'cus-' + c.id)).forEach(c => all.push({ id: 'cus-' + c.id, sec, orig: c.name, cus: true }));
    const o = dr.nav.order[sec] || [];
    return all.sort((a, b) => { const x = o.indexOf(a.id), y = o.indexOf(b.id); return (x < 0 ? 1e3 : x) - (y < 0 ? 1e3 : y); });
  };
  const dirty = JSON.stringify(dr) !== JSON.stringify(CFG);
  $('#main').innerHTML = head('Tùy chỉnh menu & phân hệ', 'Đổi tên, sắp xếp, ẩn/hiện phân hệ và thêm phân hệ mới từ file Excel. Bấm “Lưu menu” để áp dụng cho mọi người.',
    `<button class="btn" id="cfgreset" ${dirty ? '' : 'disabled'}>Bỏ thay đổi</button><button class="btn pri" id="cfgsave" ${dirty ? '' : 'disabled'}>Lưu menu</button>`) +
    `<div class="tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${SECS.map(x => `<button class="btn ${x.id === sec ? 'pri' : ''}" data-cs="${x.id}">${esc(dr.nav.secNames[x.id] || x.name)}</button>`).join('')}</div>
    <section class="panel"><div class="cfgrow" style="background:var(--sunk)"><b style="white-space:nowrap">Tên khu vực</b><input class="etx" id="cfgsn" value="${esc(dr.nav.secNames[sec] || '')}" placeholder="${esc(SECS.find(x => x.id === sec).name)}"></div>
    <div id="cfgl"></div></section>
    <div class="note">Dùng ↑ ↓ để đổi thứ tự. Bỏ tích “Hiện” để ẩn phân hệ khỏi menu (dữ liệu vẫn giữ). Để trống ô tên = dùng tên gốc.</div>
    <section class="panel" style="margin-top:16px"><div class="dhead"><h2>Thêm phân hệ mới vào “${esc(dr.nav.secNames[sec] || SECS.find(x => x.id === sec).name)}”</h2></div>
    <div class="pad newform"><label>Tên phân hệ<input class="etx" id="cnn" style="width:240px" placeholder="vd Bảng giá nhà cung cấp"></label>
    <label>Lấy dữ liệu từ<select class="etx" id="cnsrc"><option value="file">File Excel / CSV</option><option value="blank">Bảng trống (tự nhập)</option></select></label>
    <label id="cnfl">File<input type="file" id="cnf" accept=".xlsx,.xlsm,.xls,.csv"></label>
    <label id="cnsl" hidden>Sheet<select class="etx" id="cns"></select></label>
    <label id="cncl" hidden>Các cột (cách nhau bằng dấu phẩy)<input class="etx" id="cnc" style="width:300px" placeholder="Mã, Tên, ĐVT, Giá"></label>
    <button class="btn pri" id="cnok">Tạo phân hệ</button></div><div class="pad" id="cnprev" style="padding-top:0"></div></section>`;
  const list = mods();
  $('#cfgl').innerHTML = list.length ? list.map((m, i) => { const hid = dr.nav.hidden.includes(m.id); const cc = m.cus && dr.custom.find(c => 'cus-' + c.id === m.id); return `<div class="cfgrow ${hid ? 'off' : ''}" data-id="${m.id}">
    <button class="btn" data-up ${i ? '' : 'disabled'} title="Lên">↑</button><button class="btn" data-dn ${i < list.length - 1 ? '' : 'disabled'} title="Xuống">↓</button>
    <input class="etx" data-nm value="${esc(cc ? cc.name : (dr.nav.names[m.id] || ''))}" placeholder="${esc(m.orig)}">
    ${m.cus ? `<select class="etx" data-mv title="Chuyển khu vực">${SECS.map(x => `<option value="${x.id}" ${x.id === sec ? 'selected' : ''}>${esc(dr.nav.secNames[x.id] || x.name)}</option>`).join('')}</select><button class="btn" data-del style="color:var(--bad)" title="Xóa phân hệ">Xóa</button>` : ''}
    <label style="white-space:nowrap"><input type="checkbox" data-sh ${hid ? '' : 'checked'}> Hiện</label></div>`; }).join('') : '<div class="empty">Khu vực này chưa có phân hệ nào. Thêm phân hệ mới ở dưới.</div>';
  const save = () => VIEWS.tuychinh();
  const setOrder = arr => { dr.nav.order[sec] = arr.map(m => m.id); };
  $('#main').querySelectorAll('[data-cs]').forEach(b => b.onclick = () => { st.cfgSec = b.dataset.cs; save(); });
  $('#cfgsn').onchange = e => { const v = e.target.value.trim(); if (v) dr.nav.secNames[sec] = v; else delete dr.nav.secNames[sec]; save(); };
  $('#cfgl').querySelectorAll('.cfgrow').forEach(row => {
    const id = row.dataset.id, i = list.findIndex(m => m.id === id);
    row.querySelector('[data-up]').onclick = () => { const a = list.slice(); [a[i - 1], a[i]] = [a[i], a[i - 1]]; setOrder(a); save(); };
    row.querySelector('[data-dn]').onclick = () => { const a = list.slice(); [a[i + 1], a[i]] = [a[i], a[i + 1]]; setOrder(a); save(); };
    row.querySelector('[data-nm]').onchange = e => { const v = e.target.value.trim(); const cc = dr.custom.find(c => 'cus-' + c.id === id); if (cc) { if (v) cc.name = v; } else if (v) dr.nav.names[id] = v; else delete dr.nav.names[id]; save(); };
    row.querySelector('[data-sh]').onchange = e => { dr.nav.hidden = dr.nav.hidden.filter(x => x !== id); if (!e.target.checked) dr.nav.hidden.push(id); save(); };
    const mv = row.querySelector('[data-mv]'); if (mv) mv.onchange = () => { dr.custom.find(c => 'cus-' + c.id === id).sec = mv.value; save(); };
    const del = row.querySelector('[data-del]'); if (del) del.onclick = () => { const cc = dr.custom.find(c => 'cus-' + c.id === id); if (!confirm(`Xóa phân hệ “${cc.name}” và toàn bộ bảng dữ liệu của nó? (áp dụng khi bấm Lưu menu)`)) return; dr.custom = dr.custom.filter(c => c !== cc); dr.nav.hidden = dr.nav.hidden.filter(x => x !== id); save(); };
  });
  $('#cfgreset').onclick = () => { st.cfgDraft = null; save(); };
  $('#cfgsave').onclick = async () => {
    const b = $('#cfgsave'); b.disabled = true; b.textContent = 'Đang lưu…';
    try {
      const gone = CFG.custom.filter(c => !dr.custom.some(x => x.id === c.id));
      await API.publishExtra('cfg', dr, { by: ME.email, at: new Date().toISOString() });
      for (const c of gone) { try { await API.deleteKey('cus:' + c.id); } catch (e) { } delete CUS[c.id]; }
      CFG = cfgNorm(structuredClone(dr)); st.cfgDraft = null; await refreshCache();
      buildMods(); renderNav(); save(); toast('Đã lưu menu. Mọi người sẽ thấy menu mới khi mở lại app.');
    } catch (e) { toast('Không lưu được: ' + e.message); b.disabled = false; b.textContent = 'Lưu menu'; }
  };

  /* thêm phân hệ */
  let wb = null, fileName = '';
  const src = $('#cnsrc');
  src.onchange = () => { const bl = src.value === 'blank'; $('#cnfl').hidden = bl; $('#cnsl').hidden = bl || !wb; $('#cncl').hidden = !bl; $('#cnprev').innerHTML = ''; };
  const preview = () => {
    if (!wb) return; const t = sheetToTable(wb.Sheets[$('#cns').value]);
    $('#cnprev').innerHTML = `<div class="muted" style="margin-bottom:6px">Xem trước: ${t.cols.length} cột, ${nf.format(t.rows.length)} dòng</div><div class="tbl"><table><thead><tr>${t.cols.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.slice(0, 5).map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  };
  $('#cnf').onchange = async e => {
    const f = e.target.files[0]; if (!f) return; fileName = f.name;
    try {
      await loadScript('vendor/xlsx.full.min.js');
      wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellFormula: false, cellHTML: false });
      $('#cns').innerHTML = wb.SheetNames.map(n => `<option>${esc(n)}</option>`).join(''); $('#cnsl').hidden = false;
      if (!$('#cnn').value.trim()) $('#cnn').value = wb.SheetNames.length === 1 ? f.name.replace(/\.[^.]+$/, '') : wb.SheetNames[0];
      preview();
    } catch (err) { toast('Không đọc được file: ' + err.message); }
  };
  $('#cns').onchange = () => { if (wb && wb.SheetNames.length > 1) $('#cnn').value = $('#cns').value; preview(); };
  $('#cnok').onclick = async () => {
    const name = $('#cnn').value.trim(); if (!name) return toast('Nhập tên phân hệ.');
    let T, meta = {};
    if (src.value === 'blank') { const cols = $('#cnc').value.split(',').map(s => s.trim()).filter(Boolean); if (!cols.length) return toast('Nhập tên các cột, cách nhau bằng dấu phẩy.'); T = { cols, rows: [] }; }
    else { if (!wb) return toast('Chọn file Excel.'); T = sheetToTable(wb.Sheets[$('#cns').value]); meta = { file: fileName, sheet: $('#cns').value }; if (!T.cols.length) return toast('Sheet này không có dữ liệu.'); }
    const b = $('#cnok'); b.disabled = true; b.textContent = 'Đang tạo…';
    try {
      const id = newId();
      await API.publishExtra('cus:' + id, T, { by: ME.email, at: new Date().toISOString() });
      const base = cfgNorm(structuredClone(CFG)); base.custom.push({ id, sec, name, ...meta });
      dr.custom.push({ id, sec, name, ...meta });
      await API.publishExtra('cfg', base, { by: ME.email, at: new Date().toISOString() });
      CUS[id] = T; CFG = base; await refreshCache(); buildMods(); renderNav();
      st.cfgDraft = null; toast('Đã tạo phân hệ “' + name + '”.'); go('cus-' + id);
    } catch (err) { toast('Không tạo được: ' + err.message); b.disabled = false; b.textContent = 'Tạo phân hệ'; }
  };
};

/* ================= Cập nhật dữ liệu (quản trị) ================= */
let PENDING = null;
function loadScript(src) { return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Không tải được ' + src)); document.head.appendChild(s); }); }
async function toJpeg(im) {
  const blob = new Blob([im.data], { type: /\.jpe?g$/i.test(im.path) ? 'image/jpeg' : 'image/png' });
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.72);
}
VIEWS.capnhat = function () {
  if (!isAdmin()) return go(MODS[0].id);
  const stat = (lbl, m) => `<div><b>${lbl}:</b> ${m ? `${esc(m.file || '—')} · cập nhật ${esc(fmtTime(m.updated_at))}${m.by ? ' bởi ' + esc(m.by) : ''}` : '<span class="pill warn">Chưa có dữ liệu</span>'}</div>`;
  $('#main').innerHTML = head('Cập nhật dữ liệu', 'Tải lên một trong 3 loại file Excel. App tự nhận ra loại file, cho chị xem trước rồi mới đăng cho mọi người.') +
    `<section class="panel"><div class="pad" style="display:grid;gap:12px">
      <div style="display:grid;gap:4px">${stat('Định mức bếp', D ? META : null)}${stat('Cost bar', BARMETA)}${stat('Sốt bếp tổng', SOTMETA)}</div>
      ${(D || BAR || SOT) ? `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="muted">Xuất dữ liệu đang dùng ra Excel:</span>${D ? '<button class="btn" data-exp="bep">Excel Bếp</button>' : ''}${BAR ? '<button class="btn" data-exp="bar">Excel Bar</button>' : ''}${SOT ? '<button class="btn" data-exp="sot">Excel Bếp tổng</button>' : ''}</div>` : ''}
      <label class="drop" id="drop" for="xf"><input type="file" id="xf" accept=".xlsx,.xlsm,.xls" hidden><b>Chọn file Excel</b><span class="muted">File định mức bếp, file Cost Menu bar, hoặc file Cost sốt bếp tổng (.xlsx / .xls)</span></label>
      <div id="upOut"></div></div></section>`;
  document.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => doExport(b.dataset.exp));
  const editedWarn = (m, lbl) => m?.edited_at ? `<div class="warnbox"><b>Lưu ý:</b> dữ liệu ${lbl} trên app đã được sửa trực tiếp lúc ${esc(fmtTime(m.edited_at))} (${m.edits || 1} chỉnh sửa). Đăng file này sẽ <b>thay toàn bộ</b> dữ liệu ${lbl}, chỉnh sửa nào không có trong file sẽ mất. Nếu chưa chắc, bấm Hủy, xuất Excel ${lbl} trước, sửa trên file đó rồi tải lên.</div>` : '';
  const kpis = arr => `<div class="kpis" style="margin:0">${arr.map(([l, v]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${nf.format(v)}</div></div>`).join('')}</div>`;
  const handle = async f => {
    if (!f) return;
    const out = $('#upOut');
    out.innerHTML = `<div class="muted">Đang đọc <b>${esc(f.name)}</b>… (file lớn có thể mất 10–20 giây)</div>`;
    try {
      await loadScript('vendor/xlsx.full.min.js');
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellFormula: false, cellHTML: false, cellText: false });
      let type = f._forceType || KBTParser.detectType(wb, XLSX);
      if (!type) {
        out.innerHTML = `<div style="display:grid;gap:10px"><div><span class="pill warn">Chưa nhận ra loại file</span> File <b>${esc(f.name)}</b> có các sheet: <span class="muted">${wb.SheetNames.map(esc).join(' · ')}</span></div>
          <div>Chị chọn giúp đây là file gì:</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-ft="bar">File Cost bar</button><button class="btn" data-ft="sot">File Sốt bếp tổng</button><button class="btn" data-ft="bep">File định mức bếp</button><button class="btn" id="cancelUp">Hủy</button></div></div>`;
        $('#cancelUp').onclick = () => VIEWS.capnhat();
        out.querySelectorAll('[data-ft]').forEach(b => b.onclick = () => { f._forceType = b.dataset.ft; handle(f); });
        return;
      }
      const meta = () => ({ file: f.name, by: ME.name || ME.email, at: new Date().toISOString() });
      const actions = `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn pri" id="pub">Đăng dữ liệu cho mọi người</button><button class="btn" id="cancelUp">Hủy</button></div>`;
      const bindPub = async fn => {
        $('#cancelUp').onclick = () => VIEWS.capnhat();
        $('#pub').onclick = async () => {
          const b = $('#pub'); b.disabled = true; b.textContent = 'Đang đăng…';
          try { await fn(); await loadData(true); toast('Đã đăng dữ liệu mới. Mọi người sẽ thấy khi mở lại app.'); go(MODS[0].id); }
          catch (e) { b.disabled = false; b.textContent = 'Đăng dữ liệu cho mọi người'; out.insertAdjacentHTML('beforeend', `<div class="pill bad">Chưa đăng được: ${esc(e.message)}</div>`); }
        };
      };
      if (type === 'bar') {
        const nd = KBTParser.parseBar(XLSX, wb);
        if (!nd.menu.length && !nd.recipes.length) throw new Error('Không tìm thấy món nào trong sheet MENU / COST của file bar.');
        if (nd.charts?.length && nd._chartHeaderRows) { try { await loadScript('vendor/jszip.min.js'); const imgs = await KBTParser.extractChartImages(JSZip, buf); await KBTParser.assignImages(nd, imgs, toJpeg); } catch (e) { } }
        delete nd._chartHeaderRows;
        const keptB = [];
        if (nd.fmt === 2 && !nd.charts.length && BAR?.charts?.length) { nd.charts = structuredClone(BAR.charts); keptB.push('Chart pha chế: giữ bản đang dùng'); }
        if (nd.fmt === 2 && !nd.sops.length && BAR?.sops?.length) { nd.sops = structuredClone(BAR.sops); keptB.push('Đào tạo SOP: giữ bản đang dùng'); }
        const noCost = nd.menu.filter(m => !m.off && m.cost == null);
        const kk = [['Món trên menu', nd.menu.filter(m => !m.off).length], ['Món đã bỏ', nd.menu.filter(m => m.off).length], ['Công thức', nd.recipes.length], ['Nguyên liệu bar', nd.nvl.length]];
        if (nd.fmt === 2) { kk.splice(1, 1); kk.push(['Chart pha chế', nd.charts.length], ['SOP đào tạo', nd.sops.length], ['Ảnh thành phẩm', nd.charts.filter(c => c.img).length]); }
        const miss2 = nd.fmt === 2 ? nd.recipes.flatMap(r => r.items.filter(l => !l.price).map(l => r.code + ' – ' + l.code + ' ' + l.name)) : [];
        out.innerHTML = `<div><span class="pill good">File Cost bar${nd.fmt === 2 ? ' (mẫu mới có Chart & Đào tạo)' : ''}</span></div>` + (keptB.length ? `<div class="muted">${keptB.map(esc).join(' · ')}</div>` : '') + editedWarn(BARMETA, 'Bar') + kpis(kk) + (miss2.length ? `<div><span class="pill bad">${miss2.length} dòng thiếu giá</span> <span class="muted">${miss2.map(esc).join(' · ')}</span></div>` : '') +
          (noCost.length ? `<div><span class="pill warn">${noCost.length} món chưa có cost</span> <span class="muted">${noCost.map(m => esc(m.name)).join(' · ')}</span></div>` : '') + actions;
        bindPub(() => API.publishExtra('bar', nd, meta()));
        return;
      }
      if (type === 'sot') {
        const nd = KBTParser.parseSot(XLSX, wb);
        if (!nd.prices.length) throw new Error('Không tìm thấy mã nào trong sheet Đơn giá sốt bếp tổng.');
        const chg = nd.prices.filter(p => p.oldPrice && p.price !== p.oldPrice);
        const noRec = nd.prices.filter(p => p.recipe == null);
        out.innerHTML = `<div><span class="pill good">File Sốt bếp tổng</span> <span class="muted">${esc(nd.priceLabel || '')}</span></div>` + editedWarn(SOTMETA, 'Bếp tổng') + kpis([['Mã trong bảng giá', nd.prices.length], ['Mã đổi giá', chg.length], ['Công thức sốt', nd.recipes.length], ['NVL danh mục', nd.nvl.length]]) +
          (noRec.length ? `<div><span class="pill mute">${noRec.length} mã chưa nối được công thức</span> <span class="muted">${noRec.map(p => esc(p.code + ' ' + p.name)).join(' · ')}</span></div>` : '') + actions;
        bindPub(() => API.publishExtra('sot', nd, meta()));
        return;
      }
      await loadScript('vendor/jszip.min.js');
      const nd = KBTParser.parseWorkbook(XLSX, wb);
      const imgs = await KBTParser.extractChartImages(JSZip, buf);
      await KBTParser.assignImages(nd, imgs, toJpeg);
      if (!nd.dishes.length) throw new Error('Không tìm thấy món nào trong sheet COST. Kiểm tra lại cấu trúc file.');
      // Sheet nào thiếu thì giữ dữ liệu đang dùng (hoặc tự dựng từ COST)
      const kept = [], M = nd.missing || [];
      const has = k => !M.includes(k);
      if (!has('MENU_TỔNG_HỢP') || !nd.menu.length) { nd.menu = nd.dishes.map(x => ({ code: x.code, name: x.name, cat: x.cat, price: x.price || null, cost: x.total })); kept.push('Menu: lấy tên, giá bán, cost từ sheet COST'); }
      else { const tot = Object.fromEntries(nd.dishes.map(x => [x.code, x.total])); nd.menu.forEach(m => { if (m.cost == null && tot[m.code] != null) m.cost = tot[m.code]; }); }
      if (!has('DANH_MỤC_NVL')) { if (D) { nd.nvl = D.nvl; kept.push('Danh mục NVL: giữ bản đang dùng'); } else kept.push('Danh mục NVL: chưa có'); }
      if (!has('BÁN_THÀNH_PHẨM')) { if (D) { nd.btp = D.btp; kept.push('Bán thành phẩm: giữ bản đang dùng'); } else kept.push('Bán thành phẩm: chưa có'); }
      let images;
      if (!has('CHART')) {
        if (D) { nd.charts = D.charts.map(c => ({ ...c, img: null })); images = D.charts.filter(c => c.img).map(c => [c.code, c.img]); kept.push('Chart món: giữ bản đang dùng (kèm ảnh)'); }
        else { images = []; kept.push('Chart món: chưa có'); }
      } else images = nd.charts.filter(c => c.img).map(c => [c.code, c.img]);
      nd.charts.forEach(c => { c.img = null; }); delete nd._chartHeaderRows;
      if (!has('ĐÀO_TẠO')) { if (D) { nd.sops = D.sops; kept.push('Đào tạo SOP: giữ bản đang dùng'); } else kept.push('Đào tạo SOP: chưa có'); }
      delete nd.missing;
      const old = D ? Object.fromEntries(D.dishes.map(x => [x.code, x.total])) : {};
      const changed = nd.dishes.filter(x => old[x.code] != null && Math.abs((old[x.code] || 0) - (x.total || 0)) >= 1).map(x => ({ x, o: old[x.code] })).sort((a, b) => Math.abs(b.x.total - b.o) - Math.abs(a.x.total - a.o));
      const added = D ? nd.dishes.filter(x => old[x.code] == null) : [];
      const removed = D ? D.dishes.filter(x => !nd.dishes.find(y => y.code === x.code)) : [];
      const miss = nd.dishes.flatMap(x => x.lines.filter(l => !l.price).map(l => x.code + ' – ' + l.code + ' ' + l.name));
      out.innerHTML = `<div><span class="pill good">File định mức bếp</span></div>` + editedWarn(D ? META : null, 'Bếp') + (kept.length ? `<div><span class="pill warn">File thiếu ${M.length} sheet</span> <span class="muted">${M.map(esc).join(', ')}</span><ul style="margin:6px 0 0;padding-left:20px">${kept.map(k => `<li>${esc(k)}</li>`).join('')}</ul></div>` : '') + kpis([['Món', nd.menu.length], ['Dòng định mức', nd.dishes.reduce((a, x) => a + x.lines.length, 0)], ['Nguyên liệu', nd.nvl.length], ['Công thức BTP', nd.btp.length], ['Chart món', nd.charts.length], ['SOP', nd.sops.length], ['Ảnh thành phẩm', images.length]]) +
        (D ? `<div><b>So với dữ liệu đang dùng:</b> ${changed.length} món đổi cost, ${added.length} món mới, ${removed.length} món bị bỏ.</div>` : '') +
        (changed.length ? `<div class="panel"><div class="tbl"><table><thead><tr><th>Mã</th><th>Món</th><th class="n">Cost cũ</th><th class="n">Cost mới</th><th class="n">Chênh lệch</th></tr></thead><tbody>${changed.slice(0, 15).map(({ x, o }) => `<tr><td class="code">${esc(x.code)}</td><td>${esc(x.name)}</td><td class="n">${vnd(o)}</td><td class="n">${vnd(x.total)}</td><td class="n"><span class="pill ${x.total > o ? 'bad' : 'good'}">${x.total > o ? '+' : ''}${vnd(x.total - o)}</span></td></tr>`).join('')}</tbody></table></div></div>` : '') +
        (added.length ? `<div class="muted">Món mới: ${added.map(x => esc(x.code)).join(', ')}</div>` : '') +
        (removed.length ? `<div class="muted">Món bị bỏ: ${removed.map(x => esc(x.code)).join(', ')}</div>` : '') +
        (miss.length ? `<div><span class="pill bad">${miss.length} dòng thiếu giá</span> <span class="muted">${miss.map(esc).join(' · ')}</span></div>` : '') + actions;
      bindPub(() => API.publish(nd, images, { ...meta(), counts: { menu: nd.menu.length, nvl: nd.nvl.length } }));
    } catch (e) {
      out.innerHTML = `<div><span class="pill bad">Không đọc được file</span> ${esc(e.message)}</div>`;
    }
  };
  $('#xf').onchange = e => handle(e.target.files[0]);
  const dz = $('#drop');
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); handle(e.dataTransfer.files[0]); };
};

/* ================= Tài khoản ================= */
VIEWS.taikhoan = function () {
  const roleName = { admin: 'Quản trị', viewer: 'Người xem' }[ME.role] || ME.role;
  $('#main').innerHTML = head('Tài khoản', '') + `<div class="grid2">
    <section class="panel"><h3>Thông tin</h3><div class="pad"><dl class="kv">
      <dt>Tên đăng nhập</dt><dd>${esc(ME.email.replace('@' + USER_DOMAIN, ''))}</dd>
      ${ME.name ? `<dt>Họ tên</dt><dd>${esc(ME.name)}</dd>` : ''}
      <dt>Quyền</dt><dd><span class="pill ${ME.role === 'admin' ? 'good' : 'mute'}">${esc(roleName)}</span></dd>
      <dt>Phiên bản app</dt><dd>${APP_VERSION}</dd></dl>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button class="btn" id="reload">Tải lại dữ liệu</button><button class="btn" id="logout">Đăng xuất</button></div></div></section>
    <section class="panel"><h3>Đổi mật khẩu</h3><form class="pad" id="pwf" style="display:grid;gap:10px">
      <label for="pw1">Mật khẩu mới (ít nhất 8 ký tự)</label><input type="password" id="pw1" minlength="8" required autocomplete="new-password">
      <label for="pw2">Nhập lại mật khẩu mới</label><input type="password" id="pw2" minlength="8" required autocomplete="new-password">
      <div><button class="btn pri" id="pwb">Đổi mật khẩu</button></div><div id="pwo"></div></form></section></div>
    <section class="panel" style="margin-top:16px"><h3>Cỡ chữ trong app</h3><div class="pad" style="display:grid;gap:8px"><div class="zoom"><button type="button" data-z="-1">A− Nhỏ hơn</button><button type="button" data-z="0">100%</button><button type="button" data-z="1">A+ To hơn</button></div><div class="muted">Máy nào cũng chỉnh riêng được. App nhớ cỡ chữ cho lần mở sau.</div></div></section>
    ${installCard()}`;
  $('#logout').onclick = async () => { await API.signOut(); await cache.clear(); D = null; META = null; BAR = null; SOT = null; showLogin('Đã đăng xuất.'); };
  $('#reload').onclick = async () => { await loadData(true); toast('Đã tải lại dữ liệu mới nhất.'); };
  $('#pwf').onsubmit = async e => {
    e.preventDefault(); const a = $('#pw1').value, b = $('#pw2').value, o = $('#pwo');
    if (a !== b) { o.innerHTML = '<span class="pill bad">Hai mật khẩu chưa khớp</span>'; return; }
    try { await API.changePassword(a); o.innerHTML = '<span class="pill good">Đã đổi mật khẩu</span>'; $('#pwf').reset(); }
    catch (err) { o.innerHTML = `<span class="pill bad">Chưa đổi được: ${esc(err.message)}</span>`; }
  };
  bindInstall(); applyZoom();
};

/* ================= Cài app lên điện thoại ================= */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; document.querySelectorAll('.inst-btn').forEach(b => b.hidden = false); });
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function installCard() {
  if (standalone()) return '';
  return `<section class="panel" style="margin-top:16px"><h3>Cài app lên điện thoại</h3><div class="pad" style="display:grid;gap:8px">
    <button class="btn pri inst-btn" ${deferredPrompt ? '' : 'hidden'}>Cài app KBT Cost</button>
    ${isIOS() ? '<div>Trên iPhone: mở bằng <b>Safari</b> → bấm nút <b>Chia sẻ</b> (ô vuông có mũi tên lên) → chọn <b>Thêm vào MH chính</b>.</div>'
      : '<div>Trên Android: mở bằng <b>Chrome</b> → bấm <b>⋮</b> góc trên → chọn <b>Cài đặt ứng dụng</b> hoặc <b>Thêm vào màn hình chính</b>.</div>'}</div></section>`;
}
function bindInstall() { document.querySelectorAll('.inst-btn').forEach(b => b.onclick = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; b.hidden = true; }); }

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, 3500); }

/* ================= Cỡ chữ (phóng to / thu nhỏ trong app) ================= */
const ZOOMS = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5];
let ZI = Math.max(0, ZOOMS.indexOf(store.get('zoom', 1))); if (ZOOMS.indexOf(store.get('zoom', 1)) < 0) ZI = 3;
function applyZoom() {
  const z = ZOOMS[ZI];
  document.body.style.zoom = z === 1 ? '' : z;
  document.querySelectorAll('.zoom [data-z="0"]').forEach(b => b.textContent = Math.round(z * 100) + '%');
  store.set('zoom', z);
}
document.addEventListener('click', e => {
  const b = e.target.closest('.zoom [data-z]'); if (!b) return;
  const d = +b.dataset.z; ZI = d === 0 ? 3 : Math.min(ZOOMS.length - 1, Math.max(0, ZI + d)); applyZoom();
  toast('Cỡ chữ: ' + Math.round(ZOOMS[ZI] * 100) + '%');
});
applyZoom();

/* ================= Khởi động ================= */
(async function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
  if (!API) { $('#login').hidden = false; $('#lgForm').hidden = true; $('#lgMsg').hidden = false; $('#lgMsg').innerHTML = 'App chưa được kết nối máy chủ. Mở file <b>config.js</b> và điền SUPABASE_URL, SUPABASE_ANON_KEY theo hướng dẫn.'; return; }
  let s = null; try { s = await API.session(); } catch (e) { }
  if (s) afterLogin(s, false); else showLogin();
  window.addEventListener('online', () => { if (D) loadData(false); });
})();
