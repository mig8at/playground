// Valida la fachada medida (2026-11-21, engine/fachada-medida.js), en los cuatro lados de cada edificio:
//  · en cada piso, los vanos y los paños cubren el ancho exacto, sin pisarse ni dejar huecos;
//  · cada vano cabe en su piso (del piso al de arriba) y dentro del ancho;
//  · la textura del muro es de las de su familia, y un piso tiene un número entero de sus hiladas;
//  · el ancho de la fachada es un número entero de módulos de 2 m;
//  · cada paño pintable está en la planta baja, mide lo que dice, no pisa ningún vano y cae sobre la línea de su fachada.
// Uso: node harness/pruebas/validar-fachada-medida.mjs [ciudades=2] [semilla0=1]
import {generateBlueprint} from '../../src/engine/blueprint.js';
import {fachadaMedida,paniosPintables,TEXTURA_MURO,PINTABLE,tramosDe} from '../../src/engine/fachada-medida.js';
const N=+(process.argv[2]||2),S0=+(process.argv[3]||1);const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
let fachadas=0,vanos=0,panios=0,pint=0,area=0,tramos=0,enL=0;const tex={};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});
 for(const L of bp.lots){if(!L.levels?.length)continue;
  // los tramos: cubren todo el contorno del edificio (su perímetro, casilla por casilla) y no repiten código
  {const T=tramosDe(L),dentro=new Set();for(const p of L.parts)for(let y=p.y/6;y<(p.y+p.h)/6;y++)for(let x=p.x/6;x<(p.x+p.w)/6;x++)dentro.add(x+','+y);let per=0;for(const k of dentro){const [x,y]=k.split(',').map(Number);for(const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0]])if(!dentro.has((x+dx)+','+(y+dy)))per+=6;}
   const suma=T.reduce((a,t)=>a+t.ancho,0);tramos+=T.length;if(T.length>4)enL++;if(Math.abs(suma-per)>.01)falla('los tramos no suman el contorno del edificio',{ciudad:s,lote:L.id,suma,per});if(new Set(T.map(t=>t.codigo)).size!==T.length)falla('código de tramo repetido',{ciudad:s,lote:L.id});
   // cada módulo de fachada del plano cae en algún tramo
   for(const m of L.modulos||[]){const ex=(m.x+.5+m.dx*.5)*6,ez=(m.y+.5+m.dy*.5)*6,h=m.dy!==0,c=h?ex+m.dy*(-2+2*m.k):ez-m.dx*(-2+2*m.k);if(!T.some(t=>t.horiz===h&&Math.abs(t.linea-(h?ez:ex))<.01&&c>t.o-.01&&c<t.o+t.ancho+.01)){falla('un módulo de fachada fuera de todo tramo',{ciudad:s,lote:L.id,m});break;}}}
  for(const lado of tramosDe(L).map(t=>t.codigo)){const F=fachadaMedida(L,lado),d={ciudad:s,lote:L.id,lado};fachadas++;
  if(lado===L.front+'0')tex[F.textura]=(tex[F.textura]||0)+1;
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
  const enBorde=(x,z)=>(L.parts||[]).some(q=>x>=q.x-.01&&x<=q.x+q.w+.01&&z>=q.y-.01&&z<=q.y+q.h+.01&&(Math.abs(x-q.x)<.01||Math.abs(x-q.x-q.w)<.01||Math.abs(z-q.y)<.01||Math.abs(z-q.y-q.h)<.01));if(!enBorde(p.x0,p.z0)||!enBorde(p.x1,p.z1))falla('un paño pintable no cae sobre su fachada',d);
  if(Math.abs(Math.hypot(p.x1-p.x0,p.z1-p.z0)-p.ancho)>.01)falla('el paño no mide en el plano lo que dice',d);}}
console.log(`fachada medida · ${N} ciudades · ${tramos} tramos de fachada (${enL} edificios con más de cuatro) · ${fachadas} fachadas, ${vanos} vanos, ${panios} paños · ${pint} paños pintables, ${Math.round(area)} m²`);
console.log('  texturas de los frentes: '+Object.entries(tex).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k} ${n}`).join(' · '));
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size?1:0);
