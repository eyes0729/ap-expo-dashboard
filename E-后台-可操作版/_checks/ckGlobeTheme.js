/* 全屏地球：两套主题 + 星空 + 礼花能盖在地球上。
 *
 * 探针纪律（README 坑 15/16）：地球一直在自转，所以凡是取样都先 focusLon 钉住经度，
 * 并且问的是**相对关系**（球内 vs 球外、亮 vs 暗），不是绝对阈值。
 */
const PW = 'C:/Users/1/Desktop/工作汇总/Agentic Commerce 产品情报雷达/ac-radar/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright';
const { chromium } = require(PW);
const U = 'http://localhost:8099/' + encodeURIComponent('E-后台-可操作版') + '/index.html';
let bad = 0;
const ok = (c, m) => { console.log((c ? '  OK   ' : '  ✗    ') + m); if (!c) bad++; };

/* 在 gvGlobe canvas 上按设计稿坐标取样（canvas 内部就是 1920×1080） */
async function px(p, pts) {
  return await p.evaluate((P) => {
    const c = document.getElementById('gvGlobe');
    const g = c.getContext('2d');
    return P.map(([x, y]) => {
      const d = g.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    });
  }, pts);
}
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

(async () => {
  const b = await chromium.launch({ args: ['--force-device-scale-factor=1'] });
  const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto(U, { waitUntil: 'load' });
  await p.click('#goBtn').catch(() => {});
  await p.waitForTimeout(1200);

  /* ── 深色：星空 ── */
  await p.evaluate(() => window.APDiag.setTheme(0));
  await p.keyboard.press('g');
  await p.waitForTimeout(1600);
  ok(await p.evaluate(() => document.getElementById('gv').classList.contains('on')),
    '全屏地球已打开（深色）');
  ok(await p.evaluate(() => window.APGlobe.theme) === 'dark', '地球配色 = dark');

  /* 星空：球外的角落应该有零散亮点。扫一片区域数亮像素，
     并和「球体内部同样大小的一片」对比 —— 星星只该在球外。 */
  const starScan = await p.evaluate(() => {
    const c = document.getElementById('gvGlobe'), g = c.getContext('2d');
    function count(x0, y0, w, h, thr) {
      const d = g.getImageData(x0, y0, w, h).data;
      let n = 0;
      for (let k = 0; k < d.length; k += 4) {
        const L = 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
        if (d[k + 3] > 40 && L > thr) n++;
      }
      return n;
    }
    return {
      corner: count(30, 30, 420, 260, 60),      /* 左上角：纯太空 */
      right: count(1500, 760, 380, 260, 60),    /* 右下角：纯太空 */
      inside: count(880, 380, 160, 140, 60)     /* 球心附近（不该有星星，只有城市点） */
    };
  });
  ok(starScan.corner + starScan.right > 40,
    `球外有星光：左上 ${starScan.corner} + 右下 ${starScan.right} 个亮像素`);

  /* 关掉星空的对照组：把 pal 换到 light 再回来，证明这些亮点确实是星空层画的 */
  await p.evaluate(() => window.APDiag.setTheme(1));
  await p.waitForTimeout(900);
  const lightScan = await p.evaluate(() => {
    const c = document.getElementById('gvGlobe'), g = c.getContext('2d');
    const d = g.getImageData(30, 30, 420, 260).data;
    let n = 0;
    for (let k = 0; k < d.length; k += 4) if (d[k + 3] > 40) n++;
    return n;
  });
  ok(lightScan < 60, `浅色主题下同一片区域几乎无绘制（${lightScan} 像素）—— 星空只属于深色`);

  /* ── 浅色：球体应该比背景深、陆地应该比海洋深 ── */
  ok(await p.evaluate(() => window.APGlobe.theme) === 'light', '地球配色 = light');
  await p.evaluate(() => window.APGlobe.focusLon(20, 200));   /* 欧非面正对镜头 */
  await p.waitForTimeout(1000);

  const s = await px(p, [[960, 452], [300, 160]]);
  ok(s[0][3] > 200, `浅色下球体本体在画（球心 alpha=${s[0][3]}）`);
  ok(lum(s[0]) > 120, `浅色球体是浅色的（球心亮度 ${lum(s[0]).toFixed(0)}）`);

  /* 陆地 vs 海洋：钉住经度后，扫赤道一线，统计亮度分布应有两个明显的族 */
  const band = await p.evaluate(() => {
    const c = document.getElementById('gvGlobe'), g = c.getContext('2d');
    const out = [];
    for (let x = 700; x < 1220; x += 4) {
      const d = g.getImageData(x, 452, 1, 1).data;
      out.push(Math.round(0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]));
    }
    return out;
  });
  const mn = Math.min(...band), mx = Math.max(...band);
  ok(mx - mn > 22, `浅色下陆海有区分：赤道一线亮度 ${mn}~${mx}（差 ${mx - mn}）`);

  /* 页面 DOM 侧也得跟着换 */
  const chrome = await p.evaluate(() => {
    const cs = n => getComputedStyle(document.querySelector(n)).color;
    return {
      title: cs('#gvTop .gt'),
      kpi: cs('#gvKpi .v'),
      logoDark: getComputedStyle(document.querySelector('#gvTop .gvlogo.dark')).display,
      logoLight: getComputedStyle(document.querySelector('#gvTop .gvlogo.light')).display,
      bg: getComputedStyle(document.getElementById('gv')).backgroundImage
    };
  });
  ok(/rgb\((\d+), (\d+), (\d+)\)/.test(chrome.title)
    && lum(chrome.title.match(/\d+/g).map(Number)) < 90,
    `浅色下顶栏标题是深字 ${chrome.title}`);
  ok(chrome.logoLight === 'block' && chrome.logoDark === 'none',
    '浅色下用深字 logo（logo.svg）');
  ok(chrome.bg.indexOf('255, 255, 255') > 0 || chrome.bg.indexOf('rgb(255') > 0,
    `浅色下 #gv 背景是浅色渐变：${chrome.bg}…`);

  /* ── 礼花能盖在地球上（两个主题都测） ── */
  for (const [ti, name] of [[0, '深色'], [1, '浅色']]) {
    await p.evaluate((i) => window.APDiag.setTheme(i), ti);
    await p.waitForTimeout(500);
    await p.evaluate(() => window.APEngine.triggerOrder({ usd: 1480 }));
    await p.waitForTimeout(900);
    const cel = await p.evaluate(() => {
      const c = document.getElementById('celebrate');
      const on = c.classList.contains('on');
      const zc = +getComputedStyle(c).zIndex;
      const zg = +getComputedStyle(document.getElementById('gv')).zIndex;
      const cv = document.getElementById('confetti');
      const g = cv.getContext('2d');
      const d = g.getImageData(0, 0, 1920, 1080).data;
      let n = 0;
      for (let k = 3; k < d.length; k += 4 * 97) if (d[k] > 30) n++;
      const box = document.querySelector('#celebrate .cbox');
      const bg = getComputedStyle(box).backgroundColor;
      const scrim = document.getElementById('celScrim');
      return { on, zc, zg, conf: n, bg,
               scrimOp: getComputedStyle(scrim).opacity,
               blur: getComputedStyle(scrim).backdropFilter || getComputedStyle(scrim).webkitBackdropFilter };
    });
    ok(cel.on && cel.zc > cel.zg,
      `${name}：地球开着时礼花在最上层（celebrate z=${cel.zc} > gv z=${cel.zg}）`);
    ok(cel.conf > 5, `${name}：纸片在画（采样命中 ${cel.conf} 点）`);
    const rgb = cel.bg.match(/[\d.]+/g).map(Number);
    const isLight = lum(rgb) > 128;
    ok(ti === 1 ? isLight : !isLight,
      `${name}：庆祝弹窗底色跟着主题（${cel.bg}）`);

    /* 地球上庆祝时**不许挡住地球和那张球面订单卡**。
       平铺看板上「压暗+模糊整屏」是对的，但这里被庆祝的那笔单就长在球上。 */
    const occ = await p.evaluate(() => {
      const box = document.querySelector('#celebrate .cbox').getBoundingClientRect();
      const G = window.APGlobe;
      const gl = { l: G.CX - G.LIMB, t: G.CY - G.LIMB, r: G.CX + G.LIMB, b: G.CY + G.LIMB };
      const ox = Math.max(0, Math.min(box.right, gl.r) - Math.max(box.left, gl.l));
      const oy = Math.max(0, Math.min(box.bottom, gl.b) - Math.max(box.top, gl.t));
      const pops = Array.from(document.querySelectorAll('.gpop'))
        .filter(e => e.classList.contains('on') && getComputedStyle(e).opacity !== '0')
        .map(e => {
          const b = e.getBoundingClientRect();
          const x = Math.max(0, Math.min(b.right, box.right) - Math.max(b.left, box.left));
          const y = Math.max(0, Math.min(b.bottom, box.bottom) - Math.max(b.top, box.top));
          return x * y;
        });
      return {
        globeOverlap: Math.round(ox * oy),
        centerInside: box.left <= G.CX && G.CX <= box.right
                   && box.top <= G.CY && G.CY <= box.bottom,
        popOverlap: pops.reduce((s, v) => s + v, 0),
        popsShown: pops.length,
        hasGv: document.getElementById('celebrate').classList.contains('gv'),
        scrimBlur: getComputedStyle(document.getElementById('celScrim')).backdropFilter,
        scrimBg: getComputedStyle(document.getElementById('celScrim')).backgroundImage.slice(0, 30)
      };
    });
    ok(occ.hasGv, `${name}：庆祝层切到了地球排版（.gv）`);
    ok(occ.globeOverlap === 0 && !occ.centerInside,
      `${name}：庆祝卡片完全不压地球（与球外接框交叠 ${occ.globeOverlap}px²，球心在卡内=${occ.centerInside}）`);
    ok(occ.popOverlap === 0,
      `${name}：不挡球面订单卡（${occ.popsShown} 张在屏，交叠 ${occ.popOverlap}px²）`);
    ok(occ.scrimBlur === 'none' && /radial/.test(occ.scrimBg),
      `${name}：幕布改成中间挖空的径向渐变、不再整屏模糊（blur=${occ.scrimBlur}）`);
    await p.waitForTimeout(4200);

    /* 回到平铺看板：那里仍然应该是整屏模糊 —— 两种场景两套做法 */
    await p.keyboard.press('Escape');
    await p.waitForTimeout(500);
    await p.evaluate(() => window.APEngine.triggerOrder({ usd: 1900 }));
    await p.waitForTimeout(900);
    const flat = await p.evaluate(() => ({
      hasGv: document.getElementById('celebrate').classList.contains('gv'),
      blur: getComputedStyle(document.getElementById('celScrim')).backdropFilter
    }));
    ok(!flat.hasGv && /blur\(7px\)/.test(flat.blur),
      `${name}：退回平铺看板后恢复整屏模糊（${flat.blur}）`);
    await p.waitForTimeout(4200);
    await p.keyboard.press('g');
    await p.waitForTimeout(1800);
  }

  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  ok(!(await p.evaluate(() => document.getElementById('gv').classList.contains('on'))),
    'Esc 退出全屏地球');
  ok(errs.length === 0, '全程无错误' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log(bad ? `\n===== ${bad} 项失败 =====` : '\n===== 全部通过 =====');
  await b.close();
  process.exit(bad ? 1 : 0);
})();
