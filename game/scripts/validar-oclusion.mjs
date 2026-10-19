// Nivel 6 del probador (2026-10-16, Miguel: «las capas con limitaciones para que los objetos no queden ocultos por otro»):
// los objetos que pone el plano, como los dibuja el 3D (plano3d registro: su lugar, giro y medida dibujada), sin pantalla:
//  · metido en un edificio: su planta entra en un edificio de la ciudad o del monte, o en una casa (queda tapado);
//  · dos que se pisan: sus plantas se cruzan y sus altos también (uno tapa al otro). De un árbol, una palmera o una
//    sombrilla cuenta el tronco o el palo hasta 2,2 m: la copa va por arriba;
//  · cómo apoya: los de base plana —banca, papelera, kiosco, parada, salvavidas, hidrante— con cada esquina de su planta
//    a ≤ APOYO del suelo dibujado (o, sobre su losa, con la losa llegando al suelo): una esquina que flota deja ver por
//    debajo; una que se hunde, se corta.
// Fuera: la pintura (cebra), las placas (van en la fachada) y el botín (va adentro). Da la peor de cada tipo.
// Uso: node scripts/validar-oclusion.mjs [ciudades=1] [semilla0=1]
import {armarMundo} from './sin-pantalla.mjs';
import {cuerpoCasa} from '../src/engine/circulacion.js';
import {planHouse} from '../src/engine/vivienda.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||1),S0=+(A[1]||1),APOYO=.05,COPA=2.2;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const FUERA=/^(cebra|placa|escultura|cuadro|vitrina|caja_fuerte|joyas)$/,PLANO=new Set(['banca','papelera','kiosco','parada','salvavidas','hidrante']);
const esArbol=r=>r.tronco!=null||/Tree|Palm/.test(r.modelo);
// la planta de un objeto: un rectángulo girado (u a lo ancho, v a lo hondo), o el disco de su tronco
const planta=r=>{if(esArbol(r))return {disco:true,x:r.x,z:r.z,r:(r.tronco||.4)/2,y0:r.y,y1:r.y+COPA};if(r.modelo==='sombrilla')return {disco:true,x:r.x,z:r.z,r:.05,y0:r.y,y1:r.y+COPA};
 const c=Math.cos(r.ry||0),s=Math.sin(r.ry||0),a=r.ancho/2,b=r.fondo/2;return {x:r.x,z:r.z,c,s,a,b,y0:r.y,y1:r.y+r.alto,esq:[[-a,-b],[a,-b],[a,b],[-a,b]].map(([u,v])=>[r.x+u*c+v*s,r.z-u*s+v*c])};};
const enRect=(P,x,z)=>{const dx=x-P.x,dz=z-P.z,u=dx*P.c-dz*P.s,v=dx*P.s+dz*P.c;return Math.abs(u)<=P.a&&Math.abs(v)<=P.b;};
// ¿se cruzan dos plantas? (separación por ejes entre rectángulos; disco contra rectángulo por el punto más cercano)
const proy=(E,ax)=>{const p=E.map(([x,z])=>x*ax[0]+z*ax[1]);return [Math.min(...p),Math.max(...p)];};
const cruzan=(P,Q)=>{if(P.disco&&Q.disco)return Math.hypot(P.x-Q.x,P.z-Q.z)<P.r+Q.r-.01;
 if(P.disco||Q.disco){const [D,R]=P.disco?[P,Q]:[Q,P],dx=D.x-R.x,dz=D.z-R.z,u=Math.max(-R.a,Math.min(R.a,dx*R.c-dz*R.s)),v=Math.max(-R.b,Math.min(R.b,dx*R.s+dz*R.c)),qx=R.x+u*R.c+v*R.s,qz=R.z-u*R.s+v*R.c;return Math.hypot(D.x-qx,D.z-qz)<D.r-.01;}
 for(const R of [P,Q])for(const ax of [[R.c,-R.s],[R.s,R.c]]){const a=proy(P.esq,ax),b=proy(Q.esq,ax);if(a[1]<=b[0]+.01||b[1]<=a[0]+.01)return false;}return true;};
