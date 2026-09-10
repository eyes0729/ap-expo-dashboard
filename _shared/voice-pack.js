/* ===========================================================================
 * 整句播报包   window.APVoicePack
 * ---------------------------------------------------------------------------
 * 播一条预先渲染好的**整句**音频，替掉浏览器的 speechSynthesis。
 *
 * ── 为什么要替掉 speechSynthesis ─────────────────────────────────────────────
 * 大屏一直在用 `speechSynthesis`。它念出来是什么，取决于**这台机器装了什么音色**。
 * 展会机上实测：中文音色只有一个 —— Microsoft Huihui Desktop，
 * 2013 年那代 SAPI5 拼接式合成。所谓「太机械化电子化」就是它，
 * 不是参数调坏了，是引擎老了 13 年，rate/pitch 怎么调都救不回来。
 *
 * 而且它还有两个现场层面的问题：
 *   ① **音色可能根本不存在。** 换一台机器、或者系统语言包没装全，
 *      `getVoices()` 里没有 zh-CN，播报直接静默消失（现在的
 *      `voiceAvailable` 就是在兜这个）。播报是这块屏的核心记忆点，
 *      不能依赖「希望目标机器刚好装了中文音色」。
 *   ② **朗读时长不可控。** 同一句话不同引擎能差一倍，节奏设计全废。
 *
 * ── 为什么是整句而不是拼接 ───────────────────────────────────────────────────
 * README 待办第 1 条：「不要做数字拼接 —— 拼接的接缝在 85dB 环境里更假」。
 * 但 `_voice/stitch.js` 做的正是拼接。拼接假的根因不是接缝的咔哒声
 * （交叉淡化能压掉），而是**每个片段单独合成时都自带一个句尾降调**，
 * 「一千」「二百」「八十美元」三个降调连着出现 = 报电话号码的听感。
 *
 * 「金额连续所以不可能每句都预录」这个前提是错的：引擎是时间的纯函数，
 * 一场展会会播哪些金额可以提前精确算出来。4 天展期去重后 381 句、45MB。
 * 生成链：`node _voice/build-lines.js` → `python _voice/render-lines.py`。
 *
 * ── 退化路径 ────────────────────────────────────────────────────────────────
 * 拿不到音频包（没渲染 / 路径不对 / file:// 打开）时**退回 speechSynthesis**，
 * 也就是恢复成今天的行为，绝不静默不出声。退化时 `APVoicePack.mode` 会变成
 * 'fallback'，屏上诊断能看出来 —— 别让现场以为在放好音色其实是 Huihui。
 * =========================================================================== */
