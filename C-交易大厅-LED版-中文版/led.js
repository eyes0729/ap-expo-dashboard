/* ===========================================================================
 * AP 展会大屏 · 方案 C-LED「交易大厅」· 点阵 LED 文本渲染器  (window.APLed)
 * ---------------------------------------------------------------------------
 * 参考：东京站前证券电子报价墙 / 菲律宾交易所 LED 报价板
 *   （见 ../../参考-交易大厅/03-东京电子报价板.jpg、04-菲律宾交易所报价板.jpg）
 *
 * 让人一眼认出「这是交易大厅」的不是配色也不是版式，是两件事：
 *   1) 字形由一颗颗可见的灯珠组成
 *   2) **没点亮的灯珠也看得见**，形成一片暗的网格底纹
 * 第 2 条比第 1 条更关键 —— 只做亮点会像素化得像低分辨率字体，
 * 加上未点亮的底纹才有「一块真实 LED 板」的实体感。
 *
 * 怎么把任意文本变成点阵：
 *   手工维护点阵字库是常规做法（5x7 一个字形 7 个字节），但 36 个拉丁字形起步，
 *   中文根本没法手工做，而我们的商品名有德语/日语/西语。
 *   所以改成：把文本按「1 像素 = 1 颗灯珠」的比例画到离屏 canvas，
 *   再逐像素采样决定哪颗亮。任意字形、任意语言通吃，零字库维护。
 *   掩码结果按 (文本 + 字号 + 字体) 缓存，同一串文本只采样一次。
 *
 * classic script，零网络依赖。
 * =========================================================================== */
