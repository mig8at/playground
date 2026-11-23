<script setup>
// LA ENTRADA DE MYCITY (2026-11-22, Miguel: «al entrar seleccionamos un país, que por ahora será Colombia, y luego una
// ciudad, que por ahora será Bogotá, y ahí muestra el mapa para caminar»). Tres pasos:
//  1. el título: mycity y «Entrar»;
//  2. el país (engine/lugares.js PAISES): por ahora, Colombia;
//  3. la ciudad del país, con su plano chico: por ahora, Bogotá. Elegirla lleva a /ciudad?lugar=bogota, la ciudad para
//     caminar. Mientras se elige, su plano se arma y se guarda (lib/mapasGuardados.js): la ciudad abre más rápido.
// Abajo, chico, las herramientas: el plano 2D y el catálogo. La entrada vieja —salas, bandos, perfil de policía o ladrón—
// quedó en before/src/views/InicioView.vue. ?paso=titulo|pais|ciudad vuelve directo a una pantalla mientras se itera.
import {ref,computed,watch,onMounted} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import '@fontsource/bungee/400.css';
import '@fontsource-variable/rubik';
import MiniMapa from '../components/MiniMapa.vue';
import {PAISES} from '../engine/lugares.js';
import {precargar} from '../lib/mapasGuardados.js';

const route=useRoute(),router=useRouter();
const PASOS=['titulo','pais','ciudad'];
const paso=ref(PASOS.includes(route.query.paso)?route.query.paso:'titulo');
const paisId=ref(PAISES.some(p=>p.id===route.query.pais)?route.query.pais:PAISES[0].id);
const pais=computed(()=>PAISES.find(p=>p.id===paisId.value));
watch([paso,paisId],([p,q])=>router.replace({query:{paso:p,...(p==='ciudad'?{pais:q}:{})}}));
// (los planos de las ciudades del país, armados y guardados mientras se elige: estado por semilla)
const planos=ref({});
const prepararPlanos=()=>precargar(pais.value.ciudades.map(c=>({seed:c.semilla,team:c.tamano,parks:true})),(a,e)=>{planos.value={...planos.value,[a.seed]:e};});
function elegirPais(p){paisId.value=p.id;paso.value='ciudad';}
function elegirCiudad(c){router.push({path:'/ciudad',query:{lugar:c.id}});}
watch(paso,p=>{if(p==='ciudad')prepararPlanos();});
onMounted(()=>{if(paso.value==='ciudad')prepararPlanos();if(import.meta.env.DEV)window.__inicio={paso,paisId,elegirPais,elegirCiudad,planos};});
</script>

<template>
 <div class="inicio" :class="'p-'+paso">
  <!-- el fondo: la ciudad del juego (capturas del 3D, public/fondos), con un velo para que el texto se lea -->
  <div class="fondo" :class="paso==='titulo'?'noche':'costa'" aria-hidden="true"></div>
  <div class="velo-fondo" aria-hidden="true"></div>

  <!-- 1. el título -->
  <section v-if="paso==='titulo'" class="titulo">
   <div class="marca"><h1 aria-label="mycity"><span>m</span><span>y</span><span>c</span><span>i</span><span>t</span><span>y</span></h1><p>Una ciudad para vivirla: comprá tu lugar, amueblalo y salí a la calle.</p></div>
   <button class="cta grande" @click="paso='pais'">Entrar</button>
   <nav class="herramientas" aria-label="Herramientas"><RouterLink to="/plano">El plano 2D</RouterLink><span aria-hidden="true">·</span><RouterLink to="/catalogo">Catálogo</RouterLink></nav>
   <small class="ver">prototipo · {{ new Date().getFullYear() }}</small>
  </section>

  <!-- 2. el país -->
  <section v-else-if="paso==='pais'" class="eleccion">
   <header><button class="volver" @click="paso='titulo'" aria-label="Volver al título">‹</button><h2>¿En qué país?</h2></header>
   <div class="tarjetas">
    <button v-for="p in PAISES" :key="p.id" class="tarjeta" @click="elegirPais(p)">
     <span class="bandera" :class="p.id" aria-hidden="true"><i></i><i></i><i></i></span>
     <b>{{ p.nombre }}</b><small>{{ p.ciudades.length===1?'1 ciudad':p.ciudades.length+' ciudades' }}</small>
    </button>
   </div>
  </section>

  <!-- 3. la ciudad -->
  <section v-else class="eleccion">
   <header><button class="volver" @click="paso='pais'" aria-label="Volver a los países">‹</button><h2>{{ pais.nombre }} · ¿qué ciudad?</h2></header>
   <div class="tarjetas">
    <button v-for="c in pais.ciudades" :key="c.id" class="tarjeta ciudad" @click="elegirCiudad(c)">
     <div class="plano"><MiniMapa :ciudad="c.semilla" :equipo="c.tamano" :real="planos[c.semilla]==='listo'" /></div>
     <b>{{ c.nombre }}</b><small>{{ c.lema }}</small><span class="ir">Caminar la ciudad ›</span>
    </button>
   </div>
  </section>
 </div>
</template>

<style scoped>
/* Lo de la entrada de antes (el fondo de la ciudad, el velo, Bungee en los títulos y Rubik en el texto, el ámbar del botón
   principal), sin las salas ni los bandos. */
