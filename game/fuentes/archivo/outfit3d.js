/* Vestir a un personaje del paquete de Quaternius con los rasgos del retrato hablado (capas.js: TRAITS): color de la
   ropa de arriba y del pantalón, color de pelo (o sin pelo), su sombrero propio, y tres accesorios hechos en código que
   el paquete no trae: gorra, gafas y mochila (pegados a los huesos Head y Torso, así siguen las animaciones).
   Los modelos son una sola malla con una parte por material (Shirt, Pants, Hair…), sin texturas: pintar es cambiar el
   material de una parte. Los materiales se comparten por color (MATS), para no multiplicar lo que se dibuja. */
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {PARTS,MODEL_LABEL,COLORS,colorOf,PIECES,CITY_PIECES,pieceById,TOP,SLEEVES,BOTTOM,BODY,UPPER,LOWER} from '../engine/vestuario.js';
export {PARTS,MODEL_LABEL,COLORS,colorOf,PIECES,CITY_PIECES,pieceById};



const MATS=new Map(),HIDDEN=new THREE.MeshBasicMaterial({visible:false});
function mat(base,color){const key=base.name+'|'+color;if(!MATS.has(key)){const m=base.clone();m.color=new THREE.Color(color);MATS.set(key,m);}return MATS.get(key);}
const ACC=new Map();
function accMat(color,opts={}){const key=color+JSON.stringify(opts);if(!ACC.has(key))ACC.set(key,new THREE.MeshStandardMaterial({color,roughness:.75,...opts}));return ACC.get(key);}
const shade=(hex,k)=>'#'+new THREE.Color(hex).multiplyScalar(k).getHexString();

// Partes de un personaje (las mallas, por nombre de material).
function partsOf(root){const out={};root.traverse(o=>{if(o.isMesh)(out[o.userData.part||(o.userData.part=o.material.name)]||(out[o.userData.part]=[])).push(o);});return out;}
// La caja (en el mundo, en la pose que se ve) de los vértices que mueve sobre todo el hueso bone y cumplen keep(v).
function boneBox(meshes,bone,keep=()=>true){const b=new THREE.Box3(),v=new THREE.Vector3();if(!bone)return b;
 for(const m of meshes){if(!m.isSkinnedMesh)continue;const j=m.skeleton.bones.indexOf(bone);if(j<0)continue;m.skeleton.update();
  const J=m.geometry.attributes.skinIndex,Wt=m.geometry.attributes.skinWeight,P=m.geometry.attributes.position;
  for(let i=0;i<P.count;i++){let best=0,bj=-1;for(let k=0;k<4;k++){const w=Wt.getComponent(i,k);if(w>best){best=w;bj=J.getComponent(i,k);}}
   if(bj!==j)continue;m.getVertexPosition(i,v);v.applyMatrix4(m.matrixWorld);if(keep(v))b.expandByPoint(v);}}
 return b;}
// ---------- Zonas ----------
// Cada triángulo de una parte va a una zona según el hueso que más lo mueve (todos los modelos comparten el esqueleto):
// la piel se separa en cara, cuello, manos, pies, tobillos, muslos, pantorrillas, brazos y antebrazos; la ropa de arriba en torso,
// hombros y mangas (arriba y abajo); el pantalón en arriba y abajo; la cara en ojos y cejas (las cejas, el tercio de
// arriba de cada lado). Así se pintan zapatos, guantes, el largo de las mangas y del pantalón sin cambiar la forma.
const strip=n=>n.replace(/_\d+$/,'').replace(/\.?[LR]$/,'');// Three.js le saca el punto («UpperArm.L» llega «UpperArmL») y renombra «Body» a «Body_1» (choca con la malla)
const ARM=new Set(['UpperArm','LowerArm','Fist']),LEG=new Set(['UpperLeg','LowerLeg','Foot']);
function zoneOf(role,bone,P){
 if(role==='skin')return {Fist:'manos',Foot:'pies',LowerLeg:'pantorrillas',UpperLeg:'muslos',UpperArm:'brazos',Shoulder:'brazos',LowerArm:'antebrazos',Head:'cara',Neck:'cuello'}[bone]||'piel';
 if(role==='top'){if(P.topPants&&(LEG.has(bone)||bone==='Hips'||bone==='Body'))return bone==='LowerLeg'||bone==='Foot'?'pant_abajo':'pant_arriba';
  if(P.innerSleeves)return 'ropa';if(bone==='Shoulder')return 'hombros';if(bone==='UpperArm')return 'manga_arriba';if(bone==='LowerArm'||bone==='Fist')return 'manga_abajo';return 'ropa';}
 if(role==='inner'){if(P.innerSleeves){if(bone==='Shoulder')return 'hombros';if(bone==='UpperArm')return 'manga_arriba';if(bone==='LowerArm'||bone==='Fist')return 'manga_abajo';}
  // Los puños de la camisa de abajo (asoman bajo la manga del saco): se van con las mangas.
  if(ARM.has(bone))return 'puños';return 'camisa';}
 if(role==='pants')return bone==='LowerLeg'||bone==='Foot'?'pant_abajo':'pant_arriba';
 return role;}
function roleOf(name,P){if(name==='Skin')return 'skin';if(name==='Face')return 'face';if(name===P.top)return 'top';if(name===P.inner)return 'inner';if(name===P.pants)return 'pants';
 if(name===P.belt)return 'cinturon';if(name===P.detail)return 'detalle';if(name===P.hair)return 'pelo';if(name===P.hat)return 'sombrero';return 'otro';}
