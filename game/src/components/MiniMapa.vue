<script setup>
// La miniatura de la ciudad de una sala (2026-10-18, el rediseño de la entrada). Con el plano guardado en IndexedDB (las
// salas de prueba —mapasGuardados.js—), el plano de verdad; si no (las salas simuladas: armar cada ciudad costaría
// segundos), una isla dibujada desde la semilla con los colores del plano: mar, playa, monte y la cuadrícula del centro.
import {ref,onMounted,watch} from 'vue';
import {leerPlano} from '../lib/mapasGuardados.js';
import {drawWorldStage} from '../lib/drawPlan.js';
const props=defineProps({ciudad:{type:Number,required:true},equipo:{type:Number,default:3},real:{type:Boolean,default:false}});
const lienzo=ref(null),esReal=ref(false);

// (un azar por semilla, para la isla dibujada)
const rng=s=>()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};
function isla(c,seed){const W=c.width,H=c.height,g=c.getContext('2d'),r=rng(seed*2654435761>>>0);
 g.fillStyle='#24485c';g.fillRect(0,0,W,H);
 // el contorno: un óvalo deformado por unas ondas de la semilla
 const ondas=[1,2,3].map(k=>({k:k+1,a:(r()*.12+.04)/k,f:r()*6.28})),cx=W*(.47+r()*.06),cy=H*(.5+r()*.04),rx=W*.4,ry=H*.38;
 const punto=(t,esc)=>{let d=1;for(const o of ondas)d+=o.a*Math.sin(o.k*t+o.f);return [cx+Math.cos(t)*rx*d*esc,cy+Math.sin(t)*ry*d*esc];};
 const borde=(esc,color)=>{g.beginPath();for(let i=0;i<=64;i++){const [x,y]=punto(i/64*6.283,esc);i?g.lineTo(x,y):g.moveTo(x,y);}g.closePath();g.fillStyle=color;g.fill();};
 borde(1.06,'#3d7fa0');borde(1,'#e9d7a8');borde(.9,'#8fb36a');borde(.55,'#a9c77f');
 // el centro: la cuadrícula de manzanas, del tamaño de la partida
 const n=2+Math.min(3,Math.round(props.equipo/2)),lado=Math.min(W,H)*.09,x0=cx-n*lado*.6,y0=cy-n*lado*.55;
 for(let i=0;i<n;i++)for(let j=0;j<n;j++){if(r()<.12)continue;g.fillStyle=r()<.15?'#cfe2c8':['#f1d3b3','#d9c7e8','#bfd8e8','#f2c7c0','#d3d8cf'][Math.floor(r()*5)];g.fillRect(x0+i*lado*1.2,y0+j*lado*1.1,lado,lado*.9);}
 g.strokeStyle='rgba(255,255,255,.7)';g.lineWidth=1;g.strokeRect(x0-lado*.15,y0-lado*.1,n*lado*1.2+lado*.1,n*lado*1.1);}

async function dibujar(){const c=lienzo.value;if(!c)return;esReal.value=false;
 if(props.real){const bp=await leerPlano({seed:props.ciudad,team:props.equipo,parks:true});
  if(bp){const tmp=document.createElement('canvas');try{drawWorldStage(tmp,bp,{cell:1,stage:3,fronts:false,dim:false});const g=c.getContext('2d'),k=Math.max(c.width/tmp.width,c.height/tmp.height);
   g.fillStyle='#24485c';g.fillRect(0,0,c.width,c.height);g.drawImage(tmp,(c.width-tmp.width*k)/2,(c.height-tmp.height*k)/2,tmp.width*k,tmp.height*k);esReal.value=true;return;}catch{}}}
 isla(c,props.ciudad);}
onMounted(dibujar);watch(()=>[props.ciudad,props.real],dibujar);
defineExpose({dibujar});
</script>

<template>
 <canvas ref="lienzo" class="minimapa" width="192" height="128" :aria-label="`Plano de la ciudad ${ciudad}`" :data-real="esReal"></canvas>
</template>

<style scoped>
.minimapa{display:block;width:96px;height:64px;border-radius:10px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);background:#24485c}
</style>
