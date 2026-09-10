/* ===========================================================================
 * 声音标识（sonic logo）候选生成器
 * ---------------------------------------------------------------------------
 * 纯数学合成，零依赖，输出 44.1kHz / 16bit / 立体声 WAV。
 * 不用采样库的原因：展会资产必须自包含、可商用、可反复微调；
 * 买来的音效包每次改都要重新过授权。
 *
 * 五个候选各自的取向（见文件末尾 CANDIDATES）。共同约束来自调研：
 *   · 时长 ≤1.2s —— 「一秒钟植入」是字面要求，不是修辞
 *   · 避开 2–4kHz 的刺耳区，主要能量放在 500–1600Hz（嘈杂展馆里穿透力最好的一段）
 *   · 每条都必须有**清晰的瞬态起音**，否则在人声嘈杂的展馆里会被糊掉
 *   · 收尾干净，不能有拖尾嗡鸣 —— 它每分钟都要响一次
 * =========================================================================== */
const fs = require('fs');
const path = require('path');

const SR = 44100;

/* ── 基础工具 ───────────────────────────────────────────────────────────── */
const TAU = Math.PI * 2;
/** 半音 → 频率（A4=440） */
const hz = n => 440 * Math.pow(2, (n - 69) / 12);
/** 指数衰减包络：t 秒时的增益 */
const decay = (t, tau) => Math.exp(-t / tau);
/** 起音斜坡，避免 click（除非故意要 click） */
const attack = (t, a) => (t < a ? t / a : 1);
/** 平滑的 0→1→0 钟形 */
const bell = u => Math.sin(Math.PI * Math.max(0, Math.min(1, u)));

/** 单极点低通，逐样本 */
function makeLP(cut) {
  let y = 0;
  const a = Math.exp(-TAU * cut / SR);
  return x => (y = x * (1 - a) + y * a);
}
/** 单极点高通 */
function makeHP(cut) {
  let yPrev = 0, xPrev = 0;
  const a = Math.exp(-TAU * cut / SR);
  return x => { const y = a * (yPrev + x - xPrev); xPrev = x; yPrev = y; return y; };
}

/** 极简混响：几条固定延时的衰减抽头。够用，且完全可控。 */
function reverb(buf, mix, times, fb) {
  const out = buf.slice();
  for (const ms of times) {
    const d = Math.round(ms / 1000 * SR);
    let g = fb;
    for (let rep = 1; rep <= 3; rep++) {
      const off = d * rep;
      for (let i = off; i < out.length; i++) out[i] += buf[i - off] * g * mix;
      g *= fb;
    }
  }
  return out;
}