// ¿Pantalón largo? «original»: como viene el modelo (largo si su pantalón llega a la pantorrilla).
export function pantsLong(P,largo){if(largo==='largo')return true;if(largo==='corto')return false;return null;}
function splitZones(m,name,P){const g=m.geometry;if(g.userData.zones)return;
 const role=roleOf(name,P),J=g.attributes.skinIndex,Wt=g.attributes.skinWeight;
 if(!g.index){const idx=[];for(let i=0;i<g.attributes.position.count;i++)idx.push(i);g.setIndex(idx);}
 const I=g.index.array,tris=I.length/3,bones=m.skeleton?.bones||[];
 const vb=i=>{let best=0,bj=0;for(let k=0;k<4;k++){const w=Wt.getComponent(i,k);if(w>best){best=w;bj=J.getComponent(i,k);}}return strip(bones[bj]?.name||'');};
 const zone=new Array(tris);
 if(role==='face'){// cejas: el tercio de arriba de los vértices de cada lado (en la pose que se ve)
  const v=new THREE.Vector3(),pos=[];for(let i=0;i<g.attributes.position.count;i++){m.getVertexPosition(i,v);v.applyMatrix4(m.matrixWorld);pos.push(v.clone());}
  const cx=pos.reduce((s,p)=>s+p.x,0)/pos.length,cut=sgn=>{const ys=pos.filter(p=>(p.x-cx)*sgn>0).map(p=>p.y);const lo=Math.min(...ys),hi=Math.max(...ys);return lo+(hi-lo)*.62;},cl=cut(-1),cr=cut(1);
  for(let t=0;t<tris;t++){const c=[0,1,2].map(k=>pos[I[3*t+k]]),y=(c[0].y+c[1].y+c[2].y)/3,x=(c[0].x+c[1].x+c[2].x)/3;zone[t]=y>(x<cx?cl:cr)?'cejas':'ojos';}}
 else{for(let t=0;t<tris;t++){const b=[0,1,2].map(k=>vb(I[3*t+k])),bone=b[1]===b[2]?b[1]:b[0];zone[t]=role==='otro'?'otro':zoneOf(role,bone,P);}
  // El largo del pantalón: el límite entre arriba y abajo va por el anillo de vértices más cercano a la rodilla (lo más
  // alto que mueve la pantorrilla), no por donde cambia el hueso: así el pantalón acortado tiene un dobladillo derecho.
  // (En la pose de atado las piernas están derechas: la altura es la y del espacio de atado.)
  if(zone.includes('pant_abajo')){const P0=g.attributes.position,yv=i=>P0.getY(i);let knee=-Infinity;const rings=new Set();
   for(let t=0;t<tris;t++)if(zone[t]==='pant_arriba'||zone[t]==='pant_abajo')for(let k=0;k<3;k++){const i=I[3*t+k];rings.add(Math.round(yv(i)*1000)/1000);if(zone[t]==='pant_abajo'&&vb(i)==='LowerLeg')knee=Math.max(knee,yv(i));}
   if(knee>-Infinity){const cut=[...rings].reduce((b,q)=>Math.abs(q-knee)<Math.abs(b-knee)?q:b,knee);
    for(let t=0;t<tris;t++)if(zone[t]==='pant_arriba'||zone[t]==='pant_abajo')zone[t]=Math.max(yv(I[3*t]),yv(I[3*t+1]),yv(I[3*t+2]))<=cut+.002?'pant_abajo':'pant_arriba';}}
  // Los pies del paquete son apenas la punta de la pierna: el zapato sube hasta el tobillo (el tercio de abajo de la pantorrilla).
  // El corte va por el anillo de vértices más cercano a ese tercio, para que el borde quede derecho.
  if(role==='skin'){const v=new THREE.Vector3(),y=i=>{m.getVertexPosition(i,v);v.applyMatrix4(m.matrixWorld);return v.y;},rings=new Set(),tv=[];
   for(let t=0;t<tris;t++)if(zone[t]==='pantorrillas'){const ys=[y(I[3*t]),y(I[3*t+1]),y(I[3*t+2])];tv.push([t,Math.max(...ys)]);for(const q of ys)rings.add(Math.round(q*1000)/1000);}
   if(tv.length){const rs=[...rings].sort((a,b)=>a-b),lo=rs[0],hi=rs.at(-1),goal=lo+(hi-lo)*.33,cut=rs.slice(1).reduce((b,q)=>Math.abs(q-goal)<Math.abs(b-goal)?q:b,rs[1]??hi);
    for(const [t,top] of tv)if(top<=cut+.002)zone[t]='tobillos';}}}
 // Reordenar los triángulos por zona y armar un grupo por zona (cada grupo, su material).
 const names=[...new Set(zone)],out=new (I.constructor)(I.length);let k=0;g.clearGroups();
 names.forEach((zn,gi)=>{const start=k;for(let t=0;t<tris;t++)if(zone[t]===zn){out[k++]=I[3*t];out[k++]=I[3*t+1];out[k++]=I[3*t+2];}g.addGroup(start,k-start,gi);});
 g.setIndex(new THREE.BufferAttribute(out,1));g.userData.zones=names;}
