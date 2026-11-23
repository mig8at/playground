// La versión de lejos (2026-11-22, Miguel: «según las estrategias de GTA 6 para aumentar el rendimiento» → «arranca y miramos con
// 1»): cada edificio tiene su caja de lejos —town3d cascarones, downtown3d setLejos— y cada planta su versión baja —nature3d
// plantBatched setLejos—. Sin pantalla, con el mundo armado como el juego (sin-pantalla.mjs):
//  · cada caja de lejos coincide al milímetro con una parte del edificio en el plano y llega a su altura (L.h y la escalinata);
//  · con la cámara en un punto, pasan a su caja justo los lotes a más de LEJOS.lejos de él —y vuelven más acá de LEJOS.cerca—;
//  · cada lote de plantas tiene sus niveles: el mismo modelo, simplificado, con menos triángulos en cada paso.
// Uso: node harness/pruebas/validar-lejos.mjs [ciudades=1] [semilla0=1]
import {armarMundo} from './sin-pantalla.mjs';
import {LEJOS} from '../../src/lib/downtown3d.js';
const N=+(process.argv[2]||1),S0=+(process.argv[3]||1);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
let lotes=0,lejos=0,plantas=0;const trisNivel=[0,0,0];const t0=Date.now();
for(let s=S0;s<S0+N;s++){const {world:w,bp,plano}=await armarMundo(s,3),B=w.buildings;
 if(!B?.setLejos){falla('el mundo sin cajas de lejos',{ciudad:s});continue;}
 // (la cámara en el medio del mapa: los lotes más lejos que LEJOS.lejos, a su caja; los más cerca, con su detalle)
 const cx=w.size.w/2,cz=w.size.h/2;B.setLejos(cx,cz);const L=B.lejos();
 for(const P of bp.lots){if(!P.parts?.length)continue;lotes++;const d=Math.min(...P.parts.map(p=>Math.hypot(Math.max(p.x-cx,0,cx-p.x-p.w),Math.max(p.y-cz,0,cz-p.y-p.h))));
  if(d>LEJOS.lejos+.01&&!L.has(P.id))falla('un lote lejos que no pasó a su caja',{ciudad:s,lote:P.id,m:+d.toFixed(1)});
  if(d<LEJOS.lejos-.01&&L.has(P.id))falla('un lote cerca dibujado como caja',{ciudad:s,lote:P.id,m:+d.toFixed(1)});if(L.has(P.id))lejos++;}
 // (las cajas, contra el plano: cada parte con su caja, al milímetro, hasta la altura del edificio)
 for(const c of w.cascarones||[]){const P=bp.lots.find(l=>l.id===c.lote),R=w.lots.get(c.lote)?.raise||0;if(!P)continue;
  for(const p of P.parts){const k=c.cajas.find(b=>b.y===0&&Math.abs(b.x-(p.x+p.w/2))<.001&&Math.abs(b.z-(p.y+p.h/2))<.001&&Math.abs(b.w-p.w)<.001&&Math.abs(b.d-p.h)<.001);
   if(!k){falla('una parte del edificio sin su caja de lejos',{ciudad:s,lote:c.lote});continue;}if(Math.abs(k.h-(P.floors*3+R))>.01)falla('una caja de lejos que no llega a la altura del edificio',{ciudad:s,lote:c.lote,caja:k.h,edificio:P.floors*3+R});}}
 // (las plantas: cada lote, con su versión de lejos)
 // (2026-11-22: los niveles son el mismo modelo simplificado —nature3d NIVELES_PLANTA—: cada lote con sus niveles, cada uno con
 // menos triángulos que el anterior y el último a lo más un cuarto del modelo —o 40 triángulos en uno chico, que no baja más sin perder la forma—)
 const lp=plano?.setLejos?plano:null;if(!lp)falla('las plantas sin versión de lejos',{ciudad:s});else{const g=plano.group;g.traverse(o=>{const n=o.userData?.niveles;if(o.name!=='plantas'||!n)return;plantas++;n.forEach((t,k)=>{if(k<3)trisNivel[k]+=t*(o.instanceCount??o.maxInstanceCount??0);});
  if(n.length<3||n.some((t,i)=>i&&t>n[i-1])||n.at(-1)>Math.max(n[0]*.25,40))falla('plantas con niveles que no bajan',{ciudad:s,niveles:n});});if(!plantas)falla('las plantas sin versión de lejos',{ciudad:s});}}
console.log(`lejos · ${N} ciudades · ${lotes} lotes, ${lejos} a su caja con la cámara en el medio (a más de ${LEJOS.lejos} m) · ${plantas} lotes de plantas con niveles (triángulos de todas las plantas en cada nivel: ${trisNivel.map(t=>Math.round(t/1000)+' mil').join(' · ')}) · ${Math.round((Date.now()-t0)/1000)} s`);
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size?1:0);
