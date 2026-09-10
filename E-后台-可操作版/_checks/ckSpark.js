/* 趋势线验证：像素级证明「线在动」+「面积渐变存在」+「四张卡都有线」。
 *
 * 探针教训（README 坑 15/16）：不要在动的对象上按固定坐标问「有没有亮」。
 * 这里问的是**形状性质**：
 *   1) 四条线的 canvas 都存在且尺寸正确
 *   2) 每条线的最高点明显高于最低点（不是水平线）—— 这是上一版的真实缺陷
 *   3) 面积填充存在：线下方有厚度，**且** alpha 向下衰减（这两条合起来才排除得掉
 *      「粗描边」和「实心色块」两种冒充；单看厚度会随动画相位漂，见文件中段的阈值说明）
 *   4) 两次采样之间画面**变了**（逐像素 diff），证明它每帧在生长而不是 3 秒闪一次
 */
const PW = 'C:/Users/1/Desktop/工作汇总/Agentic Commerce 产品情报雷达/ac-radar/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright';
let chromium = null;
for (const q of ['playwright', '/Users/zezedabaobei/node_modules/playwright', PW]) {
  try { chromium = require(q).chromium; break; } catch (e) {}
}
/* PW 原来写死作者本机的 Windows 绝对路径，别的机器一律 MODULE_NOT_FOUND，
   整个套件跑不起来（也就意味着它的红一直没人看见）。改成按顺序试。 */
if (!chromium) { console.log('跳过：找不到 playwright'); process.exit(0); }

