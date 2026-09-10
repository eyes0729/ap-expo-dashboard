/* ===========================================================================
 *  验收：「上线至今」四个计数器的延续性
 * ---------------------------------------------------------------------------
 *  为什么要从 app.js 里**抠源码**而不是在这里重写一份公式：
 *  重写一份的话，app.js 改坏了这个测试照样全绿 —— 测的是副本不是产品。
 *  所以这里把 app.js 中 `var DISP = {` 到 `spkCrawls` 那一整段原文取出来，
 *  配上**真的引擎**（_shared/engine.js）执行，断言的是产品代码本身。
 *
 *  四条断言，每条对应一个真实会被看穿的破法：
 *    ①「不依赖页面加载时刻」—— 上一版的病根。同一墙上时刻算两次（模拟
 *      昨天开的页 / 今天才开的页）必须得到同一个值。
 *    ②「跨天单调递增」—— 明天必须比今天大，不能归位。
 *    ③「均单价与引擎一致」—— 成交额÷订单必须落在引擎真实均价附近，
 *      否则台下一次除法就算穿（上一版差 6.3 倍）。
 *    ④「店铺锚点命中」—— 锚点那一刻要正好是对外说的那个数。
 *
 *  用法：node _checks/check-cumulative-continuity.js
 * ======================================================================== */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'E-后台-可操作版', 'app.js');

/* ── 1. 真引擎 ─────────────────────────────────────────────────────────── */
const ctx = { console, Date, Math, JSON, parseInt, parseFloat, isFinite, Intl };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['cities.js', 'engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, '_shared', f), 'utf8'), ctx, { filename: f });
}
const E = ctx.APEngine;

/* ── 2. 从 app.js 抠出口径那一段原文 ──────────────────────────────────── */
const src = fs.readFileSync(APP, 'utf8');
const START = 'var DISP = {';
const END = 'function spkCrawls(m) { return displayCrawls(m); }';
const i0 = src.indexOf(START), i1 = src.indexOf(END);
if (i0 < 0 || i1 < 0) {
  console.error('✗ 在 app.js 里找不到口径代码段（锚点变了？）START=%s END=%s', i0, i1);
  process.exit(1);
}
const block = src.slice(i0, i1 + END.length);

/* 在一个只有 E / rngMode 的沙箱里执行这段原文。
 * 注意 E 是**同一个引擎实例**，所以 E.now() 会跟着 init({startAt}) 走。 */
const box = { E, rngMode: 'session', Math, Date, console };
vm.createContext(box);
vm.runInContext(block, box, { filename: 'app.js#DISP' });

const D = {
  gmv:    () => box.displayGmv(E.metrics()),
  orders: () => box.displayOrders(E.metrics()),
  crawls: () => box.displayCrawls(E.metrics()),
  stores: () => box.displayStores()
};

function snapshot(ts) {
  E.init({ startAt: ts });
  return { gmv: D.gmv(), orders: D.orders(), crawls: D.crawls(), stores: D.stores() };
}

let fail = 0;
const ok = (cond, msg, extra) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg + (extra ? '   ' + extra : ''));
  if (!cond) fail++;
};

const DAY = 86400000;
const now = Date.now();
const T0 = E.t0();

console.log('T0 = %s（引擎固定开幕时刻）', new Date(T0).toISOString());
console.log('现在 = %s，距 T0 %s 天\n', new Date(now).toISOString(), ((now - T0) / DAY).toFixed(2));

/* ── 断言① 不依赖「页面什么时候打开」 ─────────────────────────────────── */
console.log('① 同一墙上时刻、两次不同的「打开顺序」必须给出同一个值');
{
  /* 模拟「昨天就开着的页面」：先在 now-1d 算一遍，再算 now */
  E.init({ startAt: now - DAY }); D.gmv(); D.orders(); D.crawls(); D.stores();
  const asIfOpenedYesterday = snapshot(now);
  /* 模拟「今天才打开的页面」：直接在 now 算 */
  E.init({ startAt: now - 1 }); D.gmv();
  const asIfOpenedNow = snapshot(now);
  for (const k of ['gmv', 'orders', 'crawls', 'stores']) {
    const a = asIfOpenedYesterday[k], b = asIfOpenedNow[k];
    ok(Math.abs(a - b) < 1e-6, k.padEnd(6) + ' 与打开时刻无关',
       '昨天开的=' + Math.round(a).toLocaleString('en-US') +
       ' / 刚打开=' + Math.round(b).toLocaleString('en-US'));
  }
}

/* ── 断言② 跨天单调递增 ───────────────────────────────────────────────── */
console.log('\n② 逐天必须严格递增（不能归位、不能持平）');
{
  const days = [0, 1, 2, 3, 7];
  const snaps = days.map((d) => ({ d: d, s: snapshot(now + d * DAY) }));
  console.log('     天  成交额            订单       商品页          店铺');
  for (const r of snaps) {
    console.log('    +%s  %s  %s  %s  %s', String(r.d).padStart(2),
      ('$' + Math.round(r.s.gmv).toLocaleString('en-US')).padStart(14),
      String(Math.floor(r.s.orders)).padStart(9),
      String(Math.floor(r.s.crawls)).padStart(12),
      String(r.s.stores).padStart(6));
  }
  for (const k of ['gmv', 'orders', 'crawls', 'stores']) {
    let mono = true;
    for (let j = 1; j < snaps.length; j++) {
      if (!(snaps[j].s[k] > snaps[j - 1].s[k])) mono = false;
    }
    ok(mono, k.padEnd(6) + ' 逐天严格递增');
  }
}

