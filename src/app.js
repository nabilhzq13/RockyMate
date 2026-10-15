/* ===================== page ===================== */
(function(){
'use strict';
const STANDALONE=false;
const $=s=>document.querySelector(s);
const MARKER='"Permanent Marker","Marker Felt",cursive';
const LIMBCOL={lh:'#18a7e0',rh:'#ec3b74',lf:'#58b52b',rf:'#f59f00'};
const reduceMotion=!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);
const store={get(k,d){try{const v=localStorage.getItem('betalens:'+k);return v==null?d:JSON.parse(v);}catch(e){return d;}},set(k,v){try{localStorage.setItem('betalens:'+k,JSON.stringify(v));}catch(e){}}};
document.querySelectorAll('[data-only]').forEach(el=>{ el.hidden=(el.dataset.only==='standalone')!==STANDALONE; });

/* ---------- workers (vision + move solver), with in-page fallback ---------- */
function visionHandler(V,C,m){
  function analyse(){
    const I=C.I,out={rid:m.rid,w:I.w,h:I.h,wall:I.wall};
    if(m.model){
      const o={mask:!!m.mask,pxPerCm:m.pxPerCm};
      let r=V.classify(I,m.model,m.tol,o);
      if(m.refine){ const M2=V.refine(I,m.model,r); if(M2!==m.model){ r=V.classify(I,M2,m.tol,o); } }
      out.blobs=r.blobs; if(r.mask) out.mask=r.mask;
    }
    if(m.suggest) out.suggest=V.suggest(I);
    return out;
  }
  try{
    if(m.t==='frame'){ C.I=V.prepare(new Uint8ClampedArray(m.buf),m.w,m.h); C.tag=m.tag; return analyse(); }
    if(!C.I||C.tag!==m.tag) return {rid:m.rid,error:'noframe'};
    if(m.t==='classify') return analyse();
    if(m.t==='pick'){ const r=V.pick(C.I,m.u*C.I.w,m.v*C.I.h); return {rid:m.rid,model:r.model||null,error:r.error||null}; }
    return {rid:m.rid,error:'unknown'};
  }catch(err){ return {rid:m.rid,error:String(err&&err.message||err)}; }
}
function client(src,makeLocal){
  let w=null,seq=0,local=null;
  const pend=new Map();
  const run=msg=>{ if(!local) local=makeLocal(); return local(msg); };
  try{ w=new Worker(URL.createObjectURL(new Blob([src],{type:'text/javascript'}))); }catch(e){ w=null; }
  if(w){
    w.onmessage=e=>{ const p=pend.get(e.data.rid); if(p){ pend.delete(e.data.rid); p(e.data); } };
    w.onerror=ev=>{ if(ev&&ev.preventDefault) ev.preventDefault(); w=null; for(const [rid,p] of pend){ pend.delete(rid); p({rid,error:'worker'}); } };
  }
  return {call(msg,transfer){
    msg.rid=++seq;
    if(w) return new Promise(res=>{ pend.set(msg.rid,res); try{ w.postMessage(msg,transfer||[]); }catch(e){ pend.delete(msg.rid); res({rid:msg.rid,error:'post'}); } });
    return new Promise(res=>setTimeout(()=>{ let r; try{ r=run(msg); }catch(e){ r={rid:msg.rid,error:String(e)}; } res(r); },0));
  }};
}
const vision=client(VisionCore.toString()+'\n'+visionHandler.toString()+'\nconst V=VisionCore(),C={};onmessage=function(e){const r=visionHandler(V,C,e.data);postMessage(r,r.mask?[r.mask.buffer]:[]);};',
  ()=>{ const V=VisionCore(),C={}; return msg=>visionHandler(V,C,msg); });
const solver=client(solveBeta.toString()+'\nonmessage=function(e){var r;try{r=solveBeta(e.data.holds,e.data.o);}catch(err){r={ok:false,reason:"error",msg:String(err)};}r.rid=e.data.rid;postMessage(r);};',
  ()=>msg=>{ const r=solveBeta(msg.holds,msg.o); r.rid=msg.rid; return r; });

/* ---------- state ---------- */
const cv=$('#cv'),ctx=cv.getContext('2d'),wrap=$('#wrap');
const veil=document.createElement('canvas'),maskCv=document.createElement('canvas'),grab=document.createElement('canvas');
const gctx=grab.getContext('2d',{willReadFrequently:true});
const video=document.createElement('video');
video.muted=true; video.playsInline=true; video.setAttribute('playsinline',''); video.setAttribute('muted','');
const newEdits=()=>({removed:[],confirmed:[],added:[],start:[],top:null,startT:[],topT:null});
const S={src:null,token:0,lastStill:null,model:null,tol:5,showMask:false,suggest:[],wall:null,frameH:640,
  holds:[],edits:newEdits(),tracks:[],nextTrack:1,shift:[0,0],mask:false,
  beta:null,betaSnap:null,step:0,anim:null,playing:null,mode:'pick',view:{dw:1,dh:1,dpr:1},
  heightCm:store.get('height',170),wallM:4.2,userWallM:store.get('wallM',4.2),feet:store.get('feet','strict'),callout:false,cal:{floor:1,top:0,marked:false},
  live:{raf:0,busy:false,last:0,stream:null,url:null,frames:0,fpsT:0,sig:'',sigT:0,solvedSig:'',solving:false,lastSug:0,statT:0,wake:null}};
window.__betaLens=S;
const isMoving=()=>!!S.src&&(S.src.kind==='video'||S.src.kind==='live');
const aspect=()=>S.src?S.src.w/S.src.h:1;

/* ---------- sample wall (with a green-painted panel that must NOT count as holds) ---------- */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function drawHold(g,x,y,r,col,rnd){
  const k=10+Math.floor(rnd()*4),rot=rnd()*6.283,sx=0.82+rnd()*0.4,sy=0.82+rnd()*0.4,pts=[];
  for(let i=0;i<k;i++){ const a=rot+i/k*6.283,rr=r*(0.8+rnd()*0.28); pts.push([x+Math.cos(a)*rr*sx,y+Math.sin(a)*rr*sy]); }
  const path=(dx,dy)=>{ g.beginPath(); pts.forEach((p,i)=>i?g.lineTo(p[0]+dx,p[1]+dy):g.moveTo(p[0]+dx,p[1]+dy)); g.closePath(); };
  path(2,3); g.fillStyle='rgba(0,0,0,0.16)'; g.fill();
  path(0,0); g.fillStyle=col; g.fill();
  const rg=g.createRadialGradient(x-r*0.35,y-r*0.4,r*0.1,x,y,r*1.25);
  rg.addColorStop(0,'rgba(255,255,255,0.26)'); rg.addColorStop(0.55,'rgba(255,255,255,0)'); rg.addColorStop(1,'rgba(0,0,0,0.2)');
  path(0,0); g.fillStyle=rg; g.fill();
  g.beginPath(); g.arc(x+r*0.05,y,Math.max(1.4,r*0.11),0,6.283); g.fillStyle='rgba(25,25,25,0.7)'; g.fill();
}
const SK=900/420,ROUTE=[[110,35,4.2],[165,52,4.5],[120,140,8],[160,146,8],[95,95,4.6],[182,104,5],[105,205,7],[176,232,8],[140,178,4.2],[124,286,7],[196,300,6],[150,252,4.6],[110,344,7],[172,362,6.5],[140,396,10]];
const SAMPLE_TAP=[(160*SK+30)/600,(900-146*SK)/900];
function makeSampleWall(){
  const W=600,Hh=900,c=document.createElement('canvas'); c.width=W; c.height=Hh;
  const g=c.getContext('2d'),rnd=mulberry32(11);
  const bg=g.createLinearGradient(0,0,0,Hh); bg.addColorStop(0,'#c9ced4'); bg.addColorStop(1,'#b3b9c0'); g.fillStyle=bg; g.fillRect(0,0,W,Hh);
  g.fillStyle='#3d9c58'; g.beginPath(); g.moveTo(452,0); g.lineTo(600,0); g.lineTo(600,520); g.lineTo(500,560); g.closePath(); g.fill();
  for(let i=0;i<14000;i++){ const v=rnd()<0.5?255:0; g.fillStyle=`rgba(${v},${v},${v},0.05)`; g.fillRect(rnd()*W,rnd()*Hh,1.6,1.6); }
  g.strokeStyle='rgba(60,66,74,0.35)'; g.lineWidth=1.5;
  for(const x of [200,400]){ g.beginPath(); g.moveTo(x,0); g.lineTo(x,Hh); g.stroke(); }
  for(const y of [300,600]){ g.beginPath(); g.moveTo(0,y); g.lineTo(W,y); g.stroke(); }
  g.fillStyle='rgba(40,44,50,0.5)';
  for(let y=22;y<Hh;y+=43) for(let x=22;x<W;x+=43){ g.beginPath(); g.arc(x+(Math.floor(y/43)%2?21:0),y,1.6,0,6.283); g.fill(); }
  g.fillStyle='rgba(150,156,163,0.95)'; g.beginPath(); g.moveTo(330,560); g.lineTo(450,520); g.lineTo(420,640); g.closePath(); g.fill();
  g.fillStyle='rgba(120,126,134,0.7)'; g.beginPath(); g.moveTo(420,640); g.lineTo(450,520); g.lineTo(468,620); g.closePath(); g.fill();
  const routeCol='#2fa84f',others=['#f2c12e','#2d6fd8','#d8383b','#8a4dcc','#f07b22','#ee62a6','#24262a'];
  const taken=ROUTE.map(([X,Y,r])=>[X*SK+30,Hh-Y*SK,r*SK]);
  for(const [x,y] of taken){ const cg=g.createRadialGradient(x,y,2,x,y,26); cg.addColorStop(0,'rgba(255,255,255,0.22)'); cg.addColorStop(1,'rgba(255,255,255,0)'); g.fillStyle=cg; g.fillRect(x-28,y-28,56,56); }
  const placed=[]; let tries=0;
  while(placed.length<50&&tries<4000){
    tries++;
    const x=20+rnd()*(W-40),y=20+rnd()*(Hh-50),r=(4+rnd()*8)*SK*(rnd()<0.12?1.6:1);
    if(taken.concat(placed).some(p=>Math.hypot(p[0]-x,p[1]-y)<p[2]+r+10)) continue;
    placed.push([x,y,r,others[Math.floor(rnd()*others.length)]]);
  }
  for(const p of placed) drawHold(g,p[0],p[1],p[2],p[3],rnd);
  for(const [x,y,r] of taken) drawHold(g,x,y,r,routeCol,rnd);
  for(const i of [2,3]){
    const [x,y,r]=taken[i];
    g.save(); g.translate(x,y+r+12); g.rotate(-0.05+rnd()*0.1);
    g.fillStyle='#f7f3e8'; g.fillRect(-16,-6,32,12);
    g.fillStyle='#2b2b2b'; g.font='bold 9px sans-serif'; g.textAlign='center'; g.textBaseline='middle'; g.fillText('V1',0,1);
    g.restore();
  }
  return c;
}

/* ---------- sources: sample, photo, recorded clip, live camera ---------- */
function setSource(src,opt){
  opt=opt||{};
  stopPlay();
  if(!opt.keepVideo) stopMedia();
  S.src=src; S.token++;
  if(src.kind==='photo'||src.kind==='sample') S.lastStill=src;
  S.holds=[]; S.tracks=[]; S.shift=[0,0]; S.mask=false; S.beta=null; S.betaSnap=null; S.step=0; S.anim=null;
  S.edits=opt.edits||newEdits();
  if(!opt.keepModel) S.model=null;
  S.suggest=[];
  S.wallM=src.kind==='sample'?4.2:S.userWallM; $('#wallM').value=S.wallM;
  if(!opt.keepCal) S.cal={floor:1,top:0,marked:false};
  updateMarkUi();
  $('#badge').hidden=src.kind!=='sample';
  $('#liveTag').hidden=!isMoving(); $('#liveTxt').textContent=src.kind==='live'?'Live':'Clip';
  $('#vbar').hidden=!isMoving();
  $('#vSeek').hidden=src.kind!=='video'; $('#vPlay').hidden=src.kind!=='video';
  $('#vStop').textContent=src.kind==='live'?'Stop camera':'Close clip';
  setMode('pick');
  fit(); renderChips(); updateStats(); renderBeta();
  if(opt.reveal!==false&&S.token>1){ const r=wrap.getBoundingClientRect(); if(r.top<0||r.top>window.innerHeight*0.5) wrap.scrollIntoView({block:'start',behavior:reduceMotion?'auto':'smooth'}); }
  if(isMoving()){
    const L=S.live; Object.assign(L,{busy:false,last:0,sig:'',sigT:0,solvedSig:'',solving:false,lastSug:0,frames:0,fpsT:performance.now()});
    cancelAnimationFrame(L.raf); L.raf=requestAnimationFrame(loop);
    if(S.model) setCaption('Reading the wall','Hold the phone steady for a second. The moves appear once the holds stop moving.',[]);
    else setCaption('Pick a route colour','Tap one hold of your route on the picture.',[]);
    keepAwake(true);
  }else{
    keepAwake(false);
    if(!S.model) setCaption('Pick a route colour','Tap one hold of your route on the picture. Rocksane learns that exact colour.',[]);
    analysePhoto(true);
  }
}
function stopMedia(){
  const L=S.live;
  cancelAnimationFrame(L.raf); L.raf=0;
  if(L.stream){ L.stream.getTracks().forEach(t=>t.stop()); L.stream=null; }
  try{ video.pause(); }catch(e){}
  video.srcObject=null; video.removeAttribute('src');
  try{ video.load(); }catch(e){}
  if(L.url){ URL.revokeObjectURL(L.url); L.url=null; }
}
async function keepAwake(on){
  const L=S.live;
  try{
    if(on&&!L.wake&&navigator.wakeLock) L.wake=await navigator.wakeLock.request('screen');
    if(!on&&L.wake){ L.wake.release(); L.wake=null; }
  }catch(e){ L.wake=null; }
}
function waitVideo(){
  return new Promise(res=>{ const t0=performance.now(); (function chk(){ if(video.videoWidth>0&&video.readyState>=2) return res(true); if(performance.now()-t0>7000) return res(false); requestAnimationFrame(chk); })(); });
}
function loadFile(file){
  if(!file) return;
  if(/^video\//.test(file.type)) return loadVideo(file);
  if(!/^image\//.test(file.type)){ toast('That file is not a photo or video. Choose a JPEG, PNG or MP4.'); return; }
  const fr=new FileReader();
  fr.onload=()=>{ const im=new Image(); im.onload=()=>setSource({kind:'photo',el:im,w:im.naturalWidth,h:im.naturalHeight},{keepModel:false}); im.onerror=()=>toast('This photo could not be opened. Try a JPEG or PNG.'); im.src=fr.result; };
  fr.readAsDataURL(file);
}
async function loadVideo(file){
  stopMedia();
  const url=URL.createObjectURL(file); S.live.url=url;
  video.loop=true; video.src=url;
  busy('Opening clip…');
  try{ await video.play(); }catch(e){}
  const ok=await waitVideo(); busy(false);
  if(!ok){ stopMedia(); toast('This clip could not be played here. Try a short MP4, or take a photo instead.'); return; }
  setSource({kind:'video',el:video,w:video.videoWidth,h:video.videoHeight},{keepModel:true,keepVideo:true});
  setVPlayIcon();
}
async function startCamera(){
  if(!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia)){ toast('This browser can\'t open the camera here. Open the page over https in Chrome or Safari.'); return; }
  busy('Starting camera…');
  let stream;
  try{ stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false}); }
  catch(e){
    busy(false);
    const n=e&&e.name;
    toast(n==='NotAllowedError'||n==='SecurityError'?'Camera access was blocked. Allow the camera for this page in your browser settings, then try again.':n==='NotFoundError'||n==='OverconstrainedError'?'No camera was found on this device.':'The camera could not start. Close other apps that use it and try again.');
    return;
  }
  stopMedia();
  S.live.stream=stream; video.loop=false; video.srcObject=stream;
  try{ await video.play(); }catch(e){}
  const ok=await waitVideo(); busy(false);
  if(!ok){ stopMedia(); toast('The camera started but sent no picture. Try again.'); return; }
  setSource({kind:'live',el:video,w:video.videoWidth,h:video.videoHeight},{keepModel:true,keepVideo:true});
}
function freeze(){
  if(!isMoving()||!video.videoWidth) return;
  const sw=video.videoWidth,sh=video.videoHeight,sc=Math.min(1,1600/Math.max(sw,sh));
  const c=document.createElement('canvas'); c.width=Math.round(sw*sc); c.height=Math.round(sh*sc);
  c.getContext('2d').drawImage(video,0,0,c.width,c.height);
  const E=newEdits();
  for(const t of S.tracks){
    if(t.removed) E.removed.push({u:t.u,v:t.v});
    if(t.userOk) E.confirmed.push({u:t.u,v:t.v});
    if(S.edits.startT.includes(t.id)) E.start.push({u:t.u,v:t.v});
    if(S.edits.topT===t.id) E.top={u:t.u,v:t.v};
  }
  stopMedia();
  setSource({kind:'photo',el:c,w:c.width,h:c.height},{keepModel:true,edits:E,keepCal:true});
  toast('Frame frozen. You can now add or remove holds.');
}
$('#fileCam').addEventListener('change',e=>{ loadFile(e.target.files[0]); e.target.value=''; });
$('#fileVid').addEventListener('change',e=>{ loadFile(e.target.files[0]); e.target.value=''; });
$('#fileUp').addEventListener('change',e=>{ loadFile(e.target.files[0]); e.target.value=''; });
$('#useSample').addEventListener('click',()=>setSource({kind:'sample',el:makeSampleWall(),w:600,h:900}));
$('#goLive').addEventListener('click',startCamera);
$('#vFreeze').addEventListener('click',freeze);
$('#vStop').addEventListener('click',()=>{ stopMedia(); keepAwake(false); setSource(S.lastStill||{kind:'sample',el:makeSampleWall(),w:600,h:900},{keepModel:true}); });
function setVPlayIcon(){
  const p=$('#vPlay'),paused=video.paused;
  p.setAttribute('aria-label',paused?'Play video':'Pause video');
  p.querySelector('path').setAttribute('d',paused?'M7 4.5v15l13-7.5z':'M6 4.5h4v15H6zM14 4.5h4v15h-4z');
}
$('#vPlay').addEventListener('click',()=>{ if(video.paused) video.play().catch(()=>{}); else video.pause(); setTimeout(setVPlayIcon,0); });
$('#vSeek').addEventListener('input',e=>{ if(video.duration) video.currentTime=e.target.value/1000*video.duration; });
wrap.addEventListener('dragover',e=>{ e.preventDefault(); wrap.classList.add('drag'); });
wrap.addEventListener('dragleave',()=>wrap.classList.remove('drag'));
wrap.addEventListener('drop',e=>{ e.preventDefault(); wrap.classList.remove('drag'); const f=e.dataTransfer&&e.dataTransfer.files[0]; if(f) loadFile(f); });
document.addEventListener('paste',e=>{ const f=e.clipboardData&&e.clipboardData.files&&e.clipboardData.files[0]; if(f) loadFile(f); });

