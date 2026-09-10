/* 验收：订单筛选浮层（三个下拉 → 一个按钮 + 勾选面板，18 项）
 *
 * 跑法：先 `node _serve.js`，再 `node ckFilterPop.js`
 *
 * 这次改动把筛选的**语义**换了：单值 → 集合。所以断言不能只看「点了有反应」：
 *
 *  ① 「勾第二项后结果集**变大**」是这个套件的核心。单值改集合时最容易写成
 *    「后一个覆盖前一个」—— 那样点两下也有反应、行数也会变，
 *    但那是单选不是多选，用旧断言完全测不出来。所以必须断言 n2 > n1。
 *
 *  ② 「渠道卡与面板同步」。渠道卡（订单来源分布里那五行）和筛选面板是
 *    **同一份状态的两个视图**，任一处改了另一处必须跟着变，
 *    否则界面显示的筛选条件和实际生效的对不上 —— 这比不给这个功能更糟。
 *
 *  ③ 「浮层没被裁」。`.pan` 是 overflow:hidden（表体靠它裁剪），
 *    浮层放进 42px 高的面板头里会被整个裁掉。所以它挂在 #content 下、
 *    位置每次打开时算。这条断言防的就是有人把它挪回面板里。
 *
 * 位置计算用 offsetLeft/offsetTop 而不是 getBoundingClientRect：
 * #stage 上有 scale()，后者给的是缩放后的值，写回布局像素会在非 1920 宽度上偏掉。
 */
const PWPATHS = ['playwright',
  '/Users/zezedabaobei/node_modules/playwright',
  'C:/Users/1/Desktop/工作汇总/Agentic Commerce 产品情报雷达/ac-radar/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright'];
