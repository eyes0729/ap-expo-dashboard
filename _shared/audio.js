/* ===========================================================================
 * AP 展会大屏 · 共享音效引擎  (window.APAudio)
 * ---------------------------------------------------------------------------
 * 全部用 Web Audio 实时合成，不用任何音频素材：
 *   零版权风险、零文件体积、可参数化做分层与连击音高。
 *
 * 声音设计依据（调研结论，改参数前先读）：
 *   · 「支付宝到账」的喜悦感主体不是音效，是人声报金额。所以必须是
 *     「提示音 + 人声」两段式，只做音效拿不到那个情绪。
 *   · 上行大三度 + 纯五度（C6-E6-G6）= 进展/肯定；音符间隔 90ms（琶音感），
 *     超过 150ms 就变成"旋律"，开始有老虎机的廉价味。
 *   · attack 3ms 是"叮"的关键；正弦基频 + 3.01 倍微失谐泛音 = 金属/钟感。
 *   · 禁用锯齿波、方波、pitch bend、颤音、硬币叮当采样 —— 这四项是廉价感来源。
 *   · 混响 wet ≤ 10%（展馆现场），过多会被环境噪声糊掉，反而更不清晰。
 *
 * 伦理红线：小额单不要放庆祝音（赌博研究里的 losses disguised as wins 会
 *   让人虚高记忆中的中奖率）。观众是商家，$3 的单不能听起来像 $300。
 *
 * 现场声学（展馆 75~85dB 背景）：
 *   · CES/LVCC 等展馆有 85dB 硬上限，10 英尺内测量，投诉可直接执法关摊。
 *     所以不靠音量、靠近场 + 音箱朝展位内侧下倾 30°。
 *   · setHallMode(true) 会切掉 100Hz 以下（展馆低频全是噪声，白耗功率还顶满 dB 计）
 *     并在 2~4kHz 补 +2.5dB（人声穿透频段）。笔记本预览时保持 false 才听得到低频。
 *
 * 用法：
 *   <script src="../_shared/audio.js"></script>
 *   APAudio.unlock();                  // 必须在一次用户手势里调（点击/按键）
 *   APAudio.playOrder(orderEvent);     // 自动分层 + 决定是否人声播报
 *   APAudio.playMilestone();
 *   APAudio.setMuted(true/false);
 *
 * 注意：classic script，不要改成 ES module（file:// 下会被 CORS 拦死）
 * =========================================================================== */
