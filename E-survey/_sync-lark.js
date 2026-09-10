/* ===========================================================================
 * 把 _data/*.jsonl 同步进飞书多维表格
 *   node _sync-lark.js                    全部
 *   node _sync-lark.js --date=2026-08-21  只同步某一天
 *   node _sync-lark.js --dry-run          只算不写，先看清要动什么
 *   node _sync-lark.js --table=tblXXXX    写到指定表（验收用）
 * ---------------------------------------------------------------------------
 * 幂等键是**凭证编号**。跑第二遍不会重复插入，只会把变了的字段补上。
 *
 * ⚠ 最重要的一条：**同步永不写「跟进状态」和「跟进备注」**。
 *   那两列是销售在表里填的。如果同步一并覆盖，第二次跑就把人家的跟进记录抹了 ——
 *   而且是静默抹掉，等发现时已经追不回来。白名单在 _lark-schema-def.js 的 SYNC_FIELDS。
 *
 * ⚠ 走用户身份（useUAT）。所以这个脚本**需要人在场**（OAuth），
 *   跑不了无人值守的定时任务 —— 本来也建议展后手动跑一次，不做实时同步：
 *   实时等于把现场链路绑上外网，风险换来的只是「早几个小时看到」。
 * =========================================================================== */
const path = require('path');
const fs = require('fs');
const { LarkMCP } = require('C:/Users/1/Desktop/工作汇总/_mcp_client.js');
const { SYNC_FIELDS, toFields } = require(path.join(__dirname, '_lark-schema-def.js'));

const CFG = path.join(__dirname, '_lark.json');
const DATA_DIR = path.join(__dirname, '_data');

const argOf = (k) => {
  const a = process.argv.find((x) => x.indexOf('--' + k + '=') === 0);
  return a ? a.split('=').slice(1).join('=') : '';
};
const DRY = process.argv.includes('--dry-run');
const DATE = argOf('date');

/* ── 读本地 ─────────────────────────────────────────────────────────────
 * 和 _serve.js 的 readAll 同一套规则：按 device+ts 去重（补传会产生重复行）、
 * 坏行跳过不让一行毁掉一天。这里再按凭证编号收一次，因为凭证编号是上行的幂等键。 */
function readLocal() {
  let files = [];
  try {
    files = fs.readdirSync(DATA_DIR)
      .filter((f) => /^survey-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .filter((f) => !DATE || f === 'survey-' + DATE + '.jsonl')
      .sort();
  } catch (e) { return { rows: [], files: [], badLines: 0 }; }
  const seen = new Set(), byTicket = new Map();
  let badLines = 0;
  for (const f of files) {
    let txt = '';
    try { txt = fs.readFileSync(path.join(DATA_DIR, f), 'utf8'); } catch (e) { continue; }
    for (const line of txt.split('\n')) {
      if (!line.trim()) continue;
      let r; try { r = JSON.parse(line); } catch (e) { badLines++; continue; }
      const k = r.device + '|' + r.ts;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!r.ticket) { badLines++; continue; }
      /* 同一凭证号出现两次（理论上不该有）时保留 ts 更早的那条 —— 那是本人第一次作答 */
      const old = byTicket.get(r.ticket);
      if (!old || r.ts < old.ts) byTicket.set(r.ticket, r);
    }
  }
  return { rows: [...byTicket.values()].sort((a, b) => a.ts - b.ts), files, badLines };
}

/* ── 读远端 ─────────────────────────────────────────────────────────── */
const unwrap = (r) => (r && r.items) ? r : ((r && r.data) ? r.data : (r || {}));
/** 多维表格的文本字段有时回一个字符串，有时回 [{type,text}] 富文本段 —— 都归一成字符串 */
function norm(v) {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.map((x) => (x && (x.text !== undefined ? x.text : x))).join('');
  if (typeof v === 'object') return String(v.text !== undefined ? v.text : JSON.stringify(v));
  return String(v);
}
async function readRemote(m, app_token, table_id) {
  const out = new Map();
  let token = '', guard = 0;
  do {
    const params = { page_size: 500 };
    if (token) params.page_token = token;
    const r = unwrap(await m.call('bitable_v1_appTableRecord_search', {
      path: { app_token, table_id }, params,
      data: { field_names: SYNC_FIELDS }, useUAT: true
    }));
    for (const it of (r.items || [])) {
      const t = norm((it.fields || {})['凭证编号']);
      if (t) out.set(t, { record_id: it.record_id, fields: it.fields || {} });
    }
    token = r.has_more ? r.page_token : '';
  } while (token && ++guard < 50);
  return out;
}

