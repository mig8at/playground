/* El 3D de lo que el plano calcula y el motor no (2026-10-16): la vegetación y el equipamiento (bp.vegetacion,
   bp.equipamiento), dibujados tal como los pide el contrato (src/engine/contrato3d.js). Nada se decide acá: cada
   entrada del contrato se dibuja en su x, z, con su giro y su medida; la altura, la del suelo del 3D (suelo(x, z)).
   ubicar() es lo que hace cada modelo —su escala, su tronco y su posición, a partir del modelo— y no dibuja: el
   validador del probador lo corre en node con los OBJ, y dibujarPlano lo usa tal cual. Lo que se dibuja
   queda anotado (registro: la medida real de cada cosa ya escalada) para revisarlo en el navegador. */
import * as THREE from 'three';
import {contrato,PLACA} from '../engine/contrato3d.js';
import {colisiones,indiceColisiones,distForma} from '../engine/colisiones.js';
import {OBJETOS,placeParts,partsMesh} from './objetos3d.js';
import {plantInstances,plantBatched} from './nature3d.js';
import {dibujarPintura} from './pintura3d.js';
const PLANA=new Set(['banca','papelera','kiosco','parada','salvavidas','hidrante']);

// Las piezas de un objeto del catálogo a su medida (o). Si el contrato pide un alto (el farol), escaladas parejo; si
// pide ancho o fondo (la planta del plano: la banca, la cebra, el kiosco…), llevadas a esa planta en x y en z (el
// objeto se arma a su manera y después ocupa exactamente lo que el plano le dio).
export function piezasDe(e){const O=OBJETOS[e.modelo];if(!O)return null;const o={w:O.medida[0],d:O.medida[1],...(e.o||{})};let ps=O.piezas(o);
 const a0=O.alto(o);if(e.alto&&a0>0){const k=e.alto/a0;ps=ps.map(q=>({...q,x:q.x*k,y:q.y*k,z:q.z*k,sx:q.sx*k,sy:q.sy*k,sz:q.sz*k}));}
 if(e.o?.w!=null||e.o?.d!=null){const m=medidaPiezas(ps),kx=e.o.w!=null?e.o.w/m.ancho:1,kz=e.o.d!=null?e.o.d/m.fondo:1,mx=(m.x0+m.x1)/2,mz=(m.z0+m.z1)/2;
  ps=ps.map(q=>({...q,x:(q.x-mx)*kx,z:(q.z-mz)*kz,sx:q.sx*kx,sz:q.sz*kz}));}
 return ps;}
// La medida de unas piezas en su marco: ancho (x), fondo (z), alto (hasta arriba).
const medidaPiezas=ps=>{let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity,y1=0;for(const q of ps){x0=Math.min(x0,q.x-q.sx/2);x1=Math.max(x1,q.x+q.sx/2);z0=Math.min(z0,q.z-q.sz/2);z1=Math.max(z1,q.z+q.sz/2);y1=Math.max(y1,q.y+q.sy);}return {ancho:x1-x0,fondo:z1-z0,alto:y1,x0,x1,z0,z1};};

// ---- El tronco de un modelo (las partes de madera: Wood, Trunk, Bark) ----
// Los vértices de la madera de un modelo {parts:[{geometry, materials}]}: los de los grupos cuyo material es madera.
const MADERA=/wood|trunk|bark|^white(\.\d+)?$|^black(\.\d+)?$/i;// (los abedules: corteza blanca con rayas negras)
function verticesMadera(M){const out=[];for(const p of M.parts){const mats=Array.isArray(p.materials)?p.materials:[p.materials],pos=p.geometry.attributes.position,g=p.geometry.groups?.length?p.geometry.groups:[{start:0,count:pos.count,materialIndex:0}];
  const idx=p.geometry.index;for(const q of g){if(!MADERA.test(mats[q.materialIndex??0]?.name||''))continue;for(let k=q.start;k<q.start+q.count;k++){const v=idx?idx.getX(k):k;out.push([pos.getX(v),pos.getY(v),pos.getZ(v),p,v]);}}}return out;}
