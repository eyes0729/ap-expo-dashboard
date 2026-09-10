/* 极简本地静态服务器：解决 file:// 的各种限制，也贴近展会现场的部署方式。
 * 用法：node _serve.js   然后浏览器开 http://localhost:8099/ */
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const os = require('os'), dgram = require('dgram');
const ROOT = __dirname, PORT = 8099;
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2', '.md':'text/plain; charset=utf-8' };
/* ── 本机真实 LAN IP ─────────────────────────────────────────────────────
 * 为什么需要这个口子：二维码要让**手机**打开问卷，所以里面必须是一个手机能访问的
 * 地址。而操作员在现场几乎一定是开 localhost，此时页面拿不到自己的局域网地址，
 * 只能退回代码里写死的那个 IP —— 那个 IP 是 DHCP 分配的，换个网络就失效，
 * 结果就是「码能扫出来，但打开是打不开的页面」。
 *
 * 判定主网卡用 UDP connect 的老办法：连一个公网地址但**不发包**，
 * 让操作系统按自己的路由表选出口网卡，再读回本地 socket 地址。
 * 这比遍历 os.networkInterfaces() 猜哪个是主网卡可靠得多 ——
 * 本机同时有 169.254 链路本地 ×4、Tailscale 100.65、真实 WLAN 192.168，
 * 靠名字或顺序猜必然会猜错。 */
function primaryLanIp() {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    let done = false;
    const finish = (v) => { if (!done) { done = true; try { s.close(); } catch (e) {} resolve(v); } };
    s.on('error', () => finish(null));
    try {
      s.connect(53, '8.8.8.8', () => {
        try { finish(s.address().address); } catch (e) { finish(null); }
      });
    } catch (e) { finish(null); }
    setTimeout(() => finish(null), 400);
  });
}

/** 备选清单：排掉链路本地和回环，给人工核对用 */
function candidates() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const a of ifs[name] || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue;
      out.push({ iface: name, ip: a.address });
    }
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 公网隧道（cloudflared）
 * ---------------------------------------------------------------------------
 * 为什么必须有这一段：
 *   二维码里原来装的是 `http://<局域网IP>:8099/`。那是 RFC1918 私网地址，
 *   **在 5G 上物理不可达**（运营商网络里没有这台机器），换一个 WiFi 也只有
 *   「同一网段 + 没开客户端隔离 + 防火墙放行」三条同时成立才通 ——
 *   而展会/酒店 WiFi 默认就是开客户端隔离的。所以现场表现是
 *   「同事换 5G 也扫不出、换 WiFi 也扫不出」，这不是二维码的问题：
 *   编码器我拿独立解码库（jsQR）往返验过，6 例全过，码本身是对的。
 *
 * 隧道把本机 8099 暴露成一个 https 公网地址，手机走自己的 5G 就能打开，
 * 完全不碰展会网络 —— 反而比局域网那条路更可靠。
 *
 * 三个实现细节：
 *   ① 协议锁 http2（走 TCP 443）。默认的 quic 要 UDP 7844，很多网络（包括
 *      本机实测的这个）直接丢包，cloudflared 会一直重试连不上。
 *      http2 慢一点，但对一个问卷页毫无影响。
 *   ② 进程挂了要自动重起。快速隧道每次重起会换一个随机域名，所以
 *      **屏幕那边必须轮询 /__lan 重画二维码**（app.js 里做了）。
 *   ③ 拿不到隧道不是致命错误：pub 为 null，二维码自动退回局域网地址，
 *      和加这段之前的行为完全一致。
 * ═══════════════════════════════════════════════════════════════════════════ */
