<script setup>
/* EL PROTOTIPO DE PERSONAJES (2026-11-22, Miguel: «quiero pasar a personajes más de forma humana con más animaciones» → «sí,
   prototipo»). Fuera del juego, para decidir con números: el maniquí de la Universal Animation Library de Quaternius (CC0,
   65 huesos, 43 animaciones) en una plaza, N personas caminando, trotando, quietas, hablando o sentadas, cada una con su
   mezclador; y sus niveles de detalle, los mismos de los árboles (nature3d NIVELES_PLANTA): el modelo entero de cerca y
   simplificado con meshoptimizer al alejarse. La malla con piel cambia de geometría —los mismos vértices y pesos, menos
   triángulos—, así que la animación sigue igual. Mide triángulos, llamadas y el tiempo de cuadro.
   El modelo no va en git todavía (public/models/prototipo, ignorado): se copia de assets-fuente/personaje. */
import {onMounted,onBeforeUnmount,ref} from 'vue';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js';
import {MeshoptSimplifier} from 'three/addons/libs/meshopt_simplifier.module.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {NIVELES_PLANTA,VUELVE_PLANTA} from '../lib/nature3d.js';

const MODELO='/models/prototipo/UAL1_Standard.glb';
// (qué hace cada persona: la animación del paquete y si se mueve, a qué velocidad en m/s)
const PAPELES=[{clip:'Walk_Loop',v:1.3,peso:5},{clip:'Jog_Fwd_Loop',v:3,peso:2},{clip:'Idle_Loop',v:0,peso:2},{clip:'Idle_Talking_Loop',v:0,peso:2},{clip:'Sitting_Idle_Loop',v:0,peso:1},{clip:'Walk_Formal_Loop',v:1.1,peso:1},{clip:'Sprint_Loop',v:5.5,peso:.5}];
const ROPA=['#c9b8a6','#7f8fa6','#a65e4f','#5f7f5a','#d8c27a','#6b5b7a','#3f4a5c','#e0d6c8'];

const lienzo=ref(null),datos=ref({}),n=ref(100),conNiveles=ref(true),ahorro=ref(true),ligero=ref(true),lejos=ref(30),cargando=ref('Cargando el modelo…');
// (EL AHORRO DE ANIMACIÓN: sin las pistas de los dedos —40 de los 65 huesos, que de lejos no se ven— y, según el nivel, el
// mezclador se actualiza cada CADA[nivel] cuadros —con el tiempo acumulado—)
const CADA=[1,2,3,4],DEDO=/(index|middle|pinky|ring|thumb)_0/;let clipsSinDedos=[];
let renderer,scene,camera,reloj,raf=0,base=null,baseEntera=null,baseLigera=null,clips=[],geos=[],gente=[],tiempos=[],cuadros=0;

// los índices de una geometría, simplificados a ratio de sus triángulos (como nature3d: soldar por posición y compactar)
function simplificar(geo,ratio){const idx=geo.index.array;if(ratio>=1)return idx;const pa=geo.attributes.position,n=pa.count,pos=new Float32Array(n*3);for(let i=0;i<n;i++){pos[i*3]=pa.getX(i);pos[i*3+1]=pa.getY(i);pos[i*3+2]=pa.getZ(i);}
 const remap=MeshoptSimplifier.generatePositionRemap(pos,3),uso=[...new Set(Array.from(idx,i=>remap[i]))],nuevo=new Map(uso.map((v,k)=>[v,k])),p2=new Float32Array(uso.length*3);
 uso.forEach((v,k)=>p2.set(pos.subarray(v*3,v*3+3),k*3));const i2=Uint32Array.from(idx,i=>nuevo.get(remap[i]));
 const [out]=MeshoptSimplifier.simplify(i2,p2,3,Math.max(12,Math.floor(idx.length*ratio/3)*3),.1,[]);return Uint32Array.from(out,k=>uso[k]);}

