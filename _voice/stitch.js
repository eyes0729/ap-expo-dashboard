/* ===========================================================================
 * ⛔ 已废弃 —— 不要接进大屏，也不要在此基础上继续做
 * ---------------------------------------------------------------------------
 * 这是「把金额切成零件、运行时拼起来」的那条路。**它是这块屏「人声太机械」
 * 的第二个来源**（第一个是浏览器 speechSynthesis / Huihui）。
 *
 * 为什么拼接必然假：
 *   下面这套交叉淡化能压掉接缝的咔哒声，但压不掉真正的问题 ——
 *   **每个片段单独合成时，TTS 都会给它一个句尾降调。**
 *   「一千」「二百」「八十美元」三个降调连着出现，就是报电话号码的听感。
 *   这一层不是调 crossfade / gap 能修的，是韵律层面的。
 *   项目自己的 README 待办第 1 条早就写了「**不要做数字拼接**」。
 *
 * 为什么当初会走这条路：因为默认「金额是连续的，不可能每句都预录」。
 *   这个前提是错的 —— 引擎是时间的纯函数，一场展会会播哪些金额可以
 *   提前精确算出来。4 天展期去重后只有 381 个金额（+21 个演示键阶梯）。
 *
 * 现在的正解：
 *   node   _voice/build-lines.js        → 算出清单
 *   python _voice/render-lines.py       → 整句渲染
 *   运行时 _shared/voice-pack.js        → 点播整句
 *
 * 本文件与 `_voice/cosy/clip-*.wav`（299 个零件，17MB）都只作为过程记录保留，
 * 没有任何代码引用它们。要清空间的话可以整个删掉。
 * ===========================================================================
 *
 * ── 以下是原始实现，仅供参考 ───────────────────────────────────────────────
 * 播报拼接器   window.APVoice
 * ---------------------------------------------------------------------------
 * 把「声音标识 + 固定句 + 数字片段」拼成一条完整播报，用 Web Audio 精确排期。
 *
 * 为什么不用 <audio> 顺序播放：它的 onended 有几十毫秒抖动，而这条播报的
 * 全部说服力都在节奏上 —— 抖 50ms 就从"播报"变成"卡带"。Web Audio 的
 * start(t) 是采样级精确的。
 *
 * 三个听感上的关键处理：
 *   1. **交叉淡化**（默认 28ms）。片段是分别生成的，直接首尾相接会有可听的
 *      接缝（相位不连续 → 咔哒声）。淡化窗口不能太长，否则音节会互相吃掉。
 *   2. **片段间不留静音**。中文数字是连读的，「一千」「二百」之间插 100ms
 *      静音就变成报电话号码了。靠淡化重叠来接，净时长反而比相加更短。
 *   3. **标识与人声之间留间隔**（默认 140ms）。这一处反而需要停顿 ——
 *      标识是"提起注意"，人声是"给信息"，中间没有呼吸就糊成一团。
 * =========================================================================== */