const { spawn, execFileSync } = require('child_process');
/* ── 默认**不开**隧道，要开得显式说 ────────────────────────────────────────
 * 一开始默认是开的，理由是「私网地址在 5G 上不可达，隧道能解决」。
 * 前半句对，后半句在国内不成立 —— `*.trycloudflare.com` 在普通国内手机网络上
 * 打不开，扫码得到的是「网络出错」。
 *
 * 这个结论被自己的测试掩盖了很久，值得写下来：本机 DNS 被网关
 * （192.168.56.2 / op.lan）整体劫持，`trycloudflare.com` 解析到
 * 198.18.84.62 —— 那是 Clash 这类透明代理的 fake-IP 默认网段（198.18.0.0/15）。
 * 于是**笔记本上 curl 一路 200，因为流量走了代理**；手机 5G 没有代理，必然失败。
 * 连指定阿里 DNS(223.5.5.5) 查回来的也是同一个 fake IP，说明 53 端口也被劫持。
 * 教训：**在被劫持/代理的网络里，本机 curl 不能当作「手机能不能访问」的证据。**
 *
 * 所以默认走局域网：地址短（27 字节 → 二维码 v3，每模块 4.86px，比隧道的 v5
 * 好扫不少）、不依赖外网、且现场发一个专用热点就 100% 可用。
 * 要开隧道用 `--tunnel` 或 `AP_TUNNEL=1`（在能访问 Cloudflare 的网络里才有意义）。 */
const TUNNEL_ON = process.argv.includes('--tunnel') || process.env.AP_TUNNEL === '1';

/* ── 固定公网地址（优先级最高）────────────────────────────────────────────
 * 问卷页已经部署到 Mac mini（`~/work/ap-expo`），经自有域名的 Cloudflare 命名
 * 隧道对外：**https://ap.lumioi.com/s**。设了这个变量之后：
 *   · 二维码直接装这个地址，**不再随重启变化，可以印在易拉宝上**
 *   · 手机用 5G 直接扫，不需要和大屏连同一个 WiFi
 *   · 地址只有 23 字节 → 二维码 v2（25×25），每模块 5.45px，
 *     比局域网的 v3 还大一档、比 trycloudflare 的 v5 大两档，最好扫
 *
 * 为什么这条能成立而 trycloudflare 不行：同样是 Cloudflare 边缘，但
 * `radar.lumioi.com`（同一台 Mac mini、同一套隧道机制）**经用户实机验证
 * 在 5G 上能打开**，而 `*.trycloudflare.com` 打不开。这个差别只能实机测，
 * 本机 curl 因为走代理，两个都会返回 200（见上面那段长注释）。
 *
 * 注意：设了它就不需要本机隧道了，大屏这台只负责放画面。 */
const PUBLIC_URL_DEFAULT = 'https://ap.lumioi.com/s';
const PUBLIC_URL = (process.env.AP_PUBLIC_URL === undefined
  ? PUBLIC_URL_DEFAULT
  : process.env.AP_PUBLIC_URL).trim().replace(/\/+$/, '');
const TUNNEL_PROTO = process.env.AP_TUNNEL_PROTO || 'http2';
const tunnel = { url: null, state: TUNNEL_ON ? 'starting' : 'off', restarts: 0, since: Date.now() };
let tunnelProc = null;

/* ── 孤儿隧道的回收（安全网，不是已复现的故障）──────────────────────────────
 * 先说实测结论，别让后面的人误判：
 *   **本机 Node 24 + Windows 下，强杀 node（TerminateProcess，不给信号）
 *   会把 cloudflared 一起带走** —— Node 在 Windows 上把子进程放进了
 *   job object，父进程一死整个 job 被拆掉。所以「点掉窗口 X 留下孤儿」
 *   这条路我**没能复现**。
 *
 * 那为什么还留这段：
 *   ① job object 这个行为不是 Node 的公开契约，换版本/换平台可能不一样；
 *   ② 更现实的来源是**手工起的隧道**。我自己在排查阶段用 bash 直接
 *      `cloudflared tunnel --url … &` 起过两次，那两个进程的父进程是 shell、
 *      shell 一结束它们就成了孤儿，最后确实同时挂着两个。
 *      孤儿的坏处不是占资源，是**它还占着一个 trycloudflare 域名**，
 *      而它回源的 8099 已经没人监听 —— 谁扫到那个旧域名就是 502。
 *
 * 处置：把自己起的那个 PID 记到文件里，下次启动先回收。
 * 两条纪律：
 *   · **只杀记录在案的那个 PID**，绝不 `taskkill /IM cloudflared.exe` ——
 *     那会连带杀掉用户自己在跑的别的隧道。
 *   · 杀之前用 tasklist 核对该 PID **现在**是不是 cloudflared。PID 会被系统
 *     回收复用，不核对就可能杀掉一个刚好拿到同号的无关进程。
 *     （实测：残留 PID 33732 早已不存在，回收逻辑正确地什么都没做。） */
