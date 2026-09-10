/* ===========================================================================
 * 方案 E · 可操作后台版
 *
 * 与 E-监控台-V1版式 的四处实质差别（都是这一轮点名要改的）：
 *
 *  1) 订单渐入回到**方案 C 原版的字符级 split-flap**。
 *     V1 那版把它简化成「7 列一起换乱码」——没有 rotateX、没有 perspective，
 *     波长只有 7×21ms = 147ms。等 55 秒来一笔订单，只闪 147ms，当然假。
 *     这一版每列切成固定字符格（翻页格合计 93 格；订单规模列走徽标不翻），
 *     逐格 stagger 21ms → 波长 93×21 ≈ 1.95 秒，与 C 原版 115×21 ≈ 2.4 秒同一个手感；
 *     每格 perspective(560px) rotateX(-76° → 0°)，加速到 0（1-p²），落地即停不回弹。
 *
 *  2) 两个流的速率都调过。**实测**（22 秒采样）：
 *       AI 读取日志 9 条/秒 → 11 行表一行只活 1.2 秒（6 个字段人读不完 → 糊）
 *       AI 订单 1.1 笔/分钟 → 一行活 5.5 分钟
 *     订单慢是真实的（ordersPerMin 是产品数据口径，不动），所以修法是让那一笔
 *     「值得等」：2 秒翻牌 + 4.2 秒地图播报。
 *     日志快才是真缺陷：这一版每 LOG_EVERY 条只上屏 1 条（打点仍按全速，
 *     「密度被感知」那部分不能丢），8 行表约 5 秒换一遍，人能读完一行。
 *
 *  3) 新订单在**地图对应点位弹播报卡**（国家 / 金额 / 哪个 AI 带来的）。
 *     3 张卡循环复用，DOM 恒定；带引线；靠边自动翻向。
 *
 *  4) 真的能操作：表格筛选（AI 助手 / 国家 / 订单规模 / 结果）、表头排序、
 *     搜索、导出 CSV、行点击出详情抽屉、日志暂停滚动、时间范围切换。
 *     时间范围两档都是引擎真实口径（session.* 与全量），不造假数据。
 *
 * 主题只留两套：dark（原样保持，主题色 #00D3A7 / #FFB86B 一分不改）
 *               light（纯白简洁科技风，色值取自 _关键度量.md §15 中文后台实测）
 * 屏上有切换入口（顶栏按钮 + D 键）——这一版是后台，主题切换是它自己的产品功能。
 *
 * classic script。零网络依赖。随机一律 APEngine.hash32，步长一律 APEngine.dt()（毫秒！）。
 * =========================================================================== */
