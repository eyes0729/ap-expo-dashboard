/* ===========================================================================
 * 最小 QR 编码器 —— 字节模式 · 版本 1~6 · 纠错等级 M
 * ---------------------------------------------------------------------------
 * 为什么自己写：展会屏是**零网络依赖**的（规格 §2），不能调任何在线二维码接口，
 * 而本机也没有可用的二维码库。
 *
 * 为什么只做 1~6 版：
 *   ① 版本 ≥7 要额外写「版本信息块」（18 位 BCH），1~6 版不需要 —— 少一整块逻辑。
 *   ② 6 版在 M 级已能装 106 字节，而我们的 URL 只有 ~36 字节，用不到更高版本。
 *   ③ **版本越低模块越少 → 屏上每个模块越大 → 越好扫。** 展会上这一条最重要：
 *      3 版是 29×29，6 版是 41×41，同样尺寸下 3 版的模块大 40%。
 *
 * 为什么 1~6 版在 M 级不用处理「两组不等长分块」：
 *   实测这六个版本的数据块都是等分的（1/1/1/2/2/4 块，每块 16/28/44/32/43/27 字节），
 *   所以交织时不需要 group1/group2 的长短块逻辑。
 *
 * 导出：APQR.encode(text) -> { size, modules }  modules[row][col] 为 true 表示黑。
 * =========================================================================== */
