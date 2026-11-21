// Valida el listado de propiedades (2026-11-21, engine/propiedades.js):
//  · es estable: la misma ciudad armada dos veces da el mismo listado, letra por letra;
//  · cada identificador es único y cada propiedad tiene área y precio;
//  · las viviendas del listado son las mismas que cuenta el cupo de la ciudad (engine/aparecer.js);
//  · el área de los departamentos de un piso no supera la huella de su edificio;
//  · el precio cuadra con su fórmula (recalculado acá) y, en un mismo edificio, a igual área un piso más alto no vale menos.
// Uso: node harness/pruebas/validar-propiedades.mjs [ciudades=2] [semilla0=1]
import {generateBlueprint} from '../../src/engine/blueprint.js';
import {propiedadesDe,resumenDe,PRECIO} from '../../src/engine/propiedades.js';
import {cupoDe} from '../../src/engine/aparecer.js';
const N=+(process.argv[2]||2),S0=+(process.argv[3]||1);const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
let total=0;const lineas=[];
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),P=propiedadesDe(bp),P2=propiedadesDe(generateBlueprint({seed:s,team:3}));total+=P.length;
 if(JSON.stringify(P)!==JSON.stringify(P2))falla('la misma ciudad dio otro listado',{ciudad:s});
 const ids=new Set();for(const p of P){if(ids.has(p.id))falla('identificador repetido',{ciudad:s,id:p.id});ids.add(p.id);
  if(!(p.area>0))falla('propiedad sin área',{ciudad:s,id:p.id,area:p.area});if(!(p.precio>0))falla('propiedad sin precio',{ciudad:s,id:p.id});
  if(p.area<8&&p.clase!=='local')falla('vivienda de menos de 8 m²',{ciudad:s,id:p.id,area:p.area});
  // el precio, recalculado por otro camino
  const esperado=Math.round(p.area*PRECIO.m2*PRECIO.clase[p.clase]*(1+PRECIO.centro*p.centro)*(1+Math.min(PRECIO.pisoMax,PRECIO.porPiso*p.piso))*(p.parque?1+PRECIO.parque:1)/PRECIO.redondeo)*PRECIO.redondeo;
  if(Math.abs(esperado-p.precio)>PRECIO.redondeo)falla('el precio no cuadra con su fórmula',{ciudad:s,id:p.id,precio:p.precio,esperado});}
 const viv=P.filter(p=>p.clase!=='local').length,cupo=cupoDe(bp).viviendas;if(viv!==cupo)falla('las viviendas del listado no son las del cupo',{ciudad:s,listado:viv,cupo});
 // por edificio y piso: el área vendida no supera la huella
 const porPiso=new Map();for(const p of P)if(p.lote!=null){const k=p.lote+':'+p.piso;porPiso.set(k,(porPiso.get(k)||0)+p.area);}
 for(const [k,a] of porPiso){const L=bp.lots[+k.split(':')[0]],huella=L.parts.reduce((x,q)=>x+q.w*q.h,0);if(a>huella+.5)falla('se vende más área que la huella del edificio',{ciudad:s,piso:k,area:+a.toFixed(1),huella});}
 // a igual área, más alto no vale menos
 const dep=P.filter(p=>p.clase==='departamento');for(const a of dep)for(const b of dep)if(a.lote===b.lote&&Math.abs(a.area-b.area)<.01&&a.piso<b.piso&&a.precio>b.precio)falla('un piso más alto vale menos a igual área',{ciudad:s,a:a.id,b:b.id});
 const R=resumenDe(P);lineas.push(`ciudad ${s}: ${R.n} propiedades, ${R.area.toLocaleString('es-CO')} m², valor ${R.valor.toLocaleString('es-CO')} · `+Object.entries(R.por).map(([c,v])=>`${c} ${v.n} (${v.min.toLocaleString('es-CO')}–${v.max.toLocaleString('es-CO')})`).join(' · '));}
console.log(`propiedades · ${N} ciudades · ${total} propiedades`);for(const l of lineas)console.log('  '+l);
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size?1:0);
