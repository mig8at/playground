/* LOS PERSONAJES NUEVOS (2026-11-22): el armado de los maniquíes de las Universal Animation Library con su pelo, su ropa por
   zonas, sin dedos, en una malla y con sus niveles de detalle —lo usan el prototipo (/prototipo-personajes) y la página para
   calzar peinados (/prototipo-pelo)—. Ver views/PrototipoPersonajesView.vue para el porqué de cada decisión.
   Los modelos no van en git todavía (public/models/prototipo, ignorado): se copian de assets-fuente/personaje. */
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js';
import {MeshoptSimplifier} from 'three/addons/libs/meshopt_simplifier.module.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {NIVELES_PLANTA} from './nature3d.js';
export const DIR='/models/gente/',BIBLIOTECAS=['UAL1_Standard.glb','UAL2_Standard.glb'];
// (2026-11-22, Miguel: «mejor usa el esqueleto de las animaciones, no los cuerpos humanos: sólo el pelo sobre los maniquíes»: los
// cuerpos son los maniquíes de las bibliotecas —el de UAL1 y el de mujer de UAL2—, con los peinados del paquete de personajes
// base encima. Sin cara: la cabeza, piel)
export const CUERPOS={hombre:'UAL1_Standard.glb',mujer:'Mannequin_F.glb'},BASE_DE={hombre:'Superhero_Male_FullBody.gltf',mujer:'Superhero_Female_FullBody.gltf'};// (BASE_DE: la cabeza para la que se hicieron los peinados de cada uno)
// (los peinados de cada uno: el pelo y, si va, la barba; vacío: sin pelo)
export const PEINADOS={hombre:[['Hair_Buzzed'],['Hair_SimpleParted'],['Hair_SimpleParted','Hair_Beard'],['Hair_Buzzed','Hair_Beard'],[]],mujer:[['Hair_Long'],['Hair_Buns'],['Hair_BuzzedFemale'],['Hair_Long']]};

export const DEDO=/(index|middle|pinky|ring|thumb)_0/;
// (los niveles de cada variante, por el nombre de su malla: userData se clona como JSON y las geometrías no sobreviven)
export const NIV={};let nVar=0;

// ---- La ropa por zonas ----
export const Z={piel:0,camisa:1,antebrazo:2,pantalon:3,pantorrilla:4,zapatos:5,pelo:6,ojo:7,ceja:8,blanco:9,iris:10};// (ojo: la pupila)
const zonaDe=b=>/Head|neck|hand|index|middle|pinky|ring|thumb/i.test(b)?Z.piel:/lowerarm/.test(b)?Z.antebrazo:/upperarm|clavicle|spine/.test(b)?Z.camisa:/pelvis|thigh/.test(b)?Z.pantalon:/calf/.test(b)?Z.pantorrilla:/foot|ball/.test(b)?Z.zapatos:Z.camisa;
export const PIEL=['#f1c9a5','#d9a47c','#b97f57','#8d5a3b','#5e3b26'],CAMISA=['#e8e4dc','#2f3a4f','#a63d32','#4f7a5a','#d9b44a','#6d5a8c','#1f1f22','#7fa3c4'],PANTALON=['#2b3550','#3a3a3d','#7a6a54','#556b4a','#1d1d20','#9a8f7c'],ZAPATOS=['#1c1c1c','#f2f2f2','#6b4a32','#3b3f6b'],PELO=['#1b1410','#3e2a1c','#6b4a2b','#b08a55','#8a8a8a','#d8c28e','#c9c4bc'],IRIS=['#4a3220','#6b4a2b','#3d6b4f','#3f6a8f','#2a1d14','#5b5f2e'],FALDA=['#2b3550','#7a2e3a','#3a3a3d','#c9a35a','#4f6b8a','#e3dcd0'];
// (el material de una persona: su paleta en un uniform; el vértice toma el color de su zona. Manga corta: el antebrazo, piel;
// pantaloneta o falda: la pantorrilla, piel)
// (la cara: el atributo detalle —la luz de la cara que pintó el artista, pasada a cada vértice: labios, sombras, párpados—
// multiplica el color de su zona; 1 en el resto del cuerpo)
// (antebrazo: su propio color —las mangas de la camisa bajo un chaleco—; si no, el de la camisa o piel)
export function materialRopa(piel,{camisa='#ddd',antebrazo=null,pantalon='#333',zapatos='#111',pelo='#222',iris='#4a3220',mangaCorta=false,pantaloneta=false}={}){
 const pal=[piel,camisa,antebrazo||(mangaCorta?piel:camisa),pantalon,pantaloneta?piel:pantalon,zapatos,pelo,'#120d0a',pelo,'#f1eee6',iris].map(c=>new THREE.Color(c));
 const m=new THREE.MeshStandardMaterial({roughness:.82});
 m.onBeforeCompile=sh=>{sh.uniforms.paleta={value:pal};
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute float zona;attribute float detalle;uniform vec3 paleta[11];varying vec3 vRopa;').replace('#include <begin_vertex>','#include <begin_vertex>\nvRopa=paleta[int(zona+.5)]*detalle;');
  sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vRopa;').replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb*=vRopa;');};
 m.customProgramCacheKey=()=>'ropa-zonas';return m;}
