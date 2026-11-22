// El grafo de muros (2026-11-22, engine/grafo-muros.js; Miguel: «que el motor de plano tenga la capacidad de encontrar huecos de
// uniones y pueda ir refinando con lo que se espera… cálculos en 2D exactos y, al pasar al 3D, ahorrar polígonos y juntas
// exactas»). Arma el grafo de cada piso de la ciudad —tramos rectos, nodos, vanos colgados de su tramo— y falla si encuentra
// algo que no encaja: un vano sin muro, dos vanos que se pisan, un vano sobre una junta, dos regiones que se pisan, un hueco
// en la planta o una astilla de muro (lo que el refinador —refinarMuros— no pudo corregir). Cuenta también cuánto ahorra:
// tramos rectos contra los lados de cuarto con que arma hoy el 3D.
// Uso: node harness/pruebas/validar-grafo-muros.mjs [ciudades=2] [semilla0=1]
import {generateBlueprint} from '../../src/engine/blueprint.js';
import {grafoDeLote} from '../../src/engine/grafo-muros.js';
const N=+(process.argv[2]||2),S0=+(process.argv[3]||1);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
let pisos=0,tramos=0,lados=0,nodos=0,vanos=0;const ids=new Set(),t0=Date.now();
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});
 for(const L of bp.lots){if(!L.levels?.length)continue;
  for(const [f,g] of grafoDeLote(bp,L).entries()){pisos++;tramos+=g.tramos.length;lados+=g.lados;nodos+=g.nodos.length;vanos+=g.vanos;
   for(const t of g.tramos){const k=s+':'+t.id;if(ids.has(k))falla('dos tramos con el mismo id',{ciudad:s,id:t.id});ids.add(k);}
   for(const p of g.problemas){const {junto,...ej}=p;falla(p.tipo,{ciudad:s,lote:L.id,tipo:L.type,piso:f,...ej});}}}}
console.log(`grafo de muros · ${N} ciudades · ${pisos} pisos · ${tramos} tramos rectos contra ${lados} lados de cuarto (${Math.round(100*(1-tramos/lados))} % menos piezas) · ${nodos} nodos · ${vanos} vanos · ${Math.round((Date.now()-t0)/1000)} s`);
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size?1:0);
