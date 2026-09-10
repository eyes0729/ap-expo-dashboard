/* ===========================================================================
 * 金额 → 中文读法 → 音频片段序列
 * ---------------------------------------------------------------------------
 * 为什么需要这一层：
 *   人声必须念**屏上那个确切金额**。支付宝之所以让人信，正是因为它念的是你
 *   收到的那个数，不是一个四舍五入过的近似值。而金额是连续的，不可能给每个
 *   金额预录一句 —— 所以只能像支付宝那样：**预录零件，运行时拼**。
 *
 * 零件的粒度是个设计选择：
 *   · 单字级（零一二三…十百千万）17 个片段最省，但拼出来每个字都是独立韵律，
 *     听着像老式电话报号，很"碎"。
 *   · **双字块级**（一百/二百…九千/五十…）48 个片段，每块本身就是自然的语流，
 *     拼接处少一半，听感明显更连。**这一版用它。**
 *
 * 中文读数的三条规则（写错了就会念出"一千二百八十"变成"一二八零"这种）：
 *   1. 零的压缩：连续的零只读一个「零」，末尾的零不读
 *        1005 → 一千零五      1050 → 一千零五十     1500 → 一千五百
 *   2. 万位分段：万以上按「万」分节，节内独立成读
 *        10500 → 一万零五百    25000 → 二万五千
 *   3. 「二」与「两」：千位和万位口语读「两」，百位读「二百」
 *        2000 → 两千          200 → 二百           20000 → 两万
 *      （播报口径按口语来，跟支付宝一致）
 * =========================================================================== */
(function (root) {
  'use strict';

  var DIGIT = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

  /** 1~9999 → token 数组。token 是音频片段名，双字块尽量合并。 */
  function under10k(n) {
    var out = [];
    var q = Math.floor(n / 1000), h = Math.floor(n % 1000 / 100),
        t = Math.floor(n % 100 / 10), o = n % 10;
    var zeroPending = false;

    if (q) {
      /* 千位口语读「两千」不读「二千」 */
      out.push((q === 2 ? '两' : DIGIT[q]) + '千');
    }
    if (h) {
      if (q && !h) zeroPending = true;
      out.push(DIGIT[h] + '百');
    } else if (q && (t || o)) {
      zeroPending = true;
    }
    if (t) {
      if (zeroPending) { out.push('零'); zeroPending = false; }
      /* 「一十」在有更高位时读「一十」，独立时读「十」 */
      out.push((t === 1 && !q && !h) ? '十' : DIGIT[t] + '十');
    } else if ((q || h) && o) {
      zeroPending = true;
    }
    if (o) {
      if (zeroPending) { out.push('零'); zeroPending = false; }
      out.push(DIGIT[o]);
    }
    return out;
  }

  /** 整数金额 → token 数组。支持 0 ~ 99,999,999。 */
  function toTokens(n) {
    n = Math.round(n);
    if (n <= 0) return ['零'];
    if (n < 10000) return under10k(n);

    var wan = Math.floor(n / 10000), rest = n % 10000;
    var out = [];
    /* 万位段。两万/两千万 口语用「两」 */
    var wanTokens = under10k(wan);
    if (wanTokens.length === 1 && wanTokens[0] === '二') wanTokens = ['两'];
    out = out.concat(wanTokens);
    out.push('万');

    if (rest === 0) return out;
    /* 万以下不足千 → 中间要补一个「零」：10500 → 一万零五百 */
    if (rest < 1000) out.push('零');
    return out.concat(under10k(rest));
  }

  /** 完整播报的片段序列：固定句 + 数字 + 单位 */
  function utterance(usd, opt) {
    opt = opt || {};
    var seq = [opt.prefix || 'prefix'];
    seq = seq.concat(toTokens(usd));
    seq.push(opt.unit || '美元');
    return seq;
  }

  /** 给人看的字符串（调试 / 生成素材清单用） */
  function toText(n) { return toTokens(n).join(''); }

  /** 全部需要预生成的片段（去重后的素材清单） */
  function allClips() {
    var set = {};
    /* 一~九 */
    for (var d = 1; d <= 9; d++) set[DIGIT[d]] = 1;
    /* 十位 / 百位 / 千位块 */
    for (d = 1; d <= 9; d++) {
      set[DIGIT[d] + '十'] = 1;
      set[DIGIT[d] + '百'] = 1;
      set[(d === 2 ? '两' : DIGIT[d]) + '千'] = 1;
    }
    set['十'] = 1; set['零'] = 1; set['万'] = 1; set['两'] = 1;
    set['美元'] = 1;
    return Object.keys(set);
  }

  var API = { toTokens: toTokens, toText: toText, utterance: utterance,
              allClips: allClips };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.APNum = API;
})(typeof window !== 'undefined' ? window : globalThis);