/* ---------- reading the wall ---------- */
function grabFrame(el,maxSide){
  const sw=el.videoWidth||el.naturalWidth||el.width,sh=el.videoHeight||el.naturalHeight||el.height;
  const sc=Math.min(1,maxSide/Math.max(sw,sh)),w=Math.max(1,Math.round(sw*sc)),h=Math.max(1,Math.round(sh*sc));
  if(grab.width!==w||grab.height!==h){ grab.width=w; grab.height=h; }
  gctx.drawImage(el,0,0,w,h);
  return {buf:gctx.getImageData(0,0,w,h).data.buffer,w,h};
}
/* Height units (fractions of the picture height) per cm of real wall. */
const kU=()=>(S.cal.floor-S.cal.top)/(S.wallM*100);
const pxPerCmFor=h=>h*kU();
async function analysePhoto(withSuggest){
  const src=S.src,tok=S.token;
  if(!src||isMoving()) return;
  busy('Reading the wall…');
  const f=grabFrame(src.el,640); S.frameH=f.h;
  const r=await vision.call({t:'frame',tag:tok,buf:f.buf,w:f.w,h:f.h,model:S.model,tol:S.tol,mask:S.showMask,pxPerCm:pxPerCmFor(f.h),refine:true,suggest:withSuggest},[f.buf]);
  busy(false);
  if(tok!==S.token) return;
  onPhotoResult(r);
  if(src.kind==='sample'&&!S.model) pickAt(SAMPLE_TAP[0],SAMPLE_TAP[1],true);
}
async function reclassify(){
  if(!S.src||isMoving()) return;
  if(!S.model){ S.holds=[]; S.mask=false; updateStats(); render(); return; }
  const tok=S.token;
  busy('Matching colour…');
  const r=await vision.call({t:'classify',tag:tok,model:S.model,tol:S.tol,mask:S.showMask,pxPerCm:pxPerCmFor(S.frameH),refine:true});
  busy(false);
  if(tok!==S.token) return;
  if(r.error==='noframe'){ analysePhoto(false); return; }
  onPhotoResult(r);
}
function onPhotoResult(r){
  if(r.error){ toast('Something went wrong reading this picture. Try another photo.'); return; }
  S.wall=r.wall;
  if(r.suggest){ S.suggest=r.suggest; renderChips(); }
  setMask(r.mask||null,r.w,r.h);
  S.holds=(r.blobs||[]).map((b,i)=>({id:i+1,u:b.x/r.w,v:b.y/r.h,rho:b.r/r.h,conf:b.conf,status:b.status,reason:b.reason,elong:b.elong,angle:b.angle}));
  applyEdits();
  updateStats(); render();
  if(S.model) solveSoon(); else { S.beta=null; renderBeta(); }
}
async function pickAt(u,v,quiet,retry){
  const tok=S.token;
  const r=await vision.call({t:'pick',tag:tok,u,v});
  if(tok!==S.token) return;
  if(r.error==='noframe'){
    if(!isMoving()&&!retry){ await analysePhoto(false); return pickAt(u,v,quiet,true); }
    toast('Hold the camera still for a moment, then tap again.'); return;
  }
  if(!r.model){ if(!quiet) toast('That spot looks like bare wall. Tap the middle of a coloured hold.'); return; }
  r.model.tapped=true;
  S.model=r.model;
  renderChips();
  if(isMoving()){ S.tracks=[]; S.beta=null; S.live.solvedSig=''; renderBeta(); setCaption('Reading the wall','Hold the phone steady for a second. The moves appear once the holds stop moving.',[]); }
  else reclassify();
}

