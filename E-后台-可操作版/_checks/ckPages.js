const PW = 'C:/Users/1/Desktop/工作汇总/Agentic Commerce 产品情报雷达/ac-radar/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright';
const { chromium } = require(PW);
const U = 'http://localhost:8099/' + encodeURIComponent('E-后台-可操作版') + '/index.html';
let bad = 0;
const ok = (c, m) => { console.log((c ? '  OK   ' : '  ✗    ') + m); if (!c) bad++; };
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto(U, { waitUntil: 'load' });
  await p.click('#goBtn').catch(() => {});
  await p.evaluate(() => window.APEngine.setSpeed(3));
  await p.waitForTimeout(3000);
  ok(errs.length === 0, '启动无错误' + (errs.length ? ': ' + errs.slice(0,3).join(' | ') : ''));

  for (const [nav, label] of [['ord','AI 订单'],['crawl','AI 读取记录'],['store','店铺'],['set','设置']]) {
    await p.click(`#side a[data-nav="${nav}"]`);
    await p.waitForTimeout(700);
    const st = await p.evaluate((n) => {
      const pg = document.querySelector(`#content .page[data-page="${n}"]`);
      const vis = pg && getComputedStyle(pg).display !== 'none';
      const r = pg ? pg.getBoundingClientRect() : null;
      return { vis, h: r ? Math.round(r.height) : 0, crumb: document.getElementById('crumbCur').textContent,
               rows: pg ? pg.querySelectorAll('.prow').length : 0,
               srows: pg ? pg.querySelectorAll('.srow').length : 0,
               pager: pg ? (pg.querySelector('.pager') ? pg.querySelector('.pager').textContent.trim().slice(0,60) : '') : '' };
    }, nav);
    ok(st.vis && st.h > 400, `${label} 页显示且有高度 ${st.h}px`);
    ok(st.crumb === label, `面包屑跟着换：${st.crumb}`);
    if (nav === 'set') ok(st.srows >= 10, `设置页有 ${st.srows} 个控件行`);
    else ok(st.rows > 0, `${label} 有 ${st.rows} 行数据 · 分页「${st.pager}」`);
  }

  const d = await p.evaluate(() => window.APPages.diag);
  console.log('  diag', JSON.stringify(d));
  ok(errs.length === 0, '翻完四页仍无错误' + (errs.length ? ': ' + errs.slice(0,3).join(' | ') : ''));
  console.log(bad ? `\n===== ${bad} 项失败 =====` : '\n===== 通过 =====');
  await b.close();
  process.exit(bad ? 1 : 0);
})();
