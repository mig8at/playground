// Un navegador sin ventana para el nivel 10 del probador (2026-10-16): el Chromium que ya bajó Playwright a su caché (el
// «headless shell»; si no, Chrome for Testing) manejado por el protocolo de DevTools con el WebSocket de node, sin dependencias. abrirNavegador() da
// {abrir(url) → página, cerrar()}; una página: evaluar(expr) (en la página, con await), captura() (PNG en base64),
// errores (los de consola y las excepciones que lanzó), cerrar().
import {spawn} from 'node:child_process';import {mkdtempSync,rmSync,existsSync,readdirSync} from 'node:fs';import {tmpdir,homedir} from 'node:os';import {join} from 'node:path';

const CACHE=join(homedir(),'Library/Caches/ms-playwright');
export function chromeDePrueba(){if(process.env.CHROME)return process.env.CHROME;if(!existsSync(CACHE))return null;
 // (el «headless shell» primero: en Chrome for Testing sin ventana no corría requestAnimationFrame —el juego no dibujaba—)
 for(const d of readdirSync(CACHE).filter(d=>/^chromium_headless_shell-\d+$/.test(d)).sort().reverse()){const p=join(CACHE,d,'chrome-headless-shell-mac-arm64/chrome-headless-shell');if(existsSync(p))return p;}
 for(const d of readdirSync(CACHE).filter(d=>/^chromium-\d+$/.test(d)).sort().reverse()){const p=join(CACHE,d,'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');if(existsSync(p))return p;}return null;}

export async function abrirNavegador({ancho=1280,alto=800,args=[]}={}){const bin=chromeDePrueba();if(!bin)throw Error('no hay Chrome for Testing en la caché de Playwright (o CHROME=ruta)');
 const datos=mkdtempSync(join(tmpdir(),'fuga-nav-')),puerto=9300+Math.floor(Math.random()*500);
 const ch=spawn(bin,['--headless=new',`--remote-debugging-port=${puerto}`,`--user-data-dir=${datos}`,`--window-size=${ancho},${alto}`,'--no-first-run','--no-default-browser-check','--hide-scrollbars','--mute-audio','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling',...(process.platform==='darwin'?['--use-angle=metal']:[]),...args],{stdio:'ignore'});
 let ws=null;for(let k=0;k<100&&!ws;k++){await new Promise(r=>setTimeout(r,100));try{const v=await (await fetch(`http://127.0.0.1:${puerto}/json/version`)).json();ws=new WebSocket(v.webSocketDebuggerUrl);}catch{}}
 if(!ws){ch.kill();throw Error('el navegador no abrió su puerto de DevTools');}
 await new Promise((ok,mal)=>{ws.onopen=ok;ws.onerror=mal;});
 let id=0;const espera=new Map(),oyentes=new Map();
 ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&espera.has(d.id)){const {ok,mal}=espera.get(d.id);espera.delete(d.id);d.error?mal(Error(d.error.message)):ok(d.result);}else if(d.method){for(const f of oyentes.get(d.sessionId||'')||[])f(d);}};
 const enviar=(method,params={},sessionId)=>new Promise((ok,mal)=>{const i=++id;espera.set(i,{ok,mal});ws.send(JSON.stringify({id:i,method,params,...(sessionId?{sessionId}:{})}));});
 // (la primera vez, la pestaña que abre el navegador: en una creada por Target.createTarget no corría requestAnimationFrame)
 let primera=true;
 const abrir=async url=>{const ts=(await enviar('Target.getTargets')).targetInfos.filter(t=>t.type==='page'),propia=primera&&ts[0];primera=false;
  const {targetId}=propia?{targetId:propia.targetId}:await enviar('Target.createTarget',{url:'about:blank'}),{sessionId}=await enviar('Target.attachToTarget',{targetId,flatten:true}),S=(m,p)=>enviar(m,p,sessionId);
  const errores=[];oyentes.set(sessionId,[d=>{if(d.method==='Runtime.exceptionThrown')errores.push((d.params.exceptionDetails.exception?.description||d.params.exceptionDetails.text||'').split('\n')[0]);
   if(d.method==='Runtime.consoleAPICalled'&&d.params.type==='error')errores.push(d.params.args.map(a=>a.value??a.description??'').join(' ').split('\n')[0]);}]);
  await S('Runtime.enable');await S('Page.enable');await S('Emulation.setDeviceMetricsOverride',{width:ancho,height:alto,deviceScaleFactor:1,mobile:false});
  // (al frente y con foco: una pestaña de fondo no recibe requestAnimationFrame y el juego no dibuja)
  await S('Page.bringToFront');await S('Emulation.setFocusEmulationEnabled',{enabled:true});
  await S('Page.navigate',{url});
  const evaluar=async(expr,{tiempo=120000}={})=>{const r=await Promise.race([S('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true}),new Promise((_,m)=>setTimeout(()=>m(Error('la página no contestó en '+tiempo/1000+' s')),tiempo))]);
   if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  const captura=async()=>(await S('Page.captureScreenshot',{format:'png'})).data;
  return {evaluar,captura,errores,cerrar:()=>enviar('Target.closeTarget',{targetId})};};
 const cerrar=async()=>{try{ws.close();}catch{}ch.kill();await new Promise(r=>setTimeout(r,300));try{rmSync(datos,{recursive:true,force:true});}catch{}};
 return {abrir,cerrar};}
