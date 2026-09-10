/* 验收：地图播报卡的拟态玻璃（2 套主题 × 6 项 = 12 项）
 *
 * 跑法：先 `node _serve.js`，再 `node ckPopGlass.js`
 *
 * 玻璃三件套缺一不可，所以三样都断言：
 *   ① backdrop-filter: blur(14px) —— 玻璃感来自「看得见但看不清」的背景，
 *      不是来自半透明本身。少了它就是一块半透明色板
 *   ② ::after 顶边高光 —— 玻璃的「厚度」。少了它怎么调都不像玻璃
 *   ③ ::before 左侧强调条 —— 稀有度信号。原来靠描边色区分（普通琥珀/大额红），
 *      但玻璃的描边是「反光」，染成红色就不像玻璃了，所以挪到强调条上
 *
 * **最要紧的是「两两不重叠」那条。** 改成半透明之后冒出来一个原来没有的约束：
 * 两张卡叠在一起时，后面那张的字会**透过**前面这张显出来，读起来像渲染坏了
 * （不透明的旧版没这问题 —— 前卡直接盖住后卡，难看但不像故障）。
 * 而引擎每 10 分钟一次宏节拍、3~5 单齐发，卡片停留 4.2 秒，撞上是必然的。
 *
 * 避让做了两轮才够：只做垂直时浅色下仍然 0×2 重叠 —— 地图内高约 278px、
 * 卡片 58px，三张挤在同一水平位置时纵向档位会用光。加上**水平翻边**
 * （点位左右两侧都可放）搜索空间翻倍才全过。所以这个断言必须逼出
 * **三张同时亮着**（连按 n/c/b）才测得出来，只弹一张是测不到的。
 *
 * 性能：3 张卡的 backdrop-filter 实测无可测代价（16 vs 15 fps，在本机
 * ±3 的噪声内）。不用为它设帧率门槛。
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
  for(const theme of ['light','dark']){
    const p=await b.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:2});
    await p.goto(U,{waitUntil:'load'}); await p.waitForTimeout(800);
    await p.mouse.click(960,540); await p.waitForTimeout(1600);
    if(theme==='dark'){ await p.keyboard.press('d'); await p.waitForTimeout(700); }
    // 逼出三张卡同时亮着（模拟宏节拍齐发）
    for(const k of ['n','c','b']){ await p.keyboard.press(k); await p.waitForTimeout(260); }
    await p.waitForTimeout(700);
    const g=await p.evaluate(()=>{
      const live=[...document.querySelectorAll('.pop')].filter(e=>e.classList.contains('on'));
      const box=e=>({l:parseFloat(e.style.left)||0,t:parseFloat(e.style.top)||0,
                     w:e.offsetWidth,h:e.offsetHeight});
      const bs=live.map(box);
      let ov=null;
      for(let i=0;i<bs.length&&!ov;i++) for(let j=i+1;j<bs.length;j++){
        const a=bs[i],c=bs[j];
        if(a.l<c.l+c.w&&c.l<a.l+a.w&&a.t<c.t+c.h&&c.t<a.t+a.h){ov=i+'×'+j;break;}
      }
      const mw=document.getElementById('mapWrap').getBoundingClientRect();
      const outside=live.filter(e=>{const r=e.getBoundingClientRect();
        return r.left<mw.left-1||r.right>mw.right+1||r.top<mw.top-1||r.bottom>mw.bottom+1;}).length;
      const cs=live.length?getComputedStyle(live[0]):null;
      return {n:live.length, ov, outside,
        bf:cs?cs.backdropFilter:'—', bg:cs?cs.backgroundColor:'—',
        hi:cs?getComputedStyle(live[0],'::after').backgroundImage.slice(0,40):'—',
        mk:cs?getComputedStyle(live[0],'::before').backgroundColor:'—'};
    });
    console.log('\n=== '+theme+' ===  同时亮着 '+g.n+' 张');
    ok(g.n>=2,'至少两张同时亮（才测得出叠加）',g.n);
    ok(!g.ov,'卡片两两不重叠',g.ov);
    ok(g.outside===0,'没有卡片跑出地图',g.outside);
    ok(/blur\(14px\)/.test(g.bf),'背景模糊生效',g.bf);
    ok(/gradient/.test(g.hi),'顶边高光在',g.hi);
    ok(!/rgba\(0, 0, 0, 0\)/.test(g.mk),'左侧强调条在',g.mk);
    const box=await p.evaluate(()=>{const r=document.getElementById('mapWrap').getBoundingClientRect();
      return {x:r.x,y:r.y,width:r.width,height:r.height};});
    await p.screenshot({path:'/tmp/pop2-'+theme+'.png',clip:box});
    await p.close();
  }
  console.log('\n结果: '+pass+' 过 / '+fail+' 败'); await b.close(); process.exit(fail?1:0);
})();
