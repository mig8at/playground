/* Los animales (FUGA, 2026-10-12). Tres paquetes:
   - public/models/Animales: 12 animados de Quaternius (glTF con huesos y 12–13 animaciones: Walk, Gallop, Eating, Idle…).
   - public/models/AnimalesGranja: cerdo, oveja, llama, pug… (OBJ sin huesos: el paso se hace con un rebote).
   - public/models/AnimalesMar: peces, delfín, ballena, tiburón, manta (OBJ: nadan en círculos y ondulan).
   Dónde va cada uno: los del monte (venados, ciervos, lobos, zorros) en las faldas de los cerros; los de granja
   (vacas, toros, caballos, burros, alpacas, cerdos, ovejas, llamas) en los prados; los perros siguen a gente de la
   ciudad; los de mar, en el agua alrededor de la isla (los peces en cardumen cerca de la orilla, lo grande más afuera).
   Lejos de la cámara no se animan (y más lejos ni se dibujan). */
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {MTLLoader} from 'three/addons/loaders/MTLLoader.js';
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Tamaño real (m) por su medida más larga en el plano, o su alto (alto:true).
const ANIMADOS={Alpaca:{m:1.8,alto:true},Bull:{m:2.3},Cow:{m:2.2},Deer:{m:1.6},Donkey:{m:1.9},Fox:{m:.9},Horse:{m:2.3},Horse_White:{m:2.3},
 Husky:{m:1.0},ShibaInu:{m:.75},Stag:{m:1.9},Wolf:{m:1.3}};
const GRANJA={Pig:{m:1.2},Sheep:{m:1.1},Llama:{m:1.8,alto:true},Pug:{m:.5}};
const MAR={Fish1:{m:.35},Fish2:{m:.4},Fish3:{m:.45},Dolphin:{m:2.4},Whale:{m:7},Shark:{m:3.2},Manta:{m:3}};
const MAT=new THREE.MeshStandardMaterial({vertexColors:true,flatShading:true,roughness:.85});

// Mide el modelo en su pose de reposo: escala a su tamaño real y apoya los pies en y=0.
function fit(obj,{m,alto}){obj.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(obj,true),s=b.getSize(new THREE.Vector3());
 const k=m/(alto?s.y:Math.max(s.x,s.z));return {k,lift:-b.min.y*k,long:s.x>s.z?'x':'z'};}
