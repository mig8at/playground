/* Las casas de las manzanas de la montaña (FUGA, 2026-10-11): las del «Simple Buildings Pack» de Quaternius
   (public/models/edificios: cinco casas y cuatro paletas de color de techo) en las mitades de manzana, de frente a su
   calle (plan.isla.casas, del plano), con un jardín de árboles alrededor. Una InstancedMesh por pieza de cada modelo: pocas llamadas de dibujo.
   Adentro: la isla arma en cada una una casa con interior (island3d, casaIdx), un poco más chica que el modelo; con la
   cámara adentro, el modelo de esa casa se oculta (adentro()) y se ve la casa armada.
   El frente de cada modelo mira a +z. */
import * as THREE from 'three';
import {loadIslandBuildings} from './island3d.js';
import {lodInstances} from './lod3d.js';
import {planHouse,houseColor} from '../engine/vivienda.js';

const ESCALA=5;// la del paquete en la isla: una casa queda de 6 a 11 m
// casas: plan.isla.casas. celdas: las casillas de las mitades (para el jardín). rampaEn(cx, cy): casillas con rampa.
export function createCasas(plan,{nature=null,nature2=null,rampaEn=null}={}){
 const group=new THREE.Group(),casas=plan?.isla?.casas||[],own=[];
 // Choques: una caja por casa (girada), y los troncos de los árboles.
 const cajas=casas.map(c=>({x:c.x,z:c.z,cs:Math.cos(c.ry),sn:Math.sin(c.ry),hw:c.w/2,hd:c.d/2,y:c.nivel}));
 const troncos=[],piedras=[],vallas=[],lotes=[];let lodSet=null;
 const enCasa=(x,z,r=0)=>cajas.some(b=>{const dx=x-b.x,dz=z-b.z,lx=dx*b.cs-dz*b.sn,lz=dx*b.sn+dz*b.cs;return Math.abs(lx)<b.hw+r&&Math.abs(lz)<b.hd+r;});
 // El jardín (Naturaleza2, con nivel de detalle: lod3d.js). Árboles: en cada casilla de las mitades, lejos de las casas
 // (3 m) y fuera de las rampas, uno o dos, de 5 a 8 m; de cerca (40 m) los de Naturaleza2 y de lejos los livianos de
 // Naturaleza, en el mismo lugar y del mismo alto. Uno de cada ocho, de otoño. Abajo, arbustos, plantas, rocas con musgo
 // y algún tocón (sólo de cerca: 30 m). Frente a cada casa armada, un cantero de flores a los lados de la puerta y un
 // caminito de piedras hasta la calle.
 const lod=[],h=(x,y,s)=>{let n=Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(s|0,1274126177);n=Math.imul(n^n>>>13,1274126177);return((n^n>>>16)>>>0)/4294967296;};
 const planes=casas.map(c=>c.spec?planHouse(c.spec):null);
 // Los caminitos (para no plantar encima): rectángulos en coordenadas de cada casa.
 const enCamino=(x,z,r=0)=>casas.some((c,i)=>{const P=planes[i];if(!P)return false;const b=cajas[i],dx=x-b.x,dz=z-b.z,lx=dx*b.cs-dz*b.sn,lz=dx*b.sn+dz*b.cs;return Math.abs(lx-P.front.x)<.8+r&&lz>P.d/2-.2&&lz<P.d/2+3;});
 if(nature){
  const LO=[['Tree1',4.1],['Tree2',4.98],['Tree3',4.08],['Tree4',6.85]];
  const HI=[['CommonTree_1',2.48],['CommonTree_2',3.12],['CommonTree_3',3.46],['CommonTree_4',2.78],['CommonTree_5',2.53],['BirchTree_1',3.57],['BirchTree_2',4.03],['BirchTree_3',4.09],['BirchTree_5',5.01]];
  const AUTUMN=[['CommonTree_Autumn_3',3.46],['CommonTree_Autumn_4',2.78],['BirchTree_Autumn_2',4.03]];
  const TINT=['#ffffff','#eef6dc','#f6f0cf','#dfeccb','#fff3d8','#e6f0c4'];
  const SMALL=[['Bush_1',.9],['Bush_2',.9],['BushBerries_1',.8],['BushBerries_2',.8],['Plant_1',1],['Plant_3',.9],['Plant_5',.8],['Rock_Moss_1',1],['Rock_Moss_2',1.1],['Rock_Moss_3',1.2],['Grass_Short',1.4],['Grass_Short',1.6]];
  for(const c of plan?.isla?.cells||[]){if(!c.lote||c.manzana==null||rampaEn?.(c.x,c.y))continue;const y=c.terraza+.05;
   for(let t=0;t<2;t++){if(h(c.x*3+t,c.y*5,41)>.55)continue;const x=(c.x+.15+.7*h(c.y,c.x*7+t,1))*6,z=(c.y+.15+.7*h(c.x*7+t,c.y,2))*6;if(enCasa(x,z,3)||enCamino(x,z,1))continue;
    const alto=5+3*h(z,x,5),aut=h(x,z,9)<.125,[hi,ah]=(aut?AUTUMN:HI)[Math.floor(h(c.x+t,c.y,3)*(aut?AUTUMN:HI).length)],[lo,al]=LO[Math.floor(h(c.x+t,c.y,13)*LO.length)];
    lod.push({hi,lo,x,y,z,ry:h(x,z,4)*6.28,sHi:alto/ah,sLo:alto/al,tint:TINT[Math.floor(h(z,x,6)*TINT.length)]});troncos.push({x,z});}
   // lo de abajo: de 1 a 3 cosas chicas por casilla
   for(let t=0;t<3;t++){if(h(c.x+t*11,c.y,51)>.6)continue;const x=(c.x+.1+.8*h(c.y,c.x+t*5,52))*6,z=(c.y+.1+.8*h(c.x+t*5,c.y,53))*6;if(enCasa(x,z,.8)||enCamino(x,z,.3))continue;
    const [hi,s0]=h(x,z,57)<.04?['TreeStump_Moss',1]:SMALL[Math.floor(h(x,z,54)*SMALL.length)];lod.push({hi,lo:null,near:30,x,y,z,ry:h(z,x,55)*6.28,sHi:s0*(.85+.3*h(x,z,56)),tint:'#ffffff'});}}
  // Canteros y caminitos de las casas armadas.
  const FLOR=[['Flowers',1.3],['Plant_1',.8],['Bush_2',.65],['Flowers',1.1],['Plant_3',.7]];
  casas.forEach((c,i)=>{const P=planes[i];if(!P)return;const cs=Math.cos(c.ry),sn=Math.sin(c.ry),W=(lx,lz)=>({x:c.x+lx*cs+lz*sn,z:c.z-lx*sn+lz*cs}),zb=P.d/2+.45;
   const gar=P.openings.find(o=>o.kind==='garage');
   for(let lx=P.body.x0+.45;lx<=P.body.x1-.45;lx+=.8){if(Math.abs(lx-P.front.x)<1.1||gar&&Math.abs(lx-gar.c)<gar.w/2+.4)continue;const p=W(lx,zb),[hi,s0]=FLOR[Math.floor(h(i*7+Math.round(lx*3),3,61)*FLOR.length)];
    lod.push({hi,lo:null,near:35,x:p.x,y:c.nivel+.05,z:p.z,ry:h(i,Math.round(lx*3),62)*6.28,sHi:s0,tint:'#ffffff'});}
   for(let k=0,lz=P.d/2+.3;lz<P.d/2+2.6;lz+=.62,k++){const p=W(P.front.x+(h(i,k,63)-.5)*.25,lz);piedras.push({x:p.x,y:c.nivel+.08,z:p.z,ry:c.ry+h(k,i,64)*.6});}});
  lodSet=lodInstances(group,{hi:nature2||{},lo:nature},lod.map(it=>nature2?it:{...it,hi:it.lo,sHi:it.sLo,lo:null}),{near:40});}
 // Cercas bajas de madera, buzones y entradas de autos de las casas armadas: cajas en UNA InstancedMesh (con su color).
 // Por mitad de manzana, las casas en orden a lo largo de la calle; cada lote mide su casa más 1,5 m a cada lado. La
 // cerca del frente va a 2 m de la casa (0,5 m antes de la calle), con un paso frente a la puerta y otro frente al
 // garaje; cada casa pone la cerca de su izquierda, y la última también la de su derecha. Postes cada 1,6 m (0,9 m de
 // alto) y dos travesaños. El buzón, a la derecha del paso. No estorban al caminar (son bajas, de adorno).
 const piezas=[],postes=new Set();
 if(casas.some(c=>c.spec)){const mitades=new Map();casas.forEach((c,i)=>{if(!planes[i])return;const k=c.manzana+'|'+c.frente;(mitades.get(k)||mitades.set(k,[]).get(k)).push(i);});
  for(const idx of mitades.values()){idx.sort((a,b)=>{const A=casas[a],B=casas[b];return (A.x*Math.cos(A.ry)-A.z*Math.sin(A.ry))-(B.x*Math.cos(B.ry)-B.z*Math.sin(B.ry));});
   idx.forEach((i,n)=>{const c=casas[i],P=planes[i],cs=Math.cos(c.ry),sn=Math.sin(c.ry),y0=c.nivel+.05,L=c.w/2+1.5,zf=P.d/2+2,back=-P.d/2;
    const col=houseColor('marco',P.spec.marco),wood=col.toLowerCase()==='#f5f0e6'?'#f2ede2':col;
    const at=(lx,lz)=>({x:c.x+lx*cs+lz*sn,z:c.z-lx*sn+lz*cs});
    // una caja en coordenadas de la casa (centro lx, ly, lz; medidas sx a lo largo de x de la casa, sz a lo largo de z)
    const pc=(lx,ly,lz,sx,sy,sz,color)=>{const p=at(lx,lz);piezas.push({x:p.x,y:y0+ly,z:p.z,ry:c.ry,sx,sy,sz,color});};
    const run=(ax,a0,a1,fix)=>{const len=a1-a0;if(len<.3)return;const n2=Math.max(1,Math.ceil(len/1.6));
     {const p=ax==='x'?at(a0,fix):at(fix,a0),q=ax==='x'?at(a1,fix):at(fix,a1);vallas.push({ax:p.x,az:p.z,bx:q.x,bz:q.z});}
     // (un poste por lugar: donde se juntan dos tramos —el de una casa y el de su vecina— va uno solo; 2026-10-16, medido
     // sin pantalla —validar-triangulos—: 162 postes dobles en la ciudad 1, cajas iguales que titilaban)
     for(let k=0;k<=n2;k++){const a=a0+len*k/n2,p=ax==='x'?at(a,fix):at(fix,a),kk=p.x.toFixed(2)+','+(y0+.45).toFixed(2)+','+p.z.toFixed(2);if(postes.has(kk))continue;postes.add(kk);ax==='x'?pc(a,.45,fix,.1,.9,.1,wood):pc(fix,.45,a,.1,.9,.1,wood);}
     for(const yy of [.35,.72])ax==='x'?pc((a0+a1)/2,yy,fix,len,.07,.045,wood):pc(fix,yy,(a0+a1)/2,.045,.07,len,wood);};
    // el frente, con sus pasos
    const g=P.openings.find(o=>o.kind==='garage'),gaps=[[P.front.x-.7,P.front.x+.7],...(g?[[g.c-g.w/2-.35,g.c+g.w/2+.35]]:[])].sort((p,q)=>p[0]-q[0]);
    let a=-L;for(const [g0,g1] of gaps){run('x',a,Math.max(a,g0),zf);a=Math.max(a,g1);}run('x',a,L,zf);
    run('z',back,zf,-L);if(n===idx.length-1)run('z',back,zf,L);
    // el lote (para pasar por la puerta de la cerca): adentro, de la espalda de la casa a la cerca del frente
    const pin=at(P.front.x,zf-.9),pout=at(P.front.x,zf+.9);lotes.push({x:c.x,z:c.z,cs,sn,L,zf,back,pin,pout,front:P.d/2,door:P.front.x,at,y:c.nivel});
    // el buzón: poste, caja del color de la puerta y su banderita
    const bx=P.front.x+1.15,bz=zf+.3,pd=houseColor('puerta',P.spec.puertaColor);pc(bx,.5,bz,.08,1,.08,'#5e4a3a');pc(bx,1.08,bz,.24,.22,.42,pd);pc(bx+.13,1.2,bz+.08,.02,.16,.08,'#c8402e');
    // la entrada de autos: del portón a la calle
    if(g){const z0=g.at+.12,z1=P.d/2+2.5;pc(g.c,.015,(z0+z1)/2,g.w+.5,.05,z1-z0,'#a9a397');}});}}
 if(piezas.length){const g=new THREE.BoxGeometry(1,1,1),m=new THREE.MeshStandardMaterial({roughness:.85,flatShading:true}),im=new THREE.InstancedMesh(g,m,piezas.length),o=new THREE.Object3D(),cc=new THREE.Color();
  piezas.forEach((p,i)=>{o.position.set(p.x,p.y,p.z);o.rotation.set(0,p.ry,0);o.scale.set(p.sx,p.sy,p.sz);o.updateMatrix();im.setMatrixAt(i,o.matrix);im.setColorAt(i,cc.set(p.color));});
  im.castShadow=true;im.receiveShadow=true;group.add(im);own.push(g,m);}
 // Las piedras del caminito: un cilindro bajo de 7 lados, en instancias.
 if(piedras.length){const g=new THREE.CylinderGeometry(.32,.36,.06,7),m=new THREE.MeshStandardMaterial({color:'#a59c8e',roughness:.95,flatShading:true}),im=new THREE.InstancedMesh(g,m,piedras.length),o=new THREE.Object3D();
  piedras.forEach((p,i)=>{o.position.set(p.x,p.y,p.z);o.rotation.set(0,p.ry,0);o.scale.set(1,1,.85);o.updateMatrix();im.setMatrixAt(i,o.matrix);});im.receiveShadow=true;group.add(im);own.push(g,m);}
 // Las casas, cuando están los modelos (los del «Simple Buildings Pack», que ya carga la isla: loadIslandBuildings).
 // Una InstancedMesh por pieza de cada modelo y paleta.
 const mats=new Map(),matDe=(tex,T)=>{if(!mats.has(tex)){const m=new THREE.MeshStandardMaterial({map:T,roughness:.85});mats.set(tex,m);own.push(m);}return mats.get(tex);};
 loadIslandBuildings().then(B=>{if(!B)return;const q=new THREE.Quaternion(),Y=new THREE.Vector3(0,1,0),esc=new THREE.Vector3(ESCALA,ESCALA,ESCALA);
  const grupos=new Map();casas.forEach((c,i)=>{const k=c.modelo+'|'+c.paleta;(grupos.get(k)||grupos.set(k,[]).get(k)).push(i);});
  for(const [k,idx] of grupos){const [n,tex]=k.split('|'),obj=B.models[n],T=B.textures[tex];if(!obj||!T)continue;
   const b=new THREE.Box3().setFromObject(obj),centro=new THREE.Matrix4().makeTranslation(-(b.min.x+b.max.x)/2,-b.min.y,-(b.min.z+b.max.z)/2);
   const ms=idx.map(i=>{const c=casas[i];return new THREE.Matrix4().compose(new THREE.Vector3(c.x,c.nivel+.05,c.z),q.setFromAxisAngle(Y,c.ry),esc).multiply(centro);});
   const piezas=[];obj.traverse(o=>{if(o.isMesh)piezas.push(o);});
   const ims=piezas.map(p=>{const im=new THREE.InstancedMesh(p.geometry,matDe(tex,T),idx.length);ms.forEach((m,j)=>im.setMatrixAt(j,m));im.castShadow=true;im.receiveShadow=true;im.computeBoundingSphere();group.add(im);return im;});
   idx.forEach((i,j)=>{instancia[i]={ims,i:j,m:ms[j]};});}});
 // La casa con alguien adentro: su modelo (la cáscara de afuera) se oculta y se ve la casa armada de la isla.
 const instancia=[],cero=new THREE.Matrix4().makeScale(0,0,0);let oculta=null;
 const ver=(idx,si)=>{const I=instancia[idx];if(!I)return;for(const im of I.ims){im.setMatrixAt(I.i,si?I.m:cero);im.instanceMatrix.needsUpdate=true;}};
 // Troncos y cercas por casillas de 8 m (las consultas son muchas: la gente de la isla las usa para buscar caminos).
 const CK=8,grid=new Map(),cel=(i,j)=>i+','+j,add=(o,x0,z0,x1,z1)=>{for(let i=Math.floor(x0/CK);i<=Math.floor(x1/CK);i++)for(let j=Math.floor(z0/CK);j<=Math.floor(z1/CK);j++){const k=cel(i,j);(grid.get(k)||grid.set(k,[]).get(k)).push(o);}};
 for(const t of troncos)add({t},t.x-1,t.z-1,t.x+1,t.z+1);
 for(const v of vallas)add({v},Math.min(v.ax,v.bx)-1,Math.min(v.az,v.bz)-1,Math.max(v.ax,v.bx)+1,Math.max(v.az,v.bz)+1);
 const segD2=(v,x,z)=>{const dx=v.bx-v.ax,dz=v.bz-v.az,l2=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-v.ax)*dx+(z-v.az)*dz)/l2)),px=v.ax+dx*t-x,pz=v.az+dz*t-z;return px*px+pz*pz;};
 function collide(x,z,r=.3){const L=grid.get(cel(Math.floor(x/CK),Math.floor(z/CK)));if(!L)return false;
  for(const o of L){if(o.t){if((o.t.x-x)**2+(o.t.z-z)**2<(r+.35)**2)return true;}else if(segD2(o.v,x,z)<(r+.06)**2)return true;}return false;}
 const loteDe=(x,z)=>{for(const l of lotes){const dx=x-l.x,dz=z-l.z,lx=dx*l.cs-dz*l.sn,lz=dx*l.sn+dz*l.cs;if(Math.abs(lx)<l.L&&lz>l.back&&lz<l.zf)return l;}return null;};
 return {group,count:casas.length,
  // El detalle del jardín según dónde está la cámara.
  update(cx,cz,lejos=Infinity){lodSet?.update(cx,cz,false,lejos);},get lod(){return lodSet;},
  // Lo que estorba al caminar: los troncos y las cercas (las paredes de las casas son de vivienda3d.js o de la isla).
  collide,
  // Por dónde entrar o salir de un lote: si from y to no están en el mismo lote, los puntos de afuera y de adentro del
  // paso de la puerta de la cerca que hay que cruzar (en orden), o null.
  // Un punto libre en el patio de adelante de un lote a menos de `lejos` m de p (para que los vecinos visiten
  // jardines): entre los canteros y la cerca, fuera del caminito. r: el azar a usar.
  jardin(r,p,lejos=140){const cerca=lotes.filter(l=>Math.hypot(l.x-p.x,l.z-p.z)<lejos);
   for(let k=0;k<10&&cerca.length;k++){const l=cerca[Math.floor(r()*cerca.length)],lx=-l.L+.8+r()*(2*l.L-1.6),lz=l.front+.95+r()*Math.max(.1,l.zf-l.front-1.55);
    if(Math.abs(lx-l.door)<.9)continue;const q=l.at(lx,lz);if(!collide(q.x,q.z,.4))return {x:q.x,z:q.z};}return null;},
  portal(from,to){const A=loteDe(from.x,from.z),B=loteDe(to.x,to.z);if(A===B)return null;const out=[];if(A)out.push(A.pin,A.pout);if(B)out.push(B.pout,B.pin);return out;},
  // idx: la casa con la cámara adentro (island.casaDentro), o null.
  adentro(idx){if(idx===oculta)return;if(oculta!=null)ver(oculta,true);oculta=idx;if(idx!=null)ver(idx,false);},
  dispose(){for(const o of own)o.dispose?.();}};
}
