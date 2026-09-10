/* 验收：顶栏图标按钮（导出 CSV 纯图标 + 新增全屏，13 项）
 *
 * 跑法：先 `node _serve.js`，再 `node ckTopBar.js`
 *
 * 纯图标按钮有两条硬要求，这个套件逐条验：
 *
 *  ① **图标必须随状态互换。** 全屏按钮如果图标恒定，按下去之后按钮一点没变，
 *    读起来就是「没生效」（btnPause 那一轮踩过同样的坑）。
 *    所以断言不止「点了有反应」，还要「图标 d 变了」+「title 跟着变」。
 *
 *  ② **title / aria-label 是它唯一的名字。** 导出按钮尤其要注意：
 *    onPageChange 在内页会禁用它并改写说明，没有文字之后那句说明就是
 *    用户唯一能拿到的解释，所以 title 和 aria-label 都得跟着走，
 *    不能只改 title 留个写死的 aria。
 *
 * 另外验了「F 键退出后图标复位」—— 键盘和按钮必须是同一套状态，
 * 分叉的话按钮会停在错误的形态上。这靠监听 fullscreenchange 而不是
 * 在点击处理里自己翻转图标（后者遇到 Esc 退出全屏就会不同步）。
 *
 * requestFullscreen 返回 Promise，用户拒绝时会 reject —— app.js 里接住了，
 * 不接就是一条 unhandled rejection，这个套件的「无 console 错误」会红。
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
  p.on('console',m=>{ if(m.type()==='error') errs.push('console: '+m.text()); });
  await p.goto(U,{waitUntil:'load'}); await p.waitForTimeout(800);
  await p.mouse.click(960,540); await p.waitForTimeout(2200);

  const g=await p.evaluate(()=>{
    const q=id=>{const e=document.getElementById(id); if(!e) return null;
      const r=e.getBoundingClientRect();
      return {cn:/[一-龥]/.test(e.textContent), w:Math.round(r.width), h:Math.round(r.height),
              title:e.getAttribute('title'), aria:e.getAttribute('aria-label'),
              x:Math.round(r.x), svg:!!e.querySelector('svg')};};
    const order=[...document.getElementById('top').children]
      .filter(e=>getComputedStyle(e).display!=='none').map(e=>e.id||e.className);
    return {exp:q('btnExp'), full:q('btnFull'), mute:q('btnMute'), theme:q('btnTheme'), order};
  });
  ok(g.exp && !g.exp.cn,'导出按钮没有中文字',g.exp&&JSON.stringify(g.exp.cn));
  ok(g.exp && g.exp.w===32 && g.exp.h===32,'导出是 32×32 纯图标',g.exp&&(g.exp.w+'×'+g.exp.h));
  ok(g.exp && g.exp.title && g.exp.aria,'导出有 title / aria-label',g.exp&&(g.exp.title+' / '+g.exp.aria));
  ok(g.full,'全屏按钮存在');
  ok(g.full && g.full.svg && g.full.w===32,'全屏是 32×32 图标按钮',g.full&&(g.full.w+'×'+g.full.h));
  ok(g.full && g.full.title==='全屏（F）','全屏 title 正确',g.full&&g.full.title);
  ok(g.full && g.full.x>g.theme.x,'全屏在右上角（主题按钮之右）',g.full&&(g.theme.x+' → '+g.full.x));
  console.log('     顶栏顺序 →', g.order.join(' / '));

  // 图标随状态互换
  const d0=await p.evaluate(()=>document.querySelector('#icFull path').getAttribute('d'));
  await p.evaluate(()=>document.getElementById('btnFull').click());
  await p.waitForTimeout(700);
  const st=await p.evaluate(()=>({fs:!!document.fullscreenElement,
    d:document.querySelector('#icFull path').getAttribute('d'),
    title:document.getElementById('btnFull').getAttribute('title')}));
  ok(st.fs,'点击真的进入全屏（不是点了没反应）',st.fs);
  ok(st.d!==d0,'图标换成「退出」形态',st.d.slice(0,12));
  ok(/退出/.test(st.title),'title 跟着变',st.title);
  await p.keyboard.press('f'); await p.waitForTimeout(700);
  const st2=await p.evaluate(()=>({fs:!!document.fullscreenElement,
    d:document.querySelector('#icFull path').getAttribute('d')}));
  ok(!st2.fs && st2.d===d0,'F 键退出，图标复位（键盘和按钮同一套状态）');

  // 导出仍然真的能导
  const dl=p.waitForEvent('download',{timeout:8000}).catch(()=>null);
  await p.evaluate(()=>document.getElementById('btnExp').click());
  ok(!!(await dl),'导出按钮仍真的下载 CSV');
  ok(errs.length===0,'无 console / pageerror',errs[0]);

  const box=await p.evaluate(()=>{const r=document.getElementById('top').getBoundingClientRect();
    return {x:r.right-560,y:r.y,width:560,height:r.height};});
  await p.screenshot({path:'/tmp/topbtn.png',clip:box});
  console.log('\n结果: '+pass+' 过 / '+fail+' 败'); await b.close(); process.exit(fail?1:0);
})();
