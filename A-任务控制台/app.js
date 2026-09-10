/* ===========================================================================
 * AP 展会大屏 · 方案 A「任务控制台」
 * ---------------------------------------------------------------------------
 * 参照系：Datadog / Grafana 的 NOC 墙、发射直播叠加层、彭博终端。
 * 科技感全部来自真实数据密度（真 UA 名 / 真 ASN / 真城市 / 对齐的等宽列），
 * 不来自特效。全屏没有一处发光、扫描线、粒子或渐变流动。
 *
 * 五个自建部件：
 *   Odo   —— 机械式里程表巨型数字（每位一个固定字宽槽，只动 transform）
 *   Log   —— 右侧日志流，30 行 DOM 对象池循环复用，永不 append/remove
 *   Map   —— 2D 世界点阵地图（等距圆柱投影），静态图层启动时烘到离屏 canvas
 *   Deck  —— 订单事件卡，10 个 DOM 对象池
 *   Cel   —— 里程碑全屏庆祝
 *
 * 所有随机走 APEngine.hash32，所有动画步长走 APEngine.dt()。
 * classic script，零网络依赖。
 * ======================================================================== */
(function (root) {
  'use strict';

  var doc = document;
  function $(id) { return doc.getElementById(id); }
  function mk(tag, cls) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }
  function sub(parent, tag, cls) { var e = mk(tag, cls); parent.appendChild(e); return e; }

  /* ---------------------------------------------------------------- 常量 */
  var H_BASE = 1080, W_BASE = 1920, W_MAX = 2560;
  var TZ_H = 8;                 /* 大屏时区锁死 UTC+8，与引擎 T0 口径一致 */
  var CRAWL_RATE = 8;           /* 日志流展示速率：8 条/秒 */
  var LOG_ROWS = 30;            /* 日志对象池行数（规格要求 26~30 固定） */
  /* 日志栏宽度占比。这是本方案唯一的「主角字号 ↔ 日志可读性」旋钮：
   * 调小 → 巨型数字变大、日志 path 列变短。彩排时可用 ?log=32 现场对比。 */
  var LOG_RATIO = 0.38;
  var ORD_POOL = 10, ORD_VIS = 3, ORD_H = 36, ORD_GAP = 6;
  var TAU = Math.PI * 2;
  var POW10 = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10];

  /* 日志列宽（ch）。path 走 flex 吃掉剩余宽度。 */
  var CW = { time: 13, bot: 20, ip: 12, asn: 17, st: 4, by: 9, ms: 7 };
  var CW_FIXED = CW.time + CW.bot + CW.ip + CW.asn + CW.st + CW.by + CW.ms;

  var PF_COLOR = {
    ChatGPT: '#00D3A7', Claude: '#4FC9C4', Google: '#2FBE8C',
    Perplexity: '#5CCFDE', Others: '#6E7C82'
  };

  /* 公开研究数据（规格 7.4 白名单）。必须走浅底卡片，与深底模拟数字分区。 */
  var PUB = [
    { t: '美国零售站的商品详情页，AI 可读性平均只有 <b>66%</b>', s: '公开研究 · adobe.com' },
    { t: 'AI 引荐访客的转化率是传统自然搜索的 <b>1.42×</b>', s: '公开研究 · adobe.com · 2026-03' },
    { t: 'AI 引荐订单一年涨近 <b>13×</b>，客单价高 <b>14%</b>', s: '公开研究 · shopify.com · Q1 2026' }
  ];

  /* ------------------------------------------------------------ 小工具 */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  /* 近似 cubic-bezier(.16,1,.3,1)：强 easeOut，导数在终点为 0，无回弹 */
  function easeOutSoft(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3.2); }
  /* 近似 cubic-bezier(.4,0,1,1)：慢进快退 */
  function easeInQuad(t) { t = clamp(t, 0, 1); return t * t; }
  function p2(n) { return n < 10 ? '0' + n : '' + n; }
  function p3(n) { return n < 10 ? '00' + n : (n < 100 ? '0' + n : '' + n); }
  function digitCount(n) {
    n = Math.floor(n); var c = 1;
    while (n >= 10) { n = Math.floor(n / 10); c++; }
    return c;
  }
  function groupPattern(n) {
    var s = '';
    for (var i = n; i >= 1; i--) { s += '0'; if (i > 1 && (i - 1) % 3 === 0) s += ','; }
    return s;
  }
  function hhmmssms(t) {
    var d = new Date(t + TZ_H * 3600000);
    return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' +
           p2(d.getUTCSeconds()) + '.' + p3(d.getUTCMilliseconds());
  }
  function kb(bytes) { return (bytes / 1024).toFixed(1) + 'kB'; }
  function clip(s, n) { return s.length <= n ? s : s.slice(0, n - 1) + '…'; }
  function getVar(name) {
    return getComputedStyle(doc.documentElement).getPropertyValue(name).trim();
  }

  /* 文本量宽探针。挂在 body 上（stage 之外），所以读到的是未被 scale 影响的设计像素。 */
  var probe = mk('span');
  probe.style.cssText = 'position:fixed;left:-99999px;top:0;white-space:pre;' +
    'visibility:hidden;font-variant-numeric:tabular-nums;' +
    'font-feature-settings:"tnum" 1,"lnum" 1;';
  doc.body.appendChild(probe);
  function measureText(text, family, px, weight) {
    probe.style.fontFamily = family;
    probe.style.fontSize = px + 'px';
    probe.style.fontWeight = weight;
    probe.textContent = text;
    return probe.getBoundingClientRect().width;
  }

  /* 数字在 line-height:1em 槽里的光学居中补偿。启动时算一次，不进 rAF。 */
  var metricCv = mk('canvas'), metricCtx = metricCv.getContext('2d');
  function inkShift(family, px, weight) {
    try {
      metricCtx.font = weight + ' ' + px + 'px ' + family;
      metricCtx.textBaseline = 'alphabetic';
      var m = metricCtx.measureText('0');
      if (typeof m.fontBoundingBoxAscent !== 'number' ||
          typeof m.actualBoundingBoxAscent !== 'number') return 0;
      var baseline = (px - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 +
                     m.fontBoundingBoxAscent;
      var inkCenter = baseline + (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2;
      return px / 2 - inkCenter;
    } catch (e) { return 0; }
  }

  /* =====================================================================
   * Odo —— 机械式里程表
   * ---------------------------------------------------------------------
   * 四条硬规则怎么落实的：
   *   1) 每位一个 width:1ch;overflow:hidden 的槽，整体 justify-content:flex-end
   *      —— 位数从 7 涨到 8 时向左生长，右侧「次 / visits」标签不动。
   *   2) 每个槽里是一条 0..9,0 的字条，改数字 = 改 translate3d，
   *      绝不每帧改 textContent（200px 字号下改文本是掉帧首因）。
   *   3) 齿轮式进位：高位只在低位走完最后 10% 时才转，且用 smoothstep（终点导数 0），
   *      单调递增、无 overshoot、绝不倒退。
   *   4) 个位每秒真实增加 42.7 次 —— 快过帧率，所以个位走连续旋转（真实的模糊），
   *      这不是假随机跳动，它携带「速率」这个信息。
   * ===================================================================== */
  function Odo(host) {
    this.host = host;
    this.strips = [];
    this.digits = 0;
    this.fontPx = 100;
    this.shift = 0;
    this.spinLow = 0;
    this.last = [];
  }
  Odo.prototype.build = function (nDigits, fontPx, shift, spinLow) {
    this.digits = nDigits;
    this.fontPx = fontPx;
    this.shift = shift || 0;
    this.spinLow = spinLow || 0;
    this.host.textContent = '';
    this.strips = [];
    this.last = [];
    /* 光学居中补偿挂在容器上，逗号跟着一起偏移，不会和数字错行 */
    this.host.style.transform = 'translate3d(0,' + this.shift.toFixed(2) + 'px,0)';
    for (var k = nDigits; k >= 1; k--) {
      var slot = sub(this.host, 'span', 'slot');
      var strip = sub(slot, 'span', 'strip');
      for (var d = 0; d <= 10; d++) {
        sub(strip, 'i', null).textContent = String(d % 10);
      }
      this.strips[k - 1] = strip;
      this.last[k - 1] = -1;
      if (k > 1 && (k - 1) % 3 === 0) {
        sub(this.host, 'span', 'sep').textContent = ',';
      }
    }
  };
  Odo.prototype.set = function (v) {
    if (!(v > 0)) v = 0;
    var F = this.fontPx, i, pos;
    for (i = 0; i < this.digits; i++) {
      var x = v / POW10[i];
      if (i < this.spinLow) {
        /* 最快的那一位：整格吸附，不做逐帧插值。
         * 原实现是连续旋转（加油机效果），动起来确实好看，但有两个实测问题：
         *   ① 每秒 48 格、60Hz 下每帧走 0.8 格，会产生走马灯式的视觉倒转
         *      —— 正好是规格 §4.2 明令禁止的"数字倒退"，且改缓动没用；
         *   ② 媒体拍照和录屏会定格在半个字形上，看起来像渲染坏了。
         * 整格跳变依然是每帧都在变，"快"的感觉不丢。 */
        pos = Math.floor(x) % 10;
      } else {
        var f = Math.floor(x), fr = x - f;
        pos = (f % 10) + (fr < 0.9 ? 0 : smoothstep((fr - 0.9) / 0.1));
      }
      if (pos === this.last[i]) continue;
      this.last[i] = pos;
      this.strips[i].style.transform =
        'translate3d(0,' + (-pos * F).toFixed(2) + 'px,0)';
    }
  };

  /* =====================================================================
   * Log —— 右侧真实日志流
   * 30 个固定 DOM 行循环复用（写 textContent + transform，永不 append/remove）。
   * 整列平滑上移：每行位置 = 底部锚点 - (连续行号 - 本行行号) * 行高。
   * ===================================================================== */
  var Log = {
    host: null, rows: [], n: 0, rh: 26, bodyH: 0,
    lines: 0, disp: 0, pathCh: 24,

    build: function (host, n, rh, bodyH) {
      this.host = host; this.n = n; this.rh = rh; this.bodyH = bodyH;
      host.textContent = '';
      this.rows = [];
      for (var i = 0; i < n; i++) {
        var r = mk('div', 'lrow');
        var c = {
          time: sub(r, 'span', 'c-time'), bot: sub(r, 'span', 'c-bot'),
          ip: sub(r, 'span', 'c-ip'), asn: sub(r, 'span', 'c-asn'),
          path: sub(r, 'span', 'c-path'), st: sub(r, 'span', 'c-st'),
          by: sub(r, 'span', 'c-by'), ms: sub(r, 'span', 'c-ms')
        };
        r.style.opacity = '0';
        host.appendChild(r);
        this.rows.push({ el: r, c: c, line: -1e9, age: 1e9, faded: true, y: NaN });
      }
      this.disp = this.lines;
    },

    header: function (host) {
      host.textContent = '';
      var L = [['c-time', 'time'], ['c-bot', 'bot'], ['c-ip', 'source ip'],
               ['c-asn', 'asn'], ['c-path', 'path'], ['c-st', 'st'],
               ['c-by', 'size'], ['c-ms', 'lat']];
      for (var i = 0; i < L.length; i++) {
        sub(host, 'span', L[i][0]).textContent = L[i][1];
      }
    },

    push: function (ev) {
      var r = this.rows[this.lines % this.n], c = r.c;
      r.line = this.lines;
      this.lines++;
      r.age = 0; r.faded = false;
      c.time.textContent = hhmmssms(ev.t);
      c.bot.textContent = ev.bot;
      c.bot.className = 'c-bot pf-' + ev.platform;
      c.ip.textContent = ev.ip;
      c.asn.textContent = ev.asn;
      c.path.textContent = clip(ev.path, this.pathCh);
      c.st.textContent = String(ev.status);
      c.by.textContent = kb(ev.bytes);
      c.ms.textContent = ev.ms + 'ms';
      r.el.className = ev.status === 304 ? 'lrow s304' : 'lrow';
    },

    frame: function (dt) {
      /* 指数趋近，时间常数 40ms：damping ratio >= 1，overshoot = 0。
       * 日志 8 条/秒 = 每 125ms 一条，而 125ms >> 40ms，所以每条新行是
       * 「120ms 内从底边滑上来 → 停在最底行等下一条」，实测底部裁切 ≈ 0px。
       * τ 调大就成了匀速跑马灯，还会把最新一行整行推到画面外 ——
       * 那恰恰是全屏最值得看的一行。 */
      var k = 1 - Math.exp(-dt / 40);
      this.disp += (this.lines - this.disp) * k;
      var base = this.bodyH - this.rh, rh = this.rh, dp = this.disp - 1;
      for (var i = 0; i < this.n; i++) {
        var r = this.rows[i];
        if (r.line < -1e8) continue;
        var y = base - (dp - r.line) * rh;
        if (y !== r.y) {
          r.y = y;
          r.el.style.transform = 'translate3d(0,' + y.toFixed(1) + 'px,0)';
        }
        if (!r.faded) {
          r.age += dt;
          if (r.age >= 320) { r.el.style.opacity = '1'; r.faded = true; }
          else { r.el.style.opacity = (0.18 + 0.82 * easeOutSoft(r.age / 320)).toFixed(3); }
        }
      }
    }
  };

  /* =====================================================================
   * Map —— 2D 世界点阵地图（背景纹理，不是 3D 地球）
   * 等距圆柱投影 x=(lon+180)/360, y=(90-lat)/180。
   * 静态点阵 + 经纬线启动时烘到离屏 canvas，rAF 里只 drawImage + 画衰减点，
   * 绝不在 rAF 里 createLinearGradient / createPattern。
   * ===================================================================== */
  var Map = {
    cv: null, ctx: null, off: null, offctx: null,
    w: 0, h: 0, ox: 0, oy: 0, mw: 0, mh: 0,
    pulses: [], pi: 0, PN: 96,

    proj: function (lat, lon) {
      return {
        x: this.ox + ((lon + 180) / 360) * this.mw,
        y: this.oy + ((90 - lat) / 180) * this.mh
      };
    },

    build: function (cv, w, h) {
      this.cv = cv; this.w = w; this.h = h;
      /* 内部分辨率 = 设计像素，不乘 devicePixelRatio（规格 2.6） */
      cv.width = w; cv.height = h;
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
      this.ctx = cv.getContext('2d');

      this.mw = w * 1.10;
      this.mh = this.mw / 2;
      this.ox = -(this.mw - w) / 2;
      this.oy = h * 0.44 - this.mh * 0.43;   /* 城市带的视觉重心对到 44% 高度 */

      if (!this.off) this.off = mk('canvas');
      this.off.width = w; this.off.height = h;
      this.offctx = this.off.getContext('2d');
      var g = this.offctx, i, j;
      g.clearRect(0, 0, w, h);

      /* 经纬线：--grid #7DD3FC，opacity .06（规格 4.1） */
      g.strokeStyle = 'rgba(125,211,252,0.06)';
      g.lineWidth = 1;
      for (i = -180; i <= 180; i += 30) {
        var a = this.proj(90, i), b = this.proj(-90, i);
        g.beginPath(); g.moveTo(a.x + 0.5, a.y); g.lineTo(b.x + 0.5, b.y); g.stroke();
      }
      for (i = -60; i <= 60; i += 30) {
        var c = this.proj(i, -180), d = this.proj(i, 180);
        g.beginPath(); g.moveTo(c.x, c.y + 0.5); g.lineTo(d.x, d.y + 0.5); g.stroke();
      }

      /* 城市点阵 + 确定性卫星点（hash32，不用 Math 随机，重启后画面一致）。
       * 卫星点让人口带连成片，大陆轮廓自然浮现，不需要任何地图数据文件。 */
      var C = root.APGeo.CITIES;
      for (i = 0; i < C.length; i++) {
        var wt = C[i][4], pt = this.proj(C[i][1], C[i][2]);
        g.fillStyle = 'rgba(75,85,99,' + (0.16 + wt * 0.020).toFixed(3) + ')';
        g.beginPath(); g.arc(pt.x, pt.y, 1.05 + wt * 0.10, 0, TAU); g.fill();
        var k = Math.min(9, 2 + Math.round(wt * 0.7));
        g.fillStyle = 'rgba(75,85,99,' + (0.07 + wt * 0.006).toFixed(3) + ')';
        for (j = 0; j < k; j++) {
          var ang = root.APEngine.hash32(i * 131 + j, 3301) * TAU;
          var rr = 2.2 + root.APEngine.hash32(i * 131 + j, 4409) * (3 + wt * 0.9);
          g.beginPath();
          g.arc(pt.x + Math.cos(ang) * rr, pt.y + Math.sin(ang) * rr, 0.95, 0, TAU);
          g.fill();
        }
      }

      if (!this.pulses.length) {
        for (i = 0; i < this.PN; i++) this.pulses.push({ x: 0, y: 0, age: 0, on: 0 });
      }
    },

    ping: function (lat, lon) {
      var pt = this.proj(lat, lon), p = this.pulses[this.pi];
      this.pi = (this.pi + 1) % this.PN;
      p.x = pt.x; p.y = pt.y; p.age = 0; p.on = 1;
    },

    frame: function (dt) {
      var g = this.ctx;
      if (!g) return;
      g.clearRect(0, 0, this.w, this.h);
      g.drawImage(this.off, 0, 0);
      for (var i = 0; i < this.PN; i++) {
        var p = this.pulses[i];
        if (!p.on) continue;
        p.age += dt;
        if (p.age >= 300) { p.on = 0; continue; }
        var a = 1 - p.age / 300;
        g.fillStyle = 'rgba(0,211,167,' + (0.80 * a * a).toFixed(3) + ')';
        g.beginPath(); g.arc(p.x, p.y, 1.6 + 1.9 * a, 0, TAU); g.fill();
      }
    }
  };

  /* =====================================================================
   * Deck —— 订单事件卡对象池（10 个 DOM，最多 4 张可见）
   * 位置用 dt 驱动的临界阻尼趋近（overshoot = 0），
   * 透明度用 JS 算曲线（入场 480ms easeOut / 退场 240ms 慢进快退）。
   * 不用 append + onComplete remove —— 掉帧时回调不执行会永久留节点。
   * ===================================================================== */
  /* 「最新一笔」大卡。所有订单都进这里，稀有度靠体量分级（64 / 76 / 84px）；
   * epic 及以上额外走一次底部横线扫过（一次性、承载稀有度信息，不是循环装饰）。
   * 下面的 Deck 降级为历史列表。 */
  var Hero = {
    el: null,
    init: function () {
      this.el = $('ordHero');
      this.amt = $('hAmt'); this.store = $('hStore');
      this.geo = $('hGeo'); this.prod = $('hProd'); this.ref = $('hRef');
      this.rule = $('hRule');
    },
    current: null,
    show: function (ev) {
      if (!this.el) return;
      this.current = ev;
      this.amt.textContent = root.APEngine.fmtMoney(ev.amount, ev.currency, ev.locale);
      this.store.textContent = ev.store.name;
      this.geo.textContent = ev.store.cc + ' · ' + ev.store.city;
      this.prod.textContent = ev.product;
      this.ref.textContent = '来源 ' + ev.referrer;
      this.el.className = 'ohero t-' + ev.tier;
      /* 重启入场过渡需要一次强制回流。约每分钟一次，不在帧循环里，代价可忽略。 */
      this.el.style.transition = 'none';
      this.el.style.transform = 'translate3d(0,10px,0)';
      this.el.style.opacity = '0';
      this.rule.style.transition = 'none';
      this.rule.style.width = '0';
      void this.el.offsetHeight;
      this.el.style.transition =
        'opacity 480ms cubic-bezier(.16,1,.3,1),transform 480ms cubic-bezier(.16,1,.3,1)';
      this.el.style.transform = 'translate3d(0,0,0)';
      this.el.style.opacity = '1';
      if (ev.tier === 'epic' || ev.tier === 'legendary') {
        this.rule.style.transition = 'width 900ms cubic-bezier(.16,1,.3,1)';
        this.rule.style.width = '100%';
      }
    }
  };

  var Deck = {
    pool: [], count: 0,
    build: function (host) {
      host.textContent = '';
      this.pool = [];
      for (var i = 0; i < ORD_POOL; i++) {
        var d = mk('div', 'ocard');
        var o = {
          el: d,
          amt: sub(d, 'span', 'amt'), store: sub(d, 'span', 'store'),
          geo: sub(d, 'span', 'geo'), prod: sub(d, 'span', 'prod'),
          ref: sub(d, 'span', 'ref'),
          seq: -1, st: 0, y: 0, age: 0, oage: 0, op: -1, wc: false
        };
        d.style.opacity = '0';
        host.appendChild(d);
        this.pool.push(o);
      }
    },
    push: function (ev) {
      var c = this.pool[this.count % ORD_POOL];
      c.seq = this.count;
      this.count++;
      c.amt.textContent = root.APEngine.fmtMoney(ev.amount, ev.currency, ev.locale);
      c.store.textContent = ev.store.name;
      c.geo.textContent = ev.store.cc + ' · ' + ev.store.city;
      c.prod.textContent = ev.product;
      c.ref.textContent = '来源 ' + ev.referrer;
      c.el.className = 'ocard t-' + ev.tier;
      c.st = 1; c.age = 0; c.oage = 0; c.op = -1;
      c.y = 8;                     /* 入场 8px 位移（规格 4.4） */
      c.el.style.willChange = 'transform,opacity';
      c.wc = true;
    },
    frame: function (dt) {
      /* 时间常数 120ms ≈ spring stiffness 170 / damping 26 的临界阻尼手感，overshoot = 0 */
      var k = 1 - Math.exp(-dt / 120);
      for (var i = 0; i < ORD_POOL; i++) {
        var c = this.pool[i];
        if (c.st === 0) continue;
        var slot = this.count - 1 - c.seq;
        var ty = slot * (ORD_H + ORD_GAP);
        if (slot >= ORD_VIS && c.st !== 3) { c.st = 3; c.oage = 0; }
        c.y += (ty - c.y) * k;
        c.el.style.transform = 'translate3d(0,' + c.y.toFixed(1) + 'px,0)';
        var op;
        if (c.st === 1) {
          c.age += dt;
          if (c.age >= 480) { c.st = 2; op = 1; } else op = easeOutSoft(c.age / 480);
        } else if (c.st === 2) {
          op = 1;
        } else {
          c.oage += dt;
          if (c.oage >= 240) { c.st = 0; c.seq = -1; op = 0; }
          else op = 1 - easeInQuad(c.oage / 240);
        }
        if (op !== c.op) { c.op = op; c.el.style.opacity = op.toFixed(3); }
        /* will-change 只在动画期间挂着，settle 后立刻摘掉（规格 2.9） */
        if (c.wc && (c.st === 0 || (c.st === 2 && Math.abs(ty - c.y) < 0.4))) {
          c.el.style.willChange = ''; c.wc = false;
        }
      }
    }
  };

  /* ============================================================ 里程碑庆祝 */
  var Cel = {
    /* 实测里程碑到达频率：页面每 1,000 页（约 15 分钟）、订单每 50 单（约 38 分钟）、
     * 抓取每 250,000 次（约 87 分钟），合计约每 8.6 分钟一次，正好是好的演出节拍。
     * COOL 是安全阀：万一三种里程碑撞在一起，不要连着放三次全屏。 */
    on: false, t: 0, cool: 0, el: null, IN: 400, HOLD: 3200, OUT: 600, COOL: 90000,
    ready: function () { return !this.on && this.cool <= 0; },
    fire: function (evt) {
      var name, en;
      if (evt.metric === 'pages') { name = 'AP 翻译页面总数'; en = 'AP Pages Live'; }
      else if (evt.metric === 'crawls') { name = 'AI 爬虫累计访问'; en = 'Total AI Visits'; }
      else { name = 'AI 引荐订单'; en = 'AI-referred Orders'; }
      $('msVal').textContent = root.APEngine.fmtInt(evt.value);
      $('msName').textContent = name;
      $('msEn').textContent = en;
      this.el.classList.add('on');
      this.el.style.willChange = 'opacity';
      this.on = true; this.t = 0; this.cool = this.COOL;
      root.APAudio.playMilestone();
    },
    frame: function (dt) {
      if (this.cool > 0) this.cool -= dt;
      if (!this.on) return;
      this.t += dt;
      var total = this.IN + this.HOLD + this.OUT, o;
      if (this.t < this.IN) o = this.t / this.IN;
      else if (this.t < this.IN + this.HOLD) o = 1;
      else if (this.t < total) o = 1 - (this.t - this.IN - this.HOLD) / this.OUT;
      else {
        this.on = false;
        this.el.classList.remove('on');
        this.el.style.opacity = '0';
        this.el.style.willChange = '';
        return;
      }
      this.el.style.opacity = o.toFixed(3);
    }
  };

  /* ==================================================== 公开数据卡轮播（12s） */
  var Pub = {
    els: [], i: -1, acc: 12000,
    build: function (host) {
      host.textContent = '';
      this.els = [];
      for (var i = 0; i < PUB.length; i++) {
        var d = mk('div', 'pub');
        sub(d, 'div', 'k').textContent = 'Public research';
        sub(d, 'div', 't').innerHTML = PUB[i].t;
        sub(d, 'div', 's').textContent = PUB[i].s;
        host.appendChild(d);
        this.els.push(d);
      }
    },
    frame: function (dt) {
      this.acc += dt;
      if (this.acc < 12000) return;
      this.acc = 0;
      if (this.i >= 0) this.els[this.i].classList.remove('on');
      this.i = (this.i + 1) % this.els.length;
      this.els[this.i].classList.add('on');
    }
  };

  /* ================================================================ FPS 自监控 */
  var Fps = {
    frames: 0, acc: 0, ring: [], ri: 0, filled: 0, cur: 60, warned: false,
    init: function () { for (var i = 0; i < 60; i++) this.ring.push(60); },
    tick: function (dt) {
      this.frames++; this.acc += dt;
      if (this.acc < 1000) return;
      this.cur = this.frames * 1000 / this.acc;
      this.ring[this.ri] = this.cur;
      this.ri = (this.ri + 1) % 60;
      this.filled = Math.min(60, this.filled + 1);
      this.frames = 0; this.acc = 0;
      if (this.filled < 60) return;
      var s = 0;
      for (var i = 0; i < 60; i++) s += this.ring[i];
      var avg = s / 60;
      if (avg < 40 && !this.warned) {
        this.warned = true;
        console.warn('[AP-A] 60s 平均 FPS = ' + avg.toFixed(1) + '，低于 40。正式版需接自动软重置。');
      } else if (avg >= 45) {
        this.warned = false;
      }
    }
  };

  /* ================================================================ 布局 */
  var dyn = mk('style');
  doc.head.appendChild(dyn);

  var S = { w: W_BASE, pad: 80, logW: 730, scale: 1 };
  var odoC = null, odoP = null;
  var heroFont = 0;

  function writeDyn(logFs, logRh) {
    dyn.textContent =
      '.lrow .c-time,.lp-cols .c-time{width:' + CW.time + 'ch}' +
      '.lrow .c-bot,.lp-cols .c-bot{width:' + CW.bot + 'ch}' +
      '.lrow .c-ip,.lp-cols .c-ip{width:' + CW.ip + 'ch}' +
      '.lrow .c-asn,.lp-cols .c-asn{width:' + CW.asn + 'ch}' +
      '.lrow .c-st,.lp-cols .c-st{width:' + CW.st + 'ch}' +
      '.lrow .c-by,.lp-cols .c-by{width:' + CW.by + 'ch;text-align:right}' +
      '.lrow .c-ms,.lp-cols .c-ms{width:' + CW.ms + 'ch;text-align:right}' +
      ':root{--log-fs:' + logFs + 'px;--log-rh:' + logRh + 'px}';
  }

  function fitStage() {
    S.scale = Math.min(innerWidth / S.w, innerHeight / H_BASE);
    $('stage').style.transform = 'translate(-50%,-50%) scale(' + S.scale + ')';
  }

  /* 巨型数字自适应：实测当前机器上真实的数字前进宽度，
   * 再按「可用宽度」和「可用高度」取小，得到几何允许的最大字号。
   * 这样字体回退到 Segoe UI 也不会溢出，也永远不会压到日志栏。 */
  /* 巨型数字的可用高度：把 leftInner 除 heroRow 以外的孩子（含外边距）加起来。
   * 不能用 scrollHeight —— 内容比容器矮时它会直接返回 clientHeight，量出来是错的。 */
  function heroAvailH() {
    var inner = $('leftInner'), heroRow = $('heroRow');
    var kids = inner.children, other = 0, i, cs;
    for (i = 0; i < kids.length; i++) {
      if (kids[i] === heroRow) continue;
      cs = getComputedStyle(kids[i]);
      other += kids[i].offsetHeight +
        (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    }
    other += parseFloat(getComputedStyle(inner).paddingTop) || 0;
    return inner.clientHeight - other - 10;   /* 10px 呼吸余量 */
  }

  function fitHero(nDigits) {
    var rs = doc.documentElement.style;
    var fam = getVar('--font-hero');
    rs.setProperty('--hero', '10px');
    var availH = heroAvailH();
    var availW = $('left').offsetWidth - 8;
    var w100 = measureText(groupPattern(nDigits), fam, 100, 600);
    var byW = w100 > 0 ? Math.floor(availW / w100 * 100) : 200;

    heroFont = Math.floor(clamp(Math.min(byW, availH), 120, 400));
    rs.setProperty('--hero', heroFont + 'px');
    odoC.build(nDigits, heroFont, inkShift(fam, heroFont, 600), 1);
  }

  function fitPages(nDigits) {
    var fam = getVar('--font-num');
    var px = parseFloat(getVar('--mid')) || 46;
    odoP.build(nDigits, px, inkShift(fam, px, 600), 0);
  }

  function fitLog() {
    var panel = $('logPanel');
    var usable = panel.clientWidth - 22;     /* 22 = padding-left */
    var fam = getVar('--font-mono');
    var ratio = measureText('0000000000', fam, 100, 400) / 1000;  /* 每 px 字号的字宽 */
    var fs = 12, total = 0, i;
    for (i = 15; i >= 10; i--) {
      total = Math.floor(usable / (i * ratio));
      if (total - CW_FIXED >= 22) { fs = i; break; }
      fs = i;
    }
    total = Math.floor(usable / (fs * ratio));
    Log.pathCh = Math.max(12, total - CW_FIXED - 1);

    var body = $('logBody');
    var bodyH = body.clientHeight;
    var rh = Math.max(18, Math.floor(bodyH / LOG_ROWS));
    writeDyn(fs, rh);
    Log.header($('logCols'));
    Log.build(body, LOG_ROWS, rh, body.clientHeight || bodyH);
  }

  function fitMap() {
    var left = $('left');
    Map.build($('map'), left.offsetWidth, left.offsetHeight);
  }

  function buildDbg() {
    var d = $('dbg'), i;
    d.textContent = '';
    sub(d, 'div', 'base');
    var m = Math.round(S.w * 0.06), gut = 32, n = 12;
    var cw = (S.w - m * 2 - gut * (n - 1)) / n;
    for (i = 0; i < n; i++) {
      var c = sub(d, 'div', 'col');
      c.style.left = (m + i * (cw + gut)) + 'px';
      c.style.width = cw + 'px';
    }
    var sm = Math.round(H_BASE * 0.06);
    var safe = sub(d, 'div', 'safe');
    safe.style.cssText = 'left:' + m + 'px;top:' + sm + 'px;width:' +
      (S.w - 2 * m) + 'px;height:' + (H_BASE - 2 * sm) + 'px';
    var fr = sub(d, 'div', 'frame');
    fr.style.cssText = 'left:' + S.pad + 'px;top:0;width:' +
      (S.w - 2 * S.pad) + 'px;height:' + H_BASE + 'px';
    sub(d, 'div', 'mv');
    sub(d, 'div', 'mh');
    var tg = sub(d, 'div', 'tag');
    tg.id = 'dbgTag';
    tg.style.cssText = 'left:' + (m + 6) + 'px;top:' + (sm + 6) + 'px';
    tg.textContent = '';
  }

  function relayout() {
    var aspect = innerWidth / Math.max(1, innerHeight);
    S.w = Math.round(clamp(H_BASE * aspect, W_BASE, W_MAX));
    S.pad = Math.round(S.w * 0.0417);
    S.logW = Math.round(S.w * LOG_RATIO);
    var rs = doc.documentElement.style;
    rs.setProperty('--stage-w', S.w + 'px');
    rs.setProperty('--pad', S.pad + 'px');
    $('logPanel').style.flexBasis = S.logW + 'px';
    fitStage();
    var m = root.APEngine.metrics();
    fitHero(digitCount(m.crawls));
    fitPages(digitCount(m.pages));
    fitLog();
    fitMap();
    buildDbg();
  }

  /* ================================================================ 文本刷新 */
  var txtAcc = 999, secAcc = 999;

  function initStaticText() {
    $('cv1').innerHTML = '≈ 每 <b id="cv1n">0</b> 秒 一笔 AI 引荐订单';
    $('cv2').innerHTML = '≈ 每分钟 <b id="cv2n">0</b> 个新 AP 页面';
    $('logRate').textContent = String(CRAWL_RATE);

    var pb = $('platBar'), pl = $('platLeg');
    pb.textContent = ''; pl.textContent = '';
    var bd = root.APEngine.platformBreakdown();
    for (var i = 0; i < bd.length; i++) {
      var seg = sub(pb, 'i', null);
      seg.style.flex = '0 0 ' + (bd[i].share * 100).toFixed(2) + '%';
      seg.style.background = PF_COLOR[bd[i].platform] || '#6E7C82';
      var g = sub(pl, 'span', null);
      sub(g, 'em', null).style.background = PF_COLOR[bd[i].platform] || '#6E7C82';
      sub(g, 'i', null).textContent = bd[i].platform;
      sub(g, 'b', null).textContent = Math.round(bd[i].share * 100) + '%';
    }
  }

  function updateText(m) {
    $('rateVal').textContent = m.crawlsPerSec.toFixed(1);
    $('storeVal').textContent = root.APEngine.fmtInt(m.stores);
    var n1 = $('cv1n'), n2 = $('cv2n');
    if (n1) n1.textContent = Math.round(m.secondsPerOrder);
    if (n2) n2.textContent = Math.round(m.pagesPerSec * 60);
    $('msTarget').textContent = root.APEngine.fmtInt(m.nextMilestone.value);
    $('msRemain').textContent = root.APEngine.fmtInt(m.nextMilestone.remain);
    $('msBar').style.width = (clamp(m.nextMilestone.progress, 0, 1) * 100).toFixed(2) + '%';
    /* 订单数和成交额必须同口径，否则被人一除就露。
     * 引擎里 orders 带 ORDERS0=296,000 的历史基数、gmv 没有基数 —— 两者不能配对。
     * metrics().session.* 是同一条积分（都从开幕 T0 起算，AOV 约 $139 算得通），
     * 而且 T0 是硬编码锚点，断电重启也不会归零。 */
    var se = m.session || { orders: m.orders, gmv: m.gmv };
    $('ordCount').textContent = root.APEngine.fmtInt(se.orders);
    $('ordGmv').textContent = '$' + root.APEngine.fmtInt(se.gmv);
    var lt = $('liveTag'), paused = root.APEngine.paused;
    var want = paused ? 'PAUSED' : (root.APEngine.speed !== 1
      ? 'LIVE ×' + root.APEngine.speed : 'LIVE');
    if (lt.textContent !== want) lt.textContent = want;
    lt.className = paused ? 'live paused' : 'live';
  }

  /* ================================================================ 主循环 */
  var manualSeq = 0;

  function normalOrder() {
    manualSeq++;
    var seed = (Math.floor(root.APEngine.now() / 11) + manualSeq * 7919) | 0;
    /* 普通单走 common 阶梯 —— sampleAmount(false) 会落到 rare，那一档要出人声
     * 而随机金额没有预渲染音频。见 engine.js 的 DEMO_LADDERS 注释。 */
    root.APEngine.triggerOrder({ usd: root.APEngine.demoAmount('common', manualSeq) });
  }

  function fakeMilestone() {
    if (Cel.on) return;
    Cel.cool = 0;
    var m = root.APEngine.metrics();
    var unit = root.APEngine.CONFIG.MILESTONE_CRAWLS;
    Cel.fire({ kind: 'milestone', metric: 'crawls', value: Math.floor(m.crawls / unit) * unit });
  }

  /* 现场最怕的是「画面停了但没人知道为什么」。所以：
   *   1) 任何未捕获异常都留痕，调试网格里直接显示；
   *   2) 主循环包一层 try —— 单帧出错也要继续 rAF，不能整块屏死掉。 */
  var lastError = '', errCount = 0;
  addEventListener('error', function (ev) {
    lastError = (ev.message || 'error') + ' @' +
      String(ev.filename || '').split('/').pop() + ':' + ev.lineno;
    if (errCount++ < 5) console.error('[AP-A] 未捕获异常：' + lastError);
  });

  function frame() {
    try { step(); } catch (e) {
      lastError = (e && e.message ? e.message : String(e));
      if (errCount++ < 5) console.error('[AP-A] 帧内异常：' + lastError, e);
    }
    requestAnimationFrame(frame);
  }

  function step() {
    root.APEngine.update();
    var dt = root.APEngine.dt();
    var m = root.APEngine.metrics();

    var dc = digitCount(m.crawls);
    if (dc !== odoC.digits) fitHero(dc);
    var dp = digitCount(m.pages);
    if (dp !== odoP.digits) fitPages(dp);

    odoC.set(m.crawls);
    odoP.set(m.pages);

    var cr = root.APEngine.pollCrawls(CRAWL_RATE), i;
    for (i = 0; i < cr.length; i++) {
      Log.push(cr[i]);
      Map.ping(cr[i].dcLat, cr[i].dcLon);
    }

    var od = root.APEngine.pollOrders();
    for (i = 0; i < od.length; i++) {
      /* 大卡显示最新一笔，被顶下来的那一笔才进历史列表 ——
       * 否则大卡和列表第一行是同一单，看起来像重复渲染。 */
      if (Hero.current) Deck.push(Hero.current);
      Hero.show(od[i]);
      root.APAudio.playOrder(od[i]);
    }

    var ms = root.APEngine.pollMilestones();
    if (ms.length && Cel.ready()) Cel.fire(ms[0]);

    Log.frame(dt);
    Deck.frame(dt);
    Map.frame(dt);
    Cel.frame(dt);
    Pub.frame(dt);

    txtAcc += dt;
    if (txtAcc >= 200) { txtAcc = 0; updateText(m); }
    secAcc += dt;
    if (secAcc >= 500) {
      secAcc = 0;
      $('clock').textContent = hhmmssms(root.APEngine.now()).slice(0, 8) + ' UTC+8';
      var tg = $('dbgTag');
      if (tg && $('dbg').classList.contains('on')) {
        tg.textContent = 'stage ' + S.w + '×' + H_BASE +
          '  scale ' + S.scale.toFixed(3) +
          '  hero ' + heroFont + 'px (cap≈' + Math.round(heroFont * 0.71) + 'px / ' +
          Math.round(heroFont * 0.71 / H_BASE * 100) + '% of H)' +
          '  log ' + LOG_ROWS + '×' + Log.rh + 'px  path ' + Log.pathCh + 'ch' +
          '  fps ' + Fps.cur.toFixed(0) +
          '  dom ' + doc.getElementsByTagName('*').length +
          '  voice ' + (root.APAudio.voiceAvailable ? 'ok' : 'MISSING') +
          '  err ' + errCount + (lastError ? ' [' + lastError + ']' : '');
      }
    }

    Fps.tick(dt);
  }

  /* ================================================================ 交互 */
  function toggleDbg() { $('dbg').classList.toggle('on'); }

  function onKey(e) {
    var k = e.key;
    if (e.code === 'Space') {
      e.preventDefault();
      root.APEngine.togglePause();
      root.APAudio.blip();
      return;
    }
    switch (k) {
      case 'm': case 'M': root.APAudio.toggleMute(); break;
      case 'b': case 'B': root.APEngine.triggerOrder(); break;
      case 'n': case 'N': normalOrder(); break;
      case 'k': case 'K': fakeMilestone(); break;
      case '1': root.APEngine.setSpeed(0.5); root.APAudio.blip(); break;
      case '2': root.APEngine.setSpeed(1); root.APAudio.blip(); break;
      case '3': root.APEngine.setSpeed(3); root.APAudio.blip(); break;
      case 'g': case 'G': toggleDbg(); break;
      case 'h': case 'H':
        hall = !hall; root.APAudio.setHallMode(hall); root.APAudio.blip(); break;
      case 'a': case 'A':
        amb = !amb; root.APAudio.setAmbient(amb); break;
      case 'f': case 'F':
        /* 浏览器要求全屏必须由用户手势触发；被拒绝时不要留下未处理的 rejection */
        try {
          var pr = doc.fullscreenElement ? doc.exitFullscreen()
                 : (doc.documentElement.requestFullscreen
                    ? doc.documentElement.requestFullscreen() : null);
          if (pr && pr.catch) pr.catch(function () {});
        } catch (e) {}
        break;
      case 'r': case 'R':
        root.APEngine.reset(); Deck.count = 0; root.APAudio.blip(); break;
      case '?': case '/':
        $('legend').classList.toggle('on'); break;
      default: break;
    }
  }
  var hall = false, amb = false;

  /* ================================================================ 启动 */
  function boot() {
    root.APEngine.init();
    Fps.init();

    odoC = new Odo($('odoCrawls'));
    odoP = new Odo($('odoPages'));
    Deck.build($('ordPool'));
    Hero.init();
    Pub.build($('pubDeck'));
    Cel.el = $('ms');

    var q = /[?&]log=(\d+)/.exec(location.search);
    if (q) LOG_RATIO = clamp(parseInt(q[1], 10) / 100, 0.26, 0.46);

    initStaticText();
    relayout();

    if (location.search.indexOf('debug=grid') >= 0) $('dbg').classList.add('on');

    var rt = 0;
    addEventListener('resize', function () {
      if (rt) clearTimeout(rt);
      rt = setTimeout(function () { rt = 0; relayout(); }, 140);
    });
    addEventListener('keydown', onKey);

    var mask = $('mask'), unlocked = false;
    mask.addEventListener('click', function () {
      if (unlocked) return;
      unlocked = true;
      root.APAudio.unlock();
      root.APAudio.setVoiceLang('zh-CN');
      root.APAudio.selfTest();          /* 现场开机自检：确认 HDMI 没把输出切走 */
      if (!root.APAudio.voiceAvailable) {
        console.warn('[AP-A] 本机没有 zh-CN 语音，人声播报已降级为纯音效。' +
          '上会必须换成预生成音频文件。');
      }
      mask.classList.add('gone');
    });

    requestAnimationFrame(frame);
  }

  if (doc.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
  else boot();

})(typeof window !== 'undefined' ? window : globalThis);
