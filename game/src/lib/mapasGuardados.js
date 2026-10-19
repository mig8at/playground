/* Los mapas guardados (2026-10-18, Miguel: «mapas precargados en IndexedDB para no tener que esperar a cargar todo»). El
   plano de una ciudad (generateBlueprint, ~2–9 s) se guarda en IndexedDB tal cual —structured clone: conserva los
   arreglos tipados y las referencias compartidas— con la firma del motor (virtual:firma-motor, vite.config.js): si el
   motor cambió, el guardado no se usa y se arma de nuevo.
   leerPlano(args) → plano | null · guardarPlano(args, plano) · planoDe(args) → plano (guardado o armado en un worker, y
   guardado) · precargar(lista de args, cada(args, estado)) en segundo plano. args: {seed, team, parks}. */
import FIRMA from 'virtual:firma-motor';

const DB='fuga-mapas',TIENDA='planos';
const clave=a=>`${FIRMA}|${a.seed}|${a.team}|${a.parks??''}`;
let abierta=null;
const abrir=()=>abierta||(abierta=new Promise((ok,mal)=>{if(typeof indexedDB==='undefined')return mal(new Error('sin IndexedDB'));const r=indexedDB.open(DB,1);
 r.onupgradeneeded=()=>r.result.createObjectStore(TIENDA);r.onsuccess=()=>ok(r.result);r.onerror=()=>mal(r.error);}).catch(e=>{abierta=null;throw e;}));
const tx=async(modo,fn)=>{const db=await abrir();return new Promise((ok,mal)=>{const t=db.transaction(TIENDA,modo),req=fn(t.objectStore(TIENDA));t.oncomplete=()=>ok(req?.result);t.onerror=()=>mal(t.error);});};

export async function leerPlano(a){try{return (await tx('readonly',s=>s.get(clave(a))))||null;}catch{return null;}}
export async function guardarPlano(a,plano){try{await tx('readwrite',s=>s.put(plano,clave(a)));
 // (de paso, los de otra firma se borran: no sirven más)
 await tx('readwrite',s=>{const r=s.openCursor();r.onsuccess=()=>{const c=r.result;if(!c)return;if(!String(c.key).startsWith(FIRMA+'|'))c.delete();c.continue();};return null;});return true;}catch{return false;}}

// el plano en un worker (fuera del hilo principal)
export function planoEnWorker(a){return new Promise(res=>{let w;try{w=new Worker(new URL('../engine/plano.worker.js',import.meta.url),{type:'module'});}catch{return res(null);}
 const fin=v=>{w.terminate();res(v);};w.onmessage=e=>{if(e.data.error)console.warn('plano en worker:',e.data.error);fin(e.data.plan||null);};w.onerror=e=>{console.warn('plano en worker:',e.message);fin(null);};w.postMessage(a);});}

// el plano: el guardado o, si no hay, armado en un worker (y guardado). guardado: si vino de IndexedDB
export async function planoDe(a){const g=await leerPlano(a);if(g)return {plano:g,guardado:true};const p=await planoEnWorker(a);if(p)guardarPlano(a,p);return {plano:p,guardado:false};}

// precargar en segundo plano, de a uno (cada(args, 'listo' | 'armando' | 'error'))
export async function precargar(lista,cada=()=>{}){for(const a of lista){if(await leerPlano(a)){cada(a,'listo');continue;}cada(a,'armando');const p=await planoEnWorker(a);if(p&&await guardarPlano(a,p))cada(a,'listo');else cada(a,'error');}}
