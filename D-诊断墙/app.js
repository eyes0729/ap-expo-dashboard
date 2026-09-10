/* ===========================================================================
 * AP 展会大屏 · 方案 D「诊断墙」
 * ---------------------------------------------------------------------------
 * 一句话定位：输入你的域名，看看 AI 现在读到了你店里的多少。
 *
 * 与另外三个方案的分工：A/B/C 讲「我们很牛」，D 讲「你有问题」——
 * 用三项可客观核实的检查制造缺口，当场把观众变成线索。
 * 因此这块屏必须跟现场已定稿的《AP 展会互动 · 问卷分流 + 大转盘》SOP 对齐：
 *   扫码 -> 问卷分流(Q1 身份 / Q2 是否在用 Shopify) -> 大转盘 100% 中奖 -> 领奖
 *   奖项映射（SOP 第三节，逐条落在 classify() 里）：
 *     商家 + 正在运营 Shopify  -> 免费 3 个 AP 来源订单
 *     商家 + 没有 / 计划做      -> 1v1 专家诊断
 *     供应商                    -> 定制帆布袋
 *     服务商                    -> AP 定制扇子
 *
 * 技术红线（见 _共享规格.md §2）：classic script / 零网络 / 不改 _shared /
 * 随机一律 APEngine.hash32 / 步长一律 APEngine.dt() / 事件卡对象池。
 * =========================================================================== */
