// Valida la pintura de la calle (2026-10-16, pintura.js; Miguel: «las cebras repetidas y las rayas despegadas»):
//  · una sola fuente: ninguna cebra del equipamiento pisa a otra, y ninguna franja pisa a otra;
//  · cada franja, entera sobre la calzada (o sobre su cebra): ni en la vereda ni en un edificio;
//  · las líneas del monte, fuera de los cruces y de las cebras;
//  · cada cebra, partida en franjas de lado a lado (cubren su largo, PINTURA.cebra).
// Uso: node scripts/validar-pintura.mjs [ciudades=4] [semilla0=1]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {esquinasFranja} from '../src/engine/pintura.js';
import {mapaDeZonas} from '../src/engine/zonas.js';
import {PINTURA} from '../src/engine/medidas.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||4),S0=+(A[1]||1);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
// (dos rectángulos girados se pisan: separación por ejes, con 1 cm de tolerancia)
const pisan=(P,Q)=>{for(const R of [P,Q])for(let i=0;i<4;i++){const [ax,az]=R[i],[bx,bz]=R[(i+1)%4],nx=-(bz-az),nz=bx-ax,l=Math.hypot(nx,nz)||1;
 const pr=S=>S.map(([x,z])=>(x*nx+z*nz)/l),p=pr(P),q=pr(Q);if(Math.max(...p)<=Math.min(...q)+.01||Math.max(...q)<=Math.min(...p)+.01)return false;}return true;};
const cajaDe=o=>{const c=Math.abs(Math.cos(o.ang||0)),s=Math.abs(Math.sin(o.ang||0)),hw=(o.largo*c+o.fondo*s)/2,hd=(o.largo*s+o.fondo*c)/2;return [[o.x-hw,o.z-hd],[o.x+hw,o.z-hd],[o.x+hw,o.z+hd],[o.x-hw,o.z+hd]];};
const med={franjas:{},cebras:0};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),F=bp.pintura,{zonas}=mapaDeZonas(bp),cebras=bp.equipamiento.filter(o=>o.tipo==='cebra');med.cebras+=cebras.length;
 for(let i=0;i<cebras.length;i++)for(let j=i+1;j<cebras.length;j++)if(Math.hypot(cebras[i].x-cebras[j].x,cebras[i].z-cebras[j].z)<20&&pisan(cajaDe(cebras[i]),cajaDe(cebras[j])))falla('dos cebras que se pisan',{semilla:s,x:+cebras[i].x.toFixed(1),z:+cebras[i].z.toFixed(1)});
 // cada cebra, de lado a lado
 const porCebra=new Map();for(const f of F)if(f.tipo==='cebra')porCebra.set(f.de,(porCebra.get(f.de)||0)+1);
 cebras.forEach((o,i)=>{const n=porCebra.get('cebra'+i)||0;if(n*PINTURA.cebra.paso<o.largo-PINTURA.cebra.paso-1e-6)falla('cebra sin franjas de lado a lado',{semilla:s,largo:o.largo,franjas:n});});
 // los cruces del monte (para las líneas)
 const nodos=new Map(),k=p=>Math.round(p.x)+','+Math.round(p.z);
 for(const c of bp.isla.carreteras||[])for(const e of c.extremos||[]){if(!e)continue;const n=nodos.get(k(e))||nodos.set(k(e),{x:e.x,z:e.z,ancho:0}).get(k(e));n.ancho=Math.max(n.ancho,c.ancho||12);}
 const cubo=new Map(),CB=8;for(const [i,f] of F.entries()){med.franjas[f.tipo]=(med.franjas[f.tipo]||0)+1;const E=esquinasFranja(f);f.E=E;const ej={semilla:s,tipo:f.tipo,x:+f.x.toFixed(1),z:+f.z.toFixed(1)};
  // (las esquinas, 2 cm hacia adentro, y el centro)
  const pts=[[f.x,f.z],...E.map(([x,z])=>[x+(f.x-x)*.02/Math.hypot(f.x-x,f.z-z),z+(f.z-z)*.02/Math.hypot(f.x-x,f.z-z)])];
  const zs=pts.map(([x,z])=>zonas(x,z));
  if(zs.some(Z=>!(Z.has('calzada')||Z.has('cebra'))||Z.has('edificio')))falla('franja fuera de la calzada',{...ej,zonas:[...new Set(zs.flatMap(Z=>[...Z]))]});
  if(f.tipo!=='cebra'){if(zs.some(Z=>Z.has('cebra')))falla('línea que pisa una cebra',ej);
   for(const n of nodos.values())if(pts.some(([x,z])=>Math.abs(x-n.x)<n.ancho/2&&Math.abs(z-n.z)<n.ancho/2)){falla('línea adentro de un cruce',ej);break;}}
  for(let gx=Math.floor(Math.min(...E.map(p=>p[0]))/CB);gx<=Math.floor(Math.max(...E.map(p=>p[0]))/CB);gx++)for(let gz=Math.floor(Math.min(...E.map(p=>p[1]))/CB);gz<=Math.floor(Math.max(...E.map(p=>p[1]))/CB);gz++){const kk=gx+','+gz;(cubo.get(kk)||cubo.set(kk,[]).get(kk)).push(i);}}
 const vistos=new Set();for(const L of cubo.values())for(let a=0;a<L.length;a++)for(let b=a+1;b<L.length;b++){const i=L[a],j=L[b],kk=i<j?i+','+j:j+','+i;if(vistos.has(kk))continue;vistos.add(kk);
  if(pisan(F[i].E,F[j].E))falla('franjas que se pisan',{semilla:s,a:F[i].tipo,b:F[j].tipo,x:+F[i].x.toFixed(1),z:+F[i].z.toFixed(1)});}}
console.log(`pintura · ${Object.entries(med.franjas).map(([k,v])=>k+' '+v).join(', ')} franjas · ${med.cebras} cebras`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
