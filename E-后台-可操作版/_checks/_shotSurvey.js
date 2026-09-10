/* 一次性：把问卷改动后的三屏拍下来人眼过一遍（首屏 / 未选中的题 / 选中后的题）。
 * 不是断言，是给人看的。 */
const PW = 'C:/Users/1/Desktop/工作汇总/Agentic Commerce 产品情报雷达/ac-radar/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright';
const { chromium, devices } = require(PW);
const path = require('path');
const OUT = path.join(process.env.TEMP || '.', 'apsurvey-shot');

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext(Object.assign({}, devices['iPhone 13']));
  const p = await ctx.newPage();
  await p.goto('http://localhost:8099/E-survey/', { waitUntil: 'load' });
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(OUT, '1-intro.png') });

  await p.click('#btnStart');
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(OUT, '2-q1-unselected.png') });

  await p.evaluate(() => document.querySelector('#qopts .opt[data-v="A"]').click());
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(OUT, '3-q1-selected.png') });

  await p.click('#btnNext'); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('#qopts .opt[data-v="yes"]').click());
  await p.click('#btnNext'); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('#qopts .opt[data-v="10-50k"]').click());
  await p.click('#btnNext'); await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(OUT, '4-contact-empty.png') });

  await b.close();
  console.log(OUT);
})().catch((e) => { console.error(e); process.exit(1); });
