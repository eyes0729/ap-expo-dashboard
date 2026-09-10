/* 验收：AI 读取记录的滚动顺滑度（11 项）
 *
 * 跑法：先 `node _serve.js`，再 `node ckLogScroll.js`
 *
 * ── 「不顺滑」的真根因，不是缓动曲线 ──────────────────────────────────────
 * logBuf 按**全速**收（9 条/秒，地图打点要它），上屏只 1.5 行/秒。
 * 原来两边混用一个 buffer：渲染时取 logBuf 的最后 7 条，而两次渲染之间
 * logBuf 已经涨了 6 条 —— **7 行里 6 行内容全换掉，动画却只滑一行高**。
 * 降采样只作用在「渲染触发」上，没作用在「显示集合」上。
 * 修法是分出 logShown，每次只追加一条。
 *
 * 另外两处配套：
 *   · CSS transition 换成逐帧指数缓动。原来 220ms 动 / 667ms 间隔 = 占空比 33%，
 *     而且 3 速下行间隔 222ms < transition 220ms，那句 `transition:none`
 *     会把飞行中的动画掐断，直接跳一格
 *   · 透明度跟**视觉位置**走而不是行号，否则位移连续、亮度跳变，两者对不上
 *
 * ── 这个套件自己踩过的两个坑，改断言前先读 ────────────────────────────────
 *  ① **跟内容，不要跟 DOM 节点。** 新行到达时「内容下移一位 + 整轨偏移回拉一格」
 *    两者相抵：节点会跳，内容不会。盯着某个 .crow 的 transform 必然误报。
 *  ② **不要用固定 px 当瞬移门槛。** 每帧位移天然随帧时间缩放，本机 headless
 *    只有 ~15fps，3 速下一帧走十几 px 是正常速度。第一版用 12px 误报 4 次。
 *    掐断的真正特征是「一帧跨过一整行」（>= LOG_H = 24px），用这个。
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
  const p=await b.newPage({viewport:{width:1920,height:1080}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(U,{waitUntil:'load'}); await p.waitForTimeout(800);
  await p.mouse.click(960,540); await p.waitForTimeout(2500);

  /* 冷启动填充速度。改成 logShown 之后踩过一次回归：一上来就按 1/6 抽，
     7 行要 4.7 秒才填满，开机那几秒面板下面空一大片。
     修法是「未满之前不降采样」，这条断言就是防它复发。 */
  const fill=await p.evaluate(()=>[...document.querySelectorAll('#logBody .crow')]
    .filter(r=>r.style.opacity!=='0'&&r.style.visibility!=='hidden').length);
  ok(fill===7,'解锁 2.5 秒内日志已填满 7 行（冷启动不降采样）',fill);

  const css=await p.evaluate(()=>{
    const cs=getComputedStyle(document.querySelector('#logBody .crow'));
    return {tp:cs.transitionProperty, td:cs.transitionDuration};});
  ok(/none/.test(css.tp)||/^0s/.test(css.td),'CSS transition 已移除（逐帧接管，两者不能并存）',JSON.stringify(css));

  /* 跟踪**一条内容**的屏幕位置，不是某个 DOM 节点。
     新行到达时「内容下移一位 + 整轨回拉一格」两者相抵 —— 节点会跳，内容不会。
     盯节点的话必然误报（第一版就是这么红的）。 */
  const probe=async(speed,ms)=>{
    await p.evaluate(s=>APEngine.setSpeed(s),speed);
    await p.waitForTimeout(700);
    return p.evaluate((d)=>new Promise(res=>{
      const key=r=>r.querySelector('.c') ? r.querySelector('.c').textContent : '';
      const posOf=k=>{
        for (const r of document.querySelectorAll('#logBody .crow')){
          if(key(r)===k && r.style.opacity!=='0')
            return new DOMMatrix(getComputedStyle(r).transform).m42;
        }
        return null;
      };
      let target=key(document.querySelectorAll('#logBody .crow')[1]);
      const seg=[]; let cur=[]; const t0=performance.now();
      const loop=()=>{
        const y=posOf(target);
        if(y===null){                                   // 这条滚出去了，换一条继续跟
          if(cur.length>3) seg.push(cur); cur=[];
          target=key(document.querySelectorAll('#logBody .crow')[0]);
        } else cur.push(y);
        if(performance.now()-t0<d) requestAnimationFrame(loop);
        else{
          if(cur.length>3) seg.push(cur);
          let moving=0,total=0,jumps=0,maxStep=0,back=0;
          for(const s of seg) for(let i=1;i<s.length;i++){
            const dy=s[i]-s[i-1]; total++;
            if(Math.abs(dy)>0.05) moving++;
            /* 掐断的特征是「一帧跨过一整行」。**不能用固定 px 门槛** ——
               每帧位移天然随帧时间缩放，本机 headless 只有 ~15fps，
               3 速下一帧走十几 px 是正常速度，不是瞬移（第一版用 12px 误报了 4 次）。 */
            if(Math.abs(dy)>=24) jumps++;
            if(dy<-0.3) back++;                          // 倒退 = 抖动
            maxStep=Math.max(maxStep,Math.abs(dy));
          }
          res({tracked:seg.length, frames:total,
               movingPct:total?Math.round(moving/total*100):0,
               jumps, back, maxStep:+maxStep.toFixed(1)});
        }
      };
      requestAnimationFrame(loop);
    }), ms);
  };

  const s1=await probe(1,6000);
  console.log('  1 速 6 秒：', JSON.stringify(s1));
  ok(s1.frames>40,'采到足够样本',s1.frames);
  ok(s1.jumps===0,'内容位置无瞬移（没有掐断）',s1.jumps);
  ok(s1.back===0,'内容不倒退（无抖动）',s1.back);
  ok(s1.movingPct>55,'「在动的帧」占比 > 55%（原来 220ms 动 / 667ms 间隔 = 33%）',s1.movingPct+'%');

  const s3=await probe(3,6000);
  console.log('  3 速 6 秒：', JSON.stringify(s3));
  ok(s3.jumps===0,'3 速下也无瞬移 —— 这一档原来必然掐断（间隔 222ms < transition 220ms）',s3.jumps);
  ok(s3.back===0,'3 速下也不倒退',s3.back);
  ok(s3.maxStep<24,'单帧位移小于一行高（'+s3.maxStep+'px < 24px）',s3.maxStep);

  await p.evaluate(()=>APEngine.setSpeed(1)); await p.waitForTimeout(900);
  const fade=await p.evaluate(()=>new Promise(res=>{
    const o=[]; const t0=performance.now();
    const loop=()=>{ o.push(+getComputedStyle(document.querySelector('#logBody .crow')).opacity);
      if(performance.now()-t0<4000) requestAnimationFrame(loop);
      else res({distinct:[...new Set(o.map(x=>x.toFixed(2)))].length}); };
    requestAnimationFrame(loop);
  }));
  ok(fade.distinct>3,'顶行透明度连续渐变（不是 0↔1 跳变）',fade.distinct+' 个不同值');
  ok(errs.length===0,'无 pageerror',errs[0]);
  console.log('\n结果: '+pass+' 过 / '+fail+' 败'); await b.close(); process.exit(fail?1:0);
})();
