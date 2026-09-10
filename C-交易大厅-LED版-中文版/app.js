/* ===========================================================================
 * AP 展会大屏 · 方案 C-LED「交易大厅」· 第四版：中文 · 分区 · 世界地图
 * ---------------------------------------------------------------------------
 * 与 C-交易大厅-LED版（第三版）是**平行版本**，不是替代。第三版原样保留对照。
 * 参考图见 ../../参考-交易大厅/（03 东京电子报价板 是主要依据）。
 *
 * ── 第四版解决的三个观感问题 ──────────────────────────────────────────
 *
 * 【1】「区块混在一起」
 *   根因不是间距不够，是**整屏只有一种材质**：黑底 + 发光字。区块之间唯一的
 *   分隔是空白，而在「每一行都在发光」的环境里，空白读不出边界。
 *   真实报价墙靠**物理**分区：面板边框、压条、灯板黑缝、丝印标签底衬。
 *   第三版定义了 bezel 色却几乎没用上。
 *   第四版给每个区块一个真正的**面板**：底衬 + 描边 + 标题条 + 左侧强调条。
 *   同时把版面从「5 条通栏横条」改成「主栏 + 右栏」，用栏位建立层级。
 *
 * 【2】「中英文混排看着奇怪」（国内展会）
 *   第三版是**标签双语并列**，每个标签读两遍，信息密度虚高。第四版分三类处理：
 *     标签/标题/表头   -> 删英文，只留中文
 *     代码类数据       -> 保留（US / USD / PABE / GPT）。翻成「美国/美元」格子会
 *                        炸（格子宽度是硬约束），而且读起来像超市价签不像交易所
 *     数据本身         -> 保留（海外 DTC 店名本来就是英文；爬虫日志是真实感来源）
 *   代码看不懂的问题用**图例**解决，不用翻译单元格：市场图例 + 右栏来源平台面板。
 *
 * 【3】「不够吸引眼球」
 *   五个根因，逐条对治：
 *     a) 琥珀干了 4 份活（主数字/成交金额/市场格金额/规模条）-> 累计类整体改青
 *     b) 最亮的是跑马灯，环境层压过事件层            -> 跑马灯压暗一档
 *     c) 屏上没有爆点（大额红一分钟才来一笔）        -> 新成交入场高亮衰减
 *     d) 主数字直接坐在纯黑上，飘着                  -> 给它独立面板
 *     e) 规模条占右侧 462px 而标定又是坏的            -> 整列删掉，宽度给地图
 *   另加一件第三版完全缺的东西：**远距离可视物**。3 米外字读不到，能抓住人的
 *   是形状和运动，所以右栏加了点阵世界地图 —— 成交打点 + 爬虫打点。
 *
 * ── 修掉的两个真缺陷 ──────────────────────────────────────────────────
 *   [A] 成交流重复行。第三版 prefillPrints() 用 peekOrders() 取的是**未来单**，
 *       把时间戳改写成过去铺上屏；真实时间走到时同一笔又从 pollOrders 进来一次，
 *       而 pushPrint() 没有去重 —— 屏上出现两条一模一样的成交（截图里 10 行有
 *       4 对重复）。第四版改成用**独立种子空间**自己合成预铺行，与引擎订单流
 *       永不相交；pushPrint 再按 id 兜一层去重。
 *   [B] 页眉标语被压掉。第三版 #tagline 在 top:70(17px→压到 93)，而跑马灯面板
 *       从 y=88 开始画。第四版把 brand 与 tagline 并成一行，垂直让开跑马灯。
 *
 * ── 保留的第三版结论 ──────────────────────────────────────────────────
 *   报价 ≠ 成交（成交流是主角，市场墙是环境）；split-flap 只留给里程碑齐翻；
 *   每格永远满亮度（新鲜度用外框，不靠压暗）；店铺 4 字母代码 + 金额裸数字；
 *   一律「AI 引荐订单」不用「GPT 订单」；成交额在左、爬虫数在右。
 *
 * classic script。零网络依赖。随机一律 APEngine.hash32，步长一律 APEngine.dt()。
 * =========================================================================== */
