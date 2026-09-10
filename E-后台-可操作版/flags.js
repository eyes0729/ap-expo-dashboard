/* ===========================================================================
 * 国旗（window.APFlags）—— 24×16 内联 SVG，零网络依赖
 * ---------------------------------------------------------------------------
 * **为什么不能用 emoji 国旗（🇺🇸）**：Windows 至今不渲染 regional indicator
 * 组合，🇺🇸 在展会那台机器上显示成两个方块字母 "US" —— 换了个更糟的样子。
 * macOS 上看着好好的，这正是它危险的地方（本机测不出来）。所以只能画。
 *
 * **简化到什么程度**：显示尺寸 26×18 px，美国旗的 50 颗星、印度的法轮、
 * 南非的盾徽在这个尺寸下本来就是几个像素的糊点。所以只保留**在 26px 上
 * 真正可分辨的特征**：条纹方向与配色、角标、中心图形的轮廓。
 * 这不是偷工减料 —— 画上去也看不见，还会糊成噪点。
 *
 * 覆盖 app.js 的 CC_CN 全部 54 个国家。查不到的走 fb()（色块 + 国家码），
 * 绝不返回空 —— 空的那一格会变成版面上一个洞（README 记过 'AE' 那次）。
 * =========================================================================== */
(function (root) {
  'use strict';

  var W = 24, H = 16;
  function open(extra) {
    return '<svg class="fl" viewBox="0 0 24 16" width="24" height="16" '
         + 'preserveAspectRatio="none" aria-hidden="true">' + (extra || '');
  }
  /* 白底旗（日本/波兰/芬兰…）在深色面板上会和背景糊在一起，统一压一道极淡的边 */
  var EDGE = '<rect x=".25" y=".25" width="23.5" height="15.5" fill="none" '
           + 'stroke="rgba(128,128,128,.45)" stroke-width=".5"/></svg>';

  /** 横条（等分） */
  function hs() {
    var c = arguments, n = c.length, h = H / n, s = open(), i;
    for (i = 0; i < n; i++) {
      s += '<rect y="' + (i * h).toFixed(2) + '" width="24" height="' + (h + .02).toFixed(2)
         + '" fill="' + c[i] + '"/>';
    }
    return s + EDGE;
  }
  /** 竖条（等分） */
  function vs() {
    var c = arguments, n = c.length, w = W / n, s = open(), i;
    for (i = 0; i < n; i++) {
      s += '<rect x="' + (i * w).toFixed(2) + '" width="' + (w + .02).toFixed(2)
         + '" height="16" fill="' + c[i] + '"/>';
    }
    return s + EDGE;
  }
  /** 北欧十字：竖臂偏左（真实比例，别居中） */
  function nordic(bg, cross, inner) {
    var s = open() + '<rect width="24" height="16" fill="' + bg + '"/>'
      + '<path d="M8.5 0v16M0 8h24" stroke="' + cross + '" stroke-width="4.4"/>';
    if (inner) s += '<path d="M8.5 0v16M0 8h24" stroke="' + inner + '" stroke-width="1.9"/>';
    return s + EDGE;
  }
  /** 米字旗本体，可嵌进角标 */
  function jack(w, h) {
    var sc = 'transform="scale(' + (w / 24) + ',' + (h / 16) + ')"';
    return '<g ' + sc + '><rect width="24" height="16" fill="#012169"/>'
      + '<path d="M0 0L24 16M24 0L0 16" stroke="#FFF" stroke-width="3.2"/>'
      + '<path d="M0 0L24 16M24 0L0 16" stroke="#C8102E" stroke-width="1.5"/>'
      + '<path d="M12 0v16M0 8h24" stroke="#FFF" stroke-width="5.2"/>'
      + '<path d="M12 0v16M0 8h24" stroke="#C8102E" stroke-width="3"/></g>';
  }
  /** 五角星（用于国旗中心图形） */
  function star(cx, cy, r, fill, rot) {
    var p = '', i, a, rr;
    for (i = 0; i < 10; i++) {
      a = (rot || -90) * Math.PI / 180 + i * Math.PI / 5;
      rr = i % 2 ? r * .382 : r;
      p += (i ? 'L' : 'M') + (cx + Math.cos(a) * rr).toFixed(2)
         + ' ' + (cy + Math.sin(a) * rr).toFixed(2);
    }
    return '<path d="' + p + 'Z" fill="' + fill + '"/>';
  }
  /** 兜底：灰蓝色块 + 国家码。绝不返回空 */
  function fb(cc) {
    return open() + '<rect width="24" height="16" fill="#3A4250"/>'
      + '<text x="12" y="11.5" text-anchor="middle" font-size="8.5" font-weight="700"'
      + ' fill="#C9D1DE" font-family="system-ui,sans-serif">' + cc + '</text>' + EDGE;
  }

  var F = {
    /* ── 竖三色 ─────────────────────────────────────────────── */
    FR: function () { return vs('#002395', '#FFFFFF', '#ED2939'); },
    IT: function () { return vs('#009246', '#FFFFFF', '#CE2B37'); },
    IE: function () { return vs('#169B62', '#FFFFFF', '#FF883E'); },
    BE: function () { return vs('#000000', '#FAE042', '#ED2939'); },
    RO: function () { return vs('#002B7F', '#FCD116', '#CE1126'); },
    NG: function () { return vs('#008751', '#FFFFFF', '#008751'); },
    PE: function () { return vs('#D91023', '#FFFFFF', '#D91023'); },
    /* ── 横三色 / 双色 ──────────────────────────────────────── */
    DE: function () { return hs('#000000', '#DD0000', '#FFCE00'); },
    NL: function () { return hs('#AE1C28', '#FFFFFF', '#21468B'); },
    AT: function () { return hs('#ED2939', '#FFFFFF', '#ED2939'); },
    HU: function () { return hs('#CE2939', '#FFFFFF', '#477050'); },
    ID: function () { return hs('#CE1126', '#FFFFFF'); },
    PL: function () { return hs('#FFFFFF', '#DC143C'); },
    UA: function () { return hs('#005BBB', '#FFD500'); },
    EG: function () { return hs('#CE1126', '#FFFFFF', '#000000'); },
    /* 西班牙 红1:黄2:红1，纹章在 26px 上看不见，省 */
    ES: function () {
      return open() + '<rect width="24" height="16" fill="#AA151B"/>'
        + '<rect y="4" width="24" height="8" fill="#F1BF00"/>' + EDGE;
    },
    /* 泰国 红/白/蓝(双高)/白/红 */
    TH: function () {
      return open() + '<rect width="24" height="16" fill="#A51931"/>'
        + '<rect y="2.7" width="24" height="10.6" fill="#F4F5F8"/>'
        + '<rect y="5.3" width="24" height="5.4" fill="#2D2A4A"/>' + EDGE;
    },
    /* 哥伦比亚 黄占一半 */
    CO: function () {
      return open() + '<rect width="24" height="16" fill="#FCD116"/>'
        + '<rect y="8" width="24" height="4" fill="#003893"/>'
        + '<rect y="12" width="24" height="4" fill="#CE1126"/>' + EDGE;
    },
    /* 希腊 九条 + 左上十字 */
    GR: function () {
      var s = open() + '<rect width="24" height="16" fill="#FFFFFF"/>', i;
      for (i = 0; i < 5; i++) s += '<rect y="' + (i * 3.56).toFixed(2) + '" width="24" height="1.78" fill="#0D5EAF"/>';
      s += '<rect width="8.9" height="8.9" fill="#0D5EAF"/>'
         + '<path d="M4.45 0v8.9M0 4.45h8.9" stroke="#FFF" stroke-width="1.8"/>';
      return s + EDGE;
    },
    /* ── 北欧十字 ───────────────────────────────────────────── */
    DK: function () { return nordic('#C60C30', '#FFFFFF'); },
    NO: function () { return nordic('#EF2B2D', '#FFFFFF', '#002868'); },
    SE: function () { return nordic('#006AA7', '#FECC00'); },
    FI: function () { return nordic('#FFFFFF', '#003580'); },
    /* ── 米字旗系 ───────────────────────────────────────────── */
    GB: function () { return open() + jack(24, 16) + EDGE; },
    AU: function () {
      return open() + '<rect width="24" height="16" fill="#012169"/>' + jack(12, 8)
        + star(6, 12.4, 2.1, '#FFF') + star(19, 4.4, 1.5, '#FFF')
        + star(16.4, 8.6, 1.2, '#FFF') + star(20.8, 10.6, 1.2, '#FFF')
        + star(18.2, 13, 1.1, '#FFF') + EDGE;
    },
    NZ: function () {
      return open() + '<rect width="24" height="16" fill="#012169"/>' + jack(12, 8)
        + star(17, 4.2, 1.4, '#C8102E') + star(20.4, 7.4, 1.4, '#C8102E')
        + star(16.6, 11.4, 1.4, '#C8102E') + star(20, 14, 1.2, '#C8102E') + EDGE;
    },
    /* ── 星月系 ─────────────────────────────────────────────── */
    PK: function () {
      return open() + '<rect width="24" height="16" fill="#01411C"/>'
        + '<rect width="6" height="16" fill="#FFFFFF"/>'
        + '<circle cx="15.6" cy="8" r="4.4" fill="#FFF"/>'
        + '<circle cx="17.4" cy="7.2" r="4" fill="#01411C"/>'
        + star(18.9, 5.4, 1.9, '#FFF') + EDGE;
    },
    TR: function () {
      return open() + '<rect width="24" height="16" fill="#E30A17"/>'
        + '<circle cx="9.4" cy="8" r="4" fill="#FFF"/>'
        + '<circle cx="11" cy="8" r="3.2" fill="#E30A17"/>'
        + star(15, 8, 2, '#FFF') + EDGE;
    },
    MY: function () {
      var s = open() + '<rect width="24" height="16" fill="#FFFFFF"/>', i;
      for (i = 0; i < 7; i++) s += '<rect y="' + (i * 2.286).toFixed(2) + '" width="24" height="1.14" fill="#CC0001"/>';
      s += '<rect width="13" height="9.14" fill="#010066"/>'
         + '<circle cx="5.6" cy="4.6" r="3" fill="#FFCC00"/>'
         + '<circle cx="7" cy="4.2" r="2.5" fill="#010066"/>'
         + star(10.2, 4.6, 1.8, '#FFCC00');
      return s + EDGE;
    },
    SG: function () {
      return open() + '<rect width="24" height="16" fill="#FFFFFF"/>'
        + '<rect width="24" height="8" fill="#ED2939"/>'
        + '<circle cx="5.6" cy="4" r="2.8" fill="#FFF"/>'
        + '<circle cx="7.2" cy="4" r="2.4" fill="#ED2939"/>'
        + star(10.4, 2.5, 1, '#FFF') + star(12.5, 4, 1, '#FFF')
        + star(10.4, 5.6, 1, '#FFF') + EDGE;
    },
    MA: function () {
      return open() + '<rect width="24" height="16" fill="#C1272D"/>'
        + star(12, 8, 3.6, 'none').replace('fill="none"', 'fill="none" stroke="#006233" stroke-width="1"') + EDGE;
    },
    /* ── 日月星系 ───────────────────────────────────────────── */
    JP: function () {
      return open() + '<rect width="24" height="16" fill="#FFFFFF"/>'
        + '<circle cx="12" cy="8" r="4.6" fill="#BC002D"/>' + EDGE;
    },
    BD: function () {
      return open() + '<rect width="24" height="16" fill="#006A4E"/>'
        + '<circle cx="10.8" cy="8" r="4.6" fill="#F42A41"/>' + EDGE;
    },
    VN: function () {
      return open() + '<rect width="24" height="16" fill="#DA251D"/>'
        + star(12, 8, 4.4, '#FFFF00') + EDGE;
    },
    CN: function () {
      return open() + '<rect width="24" height="16" fill="#DE2910"/>'
        + star(4.8, 4.4, 3, '#FFDE00')
        + star(9.6, 1.9, 1.15, '#FFDE00') + star(11.4, 4, 1.15, '#FFDE00')
        + star(11.2, 6.8, 1.15, '#FFDE00') + star(9.2, 8.6, 1.15, '#FFDE00') + EDGE;
    },
    TW: function () {
      return open() + '<rect width="24" height="16" fill="#FE0000"/>'
        + '<rect width="12" height="8" fill="#000095"/>'
        + '<circle cx="6" cy="4" r="2.9" fill="#FFF"/>'
        + '<circle cx="6" cy="4" r="1.9" fill="#000095"/>' + EDGE;
    },
    HK: function () {
      return open() + '<rect width="24" height="16" fill="#DE2910"/>'
        + '<circle cx="12" cy="8" r="1.5" fill="#FFF"/>'
        + star(12, 4.1, 1.6, '#FFF') + star(15.7, 6.8, 1.6, '#FFF', -18)
        + star(14.3, 11.2, 1.6, '#FFF', 54) + star(9.7, 11.2, 1.6, '#FFF', 126)
        + star(8.3, 6.8, 1.6, '#FFF', 198) + EDGE;
    },
    KR: function () {
      return open() + '<rect width="24" height="16" fill="#FFFFFF"/>'
        + '<path d="M12 4.4a3.6 3.6 0 010 7.2 3.6 3.6 0 010-7.2z" fill="#CD2E3A"/>'
        + '<path d="M12 4.4a1.8 1.8 0 000 3.6 1.8 1.8 0 010 3.6 3.6 3.6 0 010-7.2z" fill="#0047A0"/>'
        + '<g stroke="#000" stroke-width=".7"><path d="M3.4 3.6l2.2 1.5M3.4 5l2.2 1.5"/>'
        + '<path d="M18.4 9.4l2.2 1.5M18.4 10.8l2.2 1.5"/></g>' + EDGE;
    },
    /* ── 其它自定 ───────────────────────────────────────────── */
    US: function () {
      var s = open(), i;
      s += '<rect width="24" height="16" fill="#FFFFFF"/>';
      for (i = 0; i < 7; i++) s += '<rect y="' + (i * 2.462).toFixed(2) + '" width="24" height="1.231" fill="#B22234"/>';
      s += '<rect width="10.2" height="8.6" fill="#3C3B6E"/>';
      for (i = 0; i < 9; i++) {
        s += '<circle cx="' + (1.3 + (i % 5) * 2).toFixed(2) + '" cy="'
           + (1.5 + ((i / 5) | 0) * 1.9).toFixed(2) + '" r=".52" fill="#FFF"/>';
      }
      s += '<circle cx="2.3" cy="5.3" r=".52" fill="#FFF"/><circle cx="4.3" cy="5.3" r=".52" fill="#FFF"/>'
         + '<circle cx="6.3" cy="5.3" r=".52" fill="#FFF"/><circle cx="8.3" cy="5.3" r=".52" fill="#FFF"/>'
         + '<circle cx="1.3" cy="7.2" r=".52" fill="#FFF"/><circle cx="3.3" cy="7.2" r=".52" fill="#FFF"/>'
         + '<circle cx="5.3" cy="7.2" r=".52" fill="#FFF"/><circle cx="7.3" cy="7.2" r=".52" fill="#FFF"/>'
         + '<circle cx="9.3" cy="7.2" r=".52" fill="#FFF"/>';
      return s + EDGE;
    },
    CA: function () {
      return open() + '<rect width="24" height="16" fill="#FFFFFF"/>'
        + '<rect width="6" height="16" fill="#FF0000"/><rect x="18" width="6" height="16" fill="#FF0000"/>'
        + '<path d="M12 3.2l.9 2.1 2-.7-.7 2.3 1.6.3-2.1 1.7.5 1.3-2-.4.1 2.6h-.6l.1-2.6-2 .4.5-1.3L8.2 7.2l1.6-.3-.7-2.3 2 .7z" fill="#FF0000"/>' + EDGE;
    },
    MX: function () {
      return open() + '<rect width="24" height="16" fill="#FFFFFF"/>'
        + '<rect width="8" height="16" fill="#006847"/><rect x="16" width="8" height="16" fill="#CE1126"/>'
        + '<ellipse cx="12" cy="8" rx="1.9" ry="1.5" fill="none" stroke="#8B5A2B" stroke-width=".9"/>' + EDGE;
    },
    BR: function () {
      return open() + '<rect width="24" height="16" fill="#009C3B"/>'
        + '<path d="M12 1.8L22.4 8 12 14.2 1.6 8z" fill="#FFDF00"/>'
        + '<circle cx="12" cy="8" r="3.1" fill="#002776"/>'
        + '<path d="M9.1 6.9a9 9 0 015.9.8" stroke="#FFF" stroke-width=".8" fill="none"/>' + EDGE;
    },
    AR: function () {
      return open() + '<rect width="24" height="16" fill="#FFFFFF"/>'
        + '<rect width="24" height="5.33" fill="#74ACDF"/>'
        + '<rect y="10.67" width="24" height="5.33" fill="#74ACDF"/>'
        + '<circle cx="12" cy="8" r="1.7" fill="#F6B40E"/>' + EDGE;
    },
    CL: function () {
      return open() + '<rect width="24" height="16" fill="#FFFFFF"/>'
        + '<rect y="8" width="24" height="8" fill="#D52B1E"/>'
        + '<rect width="8" height="8" fill="#0039A6"/>'
        + star(4, 4, 2.4, '#FFF') + EDGE;
    },
    CZ: function () {
      return open() + '<rect width="24" height="16" fill="#FFFFFF"/>'
        + '<rect y="8" width="24" height="8" fill="#D7141A"/>'
        + '<path d="M0 0l10 8-10 8z" fill="#11457E"/>' + EDGE;
    },
    PH: function () {
      return open() + '<rect width="24" height="16" fill="#0038A8"/>'
        + '<rect y="8" width="24" height="8" fill="#CE1126"/>'
        + '<path d="M0 0l11 8L0 16z" fill="#FFF"/>'
        + '<circle cx="3.4" cy="8" r="1.7" fill="#FCD116"/>' + EDGE;
    },
    CH: function () {
      return open() + '<rect width="24" height="16" fill="#D52B1E"/>'
        + '<path d="M12 3.6v8.8M7.6 8h8.8" stroke="#FFF" stroke-width="2.6"/>' + EDGE;
    },
    IL: function () {
      return open() + '<rect width="24" height="16" fill="#FFFFFF"/>'
        + '<rect y="1.4" width="24" height="2.2" fill="#0038B8"/>'
        + '<rect y="12.4" width="24" height="2.2" fill="#0038B8"/>'
        + '<path d="M12 5l2.6 4.5H9.4zM12 11L9.4 6.5h5.2z" fill="none" stroke="#0038B8" stroke-width=".85"/>' + EDGE;
    },
    IN: function () {
      return open() + '<rect width="24" height="16" fill="#FFFFFF"/>'
        + '<rect width="24" height="5.33" fill="#FF9933"/>'
        + '<rect y="10.67" width="24" height="5.33" fill="#138808"/>'
        + '<circle cx="12" cy="8" r="2" fill="none" stroke="#000080" stroke-width=".8"/>' + EDGE;
    },
    AE: function () {
      return open() + '<rect width="24" height="16" fill="#FFFFFF"/>'
        + '<rect width="24" height="5.33" fill="#00732F"/>'
        + '<rect y="10.67" width="24" height="5.33" fill="#000000"/>'
        + '<rect width="6.4" height="16" fill="#FF0000"/>' + EDGE;
    },
    SA: function () {
      return open() + '<rect width="24" height="16" fill="#006C35"/>'
        + '<rect x="4" y="4.6" width="16" height="1.5" fill="#FFF"/>'
        + '<path d="M4 10.4h14.4M18.4 9.2v2.4" stroke="#FFF" stroke-width="1.1"/>' + EDGE;
    },
    PT: function () {
      return open() + '<rect width="24" height="16" fill="#DA291C"/>'
        + '<rect width="9.6" height="16" fill="#046A38"/>'
        + '<circle cx="9.6" cy="8" r="3.1" fill="none" stroke="#FFE900" stroke-width="1.1"/>'
        + '<rect x="8.2" y="6.6" width="2.8" height="2.8" fill="#FFF" stroke="#DA291C" stroke-width=".5"/>' + EDGE;
    },
    ZA: function () {
      return open() + '<rect width="24" height="16" fill="#002395"/>'
        + '<rect width="24" height="8" fill="#DE3831"/>'
        + '<path d="M0 0l9 8-9 8V0z" fill="#007A4D"/>'
        + '<path d="M0 1.4l7.6 6.6L0 14.6" fill="none" stroke="#FFF" stroke-width="1.6"/>'
        + '<path d="M0 8h24" stroke="#FFF" stroke-width="1.5"/>'
        + '<path d="M8.4 8H24" stroke="#FFB915" stroke-width="1.5"/>'
        + '<path d="M0 0l9 8-9 8V0z" fill="#007A4D"/>' + EDGE;
    },
    KE: function () {
      return open() + '<rect width="24" height="16" fill="#FFFFFF"/>'
        + '<rect width="24" height="4.6" fill="#000000"/>'
        + '<rect y="5.4" width="24" height="5.2" fill="#BB0000"/>'
        + '<rect y="11.4" width="24" height="4.6" fill="#006600"/>'
        + '<ellipse cx="12" cy="8" rx="2.1" ry="3.4" fill="#BB0000" stroke="#FFF" stroke-width=".7"/>' + EDGE;
    }
  };

  var cache = {};
  root.APFlags = {
    /** 返回内联 SVG 字符串；未收录的国家走兜底色块，绝不返回空 */
    svg: function (cc) {
      cc = String(cc || '').toUpperCase();
      if (cache[cc]) return cache[cc];
      var f = F[cc];
      return (cache[cc] = f ? f() : fb(cc || '??'));
    },
    has: function (cc) { return !!F[String(cc || '').toUpperCase()]; },
    count: Object.keys(F).length
  };
})(typeof window !== 'undefined' ? window : this);