/* Live / clip: analyse frames in the worker while the picture keeps playing. */
function loop(t){
  const L=S.live;
  if(!isMoving()) return;
  L.raf=requestAnimationFrame(loop);
  if(video.videoWidth&&(video.videoWidth!==S.src.w||video.videoHeight!==S.src.h)){ S.src.w=video.videoWidth; S.src.h=video.videoHeight; fit(); }
  if(video.readyState>=2&&!L.busy&&t-L.last>(S.model?70:260)) sendLive();
  if(S.src.kind==='video'&&video.duration) $('#vSeek').value=Math.round(video.currentTime/video.duration*1000);
  render();
}
async function sendLive(){
  const L=S.live,tok=S.token;
  L.busy=true; L.last=performance.now();
  let f;
  try{ f=grabFrame(video,400); }catch(e){ L.busy=false; return; }
  const now=performance.now(),sug=!S.model&&now-L.lastSug>2500;
  if(sug) L.lastSug=now;
  const r=await vision.call({t:'frame',tag:tok,buf:f.buf,w:f.w,h:f.h,model:S.model,tol:S.tol,mask:S.showMask&&!!S.model,pxPerCm:pxPerCmFor(f.h),refine:false,suggest:sug},[f.buf]);
  L.busy=false;
  if(tok!==S.token||!isMoving()||r.error) return;
  L.frames++;
  const t2=performance.now();
  if(t2-L.fpsT>1000){ $('#liveTxt').textContent=(S.src.kind==='live'?'Live':'Clip')+' · '+Math.round(L.frames*1000/(t2-L.fpsT))+' scans/s'; L.frames=0; L.fpsT=t2; }
  S.wall=r.wall;
  if(r.suggest){ S.suggest=r.suggest; renderChips(); }
  if(S.model&&r.blobs){ setMask(r.mask||null,r.w,r.h); updateTracks(r.blobs,r.w,r.h); checkLiveSolve(); }
  if(t2-L.statT>300){ L.statT=t2; updateStats(); }
}
/* Follow holds between frames so they don't flicker: match each new blob to
   the nearest known hold, keep a running average, drop holds that vanish. */
function updateTracks(blobs,w,h){
  const a=w/h,cand=blobs.filter(b=>b.status!=='rejected').map(b=>({u:b.x/w,v:b.y/h,rho:b.r/h,conf:b.conf,elong:b.elong,angle:b.angle,used:false}));
  const T=S.tracks,pairs=[];
  for(const t of T){ t.pu=t.u+S.shift[0]; t.pv=t.v+S.shift[1]; t.m=null; }
  for(const t of T) for(const c of cand){ const d=Math.hypot((t.pu-c.u)*a,t.pv-c.v); if(d<Math.max(0.03,2.2*Math.max(t.rho,c.rho))) pairs.push([d,t,c]); }
  pairs.sort((p,q)=>p[0]-q[0]);
  const du=[],dv=[];
  for(const [,t,c] of pairs){ if(t.m||c.used) continue; t.m=c; c.used=true; du.push(c.u-t.u); dv.push(c.v-t.v); }
  const med=v=>{ if(!v.length) return 0; const s=v.slice().sort((p,q)=>p-q); return s[s.length>>1]; };
  S.shift=[med(du)*0.8,med(dv)*0.8];
  const keep=[];
  for(const t of T){
    if(t.m){ const c=t.m; t.u=t.pu+(c.u-t.pu)*0.7; t.v=t.pv+(c.v-t.pv)*0.7; t.rho=t.rho*0.7+c.rho*0.3; t.conf=t.conf*0.65+c.conf*0.35; t.elong=c.elong; t.angle=c.angle; t.hits++; t.miss=0; }
    else { t.u=t.pu; t.v=t.pv; t.miss++; }
    t.status=t.conf>=0.5?'hold':t.conf>=0.33?'unsure':'rejected';
    if(t.miss<=(t.hits>=4?7:2)&&t.u>-0.1&&t.u<1.1&&t.v>-0.1&&t.v<1.1) keep.push(t);
  }
  for(const c of cand) if(!c.used) keep.push({id:S.nextTrack++,u:c.u,v:c.v,rho:c.rho,conf:c.conf,elong:c.elong,angle:c.angle,hits:1,miss:0,status:c.conf>=0.5?'hold':c.conf>=0.33?'unsure':'rejected'});
  S.tracks=keep;
}
function checkLiveSolve(){
  const L=S.live,act=activeHolds(),sig=act.map(t=>t.id).sort((p,q)=>p-q).join(','),now=performance.now();
  if(sig!==L.sig){ L.sig=sig; L.sigT=now; }
  if(S.playing||L.solving||act.length<2) return;
  if(sig!==L.solvedSig&&now-L.sigT>800){ L.solvedSig=sig; solveNow(true); }
}

