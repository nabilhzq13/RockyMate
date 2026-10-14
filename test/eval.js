/* Detection benchmark on real gym photos (run test/make_media.sh first).
   For each photo it taps the biggest labelled hold of each common colour, runs
   the matcher, and scores the result against the dataset's hold boxes.
     node test/eval.js              new matcher (src/vision.js)
     OLDMODE=1 node test/eval.js    v1 hue-only matcher, for comparison
     TOL=7 node test/eval.js        colour-match slider value 1-10 (default 5)
   Overlays go to test/out/overlays: bright = kept, red = right colour but wall,
   pink = rejected blob, amber = unsure; white/amber/red rings = hold/unsure/rejected. */
const {load,overlay,V}=require('./harness.js');
const OLD=require('./oldcore.js');
const fs=require('fs'),path=require('path');
const dir=process.env.RCC_DIR||path.join(__dirname,'data','rcc','datasets','orig_dataset_yolo');
const OUT=path.join(__dirname,'out','overlays'); fs.mkdirSync(OUT,{recursive:true});
const TOL=+(process.env.TOL||5);
(async()=>{
  const files=[];
  for(const s of ['train','valid','test']) for(const f of fs.readdirSync(path.join(dir,s,'images'))) files.push([s,f]);
  files.sort((a,b)=>a[1]<b[1]?-1:1);
  let tot={rec:0,recN:0,prec:0,precN:0,wc:0,wall:0};
  for(const [s,f] of files){
    const img=await load(path.join(dir,s,'images',f));
    const I=V.prepare(img.rgba,img.w,img.h);
    const lbl=fs.readFileSync(path.join(dir,s,'labels',f.replace(/\.jpg$/,'.txt')),'utf8').trim().split('\n').map(l=>l.split(' ').map(Number)).map(([c,cx,cy,bw,bh])=>({x:cx*img.w,y:cy*img.h,w:bw*img.w,h:bh*img.h}));
    // colour name of each label: median Lab over inner 40% box
    for(const b of lbl){ const Ls=[],As=[],Bs=[]; for(let y=Math.round(b.y-b.h*0.2);y<=b.y+b.h*0.2;y++) for(let x=Math.round(b.x-b.w*0.2);x<=b.x+b.w*0.2;x++){ if(x<0||y<0||x>=img.w||y>=img.h) continue; const i=y*img.w+x; Ls.push(I.L[i]);As.push(I.A[i]);Bs.push(I.B[i]); }
      const md=a=>a.sort((p,q)=>p-q)[a.length>>1]; b.lab=[md(Ls),md(As),md(Bs)]; b.name=V.nameOf(...b.lab).replace(/^dark /,''); b.chroma=Math.hypot(b.lab[1],b.lab[2]); }
    const byName={}; for(const b of lbl) if(b.chroma>18&&b.w*b.h>40) (byName[b.name]=byName[b.name]||[]).push(b);
    const names=Object.keys(byName).filter(n=>byName[n].length>=3).sort((a,b)=>byName[b].length-byName[a].length).slice(0,3);
    for(const nm of names){
      const tap=byName[nm].slice().sort((p,q)=>q.w*q.h-p.w*p.h)[0];
      const pk=V.pick(I,tap.x,tap.y);
      if(pk.error){ console.log(f.slice(0,6),nm,'pick error',pk.error); continue; }
      let res,holds,uns=[];
      if(process.env.OLDMODE){ const A=OLD.analyseData(img.rgba,img.w,img.h); const t=OLD.sampleColourAt(A,tap.x,tap.y); if(!t){ console.log('old: no colour'); continue; } holds=OLD.detectHolds(A,t,18); res={blobs:holds,mask:null}; }
      else { res=V.classify(I,pk.model,TOL,{mask:true}); const M2=V.refine(I,pk.model,res); res=V.classify(I,M2,TOL,{mask:true}); holds=res.blobs.filter(b=>b.status==='hold'); uns=res.blobs.filter(b=>b.status==='unsure'); }
      const inBox=(p,b)=>Math.abs(p.x-b.x)<=b.w/2+2&&Math.abs(p.y-b.y)<=b.h/2+2;
      const same=byName[nm];
      const rec=same.filter(b=>holds.some(p=>inBox(p,b))).length;
      const mm=pk.model.mean, mh=Math.atan2(mm[2],mm[1]), close=b=>{ const c=Math.hypot(b.lab[1],b.lab[2]); if(c<10) return false; let d=Math.abs(Math.atan2(b.lab[2],b.lab[1])-mh)*180/Math.PI; if(d>180) d=360-d; return d<25; };
      const prec=holds.filter(p=>lbl.some(b=>inBox(p,b)&&close(b))).length;
      const wrongCol=holds.filter(p=>lbl.some(b=>inBox(p,b))&&!lbl.some(b=>inBox(p,b)&&close(b))).length;
      const wall=holds.length-prec-wrongCol;
      tot.rec+=rec; tot.recN+=same.length; tot.wc+=wrongCol; tot.wall+=wall; tot.prec+=prec; tot.precN+=holds.length;
      const fp=holds.filter(p=>!lbl.some(b=>inBox(p,b))).map(p=>`(${p.x|0},${p.y|0} r${p.r|0} c${p.contrast} e${p.edge})`).join(' ');
      console.log(f.slice(0,6).padEnd(6),nm.padEnd(7),'model',pk.model.name.padEnd(10),'holds',String(holds.length).padStart(2),'unsure',uns.length,'| recall',rec+'/'+same.length,'| right colour',prec+'/'+holds.length,'wrong colour',wrongCol,'not a hold',wall);
      if(!process.env.OLDMODE) await overlay(img,res,path.join(OUT,f.slice(0,6).replace(/_.*/,'')+'_'+nm+'.png'),pk.model,[tap.x,tap.y]);
    }
  }
  console.log('wrong colour',tot.wc,'not a hold (wall/background)',tot.wall);
  console.log('TOTAL recall',tot.rec+'/'+tot.recN,(tot.rec/tot.recN*100).toFixed(0)+'%','precision(right colour)',tot.prec+'/'+tot.precN,(tot.prec/tot.precN*100).toFixed(0)+'%');
})();
