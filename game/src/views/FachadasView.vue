<script setup>
// LAS FACHADAS, EN TÉCNICO (2026-11-21, Miguel: «una vista de fachadas que funcione como el mapa 2D, con los cálculos
// exactos; así validamos todo antes del 3D»). Por cuadra: cada edificio con sus lados dibujados sin adornos —muro, pisos,
// módulos, vanos con la medida de su pieza, dónde corta cada pared interna y qué paredes se pintan, con su número—, y al
// lado lo medido. No carga el 3D. /fachadas?ciudad=1&jugadores=16&cuadra=2 (&lados=todos para ver también los que no dan
// a la calle).
import {ref,computed,onMounted,watch,nextTick} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import '@fontsource/bungee/400.css';
import '@fontsource-variable/rubik';
import {planoDe} from '../lib/mapasGuardados.js';
import {drawFachadaTecnica,LEYENDA} from '../lib/drawFachada.js';
import {ladosDeCalle,tramosDe} from '../engine/fachada-medida.js';
import {paredesPintables,resumenDeFachadas} from '../engine/muros.js';
import {TYPES} from '../engine/blueprint.js';

const route=useRoute(),router=useRouter();
const seed=ref(Math.max(1,Number(route.query.ciudad)||1)),team=ref(Number(route.query.jugadores)||16),cuadra=ref(Math.max(1,Number(route.query.cuadra)||1)),todos=ref(route.query.lados==='todos');
// (la ciudad entera, por cuadra —engine/muros.js resumenDeFachadas—: para ver de un vistazo que todo el mapa cuadra)
const verCiudad=ref(route.query.vista==='ciudad'),ciudad=ref([]);
const totalC=computed(()=>{const R=ciudad.value,s=k=>R.reduce((a,f)=>a+f[k],0);return R.length?{cuadras:R.length,edificios:s('edificios'),tramos:s('tramos'),modulos:s('modulos'),paredes:s('paredes'),pintables:s('pintables'),adentro:s('pintablesAdentro'),vanos:s('vanos'),cortes:s('cortes'),fuera:s('fueraDeModulo'),malos:s('malos'),noCuadran:R.flatMap(f=>f.noCuadran)}:null;});
const estado=ref('Armando el plano…'),cuadras=ref([]),medidos=ref({}),lienzos=ref({});let plano=null;
const LADO={N:'Norte',S:'Sur',E:'Este',W:'Oeste'};
const edificios=computed(()=>{const c=cuadras.value[cuadra.value-1];if(!c||!plano)return [];return c.lotes.map((L,i)=>({L,n:i+1,lados:todos.value?tramosDe(L).map(t=>t.codigo):ladosDeCalle(L),pintables:paredesPintables(plano,L).length}));});
const resumen=computed(()=>{const M=Object.values(medidos.value);return {cortes:M.reduce((a,m)=>a+m.cortes,0),fuera:M.reduce((a,m)=>a+m.fueraDeModulo,0),fachadas:M.length,paredes:M.reduce((a,m)=>a+m.paredes,0),pintables:M.reduce((a,m)=>a+m.pintables,0),vanos:M.reduce((a,m)=>a+m.vanos,0),mal:M.filter(m=>!m.cuadra).length};});
async function cargar(){estado.value='Armando el plano…';const r=await planoDe({seed:seed.value,team:team.value,parks:true});if(!r.plano){estado.value='No se pudo armar el plano.';return;}plano=r.plano;
 const ids=[...new Set(plano.lots.filter(L=>L.levels?.length).map(L=>L.block))].sort((a,b)=>a-b);cuadras.value=ids.map(b=>({lotes:plano.lots.filter(L=>L.block===b&&L.levels?.length).sort((x,y)=>x.id-y.id)}));
 cuadra.value=Math.min(cuadra.value,cuadras.value.length);estado.value='';ciudad.value=resumenDeFachadas(plano);pintar();}
