/* Move-planner and climber-figure check on the benchmark photos (run
   test/make_media.sh first). For each photo it taps the biggest labelled hold
   of each common colour (like eval.js), plans the route for a 170 cm climber
   with the photo height taken as WALL cm of wall, and reports:
   - how many routes reach the top, and whether the strict technique pass did it
   - technique counts over all moves: crossed hands or feet, a foot above the
     hips, flagged feet, matched hands or feet
   - the climber drawing at every held position: big torso lean, a hand on the
     head, an arm crossing behind the head
     node test/plan.js                 WALL=420 (cm), feet rules
     WALL=300 FEET=open node test/plan.js
     OTHER=path/to/solver.js node test/plan.js   also report another planner's top count */
const {load,V}=require('./harness.js');
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const loadSolver=f=>{ const m={}; new Function('m',fs.readFileSync(f,'utf8')+'\nm.solveBeta=solveBeta;m.buildBeta=typeof buildBeta==="function"?buildBeta:null;')(m); return m; };
const NEW=loadSolver(path.join(ROOT,'src','solver.js')),OTHER=process.env.OTHER?loadSolver(process.env.OTHER):null;
/* the drawing's body search, taken from app.js */
const app=fs.readFileSync(path.join(ROOT,'src','app.js'),'utf8');
const grab=name=>{ const i=app.indexOf('function '+name+'('); let d=0; for(let k=app.indexOf('{',i);k<app.length;k++){ if(app[k]==='{') d++; else if(app[k]==='}'&&!--d) return app.slice(i,k+1); } };
const fig=new Function(['ik','bend3d','upperBody','elbowAt','chooseBody'].map(grab).join('\n')+'\nvar bodyMemo=new Map();return {upperBody,elbowAt,chooseBody,bodyMemo};')();
const dir=process.env.RCC_DIR||path.join(__dirname,'data','rcc','datasets','orig_dataset_yolo');
const WALL=+(process.env.WALL||420),FEET=process.env.FEET||'rules',H=170,TORSO=0.3*H;
(async()=>{
  const files=[];
  for(const s of ['train','valid','test']) for(const f of fs.readdirSync(path.join(dir,s,'images'))) files.push([s,f]);
  files.sort((a,b)=>a[1]<b[1]?-1:1);
  const T={routes:0,top:0,strictTop:0,otherTop:0,moves:0,handCross:0,footCross:0,footAboveHip:0,flags:0,handMatch:0,footMatch:0,held:0,bigLean:0,handOnHead:0,armBehind:0,ms:0};
  for(const [s,f] of files){
    const img=await load(path.join(dir,s,'images',f));
    const I=V.prepare(img.rgba,img.w,img.h);
    const lbl=fs.readFileSync(path.join(dir,s,'labels',f.replace(/\.jpg$/,'.txt')),'utf8').trim().split('\n').map(l=>l.split(' ').map(Number)).map(([c,cx,cy,bw,bh])=>({x:cx*img.w,y:cy*img.h,w:bw*img.w,h:bh*img.h}));
    for(const b of lbl){ const Ls=[],As=[],Bs=[]; for(let y=Math.round(b.y-b.h*0.2);y<=b.y+b.h*0.2;y++) for(let x=Math.round(b.x-b.w*0.2);x<=b.x+b.w*0.2;x++){ if(x<0||y<0||x>=img.w||y>=img.h) continue; const i=y*img.w+x; Ls.push(I.L[i]);As.push(I.A[i]);Bs.push(I.B[i]); }
      const md=a=>a.sort((p,q)=>p-q)[a.length>>1]; b.lab=[md(Ls),md(As),md(Bs)]; b.name=V.nameOf(...b.lab).replace(/^dark /,''); b.chroma=Math.hypot(b.lab[1],b.lab[2]); }
    const byName={}; for(const b of lbl) if(b.chroma>18&&b.w*b.h>40) (byName[b.name]=byName[b.name]||[]).push(b);
    const names=Object.keys(byName).filter(n=>byName[n].length>=3).sort((a,b)=>byName[b].length-byName[a].length).slice(0,3);
    for(const nm of names){
      const tap=byName[nm].slice().sort((p,q)=>q.w*q.h-p.w*p.h)[0];
      const pk=V.pick(I,tap.x,tap.y); if(pk.error) continue;
      let res=V.classify(I,pk.model,5,{}); res=V.classify(I,V.refine(I,pk.model,res),5,{});
      const holds=res.blobs.filter(b=>b.status==='hold'); if(holds.length<2) continue;
      const k=img.h/WALL,hs=holds.map((b,i)=>({id:i,X:b.x/k,Y:(img.h-b.y)/k,r:b.r/k}));
      T.routes++;
      const t0=Date.now(),r=NEW.solveBeta(hs,{H,feet:FEET}); T.ms+=Date.now()-t0;
      if(OTHER&&OTHER.solveBeta(hs,{H,feet:FEET}).ok) T.otherTop++;
      if(!r.steps) continue;
      if(r.ok){ T.top++; if(r.strict) T.strictTop++; }
      const P=r.pts,line=[];
      for(const st of r.steps.slice(1)){
        T.moves++;
        if(st.lh!==st.rh&&P[st.lh].X>P[st.rh].X+0.02*H) T.handCross++;
        if(st.lf>=0&&st.rf>=0&&st.lf!==st.rf&&P[st.lf].X>P[st.rf].X+0.03*H) T.footCross++;
        for(const ft of [st.lf,st.rf]) if(ft>=0&&P[ft].Y>st.C[1]) T.footAboveHip++;
        if(st.lf<0||st.rf<0) T.flags++;
        if(st.move.limb[1]==='h'&&st.lh===st.rh) T.handMatch++;
        if(st.move.limb[1]==='f'&&st.lf>=0&&st.lf===st.rf) T.footMatch++;
      }
      /* the figure at each held position */
      const beta=NEW.buildBeta(r,new Map(hs.map(h=>[h.id,{rCm:h.r,elong:1,angle:0}])));
      for(const [i,st] of beta.steps.entries()){
        const p=st.pos; fig.bodyMemo.clear();
        const b=fig.chooseBody(p,H,TORSO),B=fig.upperBody([p.C[0],p.C[1]-b.drop],b.lean,H,TORSO),hd=B.head;
        const loc=Q=>[(Q[0]-hd[0])*B.across[0]+(Q[1]-hd[1])*B.across[1],(Q[0]-hd[0])*B.up[0]+(Q[1]-hd[1])*B.up[1]];
        T.held++;
        if(Math.abs(b.lean)>0.45){ T.bigLean++; line.push(`step ${i} leans ${b.lean.toFixed(2)}`); }
        for(const [kk,side] of [['lh',-1],['rh',1]]){
          const t=loc(p[kk]);
          if(Math.hypot(t[0]/(0.114*H),t[1]/((t[1]>0?0.15:0.126)*H))<0.8){ T.handOnHead++; line.push(`step ${i} ${kk} on the head`); }
          const J=B[kk],E=fig.elbowAt(J,p[kk],side,H);
          for(const [a,c] of [[J,E],[E,p[kk]]]){
            const u=loc(a),v=loc(c),n=[u[0]/(0.104*H),u[1]/(0.116*H)],m=[v[0]/(0.104*H),v[1]/(0.116*H)];
            const dx=m[0]-n[0],dy=m[1]-n[1],l2=dx*dx+dy*dy,q=l2>0?Math.max(0,Math.min(1,-(n[0]*dx+n[1]*dy)/l2)):0;
            if(Math.hypot(n[0]+dx*q,n[1]+dy*q)<0.8&&n[0]*m[0]<0&&Math.min(Math.abs(n[0]),Math.abs(m[0]))>0.15){ T.armBehind++; line.push(`step ${i} ${kk} arm behind the head`); }
          }
        }
      }
      console.log(f.slice(0,6).padEnd(6),nm.padEnd(7),'holds',String(hs.length).padStart(2),r.ok?(r.strict?'top (strict)':'top (relaxed)'):'stuck','moves',r.steps.length-1,line.length?'| '+line.join('; '):'');
    }
  }
  console.log(`\nWALL ${WALL} cm, feet ${FEET}: ${T.routes} routes, top ${T.top} (strict ${T.strictTop})${OTHER?`, other planner top ${T.otherTop}`:''}, ${T.ms} ms planning`);
  console.log(`moves ${T.moves}: crossed hands ${T.handCross}, crossed feet ${T.footCross}, foot above hips ${T.footAboveHip}, flags ${T.flags}, matched hands ${T.handMatch}, matched feet ${T.footMatch}`);
  console.log(`figure at ${T.held} held positions: lean over 0.45 rad ${T.bigLean}, hand on the head ${T.handOnHead}, arm behind the head ${T.armBehind}`);
})();
