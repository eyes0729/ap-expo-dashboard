/* ===========================================================================
 * 人声播报验收：整句预渲染真的接上了，而且**一条都不会掉回 Huihui**
 * ---------------------------------------------------------------------------
 * 要防的故障是「听起来正常，其实一直在放旧音色」。它有三种发生方式，
 * 每一种在屏上都看不出来：
 *   ① 音频包路径错（写了相对路径，在 /方案名/ 下解析成 404）→ 全场退回 Huihui
 *   ② 某几档金额没渲出来 → 平时好好的，偶尔蹦一句 Huihui
 *   ③ B 键那一档没渲 → 全场最重要的一按恰好是旧音色
 *
 * 所以这里最硬的一条断言是**覆盖率**：把引擎一天真正会播的那批订单枚举出来，
 * 逐个查音频包里有没有。不是抽查，是全量。
 *
 * 用法：node ckVoice.js        （需要 _serve.js 正在跑）
 * =========================================================================== */
const fs = require('fs');
const path = require('path');
const http = require('http');
const PW = 'C:/Users/1/Desktop/工作汇总/Agentic Commerce 产品情报雷达/ac-radar/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright';
const { chromium } = require(PW);

const HOST = 'http://localhost:8099';
const ROOT = path.join(__dirname, '..', '..');
const BOARD = HOST + '/' + encodeURIComponent('E-后台-可操作版') + '/index.html';

let bad = 0, skipped = 0;
const ok = (c, m) => { console.log((c ? '  OK   ' : '  X    ') + m); if (!c) bad++; };
const skip = (m) => { console.log('  --   跳过：' + m); skipped++; };
const sec = (t) => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 54 - t.length)));

function get(url) {
  return new Promise((res) => {
    const r = http.get(url, (x) => {
      let d = '';
      x.on('data', (c) => (d += c));
      x.on('end', () => res({ code: x.statusCode, body: d }));
    });
    r.on('error', (e) => res({ code: 0, body: String(e.message) }));
    r.setTimeout(8000, () => { r.destroy(); res({ code: 0, body: 'timeout' }); });
  });
}

/** 把引擎跑一遍，拿到「一天真正会播报的金额」。和 build-lines.js 同一条路径。 */
function spokenAmounts(days) {
  const root = {};
  new Function('window', 'globalThis',
    fs.readFileSync(path.join(ROOT, '_shared', 'cities.js'), 'utf8'))(root, root);
  globalThis.APGeo = root.APGeo;
  let src = fs.readFileSync(path.join(ROOT, '_shared', 'engine.js'), 'utf8');
  src = src.replace('root.APEngine = API;',
    'root.APEngine = API; root.__oS = ordersInSlot; root.__rar = rarity;');
  new Function('window', 'globalThis', src)(root, root);
  const E = root.APEngine, oS = root.__oS, rar = root.__rar;
  const MIN = E.TIER_RANK[E.CONFIG.VOICE_MIN_TIER || 'rare'];
  const perDay = Math.ceil(9 * 3600 * 1000 / E.CONFIG.SLOT_MS);
  const perCal = Math.floor(24 * 3600 * 1000 / E.CONFIG.SLOT_MS);
  const out = [];
  for (let d = 0; d < days; d++) {
    for (let s = 0; s < perDay; s++) {
      for (const o of oS(s + d * perCal)) {
        if (E.TIER_RANK[rar(o.usd)] >= MIN) out.push(Math.round(o.usd));
      }
    }
  }
  const DL = E.CONFIG.DEMO_LADDERS || {};
  const flat = Object.keys(DL).reduce((a, k) => a.concat(DL[k]), []);
  _demoByTier = DL;
  return { spoken: out, ladder: flat };
}
let _demoByTier = {};
function ladderByTier() { return _demoByTier; }

