import {addVestShoulders} from './chalecoHombros3d.js';
import {addHoodDetails} from './capucha3d.js';
import {addButtonShirtDetails} from './camisaDetalles3d.js';
import {addCargoPockets} from './cargoPockets3d.js';
import {installSkirtContact} from './skirtContact3d.js';
/* Los personajes armados (FUGA, 2026-10-12): la gente hecha con piezas propias, en el estilo de los objetos del
   catálogo (cajas, colores planos), sobre el esqueleto y las animaciones del paquete de Quaternius (quieto, caminar,
   correr, sentarse, recoger…). Cada persona es UNA malla con piel: cada caja va pegada entera a un hueso (rígida) y
   lleva su color por vértice, así toda la persona es una sola llamada de dibujo. Las piezas se arman en la pose de
   origen del esqueleto (la de sus boneInverses), en el espacio del modelo. */
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js';
import {polishedSkin,polishedPartsFolder} from './pulido3d.js';
import {armContactProfile,installArmContact} from './armContact3d.js';
import {loadHemProfile,clothHems} from './dobladillos3d.js';
import {polishAccessories} from './accesorios3d.js';
import {softenBalding} from './pelo3d.js';
import {conformBasicShirt,offsetBasicShirt} from './camiseta3d.js';
import {optimizeWardrobeGeometry} from './optimizarRopa3d.js';
import {applyGarmentContactCalibration,installCollarHeadLimit} from './calibracionRopa3d.js';
import {addSneakers} from './tenis3d.js';
import {installFeet} from './pies3d.js';
import {splitClothing,fitGarments,underwear,extractPart,bakeSeatedCloth,installSeatedCloth,maskCoveredSkin,selectTriangles,alignBelt,alignShortWaist,fitSkirtWaist,conformShorts,offsetShorts,stabilizeHip,installLegFoldLimit,softenJump} from './ropa3d.js';

const BASE='/models/personajes/BaseCharacter.gltf';
let tplCache=null;
// El esqueleto del paquete (el cuerpo base) y sus animaciones, una vez por página.
// (cu: el cuerpo hecho en Blender —scripts/blender/cuerpo.py: proporciones, huesos de apoyo en codos y rodillas y las
// animaciones recalculadas—; sin cu, el del paquete)
const CUERPOS={intermedio:'/models/personajes/BaseIntermedio.glb',realista:'/models/personajes/BaseRealista.glb'},SKELS=new Map();
export function loadSkeleton(cu=null){const path=CUERPOS[cu]||BASE;if(!SKELS.has(path))SKELS.set(path,new GLTFLoader().loadAsync(path).then(async g=>{let clips=g.animations;if(!cu){const response=await fetch('/models/personajes/AccionesClasico.json');if(!response.ok)throw new Error('No se pudieron cargar las acciones del cuerpo clásico');const extra=(await response.json()).map(c=>THREE.AnimationClip.parse(c));clips=[...clips,...extra.filter(c=>!clips.some(a=>a.name===c.name))];}return {scene:g.scene,clips};}));return SKELS.get(path);}

// Para mirar el esqueleto: dónde cae cada hueso en la pose de origen (espacio del modelo) y la caja del cuerpo base.
export async function bindInfo(){const t=await loadSkeleton(),ms=[];t.scene.traverse(o=>{if(o.isSkinnedMesh)ms.push(o);});const m=ms[0],out={};
 m.skeleton.bones.forEach((b,i)=>{const M=new THREE.Matrix4().copy(m.skeleton.boneInverses[i]).invert(),p=new THREE.Vector3().setFromMatrixPosition(M).applyMatrix4(m.bindMatrixInverse);out[b.name]=[+p.x.toFixed(2),+p.y.toFixed(2),+p.z.toFixed(2)];});
 m.geometry.computeBoundingBox();const b=m.geometry.boundingBox;
 return {meshes:ms.map(x=>x.name+' '+x.geometry.attributes.position.count),bones:out,bbox:[b.min.toArray().map(v=>+v.toFixed(2)),b.max.toArray().map(v=>+v.toFixed(2))]};}

// ---------- Las piezas ----------
// Una caja: centro, tamaño y giro (en el espacio del modelo, pose de origen), pegada al hueso bone, de color color.
// seg(): una caja a lo largo de un hueso, de a hasta b (brazos y piernas), de grueso w (a lo ancho) y d (de frente).
// Las dos caras (2026-10-12): las prendas son láminas abiertas (boca de las mangas, ruedo, cuello, borde de la chaqueta
// y del pelo); con una sola cara, por ahí se veía a través del muñeco. La cara de adentro va un 35 % más oscura (el
// forro, en sombra).
const MAT=new THREE.MeshStandardMaterial({vertexColors:true,flatShading:true,roughness:.8,side:THREE.DoubleSide});
MAT.onBeforeCompile=sh=>{sh.fragmentShader=sh.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n if(!gl_FrontFacing)diffuseColor.rgb*=.65;');};
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
// (las de three que ya vienen sin índice —icosaedro, caja redondeada— avisaban en la consola cada vez: cientos al cargar la gente)
const nonIdx=g=>g.index?g.toNonIndexed():g;
function boxGeo(center,size,color,bone,quat=null){const g=new THREE.BoxGeometry(size[0],size[1],size[2]).toNonIndexed();
 const m=new THREE.Matrix4().compose(V(...center),quat||new THREE.Quaternion(),V(1,1,1));g.applyMatrix4(m);g.deleteAttribute('uv');
 const n=g.attributes.position.count,c=new THREE.Color(color),col=new Float32Array(n*3),si=new Uint16Array(n*4),sw=new Float32Array(n*4);
 for(let i=0;i<n;i++){col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;si[i*4]=bone;sw[i*4]=1;}
 g.setAttribute('color',new THREE.BufferAttribute(col,3));g.setAttribute('skinIndex',new THREE.BufferAttribute(si,4));g.setAttribute('skinWeight',new THREE.BufferAttribute(sw,4));return g;}
function segGeo(a,b,w,d,color,bone,extend=0){const A=V(...a),B=V(...b),dir=B.clone().sub(A),len=dir.length();dir.normalize();
 const q=new THREE.Quaternion().setFromUnitVectors(V(0,1,0),dir),c=A.clone().add(B).multiplyScalar(.5);
 return boxGeo(c.toArray(),[w,len+extend,d],color,bone,q);}

// Los colores con nombre (los del vestuario: engine/vestuario.js) o un #rrggbb.
import {COLORS,CUERPO_UNICO} from '../engine/vestuario.js';
const col=(cat,v,def)=>COLORS[cat]?.[v]??(typeof v==='string'&&v.startsWith('#')?v:COLORS[cat]?.[def]??'#888888');
const dark=(h,k=.8)=>'#'+new THREE.Color(h).multiplyScalar(k).getHexString();

/* El cuerpo y la ropa, de un «look» sencillo (el prototipo; después se lee del look del vestuario):
   piel, ropa (color de arriba), pantalon (color), pelo (color), peinado ('corto' | 'largo' | 'cola' | 'calvo'),
   mangas ('cortas' | 'largas'), corto (pantalón corto), falda, zapatos, gorra, gafas, mochila, barba, ojos, mujer. */
export function personaGeometry(look,B){const L={piel:'media',ropa:'roja',pantalon:'jean',pelo:'castaño',peinado:'corto',mangas:'cortas',zapatos:'negros',ojos:'negros',...look};
 const skin=col('piel',L.piel,'media'),top=col('ropa',L.ropa,'roja'),pant=col('pantalon',L.pantalon,'jean'),hair=col('pelo',L.pelo,'castaño'),shoe=col('zapatos',L.zapatos,'negros'),eye=col('ojos',L.ojos,'negros');
 const out=[],P=n=>B.pos[n],I=n=>B.idx[n],add=g=>out.push(g),W=L.mujer?.92:1;
 for(const s of [1,-1]){const sx=s>0?'L':'R';
  // piernas: muslo y canilla (del pantalón; la canilla de piel si es corto o falda), y el zapato
  const hip=P('UpperLeg'+sx),knee=P('LowerLeg'+sx),ank=[knee[0],.13,knee[2]];
  add(segGeo(hip,knee,.32*W,.34,L.falda?skin:pant,I('UpperLeg'+sx),.06));
  add(segGeo(knee,ank,.25*W,.27,L.corto||L.falda?skin:pant,I('LowerLeg'+sx),.04));
  const ft=P('Foot'+sx);add(boxGeo([ft[0],.075,ft[2]+.08],[.27*W,.15,.44],shoe,I('Foot'+sx)));add(boxGeo([ft[0],.02,ft[2]+.08],[.29*W,.04,.46],dark(shoe,.6),I('Foot'+sx)));
  // brazos: brazo (manga) y antebrazo (manga si es larga), la mano
  const sh=P('UpperArm'+sx),el=P('LowerArm'+sx),wr=P('Fist'+sx);
  if(L.mangas==='largas')add(segGeo(sh,el,.24,.25,top,I('UpperArm'+sx),.06));
  else{const mid=[sh[0]+(el[0]-sh[0])*.55,sh[1],sh[2]];add(segGeo(sh,mid,.27,.28,top,I('UpperArm'+sx),.04));add(segGeo(mid,el,.2,.21,skin,I('UpperArm'+sx),.02));}
  add(segGeo(el,wr,.19,.2,L.mangas==='largas'?top:skin,I('LowerArm'+sx),.04));
  add(boxGeo([wr[0]+s*.1,wr[1]-.01,wr[2]],[.2,.19,.17],skin,I('Fist'+sx)));
  add(boxGeo([wr[0]+s*.05,wr[1]-.01,wr[2]+.1],[.08,.08,.07],skin,I('Fist'+sx)));}// el pulgar
 // la cadera (pantalón o falda), el cinturón, la barriga y el pecho (ropa), el cuello
 const hp=P('Hips'),ab=P('Abdomen'),to=P('Torso'),nk=P('Neck'),hd=P('Head');
 add(boxGeo([0,1.0,hp[2]],[.74*W,.3,.44],L.falda?top:pant,I('Hips')));
 if(L.falda)add(boxGeo([0,.78,hp[2]],[.84*W,.32,.52],dark(top,.85),I('Hips')));
 add(boxGeo([0,1.16,hp[2]],[.75*W,.06,.45],L.falda?dark(top,.7):'#3b2a20',I('Hips')));
 add(boxGeo([0,1.33,ab[2]],[.7*W,.34,.43],top,I('Abdomen')));
 add(boxGeo([0,1.73,to[2]],[(L.mujer?.74:.84),.6,.48],top,I('Torso')));
 add(boxGeo([0,2.01,to[2]+.01],[.34,.08,.3],dark(top,.85),I('Torso')));// el cuello de la prenda
 add(boxGeo([0,2.08,nk[2]],[.18,.16,.18],skin,I('Neck')));
 // la cabeza: más chica que la del paquete (1/4,5 del cuerpo), con orejas, ojos, cejas, nariz y boca
 const hy=2.5,H=I('Head');add(boxGeo([0,hy,0],[.64,.68,.6],skin,H));
 for(const s of [1,-1]){add(boxGeo([s*.33,hy,-.02],[.05,.14,.1],dark(skin,.92),H));add(boxGeo([s*.13,hy+.04,.3],[.09,.1,.03],eye,H));add(boxGeo([s*.13,hy+.04,.302],[.04,.04,.02],'#ffffff',H));
  add(boxGeo([s*.13,hy+.14,.305],[.15,.035,.02],dark(hair,.8),H));}
 add(boxGeo([0,hy-.06,.32],[.08,.1,.06],dark(skin,.9),H));add(boxGeo([0,hy-.18,.302],[.16,.025,.01],'#8a3b33',H));
 // el pelo
 if(L.peinado!=='calvo'){add(boxGeo([0,hy+.37,-.02],[.7,.12,.66],hair,H));add(boxGeo([0,hy+.12,-.31],[.7,.46,.08],hair,H));
  for(const s of [1,-1])add(boxGeo([s*.335,hy+.22,-.08],[.06,.26,.48],hair,H));
  add(boxGeo([0,hy+.3,.3],[.66,.1,.06],hair,H));// el flequillo
  if(L.peinado==='largo'){add(boxGeo([0,hy-.18,-.31],[.7,.5,.1],hair,H));for(const s of [1,-1])add(boxGeo([s*.34,hy-.05,-.12],[.06,.5,.36],hair,H));}
  if(L.peinado==='cola'){add(boxGeo([0,hy+.05,-.42],[.16,.16,.14],hair,H));add(boxGeo([0,hy-.22,-.45],[.14,.42,.12],hair,H));}}
 if(L.barba){add(boxGeo([0,hy-.22,.29],[.6,.2,.08],hair,H));for(const s of [1,-1])add(boxGeo([s*.29,hy-.08,.2],[.06,.3,.2],hair,H));}
 // accesorios: gorra, gafas, mochila
 if(L.gorra){const g=col('gorra',L.gorra,'azul');add(boxGeo([0,hy+.42,0],[.72,.16,.68],g,H));add(boxGeo([0,hy+.36,.42],[.6,.04,.28],dark(g,.85),H));}
 if(L.gafas){const g=col('gafas',L.gafas,'negras');for(const s of [1,-1])add(boxGeo([s*.13,hy+.04,.32],[.17,.13,.02],g,H));add(boxGeo([0,hy+.08,.32],[.1,.025,.02],g,H));}
 if(L.mochila){const g=col('mochila',L.mochila,'café');add(boxGeo([0,1.62,to[2]-.4],[.56,.62,.26],g,I('Torso')));add(boxGeo([0,1.5,to[2]-.55],[.4,.26,.08],dark(g,.85),I('Torso')));}
 return out;}

// Una persona: una copia del esqueleto del paquete con UNA malla nueva (las piezas), su mezclador y sus acciones;
// lo mismo que makeCharacter (characters3d.js), así la mueve el mismo código.
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
export async function makePersona(look={},rand=Math.random,{scale=.52}={}){const t=await loadSkeleton(),root=cloneSkinned(t.scene),ms=[];root.traverse(o=>{if(o.isSkinnedMesh)ms.push(o);});
 const m=ms[0],sk=m.skeleton,B={pos:{},idx:{}};
 sk.bones.forEach((b,i)=>{const M=new THREE.Matrix4().copy(sk.boneInverses[i]).invert(),p=new THREE.Vector3().setFromMatrixPosition(M).applyMatrix4(m.bindMatrixInverse);B.pos[b.name]=p.toArray();B.idx[b.name]=i;});
 const geo=mergeGeometries(personaGeometry(look,B));geo.computeVertexNormals();geo.computeBoundingSphere();
 const mesh=new THREE.SkinnedMesh(geo,MAT);mesh.bind(sk,m.bindMatrix);mesh.castShadow=true;mesh.frustumCulled=false;m.parent.add(mesh);for(const o of ms)o.parent.remove(o);
 const holder=new THREE.Group();holder.add(root);root.scale.setScalar(scale*(look.talla||1));
 const mixer=new THREE.AnimationMixer(root),clip=n=>THREE.AnimationClip.findByName(t.clips,n);
 const acts={idle:mixer.clipAction(clip('Idle')),walk:mixer.clipAction(clip('Walk')),run:mixer.clipAction(clip('Run'))};acts.idle.play();acts.idle.time=rand()*acts.idle.getClip().duration;
 return {holder,mixer,acts,state:'idle',tris:geo.attributes.position.count/3,clips:t.clips};}

// (para medir: los triángulos de cada parte —material— de un modelo del paquete)
export async function partInfo(name){const g=await new GLTFLoader().loadAsync('/models/personajes/'+name+'.gltf'),out={};
 g.scene.traverse(o=>{if(o.isMesh){const n=o.material.name,t=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;out[n]=(out[n]||0)+t;}});
 return out;}

// ---------- Versión 2 (2026-10-12): apoyada en los modelos del paquete ----------
// Las cajas solas se veían cuadradas. Ahora el cuerpo y la ropa salen del modelo del paquete (su forma redondeada: la
// camiseta con mangas, el pantalón, el cinturón), todo junto en UNA malla pintada por parte (colores por vértice); lo
// que pesaba —el pelo del paquete, 3.000 a 4.500 triángulos— se cambia por peinados propios de cajas con bordes
// redondeados, medidos sobre la cabeza del modelo. Los accesorios, también redondeados.
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {PARTS} from '../engine/vestuario.js';
const MODELS=new Map();
const loadModel=name=>{if(!MODELS.has(name))MODELS.set(name,new GLTFLoader().loadAsync('/models/personajes/'+name+'.gltf'));return MODELS.get(name);};
// Una caja redondeada con piel (rígida, en el hueso bone) y su color.
function rboxGeo(center,size,color,bone,r=.06,quat=null){let g=new RoundedBoxGeometry(size[0],size[1],size[2],2,Math.min(r,size[0]/2-.001,size[1]/2-.001,size[2]/2-.001));g=nonIdx(g);g.deleteAttribute('uv');
 g.applyMatrix4(new THREE.Matrix4().compose(V(...center),quat||new THREE.Quaternion(),V(1,1,1)));
 const n=g.attributes.position.count,c=new THREE.Color(color),cl=new Float32Array(n*3),si=new Uint16Array(n*4),sw=new Float32Array(n*4);
 for(let i=0;i<n;i++){cl[i*3]=c.r;cl[i*3+1]=c.g;cl[i*3+2]=c.b;si[i*4]=bone;sw[i*4]=1;}
 g.setAttribute('color',new THREE.BufferAttribute(cl,3));g.setAttribute('skinIndex',new THREE.BufferAttribute(si,4));g.setAttribute('skinWeight',new THREE.BufferAttribute(sw,4));return g;}
// La caja de los vértices que mueve sobre todo el hueso j (espacio del modelo, pose de origen).
function boneBounds(geos,j){const b=new THREE.Box3(),v=new THREE.Vector3();for(const g of geos){const P=g.attributes.position,J=g.attributes.skinIndex,Wt=g.attributes.skinWeight;
  for(let i=0;i<P.count;i++){let best=0,bj=-1;for(let k=0;k<4;k++){const w=Wt.getComponent(i,k);if(w>best){best=w;bj=J.getComponent(i,k);}}if(bj===j)b.expandByPoint(v.fromBufferAttribute(P,i));}}return b;}
const ROLE_PAINT={top:'top',inner:'inner',pants:'pants',belt:'belt',detail:'detail',hat:'hat'};
// El pelo de un modelo del paquete, simplificado (2026-10-12): su forma, con ~700 triángulos en vez de 3.000 a 4.500
// (SimplifyModifier, meshoptimizer). Sin la zona de la barba (los que la traen en el mismo pelo: vikingo, mago).
// Una vez por modelo; queda en el espacio del modelo (todos los del paquete comparten la cabeza).
import {SimplifyModifier} from 'three/addons/modifiers/SimplifyModifier.js';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
const HAIR=new Map();
export function hairFrom(model,target=700){const key=model+'|'+target;if(!HAIR.has(key))HAIR.set(key,(async()=>{const g=await loadModel(model);let src=null;
  g.scene.traverse(o=>{if(o.isMesh&&o.material.name==='Hair'&&!src)src=o;});if(!src)return null;
  let geo=new THREE.BufferGeometry();geo.setAttribute('position',src.geometry.attributes.position.clone());if(src.geometry.index)geo.setIndex(src.geometry.index.clone());
  geo=mergeVertices(geo);const tris=geo.index.count/3;
  if(tris>target)geo=await new SimplifyModifier().modify(geo,Math.floor(geo.attributes.position.count*(1-target/tris)));
  geo=geo.index?geo.toNonIndexed():geo;geo.computeVertexNormals();return geo;})());return HAIR.get(key);}
// ---------- Las piezas del vestuario, copiadas y simplificadas (2026-10-12) ----------
// Cualquier pieza de engine/vestuario.js PIECES (pelo, sombrero, bigote, bufanda, encima, arriba, pantalón): las partes
// del modelo de donde sale, sólo lo que mueven sus huesos (bones) y sólo la zona de la cabeza (region: scalp, beard,
// beardShort, como en outfit3d), soldada y simplificada si pasa de `max` triángulos. Conserva la piel (los pesos de
// cada vértice, con los huesos por nombre en el orden del esqueleto base): la ropa se dobla con el cuerpo. Una vez
// por pieza: es nuestro catálogo, sacado del paquete.
import {pieceById,WARDROBE} from '../engine/vestuario.js';
const stripB=n=>n.replace(/_\d+$/,'').replace(/\.?[LR]$/,'');
const inBeard=c=>c.y<.27&&c.z>.12&&Math.abs(c.x)<.42,REGION={scalp:c=>!inBeard(c),beard:inBeard,beardShort:c=>inBeard(c)&&c.y>.04};
const PIECE_GEO=new Map();
// ---------- El catálogo de pelos y barbas, desacoplado (2026-10-12) ----------
// scripts/extraer-pelos.mjs saca del paquete cada pelo y barba, en coordenadas de la CABEZA y ya simplificado
// (public/models/pelos: 37 piezas, 840 KB; los modelos enteros pesan 99 MB). Acá se lee y se lleva a la pose de atado
// del muñeco con la matriz de atado de su cabeza: sirve para cualquier esqueleto con hueso Head, sin el modelo de
// origen. Atado entero a la cabeza (peso 1).
let PELOS_INDEX=null;
export function pelosIndex(){return PELOS_INDEX??=fetch('/models/pelos/index.json').then(r=>r.ok?r.json():[]).catch(()=>[]);}
async function catalogPiece(id,pc,cu=null,pulido=true){const list=await pelosIndex(),e=list.find(x=>x.id===id);if(!e)return null;
 const [d,t]=await Promise.all([fetch('/models/pelos'+(pulido?'_suaves':'')+'/'+e.file).then(r=>r.json()),loadSkeleton(cu)]);let sk=null;t.scene.traverse(o=>{if(o.isSkinnedMesh&&!sk)sk=o.skeleton;});
 const H=sk.bones.findIndex(b=>b.name==='Head'),M=new THREE.Matrix4().copy(sk.boneInverses[H]).invert();
 let g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(d.pos,3));g.setIndex(d.idx);g.applyMatrix4(M);g=g.toNonIndexed();
 const n=g.attributes.position.count,si=new Uint16Array(n*4),sw=new Float32Array(n*4);for(let i=0;i<n;i++){si[i*4]=H;sw[i*4]=1;}
 g.setAttribute('skinIndex',new THREE.BufferAttribute(si,4));g.setAttribute('skinWeight',new THREE.BufferAttribute(sw,4));
 return {pc,parts:[{part:pc.parts[0],geo:g,color:d.color,tris:n/3}]};}