/* ---------- holds, edits ---------- */
function nearPos(h,p){ return Math.hypot((h.u-p.u)*aspect(),h.v-p.v)<Math.max(h.rho,0.01)*1.3; }
function applyEdits(){
  const E=S.edits;
  S.holds=S.holds.filter(h=>!h.manual);
  for(const h of S.holds){ h.removed=E.removed.some(p=>nearPos(h,p)); h.userOk=E.confirmed.some(p=>nearPos(h,p)); }
  E.added.forEach((p,k)=>S.holds.push({id:5000+k,u:p.u,v:p.v,rho:p.rho,conf:1,status:'hold',manual:true,elong:1,angle:0}));
}
const isActive=h=>!h.removed&&(h.manual||h.userOk||h.status==='hold');
function currentHolds(){ return isMoving()?S.tracks.filter(t=>t.hits>=3&&t.miss<=2):S.holds; }
function onWall(h){ return h.v<=S.cal.floor+0.005&&h.v>=S.cal.top-0.02; }
function activeHolds(){ return currentHolds().filter(h=>isActive(h)&&onWall(h)); }
function isStart(h){ return isMoving()?S.edits.startT.includes(h.id):S.edits.start.some(p=>nearPos(h,p)); }
function hitHold(x,y){
  let best=null,bd=Infinity;
  for(const h of currentHolds()){ if(h.removed) continue; const [hx,hy]=P(h.u,h.v),d=Math.hypot(hx-x,hy-y); if(d<h.rho*S.view.dh+12&&d<bd){ bd=d; best=h; } }
  return best;
}

/* ---------- solving ---------- */
let solveT=0;
function solveSoon(){ if(isMoving()){ S.live.solvedSig=''; S.live.sigT=0; return; } clearTimeout(solveT); solveT=setTimeout(()=>solveNow(false),60); }
async function solveNow(live){
  stopPlay();
  const act=activeHolds(),tok=S.token;
  if(act.length<2){
    S.beta=null; renderBeta(); render();
    if(S.model&&!live) setCaption('Not enough holds','Rocksane needs at least two holds of the route colour. Move the colour slider toward Loose, or tap a hold again.',[]);
    return;
  }
  const k=kU(),a=aspect(),fl=S.cal.floor;
  const holds=act.map(h=>({id:h.id,X:h.u*a/k,Y:(fl-h.v)/k,r:h.rho/k}));
  const nearestId=p=>{ let b=null,bd=1e9; for(const h of act){ const d=Math.hypot((h.u-p.u)*a,h.v-p.v); if(d<bd){ bd=d; b=h; } } return b&&bd<0.06?b.id:null; };
  const startIds=live?S.edits.startT.filter(id=>act.some(h=>h.id===id)):S.edits.start.map(nearestId).filter(x=>x!=null);
  const topId=live?(act.some(h=>h.id===S.edits.topT)?S.edits.topT:null):(S.edits.top?nearestId(S.edits.top):null);
  const snap=new Map(act.map(h=>[h.id,{u:h.u,v:h.v}]));
  if(live) S.live.solving=true; else busy('Working out your moves…');
  const res=await solver.call({holds,o:{H:S.heightCm,feet:S.feet,startIds,topId}});
  if(live) S.live.solving=false; else busy(false);
  if(tok!==S.token) return;
  if(!res||!res.steps){
    S.beta=null; renderBeta(res); render();
    setCaption('No starting position found','None of the low holds can be reached from the floor at your height. Use Set start to tap your start holds, or check Wall in view.',[]);
    return;
  }
  const meta=new Map(act.map(h=>[h.id,{rCm:h.rho/kU(),elong:h.elong||1,angle:h.angle||0}]));
  S.beta=buildBeta(res,meta); S.betaSnap=snap; S.step=0; S.anim=null;
  renderBeta(); showStep(0,false);
}

/* ---------- beta panel + player ---------- */
function renderBeta(failRes){
  const sum=$('#betaSum'),warn=$('#betaWarn'),list=$('#moves');
  list.textContent=''; warn.hidden=true;
  const b=S.beta;
  if(!b){ sum.textContent=S.model?(failRes?'No route found from the floor.':(isMoving()?'Hold steady while the holds are found.':'Waiting for holds.')):'Choose a route colour to see the moves.'; updateCount(); return; }
  sum.textContent=`${b.hands} hand moves and ${b.feet} foot moves to the top${b.crux>0?`. Crux: move ${b.crux}.`:'.'}`;
  if(!b.ok){
    const last=b.res.steps[b.res.steps.length-1],y=Math.max(b.res.pts[last.lh].Y,b.res.pts[last.rh].Y);
    sum.textContent=`${b.hands} hand moves and ${b.feet} foot moves before getting stuck.`;
    warn.hidden=false;
    warn.textContent=`Stuck at about ${(y/100).toFixed(1)} m: the next hold is out of reach for ${S.heightCm} cm, or a hold wasn't found. Try Open feet, a looser colour match, or add the missing hold with Add / remove.`;
  }
  b.steps.forEach((s,i)=>{
    const li=document.createElement('li'),bt=document.createElement('button');
    bt.type='button';
    const k=document.createElement('span'); k.className='k'; k.textContent=i===0?'S':i;
    const d=document.createElement('i'); d.className='dot'+(s.limb&&s.limb[1]==='f'?' foot':'');
    d.style.background=s.limb?LIMBCOL[s.limb]:'var(--muted)';
    const t=document.createElement('span'); t.className='t'; t.textContent=s.list;
    bt.append(k,d,t);
    if(s.crux){ const c=document.createElement('span'); c.className='crux'; c.textContent='Crux'; bt.append(c); } else bt.append(document.createElement('span'));
    bt.addEventListener('click',()=>{ stopPlay(); showStep(i,true); });
    li.append(bt); list.append(li);
  });
}
function updateCount(){
  const b=S.beta;
  $('#count').textContent=b?(S.step===0?`Start · ${b.steps.length-1} moves`:`Move ${S.step} of ${b.steps.length-1}`):'—';
  $('#prev').disabled=!b||S.step===0;
  $('#next').disabled=!b||S.step>=b.steps.length-1;
  $('#play').disabled=!b;
}
function setCaption(title,sub,tips,crux){
  const h=$('#capTitle'); h.textContent=title;
  if(crux){ const c=document.createElement('span'); c.className='crux'; c.textContent='Crux'; h.append(c); }
  $('#capSub').textContent=sub;
  const ul=$('#capTips'); ul.textContent='';
  for(const t of tips){ const li=document.createElement('li'); li.textContent=t; ul.append(li); }
}
function speak(text){
  if(!S.callout||!('speechSynthesis' in window)) return;
  try{ speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text.replace(/→/g,' to ')); u.rate=1.03; speechSynthesis.speak(u); }catch(e){}
}
function showStep(i,animate){
  const b=S.beta; if(!b) return;
  i=Math.max(0,Math.min(b.steps.length-1,i));
  const fromPos=S.anim?currentPos():b.steps[Math.min(S.step,b.steps.length-1)].pos;
  S.step=i;
  const s=b.steps[i];
  setCaption(s.title,s.sub,s.tips,s.crux);
  const list=$('#moves'),items=list.children;
  for(let k=0;k<items.length;k++){
    const bt=items[k].firstChild;
    if(k!==i){ bt.removeAttribute('aria-current'); continue; }
    bt.setAttribute('aria-current','step');
    const top=bt.offsetTop,bot=top+bt.offsetHeight;
    if(top<list.scrollTop) list.scrollTop=top; else if(bot>list.scrollTop+list.clientHeight) list.scrollTop=bot-list.clientHeight;
  }
  updateCount();
  if(animate) speak(s.title);
  if(animate&&!reduceMotion){ S.anim={from:fromPos,to:s.pos,t0:performance.now(),dur:520}; if(!isMoving()) requestAnimationFrame(tick); }
  else { S.anim=null; if(!isMoving()) render(); }
}
function tick(){ if(!S.anim) return; render(); if(performance.now()-S.anim.t0<S.anim.dur) requestAnimationFrame(tick); else { S.anim=null; render(); } }
function flagPos(limb,C){ const H=S.beta.res.H,sd=limb==='lf'?-1:1; return [C[0]+sd*0.4*H,C[1]-0.16*H]; }
const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
function currentPos(){
  const s=S.beta.steps[S.step].pos;
  if(!S.anim) return s;
  const {from,to,t0,dur}=S.anim;
  let t=Math.min(1,(performance.now()-t0)/dur); t=t<0.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
  if(t>=1&&isMoving()) S.anim=null;
  const o={C:lerp(from.C,to.C,t)};
  for(const k of ['lh','rh','lf','rf']){ const a=from[k]||flagPos(k,from.C),b=to[k]||flagPos(k,to.C); o[k]=(!to[k]&&t>=1)?null:lerp(a,b,t); }
  return o;
}
$('#prev').addEventListener('click',()=>{ stopPlay(); showStep(S.step-1,true); });
$('#next').addEventListener('click',()=>{ stopPlay(); showStep(S.step+1,true); });
$('#play').addEventListener('click',()=>{ if(S.playing){ stopPlay(); return; } startPlay(); });
function startPlay(){
  const b=S.beta; if(!b) return;
  if(S.step>=b.steps.length-1) showStep(0,false);
  setPlayBtn(true);
  S.playing=setInterval(()=>{ if(!S.beta||S.step>=S.beta.steps.length-1){ stopPlay(); return; } showStep(S.step+1,true); },S.callout?2600:1900);
}
function stopPlay(){ if(S.playing){ clearInterval(S.playing); S.playing=null; } setPlayBtn(false); }
function setPlayBtn(on){
  const p=$('#play');
  p.querySelector('span').textContent=on?'Pause':'Play moves';
  p.querySelector('path').setAttribute('d',on?'M6 4.5h4v15H6zM14 4.5h4v15h-4z':'M7 4.5v15l13-7.5z');
}
document.addEventListener('keydown',e=>{
  if($('#view-wall').hidden) return;
  if(/INPUT|SELECT|TEXTAREA/.test((e.target&&e.target.tagName)||'')) return;
  if(e.key==='ArrowRight'){ stopPlay(); showStep(S.step+1,true); e.preventDefault(); }
  if(e.key==='ArrowLeft'){ stopPlay(); showStep(S.step-1,true); e.preventDefault(); }
});

