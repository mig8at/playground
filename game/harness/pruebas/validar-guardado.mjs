// Valida el guardado de lo pintado (2026-11-21): la huella de cada pared, la conciliación con el plano de hoy
// (engine/grafiti.js) y la base SQLite (servidor/pintura.mjs).
//  · la huella de una pared es la misma al armar la ciudad otra vez, y no se repite entre las paredes pintables;
//  · la versión de la ciudad es la misma al armarla otra vez, y cambia si una pared cambia;
//  · conciliar: lo guardado sobre una pared que sigue igual queda vigente; si la pared cambió de NÚMERO (se renumera su
//    edificio) lo pintado se muda con ella; si cambió de MEDIDA queda huérfano; lo guardado sin huella (de antes) vale
//    si su grilla es la de esa pared;
//  · la base: lo que se guarda vuelve igual; un pedido con una pared mal formada no guarda ninguna; borrar, mudar y
//    apartar dejan las filas donde deben; la versión de la ciudad queda escrita.
// Uso: node harness/pruebas/validar-guardado.mjs [ciudades=1] [semilla0=1] [equipo=3]
import {generateBlueprint} from '../../src/engine/blueprint.js';
import {paredesDeLaCiudad} from '../../src/engine/muros.js';
import {lienzoDe,vacio,pintar,mascaraDe,aTexto,huellaDePared,versionDeParedes,conciliar} from '../../src/engine/grafiti.js';
import {abrir,revisar} from '../../servidor/pintura.mjs';

