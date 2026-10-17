/* Real-size check: does the climber come out the right size?
   For every benchmark route (tapped the way test/eval.js does it) this finds
   the wall's floor and top edges with VisionCore.wallFrame(), works out the
   picture's scale the way the app does (src/app.js autoCal), and compares it
   with hand-checked edges (test/scale_truth.json).
     node test/scale.js            table + summary
     WALL=4.3 node test/scale.js   another wall height (only shifts the old guess)
   "size" is drawn size / true size: 1.00 = right, 1.60 = 60% too big.
   The old app took the whole picture as 4.2 m of wall. */
const {load,V}=require('./harness.js');
const fs=require('fs'),path=require('path');
const dir=process.env.RCC_DIR||path.join(__dirname,'data','rcc','datasets','orig_dataset_yolo');
const TRUTH=JSON.parse(fs.readFileSync(path.join(__dirname,'scale_truth.json'),'utf8')).lines;
const WALL=+(process.env.WALL||4.2)*100;
const at=(ln,u)=>ln?ln[0]+ln[1]*u:null;
(async()=>{
  const files=[]; for(const s of ['train','valid','test']) for(const f of fs.readdirSync(path.join(dir,s,'images'))) files.push([s,f]);
  files.sort((a,b)=>+a[1].match(/img(\d+)_/)[1]-+b[1].match(/img(\d+)_/)[1]);
  const rows=[],t0=Date.now(); let tf=0,nf=0;
  for(const [s,f] of files){
    const name=f.match(/(img\d+)_/)[1];
    const img=await load(path.join(dir,s,'images',f)),I=V.prepare(img.rgba,img.w,img.h);
    const lbl=fs.readFileSync(path.join(dir,s,'labels',f.replace(/\.jpg$/,'.txt')),'utf8').trim().split('\n').map(l=>l.split(' ').map(Number)).map(([c,cx,cy,bw,bh])=>({x:cx*img.w,y:cy*img.h,w:bw*img.w,h:bh*img.h}));
    for(const b of lbl){ const Ls=[],As=[],Bs=[]; for(let y=Math.round(b.y-b.h*0.2);y<=b.y+b.h*0.2;y++) for(let x=Math.round(b.x-b.w*0.2);x<=b.x+b.w*0.2;x++){ if(x<0||y<0||x>=img.w||y>=img.h) continue; const i=y*img.w+x; Ls.push(I.L[i]);As.push(I.A[i]);Bs.push(I.B[i]); }
      const md=a=>a.sort((p,q)=>p-q)[a.length>>1]; b.lab=[md(Ls),md(As),md(Bs)]; b.name=V.nameOf(...b.lab).replace(/^dark /,''); b.chroma=Math.hypot(b.lab[1],b.lab[2]); }
    const byName={}; for(const b of lbl) if(b.chroma>18&&b.w*b.h>40) (byName[b.name]=byName[b.name]||[]).push(b);
    const names=Object.keys(byName).filter(n=>byName[n].length>=3).sort((a,b)=>byName[b].length-byName[a].length).slice(0,3);
    for(const nm of names){
      const tap=byName[nm].slice().sort((p,q)=>q.w*q.h-p.w*p.h)[0];
      const pk=V.pick(I,tap.x,tap.y); if(pk.error) continue;
      const r1=V.classify(I,pk.model,5,{}),r2=V.classify(I,V.refine(I,pk.model,r1),5,{});
      const holds=r2.blobs.filter(b=>b.status==='hold'); if(holds.length<2) continue;
      const ts=Date.now(),fr=V.wallFrame(I,{W:pk.model.wall,holds:holds.map(b=>({x:b.x,y:b.y,r:b.r,ring:b.ring}))}); tf+=Date.now()-ts; nf++;
      const u=holds.reduce((a,b)=>a+b.x,0)/holds.length/img.w;
      const ln=q=>q?[q.c/img.h,q.m*img.w/img.h]:null;
      const fl=at(ln(fr.floor),u),tp=at(ln(fr.top),u);
      /* the app's rule (autoCal): both edges = exact; one edge = the other is
         at the picture's border; none = the whole picture is the wall */
      const F=fl!=null?fl:1,T=tp!=null?tp:0,src=fl!=null&&tp!=null?'edges':fl!=null?'floor':tp!=null?'top':'none';
      const est=(F-T)*img.h/WALL;
      const tr=TRUTH[name];
      const tF=tr?at(tr.floor,u):null,tT=tr?at(tr.top,u):null,both=tr&&tr.floor&&tr.top;
      const truth=both?(tF-tT)*img.h/WALL:null,old=img.h/WALL;
      rows.push({name,nm,src,fl,tp,tF,tT,size:truth?est/truth:null,oldSize:truth?old/truth:null,tr});
    }
  }
  const pc=v=>v==null?'   - ':(v*100).toFixed(1).padStart(5);
  console.log('photo  colour  found  floor (true)    top (true)   | size  old');
  for(const r of rows) console.log(r.name.padEnd(6),r.nm.padEnd(7),r.src.padEnd(5),pc(r.fl),'('+pc(r.tF)+')',pc(r.tp),'('+pc(r.tT)+')','|',r.size?r.size.toFixed(2):'  -  ',r.oldSize?r.oldSize.toFixed(2):'  - ');
  const withT=rows.filter(r=>r.size);
  const g=a=>Math.exp(a.reduce((s,v)=>s+Math.abs(Math.log(v)),0)/a.length);
  const within=(a,f)=>a.filter(v=>Math.max(v,1/v)<=f).length;
  const lineErr=k=>{ const e=rows.filter(r=>r[k==='fl'?'tF':'tT']!=null&&r[k]!=null).map(r=>Math.abs(r[k]-r[k==='fl'?'tF':'tT'])); return e.length?(e.reduce((a,b)=>a+b,0)/e.length*100).toFixed(1)+'% of the height over '+e.length:'-'; };
  const wrongSide=rows.filter(r=>r.tr&&((r.tr.top===null&&r.tp!=null)||(r.tr.floor===null&&r.fl!=null))).length;
  console.log(`\nroutes ${rows.length}: both edges found on ${rows.filter(r=>r.src==='edges').length}, floor only ${rows.filter(r=>r.src==='floor').length}, top only ${rows.filter(r=>r.src==='top').length}, none ${rows.filter(r=>r.src==='none').length}`);
  console.log(`mean line error: floor ${lineErr('fl')}, top ${lineErr('tp')}; edges reported that are not in the picture: ${wrongSide}`);
  console.log(`climber size on ${withT.length} routes with known edges: new off by x${g(withT.map(r=>r.size)).toFixed(3)} on average (within 5%: ${within(withT.map(r=>r.size),1.05)}, worst x${Math.max(...withT.map(r=>Math.max(r.size,1/r.size))).toFixed(2)}); old x${g(withT.map(r=>r.oldSize)).toFixed(3)} (within 5%: ${within(withT.map(r=>r.oldSize),1.05)}, worst x${Math.max(...withT.map(r=>Math.max(r.oldSize,1/r.oldSize))).toFixed(2)})`);
  console.log(`wallFrame: ${(tf/nf).toFixed(0)} ms per call at 640 px; total ${((Date.now()-t0)/1000).toFixed(1)} s`);
})();
