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
  var CX = 1470, CY = 556, R = 486;
  var CAMD = 3.4;                                     /* 弱透视：相机距球心 3.4R */
  var LIMB = R * CAMD / Math.sqrt(CAMD * CAMD - 1);   /* 透视下球缘的投影半径 */
  var HZ = 1 / CAMD;                                  /* 球面点的可见地平线 z 阈值 */
  var TILT = -15 * Math.PI / 180;                     /* 北极略朝观众 */
  var SPIN = 0.8 * Math.PI / 180;                     /* 0.8 度/秒，匀速 */

  var BG = '8,9,11';

  /* --- 运行态 ---------------------------------------------------------------- */
  var ctx = null, cvs = null;
  var rot = 0, Reff = R, breath = 1;
  var noiseDx = 0, noiseDy = 0;
  var noisePat = null, limbGrad = null;

  var _tiltC = Math.cos(TILT), _tiltS = Math.sin(TILT);
  var _rotC = 1, _rotS = 0;

  /* 呼吸 / 暗角 / 体积光的冲击量（app.js 读取后驱动 DOM 层） */
  var pulseT = 999, pulseDur = 0.9, pulseAmp = 0, pulseVig = 0, pulseRay = 0;

  var P = { x: 0, y: 0, z: 0, k: 1, occ: 0 };
  var P2 = { x: 0, y: 0, z: 0, k: 1, occ: 0 };

  /* =====================================================================
   * 一、投影
   * ===================================================================== */
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
  /* 背面统一取正面的约 12%：规格要求「若隐若现」而不是剔除，才有体积感 */
  var BSTYLE = [
    'rgba(247,248,248,0.62)', 'rgba(247,248,248,0.075)',   /* 档0 正 / 背 */
    'rgba(247,248,248,0.86)', 'rgba(247,248,248,0.100)',   /* 档1 */
    'rgba(247,248,248,1.00)', 'rgba(247,248,248,0.130)',   /* 档2 */
    'rgba(247,248,248,1.00)', 'rgba(247,248,248,0.150)',   /* 档3 */
    'rgba(255,184,107,0.95)', 'rgba(255,184,107,0.140)',   /* 档4 次级城市 */
    'rgba(255,184,107,1.00)', 'rgba(255,184,107,0.180)'    /* 档5 枢纽城市 */
  ];
  var BSIZE = [2, 3, 4, 4, 5, 5];

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

      /* 点数与簇半径都随 weight 走。总量约 5000 点：可见半球直径 1010px，
       * 平均间距 ~11px，配合 1~4px 的点径，大陆会自然连成带而不是一撮撮孤岛。 */
      var cnt = 22 + Math.round(w * 13);
      var spread = 0.040 + w * 0.0075;                 /* 弧度，w=10 时约 6.6 度 */
      for (var kk = 0; kk < cnt; kk++) {
        var sd = i * 149 + kk;
        var ang = E.hash32(sd, 5171) * TAU;
        /* 指数 0.85（而不是 0.5 的等面积采样）让密度朝外衰减，
         * 簇边缘是软的：相邻城市能连成海岸带，而不是一撮撮硬边圆斑。 */
        var rd = Math.pow(E.hash32(sd, 7919), 0.85) * spread;
        var ca = Math.cos(ang), sa = Math.sin(ang);
        var tx = ex * ca + nx * sa, ty = ey * ca + ny * sa, tz = ez * ca + nz * sa;
        var cr = Math.cos(rd), sr = Math.sin(rd);
        tmpX.push(v.x * cr + tx * sr);
        tmpY.push(v.y * cr + ty * sr);
        tmpZ.push(v.z * cr + tz * sr);
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
    for (b = 0; b < NB; b++) {
      var cnt = bn[b];
      if (!cnt) continue;
      ctx.fillStyle = BSTYLE[b];
      ctx.beginPath();
      var X = bx[b], Y = by[b], S = bs[b];
      for (var j = 0; j < cnt; j++) ctx.rect(X[j], Y[j], S[j], S[j]);
      ctx.fill();
    }
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

  function initPools() {
    var i, b, l, k;
    for (i = 0; i < CRAWL_MAX + ORDER_MAX; i++) {
      arcs.push(new Arc());
      arcHeads.push({ x: 0, y: 0, r: 2, k: 0 });
    }
    for (b = 0; b < SB; b++) {
      sx1.push(new Float32Array(SCAP)); sy1.push(new Float32Array(SCAP));
      sx2.push(new Float32Array(SCAP)); sy2.push(new Float32Array(SCAP));
      sn.push(0);
    }
    for (k = 0; k < 2; k++) {
      for (l = 0; l < SEGL; l++) {
        var a = ((l + 1) / SEGL) * (k === 0 ? 0.92 : 0.98);
        SSTYLE.push('rgba(' + (k === 0 ? '0,211,167' : '255,184,107') + ',' +
                    a.toFixed(3) + ')');
      }
    }
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
        ctx.fillStyle = kd === 0 ? 'rgba(0,211,167,0.92)' : 'rgba(255,184,107,1)';
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
      ctx.strokeStyle = (r.k === 0 ? 'rgba(0,211,167,' : 'rgba(255,184,107,') +
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
        ctx.strokeStyle = 'rgba(255,184,107,' + (0.92 * (1 - s / 6)).toFixed(3) + ')';
        ctx.lineWidth = c.w * (1 - s * 0.13);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx2, by2); ctx.stroke();
      }
    }
  }

  /* =====================================================================
   * 八、对外 API
   * ===================================================================== */
  var TIER_RANK = { common: 0, rare: 1, epic: 2, legendary: 3 };

  var API = {
    CX: CX, CY: CY, R: R, LIMB: LIMB,

    init: function (canvas) {
      var E = root.APEngine, Geo = root.APGeo;
      cvs = canvas;
      cvs.width = W; cvs.height = H;      /* 内部分辨率锁死，不乘 devicePixelRatio */
      ctx = cvs.getContext('2d', { alpha: true });
      buildPoints(E, Geo);
      buildGrat(Geo);
      buildNoise(E);                      /* createPattern 只此一次 */
      limbGrad = ctx.createRadialGradient(CX, CY, LIMB * 0.62, CX, CY, LIMB);
      limbGrad.addColorStop(0.00, 'rgba(' + BG + ',0)');
      limbGrad.addColorStop(0.74, 'rgba(' + BG + ',0.16)');
      limbGrad.addColorStop(1.00, 'rgba(' + BG + ',0.52)');
      initPools(); initRings(); initCours();
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
      a.r0 = 1.58 + E.hash32(sd, 811) * 0.14;
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
      a.h = 0.13 + 0.30 * (a.om / Math.PI);
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

      rot += SPIN * dtS;                          /* 匀速自转，无缓动，永不停 */
      if (rot > TAU) rot -= TAU;
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

      /* 球体：背面网格 -> 全部点云 -> 正面网格 -> 球缘收边 -> 颗粒 */
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(125,211,252,0.026)'; drawGrat(false);
      drawPoints();
      ctx.strokeStyle = 'rgba(125,211,252,0.090)'; drawGrat(true);

      ctx.save();
      ctx.translate(CX, CY); ctx.scale(breath, breath); ctx.translate(-CX, -CY);
      ctx.fillStyle = limbGrad;
      ctx.beginPath(); ctx.arc(CX, CY, LIMB, 0, TAU); ctx.fill();
      ctx.restore();

      ctx.strokeStyle = 'rgba(255,184,107,0.19)';   /* 暖金球缘：全屏暖金气质的锚 */
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(CX, CY, LIMB * breath, 0, TAU); ctx.stroke();

      drawNoise();

      drawArcs(E, dtS);
      drawRings(dtS);
      drawCours(dtS);
    }
  };

  root.APGlobe = API;
})(typeof window !== 'undefined' ? window : globalThis);
