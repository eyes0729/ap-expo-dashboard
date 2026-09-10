/* ===========================================================================
 * AP 展会大屏 · 共享假数据引擎  (window.APEngine)
 * ---------------------------------------------------------------------------
 * 设计原则（四个方案必须共用这一份，否则数字会互相打架）：
 *
 *  1) 所有计数器 = 时间的纯函数。从固定开幕时刻 T0 积分到"当前虚拟时间"。
 *     断电重启后自动对上，永不倒退、永不归零。绝不用 localStorage 存计数器。
 *  2) 三个数字同源于一条漏斗：页面 -> 抓取 -> 引荐访问 -> 订单。
 *     懂行的商家心算也算不穿（见下方 CONFIG 的推导注释）。
 *  3) 增长不是匀速：日内双峰曲线 × 粉红噪声(1/f) 低频起伏。
 *  4) 订单事件用"时间槽 + 洗牌袋 + 宏节拍"生成，同样是纯函数：
 *     每 90 秒保底 1 单（不冷场），每 10 分钟一次 3~5 单齐发的大高潮（不靠运气）。
 *  5) 金额长尾：对数正态 + 顶端帕累托尾，保证大部分小单、偶尔一个惊人大单。
 *
 * 用法：
 *   <script src="../_shared/cities.js"></script>
 *   <script src="../_shared/engine.js"></script>
 *   APEngine.init();                       // 可选参数见 init
 *   function frame(){ APEngine.update();   // 每帧推进虚拟时钟
 *     var m = APEngine.metrics();          // 取三个数字
 *     APEngine.pollOrders().forEach(...);  // 取本帧到达的订单事件
 *     APEngine.pollCrawls(8).forEach(...); // 取本帧的爬虫日志（8 条/秒，仅展示用）
 *     APEngine.pollMilestones().forEach(...);
 *     requestAnimationFrame(frame); }
 *
 * 注意：classic script，不要改成 ES module（file:// 下会被 CORS 拦死）
 * =========================================================================== */