// Las partes de un modelo, desacopladas (scripts/extraer-pelos.mjs → public/models/partes/<Modelo>.json): ropa, cara,
// sombreros… en la pose de atado y con pesos por nombre de hueso. Se arman como «mallas livianas» con la misma forma
// que las del .gltf (material, geometría, esqueleto) para que el resto del código no cambie; los huesos ya en el orden
// del esqueleto base. Si falta el archivo, se usa el modelo entero.
const PARTS_LITE=new Map();
export function loadParts(model,cu=null,pulido=true){const pk=model+'|'+(cu||'')+'|'+pulido;if(PARTS_LITE.has(pk))return PARTS_LITE.get(pk);
 const pr=(async()=>{const dir=pulido?await polishedPartsFolder(model,cu):'partes'+(cu?'_'+cu:'');const r=await fetch('/models/'+dir+'/'+model+'.json').catch(()=>null);if(!r||!r.ok)return null;const d=await r.json(),t=await loadSkeleton(cu);let sk=null;t.scene.traverse(o=>{if(o.isSkinnedMesh&&!sk)sk=o.skeleton;});
  // (three renombra los huesos repetidos: el «Body» del glTF es «Body_1»)
  const byName=new Map(sk.bones.map((b,i)=>[b.name.replace(/_\d+$/,''),i])),remap=d.joints.map(n=>byName.get(n)??0),meshes=[];
  for(const p of d.parts){const g=new THREE.BufferGeometry(),n=p.pos.length/3,si=new Uint16Array(n*4);for(let i=0;i<n*4;i++)si[i]=remap[p.ji[i]]??0;
   g.setAttribute('position',new THREE.Float32BufferAttribute(p.pos,3));g.setAttribute('skinIndex',new THREE.BufferAttribute(si,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(p.w,4));g.setIndex(p.idx);
   meshes.push({isSkinnedMesh:true,lite:true,material:{name:p.name,color:new THREE.Color(p.color)},geometry:g,skeleton:sk});}
  return {scene:{traverse:fn=>meshes.forEach(fn)},meshes,animations:[]};})();
 PARTS_LITE.set(pk,pr);return pr;}
export function pieceGeo(id,max=900,cu=null,pulido=true){const key=id+'|'+max+'|'+(cu||'')+'|'+pulido;if(PIECE_GEO.has(key))return PIECE_GEO.get(key);
 const pr=(async()=>{const pc=pieceById(id);if(!pc)return null;
  // (pelos y barbas: del catálogo desacoplado si está —un archivo chico por pieza, sin cargar el modelo entero—)
  if(/^(pelo|bigote):/.test(id)){const c=await catalogPiece(id,pc,cu,pulido);if(c)return c;}
  const [g,t]=await Promise.all([loadParts(pc.m,cu,pulido).then(x=>x||loadModel(pc.m)),loadSkeleton(cu)]),base=[];t.scene.traverse(o=>{if(o.isSkinnedMesh)base.push(o);});
  const order=base[0].skeleton.bones.map(b=>b.name),out=[];
  g.scene.traverse(src=>{if(!src.isSkinnedMesh||!pc.parts.includes(src.material.name))return;let G=src.geometry;const suitRole=PARTS[pc.m]?.top===src.material.name?'top':PARTS[pc.m]?.detail===src.material.name?'detail':null;const section=pc.section||(/^Suit_/.test(pc.m)&&pc.bones?(pc.bones.includes('Torso')?'top':'pants'):null);if(suitRole&&(section||suitRole==='detail')){const pieces=splitClothing(G.index?G.toNonIndexed():G,src.skeleton,pc.m,suitRole);const chosen=pieces.filter(p=>p.role===(section||'detail'));if(!chosen.length)return;G=mergeGeometries(chosen.map(p=>p.g));}const P=G.attributes.position,J=G.attributes.skinIndex,W=G.attributes.skinWeight,bones=src.skeleton.bones;
   const I=G.index?G.index.array:[...Array(P.count).keys()],remap=bones.map(b=>Math.max(0,order.indexOf(b.name))),hj=bones.findIndex(b=>b.name==='Head'),inv=hj>=0?src.skeleton.boneInverses[hj]:null,test=pc.region&&REGION[pc.region];
   const dom=i=>{let best=0,bj=0;for(let k=0;k<4;k++){const w=W.getComponent(i,k);if(w>best){best=w;bj=J.getComponent(i,k);}}return stripB(bones[bj]?.name||'');};
   const keep=[],c=new THREE.Vector3(),v=new THREE.Vector3();
   for(let q=0;q<I.length;q+=3){if(pc.bones&&!section){const b=[dom(I[q]),dom(I[q+1]),dom(I[q+2])];if(!b.some(x=>pc.bones.includes(x)))continue;}
    if(test&&inv){c.set(0,0,0);for(let k=0;k<3;k++)c.add(v.fromBufferAttribute(P,I[q+k]));c.multiplyScalar(1/3).applyMatrix4(inv);if(!test(c))continue;}keep.push(I[q],I[q+1],I[q+2]);}
   if(!keep.length)return;
   // (sólo posición y piel; los índices de hueso, en el orden del esqueleto base)
   const n=P.count,si=new Uint16Array(n*4),sw=new Float32Array(n*4);for(let i=0;i<n;i++)for(let k=0;k<4;k++){si[i*4+k]=remap[J.getComponent(i,k)]??0;sw[i*4+k]=W.getComponent(i,k);}
   let gg=new THREE.BufferGeometry();gg.setAttribute('position',P.clone());gg.setAttribute('skinIndex',new THREE.BufferAttribute(si,4));gg.setAttribute('skinWeight',new THREE.BufferAttribute(sw,4));gg.setIndex(keep);
   out.push({part:src.material.name,geo:gg,color:'#'+src.material.color.getHexString()});});
  for(const o of out){let gg=mergeVertices(o.geo);const tris=gg.index.count/3;if(tris>max)gg=await new SimplifyModifier().modify(gg,Math.floor(gg.attributes.position.count*(1-max/tris)));
   gg=gg.index?gg.toNonIndexed():gg;gg.computeVertexNormals();o.geo=gg;o.tris=gg.attributes.position.count/3;}
  return {pc,parts:out};})();
 PIECE_GEO.set(key,pr);return pr;}
// Los mechones de un pelo: los triángulos unidos por vértices (misma posición), cada grupo un mechón.
function locksOf(g){const P=g.attributes.position,n=P.count/3,par=[...Array(n).keys()],f=x=>{while(par[x]!==x)x=par[x]=par[par[x]];return x;},seen=new Map();
 for(let t=0;t<n;t++)for(let k=0;k<3;k++){const i=t*3+k,key=Math.round(P.getX(i)*1e4)+','+Math.round(P.getY(i)*1e4)+','+Math.round(P.getZ(i)*1e4);if(seen.has(key)){const a=f(seen.get(key)),b=f(t);if(a!==b)par[a]=b;}else seen.set(key,t);}
 return par.map((_,t)=>f(t));}
// ---------- Moldes de mechón (2026-10-12) ----------
// Los mechones del paquete como molde (Miguel: «copia los del modelo, hay varios ejemplos»): de varios pelos se sacan
// los mechones (locksOf) y cada uno se guarda en sus propias coordenadas —t: de la raíz (0) a la punta (1); s: el ancho
// (−1…1); h: el grosor (−1…1)—. La raíz es la punta más ancha (los mechones nacen anchos y terminan en punta). Después
// cada mechón que pone un peinado propio toma un molde al azar y lo dobla a lo largo de su recorrido.
const TPL_MODELS=['Casual2_Male','Casual_Male','Casual3_Male','Cowboy_Hair','Ninja_Male_Hair','Suit_Male','Doctor_Male_Young','Casual_Female','Casual2_Female','Viking_Female'];
let TPL=null;
export function lockTemplates(){if(TPL)return TPL;TPL=(async()=>{const out=[],v=new THREE.Vector3(),c=new THREE.Vector3(0,2.63,0);
 for(const m of TPL_MODELS){const pg=await pieceGeo('pelo:'+m);const g=pg?.parts?.[0]?.geo;if(!g)continue;const P=g.attributes.position,comp=locksOf(g),by=new Map();
  for(let t=0;t<P.count/3;t++){const k=comp[t];if(!by.has(k))by.set(k,[]);by.get(k).push(t);}
  for(const tris of by.values()){if(tris.length<24||tris.length>140)continue;const V=[];for(const t of tris)for(let k=0;k<3;k++)V.push(new THREE.Vector3().fromBufferAttribute(P,t*3+k));
   const cen=V.reduce((a,b)=>a.add(b),new THREE.Vector3()).multiplyScalar(1/V.length);let A=V[0],B=V[0];for(const q of V)if(q.distanceToSquared(cen)>A.distanceToSquared(cen))A=q;for(const q of V)if(q.distanceToSquared(A)>B.distanceToSquared(A))B=q;
   let ax=B.clone().sub(A);const len=ax.length();if(len<.2)continue;ax.normalize();
   // (¿qué punta es la raíz? la más ancha)
   const spread=(o,dir,lo,hi)=>{let s2=0,n=0;for(const q of V){const d=q.clone().sub(o),t=d.dot(dir)/len;if(t<lo||t>hi)continue;s2+=d.addScaledVector(dir,-d.dot(dir)*1).length();n++;}return n?s2/n:0;};
   let root=A;if(spread(A,ax,0,.25)<spread(B,ax.clone().negate(),0,.25)){root=B;ax.negate();}
   let side=null,best=-1;for(const q of V){const d=q.clone().sub(root);d.addScaledVector(ax,-d.dot(ax));if(d.length()>best){best=d.length();side=d.clone().normalize();}}
   const nr=new THREE.Vector3().crossVectors(ax,side).normalize();if(nr.dot(cen.clone().sub(c))<0)nr.negate();
   const hand=Math.sign(new THREE.Vector3().crossVectors(side,nr).dot(ax));
   const T=new Float32Array(V.length*3);for(let i=0;i<V.length;i++){const d=V[i].clone().sub(root);T[i*3]=d.dot(ax)/len;T[i*3+1]=d.dot(side);T[i*3+2]=d.dot(nr);}
   // (sin la curva propia del mechón: el centro de cada tramo se lleva al eje; queda la forma de la sección —ancho, grosor
   // y cómo se afina—, que es lo que se copia; la curva la pone el recorrido del peinado)
   const NB=8,cs=Array.from({length:NB},()=>[0,0,0]);for(let i=0;i<V.length;i++){const b=Math.min(NB-1,Math.max(0,Math.floor(T[i*3]*NB)));cs[b][0]+=T[i*3+1];cs[b][1]+=T[i*3+2];cs[b][2]++;}
   for(const c2 of cs)if(c2[2]){c2[0]/=c2[2];c2[1]/=c2[2];}for(let b=0;b<NB;b++)if(!cs[b][2])cs[b]=b?cs[b-1]:cs.find(x=>x[2])||[0,0,1];
   const cAt=t=>{const x=Math.min(NB-1,Math.max(0,t*NB-.5)),b0=Math.floor(x),b1=Math.min(NB-1,b0+1),a=x-b0;return [cs[b0][0]+(cs[b1][0]-cs[b0][0])*a,cs[b0][1]+(cs[b1][1]-cs[b0][1])*a];};
   let ms=1e-6,mh=1e-6;for(let i=0;i<V.length;i++){const [c0,c1]=cAt(T[i*3]);T[i*3+1]-=c0;T[i*3+2]-=c1;ms=Math.max(ms,Math.abs(T[i*3+1]));mh=Math.max(mh,Math.abs(T[i*3+2]));}
   for(let i=0;i<V.length;i++){T[i*3+1]/=ms;T[i*3+2]/=mh;}if(mh/ms<.15)continue;/* (los demasiado planos no sirven de molde) */out.push({T,thick:mh/ms,hand,from:m});}}
 return out;})();return TPL;}
// (intersección y unión suaves de dos zonas continuas: la esquina sale redondeada, de radio ~.04)
const smn=(a,b)=>(a+b-Math.sqrt((a-b)**2+.0016))/2,smx=(a,b)=>(a+b+Math.sqrt((a-b)**2+.0016))/2;
// (una geometría sin índices con sólo los triángulos que empiezan en esos vértices)
function keepTris(g,keep){const ng=new THREE.BufferGeometry();for(const a of Object.keys(g.attributes)){const A=g.attributes[a],arr=new A.array.constructor(keep.length*3*A.itemSize);
  keep.forEach((i,j)=>{for(let k=0;k<3;k++)for(let c=0;c<A.itemSize;c++)arr[(j*3+k)*A.itemSize+c]=A.array[(i+k)*A.itemSize+c];});ng.setAttribute(a,new THREE.BufferAttribute(arr,A.itemSize));}return ng;}
// ---------- Estampados (2026-10-12) ----------
// Rayas o cuadros en la prenda de arriba, por triángulo (colores por vértice: no cuesta nada). El segundo color es el
// de L.estampadoColor o, si no, la misma prenda más oscura. Medido en la pose de atado (el torso va de y 1,5 a 2,2).
function paintPattern(g,kind,colB){if(!kind)return;const W=kind==='rayas_finas'?.08:kind==='cuadros'?.17:kind==='franja'?.145:.15,b=new THREE.Color(colB);
 // (los triángulos se parten justo en el borde de cada raya o cuadro —planos y = k·W y, en los cuadros, x+z = k·W—:
 // pintados enteros por su centro salían mosaicos)
 const planes=kind==='cuadros'?[v=>v[1],v=>v[0]]:[v=>v[1]];const A=Object.keys(g.attributes),src=A.map(k=>g.attributes[k]);
 let tris=[];for(let t=0;t<g.attributes.position.count;t+=3)tris.push([0,1,2].map(k=>src.map(a=>Array.from({length:a.itemSize},(_,c)=>a.array[(t+k)*a.itemSize+c]))));
 const pi=A.indexOf('position'),ci=A.indexOf('color'),lerpV=(x,y,w)=>x.map((xa,ai)=>A[ai]==='skinIndex'?(w<.5?xa:y[ai]).slice():xa.map((v,c)=>v+(y[ai][c]-v)*w));
 for(const f of planes){const out=[];for(const t of tris){const val=t.map(v=>f(v[pi])/W),lo=Math.floor(Math.min(...val)),hi=Math.floor(Math.max(...val));if(lo===hi){out.push(t);continue;}
   let pieces=[t];for(let k=lo+1;k<=hi;k++){const nx=[];for(const q of pieces){const sv=q.map(v=>f(v[pi])/W-k),pos=[],neg=[];
     for(let e=0;e<3;e++){const a=q[e],c=q[(e+1)%3],sa=sv[e],sc=sv[(e+1)%3];(sa>=0?pos:neg).push(a);if((sa>=0)!==(sc>=0)){const m=lerpV(a,c,sa/(sa-sc));pos.push(m);neg.push(m);}}
     for(const poly of [pos,neg])for(let j=1;j+1<poly.length;j++)nx.push([poly[0],poly[j],poly[j+1]]);}pieces=nx;}out.push(...pieces);}tris=out;}
 // (cada triángulo con sus propios vértices: los partidos comparten vértices con el de al lado y pintar uno manchaba al otro)
 tris=tris.map(t=>t.map(v=>v.slice()));
 for(const t of tris){const c=t.map(v=>v[pi]).reduce((s2,v)=>[s2[0]+v[0]/3,s2[1]+v[1]/3,s2[2]+v[2]/3],[0,0,0]);
  // (la franja: una sola banda ancha a la altura del pecho, y = 1,6–1,74; medido: los hombros van por 1,85)
  const on=kind==='cuadros'?(Math.floor(c[1]/W)+Math.floor(c[0]/W))%2===0:kind==='franja'?Math.floor(c[1]/W)===11:Math.floor(c[1]/W)%2===0;if(on)for(const v of t)v[ci]=[b.r,b.g,b.b];}
 A.forEach((k,ai)=>{const a=src[ai],arr=new a.array.constructor(tris.length*3*a.itemSize);let o=0;for(const t of tris)for(const v of t)for(const x of v[ai])arr[o++]=x;g.setAttribute(k,new THREE.BufferAttribute(arr,a.itemSize,a.normalized));});}
// Partir y pintar (2026-10-12): parte los triángulos de g en los planos f(v) = cada valor de vals (por cada corte) y
// pinta cada pedazo con pick(centro, normal) → [r,g,b] o null (no cambia). Bordes limpios, como los estampados.
function cutAndPaint(g,cuts,pick){const A=Object.keys(g.attributes),src=A.map(k=>g.attributes[k]),pi=A.indexOf('position'),ci=A.indexOf('color');if(ci<0)return;
 let tris=[];for(let t=0;t<g.attributes.position.count;t+=3)tris.push([0,1,2].map(k=>src.map(a=>Array.from({length:a.itemSize},(_,c)=>a.array[(t+k)*a.itemSize+c]))));
 const lerpV=(x,y,w)=>x.map((xa,ai)=>A[ai]==='skinIndex'?(w<.5?xa:y[ai]).slice():xa.map((v,c)=>v+(y[ai][c]-v)*w));
 for(const {f,vals} of cuts)for(const k of vals){const nx=[];for(const q of tris){const sv=q.map(v=>f(v[pi])-k);if(sv.every(x=>x>=0)||sv.every(x=>x<0)){nx.push(q);continue;}const pos=[],neg=[];
   for(let e=0;e<3;e++){const a=q[e],c=q[(e+1)%3],sa=sv[e],sc=sv[(e+1)%3];(sa>=0?pos:neg).push(a);if((sa>=0)!==(sc>=0)){const m=lerpV(a,c,sa/(sa-sc));pos.push(m);neg.push(m);}}
   for(const poly of [pos,neg])for(let j=1;j+1<poly.length;j++)nx.push([poly[0],poly[j],poly[j+1]]);}tris=nx;}
 tris=tris.map(t=>t.map(v=>v.slice()));const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
 for(const t of tris){a.fromArray(t[0][pi]);b.fromArray(t[1][pi]);c.fromArray(t[2][pi]);const cen=a.clone().add(b).add(c).multiplyScalar(1/3),n=c.clone().sub(b).cross(a.clone().sub(b)).normalize();
  const col=pick(cen,n,t[0][ci]);if(col)for(const v of t)v[ci]=col;}
 A.forEach((k,ai)=>{const s2=src[ai],arr=new s2.array.constructor(tris.length*3*s2.itemSize);let o=0;for(const t of tris)for(const v of t)for(const x of v[ai])arr[o++]=x;g.setAttribute(k,new THREE.BufferAttribute(arr,s2.itemSize,s2.normalized));});}
// El pantalón (2026-10-12): jean gastado (más claro en la rodilla y el frente del muslo), bota doblada (una banda clara
// abajo, sólo si es largo) y bolsillos de atrás (más oscuros). knee / hip: la altura de la rodilla y la cadera.
function paintPants(g,{gastado,bota,bolsillos},knee,hip){if(!(gastado||bota||bolsillos))return;const P=g.attributes.position;let minY=Infinity;for(let i=0;i<P.count;i++)minY=Math.min(minY,P.getY(i));
 const largo=minY<knee-.25,vals=[];if(gastado)vals.push(knee-.1,knee+.3);if(bota&&largo)vals.push(minY+.08);if(bolsillos)vals.push(hip-.16,hip+.04);
 // (aclarar u oscurecer como se ve: en sRGB, hacia el blanco o el negro; el color de los vértices es lineal y multiplicarlo casi no se notaba en un jean oscuro)
 const sc=(c,k)=>c.map(x=>{const s2=Math.pow(x,1/2.2),v=k>0?s2+(1-s2)*k:s2*(1+k);return Math.pow(v,2.2);});
 cutAndPaint(g,[{f:v=>v[1],vals},...(bolsillos?[{f:v=>Math.abs(v[0]),vals:[.08,.3]}]:[])],(cen,n,c0)=>{
  if(bota&&largo&&cen.y<minY+.08)return sc(c0,.28);
  if(bolsillos&&n.z<-.4&&cen.y>hip-.16&&cen.y<hip+.04&&Math.abs(cen.x)>.08&&Math.abs(cen.x)<.3)return sc(c0,-.35);
  if(gastado&&n.z>.25&&cen.y>knee-.1&&cen.y<knee+.3)return sc(c0,cen.y<knee+.08?.32:.18);return null;});}
// Mangas y cuello de otro color (2026-10-12): las mangas son los triángulos que mueve sobre todo el brazo (arm: los
// índices de UpperArm y LowerArm); el cuello, una banda de 6 cm desde lo más alto de la prenda (cortada en el borde).
function paintTrim(g,arm,mangas,cuello){const P=g.attributes.position,Cl=g.attributes.color,J=g.attributes.skinIndex,W=g.attributes.skinWeight;if(!Cl)return;
 if(mangas){const m=new THREE.Color(mangas);for(let t=0;t<P.count;t+=3){let n=0;for(let k=0;k<3;k++){let b=0,bj=-1;for(let q=0;q<4;q++){const w=W.getComponent(t+k,q);if(w>b){b=w;bj=J.getComponent(t+k,q);}}if(arm.has(bj))n++;}
  if(n>=2)for(let k=0;k<3;k++)Cl.setXYZ(t+k,m.r,m.g,m.b);}Cl.needsUpdate=true;}
 if(cuello){let top=-Infinity;for(let i=0;i<P.count;i++){const x=Math.abs(P.getX(i));if(x<.5)top=Math.max(top,P.getY(i));}const y0=top-.06,c=new THREE.Color(cuello);
  for(let t=0;t<P.count;t+=3){let hi=0;for(let k=0;k<3;k++)if(P.getY(t+k)>y0&&Math.abs(P.getX(t+k))<.5)hi++;if(hi>=2)for(let k=0;k<3;k++)Cl.setXYZ(t+k,c.r,c.g,c.b);}Cl.needsUpdate=true;}}
// La falda sigue al muslo: a medias de pie (se mece) y casi entero cuando el muslo se levanta (sentado: queda sobre las
// piernas en vez de colgar por debajo del asiento). Se llama después de cada update del mezclador.
export function followSkirt(root){const pairs=[];root.traverse(o=>{if(o.isBone&&/^Skirt[LR]$/.test(o.name)){const ul=o.parent.children.find(c=>c.isBone&&c.name==='UpperLeg'+o.name.slice(-1));if(ul)pairs.push([o,ul,o.userData.restQ?new THREE.Quaternion().fromArray(o.userData.restQ):ul.quaternion.clone()]);}});
 if(!pairs.length)return null;const a=new THREE.Vector3(),b=new THREE.Vector3(),dn=new THREE.Vector3(0,-1,0);
 return ()=>{for(const [sb,ul,rq] of pairs){ul.updateWorldMatrix(true,false);const kid=ul.children.find(c=>c.isBone);if(!kid)continue;ul.getWorldPosition(a);kid.getWorldPosition(b);
  const up=1-b.sub(a).normalize().dot(dn),sit=Math.min(1,Math.max(0,(up-.25)/.55)),k=sb.userData.wardrobe?1:.5+.45*sit;sb.quaternion.copy(rq).slerp(ul.quaternion,k);
  // (sentado la tela queda recogida: la falda se acorta a lo largo del muslo y no cuelga por debajo del asiento)
  sb.scale.set(1,sb.userData.wardrobe?1:1-.12*sit,1);}};}
// ---------- De lejos (2026-10-12) ----------
// La versión liviana de un muñeco para verlo de lejos: la misma malla (con su piel y sus colores) simplificada a una
// fracción de los triángulos (SimplifyModifier conserva los datos de los vértices que quedan). Se junta lo que comparte
// posición y datos antes de simplificar; queda sin índices, como la original.
// kinds (opcional, por vértice): 1 piel, 2 ropa. La piel tapada por la ropa (un vértice de ropa a menos de 9 cm del
// centro del triángulo) se saca antes: simplificadas por separado, la piel atravesaba la tela.
export async function lowGeo(geo,ratio=.4,kinds=null){let g=new THREE.BufferGeometry();for(const k of ['position','color','skinIndex','skinWeight'])if(geo.attributes[k])g.setAttribute(k,geo.attributes[k].clone());
 if(geo.morphAttributes.position?.[0])g.setAttribute('seatDelta',geo.morphAttributes.position[0].clone());
 if(kinds){const P=g.attributes.position,C=.075,grid=new Map(),key=(x,y,z)=>Math.floor(x/C)+','+Math.floor(y/C)+','+Math.floor(z/C);
  for(let i=0;i<P.count;i++)if(kinds[i]===2){const k=key(P.getX(i),P.getY(i),P.getZ(i));if(!grid.has(k))grid.set(k,[]);grid.get(k).push(i);}
  // (tapado: los TRES vértices del triángulo tienen un vértice de ropa a menos de 7,5 cm)
  const under=i=>{const x=P.getX(i),y=P.getY(i),z=P.getZ(i),cx=Math.floor(x/C),cy=Math.floor(y/C),cz=Math.floor(z/C);
   for(let a2=-1;a2<=1;a2++)for(let b2=-1;b2<=1;b2++)for(let c2=-1;c2<=1;c2++){const L2=grid.get((cx+a2)+','+(cy+b2)+','+(cz+c2));if(!L2)continue;for(const j of L2){const dx=P.getX(j)-x,dy=P.getY(j)-y,dz=P.getZ(j)-z;if(dx*dx+dy*dy+dz*dz<C*C)return true;}}return false;};
  const keep=[];for(let t=0;t<P.count;t+=3){if(kinds[t]===1&&under(t)&&under(t+1)&&under(t+2))continue;keep.push(t);}
  g=keepTris(g,keep);}
 g=mergeVertices(g,1e-4);const n=g.attributes.position.count,tris=g.index.count/3;g=await new SimplifyModifier().modify(g,Math.floor(n*(1-ratio)));
 if(g.index)g=g.toNonIndexed();if(g.attributes.seatDelta){g.morphAttributes.position=[g.attributes.seatDelta];g.morphAttributes.position[0].name='Sentado';g.morphTargetsRelative=true;g.deleteAttribute('seatDelta');}g.computeBoundingSphere();return g;}
// ---------- La ropa encima del cuerpo (2026-10-12) ----------
// El cuerpo va siempre entero (desnudo) y la ropa encima, ajustada a él: 1) cada vértice de la ropa toma los pesos del
// punto del cuerpo más cercano (así se dobla igual que la piel y la piel no la atraviesa al moverse, y sigue al cuerpo
// cuando cambia la contextura); 2) lo que queda adentro del cuerpo, o a menos de «holgura», sale por la normal de la piel.
// Antes la piel se recortaba bajo la ropa y por los huecos de la ropa se veía a través.
export function fitCloth(skinGeo,cloth,gap=.03){const P=skinGeo.attributes.position,J=skinGeo.attributes.skinIndex,W=skinGeo.attributes.skinWeight;
 // los puntos únicos de la piel, con su normal suave (la suma de las caras que lo usan)
 const key=i=>Math.round(P.getX(i)*1e3)+','+Math.round(P.getY(i)*1e3)+','+Math.round(P.getZ(i)*1e3),at=new Map(),pts=[];const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),n=new THREE.Vector3();
 for(let t=0;t<P.count;t+=3){a.fromBufferAttribute(P,t);b.fromBufferAttribute(P,t+1);c.fromBufferAttribute(P,t+2);n.subVectors(c,b).cross(a.clone().sub(b));
  for(let k=0;k<3;k++){const i=t+k,kk=key(i);let e=at.get(kk);if(!e){e={p:new THREE.Vector3().fromBufferAttribute(P,i),n:new THREE.Vector3(),j:[0,1,2,3].map(q=>J.getComponent(i,q)),w:[0,1,2,3].map(q=>W.getComponent(i,q))};at.set(kk,e);pts.push(e);}e.n.add(n);}}
 for(const e of pts)e.n.normalize();
 // (grilla para buscar el más cercano)
 const C=.15,grid=new Map(),gk=(x,y,z)=>x+','+y+','+z;for(const e of pts){const k=gk(Math.floor(e.p.x/C),Math.floor(e.p.y/C),Math.floor(e.p.z/C));if(!grid.has(k))grid.set(k,[]);grid.get(k).push(e);}
 const near=q=>{const x0=Math.floor(q.x/C),y0=Math.floor(q.y/C),z0=Math.floor(q.z/C);let best=null,bd=Infinity;for(let r=1;r<=3&&!best;r++)for(let x=x0-r;x<=x0+r;x++)for(let y=y0-r;y<=y0+r;y++)for(let z=z0-r;z<=z0+r;z++){const L2=grid.get(gk(x,y,z));if(!L2)continue;for(const e of L2){const d=e.p.distanceToSquared(q);if(d<bd){bd=d;best=e;}}}return best;};
 const q=new THREE.Vector3();
 for(const g of cloth){const Q=g.attributes.position,CJ=g.attributes.skinIndex,CW=g.attributes.skinWeight;
  // (las faldas conservan sus pesos: copiar los de la piel las partía en dos al caminar)
  const keep=/^Falda/.test(g.userData.part||'');
  for(let i=0;i<Q.count;i++){q.fromBufferAttribute(Q,i);const e=near(q);if(!e)continue;
   if(!keep){CJ.setXYZW(i,...e.j);CW.setXYZW(i,...e.w);}
   if(keep)continue;// (la falda ya viene a la medida: empujarla hacia afuera de cada pierna la dejaba dentada)
   const gp=g.userData.holgura??gap,d=q.clone().sub(e.p).dot(e.n);if(d<gp){q.addScaledVector(e.n,gp-d);Q.setXYZ(i,q.x,q.y,q.z);}}
  Q.needsUpdate=CJ.needsUpdate=CW.needsUpdate=true;}}
