// El arnés de grabación: el juego en un Chromium sin ventana (con la tarjeta de video: Vulkan), con un reloj controlado
// —cada cuadro avanza 1/FPS s pase lo que pase con el render— y una cámara de cine que se pone antes de cada dibujado.
// Mismo esquema que scripts/navegador.mjs del juego (DevTools por WebSocket, sin dependencias).
//  · abrirJuego(url) → J: {evaluar(expr), captura(), cerrar(), log}
//  · listo(J, {ronda}): espera el mundo (y la ronda), engancha la cámara (window.__cam) y oculta la interfaz
//  · grabar(J, carpeta, n, porCuadro): n cuadros; antes de cada uno corre porCuadro (JS en la página, con i y d=__demo)
//  · cuadro(archivo): avisa al panel (si lo lanzó el panel) para verlo en vivo
import {spawn} from 'node:child_process';import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';import {tmpdir,homedir} from 'node:os';import {join} from 'node:path';

export const JUEGO=process.env.JUEGO_URL||'http://127.0.0.1:5181';
export const FPS=30;
const BIN=process.env.CHROME||join(homedir(),'.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell');
// (la tarjeta de video: con SwiftShader —por software— cada cuadro tarda ~1,2 s; con Vulkan, ~0,06)
const GPU=(process.env.GPU||'--use-angle=vulkan --enable-features=Vulkan').split(' ');

// performance.now y requestAnimationFrame los maneja __tick(ms). Mientras __libre, el reloj avanza solo (para cargar).
const RELOJ=`(()=>{let t=0;const q=[];window.__t=()=>t;
 performance.now=()=>t;const D0=Date.now();Date.now=()=>D0+t;
 window.requestAnimationFrame=cb=>{q.push(cb);return q.length;};window.cancelAnimationFrame=()=>{};
 window.__tick=ms=>{t+=ms;const c=q.splice(0);for(const f of c){try{f(t);}catch(e){console.error('raf '+(e&&e.stack||e));}}};
 window.__libre=true;setInterval(()=>{if(window.__libre)window.__tick(16);},16);
})();`;

// Al panel: una línea «CUADRO <archivo>» en la salida (el panel la lee y la muestra en vivo), uno cada CADA cuadros.
let nc=0;const CADA=+(process.env.CUADRO_CADA||6);
export const cuadro=(f,forzar=false)=>{if(forzar||nc++%CADA===0)console.log('CUADRO '+f);};

