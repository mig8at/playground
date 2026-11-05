// Los textos de un video (los de videos/<video>.json) en PNG transparentes de 1920×1080, dibujados por el navegador con
// las letras del juego. Uso: node promo/textos.mjs [video=trailer] → .work/textos/<video>/<id>.png
import {spawn} from 'node:child_process';import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';import {tmpdir,homedir} from 'node:os';import {join} from 'node:path';
import {PROMO,TEXTOS,VIDEOS} from './rutas.mjs';
const VIDEO=process.argv[2]||'trailer',DEF=JSON.parse(readFileSync(join(VIDEOS,VIDEO+'.json'),'utf8')),DIR=join(TEXTOS,VIDEO);
rmSync(DIR,{recursive:true,force:true});mkdirSync(DIR,{recursive:true});
const BIN=process.env.CHROME||join(homedir(),'.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell');
const datos=mkdtempSync(join(tmpdir(),'fuga-textos-')),puerto=9800+Math.floor(Math.random()*150);
const ch=spawn(BIN,['--headless=new',`--remote-debugging-port=${puerto}`,`--user-data-dir=${datos}`,'--window-size=1920,1080','--allow-file-access-from-files','about:blank'],{stdio:'ignore'});
try{
 let ws=null;for(let k=0;k<100&&!ws;k++){await new Promise(r=>setTimeout(r,100));try{const v=await (await fetch(`http://127.0.0.1:${puerto}/json/version`)).json();ws=new WebSocket(v.webSocketDebuggerUrl);}catch{}}
 await new Promise(ok=>ws.onopen=ok);let id=0;const esp=new Map();ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&esp.has(d.id)){esp.get(d.id)(d.result||d.error);esp.delete(d.id);}};
 const E=(method,params={},sessionId)=>new Promise(ok=>{const i=++id;esp.set(i,ok);ws.send(JSON.stringify({id:i,method,params,...(sessionId?{sessionId}:{})}));});
 const t=(await E('Target.getTargets')).targetInfos.find(t=>t.type==='page');const {sessionId}=await E('Target.attachToTarget',{targetId:t.targetId,flatten:true}),S=(m,p)=>E(m,p,sessionId);
 await S('Page.enable');await S('Runtime.enable');await S('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
 await S('Emulation.setDefaultBackgroundColorOverride',{color:{r:0,g:0,b:0,a:0}});
 const base='file://'+join(PROMO,'textos.html');
 for(const tx of DEF.textos){const {id:nombre,desde,hasta,fundido,...v}=tx;
  await S('Page.navigate',{url:'about:blank'});await new Promise(r=>setTimeout(r,150));await S('Page.navigate',{url:base+'#'+encodeURIComponent(JSON.stringify(v))});
  for(let i=0;i<50;i++){const r=await S('Runtime.evaluate',{expression:'!!window.__listo',returnByValue:true});if(r.result?.value)break;await new Promise(r=>setTimeout(r,100));}
  await new Promise(r=>setTimeout(r,200));writeFileSync(join(DIR,nombre+'.png'),Buffer.from((await S('Page.captureScreenshot',{format:'png'})).data,'base64'));console.log('texto',nombre);}
 ws.close();
}finally{ch.kill();setTimeout(()=>{try{rmSync(datos,{recursive:true,force:true});}catch{}},300);}
