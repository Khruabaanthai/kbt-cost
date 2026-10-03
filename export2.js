/* KBT Cost – xuất 1 nhóm / danh mục ra Excel đúng mẫu để sửa và tải lại */
(function (root) {
  const stamp = () => new Date().toLocaleString('vi-VN');
  const catSheet = (items, title) => [[title + ` — xuất từ app KBT Cost ${stamp()}`], ['Sửa đơn giá / TL đạt rồi tải lại vào app (chọn đúng phân hệ & mục Danh mục NVL).'],
    ['MÃ NVL', 'Nguyên liệu sử dụng', 'ĐVT', 'Tỷ lệ đạt', 'Đơn giá', 'Nguồn đơn giá'],
    ...grouped(items, n => n.grp, n => [n.code, n.name, n.unit || '', n.tl ?? 1, n.price ?? 0, n.calc ? 'Tự tính từ công thức' : (n.src || 'Nhập tay')])];
  function grouped(list, key, row) { const out = []; let cur; list.forEach(x => { const k = key(x) || null; if (k && k !== cur) { out.push(['  ' + k]); cur = k; } out.push(row(x)); }); return out; }
  const r2 = v => v == null ? null : Math.round(v * 100) / 100;

  function dishBook(g, cat) {
    const menu = [[`MENU ${g.name.toUpperCase()} — xuất từ app KBT Cost ${stamp()}`], ['Giá bán ← GIÁ_BÁN | Cost tính từ COST'], ['STT', 'Mã món', 'Tên món', 'Giá bán', 'Cost', 'Tỷ lệ cost']];
    let i = 0, cur;
    g.items.filter(r => !r.off).forEach(r => { if (r.cat && r.cat !== cur) { menu.push(['  ▶  ' + r.cat]); cur = r.cat; } menu.push([++i, r.code, r.name, r.price ?? null, r2(r.total), r.price ? r.total / r.price : null]); });
    const gia = [[`GIÁ BÁN ${g.name.toUpperCase()}`], ['Sửa giá bán tại đây'], ['Mã món', 'Tên món', 'Giá bán', 'Ghi chú'], ...g.items.map(r => [r.code, r.name, r.price ?? null, r.pnote || (r.off ? 'ĐÃ BỎ' : null)])];
    const cost = [[`FOOD COST ${g.name.toUpperCase()}`], ['Thành tiền = ĐL ÷ TL đạt × Giá nhập ÷ ĐVĐL']]; cur = undefined;
    g.items.forEach(r => {
      if (r.cat && r.cat !== cur) { cost.push([]); cost.push(['▶  ' + r.cat]); cur = r.cat; }
      cost.push([]); cost.push([r.code, r.name.toUpperCase(), null, null, null, null, null, null, r2(r.total)]);
      cost.push(['Mã NVL', 'Tên NVL', 'ĐVĐL', 'Định lượng', 'TL đạt', 'ĐL kế toán', 'Giá nhập', 'Giá/đvt', 'Thành tiền']);
      r.lines.forEach(l => cost.push([l.code || '', l.name, l.div || 1000, l.qty, l.tl ?? 1, l.qty / (l.tl || 1), l.price ?? 0, (l.price ?? 0) / (l.div || 1000), r2(l.amount)]));
      if (r.opts && r.opts.choices?.length) {
        cost.push(['TỔNG PHẦN CỐ ĐỊNH', null, null, null, null, null, null, null, r2(r.fixed)]);
        cost.push(['NƯỚC LẨU — mỗi ngăn khách chọn 1 gói']);
        r.opts.choices.forEach(c => cost.push([c.code, c.name, null, null, null, null, null, null, r2(c.cost), '/gói']));
        cost.push(['Số ngăn', null, null, null, null, null, null, null, r.opts.n]);
        cost.push(['TỔNG COST — PA cao nhất (dùng tính)', null, null, null, null, null, null, null, r2(r.total)]);
      } else cost.push(['TỔNG COST', null, null, null, null, null, null, null, r2(r.total)]);
    });
    return [['MENU', menu, [6, 12, 40, 12, 12, 10]], ['DANH_MỤC_NVL', catSheet(cat, 'DANH MỤC NGUYÊN LIỆU'), [10, 44, 8, 10, 12, 20]], ['GIÁ_BÁN', gia, [12, 40, 12, 30]], ['COST', cost, [12, 40, 8, 11, 8, 11, 12, 10, 12, 6]]];
  }
  function btpBook(g, cat, sec) {
    const sot = sec === 'sot';
    const th = [[`${g.name.toUpperCase()} — xuất từ app KBT Cost ${stamp()}`], ['Đơn giá tự tính từ COST + DANH MỤC'], ['STT', 'Mã BTP', 'Tên bán thành phẩm', 'ĐVT TP', 'Tổng ĐL', 'SL thành phẩm', 'Tổng chi phí', 'Đơn giá tự tính', ...(sot ? ['GIÁ BÁN xuống cơ sở', '% cost'] : [])]];
    let cur, i = 0;
    g.items.forEach(r => { if (r.cat && r.cat !== cur) { th.push(['  ▶  ' + r.cat]); cur = r.cat; } th.push([++i, r.code, r.name, r.yUnit === 'quả' ? 'quả' : 'g/ml', r.totQty, r.yld, r2(r.total), r2(r.per), ...(sot ? [r.sell ?? null, r.sell ? r.per / r.sell : null] : [])]); });
    const cost = [[`COST ${g.name.toUpperCase()} — Đơn giá tính trên 1 kg (lít) thành phẩm`], ['Thành tiền = ĐL ÷ TL × Giá nhập ÷ ĐVĐL | chỉ cộng dòng Tính = C | Đơn giá/kg = Tổng × 1000 ÷ SL thành phẩm']]; cur = undefined;
    g.items.forEach(r => {
      if (r.cat && r.cat !== cur) { cost.push([]); cost.push(['▶  ' + r.cat]); cur = r.cat; }
      cost.push([]); cost.push([r.code, r.name.toUpperCase(), null, null, null, null, null, r2(r.per)]);
      cost.push(['Mã NVL', 'Tên NVL', 'ĐVĐL', 'TL đạt', 'Giá nhập', 'Giá 1 đv', 'ĐL', 'Thành tiền', 'Tính']);
      r.lines.forEach(l => cost.push([l.code || '', l.name, l.div || 1000, l.tl ?? 1, l.price ?? 0, (l.price ?? 0) / (l.div || 1000) / (r.noTl ? 1 : (l.tl || 1)), l.qty, r2(l.amount), l.inc === false ? 'K' : 'C']));
      cost.push([null, null, null, null, null, 'Tổng', r.totQty, r2(r.total)]);
      cost.push([null, null, null, null, 'SL Thành phẩm', null, null, r.yld, r.yUnit === 'quả' ? 'quả' : 'g/ml']);
      cost.push([null, null, null, null, 'Giá Thành Phẩm / Kg (Lít)', null, null, r2(r.per)]);
    });
    return [['TỔNG_HỢP', th, [6, 10, 40, 8, 10, 10, 12, 12, 14, 8]], [sot ? 'DANH_MỤC_BẾP_TỔNG' : 'DANH_MỤC', catSheet(cat, 'DANH MỤC'), [10, 44, 8, 10, 12, 20]], ['COST', cost, [12, 40, 8, 8, 12, 10, 10, 12, 6]]];
  }
  function comboBook(g) {
    const th = [[`TỔNG HỢP ${g.name.toUpperCase()} — xuất từ app KBT Cost ${stamp()}`], ['Cost món lấy từ app; % cost tính theo phương án cao nhất'], ['STT', 'Combo', 'Giá bán combo', 'Tổng cost (PA chính)', '% cost / combo', 'Giá trị gọi lẻ', 'Khách tiết kiệm', 'Giá combo cũ']];
    g.items.forEach((c, i) => th.push([i + 1, c.name, c.price, r2(c.total), c.price ? c.total / c.price : null, c.retail, c.save, c.oldPrice ?? null]));
    const seen = new Map(); g.items.forEach(c => [...c.fixed, ...c.groups.flatMap(x => x.items)].forEach(it => { if (!seen.has(it.code)) seen.set(it.code, it); }));
    const dm = [['DANH MỤC MÓN LẺ DÙNG TRONG COMBO'], ['Cost & giá lẻ tại thời điểm xuất'], ['Mã món', 'Tên món', 'Cost món lẻ', 'Giá bán lẻ', '% cost món lẻ'], ...[...seen.values()].map(it => [it.code, it.dname || it.name, r2(it.cost), it.price ?? null, it.price ? it.cost / it.price : null])];
    const cb = [];
    g.items.forEach(c => {
      cb.push([]); cb.push([null, c.name]);
      cb.push(['Mã NVL', 'Tên NVL', 'Số lượng', 'Cost món lẻ', 'Giá bán lẻ', 'Giá bán Combo Hiện tại', 'Chênh lệch giá bán lẻ với combo', 'Lựa chọn', 'Ghi chú thay đổi']);
      cb.push(['A. MÓN CỐ ĐỊNH (luôn phục vụ)', null, null, null, null, c.price, c.save]);
      c.fixed.forEach(it => cb.push([it.code, it.dname || it.name, it.qty || 1, r2(it.cost), it.price ?? null, null, null, null, it.note || null]));
      c.groups.forEach((gr, i) => { cb.push([String.fromCharCode(66 + i) + '. ' + (gr.label || 'NHÓM LỰA CHỌN — khách chọn 1 món')]); gr.items.forEach((it, j) => cb.push([it.code, it.dname || it.name, j ? null : 1, r2(it.cost), it.price ?? null, null, null, j ? null : 'Chọn 1', it.note || null])); });
      cb.push([null, null, 'Tổng cost', r2(c.costMin ?? c.total), r2(c.total)]);
    });
    return [['TỔNG_HỢP', th, [6, 30, 14, 14, 10, 14, 12, 12]], ['DANH_MỤC_MÓN', dm, [12, 40, 12, 12, 10]], ['COMBO', cb, [12, 40, 10, 12, 12, 14, 14, 10, 30]]];
  }
  const groupBook = (g, cat, sec) => g.kind === 'combo' ? comboBook(g) : g.kind === 'btp' ? btpBook(g, cat, sec) : dishBook(g, cat);
  const catalogBook = (items, sec) => [[sec === 'sot' ? 'DANH_MỤC_BẾP_TỔNG' : 'DANH_MỤC_NVL', catSheet(items, 'DANH MỤC NGUYÊN LIỆU'), [10, 44, 8, 10, 12, 20]]];
  function toWorkbook(XLSX, sheets) {
    const wb = XLSX.utils.book_new();
    sheets.forEach(([name, aoa, w]) => { const ws = XLSX.utils.aoa_to_sheet(aoa); if (w) ws['!cols'] = w.map(x => ({ wch: x })); XLSX.utils.book_append_sheet(wb, ws, name); });
    return wb;
  }
  const api = { groupBook, catalogBook, toWorkbook };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KBTExport2 = api;
})(typeof window !== 'undefined' ? window : globalThis);
