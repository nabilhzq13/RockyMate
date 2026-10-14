function rgbToHsv(r,g,b){
  r/=255;g/=255;b/=255;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
  let h=0;
  if(d){ if(mx===r) h=((g-b)/d)%6; else if(mx===g) h=(b-r)/d+2; else h=(r-g)/d+4; h*=60; if(h<0) h+=360; }
  return [h,mx?d/mx:0,mx];
}
function analyseData(rgba,w,h){
  const n=w*h,H=new Float32Array(n),S=new Float32Array(n),V=new Float32Array(n);
  for(let i=0,j=0;i<n;i++,j+=4){ const t=rgbToHsv(rgba[j],rgba[j+1],rgba[j+2]); H[i]=t[0];S[i]=t[1];V[i]=t[2]; }
  return {w,h,H,S,V,rgb:rgba};
}
function hueName(h,s,v){
  let n;
  if(h<12||h>=345) n='red'; else if(h<40) n=(v<0.6?'brown':'orange'); else if(h<68) n='yellow';
  else if(h<85) n='lime'; else if(h<165) n='green'; else if(h<195) n='teal'; else if(h<255) n='blue';
  else if(h<290) n='purple'; else n='pink';
  if(v<0.38&&n!=='brown') n='dark '+n;
  return n;
}
function findPalette(A){
  const {H,S,V,rgb,w,h}=A,n=w*h,B=36;
  const cnt=new Float64Array(B),R=new Float64Array(B),G=new Float64Array(B),Bl=new Float64Array(B);
  let blackN=0,whiteN=0;
  for(let i=0;i<n;i++){
    const s=S[i],v=V[i];
    if(s>0.35&&v>0.25){ const k=Math.min(B-1,Math.floor(H[i]/10)); cnt[k]++; R[k]+=rgb[i*4]; G[k]+=rgb[i*4+1]; Bl[k]+=rgb[i*4+2]; }
    else if(v<0.16) blackN++;
    else if(s<0.1&&v>0.86) whiteN++;
  }
  const sm=new Float64Array(B);
  for(let k=0;k<B;k++) sm[k]=cnt[(k+B-1)%B]*0.5+cnt[k]+cnt[(k+1)%B]*0.5;
  const minN=Math.max(30,n*0.002);
  let out=[];
  for(let k=0;k<B;k++){
    if(sm[k]<minN) continue;
    if(sm[k]<sm[(k+B-1)%B]||sm[k]<=sm[(k+1)%B]) continue;
    let c=0,r=0,g=0,b=0;
    for(let d=-1;d<=1;d++){ const kk=(k+d+B)%B; c+=cnt[kk]; r+=R[kk]; g+=G[kk]; b+=Bl[kk]; }
    if(!c) continue;
    r/=c; g/=c; b/=c;
    const t=rgbToHsv(r,g,b);
    out.push({kind:'hue',h:t[0],s:t[1],v:t[2],count:c,css:`rgb(${r|0},${g|0},${b|0})`,name:hueName(t[0],t[1],t[2])});
  }
  out.sort((a,b)=>b.count-a.count);
  const kept=[];
  for(const e of out){ if(kept.some(k=>{let d=Math.abs(k.h-e.h); if(d>180) d=360-d; return d<22;})) continue; kept.push(e); }
  out=kept.slice(0,8);
  if(blackN>minN) out.push({kind:'black',h:0,s:0,v:0.08,count:blackN,css:'#1d1f22',name:'black'});
  if(whiteN>minN) out.push({kind:'white',h:0,s:0,v:0.95,count:whiteN,css:'#f4f4f2',name:'white'});
  const seen={};
  for(const e of out){ if(seen[e.name]){ seen[e.name]++; e.name=e.name+' '+seen[e.name]; } else seen[e.name]=1; }
  return out;
}
function sampleColourAt(A,x,y){
  const {w,h,S,V,rgb}=A,px=[];
  const r=Math.max(3,Math.round(Math.min(w,h)*0.008));
  for(let yy=Math.round(y)-r;yy<=Math.round(y)+r;yy++){
    if(yy<0||yy>=h) continue;
    for(let xx=Math.round(x)-r;xx<=Math.round(x)+r;xx++){ if(xx<0||xx>=w) continue; px.push(yy*w+xx); }
  }
  if(!px.length) return null;
  let ms=0,mv=0; for(const i of px){ ms+=S[i]; mv+=V[i]; } ms/=px.length; mv/=px.length;
  if(mv<0.2) return {kind:'black',h:0,s:0,v:0.08,css:'#1d1f22',name:'black'};
  if(ms<0.12&&mv>0.8) return {kind:'white',h:0,s:0,v:0.95,css:'#f4f4f2',name:'white'};
  if(ms<0.2) return null;
  px.sort((a,b)=>S[b]-S[a]);
  const top=px.slice(0,Math.max(4,Math.floor(px.length/2)));
  let r2=0,g2=0,b2=0; for(const i of top){ r2+=rgb[i*4]; g2+=rgb[i*4+1]; b2+=rgb[i*4+2]; }
  r2/=top.length; g2/=top.length; b2/=top.length;
  const t=rgbToHsv(r2,g2,b2);
  return {kind:'hue',h:t[0],s:t[1],v:t[2],css:`rgb(${r2|0},${g2|0},${b2|0})`,name:hueName(t[0],t[1],t[2])};
}
function erode(m,w,h){
  const o=new Uint8Array(w*h);
  for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++){
    const i=y*w+x; if(!m[i]) continue;
    if(m[i-1]&&m[i+1]&&m[i-w]&&m[i+w]&&m[i-w-1]&&m[i-w+1]&&m[i+w-1]&&m[i+w+1]) o[i]=1;
  }
  return o;
}
function dilate(m,w,h){
  const o=new Uint8Array(w*h);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const i=y*w+x; if(!m[i]) continue;
    const y0=y>0?-1:0,y1=y<h-1?1:0,x0=x>0?-1:0,x1=x<w-1?1:0;
    for(let dy=y0;dy<=y1;dy++) for(let dx=x0;dx<=x1;dx++) o[i+dy*w+dx]=1;
  }
  return o;
}
function components(m,w,h,minA,maxA){
  const n=w*h,lab=new Uint8Array(n),st=new Int32Array(n),out=[];
  for(let i=0;i<n;i++){
    if(!m[i]||lab[i]) continue;
    let sp=0; st[sp++]=i; lab[i]=1;
    let c=0,sx=0,sy=0,sxx=0,syy=0,sxy=0,x0=w,x1=0,y0=h,y1=0;
    while(sp){
      const p=st[--sp],x=p%w,y=(p-x)/w;
      c++; sx+=x; sy+=y; sxx+=x*x; syy+=y*y; sxy+=x*y;
      if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
      for(let dy=-1;dy<=1;dy++){ const yy=y+dy; if(yy<0||yy>=h) continue;
        for(let dx=-1;dx<=1;dx++){ const xx=x+dx; if(xx<0||xx>=w) continue; const q=yy*w+xx; if(m[q]&&!lab[q]){ lab[q]=1; st[sp++]=q; } } }
    }
    if(c<minA||c>maxA) continue;
    const bw=x1-x0+1,bh=y1-y0+1;
    if(c/(bw*bh)<0.18) continue;
    const cx=sx/c,cy=sy/c,vxx=sxx/c-cx*cx,vyy=syy/c-cy*cy,vxy=sxy/c-cx*cy;
    const tr=vxx+vyy,det=vxx*vyy-vxy*vxy,disc=Math.sqrt(Math.max(0,tr*tr/4-det));
    const l1=tr/2+disc,l2=Math.max(0.25,tr/2-disc);
    out.push({x:cx,y:cy,area:c,r:Math.sqrt(c/Math.PI),elong:Math.sqrt(l1/l2),angle:0.5*Math.atan2(2*vxy,vxx-vyy)});
  }
  return out;
}
function mergeClose(cs){
  if(cs.length>300) return cs;
  let changed=true;
  while(changed){
    changed=false;
    outer: for(let i=0;i<cs.length;i++) for(let j=i+1;j<cs.length;j++){
      const a=cs[i],b=cs[j],d=Math.hypot(a.x-b.x,a.y-b.y);
      if(d<(a.r+b.r)*0.8){
        const A2=a.area+b.area;
        cs[i]={x:(a.x*a.area+b.x*b.area)/A2,y:(a.y*a.area+b.y*b.area)/A2,area:A2,r:Math.sqrt(A2/Math.PI),elong:Math.max(a.elong,b.elong),angle:a.area>b.area?a.angle:b.angle};
        cs.splice(j,1); changed=true; break outer;
      }
    }
  }
  return cs;
}
function detectHolds(A,t,tol){
  const {w,h,H,S,V}=A,n=w*h;
  let m=new Uint8Array(n);
  if(t.kind==='black'){ const vmax=0.12+tol*0.004; for(let i=0;i<n;i++) m[i]=V[i]<vmax?1:0; }
  else if(t.kind==='white'){ const smax=0.05+tol*0.004; for(let i=0;i<n;i++) m[i]=(S[i]<smax&&V[i]>0.8)?1:0; }
  else{
    const smin=Math.max(0.22,t.s*0.42),vmin=Math.max(0.16,t.v*0.42);
    for(let i=0;i<n;i++){ let d=Math.abs(H[i]-t.h); if(d>180) d=360-d; m[i]=(d<=tol&&S[i]>=smin&&V[i]>=vmin)?1:0; }
  }
  m=dilate(erode(m,w,h),w,h);
  m=erode(erode(dilate(dilate(m,w,h),w,h),w,h),w,h);
  const minA=Math.max(10,n*0.00012),maxA=n*0.06;
  return mergeClose(components(m,w,h,minA,maxA));
}


module.exports={analyseData,sampleColourAt,detectHolds};