(function (root) {
  'use strict';

  var doc = root.document;

  /* 离屏采样画布。willReadFrequently 让 Chrome 用 CPU 后端，
   * getImageData 会快一个量级（这里每次内容变化才采样一次，但仍然值得）。 */
  var off = doc.createElement('canvas');
  var offc = off.getContext('2d', { willReadFrequently: true });

  /* 掩码缓存。店名/商品名/金额都是反复出现的短串，命中率很高。
   * 超过上限就整体清掉 —— 比维护 LRU 链表简单，且这个量级下代价可忽略。 */
  var CACHE = new Map();
  var CACHE_CAP = 1200;

  /* 采样阈值。文本在这么小的字号下抗锯齿严重，128 会吃掉细笔画，
   * 96 附近能保住笔画又不会把边缘毛刺算进来。 */
  var INK = 96;

  /**
   * 把文本量成点阵掩码。
   * @param {string} text
   * @param {number} px    离屏字号 = 点阵高度的控制量（1px 出 1 颗灯珠）
   * @param {string} fam   字体族
   * @param {boolean} bold
   * @returns {{w:number,h:number,base:number,bits:Uint8Array}}
   *          bits[y*w+x] 非 0 表示该颗灯珠点亮；base 是基线所在行（用于对齐）
   */
  function mask(text, px, fam, bold) {
    var key = px + '|' + (bold ? 'b' : 'n') + '|' + fam + '|' + text;
    var m = CACHE.get(key);
    if (m) return m;

    var font = (bold ? 'bold ' : '') + px + 'px ' + fam;
    offc.font = font;
    var mt;
    try { mt = offc.measureText(text); } catch (e) { mt = { width: px * text.length }; }

    /* 用实际墨迹边界裁剪，而不是 advance width —— 否则每个串左右会带上
     * 不等量的空白，格子里的对齐就全乱了。老引擎没有 actualBoundingBox* 时退回估算。 */
    var hasBox = typeof mt.actualBoundingBoxAscent === 'number' &&
                 typeof mt.actualBoundingBoxLeft === 'number';
    var l = hasBox ? Math.ceil(Math.max(0, mt.actualBoundingBoxLeft)) : 0;
    var r = hasBox ? Math.ceil(Math.max(1, mt.actualBoundingBoxRight)) : Math.ceil(mt.width);
    var a = hasBox ? Math.ceil(Math.max(1, mt.actualBoundingBoxAscent)) : Math.ceil(px * 0.72);
    var d = hasBox ? Math.ceil(Math.max(0, mt.actualBoundingBoxDescent)) : Math.ceil(px * 0.22);

    var w = l + r + 2, h = a + d + 2;
    if (w < 1) w = 1;
    if (h < 1) h = 1;
    if (w > 4000) w = 4000;

    off.width = w; off.height = h;
    offc.font = font;                    /* 改尺寸会清掉上下文状态，必须重设 */
    offc.textBaseline = 'alphabetic';
    offc.textAlign = 'left';
    offc.fillStyle = '#fff';
    offc.clearRect(0, 0, w, h);
    offc.fillText(text, l + 1, a + 1);

    var data;
    try { data = offc.getImageData(0, 0, w, h).data; }
    catch (e) { data = null; }

    var bits = new Uint8Array(w * h);
    if (data) {
      for (var i = 0, n = w * h; i < n; i++) {
        if (data[i * 4 + 3] >= INK) bits[i] = 1;
      }
    }

    m = { w: w, h: h, base: a + 1, bits: bits };
    if (CACHE.size >= CACHE_CAP) CACHE.clear();
    CACHE.set(key, m);
    return m;
  }

  /**
   * 把掩码里点亮的灯珠加进当前路径。调用方自己负责 beginPath / fillStyle / fill
   * —— 这样可以把同色的一大批灯珠合成一次 fill，8000 颗灯也只有几次绘制调用。
   * @param ctx
   * @param m      mask() 的返回值
   * @param ox,oy  左上角（设备像素）
   * @param pitch  灯珠间距
   * @param size   灯珠直径（<= pitch，留出缝隙才像 LED）
   * @param round  是否画圆点（大间距下圆点更真实，小间距下方点更清晰也更快）
   */
  function path(ctx, m, ox, oy, pitch, size, round) {
    var bits = m.bits, w = m.w, h = m.h;
    var off2 = (pitch - size) * 0.5;
    var rr = size * 0.5;
    for (var y = 0; y < h; y++) {
      var row = y * w, py = oy + y * pitch;
      for (var x = 0; x < w; x++) {
        if (!bits[row + x]) continue;
        var pxx = ox + x * pitch;
        if (round) {
          ctx.moveTo(pxx + off2 + size, py + off2 + rr);
          ctx.arc(pxx + off2 + rr, py + off2 + rr, rr, 0, 6.283185307179586);
        } else {
          ctx.rect(pxx + off2, py + off2, size, size);
        }
      }
    }
  }

  /** 掩码宽度（灯珠数）。排版时先量后画。 */
  function widthOf(text, px, fam, bold) { return mask(text, px, fam, bold).w; }

  /**
   * 未点亮的灯珠底纹。这是「实体 LED 板」质感的来源，必须有。
   * pattern 在初始化时建一次并缓存 —— 规格 §2.7 禁止在 rAF 里新建 pattern。
   */
  function dotField(ctx, pitch, size, color, round) {
    var c = doc.createElement('canvas');
    c.width = pitch; c.height = pitch;
    var g = c.getContext('2d');
    g.fillStyle = color;
    var o = (pitch - size) * 0.5, rr = size * 0.5;
    if (round) {
      g.beginPath();
      g.arc(o + rr, o + rr, rr, 0, 6.283185307179586);
      g.fill();
    } else {
      g.fillRect(o, o, size, size);
    }
    return ctx.createPattern(c, 'repeat');
  }

  /**
   * 把一串文本按「同类字符」打乱，用于里程碑的全屏齐翻。
   * 数字只换数字、字母只换字母、其他原样 —— 混着换会出乱码观感。
   */
  var DIG = '0123456789';
  var ALP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function scramble(text, seed, hash32) {
    var out = '', i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      if (ch >= '0' && ch <= '9') out += DIG.charAt((hash32(seed + i, 811) * 10) | 0);
      else if (ch >= 'A' && ch <= 'Z') out += ALP.charAt((hash32(seed + i, 823) * 26) | 0);
      else if (ch >= 'a' && ch <= 'z') out += ALP.charAt((hash32(seed + i, 827) * 26) | 0);
      else out += ch;
    }
    return out;
  }

  root.APLed = {
    mask: mask,
    path: path,
    widthOf: widthOf,
    dotField: dotField,
    scramble: scramble,
    clearCache: function () { CACHE.clear(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
