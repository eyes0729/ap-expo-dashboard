const fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'cosy');
function read(f){const b=fs.readFileSync(f);const ch=b.readUInt16LE(22),sr=b.readUInt32LE(24),bits=b.readUInt16LE(34);
let off=12,dO=-1,dL=0;while(off<b.length-8){const id=b.toString('ascii',off,off+4),sz=b.readUInt32LE(off+4);
if(id==='data'){dO=off+8;dL=sz;break;}off+=8+sz+(sz&1);}
const n=dL/(ch*bits/8),m=new Float64Array(n);
for(let i=0;i<n;i++){let s=0;for(let c=0;c<ch;c++)s+=b.readInt16LE(dO+(i*ch+c)*2)/32768;m[i]=s/ch;}
return {m,sr,n};}
const rows=[];
for(const f of fs.readdirSync(dir).filter(x=>x.startsWith('clip-')).sort()){
  const {m,sr,n}=read(path.join(dir,f));
  let sum=0,zc=0;
  for(let i=0;i<n;i++){sum+=m[i]*m[i];if(i&&(m[i]>=0)!==(m[i-1]>=0))zc++;}
  const rms=Math.sqrt(sum/n), dur=n/sr;
  const cent = n>1 ? zc/2/dur : 0;
  rows.push({f:f.replace('clip-','').replace('.wav',''),dur,rms,cent,n});
}
rows.sort((a,b)=>a.dur-b.dur);
console.log('片段  时长   RMS      过零重心   样本数   判定');
for(const r of rows){
  // 汉字单音节最短约 150ms；低于 120ms 基本不可能是完整音节
  const bad = r.dur < 0.12;
  const thin = !bad && r.dur < 0.20;
  console.log(
    r.f.padEnd(6),
    r.dur.toFixed(2)+'s',
    (20*Math.log10(r.rms||1e-9)).toFixed(1).padStart(6)+'dB',
    String(Math.round(r.cent)).padStart(6)+'Hz',
    String(r.n).padStart(7),
    bad ? '  ✗ 不可能是完整音节' : (thin ? '  ? 偏短' : ''));
}
const broken=rows.filter(r=>r.dur<0.12);
console.log('\n坏掉的：'+broken.length+' 个 → '+broken.map(r=>r.f).join(' '));
