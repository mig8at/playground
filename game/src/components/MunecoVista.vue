<script setup>
// El muñeco del jugador en un recuadro (2026-10-17, el menú del juego): el cuerpo único del vestier (vestier3d.js
// makeDressable) con la ropa que se le pase, girando despacio. Se usa en la pestaña «Ropa» del ladrón y en el «Se busca».
// props: cuerpo {piel, pelo, peinado, barba}, ropa {slot: {id, color}}, gira (bool), fondo (color).
import {ref,watch,onMounted,onBeforeUnmount} from 'vue';
import * as THREE from 'three';
import {makeDressable} from '../lib/vestier3d.js';

const props=defineProps({cuerpo:{type:Object,required:true},ropa:{type:Object,required:true},gira:{type:Boolean,default:true},fondo:{type:String,default:''}});
const host=ref(null),cargando=ref(true);
let renderer,scene,camera,person=null,raf=0,last=0,obs=null,muerto=false,gen=0;
const copia=o=>JSON.parse(JSON.stringify(o));
async function armar(){const g=++gen;cargando.value=true;const p=await makeDressable({...props.cuerpo});if(muerto||g!==gen){p.release();return;}
 if(person){scene.remove(person.holder);person.release();}person=p;person.dress(copia(props.ropa));person.mixer.update(0);scene.add(person.holder);cargando.value=false;}
function vestir(){if(!person)return;person.dress(copia(props.ropa));person.mixer.update(0);}
function medir(){const w=host.value.clientWidth,h=host.value.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}
function tick(t){const dt=Math.min(.05,(t-(last||t))/1000);last=t;if(person){person.mixer.update(dt);if(props.gira)person.holder.rotation.y+=dt*.5;}renderer.render(scene,camera);raf=requestAnimationFrame(tick);}
onMounted(()=>{renderer=new THREE.WebGLRenderer({antialias:true,alpha:!props.fondo});renderer.setPixelRatio(Math.min(2,devicePixelRatio));renderer.outputColorSpace=THREE.SRGBColorSpace;
 host.value.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-label','El personaje');
 scene=new THREE.Scene();if(props.fondo)scene.background=new THREE.Color(props.fondo);
 camera=new THREE.PerspectiveCamera(28,1,.1,40);camera.position.set(0,1.25,4.6);camera.lookAt(0,1.05,0);
 scene.add(new THREE.HemisphereLight('#ffffff','#8c8f9a',1.7));const sol=new THREE.DirectionalLight('#fff3dc',2.2);sol.position.set(2.5,5,4);scene.add(sol);
 obs=new ResizeObserver(medir);obs.observe(host.value);medir();armar();raf=requestAnimationFrame(tick);});
watch(()=>JSON.stringify(props.ropa),vestir);
watch(()=>JSON.stringify(props.cuerpo),armar);
onBeforeUnmount(()=>{muerto=true;cancelAnimationFrame(raf);obs?.disconnect();person?.release();renderer?.dispose();renderer?.domElement.remove();});
</script>

<template>
 <div ref="host" class="muneco"><span v-if="cargando" class="carga">Cargando…</span></div>
</template>

<style scoped>
.muneco{position:relative;width:100%;height:100%;min-height:200px}
.muneco :deep(canvas){display:block;width:100%;height:100%}
.carga{position:absolute;inset:0;display:grid;place-items:center;font-size:13px;opacity:.7}
</style>