// ---------- Los pesos de la piel (2026-10-12) ----------
// Los del paquete tienen fugas (el muslo mueve un poco el costado del torso, el hombro la cadera) y reparten el codo y
// la rodilla por todo el hueso (el brazo de arriba se dobla un poco con el antebrazo: se ve de goma). 1) Cada vértice
// se queda sólo con los huesos a dos pasos o menos del que más lo mueve. 2) En el codo y la rodilla el peso pasa del
// hueso de arriba al de abajo en una franja de ±JOINT_BAND alrededor de la articulación (suave), y fuera de ella cada
// tramo es rígido; la esfera de la articulación rellena lo que se angosta al doblar.
const JOINT_BAND=.12;
export function cleanWeights(geo,sk){const B=sk.bones,par=B.map(b=>B.indexOf(b.parent)),dist=(a,b)=>{const up=new Map();let x=a,d=0;while(x>=0){up.set(x,d++);x=par[x];}x=b;d=0;while(x>=0){if(up.has(x))return up.get(x)+d;x=par[x];d++;}return 99;};
 const near=new Map(),ok=(a,b)=>{const k=a*64+b;if(!near.has(k))near.set(k,dist(a,b)<=2);return near.get(k);};
 const O=B.map((b,j)=>new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(sk.boneInverses[j]).invert()));
 const PAIRS=new Map();for(const n of ['LowerArmL','LowerArmR','LowerLegL','LowerLegR']){const c=B.findIndex(b=>b.name===n),pa=par[c];if(c<0||pa<0)continue;PAIRS.set(pa*64+c,{pa,c,a:O[c].clone().sub(O[pa]).normalize(),o:O[c]});}
 const P=geo.attributes.position,J=geo.attributes.skinIndex,W=geo.attributes.skinWeight,v=new THREE.Vector3(),HELPERS=B.some(b=>/^Elbow/.test(b.name));
 for(let i=0;i<P.count;i++){let bw=-1,bj=0;const js=[],ws=[];for(let k=0;k<4;k++){const w=W.getComponent(i,k),j=J.getComponent(i,k);js.push(j);ws.push(w);if(w>bw){bw=w;bj=j;}}
  let sum=0;for(let k=0;k<4;k++){if(ws[k]>0&&!ok(bj,js[k]))ws[k]=0;sum+=ws[k];}
  // ¿es un vértice del codo o la rodilla? (sólo esos dos huesos)
  const used=[...new Set(js.filter((j,k)=>ws[k]>.001))];
  if(!HELPERS&&used.length<=2){let pair=null;for(const [k,q] of PAIRS){if(used.every(j=>j===q.pa||j===q.c)){pair=q;break;}}
   if(pair){const al=v.fromBufferAttribute(P,i).sub(pair.o).dot(pair.a),t=Math.min(1,Math.max(0,(al+JOINT_BAND)/(2*JOINT_BAND))),wc=t*t*(3-2*t);
    J.setXYZW(i,pair.pa,pair.c,0,0);W.setXYZW(i,1-wc,wc,0,0);continue;}}
  if(sum>0)W.setXYZW(i,ws[0]/sum,ws[1]/sum,ws[2]/sum,ws[3]/sum);}
 W.needsUpdate=J.needsUpdate=true;return geo;}
// ---------- El cuerpo: contextura, sexo y cabeza ----------
// Se deforma la geometría ya juntada (piel, ropa, pelo y piezas a la vez, así la ropa sigue al cuerpo), en la pose de
// atado. Cada hueso engorda o adelgaza alrededor de su propio eje (de su origen hacia su hijo): w es el ancho, d el
// fondo y f lo que el frente sale de más (la barriga). Cada vértice mezcla lo que le hace cada hueso con sus pesos,
// así no quedan escalones entre huesos. La cabeza crece o se achica entera desde el cuello (y con ella el pelo y lo
// que va encima). La mano y el pie no cambian.
export const CONTEXTURAS={
 delgado:{Torso:[.8,.78],Abdomen:[.74,.72],Hips:[.84,.82],Body:[.84,.82],Shoulder:[.86,.86],UpperArm:.72,LowerArm:.8,UpperLeg:.74,LowerLeg:.8,Neck:.84},
 normal:{},
 atlético:{Torso:[1.22,1.12],Shoulder:[1.22,1.15],UpperArm:1.4,LowerArm:1.2,Abdomen:[.98,.95],Hips:[1.02,1],UpperLeg:1.15,LowerLeg:1.12,Neck:1.2},
 robusto:{Torso:[1.22,1.25,.05],Abdomen:[1.3,1.35,.15],Hips:[1.2,1.2],Body:[1.2,1.18],Shoulder:1.12,UpperArm:1.25,LowerArm:1.1,UpperLeg:1.22,LowerLeg:1.1,Neck:1.22},
 gordo:{Torso:[1.38,1.45,.12],Abdomen:[1.55,1.7,.4],Hips:[1.45,1.4,.12],Body:[1.4,1.35],Shoulder:1.18,UpperArm:1.38,LowerArm:1.15,UpperLeg:1.42,LowerLeg:1.15,Neck:1.32}};
