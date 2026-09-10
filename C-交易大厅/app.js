/* ===========================================================================
 * AP 展会大屏 · 方案 C「交易大厅」
 * ---------------------------------------------------------------------------
 * 参照系：彭博终端 / 机场航班信息牌 / 交易所报价屏。
 * 没有 3D、没有粒子、没有 canvas。全部预算花在两件事上：
 *   1) 列网格的对齐精度（运行时量测字宽，把 115 个字符格钉死在整数像素上）
 *   2) split-flap 机械翻页（每格一个 span，逐列 stagger 落位，只动 transform）
 *
 * 性能约束（连跑数天不掉帧）：
 *   · DOM 节点数恒定：10 行 × 115 格 = 1150 个 span，只改内容与 transform，
 *     全程不 append / 不 remove。里程碑齐翻也复用同一批 span。
 *   · 巨型数字是 10 个「数字轮」（每轮 11 个 span 常驻），每帧只写 9 次
 *     translate3d，永不改 textContent。
 *   · 动画时钟全部来自 APEngine.dt()（已钳制 100ms），随机全部来自
 *     APEngine.hash32()，重启后画面可复现。
 *   · will-change 只在翻页期间挂在行上，落位即摘。
 *
 * classic script。不用 ES module、不发网络请求、不用系统伪随机（一律走 hash32）。
 * =========================================================================== */