/** 本地这条和远端那条在**同步字段**上有差别吗（跟进列不参与比较） */
function diffOf(want, have) {
  const changed = [];
  for (const k of Object.keys(want)) {
    if (SYNC_FIELDS.indexOf(k) < 0) continue;          /* 防手滑：白名单外一律不比不写 */
    if (norm(want[k]) !== norm(have[k])) changed.push(k);
  }
  return changed;
}

(async () => {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(CFG, 'utf8')); }
  catch (e) { console.log('X 没有 _lark.json —— 先跑 node _lark-init.js 建表'); process.exit(1); }
  const table_id = argOf('table') || cfg.table_id;

  const local = readLocal();
  console.log('本地：' + local.files.length + ' 个文件，去重后 ' + local.rows.length + ' 条'
    + (local.badLines ? '（跳过 ' + local.badLines + ' 个坏行/无凭证号）' : '')
    + (DATE ? '　[只看 ' + DATE + ']' : ''));
  if (!local.rows.length) { console.log('没有要同步的记录。'); process.exit(0); }

  const m = new LarkMCP();
  await m.start();
  const remote = await readRemote(m, cfg.app_token, table_id);
  console.log('远端：表 ' + table_id + ' 已有 ' + remote.size + ' 条');

  const toCreate = [], toUpdate = [];
  for (const r of local.rows) {
    const want = toFields(r);
    const have = remote.get(r.ticket);
    if (!have) { toCreate.push({ r, want }); continue; }
    const changed = diffOf(want, have.fields);
    if (changed.length) toUpdate.push({ r, want, record_id: have.record_id, changed });
  }
  console.log('要新增 ' + toCreate.length + ' 条，要更新 ' + toUpdate.length + ' 条，'
    + '其余 ' + (local.rows.length - toCreate.length - toUpdate.length) + ' 条无变化');
  toUpdate.slice(0, 8).forEach((u) =>
    console.log('   更新 ' + u.r.ticket + '：' + u.changed.join(', ')));

  if (DRY) {
    console.log('\n--dry-run，什么都没写。');
    m.stop(); process.exit(0);
  }

  let okC = 0, okU = 0, fail = 0;
  for (const c of toCreate) {
    try {
      await m.call('bitable_v1_appTableRecord_create', {
        path: { app_token: cfg.app_token, table_id }, data: { fields: c.want }, useUAT: true });
      okC++;
    } catch (e) { fail++; console.log('   X 新增 ' + c.r.ticket + '：' + e.message.slice(0, 160)); }
  }
  for (const u of toUpdate) {
    try {
      /* 只发变了的那几个字段，连没变的同步列都不重发 —— 少一次写就少一次覆盖的机会 */
      const patch = {};
      u.changed.forEach((k) => { patch[k] = u.want[k]; });
      await m.call('bitable_v1_appTableRecord_update', {
        path: { app_token: cfg.app_token, table_id, record_id: u.record_id },
        data: { fields: patch }, useUAT: true });
      okU++;
    } catch (e) { fail++; console.log('   X 更新 ' + u.r.ticket + '：' + e.message.slice(0, 160)); }
  }

  console.log('\n新增 ' + okC + ' 条 · 更新 ' + okU + ' 条'
    + (fail ? ' · **失败 ' + fail + ' 条**' : ''));
  console.log('表： ' + (cfg.url || '') + '  （跟进状态 / 跟进备注两列同步从不写，放心填）');
  m.stop();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('X ' + e.message); process.exit(1); });