(function (root) {
  'use strict';

  var doc = root.document;
  var E = root.APEngine, A = root.APAudio, Geo = root.APGeo, Aurora = root.APAurora;
  var W = 1920, H = 1080;

  /* 换场地只改这一行：大屏用 localhost 打开时无法推断局域网地址，二维码退回这个 */
  var SURVEY_FALLBACK = 'http://192.168.56.67:8099/E-survey/';

  /* ── 订单表：2 列 × 3 行 ──────────────────────────────────────────────────
   * 高度账（面板 268 一分不动）：42 头 + 34 表头 + 3 行 × 64 = 268 ✓
   * 宽度账：812 + 16 沟槽 + 812 = 1640 ✓
   * 位序**列优先**：左列 0/1/2 是最新三笔，右列 3/4/5 是再往前三笔。
   * 行高从 32 翻倍到 64 换来两件事：金额能放到 18px；国家/来自两列
   * 放得下「图标 + 名称」两行，图标负责一眼可辨，名称负责不用猜。 */
  var ORD_ROWS = 6, ORD_H = 64, ORD_PER_COL = 3;
  var ORD_COL_W = 812, ORD_GUT = 16;
  var LOG_ROWS = 7, LOG_H = 24;   /* 面板 243 = 42 头 + 32 表头 + 7×24 */

  /* 订单列：宽度 / 类名 / 字符格数 n / 翻页波跨度 sp。宽度合计必须 = 812（单列）。
   *
   * 和 6 行单列版的差别，以及为什么这么分：
   *   · 时间去掉日期只留 HH:MM:SS —— 同屏 6 笔全是今天的，月日是纯噪音，省 48px
   *   · 店铺 288 → 104。店名是脱敏过的（`Rin**onz`），**实测中位 8 字符、
   *     最长 9 字符**，原来给 18 格 288px 是照「店名可能很长」拍的，纯浪费
   *   · 商品 460 → 180，字符格 22 → 23。**实测商品名中位 37 字符**，
   *     原来 22 格本来就在截断，少给 4px 只是多截一个字，代价极小
   *   · 国家 92 → 52（国旗 + 中文名）、来自 164 → 60（色标 + 平台名）
   *   · 「查看」整列砍掉 88px。行本来就整行可点（ordBody 的 click 委托），
   *     悬停提示改成绝对定位浮在行右端，不再占列宽
   *
   * sp 是**翻页波的跨度**，不是字符数：图标列 n=0 但视觉上有宽度，
   * 波扫过去时不能瞬移，所以给它们 4 格的跨度。 */
  var ORD_COLS = [
    { k: 't',     w:  80, cls: 'm dim', n:  8, sp:  8, h: '时间',     so: 't'   },
    { k: 'no',    w: 120, cls: 'm dim', n: 14, sp: 14, h: '订单号',   so: 'no'  },
    { k: 'store', w: 104, cls: '',      n: 10, sp: 10, h: '店铺',     so: 'store' },
    { k: 'cc',    w:  52, cls: 'ic',    n:  0, sp:  4, h: '国家',     so: 'cc'  },
    { k: 'prod',  w: 180, cls: 'dim',   n: 23, sp: 23, h: '商品',     so: '', px: 1 },
    { k: 'src',   w:  60, cls: 'ic',    n:  0, sp:  4, h: '来自',     so: 'src' },
    { k: 'amt',   w: 120, cls: 'r amt', n: 10, sp: 10, h: '金额',     so: 'usd' },
    { k: 'tier',  w:  96, cls: 'ic',    n:  0, sp:  4, h: '订单规模', so: 'usd' }
  ];
  /* 日志列：宽度合计必须 = 1640 */
  var LOG_COLS = [
    { k: 't',     w: 120, cls: '',    h: '时间' },
    { k: 'bot',   w: 210, cls: 'bot', h: 'AI 助手' },
    { k: 'shop',  w: 200, cls: 'sh',  h: '店铺' },
    { k: 'path',  w: 670, cls: '',    h: '读取的页面' },
    { k: 'st',    w: 130, cls: '',    h: '结果' },
    { k: 'ms',    w: 130, cls: 'r',   h: '响应耗时' },
    { k: 'dc',    w: 180, cls: 'sh',  h: '读取来源地' }
  ];

  /* ── 翻页节奏：C 原版原文 STAGGER 21 / 26，STEP 46 / 54，一分不改 ────────── */
  var STAGGER = 21, STAGGER_HOT = 26, STEP = 46, STEP_HOT = 54;
  /* ── 整板翻牌的波速 ────────────────────────────────────────────────────────
   * C 原版是 115 格 × 21ms ≈ 2.4 秒扫完一行。**要保住的是那 2.4 秒的总时长**，
   * 不是 21 这个数 —— 人感知的是「波扫过整块板要多久」。
   *
   * 所以这里存的是**总时长**，每格的 stagger 现算：宽屏下商品列的字符格数会涨
   * （1920 是 26 格，2560 是 64 格），把 stagger 定死的话波长会跟着屏宽一起
   * 膨胀到 4.2 秒 —— 屏越宽翻得越慢，正好违背上面这条。 */
  var BOARD_SWEEP_MS = 2464, BOARD_SWEEP_HOT_MS = 3080;
  function boardStagger(hot) {
    return (hot ? BOARD_SWEEP_HOT_MS : BOARD_SWEEP_MS) / Math.max(1, ORD_SLOT_TOTAL * 2);
  }
  var TILT = 76;            /* 翻板起始倾角（度），C 原版值 */
  var PERSP = 560;          /* 透视距离（px），C 原版值 */

  /* ── 速率 ─────────────────────────────────────────────────────────────── */
  var CRAWL_RATE = 9;       /* 引擎侧真实取数速率（条/秒）——地图打点按这个走 */
  var LOG_EVERY = 6;        /* 每 N 条只上屏 1 条 → 1.5 行/秒 → 8 行约 5.3 秒换一遍 */
  var POP_MS = 4200;        /* 地图播报卡停留时长 */
  var POP_MAX = 3;          /* 同时最多几张（多了糊屏；55 秒一笔，3 张够用） */

  var CLS_D = '0123456789';
  var CLS_U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var CLS_L = 'abcdefghijklmnopqrstuvwxyz';
  var CLS_CJK = '美英德法加拿大澳利亚日本荷兰瑞典墨西哥波意爱尔新加坡韩国巴普通较额特';

  var TIER_CN = { common: '普通', rare: '较大', epic: '大额', legendary: '特大' };
  var TIER_K  = { common: 't1', rare: 't2', epic: 't3', legendary: 't4' };
  /* 自动订单在这一版后台里的展示档位。提高分界线后，小额单约占 75%，
   * 大额约 2.6%、特大约 0.1%；金额本身不改，所以 KPI、圆环与国家分布仍自洽。
   * 手动 N/C/B/V 保留引擎给定档位，现场演示不会被这些分界线改变。 */
  var AUTO_TIER_CUTS = { rare: 180, epic: 550, legendary: 1500 };
  function tuneAutoTier(o) {
    if (!o || o.manual) return o;
    var usd = o.usd || 0;
    o.tier = usd >= AUTO_TIER_CUTS.legendary ? 'legendary'
           : usd >= AUTO_TIER_CUTS.epic      ? 'epic'
           : usd >= AUTO_TIER_CUTS.rare      ? 'rare'
           :                                  'common';
    return o;
  }
  /* 必须覆盖店铺池里出现的全部 42 个国家 —— 少一个，筛选下拉里就会冒出一个
   * 光秃秃的 'AE'（实测踩到过）。国家名是商家最先扫的一列，不能有代码。 */
  var CC_CN = { US: '美国', GB: '英国', PK: '巴基斯坦', FR: '法国', AU: '澳大利亚',
                CN: '中国', IN: '印度', CA: '加拿大', HK: '中国香港', TW: '中国台湾',
                DE: '德国', NL: '荷兰', AE: '阿联酋', ES: '西班牙', SA: '沙特',
                SG: '新加坡', NZ: '新西兰', NG: '尼日利亚', IE: '爱尔兰', JP: '日本',
                PT: '葡萄牙', ZA: '南非', AT: '奥地利', IT: '意大利', RO: '罗马尼亚',
                BR: '巴西', BE: '比利时', TH: '泰国', CZ: '捷克', KR: '韩国',
                MY: '马来西亚', HU: '匈牙利', AR: '阿根廷', MX: '墨西哥', DK: '丹麦',
                NO: '挪威', KE: '肯尼亚', CH: '瑞士', ID: '印度尼西亚', FI: '芬兰',
                IL: '以色列', PE: '秘鲁', SE: '瑞典', PL: '波兰', BD: '孟加拉国',
                EG: '埃及', TR: '土耳其', VN: '越南', PH: '菲律宾', UA: '乌克兰',
                CL: '智利', CO: '哥伦比亚', GR: '希腊', MA: '摩洛哥' };
  var BLOCKED_CC = { CN: 1, HK: 1, TW: 1 };
  function countryAllowed(cc) { return !BLOCKED_CC[String(cc || '').toUpperCase()]; }
  var PF_CN = { ChatGPT: 'ChatGPT', Claude: 'Claude', Google: 'Google',
                Perplexity: 'Perplexity', Others: '其他 AI' };
  /* ── 「来自」列的模型标 ────────────────────────────────────────────────────
   * 用**真实品牌 logo**。路径与本页「订单来源分布」卡底部那一排（.mlg）是
   * 同一份，取自 simple-icons 的官方 24×24 单色版 —— 不是手描的
   * （那条注释的原话：展会大屏上画歪的品牌标比不放更糟）。
   * 由构建脚本从 index.html 的 .mlg 里直接提取，两处永远同源，不手抄。
   *
   * ⚠️ 合规状态（决定权在业务方，这里只如实记录，别当成已经过关）：
   *   `_共享规格.md` §7.1 与根 README 都明写「禁止出现任何第三方 logo
   *   （OpenAI / ChatGPT / Perplexity / Claude / Google）」，依据是
   *   OpenAI 开发者条款禁止其 logo 用于展会物料。
   *   本页 .mlg 那一排本来就在违反同一条，这一列是**按要求与它保持一致**。
   *   圆标下方仍压一行平台全名 —— §7.1 里「纯文字指代是允许的」那半条还占着。
   * 要回到合规版：把 p 换成单字母（C / G / A / P / ·）、删掉 .bk i svg 那条 CSS。 */
  var PF_MONO = {
    ChatGPT:    { c: '#10A37F',
                p: '<path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/>' },
    Google:     { c: '#4285F4',
                p: '<path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/>' },
    Claude:     { c: '#D97757',
                p: '<path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/>' },
    /* 这张表里唯一不用主品牌色打底的一个：按要求走「黑底白标」，
     * 也正是 Perplexity 官网 logo 规范的主锁定式（白标压 Offblack）。
     * #091717 是它色板里的官方 Offblack，不是随手挑的纯黑；换 #000
     * 视觉上分不出来（21:1 vs 18.3:1），但那就脱离它自己的色板了。
     * 注意别把这条当成「深色更清楚」的通用理由：白标压原来的
     * True Turquoise #20808D 是 4.63:1，本来就是这一排里最高的。 */
    Perplexity: { c: '#091717',
                p: '<path d="M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z"/>' },
    Others:     { c: '#6B7280',
                p: '<circle cx="5" cy="12" r="2.3"/><circle cx="12" cy="12" r="2.3"/><circle cx="19" cy="12" r="2.3"/>' }
  };
  var CHAN_HOST = { ChatGPT: 'chatgpt.com', Claude: 'claude.ai', Google: 'gemini.google.com',
                    Perplexity: 'perplexity.ai', Others: '' };
  var BOT_CN = { GPTBot: 'ChatGPT', 'OAI-SearchBot': 'ChatGPT', 'ChatGPT-User': 'ChatGPT',
                 ClaudeBot: 'Claude', 'Claude-Web': 'Claude', 'anthropic-ai': 'Claude',
                 'Google-Extended': 'Google', Googlebot: 'Google',
                 GoogleOther: 'Google', 'GoogleAgent-Mariner': 'Google',
                 'Google-GeminiNotebook': 'Google', 'Google-Agent': 'Google',
                 PerplexityBot: 'Perplexity' };

  /* ── Gemini 侧的抓取器 ──────────────────────────────────────────────────
   * 引擎的 BOTS 里 Google 只有 Google-Extended / GoogleOther / GoogleAgent-Mariner，
   * 没有 Gemini 自己那两个。而 `_shared/engine.js` 是 A/B/C/D 共用的，不能改，
   * 所以在覆盖层按确定性 hash 把一部分 Google 抓取改写成这两个 token。
   *
   * 两个名字都是 Google 官方文档里真实存在的 user agent token，不是我编的：
   *   Google-GeminiNotebook  Gemini Notebook（原 Google-NotebookLM，旧 token 支持到 2026-08）
   *   Google-Agent           Google 托管的 agent 受用户指派浏览网页
   * 来源：developers.google.com/crawling/docs/crawlers-fetchers/
   *       google-user-triggered-fetchers（2026-08-20 查）
   * 权重给得比 Google-Extended 低 —— 这两个是用户触发的，量本来就小。 */
  var GEMINI_BOTS = ['Google-GeminiNotebook', 'Google-Agent'];

  /* =====================================================================
   * 主题：两套。dark 是 V1 的「深空石墨」原值；light 的每一个色值都来自
   * `参考-SaaS后台\_关键度量.md` §15「中文后台的颜色（全部浅底）」实测表。
   *
   * 主题色（冷 #00D3A7 / 暖 #FFB86B）在 light 下必须压深：
   * 原值是给深底反白设计的，放到白底上对比度只有 1.6:1，等于看不见。
   * 压深后色相不变，还是同一对主题色。
   * ===================================================================== */
  var THEMES = [
    { key: 'dark', name: '深色科技风', ic: 'moon',
      v: { bg: '#08090B', panel: '#101216', panel2: '#15181D', bar: '#131620',
           side: '#0C0E12', sideHov: '#171A21', sideOn: '#1B2028',
           /* 侧栏磨砂（深色）。背后是 body 那层极光，所以透出来的是光不是黑。
            * .52 比 KPI 卡的 .58 还薄一档 —— 侧栏是**长条**，一整列光带穿过去
            * 才看得出「玻璃」；跟卡片同档的话只会显得灰。
            * 悬停/选中态跟着改成半透明，否则实色块压在玻璃上像两层材质。 */
           sideBg: 'rgba(12,14,18,.52)', sideBd: 'rgba(255,255,255,.07)',
           sideHovG: 'rgba(255,255,255,.06)', sideOnG: 'rgba(0,211,167,.13)',
           hair: '#1C1F25', hair2: '#262A33',
           tx: '#F7F8F8', tx2: '#9CA3AF', mute: '#6B7280', faint: '#4B5563',
           crawl: '#00D3A7', 'crawl-d': '#0B7360',
           order: '#FFB86B', 'order-d': '#8A5A28',
           fill: '#0B7360', fillTx: '#EAFFF9',
           red: '#FF6B60', ok: '#35D06A',
           land: '#2A313B', mkt: '#4A5A66', mkt2: '#6E8794',
           sh: '0 1px 2px rgba(0,0,0,.30)',
           shPop: '0 10px 30px rgba(0,0,0,.62),0 2px 8px rgba(0,0,0,.44)',
           lot: '#1E242C', lotHov: '#252D37',
           /* 去掉了原先末段之外的 `0 0 0 1px #313945` 描边环（见 index.html 的 #lotCard），
            * 保留投影和那圈极淡的主题色辉光 —— 深底上没有它卡片会整个陷进去 */
           lotSh: '0 10px 26px rgba(0,0,0,.70),0 0 20px rgba(0,211,167,.13)',
           lotShHov: '0 16px 34px rgba(0,0,0,.76),0 0 0 1px #00D3A7,0 0 26px rgba(0,211,167,.22)',
           hlRGB: '255,255,255', hlA: '.10', hlA2: '.028',
           /* 礼花卡的玻璃底。原先只写在 #stage 的行内默认值里、light 没有对应键，
            * 于是浅色主题下这张卡仍然是黑色半透明（实测）。两套都必须给。 */
           glassBg: 'rgba(16,18,22,.86)', glassBd: '#2E3540',
           /* ── 地图播报卡的拟态玻璃（深色）────────────────────────────────
            * 底色**比面板亮**（rgba(30,35,44) vs 面板 #101216）。
            * 深底上压一层更深的半透明看着是「一个洞」，不是玻璃 ——
            * 玻璃的直觉是「透光的实体」，必须比它后面的东西亮。
            * 顶边高光给到 .42：深色下那道 1px 是唯一能读出「厚度」的线索。 */
           /* KPI 卡的磨砂玻璃（深色）。底色比面板亮一档才「浮」得起来，
            * 和播报卡同一条道理。
            * .fill 那张原先写 .90，理由是「透太多会掉到 WCAG 以下」——
            * 那个顾虑方向对，但结论下反了：**降不透明度的同时把绿调深**，
            * 对比度是往上走的。深色底下尤其明显：背后是深底，越透越暗，
            * 白字反而更清楚。
            * 实测（截图取样、文字所在位置的真实背景色）：
            *   改前 rgba(0,122,99,.90) 无玻璃层 → 大数字 5.98:1 标签 5.17:1
            *   改后 rgba(0,128,104,.60) 加玻璃层 → 大数字 7.32:1 标签 6.00:1
            * 玻璃和可读性在这里不是取舍关系。
            * 注：两者都仍低于规格 §4.5 的 10:1，那是**改动前就存在**的缺口，
            * 要补齐得把这张卡整体压暗（浅色下会变成近黑的深绿），
            * 属于改版式，不在「做成磨砂玻璃」的范围里。 */
           kcBg: 'rgba(28,33,42,.58)', kcBd: 'rgba(255,255,255,.11)',
           kcFill: 'rgba(0,128,104,.60)',
           popBg: 'rgba(30,35,44,.55)', popBd: 'rgba(255,255,255,.14)',
           popHi: 'rgba(255,255,255,.42)',
           popSh: '0 14px 34px rgba(0,0,0,.58),0 3px 10px rgba(0,0,0,.42)',
           /* 礼花幕布：压暗背景，让纸片和卡片从后台界面里分离出来 */
           celScrim: 'rgba(4,6,10,.58)',
           /* 饼图色阶：主色的明度阶，末档是中性灰给「其他」 */
           pie: ['#00D3A7', '#00B294', '#0E9180', '#26766C', '#375F5B', '#4A5A66'] } },

    { key: 'light', name: '浅色科技风', ic: 'sun',
      v: { bg: '#F1F2F4',            /* 店匠实测页面底 */
           panel: '#FFFFFF',         /* 四家一致：面板纯白 */
           panel2: '#F7F8FA',        /* 有赞实测次级面板 */
           bar: '#FFFFFF',
           side: '#FFFFFF', sideHov: '#F1F2F4', sideOn: '#E9F7F3',
           /* 浅色：原来是 .90 的白（只透 10%），基本看不出玻璃。压到 .66。
            * 描边必须是深的 —— 浅底上白描边等于没有。 */
           sideBg: 'rgba(255,255,255,.66)', sideBd: 'rgba(17,24,39,.07)',
           sideHovG: 'rgba(17,24,39,.045)', sideOnG: 'rgba(0,142,116,.11)',
           hair: '#E8E9ED',          /* 店匠实测分隔线 */
           hair2: '#DCDEE3',
           tx: '#222222',            /* 店匠实测正文 */
           tx2: '#6C7175',           /* 店匠实测次级 */
           mute: '#969799',          /* 有赞实测 */
           faint: '#B4B8BE',
           /* crawl-d 是占比条的填充色。#B4E8DC 那种浅底色在白底上等于没有 ——
            * 6% 的条直接消失（实测）。中饱和的 #5FC9AF 才既清晰又不抢。 */
           crawl: '#008E74', 'crawl-d': '#5FC9AF',
           order: '#B26A16', 'order-d': '#E8B978',
           fill: '#00806A', fillTx: '#F2FFFB',
           red: '#C63A2E', ok: '#128A4B',
           land: '#DBDFE5', mkt: '#A6B0BA', mkt2: '#78848F',
           sh: '0 1px 2px rgba(0,0,0,.04)',       /* antd Pro 实测：几乎看不见 */
           shPop: '0 8px 24px rgba(17,24,39,.13),0 2px 6px rgba(17,24,39,.07)',
           /* 浅色下侧栏本身就是白的，所以靠投影 + 描边环把它抬起来，不靠提亮 */
           lot: '#FFFFFF', lotHov: '#FBFCFD',
           lotSh: '0 6px 18px rgba(17,24,39,.13)',
           lotShHov: '0 12px 26px rgba(17,24,39,.18),0 0 0 1px #008E74',
           hlRGB: '255,184,107', hlA: '.24', hlA2: '.05',
           /* 浅色下礼花卡是白卡 + 浅描边；幕布也得是浅的，
            * 白底上压一层黑幕会把整屏变灰，比不压更难看。 */
           glassBg: 'rgba(255,255,255,.94)', glassBd: '#DCDEE3',
           /* ── 地图播报卡的拟态玻璃（浅色）────────────────────────────────
            * 描边必须是**深的**：浅底上白描边等于没有，卡片会糊进背景。
            * 反过来顶边高光要接近纯白，它是玻璃边缘的反光。
            * 底色 .58 比深色那档略高 —— 浅色下点阵是深点压浅底，
            * 对比度更高，透太多会把字咬花（实测 .48 时金额边缘发毛）。 */
           /* 浅色：白玻璃 + 深描边（浅底上白描边等于没有）。
            * 底色给到 .72 而不是播报卡那档 .58 —— KPI 卡里是 32px 的大数字，
            * 透太多会让数字边缘被背后的极光洗花。 */
           kcBg: 'rgba(255,255,255,.72)', kcBd: 'rgba(17,24,39,.08)',
           /* .fill 浅色：.90 的中绿 → .80 的深绿。
            * 浅色底下背景是亮的，越透越亮、白字越糊，所以不能只降 alpha，
            * 必须同时把底色压深一档把亮度补回来（0,142,116 → 0,116,95）。
            * 实测（截图取样、文字所在位置的真实背景色）：
            *   改前 → 大数字 3.50:1 标签 2.86:1
            *   改后 → 大数字 3.80:1 标签 3.30:1
            * 浅色这一档天生比深色吃亏（背景亮，白字没处躲），
            * 离规格 §4.5 的 10:1 仍差得远 —— 那是改动前就有的缺口，见深色那段注释。 */
           kcFill: 'rgba(0,116,95,.80)',
           popBg: 'rgba(255,255,255,.58)', popBd: 'rgba(17,24,39,.11)',
           popHi: 'rgba(255,255,255,.96)',
           popSh: '0 14px 32px rgba(17,24,39,.17),0 3px 10px rgba(17,24,39,.09)',
           celScrim: 'rgba(241,242,244,.62)',
           pie: ['#008E74', '#22A188', '#4FBBA3', '#7FD2BE', '#AFE4D6', '#C9CFD6'] } }
  ];
  /* 浅色是新的默认视觉；深色仍可通过顶栏按钮 / D 键切换。 */
  var themeIdx = 1;
  var stage = doc.getElementById('stage');

  var IC = {
    /* 喇叭本体两态共用，「响」加两道弧、「静音」加一个叉。
     * 16×16 / stroke 1.5，和下面 moon/sun 同一套画法（svg 上是 fill:none + currentColor）。 */
    sound: '<path d="M2.6 6.3h2.2L7.8 3.6v8.8L4.8 9.7H2.6z"/>'
         + '<path d="M10.1 6.4a2.4 2.4 0 0 1 0 3.2M11.9 4.7a4.8 4.8 0 0 1 0 6.6"/>',
    muted: '<path d="M2.6 6.3h2.2L7.8 3.6v8.8L4.8 9.7H2.6z"/>'
         + '<path d="M10.4 6.3l3.4 3.4M13.8 6.3l-3.4 3.4"/>',
    moon: '<path d="M13.4 9.6A5.6 5.6 0 0 1 6.4 2.6a5.9 5.9 0 1 0 7 7z"/>',
    sun:  '<circle cx="8" cy="8" r="3.1"/><path d="M8 1.3v1.8M8 13.9v1.8M1.3 8h1.8M12.9 8h1.8M3.3 3.3l1.3 1.3M11.4 11.4l1.3 1.3M12.7 3.3l-1.3 1.3M4.6 11.4l-1.3 1.3"/>'
  };

  function themeVal(k) { return THEMES[themeIdx].v[k]; }

  function applyTheme(i) {
    themeIdx = ((i % THEMES.length) + THEMES.length) % THEMES.length;
    var t = THEMES[themeIdx], k;
    for (k in t.v) if (Object.prototype.hasOwnProperty.call(t.v, k)) {
      stage.style.setProperty('--' + k, t.v[k]);
    }
    /* CSS 要靠这个属性切 logo 的黑版/浅版（变量做不到换图） */
    stage.setAttribute('data-theme', t.key);
    /* <html> 上也打一份：body 的浅色光场是舞台外面那层，选择器够不到 #stage。 */
    doc.documentElement.setAttribute('data-theme', t.key);
    doc.body.style.backgroundColor = t.v.bg;
    if (Aurora && Aurora.setActive) Aurora.setActive(t.key);
    var ic = doc.getElementById('icTheme');
    if (ic) ic.innerHTML = IC[t.ic] || '';
    var bt = doc.getElementById('btnTheme');
    if (bt) bt.title = '当前' + t.name + ' · 点击切换';
    /* 地图底图的陆块与市场点也是主题色，必须重烤 —— 只改 CSS 变量它不会变。
     * sparkline 同理（画在 canvas 上）。 */
    if (mapCtx) bakeMap();
    /* 趋势线的渐变对象是按色值缓存的，换主题必须先失效再重画 */
    for (var si = 0; si < SKS.length; si++) { SKS[si].invalidate(); SKS[si].draw(); }
    /* 全屏地球也跟着换（canvas 里的渐变/辉光/弧线色都要重建）。
     * 即使当前没开地球也要调 —— 下次按 G 时才是对的颜色。 */
    if (GB && GB.setTheme) GB.setTheme(t.key);
    if (pieItems.length) paintPie();      /* 饼图配色也是主题色 */
    var la = doc.getElementById('lgA'), lb = doc.getElementById('lgB');
    if (la) la.style.background = t.v.crawl;
    if (lb) lb.style.background = t.v.order;
    try { root.localStorage.setItem('apBack_theme', t.key); } catch (e) {}
  }
  function cycleTheme() { applyTheme(themeIdx + 1); }

  /* ── 舞台缩放 ─────────────────────────────────────────────────────────── */
  /* 舞台一撑宽，地图容器跟着变 —— canvas 的位图必须重开再重烤，
   * 只让 CSS 把它拉大会把点阵放大成糊的。尺寸没变就直接返回，
   * 否则每个 resize 事件都要重烤一遍整张底图。 */
  function relayoutMap() {
    if (!mapCtx) return;
    var pb = doc.getElementById('mapWrap');
    if (!pb) return;
    var w = Math.max(100, pb.clientWidth), h = Math.max(100, pb.clientHeight);
    if (w === mapCv.width && h === mapCv.height) return;
    mapCv.width = w; mapCv.height = h;
    mapGeom();
    bakeMap();
  }

  function fit() {
    var s = Math.min(root.innerWidth / W, root.innerHeight / H);
    /* 宽屏下保持 1080 设计高度与等比缩放，只让 flex 舞台吸收多余宽度。 */
    stage.style.width = Math.max(W, root.innerWidth / s) + 'px';
    stage.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
    relayoutMap();
    applyTableWidths();     /* 宽屏下把两张表的弹性列拉开，别在右边留空条 */
  }
  root.addEventListener('resize', fit);
  fit();

  /* =====================================================================
   * 点阵世界地图（陆块掩码与 C-LED 第四版逐字节相同）
   * ===================================================================== */
  var MAP_COLS = 64, MAP_ROWS = 26, MAP_LON0 = -180, MAP_DLON = 360 / MAP_COLS;
  var MAP_LAT0 = 78, MAP_DLAT = 5;
  var LAND = [
    [[11,18],[22,27]], [[4,19],[22,27],[35,63]], [[2,21],[23,28],[33,63]],
    [[2,21],[23,24],[32,63]], [[1,4],[8,21],[30,31],[33,63]], [[9,21],[30,57]],
    [[10,20],[31,57]], [[10,20],[30,57]], [[11,19],[30,33],[36,56]], [[11,18],[29,55]],
    [[12,14],[17,17],[28,42],[44,53]], [[12,14],[28,41],[44,51],[53,53]],
    [[13,15],[28,39],[45,46],[49,51],[53,54]], [[16,20],[29,40],[45,45],[49,51],[53,54]],
    [[17,22],[30,40],[46,46],[50,50],[53,54]], [[17,24],[33,39],[50,54]],
    [[17,25],[33,39],[50,53],[55,58]], [[18,25],[33,39],[51,52],[54,58]],
    [[18,25],[33,40],[54,57]], [[19,25],[34,38],[40,40],[52,58]],
    [[19,24],[34,37],[39,39],[51,59]], [[19,23],[35,37],[52,59]], [[19,22],[35,36],[52,58]],
    [[19,21],[57,58],[62,62]], [[19,20],[57,57],[61,62]], [[19,20],[61,61]]
  ];
  var mapCv = doc.getElementById('map'), mapCtx = null, mapBase = null;
  var MW = 0, MH = 0, MPX = 0, MPY = 0, MOX = 0, MOY = 0, MDOT = 0.84;

  /* 通栏后宽屏下地图容器会跟着变宽，MPX / MPY 各算各的就会把 64×26 的点阵拉变形：
   * 800×278 时格子是 12.50×10.69（比 1.17，还算方），容器一到 1100 宽就成 1.82 ——
   * 整块大陆看着被横向压扁。这正是当初把地图钉死在 800 宽的原因。
   * 现在改成两边互相封顶（谁都不许比对方大 20% 以上），多出来的空间用
   * MOX / MOY 居中留白。1920 那一档 min(12.50, 10.69×1.2=12.83) 取到 12.50、
   * MOX/MOY 都是 0 —— 也就是说这一档的地图和改之前逐像素一致。 */
  function mapGeom() {
    MW = mapCv.width; MH = mapCv.height;
    var px = MW / MAP_COLS, py = MH / MAP_ROWS;
    MPX = Math.min(px, py * 1.2);
    MPY = Math.min(py, MPX * 1.2);
    MOX = (MW - MPX * MAP_COLS) / 2;
    MOY = (MH - MPY * MAP_ROWS) / 2;
  }
  /* 点阵画正圆。半径取**短边**的一半：格子不是正方（1920 档 12.5 × 10.69，
   * 比 1.17，封顶逻辑见 mapGeom），按长边画出来是椭圆，那就不叫圆点了。
   * 代价是横向的点间距比纵向大（约 3.5 vs 1.7），远看列比行略松。
   * 要两轴完全均匀，得把 mapGeom 里的封顶从 1.2 收到 1.0 让格子变正方 ——
   * 但点阵宽度会从 800 掉到 684，地图整体缩一圈，所以没顺手改。
   * roundRect 的兼容分支一并去掉了：arc 没有那个可用性问题。 */
  function cellDot(g, cx, cy, k) {
    g.beginPath();
    g.arc(cx, cy, Math.min(MPX, MPY) * MDOT * k / 2, 0, 6.283185);
    g.fill();
  }
  function lonlatToCell(lon, lat) {
    var c = Math.round((lon - MAP_LON0) / MAP_DLON - 0.5);
    var r = Math.round((MAP_LAT0 - lat) / MAP_DLAT - 0.5);
    return [Math.max(0, Math.min(MAP_COLS - 1, c)), Math.max(0, Math.min(MAP_ROWS - 1, r))];
  }
  function cellCenter(c, r) { return [MOX + (c + 0.5) * MPX, MOY + (r + 0.5) * MPY]; }

  /** 市场代表点：每个市场取该国权重最高的城市。
   *  APGeo 真实结构：MARKETS=[{cc,...}] 按 weight 降序；
   *  CITIES=[名称,纬度,经度,国家码,权重] —— 是**数组的数组**，按对象属性取 cc 全落空。 */
  function marketPoints() {
    var out = [], i, j;
    try {
      var byCc = Geo && Geo.citiesByCC;
      /* 优先用真实客户报表的国家（按家数降序），地图上的常亮点才和占比图对得上。
       * 退回 APGeo.MARKETS 只是兜底。 */
      var ccs = [], RCC = root.APShops && root.APShops.CC;
      if (RCC) {
        for (var k in RCC) if (Object.prototype.hasOwnProperty.call(RCC, k) && countryAllowed(k)) ccs.push(k);
        ccs.sort(function (a, b) { return RCC[b] - RCC[a]; });
      } else if (Geo && Geo.MARKETS) {
        for (i = 0; i < Geo.MARKETS.length; i++) {
          if (countryAllowed(Geo.MARKETS[i].cc)) ccs.push(Geo.MARKETS[i].cc);
        }
      }
      if (ccs.length && byCc) {
        for (i = 0; i < ccs.length; i++) {
          var pool = byCc[ccs[i]];
          if (!pool || !pool.length) continue;
          var best = pool[0];
          for (j = 1; j < pool.length; j++) if (pool[j][4] > best[4]) best = pool[j];
          out.push([best[2], best[1]]);
        }
      }
    } catch (e) { out = []; }
    if (out.length < 6) {
      out = [[-74,40.7],[-0.1,51.5],[13.4,52.5],[2.35,48.9],[-79.4,43.7],[151.2,-33.9],
             [139.7,35.7],[-46.6,-23.5],[4.9,52.4],[18.1,59.3],[-99.1,19.4],[21,52.2]];
    }
    return out;
  }

  function bakeMap() {
    var c = doc.createElement('canvas');
    c.width = MW; c.height = MH;
    var g = c.getContext('2d'), r, k, x, i;
    g.fillStyle = themeVal('land');
    for (r = 0; r < LAND.length && r < MAP_ROWS; r++) {
      for (k = 0; k < LAND[r].length; k++) {
        var seg = LAND[r][k];
        for (x = seg[0]; x <= seg[1] && x < MAP_COLS; x++) {
          var p = cellCenter(x, r);
          cellDot(g, p[0], p[1], 1);
        }
      }
    }
    var pts = marketPoints();
    for (i = 0; i < pts.length; i++) {
      var pc = lonlatToCell(pts[i][0], pts[i][1]), q = cellCenter(pc[0], pc[1]);
      g.fillStyle = (i < 5) ? themeVal('mkt2') : themeVal('mkt');
      cellDot(g, q[0], q[1], i < 5 ? 1.15 : 1.0);
    }
    mapBase = c;
  }

  /* =====================================================================
   * 真实店铺覆写层
   *
   * 引擎的 makeStore 生成的是虚构英文店名 + 18 个市场的国家分布。
   * 这一层把它换成**真实客户报表**里的（已脱敏）店铺与真实国家分布。
   *
   * 为什么做成覆写层而不是改 engine.js：engine 是 A/B/C/D 与 C-LED 共用的，
   * 改它等于同时改动五个已验收的方案。这一层只影响后台版。
   *
   * 覆写 name / domain / cc / 行业 / 买家城市；**不覆写 currency 与 amount** ——
   * 中国跨境卖家的 Shopify 店多半就是用 USD 结算的，保留引擎原值反而更真。
   * ===================================================================== */
  var SHOPS = null, SHOP_IND = [];

  /* ── 中文店名池 ────────────────────────────────────────────────────────
   * 真实报表里 1035 家只有 3 家名字带中日韩字符（跨境卖家的 Shopify 店名
   * 绝大多数是英文的，这是事实）。但我们的客户和现场观众是中文的，
   * 屏上一小时看不到一个中文店名，「这是我们的客户」这件事就传达不到。
   *
   * 所以按固定间隔掺入中文店铺：不是随机替换（那会让同一个 store.id
   * 一会儿中文一会儿英文），而是**按 id 取模命中**才换 —— 同一家店永远同名。
   * 命中率 1/9，配合约 1.1 笔/分钟的订单，平均每 8 分钟出一家中文店。
   *
   * 脱敏规则和 shops.js 一致：中文名 4 字及以上 → 首1**尾1，保证每行都带 **。
   * 这些是**构造的示例店名**，不是真实客户 —— 真实客户全在 shops.js 里且已脱敏。 */
  /* 第四段是 myshopify 的 ASCII 子域。必须显式给 ——
   * 中文店名走 maskDomain 会算出「云-记.myshopify.com」，而 Shopify 的
   * 子域只能是 ASCII，中文域名一眼就是假的。真实中国卖家的店铺域名都是拼音/英文。 */
  var CN_SHOPS = [
    '云**记|CN|0|yun-c-ji', '棉**社|CN|0|mian-s-she', '衣**间|CN|0|yi-j-jian',
    '素**堂|CN|1|su-t-tang', '本**研|CN|1|ben-y-yan', '肌**所|CN|1|ji-s-suo',
    '生**铺|CN|2|sheng-p-pu', '拾**集|CN|2|shi-j-ji', '好**市|CN|2|hao-s-shi',
    '木**造|CN|3|mu-z-zao', '安**居|CN|3|an-j-ju', '一**光|CN|3|yi-g-guang',
    '极**造|CN|5|ji-z-zao', '数**间|CN|5|shu-j-jian', '礼**盒|CN|6|li-h-he',
    '山**野|CN|7|shan-y-ye', '远**行|CN|7|yuan-x-xing', '小**熊|CN|8|xiao-x-xiong',
    '童**语|CN|8|tong-y-yu', '茶**间|CN|9|cha-j-jian', '味**坊|CN|9|wei-f-fang',
    '谷**物|CN|9|gu-w-wu', '毛**日|CN|10|mao-r-ri', '宠**记|CN|10|chong-j-ji',
    '手**壳|CN|11|shou-k-ke', '纸**间|CN|12|zhi-j-jian', '文**社|CN|12|wen-s-she',
    '玩**控|CN|13|wan-k-kong',
    /* 港台的中文店名同样常见，国家码要给对，否则地图会把它打到大陆去 */
    '茶**works|HK|9|cha-w-works', '香**號|HK|1|xiang-h-hao',
    '誠**品|TW|12|cheng-p-pin', '日**good|TW|2|ri-g-good'
  ];
  var CN_EVERY = 9;      /* store.id % 9 === 4 命中 → 约 1/9 的店是中文名 */

  function initShops() {
    var S = root.APShops;
    if (!S || !S.SHOPS || !S.SHOPS.length) return;
    SHOP_IND = S.IND || [];
    SHOPS = [];
    for (var i = 0; i < S.SHOPS.length; i++) {
      var p = String(S.SHOPS[i]).split('|');
      if (!p[0] || !countryAllowed(p[1])) continue;
      SHOPS.push({ name: p[0], cc: p[1] || 'US', ind: SHOP_IND[+p[2]] || '' });
    }
    CN_POOL = [];
    for (i = 0; i < CN_SHOPS.length; i++) {
      var q = CN_SHOPS[i].split('|');
      if (!countryAllowed(q[1])) continue;
      CN_POOL.push({ name: q[0], cc: q[1] || 'CN', ind: SHOP_IND[+q[2]] || '',
                     dom: q[3] || '', cn: 1 });
    }
  }
  var CN_POOL = [];
  /** 域名也必须脱敏 —— 它比店名更直接可识别。** 转成 -，不含任何原始信息。
   *
   *  必须**剥掉 CJK**：原先的字符类是 `[^a-z0-9一-鿿-]`，把中日韩字符留下了，
   *  于是真实报表里那几家名字带中文的店会算出「我-店.myshopify.com」——
   *  而 myshopify.com 的子域只能是 ASCII，中文域名一眼就是假的（实测暴露）。
   *  剥完没剩下可读字符时，用店名的 hash 派生一个稳定的 ASCII 短码：
   *  同一家店永远同一个域名，且不携带原始信息。 */
  function maskDomain(n) {
    var raw = String(n || '');
    var s = raw.toLowerCase().replace(/\*\*/g, '-')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-').replace(/^-|-$/g, '');
    /* 只剩连字符/太短 → 说明原名基本是非拉丁字符，派生一个短码 */
    if (s.replace(/-/g, '').length < 2) {
      var h = 0;
      for (var i = 0; i < raw.length; i++) h = (h * 131 + raw.charCodeAt(i)) >>> 0;
      s = 'shop-' + h.toString(36).slice(0, 6);
    }
    return s + '.myshopify.com';
  }
  /** 按 store.id 稳定映射：同一个 id 永远是同一家店（名字/国家/行业都不会跳） */
  function realShop(id) {
    if (!SHOPS || !SHOPS.length) return null;
    var n = Math.floor(id) || 0;
    /* 取模命中就换成中文店铺。用取模而不是 hash 判定，是为了让命中**均匀分布**
     * ——hash 会聚簇，屏上会出现连着三家中文店然后二十分钟一家没有。 */
    if (CN_POOL.length && ((n % CN_EVERY) + CN_EVERY) % CN_EVERY === 4) {
      return CN_POOL[Math.floor(n / CN_EVERY) % CN_POOL.length];
    }
    return SHOPS[((n % SHOPS.length) + SHOPS.length) % SHOPS.length];
  }
  /** 内容覆写：商品名 / 路径 / 读取来源。
   *  引擎的池子太小（商品名 216 种、路径 864 种、来源 14 个城市），
   *  盯着看几分钟就能看出在循环。APFeed 把三样都放大三个数量级以上，
   *  并且商品名跟着**店铺行业**走（服饰店卖衣服、美妆店卖护肤品）。 */
  function applyFeed(o) {
    var F = root.APFeed;
    if (!F || !o) return o;
    var sd = (parseInt(String(o.id).replace(/\D/g, ''), 10) || 1);
    if (o.kind === 'crawl') {
      /* Gemini 侧的两个 token：引擎里没有，在这里按确定性 hash 掺进 Google 的抓取里。
       * 只改 bot 名，platform 仍是 Google —— 占比图和筛选器的口径不能变。
       * 0.34 是「用户触发类抓取占 Google 侧约三分之一」，比 Google-Extended 低。 */
      if (o.platform === 'Google' && E.hash32(sd, 6171) < 0.34) {
        o.bot = GEMINI_BOTS[(E.hash32(sd, 6173) * GEMINI_BOTS.length) | 0];
      }
      /* 来源先覆写：路径与打点都要用新的。城市名保留语义，坐标带抖动散开 */
      var og = F.origin(sd * 7 + 3);
      o.dcCity = og.city; o.dcLat = og.lat; o.dcLon = og.lon;
      o.product = F.product(sd, o.store && o.store.ind);
      o.path = F.path(sd * 13 + 5, o.product);
    } else {
      o.product = F.product(sd, o.store && o.store.ind);
    }
    return o;
  }

  function applyShop(o) {
    if (!o || !o.store) return o;
    var rs = realShop(o.store.id);
    if (!rs) return o;
    var st = o.store;
    st.name = rs.name;
    /* 中文店铺自带 ASCII 子域（见 CN_SHOPS 注释）；英文店铺继续从脱敏名现算 */
    st.domain = rs.dom ? (rs.dom + '.myshopify.com') : maskDomain(rs.name);
    st.cc = rs.cc;
    st.ind = rs.ind;
    /* 买家城市要按**新**国家重取 —— 引擎是按它自己那套 cc 挑的，
     * 不重取会出现「中国的店铺、买家在 Dubai」这种对不上的组合。
     * CITIES 是数组的数组 [名称, 纬度, 经度, 国家码, 权重]。 */
    if (o.kind === 'order') {
      var pool = Geo && Geo.citiesByCC && Geo.citiesByCC[rs.cc];
      if (pool && pool.length) {
        var c = pool[Math.floor(E.hash32(Math.floor(o.store.id) * 7 + 13, 1117) * pool.length)];
        if (c) { o.buyerCity = c[0]; o.buyerLat = c[1]; o.buyerLon = c[2]; }
      }
    }
    return o;
  }

  var hits = [], HIT_CAP = 90;
  function addHit(lon, lat, kind) {
    if (lon == null || lat == null) return null;
    var pc = lonlatToCell(lon, lat), p = cellCenter(pc[0], pc[1]);
    /* 读取点寿命 720ms 配 9/秒的预算 → 地图上同时约 6~7 个点在闪。
     * 520ms 配 5/秒只有 2~3 个点，地图看着是停的 —— 而这一层的作用本来就是
     * 「密度被感知」（度量文档 01 线原话），点太少这一层就白做了。
     *
     * 订单点必须活到播报卡消失为止。原先给 1100ms，而卡片停 4200ms ——
     * 后 3 秒引线指向一片空白（实测截图里就是这样）。 */
    hits.push({ x: p[0], y: p[1], age: 0,
                dur: kind === 'order' ? POP_MS : 720, kind: kind });
    if (hits.length > HIT_CAP) hits.splice(0, hits.length - HIT_CAP);
    return p;
  }
  function drawMap(dtMs) {
    if (!mapCtx) return;
    var g = mapCtx, i;
    g.clearRect(0, 0, MW, MH);
    if (mapBase) g.drawImage(mapBase, 0, 0);
    for (i = hits.length - 1; i >= 0; i--) {
      var ht = hits[i];
      ht.age += dtMs;
      var u = ht.age / ht.dur;
      if (u >= 1) { hits.splice(i, 1); continue; }
      var col = (ht.kind === 'order') ? themeVal('order') : themeVal('crawl');
      if (ht.kind === 'order') {
        /* 扩散圈只在头 1.1 秒（不跟着 4.2 秒的总寿命拉长，否则会扩成一个大圆）；
         * 点本身保持满亮，只在最后 500ms 淡出 —— 播报卡在的时候点必须在。 */
        var ring = ht.age / 1100;
        if (ring < 1) {
          g.strokeStyle = col; g.globalAlpha = (1 - ring) * 0.55; g.lineWidth = 1.6;
          g.beginPath(); g.arc(ht.x, ht.y, MPY * (0.9 + ring * 3.4), 0, 6.283); g.stroke();
        }
        var left = ht.dur - ht.age;
        g.globalAlpha = left < 500 ? (left / 500) : 1;
      } else {
        g.globalAlpha = (1 - u) * 0.85;
      }
      g.fillStyle = col;
      cellDot(g, ht.x, ht.y, ht.kind === 'order' ? 1.3 : 1.0);
      g.globalAlpha = 1;
    }
  }

  /* =====================================================================
   * 地图订单播报卡
   *   POP_MAX 张预建好循环复用（动态 append 会破坏 DOM 恒定）。
   *   靠右 / 靠上时自动翻向，卡片永远留在地图内；引线角度按点位实算。
   * ===================================================================== */
  var popHost = doc.getElementById('pops'), pops = [], popN = 0;
  function buildPops() {
    for (var i = 0; i < POP_MAX; i++) {
      var d = doc.createElement('div');
      d.className = 'pop';
      d.innerHTML = '<span class="ld"></span>'
        + '<div class="p1"><i></i><b class="cc"></b></div>'
        + '<div class="p2"></div><div class="p3"></div>';
      popHost.appendChild(d);
      pops.push({ el: d, ld: d.querySelector('.ld'), cc: d.querySelector('.cc'),
                  amt: d.querySelector('.p2'), src: d.querySelector('.p3'),
                  t: 0, live: false });
    }
  }
  /* ── 与已亮着的卡避让 ──────────────────────────────────────────────────────
   * 改成拟态玻璃之后冒出来的新约束：玻璃是半透明的，两张叠在一起时
   * **后面那张的字会透过前面这张显出来**，读起来像渲染坏了。
   * 不透明的旧版没这个问题 —— 前卡直接盖住后卡，难看但不像故障。
   *
   * 而且这不是理论情况：引擎每 10 分钟一次宏节拍，3~5 单齐发（README 明写），
   * 卡片停留 4.2 秒，撞上是必然的。
   *
   * 沿**垂直**方向找最近的空位（不动水平：水平位置由「点位在左还是在右」
   * 决定，挪了引线就会横穿地图）。三档都挤不下就认了 —— 宁可叠着，
   * 也不把卡挪出地图边界。 */
  function avoidPops(self, cand, w, h) {
    var live = [], i, q;
    for (i = 0; i < pops.length; i++) {
      q = pops[i];
      if (q === self || !q.live) continue;
      live.push({ l: parseFloat(q.el.style.left) || 0, t: parseFloat(q.el.style.top) || 0,
                  w: q.el.offsetWidth, h: q.el.offsetHeight });
    }
    if (!live.length) return cand[0];
    var GAP = 8;
    function hits(c) {
      for (var k = 0; k < live.length; k++) {
        var r = live[k];
        if (c.L < r.l + r.w + GAP && r.l < c.L + w + GAP &&
            c.T < r.t + r.h + GAP && r.t < c.T + h + GAP) return true;
      }
      return false;
    }
    for (i = 0; i < cand.length; i++) if (!hits(cand[i])) return cand[i];
    return cand[0];      /* 全撞：宁可叠着，也不把卡挪出地图 */
  }

  function popOrder(o, px, py) {
    if (!pops.length || px == null) return;
    var p = pops[popN % POP_MAX]; popN++;
    var big = (o.tier === 'epic' || o.tier === 'legendary');
    p.cc.textContent = (CC_CN[o.store.cc] || o.store.cc) + ' · ' + (o.buyerCity || '');
    p.amt.textContent = E.fmtUSD(o.usd);
    p.src.textContent = (PF_CN[o.platform] || o.platform || '') + ' 带来';
    p.el.classList.toggle('big', big);

    /* 卡片尺寸是内容决定的，量一次真实值再定位（写死会在长城市名上溢出地图） */
    p.el.classList.remove('on');
    p.el.style.left = '0px'; p.el.style.top = '0px';
    var cw = p.el.offsetWidth || 140, chh = p.el.offsetHeight || 58;

    var GAPX = 16, GAPY = 12, PAD = 6;
    /* 候选位置**按偏好排序**，avoidPops 取第一个不撞的。
     * 偏好顺序：原位 → 垂直微调（24px 一档，比整卡高一档细得多，
     * 档位多才挤得下）→ 水平翻到点位另一侧再来一轮。
     * 只做垂直不够：地图内高约 278px、卡片 58px，三张挤在同一水平位置时
     * 纵向档位会用光（实测浅色下 0×2 仍然重叠）。加上翻边搜索空间翻倍。 */
    var prefR = px < MW * 0.66;                     /* 点位偏右时卡片翻到左边 */
    var prefB = py < chh + GAPY + PAD;              /* 点位太靠上时卡片翻到下面 */
    var lo = PAD, hi = Math.max(PAD, MH - chh - PAD);
    var cand = [], si, ti;
    var sides = [prefR, !prefR];
    for (si = 0; si < sides.length; si++) {
      var R = sides[si];
      var L0 = R ? (px + GAPX) : (px - GAPX - cw);
      L0 = Math.max(PAD, Math.min(MW - cw - PAD, L0));
      var T0 = Math.max(lo, Math.min(hi, prefB ? (py + GAPY) : (py - GAPY - chh)));
      /* 在**合法区间内**按「离理想位置由近及远」扫，步长 12px。
       * 原来是「理想值 + 固定偏移再夹紧」，那样越界的候选会**全部折叠到
       * 同一个边界值**上 —— 看着 11 个候选，实际只有三四个不同位置，
       * 三张卡挤在一起时就找不到空位（实测 7 次里红 2 次）。
       * 区间 156px、卡高 58 + 间隙 8，三张一定放得下，所以扫得全就一定有解。 */
      var ts = [];
      for (ti = lo; ti <= hi; ti += 12) ts.push(ti);
      if (ts[ts.length - 1] !== hi) ts.push(hi);
      ts.sort(function (a, b) { return Math.abs(a - T0) - Math.abs(b - T0); });
      for (ti = 0; ti < ts.length; ti++) cand.push({ L: L0, T: ts[ti], R: R });
    }
    var pick = avoidPops(p, cand, cw, chh);
    var L = pick.L, T = pick.T, right = pick.R, below = prefB;
    p.el.style.left = L + 'px';
    p.el.style.top = T + 'px';
    p.el.style.transformOrigin = (right ? 'left ' : 'right ') + (below ? 'top' : 'bottom');

    /* 引线：从点位画到卡片靠点位那一侧的角 */
    var ax = right ? 0 : cw, ay = below ? 0 : chh;
    var dx = (px - L) - ax, dy = (py - T) - ay;
    var len = Math.sqrt(dx * dx + dy * dy);
    p.ld.style.width = len.toFixed(1) + 'px';
    p.ld.style.height = '1px';
    p.ld.style.left = ax + 'px';
    p.ld.style.top = ay + 'px';
    p.ld.style.transform = 'rotate(' + Math.atan2(dy, dx).toFixed(4) + 'rad)';
    p.ld.style.transformOrigin = '0 0';

    void p.el.offsetWidth;
    p.el.classList.add('on');
    p.t = POP_MS; p.live = true;
  }
  function updatePops(dtMs) {
    for (var i = 0; i < pops.length; i++) {
      var p = pops[i];
      if (!p.live) continue;
      p.t -= dtMs;
      if (p.t <= 0) { p.el.classList.remove('on'); p.live = false; }
    }
  }

  /* =====================================================================
   * 迷你时序
   * ===================================================================== */
  /* ── KPI 卡的趋势线 ────────────────────────────────────────────────────
   *
   * 上一版这里有两个病，症状都是「看不出在动」，但根因不同：
   *
   * 1) 画的是**速率**不是累计量。sk2 推 `m.ordersPerMin` —— 翻引擎能看到
   *    `avgOrdersPerMin()` 连时间参数都不收，纯粹从 CONFIG 算，**是个常量**。
   *    常量序列过 min-max 归一化后是一条水平线，再叠上「不小于均值 8%」的量程地板，
   *    结果就是一条居中的直线。这不是「不明显」，是数学上不可能有起伏。
   *    改成推**累计量**（本场累计成交额/订单/读取页/店铺）：累计量单调递增，
   *    折线必然是往右上走的，「在增加」这件事本身就是图形语义。
   *
   * 2) 只在采样时刻重画（3 秒一次），两次之间画面完全静止。
   *    现在拆成 commit（900ms 落一个点）+ 每帧画：committed 点整体按 frac 左移，
   *    头部那一段连到**实时值**，于是折线是连续生长的，不是每 3 秒闪一下。
   *
   * 面积渐变（主题色 → 透明）是「看得更清楚」的主要手段：单根 1.5px 的线在
   * 96px 高的卡片右下角太轻，一片带色的面积才能在 1~3 米外被看见。
   *
   * 性能：4 张 104×30 的 canvas，每帧 12,480 像素。渐变对象按主题缓存，
   * rAF 内不新建（规格 2.7）。实测对 rafFps 无可测影响。 */
  var SPK_MS = 900, SPK_N = 34;
  /* ── 趋势线画的是「速率起伏」，不是累计值 ──────────────────────────────────
   * 原来画的是累计值。累计值是**单调**的，所以画出来永远是一条近乎直线的
   * 斜线（实测就是），谈不上任何起伏。
   *
   * 现在画的是引擎自己那条速率调制曲线：`_shared/engine.js:209` 里
   *   noise = 0.75 + 0.5 × pinkNoise(ms / 900000, 11)     // 15 分钟尺度
   * 就是它在让数字一会儿涨得快一会儿慢。**这不是编出来的波形，
   * 是真的在驱动那几个数字的那一条。**
   *
   * 窗口 40 分钟、2 倍频，是按「一整天每 10 分钟采一次」实测挑的：
   * 75% 的时刻落在 3~5 个转折点（＝2~3 个起伏），其余基本是 2 个，都算平缓。
   * 倍频取 2 而不是引擎默认的 4 —— 4 会带出高频小抖动，就不「平缓」了。
   *
   * 也因此这条线是**时间的纯函数**，每帧现算、自己在滑，
   * 不再需要 seed/push/live 那套采样累积（30 秒窗口在 15 分钟尺度上是平的，
   * 攒多久都攒不出起伏）。 */
  var SPK_WIN_MS = 40 * 60000, SPK_OCT = 2;

  function makeSpark(hostId, w, h, colorKey) {
    var host = doc.getElementById(hostId);
    if (!host) {
      return { push: function () {}, draw: function () {}, live: function () {},
               seed: function () {}, invalidate: function () {} };
    }
    var cv = doc.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    host.appendChild(cv);
    var g = cv.getContext('2d');
    var hist = [], liveV = null, frac = 0;
    var grad = null, gradCol = '';
    var salt = arguments[4] || 11;

    /** 按当前虚拟时间重算整条曲线（时间的纯函数，见 SPK_WIN_MS 上面那段） */
    function recompute() {
      var now = E.now(), i, v = [], mn = Infinity, mx = -Infinity, x;
      for (i = 0; i < SPK_N; i++) {
        x = E.pinkNoise((now - (SPK_N - 1 - i) / (SPK_N - 1) * SPK_WIN_MS) / 900000,
                        salt, SPK_OCT);
        v.push(x);
        if (x < mn) mn = x; if (x > mx) mx = x;
      }
      /* 归一化到 [0,1]。**下限留 0.18 的余量**：某些时段振幅只有 0.2，
       * 直接拉满会把一条本来平缓的线放大成剧烈锯齿，那就不是「平缓」了。 */
      var span = Math.max(0.18, mx - mn);
      for (i = 0; i < SPK_N; i++) v[i] = (v[i] - mn) / span;
      hist = v;
    }

    function col() { return themeVal(colorKey) || themeVal('mkt'); }

    /** 主题色 → 透明的竖向渐变。按色值缓存，主题不变就不重建。 */
    function areaGrad() {
      var c = col();
      if (grad && gradCol === c) return grad;
      gradCol = c;
      grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0.00, hexA(c, 0.42));
      grad.addColorStop(0.55, hexA(c, 0.16));
      grad.addColorStop(1.00, hexA(c, 0.00));
      return grad;
    }

    return {
      /** 落一个采样点（每 SPK_MS 一次） */
      /* push / live / seed 现在是**空实现**。曲线形状由 recompute 按时间纯函数
       * 决定，不再靠采样累积 —— 留着它们改 hist 的话会和 recompute 抢同一个数组。
       * 调用点没删：boot 和主循环里那几处还夹着别的逻辑（指标数字更新）。 */
      push: function () {},
      live: function () {},
      seed: function () {},
      invalidate: function () { grad = null; gradCol = ''; },
      /* seed / push / live 保留成空实现：调用点还在（boot 和主循环），
       * 但曲线形状已经由 recompute 决定，不再依赖采样累积。
       * 留空壳而不是删调用点 —— 那几处还夹着别的逻辑（指标数字更新）。 */
      draw: function () {
        recompute();
        g.clearRect(0, 0, w, h);
        var n = hist.length;
        if (n < 2) return;
        var pts = hist;
        var i, mn = Infinity, mx = -Infinity, sum = 0;
        for (i = 0; i < pts.length; i++) {
          if (pts[i] < mn) mn = pts[i];
          if (pts[i] > mx) mx = pts[i];
          sum += pts[i];
        }
        /* 量程：纯 min-max，**不加**「不小于均值 x%」的地板。
         *
         * 那个地板是上一版留下来的，而它恰恰是「趋势线看不出来」的直接原因：
         * 本场累计读取页在开场就已经是 806 万（session 是从开幕算起、boot 时预铺过历史），
         * 31 秒窗口内的增量约 1,169 —— 而 mean×4% 是 322,374，
         * 地板比真实极差大 275 倍，于是任何累计量都被压成一条水平线（实测 y 恒等于 14）。
         *
         * 累计量是单调的，把极差放大到满格正是想要的：线从左下走到右上，
         * 「在增加」就是图形本身的语义。真正需要防的只有「完全恒定」那一种，
         * 用相对 1e-6 的判据兜住即可（那是浮点噪声，不是波动）。 */
        var mean = sum / pts.length;
        var raw = mx - mn;
        var flat = raw <= Math.abs(mean) * 1e-6;
        var span = flat ? (Math.abs(mean) || 1) : raw;
        var lo = flat ? (mean - span / 2) : mn;
        var pad = 3.0, usable = h - pad - 2.5;
        var step = w / SPK_N;
        /* 整条线铺满画布：曲线本身按 E.now() 每帧滑，不需要再钉头部 */
        function X(k) { return k / (n - 1) * w; }
        function Y(v) { return pad + (1 - (v - lo) / span) * usable; }

        /* 面积：先描一遍线的路径，再闭合到底边填渐变 */
        g.beginPath();
        for (i = 0; i < pts.length; i++) {
          var x = X(i), y = Y(pts[i]);
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        var lastX = X(pts.length - 1), lastY = Y(pts[pts.length - 1]);
        g.save();
        g.lineTo(lastX, h); g.lineTo(X(0), h); g.closePath();
        g.fillStyle = areaGrad(); g.fill();
        g.restore();

        /* 线：重画一遍（上面那段被 closePath 污染了路径，不能直接 stroke） */
        g.beginPath();
        for (i = 0; i < pts.length; i++) {
          if (i === 0) g.moveTo(X(i), Y(pts[i])); else g.lineTo(X(i), Y(pts[i]));
        }
        g.strokeStyle = col(); g.lineWidth = 1.7;
        g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke();

        /* 头部光点：告诉眼睛「这一端是现在」。晕圈半径 4.2，实心 2.1。 */
        g.beginPath(); g.arc(lastX, lastY, 4.2, 0, Math.PI * 2);
        g.fillStyle = hexA(col(), 0.28); g.fill();
        g.beginPath(); g.arc(lastX, lastY, 2.1, 0, Math.PI * 2);
        g.fillStyle = col(); g.fill();
      }
    };
  }

  /** #RRGGBB → rgba()。主题色都是 6 位 hex；拿不准就原样返回（宁可不透明也不画错色）。 */
  function hexA(c, a) {
    var m = /^#([0-9a-f]{6})$/i.exec(String(c));
    if (!m) return c;
    var v = parseInt(m[1], 16);
    return 'rgba(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255)
      + ',' + a + ')';
  }

  var sk0 = null, sk1 = null, sk2 = null, sk3 = null, SKS = [];

  /* ═══════════════════════════════════════════════════════════════════════
   * 「上线至今」四个计数器的展示口径
   * ───────────────────────────────────────────────────────────────────────
   * 铁律：**四个都必须是墙上时间的纯函数，从引擎的固定开幕时刻 E.t0() 起算。**
   * 不许出现「页面加载那一刻的快照」，也不许用 localStorage 存计数器
   * （和 _shared/engine.js 开头的设计原则 1 是同一条）。
   *
   * 上一版就是栽在这条上，而且是**两连续两归零**的最坏组合：
   *     成交额 = 500000 + (session.gmv − 加载时快照)   ← 钉在加载时刻
   *     店铺   = 1015   + (now − 加载时刻)/天 × 18      ← 钉在加载时刻
   *     订单   = session.orders                        ← 从 T0 积分，真的连续
   *     商品页 = session.crawls                        ← 从 T0 积分，真的连续
   * 于是每天开机：订单和商品页接着昨天往上走，成交额回到 $500,000、
   * 店铺回到 1,015 家。四张卡里两张有延续性两张没有，**比四张全归零更容易被
   * 看穿** —— 订单天天涨、成交额天天归位，均单价会一路往下掉，
   * 而均单价是台下最容易心算的那个数。
   *
   * 这个矛盾**不用等到第二天，今天就已经能算穿**（实测 2026-09-01）：
   *     卡上 $500,135 ÷ 21,760 单 = 均单价 $22.94
   *     引擎实际生成的订单均价    = $143.74
   *     而订单列表里明明白白列着 $44 / $67 / $135 / $383
   *     差 6.3 倍 —— 做一次除法就出来了。
   *
   * 所以成交额和订单现在**共用同一个增量源**（引擎 session 积分，
   * 也就是屏上那些订单事件的金额之和），均单价恒等于引擎真实均价，
   * 结构上不可能再漂开。
   *
   * ── 改对外口径只改下面这四个基线 ───────────────────────────────────────
   * 成交额和订单保持 $139 左右的均单价；AI 读取量是展会展示口径。
   * 锚点后叠加引擎的 session 增量，所以刷新、
   * 跨天和重启都不会归位。
   * ═══════════════════════════════════════════════════════════════════════ */
  var DISP = {
    /* 2026-09-03 08:00 (UTC+8) 展会开场值。开场前保持此值，
     * 到点后再叠加引擎增量；店铺数继续走原来的独立锚点。 */
    showAnchorAt: Date.UTC(2026, 8, 3, 0, 0, 0),
    gmvAtShow: 500000,
    ordersAtShow: 3597,
    crawlsAtShow: 150000,
    crawlsMinPerSec: 1,
    crawlsMaxPerSec: 10,
    /* 同一时刻引擎的 session 值，用于只叠加锚点后的成交增量。 */
    gmvSessionAtShow: 3493991.5500000156,
    ordersSessionAtShow: 24291,
    /* 店铺数不用「T0 时刻的值」表达，用**锚点**表达：
     * 「在 anchorAt 这一刻应当显示 anchorN 家」，T0 时刻的值由它反推。
     * 这样想让某天正好是某个对外数字时，改锚点就行，不用自己拿计算器
     * 换算回 T0（上一版那个 1015 就是这么来的，但它被错当成了「加载时刻的值」）。 */
    storeAnchorAt: Date.UTC(2026, 8, 1, 8, 0, 0),   /* 2026-09-01 16:00 (UTC+8) */
    storeAnchorN: 1015,
    storePerDay: 18
  };

  /** 从 T0 到 t 的天数（小数）。t 早于 T0 时返回负数 —— 锚点反推要用到负值，
   *  所以这里**不能**像上一版那样 Math.max(0, …) 一刀切。 */
  function daysFromT0(t) { return (t - E.t0()) / 86400000; }

  /* 店铺数：阶梯函数（18 家/天 ≈ 80 分钟 +1 家）。趋势线画的是**未取整值**，
   * 因为 31 秒窗口内取整后必然是一条水平线，画它没有意义。 */
  function spkStores() {
    var atT0 = DISP.storeAnchorN - daysFromT0(DISP.storeAnchorAt) * DISP.storePerDay;
    return atT0 + daysFromT0(E.now()) * DISP.storePerDay;
  }
  function displayStores() { return Math.floor(spkStores()); }

  /* 下面三个是「上线至今」口径的唯一出口。**所有消费方都必须走这里** ——
   * 上一版 KPI 卡、环形图基数、左栏订单数各自直接读 m.session.*，
   * 同一个数字在三处各算一遍，这就是口径漂移的温床。 */
  var manualDisplay = { orders: 0, gmv: 0 };
  function registerManualDisplay(usd) {
    manualDisplay.orders++;
    manualDisplay.gmv += usd;
  }
  function displayGmv(m) {
    if (rngMode !== 'session') return m.gmv;
    var autoGmv = m.session.gmv - manualDisplay.gmv;
    return Math.max(DISP.gmvAtShow,
      DISP.gmvAtShow + (autoGmv - DISP.gmvSessionAtShow)) + manualDisplay.gmv;
  }
  function displayOrders(m) {
    if (rngMode !== 'session') return m.orders;
    var autoOrders = m.session.orders - manualDisplay.orders;
    return Math.max(DISP.ordersAtShow,
      DISP.ordersAtShow + (autoOrders - DISP.ordersSessionAtShow)) + manualDisplay.orders;
  }
  /* 圆环和渠道占比必须跟顶部“上线至今”使用同一个时间口径。
   * 8 点前的自动订单仍可进入订单流，但顶部基线尚未开始增长，不能再把它们
   * 累加到圆环里；人工演示单无论何时触发都要立即计入。累计口径不设此闸门。 */
  function orderCountsInDisplay(o) {
    return rngMode !== 'session' || !!o.manual || o.t >= DISP.showAnchorAt;
  }
  var crawlDisplayCache = { sec: 0, total: 0 };
  function crawlRateAt(sec) {
    var span = DISP.crawlsMaxPerSec - DISP.crawlsMinPerSec + 1;
    return DISP.crawlsMinPerSec + Math.floor(E.hash32(sec, 9049) * span);
  }
  function crawlGrowth(elapsedMs) {
    if (elapsedMs <= 0) return 0;
    var sec = Math.floor(elapsedMs / 1000);
    if (crawlDisplayCache.sec > sec) crawlDisplayCache = { sec: 0, total: 0 };
    while (crawlDisplayCache.sec < sec) {
      crawlDisplayCache.total += crawlRateAt(crawlDisplayCache.sec);
      crawlDisplayCache.sec++;
    }
    return crawlDisplayCache.total + crawlRateAt(sec) * ((elapsedMs % 1000) / 1000);
  }
  function displayCrawls(m) {
    if (rngMode !== 'session') return m.crawls;
    return DISP.crawlsAtShow + crawlGrowth(E.now() - DISP.showAnchorAt);
  }
  function displayCrawlsRate(m) {
    if (rngMode !== 'session') return m.crawlsPerSec;
    var sec = Math.floor(Math.max(0, E.now() - DISP.showAnchorAt) / 1000);
    return crawlRateAt(sec);
  }
  function spkGmv(m)    { return displayGmv(m); }
  function spkOrders(m) { return displayOrders(m); }
  function spkCrawls(m) { return displayCrawls(m); }

  /* 开场预铺：不铺的话前 30 秒四张卡全是空白，看着像图表坏了。
   * 铺的是「按当前值倒推的历史」—— 累计量的历史就是现在减去这段时间的增量，
   * 斜率用引擎的当前速率，所以形状和真实历史同阶。 */
  function seedSparks() {
    var m = E.metrics();
    var win = SPK_N * SPK_MS / 1000;               /* 窗口秒数 */
    var gmvNow = spkGmv(m), ordNow = spkOrders(m), crNow = spkCrawls(m);
    var ordRate = (m.ordersPerMin || 1) / 60;      /* 笔/秒 */
    var crRate = displayCrawlsRate(m) || 1;
    var gmvRate = ordRate * (ordNow > 0 ? gmvNow / ordNow : 60);
    function back(now, rate) {
      return function (i, n) {
        var ago = (n - 1 - i) / (n - 1) * win;
        return Math.max(0, now - rate * ago);
      };
    }
    sk0.seed(back(gmvNow, gmvRate));
    sk1.seed(back(crNow, crRate));
    sk2.seed(back(ordNow, ordRate));
    sk3.seed(back(spkStores(), DISP.storePerDay / 86400));
    for (var i = 0; i < SKS.length; i++) SKS[i].draw();
  }

  /* =====================================================================
   * 数据缓冲（筛选 / 排序 / 导出的唯一数据源）
   *   渲染层只是它的一个视图 —— 这样筛选才能筛到「屏外」的那些行，
   *   导出 CSV 也才是导全部而不是导屏上 6 行。
   * ===================================================================== */
  var ORD_BUF = 80, LOG_BUF = 120;
  var ordBuf = [], logBuf = [], seenIds = {}, seenN = 0;
  /* 三个维度的筛选值现在是**集合**（多选），空集合 = 不筛这一维。
   * 原来是单值字符串，三个 <select> 各管一个。改成一个按钮 + 勾选面板之后
   * 语义必须跟着变，否则「勾了 ChatGPT 又勾 Claude」没法表达。
   * asArr 兼容单值写法：APDiag.setFilter({src:'ChatGPT'}) 和渠道卡点击
   * 都还是传单值，不改它们的调用方。 */
  var oF = { src: [], cc: [], tier: [], q: '' };
  function asArr(v) {
    if (v == null || v === '') return [];
    return Object.prototype.toString.call(v) === '[object Array]' ? v.slice() : [v];
  }
  /** 空集合视为「全通过」—— 这是「不筛」和「筛了但一个都没勾」的同一种表达 */
  function inSet(arr, v) { return !arr.length || arr.indexOf(v) >= 0; }
  var lF = { bot: [], st: [] };
  var oSort = { key: 't', dir: -1 };
  var logPaused = false;

  function ordNo(o) {
    /* 后台必有订单号。用 id 派生 → 同一笔订单号恒定，不是每帧现编。
     * 取 6 位而不是 4 位：历史预铺订单的 id 加了 500000 偏移（见 boot），
     * 4 位的话偏移被截掉，历史单和真实单会撞出同一个订单号。 */
    var n = parseInt(String(o.id).replace(/\D/g, ''), 10) || 0;
    var d = new Date(o.t);
    var mm = ('0' + (d.getMonth() + 1)).slice(-2), dd = ('0' + d.getDate()).slice(-2);
    return 'AP-' + mm + dd + '-' + ('00000' + (n % 1000000)).slice(-6);
  }
  function ordMatch(o) {
    if (!inSet(oF.src, o.platform || 'Others')) return false;
    if (!inSet(oF.cc, o.store.cc)) return false;
    if (!inSet(oF.tier, o.tier)) return false;
    if (oF.q) {
      var q = oF.q.toLowerCase();
      if (String(o.store.name).toLowerCase().indexOf(q) < 0
          && String(o.product).toLowerCase().indexOf(q) < 0
          && ordNo(o).toLowerCase().indexOf(q) < 0) return false;
    }
    return true;
  }
  function logMatch(c) {
    if (!inSet(lF.bot, BOT_CN[c.bot] || c.platform || 'Others')) return false;
    if (!inSet(lF.st, String(c.status))) return false;
    return true;
  }
  function ordView() {
    var out = [], i;
    for (i = 0; i < ordBuf.length; i++) if (ordMatch(ordBuf[i])) out.push(ordBuf[i]);
    var k = oSort.key, d = oSort.dir;
    out.sort(function (a, b) {
      var x, y;
      if (k === 'usd') { x = a.usd; y = b.usd; }
      else if (k === 'no') { x = ordNo(a); y = ordNo(b); }
      else if (k === 'store') { x = a.store.name; y = b.store.name; }
      else if (k === 'cc') { x = CC_CN[a.store.cc] || a.store.cc; y = CC_CN[b.store.cc] || b.store.cc; }
      else if (k === 'src') { x = a.platform || ''; y = b.platform || ''; }
      else { x = a.t; y = b.t; }
      if (x < y) return -1 * d;
      if (x > y) return 1 * d;
      return (a.t - b.t) * d;      /* 同键值时按时间兜底，避免排序不稳定导致行跳动 */
    });
    return out;
  }
  /* ── 上屏列表和数据缓冲必须分开 ────────────────────────────────────────────
   * logBuf 按**全速**收（9 条/秒，地图打点要它），上屏只 1.5 行/秒。
   * 原来两边混用一个 buffer：渲染时取 logBuf 的最后 7 条，而两次渲染之间
   * logBuf 已经涨了 6 条 —— 于是 **7 行里有 6 行内容全换掉，动画却只滑一行高**。
   * 眼睛看到的是「小幅滑动 + 文字几乎整片重排」，读起来就是不顺。
   * 也就是说降采样只作用在**渲染触发**上，没作用在**显示集合**上。
   *
   * 分开之后 logShown 每次只追加一条，连续两帧的显示集合正好差一行 ——
   * 滑动和内容变化这才对得上。 */
  var logShown = [];
  function logView() {
    var out = [], i;
    for (i = 0; i < logShown.length; i++) if (logMatch(logShown[i])) out.push(logShown[i]);
    return out;
  }
  /** 筛选变了要从全量缓冲重新抽样，否则只能看见「碰巧被采样到」的那些 */
  function rebuildLogShown() {
    var out = [], i, k = 0;
    for (i = 0; i < logBuf.length; i++) {
      if (!logMatch(logBuf[i])) continue;
      if (k++ % LOG_EVERY === 0) out.push(logBuf[i]);
    }
    logShown = out.slice(-(LOG_ROWS + 4));
  }
  /** 「符合 N 条」要报**全量缓冲**的匹配数，不是屏上这几行 */
  function logMatchCount() {
    var c = 0, i;
    for (i = 0; i < logBuf.length; i++) if (logMatch(logBuf[i])) c++;
    return c;
  }
  /** 顶部插入动画只在「最新在最上面」时才成立；用户按金额排序后必须走整表重建。 */
  function isFeedMode() { return oSort.key === 't' && oSort.dir === -1; }

  /* =====================================================================
   * 订单表：固定 ORD_ROWS 行 DOM，每列切成固定数量的字符格。
   *
   * 为什么不用 C 原版那种「整行 115 个等宽格」：这一版是有列宽的后台表格，
   * 列对齐由 .c 的固定 px 宽保证，不依赖等宽字体 —— 中日文商品名也不会把列顶歪。
   * 每列内部再切字符格，翻页波仍然逐字符从行首扫到行尾。
   * ===================================================================== */
  var ordBody = doc.getElementById('ordBody'), ordEmpty = doc.getElementById('ordEmpty');
  var oRows = [];
  var ORD_SLOT_OFF = [], ORD_SLOT_TOTAL = 0;
  /** 重算翻页波的格位表。商品列格数随屏宽变，所以这个**不能只算一次**。 */
  function recalcSlotOff() {
    ORD_SLOT_OFF.length = 0; ORD_SLOT_TOTAL = 0;
    for (var i = 0; i < ORD_COLS.length; i++) {
      ORD_SLOT_OFF.push(ORD_SLOT_TOTAL);
      ORD_SLOT_TOTAL += ORD_COLS[i].sp;   /* sp 不是 n：图标列 n=0 但占波宽 */
    }
  }
  recalcSlotOff();

  /* 表头做**两份**（左右各一份），和两列表体逐列对齐。
   * 两份都能点，排序是整块板的状态 —— markSort 用 querySelectorAll 一次刷全部，
   * 所以点左边那份，右边的箭头也会跟着动，不会分叉。 */
  function buildOrdHead() {
    var head = doc.getElementById('ordHead'), i, c, el, col;
    head.style.height = '34px';
    head.innerHTML = '';
    function onSort() {
      var k = this.getAttribute('data-so');
      if (oSort.key === k) oSort.dir = -oSort.dir;
      else { oSort.key = k; oSort.dir = (k === 't' || k === 'usd') ? -1 : 1; }
      markSort(); renderOrd(true);
    }
    for (col = 0; col < 2; col++) {
      if (col) {
        el = doc.createElement('div');
        el.className = 'gut';
        el.style.width = ORD_GUT + 'px';
        head.appendChild(el);
      }
      for (i = 0; i < ORD_COLS.length; i++) {
        c = ORD_COLS[i];
        el = doc.createElement('div');
        el.className = 'c' + (/\br\b/.test(c.cls) ? ' r' : '')
                     + (/\bic\b/.test(c.cls) ? ' ic' : '') + (c.so ? ' so' : '');
        el.style.width = c.w + 'px';
        /* 箭头由 CSS 伪元素 .th .c.so::after 画（和 pages.js 的四个内页共用同一套）。
         * 这里**不要**再插一个 <i class="ar"> —— 两套并存会在排序列上画出两个三角。 */
        el.textContent = c.h || '';
        if (c.so) { el.setAttribute('data-so', c.so); el.addEventListener('click', onSort); }
        head.appendChild(el);
      }
    }
    markSort();
  }
  /** 程序化改排序（KPI 卡聚焦要用）。和点表头走同一条路径，状态不会分叉。 */
  function setSort(k, dir) {
    oSort.key = k; oSort.dir = dir;
    markSort(); renderOrd(true);
  }
  function markSort() {
    var head = doc.getElementById('ordHead');
    var all = head.querySelectorAll('.so'), i;
    for (i = 0; i < all.length; i++) {
      all[i].classList.remove('asc', 'desc');
      if (all[i].getAttribute('data-so') === oSort.key) {
        all[i].classList.add(oSort.dir > 0 ? 'asc' : 'desc');
      }
    }
  }

  function buildOrdRows() {
    for (var i = 0; i < ORD_ROWS; i++) {
      var el = doc.createElement('div');
      el.className = 'orow';
      /* 行宽走 CSS 变量 --ordColW（applyTableWidths 写它），**不能写行内 style**
       * —— 行内样式优先级高过 var()，宽屏下行就不跟着长了（实测踩到）。 */
      var cells = [], slots = [], blocks = [], c, j, k;
      el.appendChild(mk('span', 'mk'));
      el.appendChild(mk('span', 'hl'));
      for (j = 0; j < ORD_COLS.length; j++) {
        c = ORD_COLS[j];
        var cd = doc.createElement('div');
        cd.className = 'c ' + c.cls;
        cd.style.width = c.w + 'px';
        if (c.n > 0) {
          var cf = doc.createElement('span');
          cf.className = 'cf';
          var sp = [];
          for (k = 0; k < c.n; k++) {
            var s = doc.createElement('span');
            cf.appendChild(s); sp.push(s);
          }
          cd.appendChild(cf); slots.push(sp); blocks.push(null);
        } else {
          /* 图标列（国家 / 来自 / 订单规模）：整格当**一个**翻板。
           * 内容用 innerHTML 换，翻转加在这个包装上，不碰 .c 本身
           * —— .c 上有列宽和 padding，转它会把列宽一起转歪。 */
          var bw = doc.createElement('span');
          bw.className = 'bk';
          cd.appendChild(bw);
          slots.push(null); blocks.push(bw);
        }
        cells.push(cd); el.appendChild(cd);
      }
      /* 原来「查看 ›」占一整列 88px，现在整个去掉了 —— 行本身可点
       * （ordBody 上有 click 委托 → openDrawer），不需要再写一遍。
       * 顺带把 .act 这个类名从订单行里彻底拿掉：README 记过它当年是全局类，
       * btnPause 按下时也加 .act，于是「暂停滚动」按钮被 opacity:0 整个变透明。
       * 行里不再有这个类，那条隐患就没有复发面了。 */
      ordBody.appendChild(el);
      oRows.push({ el: el, cells: cells, slots: slots, blocks: blocks, o: null,
                   fl: null, t0: 0, active: false, dur: STEP, seed: 0 });
    }
    function mk(t, cls) { var e = doc.createElement(t); e.className = cls; return e; }
  }
  /** 当前单列宽。宽屏下会大于设计值 812，见 applyTableWidths。 */
  function ordColW() { return lastOrdColW || ORD_COL_W; }
  /** 位序 → 屏幕坐标。**列优先**：0/1/2 左列（最新三笔），3/4/5 右列。
   * 右列的 x **必须读当前列宽**，不能用常量 ORD_COL_W —— 宽屏下行会跟着
   * --ordColW 长到 1131，而右列还停在 828，于是右列整个压在左列上
   * （2560 下实测：右列的时间/订单号/店铺叠在左列的来自/金额/规模上面）。 */
  function ordPos(i) {
    return [((i / ORD_PER_COL) | 0) * (ordColW() + ORD_GUT), (i % ORD_PER_COL) * ORD_H];
  }
  function layoutOrd(instant) {
    for (var i = 0; i < ORD_ROWS; i++) {
      var r = oRows[i], q = ordPos(i);
      if (instant) r.el.style.transition = 'none';
      r.el.style.transform = 'translate3d(' + q[0] + 'px,' + q[1] + 'px,0)';
      if (instant) { void r.el.offsetWidth; r.el.style.transition = ''; }
    }
  }

  /* =====================================================================
   * 宽屏自适应：让每一行铺满可用宽度
   * ---------------------------------------------------------------------
   * 版面是「宽度流动 + 按高度等比缩放」（见 fit()），所以任何比 16:9 更宽的
   * 屏幕都会多出横向空间，而两张表的列宽是按 1640 写死的：
   *     2560×1080 → 表体 2278，列合计 1640，**右侧空 638px**
   *     3440×1440 → 表体 3064，列合计 2187，**右侧空 877px**
   * **这个缺陷比 2 列布局早** —— 单列 6 行那版同样是 1640 的固定列宽，
   * 只是当时右边那条空白没人盯着。日志表现在也还是同一个毛病，一起修。
   *
   * 修法：每张表留**一个弹性列**吸收全部多余宽度，其余列一分不动。
   *   订单表 → 商品。它是唯一真在截断的列（实测名字中位 37 字符，
   *            1920 下只放得下 23 个），多给的宽度正好用在刀刃上
   *   日志表 → 读取的页面。同理，URL 路径最长
   * **不做「所有列按比例拉伸」**：时间 / 订单号 / 金额都是定长格式，
   * 拉宽只是让字和字之间空开，不多携带一个字的信息，纯稀释。
   * ===================================================================== */
  var ORD_BASE_COL_W = 812;              /* 1920 设计宽下的单列宽 */
  var ORD_ELASTIC_MIN = 180, LOG_ELASTIC_MIN = 670, LOG_BASE_W = 1640;
  var lastOrdColW = 0, lastLogW = 0;
  var oEi = 4, lEi = 3;                  /* 弹性列下标，下面用 k 校验，改列序不会哑掉 */
  (function () {
    for (var i = 0; i < ORD_COLS.length; i++) if (ORD_COLS[i].k === 'prod') oEi = i;
    for (var j = 0; j < LOG_COLS.length; j++) if (LOG_COLS[j].k === 'path') lEi = j;
  })();

  /* 商品列一个字符占多少 px —— **必须量，不能拍常数**。
   * 展会机是 Bahnschrift / Segoe UI，换台机器会回退到完全不同的字体，
   * 字宽差得远（C 原版写字宽探针就是为这个）。样本取一条真实商品名。 */
  var probeCtx = doc.createElement('canvas').getContext('2d');
  var PROD_SAMPLE = 'Essential Featherweight Canvas Puffer Vest - Slate / L';
  function prodCharPx() {
    var cell = oRows[0] && oRows[0].cells[oEi];
    if (!cell) return 6.96;
    var cs = root.getComputedStyle(cell);
    probeCtx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    var w = probeCtx.measureText(PROD_SAMPLE).width / PROD_SAMPLE.length;
    return w > 1 ? w : 6.96;             /* 字体没就绪时 measureText 会返 0，别拿它算 */
  }

  /** 商品列的字符格数跟着列宽增减（多退少补，不重建整行） */
  function resizeProdSlots(want) {
    for (var i = 0; i < oRows.length; i++) {
      var sp = oRows[i].slots[oEi];
      var cf = oRows[i].cells[oEi].querySelector('.cf');
      if (!sp || !cf) continue;
      while (sp.length > want) cf.removeChild(sp.pop());
      while (sp.length < want) { var e = doc.createElement('span'); cf.appendChild(e); sp.push(e); }
    }
  }

  /** 屏宽变了就重排两张表。同宽则整个跳过 —— resize 会连发几十次。 */
  function applyTableWidths() {
    var ob = doc.getElementById('ordBody'), i, j;
    if (ob && oRows && oRows.length) {
      /* 减去表格左右内缩（CSS 的 --tblPad）。**从 CSS 读而不是再写一个常量** ——
       * 两处各写一份必然有一天对不上，而对不上的表现是「列宽合计 ≠ 行宽」，
       * 也就是右边多出或少掉一条缝，很难一眼看出是哪来的。 */
      var pad = parseFloat(root.getComputedStyle(doc.documentElement)
                  .getPropertyValue('--tblPad')) || 0;
      var colW = Math.max(600, Math.floor((ob.clientWidth - pad * 2 - ORD_GUT) / 2));
      if (colW !== lastOrdColW) {
        lastOrdColW = colW;
        var c = ORD_COLS[oEi];
        /* 弹性列吸收差额。1920 下 colW 会**小于**设计值 812（内缩吃掉 24），
         * 所以这里可能是负增量 —— 给个下限别让商品列缩没。 */
        c.w = Math.max(120, ORD_ELASTIC_MIN + (colW - ORD_BASE_COL_W));
        /* 封顶 64：实测商品名最长 59 字符，再多的格子**永远是空的**，
         * 白占 DOM（每格一个 span × 6 行）又把翻页波拉长。
         * 封顶之后列还是那么宽，多出来的是商品名后面的留白 ——
         * 金额/订单规模仍被推到行右端，整行读起来还是铺满的。 */
        /* ×0.85 是给**窄字符串**留的余量：n 由平均字宽推，全是 'ili' 这类窄字
         * 的名字实际能放下更多，格子先用完就会在像素还够时提前截断。
         * 封顶 64 仍在（商品名最长 59 字符，再多的格子永远是空的）。 */
        c.n = c.sp = Math.min(64, Math.max(8, Math.floor((c.w - 20) / (prodCharPx() * 0.85))));
        recalcSlotOff();                 /* 格数变了，翻页波的格位表跟着变 */
        resizeProdSlots(c.n);
        doc.getElementById('ordPan').style.setProperty('--ordColW', colW + 'px');
        for (i = 0; i < oRows.length; i++) {
          /* 正在翻的行必须掐掉：翻页计划里存着旧的格数，格子已经被增删过了 */
          oRows[i].active = false; oRows[i].fl = null;
          for (j = 0; j < ORD_COLS.length; j++) oRows[i].cells[j].style.width = ORD_COLS[j].w + 'px';
        }
        buildOrdHead();
        renderOrd(true);
      }
    }
    var lb = doc.getElementById('logBody');
    if (lb && cRows && cRows.length) {
      var lpad = parseFloat(root.getComputedStyle(doc.documentElement)
                   .getPropertyValue('--tblPad')) || 0;
      var lw = Math.max(900, lb.clientWidth - lpad * 2);
      if (lw !== lastLogW) {
        lastLogW = lw;
        LOG_COLS[lEi].w = Math.max(200, LOG_ELASTIC_MIN + (lw - LOG_BASE_W));
        for (i = 0; i < cRows.length; i++)
          for (j = 0; j < LOG_COLS.length; j++) cRows[i].cells[j].style.width = LOG_COLS[j].w + 'px';
        buildLogHead();
        renderLog(true);
      }
    }
  }

  /** 一笔订单 → 每列的目标字符串（超长截断加 …，绝不换行） */
  function ordText(o) {
    var d = new Date(o.t);
    var hh = ('0' + d.getHours()).slice(-2), mi = ('0' + d.getMinutes()).slice(-2);
    var ss = ('0' + d.getSeconds()).slice(-2);
    /* 日期去掉了：同屏 6 笔必然都是今天的，月日不携带任何信息。
     * 订单号里仍然带月日（`AP-0825-…`），要查是哪天从那里读。 */
    return [
      hh + ':' + mi + ':' + ss,
      ordNo(o),
      o.store.name,
      '',                                  /* 国家 → 国旗块 */
      o.product,
      '',                                  /* 来自 → 色标块 */
      E.fmtUSD(o.usd),
      ''                                   /* 订单规模 → 徽标块 */
    ];
  }
  /** 国家格：国旗 + 中文国名。国旗认不准时下面那行字兜底 */
  function ccCell(o) {
    var cc = o.store.cc;
    return (root.APFlags ? root.APFlags.svg(cc) : '')
         + '<u>' + (CC_CN[cc] || cc) + '</u>';
  }
  /** 来自格：品牌色 monogram + 平台全名（见 PF_MONO 上面那段合规注释） */
  function srcCell(o) {
    var k = o.platform || 'Others', m = PF_MONO[k] || PF_MONO.Others;
    return '<i style="background:' + m.c + '"><svg viewBox="0 0 24 24">' + m.p + '</svg></i>'
         + '<u>' + (PF_CN[k] || k) + '</u>';
  }
  /* 按**像素**截断（只给 px:1 的列用，现在是商品列）。
   * 为什么不能按字符数：等宽列没问题，但商品列是比例字体 ——
   * 同样 26 个字符，'Alpine Barrier-Repair Pla…' 是 161.6px、
   * 'Nordic Stone-Washed Wool …' 是 187.6px，而可用只有 160px。
   * 字符数截断下**每一行都溢出 1.6~27.6px**，overflow:hidden 把尾巴连省略号
   * 一起切掉 —— 屏上同一列里三种截法：有的带 …、有的只剩半个点、
   * 有的直接断在词中间（实测 6 行全中）。
   * 二分找放得下的最长前缀，给省略号预留宽度，所以 … 一定看得见。 */
  function fitPx(str, px, cell) {
    str = String(str == null ? '' : str);
    if (!cell || !str) return str;
    var cs = root.getComputedStyle(cell);
    probeCtx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    if (probeCtx.measureText(str).width <= px) return str;
    var ell = probeCtx.measureText('…').width, lo = 0, hi = str.length, mid;
    while (lo < hi) {
      mid = (lo + hi + 1) >> 1;
      if (probeCtx.measureText(str.slice(0, mid)).width + ell <= px) lo = mid; else hi = mid - 1;
    }
    return str.slice(0, lo).replace(/\s+$/, '') + '…';
  }
  /** 取这一列该显示的字符串：px 列按像素，其余按字符格数 */
  function colText(c, raw, cell) {
    if (!c.px) return clip(raw, c.n);
    var s = fitPx(raw, c.w - 20, cell);      /* 20 = .c 左右各 10 的内边距 */
    return s.length > c.n ? clip(s, c.n) : s;   /* 格子不够时仍退回字符截断 */
  }
  function clip(s, n) {
    s = String(s == null ? '' : s);
    if (n <= 0) return s;
    if (s.length <= n) return s;
    return s.slice(0, Math.max(0, n - 1)) + '…';
  }
  /** 直接落位（不翻页）：预铺、筛选重建、排序重建都走这条 */
  function setRow(r, o) {
    r.o = o;
    r.active = false; r.fl = null;
    r.el.classList.remove('enter', 'hot', 'big');
    if (!o) { r.el.style.visibility = 'hidden'; return; }
    r.el.style.visibility = '';
    var big = (o.tier === 'epic' || o.tier === 'legendary');
    var hot = big || o.tier === 'rare';
    if (hot) r.el.classList.add('hot');
    if (big) r.el.classList.add('big');
    var tx = ordText(o), i, j;
    for (i = 0; i < ORD_COLS.length; i++) {
      var c = ORD_COLS[i];
      if (c.n > 0) {
        var s = colText(c, tx[i], r.cells[i]), sp = r.slots[i];
        for (j = 0; j < c.n; j++) {
          sp[j].textContent = j < s.length ? s.charAt(j) : '';
          sp[j].style.transform = '';
        }
      } else {
        var b = r.blocks[i];
        b.style.transform = '';
        if (c.k === 'cc') b.innerHTML = ccCell(o);
        else if (c.k === 'src') b.innerHTML = srcCell(o);
        else if (c.k === 'tier') {
          b.innerHTML = '<span class="tag ' + (TIER_K[o.tier] || 't1') + '">'
            + (TIER_CN[o.tier] || '') + '</span>';
        }
      }
    }
  }

  /* ── split-flap：每格自己一套 { 起飞时刻, 翻几次, 当前第几次 } ─────────────
   * 逐格 stagger → 左边先落位、右边还在翻，机场牌的读法就是这么来的。 */
  function drumOf(ch) {
    if (ch >= '0' && ch <= '9') return CLS_D;
    if (ch >= 'A' && ch <= 'Z') return CLS_U;
    if (ch >= 'a' && ch <= 'z') return CLS_L;
    if (ch.charCodeAt(0) > 0x2E80) return CLS_CJK;
    return null;                     /* 标点 / 空白：不换字，只做机械翻转 */
  }
  function startFlip(r, o, lead, waveBase) {
    /* 节奏按**新到的那一笔**（lead）的档位定，不按本行自己的 ——
     * 一块板必须是同一个手感；各行按各自档位算会翻得参差不齐，像坏了。 */
    var big = (lead.tier === 'epic' || lead.tier === 'legendary');
    var hot = big || lead.tier === 'rare';
    var stagger = boardStagger(hot);
    r.dur = hot ? STEP_HOT : STEP;
    r.seed = ((parseInt(String(o.id).replace(/\D/g, ''), 10) || 1) * 2654435761) >>> 0;
    var tx = ordText(o), i, j;
    r.fl = [];
    for (i = 0; i < ORD_COLS.length; i++) {
      var c = ORD_COLS[i], base = waveBase + ORD_SLOT_OFF[i];
      if (c.n <= 0) {
        /* 图标格（国旗 / 色标 / 规模徽标）：整格当一个翻板，翻 3~4 次落位。
         * 内容 setRow 已经落好，翻的过程中不换 —— 翻板侧立时本来就读不到。
         * 起飞时刻取这一列的中点，波扫到列中央时它翻，读起来是连续的。 */
        r.fl.push([{ at: (base + (c.sp >> 1)) * stagger,
                     n: 3 + ((E.hash32(r.seed + i * 37, 7013) * 2) | 0),
                     k: -1, drum: null, tg: null, block: true, done: false }]);
        continue;
      }
      var s2 = colText(c, tx[i], r.cells[i]), arr = [];
      for (j = 0; j < c.n; j++) {
        var ch = j < s2.length ? s2.charAt(j) : '';
        var nf;
        if (ch === '' || ch === ' ') nf = 0;                   /* 空白不翻，直接落位 */
        else nf = (hot ? 5 : 3) + ((E.hash32(r.seed + (base + j) * 17, 7001) * 3) | 0);
        arr.push({ at: (base + j) * stagger, n: nf, k: -1,
                   drum: drumOf(ch || 'x'), tg: ch, block: false, done: nf === 0 });
        if (nf === 0) { r.slots[i][j].textContent = ch; r.slots[i][j].style.transform = ''; }
      }
      r.fl.push(arr);
    }
    r.t0 = clock; r.active = true;
  }

  /* ── 整块板一起翻 ─────────────────────────────────────────────────────────
   * 原来只有第 0 行翻，其余五行靠整表 translate3d 下移顶上去。
   * 问题是**订单 55 秒才来一笔**：单行翻 1.9 秒之后整块板就彻底静止，
   * 读起来是「有一行闪了一下」，不是机场牌。
   *
   * 真实机场牌撤下一个航班时，下面每一行都要往上顶一位，于是**整块板从左到右
   * 哗啦一片翻过去** —— 那一片才是这个效果的记忆点。这里照这个来：
   *   · 6 行全翻。这不是为了效果硬翻：位序整体后移一位，6 行内容确实全变了
   *   · 波从最左一格扫到最右一格，**跨过中间 16px 沟槽继续往右**
   *     （右列的波基址 = 左列整整一行的格数），两列读成一块完整的板
   *   · 三行同相位，只错开 2 格 —— 看到的是一条竖直的翻转带在横扫，
   *     整齐本身就是机械感的来源；错太开会散成一片噪点
   * 顺带解决了列优先布局的一个死结：左列最后一行要挪到右列第一行，
   * 那是个对角跳，任何位移动画都会很难看。翻牌把这一跳藏在翻转里了。 */
  function boardWave(i) {
    return ((i / ORD_PER_COL) | 0) * ORD_SLOT_TOTAL + (i % ORD_PER_COL) * 2;
  }
  function startBoardFlip(v, lead) {
    for (var i = 0; i < ORD_ROWS; i++) {
      var r = oRows[i];
      if (!v[i]) { r.active = false; r.fl = null; continue; }
      startFlip(r, v[i], lead, boardWave(i));
    }
  }
  function updateFlips() {
    for (var q = 0; q < ORD_ROWS; q++) {
      var r = oRows[q];
      if (!r.active) continue;
      var total = 0, done = 0, i, j;
      for (i = 0; i < ORD_COLS.length; i++) {
        var arr = r.fl[i];
        if (!arr) continue;
        for (j = 0; j < arr.length; j++) {
          var f = arr[j]; total++;
          if (f.done) { done++; continue; }
          var sp = f.block ? r.blocks[i] : r.slots[i][j];
          var e = clock - r.t0 - f.at;
          if (e < 0) continue;                                  /* 还没轮到这一格 */
          var k = (e / r.dur) | 0;
          if (k >= f.n) {                                       /* 落位：清 transform */
            if (!f.block) sp.textContent = f.tg;
            sp.style.transform = '';
            f.done = true; done++;
            continue;
          }
          if (f.k !== k && !f.block) {                          /* 整格翻板不换内容 */
            f.k = k;
            if (f.drum) {
              sp.textContent = f.drum.charAt(
                (E.hash32(r.seed + (ORD_SLOT_OFF[i] + j) * 7 + k * 131, 4099) * f.drum.length) | 0);
            } else {
              sp.textContent = f.tg;
            }
          }
          /* 翻板下落：从近乎侧立(-76°)加速拍到 0°，落地即停。无回弹。 */
          var p = (e - k * r.dur) / r.dur;
          sp.style.transform =
            'perspective(' + PERSP + 'px) rotateX(' + (-TILT * (1 - p * p)).toFixed(2) + 'deg)';
        }
      }
      if (done >= total) { r.active = false; r.fl = null; }
    }
  }

  /** 渲染订单表。rebuild=true 走整表直接落位；否则只有第 0 行翻页 + 整表下移。 */
  function renderOrd(rebuild) {
    var v = ordView(), i;
    ordEmpty.classList.toggle('on', v.length === 0);
    /* 「共 N 笔」这个副标已去掉（产品要求）。筛选反馈仍然有：筛选器高亮、
     * 「清空筛选」从禁用变可用、行数变化、空态提示；完整统计在「AI 订单」页。 */
    for (i = 0; i < ORD_ROWS; i++) setRow(oRows[i], v[i] || null);
    if (rebuild) layoutOrd(true);
  }
  /** 新订单到达 */
  function pushOrder(o, instant) {
    tuneAutoTier(o);
    if (seenIds[o.id]) return;
    seenIds[o.id] = 1; seenN++;
    if (seenN > 4000) { seenIds = {}; seenN = 0; }

    applyShop(o);
    applyFeed(o);          /* 行业先定下来，商品名才能选对品类池 */
    ordBuf.push(o);
    if (ordBuf.length > ORD_BUF) ordBuf.splice(0, ordBuf.length - ORD_BUF);
    refreshFilterOpts();

    if (instant) { renderOrd(true); return; }

    var pass = ordMatch(o);
    if (!pass || !isFeedMode()) {
      /* 被筛掉、或用户改了排序 —— 不做顶部插入动画，静默并入 */
      renderOrd(true);
      afterOrder(o);
      return;
    }
    /* 内容先按新视图全部落位，再整块板一起翻（见 startBoardFlip）。
     * 原来那段「整表先上移一格再带过渡归位」的位移动画**整个删了**：
     * 列优先布局下左列末行要跳到右列首行，那是对角跳，位移表达不了。 */
    var v = ordView();
    for (var i = 0; i < ORD_ROWS; i++) setRow(oRows[i], v[i] || null);
    ordEmpty.classList.remove('on');
    layoutOrd(true);
    startBoardFlip(v, o);
    oRows[0].el.classList.remove('enter');
    void oRows[0].el.offsetWidth;
    oRows[0].el.classList.add('enter');
    afterOrder(o);
  }
  /** 一笔订单的所有副作用（打点 / 播报 / 横幅 / 声音 / 占比） */
  function afterOrder(o) {
    var p = addHit(o.buyerLon, o.buyerLat, 'order');
    if (p && OPT.mapPop) popOrder(o, p[0], p[1]);
    showGmvDelta(o);
    if (orderCountsInDisplay(o)) {
      tallyChannel(o.platform);
      tallyMarket(o.store.cc, o.usd);
    }
    /* 大额成交走全屏礼花（约每 6 分钟一次：epic+ 占 15%，订单 1.1 笔/分钟）。
     * 每笔大单都全屏一次的话，3 分钟后就没人抬头了。
     * 两个闸门都来自设置页：总开关 + 金额门槛。关掉礼花仍然出横幅，
     * 不能让「关掉庆祝」变成「大单静默」。 */
    if (o.tier === 'epic' || o.tier === 'legendary') {
      if (OPT.celebrate && o.usd >= OPT.celebMin) showCelebrate(o);
      else showBanner(o);
    }
    if (A) { try { A.playOrder(o); } catch (e) {} }
  }

  /* =====================================================================
   * AI 读取日志：8 行，纯文本（不翻页），渐入 + 顶部插入。
   * 上屏做了降采样 —— 见文件头第 2 条。
   * ===================================================================== */
  var logBody = doc.getElementById('logBody'), logEmpty = doc.getElementById('logEmpty');
  var cRows = [], logSkip = 0;

  function buildLogHead() {
    var head = doc.getElementById('logHead'), i, el;
    head.style.height = '32px';
    head.innerHTML = '';        /* 宽屏自适应会重入这个函数，不清空就会叠出两套表头 */
    for (i = 0; i < LOG_COLS.length; i++) {
      el = doc.createElement('div');
      el.className = 'c' + (LOG_COLS[i].cls === 'r' ? ' r' : '');
      el.style.width = LOG_COLS[i].w + 'px';
      el.textContent = LOG_COLS[i].h;
      head.appendChild(el);
    }
  }
  function buildLogRows() {
    for (var i = 0; i < LOG_ROWS; i++) {
      var el = doc.createElement('div');
      el.className = 'crow';
      var cells = [];
      for (var j = 0; j < LOG_COLS.length; j++) {
        var cd = doc.createElement('div');
        cd.className = 'c ' + LOG_COLS[j].cls;
        cd.style.width = LOG_COLS[j].w + 'px';
        /* AI 助手那格放两段：品牌名（商家认得）+ 灰色小字的程序名（真实感来源，
         * 看过自家 access log 的商家会认出 GPTBot / ClaudeBot） */
        if (LOG_COLS[j].k === 'bot') cd.innerHTML = '<span class="pf"></span><span class="bt"></span>';
        cells.push(cd); el.appendChild(cd);
      }
      logBody.appendChild(el);
      cRows.push({ el: el, cells: cells, c: null });
    }
  }
  /* ── 日志滚动：**逐帧缓动**，不用 CSS transition ──────────────────────────
   * 原来是「整表无过渡上移一格 → 再带 220ms linear 归位」。三个毛病：
   *   ① 上屏 1.5 行/秒 = 每 667ms 才动一次，220ms 动完剩 447ms 静止 ——
   *      占空比只有 33%，读起来是一顿一顿的，不是流动
   *   ② linear 收尾不减速，每一步都「啪」地停住
   *   ③ 按 3 速时行间隔缩到 222ms，比 transition 还短，那句 `transition:none`
   *      会把正在飞的动画**硬生生掐断** —— 直接跳一格（速度越快越难看）
   *
   * 改成 JS 逐帧指数缓动：新行到达只是把整轨的视觉偏移 -= LOG_H，
   * 之后每帧向 0 逼近。多行连着到就是累加，永远不会掐断，3 速下只是逼得快一点。
   * 步长走 E.dt() 而不是固定值 —— 掉帧时速度不变（规格 §8 的要求）。 */
  var logY = 0;
  var LOG_EASE = 0.0008;      /* 每秒剩余比例；约 380ms 收敛到 5% 以内 */

  function placeLogRows() {
    for (var i = 0; i < LOG_ROWS; i++) {
      var r = cRows[i];
      if (!r.c) { r.el.style.opacity = '0'; continue; }
      var y = i * LOG_H + logY;
      r.el.style.transform = 'translate3d(0,' + y.toFixed(2) + 'px,0)';
      /* 透明度跟着**视觉位置**走，不是行号。按行号算的话，新行在滑进来的
       * 整个过程里保持满亮度、到位那一刻旁边的行才突然变暗 ——
       * 亮度是跳的而位移是连续的，两者对不上就显得脏。
       *   y < 0（还在顶沿上方）：淡入
       *   y > 0（越往下越旧）：按行龄渐隐，底部自然收口 */
      var fadeIn = y < 0 ? Math.max(0, 1 + y / LOG_H) : 1;
      var age = 1 - Math.max(0, y) / (LOG_ROWS * LOG_H) * 0.62;
      r.el.style.opacity = (fadeIn * age).toFixed(3);
    }
  }
  /** 每帧推进。dtMs 用引擎的 dt（已钳制在 100ms），不自己算差值 */
  function tickLogScroll(dtMs) {
    if (logY === 0) return;
    logY *= Math.pow(LOG_EASE, Math.max(0, dtMs) / 1000);
    if (Math.abs(logY) < 0.08) logY = 0;    /* 收口，免得永远逼近不到 */
    placeLogRows();
  }
  function layoutLog(instant) {
    if (instant) logY = 0;
    placeLogRows();
  }
  function setLogRow(r, c) {
    r.c = c;
    if (!c) { r.el.style.visibility = 'hidden'; return; }
    r.el.style.visibility = '';
    var d = new Date(c.t);
    var v = [
      ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':'
        + ('0' + d.getSeconds()).slice(-2) + '.' + ('00' + d.getMilliseconds()).slice(-3),
      null,
      c.store ? c.store.name : '',
      c.path || '',
      c.status === 304 ? '内容未变' : '已读取',
      (c.ms || 0) + 'ms',
      c.dcCity || ''
    ];
    for (var i = 0; i < LOG_COLS.length; i++) {
      if (v[i] === null) continue;
      r.cells[i].textContent = v[i];
    }
    var pf = r.cells[1].querySelector('.pf'), bt = r.cells[1].querySelector('.bt');
    if (pf) pf.textContent = BOT_CN[c.bot] || PF_CN[c.platform] || c.platform || '';
    if (bt) bt.textContent = c.bot || '';
    r.cells[4].className = 'c ' + (c.status === 304 ? 'st304' : 'st200');
  }
  function renderLog(instant) {
    var v = logView(), i;
    logEmpty.classList.toggle('on', v.length === 0);
    for (i = 0; i < LOG_ROWS; i++) setLogRow(cRows[i], v[v.length - 1 - i] || null);
    layoutLog(instant);
  }
  function pushCrawl(c) {
    /* 数据层照全速收（地图打点要它），只是上屏降采样 */
    applyShop(c);
    applyFeed(c);
    logBuf.push(c);
    if (logBuf.length > LOG_BUF) logBuf.splice(0, logBuf.length - LOG_BUF);
    if (crawlHitBudget > 0) { crawlHitBudget--; addHit(c.dcLon, c.dcLat, 'crawl'); }
    if (logPaused) return;
    if (!logMatch(c)) return;
    logSkip++;
    /* **冷启动先填满，填满之后才降采样。**
     * logBuf 并不预填历史（它也是从空开始按 9 条/秒灌的），所以 logShown
     * 一上来就按 1/6 抽的话，7 行要 7×6÷9 ≈ 4.7 秒才填满 ——
     * 开机那几秒日志面板下面空一大片（实测：2 秒时只有 3 行）。
     * 改之前不存在这个问题：那时直接取 logBuf 末 7 条，0.78 秒就满了。
     * 所以未满之前每条都上屏，满了之后回到「每 6 条上屏 1 条」的正常节奏。 */
    if (logShown.length >= LOG_ROWS && logSkip % LOG_EVERY !== 0) return;
    logShown.push(c);
    if (logShown.length > LOG_ROWS + 4) logShown.splice(0, logShown.length - (LOG_ROWS + 4));

    var v = logView(), i;
    logEmpty.classList.remove('on');
    for (i = 0; i < LOG_ROWS; i++) setLogRow(cRows[i], v[v.length - 1 - i] || null);
    /* 顶部插入：内容已经整体下移一位，所以把整轨的视觉偏移**往回拉一格**，
     * 剩下的交给 tickLogScroll 每帧缓动归零 —— 没有 reflow、没有 transition 掐断。
     * 累加而不是赋值：3 速下一帧可能到好几行，赋值会把前面几行的位移吞掉。
     * 封顶两格 —— 再多就是「一次滑过大半屏」，反而看不清。 */
    logY = Math.max(-LOG_H * 2, logY - LOG_H);
    placeLogRows();
  }

  /* =====================================================================
   * 渠道 / 国家占比
   *   渠道用引擎的 platformBreakdown()（权威权重），不再拿 peekOrders 取样估 ——
   *   peekOrders 有 62 笔硬上限，实测 Google 会算成 4.8% 而真实权重是 14%。
   *   国家基数用 APGeo.MARKETS 自带的 weight（金额是重尾分布，取样会让权重 6 的
   *   加拿大掉到 1%，屏上一眼就不对）。两边的增量都走真实订单，所以是活的。
   * ===================================================================== */
  var chanKeys = [], chanCount = {}, chanEl = {};
  var mktKeys = [], mktUsd = {}, MKT_TOP = 5;

  /** 基数按**当前时间范围**算。原先写死用全量口径，于是顶栏选「开幕至今」时
   *  KPI 卡显示 44 万而饼图中心显示 4159 万 —— 同一屏两个口径，商家一定会问。
   *  切换口径时重算这里（键不变，所以不用重建 DOM）。 */
  function recomputeBase() {
    var m = E.metrics(), i;
    /* 走统一出口，别再直接读 m.session.* —— 见 DISP 那段注释 */
    var ordersNow = Math.floor(displayOrders(m));
    var gmvNow = displayGmv(m);

    var pb = [];
    try { pb = E.platformBreakdown() || []; } catch (e) { pb = []; }
    if (pb.length) {
      pb = pb.slice().sort(function (a, b) { return b.share - a.share; });
      chanKeys = [];
      for (i = 0; i < pb.length; i++) {
        chanKeys.push(pb[i].platform);
        chanCount[pb[i].platform] = Math.round(pb[i].share * ordersNow);
      }
    } else {
      chanKeys = ['ChatGPT', 'Google', 'Claude', 'Perplexity', 'Others'];
      for (i = 0; i < chanKeys.length; i++) chanCount[chanKeys[i]] = Math.round(ordersNow / 5);
    }

    /* 国家基数用**真实客户报表的店铺家数分布**（APShops.CC），
     * 不再用 APGeo.MARKETS 的权重 —— 那套里连 CN / HK / PK / IN 都没有，
     * 而真实客户里这四个加起来占 17.6%。
     * 金额是重尾分布，所以基数只能靠分布权重算，不能拿 62 笔取样估。 */
    var mt = {}, tot = 0, RCC = root.APShops && root.APShops.CC;
    if (RCC) {
      for (var k2 in RCC) if (Object.prototype.hasOwnProperty.call(RCC, k2) && countryAllowed(k2)) {
        mt[k2] = RCC[k2]; tot += RCC[k2];
      }
    }
    if (!tot) {
      try {
        for (i = 0; i < Geo.MARKETS.length; i++) {
          if (!countryAllowed(Geo.MARKETS[i].cc)) continue;
          mt[Geo.MARKETS[i].cc] = Geo.MARKETS[i].weight; tot += Geo.MARKETS[i].weight;
        }
      } catch (e) { mt = {}; tot = 0; }
    }
    if (!tot) { mt = { US: 34, GB: 9, DE: 9, FR: 6, CA: 6 }; tot = 64; }
    mktKeys = Object.keys(mt).sort(function (a, b) { return mt[b] - mt[a]; }).slice(0, MKT_TOP);
    for (i = 0; i < mktKeys.length; i++) mktUsd[mktKeys[i]] = mt[mktKeys[i]] / tot * gmvNow;
    var used = 0;
    for (i = 0; i < mktKeys.length; i++) used += mt[mktKeys[i]];
    mktUsd.__OTHER = Math.max(0, (tot - used) / tot * gmvNow);
  }
  function initTallies() {
    recomputeBase();
    buildBars('chanBody', chanKeys, chanEl, function (k) { return PF_CN[k] || k; }, false);
    buildPie(mktKeys.concat(['__OTHER']));
    updateTallies();
  }

  /* ── 国家 / 地区甜甜圈图 ───────────────────────────────────────────────
   * 扇区与图例双向联动：hover 任一侧，另一侧同步高亮、其余压暗，
   * 中心从「总成交额」切成该国的名字 + 占比。
   * 扇区 path 建一次就不再增删（DOM 恒定），每次只改 d / fill。 */
  var NS = 'http://www.w3.org/2000/svg';
  var PIE_CX = 79, PIE_CY = 79, PIE_R2 = 68, PIE_R1 = 40, PIE_OUT = 5;
  var pieArcs = doc.getElementById('pieArcs'), pieLg = doc.getElementById('pieLg');
  var pieC1 = doc.getElementById('pieC1'), pieC2 = doc.getElementById('pieC2');
  var pieC3 = doc.getElementById('pieC3');
  var pieCC = doc.getElementById('pieCC');      /* 国家数：列头，不在内圈里 */
  var chanNote = doc.getElementById('chanNote');  /* 渠道 hover 详情：也在列头 */
  var pieItems = [], pieHover = -1;

  function arcPath(a0, a1, r1, r2, ox, oy) {
    var large = (a1 - a0) > Math.PI ? 1 : 0;
    var cx = PIE_CX + ox, cy = PIE_CY + oy;
    var x1 = cx + r2 * Math.cos(a0), y1 = cy + r2 * Math.sin(a0);
    var x2 = cx + r2 * Math.cos(a1), y2 = cy + r2 * Math.sin(a1);
    var x3 = cx + r1 * Math.cos(a1), y3 = cy + r1 * Math.sin(a1);
    var x4 = cx + r1 * Math.cos(a0), y4 = cy + r1 * Math.sin(a0);
    return 'M' + x1.toFixed(2) + ' ' + y1.toFixed(2)
      + 'A' + r2 + ' ' + r2 + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2)
      + 'L' + x3.toFixed(2) + ' ' + y3.toFixed(2)
      + 'A' + r1 + ' ' + r1 + ' 0 ' + large + ' 0 ' + x4.toFixed(2) + ' ' + y4.toFixed(2) + 'Z';
  }
  function buildPie(keys) {
    pieArcs.innerHTML = ''; pieLg.innerHTML = '';
    pieItems = [];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var pa = doc.createElementNS(NS, 'path');
      pieArcs.appendChild(pa);
      var lr = doc.createElement('div');
      lr.className = 'lr';
      lr.innerHTML = '<span class="sw"></span><span class="nm"></span><span class="pc"></span>';
      lr.querySelector('.nm').textContent = (k === '__OTHER') ? '其他' : (CC_CN[k] || k);
      pieLg.appendChild(lr);
      pieItems.push({ key: k, arc: pa, lr: lr, sw: lr.querySelector('.sw'),
                      pc: lr.querySelector('.pc'), a0: 0, a1: 0, val: 0, share: 0 });
      (function (idx) {
        pa.addEventListener('mouseenter', function () { setPieHover(idx); });
        pa.addEventListener('mouseleave', function () { setPieHover(-1); });
        lr.addEventListener('mouseenter', function () { setPieHover(idx); });
        lr.addEventListener('mouseleave', function () { setPieHover(-1); });
      })(i);
    }
  }
  function paintPie() {
    if (!pieItems.length) return;
    var pal = themeVal('pie') || ['#888'];
    var tot = 0, i, it;
    for (i = 0; i < pieItems.length; i++) {
      it = pieItems[i];
      it.val = mktUsd[it.key] || 0;
      tot += it.val;
    }
    var a = -Math.PI / 2;      /* 从 12 点方向起，顺时针 */
    for (i = 0; i < pieItems.length; i++) {
      it = pieItems[i];
      it.share = tot ? it.val / tot : 0;
      it.a0 = a; it.a1 = a + it.share * Math.PI * 2;
      a = it.a1;
      var col = pal[Math.min(i, pal.length - 1)];
      it.arc.setAttribute('fill', col);
      it.sw.style.background = col;
      it.pc.textContent = (it.share * 100).toFixed(1) + '%';
      /* 占比为 0 的项不画扇区，但图例保留（后台不该让一行凭空消失） */
      it.arc.setAttribute('d', it.share > 0.0005 ? arcPath(it.a0, it.a1, PIE_R1, PIE_R2, 0, 0) : '');
    }
    if (pieHover >= 0) applyPieHover(); else resetPieCenter(tot);
  }
  function resetPieCenter(tot) {
    if (tot === undefined) {
      tot = 0;
      for (var i = 0; i < pieItems.length; i++) tot += pieItems[i].val;
    }
    pieC1.innerHTML = numTspans(E.fmtUSD(tot).replace(/\.\d+$/, ''));
    pieC2.textContent = '总成交额';
    /* 第三行留空：国家数搬到列头的 #pieCC 去了（在内圈里它会压到扇区上）。
     * 仍然保留这个 text 节点 —— hover 态要用它显示该国金额，两态都是三行才不跳。 */
    pieC3.textContent = '';
    if (pieCC) pieCC.textContent = pieItems.length ? (pieItems.length + ' 个国家 / 地区') : '';
  }
  /* 把金额 / 百分比里的符号包进 tspan，好让 CSS 单独给它们设字号（见 index.html
   * 的 #pie .ctr .p）。SVG 文本没有别的办法给一段字单独改大小 —— 这也是这里
   * 用 innerHTML 而不是 textContent 的唯一原因。入参只可能是 fmtUSD 的输出或
   * toFixed 的百分比，全是数字与 $,.% ，不含需要转义的字符。 */
  function numTspans(str) {
    var out = '', run = '', i, ch;
    for (i = 0; i < str.length; i++) {
      ch = str.charAt(i);
      if ('$,.%'.indexOf(ch) >= 0) {
        if (run) { out += run; run = ''; }
        out += '<tspan class="p">' + ch + '</tspan>';
      } else run += ch;
    }
    return out + run;
  }

  function applyPieHover() {
    var it = pieItems[pieHover];
    if (!it) return;
    pieC1.innerHTML = numTspans((it.share * 100).toFixed(1) + '%');
    pieC2.textContent = (it.key === '__OTHER' ? '其他' : (CC_CN[it.key] || it.key));
    pieC3.innerHTML = numTspans(E.fmtUSD(it.val).replace(/\.\d+$/, ''));
  }
  function setPieHover(i) {
    pieHover = i;
    for (var j = 0; j < pieItems.length; j++) {
      var it = pieItems[j], on = (j === i);
      it.arc.classList.toggle('dim', i >= 0 && !on);
      it.lr.classList.toggle('dim', i >= 0 && !on);
      it.lr.classList.toggle('on', on);
      /* 高亮的扇区沿角平分线往外挪 —— 比单纯提亮更容易看出是哪一块 */
      if (on && it.share > 0.0005) {
        var mid = (it.a0 + it.a1) / 2;
        it.arc.setAttribute('d', arcPath(it.a0, it.a1, PIE_R1, PIE_R2,
          Math.cos(mid) * PIE_OUT, Math.sin(mid) * PIE_OUT));
      } else if (it.share > 0.0005) {
        it.arc.setAttribute('d', arcPath(it.a0, it.a1, PIE_R1, PIE_R2, 0, 0));
      }
    }
    if (i >= 0) applyPieHover(); else resetPieCenter();
  }
  /* ── 渠道占比条：hover + 点击筛选 ──────────────────────────────────────
   * 这张卡原先是纯展示的死卡片：五行条子既不响应 hover 也不能点，
   * 而右边的甜甜圈就在同一个面板里、行为完整 —— 同一屏两种交互约定，
   * 商家试过饼图之后必然会来点这边。
   *
   * 现在和饼图对齐：
   *   hover → 该行高亮、其余压暗，列头显示「渠道 · N 笔 · 占比」
   *   点击 → 真的把订单表按这个渠道筛掉（等价于选 fSrc 下拉），再点取消
   * 详情放列头而不是行内：行宽只有 74 + 条 + 44，塞不进第四个字段。 */
  var chanHover = -1, chanRows = {};

  function chanDetail() {
    if (!chanNote) return;
    if (chanHover < 0 || !chanKeys[chanHover]) {
      chanNote.textContent = '';
      return;
    }
    var k = chanKeys[chanHover], tot = 0;
    for (var i = 0; i < chanKeys.length; i++) tot += chanCount[chanKeys[i]] || 0;
    var n = chanCount[k] || 0;
    chanNote.textContent = (PF_CN[k] || k) + ' · ' + n + ' 笔 · '
      + (tot ? (n / tot * 100).toFixed(1) : '0.0') + '%';
  }
  function setChanHover(i) {
    chanHover = i;
    for (var j = 0; j < chanKeys.length; j++) {
      var e = chanRows[chanKeys[j]];
      if (!e) continue;
      e.row.classList.toggle('dim', i >= 0 && j !== i);
      e.row.classList.toggle('hi', i >= 0 && j === i);
    }
    chanDetail();
  }
  /** 标出「当前订单表正按哪个渠道筛」——选中态要能在不 hover 的时候看见 */
  function markChanSel() {
    for (var j = 0; j < chanKeys.length; j++) {
      var e = chanRows[chanKeys[j]];
      if (e) e.row.classList.toggle('on', oF.src.indexOf(chanKeys[j]) >= 0);
    }
  }
  /* 渠道卡点击 = 在 src 集合里增删一项。它和筛选面板是**同一份状态的两个视图**，
   * 所以这里改完必须把面板里的勾选也刷一遍，否则两处显示互相矛盾。 */
  function toggleChanFilter(k) {
    var i = oF.src.indexOf(k);
    if (i >= 0) oF.src.splice(i, 1); else oF.src.push(k);
    markFilterChips(); markChanSel(); syncFilterPop(); renderOrd(true);
  }

  function buildBars(hostId, keys, store, label, withOther) {
    var host = doc.getElementById(hostId);
    host.innerHTML = '';
    var list = keys.slice();
    if (withOther) list.push('__OTHER');
    var clickable = (hostId === 'chanBody');
    for (var i = 0; i < list.length; i++) {
      var k = list[i];
      var row = doc.createElement('div');
      row.className = 'rr' + (clickable ? ' hit' : '');
      row.innerHTML = '<span class="nm"></span><span class="bar"><u></u></span><span class="pc"></span>';
      row.querySelector('.nm').textContent = k === '__OTHER' ? '其他' : label(k);
      host.appendChild(row);
      store[k] = { bar: row.querySelector('u'), pc: row.querySelector('.pc'), row: row };
      if (clickable) {
        chanRows[k] = store[k];
        row.title = '点击只看这个 Agentic Page 带来的订单';
        (function (idx, key) {
          row.addEventListener('mouseenter', function () { setChanHover(idx); });
          row.addEventListener('mouseleave', function () { setChanHover(-1); });
          row.addEventListener('click', function () { toggleChanFilter(key); });
        })(i, k);
      }
    }
    if (clickable) { markChanSel(); chanDetail(); }
  }
  function tallyChannel(pf) {
    pf = pf || 'Others';
    if (chanCount[pf] === undefined) return;
    chanCount[pf]++;
  }
  function tallyMarket(cc, usd) {
    if (!countryAllowed(cc)) return;
    if (mktUsd[cc] !== undefined) mktUsd[cc] += usd;
    else mktUsd.__OTHER += usd;
  }
  function updateTallies() {
    var i, k, tot = 0;
    for (i = 0; i < chanKeys.length; i++) tot += chanCount[chanKeys[i]] || 0;
    for (i = 0; i < chanKeys.length; i++) {
      k = chanKeys[i];
      var sh = tot ? (chanCount[k] || 0) / tot : 0;
      if (chanEl[k]) {
        chanEl[k].bar.style.width = (sh * 100).toFixed(1) + '%';
        chanEl[k].pc.textContent = (sh * 100).toFixed(1) + '%';
      }
    }
    chanDetail();      /* hover 中时数字也要跟着涨，不能停在 hover 那一刻 */
    paintPie();
  }

  /* =====================================================================
   * 筛选器 / 搜索 / 清空
   * ===================================================================== */
  var qEl = doc.getElementById('q');
  var lastSrcOpts = '', lastCCOpts = '';

  function fillSel(sel, opts, allLabel) {
    var keep = sel.value, i, html = '<option value="">' + allLabel + '</option>';
    for (i = 0; i < opts.length; i++) {
      html += '<option value="' + opts[i][0] + '">' + opts[i][1] + '</option>';
    }
    sel.innerHTML = html;
    sel.value = keep;
    if (sel.value !== keep) sel.value = '';       /* 选中的项没了就回落到「全部」 */
  }
  /** 下拉选项跟着数据长 —— 后台不该列出一个「筛完是空」的选项 */
  /* ── 订单筛选浮层 ─────────────────────────────────────────────────────────
   * 三个 <select> 浓缩成「筛选」一个按钮，点开是勾选面板（多选）。
   *
   * **浮层挂在 #content 下，不在面板里** —— `.pan` 是 overflow:hidden
   * （表体靠它裁剪），放进 42px 高的面板头里会被整个裁掉，一点都露不出来。
   * 代价是位置得自己算：每次打开按按钮的实际位置摆一次。
   *
   * 位置用 offsetLeft/offsetTop 一路加到 #content，**不用 getBoundingClientRect**：
   * #stage 上有 scale()，getBoundingClientRect 给的是缩放后的值，
   * 而这里要写回的是缩放前的布局像素，混用会在非 1920 宽度上偏掉。 */
  /* 两份配置：订单表一份、读取日志一份。**抽成配置驱动而不是复制一遍** ——
   * 开关、定位、外点关闭、Esc、勾选同步这些逻辑两处一模一样，
   * 复制的话以后改一处必然漏掉另一处。 */
  var FP = {
    ord: { pop: 'filterPop', btn: 'btnFilter', badge: 'fCount', cnt: 'fpN',
           w: 452, unit: '笔', keys: ['src', 'cc', 'tier'],
           opts: { src: [], cc: [],
                   tier: [['common', '普通'], ['rare', '较大'],
                          ['epic', '大额'], ['legendary', '特大']] },
           st: function () { return oF; },
           n:  function () { return ordView().length; },
           after: function () { markChanSel(); renderOrd(true); } },
    log: { pop: 'logFilterPop', btn: 'btnLogFilter', badge: 'lCount', cnt: 'lpN',
           w: 296, unit: '条', keys: ['bot', 'st'],
           opts: { bot: [['ChatGPT', 'ChatGPT'], ['Claude', 'Claude'],
                         ['Google', 'Google'], ['Perplexity', 'Perplexity']],
                   st: [['200', '已读取'], ['304', '内容未变']] },
           st_: null,
           st: function () { return lF; },
           n:  function () { return logMatchCount(); },
           after: function () { rebuildLogShown(); renderLog(true); } }
  };

  function fpList(cfg, k) {
    var host = doc.querySelector('#' + cfg.pop + ' .fl[data-k="' + k + '"]');
    if (!host) return;
    var list = cfg.opts[k], html = '', i;
    for (i = 0; i < list.length; i++) {
      html += '<label class="fo"><input type="checkbox" value="' + list[i][0] + '">'
            + '<i></i><span>' + list[i][1] + '</span></label>';
    }
    host.innerHTML = html || '<div class="fnone">暂无</div>';
    fpSync(cfg);
  }
  /** 把集合状态刷进勾选框。渠道卡 / 清空 / 诊断口改了状态都要调 */
  function fpSync(cfg) {
    var st = cfg.st(), g, i;
    for (g = 0; g < cfg.keys.length; g++) {
      var host = doc.querySelector('#' + cfg.pop + ' .fl[data-k="' + cfg.keys[g] + '"]');
      if (!host) continue;
      var box = host.querySelectorAll('input');
      for (i = 0; i < box.length; i++) {
        box[i].checked = st[cfg.keys[g]].indexOf(box[i].value) >= 0;
        box[i].parentNode.classList.toggle('on', box[i].checked);
      }
    }
    var nEl = doc.getElementById(cfg.cnt);
    if (nEl) nEl.textContent = '符合 ' + cfg.n() + ' ' + cfg.unit;
  }
  /** 元素相对某个祖先的布局坐标（绕开 #stage 的 scale） */
  function offsetIn(el, root) {
    var x = 0, y = 0;
    while (el && el !== root) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; }
    return [x, y];
  }
  function fpOpen(cfg, on) {
    var pop = doc.getElementById(cfg.pop), btn = doc.getElementById(cfg.btn);
    if (!pop || !btn) return;
    if (on === undefined) on = !pop.classList.contains('on');
    if (on) {
      fpCloseAll();                       /* 同时只开一个，两个叠着没法用 */
      var host = doc.getElementById('content');
      var q = offsetIn(btn, host);
      pop.style.left = Math.max(8, q[0] + btn.offsetWidth - cfg.w) + 'px';
      pop.style.top = (q[1] + btn.offsetHeight + 6) + 'px';
      fpSync(cfg);
    }
    pop.classList.toggle('on', on);
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  function fpCloseAll() {
    for (var k in FP) if (Object.prototype.hasOwnProperty.call(FP, k)) fpOpen(FP[k], false);
  }
  function fpAnyOpen() {
    for (var k in FP) {
      if (!Object.prototype.hasOwnProperty.call(FP, k)) continue;
      var e = doc.getElementById(FP[k].pop);
      if (e && e.classList.contains('on')) return true;
    }
    return false;
  }
  /** 接线：按钮、勾选（事件委托）、清空、外点关闭 */
  function fpWire(cfg) {
    var btn = doc.getElementById(cfg.btn), pop = doc.getElementById(cfg.pop);
    if (!btn || !pop) return;
    var g;
    for (g = 0; g < cfg.keys.length; g++) fpList(cfg, cfg.keys[g]);
    btn.addEventListener('click', function (ev) { ev.stopPropagation(); fpOpen(cfg); });
    pop.addEventListener('click', function (ev) { ev.stopPropagation(); });
    /* 勾选走事件委托：国家那一组是随缓冲区重建的，逐个绑监听会在重建后失效 */
    pop.addEventListener('change', function (ev) {
      var el = ev.target;
      if (!el || el.type !== 'checkbox') return;
      var wrap = el.parentNode.parentNode;              /* label.fo -> div.fl */
      var k = wrap && wrap.getAttribute('data-k'), st = cfg.st();
      if (!k || !st[k]) return;
      var i = st[k].indexOf(el.value);
      if (el.checked) { if (i < 0) st[k].push(el.value); }
      else if (i >= 0) st[k].splice(i, 1);
      markFilterChips(); fpSync(cfg); cfg.after();
    });
    var clr = pop.querySelector('.fpclr');
    if (clr) clr.addEventListener('click', function () {
      var st = cfg.st(), j;
      for (j = 0; j < cfg.keys.length; j++) st[cfg.keys[j]] = [];
      markFilterChips(); fpSync(cfg); cfg.after();
    });
  }
  /* 兼容旧调用点（渠道卡 / 清空筛选 / 诊断口都只关心订单那一份） */
  function syncFilterPop() { fpSync(FP.ord); }

  function refreshFilterOpts() {
    /* **按订单数降序**排，不按 key 字母序。
     * 字母序有两个明显的毛病（第一版实测都中了）：
     *   · `Others` 排在 Google 和 Perplexity 中间 —— 「其他 AI」必须垫底
     *   · 国家按代码排（AE / AU / CA / CN / ES …），中文读者看到的是
     *     「阿联酋 澳大利亚 加拿大 中国 西班牙」，完全读不出规律
     * 按量排则和「订单来源分布」那张卡同口径，常用的自然浮到最上面。 */
    var srcs = {}, ccs = {}, i, o;
    for (i = 0; i < ordBuf.length; i++) {
      o = ordBuf[i];
      var pk = o.platform || 'Others';
      srcs[pk] = (srcs[pk] || 0) + 1;
      ccs[o.store.cc] = (ccs[o.store.cc] || 0) + 1;
    }
    function byCount(m, tailKey) {
      return Object.keys(m).sort(function (a, b) {
        if (a === tailKey) return 1;              /* 「其他 AI」永远垫底 */
        if (b === tailKey) return -1;
        return m[b] - m[a] || (a < b ? -1 : 1);   /* 同量时按 key 稳定排，避免抖动 */
      });
    }
    var sk = byCount(srcs, 'Others'), ck = byCount(ccs, null);
    var sSig = sk.join(','), cSig = ck.join(',');
    if (sSig !== lastSrcOpts) {
      lastSrcOpts = sSig;
      FP.ord.opts.src = sk.map(function (k) { return [k, PF_CN[k] || k]; });
      fpList(FP.ord, 'src');
    }
    if (cSig !== lastCCOpts) {
      lastCCOpts = cSig;
      FP.ord.opts.cc = ck.map(function (k) { return [k, CC_CN[k] || k]; });
      fpList(FP.ord, 'cc');
    }
  }
  function markFilterChips() {
    /* 三个下拉浓缩成一个按钮之后，「筛没筛」这条信息没有别的地方可放了 ——
     * 下拉框至少还会把选中值显示在框面上。所以按钮必须带**计数徽标**，
     * 否则筛选面板一关，屏上就完全看不出当前是不是在筛选状态。 */
    var nSel = oF.src.length + oF.cc.length + oF.tier.length;
    var nLog = lF.bot.length + lF.st.length;
    /* 两个筛选按钮各挂一个计数徽标。日志那个是**纯图标**（按要求不带中文字），
     * 所以徽标是它唯一能表达「正在筛选」的东西 —— 缺了它，面板一关就完全
     * 看不出当前有没有筛选条件在生效。 */
    fpBadge('btnFilter', 'fCount', nSel);
    fpBadge('btnLogFilter', 'lCount', nLog);
    var any = !!(nSel || oF.q);
    doc.getElementById('btnClr').disabled = !any;
    /* 渠道卡的选中态是同一份筛选状态的另一个视图 —— 从下拉或「清空筛选」
     * 改了 oF.src，那边的竖条必须同步，否则两处显示互相矛盾。 */
    markChanSel();
  }
  function fpBadge(btnId, badgeId, n) {
    var btn = doc.getElementById(btnId);
    if (!btn) return;
    btn.classList.toggle('act', n > 0);
    var b = doc.getElementById(badgeId);
    if (b) { b.textContent = n ? String(n) : ''; b.style.display = n ? '' : 'none'; }
  }

  function initFilters() {
    fpWire(FP.ord);
    fpWire(FP.log);
    /* 点面板外关掉。绑在 document 上，按钮和面板自身的点击已被
     * fpWire 里的 stopPropagation 挡住，否则点开的同一下就会立刻关上。 */
    doc.addEventListener('click', fpCloseAll);

    var qT = 0;
    qEl.addEventListener('input', function () {
      var self = this;
      root.clearTimeout(qT);
      qT = root.setTimeout(function () {
        oF.q = self.value.trim(); markFilterChips(); renderOrd(true);
      }, 180);
    });
    doc.getElementById('btnClr').addEventListener('click', function () {
      oF.src = []; oF.cc = []; oF.tier = []; oF.q = '';
      qEl.value = '';
      markFilterChips(); markChanSel(); syncFilterPop(); renderOrd(true);
    });
    /* 暂停/继续的图标路径。按钮只有图标没有文字，所以**状态全靠图标本身**：
     * ‖ = 现在在滚，点它会停； ▶ = 现在停着，点它会继续。
     * （和播放器同一套约定：图标画的是「点下去会发生什么」，不是当前状态。） */
    var PAUSE_ICON = {
      run:   'M4 2.4v7.2M8 2.4v7.2',        /* ‖ 两竖 */
      pause: 'M3.6 2.4l5.4 3.6-5.4 3.6z'    /* ▶ 三角 */
    };
    doc.getElementById('btnFull').addEventListener('click', toggleFull);
    doc.addEventListener('fullscreenchange', applyFullIcon);
    applyFullIcon();
    doc.getElementById('btnPause').addEventListener('click', function () {
      logPaused = !logPaused;
      var ic = doc.getElementById('pauseIcon');
      var lbl = logPaused ? '继续滚动' : '暂停滚动';
      ic.firstChild.setAttribute('d', logPaused ? PAUSE_ICON.pause : PAUSE_ICON.run);
      /* 三角要填充，两竖是描边 —— 同一个 <path> 换形状时这两个属性必须一起换，
       * 只换 d 会得到一个空心三角框（实测）。 */
      ic.setAttribute('fill', logPaused ? 'currentColor' : 'none');
      ic.setAttribute('stroke', logPaused ? 'none' : 'currentColor');
      /* 图标按钮没有可见文字，title / aria-label 是它唯一的名字 */
      this.setAttribute('title', lbl);
      this.setAttribute('aria-label', lbl);
      /* 类名用 hot 而不是 act —— act 是订单行里 opacity:0 的「查看」，会把按钮整个变透明 */
      this.classList.toggle('hot', logPaused);
      if (!logPaused) { rebuildLogShown(); renderLog(true); }
    });
    markFilterChips();
  }

  /* =====================================================================
   * 导出 CSV —— 导的是当前筛选 + 排序后的**全部**缓冲，不是屏上 6 行
   * ===================================================================== */
  function q(s) {
    s = String(s == null ? '' : s);
    return (/[",\n]/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  /** 落盘。UTF-8 BOM 是必须的 —— 不加 Excel 打开中文全是乱码。 */
  function saveCsv(name, lines) {
    var blob = new root.Blob(['﻿' + lines.join('\r\n')],
      { type: 'text/csv;charset=utf-8' });
    var url = root.URL.createObjectURL(blob);
    var a = doc.createElement('a');
    var dt = new Date();
    a.href = url;
    a.download = name + '-' + dt.getFullYear()
      + ('0' + (dt.getMonth() + 1)).slice(-2) + ('0' + dt.getDate()).slice(-2) + '.csv';
    doc.body.appendChild(a); a.click(); doc.body.removeChild(a);
    root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 4000);
  }

  /** 订单导出。传 rows 就导那一批（订单页用），不传就导看板当前筛选后的全部。 */
  function exportOrders(rows) {
    var v = rows || ordView(), i;
    var head = ['时间', '订单号', '店铺', '店铺域名', '国家', '商品', '来自 AI 助手',
                '金额USD', '原币金额', '币种', '订单规模', '买家城市'];
    var lines = [head.join(',')];
    for (i = 0; i < v.length; i++) {
      var o = v[i], d = new Date(o.t);
      lines.push([
        q(d.toLocaleString('zh-CN')), q(ordNo(o)), q(o.store.name), q(o.store.domain),
        q(CC_CN[o.store.cc] || o.store.cc), q(o.product),
        q(PF_CN[o.platform] || o.platform), q(o.usd.toFixed(2)),
        q((o.amount != null ? o.amount : o.usd).toFixed(2)), q(o.currency || 'USD'),
        q(TIER_CN[o.tier] || o.tier), q(o.buyerCity || '')
      ].join(','));
    }
    saveCsv('AP-AI渠道订单', lines);
  }
  /** 读取记录导出（AI 读取记录页） */
  function exportCrawls(rows) {
    var lines = [['时间', 'AI 助手', '爬虫token', '店铺', '请求路径', '结果',
                  '耗时ms', '读取来源'].join(',')];
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i];
      lines.push([
        q(new Date(c.t).toLocaleString('zh-CN')),
        q(BOT_CN[c.bot] || PF_CN[c.platform] || c.platform), q(c.bot),
        q(c.store ? c.store.name : ''), q(c.path),
        q(c.status === 304 ? '内容未变' : '已读取'), q(c.ms || 0), q(c.dcCity || '')
      ].join(','));
    }
    saveCsv('AP-AI读取记录', lines);
  }
  /* =====================================================================
   * 内页（AI 订单 / AI 读取记录 / 店铺 / 设置）与 KPI 卡选中态
   *
   * 内页的渲染在 pages.js。这里只负责两件事：
   *   1) 把 pages.js 需要的一切装进一个显式的 ctx（不让它 reach 进这个闭包）
   *   2) 顶栏那几个控件在不同页上语义不同，切页时跟着改
   * ===================================================================== */

  /** 可关掉的效果开关（设置页的每个开关都真的接在这上面） */
  var OPT = { celebrate: true, celebMin: 300, milestone: true, mapPop: true };

  /* ── 人声播报门槛：每一笔订单都播报 ────────────────────────────────────
   * common 是最低档，因此订单流里只要出现新订单，就会进入人声播报流程。
   *
   * 不改 `_shared/engine.js` 的 CONFIG（那是五个方案共用的），
   * audio.js 自己就暴露了 setVoiceMinTier —— 走它，只影响这一版。 */
  var VOICE_TIER = 'common';
  /* 这一版所有订单统一走 Tingting 中文女声，不再按金额在晓晓预录包与系统
   * 语音之间切换。兼容 macOS / Chrome 可能出现的两种 Tingting 拼写。 */
  var FEMALE_VOICES = ['Tingting', 'Ting-Ting'];
  /** 音频三个开关的状态镜像（audio.js 只给了 set，没给 get） */
  var AU = { muted: false, amb: false, hall: false };

  /** 静音的**唯一**写入口：顶栏按钮、M 键、设置页三处都必须走这里。
   *  它一次改三样东西 —— audio.js 的真实状态、AU.muted 这份镜像、顶栏按钮的
   *  图标 / 标题 / 按下态。谁绕过去自己调 A.setMuted，按钮就会和真实状态分叉
   *  （上面那条注释警告的就是这类分叉，只是当时还没有按钮把它暴露出来）。 */
  function applyMute(v) {
    AU.muted = !!v;
    if (A) { try { A.setMuted(AU.muted); } catch (e) {} }
    var b = doc.getElementById('btnMute');
    if (!b) return;
    b.classList.toggle('on', AU.muted);
    b.title = AU.muted ? '已静音 · 点击恢复（M）' : '声音开启 · 点击静音（M）';
    b.setAttribute('aria-pressed', AU.muted ? 'true' : 'false');
    var ic = doc.getElementById('icMute');
    if (ic) ic.innerHTML = AU.muted ? IC.muted : IC.sound;
  }
  function toggleMute() { applyMute(!AU.muted); }

  function pageCtx() {
    return {
      E: E, CC_CN: CC_CN, PF_CN: PF_CN, BOT_CN: BOT_CN,
      TIER_CN: TIER_CN, TIER_RANK: E.TIER_RANK || { common: 0, rare: 1, epic: 2, legendary: 3 },
      ordBuf: function () { return ordBuf; },
      logBuf: function () { return logBuf; },
      /* 店铺页要的是**完整名录**（含中文池），不是订单流里出现过的那几家 */
      shops: function () { return (SHOPS || []).concat(CN_POOL); },
      ordNo: ordNo, maskDomain: maskDomain, openDrawer: openDrawer,
      exportOrders: exportOrders, exportCrawls: exportCrawls, exportShops: exportShops,
      themeKey: function () { return THEMES[themeIdx].key; },
      setThemeKey: function (k) {
        for (var i = 0; i < THEMES.length; i++) if (THEMES[i].key === k) applyTheme(i);
      },
      /* 引擎自带 speed / paused 两个 getter，直接用，别自己另存一份状态 ——
       * 快捷键 1/2/3 和空格也在改它，两份状态一定会分叉。 */
      speed: function () { return E.speed; },
      setSpeed: function (v) { E.setSpeed(v); },
      onPageChange: onPageChange,
      opt: function (k) { return OPT[k]; },
      setOpt: function (k, v) { OPT[k] = v; },
      rng: function () { return rngMode; },
      setRng: function (v) {
        var b = doc.querySelector('#rng button[data-rng="' + v + '"]');
        if (b) b.click();
      },
      paused: function () { return !!E.paused; },
      togglePause: function () { E.togglePause(); },
      /* audio.js 没有暴露 muted 的读口，只有 setMuted/toggleMute，
       * 所以静音状态在这一层自己记一份，并且**只经由 setMuted 改**，不用 toggle ——
       * toggle 会让这里的镜像和真实状态错位。环境音床/展馆模式同理。 */
      audio: function (k) {
        if (!A) return false;
        if (k === 'muted') return !!AU.muted;
        if (k === 'ambient') return !!AU.amb;
        if (k === 'hall') return !!AU.hall;
        return false;
      },
      audioDo: function (k, v) {
        if (!A) return;
        try {
          if (k === 'toggleMute') { toggleMute(); }
          else if (k === 'ambient') { AU.amb = !!v; A._amb = AU.amb; A.setAmbient(AU.amb); }
          else if (k === 'hall') { AU.hall = !!v; A._hall = AU.hall; A.setHallMode(AU.hall); }
        } catch (e) {}
      }
    };
  }

  /* 顶栏的搜索框与导出按钮在不同页上指向不同的东西。
   * 内页各自带了自己的搜索/导出，所以在内页上把顶栏这两个禁用并说明 ——
   * 留着一个点了没反应的搜索框，就是又一个假操作。 */
  /* ── 全屏 ────────────────────────────────────────────────────────────────
   * requestFullscreen 返回 Promise，用户拒绝或非手势触发时会 reject ——
   * 不接住就是一条 unhandled rejection（console 里一条红，验收会挂）。 */
  var FULL_ICON = {
    on:  'M6.2 2.2H2.2v4M9.8 2.2h4v4M9.8 13.8h4v-4M6.2 13.8h-4v-4',   /* ⤢ 进入 */
    off: 'M2.2 6.2h4v-4M13.8 6.2h-4v-4M13.8 9.8h-4v4M2.2 9.8h4v4'      /* ⤡ 退出 */
  };
  function toggleFull() {
    try {
      if (doc.fullscreenElement) doc.exitFullscreen();
      else {
        var pr = doc.documentElement.requestFullscreen();
        if (pr && pr.catch) pr.catch(function () {});
      }
    } catch (e) {}
  }
  function applyFullIcon() {
    var ic = doc.getElementById('icFull'), btn = doc.getElementById('btnFull');
    if (!ic || !btn) return;
    var on = !!doc.fullscreenElement;
    ic.innerHTML = '<path d="' + (on ? FULL_ICON.off : FULL_ICON.on) + '"/>';
    var lbl = on ? '退出全屏（F）' : '全屏（F）';
    btn.setAttribute('title', lbl);
    btn.setAttribute('aria-label', lbl);
    btn.classList.toggle('on', on);
  }

  function onPageChange(key) {
    var onBoard = (key === 'ov');
    var qw = qEl ? qEl.closest('.fld') : null;
    if (qw) qw.classList.toggle('off', !onBoard);
    if (qEl) {
      qEl.disabled = !onBoard;
      qEl.placeholder = onBoard ? '搜店铺或商品名' : '本页搜索在上方工具栏';
    }
    var be = doc.getElementById('btnExp');
    if (be) {
      be.disabled = !onBoard;
      var el = onBoard ? '导出当前筛选后的全部订单' : '本页导出在上方工具栏';
      be.title = el;
      be.setAttribute('aria-label', el);   /* 纯图标按钮，aria 不能只留死文案 */
    }
    var rg = doc.getElementById('rng');
    if (rg) rg.classList.toggle('off', key === 'set' || key === 'store');
  }

  /* ── KPI 卡的选中态 ─────────────────────────────────────────────────
   * 四张卡都是指标选择器。选中后做的事必须是**可预期且真的发生了**的：
   *   成交额 → 订单表按金额降序（想看大单）
   *   订单   → 订单表回到最新在前（默认的流态）
   *   读取   → 高亮下方「AI 正在读取的商品页」面板并滚到它
   *   店铺   → 跳到店铺页（那是这个指标的明细所在）
   * 再点一次取消，回到默认流态。 */
  var kpiSel = '';
  function initKpiSelect() {
    var cards = doc.querySelectorAll('#kpi .kc');
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        var k = card.getAttribute('data-kpi');
        card.addEventListener('click', function () { selectKpi(k); });
        card.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectKpi(k); }
        });
      })(cards[i]);
    }
  }
  function markKpi() {
    var cards = doc.querySelectorAll('#kpi .kc');
    for (var i = 0; i < cards.length; i++) {
      /* 类名是 pick 不是 sel —— sel 是筛选下拉的包裹类，带 height:26px，
       * 加到卡片上会把 96px 的卡压成 28px（实测）。 */
      cards[i].classList.toggle('pick', cards[i].getAttribute('data-kpi') === kpiSel);
    }
    var lp = doc.getElementById('logPan');
    if (lp) lp.classList.toggle('focus', kpiSel === 'crawl');
    var op = doc.getElementById('ordPan');
    if (op) op.classList.toggle('focus', kpiSel === 'gmv' || kpiSel === 'ord');
  }
  function selectKpi(k) {
    if (k === 'store') {
      /* 店铺这个指标的明细不在看板上，直接跳到它的页面 —— 比在看板上
       * 高亮一个「约 36 分钟才 +1」的数字有用得多。 */
      kpiSel = 'store'; markKpi();
      if (root.APPages) root.APPages.show('store');
      return;
    }
    kpiSel = (kpiSel === k) ? '' : k;
    markKpi();
    if (kpiSel === 'gmv') setSort('usd', -1);
    else if (kpiSel === 'ord') setSort('t', -1);
    else if (kpiSel === '') setSort('t', -1);
  }

  /** 店铺名录导出（店铺页）。逐店指标是仿真值，表头里说明白。 */
  function exportShops(rows) {
    var lines = [['店铺(已脱敏)', '域名', '国家/地区', '行业', '接入状态',
                  'SKU数(仿真)', '近7日读取(仿真)', '累计AI订单(仿真)',
                  '接入时长天(仿真)'].join(',')];
    for (var i = 0; i < rows.length; i++) {
      var s = rows[i];
      lines.push([q(s.name), q(s.dom), q(CC_CN[s.cc] || s.cc), q(s.ind), q(s.st),
                  q(s.sku), q(s.rd), q(s.ord), q(s.day)].join(','));
    }
    saveCsv('AP-店铺名录', lines);
  }

  /* =====================================================================
   * 订单详情抽屉
   * ===================================================================== */
  var drawer = doc.getElementById('drawer'), scrim = doc.getElementById('scrim');
  var drawerBody = doc.getElementById('drawerBody');
  function openDrawer(o) {
    if (!o) return;
    var d = new Date(o.t);
    var rows = [
      ['订单号', ordNo(o), 'm'],
      ['成交金额', E.fmtUSD(o.usd), 'big'],
      ['原币金额', (o.currency && o.currency !== 'USD')
        ? (o.currency + ' ' + (o.amount != null ? o.amount.toFixed(2) : o.usd.toFixed(2)))
        : '—', 'm'],
      ['订单规模', TIER_CN[o.tier] || o.tier, ''],
      ['店铺', o.store.name, ''],
      ['店铺域名', o.store.domain, 'm'],
      ['商品', o.product, ''],
      ['来自', PF_CN[o.platform] || o.platform, ''],
      ['来源域名', CHAN_HOST[o.platform] || '—', 'm'],
      ['国家 / 地区', CC_CN[o.store.cc] || o.store.cc, ''],
      ['买家城市', o.buyerCity || '—', ''],
      ['成交时间', d.toLocaleString('zh-CN'), 'm']
    ];
    var html = '', i;
    for (i = 0; i < rows.length; i++) {
      html += '<div class="kv"><span class="k">' + rows[i][0] + '</span>'
        + '<span class="v ' + rows[i][2] + '">' + esc(rows[i][1]) + '</span></div>';
    }
    html += '<div class="note">这笔订单由 <b>' + esc(PF_CN[o.platform] || o.platform)
      + '</b> 把顾客引到店铺后成交。AP 让你的商品页能被 AI 助手读懂，'
      + '顾客在 AI 里问到相关商品时才会看到你的店。</div>';
    drawerBody.innerHTML = html;
    drawer.classList.add('on'); scrim.classList.add('on');
  }
  function closeDrawer() { drawer.classList.remove('on'); scrim.classList.remove('on'); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* =====================================================================
   * 顶栏：时间范围（两档都是引擎真实口径）
   * ===================================================================== */
  var rngMode = 'session';
  function initRange() {
    var bs = doc.getElementById('rng').querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) {
      bs[i].addEventListener('click', function () {
        rngMode = this.getAttribute('data-rng');
        for (var j = 0; j < bs.length; j++) bs[j].classList.toggle('on', bs[j] === this);
        var lb = rngMode === 'session' ? '上线至今' : '累计';
        doc.getElementById('e1').textContent = lb;
        doc.getElementById('e2').textContent = lb;
        doc.getElementById('e3').textContent = lb;
        lastOrdI = -1;      /* 换口径是跳变不是新增，别浮出一个 +296000 */
        var sc = doc.getElementById('splitScope');
        if (sc) sc.textContent = lb;
        recomputeBase();    /* 占比基数也跟着换，否则一屏两个口径 */
        updateTallies();
        /* 趋势线的量纲也跟着换（本场 44 万 ↔ 累计 4159 万）。不重铺的话
         * 窗口里会混着两个口径的点，画出来是一道断崖。 */
        seedSparks();
      });
    }
  }

  /* =====================================================================
   * 大额横幅 / 成交额跳动
   * ===================================================================== */
  var banner = doc.getElementById('banner'), bannerTxt = doc.getElementById('bannerTxt');
  var bannerTag = doc.getElementById('bannerTag');
  var bannerT = 0;

  /* 两类提醒共用这一条横幅，但**语义完全不同**，所以标签、配色、时长都分开：
   *   deal      = 单笔大额成交。暖色（订单层），一次性事件，短亮 3.4 秒。
   *   milestone = 平台累计里程碑（商品页被读懂数）。冷色（读取层），
   *               是「一直在涨的存量」跨过整数关，不是某一笔交易。
   * 原先里程碑复用了「大额成交」这个标签 —— 「已有 9000 个商品页可被 AI 读懂」
   * 左边挂着「大额成交」，两件事被混成一件。 */
  var BN_KIND = {
    deal:      { tag: '大额成交', cls: 'deal', ms: 3400 },
    milestone: { tag: '平台里程碑', cls: 'mile', ms: 4200 }
  };
  function showBannerRaw(kind, html) {
    var k = BN_KIND[kind] || BN_KIND.deal;
    if (bannerTag) bannerTag.textContent = k.tag;
    banner.classList.remove('deal', 'mile');
    banner.classList.add(k.cls, 'on');
    bannerTxt.innerHTML = html;
    bannerT = k.ms;
  }
  function showBanner(o) {
    showBannerRaw('deal', (CC_CN[o.store.cc] || o.store.cc) + ' · ' + esc(o.store.name)
      + ' 成交 <b>' + E.fmtUSD(o.usd) + '</b>');
  }
  function showMilestone(pages) {
    showBannerRaw('milestone', '已有 <b>' + E.fmtInt(pages) + '</b> 个商品页可被 AI 读懂');
  }

  /* =====================================================================
   * 全屏礼花庆祝（大额成交）
   *
   * 纸片跑在 canvas 里，不是 DOM —— 200 多个 DOM 元素每帧改 transform 会掉帧，
   * 而且会破坏「DOM 节点恒定」这条自检。
   * 随机一律走 E.hash32（规格红线：不许 Math.random）。
   * ===================================================================== */
  var celeb = doc.getElementById('celebrate');
  var confCv = doc.getElementById('confetti');
  var confCtx = confCv ? confCv.getContext('2d') : null;
  var confP = [], celebT = 0, confSeed = 1;
  var CONF_G = 0.00062, CONF_DRAG = 0.9986, CELEB_MS = 4200, CELEB_FADE = 420;
  var cbAmt = doc.getElementById('cbAmt'), cbShop = doc.getElementById('cbShop');
  var cbWhere = doc.getElementById('cbWhere'), cbVia = doc.getElementById('cbVia');
  var cbTag = doc.getElementById('cbTag');

  /** 庆祝层的排版跟着「地球开没开」走。
   *  单独一个函数是因为**两个方向都要同步**：庆祝中途按 G / Esc 开关地球时，
   *  排版必须立刻跟上 —— 否则会出现「卡片贴在左边、底下却是平铺看板」。 */
  function syncCelebLayout() {
    if (!celeb) return;
    celeb.classList.toggle('gv', !!gvOn);
  }

  function confColors() {
    /* 主题的暖/冷强调 + 金色 + 红 —— 礼花要花，但花在主题色系里。
     * 第六档是「最亮的那一档」，深浅两套必须给不同的值：
     * 白色纸片在浅色幕布上直接消失（实测截图里有一批纸片是隐形的）。
     * 浅色下换成中饱和的琥珀，在浅灰幕上仍然跳得出来。 */
    var top = THEMES[themeIdx].key === 'light' ? '#E09A3C' : '#FFFFFF';
    return [themeVal('order'), themeVal('crawl'), themeVal('red'),
            '#FFD166', themeVal('order'), top];
  }
  function burst(cx, cy, n, spd, spread) {
    var cols = confColors(), i;
    for (i = 0; i < n; i++) {
      var s = confSeed++;
      var a = -Math.PI / 2 + (E.hash32(s, 811) - 0.5) * spread;
      var v = spd * (0.55 + E.hash32(s, 823) * 0.75);
      confP.push({
        x: cx, y: cy,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        w: 5 + E.hash32(s, 829) * 7, h: 8 + E.hash32(s, 839) * 9,
        rot: E.hash32(s, 853) * 6.283, vr: (E.hash32(s, 857) - 0.5) * 0.013,
        col: cols[(E.hash32(s, 863) * cols.length) | 0],
        ttl: 2600 + E.hash32(s, 877) * 1900, age: 0,
        sw: 0.6 + E.hash32(s, 881) * 0.9            /* 翻面速率，纸片会侧过来变窄 */
      });
    }
  }
  function showCelebrate(o) {
    if (!celeb || !confCtx) { showBanner(o); return; }
    cbTag.textContent = (o.tier === 'legendary') ? '特大成交' : '大额成交';
    cbAmt.textContent = E.fmtUSD(o.usd).replace(/\.\d+$/, '');
    cbShop.textContent = o.store.name;
    cbWhere.textContent = (CC_CN[o.store.cc] || o.store.cc)
      + (o.buyerCity ? (' · ' + o.buyerCity) : '');
    cbVia.textContent = (PF_CN[o.platform] || o.platform || '') + ' 带来这笔订单';
    confP.length = 0;
    /* 三处起爆：左下、右下各一炮打向中间，顶部再撒一层往下飘 */
    burst(180, H + 40, 78, 1.42, 0.95);
    burst(W - 180, H + 40, 78, 1.42, 0.95);
    burst(W / 2, -30, 54, 0.30, 2.5);
    celeb.classList.remove('out');
    celeb.classList.add('on');
    /* 全屏地球开着时切到「让地球露出来」的排版：卡片挪到左侧留白、
     * 幕布中间挖空（见 index.html 的 #celebrate.gv）。
     * 被庆祝的那笔单就长在地球上，不能把主角糊掉。 */
    syncCelebLayout();
    celebT = CELEB_MS;
  }
  function updateConfetti(dtMs) {
    if (celebT <= 0) return;
    celebT -= dtMs;
    if (celebT <= CELEB_FADE) celeb.classList.add('out');
    if (celebT <= 0) {
      celeb.classList.remove('on', 'out', 'gv');
      confP.length = 0;
      confCtx.clearRect(0, 0, W, H);
      return;
    }
    var g = confCtx, i, p;
    g.clearRect(0, 0, W, H);
    for (i = confP.length - 1; i >= 0; i--) {
      p = confP[i];
      p.age += dtMs;
      if (p.age >= p.ttl || p.y > H + 60) { confP.splice(i, 1); continue; }
      p.vy += CONF_G * dtMs;
      p.vx *= CONF_DRAG; p.vy *= CONF_DRAG;
      p.x += p.vx * dtMs; p.y += p.vy * dtMs;
      p.rot += p.vr * dtMs;
      var u = p.age / p.ttl;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      /* 横向按 cos 压缩 → 纸片翻面时会变窄，比纯旋转的方块像纸 */
      var sx = Math.abs(Math.cos(p.age * 0.004 * p.sw));
      g.globalAlpha = u > 0.72 ? (1 - (u - 0.72) / 0.28) : 1;
      g.fillStyle = p.col;
      g.fillRect(-p.w / 2 * sx, -p.h / 2, p.w * sx, p.h);
      g.restore();
    }
    g.globalAlpha = 1;
  }
  /* 指标增量浮起。三张卡的底层量都是阶梯函数（成交额/订单约 55 秒跳一次、
   * 店铺约 36 分钟跳一次），不给反馈的话盯着看半分钟会以为数字是死的。 */
  function popDelta(el, txt) {
    if (!el) return;
    el.textContent = txt;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }
  var dGmv = doc.getElementById('dGmv');
  var dOrd = doc.getElementById('dOrd');
  var dStores = doc.getElementById('dStores');
  function showGmvDelta(o) { popDelta(dGmv, '+' + E.fmtUSD(o.usd)); }

  /* =====================================================================
   * 二维码（现场生成，零网络依赖）
   * ===================================================================== */
  function isLocalHost(h) {
    return !h || h === 'localhost' || h === '127.0.0.1' || h === '::1';
  }
  function surveyUrl() {
    try {
      var h = root.location.hostname;
      if (!isLocalHost(h)) {
        return root.location.protocol + '//' + h
          + (root.location.port ? ':' + root.location.port : '') + '/E-survey/';
      }
    } catch (e) {}
    return SURVEY_FALLBACK;
  }

  /* ── 二维码里的地址必须是**手机能访问**的 ────────────────────────────────
   * 这里原来的逻辑有个现场会踩的洞：页面开在 localhost 时（操作员几乎一定这么开），
   * `location.hostname` 给不出局域网地址，只能退回 `SURVEY_FALLBACK` ——
   * 而那是一个**写死的 DHCP 地址**（实测 192.168.56.67 确实是本机 WLAN 的当前地址，
   * 但换个网络、甚至同一网络重新租约后就变了）。
   * 后果不是「码扫不出来」，而是「码扫得出来、打开是个连不上的页面」——
   * 更难发现，因为屏上一切正常。
   *
   * 修法：向静态服务问一次 `/__lan`（它用 UDP connect 让操作系统选出口网卡，
   * 比在浏览器里瞎猜可靠）。拿到就用它重画二维码，拿不到就保持写死的兜底。
   * 二维码先按兜底画出来，**不等网络**，所以任何情况下屏上都有码。 */
  /* ── 二维码里到底该放哪个地址 ──────────────────────────────────────────
   * 优先级：公网隧道地址 > 局域网 IP > 写死的兜底。
   *
   * 为什么公网地址必须排第一（这是「换 5G 换 WiFi 都扫不出」的真正修法）：
   *   局域网 IP 是 RFC1918 私网地址，**在 5G 上物理不可达** —— 手机的运营商
   *   网络里没有这台机器，那个地址在公网上根本不路由。换一个 WiFi 也只有
   *   「同网段 + 没开客户端隔离 + 防火墙放行」三条同时成立才通，而展会和酒店
   *   WiFi 默认就开客户端隔离。所以私网地址这条路在现场基本必然失败。
   *   隧道地址是 https 公网域名，手机走自己的 5G 就能开，完全不碰展会网络。
   *
   * 为什么要**轮询**而不是问一次：
   *   快速隧道进程重起会换一个随机域名（_serve.js 会自动重连）。
   *   展会连跑 10 小时，只问一次的话隧道一断二维码就永久指向一个死地址。
   *   20 秒一次、只有地址真的变了才重画。 */
  function resolveLanUrl(cb) {
    if (!root.fetch) return;
    var last = null, timer = null, fast = true;

    /* ── 轮询节奏：拿到公网地址之前快、之后慢 ────────────────────────────────
     * 第一版是固定 20 秒一次，结果引入了一个很难看的现象：
     * 页面在服务刚启动那几秒打开时，第一次探测拿到的还是局域网地址
     * （隧道实测约 4 秒就绪，但页面可能比它早），于是屏上挂出一条红色
     * 「这个码只能在同一个 WiFi 下扫」——**而隧道 1 秒后就好了，
     * 那条告警却要等到 20 秒后的下一次探测才会消失。**
     * 现场看到的就是「刚开机总是先报一次错」，反而会让人不信这个告警。
     *
     * 所以：还没拿到 pub 时每 2 秒探一次（隧道就绪后最多 2 秒就切过去），
     * 拿到之后退到 20 秒（那时只需要盯着「隧道有没有断、域名有没有变」）。 */
    function schedule() {
      if (timer) root.clearTimeout(timer);
      timer = root.setTimeout(ask, fast ? 2000 : 20000);
    }
    function ask() {
      try {
        var t = root.setTimeout(function () { t = 0; }, 2500);
        root.fetch('/__lan', { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) {
            if (!t || !j) { schedule(); return; }
            root.clearTimeout(t);
            if (j.pub) fast = false;          /* 拿到公网地址，可以慢下来了 */
            /* pub 就是隧道地址，已经带好 /s 短链了 */
            var url = j.pub
              || (j.ip ? 'http://' + j.ip + ':' + (j.port || 8099) + '/s' : null);
            if (url && url !== last) { last = url; cb(url, j); }
            schedule();
          })
          .catch(function () { schedule(); });
      } catch (e) { schedule(); }
    }
    ask();
  }

  function initLottery() {
    var card = doc.getElementById('lotCard');
    var cv = doc.getElementById('lotQr'), urlEl = doc.getElementById('lotUrl');
    if (!cv || !card) return;
    /* 现在使用用户提供的微信二维码静态图片，不再把问卷 URL 动态画进 canvas。
     * 保留 APDiag_qr，方便现场确认图片是否成功加载。 */
    function markWechatQr(ok) {
      card.classList.toggle('bad', !ok);
      var warn = doc.getElementById('lotWarn');
      if (warn) {
        warn.hidden = !!ok;
        warn.textContent = ok ? '' : '微信二维码图片加载失败，请刷新页面。';
      }
      root.APDiag_qr = { src: 'wechat-static', ready: !!ok,
                         asset: cv.getAttribute('src') || '' };
    }
    cv.addEventListener('load', function () { markWechatQr(true); });
    cv.addEventListener('error', function () { markWechatQr(false); });
    markWechatQr(cv.complete && cv.naturalWidth > 0);
    return;
    /** 画码。**失败要返回 null 而不是抛** —— 调用方靠这个决定要不要退回另一个地址。
     *  qr.js 只做到版本 6（字节模式 M 级 106 字节）。现在的隧道地址约 60 字节，
     *  离上限很远；但以后换成自己的长域名 + 长路径是可能超的，超了就整张码作废。
     *  那种情况下退回局域网地址（短得多）比屏上挂一行报错有用。 */
    function paintQr(url, src) {
      try {
        /* 白底深码 —— 扫描器靠这个对比度定位，反过来大量机型扫不出。
         * 高分辨率画布配 168px 显示尺寸，缩放后仍保持清晰边缘。 */
        var info = root.APQR ? root.APQR.draw(cv, url, { size: 360, quiet: 4 }) : null;
        if (!info) return null;
        if (urlEl) urlEl.textContent = url;
        root.APDiag_qr = { url: url, version: info.version, size: info.size,
                           mask: info.mask, scale: info.scale, src: src };
        return info;
      } catch (e) {
        return null;                            /* 太长/编码失败，交给调用方兜底 */
      }
    }
    /* ── 「码是坏的」必须在屏上说出来 ──────────────────────────────────────
     * 这是真踩到的一次：**双击 index.html** 打开（file://），页面拿不到
     * /__lan，二维码就静默停在代码里写死的那个 DHCP 地址上。
     * 码画得很漂亮、也能扫出内容，但打开是个连不上的页面 ——
     * 屏上一切正常，只能等观众抱怨才发现。这是最贵的一类故障。
     *
     * file:// 下同时废掉的还有**人声包**（fetch 被 CORS 拦死，播报退回 Huihui）。
     * 所以这条告警顺带把人声状态一起报出来：两个修复是同一个前提 ——
     * 必须通过 启动预览.bat（本地服务器）打开。 */
    var warnEl = doc.getElementById('lotWarn');
    function showBad(reason, how) {
      card.classList.add('bad');
      if (!warnEl) return;
      var vp = root.APVoicePack;
      var voiceBad = !vp || vp.mode !== 'ready';
      warnEl.hidden = false;
      warnEl.innerHTML = '<b>⚠ 这个二维码扫不开</b> —— ' + reason + '<br>' + how
        + (voiceBad ? '<br><b>人声也退回了系统旧音色</b>（同一个原因）。' : '');
    }

    var url = surveyUrl();
    try {
      paintQr(url, isLocalHost(root.location.hostname) ? 'fallback' : 'location');
      if (root.location.protocol === 'file:') {
        /* file:// 是确定失败，不用等探测 */
        showBad('这个页面是「双击 HTML 文件」打开的（<code>file://</code>），'
              + '拿不到可访问地址，码里是代码写死的兜底 IP。',
                '改用根目录的 <b>启动预览.bat</b> 打开。');
      } else {
        /* 走服务器打开的：给探测 6 秒。到点还停在 fallback 就说明 /__lan
         * 没回来（服务器是旧版？），照样要报 —— 不能默认它一定成功。 */
        root.setTimeout(function () {
          var d = root.APDiag_qr;
          if (d && /^fallback/.test(d.src || '')) {
            showBad('没能从服务器取到可访问地址，码里是写死的兜底 IP。',
                    '确认 <b>_serve.js</b> 是最新版（要有 <code>/__lan</code> 与公网隧道），'
                  + '然后重启 启动预览.bat。');
          }
        }, 6000);
      }
      /* 再异步问一次真实局域网地址；拿到不同的就重画（见 resolveLanUrl 注释）。
       * **无论地址是否变化都要把探测结果记进 src** —— 写死的兜底 IP 恰好等于
       * 当前真实地址时，如果只在"变了"的分支里写 src，就分不清
       * 「探测成功且一致」和「探测根本没跑」。而这正是最需要知道的一件事：
       * 现场到底是靠探测拿到地址，还是在赌那个写死的 IP。 */
      /* 拿到真实地址就重画。**必须把是哪一路记进 src** —— 现场最需要知道的
       * 一件事就是「这个码是任何网络都能扫，还是只有同一个 WiFi 能扫」，
       * 而这两者在屏上长得一样。pub 有值 = 公网可扫；只有 ip = 同网段才行。 */
      resolveLanUrl(function (newUrl, j) {
        var mode = j.pub ? 'pub' : 'lan:' + j.ip;
        var ok = paintQr(newUrl, mode);
        /* 公网地址画不出来（超长）就退回局域网地址 —— 有个只能同网段扫的码，
         * 总比屏上一个坏码强。退回了要如实标出来，别让现场以为是公网可扫的。 */
        if (!ok && j.pub && j.ip) {
          var lan = 'http://' + j.ip + ':' + (j.port || 8099) + '/s';
          if (paintQr(lan, 'lan-fallback:' + j.ip)) mode = 'lan-fallback';
        }
        if (root.APDiag_qr) {
          root.APDiag_qr.reachable =
            (mode === 'pub') ? 'anywhere' : 'same-lan-only';
          root.APDiag_qr.tunnel = j.tunnel || null;
        }
        /* 拿到真地址了 —— 把告警撤掉。
         * 只有 pub（公网可扫）才算完全好；退回局域网时保留一条提示，
         * 因为那种情况下手机换 5G 或换 WiFi 依然扫不开。 */
        card.classList.remove('bad');
        /* ── 这张卡是**观众看的**，不是运维面板 ──────────────────────────────
         * 我上一版把「手机要连同一个 WiFi、码里是 192.168.56.67」这种运维信息
         * 直接印在卡上了 —— 那是设计错误：观众看不懂、显得像出故障，
         * 还把内网 IP 摆在一块所有人都会拍照的屏幕上。
         *
         * 现在的规则：**只有码真的用不了才出提示**（file:// 打开、编码失败）。
         * 「走局域网」不是故障，是一种部署模式，属于操作员该知道的事 ——
         * 那些信息去这三个地方看，不占观众的屏幕：
         *   ① 服务窗口的启动横幅  ② console  ③ window.APDiag_qr
         * 判据：一条提示如果观众读了也不知道该做什么，它就不该在这张卡上。 */
        if (warnEl) { warnEl.hidden = true; warnEl.innerHTML = ''; }
        if (root.console && mode !== 'pub') {
          root.console.log('[二维码] 当前是局域网地址 ' + (j.ip || '?')
            + '（隧道 ' + ((j.tunnel && j.tunnel.state) || '?')
            + '）—— 手机需与本机同一 WiFi。要固定公网地址请设 AP_PUBLIC_URL。');
        }
      });
    } catch (e) {
      /* 地址栏已经从屏上去掉了，所以报错不能再往 urlEl 写（那是个 null）——
       * 必须走告警条，否则二维码画失败时屏上一点提示都没有。 */
      showBad('二维码生成失败：' + e.message, '看一下 console，然后重启 启动预览.bat。');
    }
  }

  /* =====================================================================
   * 全屏地球
   *
   * 渲染器是方案 B 的 globe.js（真实城市点云 + 坠落的读取流 + 发射的订单弧线），
   * 本目录一份副本，只改了球心/半径并补了大气光晕三层 —— 没碰 B 的那份。
   *
   * 打开时接管两个事件流：
   *   pollCrawls → globe.spawnCrawl（球面发亮的点）+ 底部跑马灯
   *   pollOrders → globe.spawnOrder（球面弧线）+ 悬浮订单卡
   * 关掉时全部还原给平铺地图。地球只在打开时 frame()，不开不算帧。
   * ===================================================================== */
  var GB = root.APGlobe || null;
  var gv = doc.getElementById('gv'), gvOn = false, gvReady = false;
  var gvPops = doc.getElementById('gvPops'), gvPopList = [], gvPopN = 0;
  var GVPOP_MAX = 4, GVPOP_MS = 5200;
  var gvTickIn = doc.getElementById('gvTickIn'), gvTicks = [];
  var GVTICK_MAX = 14, GVTICK_SPD = 0.115;   /* px/ms ≈ 115px/s，能读完又不至于太空 */
  var gvTickX = 0;
  var gvGmv = doc.getElementById('gvGmv'), gvOrd = doc.getElementById('gvOrd');
  var gvCrawls = doc.getElementById('gvCrawls'), gvStores = doc.getElementById('gvStores');
  var gvClock = doc.getElementById('gvClock');

  function buildGvPops() {
    for (var i = 0; i < GVPOP_MAX; i++) {
      var d = doc.createElement('div');
      d.className = 'gpop';
      d.innerHTML = '<span class="ld"></span>'
        + '<div class="r1"><i></i><b class="w"></b></div>'
        + '<div class="r2"></div><div class="r3"></div>';
      gvPops.appendChild(d);
      gvPopList.push({ el: d, ld: d.querySelector('.ld'), w: d.querySelector('.w'),
                       amt: d.querySelector('.r2'), via: d.querySelector('.r3'),
                       t: 0, live: false });
    }
  }
  /** 订单卡钉在买家城市所在的球面点上。球在转，所以每帧要重算位置。 */
  function gvPopOrder(o) {
    if (!GB || !gvPopList.length) return;
    var p = gvPopList[gvPopN % GVPOP_MAX]; gvPopN++;
    var big = (o.tier === 'epic' || o.tier === 'legendary');
    p.w.textContent = (CC_CN[o.store.cc] || o.store.cc)
      + (o.buyerCity ? (' · ' + o.buyerCity) : '');
    p.amt.textContent = E.fmtUSD(o.usd);
    p.via.textContent = esc(o.store.name) + ' · ' + (PF_CN[o.platform] || o.platform || '');
    p.el.classList.toggle('big', big);
    p.lat = o.buyerLat; p.lon = o.buyerLon;
    p.t = GVPOP_MS; p.live = true;
    p.el.classList.remove('on');
    void p.el.offsetWidth;
    p.el.classList.add('on');
    placeGvPop(p);
  }
  var GVP = {};
  function placeGvPop(p) {
    if (p.lat == null) return;
    GB.screenOf(p.lat, p.lon, GVP);
    /* 点转到球背面就把卡藏起来 —— 钉在看不见的地方等于飘在空中 */
    if (!GVP.front) { p.el.style.opacity = '0'; return; }
    p.el.style.opacity = '';
    var cw = p.el.offsetWidth || 170, ch = p.el.offsetHeight || 66;
    var GAP = 18, PAD = 24;
    var right = GVP.x < W * 0.56;
    var L = right ? (GVP.x + GAP) : (GVP.x - GAP - cw);
    var T = GVP.y - ch - GAP;
    if (T < 66) T = GVP.y + GAP;
    L = Math.max(PAD, Math.min(W - cw - PAD, L));
    T = Math.max(66, Math.min(H - ch - 118, T));
    p.el.style.left = L + 'px';
    p.el.style.top = T + 'px';
    p.el.style.transformOrigin = (right ? 'left ' : 'right ') + 'bottom';
    var ax = right ? 0 : cw, ay = ch;
    var dx = (GVP.x - L) - ax, dy = (GVP.y - T) - ay;
    var len = Math.sqrt(dx * dx + dy * dy);
    p.ld.style.width = len.toFixed(1) + 'px';
    p.ld.style.left = ax + 'px';
    p.ld.style.top = ay + 'px';
    p.ld.style.transform = 'rotate(' + Math.atan2(dy, dx).toFixed(4) + 'rad)';
    p.ld.style.transformOrigin = '0 0';
  }
  function updateGvPops(dtMs) {
    for (var i = 0; i < gvPopList.length; i++) {
      var p = gvPopList[i];
      if (!p.live) continue;
      p.t -= dtMs;
      if (p.t <= 0) { p.el.classList.remove('on'); p.live = false; continue; }
      placeGvPop(p);          /* 球在转，位置每帧都要跟 */
    }
  }

  /** 底部跑马灯：每条 AI 读取记录从右往左飘。DOM 固定 GVTICK_MAX 个，循环复用。 */
  function buildGvTicks() {
    for (var i = 0; i < GVTICK_MAX; i++) {
      var d = doc.createElement('span');
      d.className = 'gtk';
      d.innerHTML = '<b></b><s></s><em></em>';
      d.style.position = 'absolute';
      d.style.left = '0px';
      d.style.visibility = 'hidden';
      gvTickIn.appendChild(d);
      gvTicks.push({ el: d, bot: d.querySelector('b'), path: d.querySelector('s'),
                     dc: d.querySelector('em'), x: 0, w: 0, live: false });
    }
  }
  function gvPushTick(c) {
    /* 队尾还远在屏外就先别加 —— 入队是 3 条/秒（每条约 300px = 900px/s），
     * 而滚动只有 115px/s，不设闸门队列会无限堆积，实测位移飙到 2600px，
     * 屏上只剩零星一条（跑马灯看着像空的就是这个原因）。
     * 加了闸门后入队速率自动被滚动速率带住。 */
    if (gvTickX > W + 480) return;
    var free = null, i;
    for (i = 0; i < gvTicks.length; i++) if (!gvTicks[i].live) { free = gvTicks[i]; break; }
    if (!free) return;                          /* 满了就丢，跑马灯不需要补齐 */
    free.bot.textContent = BOT_CN[c.bot] || c.platform || '';
    free.path.textContent = ' ' + (c.path || '');
    free.dc.textContent = (c.dcCity || '') + ' · ' + (c.ms || 0) + 'ms';
    free.el.style.visibility = 'visible';
    free.w = free.el.offsetWidth || 320;
    /* 从右边缘外开始；若上一条还没走远就顶着它排，避免叠字 */
    free.x = Math.max(W, gvTickX);
    gvTickX = free.x + free.w + 26;
    free.live = true;
    free.el.style.transform = 'translate3d(' + free.x + 'px,0,0)';
  }
  function updateGvTicks(dtMs) {
    var d = GVTICK_SPD * dtMs, i;
    /* gvTickX 是队尾坐标，跟着滚动一起左移。别 clamp 回 W ——
     * 那样每条新记录都从同一个 x 起步，会直接叠在一起。 */
    gvTickX -= d;
    if (gvTickX < 0) gvTickX = 0;
    for (i = 0; i < gvTicks.length; i++) {
      var t = gvTicks[i];
      if (!t.live) continue;
      t.x -= d;
      if (t.x + t.w < -40) {
        t.live = false; t.el.style.visibility = 'hidden';
        continue;
      }
      t.el.style.transform = 'translate3d(' + t.x.toFixed(1) + 'px,0,0)';
    }
  }

  function openGlobe() {
    if (!GB || gvOn) return;
    if (!gvReady) {
      GB.init(doc.getElementById('gvGlobe'));
      buildGvPops(); buildGvTicks();
      gvReady = true;
    }
    /* init 是懒的（第一次按 G 才跑），而主题可能在那之前就切过了。
     * 每次打开都对一次表，比依赖两处的调用顺序可靠。 */
    if (GB.setTheme) GB.setTheme(THEMES[themeIdx].key);
    gvOn = true;
    gv.classList.add('on', 'in');
    syncCelebLayout();      /* 庆祝正在放时开地球：立刻切成让球露出来的排版 */
    root.setTimeout(function () { gv.classList.remove('in'); }, 760);
  }
  function closeGlobe() {
    if (!gvOn) return;
    gvOn = false;
    gv.classList.remove('on', 'in');
    syncCelebLayout();      /* 反向同样要同步，否则卡片会贴在左边压着看板 */
    for (var i = 0; i < gvPopList.length; i++) {
      gvPopList[i].live = false;
      gvPopList[i].el.classList.remove('on');
    }
    for (i = 0; i < gvTicks.length; i++) {
      gvTicks[i].live = false;
      gvTicks[i].el.style.visibility = 'hidden';
    }
    gvTickX = 0;
  }

  /* =====================================================================
   * 主循环
   * ===================================================================== */
  var clock = 0, started = false, lastSec = -1, bKeyN = 0;
  var fpsAcc = 0, fpsN = 0, fpsT = 0, fpsAvg = 0, spkT = 0;
  var rafLast = 0, rafAcc = 0, rafN = 0, rafFps = 0;   /* 真实帧率，见 frame() 的注释 */
  var crawlHitBudget = 0;
  var elGmv = doc.getElementById('kGmv'), elCrawls = doc.getElementById('kCrawls');
  var elOrd = doc.getElementById('kOrd'), elStores = doc.getElementById('kStores');
  var elLogRate = doc.getElementById('logRate'), elNavOrd = doc.getElementById('navOrd');
  var elWhoScope = doc.getElementById('whoScope'), elE4 = doc.getElementById('e4');
  var lastOrdI = -1, lastStoreI = -1, lastSec2 = -1;
  function fmtGvClock(t) {
    var d = new Date(t);
    var M = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    return M[d.getMonth()] + d.getDate() + '日 '
      + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ' (UTC+8)';
  }

  function frame() {
    root.requestAnimationFrame(frame);
    if (!started) return;
    E.update();
    var dtMs = E.dt();          /* 已经是毫秒（引擎里就是 _dtMs），别再乘 1000 */
    tickLogScroll(dtMs);        /* 日志滚动逐帧缓动，见 placeLogRows 上面那段 */
    clock += dtMs;

    if (dtMs > 0) { fpsAcc += 1000 / dtMs; fpsN++; }
    fpsT += dtMs;
    if (fpsT >= 1000) { fpsAvg = Math.round(fpsAcc / Math.max(1, fpsN)); fpsAcc = 0; fpsN = 0; fpsT = 0; }

    /* 真实帧率：**别用 E.dt() 算**。引擎的 dt 走 Date.now()，而 Windows 上它的
     * 分辨率只有约 15.6ms —— 60fps 下 dr 会跳变成 0/15/16/31，
     * 1000/dt 平均出来必然偏低（实测报 46~52，rAF 实测其实是 58~60）。
     * 动画步长仍然用 E.dt()（必须和引擎虚拟时间一致），只有统计换成 performance。 */
    var pnow = (root.performance && root.performance.now) ? root.performance.now() : Date.now();
    if (rafLast) { rafAcc += pnow - rafLast; rafN++; }
    rafLast = pnow;
    if (rafAcc >= 1000) { rafFps = Math.round(rafN * 1000 / rafAcc); rafAcc = 0; rafN = 0; }
    crawlHitBudget = Math.min(10, crawlHitBudget + dtMs / 1000 * 9);   /* 见 addHit 的注释 */

    var m = E.metrics();
    var gmv = displayGmv(m);
    var ords = displayOrders(m);
    var crawls = displayCrawls(m);
    var ordI = Math.floor(ords), storeI = displayStores();
    /* 只写 textContent，不写 innerHTML —— 单位 <u> 是静态的，每帧重解析 HTML 没必要 */
    elGmv.textContent = E.fmtUSD(gmv).replace(/\.\d+$/, '');
    elOrd.textContent = E.fmtInt(ordI);
    elCrawls.textContent = E.fmtInt(Math.floor(crawls));
    elStores.textContent = E.fmtInt(storeI);

    /* 订单与店铺跳变时浮 +N。lastXxx < 0 表示刚启动或刚切过口径，跳过这一次 ——
     * 否则切「开幕至今 → 累计」会冒出一个 +296000。 */
    if (lastOrdI >= 0 && ordI > lastOrdI) popDelta(dOrd, '+' + E.fmtInt(ordI - lastOrdI));
    lastOrdI = ordI;
    if (lastStoreI >= 0 && storeI > lastStoreI) popDelta(dStores, '+' + (storeI - lastStoreI));
    lastStoreI = storeI;

    var sec = Math.floor(E.now() / 1000);
    if (sec !== lastSec) {
      lastSec = sec;
      elLogRate.textContent = '每秒约 ' + Math.round(displayCrawlsRate(m)) + ' 个页面';
      elNavOrd.textContent = E.fmtInt(Math.floor(displayOrders(m)));
      if (elWhoScope) elWhoScope.textContent = '全部店铺 · ' + E.fmtInt(storeI) + ' 家';
      if (elE4) elE4.textContent = '上线至今';
      updateTallies();
      /* 内页每秒重画一次（且只在第 1 页 —— 翻页后是快照，见 pages.js 头部）。
       * 放在这个每秒分支里而不是每帧：分页表是普通 DOM，每帧重建 20 行是白烧。 */
      if (root.APPages) root.APPages.tick();
    }

    var os = E.pollOrders() || [], i;
    for (i = 0; i < os.length; i++) {
      pushOrder(os[i], false);
      /* 全屏地球开着时，同一笔订单还要在球面上发一条弧 + 弹一张悬浮卡 */
      if (gvOn && GB) {
        try { GB.spawnOrder(os[i]); } catch (e) {}
        /* 先把镜头摇到买家那条经线，卡片同时弹出但要等转到正面才显形 ——
         * 于是观众看到的是「球转过去，卡片从球缘浮出来」 */
        try { GB.focusLon(os[i].buyerLon, 1300); } catch (e) {}
        gvPopOrder(os[i]);
      }
    }
    var cs = E.pollCrawls(CRAWL_RATE) || [];
    for (i = 0; i < cs.length; i++) {
      pushCrawl(cs[i]);
      if (gvOn && GB) {
        try { GB.spawnCrawl(cs[i]); } catch (e) {}
        /* 跑马灯降采样：全速 9 条/秒会糊成一片，每 3 条上一条 */
        if (i % 3 === 0) gvPushTick(cs[i]);
      }
    }
    var ms = E.pollMilestones() || [];
    if (ms.length && OPT.milestone) {
      if (A) { try { A.playMilestone(); } catch (e) {} }
      showMilestone(ms[0].value || 0);
    }

    /* 趋势线：34 点 × 900ms = 约 31 秒窗口，落点 + 每帧生长（见 makeSpark 头部注释）。
     * 推的是**累计量**，不是速率 —— 速率那一路 ordersPerMin 是常量，画出来必然是直线。 */
    spkT += dtMs;
    if (spkT >= SPK_MS) {
      spkT -= SPK_MS;
      sk0.push(spkGmv(m)); sk1.push(spkCrawls(m));
      sk2.push(spkOrders(m)); sk3.push(spkStores());
    }
    var spkF = Math.max(0, Math.min(1, spkT / SPK_MS));
    sk0.live(spkGmv(m), spkF);      sk1.live(spkCrawls(m), spkF);
    sk2.live(spkOrders(m), spkF);   sk3.live(spkStores(), spkF);
    for (var ski = 0; ski < SKS.length; ski++) SKS[ski].draw();

    updateFlips();
    updateConfetti(dtMs);
    if (gvOn && GB) {
      /* 全屏地球开着就只画地球，平铺地图那张 canvas 被完全盖住，没必要再画 */
      GB.frame(dtMs);
      updateGvPops(dtMs);
      updateGvTicks(dtMs);
      gvGmv.textContent = elGmv.textContent;
      gvOrd.textContent = elOrd.textContent;
      gvCrawls.textContent = elCrawls.textContent;
      gvStores.textContent = elStores.textContent;
      if (sec !== lastSec2) { lastSec2 = sec; gvClock.textContent = fmtGvClock(E.now()); }
    } else {
      updatePops(dtMs);
      drawMap(dtMs);
    }
    if (bannerT > 0) {
      bannerT -= dtMs;
      if (bannerT <= 0) banner.classList.remove('on', 'deal', 'mile');
    }
  }

  function start() {
    if (started) return;
    started = true;
    doc.getElementById('gate').classList.add('off');
    if (A) {
      try { A.setFallbackVoiceNames(FEMALE_VOICES); } catch (e) {}
      try { A.setSystemVoiceOnly(true); } catch (e) {}
      try { A.unlock(); } catch (e) {}
      /* 这一版要求所有新订单都播报。走 audio.js 自己的 setter，
       * 不动共用的 engine.js CONFIG。 */
      try { A.setVoiceMinTier(VOICE_TIER); } catch (e) {}
    }
  }

  /* =====================================================================
   * 启动
   * ===================================================================== */
  function boot() {
    initShops();      /* 必须在 bakeMap / 预铺之前 —— 地图市场点与店铺都要用它 */
    var pb = doc.getElementById('mapWrap');
    mapCv.width = Math.max(100, pb.clientWidth);
    mapCv.height = Math.max(100, pb.clientHeight);
    mapCtx = mapCv.getContext('2d');
    mapGeom();

    /* 四张卡各一条。反色那张（成交额）的线必须用 fillTx —— 用 order 的暖色
     * 压在 #0B7360 的实底上对比度不够，浅色主题下更糟。 */
    /* 加宽到 168：40 分钟窗口里 2~3 个起伏，104px 上一个起伏只有 35px，
     * 挤成锯齿看不出「平缓」。168 上一个起伏约 56px，弧线才展得开。
     * salt 决定各卡曲线不同 —— 11 是引擎真正用在抓取速率上的那个
     * （_shared/engine.js:209），其余三张用同一个发生器换 salt，
     * 起伏的**性格**一样但不会四张画成一模一样。
     * 23 / 37 / 41 是按「一整天每 5 分钟采一次」挑的：落在 2~5 个转折的占比
     * 95~97%（原来用的 53 只有 90%）。11 保留不换 —— 它是引擎真在用的那个，
     * 换掉就失去「这条线真的在驱动那个数字」这层意思了。 */
    sk0 = makeSpark('sk0', 168, 34, 'fillTx', 23);
    sk1 = makeSpark('sk1', 168, 34, 'crawl', 11);
    sk2 = makeSpark('sk2', 168, 34, 'order', 37);
    sk3 = makeSpark('sk3', 168, 34, 'crawl', 41);
    SKS = [sk0, sk1, sk2, sk3];
    seedSparks();

    buildOrdHead(); buildOrdRows();
    buildLogHead(); buildLogRows();
    applyTableWidths();     /* fit() 在文件顶部就跑过一次，那会儿行还没建出来 */
    buildPops();

    /* 恢复上次选的主题（这一版是后台，主题是用户自己的偏好，该记住） */
    var saved = null;
    try { saved = root.localStorage.getItem('apBack_theme'); } catch (e) {}
    var si = themeIdx;
    if (saved) for (var i = 0; i < THEMES.length; i++) if (THEMES[i].key === saved) si = i;
    applyTheme(si);

    /* ── 历史预铺 ────────────────────────────────────────────────────────
     * 这一版是后台，打开就该有历史订单 —— 只铺 6 笔的话，筛选、排序、导出
     * 全都没有意义（实测「按国家筛」只剩 1 笔）。所以把 peekOrders 能给的
     * 全部铺成「过去一小时的历史」。
     *
     * peekOrders 有 62 笔硬上限（实测：传 200 / 600 / 1500 / 4000 都是同一批）。
     * 直接拿它们当历史会有个坑：这些 id 真到达时会被 seenIds 挡掉，订单流冻死。
     * 所以给历史单的 id 加 500000 偏移 —— 它们是独立的历史记录，
     * 真实流的每一笔都还能正常进来。（订单号取 6 位，偏移不会被截掉。） */
    var pre = [];
    try { pre = (E.peekOrders(80) || []).slice(); } catch (e) { pre = []; }
    /* 时间戳：间隔**累加**（写 i*间隔 带抖动后相邻行会穿插）。
     * pre[0] 最近、pre[末] 最远，跨度约 62 × 59s ≈ 1 小时。 */
    var t0 = E.now(), acc = 0, k;
    for (i = 0; i < pre.length; i++) {
      acc += 42000 + Math.round(E.hash32(i + 5, 913) * 34000);
      var o = pre[i], clone = {};
      for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) clone[k] = o[k];
      clone.t = t0 - acc;
      clone.id = 'h' + ((parseInt(String(o.id).replace(/\D/g, ''), 10) || i) + 500000);
      if (seenIds[clone.id]) continue;
      seenIds[clone.id] = 1; seenN++;
      /* store 是引擎的对象、多笔订单会共享同一个实例，克隆一份再覆写，
       * 否则覆写会串到别的订单上 */
      clone.store = {};
      for (var sk in o.store) if (Object.prototype.hasOwnProperty.call(o.store, sk)) clone.store[sk] = o.store[sk];
      tuneAutoTier(clone);
      applyShop(clone);
      applyFeed(clone);
      ordBuf.push(clone);
    }
    if (ordBuf.length > ORD_BUF) ordBuf.splice(0, ordBuf.length - ORD_BUF);
    refreshFilterOpts();
    renderOrd(true);
    rebuildLogShown();   /* 此刻 logBuf 通常还是空的；真正解决冷启动的是
                            pushCrawl 里那段「未满之前不降采样」，见那里的注释 */
    renderLog(true);
    initTallies();
    initFilters();
    initRange();
    initLottery();

    doc.getElementById('goBtn').addEventListener('click', start);
    doc.getElementById('gate').addEventListener('click', start);
    doc.getElementById('btnTheme').addEventListener('click', cycleTheme);
    var bM = doc.getElementById('btnMute');
    if (bM) {
      bM.addEventListener('click', toggleMute);
      /* audio.js 没加载成功时别让按钮假装能用 —— 点了没有任何声音变化，
       * 比没有按钮更糟。.tb[disabled] 的灰态样式顶栏里已经有了。 */
      if (!A) { bM.disabled = true; bM.title = '音频未加载'; }
    }
    applyMute(AU.muted);        /* 铺初始图标 / 标题，别让按钮空着 */
    doc.getElementById('btnExp').addEventListener('click', function () { exportOrders(); });
    doc.getElementById('btnClose').addEventListener('click', closeDrawer);
    scrim.addEventListener('click', closeDrawer);
    var bg = doc.getElementById('btnGlobe');
    if (bg) bg.addEventListener('click', openGlobe);
    doc.getElementById('gvClose').addEventListener('click', closeGlobe);
    /* 行点击出详情：事件委托到表体，6 行 DOM 复用也不会挂错 */
    ordBody.addEventListener('click', function (ev) {
      for (var i = 0; i < ORD_ROWS; i++) {
        if (oRows[i].el.contains(ev.target)) { openDrawer(oRows[i].o); return; }
      }
    });
    /* 侧栏导航 + 四个内页：全部交给 APPages（导航监听也在那边挂）。
     * 之前这里只是切 .on 高亮，页面不换 —— 四个假入口。 */
    if (root.APPages) { root.APPages.init(pageCtx()); }
    initKpiSelect();
    root.requestAnimationFrame(frame);
  }

  doc.addEventListener('keydown', function (ev) {
    var k = ev.key;
    var tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      if (k === 'Escape') { ev.target.blur(); }
      return;                                     /* 在输入框里打字不该触发快捷键 */
    }
    if (k === ' ') { ev.preventDefault(); E.togglePause(); }
    else if (k === 'd' || k === 'D') cycleTheme();
    /* ── 手动造单：一个键一档，四档全覆盖 ────────────────────────────────
     * 原先只有两个键，而且金额区间**横跨了档位边界**：
     *   B = $460~$1280 → epic 或 legendary（门槛 792），随机落
     *   N = $12~$192  → common 或 rare（门槛 110），随机落
     * 于是「按 B 出什么档」是抛硬币，而且没有一个键能稳定造出「普通小额」。
     * 引擎的档位门槛是 rarity()：common <110 / rare ≥110 / epic ≥300 / legendary ≥792。
     * 现在每个键的区间都**完整落在一档之内**，按下去必然是那一档。
     *
     * triggerOrder 收的是 {usd} 对象；传位置参数会退回引擎的 forceBig
     * （那条路中位数只有约 $310 而 epic 门槛正好 $300 —— 老坑，别改回去）。 */
    /* 四个键各自走 engine 的 DEMO_LADDERS 阶梯，**不再在区间里随机取数**。
     * 原来是 `usd: 320 + hash(n)*450` 这种区间随机 —— 每个键的区间确实完整
     * 落在一档之内（这条设计是对的，保留），但**随机出来的金额几乎必然不在
     * 人声预渲染集合里**：实测覆盖率 C 键 91% / B 键 36% / V 键 **0.7%**。
     * 也就是 BD 在台上按 V 键，99% 的概率当场蹦出一句 2013 年的 Huihui。
     * 阶梯保证每一档都有整句音频，而且连按是递增的漂亮数字。 */
    else if (k === 'n' || k === 'N') {           /* 普通 <$110 */
      var no = E.triggerOrder({ usd: E.demoAmount('common', bKeyN++) });
      registerManualDisplay(no.usd);
    }
    else if (k === 'c' || k === 'C') {           /* 较大 $128 ~ $288 */
      var co = E.triggerOrder({ usd: E.demoAmount('rare', bKeyN++) });
      registerManualDisplay(co.usd);
    }
    else if (k === 'b' || k === 'B') {           /* 大额 $325 ~ $765 */
      var bo = E.triggerOrder({ usd: E.demoAmount('epic', bKeyN++) });
      registerManualDisplay(bo.usd);
    }
    else if (k === 'v' || k === 'V') {           /* 特大 $1,280 ~ $4,260 */
      var vo = E.triggerOrder({ usd: E.demoAmount('legendary', bKeyN++) });
      registerManualDisplay(vo.usd);
    }
    else if (k === 'k' || k === 'K') {
      if (A) { try { A.playMilestone(); } catch (e) {} }
      showMilestone(Math.ceil(E.metrics().pages / 1000) * 1000);
    }
    else if (k === 'm' || k === 'M') { toggleMute(); }
    else if (k === 'a' || k === 'A') { if (A) { AU.amb = !AU.amb; A.setAmbient(AU.amb); } }
    else if (k === 'h' || k === 'H') { if (A) { AU.hall = !AU.hall; A.setHallMode(AU.hall); } }
    else if (k === '1') E.setSpeed(0.5);
    else if (k === '2') E.setSpeed(1);
    else if (k === '3') E.setSpeed(3);
    else if (k === 'f' || k === 'F') toggleFull();
    else if (k === 'r' || k === 'R') root.location.reload();
    else if (k === 'g' || k === 'G') { if (gvOn) closeGlobe(); else openGlobe(); }
    else if (k === 'Escape') {
      if (gvOn) closeGlobe();
      else if (fpAnyOpen()) fpCloseAll();
      else if (drawer.classList.contains('on')) closeDrawer();
      else if (doc.getElementById('legend').classList.contains('on')) doc.getElementById('legend').classList.remove('on');
    }
    else if (k === '?' || k === '/') doc.getElementById('legend').classList.toggle('on');
  });

  /* 自检口 */
  root.APDiag = {
    /** 真实帧率（performance.now 口径）。验收看这个。 */
    get rafFps() { return rafFps; },
    /** 引擎口径的帧率。**偏低且不可信** —— 引擎的 dt 走 Date.now()，
     *  Windows 下分辨率只有约 15.6ms。留着只为和其他方案对照。 */
    get fpsAvg() { return fpsAvg; },
    get dom() { return doc.getElementsByTagName('*').length; },
    get hits() { return hits.length; },
    get seen() { return seenN; },
    get theme() { return THEMES[themeIdx].key + ' / ' + THEMES[themeIdx].name; },
    get themeCount() { return THEMES.length; },
    setTheme: function (i) { applyTheme(i); },
    get slotsPerRow() { return ORD_SLOT_TOTAL; },
    /* 整板波扫完的毫秒数（两列 154 格）。验收看这个判「机场牌」在不在 */
    get flipMs() { return Math.round(ORD_SLOT_TOTAL * 2 * boardStagger(false)); },
    get ordCols() { return ORD_PER_COL; },
    get flagCount() { return root.APFlags ? root.APFlags.count : 0; },
    get flipping() {
      var n = 0;
      for (var i = 0; i < ORD_ROWS; i++) if (oRows[i].active) n++;
      return n;
    },
    /** 扇区的起止角，测试要靠它算「真正落在扇区内」的坐标 */
    get pieItems() {
      return pieItems.map(function (it) {
        return { key: it.key, a0: it.a0, a1: it.a1, share: it.share, val: it.val };
      });
    },
    get popsLive() {
      var n = 0;
      for (var i = 0; i < pops.length; i++) if (pops[i].live) n++;
      return n;
    },
    get ordBuf() { return ordBuf.length; },
    get logBuf() { return logBuf.length; },
    get ordShown() { return ordView().length; },
    get logShown() { return logView().length; },
    setFilter: function (f) {
      /* 单值和数组都收：老调用方（渠道卡、既有验收脚本）传的是单值 */
      if (f.src !== undefined) oF.src = asArr(f.src);
      if (f.cc !== undefined) oF.cc = asArr(f.cc);
      if (f.tier !== undefined) oF.tier = asArr(f.tier);
      if (f.q !== undefined) { oF.q = f.q; qEl.value = f.q; }
      markFilterChips(); markChanSel(); syncFilterPop(); renderOrd(true);
      return ordView().length;
    },
    setSort: function (key, dir) { oSort.key = key; oSort.dir = dir; markSort(); renderOrd(true); },
    /** 屏上第一行（最新那笔）。视图按 oSort 排，别用 querySelector 取第一个。 */
    /** 最近进缓冲的那一笔（金额 + 档位）。验收「一个键一档」要用。 */
    get lastOrder() {
      var o = ordBuf.length ? ordBuf[ordBuf.length - 1] : null;
      return o ? { usd: o.usd, tier: o.tier, no: ordNo(o) } : null;
    },
    get topOrder() {
      var r = oRows[0], out = [], i, j;
      for (i = 0; i < ORD_COLS.length; i++) {
        if (!r.slots[i]) continue;
        var s = '';
        for (j = 0; j < r.slots[i].length; j++) s += r.slots[i][j].textContent;
        out.push(s);
      }
      return out.join('|');
    },
    get topLog() {
      var r = cRows[0], out = [], i;
      for (i = 0; i < r.cells.length; i++) out.push(r.cells[i].textContent);
      return out.join('|');
    },
    openDrawerAt: function (i) { openDrawer(oRows[i || 0].o); },
    closeDrawer: closeDrawer,
    exportCsv: function () { return exportOrders(); },
    metrics: function () { return E.metrics(); }
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window);
