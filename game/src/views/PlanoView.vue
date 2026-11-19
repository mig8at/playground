<script setup>
// EL VISOR DEL PLANO (2026-11-19, Miguel: «tenemos un mapa 2D donde aterrizamos todo… que sea más fluido sin necesidad de
// estar viéndolo en el 3D»). El plano es donde se decide dónde va cada cosa, pero no había dónde mirarlo entero: el
// minimapa y el mapa del menú lo dibujan hasta los lotes, y para ver un mueble o un árbol había que cargar el 3D (~20 s).
// Acá se ve todo lo que el plano sabe —pisos, cuartos, puertas, muebles, árboles, mobiliario de calle, pintura, nombres
// de vías, botines y azoteas—, con rueda para acercar, arrastre para moverse y clic en un edificio para su piso en grande.
// /plano?ciudad=1&jugadores=3. No carga modelos ni three.js.
import {ref,reactive,computed,onMounted,onBeforeUnmount,watch,nextTick} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import '@fontsource/bungee/400.css';
import '@fontsource-variable/rubik';
import {planoDe} from '../lib/mapasGuardados.js';
import {drawWorldStage,drawFloorPlan,drawHogar,drawElevation,CAPAS,ROOM_LABEL} from '../lib/drawPlan.js';
import {CELL,TYPES} from '../engine/blueprint.js';

const route=useRoute(),router=useRouter();
const seed=ref(Math.max(1,Number(route.query.ciudad)||1)),team=ref(Math.max(2,Number(route.query.jugadores)||3));
const estado=ref('Armando el plano…'),nivel=ref(0),capas=reactive({...CAPAS}),elegido=ref(null),casa=ref(null),cursor=ref(null),tardo=ref(0);
const host=ref(null),lienzo=ref(null),piso=ref(null),nitido=ref(null),nitidoListo=ref(false),escala=ref(0);
let relojNitido=0;
let plano=null,origen={x0:0,y0:0},celda=20,arrastre=null,tocado=false;// (tocado: ya acercó o movió; mientras no, el plano se reajusta al cambiar el tamaño de la ventana)
const vista=reactive({x:0,y:0,k:1});// (la posición y el zoom del lienzo dentro del visor, en píxeles de pantalla)
const NOMBRE_CAPA={pintura:'Pintura de vías',equipo:'Mobiliario',arboles:'Árboles',nombres:'Nombres de vías',botines:'Botines'};
const TIPO={vivienda:'Vivienda',oficinas:'Oficinas',comercio:'Comercio',hotel:'Hotel',casa:'Casa',local:'Local',colegio:'Colegio',comisaria:'Comisaría',biblioteca:'Biblioteca',hospital:'Hospital',objetivo:'Objetivo',residencial:'Residencial'};

const alzado=ref(null),ladoAlzado=ref(null),medidoAlzado=ref(null);
const LADO={N:'Norte',S:'Sur',E:'Este',W:'Oeste'};
// (los lados del edificio que dan a algo abierto: una medianera no tiene fachada)
const ladosAbiertos=computed(()=>elegido.value?Object.entries(elegido.value.sides||{}).filter(([,v])=>v!=='medianera'&&v!=='interior').map(([k])=>k):[]);
const maxPisos=ref(0),grande=ref(false);// (maxPisos: el plano no es reactivo —es enorme—, así que se anota al cargar)
const resumen=ref(null);