// (la de una persona; la mujer: falda —el pantalón con la pantorrilla de piel— o pantalón, a veces vestido)
// (el pelo, que contraste con la piel: si la luz de los dos queda a menos de CONTRASTE, se elige otro)
const luzDe=h=>{const c=new THREE.Color(h);return .299*c.r+.587*c.g+.114*c.b;},CONTRASTE=.18;
const peloPara=(r,piel)=>{let p=PELO[0];for(let k=0;k<12;k++){p=PELO[Math.floor(r()*PELO.length)];if(Math.abs(luzDe(p)-luzDe(piel))>=CONTRASTE)break;}return p;};
export function vestimenta(r,mujer){const de=l=>l[Math.floor(r()*l.length)];
 if(!mujer){const piel=de(PIEL);return {piel,ropa:{camisa:de(CAMISA),pantalon:de(PANTALON),zapatos:de(ZAPATOS),pelo:peloPara(r,piel),iris:de(IRIS),mangaCorta:r()<.45,pantaloneta:r()<.25}};}
 const falda=r()<.55,c=falda?de(FALDA):de(PANTALON),vestido=falda&&r()<.35;
 const piel=de(PIEL);return {piel,ropa:{camisa:vestido?c:de(CAMISA),pantalon:c,zapatos:de(ZAPATOS),pelo:peloPara(r,piel),iris:de(IRIS),mangaCorta:r()<.55,pantaloneta:falda}};}

// ---- Los niveles de detalle (como nature3d: soldar por posición, compactar y simplificar) ----
function simplificar(geo,ratio){const idx=geo.index.array;if(ratio>=1)return idx;const pa=geo.attributes.position,n=pa.count,pos=new Float32Array(n*3);for(let i=0;i<n;i++){pos[i*3]=pa.getX(i);pos[i*3+1]=pa.getY(i);pos[i*3+2]=pa.getZ(i);}
 const remap=MeshoptSimplifier.generatePositionRemap(pos,3),uso=[...new Set(Array.from(idx,i=>remap[i]))],nuevo=new Map(uso.map((v,k)=>[v,k])),p2=new Float32Array(uso.length*3);
 uso.forEach((v,k)=>p2.set(pos.subarray(v*3,v*3+3),k*3));const i2=Uint32Array.from(idx,i=>nuevo.get(remap[i]));
 const [out]=MeshoptSimplifier.simplify(i2,p2,3,Math.max(12,Math.floor(idx.length*ratio/3)*3),.1,[]);return Uint32Array.from(out,k=>uso[k]);}
const niveles=geo=>NIVELES_PLANTA.map(N=>{const s=new THREE.BufferGeometry();for(const [k,v] of Object.entries(geo.attributes))s.setAttribute(k,v);s.morphAttributes=geo.morphAttributes;s.morphTargetsRelative=geo.morphTargetsRelative;s.setIndex(new THREE.BufferAttribute(simplificar(geo,N.ratio),1));s.boundingSphere=geo.boundingSphere;return s;});

