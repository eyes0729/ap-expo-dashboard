/* 全量回归：三轮需求一起过 */
const PW = 'C:/Users/1/Desktop/工作汇总/Agentic Commerce 产品情报雷达/ac-radar/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright';
let chromium = null;
for (const q of ['playwright', '/Users/zezedabaobei/node_modules/playwright', PW]) {
  try { chromium = require(q).chromium; break; } catch (e) {}
}
/* PW 原来写死成作者本机的 Windows 绝对路径，在别的机器上一律 MODULE_NOT_FOUND，
   整个套件跑不起来。改成按顺序试，找不到就明说跳过，不静默降级。 */
if (!chromium) { console.log('跳过：找不到 playwright'); process.exit(0); }
const U = 'http://localhost:8099/' + encodeURIComponent('E-后台-可操作版') + '/index.html';
const T = 'C:/Users/1/AppData/Local/Temp/';
const P = s => console.log(s);
let bad = 0;
const ok = (c, m) => { P((c ? '  OK   ' : '  ✗    ') + m); if (!c) bad++; };

async function raf(p, ms) {
  return await p.evaluate((d) => new Promise(res => {
    let n = 0; const t0 = performance.now();
    (function t() { n++; if (performance.now() - t0 < d) requestAnimationFrame(t); else res(n / ((performance.now() - t0) / 1000)); })();
  }), ms);
}