function write(name, L, R) {
  /* 峰值归一到 -1.5dBFS，避免削顶又保证响度一致 */
  let peak = 0;
  for (let i = 0; i < L.length; i++) {
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const g = peak > 0 ? (0.84 / peak) : 1;
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
  const p = path.join(__dirname, name);
  fs.writeFileSync(p, buf);
  console.log('  ' + name + '  ' + (n / SR).toFixed(2) + 's  ' + (buf.length / 1024).toFixed(0) + 'KB');
}

const sec = s => Math.round(s * SR);
const zeros = s => new Float64Array(sec(s));

/* ═══════════════════════════════════════════════════════════════════════
 * 候选 1 「跃升」 Rise
 *   三音上行（D5 → A5 → D6），FM 钟声音色。
 *   最接近「到账 / 成功」的通用语汇：上行 = 正向结果，听懂不需要学习成本。
 *   稳妥、不会出错，但也最不独特。
 * ═══════════════════════════════════════════════════════════════════════ */
function rise() {
  const dur = 1.05, L = zeros(dur), R = zeros(dur);
  const notes = [[74, 0.00, 0.9], [81, 0.085, 0.95], [86, 0.17, 1.0]];
  for (const [midi, t0, amp] of notes) {
    const f = hz(midi), s0 = sec(t0);
    for (let i = s0; i < L.length; i++) {
      const t = (i - s0) / SR;
      /* FM：调制比 2:1，指数下降的调制深度 → 起音有金属泛音，尾巴回到纯音 */
      const mi = 2.2 * decay(t, 0.09);
      const v = Math.sin(TAU * f * t + mi * Math.sin(TAU * f * 2 * t));
      const env = attack(t, 0.004) * decay(t, 0.30);
      const s = v * env * amp * 0.5;
      /* 三个音轻微左右分开，出立体声宽度 */
      const pan = (midi - 81) / 12 * 0.25;
      L[i] += s * (1 - pan); R[i] += s * (1 + pan);
    }
  }
  return [reverb(L, 0.18, [37, 53], 0.5), reverb(R, 0.18, [41, 59], 0.5)];
}

/* ═══════════════════════════════════════════════════════════════════════
 * 候选 2 「脉冲」 Pulse
 *   低频 sub「咚」+ 高频瞬态 click + 一道 180ms 的上滑扫频。
 *   数据/信号到达感，最「科技」的一条。
 *   代价：偏冷，没有旋律，不容易被哼出来。
 * ═══════════════════════════════════════════════════════════════════════ */
function pulse() {
  const dur = 0.95, L = zeros(dur), R = zeros(dur);
  const lp = makeLP(2400), hp = makeHP(900);
  for (let i = 0; i < L.length; i++) {
    const t = i / SR;
    /* sub：58Hz 下滑到 42Hz，给"落地"的重量 */
    const fSub = 58 - 16 * Math.min(1, t / 0.18);
    const sub = Math.sin(TAU * fSub * t) * decay(t, 0.12) * 0.9;
    /* 瞬态：极短的宽带 click，让它在嘈杂环境里"扎"得出来 */
    const clickEnv = decay(t, 0.006);
    const click = hp((Math.sin(TAU * 3200 * t) + Math.sin(TAU * 5100 * t) * 0.6)) * clickEnv * 0.5;
    /* 扫频：420Hz → 1500Hz，指数上行，180ms 内完成 */
    const u = Math.min(1, t / 0.18);
    const fSw = 420 * Math.pow(1500 / 420, u);
    const sweep = Math.sin(TAU * fSw * t) * bell(t / 0.30) * 0.42;
    /* 尾音：一个 1200Hz 的短泛音，收得干净 */
    const tail = t > 0.16
      ? Math.sin(TAU * 1200 * (t - 0.16)) * decay(t - 0.16, 0.16) * 0.30 : 0;
    const s = lp(sub + click + sweep + tail);
    L[i] = s; R[i] = s * 0.97 + click * 0.06;
  }
  return [reverb(L, 0.10, [29], 0.35), reverb(R, 0.10, [33], 0.35)];
}

/* ═══════════════════════════════════════════════════════════════════════
 * 候选 3 「水晶」 Crystal
 *   纯正弦 + 精选泛音的铃，长而干净的衰减。
 *   最"贵"的一条 —— 接近 Apple Pay / 高端硬件开机音的质感。
 *   在嘈杂展馆里穿透力略弱于「脉冲」，但辨识度高、重复几百次也不烦。
 * ═══════════════════════════════════════════════════════════════════════ */
function crystal() {
  const dur = 1.20, L = zeros(dur), R = zeros(dur);
  /* 两击：主音 + 上方五度，间隔 110ms */
  const hits = [[0.00, 88, 1.0], [0.11, 95, 0.72]];
  /* 非整数倍泛音 = 金属铃的音色来源（整数倍会听成风琴） */
  const parts = [[1.0, 1.0], [2.01, 0.42], [3.03, 0.22], [4.08, 0.12], [5.42, 0.07]];
  for (const [t0, midi, amp] of hits) {
    const f = hz(midi), s0 = sec(t0);
    for (let i = s0; i < L.length; i++) {
      const t = (i - s0) / SR;
      let v = 0;
      for (const [mul, a] of parts) {
        /* 高次泛音衰减更快 —— 真实的铃就是这样 */
        v += Math.sin(TAU * f * mul * t) * a * decay(t, 0.62 / Math.pow(mul, 0.85));
      }
      const s = v * attack(t, 0.003) * amp * 0.28;
      const pan = t0 > 0 ? 0.22 : -0.16;
      L[i] += s * (1 - pan); R[i] += s * (1 + pan);
    }
  }
  return [reverb(L, 0.26, [43, 67, 89], 0.45), reverb(R, 0.26, [47, 71, 97], 0.45)];
}

/* ═══════════════════════════════════════════════════════════════════════
 * 候选 4 「引力」 Gravity
 *   大气 pad 垫底 + 一记低沉的落点 + 上方泛音散开。
 *   参考小鹏用管风琴/Atmosphere 做科幻感的思路，也**呼应我们自己的全屏地球**。
 *   最有"世界感"，但也最长、最不适合高频触发。
 * ═══════════════════════════════════════════════════════════════════════ */
function gravity() {
  const dur = 1.20, L = zeros(dur), R = zeros(dur);
  const lp = makeLP(3200);
  /* pad：三个轻微失谐的锯齿叠加，慢起音 */
  const padF = [hz(50), hz(57), hz(62)];
  for (let i = 0; i < L.length; i++) {
    const t = i / SR;
    let pad = 0;
    for (let k = 0; k < padF.length; k++) {
      const f = padF[k] * (1 + (k - 1) * 0.0035);      /* 失谐 = 厚度 */
      /* 用几个谐波近似锯齿，避免混叠 */
      for (let h = 1; h <= 6; h++) pad += Math.sin(TAU * f * h * t) / h * 0.11;
    }
    pad *= bell(t / dur) * 0.55;
    /* 落点：72Hz 的短促下沉 */
    const hit = t > 0.06
      ? Math.sin(TAU * (72 - 26 * Math.min(1, (t - 0.06) / 0.20)) * (t - 0.06))
        * decay(t - 0.06, 0.17) * 0.85 : 0;
    /* 上方泛音：两颗高音点，像星光 */
    let spark = 0;
    for (const [ts, m] of [[0.20, 93], [0.33, 100]]) {
      if (t > ts) spark += Math.sin(TAU * hz(m) * (t - ts)) * decay(t - ts, 0.34) * 0.20;
    }
    const s = lp(pad + hit + spark);
    L[i] = s; R[i] = s * 0.94 + spark * 0.10;
  }
  return [reverb(L, 0.30, [53, 79, 113], 0.52), reverb(R, 0.30, [59, 83, 121], 0.52)];
}

/* ═══════════════════════════════════════════════════════════════════════
 * 候选 5 「双击」 Two-tap
 *   两声极短的电子敲击 + 一点尾音。0.42 秒，五条里最短。
 *   专门给**高频触发**用：如果最后决定「大额只出标识、不出人声」，
 *   这条是唯一能每分钟响一次还不烦的。
 * ═══════════════════════════════════════════════════════════════════════ */
function twoTap() {
  const dur = 0.55, L = zeros(dur), R = zeros(dur);
  const hits = [[0.00, 1180, 1.0], [0.085, 1760, 0.85]];
  for (const [t0, f, amp] of hits) {
    const s0 = sec(t0);
    for (let i = s0; i < L.length; i++) {
      const t = (i - s0) / SR;
      /* 木质感：基频 + 一个 2.4 倍非整数泛音，衰减极快 */
      const v = Math.sin(TAU * f * t) * decay(t, 0.055)
              + Math.sin(TAU * f * 2.4 * t) * decay(t, 0.022) * 0.45;
      const s = v * attack(t, 0.0015) * amp * 0.5;
      const pan = t0 > 0 ? 0.2 : -0.2;
      L[i] += s * (1 - pan); R[i] += s * (1 + pan);
    }
  }
  return [reverb(L, 0.12, [31, 47], 0.34), reverb(R, 0.12, [35, 51], 0.34)];
}

const CANDIDATES = [
  ['sting-1-rise.wav',    rise,    '跃升 · 三音上行，最通用的「成功」语汇'],
  ['sting-2-pulse.wav',   pulse,   '脉冲 · 信号到达感，最「科技」'],
  ['sting-3-crystal.wav', crystal, '水晶 · 铃音，最「贵」、最耐听'],
  ['sting-4-gravity.wav', gravity, '引力 · 大气+落点，呼应全屏地球'],
  ['sting-5-twotap.wav',  twoTap,  '双击 · 0.55s，专给高频触发']
];

console.log('生成声音标识候选：');
for (const [name, fn, desc] of CANDIDATES) {
  const [L, R] = fn();
  write(name, L, R);
  console.log('        ' + desc);
}
console.log('\n完成。听 audition.html 做 A/B。');
