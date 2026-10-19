// Nivel 6 del probador (2026-10-16, Miguel: «las mediciones exactas, que empaten milimétricamente»): los empalmes entre
// piezas vecinas, sin pantalla (sin-pantalla.mjs armarMundo). A lo largo de cada borde donde se tocan dos piezas —en la
// ciudad, las casillas de distinto tipo y el cordón de la vereda (cuadros de 1 m); en el monte, cada casilla de lote contra
// lo de al lado—, cada medio metro:
//  · rendija de arriba: a 1 cm de cada lado del borde, el piso que se ve tiene que estar donde se pisa (la física, ≤ TOL):
//    si se ve más abajo, entre las dos piezas queda una rendija por la que se ve lo de abajo;
//  · rendija parada: si los dos lados están a distinta altura, las caras paradas dibujadas en el borde (a ≤ 2 cm) tienen que
//    cubrir todo el escalón (a lo sumo medio tabique más 1 cm del borde); lo que queda sin cubrir es una rendija por la que pasa la luz (contra el terreno natural no:
//    sube en rampa).
// Da la peor de cada tipo, en milímetros y dónde.
// Uso: node scripts/validar-empalmes.mjs [ciudades=1] [semilla0=1]
import {armarMundo} from './sin-pantalla.mjs';
import {indiceTriangulos} from './medir3d.mjs';
import {CELL} from '../src/engine/veredas.js';
import * as THREE from 'three';
import {MURO} from '../src/engine/medidas.js';

// (PARED: hasta dónde se busca la cara que cubre el escalón —medio tabique más 1 cm: un tabique va centrado en la línea—)
const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||1),S0=+(A[1]||1),TOL=.02,PARED=MURO.tabique/2+.01;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
// Las caras paradas, en planta: cada una es un segmento con su alto a lo largo; una grilla de 4 m para buscarlas.
function indiceParadas(group,dentro){const L=[],celdas=new Map(),v=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()],M=new THREE.Matrix4(),I=new THREE.Matrix4(),e1=new THREE.Vector3(),e2=new THREE.Vector3();
 group.updateMatrixWorld(true);
 const agrega=(geo,mat,desde=0,cuantos=null)=>{const p=geo.attributes.position,ix=geo.index,n=cuantos??(ix?ix.count:p.count);
  for(let i=desde;i<desde+n;i+=3){for(let k=0;k<3;k++)v[k].fromBufferAttribute(p,ix?ix.getX(i+k):i+k).applyMatrix4(mat);
   e1.subVectors(v[1],v[0]);e2.subVectors(v[2],v[0]);const nn=e1.clone().cross(e2),l=nn.length();if(l<1e-9||Math.abs(nn.y/l)>.3)continue;
   const cx=(v[0].x+v[1].x+v[2].x)/3,cz=(v[0].z+v[1].z+v[2].z)/3;if(dentro&&!dentro(cx,cz))continue;
   // el eje de la cara en planta (la dirección horizontal dentro de su plano) y sus vértices en (u a lo largo, y)
   const ux=-nn.z,uz=nn.x,ul=Math.hypot(ux,uz)||1,dx=ux/ul,dz=uz/ul,ox=v[0].x,oz=v[0].z,P=v.map(q=>[(q.x-ox)*dx+(q.z-oz)*dz,q.y]);
   const t={ox,oz,dx,dz,P},u0=Math.min(...P.map(q=>q[0])),u1=Math.max(...P.map(q=>q[0]));L.push(t);
   const xs=[ox+dx*u0,ox+dx*u1],zs=[oz+dz*u0,oz+dz*u1];for(let gx=Math.floor((Math.min(...xs)-.05)/4);gx<=Math.floor((Math.max(...xs)+.05)/4);gx++)for(let gz=Math.floor((Math.min(...zs)-.05)/4);gz<=Math.floor((Math.max(...zs)+.05)/4);gz++){const k=gx+','+gz;(celdas.get(k)||celdas.set(k,[]).get(k)).push(t);}}};
 group.traverse(o=>{if(!o.isMesh||!o.visible)return;if(o.isBatchedMesh){for(let i=0;i<o.instanceCount;i++){try{if(!o.getVisibleAt(i))continue;}catch{continue;}o.getMatrixAt(i,I);M.multiplyMatrices(o.matrixWorld,I);const r=o.getGeometryRangeAt(o.getGeometryIdAt(i));agrega(o.geometry,M,r.start,r.count);}}
  else if(o.isInstancedMesh){for(let i=0;i<o.count;i++){o.getMatrixAt(i,I);M.multiplyMatrices(o.matrixWorld,I);if(Math.abs(M.determinant())<1e-9)continue;agrega(o.geometry,M);}}else agrega(o.geometry,o.matrixWorld);});
 // los tramos de y que cubren las caras paradas que pasan a ≤ PARED del punto
 const cubre=(x,z,lejos=PARED)=>{const out=[];for(const t of celdas.get(Math.floor(x/4)+','+Math.floor(z/4))||[]){const u=(x-t.ox)*t.dx+(z-t.oz)*t.dz,w=Math.abs(-(x-t.ox)*t.dz+(z-t.oz)*t.dx);if(w>lejos)continue;
  // el corte del triángulo (en u, y) con la recta u: un tramo [y0, y1]
  let lo=Infinity,hi=-Infinity;for(let k=0;k<3;k++){const a=t.P[k],b=t.P[(k+1)%3];if((a[0]-u)*(b[0]-u)>0)continue;if(Math.abs(b[0]-a[0])<1e-9){lo=Math.min(lo,a[1],b[1]);hi=Math.max(hi,a[1],b[1]);continue;}const y=a[1]+(b[1]-a[1])*(u-a[0])/(b[0]-a[0]);lo=Math.min(lo,y);hi=Math.max(hi,y);}
  if(hi>lo)out.push([lo,hi,+w.toFixed(3)]);}return out;};
 return {cubre,caras:L.length};}
