/* ===========================================================================
 * 把「这场展会到底会播报哪些句子」算出来，落成 lines-manifest.json
 * ---------------------------------------------------------------------------
 * 这个脚本存在的理由，是 README 里那条待办的正解：
 *
 *   > 人声换成预先离线合成的音频文件……**不要做数字拼接** ——
 *   > 拼接的接缝在 85dB 环境里更假。
 *
 * 但现在的 `_voice/stitch.js` 做的正是拼接（把金额切成「一千」「二百」
 * 「八十美元」分别合成再接起来）。拼接听起来假的根因不是接缝的咔哒声，
 * 而是**每个片段单独合成时都带一个句尾降调**，三个降调连着出现就是
 * 「报电话号码」的听感。这一层不是调参能修的，只能整句生成。
 *
 * 那为什么原来会去拼接？因为大家默认「金额是连续的，不可能每个都预录」。
 * 这个前提是错的 —— 引擎里所有计数器和订单事件都是**时间的纯函数**
 * （engine.js 顶部就写着「重启后自动对上，永不倒退」），所有随机性都来自
 * `hash32(seed, salt)`。也就是说：
 *
 *   **一场展会会播报哪些金额，是可以在出发前就精确算出来的。**
 *
 * 实测数量（9 小时/天，播报门槛 tier>=rare 即 $110 以上）：
 *     一天       575 单 → 228 条播报 → 去重后 166 个金额
 *     4 天展期  2,283 单 → 916 条播报 → 去重后 375 个金额
 *     加上演示键阶梯 21 档，共约 396 句，整句预渲染约 55MB（WAV）
 *
 * 拼接省下来的体积毫无意义，却换来一个听感缺陷。
 *
 * ── 演示键（N / C / B / V）也必须进清单 ────────────────────────────────────
 * 这四个键是 BD 在台上的主要动作，金额由按键决定而不是由时间决定，
 * 所以不在上面枚举出来的集合里。
 *
 * 它们原来是「区间内随机」（`usd: 320 + hash(n)*450`）—— 区间设计是对的
 * （每个键完整落在一档之内），但随机出来的金额几乎必然**不在预渲染集合里**：
 * 实测覆盖率 C 键 91% / B 键 36% / **V 键只有 0.7%**。
 * 也就是 BD 按 V 键，99% 的概率当场蹦出一句 2013 年的 Huihui。
 *
 * 已改成走 `engine.js` 的 `CONFIG.DEMO_LADDERS`（四档各一组固定阶梯），
 * 这里把四档全部并进清单。common 档虽然低于播报门槛不会出声也一起渲，
 * 免得以后有人把 VOICE_MIN_TIER 调到 common 就当场退化。
 *
 * 用法：
 *     node build-lines.js            # 默认 4 天
 *     node build-lines.js --days 2
 * =========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const SHARED = path.join(HERE, '..', '_shared');
const N = require('./cn-number.js');

/* ── 播报文案 ──────────────────────────────────────────────────────────────
 * 用户选定的 E 式：品牌 + 店铺 + 到账。借用「到账」这个已经存在的心智框架。
 *
 * 两条刻意的选择：
 *   ① **不念店名。** 现在线上模板是「Des**ora 收获一笔 AI 引荐订单」——
 *      念一个随机生成的假店名，既没有信息量，又把句子拉长一倍，
 *      而且 464 个店铺身份要全量预渲染就变成 464×375 句，不可能。
 *   ② **一律 USD。** 见下面 amountsFor() 里的长注释。 */
const PREFIX = 'Agentic Page 店铺到账，';
const SUFFIX_CN = '美元';

/* 最新后台会给每一笔订单播报。展期内映射到阿根廷店铺的这些金额低于原来的
 * rare 门槛，旧语音包没有整句录音，会退回系统 TTS、听起来像换了音色。
 * 把它们固定纳入清单，确保阿根廷订单也走同一套晓晓整句音频。 */
