/* Los edificios de la ciudad de /demo, armados con piezas del «Downtown City MegaKit» de Quaternius (CC0, versión
   Standard, public/models/downtown). Cada pieza de pared mide 2 m (o 4 m) de ancho y 3 m de alto, con el frente hacia +z
   en z=0 y la cara interior 20 cm hacia adentro: dos piezas cubren un lado de una casilla (4 m) y una pieza es un piso.

   Las texturas del paquete vienen a 2048 px con tres mapas por material; acá se usan copias de 1024 px en JPG
   (public/models/downtown/web/, hechas con sips) y sin el mapa ORM: pesan unas 20 veces menos. Al leer cada .gltf se le
   pasa una imagen vacía en lugar de sus PNG, y los materiales se arman una sola vez, compartidos por todas las piezas.

   Los edificios son huecos y tienen sus pisos de verdad (vacíos): las piezas de «interior falso» que van detrás del
   vidrio no se dibujan, así que por las ventanas se ve hacia afuera y hacia adentro, y entra la luz. De noche algunos
   pisos quedan encendidos: su vidrio brilla cálido. */
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {FACADE_PIECES} from '../engine/fachada.js';
import {ES_DE_FACHADA,piezaLowPoly,medidasDePartes,PARED,PUERTA_DOBLE,puertaDobleLowPoly,MARQUESINA,marquesinaLowPoly,VENTANAL,ventanalLowPoly} from './fachada3d.js';
import {VIDRIO_VENTANAL} from '../engine/fachada.js';
import {PUERTA} from '../engine/medidas.js';

const BASE='/models/downtown/Exports/'+encodeURIComponent('glTF (Godot)')+'/',WEB='/models/downtown/web/';
const BLANK='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

// Estilos de fachada: qué pieza va en la planta baja (vidriera o pared), en la puerta, en los pisos de arriba (cada
// opción con su ancho), en un muro ciego, en la cornisa y en las esquinas.
export const STYLES={
 ladrillo:{ground:[['Metal_FirstFloor_Window',2],['Brick_BottomTrim',2]],door:'DoorFrame_Wooden',
  upper:[[['Brick_Window_Trim',2]],[['Brick_Window_Trim_Single',2]],[['Brick_Window_Trim',2],['Brick_Plain_3',2]]],plain:['Brick_Plain_3',2],plain2:'Brick_Plain_3',single:'Brick_Window_Trim_Single',cornice:'Cornice_Brick_Center',column:'Trim_Column_Center',leaf:'Door_1'},
 claro:{ground:[['Metal_FirstFloor_Window',2],['Trim_FirstFloor_Wall',2]],door:'DoorFrame_Trim',
  upper:[[['Brick_Window_Square_Single',2]],[['Brick_RedWhite_DoubleWindow',4]],[['Brick_Window_CurvedDouble',4]],[['Brick_Inset_Window_Curved',4]],[['Brick_Inset_Window',4]]],plain:['Brick_Inset',4],plain2:'Brick_TopTrim',single:'Brick_Window_Square_Single',cornice:'Cornice_Trim_Center',column:'Trim_Column_Center',leaf:'Door_3'},
 piedra:{ground:[['Trim_FirstFloor_Window_001',2],['Trim_FirstFloor_Wall',2]],door:'DoorFrame_Trim',
  upper:[[['Trim_Window',2]],[['Trim_Window',2],['Trim_Plain_3',2]]],plain:['Trim_Plain_3',2],plain2:'Trim_Plain_3',single:'Trim_Window',cornice:'Cornice_Trim_Center',column:'Trim_Column_Center',leaf:'Door_3',tint:true},
 metal:{ground:[['Metal_FirstFloor_Window',2],['Metal_FirstFloor_Wall',2]],door:'DoorFrame_Metal_Single',
  upper:[[['Metal_FullWindow',2]],[['Metal_Window_Half',2]],[['Metal_Window',4]]],plain:['Metal_Plain_3',2],plain2:'Metal_Plain_3',single:'Metal_FullWindow',cornice:'Cornice_Metal_Center',column:'Metal_Column_Center',leaf:'Door_2'},
};
const EXTRA=['Floor_4x4','Roof_4x4','Brick_InteriorWall_3','Brick_InteriorWall_1'];
const PIECES=[...new Set([...Object.values(STYLES).flatMap(s=>[...s.ground.map(g=>g[0]),s.door,...s.upper.flat().map(u=>u[0]),s.plain[0],s.plain2,s.single,s.cornice,s.column,s.leaf]),...EXTRA,...FACADE_PIECES])];