function dibujar(){
 if(!plano||!lienzo.value)return;const t0=performance.now(),dpr=window.devicePixelRatio||1,B=plano.isla.bounds;
 // (la celda más grande que deja el lienzo por debajo de ~4.600 px de lado: más que eso algunos navegadores no lo pintan)
 celda=Math.max(8,Math.min(36,Math.floor(4600/(Math.max(B.x1-B.x0,B.y1-B.y0)*dpr))));
 origen=drawWorldStage(lienzo.value,plano,{cell:celda,stage:9,level:nivel.value,dim:false,capas:{...capas},selected:elegido.value?.id??-1});
 lienzo.value.style.width=lienzo.value.width/dpr+'px';lienzo.value.style.height=lienzo.value.height/dpr+'px';
 tardo.value=Math.round(performance.now()-t0);
}
// LA CAPA NÍTIDA: el lienzo de base se dibuja una vez (a ~4 px por metro) y al acercar sólo se estira. Cuando la vista
// se queda quieta un momento, encima se dibuja SÓLO lo que se ve, a la escala de la pantalla (hasta 42 px por metro):
// mientras se arrastra o se gira la rueda se ve la base estirada, y al soltar llega el detalle.
function pedirNitido(){nitidoListo.value=false;clearTimeout(relojNitido);if(!plano)return;escala.value=celda/CELL*vista.k;relojNitido=setTimeout(dibujarNitido,140);}
function dibujarNitido(){
 if(!plano||!host.value||!nitido.value||vista.k<=1.05)return;const t0=performance.now(),dpr=window.devicePixelRatio||1,w=host.value.clientWidth,h=host.value.clientHeight;
 drawWorldStage(nitido.value,plano,{cell:celda*vista.k,stage:9,level:nivel.value,dim:false,capas:{...capas},selected:elegido.value?.id??-1,region:{x:-vista.x*dpr,y:-vista.y*dpr,w:w*dpr,h:h*dpr}});
 nitido.value.style.width=w+'px';nitido.value.style.height=h+'px';nitidoListo.value=true;tardo.value=Math.round(performance.now()-t0);
}
function ajustar(){
 if(!host.value||!lienzo.value)return;tocado=false;const w=host.value.clientWidth,h=host.value.clientHeight,cw=parseFloat(lienzo.value.style.width),ch=parseFloat(lienzo.value.style.height);
 vista.k=Math.min(w/cw,h/ch)*.96;vista.x=(w-cw*vista.k)/2;vista.y=(h-ch*vista.k)/2;
}
// De un punto de la pantalla a metros del plano.
function aMetros(e){const r=host.value.getBoundingClientRect(),px=(e.clientX-r.left-vista.x)/vista.k,py=(e.clientY-r.top-vista.y)/vista.k;return {x:(px/celda+origen.x0)*CELL,z:(py/celda+origen.y0)*CELL};}
const loteEn=(x,z)=>[...plano.lots,...(plano.isla.lots||[])].find(L=>L.parts.some(P=>x>=P.x&&x<=P.x+P.w&&z>=P.y&&z<=P.y+P.h))||null;
// (una casa del monte: su huella es un rectángulo girado alrededor de su centro)
const casaEn=(x,z)=>(plano.isla.casas||[]).find(c=>{if(!c.spec?.hogar)return false;const dx=x-c.x,dz=z-c.z,k=Math.cos(c.ry||0),n=Math.sin(c.ry||0);return Math.abs(dx*k-dz*n)<=c.w/2&&Math.abs(dx*n+dz*k)<=c.d/2;})||null;
function rueda(e){e.preventDefault();tocado=true;const r=host.value.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top,k=Math.max(.15,Math.min(42*CELL/celda,vista.k*(e.deltaY<0?1.18:1/1.18)));// (hasta 42 px por metro, como el piso ampliado)
 vista.x=mx-(mx-vista.x)*k/vista.k;vista.y=my-(my-vista.y)*k/vista.k;vista.k=k;}
function baja(e){arrastre={x:e.clientX,y:e.clientY,vx:vista.x,vy:vista.y,movio:false};host.value.setPointerCapture?.(e.pointerId);}
function mueve(e){if(plano){const p=aMetros(e);cursor.value={x:p.x.toFixed(1),z:p.z.toFixed(1)};}
 if(!arrastre)return;const dx=e.clientX-arrastre.x,dy=e.clientY-arrastre.y;if(Math.abs(dx)+Math.abs(dy)>4)arrastre.movio=tocado=true;vista.x=arrastre.vx+dx;vista.y=arrastre.vy+dy;}
function sube(e){const a=arrastre;arrastre=null;if(!a||a.movio||!plano)return;const p=aMetros(e),L=loteEn(p.x,p.z);elegido.value=L;casa.value=L?null:casaEn(p.x,p.z);dibujar();pedirNitido();}
function tecla(e){if(e.target.tagName==='INPUT')return;if(e.key==='+'||e.key==='=')nivel.value=Math.min(maxPisos.value,nivel.value+1);else if(e.key==='-')nivel.value=Math.max(0,nivel.value-1);else if(e.key==='0')ajustar();else if(e.key==='Escape')elegido.value=casa.value=null;}

