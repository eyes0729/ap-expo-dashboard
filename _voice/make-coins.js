/* ===========================================================================
 * 「钱到账」音效候选生成器
 * ---------------------------------------------------------------------------
 * 纯数学合成，零素材、零依赖，44.1kHz / 16bit / 立体声。
 * 和 make-stings.js 同一套路：展会资产必须自包含、可商用、可反复微调。
 *
 * ── 硬币声到底是什么 ────────────────────────────────────────────────────
 * 不是"叮"一声正弦波。一枚硬币落地是：
 *   ① 极快的撞击瞬态（<1ms 的噪声脉冲，金属与台面的第一次接触）
 *   ② 圆盘的**非谐**振动模式 —— 频率比不是 1:2:3，而是接近
 *      1 : 1.73 : 2.41 : 3.17（薄圆盘的弯曲模态）。这一条是关键：
 *      用整数泛音会立刻听成"钟"或"乐器"，不是硬币。
 *   ③ 高次模式衰减更快（越高越短），所以音色在 100ms 内由"铛"变"叮"
 *
 * 一把硬币哗啦倒出来 = 几十枚上面这种事件在时间上随机散布，
 * 密度先冲高再拖尾。密度曲线比单枚音色更决定"像不像钱"。
 *
 * ── 为什么不直接买音效 ──────────────────────────────────────────────────
 * 采样库的硬币音多半带房间混响和一次性的随机排布，两次播放完全一样，
 * 每 2.4 分钟响一次会很快被听出是循环。这里每枚硬币的音高、时刻、
 * 声像都由**确定性伪随机**给出：种子固定所以可复现，换个种子就是新的一把。
 *
 * ── 展馆约束（沿用 make-stings.js 的调研结论）────────────────────────────
 *   · 总长 ≤1.2s
 *   · 主要能量 1.5~6kHz（硬币的亮度就在这），但把 3~4kHz 压一点 ——
 *     那一段在 85dB 下最扎耳，而每分钟都要响一次
 *   · 收尾必须干净，不留嗡鸣
 *
 * 用法：node make-coins.js
 * =========================================================================== */
const fs = require('fs');
const path = require('path');

const SR = 44100;
const TAU = Math.PI * 2;

const zeros = (durSec) => new Float64Array(Math.ceil(durSec * SR));
const sec = (t) => Math.round(t * SR);
const decay = (t, tau) => Math.exp(-t / tau);
const attack = (t, a) => (t < a ? t / a : 1);

/** 确定性伪随机：同一个种子永远同一把硬币，可复现、可回归。 */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

