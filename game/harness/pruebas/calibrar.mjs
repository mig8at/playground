// El calibrador (2026-10-18, Miguel: «cualquier dinámica del juego o cambio se calibra en el 2D, y un calibrador debajo
// del 2D que nos permita acelerar las pruebas y calibraciones»). Busca solo los valores de las perillas de un experimento
// (scripts/experimentos/<nombre>.mjs: sus parámetros —una ruta en medidas.js y su rango— y cómo evaluarlos —la pérdida
// contra sus metas—), en paralelo, en varios núcleos:
//  1. mide cómo está hoy (los valores de medidas.js);
//  2. prueba combinaciones repartidas por todo el rango (cada perilla en su rango, al azar estratificado);
//  3. refina alrededor de la mejor, con pasos que se achican (una estrategia evolutiva simple, (1+λ)).
// Deja el mejor juego de valores, meta por meta antes y después, y lo guarda en scripts/datos/calibracion-<nombre>.json.
// No cambia medidas.js: los valores se pasan a mano, con el informe a la vista.
// Uso: node scripts/calibrar.mjs <experimento> [--iter=60] [--semillas=1,2] [--workers=N] [--rondas=8 (botin)]
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {cpus} from 'node:os';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as MED from '../src/engine/medidas.js';

// (poner un valor en una ruta de medidas.js: 'RUTINA.necesidades.hambre.sube')
const poner=(ruta,v)=>{const k=ruta.split('.'),o=k.slice(0,-1).reduce((o,x)=>o[x],MED);o[k.at(-1)]=v;};
const leer=ruta=>ruta.split('.').reduce((o,x)=>o?.[x],MED);

if(!isMainThread){// ---- un trabajador: evalúa juegos de valores ----
 const X=await import(workerData.archivo);
 parentPort.on('message',async m=>{if(m.fin)process.exit(0);for(const [ruta,v] of Object.entries(m.valores))poner(ruta,v);
  try{const r=await X.evaluar(m.opciones);parentPort.postMessage({id:m.id,...r});}catch(e){parentPort.postMessage({id:m.id,perdida:Infinity,error:String(e?.stack||e).slice(0,400)});}});}