// Cada material del paquete: sus texturas (de web/) y cómo se ve sin el mapa ORM.
const MATS={
 MI_RedBrick:['T_RedBrick'],MI_RedBrick_Pale:['T_RedBrick'],MI_InteriorWall:['T_Concrete',{color:'#ece5d8',plain:true}],MI_Trim:['T_Trim'],MI_Trim_Dark:['T_Trim'],MI_Trim_Green:['T_Trim'],
 MI_Trim_MetalConcrete:['T_MetalConcrete',{metalness:.25,roughness:.6}],MI_Concrete:['T_Concrete'],MI_InteriorRoof:['T_Concrete',{color:'#f3efe7',plain:true}],MI_Asphalt:['T_Concrete_Asphalt',{normal:'T_Concrete'}],
 MI_InteriorFloor:['T_MarbleFloor',{roughness:.45}],MI_Roof_Slate:['T_RoofSlate'],MI_Ornaments:['T_Ornaments'],MI_Dirt:['T_Dirt'],
};
const BOUNCE_DAY='#6b665e',BOUNCE_PLAIN='#4d4840',BOUNCE_NIGHT='#1c1a17';
// LOWPOLY (2026-10-16, Miguel: «quitar todas las texturas y usar colores, acorde al estilo low poly»): cada material del
// paquete, un color plano con caras planas —sin la foto, sin el relieve (normalMap) ni el brillo por textura—; el tinte
// de cada edificio (sus colores del 2D, color.js) lo pinta tal cual. BASE: el color de cada material sin tinte.
export const LOWPOLY={on:true,BASE:{MI_RedBrick:'#d9765f',MI_RedBrick_Pale:'#e8a58f',MI_InteriorWall:'#ece5d8',MI_Trim:'#f4efe4',MI_Trim_Dark:'#5d6266',MI_Trim_Green:'#5f8f6a',
 MI_Trim_MetalConcrete:'#9aa3a8',MI_Concrete:'#c9c4bb',MI_InteriorRoof:'#f3efe7',MI_Asphalt:'#9b958d',MI_InteriorFloor:'#d8cdbd',MI_Roof_Slate:'#6e6a72',MI_Ornaments:'#f4efe4',MI_Dirt:'#8a7a62',MI_Marco:'#f4efe4',MI_Zocalo:'#5d6266',MI_Blanco:'#f6f5f0',MI_Cruz:'#d0312d'}};

let cache=null;
export function loadDowntown(){
 if(cache)return cache;
 const manager=new THREE.LoadingManager();manager.setURLModifier(u=>/\.png$/i.test(u)?BLANK:u);
 const loader=new GLTFLoader(manager),pieces={};
 cache=Promise.all(PIECES.map(n=>loader.loadAsync(BASE+n+'.gltf').then(g=>{
  const parts=[];g.scene.updateMatrixWorld(true);
  g.scene.traverse(o=>{if(!o.isMesh)return;const geo=o.geometry.clone().applyMatrix4(o.matrixWorld);
   for(const k of Object.keys(geo.attributes))if(!['position','normal','uv'].includes(k))geo.deleteAttribute(k);
   if(!geo.index)geo.setIndex([...Array(geo.attributes.position.count).keys()]);
   parts.push({geo,mat:o.material.name,color:o.material.color.clone()});});
  pieces[n]={parts};}).catch(()=>{})))
  .then(()=>{if(LOWPOLY.on){for(const n of Object.keys(pieces))if(ES_DE_FACHADA(n))pieces[n]=lowPolyDe(n,pieces[n]);
   // (la puerta doble, una por material de muro: town3d.js la pide con el de su fachada)
   for(const m of PARED)pieces[PUERTA_DOBLE(m)]=deCajas(puertaDobleLowPoly(m,PUERTA.doble.ancho));
   for(const t of ['urgencias','hotel'])pieces[MARQUESINA(t)]=deCajas(marquesinaLowPoly(t));
   for(const m of PARED)pieces[VENTANAL(m)]=deCajas(ventanalLowPoly(m,VIDRIO_VENTANAL));}return Object.keys(pieces).length>=PIECES.length*.8?{pieces}:null;});
 return cache;
}