const sinCubrir=(tramos,y0,y1)=>{const T=tramos.filter(t=>t[1]>y0&&t[0]<y1).sort((a,b)=>a[0]-b[0]);let y=y0,peor=0;for(const [a,b] of T){if(a>y)peor=Math.max(peor,a-y);y=Math.max(y,b);if(y>=y1)break;}if(y<y1)peor=Math.max(peor,y1-y);return peor;};
const med={bordes:0,puntos:0,arriba:[],parada:[]},peor={};
for(let s=S0;s<S0+N;s++){const M=await armarMundo(s),{bp,world,suelo,isla}=M,{W,H}=bp.map;
 // lo que tapa: todo menos el plano (bancas, árboles: lo de arriba no cuenta como piso) y la gente
 const C0=new Map(bp.isla.cells.map(c=>[c.x+','+c.y,c]));
 const pisos=indiceTriangulos(M.grupo,{arriba:true,saltar:o=>o===M.plano.group||o.parent===M.plano.group}),paradas=indiceParadas(M.grupo);
 if(process.env.VER_PUNTO){const [x,z]=JSON.parse(process.env.VER_PUNTO);console.log('caras paradas a ≤ 40 cm de',x,z,JSON.stringify(paradas.cubre(x,z,.4).map(t=>t.map(v=>+v.toFixed(3)))),'física',[-.05,-.01,.01,.05].map(o=>suelo(x+o,z,0).toFixed(3)).join(' '));process.exit(0);}
 const mira=(x,z,nx,nz,donde)=>{med.puntos++;const ga=suelo(x-nx*.01,z-nz*.01,0),gb=suelo(x+nx*.01,z+nz*.01,0),ej={semilla:s,donde,x:+x.toFixed(2),z:+z.toFixed(2)};
  for(const [g,sx] of [[ga,-1],[gb,1]]){const px=x+sx*nx*.01,pz=z+sx*nz*.01,v=pisos.arriba(px,pz).y,d=v-g;med.arriba.push(d);if(d<-TOL){falla(`${donde}: rendija de arriba (se ve más abajo que donde se pisa)`,{...ej,mm:Math.round(d*1000)});if(!peor.arriba||d<peor.arriba.d)peor.arriba={d,...ej};}}
  // (contra el terreno natural no: el terreno sube en rampa y tapa la vista aunque no sea una cara parada)
  const natural=(px,pz)=>{if(px>=0&&pz>=0&&px<W*CELL&&pz<H*CELL)return false;const c=C0.get(Math.floor(px/CELL)+','+Math.floor(pz/CELL));return !c||(!c.lote&&!c.carretera&&c.terraza==null);};
  // (ni adentro de una pared: si la física frena a los dos lados del borde, ahí no se puede estar y la rendija no se ve)
  const enPared=(px,pz)=>px>=0&&pz>=0&&px<W*CELL&&pz<H*CELL&&world.collide(px,pz,.03,false,Math.max(ga,gb));
  const lo=Math.min(ga,gb),hi=Math.max(ga,gb);if(hi-lo>TOL&&!natural(x-nx*.3,z-nz*.3)&&!natural(x+nx*.3,z+nz*.3)&&!(enPared(x-nx*.01,z-nz*.01)&&enPared(x+nx*.01,z+nz*.01))){const g=sinCubrir(paradas.cubre(x,z),lo+.005,hi-.005);med.parada.push(g);if(g>TOL){const lado=(px,pz)=>{if(px>=0&&pz>=0&&px<W*CELL&&pz<H*CELL){const k=bp.map.kind[Math.floor(pz/CELL)*W+Math.floor(px/CELL)];return 'k'+k;}const c=C0.get(Math.floor(px/CELL)+','+Math.floor(pz/CELL));return c?(c.lote?'lote':c.carretera?'calle':c.zona):'?';};const par=[lado(x-nx*.3,z-nz*.3),lado(x+nx*.3,z+nz*.3)].sort().join('/');med.pares=med.pares||{};const pk=donde+' '+par;med.pares[pk]=(med.pares[pk]||0)+1;falla(`${donde}: rendija parada (el escalón no lo cubre una cara)`,{...ej,entre:par,escalon:+(hi-lo).toFixed(3),mm:Math.round(g*1000)});if(!peor.parada||g>peor.parada.d)peor.parada={d:g,...ej};}}};
 // la ciudad: cada borde entre casillas de distinto tipo, y el cordón (cuadros de 1 m)
 for(let cy=0;cy<H;cy++)for(let cx=0;cx<W;cx++){const k=bp.map.kind[cy*W+cx];for(const [dx,dy] of [[1,0],[0,1]]){const nx=cx+dx,ny=cy+dy;if(nx>=W||ny>=H)continue;const k2=bp.map.kind[ny*W+nx];if(k===k2)continue;med.bordes++;
  for(let t=.25;t<CELL;t+=.5){const x=dx?(cx+1)*CELL:cx*CELL+t,z=dy?(cy+1)*CELL:cy*CELL+t;mira(x,z,dx,dy,'ciudad');}}}
 // el cordón: adentro de las casillas abiertas, cada línea de 1 m donde la física cambia de alto (vereda contra calzada)
 for(let cy=0;cy<H;cy++)for(let cx=0;cx<W;cx++){const k=bp.map.kind[cy*W+cx];if(![0,1,2,3,13].includes(k))continue;
  for(let i=1;i<CELL;i++)for(let t=.25;t<CELL;t+=.5){for(const [x,z,nx,nz] of [[cx*CELL+i,cy*CELL+t,1,0],[cx*CELL+t,cy*CELL+i,0,1]]){if(Math.abs(suelo(x-nx*.01,z-nz*.01,0)-suelo(x+nx*.01,z+nz*.01,0))>TOL){med.cordon=(med.cordon||0)+1;mira(x,z,nx,nz,'cordón');}}}}
 // el monte: cada casilla de lote contra lo de al lado
 const C=new Map(bp.isla.cells.map(c=>[c.x+','+c.y,c]));
 for(const c of bp.isla.cells){if(!c.lote||c.manzana==='mirador')continue;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const n=C.get((c.x+dx)+','+(c.y+dy));if(n?.lote&&n.terraza===c.terraza)continue;med.bordes++;
  for(let t=.25;t<CELL;t+=.5){const x=dx?(c.x+(dx>0?1:0))*CELL:c.x*CELL+t,z=dy?(c.y+(dy>0?1:0))*CELL:c.y*CELL+t;mira(x,z,dx,dy,'monte');}}}}
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.min(b.length-1,Math.floor(p*b.length))]:NaN;};
console.log(`empalmes · ${N} ciudad(es) · ${med.bordes} bordes y ${med.cordon||0} puntos de cordón, ${med.puntos} puntos · rendija de arriba: p1 ${(q(med.arriba,.01)*1000).toFixed(0)}, mín ${(q(med.arriba,0)*1000).toFixed(0)} mm · escalones ${med.parada.length}: sin cubrir p99 ${(q(med.parada,.99)*1000).toFixed(0)}, máx ${(q(med.parada,1)*1000).toFixed(0)} mm`);
if(med.pares)console.log('  por par:',JSON.stringify(med.pares));
for(const [k,p] of Object.entries(peor))console.log(`  la peor ${k}: ${Math.round(p.d*1000)} mm en (${p.x}, ${p.z}) · ${p.donde}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
process.exit(0);