// El tronco: su ancho (el mayor de x y z) y su centro, medidos en una franja a TRONCO_EN de la altura entre la base y
// donde abren las ramas (la primera franja que mide más de RAMAS veces el tronco). Null si el modelo no tiene madera.
const TRONCO_EN=.12,RAMAS=2.5;
// (ref: medir en la misma franja que otro —el modelo sin afinar—: afinado, las ramas «abren» antes)
export function troncoModelo(M,ref=null){const V=verticesMadera(M);if(V.length<3)return null;let y0=Infinity,y1=-Infinity;for(const v of V){y0=Math.min(y0,v[1]);y1=Math.max(y1,v[1]);}
 const franja=(a,b)=>{let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity,n=0;for(const v of V)if(v[1]>=a&&v[1]<=b){n++;x0=Math.min(x0,v[0]);x1=Math.max(x1,v[0]);z0=Math.min(z0,v[2]);z1=Math.max(z1,v[2]);}return n?{w:Math.max(x1-x0,z1-z0),cx:(x0+x1)/2,cz:(z0+z1)/2}:null;};
 const H=y1-y0,base=franja(y0,y0+.06*H)||franja(y0,y0+.2*H);if(!base)return null;let yb=y0+.6*H;
 if(ref)yb=ref.yb;else for(let t=.1;t<.9;t+=.04){const f=franja(y0+t*H,y0+(t+.04)*H);if(f&&f.w>RAMAS*base.w){yb=y0+t*H;break;}}
 // (un tronco que es un prisma recto no tiene vértices en el medio: ahí se mide en la base)
 const m0=franja(y0+TRONCO_EN*(yb-y0)-.03*H,y0+TRONCO_EN*(yb-y0)+.03*H),m=m0&&m0.w>=.5*base.w?m0:base;return {w:m.w,cx:base.cx,cz:base.cz,y0,yb};}
// El modelo con el tronco afinado (o engrosado) por f, sólo hasta donde abren las ramas (y empalmando en el último
// cuarto): la copa y las ramas quedan como estaban. Uno por modelo y f (guardado).
const AFINADOS=new WeakMap();
export function afinado(M,f){if(Math.abs(f-1)<.01)return M;let c=AFINADOS.get(M);if(!c)AFINADOS.set(M,c=new Map());const k=f.toFixed(3);if(c.has(k))return c.get(k);
 const T=troncoModelo(M);if(!T)return M;const parts=M.parts.map(p=>({...p,geometry:p.geometry.clone()})),por=new Map(M.parts.map((p,i)=>[p,parts[i]])),hecho=new Set();
 for(const [x,y,z,p,v] of verticesMadera(M)){const P=por.get(p),key=P.geometry.uuid+':'+v;if(hecho.has(key))continue;hecho.add(key);
  const a=T.y0+.75*(T.yb-T.y0),k=y<=a?f:y>=T.yb?1:f+(1-f)*(y-a)/(T.yb-a),pos=P.geometry.attributes.position;pos.setX(v,T.cx+(x-T.cx)*k);pos.setZ(v,T.cz+(z-T.cz)*k);}
 for(const P of parts){P.geometry.attributes.position.needsUpdate=true;P.geometry.computeBoundingSphere();}
 const out={...M,parts};c.set(k,out);return out;}

// Dónde y a qué escala va el modelo de una entrada: modelos[nombre] = {parts, box} (el modelo cargado). Un árbol o una
// palmera: la copa (el diámetro mayor de la caja) a e.copa, el alto a e.alto y el tronco a e.tronco (afinando sólo el
// tronco), con el TRONCO sobre x, z (el punto del plano es el alcorque) y la base en el suelo. Devuelve {M (el modelo a
// dibujar), sx, sy, px, pz, py0, ancho, alto, tronco, tx, tz (dónde quedó el tronco)}.
export function ubicar(e,modelos){
 if(e.kit==='objeto'){const ps=piezasDe(e);if(!ps)return null;return {piezas:ps,...medidaPiezas(ps)};}
 if(e.kit==='placa')return {placa:true,ancho:e.o.w,fondo:e.o.d,alto:PLACA.alto};
 const M0=modelos?.[e.modelo],b=M0?.box;if(!b)return null;const w=Math.max(b.max.x-b.min.x,b.max.z-b.min.z),h=b.max.y-b.min.y;if(!(w>0&&h>0))return null;
 const sx=e.copa/w,sz=(e.copaAncho??e.copa)/w,sy=e.alto/h,T0=troncoModelo(M0),M=e.tronco&&T0?afinado(M0,e.tronco/(T0.w*sx)):M0,T=M===M0?T0:troncoModelo(M,T0);
 const lx=(T?T.cx:(b.min.x+b.max.x)/2)*sx,lz=(T?T.cz:(b.min.z+b.max.z)/2)*sz,c=Math.cos(e.ang),s=Math.sin(e.ang),px=e.x-(lx*c+lz*s),pz=e.z-(-lx*s+lz*c);
 return {M,sx,sy,sz,px,pz,py0:-b.min.y*sy,ancho:w*sx,fondo:w*sz,alto:h*sy,tronco:T?T.w*sx:null,tx:px+lx*c+lz*s,tz:pz-lx*s+lz*c};}

