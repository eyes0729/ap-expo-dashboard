/* ===========================================================================
 * AP 展会大屏 · 方案 B「引力井」· 地球渲染器   (window.APGlobe)
 * ---------------------------------------------------------------------------
 * 一句话：全世界的 AI 正在往你的店里落。
 *
 * 为什么是 Canvas 2D 而不是 Three.js / WebGL：
 *   1) 规格禁止 CDN（展会现场断网必须照跑），自带一份 WebGL 封装等于自己维护引擎；
 *   2) WebGL 连跑 8~10 小时有 context lost 的确定性风险，恢复逻辑本身就是新 bug 源；
 *   3) 本方案的球体是「真实城市点云 + 经纬线 + 弧线」，全是 2D 图元，
 *      GPU 光栅化收益有限，而 Canvas 2D 在 1920x1080 下约 10000 条路径指令/帧
 *      仍能稳 60fps（实测见 README）。
 *
 * 几何：单位球 -> 绕 Y 轴匀速自转 -> 绕 X 轴固定倾斜 -> 弱透视投影。
 *   匀速（0.8 度/秒，无缓动、永不停）是「真实天体」的唯一必要条件，
 *   一旦加缓动就立刻变成一个 UI 动画。
 *
 * 两种流量方向相反，观众不看图例也能分清：
 *   爬虫  外太空 1.6R -> 店铺城市    冷青 #00D3A7  细  同屏 <= 40 条   —— 坠落
 *   订单  店铺城市 -> 买家城市       暖金 #FFB86B  粗  约 1 条/分钟   —— 发射
 *
 * 性能红线（对应共享规格 2.7）：
 *   createPattern / createRadialGradient 只在 init() 调用，rAF 内永不新建 GPU 侧对象。
 *   弧线按「线宽 x 透明度档」分 12 个批次批量 stroke，不是每段一次 stroke。
 *   所有随机来自 APEngine.hash32，禁止 Math.random —— 彩排要能复现。
 *
 * 依赖：cities.js (APGeo)、engine.js (APEngine)。classic script，不要改成 ES module。
 * =========================================================================== */