let chromium = null;
for (const q of PWPATHS) { try { chromium = require(q).chromium; break; } catch (e) {} }
if (!chromium) { console.log('跳过：找不到 playwright（不静默降级，明说）'); process.exit(0); }
const U='http://localhost:8099/'+encodeURIComponent('E-后台-可操作版')+'/';
let pass=0,fail=0;
const ok=(c,m,x)=>{c?(pass++,console.log('  ✓ '+m)):(fail++,console.log('  ✗ '+m+(x!==undefined?'  → '+x:'')));};
(async()=>{
  const b=await chromium.launch({args:['--force-device-scale-factor=1']});
  const p=await b.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:2});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(U,{waitUntil:'load'}); await p.waitForTimeout(800);
  await p.mouse.click(960,540); await p.waitForTimeout(2500);

  ok(await p.$('#fSrc')===null && await p.$('#fCC')===null && await p.$('#fTier')===null,
     '三个 select 已移除');
  const fb=await p.evaluate(()=>{const e=document.getElementById('btnFilter');
    if(!e) return null; const r=e.getBoundingClientRect();
    return {cn:/[\u4e00-\u9fa5]/.test(e.textContent), w:Math.round(r.width),
            h:Math.round(r.height), title:e.getAttribute('title')};});
  ok(fb,'筛选按钮在');
  ok(fb && !fb.cn,'按钮上没有中文字（纯图标）',fb&&JSON.stringify(fb));
  ok(fb && fb.w===26 && fb.h===26,'26×26 纯图标',fb&&(fb.w+'×'+fb.h));
  ok(fb && fb.title==='筛选','title 给了可访问名字',fb&&fb.title);

  const closed=await p.evaluate(()=>getComputedStyle(document.getElementById('filterPop')).display);
  ok(closed==='none','默认收起',closed);

  await p.click('#btnFilter'); await p.waitForTimeout(300);
  const o=await p.evaluate(()=>{
    const pop=document.getElementById('filterPop'), c=document.getElementById('content');
    const pr=pop.getBoundingClientRect(), cr=c.getBoundingClientRect();
    return { disp:getComputedStyle(pop).display,
      groups:pop.querySelectorAll('.fl').length,
      counts:[...pop.querySelectorAll('.fl')].map(f=>f.querySelectorAll('.fo').length),
      inside: pr.left>=cr.left-1 && pr.right<=cr.right+1 && pr.bottom<=cr.bottom+1,
      aria:document.getElementById('btnFilter').getAttribute('aria-expanded') };
  });
  ok(o.disp==='block','点击后展开',o.disp);
  ok(o.groups===3,'三组勾选',o.groups);
  ok(o.counts.every(n=>n>0),'三组都有选项',o.counts.join('/'));
  ok(o.inside,'浮层没被裁、没出内容区（.pan 是 overflow:hidden，所以挂在 #content）');
  ok(o.aria==='true','aria-expanded 同步',o.aria);

  // 多选：勾两个 AI 助手
  const multi=await p.evaluate(async()=>{
    const src=document.querySelector('#filterPop .fl[data-k="src"]');
    const box=[...src.querySelectorAll('input')];
    const before=APDiag.ordShown;
    box[0].click(); await new Promise(r=>setTimeout(r,150));
    const one=APDiag.ordBuf && APPages? null:null;
    const n1=APDiag.setFilter({})|0;
    box[1] && box[1].click(); await new Promise(r=>setTimeout(r,150));
    const n2=APDiag.setFilter({})|0;
    return {vals:box.slice(0,2).map(x=>x.value), n1, n2,
            badge:document.getElementById('fCount').textContent,
            act:document.getElementById('btnFilter').classList.contains('act')};
  });
  ok(multi.n2>multi.n1,'勾第二项后结果集**变大**（真多选，不是覆盖）',multi.n1+' → '+multi.n2);
  ok(multi.badge==='2','徽标显示 2',multi.badge);
  ok(multi.act,'按钮进入筛选态');

  // 渠道卡与面板是同一份状态
  const sync=await p.evaluate(async()=>{
    const row=document.querySelector('#chanBody .rr');
    row.click(); await new Promise(r=>setTimeout(r,200));
    const checked=[...document.querySelectorAll('#filterPop .fl[data-k="src"] input')]
      .filter(x=>x.checked).map(x=>x.value);
    return {checked, badge:document.getElementById('fCount').textContent};
  });
  ok(sync.checked.length===3||sync.checked.length===1,'点渠道卡后面板勾选同步',sync.checked.join(','));

  // 清空
  await p.evaluate(()=>document.getElementById('fpClr').click());
  await p.waitForTimeout(250);
  const clr=await p.evaluate(()=>({
    checked:[...document.querySelectorAll('#filterPop input')].filter(x=>x.checked).length,
    badge:document.getElementById('fCount').textContent,
    chan:document.querySelectorAll('#chanBody .rr.on').length}));
  ok(clr.checked===0,'清空后无勾选',clr.checked);
  ok(clr.badge==='','徽标清掉',JSON.stringify(clr.badge));
  ok(clr.chan===0,'渠道卡选中态也解除（同一份状态）',clr.chan);

  // 点外面关闭 / Esc
  await p.mouse.click(400,300); await p.waitForTimeout(250);
  ok(await p.evaluate(()=>getComputedStyle(document.getElementById('filterPop')).display)==='none','点外面关闭');
  await p.click('#btnFilter'); await p.waitForTimeout(200);
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  ok(await p.evaluate(()=>getComputedStyle(document.getElementById('filterPop')).display)==='none','Esc 关闭');

  ok(errs.length===0,'无 pageerror',errs[0]);
  await p.click('#btnFilter'); await p.waitForTimeout(300);
  const box=await p.evaluate(()=>{const r=document.getElementById('filterPop').getBoundingClientRect();
    return {x:r.x-8,y:r.y-56,width:r.width+16,height:r.height+64};});
  await p.screenshot({path:'/tmp/filterpop.png',clip:box});
  console.log('\n结果: '+pass+' 过 / '+fail+' 败'); await b.close(); process.exit(fail?1:0);
})();