// Dibuja el contrato del plano. kits: {nature2, plants} (los modelos cargados: {nombre: {parts, box}}); suelo(x, z): la
// altura del suelo del 3D. Devuelve {group, registro, esperado, lights, choques, collide, dispose}.
export function dibujarPlano(bp,{kits={},suelo=()=>0}={}){
 const group=new THREE.Group(),esperado=contrato(bp),registro=[],modelos={};
 for(const k of Object.values(kits))if(k)for(const [n,m] of Object.entries(k))if(m?.box)modelos[n]=m;
 const plantas=new Map(),piezas=[],placas=[];
 for(const e of esperado){const u=ubicar(e,modelos),y=suelo(e.x,e.z);
  if(!u){registro.push({id:e.id,modelo:e.modelo,falta:true});continue;}
  if(e.kit==='placa'){const yp=suelo(e.dentro.x,e.dentro.z)+e.altura;placas.push({...e,y:yp});registro.push({id:e.id,modelo:'placa',x:e.x,y:yp,z:e.z,ry:e.ang,ancho:u.ancho,fondo:u.fondo,alto:u.alto,texto:e.texto});continue;}
  // (la cebra no se dibuja como objeto: sus franjas van con la pintura, pegadas al asfalto —pintura3d.js—)
  // (2026-10-16, validar-oclusion: un objeto de base plana —banca, kiosco, parada…— sobre suelo desparejo —el andén de una
  // calle que sube, una ladera— va sobre una losa: a la altura de su esquina más alta y la losa, de concreto, hasta 5 cm
  // bajo la más baja; así ninguna esquina se hunde ni deja ver por debajo)
  if(e.kit==='objeto'){let yb=y,losa=null;
   if(PLANA.has(e.modelo)){const c=Math.cos(e.ang||0),sn=Math.sin(e.ang||0),a=u.ancho/2,b=u.fondo/2,hs=[[-a,-b],[a,-b],[a,b],[-a,b]].map(([du,dv])=>suelo(e.x+du*c+dv*sn,e.z-du*sn+dv*c));
    const hmax=Math.max(y,...hs),hmin=Math.min(y,...hs);if(hmax-hmin>.02){yb=hmax;losa={y0:+(hmin-.05).toFixed(3),y1:+hmax.toFixed(3)};piezas.push({x:e.x,y:losa.y0,z:e.z,ry:e.ang||0,sx:u.ancho+.12,sy:losa.y1-losa.y0,sz:u.fondo+.12,color:'#b9b4aa'});}}
   if(e.modelo!=='cebra')piezas.push(...placeParts(u.piezas,{x:e.x,y:yb+(e.y0||0),z:e.z,ry:e.ang}));registro.push({id:e.id,modelo:e.modelo,x:e.x,y:yb,z:e.z,ry:e.ang,ancho:u.ancho,fondo:u.fondo,alto:u.alto,...(losa?{losa}:{})});}
  else{(plantas.get(u.M)||plantas.set(u.M,[]).get(u.M)).push({x:u.px,y:y+u.py0,z:u.pz,ry:e.ang,sx:u.sx,sy:u.sy,sz:u.sz,tint:e.tint});
   registro.push({id:e.id,modelo:e.modelo,x:u.tx,y,z:u.tz,ry:e.ang,ancho:u.ancho,fondo:u.fondo,alto:u.alto,tronco:u.tronco});}}
 // las luces (para las de noche del demo): la luminaria del farol de calle, en la punta del brazo; la del de parque, arriba
 const lights=[];for(const e of esperado){if(e.modelo!=='farol'&&e.modelo!=='farol_parque')continue;const k=e.alto&&e.modelo==='farol'?e.alto/OBJETOS.farol.alto():1,y=suelo(e.x,e.z),lz=e.modelo==='farol'?1.15*k:0;
  lights.push({x:e.x+lz*Math.sin(e.ang),y:y+(e.modelo==='farol'?4.2*k:3.15),z:e.z+lz*Math.cos(e.ang)});}
 // (cada planta, descartable sola: plantBatched —con una InstancedMesh por modelo nunca se descartaba ninguna—)
 const lotes=[];for(const [M,items] of plantas){const b=plantBatched({m:M},'m',items,group);if(b)lotes.push(b);}
 const setCeldas=(celdas,W)=>{for(const b of lotes)b.setCeldas(celdas,W);};
 // (2026-10-16, medido en el navegador sin ventana —validar-3d—: todo el equipamiento del mundo iba en una malla por pieza
 // y color —350 mil triángulos también desde adentro de un edificio—; ahora por baldosas de 144 m: la cámara deja afuera
 // las que no mira y la niebla —niebla3d.js— las que quedan detrás de ella)
 if(piezas.length){const B=144,por=new Map();for(const q of piezas){const k=Math.floor(q.x/B)+','+Math.floor(q.z/B);(por.get(k)||por.set(k,[]).get(k)).push(q);}for(const l of por.values())group.add(partsMesh(l));}
 const pintura=dibujarPintura(bp.pintura||[],suelo);group.add(pintura.mesh);
 if(placas.length)group.add(dibujarPlacas(placas));
 // las colisiones: las del 2D (colisiones.js, COLISION de medidas.js), cada una con la altura del suelo donde está.
 // collide(x, z, r, pies): ¿un círculo de radio r con los pies a esa altura toca algo que no se salta?
 const {lista:choques}=colisiones(bp);for(const c of choques)c.y=suelo(c.x,c.z);const I=indiceColisiones(choques);
 const collide=(x,z,r,pies=-Infinity)=>{for(const [f,c] of I.cerca(x,z)){if(pies-c.y>=c.alto-.05)continue;if(distForma(f,x,z)<r)return c;}return null;};
 const dispose=()=>{group.traverse(o=>{if(o.isInstancedMesh||o.isBatchedMesh)o.dispose();});};
 return {group,registro,esperado,lights,choques,collide,dispose,setCeldas};}

