/* 开发/彩排用自检脚本 —— 页面不加载它，只在命令行跑：node _verify.js
 * （不是交付物的一部分，但上会前在展会机上跑一次很值）
 * 用最小 DOM / Canvas2D 桩 + 可控时钟，在 Node 里真跑 globe.js + app.js 的
 * 完整 rAF 主循环。目的：抓运行期异常、统计每帧路径指令、验证 DOM 不增长、
 * 验证里程表不倒退、验证快捷键与卡片池。 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

var OPS = { rect: 0, lineTo: 0, moveTo: 0, arc: 0, fill: 0, stroke: 0, beginPath: 0 };
var BANNED = { createPattern: 0, createLinearGradient: 0, createRadialGradient: 0, createImageData: 0 };
var inFrame = false;

function Ctx2D() { this._fs = 10; }
['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'rect', 'arc', 'fill', 'stroke',
  'clip', 'clearRect', 'fillRect', 'translate', 'scale', 'closePath', 'putImageData',
  'setTransform', 'resetTransform'].forEach(function (m) {
    Ctx2D.prototype[m] = function () { if (OPS[m] !== undefined) OPS[m]++; };
  });
/* Bahnschrift 的 "0" 实测约 0.52em，"," 约 0.26em；这里按此比例模拟 */
Ctx2D.prototype.measureText = function (s) {
  var w = 0;
  for (var i = 0; i < s.length; i++) w += (s[i] === ',' ? 0.26 : 0.52);
  return { width: w * this._fs };
};
Ctx2D.prototype.createImageData = function (w, h) {
  if (inFrame) BANNED.createImageData++;
  return { data: new Uint8ClampedArray(w * h * 4) };
};
Ctx2D.prototype.createPattern = function () {
  if (inFrame) BANNED.createPattern++;
  return { __p: 1 };
};
Ctx2D.prototype.createRadialGradient = function () {
  if (inFrame) BANNED.createRadialGradient++;
  return { addColorStop: function () {} };
};
Ctx2D.prototype.createLinearGradient = function () {
  if (inFrame) BANNED.createLinearGradient++;
  return { addColorStop: function () {} };
};
Object.defineProperty(Ctx2D.prototype, 'font', {
  set: function (v) { var m = /(\d+(?:\.\d+)?)px/.exec(v); if (m) this._fs = parseFloat(m[1]); },
  get: function () { return ''; }
});

var NODES = 0;
function El(tag) {
  NODES++;
  this.tagName = (tag || 'div').toUpperCase();
  this.style = {};
  this.children = [];
  this._cls = {};
  this._text = '';
  var self = this;
  this.classList = {
    add: function (c) { self._cls[c] = 1; },
    remove: function (c) { delete self._cls[c]; },
    toggle: function (c) { if (self._cls[c]) delete self._cls[c]; else self._cls[c] = 1; },
    contains: function (c) { return !!self._cls[c]; }
  };
}
El.prototype.appendChild = function (c) { this.children.push(c); c.parentNode = this; return c; };
Object.defineProperty(El.prototype, 'className', {
  get: function () { return Object.keys(this._cls).join(' '); },
  set: function (v) {
    var s = this; this._cls = {};
    String(v).split(' ').forEach(function (c) { if (c) s._cls[c] = 1; });
  }
});
El.prototype.addEventListener = function (t, f) { (this._ev = this._ev || {})[t] = f; };
El.prototype.getContext = function () { return (this._ctx = this._ctx || new Ctx2D()); };
El.prototype.querySelector = function (sel) {
  var cls = sel.replace('.', ''), out = null;
  (function walk(n) {
    for (var i = 0; i < n.children.length; i++) {
      if (!out && n.children[i]._cls[cls]) out = n.children[i];
      walk(n.children[i]);
    }
  })(this);
  return out;
};
Object.defineProperty(El.prototype, 'textContent', {
  get: function () { return this._text; },
  set: function (v) { this._text = String(v); this.children.length = 0; }
});
Object.defineProperty(El.prototype, 'innerHTML', {
  get: function () { return ''; },
  set: function (v) {
    this.children.length = 0;
    var self = this, re = /class="([^"]+)"/g, m;
    while ((m = re.exec(v))) {
      var e = new El('div');
      m[1].split(/\s+/).forEach(function (c) { e._cls[c] = 1; });
      self.appendChild(e);
    }
  }
});

var byId = {};
['stage', 'globe', 'grid', 'ms', 'msVal', 'msKey', 'boot', 'legend', 'vig', 'ray',
  'rateVal', 'msRemain', 'barFill', 'status', 'odoMain', 'odoPages', 'pagesBlock',
  'cards', 'pfBar', 'pfLeg', 'scrim', 'panel'].forEach(function (id) {
    byId[id] = new El(id === 'globe' ? 'canvas' : 'div');
  });