/* ---------- colour chips + controls ---------- */
const sameModel=(a,b)=>a===b||(!!a&&!!b&&a.achro===b.achro&&Math.abs(a.mean[0]-b.mean[0])<4&&Math.abs(a.mean[1]-b.mean[1])<3&&Math.abs(a.mean[2]-b.mean[2])<3);
function renderChips(){
  const box=$('#chips'); box.textContent='';
  const rank=m=>m.achro?2:/brown|beige/.test(m.name)?1:0;
  const list=S.suggest.slice().sort((p,q)=>rank(p)-rank(q)||(q.count||0)-(p.count||0)).slice(0,7);
  const cur=S.model;
  if(cur&&!list.some(m=>sameModel(m,cur))) list.unshift(cur);
  if(!list.length){ const p=document.createElement('p'); p.className='hint'; p.textContent=S.src?(isMoving()?'Looking for hold colours…':'No clear hold colours yet. Tap a hold on the picture.'):''; box.append(p); return; }
  for(const m of list){
    const b=document.createElement('button'); b.className='chip'; b.type='button';
    b.setAttribute('aria-pressed',String(!!cur&&sameModel(m,cur)));
    const sw=document.createElement('span'); sw.className='sw'; sw.style.background=m.css;
    b.append(sw,document.createTextNode(m.tapped?m.name+' (tapped)':m.name));
    if(m.count){ const c=document.createElement('span'); c.className='ct'; c.textContent='· '+m.count; b.append(c); }
    b.addEventListener('click',()=>chooseModel(m));
    box.append(b);
  }
}
function chooseModel(m){
  S.model=m; renderChips();
  if(isMoving()){ S.tracks=[]; S.beta=null; S.live.solvedSig=''; renderBeta(); }
  else reclassify();
}
let tolT=0;
$('#tol').addEventListener('input',e=>{ S.tol=+e.target.value; $('#tolVal').textContent=S.tol; clearTimeout(tolT); tolT=setTimeout(()=>{ if(!isMoving()) reclassify(); },180); });
$('#showMask').addEventListener('change',e=>{ S.showMask=e.target.checked; $('#maskKey').hidden=!S.showMask; if(!S.showMask){ S.mask=false; render(); } if(!isMoving()) reclassify(); });
function setMask(arr,w,h){
  if(!arr||!S.showMask){ S.mask=false; return; }
  if(maskCv.width!==w||maskCv.height!==h){ maskCv.width=w; maskCv.height=h; }
  const mc=maskCv.getContext('2d'),img=mc.createImageData(w,h),d=img.data;
  for(let i=0,j=0;i<arr.length;i++,j+=4){
    const c=arr[i];
    if(c===1) continue;
    if(c===2){ d[j]=255; d[j+1]=50; d[j+2]=50; d[j+3]=170; }
    else if(c===3){ d[j]=255; d[j+1]=40; d[j+2]=210; d[j+3]=160; }
    else if(c===4){ d[j]=255; d[j+1]=190; d[j+2]=11; d[j+3]=170; }
    else { d[j]=8; d[j+1]=10; d[j+2]=12; d[j+3]=150; }
  }
  mc.putImageData(img,0,0); S.mask=true;
}
function updateStats(){
  const st=$('#holdStat'),wn=$('#holdWarn');
  if(!S.model){ st.textContent=S.src?'Tap a hold of your route to start.':'—'; wn.hidden=true; return; }
  const hs=currentHolds(),act=hs.filter(isActive).length,uns=hs.filter(h=>!isActive(h)&&!h.removed&&h.status==='unsure').length;
  st.textContent='';
  const b=document.createElement('b'); b.textContent=act;
  st.append(b,document.createTextNode(` ${S.model.name} hold${act===1?'':'s'} ${isMoving()?'tracked':'found'}${uns?` · ${uns} unsure (dashed amber)`:''}${S.wall?` · wall looks ${S.wall.name}`:''}`));
  let msg='';
  if(S.wall&&S.model){ const w=S.wall,m=S.model.mean,d=Math.hypot(0.5*(w.L-m[0]),w.a-m[1],w.b-m[2]); if(d<16) msg='This colour is close to the wall\'s own colour, so holds that blend in can be missed. Check the dashed ones.'; }
  if(!act&&!isMoving()) msg='No holds of this colour stand out from the wall. Tap a hold again, or move the slider toward Loose.';
  else if(act>45) msg='A lot of matches. Move the slider toward Strict, or turn on Show what matched to see what is being picked up.';
  wn.hidden=!msg; wn.textContent=msg;
}
const heightEl=$('#height'),wallEl=$('#wallM'),feetEl=$('#feet');
heightEl.value=S.heightCm; feetEl.value=S.feet;
heightEl.addEventListener('change',()=>{ const v=Math.max(110,Math.min(215,+heightEl.value||170)); heightEl.value=v; S.heightCm=v; store.set('height',v); solveSoon(); });
wallEl.addEventListener('change',()=>{ const v=Math.max(1.5,Math.min(9,+wallEl.value||4)); wallEl.value=v; S.wallM=v; if(S.src&&S.src.kind!=='sample'){ S.userWallM=v; store.set('wallM',v); } solveSoon(); });
feetEl.addEventListener('change',()=>{ S.feet=feetEl.value; store.set('feet',S.feet); solveSoon(); });
$('#callout').addEventListener('change',e=>{ S.callout=e.target.checked; if(S.callout&&S.beta) speak(S.beta.steps[S.step].title); });
const MODEHINT={floor:'Tap where the wall meets the floor or mat.',walltop:'Now tap the top edge of the wall.',pick:'Tap a hold to use its colour as the route.',edit:'Tap a ringed hold to remove it, tap a dashed amber one to keep it, or tap an empty spot to add a missed hold.',start:'Tap one or two holds to fix the start. Tap a chosen hold again to unset it.',top:'Tap the hold that marks the finish.'};
function setMode(m){
  S.mode=m;
  document.querySelectorAll('.seg button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===m)));
  $('#modeHint').textContent=MODEHINT[m]+(isMoving()&&m==='edit'?' To add holds, freeze the frame first.':'');
  if(S.src&&!isMoving()) render();
}
document.querySelectorAll('.seg button').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
function updateMarkUi(){
  const m=S.cal.marked;
  $('#clearMarks').hidden=!m;
  $('#markWall').textContent=m?'Mark again':'Mark wall bottom and top';
  $('#markHint').textContent=m?'Holds below the floor line or above the top line are ignored.':'Without marks, the whole picture counts as the wall: bottom edge is the floor, top edge is the top of the wall.';
}
$('#markWall').addEventListener('click',()=>{
  if(!S.src) return;
  setMode('floor');
  const r=wrap.getBoundingClientRect(); if(r.top<0||r.bottom>window.innerHeight) wrap.scrollIntoView({block:'start',behavior:reduceMotion?'auto':'smooth'});
  toast('Tap where the wall meets the floor or mat.');
});
$('#clearMarks').addEventListener('click',()=>{ S.cal={floor:1,top:0,marked:false}; updateMarkUi(); if(!isMoving()) render(); solveSoon(); });
cv.addEventListener('click',e=>{
  if(!S.src) return;
  const r=cv.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,u=x/S.view.dw,v=y/S.view.dh;
  if(S.mode==='floor'){
    S.cal.floor=Math.max(0.2,Math.min(1,v)); S.cal.marked=true;
    if(S.cal.top>=S.cal.floor-0.1) S.cal.top=0;
    setMode('walltop'); toast('Now tap the top edge of the wall.'); render(); return;
  }
  if(S.mode==='walltop'){
    if(v>=S.cal.floor-0.08){ toast('Tap above the floor line.'); return; }
    S.cal.top=Math.max(0,v); S.cal.marked=true;
    setMode('pick'); updateMarkUi(); toast('Wall marked'); render(); solveSoon(); return;
  }
  if(S.mode==='pick'){ pickAt(u,v); return; }
  if(!S.model){ toast('Pick a route colour first.'); return; }
  const h=hitHold(x,y);
  if(S.mode==='edit'){
    if(isMoving()){
      if(!h){ toast('Freeze the frame to add a missed hold.'); return; }
      if(isActive(h)){ h.removed=true; h.userOk=false; toast('Hold removed'); } else { h.userOk=true; h.removed=false; toast('Hold kept'); }
      updateStats(); solveSoon(); return;
    }
    const E=S.edits;
    if(h){
      if(isActive(h)){
        E.confirmed=E.confirmed.filter(p=>!nearPos(h,p));
        if(h.manual) E.added=E.added.filter(p=>!nearPos(h,p)); else E.removed.push({u:h.u,v:h.v});
        toast('Hold removed');
      }else{ E.confirmed.push({u:h.u,v:h.v}); E.removed=E.removed.filter(p=>!nearPos(h,p)); toast('Hold kept'); }
    }else{
      const rs=S.holds.filter(isActive).map(q=>q.rho).sort((p,q)=>p-q),rho=rs.length?rs[rs.length>>1]:0.012;
      E.added.push({u,v,rho}); toast('Hold added');
    }
    applyEdits(); updateStats(); render(); solveSoon(); return;
  }
  if(!h||!isActive(h)){ toast('Tap on a ringed hold.'); return; }
  const E=S.edits;
  if(S.mode==='start'){
    if(isMoving()){ if(E.startT.includes(h.id)) E.startT=E.startT.filter(id=>id!==h.id); else { E.startT.push(h.id); if(E.startT.length>2) E.startT.shift(); } }
    else{ if(E.start.some(p=>nearPos(h,p))) E.start=E.start.filter(p=>!nearPos(h,p)); else { E.start.push({u:h.u,v:h.v}); if(E.start.length>2) E.start.shift(); } }
  }else if(S.mode==='top'){
    if(isMoving()) E.topT=h.id; else E.top={u:h.u,v:h.v};
  }
  render(); solveSoon();
});
let toastT=0;
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>{ t.hidden=true; },2400); }
function busy(text){ const b=$('#busy'); if(text){ b.textContent=text; b.hidden=false; } else b.hidden=true; }

