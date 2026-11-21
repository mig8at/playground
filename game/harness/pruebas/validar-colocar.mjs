// Valida la colocación de objetos (2026-11-21, engine/colocar.js): en cada cuarto de la ciudad se intenta colgar y apoyar
// cada objeto del catálogo en muchos puntos, y de todo lo que el motor ACEPTA se comprueba, por otro camino, que cuadra:
//  · de pared: entra entero en el tramo de pared de su cuarto, no pisa ninguna puerta ni ventana de esa pared, y está en la grilla;
//  · de piso: entra entero en su cuarto, no pisa ningún mueble, y está en la grilla;
//  · dos objetos aceptados uno tras otro en el mismo cuarto no se pisan entre sí;
//  · lo que rechaza trae su razón.
// Uso: node harness/pruebas/validar-colocar.mjs [ciudades=2] [semilla0=1]
import {generateBlueprint} from '../../src/engine/blueprint.js';
import {colocar,OBJETOS,GRILLA,paredesDe,vanosDe} from '../../src/engine/colocar.js';
const N=+(process.argv[2]||2),S0=+(process.argv[3]||1);const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
let intentos=0,aceptados=0,razones={};const enGrilla=(v,g)=>Math.abs(v/g-Math.round(v/g))<1e-6;
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});
 for(const L of bp.lots)for(const lv of L.levels.slice(0,L.floors))for(const q of lv.rooms){const ya=[];
  for(const [tipo,O] of Object.entries(OBJETOS))for(let k=0;k<6;k++){const u=.03+.94*((k*37+q.id*11)%100)/100,v=.03+.94*((k*61+q.id*7)%100)/100,// (adentro del cuarto: en el borde el punto es de dos)
   p={x:q.x+u*q.w,z:q.y+v*q.h};intentos++;
   const r=colocar(lv,p,tipo,ya,k%2?GRILLA.giro:0),donde={ciudad:s,lote:L.id,piso:lv.level,cuarto:q.type,tipo};
   if(!r.ok){if(!r.razon)falla('rechaza sin decir por qué',donde);razones[r.razon]=(razones[r.razon]||0)+1;continue;}aceptados++;
   if(r.cuarto!==q.id)falla('lo puso en otro cuarto',donde);
   if(O.modo==='pared'){const P=paredesDe(q).find(P=>P.lado===r.lado);if(r.t0<P.a0-1e-6||r.t1>P.a1+1e-6)falla('un objeto de pared se sale de su pared',donde);
    for(const vn of vanosDe(lv,P))if(Math.min(r.t1,vn.q)-Math.max(r.t0,vn.p)>1e-6)falla('un objeto de pared pisa una '+vn.clase,donde);
    if(!enGrilla((r.t0+r.t1)/2,GRILLA.pared)&&Math.abs((r.t0+r.t1)/2-(P.a0+.1+O.ancho/2))>1e-6&&Math.abs((r.t0+r.t1)/2-(P.a1-.1-O.ancho/2))>1e-6)falla('un objeto de pared fuera de la grilla',donde);
    for(const o of ya)if(o.modo==='pared'&&o.cuarto===r.cuarto&&o.lado===r.lado&&Math.min(r.t1,o.t1)-Math.max(r.t0,o.t0)>1e-6)falla('dos objetos colgados se pisan',donde);}
   else{const R=r.rect;if(R.x<q.x-1e-6||R.y<q.y-1e-6||R.x+R.w>q.x+q.w+1e-6||R.y+R.h>q.y+q.h+1e-6)falla('un objeto de piso se sale del cuarto',donde);
    for(const f of lv.furniture)if(Math.min(R.x+R.w,f.x+f.w)-Math.max(R.x,f.x)>.002&&Math.min(R.y+R.h,f.y+f.h)-Math.max(R.y,f.y)>.002)falla('un objeto de piso pisa un mueble',{...donde,mueble:f.kind});
    for(const o of ya)if(o.modo==='piso'&&Math.min(R.x+R.w,o.rect.x+o.rect.w)-Math.max(R.x,o.rect.x)>.002&&Math.min(R.y+R.h,o.rect.y+o.rect.h)-Math.max(R.y,o.rect.y)>.002)falla('dos objetos de piso se pisan',donde);}
   ya.push(r);}}}
console.log(`colocar · ${N} ciudades · ${intentos} intentos, ${aceptados} aceptados (${(aceptados/intentos*100).toFixed(0)} %)`);
console.log('rechazos:',Object.entries(razones).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${n} «${k.replace(/\d+\.\d+/g,'#')}»`).slice(0,8).join(' · '));
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size?1:0);