// ---- Cargar (sin texturas: la ropa es por zonas; cada imagen pedida, un pixel) ----
const PIXEL='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const gestor=new THREE.LoadingManager();gestor.setURLModifier(u=>/\.png$/i.test(u)?PIXEL:u);
export const cargar=f=>new GLTFLoader(gestor).loadAsync(DIR+f);
// (las texturas de la cara y del ojo, como datos: se leen una vez, al armar, y no se dibujan)
async function imagen(f){const bmp=await createImageBitmap(await (await fetch(DIR+f)).blob()),c=new OffscreenCanvas(bmp.width,bmp.height),x=c.getContext('2d');x.drawImage(bmp,0,0);return {w:bmp.width,h:bmp.height,d:x.getImageData(0,0,bmp.width,bmp.height).data};}
const luz=(t,u,v)=>{const x=Math.min(t.w-1,Math.max(0,Math.floor((u-Math.floor(u))*t.w))),y=Math.min(t.h-1,Math.max(0,Math.floor((v-Math.floor(v))*t.h))),k=(y*t.w+x)*4;return (.299*t.d[k]+.587*t.d[k+1]+.114*t.d[k+2])/255;};
const CARAS={hombre:'caras/cara_hombre.png',mujer:'caras/cara_mujer.png'},OJO='caras/ojo.png';

// ---- La cabeza, en el espacio de su hueso: su caja (para que un peinado hecho para otra cabeza calce en ésta) ----
// (el elipsoide de la cabeza: radio, la mitad de la caja; sale: cuánto queda afuera de él el pelo que caía adentro)
// (cubre: el peinado, un poco más grande que la caja de la cabeza, para cubrirla —Miguel: «escala el pelo de ser necesario para
// que cubra la cabeza»—; la barba no se recorta)
export const PELO_AFUERA={radio:.5,sale:1.02,cara:.35,nacimiento:.62,cubre:1.1};// (cara: qué tan adelante —coseno—; nacimiento: la altura del nacimiento del pelo, en radios de la cabeza desde su centro)
// LOS AJUSTES DE CADA PEINADO (calzados en /prototipo-pelo): sobre el ajuste general —la caja de la cabeza para la que se hizo,
// llevada a la del maniquí— cada uno puede cambiar su tamaño (cubre), su escala por eje (ex, ey, ez), su corrimiento en el
// espacio del hueso de la cabeza (dx, dy, dz, en metros), dónde nace adelante (nacimiento) y desde qué tan adelante se recorta
// (cara); recortar: false, nada se quita. Lo que falte, el general (PELO_AFUERA).
// (calzados el 2026-11-22 en la página: con el general —10 % más grande, un poco más ancho, alto y hondo, sin recortar— calzan
// el rapado, el de lado, el pelo largo, los moños y el rapado de mujer; la barba, más adelante y más arriba)
export const AJUSTE_PELO={Hair_Beard:{cubre:1.12,ex:1.12,ez:1.15,dy:.03,dz:.012}};
export const ajustePelo=(nombre,extra={})=>({...PELO_AFUERA,ex:1.1,ey:1.08,ez:1.04,dx:0,dy:0,dz:0,recortar:false,...(AJUSTE_PELO[nombre]||{}),...extra});
export function cajaCabeza(escena){const ms=[];escena.updateMatrixWorld(true);escena.traverse(o=>{if(o.isSkinnedMesh)ms.push(o);});const caja=new THREE.Box3(),v=new THREE.Vector3();
 for(const m of ms){const sk=m.skeleton,h=sk.bones.findIndex(b=>b.name==='Head'),pa=m.geometry.attributes.position,si=m.geometry.attributes.skinIndex,sw=m.geometry.attributes.skinWeight;if(h<0)continue;
  for(let i=0;i<pa.count;i++){let mk=0,mw=-1;for(let k=0;k<4;k++){const w=sw.getComponent(i,k);if(w>mw){mw=w;mk=si.getComponent(i,k);}}if(mk!==h||/eye|brow|face/i.test(m.name))continue;
   caja.expandByPoint(v.fromBufferAttribute(pa,i).applyMatrix4(m.bindMatrix).applyMatrix4(sk.boneInverses[h]));}}
 return {c:caja.getCenter(new THREE.Vector3()),t:caja.getSize(new THREE.Vector3())};}