const PID_FILE = path.join(os.tmpdir(), 'ap-expo-cloudflared.pid');

function reapOrphanTunnel() {
  let pid = 0;
  try { pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10) || 0; } catch (e) { return; }
  if (!pid) return;
  try {
    /* 先确认这个 PID 现在真的是 cloudflared —— PID 会被系统回收复用，
     * 不核对就可能杀掉一个刚好拿到同号的无关进程。 */
    const out = execFileSync('tasklist', ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'],
                             { encoding: 'utf8', windowsHide: true });
    if (/cloudflared/i.test(out)) {
      process.kill(pid);
      console.log('[隧道] 回收了上次残留的孤儿进程 PID=' + pid);
    }
  } catch (e) { /* 进程早就不在了，正常 */ }
  try { fs.unlinkSync(PID_FILE); } catch (e) {}
}

function killTunnel() {
  if (tunnelProc) { try { tunnelProc.kill(); } catch (e) {} tunnelProc = null; }
  try { fs.unlinkSync(PID_FILE); } catch (e) {}
}

function startTunnel() {
  if (!TUNNEL_ON) return;
  let proc;
  try {
    proc = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:' + PORT,
                                 '--no-autoupdate', '--protocol', TUNNEL_PROTO],
                 { windowsHide: true });
  } catch (e) {
    tunnel.state = 'missing';
    console.log('[隧道] 起不来（cloudflared 没装？）：' + e.message);
    console.log('        二维码退回局域网地址 —— 手机必须和这台电脑同一个 WiFi。');
    return;
  }
  tunnelProc = proc;
  /* 记下 PID，供下次启动回收孤儿（见 reapOrphanTunnel 的注释） */
  try { fs.writeFileSync(PID_FILE, String(proc.pid), 'utf8'); } catch (e) {}
  const scan = (buf) => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && m[0] !== tunnel.url) {
      const first = !tunnel.url;
      tunnel.url = m[0];
      tunnel.state = 'up';
      tunnel.since = Date.now();
      console.log('[隧道] ' + (first ? '已就绪' : '地址已变更') + '：' + tunnel.url);
      console.log('        手机扫码进问卷: ' + tunnel.url + '/E-survey/');
    }
  };
  proc.stdout.on('data', scan);
  proc.stderr.on('data', scan);          /* cloudflared 把地址打在 stderr */
  proc.on('error', () => { tunnel.state = 'missing'; });
  proc.on('exit', (code) => {
    if (tunnelProc !== proc) return;     /* 已经被换掉了，忽略旧进程的退出 */
    tunnel.url = null;
    tunnel.state = 'down';
    tunnel.restarts++;
    console.log('[隧道] 断了（code=' + code + '），5 秒后重连（第 '
      + tunnel.restarts + ' 次）。期间二维码自动退回局域网地址。');
    setTimeout(startTunnel, 5000);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 问卷落库
 * ---------------------------------------------------------------------------
 * 为什么落在这台机器上，而不是先接云数据库：
 *   手机能打开问卷页，就说明它和这台服务器在同一个局域网、同一个 origin ——
 *   POST 走的是和加载页面**完全相同**的那条链路，不引入任何新的失败模式。
 *   云端要过展会 WiFi 的外网出口，那是现场最不可靠的一段。
 *   （要上云的话，正确做法是把这里的文件当作权威副本，另起一个同步进程往上推，
 *     而不是让手机直连云 —— 见 E-survey/README.md「落库」一节。）
 *
 * 为什么是 JSONL 不是 JSON 数组：
 *   追加写。进程被杀 / 笔记本断电，最多丢没写完的最后一行，
 *   不会像「读出整个数组→push→整份写回」那样把已有的几百条一起写坏。
 *
 * 为什么写入侧不去重、去重放在读取侧：
 *   写入路径必须极简且永不因为逻辑失败 —— 前端补传队列会重发同一条记录，
 *   如果写之前要先读一遍全量文件来查重，读失败就会连带写失败。
 *   重复行留着，list / export 时按 device+ts 去重。
 *
 * 读写权限不对称（重要）：
 *   POST /api/survey        任何局域网设备都能写 —— 手机就是它的客户端
 *   GET  /api/survey/list   **仅本机**，或带 token
 *   GET  /api/survey/export 同上，返回带 BOM 的 CSV
 *   展会 WiFi 是公共网络，同网段任何人都能摸到这个端口。
 *   里面是参与者的微信号 / 手机号，不能让路人整包拉走。
 * ═══════════════════════════════════════════════════════════════════════════ */
const DATA_DIR = path.join(ROOT, 'E-survey', '_data');
/* 不设默认 token：默认只有本机能读，零配置且最安全。
 * 要在手机上看全场汇总时才设：  set AP_SURVEY_TOKEN=xxxx && node _serve.js
 * 然后手机开  …/E-survey/?admin=1&k=xxxx */
const ADMIN_TOKEN = process.env.AP_SURVEY_TOKEN || '';
/* 白名单字段 —— 客户端塞别的键一律丢掉，避免有人往磁盘里灌任意数据 */
const FIELDS = ['ts', 'device', 'role', 'roleName', 'shopify', 'gmv', 'category',
                'size', 'contact', 'prize', 'ticket'];
const CSV_HEAD = ['时间', '设备', '身份', '身份名', 'Shopify', '月GMV', '主营品类',
                  '公司规模', '联系方式', '奖项', '凭证编号', '入库时间'];

const pad2 = (n) => ('0' + n).slice(-2);
const dayKey = (ts) => { const d = new Date(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
const dayFile = (ts) => path.join(DATA_DIR, 'survey-' + dayKey(ts) + '.jsonl');

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8',
                        'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
/** 「是不是这台电脑自己发来的」。
 *  除了回环，还要认本机各网卡的地址 —— 操作员很可能直接用二维码里那个
 *  http://192.168.x.x:8099/ 打开管理页（而不是 localhost），
 *  那时 remoteAddress 是本机自己的 LAN IP，只认 127.0.0.1 会把自己挡在门外，
 *  而且是**静默降级成「仅本机 localStorage」**——恰好是这次要消灭的那个错误口径。
 *  安全性不受影响：局域网上伪造源 IP 完不成 TCP 握手（SYN-ACK 会发回给真正的持有者）。 */
/** 请求是不是从反向代理/隧道转进来的。
 *
 *  ⚠ 这个判断是开了公网隧道之后**唯一**挡住数据泄露的东西，别删。
 *
 *  cloudflared 跑在本机、回源到 127.0.0.1，所以隧道进来的请求
 *  `socket.remoteAddress` 是 `::1` —— 和操作员本机开 localhost **完全一样**。
 *  实测（隧道 vs 本机，同一个 echo 服务）：
 *      隧道进来: remote=::1  + cf-connecting-ip / x-forwarded-for / cdn-loop / cf-ray
 *      本机直连: remote=::1  只有 host / user-agent / accept
 *  也就是说光看 IP 会把**整个公网**判成本机。加隧道前实测过一次：
 *  `/api/survey/export` 从公网直接返回 200 + 全量 CSV（含微信号/手机号）。
 *
 *  所以这里 fail closed：只要带上任何一个代理头就当外部请求。
 *  代价是「操作员通过隧道地址打开管理页」也会被挡 —— 这是对的，
 *  那条路和路人的路一模一样，本来就不该给。 */
function viaProxy(req) {
  const h = req.headers || {};
  return !!(h['cf-connecting-ip'] || h['x-forwarded-for'] || h['cdn-loop'] ||
            h['cf-ray'] || h['x-real-ip'] || h['forwarded'] ||
            h['x-forwarded-host'] || h['x-forwarded-proto']);
}
function isLocal(req) {
  if (viaProxy(req)) return false;          /* 隧道/代理一律不算本机 */
  const a = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (a === '127.0.0.1' || a === '::1') return true;
  return candidates().some((c) => c.ip === a);
}
function canRead(req, query) {
  if (isLocal(req)) return true;
  return !!ADMIN_TOKEN && query && query.k === ADMIN_TOKEN;
}
/** 收窄成白名单字段 + 限长。ts 用客户端的（手机上的作答时刻），
 *  另存一个服务端时间 srvTs —— 手机时钟可能没校准，排序和「按天」要以服务端为准时可用。 */
function sanitize(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const out = {};
  for (const k of FIELDS) {
    if (k === 'ts') {
      const v = Number(r.ts);
      out.ts = (isFinite(v) && v > 0) ? v : Date.now();
      continue;
    }
    out[k] = String(r[k] == null ? '' : r[k]).slice(0, 200);
  }
  if (!out.ticket || !out.device) return null;   /* 这两个是去重键，缺了没法处理 */
  out.srvTs = Date.now();
  return out;
}
/** 读全部（或某一天）。量级是展会一天几百条，同步读几十 KB 不值得写成异步。 */
function readAll(dateFilter) {
  let files = [];
  try {
    files = fs.readdirSync(DATA_DIR)
      .filter((f) => /^survey-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .filter((f) => !dateFilter || f === 'survey-' + dateFilter + '.jsonl')
      .sort();
  } catch (e) { return []; }
  const seen = new Set(), rows = [];
  for (const f of files) {
    let txt = '';
    try { txt = fs.readFileSync(path.join(DATA_DIR, f), 'utf8'); } catch (e) { continue; }
    for (const line of txt.split('\n')) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch (e) { continue; }   /* 坏行跳过，不让一行毁掉整天 */
      const key = r.device + '|' + r.ts;
      if (seen.has(key)) continue;                            /* 补传造成的重复在这里收掉 */
      seen.add(key);
      rows.push(r);
    }
  }
  rows.sort((a, b) => a.ts - b.ts);
  return rows;
}
function csvCell(c) {
  c = String(c == null ? '' : c);
  return /[",\n\r]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
}
function toCsv(rows) {
  const fmt = (ts) => { const d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' '
      + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); };
  const lines = [CSV_HEAD.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([fmt(r.ts), r.device, r.role, r.roleName, r.shopify, r.gmv, r.category,
                r.size, r.contact, r.prize, r.ticket, r.srvTs ? fmt(r.srvTs) : '']
      .map(csvCell).join(','));
  }
  return lines.join('\r\n');
}

/* ── 写入限流 ──────────────────────────────────────────────────────────────
 * 开了隧道之后 POST /api/survey 就暴露在公网上了（拿到二维码的人都能发）。
 * 8KB 的单条上限已经在，但没有条数上限 —— 一个脚本可以慢慢把磁盘写满。
 *
 * 为什么是**全局**滑动窗口，不是按 IP：
 *   展会现场大部分手机走场馆 WiFi 出去，在 Cloudflare 那边**共用同一个公网 IP**。
 *   按 IP 限流会把整个展位的人一起挡掉 —— 那是比被灌数据更严重的故障。
 *   全局阈值定 600 条/小时：现场一天几百条，正常用永远碰不到；
 *   真被灌的时候一小时最多多 600 行（约 90KB），完全可控。 */
const RATE_MAX = Number(process.env.AP_RATE_MAX || 600), RATE_WIN = 3600 * 1000;
let rateHits = [];
function rateOk() {
  const now = Date.now();
  rateHits = rateHits.filter((t) => now - t < RATE_WIN);
  if (rateHits.length >= RATE_MAX) return false;
  rateHits.push(now);
  return true;
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  let p = decodeURIComponent(parsed.pathname);
  const query = parsed.query || {};

  /* ── 写：任何局域网设备都可以（手机就是客户端）────────────────────── */
  if (p === '/api/survey' && req.method === 'POST') {
    if (!rateOk()) {
      console.error('[survey] 限流触发：一小时内已收 ' + RATE_MAX + ' 条，拒绝新写入');
      return json(res, 429, { ok: false, error: 'too many submissions, try later' });
    }
    let body = '', aborted = false;
    req.on('data', (c) => {
      body += c;
      /* 一条问卷记录不该有 8KB。超了直接掐断，别让人把磁盘灌满。 */
      if (body.length > 8192) { aborted = true; req.destroy(); }
    });
    req.on('end', () => {
      if (aborted) return;
      let rec;
      try { rec = JSON.parse(body); }
      catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }
      const clean = sanitize(rec);
      if (!clean) return json(res, 400, { ok: false, error: 'bad record' });
      fs.mkdir(DATA_DIR, { recursive: true }, () => {
        fs.appendFile(dayFile(clean.ts), JSON.stringify(clean) + '\n', 'utf8', (e) => {
          if (e) {
            console.error('[survey] 落库失败：', e.message);
            return json(res, 500, { ok: false, error: 'write failed' });
          }
          console.log('[survey] +1  ' + clean.ticket + '  ' + clean.roleName
            + '  ' + (clean.contact || '(未留)') + '  → ' + clean.prize);
          json(res, 200, { ok: true, ticket: clean.ticket });
        });
      });
    });
    return;
  }
  if (p === '/api/survey' && req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'use POST' });
  }

  /* ── 读：仅本机，或带 token（里面有联系方式）──────────────────────── */
  if (p === '/api/survey/list' || p === '/api/survey/export') {
    if (!canRead(req, query)) {
      return json(res, 403, { ok: false,
        error: '只有运行 _serve.js 的这台电脑可以读（记录含联系方式）。'
             + '要在别的设备上看，用 AP_SURVEY_TOKEN 启动服务并在地址后加 &k=<token>' });
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date || '')) ? String(query.date) : '';
    const rows = readAll(date);
    if (p === '/api/survey/list') {
      return json(res, 200, { ok: true, count: rows.length, date: date || 'all', rows });
    }
    const name = 'AP展会问卷-' + (date || dayKey(Date.now())) + '.csv';
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      /* 中文文件名走 RFC 5987，同时留一个 ASCII 兜底给老浏览器 */
      'Content-Disposition': 'attachment; filename="ap-survey-' + (date || dayKey(Date.now()))
        + '.csv"; filename*=UTF-8\'\'' + encodeURIComponent(name),
      'Cache-Control': 'no-store'
    });
    /* Excel 认 UTF-8 需要 BOM，否则中文全乱码 */
    res.end('﻿' + toCsv(rows));
    return;
  }

  /* 二维码用它来拿一个手机能访问的地址 */
  if (p === '/__lan') {
    primaryLanIp().then((ip) => {
      const cs = candidates();
      if (!ip || ip.startsWith('169.254.')) {
        const pick = cs.find(c => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(c.ip));
        ip = pick ? pick.ip : (cs[0] ? cs[0].ip : null);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
                           'Cache-Control': 'no-store' });
      /* pub 是**手机在任何网络下都能打开**的地址，二维码优先用它。
       * 拿不到（隧道没起/断了）就是 null，屏那边自动退回 ip。 */
      res.end(JSON.stringify({
        ip: ip, port: PORT, candidates: cs,
        /* 优先级：固定公网地址 > 本机临时隧道 > null（退回局域网）。
         * PUBLIC_URL 已经是完整地址（含 /s），不要再拼一次。 */
        pub: PUBLIC_URL || (tunnel.url ? tunnel.url + '/s' : null),
        tunnel: { state: tunnel.state, restarts: tunnel.restarts }
      }));
    });
    return;
  }

  /* ── 有哪些人声包 ─────────────────────────────────────────────────────────
   * 为什么需要这个接口，而不是让前端按优先级逐个试探：
   *   逐个试探意味着「pack-azure 还没渲」的时候必然产生一条 404。
   *   那条 404 本身无害，但它会**染红全部验收脚本** —— ckFinal / ckSpark /
   *   ckPages / ckReal / ckGlobeTheme 里都有一条「console 无错误」的断言，
   *   而那条断言是整套验收里最有价值的一条（它逮到过真 bug）。
   *   为了一个预期内的探测把它牺牲掉，等于把噪声永久写进验收基线。
   * 所以改成问一次服务端：它知道磁盘上有什么。 */
  if (p === '/__voice') {
    const dir = path.join(ROOT, '_voice');
    let packs = [];
    try {
      packs = fs.readdirSync(dir)
        .filter((f) => /^pack-/.test(f))
        .filter((f) => { try { return fs.statSync(path.join(dir, f, 'index.json')).isFile(); }
                         catch (e) { return false; } });
    } catch (e) {}
    /* 优先级：azure（可商用）> edge（仅内部试听）> cosy（参考音授权待解决） */
    const PRI = ['pack-azure', 'pack-edge', 'pack-cosy'];
    packs.sort((a, b) => {
      const ia = PRI.indexOf(a), ib = PRI.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
                         'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ packs: packs }));
  }

  /* ── 短链 /s → /E-survey/ ────────────────────────────────────────────────
   * 纯粹为了**二维码好扫**。二维码的字节数直接决定版本，版本决定模块数：
   *     …/E-survey/  68 字节 → v5 = 37×37 模块
   *     …/s          60 字节 → v4 = 33×33 模块（同样画布下每个模块大 12%）
   * 展会上是隔着一两米用手机扫，模块大一点就是实打实的成功率。
   *
   * 为什么是 302 跳转而不是直接在 /s 上吐同一个页面：
   *   E-survey/index.html 里写的是 `src="app.js"` —— 相对路径。
   *   在 /s 上直接吐 HTML，浏览器会去要 /app.js（404），页面白屏。
   *   跳转一次就把 base 路径也带对了，代价只有一个 RTT。 */
  if (p === '/s' || p === '/s/') {
    res.writeHead(302, { 'Location': '/E-survey/', 'Cache-Control': 'no-store' });
    return res.end();
  }
  /* 浏览器每页都会要一次 favicon，没有就是一条 404 噪音。给个空响应。 */
  if (p === '/favicon.ico') {
    res.writeHead(204, { 'Cache-Control': 'max-age=86400' });
    return res.end();
  }

  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(f, (e, buf) => {
    if (e) { res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}).end('404 ' + p); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream',
                         'Cache-Control': 'no-store' });
    res.end(buf);
  });
});