else{
 const A=process.argv.slice(2),nombre=A.find(a=>!a.startsWith('--'))||'rutina',op=k=>A.find(a=>a.startsWith(`--${k}=`))?.split('=')[1];
 const ITER=+(op('iter')||60),semillas=(op('semillas')||'1').split(',').map(Number),NW=Math.max(1,Math.min(+(op('workers')||cpus().length-1),12)),rondas=+(op('rondas')||8);
 const archivo=new URL(`./experimentos/${nombre}.mjs`,import.meta.url).href,X=await import(archivo),P=X.parametros,t0=Date.now();
 const opciones={semillas,rondas};
 console.log(`calibrar «${nombre}»: ${X.descripcion} · ${P.length} perillas · ${ITER} pruebas · ${NW} trabajadores · ciudades ${semillas.join(',')}`);
 const ws=Array.from({length:NW},()=>new Worker(fileURLToPath(import.meta.url),{workerData:{archivo}}));let sig=0;const pend=new Map();
 for(const w of ws)w.on('message',m=>{const r=pend.get(m.id);pend.delete(m.id);r(m);});
 const libres=[...ws];const cola=[];
 const evaluar=valores=>new Promise(ok=>{const id=sig++;pend.set(id,m=>{libres.push(w0.w);ok(m);siguiente();});const w0={w:null};cola.push({id,valores,w0});siguiente();});
 function siguiente(){while(libres.length&&cola.length){const w=libres.pop(),c=cola.shift();c.w0.w=w;w.postMessage({id:c.id,valores:c.valores,opciones});}}
 const base=Object.fromEntries(P.map(p=>[p.ruta,leer(p.ruta)]));
 const azar=(p,u)=>p.min+u*(p.max-p.min),acotar=(p,v)=>Math.max(p.min,Math.min(p.max,v));
 const r0=await evaluar(base);if(r0.error)console.log('  error en el experimento:',r0.error);
 console.log(`  hoy: pérdida ${r0.perdida.toFixed(4)} · ${r0.detalle.filter(d=>d.ok).length} de ${r0.detalle.length} metas`);
 let mejor={valores:base,...r0};const historia=[{fase:'hoy',perdida:r0.perdida}];
 // 2. repartidas por el rango (estratificado: cada perilla recorre sus franjas en otro orden)
 const n1=Math.max(NW,Math.round(ITER*.4)),franjas=P.map(()=>{const a=[...Array(n1).keys()];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;});
 const cand=Array.from({length:n1},(_,i)=>Object.fromEntries(P.map((p,k)=>[p.ruta,azar(p,(franjas[k][i]+Math.random())/n1)])));
 const res1=await Promise.all(cand.map(async v=>({valores:v,...await evaluar(v)})));for(const r of res1)if(r.perdida<mejor.perdida)mejor=r;
 const errs=res1.filter(r=>r.error);if(errs.length)console.log(`  ${errs.length} pruebas con error: ${errs[0].error}`);
 console.log(`  pérdidas de la exploración: ${res1.map(r=>r.perdida.toFixed(3)).join(' ')}`);
 historia.push({fase:'exploración',perdida:mejor.perdida});console.log(`  exploración (${n1}): mejor pérdida ${mejor.perdida.toFixed(4)}`);
 // 3. refinar: alrededor de la mejor, de a NW por vuelta, con el paso que se achica si no mejora
 let sigma=.25,quedan=ITER-n1;
 while(quedan>0&&sigma>.01){const lote=Array.from({length:Math.min(NW,quedan)},()=>Object.fromEntries(P.map(p=>[p.ruta,acotar(p,mejor.valores[p.ruta]+(Math.random()*2-1)*sigma*(p.max-p.min))])));quedan-=lote.length;
  let mejoro=false;for(const r of await Promise.all(lote.map(async v=>({valores:v,...await evaluar(v)}))))if(r.perdida<mejor.perdida){mejor=r;mejoro=true;}
  sigma*=mejoro?1.1:.7;historia.push({fase:'refinar',perdida:mejor.perdida,sigma:+sigma.toFixed(3)});}
 for(const w of ws)w.postMessage({fin:true});
 console.log(`  refinado: mejor pérdida ${mejor.perdida.toFixed(4)} · ${mejor.detalle.filter(d=>d.ok).length} de ${mejor.detalle.length} metas · ${((Date.now()-t0)/1000).toFixed(0)} s`);
 console.log('\n  perilla'.padEnd(44)+'hoy'.padStart(10)+'calibrado'.padStart(12));
 for(const p of P)console.log('  '+p.ruta.padEnd(42)+(+base[p.ruta]).toFixed(4).padStart(10)+(+mejor.valores[p.ruta]).toFixed(4).padStart(12));
 console.log('\n  meta'.padEnd(60)+'hoy'.padStart(9)+'calibrado'.padStart(11)+'  rango');
 for(const [i,d] of mejor.detalle.entries()){const h=r0.detalle[i];console.log(`  ${d.ok?'✓':'✗'} ${d.meta}`.padEnd(60).slice(0,60)+String(h?.valor).padStart(9)+String(d.valor).padStart(11)+'  '+JSON.stringify(d.rango));}
 const sal=fileURLToPath(new URL(`./datos/calibracion-${nombre}.json`,import.meta.url));
 writeFileSync(sal,JSON.stringify({experimento:nombre,fecha:new Date().toISOString(),semillas,pruebas:ITER,hoy:{valores:base,perdida:r0.perdida,detalle:r0.detalle},calibrado:{valores:mejor.valores,perdida:mejor.perdida,detalle:mejor.detalle},historia},null,1));
 console.log(`\n  guardado en ${sal.replace(/.*\/scripts\//,'scripts/')}`);process.exit(0);}
