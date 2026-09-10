/* 探针：把引擎在不同墙上时刻的四个计数器打出来，用来判断
 * 「后台页那两个被钉在加载时刻的卡」到底偏离引擎多少。
 * 只读，不改任何文件。用法：node _checks/probe-cumulative.js */
const fs = require('fs'), path = require('path'), vm = require('vm');

const SHARED = path.join(__dirname, '..', '_shared');
const ctx = { console, Date, Math, JSON, parseInt, parseFloat, isFinite, Intl };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['cities.js', 'engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(SHARED, f), 'utf8'), ctx, { filename: f });
}
const E = ctx.APEngine;
const C = E.CONFIG;

function at(ts) {
  E.init({ startAt: ts });
  const m = E.metrics();
  return {
    when: new Date(ts).toISOString().replace('T', ' ').slice(0, 16),
    days: ((ts - E.t0()) / 86400000),
    sOrders: m.session.orders,
    sGmv: m.session.gmv,
    sPages: m.session.pages,
    stores: m.stores,
    aov: m.session.orders ? m.session.gmv / m.session.orders : 0
  };
}

const T0 = E.t0();
console.log('T0 =', new Date(T0).toISOString(), '(2026-08-18 09:00 UTC+8)');
console.log('CONFIG: STORES=%s NEW_STORES_PER_DAY=%s PAGES0=%s ORDERS0=%s GMV0=%s',
  C.STORES, C.NEW_STORES_PER_DAY, C.PAGES0, C.ORDERS0, C.GMV0);
console.log('引擎自报均单价 = GMV0/ORDERS0 = $%s', (C.GMV0 / C.ORDERS0).toFixed(2));
console.log('');

const now = Date.now();
const rows = [
  ['现在',      now],
  ['+1 天',     now + 86400000],
  ['+2 天',     now + 2 * 86400000],
  ['+7 天',     now + 7 * 86400000],
];
console.log('标签      时刻              距T0天数  订单(session)   GMV(session)      均单价   商品页(session)  店铺');
for (const [tag, ts] of rows) {
  const r = at(ts);
  console.log('%s  %s  %s  %s  %s  %s  %s  %s',
    tag.padEnd(7), r.when, r.days.toFixed(2).padStart(7),
    String(r.sOrders).padStart(12),
    ('$' + Math.round(r.sGmv).toLocaleString('en-US')).padStart(15),
    ('$' + r.aov.toFixed(2)).padStart(8),
    String(r.sPages).padStart(14),
    String(r.stores).padStart(6));
}

console.log('');
console.log('=== 后台页当前写法（钉在页面加载时刻）会显示什么 ===');
const nowR = at(now);
console.log('GMV   卡：$500,000 + 本次会话增量  → 开页瞬间就是 $500,000，明天开页还是 $500,000');
console.log('店铺  卡：1015 + 开页后天数×18     → 开页瞬间就是 1,015，明天开页还是 1,015');
console.log('订单  卡：session.orders           → %s（连续，会一直涨）', nowR.sOrders);
console.log('商品页卡：session.pages            → %s（连续，会一直涨）', nowR.sPages);
console.log('');
console.log('→ 自洽性检查：卡上均单价 = 500,135 / %s = $%s',
  nowR.sOrders, (500135 / nowR.sOrders).toFixed(2));
console.log('  而引擎实际生成的订单均价 = $%s（订单列表里那些 $40~$380 就是它）',
  nowR.aov.toFixed(2));
console.log('  两者差 %s 倍 —— 这是现在就已经能被算穿的矛盾。',
  (nowR.aov / (500135 / nowR.sOrders)).toFixed(1));
