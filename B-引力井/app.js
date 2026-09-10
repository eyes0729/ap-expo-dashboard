/* ===========================================================================
 * AP 展会大屏 · 方案 B「引力井」· 应用层   (window.APApp)
 * ---------------------------------------------------------------------------
 * 负责：舞台适配 / 巨型数字里程表 / 事件卡对象池 / 里程碑庆祝 / 快捷键 /
 *       调试网格 / FPS 自监控 / 启动遮罩。地球本体在 globe.js。
 *
 * 巨型数字为什么是「里程表」而不是「每帧改 textContent」：
 *   200px 字号下改文本 = layout + 巨型字形重光栅，是掉帧首因（共享规格 4.2）。
 *   这里每个数位是一条 0-9-0 的字条，只写 transform: translate3d，
 *   字形一次光栅化后永久复用。位置 = 数值的连续函数，因此单调递增、
 *   不可能倒退，也不需要任何带回弹的缓动。
 *
 * 每一位的滚动窗口固定约 145ms（与位数无关）。但窗口占该位周期的比例要看位数：
 *   个位、十位的周期短到窗口占比超过 34%，随手一张截图就会拍到半个字形 ——
 *   这两位直接「整格吸附」，每帧都是完整字形，而且每帧都在变，快感不丢。
 *   百位以上进位时才滚一次 145ms，其余时间纹丝不动 —— 高位始终可读。
 *   高位再加 40ms stagger，进位时形成一次自下而上的级联。
 *   （曾经用「速度驱动运动模糊」解这个问题，实测静帧读作「缺字形」的灰色色块，
 *     比它要解决的问题更糟，已移除。详见 update() 里的注释。）
 *
 * 所有随机来自 APEngine.hash32，所有步长来自 APEngine.dt()。
 * classic script，不要改成 ES module。
 * =========================================================================== */
