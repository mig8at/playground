<script setup>
/* LA VITRINA DE LA ROPA (2026-11-22, Miguel: «el cuello redondo o en V… mangas y pantalones bien lineales, como si fuera tela:
   ombliguera, short, calzones…» → «sí, en el sombreador»). Un maniquí por prenda del catálogo (lib/ropa.js), quietos y de frente,
   con su nombre: las de arriba (cuellos y mangas), las de abajo (largos) y las de encima sobre otra. Los cortes los hace el
   sombreador (personajes3d materialRopa): sin un vértice de más. ?atras muestra la espalda; ?anim=Walk_Loop, caminando. */
import {onMounted,onBeforeUnmount,ref} from 'vue';
import * as THREE from 'three';
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js';
import {PEINADOS,materialRopa,armarCuerpo,cargarTodo} from '../lib/personajes3d.js';
import {zonasDeRopa} from '../lib/ropa.js';

const P='#d9a47c',Q='#b97f57',J={id:'jean',color:'#3d5370'},T={id:'tenis',color:'#f2f0ea'},C={id:'camiseta',color:'#7fb2d6'};
const at=(id,color)=>({id,color});
// (nombre, cuerpo, atuendo)
const VITRINA=[
 ['Camiseta','hombre',{top:at('camiseta','#7fb2d6'),bottom:J,shoes:T}],['A rayas','mujer',{top:at('rayas','#c4553d'),bottom:J,shoes:T}],
 ['Manga larga','hombre',{top:at('manga-larga','#c4553d'),bottom:J,shoes:T}],['Tres cuartos','mujer',{top:at('tres-cuartos','#3a9a96'),bottom:J,shoes:T}],
 ['Sin mangas','hombre',{top:at('sin-mangas','#f2f0ea'),bottom:J,shoes:T}],['Ombliguera','mujer',{top:at('ombliguera','#d98aa0'),bottom:at('jean','#3d5370'),shoes:T}],
 ['Polo','hombre',{top:at('polo','#4f8a55'),bottom:at('pantalon','#26282a'),shoes:T}],['Camisa','mujer',{top:at('camisa','#f2f0ea'),bottom:at('pantalon','#26282a'),shoes:T}],
 ['Cuello en V','hombre',{top:at('cuello-v','#2f3133'),bottom:J,shoes:T}],['Sudadera','mujer',{top:at('sudadera','#8a8e90'),bottom:at('deportivo','#2f3133'),shoes:T}],
 ['Cuello alto','hombre',{top:at('cuello-alto','#2b3d5c'),bottom:at('pantalon','#c8b48f'),shoes:T}],['Vestido','mujer',{top:at('vestido','#c4553d'),shoes:T}],
 ['Calzones','hombre',{underwear:at('calzon','#e8e4dc'),shoes:T}],['Bóxer','mujer',{top:at('sin-mangas','#f2f0ea'),underwear:at('boxer','#343d50'),shoes:T}],
 ['Short','mujer',{top:C,bottom:at('short','#3d5370'),shoes:T}],['Pantaloneta','hombre',{top:C,bottom:at('pantaloneta','#2b3549'),shoes:T}],
 ['Falda corta','mujer',{top:C,bottom:at('falda-corta','#7a2e33'),shoes:T}],['Bermuda','hombre',{top:C,bottom:at('bermuda','#c8b48f'),shoes:T}],
 ['Falda a la rodilla','mujer',{top:C,bottom:at('falda-larga','#3f566e'),shoes:T}],['Pescador','mujer',{top:C,bottom:at('pescador','#c8b48f'),shoes:T}],
 ['Chaleco','hombre',{top:at('camisa','#f2f0ea'),outer:at('chaleco','#6e5a3c'),bottom:at('pantalon','#26282a'),shoes:T}],
 ['Chaqueta abierta','mujer',{top:at('rayas','#f2f0ea'),outer:at('chaqueta-abierta','#3f566e'),bottom:J,shoes:T}],
 ['Abrigo','hombre',{top:at('camisa','#f2f0ea'),outer:at('abrigo','#6e4e35'),bottom:at('pantalon','#26282a'),shoes:T}],
 ['Cremallera','mujer',{top:C,outer:at('chaqueta-cremallera','#2b3d5c'),bottom:J,shoes:T}],
];
const COLS=8,PASO=1.05,ALTO=2.25,lienzo=ref(null),cargando=ref('Cargando…'),nombres=ref([]);let renderer,scene,camara,reloj,raf=0,mezcladores=[];

