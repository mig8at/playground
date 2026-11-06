// Medir el 3D sin pantalla (2026-10-16): los triángulos de un grupo de three.js —también los de cada instancia de una
// InstancedMesh y de una BatchedMesh— en una grilla de casillas de LADO m (en planta), para preguntar rápido qué se ve
// desde arriba en un punto: la cara más alta que lo cubre, con su altura y de qué malla es. Un rayo de three.js contra
// el mundo entero prueba todos sus triángulos; esto, sólo los de la casilla del punto.
// Opciones: saltar(malla) para dejar mallas afuera; arriba: sólo las caras que miran hacia arriba (normal y > .5) —los
// pisos: así el índice de la ciudad entera entra en memoria—; dentro(x, z) para quedarse con una zona.
import * as THREE from 'three';

export function indiceTriangulos(group,{LADO=4,saltar=()=>false,arriba:soloArriba=false,dentro=null}={}){
 let T=new Float32Array(1<<20),nT=0;const nombres=[],celdas=new Map(),v=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()],M=new THREE.Matrix4(),I=new THREE.Matrix4();
 const push=(...xs)=>{if(nT+xs.length>T.length){const U=new Float32Array(T.length*2);U.set(T);T=U;}for(const x of xs)T[nT++]=x;};
 group.updateMatrixWorld(true);
 const agrega=(geo,mat,nombre,desde=0,cuantos=null)=>{const p=geo.attributes.position,ix=geo.index,n=cuantos??(ix?ix.count:p.count),id=nombres.push(nombre)-1;
  for(let i=desde;i<desde+n;i+=3){for(let k=0;k<3;k++){v[k].fromBufferAttribute(p,ix?ix.getX(i+k):i+k).applyMatrix4(mat);}
   // (las caras verticales no cubren nada en planta)
   const a=v[0],b=v[1],c=v[2],area=(b.x-a.x)*(c.z-a.z)-(c.x-a.x)*(b.z-a.z);if(Math.abs(area)<1e-8)continue;
   if(soloArriba){const ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z,nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.hypot(nx,ny,nz)||1;if(Math.abs(ny/l)<.5)continue;}
   if(dentro&&!dentro((a.x+b.x+c.x)/3,(a.z+b.z+c.z)/3))continue;
   const t=nT;push(a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z,id);
   const x0=Math.floor(Math.min(a.x,b.x,c.x)/LADO),x1=Math.floor(Math.max(a.x,b.x,c.x)/LADO),z0=Math.floor(Math.min(a.z,b.z,c.z)/LADO),z1=Math.floor(Math.max(a.z,b.z,c.z)/LADO);
   for(let gx=x0;gx<=x1;gx++)for(let gz=z0;gz<=z1;gz++){const kk=gx+','+gz;(celdas.get(kk)||celdas.set(kk,[]).get(kk)).push(t);}}};
 group.traverse(o=>{if(!o.isMesh||!o.visible||saltar(o))return;const nombre=o.name||o.material?.name||o.geometry?.type||'malla';
  if(o.isBatchedMesh){for(let i=0;i<o.instanceCount;i++){try{if(!o.getVisibleAt(i))continue;}catch{continue;}o.getMatrixAt(i,I);M.multiplyMatrices(o.matrixWorld,I);const r=o.getGeometryRangeAt(o.getGeometryIdAt(i));agrega(o.geometry,M,nombre+'·lote',r.start,r.count);}}
  else if(o.isInstancedMesh){for(let i=0;i<o.count;i++){o.getMatrixAt(i,I);M.multiplyMatrices(o.matrixWorld,I);agrega(o.geometry,M,nombre+'·inst');}}
  else agrega(o.geometry,o.matrixWorld,nombre);});
 // lo que se ve desde arriba en (x, z): la cara más alta (y, de qué malla); y todas las alturas, si se piden
 // (sin: el número de una malla —de nombres— que no cuenta, para preguntar qué tapa a una cara sin contarla a ella)
 const arriba=(x,z,todas=false,sin=-1)=>{const L=celdas.get(Math.floor(x/LADO)+','+Math.floor(z/LADO));let best=-Infinity,de=null;const hs=todas?[]:null;
  if(L)for(const t of L){if(T[t+9]===sin)continue;const ax=T[t],ay=T[t+1],az=T[t+2],bx=T[t+3],by=T[t+4],bz=T[t+5],cx=T[t+6],cy=T[t+7],cz=T[t+8],d=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(d)<1e-12)continue;
   const w1=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/d,w2=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/d,w3=1-w1-w2;if(w1<-1e-6||w2<-1e-6||w3<-1e-6)continue;
   const y=w1*ay+w2*by+w3*cy;if(hs)hs.push(y);if(y>best){best=y;de=nombres[T[t+9]];}}
  return {y:best,de,...(hs?{todas:hs}:{})};};
 return {arriba,triangulos:nT/10,nombres,T};}