function makeLP(cut) {
  let y = 0;
  const a = Math.exp(-TAU * cut / SR);
  return (x) => (y = x * (1 - a) + y * a);
}
function makeHP(cut) {
  let yP = 0, xP = 0;
  const a = Math.exp(-TAU * cut / SR);
  return (x) => { const y = a * (yP + x - xP); xP = x; yP = y; return y; };
}
/** 窄带陷波：专门压 3~4kHz 那一口刺耳 */
function makeNotch(f0, q) {
  const w = TAU * f0 / SR, alpha = Math.sin(w) / (2 * q);
  const b0 = 1, b1 = -2 * Math.cos(w), b2 = 1;
  const a0 = 1 + alpha, a1 = -2 * Math.cos(w), a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2
            - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

function reverb(buf, mix, times, fb) {
  const out = buf.slice();
  for (const ms of times) {
    const d = Math.round(ms / 1000 * SR);
    let g = fb;
    for (let rep = 1; rep <= 3; rep++) {
      const off = d * rep;
      for (let i = off; i < buf.length; i++) out[i] += buf[i - off] * g * mix;
      g *= fb;
    }
  }
  return out;
}

/* ── 一枚硬币 ─────────────────────────────────────────────────────────────
 * f0    基频（小硬币高、大硬币低，约 1800~4200Hz）
 * amp   音量
 * t0    落点时刻
 * pan   -1 左 / +1 右
 * 薄圆盘的弯曲模态比（非谐！用整数泛音就变成钟了）：*/
const DISC_MODES = [1.0, 1.73, 2.41, 3.17, 4.06];
const MODE_GAIN  = [1.0, 0.62, 0.38, 0.22, 0.12];
const MODE_TAU   = [0.090, 0.055, 0.035, 0.022, 0.014];

function addCoin(L, R, t0, f0, amp, pan, rnd) {
  const s0 = sec(t0);
  if (s0 >= L.length) return;
  /* 每枚硬币的模态比再抖一点，否则几十枚叠起来会听出"同一个音色复制"的机器感 */
  const jitter = 1 + (rnd() - 0.5) * 0.06;
  const tail = sec(0.22);
  for (let i = s0; i < Math.min(L.length, s0 + tail); i++) {
    const t = (i - s0) / SR;
    let v = 0;
    for (let m = 0; m < DISC_MODES.length; m++) {
      v += Math.sin(TAU * f0 * DISC_MODES[m] * jitter * t)
         * decay(t, MODE_TAU[m]) * MODE_GAIN[m];
    }
    /* 撞击瞬态：0.8ms 的噪声，给"金属碰到台面"那一下 */
    if (t < 0.0008) v += (rnd() * 2 - 1) * 1.4 * (1 - t / 0.0008);
    const s = v * attack(t, 0.0004) * amp * 0.22;
    L[i] += s * (1 - pan * 0.6);
    R[i] += s * (1 + pan * 0.6);
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * 候选 1 「哗啦」 Coin shower
 *   一把硬币倒出来。密度前 120ms 冲到最高再指数拖尾 —— 这条密度曲线
 *   比单枚音色更决定像不像"一笔钱"，匀速散布听起来像下雨不像倒钱。
 * ═══════════════════════════════════════════════════════════════════════ */
function coinShower() {
  const dur = 1.05, L = zeros(dur), R = zeros(dur);
  const rnd = rng(20260825);
  const N = 46;
  for (let k = 0; k < N; k++) {
    const u = k / N;
    /* 时刻：前密后疏。u^1.9 把大部分硬币压在前 1/3 */
    const t0 = Math.pow(u, 1.9) * 0.72 + rnd() * 0.035;
    /* 音高：大小硬币混着，越晚落的越小（能量耗散） */
    const f0 = (2100 + rnd() * 1900) * (1 - u * 0.22);
    const amp = (1 - u * 0.55) * (0.55 + rnd() * 0.45);
    addCoin(L, R, t0, f0, amp, rnd() * 2 - 1, rnd);
  }
  const hp = makeHP(600), notch = makeNotch(3400, 1.1), lp = makeLP(11000);
  for (let i = 0; i < L.length; i++) {
    L[i] = lp(notch(hp(L[i])));
  }
  const hp2 = makeHP(600), notch2 = makeNotch(3400, 1.1), lp2 = makeLP(11000);
  for (let i = 0; i < R.length; i++) {
    R[i] = lp2(notch2(hp2(R[i])));
  }
  return [reverb(L, 0.13, [23, 37], 0.30), reverb(R, 0.13, [27, 41], 0.30)];
}

/* ═══════════════════════════════════════════════════════════════════════
 * 候选 2 「入袋」 Into the bag
 *   几枚硬币落进布袋：清脆的硬币 + 一记低沉的布袋闷响。
 *   最贴"钱袋入金"这个说法，也最不吵 —— 硬币只有 12 枚。
 * ═══════════════════════════════════════════════════════════════════════ */
function coinBag() {
  const dur = 1.1, L = zeros(dur), R = zeros(dur);
  const rnd = rng(880301);
  for (let k = 0; k < 12; k++) {
    const u = k / 12;
    const t0 = Math.pow(u, 1.5) * 0.42 + rnd() * 0.03;
    addCoin(L, R, t0, 2300 + rnd() * 1500, (1 - u * 0.4) * 0.9,
            rnd() * 1.4 - 0.7, rnd);
  }
  /* 布袋闷响：低频 + 快速衰减的噪声，代表一堆钱落进软布 */
  const bs = sec(0.30);
  for (let i = bs; i < L.length; i++) {
    const t = (i - bs) / SR;
    const thud = (Math.sin(TAU * 96 * t) * 0.7 + Math.sin(TAU * 61 * t) * 0.5)
                 * decay(t, 0.085);
    const cloth = (rnd() * 2 - 1) * decay(t, 0.045) * 0.30;
    const s = (thud + cloth) * attack(t, 0.004) * 0.30;
    L[i] += s; R[i] += s * 0.97;
  }
  const lpL = makeLP(10000), lpR = makeLP(10000);
  const nL = makeNotch(3500, 1.2), nR = makeNotch(3500, 1.2);
  for (let i = 0; i < L.length; i++) { L[i] = lpL(nL(L[i])); R[i] = lpR(nR(R[i])); }
  return [reverb(L, 0.16, [29, 43], 0.34), reverb(R, 0.16, [33, 47], 0.34)];
}

/* ═══════════════════════════════════════════════════════════════════════
 * 候选 3 「收银」 Cash register
 *   一记明亮的收银铃 + 一小把硬币。最像"成交"的商业语汇。
 * ═══════════════════════════════════════════════════════════════════════ */
function cashRegister() {
  const dur = 1.15, L = zeros(dur), R = zeros(dur);
  const rnd = rng(51987);
  /* 收银铃：两个非谐部分音，长一点的衰减 */
  for (let i = 0; i < L.length; i++) {
    const t = i / SR;
    const bellv = (Math.sin(TAU * 2637 * t) * decay(t, 0.42)
                 + Math.sin(TAU * 2637 * 2.76 * t) * decay(t, 0.17) * 0.42
                 + Math.sin(TAU * 2637 * 5.4 * t) * decay(t, 0.06) * 0.16)
                 * attack(t, 0.0006) * 0.30;
    L[i] += bellv; R[i] += bellv * 0.93;
  }
  for (let k = 0; k < 16; k++) {
    const u = k / 16;
    addCoin(L, R, 0.11 + Math.pow(u, 1.6) * 0.46 + rnd() * 0.03,
            2400 + rnd() * 1700, (1 - u * 0.5) * 0.75, rnd() * 2 - 1, rnd);
  }
  const nL = makeNotch(3600, 1.0), nR = makeNotch(3600, 1.0);
  const lpL = makeLP(12000), lpR = makeLP(12000);
  for (let i = 0; i < L.length; i++) { L[i] = lpL(nL(L[i])); R[i] = lpR(nR(R[i])); }
  return [reverb(L, 0.18, [31, 47, 67], 0.36), reverb(R, 0.18, [35, 53, 71], 0.36)];
}

/* ═══════════════════════════════════════════════════════════════════════
 * 候选 4 「到账」 Alipay-style
 *   说明一件事：支付宝那个声音**本身不是硬币**，是一个干净的双音提示音。
 *   用户要的"钱袋入金感"其实来自「提示音 + 人声」的组合，不是音色里有钱币。
 *   所以这条走原路：清亮双音上行 + 极轻的硬币点缀（只有 6 枚，垫在后面）。
 *   最耐听 —— 每 2.4 分钟响一次也不烦，这是它和前三条的核心差别。
 * ═══════════════════════════════════════════════════════════════════════ */
function payChime() {
  const dur = 1.0, L = zeros(dur), R = zeros(dur);
  const rnd = rng(20260401);
  /* 双音上行：完全五度，最"确认"的音程 */
  const notes = [[0.00, 1568, 1.0], [0.135, 2349, 0.92]];
  for (const [t0, f, amp] of notes) {
    const s0 = sec(t0);
    for (let i = s0; i < L.length; i++) {
      const t = (i - s0) / SR;
      const v = (Math.sin(TAU * f * t) * decay(t, 0.30)
               + Math.sin(TAU * f * 2.01 * t) * decay(t, 0.11) * 0.30
               + Math.sin(TAU * f * 3.02 * t) * decay(t, 0.05) * 0.12)
               * attack(t, 0.0018) * amp * 0.34;
      L[i] += v * 0.98; R[i] += v;
    }
  }
  /* 硬币只做点缀，音量压到 0.3 —— 让人"感觉到钱"而不是"听见一堆硬币" */
  for (let k = 0; k < 6; k++) {
    addCoin(L, R, 0.16 + k * 0.038 + rnd() * 0.02,
            2800 + rnd() * 1400, 0.30, rnd() * 2 - 1, rnd);
  }
  const nL = makeNotch(3500, 1.3), nR = makeNotch(3500, 1.3);
  const lpL = makeLP(12000), lpR = makeLP(12000);
  for (let i = 0; i < L.length; i++) { L[i] = lpL(nL(L[i])); R[i] = lpR(nR(R[i])); }
  return [reverb(L, 0.20, [37, 53], 0.38), reverb(R, 0.20, [41, 59], 0.38)];
}

/* ── 归一 + 写 WAV ─────────────────────────────────────────────────────── */
function write(name, L, R) {
  let peak = 0;
  for (let i = 0; i < L.length; i++) {
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const g = peak > 0 ? 0.89 / peak : 1;          /* 留 1dB 余量，防播放端削顶 */
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, L[i] * g));
    const r = Math.max(-1, Math.min(1, R[i] * g));
    buf.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
  }
  fs.writeFileSync(path.join(__dirname, name), buf);
  return { dur: n / SR, peak };
}

const CANDIDATES = [
  ['coin-1-shower.wav',   coinShower,   '哗啦 · 一把硬币倒出来，46 枚，最"多钱"'],
  ['coin-2-bag.wav',      coinBag,      '入袋 · 硬币 + 布袋闷响，最贴"钱袋入金"'],
  ['coin-3-register.wav', cashRegister, '收银 · 收银铃 + 硬币，最像"成交"'],
  ['coin-4-chime.wav',    payChime,     '到账 · 双音上行 + 轻硬币点缀，最耐听']
];

console.log('生成「钱到账」音效候选：');
for (const [name, fn, desc] of CANDIDATES) {
  const [L, R] = fn();
  const r = write(name, L, R);
  console.log('  ' + name.padEnd(22) + r.dur.toFixed(2) + 's   ' + desc);
}
console.log('\n完成。在 _voice/试听-人声候选.html 里和人声组合着听。');
