/* 两套实现必须逐字一致：Python 生成素材，JS 运行时点播。
   对不上就是运行时会去要一个从没生成过的片段。 */
const N = require('./cn-number.js');
const py = JSON.parse(require('fs').readFileSync('C:/Users/1/cosy/py_chunks.json','utf8'));
function chunks(n) {
  let t = N.toTokens(n).slice(), out = [], i = 0;
  while (i < t.length) {
    if ([...t[i]].length === 1 && i + 1 < t.length) { t[i+1] = t[i] + t[i+1]; i++; continue; }
    if ([...t[i]].length === 1 && out.length) { out[out.length-1] += t[i]; i++; continue; }
    out.push(t[i]); i++;
  }
  if (!out.length) out = [t.join('')];
  out[out.length-1] += '美元';
  return out;
}
let bad = 0, n = 0;
for (const [k, v] of Object.entries(py)) {
  n++;
  const got = chunks(+k);
  if (got.join('|') !== v.join('|')) {
    if (bad < 6) console.log('  ✗ ' + k + '  JS=' + got.join('+') + '   PY=' + v.join('+'));
    bad++;
  }
}
console.log(`对比 ${n} 个金额：${bad ? bad + ' 处不一致' : '全部一致'}`);
process.exit(bad ? 1 : 0);
