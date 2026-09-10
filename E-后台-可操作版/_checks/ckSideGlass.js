/* 验收：侧栏磨砂玻璃（2 套主题 × 9 项 = 18 项）
 *
 * 跑法：先 `node _serve.js`，再 `node ckSideGlass.js`
 *
 * 改了什么：原来浅色侧栏是 .90 的白（只透 10%，看不出玻璃）、深色干脆是实色。
 * 现在两套都走 --sideBg（浅 .66 / 深 .52）+ 26px 模糊。
 * 模糊比 KPI 卡还重（26 vs 18）：侧栏是长条，背后极光色带跨度大，
 * 模糊轻了会把色带边界透出来，看着像脏了一块而不是玻璃。
 *
 * ── 这个套件量对比度量错了**四次**，每次的错法都不一样，值得逐条记住 ──────
 *  ① 拿 CSS 的 background 值算 → 偏乐观。玻璃透了之后文字底下的亮度随极光
 *    位置变，那个值只是玻璃自己那一层。
 *  ② 逐行取最暗最亮再挑最差行 → 量出 1.06:1。空行和只切到字形抗锯齿边的行
 *    也被算进去了。
 *  ③ 分位数取 p50 对 p5 → 选中项 10:1 被算成 2.8:1。加粗中文在紧包围盒里
 *    覆盖率过半，p50 落在**笔画上**而不是底色上。改成两端 p2/p98。
 *  ④ **选择器取错了元素** → `a.querySelector('span')` 拿到的是 16×16 的图标
 *    span（.ic），而导航文字是**裸文本节点**、没包 span。于是量了四次都在量
 *    图标（细笔画绿色，本来就 3.0:1）。量整个 <a> 才是 12.96:1。
 *    这一类最难发现：数字看着「合理地偏低」，不像坏了。
 *
 * ── 门槛也套错过对象 ──────────────────────────────────────────────────────
 * 未选中的导航项刻意用次级灰降权（--tx2），A/B 实测**改之前的实色侧栏**
 * 也只有 3.4 / 2.6 —— 那是既有的设计选择，不是这次玻璃改出来的。
 * 所以验两条：选中项（真正要读的那个）达 4.5:1；玻璃相对实色**没有退化**。
 * 后一条是同一次加载里 A/B —— 不同次加载极光相位不同，跨次比没有意义。
 *
 * 另外验了二维码：侧栏一透，码的静默区会不会被极光透穿。
 * #lotCard 本身刻意是透明的（白板是里面的 .lq），所以要量**渲染出来的
 * 明暗对比**，盯 #lotCard 的 background 会读到 rgba(0,0,0,0) 而误判。
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
const lum=c=>{const [r,g,b]=c.map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});
  return .2126*r+.7152*g+.0722*b;};
(async()=>{
  const b=await chromium.launch({args:['--force-device-scale-factor=1']});
  for(const [ti,theme] of [[0,'dark'],[1,'light']]){
    const p=await b.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:3});
    const errs=[]; p.on('pageerror',e=>errs.push(e.message));
    await p.goto(U,{waitUntil:'load'}); await p.waitForTimeout(800);
    await p.mouse.click(960,540); await p.waitForTimeout(2000);
    await p.evaluate(i=>APDiag.setTheme(i),ti); await p.waitForTimeout(800);
    const g=await p.evaluate(()=>{
      const s=document.getElementById('side'), t=document.getElementById('top');
      const cs=getComputedStyle(s);
      const a=s.querySelector('a.on'), ah=s.querySelector('a:not(.on)');
      const rgb=x=>(x.match(/\d+/g)||[]).map(Number).slice(0,3);
      const alpha=x=>{const m=x.match(/rgba?\([^)]*?([\d.]+)\)/); return m?+m[1]:1;};
      return { bg:cs.backgroundColor, bf:cs.backdropFilter, bd:cs.borderRightColor,
               a:alpha(cs.backgroundColor),
               topBf:getComputedStyle(t).backdropFilter, topBg:getComputedStyle(t).backgroundColor,
               navTx:rgb(getComputedStyle(ah).color), sideRgb:rgb(cs.backgroundColor),
               onBg:getComputedStyle(a).backgroundColor,
               hovBg:getComputedStyle(ah).backgroundColor,
               /* 二维码可扫性：**量渲染出来的明暗对比**，不是看某个元素的
                  background 属性。#lotCard 本身刻意是透明的（白板是里面的 .lq），
                  第一版盯着 #lotCard 量，读到 rgba(0,0,0,0) 就误判成「码没底」。 */
               qrPlate:getComputedStyle(document.querySelector('#lotCard .lq')).backgroundColor,
               qr:(()=>{ const cv=document.querySelector('#lotCard .lq canvas');
                 if(!cv) return null;
                 const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
                 let mn=255,mx=0,alphaMin=255;
                 for(let k=0;k<d.length;k+=4){ const l=(d[k]*.299+d[k+1]*.587+d[k+2]*.114);
                   if(l<mn)mn=l; if(l>mx)mx=l; if(d[k+3]<alphaMin)alphaMin=d[k+3]; }
                 return {mn:Math.round(mn), mx:Math.round(mx), alphaMin}; })() };
    });
    console.log('\n=== '+theme+' ===');
    ok(/blur\(26px\)/.test(g.bf),'侧栏有 26px 背景模糊',g.bf);
    ok(g.a<=0.7,'透明度提高（alpha ≤ .70，原来浅色是 .90 / 深色是实色）',g.a);
    ok(/rgba/.test(g.onBg),'选中态是半透明叠色（不是实色块压在玻璃上）',g.onBg);
    /* ── 对比度：量**合成后的真实像素**，而且要量对对象 ──────────────────────
       三次才量对，教训都记下来：
         · 拿 CSS 的 background 值算 → 偏乐观。玻璃透了之后文字底下的亮度
           随极光位置变，那个值只是玻璃自己那一层
         · 逐行取最暗最亮再挑最差行 → 量出 1.06:1 这种明显不符的数。
           空行和只切到字形抗锯齿边的行都被算进去了
         · 按分位数量文字核心 vs 局部底色 → 3.45 / 2.45，数对了
       但**门槛套错了对象**：未选中的导航项刻意用次级灰降权（--tx2），
       A/B 实测改之前的实色侧栏也只有 3.42 / 2.54 —— 这是既有的设计选择，
       不是这次玻璃改出来的。所以这里验两条：
         ① 选中项（--tx + 加粗，真正要读的那个）达 4.5:1
         ② 玻璃相对实色**没有退化** —— 这才是这次改动该负的责 */
    const cw = async (sel) => {
      /* 量**整个 <a>**。曾经写成 `a.querySelector('span')||a` —— 那取到的是
         16×16 的图标 span（.ic），导航文字是**裸文本节点**、根本没包 span。
         于是量了四次都在量图标的对比度（细笔画绿色，本来就低 3.0:1），
         而整个 <a> 量出来是 12.96:1。选择器写错比公式写错更难发现：
         数字看着「合理地偏低」，不像坏了。 */
      const boxes = await p.evaluate((q)=>[...document.querySelectorAll(q)].map(a=>{
        const r=a.getBoundingClientRect();
        return {x:r.x,y:r.y,w:r.width,h:r.height};}).filter(b=>b.w>8&&b.h>8), sel);
      let worst=99;
      for (const b0 of boxes) {
        const shot=await p.screenshot({clip:{x:Math.round(b0.x),y:Math.round(b0.y),
          width:Math.max(8,Math.round(b0.w)),height:Math.max(8,Math.round(b0.h))}});
        const c=await p.evaluate(async(b64)=>{
          const img=new Image(); img.src='data:image/png;base64,'+b64; await img.decode();
          const cv=document.createElement('canvas'); cv.width=img.width; cv.height=img.height;
          cv.getContext('2d').drawImage(img,0,0);
          const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
          const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};
          const ls=[]; for(let k=0;k<d.length;k+=4) ls.push(.2126*f(d[k])+.7152*f(d[k+1])+.0722*f(d[k+2]));
          ls.sort((x,y)=>x-y); const q=t=>ls[Math.min(ls.length-1,Math.floor(ls.length*t))]||0;
          /* 取**两端** p2 / p98，不是「p50 对 p5」。
             选中项是加粗中文，字形在紧包围盒里覆盖率过半 —— p50 会落在笔画上
             而不是底色上，把 10:1 的对比算成 2.8:1（实测踩到）。
             两端相比对两种极性都成立，抗锯齿只会让它略微偏保守，方向是安全的。 */
          return +(((q(.98)+.05)/(q(.02)+.05))).toFixed(2);
        }, shot.toString('base64'));
        if(c<worst) worst=c;
      }
      return worst;
    };
    const onC = await cw('#side a.on');
    const allGlass = await cw('#side a');
    ok(onC>=4.5,'选中的导航项对比度 ≥ 4.5:1（真正要读的那个）',onC+':1');
    /* 临时把侧栏还原成实色，同一次加载里做 A/B —— 不同次加载极光相位不同，没法比 */
    await p.evaluate((c)=>{const st=document.createElement('style'); st.id='abSolid';
      st.textContent='#side{background:'+c+' !important;backdrop-filter:none !important;'+
                     '-webkit-backdrop-filter:none !important}';
      document.head.appendChild(st);}, theme==='dark'?'#0C0E12':'#FFFFFF');
    await p.waitForTimeout(400);
    const allSolid = await cw('#side a');
    await p.evaluate(()=>{const e=document.getElementById('abSolid'); if(e) e.remove();});
    ok(allGlass >= allSolid - 0.4,
       '玻璃相对实色没有退化（玻璃 '+allGlass+' vs 实色 '+allSolid+'）',
       allGlass+' vs '+allSolid);
    console.log('     未选中项 '+allGlass+':1 —— 刻意的次级灰降权，实色版也只有 '+allSolid+':1');
    ok(/^rgb\(255, 255, 255\)$/.test(g.qrPlate),'二维码白板是实白（不透明）',g.qrPlate);
    ok(g.qr && g.qr.alphaMin===255,'码面无透明像素（极光透不进来）',g.qr&&g.qr.alphaMin);
    const qc=g.qr?+(((g.qr.mx/255+.05)/(g.qr.mn/255+.05)).toFixed(1)):0;
    ok(qc>=10,'码的明暗对比 ≥10:1（扫码可靠性的实际判据）',qc+':1');
    ok(errs.length===0,'无 pageerror',errs[0]);
    console.log('     顶栏 →', g.topBg, g.topBf);
    const box=await p.evaluate(()=>({x:0,y:0,width:250,height:1080}));
    await p.screenshot({path:'/tmp/side-'+theme+'.png',clip:box});
    await p.close();
  }
  console.log('\n结果: '+pass+' 过 / '+fail+' 败'); await b.close(); process.exit(fail?1:0);
})();
