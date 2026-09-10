/* ===========================================================================
 * 隧道安全回归：公网能写、公网不能读
 * ---------------------------------------------------------------------------
 * 为什么单独写一个：
 *   加公网隧道解决了「换 5G / 换 WiFi 都扫不出」，但顺手开出一个数据泄露口 ——
 *   而且是**静默**的，屏上一切正常。
 *
 *   cloudflared 跑在本机、回源 127.0.0.1，所以隧道进来的请求
 *   `socket.remoteAddress` 是 `::1`，和操作员开 localhost **完全一样**。
 *   `isLocal()` 原来只看 IP，于是整个公网都被判成本机。
 *   加隧道前实测过一次：`/api/survey/export` 从公网直接返回 200 + 全量 CSV，
 *   里面是参与者的微信号和手机号。而二维码就印在一块所有人都会拍照的大屏上。
 *
 *   修法是 fail closed：只要请求带任何代理头（cf-connecting-ip / x-forwarded-for
 *   / cdn-loop / cf-ray …）就不算本机。这个脚本就是那条修法的回归断言。
 *
 * 判据设计上刻意分两层：
 *   ① 纯函数层（canRead）—— 直接喂构造出来的 req，不依赖隧道在不在。
 *      这一层永远能跑，是真正的回归网。
 *   ② 真隧道层 —— 隧道起着的时候才跑，证明端到端也是对的。
 *      隧道没起就明确跳过，**不静默当通过**。
 *
 * 用法：node ckTunnel.js      （需要 _serve.js 正在跑）
 * =========================================================================== */
const http = require('http');
const https = require('https');
const S = require('../../_serve.js');

const HOST = 'http://localhost:8099';
let bad = 0, skipped = 0;
const ok = (c, m) => { console.log((c ? '  OK   ' : '  X    ') + m); if (!c) bad++; };
const skip = (m) => { console.log('  --   跳过：' + m); skipped++; };
const sec = (t) => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 54 - t.length)));

function req(url, opt) {
  opt = opt || {};
  return new Promise((res) => {
    const mod = url.indexOf('https:') === 0 ? https : http;
    const r = mod.request(url, { method: opt.method || 'GET', headers: opt.headers || {} }, (x) => {
      let d = '';
      x.on('data', (c) => (d += c));
      x.on('end', () => res({ code: x.statusCode, body: d, loc: x.headers.location }));
    });
    r.on('error', (e) => res({ code: 0, body: String(e.message) }));
    r.setTimeout(20000, () => { r.destroy(); res({ code: 0, body: 'timeout' }); });
    if (opt.body) r.write(opt.body);
    r.end();
  });
}
/** 造一个假 req 喂给判定函数。socket 地址一律用 ::1 —— 这正是隧道的样子。 */
const fake = (headers) => ({ socket: { remoteAddress: '::1' }, headers: headers || {} });

(async () => {
  /* ══ 一、纯函数层：代理头必须一票否决 ══ */
  sec('一、判定函数（不依赖隧道在不在）');
  ok(S.isLocal(fake({})) === true,
    '没有代理头 + ::1 → 判成本机（操作员那条路还得通）');
  ok(S.canRead(fake({}), {}) === true, '本机可以读汇总');

  const PROXY_HEADERS = ['cf-connecting-ip', 'x-forwarded-for', 'cdn-loop', 'cf-ray',
                         'x-real-ip', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto'];
  let allBlocked = true;
  for (const h of PROXY_HEADERS) {
    const r = S.isLocal(fake({ [h]: 'x' }));
    if (r !== false) { allBlocked = false; console.log('        ✗ ' + h + ' 没挡住'); }
  }
  ok(allBlocked, '八个代理头逐个测，全部不算本机（fail closed）');
  ok(S.canRead(fake({ 'cf-connecting-ip': '1.2.3.4' }), {}) === false,
    '隧道进来的请求读汇总 → 拒绝（这就是那个泄露口）');
  ok(S.viaProxy(fake({ 'cf-connecting-ip': '1.2.3.4' })) === true, 'viaProxy 认得出隧道请求');
  ok(S.viaProxy(fake({})) === false, 'viaProxy 不会把本机误判成隧道');

  /* token 那条路要保住 —— 现场确实需要在手机上看汇总 */
  if (S.ADMIN_TOKEN) {
    ok(S.canRead(fake({ 'cf-connecting-ip': '1.2.3.4' }), { k: S.ADMIN_TOKEN }) === true,
      '带正确 token 时，隧道进来也允许读（现场手机看汇总的正规路）');
    ok(S.canRead(fake({ 'cf-connecting-ip': '1.2.3.4' }), { k: 'wrong' }) === false,
      'token 不对照样拒绝');
  } else {
    skip('没设 AP_SURVEY_TOKEN，token 那条分支没验（默认就是只有本机能读，更安全）');
  }

  /* ══ 二、本机端到端 ══ */
  sec('二、本机这条路（操作员）');
  const l1 = await req(HOST + '/api/survey/list');
  ok(l1.code === 200, '本机读汇总 HTTP ' + l1.code);
  const e1 = await req(HOST + '/api/survey/export');
  ok(e1.code === 200, '本机导出 CSV HTTP ' + e1.code);
  const sl = await req(HOST + '/s');
  ok(sl.code === 302 && /E-survey/.test(sl.loc || ''), '/s 短链 302 → ' + sl.loc);

  /* ══ 三、真隧道端到端 ══ */
  sec('三、公网这条路（手机 / 路人）');
  const lanR = await req(HOST + '/__lan');
  let j = null;
  try { j = JSON.parse(lanR.body); } catch (e) {}
  ok(!!j, '/__lan 可解析');
  console.log('   隧道 =', JSON.stringify(j && j.tunnel), ' pub =', (j && j.pub) || null);

  if (!j || !j.pub) {
    skip('隧道没起（state=' + (j && j.tunnel && j.tunnel.state)
       + '），公网端到端这一节没验。注意：此时二维码只能同一 WiFi 扫。');
  } else {
    const base = j.pub.replace(/\/s$/, '');
    const pg = await req(base + '/E-survey/');
    ok(pg.code === 200, '公网打开问卷页 HTTP ' + pg.code + '（这是修好扫码的那条路）');

    const rl = await req(base + '/api/survey/list');
    ok(rl.code === 403, '公网读汇总 → HTTP ' + rl.code + '（必须 403）');
    const re = await req(base + '/api/survey/export');
    ok(re.code === 403, '公网导出 CSV → HTTP ' + re.code + '（必须 403）');
    ok(!/wx|微信|contact|ticket/i.test(re.body) || re.code === 403,
      '公网拿不到任何联系方式字段');

    /* 写必须还能用 —— 手机就是它的客户端。发一条明显是测试的记录，
     * 但**不落库**：故意缺 ticket，sanitize 会判 bad record 退 400。
     * 这样既证明路由通、又不污染现场数据。 */
    const w = await req(base + '/api/survey', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ts: Date.now(), device: 'CKTUNNEL' })   /* 没有 ticket */
    });
    ok(w.code === 400, '公网写入路由是通的（缺 ticket 被 sanitize 挡下 → HTTP '
      + w.code + '，不落库所以不污染现场数据）');
  }

  console.log('\n' + (bad ? 'X  ' + bad + ' 项不过' : 'OK 隧道安全回归通过')
    + (skipped ? '（跳过 ' + skipped + ' 项）' : ''));
  process.exit(bad ? 1 : 0);
})();
