/* ===========================================================================
 * 扫码全链路验收：编码 → 解码 → 地址可达 → 手机能填完问卷
 * ---------------------------------------------------------------------------
 * 这一套替代「手机扫码实测」。之前 README 里的结论只是
 * 「矩阵与参考实现逐格一致」—— 那只证明两份实现算出了同样的矩阵，
 * 万一双方对掩码/纠错交织/格式信息 BCH 理解得一样错，会一起错，而扫描器读不出来。
 *
 * 手机扫不到的真实原因几乎只有四类，这里逐条覆盖：
 *   ① 码本身编错     → 用两个**独立解码器**读（OpenCV 自研 + ZBar 老 C 库）
 *   ② 屏上太小/太糊   → 按真实显示尺寸退化测试，量出还能解的下限
 *   ③ 码里的地址错   → 手机连的是局域网，localhost 打不开；验证地址可达
 *   ④ 打开了但用不了 → 用手机视口真的把问卷填完提交一次
 *
 * 解码这一步需要 Python + opencv + pyzbar（在 C:\Users\1\qr\venv）。
 * 环境不在时**跳过并明说**，不静默降级 —— 静默跳过等于假装验过了。
 * =========================================================================== */
const PW = 'C:/Users/1/Desktop/工作汇总/Agentic Commerce 产品情报雷达/ac-radar/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright';
const { chromium, devices } = require(PW);
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const HOST = 'http://localhost:8099';
const BOARD = HOST + '/' + encodeURIComponent('E-后台-可操作版') + '/index.html';
const TMP = path.join(process.env.TEMP || '.', 'ckqr');
const QPY = 'C:\\Users\\1\\qr\\venv\\Scripts\\python.exe';

let bad = 0, skipped = 0;
const ok = (c, m) => { console.log((c ? '  OK   ' : '  X    ') + m); if (!c) bad++; };
const skip = (m) => { console.log('  --   跳过：' + m); skipped++; };
const sec = (t) => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 56 - t.length)));

/** GET，**必须按 url 的协议选模块并跟随跳转**。
 *  二维码地址从「局域网 http」变成「隧道 https + /s 短链 302」之后，
 *  原来写死 require('http').get 的版本会直接抛 ERR_INVALID_PROTOCOL，
 *  整个验收脚本崩在第二节 —— 崩掉的验收比没有验收更危险，
 *  因为前面几条 OK 会让人以为跑完了。 */