// (sin usarse desde el 2026-10-17: la mujer es el muñeco del paquete tal cual —vestuario.js CUERPO_UNICO.ajusteMujer—)
export const MUJER={Shoulder:[.88,1],Torso:[.92,1],Abdomen:[.88,.95],Hips:[1.12,1.05],Body:[1.1,1.05],UpperLeg:[1.06,1.04],Neck:.9};
// Largos: las piernas (muslo y canilla), el tronco (cadera, abdomen y torso) y los brazos se estiran a lo largo de su
// hueso; las animaciones se ajustan aparte (largeClips) para que la cadera suba y el pie siga en el piso.
const LARGO_DE={UpperLeg:'piernas',LowerLeg:'piernas',Hips:'tronco',Abdomen:'tronco',Torso:'tronco',UpperArm:'brazos',LowerArm:'brazos'};
export function shapeBody(geo,sk,{contextura='normal',sexo='h',cabeza=1,piernas=1,tronco=1,brazos=1,acabado=true,perfil=null}={}){
 const LG={piernas,tronco,brazos};
 const tab={},mul=src=>{for(const [k,v] of Object.entries(src||{})){const [w,d,f=0]=Array.isArray(v)?v:[v,v];const t=tab[k]||(tab[k]=[1,1,0]);t[0]*=w;t[1]*=d;t[2]+=f;}};
 mul(CONTEXTURAS[contextura]);if(sexo==='m'&&CUERPO_UNICO.ajusteMujer)mul(MUJER);
 const round=acabado!==false&&(contextura==='gordo'||contextura==='robusto');if(round)for(const n of ['Torso','Abdomen','Hips','Body'])tab[n]=[1,1,0];if(!Object.keys(tab).length&&cabeza===1&&piernas===1&&tronco===1&&brazos===1)return geo;
 // (un hueso con varios hijos —la cadera, el torso— es del tronco: su eje es el vertical)
 const B=sk.bones,M=B.map((b,j)=>new THREE.Matrix4().copy(sk.boneInverses[j]).invert()),O=M.map(m=>new THREE.Vector3().setFromMatrixPosition(m));
 const hips=O[B.findIndex(b=>b.name==='Hips')],torso=O[B.findIndex(b=>b.name==='Torso')],trunk=new Set(B.map((b,j)=>['Body','Hips','Abdomen','Torso'].includes(stripB(b.name))?j:-1));
 const F=B.map((b,j)=>{const nm=stripB(b.name).replace('Skirt','UpperLeg'),kids=b.children.filter(c=>c.isBone),ci=/^Skirt/.test(b.name)?B.findIndex(x=>x.name==='LowerLeg'+b.name.slice(-1)):nm==='LowerLeg'?B.findIndex(x=>x.name==='Foot'+b.name.slice(-1)):kids.length===1?B.indexOf(kids[0]):-1/* (la canilla no tiene hijo: el pie cuelga de la raíz; su eje va hacia el pie) */,a=ci>=0?O[ci].clone().sub(O[j]):new THREE.Vector3(0,1,0);if(a.lengthSq()<1e-8)a.set(0,1,0);a.normalize();
  const dp=new THREE.Vector3(0,0,1).addScaledVector(a,-a.z);if(dp.lengthSq()<.01)dp.set(1,0,0).addScaledVector(a,-a.x);dp.normalize();const wd=new THREE.Vector3().crossVectors(a,dp).normalize();
  return {head:nm==='Head',t:tab[nm]||(LARGO_DE[nm]?[1,1,0]:null),l:LG[LARGO_DE[nm]]||1,a,dp,wd,o:O[j]};});
 const P=geo.attributes.position,J=geo.attributes.skinIndex,W=geo.attributes.skinWeight,p=new THREE.Vector3(),d=new THREE.Vector3(),acc=new THREE.Vector3(),q=new THREE.Vector3();
 const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)],rx0=perfil?THREE.MathUtils.clamp(median(perfil.sections.map(s=>s[0])),.32,.43):0,rz0=perfil?THREE.MathUtils.clamp(median(perfil.sections.map(s=>s[2])),.19,.25):0;
 for(let i=0;i<P.count;i++){p.fromBufferAttribute(P,i);acc.set(0,0,0);let ws=0;
  for(let k=0;k<4;k++){const w=W.getComponent(i,k);if(!w)continue;const f=F[J.getComponent(i,k)];ws+=w;if(!f){acc.addScaledVector(p,w);continue;}d.copy(p).sub(f.o);
   if(f.head)q.copy(f.o).addScaledVector(d,cabeza);
   else if(f.t){const al=d.dot(f.a),dw=d.dot(f.wd),dd=d.dot(f.dp);q.copy(f.o).addScaledVector(f.a,al>0?al*f.l:al).addScaledVector(f.wd,dw*f.t[0]).addScaledVector(f.dp,dd*f.t[1]*(dd>0?1+f.t[2]:1));}
   else q.copy(p);acc.addScaledVector(q,w);}
  if(ws>0){acc.multiplyScalar(1/ws);
   // El pecho gordo incluye la influencia de hombro cerca del tronco;
   // la corrección nace encima de la cintura y se apaga hacia los brazos.
   if(round&&hips&&torso){let tw=0;for(let k=0;k<4;k++){const j=J.getComponent(i,k);if(trunk.has(j))tw+=W.getComponent(i,k);else if(contextura==='gordo'&&/^Shoulder[LR]$/.test(B[j]?.name||''))tw+=W.getComponent(i,k)*THREE.MathUtils.smoothstep(p.y,hips.y+.28,hips.y+.50)*(1-THREE.MathUtils.smoothstep(Math.abs(p.x),.34,.44));else if(/^(UpperLeg|Skirt)/.test(B[j]?.name||''))tw+=W.getComponent(i,k)*THREE.MathUtils.smoothstep(p.y,hips.y-.03,hips.y+.16);}
    // Una curva continua de cadera a pecho, independiente de los cambios de hueso.
    // El soporte hecho en Blender permite ver la curva, en vez de una sola fila ancha.
    const t=THREE.MathUtils.clamp((p.y-hips.y-.02)/(torso.y-hips.y+.36),0,1),bell=Math.pow(Math.sin(Math.PI*t),1.35),fat=contextura==='gordo'?1:.45;
    const sex=sexo==='m'?1.06-.14*t:1,sx=(1+fat*(.28+.23*bell))*sex,depth=1+fat*(.15+.60*bell),cz=-hips.z*.3;
    if(perfil){
     const u=THREE.MathUtils.clamp((p.y-perfil.low)/(perfil.high-perfil.low),0,1),k=u*(perfil.sections.length-1),i0=Math.min(perfil.sections.length-2,Math.floor(k)),a=k-i0;
     const section=perfil.sections[i0].map((v,j)=>v*(1-a)+perfil.sections[i0+1][j]*a),roundness=Math.pow(Math.sin(Math.PI*(contextura==='gordo'?u-.20*THREE.MathUtils.smoothstep(u,.45,1):u)),1.2),dx=p.x-hips.x,dz=p.z-section[1];
     // Las secciones altas del recurso incluyen brazos: limitar esa medida
     // evita comprimir el pecho hacia dentro mientras crece la barriga.
     const targetWidth=rx0*(1+fat*(.20+.30*roundness))*sex,targetDepth=rz0*(1+.1*fat)+(dz>0?fat*.22*roundness:0);
     acc.x+=dx*(targetWidth/Math.max(.1,contextura==='gordo'&&u>.75?Math.min(section[0],rx0*1.08):section[0])-1)*tw;acc.z+=dz*(targetDepth/Math.max(.08,section[2])-1)*tw;
    }else{acc.x+=(p.x-hips.x)*(sx-1)*tw;acc.z+=((p.z-cz)*(depth-1)+fat*.20*bell*THREE.MathUtils.smoothstep(p.z-cz,0,.15))*tw;}
   }
   P.setXYZ(i,acc.x,acc.y,acc.z);
  }}
 P.needsUpdate=true;return geo;}
// Las animaciones con otros largos: cada hijo se corre a lo largo del eje de su padre (la y local) con el largo del padre;
// la cadera (Body_1) y los pies (que cuelgan de la raíz) suben y alargan el paso con las piernas. Se guardan por largos.
const SIT_CLIPS=new Set(['SitDown','StandUp','Typing']),LARGE_CLIPS=new Map(),CHILD_OF={LowerLeg:'piernas',Abdomen:'tronco',Torso:'tronco',Neck:'tronco',Shoulder:'tronco',LowerArm:'brazos',Fist:'brazos'};
export function largeClips(clips,{piernas=1,tronco=1,brazos=1}){if(piernas===1&&tronco===1&&brazos===1)return clips;const key=clips[0]?.uuid+'|'+[piernas,tronco,brazos].join(',');
 if(LARGE_CLIPS.has(key))return LARGE_CLIPS.get(key);const LG={piernas,tronco,brazos};
 // (la cadera de pie —Idle— y la más baja sentada —SitDown—, en el paquete)
 const bodyY=(name,f)=>{const c=clips.find(x=>x.name===name),t=c?.tracks.find(t=>/^Body(_\d+)?\.position$/.test(t.name));if(!t)return null;const ys=[];for(let i=1;i<t.values.length;i+=3)ys.push(t.values[i]);return f(ys);};
 const yStand=bodyY('Idle',ys=>ys[0]),ySit=bodyY('SitDown',ys=>Math.min(...ys));
 const out=clips.map(c=>{const cl=c.clone();for(const t of cl.tracks){const dot=t.name.lastIndexOf('.'),node=t.name.slice(0,dot),prop=t.name.slice(dot+1);if(prop!=='position')continue;const nm=stripB(node);
   let fy=1,fz=1;if(nm==='Body'||nm==='Foot'){fy=fz=piernas;}else if(CHILD_OF[nm]){fy=LG[CHILD_OF[nm]];}else continue;
   const v=t.values=t.values.slice();
   // (sentarse y levantarse: la cadera sentada queda a la altura del asiento —la del paquete—; de ahí a la de pie
   // pasa en proporción a cuánto subió. Con piernas largas el muñeco baja a la silla; los muslos se levantan aparte)
   if(nm==='Body'&&SIT_CLIPS.has(c.name)&&ySit!=null){const k=(yStand*piernas-ySit)/(yStand-ySit);for(let i=0;i<v.length;i+=3){v[i+1]=v[i+1]<yStand?ySit+(v[i+1]-ySit)*k:v[i+1]*piernas;v[i+2]*=fz;}continue;}
   for(let i=0;i<v.length;i+=3){v[i+1]*=fy;v[i+2]*=fz;}}return cl;});
 LARGE_CLIPS.set(key,out);return out;}
/* look: modelo (uno de PARTS: Casual_Male, Casual_Female, Suit_Male…), piel, ropa, camisa (la de abajo), pantalon,
   cinturon, detalle, pelo, peinado ('corto' | 'largo' | 'cola' | 'moño' | 'rapado' | 'calvo'), ojos, gorra, gafas,
   mochila, barba, talla. */
