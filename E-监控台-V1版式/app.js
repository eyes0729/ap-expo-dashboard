/* ===========================================================================
 * AP 展会大屏 · 方案 E「运营监控台」· V1 版式 · 可切换主题色
 * ---------------------------------------------------------------------------
 * 与 E-运营监控台 是**平行版本**，两者都保留：
 *   E-运营监控台   地图占两卡宽、两个大指标、无接入店铺
 *   本版（V1 版式） 严格照 V1 静态稿：1 主角 + 3 配角、中段三块面板、订单流 6 行
 *
 * ── 版面（都是算出来的）────────────────────────────────────────────────
 *   顶栏 56 │ 远距离层 168 │ 中段 464 │ 下段 392   = 1080
 *   页脚按要求整条省掉，腾出的 44px 给了中段（所以下段仍是 392，
 *   V1 稿那句「给它 392px、行高守住 49px，就只能排 6 行」仍然成立）。
 *   订单列宽合计 933 ≤ 50% 面板内宽 ~950
 *   日志列宽合计 882 ≤ 剩余面板内宽 ~926
 *   订单可用高 392-34-38-2 = 318 → 49px × 6 行 = 294 ✓
 *   日志可用高 392-34-30-2 = 326 → 28px × 11 行 = 308 ✓
 *
 * ── 主题切换 ──────────────────────────────────────────────────────────
 *   整屏配色走 CSS 自定义属性，换主题＝换一组值 + 重烤地图底图。
 *   五套主题全部取自本项目已有色板，不是随手调的：见下面 THEMES 的注释。
 *   入口：顶栏「主题」控件（点击）+ 快捷键 T。选择存 localStorage，刷新保留。
 *
 * ── 借来的做法与出处 ──────────────────────────────────────────────────
 *   焦点公式         01 线对 Shopify Live View 的像素实测：主角不靠字号，
 *                    靠字重 + 标签在上 + 归组降权 + 不挂 sparkline + 满高分隔线
 *   底色规律         02 线 getComputedStyle 实测：面板比底亮、纯黑只当缝
 *   日志样式         方案 A 右半边（9 列 / ASN / 混着 304 / 脱敏 IP）+ 渐入渐隐
 *   订单入场动画     方案 C 原版：整表下移 260ms + 逐格 split-flap 揭示
 *   订单强调样式     C-LED 中文版：3px 标记条 + 整行高亮 + 大额转红（不做点阵/发光）
 *   高亮时序         03 线实测 ag-grid：保持 500ms + 淡出 900ms（不是第四版的 480ms 线性）
 *
 * classic script。零网络依赖。随机一律 APEngine.hash32，步长一律 APEngine.dt()（毫秒！）。
 * =========================================================================== */