/* ---------- drawing ---------- */
function fit(){
  if(!S.src) return;
  const a=aspect(),maxW=wrap.clientWidth||600,maxH=Math.max(300,Math.min(window.innerHeight-210,1000));
  let dw=maxW,dh=dw/a; if(dh>maxH){ dh=maxH; dw=dh*a; }
  dw=Math.max(1,Math.floor(dw)); dh=Math.max(1,Math.floor(dh));
  const dpr=Math.min(window.devicePixelRatio||1,isMoving()?2:2.5);
  cv.style.width=dw+'px'; cv.style.height=dh+'px';
  cv.width=Math.round(dw*dpr); cv.height=Math.round(dh*dpr);
  veil.width=cv.width; veil.height=cv.height;
  S.view={dw,dh,dpr};
}
const P=(u,v)=>[u*S.view.dw,v*S.view.dh];
function drift(){
  if(!isMoving()||!S.betaSnap) return [0,0];
  let du=0,dv=0,n=0;
  for(const t of S.tracks){ const s=S.betaSnap.get(t.id); if(s&&t.miss<=3){ du+=t.u-s.u; dv+=t.v-s.v; n++; } }
  return n?[du/n,dv/n]:[0,0];
}
function cmPx(q,dr){ const k=kU(); return P(q[0]*k/aspect()+dr[0],S.cal.floor-q[1]*k+dr[1]); }
function tagAt(x,y,text,fill,ink){
  ctx.font=`13px ${MARKER}`;
  const w=ctx.measureText(text).width+9,h=17;
  ctx.save(); ctx.translate(x,y); ctx.rotate(-0.06);
  ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fillRect(-w/2+1.2,-h/2+1.6,w,h);
  ctx.fillStyle=fill; ctx.fillRect(-w/2,-h/2,w,h);
  ctx.fillStyle=ink; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(text,0,1);
  ctx.restore();
}
function render(){
  if(!S.src) return;
  const {dw,dh,dpr}=S.view;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,dw,dh);
  try{ ctx.drawImage(S.src.el,0,0,dw,dh); }catch(e){}
  const hs=currentHolds(),act=hs.filter(h=>isActive(h)&&onWall(h)),b=S.beta;
  if(S.showMask&&S.mask){ ctx.imageSmoothingEnabled=false; ctx.drawImage(maskCv,0,0,dw,dh); ctx.imageSmoothingEnabled=true; }
  else if(S.model&&act.length){
    const v=veil.getContext('2d');
    v.setTransform(1,0,0,1,0,0); v.clearRect(0,0,veil.width,veil.height);
    v.fillStyle='rgba(8,10,12,0.55)'; v.fillRect(0,0,veil.width,veil.height);
    v.setTransform(dpr,0,0,dpr,0,0); v.globalCompositeOperation='destination-out';
    for(const h of act){
      const [x,y]=P(h.u,h.v),r=h.rho*dh,R=r*1.55+6,g=v.createRadialGradient(x,y,r*1.05,x,y,R);
      g.addColorStop(0,'rgba(0,0,0,1)'); g.addColorStop(1,'rgba(0,0,0,0)');
      v.fillStyle=g; v.beginPath(); v.arc(x,y,R,0,6.283); v.fill();
    }
    v.globalCompositeOperation='source-over';
    ctx.setTransform(1,0,0,1,0,0); ctx.drawImage(veil,0,0); ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  const marking=S.mode==='floor'||S.mode==='walltop';
  if(S.cal.marked||marking){
    const lines=[];
    if(S.cal.marked||S.mode==='walltop') lines.push([S.cal.floor,'Floor']);
    if(S.cal.marked) lines.push([S.cal.top,'Top of wall']);
    for(const [lv,txt] of lines){
      const y=Math.min(dh-2,Math.max(2,lv*dh));
      ctx.setLineDash([8,6]); ctx.lineWidth=3.5; ctx.strokeStyle='rgba(0,0,0,.7)'; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(dw,y); ctx.stroke();
      ctx.lineWidth=1.8; ctx.strokeStyle='#ffd43b'; ctx.stroke(); ctx.setLineDash([]);
      tagAt(44,y<24?y+14:y-12,txt,'#ffd43b','#211c0a');
    }
  }
  const used=b?b.num:new Map();
  for(const h of hs){
    if(h.removed) continue;
    const active=isActive(h)&&onWall(h);
    if(!active&&h.status!=='unsure'&&!S.showMask) continue;
    const [x,y]=P(h.u,h.v),r=h.rho*dh+3;
    ctx.beginPath(); ctx.arc(x,y,r,0,6.283);
    if(active){ ctx.setLineDash(!b||used.has(h.id)?[]:[4,4]); ctx.lineWidth=3.6; ctx.strokeStyle='rgba(0,0,0,.75)'; ctx.stroke(); ctx.lineWidth=1.8; ctx.strokeStyle='#ffffff'; ctx.stroke(); }
    else if(h.status==='unsure'){ ctx.setLineDash([5,4]); ctx.lineWidth=3.4; ctx.strokeStyle='rgba(0,0,0,.7)'; ctx.stroke(); ctx.lineWidth=2; ctx.strokeStyle='#ffbe0b'; ctx.stroke(); }
    else { ctx.setLineDash([3,4]); ctx.lineWidth=1.5; ctx.strokeStyle='#ff2bd0'; ctx.stroke(); }
    ctx.setLineDash([]);
  }
  if(b&&b.steps.length) drawClimber();
  const topId=b?b.res.pts[b.res.top].id:null;
  for(const h of act){
    const [x,y]=P(h.u,h.v),r=h.rho*dh;
    if(h.id===topId){ const ty=y-r-14; tagAt(x,ty<12?y+r+14:ty,'TOP','#ffd43b','#211c0a'); }
    const n=used.get(h.id); if(n!=null) tagAt(x+r*0.85+7,y-r*0.85-6,String(n),'#ffd43b','#211c0a');
    if(isStart(h)) tagAt(x-r-10,y,'S','#ffffff','#14181c');
  }
}
function ik(Pt,T,L1,L2,pick){
  const dx=T[0]-Pt[0],dy=T[1]-Pt[1]; let d=Math.hypot(dx,dy);
  if(d<1e-6) return Pt;
  if(d>=L1+L2) return [Pt[0]+dx*L1/(L1+L2),Pt[1]+dy*L1/(L1+L2)];
  d=Math.max(d,Math.abs(L1-L2)+1e-3);
  const a=(L1*L1-L2*L2+d*d)/(2*d),h=Math.sqrt(Math.max(0,L1*L1-a*a)),mx=Pt[0]+dx*a/d,my=Pt[1]+dy*a/d;
  return pick([mx-dy*h/d,my+dx*h/d],[mx+dy*h/d,my-dx*h/d]);
}
/* The climber is drawn as a smooth white mannequin: rounded capsules for the
   limbs, a shaped torso and an oval head. Each layer (body, arms, then the
   head on top so it always shows) gets soft inner shading from its own
   outline and a drop shadow, rendered once per pose into an offscreen sprite. */
