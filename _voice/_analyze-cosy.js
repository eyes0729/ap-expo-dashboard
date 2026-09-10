const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'cosy');
function read(f) {
  const b = fs.readFileSync(f);
  const ch = b.readUInt16LE(22), sr = b.readUInt32LE(24), bits = b.readUInt16LE(34);
  let off = 12, dOff = -1, dLen = 0;
  while (off < b.length - 8) {
    const id = b.toString('ascii', off, off+4), sz = b.readUInt32LE(off+4);
    if (id === 'data') { dOff = off+8; dLen = sz; break; }
    off += 8 + sz + (sz & 1);
  }
  const n = dLen / (ch * bits/8), m = new Float64Array(n);
  for (let i=0;i<n;i++){let s=0;for(let c=0;c<ch;c++)s+=b.readInt16LE(dOff+(i*ch+c)*2)/32768;m[i]=s/ch;}
  return { m, sr, ch, n };
}
console.log('文件'.padEnd(22),'总长','有声','采样率','峰值','静音头','削顶样本');
for (const f of fs.readdirSync(dir).filter(x=>x.endsWith('.wav')).sort()) {
  const { m, sr, ch, n } = read(path.join(dir,f));
  let peak=0, clip=0;
  for (let i=0;i<n;i++){const a=Math.abs(m[i]); if(a>peak)peak=a; if(a>0.999)clip++;}
  const thr=peak*0.02; let a0=0,b0=0;
  for(let i=0;i<n;i++) if(Math.abs(m[i])>thr){a0=i;break;}
  for(let i=n-1;i>=0;i--) if(Math.abs(m[i])>thr){b0=i;break;}
  console.log(f.padEnd(22),(n/sr).toFixed(2)+'s',((b0-a0)/sr).toFixed(2)+'s',
    sr+'/'+ch, (20*Math.log10(peak)).toFixed(1)+'dB',
    (a0/sr*1000).toFixed(0)+'ms', clip);
}
