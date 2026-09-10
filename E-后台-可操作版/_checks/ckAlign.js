/* 验收：卡片边距对齐（4 个视口 × 5 项 = 20 项）
 *
 * 跑法：先 `node _serve.js`，再 `node ckAlign.js`
 *
 * 管的是一条几何约束 —— **两行的竖缝必须重合**：
 *   4 张 KPI 卡等分 ⟹ 第 2/3 张之间的缝心 = 2C + 1.5G
 *   中段两张大卡    ⟹ 缝心 = M + 0.5G
 *   相等 ⟺ M = 2C + G = (W − G)/2，即中段两卡**严格对半**
 *
 * 原来是 `flex:1 1 800px` / `1 1 824px` + 地图 `max-width:1040px`：
 * 1920 下缝差 12px，2560 下扩大到 92px。封顶那条有它的道理
 * （地图点阵吃不下多余宽度，见 app.js 的 mapGeom），但代价是这条缝对不上。
 *
 * **只断言外边缘对齐是不够的** —— 改之前四条外边缘本来就都齐（都是 0..1640），
 * 错的是内部的缝。所以这里既验外边缘，也验缝。
 */
const PWPATHS = ['playwright',
  '/Users/zezedabaobei/node_modules/playwright',
  'C:/Users/1/Desktop/工作汇总/Agentic Commerce 产品情报雷达/ac-radar/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright'];
let chromium = null;
for (const q of PWPATHS) { try { chromium = require(q).chromium; break; } catch (e) {} }
if (!chromium) { console.log('跳过：找不到 playwright（不静默降级，明说）'); process.exit(0); }
const U='http://localhost:8099/'+encodeURIComponent('E-后台-可操作版')+'/index.html';
let pass=0,fail=0;
const ok=(c,m,x)=>{c?(pass++,console.log('  ✓ '+m)):(fail++,console.log('  ✗ '+m+(x!==undefined?'  → '+x:'')));};
(async()=>{
  const b=await chromium.launch({args:['--force-device-scale-factor=1']});
  for(const [w,h] of [[1920,1080],[2200,1080],[2560,1080],[3440,1440]]){
    const p=await b.newPage({viewport:{width:w,height:h}});
    await p.goto(U,{waitUntil:'load'}); await p.waitForTimeout(700);
    await p.mouse.click(w/2,h/2); await p.waitForTimeout(1500);
    const g=await p.evaluate(()=>{
      const kc=[...document.getElementById('kpi').children];
      const map=document.getElementById('mapPan'), side=document.getElementById('side2');
      const seamK=(kc[1].offsetLeft+kc[1].offsetWidth + kc[2].offsetLeft)/2;
      const seamM=(map.offsetLeft+map.offsetWidth + side.offsetLeft)/2;
      const row=document.getElementById('row2');
      return {seamK, seamM, kW:kc.map(c=>c.offsetWidth),
        mapW:map.offsetWidth, sideW:side.offsetWidth,
        kL:kc[0].offsetLeft, kR:kc[3].offsetLeft+kc[3].offsetWidth,
        mL:map.offsetLeft,  mR:side.offsetLeft+side.offsetWidth,
        oL:document.getElementById('ordPan').offsetLeft,
        oR:document.getElementById('ordPan').offsetLeft+document.getElementById('ordPan').offsetWidth};
    });
    console.log('\n=== '+w+'×'+h+' ===  地图 '+g.mapW+' / 右板 '+g.sideW+'　KPI '+g.kW.join('/'));
    ok(Math.abs(g.seamK-g.seamM)<=1,'KPI 2|3 缝 = 地图|右板 缝',g.seamK+' vs '+g.seamM);
    ok(new Set(g.kW).size===1,'4 张 KPI 等宽',g.kW.join('/'));
    ok(Math.abs(g.mapW-g.sideW)<=1,'中段两卡等宽',g.mapW+' vs '+g.sideW);
    ok(g.kL===g.mL && g.mL===g.oL,'三行左边缘齐',g.kL+'/'+g.mL+'/'+g.oL);
    ok(g.kR===g.mR && g.mR===g.oR,'三行右边缘齐',g.kR+'/'+g.mR+'/'+g.oR);
    await p.close();
  }
  console.log('\n结果: '+pass+' 过 / '+fail+' 败'); await b.close(); process.exit(fail?1:0);
})();