(function (root) {
  'use strict';

  var ctx = null, master, limiter, sfxBus, musicBus, verb, verbSend, hallHP, hallEQ;
  var ready = false, muted = false;
  var ambientNodes = null;

  /* --- 防叠加参数（订单密集时不炸耳）------------------------------------- */
  var MIN_GAP_S = 0.12;      // 两次发声最小间隔
  var MAX_VOICES = 4;        // 同时发声上限
  var QUEUE_MAX = 6;         // 小单排队上限，满了直接丢（绝不补播完）
  var lastAt = 0, active = 0, queue = [];
  var comboCount = 0, comboAt = 0;

  /* --- 人声播报 ---------------------------------------------------------- */
  var voiceLang = 'zh-CN';
  var voiceAvailable = false;
  var fallbackVoice = null;
  var fallbackVoiceNames = null;
  var systemVoiceOnly = false;
  var voiceQueueLen = 0;
  var VOICE_QUEUE_MAX = 2;   // 播报队列上限：超了丢弃旧的，
                             // 否则订单一密集，语音会滞后画面好几分钟
  var VOICE_RATE = 1.06;

  var TIER_RANK = { common: 0, rare: 1, epic: 2, legendary: 3 };

  /* =====================================================================
   * 一、初始化与解锁
   * ===================================================================== */
  function build() {
    if (ctx) return;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });

    master = ctx.createGain();  master.gain.value = 0.9;

    // 总线砖墙限幅：现场订单齐发时防削波爆音
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;

    // 展馆模式链路（默认旁通）
    hallHP = ctx.createBiquadFilter();
    hallHP.type = 'highpass';
    hallHP.frequency.value = 10;          // 默认几乎不动
    hallEQ = ctx.createBiquadFilter();
    hallEQ.type = 'peaking';
    hallEQ.frequency.value = 3000;
    hallEQ.Q.value = 0.8;
    hallEQ.gain.value = 0;

    master.connect(hallHP).connect(hallEQ).connect(limiter).connect(ctx.destination);

    sfxBus = ctx.createGain();   sfxBus.gain.value = 1.0;   sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.0; musicBus.connect(master);

    // 合成 IR 做混响，不用素材
    verb = ctx.createConvolver();
    verb.buffer = makeIR(1.1, 3.5);
    verbSend = ctx.createGain(); verbSend.gain.value = 0.10;
    verbSend.connect(verb).connect(master);

    ready = true;
    detectVoice();
  }

  function makeIR(sec, decay) {
    var n = Math.floor(ctx.sampleRate * sec);
    var b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = b.getChannelData(c);
      for (var i = 0; i < n; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
      }
    }
    return b;
  }

  /** 必须在一次真实用户手势里调用。kiosk 无人现场则靠启动参数：
   *  --autoplay-policy=no-user-gesture-required
   *  另外每 5 秒有个 watchdog 兜底 resume（省电/后台会被 suspend）。 */
  function unlock() {
    build();
    if (!ctx) return false;
    if (ctx.state !== 'running') ctx.resume();
    // 播一个 1 sample 的静音 buffer，某些平台靠这个才真正解锁
    try {
      var b = ctx.createBuffer(1, 1, ctx.sampleRate);
      var s = ctx.createBufferSource(); s.buffer = b;
      s.connect(ctx.destination); s.start(0);
    } catch (e) {}
    /* 顺手把整句播报包的清单读进来。放在 unlock 里是因为这时候一定已经有
     * 用户手势了，而且离第一条播报还有几十秒，足够把清单和头几条音频拉好。
     * 失败也没关系 —— APVoicePack 会把 mode 设成 'fallback'，speak() 自己会退。 */
    if (root.APVoicePack) {
      /* **必须共用同一个 AudioContext。** 不共用的话，整句音频的 BufferSource
       * 连不上这里的 master（跨 context 连接直接抛），每条播报都会静默退回
       * speechSynthesis —— 全场都在放 Huihui 而屏上看不出来。 */
      root.APVoicePack.useContext(ctx);
    }
    if (root.APVoicePack && root.APVoicePack.mode === 'idle') {
      root.APVoicePack.init().then(function (m) {
        if (root.console) {
          root.console.log('[播报] 整句包 ' + m
            + (m === 'ready'
                ? '（' + root.APVoicePack.info.count + ' 句 · '
                  + root.APVoicePack.info.voice + '）'
                : '：' + (root.APVoicePack.error || '') + ' → 退回 speechSynthesis'));
        }
      });
    }
    return ctx.state === 'running';
  }

  setInterval(function () {
    if (ctx && ctx.state === 'suspended' && !muted) ctx.resume();
  }, 5000);

  function detectVoice() {
    if (!root.speechSynthesis) { voiceAvailable = false; fallbackVoice = null; return; }
    var vs = root.speechSynthesis.getVoices() || [];
    var lang = voiceLang.slice(0, 2).toLowerCase(), matches = [], i, j, name;
    for (i = 0; i < vs.length; i++) {
      if (vs[i].lang && vs[i].lang.replace('_', '-').toLowerCase().indexOf(lang) === 0) {
        matches.push(vs[i]);
      }
    }
    fallbackVoice = null;
    if (fallbackVoiceNames && fallbackVoiceNames.length) {
      for (i = 0; i < fallbackVoiceNames.length && !fallbackVoice; i++) {
        name = String(fallbackVoiceNames[i]).toLowerCase();
        for (j = 0; j < matches.length; j++) {
          if (String(matches[j].name || '').toLowerCase().indexOf(name) >= 0) {
            fallbackVoice = matches[j]; break;
          }
        }
      }
    } else {
      fallbackVoice = matches[0] || null;
    }
    voiceAvailable = !!fallbackVoice;
  }
  if (root.speechSynthesis) {
    root.speechSynthesis.onvoiceschanged = detectVoice;
  }

  /* =====================================================================
   * 二、音色原语
   * ===================================================================== */

  /** 钟/glockenspiel 声：正弦基频 + 3.01 倍微失谐泛音 */
  function bell(f, when, dur, amp) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(amp, when + 0.003);          // attack 3ms
    g.gain.exponentialRampToValueAtTime(amp * 0.3, when + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);

    var o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = f;
    var o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 3.01;
    var g2 = ctx.createGain(); g2.gain.value = 0.18;

    o1.connect(g); o2.connect(g2); g2.connect(g);
    g.connect(sfxBus); g.connect(verbSend);
    o1.start(when); o2.start(when);
    o1.stop(when + dur + 0.02); o2.stop(when + dur + 0.02);
  }

  /** 木质 pluck：小单用，轻、短、不喧哗 */
  function pluck(f, when, dur, amp) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(amp, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    var o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * 6, when);
    lp.frequency.exponentialRampToValueAtTime(Math.max(200, f * 1.5), when + dur);
    o.connect(lp); lp.connect(g); g.connect(sfxBus); g.connect(verbSend);
    o.start(when); o.stop(when + dur + 0.02);
  }

  /** 低频冲击：只给大单，90->45Hz，<150ms（展馆里持续低频是灾难） */
  function impact(when, amp) {
    var o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, when);
    o.frequency.exponentialRampToValueAtTime(45, when + 0.12);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(amp, when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.30);
    o.connect(g); g.connect(sfxBus);
    o.start(when); o.stop(when + 0.32);
  }

  /** 高频尾音：噪声过带通，制造"闪光"余韵 */
  function shimmer(when, dur, amp) {
    var n = Math.floor(ctx.sampleRate * dur);
    var b = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    var s = ctx.createBufferSource(); s.buffer = b;
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 5000; bp.Q.value = 1.2;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(amp, when + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    s.connect(bp); bp.connect(g); g.connect(sfxBus); g.connect(verbSend);
    s.start(when); s.stop(when + dur);
  }

  /** 上升铺垫：只给传奇级大单和里程碑，制造"预期"。
   *
   *  ⚠ 调用方是 `riser(t - 0.45, 0.45, …)` —— **起点在音符之前**。
   *  如果 AudioContext 刚建好（currentTime 还小于 0.45），`when` 就是负数，
   *  `setValueAtTime` 直接抛 RangeError，整个 playOrder 中断：
   *  那一笔订单**没有任何声音**，而且屏上看不出来。
   *
   *  以前不容易碰到，是因为演示键的金额是区间随机、只有一部分落在 legendary；
   *  改成阶梯之后 B / V 键必然是 legendary，于是"开屏立刻按 B"就会稳定触发。
   *  这里把起点夹到 currentTime，并把时长相应缩短 —— 结束时刻不变，
   *  所以铺垫和音符的对齐关系保持原样，只是开头被截掉一点。 */
  function riser(when, dur, amp) {
    var now = ctx.currentTime;
    if (when < now) {
      dur = Math.max(0.05, dur - (now - when));
      when = now;
    }
    var o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, when);
    o.frequency.exponentialRampToValueAtTime(1400, when + dur);
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6;
    bp.frequency.setValueAtTime(300, when);
    bp.frequency.exponentialRampToValueAtTime(2600, when + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(amp, when + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(bp); bp.connect(g); g.connect(sfxBus);
    o.start(when); o.stop(when + dur + 0.02);
  }

  /* =====================================================================
   * 三、分层：tier -> 声音
   * ---------------------------------------------------------------------
   *  common    < $110   单音 pluck，350ms          （不做庆祝音，见伦理红线）
   *  rare      ≥ $110   C6-E6-G6 钟琶音，900ms
   *  epic      ≥ $300   + 低频 impact + C7 八度 + shimmer 尾音，2.2s
   *  legendary ≥ $792   + riser 铺垫，最长最重
   *  连击        每次连击基频 +2 半音，上限 +6 后归零
   * ===================================================================== */
  function playTier(tier, semis) {
    var t = ctx.currentTime + 0.03;                 // 预留 30ms 调度余量
    var r = Math.pow(2, (semis || 0) / 12);
    var C6 = 1046.5 * r, E6 = 1318.5 * r, G6 = 1568 * r, C7 = 2093 * r;

    if (tier === 'common') { pluck(C6, t, 0.35, 0.20); return 0.35; }

    if (tier === 'legendary') riser(t - 0.45, 0.45, 0.10);

    bell(C6, t, 0.55, 0.26);
    bell(E6, t + 0.09, 0.60, 0.24);
    bell(G6, t + 0.18, 0.90, 0.28);

    if (tier === 'epic' || tier === 'legendary') {
      impact(t - 0.02, 0.50);
      bell(C7, t + 0.27, 1.60, 0.20);
      shimmer(t + 0.30, 1.80, 0.055);
      return 2.2;
    }
    return 0.9;
  }

  /** 里程碑：突破整十万页 / 百万抓取 / 百单 时的全屏庆祝配音 */
  function playMilestone() {
    if (!ready || muted) return;
    var t = ctx.currentTime + 0.03;
    riser(t, 0.7, 0.13);
    impact(t + 0.70, 0.6);
    var seq = [1046.5, 1318.5, 1568, 2093];
    for (var i = 0; i < seq.length; i++) {
      bell(seq[i], t + 0.70 + i * 0.10, 1.2 + i * 0.3, 0.26 - i * 0.02);
    }
    shimmer(t + 0.80, 2.4, 0.06);
    duck(t + 0.70, 2.4);
  }

  /** UI 轻提示：切幕、数据刷新这类，音量很小 */
  function blip() {
    if (!ready || muted) return;
    pluck(1568, ctx.currentTime + 0.02, 0.12, 0.06);
  }

  /* 语音期间把音乐床压下去 */
  function duck(when, dur) {
    if (!musicBus) return;
    var g = musicBus.gain;
    var base = ambientNodes ? 0.10 : 0;
    g.cancelScheduledValues(when);
    g.setTargetAtTime(base * 0.25, when, 0.03);        // ~80ms 压下
    g.setTargetAtTime(base, when + dur, 0.15);         // ~450ms 释放
  }

  /* =====================================================================
   * 四、播报文案
   * ---------------------------------------------------------------------
   * 合规红线：一律叫「AI 引荐订单 / AI-referred order」。
   * 绝不说「GPT 订单」—— OpenAI 开发者条款禁止任何可能让人以为
   * 与 OpenAI 有合作/被其背书的表述"和设计选择"。
   * ===================================================================== */
  var CUR_CN = { USD:'美元', EUR:'欧元', GBP:'英镑', CAD:'加元', AUD:'澳元',
                 JPY:'日元', SEK:'瑞典克朗', KRW:'韩元', SGD:'新加坡元',
                 AED:'迪拉姆', BRL:'雷亚尔', MXN:'比索', PLN:'兹罗提', DKK:'丹麦克朗' };

  /* ── 播报口径：一律 USD，不念本地币种 ──────────────────────────────────────
   * 这里原来念的是 `order.amount` + `order.currency`，也就是**本地币种** ——
   * 一笔墨西哥订单会被念成「一万六千三百三十八 比索」。两个问题：
   *   ① 对中文观众没有任何尺度感，没人知道 16338 比索是多是少。
   *      README 复核记录第 2 条修的就是同一个坑的显示侧：本地币种让屏上
   *      `$16,338.80` 实际是比索（约 950 美元），把我们自己的数字夸大了 17 倍。
   *      念出来是一样的失真，只是更难被发现。
   *   ② 币种 × 金额的组合空间是 USD 的十几倍，而且 JPY/KRW 会出现
   *      「十九万三千」这种又长又拗口的读法 —— 整句预渲染就不可能了。
   * 所以统一念 USD。这也和已有的全部素材、以及选定的「…美元」句式一致。 */
  function voiceText(order) {
    var amt = Math.round(order.usd);
    if (voiceLang.slice(0, 2) === 'zh') {
      return 'Agentic Page 店铺到账，' + amt + ' 美元';
    }
    return 'Agentic Page store received ' + amt + ' US dollars';
  }

  /** 浏览器 TTS 兜底。**只在预渲染整句拿不到时才走这里** ——
   *  它念出来是什么完全取决于机器装了什么音色，展会机上就是 2013 年的
   *  Huihui 拼接式合成（也就是「太机械化」那个）。见 voice-pack.js 顶部。 */
  function speakFallback(order) {
    if (!root.speechSynthesis || !voiceAvailable || muted) return;
    // 队列上限：超了先清掉旧的，保证语音永远跟着画面而不是滞后
    if (voiceQueueLen >= VOICE_QUEUE_MAX) {
      try { root.speechSynthesis.cancel(); } catch (e) {}
      voiceQueueLen = 0;
    }
    var u = new root.SpeechSynthesisUtterance(voiceText(order));
    u.lang = voiceLang;
    u.rate = VOICE_RATE;
    u.pitch = 1.05;
    u.volume = 1.0;
    u.voice = fallbackVoice;
    voiceQueueLen++;
    u.onstart = function () { duck(ctx.currentTime, 2.4); };
    u.onend = function () { voiceQueueLen = Math.max(0, voiceQueueLen - 1); };
    u.onerror = function () { voiceQueueLen = Math.max(0, voiceQueueLen - 1); };
    try { root.speechSynthesis.speak(u); }
    catch (e) { voiceQueueLen = Math.max(0, voiceQueueLen - 1); }
  }

  /* ── 对外的播报入口 ────────────────────────────────────────────────────────
   * 优先播**预渲染的整句**（自然音色、时长可控、不依赖目标机器装了什么）；
   * 拿不到才退回 speechSynthesis，也就是退回今天的行为，绝不静默不出声。
   *
   * 退化必须**可观测**：voiceSource 会变成 'fallback'，屏上诊断和验收脚本
   * 都据此判断。现场最怕的不是退化，是「以为在放好音色，其实一直是 Huihui」。 */
  var voiceSource = 'unknown';
  function speak(order) {
    if (muted) return;
    if (systemVoiceOnly) {
      voiceSource = 'system:' + (fallbackVoice ? fallbackVoice.name : 'unavailable');
      speakFallback(order);
      return;
    }
    var VP = root.APVoicePack;
    if (VP && VP.mode === 'ready') {
      VP.play(Math.round(order.usd), {
        destination: master || undefined,
        onstart: function (t, dur) { duck(t, Math.min(dur + 0.3, 4.0)); }
      }).then(function (r) {
        if (r.ok) { voiceSource = 'pack'; return; }
        /* 这一档没渲出来 —— 报出来，别悄悄降级。缺哪一档要能回去补渲。 */
        voiceSource = 'fallback:' + (r.why || '?');
        if (root.console) root.console.warn('[播报] $' + Math.round(order.usd)
          + ' 没有预渲染整句（' + r.why + '），退回 speechSynthesis');
        speakFallback(order);
      });
      return;
    }
    voiceSource = 'fallback:' + (VP ? VP.mode : 'no-pack');
    speakFallback(order);
  }

  /* =====================================================================
   * 五、对外 API
   * ===================================================================== */
  var API = {
    /** 在一次用户手势里调。返回是否真的解锁成功。 */
    unlock: unlock,
    get ready() { return ready && ctx && ctx.state === 'running'; },
    get muted() { return muted; },
    get voiceAvailable() { return voiceAvailable; },
    get fallbackVoiceName() { return fallbackVoice ? fallbackVoice.name : ''; },
    get systemVoiceOnly() { return systemVoiceOnly; },
    /** 上一条播报是走预渲染整句还是退回了浏览器 TTS。
     *  'pack' = 好音色；'fallback:*' = 正在放 Huihui，现场要能看见这个。 */
    get voiceSource() { return voiceSource; },
    get voicePackMode() { return root.APVoicePack ? root.APVoicePack.mode : 'no-pack'; },
    get state() { return ctx ? ctx.state : 'uninitialised'; },

    setMuted: function (v) {
      muted = !!v;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.05);
      if (muted && root.speechSynthesis) { try { root.speechSynthesis.cancel(); } catch (e) {} }
      return muted;
    },
    toggleMute: function () { return API.setMuted(!muted); },
    setVolume: function (v) {
      if (master) master.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), ctx.currentTime, 0.05);
    },

    /** 展馆模式：切掉 100Hz 以下 + 2~4kHz 补 2.5dB（人声穿透）。
     *  笔记本预览请保持 false，否则听不到大单的低频冲击。 */
    setHallMode: function (on) {
      if (!ready) return;
      hallHP.frequency.setTargetAtTime(on ? 100 : 10, ctx.currentTime, 0.1);
      hallEQ.gain.setTargetAtTime(on ? 2.5 : 0, ctx.currentTime, 0.1);
    },

    setVoiceLang: function (lang) { voiceLang = lang || 'zh-CN'; detectVoice(); },
    setFallbackVoiceNames: function (names) {
      fallbackVoiceNames = names && names.length ? names.slice() : null;
      detectVoice();
      return API.fallbackVoiceName;
    },
    setSystemVoiceOnly: function (on) {
      systemVoiceOnly = !!on;
      return systemVoiceOnly;
    },
    setVoiceMinTier: function (t) { API.voiceMinTier = t; },
    voiceMinTier: 'rare',

    /** 环境音床：两个微失谐正弦 + 慢速滤波起伏。
     *  旗舰方案（B）建议开，能让整块屏"活着"；小屏方案可以不开。 */
    setAmbient: function (on) {
      if (!ready) return;
      if (on && !ambientNodes) {
        var o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 55;
        var o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 55 * 1.005;
        var o3 = ctx.createOscillator(); o3.type = 'sine'; o3.frequency.value = 110.3;
        var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; lp.Q.value = 0.6;
        var lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;   // 16 秒周期
        var lfoGain = ctx.createGain(); lfoGain.gain.value = 140;
        lfo.connect(lfoGain); lfoGain.connect(lp.frequency);
        o1.connect(lp); o2.connect(lp); o3.connect(lp);
        lp.connect(musicBus);
        o1.start(); o2.start(); o3.start(); lfo.start();
        ambientNodes = { o1: o1, o2: o2, o3: o3, lfo: lfo, lp: lp };
        musicBus.gain.setTargetAtTime(0.10, ctx.currentTime, 1.5);
      } else if (!on && ambientNodes) {
        musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
        var n = ambientNodes; ambientNodes = null;
        setTimeout(function () {
          try { n.o1.stop(); n.o2.stop(); n.o3.stop(); n.lfo.stop(); } catch (e) {}
        }, 1500);
      }
    },

    /**
     * 播一个订单。自动完成：分层 / 连击音高 / 防叠加 / 决定是否人声播报。
     * @param order  APEngine 产出的订单事件（需要 tier / store / amount / currency）
     * @returns {boolean} 是否真的发声（被节流丢弃时返回 false）
     */
    playOrder: function (order) {
      if (!ready || muted || !order) return false;
      var now = ctx.currentTime;
      var isBig = TIER_RANK[order.tier] >= TIER_RANK.epic;

      if (now - lastAt < MIN_GAP_S || active >= MAX_VOICES) {
        if (isBig) queue.unshift(order);                    // 大单抢占队首
        else if (queue.length < QUEUE_MAX) queue.push(order); // 小单囤满即丢
        return false;
      }

      // 连击：1.5 秒内连续到达则音高逐级 +2 半音，上限 +6
      comboCount = (now - comboAt < 1.5) ? Math.min(comboCount + 1, 3) : 0;
      comboAt = now;
      lastAt = now;
      active++;

      var dur = playTier(order.tier, comboCount * 2);
      if (TIER_RANK[order.tier] >= TIER_RANK[API.voiceMinTier]) speak(order);

      setTimeout(function () {
        active = Math.max(0, active - 1);
        if (queue.length) API.playOrder(queue.shift());
      }, Math.max(220, dur * 400));
      return true;
    },

    playMilestone: playMilestone,
    blip: blip,

    /** 开机自检：现场必测，确认音频链路真的通（HDMI 会把默认输出切到显示器） */
    selfTest: function () {
      if (!ready) return false;
      var t = ctx.currentTime + 0.05;
      bell(1046.5, t, 0.4, 0.2);
      bell(1568, t + 0.25, 0.6, 0.2);
      return true;
    }
  };

  root.APAudio = API;
})(typeof window !== 'undefined' ? window : globalThis);