const med={objetos:0,apoyo:[],porTipo:{},losas:0},peor={};
for(let s=S0;s<S0+N;s++){const M=await armarMundo(s),{bp,suelo}=M,R=M.plano.registro.filter(r=>!r.falta&&!FUERA.test(r.modelo));med.objetos+=R.length;
 const edif=[...bp.lots.flatMap(L=>L.parts||[]),...(bp.isla.lots||[]).flatMap(L=>L.parts||[])].map(p=>({x0:p.x,x1:p.x+p.w,z0:p.y,z1:p.y+p.h,que:'edificio'})),casas=(bp.isla.casas||[]).map(h=>({...cuerpoCasa(h),que:'casa'}));
 const P=R.map(planta),cubo=new Map(),CB=8;P.forEach((p,i)=>{const gx=Math.floor(p.x/CB),gz=Math.floor(p.z/CB);for(let a=gx-1;a<=gx+1;a++)for(let b=gz-1;b<=gz+1;b++){const k=a+','+b;(cubo.get(k)||cubo.set(k,[]).get(k)).push(i);}});
 R.forEach((r,i)=>{const p=P[i],ej={semilla:s,objeto:r.modelo,x:+r.x.toFixed(2),z:+r.z.toFixed(2)};med.porTipo[r.modelo]=(med.porTipo[r.modelo]||0)+1;if(r.losa)med.losas++;
  // metido en un edificio o una casa (por su centro y sus esquinas, 2 cm adentro)
  const pts=p.disco?[[p.x,p.z]]:[[p.x,p.z],...p.esq.map(([x,z])=>[x+(p.x-x)*.02,z+(p.z-z)*.02])];
  for(const b of [...edif,...casas])if(pts.some(([x,z])=>x>b.x0&&x<b.x1&&z>b.z0&&z<b.z1)){falla(`metido en ${b.que==='casa'?'una casa':'un edificio'}`,ej);break;}
  // dos que se pisan
  for(const j of cubo.get(Math.floor(p.x/CB)+','+Math.floor(p.z/CB))||[]){if(j<=i)continue;const q=P[j];if(Math.min(p.y1,q.y1)-Math.max(p.y0,q.y0)<=.01)continue;if(cruzan(p,q))falla('dos objetos que se pisan',{...ej,con:R[j].modelo,en2:[+R[j].x.toFixed(2),+R[j].z.toFixed(2)]});}
  // cómo apoya
  // (con losa —plano3d—: la base va a la altura de la losa y la losa tiene que llegar al suelo en cada esquina)
  if(PLANO.has(r.modelo)&&!p.disco){for(const [x,z] of p.esq){const g=suelo(x,z,r.y+1),d=r.losa?(g<r.losa.y0?r.losa.y0-g:Math.min(0,r.y-g)):r.y-g;med.apoyo.push(d);if(Math.abs(d)>APOYO){falla(d>0?'una esquina flota (se ve por debajo)':'una esquina se hunde en el suelo',{...ej,mm:Math.round(d*1000)});if(!peor[r.modelo]||Math.abs(d)>Math.abs(peor[r.modelo].d))peor[r.modelo]={d,...ej};}}}});}
// Las aberturas de las casas del monte (2026-10-16, Miguel: «la ventana y la puerta se solapan»): en una misma pared,
// ninguna puerta, ventana o portón pisa a otra, contando 12 cm de marco.
const ab={casas:0,pares:0};for(let s=S0;s<S0+N;s++){const {generateBlueprint}=await import('../src/engine/blueprint.js'),bp=generateBlueprint({seed:s,team:3});
 for(const h of bp.isla.casas||[]){if(!h.spec)continue;ab.casas++;const O=planHouse(h.spec).openings.filter(o=>!o.inner);
  for(let i=0;i<O.length;i++)for(let j=i+1;j<O.length;j++){const a=O[i],b=O[j];if(a.axis!==b.axis||Math.abs(a.at-b.at)>.3)continue;ab.pares++;
   const ov=Math.min(a.c+a.w/2,b.c+b.w/2)-Math.max(a.c-a.w/2,b.c-b.w/2),oy=Math.min(a.y0+a.h,b.y0+b.h)-Math.max(a.y0,b.y0);
   if(ov>-.12&&oy>0)falla('dos aberturas de una casa que se pisan (con su marco)',{semilla:s,casa:h.manzana,a:a.kind,b:b.kind,cm:Math.round((ov+.12)*100)});}}}
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.min(b.length-1,Math.floor(p*b.length))]:NaN;};
console.log(`oclusión · ${N} ciudad(es) · ${ab.casas} casas con sus aberturas · ${med.objetos} objetos (${Object.entries(med.porTipo).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>k+' '+v).join(', ')}…) · ${med.losas} sobre su losa · apoyo de las esquinas: p1 ${(q(med.apoyo,.01)*1000).toFixed(0)}, p99 ${(q(med.apoyo,.99)*1000).toFixed(0)} mm`);
for(const [k,p] of Object.entries(peor))console.log(`  peor apoyo de ${k}: ${Math.round(p.d*1000)} mm en (${p.x}, ${p.z})`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
process.exit(0);