const fichaNivel=computed(()=>elegido.value?Math.min(nivel.value,elegido.value.floors-1):0);
const cuartos=computed(()=>{const L=elegido.value;if(!L)return [];const lv=L.levels[fichaNivel.value],n={};for(const q of lv.rooms){const t=ROOM_LABEL[q.type]||q.type;n[t]=(n[t]||0)+1;}return Object.entries(n).sort((a,b)=>b[1]-a[1]);});
const medidas=computed(()=>{const L=elegido.value;if(!L)return null;const lv=L.levels[fichaNivel.value],area=L.parts.reduce((a,P)=>a+P.w*P.h,0),pas=lv.corridor.reduce((a,q)=>a+q.w*q.h,0);
 return {area:Math.round(area),pasillo:Math.round(pas/area*100),muebles:lv.furniture.length,puertas:lv.doors.length,ventanas:lv.windows.length};});
const casaNivel=computed(()=>casa.value?Math.min(nivel.value,casa.value.spec.hogar.levels.length-1):0);
const casaCuartos=computed(()=>{const c=casa.value;if(!c)return [];return c.spec.hogar.levels[casaNivel.value].rooms.filter(q=>q.type!=='hall').map(q=>({nombre:q.label||ROOM_LABEL[q.type]||q.type,medida:`${(q.u1-q.u0).toFixed(1)} × ${(q.v1-q.v0).toFixed(1)} m`}));});
async function dibujarPiso(){await nextTick();if(casa.value&&piso.value){drawHogar(piso.value,casa.value.spec.hogar,{level:casaNivel.value,width:piso.value.parentElement.clientWidth});return;}
 const L=elegido.value;if(!L||!piso.value)return;
 if(alzado.value){const lado=ladosAbiertos.value.includes(ladoAlzado.value)?ladoAlzado.value:L.front;ladoAlzado.value=lado;medidoAlzado.value=drawElevation(alzado.value,L,{width:alzado.value.parentElement.clientWidth,lado});}
 drawFloorPlan(piso.value,L,{level:fichaNivel.value,stage:9,width:piso.value.parentElement.clientWidth});}

async function cargar(){
 estado.value='Armando el plano…';elegido.value=null;casa.value=null;plano=null;resumen.value=null;
 router.replace({query:{ciudad:seed.value,jugadores:team.value}});
 const t0=performance.now(),r=await planoDe({seed:seed.value,team:team.value,parks:true});
 if(!r.plano){estado.value='No se pudo armar el plano de esta ciudad.';return;}
 plano=r.plano;maxPisos.value=Math.max(...plano.lots.map(L=>L.floors));const V=plano.vegetacion||{};
 resumen.value={edificios:plano.lots.length,casas:plano.isla.casas?.length||0,arboles:(V.arboles?.length||0)+(V.palmeras?.length||0),mobiliario:plano.equipamiento?.length||0,
  muebles:plano.lots.reduce((a,L)=>a+L.levels.slice(0,L.floors).reduce((b,lv)=>b+lv.furniture.length,0),0),ms:Math.round(performance.now()-t0),guardado:r.guardado};
 nivel.value=0;estado.value='';await nextTick();dibujar();ajustar();
}
watch([nivel,capas],()=>{dibujar();dibujarPiso();pedirNitido();});
watch(vista,pedirNitido);
watch([elegido,casa,grande,ladoAlzado],dibujarPiso);
watch(elegido,()=>{ladoAlzado.value=null;});
let obs;
onMounted(()=>{cargar();window.addEventListener('keydown',tecla);obs=new ResizeObserver(()=>{if(!plano||arrastre)return;if(!tocado)ajustar();dibujarPiso();pedirNitido();});obs.observe(host.value);});
onBeforeUnmount(()=>{clearTimeout(relojNitido);window.removeEventListener('keydown',tecla);obs?.disconnect();});
</script>