// La pieza low poly propia (fachada3d.js) en el formato del paquete: una geometría por material, con la misma huella.
function lowPolyDe(nombre,piece){
 const parts=piece.parts.filter(p=>!p.mat.startsWith('MI_FakeInterior')).map(p=>{p.geo.computeBoundingBox();const b=p.geo.boundingBox;return {mat:p.mat,box:{min:b.min.toArray(),max:b.max.toArray()}};});
 return deCajas(piezaLowPoly(nombre,medidasDePartes(parts)));}
function deCajas(cajas){const porMat=new Map();
 for(const c of cajas){const g=new THREE.BoxGeometry(c.x1-c.x0,c.y1-c.y0,c.z1-c.z0).translate((c.x0+c.x1)/2,(c.y0+c.y1)/2,(c.z0+c.z1)/2);(porMat.get(c.mat)||porMat.set(c.mat,[]).get(c.mat)).push(g);}
 return {parts:[...porMat].map(([mat,gs])=>{const geo=mergeGeometries(gs,false);for(const g of gs)g.dispose();return {geo,mat,color:new THREE.Color('#ffffff')};}),lowpoly:true,cajas};}

function textures(){
 const tl=new THREE.TextureLoader(),seen=new Map();
 // Versión en gris claro de una textura (para pintar el ladrillo de cualquier color sin perder su dibujo).
 const gray=name=>{const key=name+'#gris';if(seen.has(key))return seen.get(key);const t=new THREE.Texture();t.flipY=false;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;
  new THREE.ImageLoader().load(WEB+name+'.jpg',img=>{const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const g=c.getContext('2d');g.drawImage(img,0,0);
   // El gris se normaliza a un brillo promedio de 82 % (con el dibujo de la textura): así el color que se pinta sale como
   // es, en vez de oscurecido por una textura de gris medio.
   const d=g.getImageData(0,0,c.width,c.height),a=d.data;let sum=0;for(let i=0;i<a.length;i+=4)sum+=(a[i]*.3+a[i+1]*.59+a[i+2]*.11)/255;const mean=sum/(a.length/4)||.5;
   for(let i=0;i<a.length;i+=4){const l=(a[i]*.3+a[i+1]*.59+a[i+2]*.11)/255,v=Math.min(255,(.82+(l-mean)*.9)*255);a[i]=a[i+1]=a[i+2]=v;}
   g.putImageData(d,0,0);t.image=c;t.needsUpdate=true;});seen.set(key,t);return t;};
 const get=(name,srgb=true)=>{if(seen.has(name))return seen.get(name);const t=tl.load(WEB+name+'.jpg');t.flipY=false;t.wrapS=t.wrapT=THREE.RepeatWrapping;
  if(srgb)t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;seen.set(name,t);return t;};
 get.gray=gray;return get;
}

/* items: [{piece, x, y, z, ry, tint?, lit?}]. Junta las piezas en una malla por material (y por tinte o encendido) y
   opcionalmente por zona de la ciudad (DOWNTOWN.zona m de lado), para que el motor descarte las que quedan fuera de la
   vista. */
