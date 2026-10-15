function solveBeta(holds,o){
  function circInt(a,b){
    const dx=b[0]-a[0],dy=b[1]-a[1],d=Math.hypot(dx,dy);
    if(d===0||d>a[2]+b[2]||d<Math.abs(a[2]-b[2])) return null;
    const l=(a[2]*a[2]-b[2]*b[2]+d*d)/(2*d),hh=Math.sqrt(Math.max(0,a[2]*a[2]-l*l));
    const mx=a[0]+dx*l/d,my=a[1]+dy*l/d;
    return [[mx-dy*hh/d,my+dx*hh/d],[mx+dy*hh/d,my-dx*hh/d]];
  }
  /* Body from height H. Arm reach from the shoulder point is half the arm
     span (span = H unless the user gives theirs). Only if the route can't be
     finished within that, a last pass lets a hand go up to 6% further, as a
     deadpoint does, at a steep cost. */
  const H=o.H,span=o.span>0?o.span:H,ARM=Math.max(0.42*H,Math.min(0.62*H,0.5*H+(span-H)/2)),LEG=0.56*H,TORSO=0.3*H;
  let ARMX=ARM;
  /* Wall angle in degrees (+ overhang, - slab); coordinates are along the
     wall. Overhangs keep the feet higher (body tension) and make every hand
     move harder; slabs put the weight on the feet and allow high steps. */
  const ang=o.angle||0,steep=Math.max(0,Math.min(1,ang/45)),slab=Math.max(0,Math.min(1,-ang/20));
  const GAP=(0.7-0.2*steep)*H,UNDER=(0.3-0.1*steep-0.1*slab)*H,HANDK=1+0.5*steep-0.3*slab;
  const pts=holds.map(h=>({X:h.X,Y:h.Y,r:h.r,kind:'hold',id:h.id}));
  const nHold=pts.length;
  if(nHold<2) return {ok:false,reason:'few'};
  let top=-1;
  if(o.topId!=null) top=pts.findIndex(p=>p.id===o.topId);
  if(top<0){
    /* The finish is the highest hold you can chain to from the low holds,
       so a stray match on the ceiling never becomes the "top". */
    const reach=new Uint8Array(nHold),stack=[];
    for(let i=0;i<nHold;i++) if(pts[i].Y<=1.3*H){ reach[i]=1; stack.push(i); }
    while(stack.length){ const i=stack.pop(); for(let j=0;j<nHold;j++) if(!reach[j]&&Math.hypot(pts[i].X-pts[j].X,pts[i].Y-pts[j].Y)<=1.1*H){ reach[j]=1; stack.push(j); } }
    for(let i=0;i<nHold;i++) if(reach[i]&&(top<0||pts[i].Y>pts[top].Y)) top=i;
    if(top<0){ top=0; for(let i=1;i<nHold;i++) if(pts[i].Y>pts[top].Y) top=i; }
  }
  const topY=pts[top].Y;
  let minX=Infinity,maxX=-Infinity;
  for(let i=0;i<nHold;i++){ if(pts[i].X<minX) minX=pts[i].X; if(pts[i].X>maxX) maxX=pts[i].X; }
  if(o.feet==='open'){
    const step=0.14*H;
    for(let y=0.12*H;y<topY-0.3*H;y+=step) for(let x=minX-0.3*H;x<=maxX+0.3*H;x+=step){
      let clash=false;
      for(let i=0;i<nHold;i++) if(Math.hypot(pts[i].X-x,pts[i].Y-y)<pts[i].r+12){ clash=true; break; }
      if(!clash) pts.push({X:x,Y:y,r:0,kind:'smear'});
    }
  }
  const nFoot=pts.length,floor0=pts.length;
  for(let x=minX-0.5*H;x<=maxX+0.5*H;x+=0.06*H) pts.push({X:x,Y:0,r:0,kind:'floor'});
  const isFloor=i=>i>=floor0;
  const key4=(a,b,c,d)=>((a*1024+b)*1024+(c+1))*1024+(d+1);

  const memo=new Map();
  /* Where the hips can be for a set of contacts, and how comfortable that is.
     Technique rules from coaching sources: hips over the feet, feet low
     (about knee height or below, not near the hands), a stance about hip to
     shoulder width, arms long, and no arm reaching across the body. */
  function pose(lh,rh,lf,rf){
    const key=key4(lh,rh,lf,rf);
    if(memo.has(key)) return memo.get(key);
    const A=pts[lh],B=pts[rh],D=[[A.X,A.Y-TORSO,ARMX],[B.X,B.Y-TORSO,ARMX]];
    let fx=0,fy=0,nf=0,minFY=Infinity,maxFY=-Infinity;
    const feet=[];
    if(lf>=0){ const F=pts[lf]; D.push([F.X,F.Y,LEG]); fx+=F.X; fy+=F.Y; nf++; feet.push(F); }
    if(rf>=0){ const F=pts[rf]; D.push([F.X,F.Y,LEG]); fx+=F.X; fy+=F.Y; nf++; feet.push(F); }
    for(const F of feet){ minFY=Math.min(minFY,F.Y); maxFY=Math.max(maxFY,F.Y); }
    let res=null;
    if(nf>0){
      const hx=(A.X+B.X)/2,fcx=fx/nf;
      const ix=(hx+fcx*1.5)/2.5;
      let iy=fy/nf+0.46*H;
      const cap=Math.min(A.Y,B.Y)-TORSO+0.04*H; if(iy>cap) iy=cap;
      const C=[[ix,iy]];
      for(const d of D){ const dx=ix-d[0],dy=iy-d[1],dd=Math.hypot(dx,dy); if(dd>d[2]) C.push([d[0]+dx/dd*d[2],d[1]+dy/dd*d[2]]); }
      for(let i=0;i<D.length;i++) for(let j=i+1;j<D.length;j++){ const q=circInt(D[i],D[j]); if(q){ C.push(q[0],q[1]); } }
      let best=null,bd=Infinity;
      for(const c of C){
        if(c[1]<minFY-0.05*H) continue;
        let ok=true;
        for(const d of D){ if(Math.hypot(c[0]-d[0],c[1]-d[1])>d[2]+0.5){ ok=false; break; } }
        if(!ok) continue;
        const dd=Math.hypot(c[0]-ix,c[1]-iy);
        if(dd<bd){ bd=dd; best=c; }
      }
      if(best){
        const st=D.map((d,i)=>Math.hypot(best[0]-d[0],best[1]-d[1])/(i<2?ARM:d[2]));
        let s=0; for(const v of st){ const e=Math.max(0,v-0.78); s+=e*e; }
        for(const v of [st[0],st[1]]){ const e=Math.max(0,v-0.92); s+=3*e*e; const x=Math.max(0,v-1); s+=12*x*x; }
        let cost=bd/H+10*s;
        const sq=v=>v*v;
        const gap=Math.min(A.Y,B.Y)-maxFY;
        if(gap<GAP) cost+=sq((GAP-gap)/(0.18*H));
        for(const F of feet){ if(F.kind==='floor') continue; const d=best[1]-F.Y; if(d<UNDER) cost+=sq((UNDER-d)/(0.12*H)); }
        cost+=1.2*(2-nf);
        if(feet.length===2&&lf!==rf){ const sp=Math.abs(feet[0].X-feet[1].X); if(sp>0.42*H) cost+=sq((sp-0.42*H)/(0.15*H)); }
        const off=Math.abs(best[0]-fcx); if(off>0.2*H) cost+=sq((off-0.2*H)/(0.15*H));
        if(A.X>best[0]+0.2*H) cost+=sq((A.X-best[0]-0.2*H)/(0.12*H));
        if(B.X<best[0]-0.2*H) cost+=sq((best[0]-0.2*H-B.X)/(0.12*H));
        res={C:best,cost,st};
      }
    }
    memo.set(key,res);
    return res;
  }

  const GAIN=0.42*H,W=o.feet==='open'?1.8:1.4;
  const hf=(lh,rh)=>Math.max(0,((topY-pts[lh].Y)+(topY-pts[rh].Y))/GAIN);
  const nearestFloor=x=>{ let b=floor0,bd=Infinity; for(let i=floor0;i<pts.length;i++){ const d=Math.abs(pts[i].X-x); if(d<bd){ bd=d; b=i; } } return b; };

  let pairs=[];
  if(o.startIds&&o.startIds.length){
    const ids=o.startIds.map(id=>pts.findIndex(p=>p.id===id)).filter(i=>i>=0&&i<nHold);
    if(ids.length===1) pairs=[[ids[0],ids[0],0]];
    else if(ids.length>=2){ const a=ids[0],b=ids[1]; pairs=[pts[a].X<=pts[b].X?[a,b,0]:[b,a,0]]; }
  }
  if(!pairs.length){
    /* Without start tags, start the way routes are usually set: hands on
       low holds at about chest height, feet still on the mat. */
    const cand=[];
    for(let i=0;i<nHold;i++) if(pts[i].Y<=1.3*H&&pts[i].Y>=0.35*H) cand.push(i);
    cand.sort((a,b)=>pts[a].Y-pts[b].Y);
    const c=cand.slice(0,8);
    for(let a=0;a<c.length;a++) for(let b=a;b<c.length;b++){
      const i=c[a],j=c[b]; if(i===j&&pts[i].r<4) continue;
      const L=pts[i].X<=pts[j].X?i:j,R=L===i?j:i;
      const hy=(pts[L].Y+pts[R].Y)/2,lowY=Math.min(pts[L].Y,pts[R].Y),dy=Math.abs(pts[L].Y-pts[R].Y);
      /* footholds well below the hands (strict) and any foothold at all
         (relaxed); a start with none can never leave the mat */
      let feet=0,anyFeet=0;
      for(let f=0;f<nFoot;f++){
        if(f===L||f===R||Math.abs(pts[f].X-(pts[L].X+pts[R].X)/2)>0.6*H) continue;
        if(pts[f].Y<=lowY-0.5*H) feet++;
        if(pts[f].Y<=lowY-0.15*H) anyFeet++;
      }
      /* [left, right, score, natural]: natural starts (hands within 0.6H of
         each other, 0.45H to 1.2H up) are the only ones the strict pass tries */
      const natural=(L===R||Math.abs(pts[L].X-pts[R].X)<=0.6*H)&&lowY>=0.45*H&&Math.max(pts[L].Y,pts[R].Y)<=1.2*H;
      pairs.push([L,R,((hy-0.8*H)/(0.15*H))**2+0.15*(a+b)+(dy>0.25*H?((dy-0.25*H)/(0.1*H))**2:0)+(i===j?(pts[i].r>=7?0.6:1.5):0)+(feet?0:4)+(anyFeet?0:8),natural]);
    }
  }
  pairs.sort((p,q)=>p[2]-q[2]);

  const MAX=o.maxExpand||(o.feet==='open'?16000:26000);
  /* Hands never cross and feet never cross, in every pass. strict: feet stay
     well below the hands (0.5H) and below the hips, hands go at least 0.45H
     above the feet. relaxed: feet 0.15H below the hands, high steps allowed
     (the pose cost still dislikes them), hands 0.12H above the feet. */
  function search(strict,starts,budget){
    /* starts: [L,R,cost]; several starts let the search choose (relaxed pass). */
    const nodes=[],heap=[],gBest=new Map(),closed=new Set();
    function hpush(i){ heap.push(i); let k=heap.length-1; while(k>0){ const p=(k-1)>>1; if(nodes[heap[p]].f<=nodes[heap[k]].f) break; [heap[p],heap[k]]=[heap[k],heap[p]]; k=p; } }
    function hpop(){ const t=heap[0],last=heap.pop(); if(heap.length){ heap[0]=last; let k=0; for(;;){ const l=2*k+1,r=l+1; let m=k; if(l<heap.length&&nodes[heap[l]].f<nodes[heap[m]].f) m=l; if(r<heap.length&&nodes[heap[r]].f<nodes[heap[m]].f) m=r; if(m===k) break; [heap[m],heap[k]]=[heap[k],heap[m]]; k=m; } } return t; }
    function add(lh,rh,lf,rf,g,parent,move,ps){
      ps=ps||pose(lh,rh,lf,rf); if(!ps) return;
      g+=ps.cost;
      const key=key4(lh,rh,lf,rf),pg=gBest.get(key);
      if(pg!==undefined&&pg<=g) return;
      gBest.set(key,g);
      nodes.push({lh,rh,lf,rf,g,f:g+W*hf(lh,rh),parent,move,key,pose:ps});
      hpush(nodes.length-1);
    }
    for(const [L,R,g0] of starts){
      const mx=(pts[L].X+pts[R].X)/2;
      add(L,R,nearestFloor(mx-0.1*H),nearestFloor(mx+0.1*H),starts.length>1?g0:0,-1,null);
    }
    if(!nodes.length) return null;
    const footGap=strict?0.5*H:0.15*H,footAboveHip=strict?-0.05*H:Infinity,handGap=strict?0.45*H:0.12*H,footReach=strict?1.08*LEG:1.1*LEG;
    let expanded=0,goal=-1,bestPartial=0,bestProg=-Infinity;
    while(heap.length&&expanded<budget){
      const ni=hpop(),n=nodes[ni];
      if(closed.has(n.key)||gBest.get(n.key)<n.g) continue;
      closed.add(n.key); expanded++;
      const onFloor=(n.lf>=0&&isFloor(n.lf))||(n.rf>=0&&isFloor(n.rf));
      const prog=pts[n.lh].Y+pts[n.rh].Y-(onFloor?1e4:0)-n.g*0.5;
      if(prog>bestProg){ bestProg=prog; bestPartial=ni; }
      if(n.lh===top&&n.rh===top){ goal=ni; break; }
      const C=n.pose.C,minHY=Math.min(pts[n.lh].Y,pts[n.rh].Y);
      for(const limb of ['lf','rf']){
        const cur=n[limb],other=limb==='lf'?n.rf:n.lf,side=limb==='lf'?-1:1;
        const from=cur>=0?pts[cur]:{X:C[0]+side*0.35*H,Y:C[1]-0.2*H};
        const holdsT=[],smearT=[];
        for(let t=0;t<nFoot;t++){
          if(t===cur||t===n.lh||t===n.rh) continue;
          const p=pts[t];
          if(p.Y>minHY-footGap) continue;
          if(p.Y>C[1]+footAboveHip) continue;
          if(Math.hypot(p.X-C[0],p.Y-C[1])>footReach) continue;
          if(p.kind==='smear') smearT.push([Math.hypot(p.X-(C[0]+side*0.12*H),p.Y-(C[1]-0.45*H)),t]); else holdsT.push(t);
        }
        smearT.sort((a,b)=>a[0]-b[0]);
        for(const t of holdsT.concat(smearT.slice(0,5).map(e=>e[1]))){
          const p=pts[t],d=Math.hypot(p.X-from.X,p.Y-from.Y);
          const nl=limb==='lf'?t:n.lf,nr=limb==='rf'?t:n.rf;
          let pen=0.8*(d/LEG)*(d/LEG);
          if(nl>=0&&nr>=0&&nl!==nr&&pts[nl].X>pts[nr].X+0.03*H) continue; // feet never cross
          if(p.kind==='smear') pen+=0.8;
          if(t===other) pen+=p.r>=7?0.6:2.0;
          if(cur>=0&&!isFloor(cur)&&p.Y<pts[cur].Y-0.06*H) pen+=0.6;
          add(n.lh,n.rh,nl,nr,n.g+0.5+pen,ni,{limb,from:cur,to:t});
        }
        if(cur>=0&&other>=0&&!onFloor){
          const nl=limb==='lf'?-1:n.lf,nr=limb==='rf'?-1:n.rf;
          add(n.lh,n.rh,nl,nr,n.g+1.8,ni,{limb,from:cur,to:-1});
        }
      }
      if(onFloor||(n.lf<0&&n.rf<0)) continue;
      const maxFY=Math.max(n.lf>=0?pts[n.lf].Y:-1e9,n.rf>=0?pts[n.rf].Y:-1e9);
      for(const limb of ['lh','rh']){
        const cur=n[limb],other=limb==='lh'?n.rh:n.lh,side=limb==='lh'?-1:1;
        for(let t=0;t<nHold;t++){
          if(t===cur||t===n.lf||t===n.rf) continue;
          const p=pts[t];
          if(p.Y<maxFY+handGap) continue;
          if(Math.hypot(p.X-C[0],p.Y-C[1])>TORSO+ARMX+0.3*H) continue;
          const nl=limb==='lh'?t:n.lh,nr=limb==='rh'?t:n.rh;
          let pen=0;
          if(nl!==nr&&pts[nl].X>pts[nr].X+0.02*H) continue; // hands never cross
          if(t===other){ if(t!==top&&p.r<4) continue; if(t!==top) pen+=p.r>=7?0.6:1.5; }
          if(p.Y<pts[cur].Y-0.05*H) pen+=0.8;
          /* Cross-body tension: while one hand moves, the other hand and the
             feet must hold the body on both sides of the hips, or it swings
             open like a barn door. */
          const sx=[pts[other].X];
          if(n.lf>=0) sx.push(pts[n.lf].X); if(n.rf>=0) sx.push(pts[n.rf].X);
          const lo=Math.min(...sx),hi=Math.max(...sx),cx=C[0];
          const outside=cx<lo-0.04*H?lo-0.04*H-cx:cx>hi+0.04*H?cx-hi-0.04*H:0;
          if(outside>0) pen+=Math.min(1.5,outside/(0.15*H));
          const ps=pose(nl,nr,n.lf,n.rf); if(!ps) continue;
          const d=Math.hypot(p.X-pts[cur].X,p.Y-pts[cur].Y);
          pen+=0.6*HANDK*(d/ARM)*(d/ARM);
          add(nl,nr,n.lf,n.rf,n.g+1+pen,ni,{limb,from:cur,to:t,reach:ps.st[limb==='lh'?0:1]},ps);
        }
      }
    }
    const end=goal>=0?goal:bestPartial,chain=[];
    for(let i=end;i>=0;i=nodes[i].parent) chain.push(nodes[i]);
    chain.reverse();
    const last=chain[chain.length-1];
    return {ok:goal>=0,expanded,strict,chain,height:Math.max(pts[last.lh].Y,pts[last.rh].Y)};
  }
  /* Strict technique from the 3 most natural starts first; if the holds don't
     allow it, a relaxed pass (high steps, feet nearer the hands) that may pick
     any start. Real photos often have few low footholds, so the relaxed pass
     is common; it reaches the top as often as the v1 planner did. */
  let r=null;
  const better=t=>t&&(!r||(t.ok&&!r.ok)||(!r.ok&&!t.ok&&t.height>r.height+1));
  /* the strict tries share one search budget, the relaxed pass gets its own */
  let left=MAX;
  for(const st of pairs.filter(p=>p[3]!==false).slice(0,3)){
    if(left<200) break;
    const t=search(true,[st],left); if(t) left-=t.expanded;
    if(better(t)) r=t; if(r&&r.ok) break;
  }
  if(!r||!r.ok){ const t=search(false,pairs,MAX); if(better(t)) r=t; }
  if(!r||!r.ok){ ARMX=1.06*ARM; memo.clear(); const t=search(false,pairs,MAX); if(t) t.stretch=true; if(better(t)) r=t; }
  if(!r) return {ok:false,reason:'nostart',H};
  return {ok:r.ok,reason:r.ok?'':'stuck',strict:r.strict,stretch:!!r.stretch,top,H,TORSO,ARM,LEG,angle:ang,expanded:r.expanded,
    pts:pts.map(p=>({X:p.X,Y:p.Y,r:p.r,kind:p.kind,id:p.id})),
    steps:r.chain.map(n=>({lh:n.lh,rh:n.rh,lf:n.lf,rf:n.rf,C:n.pose.C,st:n.pose.st,move:n.move,g:n.g}))};
}