<template>
 <div class="plano">
  <header class="barra">
   <RouterLink to="/?paso=home" class="logo" title="Volver a las salas">FUGA</RouterLink>
   <b class="titulo">El plano</b>
   <label>Ciudad <input type="number" min="1" v-model.number="seed" @change="cargar"></label>
   <label>Por equipo <input type="number" min="2" max="8" v-model.number="team" @change="cargar"></label>
   <div class="pisos" role="group" aria-label="Piso">
    <button :disabled="nivel<=0" @click="nivel--" title="Bajar un piso (−)">−</button>
    <span>{{ nivel===0?'Planta baja':'Piso '+nivel }}</span>
    <button :disabled="nivel>=maxPisos" @click="nivel++" title="Subir un piso (+): arriba del último se ven las azoteas">+</button>
   </div>
   <div class="capas"><label v-for="(n,k) in NOMBRE_CAPA" :key="k" :class="{on:capas[k]}"><input type="checkbox" v-model="capas[k]">{{ n }}</label></div>
   <button class="ajustar" @click="ajustar" title="Ver todo (0)">Ver todo</button>
   <RouterLink class="jugar" :to="{path:'/juego',query:{ciudad:seed,jugadores:team}}">Jugar esta ciudad</RouterLink>
  </header>

  <div ref="host" class="visor" :class="{arrastrando:arrastre}" @wheel="rueda" @pointerdown="baja" @pointermove="mueve" @pointerup="sube" @pointerleave="cursor=null">
   <canvas ref="lienzo" class="base" :style="{transform:`translate(${vista.x}px,${vista.y}px) scale(${vista.k})`}"></canvas>
   <canvas ref="nitido" class="nitido" :class="{listo:nitidoListo}"></canvas>
   <div v-if="estado" class="estado">{{ estado }}</div>
   <div class="pie">
    <span v-if="cursor">x {{ cursor.x }} m · z {{ cursor.z }} m</span>
    <span v-if="escala">{{ escala.toFixed(1) }} px por metro</span>
    <span v-if="resumen">{{ resumen.edificios }} edificios · {{ resumen.casas }} casas · {{ resumen.muebles.toLocaleString('es-CO') }} muebles · {{ resumen.arboles.toLocaleString('es-CO') }} árboles · {{ resumen.mobiliario }} de mobiliario</span>
    <span v-if="resumen">plano {{ resumen.guardado?'guardado':'armado' }} en {{ (resumen.ms/1000).toFixed(1) }} s · dibujo {{ tardo }} ms</span>
    <span class="ayuda">rueda: acercar · arrastrar: mover · clic: un edificio · + −: pisos</span>
   </div>
  </div>

  <aside v-if="elegido" class="ficha" :class="{grande}">
   <button class="cerrar" @click="elegido=null" aria-label="Cerrar">×</button>
   <button class="ampliar" @click="grande=!grande" :title="grande?'Volver al tamaño de ficha':'Ver el piso en grande: hasta 42 píxeles por metro'">{{ grande?'Achicar':'Ampliar' }}</button>
   <small>{{ TIPO[elegido.type]||TYPES[elegido.type]?.label||elegido.kind||elegido.type }} · lote {{ elegido.id }}</small>
   <b>{{ elegido.shopName||elegido.name||'Edificio' }}</b>
   <p>{{ elegido.floors }} {{ elegido.floors===1?'piso':'pisos' }} · {{ elegido.rect.w }} × {{ elegido.rect.h }} m · frente al {{ {N:'norte',S:'sur',E:'este',W:'oeste'}[elegido.front]||'—' }}</p>
   <div class="ficha-piso"><canvas ref="piso"></canvas></div>
   <p class="nivel">{{ fichaNivel===0?'Planta baja':'Piso '+fichaNivel }}<template v-if="nivel>=elegido.floors"> (el último: el visor está en la azotea)</template></p>
   <dl v-if="medidas"><dt>Área</dt><dd>{{ medidas.area }} m²</dd><dt>Pasillo</dt><dd :class="{alerta:medidas.pasillo>30}">{{ medidas.pasillo }} %</dd><dt>Muebles</dt><dd>{{ medidas.muebles }}</dd><dt>Puertas</dt><dd>{{ medidas.puertas }}</dd><dt>Ventanas</dt><dd>{{ medidas.ventanas }}</dd></dl>
   <ul class="cuartos"><li v-for="[t,n] in cuartos" :key="t"><span>{{ t }}</span><b>{{ n }}</b></li></ul>
   <div class="alzado-cab"><b>La fachada</b>
    <div class="lados" role="group" aria-label="Lado de la fachada"><button v-for="l in ladosAbiertos" :key="l" :class="{on:l===ladoAlzado}" @click="ladoAlzado=l">{{ LADO[l] }}<small v-if="l===elegido.front"> · frente</small></button></div></div>
   <div class="ficha-piso"><canvas ref="alzado"></canvas></div>
   <p v-if="medidoAlzado" class="alzado-med">
    <template v-if="medidoAlzado.ventanas">{{ medidoAlzado.ventanas }} ventanas arriba de la planta baja: <b :class="{alerta:medidoAlzado.corridas}">{{ medidoAlzado.corridas }} corridas</b><template v-if="medidoAlzado.corridas"> (con borde naranja)</template><template v-if="medidoAlzado.sobreMuro">, {{ medidoAlzado.sobreMuro }} sobre muro</template> · </template>
    vidrio por piso: <span v-for="(v,i) in medidoAlzado.vano" :key="i">{{ i===0?'PB':i }} {{ v }} %<template v-if="i<medidoAlzado.vano.length-1">, </template></span> · alto {{ medidoAlzado.alto }} m</p>
  </aside>
  <aside v-else-if="casa" class="ficha" :class="{grande}">
   <button class="cerrar" @click="casa=null" aria-label="Cerrar">×</button>
   <button class="ampliar" @click="grande=!grande">{{ grande?'Achicar':'Ampliar' }}</button>
   <small>Casa del monte · {{ casa.spec.hogar.label||'vivienda' }}</small>
   <b>{{ casa.direccion?.texto||'Casa' }}</b>
   <p>{{ casa.spec.hogar.levels.length }} {{ casa.spec.hogar.levels.length===1?'piso':'pisos' }} · {{ casa.spec.hogar.W.toFixed(1) }} × {{ casa.spec.hogar.D.toFixed(1) }} m · {{ Math.round(casa.spec.hogar.area) }} m²</p>
   <div class="ficha-piso"><canvas ref="piso"></canvas></div>
   <p class="nivel">{{ casaNivel===0?'Planta baja':'Piso '+casaNivel }}</p>
   <ul class="cuartos uno"><li v-for="(q,i) in casaCuartos" :key="i"><span>{{ q.nombre }}</span><b>{{ q.medida }}</b></li></ul>
  </aside>
 </div>