(function (root) {
  'use strict';

  /* ── GF(256)，本原多项式 0x11D ───────────────────────────────────────── */
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1, i;
    for (i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  function gmul(a, b) { return (!a || !b) ? 0 : EXP[LOG[a] + LOG[b]]; }

  /** 生成多项式 ∏(x + α^i)，下标 0 为最高次项。 */
  function genPoly(n) {
    var g = [1], i, j, ng;
    for (i = 0; i < n; i++) {
      ng = new Array(g.length + 1);
      for (j = 0; j < ng.length; j++) ng[j] = 0;
      for (j = 0; j < g.length; j++) {
        ng[j] ^= g[j];                          /* × x */
        ng[j + 1] ^= gmul(g[j], EXP[i]);        /* × α^i */
      }
      g = ng;
    }
    return g;
  }

  /** 多项式长除法求余，即 Reed–Solomon 校验码。 */
  function rsEncode(data, ecLen) {
    var g = genPoly(ecLen), res = data.slice(), i, j, c;
    for (i = 0; i < ecLen; i++) res.push(0);
    for (i = 0; i < data.length; i++) {
      c = res[i];
      if (!c) continue;
      for (j = 0; j < g.length; j++) res[i + j] ^= gmul(g[j], c);
    }
    return res.slice(data.length);
  }

  /* ── 版本表（纠错等级 M）──────────────────────────────────────────────
   * total  该版本总码字数
   * ec     每块的纠错码字数
   * blocks 块数
   * cap    字节模式下可装的字节数（标准表值）
   * align  校正图形中心坐标 */
  var VER = {
    1: { total: 26,  ec: 10, blocks: 1, cap: 14,  align: [] },
    2: { total: 44,  ec: 16, blocks: 1, cap: 26,  align: [6, 18] },
    3: { total: 70,  ec: 26, blocks: 1, cap: 42,  align: [6, 22] },
    4: { total: 100, ec: 18, blocks: 2, cap: 62,  align: [6, 26] },
    5: { total: 134, ec: 24, blocks: 2, cap: 84,  align: [6, 30] },
    6: { total: 172, ec: 16, blocks: 4, cap: 106, align: [6, 34] }
  };

  function pickVersion(len) {
    for (var v = 1; v <= 6; v++) if (len <= VER[v].cap) return v;
    return 0;
  }

  /* ── UTF-8 编码（URL 里可能有被百分号转义的中文，但也可能直接是中文）── */
  function toBytes(s) {
    var out = [], i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 63)); }
      else if (c < 0xD800 || c >= 0xE000) {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      } else {                                   /* 代理对 */
        i++;
        var c2 = s.charCodeAt(i);
        var cp = 0x10000 + ((c & 0x3FF) << 10) + (c2 & 0x3FF);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
                 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      }
    }
    return out;
  }

  /* ── 格式信息：5 位（2 位纠错等级 + 3 位掩码）+ 10 位 BCH，再异或 0x5412 ── */
  function formatBits(mask) {
    var d = (0 << 3) | mask;                     /* 纠错等级 M = 0b00 */
    var rem = d, i;
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >> 9) & 1) * 0x537);
    return (((d << 10) | rem) ^ 0x5412) & 0x7FFF;
  }

  /* ── 掩码函数 ────────────────────────────────────────────────────────── */
  var MASKS = [
    function (i, j) { return (i + j) % 2 === 0; },
    function (i)    { return i % 2 === 0; },
    function (i, j) { return j % 3 === 0; },
    function (i, j) { return (i + j) % 3 === 0; },
    function (i, j) { return ((i >> 1) + Math.floor(j / 3)) % 2 === 0; },
    function (i, j) { return (i * j) % 2 + (i * j) % 3 === 0; },
    function (i, j) { return ((i * j) % 2 + (i * j) % 3) % 2 === 0; },
    function (i, j) { return ((i + j) % 2 + (i * j) % 3) % 2 === 0; }
  ];

  /* ── 惩罚分（标准四条规则），用来挑最优掩码 ──────────────────────────── */
  function penalty(m, size) {
    var p = 0, i, j, run, cur, k;
    /* 规则 1：同色连续 5 格以上 */
    function scanLine(get) {
      run = 1; cur = get(0);
      for (k = 1; k < size; k++) {
        var v = get(k);
        if (v === cur) { run++; }
        else { if (run >= 5) p += 3 + (run - 5); cur = v; run = 1; }
      }
      if (run >= 5) p += 3 + (run - 5);
    }
    for (i = 0; i < size; i++) {
      (function (r) { scanLine(function (c) { return m[r][c]; }); })(i);
      (function (c) { scanLine(function (r) { return m[r][c]; }); })(i);
    }
    /* 规则 2：2×2 同色块 */
    for (i = 0; i < size - 1; i++) for (j = 0; j < size - 1; j++) {
      var a = m[i][j];
      if (a === m[i][j + 1] && a === m[i + 1][j] && a === m[i + 1][j + 1]) p += 3;
    }
    /* 规则 3：1:1:3:1:1 + 4 空白 的类定位图形 */
    var PAT = [true, false, true, true, true, false, true, false, false, false, false];
    function matchAt(get, at) {
      for (var t = 0; t < 11; t++) if (get(at + t) !== PAT[t]) return false;
      return true;
    }
    function matchAtRev(get, at) {
      for (var t = 0; t < 11; t++) if (get(at + t) !== PAT[10 - t]) return false;
      return true;
    }
    for (i = 0; i < size; i++) {
      for (j = 0; j <= size - 11; j++) {
        var gr = (function (r) { return function (c) { return m[r][c]; }; })(i);
        var gc = (function (c) { return function (r) { return m[r][c]; }; })(i);
        if (matchAt(gr, j) || matchAtRev(gr, j)) p += 40;
        if (matchAt(gc, j) || matchAtRev(gc, j)) p += 40;
      }
    }
    /* 规则 4：黑格比例偏离 50% */
    var dark = 0;
    for (i = 0; i < size; i++) for (j = 0; j < size; j++) if (m[i][j]) dark++;
    var pct = dark * 100 / (size * size);
    p += 10 * Math.floor(Math.abs(pct - 50) / 5);
    return p;
  }

  /* ── 主流程 ──────────────────────────────────────────────────────────── */
  function encode(text, forceMask) {
    var bytes = toBytes(String(text));
    var ver = pickVersion(bytes.length);
    if (!ver) throw new Error('QR: 内容过长（字节模式 M 级最多 106 字节），实际 ' + bytes.length);
    var spec = VER[ver];
    var size = 17 + 4 * ver;
    var dataTotal = spec.total - spec.ec * spec.blocks;
    var perBlock = dataTotal / spec.blocks;

    /* 1) 比特流：模式(4) + 字数(8，1~9 版都是 8 位) + 数据 + 终止符 + 填充 */
    var bits = [];
    function push(val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); }
    push(0x4, 4);
    push(bytes.length, 8);
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);
    var capBits = dataTotal * 8;
    var term = Math.min(4, capBits - bits.length);
    for (i = 0; i < term; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var pad = [0xEC, 0x11], pi = 0;
    while (bits.length < capBits) { push(pad[pi++ % 2], 8); }

    /* 2) 分块 + 纠错 + 交织（1~6 版 M 级都是等分块，无长短块之分） */
    var codewords = [];
    for (i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
      codewords.push(b);
    }
    var dBlocks = [], eBlocks = [], bi;
    for (bi = 0; bi < spec.blocks; bi++) {
      var blk = codewords.slice(bi * perBlock, (bi + 1) * perBlock);
      dBlocks.push(blk);
      eBlocks.push(rsEncode(blk, spec.ec));
    }
    var final = [];
    for (i = 0; i < perBlock; i++) for (bi = 0; bi < spec.blocks; bi++) final.push(dBlocks[bi][i]);
    for (i = 0; i < spec.ec; i++) for (bi = 0; bi < spec.blocks; bi++) final.push(eBlocks[bi][i]);
    var allBits = [];
    for (i = 0; i < final.length; i++) for (k = 7; k >= 0; k--) allBits.push((final[i] >> k) & 1);

    /* 3) 骨架：功能图形 */
    var m = [], func = [], r, c;
    for (r = 0; r < size; r++) {
      m.push(new Array(size));
      func.push(new Array(size));
      for (c = 0; c < size; c++) { m[r][c] = false; func[r][c] = false; }
    }
    function setF(r2, c2, v) { m[r2][c2] = v; func[r2][c2] = true; }

    function finder(r0, c0) {
      for (r = -1; r <= 7; r++) for (c = -1; c <= 7; c++) {
        var rr = r0 + r, cc = c0 + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        var d = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        setF(rr, cc, d !== 2 && d <= 3);        /* 3x3 实心 + 1 圈白 + 1 圈黑 */
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    /* 定位图形（第 6 行 / 第 6 列交替） */
    for (i = 8; i < size - 8; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }

    /* 校正图形 */
    var al = spec.align;
    for (i = 0; i < al.length; i++) for (var j2 = 0; j2 < al.length; j2++) {
      var ar = al[i], ac = al[j2];
      /* 与三个定位图形重叠的位置不画 */
      if ((ar <= 8 && ac <= 8) || (ar <= 8 && ac >= size - 9) || (ar >= size - 9 && ac <= 8)) continue;
      for (r = -2; r <= 2; r++) for (c = -2; c <= 2; c++) {
        setF(ar + r, ac + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
      }
    }

    /* 固定黑点 + 预留格式信息区 */
    setF(size - 8, 8, true);
    for (i = 0; i <= 8; i++) {
      if (!func[8][i]) setF(8, i, false);
      if (!func[i][8]) setF(i, 8, false);
    }
    for (i = 0; i < 8; i++) {
      if (!func[8][size - 1 - i]) setF(8, size - 1 - i, false);
      if (!func[size - 1 - i][8]) setF(size - 1 - i, 8, false);
    }

    /* 4) 数据布局：从右下角起，两列一组的 Z 字形，跳过第 6 列 */
    var bitIdx = 0, dir = -1;
    r = size - 1;
    for (c = size - 1; c > 0; c -= 2) {
      if (c === 6) c--;                          /* 跳过定位列 */
      for (;;) {
        for (var t = 0; t < 2; t++) {
          var cc2 = c - t;
          if (!func[r][cc2]) {
            m[r][cc2] = (bitIdx < allBits.length) ? (allBits[bitIdx++] === 1) : false;
          }
        }
        r += dir;
        if (r < 0 || r >= size) { r -= dir; dir = -dir; break; }
      }
    }

    /* 5) 八个掩码全试，按标准惩罚分挑最优 */
    var best = null, bestP = Infinity, bestMask = 0;
    for (var mk = 0; mk < 8; mk++) {
      if (forceMask != null && mk !== forceMask) continue;
      var cand = [];
      for (r = 0; r < size; r++) {
        cand.push(m[r].slice());
        for (c = 0; c < size; c++) {
          if (!func[r][c] && MASKS[mk](r, c)) cand[r][c] = !cand[r][c];
        }
      }
      /* 惩罚分要在写入格式信息之后算，所以先写一份 */
      writeFormat(cand, size, mk);
      var p = penalty(cand, size);
      if (p < bestP) { bestP = p; best = cand; bestMask = mk; }
    }
    return { size: size, modules: best, version: ver, mask: bestMask, bytes: bytes.length };
  }

  /** 格式信息的两份拷贝（ISO/IEC 18004 的放置规则）。位序：bit0 为最低位。
   *
   * ⚠ 这里第一版写反了：把 bit0~5 放到了第 8 **行**（横向那份），
   *   而标准是 bit0~5 走第 8 **列**（竖向那份）—— 两份拷贝整体转置。
   *   后果是数据区完全正确、只有 12 个格式信息模块错，扫描器读不到掩码编号，
   *   于是整张码作废。交叉校验（对比 Kazuhiko Arase 那份实现）才逮到。
   *
   *   竖向那份 → 第 8 列：bit 0~5 → 行 0~5；bit 6~7 → 行 7~8；bit 8~14 → 行 size-7~size-1
   *   横向那份 → 第 8 行：bit 0~7 → 列 size-1~size-8；bit 8 → 列 7；bit 9~14 → 列 5~0
   */
  function writeFormat(m, size, mask) {
    var f = formatBits(mask), i, v;
    function bit(n) { return ((f >> n) & 1) === 1; }
    for (i = 0; i < 15; i++) {                   /* 竖向：第 8 列 */
      v = bit(i);
      if (i < 6) m[i][8] = v;
      else if (i < 8) m[i + 1][8] = v;
      else m[size - 15 + i][8] = v;
    }
    for (i = 0; i < 15; i++) {                   /* 横向：第 8 行 */
      v = bit(i);
      if (i < 8) m[8][size - 1 - i] = v;
      else if (i < 9) m[8][7] = v;
      else m[8][14 - i] = v;
    }
    m[size - 8][8] = true;                       /* 固定黑点，不能被覆盖 */
  }

  /** 画到 canvas。quiet 为静区模块数（标准要求 ≥4）。 */
  function draw(cv, text, opt) {
    opt = opt || {};
    var q = (opt.quiet == null) ? 4 : opt.quiet;
    var res = encode(text);
    var n = res.size + q * 2;
    var scale = Math.max(1, Math.floor((opt.size || 280) / n));
    var px = n * scale;
    cv.width = px; cv.height = px;
    var g = cv.getContext('2d');
    g.fillStyle = opt.light || '#FFFFFF';
    g.fillRect(0, 0, px, px);
    g.fillStyle = opt.dark || '#000000';
    for (var r = 0; r < res.size; r++) for (var c = 0; c < res.size; c++) {
      if (res.modules[r][c]) g.fillRect((c + q) * scale, (r + q) * scale, scale, scale);
    }
    return { version: res.version, mask: res.mask, size: res.size, scale: scale, px: px };
  }

  root.APQR = { encode: encode, draw: draw, pickVersion: pickVersion, toBytes: toBytes };

})(typeof window !== 'undefined' ? window : globalThis);