// EL CUERPO LIGERO (afinado): las dos partes del maniquí en UNA malla —su color en cada vértice, así una persona es una sola
// llamada de dibujo— y el esqueleto sin los dedos —sus pesos pasan a la mano: 65 huesos a 25—. De lejos no se nota y cada
// cuadro mueve menos de la mitad de los huesos.
function aligerar(g){const raiz=cloneSkinned(g),ms=[];raiz.traverse(o=>{if(o.isSkinnedMesh)ms.push(o);});const sk=ms[0].skeleton,huesos=sk.bones;
 const quedan=huesos.map((b,i)=>DEDO.test(b.name)?-1:i).filter(i=>i>=0),nuevo=new Map(quedan.map((v,k)=>[v,k]));
 const destino=i=>{let b=huesos[i];while(b&&DEDO.test(b.name))b=b.parent;return nuevo.get(huesos.indexOf(b))??0;};// (el hueso que queda más cerca hacia el tronco: la mano)
 const partes=ms.map(m=>{const geo=m.geometry.clone(),c=m.material.color||new THREE.Color('#ccc'),n=geo.attributes.position.count,col=new Float32Array(n*3);for(let i=0;i<n;i++)c.toArray(col,i*3);geo.setAttribute('color',new THREE.BufferAttribute(col,3));
  const si=geo.attributes.skinIndex;for(let i=0;i<si.count;i++)for(let k=0;k<4;k++)si.setComponent(i,k,destino(si.getComponent(i,k)));
  for(const k of Object.keys(geo.attributes))if(!['position','normal','skinIndex','skinWeight','color'].includes(k))geo.deleteAttribute(k);return geo;});
 const geo=mergeGeometries(partes,false),malla=new THREE.SkinnedMesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8}));malla.name='cuerpo';
 for(const b of huesos)if(DEDO.test(b.name)&&!DEDO.test(b.parent?.name||''))b.parent.remove(b);
 ms[0].parent.add(malla);malla.position.copy(ms[0].position);malla.quaternion.copy(ms[0].quaternion);malla.scale.copy(ms[0].scale);
 malla.bind(new THREE.Skeleton(quedan.map(i=>huesos[i]),quedan.map(i=>sk.boneInverses[i])),ms[0].bindMatrix);for(const m of ms)m.removeFromParent();return raiz;}

function armar(){base=ligero.value?baseLigera:baseEntera;for(const p of gente)scene.remove(p.root);gente=[];const r=mulberry(7);let tiro;
 const pesoTotal=PAPELES.reduce((t,p)=>t+p.peso,0);
 for(let i=0;i<n.value;i++){tiro=r()*pesoTotal;const papel=PAPELES.find(p=>(tiro-=p.peso)<0)||PAPELES[0];
  const root=cloneSkinned(base),mallas=[];const color=new THREE.Color(ROPA[i%ROPA.length]);
  root.traverse(o=>{if(o.isSkinnedMesh){o.material=o.material.clone();o.material.color.copy(color).offsetHSL(0,0,(r()-.5)*.1);o.frustumCulled=false;mallas.push({o,niveles:geos[o.name]});}});
  const ang=r()*Math.PI*2,rad=4+r()*60;root.position.set(Math.cos(ang)*rad,0,Math.sin(ang)*rad);root.rotation.y=r()*Math.PI*2;
  const mixer=new THREE.AnimationMixer(root),act=mixer.clipAction((ahorro.value||ligero.value?clipsSinDedos:clips).find(c=>c.name===papel.clip));act.play();act.time=r()*act.getClip().duration;
  scene.add(root);gente.push({root,mixer,papel,mallas,nivel:0,giro:(r()-.5)*.6,acum:0,turno:i});}}