// Las zonas que tiene un personaje ya vestido (para mostrar sólo las opciones que le sirven).
export function zonesOf(root){const out=new Set();root.traverse(o=>{if(o.isMesh&&o.geometry.userData.zones)for(const z of o.geometry.userData.zones)out.add(z);});return out;}
// ---------- Piezas de otros modelos ----------
// Los 52 modelos del paquete atan sus piezas al mismo esqueleto en la misma pose (las 23 matrices de atado son
// idénticas, medido 2026-10-10): una pieza de cualquiera se le puede poner a cualquier otro y se mueve con él.
const SCENES=new Map(),LOADED=new Map(),SCENE_GET=m=>LOADED.get(m);
// El modelo de donde sale una pieza (se carga una vez, al elegirla).
export function loadPieceModel(m){if(!SCENES.has(m))SCENES.set(m,new GLTFLoader().loadAsync('/models/personajes/'+m+'.gltf').then(g=>{LOADED.set(m,g.scene);return g.scene;}));return SCENES.get(m);}
// Poner las partes names del modelo scene en el personaje root: cada malla nueva se ata a los huesos de root.
// keep: si se da, sólo los triángulos que mueven sobre todo esos huesos (el sombrero vaquero comparte material con el
// cinturón: del sombrero sólo se toma la cabeza). La geometría filtrada se guarda para no rehacerla.
// region: en las coordenadas de la cabeza (y arriba, z adelante; los ojos van de y 0,30 a 0,59), la barba es lo que
// queda debajo de la boca, adelante y cerca del centro. 'scalp' saca la barba; 'beard' la deja sola; 'beardShort', sólo
// lo de arriba (la barba corta, sin lo que cuelga).
const inBeard=c=>c.y<.27&&c.z>.12&&Math.abs(c.x)<.42;
const REGION={scalp:c=>!inBeard(c),beard:inBeard,beardShort:c=>inBeard(c)&&c.y>.04};
function filtered(src,keep,region=null){const key='f:'+(keep||[]).join(',')+'|'+(region||''),g=src.geometry;if(g.userData[key])return g.userData[key];
 const J=g.attributes.skinIndex,Wt=g.attributes.skinWeight,bones=src.skeleton.bones,I=g.index?g.index.array:[...Array(g.attributes.position.count).keys()],out=[];
 const vb=i=>{let best=0,bj=0;for(let k=0;k<4;k++){const w=Wt.getComponent(i,k);if(w>best){best=w;bj=J.getComponent(i,k);}}return strip(bones[bj]?.name||'');};
 const hj=bones.findIndex(b=>b.name==='Head'),inv=hj>=0?src.skeleton.boneInverses[hj]:null,P=g.attributes.position,c=new THREE.Vector3(),v=new THREE.Vector3(),test=region&&REGION[region];
 for(let t=0;t<I.length;t+=3){if(keep){const b=[vb(I[t]),vb(I[t+1]),vb(I[t+2])];if(!b.some(x=>keep.includes(x)))continue;}
  if(test&&inv){c.set(0,0,0);for(let k=0;k<3;k++)c.add(v.fromBufferAttribute(P,I[t+k]));c.multiplyScalar(1/3).applyMatrix4(inv);if(!test(c))continue;}
  out.push(I[t],I[t+1],I[t+2]);}
 const ng=g.clone();ng.userData={};ng.setIndex(out);ng.clearGroups();g.userData[key]=ng;return ng;}
function borrow(root,scene,names,keep=null,region=null){const own=[];root.traverse(o=>{if(o.isSkinnedMesh&&!o.userData.borrowed)own.push(o);});const ref=own[0],out=[];if(!ref)return out;
 scene.traverse(src=>{if(!src.isSkinnedMesh||!names.includes(src.material.name))return;
  const bones=src.skeleton.bones.map(b=>ref.skeleton.bones.find(x=>x.name===b.name));if(bones.some(b=>!b))return;
  const m=new THREE.SkinnedMesh(keep||region?filtered(src,keep,region):src.geometry,src.material);m.position.copy(src.position);m.quaternion.copy(src.quaternion);m.scale.copy(src.scale);
  m.userData.borrowed=true;m.userData.part=src.material.name;m.userData.base=src.material;m.frustumCulled=false;m.castShadow=true;
  ref.parent.add(m);m.bind(new THREE.Skeleton(bones,src.skeleton.boneInverses),src.bindMatrix.clone());out.push(m);});
 return out;}
// ---------- El cuerpo base debajo de la ropa ----------
// Debajo de una prenda pegada, la piel del cuerpo base asoma a través. Se recorta: para cada hueso que la prenda cubre
// (arriba: torso y brazos; pantalón: cadera y piernas), se mide hasta dónde llega la prenda a lo largo del hueso (en
// las coordenadas del hueso, donde el hueso es el eje y) y se esconde la piel de ese hueso que queda dentro de ese
// tramo. Así la manga corta deja el brazo de abajo y el short deja la rodilla. La geometría recortada se guarda por
// combinación de prendas. (Comparar triángulo por triángulo con la piel del modelo de origen fallaba donde el paquete
// retriangula la piel cerca del borde de la ropa.)
const UPPER_COVER=new Set(['Torso','Abdomen','Shoulder','UpperArm','LowerArm','Neck']),LOWER_COVER=new Set(['Hips','Body','UpperLeg','LowerLeg']),ALL_COVER=new Set([...UPPER_COVER,...LOWER_COVER]);
const domJoint=(g,i)=>{const J=g.attributes.skinIndex,W=g.attributes.skinWeight;let b=0,bj=0;for(let k=0;k<4;k++){const w=W.getComponent(i,k);if(w>b){b=w;bj=J.getComponent(i,k);}}return bj;};
function cover(pc,scene,group){if(pc._cover)return pc._cover;const ranges=new Map(),counts=new Map(),v=new THREE.Vector3();
 scene.traverse(o=>{if(!o.isSkinnedMesh||!pc.parts.includes(o.material.name))return;const g=o.geometry,P=g.attributes.position,bones=o.skeleton.bones;
  for(let i=0;i<P.count;i++){const j=domJoint(g,i),name=bones[j]?.name;if(!name||!group.has(strip(name)))continue;
   v.fromBufferAttribute(P,i).applyMatrix4(o.skeleton.boneInverses[j]);const r=ranges.get(name)||[Infinity,-Infinity];r[0]=Math.min(r[0],v.y);r[1]=Math.max(r[1],v.y);ranges.set(name,r);counts.set(name,(counts.get(name)||0)+1);}});
 for(const [n,c] of counts)if(c<20)ranges.delete(n);
 return pc._cover=ranges;}
