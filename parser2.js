/* KBT Cost – bộ đọc file Excel mẫu 2026 (mỗi file = 1 nhóm trong Bếp / Bar / Bếp tổng)
   Đọc theo TIÊU ĐỀ CỘT nên chịu được việc thêm/bớt cột. Không tự quyết định phân hệ lớn – người dùng chọn. */
(function (root) {
  const low = s => String(s ?? '').normalize('NFC').trim().toLowerCase();
  const nrm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
  const num = v => typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && /^-?\d+([.,]\d+)?$/.test(v.trim()) ? Number(v.trim().replace(',', '.')) : null);
  const txt = v => v == null ? '' : String(v).normalize('NFC').replace(/\s+/g, ' ').trim();
  const CODE = /^[A-Za-z][A-Za-z0-9_]*\d[A-Za-z0-9_]*$|^\d+_\d+$/;
  const isCode = v => typeof v === 'string' && CODE.test(v.trim()) && v.trim().length <= 14;

  function rows(XLSX, ws) { return ws ? XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: true }) : []; }
  function sheet(wb, ...keys) {
    for (const k of keys) { const n = wb.SheetNames.find(s => nrm(s).replace(/[_\s]+/g, ' ') === nrm(k).replace(/[_\s]+/g, ' ')); if (n) return wb.Sheets[n]; }
    return null;
  }
  const sheetLike = (wb, re) => wb.SheetNames.filter(s => re.test(nrm(s).replace(/[_\s]+/g, ' ')));

  /* ---------- nhận biết hàng tiêu đề cột ---------- */
  function colMap(r) {
    const m = {}; let hits = 0;
    r.forEach((v, i) => {
      const t = nrm(v); if (!t) return;
      if (/^ma (nvl|mon)$|^ma$/.test(t) && m.code == null) { m.code = i; hits++; }
      else if (/^ten (nvl|nguyen lieu|mon)$|^nguyen lieu( su dung)?$|^ten$|^ten sot$/.test(t) && m.name == null) { m.name = i; hits++; }
      else if (/^dvdl$/.test(t)) { m.div = i; }
      else if (/^dvt$|^dvt tp$|^don vi$/.test(t) && m.unit == null) { m.unit = i; }
      else if (/^dinh luong|^dl$|^so luong/.test(t) && !/ke toan/.test(t) && m.qty == null) { m.qty = i; hits++; }
      else if (/^tl dat|^ty le dat|^tl$/.test(t) && m.tl == null) { m.tl = i; }
      else if (/^gia nhap|^gia von$|^don gia( \(gia von\))?$|^don gia$/.test(t) && m.price == null) { m.price = i; }
      else if (/^gia 1|^gia\/dvt/.test(t) && m.unitPrice == null) { m.unitPrice = i; }
      else if (/^thanh tien/.test(t)) { m.amt = i; hits++; }
      else if (/^tinh( cost)?/.test(t)) { m.inc = i; }
      else if (/^ghi chu/.test(t) && m.note == null) { m.note = i; }
    });
    return hits >= 2 && m.name != null ? m : null;
  }
  /* tiêu đề khối: "[CODE] TÊN" hoặc [CODE, TÊN] */
  function blockTitle(r) {
    for (let i = 0; i < r.length; i++) {
      const v = r[i]; if (v == null || v === '') continue;
      const s = txt(v);
      const m = s.match(/^\[([^\]]+)\]\s*(.+?)(\s*\|.*)?$/);
      if (m && isCode(m[1].trim())) return { code: m[1].trim(), name: m[2].trim() };
      if (isCode(s) && typeof r[i + 1] === 'string' && r[i + 1].trim() && !/^\d/.test(r[i + 1])) {
        const rest = r.slice(i + 2).filter(x => x != null && x !== '');
        if (rest.every(x => typeof x === 'number' || x === '▶')) return { code: s, name: txt(r[i + 1]) };
      }
      return null;
    }
    return null;
  }
  function sectionOf(r) {
    const cells = r.map((v, i) => [v, i]).filter(([v]) => v != null && v !== '');
    if (cells.length !== 1) return null;
    const s = txt(cells[0][0]);
    const m = s.match(/^[▶◼■►]+\s*(.+)$/u); if (m) return m[1].trim();
    return null;
  }
  const rowText = r => r.filter(v => typeof v === 'string').map(nrm).join(' | ');
  const nums = r => r.map((v, i) => [num(v), i]).filter(([v]) => v != null);
  const keyCode = r => { for (const v of r) if (typeof v === 'string' && /^[^|\s]+\|[^|\s]+$/.test(v.trim())) return v.trim().split('|')[1]; return null; };
  const unitDiv = u => /^(cai|qua|chai|lon|hop|goi|suat|lat|mieng|cay|bo|tui|vi|thanh|con|binh|ly|coc|phan|dia|set|pcs|vien|bia|cuon|trai|canh)$/.test(nrm(u)) ? 1 : 1000;
  const fixDiv = d => d == null ? null : (d >= 900 ? 1000 : d <= 1.5 ? 1 : Math.round(d));

  /* ---------- đọc các khối công thức trong một sheet ---------- */
  function parseBlocks(R, opt = {}) {
    const out = []; let cm = null, cur = null, cat = opt.cat || null, phase = 'lines';
    const close = () => { if (cur) out.push(cur); cur = null; phase = 'lines'; };
    for (let i = 0; i < R.length; i++) {
      const r = R[i] || []; if (!r.some(v => v != null && v !== '')) continue;
      const sec = sectionOf(r);
      if (sec && !/^\[/.test(sec)) { close(); cat = sec.replace(/\s*\(.*\)\s*$/, '').trim(); continue; }
      const m = colMap(r);
      if (m) {
        if (!cur) { // tiêu đề khối nằm 1–3 dòng phía trên
          for (let k = i - 1; k >= Math.max(0, i - 3); k--) { const t = blockTitle(R[k] || []); if (t) { cur = { code: t.code, name: t.name, cat, lines: [], file: {} }; break; } }
        }
        if (cur && (cm == null || m.amt != null)) cm = m;
        if (cur && m.code == null && cm.code == null) cm = { ...m };
        continue;
      }
      const t = blockTitle(r);
      if (t && !(cur && phase === 'opts')) {
        // dòng tiêu đề khối mới (dòng tiêu đề cột ngay sau)
        const nx = R.slice(i + 1, i + 4).find(x => x && x.some(v => v != null && v !== ''));
        if (nx && colMap(nx)) { close(); cur = { code: t.code, name: t.name, cat, lines: [], file: {} }; if (cm && t) { /* header ở dòng sau */ } continue; }
      }
      if (!cur || !cm) continue;
      const tx = rowText(r);
      // các dòng tổng / sản lượng / giá thành
      if (/(^|\| )(tong cost|tong chi phi|tong$|tong \||tong dinh luong|tong phan co dinh)/.test(tx) || /^tong( |$)/.test(nrm(r.find(v => typeof v === 'string')))) {
        const v = cm.amt != null && num(r[cm.amt]) != null ? num(r[cm.amt]) : (nums(r).pop() || [null])[0];
        if (/tong phan co dinh/.test(tx)) { cur.file.fixed = v; phase = 'opts'; cur.opts = { n: 1, choices: [] }; }
        else if (/tong dinh luong/.test(tx)) { /* bỏ qua */ }
        else if (!/pa thap/.test(tx)) cur.file.total ??= v;
        continue;
      }
      if (/sl thanh pham|san luong thanh pham|sl tp\b/.test(tx)) {
        const ns = nums(r); const lab = r.findIndex(v => typeof v === 'string' && /sl thanh pham|san luong thanh pham|sl tp/.test(nrm(v)));
        const after = ns.filter(([, j]) => j > lab);
        cur.yld = (after[0] || ns[0] || [null])[0];
        const u = r.slice(lab + 1).find(v => typeof v === 'string' && /^(qua|g\/ml|g|ml|kg|l|lit|cai)$/.test(nrm(v)));
        cur.yUnit = u && /^qua|^cai/.test(nrm(u)) ? 'quả' : (/\(qua\)/.test(nrm(r[lab])) ? 'quả' : 'g');
        continue;
      }
      if (/gia thanh pham|gia thanh \/ ?kg|gia thanh pham \/ kg/.test(tx)) { cur.file.per = (nums(r).pop() || [null])[0]; continue; }
      if (/pa cao nhat/.test(tx)) { if (/tong cost/.test(tx)) cur.file.total = (nums(r).pop() || [null])[0]; continue; }
      if (/so ngan/.test(tx)) { if (cur.opts) cur.opts.n = (nums(r).pop() || [1])[0]; continue; }
      if (/^gia ban|% food cost|% cost|^pa thap|tong cost — pa/.test(tx)) continue;
      if (phase === 'opts') {
        const c = cm.code != null && isCode(txt(r[cm.code])) ? txt(r[cm.code]) : (isCode(txt(r[0])) ? txt(r[0]) : null);
        if (c) cur.opts.choices.push({ code: c, name: txt(r[(cm.code ?? 0) + 1]), cost0: (nums(r).pop() || [null])[0] });
        continue;
      }
      // dòng nguyên liệu
      let code = cm.code != null ? txt(r[cm.code]) : '';
      const kc = keyCode(r); if (kc && (!code || !isCode(code))) code = kc;
      const name = txt(r[cm.name]);
      const qty = cm.qty != null ? num(r[cm.qty]) : null;
      if (!name && !code) continue;
      if (qty == null && (cm.amt == null || num(r[cm.amt]) == null)) continue;
      if (/^(stt|tong)/.test(nrm(name))) continue;
      const price = cm.price != null ? num(r[cm.price]) : null, up = cm.unitPrice != null ? num(r[cm.unitPrice]) : null;
      let div = cm.div != null ? num(r[cm.div]) : null;
      if (div == null && price && up) div = fixDiv(price / up);
      const tl = cm.tl != null ? num(r[cm.tl]) : null;
      const inc = cm.inc != null ? !/^k$/i.test(txt(r[cm.inc])) : true;
      const unit = cm.unit != null ? txt(r[cm.unit]) : '';
      cur.lines.push({ code: isCode(code) ? code : null, name, qty: qty ?? 0, div: div ?? (unit ? unitDiv(unit) : null), tl0: tl, price0: price, amt0: cm.amt != null ? num(r[cm.amt]) : null, unit, inc, note: cm.note != null ? txt(r[cm.note]) || null : null });
    }
    close();
    return out.filter(b => b.lines.length || b.opts);
  }
  /* công thức: tính TL hay không — dò theo số liệu file */
  function detectTl(blocks) {
    let a = 0, b = 0;
    blocks.forEach(x => x.lines.forEach(l => {
      if (!l.tl0 || l.tl0 >= 0.999 || !l.price0 || !l.amt0 || !l.qty) return;
      const d = l.div || 1000, withTl = l.qty / l.tl0 * l.price0 / d, noTl = l.qty * l.price0 / d;
      if (Math.abs(withTl - l.amt0) < Math.abs(noTl - l.amt0)) a++; else b++;
    }));
    return b > a ? false : true;
  }

  /* ---------- danh mục ---------- */
  function parseCatalog(R) {
    let cm = null, grp = null; const out = [], seen = new Set();
    for (const r of R) {
      if (!r || !r.some(v => v != null && v !== '')) continue;
      if (!cm) {
        const t = r.map(nrm);
        const ci = t.findIndex(x => /^ma( nvl)?$/.test(x)), ni = t.findIndex(x => /nguyen lieu|^ten/.test(x));
        if (ci >= 0 && ni >= 0) cm = { code: ci, name: ni, unit: t.findIndex(x => /^dvt/.test(x)), tl: t.findIndex(x => /^tl|^ty le/.test(x)), price: t.findIndex(x => /^don gia|^gia nhap|^gia von/.test(x)), src: t.findIndex(x => /^nguon/.test(x)) };
        continue;
      }
      const c = txt(r[cm.code]);
      if (c && !isCode(c) && r.filter(v => v != null && v !== '').length === 1) { grp = c.replace(/^[▶◼\s]+/, '').trim(); continue; }
      if (!isCode(c) || seen.has(c)) continue;
      seen.add(c);
      out.push({ code: c, name: txt(r[cm.name]), unit: cm.unit >= 0 ? txt(r[cm.unit]) : '', tl: cm.tl >= 0 ? (num(r[cm.tl]) ?? 1) : 1, price: cm.price >= 0 ? num(r[cm.price]) : null, grp, src: cm.src >= 0 ? txt(r[cm.src]) || null : null });
    }
    return out;
  }
  /* bảng đơn giản: tiêu đề cột → object */
  function table(R, need) {
    for (let i = 0; i < Math.min(R.length, 12); i++) {
      const t = (R[i] || []).map(nrm);
      if (need.every(re => t.some(x => re.test(x)))) {
        const cols = t; const out = []; let sec = null;
        for (const r of R.slice(i + 1)) {
          if (!r || !r.some(v => v != null && v !== '')) continue;
          const filled = r.filter(v => v != null && v !== '');
          if (filled.length === 1 && typeof filled[0] === 'string') { sec = filled[0].replace(/^[▶◼\s]+/u, '').trim(); continue; }
          out.push({ r, sec, get: re => { const j = cols.findIndex(x => re.test(x)); return j >= 0 ? r[j] : null; } });
        }
        return out;
      }
    }
    return [];
  }
  function parseNotes(R) {
    const out = []; let hd = null;
    for (const r of R) { if (!r || !r.some(v => v != null && v !== '')) continue; if (!hd) { if (nrm(r[0]) === '#') hd = r.map(txt); continue; } out.push(r.map(v => v == null ? '' : (typeof v === 'number' ? v : txt(v)))); }
    return hd ? { head: hd, rows: out } : null;
  }

  /* ---------- combo ---------- */
  function parseCombo(XLSX, wb) {
    const dm = table(rows(XLSX, sheet(wb, 'DANH_MỤC_MÓN')), [/^ma mon/, /^ten mon/]);
    const dishes = dm.filter(x => isCode(txt(x.r[0]))).map(x => ({ code: txt(x.r[0]), name: txt(x.r[1]), cost: num(x.get(/^cost mon le/)), price: num(x.get(/^gia ban le$/)), oldCost: num(x.get(/^cost cu/)), oldPrice: num(x.get(/^gia ban le cu/)) }));
    const th = table(rows(XLSX, sheet(wb, 'TỔNG_HỢP')), [/^combo$/, /gia ban combo/]);
    const R = rows(XLSX, sheet(wb, 'COMBO')); const combos = []; let cur = null, grp = null;
    for (let i = 0; i < R.length; i++) {
      const r = R[i] || []; const f = r.filter(v => v != null && v !== '');
      if (!f.length) continue;
      const nx = R.slice(i + 1, i + 3).find(x => x && x.some(v => v != null && v !== ''));
      if (f.length === 1 && typeof f[0] === 'string' && (/^combo/i.test(f[0].trim()) || (nx && /^ma (nvl|mon)/.test(nrm(nx[0]))))) { cur = { code: null, name: f[0].trim(), price: null, fixed: [], groups: [], file: {} }; combos.push(cur); grp = null; continue; }
      if (!cur) continue;
      const a = nrm(r[0]);
      if (/^ma nvl|^ma mon/.test(a)) continue;
      if (/^a\. /.test(a)) { cur.price = num(r[5]) ?? cur.price; grp = null; continue; }
      if (/^[b-z]\. /.test(a)) { grp = { label: txt(r[0]).replace(/^[B-Z]\.\s*/, ''), items: [] }; cur.groups.push(grp); continue; }
      if (/tong cost/.test(nrm(r[2]))) { cur.file.total = num(r[4]) ?? num(r[3]); continue; }
      if (r[2] && typeof r[2] === 'string') continue;
      if (isCode(txt(r[0]))) {
        const it = { code: txt(r[0]), name: txt(r[1]), qty: num(r[2]) ?? 1, cost0: num(r[3]), price0: num(r[4]), note: txt(r[8]) || null };
        if (grp) grp.items.push(it); else cur.fixed.push(it);
      }
    }
    combos.forEach((c, i) => { const t = th.find(x => nrm(x.get(/^combo$/)) === nrm(c.name)); c.code = 'CB' + String(i + 1).padStart(2, '0'); if (t) { c.price ??= num(t.get(/gia ban combo/)); c.oldPrice = num(t.get(/gia combo cu/)); } });
    return { kind: 'combo', combos, comboDishes: dishes, cats: [], btpLocal: [], catalog: null, notes: null };
  }

  /* ---------- file nhóm ---------- */
  function parseGroupFile(XLSX, wb, fileName) {
    const names = wb.SheetNames.map(s => nrm(s).replace(/[_\s]+/g, ' '));
    const warn = [];
    if (sheet(wb, 'COMBO') && sheet(wb, 'DANH_MỤC_MÓN')) { const c = parseCombo(XLSX, wb); c.notes = null; return c; }
    const costWs = sheet(wb, 'COST');
    if (!costWs) throw new Error('File không có sheet COST – chưa đúng mẫu.');
    // danh mục
    const catName = wb.SheetNames.find(s => /^danh muc( nvl| bep tong)?$/.test(nrm(s).replace(/[_\s]+/g, ' ')));
    const catalog = catName ? parseCatalog(rows(XLSX, wb.Sheets[catName])) : null;
    const coso = sheet(wb, 'DANH_MỤC_CƠ_SỞ') ? table(rows(XLSX, sheet(wb, 'DANH_MỤC_CƠ_SỞ')), [/^ma$/, /^ten/]).filter(x => isCode(txt(x.r[0]))).map(x => ({ code: txt(x.r[0]), name: txt(x.r[1]), unit: txt(x.r[2]), cur: num(x.get(/dang dung/)), sell: num(x.get(/gia von co so/)) })) : null;
    const notes = sheet(wb, 'ĐÃ_XÁC_NHẬN') ? parseNotes(rows(XLSX, sheet(wb, 'ĐÃ_XÁC_NHẬN'))) : null;
    const costR = rows(XLSX, costWs);
    let blocks = parseBlocks(costR);
    const isDish = !!(sheet(wb, 'GIÁ_BÁN') || sheet(wb, 'MENU'));
    const useTl = detectTl(blocks);
    let recipes, kind, cats = [], btpLocal = [];
    if (isDish) {
      kind = 'dish';
      const price = {}, gb = table(rows(XLSX, sheet(wb, 'GIÁ_BÁN')), [/^ma mon/, /^gia ban/]);
      gb.forEach(x => { const c = txt(x.r[0]); if (isCode(c)) price[c] = { price: num(x.get(/^gia ban/)), note: txt(x.get(/^ghi chu/)) || null, name: txt(x.get(/^ten mon/)) }; });
      const mn = table(rows(XLSX, sheet(wb, 'MENU')), [/^ma mon/, /^ten mon/]);
      const menu = mn.map(x => ({ code: txt(x.get(/^ma mon/)), name: txt(x.get(/^ten mon/)), sec: x.sec })).filter(x => isCode(x.code));
      const order = Object.fromEntries(menu.map((m, i) => [m.code, i]));
      recipes = blocks.map(b => {
        const m = menu.find(x => x.code === b.code), p = price[b.code];
        const off = !!(menu.length && !m && !b.opts && (p?.price ?? null) !== 0 && !/them|nuoc lau/.test(nrm(b.cat)));
        return { code: b.code, name: (m?.name || p?.name || titleCase(b.name)), cat: m?.sec || b.cat || null, price: p ? p.price : null, pnote: p?.note || null, lines: b.lines, opts: b.opts || null, file: b.file, off };
      });
      recipes.sort((a, b) => (order[a.code] ?? 1e3) - (order[b.code] ?? 1e3));
      cats = [...new Set([...menu.map(m => m.sec), ...recipes.map(r => r.cat)].filter(Boolean))];
      const bt = sheet(wb, 'BÁN_THÀNH_PHẨM');
      if (bt) { const bb = parseBlocks(rows(XLSX, bt)); const tlB = detectTl(bb); btpLocal = bb.map(b => ({ code: b.code, name: titleCase(b.name), cat: b.cat, yld: b.yld, yUnit: b.yUnit || 'g', lines: b.lines, file: b.file, noTl: !tlB })); }
    } else {
      kind = 'btp';
      const th = table(rows(XLSX, sheet(wb, 'TỔNG_HỢP')), [/^ma/, /^ten/]);
      const meta = {}; th.forEach(x => { const c = txt(x.get(/^ma( btp)?$/)); if (isCode(c)) meta[c] = { name: txt(x.get(/^ten/)), sell: num(x.get(/^gia ban/)), unit: txt(x.get(/^dvt/)), sec: x.sec }; });
      const order = Object.keys(meta);
      recipes = blocks.map(b => ({ code: b.code, name: meta[b.code]?.name || titleCase(b.name), cat: meta[b.code]?.sec || b.cat || null, sell: meta[b.code]?.sell ?? null, yld: b.yld, yUnit: b.yUnit || 'g', lines: b.lines, file: b.file }));
      recipes.sort((a, b) => (order.indexOf(a.code) + 1 || 1e3) - (order.indexOf(b.code) + 1 || 1e3));
      cats = [...new Set(recipes.map(r => r.cat).filter(Boolean))];
    }
    recipes.forEach(r => { if (!useTl) r.noTl = true; });
    if (!recipes.length) throw new Error('Không tìm thấy công thức nào trong sheet COST.');
    return { kind, catalog, coso, notes, recipes, btpLocal, cats, warn, sheets: wb.SheetNames };
  }
  function titleCase(s) {
    s = txt(s); if (!s || s !== s.toUpperCase()) return s;
    return s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (a, b, c) => b + c.toUpperCase());
  }
  /* file danh mục riêng: chỉ cần có sheet danh mục */
  function parseCatalogFile(XLSX, wb) {
    const n = wb.SheetNames.find(s => /^danh muc/.test(nrm(s).replace(/[_\s]+/g, ' ')) && !/co so|mon$/.test(nrm(s).replace(/[_\s]+/g, ' ')));
    if (!n) throw new Error('Không thấy sheet DANH_MỤC trong file.');
    const items = parseCatalog(rows(XLSX, wb.Sheets[n]));
    if (!items.length) throw new Error('Sheet ' + n + ' không có mã nào.');
    return { kind: 'catalog', catalog: items };
  }
  const api = { parseGroupFile, parseCatalogFile, parseBlocks, parseCatalog, unitDiv, nrm, isCode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KBTParser2 = api;
})(typeof window !== 'undefined' ? window : globalThis);
