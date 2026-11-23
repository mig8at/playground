<script setup>
/* LAS CONTEXTURAS (2026-11-22, Miguel: «ármalo y muéstrame en otra página las posibles contexturas»). Los maniquíes de los
   personajes nuevos (lib/personajes3d.js) en dos filas —hombres y mujeres— y una columna por contextura: delgado, normal,
   robusto, grueso, musculoso, bajo y alto (aplicarContextura: el peso y la musculatura son formas de mezcla; la estatura, la
   escala). Cada uno en su animación de quieto, para ver cómo se mueve. Cámara ortográfica: las columnas y sus nombres alineados.
   ?anim=Walk_Loop cambia la animación. */
import {onMounted,onBeforeUnmount,ref} from 'vue';
import * as THREE from 'three';
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js';
import {CUERPOS,PEINADOS,materialRopa,armarCuerpo,cargarTodo,aplicarContextura} from '../lib/personajes3d.js';

const COLUMNAS=[['Delgado',{peso:-.7}],['Normal',{}],['Robusto',{peso:.5}],['Grueso',{peso:1}],['Musculoso',{musculo:1,peso:.1}],['Bajo',{estatura:.92}],['Alto',{estatura:1.08}]];
const FILAS=[['hombre',{piel:'#d9a47c',ropa:{camisa:'#7fa3c4',pantalon:'#2b3550',zapatos:'#1c1c1c',pelo:'#3e2a1c'}}],['mujer',{piel:'#b97f57',ropa:{camisa:'#a63d32',pantalon:'#3a3a3d',zapatos:'#1c1c1c',pelo:'#1b1410'}}]];
const PASO=1.15,lienzo=ref(null),cargando=ref('Cargando…'),posNombres=ref([]);let renderer,scene,camara,reloj,raf=0,mezcladores=[];

onMounted(async()=>{renderer=new THREE.WebGLRenderer({canvas:lienzo.value,antialias:true});renderer.setPixelRatio(Math.min(2,devicePixelRatio));
 scene=new THREE.Scene();scene.background=new THREE.Color('#e4e8ea');scene.add(new THREE.HemisphereLight('#ffffff','#8a8f7a',1.5));const sol=new THREE.DirectionalLight('#ffffff',1.5);sol.position.set(3,6,8);scene.add(sol);
 const ancho=COLUMNAS.length*PASO,alto=FILAS.length*2.15;camara=new THREE.OrthographicCamera(-ancho/2,ancho/2,alto/2,-alto/2,.1,50);camara.position.set(0,alto/2-.1,20);camara.lookAt(0,alto/2-.1,0);reloj=new THREE.Clock();
 /* (los nombres, debajo de cada columna: los pies de la fila de abajo, proyectados a la pantalla) */
 const tam=()=>{const w=lienzo.value.clientWidth,h=lienzo.value.clientHeight;renderer.setSize(w,h,false);const a=w/h,mitad=Math.max(ancho/2,alto/2*a);camara.left=-mitad;camara.right=mitad;camara.top=mitad/a;camara.bottom=-mitad/a;camara.updateProjectionMatrix();
  camara.updateMatrixWorld();posNombres.value=COLUMNAS.map((_,k)=>{const v=new THREE.Vector3((k-(COLUMNAS.length-1)/2)*PASO,-.12,0).project(camara);return {left:(v.x+1)/2*w+'px',top:(1-v.y)/2*h+'px'};});};tam();addEventListener('resize',tam);
 const todo=await cargarTodo(),anim=new URLSearchParams(location.search).get('anim')||'Idle_Loop';cargando.value='';
 FILAS.forEach(([q,vest],f)=>{const base=armarCuerpo(todo.cuerpos[q],PEINADOS[q][0].map(p=>todo.peloDe[p]),null,null,todo.ajustes[q],{conNiveles:false}),y=(FILAS.length-1-f)*2.15;
  COLUMNAS.forEach(([,c],k)=>{const p=cloneSkinned(base);p.traverse(o=>{if(o.isSkinnedMesh){o.material=materialRopa(vest.piel,vest.ropa);o.frustumCulled=false;}});
   aplicarContextura(p,c);p.position.set((k-(COLUMNAS.length-1)/2)*PASO,y,0);scene.add(p);
   const m=new THREE.AnimationMixer(p),clip=todo.clipsDe[q].find(x=>x.name===anim)||todo.clipsDe[q].find(x=>x.name==='Idle_Loop');m.clipAction(clip).play();m.setTime(k*.37);mezcladores.push(m);});});
 const cuadro=()=>{raf=requestAnimationFrame(cuadro);const dt=reloj.getDelta();for(const m of mezcladores)m.update(dt);renderer.render(scene,camara);};cuadro();});
onBeforeUnmount(()=>{cancelAnimationFrame(raf);renderer?.dispose();});
</script>

<template>
 <div class="contexturas">
  <canvas ref="lienzo"></canvas>
  <span v-for="([n],k) in COLUMNAS" :key="n" class="nombre" :style="posNombres[k]">{{n}}</span>
  <p v-if="cargando" class="cargando">{{cargando}}</p>
 </div>
</template>

<style scoped>
.contexturas{position:fixed;inset:0;background:#e4e8ea}
canvas{width:100%;height:100%;display:block}
.nombre{position:absolute;transform:translateX(-50%);font:600 13px system-ui;color:#333}
.cargando{position:absolute;top:10px;left:12px;font:13px system-ui}
</style>