const EXPO_AR_AMOUNTS = [22, 23, 35, 49, 57, 66, 82, 89, 401, 817, 838];

/** 金额 → 整句文案。数字写成**中文**而不是阿拉伯数字 ——
 *  读法要握在自己手里，不能依赖某个 TTS 前端的数字归一化
 *  （那一层在不同厂商、不同版本里行为都不一样）。 */
function lineText(usd) {
  return PREFIX + N.toTokens(usd).join('') + SUFFIX_CN;
}

/** 载入引擎（浏览器 IIFE，这里手工喂 window），并把内部函数捞出来。 */
function loadEngine() {
  const root = {};
  const cities = fs.readFileSync(path.join(SHARED, 'cities.js'), 'utf8');
  new Function('window', 'globalThis', cities)(root, root);
  globalThis.APGeo = root.APGeo;          /* engine.js 直接引用全局 APGeo */

  let src = fs.readFileSync(path.join(SHARED, 'engine.js'), 'utf8');
  /* ordersInSlot / rarity 没有导出，但预渲染必须拿到**引擎真正会产生的那批订单**。
   * 在这里把它们挂出来，比在 build 脚本里重新实现一份取样逻辑安全得多 ——
   * 重新实现就会出现「素材按 A 逻辑生成、运行时按 B 逻辑点播」的错配。 */
  src = src.replace('root.APEngine = API;',
    'root.APEngine = API; root.__ordersInSlot = ordersInSlot; root.__rarity = rarity;');
  new Function('window', 'globalThis', src)(root, root);
  return root;
}

/* ── B 键用的大额阶梯 ──────────────────────────────────────────────────────
 * **唯一定义在 engine.js 的 CONFIG.MANUAL_LADDER**，这里只是读出来。
 * 两处各存一份必然会漂 —— 漂了的后果是按 B 时那一档没渲染过，
 * 当场掉回 speechSynthesis（Huihui），而这正是全场最重要的一按。 */
let MANUAL_LADDER = [];
let DEMO_BY_TIER = {};

function amountsFor(days) {
  const root = loadEngine();
  const E = root.APEngine, oS = root.__ordersInSlot, rar = root.__rarity;
  const RANK = E.TIER_RANK;
  /* 门槛取 'rare'（引擎默认）。注意 'epic' 是它的**子集**，
   * 所以按 rare 枚举出来的集合对任何更高门槛都够用，不会漏。 */
  const MIN = RANK[E.CONFIG.VOICE_MIN_TIER || 'rare'];
  const SHOW_H = 9;                               /* 09:00 → 18:00 */
  const slotsPerDay = Math.ceil(SHOW_H * 3600 * 1000 / E.CONFIG.SLOT_MS);
  const slotsPerCal = Math.floor(24 * 3600 * 1000 / E.CONFIG.SLOT_MS);

  /* 阶梯从引擎读 —— engine.js 的 CONFIG.DEMO_LADDERS 是唯一定义处。
   * 四档全都要进清单：演示键 N/C/B/V 各按一档，随机取数覆盖不了（见 engine.js 注释）。
   * common 档虽然低于播报门槛不会出声，也一起渲上 —— 万一以后把
   * VOICE_MIN_TIER 调到 common，不至于当场掉回 Huihui。 */
  DEMO_BY_TIER = E.CONFIG.DEMO_LADDERS || {};
  MANUAL_LADDER = Object.keys(DEMO_BY_TIER)
    .reduce((a, k) => a.concat(DEMO_BY_TIER[k]), []);
  if (!MANUAL_LADDER.length) {
    console.warn('⚠ engine.js 里没有 CONFIG.DEMO_LADDERS —— 演示键仍是随机金额，'
      + '那一按会掉回浏览器 TTS。');
  }

  const set = new Set();
  let orders = 0, spoken = 0;
  for (let d = 0; d < days; d++) {
    for (let s = 0; s < slotsPerDay; s++) {
      for (const o of oS(s + d * slotsPerCal)) {
        orders++;
        if (RANK[rar(o.usd)] >= MIN) { spoken++; set.add(Math.round(o.usd)); }
      }
    }
  }
  /* 币种说明（重要，别当成小事）：
   *   `audio.js` 现在念的是 `order.amount` + `order.currency`，也就是**本地币种** ——
   *   屏上一笔墨西哥订单会被念成「一万六千三百三十八 比索」。
   *   两个问题：
   *     ① 对中文观众毫无尺度感，没人知道 16338 比索是多是少；
   *        而 README 复核记录里第 2 条修的就是同一个坑的显示侧
   *        （本地币种让我们自己的数字看起来夸大了 17 倍）。
   *     ② 币种 × 金额的组合空间是 USD 的十几倍，且 JPY/KRW 会出现
   *        「十九万三千」这种又长又拗口的读法，根本没法预渲染。
   *   所以播报一律用 USD。这也和已有的全部素材（299 个 cosy 片段、
   *   lines.json 的候选文案）以及选定的「…美元」句式一致。
   *   → 需要同步改 audio.js 的 voiceText()，改法见 _shared/voice-pack.js。 */
  MANUAL_LADDER.forEach((v) => set.add(v));
  EXPO_AR_AMOUNTS.forEach((v) => set.add(v));

  const list = [...set].sort((a, b) => a - b);
  return { list, orders, spoken, days };
}