(function (root) {
  'use strict';

  var doc = root.document;
  var E = root.APEngine, A = root.APAudio, Geo = root.APGeo;
  var W = 1920, H = 1080;

  var ORD_ROWS = 6, ORD_H = 49;
  var LOG_ROWS = 11, LOG_H = 28;

  var ORD_COLS = [
    /* 合计 930 ≤ 面板内宽 ~950。来自列必须 108（Perplexity 10 字约 80px + 24 内边距），
     * 订单规模只放 2 个中文字所以给 56，挤出来的宽度全给店铺与商品名。 */
    ['t',     96, 'm dim'], ['store', 166, ''], ['cc',  70, 'dim'],
    ['prod', 270, 'dim'],   ['src',   108, 'dim'],
    ['amt',  136, 'r amt'], ['tier',   84, '']
  ];
  var ORD_HEAD = ['时间', '店铺', '国家', '商品', '来自', '金额', '订单规模'];
  /* 日志列：给商家看的版本。删掉了「来源 IP / ASN / 大小」——那三列商家完全不关心，
   * 而且 ASN 这种词只有做技术的看得懂。状态码 200/304 翻成人话。
   * 保留「响应耗时」是因为它对商家其实有用（自己店响应快不快）。
   * 列宽合计 908 ≤ 面板内宽 ~926。 */
  var LOG_COLS = [
    ['t',   104, ''], ['bot', 212, 'bot'], ['path', 276, ''],
    ['st',   96, ''], ['ms',  88, 'r'], ['dc', 132, '']
  ];
  var LOG_HEAD = ['时间', 'AI 助手', '读取的页面', '结果', '响应耗时', '读取来源地'];

  /* C 原版的翻牌参数（原文 STAGGER 21 / 26，STEP 46 / 54）。本版逐「格」翻，
   * 不是逐字符 —— 同样是从左到右的波浪，但 DOM 只需 7 个格，长跑更稳。 */
  var STAGGER = 21, STAGGER_HOT = 26, STEP = 46, STEP_HOT = 54;
  var CLS_D = '0123456789';
  var CLS_U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var CLS_L = 'abcdefghijklmnopqrstuvwxyz';
  var CLS_CJK = '普通较大特成交订单店铺市场来源金额稀有引荐';

  /* =====================================================================
   * 主题色（五套，全部取自本项目已有色板）
   * ===================================================================== */
  var THEMES = [
    { key: 'p1', name: '深空石墨', note: '方案 A / B 的 P1',
      v: { bg: '#08090B', panel: '#101216', panel2: '#15181D', bar: '#131620',
           hair: '#1C1F25', hair2: '#262A33',
           tx: '#F7F8F8', tx2: '#9CA3AF', mute: '#6B7280', faint: '#4B5563',
           crawl: '#00D3A7', 'crawl-d': '#0B7360', order: '#FFB86B', 'order-d': '#8A5A28',
           red: '#FF6B60', ok: '#35D06A',
           land: '#2A313B', mkt: '#4A5A66', mkt2: '#6E8794' } },

    { key: 'grafana', name: 'Grafana 实测', note: '02 线 getComputedStyle 实测值',
      v: { bg: '#111217', panel: '#181b1f', panel2: '#1e2227', bar: '#1a1e23',
           hair: '#2e3036', hair2: '#3a3d45',
           tx: '#d8dbe0', tx2: '#9aa0aa', mute: '#6b7280', faint: '#4d545e',
           crawl: '#4CC2E0', 'crawl-d': '#1F6A80', order: '#FFB020', 'order-d': '#8A6014',
           red: '#FF6B60', ok: '#35D06A',
           land: '#333B45', mkt: '#4E606E', mkt2: '#7189A0' } },

    { key: 'p2', name: '暖墨陶土', note: '方案 C 原版的 P2',
      v: { bg: '#12100E', panel: '#1B1815', panel2: '#211D19', bar: '#1E1A16',
           hair: '#2A2521', hair2: '#3A322B',
           tx: '#F4EFE6', tx2: '#B9AFA1', mute: '#7A7166', faint: '#5C544B',
           crawl: '#6A8E7F', 'crawl-d': '#3A5449', order: '#D97757', 'order-d': '#7E4630',
           red: '#C8503C', ok: '#6A8E7F',
           land: '#332C25', mkt: '#5A4E42', mkt2: '#7E6E5D' } },

    { key: 'p3', name: '黑绿', note: '方案 D 的 P3（现场最亮）',
      v: { bg: '#04120C', panel: '#0A1B12', panel2: '#0E2317', bar: '#0C1F14',
           hair: '#17301F', hair2: '#21402C',
           tx: '#FFFFFF', tx2: '#93A79C', mute: '#6A8474', faint: '#4C6356',
           crawl: '#00C46A', 'crawl-d': '#0A6A3C', order: '#FFD166', 'order-d': '#8A6E28',
           red: '#FF6B60', ok: '#B8FFCE',
           land: '#1B3626', mkt: '#2E5740', mkt2: '#4E8664' } },

    { key: 'led', name: '点阵琥珀', note: 'C-LED 第四版',
      v: { bg: '#050505', panel: '#0C0B08', panel2: '#14110A', bar: '#14110A',
           hair: '#241E12', hair2: '#4A3A1C',
           tx: '#F2F2F2', tx2: '#8A8A8A', mute: '#5E5E5E', faint: '#464646',
           crawl: '#2AA8C0', 'crawl-d': '#17616F', order: '#FFB020', 'order-d': '#8A6014',
           red: '#FF3B30', ok: '#35D06A',
           land: '#2A2418', mkt: '#3E3524', mkt2: '#6E5A2E' } }
  ];
  var themeIdx = 0;
  var stage = doc.getElementById('stage');

  function applyTheme(i, quiet) {
    themeIdx = ((i % THEMES.length) + THEMES.length) % THEMES.length;
    var t = THEMES[themeIdx], k;
    for (k in t.v) if (Object.prototype.hasOwnProperty.call(t.v, k)) {
      stage.style.setProperty('--' + k, t.v[k]);
    }
    /* 主题控件已从展会屏上移除（挑配色是内部的事），所以这里要兜 null。
     * T 键仍然可用，切换的反馈就是整屏变色本身。 */
    var nameEl = doc.getElementById('themeName');
    if (nameEl) nameEl.textContent = t.name;
    /* 地图底图的陆块与市场点也是主题色，必须重烤 —— 只改 CSS 变量它不会变 */
    if (mapCtx) { bakeMap(); }
    try { root.localStorage.setItem('apE_theme', t.key); } catch (e) {}

  }
  function cycleTheme() { applyTheme(themeIdx + 1); }


  /* =====================================================================
   * 舞台缩放
   * ===================================================================== */
  function fit() {
    var s = Math.min(root.innerWidth / W, root.innerHeight / H);
    stage.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
  }
  root.addEventListener('resize', fit);
  fit();

  /* =====================================================================
   * 点阵世界地图（陆块掩码与 C-LED 第四版逐字节相同）
   * ===================================================================== */
  var MAP_COLS = 64, MAP_ROWS = 26, MAP_LON0 = -180, MAP_DLON = 360 / MAP_COLS;
  var MAP_LAT0 = 78, MAP_DLAT = 5;
  var LAND = [
    [[11,18],[22,27]], [[4,19],[22,27],[35,63]], [[2,21],[23,28],[33,63]],
    [[2,21],[23,24],[32,63]], [[1,4],[8,21],[30,31],[33,63]], [[9,21],[30,57]],
    [[10,20],[31,57]], [[10,20],[30,57]], [[11,19],[30,33],[36,56]], [[11,18],[29,55]],
    [[12,14],[17,17],[28,42],[44,53]], [[12,14],[28,41],[44,51],[53,53]],
    [[13,15],[28,39],[45,46],[49,51],[53,54]], [[16,20],[29,40],[45,45],[49,51],[53,54]],
    [[17,22],[30,40],[46,46],[50,50],[53,54]], [[17,24],[33,39],[50,54]],
    [[17,25],[33,39],[50,53],[55,58]], [[18,25],[33,39],[51,52],[54,58]],
    [[18,25],[33,40],[54,57]], [[19,25],[34,38],[40,40],[52,58]],
    [[19,24],[34,37],[39,39],[51,59]], [[19,23],[35,37],[52,59]], [[19,22],[35,36],[52,58]],
    [[19,21],[57,58],[62,62]], [[19,20],[57,57],[61,62]], [[19,20],[61,61]]
  ];
  var mapCv = doc.getElementById('map'), mapCtx = null, mapBase = null;
  var MW = 0, MH = 0, MPX = 0, MPY = 0, MDOT = 0.84;

  function mapGeom() {
    MW = mapCv.width; MH = mapCv.height;
    MPX = MW / MAP_COLS; MPY = MH / MAP_ROWS;
  }
  function cellRect(g, cx, cy, k) {
    var w = MPX * MDOT * k, h = MPY * MDOT * k, r = Math.min(w, h) * 0.34;
    g.beginPath();
    if (g.roundRect) g.roundRect(cx - w / 2, cy - h / 2, w, h, r);
    else g.rect(cx - w / 2, cy - h / 2, w, h);
    g.fill();
  }
  function lonlatToCell(lon, lat) {
    var c = Math.round((lon - MAP_LON0) / MAP_DLON - 0.5);
    var r = Math.round((MAP_LAT0 - lat) / MAP_DLAT - 0.5);
    return [Math.max(0, Math.min(MAP_COLS - 1, c)), Math.max(0, Math.min(MAP_ROWS - 1, r))];
  }
  function cellCenter(c, r) { return [(c + 0.5) * MPX, (r + 0.5) * MPY]; }
  function themeVal(k) { return THEMES[themeIdx].v[k]; }

  function bakeMap() {
    var c = doc.createElement('canvas');
    c.width = MW; c.height = MH;
    var g = c.getContext('2d'), r, k, x, i;
    g.fillStyle = themeVal('land');
    for (r = 0; r < LAND.length && r < MAP_ROWS; r++) {
      for (k = 0; k < LAND[r].length; k++) {
        var seg = LAND[r][k];
        for (x = seg[0]; x <= seg[1] && x < MAP_COLS; x++) {
          var p = cellCenter(x, r);
          cellRect(g, p[0], p[1], 1);
        }
      }
    }
    var pts = marketPoints();
    for (i = 0; i < pts.length; i++) {
      var pc = lonlatToCell(pts[i][0], pts[i][1]), q = cellCenter(pc[0], pc[1]);
      g.fillStyle = (i < 5) ? themeVal('mkt2') : themeVal('mkt');
      cellRect(g, q[0], q[1], i < 5 ? 1.15 : 1.0);
    }
    mapBase = c;
  }

  /** 市场代表点：每个市场取该国权重最高的城市。
   *  APGeo 真实结构：MARKETS=[{cc,...}] 按 weight 降序；CITIES=[名称,纬度,经度,国家码,权重]
   *  —— CITIES 是**数组的数组**，按对象属性取 cc 会全部落空。 */
  function marketPoints() {
    var out = [], i, j;
    try {
      var mk = Geo && Geo.MARKETS, byCc = Geo && Geo.citiesByCC;
      if (mk && mk.length && byCc) {
        for (i = 0; i < mk.length; i++) {
          var pool = byCc[mk[i].cc];
          if (!pool || !pool.length) continue;
          var best = pool[0];
          for (j = 1; j < pool.length; j++) if (pool[j][4] > best[4]) best = pool[j];
          out.push([best[2], best[1]]);
        }
      }
    } catch (e) { out = []; }
    if (out.length < 6) {
      out = [[-74,40.7],[-0.1,51.5],[13.4,52.5],[2.35,48.9],[-79.4,43.7],[151.2,-33.9],
             [139.7,35.7],[-46.6,-23.5],[4.9,52.4],[18.1,59.3],[-99.1,19.4],[21,52.2]];
    }
    return out;
  }

  var hits = [], HIT_CAP = 90;
  function addHit(lon, lat, kind) {
    if (lon == null || lat == null) return;
    var pc = lonlatToCell(lon, lat), p = cellCenter(pc[0], pc[1]);
    hits.push({ x: p[0], y: p[1], age: 0, dur: kind === 'order' ? 900 : 520, kind: kind });
    if (hits.length > HIT_CAP) hits.splice(0, hits.length - HIT_CAP);
  }
  function drawMap(dtMs) {
    if (!mapCtx) return;
    var g = mapCtx, i;
    g.clearRect(0, 0, MW, MH);
    if (mapBase) g.drawImage(mapBase, 0, 0);
    for (i = hits.length - 1; i >= 0; i--) {
      var ht = hits[i];
      ht.age += dtMs;
      var u = ht.age / ht.dur;
      if (u >= 1) { hits.splice(i, 1); continue; }
      var col = (ht.kind === 'order') ? themeVal('order') : themeVal('crawl');
      if (ht.kind === 'order') {
        g.strokeStyle = col; g.globalAlpha = (1 - u) * 0.55; g.lineWidth = 1.6;
        g.beginPath(); g.arc(ht.x, ht.y, MPY * (0.9 + u * 3.4), 0, 6.283); g.stroke();
      }
      g.globalAlpha = (ht.kind === 'order') ? (1 - u * 0.55) : (1 - u) * 0.85;
      g.fillStyle = col;
      cellRect(g, ht.x, ht.y, ht.kind === 'order' ? 1.3 : 1.0);
      g.globalAlpha = 1;
    }
  }

  /* =====================================================================
   * 迷你时序（三个配角格各一条）
   * ===================================================================== */
  function makeSpark(hostId, w, h) {
    var cv = doc.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    doc.getElementById(hostId).appendChild(cv);
    var hist = [];
    return {
      push: function (v) { hist.push(v); if (hist.length > 28) hist.shift(); },
      draw: function () {
        var g = cv.getContext('2d'), i;
        g.clearRect(0, 0, w, h);
        if (hist.length < 5) return;   /* 2~3 个点画出来是一条平灰条，像空占位 */
        var mn = Infinity, mx = -Infinity, sum = 0;
        for (i = 0; i < hist.length; i++) {
          mn = Math.min(mn, hist[i]); mx = Math.max(mx, hist[i]); sum += hist[i];
        }
        /* 纯 min-max 会把极小波动放大成陡坡。给量程一个「不小于均值 25%」的地板，
         * 波动小的时候就该画得平。 */
        var mean = sum / hist.length, span = Math.max(mx - mn, Math.abs(mean) * 0.08) || 1;
        var mid = (mx + mn) / 2; mn = mid - span / 2;
        g.beginPath();
        for (i = 0; i < hist.length; i++) {
          var x = i / (hist.length - 1) * w;
          var y = h - 2 - ((hist[i] - mn) / span) * (h - 5);
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.strokeStyle = themeVal('mkt'); g.lineWidth = 1.5; g.lineJoin = 'round'; g.stroke();
        g.lineTo(w, h); g.lineTo(0, h); g.closePath();
        g.globalAlpha = 0.18; g.fillStyle = themeVal('mkt'); g.fill(); g.globalAlpha = 1;
      }
    };
  }
  var sk1, sk2, sk3;

  /* =====================================================================
   * 订单流：环形缓冲 + 整表下移 + 逐格翻牌
   * ===================================================================== */
  var ordBody = doc.getElementById('ordBody');
  var oRows = [], oHead = 0, seenIds = {}, seenN = 0;

  (function buildHeads() {
    var s = '<span style="width:3px;flex:none"></span>', i;
    for (i = 0; i < ORD_COLS.length; i++) {
      s += '<span style="width:' + ORD_COLS[i][1] + 'px;flex:none;padding:0 12px;'
        + (ORD_COLS[i][2].indexOf('r') >= 0 ? 'text-align:right' : '') + '">'
        + ORD_HEAD[i] + '</span>';
    }
    doc.getElementById('ordHead').innerHTML = s;
    s = '';
    for (i = 0; i < LOG_COLS.length; i++) {
      s += '<span style="width:' + LOG_COLS[i][1] + 'px;flex:none;padding:0 8px;'
        + (LOG_COLS[i][2].indexOf('r') >= 0 ? 'text-align:right' : '') + '">'
        + LOG_HEAD[i] + '</span>';
    }
    doc.getElementById('logHead').innerHTML = s;
  })();

  (function buildOrdRows() {
    for (var i = 0; i < ORD_ROWS; i++) {
      var el = doc.createElement('div');
      el.className = 'orow';
      var s = '<div class="mk"></div><div class="hl"></div>'
        + '<span style="width:3px;flex:none"></span>';
      for (var c = 0; c < ORD_COLS.length; c++) {
        s += '<span class="c ' + ORD_COLS[c][2] + '" style="width:' + ORD_COLS[c][1] + 'px"></span>';
      }
      el.innerHTML = s;
      ordBody.appendChild(el);
      oRows.push({ el: el, cells: el.querySelectorAll('.c'), hl: el.querySelector('.hl'),
        target: null, fl: null, t0: 0, active: false, hot: false, dur: STEP, seed: 0 });
    }
  })();

  function layoutOrd(instant) {
    var i, slot;
    if (instant) for (i = 0; i < ORD_ROWS; i++) oRows[i].el.style.transition = 'none';
    for (i = 0; i < ORD_ROWS; i++) {
      slot = (i - oHead + ORD_ROWS) % ORD_ROWS;
      oRows[i].el.style.transform = 'translate3d(0,' + (slot * ORD_H) + 'px,0)';
    }
    if (instant) {
      void oRows[0].el.offsetWidth;
      for (i = 0; i < ORD_ROWS; i++) oRows[i].el.style.transition = '';
    }
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtClock(ms) {
    var d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function fmtClockMs(ms) {
    var d = new Date(ms);
    return fmtClock(ms) + '.' + ('00' + d.getMilliseconds()).slice(-3);
  }
  function tierText(t) {
    return t === 'legendary' ? '特大' : t === 'epic' ? '大额' : t === 'rare' ? '较大' : '普通';
  }
  function ordCells(o) {
    /* 店铺 166px 去 24 内边距 = 142px，14px 西文约 8px/字 → 17 字，截到 16
     * （C-LED 第四版实测：2400 个店铺身份里只有 7.3% 超过 16 字）。
     * 商品 270px → 246px → 30 字。 */
    var store = o.store.name; if (store.length > 16) store = store.slice(0, 15) + '…';
    var prod = o.product || ''; if (prod.length > 30) prod = prod.slice(0, 29) + '…';
    return [fmtClock(o.t), store, (CC_SHORT[o.store.cc] || o.store.cc), prod,
            (PF_CN[o.platform] || o.platform),
            E.fmtMoney(o.amount, o.currency, o.locale), tierText(o.tier)];
  }

  /** 按字符类别置换（同 C 原版 clsOf 的思路）：数字换数字、字母换字母、
   *  全角换全角、空白与标点原样 —— 必须像「机械翻牌」，不能像随机噪声。 */
  function scramble(s, seed) {
    var out = '', i, ch, code;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i); code = s.charCodeAt(i);
      if (ch >= '0' && ch <= '9') out += CLS_D.charAt((E.hash32(seed + i * 31, 401) * 10) | 0);
      else if (ch >= 'A' && ch <= 'Z') out += CLS_U.charAt((E.hash32(seed + i * 31, 402) * 26) | 0);
      else if (ch >= 'a' && ch <= 'z') out += CLS_L.charAt((E.hash32(seed + i * 31, 403) * 26) | 0);
      else if (code > 0x2E80) out += CLS_CJK.charAt((E.hash32(seed + i * 31, 404) * CLS_CJK.length) | 0);
      else out += ch;
    }
    return out;
  }
  function startFlip(row, target, hot, seed) {
    row.hot = hot; row.target = target; row.fl = [];
    var stagger = hot ? STAGGER_HOT : STAGGER;
    row.dur = hot ? STEP_HOT : STEP; row.seed = seed;
    for (var c = 0; c < ORD_COLS.length; c++) {
      var tg = target[c];
      var n = (!tg || tg === '') ? 0 : (hot ? 5 : 3) + ((E.hash32(seed + c * 17, 7001) * 3) | 0);
      row.fl.push({ at: c * stagger, n: n, k: -1, done: n === 0 });
      if (n === 0) row.cells[c].textContent = tg || '';
    }
    row.t0 = clock; row.active = true;
  }
  function updateFlips() {
    for (var r = 0; r < ORD_ROWS; r++) {
      var row = oRows[r];
      if (!row.active) continue;
      var done = 0;
      for (var c = 0; c < ORD_COLS.length; c++) {
        var f = row.fl[c];
        if (f.done) { done++; continue; }
        var e = clock - row.t0 - f.at;
        if (e < 0) continue;
        var k = (e / row.dur) | 0;
        if (k >= f.n) { row.cells[c].textContent = row.target[c]; f.done = true; done++; continue; }
        if (f.k !== k) {
          f.k = k;
          row.cells[c].textContent = scramble(row.target[c], row.seed + c * 91 + k * 7);
        }
      }
      if (done === ORD_COLS.length) row.active = false;
    }
  }

  function pushOrder(o, instant) {
    if (seenIds[o.id]) return;
    seenIds[o.id] = 1; seenN++;
    if (seenN > 4000) { seenIds = {}; seenN = 0; }

    oHead = (oHead - 1 + ORD_ROWS) % ORD_ROWS;
    var row = oRows[oHead], c;
    for (c = 0; c < ORD_COLS.length; c++) row.cells[c].textContent = '';
    row.el.classList.remove('enter', 'hot', 'big');
    /* 被淘汰的那一行必须「无过渡」跳到顶部，否则会有一行从底飞到顶的鬼影 */
    if (instant) layoutOrd(true);
    else {
      row.el.style.transition = 'none';
      layoutOrd();
      void row.el.offsetWidth;
      row.el.style.transition = '';
    }

    var big = (o.tier === 'epic' || o.tier === 'legendary');
    var hot = big || o.tier === 'rare';
    if (hot) row.el.classList.add('hot');
    if (big) row.el.classList.add('big');

    var target = ordCells(o);
    if (instant) {
      row.active = false;
      for (c = 0; c < ORD_COLS.length; c++) row.cells[c].textContent = target[c];
    } else {
      startFlip(row, target, hot, (parseInt(String(o.id).replace(/\D/g, ''), 10) || 1) * 2654435761 >>> 0);
      row.el.classList.remove('enter');
      void row.el.offsetWidth;
      row.el.classList.add('enter');
      addHit(o.buyerLon, o.buyerLat, 'order');
      showGmvDelta(o);
      tallyChannel(o.platform);
      tallyMarket(o.store.cc, o.usd);
      if (big) showBanner(o);
      if (A) { try { A.playOrder(o); } catch (e) {} }
    }
  }

  /* =====================================================================
   * 抓取日志：方案 A 右半边样式 + 渐入 + 按行龄渐隐
   * ===================================================================== */
  var logBody = doc.getElementById('logBody');
  var cRows = [], cHead = 0;
  (function buildLogRows() {
    for (var i = 0; i < LOG_ROWS; i++) {
      var el = doc.createElement('div');
      el.className = 'crow';
      var s = '';
      for (var c = 0; c < LOG_COLS.length; c++) {
        /* AI 助手那格放两段：品牌名（商家认得）+ 灰色小字的程序名（真实感来源，
         * 看过自家 access log 的商家会认出 GPTBot 这种字符串）。 */
        var inner = (LOG_COLS[c][0] === 'bot')
          ? '<b class="pf"></b><s class="bt"></s>' : '';
        s += '<span class="c ' + LOG_COLS[c][2] + '" style="width:'
          + LOG_COLS[c][1] + 'px">' + inner + '</span>';
      }
      el.innerHTML = s;
      el.style.opacity = '0';
      logBody.appendChild(el);
      cRows.push({ el: el, cells: el.querySelectorAll('.c') });
    }
  })();
  function slotOpacity(slot) { return 1 - 0.62 * (slot / (LOG_ROWS - 1)); }
  function layoutLog(instant) {
    for (var i = 0; i < LOG_ROWS; i++) {
      var slot = (i - cHead + LOG_ROWS) % LOG_ROWS, el = cRows[i].el;
      if (instant) el.style.transition = 'none';
      el.style.transform = 'translate3d(0,' + (slot * LOG_H) + 'px,0)';
      el.style.opacity = String(slotOpacity(slot));
      if (instant) { void el.offsetWidth; el.style.transition = ''; }
    }
  }
  var crawlHitBudget = 0;
  function pushCrawl(c) {
    cHead = (cHead - 1 + LOG_ROWS) % LOG_ROWS;
    var row = cRows[cHead], i;
    /* 路径截断是设计意图（方案 A 屏上就是 /products/heavyweight-l…）。
     * 200px 盒去 16 内边距 = 184px，13px 等宽约 7.2px/字 → 25 字。 */
    /* 页面路径商家看得懂（那是他自己的 URL），所以给它最宽的一列并少截。
     * 276px 盒去 16 内边距 = 260px，13px 等宽约 7.2px/字 → 36 字，截到 34 留余量。 */
    var path = c.path || '';
    if (path.length > 34) path = path.slice(0, 33) + '…';
    /* 状态码翻人话：304 Not Modified 的语义就是「上次读过，内容没变」——
     * 这对商家其实是有意义的信息，不该以 304 的形式出现。 */
    var stTxt = (c.status === 304) ? '内容未变' : '已读取';
    var v = [fmtClockMs(c.t), null, path, stTxt, c.ms + 'ms', c.dcCity || ''];
    for (i = 0; i < LOG_COLS.length; i++) {
      if (v[i] === null) continue;
      row.cells[i].textContent = v[i];
    }
    var pf = row.cells[1].querySelector('.pf'), bt = row.cells[1].querySelector('.bt');
    if (pf) pf.textContent = PF_CN[c.platform] || c.platform || '';
    if (bt) bt.textContent = c.bot || '';
    row.cells[3].className = 'c ' + (c.status === 304 ? 'st304' : 'st200');
    /* 渐入：先归零再由 layoutLog 拉到满亮，走 320ms（≥320ms，不触闪烁禁令） */
    row.el.style.transition = 'none';
    row.el.style.opacity = '0';
    row.el.style.transform = 'translate3d(0,0,0)';
    void row.el.offsetWidth;
    row.el.style.transition = '';
    layoutLog();
    if (crawlHitBudget > 0) { crawlHitBudget--; addHit(c.dcLon, c.dcLat, 'crawl'); }
  }

  /* =====================================================================
   * 渠道 / 市场占比
   *   引擎没导出 referrer 与 market 的分布，所以用 peekOrders 取样 200 笔算分布，
   *   按 metrics() 折算成「开幕以来」基数，再用实时流增量。全部来自公开 API。
   * ===================================================================== */
  /* 平台显示名：品牌名原样保留（ChatGPT / Claude 商家认得），只有 Others 要换人话 */
  var PF_CN = { ChatGPT: 'ChatGPT', Claude: 'Claude', Google: 'Google',
                Perplexity: 'Perplexity', Others: '其他 AI' };
  var CHAN_HOST = { ChatGPT: 'chatgpt.com', Claude: 'claude.ai', Google: 'gemini.google.com',
                    Perplexity: 'perplexity.ai', Others: '' };
  /* 国家中文名。订单流那一列只有 70px（内容 46px），13px 中文一个字 14px，
   * 所以最长只能 3 个字 —— 澳大利亚要缩成「澳洲」，这是 FIDS 屏的做法：
   * 放不下时**缩写，不缩字号**。 */
  /* 引擎 MARKETS 的全部 18 个国家，全部 ≤3 个中文字（列宽只放得下 3 个）。
   * 澳大利亚缩成「澳洲」—— FIDS 屏的做法：放不下时缩写，不缩字号。 */
  var CC_SHORT = { US: '美国', GB: '英国', DE: '德国', FR: '法国', CA: '加拿大', AU: '澳洲',
                   JP: '日本', NL: '荷兰', IT: '意大利', ES: '西班牙', SE: '瑞典', KR: '韩国',
                   SG: '新加坡', AE: '阿联酋', BR: '巴西', MX: '墨西哥', PL: '波兰', DK: '丹麦' };
  var CC_CN = { US: '美国', GB: '英国', DE: '德国', FR: '法国', CA: '加拿大', AU: '澳大利亚',
                JP: '日本', NL: '荷兰', SE: '瑞典', MX: '墨西哥', PL: '波兰', IT: '意大利',
                IE: '爱尔兰', ES: '西班牙', BR: '巴西', KR: '韩国', SG: '新加坡', NZ: '新西兰' };
  var chanKeys = [], chanCount = {}, chanEl = {}, sampleN = 0, liveN = 0;
  var mktKeys = [], mktUsd = {}, mktEl = {}, MKT_TOP = 5;

  function initTallies() {
    var sample = [], i;
    /* referrer 分布引擎没导出（REFERRERS 是内部变量），只能靠 peekOrders 取样。
     * ⚠ 实测：peekOrders(n) **无论传多少都只返回 62 笔**（前瞻窗口上限），
     *   传 200 / 600 / 1500 / 4000 得到的都是同一批 62 笔。
     *   所以这里的占比是 62 笔的估计，方差不小（实测 Google 4.8% vs 真实权重 14%）。
     * 处理办法不是假装精确，而是**把取样量写到屏上**（同 Kalshi 的
     * 「● LIVE 77.1% of vote counted」：不只说实时，还说底层统计到几成）。 */
    try { sample = E.peekOrders(64) || []; } catch (e) { sample = []; }
    sampleN = sample.length;
    var m = E.metrics(), ordersNow = Math.floor(m.orders), gmvNow = m.gmv;

    /* 渠道 */
    var ct = {}, n = sample.length || 1;
    for (i = 0; i < sample.length; i++) { var pf = sample[i].platform || 'Others'; ct[pf] = (ct[pf] || 0) + 1; }
    chanKeys = Object.keys(ct).sort(function (a, b) { return ct[b] - ct[a]; });
    if (!chanKeys.length) chanKeys = ['ChatGPT', 'Google', 'Claude', 'Perplexity', 'Others'];
    for (i = 0; i < chanKeys.length; i++) chanCount[chanKeys[i]] = Math.round(ct[chanKeys[i]] / n * ordersNow);

    /* 市场：基数**按引擎权重算**，不取样估。
     * 金额是重尾分布，取样估会让权重 6 的加拿大掉到 1%，屏上一眼看着就不对。
     * APGeo.MARKETS 自带 weight（US 34 / GB 9 / DE 9 / FR 6 / CA 6 …），那是权威值。
     * 增量仍走真实订单，所以是活的。 */
    var mt = {}, tot = 0;
    try {
      for (i = 0; i < Geo.MARKETS.length; i++) {
        var mk0 = Geo.MARKETS[i];
        mt[mk0.cc] = mk0.weight; tot += mk0.weight;
      }
    } catch (e) { mt = {}; tot = 0; }
    if (!tot) {
      for (i = 0; i < sample.length; i++) {
        var cc0 = sample[i].store.cc; mt[cc0] = (mt[cc0] || 0) + sample[i].usd; tot += sample[i].usd;
      }
    }
    /* 顺序取 APGeo.MARKETS 的权威权重（已按 weight 降序），不用 200 笔取样排名 ——
     * 取样排名噪声太大，会让 JP/AU/BR 挤到 GB/DE 前面，也算不对「其他 N 个市场」。
     * 数值仍来自取样折算，所以是活的。 */
    var allCc = [];
    try { for (i = 0; i < Geo.MARKETS.length; i++) allCc.push(Geo.MARKETS[i].cc); } catch (e) {}
    if (!allCc.length) allCc = Object.keys(mt).sort(function (a, b) { return mt[b] - mt[a]; });
    mktKeys = allCc.slice(0, MKT_TOP);
    mktKeys.push('OTH');
    for (i = 0; i < mktKeys.length; i++) mktUsd[mktKeys[i]] = 0;
    for (i = 0; i < allCc.length; i++) {
      var cc2 = allCc[i];
      var key = (i < MKT_TOP) ? cc2 : 'OTH';
      mktUsd[key] += (mt[cc2] || 0) / (tot || 1) * gmvNow;
    }
    mktOtherN = Math.max(0, allCc.length - MKT_TOP);

    renderShells();
    updateTallies();
  }
  var mktOtherN = 0;

  function renderShells() {
    var body = doc.getElementById('chanBody'), s = '', i, k;
    for (i = 0; i < chanKeys.length; i++) {
      k = chanKeys[i];
      s += '<div class="rr"><div class="nm" style="width:176px">' + (PF_CN[k] || k)
        + ' <i>' + (CHAN_HOST[k] || '') + '</i></div>'
        + '<div class="ct" style="width:82px" data-c="' + k + '">—</div>'
        + '<div class="bar"><u data-c="' + k + '" style="width:0%"></u></div>'
        + '<div class="pc" data-c="' + k + '">—</div></div>';
    }
    s += '<div class="rr tot"><div class="nm" style="width:176px">合计</div>'
      + '<div class="ct" style="width:82px" id="chTot">—</div>'
      + '<div class="bar" style="visibility:hidden"></div>'
      + '<div class="pc">100%</div></div>';
    body.innerHTML = s;
    for (i = 0; i < chanKeys.length; i++) {
      k = chanKeys[i];
      chanEl[k] = { ct: body.querySelector('.ct[data-c="' + k + '"]'),
                    bar: body.querySelector('u[data-c="' + k + '"]'),
                    pc: body.querySelector('.pc[data-c="' + k + '"]') };
    }

    body = doc.getElementById('mktBody'); s = '';
    for (i = 0; i < mktKeys.length; i++) {
      k = mktKeys[i];
      /* 屏上别处已经没有国家代码了（订单流也改成中文名），所以这里的 US / GB
       * 变成冗余信息，只留中文名。 */
      var nm = (k === 'OTH')
        ? ('其他 ' + mktOtherN + ' 个国家')
        : (CC_CN[k] || k);
      s += '<div class="rr"><div class="nm" style="width:118px">' + nm + '</div>'
        + '<div class="ct" style="width:104px" data-m="' + k + '">—</div>'
        + '<div class="bar"><u data-m="' + k + '" style="width:0%"></u></div>'
        + '<div class="pc" data-m="' + k + '">—</div></div>';
    }
    s += '<div class="rr tot"><div class="nm" style="width:118px">合计 18 个国家</div>'
      + '<div class="ct" style="width:104px" id="mkTot">—</div>'
      + '<div class="bar" style="visibility:hidden"></div><div class="pc">100%</div></div>';
    body.innerHTML = s;
    for (i = 0; i < mktKeys.length; i++) {
      k = mktKeys[i];
      mktEl[k] = { ct: body.querySelector('.ct[data-m="' + k + '"]'),
                   bar: body.querySelector('u[data-m="' + k + '"]'),
                   pc: body.querySelector('.pc[data-m="' + k + '"]') };
    }
  }
  function tallyChannel(p) { if (chanCount[p] != null) { chanCount[p]++; liveN++; } }
  function tallyMarket(cc, usd) {
    if (mktUsd[cc] != null) mktUsd[cc] += usd;
    else if (mktUsd.OTH != null) mktUsd.OTH += usd;
  }
  function updateTallies() {
    var i, k, sum = 0, mx = 0;
    for (i = 0; i < chanKeys.length; i++) sum += chanCount[chanKeys[i]] || 0;
    for (i = 0; i < chanKeys.length; i++) mx = Math.max(mx, chanCount[chanKeys[i]] || 0);
    for (i = 0; i < chanKeys.length; i++) {
      k = chanKeys[i];
      var v = chanCount[k] || 0, el = chanEl[k];
      if (!el || !sum) continue;
      el.ct.textContent = E.fmtInt(v);
      el.pc.textContent = Math.round(v / sum * 100) + '%';
      el.bar.style.width = (mx ? v / mx * 100 : 0) + '%';
    }
    var t = doc.getElementById('chTot'); if (t && sum) t.textContent = E.fmtInt(sum);

    var msum = 0, mmx = 0;
    for (i = 0; i < mktKeys.length; i++) msum += mktUsd[mktKeys[i]] || 0;
    for (i = 0; i < mktKeys.length; i++) mmx = Math.max(mmx, mktUsd[mktKeys[i]] || 0);
    for (i = 0; i < mktKeys.length; i++) {
      k = mktKeys[i];
      var mv = mktUsd[k] || 0, mel = mktEl[k];
      if (!mel || !msum) continue;
      mel.ct.textContent = E.fmtUSD(mv).replace(/\.\d+$/, '');
      mel.pc.textContent = Math.round(mv / msum * 100) + '%';
      mel.bar.style.width = (mmx ? mv / mmx * 100 : 0) + '%';
    }
    var mt2 = doc.getElementById('mkTot');
    if (mt2 && msum) mt2.textContent = E.fmtUSD(msum).replace(/\.\d+$/, '');
  }

  /* =====================================================================
   * 横幅 / 成交额浮字
   * ===================================================================== */
  var banner = doc.getElementById('banner'), bannerTxt = doc.getElementById('bannerTxt');
  var bannerT = 0;
  function showBanner(o) {
    bannerTxt.innerHTML = o.store.name + ' 收获一笔来自 AI 助手的订单 <b>'
      + E.fmtMoney(o.amount, o.currency, o.locale) + '</b>';
    banner.classList.add('on'); bannerT = 2800;
  }
  var gmvDelta = doc.getElementById('gmvDelta');
  /* 引擎的 gmv 是按订单游标的**阶梯函数**（约一分钟跳一次），不做连续爬升 ——
   * 那等于凭空造出没发生的钱。改成把跳动本身做成事件，和订单行入场同时发生。 */
  function showGmvDelta(o) {
    gmvDelta.textContent = '+' + E.fmtUSD(o.usd);
    gmvDelta.classList.remove('on');
    void gmvDelta.offsetWidth;
    gmvDelta.classList.add('on');
  }

  /* =====================================================================
   * 左下角「扫码参与调研抽奖」入口
   *   收起态是一枚小标 → 悬停出提示 → 点击展开二维码卡。
   *   二维码由 qr.js 现场生成（零网络依赖，不能调在线接口）。
   * ===================================================================== */
  /* 换场地时只需要改这一行 —— 但通常不用改：见下面 surveyUrl() 的自动推断。 */
  var SURVEY_FALLBACK = 'http://192.168.56.67:8099/E-survey/';
  function surveyUrl() {
    var lo = root.location;
    /* 如果这块屏本身是用局域网 IP 打开的（http://192.168.x.x:8099/...），
     * 就直接沿用同一个 host —— 手机扫到的地址天然是对的，操作员不用改代码。
     * 用 localhost 或 file:// 打开时无法推断（手机连不上 localhost），退回常量。 */
    if (lo.protocol.indexOf('http') === 0 &&
        lo.hostname && lo.hostname !== 'localhost' && lo.hostname !== '127.0.0.1') {
      return lo.origin + '/E-survey/';
    }
    return SURVEY_FALLBACK;
  }

  var lotOpen = false;
  function initLottery() {
    var lot = doc.getElementById('lot'), chip = doc.getElementById('lotChip');
    var cv = doc.getElementById('lotQr'), urlEl = doc.getElementById('lotUrl');
    if (!lot || !chip || !cv) return;
    function paintQr(u, src) {
      if (urlEl) urlEl.textContent = u;
      try {
        /* 白底深码 —— 扫描器靠这个对比度定位，反过来大量机型扫不出。
         * 360px 画布配 180px 显示尺寸（2 倍），缩放时不会糊。 */
        var info = root.APQR ? root.APQR.draw(cv, u, { size: 360, quiet: 4 }) : null;
        if (info) {
          root.APDiag_qr = { url: u, version: info.version, size: info.size,
                             mask: info.mask, scale: info.scale, src: src };
        }
      } catch (e) {
        /* 同上：屏上已无地址栏，报错要走告警条。showBad 在下面定义，
         * 这里是闭包内延后调用，声明提升保证拿得到。 */
        try { showBad('二维码生成失败：' + e.message, '看一下 console，然后重启 启动预览.bat。'); } catch (e2) {}
      }
    }
    /* ── 「码是坏的」要在屏上说出来（与 E-后台 同一套逻辑）──────────────────
     * 双击 index.html（file://）打开时页面拿不到 /__lan，二维码会静默停在
     * 代码里写死的 DHCP 地址上：码能扫出内容，但打开是个连不上的页面，
     * 而屏上一切正常。file:// 下人声包也会退回系统旧音色。 */
    var lotCard = doc.getElementById('lotCard');
    var warnEl = doc.getElementById('lotWarn');
    function showBad(reason, how) {
      if (lotCard) lotCard.classList.add('bad');
      if (!warnEl) return;
      var vp = root.APVoicePack;
      warnEl.hidden = false;
      warnEl.innerHTML = '<b>⚠ 这个二维码扫不开</b> —— ' + reason + '<br>' + how
        + ((!vp || vp.mode !== 'ready') ? '<br><b>人声也退回了系统旧音色</b>（同一个原因）。' : '');
    }

    /* 先按兜底画出来，不等网络 —— 任何情况下屏上都有码。 */
    paintQr(surveyUrl(), 'fallback');
    if (root.location.protocol === 'file:') {
      showBad('这个页面是「双击 HTML 文件」打开的（<code>file://</code>），'
            + '拿不到可访问地址，码里是代码写死的兜底 IP。',
              '改用根目录的 <b>启动预览.bat</b> 打开。');
    } else {
      root.setTimeout(function () {
        var d = root.APDiag_qr;
        if (d && /^fallback/.test(d.src || '')) {
          showBad('没能从服务器取到可访问地址，码里是写死的兜底 IP。',
                  '确认 <b>_serve.js</b> 是最新版，然后重启 启动预览.bat。');
        }
      }, 6000);
    }

    /* ── 再去问真实地址，拿到就重画 ────────────────────────────────────────
     * 这一版原来**只有**上面那行写死的兜底 IP。那是个 DHCP 地址，而且是
     * RFC1918 私网地址 —— 换网络就失效，且**在 5G 上物理不可达**。
     * 现场表现就是「码扫得出来，但打开是打不开的页面」。
     * /__lan 会给出 pub（公网隧道地址，任何网络可开）和 ip（局域网地址）。
     * 优先 pub。轮询是因为快速隧道重起会换域名，展会连跑 10 小时。 */
    (function pollAddr() {
      if (!root.fetch) return;
      var last = null;
      function ask() {
        try {
          root.fetch('/__lan', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
              if (!j) return;
              var u = j.pub
                || (j.ip ? 'http://' + j.ip + ':' + (j.port || 8099) + '/E-survey/' : null);
              if (!u || u === last) return;
              last = u;
              paintQr(u, j.pub ? 'pub' : 'lan:' + j.ip);
              if (root.APDiag_qr) {
                root.APDiag_qr.reachable = j.pub ? 'anywhere' : 'same-lan-only';
              }
              /* 拿到真地址了：pub 才算完全好；退回局域网时保留提示，
               * 因为那种情况下手机换 5G 或换 WiFi 依然扫不开。 */
              /* 这张卡是**观众看的**，不是运维面板。
               * 「走局域网 / 手机要连同一个 WiFi / 内网 IP 是多少」这些是操作员
               * 该知道的事，印在观众屏上只会让人以为出了故障，还把内网地址
               * 摆在一块所有人都会拍照的屏幕上。
               * 只有码**真的用不了**（file:// 打开、编码失败）才出提示；
               * 部署模式去 console / 服务窗口 / window.APDiag_qr 看。 */
              if (lotCard) lotCard.classList.remove('bad');
              if (warnEl) { warnEl.hidden = true; warnEl.innerHTML = ''; }
              if (root.console && !j.pub) {
                root.console.log('[二维码] 当前是局域网地址 ' + (j.ip || '?')
                  + ' —— 手机需与本机同一 WiFi。要固定公网地址请设 AP_PUBLIC_URL。');
              }
            })
            .catch(function () {});
        } catch (e) {}
      }
      ask();
      root.setInterval(ask, 20000);
    })();
    function setOpen(v) {
      lotOpen = v;
      lot.classList.toggle('open', v);
      chip.setAttribute('aria-expanded', v ? 'true' : 'false');
    }
    chip.addEventListener('click', function (ev) { ev.stopPropagation(); setOpen(!lotOpen); });
    doc.addEventListener('click', function (ev) {
      if (lotOpen && !lot.contains(ev.target)) setOpen(false);
    });
    root.__lotToggle = function () { setOpen(!lotOpen); };
    root.__lotClose = function () { setOpen(false); };
  }

  /* =====================================================================
   * 主循环
   * ===================================================================== */
  var clock = 0, started = false, bKeyN = 0;
  var fpsAcc = 0, fpsN = 0, fpsAvg = 0, fpsT = 0, lastSec = -1, spkT = 0;
  var elUpd = doc.getElementById('upd'), elGmv = doc.getElementById('kGmv');
  var elRate = doc.getElementById('kRate'), elOrd = doc.getElementById('kOrd');
  var elStores = doc.getElementById('kStores'), elLogRate = doc.getElementById('logRate');

  function frame() {
    root.requestAnimationFrame(frame);
    if (!started) return;
    var vNow = E.update();
    var dtMs = E.dt();          /* 已经是毫秒（引擎里就是 _dtMs），别再乘 1000 */
    clock += dtMs;

    if (dtMs > 0) { fpsAcc += 1000 / dtMs; fpsN++; }
    fpsT += dtMs;
    if (fpsT >= 1000) { fpsAvg = Math.round(fpsAcc / Math.max(1, fpsN)); fpsAcc = 0; fpsN = 0; fpsT = 0; }
    crawlHitBudget = Math.min(6, crawlHitBudget + dtMs / 1000 * 5);

    var m = E.metrics();
    elGmv.textContent = E.fmtUSD(m.gmv).replace(/\.\d+$/, '');
    elRate.textContent = m.crawlsPerSec.toFixed(1);
    elOrd.textContent = E.fmtInt(Math.floor(m.orders));
    elStores.textContent = E.fmtInt(Math.floor(m.stores));

    var sec = Math.floor(vNow / 1000);
    if (sec !== lastSec) {
      lastSec = sec;
      elUpd.textContent = fmtClock(vNow);
      elLogRate.textContent = '每秒约 ' + Math.round(m.crawlsPerSec) + ' 个页面';
      updateTallies();
    }

    var os = E.pollOrders() || [], i;
    for (i = 0; i < os.length; i++) pushOrder(os[i], false);
    var cs = E.pollCrawls(9) || [];
    for (i = 0; i < cs.length; i++) pushCrawl(cs[i]);
    var ms = E.pollMilestones() || [];
    if (ms.length) {
      if (A) { try { A.playMilestone(); } catch (e) {} }
      bannerTxt.innerHTML = '已有 <b>' + E.fmtInt(ms[0].value || 0) + '</b> 个商品页可被 AI 读懂';
      banner.classList.add('on'); bannerT = 3200;
    }

    /* sparkline 按 3 秒采样：28 点 x 3s = 84 秒窗口。窗口太短（14 秒）时真实波动
     * 只有百分之几，画出来是一条空灰条 —— 对商家就是无效信息。 */
    spkT += dtMs;
    if (spkT >= 3000) {
      spkT = 0;
      sk1.push(m.crawlsPerSec); sk1.draw();
      sk2.push(m.ordersPerMin); sk2.draw();
      sk3.push(m.stores); sk3.draw();
    }

    updateFlips();
    drawMap(dtMs);
    if (bannerT > 0) { bannerT -= dtMs; if (bannerT <= 0) banner.classList.remove('on'); }

  }

  /* =====================================================================
   * 启动 / 快捷键
   * ===================================================================== */
  function sizeMap() {
    var pb = mapCv.parentNode;
    mapCv.width = Math.max(100, pb.clientWidth);
    mapCv.height = Math.max(100, pb.clientHeight);
    mapCtx = mapCv.getContext('2d');
    mapGeom(); bakeMap();
  }
  function start() {
    if (started) return;
    started = true;
    doc.getElementById('gate').classList.add('off');
    if (A) { try { A.unlock(); } catch (e) {} }
  }

  function boot() {
    E.init();
    sizeMap();
    sk1 = makeSpark('sk1', 132, 38);
    sk2 = makeSpark('sk2', 132, 38);
    sk3 = makeSpark('sk3', 132, 38);

    /* 恢复上次选的主题 */
    var saved = null;
    try { saved = root.localStorage.getItem('apE_theme'); } catch (e) {}
    var si = 0;
    if (saved) for (var i = 0; i < THEMES.length; i++) if (THEMES[i].key === saved) si = i;
    applyTheme(si, true);

    /* 预铺：取**远期**的 N 笔（第 58 笔之后，约 55 分钟才到）+ id 去重兜底。
     * 只去重却取最近 N 笔的话，那 N 笔真实到达时全被挡掉，屏上会「冻住」好几分钟。 */
    var pre = [];
    /* peekOrders 有 62 笔的硬上限（实测，传更大的数没用）。所以不能写死偏移量，
     * 必须按**实际返回长度**取尾部 —— 取尾部才是「远期」的那几笔，
     * 取头部会被 id 去重挡掉，屏上订单流会冻住好几分钟。 */
    try {
      var deep = E.peekOrders(ORD_ROWS + 58) || [];
      pre = deep.slice(Math.max(0, deep.length - ORD_ROWS));
      if (deep.length < ORD_ROWS * 2) pre = deep.slice(0, ORD_ROWS);   /* 极端情况下的退路 */
    } catch (e) { pre = []; }
    /* 时间戳两个方向都要对：间隔**累加**（不能写 i*间隔，带抖动后相邻行会穿插）；
     * 且 pushOrder 是顶部插入，所以**最后**推的必须是**最近**的一笔。 */
    var t0 = E.now(), accs = [], acc = 0, k;
    for (i = 0; i < pre.length; i++) {
      acc += 42000 + Math.round(E.hash32(i + 5, 913) * 34000);
      accs.push(acc);
    }
    for (i = pre.length - 1; i >= 0; i--) {
      var o = pre[i], clone = {};
      for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) clone[k] = o[k];
      clone.t = t0 - accs[i];
      pushOrder(clone, true);
    }
    layoutOrd(true);
    layoutLog(true);
    initTallies();

    initLottery();
    doc.getElementById('goBtn').addEventListener('click', start);
    doc.getElementById('gate').addEventListener('click', start);
    var tc = doc.getElementById('themeCtl');   /* 展会屏上已移除，可能为 null */
    if (tc) {
      tc.addEventListener('click', function (ev) { ev.stopPropagation(); cycleTheme(); });
      tc.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); cycleTheme(); }
      });
    }
    root.requestAnimationFrame(frame);
  }

  doc.addEventListener('keydown', function (ev) {
    var k = ev.key;
    if (k === ' ') { ev.preventDefault(); E.togglePause(); }
    else if (k === 't' || k === 'T') cycleTheme();
    /* triggerOrder 收的是 {usd} 对象。传位置参数会退回引擎的 forceBig ——
     * 那条路中位数只有约 $310 而 epic 门槛正好 $300，于是「B 键一半时间不出大单」。 */
    else if (k === 'b' || k === 'B') {
      E.triggerOrder({ usd: E.demoAmount('legendary', bKeyN++) });
    }
    else if (k === 'n' || k === 'N') { E.triggerOrder({ usd: E.demoAmount('common', bKeyN++) }); }
    else if (k === 'k' || k === 'K') {
      if (A) { try { A.playMilestone(); } catch (e) {} }
      bannerTxt.innerHTML = '已有 <b>'
        + E.fmtInt(Math.ceil(E.metrics().pages / 1000) * 1000) + '</b> 个商品页可被 AI 读懂';
      banner.classList.add('on'); bannerT = 3200;
    }
    else if (k === 'm' || k === 'M') { if (A) A.toggleMute(); }
    else if (k === 'a' || k === 'A') { if (A) { A._amb = !A._amb; A.setAmbient(A._amb); } }
    else if (k === 'h' || k === 'H') { if (A) { A._hall = !A._hall; A.setHallMode(A._hall); } }
    else if (k === '1') E.setSpeed(0.5);
    else if (k === '2') E.setSpeed(1);
    else if (k === '3') E.setSpeed(3);
    else if (k === 'f' || k === 'F') {
      if (doc.fullscreenElement) doc.exitFullscreen(); else doc.documentElement.requestFullscreen();
    }
    else if (k === 'r' || k === 'R') root.location.reload();
    else if (k === 'q' || k === 'Q') { if (root.__lotToggle) root.__lotToggle(); }
    else if (k === 'Escape') { if (root.__lotClose) root.__lotClose(); }
    else if (k === '?' || k === '/') doc.getElementById('legend').classList.toggle('on');
  });

  /* 自检口。topOrder/topLog 是必须的：两个流都是环形缓冲，
   * 「最新一行」在 DOM 里的位置是转的，外部靠 querySelector 取第一个会取错。 */
  root.APDiag = {
    get fpsAvg() { return fpsAvg; },
    get dom() { return doc.getElementsByTagName('*').length; },
    get hits() { return hits.length; },
    get seen() { return seenN; },
    get theme() { return THEMES[themeIdx].key + ' / ' + THEMES[themeIdx].name; },
    get themeCount() { return THEMES.length; },
    setTheme: function (i) { applyTheme(i, true); },
    get topOrder() {
      var r = oRows[oHead], out = [], i;
      for (i = 0; i < r.cells.length; i++) out.push(r.cells[i].textContent);
      return out.join('|');
    },
    get topLog() {
      var r = cRows[cHead], out = [], i;
      for (i = 0; i < r.cells.length; i++) out.push(r.cells[i].textContent);
      return out.join('|');
    },
    metrics: function () { return E.metrics(); }
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window);