(function (root) {
  'use strict';

  /* ── 音频包在哪 ────────────────────────────────────────────────────────────
   * **必须从自己这个 script 的 URL 反推**，不能写相对路径。
   * 九个方案页都在 `<root>/<方案名>/index.html`，写 '_voice/…' 会解析成
   * `<root>/<方案名>/_voice/…` —— 404，然后静默退回 Huihui，
   * 而屏上看不出任何异常。这类"退化了但看不见"的坑是这块屏最贵的。 */
  function rootOf() {
    try {
      var s = document.currentScript;
      if (!s) {                            /* 老浏览器 / 动态插入时兜底 */
        var all = document.getElementsByTagName('script');
        for (var i = all.length - 1; i >= 0; i--) {
          if (/voice-pack\.js/.test(all[i].src || '')) { s = all[i]; break; }
        }
      }
      if (s && s.src) return s.src.replace(/\/_shared\/voice-pack\.js.*$/, '/');
    } catch (e) {}
    return '../';                          /* 实在拿不到，按「页面在一级子目录」猜 */
  }
  /* 候选包按优先级排。azure 是正式可商用的那个；edge 只是内部试听用，
   * 排在后面是为了「渲了 azure 就自动切过去」，不用改代码。
   * 真的落到 edge 上时下面会在 console 里喊一声 —— 别不小心拿它对外。 */
  var CANDIDATES = ['_voice/pack-azure/', '_voice/pack-edge/', '_voice/pack-cosy/'];
  var BASE = null;
  var idx = null;                      /* usd -> {file, dur} */
  var ladder = [];
  var AC = null, cache = {}, loading = {};
  var state = 'idle';                  /* idle | loading | ready | fallback */
  var lastErr = null;

  /* ── AudioContext 必须和 audio.js 共用一个 ────────────────────────────────
   * 这里原来是自己 new 一个。后果：audio.js 把它的 master 节点当 destination
   * 传进来，而 BufferSource 是在**本模块的 context** 上创建的，于是
   *   `cannot connect to an AudioNode belonging to a different audio context`
   * 每一条播报都抛，然后**静默退回 speechSynthesis** —— 也就是全场都在放
   * Huihui，而屏上一切正常、console 里只有一行 warn。
   * （验收脚本 ckVoice.js 第三节就是为了逮这个而写的，第一次跑就红了。）
   *
   * 另外 duck 用的是 audio.js 的 ctx.currentTime，两个 context 时钟基准不同，
   * 就算连得上，压低人声的时间点也会错。所以共用是唯一正确解。 */
  function ctx() {
    if (!AC && (root.AudioContext || root.webkitAudioContext)) {
      AC = new (root.AudioContext || root.webkitAudioContext)();
    }
    return AC;
  }
  /** 由 audio.js 在 unlock() 里注入它自己的 context。 */
  function useContext(c) {
    if (c && c !== AC) { AC = c; cache = {}; loading = {}; }
    return AC;
  }

  /** 载入清单。按 CANDIDATES 顺序试，第一个能读到的就用。
   *  失败不抛 —— 调用方靠 mode 判断要不要退回 speechSynthesis。 */
  function init(base) {
    if (state === 'loading' || state === 'ready') return Promise.resolve(state);
    if (!root.fetch) { state = 'fallback'; lastErr = 'no fetch'; return Promise.resolve(state); }
    state = 'loading';
    var r0 = rootOf();
    var errs = [];

    /* 先问服务端有哪些包（一次请求，不产生 404）。
     * 拿不到（file:// 打开、或旧版 _serve.js）再退回按 CANDIDATES 逐个试探 ——
     * 那条路会在缺包时留下 404，但只在非标准部署下发生。 */
    function discover() {
      if (base) return Promise.resolve([base]);
      return root.fetch(r0 + '__voice', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (j && j.packs && j.packs.length) {
            return j.packs.map(function (n) { return r0 + '_voice/' + n + '/'; });
          }
          return CANDIDATES.map(function (c) { return r0 + c; });
        })
        .catch(function () {
          return CANDIDATES.map(function (c) { return r0 + c; });
        });
    }

    var tryList = [];
    function attempt(i) {
      if (i >= tryList.length) {
        lastErr = errs.join(' / ') || '没有可用的音频包';
        state = 'fallback';
        return state;
      }
      var b = tryList[i];
      return root.fetch(b + 'index.json', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          var m = {};
          (j.lines || []).forEach(function (l) { m[l.usd] = l; });
          if (!Object.keys(m).length) throw new Error('清单是空的');
          idx = m;
          BASE = b;
          ladder = j.manualLadder || [];
          state = 'ready';
          API.info = { engine: j.engine, voice: j.voice, rate: j.rate,
                       base: b, count: Object.keys(m).length };
          /* 授权护栏：edge / cosy 都不是能对外用的授权渠道（见 render-lines.py 头部）。
           * 现场万一是这两个包在跑，必须在 console 里留下痕迹。 */
          if (j.engine !== 'azure' && root.console) {
            root.console.warn('[播报] 当前音频包 engine=' + j.engine
              + '，仅供内部试听，不可对外使用。正式请渲 pack-azure。');
          }
          return state;
        })
        .catch(function (e) {
          errs.push(b.replace(/^.*\/_voice\//, '') + ':' + e.message);
          return attempt(i + 1);
        });
    }
    return discover().then(function (list) {
      tryList = list;
      if (!tryList.length) {
        lastErr = '磁盘上没有任何 pack-*/index.json（先跑 build-lines.js + render-lines.py）';
        state = 'fallback';
        return state;
      }
      return attempt(0);
    });
  }

  function load(url) {
    if (cache[url]) return Promise.resolve(cache[url]);
    if (loading[url]) return loading[url];
    loading[url] = root.fetch(url, { cache: 'force-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(function (a) {
        return new Promise(function (res, rej) { ctx().decodeAudioData(a, res, rej); });
      })
      .then(function (b) { cache[url] = b; delete loading[url]; return b; })
      .catch(function (e) { delete loading[url]; throw e; });
    return loading[url];
  }

  /** 金额 → 音频 url。没有这一档就返回 null（调用方退回 speechSynthesis）。 */
  function urlFor(usd) {
    if (state !== 'ready' || !idx) return null;
    var k = Math.round(usd);
    var e = idx[k];
    return e ? BASE + e.file : null;
  }

  /** 预热：把某个金额的音频先解码好。播报前 30 秒调一次，避免第一次播卡一下。 */
  function preload(usd) {
    var u = urlFor(usd);
    return u ? load(u).then(function () { return true; }).catch(function () { return false; })
             : Promise.resolve(false);
  }

  /**
   * 播一条。返回 Promise<{ok, dur, why}>。
   *   ok=false 时调用方应当退回 speechSynthesis。
   * opt.gain   音量（0~1）
   * opt.onstart 真正出声的那一刻回调（用来做 duck）
   */
  function play(usd, opt) {
    opt = opt || {};
    var u = urlFor(usd);
    if (!u) return Promise.resolve({ ok: false, why: state === 'ready' ? 'no-clip' : state });
    var c = ctx();
    if (!c) return Promise.resolve({ ok: false, why: 'no-audiocontext' });
    return load(u).then(function (b) {
      var g = c.createGain();
      g.gain.value = (opt.gain == null) ? 1 : opt.gain;
      g.connect(opt.destination || c.destination);
      var s = c.createBufferSource();
      s.buffer = b;
      s.connect(g);
      var t = c.currentTime + 0.02;
      s.start(t);
      if (opt.onstart) opt.onstart(t, b.duration);
      return { ok: true, dur: b.duration };
    }).catch(function (e) {
      return { ok: false, why: e.message };
    });
  }

  var API = {
    init: init,
    useContext: useContext,
    play: play,
    preload: preload,
    urlFor: urlFor,
    setBase: function (b) { BASE = b; idx = null; state = 'idle'; },
    get base() { return BASE; },
    /** B 键用的大额阶梯 —— 必须是**预渲染过的**金额，否则手动大单会掉回 Huihui。 */
    get ladder() { return ladder.slice(); },
    get mode() { return state; },
    get error() { return lastErr; },
    get cached() { return Object.keys(cache).length; },
    info: null
  };
  root.APVoicePack = API;
})(typeof window !== 'undefined' ? window : globalThis);
