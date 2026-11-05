// Nivel 4 del probador (2026-10-17, Miguel: «por ejemplo hay gimnasio y tiendas de ropa»): los locales con giro que
// tienen muebles propios. Por giro (GIROS):
//  · lo que va en cada local (el mostrador, el espejo del gimnasio, el probador de la tienda);
//  · lo que tiene el negocio entre todos sus locales (las cuatro máquinas; la estantería, los percheros y un maniquí);
//  · lo que no puede mirar a una pared: delante de su frente quedan ≥ «antes» m hasta el muro del local (subirse a una
//    máquina, entrar al probador, sacar una prenda de la estantería). Van de espaldas a la pared o, los que pueden
//    (blueprint SUELTO), sueltos en el medio si contra la pared no entran.
// Que se alcancen caminando lo prueban interiores y usos. (Antes validar-gimnasios.)
// Uso: node scripts/validar-giros.mjs [ciudades=4] [semilla0=1]
import {generateBlueprint} from '../src/engine/blueprint.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||4),S0=+(A[1]||1);
const GIROS={
 gimnasio:{local:['espejo_pared','mostrador'],negocio:['caminadora','bicicleta','banco','mancuernas'],frente:{caminadora:.5,bicicleta:.5,banco:.5,mancuernas:.5}},
 ropa:{local:['mostrador','probador'],negocio:['estanteria_ropa','perchero','maniqui'],frente:{probador:.7,estanteria_ropa:.6}}};
const MURO=.2;// (el cuarto va hasta el eje del muro: medio muro y la holgura del plano, ~20 cm)
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const c=f=>[f.x+f.w/2,f.y+f.h/2],dentro=(f,q)=>{const [x,z]=c(f);return x>q.x&&x<q.x+q.w&&z>q.y&&z<q.y+q.h;};
const niveles=(o,d=0,out=[])=>{if(!o||typeof o!=='object'||d>6)return out;if(Array.isArray(o.rooms)&&Array.isArray(o.furniture)){out.push(o);return out;}for(const v of Object.values(o))niveles(v,d+1,out);return out;};
const med={};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});
 for(const [g,G] of Object.entries(GIROS))for(const L of bp.lots.filter(l=>l.giro===g)){const M=med[g]||(med[g]={negocios:0,locales:0,cuenta:{}});M.negocios++;const hay=new Set();
  for(const lv of niveles(L))for(const q of lv.rooms.filter(r=>r.giro===g)){M.locales++;const F=lv.furniture.filter(f=>f.giro===g&&dentro(f,q)),ej={semilla:s,giro:g,lote:L.id,local:[q.x,q.y]};
   for(const k of G.local)if(!F.some(f=>f.kind===k))falla(`local sin ${k}`,ej);
   for(const f of F){M.cuenta[f.kind]=(M.cuenta[f.kind]||0)+1;hay.add(f.kind);const antes=G.frente[f.kind];if(antes==null)continue;
    // su frente: desde el medio de su borde de adelante, hacia donde mira, hasta el muro del local
    const [x,z]=c(f),fx=Math.round(Math.sin(f.ry)),fz=Math.round(Math.cos(f.ry)),hf=fx?f.w/2:f.h/2,ax=x+fx*hf,az=z+fz*hf;
    const d=fx>0?q.x+q.w-ax:fx<0?ax-q.x:fz>0?q.y+q.h-az:az-q.y;
    if(d<antes+MURO)falla(`${f.kind} que mira a una pared (sin lugar delante)`,{...ej,cm:Math.round(d*100)});}}
  for(const k of G.negocio)if(!hay.has(k))falla(`${g} sin ${k}`,{semilla:s,lote:L.id,nombre:L.shopName});}}
console.log(`giros · ${N} ciudades · `+Object.entries(med).map(([g,M])=>`${g}: ${M.negocios} en ${M.locales} locales (${Object.entries(M.cuenta).map(([k,v])=>k+' '+v).join(', ')})`).join(' · '));
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