async function pintar(){router.replace({query:{ciudad:seed.value,jugadores:team.value,cuadra:cuadra.value,...(todos.value?{lados:'todos'}:{}),...(verCiudad.value?{vista:'ciudad'}:{})}});await nextTick();const o={};
 for(const e of edificios.value)for(const l of e.lados){const k=e.L.id+'-'+l,c=lienzos.value[k];if(c)o[k]=drawFachadaTecnica(c,plano,e.L,l,{width:Math.min(760,c.parentElement.clientWidth)});}medidos.value=o;}
watch([cuadra,todos],pintar);
onMounted(cargar);
</script>

<template>
 <div class="fachadas">
  <header class="barra">
   <RouterLink to="/plano" class="logo" title="Volver al plano">FUGA</RouterLink>
   <b class="titulo">Fachadas</b>
   <label>Ciudad <input type="number" min="1" v-model.number="seed" @change="cargar"></label>
   <label>Tamaño <select v-model.number="team" @change="cargar"><option :value="3">Chica</option><option :value="5">Mediana</option><option :value="8">Grande</option><option :value="16">Enorme</option></select></label>
   <div class="pasos"><button :disabled="cuadra<=1" @click="cuadra--">−</button><span>Cuadra {{ String(cuadra).padStart(3,'0') }} de {{ cuadras.length }}</span><button :disabled="cuadra>=cuadras.length" @click="cuadra++">+</button></div>
   <label class="chk"><input type="checkbox" v-model="todos"> todos los tramos</label>
   <span class="res" v-if="resumen.fachadas">{{ resumen.fachadas }} fachadas · {{ resumen.paredes }} paredes · <b>{{ resumen.pintables }} se pintan</b> · {{ resumen.vanos }} vanos · {{ resumen.cortes }} cortes de pared<template v-if="resumen.cortes"> ({{ Math.round((1-resumen.fuera/resumen.cortes)*100) }} % en línea de módulo)</template> · <b :class="resumen.mal?'mal':'bien'">{{ resumen.mal?resumen.mal+' no cuadran':'todo cuadra' }}</b></span>
   <RouterLink class="ir" :to="{path:'/plano',query:{ciudad:seed,jugadores:team}}">Ver el plano</RouterLink>
  </header>
  <div class="leyenda"><span v-for="(l,i) in LEYENDA" :key="i"><i :style="{background:l[0],borderColor:l[1]}"></i>{{ l[2] }}</span><span><i class="mod"></i>módulo de 2 m</span></div>
  <p v-if="estado" class="estado">{{ estado }}</p>
  <section v-else-if="totalC" class="ciudad">
   <button class="enlace" @click="verCiudad=!verCiudad">{{ verCiudad?'Ocultar la ciudad entera':'Ver la ciudad entera, por cuadra' }}</button>
   <span class="tot">{{ totalC.cuadras }} cuadras · {{ totalC.edificios.toLocaleString('es-CO') }} edificios · {{ totalC.tramos.toLocaleString('es-CO') }} tramos · {{ totalC.modulos.toLocaleString('es-CO') }} módulos · {{ totalC.paredes.toLocaleString('es-CO') }} paredes de fachada · <b class="si">{{ totalC.pintables.toLocaleString('es-CO') }} se pintan</b> (y {{ totalC.adentro.toLocaleString('es-CO') }} de adentro) · {{ totalC.cortes.toLocaleString('es-CO') }} cortes de pared, {{ Math.round((1-totalC.fuera/Math.max(1,totalC.cortes))*100) }} % en línea de módulo ·
    <b :class="totalC.noCuadran.length||totalC.malos?'mal':'bien'">{{ totalC.noCuadran.length||totalC.malos?(totalC.noCuadran.length+' fachadas no cuadran'):'toda la ciudad cuadra' }}</b></span>
   <table v-if="verCiudad"><thead><tr><th>Cuadra</th><th>Edificios</th><th>Tramos</th><th>Módulos</th><th>Paredes</th><th>Se pintan</th><th>De adentro</th><th>Vanos</th><th>Cortes</th><th>En línea de módulo</th><th>Sobre un vano</th><th>Cuadra</th></tr></thead>
    <tbody><tr v-for="f in ciudad" :key="f.cuadra" :class="{on:f.cuadra===cuadra}" @click="cuadra=f.cuadra"><td><code>{{ String(f.cuadra).padStart(3,'0') }}</code></td><td>{{ f.edificios }}</td><td>{{ f.tramos }}</td><td>{{ f.modulos }}</td><td>{{ f.paredes }}</td><td class="si">{{ f.pintables }}</td><td>{{ f.pintablesAdentro }}</td><td>{{ f.vanos }}</td><td>{{ f.cortes }}</td><td>{{ f.cortes?Math.round((1-f.fueraDeModulo/f.cortes)*100)+' %':'—' }}</td><td :class="{mal:f.malos}">{{ f.malos }}</td><td :class="f.noCuadran.length?'mal':'bien'">{{ f.noCuadran.length?f.noCuadran.join(', '):'sí' }}</td></tr></tbody></table>
  </section>
  <main v-if="!estado">
   <section v-for="e in edificios" :key="e.L.id">
    <h2><code>{{ String(cuadra).padStart(3,'0') }} {{ String(e.n).padStart(2,'0') }}</code> {{ e.L.shopName||e.L.name||'Edificio' }} <small>{{ TYPES[e.L.type]?.label||e.L.type }} · {{ e.L.floors }} {{ e.L.floors===1?'piso':'pisos' }} · lote {{ e.L.id }} · {{ e.pintables }} paredes que se pintan en todo el edificio</small>
     <RouterLink :to="{path:'/plano',query:{ciudad:seed,jugadores:team,lote:e.L.id,mapa:1}}">abrir en el plano</RouterLink></h2>
    <p v-if="!e.lados.length" class="nada">Ningún lado da a la calle.</p>
    <div class="fila">
     <figure v-for="l in e.lados" :key="l">
      <canvas :ref="c=>{if(c)lienzos[e.L.id+'-'+l]=c;}"></canvas>
      <figcaption v-if="medidos[e.L.id+'-'+l]"><b>{{ LADO[l[0]] }}<template v-if="+l.slice(1)"> {{ +l.slice(1)+1 }}</template><template v-if="l===e.L.front+'0'"> · frente</template> <code>{{ l }}</code></b> · grilla de {{ medidos[e.L.id+'-'+l].modulos }} × {{ medidos[e.L.id+'-'+l].pisos }} módulos de 2 × 3 m = {{ Math.round(medidos[e.L.id+'-'+l].ancho*20) }} × {{ Math.round(medidos[e.L.id+'-'+l].alto*20) }} píxeles de 5 cm · {{ medidos[e.L.id+'-'+l].paredes }} paredes ({{ medidos[e.L.id+'-'+l].cortes }} cortes de pared interna<template v-if="medidos[e.L.id+'-'+l].fueraDeModulo">, {{ medidos[e.L.id+'-'+l].fueraDeModulo }} adentro de un módulo</template><template v-if="medidos[e.L.id+'-'+l].cortesMalos">, <b class="mal">{{ medidos[e.L.id+'-'+l].cortesMalos }} sobre un vano</b></template>) · {{ medidos[e.L.id+'-'+l].vanos }} vanos, {{ medidos[e.L.id+'-'+l].areaVanos }} m² ·
       <b class="si">{{ medidos[e.L.id+'-'+l].pintables }} se pintan</b><template v-if="medidos[e.L.id+'-'+l].pintables">, {{ medidos[e.L.id+'-'+l].areaPintable }} m²: <code>{{ medidos[e.L.id+'-'+l].numeros.join(' · ') }}</code></template> ·
       <b :class="medidos[e.L.id+'-'+l].cuadra?'bien':'mal'">{{ medidos[e.L.id+'-'+l].cuadra?'cuadra':'NO cuadra' }}</b></figcaption>
     </figure>
    </div>
   </section>
  </main>
 </div>