(function () {
  'use strict';

  /* =====================================================================
   * 0. 布局常量（与 index.html 的 CSS 一一对应，改一处要改两处）
   * ===================================================================== */
  /* 动画时钟：APEngine.dt() 累加（已钳制 100ms）。
   * 必须最先声明 —— 预填磁带在主循环之前就会读它。 */
  var clock = 0;

  var W = 1920, H = 1080, EDGE = 116, GUT = 32;
  var COL = (W - EDGE * 2 - GUT * 11) / 12;      /* 111.333 */

  var HERO_W = 1258;         /* 第 1~9 栏 */
  var HERO_BAND = 256;       /* .digits 的可用高度（CSS 里 flex:1 算出来的那一段） */
  var HERO_PAD = 7;          /* 数字轮上下留白，节距 = 字高 + 2×这个值 */
  var HERO_SLOTS = 10;       /* 引擎的 CRAWLS0 = 4.2 亿，10 位才够（到 99.9 亿） */
  var HERO_BIG = 7;          /* 前 7 位大字号（千位以上，最快也要 21 秒才跳一次） */
  var HERO_SML_R = 0.60;     /* 后 3 位（百/十/个）缩到 60%：这一段一直在滚，
                              * 大字号下半个字的滚动残影会糊掉可读性，
                              * 交易所报价屏就是「大整数 + 小尾数」这个做法 */
  var HERO_GAPS = [0, 3, 6]; /* 千分位间隙插在这些槽之后 → 1-3-3-3 分组 */
  var GRP_EM = 0.18;         /* 千分位「细间隙」宽度（em）。出版物做法，不用逗号 */
  var GRP_TAIL_EM = 0.26;    /* 大整数与小尾数之间的间隙略宽，标记字号变化 */
  /* 机械齿轮的进位窗口见下方 updateHero：按「距进位还剩多少毫秒」算，
   * 不按周期比例算（比例法会让高位卡在半个字上长达一分多钟）。 */

  var TAPE_W = 1688;
  var TAPE_MAX_FS = 26;
  var ROWS = 10, ROW_H = 40, ROW_CHARS = 115;

  /* 翻页节奏 */
  var STAGGER = 21, STAGGER_HOT = 26, STAGGER_MS = 19;
  var STEP = 46, STEP_HOT = 54, STEP_MS = 44;
  var INSERT_GAP = 760;      /* 齐发时逐行落位的最小间隔 */
  var INSERT_GAP_HOT = 1900; /* 大单在顶部多停一会儿再被推下去 */
  var MS_HOLD = 3600;        /* 里程碑大字停留（不含两端各 340ms 淡入淡出） */

  /* 列定义：起始格 / 宽度 / 对齐 / 表头 / 着色类。
   * 合计必须 = ROW_CHARS，下面有断言。 */
  var FIELDS = [
    { k: 'mark',  s: 0,  w: 1,  al: 'c', h: '',            cls: 'k0' },
    { k: 'time',  s: 2,  w: 8,  al: 'l', h: 'TIME',        cls: '' },
    { k: 'store', s: 12, w: 24, al: 'l', h: 'STORE',       cls: 'k1' },
    { k: 'cc',    s: 38, w: 2,  al: 'l', h: 'CC',          cls: '' },
    { k: 'prod',  s: 43, w: 37, al: 'l', h: 'PRODUCT',     cls: 'k2' },
    { k: 'amt',   s: 82, w: 10, al: 'r', h: 'USD',         cls: 'k3' },
    { k: 'src',   s: 94, w: 21, al: 'l', h: 'AI REFERRER', cls: 'k4' }
  ];
  var FLD = {};
  (function () {
    var last = FIELDS[FIELDS.length - 1];
    if (last.s + last.w !== ROW_CHARS) {
      console.error('[AP-C] 列宽合计错误', last.s + last.w, '!=', ROW_CHARS);
    }
    for (var i = 0; i < FIELDS.length; i++) FLD[FIELDS[i].k] = FIELDS[i];
  })();

  /* 翻页鼓面：每一格只在同类字符里翻，跟真实机械牌一致（数字鼓 / 字母鼓） */
  var DIG = '0123456789';
  var ALP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var PUN = '$.,:/-…';

  var METRIC_CN = { pages: '页面总数', crawls: 'AI 抓取', orders: 'AI 引荐订单' };
  var METRIC_EN = { pages: 'AP PAGES', crawls: 'AI CRAWLS', orders: 'AI-REFERRED ORDERS' };

  /* =====================================================================
   * 1. DOM 取用
   * ===================================================================== */
  function $(id) { return document.getElementById(id); }
  var stage = $('stage'), gate = $('gate');
  var elDigits = $('digits'), elClock = $('clock');
  var gRate = $('gRate'), gPages = $('gPages'), gPace = $('gPace');
  var gMarkVal = $('gMarkVal'), gMarkPct = $('gMarkPct'), gMarkBar = $('gMarkBar');
  var mixBar = $('mixBar'), mixLeg = $('mixLeg');
  var elTape = $('tape'), elTapeHead = $('tapeHead'), elTapeCount = $('tapeCount');
  var elUpper = $('upper');
  var elMs = $('ms'), msVal = $('msVal'), msMetric = $('msMetric');
  var elLegend = $('legend'), elStatus = $('status');
  var elDbg = $('dbg'), elDbgFps = $('dbgFps');

  /* =====================================================================
   * 2. 舞台适配：设计稿固定 1920×1080，只用 transform scale
   * ===================================================================== */
  function fit() {
    var s = Math.min(window.innerWidth / W, window.innerHeight / H);
    stage.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
  }
  window.addEventListener('resize', fit);
  fit();

  /* =====================================================================
   * 3. 字宽量测：把「每 em 的字符步进」量出来，列网格才可能真正对齐
   *    （Consolas 0.55em、Cascadia Mono 0.60em、回退字体又不一样，
   *      硬编码必然错位，所以必须量。）
   * ===================================================================== */
  function probeOf(probeId) {
    var p = $(probeId);
    var n = p.textContent.length;
    var out = {
      adv: (p.getBoundingClientRect().width / n) / 100,   /* probe 字号是 100px */
      fam: window.getComputedStyle(p).fontFamily
    };
    p.parentNode.removeChild(p);
    return out;
  }

  /** 字体的垂直度量（每 em）。数字轮的节距必须贴着字高算，
   *  否则滚动到一半会露出一大片空白，观众会以为渲染坏了。 */
  function vMetrics(fam) {
    var out = { cap: 0.71, asc: 1.0, desc: 0.25 };
    try {
      var c = document.createElement('canvas').getContext('2d');
      c.font = '600 100px ' + fam;
      var m = c.measureText('0');
      if (m.actualBoundingBoxAscent > 0) out.cap = m.actualBoundingBoxAscent / 100;
      if (m.fontBoundingBoxAscent > 0) out.asc = m.fontBoundingBoxAscent / 100;
      if (m.fontBoundingBoxDescent > 0) out.desc = m.fontBoundingBoxDescent / 100;
    } catch (e) { /* 老引擎没有 actualBoundingBox*，走默认值 */ }
    if (!(out.cap > 0.4 && out.cap < 0.95)) out.cap = 0.71;
    if (!(out.asc > 0.6 && out.asc < 1.8)) out.asc = 1.0;
    if (!(out.desc >= 0 && out.desc < 0.8)) out.desc = 0.25;
    return out;
  }

  var PM = probeOf('probeMono'), PD = probeOf('probeDisp');
  var MONO_R = (PM.adv > 0.2 && PM.adv < 1.2) ? PM.adv : 0.55;
  var DISP_R = (PD.adv > 0.2 && PD.adv < 1.2) ? PD.adv : 0.52;
  var VM = vMetrics(PD.fam);

  /* 磁带字号：先按列网格算出「刚好装满 1688px」的字号，再压到上限 */
  var TAPE_FS = Math.min(TAPE_MAX_FS, Math.floor(TAPE_W / (ROW_CHARS * MONO_R)));
  var SLOT = TAPE_FS * MONO_R;

  /* 巨型数字字号：7 大 + 3 小 + 3 个间隙必须装进 1258px，节距不超过可用高度 */
  var HERO_GAP_EM = (HERO_GAPS.length - 1) * GRP_EM + GRP_TAIL_EM;
  var HERO_FS = Math.floor(Math.min(
    HERO_W / (HERO_BIG * DISP_R +
              (HERO_SLOTS - HERO_BIG) * DISP_R * HERO_SML_R + HERO_GAP_EM),
    (HERO_BAND - 2 * HERO_PAD - 16) / VM.cap
  ));
  var HERO_FS_SML = Math.round(HERO_FS * HERO_SML_R);

  /* 节距 = 字高 + 上下留白；行高反解出来，让字高正好落在留白之间。
   * 大小两档用同一个 HERO_PAD → 槽底对齐即基线对齐（CSS 里是 align-items:flex-end）。 */
  function wheelBox(fs) {
    var cap = Math.round(fs * VM.cap);
    var pitch = cap + 2 * HERO_PAD;
    var lh = Math.round(2 * HERO_PAD + 2 * cap + fs * (VM.desc - VM.asc));
    if (!(lh > 16 && lh < fs * 2.5)) lh = pitch;
    return { fs: fs, cap: cap, pitch: pitch, lh: lh, w: fs * DISP_R };
  }
  var BOX_BIG = wheelBox(HERO_FS), BOX_SML = wheelBox(HERO_FS_SML);
  var PITCH = BOX_BIG.pitch;                 /* 调试读数用 */
  var HERO_LH = BOX_BIG.lh;

  /* =====================================================================
   * 4. 巨型数字：10 个机械里程表数字轮
   *    只写 translate3d，永不改 textContent；单调递增；无回弹缓动。
   *
   *    转速的硬账（这块屏最容易翻车的地方）：
   *    metrics.crawls 以约 48 次/秒增长。
   *      · 个位轮 = 48 格/秒 = 每帧 0.8 个节距 > 半个节距，60Hz 采样下必然出现
   *        车轮效应，数字看着往回倒 —— 规格 §4.2 明令禁止。所以个位固定在 0
   *        （读数按 10 取整，4.2 亿的量级上这点误差可忽略，副标也写明了）。
   *      · 十位轮 4.8 格/秒。连续滚会让它永远停在两个字之间（半个字），
   *        暂停时更是直接冻在半个字上，像渲染坏了。所以十位「整格跳」：
   *        不做中间插值，任何一帧都是完整字形，也绝不会倒退。
   *      · 百位及以上走机械齿轮：只在低位即将进位的最后 10% 才滚
   *        （最快也是每帧 0.08 节距，顺滑），平时死死停在整数刻度上。
   * ===================================================================== */
  var heroSlot = [], heroStrip = [], heroPitch = [], heroNeed = -1;
  var HERO_LAST = HERO_SLOTS - 1;   /* 个位槽：恒 0 */
  var HERO_FAST = HERO_SLOTS - 2;   /* 十位槽：连续滚 */
  (function buildHero() {
    for (var i = 0; i < HERO_SLOTS; i++) {
      var B = (i < HERO_BIG) ? BOX_BIG : BOX_SML;
      var slot = document.createElement('div');
      slot.className = 'slot';
      slot.style.width = B.w.toFixed(2) + 'px';
      slot.style.height = B.pitch + 'px';
      var strip = document.createElement('div');
      strip.className = 'strip';
      strip.style.width = B.w.toFixed(2) + 'px';
      for (var d = 0; d <= 10; d++) {        /* 0..9 再补一个 0，9→0 连续过渡 */
        var sp = document.createElement('span');
        sp.style.fontSize = B.fs + 'px';
        sp.style.height = B.pitch + 'px';
        sp.style.lineHeight = B.lh + 'px';
        sp.textContent = String(d % 10);
        strip.appendChild(sp);
      }
      slot.appendChild(strip);
      elDigits.appendChild(slot);
      heroSlot.push(slot); heroStrip.push(strip); heroPitch.push(B.pitch);
      if (HERO_GAPS.indexOf(i) >= 0) {       /* 千分位细间隙：1-3-3-3 分组 */
        var g = document.createElement('div');
        g.className = 'grp';
        g.style.width = (HERO_FS *
          (i === HERO_BIG - 1 ? GRP_TAIL_EM : GRP_EM)).toFixed(2) + 'px';
        g.style.height = B.pitch + 'px';
        elDigits.appendChild(g);
      }
    }
    heroStrip[HERO_LAST].style.transform = 'translate3d(0,0,0)';   /* 个位停在 0 */
  })();

  /* 齿轮滚动窗口必须按「时间」算，不能按「周期比例」算。
   * 原实现是 f > GEAR(0.96) 才滚，看着合理，但高位的周期极长：
   * 十万位每 100000/48 ≈ 2083 秒才进位一次，4% 就是 83 秒 ——
   * 那一位会有一分多钟卡在两个字形中间，实测截图里就是个看不出是几的怪符号。
   * 改成：距本位进位还剩 ROLL_MS 毫秒时才开始滚，每一位都只滚这么久。 */
  var ROLL_MS = 350;
  function updateHero(v, rate) {
    if (v < 0) v = 0;
    var lead = Math.max(1, (rate || 48) * (ROLL_MS / 1000));   /* 提前量，单位=计数 */
    for (var i = 0; i < HERO_LAST; i++) {
      var p = Math.pow(10, HERO_LAST - i);
      var d = Math.floor(v / p) % 10;
      var roll = 0;
      if (i !== HERO_FAST) {
        var rem = p - (v % p);            /* 距离本位进位还差多少计数 */
        if (rem < lead) roll = 1 - rem / lead;
      }
      heroStrip[i].style.transform =
        'translate3d(0,' + (-(d + roll) * heroPitch[i]).toFixed(2) + 'px,0)';
    }
    /* 前导空位用 visibility 隐藏（保留宽度）→ 整体右对齐，进位向左生长 */
    var need = v < 1 ? 1 : Math.floor(Math.log(v) / Math.LN10) + 1;
    if (need > HERO_SLOTS) need = HERO_SLOTS;
    if (need !== heroNeed) {
      heroNeed = need;
      for (var k = 0; k < HERO_SLOTS; k++) {
        heroSlot[k].style.visibility = (k < HERO_SLOTS - need) ? 'hidden' : 'visible';
      }
    }
  }

  /* =====================================================================
   * 5. 字符格工具：全角字符占 2 格（CJK 商品名不会把列网格顶歪）
   * ===================================================================== */
  function isWide(ch) {
    var c = ch.charCodeAt(0);
    return (c >= 0x1100 && c <= 0x115F) || (c >= 0x2E80 && c <= 0xA4CF) ||
           (c >= 0xAC00 && c <= 0xD7A3) || (c >= 0xF900 && c <= 0xFAFF) ||
           (c >= 0xFE30 && c <= 0xFE6F) || (c >= 0xFF00 && c <= 0xFF60) ||
           (c >= 0xFFE0 && c <= 0xFFE6);
  }
  var BLANK_CELL = { c: ' ', w: false, cont: false };

  function expand(text) {
    var out = [], i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      if (isWide(ch)) {
        out.push({ c: ch, w: true, cont: false });
        out.push({ c: '', w: false, cont: true });   /* 续格：留空，让宽字形溢出进来 */
      } else {
        out.push({ c: ch, w: false, cont: false });
      }
    }
    return out;
  }

  /** 把一段文本铺进 w 个字符格：超长截断加省略号，不足按对齐补空 */
  function fitField(text, w, al) {
    var e = expand(String(text));
    if (e.length > w) {
      e = e.slice(0, w - 1);
      if (e.length && e[e.length - 1].cont) e.pop();     /* 不留半个全角字 */
      while (e.length < w - 1) e.push(BLANK_CELL);
      e.push({ c: '…', w: false, cont: false });
    }
    var pad = w - e.length, blanks = [], i;
    for (i = 0; i < pad; i++) blanks.push(BLANK_CELL);
    if (al === 'r') return blanks.concat(e);
    if (al === 'c') {
      var l = Math.floor(pad / 2);
      return blanks.slice(0, l).concat(e).concat(blanks.slice(l));
    }
    return e.concat(blanks);
  }

  function p2(n) { return (n < 10 ? '0' : '') + n; }
  /* 大屏机器时区锁死 UTC+8，与引擎的 TZ_OFFSET_HOURS 一致，不读系统时区 */
  var TZ_MS = 8 * 3600000;
  function hhmmss(t) {
    var d = new Date(t + TZ_MS);
    return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds());
  }

  /** 一条订单 → 115 个字符格 */
  function rowCells(o) {
    var cells = new Array(ROW_CHARS), i, k;
    for (i = 0; i < ROW_CHARS; i++) cells[i] = BLANK_CELL;
    function put(f, text) {
      var e = fitField(text, f.w, f.al);
      for (k = 0; k < f.w; k++) cells[f.s + k] = e[k];
    }
    var hot = isHot(o);
    put(FLD.mark, hot ? '*' : ' ');
    put(FLD.time, hhmmss(o.t));
    put(FLD.store, String(o.store.name).toUpperCase());
    put(FLD.cc, o.store.cc);
    put(FLD.prod, String(o.product).toUpperCase());
    /* 金额走会计式：$ 钉在字段首格，数字在余下 9 格右对齐 */
    cells[FLD.amt.s] = { c: '$', w: false, cont: false };
    var money = APEngine.fmtUSD(o.usd).replace('$', '');
    var me = fitField(money, FLD.amt.w - 1, 'r');
    for (k = 0; k < FLD.amt.w - 1; k++) cells[FLD.amt.s + 1 + k] = me[k];
    put(FLD.src, String(o.referrer).toUpperCase());
    return cells;
  }

  function isHot(o) { return o.tier === 'epic' || o.tier === 'legendary'; }

  /* =====================================================================
   * 6. 磁带对象池：10 行 × 115 格，节点数恒定
   * ===================================================================== */
  var CELL_CLS = (function () {
    var arr = new Array(ROW_CHARS), i, f, k;
    for (i = 0; i < ROW_CHARS; i++) arr[i] = 'cel';
    for (i = 0; i < FIELDS.length; i++) {
      f = FIELDS[i];
      if (!f.cls) continue;
      for (k = 0; k < f.w; k++) arr[f.s + k] = 'cel ' + f.cls;
    }
    return arr;
  })();

  var rows = [], head = 0;
  (function buildTape() {
    for (var r = 0; r < ROWS; r++) {
      var el = document.createElement('div');
      el.className = 'row';
      var cells = new Array(ROW_CHARS);
      for (var c = 0; c < ROW_CHARS; c++) {
        var sp = document.createElement('span');
        sp.className = CELL_CLS[c];
        sp.style.left = (c * SLOT).toFixed(2) + 'px';
        sp.style.width = SLOT.toFixed(2) + 'px';
        sp.style.fontSize = TAPE_FS + 'px';
        sp.textContent = ' ';
        el.appendChild(sp);
        cells[c] = sp;
      }
      elTape.appendChild(el);
      rows.push({
        el: el, cells: cells, wideFlag: new Array(ROW_CHARS),
        target: null, filled: false, hot: false,
        active: false, fl: null, t0: 0, dur: STEP, seed: 0
      });
    }
    layoutRows();
  })();

  /* 表头：不上字符格，用 14px 小字按各列 x 定位 —— 视觉更轻，对齐一样精确 */
  (function buildHead() {
    for (var i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i];
      if (!f.h) continue;
      var b = document.createElement('b');
      b.textContent = f.h;
      if (f.al === 'r') {
        b.style.left = ((f.s + f.w) * SLOT).toFixed(2) + 'px';
        b.style.transform = 'translateX(-100%)';
      } else {
        b.style.left = (f.s * SLOT).toFixed(2) + 'px';
      }
      elTapeHead.appendChild(b);
    }
  })();

  /** instant = true 时整表无过渡地就位（预填 / 重置用：那一屏本来就「已经在那儿」了，
   *  不该看到十行依次滑动）。 */
  function layoutRows(instant) {
    var i, slot;
    if (instant) for (i = 0; i < ROWS; i++) rows[i].el.style.transition = 'none';
    for (i = 0; i < ROWS; i++) {
      slot = (i - head + ROWS) % ROWS;
      rows[i].el.style.transform = 'translate3d(0,' + (slot * ROW_H) + 'px,0)';
    }
    if (instant) {
      void rows[0].el.offsetWidth;                 /* 强制提交，避免被动画化 */
      for (i = 0; i < ROWS; i++) rows[i].el.style.transition = '';
    }
  }

  function setCell(row, c, t) {
    var el = row.cells[c];
    el.textContent = t.cont ? '' : t.c;
    if (row.wideFlag[c] !== t.w) {
      row.wideFlag[c] = t.w;
      el.className = t.w ? CELL_CLS[c] + ' wide' : CELL_CLS[c];
    }
  }
  function setCellChar(row, c, ch) {
    var el = row.cells[c];
    el.textContent = ch;
    if (row.wideFlag[c]) { row.wideFlag[c] = false; el.className = CELL_CLS[c]; }
  }

  function setRowCells(row, cells) {
    for (var c = 0; c < ROW_CHARS; c++) {
      setCell(row, c, cells[c]);
      row.cells[c].style.transform = '';
    }
    row.target = cells;
    row.filled = true;
  }

  function blankRow(row) {
    for (var c = 0; c < ROW_CHARS; c++) {
      setCell(row, c, BLANK_CELL);
      row.cells[c].style.transform = '';
    }
    row.active = false;
    row.fl = null;
    row.target = null;
    row.filled = false;
    row.el.classList.remove('flipping');
  }

  function clsOf(ch) {
    if (ch >= '0' && ch <= '9') return DIG;
    if (ch >= 'A' && ch <= 'Z') return ALP;
    if (PUN.indexOf(ch) >= 0) return PUN;
    return null;
  }

  /* ---------------------------------------------------------------------
   * split-flap 状态机。每格自己一套 { 起飞时刻, 翻几次, 当前第几次 }。
   * 逐列 stagger → 左边先落位、右边还在翻，机场牌的读法就是这么来的。
   * ------------------------------------------------------------------- */
  function startFlip(row, target, opts) {
    var stagger = opts.stagger, dur = opts.step, hot = opts.hot, seed = opts.seed;
    row.hot = hot;
    if (hot) row.el.classList.add('hot'); else row.el.classList.remove('hot');
    row.target = target;
    row.filled = true;
    row.fl = new Array(ROW_CHARS);
    for (var c = 0; c < ROW_CHARS; c++) {
      var tg = target[c], n;
      var cls = tg.cont ? null : clsOf(tg.c);
      if (tg.c === ' ' || tg.c === '') n = 0;          /* 空白：不翻，直接落位 */
      else if (tg.w) n = 1;                            /* 全角：只做一次机械翻转 */
      else n = (hot ? 5 : 3) + Math.floor(APEngine.hash32(seed + c * 17, 7001) * 3);
      row.fl[c] = { at: c * stagger, n: n, k: -1, cls: cls, done: false };
    }
    row.t0 = clock;
    row.dur = dur;
    row.seed = seed;
    row.active = true;
    row.el.classList.add('flipping');
  }

  function updateFlips() {
    for (var r = 0; r < ROWS; r++) {
      var row = rows[r];
      if (!row.active) continue;
      var fl = row.fl, done = 0, c, f, e, k, p;
      for (c = 0; c < ROW_CHARS; c++) {
        f = fl[c];
        if (f.done) { done++; continue; }
        e = clock - row.t0 - f.at;
        if (e < 0) continue;                            /* 还没轮到这一列 */
        k = (e / row.dur) | 0;
        if (k >= f.n) {                                 /* 落位：清 transform */
          setCell(row, c, row.target[c]);
          row.cells[c].style.transform = '';
          f.done = true; done++;
          continue;
        }
        if (f.k !== k) {
          f.k = k;
          if (f.cls) {
            setCellChar(row, c, f.cls.charAt(
              (APEngine.hash32(row.seed + c * 7 + k * 131, 4099) * f.cls.length) | 0));
          } else {
            setCell(row, c, row.target[c]);
          }
        }
        /* 翻板下落：从近乎侧立(-76°)加速拍到 0°，落地即停。无回弹。 */
        p = (e - k * row.dur) / row.dur;
        row.cells[c].style.transform =
          'perspective(560px) rotateX(' + (-76 * (1 - p * p)).toFixed(2) + 'deg)';
      }
      if (done >= ROW_CHARS) {
        row.active = false;
        row.fl = null;
        row.el.classList.remove('flipping');            /* will-change 立刻摘掉 */
      }
    }
  }

  /* ---------------------------------------------------------------------
   * 插入一条订单：顶部插入、整表下移、最旧一行淘汰。
   * 靠环形缓冲 + translateY 实现，绝不 append / remove DOM。
   * ------------------------------------------------------------------- */
  var nextInsertAt = 0;
  function insertOrder(o, instant) {
    head = (head - 1 + ROWS) % ROWS;
    var row = rows[head];

    /* 被淘汰的那一行要「无过渡」地跳到顶部，否则会出现一行从底飞到顶的鬼影 */
    blankRow(row);
    if (instant) {
      layoutRows(true);
    } else {
      row.el.style.transition = 'none';
      layoutRows();
      void row.el.offsetWidth;                          /* 强制提交，避免动画化 */
      row.el.style.transition = '';
    }

    var target = rowCells(o);
    var hot = isHot(o);
    if (instant) {
      if (hot) row.el.classList.add('hot'); else row.el.classList.remove('hot');
      row.hot = hot;
      setRowCells(row, target);
    } else {
      startFlip(row, target, {
        hot: hot, seed: seedOf(o),
        stagger: hot ? STAGGER_HOT : STAGGER,
        step: hot ? STEP_HOT : STEP
      });
      APAudio.blip();                                   /* 每行只响一次 */
      APAudio.playOrder(o);                             /* 订单本身的声音 */
    }
    nextInsertAt = clock + (hot ? INSERT_GAP_HOT : INSERT_GAP);
  }

  function seedOf(o) {
    return (Math.floor(o.t / 97) + Math.floor(o.usd * 100)) | 0;
  }

  /* =====================================================================
   * 7. 里程碑：整块表齐翻一次（按列扫过全表）+ 大字停留
   * ===================================================================== */
  /* 三段式，避免两个大数字互相透出：
   * 上半区淡出 320ms → 横幅淡入并停留 → 横幅淡出 → 上半区淡回。
   * 所有淡入淡出都 ≥ 320ms，不会踩到规格里「opacity 闪烁 < 300ms」那条。 */
  var msPhase = 0, msT = 0;
  var MS_FADE = 340;
  function fireMilestone(ev) {
    msVal.textContent = APEngine.fmtInt(ev.value);
    msMetric.textContent = (METRIC_EN[ev.metric] || ev.metric) +
                           '  ·  ' + (METRIC_CN[ev.metric] || '');
    elUpper.classList.add('dim');
    msPhase = 1;
    msT = clock;
    APAudio.playMilestone();
    APAudio.blip();
    var seed = Math.floor(clock) | 0;
    for (var i = 0; i < ROWS; i++) {
      var row = rows[i];
      if (!row.filled || !row.target) continue;
      /* 全表同时起翻、按列 stagger → 一道波从左扫到右，2.2 秒扫完 */
      startFlip(row, row.target,
        { hot: row.hot, seed: seed + i * 911, stagger: STAGGER_MS, step: STEP_MS });
    }
  }

  /* =====================================================================
   * 8. 仪表（节流写入，字符串没变就不碰 DOM）
   * ===================================================================== */
  function setText(el, s) { if (el.__v !== s) { el.__v = s; el.textContent = s; } }

  (function buildMix() {
    var pb = APEngine.platformBreakdown();
    var avail = 398 - (pb.length - 1) * 2;
    var op = [0.85, 0.60, 0.44, 0.30, 0.18];
    var leg = [];
    var SHORT = { ChatGPT: 'CHATGPT', Claude: 'CLAUDE', Google: 'GOOGLE',
                  Perplexity: 'PPLX', Others: 'OTHER' };
    for (var i = 0; i < pb.length; i++) {
      var seg = document.createElement('i');
      seg.style.width = (avail * pb[i].share).toFixed(2) + 'px';
      seg.style.opacity = String(op[i] === undefined ? 0.18 : op[i]);
      mixBar.appendChild(seg);
      leg.push((SHORT[pb[i].platform] || pb[i].platform) +
               ' ' + Math.round(pb[i].share * 100));
    }
    mixLeg.textContent = leg.join(' · ');
  })();

  var gAcc = 1e9, clkAcc = 1e9;
  function updateGauges(m) {
    gAcc += APEngine.dt();
    if (gAcc < 220) return;
    gAcc = 0;
    setText(gRate, m.crawlsPerSec.toFixed(1));
    setText(gPages, APEngine.fmtInt(m.pages));
    setText(gPace, '1 / ' + Math.round(m.secondsPerOrder) + ' s');
    setText(gMarkVal, APEngine.fmtInt(m.nextMilestone.value));
    setText(gMarkPct, Math.round(m.nextMilestone.progress * 100) + '%');
    gMarkBar.style.transform =
      'scaleX(' + Math.max(0, Math.min(1, m.nextMilestone.progress)).toFixed(4) + ')';
    /* 用 session 口径（开幕至今）而不是 orders 全量累计口径。
     * 全量是 29.6 万单起步，屏上写出来 BD 会被问成「今天卖了 29 万单？」，
     * 而「本场 718 单」商家一听就懂，也不用解释。 */
    setText(elTapeCount, 'SHOWING LAST ' + ROWS +
            '  ·  THIS SHOW ' + APEngine.fmtInt(m.session.orders) + ' ORDERS');
  }

  function updateClock(m) {
    clkAcc += APEngine.dt();
    if (clkAcc < 250) return;
    clkAcc = 0;
    var d = new Date(APEngine.now());
    setText(elClock, d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' +
            p2(d.getUTCDate()) + '  UTC ' + p2(d.getUTCHours()) + ':' +
            p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds()));
  }

  /* =====================================================================
   * 9. 调试网格（?debug=grid / G）：12 栏 + 8px 基线 + 三分线 + 安全区
   * ===================================================================== */
  (function buildDbg() {
    var i, e;
    for (i = 0; i < 12; i++) {                          /* 12 栏 */
      e = document.createElement('i');
      e.style.left = (EDGE + i * (COL + GUT)).toFixed(2) + 'px';
      e.style.top = '0'; e.style.width = COL.toFixed(2) + 'px'; e.style.height = '100%';
      elDbg.appendChild(e);
    }
    var vs = [W / 3, W * 2 / 3], hs = [H / 3, H * 2 / 3];
    for (i = 0; i < vs.length; i++) {                   /* 九宫格 */
      e = document.createElement('u');
      e.style.left = vs[i] + 'px'; e.style.top = '0';
      e.style.width = '1px'; e.style.height = '100%'; e.style.opacity = '.35';
      elDbg.appendChild(e);
    }
    for (i = 0; i < hs.length; i++) {
      e = document.createElement('u');
      e.style.left = '0'; e.style.top = hs[i] + 'px';
      e.style.width = '100%'; e.style.height = '1px'; e.style.opacity = '.35';
      elDbg.appendChild(e);
    }
    e = document.createElement('u');                    /* 中线 */
    e.style.left = (W / 2) + 'px'; e.style.top = '0';
    e.style.width = '1px'; e.style.height = '100%';
    elDbg.appendChild(e);
    e = document.createElement('u');
    e.style.left = '0'; e.style.top = (H / 2) + 'px';
    e.style.width = '100%'; e.style.height = '1px';
    elDbg.appendChild(e);
    e = document.createElement('s');                    /* 安全区 5% */
    e.style.left = (W * 0.05) + 'px'; e.style.top = (H * 0.05) + 'px';
    e.style.width = (W * 0.9) + 'px'; e.style.height = (H * 0.9) + 'px';
    elDbg.appendChild(e);
  })();

  /* =====================================================================
   * 10. FPS 环形缓冲自监控
   * ===================================================================== */
  var fpsBuf = new Float64Array(120), fpsI = 0, fpsN = 0, fpsWarn = 0, fpsAvg = 60;
  function updateFps(dt) {
    fpsBuf[fpsI] = dt; fpsI = (fpsI + 1) % fpsBuf.length;
    if (fpsN < fpsBuf.length) fpsN++;
    var s = 0;
    for (var i = 0; i < fpsN; i++) s += fpsBuf[i];
    fpsAvg = s > 0 ? (1000 * fpsN / s) : 60;
    if (fpsN === fpsBuf.length && fpsAvg < 40 && clock - fpsWarn > 30000) {
      fpsWarn = clock;
      console.warn('[AP-C] 60 帧均值 FPS ' + fpsAvg.toFixed(1) + ' < 40，现场请检查');
    }
  }

  /* =====================================================================
   * 11. 引擎启动（含「早于开幕时刻」的兜底）
   * ===================================================================== */
  function bootEngine() {
    APEngine.init();
    /* 开幕锚点是硬编码的 T0。如果机器时间还没到 T0 之后 1 小时，
     * 三个数字会全是 0、磁带也没东西 —— 彩排/异地演示必然踩到。
     * 这里把虚拟时钟推到 T0 + 4h（日内上午高峰），画面立刻是「开着的」。 */
    var t0 = APEngine.t0();
    if (APEngine.now() - t0 < 3600000) {
      APEngine.init({ startAt: t0 + 4 * 3600000 });
    }
  }
  bootEngine();

  /* 预填 10 行「刚刚过去」的成交，避免开屏是一张空表。
   * 取的是 peekOrders 里最远的 10 单（约 40~60 分钟后才真正到达），
   * 而 10 行磁带的周转约 9.5 分钟 —— 等它们真到达时早就滚出屏幕了，
   * 不会出现重复行。 */
  function prefillTape() {
    var peek = APEngine.peekOrders(48) || [];
    var pick = peek.slice(Math.max(0, peek.length - ROWS));
    var now = APEngine.now(), i, o;
    for (i = 0; i < pick.length; i++) {
      o = {};
      for (var k in pick[i]) o[k] = pick[i][k];
      o.t = now - (pick.length - i) * 65000;
      insertOrder(o, true);
    }
  }
  prefillTape();

  /* =====================================================================
   * 12. 主循环
   * ===================================================================== */
  var queue = [];
  var QUEUE_MAX = 14;

  function frame() {
    APEngine.update();
    var dt = APEngine.dt();
    clock += dt;
    updateFps(dt);

    var m = APEngine.metrics();
    updateHero(m.crawls, m.crawlsPerSec);
    updateGauges(m);
    updateClock(m);

    var arr = APEngine.pollOrders(), i;
    for (i = 0; i < arr.length; i++) {
      if (queue.length < QUEUE_MAX) queue.push(arr[i]);   /* 满了直接丢，不无限堆 */
    }
    if (queue.length && clock >= nextInsertAt) insertOrder(queue.shift(), false);

    var ms = APEngine.pollMilestones();
    if (ms.length && !msPhase) fireMilestone(ms[0]);
    if (msPhase) {
      var me = clock - msT;
      if (msPhase === 1 && me >= MS_FADE) { elMs.classList.add('on'); msPhase = 2; }
      else if (msPhase === 2 && me >= MS_FADE + MS_HOLD) {
        elMs.classList.remove('on'); msPhase = 3;
      } else if (msPhase === 3 && me >= MS_FADE + MS_HOLD + MS_FADE) {
        elUpper.classList.remove('dim'); msPhase = 0;
      }
    }

    updateFlips();

    if (dbgOn) {
      setText(elDbgFps, 'FPS ' + fpsAvg.toFixed(1) +
        '   SPD x' + APEngine.speed +
        '   ROWS ' + ROWS + '/' + ROW_CHARS +
        '   SPANS ' + (ROWS * ROW_CHARS + HERO_SLOTS * 11) +
        '   TAPE ' + TAPE_FS + 'px/' + SLOT.toFixed(2) +
        '   HERO ' + HERO_FS + 'px/pitch' + PITCH + '/lh' + HERO_LH +
        '   Q ' + queue.length +
        '   SND ' + (APAudio.muted ? 'MUTE' : 'ON') +
        '   VOICE ' + (APAudio.voiceAvailable ? 'OK' : 'NA'));
    }
    requestAnimationFrame(frame);
  }

  /* =====================================================================
   * 13. 交互（规格 §6 全套）
   * ===================================================================== */
  var dbgOn = (location.search.indexOf('debug=grid') >= 0);
  if (dbgOn) elDbg.classList.add('on');
  var hallOn = false, ambOn = false;

  function refreshStatus() {
    setText(elStatus, '×' + APEngine.speed +
      (APEngine.paused ? ' · PAUSED' : '') +
      ' · ' + (APAudio.muted ? 'MUTE' : 'SND') +
      (hallOn ? ' · HALL' : '') + (ambOn ? ' · AMB' : ''));
  }
  refreshStatus();

  /* B 键是 BD 手上最重要的一个键：必须每次都出「看得见的大单」。
   * 引擎默认的 triggerOrder() 中位数只有 $310，有一半概率落在 rare —— 屏上不高亮、
   * 也可能不触发人声，讲到关键处按下去没反应就砸了。这里把金额锁死在
   * epic/legendary 区间（≥ $420），高亮 + 人声播报都必然发生。 */
  /* 演示键的阶梯游标（见 engine.js DEMO_LADDERS） */
  var bigSeq = 0, normSeq = 0;

  function triggerBig() {
    var seed = Math.floor(APEngine.now() / 7) | 0;
    APEngine.triggerOrder({ usd: APEngine.demoAmount('legendary', bigSeq++) });
  }

  function triggerNormal() {
    /* 普通单：用引擎自己的金额分布抽一个非大单（确定性种子，走引擎的 hash32） */
    var seed = Math.floor(APEngine.now() / 13) | 0;
    APEngine.triggerOrder({ usd: APEngine.demoAmount('common', normSeq++) });
  }

  window.addEventListener('keydown', function (ev) {
    var k = ev.key;
    if (k === ' ') { ev.preventDefault(); APEngine.togglePause(); APAudio.blip(); refreshStatus(); return; }
    switch (k.toLowerCase()) {
      case 'm': APAudio.toggleMute(); refreshStatus(); break;
      case 'b': triggerBig(); break;
      case 'n': triggerNormal(); break;
      case 'k': fireMilestone({ metric: 'pages', value: APEngine.metrics().nextMilestone.value }); break;
      case '1': APEngine.setSpeed(0.5); APAudio.blip(); refreshStatus(); break;
      case '2': APEngine.setSpeed(1); APAudio.blip(); refreshStatus(); break;
      case '3': APEngine.setSpeed(3); APAudio.blip(); refreshStatus(); break;
      case 'g': dbgOn = !dbgOn; elDbg.classList.toggle('on', dbgOn); break;
      case 'h': hallOn = !hallOn; APAudio.setHallMode(hallOn); refreshStatus(); break;
      case 'a': ambOn = !ambOn; APAudio.setAmbient(ambOn); refreshStatus(); break;
      case 'f':
        if (document.fullscreenElement) { document.exitFullscreen(); }
        else if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen();
        }
        break;
      case 'r': doReset(); break;
      case '?': case '/': elLegend.classList.toggle('on'); break;
    }
  });

  function doReset() {
    bootEngine();
    queue.length = 0;
    nextInsertAt = 0;
    msPhase = 0;
    elMs.classList.remove('on');
    elUpper.classList.remove('dim');
    for (var i = 0; i < ROWS; i++) {
      blankRow(rows[i]);
      rows[i].filled = false;
      rows[i].target = null;
      rows[i].hot = false;
      rows[i].el.classList.remove('hot');
    }
    head = 0;
    layoutRows(true);
    heroNeed = -1;
    prefillTape();          /* 重置后磁带要立刻是满的，否则彩排时空表要等 10 分钟 */
    nextInsertAt = clock + INSERT_GAP;
    APAudio.blip();
    refreshStatus();
  }

  gate.addEventListener('click', function () {
    APAudio.unlock();                    /* 必须在一次用户手势里 */
    APAudio.setVoiceLang('zh-CN');
    APAudio.blip();
    gate.style.display = 'none';
    refreshStatus();
  });

  /* ?nogate=1 —— 只给 QA / 截图 / 无人值守回归用：跳过遮罩。
   * 注意此时没有用户手势，音频不会解锁（浏览器策略），现场演示不要用。 */
  if (location.search.indexOf('nogate') >= 0) gate.style.display = 'none';

  requestAnimationFrame(frame);
})();