const figLayers={body:document.createElement('canvas'),arms:document.createElement('canvas'),head:document.createElement('canvas'),mask:document.createElement('canvas'),sprite:document.createElement('canvas')};
let figKey='';
function sizeCanvas(cv,w,h){ if(cv.width!==w||cv.height!==h){ cv.width=w; cv.height=h; } }
function capsule(g,A,B,r1,r2){
  const dx=B[0]-A[0],dy=B[1]-A[1],d=Math.hypot(dx,dy);
  if(d<=Math.abs(r1-r2)+0.5){ const r=Math.max(r1,r2),c=r1>=r2?A:B; g.moveTo(c[0]+r,c[1]); g.arc(c[0],c[1],r,0,Math.PI*2); return; }
  const a=Math.atan2(dy,dx),t=Math.acos(Math.max(-1,Math.min(1,(r1-r2)/d)));
  g.moveTo(A[0]+r1*Math.cos(a+t),A[1]+r1*Math.sin(a+t));
  g.lineTo(B[0]+r2*Math.cos(a+t),B[1]+r2*Math.sin(a+t));
  g.arc(B[0],B[1],r2,a+t,a-t,true);
  g.lineTo(A[0]+r1*Math.cos(a-t),A[1]+r1*Math.sin(a-t));
  g.arc(A[0],A[1],r1,a-t,a+t,true);
  g.closePath();
}
function torsoPath(g,c,s,U){
  const cx=c[0],yt=s[1]-U(0.035),yb=c[1]+U(0.055),yw=c[1]-U(0.12),yh=c[1];
  const ws=U(0.135),ww=U(0.104),wh=U(0.12),rc=U(0.07);
  g.moveTo(cx,yt);
  g.lineTo(cx+ws-rc,yt);
  g.quadraticCurveTo(cx+ws,yt,cx+ws,yt+rc);
  g.bezierCurveTo(cx+ws,yt+rc+(yw-yt-rc)*0.5,cx+ww,yw-(yw-yt)*0.2,cx+ww,yw);
  g.quadraticCurveTo(cx+ww,yh-U(0.04),cx+wh,yh);
  g.quadraticCurveTo(cx+wh,yb,cx,yb);
  g.quadraticCurveTo(cx-wh,yb,cx-wh,yh);
  g.quadraticCurveTo(cx-ww,yh-U(0.04),cx-ww,yw);
  g.bezierCurveTo(cx-ww,yw-(yw-yt)*0.2,cx-ws,yt+rc+(yw-yt-rc)*0.5,cx-ws,yt+rc);
  g.quadraticCurveTo(cx-ws,yt,cx-ws+rc,yt);
  g.closePath();
}
/* Fill the parts in white, then darken the edges with an inner shadow cast by
   everything outside the outline (stronger on the lower right, light from the
   upper left). */
