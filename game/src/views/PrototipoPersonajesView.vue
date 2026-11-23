<script setup>
/* EL PROTOTIPO DE PERSONAJES (2026-11-22, Miguel: «quiero pasar a personajes más de forma humana con más animaciones» →
   «sí, prototipo» → «afinar» → «por zonas» → «pásalo» a los cuerpos con cara). Fuera del juego, para decidir con números.
   - Los cuerpos: el hombre y la mujer de los Universal Base Characters de Quaternius (CC0), con cara, ojos y cejas, y sus
     peinados amarrados a la cabeza. Mismo esqueleto —65 huesos, los mismos nombres— que las animaciones.
   - Las animaciones: las de las dos Universal Animation Library (UAL1 y UAL2, CC0). Traen la posición de cada hueso y los
     cuerpos no miden igual que el maniquí de las bibliotecas: se usan sólo las rotaciones, y la posición de la cadera,
     escalada a la altura de cada cuerpo.
   - El cuerpo ligero: cuerpo, ojos, cejas y peinado en UNA malla —una llamada de dibujo por persona— y sin dedos —sus pesos
     pasan a la mano: 65 huesos a 25—.
   - La ropa por zonas: cada vértice, la zona de su hueso (piel, camisa, mangas, pantalón, pantorrilla, zapatos) o de su
     pieza (ojos, cejas, pelo); el color, la paleta de cada persona en su material. Cero triángulos de más.
   - Los niveles de detalle de los árboles (nature3d NIVELES_PLANTA), simplificados con meshoptimizer.
   Los modelos no van en git todavía (public/models/prototipo, ignorado): se copian de assets-fuente/personaje. */
import {onMounted,onBeforeUnmount,ref} from 'vue';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js';
import {MeshoptSimplifier} from 'three/addons/libs/meshopt_simplifier.module.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {NIVELES_PLANTA,VUELVE_PLANTA} from '../lib/nature3d.js';

const DIR='/models/prototipo/',BIBLIOTECAS=['UAL1_Standard.glb','UAL2_Standard.glb'];
// (2026-11-22, Miguel: «mejor usa el esqueleto de las animaciones, no los cuerpos humanos: sólo el pelo sobre los maniquíes»: los
// cuerpos son los maniquíes de las bibliotecas —el de UAL1 y el de mujer de UAL2—, con los peinados del paquete de personajes
// base encima. Sin cara: la cabeza, piel)
const CUERPOS={hombre:'UAL1_Standard.glb',mujer:'Mannequin_F.glb'},BASE_DE={hombre:'Superhero_Male_FullBody.gltf',mujer:'Superhero_Female_FullBody.gltf'};// (BASE_DE: la cabeza para la que se hicieron los peinados de cada uno)
// (los peinados de cada uno: el pelo y, si va, la barba; vacío: sin pelo)
const PEINADOS={hombre:[['Hair_Buzzed'],['Hair_SimpleParted'],['Hair_SimpleParted','Hair_Beard'],['Hair_Buzzed','Hair_Beard'],[]],mujer:[['Hair_Long'],['Hair_Buns'],['Hair_BuzzedFemale'],['Hair_Long']]};
// (qué hace cada persona: la animación y si se mueve, a qué velocidad en m/s)
const PAPELES=[{clip:'Walk_Loop',v:1.3,peso:5},{clip:'Jog_Fwd_Loop',v:3,peso:2},{clip:'Idle_Loop',v:0,peso:2},{clip:'Idle_Talking_Loop',v:0,peso:2},{clip:'Idle_TalkingPhone_Loop',v:0,peso:1.5},{clip:'Idle_FoldArms_Loop',v:0,peso:1},{clip:'Walk_Carry_Loop',v:1.1,peso:1},{clip:'Sitting_Idle_Loop',v:0,peso:1},{clip:'Walk_Formal_Loop',v:1.1,peso:1},{clip:'Sprint_Loop',v:5.5,peso:.5}];

const lienzo=ref(null),datos=ref({}),n=ref(100),conNiveles=ref(true),ahorro=ref(true),lejos=ref(30),cargando=ref('Cargando los modelos…');
// (el ahorro de animación: según el nivel, el mezclador se actualiza cada CADA[nivel] cuadros, con el tiempo acumulado)
const CADA=[1,2,3,4],DEDO=/(index|middle|pinky|ring|thumb)_0/;
// (los niveles de cada variante, por el nombre de su malla: userData se clona como JSON y las geometrías no sobreviven)
const NIV={};let nVar=0;
let foco=null,renderer,scene,camera,reloj,raf=0,variantes={hombre:[],mujer:[]},clipsDe={},gente=[],tiempos=[],cuadros=0;