// Las placas de dirección: una textura de texto por cada PORLAMINA placas (cada una, PX × PY píxeles: la vía arriba —«CALLE
// 7»— y el número grande abajo —«# 21-52»—, azul sobre blanco hueso con su borde), una malla de caras por lámina y, atrás,
// el marco azul (una caja un poco más grande).
const PX=256,PY=100,COLS=8,FILAS=40,PORLAMINA=COLS*FILAS,AZUL='#1d3a5c',FONDO='#f7f3e8';
function dibujarPlacas(lista){const g=new THREE.Group(),marcos=[];
 for(let l0=0;l0<lista.length;l0+=PORLAMINA){const L=lista.slice(l0,l0+PORLAMINA),filas=Math.ceil(L.length/COLS),cv=document.createElement('canvas');cv.width=COLS*PX;cv.height=filas*PY;const c=cv.getContext('2d');
  L.forEach((p,i)=>{const x=(i%COLS)*PX,y=Math.floor(i/COLS)*PY,r=14;c.fillStyle=AZUL;c.beginPath();c.roundRect(x+2,y+2,PX-4,PY-4,r);c.fill();c.fillStyle=FONDO;c.beginPath();c.roundRect(x+8,y+8,PX-16,PY-16,r-5);c.fill();
   c.fillStyle=AZUL;c.textAlign='center';c.textBaseline='middle';c.font='700 22px "Helvetica Neue",Arial,sans-serif';c.fillText(p.via.toUpperCase(),x+PX/2,y+28,PX-34);
   c.fillRect(x+30,y+42,PX-60,2);c.font='800 40px "Helvetica Neue",Arial,sans-serif';c.fillText(p.numero,x+PX/2,y+70,PX-34);});
  const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;
  const pos=[],uv=[],idx=[];L.forEach((p,i)=>{const c0=Math.cos(p.ang),s0=Math.sin(p.ang),hw=PLACA.ancho/2,hh=PLACA.alto/2,u0=(i%COLS)/COLS,u1=u0+1/COLS,v1=1-Math.floor(i/COLS)/filas,v0=v1-1/filas,b=pos.length/3;
   for(const [lx,ly,u,v] of [[-hw,-hh,u0,v0],[hw,-hh,u1,v0],[hw,hh,u1,v1],[-hw,hh,u0,v1]])pos.push(p.x+lx*c0,p.y+ly,p.z-lx*s0),uv.push(u,v);idx.push(b,b+1,b+2,b,b+2,b+3);
   marcos.push({x:p.x-Math.sin(p.ang)*(PLACA.fondo/2+.002),y:p.y-hh-.02,z:p.z-Math.cos(p.ang)*(PLACA.fondo/2+.002),sx:PLACA.ancho+.04,sy:PLACA.alto+.04,sz:PLACA.fondo,ry:p.ang,color:AZUL});});
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();
  const m=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({map:tex,roughness:.6,polygonOffset:true,polygonOffsetFactor:-1}));m.userData.placas=L.length;g.add(m);}
 g.add(partsMesh(marcos));return g;}

