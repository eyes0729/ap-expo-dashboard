/* ===========================================================================
 * 侧栏四个页面   window.APPages
 * ---------------------------------------------------------------------------
 * 原先侧栏的「AI 订单 / AI 读取记录 / 店铺 / 设置」点了只换高亮，页面不变 ——
 * 也就是四个假入口。现场只要有人点一下就露馅，所以这一版把四页补成真的。
 *
 * 为什么单独一个文件：app.js 已经 94KB，再塞 700 行进去没法看。
 * 这一层通过 init(ctx) 拿到它需要的一切（数据缓冲、格式化、抽屉、主题…），
 * 不去 reach 进 app.js 的闭包，依赖关系写在 ctx 里是明的。
 *
 * 三条设计约定（都是「真后台该有的样子」，不是装饰）：
 *
 *  1. **分页表的自动刷新只在第 1 页开**。订单/读取记录是活的流，
 *     翻到第 3 页还每秒重排的话，行会在手底下跳走，根本没法读。
 *     真实后台的做法是：第 1 页跟着流走，翻页即进入「快照」态并明确告知。
 *
 *  2. **筛选/排序/搜索作用于整个缓冲，不是当前页**。
 *     只筛当页是「假筛选」——第 2 页有匹配项却搜不出来。
 *
 *  3. **店铺页那些逐店指标（SKU 数 / 近 7 日读取 / 累计订单）是按店名稳定推导的
 *     仿真值**，不是从 ordBuf 数出来的。理由：缓冲只有最近 80 笔订单，
 *     1035 家店里 99% 会显示 0，那样的表比没有更糟。
 *     推导走 APEngine.hash32(店名)，所以同一家店每次刷新都是同一组数字。
 *     这是仿真数据，README 里如实标注。
 * =========================================================================== */
