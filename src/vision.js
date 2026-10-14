/* Hold-vs-wall vision core. Self-contained so it can run in a Web Worker.
   Pipeline: sRGB -> CIELAB, local wall model on a coarse grid, per-pixel
   "how different from the wall right here", a colour model learned from the
   hold the user taps, a route-vs-wall decision per pixel, then blob checks
   (contrast with the ring of wall around it, edge strength, shape, size). */
function VisionCore(){
  const LIN=new Float32Array(256);
  for(let i=0;i<256;i++){ const c=i/255; LIN[i]=c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4); }
  const fl=t=>t>0.008856?Math.cbrt(t):7.787*t+0.1379310345;
  const clamp=(v,a,b)=>v<a?a:v>b?b:v;

  function lab2rgb(L,a,b){
    const fy=(L+16)/116,fx=fy+a/500,fz=fy-b/200;
    const fi=t=>{ const t3=t*t*t; return t3>0.008856?t3:(t-0.1379310345)/7.787; };
    const X=0.95047*fi(fx),Y=fi(fy),Z=1.08883*fi(fz);
    const r=3.2406*X-1.5372*Y-0.4986*Z,g=-0.9689*X+1.8758*Y+0.0415*Z,bb=0.0557*X-0.2040*Y+1.0570*Z;
    const gm=c=>{ c=clamp(c,0,1); return Math.round(255*(c<=0.0031308?12.92*c:1.055*Math.pow(c,1/2.4)-0.055)); };
    return [gm(r),gm(g),gm(bb)];
  }
  function nameOf(L,a,b){
    const C=Math.hypot(a,b);
    if(C<9){ if(L<28) return 'black'; if(L>82) return 'white'; return 'grey'; }
    const [r,g,bl]=lab2rgb(L,a,b),mx=Math.max(r,g,bl),mn=Math.min(r,g,bl),d=mx-mn;
    let h=0;
    if(d){ if(mx===r) h=((g-bl)/d)%6; else if(mx===g) h=(bl-r)/d+2; else h=(r-g)/d+4; h*=60; if(h<0) h+=360; }
    const v=mx/255;
    let n;
    if(h<12||h>=342) n=(L>62&&C<45)?'pink':'red';
    else if(h<42) n=(L<52||C<30)?'brown':'orange';
    else if(h<68) n=(C<28)?'beige':'yellow';
    else if(h<88) n='lime';
    else if(h<165) n='green';
    else if(h<196) n='teal';
    else if(h<258) n='blue';
    else if(h<292) n='purple';
    else n='pink';
    if(v<0.32&&n!=='brown') n='dark '+n;
    return n;
  }
  function inv3(m){
    const [a,b,c,d,e,f,g,h,i]=m;
    const A=e*i-f*h,B=-(d*i-f*g),C=d*h-e*g,det=a*A+b*B+c*C||1e-9;
    return [A/det,-(b*i-c*h)/det,(b*f-c*e)/det,B/det,(a*i-c*g)/det,-(a*f-c*d)/det,C/det,-(a*h-b*g)/det,(a*e-b*d)/det];
  }

  /* Lab conversion + local wall estimate + difference-from-wall map. */
  function prepare(rgba,w,h){
    const n=w*h,L=new Float32Array(n),A=new Float32Array(n),B=new Float32Array(n);
    for(let i=0,j=0;i<n;i++,j+=4){
      const r=LIN[rgba[j]],g=LIN[rgba[j+1]],b=LIN[rgba[j+2]];
      const fx=fl((r*0.4124+g*0.3576+b*0.1805)/0.95047),fy=fl(r*0.2126+g*0.7152+b*0.0722),fz=fl((r*0.0193+g*0.1192+b*0.9505)/1.08883);
      L[i]=116*fy-16; A[i]=500*(fx-fy); B[i]=200*(fy-fz);
    }
    const cs=Math.max(10,Math.round(Math.max(w,h)/18)),gw=Math.ceil(w/cs),gh=Math.ceil(h/cs),G=gw*gh;
    const cL=new Float32Array(G),cA=new Float32Array(G),cB=new Float32Array(G);
    const cnt=new Int32Array(1000),touched=new Int32Array(1000);
    for(let gy=0;gy<gh;gy++) for(let gx=0;gx<gw;gx++){
      const x0=gx*cs,x1=Math.min(w,x0+cs),y0=gy*cs,y1=Math.min(h,y0+cs);
      let nt=0;
      for(let y=y0;y<y1;y++) for(let i=y*w+x0,e=y*w+x1;i<e;i++){
        const k=clamp(L[i]/10|0,0,9)*100+clamp((A[i]+60)/12|0,0,9)*10+clamp((B[i]+60)/12|0,0,9);
        if(cnt[k]===0) touched[nt++]=k;
        cnt[k]++;
      }
      let best=0,bs=-1;
      for(let t=0;t<nt;t++){
        const k=touched[t],bl=k/100|0,ba=(k/10|0)%10,bb=k%10;
        let s=cnt[k]*2;
        if(bl>0) s+=cnt[k-100]; if(bl<9) s+=cnt[k+100];
        if(ba>0) s+=cnt[k-10]; if(ba<9) s+=cnt[k+10];
        if(bb>0) s+=cnt[k-1]; if(bb<9) s+=cnt[k+1];
        if(s>bs){ bs=s; best=k; }
      }
      let mL=(best/100|0)*10+5,mA=((best/10|0)%10)*12-54,mB=(best%10)*12-54;
      for(let it=0;it<3;it++){
        const R2=it===0?196:81;
        let sL=0,sA=0,sB=0,c=0;
        for(let y=y0;y<y1;y++) for(let i=y*w+x0,e=y*w+x1;i<e;i++){
          const dl=(L[i]-mL)*0.5,da=A[i]-mA,db=B[i]-mB;
          if(dl*dl+da*da+db*db<R2){ sL+=L[i]; sA+=A[i]; sB+=B[i]; c++; }
        }
        if(c){ mL=sL/c; mA=sA/c; mB=sB/c; }
      }
      const g=gy*gw+gx; cL[g]=mL; cA[g]=mA; cB[g]=mB;
      for(let t=0;t<nt;t++) cnt[touched[t]]=0;
    }
    /* A cell filled by one big hold would call that hold "wall": compare each
       cell with the median of its neighbours and replace outliers. */
    const fL=cL.slice(),fA=cA.slice(),fB=cB.slice(),vl=[],va=[],vb=[];
    const med=v=>{ v.sort((p,q)=>p-q); return v[v.length>>1]; };
    for(let gy=0;gy<gh;gy++) for(let gx=0;gx<gw;gx++){
      vl.length=va.length=vb.length=0;
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
        const yy=gy+dy,xx=gx+dx; if(yy<0||yy>=gh||xx<0||xx>=gw) continue;
        const g=yy*gw+xx; vl.push(cL[g]); va.push(cA[g]); vb.push(cB[g]);
      }
      const g=gy*gw+gx,ml=med(vl),ma=med(va),mb=med(vb);
      const d=Math.sqrt(0.25*(cL[g]-ml)*(cL[g]-ml)+(cA[g]-ma)*(cA[g]-ma)+(cB[g]-mb)*(cB[g]-mb));
      if(d>11){ fL[g]=ml; fA[g]=ma; fB[g]=mb; }
    }
    const bL=new Float32Array(n),bA=new Float32Array(n),bB=new Float32Array(n);
    const X0=new Int32Array(w),X1=new Int32Array(w),TX=new Float32Array(w);
    for(let x=0;x<w;x++){ const f=(x+0.5)/cs-0.5,g0=Math.floor(f); TX[x]=f<0?0:(g0>=gw-1?0:f-g0); X0[x]=clamp(g0,0,gw-1); X1[x]=clamp(g0+1,0,gw-1); }
    for(let y=0;y<h;y++){
      const f=(y+0.5)/cs-0.5,g0=Math.floor(f),ty=f<0?0:(g0>=gh-1?0:f-g0),r0=clamp(g0,0,gh-1)*gw,r1=clamp(g0+1,0,gh-1)*gw;
      for(let x=0,i=y*w;x<w;x++,i++){
        const tx=TX[x],a=r0+X0[x],b=r0+X1[x],c=r1+X0[x],d=r1+X1[x];
        const w00=(1-tx)*(1-ty),w01=tx*(1-ty),w10=(1-tx)*ty,w11=tx*ty;
        bL[i]=fL[a]*w00+fL[b]*w01+fL[c]*w10+fL[d]*w11;
        bA[i]=fA[a]*w00+fA[b]*w01+fA[c]*w10+fA[d]*w11;
        bB[i]=fB[a]*w00+fB[b]*w01+fB[c]*w10+fB[d]*w11;
      }
    }
    const dfg=new Float32Array(n),hist=new Int32Array(240);
    for(let i=0;i<n;i++){
      const dl=0.5*(L[i]-bL[i]),da=A[i]-bA[i],db=B[i]-bB[i],d=Math.sqrt(dl*dl+da*da+db*db);
      dfg[i]=d; hist[Math.min(239,d*2|0)]++;
    }
    let acc=0,p50=0; for(let k=0;k<240;k++){ acc+=hist[k]; if(acc>=n*0.5){ p50=k/2; break; } }
    const Tfg=clamp(2.8*p50+5,9,24);
    const gs=[];
    for(let y=1;y<h-1;y+=4) for(let x=1;x<w-1;x+=4) gs.push(grad(L,A,B,y*w+x,w));
    gs.sort((p,q)=>p-q);
    const gRef=gs.length?gs[gs.length>>1]:4;
    let wl=0,wa=0,wb=0; const mid=[];
    for(let g=0;g<G;g++) mid.push(g);
    mid.sort((p,q)=>fL[p]-fL[q]);
    const gm=mid[mid.length>>1]; wl=fL[gm]; wa=fA[gm]; wb=fB[gm];
    const rgb=lab2rgb(wl,wa,wb);
    return {w,h,n,L,A,B,bL,bA,bB,dfg,Tfg,gRef,cs,gw,gh,cellL:fL,cellA:fA,cellB:fB,wall:{L:wl,a:wa,b:wb,css:`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`,name:nameOf(wl,wa,wb)}};
  }
  /* Grid cells that look like the climbing wall the user tapped on: similar
     colour, joined up, plus a one-cell margin. Ceilings, mats, people and
     the gym behind the wall fall outside it. */
  function wallRegion(I,W){
    const {gw,gh,cellL,cellA,cellB}=I,G=gw*gh,sim=new Uint8Array(G);
    for(let g=0;g<G;g++){ const d0=0.5*(cellL[g]-W[0]),d1=cellA[g]-W[1],d2=cellB[g]-W[2]; if(d0*d0+d1*d1+d2*d2<15*15) sim[g]=1; }
    const lab=new Int32Array(G),sizes=[0];
    let id=0;
    for(let s=0;s<G;s++){
      if(!sim[s]||lab[s]) continue;
      id++; let sz=0; const st=[s]; lab[s]=id;
      while(st.length){ const g=st.pop(),x=g%gw,y=(g-x)/gw; sz++;
        for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){ const xx=x+dx,yy=y+dy; if(xx<0||yy<0||xx>=gw||yy>=gh) continue; const q=yy*gw+xx; if(sim[q]&&!lab[q]){ lab[q]=id; st.push(q); } } }
      sizes.push(sz);
    }
    const big=Math.max(0,...sizes),keep=new Uint8Array(G);
    if(big<3){ keep.fill(1); return keep; }
    for(let g=0;g<G;g++) if(lab[g]&&sizes[lab[g]]>=big*0.3) keep[g]=1;
    const out=keep.slice();
    for(let g=0;g<G;g++) if(keep[g]){ const x=g%gw,y=(g-x)/gw; for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){ const xx=x+dx,yy=y+dy; if(xx>=0&&yy>=0&&xx<gw&&yy<gh) out[yy*gw+xx]=1; } }
    return out;
  }
  function grad(L,A,B,i,w){
    return Math.abs(L[i+1]-L[i-1])+Math.abs(L[i+w]-L[i-w])+0.8*(Math.abs(A[i+1]-A[i-1])+Math.abs(A[i+w]-A[i-w])+Math.abs(B[i+1]-B[i-1])+Math.abs(B[i+w]-B[i-w]));
  }

  /* Colour model from a set of "core" hold pixels: Lab mean + covariance,
     plus hue angle, chroma and lightness spread. Hue and chroma gates keep
     shading on the hold while shutting out the grey or tinted wall. */
  function modelFrom(I,idx,count){
    const {L,A,B}=I;
    count=count==null?idx.length:count;
    if(count<4) return null;
    const step=Math.max(1,Math.floor(count/4000));
    let n=0,sL=0,sA=0,sB=0,hx=0,hy=0,sC=0;
    const Ls=[];
    for(let k=0;k<count;k+=step){
      const i=idx[k],c=Math.hypot(A[i],B[i]);
      sL+=L[i]; sA+=A[i]; sB+=B[i]; n++; sC+=c; Ls.push(L[i]);
      if(c>1e-6){ hx+=A[i]; hy+=B[i]; }
    }
    const m=[sL/n,sA/n,sB/n],Cm=sC/n,hm=Math.atan2(hy,hx)*180/Math.PI;
    let c00=0,c01=0,c02=0,c11=0,c12=0,c22=0,vh=0,vc=0,wh=0;
    for(let k=0;k<count;k+=step){
      const i=idx[k],d0=L[i]-m[0],d1=A[i]-m[1],d2=B[i]-m[2],c=Math.hypot(A[i],B[i]);
      c00+=d0*d0; c01+=d0*d1; c02+=d0*d2; c11+=d1*d1; c12+=d1*d2; c22+=d2*d2;
      vc+=(c-Cm)*(c-Cm);
      if(c>6){ let dh=Math.atan2(B[i],A[i])*180/Math.PI-hm; dh=((dh+540)%360)-180; vh+=c*dh*dh; wh+=c; }
    }
    Ls.sort((p,q)=>p-q);
    const st={n,hue:hm,hueSd:wh?Math.sqrt(vh/wh):30,chroma:Cm,chromaSd:Math.sqrt(vc/n),Llo:Ls[Math.floor(n*0.05)],Lhi:Ls[Math.floor(n*0.95)]};
    return modelFromStats(m,[c00/n,c01/n,c02/n,c01/n,c11/n,c12/n,c02/n,c12/n,c22/n],st);
  }
  function modelFromStats(m,c,st){
    const cov=c.slice();
    cov[0]=Math.min(cov[0]+40,500); cov[4]+=9; cov[8]+=9;
    const achro=st.chroma<11;
    const rgb=lab2rgb(m[0],m[1],m[2]);
    return Object.assign({mean:m,cov,inv:inv3(cov),achro,css:`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`,name:nameOf(m[0],m[1],m[2])},st);
  }
  /* Pixels of a region that are not on its rim and clearly differ from the
     wall: the rim mixes hold and wall colour and would teach the model the
     wall colour too. */
  function coreOf(I,inRegion,list,count){
    const {w,h,dfg,Tfg}=I,core=[];
    for(let k=0;k<count;k++){
      const i=list[k],x=i%w,y=(i-x)/w;
      if(x<1||y<1||x>=w-1||y>=h-1) continue;
      if(!inRegion(i-1)||!inRegion(i+1)||!inRegion(i-w)||!inRegion(i+w)) continue;
      if(dfg[i]<Tfg*1.3) continue;
      core.push(i);
    }
    return core;
  }
  function ringColour(I,inRegion,box,pad){
    const {w,h,L,A,B,dfg,Tfg}=I;
    let l=0,a=0,b=0,c=0;
    const X0=Math.max(0,box[0]-pad),X1=Math.min(w-1,box[2]+pad),Y0=Math.max(0,box[1]-pad),Y1=Math.min(h-1,box[3]+pad);
    for(let y=Y0;y<=Y1;y++) for(let x=X0,i=y*w+X0;x<=X1;x++,i++){ if(inRegion(i)||dfg[i]>Tfg) continue; l+=L[i]; a+=A[i]; b+=B[i]; c++; }
    return c>8?[l/c,a/c,b/c]:null;
  }

  /* Learn the route colour from the hold the user tapped. */
  function pick(I,x,y){
    const {w,h,L,A,B,dfg,Tfg}=I;
    const r=Math.max(3,Math.round(Math.max(w,h)*0.012)),cand=[];
    x=Math.round(x); y=Math.round(y);
    for(let yy=y-r;yy<=y+r;yy++){ if(yy<0||yy>=h) continue;
      for(let xx=x-r;xx<=x+r;xx++){ if(xx<0||xx>=w) continue; if((xx-x)*(xx-x)+(yy-y)*(yy-y)>r*r) continue; const i=yy*w+xx; if(dfg[i]>Tfg*0.75) cand.push(i); } }
    if(cand.length<4) return {error:'wall'};
    const med=k=>{ const v=cand.map(i=>k[i]).sort((p,q)=>p-q); return v[v.length>>1]; };
    const sL=med(L),sA=med(A),sB=med(B);
    const seen=new Uint8Array(w*h),q=new Int32Array(w*h);
    let qh=0,qt=0;
    const ok=i=>{ const dl=0.35*(L[i]-sL),da=A[i]-sA,db=B[i]-sB; return dfg[i]>Tfg*0.5&&dl*dl+da*da+db*db<400; };
    for(const i of cand) if(ok(i)&&!seen[i]){ seen[i]=1; q[qt++]=i; }
    if(qt<3) return {error:'wall'};
    const cap=Math.floor(w*h*0.05);
    while(qh<qt&&qt<cap){
      const i=q[qh++],px=i%w,py=(i-px)/w;
      if(px>0&&!seen[i-1]&&ok(i-1)){ seen[i-1]=1; q[qt++]=i-1; }
      if(px<w-1&&!seen[i+1]&&ok(i+1)){ seen[i+1]=1; q[qt++]=i+1; }
      if(py>0&&!seen[i-w]&&ok(i-w)){ seen[i-w]=1; q[qt++]=i-w; }
      if(py<h-1&&!seen[i+w]&&ok(i+w)){ seen[i+w]=1; q[qt++]=i+w; }
    }
    const inR=i=>seen[i]===1;
    let core=coreOf(I,inR,q,qt);
    if(core.length<8){ core=[]; for(let k=0;k<qt;k++) if(dfg[q[k]]>Tfg*1.2) core.push(q[k]); }
    const model=modelFrom(I,core.length>=4?core:q,core.length>=4?core.length:qt);
    if(!model) return {error:'wall'};
    let x0=w,x1=0,y0=h,y1=0;
    for(let k=0;k<qt;k++){ const i=q[k],px=i%w,py=(i-px)/w; if(px<x0)x0=px; if(px>x1)x1=px; if(py<y0)y0=py; if(py>y1)y1=py; }
    model.seed={x,y,area:qt,box:[x0,y0,x1,y1]};
    model.wall=ringColour(I,inR,[x0,y0,x1,y1],Math.max(3,Math.round(Math.sqrt(qt)*0.5)));
    return {model};
  }

  function morph(m,w,h,op){
    const o=new Uint8Array(w*h);
    if(op==='d'){
      for(let y=0;y<h;y++) for(let x=0,i=y*w;x<w;x++,i++){ if(!m[i]) continue;
        o[i]=1; if(x>0) o[i-1]=1; if(x<w-1) o[i+1]=1; if(y>0) o[i-w]=1; if(y<h-1) o[i+w]=1; }
    }else{
      for(let y=1;y<h-1;y++) for(let x=1,i=y*w+1;x<w-1;x++,i++){ if(m[i]&&m[i-1]&&m[i+1]&&m[i-w]&&m[i+w]) o[i]=1; }
    }
    return o;
  }

  /* Classify every pixel as route / route-coloured-but-wall / other, then
     score each blob. tol 1..10. opt.pxPerCm (optional) gates hold size. */
  function classify(I,M,tol,opt){
    opt=opt||{};
    const {w,h,n,L,A,B,bL,bA,bB,Tfg,gRef}=I,inv=M.inv,mu=M.mean;
    const tolS=0.5+0.1*tol,mmax=2+0.35*tol,m2max=mmax*mmax;
    const wL2=M.achro?1:0.25,T=M.achro?Tfg*1.3:Tfg,sw=T/3,sw2=sw*sw,T2=T*T;
    let cosTol=-2,Cfloor=0,Cceil=1e9,Llo=-1e9,Lhi=1e9;
    const hr=M.hue*Math.PI/180,hc=Math.cos(hr),hs=Math.sin(hr);
    if(!M.achro){ cosTol=Math.cos(clamp(3*M.hueSd,10,28)*tolS*Math.PI/180); Cfloor=Math.max(8,M.chroma*(0.55-0.025*tol)); }
    else{ Cceil=Math.max(14,M.chroma+8)*tolS; const sdL=Math.max(6,(M.Lhi-M.Llo)/3.3); Llo=M.Llo-sdL*1.2*tolS; Lhi=M.Lhi+sdL*1.2*tolS; }
    const cls=new Uint8Array(n);
    let m=new Uint8Array(n);
    for(let i=0;i<n;i++){
      const a=A[i],b=B[i],C=Math.sqrt(a*a+b*b);
      if(!M.achro){ if(C<Cfloor||a*hc+b*hs<cosTol*C) continue; }
      else if(C>Cceil||L[i]<Llo||L[i]>Lhi) continue;
      const dl=L[i]-mu[0],da=a-mu[1],db=b-mu[2];
      const m2=dl*(inv[0]*dl+inv[1]*da+inv[2]*db)+da*(inv[3]*dl+inv[4]*da+inv[5]*db)+db*(inv[6]*dl+inv[7]*da+inv[8]*db);
      if(m2>m2max) continue;
      const el=L[i]-bL[i],ea=A[i]-bA[i],eb=B[i]-bB[i],f2=wL2*el*el+ea*ea+eb*eb;
      if(f2>T2&&m2*sw2<f2){ cls[i]=1; m[i]=1; } else cls[i]=2;
    }
    const r=Math.max(1,Math.round(Math.max(w,h)/420));
    for(let k=0;k<r+1;k++) m=morph(m,w,h,'d');
    for(let k=0;k<r+1;k++) m=morph(m,w,h,'e');
    for(let k=0;k<r;k++) m=morph(m,w,h,'e');
    for(let k=0;k<r;k++) m=morph(m,w,h,'d');
    const lab=new Int32Array(n),st=new Int32Array(n),comps=[];
    const minA=Math.max(8,n*0.00008);
    let id=0;
    for(let s=0;s<n;s++){
      if(!m[s]||lab[s]) continue;
      id++; let sp=0; st[sp++]=s; lab[s]=id;
      let c=0,sx=0,sy=0,sxx=0,syy=0,sxy=0,x0=w,x1=0,y0=h,y1=0,mL=0,mA=0,mB=0,per=0,eSum=0,border=false;
      while(sp){
        const p=st[--sp],x=p%w,y=(p-x)/w;
        c++; sx+=x; sy+=y; sxx+=x*x; syy+=y*y; sxy+=x*y; mL+=L[p]; mA+=A[p]; mB+=B[p];
        if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
        if(x===0||y===0||x===w-1||y===h-1) border=true;
        let edge=false;
        if(x>0){ const q=p-1; if(m[q]){ if(!lab[q]){ lab[q]=id; st[sp++]=q; } } else edge=true; }
        if(x<w-1){ const q=p+1; if(m[q]){ if(!lab[q]){ lab[q]=id; st[sp++]=q; } } else edge=true; }
        if(y>0){ const q=p-w; if(m[q]){ if(!lab[q]){ lab[q]=id; st[sp++]=q; } } else edge=true; }
        if(y<h-1){ const q=p+w; if(m[q]){ if(!lab[q]){ lab[q]=id; st[sp++]=q; } } else edge=true; }
        if(edge&&x>1&&y>1&&x<w-2&&y<h-2){ per++; eSum+=Math.max(grad(L,A,B,p,w),grad(L,A,B,x>w/2?p-1:p+1,w)); }
      }
      if(c<minA) continue;
      comps.push({id,c,sx,sy,sxx,syy,sxy,x0,x1,y0,y1,mL:mL/c,mA:mA/c,mB:mB/c,per,eSum,border});
    }
    const out=[],region=M.wall?wallRegion(I,M.wall):null;
    for(const k of comps){
      const cx=k.sx/k.c,cy=k.sy/k.c,vxx=k.sxx/k.c-cx*cx,vyy=k.syy/k.c-cy*cy,vxy=k.sxy/k.c-cx*cy;
      const tr=vxx+vyy,det=vxx*vyy-vxy*vxy,disc=Math.sqrt(Math.max(0,tr*tr/4-det)),l1=tr/2+disc,l2=Math.max(0.25,tr/2-disc);
      const req=Math.sqrt(k.c/Math.PI),mg=Math.max(2,Math.round(req*0.7));
      let rl=0,ra=0,rb=0,rc=0,ringAll=0,ringSame=0;
      const X0=Math.max(0,k.x0-mg),X1=Math.min(w-1,k.x1+mg),Y0=Math.max(0,k.y0-mg),Y1=Math.min(h-1,k.y1+mg);
      for(let y=Y0;y<=Y1;y++) for(let x=X0,i=y*w+X0;x<=X1;x++,i++){
        if(lab[i]===k.id) continue;
        ringAll++;
        if(cls[i]===2) ringSame++;
        if(lab[i]||cls[i]===1) continue;
        if(I.dfg[i]>T*1.2) continue;
        rl+=L[i]; ra+=A[i]; rb+=B[i]; rc++;
      }
      const painted=ringAll?ringSame/ringAll:0;
      if(rc<12){
        rl=ra=rb=0; rc=0;
        for(let y=k.y0;y<=k.y1;y++) for(let x=k.x0,i=y*w+k.x0;x<=k.x1;x++,i++){ if(lab[i]===k.id){ rl+=bL[i]; ra+=bA[i]; rb+=bB[i]; rc++; } }
      }
      rl/=rc; ra/=rc; rb/=rc;
      const contrast=Math.sqrt(wL2*(k.mL-rl)*(k.mL-rl)+(k.mA-ra)*(k.mA-ra)+(k.mB-rb)*(k.mB-rb));
      const edgeRatio=k.per?(k.eSum/k.per)/(gRef+2):0;
      const bw=k.x1-k.x0+1,bh=k.y1-k.y0+1,fill=k.c/(Math.PI/4*bw*bh),elong=Math.sqrt(l1/l2);
      const cC=clamp((contrast-8)/14,0,1),cE=clamp((edgeRatio-1.1)/2.4,0,1);
      const cS=clamp((fill-0.3)/0.35,0,1)*(elong>7?0.3:elong>4.5?0.7:1);
      let ringSim=1;
      if(M.wall){ const d0=0.5*(rl-M.wall[0]),d1=ra-M.wall[1],d2=rb-M.wall[2]; ringSim=clamp(1-(Math.sqrt(d0*d0+d1*d1+d2*d2)-10)/22,0,1); }
      let conf=(0.5*cC+0.3*cE+0.2*cS)*(0.5+0.5*ringSim),reason='';
      const onWall=!region||region[Math.min(I.gh-1,cy/I.cs|0)*I.gw+Math.min(I.gw-1,cx/I.cs|0)]===1;
      if(!onWall){ conf*=0.45; reason='outside the climbing wall'; }
      if(painted>0.25){ conf*=0.3; reason='edge of a painted wall area in the same colour'; }
      const dcm=opt.pxPerCm?2*req/opt.pxPerCm:null;
      if(k.c>n*0.05||(dcm!=null&&dcm>110)){ conf=0; reason='too big for a hold'; }
      else if(dcm!=null&&dcm<2){ conf=0; reason='too small'; }
      else if(k.border&&k.c>n*0.008){ conf*=0.5; reason='cut off at the photo edge'; }
      if(!reason){
        if(ringSim<0.45) reason='not on the same wall as your route';
        else { const worst=Math.min(cC,cE,cS); reason=worst===cC?'blends into the wall around it':worst===cE?'no clear edge':'shape does not look like a hold'; }
      }
      const status=conf>=0.5?'hold':conf>=0.33?'unsure':'rejected';
      out.push({x:cx,y:cy,area:k.c,r:req,elong,angle:0.5*Math.atan2(2*vxy,vxx-vyy),conf,status,reason:status==='hold'?'':reason,
        contrast:Math.round(contrast*10)/10,edge:Math.round(edgeRatio*100)/100,fill:Math.round(fill*100)/100,id:k.id});
    }
    if(opt.mask){
      const keep=new Map(out.map(b=>[b.id,b.status]));
      for(let i=0;i<n;i++){
        const l=lab[i];
        if(l){ const s=keep.get(l); cls[i]=s==='hold'?1:s==='unsure'?4:3; }
        else if(cls[i]===1) cls[i]=0;
      }
    }
    return {blobs:out,mask:opt.mask?cls:null,lab};
  }

  /* Re-learn the colour model from the confident holds so holds in other
     lighting are found too. */
  function refine(I,M,res){
    const good=new Set(res.blobs.filter(b=>b.status==='hold'&&b.conf>=0.6).map(b=>b.id));
    if(good.size<2) return M;
    const lab=res.lab,list=[];
    for(let i=0;i<I.n;i++) if(good.has(lab[i])) list.push(i);
    const core=coreOf(I,i=>good.has(lab[i]),list,list.length);
    const m2=modelFrom(I,core.length>=20?core:list);
    if(!m2) return M;
    const dm=Math.hypot(0.5*(m2.mean[0]-M.mean[0]),m2.mean[1]-M.mean[1],m2.mean[2]-M.mean[2]);
    if(dm>12||m2.achro!==M.achro) return M;
    m2.hueSd=Math.min(m2.hueSd,M.hueSd*1.5+2);
    m2.seed=M.seed; m2.css=M.css; m2.name=M.name; m2.wall=M.wall;
    return m2;
  }

  /* Colours of things that stand out from the wall, for the colour chips. */
  function palette(I){
    const {n,L,A,B,dfg,Tfg}=I,fg=[];
    for(let i=0;i<n;i++) if(dfg[i]>Tfg*1.3) fg.push(i);
    if(fg.length<60) return [];
    const step=Math.max(1,Math.floor(fg.length/5000)),S=[];
    for(let k=0;k<fg.length;k+=step) S.push(fg[k]);
    const N=S.length,X=new Float32Array(N*3);
    for(let k=0;k<N;k++){ const i=S[k]; X[k*3]=0.5*L[i]; X[k*3+1]=A[i]; X[k*3+2]=B[i]; }
    let seed=7; const rnd=()=>{ seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return((t^t>>>14)>>>0)/4294967296; };
    const K=Math.min(10,Math.max(2,Math.floor(N/40))),C=new Float32Array(K*3),D=new Float32Array(N).fill(1e9);
    let first=Math.floor(rnd()*N); C[0]=X[first*3]; C[1]=X[first*3+1]; C[2]=X[first*3+2];
    for(let c=1;c<K;c++){
      let tot=0;
      for(let k=0;k<N;k++){ const d0=X[k*3]-C[(c-1)*3],d1=X[k*3+1]-C[(c-1)*3+1],d2=X[k*3+2]-C[(c-1)*3+2],d=d0*d0+d1*d1+d2*d2; if(d<D[k]) D[k]=d; tot+=D[k]; }
      let r=rnd()*tot,k=0; for(;k<N-1;k++){ r-=D[k]; if(r<=0) break; }
      C[c*3]=X[k*3]; C[c*3+1]=X[k*3+1]; C[c*3+2]=X[k*3+2];
    }
    const asg=new Int32Array(N);
    for(let it=0;it<12;it++){
      const s=new Float64Array(K*3),cn=new Int32Array(K);
      for(let k=0;k<N;k++){
        let bd=1e18,bi=0;
        for(let c=0;c<K;c++){ const d0=X[k*3]-C[c*3],d1=X[k*3+1]-C[c*3+1],d2=X[k*3+2]-C[c*3+2],d=d0*d0+d1*d1+d2*d2; if(d<bd){ bd=d; bi=c; } }
        asg[k]=bi; cn[bi]++; s[bi*3]+=X[k*3]; s[bi*3+1]+=X[k*3+1]; s[bi*3+2]+=X[k*3+2];
      }
      for(let c=0;c<K;c++) if(cn[c]){ C[c*3]=s[c*3]/cn[c]; C[c*3+1]=s[c*3+1]/cn[c]; C[c*3+2]=s[c*3+2]/cn[c]; }
    }
    let groups=[];
    for(let c=0;c<K;c++){ const mem=[]; for(let k=0;k<N;k++) if(asg[k]===c) mem.push(S[k]); if(mem.length>=N*0.015) groups.push({c:[C[c*3],C[c*3+1],C[c*3+2]],mem}); }
    groups.sort((p,q)=>q.mem.length-p.mem.length);
    const merged=[];
    for(const g of groups){
      const t=merged.find(m=>Math.hypot(m.c[0]-g.c[0],m.c[1]-g.c[1],m.c[2]-g.c[2])<10);
      if(t){ t.mem=t.mem.concat(g.mem); } else merged.push({c:g.c,mem:g.mem.slice()});
    }
    const out=[];
    for(const g of merged.slice(0,9)){
      const mdl=modelFrom(I,g.mem);
      if(!mdl) continue;
      mdl.share=g.mem.length/N;
      out.push(mdl);
    }
    const seen={};
    for(const e of out){ if(seen[e.name]){ seen[e.name]++; e.name+=' '+seen[e.name]; } else seen[e.name]=1; }
    return out;
  }
  /* Colour chips: palette colours that actually form several hold-shaped
     blobs, most holds first. */
  function suggest(I,max){
    const out=[];
    for(const M of palette(I)){
      const res=classify(I,M,5,{});
      const holds=res.blobs.filter(b=>b.status==='hold');
      if(holds.length<2) continue;
      let best=holds[0];
      for(const b of holds) if(b.conf*b.area>best.conf*best.area) best=b;
      const pk=pick(I,best.x,best.y);
      const M2=pk.model&&!pk.model.achro===!M.achro?pk.model:M;
      M2.count=holds.length;
      out.push(M2);
    }
    out.sort((p,q)=>q.count-p.count);
    const kept=[];
    for(const m of out){
      if(kept.some(k=>k.achro===m.achro&&(m.achro?Math.abs(k.mean[0]-m.mean[0])<12:Math.abs((((k.hue-m.hue)+540)%360)-180)<12))) continue;
      kept.push(m);
    }
    const seen={};
    for(const e of kept){ e.name=e.name.replace(/ \d+$/,''); if(seen[e.name]){ seen[e.name]++; e.name+=' '+seen[e.name]; } else seen[e.name]=1; }
    return kept.slice(0,max||8);
  }
  return {prepare,pick,classify,refine,palette,suggest,modelFromStats,lab2rgb,nameOf};
}
if(typeof module!=='undefined') module.exports=VisionCore;