(function (root) {
  'use strict';

  /* 演示键（B / N）的阶梯游标 —— 见 engine.js CONFIG.DEMO_LADDERS */
  var demoSeq = 0;

  var E = root.APEngine, A = root.APAudio;
  var W = 1920, H = 1080;

  function el(id) { return document.getElementById(id); }
  function txt(node, s) { if (node && node.__v !== s) { node.__v = s; node.textContent = s; } }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* 虚拟时间 -> 展会当地时钟（时区跟引擎一致，锁 UTC+8，不读系统时区） */
  function hhmmss(ms) {
    var d = new Date(ms + 8 * 3600000);
    return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
  }

  /* ---------------------------------------------------------------- 适配 */
  var stage = el('stage');
  function fit() {
    var s = Math.min(root.innerWidth / W, root.innerHeight / H);
    stage.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
  }
  root.addEventListener('resize', fit);

  /* ================================================================
   * 一、Odometer —— 巨型数字的四条硬规则都落在这里
   *   1) 每位一个固定宽度槽（em 单位），整体右对齐 -> 进位向左长，右侧标签不动
   *   2) 只写 transform: translate3d()，绝不每帧改 textContent
   *   3) 单调递增 + 停在整数（dwell 曲线），跨 9->0 走条带上的重复位，不倒退
   *   4) 缓动 1-(1-t)^5，无 back / elastic，overshoot = 0
   * ================================================================ */
  var POW10 = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10];

  /* 滚动窗口必须按「时间」算，不能按「周期比例」算。
   * 原实现固定在每一位自己周期的最后 38% 滚动，看着合理，但百位的周期是
   * 100/46 ≈ 2.17 秒，38% 就是 0.83 秒卡在两个字形之间 —— 截图里就是那个
   * 看不出是几的怪符号（`421,765,▮81`）。
   * 现在每一位都只滚固定的 ROLL_MS，比一帧还快的那一位直接整格吸附。 */
  var ROLL_MS = 200;
  function dwellPos(p, periodMs) {
    var fl = Math.floor(p), f = p - fl;
    if (!(periodMs > 34)) return fl;      /* 比一帧还快：整格吸附，永远是完整字形 */
    var w = ROLL_MS / periodMs;
    if (w > 0.38) w = 0.38;
    var t = (f - (1 - w)) / w;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return fl + t * t * (3 - 2 * t);
  }
  function mod10(x) { var m = x % 10; return m < 0 ? m + 10 : m; }

  function Odometer(host, pattern, F, slotEm, sepEm) {
    this.host = host; this.step = F;
    this.mask = Math.round(F * 0.92);          /* 遮罩略窄于步长：裁掉行距死区又不碰字形 */
    this.off = (this.step - this.mask) / 2;
    this.digits = []; this.wc = false;
    var nD = 0, nS = 0, i, k;
    for (i = 0; i < pattern.length; i++) { if (pattern.charAt(i) === 'd') nD++; else nS++; }
    host.style.fontSize = F + 'px';
    host.style.height = this.mask + 'px';
    host.style.width = (nD * slotEm + nS * sepEm).toFixed(3) + 'em';
    for (i = 0; i < pattern.length; i++) {
      var ch = pattern.charAt(i), sp = document.createElement('span');
      if (ch === 'd') {
        sp.className = 'od-slot';
        sp.style.width = slotEm + 'em';
        sp.style.height = this.mask + 'px';
        var st = document.createElement('span');
        st.className = 'od-strip';
        for (k = 0; k < 20; k++) {          /* 20 位条带：一次最多滚 9 步也不越界 */
          var dg = document.createElement('span');
          dg.className = 'od-d';
          dg.style.height = this.step + 'px';
          dg.style.lineHeight = this.step + 'px';
          dg.textContent = String(k % 10);
          st.appendChild(dg);
        }
        sp.appendChild(st);
        this.digits.push({ el: sp, strip: st, pos: 0, wrote: -99, cur: 0,
                           from: 0, to: 0, tt: 0, dur: 0, delay: 0 });
      } else {
        sp.className = 'od-sep';
        sp.style.width = sepEm + 'em';
        sp.style.height = this.mask + 'px';
        sp.style.lineHeight = this.mask + 'px';
        sp.textContent = ch;
      }
      host.appendChild(sp);
    }
    this.paint();
  }

  Odometer.prototype.paint = function () {
    for (var i = 0; i < this.digits.length; i++) {
      var s = this.digits[i];
      if (Math.abs(s.pos - s.wrote) < 0.0006) continue;   /* 高位几乎不动，省掉样式写入 */
      s.wrote = s.pos;
      s.strip.style.transform =
        'translate3d(0,' + (-(s.pos * this.step + this.off)).toFixed(2) + 'px,0)';
    }
  };

  /** 计数器模式：最低 fast 位连续滚，高位只在真进位时滚一次（40ms stagger） */
  /** @param rate 该指标每秒增加多少（用来把滚动窗口折算成时间） */
  Odometer.prototype.setCounter = function (v, fast, rate) {
    var n = this.digits.length, i, s, p, tgt, stepN;
    if (!(v > 0)) v = 0;
    if (!(rate > 0)) rate = 46;
    for (i = 0; i < n; i++) {
      s = this.digits[n - 1 - i];
      if (i < fast) {
        p = v / POW10[i];
        s.pos = mod10(dwellPos(p, POW10[i] / rate * 1000));
        s.cur = Math.floor(p) % 10;
        s.dur = 0;
      } else {
        tgt = Math.floor(v / POW10[i]) % 10;
        if (tgt !== s.cur) {
          if (s.dur > 0) { s.pos = mod10(s.to); s.dur = 0; }
          stepN = ((tgt - mod10(Math.round(s.pos))) + 10) % 10;
          s.cur = tgt;
          if (stepN === 0) continue;
          s.from = s.pos; s.to = s.pos + stepN;
          s.tt = 0; s.dur = 720; s.delay = (i - fast) * 40;
        }
      }
    }
  };

  /** 直接落位（画面不可见时用，例如新卡淡入前把分数归零） */
  Odometer.prototype.jumpTo = function (v) {
    var n = this.digits.length, i, s;
    for (i = 0; i < n; i++) {
      s = this.digits[n - 1 - i];
      s.cur = Math.floor(v / POW10[i]) % 10;
      s.pos = s.cur; s.dur = 0; s.tt = 0;
    }
    this.paint();
  };

  /** 向上滚到目标值（分数从 0 涨上来，方向恒定向上，不会出现倒退） */
  Odometer.prototype.rollTo = function (v, dur) {
    var n = this.digits.length, i, s, tgt, stepN;
    for (i = 0; i < n; i++) {
      s = this.digits[n - 1 - i];
      tgt = Math.floor(v / POW10[i]) % 10;
      if (s.dur > 0) { s.pos = mod10(s.to); s.dur = 0; }
      stepN = ((tgt - mod10(Math.round(s.pos))) + 10) % 10;
      s.cur = tgt;
      if (stepN === 0) continue;
      s.from = s.pos; s.to = s.pos + stepN;
      s.tt = 0; s.dur = dur || 780; s.delay = i * 40;
    }
  };

  /** 前导零留白：分数 42 只亮两位，100 才亮三位（右对齐，向左生长） */
  Odometer.prototype.setLead = function (visible) {
    var n = this.digits.length;
    for (var i = 0; i < n; i++) {
      this.digits[i].el.style.visibility = (i < n - visible) ? 'hidden' : 'visible';
    }
  };

  Odometer.prototype.update = function (dt) {
    var any = false, i, s, t;
    for (i = 0; i < this.digits.length; i++) {
      s = this.digits[i];
      if (s.dur <= 0) continue;
      any = true;
      s.tt += dt;
      t = (s.tt - s.delay) / s.dur;
      if (t <= 0) continue;
      if (t >= 1) { s.pos = mod10(s.to); s.dur = 0; s.tt = 0; }
      else { s.pos = s.from + (s.to - s.from) * (1 - Math.pow(1 - t, 5)); }
    }
    /* will-change 只在动画期间挂，结束立刻摘掉 */
    if (any !== this.wc) {
      this.host.style.willChange = any ? 'transform' : 'auto';
      this.wc = any;
    }
    this.paint();
  };

  /* ================================================================
   * 二、二维码占位（Canvas 手绘，零依赖零库）
   *   ⚠ 上会前必须替换为真实问卷链接的二维码，见 README「上会前待办」。
   * ================================================================ */
  function drawQR() {
    var c = el('qr');
    if (!c || !c.getContext) return;
    var g = c.getContext('2d'), N = 27, m = 8, S = N * m, x, y;
    var LIGHT = '#B8FFCE', DARK = '#04120C';
    g.fillStyle = LIGHT; g.fillRect(0, 0, S, S);
    function inFinder(x, y) {
      return (x < 8 && y < 8) || (x > N - 9 && y < 8) || (x < 8 && y > N - 9);
    }
    function inAlign(x, y) { return x >= N - 7 && x <= N - 3 && y >= N - 7 && y <= N - 3; }
    g.fillStyle = DARK;
    for (y = 1; y < N - 1; y++) {
      for (x = 1; x < N - 1; x++) {
        if (inFinder(x, y) || inAlign(x, y) || x === 6 || y === 6) continue;
        if (E.hash32(y * 131 + x, 7001) > 0.5) g.fillRect(x * m, y * m, m, m);
      }
    }
    for (x = 8; x < N - 8; x++) {              /* 时序图案 */
      if (x % 2 === 0) { g.fillRect(x * m, 6 * m, m, m); g.fillRect(6 * m, x * m, m, m); }
    }
    function finder(cx, cy) {
      g.fillStyle = DARK;  g.fillRect(cx * m, cy * m, 7 * m, 7 * m);
      g.fillStyle = LIGHT; g.fillRect((cx + 1) * m, (cy + 1) * m, 5 * m, 5 * m);
      g.fillStyle = DARK;  g.fillRect((cx + 2) * m, (cy + 2) * m, 3 * m, 3 * m);
    }
    finder(1, 1); finder(N - 8, 1); finder(1, N - 8);
    g.fillStyle = DARK;  g.fillRect((N - 7) * m, (N - 7) * m, 5 * m, 5 * m);
    g.fillStyle = LIGHT; g.fillRect((N - 6) * m, (N - 6) * m, 3 * m, 3 * m);
    g.fillStyle = DARK;  g.fillRect((N - 5) * m, (N - 5) * m, m, m);
  }

  /* ================================================================
   * 三、诊断数据（原型全假；正式版接轻量检测服务，见 README 风险 5）
   *   只做三项「能被观众自己复核」的检查。绝不输出
   *   「你在某个 AI 助手里排第几」这类无法核实、必然误诊的结论。
   * ================================================================ */
  var PRIZE = {
    orders: '免费 3 个 AP 来源订单',
    clinic: '1v1 专家诊断',
    tote:   '定制帆布袋',
    fan:    'AP 定制扇子'
  };
  var ROBOTS_TXT = { pass: '放行', partial: '部分放行', block: '未放行' };

  /* 问卷分流 -> 奖项，逐条对齐 SOP 第三节。
   * site=false 的观众（无独立站）没有可诊断对象，只计数不上主卡 —— 这是
   * 「绝不误诊」的一部分：没有域名就不产出分数。 */
  function classify(seed) {
    var u = E.hash32(seed, 2027);
    if (u < 0.52) return { id: 'merchant', shopify: true,  site: true,  prize: 'orders' };
    if (u < 0.72) return { id: 'merchant', shopify: false, site: true,  prize: 'clinic' };
    if (u < 0.80) return { id: 'merchant', shopify: false, site: false, prize: 'clinic' };
    if (u < 0.89) return { id: 'supplier', shopify: false, site: false, prize: 'tote' };
    return             { id: 'service',  shopify: false, site: false, prize: 'fan' };
  }

  function makeDiagnosis(seed, sample, forceSite) {
    var c = classify(seed);
    if (forceSite && !c.site) {
      /* 强制产出可诊断卡（示例卡 / S 键演示）时改判为商家分支。
       * 直接把 site 置 true 会出现"供应商却有独立站体检报告"的自相矛盾。 */
      c = (E.hash32(seed, 2029) < 0.72)
        ? { id: 'merchant', shopify: true,  site: true, prize: 'orders' }
        : { id: 'merchant', shopify: false, site: true, prize: 'clinic' };
    }
    var store = E.makeStore(Math.floor(E.hash32(seed, 1013) * E.CONFIG.STORES));
    var d = { seed: seed, sample: !!sample, store: store, identity: c.id,
              shopify: c.shopify, site: c.site,
              prizeKey: c.prize, prize: PRIZE[c.prize], at: 0 };
    if (!c.site) return d;

    var r = E.hash32(seed, 3109);
    d.robots = r < 0.30 ? 'block' : (r < 0.70 ? 'partial' : 'pass');
    d.schema = Math.round(20 + 72 * Math.pow(E.hash32(seed, 3121), 0.92));
    d.langM = E.CONFIG.LANGS;
    var lu = E.hash32(seed, 3137);
    d.langN = lu < 0.50 ? 1 : (lu < 0.72 ? 2 : (lu < 0.85 ? 3
             : 4 + Math.floor(E.hash32(seed, 3141) * 4)));

    /* 综合分 = robots 30 + 结构化 45 + 多语言 25。权重写在这里，
     * 现场立牌上也印同一套，观众可以自己复算 —— 可复算才不叫玄学。 */
    var rw = d.robots === 'pass' ? 1 : (d.robots === 'partial' ? 0.5 : 0);
    d.score = Math.round(30 * rw + 45 * (d.schema / 100) + 25 * (d.langN / d.langM));
    d.gap = d.schema - 66;
    d.concl = d.score < 35 ? 'AI 几乎读不到你的商品'
            : d.score < 50 ? 'AI 只读到了一小部分'
            : d.score < 65 ? 'AI 读到一半，另一半是盲区'
            : d.score < 80 ? '基础在，缺多语言与结构化'
            :                '读取良好，差的是覆盖面';
    return d;
  }

  /* 敏感词 / 竞品名过滤。原型只放占位词；正式版必须接完整词库 +
   * 人工放行，见 README 风险 2。绝不做「用户输入直连上屏」。 */
  var BLOCKLIST = ['badword', 'competitor-x', 'blocked-demo'];
  function isClean(s) {
    s = String(s || '').toLowerCase();
    for (var i = 0; i < BLOCKLIST.length; i++) if (s.indexOf(BLOCKLIST[i]) >= 0) return false;
    return true;
  }

  /* ================================================================
   * 四、两个对象池：已诊断列表（8 节点 / 可见 3）与订单播报（6 节点）
   *   固定节点数循环复用，只改 transform + 一次性文本。
   *   绝不 append 后靠动画回调移除 —— 掉帧时回调不执行，节点会永久留下。
   * ================================================================ */
  function slide(r, slot, step, vis, anim) {
    r.__slot = slot;
    if (anim) r.classList.add('anim'); else r.classList.remove('anim');
    r.style.transform = 'translate3d(0,' + (slot * step) + 'px,0)';
    r.style.opacity = (slot >= 0 && slot < vis && r.__filled) ? '1' : '0';
  }

  var D_POOL = 8, D_VIS = 3, D_STEP = 36, dRows = [], dPending = null;
  var O_POOL = 6, O_VIS = 6, O_STEP = 40, oRows = [], oPending = null;

  function buildPools() {
    var host = el('dlist'), i, r;
    for (i = 0; i < D_POOL; i++) {
      r = document.createElement('div');
      r.className = 'drow';
      r.innerHTML = '<span class="d-score"></span><span class="d-name"></span>' +
                    '<span class="d-dom"></span><span class="d-prize"></span>';
      r.__s = r.children[0]; r.__n = r.children[1];
      r.__d = r.children[2]; r.__p = r.children[3];
      slide(r, i, D_STEP, D_VIS, false);
      host.appendChild(r); dRows.push(r);
    }
    host = el('ofeed');
    for (i = 0; i < O_POOL; i++) {
      r = document.createElement('div');
      r.className = 'orow';
      r.innerHTML = '<span class="o-amt"></span><span class="o-name"></span>' +
                    '<span class="o-city"></span><span class="o-ref"></span>';
      r.__a = r.children[0]; r.__n = r.children[1];
      r.__c = r.children[2]; r.__r = r.children[3];
      slide(r, i, O_STEP, O_VIS, false);
      host.appendChild(r); oRows.push(r);
    }
  }

  function reuseBottom(rows) {
    var best = rows[0];
    for (var i = 1; i < rows.length; i++) if (rows[i].__slot > best.__slot) best = rows[i];
    return best;
  }

  function pushDiag(d) {
    var r = reuseBottom(dRows), i;
    txt(r.__s, (d.score === undefined || d.score === null) ? '—' : String(d.score));
    txt(r.__n, d.store.name);
    txt(r.__d, d.store.domain);
    txt(r.__p, (d.sample ? '示例 · ' : '') + d.prize);
    r.__filled = true;
    slide(r, -1, D_STEP, D_VIS, false);       /* 先无动画放到可见区上方（被裁掉） */
    dPending = r;                             /* 下一帧再滑入 slot 0，让 transition 生效 */
    for (i = 0; i < dRows.length; i++) if (dRows[i] !== r) {
      slide(dRows[i], Math.min(dRows[i].__slot + 1, D_POOL - 1), D_STEP, D_VIS, true);
    }
  }

  function pushOrder(o) {
    var r = reuseBottom(oRows), i;
    txt(r.__a, E.fmtMoney(o.amount, o.currency, o.locale));
    r.__a.className = 'o-amt' + (E.TIER_RANK[o.tier] >= E.TIER_RANK.epic ? ' big' : '');
    txt(r.__n, o.store.name);
    txt(r.__c, o.buyerCity);
    txt(r.__r, 'via ' + o.referrer);
    r.__filled = true;
    el('owait').style.display = 'none';
    slide(r, -1, O_STEP, O_VIS, false);
    oPending = r;
    for (i = 0; i < oRows.length; i++) if (oRows[i] !== r) {
      slide(oRows[i], Math.min(oRows[i].__slot + 1, O_POOL - 1), O_STEP, O_VIS, true);
    }
  }

  /* ================================================================
   * 五、主卡渲染 + 状态机（待机示例 <-> 现场真卡停留 20 秒）
   * ================================================================ */
  var DEF_LINE = ' · 检测项：robots.txt 放行 / 商品页 JSON-LD 必填字段 / 已上线市场数';
  var scoreOdo, crawlOdo, pagesOdo;

  function renderHero(d) {
    var card = el('card');
    card.classList.remove('in');
    card.classList.add('enter');

    txt(el('sname'), d.store.name);
    txt(el('sdom'), d.store.domain);
    txt(el('smeta'), '检测时间 ' + hhmmss(d.at) + DEF_LINE);
    var b = el('badge');
    b.className = 'badge ' + (d.sample ? 'sample' : 'live');
    txt(b, d.sample ? 'SAMPLE · 示例' : 'LIVE · 现场提交');
    txt(el('prizetxt'), d.prize);

    txt(el('ck1v'), ROBOTS_TXT[d.robots]);
    el('ck1v').className = 'ck-v' + (d.robots === 'pass' ? '' : ' bad');
    el('ck1b').style.width = (d.robots === 'pass' ? 100 : (d.robots === 'partial' ? 50 : 0)) + '%';

    txt(el('ck2v'), d.schema + '%');
    el('ck2v').className = 'ck-v' + (d.schema < 66 ? ' bad' : '');
    el('ck2b').style.width = d.schema + '%';

    txt(el('ck3v'), d.langN + ' / ' + d.langM);
    el('ck3v').className = 'ck-v' + (d.langN < d.langM ? ' bad' : '');
    el('ck3b').style.width = Math.round(d.langN / d.langM * 100) + '%';

    txt(el('concl'), d.concl);
    txt(el('scoregap'), d.gap < 0 ? ('结构化数据比行业平均低 ' + (-d.gap) + ' 个点')
                                  : ('结构化数据高于平均 ' + d.gap + ' 个点'));

    scoreOdo.setLead(d.score >= 100 ? 3 : (d.score >= 10 ? 2 : 1));
    scoreOdo.jumpTo(0);

    void card.offsetWidth;                     /* 强制一次回流，让入场动画重放 */
    card.classList.remove('enter');
    card.classList.add('in');
    scoreOdo.rollTo(d.score, 820);             /* 0 -> 分数，方向恒定向上 */
  }

  var hero = { cur: null, mode: 'boot', holdUntil: 0, nextSample: 0, sIdx: 0 };
  var review = [], liveQ = [];
  var blocked = 0, realCount = 0, noSiteCount = 0;
  var scanIdx = 0, nextScanAt = 0;

  /* 审核延迟：自动到达走接近现场的 5~10 秒；S 键缩到 1.6 秒，
   * 保证 BD 讲到关键处按下去立刻有反应（正式版一律 5~10 秒 + 人工放行）。 */
  var REVIEW_KEY_MS = 1600;

  function submitScan(quick) {
    var t = E.now();
    scanIdx++;
    var seed = 40000 + scanIdx * 7919 + Math.floor(t / 997);
    var d = makeDiagnosis(seed, false, !!quick);
    d.at = t;
    if (!isClean(d.store.name + ' ' + d.store.domain)) { blocked++; return null; }
    if (!d.site) { noSiteCount++; return d; }
    var delay = quick ? REVIEW_KEY_MS : (5000 + E.hash32(seed, 4409) * 5000);
    review.push({ d: d, at: t + delay });
    /* S 键连按时不能让人等：把当前卡的剩余停留压到 2.2 秒，
     * 队列也只留最近 4 张 —— 讲解节奏优先于"每张都播完"。 */
    if (quick && hero.mode === 'live') hero.holdUntil = Math.min(hero.holdUntil, t + 2200);
    return d;
  }

  function retire(d) {
    if (!d || d.sample) return;
    realCount++;
    pushDiag(d);
  }

  function updateHero(t) {
    var i, keep = [];
    for (i = 0; i < review.length; i++) {
      if (review[i].at <= t) liveQ.push(review[i].d); else keep.push(review[i]);
    }
    review = keep;

    while (liveQ.length > 4) liveQ.shift();
    if (hero.mode === 'live' && t < hero.holdUntil) return;
    if (liveQ.length) {
      retire(hero.cur);
      hero.cur = liveQ.shift();
      hero.mode = 'live';
      hero.holdUntil = t + 20000;
      renderHero(hero.cur);
      A.blip();
      return;
    }
    if (hero.mode === 'live') {
      retire(hero.cur);
      hero.cur = null; hero.mode = 'idle'; hero.nextSample = 0;
    }
    if (t >= hero.nextSample) {
      hero.sIdx++;
      hero.cur = makeDiagnosis(90000 + hero.sIdx * 13, true, true);
      hero.cur.at = t;
      hero.mode = 'idle';
      hero.nextSample = t + 12000;
      renderHero(hero.cur);
    }
  }

  /* ================================================================
   * 六、里程碑
   *   pages 每 1000 页（约 14 分钟一次）只填满进度条 + 轻脉冲，不接管全屏；
   *   orders / crawls（合起来约 30 分钟一次）才做 3.8 秒全屏庆祝。
   *   —— 全屏接管太频繁会把主角（观众自己的分数）挤掉。
   * ================================================================ */
  var msLeft = 0, pulseLeft = 0;

  function celebrate(metric, value) {
    txt(el('mslab'), metric === 'orders' ? 'AI 引荐订单 · MILESTONE' : 'AI 爬虫抓取 · MILESTONE');
    txt(el('msnum'), E.fmtInt(value));
    txt(el('msunit'), metric === 'orders' ? '单 · 累计达成' : '次 · 累计达成');
    el('msov').classList.add('on');
    msLeft = 3800;
    A.playMilestone();
  }
  function pagesPulse() { pulseLeft = 900; el('msbar').classList.add('hit'); }

  /* ================================================================
   * 七、调试网格 / 快捷键 / FPS 自监控
   * ================================================================ */
  var gridOn = (root.location.search || '').indexOf('debug=grid') >= 0;
  function applyGrid() { el('gridov').className = 'gridov' + (gridOn ? ' on' : ''); }

  var oQueue = [], dQueue = [], oGate = 0, dGate = 0;
  var hallOn = false, ambientOn = false;

  function resetAll() {
    E.reset();
    review = []; liveQ = []; oQueue = []; dQueue = [];
    oPending = null; dPending = null;
    blocked = 0; realCount = 0; noSiteCount = 0; scanIdx = 0;
    hero = { cur: null, mode: 'boot', holdUntil: 0, nextSample: 0, sIdx: 0 };
    msLeft = 0; el('msov').classList.remove('on');
    var i;
    for (i = 0; i < dRows.length; i++) {
      txt(dRows[i].__s, ''); txt(dRows[i].__n, '');
      txt(dRows[i].__d, ''); txt(dRows[i].__p, '');
      dRows[i].__filled = false;
      slide(dRows[i], i, D_STEP, D_VIS, false);
    }
    for (i = 0; i < oRows.length; i++) {
      txt(oRows[i].__a, ''); txt(oRows[i].__n, '');
      txt(oRows[i].__c, ''); txt(oRows[i].__r, '');
      oRows[i].__filled = false;
      slide(oRows[i], i, O_STEP, O_VIS, false);
    }
    seedList();
    el('owait').style.display = '';
    nextScanAt = E.now() + 5000;
    updateHero(E.now());
  }

  function toggleFull() {
    try {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen();
      else document.exitFullscreen();
    } catch (err) { /* file:// 或权限受限时静默降级 */ }
  }

  function onKey(e) {
    var k = e.key || '', u = k.toUpperCase();
    if (k === ' ' || k === 'Spacebar') { E.togglePause(); A.blip(); e.preventDefault(); return; }
    switch (u) {
      case 'S': submitScan(true); A.blip(); break;              /* 核心演示动作 */
      case 'M': A.toggleMute(); break;
      case 'B': E.triggerOrder(); break;
      case 'N': E.triggerOrder({ usd: E.demoAmount('common', demoSeq++) }); break;
      case 'K': celebrate('orders',
                  Math.floor(E.metrics().orders / E.CONFIG.MILESTONE_ORDERS) *
                  E.CONFIG.MILESTONE_ORDERS); break;
      case '1': E.setSpeed(0.5); A.blip(); break;
      case '2': E.setSpeed(1);   A.blip(); break;
      case '3': E.setSpeed(3);   A.blip(); break;
      case 'G': gridOn = !gridOn; applyGrid(); break;
      case 'H': hallOn = !hallOn; A.setHallMode(hallOn); A.blip(); break;
      case 'A': ambientOn = !ambientOn; A.setAmbient(ambientOn); break;
      case 'F': toggleFull(); break;
      case 'R': resetAll(); break;
      default:
        if (k === '?' || k === '/') el('legend').classList.toggle('on');
    }
  }

  /* 60 秒环形缓冲平均 FPS。掉到 40 以下打一次 console 警告
   * （原型不做自动软重置，正式版需要，见 README 待办）。 */
  var fpsRing = new Array(60), fpsN = 0, fpsAcc = 0, fpsFrames = 0, fpsWarnAt = 0;
  function fpsTick(dt) {
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc < 1000) return;
    var fps = fpsFrames * 1000 / fpsAcc;
    fpsRing[fpsN % 60] = fps; fpsN++;
    fpsAcc = 0; fpsFrames = 0;
    if (fpsN % 60 !== 0) return;
    var s = 0, c = 0;
    for (var i = 0; i < 60; i++) if (fpsRing[i]) { s += fpsRing[i]; c++; }
    var avg = c ? s / c : 60;
    if (avg < 40 && Date.now() - fpsWarnAt > 60000) {
      fpsWarnAt = Date.now();
      if (root.console) root.console.warn('[AP-D] 60s 平均 FPS ' + avg.toFixed(1) + ' < 40');
    }
  }

  /* ================================================================
   * 八、主循环
   * ================================================================ */
  function pumpPools(dt) {
    oGate -= dt; dGate -= dt;
    if (oPending) { slide(oPending, 0, O_STEP, O_VIS, true); oPending = null; }
    else if (oQueue.length && oGate <= 0) { pushOrder(oQueue.shift()); oGate = 150; }
    if (dPending) { slide(dPending, 0, D_STEP, D_VIS, true); dPending = null; }
    else if (dQueue.length && dGate <= 0) { pushDiag(dQueue.shift()); dGate = 150; }
  }

  function frame() {
    var t = E.update(), dt = E.dt(), m = E.metrics(), i;

    crawlOdo.setCounter(m.crawls, 3, m.crawlsPerSec);
    pagesOdo.setCounter(m.pages, 2, m.pagesPerSec);
    crawlOdo.update(dt); pagesOdo.update(dt); scoreOdo.update(dt);

    txt(el('crawlrate'), Math.round(m.crawlsPerSec) +
      ' 次 / 秒 · GPTBot / ClaudeBot / PerplexityBot / Google-Extended');
    el('msfill').style.width = (clamp(m.nextMilestone.progress, 0, 1) * 100).toFixed(2) + '%';
    txt(el('mstext'), '距下一个里程碑 ' + E.fmtInt(m.nextMilestone.remain) + ' 页');

    var orders = E.pollOrders();
    for (i = 0; i < orders.length; i++) {
      oQueue.push(orders[i]);
      if (oQueue.length > 8) oQueue.shift();       /* 队列有硬上限，绝不无限堆积 */
    }

    var ms = E.pollMilestones();
    for (i = 0; i < ms.length; i++) {
      if (ms[i].metric === 'pages') pagesPulse();
      else celebrate(ms[i].metric, ms[i].value);
    }

    if (t >= nextScanAt) {                         /* 无人按键时也会有观众"扫码" */
      submitScan(false);
      nextScanAt = t + 38000 + E.hash32(scanIdx, 8101) * 34000;
    }

    updateHero(t);
    pumpPools(dt);

    txt(el('qmeta'), '审核队列 ' + review.length + ' · 已拦截 ' + blocked);
    txt(el('dmeta'), realCount + ' 家 · 另有 ' + noSiteCount + ' 位无独立站观众参与');

    if (msLeft > 0) { msLeft -= dt; if (msLeft <= 0) el('msov').classList.remove('on'); }
    if (pulseLeft > 0) { pulseLeft -= dt; if (pulseLeft <= 0) el('msbar').classList.remove('hit'); }

    fpsTick(dt);
    requestAnimationFrame(frame);
  }

  /* ================================================================
   * 九、启动
   * ================================================================ */
  function seedList() {
    for (var i = 0; i < D_VIS; i++) {
      var d = makeDiagnosis(70000 + i * 29, true, true);
      var r = dRows[i];
      txt(r.__s, String(d.score));
      txt(r.__n, d.store.name);
      txt(r.__d, d.store.domain);
      txt(r.__p, '示例 · ' + d.prize);
      r.__filled = true;
      slide(r, i, D_STEP, D_VIS, false);
    }
  }

  function boot() {
    E.init();
    fit();
    drawQR();
    buildPools();
    scoreOdo = new Odometer(el('scoreOdo'), 'ddd', 413, 0.54, 0.30);
    crawlOdo = new Odometer(el('crawlOdo'), 'ddd,ddd,ddd', 134, 0.54, 0.30);
    pagesOdo = new Odometer(el('pagesOdo'), 'd,ddd,ddd', 64, 0.54, 0.30);
    el('msglow').style.background = 'radial-gradient(120% 90% at 50% 46%,' +
      'rgba(0,196,106,.22) 0%, rgba(4,18,12,.97) 60%, #04120C 100%)';
    applyGrid();
    seedList();
    nextScanAt = E.now() + 5000;
    updateHero(E.now());

    var mask = el('mask');
    function enter() {
      A.unlock();                        /* 必须在一次用户手势里调 */
      A.setVoiceLang('zh-CN');
      A.selfTest();
      mask.classList.add('off');
    }
    mask.addEventListener('click', enter);
    root.addEventListener('keydown', function (e) {
      if (!mask.classList.contains('off')) { enter(); return; }
      onKey(e);
    });

    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(typeof window !== 'undefined' ? window : globalThis);