export async function makePersona2(look={},rand=Math.random,{scale=.52}={}){
 const L={modelo:'Casual_Male',piel:'media',ropa:'roja',camisa:'blanca',pantalon:'jean',cinturon:'café',detalle:'negro',pelo:'castaño',peinado:'corto',ojos:'negros',...look};
 for(const [slot,id] of Object.entries(L.prendas||{})){if(!Object.hasOwn(WARDROBE,slot)||id&&!WARDROBE[slot].some(p=>p.id===id))throw new Error('Prenda inválida para '+slot+': '+id);}
 // (sin pelo pedido, el del propio modelo, si lo tiene)
 if(!L.pzPelo&&!look.peinado&&!look.mezcla&&PARTS[L.modelo]?.hair&&pieceById('pelo:'+L.modelo))L.pzPelo='pelo:'+L.modelo;
 if(L.pzPelo)L.peinado='del catálogo';// (el pelo del vestuario reemplaza a los peinados propios)
 // El muñeco se arma siempre sobre el cuerpo base (esqueleto, piel entera, animaciones); del modelo elegido sólo se
 // toman sus partes (ropa y cara) del archivo desacoplado. Sin archivo, el modelo entero como antes.
 const CU=L.cuerpo&&L.cuerpo!=='paquete'?L.cuerpo:null;
 const [lite,t]=await Promise.all([loadParts(L.modelo,CU,L.acabado!==false),loadSkeleton(CU)]),g=lite?{animations:[]}:await loadModel(L.modelo),root=cloneSkinned(lite?t.scene:g.scene),real=[];root.traverse(o=>{if(o.isSkinnedMesh)real.push(o);});
 const ms=lite?[real.find(o=>o.material.name==='Skin'),...(lite.meshes.some(m=>m.material.name==='Face')?lite.meshes:[...lite.meshes,real.find(o=>o.material.name==='Face')])].filter(Boolean):real;
 const roles=PARTS[L.modelo]||{},roleOf=n=>Object.entries(roles).find(([k,v])=>v===n)?.[0];
 const paint={top:col('ropa',L.ropa,'roja'),inner:col('camisa',L.camisa,'blanca'),pants:col('pantalon',L.pantalon,'jean'),belt:col('cinturon',L.cinturon,'café'),detail:col('detalle',L.detalle,'negro'),hat:col('gorra',L.gorra,'negra')};
 const skin=col('piel',L.piel,'media'),eyes=col('ojos',L.ojos,'negros'),hair=col('pelo',L.pelo,'castaño');
 const m0=real[0],sk=m0.skeleton,geos=[],CLOTH=new Set();let skinGeo=null;
 const yOf=n=>{const j=sk.bones.findIndex(b=>b.name===n);return j<0?0:new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(sk.boneInverses[j]).invert()).y;},KNEE=yOf('LowerLegL'),HIP=yOf('Hips');
 const ARM=new Set(sk.bones.map((b,i)=>/^(UpperArm|LowerArm)/.test(b.name)?i:-1).filter(i=>i>=0));
 // Las piezas del vestuario que pide el look (copiadas del paquete y simplificadas: pieceGeo). Lo de encima cerrado
 // (bata, abrigo, vestido, kimono) esconde la prenda propia que tapa.
 const want=(L.desnudo?['pzPelo','pzBigote']:['pzPelo','pzBigote','pzSombrero','pzBufanda','pzEncima','pzArriba','pzPantalon']).filter(k=>L[k]),got=Object.fromEntries(await Promise.all(want.map(async k=>[k,await pieceGeo(L[k],900,CU,L.acabado!==false)])));
 // (lo de encima ya no esconde la ropa de abajo: va sobre ella, con más holgura —fitCloth—; una bata abierta dejaba el pecho desnudo)
 if(!L.desnudo)for(const [slot,id] of Object.entries(L.prendas||{}))if(id){const pg=await pieceGeo(id,900,CU,L.acabado!==false);if(!pg)throw new Error('Prenda desconocida: '+id);got['prenda_'+slot]=pg;}
 const overridden=slot=>!L.desnudo&&Object.hasOwn(L.prendas||{},slot);
 const enc=got.pzEncima?.pc,hideTop=!!got.pzArriba||(!!L.recortarPiel&&!!enc?.hides?.includes('ropa')),hidePants=!!got.pzPantalon||(!!L.recortarPiel&&!!enc?.hides?.includes('pant_arriba'));
 // Con camisa o pantalón de otro modelo, la piel es la del cuerpo base entero (la del modelo sólo llega hasta su ropa):
 // se le recorta lo que tapa la ropa que queda puesta (mismo esqueleto, mismo orden de huesos, la misma cabeza).
 // (con el cuerpo base la piel es siempre la entera: se recorta siempre por la ropa puesta)
 const swap=!!(lite||got.pzArriba||got.pzPantalon),base=lite?null:swap||L.desnudo?await loadModel('BaseCharacter'):null;
 const baseSkin=lite?real.find(o=>o.material.name==='Skin'):base&&(()=>{let s0=null;base.scene.traverse(o=>{if(o.isSkinnedMesh&&o.material.name==='Skin')s0=o;});return s0;})();
 const smoothSkin=L.acabado!==false&&['gordo','robusto'].includes(L.contextura)?await polishedSkin(sk,CU):null;
 const own=[];
 // (los modelos sin mapa de papeles —vaquero, mago…—: sus sombreros y cascos se reconocen por el nombre)
 for(const m of ms){const n=m.material.name,role=roleOf(n)||(/^(Hat|Helmet|Horns)/.test(n)?'hat':undefined);if(role==='hair')continue;if(role==='hat'&&!L.sombreroPropio)continue;
  // (desnudo: sólo la piel entera del cuerpo base y la cara; para ver el alto y la contextura)
  if(L.desnudo&&n!=='Skin'&&n!=='Face')continue;
  const src=n==='Skin'&&baseSkin?baseSkin:m;let gg=n==='Skin'&&smoothSkin?smoothSkin:src.geometry.clone();const profile=gg.userData.torsoProfile;if(gg.index)gg=gg.toNonIndexed();if(profile)gg.userData.torsoProfile=profile;
  for(const a of Object.keys(gg.attributes))if(!['position','normal','skinIndex','skinWeight'].includes(a))gg.deleteAttribute(a);
  const si=gg.attributes.skinIndex;if(!(si.array instanceof Uint16Array))gg.setAttribute('skinIndex',new THREE.BufferAttribute(Uint16Array.from(si.array),4));
  for(const part of splitClothing(gg,sk,L.modelo,role)){
   const r=part.role,slot=r==='buckle'?'belt':r;
   if(overridden(slot))continue;
   if(hideTop&&['top','inner','detail'].includes(r)||hidePants&&['pants','belt','buckle'].includes(r))continue;
   if(r==='buckle'&&L.accesoriosPulidos!==false)continue;
   own.push({n,role:r,gg:part.g,orig:'#'+m.material.color.getHexString()});}}
 // (2026-10-12: la ropa va ENCIMA del cuerpo entero —fitCloth—; el recorte de piel bajo la ropa sólo con L.recortarPiel)
 if(swap&&L.recortarPiel){const UP=new Set(['Torso','Abdomen','Shoulder','UpperArm','LowerArm','Neck']),LO=new Set(['Hips','Body','UpperLeg','LowerLeg']),TR=new Set(['Hips','Body','Abdomen','Torso']);
  const domJ=(g,i)=>{const J=g.attributes.skinIndex,W=g.attributes.skinWeight;let b=0,bj=0;for(let k=0;k<4;k++){const w=W.getComponent(i,k);if(w>b){b=w;bj=J.getComponent(i,k);}}return bj;};
  // hasta dónde llega cada prenda a lo largo de cada hueso (en las coordenadas del hueso)
  const coverOf=(gs,group)=>{const r=new Map(),cnt=new Map(),v=new THREE.Vector3();for(const g of gs){const P=g.attributes.position;for(let i=0;i<P.count;i++){const j=domJ(g,i),nm=sk.bones[j]?.name;if(!nm||!group.has(stripB(nm)))continue;
    v.fromBufferAttribute(P,i).applyMatrix4(sk.boneInverses[j]);const q=r.get(nm)||[Infinity,-Infinity];q[0]=Math.min(q[0],v.y);q[1]=Math.max(q[1],v.y);r.set(nm,q);cnt.set(nm,(cnt.get(nm)||0)+1);}}
   for(const [nm,c] of cnt)if(c<20)r.delete(nm);return r;};
  const geosOf=k=>(got[k]?.parts||[]).map(p=>p.geo),ownOf=rs=>own.filter(o=>rs.includes(o.role)).map(o=>o.gg);
  // (la ropa propia que queda puesta recorta en todo el cuerpo: el traje y la bata traen el pantalón en la misma parte)
  const ownCloth=own.filter(o=>o.n!=='Skin'&&o.n!=='Face'&&o.role!=='hat').map(o=>o.gg);
  const covers=[coverOf(got.pzArriba?geosOf('pzArriba'):ownCloth,UP),coverOf(got.pzPantalon?geosOf('pzPantalon'):ownCloth,LO)];
  if(enc?.hides?.includes('ropa'))covers.push(coverOf(geosOf('pzEncima'),new Set([...UP,...LO])));
  const sg=own.find(o=>o.n==='Skin');if(sg){const g=sg.gg,P=g.attributes.position,v=new THREE.Vector3(),c=new THREE.Vector3(),keep=[];
   for(let t=0;t<P.count;t+=3){const js=[domJ(g,t),domJ(g,t+1),domJ(g,t+2)],j=js[1]===js[2]?js[1]:js[0],nm=sk.bones[j]?.name;c.set(0,0,0);for(let k=0;k<3;k++)c.add(v.fromBufferAttribute(P,t+k));c.multiplyScalar(1/3).applyMatrix4(sk.boneInverses[j]);
    // un poco hacia adentro del borde de la prenda, para que no quede rendija; en el tronco la prenda cubre todo el hueso
    if(covers.some(cv=>{const r=cv.get(nm);if(!r)return false;if(TR.has(stripB(nm)))return true;const e=(r[1]-r[0])*.04;return c.y>r[0]+e&&c.y<r[1]-e;}))continue;keep.push(t);}
   sg.gg=keepTris(g,keep);}}
 // (una parte sin papel conserva su color original: antes se pintaba de piel)
 for(const {n,role,gg,orig} of own){
  const c=n==='Skin'?skin:n==='Face'?eyes:paint[ROLE_PAINT[role]]||orig||skin;
  // (la piel de los pies son los zapatos: se pintan por el hueso que más los mueve)
  const cnt=gg.attributes.position.count,cl=new Float32Array(cnt*3),cc=new THREE.Color(c),cs=new THREE.Color(L.desnudo&&!L.zapatos?skin:col('zapatos',L.zapatos,'negros')),feet=new Set(['FootL','FootR'].map(n=>sk.bones.findIndex(b=>b.name===n))),shins=new Set(['LowerLegL','LowerLegR'].map(n=>sk.bones.findIndex(b=>b.name===n)));// (el zapato: lo que mueve el pie y la canilla bajo el tobillo)
  // (por triángulo, así el borde del zapato queda neto: el centro del triángulo, bajo el tobillo)
  const J=gg.attributes.skinIndex,Wt=gg.attributes.skinWeight;
  const Y=gg.attributes.position,shoeTri=t=>{if(n!=='Skin')return false;const cy=(Y.getY(t)+Y.getY(t+1)+Y.getY(t+2))/3,b=[t,t+1,t+2].map(i=>{let best=0,bj=-1;for(let k=0;k<4;k++){const w=Wt.getComponent(i,k);if(w>best){best=w;bj=J.getComponent(i,k);}}return bj;});
   // (con las piernas largas la canilla se estira desde el tobillo: el borde del zapato se baja para que no se estire con ella)
   const th=v=>.1+(v-.1)/(L.piernas||1);return b.some(x=>feet.has(x))&&cy<th(.34)||b.every(x=>feet.has(x)||shins.has(x))&&cy<th(.24);};
  for(let t=0;t<cnt;t+=3){const use=cc;for(let k=0;k<3;k++){const i=t+k;cl[i*3]=use.r;cl[i*3+1]=use.g;cl[i*3+2]=use.b;}}
  gg.setAttribute('color',new THREE.BufferAttribute(cl,3));
  if(n==='Skin'&&L.calzado!=='tenis-bajos'&&L.zapatos!=='no'&&(!L.desnudo||L.zapatos)){const tris=[];for(let t=0;t<cnt;t+=3)if(shoeTri(t))tris.push(t);if(tris.length){const shell=selectTriangles(gg,tris),P=shell.attributes.position,C=shell.attributes.color;for(let i=0;i<P.count;i++){P.setY(i,P.getY(i)+.008);P.setZ(i,P.getZ(i)+.006);C.setXYZ(i,cs.r,cs.g,cs.b);}shell.userData={slot:'shoes',partId:'zapatos:par'};geos.push(shell);}}
  if(n==='Skin')skinGeo=gg;else if(n!=='Face'&&role!=='hat'){CLOTH.add(gg);/* (capas: la camisa de abajo pegada, la de arriba encima de ella) */gg.userData.holgura=role==='inner'?.022:role==='top'||role==='detail'?.05:undefined;}
  gg.userData.accessoryRole=n==='Skin'?'skin':n==='Face'?'face':role;gg.userData.sourceModel=L.modelo;gg.userData.slot=n==='Skin'?'body':n==='Face'?'face':role==='buckle'?'belt':role||'outer';gg.userData.partId=n==='Skin'?'body':n==='Face'?'face':`prenda:${L.modelo}:${n}:${gg.userData.slot}`;
  if(['top','pants','inner'].includes(role))gg.userData.hemRole=role;
  if(role==='pants')paintPants(gg,{gastado:L.gastado,bota:L.bota,bolsillos:L.bolsillos},KNEE,HIP);
  if(role==='top')paintTrim(gg,ARM,L.mangasColor&&col('ropa',L.mangasColor,'blanca'),L.cuelloColor&&col('ropa',L.cuelloColor,'blanca'));
  if(role==='top')paintPattern(gg,L.estampado,L.estampadoColor?col('ropa',L.estampadoColor,'blanca'):dark(c,.55));
  geos.push(gg);}
 // La cabeza del modelo (los vértices del hueso Head): de ahí salen las medidas del pelo y de lo que va en la cabeza.
 const I=n=>sk.bones.findIndex(b=>b.name===n),H=I('Head'),hb=boneBounds(geos,H),hc=hb.getCenter(new THREE.Vector3()),hs=hb.getSize(new THREE.Vector3());
 const top=hb.max.y,back=hb.min.z,front=hb.max.z,wid=hs.x,dep=hs.z,add=x=>geos.push(x),hairAll=[],addHair=x=>hairAll.push(x);
 // Los peinados: los triángulos de la cabeza del modelo que caen en la zona del peinado, inflados desde el centro de la
 // cabeza (así el pelo sigue la forma de la cabeza, sin el peso del pelo del paquete). u: de la pera (0) a la coronilla
 // (1); f: de la nuca (−1) a la cara (+1); x: del medio (0) a la oreja (1).
 // sub: cuántas veces se parte cada triángulo en cuatro antes de elegir (la cabeza tiene triángulos grandes: sin
 // partirlos, una barba o unas entradas salen en bloques).
 // walls: la capa queda MACIZA (como las barbas talladas de los packs low poly): el borde baja en una pared hasta la
 // piel, así de lado no se ve una lámina flotando. Los bordes son las aristas que usa un solo triángulo de la capa.
 const hairShell=(keep,grow,color,sub=0,walls=false)=>{if(!skinGeo)return;const P=skinGeo.attributes.position,J=skinGeo.attributes.skinIndex,Wt=skinGeo.attributes.skinWeight,pos=[],v=new THREE.Vector3(),kept=[];
  const dom=i=>{let best=0,bj=-1;for(let k=0;k<4;k++){const w=Wt.getComponent(i,k);if(w>best){best=w;bj=J.getComponent(i,k);}}return bj;};
  const split=t=>{const [a,b,c]=t,m=(p,q)=>[(p[0]+q[0])/2,(p[1]+q[1])/2,(p[2]+q[2])/2],ab=m(a,b),bc=m(b,c),ca=m(c,a);return [[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]];};
  // Con una zona continua (keep devuelve un número: >0 adentro) el triángulo se RECORTA justo en el contorno (el borde
  // sale limpio, sin escalones); con una zona de sí/no, entra o sale entero.
  const uvx=q=>[(q[1]-hb.min.y)/hs.y,(q[2]-hc.z)/(dep/2),Math.abs(q[0]-hc.x)/(wid/2)],field=typeof keep(.5,0,.5)==='number';
  const clip=t=>{const sv=t.map(q=>keep(...uvx(q)));if(sv.every(x=>x>0))return [t];if(sv.every(x=>x<=0))return [];const poly=[];
   for(let k=0;k<3;k++){const a=t[k],b=t[(k+1)%3],sa=sv[k],sb=sv[(k+1)%3];if(sa>0)poly.push(a);if((sa>0)!==(sb>0)){const w=sa/(sa-sb);poly.push([a[0]+(b[0]-a[0])*w,a[1]+(b[1]-a[1])*w,a[2]+(b[2]-a[2])*w]);}}
   const out=[];for(let k=1;k+1<poly.length;k++)out.push([poly[0],poly[k],poly[k+1]]);return out;};
  for(let i=0;i<P.count;i+=3){if(dom(i)!==H||dom(i+1)!==H||dom(i+2)!==H)continue;let tris=[[0,1,2].map(k=>[P.getX(i+k),P.getY(i+k),P.getZ(i+k)])];for(let s=0;s<sub;s++)tris=tris.flatMap(split);
   if(field)tris=tris.flatMap(clip);
   for(const t of tris){const cx=(t[0][0]+t[1][0]+t[2][0])/3,cy=(t[0][1]+t[1][1]+t[2][1])/3,cz=(t[0][2]+t[1][2]+t[2][2])/3;
    const u=(cy-hb.min.y)/hs.y,f=(cz-hc.z)/(dep/2),x=Math.abs(cx-hc.x)/(wid/2);if(!field&&!keep(u,f,x))continue;
    const lift=q=>{v.set(q[0],q[1],q[2]).sub(hc);const up=Math.max(0,(v.y/hs.y))*grow*.6;v.multiplyScalar(1+grow).add(hc);v.y+=up;return [v.x,v.y,v.z];};
    for(const q of t)pos.push(...lift(q));if(walls)kept.push(t.map(q=>({q,o:lift(q)})));}}
  if(walls&&kept.length){const K=q=>q.map(x=>Math.round(x*1e4)).join(','),cnt=new Map();for(const t of kept)for(let k=0;k<3;k++){const a=K(t[k].q),b=K(t[(k+1)%3].q),e=a<b?a+'|'+b:b+'|'+a;cnt.set(e,(cnt.get(e)||0)+1);}
   const inn=q=>{v.set(q[0],q[1],q[2]).sub(hc).multiplyScalar(.995).add(hc);return [v.x,v.y,v.z];};
   for(const t of kept)for(let k=0;k<3;k++){const A=t[k],B=t[(k+1)%3],a=K(A.q),b=K(B.q);if(cnt.get(a<b?a+'|'+b:b+'|'+a)!==1)continue;const ai=inn(A.q),bi=inn(B.q);
    // (las dos caras: el material no dibuja el revés)
    pos.push(...A.o,...ai,...bi,...A.o,...bi,...B.o,...A.o,...bi,...ai,...A.o,...B.o,...bi);}}
  if(!pos.length)return;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  const n=pos.length/3,c=new THREE.Color(color),cl=new Float32Array(n*3),si=new Uint16Array(n*4),sw=new Float32Array(n*4);for(let i=0;i<n;i++){cl[i*3]=c.r;cl[i*3+1]=c.g;cl[i*3+2]=c.b;si[i*4]=H;sw[i*4]=1;}
  g.setAttribute('color',new THREE.BufferAttribute(cl,3));g.setAttribute('skinIndex',new THREE.BufferAttribute(si,4));g.setAttribute('skinWeight',new THREE.BufferAttribute(sw,4));addHair(g);};
 const corto=(u,f,x)=>(f>.25?u>.74:f>-.15?u>.6||(x>.8&&u>.48):u>.28)&&!(x>.86&&u<.62&&f>-.2);
 // (el peinado de un modelo del paquete: 'pelo:Casual_Female' o el nombre del modelo)
 const fromPack=typeof L.peinado==='string'&&(L.peinado.startsWith('pelo:')||PARTS[L.peinado]);
 if(fromPack){const hg=await hairFrom(L.peinado.replace(/^pelo:/,''));if(hg){const g2=hg.clone(),n=g2.attributes.position.count,c=new THREE.Color(hair),cl=new Float32Array(n*3),si=new Uint16Array(n*4),sw=new Float32Array(n*4);
  for(let i=0;i<n;i++){cl[i*3]=c.r;cl[i*3+1]=c.g;cl[i*3+2]=c.b;si[i*4]=H;sw[i*4]=1;}g2.setAttribute('color',new THREE.BufferAttribute(cl,3));g2.setAttribute('skinIndex',new THREE.BufferAttribute(si,4));g2.setAttribute('skinWeight',new THREE.BufferAttribute(sw,4));addHair(g2);}}
 // ---------- Mechones (2026-10-12) ----------
 // Como el pelo del paquete: el pelo es una base pegada a la cabeza (un poco más oscura, para que no se vea el cuero)
 // y encima mechones: cintas de sección triangular que nacen en el cuero, siguen la forma de la cabeza (no se meten
 // en ella), se afinan hasta la punta y caen según el peinado. La cabeza se aproxima con una superelipse (exponente
 // 3: una caja redondeada, como la del paquete). Cada mechón tiene un tono apenas distinto.
 const HR=new THREE.Vector3(wid/2,hs.y/2,dep/2),Fh=p=>Math.abs((p.x-hc.x)/HR.x)**3+Math.abs((p.y-hc.y)/HR.y)**3+Math.abs((p.z-hc.z)/HR.z)**3;
 const outside=(p,off)=>{const k=Fh(p)**(-1/3)*(1+off);if(k>1)p.sub(hc).multiplyScalar(k).add(hc);return p;};
 const nrm=p=>{const x=(p.x-hc.x)/HR.x,y=(p.y-hc.y)/HR.y,z=(p.z-hc.z)/HR.z;return new THREE.Vector3(Math.sign(x)*x*x/HR.x,Math.sign(y)*y*y/HR.y,Math.sign(z)*z*z/HR.z).normalize();};
 // (los moldes de mechón: los del paquete; L.moldes=false vuelve a los prismas)
 const TPLS=L.moldes===false?null:await lockTemplates();
 let seed=7;for(const ch of String(L.peinado)+String(L.barba)+String(L.semilla||''))seed=(seed*31+ch.charCodeAt(0))%2147483647;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
 // las raíces: puntos de la cabeza dentro de la zona (keep), separados al menos sp
 const roots=(keep,sp)=>{if(!skinGeo)return [];const P=skinGeo.attributes.position,J=skinGeo.attributes.skinIndex,Wt=skinGeo.attributes.skinWeight,cand=[];
  const dom=i=>{let best=0,bj=-1;for(let k=0;k<4;k++){const w=Wt.getComponent(i,k);if(w>best){best=w;bj=J.getComponent(i,k);}}return bj;};
  for(let i=0;i<P.count;i+=3){if(dom(i)!==H||dom(i+1)!==H||dom(i+2)!==H)continue;const t=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(P,i+k));
   for(const [a,b,c] of [[1,1,1],[4,1,1],[1,4,1],[1,1,4]]){const q=new THREE.Vector3().addScaledVector(t[0],a).addScaledVector(t[1],b).addScaledVector(t[2],c).multiplyScalar(1/(a+b+c));
    const u=(q.y-hb.min.y)/hs.y,f=(q.z-hc.z)/(dep/2),x=Math.abs(q.x-hc.x)/(wid/2);{const kv=keep(u,f,x);if(kv===true||typeof kv==='number'&&kv>0)cand.push({q:outside(q,0),u,f,x,o:rnd()});}}}
  cand.sort((a,b)=>a.o-b.o);const out=[];for(const c of cand)if(out.every(o=>o.q.distanceToSquared(c.q)>sp*sp))out.push(c);return out;};
 // un mechón: desde la raíz, segs tramos; w ancho, th alto de la cresta, g cuánto lo jala la gravedad en cada tramo
 const lockPos=[],lockCol=[];
 // (la cara queda libre: un mechón que entra a la zona de los ojos termina ahí; medido: ojos y cejas en u .38–.65)
 const inFace=p=>{const u=(p.y-hb.min.y)/hs.y,f=(p.z-hc.z)/(dep/2),x=Math.abs(p.x-hc.x)/(wid/2);return f>.3&&u<.7&&u>.05&&x<.82;};
 // under: la cara de abajo (sólo hace falta si el mechón cuelga lejos de la cabeza y se lo ve por debajo)
 const lock=(root,dir,len,w,th,{segs=3,g=0,off=.02,lift=.015,color=hair,face=true,under=g>.2,tip=0,grad=[.7,1.15],bend=0,hug=true,molde=TPLS}={})=>{let p=root.clone(),d=dir.clone();const S=[],Fr=[];
  // hug: el mechón sigue la cabeza (se acuesta); las puntas que salen hacia afuera (Goku) no la siguen
  for(let k=0;k<=segs;k++){const n=nrm(p);if(hug&&Fh(p)<1.6)d.addScaledVector(n,-d.dot(n));// (lejos de la cabeza ya no la sigue: cae)
   if(d.lengthSq()<1e-6)d.set(0,-1,0);d.normalize();
   const t=k/segs,hw=w/2*((1-t)**.6*(1-tip)+tip),h=th*(1-t)**1.2;let side=new THREE.Vector3().crossVectors(n,d);if(side.lengthSq()<.01)side.crossVectors(new THREE.Vector3(0,1,0),d);side.normalize();
   // (la cresta, perpendicular al mechón y hacia afuera de la cabeza: así una punta que sale derecho también tiene cuerpo)
   const ridge=new THREE.Vector3().crossVectors(d,side).normalize();if(ridge.dot(n)<0)ridge.negate();
   S.push([p.clone().addScaledVector(side,-hw),p.clone().addScaledVector(side,hw),p.clone().addScaledVector(ridge,h)]);Fr.push({p:p.clone(),side:side.clone(),ridge:ridge.clone(),d:d.clone()});
   // (bend: el mechón sale hacia afuera y vuelve hacia adentro en la punta —la «C» de los pelos estilizados—; negativo, la punta se abre)
   if(k<segs){d.y-=g;if(bend)d.addScaledVector(n,bend*(1-2*t));d.normalize();const q=outside(p.clone().addScaledVector(d,len/segs),off+lift*(k+1)/segs);if(face&&inFace(q)){segs=k+1;p=q;S.push([q.clone(),q.clone(),q.clone()]);break;}p=q;}}
  // (de la raíz a la punta: más oscuro abajo, más claro en la punta; cada mechón con su tono)
  const base=new THREE.Color(color).multiplyScalar(.86+rnd()*.24),C=S.map((_,k)=>base.clone().multiplyScalar(grad[0]+(grad[1]-grad[0])*k/(S.length-1)));
  // Con molde: el mechón del paquete doblado a lo largo del recorrido (centro, ancho y cresta de cada tramo, interpolados)
  // (sólo en los que se acuestan sobre la cabeza: las puntas que salen derecho —Goku— con molde se veían como tallarines)
  if(molde&&molde.length&&hug&&Fr.length>1){const M=molde[Math.floor(rnd()*molde.length)],T=M.T,nF=Fr.length-1,f0=Fr[0];
   const flip=Math.sign(new THREE.Vector3().crossVectors(f0.side,f0.ridge).dot(f0.d))!==M.hand,q=new THREE.Vector3(),sd=new THREE.Vector3(),rg=new THREE.Vector3(),cc=new THREE.Color();
   const at=i=>{const t=Math.min(1,Math.max(0,T[i*3])),x=t*nF,k0=Math.min(nF-1,Math.floor(x)),a=x-k0,A=Fr[k0],B=Fr[k0+1];
    q.copy(A.p).lerp(B.p,a);sd.copy(A.side).lerp(B.side,a).normalize();rg.copy(A.ridge).lerp(B.ridge,a).normalize();
    q.addScaledVector(sd,T[i*3+1]*w/2).addScaledVector(rg,T[i*3+2]*w/2*Math.min(1.2,M.thick)*(th>0?1:0));cc.copy(base).multiplyScalar(grad[0]+(grad[1]-grad[0])*t);return [q.x,q.y,q.z,cc.r,cc.g,cc.b];};
   for(let i=0;i<T.length/3;i+=3){const o=flip?[i,i+2,i+1]:[i,i+1,i+2];for(const j of o){const r=at(j);lockPos.push(r[0],r[1],r[2]);lockCol.push(r[3],r[4],r[5]);}}
   return;}
  const tri=(a,ca,b,cb,e,ce)=>{lockPos.push(a.x,a.y,a.z,b.x,b.y,b.z,e.x,e.y,e.z);lockCol.push(ca.r,ca.g,ca.b,cb.r,cb.g,cb.b,ce.r,ce.g,ce.b);};
  for(let k=0;k<segs;k++){const [l0,r0,t0]=S[k],[l1,r1,t1]=S[k+1],c0=C[k],c1=C[k+1];
   tri(r0,c0,t0,c0,t1,c1);tri(r0,c0,t1,c1,r1,c1);tri(t0,c0,l0,c0,l1,c1);tri(t0,c0,l1,c1,t1,c1);if(under){tri(l0,c0,r0,c0,r1,c1);tri(l0,c0,r1,c1,l1,c1);}}};
 const flushLocks=to=>{if(!lockPos.length)return;const g=new THREE.BufferGeometry(),n=lockPos.length/3,si=new Uint16Array(n*4),sw=new Float32Array(n*4);for(let i=0;i<n;i++){si[i*4]=H;sw[i*4]=1;}
  g.setAttribute('position',new THREE.Float32BufferAttribute(lockPos.splice(0),3));g.setAttribute('color',new THREE.Float32BufferAttribute(lockCol.splice(0),3));
  g.setAttribute('skinIndex',new THREE.BufferAttribute(si,4));g.setAttribute('skinWeight',new THREE.BufferAttribute(sw,4));to(g);};
 // la dirección de partida: desde el remolino de la coronilla hacia afuera; lo de la frente cae hacia adelante (el fleco)
 const whorl=new THREE.Vector3(hc.x,hc.y+hs.y*.42,hc.z-dep*.22),fromWhorl=(r,front=.6)=>{const d=r.q.clone().sub(whorl);if(r.f>.3)d.add(new THREE.Vector3(0,-.25,front));return d;};
 // La raya (2026-10-12, de las guías de pelo estilizado: asimetría y formas grandes): una línea de la frente al
 // remolino, corrida a un lado; arriba el pelo se abre desde ella y el fleco barre hacia el lado contrario.
 const ps=L.raya==='izquierda'?-1:L.raya==='derecha'?1:(rnd()<.5?-1:1),partX=hc.x+ps*wid*.16;
 const fromPart=r=>{if(r.f>.3)return new THREE.Vector3(-ps*.9,-.5,.45);if(r.u>.7&&r.f>-.35)return new THREE.Vector3(Math.sign(r.q.x-partX)||ps,-.45,-.2);return fromWhorl(r);};
 // (lo largo de los lados y la nuca cae por detrás de los hombros, no por el pecho)
 const hang=r=>r.f>.3||r.u>.78?fromPart(r):new THREE.Vector3(Math.sign(r.q.x-hc.x)*.25,-1,-.35);
 const toBack=r=>new THREE.Vector3(hc.x,hc.y+hs.y*.1,hc.z-dep*.6).sub(r.q);
 const HAIR_STYLES={
  corto:{mask:corto,base:.035,sp:.12,len:r=>r.f>.3?.24:.2,w:.22,th:.04,g:.1,clump:{sp:1.55,extra:.25,stray:.04,spread:.12},dir:fromPart},
  entradas:{mask:(u,f,x)=>f>.25?u>(x>.3?.9:.77):corto(u,f,x),base:.045,sp:.12,len:r=>.2,w:.21,th:.04,g:.12,clump:{sp:1.55,extra:.25,stray:.04,spread:.12},dir:r=>r.f>.15?new THREE.Vector3((r.q.x-hc.x)*.4,.25,-1):fromWhorl(r)},
  coronilla:{mask:(u,f,x)=>!(u>.86&&f<.25&&f>-.7&&x<.62)&&(f>.25?u>.76:f>-.15?u>.55||(x>.8&&u>.48):u>.3)&&!(x>.86&&u<.62&&f>-.2),base:.03,sp:.12,len:r=>.17,w:.2,th:.035,g:.25,clump:{sp:1.55,extra:.25,stray:.04,spread:.12},dir:fromWhorl},
  largo:{mask:(u,f,x)=>f>.25?u>.74:f>-.15?u>.6||x>.7:u>.2,base:.04,sp:.11,len:r=>r.f>.3?.3:r.f>-.15&&r.x<.7?.5:1.05,w:.24,th:.045,g:.3,segs:3,tip:.4,dir:hang},
  melena:{mask:(u,f,x)=>f>.25?u>.74:f>-.15?u>.6||x>.75:u>.2,base:.04,sp:.11,len:r=>r.f>.3?.28:.62,w:.24,th:.05,g:.28,segs:3,tip:.4,dir:hang},
  cola:{mask:corto,base:.03,sp:.12,len:r=>.3,w:.22,th:.035,g:0,dir:toBack},
  moño:{mask:corto,base:.03,sp:.12,len:r=>.3,w:.22,th:.035,g:0,dir:r=>new THREE.Vector3(hc.x,top+.1,hc.z-dep*.2).sub(r.q)}};
 // ---------- Peinados de corona (2026-10-12) ----------
 // Inspirados en los packs de pelo estilizado para juegos (Fab / TurboSquid «Low Poly Hair Pack»): un casquete con
 // volumen y alrededor una corona ORDENADA de mechones planos y anchos con punta, todos parecidos, en dos pisos (el de
 // arriba más corto, corrido medio mechón); el flequillo es una fila de los mismos. Ordenados por ángulo, no al azar:
 // eso es lo que da el aspecto limpio de esos packs. u de cada piso: [frente, lado, nuca] (dónde nace el pelo).
 const ringRoot=(a,u,off)=>{const dy=Math.abs(((hb.min.y+hs.y*u)-hc.y)/HR.y)**3,A=Math.abs(Math.sin(a)/HR.x)**3+Math.abs(Math.cos(a)/HR.z)**3,sc=Math.cbrt(Math.max(.02,1-dy)/A);
  return outside(new THREE.Vector3(hc.x+Math.sin(a)*sc,hb.min.y+hs.y*u,hc.z+Math.cos(a)*sc),off);};
 // (u de cada piso: [frente, lado, nuca]; medido: la oreja va de u .27 a .53, así que a los lados el pelo nace en
 // .5 y atrás baja hasta la nuca, .2: si nacía más arriba la mitad de abajo de la cabeza quedaba calva)
 // (2026-10-12, «muy aplanados, como el pelo de Goku, cortos y largos, con volumen»): cada mechón es una PUNTA con cuerpo
 // —casi tan gruesa como ancha (vol × ancho) y cerrada por abajo—, la base va más inflada y encima de la cabeza salen
 // puntas hacia afuera (top), así el pelo es una masa y no un casco con placas pegadas.
 const CORONAS={
  anime:{cap:.13,vol:.7,bend:-.15,top:{sp:.2,len:.5,out:1.1,up:.35,back:.3},fringe:.38,tiers:[{u:[.8,.5,.22],n:12,len:[.34,.32,.34],g:-.05,out:.7}]},
  goku_largo:{cap:.13,vol:.7,bend:-.1,top:{sp:.2,len:.5,out:1.1,up:.35,back:.3},fringe:.38,tiers:[{u:[.8,.5,.22],n:13,len:[.34,.75,1.15],g:.22,out:.45},{u:[.93,.72,.5],n:10,len:[.3,.4,.5],g:.1,out:.6}]},
  pixie:{cap:.11,vol:.55,sweep:.55,bend:.1,top:{sp:.22,len:.3,out:.6,up:0,back:.5},tiers:[{u:[.8,.5,.22],n:14,len:[.24,.2,.2],g:.15,out:.35}]},
  bob:{cap:.11,vol:.5,bend:.3,top:{sp:.24,len:.28,out:.5,up:-.2,back:.4},tiers:[{u:[.8,.5,.22],n:16,len:[.24,.62,.52],g:.45,out:.25},{u:[.93,.74,.55],n:12,len:[.2,.38,.4],g:.3,out:.3}]},
  hongo:{cap:.14,vol:.5,bend:.3,top:{sp:.24,len:.26,out:.5,up:-.3,back:.2},tiers:[{u:[.76,.52,.3],n:18,len:[.2,.3,.26],g:.55,out:.3},{u:[.92,.78,.6],n:13,len:[.16,.24,.24],g:.4,out:.35}]},
  liso:{cap:.11,vol:.45,bend:.15,top:{sp:.24,len:.3,out:.5,up:-.2,back:.5},tiers:[{u:[.8,.5,.2],n:16,len:[.24,.88,1.08],g:.5,out:.22},{u:[.93,.74,.55],n:12,len:[.2,.45,.5],g:.35,out:.3}]}};
 // la base de los de corona: todo lo que cubre el pelo hasta esa línea, sin la oreja
 // (zonas continuas: >0 adentro; smn / smx son la intersección y la unión con las esquinas redondeadas)
 const capMask=(u,f,x)=>{const ss=(a,b,t)=>{t=Math.min(1,Math.max(0,(t-a)/(b-a)));return t*t*(3-2*t);},h=.18+.3*ss(-.5,-.1,f)+.28*ss(.15,.45,f),
  ear=smn(smn(x-.78,smn(u-.24,.56-u)),smn(f+.35,.3-f));return smn(u-h,-ear);};
 // ---------- Lados rapados con volumen arriba (2026-10-12) ----------
 // De las cabezas low poly de JustCreate3D: los lados y la nuca casi pegados y más claros (el degradado, una capa
 // maciza mezclada con la piel) y arriba un copete de pocos mechones grandes y gruesos. El volumen sólo arriba es lo
 // que los hace ver de hombre (los cortes ponen el mismo volumen en toda la cabeza: se ven de niño).
 const DEGRADADOS={
  // (el copete: los de adelante suben y se curvan hacia atrás —anchos, poco puntudos—; los de atrás se acuestan)
  copete:{len:r=>r.f>.2?.48:.32,dir:r=>r.f>.2?new THREE.Vector3((r.q.x-hc.x)*.2,.75,-.25):new THREE.Vector3((r.q.x-hc.x)*.4,.15,-1),hug:r=>r.f<=.2,w:r=>r.f>.2?.48:.38,tip:.3,bend:r=>r.f>.2?-.55:0},
  raya:{len:r=>.36,dir:r=>r.f>.2?new THREE.Vector3(-ps*.9,.15,.25):new THREE.Vector3(Math.sign(r.q.x-partX)||ps,.1,-.35),hug:r=>true},
  atras:{len:r=>.4,dir:r=>new THREE.Vector3((r.q.x-hc.x)*.3,r.f>.2?.45:.05,-1),hug:r=>r.f<=.2}};
 const DG=fromPack?null:DEGRADADOS[L.peinado];
 if(DG){const topZ=(u,f,x)=>smx(smn(smn(u-.76,.64-x),f+.6),smn(smn(f-.3,u-.74),.72-x)),sides=(u,f,x)=>smn(capMask(u,f,x),-topZ(u,f,x));
  hairShell(sides,.025,new THREE.Color(hair).lerp(new THREE.Color(skin),.14),1,true);hairShell(topZ,.08,dark(hair,.85),1,true);
  for(const r of roots(topZ,.17)){const w=(DG.w?DG.w(r):.36)*(.85+rnd()*.3);lock(r.q,DG.dir(r),DG.len(r)*(.85+rnd()*.3),w,w*.55,{segs:DG.bend?3:2,g:0,lift:.06,off:.06,tip:DG.tip||0,grad:[.8,1.08],under:true,face:false,hug:DG.hug(r),bend:DG.bend?DG.bend(r):0});}
  flushLocks(addHair);}
 const CR=fromPack?null:CORONAS[L.peinado];
 if(CR){hairShell(capMask,CR.cap,dark(hair,.82),1);const R=(wid+dep)/4,G=[.78,1.1];
  // (la corona: de la nuca al lado, ordenada por ángulo pero variada; el frente es del flequillo)
  for(const [ti,T] of CR.tiers.entries())for(let i=0;i<T.n;i++){const a=(i+(ti%2)*.5)/T.n*Math.PI*2-Math.PI,c=(Math.cos(a)+1)/2;if(Math.abs(a)<.75)continue;
   const mix=v=>c>.5?v[1]+(v[0]-v[1])*(c-.5)*2:v[2]+(v[1]-v[2])*c*2,u=mix(T.u),len=mix(T.len),root=ringRoot(a,u,.03+ti*.04);
   const out=new THREE.Vector3(Math.sin(a),0,Math.cos(a)),dir=new THREE.Vector3(0,-1,0).addScaledVector(out,T.out??.25);
   const k=(i%2?.86:1.08)*(.88+rnd()*.24),w=2*Math.PI*R/T.n*1.3*(.85+rnd()*.35);dir.applyAxisAngle(out,(rnd()-.5)*.5);
   lock(root,dir,len*k,w,w*CR.vol,{segs:len>.3?3:2,g:T.g,lift:.05,tip:0,grad:G,under:true,molde:null,bend:CR.bend*(.6+rnd()*.8),hug:(T.out??.25)<.5});}
  // (arriba: puntas que salen de la cabeza hacia afuera, hacia atrás y —en las de Goku— hacia arriba)
  const TP=CR.top;for(const r of roots((u,f,x)=>capMask(u,f,x)>0&&u>.7&&!(f>.55&&u<.9),TP.sp)){const n=nrm(r.q),dir=n.clone().multiplyScalar(TP.out).add(new THREE.Vector3(0,TP.up,-TP.back));
   if(r.f>.3)dir.z+=.4;const w=.34*(.8+rnd()*.4);lock(r.q,dir,TP.len*(.8+rnd()*.45),w,w*CR.vol,{segs:2,g:-.02,lift:.05,tip:0,grad:G,under:true,molde:null,bend:CR.bend,face:false,hug:TP.out<.8});}
  // El flequillo: 3 a 5 puntas grandes, de anchos y largos distintos, barridas hacia el lado contrario de la raya.
  {const F=3+Math.floor(rnd()*3),sw=CR.sweep??.25;for(let j=0;j<F;j++){const a=-.7+1.4*j/(F-1)+(rnd()-.5)*.15,root=ringRoot(a,.88+rnd()*.06,.05);
    const dir=new THREE.Vector3(Math.sin(a)*.3-ps*sw*(1+j*.2),-1,.55),w=.32*(.8+rnd()*.5);
    lock(root,dir,(CR.fringe||.34)*(.75+rnd()*.5),w,w*CR.vol*.8,{segs:2,g:.1,lift:.04,tip:0,grad:G,under:true,molde:null,bend:.15});}}
  flushLocks(addHair);}
 const HS=fromPack?null:HAIR_STYLES[L.peinado];
 // Dos maneras (2026-10-12): 'puntas' (por defecto, como los muñecos de Dragon Ball: pocas puntas grandes y gruesas,
 // silueta clara, sin hilos) y 'fino' (mechones agrupados en dos capas, con pelos sueltos). L.pelos elige.
 const chunky=L.pelos!=='fino';
 if(HS){hairShell(HS.mask,chunky?HS.base*1.6:HS.base,dark(hair,.8),0);// Grandes, medianas y chicas: la base es la silueta; los mechones van en grupos (uno ancho y, encima, uno o dos más
  // finos que se abren un poco: la segunda capa) y unos pocos pelos sueltos más largos y desviados.
  const CL=HS.clump||{sp:1.3,extra:.6,stray:.12,spread:.25};
  if(chunky){const segs=HS.g>.2?3:2;for(const r of roots(HS.mask,HS.sp*2.3)){const k=.85+rnd()*.3;
   lock(r.q,HS.dir(r),HS.len(r)*k*1.1,HS.w*2.1*k,HS.th*2.8,{segs,g:HS.g,tip:HS.tip?HS.tip*.6:0,lift:.05,off:.03,grad:[.82,1.06]});}}
  else for(const r of roots(HS.mask,HS.sp*CL.sp)){const k=.85+rnd()*.3,d0=HS.dir(r),n=nrm(r.q),segs=HS.segs||3;lock(r.q,d0,HS.len(r)*k,HS.w*1.35*k,HS.th,{segs,g:HS.g,tip:HS.tip||0});
   const side=new THREE.Vector3().crossVectors(n,d0).normalize();
   for(let m=0,M=rnd()<CL.extra?2:1;m<M;m++){const sg=m?-1:1,q=r.q.clone().addScaledVector(side,sg*HS.w*.35);lock(q,d0.clone().applyAxisAngle(n,sg*(.1+rnd()*CL.spread)),HS.len(r)*k*(.75+rnd()*.2),HS.w*.75*k,HS.th*.9,{segs,g:HS.g,off:.045,tip:HS.tip||0});}
   if(rnd()<CL.stray)lock(r.q,d0.clone().applyAxisAngle(n,(rnd()-.5)*1.1),HS.len(r)*1.2,HS.w*.35,HS.th*.7,{segs,g:HS.g,off:.05});}
  // la cola: un manojo que cae desde la nuca; el moño: una bola con mechones que la envuelven
  if(L.peinado==='cola'){const b=new THREE.Vector3(hc.x,hc.y+hs.y*.1,hc.z-dep*.56);outside(b,.04);for(let i=0;i<9;i++){const a=i/9*Math.PI*2,q=b.clone().add(new THREE.Vector3(Math.cos(a)*.06,Math.sin(a)*.06,0));lock(q,new THREE.Vector3(Math.cos(a)*.2,-1,-.35),.75+rnd()*.15,.14,.07,{segs:4,g:.25,off:.05});}}
  if(L.peinado==='moño'){const b=new THREE.Vector3(hc.x,top+.1,hc.z-dep*.2);const bun=new THREE.IcosahedronGeometry(.17,1).toNonIndexed();bun.translate(b.x,b.y,b.z);const P=bun.attributes.position,cc=new THREE.Color(hair);
   for(let i=0;i<P.count;i++){lockPos.push(P.getX(i),P.getY(i),P.getZ(i));lockCol.push(cc.r,cc.g,cc.b);}}
  flushLocks(addHair);}
 else if(L.peinado==='rapado')hairShell((u,f,x)=>f>.25?u>.78:f>-.15?u>.64:u>.34,.025,dark(hair,.85),1);
 // (afro: una base bien inflada y bultos redondos encima, como rizos)
 else if(L.peinado==='afro'){const mask=(u,f,x)=>f>.3?u>.74:f>-.2?u>.5:u>.3;hairShell(mask,.3,dark(hair,.85),1);
  for(const r of roots(mask,chunky?.22:.15)){const n=nrm(r.q),q=r.q.clone().sub(hc).multiplyScalar(1.3).add(hc).addScaledVector(n,.02);const ball=new THREE.IcosahedronGeometry(chunky?.15+rnd()*.05:.1+rnd()*.04,0).toNonIndexed();ball.translate(q.x,q.y,q.z);
   const P=ball.attributes.position,cc=new THREE.Color(hair).multiplyScalar(.88+rnd()*.22);for(let i=0;i<P.count;i++){lockPos.push(P.getX(i),P.getY(i),P.getZ(i));lockCol.push(cc.r,cc.g,cc.b);}}
  flushLocks(addHair);}
 // Las piezas copiadas: cada parte con su color (el pelo y el bigote, del pelo; lo demás, el suyo o el que pida el look).
 const putPiece=(k,colorFor)=>{const pg=got[k];if(!pg)return [];const made=[];for(const pt of pg.parts){const g2=pt.geo.clone(),n=g2.attributes.position.count,c=new THREE.Color(colorFor(pt)),cl=new Float32Array(n*3);
   for(let i=0;i<n;i++){cl[i*3]=c.r;cl[i*3+1]=c.g;cl[i*3+2]=c.b;}g2.setAttribute('color',new THREE.BufferAttribute(cl,3));g2.userData={...g2.userData};g2.userData.part=pt.part;g2.userData.bottomStyle=pg.pc.bottomStyle;g2.userData.accessoryRole=pg.pc.roles?.[pt.part]||(k.startsWith('prenda_')?k.slice(7)==='outer'?'top':k.slice(7):k==='pzPantalon'?'pants':k==='pzArriba'||k==='pzEncima'?'top':null);g2.userData.sourceModel=pg.pc.m;g2.userData.slot=k.startsWith('prenda_')?k.slice(7):k==='pzPelo'?'hair':k==='pzBigote'?'beard':k==='pzSombrero'?'hat':k==='pzBufanda'?'scarf':k==='pzEncima'?'outer':g2.userData.accessoryRole;g2.userData.partId=k.startsWith('prenda_')?L.prendas[k.slice(7)]:`prenda:${pg.pc.m}:${pt.part}:${g2.userData.slot}`;if(!k.startsWith('prenda_')&&overridden(g2.userData.slot))continue;if(['top','pants','inner'].includes(g2.userData.accessoryRole))g2.userData.hemRole=/^Falda/.test(pt.part)?'skirt':g2.userData.accessoryRole;if(k==='pzArriba'||k==='pzEncima')g2.userData.hemRole='top';else if(k==='pzPantalon')g2.userData.hemRole=/^Falda/.test(pt.part)?'skirt':'pants';made.push(g2);}return made;};
 const hatGeos=putPiece('pzSombrero',pt=>L.sombreroColor?col('gorra',L.sombreroColor,'negra'):pt.color);
 hairAll.push(...putPiece('pzPelo',()=>hair));
 // Mezcla (2026-10-12): peinados nuevos armados con MECHONES del paquete (se ven mejor que los generados: cada mechón ya
 // tiene buena forma, grosor y curva). Todos los modelos comparten la cabeza, así que un mechón de un pelo cae bien en
 // otro. Cada mechón (locksOf) va a una zona por su centro —fleco, lados, nuca o base (lo de arriba)— y cada zona sale
 // del pelo que diga L.mezcla ({base, fleco, lados, nuca}; lo que falte, de la base).
 if(L.mezcla&&L.mezcla.base){const MZ=L.mezcla,src=[...new Set(['base','fleco','lados','nuca'].map(z=>MZ[z]||MZ.base))],PG={};
  for(const m of src){const pg=await pieceGeo('pelo:'+m,900,CU,L.acabado!==false);if(pg)PG[m]=pg.parts[0]?.geo;}
  const zoneOf=(x0,y0,z0)=>{const u=(y0-hb.min.y)/hs.y,f=(z0-hc.z)/(dep/2),x=Math.abs(x0-hc.x)/(wid/2);return f>.35&&u<.92?'fleco':f<-.35&&u<.8?'nuca':x>.62&&u<.75?'lados':'base';};
  for(const m of src){const g=PG[m];if(!g)continue;const P=g.attributes.position,comp=locksOf(g),acc=new Map();
   for(let t=0;t<P.count/3;t++){const c=comp[t],a=acc.get(c)||[0,0,0,0];for(let k=0;k<3;k++){const i=t*3+k;a[0]+=P.getX(i);a[1]+=P.getY(i);a[2]+=P.getZ(i);}a[3]+=3;acc.set(c,a);}
   const take=new Set();for(const [c,a] of acc){const z=zoneOf(a[0]/a[3],a[1]/a[3],a[2]/a[3]);if((MZ[z]||MZ.base)===m)take.add(c);}
   const keep=[];for(let t=0;t<P.count/3;t++)if(take.has(comp[t]))keep.push(t*3);if(!keep.length)continue;
   const g2=keepTris(g,keep),n=g2.attributes.position.count,cc=new THREE.Color(hair),cl=new Float32Array(n*3);for(let i=0;i<n;i++){cl[i*3]=cc.r;cl[i*3+1]=cc.g;cl[i*3+2]=cc.b;}
   g2.setAttribute('color',new THREE.BufferAttribute(cl,3));hairAll.push(g2);}}
 // El corte (2026-10-12): los pelos largos del paquete (los de mujer) llevados a hombre sin perder sus mechones. Lo que
 // queda por debajo de L.corte (u: 0 la pera, 1 la coronilla) se comprime hacia arriba (queda ×k de largo) y hacia la
 // cabeza (lo que sobresale de los lados también ×k): las puntas siguen siendo puntas, sólo más cortas y pegadas.
 if(L.corte!=null&&L.corte!==''){const cy=hb.min.y+hs.y*Number(L.corte),k=L.corteK??.22,rx=wid/2*1.08,rz=dep/2*1.08;
  // (lo que colgaba entero por debajo de la pera se saca: comprimido quedaba como bolitas en el cuello)
  for(let gi=0;gi<hairAll.length;gi++){const g=hairAll[gi],P=g.attributes.position,keep=[],low=hb.min.y+hs.y*.04;for(let t=0;t<P.count;t+=3)if(Math.max(P.getY(t),P.getY(t+1),P.getY(t+2))>low)keep.push(t);if(keep.length<P.count/3)hairAll[gi]=keepTris(g,keep);}
  for(const g of hairAll){const P=g.attributes.position;for(let i=0;i<P.count;i++){let y=P.getY(i);if(y>=cy)continue;const t=Math.min(1,(cy-y)/(hs.y*.25));
    y=cy-(cy-y)*k;let dx=P.getX(i)-hc.x,dz=P.getZ(i)-hc.z;const e=Math.hypot(dx/rx,dz/rz);if(e>1){const f=(1+(e-1)*(1-t*(1-k)))/e;dx*=f;dz*=f;}
    P.setXYZ(i,hc.x+dx,y,hc.z+dz);}
   // (el fleco que baja sobre los ojos sube hasta las cejas, comprimido igual: medido, cejas hasta u .65)
   const by=hb.min.y+hs.y*.68;for(let i=0;i<P.count;i++){const y=P.getY(i),f=(P.getZ(i)-hc.z)/(dep/2),x=Math.abs(P.getX(i)-hc.x)/(wid/2);if(y<by&&f>.3&&x<.85&&y>hb.min.y+hs.y*.25)P.setY(i,by-(by-y)*.2);}
   P.needsUpdate=true;}}
 // Entradas y coronilla sobre cualquier pelo del catálogo (L.entradas, L.coronilla): se sacan los triángulos de esa
 // zona. Debajo de un pelo del catálogo va una base oscura pegada (la misma zona menos lo sacado) para que entre
 // mechones no se vea el cuero.
 const ENTRADAS=(u,f,x)=>f>.2&&x>.28&&u>.68&&u<.94,CORONILLA=(u,f,x)=>u>.8&&f<.4&&f>-.8&&x<.7;
 // (por mechón entero: el pelo del paquete son 17 a 25 mechones sueltos; sacar triángulos dejaba astillas flotando)
 if((L.pzPelo||L.mezcla)&&(L.entradas||L.coronilla)&&L.acabado!==false)softenBalding(hairAll,skinGeo,hb,{entradas:L.entradas,coronilla:L.coronilla,color:skin});
 if((L.pzPelo||L.mezcla)&&(L.entradas||L.coronilla)&&L.acabado===false)for(let gi=0;gi<hairAll.length;gi++){const g=hairAll[gi],P=g.attributes.position,n=P.count/3,comp=locksOf(g),inZ=new Map(),tot=new Map();
  for(let t=0;t<n;t++){const i=t*3,cx=(P.getX(i)+P.getX(i+1)+P.getX(i+2))/3,cy=(P.getY(i)+P.getY(i+1)+P.getY(i+2))/3,cz=(P.getZ(i)+P.getZ(i+1)+P.getZ(i+2))/3;
   const u=(cy-hb.min.y)/hs.y,f=(cz-hc.z)/(dep/2),x=Math.abs(cx-hc.x)/(wid/2),c=comp[t];tot.set(c,(tot.get(c)||0)+1);if(L.entradas&&ENTRADAS(u,f,x)||L.coronilla&&CORONILLA(u,f,x))inZ.set(c,(inZ.get(c)||0)+1);}
  const keep=[];for(let t=0;t<n;t++){const c=comp[t];if((inZ.get(c)||0)/tot.get(c)>(L.coronilla?.15:.35))continue;keep.push(t*3);}hairAll[gi]=keepTris(g,keep);}
 if((L.pzPelo||L.mezcla)&&L.base!==false)hairShell((u,f,x)=>corto(u,f,x)&&!(L.entradas&&ENTRADAS(u,f,x))&&!(L.coronilla&&CORONILLA(u,f,x)),.025,dark(hair,.7),1);
 // Bajo el sombrero. 1) Se asienta: baja hasta el cráneo (la piel de la cabeza bajo la copa) más un colchón de pelo.
 // 2) Se recorta el pelo con la forma del sombrero YA asentado: un mapa de alturas con la cara de abajo del sombrero en
 // cada celda (x, z). El pelo por encima de esa cara (adentro de la copa, o atravesando el ala) se va; el de abajo
 // queda, así entre el ala y la cabeza sigue habiendo pelo y no parece calvo. Fuera de la huella del sombrero, el pelo
 // que sube más que el ala también se va (es el que asomaría por los lados).
 if(hatGeos.length&&skinGeo){const bx=()=>{const b=new THREE.Box3();for(const g2 of hatGeos){g2.computeBoundingBox();b.union(g2.boundingBox);}return b;};let hb2=bx();const hh=hb2.max.y-hb2.min.y;
  const cb=new THREE.Box3();for(const g2 of hatGeos){const P=g2.attributes.position;for(let i=0;i<P.count;i++)if(P.getY(i)>hb2.min.y+hh*.25)cb.expandByPoint(new THREE.Vector3(P.getX(i),P.getY(i),P.getZ(i)));}
  if(cb.isEmpty())cb.copy(hb2);
  let skull=-Infinity;{const P=skinGeo.attributes.position;for(let i=0;i<P.count;i++){const x=P.getX(i),z=P.getZ(i);if(x>cb.min.x&&x<cb.max.x&&z>cb.min.z&&z<cb.max.z&&P.getY(i)<hb2.min.y+hh*.6)skull=Math.max(skull,P.getY(i));}}
  const gap=hb2.min.y-(skull+hs.y*.06);if(isFinite(skull)&&gap>hh*.03){for(const g2 of hatGeos)g2.translate(0,-gap,0);hb2=bx();}
  const CELL=.05,key=(x,z)=>Math.floor(x/CELL)+','+Math.floor(z/CELL),under=new Map(),put=(x,y,z)=>{const k=key(x,z);if(!(under.get(k)<=y))under.set(k,y);};
  for(const g2 of hatGeos){const P=g2.attributes.position;for(let t=0;t<P.count;t+=3){const p=[0,1,2].map(k=>[P.getX(t+k),P.getY(t+k),P.getZ(t+k)]);
    // (los vértices, el centro y una grilla dentro del triángulo: un triángulo grande no deja huecos en el mapa)
    for(let a=0;a<=4;a++)for(let b=0;b<=4-a;b++){const w0=a/4,w1=b/4,w2=1-w0-w1;put(p[0][0]*w0+p[1][0]*w1+p[2][0]*w2,p[0][1]*w0+p[1][1]*w1+p[2][1]*w2,p[0][2]*w0+p[1][2]*w1+p[2][2]*w2);}}}
  const at=(x,z)=>{let m=Infinity;const i0=Math.floor(x/CELL),j0=Math.floor(z/CELL);for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){const u=under.get((i0+i)+','+(j0+j));if(u!==undefined&&u<m)m=u;}return m;};
  const brimTop=hb2.min.y+hh*.1;
  for(let gi=0;gi<hairAll.length;gi++){const g2=hairAll[gi],P=g2.attributes.position,keep=[];
   for(let t=0;t<P.count;t+=3){let out=false;for(let k=0;k<3&&!out;k++){const x=P.getX(t+k),y=P.getY(t+k),z=P.getZ(t+k),u=at(x,z);out=u<Infinity?y>u+.02:y>brimTop;}if(!out)keep.push(t);}
   hairAll[gi]=keepTris(g2,keep);}}
 for(const g2 of hairAll){g2.userData.slot='hair';g2.userData.partId=L.pzPelo||'hair:'+L.peinado;}
 for(const g2 of [...hatGeos,...hairAll,...putPiece('pzBigote',()=>hair),...[...putPiece('pzBufanda',pt=>pt.color),...putPiece('pzEncima',pt=>L.encimaColor?col('ropa',L.encimaColor,'roja'):pt.color).map(g=>(g.userData.holgura=.075,g)),
  ...putPiece('pzArriba',pt=>paint[got.pzArriba.pc.roles?.[pt.part]]||paint.top).map(g=>{paintPattern(g,L.estampado,L.estampadoColor?col('ropa',L.estampadoColor,'blanca'):dark(paint.top,.55));return g;}),...putPiece('pzPantalon',pt=>paint[got.pzPantalon.pc.roles?.[pt.part]]||paint.pants).map(g=>{if(!/^Falda/.test(g.userData.part||''))paintPants(g,{gastado:L.gastado,bota:L.bota,bolsillos:L.bolsillos},KNEE,HIP);return g;})].map(g=>(CLOTH.add(g),g))])add(g2);
 for(const k of Object.keys(got).filter(k=>k.startsWith('prenda_'))){const slot=k.slice(7);for(const g2 of putPiece(k,pt=>paint[got[k].pc.roles?.[pt.part]]||paint[slot]||paint.top)){g2.userData.holgura=slot==='inner'?.028:slot==='outer'?.09:slot==='top'?.055:.035;if(slot==='top')paintPattern(g2,L.estampado,L.estampadoColor?col('ropa',L.estampadoColor,'blanca'):dark(paint.top,.55));if(slot==='pants'&&!got[k].pc.falda&&!got[k].pc.bottomStyle)paintPants(g2,{gastado:L.gastado,bota:L.bota,bolsillos:L.bolsillos},KNEE,HIP);CLOTH.add(g2);add(g2);}}
 // El material Shirt del traje sólo incluía lo que asoma del saco. Completar
 // la camisa permite quitar saco y corbata sin descubrir sus huecos en la piel.
 for(const inner of [...CLOTH].filter(g=>g.userData.slot==='inner'&&/^Suit_/.test(g.userData.sourceModel||''))){
  const pg=await pieceGeo('prenda:Casual2_Male:Shirt:top',600,CU,L.acabado!==false);const source=pg?.parts[0]?.geo;if(!source)continue;
  const fill=source.clone(),n=fill.attributes.position.count,c=new THREE.Color(paint.inner),colors=new Float32Array(n*3);for(let i=0;i<n;i++)colors.set([c.r,c.g,c.b],i*3);fill.setAttribute('color',new THREE.BufferAttribute(colors,3));
  fill.userData={...inner.userData,holgura:.020,skinTight:true,hemRole:undefined};inner.userData.holgura=.036;geos.push(fill);CLOTH.add(fill);
 }
 // Las orejas: el paquete no trae; una elipse chata a cada lado, a la altura de los ojos (un poco abajo).
 if(L.orejas!==false)for(const sd of [1,-1]){const e=nonIdx(new THREE.IcosahedronGeometry(1,1));e.deleteAttribute('uv');e.scale(.06,.13,.1);e.rotateZ(sd*.12);
  e.translate(hc.x+sd*(wid/2-.005),hb.min.y+hs.y*.4,hc.z-dep*.04);const n=e.attributes.position.count,c=new THREE.Color(dark(skin,.93)),cl=new Float32Array(n*3),si=new Uint16Array(n*4),sw=new Float32Array(n*4);
  for(let i=0;i<n;i++){cl[i*3]=c.r;cl[i*3+1]=c.g;cl[i*3+2]=c.b;si[i*4]=H;sw[i*4]=1;}e.setAttribute('color',new THREE.BufferAttribute(cl,3));e.setAttribute('skinIndex',new THREE.BufferAttribute(si,4));e.setAttribute('skinWeight',new THREE.BufferAttribute(sw,4));add(e);}
 // Barbas propias: la piel de la quijada inflada, como los peinados (u: de la pera a la coronilla; f: de la nuca a
 // la cara; x: del medio a la oreja). La de tres días va del color del pelo mezclado con la piel, casi pegada.
 // (medido: los ojos y las cejas van de u .38 a .65 y de x .29 a .75; la barba queda abajo y sube por los lados)
 // (como zonas continuas, recortadas en el contorno: medido, ojos y cejas de u .38 a .65)
 const BARBAS={completa:[(u,f,x)=>smn(f+.1,smx(.3-u,smn(x-.72,.52-u))),.06,hair],tres_dias:[(u,f,x)=>smn(f+.1,smx(.3-u,smn(x-.72,.5-u))),.016,new THREE.Color(hair).lerp(new THREE.Color(skin),.45)],
  candado:[(u,f,x)=>smn(f-.45,smx(smn(.25-u,.16+u*.6-x),smn(smn(u-.25,.35-u),.44-(u-.25)*1.2-x))),.05,hair],chiva:[(u,f,x)=>smn(smn(f-.55,.24-x),.2-u),.08,hair],
  bigote:[(u,f,x)=>smn(smn(f-.55,.44-x),smn(u-.26,.33-u)),.05,hair],patillas:[(u,f,x)=>smn(smn(x-.8,smn(u-.3,.6-u)),smn(f+.2,.45-f)),.05,hair],
  // (de las cabezas low poly de JustCreate3D: barba de contorno —la línea de la mandíbula y la pera— y corta completa
  // con el bigote aparte, separado por una franja de piel en la comisura)
  contorno:[(u,f,x)=>smn(f+.1,smx(.12-u,smn(x-.7,.52-u))),.07,hair],
  corta:[(u,f,x)=>smn(smx(smn(f+.1,smx(.24-u,smn(x-.66,.52-u))),smn(smn(f-.55,.42-x),smn(u-.27,.33-u))),-smn(smn(f-.5,smn(x-.38,.6-x)),smn(u-.2,.34-u))),.07,hair]};
 const TALLA={completa:.09,candado:.08,chiva:.1,bigote:.07,patillas:.06,contorno:.07,corta:.08};
 // Encima de la base, mechones cortos que caen (como la barba del vikingo); el bigote abre hacia los lados.
 const down=r=>new THREE.Vector3(0,-1,.25),side=r=>new THREE.Vector3(Math.sign(r.q.x-hc.x)||1,-.7,.1);
 const BARBA_LOCKS={completa:{sp:.1,len:.17,w:.15,th:.06,g:.2,dir:down},candado:{sp:.08,len:.12,w:.11,th:.05,g:.2,dir:down},chiva:{sp:.07,len:.2,w:.11,th:.05,g:.3,dir:down},
  bigote:{sp:.07,len:.14,w:.1,th:.04,g:.15,dir:side},patillas:{sp:.09,len:.1,w:.1,th:.04,g:.2,dir:down}};
 const beardStart=geos.length;
 const bk=L.barba===true?'completa':L.barba,bs=BARBAS[bk];if(bs&&!L.barbaMechones&&TALLA[bk]){const [keep,,color]=bs;const before=hairAll.length;hairShell(keep,TALLA[bk],color,2,true);geos.push(...hairAll.splice(before).map(g=>(g.userData={...g.userData,slot:'beard',partId:'barba:'+bk},g)));}
 else if(bs){const [keep,grow,color]=bs;const before=hairAll.length;hairShell(keep,BARBA_LOCKS[bk]?grow*.5:grow,BARBA_LOCKS[bk]?dark(hair,.8):color,2);geos.push(...hairAll.splice(before).map(g=>(g.userData={...g.userData,slot:'beard',partId:'barba:'+bk},g)));
  const BL=BARBA_LOCKS[bk];if(BL){const ck=L.pelos!=='fino';for(const r of roots(keep,BL.sp*(ck?1.7:1))){const k=.85+rnd()*.3;lock(r.q,BL.dir(r),BL.len*k*(ck?1.15:1),BL.w*k*(ck?1.7:1),BL.th*(ck?2:1),{segs:2,g:BL.g,off:.02,lift:.02,face:false,grad:ck?[.82,1.06]:[.7,1.15]});}flushLocks(g=>geos.push(g));}}
 if(L.barba==='caja'){add(rboxGeo([hc.x,hb.min.y+hs.y*.12,front-.06],[wid*.86,hs.y*.26,.16],hair,H,.07));for(const s of [1,-1])add(rboxGeo([hc.x+s*wid*.43,hb.min.y+hs.y*.3,hc.z+dep*.2],[.1,hs.y*.36,dep*.4],hair,H,.05));}
 for(const g of geos.slice(beardStart)){g.userData.slot='beard';g.userData.partId='barba:'+bk;}
 const hatStart=geos.length;
 if(L.gorra){const c=col('gorra',L.gorra,'azul');add(rboxGeo([hc.x,top-hs.y*.12,hc.z-.02],[wid+.14,hs.y*.32,dep+.12],c,H,.14));add(rboxGeo([hc.x,top-hs.y*.28,front+.12],[wid*.8,.06,.36],dark(c,.85),H,.03));}
 for(const g of geos.slice(hatStart)){g.userData.slot='hat';g.userData.partId='gorra:'+L.gorra;}
 const glassesStart=geos.length;
 if(L.gafas&&L.accesoriosPulidos===false){const c=col('gafas',L.gafas,'negras'),ey=hc.y+hs.y*.02;for(const s of [1,-1])add(rboxGeo([hc.x+s*wid*.2,ey,front+.03],[wid*.3,hs.y*.15,.04],c,H,.02));add(rboxGeo([hc.x,ey+hs.y*.04,front+.03],[wid*.14,.04,.04],c,H,.01));}
 for(const g of geos.slice(glassesStart)){g.userData.slot='glasses';g.userData.partId='gafas:'+L.gafas;}
 if(L.mochila){const T=I('Torso'),tb=boneBounds(geos,T),c=col('mochila',L.mochila,'café'),bag=rboxGeo([tb.getCenter(new THREE.Vector3()).x,(tb.min.y+tb.max.y)/2,tb.min.z-.16],[.62,.7,.3],c,T,.1),pocket=rboxGeo([tb.getCenter(new THREE.Vector3()).x,tb.min.y+.18,tb.min.z-.33],[.44,.26,.1],dark(c,.85),T,.05);bag.userData={accessoryRole:'bag',slot:'backpack',partId:'mochila:'+L.mochila};pocket.userData={accessoryRole:'bagPocket',slot:'backpack',partId:'mochila:'+L.mochila};add(bag);add(pocket);}
 // Los pies: el paquete termina la pierna en punta. Una caja redondeada en cada pie (del color del zapato, o de la
 // piel si va descalzo), del ancho del tobillo hacia adelante.
 const shoeC=L.calzado==='tenis-bajos'?skin:L.desnudo&&!L.zapatos||L.zapatos==='no'?skin:col('zapatos',L.zapatos,'negros');
 if(L.pies!==false)for(const n of ['FootL','FootR']){const j=I(n),b=boneBounds(geos,j);if(b.isEmpty())continue;const c=b.getCenter(new THREE.Vector3()),w=Math.max(.2,(b.max.x-b.min.x)*1.15),h=Math.max(.12,(b.max.y-b.min.y)*.55);
  // (los zapatos: suela de otro color —L.suela, o clara si el zapato es oscuro y al revés— y, con L.cordones, una
  // franja arriba al frente; descalzo, nada)
  const fg=rboxGeo([c.x,b.min.y+h/2,b.max.z-.02],[w,h,.4],shoeC,j,.06);
  if(shoeC!==skin){const sc=new THREE.Color(shoeC),lum=.3*sc.r+.6*sc.g+.1*sc.b,sole=new THREE.Color(L.suela?col('zapatos',L.suela,'blancos'):lum<.15?'#e8e6df':'#2a2a2a'),lace=new THREE.Color(L.cordones?col('zapatos',L.cordones,'blancos'):'#e8e6df'),y0=b.min.y,zc=b.max.z-.02;
   cutAndPaint(fg,[{f:v=>v[1],vals:[y0+.035]},...(L.cordones?[{f:v=>v[2],vals:[zc-.02]},{f:v=>Math.abs(v[0]-c.x),vals:[w*.18]}]:[])],(cen,nn)=>
    cen.y<y0+.035?[sole.r,sole.g,sole.b]:L.cordones&&nn.y>.5&&cen.z>zc-.02&&Math.abs(cen.x-c.x)<w*.18?[lace.r,lace.g,lace.b]:null);}
  fg.userData={slot:shoeC===skin?'body':'shoes',partId:shoeC===skin?'body':'zapatos:par'};add(fg);}
 // Las articulaciones: en el codo y la rodilla doblados la piel se angosta (la mezcla lineal de dos huesos). Una
 // esfera chica en cada una, mitad de cada hueso, la rellena; su radio y su color salen de lo que hay alrededor de la
 // articulación (la manga o el pantalón si los hay, si no la piel).
 // (con los huesos de apoyo del cuerpo de Blender no hacen falta)
 if(L.articulaciones!==false&&!sk.bones.some(b=>/^Elbow/.test(b.name))){const ico=nonIdx(new THREE.IcosahedronGeometry(1,1));ico.deleteAttribute('uv');
  for(const n of ['LowerArmL','LowerArmR','LowerLegL','LowerLegR']){const j=I(n),pj=sk.bones.indexOf(sk.bones[j].parent);if(pj<0)continue;
   const o=new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(sk.boneInverses[j]).invert()),op=new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(sk.boneInverses[pj]).invert()),a=o.clone().sub(op).normalize();
   const rs=[];let best=-1,bc=null,above=false,below=false;const v=new THREE.Vector3();
   for(const g of geos){const P=g.attributes.position,J=g.attributes.skinIndex,W=g.attributes.skinWeight,C=g.attributes.color;if(!C)continue;for(let i=0;i<P.count;i++){let bw=0,bj=-1;for(let k=0;k<4;k++){const w=W.getComponent(i,k);if(w>bw){bw=w;bj=J.getComponent(i,k);}}if(bj!==j&&bj!==pj)continue;
     // (el color: lo más de afuera JUSTO a la altura de la articulación; con ±7 cm tomaba el pantalón corto que termina arriba de la rodilla)
     v.fromBufferAttribute(P,i).sub(o);const al=v.dot(a);if(g!==skinGeo&&v.clone().addScaledVector(a,-al).length()<.4){if(al>.12)below=true;if(al<-.12)above=true;}if(Math.abs(al)>.07)continue;const r=v.addScaledVector(a,-al).length();rs.push(r);if(Math.abs(al)<.025&&r>best){best=r;bc=[C.getX(i),C.getY(i),C.getZ(i)];}}}
   // (si ninguna prenda pasa la articulación de lado a lado —el short que termina en la rodilla—, va del color de la piel)
   if(!(above&&below)){const sc=new THREE.Color(skin);bc=[sc.r,sc.g,sc.b];}
   if(rs.length<6||!bc)continue;rs.sort((x,y)=>x-y);const r=rs[Math.floor(rs.length*.5)]*.9;// (la mitad del grosor de ahí: rellena al doblar sin hacer nudo al estirar)
   const g=ico.clone();g.scale(r,r,r);g.translate(o.x,o.y,o.z);const m=g.attributes.position.count,cl=new Float32Array(m*3),si=new Uint16Array(m*4),sw=new Float32Array(m*4);
   for(let i=0;i<m;i++){cl.set(bc,i*3);si[i*4]=pj;si[i*4+1]=j;sw[i*4]=.5;sw[i*4+1]=.5;}
   g.setAttribute('color',new THREE.BufferAttribute(cl,3));g.setAttribute('skinIndex',new THREE.BufferAttribute(si,4));g.setAttribute('skinWeight',new THREE.BufferAttribute(sw,4));g.userData={...g.userData,joint:n};add(g);}}
 // (para juntar, todas con los mismos datos: posición, color y piel; la luz es plana, no hacen falta normales)
 for(let i=0;i<geos.length;i++){let g=geos[i];if(g.index)g=geos[i]=g.toNonIndexed();for(const a of Object.keys(g.attributes))if(!['position','color','skinIndex','skinWeight'].includes(a))g.deleteAttribute(a);
  const si=g.attributes.skinIndex;if(!(si.array instanceof Uint16Array))g.setAttribute('skinIndex',new THREE.BufferAttribute(Uint16Array.from(si.array),4));
  const sw=g.attributes.skinWeight;if(!(sw.array instanceof Float32Array))g.setAttribute('skinWeight',new THREE.BufferAttribute(Float32Array.from(sw.array,x=>sw.normalized?x/255:x),4));
  const c=g.attributes.color;if(c&&!(c.array instanceof Float32Array))g.setAttribute('color',new THREE.BufferAttribute(Float32Array.from(c.array),3));}
 if(L.calzado==='tenis-bajos'&&skinGeo)cutAndPaint(skinGeo,[{f:v=>v[1],vals:[.20]}],()=>null);
 if(L.cinturaInterior&&skinGeo)stabilizeHip(skinGeo,sk);
 if(skinGeo&&['ropero:chaqueta-abierta','ropero:chaleco-abierto','ropero:chaqueta-cerrada'].includes(L.prendas?.outer))conformBasicShirt(skinGeo,[...CLOTH],sk,true);
 if(L.cinturaInterior){alignShortWaist([...CLOTH],HIP);for(const g of CLOTH)if(/^Falda/.test(g.userData.part||'')){g.userData.hemRole=null;}if(skinGeo){conformBasicShirt(skinGeo,[...CLOTH],sk);conformShorts(skinGeo,[...CLOTH],sk);}}
 if(!L.cinturaInterior&&skinGeo&&['ropero:camiseta-manga-larga','ropero:camiseta-sin-mangas','ropero:camisa-botones','ropero:polo','ropero:camisa-manga-larga','ropero:sudadera','ropero:sudadera-capucha'].includes(L.prendas?.top))conformBasicShirt(skinGeo,[...CLOTH],sk);
 if(skinGeo&&['ropero:chaqueta-abierta','ropero:chaleco-abierto','ropero:chaqueta-cerrada'].includes(L.prendas?.outer)){const pattern=skinGeo.clone();conformBasicShirt(pattern,[...CLOTH],sk,true,true);pattern.dispose();}
 if(!L.desnudo&&(L.prendas?.belt||L.prendas?.pants))alignBelt([...CLOTH]);
 if(skinGeo&&L.ajustar!==false)fitGarments(skinGeo,[...CLOTH],sk,L.holgura??.03);
 if(skinGeo&&L.ropaInterior!==false){const g=underwear(skinGeo,sk,L.interiorColor);geos.push(g);CLOTH.add(g);}
 // Los dobladillos se extruyen sobre los bordes ya ajustados: conservan el pliegue y siguen la prenda.
 if(!L.desnudo&&L.dobladillos!==false){const style=await loadHemProfile();for(const g of [...CLOTH])if(g.userData.hemRole){const h=clothHems(g,style,{role:g.userData.hemRole,hip:HIP});if(h){CLOTH.add(h);geos.push(h);}}}
 // Los huesos de falda (2026-10-12): con falda, dos huesos hijos del cuerpo en la cadera (con la orientación del muslo)
 // a los que pasa el peso de pierna de la falda; en cada cuadro siguen al muslo según cuánto esté levantado (followSkirt).
 let SK=sk;const faldas=geos.filter(g=>/^Falda/.test(g.userData.part||''));
 if(faldas.length){const extra=[],inv=[];for(const s2 of ['L','R']){const ul=sk.bones.find(b=>b.name==='UpperLeg'+s2);if(!ul)continue;const sb=new THREE.Bone();sb.name='Skirt'+s2;sb.position.copy(ul.position);sb.quaternion.copy(ul.quaternion);sb.userData.restQ=ul.quaternion.toArray();sb.userData.wardrobe=!!L.cinturaInterior;ul.parent.add(sb);
   const from=sk.bones.indexOf(ul),to=sk.bones.length+extra.length;extra.push(sb);inv.push(sk.boneInverses[from].clone());
   for(const g of faldas){const J=g.attributes.skinIndex;for(let i=0;i<J.count;i++)for(let k=0;k<4;k++)if(J.getComponent(i,k)===from)J.setComponent(i,k,to);J.needsUpdate=true;}}
  SK=new THREE.Skeleton([...sk.bones,...extra],[...sk.boneInverses,...inv]);}
 // (qué es piel y qué es ropa, por vértice: para la versión de lejos)
 let kinds=new Uint8Array(geos.reduce((n,g)=>n+g.attributes.position.count,0));{let o=0;for(const g of geos){const n=g.attributes.position.count;kinds.fill(g===skinGeo?1:CLOTH.has(g)?2:0,o,o+n);o+=n;}}
 const accessoryRanges=[];{let offset=0;for(const g of geos){const count=g.attributes.position.count,slot=g.userData.slot||'body';accessoryRanges.push({start:offset,count,role:g.userData.accessoryRole||slot,model:g.userData.sourceModel,slot,id:g.userData.partId||slot,hem:!!g.userData.dobladillo,joint:g.userData.joint,bottomStyle:g.userData.bottomStyle,basicShirt:!!g.userData.basicShirt,...(g.userData.shirtGap?{shirtGap:g.userData.shirtGap}:{}),wardrobeSkirt:!!(L.cinturaInterior&&g.userData.sourceModel==='Prendas'),followSkin:!!g.userData.followSkin,...(g.userData.shortGap?{shortGap:g.userData.shortGap}:{}),...(g.userData.bonded?{bonded:true,skinVertices:g.userData.skinVertices}:{})});offset+=count;}}
 let geo=mergeGeometries(geos);if(L.limpiarPesos!==false)cleanWeights(geo,SK);shapeBody(geo,SK,{...L,perfil:skinGeo?.userData.torsoProfile});let accessoryStats=null;geo.userData.baseParts=accessoryRanges;if(L.cinturaInterior){offsetShorts(geo);offsetBasicShirt(geo);fitSkirtWaist(geo,SK);({geo,kinds}=addCargoPockets(geo,kinds,SK));}else offsetBasicShirt(geo);
 ({geo,kinds}=addButtonShirtDetails(geo,kinds));
 ({geo,kinds}=addButtonShirtDetails(geo,kinds,true));
 ({geo,kinds}=addVestShoulders(geo,kinds,L.contextura,SK));
 ({geo,kinds}=addHoodDetails(geo,kinds));
 if(L.accesoriosPulidos!==false&&(!L.desnudo||(L.reloj&&L.reloj!=='no')||L.gafas||L.mochila)){const acc=await polishAccessories(geo,SK,L,geo.userData.baseParts||accessoryRanges,kinds,{root,idle:(g.animations?.length?g.animations:t.clips).find(c=>c.name==='Idle')});geo=acc.geo;kinds=acc.kinds;accessoryStats=acc.stats;}geo.userData.wardrobeParts=geo.userData.wardrobeParts||accessoryRanges;if(L.calzado==='tenis-bajos')({geo,kinds}=addSneakers(geo,kinds,SK));geo.computeBoundingSphere();
 const mesh=new THREE.SkinnedMesh(geo,MAT);mesh.bind(SK,m0.bindMatrix);mesh.castShadow=true;mesh.frustumCulled=false;m0.parent.add(mesh);for(const o of real)o.parent.remove(o);
 const holder=new THREE.Group();holder.add(root);root.scale.setScalar(scale*(L.talla||1));
 // (copia propia: se le agrega Typing, y la lista de largeClips es compartida)
 const baseClips=largeClips(g.animations?.length?g.animations:t.clips,L),clips=baseClips.map(c=>L.cinturaInterior&&c.name==='Jump'?softenJump(c,baseClips.find(c=>c.name==='Idle')):c),mixer=new THREE.AnimationMixer(root),clip=n=>THREE.AnimationClip.findByName(clips,n);
 const acts={idle:mixer.clipAction(clip('Idle')),walk:mixer.clipAction(clip('Walk')),run:mixer.clipAction(clip('Run'))};acts.idle.play();acts.idle.time=rand()*acts.idle.getClip().duration;
 // Los pies con piernas largas: en el paquete el pie es un hueso suelto (cuelga de la raíz) que la animación ubica por su
 // cuenta. Con la canilla alargada, en cada cuadro el pie va al final de la pierna: su posición en el espacio de la
 // canilla (en la pose de atado) estirada por el largo, llevada al mundo. Sin esto, al correr la pierna de atrás se
 // estiraba como un elástico.
 if(L.cinturaInterior)installLegFoldLimit(mixer,mesh,L.prendas?.pants==='ropero:bermuda'?1.2:L.contextura==='gordo'?1.3:['robusto','atlético'].includes(L.contextura)?1.4:1.55);installFeet(root,mixer,holder,L.piernas||1,!!L.cinturaInterior,L.cinturaInterior&&(L.calzado==='tenis-bajos'||['prenda:Casual2_Male:Pants:pants','ropero:deportivo','ropero:leggings','ropero:cargo'].includes(L.prendas?.pants)));
 // (la falda, después de los pies: el muslo ya quedó donde va)
 {const fs=followSkirt(root);if(fs){const up0=mixer.update.bind(mixer);mixer.update=dt=>{const r=up0(dt);fs();return r;};}}
 // Trabajar en el computador (2026-10-12): el paquete no lo trae. Se arma desde el final de SitDown: los brazos hacia
 // adelante —el brazo de arriba cae hacia adelante, el antebrazo horizontal sobre el teclado—, la cabeza un poco abajo,
 // y las manos teclean alternadas (el antebrazo sube y baja unos grados, a destiempo). Una vuelta de 1,2 s.
 // (si el cuerpo ya la trae —hecha en Blender, scripts/blender/animaciones.py—, ésa)
 for(const [k,n] of [['trabajar','Typing'],['esposar','Arrest'],['esposado','Cuffed'],['esposadoCamina','Walk_Cuffed'],['celular','Phone'],['celularCamina','Walk_Phone'],['comer','Eat_Sitting']]){const c=clip(n);if(c)acts[k]=mixer.clipAction(c);}
 {const sit=!acts.trabajar&&clip('SitDown');if(sit){let skel=null;root.traverse(o=>{if(o.isSkinnedMesh&&!skel)skel=o.skeleton;});const tm=new THREE.AnimationMixer(root),ta=tm.clipAction(sit);ta.play();ta.paused=true;ta.time=sit.duration*.999;tm.update(0);root.updateMatrixWorld(true);
  const B=n=>skel.bones.find(b=>b.name===n),fwd=new THREE.Vector3(0,0,1),dn=new THREE.Vector3(0,-1,0),qs={};
  const aim=(bone,child,dir)=>{const a=bone.getWorldPosition(new THREE.Vector3()),c=child.getWorldPosition(new THREE.Vector3()),cur=c.sub(a).normalize(),dq=new THREE.Quaternion().setFromUnitVectors(cur,dir.clone().normalize());
   const wq=bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(dq),pq=bone.parent.getWorldQuaternion(new THREE.Quaternion());bone.quaternion.copy(pq.invert().multiply(wq));bone.updateMatrixWorld(true);};
  for(const sd of ['L','R']){const sx=sd==='L'?1:-1,ua=B('UpperArm'+sd),la=B('LowerArm'+sd),fi=B('Fist'+sd);if(!ua||!la||!fi)continue;
   aim(ua,la,new THREE.Vector3(sx*.15,-.75,.65));aim(la,fi,new THREE.Vector3(-sx*.25,-.05,1));qs['UpperArm'+sd]=ua.quaternion.clone();qs['LowerArm'+sd]=la.quaternion.clone();qs['Fist'+sd]=fi.quaternion.clone();}
  const hd=B('Head');if(hd){hd.rotateX(.2);qs.Head=hd.quaternion.clone();}
  const T=1.2,N=13,times=[...Array(N).keys()].map(i=>i*T/(N-1)),tracks=[];
  for(const tr of sit.tracks){const n=tr.name.slice(0,tr.name.lastIndexOf('.')),prop=tr.name.slice(tr.name.lastIndexOf('.')+1),sz=tr.getValueSize(),last=tr.values.slice(-sz);
   if(prop==='quaternion'&&qs[n]){const vals=[];for(let i=0;i<N;i++){const ph=times[i]/T*Math.PI*2,qq=qs[n].clone();
     // (teclear: el antebrazo sube y baja ±5°, la izquierda a destiempo de la derecha; la cabeza respira apenas)
     if(n.startsWith('LowerArm'))qq.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.sin(ph*3+(n.endsWith('L')?0:Math.PI))*.09));
     if(n==='Head')qq.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.sin(ph)*.03));vals.push(qq.x,qq.y,qq.z,qq.w);}
    tracks.push(new THREE.QuaternionKeyframeTrack(tr.name,times,vals));continue;}
   const vals=[];for(let i=0;i<N;i++)vals.push(...last);tracks.push(new (tr.constructor)(tr.name,times,vals));}
  tm.stopAllAction();tm.uncacheRoot(root);const typing=new THREE.AnimationClip('Typing',T,tracks);clips.push(typing);acts.trabajar=mixer.clipAction(typing);}}
 const idleTime=acts.idle.time;holder.userData.sentado=true;bakeSeatedCloth(root,mesh,clip('SitDown'),null,mixer);holder.userData.sentado=false;acts.idle.reset().play();acts.idle.time=idleTime;
 armContactProfile(mesh,kinds);
 applyGarmentContactCalibration(geo,L);
 const partSource=geo;const masked=maskCoveredSkin(geo,kinds,SK);geo=masked.geo;kinds=masked.kinds;let optimization=null;if(L.optimizarRopa!==false){const previous=geo,result=optimizeWardrobeGeometry(geo,kinds,{audit:!!L.auditarOptimizacion});geo=result.geo;kinds=result.kinds;optimization=result.stats;if(previous!==partSource&&previous!==geo)previous.dispose();}mesh.geometry=geo;mesh.updateMorphTargets();if(L.cinturaInterior&&(L.prendas?.top||L.prendas?.outer))installCollarHeadLimit(root,mixer,mesh);installArmContact(root,mixer,mesh,{enabled:L.contactoBrazos!==false});installSeatedCloth(root,mixer,mesh);installSkirtContact(mesh,mixer,partSource);
 return {holder,mixer,acts,state:'idle',tris:geo.attributes.position.count/3,clips,kinds,accessoryStats,optimization,look:L,mesh,parts:partSource.userData.wardrobeParts,partSource,hiddenTriangles:masked.removed,extractPart:id=>extractPart(partSource,id)};}
// (para medir: cuántos vértices de la piel mueve sobre todo cada hueso)
export async function skinBones(name){const g=await loadModel(name),ms=[];g.scene.traverse(o=>{if(o.isSkinnedMesh)ms.push(o);});const m=ms.find(o=>o.material.name==='Skin'),G=m.geometry,J=G.attributes.skinIndex,W=G.attributes.skinWeight,out={};
 for(let i=0;i<G.attributes.position.count;i++){let best=0,bj=-1;for(let k=0;k<4;k++){const w=W.getComponent(i,k);if(w>best){best=w;bj=J.getComponent(i,k);}}const n=m.skeleton.bones[bj]?.name;out[n]=(out[n]||0)+1;}
 return {out,type:J.array.constructor.name,same:m.skeleton===ms[0].skeleton,bones0:ms[0].skeleton.bones.map(b=>b.name).join(','),bonesSkin:m.skeleton.bones.map(b=>b.name).join(',')};}
