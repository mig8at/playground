<script setup>
/* LA PÁGINA PARA CALZAR PEINADOS (2026-11-22, Miguel: «deja una página donde puedas validar varias medidas para el pelo para una
   sola cabeza, así puedes hacer el ajuste más rápido y refinar todos los pelos en una sola cabeza»). Un maniquí en su pose de
   origen, un peinado a la vez y cuatro vistas de la cabeza al mismo tiempo —frente, lado, espalda y arriba— con la cuadrícula
   de 1 cm del modo aristas apagada: piel y pelo de dos colores que contrastan. Cada medida del ajuste del peinado (lib/
   personajes3d.js AJUSTE_PELO) con su control; al cambiarla se vuelve a armar. Abajo, la línea para AJUSTE_PELO, lista para
   pegar. __pelo.poner({...}) y __pelo.peinado(nombre, cuerpo) para manejarla por consola. */
import {onMounted,onBeforeUnmount,ref,reactive,watch,computed} from 'vue';
import * as THREE from 'three';
import {CUERPOS,PEINADOS,materialRopa,armarCuerpo,cargarTodo,ajustePelo,PELO_AFUERA} from '../lib/personajes3d.js';

// (las medidas: nombre, desde, hasta, paso)
const MEDIDAS=[['cubre',.85,1.25,.005],['ex',.8,1.2,.005],['ey',.8,1.2,.005],['ez',.8,1.2,.005],['dx',-.06,.06,.001],['dy',-.06,.06,.001],['dz',-.06,.06,.001],['nacimiento',-1,1,.01],['cara',-1,1,.01],['radio',.4,.6,.005],['sale',1,1.08,.002]];
const VISTAS=[['Frente',0],['Lado',Math.PI/2],['Espalda',Math.PI],['Arriba',null]];
const lienzo=ref(null),cargando=ref('Cargando…'),cuerpo=ref('mujer'),peinado=ref('Hair_Long'),medidas=reactive({}),recortar=ref(true);
const peinadosDe=computed(()=>[...new Set(PEINADOS[cuerpo.value].flat())]);
let renderer,scene,todo=null,actual=null,cabeza=new THREE.Vector3(0,1.6,0),raf=0;const camara=new THREE.PerspectiveCamera(30,1,.01,20);

function cargarMedidas(){const a=ajustePelo(peinado.value);for(const [k] of MEDIDAS)medidas[k]=a[k];recortar.value=a.recortar;}
// (lo que cambia del general: lo que va en AJUSTE_PELO)
const linea=computed(()=>{const g=ajustePelo('__ninguno'),o={};for(const [k] of MEDIDAS)if(Math.abs(medidas[k]-g[k])>1e-9)o[k]=+(+medidas[k]).toFixed(4);if(!recortar.value)o.recortar=false;return `${peinado.value}:${JSON.stringify(o)},`;});

function armar(){if(!todo)return;if(actual)scene.remove(actual);const q=cuerpo.value,p=peinado.value;
 actual=armarCuerpo(todo.cuerpos[q],[todo.peloDe[p]],null,null,todo.ajustes[q],{ajustes:{[p]:{...medidas,recortar:recortar.value}},conNiveles:false});
 actual.traverse(o=>{if(o.isSkinnedMesh){o.material=materialRopa('#d9a47c',{pelo:'#2a1a10',camisa:'#8fa3b8',pantalon:'#3a3a3d'});o.frustumCulled=false;}});
 scene.add(actual);actual.updateMatrixWorld(true);actual.traverse(o=>{if(o.isBone&&o.name==='Head')cabeza.setFromMatrixPosition(o.matrixWorld);});}

function cuadro(){raf=requestAnimationFrame(cuadro);const W=lienzo.value.clientWidth,H=lienzo.value.clientHeight,w=W/2,h=H/2;renderer.setScissorTest(true);
 VISTAS.forEach(([,ang],i)=>{const x=(i%2)*w,y=H-h-Math.floor(i/2)*h,c=cabeza.clone().add(new THREE.Vector3(0,.08,0));
  if(ang==null){camara.position.set(c.x,c.y+.9,c.z+.001);camara.up.set(0,0,-1);}else{camara.position.set(c.x+Math.sin(ang)*.9,c.y,c.z+Math.cos(ang)*.9);camara.up.set(0,1,0);}
  camara.aspect=w/h;camara.updateProjectionMatrix();camara.lookAt(c);renderer.setViewport(x,y,w,h);renderer.setScissor(x,y,w,h);renderer.render(scene,camara);});}