(async () => {
  const b = await chromium.launch({ args: ['--force-device-scale-factor=1'] });
  const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 150)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 150)); });
  await p.goto(U, { waitUntil: 'load', timeout: 30000 });
  await p.click('#goBtn');
  await p.waitForTimeout(3000);

  P('── 基础 ──');
  ok(errs.length === 0, 'console / pageerror 无错误' + (errs.length ? ': ' + errs[0] : ''));
  const lay = await p.evaluate(() => {
    const st = document.getElementById('stage'), r0 = st.getBoundingClientRect();
    let over = 0, clip = 0;
    st.querySelectorAll('*').forEach(el => {
      const bb = el.getBoundingClientRect();
      if (!bb.width || !bb.height) return;
      if (el.closest('#drawer') || el.closest('#gv') || el.closest('#celebrate')) return;
      if (el.tagName === 'path' || el.tagName === 'svg' || el.tagName === 'text') return;
      if (bb.bottom - r0.bottom > 2 || bb.right - r0.right > 2 || bb.left - r0.left < -2) over++;
      if (el.scrollWidth - el.clientWidth > 2 && getComputedStyle(el).overflow !== 'visible') clip++;
    });
    const h = id => Math.round(document.getElementById(id).getBoundingClientRect().height);
    return { over, clip, sum: h('kpi') + h('row2') + h('ordPan') + h('logPan') };
  });
  ok(lay.over === 0 && lay.clip === 0, '无越界 / 无裁切');
  ok(lay.sum === 927, '分带合计 927（实际 ' + lay.sum + '）');

  P('── 第一轮：动画 / 筛选 / 主题 / 扫码 ──');
  const r1 = await p.evaluate(() => ({ slots: APDiag.slotsPerRow, flipMs: APDiag.flipMs }));
  ok(r1.slots > 80 && r1.flipMs > 1500, 'split-flap ' + r1.slots + ' 格，波长 ' + r1.flipMs + 'ms');
  await p.keyboard.press('b');
  await p.waitForTimeout(300);
  const fl = await p.evaluate(() => {
    let t = 0; document.querySelectorAll('.orow .cf span').forEach(s => {
      if ((s.style.transform || '').indexOf('rotateX') >= 0) t++; });
    return { t, flipping: APDiag.flipping };
  });
  ok(fl.t > 0 && fl.flipping > 0, 'rotateX 翻板在跑（' + fl.t + ' 格）');
  const filt = await p.evaluate(() => {
    const n0 = APDiag.ordShown;
    /* 原来从 `#fCC option` 里取国家 —— 那三个 <select> 已经浓缩成
       「筛选」按钮 + 勾选面板，选择器取不到了。改从勾选面板里读。 */
    const cc = [...document.querySelectorAll('#filterPop .fl[data-k="cc"] input')]
      .map(i => i.value).filter(Boolean);
    const n1 = APDiag.setFilter({ cc: cc[0] });
    APDiag.setFilter({ cc: [] });
    APDiag.setSort('usd', -1);
    const amts = [...document.querySelectorAll('.orow')].map(r => r.querySelectorAll('.c')[6])
      .filter(Boolean).map(c => parseFloat(c.innerText.replace(/[^0-9.]/g, '')) || 0);
    APDiag.setSort('t', -1);
    return { n0, n1, buf: APDiag.ordBuf, sorted: amts.every((v, i) => i === 0 || amts[i - 1] >= v) };
  });
  ok(filt.buf > 50, '订单缓冲 ' + filt.buf + ' 笔（筛选/导出才有意义）');
  ok(filt.n1 < filt.n0 && filt.n1 > 0, '按国家筛 ' + filt.n0 + ' -> ' + filt.n1 + ' 笔');
  ok(filt.sorted, '按金额降序正确');
  const th = await p.evaluate(async () => {
    const out = [];
    for (const i of [0, 1]) {
      APDiag.setTheme(i);
      await new Promise(r => setTimeout(r, 260));
      const cs = getComputedStyle(document.getElementById('stage'));
      const cv = document.getElementById('map'), g = cv.getContext('2d');
      const d = g.getImageData(Math.round(cv.width * .2), Math.round(cv.height * .3), 1, 1).data;
      out.push({ bg: cs.getPropertyValue('--bg').trim(), land: d[0] + ',' + d[1] + ',' + d[2] });
    }
    APDiag.setTheme(0);
    return out;
  });
  ok(th[0].bg !== th[1].bg && th[0].land !== th[1].land, '两套主题（地图底图随之重烤）');
  const lot = await p.evaluate(() => {
    const c = getComputedStyle(document.getElementById('lotChip'));
    const s = getComputedStyle(document.getElementById('side'));
    return { chip: c.backgroundColor, side: s.backgroundColor, sh: c.boxShadow.length };
  });
  ok(lot.chip !== lot.side && lot.sh > 30, '扫码入口有独立底色 + 投影（不再融进侧栏）');

  P('── 第二轮：地图比例 / 饼图 / 指标在动 / 身份 ──');
  const geo = await p.evaluate(() => {
    const cv = document.getElementById('map');
    return { r: (cv.width / 64) / (cv.height / 26) };
  });
  ok(geo.r < 1.35, '平铺地图格子长宽比 ' + geo.r.toFixed(2) + '（改前 1.82）');
  const pie = await p.evaluate(() => {
    const arcs = [...document.querySelectorAll('#pieArcs path')];
    return { n: arcs.filter(a => (a.getAttribute('d') || '').length > 10).length,
             lg: document.querySelectorAll('#pieLg .lr').length };
  });
  ok(pie.n === 6 && pie.lg === 6, '饼图 6 扇区 + 6 行图例');
  const hov = await p.evaluate(async () => {
    const it = APDiag.pieItems[0], mid = (it.a0 + it.a1) / 2, rr = 54;
    const svg = document.getElementById('pieSvg'), r = svg.getBoundingClientRect();
    const x = r.left + (79 + rr * Math.cos(mid)) / 158 * r.width;
    const y = r.top + (79 + rr * Math.sin(mid)) / 158 * r.height;
    const el = document.elementFromPoint(x, y);
    if (el && el.tagName === 'path') el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    await new Promise(r2 => setTimeout(r2, 200));
    return { c1: document.getElementById('pieC1').textContent,
             c2: document.getElementById('pieC2').textContent,
             dim: [...document.querySelectorAll('#pieArcs path')].filter(a => a.classList.contains('dim')).length };
  });
  ok(hov.dim === 5 && /%/.test(hov.c1), 'hover 扇区 -> 中心 ' + hov.c1 + '/' + hov.c2 + '，其余压暗 ' + hov.dim);
  const who = await p.evaluate(() => ({
    brand: (function(){var v=[].slice.call(document.querySelectorAll('#side .brand .lgo')).filter(function(x){return getComputedStyle(x).display != 'none'});return v.length?v[0].getAttribute('src')+' loaded='+(v[0].naturalWidth>0):'none'})(),
    who: document.querySelector('#top .who .nm').innerText.replace(/\n/g, '/')
  }));
  ok(!/Riverstone/.test(who.who), '右上角不是单店身份：' + who.who);
  ok(/loaded=true/.test(who.brand), '侧栏公司 logo 已加载：' + who.brand);

  P('── 第三轮：真实店铺 / 礼花 / 全屏地球 ──');
  const sh = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.orow')].filter(r => r.style.visibility !== 'hidden');
    const shops = rows.map(r => r.querySelectorAll('.c')[2].innerText.trim());
    const logs = [...document.querySelectorAll('.crow')].filter(r => r.style.visibility !== 'hidden')
      .map(r => r.querySelectorAll('.c')[2].innerText.trim());
    return { pool: window.APShops ? window.APShops.SHOPS.length : 0,
             allMasked: shops.concat(logs).every(s => s.indexOf('**') >= 0),
             sample: shops.slice(0, 3).join(' ') };
  });
  ok(sh.pool > 1000, '店铺池 ' + sh.pool + ' 家（来自真实报表，已脱敏）');
  ok(sh.allMasked, '屏上店铺名全部带 **  样例: ' + sh.sample);
  const noPii = await p.evaluate(async () => {
    const r = await fetch('shops.js'); const t = await r.text();
    return { at: /@/.test(t), dom: /myshopify|\.com/.test(t), http: /https?:/.test(t) };
  });
  ok(!noPii.at && !noPii.dom && !noPii.http, 'shops.js 无 Email / 无域名 / 无链接');
  await p.keyboard.press('b');
  await p.waitForTimeout(600);
  const cb = await p.evaluate(() => {
    const cv = document.getElementById('confetti'), g = cv.getContext('2d');
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let lit = 0; for (let i = 3; i < d.length; i += 4 * 101) if (d[i] > 12) lit++;
    return { on: document.getElementById('celebrate').classList.contains('on'), lit,
             amt: document.getElementById('cbAmt').textContent };
  });
  ok(cb.on && cb.lit > 20, '全屏礼花在画（' + cb.lit + ' 个采样点亮），金额 ' + cb.amt);
  await p.waitForTimeout(4400);
  ok(!(await p.evaluate(() => document.getElementById('celebrate').classList.contains('on'))), '礼花自动收起');

  await p.click('#btnGlobe');
  await p.waitForTimeout(1600);
  const gv = await p.evaluate(async () => {
    const cv = document.getElementById('gvGlobe'), g = cv.getContext('2d');
    const px = (x, y) => g.getImageData(x, y, 1, 1).data;
    // 陆地：扫球内多条纬线，找填充色 rgba(50,68,99) 附近的像素（比海面亮）
    const scan = () => {
      let n = 0;
      for (const y of [300, 380, 452, 520, 600])
        for (let x = 660; x < 1260; x += 5) {
          const d = px(x, y);
          if (d[0] >= 40 && d[0] <= 90 && d[2] > d[0]) n++;
        }
      return n;
    };
    /* 探针必须钉住经度。球一直在自转，固定屏幕坐标下的海陆比例随朝向
     * 从 17（太平洋面）跳到 147（欧非面），阈值写死就是抛硬币。
     * 钉住之后还能顺手把断言变强：不只看「有没有亮」，而是看
     * 亮的分布是否**符合真实海陆** —— 欧非面必须远多于太平洋面。 */
    APGlobe.focusLon(20, 1); await new Promise(r => setTimeout(r, 320));
    const landEU = scan();
    APGlobe.focusLon(-160, 1); await new Promise(r => setTimeout(r, 320));
    const landPac = scan();
    APGlobe.focusLon(20, 1); await new Promise(r => setTimeout(r, 320));
    const c = px(960, 452), o = px(960, 36);
    return { on: document.getElementById('gv').classList.contains('on'),
             body: c[3] > 200, glow: o[2] > 40 && o[3] > 10, landEU: landEU, landPac: landPac,
             rings: window.APCoast ? window.APCoast.length : 0,
             kpi: document.getElementById('gvGmv').textContent };
  });
  ok(gv.on && gv.body, '全屏地球：球体本体已绘制');
  ok(gv.glow, '大气光晕存在（球外采样有蓝色分量）');
  ok(gv.rings > 100, '海岸线数据 ' + gv.rings + ' 个环（Natural Earth 110m）');
  ok(gv.landEU > 90 && gv.landPac < 40, '大陆按真实海陆分布填充（欧非面 ' +
    gv.landEU + ' 点 vs 太平洋面 ' + gv.landPac + ' 点）');
  ok(/\$/.test(gv.kpi), '下方指标同步：' + gv.kpi);
  let vis = 0;
  for (let i = 0; i < 4; i++) {
    await p.evaluate(() => APEngine.triggerOrder({ usd: 460 }));
    await p.waitForTimeout(2000);
    if (await p.evaluate(() => [...document.querySelectorAll('.gpop.on')]
      .some(x => x.style.opacity !== '0' && x.style.left))) vis++;
  }
  ok(vis >= 3, '订单卡钉在球面并可见 ' + vis + '/4（镜头跟随生效）');
  await p.waitForTimeout(9000);
  const tk = await p.evaluate(() => {
    const t = [...document.querySelectorAll('.gtk')].filter(x => x.style.visibility === 'visible');
    const xs = t.map(x => { const m = /translate3d\(([-\d.]+)px/.exec(x.style.transform || ''); return m ? +m[1] : 9e9; });
    return { n: t.length, onScreen: xs.filter(v => v > -420 && v < 1920).length, max: Math.max.apply(null, xs) };
  });
  ok(tk.onScreen >= 2 && tk.max < 2700, '底部跑马灯屏内 ' + tk.onScreen + ' 条，队列受控（尾 ' + Math.round(tk.max) + 'px）');

  const f = await raf(p, 5000);
  ok(f > 50, '全屏地球 rAF 实测 ' + f.toFixed(1) + ' fps');
  const d1 = await p.evaluate(() => APDiag.dom);
  await p.waitForTimeout(6000);
  const d2 = await p.evaluate(() => ({ dom: APDiag.dom, raf: APDiag.rafFps, eng: APDiag.fpsAvg }));
  ok(Math.abs(d2.dom - d1) <= 2, 'DOM 稳定 ' + d1 + ' -> ' + d2.dom);
  P('       APDiag.rafFps=' + d2.raf + '（真实）  APDiag.fpsAvg=' + d2.eng + '（引擎口径，偏低）');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);
  ok(!(await p.evaluate(() => document.getElementById('gv').classList.contains('on'))), 'Esc 退出全屏地球');

  P('');
  ok(errs.length === 0, '全程无错误' + (errs.length ? ': ' + errs.join(' | ') : ''));
  P('');
  P(bad === 0 ? '===== 全部通过 =====' : '===== 有 ' + bad + ' 项未通过 =====');
  await b.close();
  process.exit(bad ? 1 : 0);
})();