onMounted(async()=>{renderer=new THREE.WebGLRenderer({canvas:lienzo.value,antialias:true});renderer.setPixelRatio(Math.min(2,devicePixelRatio));
 scene=new THREE.Scene();scene.background=new THREE.Color('#e4e8ea');scene.add(new THREE.HemisphereLight('#ffffff','#8a8f7a',1.5));const sol=new THREE.DirectionalLight('#ffffff',1.5);sol.position.set(3,6,8);scene.add(sol);
 const filas=Math.ceil(VITRINA.length/COLS),ancho=COLS*PASO,alto=filas*ALTO;camara=new THREE.OrthographicCamera(-1,1,1,-1,.1,50);
 const q=new URLSearchParams(location.search),atras=q.has('atras');camara.position.set(0,alto/2-.2,atras?-20:20);camara.lookAt(0,alto/2-.2,0);reloj=new THREE.Clock();
 const lugar=k=>new THREE.Vector3(((k%COLS)-(COLS-1)/2)*PASO*(atras?-1:1),(filas-1-Math.floor(k/COLS))*ALTO,0);
 /* (los nombres, debajo de cada maniquí: sus pies proyectados a la pantalla) */
 const tam=()=>{const w=lienzo.value.clientWidth,h=lienzo.value.clientHeight;renderer.setSize(w,h,false);const a=w/h,mitad=Math.max(ancho/2+.1,(alto/2+.1)*a);camara.left=-mitad;camara.right=mitad;camara.top=mitad/a;camara.bottom=-mitad/a;camara.updateProjectionMatrix();camara.updateMatrixWorld();
  nombres.value=VITRINA.map(([n],k)=>{const v=lugar(k).add(new THREE.Vector3(0,-.1,0)).project(camara);return {n,left:(v.x+1)/2*w+'px',top:(1-v.y)/2*h+'px'};});};tam();addEventListener('resize',tam);
 const todo=await cargarTodo(),anim=q.get('anim')||'Idle_Loop',bases={};cargando.value='';
 for(const quien of ['hombre','mujer'])bases[quien]=armarCuerpo(todo.cuerpos[quien],PEINADOS[quien][quien==='hombre'?1:0].map(p=>todo.peloDe[p]),null,null,todo.ajustes[quien],{conNiveles:false});
 VITRINA.forEach(([,quien,o],k)=>{const p=cloneSkinned(bases[quien]),piel=quien==='hombre'?P:Q;p.traverse(x=>{if(x.isSkinnedMesh){x.material=materialRopa(piel,{...zonasDeRopa(o,piel),pelo:'#2a1a10'});x.frustumCulled=false;}});
  p.position.copy(lugar(k));scene.add(p);const m=new THREE.AnimationMixer(p),clip=todo.clipsDe[quien].find(c=>c.name===anim)||todo.clipsDe[quien].find(c=>c.name==='Idle_Loop');m.clipAction(clip).play();m.setTime(k*.29);mezcladores.push(m);});
 /* (__ropa.foco(k, alto): la cámara sobre el maniquí k, a la altura `alto` —1.4 el pecho—; __ropa.foco(null) vuelve a todos) */
 window.__ropa={foco:(k,y=1.35,r=.45)=>{if(k==null){camara.position.x=0;camara.position.y=alto/2-.2;tam();return;}const v=lugar(k),a=lienzo.value.clientWidth/lienzo.value.clientHeight;
  camara.position.x=v.x;camara.position.y=v.y+y;camara.left=-r*a;camara.right=r*a;camara.top=r;camara.bottom=-r;camara.updateProjectionMatrix();nombres.value=[];}};
 const cuadro=()=>{raf=requestAnimationFrame(cuadro);const dt=reloj.getDelta();for(const m of mezcladores)m.update(dt);renderer.render(scene,camara);};cuadro();});
onBeforeUnmount(()=>{cancelAnimationFrame(raf);renderer?.dispose();});
</script>

<template>
 <div class="vitrina">
  <canvas ref="lienzo"></canvas>
  <span v-for="x in nombres" :key="x.n" class="nombre" :style="{left:x.left,top:x.top}">{{x.n}}</span>
  <p v-if="cargando" class="cargando">{{cargando}}</p>
 </div>
</template>

<style scoped>
.vitrina{position:fixed;inset:0;background:#e4e8ea}
canvas{width:100%;height:100%;display:block}
.nombre{position:absolute;transform:translateX(-50%);font:600 11px system-ui;color:#333;white-space:nowrap}
.cargando{position:absolute;top:10px;left:12px;font:13px system-ui}
</style>
