/* ===================== page ===================== */
(function(){
'use strict';
const STANDALONE=false;
const $=s=>document.querySelector(s);
const MARKER='"Permanent Marker","Marker Felt",cursive';
const LIMBCOL={lh:'#18a7e0',rh:'#ec3b74',lf:'#58b52b',rf:'#f59f00'};
const LIMBS=['lh','rh','lf','rf'];
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
const newEdits=()=>({removed:[],confirmed:[],added:[],types:[],start:[],top:null,startT:[],topT:null});
const S={src:null,token:0,lastStill:null,model:null,tol:5,showMask:false,suggest:[],wall:null,frameH:640,
  holds:[],edits:newEdits(),tracks:[],lost:[],nextTrack:1,shift:[0,0],mask:false,
  beta:null,betaSnap:null,step:0,anim:null,playing:null,navT:0,mode:'pick',markReturn:null,view:{dw:1,dh:1,dpr:1},
  heightCm:store.get('height',170),spanCm:store.get('span',0),angle:store.get('angle',0),wallM:4.2,userWallM:store.get('wallM',4.2),feet:store.get('feet','strict'),callout:false,cal:{floor:1,top:0,marked:false},
  live:{raf:0,busy:false,last:0,stream:null,url:null,frames:0,fpsT:0,sig:'',sigT:0,solvedSig:'',diffT:0,modelT:0,solving:false,lastSug:0,statT:0,wake:null}};
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
  stopPlay(); closeTypePick();
  if(!opt.keepVideo) stopMedia();
  S.src=src; S.token++;
  if(src.kind==='photo'||src.kind==='sample') S.lastStill=src;
  S.holds=[]; S.tracks=[]; S.lost=[]; S.shift=[0,0]; S.mask=false; S.beta=null; S.betaSnap=null; S.step=0; S.anim=null;
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
  /* A new picture starts by picking the colour; a frozen frame keeps it. */
  setMode(opt.mode&&S.model?opt.mode:'pick');
  fit(); renderChips(); updateStats(); renderBeta();
  if(opt.reveal!==false&&S.token>1){ const r=wrap.getBoundingClientRect(); if(r.top<0||r.top>window.innerHeight*0.5) wrap.scrollIntoView({block:'start',behavior:reduceMotion?'auto':'smooth'}); }
  if(isMoving()){
    const L=S.live; Object.assign(L,{busy:false,last:0,sig:'',sigT:0,solvedSig:'',diffT:0,modelT:performance.now(),solving:false,lastSug:0,frames:0,fpsT:performance.now()});
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
  setSource({kind:'video',el:video,w:video.videoWidth,h:video.videoHeight},{keepModel:ownColour(),keepVideo:true});
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
  setSource({kind:'live',el:video,w:video.videoWidth,h:video.videoHeight},{keepModel:ownColour(),keepVideo:true});
}
/* A colour picked on the user's own picture carries over to a new clip or
   the camera (same wall); the sample wall's green does not. */
function ownColour(){ return !!S.src&&S.src.kind!=='sample'; }
function freeze(){
  if(!isMoving()||!video.videoWidth) return;
  const sw=video.videoWidth,sh=video.videoHeight,sc=Math.min(1,1600/Math.max(sw,sh));
  const c=document.createElement('canvas'); c.width=Math.round(sw*sc); c.height=Math.round(sh*sc);
  c.getContext('2d').drawImage(video,0,0,c.width,c.height);
  const E=newEdits();
  for(const t of S.tracks){
    if(t.removed) E.removed.push({u:t.u,v:t.v});
    if(t.userOk) E.confirmed.push({u:t.u,v:t.v});
    if(t.type) E.types.push({u:t.u,v:t.v,type:t.type});
    if(S.edits.startT.includes(t.id)) E.start.push({u:t.u,v:t.v});
    if(S.edits.topT===t.id) E.top={u:t.u,v:t.v};
  }
  stopMedia();
  setSource({kind:'photo',el:c,w:c.width,h:c.height},{keepModel:true,edits:E,keepCal:true,mode:'none'});
  toast('Frame frozen. You can now add holds by hand.');
}
$('#fileCam').addEventListener('change',e=>{ loadFile(e.target.files[0]); e.target.value=''; });
$('#fileVid').addEventListener('change',e=>{ loadFile(e.target.files[0]); e.target.value=''; });
$('#fileUp').addEventListener('change',e=>{ loadFile(e.target.files[0]); e.target.value=''; });
$('#useSample').addEventListener('click',()=>setSource({kind:'sample',el:makeSampleWall(),w:600,h:900}));
$('#goLive').addEventListener('click',startCamera);
$('#vFreeze').addEventListener('click',freeze);
$('#vStop').addEventListener('click',()=>{ stopMedia(); keepAwake(false); const st=S.lastStill||{kind:'sample',el:makeSampleWall(),w:600,h:900}; setSource(st,{keepModel:st.kind!=='sample'}); });
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
/* On a slab or overhang, the picture shows the wall's height; distances
   along the wall surface (what a body reaches across) are longer by 1/cos. */
const cosA=()=>Math.cos(Math.abs(S.angle||0)*Math.PI/180);
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
  setModel(r.model,quiet);
}
/* Same route colour? A re-tap of another hold of the same route gives a
   different model (light, shade and chalk change brightness and chroma). The
   same colour name counts as the same route, as people think of it ("the red
   one"); otherwise compare the way holds are matched: hue within the model's
   own hue window and chroma within a broad ratio, or brightness for black,
   white and grey. */
const hueGap=(a,b)=>Math.abs((((a-b)+540)%360)-180);
function sameRoute(a,b){
  if(a===b) return true;
  if(!a||!b) return false;
  if(a.name&&a.name===b.name) return true;
  if(!!a.achro!==!!b.achro) return false;
  if(a.achro) return Math.abs(a.mean[0]-b.mean[0])<15;
  const win=Math.max(10,Math.min(28,3*Math.max(a.hueSd||0,b.hueSd||0))),r=(b.chroma||1)/(a.chroma||1);
  return hueGap(a.hue,b.hue)<=win&&r>0.55&&r<1.8;
}
function hasEdits(){ const E=S.edits; return !!(E.removed.length||E.confirmed.length||E.added.length||E.types.length||E.start.length||E.top||E.startT.length||E.topT!=null); }
/* A route colour was chosen (tap or chip). Start, top and hold changes belong
   to one route, so they are kept when the same colour is picked again and
   cleared only when the colour really changes. Afterwards a tap on the wall
   does nothing until the user chooses a tool, so a stray tap can't re-learn
   the colour and change the path. */
function setModel(m,quiet){
  const old=S.model,same=!!old&&sameRoute(old,m);
  S.model=m; S.live.modelT=performance.now();
  if(old&&!same&&hasEdits()){ S.edits=newEdits(); if(!quiet) toast('New route colour, so its start, top and hold changes were cleared.'); }
  renderChips();
  if(isMoving()){
    /* Same colour: keep following the same holds (and the choices on them). */
    if(same) S.live.solvedSig='';
    else{
      S.tracks=[]; S.lost=[]; S.beta=null; S.live.solvedSig=''; renderBeta();
      setCaption('Reading the wall','Hold the phone steady for a second. The moves appear once the holds stop moving.',[]);
    }
  }
  else reclassify();
  setMode('none');
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
  /* colour chips: often until a colour is picked, then now and then, so
     another route's colour can still be chosen from a chip */
  const now=performance.now(),sug=now-L.lastSug>(S.model?6000:2500);
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
/* A hold the user chose as start or top, and any hold they removed or kept. */
const isPinned=t=>S.edits.startT.includes(t.id)||S.edits.topT===t.id;
const isMarked=t=>isPinned(t)||!!t.removed||!!t.userOk||!!t.type;
/* Follow holds between frames so they don't flicker: match each new blob to
   the nearest known hold, keep a running average, drop holds that vanish.
   Holds the user marked survive longer, and a hold that drops out is
   remembered for 15 s (moving with the camera), so when it comes back it gets
   its old identity, and the start, top or removal set on it, back. */
function updateTracks(blobs,w,h){
  const a=w/h,cand=blobs.filter(b=>b.status!=='rejected').map(b=>({u:b.x/w,v:b.y/h,rho:b.r/h,conf:b.conf,elong:b.elong,angle:b.angle,used:false}));
  const T=S.tracks,pairs=[],gate=(p,q)=>Math.max(0.03,2.2*Math.max(p.rho,q.rho)),dist=(p,q)=>Math.hypot((p.u-q.u)*a,p.v-q.v);
  for(const t of T){ t.pu=t.u+S.shift[0]; t.pv=t.v+S.shift[1]; t.m=null; }
  for(const t of T) for(const c of cand){ const d=Math.hypot((t.pu-c.u)*a,t.pv-c.v); if(d<gate(t,c)) pairs.push([d,t,c]); }
  pairs.sort((p,q)=>p[0]-q[0]);
  const du=[],dv=[];
  for(const [,t,c] of pairs){ if(t.m||c.used) continue; t.m=c; c.used=true; du.push(c.u-t.u); dv.push(c.v-t.v); }
  const med=v=>{ if(!v.length) return 0; const s=v.slice().sort((p,q)=>p-q); return s[s.length>>1]; };
  S.shift=[med(du)*0.8,med(dv)*0.8];
  const now=performance.now();
  for(const e of S.lost){ e.u+=S.shift[0]; e.v+=S.shift[1]; }
  S.lost=S.lost.filter(e=>now-e.t<15000&&e.u>-0.3&&e.u<1.3&&e.v>-0.3&&e.v<1.3);
  const keep=[],dropped=[];
  for(const t of T){
    if(t.m){ const c=t.m; t.u=t.pu+(c.u-t.pu)*0.7; t.v=t.pv+(c.v-t.pv)*0.7; t.rho=t.rho*0.7+c.rho*0.3; t.conf=t.conf*0.65+c.conf*0.35; t.elong=c.elong; t.angle=c.angle; t.hits++; t.miss=0; }
    else { t.u=t.pu; t.v=t.pv; t.miss++; }
    /* hysteresis: a hold near the threshold doesn't blink in and out */
    const was=t.status;
    t.status=t.conf>=0.5||(was==='hold'&&t.conf>=0.42)?'hold':t.conf>=0.33||(was==='unsure'&&t.conf>=0.28)?'unsure':'rejected';
    const life=isMarked(t)?30:t.hits>=10&&nearEdge(t)?14:t.hits>=4?7:2;
    if(t.miss<=life&&t.u>-0.1&&t.u<1.1&&t.v>-0.1&&t.v<1.1) keep.push(t); else if(t.hits>=3) dropped.push(t);
  }
  const mk=(c,id,old)=>({id,u:c.u,v:c.v,rho:c.rho,conf:c.conf,elong:c.elong,angle:c.angle,hits:old?Math.max(3,Math.min(old.hits,6)):1,miss:0,
    removed:old?old.removed:false,userOk:old?old.userOk:false,type:old?old.type||null:null,status:c.conf>=0.5?'hold':c.conf>=0.33?'unsure':'rejected'});
  for(const c of cand) if(!c.used){
    let bi=-1,bd=Infinity;
    for(let i=0;i<S.lost.length;i++){ const d=dist(S.lost[i],c); if(d<gate(S.lost[i],c)&&d<bd){ bd=d; bi=i; } }
    keep.push(bi>=0?mk(c,S.lost[bi].id,S.lost.splice(bi,1)[0]):mk(c,S.nextTrack++,null));
  }
  for(const t of dropped){
    /* The same hold may already be followed again under a new number (the
       old one drifted off); hand it the old number and the user's choices. */
    if(isMarked(t)){
      let tw=null,bd=Infinity;
      for(const k of keep){ if(isMarked(k)) continue; const d=dist(k,t); if(d<gate(k,t)&&d<bd){ bd=d; tw=k; } }
      if(tw){ tw.id=t.id; tw.removed=!!t.removed; tw.userOk=!!t.userOk; tw.type=t.type||null; tw.hits=Math.max(tw.hits,3); continue; }
    }
    S.lost.push({id:t.id,u:t.u,v:t.v,rho:t.rho,removed:!!t.removed,userOk:!!t.userOk,type:t.type||null,hits:t.hits,t:now});
  }
  if(S.lost.length>80) S.lost.splice(0,S.lost.length-80);
  S.tracks=keep;
}
/* Plan when the followed holds have settled for 0.8 s. A shaky phone can
   keep one hold blinking, so the first plan also comes 2 s after the colour
   was picked, and a later re-plan when at least two holds changed for 2 s. */
function checkLiveSolve(){
  const L=S.live,act=activeHolds(),ids=act.map(t=>t.id).sort((p,q)=>p-q),sig=ids.join(','),now=performance.now();
  if(sig!==L.sig){ L.sig=sig; L.sigT=now; }
  if(S.playing||L.solving||act.length<2||sig===L.solvedSig) return;
  /* while the user steps through the moves, a re-plan would jump back to the start */
  if(S.beta&&now-S.navT<10000) return;
  const solved=new Set(L.solvedSig?L.solvedSig.split(',').map(Number):[]);
  const diff=ids.filter(i=>!solved.has(i)).length+[...solved].filter(i=>!ids.includes(i)).length;
  if(diff>=2){ if(!L.diffT) L.diffT=now; } else L.diffT=0;
  const settled=now-L.sigT>800,first=!S.beta&&now-L.modelT>2000,big=!!L.diffT&&now-L.diffT>2000;
  if(settled||first||big){ L.solvedSig=sig; L.diffT=0; solveNow(true); }
}

/* ---------- holds, edits ---------- */
function nearPos(h,p){ return Math.hypot((h.u-p.u)*aspect(),h.v-p.v)<Math.max(h.rho,0.01)*1.3; }
function applyEdits(){
  const E=S.edits;
  S.holds=S.holds.filter(h=>!h.manual);
  for(const h of S.holds){ h.removed=E.removed.some(p=>nearPos(h,p)); h.userOk=E.confirmed.some(p=>nearPos(h,p)); }
  E.added.forEach((p,k)=>S.holds.push({id:5000+k,u:p.u,v:p.v,rho:p.rho,conf:1,status:'hold',manual:true,elong:1,angle:0}));
  for(const h of S.holds){ const q=E.types.find(p=>nearPos(h,p)); h.type=q?q.type:null; }
}
const isActive=h=>!h.removed&&(h.manual||h.userOk||h.status==='hold');
/* While moving, a chosen start or top hold stays in the plan through a few
   missed frames instead of flickering out and changing the path. */
/* A shaking phone moves holds at the edge of the view in and out of frame;
   a well-followed hold there stays in the plan while it is briefly out. */
const nearEdge=t=>t.u<0.06||t.u>0.94||t.v<0.06||t.v>0.94;
function currentHolds(){ return isMoving()?S.tracks.filter(t=>t.hits>=3&&(t.miss<=(t.hits>=10?(nearEdge(t)?12:4):2)||(t.miss<=12&&isPinned(t)))):S.holds; }
function onWall(h){ return h.v<=S.cal.floor+0.005&&h.v>=S.cal.top-0.02; }
function activeHolds(){ return currentHolds().filter(h=>isActive(h)&&onWall(h)); }
function isStart(h){ return isMoving()?S.edits.startT.includes(h.id):S.edits.start.some(p=>nearPos(h,p)); }
function hitHold(x,y,withRemoved){
  let best=null,bd=Infinity;
  for(const h of currentHolds()){ if(h.removed&&!withRemoved) continue; const [hx,hy]=P(h.u,h.v),d=Math.hypot(hx-x,hy-y); if(d<h.rho*S.view.dh+12&&d<bd){ bd=d; best=h; } }
  return best;
}

/* Size and shape of a hold in cm, and its type if the user set one. */
function holdMeta(h){ return {rCm:h.rho/kU(),elong:h.elong||1,angle:h.angle||0,type:h.type||null}; }
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
  const k=kU(),a=aspect(),fl=S.cal.floor,ca=cosA();
  const holds=act.map(h=>({id:h.id,X:h.u*a/k,Y:(fl-h.v)/k/ca,r:h.rho/k,type:h.type||null}));
  /* the hold the user chose, not just any hold nearby */
  const nearestId=p=>{ let b=null,bd=1e9; for(const h of act){ const d=Math.hypot((h.u-p.u)*a,h.v-p.v); if(d<bd){ bd=d; b=h; } } return b&&bd<Math.max(1.5*b.rho,0.02)?b.id:null; };
  const startIds=live?S.edits.startT.filter(id=>act.some(h=>h.id===id)):S.edits.start.map(nearestId).filter(x=>x!=null);
  const topId=live?(act.some(h=>h.id===S.edits.topT)?S.edits.topT:null):(S.edits.top?nearestId(S.edits.top):null);
  const snap=new Map(act.map(h=>[h.id,{u:h.u,v:h.v}]));
  if(live) S.live.solving=true; else busy('Working out your moves…');
  const o={H:S.heightCm,span:S.spanCm||S.heightCm,angle:S.angle||0,feet:S.feet,startIds,topId};
  let res=await solver.call({holds,o});
  /* Small footholds are often missed in a picture. If the route can't be
     finished on footholds of this colour, try again with the feet allowed to
     smear on the wall, and keep that plan if it gets further. */
  if(tok===S.token&&S.feet!=='open'&&!(res&&res.ok)){
    const r2=await solver.call({holds,o:Object.assign({},o,{feet:'open'})});
    const high=r=>r&&r.steps?Math.max(...r.steps.map(q=>Math.max(r.pts[q.lh].Y,r.pts[q.rh].Y))):-1;
    if(r2&&r2.steps&&(r2.ok||high(r2)>high(res)+5)){ res=r2; res.autoSmear=true; }
  }
  if(live) S.live.solving=false; else busy(false);
  if(tok!==S.token) return;
  if(!res||!res.steps){
    S.beta=null; renderBeta(res); render();
    setCaption('No starting position found','None of the low holds can be reached from the floor at your height. Use Set start to tap your start holds, or check Wall in view.',[]);
    return;
  }
  const meta=new Map(act.map(h=>[h.id,holdMeta(h)]));
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
  const smear=!!b.res.autoSmear;
  if(!b.ok){
    const last=b.res.steps[b.res.steps.length-1],y=Math.max(b.res.pts[last.lh].Y,b.res.pts[last.rh].Y);
    sum.textContent=`${b.hands} hand moves and ${b.feet} foot moves before getting stuck.`;
    warn.hidden=false;
    warn.textContent=`Stuck at about ${(y*cosA()/100).toFixed(1)} m: the next hold is out of reach for ${S.heightCm} cm${S.spanCm?` with a ${S.spanCm} cm arm span`:''}, or a hold wasn't found. ${smear?'':'Try Open feet, '}${smear?'Try':'or'} a looser colour match, add the missing hold with Add hold, or check the wall marks and angle.`;
  }else if(smear){
    warn.hidden=false;
    warn.textContent='Not enough footholds of this colour were found, so some steps put a foot flat on the wall (a smear). If you can see footholds of your colour there, add them with Add hold.';
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
    bt.addEventListener('click',()=>{ S.navT=performance.now(); stopPlay(); showStep(i,true); });
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
function setCaption(title,sub,tips,crux,how){
  const h=$('#capTitle'); h.textContent=title;
  if(crux){ const c=document.createElement('span'); c.className='crux'; c.textContent='Crux'; h.append(c); }
  $('#capSub').textContent=sub;
  const ul=$('#capTips'); ul.textContent='';
  for(const t of tips){ const li=document.createElement('li'); li.textContent=t; ul.append(li); }
  /* a button to watch how to use the hold of this move */
  const row=$('#capHow'); row.textContent='';
  for(const ty of (how||[]).slice(0,2)) if(HOLD_TYPES[ty]) row.append(howButton(ty,`How to use ${artName(ty)}`));
  row.hidden=!row.children.length;
}
const artName=ty=>{ const n=HOLD_TYPES[ty].name.toLowerCase(); return (/^[aeiou]/.test(n)?'an ':'a ')+n; };
function howButton(ty,label){
  const b=document.createElement('button'); b.type='button'; b.className='btn small';
  b.innerHTML=holdIconSvg(ty); b.append(document.createTextNode(label));
  b.addEventListener('click',()=>openDemo(ty,b));
  return b;
}
function speak(text){
  if(!S.callout||!('speechSynthesis' in window)) return;
  try{ speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text.replace(/→/g,' to ')); u.rate=1.03; speechSynthesis.speak(u); }catch(e){}
}
function showStep(i,animate){
  const b=S.beta; if(!b) return;
  i=Math.max(0,Math.min(b.steps.length-1,i));
  const H=b.res.H,arm=0.96*(b.res.ARM||0.5*H);
  /* a move started mid-move starts from what is on screen right now */
  let fromPos=b.steps[Math.min(S.step,b.steps.length-1)].pos;
  if(S.anim){ const c=currentPos(); fromPos={C:c.C,lh:c.lh,rh:c.rh,lf:c.lf,rf:c.rf,body:bodyFor(c,H,b.res.TORSO,arm)}; }
  S.step=i;
  const s=b.steps[i];
  setCaption(s.title,s.sub,s.tips,s.crux,s.how);
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
  if(animate&&!reduceMotion){
    /* longer moves take longer: 0.65 to 1.15 s */
    const dist=Math.max(...LIMBS.map(k=>{ const a=fromPos[k]||flagPos(k,fromPos.C,H),z=s.pos[k]||flagPos(k,s.pos.C,H); return Math.hypot(z[0]-a[0],z[1]-a[1]); }));
    const dyn=(s.reach||0)>1;
    S.anim={from:fromPos,to:s.pos,t0:performance.now(),dur:Math.max(650,Math.min(1150,560+5*dist)),opt:{H,dyn,bob:dyn?0.035*H:0}};
    if(!isMoving()) requestAnimationFrame(tick);
  }
  else { S.anim=null; if(!isMoving()) render(); }
}
function tick(){ if(!S.anim) return; render(); if(performance.now()-S.anim.t0<S.anim.dur) requestAnimationFrame(tick); else { S.anim=null; render(); } }
function flagPos(limb,C,H){ const sd=limb==='lf'?-1:1; return [C[0]+sd*0.4*H,C[1]-0.16*H]; }
/* Minimum-jerk timing: the smooth speed profile of human reaching (Flash and
   Hogan, 1985). Starts and stops gently, fastest in the middle. */
function ease(t){ t=t<0?0:t>1?1:t; return t*t*t*(10+t*(6*t-15)); }
function sameP(a,b){ return a===b||(!!a&&!!b&&Math.abs(a[0]-b[0])<0.01&&Math.abs(a[1]-b[1])<0.01); }
/* One move between two held positions, the way climbers are coached to move:
   on a hand move the legs drive the hips up first and the hand follows on a
   curved path, arriving last; on a foot move the foot lifts and goes first,
   then the hips shift over it. o.sag swings the hips through low, like a
   pendulum (slopers); o.dyn with o.bob is a deadpoint: the hips rise fast
   and the hand catches the hold at the top of the rise. */
function blendPose(from,to,t,o){
  const H=o.H,moved=LIMBS.filter(k=>!sameP(from[k],to[k]));
  const hand=moved.some(k=>k[1]==='h'),foot=moved.some(k=>k[1]==='f');
  let hipT,limbT;
  if(hand&&!foot){ hipT=ease(t/(o.dyn?0.55:0.7)); limbT=ease((t-(o.dyn?0.3:0.22))/(o.dyn?0.62:0.78)); }
  else if(foot&&!hand){ limbT=ease(t/0.62); hipT=ease((t-0.3)/0.7); }
  else { hipT=ease(t); limbT=hipT; }
  const C=[from.C[0]+(to.C[0]-from.C[0])*hipT,from.C[1]+(to.C[1]-from.C[1])*hipT];
  if(o.sag) C[1]-=o.sag*Math.sin(Math.PI*hipT);
  if(o.bob) C[1]+=o.bob*Math.sin(Math.PI*ease(t));
  const out={C,from,to,t:hipT};
  for(const k of LIMBS){
    if(!moved.includes(k)){ out[k]=to[k]; continue; }
    if(!to[k]&&t>=1){ out[k]=null; continue; }
    const A=from[k]||flagPos(k,from.C,H),B=to[k]||flagPos(k,to.C,H),dx=B[0]-A[0],dy=B[1]-A[1],len=Math.hypot(dx,dy);
    let x=A[0]+dx*limbT,y=A[1]+dy*limbT;
    if(len>1){
      /* hands swing out, away from the body; feet lift off and come back in */
      let nx=-dy/len,ny=dx/len;
      if(nx*(x-C[0])+ny*(y-C[1])<0){ nx=-nx; ny=-ny; }
      const hd=k[1]==='h',amp=Math.min(hd?0.05*H:0.035*H,(hd?0.14:0.18)*len)*Math.sin(Math.PI*limbT);
      x+=nx*amp; y+=ny*amp+(hd?0:0.3*amp);
    }
    out[k]=[x,y];
  }
  return out;
}
function currentPos(){
  const s=S.beta.steps[S.step].pos;
  if(!S.anim) return s;
  const {from,to,t0,dur,opt}=S.anim,t=Math.min(1,(performance.now()-t0)/dur);
  if(t>=1&&isMoving()) S.anim=null;
  return blendPose(from,to,t,opt);
}
$('#prev').addEventListener('click',()=>{ S.navT=performance.now(); stopPlay(); showStep(S.step-1,true); });
$('#next').addEventListener('click',()=>{ S.navT=performance.now(); stopPlay(); showStep(S.step+1,true); });
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
  if($('#view-wall').hidden||!$('#demo').hidden) return;
  if(/INPUT|SELECT|TEXTAREA/.test((e.target&&e.target.tagName)||'')) return;
  if(e.key==='ArrowRight'){ S.navT=performance.now(); stopPlay(); showStep(S.step+1,true); e.preventDefault(); }
  if(e.key==='ArrowLeft'){ S.navT=performance.now(); stopPlay(); showStep(S.step-1,true); e.preventDefault(); }
});