onMounted(async()=>{renderer=new THREE.WebGLRenderer({canvas:lienzo.value,antialias:true});renderer.setPixelRatio(Math.min(2,devicePixelRatio));
 scene=new THREE.Scene();scene.background=new THREE.Color('#e4e8ea');scene.add(new THREE.HemisphereLight('#ffffff','#8a8f7a',1.5));const sol=new THREE.DirectionalLight('#ffffff',1.4);sol.position.set(2,4,3);scene.add(sol);
 const tam=()=>renderer.setSize(lienzo.value.clientWidth,lienzo.value.clientHeight,false);tam();addEventListener('resize',tam);
 todo=await cargarTodo();cargando.value='';cargarMedidas();armar();cuadro();
 window.__pelo={poner:o=>{for(const [k,v] of Object.entries(o))if(k==='recortar')recortar.value=v;else medidas[k]=v;armar();return linea.value;},peinado:(p,q=cuerpo.value)=>{cuerpo.value=q;peinado.value=p;cargarMedidas();armar();return linea.value;},linea:()=>linea.value,medidas:()=>({...medidas,recortar:recortar.value})};});
watch(cuerpo,()=>{if(!peinadosDe.value.includes(peinado.value))peinado.value=peinadosDe.value[0];});
watch(peinado,()=>{cargarMedidas();armar();});
onBeforeUnmount(()=>{cancelAnimationFrame(raf);renderer?.dispose();});
</script>

<template>
 <div class="pelo">
  <canvas ref="lienzo"></canvas>
  <span v-for="(v,i) in VISTAS" :key="v[0]" class="vista" :style="{left:i%2?'calc((100% - 300px)/2)':'0',top:(i>1?50:0)+'%'}">{{v[0]}}</span>
  <aside>
   <h1>Calzar peinados</h1>
   <p v-if="cargando">{{cargando}}</p>
   <label>Cuerpo <select v-model="cuerpo"><option v-for="q in Object.keys(CUERPOS)" :key="q" :value="q">{{q}}</option></select></label>
   <label>Peinado <select v-model="peinado"><option v-for="p in peinadosDe" :key="p" :value="p">{{p}}</option></select></label>
   <label v-for="[k,a,b,s] in MEDIDAS" :key="k" class="medida"><span>{{k}}</span><input type="range" :min="a" :max="b" :step="s" v-model.number="medidas[k]" @input="armar"><b>{{(+medidas[k]).toFixed(3)}}</b></label>
   <label><input type="checkbox" v-model="recortar" @change="armar"> Recortar lo de adelante</label>
   <textarea readonly :value="linea" rows="3"></textarea>
  </aside>
 </div>
</template>

<style scoped>
.pelo{position:fixed;inset:0;background:#e4e8ea}
canvas{position:absolute;left:0;top:0;width:calc(100% - 300px);height:100%;display:block}/* (las vistas, a la izquierda del panel) */
/* (las etiquetas, sobre las vistas: el ancho sin el panel) */
.vista{position:absolute;margin:8px;font:600 12px system-ui;color:#333;background:rgba(255,255,255,.7);padding:2px 6px;border-radius:4px}
aside{position:absolute;top:0;right:0;bottom:0;width:300px;box-sizing:border-box;overflow:auto;border-radius:0;background:rgba(32,34,38,.88);color:#eee;padding:12px 14px;border-radius:10px;font:12px/1.4 system-ui}
h1{font-size:14px;margin:0 0 8px}
label{display:block;margin:4px 0}
.medida{display:grid;grid-template-columns:70px 1fr 44px;gap:6px;align-items:center}
textarea{width:100%;margin-top:8px;font:11px monospace;background:#111;color:#cfe;border:0;border-radius:6px;padding:6px}
</style>
