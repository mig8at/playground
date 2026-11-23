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
import {TEXTURAS3D,TEXTURA_FIJA,texturaPared,texturaDe,uvDelMundo} from './texturas3d.js';
import {ACABADO,ES_DE_FACHADA,piezaLowPoly,medidasDePartes,PARED,PUERTA_DOBLE,puertaDobleLowPoly,MARQUESINA,marquesinaLowPoly,VENTANAL,ventanalLowPoly} from './fachada3d.js';
import {VIDRIO_VENTANAL} from '../engine/fachada.js';
import {PUERTA} from '../engine/medidas.js';
import {PELICULA} from '../engine/cortinas.js';
import {COLOR} from '../engine/colores.js';

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
 return deCajas(piezaLowPoly(nombre,medidasDePartes(parts)),nombre);}
// (2026-11-21: las cajas de PARED —la capa de afuera del muro, de ACABADO.capa de espesor, o una columna entera— van
// aparte de las demás del mismo material, marcadas `pared`: son las que llevan textura —texturas3d.js—; un marco o una
// puerta del mismo material sigue liso)
const esPared=(c,columna)=>PARED.includes(c.mat)&&(columna||Math.abs(c.z1)<.02&&Math.abs(c.z1-c.z0-ACABADO.capa)<.02);
function deCajas(cajas,nombre=''){const porMat=new Map(),columna=/Column/.test(nombre);
 for(const c of cajas){const g=new THREE.BoxGeometry(c.x1-c.x0,c.y1-c.y0,c.z1-c.z0).translate((c.x0+c.x1)/2,(c.y0+c.y1)/2,(c.z0+c.z1)/2),k=c.mat+(esPared(c,columna)?'§pared':'');(porMat.get(k)||porMat.set(k,[]).get(k)).push(g);}
 return {parts:[...porMat].map(([k,gs])=>{const geo=mergeGeometries(gs,false);for(const g of gs)g.dispose();const [mat,pared]=k.split('§');return {geo,mat,pared:!!pared,color:new THREE.Color('#ffffff')};}),lowpoly:true,cajas};}

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
// El vidrio de una ventana según su estado: [color, alfa]. Cerrada, la película lechosa —engine/cortinas.js PELICULA—, opaca;
// abierta, el vidrio claro —engine/colores.js—; rojo y azul, la marca de lo que se ve (?portales=1): roja, abierta y vista —su
// interior se arma—; azul, abierta a la vista pero tapada por otro edificio.
export const VIDRIO={cerrada:[PELICULA.color,1],abierta:[COLOR.material.vidrio,.28],rojo:['#ff2a2a',.55],azul:['#2a7bff',.55]};
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

// (la buhardilla de la mansarda, recortada por la pendiente —2026-11-22, Miguel, desde adentro de un penthouse: «quita los
// polígonos que no aportan»—: su moldura atravesaba el plano de la pizarra —z = −y/3 en la pieza: de la base, en z = 0, a la
// cornisa, en z = −1 y 3 m de alto— y por dentro asomaban orejas y un costado hasta el piso. Se quedan sólo los triángulos de
// afuera; la pizarra y el vidrio, enteros. Una vez por pieza)
// (cada triángulo se corta exacto por el plano —d = z + y/3, adentro si d < 0—: lo de afuera queda, con su normal y su uv)
function recortarBuhardilla(piece){if(piece._recortada)return;piece._recortada=true;
 for(const part of piece.parts){if(part.mat==='MI_Roof_Slate'||part.mat==='MI_Glass')continue;part.geo=cortarPorPendiente(part.geo);}}