// ---- La ropa por zonas ----
const Z={piel:0,camisa:1,antebrazo:2,pantalon:3,pantorrilla:4,zapatos:5,pelo:6,ojo:7,ceja:8,blanco:9,iris:10};// (ojo: la pupila)
const zonaDe=b=>/Head|neck|hand|index|middle|pinky|ring|thumb/i.test(b)?Z.piel:/lowerarm/.test(b)?Z.antebrazo:/upperarm|clavicle|spine/.test(b)?Z.camisa:/pelvis|thigh/.test(b)?Z.pantalon:/calf/.test(b)?Z.pantorrilla:/foot|ball/.test(b)?Z.zapatos:Z.camisa;
const PIEL=['#f1c9a5','#d9a47c','#b97f57','#8d5a3b','#5e3b26'],CAMISA=['#e8e4dc','#2f3a4f','#a63d32','#4f7a5a','#d9b44a','#6d5a8c','#1f1f22','#7fa3c4'],PANTALON=['#2b3550','#3a3a3d','#7a6a54','#556b4a','#1d1d20','#9a8f7c'],ZAPATOS=['#1c1c1c','#f2f2f2','#6b4a32','#3b3f6b'],PELO=['#1b1410','#3e2a1c','#6b4a2b','#b08a55','#8a8a8a'],IRIS=['#4a3220','#6b4a2b','#3d6b4f','#3f6a8f','#2a1d14','#5b5f2e'],FALDA=['#2b3550','#7a2e3a','#3a3a3d','#c9a35a','#4f6b8a','#e3dcd0'];
// (el material de una persona: su paleta en un uniform; el vértice toma el color de su zona. Manga corta: el antebrazo, piel;
// pantaloneta o falda: la pantorrilla, piel)
// (la cara: el atributo detalle —la luz de la cara que pintó el artista, pasada a cada vértice: labios, sombras, párpados—
// multiplica el color de su zona; 1 en el resto del cuerpo)
function materialRopa(piel,{camisa='#ddd',pantalon='#333',zapatos='#111',pelo='#222',iris='#4a3220',mangaCorta=false,pantaloneta=false}={}){
 const pal=[piel,camisa,mangaCorta?piel:camisa,pantalon,pantaloneta?piel:pantalon,zapatos,pelo,'#120d0a',pelo,'#f1eee6',iris].map(c=>new THREE.Color(c));
 const m=new THREE.MeshStandardMaterial({roughness:.82});
 m.onBeforeCompile=sh=>{sh.uniforms.paleta={value:pal};
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute float zona;attribute float detalle;uniform vec3 paleta[11];varying vec3 vRopa;').replace('#include <begin_vertex>','#include <begin_vertex>\nvRopa=paleta[int(zona+.5)]*detalle;');
  sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vRopa;').replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb*=vRopa;');};
 m.customProgramCacheKey=()=>'ropa-zonas';return m;}
// (la de una persona; la mujer: falda —el pantalón con la pantorrilla de piel— o pantalón, a veces vestido)
function vestimenta(r,mujer){const de=l=>l[Math.floor(r()*l.length)];
 if(!mujer)return {piel:de(PIEL),ropa:{camisa:de(CAMISA),pantalon:de(PANTALON),zapatos:de(ZAPATOS),pelo:de(PELO),iris:de(IRIS),mangaCorta:r()<.45,pantaloneta:r()<.25}};
 const falda=r()<.55,c=falda?de(FALDA):de(PANTALON),vestido=falda&&r()<.35;
 return {piel:de(PIEL),ropa:{camisa:vestido?c:de(CAMISA),pantalon:c,zapatos:de(ZAPATOS),pelo:de(PELO),iris:de(IRIS),mangaCorta:r()<.55,pantaloneta:falda}};}

// ---- Los niveles de detalle (como nature3d: soldar por posición, compactar y simplificar) ----
function simplificar(geo,ratio){const idx=geo.index.array;if(ratio>=1)return idx;const pa=geo.attributes.position,n=pa.count,pos=new Float32Array(n*3);for(let i=0;i<n;i++){pos[i*3]=pa.getX(i);pos[i*3+1]=pa.getY(i);pos[i*3+2]=pa.getZ(i);}
 const remap=MeshoptSimplifier.generatePositionRemap(pos,3),uso=[...new Set(Array.from(idx,i=>remap[i]))],nuevo=new Map(uso.map((v,k)=>[v,k])),p2=new Float32Array(uso.length*3);
 uso.forEach((v,k)=>p2.set(pos.subarray(v*3,v*3+3),k*3));const i2=Uint32Array.from(idx,i=>nuevo.get(remap[i]));
 const [out]=MeshoptSimplifier.simplify(i2,p2,3,Math.max(12,Math.floor(idx.length*ratio/3)*3),.1,[]);return Uint32Array.from(out,k=>uso[k]);}