(function (root) {
  'use strict';

  var AC = null;
  var cache = {};          /* url -> AudioBuffer */
  var base = '';           /* 素材根路径 */

  function ctx() {
    if (!AC) AC = new (root.AudioContext || root.webkitAudioContext)();
    return AC;
  }

  function load(url) {
    if (cache[url]) return Promise.resolve(cache[url]);
    return root.fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
        return r.arrayBuffer();
      })
      .then(function (a) { return ctx().decodeAudioData(a); })
      .then(function (b) { cache[url] = b; return b; });
  }

  /* ── 数字读法（与 cn-number.js / gen.py 三方一致） ────────────────────── */
  var DIGIT = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

  function under10k(n) {
    var out = [];
    var q = Math.floor(n / 1000), h = Math.floor(n % 1000 / 100),
        t = Math.floor(n % 100 / 10), o = n % 10;
    var zp = false;
    if (q) out.push((q === 2 ? '两' : DIGIT[q]) + '千');
    if (h) out.push(DIGIT[h] + '百');
    else if (q && (t || o)) zp = true;
    if (t) {
      if (zp) { out.push('零'); zp = false; }
      out.push((t === 1 && !q && !h) ? '十' : DIGIT[t] + '十');
    } else if ((q || h) && o) zp = true;
    if (o) {
      if (zp) { out.push('零'); zp = false; }
      out.push(DIGIT[o]);
    }
    return out;
  }

  function toTokens(n) {
    n = Math.round(n);
    if (n <= 0) return ['零'];
    if (n < 10000) return under10k(n);
    var wan = Math.floor(n / 10000), rest = n % 10000;
    var wt = under10k(wan);
    if (wt.length === 1 && wt[0] === '二') wt = ['两'];
    var out = wt.concat(['万']);
    if (rest === 0) return out;
    if (rest < 1000) out.push('零');
    return out.concat(under10k(rest));
  }

  /** 金额 → 片段名数组（每段 ≥2 字，末段带「美元」） */
  function chunks(n) {
    var t = toTokens(n).slice(), out = [], i = 0;
    while (i < t.length) {
      if (strLen(t[i]) === 1 && i + 1 < t.length) { t[i + 1] = t[i] + t[i + 1]; i++; continue; }
      if (strLen(t[i]) === 1 && out.length) { out[out.length - 1] += t[i]; i++; continue; }
      out.push(t[i]); i++;
    }
    if (!out.length) out = [t.join('')];
    out[out.length - 1] += '美元';
    return out;
  }
  function strLen(s) { return Array.from(s).length; }

  /** 一条播报要用到的全部 url */
  function urlsFor(usd, sting) {
    var list = [];
    if (sting) list.push({ url: base + sting, gapAfter: 0.140 });
    list.push({ url: base + 'cosy/clip-prefix.wav', gapAfter: 0.055 });
    var cs = chunks(usd);
    for (var i = 0; i < cs.length; i++) {
      list.push({ url: base + 'cosy/clip-' + cs[i] + '.wav', gapAfter: 0 });
    }
    return list;
  }

  /** 预热：把一条播报会用到的片段先解码好，避免第一次播放时卡一下 */
  function preload(usd, sting) {
    return Promise.all(urlsFor(usd, sting).map(function (x) { return load(x.url); }));
  }

  /**
   * 播放。返回 Promise<总时长秒>。
   * opt.crossfade 片段间交叉淡化秒数（默认 0.028）
   * opt.gap       标识与人声之间的间隔（默认 0.140）
   * opt.gain      总音量
   */
  function play(usd, sting, opt) {
    opt = opt || {};
    var xf = opt.crossfade == null ? 0.028 : opt.crossfade;
    var gap = opt.gap == null ? 0.140 : opt.gap;
    var items = urlsFor(usd, sting);
    if (sting) items[0].gapAfter = gap;

    return Promise.all(items.map(function (x) { return load(x.url); }))
      .then(function (bufs) {
        var c = ctx();
        var master = c.createGain();
        master.gain.value = opt.gain == null ? 1 : opt.gain;
        master.connect(c.destination);

        var t = c.currentTime + 0.06;
        var end = t;
        for (var i = 0; i < bufs.length; i++) {
          var b = bufs[i];
          var g = c.createGain();
          var s = c.createBufferSource();
          s.buffer = b;
          s.connect(g); g.connect(master);

          /* 只在**语音片段之间**做淡化；标识那一段独立，不参与淡化 */
          var isVoice = !(sting && i === 0);
          var fade = (isVoice && i > (sting ? 1 : 0)) ? xf : 0;
          if (fade > 0) {
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(1, t + fade);
          } else {
            g.gain.setValueAtTime(1, t);
          }
          /* 尾部淡出，避免下一段进来时叠出咔哒 */
          if (isVoice && i < bufs.length - 1 && xf > 0) {
            g.gain.setValueAtTime(1, t + b.duration - xf);
            g.gain.linearRampToValueAtTime(0.0001, t + b.duration);
          }
          s.start(t);
          end = t + b.duration;
          /* 下一段的起点：本段结束 - 淡化重叠 + 指定间隔 */
          var nextFade = (i + 1 > (sting ? 1 : 0)) ? xf : 0;
          t = t + b.duration - nextFade + items[i].gapAfter;
        }
        return end - (c.currentTime + 0.06);
      });
  }

  root.APVoice = {
    setBase: function (b) { base = b || ''; },
    chunks: chunks,
    toTokens: toTokens,
    urlsFor: urlsFor,
    preload: preload,
    play: play,
    get cached() { return Object.keys(cache).length; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