const CUTS=new Map(),TRUNK=new Set(['Hips','Body','Abdomen','Torso']);
function cutBase(m,covers,key){const g0=m.userData.g0||(m.userData.g0=m.geometry);if(!covers.length)return g0;if(CUTS.has(key))return CUTS.get(key);
 const I=g0.index.array,P=g0.attributes.position,bones=m.skeleton.bones,inv=m.skeleton.boneInverses,out=[],v=new THREE.Vector3(),c=new THREE.Vector3();
 for(let t=0;t<I.length;t+=3){const js=[domJoint(g0,I[t]),domJoint(g0,I[t+1]),domJoint(g0,I[t+2])],j=js[1]===js[2]?js[1]:js[0],name=bones[j]?.name;
  c.set(0,0,0);for(let k=0;k<3;k++)c.add(v.fromBufferAttribute(P,I[t+k]));c.multiplyScalar(1/3).applyMatrix4(inv[j]);
  // Un poco hacia adentro del borde de la prenda, para que no quede una rendija entre la piel y el dobladillo.
  // En el tronco (cadera, abdomen, torso) la prenda cubre todo el hueso: ahí no se mide el tramo.
  if(covers.some(cv=>{const r=cv.get(name);if(!r)return false;if(TRUNK.has(strip(name)))return true;const e=(r[1]-r[0])*.04;return c.y>r[0]+e&&c.y<r[1]-e;}))continue;out.push(I[t],I[t+1],I[t+2]);}
 const g=g0.clone();g.userData={};g.setIndex(out);g.clearGroups();CUTS.set(key,g);return g;}
// ---------- El pelo debajo del sombrero ----------
// Se mide el sombrero en las coordenadas de la cabeza (tal como está ahora): dónde empieza el ala (lo más bajo) y el
// ancho de la copa (lo que está por encima de un cuarto de su alto). Se recortan los triángulos del pelo cuyo centro
// queda por encima del ala y dentro de la copa; el pelo que cae por debajo del ala o por fuera queda. Se guarda por
// pelo y sombrero.
const HAIR_CUTS=new Map();
function worldPoints(o,out){const v=new THREE.Vector3();o.updateMatrixWorld(true);
 if(o.isSkinnedMesh){const P=o.geometry.attributes.position,I=o.geometry.index?o.geometry.index.array:null,seen=new Set();
  const idx=I?I:[...Array(P.count).keys()];for(const i of idx){if(seen.has(i))continue;seen.add(i);o.getVertexPosition(i,v);out.push(v.clone().applyMatrix4(o.matrixWorld));}}
 else o.traverse(c=>{if(c.isMesh){const P=c.geometry.attributes.position;for(let i=0;i<P.count;i++)out.push(v.fromBufferAttribute(P,i).applyMatrix4(c.matrixWorld).clone());}});
 return out;}
function clipHair(hairs,hats,head,hatKey,hairColor){
 head.updateMatrixWorld(true);const inv=head.matrixWorld.clone().invert(),pts=[];for(const h of hats)worldPoints(h,pts);if(!pts.length)return;
 const loc=pts.map(p=>p.clone().applyMatrix4(inv)),ys=loc.map(p=>p.y),y0=Math.min(...ys),y1=Math.max(...ys),hgt=y1-y0;
 // La copa: los puntos por encima de un cuarto del alto (el ala del vaquero es mucho más ancha que la copa).
 const crown=loc.filter(p=>p.y>y0+hgt*.25),box=new THREE.Box3().setFromPoints(crown.length?crown:loc);
 // La copa como una elipse (en x, z) un 30 % más ancha: el flequillo que asoma por delante del casco también se va.
 const brim=y0+hgt*.04,v=new THREE.Vector3(),c=new THREE.Vector3(),cx=(box.min.x+box.max.x)/2,cz=(box.min.z+box.max.z)/2,rx=(box.max.x-box.min.x)/2*1.3,rz=(box.max.z-box.min.z)/2*1.3;
 for(const m of hairs){const g0=m.userData.hairG0||(m.userData.hairG0=m.geometry),key=g0.uuid+'|'+hatKey;
  if(!HAIR_CUTS.has(key)){const I=g0.index?g0.index.array:[...Array(g0.attributes.position.count).keys()],out=[];m.geometry=g0;m.updateMatrixWorld(true);
   for(let t=0;t<I.length;t+=3){c.set(0,0,0);for(let k=0;k<3;k++){m.getVertexPosition(I[t+k],v);c.add(v.applyMatrix4(m.matrixWorld));}c.multiplyScalar(1/3).applyMatrix4(inv);
    // Dentro de la copa (con un margen), o por encima del sombrero: se recorta.
    // Por encima del ala y dentro del ancho del sombrero se recorta, esté adelante o atrás (el flequillo cae hacia
    // adelante más allá de la copa); por encima del sombrero, siempre.
    if(c.y>y1-hgt*.08||(c.y>brim&&Math.abs(c.x-cx)<rx))continue;out.push(I[t],I[t+1],I[t+2]);}
   const g=g0.clone();g.userData={};g.setIndex(out);g.clearGroups();HAIR_CUTS.set(key,g);}
  m.geometry=HAIR_CUTS.get(key);if(Array.isArray(m.material))m.material=hairColor?mat(m.userData.base||m.material[0],hairColor):m.material[0];}}