// La revisión del contrato: lo que se dibujó contra lo que el plano pide, uno a uno. Tolerancias: posición 1 cm, giro
// 0,001 rad, medida 2 %. Devuelve {total, dibujadas, fallas: [{id, que, ...}]} (también la usa el validador en node).
export function revisarContrato(esperado,registro){const R=new Map(registro.map(r=>[r.id,r])),fallas=[],f=(id,que,o={})=>fallas.push({id,que,...o});
 const cerca=(a,b,t)=>Math.abs(a-b)<=t,rel=(a,b)=>Math.abs(a-b)<=.02*Math.max(Math.abs(b),1e-6);
 for(const e of esperado){const r=R.get(e.id);if(!r){f(e.id,'no se dibujó');continue;}if(r.falta){f(e.id,'falta el modelo',{modelo:e.modelo});continue;}
  if(!cerca(r.x,e.x,.01)||!cerca(r.z,e.z,.01))f(e.id,'en otro lugar',{plano:[e.x,e.z],dibujo:[r.x,r.z]});
  if(!cerca(r.ry,e.ang,1e-3))f(e.id,'con otro giro',{plano:e.ang,dibujo:r.ry});
  if(e.copa!=null&&!rel(r.ancho,e.copa))f(e.id,'otra copa',{plano:e.copa,dibujo:+r.ancho.toFixed(2)});
  if(e.copaAncho!=null&&!rel(r.fondo,e.copaAncho))f(e.id,'otro ancho de copa (la poda)',{plano:e.copaAncho,dibujo:+r.fondo.toFixed(2)});
  if(e.alto!=null&&!rel(r.alto,e.alto))f(e.id,'otro alto',{plano:e.alto,dibujo:+r.alto.toFixed(2)});
  // (el tronco, al 10 %: es low poly, un hexágono mide distinto según hacia dónde)
  if(e.tronco!=null&&!(r.tronco!=null&&Math.abs(r.tronco-e.tronco)<=.1*e.tronco))f(e.id,'otro tronco',{plano:e.tronco,dibujo:r.tronco==null?null:+r.tronco.toFixed(3)});
  if(e.o?.w!=null&&!rel(r.ancho,e.o.w))f(e.id,'otro ancho',{plano:e.o.w,dibujo:+r.ancho.toFixed(2)});
  if(e.texto!=null&&r.texto!==e.texto)f(e.id,'otro texto',{plano:e.texto,dibujo:r.texto});
  if(e.o?.d!=null&&!rel(r.fondo,e.o.d))f(e.id,'otro fondo',{plano:e.o.d,dibujo:+r.fondo.toFixed(2)});}
 const ids=new Set(esperado.map(e=>e.id));for(const r of registro)if(!ids.has(r.id))f(r.id,'dibujado sin estar en el plano');
 return {total:esperado.length,dibujadas:registro.filter(r=>!r.falta).length,fallas};}