var CLOCK = Date.UTC(2026, 7, 18, 3, 0, 0);        /* 开幕后 2 小时 */
function FakeDate(a) { return arguments.length ? new Date(a) : new Date(CLOCK); }
FakeDate.now = function () { return CLOCK; };
FakeDate.UTC = Date.UTC;
FakeDate.prototype = Date.prototype;

var rafQ = [], timers = [];
var win = {
  innerWidth: 2560, innerHeight: 1440,
  location: { search: '' },
  console: console,
  requestAnimationFrame: function (f) { rafQ.push(f); return rafQ.length; },
  setTimeout: function (f) { timers.push(f); return timers.length; },
  setInterval: function () { return 0; },
  clearInterval: function () {}, clearTimeout: function () {},
  addEventListener: function (t, f) { if (t === 'keydown') win.__key = f; },
  getComputedStyle: function () {
    return { getPropertyValue: function () { return "'Bahnschrift',sans-serif"; } };
  },
  document: {
    readyState: 'complete',
    documentElement: new El('html'),
    fonts: null,
    fullscreenElement: null,
    addEventListener: function () {},
    createElement: function (t) { return new El(t); },
    getElementById: function (id) { return byId[id] || (byId[id] = new El('div')); }
  },
  speechSynthesis: null
};
win.window = win; win.globalThis = win;
win.Math = Math; win.Date = FakeDate; win.Float32Array = Float32Array;
win.Uint8ClampedArray = Uint8ClampedArray; win.Intl = Intl; win.JSON = JSON;

var ctxVm = vm.createContext(win);
function load(p) { vm.runInContext(fs.readFileSync(p, 'utf8'), ctxVm, { filename: p }); }
var SH = path.join(__dirname, '..', '_shared');
load(path.join(SH, 'cities.js'));
load(path.join(SH, 'engine.js'));
load(path.join(SH, 'audio.js'));
load(path.join(__dirname, 'globe.js'));
load(path.join(__dirname, 'app.js'));

console.log('[1] boot ok. DOM 节点数 =', NODES);

var E = win.APEngine, G = win.APGlobe;
var orders = 0, crawlSpawn = 0, crawlTried = 0;
var oc = G.spawnCrawl, oo = G.spawnOrder;
G.spawnCrawl = function (ev) { crawlTried++; var r = oc.call(G, ev); if (r) crawlSpawn++; return r; };
G.spawnOrder = function (ev) { orders++; return oo.call(G, ev); };

function step() {
  var q = rafQ; rafQ = [];
  inFrame = true;
  for (var i = 0; i < q.length; i++) q[i]();
  inFrame = false;
  var t = timers; timers = [];
  for (i = 0; i < t.length; i++) { try { t[i](); } catch (e) {} }
}

var frames = 0, sumOps = 0, maxOps = 0, nodes120 = 0, k;
var TOTAL = 21600;                    /* 21600 帧 x 16.7ms = 6 分钟虚拟时间 */
var t0 = Date.now();
for (var f = 0; f < TOTAL; f++) {
  CLOCK += 16.7;
  for (k in OPS) OPS[k] = 0;
  step();
  var ops = 0; for (k in OPS) ops += OPS[k];
  sumOps += ops; if (ops > maxOps) maxOps = ops;
  frames++;
  if (f === 120) nodes120 = NODES;
}
var loopMs = Date.now() - t0;

console.log('[2] frames=' + frames + '  avgPathOps=' + Math.round(sumOps / frames) +
  '  maxPathOps=' + maxOps);
console.log('[3] 爬虫事件=' + crawlTried + ' 实际成弧=' + crawlSpawn +
  '  订单弧线=' + orders);
console.log('[4] DOM 节点  120帧后=' + nodes120 + '  ' + TOTAL + '帧后=' + NODES +
  '  delta=' + (NODES - nodes120) + '  (必须 0)');
console.log('[5] rAF 内被禁 API 调用:', JSON.stringify(BANNED));
console.log('[6] 纯 JS 成本 = ' + (loopMs / frames).toFixed(3) + ' ms/帧（不含 canvas 光栅化）');
console.log('[7] APDiag =', JSON.stringify(win.APDiag));

/* --- 卡片池 --- */
(function () {
  var host = byId.cards, filled = 0, probe = null;
  for (var i = 0; i < host.children.length; i++) {
    var nm = host.children[i].querySelector('.cname');
    if (nm && nm._text) { filled++; if (!probe) probe = host.children[i]; }
  }
  console.log('[8] 卡片池节点=' + host.children.length + '  曾填充=' + filled);
  if (probe) console.log('    样例 ->', JSON.stringify({
    name: probe.querySelector('.cname')._text,
    amt: probe.querySelector('.camt')._text,
    meta: probe.querySelector('.cmeta')._text,
    prod: probe.querySelector('.cprod')._text,
    tier: Object.keys(probe._cls).join('+')
  }));
})();