// ---- Un cuerpo con su peinado, en UNA malla y sin dedos ----
// (las piezas del cuerpo —el cuerpo, los ojos, las cejas— y las del peinado, que vienen con su propio esqueleto amarrado a la
// cabeza de otro cuerpo: cada vértice se lleva del espacio de su hueso en ese esqueleto al del mismo hueso en éste, así el
// pelo queda en la cabeza de cada uno; sus huesos se cambian por los de éste, por nombre)
export function armarCuerpo(gCuerpo,gPelos,texCara=null,texOjo=null,ajuste=null,{ajustes={},conNiveles=true}={}){const raiz=cloneSkinned(gCuerpo.scene),ms=[];raiz.traverse(o=>{if(o.isSkinnedMesh)ms.push(o);});
 const cuerpo=ms.reduce((a,b)=>a.geometry.attributes.position.count>b.geometry.attributes.position.count?a:b),sk=cuerpo.skeleton,huesos=sk.bones,porNombre=new Map(huesos.map((b,i)=>[b.name,i]));
 const quedan=huesos.map((b,i)=>DEDO.test(b.name)?-1:i).filter(i=>i>=0),nuevo=new Map(quedan.map((v,k)=>[v,k]));
 const destino=i=>{let b=huesos[i];while(b&&DEDO.test(b.name))b=b.parent;return nuevo.get(huesos.indexOf(b))??0;};
 const inv=new THREE.Matrix4(),M=new THREE.Matrix4(),v=new THREE.Vector3(),nm=new THREE.Matrix3(),nn=new THREE.Vector3();
 // (hacia dónde mira la cara y hacia dónde es arriba, en el espacio del hueso de la cabeza: adelante sale de la punta del pie)
 const pos=i=>new THREE.Vector3().setFromMatrixPosition(inv.copy(sk.boneInverses[i]).invert()),iH=porNombre.get('Head'),adel=Math.sign(pos(porNombre.get('ball_l')).z-pos(porNombre.get('foot_l')).z)||1;
 const rotH=new THREE.Matrix4().extractRotation(sk.boneInverses[iH]),frenteH=new THREE.Vector3(0,0,adel).applyMatrix4(rotH).normalize(),arribaH=new THREE.Vector3(0,1,0).applyMatrix4(rotH).normalize();
 const pieza=(m,zonaFija,A=ajustePelo(m.name,ajustes[m.name]))=>{const quitar=new Set(),geo=m.geometry.clone(),si=geo.attributes.skinIndex,sw=geo.attributes.skinWeight,pa=geo.attributes.position,no=geo.attributes.normal,uv=geo.attributes.uv,n=pa.count,zona=new Float32Array(n),detalle=new Float32Array(n).fill(1),cabeza=[],propio=m.skeleton.bones.every((b,i)=>huesos[i]===b);
  for(let i=0;i<n;i++){let mk=0,mw=-1;for(let k=0;k<4;k++){const w=sw.getComponent(i,k);if(w>mw){mw=w;mk=si.getComponent(i,k);}}
   const nombre=m.skeleton.bones[mk].name,bi=porNombre.get(nombre)??0;
   if(!propio){// (del hueso de su esqueleto al mismo hueso de éste; en la cabeza, de la caja de la cabeza para la que se hizo a la de éste)
    v.fromBufferAttribute(pa,i).applyMatrix4(m.bindMatrix).applyMatrix4(m.skeleton.boneInverses[mk]);if(ajuste&&nombre==='Head'){v.sub(ajuste.de.c).multiply(ajuste.escala).multiplyScalar(A.cubre);v.x*=A.ex;v.y*=A.ey;v.z*=A.ez;v.add(ajuste.a.c);v.x+=A.dx;v.y+=A.dy;v.z+=A.dz;
     // (y nada del pelo adentro de la cabeza: la cabeza, como un elipsoide de su caja; el vértice que cae adentro sale a su
     // superficie, un poco afuera —el mechón que asomaba en la frente queda sobre ella—)
     // (lo que cae adentro y adelante, por debajo de la coronilla —un mechón sobre la cara—, se quita)
     if(zonaFija===Z.pelo){const c=ajuste.a.c,r=ajuste.a.t,q=new THREE.Vector3((v.x-c.x)/(r.x*A.radio),(v.y-c.y)/(r.y*A.radio),(v.z-c.z)/(r.z*A.radio)),d=q.length();
      // (adelante y por debajo del nacimiento del pelo —adentro o encima de la frente—, se quita; lo demás que caía adentro, sale)
      const dir=q.clone().normalize(),alto=q.dot(arribaH);if(A.recortar&&dir.dot(frenteH)>A.cara&&alto<A.nacimiento)quitar.add(i);else if(d<1&&d>1e-6)v.sub(c).multiplyScalar(A.sale/d).add(c);}}
    M.copy(inv.copy(sk.boneInverses[bi]).invert()).premultiply(cuerpo.bindMatrixInverse);v.applyMatrix4(M);pa.setXYZ(i,v.x,v.y,v.z);
    if(no){nm.getNormalMatrix(M.clone().multiply(m.skeleton.boneInverses[mk]).multiply(m.bindMatrix));nn.fromBufferAttribute(no,i).applyMatrix3(nm).normalize();no.setXYZ(i,nn.x,nn.y,nn.z);}}
   const idx=[0,1,2,3].map(k=>destino(porNombre.get(m.skeleton.bones[si.getComponent(i,k)]?.name)??0));idx.forEach((x,k)=>si.setComponent(i,k,x));
   zona[i]=zonaFija??zonaDe(nombre);
   // (el ojo: blanco, iris o pupila según el dibujo del ojo; la cabeza, se anota para su luz)
   if(zonaFija===Z.ojo&&texOjo&&uv){const l=luz(texOjo,uv.getX(i),uv.getY(i));zona[i]=l>.62?Z.blanco:l<.13?Z.ojo:Z.iris;}
   if(m===cuerpo&&texCara&&uv&&/^Head$/.test(nombre))cabeza.push(i);}
  // (la luz de la cara: la de la textura en cada vértice de la cabeza, contra la del medio de la cara —la piel—; acotada para que
  // los labios, los párpados y las sombras se marquen sin manchar)
  if(cabeza.length){const ls=cabeza.map(i=>luz(texCara,uv.getX(i),uv.getY(i))),med=[...ls].sort((a,b)=>a-b)[Math.floor(ls.length*.6)]||1;cabeza.forEach((i,k)=>{detalle[i]=THREE.MathUtils.clamp(ls[k]/med,.5,1.12);});}
  geo.setAttribute('zona',new THREE.BufferAttribute(zona,1));geo.setAttribute('detalle',new THREE.BufferAttribute(detalle,1));for(const k of Object.keys(geo.attributes))if(!['position','normal','skinIndex','skinWeight','zona','detalle'].includes(k))geo.deleteAttribute(k);
  if(!geo.index)geo.setIndex([...Array(n).keys()]);
  if(quitar.size){const ix=geo.index.array,quedan=[];for(let t=0;t<ix.length;t+=3)if(!quitar.has(ix[t])&&!quitar.has(ix[t+1])&&!quitar.has(ix[t+2]))quedan.push(ix[t],ix[t+1],ix[t+2]);geo.setIndex(quedan);}
  return geo;};
 // (los ojos y las cejas del cuerpo, por su nombre o el de su material)
 // (las partes del maniquí van por su hueso; si un cuerpo trae ojos o cejas, a su zona)
 const zonaPieza=m=>{const t=m.name+' '+(m.material?.name||'')+' '+(m.parent?.name||'');return /brow/i.test(t)?Z.ceja:/eye/i.test(t)?Z.ojo:undefined;};
 const partes=ms.map(m=>pieza(m,zonaPieza(m)));
 for(const g of gPelos){g.scene.updateMatrixWorld(true);g.scene.traverse(o=>{if(o.isSkinnedMesh)partes.push(pieza(o,Z.pelo));});}
 const geo=mergeGeometries(partes,false);formasDeContextura(geo,quedan.map(i=>huesos[i].name),adel);coordenadasDeTela(geo,quedan.map(i=>huesos[i].name),n=>pos(porNombre.get(n)),cuerpo.bindMatrix,adel);
 const malla=new THREE.SkinnedMesh(geo,materialRopa(PIEL[0]));
 for(const b of huesos)if(DEDO.test(b.name)&&!DEDO.test(b.parent?.name||''))b.parent.remove(b);
 cuerpo.parent.add(malla);malla.position.copy(cuerpo.position);malla.quaternion.copy(cuerpo.quaternion);malla.scale.copy(cuerpo.scale);
 malla.bind(new THREE.Skeleton(quedan.map(i=>huesos[i]),quedan.map(i=>sk.boneInverses[i])),cuerpo.bindMatrix);for(const m of ms)m.removeFromParent();
 malla.updateMorphTargets();malla.name='cuerpo'+(nVar++);if(conNiveles)NIV[malla.name]=niveles(geo);return raiz;}

