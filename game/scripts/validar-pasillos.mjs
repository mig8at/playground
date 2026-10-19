// Valida el ancho de los pasillos (2026-10-16, Miguel: «los pasillos en algunos lugares son muy estrechos»): el ancho
// LIBRE de cada pasillo —su lado menor menos un tabique, y menos lo que se meten los muebles que lo pisan— contra lo que
// pide el juego (JUEGO_PASO de medidas.js): los pasillos de los edificios, edificio; los de las casas del monte y los
// halls de los departamentos, casa. Uso: node scripts/validar-pasillos.mjs [ciudades=4] [semilla0=1]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {conHoja,quiereAbierta,giroDe} from '../src/engine/puertas.js';
import {JUEGO_PASO,MURO,PUERTA,CIRCULACION} from '../src/engine/medidas.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||4),S0=+(A[1]||1),T=MURO.tabique,E=1e-6;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.min(b.length-1,Math.floor(p*b.length))]:NaN;};
const med={edificio:[],casa:[],puertas:{},hojas:{con:0,sin:0},abiertas:{},trabadas:0};
// (las hojas abiertas del todo, PUERTA.abierta: que lo pida su cuarto y que, abiertas, no den contra un mueble; y que una
// que lo pide y quedó cerrada sea porque sí da contra uno)
const choca=(g,ms)=>ms.some(m=>Math.min(g.x1,m.x1)-Math.max(g.x0,m.x0)>.02&&Math.min(g.z1,m.z1)-Math.max(g.z0,m.z0)>.02);
const revisarAbierta=(d,tipo,quiere,g,ms,ej)=>{if(d.abierta){med.abiertas[tipo]=(med.abiertas[tipo]||0)+1;if(!quiere)falla('hoja abierta en un cuarto que no lo pide',ej);if(choca(g,ms))falla('hoja abierta que da contra un mueble',ej);}else if(quiere){if(!choca(g,ms))falla('hoja que debía quedar abierta y quedó cerrada',ej);else med.trabadas++;}};
// el ancho libre de un rectángulo de paso, con los muebles que lo pisan: el lado menor menos el tabique, menos lo que se
// mete el mueble más ancho a lo ancho del pasillo
const libreDe=(r,muebles)=>{const largoX=r.x1-r.x0>=r.z1-r.z0,ancho=largoX?r.z1-r.z0:r.x1-r.x0;let mete=0;
 for(const m of muebles){const ox=Math.min(r.x1,m.x1)-Math.max(r.x0,m.x0),oz=Math.min(r.z1,m.z1)-Math.max(r.z0,m.z0);if(ox<=E||oz<=E)continue;mete=Math.max(mete,largoX?oz:ox);}
 return ancho-T-mete;};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});
 for(const L of [...bp.lots,...(bp.isla.lots||[]).filter(l=>l.levels)])for(const lv of L.levels){
  const muebles=(lv.furniture||[]).filter(f=>f.kind!=='alfombra').map(f=>({x0:f.x,x1:f.x+f.w,z0:f.y,z1:f.y+f.h}));
  for(const c of lv.corridor||[]){const w=libreDe({x0:c.x,x1:c.x+c.w,z0:c.y,z1:c.y+c.h},muebles);med.edificio.push(w);if(w<JUEGO_PASO.edificio-.01)falla('pasillo de edificio más angosto que JUEGO_PASO.edificio',{semilla:s,tipo:L.type,piso:lv.level,libre:+w.toFixed(2)});}
  for(const r of lv.rooms.filter(r=>r.type==='hall')){const w=libreDe({x0:r.x,x1:r.x+r.w,z0:r.y,z1:r.y+r.h},muebles);med.casa.push(w);if(w<JUEGO_PASO.casa-.01)falla('hall de departamento más angosto que JUEGO_PASO.casa',{semilla:s,tipo:L.type,piso:lv.level,libre:+w.toFixed(2)});}}
 // las puertas de calle: el ancho de su lote o su cuarto (PUERTA.doble) y, la doble, que pasen dos a la vez (2 diámetros
 // de CIRCULACION.peaton y su holgura)
 for(const L of bp.lots){const lv=L.levels[0];for(const d of lv.doors||[]){if(!d.street||d.bay)continue;const w=Math.hypot(d.x1-d.x0,d.y1-d.y0),q=lv.rooms.find(r=>r.id===d.a),pide=PUERTA.doble.excepto.includes(L.type)?PUERTA.calle:PUERTA.doble.ancho;
  const k=pide===PUERTA.calle?'sencilla':'doble';med.puertas[k]=(med.puertas[k]||0)+1;if(Math.abs(w-pide)>.01)falla('puerta de calle de otro ancho que el de su tipo',{semilla:s,tipo:L.type,cuarto:q?.type,ancho:+w.toFixed(2),pide});
  if(pide>PUERTA.calle&&w-2*PUERTA.marco<4*CIRCULACION.peaton.radio+.3)falla('puerta doble por la que no pasan dos a la vez',{semilla:s,tipo:L.type});}}
 // las hojas (PUERTA.hoja): cada puerta interior la lleva si la regla lo dice; ningún cuarto privado sin puerta con hoja
 const priv=new Set(PUERTA.hoja.privados);
 for(const L of [...bp.lots,...(bp.isla.lots||[]).filter(l=>l.levels)])for(const lv of L.levels){const T=id=>id==='pasillo'||id==='calle'?id:lv.rooms.find(r=>r.id===id)?.type||'pasillo';
  const ms=(lv.furniture||[]).filter(f=>f.kind!=='alfombra').map(f=>({x0:f.x,x1:f.x+f.w,z0:f.y,z1:f.y+f.h}));
  for(const d of lv.doors||[]){if(d.street)continue;const want=d.core||d.stair?false:conHoja(T(d.a),T(d.b));d.hoja?med.hojas.con++:med.hojas.sin++;if(!!d.hoja!==want)falla('puerta con o sin hoja contra la regla',{semilla:s,entre:[T(d.a),T(d.b)]});
   if(!d.hoja){if(d.abierta)falla('hoja abierta en una puerta sin hoja',{semilla:s});continue;}const q=lv.rooms.find(r=>r.id===d.a)||lv.rooms.find(r=>r.id===d.b);if(!q)continue;
   const h=Math.abs(d.y1-d.y0)<1e-6,at=h?d.y0:d.x0,sg=Math.sign(h?q.y+q.h/2-at:q.x+q.w/2-at)||1,u0=h?Math.min(d.x0,d.x1):Math.min(d.y0,d.y1),u1=h?Math.max(d.x0,d.x1):Math.max(d.y0,d.y1);
   revisarAbierta(d,q.type,quiereAbierta(q.type,(d.x0+d.x1)/2,(d.y0+d.y1)/2),giroDe(h,u0,u1,at,sg),ms,{semilla:s,tipo:L.type,cuarto:q.type});}
  for(const q of lv.rooms)if(priv.has(q.type)&&!(lv.doors||[]).some(d=>(d.a===q.id||d.b===q.id)&&d.hoja))falla('cuarto privado sin ninguna puerta con hoja',{semilla:s,tipo:L.type,cuarto:q.type});}
 for(const h of bp.isla.casas||[]){const P=h.spec?.hogar;if(!P)continue;for(const lv of P.levels){const muebles=(lv.furniture||[]).filter(f=>f.kind!=='alfombra').map(f=>({x0:f.u0,x1:f.u1,z0:f.v0,z1:f.v1}));
  for(const r of lv.rooms.filter(r=>r.type==='hall')){const w=libreDe({x0:r.u0,x1:r.u1,z0:r.v0,z1:r.v1},muebles);med.casa.push(w);if(w<JUEGO_PASO.casa-.01)falla('pasillo de casa más angosto que JUEGO_PASO.casa',{semilla:s,casa:h.manzana,piso:lv.level,libre:+w.toFixed(2)});}
  for(const d of lv.doors||[]){if(!d.hoja||d.street)continue;const q=lv.rooms.find(r=>r.id===d.a);if(!q)continue;const hz=d.axis==='u',c=d.from+d.len/2,sg=Math.sign(hz?(q.v0+q.v1)/2-d.at:(q.u0+q.u1)/2-d.at)||1;
   revisarAbierta(d,q.type,quiereAbierta(q.type,hz?c:d.at,hz?d.at:c),giroDe(hz,d.from,d.from+d.len,d.at,sg),muebles,{semilla:s,casa:h.manzana,cuarto:q.type});}}}}
const r=(a)=>a.length?`${a.length} · mín ${q(a,0).toFixed(2)} · mediana ${q(a,.5).toFixed(2)} m`:'—';
console.log(`pasillos libres · edificios ${r(med.edificio)} (mínimo ${JUEGO_PASO.edificio}) · casas y departamentos ${r(med.casa)} (mínimo ${JUEGO_PASO.casa})`);
console.log(`puertas de calle · ${Object.entries(med.puertas).map(([k,v])=>k+' '+v).join(', ')} (doble ${PUERTA.doble.ancho} m, sencilla ${PUERTA.calle} m)`);
console.log(`hojas · puertas interiores con hoja ${med.hojas.con}, vano abierto ${med.hojas.sin} · abiertas del todo: ${Object.entries(med.abiertas).map(([k,v])=>k+' '+v).join(', ')} (cerradas porque darían contra un mueble: ${med.trabadas})`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