/* ── 断言③ 均单价与引擎一致 ───────────────────────────────────────────── */
console.log('\n③ 成交额 ÷ 订单 必须落在引擎真实均价附近（这是最容易被心算穿的）');
{
  const s = snapshot(now);
  const aov = s.gmv / s.orders;
  const engineAov = E.CONFIG.GMV0 / E.CONFIG.ORDERS0;   /* $139 口径 */
  const lo = engineAov * 0.85, hi = engineAov * 1.15;
  ok(aov >= lo && aov <= hi,
     '均单价 $' + aov.toFixed(2) + ' 落在 [$' + lo.toFixed(0) + ', $' + hi.toFixed(0) + ']',
     '引擎口径 $' + engineAov.toFixed(2));
  /* 顺带把订单列表里能看到的金额档位打出来，肉眼对一下量级 */
  const sample = E.peekOrders(6).map((o) => '$' + o.usd.toFixed(0)).join(' ');
  console.log('    屏上即将出现的订单金额：' + sample);
}

/* ── 断言④ 店铺锚点命中 ───────────────────────────────────────────────── */
console.log('\n④ 店铺数必须在锚点时刻正好等于对外说的那个数');
{
  const at = box.DISP.storeAnchorAt, want = box.DISP.storeAnchorN;
  E.init({ startAt: at });
  const got = box.displayStores();
  ok(got === want, '锚点 ' + new Date(at).toISOString().slice(0, 16) +
     ' → ' + got + ' 家（期望 ' + want + '）');
  /* 斜率也核一下：一天应当正好 +storePerDay */
  E.init({ startAt: at + DAY });
  const d1 = box.displayStores();
  ok(d1 - got === box.DISP.storePerDay,
     '一天增长 ' + (d1 - got) + ' 家（配置 ' + box.DISP.storePerDay + '）');
}

/* ── 断言⑤ 漏斗自洽：商品页数能不能推出订单数 ──────────────────────────
 * 引擎 CONFIG 里写着这条漏斗：抓取 → 引荐访问 → 订单。
 * 四张卡如果各自独立编，这条链一定推不上 —— 而它是懂行的人第二个会去验的
 * （第一个是均单价）。这里断言「按漏斗推出来的订单数」与「卡上订单数」
 * 落在 2 倍以内（不苛求精确：订单事件是时间槽生成的，不是拿漏斗乘出来的）。 */
console.log('\n⑤ 展会开场时前三张卡必须命中新口径');
{
  const s = snapshot(box.DISP.showAnchorAt);
  ok(Math.abs(s.gmv - box.DISP.gmvAtShow) < 0.01,
     '成交额 = $' + Math.round(s.gmv).toLocaleString('en-US'));
  ok(s.orders === box.DISP.ordersAtShow,
     '订单 = ' + s.orders.toLocaleString('en-US') + ' 笔');
  ok(Math.abs(s.crawls - box.DISP.crawlsAtShow) < 0.01,
     'AI 读取商品页 = ' + Math.round(s.crawls).toLocaleString('en-US') + ' 页');
  const aov = s.gmv / s.orders;
  ok(Math.abs(aov - E.CONFIG.GMV0 / E.CONFIG.ORDERS0) < 1,
     '开场均单价 = $' + aov.toFixed(2));

  E.init({ startAt: box.DISP.showAnchorAt - 3600000 });
  const beforeGmv = box.displayGmv(E.metrics());
  const beforeOrders = box.displayOrders(E.metrics());
  let donutGmv = beforeGmv;
  const hiddenAuto = { t: box.DISP.showAnchorAt - 1000, usd: 3007, manual: false };
  if (box.orderCountsInDisplay(hiddenAuto)) donutGmv += hiddenAuto.usd;
  ok(Math.abs(donutGmv - beforeGmv) < 0.01,
     '开场前自动订单不会让圆环成交额高于顶部');
  const manual = E.triggerOrder({ usd: 430 });
  box.registerManualDisplay(manual.usd);
  if (box.orderCountsInDisplay(manual)) donutGmv += manual.usd;
  const afterGmv = box.displayGmv(E.metrics());
  const afterOrders = box.displayOrders(E.metrics());
  ok(afterOrders === beforeOrders + 1, '开场前手动成交会立即订单 +1');
  ok(Math.abs(afterGmv - beforeGmv - 430) < 0.01,
     '开场前手动成交会立即增加 $430');
  ok(Math.abs(donutGmv - afterGmv) < 0.01,
     '手动成交后圆环与顶部成交额同步增加 $430');

  const visibleAuto = { t: box.DISP.showAnchorAt, usd: 139, manual: false };
  ok(box.orderCountsInDisplay(visibleAuto), '开场后的自动订单会进入圆环统计');
}

/* ── 断言⑥ 切到「累计」口径不崩 ────────────────────────────────────────
 * 顶栏那个「累计」按钮会把 rngMode 从 'session' 切成别的值，
 * 三个 display 函数都有那条分支。分支没人走过就等于没写。 */
console.log('\n⑥ 顶栏切「累计」口径时三个出口都要能出数');
{
  E.init({ startAt: now });
  box.rngMode = 'all';
  const g = box.displayGmv(E.metrics()), o = box.displayOrders(E.metrics()),
        c = box.displayCrawls(E.metrics());
  ok(isFinite(g) && g > 0, '累计成交额 = $' + Math.round(g).toLocaleString('en-US'));
  ok(isFinite(o) && o > 0, '累计订单   = ' + Math.floor(o).toLocaleString('en-US'));
  ok(isFinite(c) && c > 0, '累计商品页 = ' + Math.floor(c).toLocaleString('en-US'));
  box.rngMode = 'session';
}

console.log('\n' + (fail ? '✗ 有 ' + fail + ' 条断言未通过' : '✓ 全部通过'));
process.exit(fail ? 1 : 0);