export async function abrirJuego(url,{ancho=1920,alto=1080}={}){
 const datos=mkdtempSync(join(tmpdir(),'fuga-harness-')),puerto=9300+Math.floor(Math.random()*500);
 const ch=spawn(BIN,['--headless=new',`--remote-debugging-port=${puerto}`,`--user-data-dir=${datos}`,`--window-size=${ancho},${alto}`,'--no-first-run','--hide-scrollbars','--mute-audio',
  ...GPU,'--ignore-gpu-blocklist','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','about:blank'],{stdio:'ignore'});
 let ws=null;for(let k=0;k<100&&!ws;k++){await new Promise(r=>setTimeout(r,100));try{const v=await (await fetch(`http://127.0.0.1:${puerto}/json/version`)).json();ws=new WebSocket(v.webSocketDebuggerUrl);}catch{}}
 if(!ws){ch.kill();throw Error('el navegador no abrió (¿CHROME?)');}
 await new Promise((ok,mal)=>{ws.onopen=ok;ws.onerror=mal;});
 let id=0;const espera=new Map(),log=[];
 ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&espera.has(d.id)){const {ok,mal}=espera.get(d.id);espera.delete(d.id);d.error?mal(Error(d.error.message)):ok(d.result);}
  else if(d.method==='Runtime.consoleAPICalled'&&(d.params.type==='error'||d.params.type==='warning'))log.push(d.params.args.map(a=>a.value??a.description??'').join(' ').slice(0,300));
  else if(d.method==='Runtime.exceptionThrown')log.push('EXC '+(d.params.exceptionDetails.exception?.description||d.params.exceptionDetails.text||'').slice(0,300));};
 const enviar=(method,params={},sessionId)=>new Promise((ok,mal)=>{const i=++id;espera.set(i,{ok,mal});ws.send(JSON.stringify({id:i,method,params,...(sessionId?{sessionId}:{})}));});
 const t=(await enviar('Target.getTargets')).targetInfos.find(t=>t.type==='page');
 const {sessionId}=await enviar('Target.attachToTarget',{targetId:t.targetId,flatten:true}),S=(m,p)=>enviar(m,p,sessionId);
 await S('Runtime.enable');await S('Page.enable');await S('Emulation.setDeviceMetricsOverride',{width:ancho,height:alto,deviceScaleFactor:1,mobile:false});
 await S('Page.bringToFront');await S('Emulation.setFocusEmulationEnabled',{enabled:true});
 await S('Page.addScriptToEvaluateOnNewDocument',{source:RELOJ});
 await S('Page.navigate',{url});
 // (el plazo se cancela al llegar la respuesta: si no, cada uno dejaba vivo el proceso hasta 3 min después de terminar)
 const evaluar=async(expr,tiempo=180000)=>{let reloj;const r=await Promise.race([S('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true}),new Promise((_,m)=>{reloj=setTimeout(()=>m(Error('sin respuesta en '+tiempo/1000+' s: '+expr.slice(0,80))),tiempo);})]).finally(()=>clearTimeout(reloj));
  if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const captura=async(calidad=92)=>Buffer.from((await S('Page.captureScreenshot',{format:'jpeg',quality:calidad})).data,'base64');
 const cerrar=async()=>{try{ws.close();}catch{}ch.kill();await new Promise(r=>setTimeout(r,300));try{rmSync(datos,{recursive:true,force:true});}catch{}};
 return {evaluar,captura,cerrar,log};
}

// Espera el mundo (y la ronda, si se pide) y deja el reloj en manual. La cámara de cine: window.__cam(camara, d) se corre
// antes de cada dibujado; window.__norender lo salta (para adelantar la partida rápido). Sin interfaz.
export async function listo(J,{ronda=false}={}){
 await J.evaluar(`(async()=>{for(let i=0;i<600&&!(window.__demo?.world${ronda?'&&window.__demo?.ronda':''});i++)await new Promise(r=>setTimeout(r,200));
  if(!window.__demo?.world)throw Error('el juego no cargó');await new Promise(r=>setTimeout(r,2500));return 1;})()`,240000);
 await J.evaluar(`(()=>{const d=window.__demo;const c=d.composer||d.renderer;const r0=c.render.bind(c);c.render=(...a)=>{if(window.__norender)return;if(window.__cam)window.__cam(d.camera,d);return r0(...a);};
  const st=document.createElement('style');st.textContent='.start,.hud,.mini,header,.actions,[class*=accion],[class*=lift],[class*=toast],[class*=aviso]{display:none!important}';document.head.appendChild(st);
  window.__libre=false;return 1;})()`);
}

// Dibuja de nuevo con la cámara de cine y captura (la del cuadro del juego no siempre llega a la captura).
export const dibujar=`(()=>{const d=window.__demo;(d.composer||d.renderer).render(d.scene,d.camera);return 1;})()`;

// Una toma: n cuadros en carpeta (0000.jpg…). Antes de cada uno, porCuadro (JS con i y d); los saltar primeros no se guardan.
export async function grabar(J,dir,n,porCuadro='',{saltar=0}={}){
 rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
 await J.evaluar(`window.__pc=(i,d)=>{${porCuadro}};1`);
 const t0=Date.now();
 for(let i=-saltar;i<n;i++){await J.evaluar(`(()=>{const d=window.__demo;window.__pc(${i},d);window.__tick(${1000/FPS});return 1;})()`);
  if(i>=0){await J.evaluar(dibujar);const f=join(dir,String(i).padStart(4,'0')+'.jpg');writeFileSync(f,await J.captura());cuadro(f,i===n-1);}}
 return (Date.now()-t0)/1000;
}
// (los errores de la página, sin el aviso de siempre de three)
export const errores=J=>J.log.filter(l=>!/KHR_parallel/.test(l));