const N=+(process.argv[2]||1),S0=+(process.argv[3]||1),TEAM=+(process.argv[4]||3);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const pintada=(w,k)=>{const L=lienzoDe(w),g=vacio(L.cols,L.rows),M=mascaraDe(w);for(let i=0;i<40;i++)pintar(g,(i*7+k)%L.cols,(i*3+k)%L.rows,1+(i+k)%15,M);return {h:huellaDePared(w),cols:L.cols,rows:L.rows,t:aTexto(g)};};
let total=0,mud=0,hue=0,filas=0;const t0=Date.now();
for(let s=S0;s<S0+N;s++){const P=paredesDeLaCiudad(generateBlueprint({seed:s,team:TEAM})),P2=paredesDeLaCiudad(generateBlueprint({seed:s,team:TEAM}));total+=P.length;
 // 1: huellas
 const H=new Map();for(const w of P){const h=huellaDePared(w);if(H.has(h))falla('dos paredes con la misma huella',{ciudad:s,a:H.get(h),b:w.numero});H.set(h,w.numero);}
 if(P.length!==P2.length||P.some((w,i)=>w.numero!==P2[i].numero||huellaDePared(w)!==huellaDePared(P2[i])))falla('la huella cambia al armar la ciudad otra vez',{ciudad:s});
 const V=versionDeParedes(P);if(V.version!==versionDeParedes(P2).version)falla('la versión cambia al armar la ciudad otra vez',{ciudad:s});
 if(versionDeParedes(P.map((w,i)=>i?w:{...w,ancho:w.ancho+.5})).version===V.version)falla('la versión no nota una pared que cambió',{ciudad:s});
 // 2: conciliar. Se pinta una pared de cada 9
 const guardados={};P.forEach((w,i)=>{if(i%9===0)guardados[w.numero]=pintada(w,i);});const nG=Object.keys(guardados).length;
 {const C=conciliar(P,guardados);if(Object.keys(C.vigentes).length!==nG||C.mudadas.length||Object.keys(C.huerfanas).length)falla('sin cambios, no todo quedó vigente',{ciudad:s,vigentes:Object.keys(C.vigentes).length,de:nG});
  for(const [n,v] of Object.entries(C.vigentes))if(v.t!==guardados[n].t){falla('conciliar cambió lo pintado',{ciudad:s,numero:n});break;}}
 // (de antes de la huella: sin `h`)
 {const viejos=Object.fromEntries(Object.entries(guardados).map(([n,v])=>[n,{cols:v.cols,rows:v.rows,t:v.t}])),C=conciliar(P,viejos);if(Object.keys(C.vigentes).length!==nG)falla('lo guardado sin huella no quedó vigente',{ciudad:s});
  if(Object.values(C.vigentes).some(v=>!v.h))falla('lo guardado sin huella quedó sin huella',{ciudad:s});}
 // (el generador cambió: en los edificios pares, la cuenta de paredes se corre 5 lugares —renumeradas—; y una pintada de
 // cada 4 cambia de ancho —ya no es la misma pared—)
 const pintadas=new Set(Object.keys(guardados));let k=0;const cambiadas=new Set();
 const Q=P.map(w=>{let o=w;if(+w.numero.slice(3,5)%2===0)o={...o,numero:w.numero.slice(0,7)+String(+w.numero.slice(7)+5).padStart(3,'0')};if(pintadas.has(w.numero)&&k++%4===0){o={...o,ancho:w.ancho+.5};cambiadas.add(w.numero);}return o;});
 {const C=conciliar(Q,guardados),porHuella=new Map(Q.map(w=>[huellaDePared(w),w.numero]));mud+=C.mudadas.length;hue+=Object.keys(C.huerfanas).length;
  for(const [n,v] of Object.entries(guardados)){const debe=cambiadas.has(n)?null:porHuella.get(v.h);
   if(!debe){if(!C.huerfanas[n])falla('una pared que cambió de medida no quedó huérfana',{ciudad:s,numero:n});continue;}
   if(C.vigentes[debe]?.t!==v.t)falla('lo pintado no siguió a su pared',{ciudad:s,de:n,a:debe});
   if(debe!==n&&!C.mudadas.some(m=>m.de===n&&m.a===debe))falla('una mudanza no se anotó',{ciudad:s,de:n,a:debe});}
  if(Object.keys(C.vigentes).length+Object.keys(C.huerfanas).length!==nG)falla('en la conciliación se perdió o se duplicó algo',{ciudad:s});
  // 3: la base
  const B=abrir(':memory:'),clave=s+'|'+TEAM;
  for(const [n,v] of Object.entries(guardados)){const mal=revisar(n,v);if(mal){falla('la base rechaza una pared bien formada',{numero:n,mal});break;}}
  const lotes=Object.entries(guardados);{const r=B.guardar(clave,{version:V.version,total:V.paredes,cambios:guardados});if(!r.ok)falla('no se pudo guardar',{ciudad:s,razon:r.razon});}
  let R=B.leer(clave);filas+=Object.keys(R.paredes).length;if(R.version!==V.version||R.total!==V.paredes)falla('la versión de la ciudad no quedó escrita',{ciudad:s});
  if(Object.keys(R.paredes).length!==nG||Object.entries(guardados).some(([n,v])=>{const b=R.paredes[n];return !b||b.h!==v.h||b.t!==v.t||b.cols!==v.cols||b.rows!==v.rows;}))falla('lo que se guardó no volvió igual',{ciudad:s});
  // (todo o nada)
  const [n0,v0]=lotes[0],otra=P.find(w=>!pintadas.has(w.numero)),malos=[[{...v0,t:v0.t+'.z9'},'un texto que no llena la grilla'],[{...v0,h:'xyz'},'una huella mal formada'],[{...v0,cols:0},'una grilla de 0'],[{...v0,t:'g'+(v0.cols*v0.rows).toString(36)},'un color fuera de la paleta']];
  for(const [malo,que] of malos){const r=B.guardar(clave,{cambios:{[otra.numero]:pintada(otra,1),[n0]:malo}});if(r.ok)falla('la base aceptó '+que,{ciudad:s});if(B.leer(clave).paredes[otra.numero])falla('un pedido rechazado guardó parte',{ciudad:s,que});}
  if(B.guardar('1;drop',{cambios:{}}).ok||B.guardar(clave,{cambios:{'12':v0}}).ok||B.leer('x').error==null)falla('la base aceptó una ciudad o un número mal formado',{ciudad:s});
  // (mudar y apartar, como lo pide el cliente después de conciliar)
  const cambios={};for(const m of C.mudadas)cambios[m.a]=C.vigentes[m.a];const V2=versionDeParedes(Q);
  const r=B.guardar(clave,{version:V2.version,total:V2.paredes,cambios,mudadas:C.mudadas,huerfanas:Object.keys(C.huerfanas)});if(!r.ok)falla('no se pudo guardar la conciliación',{ciudad:s,razon:r.razon});
  R=B.leer(clave);if(R.version!==V2.version)falla('la versión nueva no quedó escrita',{ciudad:s});
  if(R.huerfanas!==Object.keys(C.huerfanas).length)falla('las huérfanas no quedaron apartadas',{ciudad:s,hay:R.huerfanas,debe:Object.keys(C.huerfanas).length});
  if(Object.keys(R.paredes).length!==Object.keys(C.vigentes).length||Object.entries(C.vigentes).some(([n,v])=>R.paredes[n]?.t!==v.t||R.paredes[n]?.h!==v.h))falla('después de conciliar, la base no quedó como lo vigente',{ciudad:s,filas:Object.keys(R.paredes).length,debe:Object.keys(C.vigentes).length});
  // (y conciliar de nuevo contra la base ya no cambia nada)
  const C2=conciliar(Q,R.paredes);if(C2.mudadas.length||Object.keys(C2.huerfanas).length)falla('conciliar dos veces vuelve a mover',{ciudad:s});
  // (borrar)
  const nB=Object.keys(R.paredes)[0];B.guardar(clave,{cambios:{[nB]:null}});if(B.leer(clave).paredes[nB])falla('borrar no borró',{ciudad:s});B.cerrar();}}
console.log(`guardado · ${N} ciudades de ${TEAM} por equipo · ${total.toLocaleString('es-CO')} paredes pintables, cada una con su huella · ${filas.toLocaleString('es-CO')} guardadas y leídas de la base · con el generador cambiado: ${mud} se mudaron de número y ${hue} quedaron huérfanas · ${Math.round((Date.now()-t0)/1000)} s`);
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size?1:0);