</template>

<style scoped>
.fachadas{--tx:#f5f2ea;--tx2:#c3cad6;--tx3:#8e97a6;--borde:rgba(255,255,255,.12);min-height:100vh;background:#141b29;color:var(--tx);font-family:'Rubik Variable',system-ui,sans-serif;font-size:14px}
.barra{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 16px;background:rgba(14,20,33,.96);border-bottom:1px solid var(--borde)}
.logo{background:#ff7a3d;color:#1b1206;font-family:Bungee,sans-serif;font-size:11px;padding:8px 6px;border-radius:9px;text-decoration:none}
.titulo{font-family:Bungee,sans-serif;font-size:15px;letter-spacing:.04em}
.barra label{display:flex;gap:6px;align-items:center;color:var(--tx3)}
.barra input[type=number],.barra select{background:#0d1320;border:1px solid var(--borde);color:var(--tx);border-radius:8px;padding:5px 8px;font:inherit;width:auto}.barra input[type=number]{width:64px}
.pasos{display:flex;gap:8px;align-items:center}.pasos button{width:28px;height:28px;border-radius:8px;border:1px solid var(--borde);background:transparent;color:var(--tx);cursor:pointer;font:inherit}.pasos button:disabled{opacity:.35}
.pasos span{min-width:150px;text-align:center;font-weight:600}
.res{color:var(--tx2)}.res b,.si{color:#48dba0}.bien{color:#48dba0}.mal{color:#ff6b5e}
.ir{margin-left:auto;color:var(--tx);border:1px solid var(--borde);border-radius:9px;padding:6px 12px;text-decoration:none}
.leyenda{display:flex;flex-wrap:wrap;gap:14px;padding:8px 16px;color:var(--tx3);font-size:12px;border-bottom:1px solid var(--borde)}
.leyenda span{display:flex;gap:6px;align-items:center}.leyenda i{width:14px;height:14px;border:2px solid;border-radius:3px;display:inline-block}.leyenda i.mod{border:0;border-left:2px dotted #8e97a6;width:2px}
.ciudad{padding:10px 16px}.ciudad .tot{margin-left:12px;color:var(--tx2);font-size:13px}
.enlace{background:none;border:0;padding:0;color:#48dba0;font:inherit;cursor:pointer;text-decoration:underline}
.ciudad table{margin-top:10px;border-collapse:collapse;font-size:12px;width:100%;max-width:1100px}
.ciudad th{text-align:right;color:var(--tx3);font-weight:500;padding:4px 10px;border-bottom:1px solid var(--borde);position:sticky;top:52px;background:#141b29}
.ciudad th:first-child,.ciudad td:first-child{text-align:left}
.ciudad td{text-align:right;padding:3px 10px;border-bottom:1px solid rgba(255,255,255,.05)}
.ciudad tbody tr{cursor:pointer}.ciudad tbody tr:hover{background:rgba(255,255,255,.05)}.ciudad tbody tr.on{background:rgba(72,219,160,.12)}
.ciudad td.si{color:#48dba0}.ciudad td.bien{color:#48dba0}.ciudad td.mal{color:#ff6b5e}
.estado{padding:60px;text-align:center;font-family:Bungee,sans-serif;color:var(--tx2)}
main{padding:8px 16px 60px}
section{padding:14px 0;border-bottom:1px solid var(--borde)}
h2{margin:0 0 10px;font-size:15px;font-weight:600;display:flex;flex-wrap:wrap;gap:10px;align-items:baseline}h2 small{color:var(--tx3);font-weight:400;font-size:12px}h2 a{color:#48dba0;font-size:12px;font-weight:400}
code{font-size:12px;color:#9fc3d1;background:rgba(255,255,255,.06);padding:1px 5px;border-radius:5px}
.fila{display:flex;flex-wrap:wrap;gap:16px}
figure{margin:0;max-width:760px;flex:1 1 420px}
figure canvas{display:block;border-radius:8px;max-width:100%}
figcaption{margin-top:6px;color:var(--tx3);font-size:12px;line-height:1.5}figcaption b{color:var(--tx)}figcaption b.si{color:#48dba0}figcaption b.bien{color:#48dba0}figcaption b.mal{color:#ff6b5e}
.nada{color:var(--tx3);margin:0}
.chk{cursor:pointer}
</style>