// Un OBJ con su MTL, juntado en una malla con colores por vértice (un dibujo por animal).
async function loadObj(dir,name){const mtl=await new MTLLoader().setPath(dir).loadAsync(name+'.mtl');mtl.preload();const o=await new OBJLoader().setMaterials(mtl).setPath(dir).loadAsync(name+'.obj');
 const geos=[];o.traverse(m=>{if(!m.isMesh)return;const mats=Array.isArray(m.material)?m.material:[m.material],g0=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone();
  const n=g0.attributes.position.count,cl=new Float32Array(n*3),groups=g0.groups.length?g0.groups:[{start:0,count:n,materialIndex:0}];
  for(const gr of groups){const c=mats[gr.materialIndex]?.color||new THREE.Color('#999');for(let i=gr.start;i<gr.start+gr.count;i++){cl[i*3]=c.r;cl[i*3+1]=c.g;cl[i*3+2]=c.b;}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',g0.attributes.position);g.setAttribute('color',new THREE.BufferAttribute(cl,3));g.applyMatrix4(m.matrixWorld);geos.push(g);});
 const geo=mergeGeometries(geos);geo.computeVertexNormals();return geo;}

let CACHE=null;
export function loadAnimals(){return CACHE??=(async()=>{const gl=new GLTFLoader(),out={animados:{},granja:{},mar:{},marRig:{}};
 await Promise.all([
  ...Object.keys(ANIMADOS).map(n=>gl.loadAsync('/models/Animales/'+n+'.gltf').then(g=>{out.animados[n]={scene:g.scene,clips:g.animations,...fit(g.scene,ANIMADOS[n])};}).catch(e=>console.warn('animal',n,e))),
  // (con esqueleto, hechos en Blender —scripts/blender: rig.py presta el de Quaternius a los de granja; mar.py arma una
  // cadena de nado—, en public/models/AnimalesRig; si no están, los OBJ sin huesos)
  ...Object.keys(GRANJA).map(n=>gl.loadAsync('/models/AnimalesRig/'+n+'.glb').then(g=>{out.animados[n]={scene:g.scene,clips:g.animations,...fit(g.scene,GRANJA[n])};}).catch(()=>null)),
  ...Object.keys(MAR).map(n=>gl.loadAsync('/models/AnimalesRig/'+n+'.glb').then(g=>{out.marRig[n]={scene:g.scene,clips:g.animations,...fit(g.scene,MAR[n])};}).catch(()=>null)),
  ...Object.keys(GRANJA).map(n=>loadObj('/models/AnimalesGranja/',n).then(geo=>{const m=new THREE.Mesh(geo,MAT);out.granja[n]={geo,...fit(m,GRANJA[n])};}).catch(e=>console.warn('granja',n,e))),
  ...Object.keys(MAR).map(n=>loadObj('/models/AnimalesMar/',n).then(geo=>{const m=new THREE.Mesh(geo,MAT);out.mar[n]={geo,...fit(m,MAR[n])};}).catch(e=>console.warn('mar',n,e)))]);
 return out;})();}

const rng=s=>()=>(s=(s*16807)%2147483647)/2147483647;
const clipOf=(clips,n)=>clips.find(c=>c.name===n||c.name.endsWith('|'+n)||c.name.endsWith('_'+n));

// Un animal animado: copia con su propio esqueleto y mezclador (Walk, Gallop, Eating, Idle).
// (2026-10-18: con frustumCulled=false se dibujaban también los que quedan fuera de cuadro —74 llamadas desde una azotea,
// y otras tantas en las sombras—. La esfera de la malla con huesos es la de la pose de reposo: agrandada para que una
// pata estirada no se corte en el borde de la pantalla.)
const AGRANDA=1.6,agrandada=new WeakSet();
function animado(t,face=0){const root=cloneSkinned(t.scene);root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.frustumCulled=true;const g=o.geometry;if(!agrandada.has(g)){if(!g.boundingSphere)g.computeBoundingSphere();g.boundingSphere.radius*=AGRANDA;agrandada.add(g);}
  if(o.isSkinnedMesh){o.computeBoundingSphere?.();if(o.boundingSphere)o.boundingSphere.radius*=AGRANDA;}}});root.scale.setScalar(t.k);root.position.y=t.lift;
 const inner=new THREE.Group();inner.rotation.y=face;inner.add(root);const holder=new THREE.Group();holder.add(inner);const mixer=new THREE.AnimationMixer(root);
 const A={};for(const n of ['Walk','Gallop','Eating','Idle','Idle_2','Swim']){const c=clipOf(t.clips,n);if(c)A[n]=mixer.clipAction(c);}const play=n=>{const a=A[n]||A.Idle;if(holder.userData.cur===a)return;a.reset().play();holder.userData.cur?.crossFadeTo(a,.3,false);holder.userData.cur=a;};
 play(A.Idle?'Idle':'Swim');return {holder,inner,mixer,play};}
// Uno sin huesos (granja o mar): la malla escalada y apoyada; el movimiento lo pone update.
function estatico(t,face=0){const m=new THREE.Mesh(t.geo,MAT);m.castShadow=true;m.scale.setScalar(t.k);m.position.y=t.lift;const inner=new THREE.Group();inner.rotation.y=face;inner.add(m);const holder=new THREE.Group();holder.add(inner);return {holder,inner,mesh:m};}

/* world/island: los de la demo; crowd: la gente de la calle (los perros siguen a alguien). Devuelve group, update y
   count. FACE: cuánto girar cada modelo para que mire hacia +z (medido en la demo). */