// La revisión del suelo (2026-10-16): en cada punto, la altura donde el juego pone los pies (suelo(x, z)) contra la
// superficie dibujada debajo (un rayo de arriba contra las mallas sólidas, sin las instancias —árboles, objetos—).
// Diferencia > tol: flota (los pies por encima) o se hunde (por debajo). Lo que pega el rayo a más de 2 m por encima de
// los pies es algo que tapa (un alero, un letrero, el globo): no cuenta. puntos: [[zona, x, z]].
export function revisarSuelo({scene,suelo,puntos,tol=.08}){const meshes=[];scene.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh&&o.visible&&!o.material?.transparent&&o.geometry?.attributes?.position?.count)meshes.push(o);});
 const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0),porZona={};
 for(const [zona,x,z] of puntos){ray.set(new THREE.Vector3(x,400,z),down);const g=suelo(x,z),h=ray.intersectObjects(meshes,false).find(h=>h.point.y<g+2);const Z=porZona[zona]??={n:0,flota:0,hunde:0,peor:0,ej:[]};
  if(!h){Z.sinSuelo=(Z.sinSuelo||0)+1;continue;}const dif=g-h.point.y;Z.n++;if(Math.abs(dif)>Math.abs(Z.peor))Z.peor=+dif.toFixed(3);
  if(dif>tol)Z.flota++;else if(dif<-tol)Z.hunde++;else continue;if(Z.ej.length<3)Z.ej.push([+x.toFixed(1),+z.toFixed(1),+dif.toFixed(2)]);}
 return porZona;}

// La revisión de los andenes (2026-10-16, Miguel vio árboles en la calle: el andén del 3D medía 1 m y el del plano 3): lo
// que el plano pone en la vereda —árboles de calle, faroles de calle, hidrantes, semáforos, paradas— tiene que quedar
// SOBRE el andén dibujado: la superficie bajo su centro, al menos min m por encima del asfalto de su calle (en el punto
// del eje más cercano). ejes: [{a, b}] (las calles del plano); arriba(x, z): la superficie dibujada (el rayo).
// (maxMonte: cuántos del monte se miden —cada uno son dos rayos contra el terreno—, repartidos)
export function revisarAndenes({esperado,plan,ejes,arriba,enCiudad,pisoCiudad,min=.1,maxMonte=150}){const V=plan.vegetacion,out={},Ar=new Map((V.arboles||[]).map((a,i)=>['arbol:'+i,a]));let nm=0,im=0;
 const seg=(x,z,a,b)=>{const dx=b.x-a.x,dz=b.z-a.z,L=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/L));return [a.x+t*dx,a.z+t*dz,Math.hypot(x-a.x-t*dx,z-a.z-t*dz)];};
 for(const e of esperado){const a=Ar.get(e.id),va=e.tipo==='arbol'?(a&&(a.tipo==='calle'||a.tipo==='avenida')):['farol','hidrante','semaforo','parada'].includes(e.tipo)&&e.modelo!=='farol_parque';if(!va)continue;
  const k=e.tipo==='arbol'?'arbol:'+a.tipo:e.tipo,Z=out[k]??={n:0,enAsfalto:0,ej:[]};Z.n++;let ok;
  if(enCiudad(e.x,e.z))ok=pisoCiudad(e.x,e.z)>=min;
  else{if(++im%Math.max(1,Math.ceil(esperado.length/2/maxMonte))!==0||nm>=maxMonte){Z.n--;continue;}nm++;let best=null;for(const g of ejes){const p=seg(e.x,e.z,g.a,g.b);if(!best||p[2]<best[2])best=p;}const y0=arriba(best[0],best[1]),y1=arriba(e.x,e.z);ok=y0!=null&&y1!=null&&y1-y0>=min;}
  if(!ok){Z.enAsfalto++;if(Z.ej.length<3)Z.ej.push([+e.x.toFixed(1),+e.z.toFixed(1)]);}}
 return out;}