// Medido (2026-10-11, 31337, cuatro vistas): zonas de 60 m (251 mallas) o 30 m (667) dibujan MÁS LENTO que una sola
// (38 mallas): las llamadas de dibujo de más cuestan más que los triángulos que se ahorran. Queda apagado (null).
export const DOWNTOWN={zona:null};
// El color de una pieza para un material: tint es un color (todo), {c, on} (el color en esos materiales) o {zones:
// [[color, materiales], …]} (pared, molduras y carpintería de fachada.js).
export const tintOf=(tint,mat)=>{if(!tint)return null;if(typeof tint==='string')return tint;if(tint.zones){for(const [c,on] of tint.zones)if(c&&on.includes(mat))return c;return null;}return tint.on?.includes(mat)?tint.c:null;};
// Las piezas de un balde, cada una con su matriz, en una sola geometría (2026-10-14): se transforman directo al arreglo
// final, sin clonar cada pieza y después copiarlas otra vez al juntar (así era la mitad del armado de la ciudad: ~340 ms).
// Las piezas del paquete traen posición, normal y uv, indexadas; si alguna no, va por el camino de siempre.
const SIMPLE=g=>g.index&&!Object.keys(g.morphAttributes).length&&Object.keys(g.attributes).length===3&&['position','normal','uv'].every(k=>{const a=g.attributes[k];return a&&!a.isInterleavedBufferAttribute&&a.array instanceof Float32Array;});
function bake(list){
 if(!list.every(([g])=>SIMPLE(g))){const gs=list.map(([g,m])=>g.clone().applyMatrix4(m)),geo=mergeGeometries(gs,false);for(const g of gs)g.dispose();return geo;}
 let nv=0,ni=0;for(const [g] of list){nv+=g.attributes.position.count;ni+=g.index.count;}
 const P=new Float32Array(nv*3),N=new Float32Array(nv*3),U=new Float32Array(nv*2),I=nv>65535?new Uint32Array(ni):new Uint16Array(ni),nm=new THREE.Matrix3();
 let v0=0,i0=0;
 for(const [g,m] of list){const p=g.attributes.position.array,n=g.attributes.normal.array,e=m.elements,c=g.attributes.position.count;nm.getNormalMatrix(m);const k=nm.elements;
  for(let i=0;i<c;i++){const x=p[i*3],y=p[i*3+1],z=p[i*3+2],w=1/(e[3]*x+e[7]*y+e[11]*z+e[15]),o=(v0+i)*3;
   P[o]=(e[0]*x+e[4]*y+e[8]*z+e[12])*w;P[o+1]=(e[1]*x+e[5]*y+e[9]*z+e[13])*w;P[o+2]=(e[2]*x+e[6]*y+e[10]*z+e[14])*w;
   const a=n[i*3],b=n[i*3+1],d=n[i*3+2],nx=k[0]*a+k[3]*b+k[6]*d,ny=k[1]*a+k[4]*b+k[7]*d,nz=k[2]*a+k[5]*b+k[8]*d,l=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
   N[o]=nx/l;N[o+1]=ny/l;N[o+2]=nz/l;}
  U.set(g.attributes.uv.array,v0*2);const ix=g.index.array;for(let j=0;j<ix.length;j++)I[i0+j]=ix[j]+v0;v0+=c;i0+=ix.length;}
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(P,3));geo.setAttribute('normal',new THREE.BufferAttribute(N,3));geo.setAttribute('uv',new THREE.BufferAttribute(U,2));geo.setIndex(new THREE.BufferAttribute(I,1));return geo;}

