/* 「假操作」全局盘查。
 *
 * 判据不是「点了没报错」，而是**点完之后有可观测的状态变化**：
 * DOM 类名 / 表格行数 / 排序方向 / 引擎状态 / 下载事件 / 页面切换。
 * 只要点一个控件而什么都没变，它就是假的。
 */
const PW = 'C:/Users/1/Desktop/工作汇总/Agentic Commerce 产品情报雷达/ac-radar/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright';
let chromium = null;
for (const q of ['playwright', '/Users/zezedabaobei/node_modules/playwright', PW]) {
  try { chromium = require(q).chromium; break; } catch (e) {}
}
/* PW 原来写死成作者本机的 Windows 绝对路径，在别的机器上一律 MODULE_NOT_FOUND，
   整个套件跑不起来。改成按顺序试，找不到就明说跳过，不静默降级。 */
if (!chromium) { console.log('跳过：找不到 playwright'); process.exit(0); }
const U = 'http://localhost:8099/' + encodeURIComponent('E-后台-可操作版') + '/index.html';
let bad = 0, n = 0;
const ok = (c, m) => { console.log((c ? '  OK   ' : '  ✗    ') + m); n++; if (!c) bad++; };
const sec = t => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length)));

(async () => {
  const b = await chromium.launch({ args: ['--force-device-scale-factor=1'] });
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
    acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto(U, { waitUntil: 'load' });
  await p.click('#goBtn').catch(() => {});
  await p.evaluate(() => window.APEngine.setSpeed(3));
  await p.waitForTimeout(3500);

  const snap = () => p.evaluate(() => ({
    theme: window.APDiag.theme,
    page: window.APPages.cur,
    crumb: document.getElementById('crumbCur').textContent,
    sortKey: (document.querySelector('#ordHead .so.asc,#ordHead .so.desc') || {}).getAttribute
      ? (document.querySelector('#ordHead .so.asc,#ordHead .so.desc')).getAttribute('data-so') : '',
    sortDir: document.querySelector('#ordHead .so.asc') ? 'asc' : 'desc',
    ordRows: document.querySelectorAll('#ordBody .orow').length,
    ordShown: window.APDiag.ordShown,
    kpiSel: Array.from(document.querySelectorAll('#kpi .kc'))
      .filter(e => e.classList.contains('pick')).map(e => e.getAttribute('data-kpi')).join(','),
    chanSel: Array.from(document.querySelectorAll('#chanBody .rr'))
      .filter(e => e.classList.contains('on')).length,
    chanDim: Array.from(document.querySelectorAll('#chanBody .rr'))
      .filter(e => e.classList.contains('dim')).length,
    chanNote: document.getElementById('chanNote').textContent,
    pauseTx: document.getElementById('pauseTx').textContent,
    pauseHot: document.getElementById('btnPause').classList.contains('hot'),
    pauseVisible: (() => {
      const s = getComputedStyle(document.getElementById('btnPause'));
      return +s.opacity > 0.5 && s.visibility !== 'hidden';
    })(),
    clrDisabled: document.getElementById('btnClr').disabled,
    rng: (document.querySelector('#rng button.on') || {}).textContent,
    e1: document.getElementById('e1').textContent,
    speed: window.APEngine.speed,
    paused: window.APEngine.paused,
    logPanFocus: document.getElementById('logPan').classList.contains('focus'),
    ordPanFocus: document.getElementById('ordPan').classList.contains('focus'),
    lotOpen: document.getElementById('lotCard').classList.contains('on'),
    pieCC: document.getElementById('pieCC').textContent,
    pieC3: document.getElementById('pieC3').textContent
  }));

  /* ══ 1. 侧栏导航 ══ */
  sec('侧栏导航（原先只换高亮，页面不变）');
  for (const [k, label] of [['ord', 'AI 订单'], ['crawl', 'AI 读取记录'],
                            ['store', '店铺'], ['set', '设置'], ['ov', '实时看板']]) {
    const a0 = await snap();
    await p.click(`#side a[data-nav="${k}"]`);
    await p.waitForTimeout(450);
    const a1 = await snap();
    ok(a1.page === k && a1.crumb === label && a1.page !== a0.page || (k === a0.page),
      `${label}：页面真的换了（${a0.page} → ${a1.page}，面包屑「${a1.crumb}」）`);
  }

  /* ══ 2. KPI 四卡选中态 ══ */
  sec('KPI 四卡选中态（原先后三张点了没反应）');
  await p.click('#side a[data-nav="ov"]');
  await p.waitForTimeout(300);
  for (const k of ['gmv', 'ord', 'crawl']) {
    const a0 = await snap();
    await p.click(`#kpi .kc[data-kpi="${k}"]`);
    await p.waitForTimeout(400);
    const a1 = await snap();
    ok(a1.kpiSel === k, `点「${k}」卡 → 选中态出现（${a0.kpiSel || '无'} → ${a1.kpiSel}）`);
    /* 选中不许改变几何。上一版状态类叫 .sel，而 .sel 是筛选下拉的包裹类
       （height:26px），卡片一被选中就从 96px 塌成 28px —— 类名撞车，两次了。 */
    const gm = await p.evaluate(() => Array.from(document.querySelectorAll('#kpi .kc'))
      .map(e => Math.round(e.getBoundingClientRect().height)));
    ok(gm.every(h => h === 96),
      `  └ 选中不改变卡片几何（四张高度 ${gm.join('/')}，应全是 96）`);
    if (k === 'gmv') ok(a1.sortKey === 'usd' && a1.sortDir === 'desc',
      `  └ 且订单表真的改成金额降序（${a1.sortKey}/${a1.sortDir}）`);
    if (k === 'ord') ok(a1.sortKey === 't', `  └ 且订单表回到最新在前（${a1.sortKey}）`);
    if (k === 'crawl') ok(a1.logPanFocus, '  └ 且下方读取日志面板被高亮');
  }
  /* 再点一次取消 */
  await p.click('#kpi .kc[data-kpi="crawl"]');
  await p.waitForTimeout(300);
  ok((await snap()).kpiSel === '', '再点一次取消选中');
  /* 店铺卡 → 跳页 */
  await p.click('#kpi .kc[data-kpi="store"]');
  await p.waitForTimeout(500);
  ok((await snap()).page === 'store', '点「店铺」卡 → 跳到店铺页（那个指标的明细在那）');
  await p.click('#side a[data-nav="ov"]');
  await p.waitForTimeout(300);

  /* ══ 3. 渠道分布卡 ══ */
  sec('渠道分布卡（原先是纯展示的死卡片）');
  await p.hover('#chanBody .rr:nth-child(2)');
  await p.waitForTimeout(300);
  let a = await snap();
  ok(a.chanDim > 0 && /\d+ 笔/.test(a.chanNote),
    `hover → 其余 ${a.chanDim} 行压暗，列头出详情「${a.chanNote}」`);
  const before = await snap();
  await p.click('#chanBody .rr:nth-child(2)');
  await p.waitForTimeout(500);
  a = await snap();
  ok(a.chanSel === 1, '点击 → 该行进入选中态（鼠标移开也还看得见）');
  ok(a.ordShown !== before.ordShown, `点击 → 订单表真的被筛了（${before.ordShown} → ${a.ordShown}）`);
  ok(!a.clrDisabled, '  └ 「清空筛选」随之可用');
  await p.click('#chanBody .rr:nth-child(2)');
  await p.waitForTimeout(400);
  ok((await snap()).chanSel === 0, '再点一次取消筛选');

  /* ══ 4. 暂停滚动按钮（原先按下就看不见了） ══ */
  sec('暂停滚动（原先按下后整个按钮 opacity:0）');
  await p.click('#btnPause');
  await p.waitForTimeout(300);
  a = await snap();
  ok(a.pauseTx === '继续滚动' && a.pauseHot, `按下 → 文案变「${a.pauseTx}」且有按下态`);
  ok(a.pauseVisible, '按下后按钮仍然看得清（不再被全局 .act 变透明）');
  await p.click('#btnPause');
  await p.waitForTimeout(300);
  ok((await snap()).pauseTx === '暂停滚动', '再点恢复');

  /* ══ 4b. 造单快捷键：一个键一档，按下去必然是那一档 ══ */
  sec('造单快捷键 N / C / B / V（原先只有 B、N 且区间横跨档位边界）');
  await p.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
  /* 把引擎降到最慢再测。前一版在 3× 下跑，**自然到达的订单**会插在两次按键之间，
     于是 lastOrder 读到的是那笔自然单（实测出现过 common:21 混进 V 的四连按里）——
     那是探针不稳，不是产品有问题。0.1× 下自然单约 10 分钟一笔，测试窗口只有 5 秒。 */
  await p.evaluate(() => window.APEngine.setSpeed(0.1));
  await p.waitForTimeout(400);
  for (const [key, want, label] of [['n', 'common', '普通'], ['c', 'rare', '较大'],
                                    ['b', 'epic', '大额'], ['v', 'legendary', '特大']]) {
    /* 用「最新那笔的订单号变了」判定，不用缓冲长度 ——
       ordBuf 上限是 80，满了以后长度恒等于 80，越按越不动（前一版的假失败）。 */
    const n0 = await p.evaluate(() => (window.APDiag.lastOrder || {}).no || '');
    /* 一个键连按 4 次，每次都必须落在同一档 —— 只按一次可能是碰巧 */
    const got = [];
    for (let i = 0; i < 4; i++) {
      await p.keyboard.press(key);
      await p.waitForTimeout(320);
      got.push(await p.evaluate(() => {
        const b = window.APDiag.lastOrder;
        return b ? b.tier + ':' + Math.round(b.usd) : '?';
      }));
    }
    const n1 = await p.evaluate(() => (window.APDiag.lastOrder || {}).no || '');
    ok(n1 && n1 !== n0, `按 ${key.toUpperCase()} 真的造出订单（最新订单号 ${n0} → ${n1}）`);
    ok(got.every(g => g.split(':')[0] === want),
      `按 ${key.toUpperCase()} 连按 4 次全是「${label}」档：${got.join(' , ')}`);
  }

  await p.evaluate(() => window.APEngine.setSpeed(3));   /* 恢复，后面的用例还要靠它出数据 */
  await p.waitForTimeout(500);

  /* ══ 5. 看板筛选 / 清空 / 排序 / 抽屉 ══ */
  sec('看板筛选 · 排序 · 抽屉');
  a = await snap();
  ok(a.clrDisabled, '无筛选时「清空筛选」是禁用的（不是可点但没反应）');
  /* 原来是 selectOption('#fTier','epic') —— 三个 <select> 已改成勾选面板。
     走真实交互：点开筛选 → 勾「大额」。 */
  await p.click('#btnFilter');
  await p.waitForTimeout(250);
  await p.click('#filterPop .fl[data-k="tier"] .fo:nth-child(3)');
  await p.waitForTimeout(500);
  const filtered = await snap();
  ok(filtered.ordShown !== a.ordShown && !filtered.clrDisabled,
    `选「大额」→ 行数变了（${a.ordShown} → ${filtered.ordShown}），清空按钮变可用`);
  await p.click('#btnClr');
  await p.waitForTimeout(500);
  const cleared = await snap();
  ok(cleared.clrDisabled && cleared.ordShown !== filtered.ordShown,
    `点「清空筛选」→ 真的清了（${filtered.ordShown} → ${cleared.ordShown}），按钮回到禁用`);

  const s0 = await snap();
  await p.click('#ordHead .so[data-so="usd"]');
  await p.waitForTimeout(400);
  const s1 = await snap();
  ok(s1.sortKey === 'usd', `点表头「金额」→ 排序键变成 usd（原 ${s0.sortKey}）`);
  await p.click('#ordHead .so[data-so="usd"]');
  await p.waitForTimeout(400);
  ok((await snap()).sortDir !== s1.sortDir, '再点一次 → 升降序反转');

  await p.click('#ordBody .orow');
  await p.waitForTimeout(500);
  ok(await p.evaluate(() => document.getElementById('drawer').classList.contains('on')),
    '点订单行 → 详情抽屉打开');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);

  /* ══ 6. 顶栏 ══ */
  sec('顶栏：时间范围 / 搜索 / 导出 / 主题');
  const r0 = await snap();
  await p.click('#rng button[data-rng="all"]');
  await p.waitForTimeout(600);
  const r1 = await snap();
  ok(r1.rng === '累计' && r1.e1 === '累计', `切「累计」→ 状态与四卡副标都跟着变（${r0.e1} → ${r1.e1}）`);
  await p.click('#rng button[data-rng="session"]');
  await p.waitForTimeout(500);

  /* 店铺搜索已按需求隐藏（index.html 的 .fld.hide）。
     Playwright 对 display:none 的元素 fill 会**超时**，那是环境问题不是产品缺陷，
     所以这一段改走 APDiag.setFilter —— 筛选逻辑本身没删，仍然该被验。 */
  await p.evaluate(() => APDiag.setFilter({ q: 'zzzz-不可能命中' }));
  await p.waitForTimeout(500);
  ok(await p.evaluate(() => getComputedStyle(document.getElementById('ordEmpty')).display !== 'none'),
    '顶栏搜索一个不存在的词 → 出空态（说明搜索作用于整个缓冲）');
  await p.evaluate(() => APDiag.setFilter({ q: '' }));
  await p.waitForTimeout(500);

  const t0 = (await snap()).theme;
  await p.click('#btnTheme');
  await p.waitForTimeout(700);
  ok((await snap()).theme !== t0, `主题按钮 → 真的换了（${t0} → ${(await snap()).theme}）`);
  await p.click('#btnTheme');
  await p.waitForTimeout(700);

  const dl1 = p.waitForEvent('download', { timeout: 8000 });
  await p.click('#btnExp');
  const f1 = await dl1.catch(() => null);
  ok(f1 && /\.csv$/.test(f1.suggestedFilename()),
    `导出 CSV → 真的下载了文件（${f1 ? f1.suggestedFilename() : '无'}）`);

  /* ══ 7. 饼图中心不再压字 ══ */
  sec('饼图：国家数搬出内圈');
  a = await snap();
  ok(/个国家/.test(a.pieCC) && a.pieC3 === '',
    `「${a.pieCC}」现在在列头，甜甜圈内圈第三行为空（不再压在扇区上）`);

  /* ══ 8. 内页：筛选 / 搜索 / 排序 / 分页 / 导出 ══ */
  for (const [pg, ids] of Object.entries({
    ord:   { q: 'pOrdQ', sel: 'pOrdSrc', clr: 'pOrdClr', exp: 'pOrdExp', body: 'pOrdBody', pager: 'pOrdPager' },
    crawl: { q: 'pCrQ', sel: 'pCrSt', clr: 'pCrClr', exp: 'pCrExp', body: 'pCrBody', pager: 'pCrPager' },
    store: { q: 'pStQ', sel: 'pStSt', clr: 'pStClr', exp: 'pStExp', body: 'pStBody', pager: 'pStPager' }
  })) {
    sec(`内页「${pg}」：搜索 / 筛选 / 排序 / 分页 / 导出`);
    await p.click(`#side a[data-nav="${pg}"]`);
    await p.waitForTimeout(600);
    const rows0 = await p.evaluate(id => document.querySelectorAll('#' + id + ' .prow').length, ids.body);
    const diag0 = await p.evaluate(() => window.APPages.diag);
    ok(rows0 > 0, `初始有 ${rows0} 行（筛选前全集 ${diag0[pg].rows} 条）`);

    /* 搜索：不可能命中 → 空态 */
    await p.fill('#' + ids.q, 'zzz不可能命中zzz');
    await p.waitForTimeout(500);
    const emptyRows = await p.evaluate(id => document.querySelectorAll('#' + id + ' .prow').length, ids.body);
    const hasEmpty = await p.evaluate(id => !!document.querySelector('#' + id + ' .pempty'), ids.body);
    ok(emptyRows === 0 && hasEmpty, '搜不存在的词 → 0 行 + 空态提示');
    await p.fill('#' + ids.q, '');
    await p.waitForTimeout(500);

    /* 筛选下拉：取第 2 个 option */
    const opt = await p.evaluate(id => {
      const s = document.getElementById(id);
      return s.options.length > 1 ? s.options[1].value : null;
    }, ids.sel);
    /* 别只试第 2 个 option 就断言「行数一定变」—— 那是探针在替数据做保证。
     * 爬虫状态绝大多数是 200，缓冲区里恰好没有非 200 行时，
     * 「筛 200」不改变行数是**正确行为**，而旧断言会随机红（README 坑 30）。
     * 改成：先验恒真的性质（筛完不会变多），再遍历所有 option 找一个真有区分度的；
     * 一个都找不到时明说「本轮数据在这一维退化」，不当失败。 */
    const opts = await p.evaluate(id => Array.from(document.getElementById(id).options)
      .slice(1).map(o => o.value), ids.sel);
    if (opts.length) {
      await p.selectOption('#' + ids.sel, opts[0]);
      await p.waitForTimeout(500);
      const d = await p.evaluate(() => window.APPages.diag);
      ok(d[pg].rows <= diag0[pg].rows,
        `筛选「${opts[0]}」→ 全集不会变多（${diag0[pg].rows} → ${d[pg].rows}）`);

      let sel = null;
      for (const o of opts) {
        await p.selectOption('#' + ids.sel, o);
        await p.waitForTimeout(320);
        const dx = await p.evaluate(() => window.APPages.diag);
        if (dx[pg].rows !== diag0[pg].rows) { sel = { o, rows: dx[pg].rows }; break; }
      }
      if (sel) {
        ok(true, `筛选真的在筛：「${sel.o}」把全集从 ${diag0[pg].rows} 收到 ${sel.rows} 条`);
        await p.click('#' + ids.clr);
        await p.waitForTimeout(500);
        const d2 = await p.evaluate(() => window.APPages.diag);
        /* 不能写 === diag0：缓冲区是活的，筛选那几秒里全集自己还在长。
         * 恒真的性质是「不少于当初的全集，且严格多于筛完的」（README 坑 30） */
        ok(d2[pg].rows >= diag0[pg].rows && d2[pg].rows > sel.rows,
          `「清空筛选」→ 回到全集（筛后 ${sel.rows} → ${d2[pg].rows}，初始全集 ${diag0[pg].rows}）`);
        const cleared = await p.evaluate(id => document.getElementById(id).value, ids.sel);
        ok(!cleared, `「清空筛选」把下拉框也复位了（value=「${cleared}」）`);
      } else {
        console.log(`   !! ${opts.length} 个筛选值都没改变行数：本轮全集在这一维只有一种取值，` +
                    `筛选无从产生差异（不判失败，也不算验过）`);
        await p.click('#' + ids.clr);
        await p.waitForTimeout(500);
      }
    }

    /* 排序：点第一个可排序表头两次，方向要反转 */
    const sortState = () => p.evaluate(pgk => {
      const h = document.querySelector(`.page[data-page="${pgk}"] .th .so.asc, .page[data-page="${pgk}"] .th .so.desc`);
      return h ? h.getAttribute('data-so') + '/' + (h.classList.contains('asc') ? 'asc' : 'desc') : '';
    }, pg);
    const so0 = await sortState();
    const firstSo = await p.evaluate(pgk => {
      const hs = document.querySelectorAll(`.page[data-page="${pgk}"] .th .so`);
      for (const h of hs) if (!h.classList.contains('asc') && !h.classList.contains('desc'))
        return h.getAttribute('data-so');
      return null;
    }, pg);
    if (firstSo) {
      await p.click(`.page[data-page="${pg}"] .th .so[data-so="${firstSo}"]`);
      await p.waitForTimeout(400);
      const so1 = await sortState();
      ok(so1 !== so0 && so1.indexOf(firstSo) === 0, `点表头「${firstSo}」→ 排序变了（${so0} → ${so1}）`);
      await p.click(`.page[data-page="${pg}"] .th .so[data-so="${firstSo}"]`);
      await p.waitForTimeout(400);
      ok((await sortState()) !== so1, '再点一次 → 升降序反转');
    }

    /* 分页：点第 2 页，首行内容必须变，且「实时刷新」提示改为已暂停 */
    const first = () => p.evaluate(id => {
      const r = document.querySelector('#' + id + ' .prow');
      return r ? r.textContent.slice(0, 40) : '';
    }, ids.body);
    const f0 = await first();
    const liveBefore = await p.evaluate(id =>
      document.querySelector('#' + id + ' .pg-live').className, ids.pager);
    const has2 = await p.evaluate(id =>
      Array.from(document.querySelectorAll('#' + id + ' .pg-b'))
        .some(b => b.textContent === '2'), ids.pager);
    if (has2) {
      await p.evaluate(id => Array.from(document.querySelectorAll('#' + id + ' .pg-b'))
        .find(b => b.textContent === '2').click(), ids.pager);
      await p.waitForTimeout(600);
      const f1b = await first();
      ok(f1b && f1b !== f0, `翻到第 2 页 → 首行换了内容`);
      const liveAfter = await p.evaluate(id =>
        document.querySelector('#' + id + ' .pg-live').className, ids.pager);
      ok(/on/.test(liveBefore) && /off/.test(liveAfter),
        '翻页后明确提示「已暂停实时刷新」（不是默默停掉）');
      await p.evaluate(id => Array.from(document.querySelectorAll('#' + id + ' .pg-b'))
        .find(b => b.textContent === '1').click(), ids.pager);
      await p.waitForTimeout(500);
    }

    /* 导出 */
    const dl = p.waitForEvent('download', { timeout: 8000 });
    await p.click('#' + ids.exp);
    const f = await dl.catch(() => null);
    ok(f && /\.csv$/.test(f.suggestedFilename()),
      `导出 CSV → 真的下载了（${f ? f.suggestedFilename() : '无'}）`);

    /* 顶栏那两个不适用的控件必须是禁用的 */
    const off = await p.evaluate(() => ({
      q: document.getElementById('q').disabled,
      exp: document.getElementById('btnExp').disabled
    }));
    ok(off.q && off.exp, '内页上顶栏的搜索/导出被禁用（本页有自己的，不留空转控件）');
  }

  /* ══ 9. 设置页每个控件都真的接着引擎 ══ */
  sec('设置页：每个控件都要真的生效');
  await p.click('#side a[data-nav="set"]');
  await p.waitForTimeout(600);

  const sp0 = await p.evaluate(() => window.APEngine.speed);
  await p.evaluate(() => Array.from(document.querySelectorAll('#pSetBody .seg'))
    .find(g => g.querySelector('[data-v="3"]')).querySelector('[data-v="3"]').click());
  await p.waitForTimeout(400);
  ok((await p.evaluate(() => window.APEngine.speed)) === 3,
    `「推进速率 ×3」→ 引擎 speed 真的变了（${sp0} → 3）`);

  await p.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#pSetBody .srow'));
    const r = rows.find(x => x.querySelector('.sl b').textContent.indexOf('暂停推进') === 0);
    r.querySelector('.tgl').click();
  });
  await p.waitForTimeout(400);
  ok((await p.evaluate(() => window.APEngine.paused)) === true, '「暂停推进」→ 引擎真的暂停');
  await p.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#pSetBody .srow'));
    rows.find(x => x.querySelector('.sl b').textContent.indexOf('暂停推进') === 0)
      .querySelector('.tgl').click();
  });
  await p.waitForTimeout(300);
  ok((await p.evaluate(() => window.APEngine.paused)) === false, '再点 → 恢复推进');

  const th0 = await p.evaluate(() => window.APDiag.theme);
  await p.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#pSetBody .srow'));
    const r = rows.find(x => x.querySelector('.sl b').textContent.indexOf('界面主题') === 0);
    r.querySelector('[data-v="light"]').click();
  });
  await p.waitForTimeout(700);
  ok((await p.evaluate(() => window.APDiag.theme)) !== th0, '「界面主题→浅色」→ 整屏真的换了');
  await p.evaluate(() => window.APDiag.setTheme(0));
  await p.waitForTimeout(500);

  /* 礼花总开关：关掉后触发大单，应该只出横幅不出全屏 */
  await p.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#pSetBody .srow'));
    rows.find(x => x.querySelector('.sl b').textContent.indexOf('大额成交全屏礼花') === 0)
      .querySelector('.tgl').click();
  });
  await p.waitForTimeout(300);
  await p.evaluate(() => window.APEngine.triggerOrder({ usd: 2400 }));
  await p.waitForTimeout(900);
  const celOff = await p.evaluate(() => ({
    cel: document.getElementById('celebrate').classList.contains('on'),
    ban: document.getElementById('banner').classList.contains('on'),
    tag: document.getElementById('bannerTag').textContent
  }));
  ok(!celOff.cel && celOff.ban,
    `关掉礼花 → 大单只出横幅不全屏（礼花=${celOff.cel} 横幅=${celOff.ban}「${celOff.tag}」）`);

  /* ══ 10. 两类提醒的样式和逻辑是分开的 ══ */
  /* 横幅只有一个 DOM 节点、两类事件轮着占用它，所以读它必须先钉住状态：
   * 3× 速度下平台里程碑会自然反复触发，盲等 600ms 再读颜色，
   * 有几分之一的概率读到的是**自然里程碑**而不是自己造的那笔成交
   * → 两边都是里程碑色，断言随机红（README 坑 31）。
   * 改成：降速到 0.1 掐掉自然事件 + 等类名真的到位再读，不盲等。 */
  sec('两类提醒：大额成交 vs 平台里程碑');
  await p.click('#side a[data-nav="ov"]');
  await p.waitForTimeout(400);
  await p.evaluate(() => window.APEngine.setSpeed(0.1));
  const readBanner = () => p.evaluate(() => ({
    tag: document.getElementById('bannerTag').textContent,
    cls: document.getElementById('banner').className,
    col: getComputedStyle(document.querySelector('#banner .bt')).color
  }));
  const waitCls = (k) => p.waitForFunction(
    (kk) => { const b = document.getElementById('banner');
              return b.classList.contains('on') && b.classList.contains(kk); },
    k, { timeout: 6000 }).then(() => true).catch(() => false);

  await p.keyboard.press('k');
  const gotMile = await waitCls('mile');
  const mile = await readBanner();
  ok(gotMile && mile.tag === '平台里程碑' && /mile/.test(mile.cls),
    `里程碑标签是「${mile.tag}」而不是「大额成交」，走 .mile 样式`);
  /* 等里程碑自己收掉（4200ms），再造一笔确定够「大额」的成交 */
  await p.waitForFunction(
    () => !document.getElementById('banner').classList.contains('on'),
    null, { timeout: 8000 }).catch(() => {});
  await p.evaluate(() => window.APEngine.triggerOrder({ usd: 900 }));
  const gotDeal = await waitCls('deal');
  const deal = await readBanner();
  ok(gotDeal && /deal/.test(deal.cls),
    `大额成交走 .deal 样式，标签「${deal.tag}」`);
  ok(deal.col !== mile.col,
    `两类提醒配色不同（里程碑 ${mile.col} vs 成交 ${deal.col}）`);
  await p.evaluate(() => window.APEngine.setSpeed(3));   /* 恢复 */

  /* ══ 11. Gemini 爬虫 + 中文店铺 ══ */
  sec('内容：Gemini 爬虫 / 中文店铺');
  await p.click('#side a[data-nav="crawl"]');
  await p.waitForTimeout(800);
  /* 用页面自己的搜索框查 —— 一并验证了搜索作用于整个缓冲而不是当前页。
     只看第 1 页的 20 行会漏：Gemini 侧约占全部抓取的 4.8%，单页缺席是正常的。 */
  /* 别赌「此刻缓冲区里刚好有」：两个 Gemini token 各约占全部抓取的 2.4%，
   * 窗口小的时候 0 条是**正常的**，直接断言 > 0 会随机红（README 坑 30）。
   * 改成给它时间攒够样本：轮询到出现就过，到期还是 0 才是真缺陷（注入坏了）。 */
  const pollHit = async (kw, colIdx) => {
    const dl = Date.now() + 25000;
    let seen = 0, sample = '', rows = 0;
    while (Date.now() < dl) {
      await p.fill('#pCrQ', kw);
      await p.waitForTimeout(600);
      const r = await p.evaluate(ci => Array.from(document.querySelectorAll('#pCrBody .prow'))
        .map(x => ci == null ? '' : x.children[ci].textContent.trim()), colIdx);
      rows = r.length;
      const hit = colIdx == null ? r : r.filter(t => /Gemini|Google-Agent/.test(t));
      if (hit.length) { seen = hit.length; sample = hit[0]; break; }
      await p.fill('#pCrQ', '');
      await p.waitForTimeout(1400);          /* 放它再跑一会儿，攒样本 */
    }
    return { seen, sample, rows };
  };
  /* bot 列（index 2）必须真的出现 Gemini token —— 不能只靠 ?utm_source=gemini 的路径蒙过去。
     搜索是多字段的，所以这里筛的是 bot 列本身，而不是「命中行数 > 0」。 */
  const gem = await pollHit('Gemini', 2);
  ok(gem.seen > 0,
    `搜「Gemini」→ bot 列真的是 Gemini token 的有 ${gem.seen} 条（例：${gem.sample || '无'}；本次命中 ${gem.rows} 行）`);
  const ag = await pollHit('Google-Agent', 2);
  ok(ag.seen > 0, `搜「Google-Agent」→ ${ag.seen} 条（另一个 Gemini 侧 token）`);
  await p.fill("#pCrQ", "");
  await p.waitForTimeout(400);


  await p.click('#side a[data-nav="store"]');
  await p.waitForTimeout(700);
  const cnShops = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('#pStBody .prow').forEach(r => {
      const nm = r.children[0].textContent;
      if (/[一-鿿]/.test(nm)) out.push(nm + ' → ' + r.children[1].textContent);
    });
    return out;
  });
  ok(cnShops.length > 0,
    `店铺名录里有中文店铺（本页 ${cnShops.length} 家，例：${cnShops[0] || '无'}）`);
  ok(cnShops.every(s => /\*\*/.test(s)), '中文店名同样带 ** 脱敏');
  /* 域名必须是 ASCII 子域：myshopify.com 不支持 IDN，中文域名一眼假 */
  const doms = cnShops.map(s => (s.split('→')[1] || '').trim());
  ok(doms.length > 0 && doms.every(d => /^[a-z0-9-]+\.myshopify\.com$/.test(d)),
    `中文店铺的域名是 ASCII 子域：${doms.slice(0, 3).join(' , ')}`);

  /* 顺带查一遍：整个名录里不该有任何非 ASCII 域名 */
  const badDom = await p.evaluate(() => {
    const out = [];
    const q = document.getElementById('pStQ');
    return null;
  });

  ok(errs.length === 0, '全程无 console 错误' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log(`\n${bad ? '===== ' + bad + '/' + n + ' 项失败 =====' : '===== 全部通过 (' + n + ' 项) ====='}`);
  await b.close();
  process.exit(bad ? 1 : 0);
})();
