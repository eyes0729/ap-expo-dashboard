/* 四个内页的版面账：不许横向溢出、不许纵向溢出、不许内部裁切。
 * 1920×1080 下侧栏 232 + 内容内边距 24×2 → 主区可用宽 1640。 */
const PW = 'C:/Users/1/Desktop/工作汇总/Agentic Commerce 产品情报雷达/ac-radar/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright';
const { chromium } = require(PW);
const U = 'http://localhost:8099/' + encodeURIComponent('E-后台-可操作版') + '/index.html';
let bad = 0;
const ok = (c, m) => { console.log((c ? '  OK   ' : '  ✗    ') + m); if (!c) bad++; };

(async () => {
  const b = await chromium.launch({ args: ['--force-device-scale-factor=1'] });
  const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto(U, { waitUntil: 'load' });
  await p.click('#goBtn').catch(() => {});
  await p.evaluate(() => window.APEngine.setSpeed(3));
  await p.waitForTimeout(3000);

  for (const [nav, label] of [['ord', 'AI 订单'], ['crawl', 'AI 读取记录'],
                              ['store', '店铺'], ['set', '设置']]) {
    await p.click(`#side a[data-nav="${nav}"]`);
    await p.waitForTimeout(700);
    const r = await p.evaluate((n) => {
      const pg = document.querySelector(`.page[data-page="${n}"]`);
      const pr = pg.getBoundingClientRect();
      const stage = document.getElementById('stage').getBoundingClientRect();
      /* 表头列宽合计 vs 可用宽 */
      const th = pg.querySelector('.th');
      let colSum = 0;
      if (th) th.querySelectorAll('.c').forEach(c => { colSum += c.getBoundingClientRect().width; });
      /* 任何子元素越出舞台边界？ */
      const over = [];
      pg.querySelectorAll('*').forEach(e => {
        const b = e.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) return;
        if (b.right > stage.right + 0.5 || b.left < stage.left - 0.5
            || b.bottom > stage.bottom + 0.5 || b.top < stage.top - 0.5) {
          over.push((e.id || e.className || e.tagName) + ' ' + Math.round(b.left) + ',' +
            Math.round(b.top) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
        }
      });
      /* 面板内容有没有溢出它自己（scrollHeight > clientHeight 且不是可滚容器） */
      const pan = pg.querySelector('.pan.grow');
      const body = pg.querySelector('.pbody');
      return {
        w: Math.round(pr.width), h: Math.round(pr.height),
        colSum: Math.round(colSum),
        panScroll: pan ? pan.scrollHeight - pan.clientHeight : 0,
        bodyScroll: body ? body.scrollHeight - body.clientHeight : 0,
        bodyScrollable: body ? getComputedStyle(body).overflowY : '',
        over: over.slice(0, 5), overN: over.length,
        rows: pg.querySelectorAll('.prow').length,
        pagerH: (() => { const g = pg.querySelector('.pager');
          return g ? Math.round(g.getBoundingClientRect().height) : 0; })()
      };
    }, nav);
    ok(r.w === 1640, `${label}：页面宽 ${r.w} = 主区可用宽 1640`);
    ok(r.h === 975, `${label}：页面高 ${r.h} = 内容可用高 975`);
    ok(r.overN === 0, `${label}：无元素越出舞台` + (r.overN ? ' → ' + r.over.join(' | ') : ''));
    if (r.colSum) ok(r.colSum <= 1640,
      `${label}：表头列宽合计 ${r.colSum} ≤ 1640（不横向溢出）`);
    ok(r.panScroll <= 0, `${label}：面板本身不溢出（溢出 ${r.panScroll}px）`);
    if (nav !== 'set') {
      ok(r.bodyScroll <= 0,
        `${label}：${r.rows} 行装得下表体（溢出 ${r.bodyScroll}px，分页条 ${r.pagerH}px）`);
    } else {
      ok(r.bodyScrollable === 'auto',
        `${label}：设置页表体可滚（overflow-y=${r.bodyScrollable}），内容比一屏长是正常的`);
    }
  }

  /* 浅色主题下再走一遍 —— 有些溢出只在字重/字宽变化后才出现 */
  await p.evaluate(() => window.APDiag.setTheme(1));
  await p.waitForTimeout(600);
  for (const nav of ['ord', 'crawl', 'store', 'set']) {
    await p.click(`#side a[data-nav="${nav}"]`);
    await p.waitForTimeout(500);
    const n = await p.evaluate((k) => {
      const pg = document.querySelector(`.page[data-page="${k}"]`);
      const stage = document.getElementById('stage').getBoundingClientRect();
      let c = 0;
      pg.querySelectorAll('*').forEach(e => {
        const b = e.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) return;
        if (b.right > stage.right + 0.5 || b.bottom > stage.bottom + 0.5) c++;
      });
      return c;
    }, nav);
    ok(n === 0, `浅色主题 · ${nav} 页无溢出`);
  }

  ok(errs.length === 0, '无错误' + (errs.length ? ': ' + errs[0] : ''));
  console.log(bad ? `\n===== ${bad} 项失败 =====` : '\n===== 全部通过 =====');
  await b.close();
  process.exit(bad ? 1 : 0);
})();