function shadeLayer(cv,box,dpr,parts,soft){
  const W=Math.max(1,Math.ceil(box.w*dpr)),Hh=Math.max(1,Math.ceil(box.h*dpr));
  sizeCanvas(cv,W,Hh);
  const g=cv.getContext('2d');
  g.setTransform(1,0,0,1,0,0); g.globalCompositeOperation='source-over'; g.shadowColor='transparent'; g.clearRect(0,0,W,Hh);
  g.setTransform(dpr,0,0,dpr,-box.x*dpr,-box.y*dpr);
  g.fillStyle='#f5f5f2';
  for(const draw of parts){ g.beginPath(); draw(g); g.fill(); }
  const M=figLayers.mask; sizeCanvas(M,W,Hh);
  const m=M.getContext('2d');
  m.setTransform(1,0,0,1,0,0); m.globalCompositeOperation='source-over'; m.clearRect(0,0,W,Hh);
  m.fillStyle='#000'; m.fillRect(0,0,W,Hh);
  m.globalCompositeOperation='destination-out'; m.drawImage(cv,0,0);
  g.setTransform(1,0,0,1,0,0); g.globalCompositeOperation='source-atop';
  const bl=Math.max(2,soft*dpr);
  g.shadowColor='rgba(52,56,64,0.78)'; g.shadowBlur=bl; g.shadowOffsetX=-0.28*bl; g.shadowOffsetY=-0.42*bl; g.drawImage(M,0,0);
  g.shadowColor='rgba(70,74,82,0.55)'; g.shadowBlur=bl*0.5; g.shadowOffsetX=0; g.shadowOffsetY=0; g.drawImage(M,0,0);
  g.shadowColor='transparent'; g.globalCompositeOperation='source-over';
}
function drawClimber(){
  const b=S.beta,H=b.res.H,TORSO=b.res.TORSO,step=b.steps[S.step],p=currentPos(),C=p.C,dr=drift();
  const editing=S.mode!=='pick',dpr=S.view.dpr,k=kU()*S.view.dh,U=v=>v*H*k;
  const Sh=[C[0],C[1]+TORSO],Q=q=>cmPx(q,dr);
  const sh={lh:[Sh[0]-0.11*H,Sh[1]-0.01*H],rh:[Sh[0]+0.11*H,Sh[1]-0.01*H]},hip={lf:[C[0]-0.07*H,C[1]],rf:[C[0]+0.07*H,C[1]]};
  const ends={},flagged={},J={};
  for(const kk of ['lh','rh']){
    const T=p[kk]; ends[kk]=T;
    const E=ik(sh[kk],T,0.19*H,0.26*H,(a,c)=>a[1]<c[1]?a:c);
    J[kk]={a:Q(sh[kk]),e:Q(E),h:Q(T)};
  }
  for(const kk of ['lf','rf']){
    let T=p[kk]; if(!T){ T=flagPos(kk,C); flagged[kk]=true; }
    ends[kk]=T;
    const side=kk==='lf'?-1:1,K=ik(hip[kk],T,0.27*H,0.29*H,(a,c)=>(a[0]-C[0])*side>(c[0]-C[0])*side?a:c);
    J[kk]={a:Q(hip[kk]),e:Q(K),h:Q(T)};
  }
  const c=Q(C),s=Q(Sh),hd=Q([Sh[0],Sh[1]+0.122*H]);
  const pts=[c,s,hd]; for(const kk in J) pts.push(J[kk].a,J[kk].e,J[kk].h);
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for(const q of pts){ if(q[0]<x0)x0=q[0]; if(q[0]>x1)x1=q[0]; if(q[1]<y0)y0=q[1]; if(q[1]>y1)y1=q[1]; }
  const pad=U(0.24)+14,box={x:Math.floor(x0-pad),y:Math.floor(y0-pad),w:Math.ceil(x1-x0+2*pad),h:Math.ceil(y1-y0+2*pad)};
  const key=[dpr,box.x,box.y,box.w,box.h,k.toFixed(4)].concat(pts.map(q=>Math.round(q[0]*2)+','+Math.round(q[1]*2))).join('|');
  const SP=figLayers.sprite,SW=Math.max(1,Math.ceil(box.w*dpr)),SHh=Math.max(1,Math.ceil(box.h*dpr));
  if(key!==figKey){
    figKey=key;
    const disc=(g,q,r)=>{ g.moveTo(q[0]+r,q[1]); g.arc(q[0],q[1],r,0,Math.PI*2); };
    const bodyParts=[];
    for(const kk of ['lf','rf']){ const j=J[kk]; bodyParts.push(g=>capsule(g,j.a,j.e,U(0.064),U(0.054)),g=>capsule(g,j.e,j.h,U(0.054),U(0.046)),g=>disc(g,j.h,U(0.05))); }
    bodyParts.push(g=>torsoPath(g,c,s,U),g=>capsule(g,s,hd,U(0.036),U(0.036)));
    const headParts=[g=>{ g.moveTo(hd[0]+U(0.074),hd[1]); g.ellipse(hd[0],hd[1],U(0.074),U(0.086),0,0,Math.PI*2); }];
    const armParts=[];
    for(const kk of ['lh','rh']){ const j=J[kk]; armParts.push(g=>capsule(g,j.a,j.e,U(0.05),U(0.043)),g=>capsule(g,j.e,j.h,U(0.043),U(0.038)),g=>disc(g,j.h,U(0.05))); }
    shadeLayer(figLayers.body,box,dpr,bodyParts,U(0.065));
    shadeLayer(figLayers.arms,box,dpr,armParts,U(0.048));
    shadeLayer(figLayers.head,box,dpr,headParts,U(0.06));
    sizeCanvas(SP,SW,SHh);
    const g=SP.getContext('2d');
    g.setTransform(1,0,0,1,0,0); g.globalCompositeOperation='source-over'; g.clearRect(0,0,SW,SHh);
    const drop=(cv,blur,ox,oy,a)=>{
      g.shadowColor=`rgba(0,0,0,${a})`; g.shadowBlur=blur*dpr; g.shadowOffsetX=ox*dpr; g.shadowOffsetY=oy*dpr; g.drawImage(cv,0,0);
      g.shadowColor='rgba(0,0,0,0.5)'; g.shadowBlur=2.2*dpr; g.shadowOffsetX=0; g.shadowOffsetY=0; g.drawImage(cv,0,0);
    };
    drop(figLayers.body,Math.max(6,U(0.06)),U(0.016),U(0.032),0.45);
    drop(figLayers.arms,Math.max(4,U(0.035)),U(0.01),U(0.02),0.38);
    drop(figLayers.head,Math.max(4,U(0.035)),U(0.008),U(0.018),0.4);
    g.shadowColor='transparent';
  }
  ctx.save(); ctx.globalAlpha=editing?0.35:0.95;
  ctx.drawImage(SP,0,0,SW,SHh,box.x,box.y,SW/dpr,SHh/dpr);
  ctx.globalAlpha=editing?0.35:1;
  if(step.limb&&S.step>0&&!editing){
    const prev=b.steps[S.step-1].pos,a=prev[step.limb]||flagPos(step.limb,prev.C),z=step.pos[step.limb]||flagPos(step.limb,step.pos.C);
    const A=Q(a),Z=Q(z),ang=Math.atan2(Z[1]-A[1],Z[0]-A[0]),len=Math.hypot(Z[0]-A[0],Z[1]-A[1]);
    if(len>14){
      ctx.save(); ctx.strokeStyle=LIMBCOL[step.limb]; ctx.lineWidth=2.6; ctx.setLineDash([6,5]);
      const ex=Z[0]-Math.cos(ang)*12,ey=Z[1]-Math.sin(ang)*12;
      ctx.beginPath(); ctx.moveTo(A[0],A[1]); ctx.lineTo(ex,ey); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle=LIMBCOL[step.limb]; ctx.beginPath(); ctx.moveTo(ex+Math.cos(ang)*6,ey+Math.sin(ang)*6);
      ctx.lineTo(ex-Math.cos(ang-0.5)*9,ey-Math.sin(ang-0.5)*9); ctx.lineTo(ex-Math.cos(ang+0.5)*9,ey-Math.sin(ang+0.5)*9); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
  for(const kk of ['lh','rh','lf','rf']){
    const q=Q(ends[kk]),hand=kk[1]==='h',r=7,active=step.limb===kk;
    ctx.beginPath();
    if(hand) ctx.arc(q[0],q[1],r,0,6.283); else ctx.rect(q[0]-r,q[1]-r,2*r,2*r);
    ctx.fillStyle=flagged[kk]?'rgba(255,255,255,0.92)':LIMBCOL[kk]; ctx.fill();
    ctx.lineWidth=active?3:1.8; ctx.strokeStyle=active?'#ffffff':'rgba(10,12,14,0.85)'; ctx.stroke();
    if(active){ ctx.beginPath(); ctx.arc(q[0],q[1],r+5,0,6.283); ctx.lineWidth=2; ctx.strokeStyle=LIMBCOL[kk]; ctx.stroke(); }
    ctx.fillStyle=flagged[kk]?LIMBCOL[kk]:'#ffffff'; ctx.font='700 9.5px "Barlow Condensed",sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(kk[0]==='l'?'L':'R',q[0],q[1]+0.5);
  }
  ctx.restore();
}
let lastW=0;
new ResizeObserver(()=>{ const w=wrap.clientWidth; if(w&&w!==lastW){ lastW=w; fit(); render(); } }).observe(wrap);
if(document.fonts&&document.fonts.load) document.fonts.load(`16px ${MARKER}`).then(()=>{ if(!isMoving()) render(); }).catch(()=>{});

/* ---------- tabs ---------- */
function showTab(name){
  const learn=name==='learn';
  $('#view-wall').hidden=learn; $('#view-learn').hidden=!learn;
  $('#tab-wall').setAttribute('aria-selected',String(!learn)); $('#tab-learn').setAttribute('aria-selected',String(learn));
  if(learn) stopPlay(); else { lastW=0; fit(); render(); }
}
$('#tab-wall').addEventListener('click',()=>showTab('wall'));
$('#tab-learn').addEventListener('click',()=>showTab('learn'));

/* ---------- Ask Claude (only inside Claude, when the viewer allows it) ---------- */
let sampleFn=null,coachCtl=null;
const COACH_ERR={rate_limited:'Too many requests right now. Try again in a minute.',session_expired:'Sign in to Claude again, then retry.',image_rejected:'Claude could not read this picture. Try a smaller photo.',refused:'Claude declined this request. Try a different photo.',empty_completion:'No answer came back. Try again.',invalid_request:'The request could not be sent. Try again.',prompt_too_large:'The request was too large. Try a smaller photo.'};
const HIDE=['not_granted','sampling_disabled','not_declared','capability_disabled','capability_removed','images_unavailable'];
(async()=>{
  try{
    if(STANDALONE||!window.claude||typeof window.claude.use!=='function') return;
    const s=await window.claude.use('sample'); if(!s) return;
    const lim=await s.limits().catch(()=>null); if(!lim||!lim.images) return;
    sampleFn=s; $('#coach').hidden=false;
  }catch(e){}
})();
function coachImage(){
  const src=S.src,sw=src.w,sh=src.h,sc=Math.min(1,1100/Math.max(sw,sh));
  const c=document.createElement('canvas'); c.width=Math.round(sw*sc); c.height=Math.round(sh*sc);
  const g=c.getContext('2d'); g.drawImage(src.el,0,0,c.width,c.height);
  const num=S.beta?S.beta.num:new Map();
  for(const h of activeHolds()){
    const x=h.u*c.width,y=h.v*c.height,r=h.rho*c.height+3;
    g.beginPath(); g.arc(x,y,r,0,6.283); g.lineWidth=4; g.strokeStyle='#000'; g.stroke(); g.lineWidth=2; g.strokeStyle='#fff'; g.stroke();
    const n=num.get(h.id); if(n==null) continue;
    const tx=x+r+10,ty=y-r-8; g.font='bold 18px sans-serif'; const w=g.measureText(String(n)).width+10;
    g.fillStyle='#ffd43b'; g.fillRect(tx-w/2,ty-12,w,24); g.fillStyle='#000'; g.textAlign='center'; g.textBaseline='middle'; g.fillText(String(n),tx,ty+1);
  }
  return new Promise(res=>c.toBlob(b=>res(b),'image/jpeg',0.86));
}
$('#coachAsk').addEventListener('click',async()=>{
  if(!sampleFn||!S.src) return;
  if(!S.beta){ toast('Choose a route colour first so there are moves to check.'); return; }
  const out=$('#coachOut'),ask=$('#coachAsk'),stop=$('#coachStop');
  const lines=S.beta.steps.map((s,i)=>`${i===0?'S':i}. ${s.title} (${s.sub})`).join('\n');
  const prompt=`You are an experienced bouldering coach helping a beginner. The image is a photo of an indoor climbing wall. The holds of one route (colour: ${S.model.name}) are circled, and the ones used are labelled with yellow numbers in the order they are first touched. The climber is ${S.heightCm} cm tall. The bottom of the photo is the floor and the photo shows about ${S.wallM} m of wall.\n\nPlanned sequence:\n${lines}\n\nReply in plain text with no markdown symbols, under 230 words, in three short parts:\n1. Holds: one line per numbered hold with your best guess of its type (jug, edge, crimp, sloper, pinch, pocket, sidepull, undercling, volume) and how to grip it.\n2. Crux: which move looks hardest and one hand or foot tip for it.\n3. Check: anything in the sequence that looks wrong for this wall (for example a circled blob that is not a hold of this colour, or a better foot), and what to do instead.\nIf the photo is unclear, say so briefly.`;
  coachCtl=new AbortController();
  out.hidden=false; out.textContent='Thinking…'; ask.disabled=true; stop.hidden=false;
  try{
    const img=await coachImage();
    const {truncated}=await sampleFn(prompt,{images:img?[img]:undefined,signal:coachCtl.signal,onText:({text})=>{ out.textContent=text; }});
    if(truncated) out.textContent+='\n\n(The answer was cut short.)';
  }catch(e){
    const code=e&&e.code;
    if(HIDE.includes(code)){ $('#coach').hidden=true; return; }
    if(code==='cancelled') out.textContent=e.text||'Stopped.';
    else out.textContent=(e&&e.text?e.text+'\n\n':'')+(COACH_ERR[code]||'The connection dropped. Try again.');
  }finally{ ask.disabled=false; stop.hidden=true; }
});
$('#coachStop').addEventListener('click',()=>{ if(coachCtl) coachCtl.abort(); });

/* ---------- boot ---------- */
if(location.hash==='#learn') showTab('learn');
setSource({kind:'sample',el:makeSampleWall(),w:600,h:900});
})();
