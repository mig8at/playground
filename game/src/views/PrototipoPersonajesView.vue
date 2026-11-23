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
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js';
import {NIVELES_PLANTA,VUELVE_PLANTA} from '../lib/nature3d.js';
import {CUERPOS,PEINADOS,NIV,materialRopa,vestimenta,armarCuerpo,cargarTodo,aplicarContextura,contexturaAlAzar} from '../lib/personajes3d.js';

// (qué hace cada persona: la animación y si se mueve, a qué velocidad en m/s)
const PAPELES=[{clip:'Walk_Loop',v:1.3,peso:5},{clip:'Jog_Fwd_Loop',v:3,peso:2},{clip:'Idle_Loop',v:0,peso:2},{clip:'Idle_Talking_Loop',v:0,peso:2},{clip:'Idle_TalkingPhone_Loop',v:0,peso:1.5},{clip:'Idle_FoldArms_Loop',v:0,peso:1},{clip:'Walk_Carry_Loop',v:1.1,peso:1},{clip:'Sitting_Idle_Loop',v:0,peso:1},{clip:'Walk_Formal_Loop',v:1.1,peso:1},{clip:'Sprint_Loop',v:5.5,peso:.5}];
const lienzo=ref(null),datos=ref({}),n=ref(100),conNiveles=ref(true),ahorro=ref(true),lejos=ref(30),cargando=ref('Cargando los modelos…');
// (el ahorro de animación: según el nivel, el mezclador se actualiza cada CADA[nivel] cuadros, con el tiempo acumulado)
const CADA=[1,2,3,4];
let foco=null,renderer,scene,camera,reloj,raf=0,variantes={hombre:[],mujer:[]},clipsDe={},gente=[],tiempos=[],cuadros=0;

function armar(){for(const p of gente)scene.remove(p.root);gente=[];const r=mulberry(7),pesoTotal=PAPELES.reduce((t,p)=>t+p.peso,0);
 for(let i=0;i<n.value;i++){let tiro=r()*pesoTotal;const papel=PAPELES.find(p=>(tiro-=p.peso)<0)||PAPELES[0],quien=i%2?'mujer':'hombre',vs=variantes[quien];
  const root=cloneSkinned(vs[Math.floor(r()*vs.length)]),vest=vestimenta(r,quien==='mujer'),mallas=[];
  root.traverse(o=>{if(o.isSkinnedMesh){o.material=materialRopa(vest.piel,vest.ropa);o.frustumCulled=false;mallas.push({o,niveles:NIV[o.name]});}});
  aplicarContextura(root,contexturaAlAzar(r,quien==='mujer'));/* (cada persona, su contextura: estatura, peso y musculatura) */
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

onMounted(async()=>{
 renderer=new THREE.WebGLRenderer({canvas:lienzo.value,antialias:true});renderer.setPixelRatio(Math.min(2,devicePixelRatio));
 scene=new THREE.Scene();scene.background=new THREE.Color('#dfe6ea');camera=new THREE.PerspectiveCamera(55,1,.1,500);reloj=new THREE.Clock();
 scene.add(new THREE.HemisphereLight('#ffffff','#8a8f7a',1.4));const sol=new THREE.DirectionalLight('#ffffff',1.6);sol.position.set(20,40,10);scene.add(sol);
 const piso=new THREE.Mesh(new THREE.CircleGeometry(80,48),new THREE.MeshLambertMaterial({color:'#c9c4b6'}));piso.rotation.x=-Math.PI/2;scene.add(piso);
 const tam=()=>{const w=lienzo.value.clientWidth,h=lienzo.value.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();};tam();addEventListener('resize',tam);
 const todo=await cargarTodo(),sinPelo=new URLSearchParams(location.search).has('sinpelo');clipsDe=todo.clipsDe;// (?sinpelo: para revisar los cuerpos solos)
 for(const q of Object.keys(CUERPOS))variantes[q]=PEINADOS[q].map(ps=>armarCuerpo(todo.cuerpos[q],sinPelo?[]:ps.map(p=>todo.peloDe[p]),null,null,todo.ajustes[q]));
 const clips=todo.clips;
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