/* 直接 node _serve.js 才监听端口。
 * 被 require 进来时只导出这些纯函数 —— 验收脚本要能单独测「读权限」这条规则：
 * 403 那条分支在本机根本造不出来（从这台电脑发出的请求，源地址一定是本机自己的
 * 某个网卡地址），只能拿构造出来的 req 去测判定函数本身。 */
/** 端口真的绑好之后再开浏览器。
 *
 *  为什么放在这里，而不是在 .bat 里 `start "" http://localhost:8099/`：
 *  .bat 那种写法是先开浏览器、再启动 node —— 顺序天生是反的。
 *  node 要几百毫秒才绑定端口，而**浏览器如果已经开着**，新标签页几乎瞬间
 *  发起请求，于是必然抢在前面拿到 ERR_CONNECTION_REFUSED
 *  （「localhost 拒绝了我们的连接请求」）。
 *  浏览器没开着时反而看不到这个问题 —— 冷启动慢，正好让 node 赢了，
 *  所以它是个「只在 Chrome 已经开着时才复现」的竞态，很容易误判成服务坏了。
 *
 *  由**知道自己已经就绪的那个进程**来开浏览器，这个竞态就从构造上不存在了。
 *  用 AP_OPEN=0 或 --no-open 关掉（无头跑验收脚本时不需要弹浏览器）。 */
