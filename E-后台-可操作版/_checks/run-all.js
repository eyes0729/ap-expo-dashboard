/* ===========================================================================
 * 一条命令跑完全部验收
 *   cd "…\E-后台-可操作版\_checks" && node run-all.js
 * 前置：静态服务在跑
 *   cd "…\展会大屏播报" && node _serve.js        （8099）
 * ---------------------------------------------------------------------------
 * 为什么这些脚本从 %TEMP% 搬到了仓库里：它们是逐条需求的验收依据
 * （「趋势线在动」「四页不是假入口」「礼花盖得住地球」这些结论全靠它们），
 * 而 %TEMP% 随时会被清掉 —— 上个会话就是把它们留在 Temp 的。
 * =========================================================================== */
const { execFileSync } = require('child_process');
const path = require('path');

const SUITES = [
  ['ckFinal.js',      '前四轮全量回归（31 项）'],
  ['ckSpark.js',      'KPI 趋势线：在动 / 有面积 / 跟主题（19 项）'],
  ['ckPages.js',      '四个内页能打开且有内容'],
  ['ckLayout.js',     '四个内页的版面账（不溢出 / 不裁切）'],
  ['ckReal.js',       '假操作全局盘查（93 项）'],
  ['ckGlobeTheme.js', '全屏地球两套主题 / 星空 / 礼花覆盖'],
  ['ckQr.js',         '扫码全链路：编码→真解码→地址可达→手机填完问卷'],
  ['ckSurvey.js',     '问卷：首屏不露奖品 / 手动翻页 / 落库到服务端 + 读权限'],
  ['ckTunnel.js',     '公网隧道：手机能写 / 路人不能读（数据泄露回归）'],
  ['ckVoice.js',      '人声：整句预渲染 100% 覆盖 / 运行时不掉回 Huihui']
];

let failed = [];
for (const [f, desc] of SUITES) {
  console.log('\n' + '='.repeat(72));
  console.log('▶  ' + f + '   ' + desc);
  console.log('='.repeat(72));
  try {
    execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  } catch (e) {
    failed.push(f);
  }
}
console.log('\n' + '='.repeat(72));
if (failed.length) {
  console.log('✗  以下套件有失败项：' + failed.join(', '));
  process.exit(1);
}
console.log('✓  全部套件通过');
