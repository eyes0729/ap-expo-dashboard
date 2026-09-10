/* ===========================================================================
 * 一次性：在飞书里建一张「AP 展会问卷线索」多维表格
 *   node _lark-init.js              建表，把 app_token / table_id 写进 _lark.json
 *   node _lark-init.js --check      只检查 _lark.json 指向的表还在不在、字段对不对
 * ---------------------------------------------------------------------------
 * 用 useUAT（用户身份）建：这样表落在**你自己的**云文档里，打开飞书就看得见。
 * 用租户身份建的话表在应用的空间里，还得再单独授权，找都不好找。
 * 代价是同步脚本也得走用户身份 → 需要交互式 OAuth，跑不了无人值守的定时任务。
 * 对「展后同步一次」这个用法来说没问题 —— 而且本来就建议不做实时同步。
 *
 * ⚠ 建完之后**挂不进 wiki**：那一步要 wiki:wiki scope，这个凭证一直缺
 *   （报 99991672）。要放进知识库只能人工拖一下。
 * =========================================================================== */
const path = require('path');
const fs = require('fs');
const { LarkMCP } = require('C:/Users/1/Desktop/工作汇总/_mcp_client.js');
const { FIELDS } = require(path.join(__dirname, '_lark-schema-def.js'));

const CFG = path.join(__dirname, '_lark.json');
const BASE_NAME = 'AP 展会问卷线索';
const TABLE_NAME = '线索';

/* MCP 客户端的 call() 会把 {code,msg,data} 里的层级剥掉一部分，
 * 不同工具返回的形状不完全一致 —— 所以两种都试一遍，别假设。 */
const pick = (r, k) => (r && r[k]) || (r && r.data && r.data[k])
  || (r && r.app && r.app[k]) || (r && r.table && r.table[k]);

(async () => {
  const checkOnly = process.argv.includes('--check');
  const m = new LarkMCP();
  await m.start();
  console.log('已连接飞书 MCP');

  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch (e) {}

  if (cfg && cfg.app_token && cfg.table_id) {
    console.log('已有配置：' + CFG);
    console.log('  app_token = ' + cfg.app_token);
    console.log('  table_id  = ' + cfg.table_id);
    const got = await m.call('bitable_v1_appTableField_list', {
      path: { app_token: cfg.app_token, table_id: cfg.table_id },
      params: { page_size: 100 }, useUAT: true
    });
    const items = (got.items || (got.data && got.data.items) || []);
    const names = items.map((x) => x.field_name);
    console.log('  表上现有 ' + names.length + ' 个字段：' + names.join(' / '));
    const missing = FIELDS.map((f) => f.field_name).filter((n) => names.indexOf(n) < 0);
    if (missing.length) console.log('  ⚠ 缺字段：' + missing.join(' / '));
    else console.log('  ✓ 字段齐');
    m.stop(); process.exit(missing.length ? 1 : 0);
  }

  if (checkOnly) {
    console.log('X 还没有 ' + CFG + ' —— 先不带 --check 跑一次建表');
    m.stop(); process.exit(1);
  }

  console.log('\n建多维表格「' + BASE_NAME + '」…');
  const app = await m.call('bitable_v1_app_create', {
    data: { name: BASE_NAME, time_zone: 'Asia/Shanghai' }, useUAT: true
  });
  const app_token = pick(app, 'app_token');
  const url = pick(app, 'url') || ('https://feishu.cn/base/' + app_token);
  if (!app_token) {
    console.log('X 没拿到 app_token，原样返回：\n' + JSON.stringify(app).slice(0, 800));
    m.stop(); process.exit(1);
  }
  console.log('  app_token = ' + app_token);

  console.log('建数据表「' + TABLE_NAME + '」（' + FIELDS.length + ' 个字段）…');
  const tb = await m.call('bitable_v1_appTable_create', {
    path: { app_token },
    data: { table: { name: TABLE_NAME, default_view_name: '全部线索', fields: FIELDS } },
    useUAT: true
  });
  const table_id = pick(tb, 'table_id');
  if (!table_id) {
    console.log('X 没拿到 table_id，原样返回：\n' + JSON.stringify(tb).slice(0, 800));
    m.stop(); process.exit(1);
  }
  console.log('  table_id  = ' + table_id);

  /* 建 base 时飞书会自带一张空的「数据表」，我们自己那张才是要用的。
   * 不去删它 —— 删表是不可逆的，而它空着不碍事，人看一眼就知道用哪张。 */
  const list = await m.call('bitable_v1_appTable_list', {
    path: { app_token }, params: { page_size: 100 }, useUAT: true
  });
  const tables = (list.items || (list.data && list.data.items) || [])
    .map((x) => x.name + '(' + x.table_id + ')');
  console.log('  这个 base 里现在有 ' + tables.length + ' 张表：' + tables.join(', '));

  fs.writeFileSync(CFG, JSON.stringify({ app_token, table_id, url,
    base_name: BASE_NAME, table_name: TABLE_NAME }, null, 2) + '\n', 'utf8');
  console.log('\n✓ 配置写入 ' + CFG);
  console.log('✓ 打开看看： ' + url);
  console.log('\n下一步： node _sync-lark.js        （把 _data 里的记录同步上去）');
  console.log('注意：这张表挂不进 wiki 知识库（缺 wiki:wiki scope），要放进去得人工拖。');
  m.stop(); process.exit(0);
})().catch((e) => { console.log('X ' + e.message); process.exit(1); });
