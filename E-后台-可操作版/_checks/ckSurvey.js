/* ===========================================================================
 * 问卷三项改造的验收：首屏不露奖品 / 选中不自动跳 / 数据真的落到服务端
 * ---------------------------------------------------------------------------
 * 一、首屏不展示奖品
 *     不能只断言「四个奖品名不在首屏」—— 那条把奖品从整个产品里删掉也会通过。
 *     必须同时断言它们**在转盘页仍然完整出现**，才说明是「延后展示」而不是「删了」。
 *
 * 二、选中不自动跳
 *     旧行为是 setTimeout(next, 180)。所以「选完还在原题」这条要等**远大于 180ms**
 *     才算数 —— 这里等 1200ms。等 200ms 通过不了任何东西，只是运气好。
 *     另外要正向验一次「点了下一题确实会走」，否则把 next() 整个删掉也能过。
 *
 * 三、落库
 *     断言「localStorage 里有东西」不算落库验过 —— 上一版就是这么写的，
 *     而结论恰恰是「服务端没有任何记录」。这里要从**服务端**把这条记录读回来，
 *     并且比对凭证号、联系方式、奖项三个字段。
 *
 * 四、读权限（403）
 *     这条在本机造不出来：从这台电脑发出的请求，源地址一定是本机某个网卡地址。
 *     所以改成直接测判定函数 canRead()，用构造出来的 req。
 *     真机验证（手机开 ?admin=1 应被拒）仍然要人做一次 —— 末尾会明确提示。
 *
 * 前置：node _serve.js 在 8099 上跑着
 * =========================================================================== */
const PW = 'C:/Users/1/Desktop/工作汇总/Agentic Commerce 产品情报雷达/ac-radar/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright';
const { chromium, devices } = require(PW);
const http = require('http');
const path = require('path');

/* 先把 token 设好再 require —— ADMIN_TOKEN 是模块加载时读的 */
process.env.AP_SURVEY_TOKEN = process.env.AP_SURVEY_TOKEN || 'ck-token-for-test';
const SRV = require(path.join(__dirname, '..', '..', '_serve.js'));

const HOST = 'http://localhost:8099';
const SURVEY = HOST + '/E-survey/';

let bad = 0, skipped = 0;
const ok = (c, m) => { console.log((c ? '  OK   ' : '  X    ') + m); if (!c) bad++; };
const skip = (m) => { console.log('  --   跳过：' + m); skipped++; };
const sec = (t) => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 56 - t.length)));

const PRIZE_NAMES = ['免费 3 个 AP 来源订单', '1v1 专家诊断', '定制帆布袋', 'AP 定制扇子'];

function req(method, p, body) {
  return new Promise((resolve) => {
    const data = body == null ? null : Buffer.from(body, 'utf8');
    const r = http.request({ host: 'localhost', port: 8099, path: p, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} },
      (x) => {
        const chunks = [];
        x.on('data', (c) => chunks.push(c));
        x.on('end', () => resolve({ code: x.statusCode, headers: x.headers,
                                    buf: Buffer.concat(chunks) }));
      });
    r.on('error', (e) => resolve({ code: 0, buf: Buffer.from(String(e.message)), headers: {} }));
    r.setTimeout(8000, () => { r.destroy(); resolve({ code: 0, buf: Buffer.from('timeout'), headers: {} }); });
    if (data) r.write(data);
    r.end();
  });
}
const getJson = async (p) => {
  const r = await req('GET', p);
  try { return { code: r.code, j: JSON.parse(r.buf.toString('utf8')) }; }
  catch (e) { return { code: r.code, j: null }; }
};

