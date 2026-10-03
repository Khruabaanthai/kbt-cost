/* KBT Cost – bộ tính cost mẫu 2026
   Thành tiền 1 dòng = Định lượng ÷ TL đạt × Giá nhập ÷ ĐVĐL   (BTP bar: không chia TL – đúng như file)
   Giá thành BTP / kg = Tổng tiền (các dòng "Tính" = C) × 1000 ÷ SL thành phẩm  (ĐVT quả: Tổng ÷ SL)
   Lẩu nhiều ngăn: cost = phần cố định + số ngăn × gói nước lẩu đắt nhất
   Combo: cost = Σ món cố định + món đắt nhất của mỗi nhóm lựa chọn */
(function (root) {
  const nrm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().trim();
  const unitDiv = u => /^(cai|qua|chai|lon|hop|goi|suat|lat|mieng|cay|bo|tui|vi|thanh|con|binh|ly|coc|phan|dia|set|pcs|vien|bia|cuon|trai|canh)$/.test(nrm(u)) ? 1 : 1000;
  const r2 = v => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;

  function lineCalc(l, cat, noTl) {
    const n = l.code ? cat[l.code] : null;
    l.price = n ? (n.price ?? 0) : (l.price0 ?? 0);
    l.tl = n ? (n.tl || 1) : (l.tl0 || 1);
    l.div = l.div || (n ? (n.div || unitDiv(n.unit)) : 1000);
    l.miss = !n && !!l.code;
    l.amount = r2((l.qty || 0) / (noTl ? 1 : l.tl) * (l.price || 0) / l.div);
    if (l.inc === false) l.amount = r2(l.amount);
    return l.inc === false ? 0 : (l.amount || 0);
  }
  /* S = { cat: {items:[]}, groups: [ {id, kind, items:[...] } ] } – tính tại chỗ */
  function compute(S) {
    const cat = {}; (S.cat?.items || []).forEach(n => { n.div = n.div || unitDiv(n.unit); cat[n.code] = n; });
    const btps = [], dishes = [], combos = [];
    (S.groups || []).forEach(g => (g.items || []).forEach(r => { r._g = g.id; (g.kind === 'btp' ? btps : g.kind === 'combo' ? combos : dishes).push(r); }));
    const byCode = {};
    for (let pass = 0; pass < 6; pass++) {
      btps.forEach(b => {
        b.total = r2(b.lines.reduce((a, l) => a + lineCalc(l, cat, b.noTl), 0));
        b.totQty = r2(b.lines.reduce((a, l) => a + (l.inc === false ? 0 : (l.qty || 0)), 0));
        b.per = b.yld ? r2(b.yUnit === 'quả' ? b.total / b.yld : b.total * 1000 / b.yld) : null;
        const n = cat[b.code];
        if (n && b.per != null && !b.unlinked) { n.price = b.per; n.calc = b._g; }
        b.ratio = b.sell ? b.per / b.sell : null;
      });
    }
    dishes.forEach(d => { d.fixed = r2(d.lines.reduce((a, l) => a + lineCalc(l, cat, d.noTl), 0)); byCode[d.code] = d; });
    btps.forEach(b => { byCode[b.code] ??= b; });
    dishes.forEach(d => {
      if (d.opts && d.opts.choices?.length) {
        const cs = d.opts.choices.map(c => { const r = byCode[c.code]; c.cost = r ? (r.fixed ?? r.total) : c.cost0; c.miss = !r; return c.cost || 0; });
        const n = d.opts.n || 1;
        d.costMin = r2(d.fixed + n * Math.min(...cs)); d.total = r2(d.fixed + n * Math.max(...cs));
      } else { d.total = d.fixed; d.costMin = null; }
      d.ratio = d.price ? d.total / d.price : null;
    });
    combos.forEach(c => {
      const look = it => { const r = byCode[it.code]; it.cost = r ? r.total : it.cost0; it.price = r && r.price != null ? r.price : it.price0; it.miss = !r; it.dname = r ? r.name : it.name; };
      c.fixed.forEach(look); c.groups.forEach(g => g.items.forEach(look));
      const fx = c.fixed.reduce((a, it) => a + (it.cost || 0) * (it.qty || 1), 0), fp = c.fixed.reduce((a, it) => a + (it.price || 0) * (it.qty || 1), 0);
      let hi = fx, lo = fx, ph = fp;
      c.groups.forEach(g => { if (!g.items.length) return; const best = g.items.reduce((a, b) => (b.cost || 0) > (a.cost || 0) ? b : a); hi += best.cost || 0; lo += Math.min(...g.items.map(x => x.cost || 0)); ph += best.price || 0; });
      c.total = r2(hi); c.costMin = c.groups.length ? r2(lo) : null; c.retail = ph; c.save = ph - (c.price || 0);
      c.ratio = c.price ? c.total / c.price : null;
    });
    return S;
  }
  /* so số tính lại với số trong file (để kiểm tra khi tải lên) */
  function check(S) {
    const bad = [];
    (S.groups || []).forEach(g => (g.items || []).forEach(r => {
      if (g.kind === 'combo') { if (r.file?.total != null && Math.abs(r.total - r.file.total) > 2) bad.push({ g: g.name, code: r.code, name: r.name, file: r.file.total, app: r.total }); return; }
      const fv = g.kind === 'btp' ? r.file?.per : r.file?.total, av = g.kind === 'btp' ? r.per : r.total;
      if (fv != null && av != null && Math.abs(fv - av) > Math.max(2, Math.abs(fv) * 0.0005)) bad.push({ g: g.name, code: r.code, name: r.name, file: fv, app: av });
    }));
    return bad;
  }
  const api = { compute, check, unitDiv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KBTEngine2 = api;
})(typeof window !== 'undefined' ? window : globalThis);
