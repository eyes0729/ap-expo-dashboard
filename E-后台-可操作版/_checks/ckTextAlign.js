/* 验收：订单表「表头文字」与「表体文字」逐列对齐（8 列）
 *
 * 跑法：先 `node _serve.js`，再 `node ckTextAlign.js`
 *
 * 这个套件是为一个**双重 bug** 写的，两条都值得记住：
 *
 *  ① 页面上曾经**并存两套排序箭头** —— `.th .c.so::after`（CSS 伪元素）
 *    和 app.js 生成的 `<i class="ar">`。排序列上会画出两个三角。
 *    而伪元素是 `inline-block + margin-left:5px`，**在 flex 流里占 12px**，
 *    把表头文字从它该在的位置挤开：金额（右对齐）挤左 15px，
 *    国家/来自/订单规模（居中）各挤偏 7.5px（居中列吃一半）。
 *    修法是留伪元素那套（`pages.js` 的四个内页只有 .so、没有 `<i>`，
 *    全靠它）、删 `<i class="ar">`，并把伪元素改成 position:absolute。
 *
 *  ② **判据必须按对齐方式分**。第一版拿「左右边距是否相等」一把尺量到底，
 *    结果把两个**已经居中**的列判成失败 —— 居中列的表头文字（「来自」24px）
 *    和表体内容（「ChatGPT」标签 29.8px）宽度本来就不同，边距必然不等。
 *    居中列要比**中心**，左/右对齐列才比对应那一边的边距。
 *    量错的判据比没有判据更糟：它会让你去"修"一个本来是对的东西。
 *
 * 探针另有一条：测「墨迹」时必须排除 `.ar` / 伪元素本身，
 * 否则量到的是箭头的位置，不是文字的位置。
 */
const PWPATHS = ['playwright',
  '/Users/zezedabaobei/node_modules/playwright',
  'C:/Users/1/Desktop/工作汇总/Agentic Commerce 产品情报雷达/ac-radar/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright'];
let chromium = null;
for (const q of PWPATHS) { try { chromium = require(q).chromium; break; } catch (e) {} }
if (!chromium) { console.log('跳过：找不到 playwright（不静默降级，明说）'); process.exit(0); }
const U='http://localhost:8099/'+encodeURIComponent('E-后台-可操作版')+'/index.html';
(async()=>{
  const b=await chromium.launch({args:['--force-device-scale-factor=1']});
  const p=await b.newPage({viewport:{width:1920,height:1080}});
  await p.goto(U,{waitUntil:'load'}); await p.waitForTimeout(700);
  await p.mouse.click(960,540); await p.waitForTimeout(1800);
  const g=await p.evaluate(()=>{
    const inkOf=el=>{ // 元素里真实墨迹的左右边界（相对该元素）
      const rects=[];
      [...el.childNodes].forEach(nd=>{
        if(nd.nodeType===3 && nd.textContent.trim()){          // 纯文本节点
          const r=document.createRange(); r.selectNodeContents(nd);
          rects.push(...r.getClientRects());
        } else if(nd.nodeType===1 && !nd.classList.contains('ar')){
          rects.push(nd.getBoundingClientRect());              // 图标 / 徽标，排除排序箭头
        }
      });
      const vis=rects.filter(x=>x.width>0.5&&x.height>0.5);
      if(!vis.length) return null;
      const box=el.getBoundingClientRect();
      return { l:+(Math.min(...vis.map(x=>x.left))-box.left).toFixed(1),
               r:+(box.right-Math.max(...vis.map(x=>x.right))).toFixed(1) };
    };
    const hc=[...document.getElementById('ordHead').querySelectorAll('.c')].slice(0,8);
    const bc=[...document.querySelector('#ordBody .orow').querySelectorAll('.c')];
    return hc.map((h,i)=>({
      col:h.textContent.replace(/\s+/g,'')||'?',
      head:inkOf(h), body:inkOf(bc[i]),
      hAlign:getComputedStyle(h).justifyContent, bAlign:getComputedStyle(bc[i]).justifyContent,
      bText:getComputedStyle(bc[i]).textAlign
    }));
  });
  console.log('列'.padEnd(10)+'表头墨迹(左/右)'.padEnd(20)+'表体墨迹(左/右)'.padEnd(20)+'判定');
  g.forEach(r=>{
    const h=r.head?`${r.head.l} / ${r.head.r}`:'—', bd=r.body?`${r.body.l} / ${r.body.r}`:'—';
    let verdict='—';
    if(r.head&&r.body){
      /* 判据必须按对齐方式分： 居中列的内容宽度本来就可以不同
         （表头「来自」24px vs 表体「ChatGPT」标签 29.8px），比边距必然误报，
         要比的是**中心**。左/右对齐列才比对应那一边的边距。 */
      const c=r.bAlign==='center';
      if(c){
        const hcx=(r.head.l-r.head.r)/2, bcx=(r.body.l-r.body.r)/2;   // 中心相对格中心的偏移
        const d=Math.abs(hcx-bcx);
        verdict = d<=1 ? '✓ 居中对齐' : `✗ 中心差${d.toFixed(1)}`;
      } else if(r.bText==='right'){
        const d=Math.abs(r.head.r-r.body.r);
        verdict = d<=1 ? '✓ 右对齐' : `✗ 右差${d.toFixed(1)}`;
      } else {
        const d=Math.abs(r.head.l-r.body.l);
        verdict = d<=1 ? '✓ 左对齐' : `✗ 左差${d.toFixed(1)}`;
      }
    }
    console.log(r.col.padEnd(10)+h.padEnd(20)+bd.padEnd(20)+verdict);
  });
  const bad=g.filter(r=>r.head&&r.body&&/✗/.test((()=>{const c=r.bAlign==='center';
    if(c){return Math.abs((r.head.l-r.head.r)/2-(r.body.l-r.body.r)/2)<=1?'':'✗';}
    if(r.bText==='right'){return Math.abs(r.head.r-r.body.r)<=1?'':'✗';}
    return Math.abs(r.head.l-r.body.l)<=1?'':'✗';})()));
  console.log('\n结果: '+(g.length-bad.length)+' 过 / '+bad.length+' 败');
  await b.close(); process.exit(bad.length?1:0);
})();
