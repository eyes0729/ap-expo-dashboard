/* ===========================================================================
 * 飞书多维表格的字段定义 + 「原始代码 → 人话」的映射
 * 建表脚本和同步脚本都从这里取，避免两边各写一份然后慢慢分叉。
 * ---------------------------------------------------------------------------
 * 为什么要映射：JSONL 里存的是 role='A' / shopify='yes' / gmv='>50k' 这种
 * 给程序看的代码。销售在表里跟进线索，看到 'A' 是没有意义的。
 * 映射只在同步时做，落盘那份保持原样（原始值才是可回溯的）。
 * =========================================================================== */

/* 多维表格字段类型：1 多行文本 / 3 单选 / 5 日期
 * 第一个字段是主字段，必须是文本类 —— 用凭证编号，它天然唯一。 */
const FIELDS = [
  { field_name: '凭证编号', type: 1 },
  { field_name: '作答时间', type: 5, property: { date_formatter: 'yyyy/MM/dd HH:mm', auto_fill: false } },
  { field_name: '身份',     type: 3, property: { options: [
      { name: '商家（跨境电商 / 品牌）' }, { name: '供应商（工厂 / 货源 / 贸易）' },
      { name: '服务商（广告 / 建站 / 物流 / 代运营）' } ] } },
  { field_name: '联系方式', type: 1 },
  /* 不用「电话号码」类型：现场留的可能是微信号，那个字段会校验格式把微信号挡掉 */
  { field_name: '奖项',     type: 3, property: { options: [
      { name: '免费 3 个 AP 来源订单' }, { name: '1v1 专家诊断' },
      { name: '定制帆布袋' }, { name: 'AP 定制扇子' } ] } },
  { field_name: '在用 Shopify', type: 3, property: { options: [
      { name: '是，正在运营' }, { name: '没有，主要做平台' }, { name: '计划做，还没上线' } ] } },
  { field_name: '月 GMV',   type: 3, property: { options: [
      { name: '< $5k' }, { name: '$5k – $10k' }, { name: '$10k – $50k' }, { name: '> $50k' } ] } },
  { field_name: '主营品类', type: 3, property: { options: [
      { name: '3C 电子' }, { name: '服装配饰' }, { name: '家居' },
      { name: '美妆个护' }, { name: '其他' } ] } },
  { field_name: '公司规模', type: 3, property: { options: [
      { name: '10 人以下' }, { name: '10 – 50 人' }, { name: '50 人以上' } ] } },
  /* ↓ 这两列是给销售用的，**同步永远不写这两列** —— 见 _sync-lark.js 的 SYNC_FIELDS */
  { field_name: '跟进状态', type: 3, property: { options: [
      { name: '待跟进' }, { name: '已联系' }, { name: '已加微信' },
      { name: '无效线索' }, { name: '已成交' } ] } },
  { field_name: '跟进备注', type: 1 },
  { field_name: '设备号',   type: 1 },
  { field_name: '入库时间', type: 5, property: { date_formatter: 'yyyy/MM/dd HH:mm', auto_fill: false } }
];

/* 同步只负责这些列。跟进状态 / 跟进备注**不在里面** ——
 * 重跑同步不能把销售填的跟进记录冲掉，这是这份表能用的前提。 */
const SYNC_FIELDS = ['凭证编号', '作答时间', '身份', '联系方式', '奖项',
                     '在用 Shopify', '月 GMV', '主营品类', '公司规模',
                     '设备号', '入库时间'];

const MAP = {
  role: { A: '商家（跨境电商 / 品牌）', B: '供应商（工厂 / 货源 / 贸易）',
          C: '服务商（广告 / 建站 / 物流 / 代运营）' },
  shopify: { yes: '是，正在运营', no: '没有，主要做平台', plan: '计划做，还没上线' },
  gmv: { '<5k': '< $5k', '5-10k': '$5k – $10k', '10-50k': '$10k – $50k', '>50k': '> $50k' },
  category: { '3c': '3C 电子', appare: '服装配饰', home: '家居',
              beauty: '美妆个护', other: '其他' },
  size: { '<10': '10 人以下', '10-50': '10 – 50 人', '>50': '50 人以上' }
};

/** 一条 JSONL 记录 → 多维表格的 fields 对象。
 *  空值**不写进去** —— 让它在表里保持为空，销售可以按「为空」筛，
 *  比塞一个「（未问）」的假选项干净。 */
function toFields(r) {
  const f = {};
  const put = (k, v) => { if (v !== undefined && v !== null && v !== '') f[k] = v; };
  put('凭证编号', r.ticket);
  if (r.ts)    f['作答时间'] = Number(r.ts);      /* 多维表格日期收毫秒时间戳 */
  if (r.srvTs) f['入库时间'] = Number(r.srvTs);
  put('身份', MAP.role[r.role]);
  put('联系方式', r.contact);
  put('奖项', r.prize);
  put('在用 Shopify', MAP.shopify[r.shopify]);
  put('月 GMV', MAP.gmv[r.gmv]);
  put('主营品类', MAP.category[r.category]);
  put('公司规模', MAP.size[r.size]);
  put('设备号', r.device);
  return f;
}

module.exports = { FIELDS, SYNC_FIELDS, MAP, toFields };
