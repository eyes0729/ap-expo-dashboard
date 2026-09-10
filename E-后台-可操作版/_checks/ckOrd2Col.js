/* 验收：订单表 2 列 × 3 行 + 机场翻牌 + 国旗 / 平台色标（22 项）
 *
 * 跑法：先 `node _serve.js`（另一个终端），再 `node ckOrd2Col.js`
 *
 * playwright 的解析走**动态**，不像同目录其它套件写死 `C:/Users/1/...` ——
 * 那些在非作者本机（例如 macOS）上一律 MODULE_NOT_FOUND，跑不起来。
 *
 * 两条断言是被误报教训出来的，改之前先读：
 *  ① 图标格必须**连续采样**。18 个图标格错开起飞，任一瞬间只有 2~4 个在翻，
 *    单点取样极易落在空隙里读到 0 —— 第一版就是这么误判成「整格翻板没生效」的。
 *  ② 帧率只当崩塌预警，不当性能门槛。本机（macOS headless、无 GPU、软件光栅）
 *    改动前后 5×2 交叉实测中位数**都是 15**，about:blank 天花板是 121，
 *    所以 15 是应用自身开销不是 rAF 限速。README 那个 60fps 基线是
 *    Windows + GPU 量的，在这里复现不了。
 */
const PWPATHS = ['playwright',
  '/Users/zezedabaobei/node_modules/playwright',
  'C:/Users/1/Desktop/工作汇总/Agentic Commerce 产品情报雷达/ac-radar/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright'];
let chromium = null;
for (const q of PWPATHS) { try { chromium = require(q).chromium; break; } catch (e) {} }
if (!chromium) { console.log('跳过：找不到 playwright（不静默降级，明说）'); process.exit(0); }
const URL = 'http://localhost:8099/E-%E5%90%8E%E5%8F%B0-%E5%8F%AF%E6%93%8D%E4%BD%9C%E7%89%88/index.html';
let pass=0, fail=0;
const ok=(c,m,x)=>{ c?(pass++,console.log('  ✓ '+m)) : (fail++,console.log('  ✗ '+m+(x!==undefined?'  → '+x:''))); };

