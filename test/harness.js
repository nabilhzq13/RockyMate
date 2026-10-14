/* Shared helpers for the Node tests: load a photo as RGBA, draw a debug overlay. */
const sharp=require('sharp');
const VisionCore=require('../src/vision.js');
const V=VisionCore();
const fs=require('fs'),path=require('path');
async function load(f,maxSide=640){
  const im=sharp(f); const meta=await im.metadata();
  const sc=Math.min(1,maxSide/Math.max(meta.width,meta.height));
  const w=Math.round(meta.width*sc),h=Math.round(meta.height*sc);
  const {data}=await sharp(f).resize(w,h).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return {rgba:new Uint8ClampedArray(data.buffer,data.byteOffset,data.length),w,h};
}
async function overlay(img,res,out,model,tapXY){
  const {rgba,w,h}=img; const o=Buffer.from(rgba);
  if(res&&res.mask){ const m=res.mask;
    for(let i=0;i<w*h;i++){ const c=m[i]; if(!c) { o[i*4]=o[i*4]*0.55; o[i*4+1]=o[i*4+1]*0.55; o[i*4+2]=o[i*4+2]*0.55; continue; }
      if(c===1) continue;
      const col=c===2?[255,40,40]:c===3?[255,0,200]:[255,190,0];
      o[i*4]=(o[i*4]+col[0]*2)/3; o[i*4+1]=(o[i*4+1]+col[1]*2)/3; o[i*4+2]=(o[i*4+2]+col[2]*2)/3; } }
  // draw rings for blobs
  const set=(x,y,c)=>{ x=Math.round(x); y=Math.round(y); if(x<0||y<0||x>=w||y>=h) return; const i=(y*w+x)*4; o[i]=c[0];o[i+1]=c[1];o[i+2]=c[2]; };
  if(res) for(const b of res.blobs){ const col=b.status==='hold'?[255,255,255]:b.status==='unsure'?[255,200,0]:[255,0,0];
    for(let a=0;a<360;a+=2){ const t=a*Math.PI/180; for(let d=0;d<2;d++) set(b.x+Math.cos(t)*(b.r+3+d),b.y+Math.sin(t)*(b.r+3+d),col); } }
  if(tapXY) for(let d=-6;d<=6;d++){ set(tapXY[0]+d,tapXY[1],[0,255,255]); set(tapXY[0],tapXY[1]+d,[0,255,255]); }
  await sharp(o,{raw:{width:w,height:h,channels:4}}).png().toFile(out);
}
module.exports={load,overlay,V};
