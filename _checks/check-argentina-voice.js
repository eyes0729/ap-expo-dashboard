/* 验收：展期内阿根廷订单全部命中同一整句语音包，不退回系统 TTS。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const shopsCtx = {};
shopsCtx.window = shopsCtx; shopsCtx.globalThis = shopsCtx;
vm.createContext(shopsCtx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'E-后台-可操作版', 'shops.js'), 'utf8'), shopsCtx);

const ctx = { console, Date, Math, JSON, parseInt, parseFloat, isFinite, Intl };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, '_shared', 'cities.js'), 'utf8'), ctx);
let engineSrc = fs.readFileSync(path.join(ROOT, '_shared', 'engine.js'), 'utf8');
engineSrc = engineSrc.replace('root.APEngine = API;',
  'root.APEngine = API; root.__ordersInSlot = ordersInSlot; root.__slotOf = slotOf;');
vm.runInContext(engineSrc, ctx);

const packPath = path.join(ROOT, '_voice', 'pack-edge', 'index.json');
const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
const have = new Set(pack.lines.map((line) => line.usd));
const shops = shopsCtx.APShops.SHOPS.map((row) => String(row).split('|'));
const argentinaIndexes = [];
for (let i = 0; i < shops.length; i++) if (shops[i][1] === 'AR') argentinaIndexes.push(i);

const from = Date.UTC(2026, 8, 3, 0, 0, 0);
const to = Date.UTC(2026, 8, 7, 0, 0, 0);
const missing = [], amounts = new Set();
for (let slot = ctx.__slotOf(from); slot <= ctx.__slotOf(to); slot++) {
  for (const order of ctx.__ordersInSlot(slot)) {
    if (argentinaIndexes.indexOf(order.store.id % shops.length) < 0) continue;
    const usd = Math.round(order.usd);
    amounts.add(usd);
    if (!have.has(usd)) missing.push({ id: order.id, usd });
  }
}

console.log('语音包：' + pack.voice + '，阿根廷展期订单金额 ' + amounts.size + ' 种');
if (missing.length) throw new Error('缺少阿根廷订单录音：' + JSON.stringify(missing));
console.log('通过：阿根廷订单全部使用统一整句音色');
