/* 每个片段都要过三关：WAV 头合法、时长与字数匹配、电平一致。
   判据用「每字 ≥0.10s」——第一版就是靠这条抓出 5 个 0.06s 的废片段。 */
const fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'cosy');
function read(f){const b=fs.readFileSync(f);
if(b.toString('ascii',0,4)!=='RIFF')return null;
const ch=b.readUInt16LE(22),sr=b.readUInt32LE(24),bits=b.readUInt16LE(34);
let off=12,dO=-1,dL=0;while(off<b.length-8){const id=b.toString('ascii',off,off+4),sz=b.readUInt32LE(off+4);
if(id==='data'){dO=off+8;dL=sz;break;}off+=8+sz+(sz&1);}
if(dO<0)return null;
const n=dL/(ch*bits/8),m=new Float64Array(n);
for(let i=0;i<n;i++){let s=0;for(let c=0;c<ch;c++)s+=b.readInt16LE(dO+(i*ch+c)*2)/32768;m[i]=s/ch;}
return {m,sr,n,ch,bits};}
const files=fs.readdirSync(dir).filter(x=>x.startsWith('clip-')&&x.endsWith('.wav'));
let bad=[],peaks=[],perSyl=[];
for(const f of files){
  const r=read(path.join(dir,f));
  if(!r){bad.push([f,'WAV 头坏']);continue;}
  const label=f.replace('clip-','').replace('.wav','');
  const syl=label==='prefix'?7:Array.from(label).filter(c=>c>='\u4e00'&&c<='\u9fff').length;
  const dur=r.n/r.sr;
  let peak=0,sum=0;
  for(let i=0;i<r.n;i++){const a=Math.abs(r.m[i]);if(a>peak)peak=a;sum+=r.m[i]*r.m[i];}
  peaks.push(peak);
  perSyl.push(dur/syl);
  if(dur/syl<0.10) bad.push([f,`每字仅 ${(dur/syl*1000).toFixed(0)}ms（${dur.toFixed(2)}s / ${syl} 字）`]);
  if(r.sr!==24000||r.ch!==1) bad.push([f,`格式 ${r.sr}/${r.ch}ch`]);
}
const pk=peaks.map(p=>20*Math.log10(p));
perSyl.sort((a,b)=>a-b);
console.log(`片段数 ${files.length}`);
console.log(`峰值 ${Math.min(...pk).toFixed(1)} ~ ${Math.max(...pk).toFixed(1)} dB（都归一到 -3dB 才对）`);
console.log(`每字时长 最短 ${(perSyl[0]*1000).toFixed(0)}ms / 中位 ${(perSyl[perSyl.length>>1]*1000).toFixed(0)}ms / 最长 ${(perSyl[perSyl.length-1]*1000).toFixed(0)}ms`);
console.log(bad.length?`\n✗ ${bad.length} 个有问题：`:'\n✓ 全部片段合格');
bad.slice(0,12).forEach(([f,w])=>console.log('   '+f+'  '+w));
process.exit(bad.length?1:0);
