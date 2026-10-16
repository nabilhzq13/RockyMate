/* Checks for the climber's movement, without a browser:
   1. Every technique example (src/holds.js): at each key and through each
      move, hands within arm's length (plus the shoulder lift), feet within
      leg's length, hands and feet never crossed, no hand on the head and no
      arm behind the head (the same tests as test/plan.js).
   2. The move timing (blendPose in src/app.js) on every move the planner makes
      on the benchmark routes: it starts and ends exactly on the held
      positions, never jumps, the hips lead on hand moves and the foot leads
      on foot moves.
     node test/moves.js */
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(ROOT,'src','app.js'),'utf8');
const grab=name=>{ const i=app.indexOf('function '+name+'('); if(i<0) throw new Error('no '+name); let d=0; for(let k=app.indexOf('{',i);k<app.length;k++){ if(app[k]==='{') d++; else if(app[k]==='}'&&!--d) return app.slice(i,k+1); } };
const F=new Function(['ik','bend3d','upperBody','elbowAt','reachJoint','chooseBody','ease','sameP','flagPos','blendPose'].map(grab).join('\n')+
  "\nvar bodyMemo=new Map(),LIMBS=['lh','rh','lf','rf'];return {upperBody,elbowAt,reachJoint,chooseBody,blendPose,flagPos,bodyMemo};")();