export function buildDowntown(kit,items,leaves=[]){
 const tex=textures(),mats=new Map(),buckets=new Map(),group=new THREE.Group(),own=[],litMats=[],bounce=[];
 const material=(name,color,tint,lit)=>{
  const key=name+'|'+(tint||'')+'|'+(name==='MI_Glass'?lit>=0:'');if(mats.has(key))return key;
  let m;
  if(name==='MI_Glass'){m=new THREE.MeshStandardMaterial({color:'#9fb4c2',transparent:true,opacity:.22,roughness:.05,metalness:.1,depthWrite:false,emissive:new THREE.Color(0)});if(lit>=0)litMats.push(m);}
  else if(LOWPOLY.on){const o=(MATS[name]||[])[1]||{};m=new THREE.MeshStandardMaterial({color:tint||LOWPOLY.BASE[name]||'#c9c4bb',roughness:o.roughness??.9,metalness:o.metalness??0,flatShading:true,side:THREE.DoubleSide});
   // (adentro, sin lámparas: un rebote parejo del mismo tono, en vez del de la textura)
   if(/^MI_Interior/.test(name)){m.emissive=new THREE.Color(o.plain?BOUNCE_PLAIN:BOUNCE_DAY);m.userData.day=o.plain?BOUNCE_PLAIN:BOUNCE_DAY;bounce.push(m);}}
  else{const [base,o={}]=MATS[name]||['T_Concrete'];m=new THREE.MeshStandardMaterial({map:o.plain?null:tint&&(base==='T_RedBrick'||base==='T_MetalConcrete'||base==='T_Trim')?tex.gray(base+'_BaseColor'):tex(base+'_BaseColor'),normalMap:tex((o.normal||base)+'_Normal',false),color:color.clone(),
   roughness:o.roughness??.88,metalness:o.metalness??0,side:THREE.DoubleSide});
   // El cielo raso, sin luces adentro, quedaba casi negro: se aclara y brilla apenas, como si la luz entrara por las vidrieras.
   if(o.color)m.color.set(o.color);
   // Adentro no hay lámparas y el sol entra sólo por las ventanas: sin más, los pisos quedaban en penumbra. Paredes,
   // pisos y cielos rasos interiores brillan apenas con su propia textura, como la luz que rebota (de noche, menos).
   // Paredes y cielos rasos: revoque claro liso (la textura de concreto del paquete es gris oscura).
   if(/^MI_Interior/.test(name)){m.emissiveMap=m.map;m.emissive=new THREE.Color(o.plain?BOUNCE_PLAIN:BOUNCE_DAY);m.userData.day=o.plain?BOUNCE_PLAIN:BOUNCE_DAY;bounce.push(m);}
   // (el revoque liso toma el color tal cual: multiplicado por el claro de base, los tonos salían sucios)
   if(tint){if(o.plain)m.color.set(tint);else m.color.multiply(new THREE.Color(tint));}}
  mats.set(key,m);own.push(m);return key;};
 const mtx=new THREE.Matrix4(),q=new THREE.Quaternion(),Y=new THREE.Vector3(0,1,0),one=new THREE.Vector3(1,1,1),sc=new THREE.Vector3(),p=new THREE.Vector3();
 for(const it of items){const piece=kit.pieces[it.piece];if(!piece)continue;
  mtx.compose(p.set(it.x,it.y,it.z),q.setFromAxisAngle(Y,it.ry||0),sc.set(it.sx||1,it.sy||1,it.sz||1));const M=mtx.clone();
  for(const part of piece.parts){if(part.mat.startsWith('MI_FakeInterior'))continue;
   // El color del edificio va sólo en sus paredes (tint.on); el resto queda con su color.
   const tint=tintOf(it.tint,part.mat);
   const key=material(part.mat,part.color,tint,it.lit??-1)+(DOWNTOWN.zona?'@'+Math.floor(it.x/DOWNTOWN.zona)+','+Math.floor(it.z/DOWNTOWN.zona):'')+'§'+(it.lote??-1);(buckets.get(key)||buckets.set(key,[]).get(key)).push([part.geo,M]);}}
 // Hojas de puerta (1 m × 2,2 m, con la bisagra en su origen): instancias que se abren hacia adentro cuando alguien
 // se acerca a menos de 2,5 m y se cierran solas. No se suman a las mallas juntadas porque se mueven.
 const doors=leaves.map(l=>({...l,a:0})),inst=[],byPiece=new Map();
 // (por pieza y color: cada edificio pinta su puerta con su carpintería)
 doors.forEach((d,i)=>{const k=d.piece+'|'+(tintOf(d.tint,'MI_Trim_MetalConcrete')||'');(byPiece.get(k)||byPiece.set(k,[]).get(k)).push(i);});
 // (sx: el ancho de la hoja —las de la puerta doble, la mitad—; dir: hacia dónde abre —la espejada, al revés—)
 const place=(im,j,d)=>{mtx.compose(p.set(d.x,d.y,d.z),q.setFromAxisAngle(Y,d.ry-(d.dir||1)*d.a*Math.PI*.47),sc.set(d.sx||1,1,1));im.setMatrixAt(j,mtx);};
 const refresh=()=>{for(const {im,idx} of inst){idx.forEach((i,j)=>place(im,j,doors[i]));im.instanceMatrix.needsUpdate=true;}};
 for(const [key,idx] of byPiece){const name=key.split('|')[0],piece=kit.pieces[name];if(!piece)continue;const lt=doors[idx[0]].tint;
  for(const part of piece.parts){const m=mats.get(material(part.mat,part.color,tintOf(lt,part.mat),-1)),im=new THREE.InstancedMesh(part.geo,m,idx.length);
   im.castShadow=!m.transparent;im.receiveShadow=true;im.frustumCulled=false;if(m.transparent)im.renderOrder=1;group.add(im);inst.push({im,idx});}}
 refresh();
 // Por material, una BatchedMesh con una pieza por lote (2026-10-16, «sólo dibujar lo que se ve»): una sola llamada de
 // dibujo por material, como antes de partir (con zonas de mallas sueltas, las llamadas de más costaban más que lo que
 // ahorraban), pero three.js descarta por cámara cada pieza —un lote— y setVisibles apaga los lotes que no se ven desde
 // adentro (engine/visibles.js).
 // (el lote va después de §: la clave del material lleva colores con #)
 let triangles=0;const porMat=new Map(),piezas=[];
 for(const [key,list] of buckets){const geo=bake(list);if(!geo)continue;triangles+=geo.index.count/3;const mk=key.split('§')[0],lote=+key.split('§')[1];(porMat.get(mk)||porMat.set(mk,[]).get(mk)).push({geo,lote});}// (la geometría se copia a la BatchedMesh: no se guarda)
 for(const [key,list] of porMat){const m=mats.get(key.split('@')[0]),nv=list.reduce((a,g)=>a+g.geo.attributes.position.count,0),ni=list.reduce((a,g)=>a+g.geo.index.count,0);
  const bm=new THREE.BatchedMesh(list.length,nv,ni,m);bm.sortObjects=!!m.transparent;
  for(const {geo,lote} of list){const gid=bm.addGeometry(geo),iid=bm.addInstance(gid);piezas.push({bm,iid,lote});}
  // El contorno gris (edges3d.js) va sólo por dentro: paredes, pisos y cielos rasos interiores.
  if(/^MI_Interior/.test(key))bm.userData.edges=true;bm.castShadow=!m.transparent;bm.receiveShadow=true;if(m.transparent)bm.renderOrder=1;group.add(bm);own.push(bm);}
 let visibles=null;
 const setVisibles=set=>{if(set===visibles)return;visibles=set;for(const p of piezas)p.bm.setVisibleAt(p.iid,!set||set.has(p.lote));};
 return {group,triangles,meshes:group.children.length,doors:doors.length,setVisibles,lotesConPiezas:()=>new Set(piezas.map(p=>p.lote)),
  // people: [{x,z}]. Abre las puertas con alguien cerca; sólo se recalculan si alguna se movió.
  updateDoors(dt,people){let moved=false;for(const d of doors){const near=people.some(o=>(o.x-d.cx)**2+(o.z-d.cz)**2<6.25&&(d.cy==null||Math.abs((o.feet??o.y??0)-d.cy)<2)),a=near?Math.min(1,d.a+dt*2.5):Math.max(0,d.a-dt*1.4);if(a!==d.a){d.a=a;moved=true;}}if(moved)refresh();},
  setNight(on){for(const m of bounce)m.emissive.set(on?BOUNCE_NIGHT:m.userData.day);for(const m of litMats){m.emissive.set(on?'#ffc777':0);m.emissiveIntensity=on?.9:0;m.opacity=on?.55:.22;}},
  dispose(){for(const o of own)o.dispose();}};
}