(function (root) {
  'use strict';

  var doc = root.document;
  var W = 1920, H = 1080;

  /* --- 版面常量（设计稿坐标，8px 基线网格，边距 = 屏宽 6%） ------------------ */
  var MARGIN = 116;
  var COL_W = 880;            /* 巨型数字可用宽度：不侵入球体左缘（球缘 x≈997） */
  var SUB_RATIO = 0.38;       /* 配角尺寸 = 主角的 38% */
  var ODO_MAX_FONT = 240;
  /* 数位数在启动时按引擎的真实量级算出来，不写死。
   * 原因：_shared/engine.js 的 CRAWLS0 / PAGES0 是会被调的（量级要跟对外口径对齐），
   * 一旦写死 9 位而实际是 10 位，最高位会被直接砍掉 —— 数字就是错的，而且没人会发现。
   * 运行期涨位（累计数跨过 10 亿）也会自动重排，见 frame() 里的 ensureDigits()。 */
  var MAIN_DIGITS = 9, PAGE_DIGITS = 7;
  var PF_W = 848;             /* 平台条宽度：与结构块对齐，避开球缘 */
  var ZONE_H = 176, CARD_GAP = 8;
  var COURIER_TX = 300, COURIER_TY = 862;

  var E = null, A = null, G = null;
  var stage, cvs, gridEl, msEl, msVal, msKey, bootEl, legendEl, vigEl, rayEl;
  var rateVal, msRemain, barFill, statusEl, cvSecEl, cvPgEl;

  /* =====================================================================
   * 一、舞台适配：外层固定设计稿尺寸，只用 transform scale
   * ===================================================================== */
  function fit() {
    var s = Math.min(root.innerWidth / W, root.innerHeight / H);
    stage.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
  }

  /* =====================================================================
   * 二、巨型数字里程表
   * ===================================================================== */
  var POW = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12];

  function digitsOf(v) {
    return (v < 10) ? 1 : (Math.floor(Math.log(v) / Math.LN10) + 1);
  }

  function Odometer(host, nDigits) {
    this.host = host;
    this.n = nDigits;
    this.digits = [];
    this.seps = [];
    this.cell = 0;
    this.lastActive = -1;
    this.lastRate = 1;
    this.build();
  }

  Odometer.prototype.build = function () {
    var host = this.host, j, p, i;
    host.textContent = '';
    for (j = 0; j < this.n; j++) {
      p = this.n - 1 - j;
      var slot = doc.createElement('div');
      slot.className = 'odo-slot';
      var strip = doc.createElement('div');
      strip.className = 'odo-strip';
      for (i = 0; i <= 10; i++) {              /* 0..9 再补一个 0，滚动无缝 */
        var g = doc.createElement('div');
        g.className = 'odo-g';
        g.textContent = String(i % 10);
        strip.appendChild(g);
      }
      slot.appendChild(strip);
      host.appendChild(slot);
      this.digits.push({ slot: slot, strip: strip, place: p, on: -1 });
      if (p % 3 === 0 && p !== 0) {
        var sep = doc.createElement('div');
        sep.className = 'odo-sep';
        sep.textContent = ',';
        host.appendChild(sep);
        this.seps.push({ el: sep, min: POW[p], on: -1 });
      }
    }
  };

  /** 按测量出的字宽定尺寸。cell / fontSize 一律取整 —— 非整数行高会亚像素闪烁。 */
  Odometer.prototype.size = function (fontSize, digitW, sepW) {
    var i;
    /* 字格比字号高 30%：一是给逗号的下伸留位（否则被 slot 裁掉），
     * 二是让高速滚动的低位在上下留出淡出带，读起来像转鼓而不是被切断。 */
    this.cell = Math.round(fontSize * 1.30);
    this.host.style.height = this.cell + 'px';
    this.host.style.fontSize = Math.round(fontSize) + 'px';
    for (i = 0; i < this.digits.length; i++) {
      var d = this.digits[i];
      d.slot.style.width = digitW + 'px';
      d.slot.style.height = this.cell + 'px';
      d.strip.style.lineHeight = this.cell + 'px';
    }
    for (i = 0; i < this.seps.length; i++) {
      this.seps[i].el.style.width = sepW + 'px';
      this.seps[i].el.style.height = this.cell + 'px';
      this.seps[i].el.style.lineHeight = this.cell + 'px';
    }
    this.lastActive = -1;
  };

  function easeInOutCubic(k) {
    return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  }

  /**
   * @param v     当前数值（浮点，来自引擎的积分器，天然连续）
   * @param rate  当前每秒增量，用于把「滚动窗口」从比例换算成时间
   */
  Odometer.prototype.update = function (v, rate) {
    if (v < 0) v = 0;
    var active = v < 10 ? 1 : (Math.floor(Math.log(v) / Math.LN10) + 1);
    if (active > this.n) active = this.n;
    var i, d;

    if (active !== this.lastActive) {          /* 位数变化才碰 DOM */
      for (i = 0; i < this.digits.length; i++) {
        d = this.digits[i];
        var vis = (d.place < active) ? 1 : 0;
        if (d.on !== vis) { d.on = vis; d.opw = -1; }   /* 透明度统一在下面写 */
      }
      for (i = 0; i < this.seps.length; i++) {
        var s = this.seps[i], sv = (v >= s.min) ? 1 : 0;
        if (s.on !== sv) { s.el.style.opacity = sv ? '1' : '0'; s.on = sv; }
      }
      this.lastActive = active;
    }

    /* 暂停时 rate 归零，但滚动窗口必须沿用暂停前的值 ——
     * 否则窗口一变宽，所有高位会瞬间滑到两位数字之间，看起来像坏了。 */
    if (rate > 0) this.lastRate = rate;
    var r = this.lastRate || 1;
    for (i = 0; i < this.digits.length; i++) {
      d = this.digits[i];
      if (d.place >= active) {
        if (d.opw !== 0) { d.opw = 0; d.slot.style.opacity = '0'; }
        continue;
      }
      var pw = POW[d.place];
      var vv = v - d.place * 0.040 * r;         /* 高位滞后 40ms：进位级联 */
      if (vv < 0) vv = 0;
      var q = vv / pw;
      var fl = Math.floor(q);
      var frac = q - fl;
      /* 滚动窗口固定 145ms（与位数无关），这个设计是对的。但要注意窗口占该位
       * 周期的比例：十位的周期只有 10/46 ≈ 217ms，145ms 就占了 67% ——
       * 也就是说观众随手拍一张，2/3 的概率拍到十位停在两个字形中间。
       * 原实现靠运动模糊掩盖，实测静帧读作「缺字形」（灰色色块），比它要解决的
       * 问题更糟。正确做法：占比超过 34% 的位直接整格吸附 —— 每帧都是完整字形，
       * 而且每帧都在变，"快"的感觉一点不丢（规格 §4.2）。 */
      var win = 0.145 * r / pw;                 /* 该位的滚动窗口占周期的比例 */
      var roll;
      if (win >= 0.34) roll = 0;                /* 个位、十位：整格吸附 */
      else {
        var k = (frac - (1 - win)) / win;
        roll = k <= 0 ? 0 : easeInOutCubic(k);
      }
      var pos = (fl % 10) + roll;
      d.strip.style.transform = 'translate3d(0,' + (-pos * this.cell).toFixed(2) + 'px,0)';

      /* 运动模糊已移除。原实现按「本帧位移 × 曝光」给模糊半径，思路是对的
       * （真实相机就是这样），但在这个量级下不成立：个位每帧位移 0.77 格，
       * 0.77 × 162px × 0.42 = 52px，被截到 17px 上限并把不透明度压到 50%，
       * 结果在静帧里就是两个灰色矩形块 —— 读作「缺字形 / 纹理没加载」，
       * 比它要解决的半字形问题更糟。这块屏要用于媒体拍照和录屏，
       * 静帧质量就是交付质量。改用上面的整格吸附之后不再需要任何模糊。 */
      if (d.blur) { d.blur = 0; d.strip.style.filter = ''; }
      if (d.opw !== 1) { d.opw = 1; d.slot.style.opacity = '1'; }
    }
  };

  /* --- 字宽测量：不猜字体，直接问浏览器 -------------------------------------
   * 有 Bahnschrift 就窄、退回 Segoe UI 就宽，两种情况下 slot 都精确等于字宽，
   * 所以永远不会溢出、也不会留缝。 */
  var mctx = null;
  function measureFont(fontCSS) {
    if (!mctx) mctx = doc.createElement('canvas').getContext('2d');
    mctx.font = fontCSS;
    return { d: mctx.measureText('0').width, c: mctx.measureText(',').width };
  }

  var odoMain = null, odoPages = null, mainFont = 0;

  function sepCount(n) {
    var c = 0;
    for (var p = n - 1; p >= 1; p--) if (p % 3 === 0) c++;
    return c;
  }

  function layoutOdometers() {
    var fam = root.getComputedStyle(doc.documentElement)
      .getPropertyValue('--font-display').trim();
    var probe = 200;
    var m = measureFont('600 ' + probe + 'px ' + fam);
    var dW = m.d / probe, cW = m.c / probe;        /* 每 em 的字宽 */

    var s1 = sepCount(MAIN_DIGITS);
    var fs = Math.floor(Math.min(COL_W / (MAIN_DIGITS * dW + s1 * cW), ODO_MAX_FONT));
    mainFont = fs;
    var d1 = Math.round(dW * fs), c1 = Math.round(cW * fs);
    odoMain.size(fs, d1, c1);
    /* 主数字块宽度按实际槽宽收紧，右对齐后左缘正好落在 116px 边距上 */
    odoMain.host.style.width = (MAIN_DIGITS * d1 + s1 * c1) + 'px';

    var fs2 = Math.round(fs * SUB_RATIO);
    var d2 = Math.round(dW * fs2), c2 = Math.round(cW * fs2);
    var s2 = sepCount(PAGE_DIGITS);
    odoPages.size(fs2, d2, c2);
    doc.getElementById('pagesBlock').style.width =
      (PAGE_DIGITS * d2 + s2 * c2) + 'px';
  }

  /* =====================================================================
   * 三、事件卡对象池
   * ---------------------------------------------------------------------
   * 固定 10 个 DOM 节点循环复用。生命周期完全由 rAF 状态机推进，
   * 不依赖 transitionend / onComplete —— 掉帧时回调不执行会让节点永久留下。
   * ===================================================================== */
  /* 订单约 1 分钟一单、卡片若只停 8 秒，则左下角有 85% 的时间是「一个标题
   * 加一片空白」—— 大屏上这是硬伤。所以改成常驻最近 3 单：新单从顶部滑入，
   * 把旧单顶出视野。事件感来自「信使 + 声音 + 滑入」，不来自「消失」。
   * 常驻 2 张（事件区占屏高 16%，符合规格「15~20%」），旧的那张压到 60% 亮度。 */
  var CARD_N = 10, cards = [], order = [];
  var AGE_OPACITY = [1.0, 0.60, 0.34];
  var MAX_RESIDENT = 2;       /* 常驻卡片数：事件区占屏高 16%，符合规格 15~20% */
  var CARD_H = { common: 70, rare: 70, epic: 84, legendary: 84 };

  function buildCards() {
    var host = doc.getElementById('cards');
    for (var i = 0; i < CARD_N; i++) {
      var el = doc.createElement('div');
      el.className = 'card';
      el.innerHTML =
        '<i class="cbar"></i>' +
        '<div class="crow1"><span class="cname"></span><span class="camt num"></span></div>' +
        '<div class="crow2"><span class="cmeta"></span><span class="cprod"></span></div>';
      host.appendChild(el);
      cards.push({
        el: el, bar: el.querySelector('.cbar'),
        name: el.querySelector('.cname'), amt: el.querySelector('.camt'),
        meta: el.querySelector('.cmeta'), prod: el.querySelector('.cprod'),
        phase: 0, t: 0, dwell: 8, h: 68, y: 0, ty: 0, tier: ''
      });
    }
  }

  function pushCard(ev) {
    var c = null, i;
    for (i = 0; i < CARD_N; i++) if (!cards[i].phase) { c = cards[i]; break; }
    if (!c) {                          /* 池满（只会发生在人工连按）：回收最老的 */
      var oi = order.pop();
      if (oi === undefined) return;
      c = cards[oi];
      c.phase = 0; c.el.style.opacity = '0';
    }
    var idx = cards.indexOf(c);
    c.name.textContent = ev.store.name;
    c.amt.textContent = E.fmtMoney(ev.amount, ev.currency, ev.locale);
    c.meta.textContent = ev.store.city + ' · ' + ev.store.cc + ' · ' + ev.referrer;
    c.prod.textContent = ev.product;
    if (c.tier) c.el.classList.remove('t-' + c.tier);
    c.tier = ev.tier;
    c.el.classList.add('t-' + c.tier);
    c.h = CARD_H[ev.tier] || 66;
    c.el.style.height = c.h + 'px';
    c.phase = 1; c.t = 0;
    c.ty = 0; c.y = 0;
    order.unshift(idx);
    relayoutCards(true);
  }

  /* 新卡在顶，旧卡整体下移；越过区高的自然滑出视野（.ev-zone 有 overflow:hidden），
   * 滑出后回收。绝不「刚出现就淡出」—— 那是 < 300ms 的闪烁，规格明令禁止。 */
  function relayoutCards(snapNew) {
    var acc = 0, live = 0;
    for (var k = 0; k < order.length; k++) {
      var c = cards[order[k]];
      if (c.phase === 3) continue;               /* 退场中的不再占位 */
      if (live < MAX_RESIDENT) {
        c.ty = acc; acc += c.h + CARD_GAP; live++;
      } else {
        /* 超编的一律送到视野之外。不能只放在「刚好露一条边」的位置：
         * 那张卡会永远卡在那里露出 20px，看着像没做完。 */
        c.ty = ZONE_H + 12;
      }
      if (snapNew && c.phase === 1 && c.t === 0) c.y = c.ty;
    }
  }

  function stepCards(dtS) {
    var i, k, c;
    var smooth = 1 - Math.exp(-13 * dtS);        /* 临界阻尼，overshoot = 0 */
    for (k = order.length - 1; k >= 0; k--) {
      c = cards[order[k]];
      if (!c.phase) { order.splice(k, 1); continue; }
      c.t += dtS;
      c.y += (c.ty - c.y) * smooth;
      if (c.phase !== 3 && c.y > ZONE_H + 2) {   /* 已被新卡顶出视野：直接回收 */
        c.phase = 0; c.el.style.opacity = '0';
        order.splice(k, 1); continue;
      }
      /* 越旧越暗：位次决定基准透明度，最新一张永远最亮 */
      var age = AGE_OPACITY[Math.min(k, AGE_OPACITY.length - 1)];
      var off = 0, op = age;
      if (c.phase === 1) {                      /* 入场 480ms + 8px 位移 */
        var u = c.t / 0.48;
        if (u >= 1) { c.phase = 2; c.t = 0; u = 1; }
        var e = 1 - Math.pow(1 - u, 3);
        off = 8 * (1 - e); op = age * e;
      } else if (c.phase === 3) {                /* 退场 240ms，慢进快退 */
        var v = c.t / 0.24;
        if (v >= 1) { c.phase = 0; c.el.style.opacity = '0'; continue; }
        off = -6 * v; op = age * (1 - v * v);
      }
      c.el.style.transform = 'translate3d(0,' + (c.y + off).toFixed(1) + 'px,0)';
      c.el.style.opacity = op.toFixed(3);
    }
    relayoutCards(false);
  }

  function clearCards() {
    for (var i = 0; i < CARD_N; i++) {
      cards[i].phase = 0; cards[i].t = 0;
      cards[i].el.style.opacity = '0';
    }
    order.length = 0;
  }

  /* =====================================================================
   * 四、平台占比：极细水平堆叠条 + 文字标签（不做饼图）
   *     占比由 BOT 权重推出，全程恒定 —— 因此只在启动时建一次，零每帧开销。
   * ===================================================================== */
  function buildPlatform() {
    var pb = E.platformBreakdown();
    var barHost = doc.getElementById('pfBar');
    var legHost = doc.getElementById('pfLeg');
    var sorted = pb.slice().sort(function (a, b) { return b.share - a.share; });
    var ALPHA = [1.0, 0.60, 0.42, 0.30, 0.18];
    var alphaOf = {};
    for (var i = 0; i < sorted.length; i++)
      alphaOf[sorted[i].platform] = ALPHA[Math.min(i, ALPHA.length - 1)];

    var left = 0;
    for (i = 0; i < pb.length; i++) {
      var w = pb[i].share * PF_W;
      var seg = doc.createElement('i');
      seg.className = 'pf-seg';
      seg.style.left = left.toFixed(1) + 'px';
      seg.style.width = Math.max(2, w - 2).toFixed(1) + 'px';
      seg.style.background = 'rgba(255,184,107,' + alphaOf[pb[i].platform] + ')';
      barHost.appendChild(seg);
      left += w;

      var it = doc.createElement('span');
      it.className = 'pf-it';
      var nm = doc.createElement('b'); nm.textContent = pb[i].platform;
      var pc = doc.createElement('em');
      pc.className = 'num';
      pc.textContent = Math.round(pb[i].share * 100) + '%';
      pc.style.color = 'rgba(255,184,107,' +
        Math.max(0.45, alphaOf[pb[i].platform]) + ')';
      it.appendChild(nm); it.appendChild(pc);
      legHost.appendChild(it);
    }
  }

  /* =====================================================================
   * 五、里程碑庆祝：3~5 秒，然后必须回到主画面
   * ===================================================================== */
  var msT = -1, MS_DUR = 4.2;
  var MS_LABEL = {
    pages: 'AP 翻译页面 · TRANSLATED PAGES',
    crawls: 'AI 爬虫访问 · TOTAL AI VISITS',
    orders: 'AI 引荐订单 · AI-REFERRED ORDERS'
  };
  function celebrate(ev) {
    msKey.textContent = MS_LABEL[ev.metric] || '';
    msVal.textContent = E.fmtInt(ev.value);
    msEl.classList.add('on');
    stage.classList.add('dimmed');
    msT = 0;
    A.playMilestone();
  }
  function stepMilestone(dtS) {
    if (msT < 0) return;
    msT += dtS;
    if (msT >= MS_DUR) {
      msT = -1;
      msEl.classList.remove('on');
      stage.classList.remove('dimmed');
    }
  }

  /* =====================================================================
   * 六、订单到达
   * ===================================================================== */
  function onOrder(ev) {
    A.playOrder(ev);
    G.spawnOrder(ev);
    G.pulse(ev.tier);
    var delivered = G.sendCourier(
      ev.store.lat, ev.store.lon, COURIER_TX, COURIER_TY,
      function () { pushCard(ev); },
      ev.tier === 'legendary' ? 3.4 : (ev.tier === 'epic' ? 3.0 : 2.4)
    );
    if (!delivered) pushCard(ev);               /* 信使池满：直接交付，绝不丢事件 */
  }

  /* =====================================================================
   * 七、FPS 自监控：环形缓冲记 60 秒平均，掉到 40 以下打警告
   * ===================================================================== */
  var fpsRing = new Float32Array(60), fpsIdx = 0, fpsFill = 0;
  var fAcc = 0, fCnt = 0, warnAt = 0;
  function stepFps(dtMs, nowMs) {
    fAcc += dtMs; fCnt++;
    if (fAcc < 1000) return;
    var fps = fCnt * 1000 / fAcc;
    fAcc = 0; fCnt = 0;
    fpsRing[fpsIdx] = fps;
    fpsIdx = (fpsIdx + 1) % 60;
    if (fpsFill < 60) fpsFill++;
    var s = 0;
    for (var i = 0; i < fpsFill; i++) s += fpsRing[i];
    var avg = s / fpsFill;
    root.APDiag.fps = Math.round(fps);
    root.APDiag.fpsAvg = Math.round(avg * 10) / 10;
    if (fpsFill >= 10 && avg < 40 && nowMs - warnAt > 30000) {
      warnAt = nowMs;
      root.console.warn('[AP:B] 60s 平均 FPS = ' + avg.toFixed(1) +
        '，低于 40。正式版应在此触发软重置（见 README 待办）。');
    }
  }

  /* =====================================================================
   * 八、快捷键
   * ===================================================================== */
  var manualSeq = 0, hallOn = false, ambientOn = true, gridOn = false;

  function setStatus() {
    var t = [];
    if (E.paused) t.push('PAUSED');
    if (A.muted) t.push('MUTED');
    if (E.speed !== 1) t.push('x' + E.speed);
    if (hallOn) t.push('HALL');
    statusEl.textContent = t.join('  ');
  }

  function toggleGrid() {
    gridOn = !gridOn;
    gridEl.style.display = gridOn ? 'block' : 'none';
  }

  function onKey(e) {
    var k = e.key;
    if (k === ' ' || k === 'Spacebar') {
      e.preventDefault(); E.togglePause(); A.blip(); setStatus(); return;
    }
    switch (k.toLowerCase()) {
      case 'm': A.toggleMute(); setStatus(); break;
      case 'b': onManual(true); break;
      case 'n': onManual(false); break;
      case 'k': celebrate({ metric: 'pages', value: E.metrics().nextMilestone.value }); break;
      case '1': E.setSpeed(0.5); A.blip(); setStatus(); break;
      case '2': E.setSpeed(1); A.blip(); setStatus(); break;
      case '3': E.setSpeed(3); A.blip(); setStatus(); break;
      case 'g': toggleGrid(); break;
      case 'h': hallOn = !hallOn; A.setHallMode(hallOn); A.blip(); setStatus(); break;
      case 'a': ambientOn = !ambientOn; A.setAmbient(ambientOn); A.blip(); break;
      case 'f':
        if (doc.fullscreenElement) doc.exitFullscreen();
        else if (doc.documentElement.requestFullscreen) doc.documentElement.requestFullscreen();
        break;
      case 'r': doReset(); break;
      case '?': case '/': legendEl.classList.toggle('on'); break;
      default: break;
    }
  }

  /** B = 大单（引擎默认强制帕累托尾）；N = 普通单（喂一个小额 usd） */
  function onManual(big) {
    if (big) E.triggerOrder();
    else {
      /* common 阶梯：原来 $38~$168 跨过了 rare 门槛($110)，而 rare 要出人声，
       * 随机金额又没有预渲染音频。见 engine.js 的 DEMO_LADDERS 注释。 */
      E.triggerOrder({ usd: E.demoAmount('common', manualSeq++) });
    }
  }

  function doReset() {
    E.reset();
    G.reset();
    clearCards();
    layoutOdometers();
    msT = -1;
    msEl.classList.remove('on');
    stage.classList.remove('dimmed');
    setStatus();
    A.blip();
  }

  /* =====================================================================
   * 九、主循环
   * ===================================================================== */
  var rateTick = 0, barTick = 0, lastMsVal = 0;

  /** 数字涨到多一位时重排字宽槽。展会连跑几天累计数跨过 10 亿就会触发一次，
   *  条件成立即重排，之后条件自然不再成立，所以不会每帧跑。 */
  /* 主数字口径开关。默认「累计」（带 4.2 亿基线，9 位数，绝对量级最震撼）。
   * `?hero=session` 切成「本场新增」（7 位数，字号能大将近一倍）。
   * 两种口径的取舍：累计数字更大更唬人，但位数多、字号必然小；本场口径字号大、
   * 且能看出「今天涨了这么多」，代价是开幕那一刻从 0 开始。
   * 现场用哪个由人决定，所以做成开关而不是替换。 */
  var HERO_SESSION = /(?:\?|&)hero=session(?:&|$)/.test(root.location.search);
  function heroVal(m)  { return HERO_SESSION ? m.session.crawls : m.crawls; }
  function heroRate(m) { return m.crawlsPerSec; }

  function ensureDigits(m) {
    var a = Math.max(7, digitsOf(heroVal(m))), b = Math.max(6, digitsOf(m.pages));
    if (a === odoMain.n && b === odoPages.n) return;
    MAIN_DIGITS = a; PAGE_DIGITS = b;
    odoMain = new Odometer(doc.getElementById('odoMain'), a);
    odoPages = new Odometer(doc.getElementById('odoPages'), b);
    layoutOdometers();
  }

  function frame() {
    E.update();
    var dtMs = E.dt(), dtS = dtMs / 1000;
    var m = E.metrics();

    G.frame(dtMs);

    ensureDigits(m);
    odoMain.update(heroVal(m), heroRate(m) * E.speed * (E.paused ? 0 : 1));
    odoPages.update(m.pages, m.pagesPerSec * E.speed * (E.paused ? 0 : 1));

    /* 爬虫弧线：展示速率 13/s（真实约 42/s，3 倍降采样），同屏上限 40 条。
     * 低于 8/s 时球面只有零星几条线，读作「几根杂线」而不是「一场雨」。 */
    var cr = E.pollCrawls(22);   /* 展示速率（真实 47/s 全画会糊）：13 -> 22，同屏稳定 30~40 条 */
    for (var i = 0; i < cr.length; i++) G.spawnCrawl(cr[i]);

    var od = E.pollOrders();
    for (i = 0; i < od.length; i++) onOrder(od[i]);

    var ms = E.pollMilestones();
    if (ms.length && msT < 0) celebrate(ms[0]);

    stepCards(dtS);
    stepMilestone(dtS);

    /* 暗角 / 体积光：只写 opacity，且幅度封顶（暗角 +30%，体积光 8%） */
    vigEl.style.opacity = (0.40 + G.vignette).toFixed(3);
    rayEl.style.opacity = G.godray.toFixed(3);

    rateTick += dtMs;
    if (rateTick > 480) {
      rateTick = 0;
      rateVal.textContent = m.crawlsPerSec.toFixed(1);
      cvSecEl.textContent = Math.round(m.secondsPerOrder);
      cvPgEl.textContent = Math.round(m.pagesPerSec * 60);
      if (m.nextMilestone.value !== lastMsVal) {
        lastMsVal = m.nextMilestone.value;
        msRemain.textContent = E.fmtInt(lastMsVal);
      }
    }
    barTick++;
    if (barTick > 4) {
      barTick = 0;
      barFill.style.transform = 'scaleX(' +
        Math.max(0.002, Math.min(1, m.nextMilestone.progress)).toFixed(4) + ')';
    }

    root.APDiag.orders = m.orders;
    stepFps(dtMs, Date.now());
    root.requestAnimationFrame(frame);
  }

  /* =====================================================================
   * 十、启动
   * ===================================================================== */
  function boot() {
    E = root.APEngine; A = root.APAudio; G = root.APGlobe;

    stage = doc.getElementById('stage');
    cvs = doc.getElementById('globe');
    gridEl = doc.getElementById('grid');
    msEl = doc.getElementById('ms');
    msVal = doc.getElementById('msVal');
    msKey = doc.getElementById('msKey');
    bootEl = doc.getElementById('boot');
    legendEl = doc.getElementById('legend');
    vigEl = doc.getElementById('vig');
    rayEl = doc.getElementById('ray');
    rateVal = doc.getElementById('rateVal');
    msRemain = doc.getElementById('msRemain');
    cvSecEl = doc.getElementById('cvSec');
    cvPgEl = doc.getElementById('cvPg');
    if (HERO_SESSION) {
      var hl = doc.getElementById('heroLb');
      if (hl) hl.textContent = '本场 AI 爬虫访问 · THIS SHOW';
    }
    barFill = doc.getElementById('barFill');
    statusEl = doc.getElementById('status');

    root.APDiag = { fps: 0, fpsAvg: 0, orders: 0 };

    E.init();
    G.init(cvs);

    var m0 = E.metrics();
    MAIN_DIGITS = Math.max(7, digitsOf(m0.crawls));
    PAGE_DIGITS = Math.max(6, digitsOf(m0.pages));
    odoMain = new Odometer(doc.getElementById('odoMain'), MAIN_DIGITS);
    odoPages = new Odometer(doc.getElementById('odoPages'), PAGE_DIGITS);
    layoutOdometers();

    buildCards();
    buildPlatform();

    /* 首帧就把事件区填满：用引擎自己的生成器补三单「最近成交」，
     * 金额挑成 common / rare / epic 各一，避免开屏全是大单、过度承诺。
     * 走的是正常订单通路（弧线 + 信使 + 卡片），此刻音频未解锁所以静音。 */
    var seed = [58, 372];
    for (var si = 0; si < seed.length; si++) E.triggerOrder({ usd: seed[si] });

    if (root.location.search.indexOf('debug=grid') >= 0) toggleGrid();

    root.addEventListener('resize', fit);
    root.addEventListener('keydown', onKey);
    fit();
    setStatus();

    bootEl.addEventListener('click', function () {
      A.unlock();                 /* 必须在用户手势里 */
      A.setAmbient(true);         /* 旗舰方案开环境音床，让整块屏「活着」 */
      A.selfTest();               /* 现场开机自检：HDMI 会把默认输出切到显示器 */
      bootEl.classList.add('gone');
      root.setTimeout(function () { bootEl.style.display = 'none'; }, 700);
    });

    /* 字体可能晚于首帧就绪，就绪后重算一次字宽槽 */
    if (doc.fonts && doc.fonts.ready && doc.fonts.ready.then) {
      doc.fonts.ready.then(function () { layoutOdometers(); });
    }

    root.requestAnimationFrame(frame);
  }

  root.APApp = { boot: boot, reset: doReset };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
