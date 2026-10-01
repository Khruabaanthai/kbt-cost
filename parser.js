/* Đọc file Excel định mức KBT → dữ liệu cho app.
   Dùng được trong trình duyệt (window.KBTParser) và Node (module.exports). */
(function (root) {
  const S = v => typeof v === 'string' ? v.replace(/_x000D_|\r/g, '').trim() : v;
  const num = v => typeof v === 'number' && isFinite(v) ? v : null;
  const rnd = (v, n = 4) => typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 10 ** n) / 10 ** n : v;
  const PH = v => v == null || (typeof v === 'string' && (/(bếp|bar) (điền|viết)/.test(v) || /^\[(Bếp|Bar) trưởng/.test(v.trim()) || /^_{4,}$/.test(v.trim()) || v.trim() === ''));
  const str = v => v == null ? v : String(v).trim();

  function rowsOf(XLSX, ws) {
    if (!ws || !ws['!ref']) return [];
    const R = XLSX.utils.decode_range(ws['!ref']);
    const out = [];
    for (let r = 0; r <= R.e.r; r++) {
      const row = [];
      for (let c = 0; c <= Math.max(R.e.c, 26); c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        row.push(!cell || cell.t === 'e' || cell.t === 'z' ? null : cell.v);
      }
      out.push(row);
    }
    return out;
  }

  const keyOf = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'D').toUpperCase().replace(/[^A-Z0-9]/g, '');
  function findSheet(wb, key) {
    const n = keyOf;
    const k = n(key);
    const name = wb.SheetNames.find(s => n(s) === k) || wb.SheetNames.find(s => n(s).includes(k));
    return name ? wb.Sheets[name] : null;
  }

  function parseCharts(rows) {
    const charts = []; let cur = null, sec = null, cat = null; const hdr = [];
    rows.forEach((r, i) => {
      const c3 = r[3], c4 = r[4];
      if (typeof c3 === 'string' && c3.includes('◼')) { cat = c3.replace('◼', '').trim(); return; }
      if (Number.isInteger(c3) && typeof c4 === 'string') {
        const m = c4.match(/^\[(\S+?)\]\s+(.*)/);
        if (m) { cur = { code: m[1], name: m[2].trim(), cat, ings: [], steps: [], crit: [], serve: [], img: null }; charts.push(cur); hdr.push(i); sec = null; return; }
      }
      if (!cur) return;
      if (typeof c3 === 'string') {
        const t = c3.trim();
        if (t.startsWith('I. ')) { sec = 'I'; return; }
        if (t.startsWith('II.')) { sec = 'II'; return; }
        if (t.startsWith('III.')) { sec = 'III'; return; }
        if (t.startsWith('IV.')) { sec = 'IV'; return; }
        if (t === 'STT') return;
      }
      if (sec === 'I' && Number.isInteger(c3)) cur.ings.push({ name: S(c4), unit: S(r[5]), qty: num(r[6]) != null ? num(r[6]) : S(r[6]) });
      else if (sec === 'II' && Number.isInteger(c3) && !PH(c4)) cur.steps.push(String(c4).trim());
      else if ((sec === 'III' || sec === 'IV') && typeof c3 === 'string') cur[sec === 'III' ? 'crit' : 'serve'].push([S(c3), PH(r[5]) ? null : String(r[5]).trim()]);
    });
    return { charts, hdr };
  }
  function parseSops(rows, opt = {}) {
    const sops = []; let cur = null, sec = null;
    rows.forEach(r => {
      const b = r[1], c = r[2];
      if (typeof b === 'string' && b.startsWith('SOP #')) { cur = { no: b.split('—')[0].trim(), code: null, name: null, cat: null, price: null, info: [], desc: null, ings: [], steps: [], qual: [], serve: [], errs: [] }; sops.push(cur); sec = null; return; }
      if (!cur) return;
      if (typeof b === 'string') {
        const t = b.trim();
        if (/^Mã( số)?:/.test(t)) { cur.sopCode = t.replace(/^Mã( số)?:/, '').trim(); return; }
        if (t === 'Tên Món:') { cur.name = S(c); cur.code = str(r[4]); return; }
        if (t === 'Danh Mục:') { cur.cat = S(c); cur.price = typeof r[4] === 'number' ? new Intl.NumberFormat('vi-VN').format(r[4]) + 'đ' : S(r[4]); return; }
        if (t === 'Thời gian làm món:' || t === 'Kích thước đĩa:') { cur.info.push([t.replace(/:$/, ''), PH(c) ? null : S(c)], [String(S(r[3]) || '').replace(/:$/, ''), PH(r[4]) ? null : S(r[4])]); return; }
        const mm = t.match(/^(I|II|III|IV|V|VI|VII|VIII)\.\s/);
        if (mm) { sec = mm[1]; return; }
      }
      if (sec === 'I' && typeof b === 'string' && b.trim()) cur.desc = PH(b) ? null : S(b);
      else if (sec === 'II' && Number.isInteger(b)) cur.ings.push({ name: S(c), unit: S(r[3]), qty: num(r[4]), qtyAcc: rnd(num(r[5])), note: (typeof r[5] === 'string' ? S(r[5]) : S(r[6])) ?? null });
      else if (sec === 'III' && Number.isInteger(b) && !PH(c)) cur.steps.push({ t: String(c).trim(), time: opt.bar || PH(r[3]) ? null : S(r[3]), temp: opt.bar || PH(r[4]) ? null : S(r[4]), tip: !PH(r[5]) ? S(r[5]) : (opt.bar && !PH(r[4]) ? S(r[4]) : (opt.bar && !PH(r[3]) ? S(r[3]) : null)) });
      else if (sec === 'IV' && typeof b === 'string' && b !== 'Tiêu Chí') cur.qual.push([S(b), PH(c) ? null : S(c), PH(r[4]) ? null : S(r[4])]);
      else if (sec === 'V' && typeof b === 'string') cur.serve.push([S(b), PH(c) ? null : S(c)]);
      else if (sec === 'VII' && Number.isInteger(b) && !PH(c)) cur.errs.push([S(c), S(r[3]), S(r[4]), S(r[5])]);
    });
    return sops;
  }
  function parseWorkbook(XLSX, wb) {
    const need = ['MENU_TỔNG_HỢP', 'DANH_MỤC_NVL', 'BÁN_THÀNH_PHẨM', 'COST', 'CHART', 'ĐÀO_TẠO'];
    const missing = need.filter(k => !findSheet(wb, k));
    if (missing.includes('COST')) throw new Error('File thiếu sheet COST (bảng tính food cost). Đây là sheet bắt buộc của file định mức bếp.');
    const sh = k => rowsOf(XLSX, findSheet(wb, k));
    const D = { missing };

    // MENU
    let cat = null; D.menu = [];
    sh('MENU_TỔNG_HỢP').slice(3).forEach(r => {
      if (typeof r[0] === 'string' && r[0].includes('▶')) { cat = r[0].replace('▶', '').trim(); return; }
      if (Number.isInteger(r[0])) D.menu.push({ code: str(r[1]), name: S(r[2]), cat: S(r[3]) || cat, price: num(r[4]), cost: rnd(num(r[5]), 2) });
    });

    // DANH MỤC NVL
    let grp = null; D.nvl = [];
    sh('DANH_MỤC_NVL').slice(3).forEach(r => {
      if (typeof r[0] === 'string' && r[0].includes('──')) { grp = r[0].replace('──', '').trim(); return; }
      if (r[0] != null && r[0] !== '' && r[1]) D.nvl.push({ code: str(r[0]), name: S(r[1]), unit: S(r[2]), grp: S(r[3]), price: num(r[4]), tl: num(r[5]), unitCost: rnd(num(r[6])), note: S(r[7]) ?? null, warn: S(r[8]) ?? null, sec: grp });
    });

    // BÁN THÀNH PHẨM
    D.btp = []; let cur = null;
    sh('BÁN_THÀNH_PHẨM').slice(3).forEach(r => {
      const c1 = r[1];
      if (typeof c1 === 'string') {
        const m = c1.match(/^\s*\[(\S+?)\]\s+(.*)/);
        if (m && r[0] == null) { cur = { code: m[1], name: m[2].trim(), items: [], totalQty: null, totalCost: null, yld: null, pricePerKg: null }; D.btp.push(cur); return; }
        if (cur && c1.includes('TỔNG NGUYÊN LIỆU')) { cur.totalQty = num(r[5]); cur.totalCost = rnd(num(r[8]), 2); return; }
        if (cur && c1.includes('SẢN LƯỢNG')) { cur.yld = num(r[5]); return; }
        if (cur && c1.includes('GIÁ THÀNH PHẨM')) { cur.pricePerKg = rnd(num(r[5]), 2); return; }
      }
      if (cur && r[0] && c1) cur.items.push({ code: str(c1), name: S(r[2]), unit: S(r[3]), tl: num(r[4]), qty: num(r[5]), price: num(r[6]), unitCost: rnd(num(r[7])), amount: rnd(num(r[8]), 2), note: S(r[9]) ?? null });
    });

    // COST (gồm định lượng từ MASTER)
    D.dishes = []; cur = null; cat = null;
    sh('COST').slice(3).forEach(r => {
      const c = r[3];
      if (typeof c === 'string') {
        if (c.trim().startsWith('▶')) { cat = c.replace('▶', '').trim(); return; }
        const m = c.match(/^\s*\[(\S+?)\]\s+(.*?)\s*\|\s*Giá bán:\s*([\d,\.]+)/);
        if (m) { cur = { code: m[1], name: m[2].trim(), cat, price: parseInt(m[3].replace(/[,\.]/g, ''), 10), lines: [], total: null }; D.dishes.push(cur); return; }
        if (cur && c.includes('TỔNG ĐỊNH LƯỢNG')) { cur.total = rnd(num(r[11]), 2); return; }
      }
      if (cur && r[0] && r[1]) cur.lines.push({ code: str(r[1]), name: S(r[4]), unit: S(r[5]), qty: num(r[6]), tl: num(r[7]), qtyAcc: rnd(num(r[8])), price: num(r[9]), unitCost: rnd(num(r[10])), amount: rnd(num(r[11]), 2), note: S(r[12]) ?? null });
    });

    const ch = parseCharts(sh('CHART')); D.charts = ch.charts; D._chartHeaderRows = ch.hdr;
    D.sops = parseSops(sh('ĐÀO_TẠO'));
    return D;
  }

  /* Ảnh trong sheet CHART: đọc thẳng từ gói zip của file xlsx */
  async function extractChartImages(JSZip, buf) {
    const zip = await JSZip.loadAsync(buf);
    const read = p => zip.file(p) ? zip.file(p).async('string') : Promise.resolve(null);
    const rels = async p => {
      const x = await read(p); const m = {};
      if (x) for (const r of x.matchAll(/<Relationship\b[^>]*>/g)) {
        const id = (r[0].match(/Id="([^"]+)"/) || [])[1], t = (r[0].match(/Target="([^"]+)"/) || [])[1];
        if (id) m[id] = t;
      }
      return m;
    };
    const resolve = (base, t) => { if (t.startsWith('/')) return t.slice(1); const parts = base.split('/'); parts.pop(); for (const s of t.split('/')) { if (s === '..') parts.pop(); else if (s !== '.') parts.push(s); } return parts.join('/'); };
    const wbx = await read('xl/workbook.xml');
    const sheetTag = [...wbx.matchAll(/<sheet\b[^>]*>/g)].map(m => m[0]).find(t => /name="CHART"/i.test(t));
    if (!sheetTag) return [];
    const rid = (sheetTag.match(/r:id="([^"]+)"/) || [])[1];
    const wrels = await rels('xl/_rels/workbook.xml.rels');
    const sheetPath = resolve('xl/workbook.xml', wrels[rid]);
    const srels = await rels(sheetPath.replace(/([^/]+)$/, '_rels/$1.rels'));
    const out = [];
    for (const t of Object.values(srels)) {
      if (!/drawings\/drawing/.test(t)) continue;
      const dPath = resolve(sheetPath, t);
      const dx = await read(dPath); const drels = await rels(dPath.replace(/([^/]+)$/, '_rels/$1.rels'));
      for (const a of dx.matchAll(/<xdr:(?:twoCellAnchor|oneCellAnchor)[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g)) {
        const row = +((a[0].match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/) || [])[1]);
        const emb = (a[0].match(/r:embed="([^"]+)"/) || [])[1];
        if (emb == null || isNaN(row)) continue;
        const mp = resolve(dPath, drels[emb]);
        const f = zip.file(mp); if (!f) continue;
        out.push({ row, path: mp, data: await f.async('uint8array') });
      }
    }
    return out;
  }

  function assignImages(D, imgs, toDataUrl) {
    const hdr = D._chartHeaderRows || [];
    return Promise.all(imgs.map(async im => {
      let k = -1; for (let i = 0; i < hdr.length; i++) if (hdr[i] <= im.row) k = i;
      if (k >= 0) D.charts[k].img = await toDataUrl(im);
    }));
  }


  /* ================= BAR & SỐT BẾP TỔNG ================= */
  const low = v => typeof v === 'string' ? v.normalize('NFC').trim().toLowerCase() : '';
  function detectType(wb, XLSX) {
    const n = wb.SheetNames.map(keyOf);
    const has = k => n.some(x => x.includes(k));
    if (n.includes('COST') && (has('GIABAN') || has('DINHLUONG') || has('PHACHE'))) return 'bar';
    if (XLSX && n.includes('MENU') && n.includes('COST')) {
      const t = keyOf(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[n.indexOf('MENU')]], { header: 1, raw: true, defval: null, blankrows: false }).slice(0, 3).flat().filter(v => typeof v === 'string').join(' '));
      if (t.includes('BAR')) return 'bar';
    }
    if (n.includes('COST') && (has('MENUTONGHOP') || n.includes('MASTER') || has('DANHMUCNVL') || has('CHART') || has('DAOTAO'))) return 'bep';
    if (has('DONGIASOTBEPTONG') || (has('SOT') && has('COTLAU'))) return 'sot';
    if ((n.includes('MENU') || has('MENUBAR')) && (has('NUOCEP') || n.includes('TRA') || has('TRANGMIENG'))) return 'bar';
    // dò nội dung vài dòng đầu mỗi sheet
    if (XLSX) for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false }).slice(0, 4);
      const t = keyOf(rows.flat().filter(v => typeof v === 'string').join(' '));
      if (t.includes('SOTBEPTONG')) return 'sot';
      if (t.includes('MENUBAR')) return 'bar';
      if (t.includes('MENUTONGHOP')) return 'bep';
    }
    return null;
  }
  const isHdr = r => r && /^(mã nvl|mã)$/.test(low(r[0])) && /(tên nvl|nguyên vật liệu|nguyên liệu)/.test(low(r[1]));
  function labelOf(r) { for (const c of [5, 6]) { const t = low(r[c]); if (t && !/^giá 1gr/.test(t)) return { c, t }; } return null; }
  function parseBlocks(rows, sheet) {
    const out = []; let cur = null, inTot = false;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (isHdr(rows[i + 1])) {
        const c0 = typeof r[0] === 'string' ? r[0].trim() : '';
        const isCode = /^[A-Za-z0-9_\-]{2,14}$/.test(c0);
        cur = { code: isCode ? c0 : null, name: S(r[1]) || S(r[2]) || (!isCode && c0) || '(không tên)', head: num(r[7]), head2: num(r[9]), sheet, items: [], totQty: null, total: null, yld: null, perKg: null, sell: null, ratio: null };
        out.push(cur); inTot = false; i++; continue;
      }
      if (!cur) continue;
      const lb = labelOf(r);
      if (lb && r[0] == null && (r[1] == null || r[1] === '')) {
        inTot = true; const t = lb.t, v = num(r[7]);
        if (/^(tổng|tổng cộng|tổng tiền)$/.test(t)) { cur.totQty = num(r[6]) ?? cur.totQty; cur.total = v ?? num(r[6]) ?? cur.total; if (lb.c === 6) cur.totQty = null; }
        else if (/giá bán/.test(t)) cur.sell = v;
        else if (/% ?cost/.test(t)) cur.ratio = v;
        else if (/đơn giá|giá thành phẩm/.test(t)) cur.perKg = v;
        else if (/thành phẩm|số lượng tp|sản phẩm tạo thành|^tp\b/.test(t)) cur.yld = v;
        else if (t === 'cost') cur.cost = v;
        continue;
      }
      if (inTot) continue;
      if ((r[1] != null && r[1] !== '') || (r[0] != null && r[0] !== '')) {
        if (r.slice(0, 8).every(x => x == null || x === '')) continue;
        cur.items.push({ code: str(r[0]) || null, name: S(r[1]), dv: num(r[2]), tl: num(r[3]), price: rnd(num(r[4]), 2), unitCost: rnd(num(r[5])), qty: num(r[6]), amount: rnd(num(r[7]), 2), note: typeof r[8] === 'string' ? S(r[8]) : null });
      }
    }
    return out.filter(b => b.items.length);
  }
  /* File bar dạng mới (MENU / DANH_MỤC_NVL / GIÁ_BÁN / ĐỊNH_LƯỢNG / COST / CHART / ĐÀO_TẠO) */
  function parseBar2(XLSX, wb) {
    const sh = k => rowsOf(XLSX, findSheet(wb, k));
    const D = { type: 'bar', fmt: 2, menu: [], nvl: [], recipes: [], charts: [], sops: [] };
    const price = {};
    if (findSheet(wb, 'GIÁ_BÁN')) sh('GIÁ_BÁN').slice(3).forEach(r => { if (r[0] && num(r[2]) != null) price[str(r[0])] = num(r[2]); });
    let grp = null;
    if (findSheet(wb, 'MENU')) sh('MENU').slice(3).forEach(r => {
      if (typeof r[0] === 'string' && r[0].includes('▶')) { grp = r[0].replace('▶', '').trim(); return; }
      if (Number.isInteger(r[0]) && r[1]) { const off = /ĐÃ BỎ|DỪNG BÁN/i.test(grp || ''); D.menu.push({ code: str(r[1]), name: S(r[2]), grp: off ? null : grp, price: num(r[3]) ?? price[str(r[1])] ?? null, cost: rnd(num(r[4]), 2), off, isNew: false, note: off ? 'bỏ' : null }); }
    });
    if (findSheet(wb, 'DANH_MỤC_NVL')) sh('DANH_MỤC_NVL').slice(3).forEach(r => {
      if (r[0] && r[1] && typeof r[0] === 'string' && !/^mã/i.test(r[0])) D.nvl.push({ code: str(r[0]), name: S(r[1]), unit: S(r[2]), price: rnd(num(r[3]), 2), tl: num(r[4]), unitCost: rnd(num(r[5])), warn: S(r[6]) ?? null });
    });
    let cur = null; grp = null;
    sh('COST').forEach(r => {
      const c = r[3];
      if (typeof c === 'string') {
        const t = c.trim();
        if (t.startsWith('▶')) { grp = t.replace('▶', '').trim(); return; }
        if (/VÙNG TRỐNG/i.test(t)) { cur = null; return; }
        const m = t.match(/^\[(\S+?)\]\s+(.*)$/);
        if (m) { cur = { code: m[1], name: m[2].trim(), sheet: grp || 'Khác', items: [], total: null, totQty: null, sell: price[m[1]] ?? null, ratio: null }; D.recipes.push(cur); return; }
        if (cur && /^TỔNG/i.test(t)) { cur.total = rnd(num(r[11]), 2); return; }
        if (cur && /^% ?COST/i.test(t)) { cur.ratio = num(r[11]); return; }
      }
      if (cur && r[0] && r[1] && typeof r[3] === 'number') {
        const unit = S(r[5]);
        cur.items.push({ code: str(r[1]), name: S(r[4]), unit, dv: /quả|cái|chai|lon|hộp|gói/i.test(unit || '') ? 1 : 1000, qty: num(r[6]), tl: num(r[7]), qtyAcc: rnd(num(r[8])), price: rnd(num(r[9]), 2), unitCost: rnd(num(r[10])), amount: rnd(num(r[11]), 2), note: typeof r[12] === 'string' && r[12].trim() ? S(r[12]) : null });
      }
    });
    D.recipes = D.recipes.filter(r => r.items.length);
    D.recipes.forEach(r => { r.totQty = r.items.reduce((a, l) => a + (l.qty || 0), 0); const m = D.menu.find(x => x.code === r.code); if (m && m.name) r.name = m.name; if (m && r.sell == null) r.sell = m.price; if (m && m.cost == null) m.cost = r.total; });
    if (findSheet(wb, 'CHART')) { const ch = parseCharts(sh('CHART')); D.charts = ch.charts; D._chartHeaderRows = ch.hdr; }
    if (findSheet(wb, 'ĐÀO_TẠO')) D.sops = parseSops(sh('ĐÀO_TẠO'), { bar: true });
    return D;
  }
  function parseBar(XLSX, wb) {
    if (findSheet(wb, 'COST')) return parseBar2(XLSX, wb);
    const D = { type: 'bar', menu: [], nvl: [], recipes: [] };
    let grp = null;
    rowsOf(XLSX, findSheet(wb, 'Menu')).forEach(r => {
      if (r[0] == null && r[1] == null && typeof r[2] === 'string' && r[3] == null) { grp = r[2].trim(); return; }
      if (low(r[0]) === 'stt') return;
      if (typeof r[2] === 'string' && (Number.isInteger(r[0]) || r[1])) {
        const note = S(r[6]) ?? null;
        D.menu.push({ code: str(r[1]) || null, name: S(r[2]), grp, price: num(r[3]), cost: rnd(num(r[4]), 2), off: !Number.isInteger(r[0]) && /bỏ/i.test(note || ''), isNew: /new/i.test(note || ''), note });
      }
    });
    rowsOf(XLSX, findSheet(wb, 'Danh mục')).slice(1).forEach(r => { if (r[0] && r[1]) D.nvl.push({ code: str(r[0]), name: S(r[1]), unit: S(r[2]), tl: num(r[3]), price: rnd(num(r[4]), 2) }); });
    wb.SheetNames.forEach(n => {
      const k = n.normalize('NFC').trim().toLowerCase();
      if (k === 'menu' || k === 'danh mục') return;
      const off = /dừng/.test(k);
      parseBlocks(rowsOf(XLSX, wb.Sheets[n]), n.trim()).forEach(b => { b.off = off; D.recipes.push(b); });
    });
    return D;
  }
  function parseSot(XLSX, wb) {
    const D = { type: 'sot', prices: [], priceLabel: null, nvl: [], recipes: [], note: null };
    rowsOf(XLSX, findSheet(wb, 'Đơn giá sốt bếp tổng')).forEach(r => {
      if (low(r[0]) === 'stt') { D.priceLabel = S(r[5]); return; }
      if (Number.isInteger(r[0]) && r[1]) D.prices.push({ code: str(r[1]), name: S(r[2]), unit: S(r[3]), oldPrice: num(r[4]), price: num(r[5]), unitCost: rnd(num(r[6]), 2), ratio: num(r[7]) });
      else if (typeof r[2] === 'string' && /lưu ý/i.test(r[2])) D.note = S(r[2]);
    });
    let sec = null;
    rowsOf(XLSX, findSheet(wb, 'Danh mục')).slice(1).forEach(r => {
      if (r[0] == null && typeof r[1] === 'string') { sec = r[1].trim(); return; }
      if (r[0] && r[1] && low(r[0]) !== 'mã nvl') D.nvl.push({ code: str(r[0]), name: S(r[1]), unit: S(r[2]), tl: num(r[3]), base: rnd(num(r[4]), 2), sell: num(r[5]) || null, cost: num(r[6]), sec });
    });
    wb.SheetNames.forEach(n => {
      const k = n.normalize('NFC').toLowerCase();
      if (/bỏ|danh mục|đơn giá|sheet/.test(k)) return;
      parseBlocks(rowsOf(XLSX, wb.Sheets[n]), n.trim()).forEach(b => D.recipes.push(b));
    });
    // nối bảng giá với công thức: ưu tiên trùng tên, sau đó trùng mã
    const nz = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\(.*?\)|chay tu.*|ap dung tu.*/g, '').replace(/[^a-z0-9]/g, '');
    const rn = D.recipes.map(r => nz(r.name));
    D.prices.forEach(p => {
      const k = nz(p.name); let i = rn.indexOf(k);
      if (i < 0 && k.length >= 6) i = rn.findIndex(x => x.length >= 6 && (x.includes(k) || k.includes(x)));
      if (i < 0) i = D.recipes.findIndex(r => r.code === p.code);
      p.recipe = i >= 0 ? i : null;
    });
    return D;
  }

  const api = { parseWorkbook, extractChartImages, assignImages, detectType, parseBar, parseSot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KBTParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
