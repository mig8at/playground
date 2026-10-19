// Busca caras que titilan (engine/titileo.js) en lo que el 3D arma en cajas, en node: los objetos del catálogo (cada
// variante), la escalera de cada material (stairBoxes) y las casas del monte (planHouse). Las piezas de fachada, en
// validar-fachada3d. Uso: node scripts/validar-titileo.mjs [ciudades=1] [semilla0=1]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {titilan,cajaDePieza} from '../src/engine/titileo.js';
import {OBJETOS} from '../src/lib/objetos3d.js';
import {stairOf,stairBoxes,STAIRS} from '../src/lib/town3d.js';
import {planHouse} from '../src/engine/vivienda.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||1),S0=+(A[1]||1),V=process.argv.includes('--ver');
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<4)f.ej.push(ej);};
const med={objetos:0,escaleras:0,casas:0};
// los objetos
for(const [k,o] of Object.entries(OBJETOS)){if(!o.piezas)continue;for(const variante of o.variantes||[undefined]){let ps;try{ps=o.piezas({variante});}catch{continue;}
 const C=ps.map(q=>cajaDePieza(q)).filter(Boolean);med.objetos++;for(const t of titilan(C))falla('objeto con caras que titilan',{objeto:k,variante,cara:t.cara,en:t.en,mats:t.mats,area:t.area});
 // (una pieza metida entera dentro de otra de otro color no se ve nunca —o se ve a ratos, titilando, si casi toca la cara—:
 // es un error de armado, como el vidrio de una puerta dentro de la hoja maciza)
 for(const a of C)for(const b of C)if(a!==b&&a.mat!==b.mat&&b.mat!=null&&a.x0>=b.x0-1e-6&&a.x1<=b.x1+1e-6&&a.y0>=b.y0-1e-6&&a.y1<=b.y1+1e-6&&a.z0>=b.z0-1e-6&&a.z1<=b.z1+1e-6){falla('objeto con una pieza enterrada en otra',{objeto:k,variante,enterrada:a.mat,en:b.mat});break;}}}
// las escaleras
const bp0=generateBlueprint({seed:S0,team:3}),L=bp0.lots.find(l=>l.levels?.length>=3&&l.levels[0].stair);
for(const [kind,ms] of Object.entries(STAIRS))for(const M of ms){const ST=stairOf(L.levels[0].stair,3,3),C=[];
 stairBoxes(ST,M,{floors:3,FLOOR:3,hallC:'#e2e4dc',box:(x,y,z,sx,sy,sz,color)=>C.push({x0:x-sx/2,x1:x+sx/2,y0:y,y1:y+sy,z0:z-sz/2,z1:z+sz/2,mat:color}),boxes:[]});med.escaleras++;
 for(const t of titilan(C))falla('escalera con caras que titilan',{material:kind,cara:t.cara,en:t.en,mats:t.mats,area:t.area});}
// las casas
for(let s=S0;s<S0+N;s++){const bp=s===S0?bp0:generateBlueprint({seed:s,team:3});
 for(const h of (bp.isla.casas||[]).filter(h=>h.spec).slice(0,40)){const H=planHouse({...h.spec,colores2d:h.colores,cortinas2d:h.cortinas});med.casas++;
  const C=H.boxes.map(b=>({...b,mat:b.color||b.cat}));for(const t of titilan(C))falla('casa con caras que titilan',{semilla:s,cara:t.cara,en:t.en,mats:t.mats,cats:[H.boxes[t.a].cat,H.boxes[t.b].cat],area:t.area});}}
console.log(`titileo · ${med.objetos} objetos (con sus variantes) · ${med.escaleras} escaleras · ${med.casas} casas`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