const M={}; new Function('m',fs.readFileSync(path.join(ROOT,'src','holds.js'),'utf8')+'\n'+fs.readFileSync(path.join(ROOT,'src','solver.js'),'utf8')+'\nm.DEMOS=DEMOS;m.solveBeta=solveBeta;m.buildBeta=buildBeta;')(M);
const H=170,TORSO=0.3*H,ARM=0.96*0.5*H;
let bad=0;
const fail=msg=>{ bad++; console.log('  ✗ '+msg); };
/* the figure at one pose: reach and head checks */
function checkPose(p,label){
  const b=p.body||F.chooseBody(p,H,TORSO,ARM),C=[p.C[0],p.C[1]-b.drop],B=F.upperBody(C,b.lean,H,TORSO),hd=B.head;
  const loc=Q=>[(Q[0]-hd[0])*B.across[0]+(Q[1]-hd[1])*B.across[1],(Q[0]-hd[0])*B.up[0]+(Q[1]-hd[1])*B.up[1]];
  for(const [kk,side] of [['lh',-1],['rh',1]]){
    const T=p[kk],d=Math.hypot(T[0]-B[kk][0],T[1]-B[kk][1]);
    if(d>ARM+0.05*H+0.5) fail(`${label}: ${kk} ${d.toFixed(1)} cm from the shoulder (max ${(ARM+0.05*H).toFixed(1)})`);
    const t=loc(T);
    if(Math.hypot(t[0]/(0.114*H),t[1]/((t[1]>0?0.15:0.126)*H))<0.8) fail(`${label}: ${kk} on the head`);
    const J=F.reachJoint(B[kk],T,ARM,H),E=F.elbowAt(J,T,side,H,ARM);
    for(const [a,c] of [[J,E],[E,T]]){
      const u=loc(a),v=loc(c),n=[u[0]/(0.104*H),u[1]/(0.116*H)],m=[v[0]/(0.104*H),v[1]/(0.116*H)];
      const dx=m[0]-n[0],dy=m[1]-n[1],l2=dx*dx+dy*dy,q=l2>0?Math.max(0,Math.min(1,-(n[0]*dx+n[1]*dy)/l2)):0;
      if(Math.hypot(n[0]+dx*q,n[1]+dy*q)<0.8&&n[0]*m[0]<0&&Math.min(Math.abs(n[0]),Math.abs(m[0]))>0.15) fail(`${label}: ${kk} arm behind the head`);
    }
  }
  for(const [kk,sd] of [['lf',-1],['rf',1]]){
    const T=p[kk]; if(!T) continue;
    const d=Math.hypot(T[0]-(C[0]+sd*0.07*H),T[1]+0.05*H-C[1]);
    if(d>0.52*H+0.5) fail(`${label}: ${kk} ${d.toFixed(1)} cm from the hip (max ${(0.52*H).toFixed(1)})`);
  }
  if(p.lh[0]>p.rh[0]+0.02*H) fail(`${label}: hands crossed`);
  if(p.lf&&p.rf&&p.lf[0]>p.rf[0]+0.03*H) fail(`${label}: feet crossed`);
  if(Math.abs(b.lean)>0.45) fail(`${label}: leans ${b.lean.toFixed(2)} rad`);
}
console.log('Technique examples');
for(const [ty,dm] of Object.entries(M.DEMOS)){
  const n0=bad;
  dm.keys.forEach((k,i)=>{ k.fixHip=true; checkPose(k,`${ty} key ${i}`); });
  for(let i=1;i<dm.keys.length;i++){
    const a=dm.keys[i-1],z=dm.keys[i];
    for(let s=1;s<20;s++){
      const p=F.blendPose(a,z,s/20,{H,sag:z.sag||0}),ba=F.chooseBody(a,H,TORSO,ARM),bz=F.chooseBody(z,H,TORSO,ARM);
      p.body={drop:0,lean:ba.lean+(bz.lean-ba.lean)*p.t};
      checkPose(p,`${ty} move ${i} at ${s*5}%`);
    }
  }
  console.log(`  ${ty.padEnd(10)} ${dm.keys.length} keys ${bad===n0?'ok':(bad-n0)+' problems'}`);
}
/* move timing on planner output */
console.log('Move timing on the benchmark routes');
const {load,V}=require('./harness.js');
const dir=process.env.RCC_DIR||path.join(__dirname,'data','rcc','datasets','orig_dataset_yolo');
(async()=>{
  const T={moves:0,hand:0,hipLead:0,foot:0,footLead:0,maxJump:0,endErr:0};
  if(fs.existsSync(dir)){
    const files=[]; for(const s of ['train','valid','test']) for(const f of fs.readdirSync(path.join(dir,s,'images'))) files.push([s,f]);
    files.sort((a,b)=>a[1]<b[1]?-1:1);
    for(const [s,f] of files.slice(0,10)){
      const img=await load(path.join(dir,s,'images',f)),I=V.prepare(img.rgba,img.w,img.h);
      const sug=V.suggest(I).slice(0,2);
      for(const m of sug){
        let r=V.classify(I,m,5,{}); const hs=r.blobs.filter(b=>b.status==='hold'); if(hs.length<3) continue;
        const k=img.h/420,holds=hs.map((b,i)=>({id:i,X:b.x/k,Y:(img.h-b.y)/k,r:b.r/k}));
        const res=M.solveBeta(holds,{H,feet:'open'}); if(!res.steps) continue;
        const beta=M.buildBeta(res,new Map(holds.map(h=>[h.id,{rCm:h.r,elong:1,angle:0}])));
        for(let i=1;i<beta.steps.length;i++){
          const a=beta.steps[i-1].pos,z=beta.steps[i].pos,limb=beta.steps[i].limb,dyn=(beta.steps[i].reach||0)>1;
          const o={H,dyn,bob:dyn?0.035*H:0},dist=Math.max(...['lh','rh','lf','rf'].map(q=>{ const A=a[q]||F.flagPos(q,a.C,H),Z=z[q]||F.flagPos(q,z.C,H); return Math.hypot(Z[0]-A[0],Z[1]-A[1]); }));
          const dur=Math.max(650,Math.min(1150,560+5*dist)),frames=Math.ceil(dur/16.7);
          T.moves++;
          let prev=F.blendPose(a,z,0,o);
          for(const q of ['lh','rh','lf','rf','C']){ const A=prev[q],Z=q==='C'?a.C:a[q]; if(A&&Z) T.endErr=Math.max(T.endErr,Math.hypot(A[0]-Z[0],A[1]-Z[1])); }
          for(let fr=1;fr<=frames;fr++){
            const p=F.blendPose(a,z,fr/frames,o);
            for(const q of ['lh','rh','lf','rf','C']) if(p[q]&&prev[q]) T.maxJump=Math.max(T.maxJump,Math.hypot(p[q][0]-prev[q][0],p[q][1]-prev[q][1]));
            prev=p;
          }
          for(const q of ['lh','rh','lf','rf','C']){ const A=prev[q],Z=q==='C'?z.C:z[q]; if(A&&Z) T.endErr=Math.max(T.endErr,Math.hypot(A[0]-Z[0],A[1]-Z[1])); }
          /* who leads at 30% of the move */
          const p3=F.blendPose(a,z,0.3,o),A=a[limb]||F.flagPos(limb,a.C,H),Z=z[limb]||F.flagPos(limb,z.C,H);
          const lp=Math.hypot(Z[0]-A[0],Z[1]-A[1])>1&&p3[limb]?((p3[limb][0]-A[0])*(Z[0]-A[0])+(p3[limb][1]-A[1])*(Z[1]-A[1]))/((Z[0]-A[0])**2+(Z[1]-A[1])**2):null;
          const cd=Math.hypot(z.C[0]-a.C[0],z.C[1]-a.C[1]),hp=cd>1?((p3.C[0]-a.C[0])*(z.C[0]-a.C[0])+(p3.C[1]-a.C[1])*(z.C[1]-a.C[1]))/(cd*cd):null;
          if(lp==null||hp==null) continue;
          if(limb[1]==='h'){ T.hand++; if(hp>lp) T.hipLead++; } else { T.foot++; if(lp>hp) T.footLead++; }
        }
      }
    }
    console.log(`  ${T.moves} moves: ends on the held positions (max error ${T.endErr.toFixed(3)} cm), biggest jump in one 60 fps frame ${T.maxJump.toFixed(1)} cm`);
    console.log(`  hips lead on ${T.hipLead} of ${T.hand} hand moves, the foot leads on ${T.footLead} of ${T.foot} foot moves`);
    if(T.endErr>0.01) fail('a move does not end on the held position');
    if(T.maxJump>12) fail('a limb jumps more than 12 cm in one frame');
    if(T.hipLead<T.hand||T.footLead<T.foot) fail('the hips or the foot do not lead');
  }else console.log('  (no benchmark photos: run test/make_media.sh)');
  console.log(bad?`\n${bad} problems`:'\nAll movement checks pass');
  process.exitCode=bad?1:0;
})();
