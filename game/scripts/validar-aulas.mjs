// Nivel 4 del probador (2026-10-17, Miguel: «en las escuelas creo que falta buenas mesas»): el aula como un salón de verdad.
//  · cada aula tiene su pizarrón, y cada pupitre MIRA hacia él: la silla del alumno queda del lado contrario al pizarrón
//    (antes la grilla siempre miraba a la misma pared y el pizarrón iba en cualquiera: 56 de 243 alumnos de espaldas);
//  · cada pupitre con su silla delante de su frente (la prueba de movimiento saca la que no se alcanza —con pasillos
//    angostos, 1 de 5— y el pupitre se va con ella).
// Uso: node scripts/validar-aulas.mjs [ciudades=4] [semilla0=1]
import {generateBlueprint} from '../src/engine/blueprint.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||4),S0=+(A[1]||1);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const med={aulas:0,pupitres:0,conSilla:0,casilleros:0};
const c=f=>[f.x+f.w/2,f.y+f.h/2],dentro=(f,q)=>{const [x,z]=c(f);return x>q.x&&x<q.x+q.w&&z>q.y&&z<q.y+q.h;};// (por su centro: el del aula de al lado queda afuera)
const niveles=(o,d=0,out=[])=>{if(!o||typeof o!=='object'||d>6)return out;if(Array.isArray(o.rooms)&&Array.isArray(o.furniture)){out.push(o);return out;}for(const v of Object.values(o))niveles(v,d+1,out);return out;};
for(let s=S0;s<S0+N;s++)for(const lv of niveles(generateBlueprint({seed:s,team:3})))for(const q of lv.rooms.filter(r=>r.type==='aula')){
 const F=lv.furniture.filter(f=>f.rt==='aula'&&dentro(f,q)),tb=F.find(f=>f.kind==='tablero'),P=F.filter(f=>f.kind==='pupitre'),S=F.filter(f=>f.kind==='silla');
 med.aulas++;med.casilleros+=F.filter(f=>f.kind==='casillero').length;if(!tb){falla('aula sin pizarrón',{semilla:s,aula:[q.x,q.y]});continue;}
 const T=c(tb);
 for(const p of P){med.pupitres++;const [px,pz]=c(p),fx=Math.sin(p.ry),fz=Math.cos(p.ry);// el frente del pupitre: hacia el alumno
  // su silla: la que está justo delante de su frente, a medio fondo de pupitre
  const silla=S.find(ch=>{const [cx,cz]=c(ch),dx=cx-px,dz=cz-pz,a=dx*fx+dz*fz,l=Math.abs(-dx*fz+dz*fx);return a>.2&&a<.8&&l<.15;});
  if(silla)med.conSilla++;else falla('pupitre sin su silla',{semilla:s,aula:[q.x,q.y],pupitre:[+px.toFixed(2),+pz.toFixed(2)]});
  // mirando al pizarrón: su frente (donde se sienta el alumno) apunta lejos del pizarrón
  if((T[0]-px)*fx+(T[1]-pz)*fz>0)falla('pupitre de espaldas al pizarrón',{semilla:s,aula:[q.x,q.y],pupitre:[+px.toFixed(2),+pz.toFixed(2)]});}}
console.log(`aulas · ${N} ciudades · ${med.aulas} aulas · ${med.pupitres} pupitres, ${med.conSilla} con su silla (${(med.conSilla/med.pupitres*100).toFixed(1)} %) · ${med.casilleros} casilleros`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
