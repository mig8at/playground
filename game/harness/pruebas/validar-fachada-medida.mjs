// Valida la fachada medida (2026-11-21, engine/fachada-medida.js), en los cuatro lados de cada edificio:
//  · en cada piso, los vanos y los paños cubren el ancho exacto, sin pisarse ni dejar huecos;
//  · cada vano cabe en su piso (del piso al de arriba) y dentro del ancho;
//  · la textura del muro es de las de su familia, y un piso tiene un número entero de sus hiladas;
//  · el ancho de la fachada es un número entero de módulos de 2 m;
//  · cada paño pintable está en la planta baja, mide lo que dice, no pisa ningún vano y cae sobre la línea de su fachada.
// Uso: node harness/pruebas/validar-fachada-medida.mjs [ciudades=2] [semilla0=1]
import {generateBlueprint} from '../../src/engine/blueprint.js';
import {fachadaMedida,paniosPintables,TEXTURA_MURO,PINTABLE} from '../../src/engine/fachada-medida.js';
const N=+(process.argv[2]||2),S0=+(process.argv[3]||1);const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
let fachadas=0,vanos=0,panios=0,pint=0,area=0;const tex={};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});
 for(const L of bp.lots){if(!L.levels?.length)continue;for(const lado of ['N','S','E','W']){const F=fachadaMedida(L,lado),d={ciudad:s,lote:L.id,lado};fachadas++;
  if(lado===L.front)tex[F.textura]=(tex[F.textura]||0)+1;
  if(!(TEXTURA_MURO[F.familia]||TEXTURA_MURO.ladrillo).includes(F.textura))falla('la textura no es de su familia',{...d,familia:F.familia,textura:F.textura});
  if(F.hiladasPorPiso!=null&&Math.abs(F.hiladasPorPiso-Math.round(F.hiladasPorPiso))>1e-6)falla('un piso no tiene hiladas enteras',{...d,textura:F.textura,hiladas:F.hiladasPorPiso});
  if(Math.abs(F.modulos-Math.round(F.modulos))>1e-6)falla('el ancho no es un número entero de módulos',{...d,ancho:F.ancho});
  for(const P of F.pisos){vanos+=P.vanos.length;panios+=P.panios.length;
   const tr=[...P.vanos.map(v=>[v.u0,v.u1,'vano']),...P.panios.map(p=>[p.u0,p.u1,'paño'])].sort((a,b)=>a[0]-b[0]);let u=0;
   for(const [a,b,c] of tr){if(a<u-.002)falla(c==='vano'?'dos vanos se pisan':'un paño pisa un vano',{...d,piso:P.nivel,en:a});else if(a>u+.002)falla('queda un hueco sin vano ni paño',{...d,piso:P.nivel,de:u,a});u=Math.max(u,b);}
   if(Math.abs(u-F.ancho)>.002)falla('los tramos no llegan al ancho',{...d,piso:P.nivel,llega:u,ancho:F.ancho});
   for(const v of P.vanos){if(v.u0<-.002||v.u1>F.ancho+.002)falla('un vano se sale del ancho',{...d,piso:P.nivel,v});if(v.y0<P.base-.002||v.y1>P.base+3+.002||v.y1<=v.y0)falla('un vano no cabe en su piso',{...d,piso:P.nivel,v});}}}}
 for(const p of paniosPintables(bp)){pint++;area+=p.area;const L=bp.lots[p.lote],F=fachadaMedida(L,p.lado),d={ciudad:s,id:p.id};
  if(p.ancho<PINTABLE.anchoMin-1e-6)falla('un paño pintable es más angosto que el mínimo',d);if(Math.abs(p.area-p.ancho*p.alto)>.01)falla('el área del paño no es ancho × alto',d);
  for(const v of F.pisos[0].vanos)if(Math.min(p.u1,v.u1)-Math.max(p.u0,v.u0)>.002)falla('un paño pintable pisa un vano',{...d,vano:v.clase});
  // sobre la línea de su fachada: sus dos puntas están en el borde del rectángulo del edificio
  const r=L.rect,enBorde=(x,z)=>Math.abs(x-r.x)<.01||Math.abs(x-r.x-r.w)<.01||Math.abs(z-r.y)<.01||Math.abs(z-r.y-r.h)<.01;if(!enBorde(p.x0,p.z0)||!enBorde(p.x1,p.z1))falla('un paño pintable no cae sobre su fachada',d);
  if(Math.abs(Math.hypot(p.x1-p.x0,p.z1-p.z0)-p.ancho)>.01)falla('el paño no mide en el plano lo que dice',d);}}
console.log(`fachada medida · ${N} ciudades · ${fachadas} fachadas, ${vanos} vanos, ${panios} paños · ${pint} paños pintables, ${Math.round(area)} m²`);
console.log('  texturas de los frentes: '+Object.entries(tex).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k} ${n}`).join(' · '));
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size?1:0);
