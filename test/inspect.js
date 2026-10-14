/* Explain one detection: node test/inspect.js img13 red
   Taps the biggest labelled hold whose centre colour name contains the word,
   then prints every blob with its scores and the reason it was kept or dropped. */
const {load,V}=require('./harness.js');
const fs=require('fs'),path=require('path');
const dir=process.env.RCC_DIR||path.join(__dirname,'data','rcc','datasets','orig_dataset_yolo');
const [want,colour]=process.argv.slice(2);
if(!want||!colour){ console.log('Usage: node test/inspect.js <image prefix, e.g. img13> <colour word, e.g. red>'); process.exit(1); }
(async()=>{
  let f=null;
  for(const s of ['train','valid','test']) for(const x of fs.readdirSync(path.join(dir,s,'images'))) if(x.startsWith(want+'_')) f=path.join(dir,s,'images',x);
  if(!f){ console.log('No image starts with',want); return; }
  const img=await load(f),I=V.prepare(img.rgba,img.w,img.h);
  const lbl=fs.readFileSync(f.replace(/[\\/]images[\\/]/,path.sep+'labels'+path.sep).replace(/\.jpg$/,'.txt'),'utf8').trim().split('\n').map(l=>l.split(' ').map(Number)).map(([c,cx,cy,bw,bh])=>({x:cx*img.w,y:cy*img.h,w:bw*img.w,h:bh*img.h}));
  let best=null;
  for(const b of lbl){ const i=Math.round(b.y)*img.w+Math.round(b.x); if(V.nameOf(I.L[i],I.A[i],I.B[i]).includes(colour)&&(!best||b.w*b.h>best.w*best.h)) best=b; }
  if(!best){ console.log('No labelled hold looks',colour); return; }
  const pk=V.pick(I,best.x,best.y);
  if(pk.error){ console.log('Tap landed on the wall'); return; }
  const M=pk.model;
  console.log('model',M.name,'hue',M.hue.toFixed(0),'hueSd',M.hueSd.toFixed(1),'chroma',M.chroma.toFixed(1),'L',M.Llo.toFixed(0)+'-'+M.Lhi.toFixed(0),'wall ring',M.wall&&M.wall.map(v=>v.toFixed(1)).join(','));
  let res=V.classify(I,M,5,{}); res=V.classify(I,V.refine(I,M,res),5,{});
  const inBox=(p,b)=>Math.abs(p.x-b.x)<=b.w/2+2&&Math.abs(p.y-b.y)<=b.h/2+2;
  for(const b of res.blobs) console.log(b.status.padEnd(8),((b.x|0)+','+(b.y|0)).padEnd(8),'r',b.r.toFixed(1).padStart(5),'conf',b.conf.toFixed(2),'contrast',b.contrast,'edge',b.edge,'fill',b.fill,lbl.some(l=>inBox(b,l))?'on a labelled hold':'not a labelled hold',b.reason?'- '+b.reason:'');
})();
