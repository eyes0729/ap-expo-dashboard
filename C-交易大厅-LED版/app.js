/* ===========================================================================
 * AP 展会大屏 · 方案 C-LED「交易大厅」· 成交流版
 * ---------------------------------------------------------------------------
 * 与 C-交易大厅（暖墨陶土 / split-flap 长表）是**平行版本**，不是替代。
 * 参考图见 ../../参考-交易大厅/（03 东京电子报价板 是主要依据）。
 *
 * ── 第三版：清晰、简洁、成交流当主角 ───────────────────────────────────
 * 第二版把「报价」和「成交」分开了，但太密、层级不清。这一版做了三件减法：
 *
 *   1) **删掉整条仪表区**。原来那 5 个指标占了一整条横条，现在折进两个主数字
 *      下面的副行 —— 少一层横条，密度立刻降下来。
 *   2) **市场墙从 18 格砍到 6 格**（5 个主要市场 + 「其他」聚合），单行，格子更大。
 *      第 6 格是聚合桶，所以每一笔成交仍然必定命中某一格，墙依旧是活的，
 *      而且 6 格加起来 = 主数字的成交额，账是平的。
 *   3) **成交流 3 行 -> 9 行，并加一行表头**。「分不清谁是谁」最直接的解法就是
 *      给表加表头（时间/代码/店铺/市场/金额/来源/规模）。
 *
 * 另外把两个主数字**左右换位**：成交额放左边（第一阅读位），爬虫数退到右边。
 * 用位置表达「成交是主角」，而不是靠字号打架。
 *
 * ── 报价 ≠ 成交（第二版立起来的分工，保留）─────────────────────────────
 *   报价 = 持续跳动的价格，是环境噪音；成交 = 真正的交易，tape 印的就是它。
 *   A 层 市场墙（环境）：每格 = 一个市场今日累计成交额，只涨不跌。
 *   B 层 成交流（事件）：逐笔打印，从右侧推入 + 成交量条。这一层是主角。
 *
 * ── 亮度 ───────────────────────────────────────────────────────────
 *   真实报价墙每一格永远满亮度。「刚跳动」靠外框闪来表达，不靠把别人调暗。
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

  var C = {
    bg: '#000000', bezel: '#0C0C0C', edge: '#1A1710',
    amber: '#FFB020', green: '#35D06A', red: '#FF3B30',
    white: '#F2F2F2', dim: '#5E5E5E', label: '#8A6A2A'
  };
  var OFFDOT = 'rgba(255,176,32,0.040)';

  /* ---------- 版面（自上而下，留白比第二版大一档） ---------- */
  var TAPE_Y = 88, TAPE_H = 42;

  var HERO_LB_Y = 150;                 /* 主数字标签基线 */
  var HERO_Y = 158;                    /* 主数字灯珠区顶 */
  var HERO_PITCH = 7, HERO_DOT = 5.0, HERO_FPX = 15;
  var HERO_SUB_Y = 296;                /* 副行基线 */
  var GMV_X = PAD;                     /* 成交额在左 —— 第一阅读位 */
  var CRAWL_RIGHT = W - PAD;           /* 爬虫数右对齐 */

  var PR_LABEL_Y = 318;                /* 「成交流」区块标题基线 */
  var PR_HEAD_Y = 348;                 /* 表头基线 */
  var PR_HAIR_Y = 356;
  var PRINT_Y = 364, PRINT_H = 46, PRINT_N = 10;  /* 364..824 —— 垂直预算倒着算：
                                                   * 公开数据铭牌去掉后，页脚在 988，
                                                   * 市场格收在 962，成交流可以到 824 */

  var MKT_LABEL_Y = 852;
  var MKT_Y = 862, MKT_H = 100, MKT_COLS = 6, MKT_GAP = 6;
  var MKT_W = Math.floor((INNER_W - (MKT_COLS - 1) * MKT_GAP) / MKT_COLS);  /* 296 */

  /* 灯珠填充率约 63%（真实 LED 的珠子更小、缝更大，亮点才离散清晰） */
  var MK_PITCH = 3, MK_DOT = 1.9, MK_FPX = 15;      /* 市场格：国家码 */
  var MK_AMT_PITCH = 2.8, MK_AMT_FPX = 14;          /* 市场格：金额（格子只有 96px 高） */
  var META_PITCH = 2, META_DOT = 1.35, META_FPX = 12;
  var PR_PITCH = 2.2, PR_DOT = 1.5, PR_FPX = 14;    /* 成交流正文 */
  var PR_AMT_PITCH = 2.4, PR_AMT_DOT = 1.7, PR_AMT_FPX = 16;

  /* 成交流列位（行内坐标，行宽 = INNER_W） */
  /* 列位按最坏情况算出来的，不是估的：
   *   时间 "12:45:11" 8 字符 x 10 灯 x 2.2 = 176px -> 代码列必须 >= 200
   *   店铺名截断到 20 字符，约 400px -> 市场列必须 >= 332+400 = 732
   * 原来代码列放在 178，时间直接压上去（截图里是 "12:45:11HAFO"）。 */
  var COL = { t: 16, code: 212, store: 332, mkt: 800, cur: 892, amt: 1150,
              src: 1196, bar: 1330 };
  var STORE_MAX = 20;
  var BAR_MAX = INNER_W - COL.bar - 16;

  var cv, ctx;

  /* =====================================================================
   * 一、底纹 / 精灵图 / 等宽点阵数字
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
  var SRC_CODE = {
    'chatgpt.com': 'GPT', 'perplexity.ai': 'PPLX', 'claude.ai': 'CLDE',
    'gemini.google.com': 'GEM', 'copilot.microsoft.com': 'CPLT'
  };

  /* =====================================================================
   * 二、A 层：市场墙（6 格）
   * ---------------------------------------------------------------------
   * 5 个主要市场 + 第 6 格「其他」聚合。为什么要有聚合桶：
   * 只放 5 个市场的话，剩下 13 个市场的成交点不亮任何格子，墙会时不时僵住；
   * 有了聚合桶，每一笔成交必定命中某一格，而且 6 格相加 = 主数字的成交额，账是平的。
   * ===================================================================== */
  var MAIN_MKT = ['US', 'GB', 'DE', 'FR', 'CA'];
  var MKT_LABEL = { US: 'UNITED STATES', GB: 'UNITED KINGDOM', DE: 'GERMANY',
                    FR: 'FRANCE', CA: 'CANADA', OTHER: 'OTHER 13 MARKETS' };
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
    g.fillStyle = C.bezel;
    g.fillRect(0, 0, MKT_W, MKT_H);
    g.strokeStyle = C.edge; g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, MKT_W - 1, MKT_H - 1);
    if (fieldMkt) g.drawImage(fieldMkt, 10, 10);

    var cc = c.scr ? c.scr.cc : (c.cc === 'OTHER' ? 'OTH' : c.cc);
    var amt = c.scr ? c.scr.amt : num(c.gmv, 0);
    var cnt = c.scr ? c.scr.n : (num(c.n, 0) + ' 笔');

    /* L1 左：国家码（白，大）　L1 右：笔数（绿） */
    drawFixed(g, cc, 16, 8, MK_PITCH, MK_DOT, MK_FPX, C.white, false);
    var ns = sprite(cnt, META_PITCH, META_DOT, META_FPX, C.green, false);
    g.drawImage(ns.cv, MKT_W - 16 - ns.w, 16);

    /* L2：该市场今日累计成交额（美元，琥珀，右对齐） */
    var ap = fitPitch(amt, MK_AMT_FPX, MKT_W - 60, [MK_AMT_PITCH, 2.5, 2.1]);
    var aw = fixedWidth(amt, ap, MK_AMT_FPX);
    drawFixed(g, amt, MKT_W - 16 - aw, 46, ap, 1.8, MK_AMT_FPX, C.amber, false);
    var $s = sprite("$", META_PITCH, META_DOT, META_FPX + 2, C.label, false);
    g.drawImage($s.cv, Math.max(14, MKT_W - 16 - aw - $s.w - 8), 54);
  }

  /* =====================================================================
   * 三、B 层：成交流（主角，9 行 + 表头）
   * ===================================================================== */
  var prints = [];

  function makePrint(o, idx) {
    var big = E.TIER_RANK[o.tier] >= E.TIER_RANK.epic;
    var c = doc.createElement('canvas');
    c.width = INNER_W; c.height = PRINT_H;
    var g = c.getContext('2d');

    /* 斑马底：相邻行交替，是长表格里最省事的可扫读手段 */
    g.fillStyle = big ? 'rgba(56,9,5,0.92)' : (idx % 2 ? '#0A0A0A' : '#060606');
    g.fillRect(0, 0, INNER_W, PRINT_H);
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
    if (nm.length > STORE_MAX) nm = nm.slice(0, STORE_MAX - 1) + "…";
    g.drawImage(sprite(nm, PR_PITCH, PR_DOT, PR_FPX, sub, false).cv, COL.store, ty + 2);
    g.drawImage(sprite(o.store.cc, PR_PITCH, PR_DOT, PR_FPX, C.green, false).cv,
                COL.mkt, ty + 2);
    g.drawImage(sprite(o.currency, PR_PITCH, PR_DOT, PR_FPX, C.green, false).cv,
                COL.cur, ty + 2);

    /* 金额：本地币种、右对齐、比其他列大一档 —— 这一行的主角 */
    var astr = amtStr(o);
    var aw = fixedWidth(astr, PR_AMT_PITCH, PR_AMT_FPX);
    drawFixed(g, astr, COL.amt - aw, 2, PR_AMT_PITCH, PR_AMT_DOT,
              PR_AMT_FPX, main, false);

    g.drawImage(sprite(SRC_CODE[o.referrer] || 'AI', PR_PITCH, PR_DOT, PR_FPX,
                       C.green, false).cv, COL.src, ty + 2);

    /* 规模条：长度 ∝ 金额（对数刻度），一眼比出这一笔多大 */
    var frac = Math.min(1, Math.log(1 + o.usd) / Math.log(1 + 2500));
    var bw = Math.max(6, Math.round(BAR_MAX * frac));
    g.fillStyle = '#1E1607';
    g.fillRect(COL.bar, PRINT_H / 2 - 3, BAR_MAX, 6);
    g.fillStyle = big ? C.red : C.amber;
    g.fillRect(COL.bar, PRINT_H / 2 - 3, bw, 6);

    /* 左侧标记条：大额红、其余琥珀（最新那一行由主循环额外加亮） */
    g.fillStyle = big ? C.red : '#3A2A0C';
    g.fillRect(0, 0, 3, PRINT_H);

    return { cv: c, anim: 0, big: big, usd: o.usd };
  }

  function pushPrint(o) {
    prints.unshift(makePrint(o, 0));
    if (prints.length > PRINT_N) prints.length = PRINT_N;
    /* 斑马条纹跟行号绑定，插入后需要重绘一次（9 行，一分钟一次，代价可忽略） */
    for (var i = 1; i < prints.length; i++) {
      if (prints[i].zebra !== i % 2) { prints[i].zebra = i % 2; }
    }
  }

  function drawPrintHeader() {
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 20px ' + CN;
    ctx.fillStyle = C.white;
    ctx.fillText('成交流', PAD, PR_LABEL_Y);
    ctx.font = '600 15px ' + MONO;
    ctx.fillStyle = C.label;
    ctx.fillText('TRADE PRINTS · 逐笔 AI 引荐成交', PAD + 76, PR_LABEL_Y);

    /* 右侧：平台占比（原来单独占一条横条，现在收成一行小字） */
    var pf = E.platformBreakdown();
    var SHORT = { ChatGPT: 'GPT', Claude: 'CLD', Google: 'GGL',
                  Perplexity: 'PPX', Others: 'OTH' };
    var cols = [C.amber, '#D9931B', '#A87014', C.green, '#2E5A3A'];
    ctx.font = '600 13px ' + MONO;
    var parts = [], k;
    for (k = 0; k < pf.length; k++) {
      parts.push((SHORT[pf[k].platform] || '') + ' ' + Math.round(pf[k].share * 100));
    }
    var tw = 0;
    for (k = 0; k < parts.length; k++) tw += ctx.measureText(parts[k]).width + 26;
    var tx = W - PAD - tw;
    ctx.fillStyle = C.label;
    ctx.fillText('平台占比', tx - 74, PR_LABEL_Y);
    for (k = 0; k < parts.length; k++) {
      ctx.fillStyle = cols[k];
      ctx.fillRect(tx, PR_LABEL_Y - 9, 9, 9);
      ctx.fillStyle = '#8E8E8E';
      ctx.fillText(parts[k], tx + 14, PR_LABEL_Y);
      tx += ctx.measureText(parts[k]).width + 26;
    }

    /* 表头 —— 「分不清谁是谁」最直接的解法 */
    var head = [
      [COL.t, '时间 TIME', 0], [COL.code, '代码 CODE', 0],
      [COL.store, '店铺 STORE', 0], [COL.mkt, '市场 MKT', 0],
      [COL.cur, '币种 CUR', 0], [COL.amt, '金额 AMOUNT', 1],
      [COL.src, '来源 SOURCE', 0], [COL.bar, '规模 SIZE', 0]
    ];
    ctx.font = '600 13px ' + MONO;
    ctx.fillStyle = '#6E5A2E';
    for (var i = 0; i < head.length; i++) {
      var x = PAD + head[i][0];
      if (head[i][2]) {
        var w = ctx.measureText(head[i][1]).width;
        ctx.fillText(head[i][1], x - w, PR_HEAD_Y);
      } else {
        ctx.fillText(head[i][1], x, PR_HEAD_Y);
      }
    }
    ctx.strokeStyle = C.edge; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, PR_HAIR_Y + 0.5); ctx.lineTo(W - PAD, PR_HAIR_Y + 0.5);
    ctx.stroke();
  }

  /* =====================================================================
   * 四、双主角（成交额在左 = 第一阅读位）
   * ===================================================================== */
  var heroSession = /(?:\?|&)hero=session(?:&|$)/.test(root.location.search);
  var gmvShown = 0, gmvTarget = 0;
  var floats = [];

  function drawHero(m) {
    ctx.textBaseline = 'alphabetic';

    /* 左：AI 引荐累计成交额 —— 一分钟跳一次，但它讲的是「钱进来了」 */
    var gs = '$' + num(Math.floor(gmvShown), 0);
    ctx.font = '700 21px ' + CN;
    ctx.fillStyle = C.white;
    ctx.fillText('AI 引荐累计成交额', GMV_X, HERO_LB_Y);
    ctx.font = '600 15px ' + MONO;
    ctx.fillStyle = C.label;
    ctx.fillText('CUMULATIVE AI-REFERRED GMV', GMV_X + 200, HERO_LB_Y);
    drawFixed(ctx, gs, GMV_X, HERO_Y, HERO_PITCH, HERO_DOT, HERO_FPX, C.amber, true);
    ctx.font = '600 16px ' + MONO;
    ctx.fillStyle = '#8E8E8E';
    ctx.fillText('今日 +$' + num(Math.round(m.session.gmv), 0) +
                 '   ·   ' + E.fmtInt(m.session.orders) + ' 笔' +
                 '   ·   平均每 ' + Math.round(m.secondsPerOrder) + ' 秒一笔',
                 GMV_X + 2, HERO_SUB_Y);

    /* 右：AI 爬虫累计访问 —— 40/秒，负责「一直在动」 */
    var v = heroSession ? m.session.crawls : m.crawls;
    var cs = E.fmtInt(v);
    var cw = fixedWidth(cs, HERO_PITCH, HERO_FPX);
    var cx = CRAWL_RIGHT - cw;
    ctx.font = '700 21px ' + CN;
    ctx.fillStyle = '#C8C8C8';
    var t1 = heroSession ? '本场 AI 爬虫访问' : 'AI 爬虫累计访问';
    ctx.fillText(t1, cx, HERO_LB_Y);
    ctx.font = '600 15px ' + MONO;
    ctx.fillStyle = C.label;
    ctx.fillText('CUMULATIVE AI CRAWLS', cx + 178, HERO_LB_Y);
    drawFixed(ctx, cs, cx, HERO_Y, HERO_PITCH, HERO_DOT, HERO_FPX, '#C98F1E', true);
    ctx.font = '600 16px ' + MONO;
    ctx.fillStyle = '#7E7E7E';
    var sub2 = m.crawlsPerSec.toFixed(1) + ' 次/秒   ·   ' +
               E.fmtInt(m.pages) + ' 个 AP 页面已被 AI 收录';
    var sw = ctx.measureText(sub2).width;
    ctx.fillText(sub2, CRAWL_RIGHT - sw, HERO_SUB_Y);
  }

  function drawFloats(dtS) {
    for (var i = floats.length - 1; i >= 0; i--) {
      var f = floats[i];
      f.t += dtS;
      if (f.t > 1.6) { floats.splice(i, 1); continue; }
      var k = f.t / 1.6;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (1 - k) * 2.2);
      var s = sprite(f.txt, 2.6, 1.8, 16, f.big ? '#FF6A60' : '#7CE0A0', false);
      ctx.drawImage(s.cv, GMV_X + 2, HERO_Y - 52 - Math.round(k * 46));
      ctx.restore();
    }
  }

  /* =====================================================================
   * 五、顶部跑马灯：真实爬虫日志（唯一保留的「环境噪音」）
   * ===================================================================== */
  var tape = [], tapeX = 0, TAPE_SPEED = 76;
  var TAPE_PITCH = 2.6, TAPE_DOT = 1.8, TAPE_FPX = 11;
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
      dcCity: dc.city, path: pt.path + String(store.name).toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').slice(0, 26),
      status: E.hash32(seed, 1301) > 0.02 ? 200 : 304,
      ms: 40 + Math.floor(E.hash32(seed, 1307) * 260)
    };
  }
  function feedTape(list) {
    for (var i = 0; i < list.length && tape.length < 40; i++) {
      var cr = list[i];
      var txt = '·   ' + cr.bot + '  ' + cr.ip + '  ' + cr.asn.toUpperCase() +
                '  ' + cr.dcCity.toUpperCase() + '  ' + cr.path + '  ' +
                cr.status + '  ' + cr.ms + 'MS';
      tape.push({ s: sprite(txt, TAPE_PITCH, TAPE_DOT, TAPE_FPX,
                  cr.platform === 'ChatGPT' ? '#C98F1E' : '#2C9E52', false) });
    }
    for (i = 0; i < tape.length; i++) if (!tape[i].w) tape[i].w = tape[i].s.w + 54;
  }
  function drawTape(dtS) {
    var g = ctx;
    g.fillStyle = C.bezel;
    g.fillRect(PAD, TAPE_Y, INNER_W, TAPE_H);
    g.strokeStyle = C.edge; g.lineWidth = 1;
    g.strokeRect(PAD + 0.5, TAPE_Y + 0.5, INNER_W - 1, TAPE_H - 1);
    if (fieldTape) g.drawImage(fieldTape, PAD + 7, TAPE_Y + 6);

    if (!E.paused) tapeX -= TAPE_SPEED * dtS * E.speed;
    g.save();
    g.beginPath();
    g.rect(PAD + 7, TAPE_Y + 6, INNER_W - 14, TAPE_H - 12);
    g.clip();
    var x = PAD + 7 + tapeX, i = 0;
    while (i < tape.length) {
      var t = tape[i];
      if (x + t.w < PAD + 7) { tape.shift(); tapeX += t.w; x += t.w; continue; }
      if (x > W - PAD - 7) break;
      g.drawImage(t.s.cv, Math.round(x), TAPE_Y + 10);
      x += t.w; i++;
    }
    g.restore();
    if (x < W - PAD + 200) {
      var real = E.pollCrawls(14);
      while (real.length < 3) real.push(synthCrawl());
      feedTape(real);
    }
  }

  /* =====================================================================
   * 六、大额成交横幅（legendary 才有）
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
    ctx.fillRect(PAD, y0, INNER_W, hh);
    ctx.strokeStyle = C.red; ctx.lineWidth = 2;
    ctx.strokeRect(PAD + 1, y0 + 1, INNER_W - 2, hh - 2);
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 22px ' + CN;
    ctx.fillStyle = C.red;
    ctx.fillText('大额成交', PAD + 24, y0 + 34);
    ctx.font = '600 15px ' + MONO;
    ctx.fillText('LARGE PRINT', PAD + 124, y0 + 34);

    var astr = amtStr(o);
    var aw = fixedWidth(astr, 4.4, 18);
    drawFixed(ctx, astr, PAD + 24, y0 + 48, 4.4, 3.1, 18, '#FF6A60', true);
    var s1 = sprite(o.currency + '   ' + o.store.name + '   ' + o.store.cc +
                    '   ' + (SRC_CODE[o.referrer] || 'AI'),
                    2.6, 1.8, 15, '#FFB9B4', false);
    ctx.drawImage(s1.cv, PAD + 40 + aw, y0 + 62);
    ctx.restore();
  }

  /* =====================================================================
   * 七、里程碑：全屏齐翻（split-flap 的高潮感只留给它）
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
    var y0 = PR_LABEL_Y - 32, hh = (MKT_Y + MKT_H) - y0 + 8;
    ctx.save();
    ctx.globalAlpha = fade * 0.93;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, y0, W, hh);
    ctx.globalAlpha = fade;
    var METRIC = { pages: 'AP 翻译页面', crawls: 'AI 爬虫累计访问', orders: 'AI 引荐订单' };
    var str = E.fmtInt(msEv.value);
    var w = fixedWidth(str, 8, 15);
    drawFixed(ctx, str, (W - w) / 2, y0 + 190, 8, 5.8, 15, C.amber, true);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 24px ' + MONO;
    ctx.fillStyle = C.white;
    ctx.fillText('MILESTONE · 里程碑', W / 2, y0 + 152);
    ctx.font = '600 28px ' + CN;
    ctx.fillStyle = C.label;
    ctx.fillText(METRIC[msEv.metric] || msEv.metric, W / 2, y0 + 372);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  /* =====================================================================
   * 八、成交处理
   * ===================================================================== */
  function onOrder(o) {
    pushPrint(o);
    var c = cellByCC[o.store.cc] || otherCell;
    if (c) {
      c.gmv += o.usd; c.n += 1;
      c.flash = 560; c.fresh = 0; c.dirty = true;
    }
    gmvTarget += o.usd;
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
   * 九、主循环
   * ===================================================================== */
  var lastClock = '';

  function frame() {
    E.update();
    var dtMs = E.dt(), dtS = dtMs / 1000;
    var m = E.metrics();
    var i;

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
    }

    /* ---- 绘制 ---- */
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    drawTape(dtS);
    drawHero(m);
    drawFloats(dtS);
    drawPrintHeader();

    /* 成交流：最新一条在最上，从右侧推入 */
    for (i = 0; i < prints.length; i++) {
      var pr = prints[i];
      var ease = 1 - Math.pow(1 - pr.anim, 3);
      var ox = (i === 0) ? Math.round((1 - ease) * 240) : 0;
      var y = PRINT_Y + i * PRINT_H;
      ctx.save();
      ctx.globalAlpha = (i === 0) ? ease : 1;
      ctx.drawImage(pr.cv, PAD + ox, y);
      ctx.restore();
      /* 最新一行：左侧标记条加亮 + 一道横向高光，明确「这条是刚进来的」 */
      if (i === 0) {
        ctx.fillStyle = pr.big ? C.red : C.amber;
        ctx.fillRect(PAD, y, 3, PRINT_H);
        ctx.globalAlpha = 0.10 * ease;
        ctx.fillStyle = pr.big ? C.red : C.amber;
        ctx.fillRect(PAD + 3, y, INNER_W - 3, PRINT_H);
        ctx.globalAlpha = 1;
      }
    }
    drawBanner(dtMs);

    /* 市场墙 */
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 19px ' + CN;
    ctx.fillStyle = '#C8C8C8';
    ctx.fillText('按市场', PAD, MKT_LABEL_Y);
    ctx.font = '600 14px ' + MONO;
    ctx.fillStyle = C.label;
    ctx.fillText("BY MARKET · 今日 AI 引荐成交额（美元）", PAD + 66, MKT_LABEL_Y);
    /* 图例：一行说清 6 个格子分别是谁，格子里就不必再放市场名 */
    ctx.font = "600 13px " + CN;
    ctx.fillStyle = "#5E5E5E";
    var lg = "US 美国　GB 英国　DE 德国　FR 法国　CA 加拿大　OTH 其他 13 个市场";
    var lw2 = ctx.measureText(lg).width;
    ctx.fillText(lg, W - PAD - lw2, MKT_LABEL_Y);
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
        ctx.strokeStyle = 'rgba(255,176,32,' + (0.5 * (1 - cc.fresh / 9000)).toFixed(3) + ')';
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
   * 十、FPS 自监控
   * ===================================================================== */
  var fpsAcc = 0, fpsN = 0, fpsAvg = 60, fpsWarn = 0;
  function fpsTick(dt) {
    fpsAcc += dt; fpsN++;
    if (fpsAcc < 1000) return;
    var fps = fpsN * 1000 / fpsAcc;
    fpsAvg = fpsAvg * 0.8 + fps * 0.2;
    fpsAcc = 0; fpsN = 0;
    root.APDiag = { fps: fps, fpsAvg: fpsAvg, sprites: SPR.size };
    if (fpsAvg < 40 && Date.now() - fpsWarn > 30000) {
      fpsWarn = Date.now();
      console.warn('[AP C-LED] 平均帧率偏低：' + fpsAvg.toFixed(1) + ' fps');
    }
  }

  /* =====================================================================
   * 十一、外壳
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
    var ys = [TAPE_Y, TAPE_Y + TAPE_H, HERO_Y, HERO_SUB_Y, PR_HAIR_Y, PRINT_Y,
              PRINT_Y + PRINT_N * PRINT_H, MKT_Y, MKT_Y + MKT_H, 988];
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
    if (E.paused) s.push('PAUSED');
    if (A.muted) s.push('MUTED');
    if (E.speed !== 1) s.push('×' + E.speed);
    if (hallOn) s.push('HALL');
    if (heroSession) s.push('HERO=SESSION');
    var e = el('status');
    e.textContent = s.join('  ·  ');
    e.style.opacity = s.length ? '1' : '0';
  }

  function onKey(ev) {
    var k = ev.key || '', u = k.toUpperCase();
    if (k === ' ' || k === 'Spacebar') {
      E.togglePause(); A.blip(); ev.preventDefault(); status(); return;
    }
    /* 演示键的阶梯游标（见 engine.js DEMO_LADDERS） */
    switch (u) {
      /* 只入队，不在这里处理 —— triggerOrder 进引擎队列，下一帧 pollOrders
       * 还会返回同一笔；直接处理会打印两遍、音也响两遍。 */
      case 'B': E.triggerOrder(); break;
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
    gmvTarget = m.gmv; gmvShown = m.gmv;
    for (var i = 0; i < cells.length; i++) {
      cells[i].flash = 0; cells[i].fresh = 1e9; cells[i].scr = null;
    }
    seedCells(m);
    prefillPrints();
    A.blip();
  }

  /** 预铺成交流。时间戳改成过去 —— peekOrders 拿的是未来单，
   *  直接用会在板上显示比当前时钟更晚的成交时间，是个破绽。 */
  function prefillPrints() {
    var up = E.peekOrders(PRINT_N), nowMs = E.now(), i;
    for (i = up.length - 1; i >= 0; i--) {
      up[i].t = nowMs - (i + 1) * 57000;
      pushPrint(up[i]);
    }
    for (i = 0; i < prints.length; i++) prints[i].anim = 1;
  }

  function boot() {
    cv = el('board');
    ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;      /* 灯珠是硬边的，不要插值 */

    E.init();
    var m = E.metrics(), i;

    fieldMkt = bakeField(MKT_W - 20, MKT_H - 20, MK_PITCH, MK_DOT);
    fieldTape = bakeField(INNER_W - 14, TAPE_H - 12, TAPE_PITCH, TAPE_DOT);
    fieldPrint = bakeField(INNER_W - 24, PRINT_H - 12, PR_PITCH, PR_DOT);

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