const SEATED=new Map();
function seatHats(hats,below,head){if(!hats.length)return 0;head.updateMatrixWorld(true);const inv=head.matrixWorld.clone().invert(),hp=[];for(const h of hats)worldPoints(h,hp);
 const loc=hp.map(p=>p.applyMatrix4(inv)),ys=loc.map(p=>p.y),y0=Math.min(...ys),y1=Math.max(...ys),hgt=y1-y0,crown=loc.filter(p=>p.y>y0+hgt*.25),box=new THREE.Box3().setFromPoints(crown.length?crown:loc);
 // Lo más alto de la cabeza y del pelo que queda debajo de la copa.
 let top=-Infinity;for(const m of below){const pts=worldPoints(m,[]);for(const p of pts){p.applyMatrix4(inv);if(p.x>box.min.x&&p.x<box.max.x&&p.z>box.min.z&&p.z<box.max.z&&p.y<y0+hgt*.6)top=Math.max(top,p.y);}}
 const gap=y0-top;if(!(gap>hgt*.03))return 0;
 for(const m of hats){const j=m.skeleton.bones.indexOf(head);if(j<0)continue;const key=m.geometry.uuid+'|'+gap.toFixed(3);
  if(!SEATED.has(key)){// bajar en el espacio de atado: la dirección «arriba» de la cabeza, llevada a ese espacio
   const up=new THREE.Vector3(0,1,0).transformDirection(m.skeleton.boneInverses[j].clone().invert()),g=m.geometry.clone();g.userData={};
   g.translate(-up.x*gap*.92,-up.y*gap*.92,-up.z*gap*.92);SEATED.set(key,g);}
  m.geometry=SEATED.get(key);}
 return gap;}
// Un rectángulo de esquinas redondeadas centrado en el origen (para el marco y el vidrio de las gafas).
function roundRect(w,h,rr){const s=new THREE.Shape(),x=-w/2,y=-h/2;rr=Math.min(rr,w/2,h/2);
 s.moveTo(x+rr,y);s.lineTo(x+w-rr,y);s.quadraticCurveTo(x+w,y,x+w,y+rr);s.lineTo(x+w,y+h-rr);s.quadraticCurveTo(x+w,y+h,x+w-rr,y+h);
 s.lineTo(x+rr,y+h);s.quadraticCurveTo(x,y+h,x,y+h-rr);s.lineTo(x,y+rr);s.quadraticCurveTo(x,y,x+rr,y);return s;}