.inicio{--tx:#f5f2ea;--tx2:#c3cad6;--tx3:#8e97a6;--panel:rgba(14,20,33,.74);--borde:rgba(255,255,255,.11);--borde2:rgba(255,255,255,.2);--ambar:#ffa94d;--ambar2:#ff7a3d;--foco:#ffd166;
 --t:'Bungee',Impact,system-ui,sans-serif;--c:'Rubik Variable','Rubik',system-ui,-apple-system,'Segoe UI',sans-serif;
 position:fixed;inset:0;overflow:auto;color:var(--tx);font:15px/1.5 var(--c);display:flex;flex-direction:column;align-items:center;background:#0b1020}
.fondo{position:fixed;inset:-4%;background:center/cover no-repeat;z-index:0;transition:filter .6s}
.fondo.noche{background-image:url('/fondos/noche.jpg');animation:acercar 40s ease-in-out infinite alternate}
.fondo.costa{background-image:url('/fondos/costa.jpg');filter:blur(6px) saturate(1.1) brightness(.75)}
.velo-fondo{position:fixed;inset:0;z-index:0;pointer-events:none;background:linear-gradient(180deg,rgba(11,16,32,.35),rgba(11,16,32,.75))}
.p-titulo .velo-fondo{background:radial-gradient(ellipse at 50% 45%,rgba(11,16,32,.2),rgba(11,16,32,.65) 75%),linear-gradient(180deg,rgba(11,16,32,0) 40%,rgba(11,16,32,.6))}
@keyframes acercar{from{transform:scale(1)}to{transform:scale(1.08) translate(-1%,1%)}}
section{position:relative;z-index:1}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}
:focus-visible{outline:3px solid var(--foco);outline-offset:2px;border-radius:10px}
.cta{background:linear-gradient(180deg,var(--ambar),var(--ambar2));color:#1d1206;font-weight:700;border-radius:14px;padding:15px 44px;font-size:18px;
 box-shadow:0 8px 24px -8px rgba(255,122,61,.7),inset 0 1px 0 rgba(255,255,255,.4);transition:transform .12s,filter .12s}
.cta:hover{transform:translateY(-1px);filter:brightness(1.06)}.cta:active{transform:translateY(1px)}

/* 1. el título */
.titulo{margin:auto;display:flex;flex-direction:column;align-items:center;gap:30px;text-align:center;padding:24px}
.marca h1{margin:0;font:400 min(15vw,150px)/1 var(--t);letter-spacing:4px;display:flex;gap:.02em;transform:rotate(-4deg);justify-content:center}
.marca h1 span{color:#fff6e6;text-shadow:0 6px 0 var(--ambar2),0 12px 0 #8a3416,0 22px 40px rgba(0,0,0,.6)}
.marca h1 span:nth-child(even){transform:translateY(-.06em)}
.marca p{margin:22px 0 0;font-size:19px;font-weight:500;text-shadow:0 2px 10px rgba(0,0,0,.7)}
.herramientas{display:flex;gap:10px;font-size:13px;color:var(--tx3)}.herramientas a{color:var(--tx2);text-decoration:underline;text-underline-offset:3px}.herramientas a:hover{color:var(--tx)}
.ver{color:var(--tx3);letter-spacing:1px;text-transform:uppercase;font-size:11px}

/* 2 y 3. elegir */
.eleccion{margin:auto;width:min(920px,100% - 32px);padding:32px 0;display:flex;flex-direction:column;gap:22px}
.eleccion header{display:flex;align-items:center;gap:12px}
.eleccion h2{margin:0;font:400 clamp(22px,4vw,32px)/1.15 var(--t);letter-spacing:.5px}
.volver{width:40px;height:40px;border-radius:12px;border:1px solid var(--borde2);background:rgba(255,255,255,.06);font-size:24px;line-height:1;display:grid;place-items:center;flex:none}.volver:hover{background:rgba(255,255,255,.12)}
.tarjetas{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
.tarjeta{display:flex;flex-direction:column;align-items:flex-start;gap:4px;text-align:left;padding:18px;border-radius:18px;background:var(--panel);border:1px solid var(--borde);backdrop-filter:blur(16px) saturate(1.2);
 box-shadow:0 20px 50px -20px rgba(0,0,0,.6);transition:transform .15s,border-color .15s}
.tarjeta:hover{transform:translateY(-2px);border-color:rgba(255,169,77,.6)}
.tarjeta b{font:400 22px var(--t);letter-spacing:.5px}.tarjeta small{color:var(--tx2);font-size:13.5px}
/* (la bandera de Colombia: amarillo la mitad, azul y rojo un cuarto cada uno) */
.bandera{display:flex;flex-direction:column;width:72px;height:48px;border-radius:6px;overflow:hidden;margin-bottom:10px;box-shadow:0 4px 12px rgba(0,0,0,.4)}
.bandera i{display:block}.bandera.colombia i:nth-child(1){flex:2;background:#fcd116}.bandera.colombia i:nth-child(2){flex:1;background:#003893}.bandera.colombia i:nth-child(3){flex:1;background:#ce1126}
.ciudad .plano{width:100%;aspect-ratio:3/2;border-radius:12px;overflow:hidden;margin-bottom:10px;background:#24485c}
.ciudad .plano :deep(canvas){width:100%;height:100%;display:block;object-fit:cover}
.ir{margin-top:8px;color:var(--ambar);font-weight:600;font-size:14px}
@media (prefers-reduced-motion:reduce){.fondo.noche{animation:none}.tarjeta,.cta{transition:none}}
</style>