export function createAnimals(world,island,crowd,A,{seed=1,monte=6,prado=5,perros=6,mar=9}={}){
 const group=new THREE.Group(),r=rng(seed*4441+3),list=[];if(!A||!island?.spot)return {group,update(){},count:0};
 const pick=a=>a[Math.floor(r()*a.length)],ok=n=>A.animados[n];
 const ground=(x,z)=>{const h=island.height(x,z);return isFinite(h)?h:0;};
 // Una manada: nAnimals alrededor de un punto, que pastan y caminan sin alejarse de su casa.
 function manada(kinds,n,home,radius){for(let i=0;i<n;i++){const kind=pick(kinds);let a;
   if(ok(kind))a={...animado(A.animados[kind]),kind,anim:true};else if(A.granja[kind])a={...estatico(A.granja[kind],A.granja[kind].long==='x'?Math.PI/2:0),kind,anim:false};else continue;
   a.x=home.x+(r()*2-1)*radius*.5;a.z=home.z+(r()*2-1)*radius*.5;a.yaw=r()*Math.PI*2;a.home=home;a.radius=radius;a.timer=r()*6;a.mode='idle';a.speed=kind==='Fox'||kind==='Wolf'?1.4:1.0;
   group.add(a.holder);list.push(a);}}
 for(let i=0;i<monte;i++){const p=island.spot('monte',r);if(!p)break;const k=r();manada(k<.45?['Deer','Deer','Stag']:k<.75?['Wolf']:['Fox'],k<.45?3+Math.floor(r()*3):k<.75?2:1,p,18);}
 for(let i=0;i<prado;i++){const p=island.spot('prado',r);if(!p)break;const k=r();manada(k<.3?['Cow','Cow','Bull']:k<.5?['Horse','Horse_White','Donkey']:k<.65?['Alpaca','Llama']:k<.85?['Sheep','Sheep','Sheep']:['Pig','Pig'],3+Math.floor(r()*3),p,14);}
 // Perros que siguen a gente de la calle (a un paso detrás).
 const gente=crowd?.people||[],dogs=['Husky','ShibaInu','Pug'];
 for(let i=0;i<Math.min(perros,gente.length);i++){const kind=pick(dogs),owner=gente[Math.floor(r()*gente.length)];if(owner.dog)continue;let a;
  if(ok(kind))a={...animado(A.animados[kind]),kind,anim:true};else if(A.granja[kind])a={...estatico(A.granja[kind],A.granja[kind].long==='x'?Math.PI/2:0),kind,anim:false};else continue;
  a.owner=owner;owner.dog=a;a.x=owner.x;a.z=owner.z;a.yaw=0;a.side=r()<.5?-1:1;group.add(a.holder);list.push(a);}
 // El mar: cardúmenes cerca de la orilla, delfines en pareja, y una ballena, un tiburón y una manta más afuera.
 const W=island.water??-.1;
 // (siempre una ballena, un tiburón y una manta; el resto, cardúmenes y delfines al azar)
 for(let i=0;i<mar;i++){const k=i<3?[.95,.75,.85][i]:r()*.7,kind=k<.5?pick(['Fish1','Fish2','Fish3']):k<.7?'Dolphin':k<.82?'Shark':k<.92?'Manta':'Whale',big=kind==='Whale',deep=big?2:kind==='Shark'||kind==='Manta'?1.8:kind==='Dolphin'?1.6:.8;
  // (el agua de la isla es baja —medido: ~2 m—: si no hay tanta hondura, un poco menos)
  const c=island.agua(r,deep)||island.agua(r,deep*.75)||island.agua(r,deep*.5);if(!c||!(A.mar[kind]||A.marRig[kind]))continue;const n=kind.startsWith('Fish')?6+Math.floor(r()*6):kind==='Dolphin'?2:1;
  for(let j=0;j<n;j++){const tr=A.marRig[kind],t=tr||A.mar[kind],a={...(tr?animado(tr):estatico(t,t.long==='x'?Math.PI/2:0)),kind,rig:!!tr,sea:true,c,R:(big?30:kind.startsWith('Fish')?3:12)*(.7+r()*.6),ph:r()*Math.PI*2,w:(kind.startsWith('Fish')?.6:big?.04:.15)*(r()<.5?-1:1),
   d:big?.7:kind.startsWith('Fish')?.4+r()*.4:kind==='Dolphin'?.6:Math.min(1.1,c.depth*.55),off:{x:(r()-.5)*1.2,y:(r()-.5)*.4},jump:kind==='Dolphin'};
   // (el círculo entero en el agua: si se sale a tierra, se achica)
   const wet=R=>{for(let q=0;q<16;q++){const an=q/16*Math.PI*2,h=island.height(c.x+Math.cos(an)*(R+2),c.z+Math.sin(an)*(R+2));if(!(h<W-.4))return false;}return true;};while(a.R>1.5&&!wet(a.R))a.R*=.8;
   if(a.mesh&&t.lift)a.mesh.position.y=0;if(a.rig){a.holder.children[0].children[0].position.y=0;a.mixer.timeScale=kind==='Whale'?.35:kind.startsWith('Fish')?1.6:.8;a.mixer.update(r()*2);}group.add(a.holder);list.push(a);}}
 const tmp=new THREE.Vector3(),SOMBRA=60;let clock=0;// (m: hasta dónde un animal da sombra)
 function update(dt,cam){clock+=dt;
  for(const a of list){const dx=a.x-(cam?.x??0),dz=a.z-(cam?.z??0),far=a.sea?Math.hypot(a.c.x-(cam?.x??0),a.c.z-(cam?.z??0)):Math.hypot(dx,dz);
   a.holder.visible=far<(a.kind==='Whale'?400:220);if(!a.holder.visible)continue;const near=far<90;
   // (la sombra, sólo de cerca: de lejos no se nota y cada animal es una llamada más en el mapa de sombras)
   const sombra=far<SOMBRA;if(a.sombra!==sombra){a.sombra=sombra;a.holder.traverse(o=>{if(o.isMesh)o.castShadow=sombra;});}
   if(a.sea){// nadar en círculo (los peces en cardumen: cada uno corrido un poco), ondulando
    a.ph+=a.w*dt*(a.kind.startsWith('Fish')?1.6:1)*(a.kind==='Dolphin'?2.2:1);const x=a.c.x+Math.cos(a.ph)*a.R+a.off.x,z=a.c.z+Math.sin(a.ph)*a.R+a.off.x*.5;
    let y=W-a.d+a.off.y+Math.sin(clock*1.3+a.ph*3)*.08;
    // el delfín: cada tanto sale del agua en un arco
    if(a.jump){const j=(clock*.35+a.ph)%(Math.PI*2);if(j<Math.PI*.5){const s=Math.sin(j*2);y=W-a.d+s*(a.d+.9);a.inner.rotation.x=-Math.cos(j*2)*.7;}else a.inner.rotation.x=0;}
    a.x=x;a.z=z;a.holder.position.set(x,y,z);a.holder.rotation.y=Math.atan2(-Math.sin(a.ph)*Math.sign(a.w),Math.cos(a.ph)*Math.sign(a.w));
    // (con esqueleto, la ondulación es la de su animación Swim; sin él, un vaivén)
    if(a.rig){if(near||a.kind==='Whale')a.mixer.update(dt);}else a.inner.rotation.z=Math.sin(clock*(a.kind.startsWith('Fish')?9:3)+a.ph)*(a.kind==='Manta'?.15:.06);continue;}
   if(a.owner){// el perro: sigue el rastro de su dueño, ~1,1 m atrás (pisa por donde él pasó: no se mete en paredes)
    const o=a.owner,tr=a.trail||(a.trail=[{x:o.x,z:o.z}]),lt=tr[tr.length-1];if(Math.hypot(o.x-lt.x,o.z-lt.z)>.12){tr.push({x:o.x,z:o.z});if(tr.length>40)tr.shift();}
    let acc=0,tg=tr[0];for(let i=tr.length-1;i>0;i--){acc+=Math.hypot(tr[i].x-tr[i-1].x,tr[i].z-tr[i-1].z);if(acc>=1.1){tg=tr[i-1];break;}}
    const ddx=tg.x-a.x,ddz=tg.z-a.z,d=Math.hypot(ddx,ddz);if(d>8){a.x=tg.x;a.z=tg.z;}const sp=d>1.2?3.2:d>.12?Math.max(1,(o.speed||1.3)):0;
    if(sp&&d>.001){const st=Math.min(d,sp*dt);a.x+=ddx/d*st;a.z+=ddz/d*st;let dy=Math.atan2(ddx,ddz)-a.yaw;dy=Math.atan2(Math.sin(dy),Math.cos(dy));a.yaw+=dy*Math.min(1,dt*8);}
    a.holder.position.set(a.x,o.body?.position.y??ground(a.x,a.z),a.z);a.holder.rotation.y=a.yaw;a.holder.visible=a.holder.visible&&(o.body?.visible!==false);
    if(a.anim){a.play(sp>2?'Gallop':sp?'Walk':'Idle');if(near)a.mixer.update(dt);}else a.inner.position.y=sp?Math.abs(Math.sin(clock*12))*.05:0;continue;}
   // manadas: pastar, mirar, caminar a otro punto cerca de casa
   if((a.timer-=dt)<=0){const k=r();if(k<.45){a.mode='walk';const ang=r()*Math.PI*2,rad=r()*a.radius;a.tx=a.home.x+Math.cos(ang)*rad;a.tz=a.home.z+Math.sin(ang)*rad;a.timer=12;}
    else{a.mode=k<.8?'eat':'idle';a.timer=3+r()*7;}}
   let moving=false;if(a.mode==='walk'){const ddx=a.tx-a.x,ddz=a.tz-a.z,d=Math.hypot(ddx,ddz);if(d<.3){a.mode='idle';a.timer=2+r()*4;}else{const st=Math.min(d,a.speed*dt);a.x+=ddx/d*st;a.z+=ddz/d*st;
     let dy=Math.atan2(ddx,ddz)-a.yaw;dy=Math.atan2(Math.sin(dy),Math.cos(dy));a.yaw+=dy*Math.min(1,dt*3);moving=true;}}
   a.holder.position.set(a.x,ground(a.x,a.z),a.z);a.holder.rotation.y=a.yaw;
   if(a.anim){a.play(moving?'Walk':a.mode==='eat'?'Eating':'Idle');if(near)a.mixer.update(dt);}
   else{a.inner.position.y=moving?Math.abs(Math.sin(clock*8+a.x))*.06:0;a.inner.rotation.x=a.mode==='eat'?.18:0;}}}
 return {group,update,list,get count(){return list.length;},dispose(){for(const a of list)a.mixer?.stopAllAction();}};}