function get(url, hops) {
  hops = hops || 0;
  return new Promise((res) => {
    let mod;
    try { mod = url.indexOf('https:') === 0 ? require('https') : http; }
    catch (e) { return res({ code: 0, body: 'bad url' }); }
    const r = mod.get(url, (x) => {
      /* /s 是 302 → /E-survey/，不跟随的话拿到的是空 body，
       * 「返回的是问卷页」那条断言会假红。最多跟 3 跳，防打环。 */
      if (x.statusCode >= 300 && x.statusCode < 400 && x.headers.location && hops < 3) {
        const next = new URL(x.headers.location, url).href;
        x.resume();
        return get(next, hops + 1).then(res);
      }
      let d = '';
      x.on('data', (c) => (d += c));
      x.on('end', () => res({ code: x.statusCode, body: d }));
    });
    r.on('error', (e) => res({ code: 0, body: String(e.message) }));
    r.setTimeout(15000, () => { r.destroy(); res({ code: 0, body: 'timeout' }); });
  });
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const b = await chromium.launch({ args: ['--force-device-scale-factor=1'] });
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));

  /* ══ 一、码里的地址是怎么来的 ══ */
  sec('一、二维码里的地址');
  await p.goto(BOARD, { waitUntil: 'load' });
  await p.click('#goBtn').catch(() => {});
  await p.waitForTimeout(2600);
  const d = await p.evaluate(() => window.APDiag_qr);
  console.log('   APDiag_qr =', JSON.stringify(d));
  ok(!!d && !!d.url, '二维码已生成');
  /* 地址**故意不显示在屏上**了：观众看不懂那串随机隧道域名，反而像出了故障。
   * 原来这里断言「屏上文字 === 码内内容」（给操作员肉眼核对用）；
   * 现在反过来断言它不在屏上，防止以后有人又把它加回去。
   * 操作员核对地址改看两处：服务窗口打印的「隧道已就绪」那一行，
   * 或控制台 window.APDiag_qr.url。 */
  /* 检查范围要**排除告警条**。告警条里会写「码里是局域网地址 192.168.x.x」——
   * 那是给操作员判断当前处于哪种模式的必要信息，不是「把地址栏又加回来了」。
   * 第一版把整卡文本一起 grep，于是自己的提示文案把断言弄红了。 */
  const shown = await p.evaluate(() => {
    const el = document.getElementById('lotUrl');
    const card = document.getElementById('lotCard');
    if (!card) return { el: !!el, text: '' };
    const clone = card.cloneNode(true);
    const w = clone.querySelector('#lotWarn');
    if (w) w.remove();                       /* 告警条不算 */
    return { el: !!el, text: clone.textContent };
  });
  ok(!shown.el, '屏上不再显示地址栏（#lotUrl 已移除）');
  ok(!/trycloudflare\.com|https?:\/\/|\d+\.\d+\.\d+\.\d+/.test(shown.text),
    '二维码卡正文里没有地址（告警条除外）' +
    (/https?:\/\//.test(shown.text) ? '（发现残留：' + shown.text.slice(0, 60) + '）' : ''));
  /* 关键：地址必须是探测来的，不能是在赌写死的 DHCP IP。
   * pub = 隧道公网地址，lan* = 局域网地址，两者都来自 /__lan 实时探测；
   * 只有 'fallback' 才是代码里写死的那个，必须红。 */
  ok(/^(pub|lan)/.test(d.src || ''),
    '地址来自 /__lan 实时探测而不是写死的兜底（src=' + d.src + '）');
  ok(!/localhost|127\.0\.0\.1/.test(d.url), '地址不是 localhost（手机打不开 localhost）');

  const lan = await get(HOST + '/__lan');
  let lanJson = null;
  try { lanJson = JSON.parse(lan.body); } catch (e) {}
  ok(lan.code === 200 && lanJson && lanJson.ip, '/__lan 可用，报告 ip=' + (lanJson && lanJson.ip));
  ok(lanJson && !/^169\.254\./.test(lanJson.ip),
    '报告的不是链路本地地址（本机有 4 个 169.254，靠猜必然猜错）');

  /* ── 这一节是「换 5G / 换 WiFi 都扫不出」那个故障的回归断言 ──────────────
   * 私网地址（192.168/10/172.16-31）在 5G 上物理不可达，换个 WiFi 也要
   * 同网段 + 没开客户端隔离才通 —— 展会 WiFi 默认开隔离。
   * 所以隧道起着的时候，码里**必须**是公网 https 地址；
   * 只要退回了私网地址，就要明确报出来「现在只有同一个 WiFi 能扫」。 */
  const tun = lanJson && lanJson.tunnel;
  console.log('   隧道状态 =', JSON.stringify(tun), ' pub =', lanJson && lanJson.pub);
  if (lanJson && lanJson.pub) {
    ok(d.url === lanJson.pub,
      '隧道已就绪时，码里用的是公网地址（手机 5G / 任意 WiFi 都能开）');
    ok(/^https:\/\//.test(d.url), '公网地址是 https');
    ok(d.reachable === 'anywhere', 'APDiag_qr.reachable 标成 anywhere（现场据此判断）');
    ok(!/^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(d.url),
      '码里不是私网地址（私网地址在 5G 上物理不可达 —— 这就是原来扫不出的根因）');
  } else {
    /* state=off 是**现在的默认**，不是故障：trycloudflare 在国内普通手机网络上
     * 打不开（实测本机 DNS 被网关劫持成 Clash fake-IP，笔记本 curl 通是走了代理，
     * 手机 5G 必然失败），所以隧道默认关闭、二维码走局域网地址。
     * 局域网地址反而更好扫：27 字节 → v3、每模块 4.86px，比隧道的 v5 好一档。 */
    skip((tun && tun.state) === 'off'
      ? '隧道默认关闭（trycloudflare 国内手机打不开），码走局域网地址 —— '
        + '这是预期配置。现场要让观众扫，需发一个专用热点让两边同网。'
      : '隧道没起（state=' + (tun && tun.state) + '），码退回局域网地址：'
        + '现场只有同一个 WiFi + 没开客户端隔离才能扫。');
    ok(d.reachable === 'same-lan-only',
      '退回局域网时如实标成 same-lan-only（不能让现场以为是公网可扫）');
  }

  /* ══ 二、地址真的能打开（走局域网 IP，不走 localhost） ══ */
  sec('二、地址可达性（手机走的就是这条）');
  const r1 = await get(d.url);
  ok(r1.code === 200, '码里的地址 HTTP ' + r1.code);
  ok(/E-survey|调研|问卷|抽奖/.test(r1.body), '返回的是问卷页而不是别的东西');

  /* ══ 三、渲染尺寸与模块大小 ══ */
  sec('三、屏上尺寸（决定手机多远能扫）');
  /* **必须先按 Q 展开二维码卡**。收起状态下 #lotCard 是 opacity:0 + scale(.98)，
   * 截图截到的是一个不可见、还被缩过的元素 —— 两个解码器都读不出来。
   * 我第一版忘了展开，于是三条解码断言全红，差点当成产品问题。 */
  await p.keyboard.press('q');
  await p.waitForTimeout(900);
  const opened = await p.evaluate(() => {
    const c = document.getElementById('lotCard');
    return { on: c.classList.contains('on'), opacity: getComputedStyle(c).opacity };
  });
  ok(opened.on && opened.opacity === '1', '按 Q 展开了二维码卡（opacity=' + opened.opacity + '）');

  const geo = await p.evaluate(() => {
    const cv = document.getElementById('lotQr');
    const r = cv.getBoundingClientRect();
    return { canvas: cv.width, css: +r.width.toFixed(1) };
  });
  const modules = d.size + 8;
  const pxPerModule = geo.css / modules;
  console.log('   canvas ' + geo.canvas + 'px · 屏上 ' + geo.css + 'px · 含静默区 '
    + modules + ' 模块 → 每模块 ' + pxPerModule.toFixed(2) + 'px');
  ok(pxPerModule >= 4, '每模块 ≥4px（屏幕扫码的通行下限）');
  /* 版本上限取 v5，不是 v4。
   * 快速隧道域名是 4 个随机单词（23~41 字符），加上 https:// + .trycloudflare.com
   * + /s，URL 落在 51~69 字节，正好横跨 v4 的容量上限 62 —— 所以**每次重启
   * 抽到的域名长度决定版本是 v4 还是 v5**，写 `<= 4` 就是个抛硬币的门槛
   * （和下面 120px 那条犯的是同一个错，都被我一次实测打回来了）。
   * v5 是这条路径的真实最坏情况（69 字节 < v5 上限 84），而 v4/v5 在真实
   * 显示尺寸下都是 3/3 可解（10 个域名实测）。所以 v5 可接受，v6 就该红了 ——
   * 那说明有人把 /s 短链去掉了、或往地址里加了查询参数。 */
  ok(d.version <= 5, '版本 v' + d.version + ' ≤ v5（隧道域名 51~69 字节的真实上限）');

  /* 抓两张图给 Python 解码：canvas 原始 + 屏上尺寸
   *
   * ⚠ 原始 canvas 必须**补上 .lq 的白边**再存，否则测的是一个现场根本不存在的画面。
   *   页面上 canvas 外面套着 `.lq{background:#fff;padding:12px}` —— 那 12px 白边
   *   是静默区的一部分，扫描器看到的是「码 + 4 模块画布白边 + 12px 卡片白边」。
   *   直接 toDataURL 只拿到画布本身，静默区正好卡在标准下限 4 模块。
   *   实测：不补白边时 OpenCV 解不出（ZBar 能），补 32px 就能解 ——
   *   这不是码错了，是 OpenCV 的检测器对刚好 4 模块静默区比较挑。
   *   补上白边才是「测发出去的那个配置」，而不是测一个中间产物。 */
  const rawPng = path.join(TMP, 'qr-canvas.png');
  const raw = await p.evaluate(() => {
    const cv = document.getElementById('lotQr');
    const lq = cv.parentElement;
    const padCss = parseFloat(getComputedStyle(lq).paddingLeft) || 0;
    /* 白边按 canvas 内部像素等比放大（canvas 是 2 倍图） */
    const k = cv.width / cv.getBoundingClientRect().width;
    const pad = Math.round(padCss * k);
    const out = document.createElement('canvas');
    out.width = cv.width + pad * 2;
    out.height = cv.height + pad * 2;
    const g = out.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(cv, pad, pad);
    return out.toDataURL('image/png');
  });
  fs.writeFileSync(rawPng, Buffer.from(raw.split(',')[1], 'base64'));
  const shotPng = path.join(TMP, 'qr-onscreen.png');
  await p.locator('#lotQr').screenshot({ path: shotPng });

  /* 深浅两个主题各抓一张整卡（卡片底色会变，要证明静默区没被卡片底色吃掉）。
   * 换主题不会关卡片，但保险起见每次都确认它还是开着的。 */
  const themePngs = {};
  for (const [ti, name] of [[0, 'dark'], [1, 'light']]) {
    await p.evaluate((i) => window.APDiag.setTheme(i), ti);
    await p.waitForTimeout(500);
    const stillOpen = await p.evaluate(() =>
      document.getElementById('lotCard').classList.contains('on'));
    if (!stillOpen) { await p.keyboard.press('q'); await p.waitForTimeout(700); }
    const f = path.join(TMP, 'qr-card-' + name + '.png');
    await p.locator('#lotCard').screenshot({ path: f });
    themePngs[name] = f;
  }

  /* ══ 四、真解码器 ══ */
  sec('四、两个独立解码器读它（这一步以前从来没做过）');
  if (!fs.existsSync(QPY)) {
    skip('没找到 ' + QPY + '（需要 opencv-python + pyzbar），解码这一段没验');
  } else {
    const files = [rawPng, shotPng, themePngs.dark, themePngs.light];
    const script = path.join(TMP, 'dec.py');
    fs.writeFileSync(script, [
      'import sys, json',
      'import cv2, numpy as np',
      'from PIL import Image',
      'from pyzbar import pyzbar',
      'def load(p):',
      '    return cv2.imdecode(np.fromfile(p, dtype=np.uint8), cv2.IMREAD_COLOR)',
      'def cvdec(img):',
      '    try:',
      '        t, _, _ = cv2.QRCodeDetector().detectAndDecode(img)',
      '        return t or None',
      '    except Exception:',
      '        return None',
      'def zbdec(img):',
      '    for r in pyzbar.decode(Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))):',
      '        if r.type == "QRCODE":',
      '            return r.data.decode("utf-8", "replace")',
      '    return None',
      'def degrade(img, px, blur, jq, rot):',
      '    o = cv2.resize(img, (px, px), interpolation=cv2.INTER_AREA)',
      '    if blur: o = cv2.GaussianBlur(o, (blur*2+1, blur*2+1), 0)',
      '    if rot:',
      '        M = cv2.getRotationMatrix2D((px/2.0, px/2.0), rot, 1.0)',
      '        o = cv2.warpAffine(o, M, (px, px), borderValue=(255,255,255))',
      '    if jq < 100:',
      '        good, buf = cv2.imencode(".jpg", o, [int(cv2.IMWRITE_JPEG_QUALITY), jq])',
      '        if good: o = cv2.imdecode(buf, cv2.IMREAD_COLOR)',
      '    return o',
      'out = {"files": {}, "degrade": []}',
      'for f in sys.argv[2:]:',
      '    img = load(f)',
      '    out["files"][f] = [cvdec(img), zbdec(img)]',
      /* 退化测试的底图必须用**屏上截图**（qr-onscreen.png），不能用 qr-canvas.png。
       * 下面那几档 px 的含义是「码在屏上占多少像素」。qr-canvas.png 为了如实
       * 复现 .lq 的白边，外面多包了一圈 padding —— 拿它缩到 120px，
       * 实际留给码的只有约 105px，测出来的是一个比现实更严苛的场景，
       * 而且随 padding 改动而漂移。屏上截图正好是 canvas 的 CSS 尺寸，口径干净。 */
      'base = load([f for f in sys.argv[2:] if "onscreen" in f][0])',
      'for px in (180, 148, 120, 96):',
      '    for blur, jq, rot in ((1,80,3), (2,60,7), (3,45,12)):',
      '        g = degrade(base, px, blur, jq, rot)',
      '        hit = (cvdec(g) == sys.argv[1]) or (zbdec(g) == sys.argv[1])',
      '        out["degrade"].append([px, blur, jq, rot, bool(hit)])',
      'print(json.dumps(out, ensure_ascii=False))'
    ].join('\n'));

    let res = null;
    try {
      const raw2 = execFileSync(QPY, [script, d.url, ...files], { encoding: 'utf8' });
      res = JSON.parse(raw2.trim().split('\n').pop());
    } catch (e) {
      ok(false, '解码脚本执行失败：' + String(e.message).slice(0, 120));
    }
    if (res) {
      for (const [f, [cv, zb]] of Object.entries(res.files)) {
        const n = path.basename(f);
        ok(cv === d.url && zb === d.url,
          n + '：OpenCV 与 ZBar 都解出正确 URL' +
          (cv === d.url && zb === d.url ? '' : '（cv=' + cv + ' zbar=' + zb + '）'));
      }
      console.log('   退化测试（模拟手机拍摄）：');
      const at = {};
      for (const [px, blur, jq, rot, hit] of res.degrade) {
        (at[px] = at[px] || []).push(hit);
        console.log('     ' + String(px).padStart(4) + 'px  糊' + blur + '  JPEG' + jq
          + '  歪' + rot + '°   ' + (hit ? 'OK' : 'X'));
      }
      /* ── 两条门槛的取值是量出来的，不是拍的 ──────────────────────────────
       * 隧道地址每次重启都变（4 个随机单词，域名 23~41 字符 → URL 51~69 字节，
       * 正好横跨 v4 容量上限 62，所以版本在 v4/v5 之间摆动）。断言必须对
       * 「任何一次抽到的地址」都成立，所以我拿 **10 个实际抽到过的隧道域名**
       * 逐个跑了退化矩阵：
       *
       *     尺寸    v4（8 个样本）   v5（2 个样本）   结论
       *     180px   全部 3/3        全部 3/3        稳定 → 硬门槛
       *     148px   2/3 ~ 3/3      2/3 ~ 2/3       全部 ≥2/3 → 可以当门槛
       *     120px   1/3 ~ 2/3      1/3 ~ 2/3       **不稳定，不能当门槛**
       *
       * 关键发现：120px 处的成败**跟版本无关** —— v4 与 v5 的区间完全重叠
       * （都是 1~2/3）。真正的变量是内容与掩码跟「模糊+旋转+JPEG」的相互作用，
       * 换个域名就换个结果。我一开始判断成「v4 有余量、v5 没有」，
       * 拿十个样本一量就否掉了 —— 单次运行的结果在这个尺寸上是抛硬币。
       *
       * 所以 120px 只报数不判红（红了也不说明产品坏了），门槛下移到 148px：
       * 它同样代表「离远一点」的余量，但十个样本全过，能真正拦住回归。 */
      ok((at[180] || []).every(Boolean),
        '真实显示尺寸 180px：三档退化全部可解（10 个隧道域名实测都是 3/3）');
      ok((at[148] || []).filter(Boolean).length >= 2,
        '缩到 148px 仍 ≥2/3 可解（余量门槛；10 个样本实测全部达标）');
      console.log('   120px 处 ' + (at[120] || []).filter(Boolean).length
        + '/3 可解 —— 只报数不判红：实测 v4/v5 都在 1~2/3 之间抖，'
        + '取决于随机域名与掩码，不是稳定判据。');
      console.log('   要把余量做上去只有一个实招：换短的固定域名。当前 '
        + d.url.length + ' 字节 → v' + d.version
        + '；https://ap.<你们的域名>/s 约 26 字节 → v2/v3，模块大得多。');
    }
  }

  /* ══ 五、手机视口真的把问卷填完 ══ */
  sec('五、用手机视口走完问卷（扫码之后的事）');
  const phone = await b.newContext(Object.assign({}, devices['iPhone 13'] || {}));
  const ph = await phone.newPage();
  const phErrs = [];
  ph.on('pageerror', (e) => phErrs.push(String(e)));
  const resp = await ph.goto(d.url, { waitUntil: 'load' }).catch(() => null);
  ok(resp && resp.status() === 200, '手机视口打开码里的地址：HTTP ' + (resp ? resp.status() : 'fail'));
  await ph.waitForTimeout(900);
  const noOverflow = await ph.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth + 2);
  ok(noOverflow, '问卷页在手机宽度下不横向溢出');

  /* 按问卷**真实流程**走完，不用通用点击器 ——
   * 第一版那个泛化点击器只点中了「开始」就撞上了抽奖按钮，
   * 于是"走完问卷"这个结论是靠 1 次点击撑起来的，站不住。
   * 真实结构：scIntro(开始) → scQ 逐题(#qopts 选项 + #btnNext) → scWheel(开始抽奖) → scWin
   * 题目是**分支**的：先答身份题，再按身份展开该分支的题目，所以题数动态。 */
  const flow = await ph.evaluate(async () => {
    const sleep = (t) => new Promise(r => setTimeout(r, t));
    const vis = (id) => {
      const e = document.getElementById(id);
      return e && !e.classList.contains('hide');
    };
    const log = [];
    document.getElementById('btnStart').click();
    await sleep(400);
    log.push('开始:' + vis('scQ'));

    let answered = 0, stuck = 0, sawTextQ = false, sawValidation = false;
    let lastNum = '';
    for (let guard = 0; guard < 14 && vis('scQ'); guard++) {
      const num = ((document.getElementById('qnum') || {}).textContent || '').trim();
      if (num === lastNum) {
        stuck++;
        if (stuck > 2) { log.push('卡在 ' + num); break; }
      } else { stuck = 0; }
      lastNum = num;

      /* 题型有两种：单选（#qopts 里的选项）和**文本必填**（末题留联系方式）。
       * 只点选项的话文本题永远过不去 —— btnNext 会正确拦下来。 */
      const input = document.querySelector('#qopts input[type=text], #qopts input, #qopts textarea');
      if (input) {
        sawTextQ = true;
        /* 空着的时候必须**前进不了** —— 断言这个不变量，不断言某一种拦法。
         * 旧实现是「点下去弹一句错」，现版本是「按钮直接禁用」；
         * 上一版这里只认前者，改成禁用之后就误判成产品缺陷了。
         * 两种都算数：只要点完还停在同一题，必填就是有效的。 */
        const sub = (document.getElementById('qsub') || {}).textContent || '';
        const isRequired = sub.indexOf('选填') < 0;
        if (isRequired) {
          const btn = document.getElementById('btnNext');
          const wasDisabled = btn.disabled;
          const before = (document.getElementById('qnum') || {}).textContent;
          btn.click();
          await sleep(200);
          const err = (document.getElementById('qerr') || {}).textContent || '';
          const after = (document.getElementById('qnum') || {}).textContent;
          if (vis('scQ') && before === after && (wasDisabled || err.trim())) sawValidation = true;
        }
        input.focus();
        input.value = 'ap_test_13800000000';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(150);
      } else {
        const opts = Array.from(document.querySelectorAll('#qopts *'))
          .filter(e => e.getBoundingClientRect().height > 20 && e.children.length === 0);
        if (!opts.length) { log.push('无可选项 @' + num); break; }
        const target = opts[0].closest('[data-v]') || opts[0].parentElement || opts[0];
        target.click();
        await sleep(180);
      }
      document.getElementById('btnNext').click();
      answered++;
      log.push(num);
      await sleep(340);
      if (!vis('scQ')) break;
    }

    const reachedWheel = vis('scWheel');
    let prize = null;
    if (reachedWheel) {
      document.getElementById('btnSpin').click();
      /* 转盘有动画，给足时间 */
      for (let i = 0; i < 40 && !vis('scWin'); i++) await sleep(250);
      if (vis('scWin')) prize = (document.getElementById('pname') || {}).textContent;
    }
    return { answered, log, reachedWheel, reachedWin: vis('scWin'), prize,
             sawTextQ: sawTextQ, sawValidation: sawValidation };
  });
  console.log('   答了 ' + flow.answered + ' 题（' + flow.log.join(' → ') + '）');
  ok(flow.answered >= 3, '逐题答完了分支问卷（' + flow.answered + ' 题，含身份题 + 分支题）');
  ok(flow.reachedWheel, '答完进入抽奖盘');
  ok(flow.reachedWin && !!flow.prize, '抽奖出结果：' + flow.prize);
  ok(flow.sawTextQ, '走到了必填的联系方式题');
  ok(flow.sawValidation, '联系方式留空时前进不了（按钮禁用或报错，总之不放空表单过去）');
  const stored = await ph.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out[k] = (localStorage.getItem(k) || '').slice(0, 60);
    }
    return out;
  });
  const keys = Object.keys(stored);
  ok(keys.length > 0, '有作答被记下来（localStorage 键：' + keys.join(', ') + '）');
  /* 「localStorage 里有东西」不等于落库了 —— 上一版就停在这一步，
   * 而当时的真实结论恰恰是「服务端没有任何记录」。要从**服务端**读回来才算。
   * 这里只做一个存在性检查（详细字段比对在 ckSurvey.js）。 */
  const mine = await ph.evaluate(() =>
    JSON.parse(localStorage.getItem('apSurvey.mine') || 'null'));
  let onServer = false;
  /* ── 记录落在哪台机器上，取决于二维码指向哪里 ────────────────────────────
   *   本机模式（pub 为空或指向本机）：记录落在这台电脑的 E-survey/_data
   *   展会模式（AP_PUBLIC_URL 指向 Mac mini）：**记录落在 Mac mini 上**，
   *     本机一条都不会有 —— 那是正确行为，不是故障。
   * 第一版只查本机，于是一进展会模式这条就红了，很容易被误读成「落库坏了」。
   * 现在按 pub 指向的主机去查。那台机器的读接口要 token（联系方式不能裸奔），
   * 没给 token 就明确跳过并说明，绝不静默当通过。 */
  let pubHost = null;
  try { if (lanJson && lanJson.pub) pubHost = new URL(lanJson.pub).origin; } catch (e) {}
  const isRemote = !!pubHost && !/localhost|127\.0\.0\.1/.test(pubHost)
                   && !(lanJson.ip && pubHost.indexOf(lanJson.ip) >= 0);

  if (!isRemote) {
    for (let i = 0; i < 16 && !onServer && mine; i++) {
      const r = await get(HOST + '/api/survey/list');
      try {
        const rows = (JSON.parse(r.body) || {}).rows || [];
        onServer = rows.some((x) => x.ticket === mine.ticket && x.device === mine.device);
      } catch (e) {}
      if (!onServer) await new Promise((s) => setTimeout(s, 250));
    }
    ok(onServer, '这次手机作答也真的落到了服务端（凭证 ' + (mine && mine.ticket) + '）');
  } else {
    const tok = process.env.AP_SURVEY_TOKEN || '';
    if (!tok) {
      skip('展会模式：记录落在 ' + pubHost + ' 而不是本机，这是正确行为。'
         + '要在这里确认它真的落库了，用 AP_SURVEY_TOKEN=<汇总口令> 再跑一次。');
    } else {
      for (let i = 0; i < 16 && !onServer && mine; i++) {
        const r = await get(pubHost + '/api/survey/list?k=' + encodeURIComponent(tok));
        try {
          const rows = (JSON.parse(r.body) || {}).rows || [];
          onServer = rows.some((x) => x.ticket === mine.ticket && x.device === mine.device);
        } catch (e) {}
        if (!onServer) await new Promise((s) => setTimeout(s, 400));
      }
      ok(onServer, '这次手机作答落到了 ' + pubHost + '（凭证 ' + (mine && mine.ticket) + '）');
    }
  }
  ok(phErrs.length === 0, '手机端无 JS 错误' + (phErrs.length ? '：' + phErrs[0] : ''));

  ok(errs.length === 0, '大屏端无 JS 错误' + (errs.length ? '：' + errs[0] : ''));
  console.log('\n' + (bad ? 'X  ' + bad + ' 项不过'
    : 'OK 扫码全链路通过') + (skipped ? '（跳过 ' + skipped + ' 项）' : ''));
  await b.close();
  process.exit(bad ? 1 : 0);
})();