(async () => {
  /* 服务在不在 */
  const ping = await getJson('/api/survey/list');
  if (ping.code !== 200) {
    console.log('  X    服务端没起来或没有 /api/survey —— 先在 展会大屏播报 目录下 node _serve.js');
    process.exit(1);
  }
  const before = ping.j.count;
  console.log('   开跑前服务端已有 ' + before + ' 条');

  const b = await chromium.launch();
  const ctx = await b.newContext(Object.assign({}, devices['iPhone 13']));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));

  /* ══ 一、首屏不展示奖品 ══ */
  sec('一、首屏不展示奖品');
  await p.goto(SURVEY, { waitUntil: 'load' });
  await p.waitForTimeout(500);

  const introVisible = await p.evaluate(() =>
    !document.getElementById('scIntro').classList.contains('hide'));
  ok(introVisible, '首次进入停在开场页（不是回显的中奖页）');

  /* 取**屏上真正看得见的文字**，不是 innerHTML —— 隐藏区块里的字不该算数 */
  const introText = await p.evaluate(() => {
    const seen = [];
    const walk = (el) => {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return;
      for (const n of el.childNodes) {
        if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) seen.push(t); }
        else if (n.nodeType === 1) walk(n);
      }
    };
    walk(document.body);
    return seen.join(' ');
  });
  PRIZE_NAMES.forEach((n) => ok(introText.indexOf(n) < 0, '首屏看不到奖品「' + n + '」'));
  ok(introText.indexOf('转盘') >= 0 || introText.indexOf('抽奖') >= 0,
     '首屏仍然说明「有抽奖」（拿掉的是奖品清单，不是参与理由）');
  ok(/100%\s*中奖/.test(introText), '首屏仍然保留「100% 中奖」的参与激励');
  const plistGone = await p.evaluate(() => !document.querySelector('.plist'));
  ok(plistGone, '旧的奖品清单节点 .plist 已经不存在（不是靠 CSS 藏起来）');

  /* ══ 二、选中不自动跳 ══ */
  sec('二、单选题选中后不会自己跳题');
  await p.click('#btnStart');
  await p.waitForTimeout(300);

  const first = await p.evaluate(() => ({
    num: (document.getElementById('qnum') || {}).textContent || '',
    label: (document.getElementById('btnNext') || {}).textContent || '',
    bars: document.querySelectorAll('#prog i').length,
    disabled: document.getElementById('btnNext').disabled
  }));
  ok(first.disabled, '还没选时「下一题」是禁用的（不是点下去再弹错）');
  /* 身份没选前分支还没展开，queue.length 只有 1。
   * 自动跳时代这一屏只闪 180ms；手动翻页后它是每个人看到的第一屏，
   * 不能写成「Q1 / 1」和「提交并抽奖」—— 那是在骗人。 */
  ok(first.label === '下一题', '首题按钮是「下一题」，不是「提交并抽奖」（实际「' + first.label + '」）');
  ok(!/\/\s*1\s*$/.test(first.num), '首题不报「一共 1 题」（实际「' + first.num + '」）');
  ok(/3~4|3～4/.test(first.num), '分支未定时报真实范围（实际「' + first.num + '」）');
  ok(first.bars === 3, '进度条按最短分支画 3 格，后面只会变长不会变短（实际 ' + first.bars + '）');

  await p.evaluate(() => document.querySelector('#qopts .opt[data-v="A"]').click());
  await p.waitForTimeout(120);
  const selMarked = await p.evaluate(() =>
    !!document.querySelector('#qopts .opt[data-v="A"].sel'));
  const disabledAfter = await p.evaluate(() => document.getElementById('btnNext').disabled);
  ok(selMarked, '选中后该项有选中态（可观测的状态变化，不是点了没反应）');
  ok(!disabledAfter, '选中后「下一题」变为可点');

  /* 关键：等到远超旧的 180ms 自动跳时限 */
  await p.waitForTimeout(1200);
  const stillQ1 = await p.evaluate(() => ({
    num: (document.getElementById('qnum') || {}).textContent,
    title: (document.getElementById('qtitle') || {}).textContent
  }));
  ok(/身份/.test(stillQ1.title),
     '等了 1200ms（旧自动跳是 180ms）仍停在身份题 —— 自动翻页确实取消了');

  await p.click('#btnNext');
  await p.waitForTimeout(300);
  const q2 = await p.evaluate(() => ({
    num: (document.getElementById('qnum') || {}).textContent,
    title: (document.getElementById('qtitle') || {}).textContent
  }));
  ok(q2.title !== stillQ1.title && /Shopify/.test(q2.title),
     '点了「下一题」才前进到第二题（' + q2.num + '：' + q2.title + '）');
  ok(/Q2\s*\/\s*4/.test(q2.num), '选了商家之后题号变成实数 Q2 / 4（实际「' + q2.num + '」）');
  const lastLabel = await p.evaluate(() => {
    /* 直接跳到最后一题看按钮文案 */
    return { bars: document.querySelectorAll('#prog i').length };
  });
  ok(lastLabel.bars === 4, '商家分支进度条补到 4 格（实际 ' + lastLabel.bars + '）');

  /* ══ 三、换身份要清掉旧分支的答案 ══ */
  sec('三、回头改身份，旧分支答案不会跟着落库');
  await p.evaluate(() => document.querySelector('#qopts .opt[data-v="yes"]').click());
  await p.click('#btnNext'); await p.waitForTimeout(250);
  await p.evaluate(() => document.querySelector('#qopts .opt[data-v=">50k"]').click());
  await p.click('#btnNext'); await p.waitForTimeout(250);
  const contactState = await p.evaluate(() => ({
    isText: !!document.getElementById('qtext'),
    label: (document.getElementById('btnNext') || {}).textContent || ''
  }));
  ok(contactState.isText, '商家分支走到了联系方式题（Q1→Q2→Q3→Q4）');
  ok(contactState.label === '提交并抽奖',
     '真到最后一题时按钮才写「提交并抽奖」（实际「' + contactState.label + '」）');

  /* 一路退回身份题，改选服务商 */
  for (let i = 0; i < 3; i++) { await p.click('#btnBack'); await p.waitForTimeout(180); }
  const backAt = await p.evaluate(() => (document.getElementById('qtitle') || {}).textContent);
  ok(/身份/.test(backAt), '「上一题」能一路退回身份题');
  await p.evaluate(() => document.querySelector('#qopts .opt[data-v="C"]').click());
  await p.click('#btnNext'); await p.waitForTimeout(250);
  await p.evaluate(() => document.querySelector('#qopts .opt[data-v="10-50"]').click());
  await p.click('#btnNext'); await p.waitForTimeout(250);

  /* 服务商的联系方式是**选填** —— 空着也该能走 */
  const optionalEnabled = await p.evaluate(() => ({
    isText: !!document.getElementById('qtext'),
    disabled: document.getElementById('btnNext').disabled,
    sub: (document.getElementById('qsub') || {}).textContent
  }));
  ok(optionalEnabled.isText, '服务商分支走到了联系方式题');
  ok(optionalEnabled.sub.indexOf('选填') >= 0 && !optionalEnabled.disabled,
     '选填的联系方式空着也能点「下一题」（禁用规则只管必填题）');

  const MARK = 'ck_' + Date.now().toString(36);
  await p.evaluate((v) => {
    const el = document.getElementById('qtext');
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, MARK);
  await p.waitForTimeout(150);
  await p.click('#btnNext');
  await p.waitForTimeout(600);

  const rec = await p.evaluate(() => JSON.parse(localStorage.getItem('apSurvey.mine') || 'null'));
  ok(!!rec, '提交后本机存下了记录');
  ok(rec && rec.role === 'C', '记录里的身份是最后选定的服务商（C）');
  ok(rec && rec.size === '10-50', '服务商分支的答案在（公司规模 10-50）');
  ok(rec && !rec.shopify && !rec.gmv,
     '商家分支残留的 Shopify / GMV 已清空（shopify="' + (rec && rec.shopify)
     + '" gmv="' + (rec && rec.gmv) + '"）');
  ok(rec && rec.prize === 'AP 定制扇子', '奖项按最终身份判定：' + (rec && rec.prize));

  /* ══ 四、奖品在转盘页仍然完整展示 ══ */
  sec('四、奖品延后到转盘页展示（不是被删掉）');
  const onWheel = await p.evaluate(() =>
    !document.getElementById('scWheel').classList.contains('hide'));
  ok(onWheel, '提交后进入转盘页');
  /* 盘面是 canvas，读不到文字 —— 改为断言 4 格都画出来了 + 奖项定义完整 */
  const wheelInk = await p.evaluate(() => {
    const cv = document.getElementById('wheel');
    const g = cv.getContext('2d');
    const R = cv.width / 2, out = [];
    /* 四格中心方向各取一点，看是不是四种不同的底色 */
    for (let i = 0; i < 4; i++) {
      const a = (i * 90 + 45 - 90) * Math.PI / 180;
      const d = g.getImageData(Math.round(R + Math.cos(a) * R * 0.6),
                               Math.round(R + Math.sin(a) * R * 0.6), 1, 1).data;
      out.push(d[0] + ',' + d[1] + ',' + d[2]);
    }
    return { colors: out, names: (window.APSurvey.prizes || []).map((x) => x.name) };
  });
  ok(new Set(wheelInk.colors).size === 4,
     '盘面四格各有各的底色（' + wheelInk.colors.join(' | ') + '）');
  ok(PRIZE_NAMES.every((n) => wheelInk.names.indexOf(n) >= 0),
     '四个奖品在转盘阶段完整存在（' + wheelInk.names.length + ' 项）');

  /* ══ 五、真的落到了服务端 ══ */
  sec('五、记录落到服务端（不只是这台手机的 localStorage）');
  let found = null;
  for (let i = 0; i < 20 && !found; i++) {
    const r = await getJson('/api/survey/list');
    found = (r.j && r.j.rows || []).filter((x) => x.contact === MARK)[0] || null;
    if (!found) await new Promise((s) => setTimeout(s, 250));
  }
  ok(!!found, '服务端能读回这条记录（按联系方式 ' + MARK + ' 找到）');
  if (found) {
    ok(found.ticket === rec.ticket, '凭证号一致：' + found.ticket);
    ok(found.prize === rec.prize, '奖项一致：' + found.prize);
    ok(found.role === 'C' && found.size === '10-50', '分支字段一致');
    ok(!found.shopify && !found.gmv, '服务端那份也没有旧分支的脏字段');
    ok(typeof found.srvTs === 'number' && found.srvTs > 0,
       '服务端补了入库时间 srvTs（手机时钟不可信时用它）');
  }

  const after = (await getJson('/api/survey/list')).j.count;
  ok(after === before + 1, '总条数 +1（' + before + ' → ' + after + '）');

  /* ══ 六、补传队列：服务端不可达时不丢单，也不挡住抽奖 ══ */
  sec('六、服务端不可达时进补传队列，恢复后自动补上');
  const ctx2 = await b.newContext(Object.assign({}, devices['iPhone 13']));
  const p2 = await ctx2.newPage();
  await p2.goto(SURVEY, { waitUntil: 'load' });
  await p2.waitForTimeout(400);
  /* 把 POST 打掉，模拟服务挂了 / WiFi 抖了 */
  await p2.route('**/api/survey', (route) =>
    route.request().method() === 'POST' ? route.abort() : route.continue());

  const MARK2 = 'ck2_' + Date.now().toString(36);
  await p2.click('#btnStart'); await p2.waitForTimeout(250);
  await p2.evaluate(() => document.querySelector('#qopts .opt[data-v="B"]').click());
  await p2.click('#btnNext'); await p2.waitForTimeout(250);
  await p2.evaluate(() => document.querySelector('#qopts .opt[data-v="3c"]').click());
  await p2.click('#btnNext'); await p2.waitForTimeout(250);
  await p2.evaluate((v) => {
    const el = document.getElementById('qtext');
    el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, MARK2);
  await p2.click('#btnNext');
  await p2.waitForTimeout(900);

  const offlineState = await p2.evaluate(() => ({
    onWheel: !document.getElementById('scWheel').classList.contains('hide'),
    pending: (window.APSurvey.pending() || []).length
  }));
  ok(offlineState.onWheel, '推送失败也照样进转盘 —— 落库故障不挡住现场流程');
  ok(offlineState.pending === 1, '这条进了补传队列（队列长度 ' + offlineState.pending + '）');

  const midCount = (await getJson('/api/survey/list')).j.count;
  ok(midCount === after, '此刻服务端确实还没有这条（' + midCount + ' 条，未变）');

  /* 恢复网络，重开页面触发补传 */
  await p2.unroute('**/api/survey');
  await p2.reload({ waitUntil: 'load' });
  await p2.waitForTimeout(1500);
  const pendingAfter = await p2.evaluate(() => (window.APSurvey.pending() || []).length);
  ok(pendingAfter === 0, '重开页面后队列清空（补传完成）');
  const r2 = await getJson('/api/survey/list');
  const found2 = (r2.j.rows || []).filter((x) => x.contact === MARK2)[0];
  ok(!!found2, '补传的那条出现在服务端：' + (found2 && found2.ticket));
  ok(r2.j.count === after + 1, '补传后总条数 +1（' + after + ' → ' + r2.j.count + '）');

  /* ══ 七、重复提交只算一条 ══ */
  sec('七、同一条重复提交不会变成两条');
  if (found2) {
    const dup = Object.assign({}, found2);
    delete dup.srvTs;
    const r3 = await req('POST', '/api/survey', JSON.stringify(dup));
    ok(r3.code === 200, '重复 POST 被接收（写入侧故意不查重，保持追加写永不失败）');
    const r4 = await getJson('/api/survey/list');
    ok(r4.j.count === r2.j.count, '读回来仍是 ' + r4.j.count + ' 条（按 device+ts 在读取侧去重）');
    const dupRows = (r4.j.rows || []).filter((x) => x.contact === MARK2).length;
    ok(dupRows === 1, '那条记录在列表里只出现 1 次');
  } else { skip('上一步没拿到记录，无法验去重'); }

  /* ══ 八、坏输入不会污染数据 ══ */
  sec('八、坏输入被挡住');
  const c0 = (await getJson('/api/survey/list')).j.count;
  const badJson = await req('POST', '/api/survey', '{not json');
  ok(badJson.code === 400, '非法 JSON → 400（实际 ' + badJson.code + '）');
  const noTicket = await req('POST', '/api/survey',
    JSON.stringify({ ts: Date.now(), device: 'D1', contact: 'x' }));
  ok(noTicket.code === 400, '缺凭证号 → 400（去重键不全，没法处理）');
  const junk = await req('POST', '/api/survey', JSON.stringify({
    ts: Date.now(), device: 'Dckjunk', ticket: 'AP-CKJUNK', contact: 'x'.repeat(5000),
    evil: 'should-be-dropped', __proto__x: 1
  }));
  ok(junk.code === 200, '超长/多余字段的记录被收下（但要看它被怎么收）');
  const jr = (await getJson('/api/survey/list')).j.rows.filter((x) => x.ticket === 'AP-CKJUNK')[0];
  ok(jr && jr.contact.length === 200, '超长联系方式被截到 200 字符（实际 '
     + (jr ? jr.contact.length : '-') + '）');
  ok(jr && jr.evil === undefined, '白名单外的字段被丢掉（evil 没进库）');
  const c1 = (await getJson('/api/survey/list')).j.count;
  ok(c1 === c0 + 1, '两条坏请求没有写进任何数据（' + c0 + ' → ' + c1 + '，只多了那条 junk）');

  /* 8KB 上限 */
  const huge = await req('POST', '/api/survey', JSON.stringify({
    ts: Date.now(), device: 'Dhuge', ticket: 'AP-HUGE', contact: 'z'.repeat(20000) }));
  ok(huge.code !== 200, '超过 8KB 的请求被掐断（不给灌盘的机会，实际 code=' + huge.code + '）');
  const c2 = (await getJson('/api/survey/list')).j.count;
  ok(c2 === c1, '被掐断的请求没有留下记录（' + c1 + ' → ' + c2 + '）');

  /* ══ 九、读权限：联系方式不能被同网段的人整包拉走 ══ */
  sec('九、读权限（联系方式不能被路人拉走）');
  const fakeReq = (ip) => ({ socket: { remoteAddress: ip } });
  ok(SRV.canRead(fakeReq('::ffff:127.0.0.1'), {}) === true, '本机回环可读');
  ok(SRV.canRead(fakeReq('::1'), {}) === true, 'IPv6 回环可读');
  /* 挑一个肯定不属于本机的地址 */
  const own = new Set(require('os').networkInterfaces
    ? [].concat.apply([], Object.values(require('os').networkInterfaces()))
        .map((a) => a && a.address) : []);
  const foreign = ['192.168.244.201', '10.244.0.7', '172.31.244.9'].find((x) => !own.has(x));
  ok(SRV.canRead(fakeReq(foreign), {}) === false,
     '同网段的别人（' + foreign + '）不带 token 读不了');
  ok(SRV.canRead(fakeReq(foreign), { k: 'wrong' }) === false, 'token 不对也读不了');
  ok(SRV.canRead(fakeReq(foreign), { k: process.env.AP_SURVEY_TOKEN }) === true,
     'token 对了才放行（运营自己在手机上看汇总的口子）');
  ok(SRV.isLocal(fakeReq('127.0.0.1')) === true, 'isLocal 认回环');
  ok(SRV.isLocal(fakeReq(foreign)) === false, 'isLocal 不认外部地址');
  console.log('   !! 未验：真手机开 ?admin=1 应该被拒。本机造不出「非本机来源」的请求，');
  console.log('      这一条只测到了判定函数，端到端仍需要拿手机试一次。');

  /* ══ 十、按天导出 ══ */
  sec('十、按天导出 CSV（SOP 第四节）');
  const today = SRV.dayKey(Date.now());
  const csv = await req('GET', '/api/survey/export?date=' + today);
  ok(csv.code === 200, '导出接口返回 200');
  ok(/text\/csv/.test(csv.headers['content-type'] || ''), 'Content-Type 是 CSV');
  ok(/attachment/.test(csv.headers['content-disposition'] || ''), '带 attachment（浏览器会直接下载）');
  const head3 = csv.buf.slice(0, 3);
  ok(head3[0] === 0xEF && head3[1] === 0xBB && head3[2] === 0xBF,
     '开头有 UTF-8 BOM（没有的话 Excel 打开中文全乱码）');
  const text = csv.buf.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text.split('\r\n').filter((x) => x.trim());
  const todayCount = (await getJson('/api/survey/list?date=' + today)).j.count;
  ok(lines.length === todayCount + 1,
     'CSV 行数 = 今天的记录数 + 表头（' + lines.length + ' = ' + todayCount + ' + 1）');
  ok(/联系方式/.test(lines[0]) && /凭证编号/.test(lines[0]), '表头字段齐（' + lines[0].slice(0, 40) + '…）');
  ok(text.indexOf(MARK) >= 0, '刚才那条在导出里找得到');
  const badDate = await req('GET', '/api/survey/export?date=../../etc/passwd');
  ok(badDate.code === 200 && badDate.buf.length > 0,
     '畸形 date 参数不会穿越目录（被格式校验挡掉，退回全量）');

  /* ══ 十一、管理面板的数据口径 ══
   * 上一版只有「本机」一种口径却没在屏上说，很容易把一台手机的 3 条当成全场 3 条。
   * 所以「口径写没写清楚」本身就是要验的东西，不只是数字对不对。 */
  sec('十一、管理面板要说清楚这是谁的数据');
  const pa = await ctx.newPage();
  await pa.goto(SURVEY + '?admin=1', { waitUntil: 'load' });
  await pa.waitForTimeout(1500);
  const admin1 = await pa.evaluate(() => ({
    stat: (document.getElementById('adminStat') || {}).innerText || '',
    rows: document.querySelectorAll('#adminTable tr').length,
    csvBtn: (document.getElementById('btnCsv') || {}).textContent || '',
    visible: !document.getElementById('scAdmin').classList.contains('hide')
  }));
  const srvCount = (await getJson('/api/survey/list')).j.count;
  ok(admin1.visible, '管理面板打得开');
  ok(/全场汇总/.test(admin1.stat), '本机打开时标注的是「全场汇总」：' + admin1.stat.split('\n')[0]);
  ok(admin1.stat.indexOf('共 ' + srvCount + ' 条') >= 0,
     '条数和服务端一致（' + srvCount + ' 条）');
  ok(/全场/.test(admin1.csvBtn), '导出按钮跟着口径走：「' + admin1.csvBtn + '」');
  ok(admin1.rows === Math.min(srvCount, 14) + 1,
     '表格行数 = min(条数,14) + 表头（' + admin1.rows + '）');

  /* 服务端读不到时必须退回「仅本机」并**明说**，不能静默把本机数据当全场 */
  const pb = await ctx.newPage();
  await pb.route('**/api/survey/list*', (route) => route.abort());
  await pb.goto(SURVEY + '?admin=1', { waitUntil: 'load' });
  await pb.waitForTimeout(1500);
  const admin2 = await pb.evaluate(() => ({
    stat: (document.getElementById('adminStat') || {}).innerText || '',
    csvBtn: (document.getElementById('btnCsv') || {}).textContent || ''
  }));
  ok(/仅本机/.test(admin2.stat), '读不到服务端时改标「仅本机」');
  ok(/不是全场数据/.test(admin2.stat), '并且明说这个数字不是全场数据');
  ok(/连不上服务端|拒绝/.test(admin2.stat), '把原因也写出来：' + admin2.stat.split('\n').pop().slice(0, 60));
  ok(/仅本机/.test(admin2.csvBtn), '导出按钮也退回「' + admin2.csvBtn + '」');

  /* ══ 十二、没有 JS 报错 ══ */
  sec('十二、收尾');
  ok(errs.length === 0, '手机端无 JS 错误' + (errs.length ? '：' + errs[0] : ''));

  await b.close();
  console.log('\n' + '─'.repeat(60));
  if (skipped) console.log('跳过 ' + skipped + ' 项');
  if (bad) { console.log('✗ ' + bad + ' 项未通过'); process.exit(1); }
  console.log('✓ 全部通过');
})().catch((e) => { console.error(e); process.exit(1); });