</template>

<style scoped>
.plano{--tx:#f5f2ea;--tx2:#c3cad6;--tx3:#8e97a6;--panel:rgba(14,20,33,.86);--borde:rgba(255,255,255,.12);--ladron:#ffa94d;--ladron2:#ff7a3d;
 --t:'Bungee',Impact,system-ui,sans-serif;--c:'Rubik Variable','Rubik',system-ui,-apple-system,'Segoe UI',sans-serif;
 position:fixed;inset:0;display:grid;grid-template-rows:auto 1fr;grid-template-columns:1fr auto;background:#1b2530;color:var(--tx);font:13px/1.4 var(--c)}
.barra{grid-column:1/-1;display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:10px 16px;background:var(--panel);border-bottom:1px solid var(--borde)}
.logo{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;font:400 11px var(--t);text-decoration:none;color:#2a1705;background:linear-gradient(135deg,var(--ladron),var(--ladron2));transform:rotate(-4deg)}
.titulo{font:400 16px var(--t);letter-spacing:.5px}
.barra label{display:flex;align-items:center;gap:6px;color:var(--tx2)}
.barra input[type=number]{width:74px;background:rgba(255,255,255,.08);border:1px solid var(--borde);border-radius:8px;color:var(--tx);padding:5px 8px}
.barra button,.jugar{background:rgba(255,255,255,.08);border:1px solid var(--borde);border-radius:8px;color:var(--tx);padding:6px 12px;font:inherit;text-decoration:none;cursor:pointer}
.barra button:hover:not(:disabled),.jugar:hover{background:rgba(255,255,255,.16)}
.barra button:disabled{opacity:.4;cursor:default}
.pisos{display:flex;align-items:center;gap:6px}.pisos span{min-width:88px;text-align:center;font-weight:600}
.pisos button{width:30px;padding:5px 0;font-weight:700}
.capas{display:flex;gap:6px;flex-wrap:wrap}
.capas label{padding:5px 10px;border-radius:99px;border:1px solid var(--borde);cursor:pointer;color:var(--tx3);gap:0}
.capas label.on{background:rgba(255,169,77,.16);border-color:rgba(255,169,77,.5);color:var(--tx)}
.capas input{position:absolute;opacity:0;pointer-events:none}
.capas label:has(:focus-visible){outline:3px solid #ffd166;outline-offset:2px}
.jugar{margin-left:auto;background:linear-gradient(135deg,var(--ladron),var(--ladron2));color:#2a1705;font-weight:600;border:0}
.visor{position:relative;overflow:hidden;cursor:grab;touch-action:none;min-width:0}
.visor.arrastrando{cursor:grabbing}
.visor canvas.base{position:absolute;left:0;top:0;transform-origin:0 0;box-shadow:0 20px 60px rgba(0,0,0,.45)}
.visor canvas.nitido{position:absolute;left:0;top:0;opacity:0;pointer-events:none;transition:opacity .12s}
.visor canvas.nitido.listo{opacity:1}
.estado{position:absolute;inset:0;display:grid;place-items:center;font:400 18px var(--t);color:var(--tx2)}
.pie{position:absolute;left:12px;right:12px;bottom:10px;display:flex;gap:14px;flex-wrap:wrap;pointer-events:none;font-size:12px;color:var(--tx2)}
.pie span{background:var(--panel);border:1px solid var(--borde);border-radius:8px;padding:3px 9px;font-variant-numeric:tabular-nums}
.pie .ayuda{margin-left:auto;color:var(--tx3)}
.ficha{width:min(400px,38vw);overflow:auto;padding:16px;background:var(--panel);border-left:1px solid var(--borde);position:relative}
.ficha.grande{width:min(1100px,74vw)}
.ampliar{position:absolute;right:46px;top:10px;height:28px;border-radius:8px;border:1px solid var(--borde);background:rgba(255,255,255,.08);color:var(--tx);cursor:pointer;font:inherit;padding:0 10px}
.ficha small{color:var(--tx3);text-transform:uppercase;letter-spacing:.8px;font-size:11px}
.ficha>b{display:block;font:400 18px var(--t);margin:2px 0 4px}
.ficha p{margin:0 0 10px;color:var(--tx2)}
.ficha-piso{background:#fbfaf6;border-radius:10px;overflow:hidden}.ficha-piso canvas{display:block;width:100%}
.nivel{margin-top:8px!important;font-weight:600;color:var(--tx)!important}
.ficha dl{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:0 0 12px}
.ficha dt{font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:var(--tx3);grid-row:1}
.ficha dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums;grid-row:2}
.ficha dd.alerta{color:var(--ladron)}
.cuartos{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:4px 14px}
.alzado-cab{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:16px 0 8px}.alzado-cab>b{font:400 14px var(--t)}
.lados{display:flex;gap:4px;flex-wrap:wrap}.lados button{background:rgba(255,255,255,.08);border:1px solid var(--borde);border-radius:8px;color:var(--tx2);padding:3px 9px;font:inherit;font-size:12px;cursor:pointer}
.lados button.on{background:rgba(255,169,77,.18);border-color:rgba(255,169,77,.5);color:var(--tx)}.lados small{color:var(--tx3)}
.alzado-med{margin-top:8px!important;font-size:12px}.alzado-med b.alerta{color:var(--ladron)}
.cuartos.uno{grid-template-columns:1fr}
.cuartos li{display:flex;justify-content:space-between;color:var(--tx2)}.cuartos b{color:var(--tx)}
.cerrar{position:absolute;right:10px;top:10px;width:28px;height:28px;border-radius:8px;border:1px solid var(--borde);background:rgba(255,255,255,.08);color:var(--tx);cursor:pointer;font-size:16px;line-height:1}
@media (max-width:820px){.plano{grid-template-columns:1fr}.ficha{position:absolute;right:0;top:0;bottom:0;width:min(360px,86vw);z-index:3}.pie .ayuda{display:none}}
</style>