/* --- 里程表 DOM --- */
(function () {
  var host = byId.odoMain, tr = [], vis = [];
  for (var i = 0; i < host.children.length; i++) {
    var n = host.children[i];
    if (n._cls['odo-slot']) { tr.push(n.children[0].style.transform); vis.push(n.style.opacity); }
    else vis.push('[,]=' + n.style.opacity);
  }
  console.log('[9] odoMain 数位=' + tr.length + '  cell=' + host.style.height +
    '  slotW=' + host.children[0].style.width);
  console.log('    可见性 ' + vis.join(' '));
  console.log('    transform 首/末: ' + tr[0] + ' | ' + tr[tr.length - 1]);
  console.log('    odoPages cell=' + byId.odoPages.style.height +
    '  pagesBlock width=' + byId.pagesBlock.style.width);
  console.log('    rateVal="' + byId.rateVal._text + '"  msRemain="' + byId.msRemain._text +
    '"  barFill=' + byId.barFill.style.transform);
})();

/* --- 平台占比 --- */
(function () {
  console.log('[10] 平台段=' + byId.pfBar.children.length +
    ' 图例项=' + byId.pfLeg.children.length + ' -> ' +
    E.platformBreakdown().map(function (x) {
      return x.platform + ' ' + Math.round(x.share * 100) + '%';
    }).join('  '));
})();

/* --- 快捷键 --- */
(function () {
  var before = orders, err = 0;
  ['b', 'n', 'k', ' ', ' ', 'g', 'g', '1', '2', '3', 'h', 'a', 'a', '?', 'm', 'm', 'r']
    .forEach(function (key) {
      try {
        win.__key({ key: key, preventDefault: function () {} });
        CLOCK += 16.7; step();
      } catch (e) { err++; console.log('    key ' + key + ' 抛异常: ' + e.message); }
    });
  console.log('[11] 快捷键全跑一遍 异常=' + err + '  B/N 新增订单弧线=' + (orders - before) +
    '  里程碑 msVal="' + byId.msVal._text + '"');
})();

/* --- 里程表数学：单调 + 无非回绕倒退 --- */
(function () {
  var POW = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7];
  function ease(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function posOf(v, rate, place) {
    var pw = POW[place], vv = v - place * 0.040 * rate; if (vv < 0) vv = 0;
    var q = vv / pw, fl = Math.floor(q), frac = q - fl;
    var w = 0.145 * rate / pw, roll;
    if (w >= 0.999) roll = frac;
    else { var kk = (frac - (1 - w)) / w; roll = kk <= 0 ? 0 : ease(kk); }
    return { abs: fl + roll, pos: (fl % 10) + roll };
  }
  var bad = 0, disc = 0, oor = 0;
  [42.7, 12.0, 1.19, 120].forEach(function (rate) {
    for (var p = 0; p < 7; p++) {
      var last = null;
      for (var s = 0; s < 6000; s++) {
        var v = 3686400 + s * (rate / 60);
        var r = posOf(v, rate, p);
        if (r.pos < -1e-9 || r.pos > 10 + 1e-9) oor++;
        if (last) {
          if (r.abs < last.abs - 1e-9) bad++;
          var d = r.pos - last.pos;
          if (d < -1e-9 && d > -5) disc++;
        }
        last = r;
      }
    }
  });
  console.log('[12] 里程表 绝对倒退=' + bad + ' 视觉倒退=' + disc + ' 越界=' + oor +
    '  (三项都必须为 0)');
})();

/* --- 齐发高潮：连按 5 次 B，看卡片是否同时叠放且不越出事件区 --- */
(function () {
  for (var i = 0; i < 5; i++) {
    win.__key({ key: 'b', preventDefault: function () {} });
    CLOCK += 16.7; step();
  }
  for (i = 0; i < 90; i++) { CLOCK += 16.7; step(); }   /* 等信使 0.72s 全部落地 */
  var host = byId.cards, act = [], maxBottom = 0;
  for (i = 0; i < host.children.length; i++) {
    var c = host.children[i], op = parseFloat(c.style.opacity || '0');
    if (op > 0.02) {
      var m = /translate3d\(0,(-?[\d.]+)px/.exec(c.style.transform || '');
      var y = m ? parseFloat(m[1]) : 0;
      var h = parseFloat(c.style.height) || 68;
      act.push(Math.round(y) + '+' + h);
      if (y + h > maxBottom) maxBottom = y + h;
    }
  }
  console.log('[13] 5 连发后同屏卡片=' + act.length + ' [y+h: ' + act.join(', ') +
    ']  最低沿=' + Math.round(maxBottom) + 'px  (事件区 176px, 常驻上限 2 张)');
})();

console.log('ALL DONE');