function cortarPorPendiente(geo){{const g=geo.index?geo.toNonIndexed():geo;
  const P=g.attributes.position.array,N=g.attributes.normal?.array,U=g.attributes.uv?.array,oP=[],oN=[],oU=[],d=i=>P[i*3+2]+P[i*3+1]/3+.005;
  const vtx=(i,j,t)=>({p:[0,1,2].map(k=>P[i*3+k]+(P[j*3+k]-P[i*3+k])*t),n:N?[0,1,2].map(k=>N[i*3+k]+(N[j*3+k]-N[i*3+k])*t):null,u:U?[0,1].map(k=>U[i*2+k]+(U[j*2+k]-U[i*2+k])*t):null});
  for(let t=0;t<P.length/3;t+=3){const ids=[t,t+1,t+2],ds=ids.map(d);if(ds.every(x=>x>=0)){for(const i of ids){oP.push(P[i*3],P[i*3+1],P[i*3+2]);if(N)oN.push(N[i*3],N[i*3+1],N[i*3+2]);if(U)oU.push(U[i*2],U[i*2+1]);}continue;}if(ds.every(x=>x<0))continue;
   // (Sutherland–Hodgman contra un plano: el polígono de afuera, en abanico)
   const poly=[];for(let k=0;k<3;k++){const a=ids[k],b=ids[(k+1)%3],da=ds[k],db=ds[(k+1)%3];if(da>=0)poly.push(vtx(a,a,0));if((da>=0)!==(db>=0))poly.push(vtx(a,b,da/(da-db)));}
   for(let k=1;k+1<poly.length;k++)for(const v of [poly[0],poly[k],poly[k+1]]){oP.push(...v.p);if(N)oN.push(...v.n);if(U)oU.push(...v.u);}}
  const ng=new THREE.BufferGeometry();ng.setAttribute('position',new THREE.Float32BufferAttribute(oP,3));if(N)ng.setAttribute('normal',new THREE.Float32BufferAttribute(oN,3));if(U)ng.setAttribute('uv',new THREE.Float32BufferAttribute(oU,2));
  ng.setIndex([...Array(oP.length/3).keys()]);return ng;}}

// LA BUHARDILLA MODERNA DEL DÚPLEX (2026-11-22, Miguel: «ventanas más modernas en los dúplex, para que se vea más bonito y
// moderno»): una caja de techo plano en metal oscuro —los costados y el techo de 6 cm— con un solo paño de vidrio de 1 × 2,3 m
// y marco delgado, en vez del frontón clásico. Sale de la pizarra con su hueco de la buhardilla del paquete; las cajas se
// cortan por la pendiente como la otra, para que por dentro no atraviesen nada. Pocos polígonos: siete cajas
export const BUHARDILLA_MODERNA='Roof_Buhardilla_Moderna';
// (la distancia a la que un edificio pasa a su caja de lejos, y a la que vuelve su detalle: m)
export const LEJOS={lejos:120,cerca:100};
function buhardillaModerna(kit){if(kit.pieces[BUHARDILLA_MODERNA]||!kit.pieces['Roof_SlateCornice_Window_1'])return;const base=kit.pieces['Roof_SlateCornice_Window_1'];
 const B=(x0,x1,y0,y1,z0,z1)=>{const g=new THREE.BoxGeometry(x1-x0,y1-y0,z1-z0);g.translate((x0+x1)/2,(y0+y1)/2,(z0+z1)/2);return g;};
 const metal=mergeGeometries([B(-.62,.62,2.55,2.61,-.95,.06),B(-.62,-.56,.1,2.55,-.95,.06),B(.56,.62,.1,2.55,-.95,.06),B(-.62,.62,.08,.16,-.35,.08),B(-.56,.56,2.47,2.55,-.07,0),B(-.56,-.5,.16,2.47,-.07,0),B(.5,.56,.16,2.47,-.07,0)].map(g=>g.toNonIndexed()),false);
 const vidrio=B(-.5,.5,.16,2.47,-.045,-.03);
 const de=m=>base.parts.find(p=>p.mat===m),slate=de('MI_Roof_Slate'),gl=de('MI_Glass'),mt=de('MI_Trim_MetalConcrete')||de('MI_Trim');
 kit.pieces[BUHARDILLA_MODERNA]={...base,parts:[slate,{...(mt||{}),mat:'MI_Trim_MetalConcrete',geo:cortarPorPendiente(metal),color:mt?.color||new THREE.Color('#3a3d40')},{...(gl||{}),mat:'MI_Glass',geo:vidrio}].filter(p=>p&&p.geo)};}