const niveles=geo=>NIVELES_PLANTA.map(N=>{const s=new THREE.BufferGeometry();for(const [k,v] of Object.entries(geo.attributes))s.setAttribute(k,v);s.setIndex(new THREE.BufferAttribute(simplificar(geo,N.ratio),1));s.boundingSphere=geo.boundingSphere;return s;});

// ---- Cargar (sin texturas: la ropa es por zonas; cada imagen pedida, un pixel) ----
const PIXEL='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const gestor=new THREE.LoadingManager();gestor.setURLModifier(u=>/\.png$/i.test(u)?PIXEL:u);
const cargar=f=>new GLTFLoader(gestor).loadAsync(DIR+f);
// (las texturas de la cara y del ojo, como datos: se leen una vez, al armar, y no se dibujan)
async function imagen(f){const bmp=await createImageBitmap(await (await fetch(DIR+f)).blob()),c=new OffscreenCanvas(bmp.width,bmp.height),x=c.getContext('2d');x.drawImage(bmp,0,0);return {w:bmp.width,h:bmp.height,d:x.getImageData(0,0,bmp.width,bmp.height).data};}
const luz=(t,u,v)=>{const x=Math.min(t.w-1,Math.max(0,Math.floor((u-Math.floor(u))*t.w))),y=Math.min(t.h-1,Math.max(0,Math.floor((v-Math.floor(v))*t.h))),k=(y*t.w+x)*4;return (.299*t.d[k]+.587*t.d[k+1]+.114*t.d[k+2])/255;};
const CARAS={hombre:'caras/cara_hombre.png',mujer:'caras/cara_mujer.png'},OJO='caras/ojo.png';

// ---- La cabeza, en el espacio de su hueso: su caja (para que un peinado hecho para otra cabeza calce en ésta) ----
function cajaCabeza(escena){const ms=[];escena.updateMatrixWorld(true);escena.traverse(o=>{if(o.isSkinnedMesh)ms.push(o);});const caja=new THREE.Box3(),v=new THREE.Vector3();
 for(const m of ms){const sk=m.skeleton,h=sk.bones.findIndex(b=>b.name==='Head'),pa=m.geometry.attributes.position,si=m.geometry.attributes.skinIndex,sw=m.geometry.attributes.skinWeight;if(h<0)continue;
  for(let i=0;i<pa.count;i++){let mk=0,mw=-1;for(let k=0;k<4;k++){const w=sw.getComponent(i,k);if(w>mw){mw=w;mk=si.getComponent(i,k);}}if(mk!==h||/eye|brow|face/i.test(m.name))continue;
   caja.expandByPoint(v.fromBufferAttribute(pa,i).applyMatrix4(m.bindMatrix).applyMatrix4(sk.boneInverses[h]));}}
 return {c:caja.getCenter(new THREE.Vector3()),t:caja.getSize(new THREE.Vector3())};}

