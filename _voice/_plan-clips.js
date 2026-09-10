/* 算出「每个片段都 ≥2 字」的最小素材集。
   规则：单字 token 粘到后一个（末尾则粘前一个）；最后一个 token 追加「美元」。 */
const N = require('./cn-number.js');
function chunks(n) {
  let t = N.toTokens(n).slice();
  // 合并单字
  const out = [];
  for (let i = 0; i < t.length; i++) {
    if ([...t[i]].length === 1 && i + 1 < t.length) { t[i + 1] = t[i] + t[i + 1]; continue; }
    if ([...t[i]].length === 1 && out.length) { out[out.length - 1] += t[i]; continue; }
    out.push(t[i]);
  }
  if (!out.length) out.push(t.join(''));
  out[out.length - 1] += '美元';
  return out;
}
for (const [lo, hi, label] of [[300, 5000, '实际播报区间 $300–5,000'],
                               [1, 9999, '1–9,999'],
                               [1, 99999, '1–99,999']]) {
  const set = new Set();
  let maxChunks = 0, sample = null;
  for (let n = lo; n <= hi; n++) {
    const c = chunks(n);
    c.forEach(x => set.add(x));
    if (c.length > maxChunks) { maxChunks = c.length; sample = [n, c]; }
  }
  const short = [...set].filter(s => [...s].length < 2);
  console.log(`${label}: ${set.size} 个片段，最长一句 ${maxChunks} 段（例 ${sample[0]} → ${sample[1].join(' + ')}），单字片段 ${short.length} 个`);
}
const set = new Set();
for (let n = 1; n <= 99999; n++) chunks(n).forEach(x => set.add(x));
const list = [...set].sort((a,b)=>[...a].length-[...b].length || a.localeCompare(b,'zh'));
console.log('\n最短的 8 个：', list.slice(0,8).join(' '));
console.log('字数分布：', JSON.stringify([...list.reduce((m,s)=>{const k=[...s].length;m.set(k,(m.get(k)||0)+1);return m;},new Map())].sort((a,b)=>a[0]-b[0])));
console.log('\n示例：');
for (const n of [86, 300, 1005, 1050, 1280, 1286, 4520, 10500, 12800]) {
  console.log('  ' + String(n).padStart(6) + ' → ' + chunks(n).join(' + '));
}