function mulberry(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

function cuadro(){raf=requestAnimationFrame(cuadro);const dt=Math.min(reloj.getDelta(),.05),t0=performance.now();
 // (la cámara, en órbita lenta a `lejos` m del centro)
 const a=performance.now()/9000;camera.position.set(Math.cos(a)*lejos.value,Math.max(2,lejos.value*.35),Math.sin(a)*lejos.value);camera.lookAt(0,1,0);
 cuadros++;for(const p of gente){p.acum+=dt;const c=ahorro.value?CADA[p.nivel]:1;if((cuadros+p.turno)%c===0){p.mixer.update(p.acum);p.acum=0;}if(p.papel.v){p.root.rotation.y+=p.giro*dt;const d=p.papel.v*dt;p.root.position.x+=Math.sin(p.root.rotation.y)*d;p.root.position.z+=Math.cos(p.root.rotation.y)*d;if(p.root.position.length()>70)p.root.rotation.y+=Math.PI;}
  // (el nivel según la distancia a la cámara, con margen para no titilar)
  let k=conNiveles.value?p.nivel:0;if(conNiveles.value){const d=p.root.position.distanceTo(camera.position);while(k+1<NIVELES_PLANTA.length&&d>NIVELES_PLANTA[k+1].desde)k++;while(k>0&&d<NIVELES_PLANTA[k].desde*VUELVE_PLANTA)k--;}
  if(k!==p.nivel||!conNiveles.value&&p.nivel){p.nivel=k;for(const m of p.mallas)m.o.geometry=m.niveles[k];}}
 renderer.render(scene,camera);tiempos.push(performance.now()-t0);if(tiempos.length>120)tiempos.shift();
 if(tiempos.length%20===0){const s=[...tiempos].sort((x,y)=>x-y),cuenta=[0,0,0,0];for(const p of gente)cuenta[p.nivel]++;
  datos.value={personas:gente.length,triangulos:renderer.info.render.triangles,llamadas:renderer.info.render.calls,cuadro:+(s.reduce((t,x)=>t+x,0)/s.length).toFixed(1),peor:+s.at(-1).toFixed(1),porNivel:cuenta};}}

onMounted(async()=>{await MeshoptSimplifier.ready;
 renderer=new THREE.WebGLRenderer({canvas:lienzo.value,antialias:true});renderer.setPixelRatio(Math.min(2,devicePixelRatio));
 scene=new THREE.Scene();scene.background=new THREE.Color('#dfe6ea');camera=new THREE.PerspectiveCamera(55,1,.1,500);reloj=new THREE.Clock();
 scene.add(new THREE.HemisphereLight('#ffffff','#8a8f7a',1.4));const sol=new THREE.DirectionalLight('#ffffff',1.6);sol.position.set(20,40,10);scene.add(sol);
 const piso=new THREE.Mesh(new THREE.CircleGeometry(80,48),new THREE.MeshLambertMaterial({color:'#c9c4b6'}));piso.rotation.x=-Math.PI/2;scene.add(piso);
 const tam=()=>{const w=lienzo.value.clientWidth,h=lienzo.value.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();};tam();addEventListener('resize',tam);
 const g=await new GLTFLoader().loadAsync(MODELO);baseEntera=g.scene;clips=g.animations;baseLigera=aligerar(baseEntera);clipsSinDedos=clips.map(c=>new THREE.AnimationClip(c.name,c.duration,c.tracks.filter(t=>!DEDO.test(t.name))));
 // (los niveles de cada malla: la geometría entera y las simplificadas, con los mismos atributos —piel incluida—)
 for(const b of [baseEntera,baseLigera])b.traverse(o=>{if(o.isSkinnedMesh)geos[o.name]=NIVELES_PLANTA.map(N=>{const s=new THREE.BufferGeometry();for(const [k,v] of Object.entries(o.geometry.attributes))s.setAttribute(k,v);s.setIndex(new THREE.BufferAttribute(simplificar(o.geometry,N.ratio),1));s.boundingSphere=o.geometry.boundingSphere;return s;});});
 datos.value.niveles=Object.fromEntries(Object.entries(geos).map(([k,v])=>[k,v.map(x=>x.index.count/3)]));
 cargando.value='';armar();cuadro();
 window.__proto={ligero:on=>{ligero.value=on;armar();},ahorro:on=>{ahorro.value=on;armar();},armar:(k)=>{n.value=k;armar();},niveles:on=>{conNiveles.value=on;},lejos:d=>{lejos.value=d;},datos:()=>datos.value,clips:()=>clips.map(c=>c.name)};});
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
   <label><input type="checkbox" v-model="ahorro" @change="armar"> Ahorro de animación</label>
   <label><input type="checkbox" v-model="ligero" @change="armar"> Cuerpo ligero (1 malla, sin dedos)</label>
   <label>Cámara a {{lejos}} m <input type="range" min="5" max="150" v-model.number="lejos"></label>
   <dl>
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