// ---- LA TELA: dónde está cada punto del cuerpo, para cortar la ropa en el sombreador (2026-11-22, Miguel: «agregarle vértices
// al maniquí para el cuello redondo o en V… que en mangas y pantalones se vea el color bien lineal, como si fuera tela» →
// «sí, en el sombreador») ----
// Sin un vértice de más: cada vértice guarda dos atributos, y el sombreador decide en cada píxel si ahí hay tela o piel. Como
// se interpolan en línea recta dentro de cada triángulo, el borde sale recto o curvo, nítido, aunque el triángulo sea grande, y
// sigue igual en los niveles de detalle simplificados.
//  - tela (x, y, z, w): la posición en la pose de origen, en metros: x al costado, y hacia arriba desde la base del cuello
//    (neck_01), z hacia adelante; w, la altura sobre la cadera (pelvis). Con eso: el cuello redondo o en V, la cintura, la
//    ombliguera, la abertura de la chaqueta y las rayas.
//  - largo (brazo, pierna): cuánto se avanza por el brazo —0 el hombro, .5 el codo, 1 la muñeca— y por la pierna —0 la
//    cadera, .5 la rodilla, 1 el tobillo—; -1 fuera de ellos. Con eso: el largo de la manga y del pantalón.
function coordenadasDeTela(geo,nombres,hueso,bind,adel){const pa=geo.attributes.position,si=geo.attributes.skinIndex,sw=geo.attributes.skinWeight,zo=geo.attributes.zona,n=pa.count;
 const cuello=hueso('neck_01'),cadera=hueso('pelvis'),arriba=cuello.clone().sub(cadera).normalize(),adelante=new THREE.Vector3(0,0,adel);adelante.addScaledVector(arriba,-adelante.dot(arriba)).normalize();
 const lado=new THREE.Vector3().crossVectors(arriba,adelante),tela=new Float32Array(n*4),largo=new Float32Array(n*2).fill(-1),p=new THREE.Vector3(),d=new THREE.Vector3();
 // (una cadena de tres huesos —hombro, codo, muñeca o cadera, rodilla, tobillo— y lo que avanza el punto por ella)
 const cadena=(a,b,c)=>[hueso(a),hueso(b),hueso(c)],avance=([A,B,C],q)=>{const ab=B.clone().sub(A),t=d.copy(q).sub(A).dot(ab)/ab.lengthSq();if(t<1)return t*.5;const bc=C.clone().sub(B);return .5+d.copy(q).sub(B).dot(bc)/bc.lengthSq()*.5;};
 const brazos={l:cadena('upperarm_l','lowerarm_l','hand_l'),r:cadena('upperarm_r','lowerarm_r','hand_r')},piernas={l:cadena('thigh_l','calf_l','foot_l'),r:cadena('thigh_r','calf_r','foot_r')};
 for(let i=0;i<n;i++){p.fromBufferAttribute(pa,i).applyMatrix4(bind);d.copy(p).sub(cuello);tela.set([d.dot(lado),d.dot(arriba),d.dot(adelante),p.clone().sub(cadera).dot(arriba)],i*4);
  if(zo.getX(i)>=Z.pelo)continue;let mk=0,mw=-1;for(let k=0;k<4;k++){const w=sw.getComponent(i,k);if(w>mw){mw=w;mk=si.getComponent(i,k);}}
  const nom=nombres[mk]||'',m=nom.match(/^(upperarm|lowerarm|hand|thigh|calf|foot|ball)_([lr])/);if(!m)continue;
  if(/arm|hand/.test(m[1]))largo[i*2]=Math.max(0,avance(brazos[m[2]],p));else largo[i*2+1]=Math.max(0,avance(piernas[m[2]],p));}
 geo.setAttribute('tela',new THREE.BufferAttribute(tela,4));geo.setAttribute('largo',new THREE.BufferAttribute(largo,2));}

