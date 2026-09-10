/* 验一遍：WAV 头合法、有声音、峰值一致、频谱重心落在设计目标区间 */
const fs = require('fs');
for (const f of fs.readdirSync(__dirname).filter(x => x.endsWith('.wav')).sort()) {
  const b = fs.readFileSync(f);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') {
    console.log(f, 'BAD HEADER'); continue;
  }
  const ch = b.readUInt16LE(22), sr = b.readUInt32LE(24), bits = b.readUInt16LE(34);
  let off = 12, dataOff = -1, dataLen = 0;
  while (off < b.length - 8) {
    const id = b.toString('ascii', off, off + 4), sz = b.readUInt32LE(off + 4);
    if (id === 'data') { dataOff = off + 8; dataLen = sz; break; }
    off += 8 + sz + (sz & 1);
  }
  const n = dataLen / (ch * bits / 8);
  const mono = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += b.readInt16LE(dataOff + (i * ch + c) * 2) / 32768;
    mono[i] = s / ch;
  }
  let peak = 0, sum = 0, zc = 0;
  for (let i = 0; i < n; i++) { peak = Math.max(peak, Math.abs(mono[i])); sum += mono[i] * mono[i];
    if (i && (mono[i] >= 0) !== (mono[i - 1] >= 0)) zc++; }
  const rms = Math.sqrt(sum / n);
  /* 过零率 → 粗略的频谱重心 */
  const centroid = zc / 2 / (n / sr);
  /* 起音时间：首次达到峰值 50% 的位置 */
  let atk = 0; for (let i = 0; i < n; i++) if (Math.abs(mono[i]) > peak * 0.5) { atk = i / sr; break; }
  /* 尾巴：最后一次超过峰值 1% 的位置 */
  let tail = 0; for (let i = n - 1; i >= 0; i--) if (Math.abs(mono[i]) > peak * 0.01) { tail = i / sr; break; }
  console.log(
    f.padEnd(22),
    (n / sr).toFixed(2) + 's',
    ch + 'ch/' + sr + 'Hz/' + bits + 'bit',
    '峰值 ' + (20 * Math.log10(peak)).toFixed(1) + 'dB',
    'RMS ' + (20 * Math.log10(rms)).toFixed(1) + 'dB',
    '重心≈' + centroid.toFixed(0) + 'Hz',
    '起音 ' + (atk * 1000).toFixed(0) + 'ms',
    '有效时长 ' + tail.toFixed(2) + 's'
  );
}
