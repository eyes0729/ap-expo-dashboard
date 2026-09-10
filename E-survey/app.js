/* ===========================================================================
 * AP 展会互动 · 问卷 + 转盘（手机 H5）
 * ---------------------------------------------------------------------------
 * 逻辑严格照《AP展会互动问卷抽奖SOP》v2（2026-08-18）：
 *
 *   一、流程   扫码 → 填问卷（身份分流 2~3 题）→ 转盘 → 中奖页
 *   二、题目   Q1 所有人；A 商家 4 题 / B 供应商 3 题 / C 服务商 3 题
 *   三、判定   商家+正在运营 Shopify → 免费 3 个 AP 来源订单
 *              商家+没有/计划做      → 1v1 专家诊断
 *              供应商（全部）        → 定制帆布袋
 *              服务商（全部）        → AP 定制扇子
 *   四、要求   100% 中奖无「谢谢参与」格；中奖页可截图可回显；数据落库可导出；
 *              防重复规则由产品定
 *
 * ⚠ 关于转盘：**结果在问卷提交时就已确定**，转盘只是过程体验，动画必然停在
 *   预定奖项上（SOP 第一节「核心逻辑」原文如此）。盘面照常展示 4 格，所以看起来
 *   像真抽奖。这不是随机数 —— 后来维护的人别把它当 RNG 改。
 *   之所以能这么做而不算欺骗：100% 中奖、不涉及金钱，且奖项差异是**资格差异**
 *   （AP 来源订单只有真有 Shopify 店的商家才用得上）。
 *
 * ⚠ 落库只用 localStorage。展会现场多台手机各存各的，**不会汇总**。
 *   真上会需要一个后端接收（SOP 第四节要求「支持按天导出」）。
 *   现在的导出只能导出这一台设备上的记录 —— 这条写进 README 的待办。
 *
 * 零网络依赖、零第三方库。
 * =========================================================================== */
