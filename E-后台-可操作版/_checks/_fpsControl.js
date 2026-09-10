/* 一次性诊断：全屏地球的 fps 掉到 47 到底是产品退化还是本机负载。
 * 上个会话记的规矩：任何帧率结论都要有对照组。
 * 这里同一次运行里量三个：
 *   ① about:blank（headless rAF 的天花板，据 README 只有约 24.5 —— 先确认这台机器现在是多少）
 *   ② 大屏平铺视图（README 基线 60）
 *   ③ 全屏地球（README 基线 57~60，ckFinal 阈值 >50）
 * 如果 ② 也一起掉，那就是机器负载，不是地球渲染退化。 */
const PW = 'C:/Users/1/Desktop/工作汇总/Agentic Commerce 产品情报雷达/ac-radar/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright';
const { chromium } = require(PW);
const U = 'http://localhost:8099/' + encodeURIComponent('E-后台-可操作版') + '/index.html';

const raf = (p, ms) => p.evaluate((d) => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  (function t() { n++; if (performance.now() - t0 < d) requestAnimationFrame(t);
                  else res(n / ((performance.now() - t0) / 1000)); })();
}), ms);

(async () => {
  const b = await chromium.launch({ args: ['--force-device-scale-factor=1'] });
  const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 },
                                        deviceScaleFactor: 1 })).newPage();

  await p.goto('about:blank');
  const blank = await raf(p, 4000);

  await p.goto(U, { waitUntil: 'load', timeout: 30000 });
  await p.click('#goBtn');
  await p.waitForTimeout(4000);
  const tiled = await raf(p, 5000);

  /* 展开全屏地球：ckFinal 用的入口 */
  await p.click('#gvBtn').catch(async () => { await p.keyboard.press('g'); });
  await p.waitForTimeout(4000);
  const globeOn = await p.evaluate(() => {
    const e = document.getElementById('gv');
    return !!e && getComputedStyle(e).display !== 'none' && e.classList.contains('on');
  });
  const globe = await raf(p, 5000);

  console.log('about:blank      ' + blank.toFixed(1) + ' fps   （README 记的天花板 ≈24.5）');
  console.log('大屏 平铺        ' + tiled.toFixed(1) + ' fps   （README 基线 60）');
  console.log('大屏 全屏地球    ' + globe.toFixed(1) + ' fps   （README 基线 57~60，阈值 >50）'
    + (globeOn ? '' : '   ⚠ 地球层没确认打开'));
  console.log('地球 / 平铺 =    ' + (globe / tiled).toFixed(3)
    + '   （README 那次是 57~60 / 60 ≈ 0.95~1.00）');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