(async () => {
  const b = await chromium.launch({ args:['--force-device-scale-factor=1'] });
  const pg = await b.newPage({ viewport:{width:1920,height:1080} });
  const errs=[]; pg.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
  pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  await pg.goto(URL,{waitUntil:'load'});
  await pg.waitForTimeout(700);
  await pg.mouse.click(960,540);                 // 解锁启动遮罩
  await pg.waitForTimeout(1500);

  console.log('\n【一】版面账');
  const g = await pg.evaluate(()=>{
    const rows=[...document.querySelectorAll('#ordBody .orow')];
    const pan=document.getElementById('ordPan').getBoundingClientRect();
    const body=document.getElementById('ordBody').getBoundingClientRect();
    return {
      n: rows.length,
      pos: rows.map(r=>{const m=new DOMMatrix(getComputedStyle(r).transform);return [Math.round(m.m41),Math.round(m.m42)];}),
      w: rows.map(r=>Math.round(r.getBoundingClientRect().width)),
      h: rows.map(r=>Math.round(r.getBoundingClientRect().height)),
      panH: Math.round(pan.height), bodyW: Math.round(body.width),
      headCells: document.querySelectorAll('#ordHead .c').length,
      headGut: document.querySelectorAll('#ordHead .gut').length,
      overflow: rows.map(r=>{
        const rb=r.getBoundingClientRect();
        return [...r.querySelectorAll('.c')].some(c=>c.getBoundingClientRect().right > rb.right+1);
      }).some(Boolean)
    };
  });
  ok(g.n===6,'订单行 6 个',g.n);
  ok(g.panH===268,'面板高 268',g.panH);
  ok(g.h.every(h=>h===64),'行高全 64',g.h.join(','));
  /* 列宽**不写死**。表格整体左右内缩 --tblPad 之后 1920 下是 799 而不是 812，
     而且宽屏下本来就会变大 —— 钉死一个数只会在每次调内缩时假红一轮。
     该验的是「六行等宽」和「右列起点 = 列宽 + 沟槽」这两条关系。 */
  const W0=g.w[0], GUT=16;
  ok(g.w.every(w=>w===W0),'六行等宽（实测 '+W0+'）',g.w.join(','));
  ok(W0>600,'列宽在合理量级',W0);
  const expect=[[0,0],[0,64],[0,128],[W0+GUT,0],[W0+GUT,64],[W0+GUT,128]];
  ok(JSON.stringify(g.pos)===JSON.stringify(expect),
     '列优先定位：0/1/2 左，3/4/5 右且起点 = 列宽+沟槽 = '+(W0+GUT),JSON.stringify(g.pos));
  ok(g.headCells===16,'表头两份共 16 格',g.headCells);
  ok(g.headGut===1,'表头有 1 个沟槽',g.headGut);
  ok(!g.overflow,'没有列溢出行边界');

  console.log('\n【二】国旗 / 色标');
  const v = await pg.evaluate(()=>{
    const rows=[...document.querySelectorAll('#ordBody .orow')].filter(r=>r.style.visibility!=='hidden');
    return {
      flags: rows.map(r=>!!r.querySelector('.c.ic .bk svg.fl')).filter(Boolean).length,
      fallback: rows.map(r=>{const t=r.querySelector('.c.ic .bk svg.fl text'); return t?t.textContent:null}).filter(Boolean),
      mono: rows.map(r=>{const i=r.querySelector('.bk i'); const g=i&&i.querySelector('svg');
        return g?((g.querySelector('path')?'path':'circle')+'@'+getComputedStyle(i).backgroundColor):null}).filter(Boolean),
      labels: rows.map(r=>[...r.querySelectorAll('.bk u')].map(u=>u.textContent)),
      rowN: rows.length,
      flagCount: window.APDiag ? APDiag.flagCount : 0
    };
  });
  ok(v.flagCount===54,'国旗库 54 面',v.flagCount);
  ok(v.flags===v.rowN,'每行都有国旗 SVG',v.flags+'/'+v.rowN);
  ok(v.fallback.length===0,'没有走兜底色块的国家',v.fallback.join(','));
  ok(v.mono.length===v.rowN,'每行「来自」都有品牌 logo（SVG，不是字母）',v.mono.length+'/'+v.rowN);
  console.log('     样本 →', v.mono.slice(0,3).join('  |  '));
  console.log('     标签 →', v.labels.slice(0,3).map(a=>a.join('/')).join('  |  '));

  console.log('\n【三】整块板翻牌');
  const before = await pg.evaluate(()=>APDiag.flipping);
  await pg.keyboard.press('b');                  // 大单 → legendary → 走 hot 档（stagger 20）
  await pg.waitForTimeout(120);
  const peak = await pg.evaluate(()=>({fl:APDiag.flipping, ms:APDiag.flipMs}));
  ok(before===0,'按键前没有行在翻',before);
  ok(peak.fl===6,'按 B 后 6 行同时在翻（整块板）',peak.fl);
  ok(peak.ms>2200&&peak.ms<2800,'整板波长 2.2~2.8 秒',peak.ms+'ms');
  /* 图标格必须**连续采样**：18 个图标格是错开起飞的，任一瞬间只有 2~4 个在翻，
   * 单点取样极易落在空隙里读到 0（第一版断言就是这么误报的）。 */
  const blockFlip = await pg.evaluate(()=>new Promise(res=>{
    let peak=0, n=0;
    const loop=()=>{
      const bks=[...document.querySelectorAll('#ordBody .orow .bk')];
      peak=Math.max(peak,bks.filter(b=>b.style.transform).length);
      if(++n<200) requestAnimationFrame(loop); else res(peak);
    };
    requestAnimationFrame(loop);
  }));
  ok(blockFlip>0,'图标格也在翻（整格翻板生效，连续采样峰值）',blockFlip);
  await pg.waitForTimeout(3600);   // hot 档整板 154×20+7×54 = 3458ms
  const after = await pg.evaluate(()=>({fl:APDiag.flipping,
    resid:[...document.querySelectorAll('#ordBody .orow .bk')].filter(b=>b.style.transform).length}));
  ok(after.fl===0,'3.2 秒后全部落位',after.fl);
  ok(after.resid===0,'落位后 transform 清干净（无残留倾角）',after.resid);

  console.log('\n【三·五】商品列按像素截断');
  /* 防的是一个**看起来正常、其实每行都在漏**的缺陷：n 由平均字宽推算，
   * 比例字体下宽字符串必然溢出，overflow:hidden 把尾巴连省略号一起切 ——
   * 同一列里三种截法（带 … / 半个点 / 断在词中间）。改成按像素二分截断后，
   * 断言就是「一行都不许溢出」+「截断的行必须看得见 …」。 */
  const pc = await pg.evaluate(()=>{
    const cv=document.createElement('canvas').getContext('2d');
    return [...document.querySelectorAll('#ordBody .orow')].map(r=>{
      const c=[...r.querySelectorAll('.c')][4], cf=c.querySelector('.cf');
      if(!cf||!cf.textContent) return null;
      const cs=getComputedStyle(c);
      cv.font=cs.fontWeight+' '+cs.fontSize+' '+cs.fontFamily;
      const t=cf.textContent;
      return {over:+(cv.measureText(t).width-(c.clientWidth-20)).toFixed(1),
              cut:/…$/.test(t), len:t.length};
    }).filter(Boolean);
  });
  ok(pc.length>0,'量到了商品列内容',pc.length);
  ok(pc.every(x=>x.over<=0),'没有一行溢出列宽',pc.map(x=>x.over).join(','));
  ok(pc.filter(x=>x.cut).every(x=>x.over<=0),'被截断的行，省略号在预算内（看得见）');
  ok(new Set(pc.map(x=>x.len)).size>1||pc.length<2,
     '截断长度随实际字宽浮动（不是死板的字符数）',pc.map(x=>x.len).join(','));

  console.log('\n【四】操作没坏');
  const drawer = await pg.evaluate(async()=>{
    document.querySelector('#ordBody .orow').click();
    await new Promise(r=>setTimeout(r,260));
    const on=document.getElementById('drawer').classList.contains('on');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
    return on;
  });
  ok(drawer,'行点击出详情抽屉');
  const sorted = await pg.evaluate(async()=>{
    const h=[...document.querySelectorAll('#ordHead .c.so')].find(c=>c.getAttribute('data-so')==='usd');
    h.click(); await new Promise(r=>setTimeout(r,200));
    // 金额列和订单规模列都 so:'usd'（规模按金额排），所以两份表头共 4 格命中
    const marks=[...document.querySelectorAll('#ordHead .c.so')].filter(c=>c.getAttribute('data-so')==='usd')
      .map(c=>c.className);
    return marks;
  });
  ok(sorted.length===4 && sorted.every(c=>/asc|desc/.test(c)),'点左表头，两份表头箭头同步',sorted.join(' | '));

  console.log('\n【五】帧率 / console');
  await pg.evaluate(()=>{ if(window.APDiag) APDiag.rafFps; });
  await pg.waitForTimeout(2500);
  const fps = await pg.evaluate(()=>window.APDiag?APDiag.rafFps:0);
  /* 阈值只当**崩塌预警**：这台 Mac headless 无 GPU、软件光栅，
   * 改动前后 5×2 交叉实测中位数都是 15（about:blank 天花板 121，所以不是 rAF 限速）。
   * README 那个 60fps 基线是 Windows + GPU 量的，在这里复现不了，别拿来当门槛。 */
  ok(fps>10,'rafFps > 10（崩塌预警；本机基线 15，非现场口径）',fps);
  ok(errs.length===0,'零 console 报错',errs.slice(0,3).join(' ॥ '));

  await pg.screenshot({path:'/tmp/ord-2col.png', clip:{x:256,y:520,width:1664,height:300}});
  await pg.screenshot({path:'/tmp/ord-full.png'});
  console.log('\n结果: '+pass+' 过 / '+fail+' 败');
  await b.close();
  process.exit(fail?1:0);
})();
