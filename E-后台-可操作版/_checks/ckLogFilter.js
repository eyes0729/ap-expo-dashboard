/* 验收：AI 读取记录的筛选（两个下拉 → 一个纯图标按钮，16 项）
 *
 * 跑法：先 `node _serve.js`，再 `node ckLogFilter.js`
 *
 * 这一版把浮层做成了**配置驱动**（app.js 的 FP.ord / FP.log），不是复制一份 ——
 * 开关、定位、外点关闭、Esc、勾选同步两处完全一样，复制的话以后改一处必然漏另一处。
 * 所以这个套件和 ckFilterPop 是**互相的回归网**：动了共用逻辑，两边都得绿。
 *
 * 三条断言值得单独说：
 *  ① 「按钮上没有中文字」—— 需求是纯图标。用正则查 /[一-龥]/ 而不是比对空字符串，
 *    因为角标里会有数字，textContent 本来就不是空的。
 *  ② 「勾第二个 → 出现两种」—— 单值改集合最容易写成「后一个覆盖前一个」。
 *    那样点两下也有反应、行数也会变，只断言「有变化」完全测不出来。
 *    这里直接读屏上实际出现了几种 AI 助手。
 *  ③ 「打开订单筛选会关掉日志筛选」—— 两个浮层叠在一起没法用。
 *    fpOpen 里先 fpCloseAll 就是为这条。
 *
 * 纯图标按钮的角标（#lCount）是**必须**的不是装饰：没有文字之后，
 * 「当前有没有筛选条件在生效」这条状态只剩它能表达，面板一关就没别的线索了。
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
  await p.mouse.click(960,540); await p.waitForTimeout(2600);

  ok(await p.$('#fBot')===null && await p.$('#fSt')===null,'两个 select 已移除');
  const btn=await p.evaluate(()=>{
    const e=document.getElementById('btnLogFilter'); if(!e) return null;
    const r=e.getBoundingClientRect();
    return {txt:e.textContent.trim(), w:Math.round(r.width), h:Math.round(r.height),
            title:e.getAttribute('title'), cn:/[一-龥]/.test(e.textContent)};
  });
  ok(btn,'日志筛选按钮在');
  ok(btn && !btn.cn,'按钮上没有中文字',JSON.stringify(btn&&btn.txt));
  ok(btn && btn.w===26 && btn.h===26,'26×26 纯图标',btn&&(btn.w+'×'+btn.h));
  ok(btn && btn.title==='筛选','title 给了可访问名字',btn&&btn.title);

  await p.click('#btnLogFilter'); await p.waitForTimeout(350);
  const o=await p.evaluate(()=>{
    const pop=document.getElementById('logFilterPop'), c=document.getElementById('content');
    const pr=pop.getBoundingClientRect(), cr=c.getBoundingClientRect();
    return {disp:getComputedStyle(pop).display, groups:pop.querySelectorAll('.fl').length,
      counts:[...pop.querySelectorAll('.fl')].map(f=>f.querySelectorAll('.fo').length),
      inside: pr.left>=cr.left-1&&pr.right<=cr.right+1&&pr.bottom<=cr.bottom+1,
      ordOpen:document.getElementById('filterPop').classList.contains('on')};
  });
  ok(o.disp==='block','点开展开',o.disp);
  ok(o.groups===2 && o.counts[0]===4 && o.counts[1]===2,'两组：4 个助手 + 2 个结果',o.counts.join('/'));
  ok(o.inside,'浮层没被裁、没出内容区');

  /* 多选断言必须看**筛选后的全集**（浮层底部的「符合 N 条」＝ logView() 全量），
     不能去数屏上那 7 行。第一版数屏上行数，随机红了 —— 日志上屏是降采样的
     （LOG_EVERY=6），第二个助手的记录常常还没滚进那 7 行。
     筛选逻辑没错，是断言在替**数据到达的时机**做保证。
     这里先验恒真性质（并集只增不减），再遍历剩下的选项找一个真有区分度的；
     全都不区分就明说「没验到」，不静默算过。 */
  const m=await p.evaluate(async()=>{
    const num=()=>parseInt(document.getElementById('lpN').textContent.replace(/\D/g,''),10)||0;
    const box=[...document.querySelectorAll('#logFilterPop .fl[data-k="bot"] input')];
    box[0].click(); await new Promise(r=>setTimeout(r,350));
    const n1=num(); let n2=n1, picked=null;
    for (let i=1;i<box.length;i++){
      box[i].click(); await new Promise(r=>setTimeout(r,350));
      const v=num();
      if (v>n1){ n2=v; picked=box[i].value; break; }
      box[i].click(); await new Promise(r=>setTimeout(r,200));   // 不区分就撤回再试下一个
    }
    if (!picked && box[1]) { box[1].click(); await new Promise(r=>setTimeout(r,300)); n2=num(); }
    return {first:box[0].value, picked, n1, n2, mono:n2>=n1,
            badge:document.getElementById('lCount').textContent,
            act:document.getElementById('btnLogFilter').classList.contains('act')};
  });
  ok(m.n1>0,'勾一个 → 筛出非空子集（'+m.first+' 共 '+m.n1+' 条）',m.n1);
  ok(m.mono,'并集只增不减（恒真性质）',m.n1+' → '+m.n2);
  if (m.picked) ok(m.n2>m.n1,'勾第二个（'+m.picked+'）→ 全集**变大**（真多选，不是覆盖）',m.n1+' → '+m.n2);
  else ok(false,'没有找到有区分度的第二项 —— 这一轮不算验过（不是通过）');
  ok(m.badge==='2','角标显示 2',m.badge);
  ok(m.act,'按钮进入筛选态');

  // 两个浮层互斥
  await p.click('#btnFilter'); await p.waitForTimeout(300);
  const ex=await p.evaluate(()=>({
    log:document.getElementById('logFilterPop').classList.contains('on'),
    ord:document.getElementById('filterPop').classList.contains('on')}));
  ok(ex.ord && !ex.log,'打开订单筛选会关掉日志筛选（不叠着）',JSON.stringify(ex));

  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  ok(await p.evaluate(()=>!document.querySelector('.fpop.on')),'Esc 关掉全部浮层');

  // 清空
  await p.click('#btnLogFilter'); await p.waitForTimeout(250);
  await p.evaluate(()=>document.querySelector('#logFilterPop .fpclr').click());
  await p.waitForTimeout(300);
  ok(await p.evaluate(()=>document.getElementById('lCount').textContent)==='','清空后角标清掉');
  ok(errs.length===0,'无 pageerror',errs[0]);

  const box2=await p.evaluate(()=>{const r=document.getElementById('logFilterPop').getBoundingClientRect();
    return {x:r.x-8,y:r.y-56,width:r.width+16,height:r.height+64};});
  await p.screenshot({path:'/tmp/logfilterpop.png',clip:box2});
  console.log('\n结果: '+pass+' 过 / '+fail+' 败'); await b.close(); process.exit(fail?1:0);
})();
