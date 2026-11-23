// El grafo de muros (2026-11-22, engine/grafo-muros.js; Miguel: «que el motor de plano tenga la capacidad de encontrar huecos de
// uniones y pueda ir refinando con lo que se espera… cálculos en 2D exactos y, al pasar al 3D, ahorrar polígonos y juntas
// exactas»). Arma el grafo de cada piso de la ciudad —tramos rectos, nodos, vanos colgados de su tramo— y falla si encuentra
// algo que no encaja: un vano sin muro, dos vanos que se pisan, un vano sobre una junta, dos regiones que se pisan, un hueco
// en la planta o una astilla de muro (lo que el refinador —refinarMuros— no pudo corregir). Cuenta también cuánto ahorra:
// tramos rectos contra los lados de cuarto con que arma hoy el 3D.
// Y las juntas con el espesor real (murosConEspesor, 2026-11-22: «medir muy bien en el 2D antes de pasar al 3D»): ningún par
// de muros se pisa y ningún tramo queda con un pedazo de su banda sin cubrir. Antes de contar, se comprueba que el detector
// ve las dos cosas: un muro acortado 3 cm abre una junta, y uno estirado 3 cm se pisa con el vecino.
// Y ningún vano de fachada —el que arma el 3D, por módulo— queda tapado por un muro que llega de adentro: el de 12 cm, sólo en
// la junta de dos módulos (el parante); el de 25 cm de una esquina, con el módulo recortado (recortarModulos, 2026-11-22).
// Uso: node harness/pruebas/validar-grafo-muros.mjs [ciudades=2] [semilla0=1]
import {generateBlueprint} from '../../src/engine/blueprint.js';
import {grafoDeLote,murosConEspesor,juntasDe,huecosTapados,grafoDeCasa} from '../../src/engine/grafo-muros.js';
import {vanoDeModulo} from '../../src/engine/fachada-piezas.js';
const N=+(process.argv[2]||2),S0=+(process.argv[3]||1);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
let piezas=0,probado=false,recortados=0;let pisos=0,tramos=0,lados=0,nodos=0,vanos=0;const ids=new Set(),t0=Date.now();
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});
 for(const L of bp.lots){if(!L.levels?.length)continue;
  recortados+=(L.modulos||[]).filter(m=>m.recorte).length;
  for(const x of huecosTapados(bp,L,vanoDeModulo))falla('vano de fachada tapado por un muro',{ciudad:s,tipo:L.type,...x});
  for(const [f,g] of grafoDeLote(bp,L).entries()){pisos++;tramos+=g.tramos.length;lados+=g.lados;nodos+=g.nodos.length;vanos+=g.vanos;
   for(const t of g.tramos){const k=s+':'+t.id;if(ids.has(k))falla('dos tramos con el mismo id',{ciudad:s,id:t.id});ids.add(k);}
   for(const p of g.problemas){const {junto,...ej}=p;falla(p.tipo,{ciudad:s,lote:L.id,tipo:L.type,piso:f,...ej});}
   const M=murosConEspesor(g),J=juntasDe(g,M);piezas+=M.length;
   for(const x of J.pisan)falla('dos muros que se pisan',{ciudad:s,lote:L.id,piso:f,...x});
   for(const x of J.abiertas)falla('junta abierta',{ciudad:s,lote:L.id,piso:f,...x});
   // (el detector, a prueba: en un muro que termina contra otro —una T—, acortarlo abre una junta y estirarlo lo pisa)
   if(!probado){const i=M.findIndex(m=>m.h<.2&&M.some(o=>o!==m&&Math.abs(o.x-(m.x+m.w))<.001&&m.y>=o.y-.001&&m.y+m.h<=o.y+o.h+.001));
    if(i>=0){probado=true;const corto=M.map((m,k)=>k===i?{...m,w:m.w-.03}:m),largo=M.map((m,k)=>k===i?{...m,w:m.w+.03}:m);
     if(!juntasDe(g,corto).abiertas.length)falla('el detector no ve una junta abierta de 3 cm',{id:M[i].id});
     if(!juntasDe(g,largo).pisan.length)falla('el detector no ve dos muros que se pisan 3 cm',{id:M[i].id});}}}}}
if(!probado)falla('no hubo una T para probar el detector',{});
// (y las casas del monte —grafoDeCasa, 2026-11-22—: el mismo grafo desde su plano, con los espesores de la casa; cada plano una vez)
let casas=0,pisosCasa=0;const vistas=new Set();
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});for(const h of bp.isla?.casas||[]){const P=h.spec?.hogar;if(!P)continue;const k=P.kind+'#'+P.variant;if(vistas.has(k))continue;vistas.add(k);casas++;
  grafoDeCasa(P,k).forEach((g,f)=>{pisosCasa++;for(const p of g.problemas){const {junto,...ej}=p;falla('casa: '+p.tipo,{casa:k,piso:f,...ej});}
   const M=murosConEspesor(g),J=juntasDe(g,M);for(const x of J.pisan)falla('casa: dos muros que se pisan',{casa:k,piso:f,...x});for(const x of J.abiertas)falla('casa: junta abierta',{casa:k,piso:f,...x});});}}
console.log(`grafo de muros · ${N} ciudades · ${pisos} pisos · ${tramos} tramos rectos contra ${lados} lados de cuarto (${Math.round(100*(1-tramos/lados))} % menos piezas) · ${piezas} piezas con espesor · ${casas} planos de casa (${pisosCasa} pisos) · ${recortados} módulos recortados en una esquina · ${nodos} nodos · ${vanos} vanos · ${Math.round((Date.now()-t0)/1000)} s`);
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size?1:0);