export function buildDowntown(kit,items,leaves=[],{cascarones=[]}={}){
 for(const [n,pc] of Object.entries(kit.pieces||{}))if(/^Roof_SlateCornice_Window/.test(n))recortarBuhardilla(pc);
 if(kit.pieces)buhardillaModerna(kit);
 const tex=textures(),mats=new Map(),buckets=new Map(),group=new THREE.Group(),own=[],litMats=[],bounce=[];
 const material=(name,color,tint,lit,pared=false,textura=null)=>{
  // (pared: la capa de afuera de un muro; con TEXTURAS3D lleva la textura que le toca a su material y su color)
  const tx=TEXTURAS3D.on&&LOWPOLY.on?(pared?(textura||texturaDe(name,tint)):TEXTURA_FIJA[name]||null):null;// (textura: la que trae el edificio del plano)
  const key=name+'|'+(tint||'')+'|'+(name==='MI_Glass'?lit>=0:'')+(tx?'|T:'+tx:'');if(mats.has(key))return key;
  let m;
  if(name==='MI_Glass'){m=new THREE.MeshStandardMaterial({color:'#9fb4c2',transparent:true,opacity:.22,roughness:.05,metalness:.1,depthWrite:false,emissive:new THREE.Color(0)});if(lit>=0)litMats.push(m);}
  else if(LOWPOLY.on){const o=(MATS[name]||[])[1]||{};m=new THREE.MeshStandardMaterial({color:tint||LOWPOLY.BASE[name]||'#c9c4bb',roughness:o.roughness??.9,metalness:o.metalness??0,flatShading:true,side:THREE.DoubleSide});
   if(tx){const t=texturaPared(tx);m.map=t;m.bumpMap=t;m.bumpScale=1.2;m.userData.uvMundo=true;}
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
 const vidrioList=[];
 const mtx=new THREE.Matrix4(),q=new THREE.Quaternion(),Y=new THREE.Vector3(0,1,0),one=new THREE.Vector3(1,1,1),sc=new THREE.Vector3(),p=new THREE.Vector3();
 for(const it of items){const piece=kit.pieces[it.piece];if(!piece)continue;
  mtx.compose(p.set(it.x,it.y,it.z),q.setFromAxisAngle(Y,it.ry||0),sc.set(it.sx||1,it.sy||1,it.sz||1));const M=mtx.clone();
  for(const part of piece.parts){if(part.mat.startsWith('MI_FakeInterior'))continue;
   if(part.mat==='MI_Glass'&&it.vidrio&&SIMPLE(part.geo)){vidrioList.push({geo:part.geo,M,gid:it.vidrio,lote:it.lote??-1});continue;}// (el vidrio de una ventana, aparte: VIDRIO)
   // El color del edificio va sólo en sus paredes (tint.on); el resto queda con su color.
   const tint=tintOf(it.tint,part.mat);
   // (las molduras de la cornisa de la mansarda, de un solo lado: por fuera se ven igual y por dentro del dúplex no asoman.
   // Miguel, 2026-11-22: «mejora y quita los polígonos innecesarios». La buhardilla no: se recorta por la pendiente
   // —recortarBuhardilla— y queda de los dos lados, para que por dentro se vea su nicho con el marco)
   let k0=material(part.mat,part.color,tint,it.lit??-1,part.pared,it.tint?.textura);
   if(/^Roof_SlateCornice_(?!Window)/.test(it.piece)&&part.mat!=='MI_Roof_Slate'&&part.mat!=='MI_Glass'){const k1=k0+'|afuera';if(!mats.has(k1)){const m=mats.get(k0).clone();m.side=THREE.FrontSide;mats.set(k1,m);}k0=k1;}
   const key=k0+(DOWNTOWN.zona?'@'+Math.floor(it.x/DOWNTOWN.zona)+','+Math.floor(it.z/DOWNTOWN.zona):'')+'§'+(it.lote??-1);(buckets.get(key)||buckets.set(key,[]).get(key)).push([part.geo,M]);}}
 // (el vidrio de las hojas de puerta, opaco como el de una ventana cerrada —2026-11-22, Miguel: «al igual que las puertas con
 // vidrio»—: cerrada, la puerta no deja ver adentro; abierta, se ve por el hueco, y eso lo cuenta el motor —engine/portales.js—)
 let vpM=null;const vidrioPuerta=()=>{if(!vpM){vpM=new THREE.MeshStandardMaterial({color:VIDRIO.cerrada[0],roughness:.35,metalness:0});vpM.userData.plano=true;own.push(vpM);}return vpM;};
 // Hojas de puerta (1 m × 2,2 m, con la bisagra en su origen): instancias que se abren hacia adentro cuando alguien
 // se acerca a menos de 2,5 m y se cierran solas. No se suman a las mallas juntadas porque se mueven.
 const doors=leaves.map(l=>({...l,a:0})),inst=[],byPiece=new Map();
 // (por pieza y color: cada edificio pinta su puerta con su carpintería)
 doors.forEach((d,i)=>{const k=d.piece+'|'+(tintOf(d.tint,'MI_Trim_MetalConcrete')||'');(byPiece.get(k)||byPiece.set(k,[]).get(k)).push(i);});
 // (sx: el ancho de la hoja —las de la puerta doble, la mitad—; dir: hacia dónde abre —la espejada, al revés—)
 const place=(im,j,d)=>{mtx.compose(p.set(d.x,d.y,d.z),q.setFromAxisAngle(Y,d.ry-(d.dir||1)*d.a*Math.PI*.47),sc.set(d.sx||1,1,1));im.setMatrixAt(j,mtx);};
 const refresh=()=>{for(const {im,idx} of inst){idx.forEach((i,j)=>place(im,j,doors[i]));im.instanceMatrix.needsUpdate=true;}};
 for(const [key,idx] of byPiece){const name=key.split('|')[0],piece=kit.pieces[name];if(!piece)continue;const lt=doors[idx[0]].tint;
  for(const part of piece.parts){const m=part.mat==='MI_Glass'?vidrioPuerta():mats.get(material(part.mat,part.color,tintOf(lt,part.mat),-1)),im=new THREE.InstancedMesh(part.geo,m,idx.length);
   im.castShadow=!m.transparent;im.receiveShadow=true;im.frustumCulled=false;if(m.transparent)im.renderOrder=1;group.add(im);inst.push({im,idx});}}
 refresh();
 // Por material, una BatchedMesh con una pieza por lote (2026-10-16, «sólo dibujar lo que se ve»): una sola llamada de
 // dibujo por material, como antes de partir (con zonas de mallas sueltas, las llamadas de más costaban más que lo que
 // ahorraban), pero three.js descarta por cámara cada pieza —un lote— y setVisibles apaga los lotes que no se ven desde
 // adentro (engine/visibles.js).
 // (el lote va después de §: la clave del material lleva colores con #)
 let triangles=0;const porMat=new Map(),piezas=[];
 for(const [key,list] of buckets){const geo=bake(list);if(!geo)continue;if(mats.get(key.split('§')[0].split('@')[0])?.userData.uvMundo)uvDelMundo(geo);triangles+=geo.index.count/3;const mk=key.split('§')[0],lote=+key.split('§')[1];(porMat.get(mk)||porMat.set(mk,[]).get(mk)).push({geo,lote});}// (la geometría se copia a la BatchedMesh: no se guarda)
 for(const [key,list] of porMat){const m=mats.get(key.split('@')[0]),nv=list.reduce((a,g)=>a+g.geo.attributes.position.count,0),ni=list.reduce((a,g)=>a+g.geo.index.count,0);
  const bm=new THREE.BatchedMesh(list.length,nv,ni,m);bm.sortObjects=!!m.transparent;
  for(const {geo,lote} of list){const gid=bm.addGeometry(geo),iid=bm.addInstance(gid);piezas.push({bm,iid,lote});}
  // El contorno gris (edges3d.js) va sólo por dentro: paredes, pisos y cielos rasos interiores.
  if(/^MI_Interior/.test(key))bm.userData.edges=true;bm.castShadow=!m.transparent;bm.receiveShadow=true;if(m.transparent)bm.renderOrder=1;group.add(bm);own.push(bm);}
 // LOS VIDRIOS DE LAS VENTANAS (2026-11-22, Miguel: «en vez de un paño aparte, que permite ver de costado el interior, sea la
 // misma ventana la que cambie de color a transparente u opaco… y el rojo podría ir directamente en el vidrio, como un cambio
 // de color para la inspección»): una BatchedMesh con una instancia por vidrio —su clave, town3d item.vidrio—, cada una con su
 // color y su alfa (setColorAt con un Vector4: three lo multiplica en el color del material). setVidrio(clave, estado) lo cambia.
 const vidrios=new Map();let vidriosBM=null;const _c=new THREE.Color(),_v4=new THREE.Vector4();
 if(vidrioList.length){const geoId=new Map(),uni=[...new Set(vidrioList.map(v=>v.geo))],nv=uni.reduce((a,g)=>a+g.attributes.position.count,0),ni=uni.reduce((a,g)=>a+g.index.count,0);
  const m=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.3,metalness:0,transparent:true,depthWrite:false,side:THREE.DoubleSide});m.userData.plano=true;own.push(m);
  vidriosBM=new THREE.BatchedMesh(vidrioList.length,nv,ni,m);vidriosBM.sortObjects=true;vidriosBM.renderOrder=1;vidriosBM.castShadow=false;vidriosBM.receiveShadow=false;vidriosBM.name='vidrios';
  for(const g of uni)geoId.set(g,vidriosBM.addGeometry(g));
  for(const v of vidrioList){const iid=vidriosBM.addInstance(geoId.get(v.geo));vidriosBM.setMatrixAt(iid,v.M);(vidrios.get(v.gid)||vidrios.set(v.gid,[]).get(v.gid)).push(iid);piezas.push({bm:vidriosBM,iid,lote:v.lote});}
  group.add(vidriosBM);own.push(vidriosBM);}
 const setVidrio=(gid,estado)=>{const ids=vidrios.get(gid);if(!ids)return false;const [hex,a]=VIDRIO[estado]||VIDRIO.cerrada;_c.set(hex);_v4.set(_c.r,_c.g,_c.b,a);for(const i of ids)vidriosBM.setColorAt(i,_v4);return true;};
 for(const gid of vidrios.keys())setVidrio(gid,'cerrada');
 // LA CAJA DE LEJOS (2026-11-22, la versión baja de cada edificio, como en los juegos de Rockstar): cada lote tiene además su caja
 // —town3d cascarones: sus partes hasta su altura, con la mansarda—, en una BatchedMesh propia, una instancia por lote. Más allá
 // de LEJOS.lejos de la cámara se dibuja la caja y no sus piezas; vuelve el detalle más acá de LEJOS.cerca (el margen, para que
 // no parpadee en el borde). La distancia, al rectángulo del lote. setVisibles —lo que se ve desde adentro— manda sobre las dos.
 const cajaGeo=(cs)=>mergeGeometries(cs.map(c=>{const g=new THREE.BoxGeometry(c.w,c.h,c.d);g.translate(c.x,c.y+c.h/2,c.z);return g;}),false);
 const cajas=new Map();let cajasBM=null;
 if(cascarones.length){const geos=cascarones.map(c=>({lote:c.lote,geo:cajaGeo(c.cajas),rect:c.cajas.reduce((r,b)=>({x0:Math.min(r.x0,b.x-b.w/2),x1:Math.max(r.x1,b.x+b.w/2),z0:Math.min(r.z0,b.z-b.d/2),z1:Math.max(r.z1,b.z+b.d/2)}),{x0:1e9,x1:-1e9,z0:1e9,z1:-1e9})}));
  const nv=geos.reduce((t,g)=>t+g.geo.attributes.position.count,0),ni=geos.reduce((t,g)=>t+g.geo.index.count,0);
  cajasBM=new THREE.BatchedMesh(geos.length,nv,ni,new THREE.MeshStandardMaterial({color:'#e9e6df',roughness:.9,flatShading:true}));cajasBM.castShadow=true;cajasBM.receiveShadow=true;cajasBM.name='cajas de lejos';
  for(const g of geos){const iid=cajasBM.addInstance(cajasBM.addGeometry(g.geo));cajasBM.setVisibleAt(iid,false);cajas.set(g.lote,{iid,rect:g.rect});g.geo.dispose();}
  group.add(cajasBM);own.push(cajasBM);}
 let visibles=null;const lejos=new Set();
 const aplicar=()=>{for(const p of piezas)p.bm.setVisibleAt(p.iid,(!visibles||visibles.has(p.lote))&&!lejos.has(p.lote));
  if(cajasBM)for(const [lote,c] of cajas)cajasBM.setVisibleAt(c.iid,(!visibles||visibles.has(lote))&&lejos.has(lote));};
 const setVisibles=set=>{if(set===visibles)return;visibles=set;aplicar();};
 const setLejos=(x,z)=>{if(!cajasBM)return;let cambio=false;
  for(const [lote,c] of cajas){const r=c.rect,d=Math.hypot(Math.max(r.x0-x,0,x-r.x1),Math.max(r.z0-z,0,z-r.z1)),era=lejos.has(lote),es=era?d>LEJOS.cerca:d>LEJOS.lejos;if(es!==era){cambio=true;es?lejos.add(lote):lejos.delete(lote);}}
  if(cambio)aplicar();};
 return {group,triangles,meshes:group.children.length,doors:doors.length,setVisibles,setVidrio,vidrios:()=>vidrios,setLejos,lejos:()=>new Set(lejos),lotesConPiezas:()=>new Set(piezas.map(p=>p.lote)),
  // people: [{x,z}]. Abre las puertas con alguien cerca; sólo se recalculan si alguna se movió. trancada(x, z, y): la
  // puerta de calle de una vivienda trancada (o de un lugar cerrado) no se abre sola (la ronda, como las de adentro).
  // (2026-10-18: al jugador —o.esJugador— no se le abren solas: d.mano, la abrió él con E)
  updateDoors(dt,people,trancada=null){let moved=false;for(const d of doors){const near=!(trancada&&trancada(d.cx,d.cz,d.cy??0))&&(d.mano||people.some(o=>!o.esJugador&&(o.x-d.cx)**2+(o.z-d.cz)**2<6.25&&(d.cy==null||Math.abs((o.feet??o.y??0)-d.cy)<2))),a=near?Math.min(1,d.a+dt*2.5):Math.max(0,d.a-dt*1.4);if(a!==d.a){d.a=a;moved=true;}}if(moved)refresh();},
  // las puertas de calle cerca de (x, z, y), como world3d.puertasCerca (la hoja: de la bisagra al centro, y otro tanto)
  puertasCerca(x,z,y,r=1.5,trancada=null){const out=[];for(const d of doors){const cy=d.cy??d.y??0;if(Math.abs(cy-y)>1.6||Math.hypot(d.cx-x,d.cz-z)>r)continue;
   out.push({cx:d.cx,cz:d.cz,cy,seg:[d.x,d.z,2*d.cx-d.x,2*d.cz-d.z],get a(){return d.a;},get abierta(){return !!d.mano;},alternar(){d.mano=!d.mano;},trancada:()=>!!trancada?.(d.cx,d.cz,cy)});}return out;},
  setNight(on){for(const m of bounce)m.emissive.set(on?BOUNCE_NIGHT:m.userData.day);for(const m of litMats){m.emissive.set(on?'#ffc777':0);m.emissiveIntensity=on?.9:0;m.opacity=on?.55:.22;}},
  dispose(){for(const o of own)o.dispose();}};
}