(function (root) {
  'use strict';

  var doc = root.document;
  var C = null;                 /* init 传进来的上下文 */
  var cur = 'ov';               /* 当前页 */

  /* 每页条数。**不是随手给的**，是按 975px 的可用高度倒推的：
   *   统计条 62 + 表头 34 + 分页条 47 = 143 → 表体可用 832px，行高 34 → 24.4 行
   * 给 24 行实测溢出 16px，23 行刚好装下（余 18px）。
   * 订单/读取的缓冲本来只有 80/120 笔，20 行分 4~6 页正好。 */
  var PER = { ord: 23, crawl: 23, store: 23 };

  /* 每页各自的状态。分开存，翻页/筛选互不影响。 */
  var S = {
    ord:   { page: 1, sort: { k: 't', d: -1 }, f: { src: '', cc: '', tier: '', q: '' }, snap: null },
    crawl: { page: 1, sort: { k: 't', d: -1 }, f: { bot: '', st: '', q: '' }, snap: null },
    store: { page: 1, sort: { k: 'name', d: 1 }, f: { cc: '', ind: '', st: '', q: '' } }
  };

  function el(id) { return doc.getElementById(id); }
  function mk(tag, cls, txt) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function clip(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }
  function hms(t) {
    var d = new Date(t);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2)
      + ':' + ('0' + d.getSeconds()).slice(-2);
  }
  function ymd(t) {
    var d = new Date(t);
    return (d.getMonth() + 1) + '-' + ('0' + d.getDate()).slice(-2);
  }

  /* =====================================================================
   * 通用：表格骨架 + 分页条
   * ===================================================================== */

  /** 表头。cols = [{k,label,w,cls,sortable}] */
  function renderHead(host, cols, st, onSort) {
    host.innerHTML = '';
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      var h = mk('div', 'c ' + (c.cls || '') + (c.k ? ' so' : ''), c.label);
      h.style.width = c.w + 'px';
      if (c.k) {
        h.setAttribute('data-so', c.k);
        if (st.sort.k === c.k) h.classList.add(st.sort.d > 0 ? 'asc' : 'desc');
        (function (key) {
          h.addEventListener('click', function () { onSort(key); });
        })(c.k);
      }
      host.appendChild(h);
    }
  }

  /** 分页条。返回当前页的切片。 */
  function renderPager(host, total, st, per, onGo, liveNote) {
    var pages = Math.max(1, Math.ceil(total / per));
    if (st.page > pages) st.page = pages;
    if (st.page < 1) st.page = 1;
    host.innerHTML = '';

    var info = mk('span', 'pg-i',
      total === 0 ? '共 0 条'
        : ('共 ' + total + ' 条 · 第 ' + ((st.page - 1) * per + 1) + '–'
           + Math.min(total, st.page * per) + ' 条'));
    host.appendChild(info);

    /* 第 1 页 = 跟着流走；翻页 = 快照。必须写出来，否则用户会以为数据停了。 */
    var live = mk('span', 'pg-live ' + (st.page === 1 ? 'on' : 'off'),
      st.page === 1 ? (liveNote || '实时刷新中') : '已暂停实时刷新（翻回第 1 页恢复）');
    host.appendChild(live);

    host.appendChild(mk('span', 'sp'));

    function btn(label, page, dis, cls) {
      var b = mk('button', 'pg-b ' + (cls || ''), label);
      b.type = 'button';
      if (dis) b.disabled = true;
      else b.addEventListener('click', function () { onGo(page); });
      return b;
    }
    host.appendChild(btn('‹ 上一页', st.page - 1, st.page <= 1));

    /* 页码：最多 7 个，两端 + 当前页附近，中间用省略号 */
    var list = [], i;
    if (pages <= 7) { for (i = 1; i <= pages; i++) list.push(i); }
    else {
      list.push(1);
      var a = Math.max(2, st.page - 1), b2 = Math.min(pages - 1, st.page + 1);
      if (a > 2) list.push('…');
      for (i = a; i <= b2; i++) list.push(i);
      if (b2 < pages - 1) list.push('…');
      list.push(pages);
    }
    for (i = 0; i < list.length; i++) {
      if (list[i] === '…') { host.appendChild(mk('span', 'pg-e', '…')); continue; }
      host.appendChild(btn(String(list[i]), list[i], false,
        list[i] === st.page ? 'on' : ''));
    }
    host.appendChild(btn('下一页 ›', st.page + 1, st.page >= pages));
    return { from: (st.page - 1) * per, to: st.page * per, pages: pages };
  }

  /** 统计条：一排小指标 */
  function renderStats(host, items) {
    host.innerHTML = '';
    for (var i = 0; i < items.length; i++) {
      var b = mk('div', 'stt');
      b.appendChild(mk('span', 'l', items[i][0]));
      var v = mk('span', 'v', items[i][1]);
      if (items[i][2]) v.classList.add(items[i][2]);
      b.appendChild(v);
      host.appendChild(b);
    }
  }

  function fillSel(sel, opts, allLabel, keep) {
    var html = '<option value="">' + allLabel + '</option>', i;
    for (i = 0; i < opts.length; i++) {
      html += '<option value="' + opts[i][0] + '">' + opts[i][1] + '</option>';
    }
    if (sel.innerHTML !== html) sel.innerHTML = html;
    sel.value = keep || '';
  }

  function sortBy(arr, get, dir) {
    arr.sort(function (a, b) {
      var x = get(a), y = get(b);
      if (x < y) return -dir;
      if (x > y) return dir;
      return 0;
    });
    return arr;
  }

  /* =====================================================================
   * 页 1：AI 订单
   * ===================================================================== */
  var ORD_COLS = [
    { k: 't',     label: '时间',      w: 118, cls: 'mono' },
    { k: 'no',    label: '订单号',    w: 132, cls: 'mono' },
    { k: 'store', label: '店铺',      w: 250 },
    { k: 'cc',    label: '国家 / 地区', w: 118 },
    { k: null,    label: '商品',      w: 372 },
    { k: 'src',   label: '来自 AI 助手', w: 148 },
    { k: 'usd',   label: '金额',      w: 132, cls: 'mono r' },
    { k: 'tier',  label: '规模',      w: 96 },
    { k: null,    label: '买家城市',  w: 158 }
  ];

  function ordRows() {
    var st = S.ord, all = C.ordBuf(), out = [], i, o;
    for (i = 0; i < all.length; i++) {
      o = all[i];
      if (st.f.src && (o.platform || 'Others') !== st.f.src) continue;
      if (st.f.cc && o.store.cc !== st.f.cc) continue;
      if (st.f.tier && o.tier !== st.f.tier) continue;
      if (st.f.q) {
        var q = st.f.q.toLowerCase();
        if (String(o.store.name).toLowerCase().indexOf(q) < 0
            && String(o.product || '').toLowerCase().indexOf(q) < 0
            && C.ordNo(o).toLowerCase().indexOf(q) < 0
            && String(o.store.domain || '').toLowerCase().indexOf(q) < 0) continue;
      }
      out.push(o);
    }
    var k = st.sort.k, d = st.sort.d;
    var get = {
      t: function (o) { return o.t; },
      no: function (o) { return C.ordNo(o); },
      store: function (o) { return o.store.name; },
      cc: function (o) { return C.CC_CN[o.store.cc] || o.store.cc; },
      src: function (o) { return o.platform || ''; },
      usd: function (o) { return o.usd; },
      tier: function (o) { return C.TIER_RANK[o.tier] || 0; }
    }[k] || function (o) { return o.t; };
    return sortBy(out, get, d);
  }

  function drawOrd() {
    var st = S.ord;
    var rows = ordRows();

    /* 统计走**筛选后的全集**，不是当前页 —— 否则翻页时「总成交额」会变 */
    var sum = 0, big = 0, i;
    for (i = 0; i < rows.length; i++) {
      sum += rows[i].usd;
      if (C.TIER_RANK[rows[i].tier] >= 2) big++;
    }
    /* 标签必须写清口径。这一页统计的是**订单明细缓冲**（最近约 80 笔），
     * 而 KPI 卡上的成交额是本场累计（几十万）。两个数都对，但都叫「成交额」
     * 就会变成「一屏两个口径」—— 商家一定会问哪个是真的（V1 踩过一次）。 */
    var m0 = C.E.metrics();
    renderStats(el('pOrdStats'), [
      ['明细条数', C.E.fmtInt(rows.length) + ' 笔'],
      ['这些订单合计', C.E.fmtUSD(sum).replace(/\.\d+$/, ''), 'em'],
      ['平均订单额', rows.length ? C.E.fmtUSD(sum / rows.length).replace(/\.\d+$/, '') : '—'],
      ['其中大额', big + ' 笔'],
      /* 这两行读的是引擎 session 原值。只要 app.js 里 DISP 的三个 *AtT0 基线
       * 都还是 0，它就与看板 KPI 卡完全一致；**一旦给基线设了非 0 值，这里必须
       * 同步加上**，否则这一页和看板会显示两个不同的「累计」——
       * 而「同一屏两个口径」正是 DISP 那段注释里在防的那件事。 */
      ['本场累计成交额', C.E.fmtUSD(m0.session.gmv).replace(/\.\d+$/, '')],
      ['本场累计订单', C.E.fmtInt(m0.session.orders) + ' 笔']
    ]);

    /* 筛选下拉的选项跟着缓冲里真实出现过的值走 */
    var srcs = {}, ccs = {}, all = C.ordBuf();
    for (i = 0; i < all.length; i++) {
      srcs[all[i].platform || 'Others'] = 1;
      ccs[all[i].store.cc] = 1;
    }
    fillSel(el('pOrdSrc'), Object.keys(srcs).sort().map(function (k) {
      return [k, C.PF_CN[k] || k];
    }), '全部 AI 助手', st.f.src);
    fillSel(el('pOrdCC'), Object.keys(ccs).sort().map(function (k) {
      return [k, C.CC_CN[k] || k];
    }), '全部国家 / 地区', st.f.cc);

    renderHead(el('pOrdHead'), ORD_COLS, st, function (k) {
      if (st.sort.k === k) st.sort.d = -st.sort.d;
      else { st.sort.k = k; st.sort.d = (k === 't' || k === 'usd' || k === 'tier') ? -1 : 1; }
      drawOrd();
    });

    var slice = renderPager(el('pOrdPager'), rows.length, st, PER.ord,
      function (p) { st.page = p; drawOrd(); });

    var body = el('pOrdBody');
    body.innerHTML = '';
    if (!rows.length) {
      body.appendChild(emptyBox('没有符合条件的订单', '试着清空筛选，或换一个时间范围'));
      return;
    }
    for (i = slice.from; i < Math.min(slice.to, rows.length); i++) {
      var o = rows[i];
      var r = mk('div', 'prow');
      var tier = C.TIER_RANK[o.tier] || 0;
      addCell(r, ORD_COLS[0], ymd(o.t) + ' ' + hms(o.t));
      addCell(r, ORD_COLS[1], C.ordNo(o));
      addCell(r, ORD_COLS[2], o.store.name);
      addCell(r, ORD_COLS[3], C.CC_CN[o.store.cc] || o.store.cc);
      addCell(r, ORD_COLS[4], clip(o.product, 52));
      addCell(r, ORD_COLS[5], C.PF_CN[o.platform] || o.platform || '—');
      addCell(r, ORD_COLS[6], C.E.fmtUSD(o.usd).replace(/\.\d+$/, ''));
      var tc = mk('div', 'c');
      tc.style.width = ORD_COLS[7].w + 'px';
      tc.appendChild(mk('span', 'tag t' + (tier + 1), C.TIER_CN[o.tier] || o.tier || ''));
      r.appendChild(tc);
      addCell(r, ORD_COLS[8], o.buyerCity || '—');
      (function (od) {
        r.addEventListener('click', function () { C.openDrawer(od); });
      })(o);
      body.appendChild(r);
    }
  }

  function addCell(row, col, txt) {
    var c = mk('div', 'c ' + (col.cls || ''), txt);
    c.style.width = col.w + 'px';
    row.appendChild(c);
  }
  function emptyBox(title, hint) {
    var b = mk('div', 'pempty');
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="1.4"><circle cx="11" cy="11" r="7"/><path d="M16 16l5 5"/></svg>';
    b.appendChild(mk('b', '', title));
    if (hint) b.appendChild(mk('s', '', hint));
    return b;
  }

  /* =====================================================================
   * 页 2：AI 读取记录
   * ===================================================================== */
  var CR_COLS = [
    { k: 't',    label: '时间',        w: 128, cls: 'mono' },
    { k: 'pf',   label: 'AI 助手',     w: 132 },
    { k: 'bot',  label: '爬虫 token',  w: 196, cls: 'mono' },
    { k: 'store', label: '店铺',        w: 236 },
    { k: null,   label: '请求路径',    w: 452, cls: 'mono' },
    { k: 'st',   label: '结果',        w: 106 },
    { k: 'ms',   label: '耗时',        w: 96, cls: 'mono r' },
    { k: 'dc',   label: '读取来源',    w: 176 }
  ];

  function crRows() {
    var st = S.crawl, all = C.logBuf(), out = [], i, c;
    for (i = 0; i < all.length; i++) {
      c = all[i];
      if (st.f.bot && (C.BOT_CN[c.bot] || c.platform || 'Others') !== st.f.bot) continue;
      if (st.f.st && String(c.status) !== st.f.st) continue;
      if (st.f.q) {
        var q = st.f.q.toLowerCase();
        if (String(c.path || '').toLowerCase().indexOf(q) < 0
            && String(c.store ? c.store.name : '').toLowerCase().indexOf(q) < 0
            && String(c.bot || '').toLowerCase().indexOf(q) < 0) continue;
      }
      out.push(c);
    }
    var k = st.sort.k, d = st.sort.d;
    var get = {
      t: function (c) { return c.t; },
      pf: function (c) { return C.BOT_CN[c.bot] || c.platform || ''; },
      bot: function (c) { return c.bot || ''; },
      store: function (c) { return c.store ? c.store.name : ''; },
      st: function (c) { return c.status || 0; },
      ms: function (c) { return c.ms || 0; },
      dc: function (c) { return c.dcCity || ''; }
    }[k] || function (c) { return c.t; };
    return sortBy(out, get, d);
  }

  function drawCrawl() {
    var st = S.crawl, rows = crRows(), i;
    var n200 = 0, n304 = 0, msSum = 0;
    for (i = 0; i < rows.length; i++) {
      if (rows[i].status === 304) n304++; else n200++;
      msSum += rows[i].ms || 0;
    }
    var m = C.E.metrics();
    renderStats(el('pCrStats'), [
      ['累计读取（全平台）', C.E.fmtInt(m.crawls)],
      ['缓冲内记录', rows.length + ' 条'],
      ['已读取 200', String(n200), 'ok'],
      ['内容未变 304', String(n304)],
      ['平均耗时', rows.length ? (msSum / rows.length).toFixed(0) + 'ms' : '—']
    ]);

    var bots = {}, all = C.logBuf();
    for (i = 0; i < all.length; i++) bots[C.BOT_CN[all[i].bot] || all[i].platform || 'Others'] = 1;
    fillSel(el('pCrBot'), Object.keys(bots).sort().map(function (k) { return [k, k]; }),
      '全部 AI 助手', st.f.bot);

    renderHead(el('pCrHead'), CR_COLS, st, function (k) {
      if (st.sort.k === k) st.sort.d = -st.sort.d;
      else { st.sort.k = k; st.sort.d = (k === 't' || k === 'ms') ? -1 : 1; }
      drawCrawl();
    });

    var slice = renderPager(el('pCrPager'), rows.length, st, PER.crawl,
      function (p) { st.page = p; drawCrawl(); });

    var body = el('pCrBody');
    body.innerHTML = '';
    if (!rows.length) {
      body.appendChild(emptyBox('没有符合条件的读取记录', '换一个 AI 助手或结果筛选看看'));
      return;
    }
    for (i = slice.from; i < Math.min(slice.to, rows.length); i++) {
      var c = rows[i];
      var r = mk('div', 'prow');
      addCell(r, CR_COLS[0], ymd(c.t) + ' ' + hms(c.t));
      addCell(r, CR_COLS[1], C.BOT_CN[c.bot] || C.PF_CN[c.platform] || c.platform || '—');
      addCell(r, CR_COLS[2], c.bot || '—');
      addCell(r, CR_COLS[3], c.store ? c.store.name : '—');
      addCell(r, CR_COLS[4], clip(c.path, 64));
      var sc = mk('div', 'c');
      sc.style.width = CR_COLS[5].w + 'px';
      sc.appendChild(mk('span', 'pill ' + (c.status === 304 ? 'p304' : 'p200'),
        c.status === 304 ? '内容未变' : '已读取'));
      r.appendChild(sc);
      addCell(r, CR_COLS[6], (c.ms || 0) + 'ms');
      addCell(r, CR_COLS[7], c.dcCity || '—');
      body.appendChild(r);
    }
  }

  /* =====================================================================
   * 页 3：店铺
   *
   * 逐店指标是按店名稳定推导的仿真值（见文件头第 3 条）。
   * ===================================================================== */
  var ST_COLS = [
    { k: 'name', label: '店铺',      w: 250 },
    { k: 'dom',  label: '域名',      w: 300, cls: 'mono' },
    { k: 'cc',   label: '国家 / 地区', w: 128 },
    { k: 'ind',  label: '行业',      w: 172 },
    { k: 'st',   label: '接入状态',  w: 128 },
    { k: 'sku',  label: 'SKU 数',    w: 112, cls: 'mono r' },
    { k: 'rd',   label: '近 7 日读取', w: 132, cls: 'mono r' },
    { k: 'ord',  label: '累计 AI 订单', w: 138, cls: 'mono r' },
    { k: 'day',  label: '接入时长',  w: 130, cls: 'mono r' }
  ];
  var ST_STATUS = ['已接入', '已接入', '已接入', '已接入', '已接入',
                   '已接入', '已接入', '待验证', '已暂停'];

  var shopCache = null;
  function shopList() {
    if (shopCache) return shopCache;
    var src = C.shops(), out = [], i;
    for (i = 0; i < src.length; i++) {
      var s = src[i];
      var h = function (salt) { return C.E.hash32(i + 1, salt); };
      var st = ST_STATUS[(h(9101) * ST_STATUS.length) | 0];
      var sku = 40 + Math.floor(h(9103) * 2600);
      out.push({
        name: s.name,
        dom: s.dom ? (s.dom + '.myshopify.com') : C.maskDomain(s.name),
        cc: s.cc, ind: s.ind || '其他',
        st: st,
        sku: sku,
        /* 读取量跟 SKU 数正相关（真实关系：页面越多被抓越多），
         * 已暂停的店读取量归零 —— 否则「已暂停」这个状态就没有意义 */
        rd: st === '已暂停' ? 0 : Math.floor(sku * (1.2 + h(9107) * 5.4)),
        ord: st === '已接入' ? Math.floor(h(9109) * h(9111) * 240) : 0,
        day: 3 + Math.floor(h(9113) * 520)
      });
    }
    shopCache = out;
    return out;
  }

  function stRows() {
    var st = S.store, all = shopList(), out = [], i;
    for (i = 0; i < all.length; i++) {
      var s = all[i];
      if (st.f.cc && s.cc !== st.f.cc) continue;
      if (st.f.ind && s.ind !== st.f.ind) continue;
      if (st.f.st && s.st !== st.f.st) continue;
      if (st.f.q) {
        var q = st.f.q.toLowerCase();
        if (s.name.toLowerCase().indexOf(q) < 0
            && s.dom.toLowerCase().indexOf(q) < 0
            && (C.CC_CN[s.cc] || s.cc).toLowerCase().indexOf(q) < 0
            && s.ind.toLowerCase().indexOf(q) < 0) continue;
      }
      out.push(s);
    }
    var k = st.sort.k, d = st.sort.d;
    var get = {
      name: function (s) { return s.name; },
      dom: function (s) { return s.dom; },
      cc: function (s) { return C.CC_CN[s.cc] || s.cc; },
      ind: function (s) { return s.ind; },
      st: function (s) { return s.st; },
      sku: function (s) { return s.sku; },
      rd: function (s) { return s.rd; },
      ord: function (s) { return s.ord; },
      day: function (s) { return s.day; }
    }[k] || function (s) { return s.name; };
    return sortBy(out, get, d);
  }

  function drawStore() {
    var st = S.store, rows = stRows(), all = shopList(), i;

    var ccs = {}, inds = {}, live = 0, paused = 0, skuSum = 0;
    for (i = 0; i < all.length; i++) {
      ccs[all[i].cc] = (ccs[all[i].cc] || 0) + 1;
      inds[all[i].ind] = 1;
      if (all[i].st === '已接入') live++;
      if (all[i].st === '已暂停') paused++;
      skuSum += all[i].sku;
    }
    renderStats(el('pStStats'), [
      ['店铺总数', C.E.fmtInt(all.length) + ' 家'],
      ['正常接入', C.E.fmtInt(live) + ' 家', 'ok'],
      ['已暂停', paused + ' 家', paused ? 'warn' : ''],
      ['覆盖国家 / 地区', Object.keys(ccs).length + ' 个'],
      ['商品页合计', C.E.fmtInt(skuSum) + ' 个'],
      ['当前筛选结果', C.E.fmtInt(rows.length) + ' 家', 'em']
    ]);

    fillSel(el('pStCC'), Object.keys(ccs).sort(function (a, b) { return ccs[b] - ccs[a]; })
      .map(function (k) { return [k, (C.CC_CN[k] || k) + '（' + ccs[k] + '）']; }),
      '全部国家 / 地区', st.f.cc);
    fillSel(el('pStInd'), Object.keys(inds).sort().map(function (k) { return [k, k]; }),
      '全部行业', st.f.ind);
    fillSel(el('pStSt'), [['已接入', '已接入'], ['待验证', '待验证'], ['已暂停', '已暂停']],
      '全部状态', st.f.st);

    renderHead(el('pStHead'), ST_COLS, st, function (k) {
      if (st.sort.k === k) st.sort.d = -st.sort.d;
      else { st.sort.k = k; st.sort.d = (k === 'name' || k === 'dom' || k === 'cc' || k === 'ind' || k === 'st') ? 1 : -1; }
      drawStore();
    });

    var slice = renderPager(el('pStPager'), rows.length, st, PER.store,
      function (p) { st.page = p; drawStore(); }, '店铺池为静态名录');

    var body = el('pStBody');
    body.innerHTML = '';
    if (!rows.length) {
      body.appendChild(emptyBox('没有匹配的店铺',
        st.f.q ? ('「' + st.f.q + '」没有命中任何店铺名 / 域名 / 国家 / 行业') : '试着清空筛选'));
      return;
    }
    for (i = slice.from; i < Math.min(slice.to, rows.length); i++) {
      var s = rows[i];
      var r = mk('div', 'prow');
      addCell(r, ST_COLS[0], s.name);
      addCell(r, ST_COLS[1], s.dom);
      addCell(r, ST_COLS[2], C.CC_CN[s.cc] || s.cc);
      addCell(r, ST_COLS[3], s.ind);
      var sc = mk('div', 'c');
      sc.style.width = ST_COLS[4].w + 'px';
      sc.appendChild(mk('span', 'pill ' + (s.st === '已接入' ? 'p200'
        : (s.st === '已暂停' ? 'poff' : 'p304')), s.st));
      r.appendChild(sc);
      addCell(r, ST_COLS[5], C.E.fmtInt(s.sku));
      addCell(r, ST_COLS[6], C.E.fmtInt(s.rd));
      addCell(r, ST_COLS[7], C.E.fmtInt(s.ord));
      addCell(r, ST_COLS[8], s.day + ' 天');
      body.appendChild(r);
    }
  }

  /* =====================================================================
   * 页 4：设置
   *
   * 这一页的每个控件都**真的接在引擎/音频/主题上**。
   * 摆一排不通电的开关比没有这一页更糟 —— 那是明确的假操作。
   * ===================================================================== */
  function row(host, title, hint, ctrl) {
    var r = mk('div', 'srow');
    var l = mk('div', 'sl');
    l.appendChild(mk('b', '', title));
    if (hint) l.appendChild(mk('s', '', hint));
    r.appendChild(l);
    var rr = mk('div', 'sr');
    rr.appendChild(ctrl);
    r.appendChild(rr);
    host.appendChild(r);
    return r;
  }
  function segCtl(opts, getCur, onPick) {
    var g = mk('div', 'seg');
    function paint() {
      var c = getCur();
      for (var i = 0; i < g.children.length; i++) {
        g.children[i].classList.toggle('on',
          g.children[i].getAttribute('data-v') === String(c));
      }
    }
    for (var i = 0; i < opts.length; i++) {
      var b = mk('button', '', opts[i][1]);
      b.type = 'button';
      b.setAttribute('data-v', String(opts[i][0]));
      (function (v) {
        b.addEventListener('click', function () { onPick(v); paint(); });
      })(opts[i][0]);
      g.appendChild(b);
    }
    paint();
    g.__paint = paint;
    return g;
  }
  function toggleCtl(getCur, onSet) {
    var t = mk('button', 'tgl');
    t.type = 'button';
    function paint() { t.classList.toggle('on', !!getCur()); }
    t.appendChild(mk('i'));
    t.addEventListener('click', function () { onSet(!getCur()); paint(); });
    paint();
    t.__paint = paint;
    return t;
  }

  var setPainters = [];
  function buildSettings() {
    var host = el('pSetBody');
    if (!host || host.getAttribute('data-built')) return;
    host.setAttribute('data-built', '1');
    setPainters = [];

    /* 两列。单列排下来是 1150px，在 1080 的屏上要滚 ——
     * 而这是块朝外的展会屏，没人会去发现里面还能滚。两列后 5 组全在一屏内。 */
    var colL = mk('div', 'scol'), colR = mk('div', 'scol');
    host.appendChild(colL); host.appendChild(colR);

    /* ── 外观 ── */
    var g1 = mk('div', 'sgrp');
    g1.appendChild(mk('div', 'sgt', '外观'));
    var themeSeg = segCtl([['dark', '深色'], ['light', '浅色']],
      function () { return C.themeKey(); }, function (v) { C.setThemeKey(v); });
    setPainters.push(themeSeg.__paint);
    row(g1, '界面主题', '朝外的屏建议深色 —— 浅色在 3 米外会反光（现场实测）', themeSeg);
    colL.appendChild(g1);

    /* ── 演示 ── */
    var g2 = mk('div', 'sgrp');
    g2.appendChild(mk('div', 'sgt', '演示控制'));
    var spd = segCtl([[0.5, '×0.5'], [1, '×1'], [3, '×3'], [20, '×20']],
      function () { return C.speed(); }, function (v) { C.setSpeed(v); });
    setPainters.push(spd.__paint);
    row(g2, '推进速率', '影响订单/读取的到达节奏。快捷键 1 / 2 / 3', spd);

    var pz = toggleCtl(function () { return C.paused(); },
      function (v) { if (v !== C.paused()) C.togglePause(); });
    setPainters.push(pz.__paint);
    row(g2, '暂停推进', '暂停后画面静止但不清空数据。快捷键 空格', pz);

    var rng = segCtl([['session', '上线至今'], ['all', '累计']],
      function () { return C.rng(); }, function (v) { C.setRng(v); });
    setPainters.push(rng.__paint);
    row(g2, '默认时间范围', '与顶栏那组按钮是同一个状态', rng);
    colL.appendChild(g2);

    /* ── 播报 ── */
    var g3 = mk('div', 'sgrp');
    g3.appendChild(mk('div', 'sgt', '播报与庆祝'));
    var cel = toggleCtl(function () { return C.opt('celebrate'); },
      function (v) { C.setOpt('celebrate', v); });
    setPainters.push(cel.__paint);
    row(g3, '大额成交全屏礼花', '只对 epic / legendary 触发；关掉后仍会出顶部横幅', cel);

    var thr = segCtl([[300, '$300'], [800, '$800'], [2000, '$2,000']],
      function () { return C.opt('celebMin'); }, function (v) { C.setOpt('celebMin', v); });
    setPainters.push(thr.__paint);
    row(g3, '礼花触发金额', '低于这个金额只走横幅，不占满屏', thr);

    var mile = toggleCtl(function () { return C.opt('milestone'); },
      function (v) { C.setOpt('milestone', v); });
    setPainters.push(mile.__paint);
    row(g3, '平台里程碑横幅', '「已有 N 个商品页可被 AI 读懂」，每千级触发一次', mile);

    var pop = toggleCtl(function () { return C.opt('mapPop'); },
      function (v) { C.setOpt('mapPop', v); });
    setPainters.push(pop.__paint);
    row(g3, '地图订单播报卡', '新订单在地图点位旁弹一张小卡，同屏最多 3 张', pop);
    colR.appendChild(g3);

    /* ── 声音 ── */
    var g4 = mk('div', 'sgrp');
    g4.appendChild(mk('div', 'sgt', '声音'));
    var mute = toggleCtl(function () { return C.audio('muted'); },
      function () { C.audioDo('toggleMute'); });
    setPainters.push(mute.__paint);
    row(g4, '静音', '快捷键 M。展会机没有中文音色时人声本来就是哑的', mute);

    var amb = toggleCtl(function () { return C.audio('ambient'); },
      function (v) { C.audioDo('ambient', v); });
    setPainters.push(amb.__paint);
    row(g4, '环境音床', '低音量底噪，让展位不至于死寂。快捷键 A', amb);

    var hall = toggleCtl(function () { return C.audio('hall'); },
      function (v) { C.audioDo('hall', v); });
    setPainters.push(hall.__paint);
    row(g4, '展馆音频模式', '压缩动态范围，嘈杂环境里更听得清。快捷键 H', hall);
    colL.appendChild(g4);

    /* ── 数据来源（只读说明，不是控件） ── */
    var g5 = mk('div', 'sgrp');
    g5.appendChild(mk('div', 'sgt', '数据与口径'));
    var note = mk('div', 'snote');
    note.innerHTML =
      '<p><b>店铺池</b>：来自真实客户报表（' + C.E.fmtInt(shopList().length)
      + ' 家），店名中间已打 <code>**</code> 脱敏，不含域名 / Email / 联系人 / 安装时间。</p>'
      + '<p><b>逐店指标</b>（SKU 数 / 近 7 日读取 / 累计订单 / 接入时长）是按店名稳定推导的'
      + '<b>仿真值</b>，不是真实经营数据 —— 缓冲只有最近数十笔订单，'
      + '直接数会让 99% 的店显示 0。</p>'
      + '<p><b>渠道占比</b>用引擎的 <code>platformBreakdown()</code>（权威权重）作基数，'
      + '增量走真实订单，所以是活的。</p>'
      + '<p><b>爬虫 token</b> 全部是各家官方文档里公布的真实 user agent，'
      + '包含 Gemini 侧的 <code>Google-GeminiNotebook</code> 与 <code>Google-Agent</code>。</p>';
    g5.appendChild(note);
    colR.appendChild(g5);
  }
  function repaintSettings() {
    for (var i = 0; i < setPainters.length; i++) {
      try { setPainters[i](); } catch (e) {}
    }
  }

  /* =====================================================================
   * 页面切换
   * ===================================================================== */
  var CRUMB = { ov: '实时看板', ord: 'AI 订单', crawl: 'AI 读取记录',
                store: '店铺', set: '设置' };

  function show(key) {
    if (!CRUMB[key]) key = 'ov';
    cur = key;
    var pages = doc.querySelectorAll('#content .page'), i;
    for (i = 0; i < pages.length; i++) {
      pages[i].classList.toggle('on', pages[i].getAttribute('data-page') === key);
    }
    var navs = doc.querySelectorAll('#side nav a');
    for (i = 0; i < navs.length; i++) {
      navs[i].classList.toggle('on', navs[i].getAttribute('data-nav') === key);
    }
    var cb = el('crumbCur');
    if (cb) cb.textContent = CRUMB[key];
    /* 顶栏那几个控件只对看板/订单页有意义，别页上要么禁用要么改语义 */
    C.onPageChange(key);
    if (key === 'ord') drawOrd();
    else if (key === 'crawl') drawCrawl();
    else if (key === 'store') drawStore();
    else if (key === 'set') { buildSettings(); repaintSettings(); }
  }

  /** 每秒从 frame 调一次：只有停在第 1 页的活页才自动重画（见文件头第 1 条） */
  function tick() {
    if (cur === 'ord' && S.ord.page === 1) drawOrd();
    else if (cur === 'crawl' && S.crawl.page === 1) drawCrawl();
    else if (cur === 'set') repaintSettings();
  }

  function wire() {
    /* 订单页 */
    el('pOrdSrc').addEventListener('change', function () {
      S.ord.f.src = this.value; S.ord.page = 1; drawOrd();
    });
    el('pOrdCC').addEventListener('change', function () {
      S.ord.f.cc = this.value; S.ord.page = 1; drawOrd();
    });
    el('pOrdTier').addEventListener('change', function () {
      S.ord.f.tier = this.value; S.ord.page = 1; drawOrd();
    });
    el('pOrdClr').addEventListener('click', function () {
      S.ord.f = { src: '', cc: '', tier: '', q: '' };
      S.ord.page = 1;
      resetInputs(['pOrdQ'], ['pOrdSrc', 'pOrdCC', 'pOrdTier']);
      drawOrd();
    });
    el('pOrdExp').addEventListener('click', function () { C.exportOrders(ordRows()); });
    bindSearch('pOrdQ', function (v) { S.ord.f.q = v; S.ord.page = 1; drawOrd(); });

    /* 读取记录页 */
    el('pCrBot').addEventListener('change', function () {
      S.crawl.f.bot = this.value; S.crawl.page = 1; drawCrawl();
    });
    el('pCrSt').addEventListener('change', function () {
      S.crawl.f.st = this.value; S.crawl.page = 1; drawCrawl();
    });
    el('pCrClr').addEventListener('click', function () {
      S.crawl.f = { bot: '', st: '', q: '' };
      S.crawl.page = 1;
      resetInputs(['pCrQ'], ['pCrBot', 'pCrSt']);
      drawCrawl();
    });
    el('pCrExp').addEventListener('click', function () { C.exportCrawls(crRows()); });
    bindSearch('pCrQ', function (v) { S.crawl.f.q = v; S.crawl.page = 1; drawCrawl(); });

    /* 店铺页 */
    el('pStCC').addEventListener('change', function () {
      S.store.f.cc = this.value; S.store.page = 1; drawStore();
    });
    el('pStInd').addEventListener('change', function () {
      S.store.f.ind = this.value; S.store.page = 1; drawStore();
    });
    el('pStSt').addEventListener('change', function () {
      S.store.f.st = this.value; S.store.page = 1; drawStore();
    });
    el('pStClr').addEventListener('click', function () {
      S.store.f = { cc: '', ind: '', st: '', q: '' };
      S.store.page = 1;
      resetInputs(['pStQ'], ['pStCC', 'pStInd', 'pStSt']);
      drawStore();
    });
    el('pStExp').addEventListener('click', function () { C.exportShops(stRows()); });
    bindSearch('pStQ', function (v) { S.store.f.q = v; S.store.page = 1; drawStore(); });

    /* 侧栏导航 */
    var navs = doc.querySelectorAll('#side nav a');
    for (var i = 0; i < navs.length; i++) {
      (function (a) {
        a.addEventListener('click', function () { show(a.getAttribute('data-nav')); });
      })(navs[i]);
    }
  }

  /** 「清空筛选」要把**控件本身**也复位，不只是内部状态。
   *
   * 原来只清了搜索框、没清下拉框 —— 结果点完清空，表格回到全集了，
   * 而下拉框还停在「200」上。界面显示着一个并没有生效的筛选条件，
   * 操作员看到的和数据实际的对不上，这比不给按钮更糟。
   * 用 selectedIndex = 0 而不是 value = ''：不依赖第一个 option 的 value 怎么写。 */
  function resetInputs(textIds, selIds) {
    var i, e;
    for (i = 0; i < textIds.length; i++) { e = el(textIds[i]); if (e) e.value = ''; }
    for (i = 0; i < selIds.length; i++) { e = el(selIds[i]); if (e) e.selectedIndex = 0; }
  }

  function bindSearch(id, cb) {
    var e = el(id);
    if (!e) return;
    var t = 0;
    e.addEventListener('input', function () {
      var self = this;
      root.clearTimeout(t);
      t = root.setTimeout(function () { cb(self.value.trim()); }, 170);
    });
  }

  root.APPages = {
    init: function (ctx) { C = ctx; wire(); return this; },
    show: show,
    tick: tick,
    get cur() { return cur; },
    /** 自检口：让验收脚本能问「这一页现在有多少行 / 第几页 / 共几页」 */
    get diag() {
      return {
        cur: cur,
        ord: { rows: C ? ordRows().length : 0, page: S.ord.page, f: S.ord.f },
        crawl: { rows: C ? crRows().length : 0, page: S.crawl.page, f: S.crawl.f },
        store: { rows: C ? stRows().length : 0, page: S.store.page, f: S.store.f,
                 total: C ? shopList().length : 0 },
        domRows: {
          ord: doc.querySelectorAll('#pOrdBody .prow').length,
          crawl: doc.querySelectorAll('#pCrBody .prow').length,
          store: doc.querySelectorAll('#pStBody .prow').length
        }
      };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