// Vestir: model es el nombre del modelo; o = {piel, ropa, pantalon, pelo ('no' = sin pelo), ojos, sombrero, gorra, gafas,
// mochila, gorraColor, gafasColor, mochilaColor}. Cada color es un nombre de COLORS o un «#rrggbb».
// Se puede llamar de nuevo para cambiar la ropa (saca los accesorios anteriores).
export function dress(root,model,o,scenes=SCENE_GET){
 // Las piezas prestadas de una vestida anterior se sacan antes de mirar las partes propias.
 for(const m of root.userData.borrowed||[])m.parent?.remove(m);root.userData.borrowed=[];
 if(root.userData.bakedMesh){root.userData.bakedMesh.parent?.remove(root.userData.bakedMesh);root.userData.bakedMesh=null;}
 const P=PARTS[model]||{},parts=partsOf(root);
 // (y el pelo vuelve a su geometría entera: el recorte de un sombrero anterior no queda)
 for(const ms of Object.values(parts))for(const m of ms){m.visible=true;if(m.userData.hairG0)m.geometry=m.userData.hairG0;}
 root.updateMatrixWorld(true);
 // Cuerpo base: se recorta la piel que tapan la ropa de arriba y el pantalón prestados.
 if(P.base)for(const m of parts.Skin||[]){const cv=[],key=[];
  // Lo de encima recorta sólo si es cerrado (tapa la ropa de arriba): la chaqueta abierta deja ver el pecho.
  // Con mangas cortas o sin mangas, y con pantalón corto, la prenda se esconde en esa parte y la piel de abajo no se
  // recorta: aparece el brazo (o la pierna) del cuerpo, delgado, en vez de la manga pintada de piel.
  const sl=o.mangas||'original',drop=new Set([...(sl==='sin'?['UpperArm','LowerArm']:sl==='cortas'?['LowerArm']:[]),...(o.largo==='corto'?['LowerLeg']:[])]);
  for(const [k,group] of [['pzArriba',UPPER_COVER],['pzPantalon',LOWER_COVER],['pzEncima',ALL_COVER]]){const pc=o[k]&&pieceById(o[k]),sc=pc&&scenes(pc.m);
   if(!sc||(k==='pzEncima'&&!pc.hides?.includes('ropa')))continue;let c=cover(pc,sc,group);
   if(k!=='pzEncima'&&drop.size)c=new Map([...c].filter(([n])=>!drop.has(strip(n))));cv.push(c);key.push(pc.id);}
  key.push(sl,o.largo||'');
  m.geometry=cutBase(m,cv,key.join('|'));}
 // Cada parte se separa en zonas (una vez por geometría) y cada zona toma su color.
 const skin=colorOf('piel',o.piel,'media'),topC=colorOf('ropa',o.ropa,'roja'),sleeves=o.mangasColor?colorOf('ropa',o.mangasColor):topC,inner=colorOf('camisa',o.camisa,'blanca');
 // Largos: «original» deja lo que trae el modelo; si no, la piel que asoma se pinta de la prenda (o la prenda de piel).
 const pantsC=P.pants||P.topPants||o.pzPantalon?colorOf('pantalon',o.pantalon,'jean'):null,long=pantsLong(P,o.largo),sl=o.mangas||'original';
 const z={piel:skin,cara:skin,cuello:skin,manos:o.guantes?colorOf('guantes',o.guantes,'negros'):skin,pies:o.zapatos==='no'?skin:colorOf('zapatos',o.zapatos,'negros'),tobillos:o.zapatos==='no'?(long===true?pantsC:skin):colorOf('zapatos',o.zapatos,'negros'),
  muslos:long===true?pantsC:skin,pantorrillas:long===true?pantsC:skin,brazos:sl==='largas'?sleeves:skin,antebrazos:sl==='largas'?sleeves:skin,
  ropa:topC,hombros:topC,manga_arriba:sl==='sin'?skin:sleeves,manga_abajo:sl==='sin'||sl==='cortas'?skin:sleeves,
  camisa:inner,puños:inner,pant_arriba:pantsC,pant_abajo:long===false?skin:pantsC,cinturon:colorOf('cinturon',o.cinturon,'negro'),detalle:colorOf('detalle',o.detalle,'negro'),
  pelo:o.pelo&&o.pelo!=='no'?colorOf('pelo',o.pelo):null,sombrero:null,ojos:colorOf('ojos',o.ojos,'blancos'),cejas:o.cejas?colorOf('cejas',o.cejas):colorOf('ojos',o.ojos,'blancos')};
 // Lo que tapa la prenda de encima prestada no se dibuja.
 const hidden=new Set(o.pzEncima?pieceById(o.pzEncima)?.hides||[]:[]),bp=o.pzPantalon&&pieceById(o.pzPantalon);
 if(bp){hidden.add('pant_arriba');hidden.add('cinturon');if(bp.long)hidden.add('pant_abajo');}
 if(o.pzArriba)for(const k of TOP)hidden.add(k);
 const zOwn=bp&&!bp.long?{...z,pant_abajo:skin}:z;
 for(const [name,meshes] of Object.entries(parts))for(const m of meshes){const base=m.userData.base||(m.userData.base=m.material);splitZones(m,name,P);
  m.material=m.geometry.userData.zones.map(k=>hidden.has(k)?HIDDEN:zOwn[k]?mat(base,zOwn[k]):base);}
 const hairVisible=!!P.hair&&o.pelo!=='no'&&!o.pzPelo;
 for(const m of parts[P.hair]||[])m.visible=hairVisible;
 if(P.hat)for(const m of parts[P.hat]||[])m.visible=!!o.sombrero&&!o.gorra&&!o.pzSombrero;
 // Piezas de otros modelos: pelo, sombrero, bigote, bufanda, algo encima y pantalón. El pelo y el pantalón propios se
 // esconden; el pelo y el bigote toman el color de pelo, el pantalón el suyo; lo demás queda con sus colores.
 // Lo que tapa la prenda de encima también se esconde en la ropa prestada (la camiseta debajo de la bata).
 const overHides=new Set(o.pzEncima?pieceById(o.pzEncima)?.hides||[]:[]);
 const paintOf={pelo:z.pelo,pantalon:pantsC,encima:o.encimaColor?colorOf('ropa',o.encimaColor):null};
 for(const key of ['pzPelo','pzSombrero','pzBigote','pzBufanda','pzArriba','pzEncima','pzPantalon']){const pc=o[key]&&pieceById(o[key]);if(!pc)continue;
  if(key==='pzSombrero'&&o.gorra)continue;if(key==='pzPelo'&&o.pelo==='no')continue;
  const sc=scenes(pc.m);if(!sc)continue;const got=borrow(root,sc,pc.parts,pc.bones,pc.region);for(const m of got)m.userData.slot=key;root.userData.borrowed.push(...got);
  // Con papeles (ropa de arriba, pantalón): por zonas, con los mismos colores que la ropa propia. Un pantalón corto
  // prestado deja la parte de abajo del pantalón propio de piel.
  if(pc.roles){const Pp={innerSleeves:pc.innerSleeves};for(const [part,role] of Object.entries(pc.roles))Pp[role==='detail'?'detail':role]=part;
   const zz={...z,pant_abajo:pantsC},cut=new Set(overHides);
   if(P.base){const sl=o.mangas||'original';if(sl==='sin'){cut.add('manga_arriba');cut.add('manga_abajo');cut.add('puños');}else if(sl==='cortas'){cut.add('manga_abajo');cut.add('puños');}if(o.largo==='corto')cut.add('pant_abajo');}
   for(const m of got){splitZones(m,m.userData.part,Pp);m.material=m.geometry.userData.zones.map(k=>cut.has(k)?HIDDEN:zz[k]?mat(m.userData.base,zz[k]):m.userData.base);}continue;}
  const c=pc.paint?paintOf[pc.paint]:null;if(c)for(const m of got)if(!pc.paintParts||pc.paintParts.includes(m.userData.part))m.material=mat(m.userData.base,c);
  }
 // Accesorios: se arman en el mundo, medidos sobre el cuerpo tal como está, y se pegan al hueso.
 for(const a of root.userData.acc||[])a.parent?.remove(a);root.userData.acc=[];
 const head=root.getObjectByName('Head'),torso=root.getObjectByName('Torso')||root.getObjectByName('Abdomen');
 const skinHead=boneBox(parts.Skin||[],head);if(skinHead.isEmpty())return;
 const hc=skinHead.getCenter(new THREE.Vector3()),hs=skinHead.getSize(new THREE.Vector3()),r=Math.max(hs.x,hs.z)/2,top=skinHead.max.y;
 const put=(obj,bone)=>{obj.updateMatrixWorld(true);(bone||root).attach(obj);root.userData.acc.push(obj);};
 if(o.gorra){const c=colorOf('gorra',o.gorraColor,'azul'),g=new THREE.Group(),m=accMat(c),crown=new THREE.Mesh(new THREE.SphereGeometry(r*1.02,20,10,0,Math.PI*2,0,Math.PI/2),m);
  const visor=new THREE.Mesh(new THREE.CylinderGeometry(r*.75,r*.75,r*.06,20,1,false,-Math.PI/2,Math.PI),accMat(shade(c,.85)));visor.scale.z=1.25;visor.position.set(0,r*.02,r*.62);
  const button=new THREE.Mesh(new THREE.SphereGeometry(r*.09,8,6),m);button.position.y=r*1.0;g.add(crown,visor,button);g.userData.cap=true;g.position.set(hc.x,top-r*.62,hc.z);put(g,head);}
 if(o.gafas)glasses(o,parts,head,hc,r,skinHead,put);
 // La mochila se apoya en lo que esté más afuera en el tronco: la ropa propia, la prestada o, sin ropa, la piel.
 if(o.mochila){const bw=root.userData.borrowed.filter(m=>m.userData.slot==='pzArriba'||m.userData.slot==='pzEncima'),own=P.top?parts[P.top]||[]:[];
  backpack(o,torso,root,r,put,own.length||bw.length?[...own,...bw]:parts.Skin||[]);}
 // El pelo que queda dentro de un sombrero, un casco o la gorra se recorta (si no, atraviesa la copa). El sombrero
 // propio de un modelo ya viene con su pelo hecho para él: sólo cuenta si el pelo es prestado.
 const borrowed=root.userData.borrowed,hairs=[...(hairVisible?parts[P.hair]||[]:[]),...borrowed.filter(m=>m.userData.slot==='pzPelo')];
 const hats=[...borrowed.filter(m=>m.userData.slot==='pzSombrero'),...(o.pzPelo&&P.hat&&o.sombrero&&!o.gorra?parts[P.hat]:[]),...root.userData.acc.filter(a=>a.userData.cap)];
 if(hats.length){const hatKey=[o.pzSombrero,o.gorra&&'gorra',o.sombrero&&'propio'].filter(Boolean).join('+');
  // Un sombrero prestado que queda flotando (hecho para un pelo más abultado) baja hasta apoyarse en la cabeza o el
  // pelo; después se recorta el pelo que queda dentro de la copa ya apoyada.
  const gap=seatHats(borrowed.filter(m=>m.userData.slot==='pzSombrero'),[...(parts.Skin||[]),...hairs],head);
  if(hairs.length)clipHair(hairs,hats,head,hatKey+'|'+(gap||0).toFixed(3),z.pelo);}
}

