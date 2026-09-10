const fs = require('fs');
function readWav(f) {
  const b = fs.readFileSync(f);
  const ch = b.readUInt16LE(22), sr = b.readUInt32LE(24), bits = b.readUInt16LE(34);
  let off = 12, dataOff = -1, dataLen = 0;
  while (off < b.length - 8) {
    const id = b.toString('ascii', off, off + 4), sz = b.readUInt32LE(off + 4);
    if (id === 'data') { dataOff = off + 8; dataLen = sz; break; }
    off += 8 + sz + (sz & 1);
  }
  const n = dataLen / (ch * bits / 8);
  const m = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0; for (let c = 0; c < ch; c++) s += b.readInt16LE(dataOff + (i * ch + c) * 2) / 32768;
    m[i] = s / ch;
  }
  return { m, sr, ch, bits, n };
}
console.log('文件'.padEnd(26), '总长', ' 有声', '  采样率  峰值');
for (const f of fs.readdirSync('.').filter(x => /^(line|num)/.test(x) && x.endsWith('.wav')).sort()) {
  const { m, sr, ch, n } = readWav(f);
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(m[i]));
  const thr = peak * 0.02;
  let a = 0, b2 = 0;
  for (let i = 0; i < n; i++) if (Math.abs(m[i]) > thr) { a = i; break; }
  for (let i = n - 1; i >= 0; i--) if (Math.abs(m[i]) > thr) { b2 = i; break; }
  console.log(f.padEnd(26), (n/sr).toFixed(2)+'s', ((b2-a)/sr).toFixed(2)+'s',
    ' '+sr+'Hz/'+ch+'ch', (20*Math.log10(peak)).toFixed(1)+'dB');
}
