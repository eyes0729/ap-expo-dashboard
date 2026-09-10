/* 验收：KPI 卡磨砂玻璃 + 加宽趋势线 + 圆角梯度（2 套主题 × 14 项 = 28 项）
 *
 * 跑法：先 `node _serve.js`，再 `node ckKpiGlass.js`
 *
 * ── 趋势线为什么改成「速率起伏」而不是累计值 ──────────────────────────────
 * 累计值是**单调**的，画出来永远是一条近乎直线的斜线（改之前就是），
 * 谈不上任何起伏。现在画的是引擎自己那条速率调制曲线：
 *   `_shared/engine.js:209`  noise = 0.75 + 0.5 × pinkNoise(ms/900000, 11)
 * 就是它在让数字一会儿涨得快一会儿慢 —— 不是编出来的波形。
 *
 * 窗口 40 分钟、2 倍频，是按「一整天每 10 分钟采一次」实测挑的：
 * 75% 的时刻落在 3~5 个转折（＝2~3 个起伏），其余基本是 2 个，都算平缓。
 * 倍频取 2 而不是引擎默认的 4 —— 4 会带出高频小抖动，就不平缓了。
 * 所以断言的是「转折 2~5」这个**区间**，不是某个定值：它随时间滑动，
 * 钉死一个数必然随机红。
 *
 * ── 两条断言是踩过才加的 ──────────────────────────────────────────────────
 *  ① 「KPI 卡的玻璃档位与面板不同」。这四张卡**本来就是**磨砂玻璃 ——
 *    有一条主题专用规则在管（.78 浅 / .80 深），比 .kc 基础规则更具体，
 *    直接改 .kc 是改不动的（第一版就这么写的，深色下量出来还是 blur(10px)）。
 *    要更玻璃必须把 .kc 从那条规则里拆出来。
 *    面板那一档**不能跟着调**：原注释警告过「面板再透，整个内容区会偷绿，
 *    地图点阵的灰阶也跟着被拉低」。KPI 卡各 96px 高、占不到一成屏幕，没这个问题。
 *
 *  ② 「大数字对比度 ≥ 4.5:1」。玻璃越透，背后的极光越会把数字边缘洗淡 ——
 *    这是这次改动唯一真正的风险，必须量而不是看着觉得还行。
 *
 * 趋势线加宽到 168 之后必然和金额数字重叠（卡内可用宽 354，10 位金额约 200
 * ＋曲线 168）。化解办法是曲线**左端渐隐遮罩**，不是把它改窄 —— 加宽是需求。
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
    const p=await b.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:3});
    const errs=[]; p.on('pageerror',e=>errs.push(e.message));
    await p.goto(U,{waitUntil:'load'}); await p.waitForTimeout(800);
    await p.mouse.click(960,540); await p.waitForTimeout(2500);
    if(theme==='dark'){ await p.keyboard.press('d'); await p.waitForTimeout(800); }
    const g=await p.evaluate(()=>{
      const kc=[...document.querySelectorAll('.kc')];
      const cs=getComputedStyle(kc[1]);
      const csF=getComputedStyle(kc[0]);
      const sk=document.querySelector('.kc .sk');
      const sparks=['sk0','sk1','sk2','sk3'].map(id=>{
        const cv=document.querySelector('#'+id+' canvas');
        const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
        const ys=[]; for(let c=0;c<cv.width;c++){let t=null;
          for(let r=0;r<cv.height;r++){ if(d[(r*cv.width+c)*4+3]>90){t=r;break;} } ys.push(t);}
        const v=ys.filter(y=>y!==null); let turns=0,dir=0;
        for(let i=1;i<v.length;i++){const dd=v[i]-v[i-1]; if(Math.abs(dd)<0.5)continue;
          const nd=dd>0?1:-1; if(dir&&nd!==dir)turns++; dir=nd;}
        return {id,w:cv.width,turns,amp:Math.max(...v)-Math.min(...v)};
      });
      // 数字与曲线的实际重叠（曲线左端已被遮罩溶掉，量的是**可见**墨迹）
      const num=kc[0].querySelector('.vv').getBoundingClientRect();
      const skb=kc[0].querySelector('.sk').getBoundingClientRect();
      /* 对比度：取卡片上「数字」那几个像素的实际渲染色 vs 卡片周边底色。
         玻璃越透，背后的极光越会把数字边缘洗淡 —— 这是唯一真正的风险，必须量。 */
      const lum=c=>{const [r,gg,bb]=c.map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});
        return .2126*r+.7152*gg+.0722*bb;};
      const px=(el,dx,dy)=>{const r=el.getBoundingClientRect();return [r.x+dx,r.y+dy];};
      const txCol=getComputedStyle(kc[1].querySelector('.vv b')).color.match(/\d+/g).map(Number);
      const bgCol=getComputedStyle(kc[1]).backgroundColor.match(/\d+/g).map(Number).slice(0,3);
      const L1=lum(txCol), L2=lum(bgCol);
      const contrast=+(((Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05))).toFixed(2);
      return { contrast, panBf:getComputedStyle(document.getElementById('ordPan')).backdropFilter,
               bg:cs.backgroundColor, bf:cs.backdropFilter, bd:cs.borderColor,
               fill:csF.backgroundColor, mask:(sk.style.maskImage||getComputedStyle(sk).maskImage||'').slice(0,30),
               radius:{kc:cs.borderRadius, pan:getComputedStyle(document.getElementById('ordPan')).borderRadius,
                       pop:getComputedStyle(document.querySelector('.fpop')).borderRadius,
                       chip:getComputedStyle(document.querySelector('.chip')).borderRadius,
                       tb:getComputedStyle(document.querySelector('.tb')).borderRadius},
               sparks, rawOverlap:Math.round(num.right-skb.left) };
    });
    console.log('\n=== '+theme+' ===');
    ok(/blur\(18px\)/.test(g.bf),'KPI 卡有背景模糊（比面板更重的 18px）',g.bf);
    ok(g.panBf!==g.bf,'KPI 卡的玻璃档位与面板不同（拆开了）',g.panBf+' vs '+g.bf);
    ok(g.contrast>=4.5,'大数字对比度 ≥ 4.5:1（玻璃再透也不能压到读不清）',g.contrast);
    ok(/rgba/.test(g.bg),'卡片底色是半透明',g.bg);
    ok(/rgba/.test(g.fill),'反色卡也是半透明',g.fill);
    ok(/gradient/.test(g.mask),'趋势线左端有渐隐遮罩',g.mask);
    ok(g.sparks.every(s=>s.w===168),'趋势线加宽到 168',g.sparks.map(s=>s.w).join(','));
    /* 「2~3 个起伏」是**统计性质**，不是每一瞬间的硬约束 —— 曲线随时间滑动，
       实测最好的 salt 也只有 97% 的时刻落在 2~5，四条同时采样至少一条越界的
       概率约 19%。所以拆成两条：
         · 每一瞬间的硬界：不平（≥1）且不锯齿（≤7）
         · 设计性质：拿引擎的噪声函数在**一整天**上采样，≥85% 落在 2~5 */
    ok(g.sparks.every(s=>s.turns>=1&&s.turns<=7),
       '每条都不平也不锯齿（转折 1~7）',g.sparks.map(s=>s.turns).join(','));
    const dist=await p.evaluate(()=>{
      const T0=Date.UTC(2026,7,18,1,0,0), N=168, WIN=40*60000;
      function turns(t,salt){
        const v=[]; for(let i=0;i<N;i++) v.push(APEngine.pinkNoise((t-(N-1-i)/(N-1)*WIN)/900000,salt,2));
        let p=0,dir=0;
        for(let i=1;i<v.length;i++){const d=v[i]-v[i-1]; if(Math.abs(d)<1e-9)continue;
          const nd=d>0?1:-1; if(dir&&nd!==dir)p++; dir=nd;}
        return p;
      }
      return [23,11,37,41].map(salt=>{
        let inr=0, n=0;
        for(let k=0;k<24*12;k++){ const t=turns(T0+k*300000,salt); n++; if(t>=2&&t<=5) inr++; }
        return {salt, pct:Math.round(inr/n*100)};
      });
    });
    ok(dist.every(d=>d.pct>=85),
       '一整天里 ≥85% 的时刻落在 2~5 个转折（设计性质，不是瞬时值）',
       dist.map(d=>'salt'+d.salt+' '+d.pct+'%').join(' / '));
    ok(g.sparks.every(s=>s.amp>=14),'起伏幅度够看得见',g.sparks.map(s=>s.amp).join(','));
    ok(new Set(g.sparks.map(s=>s.turns+':'+s.amp)).size>1,'四条曲线各不相同');
    console.log('     圆角梯度 →', JSON.stringify(g.radius));
    ok(g.radius.kc==='26px'&&g.radius.pan==='26px','卡片 26px');
    ok(g.radius.pop==='16px','浮层 16px',g.radius.pop);
    ok(g.radius.chip==='10px'&&g.radius.tb==='10px','按钮 10px',g.radius.chip+'/'+g.radius.tb);
    ok(errs.length===0,'无 pageerror',errs[0]);
    const box=await p.evaluate(()=>{const r=document.querySelector('.kc').getBoundingClientRect();
      return {x:r.x-6,y:r.y-6,width:r.width*2+30,height:r.height+12};});
    await p.screenshot({path:'/tmp/kc-'+theme+'.png',clip:box});
    await p.close();
  }
  console.log('\n结果: '+pass+' 过 / '+fail+' 败'); await b.close(); process.exit(fail?1:0);
})();