const URL = 'http://localhost:8099/' + encodeURIComponent('E-后台-可操作版') + '/index.html';
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? '  OK  ' : '  FAIL ') + m); c ? pass++ : fail++; };

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const pg = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const errs = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(URL, { waitUntil: 'load' });
  await pg.click('#goBtn').catch(() => {});
  await pg.evaluate(() => window.APEngine.setSpeed(3));
  await pg.waitForTimeout(4000);

  /* 1) 四条线都在 */
  const geom = await pg.evaluate(() => ['sk0', 'sk1', 'sk2', 'sk3'].map(id => {
    const c = document.querySelector('#' + id + ' canvas');
    return c ? { id, w: c.width, h: c.height } : { id, w: 0, h: 0 };
  }));
  /* 尺寸**不写死**：趋势线按需求加宽过一次（104×30 → 168×34），
     钉死一个数只会在每次调宽度时假红。该验的是「四条都在、四条同尺寸、
     且比原来那档宽」——尺寸本身的具体值由 app.js 的 makeSpark 调用点决定。 */
  ok(geom.every(g => g.w === geom[0].w && g.h === geom[0].h && g.w >= 104 && g.h >= 30),
    '四张 KPI 卡趋势线齐全且等尺寸：' + geom.map(g => g.id + ' ' + g.w + 'x' + g.h).join(' / '));

  /* 2) + 3) 形状：非水平 + 有面积 */
  const shape = await pg.evaluate(() => {
    return ['sk0', 'sk1', 'sk2', 'sk3'].map(id => {
      const c = document.querySelector('#' + id + ' canvas');
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      /* 判定「有没有面积填充」不能量绝对高度 —— 见下方阈值说明。
       * 这里同时收两组量：
       *   colH  —— 列内着色像素的跨度（alpha>0，取到渐变的真实尾巴）
       *   upA/loA —— 线正下方 1/3 段 与 靠底部 1/3 段 的平均 alpha */
      let colTop = [], colH = [], upSum = 0, upN = 0, loSum = 0, loN = 0;
      for (let x = 0; x < c.width; x++) {
        let t = -1, b24 = -1, b0 = -1;
        for (let y = 0; y < c.height; y++) {
          const a = d[(y * c.width + x) * 4 + 3];
          if (a > 24 && t < 0) t = y;
          if (a > 24) b24 = y;
          if (a > 0) b0 = y;
        }
        if (t < 0) continue;
        colTop.push(t); colH.push(b0 - t + 1);
        const span = b0 - t;
        if (span >= 6) {
          for (let k = 1; k <= Math.floor(span / 3); k++) {
            upSum += d[((t + k) * c.width + x) * 4 + 3]; upN++;
          }
          for (let k = Math.floor(span * 2 / 3); k < span; k++) {
            loSum += d[((t + k) * c.width + x) * 4 + 3]; loN++;
          }
        }
      }
      const av = a => a.length ? a.reduce((p, q) => p + q, 0) / a.length : 0;
      /* 折线起伏：各列线顶端 y 的极差 */
      const relief = colTop.length ? Math.max(...colTop) - Math.min(...colTop) : 0;
      return { id, relief, cols: colTop.length, colH: av(colH),
               upA: upSum / Math.max(upN, 1), loA: loSum / Math.max(loN, 1) };
    });
  });
  shape.forEach(s => {
    ok(s.relief >= 5,
      s.id + ' 折线有起伏（不是水平线）：线顶端 y 极差 ' + s.relief + 'px');
  });
  /* ── 阈值是实测校准过的，别凭直觉往上调（README 坑 29） ────────────────
   * 上一版这条断言是「alpha>24 的平均列高 > 6px」，它会随机红 ——
   * 因为渐变是**按画布**铺的（y=0 时 0.42 → y=h 时 0），alpha>24 只能探到 y≈22；
   * 而折线用纯 min-max 占满整个框高，平均线顶 y 就在 15 附近，
   * 于是「平均列高」的期望值 ≈ 22-15 = 7 —— 阈值 6 正好压在期望值上。
   * 12 次采样实测：alpha>24 的平均列高 3.4~7.1（跨过 6，所以掷硬币）。
   *
   * 换成两条不随动画相位漂的：
   *   colH（alpha>0 跨度）实测 7.7~13.8，纯描边约 2~3 → 阈值 5
   *   upA/loA（渐变是否向下衰减）实测 8~15 倍，实心填充≈1、纯描边根本没下方像素 → 阈值 3 */
  shape.forEach(s => {
    ok(s.colH >= 5,
      s.id + ' 线下方有厚度：列内着色跨度 ' + s.colH.toFixed(1) + 'px（纯描边约 2~3px）');
  });
  shape.forEach(s => {
    const r = s.upA / Math.max(s.loA, 1);
    ok(r >= 3,
      s.id + ' 而且是向下衰减的渐变：上段 alpha ' + s.upA.toFixed(0) +
      ' / 下段 ' + s.loA.toFixed(0) + ' = ' + r.toFixed(1) + '倍（实心填充≈1倍）');
  });

  /* 4) 在动：两帧之间逐像素 diff */
  const snap = () => pg.evaluate(() => ['sk0', 'sk1', 'sk2', 'sk3'].map(id => {
    const c = document.querySelector('#' + id + ' canvas');
    return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
  }));
  const a = await snap();
  await pg.waitForTimeout(420);          /* 远小于 900ms 的采样周期 */
  const c2 = await snap();
  const diffs = a.map((arr, i) => {
    let n = 0;
    for (let k = 0; k < arr.length; k += 4) if (Math.abs(arr[k + 3] - c2[i][k + 3]) > 10) n++;
    return n;
  });
  ['sk0', 'sk1', 'sk2', 'sk3'].forEach((id, i) => {
    ok(diffs[i] > 20,
      id + ' 420ms 内画面在变（采样周期 900ms，证明是逐帧生长不是定时闪）：变了 ' + diffs[i] + ' 像素');
  });

  /* 5) 主题切换后线还在且换色。
   * **必须先显式切到 0**：原来直接读当前色当「深色」，但首屏默认是**浅色**
   * （见 index.html 的 #stage 注释：「首屏默认就是浅色，避免初始化前闪深色」），
   * 于是两次读到的都是浅色、必然判成「没重烤」。
   * 这条红一直没被发现，因为这个套件的 playwright 路径写死成作者本机的
   * Windows 绝对路径 —— 换台机器根本跑不起来，跑不起来的套件不会报红。 */
  await pg.evaluate(() => window.APDiag.setTheme(0));
  await pg.waitForTimeout(600);
  const darkCol = await pg.evaluate(() => {
    const c = document.querySelector('#sk1 canvas'), g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    for (let k = 0; k < d.length; k += 4) if (d[k + 3] > 200) return [d[k], d[k + 1], d[k + 2]];
    return null;
  });
  await pg.evaluate(() => window.APDiag.setTheme(1));
  await pg.waitForTimeout(600);
  const lightCol = await pg.evaluate(() => {
    const c = document.querySelector('#sk1 canvas'), g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    for (let k = 0; k < d.length; k += 4) if (d[k + 3] > 200) return [d[k], d[k + 1], d[k + 2]];
    return null;
  });
  ok(darkCol && lightCol && darkCol.join() !== lightCol.join(),
    '换主题后趋势线重烤了：深色 rgb(' + darkCol + ') → 浅色 rgb(' + lightCol + ')');

  ok(errs.length === 0, '无 console 错误' + (errs.length ? '：' + errs[0] : ''));
  console.log('\n' + (fail ? '===== ' + fail + ' 项失败 =====' : '===== 全部通过 (' + pass + ') ====='));
  await b.close();
  process.exit(fail ? 1 : 0);
})();
