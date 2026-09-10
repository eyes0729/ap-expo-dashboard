/* 验收：最新版后台的小额订单占多数，大额订单保持稀有，手动演示档位不变。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = { console, Date, Math, JSON, parseInt, parseFloat, isFinite, Intl };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, '_shared', 'cities.js'), 'utf8'), ctx);
let engineSrc = fs.readFileSync(path.join(ROOT, '_shared', 'engine.js'), 'utf8');
engineSrc = engineSrc.replace('root.APEngine = API;',
  'root.APEngine = API; root.__ordersInSlot = ordersInSlot;');
vm.runInContext(engineSrc, ctx);

const appSrc = fs.readFileSync(path.join(ROOT, 'E-后台-可操作版', 'app.js'), 'utf8');
const start = appSrc.indexOf('var AUTO_TIER_CUTS =');
const endMark = 'return o;\n  }';
const end = appSrc.indexOf(endMark, start);
if (start < 0 || end < 0) throw new Error('找不到自动订单档位代码');
const box = {};
vm.createContext(box);
vm.runInContext(appSrc.slice(start, end + endMark.length), box);

const counts = { common: 0, rare: 0, epic: 0, legendary: 0 };
let total = 0;
const slots = Math.floor(4 * 24 * 3600000 / ctx.APEngine.CONFIG.SLOT_MS);
for (let s = 0; s < slots; s++) {
  for (const order of ctx.__ordersInSlot(s)) {
    box.tuneAutoTier(order);
    counts[order.tier]++;
    total++;
  }
}

const share = (tier) => counts[tier] / total;
console.log('自动订单四天样本：', Object.fromEntries(
  Object.keys(counts).map((k) => [k, (share(k) * 100).toFixed(2) + '%'])));
if (share('common') < 0.72) throw new Error('普通订单占比不足 72%');
if (share('epic') + share('legendary') > 0.04) throw new Error('大额与特大订单超过 4%');

const manual = { usd: 430, tier: 'epic', manual: true };
box.tuneAutoTier(manual);
if (manual.tier !== 'epic') throw new Error('手动 B 单档位被自动分界线改变');
console.log('通过：小额占多数，大额保持稀有，手动演示档位不变');