function openBrowser(url) {
  if (process.env.AP_OPEN === '0' || process.argv.includes('--no-open')) return;
  try {
    /* start 是 cmd 的内建命令，必须走 cmd /c。第一个空参数是窗口标题占位 ——
     * 少了它，带引号的 URL 会被 start 当成标题而不是要打开的地址。 */
    spawn('cmd', ['/c', 'start', '', url], { windowsHide: true, detached: true }).unref();
  } catch (e) {
    console.log('（没能自动打开浏览器，请手动访问 ' + url + '）');
  }
}

if (require.main === module) {
  /* url.parse 的弃用警告会在操作员窗口里刷两行噪音。现场那个窗口要盯着看
   * 「隧道就绪了没有」，不该被这个干扰。只在直接运行时静音，
   * 被验收脚本 require 时保持原样（开发时该看见警告）。 */
  process.noDeprecation = true;

  server.listen(PORT, () => {
    /* ── 操作员指引写在这里，不写在 .bat 里 ────────────────────────────────
     * .bat 必须保持纯 ASCII：chcp 65001 下 cmd 按字节推进、按字符解析，
     * 中文会让两者错位，越过读缓冲边界之后**文件尾部会被当成命令执行**，
     * 连 `pause` 一起毁掉 —— 窗口闪一下就关，还看不到任何报错。
     * node 输出 UTF-8 没有这个问题，所以中文一律走这里。
     * （项目里 make-voice.ps1 早就为 .ps1 立过同一条规矩。） */
    console.log('');
    console.log('  ┌─ AP 展会大屏 ─────────────────────────────────────────┐');
    console.log('  │ 浏览器会自动打开，不用手动输地址。                    │');
    console.log('  │ 手机扫码：等下面出现「隧道已就绪」，屏上二维码会自动  │');
    console.log('  │ 换成 https 公网地址，那之后 5G / 任意 WiFi 都能扫。   │');
    console.log('  │ 在那之前码里是局域网地址，只有同一个 WiFi 能扫。      │');
    console.log('  │                                                       │');
    console.log('  │ ！这个窗口要一直开着。关掉服务就停，                  │');
    console.log('  │   二维码和人声都会失效。                              │');
    console.log('  └───────────────────────────────────────────────────────┘');
    console.log('');
    console.log('AP 大屏预览: http://localhost:' + PORT + '/');
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
    const today = readAll(dayKey(Date.now())).length;
    console.log('问卷落库:   ' + DATA_DIR + '  （今天已有 ' + today + ' 条）');
    console.log('现场汇总:   http://localhost:' + PORT + '/E-survey/?admin=1');
    console.log('按天导出:   http://localhost:' + PORT + '/api/survey/export?date=' + dayKey(Date.now()));
    if (!ADMIN_TOKEN) {
      console.log('            〔汇总与导出只有本机能读；要在手机上看，用 '
        + 'AP_SURVEY_TOKEN=<token> 启动服务〕');
    } else {
      console.log('            手机查看: …/E-survey/?admin=1&k=' + ADMIN_TOKEN);
    }
    openBrowser('http://localhost:' + PORT + '/');
    if (PUBLIC_URL) {
      console.log('固定公网地址: ' + PUBLIC_URL + '   ← 二维码用这个');
      console.log('            手机用 5G 直接扫，不用连同一个 WiFi。地址不随重启变化。');
    }
    if (TUNNEL_ON) {
      console.log('公网隧道:   正在建立…（二维码会在就绪后自动换成 https 公网地址）');
      reapOrphanTunnel();        /* 先收掉上次可能残留的孤儿，再起新的 */
      startTunnel();
    } else {
      console.log('公网隧道:   未启用（默认）。二维码里是局域网地址，');
      console.log('            手机必须和这台电脑连同一个 WiFi 才能扫开。');
      console.log('            现场建议：带一个随身路由器，笔记本和观众手机都连它。');
      console.log('            要试公网隧道：启动预览-公网隧道.bat（国内手机多半打不开，');
      console.log('            trycloudflare 在普通移动网络上不可达）');
    }
  });
  /* 退出时把 cloudflared 一起带走。三条路都要挂：
   *   SIGINT/SIGTERM  Ctrl+C 或被 kill —— 能优雅收尾
   *   exit            正常退出的兜底
   *   uncaughtException  崩了也别留孤儿
   * 但**鼠标点掉窗口 X 这条路谁也拦不住**（Windows 直接终止进程，不给信号），
   * 所以还有 PID 文件 + 下次启动回收那一层。 */
  ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'].forEach((s) => {
    try { process.on(s, () => { killTunnel(); process.exit(0); }); } catch (e) {}
  });
  process.on('exit', killTunnel);
  process.on('uncaughtException', (e) => {
    console.error('[致命] ' + (e && e.stack || e));
    killTunnel();
    process.exit(1);
  });
}

module.exports = { server, sanitize, readAll, toCsv, csvCell, isLocal, canRead,
                   viaProxy, rateOk, tunnel,
                   dayKey, dayFile, DATA_DIR, FIELDS, ADMIN_TOKEN };