/* ---------- colour chips + controls ---------- */
const sameModel=(a,b)=>a===b||(!!a&&!!b&&a.achro===b.achro&&Math.abs(a.mean[0]-b.mean[0])<4&&Math.abs(a.mean[1]-b.mean[1])<3&&Math.abs(a.mean[2]-b.mean[2])<3);
function renderChips(){
  const box=$('#chips'); box.textContent='';
  const rank=m=>m.achro?2:/brown|beige/.test(m.name)?1:0;
  const cur=S.model;
  /* once a colour is picked, suggestions of that same colour would only be a
     second chip with the same name */
  const list=S.suggest.filter(m=>!cur||sameModel(m,cur)||!sameRoute(cur,m)).sort((p,q)=>rank(p)-rank(q)||(q.count||0)-(p.count||0)).slice(0,7);
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
function chooseModel(m){ setModel(m); }
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
const spanEl=$('#span'),angleEl=$('#angle');
spanEl.placeholder=S.heightCm; if(S.spanCm) spanEl.value=S.spanCm;
angleEl.value=String(S.angle||0); if(angleEl.value!==String(S.angle||0)){ S.angle=0; angleEl.value='0'; }
spanEl.addEventListener('change',()=>{
  const raw=spanEl.value.trim();
  if(!raw){ S.spanCm=0; store.set('span',0); solveSoon(); return; }
  const v=Math.max(100,Math.min(250,Math.round(+raw)||S.heightCm)); spanEl.value=v; S.spanCm=v; store.set('span',v); solveSoon();
});
angleEl.addEventListener('change',()=>{ S.angle=+angleEl.value||0; store.set('angle',S.angle); if(!isMoving()) render(); solveSoon(); });
heightEl.addEventListener('change',()=>{ const v=Math.max(110,Math.min(215,+heightEl.value||170)); heightEl.value=v; S.heightCm=v; store.set('height',v); $('#span').placeholder=v; solveSoon(); });
wallEl.addEventListener('change',()=>{ const v=Math.max(1.5,Math.min(9,+wallEl.value||4)); wallEl.value=v; S.wallM=v; if(S.src&&S.src.kind!=='sample'){ S.userWallM=v; store.set('wallM',v); } solveSoon(); });
feetEl.addEventListener('change',()=>{ S.feet=feetEl.value; store.set('feet',S.feet); solveSoon(); });
$('#callout').addEventListener('change',e=>{ S.callout=e.target.checked; if(S.callout&&S.beta) speak(S.beta.steps[S.step].title); });
/* Tapping the wall: first pick the colour, then choose a tool and tap a hold.
   The tools stay off until a colour is picked. */
const TOOLS=['add','remove','type','start','top'];
const MODEHINT={floor:'Tap where the wall meets the floor or mat.',walltop:'Now tap the top edge of the wall.',
  pick:'Tap one hold of your route to pick its colour.',
  none:'Colour picked. To change a hold, choose Add hold, Remove hold, Hold type, Set start or Set top, then tap the hold.',
  type:'Tap a ringed hold and choose what type it is: jug, crimp, sloper and so on. The plan and the tips use it.',
  add:'Tap a spot where a hold was missed, a dashed amber hold to keep it, or a crossed-out hold to put it back.',
  remove:'Tap a ringed hold to take it out of the route.',
  start:'Tap one or two holds to start on, one for each hand. Tap a chosen hold again to unset it.',
  top:'Tap the finishing hold. Tap it again to unset it.'};
function setMode(m){
  if(TOOLS.includes(m)&&!S.model) m='pick';
  if(m==='none'&&!S.model) m='pick';
  S.mode=m;
  if(m!=='type') closeTypePick(true);
  document.querySelectorAll('.seg button').forEach(b=>{
    b.setAttribute('aria-pressed',String(b.dataset.mode===m));
    if(TOOLS.includes(b.dataset.mode)) b.disabled=!S.model;
  });
  let hint=MODEHINT[m]||'';
  if(m==='pick'&&S.model) hint='Tap a hold to pick a new colour. Picking the same colour again keeps your start, top and hold changes.';
  if(m==='add'&&isMoving()) hint='Tap a dashed amber hold to keep it, or a crossed-out hold to put it back. To add a hold by hand, tap Freeze frame first.';
  $('#modeHint').textContent=hint;
  if(S.src&&!isMoving()) render();
}
document.querySelectorAll('.seg button').forEach(b=>b.addEventListener('click',()=>{
  const m=b.dataset.mode;
  /* tapping the tool that is on turns it off */
  setMode(S.mode===m&&S.model?'none':m);
}));
function updateMarkUi(){
  const m=S.cal.marked;
  $('#clearMarks').hidden=!m;
  $('#markWall').textContent=m?'Mark again':'Mark wall bottom and top';
  $('#markHint').textContent=m?'Holds below the floor line or above the top line are ignored.':'Without marks, the whole picture counts as the wall: bottom edge is the floor, top edge is the top of the wall. If the climber looks too big or too small next to the holds, mark the wall.';
}
$('#markWall').addEventListener('click',()=>{
  if(!S.src) return;
  if(S.mode!=='floor'&&S.mode!=='walltop') S.markReturn=S.mode;
  setMode('floor');
  const r=wrap.getBoundingClientRect(); if(r.top<0||r.bottom>window.innerHeight) wrap.scrollIntoView({block:'start',behavior:reduceMotion?'auto':'smooth'});
  toast('Tap where the wall meets the floor or mat.');
});
$('#clearMarks').addEventListener('click',()=>{ S.cal={floor:1,top:0,marked:false}; updateMarkUi(); if(!isMoving()) render(); solveSoon(); });
/* Edits on one hold. While moving they live on the followed hold (its id);
   on a still picture they are saved as positions, so they survive a
   re-read of the picture. */
function isTop(h){ return isMoving()?S.edits.topT===h.id:!!S.edits.top&&nearPos(h,S.edits.top); }
function unsetStart(h){ const E=S.edits; if(isMoving()) E.startT=E.startT.filter(id=>id!==h.id); else E.start=E.start.filter(p=>!nearPos(h,p)); }
function unsetTop(h){ const E=S.edits; if(!isTop(h)) return; if(isMoving()) E.topT=null; else E.top=null; }
/* A hold chosen as start or top stays in the route even if a later read
   finds it less clearly. */
function keepChosen(h){ if(isMoving()) h.userOk=true; else if(!h.manual&&!h.userOk) S.edits.confirmed.push({u:h.u,v:h.v}); }
let nudgeT=0;
function nudgeTools(){ const t=$('#tools'); t.classList.remove('nudge'); void t.offsetWidth; t.classList.add('nudge'); clearTimeout(nudgeT); nudgeT=setTimeout(()=>t.classList.remove('nudge'),1000); }
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
    const back=S.markReturn; S.markReturn=null;
    setMode(back||'none'); updateMarkUi(); toast('Wall marked'); render(); solveSoon(); return;
  }
  if(S.mode==='pick'||!S.model){ pickAt(u,v); return; }
  if(S.mode==='none'){ nudgeTools(); toast('First choose Add hold, Remove hold, Hold type, Set start or Set top.'); return; }
  const mv=isMoving(),E=S.edits;
  const changed=()=>{ if(!mv) applyEdits(); updateStats(); render(); solveSoon(); };
  if(S.mode==='add'){
    const h=hitHold(x,y,true);
    if(h&&h.removed){
      if(mv) h.removed=false; else E.removed=E.removed.filter(p=>!nearPos(h,p));
      toast('Hold put back');
    }else if(h&&!isActive(h)){
      if(mv) h.userOk=true; else E.confirmed.push({u:h.u,v:h.v});
      toast('Hold kept');
    }else if(h){ toast('That hold is already in the route.'); return; }
    else if(mv){ toast('No hold was found there. Tap Freeze frame first to add one by hand.'); return; }
    else{
      const rs=S.holds.filter(isActive).map(q=>q.rho).sort((p,q)=>p-q),rho=rs.length?rs[rs.length>>1]:0.012;
      E.added.push({u,v,rho}); toast('Hold added');
    }
    changed(); return;
  }
  const h=hitHold(x,y);
  if(!h||!isActive(h)){ toast(S.mode==='remove'?'Tap a ringed hold to remove it.':'Tap a ringed hold of your route.'); return; }
  if(S.mode==='type'){ openTypePick(h); return; }
  if(S.mode==='remove'){
    unsetStart(h); unsetTop(h);
    if(mv){ h.removed=true; h.userOk=false; h.type=null; }
    else{ E.confirmed=E.confirmed.filter(p=>!nearPos(h,p)); E.types=E.types.filter(p=>!nearPos(h,p)); if(h.manual) E.added=E.added.filter(p=>!nearPos(h,p)); else E.removed.push({u:h.u,v:h.v}); }
    toast('Hold removed'); changed(); return;
  }
  if(S.mode==='start'){
    if(isStart(h)){ unsetStart(h); toast('Start hold unset'); }
    else{
      const L=mv?E.startT:E.start;
      L.push(mv?h.id:{u:h.u,v:h.v}); if(L.length>2) L.shift();
      keepChosen(h);
      toast(L.length===2?'Both start holds set':'Start hold set. Tap another one for the other hand.');
    }
  }else if(S.mode==='top'){
    if(isTop(h)){ unsetTop(h); toast('Top unset'); }
    else{ if(mv) E.topT=h.id; else E.top={u:h.u,v:h.v}; keepChosen(h); toast('Top set'); }
  }
  changed();
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
function cmPx(q,dr){ const k=kU(); return P(q[0]*k/aspect()+dr[0],S.cal.floor-q[1]*k*cosA()+dr[1]); }
function tagAt(x,y,text,fill,ink,size,g){
  size=size||13; g=g||ctx;
  g.font=`${size}px ${MARKER}`;
  const w=g.measureText(text).width+9*size/13,h=size+4;
  g.save(); g.translate(x,y); g.rotate(-0.06);
  g.fillStyle='rgba(0,0,0,0.35)'; g.fillRect(-w/2+1.2,-h/2+1.6,w,h);
  g.fillStyle=fill; g.fillRect(-w/2,-h/2,w,h);
  g.fillStyle=ink; g.textAlign='center'; g.textBaseline='middle'; g.fillText(text,0,1);
  g.restore();
  return w;
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
    if(h.removed){
      /* While adding, removed holds show crossed out so they can be put back. */
      if(S.mode!=='add') continue;
      const [x,y]=P(h.u,h.v),r=h.rho*dh+3,k=Math.min(r*0.5,7);
      ctx.beginPath(); ctx.arc(x,y,r,0,6.283); ctx.moveTo(x-k,y-k); ctx.lineTo(x+k,y+k); ctx.moveTo(x+k,y-k); ctx.lineTo(x-k,y+k);
      ctx.setLineDash([4,3]); ctx.lineWidth=3.4; ctx.strokeStyle='rgba(0,0,0,.7)'; ctx.stroke();
      ctx.lineWidth=1.8; ctx.strokeStyle='#ff6b6b'; ctx.stroke(); ctx.setLineDash([]);
      continue;
    }
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
    /* the hold type: set ones always, guesses while the Hold type tool is on */
    if(h.type) tagAt(x,y+r+12,HOLD_TYPES[h.type].name,'#ffffff','#14181c',11);
    else if(S.mode==='type'){ const g=guessType(holdMeta(h)); if(g){ ctx.save(); ctx.globalAlpha=0.72; tagAt(x,y+r+12,HOLD_TYPES[g].name+'?','#dfe3e7','#14181c',11); ctx.restore(); } }
  }
  const ph=S.mode==='type'?typePickHold():null;
  if(ph){
    const [x,y]=P(ph.u,ph.v),r=ph.rho*dh+7;
    ctx.beginPath(); ctx.arc(x,y,r,0,6.283); ctx.lineWidth=6; ctx.strokeStyle='rgba(0,0,0,.6)'; ctx.stroke(); ctx.lineWidth=3; ctx.strokeStyle='#ffd43b'; ctx.stroke();
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
/* The climber is drawn from behind as a smooth white mannequin facing the
   wall: rounded limbs, a shaped torso with spine, shoulder blades and glutes,
   the back of the head, elbows pointing out and down, and dark climbing shoes
   with the toe on the foothold and the heel toward you. Each layer (arms at
   the back, then body, head on top) gets soft inner shading and a drop
   shadow, rendered once per pose into an offscreen sprite. */
const SKIN='#f5f5f2',SHOE='#2c3038',SHOE_RAND='#4a505b';
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
/* Torso in a local frame: hip centre at (0,0), shoulder centre at (0,-L). */
function torsoPath(g,L,U){
  const yt=-L-U(0.035),yb=U(0.055),yw=-U(0.12),yh=0;
  const ws=U(0.135),ww=U(0.104),wh=U(0.12),rc=U(0.07);
  g.moveTo(0,yt);
  g.lineTo(ws-rc,yt);
  g.quadraticCurveTo(ws,yt,ws,yt+rc);
  g.bezierCurveTo(ws,yt+rc+(yw-yt-rc)*0.5,ww,yw-(yw-yt)*0.2,ww,yw);
  g.quadraticCurveTo(ww,yh-U(0.04),wh,yh);
  g.quadraticCurveTo(wh,yb,0,yb);
  g.quadraticCurveTo(-wh,yb,-wh,yh);
  g.quadraticCurveTo(-ww,yh-U(0.04),-ww,yw);
  g.bezierCurveTo(-ww,yw-(yw-yt)*0.2,-ws,yt+rc+(yw-yt-rc)*0.5,-ws,yt+rc);
  g.quadraticCurveTo(-ws,yt,-ws+rc,yt);
  g.closePath();
}
/* Fill the parts, darken the edges with an inner shadow cast by everything
   outside the outline (stronger on the lower right, light from the upper
   left), then draw surface details clipped to the shape. */
function shadeLayer(cv,M,box,dpr,parts,soft,details){
  const W=Math.max(1,Math.ceil(box.w*dpr)),Hh=Math.max(1,Math.ceil(box.h*dpr));
  sizeCanvas(cv,W,Hh);
  const g=cv.getContext('2d');
  g.setTransform(1,0,0,1,0,0); g.globalCompositeOperation='source-over'; g.shadowColor='transparent'; g.clearRect(0,0,W,Hh);
  const base=()=>g.setTransform(dpr,0,0,dpr,-box.x*dpr,-box.y*dpr);
  base();
  for(const pt of parts){ g.save(); g.fillStyle=pt.color||SKIN; g.beginPath(); pt.draw(g); g.fill(); g.restore(); base(); }
  sizeCanvas(M,W,Hh);
  const m=M.getContext('2d');
  m.setTransform(1,0,0,1,0,0); m.globalCompositeOperation='source-over'; m.clearRect(0,0,W,Hh);
  m.fillStyle='#000'; m.fillRect(0,0,W,Hh);
  m.globalCompositeOperation='destination-out'; m.drawImage(cv,0,0);
  g.setTransform(1,0,0,1,0,0); g.globalCompositeOperation='source-atop';
  const bl=Math.max(2,soft*dpr);
  g.shadowColor='rgba(52,56,64,0.78)'; g.shadowBlur=bl; g.shadowOffsetX=-0.28*bl; g.shadowOffsetY=-0.42*bl; g.drawImage(M,0,0);
  g.shadowColor='rgba(70,74,82,0.55)'; g.shadowBlur=bl*0.5; g.shadowOffsetX=0; g.shadowOffsetY=0; g.drawImage(M,0,0);
  g.shadowColor='transparent';
  if(details){ base(); g.globalCompositeOperation='source-atop'; details(g); }
  g.setTransform(1,0,0,1,0,0); g.globalCompositeOperation='source-over';
}
/* A real knee or elbow bends partly toward the wall, so from behind it only
   shows part of its sideways swing: keep that fraction of the flat solution. */
function bend3d(A,T,E,t,f){
  const m=[A[0]+(T[0]-A[0])*t,A[1]+(T[1]-A[1])*t];
  return [m[0]+(E[0]-m[0])*f,m[1]+(E[1]-m[1])*f];
}
/* Body geometry shared by the lean search and the drawing (cm, Y up). */
function upperBody(C,a,H,TORSO){
  const up=[Math.sin(a),Math.cos(a)],across=[Math.cos(a),-Math.sin(a)];
  const Sh=[C[0]+up[0]*TORSO,C[1]+up[1]*TORSO];
  const joint=side=>[Sh[0]+side*across[0]*0.11*H-up[0]*0.01*H,Sh[1]+side*across[1]*0.11*H-up[1]*0.01*H];
  return {up,across,Sh,head:[Sh[0]+up[0]*0.122*H,Sh[1]+up[1]*0.122*H],lh:joint(-1),rh:joint(1)};
}
/* Elbows point out to the side and down, as they do from behind. */
/* arm = shoulder to hand centre (0.48H for an arm span equal to height) */
function elbowAt(A,T,side,H,arm){
  return bend3d(A,T,ik(A,T,0.42*arm,0.58*arm,(e1,e2)=>{ const sc=e=>side*(e[0]-A[0])-0.6*(e[1]-A[1]); return sc(e1)>=sc(e2)?e1:e2; }),0.42,0.55);
}
/* Reaching to full length lifts the shoulder (up to 0.05H) toward the hand,
   as a real reach does, so a long move looks like a reach, not a rubber arm. */
function reachJoint(J,T,arm,H){
  const dx=T[0]-J[0],dy=T[1]-J[1],d=Math.hypot(dx,dy),x=Math.min(Math.max(0,d-arm),0.05*H);
  return x>0?[J[0]+dx/d*x,J[1]+dy/d*x]:J;
}
/* Where to draw the hips and how far the upper body leans (radians, +
   toward the right). The planner's hip is the centre of the weight; the
   drawing may let it sink up to 0.15H, or crouch up to 0.2H while a foot is
   still on the mat (straighter arms, more bent knees; never closer than 0.22H
   above the higher foot), and swings the shoulders around it, at most 0.5 rad
   either way. It leans toward the hands, keeps each hand within
   arm's length, and keeps the hands and arms clear of the head, so a hand
   never sits on the head and an arm never wraps over or behind it. */
const bodyMemo=new Map();
function chooseBody(p,H,TORSO,arm){
  const lh=p.lh,rh=p.rh,C0=p.C,r1=v=>v?Math.round(v[0]*10)+','+Math.round(v[1]*10):'-';
  const key=[H,TORSO,arm,r1(C0),r1(lh),r1(rh),r1(p.lf),r1(p.rf),p.fixHip?1:0].join('|');
  if(bodyMemo.has(key)) return bodyMemo.get(key);
  const sq=v=>v*v,hm=[(lh[0]+rh[0])/2,(lh[1]+rh[1])/2],matched=Math.hypot(lh[0]-rh[0],lh[1]-rh[1])<0.03*H;
  let footY=-Infinity,onMat=false;
  for(const f of [p.lf,p.rf]) if(f){ if(f[1]>footY) footY=f[1]; if(f[1]<1) onMat=true; }
  const room=p.fixHip?0:Math.max(0,Math.min(onMat?0.2*H:0.15*H,C0[1]-footY-0.22*H));
  const a0=Math.max(-0.35,Math.min(0.35,0.5*Math.atan2(hm[0]-C0[0],Math.max(0.3*H,hm[1]-C0[1]))));
  const cost=(drop,a)=>{
    const B=upperBody([C0[0],C0[1]-drop],a,H,TORSO),hd=B.head;
    const loc=(P,rx,ry)=>[((P[0]-hd[0])*B.across[0]+(P[1]-hd[1])*B.across[1])/rx,((P[0]-hd[0])*B.up[0]+(P[1]-hd[1])*B.up[1])/ry];
    /* An arm segment that overlaps the head costs a little when it passes
       beside it (a raised arm next to the head is normal) and a lot when it
       crosses behind it from one side to the other. */
    const seg=(P,Q)=>{ const p=loc(P,0.104*H,0.116*H),q=loc(Q,0.104*H,0.116*H),dx=q[0]-p[0],dy=q[1]-p[1],l2=dx*dx+dy*dy;
      const t=l2>0?Math.max(0,Math.min(1,-(p[0]*dx+p[1]*dy)/l2)):0,e=Math.hypot(p[0]+dx*t,p[1]+dy*t);
      if(e>=1) return 0;
      const across=p[0]*q[0]<0&&Math.min(Math.abs(p[0]),Math.abs(q[0]))>0.15;
      return (across?40:4)*sq(1-e); };
    let c=6*sq(a-a0)+20*sq(Math.max(0,Math.abs(a)-0.3))+0.6*sq(drop/(0.1*H));
    for(const [T,side,kk] of [[lh,-1,'lh'],[rh,1,'rh']]){
      const J=reachJoint(B[kk],T,arm,H),E=elbowAt(J,T,side,H,arm);
      const d=Math.hypot(T[0]-J[0],T[1]-J[1]); if(d>arm) c+=sq((d-arm)/(0.06*H));
      c+=seg(J,E)+seg(E,T);
      /* a hand needs more room above the head than beside it (a matched
         pair counts once) */
      const t=loc(T,0.114*H,1),e=Math.hypot(t[0],t[1]/((t[1]>0?0.15:0.126)*H)); if(e<1.25&&!(matched&&kk==='rh')) c+=20*sq(1.25-e);
      /* around head height each hand stays on its own side of the head (a
         matched pair can't, so it is left out; well above the head the arm
         passes over it anyway) */
      if(!matched){
        const v=(T[0]-B.Sh[0])*B.up[0]+(T[1]-B.Sh[1])*B.up[1];
        const w=Math.max(0,Math.min(1,0.5+v/(0.1*H)))*Math.max(0,Math.min(1,(0.35*H-v)/(0.1*H)));
        c+=10*w*sq(1.14*Math.max(0,-side*t[0]));
      }
    }
    return c;
  };
  /* coarse grid, then refine around the best */
  let best={c:Infinity,drop:0,a:a0};
  for(let j=0;j<=4;j++) for(let i=-12;i<=12;i++){ const drop=room*j/4,a=i*0.04,c=cost(drop,a); if(c<best.c) best={c,drop,a}; }
  const d0=best.drop,a1=best.a;
  for(let j=-1;j<=1;j++) for(let i=-3;i<=3;i++){
    const drop=Math.max(0,Math.min(room,d0+j*room/8)),a=a1+i*0.01;
    if(Math.abs(a)>0.5) continue;
    const c=cost(drop,a); if(c<best.c) best={c,drop,a};
  }
  const val={drop:best.drop,lean:best.a};
  if(bodyMemo.size>64) bodyMemo.clear();
  bodyMemo.set(key,val);
  return val;
}
/* While a move animates, blend the body between the two held positions so
   the torso turns smoothly instead of flipping between solutions. A move
   started mid-animation blends from what was on screen at that moment. */
function bodyFor(p,H,TORSO,arm){
  if(p.body) return p.body;
  if(!p.from) return chooseBody(p,H,TORSO,arm);
  const a=bodyFor(p.from,H,TORSO,arm),b=bodyFor(p.to,H,TORSO,arm);
  return {drop:a.drop+(b.drop-a.drop)*p.t,lean:a.lean+(b.lean-a.lean)*p.t};
}
/* Joint positions for a pose (cm), mapped to the screen by Q. bd is the
   body (hip sink and lean) from bodyFor() or a demo key. */
function figureGeom(p,H,TORSO,arm,Q,bd){
  const C=[p.C[0],p.C[1]-bd.drop],B=upperBody(C,bd.lean,H,TORSO),Sh=B.Sh;
  const hip={lf:[C[0]-0.07*H,C[1]],rf:[C[0]+0.07*H,C[1]]};
  const ends={},flagged={},J={},shoe={};
  for(const kk of ['lh','rh']){
    const T=p[kk],A=B[kk]; ends[kk]=T;
    const A2=reachJoint(A,T,arm,H);
    J[kk]={a:Q(A2),e:Q(elbowAt(A2,T,kk==='lh'?-1:1,H,arm)),h:Q(T)};
  }
  for(const kk of ['lf','rf']){
    let T=p[kk]; const side=kk==='lf'?-1:1;
    if(!T){ T=flagPos(kk,p.C,H); flagged[kk]=true; }
    ends[kk]=T;
    /* Toe on the hold, ankle just above it; the leg ends at the ankle. */
    const ank=flagged[kk]?[T[0]-side*0.05*H,T[1]+0.02*H]:[T[0],T[1]+0.05*H];
    const K=bend3d(hip[kk],ank,ik(hip[kk],ank,0.27*H,0.25*H,(a,c)=>(a[0]-C[0])*side>(c[0]-C[0])*side?a:c),0.27/0.52,0.35);
    J[kk]={a:Q(hip[kk]),e:Q(K),h:Q(ank)};
    shoe[kk]={ank:Q(ank),toe:Q(T),heel:Q([ank[0]+(flagged[kk]?side*0.01*H:0),ank[1]-0.03*H])};
  }
  const c=Q(C),s=Q(Sh),hd=Q(B.head);
  const pts=[c,s,hd]; for(const kk in J) pts.push(J[kk].a,J[kk].e,J[kk].h); for(const kk in shoe) pts.push(shoe[kk].toe);
  return {J,shoe,ends,flagged,c,s,hd,pts};
}
/* Render the figure into the layer set's sprite (only when the pose or view
   changed). scale = px per unit of height (H x px per cm). */
function paintFigure(Ly,G,scale,dpr){
  const U=v=>v*scale,{J,shoe,c,s,hd,pts}=G;
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for(const q of pts){ if(q[0]<x0)x0=q[0]; if(q[0]>x1)x1=q[0]; if(q[1]<y0)y0=q[1]; if(q[1]>y1)y1=q[1]; }
  const pad=U(0.24)+14,box={x:Math.floor(x0-pad),y:Math.floor(y0-pad),w:Math.ceil(x1-x0+2*pad),h:Math.ceil(y1-y0+2*pad)};
  const key=[dpr,box.x,box.y,box.w,box.h,scale.toFixed(3)].concat(pts.map(q=>Math.round(q[0]*2)+','+Math.round(q[1]*2))).join('|');
  const SP=Ly.sprite,SW=Math.max(1,Math.ceil(box.w*dpr)),SHh=Math.max(1,Math.ceil(box.h*dpr));
  if(key!==Ly.key){
    Ly.key=key;
    const disc=(g,q,r)=>{ g.moveTo(q[0]+r,q[1]); g.arc(q[0],q[1],r,0,Math.PI*2); };
    const L=Math.hypot(s[0]-c[0],s[1]-c[1]),rot=Math.atan2(s[0]-c[0],c[1]-s[1]);
    const local=(g,fn)=>{ g.translate(c[0],c[1]); g.rotate(rot); fn(g); };
    const bodyParts=[];
    for(const kk of ['lf','rf']){
      const j=J[kk],sh2=shoe[kk];
      bodyParts.push({draw:g=>capsule(g,j.a,j.e,U(0.064),U(0.054))},{draw:g=>capsule(g,j.e,j.h,U(0.054),U(0.04))});
      bodyParts.push({color:SHOE,draw:g=>capsule(g,sh2.ank,sh2.toe,U(0.042),U(0.03))},{color:SHOE,draw:g=>disc(g,sh2.heel,U(0.036))});
    }
    bodyParts.push({draw:g=>local(g,gg=>torsoPath(gg,L,U))},{draw:g=>capsule(g,s,hd,U(0.036),U(0.036))});
    const stroke=(g,w,col,path)=>{ g.lineWidth=w; g.strokeStyle=col; g.lineCap='round'; g.beginPath(); path(); g.stroke(); };
    const bodyDetails=g=>{
      g.save();
      local(g,gg=>{
        const crease='rgba(62,66,74,0.28)',soft2='rgba(62,66,74,0.16)',lit='rgba(255,255,255,0.55)';
        /* spine groove */
        stroke(gg,U(0.014),soft2,()=>{ gg.moveTo(0,-L+U(0.07)); gg.lineTo(0,-U(0.06)); });
        stroke(gg,U(0.006),lit,()=>{ gg.moveTo(-U(0.009),-L+U(0.08)); gg.lineTo(-U(0.009),-U(0.08)); });
        for(const sg of [-1,1]){
          /* shoulder blades */
          stroke(gg,U(0.012),soft2,()=>{ gg.moveTo(sg*U(0.035),-L+U(0.06)); gg.quadraticCurveTo(sg*U(0.105),-L+U(0.06),sg*U(0.095),-L+U(0.17)); });
          /* glutes: fold under each cheek */
          stroke(gg,U(0.012),crease,()=>{ gg.moveTo(sg*U(0.004),U(0.05)); gg.quadraticCurveTo(sg*U(0.07),U(0.075),sg*U(0.115),U(0.012)); });
        }
        /* cleft between the glutes and the waistline above them */
        stroke(gg,U(0.01),crease,()=>{ gg.moveTo(0,-U(0.035)); gg.lineTo(0,U(0.052)); });
        stroke(gg,U(0.01),soft2,()=>{ gg.moveTo(-U(0.1),-U(0.075)); gg.quadraticCurveTo(0,-U(0.055),U(0.1),-U(0.075)); });
      });
      g.restore();
      /* creases behind the knees */
      for(const kk of ['lf','rf']){
        const j=J[kk],t1=Math.atan2(j.a[1]-j.e[1],j.a[0]-j.e[0]),t2=Math.atan2(j.h[1]-j.e[1],j.h[0]-j.e[0]);
        let bis=(t1+t2)/2; if(Math.abs(t1-t2)>Math.PI) bis+=Math.PI;
        const nx=Math.cos(bis+Math.PI/2),ny=Math.sin(bis+Math.PI/2),r=U(0.035);
        stroke(g,U(0.009),'rgba(62,66,74,0.22)',()=>{ g.moveTo(j.e[0]-nx*r,j.e[1]-ny*r); g.quadraticCurveTo(j.e[0]+Math.cos(bis)*U(0.012),j.e[1]+Math.sin(bis)*U(0.012),j.e[0]+nx*r,j.e[1]+ny*r); });
      }
      /* rubber rand along the bottom of each shoe */
      for(const kk of ['lf','rf']){ const sh2=shoe[kk]; stroke(g,U(0.012),SHOE_RAND,()=>{ g.moveTo(sh2.heel[0]-U(0.03),sh2.heel[1]+U(0.012)); g.quadraticCurveTo(sh2.heel[0],sh2.heel[1]+U(0.04),sh2.heel[0]+U(0.03),sh2.heel[1]+U(0.012)); }); }
    };
    const armParts=[];
    for(const kk of ['lh','rh']){ const j=J[kk]; armParts.push({draw:g=>capsule(g,j.a,j.e,U(0.05),U(0.043))},{draw:g=>capsule(g,j.e,j.h,U(0.043),U(0.038))},{draw:g=>disc(g,j.h,U(0.048))}); }
    const armDetails=g=>{
      /* point of each elbow */
      for(const kk of ['lh','rh']){ const j=J[kk]; stroke(g,U(0.01),'rgba(62,66,74,0.2)',()=>{ g.arc(j.e[0],j.e[1],U(0.022),0,Math.PI*2); }); }
    };
    const headParts=[{draw:g=>{ g.moveTo(hd[0]+U(0.074),hd[1]); g.ellipse(hd[0],hd[1],U(0.074),U(0.086),rot,0,Math.PI*2); }}];
    const headDetails=g=>{
      /* the nape: where the back of the skull meets the neck */
      g.save(); g.translate(hd[0],hd[1]); g.rotate(rot);
      stroke(g,U(0.012),'rgba(62,66,74,0.2)',()=>{ g.moveTo(-U(0.045),U(0.06)); g.quadraticCurveTo(0,U(0.085),U(0.045),U(0.06)); });
      g.restore();
    };
    shadeLayer(Ly.body,Ly.mask,box,dpr,bodyParts,U(0.065),bodyDetails);
    shadeLayer(Ly.arms,Ly.mask,box,dpr,armParts,U(0.048),armDetails);
    shadeLayer(Ly.head,Ly.mask,box,dpr,headParts,U(0.06),headDetails);
    sizeCanvas(SP,SW,SHh);
    const g=SP.getContext('2d');
    g.setTransform(1,0,0,1,0,0); g.globalCompositeOperation='source-over'; g.clearRect(0,0,SW,SHh);
    const drop=(cv,blur,ox,oy,a)=>{
      g.shadowColor=`rgba(0,0,0,${a})`; g.shadowBlur=blur*dpr; g.shadowOffsetX=ox*dpr; g.shadowOffsetY=oy*dpr; g.drawImage(cv,0,0);
      g.shadowColor='rgba(0,0,0,0.5)'; g.shadowBlur=2.2*dpr; g.shadowOffsetX=0; g.shadowOffsetY=0; g.drawImage(cv,0,0);
    };
    /* Seen from behind, the arms reach past the body toward the wall, so the
       back and the head cover them where they overlap. */
    drop(Ly.arms,Math.max(4,U(0.035)),U(0.01),U(0.02),0.38);
    drop(Ly.body,Math.max(6,U(0.06)),U(0.016),U(0.032),0.45);
    drop(Ly.head,Math.max(4,U(0.035)),U(0.008),U(0.018),0.4);
    g.shadowColor='transparent';
  }
  return {sp:SP,box,SW,SHh};
}
/* L/R badges on each hand and foot; the limb that moves gets a ring. */
function drawLimbBadges(g,G,Q,activeLimb,only){
  for(const kk of LIMBS){
    if(only&&!only[kk]) continue;
    const q=Q(G.ends[kk]),hand=kk[1]==='h',r=6.5,active=activeLimb===kk,fl=G.flagged[kk];
    g.beginPath();
    if(hand) g.arc(q[0],q[1],r,0,6.283); else g.rect(q[0]-r,q[1]-r,2*r,2*r);
    g.fillStyle=fl?'rgba(255,255,255,0.92)':LIMBCOL[kk]; g.fill();
    g.lineWidth=active?3:1.8; g.strokeStyle=active?'#ffffff':'rgba(10,12,14,0.85)'; g.stroke();
    if(active){ g.beginPath(); g.arc(q[0],q[1],r+5,0,6.283); g.lineWidth=2; g.strokeStyle=LIMBCOL[kk]; g.stroke(); }
    g.fillStyle=fl?LIMBCOL[kk]:'#ffffff'; g.font='700 9px "Barlow Condensed",sans-serif'; g.textAlign='center'; g.textBaseline='middle';
    g.fillText(kk[0]==='l'?'L':'R',q[0],q[1]+0.5);
  }
}
const newLayers=()=>({body:document.createElement('canvas'),arms:document.createElement('canvas'),head:document.createElement('canvas'),mask:document.createElement('canvas'),sprite:document.createElement('canvas'),key:''});
const figLayers=newLayers();
function drawClimber(){
  const b=S.beta,H=b.res.H,TORSO=b.res.TORSO,step=b.steps[S.step],p=currentPos(),dr=drift();
  const editing=TOOLS.includes(S.mode)||S.mode==='floor'||S.mode==='walltop',dpr=S.view.dpr,k=kU()*S.view.dh;
  const Q=q=>cmPx(q,dr);
  /* drawn arm a touch shorter than the planner's reach; the shoulder lift covers the rest */
  const arm=0.96*(b.res.ARM||0.5*H);
  const G=figureGeom(p,H,TORSO,arm,Q,bodyFor(p,H,TORSO,arm)),F=paintFigure(figLayers,G,H*k,dpr);
  ctx.save(); ctx.globalAlpha=editing?0.35:0.96;
  ctx.drawImage(F.sp,0,0,F.SW,F.SHh,F.box.x,F.box.y,F.SW/dpr,F.SHh/dpr);
  ctx.globalAlpha=editing?0.35:1;
  if(step.limb&&S.step>0&&!editing){
    const prev=b.steps[S.step-1].pos,a=prev[step.limb]||flagPos(step.limb,prev.C,H),z=step.pos[step.limb]||flagPos(step.limb,step.pos.C,H);
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
  drawLimbBadges(ctx,G,Q,step.limb);
  ctx.restore();
}
let lastW=0;
new ResizeObserver(()=>{ const w=wrap.clientWidth; if(w&&w!==lastW){ lastW=w; fit(); render(); } }).observe(wrap);
if(document.fonts&&document.fonts.load) document.fonts.load(`16px ${MARKER}`).then(()=>{ if(!isMoving()) render(); }).catch(()=>{});

/* ---------- hold types: the picker ---------- */
/* The Hold type tool: tap a ringed hold, then choose its type. The choice is
   saved like the other edits (a position on a still picture, the followed
   hold while moving), feeds the planner, and changes the tips. */
let typeRef=null;
function typePickHold(){
  if(!typeRef) return null;
  if(isMoving()) return S.tracks.find(t=>t.id===typeRef.id&&!t.removed)||null;
  let best=null,bd=Infinity;
  for(const h of S.holds){ if(h.removed) continue; const d=Math.hypot((h.u-typeRef.u)*aspect(),h.v-typeRef.v); if(d<bd){ bd=d; best=h; } }
  return best&&bd<Math.max(best.rho,0.01)*1.3?best:null;
}
const tpEl=$('#typePick'),tpGrid=$('#tpGrid');
for(const ty of HOLD_ORDER){
  const b=document.createElement('button'); b.type='button'; b.className='tp-b'; b.dataset.type=ty; b.setAttribute('aria-pressed','false');
  b.innerHTML=holdIconSvg(ty)+`<span>${HOLD_TYPES[ty].name}</span>`;
  b.addEventListener('click',()=>{ const h=typePickHold(); if(!h){ closeTypePick(); return; } setHoldType(h,ty); });
  tpGrid.append(b);
}
function fillTypePick(h){
  const n=S.beta&&S.beta.num.get(h.id),g=guessType(holdMeta(h)),cur=h.type||null,shown=cur||g;
  $('#tpTitle').textContent=n!=null?`Hold ${n}: what type is it?`:'What type of hold is it?';
  $('#tpGuess').textContent=cur?`You set it as ${artName(cur)}.`:`From its size and shape it looks like ${artName(g)}. Choose the real type.`;
  tpGrid.querySelectorAll('button').forEach(b=>{ b.setAttribute('aria-pressed',String(b.dataset.type===cur)); b.classList.toggle('guess',!cur&&b.dataset.type===g); });
  $('#tpLine').textContent=HOLD_TYPES[shown].line;
  $('#tpClear').hidden=!cur;
  $('#tpShowTxt').textContent=`Show how: ${HOLD_TYPES[shown].name.toLowerCase()}`;
  tpEl.dataset.show=shown;
}
function openTypePick(h){
  typeRef={id:h.id,u:h.u,v:h.v};
  fillTypePick(h);
  tpEl.hidden=false;
  placeTypePick(h);
  render();
}
/* Next to the hold, never on it: below it inside the picture, else above
   it, else below it hanging over the player under the picture. */
function placeTypePick(h){
  const st=tpEl.parentElement,sr=st.getBoundingClientRect(),cr=cv.getBoundingClientRect(),ox=cr.left-sr.left,oy=cr.top-sr.top;
  const [x,y]=P(h.u,h.v),r=h.rho*S.view.dh,w=tpEl.offsetWidth,hh=tpEl.offsetHeight,W=st.clientWidth,SH=st.clientHeight;
  const left=Math.max(8,Math.min(W-w-8,ox+x-w/2)),below=oy+y+r+16,above=oy+y-r-16-hh;
  let top=below+hh<=oy+S.view.dh-8?below:above>=8?above:below;
  top=Math.max(8,Math.min(Math.max(8,SH-hh-8),top));
  tpEl.style.left=left+'px'; tpEl.style.top=top+'px';
  const rr=tpEl.getBoundingClientRect(); if(rr.top<0||rr.bottom>window.innerHeight) tpEl.scrollIntoView({block:'nearest',behavior:reduceMotion?'auto':'smooth'});
}
function closeTypePick(quiet){
  if(!typeRef&&tpEl.hidden) return;
  typeRef=null; tpEl.hidden=true;
  if(!quiet&&S.src&&!isMoving()) render();
}
function setHoldType(h,ty){
  const E=S.edits;
  if(isMoving()) h.type=ty||null;
  else{ E.types=E.types.filter(p=>!nearPos(h,p)); if(ty) E.types.push({u:h.u,v:h.v,type:ty}); }
  if(ty) keepChosen(h);
  if(!isMoving()) applyEdits();
  const h2=typePickHold(); if(h2) fillTypePick(h2);
  toast(ty?`Hold set as ${artName(ty)}`:'Type cleared. The guess is used again.');
  updateStats(); render(); solveSoon();
}
$('#tpClose').addEventListener('click',()=>closeTypePick());
$('#tpClear').addEventListener('click',()=>{ const h=typePickHold(); if(h) setHoldType(h,null); });
$('#tpShow').addEventListener('click',e=>openDemo(tpEl.dataset.show||'jug',e.currentTarget));

/* ---------- technique examples ---------- */
/* A small wall with stylised holds and the same climber, looping one
   technique per hold type. Moves use blendPose(), like the route player. */
const demoEl=$('#demo'),demoCv=$('#demoCv'),dctx=demoCv.getContext('2d'),demoLayers=newLayers();
const DEMO_H=170,DEMO_T=0.3*DEMO_H,DEMO_ARM=0.96*0.5*DEMO_H,DEMO_X0=-108,DEMO_W=216,DEMO_TOP=288;
const DEMO_HOLD='#f07b22',DEMO_HOLD_DARK='#9c4209';
for(const ty in DEMOS) for(const k of DEMOS[ty].keys) k.fixHip=true;
const D={type:null,i:0,phase:'hold',t0:0,dur:0,playing:true,raf:0,opener:null,dirty:true,view:{w:1,h:1,dpr:1,k:1},wall:document.createElement('canvas'),wallKey:''};
const pathCache=new Map(),pathOf=d=>{ let p=pathCache.get(d); if(!p){ p=new Path2D(d); pathCache.set(d,p); } return p; };
const demoTypes=$('#demoTypes');
for(const ty of HOLD_ORDER){
  const b=document.createElement('button'); b.type='button'; b.className='chip'; b.dataset.type=ty;
  b.innerHTML=holdIconSvg(ty); b.append(document.createTextNode(HOLD_TYPES[ty].name));
  b.addEventListener('click',()=>setDemo(ty));
  demoTypes.append(b);
}
function openDemo(ty,opener){
  if(!DEMOS[ty]) return;
  stopPlay();
  D.opener=opener||document.activeElement;
  demoEl.hidden=false; document.body.classList.add('modal-open');
  setDemo(ty);
  $('#demoClose').focus();
}
function setDemo(ty){
  D.type=ty; D.i=0; D.phase='hold'; D.t0=performance.now(); D.dur=DEMOS[ty].keys[0].hold||1500; D.playing=!reduceMotion; D.dirty=true;
  const T=HOLD_TYPES[ty];
  $('#demoTitle').textContent=DEMOS[ty].title;
  $('#demoIcon').innerHTML=holdIconSvg(ty);
  const ul=$('#demoTips'); ul.textContent='';
  for(const t of [T.grip,T.body]){ const li=document.createElement('li'); li.textContent=t; ul.append(li); }
  demoTypes.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.type===ty)));
  D.wallKey='';
  fitDemo(); demoCaption(); setDemoPlayBtn();
  cancelAnimationFrame(D.raf); D.raf=requestAnimationFrame(demoTick);
}
function closeDemo(){
  if(demoEl.hidden) return;
  demoEl.hidden=true; document.body.classList.remove('modal-open');
  cancelAnimationFrame(D.raf); D.raf=0;
  const o=D.opener; D.opener=null;
  if(o&&o.focus&&document.contains(o)&&!o.closest('[hidden]')) o.focus();
}
function fitDemo(){
  const box=$('#demoStage'),maxW=Math.max(200,box.clientWidth||320),maxH=Math.max(240,Math.min(window.innerHeight*0.52,620));
  let w=maxW,h=w*DEMO_TOP/DEMO_W; if(h>maxH){ h=maxH; w=h*DEMO_W/DEMO_TOP; }
  w=Math.floor(w); h=Math.floor(h);
  const dpr=Math.min(window.devicePixelRatio||1,2);
  demoCv.style.width=w+'px'; demoCv.style.height=h+'px';
  demoCv.width=Math.round(w*dpr); demoCv.height=Math.round(h*dpr);
  D.view={w,h,dpr,k:w/DEMO_W}; D.wallKey=''; D.dirty=true;
}
function demoCaption(){
  const keys=DEMOS[D.type].keys,i=D.phase==='move'?D.i+1:D.i;
  $('#demoCap').textContent=keys[i].cap;
  $('#demoStep').textContent=`Step ${i+1} of ${keys.length}`;
  $('#demoPrev').disabled=i===0&&D.phase!=='move';
}
function setDemoPlayBtn(){
  const b=$('#demoPlay');
  b.querySelector('span').textContent=D.playing?'Pause':'Play';
  b.querySelector('path').setAttribute('d',D.playing?'M6 4.5h4v15H6zM14 4.5h4v15h-4z':'M7 4.5v15l13-7.5z');
}
function demoMove(now){ const keys=DEMOS[D.type].keys; D.phase='move'; D.t0=now; D.dur=reduceMotion?1:(keys[D.i+1].move||950); D.dirty=true; demoCaption(); }
function demoTick(now){
  if(demoEl.hidden) return;
  D.raf=requestAnimationFrame(demoTick);
  const keys=DEMOS[D.type].keys,last=keys.length-1;
  if(now-D.t0>=D.dur){
    if(D.phase==='move'){ D.i++; D.phase='hold'; D.t0=now; D.dur=keys[D.i].hold||(D.i===last?1700:1150); D.dirty=true; demoCaption(); }
    else if(D.phase==='fadeout'){ D.i=0; D.phase='fadein'; D.t0=now; D.dur=320; demoCaption(); }
    else if(D.phase==='fadein'){ D.phase='hold'; D.t0=now; D.dur=keys[0].hold||1500; D.dirty=true; }
    else if(D.phase==='hold'&&D.playing){ if(D.i<last) demoMove(now); else { D.phase='fadeout'; D.t0=now; D.dur=320; } }
  }
  /* nothing moves while paused on a still position */
  if(D.phase==='hold'&&!keys[D.i].shake&&!D.dirty) return;
  D.dirty=false;
  drawDemo(now);
}
function demoPose(now){
  const keys=DEMOS[D.type].keys,k=keys[D.i];
  if(D.phase==='move'){
    const to=keys[D.i+1],t=Math.min(1,(now-D.t0)/D.dur);
    return {p:blendPose(k,to,t,{H:DEMO_H,sag:to.sag||0}),active:LIMBS.find(q=>!sameP(k[q],to[q]))||null,alpha:1,free:{}};
  }
  const p=Object.assign({},k),free={};
  p.body=chooseBody(k,DEMO_H,DEMO_T,DEMO_ARM);
  if(k.shake&&!reduceMotion){ const w=now/1000*2*Math.PI*3.2; p[k.shake]=[k[k.shake][0]+3*Math.sin(w),k[k.shake][1]+2*Math.sin(2*w)]; }
  if(k.shake) free[k.shake]=true;
  const f=D.phase==='fadeout'?1-(now-D.t0)/D.dur:D.phase==='fadein'?(now-D.t0)/D.dur:1;
  return {p,active:null,alpha:Math.max(0,Math.min(1,f)),free};
}
function drawDemoHold(g,hd,Q,k){
  const [x,y]=Q([hd.x,hd.y]);
  g.save();
  g.shadowColor='rgba(0,0,0,0.3)'; g.shadowBlur=4; g.shadowOffsetX=1; g.shadowOffsetY=2;
  if(hd.t==='foot'){
    const r=4*k; g.beginPath(); g.ellipse(x,y,r*1.4,r,0,0,6.283); g.fillStyle=DEMO_HOLD; g.fill();
    g.shadowColor='transparent'; g.beginPath(); g.ellipse(x,y-r*0.35,r*0.9,r*0.38,0,0,6.283); g.fillStyle='rgba(255,255,255,0.28)'; g.fill();
    g.restore(); return;
  }
  const ic=HOLD_ICON[hd.t],sz=(hd.s||14)*k/18;
  let rot=ic.rot||0; if(hd.face==='left') rot=-Math.PI/2; else if(hd.face==='right') rot=Math.PI/2;
  g.translate(x,y); g.rotate(rot); g.scale(sz,sz); g.translate(-12,-12);
  const body=pathOf(ic.body);
  g.fillStyle=DEMO_HOLD; g.fill(body);
  g.shadowColor='transparent';
  g.save(); g.clip(body);
  const rg=g.createRadialGradient(8,7,1,12,12,13); rg.addColorStop(0,'rgba(255,255,255,0.42)'); rg.addColorStop(0.55,'rgba(255,255,255,0)'); rg.addColorStop(1,'rgba(0,0,0,0.22)');
  g.fillStyle=rg; g.fillRect(0,0,24,24);
  if(ic.mark){ g.fillStyle=DEMO_HOLD_DARK; g.fill(pathOf(ic.mark)); }
  g.restore();
  g.lineWidth=1.2/sz; g.strokeStyle='rgba(40,20,5,0.45)'; g.stroke(body);
  g.restore();
}
function drawDemoWall(g){
  const {w,h,dpr,k}=D.view,key=[D.type,w,h,dpr].join('|'),W=D.wall;
  if(D.wallKey!==key){
    D.wallKey=key; sizeCanvas(W,Math.round(w*dpr),Math.round(h*dpr));
    const c=W.getContext('2d'),Q=q=>[(q[0]-DEMO_X0)*k,(DEMO_TOP-q[1])*k];
    c.setTransform(dpr,0,0,dpr,0,0);
    const bg=c.createLinearGradient(0,0,0,h); bg.addColorStop(0,'#cdd2d8'); bg.addColorStop(1,'#b6bcc3'); c.fillStyle=bg; c.fillRect(0,0,w,h);
    c.fillStyle='rgba(40,44,50,0.45)';
    for(let y=10;y<DEMO_TOP;y+=20) for(let x=-100+((y/20)%2?10:0);x<=104;x+=20){ const q=Q([x,y]); c.beginPath(); c.arc(q[0],q[1],Math.max(1,0.75*k),0,6.283); c.fill(); }
    c.strokeStyle='rgba(60,66,74,0.3)'; c.lineWidth=1.2;
    for(const x of [-60,60]){ const a=Q([x,0]),b=Q([x,DEMO_TOP]); c.beginPath(); c.moveTo(a[0],a[1]); c.lineTo(b[0],b[1]); c.stroke(); }
    for(const y of [120,240]){ const a=Q([DEMO_X0,y]),b=Q([DEMO_X0+DEMO_W,y]); c.beginPath(); c.moveTo(a[0],a[1]); c.lineTo(b[0],b[1]); c.stroke(); }
    const m=Q([0,6]); c.fillStyle='#2f3946'; c.fillRect(0,m[1],w,h-m[1]);
    const hs=DEMOS[D.type].holds;
    for(const hd of hs) drawDemoHold(c,hd,Q,k);
    /* name tags on the holds this example is about */
    for(const hd of hs){
      if(!hd.main) continue;
      const q=Q([hd.x,hd.y]),r=(hd.s||14)*k/2,txt=HOLD_TYPES[hd.t].name;
      c.font=`12px ${MARKER}`; const tw=c.measureText(txt).width+12;
      let tx=hd.x<0?q[0]-r-tw/2-4:q[0]+r+tw/2+4,ty=q[1]+r*0.6;
      if(hd.lab==='below'){ tx=q[0]; ty=q[1]+r+12; }
      tx=Math.max(tw/2+3,Math.min(w-tw/2-3,tx));
      tagAt(tx,ty,txt,'#ffd43b','#211c0a',12,c);
    }
  }
  g.setTransform(1,0,0,1,0,0); g.drawImage(W,0,0); g.setTransform(dpr,0,0,dpr,0,0);
}
function drawArrow(g,A,B){
  const ang=Math.atan2(B[1]-A[1],B[0]-A[0]),ex=B[0]-Math.cos(ang)*9,ey=B[1]-Math.sin(ang)*9;
  const head=()=>{ g.beginPath(); g.moveTo(B[0],B[1]); g.lineTo(ex-Math.cos(ang-1.1)*7,ey-Math.sin(ang-1.1)*7); g.lineTo(ex-Math.cos(ang+1.1)*7,ey-Math.sin(ang+1.1)*7); g.closePath(); };
  g.save(); g.lineCap='round'; g.lineJoin='round';
  g.strokeStyle='rgba(20,24,28,0.8)'; g.lineWidth=7; g.beginPath(); g.moveTo(A[0],A[1]); g.lineTo(ex,ey); g.stroke(); head(); g.lineWidth=4; g.stroke();
  g.strokeStyle='#ffd43b'; g.fillStyle='#ffd43b'; g.lineWidth=3.2; g.beginPath(); g.moveTo(A[0],A[1]); g.lineTo(ex,ey); g.stroke(); head(); g.fill();
  g.restore();
}
function drawDemo(now){
  const {w,h,dpr,k}=D.view,g=dctx,Q=q=>[(q[0]-DEMO_X0)*k,(DEMO_TOP-q[1])*k];
  g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,w,h);
  drawDemoWall(g);
  const {p,active,alpha,free}=demoPose(now);
  const G=figureGeom(p,DEMO_H,DEMO_T,DEMO_ARM,Q,bodyFor(p,DEMO_H,DEMO_T,DEMO_ARM)),F=paintFigure(demoLayers,G,DEMO_H*k,dpr);
  const keys=DEMOS[D.type].keys,fk=D.phase==='move'?keys[D.i+1]:keys[D.i];
  g.save(); g.globalAlpha=alpha;
  g.drawImage(F.sp,0,0,F.SW,F.SHh,F.box.x,F.box.y,F.SW/dpr,F.SHh/dpr);
  if(fk.force&&D.phase!=='fadeout'&&D.phase!=='fadein') drawArrow(g,Q(fk.force[0]),Q(fk.force[1]));
  drawLimbBadges(g,G,Q,active,{lh:!free.lh,rh:!free.rh,lf:true,rf:true});
  g.restore();
}
$('#demoClose').addEventListener('click',closeDemo);
demoEl.addEventListener('click',e=>{ if(e.target===demoEl) closeDemo(); });
$('#demoPlay').addEventListener('click',()=>{
  D.playing=!D.playing; setDemoPlayBtn();
  const now=performance.now(),last=DEMOS[D.type].keys.length-1;
  if(D.playing&&D.phase==='hold'){ if(D.i<last) demoMove(now); else { D.phase='fadeout'; D.t0=now; D.dur=320; } }
});
$('#demoNext').addEventListener('click',()=>{
  const now=performance.now(),last=DEMOS[D.type].keys.length-1;
  D.playing=false; setDemoPlayBtn();
  if(D.phase==='move') D.i++;
  if(D.phase==='fadeout'||D.phase==='fadein') D.i=last;
  if(D.i<last) demoMove(now);
  else { D.i=0; D.phase='hold'; D.t0=now; D.dur=1500; D.dirty=true; demoCaption(); }
});
$('#demoPrev').addEventListener('click',()=>{
  const now=performance.now();
  D.playing=false; setDemoPlayBtn();
  if(D.phase==='move') D.i++;
  if(D.phase==='fadeout'||D.phase==='fadein') D.i=DEMOS[D.type].keys.length-1;
  D.i=Math.max(0,D.i-1); D.phase='hold'; D.t0=now; D.dur=1500; D.dirty=true; demoCaption();
});
/* keep keyboard focus inside the open example */
demoEl.addEventListener('keydown',e=>{
  if(e.key==='Escape'){ e.preventDefault(); closeDemo(); return; }
  if(e.key!=='Tab') return;
  const f=[...demoEl.querySelectorAll('button:not([disabled])')].filter(b=>b.offsetParent);
  if(!f.length) return;
  const i=f.indexOf(document.activeElement);
  if(e.shiftKey&&(i<=0)){ e.preventDefault(); f[f.length-1].focus(); }
  else if(!e.shiftKey&&i===f.length-1){ e.preventDefault(); f[0].focus(); }
});
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&!tpEl.hidden&&demoEl.hidden) closeTypePick(); });
window.addEventListener('resize',()=>{ if(!demoEl.hidden){ fitDemo(); } });
/* Learn tab: one row per hold type with a button to watch it */
(function(){
  const box=$('#holdGuide'); if(!box) return;
  for(const ty of HOLD_ORDER){
    const T=HOLD_TYPES[ty],row=document.createElement('div'); row.className='hg';
    const ic=document.createElement('span'); ic.className='hg-ic'; ic.innerHTML=holdIconSvg(ty);
    const tx=document.createElement('div'); const b=document.createElement('b'); b.textContent=T.name; const sp=document.createElement('span'); sp.textContent=T.line; tx.append(b,sp);
    const bt=document.createElement('button'); bt.type='button'; bt.className='btn small'; bt.textContent='Show me'; bt.setAttribute('aria-label',`Show me how to use ${artName(ty)}`);
    bt.addEventListener('click',()=>openDemo(ty,bt));
    row.append(ic,tx,bt); box.append(row);
  }
})();

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
  const typed=activeHolds().filter(h=>h.type&&S.beta.num.has(h.id)).map(h=>`${S.beta.num.get(h.id)} ${HOLD_TYPES[h.type].name.toLowerCase()}`);
  const prompt=`You are an experienced bouldering coach helping a beginner. The image is a photo of an indoor climbing wall. The holds of one route (colour: ${S.model.name}) are circled, and the ones used are labelled with yellow numbers in the order they are first touched. The climber is ${S.heightCm} cm tall${S.spanCm?` with a ${S.spanCm} cm arm span`:''}. The bottom of the photo is the floor and the photo shows about ${S.wallM} m of wall${S.angle>0?`, overhanging ${S.angle}°`:S.angle<0?`, a slab leaning back ${-S.angle}°`:', vertical'}.${typed.length?`\n\nThe climber says these holds are: ${typed.join(', ')}.`:''}\n\nPlanned sequence:\n${lines}\n\nReply in plain text with no markdown symbols, under 230 words, in three short parts:\n1. Holds: one line per numbered hold with your best guess of its type (jug, edge, crimp, sloper, pinch, pocket, sidepull, undercling, volume) and how to grip it.\n2. Crux: which move looks hardest and one hand or foot tip for it.\n3. Check: anything in the sequence that looks wrong for this wall (for example a circled blob that is not a hold of this colour, or a better foot), and what to do instead.\nIf the photo is unclear, say so briefly.`;
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
