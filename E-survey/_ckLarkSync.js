/* ===========================================================================
 * 飞书同步的验收。**不在 run-all.js 里** —— 它依赖飞书 MCP，而 MCP 不保证每次
 * 会话都挂着（没挂上时工具会整体消失且不报错），放进 run-all 会让基线时红时绿。
 *   node _ckLarkSync.js
 * ---------------------------------------------------------------------------
 * 要验的核心不是「能写进去」，是这三条：
 *   ① 幂等 —— 跑第二遍不重复插入、不产生无意义更新
 *   ② **不覆盖跟进列** —— 销售填的「跟进状态/备注」重跑同步之后还在。
 *      这条是这份表能不能用的前提：静默覆盖掉跟进记录，等发现时已经追不回来。
 *   ③ 真变化要跟上 —— 本地改了联系方式，同步要把它更新上去
 *
 * 写在一张**一次性表**里（名字带「可删」），不脏真正的「线索」表 ——
 * 这个凭证没有删记录/删表的接口，写进去就只能靠人去 UI 里删。
 * =========================================================================== */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const http = require('http');
const { LarkMCP } = require('C:/Users/1/Desktop/工作汇总/_mcp_client.js');
const { FIELDS, SYNC_FIELDS } = require(path.join(__dirname, '_lark-schema-def.js'));

const CFG = path.join(__dirname, '_lark.json');
const DATA_DIR = path.join(__dirname, '_data');
let bad = 0;
const ok = (c, m) => { console.log((c ? '  OK   ' : '  X    ') + m); if (!c) bad++; };
const sec = (t) => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 54 - t.length)));
const unwrap = (r) => (r && r.items) ? r : ((r && r.data) ? r.data : (r || {}));
const norm = (v) => v == null ? '' : (Array.isArray(v)
  ? v.map((x) => (x && x.text !== undefined ? x.text : x)).join('') : String(v));

