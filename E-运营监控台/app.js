/* ===========================================================================
 * AP 展会大屏 · 方案 E「运营监控台」动态版
 * ---------------------------------------------------------------------------
 * 这一版是「中间态」路线的第一个可跑原型，与 A/B/C/D 平级，不替代任何一个。
 *
 * ── 它从哪几处借了什么 ────────────────────────────────────────────────
 *   底色 / 面板 / 描边   02 线对 Grafana 的 getComputedStyle 实测值
 *                        （#111217 / #181b1f / #2e3036；面板比底亮、纯黑只当缝）
 *   全局主题色           方案 A 的两个强调色：青绿 #00D3A7（爬虫层，冷强调）
 *                        + 暖金 #FFB86B（订单层，暖强调，稀有出现）
 *   抓取日志的样式       方案 A 右半边（EDGE ACCESS LOG）：9 列、等宽、密到贴边、
 *                        字段名带 ASN/LAT、状态码混着 304、IP 脱敏成 x.x
 *                        另加「渐入 + 按行龄渐隐 + 底部蒙版」
 *   订单流的入场动画     **方案 C 原版**：环形缓冲 + 整表 translate3d 下移
 *                        260ms cubic-bezier(.22,1,.36,1)，新行逐格 split-flap
 *                        揭示（每格 stagger，字符按类别翻 3~5 次）
 *   订单流的强调样式     **C-LED 中文版**：3px 左标记条 + 整行高亮 + 大额转红
 *                        —— 但不做点阵、不做发光、不做霓虹
 *   焦点公式             01 线对 Shopify Live View 的像素实测：主角不靠字号
 *                        （27px vs 26px），靠字重 1.7 倍 + 标签在上 + 归组降权
 *
 * ── 一处对规格的有意偏离 ──────────────────────────────────────────────
 *   §4.3 要求「一个绝对主角」，本版按需求放了**两个**同样大的指标
 *   （累计成交额=暖金 / 累计爬取次数=青绿）。两者用不同色相 + 不同语义分工，
 *   靠颜色而非尺寸区分。代价是严格意义上没有单一焦点，这一条是明确的取舍。
 *
 * ── 一处对第四版的修正 ────────────────────────────────────────────────
 *   C-LED 第四版的新行高亮是 480ms 线性、没有保持段，一闪即没像故障。
 *   03 线实测交易台通用表格库 ag-grid 的记录值是「保持 500ms + 淡出 1000ms」，
 *   本版按业界值重定：500ms 满亮保持 + 900ms 淡出 → 静息 3%（见 index.html 的
 *   @keyframes hlfade）。
 *
 * classic script。零网络依赖。随机一律 APEngine.hash32，步长一律 APEngine.dt()。
 * =========================================================================== */