(function (root) {
  'use strict';

  /* =====================================================================
   * 一、配置与自洽推导（改这里就能整体调量级）
   * ---------------------------------------------------------------------
   * 推导链（每一层的比率都落在公开可查的合理区间内）：
   *   接入店铺 2,400 家 × 平均 320 SKU × 8 语种 = 6,144,000 个 AP 页面
   *   每页每天被 AI 爬虫抓 0.6 次（≈1.7 天全量抓一遍，AI-first 页 + sitemap 主动推送成立）
   *      -> 日抓取 3,686,400 次 ≈ 42.7 次/秒
   *   抓取 -> AI 引荐点击 1.2%（每 83 次抓取带来 1 次真人访问）
   *      -> 日引荐访问 44,237
   *   引荐访问 -> 下单 3.5%（高意图流量，普通电商 1.5~2% 的两倍，站得住）
   *      -> 日订单 ≈ 1,548 单，AOV $128（中位数 $78）
   *      -> 日 GMV ≈ $198,000
   *   事件生成器实测约 1,490 单/天，与上面漏斗一致（差 <5%）。
   *
   * 量级红线：PAGES0 不得超过公司对外最大公开口径 × 1.2，否则是自打嘴巴。
   *          上会前请产品确认一次这个数。
   * ===================================================================== */
  var CONFIG = {
    STORES: 2400,
    SKU_PER_STORE: 320,
    LANGS: 8,
    NEW_STORES_PER_DAY: 40,

    /* T0 时刻的三个存量基线。这三个数是"对外口径"，上会前必须让产品确认一遍。
     * 为什么必须有基线：如果计数器从 0 开始涨，展会第一天上午爬虫数只有十几万，
     * 比页面数还小 —— 跟"每页每天被抓 0.6 次"的故事直接矛盾，也毫无冲击力。
     * 基线的推导：AI 流量历史约 7 个月，期间平均页面存量约当前的 60%
     *   6,144,000 × 0.6（页） × 0.6（次/页/天） × 210 天 ≈ 4.6 亿，取 4.2 亿
     *   折算下来每店累计约 17.5 万次抓取 ≈ 每天 830 次 / 2,560 个页面 = 0.32 次/页/天，自洽 */
    PAGES0: 6144000,
    CRAWLS0: 420000000,
    ORDERS0: 296000,          // 7 个月 × 约 1,400 单/天
    /* GMV 基线必须跟 ORDERS0 同口径，否则 gmv/orders 算出来是 $0.30，一眼假。
     * = ORDERS0 × 实测均值 139。改 ORDERS0 时这个要一起改。 */
    GMV0: 41144000,

    CRAWL_PER_PAGE_PER_DAY: 0.6,
    CRAWL_TO_VISIT: 0.012,
    VISIT_TO_ORDER: 0.035,

    /* 金额分布。实测输出：中位数 ≈ $74，均值 ≈ $146。
     * 注意：均值高于对数正态的 $116，是因为每 10 分钟一次的"高潮单"把它抬上去了。
     * 别把帕累托尾调得太重 —— alpha=1.35 会让均值飙到 $320，
     * 对 DTC 品类来说一眼就假（这是第一版踩过的坑）。 */
    LOGN_MU: 4.30,            // e^4.30 = 73.7 中位数
    LOGN_SIGMA: 0.95,
    PARETO_XM: 700,           // 常规单里顶端 0.5% 走帕累托尾
    PARETO_ALPHA: 2.0,
    AMOUNT_CAP: 4500,         // 任何单不得超过这个数，防止屏上出现荒谬金额

    HIGHLIGHT_BASE: 240,      // 宏节拍"高潮单"的基准
    HIGHLIGHT_SIGMA: 0.5,
    HIGHLIGHT_CAP: 2200,

    SLOT_MS: 90000,           // 微节拍：每 90 秒保底 1 单
    MACRO_MS: 600000,         // 宏节拍：每 10 分钟一次齐发高潮
    EXTRA_BAG: [0,0,0,0,0,0,1,1],   // 洗牌袋：8 个槽内额外单数配额精确
    MACRO_EXTRA: [2,2,3,3],         // 宏节拍槽的额外单数

    /* 语音播报门槛。'rare' ≈ 每 2 分钟一次人声，'epic' ≈ 每 7 分钟一次。
     * 展馆有 85dB 上限且播报太密观众会屏蔽，别调到 'common'。 */
    VOICE_MIN_TIER: 'rare',

    /* ── 演示键（N / C / B / V）的金额阶梯，按档位分组，各自依次轮换 ──────────
     * 这是**人声预渲染清单的一部分** —— `_voice/build-lines.js` 直接读这里，
     * 改了就必须重跑渲染，否则按键时会掉回浏览器 TTS（Huihui）。
     *
     * 为什么必须是固定阶梯，不能是"区间内随机"：
     *   原来 E-后台 的四个键是 `usd: 320 + hash(n)*450` 这种区间随机。
     *   区间随机的金额几乎必然**不在预渲染集合里** —— 实测覆盖率
     *   C 键 91%、B 键 36%、**V 键只有 0.7%**。也就是说 BD 在台上按 V 键，
     *   99% 的概率当场蹦出一句 2013 年的 Huihui。
     *   而这四个键正是全场最重要的演示动作。
     *
     * 挑选标准：读起来干脆（少「零」）、量级递进、每档都严格落在
     * rarity() 的门槛内（common <110 / rare ≥110 / epic ≥300 / legendary ≥792）、
     * 都在 AMOUNT_CAP 以内。连按拿到的是递增的漂亮数字，讲故事的节奏是升的。 */
    DEMO_LADDERS: {
      common:    [28, 46, 65, 88, 97],                    /* <110，不触发播报 */
      rare:      [128, 165, 210, 258, 288],               /* 110~299 */
      epic:      [325, 430, 545, 680, 765],               /* 300~791 */
      legendary: [1280, 1860, 2460, 3180, 3880, 4260]     /* ≥792 */
    },

    /* 里程碑阈值。按实际速率反推，让庆祝大约每 10~15 分钟来一次：
     *   页面 +1.2/秒  -> 每 1,000 页 ≈ 14 分钟
     *   抓取 +40/秒   -> 每 10 万次 ≈ 42 分钟
     *   订单 +1.06/分 -> 每 25 单   ≈ 24 分钟
     * 合起来大约 8~10 分钟一次。研究结论是频率不能高于每 2 分钟一次，
     * 否则庆祝变常态、失去信号价值。 */
    /* 建议的呈现策略（各方案自己实现）：
     *   metric==='pages'  -> 只做进度条填满 + 轻微脉冲，**不要全屏接管**。
     *                        它每 14 分钟一次，是"一直有东西可看"的那个元素。
     *   metric==='orders' / 'crawls' -> 才做 3~5 秒全屏庆祝，合起来约 30 分钟一次，
     *                        足够稀有所以每次都是事件。演示时用 K 键手动触发。 */
    MILESTONE_PAGES: 1000,
    MILESTONE_CRAWLS: 250000,
    MILESTONE_ORDERS: 50
  };

  /* 开幕时刻：多天展会连续性的唯一锚点。硬编码，绝不读系统时间当起点。
   * 换展会/换天数只改这一行。夜间不冻结、降速到 15%，第二天开机数字
   * 比昨天关机涨了一点但没暴涨 —— 完全冻结才是立刻暴露是脚本。 */
  var T0 = Date.UTC(2026, 7, 18, 1, 0, 0);   // 2026-08-18 09:00 (UTC+8)
  var TZ_OFFSET_HOURS = 8;                    // 大屏机器时区锁死，不读系统

  /* =====================================================================
   * 二、确定性噪声（同一个 t 永远得到同一个值，重启后完全一致）
   * ===================================================================== */
  var SEED = 0x9e3779b9;

  function hash32(i, salt) {
    var h = (i ^ (salt || 0) ^ SEED) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;   // [0,1)
  }

  /** 1D value noise + smoothstep，低频起伏用 */
  function valueNoise(x, salt) {
    var i = Math.floor(x), f = x - i;
    var u = f * f * (3 - 2 * f);
    return hash32(i, salt) * (1 - u) + hash32(i + 1, salt) * u;
  }

  /** 1/f 粉红噪声：多个八度叠加，得到长短波混合的"自然"起伏 */
  function pinkNoise(x, salt, oct) {
    oct = oct || 4;
    var s = 0, amp = 1, norm = 0;
    for (var o = 0; o < oct; o++) {
      s += valueNoise(x * Math.pow(2, o), (salt || 0) + o * 977) * amp;
      norm += amp; amp *= 0.5;
    }
    return s / norm;    // 约 [0,1]，均值 0.5
  }

  /** Box-Muller 正态，确定性版本 */
  function gaussian(seed) {
    var u1 = Math.max(1e-9, hash32(seed, 5501)), u2 = hash32(seed, 6607);
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /** 按权重挑选（确定性） */
  function weightedPick(items, weightOf, seed) {
    var total = 0, i;
    for (i = 0; i < items.length; i++) total += weightOf(items[i]);
    var r = hash32(seed, 3313) * total;
    for (i = 0; i < items.length; i++) {
      r -= weightOf(items[i]);
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /* =====================================================================
   * 三、日内周期与强度函数 λ(t)
   * ---------------------------------------------------------------------
   * 三个数字用不同形状的日内曲线，这本身是可信度细节：
   *   页面增长 -> 跟商家作息（夜间掉到 15%）
   *   爬虫抓取 -> 全球爬虫 24h 在跑（波动只有 ±25%）
   *   订单     -> 跟消费者作息（波动 ±70%）
   * ===================================================================== */
  function localHour(ms, tz) {
    tz = (tz === undefined) ? TZ_OFFSET_HOURS : tz;
    return ((ms / 3600000 + tz) % 24 + 24) % 24;
  }

  /** 双峰：上午 11 点、下午 16:30 两个高峰，凌晨 4 点谷底 */
  function diurnal(h, amp, night) {
    var base = 0.55
      + 0.30 * Math.exp(-Math.pow(h - 11, 2) / 8)
      + 0.38 * Math.exp(-Math.pow(h - 16.5, 2) / 10)
      - 0.35 * Math.exp(-Math.pow(h - 4, 2) / 12);
    return Math.max(night, 1 + amp * (base - 0.75));
  }

  function lambdaPages(ms) {
    var perDay = CONFIG.NEW_STORES_PER_DAY * CONFIG.SKU_PER_STORE * CONFIG.LANGS;
    var noise = 0.75 + 0.5 * pinkNoise(ms / 900000, 11);      // 15 分钟尺度起伏
    return (perDay / 86400) * diurnal(localHour(ms), 1.1, 0.15) * noise;
  }

  function lambdaCrawls(ms) {
    // 抓取量随页面存量增长（跨天才看得出），乘一条波动很小的全球曲线
    var pages = CONFIG.PAGES0 + (ms - T0) / 86400000 *
                CONFIG.NEW_STORES_PER_DAY * CONFIG.SKU_PER_STORE * CONFIG.LANGS;
    var noise = 0.85 + 0.3 * pinkNoise(ms / 600000, 23);
    return (pages * CONFIG.CRAWL_PER_PAGE_PER_DAY / 86400)
           * diurnal(localHour(ms, 0), 0.35, 0.7) * noise;
  }

  /* 分钟级前缀和 + 秒内线性插值，带缓存。
   * 冷启动跑 10 天 = 14,400 次迭代，<3ms。 */
  var MIN = 60000;
  function makeIntegrator(lambda) {
    var cacheMin = -1, cacheVal = 0;
    return function (tNow) {
      var m0 = Math.floor(T0 / MIN), mNow = Math.floor(tNow / MIN);
      if (mNow < m0) return 0;
      if (cacheMin > mNow) { cacheMin = -1; cacheVal = 0; }   // 时钟被 NTP 回调
      var m = cacheMin < 0 ? m0 : cacheMin;
      var acc = cacheMin < 0 ? 0 : cacheVal;
      for (; m < mNow; m++) acc += lambda(m * MIN + 30000) * 60;   // 中点法
      cacheMin = mNow; cacheVal = acc;
      return acc + lambda(mNow * MIN + 30000) * ((tNow % MIN) / 1000);
    };
  }
  var intPages = makeIntegrator(lambdaPages);
  var intCrawls = makeIntegrator(lambdaCrawls);

  /* =====================================================================
   * 四、店铺 / 商品 / 平台：全部由整数种子确定性生成
   * ===================================================================== */

  /* 虚构 DTC 品牌名，四类词法各占 1/4，避免全是一个味。
   * 已避开真实知名 DTC 品牌（Allbirds / Glossier / Oura / Ritual / Casper …）。
   * 上会前请再过一遍碰撞检查。 */
  var NAME_A1 = ['Lumo','Verily','Kindred','Aster','Novi','Sable','Wren','Cedarly',
                 'Onyxa','Solace','Vela','Kismet','Halden','Orla','Bramen','Torva'];
  var NAME_A2 = ['', ' Studio', ' Goods'];
  var NAME_B1 = ['Bear','Salt','North','Paper','Iron','Ember','River','Stone',
                 'Meadow','Harbor','Pine','Copper','Alder','Basin','Cove','Dune'];
  var NAME_B2 = ['& Bell','Grove','Loop','Crane','Fox','Field','Lane','Post',
                 'Row','Yard','Mill','Trail','Wharf','Ridge'];
  var NAME_C1 = ['Marlowe','Ashby','Hart','Whitfield','Calloway','Ellery',
                 'Fenwick','Bramble','Thorne','Loxley','Rennick','Vandermeer'];
  var NAME_C2 = ['Home','Supply','& Co.','Goods','Works','Provisions','Trading','& Daughters'];
  var NAME_D1 = ['Quiet','Slow','Honest','Plain','Bright','Wilder','Humble',
                 'Coastal','Lesser','Golden','Patient','Northerly'];
  var NAME_D2 = ['Goods','Lab','Studio','Co.','Collective','Atelier','Supply','Standard'];

  /* 名字空间必须是「单射」的，而且店名一旦确定，国家/货币/城市也必须跟着确定。
   * 踩过的坑：原实现用 hash 各自独立取名字和市场，300 个可能的名字覆盖 2,400 个
   * store id，于是屏上同时出现「Loxley Goods · Barcelona · ES」和
   * 「Loxley Goods · San Diego · US」—— 同名不同国，一眼看出是假的。
   * 现在用混合基数把 id 映射到唯一的 (family, i, j)，并且名字与市场、城市
   * 全部由同一个 nid 派生，撞名就是「同一家店」，天然自洽。 */
  var NS_A = NAME_A1.length * NAME_A2.length;   /* 48  */
  var NS_B = NAME_B1.length * NAME_B2.length;   /* 224 */
  var NS_C = NAME_C1.length * NAME_C2.length;   /* 96  */
  var NS_D = NAME_D1.length * NAME_D2.length;   /* 96  */
  var NAME_SPACE = NS_A + NS_B + NS_C + NS_D;   /* 464 个互不相同的店铺身份 */

  function storeName(nid) {
    var k = nid;
    if (k < NS_A) {
      return NAME_A1[k % NAME_A1.length] +
             NAME_A2[Math.floor(k / NAME_A1.length) % NAME_A2.length];
    }
    k -= NS_A;
    if (k < NS_B) {
      return NAME_B1[k % NAME_B1.length] + ' ' +
             NAME_B2[Math.floor(k / NAME_B1.length) % NAME_B2.length];
    }
    k -= NS_B;
    if (k < NS_C) {
      return NAME_C1[k % NAME_C1.length] + ' ' +
             NAME_C2[Math.floor(k / NAME_C1.length) % NAME_C2.length];
    }
    k -= NS_C;
    return NAME_D1[k % NAME_D1.length] + ' ' +
           NAME_D2[Math.floor(k / NAME_D1.length) % NAME_D2.length];
  }

  function slugify(s) {
    return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
  }

  /* 商品名：形容词 + 材质 + 品类，按语种切换。
   * 绝不让英文商品名出现在德国站 —— 这是最容易被商家一眼看穿的破绽。 */
  var PRODUCT_WORDS = {
    en: [['Merino','Organic','Brushed','Heavyweight','Waxed','Linen'],
         ['Cotton','Wool','Canvas','Leather','Ceramic','Oak'],
         ['Crew Neck','Tote','Chore Jacket','Mug','Duvet Cover','Desk Lamp']],
    de: [['Merino','Bio','Gebuerstet','Schwer','Gewachst','Leinen'],
         ['Baumwoll','Woll','Canvas','Leder','Keramik','Eichen'],
         ['Pullover','Tasche','Jacke','Becher','Bettdecke','Tischlampe']],
    fr: [['Merinos','Bio','Brosse','Epais','Cire','Lin'],
         ['Coton','Laine','Toile','Cuir','Ceramique','Chene'],
         ['Pull','Sac','Veste','Mug','Housse','Lampe']],
    es: [['Merino','Organico','Cepillado','Grueso','Encerado','Lino'],
         ['Algodon','Lana','Lona','Cuero','Ceramica','Roble'],
         ['Jersey','Bolso','Chaqueta','Taza','Funda','Lampara']],
    ja: [['メリノ','オーガニック','起毛','厚手','ワックス','リネン'],
         ['コットン','ウール','キャンバス','レザー','セラミック','オーク'],
         ['クルーネック','トートバッグ','ジャケット','マグ','布団カバー','デスクランプ']],
    nl: [['Merino','Biologisch','Geborsteld','Zwaar','Gewaxt','Linnen'],
         ['Katoen','Wol','Canvas','Leer','Keramiek','Eiken'],
         ['Trui','Tas','Jas','Mok','Dekbedhoes','Bureaulamp']]
  };

  function productName(seed, lang) {
    var w = PRODUCT_WORDS[lang] || PRODUCT_WORDS.en;
    var a = w[0][Math.floor(hash32(seed, 601) * w[0].length)];
    var b = w[1][Math.floor(hash32(seed, 607) * w[1].length)];
    var c = w[2][Math.floor(hash32(seed, 613) * w[2].length)];
    var joiner = (lang === 'ja') ? '' : ' ';
    return a + joiner + b + joiner + c;
  }

  var PAGE_TYPES = [
    { t: 'product',    w: 62, path: '/products/' },
    { t: 'collection', w: 20, path: '/collections/' },
    { t: 'blog',       w: 12, path: '/blogs/journal/' },
    { t: 'page',       w: 6,  path: '/pages/' }
  ];

  /* 真实 botName -> 平台归并。与线上 store-traffic 口径一致
   * （docs/specs/2026-06-24-store-traffic-design.md §5.2）。
   * 屏上写真实 UA 名是"科技感"最便宜也最有效的来源。 */
  var BOTS = [
    { name: 'GPTBot',               platform: 'ChatGPT',    w: 26 },
    { name: 'OAI-SearchBot',        platform: 'ChatGPT',    w: 12 },
    { name: 'ChatGPT-User',         platform: 'ChatGPT',    w: 8  },
    { name: 'ClaudeBot',            platform: 'Claude',     w: 9  },
    { name: 'anthropic-ai',         platform: 'Claude',     w: 3  },
    { name: 'claude-web',           platform: 'Claude',     w: 2  },
    { name: 'Google-Extended',      platform: 'Google',     w: 12 },
    { name: 'GoogleOther',          platform: 'Google',     w: 6  },
    { name: 'GoogleAgent-Mariner',  platform: 'Google',     w: 4  },
    { name: 'PerplexityBot',        platform: 'Perplexity', w: 9  },
    { name: 'Perplexity-User',      platform: 'Perplexity', w: 3  },
    { name: 'Bytespider',           platform: 'Others',     w: 3  },
    { name: 'Amazonbot',            platform: 'Others',     w: 2  },
    { name: 'YouBot',               platform: 'Others',     w: 1  }
  ];

  var PLATFORM_ORDER = ['ChatGPT', 'Claude', 'Google', 'Perplexity', 'Others'];

  /* 订单归因来源。与线上归因口径一致：REFERRAL + ReferrerUrl。
   * 注意文案：一律叫「AI 引荐订单 / AI-referred order」，
   * 绝不叫「GPT 订单」—— OpenAI 条款禁止暗示合作或背书关系。 */
  var REFERRERS = [
    { host: 'chatgpt.com',          platform: 'ChatGPT',    w: 46 },
    { host: 'perplexity.ai',        platform: 'Perplexity', w: 18 },
    { host: 'claude.ai',            platform: 'Claude',     w: 14 },
    { host: 'gemini.google.com',    platform: 'Google',     w: 14 },
    { host: 'copilot.microsoft.com',platform: 'Others',     w: 8  }
  ];

  function makeStore(id) {
    /* 折叠到名字空间：同名必然同店（同国家、同货币、同城市）。
     * 屏上能出现 464 个互不相同的店铺身份，一天只播约 1,500 单、
     * 观众实际看到几十单，够用；同一家店重复出单本身也是真实的。 */
    var nid = ((Math.floor(id) % NAME_SPACE) + NAME_SPACE) % NAME_SPACE;
    var name = storeName(nid);
    var market = weightedPick(APGeo.MARKETS, function (m) { return m.weight; }, nid * 7 + 1);
    var pool = APGeo.citiesByCC[market.cc] || APGeo.CITIES;
    var city = pool[Math.floor(hash32(nid, 719) * pool.length)];
    return {
      id: nid,
      name: name,
      domain: slugify(name) + '-demo.myshopify.com',
      cc: market.cc,
      locale: market.locale,
      currency: market.currency,
      lang: market.lang,
      city: city[0],
      lat: city[1],
      lon: city[2]
    };
  }

  /* =====================================================================
   * 五、金额分布与稀有度
   * ===================================================================== */
  function sampleAmount(seed, forceBig) {
    var v;
    if (forceBig) {
      // 宏节拍高潮单：半正态放大，中位数 ≈ $310，偶尔上到四位数，但有硬顶
      v = CONFIG.HIGHLIGHT_BASE *
          Math.exp(CONFIG.HIGHLIGHT_SIGMA * Math.abs(gaussian(seed)));
      return Math.round(Math.min(v, CONFIG.HIGHLIGHT_CAP) * 100) / 100;
    }
    if (hash32(seed, 8803) > 0.995) {
      // 常规单的顶端 0.5%：帕累托尾，制造"偶尔一个惊人大单"
      var u = hash32(seed, 9109) * 0.97;
      v = CONFIG.PARETO_XM / Math.pow(1 - u, 1 / CONFIG.PARETO_ALPHA);
      return Math.round(Math.min(v, CONFIG.AMOUNT_CAP));
    }
    v = Math.exp(CONFIG.LOGN_MU + CONFIG.LOGN_SIGMA * gaussian(seed));
    return Math.round(Math.min(v, CONFIG.AMOUNT_CAP) * 100) / 100;
  }

  /* 按分位数定义稀有度，换币种/换 AOV 不用重调阈值。
   * 实测占比：common 64% / rare 28% / epic 8% / legendary 1% */
  var TIER_RANK = { common: 0, rare: 1, epic: 2, legendary: 3 };
  function rarity(usd) {
    if (usd >= 792) return 'legendary';
    if (usd >= 300) return 'epic';
    if (usd >= 110) return 'rare';
    return 'common';
  }

  /* =====================================================================
   * 六、订单事件：时间槽 + 洗牌袋 + 宏节拍（纯函数，重启不重播不丢失）
   * ===================================================================== */

  /** 确定性 Fisher-Yates 洗牌袋：一袋 N 个结果，保证 N 次内配额精确 */
  function bagPick(bag, slot) {
    var n = bag.length, epoch = Math.floor(slot / n), k = ((slot % n) + n) % n;
    var idx = [], i, j, tmp;
    for (i = 0; i < n; i++) idx.push(i);
    for (i = n - 1; i > 0; i--) {
      j = Math.floor(hash32(epoch * 131 + i, 7717) * (i + 1));
      tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
    }
    return bag[idx[k]];
  }

  function slotOf(t) { return Math.floor((t - T0) / CONFIG.SLOT_MS); }

  function isMacroSlot(slot) {
    var a = Math.floor((slot * CONFIG.SLOT_MS) / CONFIG.MACRO_MS);
    var b = Math.floor(((slot + 1) * CONFIG.SLOT_MS) / CONFIG.MACRO_MS);
    return b > a;
  }

  /** 生成某个时间槽内的全部订单事件。纯函数：同一 slot 永远同一结果。 */
  function ordersInSlot(slot) {
    if (slot < 0) return [];
    var macro = isMacroSlot(slot);
    var extra = macro
      ? CONFIG.MACRO_EXTRA[Math.floor(hash32(slot, 31) * CONFIG.MACRO_EXTRA.length)]
      : bagPick(CONFIG.EXTRA_BAG, slot);
    var n = 1 + extra, out = [], i;
    for (i = 0; i < n; i++) {
      var seed = slot * 97 + i;
      var u = hash32(seed, 4241);
      // 保底那单落在槽的 20%~70%，把最大空窗压到 ~135 秒；
      // 宏节拍的额外单挤在槽后半段，形成"齐发"的听感与视感
      var frac = (i === 0) ? (0.20 + 0.50 * u)
                : macro    ? (0.55 + 0.40 * u)
                :            (0.05 + 0.90 * u);
      var forceBig = macro && i === 0;
      var usd = sampleAmount(seed, forceBig);
      var store = makeStore(Math.floor(hash32(seed, 1013) * CONFIG.STORES));
      var ref = weightedPick(REFERRERS, function (r) { return r.w; }, seed * 3 + 5);
      var buyerPool = APGeo.citiesByCC[store.cc] || APGeo.CITIES;
      var buyer = buyerPool[Math.floor(hash32(seed, 1117) * buyerPool.length)];
      out.push({
        kind: 'order',
        id: slot + '-' + i,
        t: T0 + slot * CONFIG.SLOT_MS + frac * CONFIG.SLOT_MS,
        usd: usd,
        amount: convert(usd, store.currency),
        currency: store.currency,
        locale: store.locale,
        tier: rarity(usd),
        isMacro: forceBig,
        store: store,
        product: productName(seed, store.lang),
        referrer: ref.host,
        platform: ref.platform,
        buyerCity: buyer[0],
        buyerLat: buyer[1],
        buyerLon: buyer[2]
      });
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  /* 极简汇率（只为让金额看起来本地化，不必精确） */
  var FX = { USD:1, EUR:0.92, GBP:0.79, CAD:1.36, AUD:1.52, JPY:151, SEK:10.5,
             KRW:1340, SGD:1.34, AED:3.67, BRL:5.1, MXN:17.2, PLN:3.95, DKK:6.85 };
  function convert(usd, cur) {
    var v = usd * (FX[cur] || 1);
    return (cur === 'JPY' || cur === 'KRW') ? Math.round(v) : Math.round(v * 100) / 100;
  }

  /** 累计订单数/GMV：直接对时间槽求和，与屏上播报的事件严格一致 */
  var ordAggCache = { slot: -1, count: 0, gmv: 0 };
  function ordersAggregate(tNow) {
    var sNow = slotOf(tNow);
    if (sNow < 0) return { count: 0, gmv: 0 };
    if (ordAggCache.slot > sNow) { ordAggCache = { slot: -1, count: 0, gmv: 0 }; }
    var s = ordAggCache.slot < 0 ? 0 : ordAggCache.slot + 1;
    var count = ordAggCache.slot < 0 ? 0 : ordAggCache.count;
    var gmv = ordAggCache.slot < 0 ? 0 : ordAggCache.gmv;
    for (; s < sNow; s++) {
      var arr = ordersInSlot(s);
      count += arr.length;
      for (var i = 0; i < arr.length; i++) gmv += arr[i].usd;
    }
    ordAggCache = { slot: sNow - 1, count: count, gmv: gmv };
    // 当前槽只算已经到达的
    var cur = ordersInSlot(sNow);
    for (var j = 0; j < cur.length; j++) {
      if (cur[j].t <= tNow) { count++; gmv += cur[j].usd; }
    }
    return { count: count, gmv: gmv };
  }

  /* =====================================================================
   * 七、虚拟时钟（暂停/倍速只影响事件层与渲染，reload 后回到墙上时间真值）
   * ===================================================================== */
  var _virtual = Date.now();
  var _lastReal = Date.now();
  var _dtMs = 16;               // 本帧真实耗时（已钳制），pollCrawls 要用
  var _speed = 1;
  var _paused = false;

  /* 平均每分钟订单数：从 CONFIG 推导，不要写死。
   * = (保底 1 + 洗牌袋均值 + 宏节拍加成) / 槽长 */
  function avgOrdersPerMin() {
    var bagAvg = 0, i;
    for (i = 0; i < CONFIG.EXTRA_BAG.length; i++) bagAvg += CONFIG.EXTRA_BAG[i];
    bagAvg /= CONFIG.EXTRA_BAG.length;
    var macroAvg = 0;
    for (i = 0; i < CONFIG.MACRO_EXTRA.length; i++) macroAvg += CONFIG.MACRO_EXTRA[i];
    macroAvg /= CONFIG.MACRO_EXTRA.length;
    var macroShare = CONFIG.SLOT_MS / CONFIG.MACRO_MS;
    var perSlot = 1 + bagAvg + macroShare * (macroAvg - bagAvg);
    return perSlot * 60000 / CONFIG.SLOT_MS;
  }

  /* =====================================================================
   * 八、事件游标
   * ===================================================================== */
  var _orderCursor = null;      // 已发出订单的虚拟时间水位
  var _manualQueue = [];        // 人工触发的大单
  var _manualCount = 0;         // 人工触发的单也要计入累计，否则按 B 键时
  var _manualGmv = 0;           // 数字不动，细看会露
  var _crawlAcc = 0;            // 爬虫展示事件的小数累积
  var _crawlSeq = 0;
  var _msSeen = null;           // 里程碑水位

  function initCursors() {
    _orderCursor = _virtual;
    var m = rawMetrics(_virtual);
    _msSeen = {
      pages: Math.floor(m.pages / CONFIG.MILESTONE_PAGES),
      crawls: Math.floor(m.crawls / CONFIG.MILESTONE_CRAWLS),
      orders: Math.floor(m.orders / CONFIG.MILESTONE_ORDERS)
    };
  }

  function rawMetrics(t) {
    var pages = CONFIG.PAGES0 + intPages(t);
    var crawls = CONFIG.CRAWLS0 + intCrawls(t);
    var agg = ordersAggregate(t);
    return { pages: pages, crawls: crawls,
             orders: CONFIG.ORDERS0 + agg.count + _manualCount,
             gmv: CONFIG.GMV0 + agg.gmv + _manualGmv,
             /* 本场（自 T0 起）的新增量，做"今日战绩"这类呈现时用 */
             sessionPages: intPages(t),
             sessionCrawls: intCrawls(t),
             sessionOrders: agg.count + _manualCount,
             sessionGmv: agg.gmv + _manualGmv };
  }

  /* =====================================================================
   * 九、对外 API
   * ===================================================================== */
  var API = {
    CONFIG: CONFIG,
    BOTS: BOTS,
    PLATFORM_ORDER: PLATFORM_ORDER,
    REFERRERS: REFERRERS,
    PAGE_TYPES: PAGE_TYPES,
    TIER_RANK: TIER_RANK,

    init: function (opts) {
      opts = opts || {};
      if (opts.t0 !== undefined) T0 = opts.t0;
      if (opts.tzOffsetHours !== undefined) TZ_OFFSET_HOURS = opts.tzOffsetHours;
      if (opts.config) for (var k in opts.config) CONFIG[k] = opts.config[k];
      _virtual = (opts.startAt !== undefined) ? opts.startAt : Date.now();
      _lastReal = Date.now();
      _speed = opts.speed || 1;
      _paused = false;
      initCursors();
      return API;
    },

    /** 每帧调用一次，推进虚拟时钟。dt 钳制在 100ms：
     * 锁屏/遮挡恢复后浏览器会一次给你几万毫秒，不钳制则数字瞬间飙升。 */
    update: function () {
      var r = Date.now();
      var dr = Math.min(Math.max(r - _lastReal, 0), 100);
      _lastReal = r;
      _dtMs = dr;
      if (!_paused) _virtual += dr * _speed;
      return _virtual;
    },

    /** 本帧真实耗时（毫秒，已钳制在 100 以内）。做自己的插值/粒子时用这个。 */
    dt: function () { return _dtMs; },

    now: function () { return _virtual; },
    t0: function () { return T0; },
    get speed() { return _speed; },
    get paused() { return _paused; },
    setSpeed: function (s) { _speed = Math.max(0.1, Math.min(20, s)); return _speed; },
    togglePause: function () { _paused = !_paused; return _paused; },
    reset: function () { API.init({ t0: T0 }); },

    /** 三个数字 + 速率 + 下一个里程碑 */
    metrics: function () {
      var m = rawMetrics(_virtual);
      var next = (Math.floor(m.pages / CONFIG.MILESTONE_PAGES) + 1) * CONFIG.MILESTONE_PAGES;
      return {
        pages: m.pages,
        crawls: m.crawls,
        orders: m.orders,
        gmv: m.gmv,
        /* 本场新增（自开幕起）。想做"今日战绩"就用这几个。 */
        session: {
          pages: m.sessionPages, crawls: m.sessionCrawls,
          orders: m.sessionOrders, gmv: m.sessionGmv
        },
        pagesPerSec: lambdaPages(_virtual),
        crawlsPerSec: lambdaCrawls(_virtual),
        ordersPerMin: avgOrdersPerMin(),
        secondsPerOrder: 60 / avgOrdersPerMin(),
        nextMilestone: {
          metric: 'pages',
          value: next,
          remain: next - m.pages,
          progress: 1 - (next - m.pages) / CONFIG.MILESTONE_PAGES
        },
        stores: CONFIG.STORES + Math.floor((_virtual - T0) / 86400000 * CONFIG.NEW_STORES_PER_DAY)
      };
    },

    /** 平台占比（与 store-traffic 的 Platform Breakdown 同口径） */
    platformBreakdown: function () {
      var acc = {}, total = 0, i;
      for (i = 0; i < PLATFORM_ORDER.length; i++) acc[PLATFORM_ORDER[i]] = 0;
      for (i = 0; i < BOTS.length; i++) { acc[BOTS[i].platform] += BOTS[i].w; total += BOTS[i].w; }
      return PLATFORM_ORDER.map(function (p) {
        return { platform: p, share: acc[p] / total };
      });
    },

    /** 本帧到达的订单事件（含人工触发的）。返回按时间排序的数组。 */
    pollOrders: function () {
      if (_orderCursor === null) initCursors();
      var out = [], from = _orderCursor, to = _virtual;
      if (to > from) {
        var s0 = slotOf(from), s1 = slotOf(to);
        for (var s = Math.max(0, s0); s <= s1; s++) {
          var arr = ordersInSlot(s);
          for (var i = 0; i < arr.length; i++) {
            if (arr[i].t > from && arr[i].t <= to) out.push(arr[i]);
          }
        }
        _orderCursor = to;
      }
      if (_manualQueue.length) { out = out.concat(_manualQueue); _manualQueue = []; }
      out.sort(function (a, b) { return a.t - b.t; });
      return out;
    },

    /** 预览接下来的 n 个订单（给"排队中"这类 UI 用，不消耗游标） */
    peekOrders: function (n) {
      var out = [], s = slotOf(_virtual);
      while (out.length < n && s < slotOf(_virtual) + 40) {
        var arr = ordersInSlot(s);
        for (var i = 0; i < arr.length; i++) if (arr[i].t > _virtual) out.push(arr[i]);
        s++;
      }
      return out.slice(0, n);
    },

    /** 取某一档演示阶梯上的第 n 个金额（循环）。
     *
     *  各方案的演示键（N/C/B/V）都该用这个，**不要自己在区间里随机取数** ——
     *  随机金额几乎必然不在人声预渲染集合里（实测 V 键区间覆盖率只有 0.7%），
     *  按下去就是当场掉回 Huihui。用这个函数拿到的金额保证有对应整句音频。
     *
     *  @param tier  'common' | 'rare' | 'epic' | 'legendary'
     *  @param n     第几次按（各方案自己维护一个递增计数）
     *  @returns     金额（整数）；档位名不认识时返回 null，调用方自己兜底 */
    demoAmount: function (tier, n) {
      var lad = (CONFIG.DEMO_LADDERS || {})[tier];
      if (!lad || !lad.length) return null;
      return lad[((n | 0) % lad.length + lad.length) % lad.length];
    },

    /** 人工触发一单（BD 讲到关键处时按 B）。金额走 DEMO_LADDERS.legendary 依次轮换。
     *
     * 这里原来是 `sampleAmount(seed, true)`，seed 里掺了 `Math.random()` ——
     * 全引擎唯一一处真随机。两个后果：
     *   ① **金额不可预知 = 没法预渲染整句人声。** 其余 916 条播报都能提前算出来
     *      （见 _voice/build-lines.js），只有 B 键这一条会掉回 speechSynthesis，
     *      也就是全场最重要的那一按，偏偏蹦出一句 2013 年的 Huihui。
     *   ② **BD 会抽到不好看的数字。** 帕累托尾能给出 $813 也能给出 $4,487，
     *      而这一按是配合话术的高潮，金额本身就是台词的一部分。
     * 改成阶梯之后：连按依次拿到越来越大的数，讲故事的节奏是升的，
     * 而且每一档都保证有预渲染好的人声。
     *
     * 仍然支持 `opts.usd` 显式指定（验收脚本要用）。 */
    triggerOrder: function (opts) {
      opts = opts || {};
      var seed = Math.floor(_virtual / 7) + _manualCount * 7919;
      var lad = (CONFIG.DEMO_LADDERS || {}).legendary;
      var usd = (opts.usd !== undefined) ? opts.usd
              : (lad && lad.length) ? lad[_manualCount % lad.length]
              : sampleAmount(seed, true);
      var store = makeStore(Math.floor(hash32(seed, 1013) * CONFIG.STORES));
      var ref = weightedPick(REFERRERS, function (r) { return r.w; }, seed * 3 + 5);
      var pool = APGeo.citiesByCC[store.cc] || APGeo.CITIES;
      var buyer = pool[Math.floor(hash32(seed, 1117) * pool.length)];
      var ev = {
        kind: 'order', id: 'manual-' + seed, t: _virtual, usd: usd,
        amount: convert(usd, store.currency), currency: store.currency,
        locale: store.locale, tier: rarity(usd), isMacro: true, manual: true,
        store: store, product: productName(seed, store.lang),
        referrer: ref.host, platform: ref.platform,
        buyerCity: buyer[0], buyerLat: buyer[1], buyerLon: buyer[2]
      };
      _manualQueue.push(ev);
      _manualCount++; _manualGmv += usd;
      return ev;
    },

    /** 本帧的爬虫抓取事件。ratePerSec 是"展示速率"，不是真实速率
     * （真实 42.7/s 全画出来会糊成一片，日志流建议 6~10/s，地球弧线 2~4/s）。 */
    pollCrawls: function (ratePerSec) {
      var dtSec = Math.max(_dtMs, 8) / 1000;    // 用 update() 记下的本帧耗时
      _crawlAcc += (ratePerSec || 8) * dtSec * (_paused ? 0 : _speed);
      var n = Math.floor(_crawlAcc);
      _crawlAcc -= n;
      var out = [];
      for (var i = 0; i < n; i++) {
        var seed = (_crawlSeq++) * 31 + Math.floor(_virtual / 1000);
        var bot = weightedPick(BOTS, function (b) { return b.w; }, seed);
        var dc = APGeo.DATACENTERS[Math.floor(hash32(seed, 1229) * APGeo.DATACENTERS.length)];
        var store = makeStore(Math.floor(hash32(seed, 1231) * CONFIG.STORES));
        var pt = weightedPick(PAGE_TYPES, function (p) { return p.w; }, seed * 5 + 3);
        var prod = productName(seed, store.lang);
        out.push({
          kind: 'crawl',
          id: 'c' + seed,
          t: _virtual,
          bot: bot.name,
          platform: bot.platform,
          ip: dc.ip + '.x.x',
          asn: dc.asn,
          dcCity: dc.city,
          dcLat: dc.lat,
          dcLon: dc.lon,
          store: store,
          pageType: pt.t,
          path: pt.path + slugify(prod).slice(0, 34),
          status: hash32(seed, 1301) > 0.02 ? 200 : 304,
          bytes: 8000 + Math.floor(hash32(seed, 1303) * 46000),
          ms: 40 + Math.floor(hash32(seed, 1307) * 260)
        });
      }
      return out;
    },

    /** 跨过里程碑时返回事件（页面每 10 万 / 抓取每 100 万 / 订单每 100） */
    pollMilestones: function () {
      if (!_msSeen) initCursors();
      var m = rawMetrics(_virtual), out = [];
      var kp = Math.floor(m.pages / CONFIG.MILESTONE_PAGES);
      var kc = Math.floor(m.crawls / CONFIG.MILESTONE_CRAWLS);
      var ko = Math.floor(m.orders / CONFIG.MILESTONE_ORDERS);
      if (kp > _msSeen.pages) { out.push({ kind:'milestone', metric:'pages',
        value: kp * CONFIG.MILESTONE_PAGES }); _msSeen.pages = kp; }
      if (kc > _msSeen.crawls) { out.push({ kind:'milestone', metric:'crawls',
        value: kc * CONFIG.MILESTONE_CRAWLS }); _msSeen.crawls = kc; }
      if (ko > _msSeen.orders) { out.push({ kind:'milestone', metric:'orders',
        value: ko * CONFIG.MILESTONE_ORDERS }); _msSeen.orders = ko; }
      return out;
    },

    /** 是否该给这单配人声播报 */
    shouldSpeak: function (order) {
      return TIER_RANK[order.tier] >= TIER_RANK[CONFIG.VOICE_MIN_TIER];
    },

    /* ---- 格式化工具（大屏必须用 tabular 数字，这里只负责字符串） ---- */
    fmtInt: function (n) {
      return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },
    /**
     * 金额格式化。**故意忽略传入的 locale，一律用 en-US 排版**，原因有两个：
     *  1) 防误读（关键）：CAD / AUD / SGD / MXN 在各自 locale 下都渲染成裸 "$"。
     *     屏上出现「$16,338.80」其实是墨西哥比索（约 950 美元），观众会读成
     *     1.6 万美元 —— 这不只是不好看，是把我们自己的数字夸大了 17 倍。
     *     en-US 会渲染成 MX$ / CA$ / A$ / SGD，一眼可辨。
     *  2) 可扫读：大屏上是一列混合币种的订单，统一用 1,234.50 的小数点约定
     *     才能快速比较大小；本地写法（1.234,50 €）在混排列表里反而更难读。
     *     地域真实感靠币种本身 + 国家码 + 城市 + 本地语言商品名来承载，不靠数字排版。
     *  另外 AED 在 ar-AE 下会带 RTL 控制字符，在大屏上排版会跳，en-US 没这个问题。
     * locale 字段仍然保留在订单数据里，需要本地排版的场合自己取用。
     */
    fmtMoney: function (amount, currency) {
      try {
        return new Intl.NumberFormat('en-US', {
          style: 'currency', currency: currency || 'USD',
          maximumFractionDigits: (currency === 'JPY' || currency === 'KRW') ? 0 : 2
        }).format(amount);
      } catch (e) {
        return (currency || 'USD') + ' ' + API.fmtInt(amount);
      }
    },
    fmtUSD: function (usd) {
      return '$' + usd.toLocaleString('en-US',
        { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    /* 暴露内部工具，方便各方案自己做视觉随机（务必用确定性的这个，
     * 不要用 Math.random，否则重启后画面不可复现、彩排验收没法做） */
    hash32: hash32,
    pinkNoise: pinkNoise,
    valueNoise: valueNoise,
    makeStore: makeStore,
    sampleAmount: sampleAmount,
    rarity: rarity,
    localHour: localHour
  };

  root.APEngine = API;
})(typeof window !== 'undefined' ? window : globalThis);