// Las gafas: un lente sobre cada ojo (los ojos son las barras verticales de «Face»; las cejas, las horizontales de
// arriba), marco de esquinas redondeadas con su vidrio tintado, puente y patillas hasta la altura de las orejas.
function glasses(o,parts,head,hc,r,skinHead,put){
 const face=parts.Face||[],c=colorOf('gafas',o.gafasColor,'negras'),frame=accMat(c),glass=accMat('#a9cbe0',{transparent:true,opacity:.28,roughness:.1,metalness:.1});
 // Los ojos: los vértices de la cara más altos que anchos… se toman los de la mitad de abajo de cada lado (sin cejas).
 const sideBox=sgn=>{const all=boneBox(face,head,v=>(v.x-hc.x)*sgn>0);if(all.isEmpty())return all;const mid=all.min.y+(all.max.y-all.min.y)*.62;return boneBox(face,head,v=>(v.x-hc.x)*sgn>0&&v.y<mid);};
 const L=sideBox(-1),R=sideBox(1);if(L.isEmpty()||R.isEmpty())return;
 const lc=L.getCenter(new THREE.Vector3()),rc=R.getCenter(new THREE.Vector3()),gap=rc.x-lc.x;
 const w=Math.min(gap*.92,r*.62),h=w*.78,t=r*.045,front=Math.max(L.max.z,R.max.z)+r*.035,y=(lc.y+rc.y)/2;
 const g=new THREE.Group(),ring=roundRect(w,h,h*.35);ring.holes.push(roundRect(w-2*t,h-2*t,(h-2*t)*.35));
 const ringGeo=new THREE.ExtrudeGeometry(ring,{depth:t*.8,bevelEnabled:false,curveSegments:6}),lensGeo=new THREE.ShapeGeometry(roundRect(w-2*t,h-2*t,(h-2*t)*.35),6);
 for(const x of [lc.x,rc.x]){const f=new THREE.Mesh(ringGeo,frame);f.position.set(x,y,front);const l=new THREE.Mesh(lensGeo,glass);l.position.set(x,y,front+t*.3);g.add(f,l);}
 const bridgeLen=Math.max(gap-w,t),bridge=new THREE.Mesh(new THREE.BoxGeometry(bridgeLen+t,t*.9,t*.8),frame);bridge.position.set((lc.x+rc.x)/2,y+h*.18,front+t*.4);g.add(bridge);
 // Patillas: del borde de afuera de cada lente al costado de la cabeza, y de ahí hacia atrás hasta la oreja.
 const side=r*.93,earZ=hc.z-r*.1;
 for(const sgn of [-1,1]){const ex=(sgn<0?lc.x:rc.x)+sgn*w/2,hinge=new THREE.Mesh(new THREE.BoxGeometry(Math.abs(hc.x+sgn*side-ex)+t,t*.9,t*.8),frame);
  hinge.position.set((ex+hc.x+sgn*side)/2,y+h*.18,front+t*.4);const arm=new THREE.Mesh(new THREE.BoxGeometry(t*.8,t*.9,front-earZ),frame);arm.position.set(hc.x+sgn*side,y+h*.18,(front+earZ)/2);g.add(hinge,arm);}
 put(g,head);}