(function (root) {
  'use strict';

  /* 演示键（B / N）的阶梯游标 —— 见 engine.js CONFIG.DEMO_LADDERS */
  var demoSeq = 0;

  var doc = root.document;
  var E = root.APEngine, A = root.APAudio, L = root.APLed, Geo = root.APGeo;

  var W = 1920, H = 1080, PAD = 56, INNER_W = W - PAD * 2;   /* 1808 */
  var MONO = "Consolas,'Cascadia Mono',ui-monospace,monospace";
  var CN = "'Microsoft YaHei',sans-serif";

  /* ── 配色：按「层」分工（见 index.html 顶部注释）────────────────────── */
  var C = {
    bg: '#000000',
    panel: '#080808', panelIn: '#0B0A08', bar: '#14110A',
    edge: '#241E12', edgeHi: '#4A3A1C',
    amber: '#FFB020', amberD: '#C08213',
    cyan: '#2AA8C0', cyanD: '#17616F', cyanDim: '#123038',
    green: '#35D06A', greenD: '#1B6134',
    red: '#FF3B30',
    white: '#F2F2F2', dim: '#5E5E5E', label: '#8A6A2A'
  };
  var OFFDOT = 'rgba(255,176,32,0.040)';

  /* =====================================================================
   * 版面（自上而下）。垂直预算是倒着算的：页脚固定 988 -> 市场墙收在 970。
   * ---------------------------------------------------------------------
   *   页眉（DOM）        34..64
   *   跑马灯面板         76..118
   *   主数字面板 x2      130..298
   *   主栏 成交流面板    310..800      右栏 世界地图  310..562
   *                                    右栏 来源平台  574..800
   *   市场墙面板         812..970
   *   页脚（DOM）        988
   * ===================================================================== */
  var TAPE_Y = 76, TAPE_H = 42, TAPE_TAB_W = 176;

  var HERO_Y = 130, HERO_H = 168, HERO_BAR = 32;
  var HERO_L_X = PAD, HERO_L_W = 884;          /*  56..940  */
  var HERO_R_X = 956, HERO_R_W = 908;          /* 956..1864 */
  /* 灯珠区顶。注意点阵数字的垂直占位是量出来的、不是估的（fpx=15 时）：
   *   数字 '0'  高 12 行、基线在第 11 行
   *   '$'       高 15 行、基线在第 12 行  -> 比数字**高出 1 行**
   *   ','       高  7 行、基线在第  3 行  -> 比数字**低出 3 行**
   * drawFixed 按 '0' 的基线对齐，所以整串实际占 16 行：从 y-pitch 到 y+15*pitch。
   * pitch 7.4 时就是 118px —— 第一稿按 112px 排，副行直接被挤到贴着面板描边。
   * 所以副行改放**标题条右侧**：既腾出全部垂直空间，标签和它的明细也挨在一起。 */
  var HERO_TOP = 170;                          /* 灯珠区真实顶边 */
  var HERO_FPX = 15, HERO_DOT_R = 0.72;        /* 灯珠直径 = pitch * 0.72 */

  var MAIN_X = PAD, MAIN_W = 1216;             /*   56..1272 */
  var RAIL_X = 1288, RAIL_W = 576;             /* 1288..1864 */

  var PR_PANEL_Y = 310, PR_PANEL_H = 490, PR_BAR = 32;
  var PR_HEAD_Y = 364, PR_HAIR_Y = 372;
  var PRINT_Y = 378, PRINT_H = 46, PRINT_N = 9;    /* 378..792 */

  var MAP_Y = 310, MAP_H = 282;
  var PLAT_Y = 604, PLAT_H = 196;

  var MKT_PANEL_Y = 812, MKT_PANEL_H = 158;
  var MKT_Y = 850, MKT_H = 112, MKT_COLS = 6, MKT_GAP = 6;
  var MKT_W = Math.floor((INNER_W - (MKT_COLS - 1) * MKT_GAP) / MKT_COLS);  /* 296 */

  /* 灯珠填充率约 63%（真实 LED 的珠子更小、缝更大，亮点才离散清晰） */
  var MK_PITCH = 3, MK_DOT = 1.9, MK_FPX = 15;      /* 市场格：国家码 */
  var MK_AMT_PITCH = 3.0, MK_AMT_FPX = 15;          /* 市场格：金额 */
  var META_PITCH = 2, META_DOT = 1.35, META_FPX = 12;
  var PR_PITCH = 2.2, PR_DOT = 1.5, PR_FPX = 14;    /* 成交流正文 */
  var PR_AMT_PITCH = 2.6, PR_AMT_FPX = 16;   /* 灯珠直径走 pitch*0.69，见 makePrint */

  /* ── 成交流列位：按最坏情况算，不是估的（第二版这里真撞过）──────────
   *   行宽 = MAIN_W = 1216，正文一个字符 = slot(10) x pitch(2.2) = 22px
   *     时间 "14:41:08"  8 字符 = 176            -> 代码列 >= 192
   *     店铺截断 16 字符 = 352                   -> 市场列 >= 674
   *     金额最坏是 KRW：AMOUNT_CAP 4500 美元 x 1340 = "6,029,996" 9 字符，
   *       pitch 2.6 时 231px。但那是 p99.99 的极端值，九成订单只占 ~150px，
   *       按 240 预留 + 右对齐会在「币种」和数字之间空出 110px 的洞。
   *       所以预留收到 **200**，并对金额也用 fitPitch —— 极端值自己降一档 pitch
   *       （2.6 -> 2.2 时 196px 能塞进去），常态则不再留洞。
   *
   * ── 「规模」列已删除 ──────────────────────────────────────────
   * 它原来画的是**美元折算额**的对数条，而旁边「金额」列是本地币种，
   * 所以它其实是全屏唯一能跨币种比大小的东西 —— 不是冗余。
   * 但标定是坏的：p5($15.5) 画 49px、p99($790) 画 116px，
   * **51 倍的钱差只画出 2.4 倍的长度差**，九成订单挤在 36%~71% 满，
   * 远看是一排差不多长的条 —— 传达的是「所有单都差不多大」，比不放更糟。
   * 而且表头写「规模」却没说单位是美元，观众会以为条画的是旁边那个本地币种数。
   * 「有大单来了」这件事已经由**红色**承担（红行 + 红金额），不靠长度。
   * 结论：删掉，宽度给右栏的世界地图 —— 那才是 3 米外真正能读的东西。 */
  var COL = { t: 16, code: 220, store: 336, mkt: 716, cur: 788,
              amt: 1082, src: 1110 };
  var AMT_BOX = 200;                                /* 金额列预留宽 */
  var STORE_MAX = 16;

  var cv, ctx;

  /* =====================================================================
   * 一、底纹 / 精灵图 / 等宽点阵数字（沿用第三版，未改）
   * ===================================================================== */
  function bakeField(w, h, pitch, dot) {
    var c = doc.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    var g = c.getContext('2d');
    g.fillStyle = OFFDOT;
    g.beginPath();
    var o = (pitch - dot) * 0.5;
    for (var y = 0; y + pitch <= c.height; y += pitch) {
      for (var x = 0; x + pitch <= c.width; x += pitch) g.rect(x + o, y + o, dot, dot);
    }
    g.fill();
    return c;
  }
  var fieldMkt = null, fieldTape = null, fieldPrint = null;

  var SPR = new Map(), SPR_CAP = 1600;
  function sprite(text, pitch, dot, fpx, color, round) {
    var key = text + '|' + pitch + '|' + dot + '|' + fpx + '|' + color + '|' + (round ? 1 : 0);
    var s = SPR.get(key);
    if (s) return s;
    var m = L.mask(text, fpx, MONO, true);
    var c = doc.createElement('canvas');
    c.width = Math.max(1, Math.ceil(m.w * pitch));
    c.height = Math.max(1, Math.ceil(m.h * pitch));
    var g = c.getContext('2d');
    g.fillStyle = color;
    g.beginPath();
    L.path(g, m, 0, 0, pitch, dot, round);
    g.fill();
    s = { cv: c, w: c.width, h: c.height };
    if (SPR.size >= SPR_CAP) SPR.clear();
    SPR.set(key, s);
    return s;
  }

  /** 等宽点阵数字：逐字符定槽、槽内居中、基线对齐。整串渲染会因为墨迹裁剪
   *  导致每次取值左右空白不同，数字会横向抽动（规格 §4.2 第 1 条）。 */
  function slotsOf(fpx) {
    var slot = Math.round(fpx * 0.62) + 1;
    return { slot: slot, narrow: Math.max(3, Math.round(slot * 0.55)) };
  }
  function fixedWidth(text, pitch, fpx) {
    var S = slotsOf(fpx), w = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      w += ((ch === ',' || ch === '.' || ch === ' ') ? S.narrow : S.slot) * pitch;
    }
    return w;
  }
  function drawFixed(g, text, x, y, pitch, dot, fpx, color, round) {
    var S = slotsOf(fpx);
    var baseRow = L.mask('0', fpx, MONO, true).base;
    var cx = x, i, ch, m, sw, s;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      sw = (ch === ',' || ch === '.' || ch === ' ') ? S.narrow : S.slot;
      if (ch !== ' ') {
        m = L.mask(ch, fpx, MONO, true);
        s = sprite(ch, pitch, dot, fpx, color, round);
        g.drawImage(s.cv,
          Math.round(cx + Math.round((sw - m.w) * 0.5) * pitch),
          Math.round(y + (baseRow - m.base) * pitch));
      }
      cx += sw * pitch;
    }
    return cx - x;
  }
  function fitPitch(text, fpx, maxW, cand) {
    for (var i = 0; i < cand.length; i++) {
      if (fixedWidth(text, cand[i], fpx) <= maxW) return cand[i];
    }
    return cand[cand.length - 1];
  }

  function num(v, dec) {
    try {
      return new Intl.NumberFormat('en-US',
        { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
    } catch (e) { return String(Math.round(v)); }
  }
  /** 金额只留数字 —— 真实报价墙的价格栏就是裸数字，币种在旁边单独一列。 */
  function amtStr(o) {
    var dec = (o.currency === 'JPY' || o.currency === 'KRW' || o.amount >= 1000) ? 0 : 2;
    return num(o.amount, dec);
  }

  /* 店铺代码：Cove Wharf -> COWH。真实报价墙本来就用代码（AAPL / 7203 / 三菱重）。 */
  var CODE_CACHE = {};
  function tickerCode(name) {
    if (CODE_CACHE[name]) return CODE_CACHE[name];
    var w = name.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/)
               .filter(function (x) { return x.length > 0; });
    var code = (w.length >= 2)
      ? (w[0] + 'XX').slice(0, 2) + (w[1] + 'XX').slice(0, 2)
      : ((w[0] || 'AP') + 'XXXX').slice(0, 4);
    CODE_CACHE[name] = code;
    return code;
  }
  /* 来源代号。这套代号在「来源」列里出现，右栏「来源平台」面板就是它的图例
   * —— 一次教会观众，不必在每一格里重复写全名。 */
  var SRC = {
    'chatgpt.com':            { code: 'GPT',  name: 'ChatGPT' },
    'perplexity.ai':          { code: 'PPLX', name: 'Perplexity' },
    'claude.ai':              { code: 'CLDE', name: 'Claude' },
    'gemini.google.com':      { code: 'GEM',  name: 'Gemini' },
    'copilot.microsoft.com':  { code: 'CPLT', name: 'Copilot' }
  };
  function srcCode(host) { return (SRC[host] && SRC[host].code) || 'AI'; }

  /* =====================================================================
   * 二、面板：这一版「区块看得清」的全部秘密
   * ---------------------------------------------------------------------
   * 底衬 + 描边 + 标题条 + 标题条左侧 3px 强调条。
   * 强调条的颜色顺带告诉观众这一块属于哪一层（琥珀=事件 / 青=环境 / 绿=通道）。
   * 返回内容区的顶部 y，调用方据此排内容。
   * ===================================================================== */
  function panel(x, y, w, h, opt) {
    opt = opt || {};
    ctx.fillStyle = opt.fill || C.panel;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = opt.edge || C.edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (!opt.title) return y;

    var bh = opt.barH || 32;
    ctx.fillStyle = C.bar;
    ctx.fillRect(x + 1, y + 1, w - 2, bh - 1);
    ctx.strokeStyle = opt.edge || C.edge;
    ctx.beginPath();
    ctx.moveTo(x + 1, y + bh + 0.5); ctx.lineTo(x + w - 1, y + bh + 0.5);
    ctx.stroke();
    ctx.fillStyle = opt.accent || C.amber;
    ctx.fillRect(x + 1, y + 1, 3, bh - 1);

    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    var fs = opt.titleSize || 20;
    ctx.font = '700 ' + fs + 'px ' + CN;
    ctx.fillStyle = opt.titleColor || C.white;
    var by = y + bh - Math.round((bh - fs) / 2) - 3;
    ctx.fillText(opt.title, x + 18, by);
    if (opt.sub) {
      var tw = ctx.measureText(opt.title).width;
      ctx.font = '400 14px ' + CN;
      ctx.fillStyle = C.label;
      ctx.fillText(opt.sub, x + 18 + tw + 14, by - 1);
    }
    /* 标题条右侧：给这一块的明细行留的位置（主数字的「今日 +$… · N 笔 · …」） */
    if (opt.right) {
      ctx.font = '500 14px ' + CN;
      ctx.fillStyle = opt.rightColor || '#8E8E8E';
      ctx.textAlign = 'right';
      ctx.fillText(opt.right, x + w - 20, by - 1);
      ctx.textAlign = 'left';
    }
    return y + bh;
  }

  /* =====================================================================
   * 三、环境层：市场墙（6 格）
   * ---------------------------------------------------------------------
   * 5 个主要市场 + 第 6 格「其他」聚合。为什么必须有聚合桶：
   * 只放 5 个市场的话，剩下 13 个市场的成交点不亮任何格子，墙会时不时僵住；
   * 有了聚合桶，每一笔成交必定命中某一格，而且 6 格相加 = 主数字的成交额。
   *
   * 第四版把这一层整体改成**青色**：它讲的是「累计到今天」，跟成交流讲的
   * 「刚刚这一笔」不是一回事，用色相分开比用亮度分开清楚得多。
   * ===================================================================== */
  var MAIN_MKT = ['US', 'GB', 'DE', 'FR', 'CA'];
  var MKT_CN = { US: '美国', GB: '英国', DE: '德国', FR: '法国', CA: '加拿大' };
  var cells = [], cellByCC = {}, otherCell = null;

  function makeCell(i, cc) {
    var c = doc.createElement('canvas');
    c.width = MKT_W; c.height = MKT_H;
    return {
      i: i, cc: cc,
      x: PAD + i * (MKT_W + MKT_GAP), y: MKT_Y, col: i,
      cv: c, g: c.getContext('2d'),
      gmv: 0, n: 0, flash: 0, fresh: 1e9, dirty: true, scr: null
    };
  }

  function paintCell(c) {
    var g = c.g;
    g.clearRect(0, 0, MKT_W, MKT_H);
    g.fillStyle = C.panelIn;
    g.fillRect(0, 0, MKT_W, MKT_H);
    g.strokeStyle = C.edge; g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, MKT_W - 1, MKT_H - 1);
    if (fieldMkt) g.drawImage(fieldMkt, 10, 10);

    var cc = c.scr ? c.scr.cc : (c.cc === 'OTHER' ? 'OTH' : c.cc);
    var amt = c.scr ? c.scr.amt : num(c.gmv, 0);
    var cnt = c.scr ? c.scr.n : (num(c.n, 0) + ' 笔');

    /* L1 左：国家码（白，大）　L1 右：笔数（青） */
    drawFixed(g, cc, 16, 12, MK_PITCH, MK_DOT, MK_FPX, C.white, false);
    var ns = sprite(cnt, META_PITCH, META_DOT, META_FPX, C.cyan, false);
    g.drawImage(ns.cv, MKT_W - 16 - ns.w, 20);

    /* L2：该市场今日累计成交额（美元，青，右对齐） */
    var ap = fitPitch(amt, MK_AMT_FPX, MKT_W - 62, [MK_AMT_PITCH, 2.7, 2.4, 2.1]);
    var aw = fixedWidth(amt, ap, MK_AMT_FPX);
    drawFixed(g, amt, MKT_W - 16 - aw, 60, ap, ap * 0.62, MK_AMT_FPX, C.cyan, false);
    var $s = sprite('$', META_PITCH, META_DOT, META_FPX + 3, C.cyanD, false);
    g.drawImage($s.cv, Math.max(14, MKT_W - 16 - aw - $s.w - 8), 74);
  }

  /* =====================================================================
   * 四、事件层：成交流（主角，9 行 + 表头）
   * ===================================================================== */
  var prints = [];

  function makePrint(o, idx) {
    var big = E.TIER_RANK[o.tier] >= E.TIER_RANK.epic;
    var c = doc.createElement('canvas');
    c.width = MAIN_W; c.height = PRINT_H;
    var g = c.getContext('2d');

    /* 斑马底：相邻行交替，是长表格里最省事的可扫读手段 */
    g.fillStyle = big ? 'rgba(56,9,5,0.92)' : (idx % 2 ? '#0C0B09' : '#070706');
    g.fillRect(0, 0, MAIN_W, PRINT_H);
    if (fieldPrint) g.drawImage(fieldPrint, 12, 6);

    var main = big ? '#FF6A60' : C.amber;
    var sub = big ? '#FFB9B4' : '#9E9E9E';
    var d = new Date(o.t + 8 * 3600000);
    var hh = ('0' + d.getUTCHours()).slice(-2) + ':' +
             ('0' + d.getUTCMinutes()).slice(-2) + ':' +
             ('0' + d.getUTCSeconds()).slice(-2);
    var ty = 6;

    drawFixed(g, hh, COL.t, ty, PR_PITCH, PR_DOT, PR_FPX, sub, false);
    drawFixed(g, tickerCode(o.store.name), COL.code, ty,
              PR_PITCH, PR_DOT, PR_FPX, C.white, false);
    var nm = o.store.name;
    if (nm.length > STORE_MAX) nm = nm.slice(0, STORE_MAX - 1) + '…';
    g.drawImage(sprite(nm, PR_PITCH, PR_DOT, PR_FPX, sub, false).cv, COL.store, ty + 2);
    g.drawImage(sprite(o.store.cc, PR_PITCH, PR_DOT, PR_FPX, C.cyan, false).cv,
                COL.mkt, ty + 2);
    g.drawImage(sprite(o.currency, PR_PITCH, PR_DOT, PR_FPX, C.green, false).cv,
                COL.cur, ty + 2);

    /* 金额：本地币种、右对齐、比其他列大一档 —— 这一行的主角。
     * 规模条腾出来的宽度全给了它（第三版 pitch 2.4 -> 这版 2.6）。 */
    var astr = amtStr(o);
    var ap = fitPitch(astr, PR_AMT_FPX, AMT_BOX, [PR_AMT_PITCH, 2.4, 2.2, 2.0]);
    var aw = fixedWidth(astr, ap, PR_AMT_FPX);
    drawFixed(g, astr, COL.amt - aw, 2, ap, ap * 0.69,
              PR_AMT_FPX, main, false);

    g.drawImage(sprite(srcCode(o.referrer), PR_PITCH, PR_DOT, PR_FPX,
                       C.green, false).cv, COL.src, ty + 2);

    /* 左侧标记条：大额红、其余暗琥珀（最新那一行由主循环额外加亮） */
    g.fillStyle = big ? C.red : '#3A2A0C';
    g.fillRect(0, 0, 3, PRINT_H);

    return { cv: c, id: o.id, anim: 0, hot: 1, big: big, usd: o.usd, zebra: idx % 2 };
  }

  /** 按 id 去重再插入。第三版没有这一层，预铺的未来单在真实时间到达时
   *  会被再打印一遍（屏上两条一模一样的成交）。也顺手兜住「一笔单处理两遍」。 */
  function pushPrint(o) {
    var i;
    if (o.id) {
      for (i = prints.length - 1; i >= 0; i--) {
        if (prints[i].id === o.id) prints.splice(i, 1);
      }
    }
    prints.unshift(makePrint(o, 0));
    if (prints.length > PRINT_N) prints.length = PRINT_N;
    /* 斑马条纹跟行号绑定，插入后需要重绘（9 行，一分钟一次，代价可忽略） */
    for (i = 1; i < prints.length; i++) {
      if (prints[i].zebra !== i % 2) { prints[i].zebra = i % 2; }
    }
  }

  /** 成交流表头。第四版全中文 —— 第三版每列写「时间 TIME」双语，
   *  每列读两遍，删掉英文后表头宽度立刻松一大截。 */
  function drawPrintHead(cy) {
    var head = [
      [COL.t, '时间', 0], [COL.code, '代码', 0], [COL.store, '店铺', 0],
      [COL.mkt, '市场', 0], [COL.cur, '币种', 0], [COL.amt, '金额', 1],
      [COL.src, '来源', 0]
    ];
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = '600 14px ' + CN;
    ctx.fillStyle = '#6E5A2E';
    for (var i = 0; i < head.length; i++) {
      var x = MAIN_X + head[i][0];
      if (head[i][2]) {
        ctx.fillText(head[i][1], x - ctx.measureText(head[i][1]).width, PR_HEAD_Y);
      } else {
        ctx.fillText(head[i][1], x, PR_HEAD_Y);
      }
    }
    ctx.strokeStyle = C.edge; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MAIN_X + 1, PR_HAIR_Y + 0.5);
    ctx.lineTo(MAIN_X + MAIN_W - 1, PR_HAIR_Y + 0.5);
    ctx.stroke();
  }

  /* =====================================================================
   * 五、双主角：两个独立面板（成交额在左 = 第一阅读位）
   * ---------------------------------------------------------------------
   * 第三版两个数字直接坐在纯黑上，是全屏最大的元素却没有任何衬托，视觉上飘着。
   * 这版各给一个面板，于是它们从「两行大字」变成「仪表盘上的两块主表」。
   * ===================================================================== */
  var heroSession = /(?:\?|&)hero=session(?:&|$)/.test(root.location.search);
  var gmvShown = 0, gmvTarget = 0;
  var floats = [];

  function drawHero(m) {
    var inW, s, pitch, wdt, x0;

    /* ── 左：AI 引荐累计成交额 ───────────────────────────────────── */
    panel(HERO_L_X, HERO_Y, HERO_L_W, HERO_H, {
      title: 'AI 引荐累计成交额', barH: HERO_BAR, titleSize: 19,
      accent: C.amber, edge: C.edgeHi,
      right: '今日 +$' + num(Math.round(m.session.gmv), 0) +
             '　·　' + E.fmtInt(m.session.orders) + ' 笔' +
             '　·　平均每 ' + Math.round(m.secondsPerOrder) + ' 秒一笔',
      rightColor: '#9E9E9E'
    });
    inW = HERO_L_W - 40;
    s = '$' + num(Math.floor(gmvShown), 0);
    /* 判据是「占可用栏宽 85~92%」—— cap height 达不到屏高 30% 是几何上限，
     * 拿屏高比例当判据会永远不达标（规格 §4.2 / 第三版结论 8）。 */
    pitch = fitPitch(s, HERO_FPX, inW, [7.4, 7.0, 6.6, 6.2, 5.8]);
    drawFixed(ctx, s, HERO_L_X + 20, HERO_TOP + pitch, pitch, pitch * HERO_DOT_R,
              HERO_FPX, C.amber, true);

    /* ── 右：AI 爬虫累计访问 ─────────────────────────────────────
     * 灰标题 + 明显暗一档的琥珀 + 小一号的灯珠间距 = 退到第二阅读位。
     * 第一稿用 #C08213 和左边差得不够，点阵小圆点会把明度差再削一层。 */
    panel(HERO_R_X, HERO_Y, HERO_R_W, HERO_H, {
      title: heroSession ? '本场 AI 爬虫访问' : 'AI 爬虫累计访问',
      barH: HERO_BAR, titleSize: 19, titleColor: '#A8A8A8',
      accent: C.amberD, edge: C.edge,
      right: m.crawlsPerSec.toFixed(1) + ' 次/秒　·　' +
             E.fmtInt(m.pages) + ' 个 AP 页面已被 AI 收录',
      rightColor: '#7E7E7E'
    });
    inW = HERO_R_W - 40;
    s = E.fmtInt(heroSession ? m.session.crawls : m.crawls);
    pitch = fitPitch(s, HERO_FPX, inW, [7.0, 6.6, 6.2, 5.8, 5.4]);
    wdt = fixedWidth(s, pitch, HERO_FPX);
    x0 = HERO_R_X + HERO_R_W - 20 - wdt;
    drawFixed(ctx, s, x0, HERO_TOP + pitch, pitch, pitch * HERO_DOT_R,
              HERO_FPX, '#9C6C10', true);
  }

  /** 成交金额浮字。位置在**成交流标题条的右侧**（那块是空的）：
   *  第三版它浮在 HERO_Y 上方，而这一版跑马灯从 88 上移到 76，
   *  照抄就会把浮字压在滚动的爬虫日志上 —— 两行字叠在一起，两边都读不了。
   *  放在成交流的头上语义也更顺：「刚落了一笔印」。 */
  function drawFloats(dtS) {
    for (var i = floats.length - 1; i >= 0; i--) {
      var f = floats[i];
      f.t += dtS;
      if (f.t > 1.6) { floats.splice(i, 1); continue; }
      var k = f.t / 1.6;
      /* 尺寸和行程都收在标题条那 32px 之内：fpx 12 / pitch 1.8 的字高约 22px，
       * 319 -> 311 的行程让它上下都不越界。第一版给了 36px 高 + 28px 行程，
       * 直接压在下面的表头「金额 来源」上。 */
      var s = sprite(f.txt, 1.8, 1.25, 12, f.big ? '#FF6A60' : '#7CE0A0', false);
      ctx.save();
      ctx.globalAlpha = Math.min(1, (1 - k) * 2.2);
      ctx.drawImage(s.cv, MAIN_X + MAIN_W - 20 - s.w,
                    PR_PANEL_Y + 9 - Math.round(k * 8));
      ctx.restore();
    }
  }

  /* =====================================================================
   * 六、右栏上：点阵世界地图 —— 第三版完全缺的「远距离可视物」
   * ---------------------------------------------------------------------
   * 为什么需要它：3 米以外字是读不到的，能抓住人的只有形状和运动。
   * 第三版整屏全是字和条，于是远看就是一片发光的噪声。
   *
   * 陆块用手工点阵表达（64 列 x 26 行等距圆柱投影：
   *   列 = 经度 -180..180，每列 5.625°；行 = 纬度 +78..-52，每行 5°）。
   * 为什么手工而不是取地理数据：这个尺寸下一颗灯珠 = 5.6 经度 x 5 纬度，
   * 任何真实边界数据都会被采样成同样粗的方块，而手工可以保证
   * **大西洋缺口和地中海缺口是干净的** —— 这两处干净，世界地图就认得出来。
   * ===================================================================== */
  var MAP_COLS = 64, MAP_ROWS = 26;
  var MAP_LON0 = -180, MAP_DLON = 360 / MAP_COLS;   /* 5.625 */
  var MAP_LAT0 = 78, MAP_DLAT = 5;
  var MAP_INSET = 16;
  var MAP_PITCH, MAP_DOT, MAP_X0, MAP_Y0, mapBase = null;

  /* 每行若干 [起列, 止列] 闭区间。注释是该行的纬度中心。 */
  var LAND = [
    [[11, 18], [22, 27]],                                     /* 75.5N 北极群岛 + 格陵兰北。
                                                                 原来还点了斯瓦尔巴/新地岛等孤立
                                                                 单点，这个尺寸下读成杂点，去掉 */
    [[4, 19], [22, 27], [35, 63]],                            /* 70.5N */
    [[2, 21], [23, 28], [33, 63]],                            /* 65.5N */
    [[2, 21], [23, 24], [32, 63]],                            /* 60.5N */
    [[1, 4], [8, 21], [30, 31], [33, 63]],                    /* 55.5N */
    [[9, 21], [30, 57]],                                      /* 50.5N */
    [[10, 20], [31, 57]],                                     /* 45.5N */
    [[10, 20], [30, 57]],                                     /* 40.5N */
    [[11, 19], [30, 33], [36, 56]],                           /* 35.5N 34-35 留出地中海 */
    [[11, 18], [29, 55]],                                     /* 30.5N */
    [[12, 14], [17, 17], [28, 42], [44, 53]],                 /* 25.5N */
    [[12, 14], [28, 41], [44, 51], [53, 53]],                 /* 20.5N */
    [[13, 15], [28, 39], [45, 46], [49, 51], [53, 54]],       /* 15.5N */
    [[16, 20], [29, 40], [45, 45], [49, 51], [53, 54]],       /* 10.5N */
    [[17, 22], [30, 40], [46, 46], [50, 50], [53, 54]],       /*  5.5N */
    [[17, 24], [33, 39], [50, 54]],                           /*  0.5N */
    [[17, 25], [33, 39], [50, 53], [55, 58]],                 /*  4.5S */
    [[18, 25], [33, 39], [51, 52], [54, 58]],                 /*  9.5S */
    [[18, 25], [33, 40], [54, 57]],                           /* 14.5S */
    [[19, 25], [34, 38], [40, 40], [52, 58]],                 /* 19.5S */
    [[19, 24], [34, 37], [39, 39], [51, 59]],                 /* 24.5S */
    [[19, 23], [35, 37], [52, 59]],                           /* 29.5S */
    [[19, 22], [35, 36], [52, 58]],                           /* 34.5S */
    [[19, 21], [57, 58], [62, 62]],                           /* 39.5S */
    [[19, 20], [57, 57], [61, 62]],                           /* 44.5S */
    [[19, 20], [61, 61]]                                      /* 49.5S */
  ];

  var MAP_CAP_H = 24;                 /* 底部图注带，必须从可用高度里先扣掉 */
  function mapGeom() {
    var aw = RAIL_W - MAP_INSET * 2;
    /* 可用高度 = 面板高 - 标题条(32) - 上间距(8) - 图注带 - 下间距(8)。
     * 第一版忘了扣图注带，图注直接压在地图最下面一行（澳洲/新西兰）上。 */
    var ah = MAP_H - 32 - 8 - MAP_CAP_H - 8;
    MAP_PITCH = Math.min(aw / MAP_COLS, ah / MAP_ROWS);
    MAP_DOT = MAP_PITCH * 0.64;
    MAP_X0 = RAIL_X + MAP_INSET + (aw - MAP_PITCH * MAP_COLS) / 2;
    MAP_Y0 = MAP_Y + 40 + Math.max(0, (ah - MAP_PITCH * MAP_ROWS) / 2);
  }
  function mapPos(lat, lon) {
    var c = (lon - MAP_LON0) / MAP_DLON;
    var r = (MAP_LAT0 - lat) / MAP_DLAT;
    c = Math.max(0, Math.min(MAP_COLS - 1, c));
    r = Math.max(0, Math.min(MAP_ROWS - 1, r));
    return { x: MAP_X0 + (Math.floor(c) + 0.5) * MAP_PITCH,
             y: MAP_Y0 + (Math.floor(r) + 0.5) * MAP_PITCH };
  }

  /** 每个市场取该国权重最高的城市当代表点 —— 数据驱动，不硬编码经纬度。 */
  function marketPoints() {
    var out = [], mk = Geo.MARKETS, i, j;
    for (i = 0; i < mk.length; i++) {
      var list = Geo.citiesByCC[mk[i].cc];
      if (!list || !list.length) continue;
      var best = list[0];
      for (j = 1; j < list.length; j++) if (list[j][4] > best[4]) best = list[j];
      out.push({ cc: mk[i].cc, lat: best[1], lon: best[2], main: MKT_CN[mk[i].cc] ? 1 : 0 });
    }
    return out;
  }

  /** 陆块 + 市场点烤成一张静态图，每帧只 drawImage 一次。 */
  function bakeMap() {
    mapGeom();
    var w = Math.ceil(MAP_PITCH * MAP_COLS), h = Math.ceil(MAP_PITCH * MAP_ROWS);
    var c = doc.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    var o = (MAP_PITCH - MAP_DOT) * 0.5, r, k, seg, x;

    g.fillStyle = C.cyanDim;
    g.beginPath();
    for (r = 0; r < LAND.length && r < MAP_ROWS; r++) {
      for (k = 0; k < LAND[r].length; k++) {
        seg = LAND[r][k];
        for (x = seg[0]; x <= seg[1] && x < MAP_COLS; x++) {
          g.rect(x * MAP_PITCH + o, r * MAP_PITCH + o, MAP_DOT, MAP_DOT);
        }
      }
    }
    g.fill();

    /* 市场点：常亮青。5 个主要市场再亮一档（跟下面市场墙的 6 格对上） */
    var pts = marketPoints(), i, p, px, py;
    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      px = ((p.lon - MAP_LON0) / MAP_DLON);
      py = ((MAP_LAT0 - p.lat) / MAP_DLAT);
      px = Math.max(0, Math.min(MAP_COLS - 1, px));
      py = Math.max(0, Math.min(MAP_ROWS - 1, py));
      g.fillStyle = p.main ? C.cyan : C.cyanD;
      var d = p.main ? MAP_DOT + 2.4 : MAP_DOT + 0.6;
      g.fillRect(Math.floor(px) * MAP_PITCH + (MAP_PITCH - d) / 2,
                 Math.floor(py) * MAP_PITCH + (MAP_PITCH - d) / 2, d, d);
    }
    mapBase = c;
  }

  /* 打点。成交 = 琥珀（事件层）+ 一圈扩散环；爬虫 = 暗绿，密度大所以要限流。
   * 都是**一次性衰减**，不是循环闪烁 —— 规格 §4.4 禁的是 <300ms 的 opacity
   * 明暗循环，一次性入场衰减属于「事件卡入场」那一栏。 */
  var pingsO = [], pingsC = [], crawlBudget = 0;
  function pingOrder(lat, lon, big) {
    var p = mapPos(lat, lon);
    pingsO.push({ x: p.x, y: p.y, t: 0, big: !!big });
    if (pingsO.length > 10) pingsO.shift();
  }
  function pingCrawl(lat, lon) {
    var p = mapPos(lat, lon);
    pingsC.push({ x: p.x, y: p.y, t: 0 });
    if (pingsC.length > 14) pingsC.shift();
  }

  function drawMap(dtMs) {
    var cy = panel(RAIL_X, MAP_Y, RAIL_W, MAP_H, {
      title: '全球成交分布', sub: '实时', titleSize: 19,
      accent: C.cyan, titleColor: '#DCDCDC'
    });
    if (mapBase) ctx.drawImage(mapBase, Math.round(MAP_X0), Math.round(MAP_Y0));

    var i, p, k, rr;
    /* 爬虫打点：500ms 衰减 */
    for (i = pingsC.length - 1; i >= 0; i--) {
      p = pingsC[i]; p.t += dtMs;
      if (p.t > 520) { pingsC.splice(i, 1); continue; }
      k = 1 - p.t / 520;
      ctx.fillStyle = 'rgba(53,208,106,' + (0.55 * k).toFixed(3) + ')';
      ctx.fillRect(p.x - MAP_DOT * 0.6, p.y - MAP_DOT * 0.6,
                   MAP_DOT * 1.2, MAP_DOT * 1.2);
    }
    /* 成交打点：亮点 + 扩散环，900ms */
    for (i = pingsO.length - 1; i >= 0; i--) {
      p = pingsO[i]; p.t += dtMs;
      if (p.t > 900) { pingsO.splice(i, 1); continue; }
      k = 1 - p.t / 900;
      var ease = 1 - Math.pow(1 - p.t / 900, 3);
      rr = 3 + ease * 20;
      ctx.strokeStyle = (p.big ? 'rgba(255,59,48,' : 'rgba(255,176,32,') +
                        (0.85 * k * k).toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rr, 0, 6.283185307179586);
      ctx.stroke();
      var d = MAP_DOT + 2.6 * k;
      ctx.fillStyle = p.big ? C.red : (k > 0.5 ? '#FFF0D0' : C.amber);
      ctx.fillRect(p.x - d / 2, p.y - d / 2, d, d);
    }

    /* 图注。没有它观众不知道那些青点是什么 —— 地图是新加的，
     * 「常亮」和「闪动」两种点必须一句话交代清楚。 */
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    ctx.font = '400 13px ' + CN;
    ctx.fillStyle = '#6A6A6A';
    ctx.fillText('常亮＝AP 覆盖市场　　闪动＝刚刚成交',
                 RAIL_X + RAIL_W / 2, MAP_Y + MAP_H - 14);
    ctx.textAlign = 'left';
    return cy;
  }

  /* =====================================================================
   * 七、右栏下：来源平台
   * ---------------------------------------------------------------------
   * 这一块是「来源」列那串代号（GPT / PPLX / CLDE / GEM / CPLT）的图例，
   * 顺带把第三版挤在成交流标题右边、已经糊成一团的「平台占比」搬来这里。
   *
   * 注意口径：第三版那行占比是 platformBreakdown()，它算的是**爬虫**平台权重，
   * 却贴在成交流旁边，读起来像成交来源占比 —— 是个语义错位。这里明确用
   * REFERRERS（订单来源）的权重，跟「来源」列同一个口径。
   * ===================================================================== */
  var platRows = null;
  function buildPlatRows() {
    var refs = E.REFERRERS, tot = 0, i, out = [];
    for (i = 0; i < refs.length; i++) tot += refs[i].w;
    for (i = 0; i < refs.length; i++) {
      var meta = SRC[refs[i].host] || { code: 'AI', name: refs[i].platform };
      out.push({ code: meta.code, name: meta.name, share: refs[i].w / tot });
    }
    out.sort(function (a, b) { return b.share - a.share; });
    platRows = out;
  }

  function drawPlatforms() {
    panel(RAIL_X, PLAT_Y, RAIL_W, PLAT_H, {
      title: '来源平台', sub: 'AI 引荐来源占比', titleSize: 19,
      accent: C.green, titleColor: '#DCDCDC'
    });
    if (!platRows) buildPlatRows();
    var x = RAIL_X + 18, wMax = RAIL_W - 36;
    /* 5 行 x 30 = 150，从 PLAT_Y+42 起 -> 收在面板底之前。
     * 面板从 226 收到 196（把 30px 让给上面的地图），行高必须跟着从 36 收到 30，
     * 否则 5 行会溢出面板 28px。 */
    var top = PLAT_Y + 32 + 10, rowH = 30, i;
    ctx.textBaseline = 'alphabetic';
    for (i = 0; i < platRows.length; i++) {
      var p = platRows[i], y = top + i * rowH;
      ctx.textAlign = 'left';
      ctx.font = '700 15px ' + MONO;
      ctx.fillStyle = C.green;
      ctx.fillText(p.code, x, y + 14);
      ctx.font = '400 14px ' + CN;
      ctx.fillStyle = '#8E8E8E';
      ctx.fillText(p.name, x + 62, y + 14);
      ctx.textAlign = 'right';
      ctx.font = '700 15px ' + MONO;
      ctx.fillStyle = C.amber;
      ctx.fillText(Math.round(p.share * 100) + '%', x + wMax, y + 14);
      ctx.textAlign = 'left';
      /* 占比条：底槽满宽 + 实条按占比（相对最大值归一，差异才看得出） */
      ctx.fillStyle = '#161310';
      ctx.fillRect(x, y + 21, wMax, 5);
      ctx.fillStyle = i === 0 ? C.green : C.greenD;
      ctx.fillRect(x, y + 21, Math.round(wMax * p.share / platRows[0].share), 5);
    }
  }

  /* =====================================================================
   * 八、噪音层：顶部跑马灯（真实爬虫日志）
   * ---------------------------------------------------------------------
   * 第三版这条是全屏最亮的东西，把主数字的注意力抢走了 —— 它是环境噪音，
   * 不该当主角。这版整体压暗一档，并在左侧加一个固定标签块告诉观众这是什么
   * （第三版这条绿色瀑布没有任何说明）。
   * ===================================================================== */
  var tape = [], tapeX = 0, TAPE_SPEED = 76;
  var TAPE_PITCH = 2.6, TAPE_DOT = 1.8, TAPE_FPX = 11;
  var TAPE_C1 = '#6E4E12', TAPE_C2 = '#1B6134';
  var synthSeq = 0;

  function synthCrawl() {
    var seed = 500000 + (synthSeq++) * 41;
    var bots = E.BOTS, dcs = Geo.DATACENTERS, pts = E.PAGE_TYPES;
    var bot = bots[Math.floor(E.hash32(seed, 31) * bots.length)];
    var dc = dcs[Math.floor(E.hash32(seed, 1229) * dcs.length)];
    var store = E.makeStore(Math.floor(E.hash32(seed, 1231) * E.CONFIG.STORES));
    var pt = pts[Math.floor(E.hash32(seed, 17) * pts.length)];
    return {
      bot: bot.name, platform: bot.platform, ip: dc.ip + '.x.x', asn: dc.asn,
      dcCity: dc.city, dcLat: dc.lat, dcLon: dc.lon,
      path: pt.path + String(store.name).toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').slice(0, 26),
      status: E.hash32(seed, 1301) > 0.02 ? 200 : 304,
      ms: 40 + Math.floor(E.hash32(seed, 1307) * 260)
    };
  }
  function dcOf(cr) {
    if (cr.dcLat !== undefined) return cr;
    var dcs = Geo.DATACENTERS, i;
    for (i = 0; i < dcs.length; i++) if (dcs[i].city === cr.dcCity) return dcs[i];
    return dcs[0];
  }
  function feedTape(list) {
    for (var i = 0; i < list.length && tape.length < 40; i++) {
      var cr = list[i];
      var txt = '·   ' + cr.bot + '  ' + cr.ip + '  ' + cr.asn.toUpperCase() +
                '  ' + cr.dcCity.toUpperCase() + '  ' + cr.path + '  ' +
                cr.status + '  ' + cr.ms + 'MS';
      tape.push({ s: sprite(txt, TAPE_PITCH, TAPE_DOT, TAPE_FPX,
                  cr.platform === 'ChatGPT' ? TAPE_C1 : TAPE_C2, false) });
      /* 顺手往地图上打一个暗绿点。爬虫 40/秒，全打会把地图糊掉，所以限流。 */
      if (crawlBudget > 0) {
        crawlBudget--;
        var dc = dcOf(cr);
        pingCrawl(dc.lat, dc.lon);
      }
    }
    for (i = 0; i < tape.length; i++) if (!tape[i].w) tape[i].w = tape[i].s.w + 54;
  }

  function drawTape(dtS) {
    var g = ctx;
    panel(PAD, TAPE_Y, INNER_W, TAPE_H, {});
    /* 左侧固定标签块：真实报价墙的 ticker 都有这么一块丝印铭牌 */
    g.fillStyle = C.bar;
    g.fillRect(PAD + 1, TAPE_Y + 1, TAPE_TAB_W - 1, TAPE_H - 2);
    g.fillStyle = C.greenD;
    g.fillRect(PAD + 1, TAPE_Y + 1, 3, TAPE_H - 2);
    g.strokeStyle = C.edge; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(PAD + TAPE_TAB_W + 0.5, TAPE_Y + 1);
    g.lineTo(PAD + TAPE_TAB_W + 0.5, TAPE_Y + TAPE_H - 1);
    g.stroke();
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.font = '600 15px ' + CN;
    g.fillStyle = '#7E7E7E';
    g.fillText('AI 爬虫实时日志', PAD + 18, TAPE_Y + 27);

    var sx = PAD + TAPE_TAB_W + 8, sw = INNER_W - TAPE_TAB_W - 15;
    if (fieldTape) g.drawImage(fieldTape, sx, TAPE_Y + 6);

    if (!E.paused) tapeX -= TAPE_SPEED * dtS * E.speed;
    g.save();
    g.beginPath();
    g.rect(sx, TAPE_Y + 6, sw, TAPE_H - 12);
    g.clip();
    var x = sx + tapeX, i = 0;
    while (i < tape.length) {
      var t = tape[i];
      if (x + t.w < sx) { tape.shift(); tapeX += t.w; x += t.w; continue; }
      if (x > sx + sw) break;
      g.drawImage(t.s.cv, Math.round(x), TAPE_Y + 10);
      x += t.w; i++;
    }
    g.restore();
    if (x < sx + sw + 200) {
      var real = E.pollCrawls(14);
      while (real.length < 3) real.push(synthCrawl());
      feedTape(real);
    }
  }

  /* =====================================================================
   * 九、大额成交横幅（legendary 才有）
   * ===================================================================== */
  var banner = null;
  function showBanner(o) { banner = { o: o, t: 0, dur: 3400 }; }
  function drawBanner(dtMs) {
    if (!banner) return;
    banner.t += dtMs;
    if (banner.t > banner.dur) { banner = null; return; }
    var fade = Math.min(1, banner.t / 260) *
               Math.min(1, Math.max(0, (banner.dur - banner.t) / 380));
    var o = banner.o;
    var y0 = PRINT_Y, hh = PRINT_H * 3;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = '#0A0000';
    ctx.fillRect(MAIN_X, y0, MAIN_W, hh);
    ctx.strokeStyle = C.red; ctx.lineWidth = 2;
    ctx.strokeRect(MAIN_X + 1, y0 + 1, MAIN_W - 2, hh - 2);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = '700 22px ' + CN;
    ctx.fillStyle = C.red;
    ctx.fillText('大额成交', MAIN_X + 24, y0 + 34);

    var astr = amtStr(o);
    var aw = fixedWidth(astr, 4.4, 18);
    drawFixed(ctx, astr, MAIN_X + 24, y0 + 48, 4.4, 3.1, 18, '#FF6A60', true);
    var s1 = sprite(o.currency + '   ' + o.store.name + '   ' + o.store.cc +
                    '   ' + srcCode(o.referrer), 2.6, 1.8, 15, '#FFB9B4', false);
    ctx.drawImage(s1.cv, MAIN_X + 40 + aw, y0 + 62);
    ctx.restore();
  }

  /* =====================================================================
   * 十、里程碑：全屏齐翻（split-flap 的高潮感只留给它）
   * ===================================================================== */
  var msT = -1, msDur = 5200, msEv = null;
  var MS_WAVE = 110, MS_SCRAMBLE = 1500;

  function celebrate(ev) {
    msEv = ev; msT = 0;
    A.playMilestone();
    for (var i = 0; i < cells.length; i++) { cells[i].scr = null; cells[i].dirty = true; }
  }
  function stepMilestone(dtMs) {
    if (msT < 0) return;
    msT += dtMs;
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i], t0 = c.col * MS_WAVE;
      if (msT >= t0 && msT < t0 + MS_SCRAMBLE) {
        var step = Math.floor((msT - t0) / 70), sd = i * 977 + step * 31;
        c.scr = {
          cc: L.scramble(c.cc === 'OTHER' ? 'OTH' : c.cc, sd, E.hash32),
          amt: L.scramble(num(c.gmv, 0), sd + 7, E.hash32),
          n: L.scramble(num(c.n, 0) + ' 笔', sd + 11, E.hash32)
        };
        c.dirty = true;
      } else if (c.scr) { c.scr = null; c.dirty = true; }
    }
    if (msT > msDur) { msT = -1; msEv = null; }
  }
  function drawMilestoneOverlay() {
    if (msT < 0 || !msEv) return;
    var fade = Math.min(1, msT / 340) * Math.min(1, Math.max(0, (msDur - msT) / 420));
    var y0 = PR_PANEL_Y, hh = (MKT_Y + MKT_H) - y0 + 8;
    ctx.save();
    ctx.globalAlpha = fade * 0.93;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, y0, W, hh);
    ctx.globalAlpha = fade;
    var METRIC = { pages: 'AP 翻译页面', crawls: 'AI 爬虫累计访问', orders: 'AI 引荐订单' };
    var str = E.fmtInt(msEv.value);
    var w = fixedWidth(str, 8, 15);
    /* 数字实占 16 行 x pitch 8 = 128px -> y0+283 覆盖 y0+275..y0+403 */
    drawFixed(ctx, str, (W - w) / 2, y0 + 283, 8, 5.8, 15, C.amber, true);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 26px ' + CN;
    ctx.fillStyle = C.white;
    ctx.fillText('里程碑', W / 2, y0 + 237);
    ctx.font = '600 28px ' + CN;
    ctx.fillStyle = C.label;
    ctx.fillText(METRIC[msEv.metric] || msEv.metric, W / 2, y0 + 446);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  /* =====================================================================
   * 十一、成交处理
   * ===================================================================== */
  function onOrder(o) {
    pushPrint(o);
    var c = cellByCC[o.store.cc] || otherCell;
    if (c) {
      c.gmv += o.usd; c.n += 1;
      c.flash = 560; c.fresh = 0; c.dirty = true;
    }
    gmvTarget += o.usd;
    /* 地图打点用买家所在地 —— 讲的是「AI 把哪里的顾客带进来了」 */
    if (o.buyerLat !== undefined) {
      pingOrder(o.buyerLat, o.buyerLon, E.TIER_RANK[o.tier] >= E.TIER_RANK.epic);
    }
    floats.push({
      txt: '+$' + num(o.usd, o.usd >= 1000 ? 0 : 2), t: 0,
      big: E.TIER_RANK[o.tier] >= E.TIER_RANK.epic
    });
    if (floats.length > 6) floats.shift();
    if (o.tier === 'legendary') showBanner(o);
    A.playOrder(o);
  }

  /** 开场铺满：把「本场至今」的成交额与笔数按市场权重摊到 6 格。
   *  空板在展会上是硬伤，而且这样铺出来的数跟引擎的 session 口径一致。 */
  function seedCells(m) {
    var wmap = {}, i, mk = Geo.MARKETS, totMain = 0, totAll = 0;
    for (i = 0; i < mk.length; i++) {
      wmap[mk[i].cc] = mk[i].weight;
      totAll += mk[i].weight;
    }
    for (i = 0; i < MAIN_MKT.length; i++) totMain += wmap[MAIN_MKT[i]] || 0;
    for (i = 0; i < cells.length; i++) {
      var c = cells[i];
      var share = (c.cc === 'OTHER')
        ? (totAll - totMain) / totAll
        : (wmap[c.cc] || 0) / totAll;
      /* ±14% 确定性抖动，避免 6 格看起来像等比例分配 */
      var j = 0.86 + 0.28 * E.hash32(i * 131 + 7, 4021);
      c.gmv = m.session.gmv * share * j;
      c.n = Math.max(1, Math.round(m.session.orders * share * j));
      c.dirty = true;
    }
  }

  /* =====================================================================
   * 十二、主循环
   * ===================================================================== */
  var lastClock = '';

  function frame() {
    E.update();
    var dtMs = E.dt(), dtS = dtMs / 1000;
    var m = E.metrics();
    var i;

    /* 爬虫地图打点限流：每秒最多 5 个，否则地图会被糊成一片绿 */
    crawlBudget = Math.min(5, crawlBudget + dtS * 5 * E.speed);

    var od = E.pollOrders();
    for (i = 0; i < od.length; i++) onOrder(od[i]);

    var ms = E.pollMilestones();
    if (ms.length && msT < 0) {
      if (ms[0].metric === 'pages') A.blip();   /* 约 14 分钟一次，太频繁，不全屏 */
      else celebrate(ms[0]);
    }
    stepMilestone(dtMs);

    /* 成交额平滑追目标：每笔成交时数字滚上去，比硬跳更有「进账」感 */
    if (gmvTarget < m.gmv) gmvTarget = m.gmv;
    gmvShown += (gmvTarget - gmvShown) * Math.min(1, dtMs / 280);

    for (i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (!E.paused) c.fresh += dtMs * E.speed;
      if (c.flash > 0) {
        c.flash -= dtMs;
        if (c.flash <= 0) { c.flash = 0; c.dirty = true; }
      }
    }
    for (i = 0; i < prints.length; i++) {
      if (prints[i].anim < 1) prints[i].anim = Math.min(1, prints[i].anim + dtMs / 400);
      if (prints[i].hot > 0) prints[i].hot = Math.max(0, prints[i].hot - dtMs / 480);
    }

    /* ---------------- 绘制 ---------------- */
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    drawTape(dtS);
    drawHero(m);

    /* ── 主栏：成交流面板 ─────────────────────────────────────── */
    panel(MAIN_X, PR_PANEL_Y, MAIN_W, PR_PANEL_H, {
      title: '成交流', sub: '逐笔 AI 引荐成交', barH: PR_BAR,
      accent: C.amber, edge: C.edgeHi
    });
    drawPrintHead();
    drawFloats(dtS);           /* 浮字画在成交流标题条上，必须在面板之后 */

    for (i = 0; i < prints.length; i++) {
      var pr = prints[i];
      var ease = 1 - Math.pow(1 - pr.anim, 3);
      var ox = (i === 0) ? Math.round((1 - ease) * 200) : 0;
      var y = PRINT_Y + i * PRINT_H;
      ctx.save();
      ctx.globalAlpha = (i === 0) ? ease : 1;
      ctx.drawImage(pr.cv, MAIN_X + ox, y);
      ctx.restore();
      /* 最新一行：入场时整行高亮，480ms 衰减到常态的 10%。
       * 这是「屏上一直没有爆点」的解 —— 每分钟一次明确的「钱进来了」。
       * 是一次性衰减而不是明暗循环，所以不触规格 §4.4 的闪烁禁令。 */
      if (i === 0) {
        var hot = pr.hot * ease;
        /* 标记条和高亮都跟着 ox 走 —— 否则入场那 400ms 里标记条钉在左边、
         * 行体在右边，屏上读成「一道竖线和一行字断开了」，像渲染出错。 */
        ctx.fillStyle = pr.big ? C.red : C.amber;
        ctx.fillRect(MAIN_X + ox, y, 3, PRINT_H);
        ctx.save();
        ctx.globalAlpha = (0.10 + 0.26 * hot) * ease;
        ctx.fillStyle = pr.big ? C.red : (hot > 0.45 ? '#FFF0D0' : C.amber);
        ctx.fillRect(MAIN_X + ox + 3, y, MAIN_W - ox - 3, PRINT_H);
        ctx.restore();
      }
    }
    drawBanner(dtMs);

    /* ── 右栏 ─────────────────────────────────────────────────── */
    drawMap(dtMs);
    drawPlatforms();

    /* ── 市场墙面板 ───────────────────────────────────────────── */
    panel(PAD, MKT_PANEL_Y, INNER_W, MKT_PANEL_H, {
      title: '按市场', sub: '今日 AI 引荐成交额（美元）', barH: 32,
      accent: C.cyan, titleColor: '#DCDCDC'
    });
    /* 图例：一行说清 6 个格子分别是谁，格子里就不必再放市场名。
     * 「代码看不懂」用图例解决，不靠把 US 翻成「美国」塞进格子（宽度不够）。 */
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'right';
    ctx.font = '400 14px ' + CN;
    ctx.fillStyle = '#6E6E6E';
    ctx.fillText('US 美国　GB 英国　DE 德国　FR 法国　CA 加拿大　OTH 其他 13 个市场',
                 W - PAD - 18, MKT_PANEL_Y + 22);
    ctx.textAlign = 'left';

    for (i = 0; i < cells.length; i++) {
      var cc = cells[i];
      if (cc.dirty) { paintCell(cc); cc.dirty = false; }
      ctx.drawImage(cc.cv, cc.x, cc.y);
      if (cc.flash > 0) {
        var k = cc.flash / 560;
        var puls = Math.sin(k * Math.PI * 4) * 0.5 + 0.5;
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.20 + 0.55 * puls * k).toFixed(3) + ')';
        ctx.lineWidth = 2;
        ctx.strokeRect(cc.x + 1, cc.y + 1, MKT_W - 2, MKT_H - 2);
      } else if (cc.fresh < 9000) {
        ctx.strokeStyle = 'rgba(42,168,192,' + (0.55 * (1 - cc.fresh / 9000)).toFixed(3) + ')';
        ctx.lineWidth = 2;
        ctx.strokeRect(cc.x + 1, cc.y + 1, MKT_W - 2, MKT_H - 2);
      }
    }

    drawMilestoneOverlay();

    var d = new Date(E.now() + 8 * 3600000);
    var cs = ('0' + d.getUTCHours()).slice(-2) + ':' +
             ('0' + d.getUTCMinutes()).slice(-2) + ':' +
             ('0' + d.getUTCSeconds()).slice(-2) + ' UTC+8';
    if (cs !== lastClock) { lastClock = cs; el('clock').textContent = cs; }

    fpsTick(dtMs);
    requestAnimationFrame(frame);
  }

  /* =====================================================================
   * 十三、FPS 自监控
   * ===================================================================== */
  var fpsAcc = 0, fpsN = 0, fpsAvg = 60, fpsWarn = 0;
  function fpsTick(dt) {
    fpsAcc += dt; fpsN++;
    if (fpsAcc < 1000) return;
    var fps = fpsN * 1000 / fpsAcc;
    fpsAvg = fpsAvg * 0.8 + fps * 0.2;
    fpsAcc = 0; fpsN = 0;
    root.APDiag = { fps: fps, fpsAvg: fpsAvg, sprites: SPR.size,
                    prints: prints.length, pings: pingsO.length + pingsC.length };
    if (fpsAvg < 40 && Date.now() - fpsWarn > 30000) {
      fpsWarn = Date.now();
      console.warn('[AP C-LED-CN] 平均帧率偏低：' + fpsAvg.toFixed(1) + ' fps');
    }
  }

  /* =====================================================================
   * 十四、外壳
   * ===================================================================== */
  function el(id) { return doc.getElementById(id); }
  var stage = el('stage');
  function fit() {
    var s = Math.min(root.innerWidth / W, root.innerHeight / H);
    stage.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
  }

  var gridOn = false, ambientOn = false, hallOn = false;
  function buildGrid() {
    var d = el('dbg'), i, e;
    d.textContent = '';
    for (i = 0; i <= 12; i++) {
      e = doc.createElement('div'); e.className = 'v';
      e.style.left = Math.round(PAD + INNER_W / 12 * i) + 'px';
      d.appendChild(e);
    }
    var ys = [TAPE_Y, TAPE_Y + TAPE_H, HERO_Y, HERO_Y + HERO_H,
              PR_PANEL_Y, PRINT_Y, PRINT_Y + PRINT_N * PRINT_H,
              MAP_Y, MAP_Y + MAP_H, PLAT_Y, PLAT_Y + PLAT_H,
              MKT_PANEL_Y, MKT_Y, MKT_Y + MKT_H, 988];
    for (i = 0; i < ys.length; i++) {
      e = doc.createElement('div'); e.className = 'h';
      e.style.top = ys[i] + 'px'; d.appendChild(e);
    }
    e = doc.createElement('div'); e.className = 'safe'; d.appendChild(e);
    e = doc.createElement('div'); e.className = 'mid'; d.appendChild(e);
  }
  function applyGrid() { el('dbg').classList.toggle('on', gridOn); }

  function status() {
    var s = [];
    if (E.paused) s.push('暂停');
    if (A.muted) s.push('静音');
    if (E.speed !== 1) s.push('速率 ×' + E.speed);
    if (hallOn) s.push('展馆模式');
    if (heroSession) s.push('主数字＝本场');
    var e = el('status');
    e.textContent = s.join('　·　');
    e.style.opacity = s.length ? '1' : '0';
  }

  function onKey(ev) {
    var k = ev.key || '', u = k.toUpperCase();
    if (k === ' ' || k === 'Spacebar') {
      E.togglePause(); A.blip(); ev.preventDefault(); status(); return;
    }
    switch (u) {
      /* 只入队，不在这里处理 —— triggerOrder 进引擎队列，下一帧 pollOrders
       * 还会返回同一笔；直接处理会打印两遍、音也响两遍。
       *
       * B 是 BD 讲到关键处按的「给客户看一笔大单」键，必须每次都出大单。
       * 不带参数的 triggerOrder() 走引擎的 forceBig，中位数 ≈ $310，而 epic 的
       * 门槛正好是 $300 —— 于是约一半的按键出来的是普通单（实测按出过 $298.72，
       * 屏上是琥珀不是红，横幅也不响）。这里显式给一个金额区间：
       * 460~1280，必定 ≥ epic（红行 + 地图红点），约四成越过 $792 触发大额横幅。 */
      case 'B': E.triggerOrder({ usd: E.demoAmount('legendary', demoSeq++) }); break;
      case 'N': E.triggerOrder({ usd: E.demoAmount('common', demoSeq++) }); break;
      case 'K': celebrate({ metric: 'crawls',
                  value: Math.floor(E.metrics().crawls / E.CONFIG.MILESTONE_CRAWLS) *
                         E.CONFIG.MILESTONE_CRAWLS }); break;
      case 'M': A.toggleMute(); status(); break;
      case 'A': ambientOn = !ambientOn; A.setAmbient(ambientOn); break;
      case 'H': hallOn = !hallOn; A.setHallMode(hallOn); A.blip(); status(); break;
      case '1': E.setSpeed(0.5); status(); break;
      case '2': E.setSpeed(1); status(); break;
      case '3': E.setSpeed(3); status(); break;
      case 'G': gridOn = !gridOn; applyGrid(); break;
      case 'F':
        if (doc.fullscreenElement) doc.exitFullscreen();
        else if (doc.documentElement.requestFullscreen) doc.documentElement.requestFullscreen();
        break;
      case 'R': reset(); break;
      default:
        if (k === '?' || k === '/') el('legend').classList.toggle('on');
    }
  }

  function reset() {
    E.init();
    var m = E.metrics();
    prints.length = 0; floats.length = 0; banner = null;
    tape.length = 0; tapeX = 0;
    pingsO.length = 0; pingsC.length = 0;
    gmvTarget = m.gmv; gmvShown = m.gmv;
    for (var i = 0; i < cells.length; i++) {
      cells[i].flash = 0; cells[i].fresh = 1e9; cells[i].scr = null;
    }
    seedCells(m);
    prefillPrints();
    A.blip();
  }

  /* ---------------------------------------------------------------------
   * 预铺成交流 —— 第三版真实缺陷的修复处
   * ---------------------------------------------------------------------
   * 不能用 E.peekOrders()：那是**未来**单，为了上屏得把时间戳改写成过去，
   * 而真实时间走到时同一笔又会从 pollOrders 进来一次，屏上就出现两条一模一样
   * 的成交（第三版截图里 9 行有 4 对重复）。
   * 这里改成用**独立种子空间**（900000+）自己合成，与引擎订单流永不相交
   * —— 跟 synthCrawl() 给跑马灯铺底是同一个手法。
   * 汇率不在引擎的导出里，所以从 peek 到的真实单反推，保证金额换算口径一致。
   * ------------------------------------------------------------------- */
  function prefillPrints() {
    var sample = E.peekOrders(24), rate = {}, i, o;
    for (i = 0; i < sample.length; i++) {
      o = sample[i];
      if (o.usd > 0) rate[o.currency] = o.amount / o.usd;
    }
    var refs = E.REFERRERS, wTot = 0;
    for (i = 0; i < refs.length; i++) wTot += refs[i].w;

    var nowMs = E.now(), rows = [], acc = 0;
    for (i = 0; i < PRINT_N; i++) {
      /* 累加间隔而不是 i * 间隔 —— 后者带抖动后相邻行会前后穿插，时间列就乱了 */
      acc += 42000 + Math.floor(E.hash32(910000 + i, 91) * 34000);   /* 42~76 秒 */
      rows.push({ off: acc, seed: 900000 + i * 137 });
    }
    /* rows[0] 最新、rows[N-1] 最旧；pushPrint 是 unshift，要先推最旧的 */
    for (i = rows.length - 1; i >= 0; i--) {
      var seed = rows[i].seed;
      var usd = E.sampleAmount(seed, false);
      var st = E.makeStore(Math.floor(E.hash32(seed, 1013) * E.CONFIG.STORES));
      /* 汇率表里没这个币种就换一家有的店，避免金额口径跟引擎不一致 */
      var guard = 0;
      while (!rate[st.currency] && guard < 40) {
        guard++;
        st = E.makeStore(Math.floor(E.hash32(seed + guard * 7919, 1013) * E.CONFIG.STORES));
      }
      var pick = E.hash32(seed, 331) * wTot, ref = refs[0], accW = 0, j;
      for (j = 0; j < refs.length; j++) {
        accW += refs[j].w;
        if (pick <= accW) { ref = refs[j]; break; }
      }
      pushPrint({
        id: 'pre-' + i,
        t: nowMs - rows[i].off,
        usd: usd, amount: usd * (rate[st.currency] || 1),
        currency: st.currency, locale: st.locale,
        tier: E.rarity(usd), store: st,
        referrer: ref.host, platform: ref.platform
      });
    }
    for (i = 0; i < prints.length; i++) { prints[i].anim = 1; prints[i].hot = 0; }
  }

  function boot() {
    cv = el('board');
    ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;      /* 灯珠是硬边的，不要插值 */

    E.init();
    var m = E.metrics(), i;

    fieldMkt = bakeField(MKT_W - 20, MKT_H - 20, MK_PITCH, MK_DOT);
    fieldTape = bakeField(INNER_W - TAPE_TAB_W - 15, TAPE_H - 12, TAPE_PITCH, TAPE_DOT);
    fieldPrint = bakeField(MAIN_W - 24, PRINT_H - 12, PR_PITCH, PR_DOT);
    bakeMap();
    buildPlatRows();

    var list = MAIN_MKT.concat(['OTHER']);
    for (i = 0; i < list.length; i++) {
      var c = makeCell(i, list[i]);
      cells.push(c);
      if (list[i] === 'OTHER') otherCell = c; else cellByCC[list[i]] = c;
    }
    seedCells(m);
    gmvTarget = m.gmv; gmvShown = m.gmv;

    var boot0 = [];
    for (i = 0; i < 16; i++) boot0.push(synthCrawl());
    feedTape(boot0);
    prefillPrints();

    buildGrid();
    if (/(?:\?|&)debug=grid(?:&|$)/.test(root.location.search)) { gridOn = true; applyGrid(); }
    fit();
    root.addEventListener('resize', fit);

    var gate = el('gate');
    function enter() {
      A.unlock(); A.setVoiceLang('zh-CN'); A.selfTest();
      gate.classList.add('off');
    }
    gate.addEventListener('click', enter);
    root.addEventListener('keydown', function (ev) {
      if (!gate.classList.contains('off')) { enter(); return; }
      onKey(ev);
    });

    status();
    requestAnimationFrame(frame);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