// ---- LA CONTEXTURA (2026-11-22, Miguel: «¿ves posible alterar la contextura corporal?» → «dale, ármalo») ----
// Dos formas de mezcla, hechas por código una vez por cuerpo, y la estatura por persona:
//  - peso: cada vértice sale por su normal según su zona —la panza y la cintura, lo que más (y más adelante); caderas, muslos y
//    brazos, algo; cuello y cara, casi nada—; con peso negativo, entra: delgado;
//  - musculatura: hombros, pecho, brazos y piernas;
//  - la estatura: la escala de la persona entera.
// Las normales se promedian entre los vértices que comparten posición (las costuras de normales): si no, el cuerpo se abría al
// inflarse. El pelo va con la cabeza. Cada persona lleva sus dos números (morphTargetInfluences): cero memoria por persona.
export const CONTEXTURA={peso:{m:.065,zona:{spine_01:1,spine_02:.85,pelvis:.8,spine_03:.5,thigh:.6,upperarm:.45,lowerarm:.25,neck:.35,calf:.3,clavicle:.3,Head:.1,hand:.04}},panza:1.6,
 musculo:{m:.05,zona:{upperarm:1,clavicle:.85,spine_03:.75,lowerarm:.55,thigh:.6,calf:.5,neck:.45,spine_02:.25}},
 rango:{estatura:[.92,1.08],peso:[-.7,1],musculo:[0,1]}};
