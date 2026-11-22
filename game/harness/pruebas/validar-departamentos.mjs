// Los departamentos abiertos (2026-11-22, Miguel: «lo mejor es dejar sólo el espacio del baño: que las habitaciones no existan,
// eso será decisión del usuario… sólo deja los apartamentos abiertos, sólo el baño con paredes y el mesón… y en los apartamentos
// grandes sólo debe haber una entrada y un solo ascensor»; engine/duplex.js abrirDepartamentos). En cada departamento de la
// ciudad, en el plano:
//  · un solo cuarto cerrado, y es el baño (los demás, zonas de la planta abierta: q.abierto);
//  · a lo sumo una cocina con mesón;
//  · adentro, una sola puerta con hoja: la del baño; lo demás, vanos abiertos;
//  · una sola entrada a pie (viviendas.js; la del ascensor de un penthouse va aparte) y a lo sumo un ascensor.
// Uso: node harness/pruebas/validar-departamentos.mjs [ciudades=2] [semilla0=1]
import {generateBlueprint} from '../../src/engine/blueprint.js';
import {viviendasDe} from '../../src/engine/viviendas.js';
const N=+(process.argv[2]||2),S0=+(process.argv[3]||1);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const COC=new Set(['cocina','sala_cocina','cocineta']);let deptos=0,zonas=0,vanos=0;const t0=Date.now();
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});
 for(const L of bp.lots)for(const lv of L.levels||[])for(const u of lv.units||[]){const qs=lv.rooms.filter(q=>q.unit===u.n);if(qs.length<2)continue;deptos++;const ej={ciudad:s,lote:L.id,piso:lv.level,n:u.n};
  const cerrados=qs.filter(q=>!q.abierto);zonas+=qs.length-cerrados.length;
  if(cerrados.length!==1||cerrados[0].type!=='bano')falla('un departamento con otro cuarto cerrado que el baño',{...ej,cerrados:cerrados.map(q=>q.type).join('/')});
  const dentro=(f,q)=>f.x>=q.x-.01&&f.y>=q.y-.01&&f.x+f.w<=q.x+q.w+.01&&f.y+f.h<=q.y+q.h+.01;
  if(qs.filter(q=>COC.has(q.type)&&(lv.furniture||[]).some(f=>f.kind==='meson'&&dentro(f,q))).length>1)falla('un departamento con más de una cocina',ej);
  const ids=new Set(qs.map(q=>q.id)),adentro=lv.doors.filter(d=>ids.has(d.a)&&ids.has(d.b));vanos+=adentro.filter(d=>d.wide).length;
  const conHoja=adentro.filter(d=>!d.wide);if(conHoja.length>1)falla('adentro, más de una puerta con hoja',{...ej,puertas:conHoja.length});
  for(const d of conHoja){const t=[d.a,d.b].map(id=>qs.find(q=>q.id===id)?.type);if(!t.includes('bano'))falla('una puerta con hoja que no es la del baño',{...ej,entre:t.join('/')});}}
 for(const v of viviendasDe(bp)){if(v.tipo!=='apto')continue;const aPie=v.puertas.filter(d=>!d.ascensor).length,asc=v.puertas.filter(d=>d.ascensor).length;
  if(aPie!==1)falla('un departamento sin una sola entrada a pie',{ciudad:s,id:v.id,aPie});if(asc>1)falla('un departamento con más de un ascensor',{ciudad:s,id:v.id,asc});}}
console.log(`departamentos · ${N} ciudades · ${deptos} departamentos abiertos: un baño cerrado cada uno, ${zonas} zonas sin paredes, ${vanos} vanos abiertos · ${Math.round((Date.now()-t0)/1000)} s`);
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size?1:0);