function post(body) {
  return new Promise((res) => {
    const d = Buffer.from(JSON.stringify(body), 'utf8');
    const r = http.request({ host: 'localhost', port: 8099, path: '/api/survey', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': d.length } },
      (x) => { x.resume(); x.on('end', () => res(x.statusCode)); });
    r.on('error', () => res(0));
    r.write(d); r.end();
  });
}
const sync = (args) => {
  try {
    return execFileSync(process.execPath,
      [path.join(__dirname, '_sync-lark.js')].concat(args),
      { encoding: 'utf8', cwd: __dirname });
  } catch (e) { return (e.stdout || '') + (e.stderr || ''); }
};

(async () => {
  const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
  const before = fs.existsSync(DATA_DIR)
    ? fs.readdirSync(DATA_DIR).filter((f) => /\.jsonl$/.test(f)) : [];
  if (before.length) {
    console.log('X  _data 里已有 ' + before.length + ' 个文件。这个脚本会写测试记录，');
    console.log('   先把真实数据挪走再跑，别混在一起。');
    process.exit(1);
  }

  const m = new LarkMCP();
  await m.start();

  /* ── 一次性验收表 ── */
  sec('零、建一张一次性验收表');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const tname = '_验收用-可删-' + stamp;
  const tb = unwrap(await m.call('bitable_v1_appTable_create', {
    path: { app_token: cfg.app_token },
    data: { table: { name: tname, default_view_name: '全部', fields: FIELDS } }, useUAT: true }));
  const table_id = tb.table_id;
  ok(!!table_id, '建表成功：' + tname + ' (' + table_id + ')');
  if (!table_id) { m.stop(); process.exit(1); }
  const T = '--table=' + table_id;

  const read = async () => {
    const r = unwrap(await m.call('bitable_v1_appTableRecord_search', {
      path: { app_token: cfg.app_token, table_id }, params: { page_size: 500 },
      data: {}, useUAT: true }));
    const map = new Map();
    for (const it of (r.items || [])) {
      map.set(norm((it.fields || {})['凭证编号']), { id: it.record_id, f: it.fields || {} });
    }
    return map;
  };

  /* ── 造三条本地记录，走真接口落盘 ── */
  sec('一、造 3 条记录（走真的 POST /api/survey 落盘）');
  const now = Date.now();
  const recs = [
    { ts: now - 3000, device: 'DCK-A', ticket: 'AP-CK-A', role: 'A', roleName: '跨境电商卖家 / 品牌商家',
      shopify: 'yes', gmv: '>50k', contact: 'ck_a_13800000001', prize: '免费 3 个 AP 来源订单' },
    { ts: now - 2000, device: 'DCK-B', ticket: 'AP-CK-B', role: 'B', roleName: '供应商（工厂 / 货源 / 贸易）',
      category: '3c', contact: 'ck_b_wechat', prize: '定制帆布袋' },
    { ts: now - 1000, device: 'DCK-C', ticket: 'AP-CK-C', role: 'C', roleName: '服务商（广告 / 建站 / 物流 / 代运营等）',
      size: '10-50', contact: '', prize: 'AP 定制扇子' }
  ];
  let posted = 0;
  for (const r of recs) if (await post(r) === 200) posted++;
  ok(posted === 3, '3 条都通过 HTTP 接口落盘了（实际 ' + posted + '）');

  /* ── dry-run ── */
  sec('二、--dry-run 只算不写');
  const dry = sync([T, '--dry-run']);
  ok(/要新增 3 条/.test(dry), 'dry-run 算出要新增 3 条');
  const afterDry = await read();
  ok(afterDry.size === 0, 'dry-run 之后远端仍然是 0 条（真的没写）');

  /* ── 首次同步 ── */
  sec('三、首次同步');
  const s1 = sync([T]);
  ok(/新增 3 条/.test(s1), '报告新增 3 条');
  const r1 = await read();
  ok(r1.size === 3, '远端确实有 3 条（实际 ' + r1.size + '）');
  const a = r1.get('AP-CK-A');
  ok(!!a, '按凭证编号找得到 AP-CK-A');
  ok(a && norm(a.f['身份']).indexOf('商家') === 0, '代码 role=A 映射成人话：「' + norm(a && a.f['身份']) + '」');
  ok(a && norm(a.f['在用 Shopify']) === '是，正在运营', 'shopify=yes → 「是，正在运营」');
  ok(a && norm(a.f['月 GMV']) === '> $50k', 'gmv=">50k" → 「> $50k」');
  ok(a && norm(a.f['联系方式']) === 'ck_a_13800000001', '联系方式原样带上去');
  ok(a && !!a.f['作答时间'], '作答时间落到日期字段了');
  const c = r1.get('AP-CK-C');
  ok(c && norm(c.f['联系方式']) === '', '服务商没留联系方式 → 那格是空的（不是写「（未问）」）');
  ok(c && norm(c.f['在用 Shopify']) === '', '不属于该分支的字段留空，没有串味');

  /* ── 幂等 ── */
  sec('四、再跑一遍：不重复插、不乱更新');
  const s2 = sync([T]);
  ok(/要新增 0 条，要更新 0 条/.test(s2), '第二遍算出 0 新增 0 更新');
  const r2 = await read();
  ok(r2.size === 3, '远端还是 3 条，没被插成 6 条（实际 ' + r2.size + '）');
  ok([...r2.values()].every((x) => [...r1.values()].some((y) => y.id === x.id)),
     'record_id 没变（是同一批行，不是删了重建）');

  /* ── 最关键：跟进列不能被覆盖 ── */
  sec('五、销售填的跟进列，重跑同步之后还在');
  await m.call('bitable_v1_appTableRecord_update', {
    path: { app_token: cfg.app_token, table_id, record_id: a.id },
    data: { fields: { '跟进状态': '已加微信', '跟进备注': '约了周四演示，别覆盖我' } },
    useUAT: true });
  const r3 = await read();
  const a3 = r3.get('AP-CK-A');
  ok(norm(a3.f['跟进状态']) === '已加微信', '先模拟销售填上跟进状态');
  ok(/别覆盖我/.test(norm(a3.f['跟进备注'])), '并填上跟进备注');

  /* 同时让本地那条真的变一下，逼同步去写这一行 */
  const day = 'survey-' + new Date(recs[0].ts).toISOString().slice(0, 10) + '.jsonl';
  const fp = path.join(DATA_DIR, fs.readdirSync(DATA_DIR).filter((f) => /\.jsonl$/.test(f))[0]);
  const lines = fs.readFileSync(fp, 'utf8').split('\n').filter((x) => x.trim());
  const patched = lines.map((l) => {
    const o = JSON.parse(l);
    if (o.ticket === 'AP-CK-A') o.contact = 'ck_a_CHANGED';
    return JSON.stringify(o);
  });
  fs.writeFileSync(fp, patched.join('\n') + '\n', 'utf8');

  const s3 = sync([T]);
  ok(/要更新 1 条/.test(s3), '本地改了联系方式 → 同步算出要更新 1 条');
  ok(/更新 AP-CK-A：联系方式/.test(s3), '而且只认出「联系方式」这一个字段变了');
  const r4 = await read();
  const a4 = r4.get('AP-CK-A');
  ok(norm(a4.f['联系方式']) === 'ck_a_CHANGED', '真变化跟上了：联系方式已更新');
  ok(norm(a4.f['跟进状态']) === '已加微信', '**跟进状态没被抹掉**');
  ok(/别覆盖我/.test(norm(a4.f['跟进备注'])), '**跟进备注没被抹掉**');
  ok(r4.size === 3, '还是 3 条');

  /* ── 白名单本身 ── */
  sec('六、白名单是硬的');
  ok(SYNC_FIELDS.indexOf('跟进状态') < 0 && SYNC_FIELDS.indexOf('跟进备注') < 0,
     'SYNC_FIELDS 里没有那两列（不是靠「碰巧没写」）');
  ok(FIELDS.map((f) => f.field_name).filter((n) => SYNC_FIELDS.indexOf(n) < 0).join('/')
     === '跟进状态/跟进备注', '表上只有这两列不参与同步');

  /* ── 按天过滤 ── */
  sec('七、--date 过滤');
  const noSuch = sync([T, '--date=1999-01-01']);
  ok(/去重后 0 条|没有要同步的记录/.test(noSuch), '指定一个没数据的日子 → 0 条，不报错也不乱写');
  const r5 = await read();
  ok(r5.size === 3, '远端未受影响，仍是 3 条');

  console.log('\n' + '─'.repeat(60));
  console.log('验收表：' + tname);
  console.log('  ' + (cfg.url || '') + '   ← 这张表用完请到 UI 里删掉');
  console.log('  （这个凭证没有删记录 / 删表的接口，只能人工删）');
  m.stop();
  if (bad) { console.log('✗ ' + bad + ' 项未通过'); process.exit(1); }
  console.log('✓ 全部通过');
})().catch((e) => { console.log('X ' + e.message); process.exit(1); });