function formasDeContextura(geo,nombres,adel){const pa=geo.attributes.position,no=geo.attributes.normal,si=geo.attributes.skinIndex,sw=geo.attributes.skinWeight,zo=geo.attributes.zona,n=pa.count;
 // (la normal promediada por posición)
 const clave=i=>pa.getX(i).toFixed(4)+','+pa.getY(i).toFixed(4)+','+pa.getZ(i).toFixed(4),suma=new Map();
 for(let i=0;i<n;i++){const k=clave(i),v=suma.get(k)||suma.set(k,new THREE.Vector3()).get(k);v.x+=no.getX(i);v.y+=no.getY(i);v.z+=no.getZ(i);}
 const peso=new Float32Array(n*3),musculo=new Float32Array(n*3),nn=new THREE.Vector3();
 const de=(tabla,nombre)=>{for(const [b,w] of Object.entries(tabla))if(nombre.startsWith(b))return w;return 0;};
 for(let i=0;i<n;i++){nn.copy(suma.get(clave(i))).normalize();let wp=0,wm=0;
  for(let k=0;k<4;k++){const w=sw.getComponent(i,k);if(!w)continue;const nom=zo.getX(i)===Z.pelo?'Head':nombres[si.getComponent(i,k)]||'';wp+=w*de(CONTEXTURA.peso.zona,nom);wm+=w*de(CONTEXTURA.musculo.zona,nom);}
  // (la panza: lo de adelante del tronco bajo, más)
  const nom0=nombres[si.getComponent(i,0)]||'';if(/spine_0[12]|pelvis/.test(nom0)&&nn.z*adel>.3)wp*=CONTEXTURA.panza;
  peso[i*3]=nn.x*wp*CONTEXTURA.peso.m;peso[i*3+1]=nn.y*wp*CONTEXTURA.peso.m;peso[i*3+2]=nn.z*wp*CONTEXTURA.peso.m;
  musculo[i*3]=nn.x*wm*CONTEXTURA.musculo.m;musculo[i*3+1]=nn.y*wm*CONTEXTURA.musculo.m;musculo[i*3+2]=nn.z*wm*CONTEXTURA.musculo.m;}
 geo.morphAttributes.position=[new THREE.BufferAttribute(peso,3),new THREE.BufferAttribute(musculo,3)];geo.morphTargetsRelative=true;}