(async () => {
  /* ══ 一、音频包本身 ══ */
  sec('一、音频包');
  const packs = ['pack-azure', 'pack-edge', 'pack-cosy'];
  let live = null, liveIdx = null;
  for (const p of packs) {
    const r = await get(HOST + '/_voice/' + p + '/index.json');
    if (r.code === 200) {
      try {
        const j = JSON.parse(r.body);
        console.log('   ' + p + '  engine=' + j.engine + '  voice=' + j.voice
          + '  ' + (j.lines || []).length + ' 句');
        if (!live) { live = p; liveIdx = j; }
      } catch (e) { console.log('   ' + p + '  清单坏了：' + e.message); }
    }
  }
  if (!live) {
    skip('一个音频包都没有。先跑：node _voice/build-lines.js 然后 '
       + 'python _voice/render-lines.py --engine azure');
    console.log('\nX  没有音频包，播报仍然是 speechSynthesis（Huihui）');
    process.exit(1);
  }
  ok(!!liveIdx.lines.length, '生效的包是 ' + live + '（按 azure→edge→cosy 优先级）');
  ok(liveIdx.engine === 'azure',
    '包的 engine 是 azure（可商用）。当前=' + liveIdx.engine
    + (liveIdx.engine === 'azure' ? '' : ' ← edge/cosy 只能内部试听，不可对外'));

  /* ══ 二、覆盖率：这是最硬的一条 ══ */
  sec('二、覆盖率（一条都不许掉回 Huihui）');
  const have = new Set(liveIdx.lines.map((l) => l.usd));
  const { spoken, ladder } = spokenAmounts(4);
  const missSet = new Set(spoken.filter((v) => !have.has(v)));
  const cover = 100 * (spoken.length - spoken.filter((v) => !have.has(v)).length) / spoken.length;
  console.log('   4 天展期会播报 ' + spoken.length + ' 条，涉及 '
    + new Set(spoken).size + ' 个不同金额；包里有 ' + have.size + ' 个');
  ok(missSet.size === 0, '全部播报都有对应整句音频（覆盖率 ' + cover.toFixed(2) + '%）'
    + (missSet.size ? '，缺 ' + missSet.size + ' 档：'
        + [...missSet].slice(0, 8).join(',') + '…' : ''));
  const ladderMiss = ladder.filter((v) => !have.has(v));
  ok(ladderMiss.length === 0,
    '演示键阶梯 ' + ladder.length + ' 档全部有音频' + (ladderMiss.length
      ? '，缺 ' + ladderMiss.join(',') + '（BD 台上那几按会掉回 Huihui）' : ''));

  /* 演示键（N/C/B/V）是 BD 在台上的主要动作，金额由按键决定不由时间决定。
   * 它们原来是「区间内随机」，实测覆盖率 C 91% / B 36% / **V 只有 0.7%**。
   * 这一条断言就是钉住「不许回退成区间随机」。 */
  const DL = ladderByTier();
  let tierBad = [];
  for (const t of Object.keys(DL)) {
    const miss = DL[t].filter((v) => !have.has(v));
    console.log('   ' + t.padEnd(10) + DL[t].join(', ') + (miss.length ? '  ✗ 缺 ' + miss.join(',') : '  ✓'));
    if (miss.length) tierBad.push(t);
  }
  ok(tierBad.length === 0, '四档演示阶梯逐档都有音频'
    + (tierBad.length ? '（' + tierBad.join('/') + ' 缺）' : ''));

  /* 时长：播报之间平均 2.4 分钟，一条超过 3.5 秒会盖住下一笔订单的音效 */
  const durs = liveIdx.lines.map((l) => l.dur).filter((d) => typeof d === 'number').sort((a, b) => a - b);
  if (durs.length) {
    console.log('   时长 最短 ' + durs[0].toFixed(2) + 's / 中位 '
      + durs[durs.length >> 1].toFixed(2) + 's / 最长 ' + durs[durs.length - 1].toFixed(2) + 's');
    /* 硬门槛定 4.0s，不是 3.5s。
     * 3.5s 是「理想」（超过就开始盖住下一笔订单的音效），4.0s 是「不可接受」——
     * duck 窗口就是 min(dur+0.3, 4.0)，超过 4s 的话人声还没说完压低就抬回来了，
     * 那一下很明显。3.5~4.0 之间只报数不判红，否则会为了 30ms 去动语速，
     * 而动语速要重渲 381 条。 */
    const warn = durs.filter((d) => d > 3.5).length;
    const over = durs.filter((d) => d > 4.0).length;
    if (warn) console.log('   注意：' + warn + ' 条在 3.5~4.0s 之间（可接受，但没有余量了）');
    ok(over === 0, '没有超过 4.0 秒的句子（duck 窗口上限）'
      + (over ? '（' + over + ' 条超了，提高语速重渲）' : ''));
    /* 电平一致性靠渲染时归一化保证，这里只查时长离散度别太离谱 */
    ok(durs[durs.length - 1] - durs[0] < 2.0,
      '最长与最短相差 ' + (durs[durs.length - 1] - durs[0]).toFixed(2) + 's（<2s，节奏才稳）');
  }

  /* ══ 三、浏览器里真的走了预渲染那条路 ══ */
  sec('三、运行时（真的在放整句，不是 Huihui）');
  const b = await chromium.launch();
  const p = await b.newPage();
  const logs = [], errs = [];
  p.on('console', (m) => logs.push(m.text()));
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BOARD, { waitUntil: 'load' });
  await p.click('#goBtn').catch(() => {});
  await p.waitForTimeout(2500);

  const vp = await p.evaluate(() => {
    const V = window.APVoicePack;
    return V ? { mode: V.mode, base: V.base, info: V.info, err: V.error,
                 ladder: V.ladder } : null;
  });
  ok(!!vp, 'APVoicePack 已加载');
  console.log('   ' + JSON.stringify(vp));
  ok(vp && vp.mode === 'ready',
    'mode=ready（拿到清单了）' + (vp && vp.mode !== 'ready' ? '  err=' + vp.err : ''));
  ok(!!(vp && vp.base && /_voice\/pack-/.test(vp.base)),
    '包路径是从 script src 反推的绝对路径：' + (vp && vp.base));

  /* 真的播一条，看走的是哪条路 */
  const played = await p.evaluate(async () => {
    const V = window.APVoicePack;
    const r = await V.play(1280, { gain: 0 });      /* gain=0，无声验证链路 */
    return r;
  });
  ok(played && played.ok, '播 $1,280 成功（走音频包，dur='
    + (played && played.dur ? played.dur.toFixed(2) + 's' : '?') + '）');

  /* 按 B 键，然后看 audio 的 voiceSource */
  await p.evaluate(() => window.APAudio && window.APAudio.setMuted(false));
  await p.keyboard.press('b');
  await p.waitForTimeout(1800);
  const src = await p.evaluate(() => window.APAudio && window.APAudio.voiceSource);
  console.log('   按 B 之后 APAudio.voiceSource =', JSON.stringify(src));
  ok(src === 'pack', 'B 键的播报走的是整句音频包'
    + (src !== 'pack' ? '（现在是 ' + src + ' —— 也就是在放 Huihui）' : ''));

  const fellBack = logs.filter((l) => /退回 speechSynthesis|没有预渲染整句/.test(l));
  ok(fellBack.length === 0, '没有任何一条退回 speechSynthesis 的日志'
    + (fellBack.length ? '：' + fellBack.slice(0, 3).join(' | ') : ''));
  ok(errs.length === 0, '无 JS 错误' + (errs.length ? '：' + errs.slice(0, 2).join(' | ') : ''));

  await b.close();
  console.log('\n' + (bad ? 'X  ' + bad + ' 项不过' : 'OK 人声播报验收通过')
    + (skipped ? '（跳过 ' + skipped + ' 项）' : ''));
  process.exit(bad ? 1 : 0);
})();