function main() {
  const i = process.argv.indexOf('--days');
  const days = i > 0 ? Math.max(1, parseInt(process.argv[i + 1], 10) || 4) : 4;
  const { list, orders, spoken } = amountsFor(days);

  const lines = list.map((usd) => ({
    usd: usd,
    file: 'line-' + usd,                 /* 扩展名由渲染器决定（mp3 / wav） */
    text: lineText(usd),
    manual: MANUAL_LADDER.indexOf(usd) >= 0 || undefined
  }));

  const out = {
    _note: '由 build-lines.js 生成，不要手改。整句预渲染清单，禁止回退到数字拼接。',
    generatedFor: { days: days, showHours: 9, threshold: 'tier>=rare (usd>=110)',
                    extra: 'AR exhibition orders' },
    prefix: PREFIX,
    manualLadder: MANUAL_LADDER,
    stats: { ordersTotal: orders, spokenTotal: spoken, distinctAmounts: list.length,
             min: list[0], max: list[list.length - 1] },
    lines: lines
  };
  const dst = path.join(HERE, 'lines-manifest.json');
  fs.writeFileSync(dst, JSON.stringify(out, null, 1), 'utf8');

  const est = (n, kb) => (n * kb / 1024).toFixed(1) + 'MB';
  console.log('展期 ' + days + ' 天 · 每天 9 小时 · 门槛 ' + out.generatedFor.threshold);
  console.log('  订单总数        ' + orders);
  console.log('  达到播报门槛    ' + spoken + '  （平均 '
    + (days * 9 * 60 / spoken).toFixed(1) + ' 分钟一条）');
  console.log('  去重后不同金额  ' + list.length + '  （$' + list[0] + ' ~ $'
    + list[list.length - 1] + '）');
  console.log('  其中演示键阶梯  ' + MANUAL_LADDER.length + ' 个：'
    + Object.keys(DEMO_BY_TIER).map((k) => k + ' ' + DEMO_BY_TIER[k].length).join(' / '));
  console.log('');
  console.log('  预渲染体积估算  WAV 24k/16bit ≈ ' + est(list.length, 122)
    + '   mp3 48kbps ≈ ' + est(list.length, 22));
  console.log('');
  console.log('  最短一句  ' + lineText(list[0]));
  console.log('  最长一句  ' + lines.reduce((a, b) =>
    b.text.length > a.text.length ? b : a).text);
  console.log('');
  console.log('→ ' + dst);
}

if (require.main === module) main();
module.exports = { lineText, amountsFor, MANUAL_LADDER, PREFIX };