// ---- Un cuerpo con su peinado, en UNA malla y sin dedos ----
// (las piezas del cuerpo —el cuerpo, los ojos, las cejas— y las del peinado, que vienen con su propio esqueleto amarrado a la
// cabeza de otro cuerpo: cada vértice se lleva del espacio de su hueso en ese esqueleto al del mismo hueso en éste, así el
// pelo queda en la cabeza de cada uno; sus huesos se cambian por los de éste, por nombre)
function armarCuerpo(gCuerpo,gPelos,texCara=null,texOjo=null,ajuste=null){const raiz=cloneSkinned(gCuerpo.scene),ms=[];raiz.traverse(o=>{if(o.isSkinnedMesh)ms.push(o);});
 const cuerpo=ms.reduce((a,b)=>a.geometry.attributes.position.count>b.geometry.attributes.position.count?a:b),sk=cuerpo.skeleton,huesos=sk.bones,porNombre=new Map(huesos.map((b,i)=>[b.name,i]));
 const quedan=huesos.map((b,i)=>DEDO.test(b.name)?-1:i).filter(i=>i>=0),nuevo=new Map(quedan.map((v,k)=>[v,k]));
 const destino=i=>{let b=huesos[i];while(b&&DEDO.test(b.name))b=b.parent;return nuevo.get(huesos.indexOf(b))??0;};
 const inv=new THREE.Matrix4(),M=new THREE.Matrix4(),v=new THREE.Vector3(),nm=new THREE.Matrix3(),nn=new THREE.Vector3();
 const pieza=(m,zonaFija)=>{const geo=m.geometry.clone(),si=geo.attributes.skinIndex,sw=geo.attributes.skinWeight,pa=geo.attributes.position,no=geo.attributes.normal,uv=geo.attributes.uv,n=pa.count,zona=new Float32Array(n),detalle=new Float32Array(n).fill(1),cabeza=[],propio=m.skeleton.bones.every((b,i)=>huesos[i]===b);
  for(let i=0;i<n;i++){let mk=0,mw=-1;for(let k=0;k<4;k++){const w=sw.getComponent(i,k);if(w>mw){mw=w;mk=si.getComponent(i,k);}}
   const nombre=m.skeleton.bones[mk].name,bi=porNombre.get(nombre)??0;
   if(!propio){// (del hueso de su esqueleto al mismo hueso de éste; en la cabeza, de la caja de la cabeza para la que se hizo a la de éste)
    v.fromBufferAttribute(pa,i).applyMatrix4(m.bindMatrix).applyMatrix4(m.skeleton.boneInverses[mk]);if(ajuste&&nombre==='Head')v.sub(ajuste.de.c).multiply(ajuste.escala).add(ajuste.a.c);
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
  if(!geo.index)geo.setIndex([...Array(n).keys()]);return geo;};
 // (los ojos y las cejas del cuerpo, por su nombre o el de su material)
 // (las partes del maniquí van por su hueso; si un cuerpo trae ojos o cejas, a su zona)
 const zonaPieza=m=>{const t=m.name+' '+(m.material?.name||'')+' '+(m.parent?.name||'');return /brow/i.test(t)?Z.ceja:/eye/i.test(t)?Z.ojo:undefined;};
 const partes=ms.map(m=>pieza(m,zonaPieza(m)));
 for(const g of gPelos){g.scene.updateMatrixWorld(true);g.scene.traverse(o=>{if(o.isSkinnedMesh)partes.push(pieza(o,Z.pelo));});}
 const geo=mergeGeometries(partes,false),malla=new THREE.SkinnedMesh(geo,materialRopa(PIEL[0]));
 for(const b of huesos)if(DEDO.test(b.name)&&!DEDO.test(b.parent?.name||''))b.parent.remove(b);
 cuerpo.parent.add(malla);malla.position.copy(cuerpo.position);malla.quaternion.copy(cuerpo.quaternion);malla.scale.copy(cuerpo.scale);
 malla.bind(new THREE.Skeleton(quedan.map(i=>huesos[i]),quedan.map(i=>sk.boneInverses[i])),cuerpo.bindMatrix);for(const m of ms)m.removeFromParent();
 malla.name='cuerpo'+(nVar++);NIV[malla.name]=niveles(geo);return raiz;}

// ---- Las animaciones para un cuerpo: sólo rotaciones (sin dedos) y la cadera escalada a su altura ----
const alturaCadera=escena=>{let y=1;escena.updateMatrixWorld(true);escena.traverse(o=>{if(o.isBone&&o.name==='pelvis')y=new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).y;});return y;};
function clipsPara(clips,k){return clips.map(c=>new THREE.AnimationClip(c.name,c.duration,c.tracks.filter(t=>!DEDO.test(t.name)&&(t.name.endsWith('.quaternion')||t.name==='pelvis.position')).map(t=>{if(t.name!=='pelvis.position')return t;const u=t.clone();for(let i=0;i<u.values.length;i++)u.values[i]*=k;return u;})));}

function armar(){for(const p of gente)scene.remove(p.root);gente=[];const r=mulberry(7),pesoTotal=PAPELES.reduce((t,p)=>t+p.peso,0);
 for(let i=0;i<n.value;i++){let tiro=r()*pesoTotal;const papel=PAPELES.find(p=>(tiro-=p.peso)<0)||PAPELES[0],quien=i%2?'mujer':'hombre',vs=variantes[quien];
  const root=cloneSkinned(vs[Math.floor(r()*vs.length)]),vest=vestimenta(r,quien==='mujer'),mallas=[];
  root.traverse(o=>{if(o.isSkinnedMesh){o.material=materialRopa(vest.piel,vest.ropa);o.frustumCulled=false;mallas.push({o,niveles:NIV[o.name]});}});
  const ang=r()*Math.PI*2,rad=4+r()*60;root.position.set(Math.cos(ang)*rad,0,Math.sin(ang)*rad);root.rotation.y=r()*Math.PI*2;
  const clip=clipsDe[quien].find(c=>c.name===papel.clip)||clipsDe[quien].find(c=>c.name==='Idle_Loop'),mixer=new THREE.AnimationMixer(root),act=mixer.clipAction(clip);act.play();act.time=r()*clip.duration;
  scene.add(root);gente.push({root,mixer,papel,mallas,nivel:0,giro:(r()-.5)*.6,acum:0,turno:i,quien});}}

function mulberry(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

function cuadro(){raf=requestAnimationFrame(cuadro);const dt=Math.min(reloj.getDelta(),.05),t0=performance.now();
 // (con foco: la cámara mira de cerca a una persona —de frente o de espaldas—; si no, en órbita lenta a `lejos` m del centro)
 if(foco&&gente[foco.i]){const t=gente[foco.i].root.position,ry=gente[foco.i].root.rotation.y+(foco.atras?Math.PI:0);camera.position.set(t.x+Math.sin(ry)*2.4,1.55,t.z+Math.cos(ry)*2.4);camera.lookAt(t.x,1.25,t.z);}
 else{const a=performance.now()/9000;camera.position.set(Math.cos(a)*lejos.value,Math.max(2,lejos.value*.35),Math.sin(a)*lejos.value);camera.lookAt(0,1,0);}
 cuadros++;for(const p of gente){p.acum+=dt;const c=ahorro.value?CADA[p.nivel]:1;if((cuadros+p.turno)%c===0){p.mixer.update(p.acum);p.acum=0;}
  if(p.papel.v){p.root.rotation.y+=p.giro*dt;const d=p.papel.v*dt;p.root.position.x+=Math.sin(p.root.rotation.y)*d;p.root.position.z+=Math.cos(p.root.rotation.y)*d;if(p.root.position.length()>70)p.root.rotation.y+=Math.PI;}
  let k=conNiveles.value?p.nivel:0;if(conNiveles.value){const d=p.root.position.distanceTo(camera.position);while(k+1<NIVELES_PLANTA.length&&d>NIVELES_PLANTA[k+1].desde)k++;while(k>0&&d<NIVELES_PLANTA[k].desde*VUELVE_PLANTA)k--;}
  if(k!==p.nivel){p.nivel=k;for(const m of p.mallas)m.o.geometry=m.niveles[k];}}
 renderer.render(scene,camera);tiempos.push(performance.now()-t0);if(tiempos.length>120)tiempos.shift();
 if(tiempos.length%20===0){const s=[...tiempos].sort((x,y)=>x-y),cuenta=[0,0,0,0];for(const p of gente)cuenta[p.nivel]++;
  datos.value={...datos.value,personas:gente.length,triangulos:renderer.info.render.triangles,llamadas:renderer.info.render.calls,cuadro:+(s.reduce((t,x)=>t+x,0)/s.length).toFixed(1),peor:+s.at(-1).toFixed(1),porNivel:cuenta};}}

onMounted(async()=>{await MeshoptSimplifier.ready;
 renderer=new THREE.WebGLRenderer({canvas:lienzo.value,antialias:true});renderer.setPixelRatio(Math.min(2,devicePixelRatio));
 scene=new THREE.Scene();scene.background=new THREE.Color('#dfe6ea');camera=new THREE.PerspectiveCamera(55,1,.1,500);reloj=new THREE.Clock();
 scene.add(new THREE.HemisphereLight('#ffffff','#8a8f7a',1.4));const sol=new THREE.DirectionalLight('#ffffff',1.6);sol.position.set(20,40,10);scene.add(sol);
 const piso=new THREE.Mesh(new THREE.CircleGeometry(80,48),new THREE.MeshLambertMaterial({color:'#c9c4b6'}));piso.rotation.x=-Math.PI/2;scene.add(piso);
 const tam=()=>{const w=lienzo.value.clientWidth,h=lienzo.value.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();};tam();addEventListener('resize',tam);
 const pelos=[...new Set(Object.values(PEINADOS).flat(2))];
 const [bibs,cuerpos0,gPelos]=await Promise.all([Promise.all(BIBLIOTECAS.map(cargar)),Promise.all(Object.values(CUERPOS).map(f=>BIBLIOTECAS.includes(f)?null:cargar(f))),Promise.all(pelos.map(p=>cargar(p+'.gltf')))]),texCaras=[null,null],texOjo=null;
 // (el maniquí de hombre es la escena de UAL1: no se carga dos veces)
 const cuerpos=cuerpos0.map((g,i)=>g||bibs[BIBLIOTECAS.indexOf(Object.values(CUERPOS)[i])]);
 // (los peinados se hicieron para las cabezas de los personajes base: se miden esas y las de los maniquíes, y el pelo pasa de una
 // caja a la otra —escalado por eje y centrado—)
 const cabezasBase=await Promise.all(Object.keys(CUERPOS).map(q=>cargar(BASE_DE[q]).then(g=>cajaCabeza(g.scene))));
 const ajustes=Object.keys(CUERPOS).map((q,i)=>{const a=cajaCabeza(cuerpos[i].scene),de=cabezasBase[i];return {de,a,escala:new THREE.Vector3(a.t.x/de.t.x,a.t.y/de.t.y,a.t.z/de.t.z)};});// (los maniquíes no tienen cara: sin texturas de cara)
 const peloDe=Object.fromEntries(pelos.map((p,i)=>[p,gPelos[i]]));
 // (las animaciones de las dos bibliotecas, sin repetir nombres)
 const vistos=new Set(),clips=bibs.flatMap(b=>b.animations).filter(c=>!vistos.has(c.name)&&vistos.add(c.name)),yUAL=alturaCadera(bibs[0].scene);
 Object.keys(CUERPOS).forEach((q,i)=>{clipsDe[q]=clipsPara(clips,alturaCadera(cuerpos[i].scene)/yUAL);variantes[q]=PEINADOS[q].map(ps=>armarCuerpo(cuerpos[i],ps.map(p=>peloDe[p]),texCaras[i],texOjo,ajustes[i]));});
 const tris=g=>g.index.count/3;datos.value={animaciones:clips.length,triangulosPorNivel:Object.fromEntries(Object.entries(variantes).map(([q,vs])=>[q,vs.map(b=>{let t;b.traverse(o=>{if(o.isSkinnedMesh)t=NIV[o.name].map(tris);});return t;})]))};
 cargando.value='';armar();cuadro();
 window.__proto={foco:(i,atras=false)=>{foco=i==null?null:{i,atras};},armar:k=>{n.value=k;armar();},ahorro:on=>{ahorro.value=on;},niveles:on=>{conNiveles.value=on;},lejos:d=>{foco=null;lejos.value=d;},datos:()=>datos.value,clips:()=>clips.map(c=>c.name)};});
onBeforeUnmount(()=>{cancelAnimationFrame(raf);renderer?.dispose();});
</script>

<template>
 <div class="proto">
  <canvas ref="lienzo"></canvas>
  <aside>
   <h1>Prototipo de personajes</h1>
   <p v-if="cargando">{{cargando}}</p>
   <label>Personas <select v-model.number="n" @change="armar"><option v-for="k in [25,50,100,200,400]" :key="k" :value="k">{{k}}</option></select></label>
   <label><input type="checkbox" v-model="conNiveles"> Niveles de detalle</label>
   <label><input type="checkbox" v-model="ahorro"> Ahorro de animación</label>
   <label>Cámara a {{lejos}} m <input type="range" min="5" max="150" v-model.number="lejos"></label>
   <dl>
    <dt>Animaciones</dt><dd>{{datos.animaciones}}</dd>
    <dt>Triángulos</dt><dd>{{datos.triangulos?.toLocaleString('es')}}</dd>
    <dt>Llamadas</dt><dd>{{datos.llamadas}}</dd>
    <dt>Cuadro</dt><dd>{{datos.cuadro}} ms (peor {{datos.peor}})</dd>
    <dt>Por nivel</dt><dd>{{datos.porNivel?.join(' · ')}}</dd>
   </dl>
  </aside>
 </div>
</template>

<style scoped>
.proto{position:fixed;inset:0;background:#dfe6ea}
canvas{width:100%;height:100%;display:block}
aside{position:absolute;top:12px;left:12px;background:rgba(32,34,38,.85);color:#eee;padding:12px 14px;border-radius:10px;font:13px/1.5 system-ui;min-width:220px}
h1{font-size:15px;margin:0 0 8px}
label{display:block;margin:4px 0}
dl{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:8px 0 0}
dt{opacity:.7}dd{margin:0}
</style>