// La contextura de una persona: {estatura, peso, musculo}
export function aplicarContextura(root,{estatura=1,peso=0,musculo=0}={}){root.scale.setScalar(estatura);root.traverse(o=>{if(o.isSkinnedMesh&&o.morphTargetInfluences){o.morphTargetInfluences[0]=peso;o.morphTargetInfluences[1]=musculo;}});}
// Una al azar: la mayoría cerca de lo normal; la mujer, un poco más baja y con menos musculatura
export function contexturaAlAzar(r,mujer){const c=()=>(r()+r()+r())/3,[e0,e1]=CONTEXTURA.rango.estatura;
 return {estatura:(e0+(e1-e0)*c())*(mujer?.97:1),peso:-.6+1.5*c()**1.3,musculo:Math.max(0,(mujer?.5:.9)*(c()*1.6-.5))};}

// ---- Las animaciones para un cuerpo: sólo rotaciones (sin dedos) y la cadera escalada a su altura ----
export const alturaCadera=escena=>{let y=1;escena.updateMatrixWorld(true);escena.traverse(o=>{if(o.isBone&&o.name==='pelvis')y=new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).y;});return y;};
export function clipsPara(clips,k){return clips.map(c=>new THREE.AnimationClip(c.name,c.duration,c.tracks.filter(t=>!DEDO.test(t.name)&&(t.name.endsWith('.quaternion')||t.name==='pelvis.position')).map(t=>{if(t.name!=='pelvis.position')return t;const u=t.clone();for(let i=0;i<u.values.length;i++)u.values[i]*=k;return u;})));}

// Todo lo que el armado necesita, cargado una vez: las bibliotecas (animaciones), los maniquíes, los peinados, las cajas de la
// cabeza (la del maniquí y la de la cabeza para la que se hizo cada peinado) y las animaciones de cada cuerpo.
export async function cargarTodo(){await MeshoptSimplifier.ready;const pelos=[...new Set(Object.values(PEINADOS).flat(2))];
 const [bibs,cuerpos0,gPelos]=await Promise.all([Promise.all(BIBLIOTECAS.map(cargar)),Promise.all(Object.values(CUERPOS).map(f=>BIBLIOTECAS.includes(f)?null:cargar(f))),Promise.all(pelos.map(p=>cargar(p+'.gltf')))]);
 const cuerpos=Object.fromEntries(Object.keys(CUERPOS).map((q,i)=>[q,cuerpos0[i]||bibs[BIBLIOTECAS.indexOf(CUERPOS[q])]]));
 const base=await Promise.all(Object.keys(CUERPOS).map(q=>cargar(BASE_DE[q]).then(g=>cajaCabeza(g.scene))));
 const ajustes=Object.fromEntries(Object.keys(CUERPOS).map((q,i)=>{const a=cajaCabeza(cuerpos[q].scene),de=base[i];return [q,{de,a,escala:new THREE.Vector3(a.t.x/de.t.x,a.t.y/de.t.y,a.t.z/de.t.z)}];}));
 const peloDe=Object.fromEntries(pelos.map((p,i)=>[p,gPelos[i]]));
 const vistos=new Set(),clips=bibs.flatMap(b=>b.animations).filter(c=>!vistos.has(c.name)&&vistos.add(c.name)),yUAL=alturaCadera(bibs[0].scene);
 const clipsDe=Object.fromEntries(Object.keys(CUERPOS).map(q=>[q,clipsPara(clips,alturaCadera(cuerpos[q].scene)/yUAL)]));
 return {cuerpos,ajustes,peloDe,clips,clipsDe};}