(function (root) {
  'use strict';

  var W = 1920, H = 1080, TAU = Math.PI * 2;

  /* --- 球体几何（设计稿坐标；中央偏右，直径约 53% 屏宽，右侧轻微出画） ------ */
  var CX = 960, CY = 452, R = 352;
  var CAMD = 3.4;                                     /* 弱透视：相机距球心 3.4R */
  var LIMB = R * CAMD / Math.sqrt(CAMD * CAMD - 1);   /* 透视下球缘的投影半径 */
  var HZ = 1 / CAMD;                                  /* 球面点的可见地平线 z 阈值 */
  var TILT = -15 * Math.PI / 180;                     /* 北极略朝观众 */
  var SPIN = 0.8 * Math.PI / 180;                     /* 0.8 度/秒，匀速 */

  /* 背景色现在走 PAL[*].bg（球缘暗角要和页面底色同色才不留一圈灰环）。
   * 原来的 var BG = '8,9,11' 已被两套配色取代。 */

  /* --- 运行态 ---------------------------------------------------------------- */
  var ctx = null, cvs = null;
  var rot = 0, Reff = R, breath = 1;
  var noiseDx = 0, noiseDy = 0;
  var noisePat = null, limbGrad = null;
  var glowGrad = null, bodyGrad = null, rimGrad = null;   /* 全屏版新增：大气/本体/亮边 */

  /* ── 海岸线（全屏版新增） ───────────────────────────────────────────────
   * 方案 B 的球面只有「城市点云」，大陆是几撮孤立亮点簇。
   * 参考图（Shopify BFCM Globe）的大陆是**轮廓清晰的实心形状** ——
   * 那一层才是「这是地球」的识别锚。
   *
   * 数据走 coast.js（Natural Earth 1:110m，公有领域，108 环 / 2161 点）。
   * 曾用 64×26 掩码逐格画方块，调过四版尺寸都是方块拼贴 ——
   * 点阵做不出清晰边缘，只有多边形 + fill() 的抗锯齿边界能做到。
   *
   * 每环预存单位向量 + 一个包围球（中心 + sin 角半径），
   * 每帧先用包围球剔掉背面的环（只变换 1 个点），再逐点投影。 */
  var coastR = [];       /* [{ v: Float32Array, n, cx, cy, cz, sr }] */
  var coastBuf = null;   /* 屏幕坐标缓冲，预分配 */

  /* ── 陆地掩码（全屏版新增） ─────────────────────────────────────────────
   * 城市点云的卫星点原本在切平面上随机撒圆盘，**不认陆地边界** ——
   * 沿海城市（圣保罗、布宜诺斯艾利斯…）有一半点落到海里，
   * 于是那一簇看着像「飘在地球上空」而不是贴在地图上。
   *
   * 做法是 GIS 里的标准两步：rasterize + rejection sampling。
   * 把海岸线栅格成一张位图，撒点时查表，落在海里就丢掉重采。 */
  var landMask = null, LM_W = 1024, LM_H = 512;   /* 约 0.35° × 0.35° */

  /* 镜头跟随（全屏版新增）：订单来了把那条经线摇到正面，否则一半的订单卡
   * 钉在球背面根本看不见（自转只有 0.8 度/秒，卡片 5 秒生命期内转不过来）。 */
  var focusFrom = 0, focusTo = 0, focusT = 0, focusDur = 0;

  var _tiltC = Math.cos(TILT), _tiltS = Math.sin(TILT);
  var _rotC = 1, _rotS = 0;

  /* 呼吸 / 暗角 / 体积光的冲击量（app.js 读取后驱动 DOM 层） */
  var pulseT = 999, pulseDur = 0.9, pulseAmp = 0, pulseVig = 0, pulseRay = 0;

  var P = { x: 0, y: 0, z: 0, k: 1, occ: 0 };
  var P2 = { x: 0, y: 0, z: 0, k: 1, occ: 0 };

  /* =====================================================================
   * 一、投影
   * ===================================================================== */
  /** 把海岸线栅格成等距柱状的陆地位图。
   *
   *  跨 180° 经线的环（俄罗斯那条）在等距柱状上会从 x≈W 跳到 x≈0，
   *  直接 fill 会横穿整张图。所以画在**双倍宽**的画布上、每个环画两遍
   *  （偏移 0 和 +W），最后取两半的并集 —— 跨界的环总有一遍是连续的。 */
  function buildLandMask() {
    var src = root.APCoast;
    landMask = null;
    if (!src || !src.length || !root.document) return;
    var cv = root.document.createElement('canvas');
    cv.width = LM_W * 2; cv.height = LM_H;
    var g = cv.getContext('2d');
    if (!g) return;
    g.fillStyle = '#ffffff';
    g.beginPath();
    var i, j, rep;
    for (i = 0; i < src.length; i++) {
      var r = src[i], n = r.length >> 1;
      if (n < 3) continue;
      for (rep = 0; rep < 2; rep++) {
        var off = rep * LM_W;
        for (j = 0; j < n; j++) {
          var x = (r[j * 2] + 180) / 360 * LM_W + off;
          var y = (90 - r[j * 2 + 1]) / 180 * LM_H;
          if (j === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.closePath();
      }
    }
    g.fill();
    /* 膨胀约 2 格（≈0.7°，球上约 4px）：110m + DP 简化会把凹岸削掉，
     * 于是有些沿海城市的坐标本身就落在掩码的海里（实测悉尼就是）。
     * 粗描边是最省事的膨胀，容差取 4px —— 远小于要修的 20~40px 溢出。 */
    g.strokeStyle = '#ffffff';
    g.lineWidth = 4;
    g.stroke();
    var d = g.getImageData(0, 0, LM_W * 2, LM_H).data;
    var m = new Uint8Array(LM_W * LM_H);
    var W2 = LM_W * 2;
    for (var yy = 0; yy < LM_H; yy++) {
      var row = yy * W2;
      for (var xx = 0; xx < LM_W; xx++) {
        var a1 = d[(row + xx) * 4 + 3];
        var a2 = d[(row + xx + LM_W) * 4 + 3];
        if (a1 > 127 || a2 > 127) m[yy * LM_W + xx] = 1;
      }
    }
    landMask = m;
  }
  function isLand(lon, lat) {
    if (!landMask) return 1;
    var x = ((lon + 180) / 360 * LM_W) | 0;
    var y = ((90 - lat) / 180 * LM_H) | 0;
    if (y < 0) y = 0; else if (y >= LM_H) y = LM_H - 1;
    x = ((x % LM_W) + LM_W) % LM_W;
    return landMask[y * LM_W + x];
  }

  function buildCoast(Geo) {
    var src = root.APCoast;
    coastR = [];
    if (!src || !src.length) return;
    var maxN = 0, i, j;
    for (i = 0; i < src.length; i++) {
      var ring = src[i], n = ring.length >> 1;
      if (n < 3) continue;
      var v = new Float32Array(n * 3);
      var sx = 0, sy = 0, sz = 0;
      for (j = 0; j < n; j++) {
        var p = Geo.toVec3(ring[j * 2 + 1], ring[j * 2]);   /* 注意：存的是 lon,lat */
        v[j * 3] = p.x; v[j * 3 + 1] = p.y; v[j * 3 + 2] = p.z;
        sx += p.x; sy += p.y; sz += p.z;
      }
      /* 包围球：中心 = 归一化的平均向量，角半径 = 到中心的最大角距 */
      var m = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
      var cx = sx / m, cy = sy / m, cz = sz / m;
      var worst = 1;
      for (j = 0; j < n; j++) {
        var d = v[j * 3] * cx + v[j * 3 + 1] * cy + v[j * 3 + 2] * cz;
        if (d < worst) worst = d;
      }
      if (worst > 1) worst = 1; else if (worst < -1) worst = -1;
      var rad = Math.acos(worst);
      coastR.push({ v: v, n: n, cx: cx, cy: cy, cz: cz, sr: Math.sin(rad) });
      if (n > maxN) maxN = n;
    }
    /* 背面段沿球缘插值最多每点补 8 个，容量按最坏情况给 */
    coastBuf = new Float32Array((maxN * 9 + 16) * 2);
  }

  /** 海岸线：可见的环拼进**一条** path，最后一次 fill —— 108 次 fill 没必要。
   *
   *  跨球缘的环要处理背面那一段。直接把背面顶点按方位角贴到球缘是不够的：
   *  相邻两个背面点的方位角可能从 10° 跳到 350°，连线就横穿整个球面，
   *  于是球缘内侧糊出一堆尖角三角形（实测东亚/东南亚一带最明显）。
   *  所以连续的背面段要**沿球缘短弧插值**着走，大陆才会被球缘干净地切断。 */
  function drawCoast() {
    if (!coastR.length) return;
    var lim = LIMB * breath, any = false, p, i;
    ctx.beginPath();
    for (p = 0; p < coastR.length; p++) {
      var c = coastR[p];
      /* 包围球剔除：只变换中心那一个点。整环在背面就整环跳过。 */
      project(c.cx, c.cy, c.cz, P);
      if (P.z + c.sr < HZ) continue;
      var v = c.v, n = c.n, front = false, q = 0, lastAng = null;
      for (i = 0; i < n; i++) {
        project(v[i * 3], v[i * 3 + 1], v[i * 3 + 2], P);
        if (P.z >= HZ) {
          front = true;
          coastBuf[q++] = P.x; coastBuf[q++] = P.y;
          lastAng = null;
        } else {
          var ang = Math.atan2(-P.yr, P.xr);
          if (lastAng === null) {
            coastBuf[q++] = CX + lim * Math.cos(ang);
            coastBuf[q++] = CY + lim * Math.sin(ang);
          } else {
            /* 沿球缘走最短的那一段，每约 8.6° 补一个点 */
            var d = ang - lastAng;
            while (d > Math.PI) d -= TAU;
            while (d < -Math.PI) d += TAU;
            var steps = Math.ceil(Math.abs(d) / 0.15);
            if (steps < 1) steps = 1; else if (steps > 8) steps = 8;
            for (var s = 1; s <= steps; s++) {
              var a2 = lastAng + d * s / steps;
              coastBuf[q++] = CX + lim * Math.cos(a2);
              coastBuf[q++] = CY + lim * Math.sin(a2);
            }
          }
          lastAng = ang;
        }
      }
      /* 一个正面顶点都没有就别画：那种环整个贴在球缘上，
       * 会在球缘糊出一条弧形色块。 */
      if (!front) continue;
      ctx.moveTo(coastBuf[0], coastBuf[1]);
      for (i = 2; i < q; i += 2) ctx.lineTo(coastBuf[i], coastBuf[i + 1]);
      ctx.closePath();
      any = true;
    }
    if (!any) return;
    /* 参考图里大陆只比海面亮一点点，抓眼的是亮点和弧线，不是陆块本身。
     * 填充压到这个亮度，清晰度靠下面那道描边撑。 */
    ctx.fillStyle = pal.land;
    ctx.fill();
    /* 一道更亮的海岸线：参考图里大陆边缘是有轮廓的，不是纯色块 */
    ctx.strokeStyle = pal.coast;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** 输入球坐标（半径可大于 1），结果写入 out。
   *  out.z  = 旋转后的相机轴坐标（球面点 z >= HZ 即为正面）
   *  out.occ= 1 表示该点被球体本身遮挡（弧线背面压暗用） */
  function project(x, y, z, out) {
    var xr = x * _rotC + z * _rotS;
    var zr = z * _rotC - x * _rotS;
    var yr = y * _tiltC - zr * _tiltS;
    var zz = y * _tiltS + zr * _tiltC;
    var k = CAMD / (CAMD - zz);
    out.x = CX + xr * Reff * k;
    out.y = CY - yr * Reff * k;
    out.k = k;
    out.z = zz;
    /* xr/yr = 该点在屏幕平面上的方向。海岸线把背面顶点贴到球缘时要用它算方位角 ——
     * 不能用投影后的 out.x/out.y：背面点的投影半径会缩到球心附近，方位角失真。 */
    out.xr = xr;
    out.yr = yr;
    /* 相机 (0,0,CAMD) 到该点的线段是否穿过单位球 */
    var dz = zz - CAMD;
    var L2 = xr * xr + yr * yr + dz * dz;
    var s = CAMD * (CAMD - zz) / L2;
    var cd = CAMD * dz;
    out.occ = ((CAMD * CAMD - cd * cd / L2) < 1 && s > 0 && s < 1) ? 1 : 0;
    return out;
  }

  /* =====================================================================
   * 二、城市点云
   * ---------------------------------------------------------------------
   * 只用 APGeo.CITIES 的真实经纬度做种子。每座城市外围按 weight 生成一簇
   * 卫星点（切平面上均匀圆盘采样），于是「人口密度」自然长出大陆轮廓 ——
   * 比任何贴图都高级，且零资源、零网络依赖。
   * 权重最高一档用暖金 --order，其余用 --text：全屏因此是暖金气质，
   * 冷青只留给爬虫，两色分工一眼可读（方案 A 用同色板但以青绿主导）。
   * ===================================================================== */
  var PX = null, PY = null, PZ = null, PW = null, PN = 0;

  /* 6 个档 x 正/背面。档 0~3 是白色人口尘埃（卫星点），档 4~5 是暖金城市芯点
   * （每座真实城市恰好一个）。于是球体读作「白色人口密度 + 120 个金色城市」，
   * 暖金成为全屏主导气质，而冷青只属于爬虫 —— 两色分工零歧义。 */
  var NB = 12;
  var bx = [], by = [], bs = [], bn = [];
  /* 全屏版改成「夜地球城市灯光」而不是白色贴纸点。三处变化：
   *   ① 颜色从纯白 #F7F8F8 换成**暖白**（真实城市灯光是钠灯的橙黄）；
   *   ② alpha 大幅降低，靠 `globalCompositeOperation = 'lighter'` **累加**亮度 ——
   *      密集处自然烧出光团、稀疏处只是暗淡的小点，这才是光而不是贴纸；
   *   ③ 城市芯点额外叠一张径向渐变的辉光精灵，让它像在发光而不是浮在上面。
   * 背面统一取正面的约 12%：规格要求「若隐若现」而不是剔除，才有体积感。 */
  /* ── 两套配色 ──────────────────────────────────────────────────────────
   * 「全屏地球不跟随主题」这条原来的判断只对了一半：
   * 发光天体确实只在深底上成立，但浅色主题下整个后台是白的，
   * 按 G 键突然全屏黑屏，比配色不统一更突兀（用户明确提了这一点）。
   *
   * 所以浅色主题下换的是**隐喻**，不是把深色版调亮：
   *   深色 = 夜地球，城市灯光在发光（lighter 累加）
   *   浅色 = 纸质地球仪 / 白日卫星图，城市是深色墨点（normal 混合）
   * 硬把夜地球调亮只会得到一团灰雾 —— 发光在白底上物理上不成立。
   *
   * 城市点在浅色下必须**深于底色**，否则全部消失；所以两套的合成模式也不同，
   * 见 drawPoints 里的 comp 字段。 */
  var PAL = {
    dark: {
      bg: '8,9,11',
      /* 城市灯光：暖白，靠 lighter 累加烧出光团 */
      pts: [
        'rgba(255,236,204,0.20)', 'rgba(255,236,204,0.035)',
        'rgba(255,238,208,0.30)', 'rgba(255,238,208,0.048)',
        'rgba(255,240,214,0.42)', 'rgba(255,240,214,0.062)',
        'rgba(255,242,220,0.52)', 'rgba(255,242,220,0.072)',
        'rgba(255,206,138,0.72)', 'rgba(255,206,138,0.10)',
        'rgba(255,198,124,0.90)', 'rgba(255,198,124,0.13)'
      ],
      comp: 'lighter',
      glowSprite: ['rgba(255,216,154,0.50)', 'rgba(255,204,132,0.20)',
                   'rgba(255,190,110,0.058)', 'rgba(255,180,100,0)'],
      atmo: ['rgba(96,165,250,0.00)', 'rgba(120,180,255,0.30)', 'rgba(96,165,250,0.15)',
             'rgba(72,120,220,0.06)', 'rgba(56,96,190,0.00)'],
      body: ['rgba(34,46,68,0.96)', 'rgba(20,29,48,0.97)',
             'rgba(10,16,30,0.98)', 'rgba(4,8,18,0.99)'],
      rim: ['rgba(173,216,255,0.88)', 'rgba(120,180,255,0.44)',
            'rgba(80,130,220,0.16)', 'rgba(60,100,190,0.05)'],
      land: 'rgba(40,55,82,0.88)',
      coast: 'rgba(108,148,204,0.42)',
      gratBack: 'rgba(125,211,252,0.026)',
      gratFront: 'rgba(125,211,252,0.090)',
      warmRim: 'rgba(255,184,107,0.14)',
      crawl: '0,211,167', order: '255,184,107',
      stars: true
    },
    light: {
      /* 球缘暗角用页面底色，浅色下是 #F1F2F4 */
      bg: '241,242,244',
      /* 白日卫星图：城市是深墨点。alpha 高、尺寸不变，normal 混合。 */
      pts: [
        'rgba(38,64,84,0.34)', 'rgba(38,64,84,0.07)',
        'rgba(34,60,80,0.46)', 'rgba(34,60,80,0.09)',
        'rgba(28,54,74,0.58)', 'rgba(28,54,74,0.11)',
        'rgba(22,48,68,0.70)', 'rgba(22,48,68,0.13)',
        'rgba(150,74,10,0.82)', 'rgba(150,74,10,0.16)',
        'rgba(166,80,8,0.94)', 'rgba(166,80,8,0.20)'
      ],
      comp: 'source-over',
      /* 浅色下辉光要压到几乎没有 —— 白底上的暖色辉光会把墨点糊成一团黄雾 */
      glowSprite: ['rgba(196,120,40,0.16)', 'rgba(196,120,40,0.07)',
                   'rgba(196,120,40,0.02)', 'rgba(196,120,40,0)'],
      /* 大气层：白底上不能发光，改成一层很淡的冷色雾，只用来把球和背景分开 */
      atmo: ['rgba(120,160,205,0.00)', 'rgba(120,160,205,0.16)', 'rgba(120,160,205,0.09)',
             'rgba(120,160,205,0.035)', 'rgba(120,160,205,0.00)'],
      /* 球体：海洋是浅灰蓝，左上受光右下入影（和深色版同一套光照逻辑）。
       * 受光那一档不能太接近页面底色 —— 第一版给到 rgb(226,236,245)，
       * 压在 #FFFFFF 的背景上时球的左上角整片糊进背景里（实测截图）。
       * 现在最亮处也比背景暗约 40 个亮度单位，整圈边界都立得住。 */
      body: ['rgba(214,229,241,0.99)', 'rgba(189,208,226,0.99)',
             'rgba(162,185,207,0.99)', 'rgba(136,161,187,0.99)'],
      /* 亮边换成暗边：白底上「受光边缘更亮」看不出来，改成上暗下更暗的收边 */
      rim: ['rgba(92,120,148,0.55)', 'rgba(104,132,158,0.38)',
            'rgba(120,146,170,0.22)', 'rgba(136,158,180,0.12)'],
      /* 陆地比海洋深一档 —— 深色版是「陆地比海面亮一点」，浅色下要反过来 */
      land: 'rgba(150,170,150,0.92)',
      coast: 'rgba(86,104,92,0.55)',
      gratBack: 'rgba(70,100,130,0.030)',
      gratFront: 'rgba(70,100,130,0.085)',
      warmRim: 'rgba(178,106,22,0.16)',
      /* 弧线也要压深：#00D3A7 / #FFB86B 在白底上对比度只有 1.6:1（和 THEMES 同一条理由） */
      crawl: '0,142,116', order: '178,106,22',
      stars: false
    }
  };
  var pal = PAL.dark;
  var BSTYLE = pal.pts;
  var BSIZE = [2, 2, 3, 3, 4, 4];
  var glowSprite = null;

  var CORE = 1000;                   /* 芯点权重偏移量，用于区分芯点与卫星点 */

  function classOf(w) {
    if (w >= CORE) return (w - CORE >= 6) ? 5 : 4;
    if (w >= 7.5) return 3;
    if (w >= 4.5) return 2;
    if (w >= 2.2) return 1;
    return 0;
  }

  function buildPoints(E, Geo) {
    var C = Geo.CITIES, tmpX = [], tmpY = [], tmpZ = [], tmpW = [];
    for (var i = 0; i < C.length; i++) {
      var lat = C[i][1], lon = C[i][2], w = C[i][4];
      var v = Geo.toVec3(lat, lon);
      tmpX.push(v.x); tmpY.push(v.y); tmpZ.push(v.z); tmpW.push(CORE + w);

      /* 切平面正交基。都市纬度远离极点，up=(0,1,0) 不会退化 */
      var ex = v.z, ey = 0, ez = -v.x;                 /* east = up x v */
      var em = Math.sqrt(ex * ex + ez * ez) || 1;
      ex /= em; ez /= em;
      var nx = v.y * ez - v.z * ey;                    /* north = v x east */
      var ny = v.z * ex - v.x * ez;
      var nz = v.x * ey - v.y * ex;

      /* 点数与簇半径都随 weight 走。
       *
       * 方案 B 原版给 `22 + w*13`（约 5000 点）—— 那一版**没有海岸线层**，
       * 大陆完全靠点云密度勾出来，所以必须堆到那个量。
       * 全屏版有了 Natural Earth 的真实轮廓，点云的职责只剩「哪里有人在买」，
       * 于是砍到约 45%（`10 + w*6`，约 2200 点）：
       *   ① 大陆轮廓不再被尘埃糊住，边缘更干脆；
       *   ② 省下的帧正好补上海岸线那一层的开销。 */
      var cnt = 14 + Math.round(w * 9);
      var spread = 0.040 + w * 0.0075;                 /* 弧度，w=10 时约 6.6 度 */
      /* rejection sampling：落到海里的点丢掉重采。
       * 种子必须跟着 try 次数走（不是跟着已接受的个数），否则被拒的点会
       * 反复采到同一个位置，直接把配额耗光。
       * 沿海城市大约会被拒掉一半，所以 cnt 比裁剪前调高了。 */
      var got = 0, tries = 0, maxTries = cnt * 5;
      while (got < cnt && tries < maxTries) {
        var sd = i * 3779 + (tries++);
        var ang = E.hash32(sd, 5171) * TAU;
        /* 指数 0.85（而不是 0.5 的等面积采样）让密度朝外衰减，
         * 簇边缘是软的：相邻城市能连成海岸带，而不是一撮撮硬边圆斑。 */
        var rd = Math.pow(E.hash32(sd, 7919), 0.85) * spread;
        var ca = Math.cos(ang), sa = Math.sin(ang);
        var tx = ex * ca + nx * sa, ty = ey * ca + ny * sa, tz = ez * ca + nz * sa;
        var cr = Math.cos(rd), sr = Math.sin(rd);
        var qx = v.x * cr + tx * sr, qy = v.y * cr + ty * sr, qz = v.z * cr + tz * sr;
        /* 反算经纬度查掩码。toVec3 是 x=cos(lat)sin(lon), y=sin(lat), z=cos(lat)cos(lon) */
        var qy2 = qy > 1 ? 1 : (qy < -1 ? -1 : qy);
        if (!isLand(Math.atan2(qx, qz) * 180 / Math.PI,
                    Math.asin(qy2) * 180 / Math.PI)) continue;
        got++;
        tmpX.push(qx); tmpY.push(qy); tmpZ.push(qz);
        /* 越外圈越暗，再叠一点确定性抖动，避免出现同心圆纹 */
        var fall = Math.pow(1 - rd / spread, 1.35);
        tmpW.push(w * (0.40 + 0.60 * fall) * (0.75 + 0.5 * E.hash32(sd, 6131)));
      }
    }
    PN = tmpX.length;
    PX = new Float32Array(tmpX); PY = new Float32Array(tmpY);
    PZ = new Float32Array(tmpZ); PW = new Float32Array(tmpW);

    var cap = PN + 8;
    for (var b = 0; b < NB; b++) {
      bx.push(new Float32Array(cap));
      by.push(new Float32Array(cap));
      bs.push(new Float32Array(cap));
      bn.push(0);
    }
  }

  /** 辉光精灵：一次性画好一张径向渐变，之后每个城市芯点 drawImage 过去。
   *  几千个 arc 或逐点建 gradient 都会掉帧（rAF 内不许新建 GPU 侧对象）。 */
  function buildGlowSprite() {
    if (!root.document) return;
    var S = 32;
    var c = root.document.createElement('canvas');
    c.width = S; c.height = S;
    var g = c.getContext('2d');
    if (!g) return;
    var gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0.00, pal.glowSprite[0]);
    gr.addColorStop(0.22, pal.glowSprite[1]);
    gr.addColorStop(0.55, pal.glowSprite[2]);
    gr.addColorStop(1.00, pal.glowSprite[3]);
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    glowSprite = c;
  }

  function drawPoints() {
    var b, i;
    for (b = 0; b < NB; b++) bn[b] = 0;
    var rlimb = LIMB * breath;
    for (i = 0; i < PN; i++) {
      project(PX[i], PY[i], PZ[i], P);
      var back = P.z < HZ ? 1 : 0;
      var cl = classOf(PW[i]);
      /* 球缘衰减：透视会把靠边的点在屏幕上挤成一条亮带，不处理就是一圈
       * 发光环 —— 那正是「2013-2018 免费模板皮肤」的招牌特征。按屏幕半径
       * 降档 + 缩小，得到掠射角自然变暗的效果。 */
      var dx = P.x - CX, dy = P.y - CY;
      var rr = Math.sqrt(dx * dx + dy * dy) / rlimb;
      var shrink = 1;
      if (rr > 0.995) continue;                  /* 最外 0.5% 直接不画 */
      if (rr > 0.955) { cl -= 2; shrink = 0.62; }
      else if (rr > 0.88) { cl -= 1; shrink = 0.82; }
      if (cl < 0) cl = 0;
      b = cl * 2 + back;
      var s = BSIZE[cl] * shrink * (back ? 0.90 : (P.k * 0.95));
      s = s < 1 ? 1 : (s > 6 ? 6 : Math.round(s));
      var n = bn[b];
      bx[b][n] = P.x - s * 0.5; by[b][n] = P.y - s * 0.5; bs[b][n] = s;
      bn[b] = n + 1;
    }
    /* 加法混合：重叠的点累加亮度 —— 密集城市群自然烧成光团，
     * 而不是一堆同样亮的白方块摊在表面（那就是「贴纸/悬空」的观感来源）。 */
    var prevOp = ctx.globalCompositeOperation;
    /* 深色=lighter（灯光累加）；浅色=source-over（墨点覆盖）。
     * 白底上用 lighter 会让墨点越叠越白，直接消失。 */
    ctx.globalCompositeOperation = pal.comp;

    /* 先铺辉光（只给正面的城市芯点，档 4/5），再画芯点本身 */
    if (glowSprite) {
      for (b = 8; b < NB; b += 2) {              /* 8 = 档4 正面，10 = 档5 正面 */
        var gc = bn[b];
        if (!gc) continue;
        var GX = bx[b], GY = by[b], GS = bs[b];
        var mul = (b === 10) ? 7.2 : 5.4;        /* 枢纽城市的光晕更大 */
        for (var q = 0; q < gc; q++) {
          var gs = GS[q] * mul;
          ctx.drawImage(glowSprite,
            GX[q] + GS[q] * 0.5 - gs * 0.5, GY[q] + GS[q] * 0.5 - gs * 0.5, gs, gs);
        }
      }
    }

    for (b = 0; b < NB; b++) {
      var cnt = bn[b];
      if (!cnt) continue;
      ctx.fillStyle = BSTYLE[b];
      ctx.beginPath();
      var X = bx[b], Y = by[b], S = bs[b];
      for (var j = 0; j < cnt; j++) ctx.rect(X[j], Y[j], S[j], S[j]);
      ctx.fill();
    }
    ctx.globalCompositeOperation = prevOp;
  }

  /* =====================================================================
   * 三、经纬线：每 15 度一条，只画球面上的部分，正面 .06 / 背面 .018
   * ===================================================================== */
  var GRAT = null;

  function buildGrat(Geo) {
    var out = [], lon, lat, arr, v;
    for (lon = -180; lon < 180; lon += 15) {
      arr = [];
      for (lat = -90; lat <= 90; lat += 3) { v = Geo.toVec3(lat, lon); arr.push(v.x, v.y, v.z); }
      out.push(new Float32Array(arr));
    }
    for (lat = -75; lat <= 75; lat += 15) {
      arr = [];
      for (lon = -180; lon <= 180; lon += 3) { v = Geo.toVec3(lat, lon); arr.push(v.x, v.y, v.z); }
      out.push(new Float32Array(arr));
    }
    GRAT = out;
  }

  function drawGrat(front) {
    ctx.beginPath();
    for (var i = 0; i < GRAT.length; i++) {
      var a = GRAT[i], pen = false;
      for (var j = 0; j < a.length; j += 3) {
        project(a[j], a[j + 1], a[j + 2], P);
        if ((P.z >= HZ) !== front) { pen = false; continue; }
        if (pen) ctx.lineTo(P.x, P.y);
        else { ctx.moveTo(P.x, P.y); pen = true; }
      }
    }
    ctx.stroke();
  }

  /* =====================================================================
   * 四、颗粒质感：只叠在球体范围内，不做全屏后处理。
   *     （Shopify BFCM Globe 的结论：全屏后处理版本「始终不对味」。）
   *     pattern 在 init 建一次，rAF 里只有 translate + fillRect。
   * ===================================================================== */
  function buildNoise(E) {
    var n = 128, c = root.document.createElement('canvas');
    c.width = n; c.height = n;
    var g = c.getContext('2d');
    var img = g.createImageData(n, n), d = img.data;
    for (var i = 0; i < n * n; i++) {
      var v = E.hash32(i, 4241);
      var a = v > 0.88 ? 210 : (v > 0.64 ? 88 : 0);
      var o = i * 4;
      d[o] = 255; d[o + 1] = 246; d[o + 2] = 232; d[o + 3] = a;
    }
    g.putImageData(img, 0, 0);
    noisePat = ctx.createPattern(c, 'repeat');
  }

  function drawNoise() {
    var rr = LIMB * breath;
    ctx.save();
    ctx.beginPath(); ctx.arc(CX, CY, rr, 0, TAU); ctx.clip();
    ctx.globalAlpha = 0.055;
    ctx.fillStyle = noisePat;
    ctx.translate(noiseDx, noiseDy);
    ctx.fillRect(CX - rr - noiseDx, CY - rr - noiseDy, rr * 2, rr * 2);
    ctx.restore();
  }

  /* =====================================================================
   * 五、弧线（爬虫 / 订单）
   * ---------------------------------------------------------------------
   * 退场是 noise dissolve：沿弧线按段号喂 hash32 噪声，各段在不同时刻消失，
   * 线条崩解成碎片，而不是整体 opacity 淡出 —— 这是让满屏飞线不显廉价的
   * 关键技术点。段本体也带 hash 抖动，使线在飞行途中就有颗粒感，
   * 不是一条塑料光带。
   * ===================================================================== */
  var CRAWL_MAX = 40, ORDER_MAX = 8;
  var arcs = [], arcHeads = [];

  function Arc() {
    this.on = 0; this.kind = 0; this.seed = 0;
    this.ax = 0; this.ay = 0; this.az = 0;
    this.bx = 0; this.by = 0; this.bz = 0;
    this.om = 0; this.so = 1; this.r0 = 1; this.h = 0;
    this.age = 0; this.fly = 1; this.hold = 0; this.dis = 1;
    this.n = 22; this.tail = 0.4;
  }

  /* 段缓冲：2 种线宽 x 6 个透明度档 = 12 个批次，每批一次 stroke */
  var SEGL = 6, SB = 12, SCAP = CRAWL_MAX * 26 + ORDER_MAX * 36;
  var sx1 = [], sy1 = [], sx2 = [], sy2 = [], sn = [];
  var SSTYLE = [], SLW = [1.3, 2.8];

  /** 弧线的 12 个（线宽 × 透明度）批次样式。换主题要重建，所以单独一个函数。 */
  function buildArcStyles() {
    SSTYLE.length = 0;
    for (var k = 0; k < 2; k++) {
      for (var l = 0; l < SEGL; l++) {
        var a = ((l + 1) / SEGL) * (k === 0 ? 0.92 : 0.98);
        SSTYLE.push('rgba(' + (k === 0 ? pal.crawl : pal.order) + ',' +
                    a.toFixed(3) + ')');
      }
    }
  }

  function initPools() {
    var i, b;
    for (i = 0; i < CRAWL_MAX + ORDER_MAX; i++) {
      arcs.push(new Arc());
      arcHeads.push({ x: 0, y: 0, r: 2, k: 0 });
    }
    for (b = 0; b < SB; b++) {
      sx1.push(new Float32Array(SCAP)); sy1.push(new Float32Array(SCAP));
      sx2.push(new Float32Array(SCAP)); sy2.push(new Float32Array(SCAP));
      sn.push(0);
    }
    buildArcStyles();
  }

  /* ── 星空（只在深色主题） ──────────────────────────────────────────────
   * 深色下球外面是一整片纯黑，太空是「什么都没有」而不是太空。
   * 星点必须满足两件事才像真的：**分布不均匀**（真实星野是成团的）、
   * 亮度分档且会缓慢闪烁（大气抖动）。均匀撒 + 同亮度 = 一张噪点贴图。
   *
   * 不用 canvas pattern：星点要各自按不同周期闪，pattern 是静态的。
   * 位置一次算好存 Float32Array，每帧只改 alpha（600 个点，代价可忽略）。
   * 随机走 E.hash32（规格红线），所以每次刷新星图完全一致。 */
  var STAR_N = 620;
  var starX = null, starY = null, starR = null, starA = null, starP = null;
  function buildStars(E) {
    starX = new Float32Array(STAR_N); starY = new Float32Array(STAR_N);
    starR = new Float32Array(STAR_N); starA = new Float32Array(STAR_N);
    starP = new Float32Array(STAR_N);
    var n = 0, guard = 0;
    while (n < STAR_N && guard < STAR_N * 40) {
      guard++;
      var x = E.hash32(guard, 5501) * W;
      var y = E.hash32(guard, 5503) * H;
      /* 球体（含大气光晕）罩住的地方不撒 —— 星星画在球面上就成了噪点 */
      var dx = x - CX, dy = y - CY;
      if (dx * dx + dy * dy < (LIMB * 1.22) * (LIMB * 1.22)) continue;
      /* 成团：用一层低频噪声当接受概率，得到疏密不均的星野 */
      var cl = 0.5
        + 0.5 * Math.sin(x / 210 + E.hash32(guard, 5507) * 0.7)
              * Math.cos(y / 170 + E.hash32(guard, 5509) * 0.7);
      if (E.hash32(guard, 5511) > 0.30 + cl * 0.70) continue;
      var mag = E.hash32(guard, 5513);
      starX[n] = x; starY[n] = y;
      /* 亮度分档：绝大多数是暗的小点，少数几颗亮星。均匀亮度一眼假。 */
      starR[n] = mag > 0.985 ? 1.7 : (mag > 0.90 ? 1.15 : 0.75);
      starA[n] = mag > 0.985 ? 0.92 : (mag > 0.90 ? 0.55 : 0.24 + mag * 0.16);
      starP[n] = E.hash32(guard, 5517) * TAU;      /* 闪烁相位 */
      n++;
    }
    STAR_LIVE = n;
  }
  var STAR_LIVE = 0, starT = 0;
  function drawStars(dtS) {
    if (!pal.stars || !starX) return;
    starT += dtS;
    /* 闪烁只调 alpha，不动位置。0.55 rad/s 是「看得出在闪但不会烦」的档。 */
    for (var i = 0; i < STAR_LIVE; i++) {
      var tw = 0.78 + 0.22 * Math.sin(starT * 0.55 + starP[i]);
      ctx.globalAlpha = starA[i] * tw;
      ctx.fillStyle = '#DCE6FA';
      ctx.beginPath();
      ctx.arc(starX[i], starY[i], starR[i], 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function seedOf(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h >>> 0;
  }

  function takeArc(kind) {
    var from = kind === 0 ? 0 : CRAWL_MAX;
    var to = kind === 0 ? CRAWL_MAX : CRAWL_MAX + ORDER_MAX;
    for (var i = from; i < to; i++) if (!arcs[i].on) return arcs[i];
    return null;                                   /* 满了就丢，绝不扩容 */
  }

  function arcPoint(a, t, out) {
    var s1, s2;
    if (a.om < 1e-4) { s1 = 1 - t; s2 = t; }
    else { s1 = Math.sin((1 - t) * a.om) / a.so; s2 = Math.sin(t * a.om) / a.so; }
    var x = a.ax * s1 + a.bx * s2, y = a.ay * s1 + a.by * s2, z = a.az * s1 + a.bz * s2;
    var m = Math.sqrt(x * x + y * y + z * z) || 1;
    var rr = (a.kind === 0)
      ? 1 + (a.r0 - 1) * Math.pow(1 - t, 2.2)      /* 坠落：先缓后急 */
      : 1 + a.h * Math.sin(Math.PI * t);            /* 发射：大圆弧 + 弧高 */
    var q = rr / m;
    return project(x * q, y * q, z * q, out);
  }

  function drawArcs(E, dtS) {
    var b, i;
    for (b = 0; b < SB; b++) sn[b] = 0;
    var headN = 0;

    for (i = 0; i < arcs.length; i++) {
      var a = arcs[i];
      if (!a.on) continue;
      a.age += dtS;
      if (a.age >= a.fly + a.hold + a.dis) { a.on = 0; continue; }

      var u = a.age / a.fly; if (u > 1) u = 1;
      /* 坠落加速（引力），发射减速（抛出） */
      var p = (a.kind === 0) ? Math.pow(u, 1.55) : 1 - Math.pow(1 - u, 1.9);
      var dis = (a.age - a.fly - a.hold) / a.dis;
      if (dis < 0) dis = 0;

      var kbase = a.kind * SEGL;
      var n = a.n, prevOk = false, pxx = 0, pyy = 0, pocc = 0;

      for (var j = 0; j <= n; j++) {
        var t = j / n;
        if (t > p + 1e-6) break;
        arcPoint(a, t, P);
        if (prevOk) {
          var mid = t - 0.5 / n;
          var backT = (p - mid) / a.tail;
          if (backT >= 0 && backT <= 1) {
            var al = 1 - backT;
            al = al * al * (3 - 2 * al);                       /* 尾部柔化 */
            al *= 0.60 + 0.40 * E.hash32(a.seed, j * 577 + 7); /* 颗粒抖动 */
            if (dis > 0) {                                     /* noise dissolve */
              var thr = E.hash32(a.seed, j * 9176 + 13) * 0.72;
              var kk = (dis - thr) / 0.28;
              if (kk > 0) al *= (1 - kk);
            }
            if (pocc || P.occ) al *= 0.10;                     /* 球背后压暗 */
            if (al > 0.045) {
              var lvl = (al * SEGL) | 0; if (lvl > SEGL - 1) lvl = SEGL - 1;
              b = kbase + lvl;
              var q = sn[b];
              if (q < SCAP) {
                sx1[b][q] = pxx; sy1[b][q] = pyy;
                sx2[b][q] = P.x; sy2[b][q] = P.y;
                sn[b] = q + 1;
              }
            }
          }
        }
        pxx = P.x; pyy = P.y; pocc = P.occ; prevOk = true;
      }

      /* 头部亮点：只在飞行阶段，且不在球背后 */
      if (u < 1) {
        arcPoint(a, p, P2);
        if (!P2.occ && headN < arcHeads.length) {
          var hd = arcHeads[headN++];
          hd.x = P2.x; hd.y = P2.y; hd.k = a.kind;
          hd.r = (a.kind === 0 ? 1.9 : 3.4) * (0.85 + 0.3 * (P2.k - 0.9));
        }
      }
    }

    /* 12 个批次，每批一次 stroke */
    ctx.lineCap = 'round';
    for (b = 0; b < SB; b++) {
      var cnt = sn[b];
      if (!cnt) continue;
      ctx.strokeStyle = SSTYLE[b];
      ctx.lineWidth = SLW[(b / SEGL) | 0];
      ctx.beginPath();
      var A = sx1[b], B = sy1[b], C = sx2[b], D = sy2[b];
      for (i = 0; i < cnt; i++) { ctx.moveTo(A[i], B[i]); ctx.lineTo(C[i], D[i]); }
      ctx.stroke();
    }

    /* 头部亮点：两次 fill */
    for (var kd = 0; kd < 2; kd++) {
      var any = false;
      ctx.beginPath();
      for (i = 0; i < headN; i++) {
        if (arcHeads[i].k !== kd) continue;
        ctx.moveTo(arcHeads[i].x + arcHeads[i].r, arcHeads[i].y);
        ctx.arc(arcHeads[i].x, arcHeads[i].y, arcHeads[i].r, 0, TAU);
        any = true;
      }
      if (any) {
        ctx.fillStyle = 'rgba(' + (kd === 0 ? pal.crawl : pal.order) + ',' + (kd === 0 ? '0.92' : '1') + ')';
        ctx.fill();
      }
    }
  }

  /* =====================================================================
   * 六、落点环 / 发射环：单圈扩张后消失，不是粒子四散
   * ===================================================================== */
  var RING_MAX = 28, rings = [];
  function initRings() {
    for (var i = 0; i < RING_MAX; i++)
      rings.push({ on: 0, x: 0, y: 0, t: 0, dur: 0.45, r1: 16, k: 0, lw: 1 });
  }
  function addRing(x, y, dur, r1, kind, lw) {
    for (var i = 0; i < RING_MAX; i++) {
      var r = rings[i];
      if (r.on) continue;
      r.on = 1; r.x = x; r.y = y; r.t = 0;
      r.dur = dur; r.r1 = r1; r.k = kind; r.lw = lw;
      return;
    }
  }
  function drawRings(dtS) {
    for (var i = 0; i < RING_MAX; i++) {
      var r = rings[i];
      if (!r.on) continue;
      r.t += dtS;
      var u = r.t / r.dur;
      if (u >= 1) { r.on = 0; continue; }
      var e = 1 - Math.pow(1 - u, 2.2);
      ctx.strokeStyle = 'rgba(' + (r.k === 0 ? pal.crawl : pal.order) + ',' +
                        (0.50 * (1 - u) * (1 - u)).toFixed(3) + ')';
      ctx.lineWidth = r.lw;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 2 + e * r.r1, 0, TAU);
      ctx.stroke();
    }
  }

  /* =====================================================================
   * 七、信使：订单从球面店铺位置飞向左下事件区，落地回调触发卡片入场
   * ===================================================================== */
  var COUR_MAX = 4, cours = [];
  function initCours() {
    for (var i = 0; i < COUR_MAX; i++)
      cours.push({ on: 0, t: 0, dur: 0.72, x0: 0, y0: 0, cx: 0, cy: 0,
                   x1: 0, y1: 0, cb: null, w: 2.4 });
  }
  function bez(a, b, c, t) { var m = 1 - t; return m * m * a + 2 * m * t * b + t * t * c; }
  function drawCours(dtS) {
    for (var i = 0; i < COUR_MAX; i++) {
      var c = cours[i];
      if (!c.on) continue;
      c.t += dtS;
      var u = c.t / c.dur;
      if (u >= 1) {
        c.on = 0;
        var f = c.cb; c.cb = null;
        if (f) f();
        continue;
      }
      var q = 1 - Math.pow(1 - u, 2.1);
      ctx.lineCap = 'round';
      for (var s = 0; s < 6; s++) {
        var t2 = q - s * 0.030, t1 = q - (s + 1) * 0.030;
        if (t1 < 0) break;
        var ax = bez(c.x0, c.cx, c.x1, t1), ay = bez(c.y0, c.cy, c.y1, t1);
        var bx2 = bez(c.x0, c.cx, c.x1, t2), by2 = bez(c.y0, c.cy, c.y1, t2);
        ctx.strokeStyle = 'rgba(' + pal.order + ',' + (0.92 * (1 - s / 6)).toFixed(3) + ')';
        ctx.lineWidth = c.w * (1 - s * 0.13);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx2, by2); ctx.stroke();
      }
    }
  }

  /* =====================================================================
   * 八、对外 API
   * ===================================================================== */
  var TIER_RANK = { common: 0, rare: 1, epic: 2, legendary: 3 };

  /* 球缘暗角 / 大气 / 本体 / 亮边四层渐变。
   *
   * 方案 B 的球是**透明**的（只有点云和网格），因为它那一屏还有别的主角。
   * 全屏时球本身就是主角，必须像个实体天体 —— 参照 Shopify BFCM Globe：
   * 球外一圈大气、球面是实体、受光那一侧球缘有一道边。
   *
   * 四个 gradient 只在 init / setTheme 里建，rAF 内绝不新建 GPU 侧对象（规格 2.7）。
   * 色值全部取自 pal，所以换主题只需要重跑这一个函数。 */
  function buildGrads() {
    limbGrad = ctx.createRadialGradient(CX, CY, LIMB * 0.62, CX, CY, LIMB);
    limbGrad.addColorStop(0.00, 'rgba(' + pal.bg + ',0)');
    limbGrad.addColorStop(0.74, 'rgba(' + pal.bg + ',0.16)');
    limbGrad.addColorStop(1.00, 'rgba(' + pal.bg + ',0.52)');

    glowGrad = ctx.createRadialGradient(CX, CY, LIMB * 0.97, CX, CY, LIMB * 1.30);
    glowGrad.addColorStop(0.00, pal.atmo[0]);
    glowGrad.addColorStop(0.10, pal.atmo[1]);
    glowGrad.addColorStop(0.34, pal.atmo[2]);
    glowGrad.addColorStop(0.66, pal.atmo[3]);
    glowGrad.addColorStop(1.00, pal.atmo[4]);

    /* 偏心的中心 → 左上受光、右下入影，球才有体积感 */
    bodyGrad = ctx.createRadialGradient(
      CX - LIMB * 0.28, CY - LIMB * 0.32, LIMB * 0.06, CX, CY, LIMB * 1.02);
    bodyGrad.addColorStop(0.00, pal.body[0]);
    bodyGrad.addColorStop(0.45, pal.body[1]);
    bodyGrad.addColorStop(0.80, pal.body[2]);
    bodyGrad.addColorStop(1.00, pal.body[3]);

    rimGrad = ctx.createLinearGradient(CX, CY - LIMB, CX, CY + LIMB);
    rimGrad.addColorStop(0.00, pal.rim[0]);
    rimGrad.addColorStop(0.28, pal.rim[1]);
    rimGrad.addColorStop(0.62, pal.rim[2]);
    rimGrad.addColorStop(1.00, pal.rim[3]);
  }

  var API = {
    CX: CX, CY: CY, R: R, LIMB: LIMB,

    init: function (canvas) {
      var E = root.APEngine, Geo = root.APGeo;
      cvs = canvas;
      cvs.width = W; cvs.height = H;      /* 内部分辨率锁死，不乘 devicePixelRatio */
      ctx = cvs.getContext('2d', { alpha: true });
      buildLandMask();          /* 必须在 buildPoints 之前：撒点要查它 */
      buildGlowSprite();
      buildPoints(E, Geo);
      buildCoast(Geo);
      buildGrat(Geo);
      buildNoise(E);                      /* createPattern 只此一次 */
      buildStars(E);
      buildGrads();
      initPools(); initRings(); initCours();
      return API;
    },

    /** 换主题。重建所有跟色值有关的 GPU 侧对象（渐变 / 辉光精灵 / 弧线样式）。
     *  几何（点云、海岸线、经纬网、星位）与颜色无关，不重算。 */
    setTheme: function (key) {
      var next = PAL[key] || PAL.dark;
      if (next === pal) return API;
      pal = next;
      BSTYLE = pal.pts;
      if (!ctx) return API;                /* 还没 init：等 init 时自然用新 pal */
      buildGlowSprite();
      buildGrads();
      buildArcStyles();
      return API;
    },
    get theme() { return pal === PAL.light ? 'light' : 'dark'; },

    /** 只给性能对照用：丢掉陆块层，量它到底吃多少帧 */
    __debugDropLand: function () { coastR = []; return API; },

    /** 把某条经线摇到正对镜头。走最短方向，结束后自动交回匀速自转。 */
    focusLon: function (lonDeg, durMs) {
      if (lonDeg == null) return API;
      var tg = (-lonDeg * Math.PI / 180) % TAU;
      if (tg < 0) tg += TAU;
      var cur = rot % TAU;
      if (cur < 0) cur += TAU;
      var d = tg - cur;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      rot = cur;
      focusFrom = cur; focusTo = cur + d;
      focusT = 0; focusDur = Math.max(200, durMs || 1300);
      return API;
    },

    /** 经纬度 -> 屏幕坐标（设计稿 1920x1080 坐标系） */
    screenOf: function (lat, lon, out) {
      var v = root.APGeo.toVec3(lat, lon);
      out = out || {};
      project(v.x, v.y, v.z, P);
      out.x = P.x; out.y = P.y; out.front = P.z >= HZ;
      return out;
    },

    /** AI 爬虫：从数据中心上方约 1.6R 坠落到目标店铺城市 */
    spawnCrawl: function (ev) {
      var E = root.APEngine, Geo = root.APGeo;
      var sd = seedOf(ev.id);
      var dst = Geo.toVec3(ev.store.lat, ev.store.lon);
      project(dst.x, dst.y, dst.z, P);
      /* 目标在背面时按确定性概率丢弃，保住正面密度（hash 而非 Math.random，可复现） */
      if (P.z < HZ && E.hash32(sd, 3391) < 0.62) return false;
      var a = takeArc(0);
      if (!a) return false;
      var src = Geo.toVec3(ev.dcLat, ev.dcLon);
      a.on = 1; a.kind = 0; a.seed = sd;
      a.ax = src.x; a.ay = src.y; a.az = src.z;
      a.bx = dst.x; a.by = dst.y; a.bz = dst.z;
      var dot = src.x * dst.x + src.y * dst.y + src.z * dst.z;
      dot = dot > 1 ? 1 : (dot < -1 ? -1 : dot);
      a.om = Math.acos(dot); a.so = Math.sin(a.om) || 1;
      /* 起点高度压到 1.12~1.18R（原版 1.58~1.72R）。
       * 全屏球心在 y=452、球缘投影半径 368，1.6R 会落到距球心 589px ——
       * 弧线顶端跑到 y=-137，也就是「飞到宇宙外面去了」。
       * 1.12R 约 412px，顶端 y≈40，贴着地球飞且离顶栏有余量。 */
      a.r0 = 1.09 + E.hash32(sd, 811) * 0.05;
      a.age = 0;
      a.fly = 1.45 + E.hash32(sd, 907) * 0.70;
      a.hold = 0; a.dis = 0.72;
      a.n = 24; a.tail = 0.66;   /* 尾巴加长：原来只画 46% 弧长，同屏看着像几条短划 */
      return true;
    },

    /** 爬虫落点环（店铺城市），由 app.js 延时到落地时刻调用 */
    landCrawl: function (lat, lon) {
      var v = root.APGeo.toVec3(lat, lon);
      project(v.x, v.y, v.z, P);
      if (P.z >= HZ) addRing(P.x, P.y, 0.44, 13, 0, 1);
    },

    /** AI 引荐订单：从店铺城市沿大圆弧发射到买家城市（粗、暖金、稀有） */
    spawnOrder: function (ev) {
      var E = root.APEngine, Geo = root.APGeo;
      var a = takeArc(1);
      if (!a) return false;
      var sd = seedOf(ev.id);
      var src = Geo.toVec3(ev.store.lat, ev.store.lon);
      var dst = Geo.toVec3(ev.buyerLat, ev.buyerLon);
      a.on = 1; a.kind = 1; a.seed = sd;
      a.ax = src.x; a.ay = src.y; a.az = src.z;
      a.bx = dst.x; a.by = dst.y; a.bz = dst.z;
      var dot = src.x * dst.x + src.y * dst.y + src.z * dst.z;
      dot = dot > 1 ? 1 : (dot < -1 ? -1 : dot);
      a.om = Math.acos(dot); a.so = Math.sin(a.om) || 1;
      /* 弧高压到 0.04~0.15R（原版 0.13~0.43R）。跨半球的订单原本弧顶 1.43R
       * 会顶出屏幕上沿；0.20R 实测顶端 y≈10 虽然没出屏但贴着顶栏，
       * 0.15R 约 424px、顶端 y≈28，留出余量。
       * 参考图（Shopify BFCM Globe）的跨洋弧线也就是这个高度 —— 绕着球走，不飞出去。 */
      a.h = 0.04 + 0.11 * (a.om / Math.PI);
      var rank = TIER_RANK[ev.tier] || 0;
      a.age = 0; a.fly = 1.9; a.hold = 1.5 + rank * 0.55; a.dis = 1.15;
      a.n = 32; a.tail = 1.25;                     /* 大于 1：落点后整条弧亮起 */
      project(src.x, src.y, src.z, P);
      if (P.z >= HZ) addRing(P.x, P.y, 0.85, 22 + rank * 8, 1, 1.6);
      return true;
    },

    /** 订单落点环（买家城市） */
    landOrder: function (lat, lon) {
      var v = root.APGeo.toVec3(lat, lon);
      project(v.x, v.y, v.z, P);
      if (P.z >= HZ) addRing(P.x, P.y, 0.70, 18, 1, 1.4);
    },

    /** 信使。返回 false 表示池满，调用方应立刻直接交付卡片。 */
    sendCourier: function (lat, lon, tx, ty, cb, weight) {
      var v = root.APGeo.toVec3(lat, lon);
      project(v.x, v.y, v.z, P);
      var sx = P.x, sy = P.y;
      if (P.z < HZ) {                              /* 店铺在背面：从球缘绕出来 */
        var dx = tx - CX, dy = ty - CY, m = Math.sqrt(dx * dx + dy * dy) || 1;
        sx = CX + dx / m * LIMB * 0.98; sy = CY + dy / m * LIMB * 0.98;
      }
      for (var i = 0; i < COUR_MAX; i++) {
        var c = cours[i];
        if (c.on) continue;
        c.on = 1; c.t = 0; c.dur = 0.72; c.cb = cb || null;
        c.x0 = sx; c.y0 = sy; c.x1 = tx; c.y1 = ty;
        c.cx = (sx + tx) * 0.5; c.cy = (sy + ty) * 0.5 - 190;
        c.w = weight || 2.4;
        return true;
      }
      return false;
    },

    /** 稀有度冲击：地球呼吸 <= 1.5% + 暗角短暂加深 + 主数字背后体积光 <= 8%。
     *  单向进出的 sin 半周期，无回弹、无发光循环。 */
    pulse: function (tier) {
      var rank = TIER_RANK[tier] || 0;
      if (rank < 2) return;
      pulseT = 0;
      pulseDur = rank === 3 ? 1.15 : 0.9;
      pulseAmp = rank === 3 ? 0.015 : 0.012;
      pulseVig = rank === 3 ? 0.30 : 0.20;
      pulseRay = rank === 3 ? 0.080 : 0.055;
    },
    get vignette() {
      if (pulseT >= pulseDur) return 0;
      return pulseVig * Math.sin(Math.PI * (pulseT / pulseDur));
    },
    get godray() {
      var d = pulseDur * 1.6;
      if (pulseT >= d) return 0;
      return pulseRay * Math.sin(Math.PI * (pulseT / d));
    },

    reset: function () {
      var i;
      for (i = 0; i < arcs.length; i++) arcs[i].on = 0;
      for (i = 0; i < RING_MAX; i++) rings[i].on = 0;
      for (i = 0; i < COUR_MAX; i++) { cours[i].on = 0; cours[i].cb = null; }
      pulseT = 999;
    },

    /** 每帧一次。dtMs 必须来自 APEngine.dt()（已钳制在 100ms）。 */
    frame: function (dtMs) {
      var E = root.APEngine, dtS = dtMs / 1000;

      /* 平时匀速自转（无缓动、永不停）；有订单时短暂接管，把那条经线转到正面。
       * 代入 project 可得 zr = cos(lat)·cos(lon+rot)，所以正对镜头就是 rot = -lon。 */
      if (focusDur > 0) {
        focusT += dtMs;
        var fu = focusT / focusDur;
        if (fu >= 1) { fu = 1; focusDur = 0; }
        /* easeInOutCubic：起步和收尾都软，中段快 —— 像镜头摇过去，不像跳切 */
        var fe = (fu < 0.5) ? (4 * fu * fu * fu) : (1 - Math.pow(-2 * fu + 2, 3) / 2);
        rot = focusFrom + (focusTo - focusFrom) * fe;
      } else {
        rot += SPIN * dtS;                        /* 匀速自转，无缓动，永不停 */
      }
      if (rot > TAU) rot -= TAU;
      if (rot < 0) rot += TAU;
      _rotC = Math.cos(rot); _rotS = Math.sin(rot);

      if (pulseT < 99) pulseT += dtS;
      breath = (pulseT < pulseDur)
        ? 1 + pulseAmp * Math.sin(Math.PI * (pulseT / pulseDur))
        : 1;
      Reff = R * breath;

      noiseDx += 0.020 * (dtMs / 16.667);         /* 0.02px/帧 持续微动 */
      noiseDy += 0.013 * (dtMs / 16.667);
      if (noiseDx > 128) noiseDx -= 128;
      if (noiseDy > 128) noiseDy -= 128;

      ctx.clearRect(0, 0, W, H);

      /* 星空最先画（在球和光晕之下）。只有深色主题有 —— 白日地球没有星星。 */
      drawStars(dtS);

      /* 大气光晕 → 球体本体 → 背面网格 → 点云 → 正面网格 → 收边 → 亮边 → 颗粒。
       * 光晕必须画在本体**之前**（它在球外，被本体盖住一部分正是想要的效果）。 */
      ctx.fillStyle = glowGrad;
      ctx.beginPath(); ctx.arc(CX, CY, LIMB * 1.30 * breath, 0, TAU); ctx.fill();

      ctx.save();
      ctx.translate(CX, CY); ctx.scale(breath, breath); ctx.translate(-CX, -CY);
      ctx.fillStyle = bodyGrad;
      ctx.beginPath(); ctx.arc(CX, CY, LIMB, 0, TAU); ctx.fill();
      ctx.restore();

      /* 球体：背面网格 -> 全部点云 -> 正面网格 -> 球缘收边 -> 颗粒 */
      ctx.lineWidth = 1;
      ctx.strokeStyle = pal.gratBack; drawGrat(false);
      drawCoast();         /* 大陆要垫在城市亮点下面 */
      drawPoints();
      ctx.strokeStyle = pal.gratFront; drawGrat(true);

      ctx.save();
      ctx.translate(CX, CY); ctx.scale(breath, breath); ctx.translate(-CX, -CY);
      ctx.fillStyle = limbGrad;
      ctx.beginPath(); ctx.arc(CX, CY, LIMB, 0, TAU); ctx.fill();
      ctx.restore();

      /* 球缘亮边：上亮下暗的线性渐变 = 受光的那一侧。参考图里最抓眼的就是这道边。 */
      ctx.strokeStyle = rimGrad;
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(CX, CY, LIMB * breath, 0, TAU); ctx.stroke();

      ctx.strokeStyle = pal.warmRim;   /* 暖金细边：留一点品牌色 */
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(CX, CY, LIMB * breath - 1.6, 0, TAU); ctx.stroke();

      drawNoise();

      drawArcs(E, dtS);
      drawRings(dtS);
      drawCours(dtS);
    }
  };

  root.APGlobe = API;
})(typeof window !== 'undefined' ? window : globalThis);