/* Turns solver output into numbered holds, captions and coaching tips. */
function holdKind(h){
  if(!h) return null;
  const d=2*h.rCm,vertical=Math.abs(Math.sin(h.angle))>0.7;
  if(d>=30) return {name:'volume or big sloper',grip:'Big rounded shape: open hand or palm, and keep your body under it. Great to stand on later.'};
  if(h.elong>2.2) return vertical?{name:'sidepull or pinch',grip:'Long and upright: grip the side and lean away, or pinch it with your thumb on the far side.'}:{name:'edge or rail',grip:'Long and flat: grip along the top lip with an open hand or half crimp.'};
  if(d<7) return {name:'small crimp',grip:'Small hold: half crimp on your fingertips and push hard with your feet to take weight off your fingers.'};
  if(d<14) return {name:'edge or small pinch',grip:'Mid-size hold: try an open hand first, half crimp if it feels thin.'};
  return {name:'jug or sloper',grip:'Big hold: wrap your fingers over the top. If it feels round, open your hand and keep your body below it.'};
}
function buildBeta(res,meta){
  const {steps,pts,top,H}=res,ang=res.angle||0;
  const num=new Map();let k=0;
  const use=i=>{ if(i>=0&&pts[i].kind==='hold'&&!num.has(pts[i].id)) num.set(pts[i].id,++k); };
  use(steps[0].lh); use(steps[0].rh);
  for(let i=1;i<steps.length;i++) use(steps[i].move.to);
  const hn=i=>`hold ${num.get(pts[i].id)}`;
  const r5=v=>Math.max(5,Math.round(v/5)*5);
  const dir=(dx,dy)=>{ const p=[]; if(Math.abs(dy)>=8) p.push(`${r5(Math.abs(dy))} cm ${dy>0?'up':'down'}`); if(Math.abs(dx)>=8) p.push(`${r5(Math.abs(dx))} cm ${dx>0?'right':'left'}`); return p.length?p.join(', '):'a small adjustment'; };
  const footTips=['Watch your foot all the way onto the hold and place it quietly.','Stand on the inside edge of your big toe, then shift your weight over that foot.','Feet first: get this foot set before you reach with a hand.'];
  let footTipN=0,restN=0,steepN=0;
  const NAME={lh:'Left hand',rh:'Right hand',lf:'Left foot',rf:'Right foot'};
  const out=[];
  const posOf=(s)=>({lh:[pts[s.lh].X,pts[s.lh].Y],rh:[pts[s.rh].X,pts[s.rh].Y],lf:s.lf>=0?[pts[s.lf].X,pts[s.lf].Y]:null,rf:s.rf>=0?[pts[s.rf].X,pts[s.rf].Y]:null,C:s.C});
  const s0=steps[0];
  out.push({type:'start',title:'Start position',
    sub:s0.lh===s0.rh?`Both hands on ${hn(s0.lh)}. Feet stay on the mat for now.`:`Left hand on ${hn(s0.lh)}, right hand on ${hn(s0.rh)}. Feet stay on the mat for now.`,
    tips:['Read the whole route first: start, top, the hardest move and any good rest.',
      ang>=10?`Overhang (${ang}°): keep your hips close to the wall and pull with your toes so your feet stay on. Hang on straight arms.`
      :ang<=-5?`Slab (${-ang}° back): trust your feet. Stand tall over your toes, hips away from the wall, hands mostly for balance.`
      :'Hang on straight arms and keep your hips close to the wall.'],
    pos:posOf(s0),limb:null,cost:0,list:'Start: hands on '+(s0.lh===s0.rh?hn(s0.lh):`${hn(s0.lh)} + ${hn(s0.rh)}`)});
  let crux=-1,cruxC=-1;
  for(let i=1;i<steps.length;i++){
    const s=steps[i],p=steps[i-1],m=s.move,hand=m.limb[1]==='h';
    const tips=[];let title,sub,ff=false;
    const cost=s.g-p.g;
    const from=m.from>=0?pts[m.from]:null,to=m.to>=0?pts[m.to]:null;
    if(m.to===-1){
      const side=m.limb==='lf'?'left':'right';
      title=`${NAME[m.limb]} → flag`;
      sub=`Take it off and hold it out to the ${side} as a counterweight.`;
      tips.push('A flag keeps your body from swinging away from the wall when your other contacts are all on one side.');
    }else if(hand){
      const hold=meta.get(to.id),kind=holdKind(hold);
      const other=m.limb==='lh'?s.rh:s.lh;
      title=`${NAME[m.limb]} → ${hn(m.to)}`;
      sub=`${dir(to.X-from.X,to.Y-from.Y)}${kind?' · looks like '+(/^[aeiou]/.test(kind.name)?'an ':'a ')+kind.name:''}`;
      if(m.to===res.top&&other===res.top){ tips.push('Match the top hold with both hands and hold it still. That is the send.'); tips.push('Climb down if you can, or drop onto the mat with bent knees.'); }
      else{
        if(m.to===res.top) tips.push('Top hold! Bring your other hand across to match it.');
        const supports=[pts[other]];
        if(s.lf>=0) supports.push(pts[s.lf]); if(s.rf>=0) supports.push(pts[s.rf]);
        const C=p.C,sideT=Math.sign(to.X-C[0]);
        const feet=[s.lf,s.rf].filter(f=>f>=0).map(f=>pts[f]);
        if(Math.abs(to.X-C[0])>0.12*H&&feet.length&&feet.every(f=>Math.sign(f.X-C[0])===-sideT&&Math.abs(f.X-C[0])>0.04*H)){
          const leg=sideT<0?'left':'right',opp=sideT<0?'right':'left';
          const flagged=(sideT<0&&s.lf<0)||(sideT>0&&s.rf<0);
          tips.push(flagged?`Keep your ${leg} leg flagged out to the ${leg} as you reach. It stops your body swinging open.`
            :`${feet.length===2?'Both feet are':'Your foot is'} on your ${opp} side, so you may swing open. Flag your ${leg} leg out to the ${leg} as you reach.`);
        }
        if(m.reach>1) tips.push('Just past your reach standing still: push hard with your legs and catch the hold as you rise (a deadpoint).');
        else if(m.reach>0.9) tips.push('Long reach, close to your full arm length. Push up with your legs, straighten your arms and turn your hip into the wall.');
        if(other===m.to) tips.push('Match: bring the second hand onto this hold and shuffle your fingers to make room.');
        const nl=s.lh,nr=s.rh;
        if(nl!==nr&&pts[nl].X>pts[nr].X+0.04*H) tips.push('Cross-through: reach across your body and keep the other arm straight.');
        if(to.Y<from.Y-0.05*H) tips.push('This goes down a little. It sets up a better position for the next move.');
        /* Cross-body tension: reaching with one hand, push with the foot on
           the same side and hang off the other hand. */
        const sameFoot=m.limb==='lh'?s.lf:s.rf,sideW=m.limb==='lh'?'left':'right',otherW=m.limb==='lh'?'right':'left';
        if(tips.length<2&&sameFoot>=0&&pts[sameFoot].kind!=='floor') tips.push(`Push through your ${sideW} foot and hang straight-armed off your ${otherW} hand as you reach.`);
        if(ang>=20&&steepN<2&&tips.length<2){ tips.push('On this steep wall, keep pulling with your toes as you move so your feet don\'t cut loose.'); steepN++; }
        if(kind&&tips.length<2) tips.push(kind.grip);
      }
      if(cost>cruxC){ cruxC=cost; crux=out.length; }
    }else{
      const hold=to.kind==='hold'?meta.get(to.id):null,kind=holdKind(hold);
      const fromFloor=from&&from.kind==='floor';
      title=to.kind==='smear'?`${NAME[m.limb]} → smear on the wall`:`${NAME[m.limb]} → ${hn(m.to)}`;
      sub=fromFloor?'Off the mat and onto the wall':(from?dir(to.X-from.X,to.Y-from.Y):'Back onto the wall');
      if(kind&&!fromFloor) sub+=' · '+kind.name;
      if(fromFloor&&!out.some(o=>o.fromFloor)) tips.push('Step on with your toe and stand up through your leg. Don\'t pull up with your arms.');
      if(to.kind==='smear') tips.push('No foothold here: press the sole flat on the wall, heel low, and push into the wall.');
      if(to.Y>p.C[1]-0.02*H) tips.push('High step: lift the foot, move your hip over it, then stand up.');
      const otherF=m.limb==='lf'?s.rf:s.lf;
      if(m.to===otherF) tips.push('Swap feet: slide one foot off as the other goes on.');
      if(!tips.length){ tips.push(footTips[footTipN%footTips.length]); footTipN++; }
      ff=fromFloor;
    }
    const lhH=meta.get(pts[s.lh].id),rhH=meta.get(pts[s.rh].id);
    if(restN<2&&hand&&s.lf>=0&&s.rf>=0&&lhH&&rhH&&lhH.rCm>=8&&rhH.rCm>=8&&pts[s.lf].kind==='hold'&&pts[s.rf].kind==='hold'&&tips.length<3&&s.lh!==res.top){
      tips.push('Good rest: hang on straight arms and shake out one hand at a time.'); restN++;
    }
    out.push({type:'move',limb:m.limb,title,sub,tips:tips.slice(0,3),pos:posOf(s),cost,fromFloor:ff,list:title});
  }
  if(crux>0) out[crux].crux=true;
  const hands=out.filter(o=>o.limb&&o.limb[1]==='h').length,feet=out.filter(o=>o.limb&&o.limb[1]==='f').length;
  return {steps:out,num,ok:res.ok,hands,feet,crux,res};
}
