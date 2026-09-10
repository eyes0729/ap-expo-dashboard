/* 验收：宽屏自适应（4 个视口 × 9 项 = 36 项）
 *
 * 跑法：先 `node _serve.js`，再 `node ckOrdWide.js`
 *
 * 为什么要有这个套件：版面是「宽度流动 + 按高度等比缩放」（app.js 的 fit()），
 * 比 16:9 更宽的屏都会多出横向空间，而两张表的列宽原本写死 1640 ——
 * 2560×1080 右侧空 638px，3440×1440 空 877px。
 *
 * **两条断言是被漏测教训出来的，删之前先读：**
 *
 *  ① 「6 行两两不重叠」。上一版只断言了行宽对、列合计对、表头对齐 ——
 *    全绿，但 2560 下右列整个压在左列身上（ordPos 算坐标用的还是常量 812，
 *    而行已经跟着 --ordColW 长到 1131）。**「每个元素尺寸都对」推不出
 *    「它们没有叠在一起」**，位置必须单独断言。
 *
 *  ② 一律用 offsetWidth / offsetLeft，**不用 getBoundingClientRect**。
 *    3440 下 #stage 带 scale(1.333)，getBoundingClientRect 是缩放**后**的值，
 *    和 clientWidth（缩放前）混用必然对不上 —— 第一版就这么误报了 3 项。
 *
 *  ③ 「波长恒定」。商品列的字符格数随屏宽涨（1920 是 26 格，2560 是 64 格），
 *    stagger 若定死，波长会跟着屏宽膨胀到 4.2 秒 —— 屏越宽翻得越慢。
 *    所以存的是总时长，每格 stagger 现算（app.js 的 boardStagger）。
  *
 *  ④ offsetLeft **只相对各自的 offsetParent**。表格整体内缩之后，表头格的父级是
 *    带 padding 的 .th、表体格的父级是 left:--tblPad 的 .orow —— 基准不同，
 *    直接比会整齐地差一个内缩量（实测 16 条红全是 12/24 的整数差，看着像布局崩了，
 *    其实是量错了）。跨容器比位置必须走 offsetParent 链算绝对坐标。
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
  for(const [w,h] of [[1920,1080],[2560,1080],[3440,1440],[1600,900]]){
    const p=await b.newPage({viewport:{width:w,height:h}});
    const errs=[]; p.on('pageerror',e=>errs.push(e.message));
    await p.goto(U,{waitUntil:'load'}); await p.waitForTimeout(700);
    await p.mouse.click(w/2,h/2); await p.waitForTimeout(1600);
    const g=await p.evaluate(()=>{
      const ob=document.getElementById('ordBody'), lb=document.getElementById('logBody');
      const row=document.querySelector('#ordBody .orow');
      const cells=[...row.querySelectorAll('.c')];
      /* 一律用布局像素：3440 下 #stage 带 scale(1.333)，
         getBoundingClientRect 是缩放**后**的，和 clientWidth 混用必然对不上（第一版就错在这）。
         而 offsetLeft 只相对各自的 offsetParent —— 表头格的父级是带 padding 的 .th，
         表体格的父级是 left:--tblPad 的 .orow，**基准不同**，直接比会整齐地差一个内缩量
         （第二版 16 条红全是 12/24 的整数差，就是这个）。所以走 offsetParent 链算绝对坐标。 */
      const absX=el=>{let x=0; while(el && el!==document.body){ x+=el.offsetLeft; el=el.offsetParent; } return x;};
      const pad=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tblPad'))||0;
      const cw=cells.reduce((a,c)=>a+c.offsetWidth,0);
      const rw=row.offsetWidth;
      const lrow=document.querySelector('#logBody .crow');
      const lcw=[...lrow.querySelectorAll('.c')].reduce((a,c)=>a+c.offsetWidth,0);
      const head=document.getElementById('ordHead');
      const hw=[...head.children].reduce((a,c)=>a+c.offsetWidth,0);
      /* 行与行**不许重叠** —— 上一版就是漏了这条断言，宽屏下右列整个压在左列上
         却全项通过（行宽对、列合计对、表头对，就是没人问位置对不对）。 */
      const rows=[...document.querySelectorAll('#ordBody .orow')];
      const boxes=rows.map(r=>{const m=new DOMMatrix(getComputedStyle(r).transform);
        return {x:m.m41,y:m.m42,w:r.offsetWidth,h:r.offsetHeight};});
      let overlap=null;
      for(let a=0;a<boxes.length&&!overlap;a++) for(let z=a+1;z<boxes.length;z++){
        const A=boxes[a],B=boxes[z];
        if(A.x<B.x+B.w && B.x<A.x+A.w && A.y<B.y+B.h && B.y<A.y+A.h){
          overlap='行'+a+'('+A.x+','+A.y+','+A.w+') × 行'+z+'('+B.x+','+B.y+','+B.w+')'; break; }
      }
      const rightX = boxes[3] ? boxes[3].x + pad : -1;   /* .orow 的 transform 之外还有 left:--tblPad */
      const hc=[...head.querySelectorAll('.c')], bc=cells;
      const drift=bc.map((c,i)=>Math.abs(absX(c)-absX(hc[i])));
      return { ob:Math.round(ob.clientWidth), lb:Math.round(lb.clientWidth),
        rowW:Math.round(rw), cellsW:Math.round(cw), boardW:Math.round(rw*2+16),
        headW:Math.round(hw), logCellsW:Math.round(lcw),
        logRowW:Math.round(lrow.offsetWidth),
        prodN: cells[4].querySelectorAll('.cf span').length,
        maxDrift:+Math.max(...drift).toFixed(1), overlap, rightX, pad,
        headRightX: head.querySelectorAll('.gut')[0] ?
          head.querySelectorAll('.gut')[0].offsetLeft + 16 : -1,
        sweep: window.APDiag? APDiag.flipMs : 0,
        prodTxt:[...document.querySelectorAll('#ordBody .orow')].map(r=>
          [...r.querySelectorAll('.c')][4].textContent).find(t=>t&&t.trim())||''
      };
    });
    console.log('\n=== '+w+'×'+h+' ===  表体 '+g.ob+'　商品格数 '+g.prodN+'　波长 '+g.sweep+'ms');
    ok(Math.abs(g.sweep-2464)<=60,'翻页波长恒定 ≈2464ms（不随屏宽膨胀）',g.sweep);
    /* 表格整体左右各内缩 --tblPad（圆角 26 之后文字不能贴弧线），所以
       「铺满」的口径是 表体宽 − 2×内缩，不是表体宽本身。 */
    ok(Math.abs(g.boardW-(g.ob-g.pad*2))<=2,'两列板铺满可用宽（表体 − 2×内缩 '+g.pad+'）',
       g.boardW+' vs '+(g.ob-g.pad*2));
    ok(Math.abs(g.cellsW-g.rowW)<=1,'行内列合计 = 行宽',g.cellsW+' vs '+g.rowW);
    ok(Math.abs(g.headW-(g.ob-g.pad*2))<=2,'表头列宽合计 = 可用宽',g.headW+' vs '+(g.ob-g.pad*2));
    ok(g.maxDrift<=1,'表头与表体逐列对齐（最大偏移 px）',g.maxDrift);
    ok(!g.overlap,'6 行两两不重叠',g.overlap);
    ok(Math.abs(g.rightX-g.headRightX)<=1,'右列行首 = 右份表头起点',g.rightX+' vs '+g.headRightX);
    ok(Math.abs(g.logCellsW-g.logRowW)<=2,'日志行铺满',g.logCellsW+' vs '+g.logRowW);
    ok(errs.length===0,'无 pageerror',errs[0]);
    console.log('     商品名 →', JSON.stringify(g.prodTxt.slice(0,60)));
    await p.close();
  }
  console.log('\n结果: '+pass+' 过 / '+fail+' 败'); await b.close(); process.exit(fail?1:0);
})();