(function (root) {
  'use strict';

  var doc = root.document;
  var E = root.APEngine, A = root.APAudio, Geo = root.APGeo;
  var W = 1920, H = 1080;

  /* ─── 版面常量（都是算出来的，不是估的）─────────────────────────────
   * 订单列宽合计 972 ≤ 面板内宽（52% × 1904 - 2 ≈ 988）
   * 日志列宽合计 906 ≤ 面板内宽（48% × 1904 - 2 ≈ 912）
   * 订单区可用高 424 - 34(标题条) - 38(表头) - 2 = 350 → 49px × 7 行 = 343 ✓
   * 日志区可用高 424 - 34 - 30 - 2 = 358 → 28px × 12 行 = 336 ✓
   *   （页脚移除后腾出的 44px 全给了下段，两个流各多一行） */
  var ORD_ROWS = 7, ORD_H = 49;
  var LOG_ROWS = 12, LOG_H = 28;

  /* 订单列：[键, 宽, 附加 class] */
  var ORD_COLS = [
    ['t',    96, 'm dim'],
    ['store', 186, ''],
    ['cc',    56, 'm dim'],
    ['prod', 300, 'dim'],
    ['src',  104, 'm dim'],
    ['amt',  140, 'r amt'],
    ['tier',  90, '']
  ];
  var ORD_HEAD = ['时间', '店铺', '市场', '商品', '来源', '金额', '稀有度'];

  var LOG_COLS = [
    /* 时间列必须给到 104：19:39:49.065 是 12 字符，13px 等宽约 102px + 16 内边距，
     * 96 会被省略号截掉毫秒 —— 而毫秒时间戳正是「机器写的、精度过剩」这条真实感装置本身。 */
    ['t',   104, ''],
    ['bot', 126, 'bot'],
    ['ip',   92, ''],
    ['asn', 112, ''],
    ['path', 208, ''],
    ['st',   48, ''],
    ['size', 66, 'r'],
    ['ms',   62, 'r'],
    ['dc',   88, '']
  ];
  var LOG_HEAD = ['时间', '爬虫', '来源 IP', 'ASN', '路径', '状态', '大小', '时延', '节点'];

  /* C 原版的翻牌参数（原文：STAGGER 21 / STAGGER_HOT 26 / STEP 46 / STEP_HOT 54）。
   * 原版是逐「字符」翻，本版逐「格」翻（格内字符同时置换）——同样是从左到右的
   * 波浪，但 DOM 只需 7 个格而不是 60 个字符位，10 小时长跑更稳。 */
  var STAGGER = 21, STAGGER_HOT = 26, STEP = 46, STEP_HOT = 54;
  var CLS_D = '0123456789';
  var CLS_U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var CLS_L = 'abcdefghijklmnopqrstuvwxyz';
  var CLS_CJK = '普通较大特成交订单店铺市场来源金额稀有引荐';

  /* =====================================================================
   * 一、舞台缩放
   * ===================================================================== */
  var stage = doc.getElementById('stage');
  function fit() {
    var s = Math.min(root.innerWidth / W, root.innerHeight / H);
    stage.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
  }
  root.addEventListener('resize', fit);
  fit();

  /* =====================================================================
   * 二、点阵世界地图
   *   陆块掩码与 C-LED 第四版逐字节相同（64 列 x 26 行等距圆柱投影）。
   *   静态层（陆块 + 市场点）只烤一次，每帧 drawImage 一次 + 画活动打点。
   * ===================================================================== */
  var MAP_COLS = 64, MAP_ROWS = 26, MAP_LON0 = -180, MAP_DLON = 360 / MAP_COLS;
  var MAP_LAT0 = 78, MAP_DLAT = 5;
  var LAND = [
    [[11, 18], [22, 27]],
    [[4, 19], [22, 27], [35, 63]],
    [[2, 21], [23, 28], [33, 63]],
    [[2, 21], [23, 24], [32, 63]],
    [[1, 4], [8, 21], [30, 31], [33, 63]],
    [[9, 21], [30, 57]],
    [[10, 20], [31, 57]],
    [[10, 20], [30, 57]],
    [[11, 19], [30, 33], [36, 56]],
    [[11, 18], [29, 55]],
    [[12, 14], [17, 17], [28, 42], [44, 53]],
    [[12, 14], [28, 41], [44, 51], [53, 53]],
    [[13, 15], [28, 39], [45, 46], [49, 51], [53, 54]],
    [[16, 20], [29, 40], [45, 45], [49, 51], [53, 54]],
    [[17, 22], [30, 40], [46, 46], [50, 50], [53, 54]],
    [[17, 24], [33, 39], [50, 54]],
    [[17, 25], [33, 39], [50, 53], [55, 58]],
    [[18, 25], [33, 39], [51, 52], [54, 58]],
    [[18, 25], [33, 40], [54, 57]],
    [[19, 25], [34, 38], [40, 40], [52, 58]],
    [[19, 24], [34, 37], [39, 39], [51, 59]],
    [[19, 23], [35, 37], [52, 59]],
    [[19, 22], [35, 36], [52, 58]],
    [[19, 21], [57, 58], [62, 62]],
    [[19, 20], [57, 57], [61, 62]],
    [[19, 20], [61, 61]]
  ];

  var mapCv = doc.getElementById('map'), mapCtx = null, mapBase = null;
  var MW = 0, MH = 0, MPX = 0, MPY = 0, MX0 = 0, MY0 = 0, MDOT = 0;

  function mapGeom() {
    /* 横纵点距各自铺满：正方点距下 64 列只占面板宽的 ~58%，两侧留大片空，
     * 陆块读不出形状。灯珠画成圆角矩形，仍是点阵观感。 */
    MW = mapCv.width; MH = mapCv.height;
    MPX = MW / MAP_COLS; MPY = MH / MAP_ROWS;
    MX0 = 0; MY0 = 0;
    MDOT = 0.84;
  }
  function cellRect(g, cx, cy, k) {
    var w = MPX * MDOT * k, h = MPY * MDOT * k;
    var r = Math.min(w, h) * 0.34;
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
  function cellCenter(c, r) { return [MX0 + (c + 0.5) * MPX, MY0 + (r + 0.5) * MPY]; }

  function bakeMap() {
    var c = doc.createElement('canvas');
    c.width = MW; c.height = MH;
    var g = c.getContext('2d');
    /* 陆块：比面板底亮两档，但明显暗于任何强调色 —— 它是氛围区，不承担读数 */
    g.fillStyle = '#333B45';
    for (var r = 0; r < LAND.length && r < MAP_ROWS; r++) {
      for (var k = 0; k < LAND[r].length; k++) {
        var seg = LAND[r][k];
        for (var x = seg[0]; x <= seg[1] && x < MAP_COLS; x++) {
          var p = cellCenter(x, r);
          cellRect(g, p[0], p[1], 1);
        }
      }
    }
    /* 市场点：数据驱动，取每个市场权重最高的城市当代表点 */
    var pts = marketPoints();
    for (var i = 0; i < pts.length; i++) {
      var pc = lonlatToCell(pts[i][0], pts[i][1]);
      var q = cellCenter(pc[0], pc[1]);
      g.fillStyle = (i < 5) ? '#7C9AAA' : '#5A7684';
      cellRect(g, q[0], q[1], i < 5 ? 1.15 : 1.0);
    }
    mapBase = c;
  }

  /** 市场代表点：每个市场取该国权重最高的城市。数据驱动，不硬编码经纬度。
   *  APGeo 的真实结构（cities.js 实测）：
   *    MARKETS = [{cc, locale, currency, weight, lang}]  按 weight 降序
   *    CITIES  = [名称, 纬度, 经度, 国家码, 权重]        —— 数组的数组，不是对象
   *  返回 [lon, lat] 数组，前 5 个是权重最高的 5 个市场（会亮一档）。 */
  function marketPoints() {
    var out = [], i;
    try {
      var mk = Geo && Geo.MARKETS, byCc = Geo && Geo.citiesByCC;
      if (mk && mk.length && byCc) {
        for (i = 0; i < mk.length; i++) {
          var pool = byCc[mk[i].cc];
          if (!pool || !pool.length) continue;
          var best = pool[0];
          for (var j = 1; j < pool.length; j++) if (pool[j][4] > best[4]) best = pool[j];
          out.push([best[2], best[1]]);           /* [经度, 纬度] */
        }
      }
    } catch (e) { out = []; }
    /* 兜底：接口变动或数据缺失时仍能画出可辨的分布 */
    if (out.length < 6) {
      out = [[-74, 40.7], [-0.1, 51.5], [13.4, 52.5], [2.35, 48.9], [-79.4, 43.7],
             [151.2, -33.9], [139.7, 35.7], [-46.6, -23.5], [4.9, 52.4], [18.1, 59.3],
             [-99.1, 19.4], [21, 52.2], [12.5, 41.9], [-6.3, 53.3], [-118, 34],
             [-122.3, 47.6], [174.8, -41.3], [103.8, 1.35]];
    }
    return out;
  }

  /* 活动打点：一次性衰减的事件入场，不是循环闪烁（规格 §4.4 的允许清单） */
  var hits = [];                          /* {x,y,age,dur,kind} kind: 'order' | 'crawl' */
  var HIT_CAP = 90;
  function addHit(lon, lat, kind) {
    if (lon == null || lat == null) return;
    var pc = lonlatToCell(lon, lat), p = cellCenter(pc[0], pc[1]);
    hits.push({ x: p[0], y: p[1], age: 0, dur: kind === 'order' ? 900 : 520, kind: kind });
    if (hits.length > HIT_CAP) hits.splice(0, hits.length - HIT_CAP);
  }

  function drawMap(dtMs) {
    if (!mapCtx) return;
    var g = mapCtx;
    g.clearRect(0, 0, MW, MH);
    if (mapBase) g.drawImage(mapBase, 0, 0);
    for (var i = hits.length - 1; i >= 0; i--) {
      var ht = hits[i];
      ht.age += dtMs;
      var u = ht.age / ht.dur;
      if (u >= 1) { hits.splice(i, 1); continue; }
      var col = (ht.kind === 'order') ? '#FFB86B' : '#00D3A7';
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
   * 三、订单流：环形缓冲 + 整表下移 + 逐格 split-flap（C 原版的入场）
   * ===================================================================== */
  var ordBody = doc.getElementById('ordBody');
  var oRows = [], oHead = 0, seenIds = {}, seenN = 0;

  (function buildOrdHead() {
    var hd = doc.getElementById('ordHead'), i, s = '';
    s += '<span style="width:3px;flex:none"></span>';
    for (i = 0; i < ORD_COLS.length; i++) {
      var cls = ORD_COLS[i][2].indexOf('r') >= 0 ? 'style="text-align:right"' : '';
      s += '<span ' + cls + ' style="width:' + ORD_COLS[i][1] + 'px;flex:none;padding:0 12px;'
        + (ORD_COLS[i][2].indexOf('r') >= 0 ? 'text-align:right' : '') + '">'
        + ORD_HEAD[i] + '</span>';
    }
    hd.innerHTML = s;
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
      oRows.push({
        el: el,
        cells: el.querySelectorAll('.c'),
        hl: el.querySelector('.hl'),
        target: null, fl: null, t0: 0, active: false, hot: false, dur: STEP, seed: 0
      });
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
      void oRows[0].el.offsetWidth;           /* 强制提交，避免被动画化 */
      for (i = 0; i < ORD_ROWS; i++) oRows[i].el.style.transition = '';
    }
  }

  function fmtClock(ms) {
    var d = new Date(ms), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function tierText(t) {
    return t === 'legendary' ? '特大' : t === 'epic' ? '大额' : t === 'rare' ? '较大' : '普通';
  }
  function ordCells(o) {
    var store = o.store.name;
    if (store.length > 14) store = store.slice(0, 13) + '…';
    var prod = o.product || '';
    if (prod.length > 22) prod = prod.slice(0, 21) + '…';
    return [fmtClock(o.t), store, o.store.cc, prod, o.platform,
            E.fmtMoney(o.amount, o.currency, o.locale), tierText(o.tier)];
  }

  /** 按字符类别置换：数字换数字、字母换字母、全角换全角、空白与标点原样。
   *  这是 C 原版 clsOf() 的同一思路 —— 中间态必须像「机械翻牌」，不能像随机噪声。 */
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
    row.hot = hot;
    row.target = target;
    row.fl = [];
    var stagger = hot ? STAGGER_HOT : STAGGER;
    row.dur = hot ? STEP_HOT : STEP;
    row.seed = seed;
    for (var c = 0; c < ORD_COLS.length; c++) {
      var tg = target[c];
      var n = (!tg || tg === '') ? 0
        : (hot ? 5 : 3) + ((E.hash32(seed + c * 17, 7001) * 3) | 0);
      row.fl.push({ at: c * stagger, n: n, k: -1, done: n === 0 });
      if (n === 0) row.cells[c].textContent = tg || '';
    }
    row.t0 = clock;
    row.active = true;
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
        if (k >= f.n) {
          row.cells[c].textContent = row.target[c];
          f.done = true; done++;
          continue;
        }
        if (f.k !== k) {
          f.k = k;
          row.cells[c].textContent = scramble(row.target[c], row.seed + c * 91 + k * 7);
        }
      }
      if (done === ORD_COLS.length) row.active = false;
    }
  }

  function pushOrder(o, instant) {
    if (seenIds[o.id]) return;              /* 兜一层去重：防「一笔单处理两遍」 */
    seenIds[o.id] = 1; seenN++;
    if (seenN > 4000) { seenIds = {}; seenN = 0; }   /* 防长跑内存无界增长 */

    oHead = (oHead - 1 + ORD_ROWS) % ORD_ROWS;
    var row = oRows[oHead];

    /* 被淘汰的那一行要「无过渡」跳到顶部，否则会出现一行从底飞到顶的鬼影 */
    for (var c = 0; c < ORD_COLS.length; c++) row.cells[c].textContent = '';
    row.el.classList.remove('enter', 'hot', 'big');
    if (instant) {
      layoutOrd(true);
    } else {
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
      for (var i = 0; i < ORD_COLS.length; i++) row.cells[i].textContent = target[i];
    } else {
      startFlip(row, target, hot, (o.id * 2654435761) >>> 0);
      /* 重启高亮动画：先摘类、强制回流、再挂上 */
      row.el.classList.remove('enter');
      void row.el.offsetWidth;
      row.el.classList.add('enter');
      addHit(o.buyerLon, o.buyerLat, 'order');
      /* 累计成交额是**离散**的：引擎的 gmv/orders 是按订单游标的阶梯函数，
       * 一分钟左右才跳一次（1.06 单/分）。所以不给它做连续爬升 —— 那等于凭空
       * 造出没发生的钱。改成把「跳动」本身做成事件：一笔单进来时在数字右侧
       * 浮一个 +金额，和订单行入场同时发生，读起来就是「这一行让那个数字跳了」。
       * 这也正是 BFCM「Every particle is a real order」的同一条思路。 */
      showGmvDelta(o);
      if (big) showBanner(o);
      tallyChannel(o.platform);
      if (A) { try { A.playOrder(o); } catch (e) {} }
    }
  }

  /* =====================================================================
   * 四、抓取日志：方案 A 右半边的样式 + 渐入 + 按行龄渐隐
   * ===================================================================== */
  var logBody = doc.getElementById('logBody');
  var cRows = [], cHead = 0;

  (function buildLogHead() {
    var hd = doc.getElementById('logHead'), s = '';
    for (var i = 0; i < LOG_COLS.length; i++) {
      s += '<span style="width:' + LOG_COLS[i][1] + 'px;flex:none;padding:0 8px;'
        + (LOG_COLS[i][2].indexOf('r') >= 0 ? 'text-align:right' : '') + '">'
        + LOG_HEAD[i] + '</span>';
    }
    hd.innerHTML = s;
  })();

  (function buildLogRows() {
    for (var i = 0; i < LOG_ROWS; i++) {
      var el = doc.createElement('div');
      el.className = 'crow';
      var s = '';
      for (var c = 0; c < LOG_COLS.length; c++) {
        s += '<span class="c ' + LOG_COLS[c][2] + '" style="width:' + LOG_COLS[c][1] + 'px"></span>';
      }
      el.innerHTML = s;
      el.style.opacity = '0';
      logBody.appendChild(el);
      cRows.push({ el: el, cells: el.querySelectorAll('.c'), st: null });
    }
  })();

  /* 按行龄渐隐：最新一行满亮，越旧越暗。与底部蒙版叠加，最旧几行溶进底色。
   * 方案 A 的日志是均匀暗的；这里加一条亮度梯度，把「哪条是刚来的」也交代出来。 */
  function slotOpacity(slot) {
    var u = slot / (LOG_ROWS - 1);
    return 1 - 0.62 * u;
  }
  function layoutLog(instant) {
    for (var i = 0; i < LOG_ROWS; i++) {
      var slot = (i - cHead + LOG_ROWS) % LOG_ROWS;
      var el = cRows[i].el;
      if (instant) el.style.transition = 'none';
      el.style.transform = 'translate3d(0,' + (slot * LOG_H) + 'px,0)';
      el.style.opacity = String(slotOpacity(slot));
      if (instant) { void el.offsetWidth; el.style.transition = ''; }
    }
  }

  function fmtClockMs(ms) {
    var d = new Date(ms), p = function (n, w) { return ('000' + n).slice(-(w || 2)); };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
      + '.' + p(d.getMilliseconds(), 3);
  }
  function fmtKb(b) { return (Math.round(b / 102.4) / 10).toFixed(1) + 'kB'; }

  function pushCrawl(c) {
    cHead = (cHead - 1 + LOG_ROWS) % LOG_ROWS;
    var row = cRows[cHead];
    /* 路径截断是设计意图（方案 A 屏上就是 /products/heavyweight-l…）。
     * 208px 盒去掉 16 内边距 = 192px，13px 等宽约 7.2px/字 → 26 字。
     * 截到 26 字 CSS 就不必再截一次，省掉「截了两遍」的歧义。 */
    var path = c.path || '';
    if (path.length > 26) path = path.slice(0, 25) + '…';
    var v = [fmtClockMs(c.t), c.bot, c.ip, c.asn, path, String(c.status),
             fmtKb(c.bytes), c.ms + 'ms', c.dcCity || ''];
    for (var i = 0; i < LOG_COLS.length; i++) row.cells[i].textContent = v[i];
    /* 状态码：混着的 304 要看得出来 —— 全是 200 才假 */
    var stCell = row.cells[5];
    stCell.className = 'c ' + (c.status === 304 ? 'st304' : 'st200');
    /* 渐入：新行先归零再由 layoutLog 拉到满亮，走 320ms 过渡（≥320ms，不触闪烁禁令） */
    row.el.style.transition = 'none';
    row.el.style.opacity = '0';
    row.el.style.transform = 'translate3d(0,0,0)';
    void row.el.offsetWidth;
    row.el.style.transition = '';
    layoutLog();
    addHitCrawl(c);
  }

  /* 爬虫打点限流：爬虫 42/秒，全打会把地图糊成一片青 */
  var crawlHitBudget = 0;
  function addHitCrawl(c) {
    if (crawlHitBudget <= 0) return;
    crawlHitBudget--;
    addHit(c.dcLon, c.dcLat, 'crawl');
  }

  /* =====================================================================
   * 五、渠道占比（口径＝订单来源，不是爬虫平台）
   *   引擎没有导出 referrer 分布，所以用 peekOrders 取样 200 笔算出分布，
   *   按 metrics().orders 折算成「开幕以来」的基数，再用实时流增量。
   *   —— 全部来自公开 API，没有硬编码占比。
   * ===================================================================== */
  var chanKeys = [], chanCount = {}, chanEls = {}, chanTotal = 0;
  function initChannels() {
    var sample = [], i;
    try { sample = E.peekOrders(200) || []; } catch (e) { sample = []; }
    var tally = {};
    for (i = 0; i < sample.length; i++) {
      var p = sample[i].platform || '其他';
      tally[p] = (tally[p] || 0) + 1;
    }
    chanKeys = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; });
    if (!chanKeys.length) chanKeys = ['ChatGPT', 'Google', 'Claude', 'Perplexity', 'Others'];
    var ordersNow = Math.floor(E.metrics().orders);
    var n = sample.length || 1;
    for (i = 0; i < chanKeys.length; i++) {
      chanCount[chanKeys[i]] = Math.round((tally[chanKeys[i]] || 0) / n * ordersNow);
    }
    renderChannelShell();
    updateChannels();
  }
  var CHAN_CN = { ChatGPT: 'chatgpt.com', Claude: 'claude.ai', Google: 'gemini.google.com',
                  Perplexity: 'perplexity.ai', Others: '其他 AI 助手', 其他: '其他 AI 助手' };
  function renderChannelShell() {
    var body = doc.getElementById('chanBody'), s = '', i;
    for (i = 0; i < chanKeys.length; i++) {
      var k = chanKeys[i];
      s += '<div class="rr"><div class="nm">' + k + ' <i>' + (CHAN_CN[k] || '') + '</i></div>'
        + '<div class="ct" data-k="' + k + '">—</div>'
        + '<div class="bar"><u data-k="' + k + '" style="width:0%"></u></div>'
        + '<div class="pc" data-k="' + k + '">—</div></div>';
    }
    s += '<div class="rr tot"><div class="nm">合计</div>'
      + '<div class="ct" id="chTotal">—</div>'
      + '<div class="bar" style="visibility:hidden"></div>'
      + '<div class="pc">100%</div></div>';
    body.innerHTML = s;
    for (i = 0; i < chanKeys.length; i++) {
      var kk = chanKeys[i];
      chanEls[kk] = {
        ct: body.querySelector('.ct[data-k="' + kk + '"]'),
        bar: body.querySelector('u[data-k="' + kk + '"]'),
        pc: body.querySelector('.pc[data-k="' + kk + '"]')
      };
    }
  }
  function tallyChannel(p) {
    if (chanCount[p] == null) return;
    chanCount[p]++; chanTotal++;
  }
  function updateChannels() {
    var sum = 0, i, k;
    for (i = 0; i < chanKeys.length; i++) sum += chanCount[chanKeys[i]] || 0;
    if (!sum) return;
    var mx = 0;
    for (i = 0; i < chanKeys.length; i++) mx = Math.max(mx, chanCount[chanKeys[i]] || 0);
    for (i = 0; i < chanKeys.length; i++) {
      k = chanKeys[i];
      var v = chanCount[k] || 0, el = chanEls[k];
      if (!el) continue;
      el.ct.textContent = E.fmtInt(v);
      el.pc.textContent = Math.round(v / sum * 100) + '%';
      el.bar.style.width = (mx ? (v / mx * 100) : 0) + '%';
    }
    var tt = doc.getElementById('chTotal');
    if (tt) tt.textContent = E.fmtInt(sum);
  }

  /* =====================================================================
   * 六、大额横幅（一次性入场，不循环）
   * ===================================================================== */
  var banner = doc.getElementById('banner'), bannerTxt = doc.getElementById('bannerTxt');
  var bannerT = 0;

  /* 成交额跳动浮字：一次性入场衰减，不循环 */
  var gmvDelta = doc.getElementById('kGmvDelta');
  function showGmvDelta(o) {
    if (!gmvDelta) return;
    gmvDelta.textContent = '+' + E.fmtUSD(o.usd);
    gmvDelta.classList.remove('on');
    void gmvDelta.offsetWidth;
    gmvDelta.classList.add('on');
  }
  function showBanner(o) {
    bannerTxt.innerHTML = o.store.name + ' 收获一笔来自 AI 助手的订单 <b>'
      + E.fmtMoney(o.amount, o.currency, o.locale) + '</b>';
    banner.classList.add('on');
    bannerT = 2800;
  }

  /* =====================================================================
   * 七、迷你时序（配角格的 sparkline，纯 canvas，低频重绘）
   * ===================================================================== */
  var spkCv = doc.createElement('canvas');
  spkCv.width = 150; spkCv.height = 40;
  spkCv.style.width = '150px'; spkCv.style.height = '40px';
  doc.getElementById('kSpk').appendChild(spkCv);
  var spkHist = [];
  function drawSpark() {
    var g = spkCv.getContext('2d'), w = 150, h = 40, i;
    g.clearRect(0, 0, w, h);
    if (spkHist.length < 2) return;
    var mn = Infinity, mx = -Infinity, sum = 0;
    for (i = 0; i < spkHist.length; i++) {
      mn = Math.min(mn, spkHist[i]); mx = Math.max(mx, spkHist[i]); sum += spkHist[i];
    }
    /* 纯 min-max 归一化会把极小波动放大成陡坡（第一轮实测：几乎恒定的速率
     * 画出一条戏剧性的下滑线）。给量程加一个「不小于均值 25%」的地板，
     * 波动小的时候就该画得平。 */
    var mean = sum / spkHist.length;
    var floor = Math.abs(mean) * 0.25;
    var span = Math.max(mx - mn, floor) || 1;
    var mid = (mx + mn) / 2;
    mn = mid - span / 2;
    g.beginPath();
    for (i = 0; i < spkHist.length; i++) {
      var x = i / (spkHist.length - 1) * w;
      var y = h - 2 - ((spkHist[i] - mn) / span) * (h - 5);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokeStyle = '#5A6B78'; g.lineWidth = 1.5; g.lineJoin = 'round'; g.stroke();
    g.lineTo(w, h); g.lineTo(0, h); g.closePath();
    g.fillStyle = 'rgba(90,107,120,.16)'; g.fill();
  }

  /* =====================================================================
   * 八、主循环
   * ===================================================================== */
  var clock = 0, started = false, bKeyN = 0;
  var fpsAcc = 0, fpsN = 0, fpsAvg = 0, fpsT = 0;
  var updEl = doc.getElementById('upd');
  var kGmv = doc.getElementById('kGmv'), kCrawl = doc.getElementById('kCrawl');
  var kOrd = doc.getElementById('kOrd');
  var kGmvSub = doc.getElementById('kGmvSub'), kCrawlSub = doc.getElementById('kCrawlSub');
  var kOrdSub = doc.getElementById('kOrdSub'), logRate = doc.getElementById('logRate');
  var lastUpdSec = -1;

  function frame() {
    root.requestAnimationFrame(frame);
    if (!started) return;

    var vNow = E.update();
    /* E.dt() 已经是毫秒（引擎里就是 _dtMs），不要再乘 1000。
     * 乘错的后果是每帧虚拟推进 16.7 秒：翻牌一帧走完、地图打点当帧即灭、
     * 横幅闪一帧、fps 算成 0 —— 一个单位错误同时废掉四处动效。 */
    var dtMs = E.dt();
    clock += dtMs;

    /* fps */
    if (dtMs > 0) { fpsAcc += 1000 / dtMs; fpsN++; }
    fpsT += dtMs;
    if (fpsT >= 1000) { fpsAvg = Math.round(fpsAcc / Math.max(1, fpsN)); fpsAcc = 0; fpsN = 0; fpsT = 0; }

    /* 爬虫打点预算：每秒补 5 个 */
    crawlHitBudget = Math.min(6, crawlHitBudget + dtMs / 1000 * 5);

    /* ── 两个大指标：连续计数就是它的动效。不做闪烁（规格 §4.4 禁 <300ms 循环）── */
    var m = E.metrics();
    kGmv.textContent = E.fmtUSD(m.gmv).replace(/\.\d+$/, '');
    kCrawl.textContent = E.fmtInt(Math.floor(m.crawls));
    kOrd.textContent = E.fmtInt(Math.floor(m.orders));
    kGmvSub.innerHTML = '全网 · 开幕以来累计 · 全精度不四舍五入　<b>≈ 每 '
      + Math.round(m.secondsPerOrder) + ' 秒一笔</b>';
    kCrawlSub.innerHTML = '<b>' + m.crawlsPerSec.toFixed(1) + ' 次/秒</b>　'
      + '距下一个里程碑还差 ' + E.fmtInt(Math.max(0, Math.round(m.nextMilestone.remain)));
    kOrdSub.innerHTML = '<b>' + m.ordersPerMin.toFixed(2) + ' 单/分</b>　'
      + E.fmtInt(Math.floor(m.pages)) + ' 个 AP 页面';

    /* 顶栏「最后更新」每秒走一次 —— 带秒的时间戳是最便宜的真实感（03 线） */
    var sec = Math.floor(vNow / 1000);
    if (sec !== lastUpdSec) {
      lastUpdSec = sec;
      updEl.textContent = fmtClock(vNow);
      spkHist.push(m.ordersPerMin);      /* 这格标签是「引荐订单」，就该画单/分 */
      if (spkHist.length > 46) spkHist.shift();
      drawSpark();
      logRate.textContent = '采样 9/秒 · 实际 ' + m.crawlsPerSec.toFixed(1) + '/秒';
      updateChannels();
    }

    /* ── 事件 ── */
    var os = E.pollOrders() || [];
    for (var i = 0; i < os.length; i++) pushOrder(os[i], false);

    var cs = E.pollCrawls(9) || [];
    for (var j = 0; j < cs.length; j++) pushCrawl(cs[j]);

    var ms = E.pollMilestones() || [];
    if (ms.length) {
      if (A) { try { A.playMilestone(); } catch (e) {} }
      bannerTxt.innerHTML = 'AP 翻译页面突破 <b>' + E.fmtInt(ms[0].value || 0) + '</b> 页';
      banner.classList.add('on');
      bannerT = 3200;
    }

    updateFlips();
    drawMap(dtMs);

    if (bannerT > 0) {
      bannerT -= dtMs;
      if (bannerT <= 0) banner.classList.remove('on');
    }
  }

  /* =====================================================================
   * 九、启动 / 快捷键 / 自检口
   * ===================================================================== */
  function sizeMap() {
    var pb = mapCv.parentNode;
    mapCv.width = Math.max(100, pb.clientWidth);
    mapCv.height = Math.max(100, pb.clientHeight);
    mapCtx = mapCv.getContext('2d');
    mapGeom();
    bakeMap();
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

    /* 预铺订单流。这里有两个坑，必须同时躲开：
     *   ① 不去重 → 预铺的单真实到达时会在屏上出现两条一模一样的成交
     *      （C-LED 第四版踩过，截图里 10 行有 4 对重复）。
     *   ② 只去重、却取最近的 N 笔 → 那 N 笔到达时被去重挡掉，屏上
     *      「订单流冻住」好几分钟（本版第一轮实测：开场 6 笔全被吃掉，
     *       gmv 在跳但行不换）。
     * 解法：取**远期**的 N 笔来预铺（第 58~63 笔，约 55 分钟之后才到），
     * 再叠一层 id 去重兜底。这样开场第一笔真实订单就能正常入场。 */
    var pre = [];
    try {
      var deep = E.peekOrders(ORD_ROWS + 58) || [];
      pre = deep.slice(-ORD_ROWS);
    } catch (e) { pre = []; }
    /* 时间戳有两个方向要同时对：
     *   ① 间隔必须**累加**（acc += 42~76 秒），写成 i*间隔 的话带抖动后
     *      相邻行会前后穿插，时间列就不单调了（C-LED 第四版的原话）。
     *   ② 赋值方向：pushOrder 是顶部插入，所以**最后**推的那一行在最上面，
     *      它必须是**最近**的一笔（acc 最小）。所以先按升序算好 acc，
     *      再从最旧的一笔倒着推。第一轮写反了，屏上出现
     *      19:33:24 / 19:27:32 / 19:28:35 …… 越往下越晚。 */
    var t0 = E.now(), accs = [], acc = 0, i, k;
    for (i = 0; i < pre.length; i++) {
      acc += 42000 + Math.round(E.hash32(i + 5, 913) * 34000);
      accs.push(acc);                        /* accs[0] 最小 = 最近 */
    }
    for (i = pre.length - 1; i >= 0; i--) {  /* 从最旧推到最近 */
      var o = pre[i];
      var clone = {};
      for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) clone[k] = o[k];
      clone.t = t0 - accs[i];
      pushOrder(clone, true);
    }
    layoutOrd(true);
    layoutLog(true);
    initChannels();

    doc.getElementById('goBtn').addEventListener('click', start);
    doc.getElementById('gate').addEventListener('click', start);
    root.requestAnimationFrame(frame);
  }

  doc.addEventListener('keydown', function (ev) {
    var k = ev.key;
    if (k === ' ') { ev.preventDefault(); E.togglePause(); }
    /* triggerOrder 收的是 {usd} 对象，不是位置参数。传 (460,1280) 会被当成
     * opts=460、opts.usd=undefined，退回引擎的 forceBig —— 那条路中位数只有
     * 约 $310，而 epic 门槛正好是 $300，所以「B 键约一半时间不出大单」。
     * 这里显式给区间 460~1280：必定 ≥ epic（红行 + 地图红点），约四成越过横幅门槛。 */
    else if (k === 'b' || k === 'B') {
      E.triggerOrder({ usd: E.demoAmount('legendary', bKeyN++) });
    }
    else if (k === 'n' || k === 'N') { E.triggerOrder({ usd: E.demoAmount('common', bKeyN++) }); }
    else if (k === 'k' || k === 'K') {
      if (A) { try { A.playMilestone(); } catch (e) {} }
      bannerTxt.innerHTML = 'AP 翻译页面突破 <b>' + E.fmtInt(Math.ceil(E.metrics().pages / 1000) * 1000) + '</b> 页';
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
    else if (k === '?' || k === '/') doc.getElementById('legend').classList.toggle('on');
  });

  /* 自检口。注意 topOrder/topLog 是必须的：两个流都是环形缓冲，
   * 「最新一行」在 DOM 里的位置是转的，外部靠 querySelector 取第一个会取错。 */
  root.APDiag = {
    get fpsAvg() { return fpsAvg; },
    get dom() { return doc.getElementsByTagName('*').length; },
    get hits() { return hits.length; },
    get seen() { return seenN; },
    get topOrder() {
      var r = oRows[oHead], out = [], i;
      for (i = 0; i < r.cells.length; i++) out.push(r.cells[i].textContent);
      return out.join('|');
    },
    get topOrderFlipping() { return oRows[oHead].active; },
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