// La mochila: cuerpo de cantos redondeados pegado a la espalda, tapa, bolsillo y dos correas sobre los hombros.
function backpack(o,torso,root,r,put,top){
 if(!torso||!top.length)return;const bp=torso.getWorldPosition(new THREE.Vector3()),abd=root.getObjectByName('Abdomen');
 // El tronco sin los brazos: la columna del medio de la ropa (en x, cerca del hueso).
 const col=v=>Math.abs(v.x-bp.x)<r*.5;
 const trunk=boneBox(top,torso,col).union(boneBox(top,abd,col));if(trunk.isEmpty())return;
 const sh=boneBox(top,torso,v=>{const d=Math.abs(v.x-bp.x);return d>r*.3&&d<r*.75;});
 const back=trunk.min.z,front=trunk.max.z,tTop=trunk.max.y,tH=trunk.max.y-trunk.min.y,shoulderY=sh.isEmpty()?tTop:sh.max.y;
 const c=colorOf('mochila',o.mochilaColor,'café'),body=accMat(c),dark=accMat(shade(c,.72)),light=accMat(shade(c,1.12));
 const W=r*1.15,H=Math.min(tH*.92,r*1.45),D=r*.42,cy=shoulderY-H/2-r*.04,cz=back-D/2+r*.03;
 const g=new THREE.Group(),box=(w,h,d,rr,m,x,y,z)=>{const b=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,3,rr),m);b.position.set(x,y,z);g.add(b);return b;};
 box(W,H,D,r*.12,body,bp.x,cy,cz);
 box(W*1.03,H*.34,D*1.06,r*.1,dark,bp.x,cy+H*.33,cz-D*.02);// la tapa
 box(W*.66,H*.3,D*.4,r*.07,light,bp.x,cy-H*.18,cz-D/2-D*.16);// el bolsillo
 // Correas: sobre cada hombro (de la espalda al pecho) y bajando por adelante.
 const sw=r*.17,st=r*.05;
 for(const sgn of [-1,1]){const x=bp.x+sgn*W*.28;
  const over=new THREE.Mesh(new THREE.BoxGeometry(sw,st,front-back+st*2),dark);over.position.set(x,shoulderY+st*.4,(front+back)/2);
  const down=new THREE.Mesh(new THREE.BoxGeometry(sw,tH*.5,st),dark);down.position.set(x,shoulderY-tH*.25,front+st*.4);g.add(over,down);}
 put(g,torso);}

// ---------- Una sola malla por persona ----------
// Vestida, una persona son unas 8 mallas y unas 20 zonas de color: cada zona es un dibujo por cuadro. bake() las funde en
// UNA malla con el color en cada vértice y un material compartido por todos (un dibujo por persona), atada al mismo
// esqueleto. Entran también los accesorios (gorra, gafas, mochila): se pasan al espacio de atado del hueso al que están
// pegados (peso 1 en ese hueso). Las zonas escondidas y las partes invisibles no entran.
const BAKED_MAT=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8,metalness:0});
export function bake(root){
 const skinned=[];root.traverse(o=>{if(o.isSkinnedMesh&&o.visible&&!o.userData.baked)skinned.push(o);});if(!skinned.length)return null;
 const ref=skinned.find(m=>m.userData.part==='Skin')||skinned[0],bones=ref.skeleton.bones,bi=new Map(bones.map((b,i)=>[b.name,i]));
 root.updateMatrixWorld(true);const pos=[],nor=[],col=[],si=[],sw=[],idx=[],v=new THREE.Vector3(),n=new THREE.Vector3(),c=new THREE.Color();
 const push=(x,y,z,nx,ny,nz,color,j,w)=>{pos.push(x,y,z);nor.push(nx,ny,nz);col.push(color.r,color.g,color.b);si.push(...j);sw.push(...w);return pos.length/3-1;};
 for(const m of skinned){const g=m.geometry,P=g.attributes.position,N=g.attributes.normal,J=g.attributes.skinIndex,W=g.attributes.skinWeight,I=g.index?g.index.array:[...Array(P.count).keys()];
  const mats=Array.isArray(m.material)?m.material:[m.material],groups=g.groups.length?g.groups:[{start:0,count:I.length,materialIndex:0}],map=new Map();
  // Los huesos de esta malla, por nombre, en el orden del esqueleto de referencia.
  const remap=m.skeleton.bones.map(b=>bi.get(b.name)??0);
  for(const gr of groups){const mt=mats[gr.materialIndex]??mats[0];if(!mt||mt.visible===false)continue;c.copy(mt.color||new THREE.Color('#ccc'));
   for(let k=gr.start;k<gr.start+gr.count;k++){const i=I[k],key=i+'|'+gr.materialIndex;let o=map.get(key);
    if(o===undefined){o=push(P.getX(i),P.getY(i),P.getZ(i),N?N.getX(i):0,N?N.getY(i):1,N?N.getZ(i):0,c,[remap[J.getX(i)],remap[J.getY(i)],remap[J.getZ(i)],remap[J.getW(i)]],[W.getX(i),W.getY(i),W.getZ(i),W.getW(i)]);map.set(key,o);}
    idx.push(o);}}}
 // Accesorios: del mundo (pose actual) al espacio de atado de su hueso.
 for(const a of root.userData.acc||[]){const bone=a.parent;const j=bi.get(bone?.name);if(j===undefined)continue;
  const toBind=new THREE.Matrix4().copy(ref.bindMatrix).invert().multiply(ref.skeleton.boneInverses[j].clone().invert()).multiply(bone.matrixWorld.clone().invert());
  a.updateMatrixWorld(true);a.traverse(o=>{if(!o.isMesh||o.material?.visible===false)return;const g=o.geometry,P=g.attributes.position,N=g.attributes.normal,I=g.index?g.index.array:[...Array(P.count).keys()];
   const M=new THREE.Matrix4().multiplyMatrices(toBind,o.matrixWorld),NM=new THREE.Matrix3().getNormalMatrix(M);c.copy(o.material.color);
   if(o.material.transparent)c.lerp(new THREE.Color('#ffffff'),.6);// el vidrio de las gafas: claro, sin transparencia
   const base=pos.length/3;for(let i=0;i<P.count;i++){v.fromBufferAttribute(P,i).applyMatrix4(M);n.fromBufferAttribute(N,i).applyMatrix3(NM).normalize();push(v.x,v.y,v.z,n.x,n.y,n.z,c,[j,0,0,0],[1,0,0,0]);}
   for(const i of I)idx.push(base+i);});}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));
 g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(si,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(sw,4));
 g.setIndex(idx);const out=new THREE.SkinnedMesh(g,BAKED_MAT);out.userData.baked=true;out.frustumCulled=false;out.castShadow=true;
 ref.parent.add(out);out.bind(ref.skeleton,ref.bindMatrix);
 for(const m of skinned)m.visible=false;for(const a of root.userData.acc||[])a.visible=false;
 root.userData.bakedMesh=out;return out;}