(function (root) {
  'use strict';

  var doc = root.document;
  var LS_KEY = 'apSurvey.records';
  var LS_DEV = 'apSurvey.device';
  var LS_MINE = 'apSurvey.mine';
  var LS_QUEUE = 'apSurvey.pending';    /* 没推上去的记录，等下次补传 */
  /* 服务端落库接口（同源，就是发二维码那台机器）。绝对路径 —— 页面在 /E-survey/ 下，
   * 用相对路径会变成 /E-survey/api/survey。 */
  var API = '/api/survey';
  var QUEUE_MAX = 300;                  /* 队列上限，防止极端情况下把 localStorage 撑爆 */
  /* 防重复：SOP 说「规则由产品定」。这里实现「同一设备仅首次有效」，
   * 重复进入时回显上次的奖项（正好满足「可回显」那条要求）。
   * 现场若想放开，把这个改成 true。 */
  var ONE_PER_DEVICE = true;

  /* ── 奖项（盘面顺序 = SOP 第三节的 ①②③④）───────────────────────── */
  var PRIZES = [
    { name: '免费 3 个 AP 来源订单', desc: '我们帮你的店接 3 笔来自 AI 助手的真实订单，不收费。',
      color: '#1E4A42', text: '#8FF0DC' },
    { name: '1v1 专家诊断', desc: '一对一看你的店，给出 AI 可读性与选品的具体改法。',
      color: '#153244', text: '#9AD4F0' },
    { name: '定制帆布袋', desc: 'AP 定制款，现场领取。',
      color: '#43331A', text: '#F0CE9A' },
    { name: 'AP 定制扇子', desc: 'AP 定制款，现场领取。',
      color: '#3A2338', text: '#E8B7E0' }
  ];

  /* ── 题库 ─────────────────────────────────────────────────────────── */
  var Q_ROLE = {
    id: 'role', title: '您的身份是？', sub: '单选 · 必答', required: true,
    opts: [
      { v: 'A', label: '跨境电商卖家 / 品牌商家' },
      { v: 'B', label: '供应商（工厂 / 货源 / 贸易）' },
      { v: 'C', label: '服务商（广告 / 建站 / 物流 / 代运营等）' }
    ]
  };
  var BRANCH = {
    /* 商家：4 题。Q2 参与奖项判定 —— AP 来源订单只能发给真有 Shopify 店的商家 */
    A: [
      { id: 'shopify', title: '您目前是否在用 Shopify 独立站？', sub: '单选 · 必答',
        required: true, opts: [
          { v: 'yes',  label: '是，正在运营' },
          { v: 'no',   label: '没有，主要做平台（亚马逊 / Temu / TikTok Shop 等）' },
          { v: 'plan', label: '计划做，还没上线' }
        ] },
      { id: 'gmv', title: '店铺月 GMV 规模（美金）？', sub: '单选 · 必答', required: true,
        opts: [
          { v: '<5k',    label: '小于 $5,000' },
          { v: '5-10k',  label: '$5,000 – $10,000' },
          { v: '10-50k', label: '$10,000 – $50,000' },
          { v: '>50k',   label: '$50,000 以上' }
        ] },
      { id: 'contact', type: 'text', title: '留下您的微信号或手机号',
        sub: '必填 · 用于发放奖品', required: true, ph: '微信号 / 手机号' }
    ],
    /* 供应商：3 题 */
    B: [
      { id: 'category', title: '主营品类？', sub: '单选 · 必答', required: true, opts: [
          { v: '3c',     label: '3C 电子' },
          { v: 'appare', label: '服装配饰' },
          { v: 'home',   label: '家居' },
          { v: 'beauty', label: '美妆个护' },
          { v: 'other',  label: '其他' }
        ] },
      { id: 'contact', type: 'text', title: '留下您的微信号或手机号',
        sub: '必填', required: true, ph: '微信号 / 手机号' }
    ],
    /* 服务商：3 题，联系方式**选填**（SOP 原文如此） */
    C: [
      { id: 'size', title: '公司规模？', sub: '单选 · 必答', required: true, opts: [
          { v: '<10',   label: '10 人以下' },
          { v: '10-50', label: '10 – 50 人' },
          { v: '>50',   label: '50 人以上' }
        ] },
      { id: 'contact', type: 'text', title: '微信号或手机号',
        sub: '选填', required: false, ph: '选填' }
    ]
  };

  /** SOP 第三节的判定规则。返回 PRIZES 的下标。 */
  function decidePrize(a) {
    if (a.role === 'A') return (a.shopify === 'yes') ? 0 : 1;
    if (a.role === 'B') return 2;
    return 3;
  }

  /* ── 状态 ─────────────────────────────────────────────────────────── */
  var answers = {}, queue = [], step = 0, prizeIdx = -1, spun = false;

  function $(id) { return doc.getElementById(id); }
  function show(id) {
    ['scIntro', 'scQ', 'scWheel', 'scWin'].forEach(function (s) {
      $(s).classList.toggle('hide', s !== id);
    });
    root.scrollTo(0, 0);
  }

  /* ── 本地存储 ─────────────────────────────────────────────────────── */
  function lsGet(k, dflt) {
    try { var v = root.localStorage.getItem(k); return v ? JSON.parse(v) : dflt; }
    catch (e) { return dflt; }
  }
  function lsSet(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function deviceId() {
    var d = lsGet(LS_DEV, null);
    if (!d) {
      /* 不用 Math.random 做业务标识：时间戳 + 计数 + 简单散列，够唯一且可复现调试 */
      var t = Date.now();
      d = 'D' + t.toString(36).toUpperCase() + '-' + ((t * 2654435761) % 100000).toString(36).toUpperCase();
      lsSet(LS_DEV, d);
    }
    return d;
  }
  function ticketNo(ts) {
    var d = new Date(ts), p = function (n) { return ('0' + n).slice(-2); };
    var h = ((ts % 100000) * 7919) % 10000;
    return 'AP' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
      + '-' + ('000' + h).slice(-4);
  }

  /* ── 服务端落库 ───────────────────────────────────────────────────────
   * 为什么是「本地先写、再推服务端」而不是反过来：
   * 推失败**绝不允许挡住抽奖**。现场参与者不该为我们的网络问题买单，
   * 所以任何失败都只是把这条记录塞进补传队列，流程照走。
   *
   * 为什么这条链路是可靠的：手机能打开这个页面，就说明它和这台服务器在同一个
   * 局域网、同一个 origin —— POST 走的是和加载页面**完全相同**的那条路，
   * 不引入任何新的失败模式。（换成云端就要过展会 WiFi 的外网出口，那是最不可靠的一段。）
   * ------------------------------------------------------------------ */
  function postOnce(rec, done) {
    var fired = false;
    var settle = function (ok) { if (!fired) { fired = true; done(ok); } };
    try {
      var x = new XMLHttpRequest();
      x.open('POST', API, true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.timeout = 6000;
      x.onload = function () { settle(x.status >= 200 && x.status < 300); };
      x.onerror = function () { settle(false); };
      x.ontimeout = function () { settle(false); };
      x.send(JSON.stringify(rec));
    } catch (e) { settle(false); }
  }
  function enqueue(rec) {
    var q = lsGet(LS_QUEUE, []);
    /* 同一条不要排两遍（device+ts 唯一） */
    for (var i = 0; i < q.length; i++) {
      if (q[i].device === rec.device && q[i].ts === rec.ts) return;
    }
    q.push(rec);
    if (q.length > QUEUE_MAX) q = q.slice(-QUEUE_MAX);
    lsSet(LS_QUEUE, q);
  }
  function pendingCount() { return lsGet(LS_QUEUE, []).length; }
  /** 串行补传：一旦某条失败就停下来，剩下的留到下次 —— 网断了就不要空转重试 */
  function flushQueue(done) {
    var rest = lsGet(LS_QUEUE, []).slice(), sent = 0;
    (function stepOne() {
      if (!rest.length) { lsSet(LS_QUEUE, []); done && done(sent, 0); return; }
      postOnce(rest[0], function (ok) {
        if (!ok) { lsSet(LS_QUEUE, rest); done && done(sent, rest.length); return; }
        rest.shift(); sent++; stepOne();
      });
    })();
  }
  /** 落库主入口：本地一定写，服务端尽力推，推不动就排队 */
  function saveRecord(rec) {
    var all = lsGet(LS_KEY, []);
    all.push(rec);
    lsSet(LS_KEY, all);
    lsSet(LS_MINE, rec);
    postOnce(rec, function (ok) { if (!ok) enqueue(rec); });
  }

  /* ── 问卷渲染 ─────────────────────────────────────────────────────── */
  function buildQueue() {
    queue = [Q_ROLE].concat(BRANCH[answers.role] || []);
  }

  /* 身份题答完之前，分支还没展开，`queue.length` 只有 1 —— 这时候
   *   「Q1 / 1」会告诉参与者「一共就一题」
   *   「下一题」按钮会写成「提交并抽奖」（因为 step === queue.length-1）
   * 都是错的。旧版单选自动跳，这个状态只存在 180ms，没人看得见；
   * 改成手动翻页之后它变成**每个人看到的第一屏**，必须处理。 */
  function branchTotals() {
    return Object.keys(BRANCH).map(function (r) { return 1 + (BRANCH[r] || []).length; });
  }
  function roleKnown() { return !!answers.role && !!BRANCH[answers.role]; }
  /** 题数：分支定了就报实数，没定就报真实范围（现在是 3~4） */
  function totalLabel() {
    if (roleKnown()) return String(queue.length);
    var t = branchTotals(), lo = Math.min.apply(null, t), hi = Math.max.apply(null, t);
    return lo === hi ? String(lo) : (lo + '~' + hi);
  }
  /** 真的到最后一题了吗 —— 分支没定就一定不是 */
  function isLastStep() { return roleKnown() && step === queue.length - 1; }

  function renderProg() {
    /* 分支未定时按**最短**分支画格子，这样后面只会变长不会变短 */
    var t = branchTotals();
    var total = roleKnown() ? queue.length : Math.min.apply(null, t);
    var el = $('prog'), s = '';
    el.classList.remove('hide');
    for (var i = 0; i < total; i++) s += '<i class="' + (i <= step ? 'on' : '') + '"></i>';
    el.innerHTML = s;
  }
  function renderQ() {
    var q = queue[step];
    if (!q) return;
    $('qnum').textContent = 'Q' + (step + 1) + ' / ' + totalLabel();
    $('qtitle').textContent = q.title;
    $('qsub').textContent = q.sub || '';
    $('qerr').textContent = '';
    var box = $('qopts'), s = '', i;
    if (q.type === 'text') {
      s = '<input type="text" id="qtext" inputmode="text" autocomplete="off" '
        + 'placeholder="' + (q.ph || '') + '" value="'
        + String(answers[q.id] || '').replace(/"/g, '&quot;') + '">';
      box.innerHTML = s;
    } else {
      for (i = 0; i < q.opts.length; i++) {
        var o = q.opts[i];
        s += '<button class="opt' + (answers[q.id] === o.v ? ' sel' : '')
          + '" data-v="' + o.v + '"><u></u><span>' + o.label + '</span></button>';
      }
      box.innerHTML = s;
    }
    /* 文本题和单选题走同一套 —— 「提交并抽奖」只在真到最后一题时才出现 */
    $('btnNext').textContent = isLastStep() ? '提交并抽奖' : '下一题';
    $('btnBack').classList.toggle('hide', step === 0);
    /* 文本题：边打字边更新按钮可用性（必填题空着时按钮是灰的） */
    var ti = $('qtext');
    if (ti) ti.addEventListener('input', syncNextBtn);
    syncNextBtn();
    renderProg();
  }

  /** 「下一题」能不能点。
   *  必答题没答 → 按钮置灰，而不是等人点下去再弹「请选一项」。
   *  自动翻页取消之后，这个按钮成了唯一的前进入口，它的状态必须一眼看得出来。 */
  function syncNextBtn() {
    var q = queue[step], ok;
    if (!q) return;
    if (q.type === 'text') {
      var el = $('qtext');
      ok = !q.required || !!(el && el.value.trim());
    } else {
      ok = !q.required || !!answers[q.id];
    }
    $('btnNext').disabled = !ok;
  }

  /** 换身份时清掉上一条分支残留的答案（联系方式三条分支都要，保留不用重填）。
   *  不清会怎样：先选 A 答完 Shopify / GMV，再退回来改选 C，
   *  提交时那两个字段照样跟着记录落库 —— 一条「服务商」线索上挂着店铺 GMV，脏数据。
   *  自动翻页时代很难走到这条路径，改成手动翻页后回头改身份变得很常见，必须处理。 */
  function clearBranchAnswers() {
    var keep = { role: 1, contact: 1 };
    Object.keys(BRANCH).forEach(function (r) {
      (BRANCH[r] || []).forEach(function (q) { if (!keep[q.id]) delete answers[q.id]; });
    });
  }

  function onPick(v) {
    var q = queue[step];
    answers[q.id] = v;
    /* 选了身份就要重算题目队列（分流），并清掉旧分支的答案 */
    if (q.id === 'role') { clearBranchAnswers(); buildQueue(); }
    renderQ();
    /* ⚠ 这里**不要**自动进下一题。
     * 原先是 root.setTimeout(next, 180)：选完就跳，手机上确实少一次点击，
     * 但代价是手滑点错当场就被带走，只能靠「上一题」退回来重选，
     * 而且没有一个「我确认了」的动作 —— 现场很容易出现选错了却已经提交。
     * 现在：选中只更新选中态和进度，前进必须点「下一题」。 */
  }

  function next() {
    var q = queue[step];
    if (!q) return;
    if (q.type === 'text') {
      var el = $('qtext');
      answers[q.id] = el ? el.value.trim() : '';
      if (q.required && !answers[q.id]) { $('qerr').textContent = '这一项是必填的'; return; }
      if (answers[q.id] && answers[q.id].length > 60) {
        $('qerr').textContent = '太长了，请填微信号或手机号'; return;
      }
    } else if (q.required && !answers[q.id]) {
      $('qerr').textContent = '请选一项'; return;
    }
    if (step < queue.length - 1) { step++; renderQ(); return; }
    submit();
  }
  function back() { if (step > 0) { step--; renderQ(); } }

  /* ── 提交：先定奖项，再落库，最后才进转盘 ────────────────────────── */
  function submit() {
    prizeIdx = decidePrize(answers);
    var rec = {
      ts: Date.now(),
      device: deviceId(),
      role: answers.role,
      roleName: (Q_ROLE.opts.filter(function (o) { return o.v === answers.role; })[0] || {}).label || '',
      shopify: answers.shopify || '',
      gmv: answers.gmv || '',
      category: answers.category || '',
      size: answers.size || '',
      contact: answers.contact || '',
      prize: PRIZES[prizeIdx].name,
      ticket: ''
    };
    rec.ticket = ticketNo(rec.ts);
    saveRecord(rec);          /* 本地写死 + 尽力推服务端，推不动进补传队列 */
    drawWheel();
    show('scWheel');
    $('prog').classList.add('hide');
  }

  /* ── 转盘 ─────────────────────────────────────────────────────────── */
  var wheelCv = $('wheel');
  function drawWheel() {
    var g = wheelCv.getContext('2d'), W = wheelCv.width, R = W / 2, i;
    g.clearRect(0, 0, W, W);
    for (i = 0; i < 4; i++) {
      /* 第 i 格从「正上方」开始顺时针占 90°。canvas 的 0 弧度在正右方，
       * 所以起始角要减 90°。 */
      var a0 = (i * 90 - 90) * Math.PI / 180;
      var a1 = ((i + 1) * 90 - 90) * Math.PI / 180;
      g.beginPath(); g.moveTo(R, R); g.arc(R, R, R - 6, a0, a1); g.closePath();
      g.fillStyle = PRIZES[i].color; g.fill();
      g.strokeStyle = '#0A0C10'; g.lineWidth = 3; g.stroke();
      /* 文字沿半径方向排。
       * ⚠ 左半边（文字方向角在 90°~270° 之间）如果直接按半径角旋转，字会是**倒着的**。
       *   修法：整体再转 180°，同时画在**负半径**上 —— 位置完全不变，字正过来。 */
      var ang = i * 90 + 45 - 90;                 /* 该格中心相对 +x 轴的角度 */
      var flip = (ang > 90 && ang < 270) || (ang < -90 && ang > -270);
      g.save();
      g.translate(R, R);
      g.rotate((ang + (flip ? 180 : 0)) * Math.PI / 180);
      g.fillStyle = PRIZES[i].text;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      var lines = wrapLabel(PRIZES[i].name);
      var fs = lines.length > 2 ? 30 : 34;
      g.font = '700 ' + fs + 'px ' + '"PingFang SC","Microsoft YaHei",sans-serif';
      var rx = flip ? -R * 0.58 : R * 0.58;
      for (var k = 0; k < lines.length; k++) {
        g.fillText(lines[k], rx, (k - (lines.length - 1) / 2) * (fs + 6));
      }
      g.restore();
    }
    /* 外圈 */
    g.beginPath(); g.arc(R, R, R - 4, 0, Math.PI * 2);
    g.strokeStyle = '#2A3038'; g.lineWidth = 6; g.stroke();
  }
  function wrapLabel(s) {
    if (s.length <= 7) return [s];
    /* 在数字/空格边界折，避免把「3 个」拆开 */
    if (s === '免费 3 个 AP 来源订单') return ['免费 3 个', 'AP 来源订单'];
    if (s === '1v1 专家诊断') return ['1v1', '专家诊断'];
    var mid = Math.ceil(s.length / 2);
    return [s.slice(0, mid), s.slice(mid)];
  }

  function spin() {
    if (spun) return;
    spun = true;
    $('btnSpin').disabled = true;
    $('btnSpin').textContent = '转动中…';
    /* 让第 prizeIdx 格的中心停在正上方的指针下。
     * 盘面第 i 格中心在「顺时针 i*90+45 度」处，所以要把盘面**逆时针**转回来。
     * 再加 6 整圈；抖动 ±30° 让它别每次都停在正中间（那样太假）。 */
    var base = 360 * 6;
    var center = prizeIdx * 90 + 45;
    var jitter = ((Date.now() % 61) - 30);          /* -30..+30，不用 Math.random */
    var deg = base + (360 - center) + jitter;
    wheelCv.style.transform = 'rotate(' + deg + 'deg)';
    root.setTimeout(function () {
      showWin(lsGet(LS_MINE, null));
    }, 4900);
  }

  /* ── 中奖页 ───────────────────────────────────────────────────────── */
  function showWin(rec) {
    if (!rec) return;
    var p = PRIZES[PRIZES.map(function (x) { return x.name; }).indexOf(rec.prize)] || PRIZES[3];
    $('pname').textContent = rec.prize;
    $('pdesc').textContent = p.desc;
    var d = new Date(rec.ts), pad = function (n) { return ('0' + n).slice(-2); };
    $('ticket').innerHTML =
      '凭证编号　<b>' + rec.ticket + '</b><br>' +
      '身份　　　<b>' + rec.roleName + '</b><br>' +
      '联系方式　<b>' + (rec.contact || '（未留）') + '</b><br>' +
      '时间　　　<b>' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + '</b>';
    show('scWin');
    $('prog').classList.add('hide');
  }

  /* ── 管理面板（?admin=1）───────────────────────────────────────────
   * 数据来源有两个，**口径必须在屏上写清楚**：
   *   服务端 —— 全场所有手机的汇总（这才是能用来跟进线索的那份）
   *   本机   —— 只有这一台设备，服务端连不上时的兜底
   * 上一版只有「本机」一种，却没说清，很容易把一台手机的 3 条当成全场 3 条。 */
  var adminSource = 'local';            /* 'server' | 'local' */

  /** 想在**手机上**看全场汇总，就得带 token：?admin=1&k=<token>
   *  （token 是 _serve.js 启动时打印的那一串；不带 token 只有本机能读） */
  function adminToken() {
    var m = /[?&]k=([^&]+)/.exec(root.location.search || '');
    return m ? m[1] : '';
  }
  function fetchServer(cb) {
    try {
      var k = adminToken();
      var x = new XMLHttpRequest();
      x.open('GET', API + '/list' + (k ? '?k=' + encodeURIComponent(k) : ''), true);
      x.timeout = 6000;
      x.onload = function () {
        if (x.status < 200 || x.status >= 300) return cb(null, x.status);
        try {
          var j = JSON.parse(x.responseText);
          cb(j && j.ok ? (j.rows || []) : null, x.status);
        } catch (e) { cb(null, x.status); }
      };
      x.onerror = function () { cb(null, 0); };
      x.ontimeout = function () { cb(null, 0); };
      x.send();
    } catch (e) { cb(null, 0); }
  }

  function renderAdmin() {
    $('scAdmin').classList.remove('hide');
    $('adminStat').innerHTML = '<span style="color:var(--faint)">正在读服务端汇总…</span>';
    fetchServer(function (rows, status) {
      if (rows) { adminSource = 'server'; paintAdmin(rows, '', 0); return; }
      adminSource = 'local';
      var why = (status === 403)
        ? '服务端拒绝了这台设备的读取（含联系方式，只允许运行服务的那台电脑或带 token 读）'
        : '连不上服务端（' + (status ? 'HTTP ' + status : '无响应') + '）';
      paintAdmin(lsGet(LS_KEY, []), why, pendingCount());
    });
  }

  function paintAdmin(all, why, pending) {
    var byPrize = {};
    /* 没有奖项的记录是异常（正常流程一定有）。标出来而不是显示成一个光秃秃的数字 ——
     * 让异常看得见，比让它混进统计里强。 */
    all.forEach(function (r) {
      var k = r.prize || '（无奖项·异常）';
      byPrize[k] = (byPrize[k] || 0) + 1;
    });
    var scope = (adminSource === 'server')
      ? '<b style="color:var(--crawl)">全场汇总</b>（服务端，所有手机）'
      : '<b style="color:var(--red)">仅本机</b>（这一台设备）';
    var tail = (adminSource === 'server')
      ? '<span style="color:var(--faint)">来源：运行 _serve.js 的那台电脑，按天存 JSONL</span>'
      : '<span style="color:var(--faint)">' + why
        + '；这里的数字<b style="color:var(--red)">不是全场数据</b>'
        + (pending ? ' · 本机还有 <b style="color:var(--order)">' + pending + '</b> 条等待补传' : '')
        + '</span>';
    $('adminStat').innerHTML = scope + ' 共 <b style="color:var(--tx)">' + all.length + '</b> 条 · '
      + Object.keys(byPrize).map(function (k) { return k + ' ' + byPrize[k]; }).join(' · ')
      + '<br>' + tail;
    var s = '<table><tr><th>时间</th><th>身份</th><th>联系</th><th>奖项</th><th>凭证</th></tr>';
    all.slice(-14).reverse().forEach(function (r) {
      var d = new Date(r.ts), pad = function (n) { return ('0' + n).slice(-2); };
      s += '<tr><td>' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' '
        + pad(d.getHours()) + ':' + pad(d.getMinutes()) + '</td><td>' + r.role
        + '</td><td>' + (r.contact || '—') + '</td><td>' + r.prize
        + '</td><td>' + r.ticket + '</td></tr>';
    });
    $('adminTable').innerHTML = s + '</table>';
    $('btnCsv').textContent = (adminSource === 'server') ? '导出 CSV（全场）' : '导出 CSV（仅本机）';
  }

  /** 服务端可读时，CSV 由服务端出（全场 + 已去重）；否则退回本机这份 */
  function doExport() {
    if (adminSource === 'server') {
      var k = adminToken();
      root.location.href = API + '/export' + (k ? '?k=' + encodeURIComponent(k) : '');
      return;
    }
    exportCsv();
  }

  function exportCsv() {
    var all = lsGet(LS_KEY, []);
    var head = ['时间', '设备', '身份', '身份名', 'Shopify', '月GMV', '主营品类', '公司规模',
                '联系方式', '奖项', '凭证编号'];
    var rows = [head];
    all.forEach(function (r) {
      var d = new Date(r.ts), pad = function (n) { return ('0' + n).slice(-2); };
      rows.push([
        d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' '
          + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()),
        r.device, r.role, r.roleName, r.shopify, r.gmv, r.category, r.size,
        r.contact, r.prize, r.ticket
      ]);
    });
    var csv = rows.map(function (row) {
      return row.map(function (c) {
        c = String(c == null ? '' : c);
        return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(',');
    }).join('\r\n');
    /* Excel 认 UTF-8 需要 BOM，否则中文全乱码 */
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    var a = doc.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'AP展会问卷-' + new Date().toISOString().slice(0, 10) + '.csv';
    doc.body.appendChild(a); a.click(); doc.body.removeChild(a);
    root.setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  /* ── 绑定 ─────────────────────────────────────────────────────────── */
  $('btnStart').addEventListener('click', function () {
    buildQueue(); step = 0; renderQ(); show('scQ');
  });
  $('qopts').addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('.opt') : null;
    if (b) onPick(b.getAttribute('data-v'));
  });
  $('btnNext').addEventListener('click', next);
  $('btnBack').addEventListener('click', back);
  $('btnSpin').addEventListener('click', spin);
  $('btnAgain').addEventListener('click', function () { show('scWin'); });
  $('btnCsv').addEventListener('click', doExport);
  $('btnClear').addEventListener('click', function () {
    /* 只清本机。服务端那份是权威副本，**不给前端一个删库按钮** ——
     * 展会现场误触一下就没了，而它是展后跟进线索的唯一来源。
     * 真要清就去删 E-survey/_data/ 下的文件。 */
    if (root.confirm('清空本机全部问卷记录？\n（服务端汇总不受影响，需要删的话去删 E-survey/_data/ 下的文件）')) {
      lsSet(LS_KEY, []); lsSet(LS_MINE, null); lsSet(LS_QUEUE, []); renderAdmin();
    }
  });
  doc.addEventListener('keydown', function (ev) {
    /* 按钮是灰的时候 Enter 也不该能走 —— 否则键盘和触屏两条路径的规则不一致 */
    if (ev.key === 'Enter' && !$('scQ').classList.contains('hide')
        && !$('btnNext').disabled) next();
  });

  /* ── 启动 ─────────────────────────────────────────────────────────── */
  (function boot() {
    var q = root.location.search || '';
    /* 上次没推上去的记录，趁这次打开页面补传。
     * 放在最前面：哪怕这台手机只是被重新扫码打开，也是一次补传机会。 */
    flushQueue();
    /* 设备号只在管理模式下露出 —— 对参与者是无意义噪音 */
    if (/[?&]admin=1/.test(q)) { $('devTag').textContent = deviceId().slice(0, 10); renderAdmin(); }
    else deviceId();                      /* 仍要生成，用于防重复 */
    var mine = lsGet(LS_MINE, null);
    if (mine && ONE_PER_DEVICE && !/[?&]again=1/.test(q)) {
      /* 已参与过 → 直接回显上次的中奖页（满足 SOP「可回显」那条要求） */
      buildQueue();
      showWin(mine);
      return;
    }
    show('scIntro');
  })();

  root.APSurvey = {
    records: function () { return lsGet(LS_KEY, []); },
    pending: function () { return lsGet(LS_QUEUE, []); },
    flush: flushQueue,                    /* 手动补传：APSurvey.flush(function(sent,left){…}) */
    prizes: PRIZES,
    decide: decidePrize,
    reset: function () { lsSet(LS_MINE, null); root.location.search = ''; },
    /* 给验收脚本用：不经过 UI 直接问「下一题现在能不能点」 */
    _canNext: function () { return !$('btnNext').disabled; }
  };

})(window);
