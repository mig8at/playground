// Valida que se pueda recorrer cada edificio y cada casa caminando, sin el 3D (2026-10-16, nav-interior.js): desde las
// puertas de calle, por puertas y pasillos, entre muebles, y subiendo por la escalera, el personaje (radio de
// CIRCULACION.peaton) llega a cada cuarto de cada piso. Mide también qué parte de cada cuarto queda a su alcance y el
// recorrido más largo desde la calle.
// Uso: node scripts/validar-interiores.mjs [ciudades=4] [semilla0=1] [jugadores=3] [--todo]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {navEdificio,navCasa} from '../src/engine/nav-interior.js';
import {CIRCULACION as C} from '../src/engine/medidas.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||4),S0=+(A[1]||1),TEAM=+(A[2]||3),TODO=process.argv.includes('--todo');
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(TODO||f.ej.length<3)f.ej.push(ej);};
const med={edificios:0,casas:0,pisos:0,cuartos:0,alcanzados:0,area:[0,0],parciales:0,lejos:[],porTipo:{}};
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.min(b.length-1,Math.floor(p*b.length))]:NaN;};
const revisar=(pisos,tag)=>{let lejos=0;for(const p of pisos){med.pisos++;lejos=Math.max(lejos,p.lejos);
  for(const w of p.puertas)if(w<2*C.peaton.radio+.2)falla('puerta por la que no pasa el personaje',{...tag,piso:p.nivel,m:+w.toFixed(2)});
  for(const e of p.espacios){if(e.libres<.05)continue;med.cuartos++;med.area[0]+=e.alcanzado;med.area[1]+=e.libres;
   if(e.alcanzado<=0){falla(`no se llega caminando a un cuarto (${e.tipo})`,{...tag,piso:p.nivel,cuarto:e.id,tipo:e.tipo});(med.porTipo[e.tipo]??=[0,0])[1]++;}
   else{med.alcanzados++;(med.porTipo[e.tipo]??=[0,0])[0]++;(med.porTipo[e.tipo])[1]++;if(e.alcanzado<.5*e.libres)med.parciales++;}}}
 med.lejos.push(lejos);};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:TEAM});
 for(const L of [...bp.lots,...(bp.isla.lots||[]).filter(L=>L.type==='residencial'&&L.levels)]){if(!L.levels?.length)continue;med.edificios++;revisar(navEdificio(L),{semilla:s,lote:L.id,tipo:L.type});}
 for(const h of bp.isla.casas||[]){if(!h.spec?.hogar)continue;med.casas++;revisar(navCasa(h),{semilla:s,casa:h.manzana,tipo:'casa'});}}
const pc=(a,b)=>b?(100*a/b).toFixed(1)+' %':'—';
console.log(`${N} mundos · ${med.edificios} edificios y ${med.casas} casas · ${med.pisos} pisos · ${med.cuartos} espacios (cuartos, pasillos, núcleos)`);
console.log(`se llega caminando a ${pc(med.alcanzados,med.cuartos)} de los espacios y a ${pc(med.area[0],med.area[1])} de su piso libre · espacios alcanzables sólo en menos de la mitad (muebles): ${med.parciales}`);
console.log(`recorrido más largo desde la calle (por edificio, en línea de grilla): mediana ${q(med.lejos,.5).toFixed(1)} m · p90 ${q(med.lejos,.9).toFixed(1)} m · máx ${q(med.lejos,1).toFixed(1)} m`);
const malos=Object.entries(med.porTipo).filter(([,v])=>v[0]<v[1]).map(([k,v])=>`${k} ${v[0]}/${v[1]}`);if(malos.length)console.log('por tipo (alcanzados/total, sólo los que faltan): '+malos.join(' · '));
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
