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
import {drawWorldStage,drawFloorPlan,drawHogar,drawElevation,drawColocados,marcoPiso,CAPAS,ROOM_LABEL} from '../lib/drawPlan.js';
import {colocar,OBJETOS,GRILLA} from '../engine/colocar.js';
import {entregaDe} from '../engine/entrega.js';
import {sitiosDe,aparecerEn,cupoDe,poblar,RADIO} from '../engine/aparecer.js';
import {propiedadesDe,resumenDe,CLASE} from '../engine/propiedades.js';
import {CELL,TYPES} from '../engine/blueprint.js';
import {PAQUETES} from '../lib/texturas2d.js';

// EL PRIMER MUNDO (2026-11-21, Miguel: «que la primera ciudad sea Colombia, y por defecto la más grande»): los mundos van
// por país o por idioma, no por ciudad real. Colombia es la ciudad 1 en su tamaño mayor; sin nada en la URL se abre ésa.
const MUNDO={nombre:'Colombia',seed:1,team:16};
const route=useRoute(),router=useRouter();
const seed=ref(Math.max(1,Number(route.query.ciudad)||1)),team=ref(Math.max(2,Number(route.query.jugadores)||MUNDO.team));
const estado=ref('Armando el plano…'),nivel=ref(0),capas=reactive({...CAPAS}),elegido=ref(null),casa=ref(null),cursor=ref(null),tardo=ref(0);
const host=ref(null),lienzo=ref(null),piso=ref(null),nitido=ref(null),nitidoListo=ref(false),escala=ref(0);
let relojNitido=0;
// (la vivienda vacía: lo que se vende es el lugar sin amueblar —engine/entrega.js—; «Amueblado» muestra lo que puso el
// generador, que es lo que comprueba que los cuartos tienen buen tamaño)
const vacias=ref(true),entrega=ref(null);let planoEntero=null;
// (la gente, como puntos, y dónde aparece el próximo —engine/aparecer.js—: el sitio menos poblado. «Entra una persona»
// la suma ahí y recalcula; el cupo es una persona por vivienda)
// (las propiedades —engine/propiedades.js—: cada departamento, local y casa con su área y su precio base)
const propResumen=ref(null);let propiedades=[];const plata=v=>'$ '+Math.round(v).toLocaleString('es-CO');
const propsEdificio=computed(()=>elegido.value&&propResumen.value?propiedades.filter(p=>p.lote===elegido.value.id):[]);
const propCasa=computed(()=>{if(!casa.value||!propResumen.value)return null;const i=planoEntero?.isla?.casas?.indexOf(casa.value);return propiedades.find(p=>p.casa===i)||propiedades.find(p=>p.clase==='casa_monte'&&p.direccion&&p.direccion===casa.value.direccion?.texto)||null;});
const cuanta=ref(0),cupo=ref(0),aparicion=ref(null),verGente=ref(true),capaGente=ref(null);let sitios=[],gente=[];
// (la gente va en su propia capa, en píxeles de pantalla: así un punto se ve igual con la ciudad entera que de cerca, y
// moverla no redibuja el plano)
function dibujarGente(){const c=capaGente.value;if(!c||!host.value)return;const dpr=window.devicePixelRatio||1,w=host.value.clientWidth,h=host.value.clientHeight;if(c.width!==Math.round(w*dpr)||c.height!==Math.round(h*dpr)){c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);}
 const g=c.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);if(!verGente.value||!planoEntero)return;
 const m=celda*vista.k/CELL,sx=x=>vista.x+(x/CELL-origen.x0)*celda*vista.k,sz=z=>vista.y+(z/CELL-origen.y0)*celda*vista.k,r=Math.max(2.6,Math.min(.3*m,7));
 g.fillStyle='#ffd166';g.strokeStyle='rgba(20,16,8,.85)';g.lineWidth=1;for(const p of gente){const x=sx(p.x),y=sz(p.z);if(x<-9||y<-9||x>w+9||y>h+9)continue;g.beginPath();g.arc(x,y,r,0,7);g.fill();g.stroke();}
 const a=aparicion.value;if(a?.ok){const x=sx(a.x),y=sz(a.z),R=Math.max(6,r*1.5);g.fillStyle='rgba(72,219,160,.13)';g.strokeStyle='rgba(72,219,160,.85)';g.lineWidth=1.5;g.beginPath();g.arc(x,y,RADIO*m,0,7);g.fill();g.stroke();
  g.fillStyle='#48dba0';g.strokeStyle='#0b2b1f';g.lineWidth=2;g.beginPath();g.arc(x,y,R,0,7);g.fill();g.stroke();g.beginPath();g.moveTo(x-R*1.8,y);g.lineTo(x+R*1.8,y);g.moveTo(x,y-R*1.8);g.lineTo(x,y+R*1.8);g.stroke();}}
function ponerGente(){if(!planoEntero)return;const a=aparecerEn(planoEntero,gente,{sitios,cupo:cupo.value});aparicion.value=a;cuanta.value=gente.length;dibujarGente();}
function poblarCon(n){if(!planoEntero)return;gente=poblar(planoEntero,Math.max(0,Math.min(cupo.value,n)),seed.value,sitios);ponerGente();}
function entra(n=1){for(let i=0;i<n;i++){const a=aparecerEn(planoEntero,gente,{sitios,cupo:cupo.value});if(!a.ok)break;gente=[...gente,{x:a.x,z:a.z}];}ponerGente();}
function irAparicion(){const a=aparicion.value;if(!a?.ok||!host.value)return;const k=Math.max(vista.k,6/celda*6),w=host.value.clientWidth,h=host.value.clientHeight;vista.k=k;vista.x=w/2-(a.x/CELL-origen.x0)*celda*k;vista.y=h/2-(a.z/CELL-origen.y0)*celda*k;tocado=true;pedirNitido();}
let topeLienzo=0;// (la celda más grande que este navegador pintó bien, si hubo que achicar)
let plano=null,origen={x0:0,y0:0},celda=20,arrastre=null,tocado=false;// (tocado: ya acercó o movió; mientras no, el plano se reajusta al cambiar el tamaño de la ventana)
const vista=reactive({x:0,y:0,k:1});// (la posición y el zoom del lienzo dentro del visor, en píxeles de pantalla)
// (los tamaños de ciudad —engine/ciudad.js SIZES—: los cuatro del juego y dos más grandes, para pasear y para otros juegos)
const TAMANOS=[{team:2,nombre:'Mínima',m:'222 × 168 m'},{team:3,nombre:'Chica',m:'276 × 192 m'},{team:5,nombre:'Mediana',m:'354 × 246 m'},{team:8,nombre:'Grande',m:'444 × 312 m'},{team:12,nombre:'Muy grande',m:'576 × 396 m'},{team:16,nombre:'Enorme',m:'720 × 492 m'}];
const NOMBRE_CAPA={pintura:'Pintura de vías',equipo:'Mobiliario',arboles:'Árboles',nombres:'Nombres de vías',botines:'Botines'};
const TIPO={vivienda:'Vivienda',oficinas:'Oficinas',comercio:'Comercio',hotel:'Hotel',casa:'Casa',local:'Local',colegio:'Colegio',comisaria:'Comisaría',biblioteca:'Biblioteca',hospital:'Hospital',objetivo:'Objetivo',residencial:'Residencial'};

const alzado=ref(null),ladoAlzado=ref(null),medidoAlzado=ref(null),NOMBRE_TEX={ladrillo:'ladrillo a la vista',ladrillo_pintado:'ladrillo pintado',sillar:'sillar de piedra',estuco:'estuco',panel:'panel',hormigon:'hormigón a la vista',tablilla:'tablilla'};
// (el paquete de texturas de las fachadas: se recuerda en este navegador)
const guardado=(()=>{try{return localStorage.getItem('fuga.paquete');}catch{return null;}})(),paquete=ref(PAQUETES[guardado]?guardado:'ciudad');// (sin nada guardado: «Como el 3D»)
watch(paquete,v=>{try{localStorage.setItem('fuga.paquete',v);}catch{}});
const LADO={N:'Norte',S:'Sur',E:'Este',W:'Oeste'};
// (los lados del edificio que dan a algo abierto: una medianera no tiene fachada)
const ladosAbiertos=computed(()=>elegido.value?Object.entries(elegido.value.sides||{}).filter(([,v])=>v!=='medianera'&&v!=='interior').map(([k])=>k):[]);
const maxPisos=ref(0),grande=ref(false);
// COLOCAR OBJETOS (engine/colocar.js): se elige uno, se mueve el ratón sobre el plano del piso y el plano dice dónde
// quedaría —ya acomodado a la grilla y a la pared— y si se puede. Clic lo deja; R gira los de piso. Lo colocado se guarda
// en este navegador, por ciudad, edificio y piso.
const objeto=ref(null),fantasma=ref(null),giroObj=ref(0),colocados=ref((()=>{try{return JSON.parse(localStorage.getItem('fuga.colocados')||'{}');}catch{return {};}})());
const claveCol=computed(()=>elegido.value?`${seed.value}|${team.value}|L${elegido.value.id}|${fichaNivel.value}`:'');
const deEstePiso=computed(()=>colocados.value[claveCol.value]||[]);
const guardarCol=()=>{try{localStorage.setItem('fuga.colocados',JSON.stringify(colocados.value));}catch{}};
function aPiso(e){const L=elegido.value,c=piso.value,r=c.getBoundingClientRect(),{m,ox,oy}=marcoPiso(L,c.clientWidth);return {x:(e.clientX-r.left)/m+ox,z:(e.clientY-r.top)/m+oy};}
function pisoMueve(e){if(!objeto.value||!elegido.value)return;fantasma.value=colocar(elegido.value.levels[fichaNivel.value],aPiso(e),objeto.value,deEstePiso.value,giroObj.value);pintarPiso();}
function pisoClic(e){if(!objeto.value||!elegido.value)return;const r=colocar(elegido.value.levels[fichaNivel.value],aPiso(e),objeto.value,deEstePiso.value,giroObj.value);fantasma.value=r;if(!r.ok){pintarPiso();return;}
 colocados.value={...colocados.value,[claveCol.value]:[...deEstePiso.value,r]};guardarCol();fantasma.value=null;pintarPiso();}
function quitarCol(i){const l=[...deEstePiso.value];l.splice(i,1);colocados.value={...colocados.value,[claveCol.value]:l};guardarCol();pintarPiso();}
function pintarPiso(){const L=elegido.value;if(!L||!piso.value)return;const w=piso.value.parentElement.clientWidth;drawFloorPlan(piso.value,L,{level:fichaNivel.value,stage:9,width:w});drawColocados(piso.value,L,deEstePiso.value,fantasma.value,OBJETOS,{width:w});}// (maxPisos: el plano no es reactivo —es enorme—, así que se anota al cargar)
const resumen=ref(null);

function dibujar(){
 if(!plano||!lienzo.value)return;const t0=performance.now(),dpr=window.devicePixelRatio||1,B=plano.isla.bounds;
 // (la celda más grande que deja el lienzo por debajo de ~4.600 px de lado: más que eso algunos navegadores no lo pintan)
 // (2026-11-21, medido: con la ciudad de 720 m el lienzo de 4.590 px salía sólo con el fondo —sin error—, y uno de 3.240
 // se pintaba bien; el tope bajó a 3.200. Y por si otra máquina aguanta menos: si lo dibujado sale de un solo color, se
 // achica y se vuelve a dibujar. De cerca la nitidez la pone la otra capa, no este lienzo)
 const lado=Math.max(B.x1-B.x0,B.y1-B.y0)*dpr,pinta=()=>{origen=drawWorldStage(lienzo.value,plano,{cell:celda,stage:9,level:nivel.value,dim:false,paquete:paquete.value,capas:{...capas},selected:elegido.value?.id??-1});};
 const enBlanco=()=>{try{const c=lienzo.value,g=c.getContext('2d'),vistos=new Set();for(let i=1;i<12;i++)vistos.add(g.getImageData(Math.floor(c.width*i/12),Math.floor(c.height*(i*5%12+.5)/12),1,1).data.join(','));return vistos.size<2;}catch{return false;}};
 celda=Math.max(4,Math.min(36,topeLienzo?Math.min(topeLienzo,Math.floor(3200/lado)):Math.floor(3200/lado)));pinta();
 while(celda>4&&enBlanco()){celda=Math.max(4,Math.floor(celda*.75));topeLienzo=celda;pinta();}
 lienzo.value.style.width=lienzo.value.width/dpr+'px';lienzo.value.style.height=lienzo.value.height/dpr+'px';
 tardo.value=Math.round(performance.now()-t0);
}
// LA CAPA NÍTIDA: el lienzo de base se dibuja una vez (a ~4 px por metro) y al acercar sólo se estira. Cuando la vista
// se queda quieta un momento, encima se dibuja SÓLO lo que se ve, a la escala de la pantalla (hasta 42 px por metro):
// mientras se arrastra o se gira la rueda se ve la base estirada, y al soltar llega el detalle.
function pedirNitido(){nitidoListo.value=false;clearTimeout(relojNitido);if(!plano)return;escala.value=celda/CELL*vista.k;relojNitido=setTimeout(dibujarNitido,140);}
function dibujarNitido(){
 if(!plano||!host.value||!nitido.value||vista.k<=1.05)return;const t0=performance.now(),dpr=window.devicePixelRatio||1,w=host.value.clientWidth,h=host.value.clientHeight;
 drawWorldStage(nitido.value,plano,{cell:celda*vista.k,stage:9,level:nivel.value,dim:false,paquete:paquete.value,capas:{...capas},selected:elegido.value?.id??-1,region:{x:-vista.x*dpr,y:-vista.y*dpr,w:w*dpr,h:h*dpr}});
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
function tecla(e){if(e.target.tagName==='INPUT')return;if(e.key==='+'||e.key==='=')nivel.value=Math.min(maxPisos.value,nivel.value+1);else if(e.key==='-')nivel.value=Math.max(0,nivel.value-1);else if(e.key==='0')ajustar();else if(e.key==='Escape'){if(objeto.value){objeto.value=null;fantasma.value=null;pintarPiso();}else elegido.value=casa.value=null;}
 else if((e.key==='r'||e.key==='R')&&objeto.value){giroObj.value=giroObj.value?0:GRILLA.giro;pintarPiso();}}

const fichaNivel=computed(()=>elegido.value?Math.min(nivel.value,elegido.value.floors-1):0);
const cuartos=computed(()=>{const L=elegido.value;if(!L)return [];const lv=L.levels[fichaNivel.value],n={};for(const q of lv.rooms){const t=ROOM_LABEL[q.type]||q.type;n[t]=(n[t]||0)+1;}return Object.entries(n).sort((a,b)=>b[1]-a[1]);});
const medidas=computed(()=>{const L=elegido.value;if(!L)return null;const lv=L.levels[fichaNivel.value],area=L.parts.reduce((a,P)=>a+P.w*P.h,0),pas=lv.corridor.filter(q=>!q.ensanche).reduce((a,q)=>a+q.w*q.h,0),ens=lv.corridor.filter(q=>q.ensanche).reduce((a,q)=>a+q.w*q.h,0);
 return {area:Math.round(area),pasillo:Math.round(pas/area*100),ensanche:Math.round(ens/area*100),muebles:lv.furniture.length,puertas:lv.doors.length,ventanas:lv.windows.length};});
const casaNivel=computed(()=>casa.value?Math.min(nivel.value,casa.value.spec.hogar.levels.length-1):0);
const casaCuartos=computed(()=>{const c=casa.value;if(!c)return [];return c.spec.hogar.levels[casaNivel.value].rooms.filter(q=>q.type!=='hall').map(q=>({nombre:q.label||ROOM_LABEL[q.type]||q.type,medida:`${(q.u1-q.u0).toFixed(1)} × ${(q.v1-q.v0).toFixed(1)} m`}));});
async function dibujarPiso(){await nextTick();if(casa.value&&piso.value){drawHogar(piso.value,casa.value.spec.hogar,{level:casaNivel.value,width:piso.value.parentElement.clientWidth,vacia:vacias.value});return;}
 const L=elegido.value;if(!L||!piso.value)return;
 if(alzado.value){const lado=ladosAbiertos.value.includes(ladoAlzado.value)?ladoAlzado.value:L.front;ladoAlzado.value=lado;medidoAlzado.value=drawElevation(alzado.value,L,{width:alzado.value.parentElement.clientWidth,lado,paquete:paquete.value,pintables:true});}
 pintarPiso();}

async function cargar(){
 estado.value='Armando el plano…';elegido.value=null;casa.value=null;plano=null;resumen.value=null;
 router.replace({query:{ciudad:seed.value,jugadores:team.value}});
 const t0=performance.now(),r=await planoDe({seed:seed.value,team:team.value,parks:true});
 if(!r.plano){estado.value='No se pudo armar el plano de esta ciudad.';return;}
 planoEntero=r.plano;const pe=entregaDe(planoEntero);entrega.value=pe.entrega;plano=vacias.value?pe:planoEntero;maxPisos.value=Math.max(...plano.lots.map(L=>L.floors));const V=plano.vegetacion||{};
 resumen.value={edificios:plano.lots.length,casas:plano.isla.casas?.length||0,arboles:(V.arboles?.length||0)+(V.palmeras?.length||0),mobiliario:plano.equipamiento?.length||0,
  muebles:plano.lots.reduce((a,L)=>a+L.levels.slice(0,L.floors).reduce((b,lv)=>b+lv.furniture.length,0),0),ms:Math.round(performance.now()-t0),guardado:r.guardado};
 sitios=sitiosDe(planoEntero);cupo.value=cupoDe(planoEntero).cupo;propiedades=propiedadesDe(planoEntero);propResumen.value=resumenDe(propiedades);
 nivel.value=0;estado.value='';await nextTick();dibujar();ajustar();poblarCon(Math.round(cupo.value*.15));// (de arranque, la ciudad al 15 % de su cupo)
}
watch([nivel,capas,paquete],()=>{dibujar();dibujarPiso();pedirNitido();});
watch(vista,pedirNitido);
watch([vista,verGente],dibujarGente,{deep:true});
watch(vacias,v=>{if(!planoEntero)return;plano=v?entregaDe(planoEntero):planoEntero;if(elegido.value)elegido.value=plano.lots.find(L=>L.id===elegido.value.id)||null;dibujar();dibujarPiso();pedirNitido();});
watch([elegido,casa,grande,ladoAlzado,paquete],dibujarPiso);
watch(elegido,()=>{ladoAlzado.value=null;fantasma.value=null;});
let obs;
onMounted(()=>{cargar();window.addEventListener('keydown',tecla);obs=new ResizeObserver(()=>{if(!plano||arrastre)return;if(!tocado)ajustar();dibujarPiso();pedirNitido();dibujarGente();});obs.observe(host.value);});
onBeforeUnmount(()=>{clearTimeout(relojNitido);window.removeEventListener('keydown',tecla);obs?.disconnect();});
</script>

<template>
 <div class="plano">
  <header class="barra">
   <RouterLink to="/?paso=home" class="logo" title="Volver a las salas">FUGA</RouterLink>
   <b class="titulo">{{ seed===MUNDO.seed&&team===MUNDO.team?MUNDO.nombre:'El plano' }}</b>
   <label>Ciudad <input type="number" min="1" v-model.number="seed" @change="cargar"></label>
   <label title="El tamaño de la ciudad amurallada (la isla crece con ella)">Tamaño <select v-model.number="team" @change="cargar"><option v-for="t in TAMANOS" :key="t.team" :value="t.team">{{ t.nombre }} · {{ t.m }}</option></select></label>
   <div class="pisos" role="group" aria-label="Piso">
    <button :disabled="nivel<=0" @click="nivel--" title="Bajar un piso (−)">−</button>
    <span>{{ nivel===0?'Planta baja':'Piso '+nivel }}</span>
    <button :disabled="nivel>=maxPisos" @click="nivel++" title="Subir un piso (+): arriba del último se ven las azoteas">+</button>
   </div>
   <div class="capas"><label v-for="(n,k) in NOMBRE_CAPA" :key="k" :class="{on:capas[k]}"><input type="checkbox" v-model="capas[k]">{{ n }}</label></div>
   <label class="sel-paquete" title="El paquete de texturas de fachadas y techos">Texturas <select v-model="paquete"><option v-for="(P,k) in PAQUETES" :key="k" :value="k">{{ P.nombre }}</option></select></label>
   <button class="techos" :class="{on:vacias}" @click="vacias=!vacias" :title="vacias?'Las viviendas, como se entregan: sólo el baño y la cocina. Tocá para ver cómo las amuebla el generador.':'Las viviendas amuebladas por el generador. Tocá para verlas vacías, como se entregan.'">{{ vacias?'Viviendas vacías':'Amueblado' }}</button>
   <div class="gente" role="group" aria-label="Gente" title="Cada punto amarillo es una persona. El punto verde es donde aparece la próxima: el sitio del andén con menos gente alrededor (30 m). El cupo es una persona por vivienda.">
    <span><b>{{ cuanta.toLocaleString('es-CO') }}</b> de {{ cupo.toLocaleString('es-CO') }} personas</span>
    <button :disabled="cuanta>=cupo" @click="entra(1)">Entra una</button>
    <button :disabled="cuanta>=cupo" @click="entra(50)">+50</button>
    <button :disabled="!cuanta" @click="poblarCon(0)">Vaciar</button>
    <button :disabled="!aparicion?.ok" @click="irAparicion">Ver dónde aparece</button>
    <button :class="{on:verGente}" @click="verGente=!verGente" title="Mostrar u ocultar los puntos">{{ verGente?'Ocultar':'Mostrar' }}</button>
   </div>
   <button class="techos" :class="{on:nivel>=maxPisos}" @click="nivel=nivel>=maxPisos?0:maxPisos" title="Ver la ciudad desde arriba, con sus techos (o volver a la planta baja)">Techos</button>
   <button class="ajustar" @click="ajustar" title="Ver todo (0)">Ver todo</button>
   <RouterLink class="catalogo" :to="{path:'/catalogo',query:{seccion:'fachadas',ciudad:seed}}" title="Los muebles, las fachadas y las texturas, de a uno">Catálogo</RouterLink>
   <RouterLink class="jugar" :to="{path:'/ciudad',query:{ciudad:seed,jugadores:team,vista:'tercera'}}" title="Esta misma ciudad en 3D: caminar, sobrevolar y ver cómo rinde. La de 720 m abre en unos 14 s.">Entrar en 3D</RouterLink>
  </header>

  <div ref="host" class="visor" :class="{arrastrando:arrastre}" @wheel="rueda" @pointerdown="baja" @pointermove="mueve" @pointerup="sube" @pointerleave="cursor=null">
   <canvas ref="lienzo" class="base" :style="{transform:`translate(${vista.x}px,${vista.y}px) scale(${vista.k})`}"></canvas>
   <canvas ref="nitido" class="nitido" :class="{listo:nitidoListo}"></canvas>
   <canvas ref="capaGente" class="capa-gente"></canvas>
   <div v-if="estado" class="estado">{{ estado }}</div>
   <div class="pie">
    <span v-if="cursor">x {{ cursor.x }} m · z {{ cursor.z }} m</span>
    <span v-if="escala">{{ escala.toFixed(1) }} px por metro</span>
    <span v-if="resumen">{{ resumen.edificios }} edificios · {{ resumen.casas }} casas · {{ resumen.muebles.toLocaleString('es-CO') }} muebles · {{ resumen.arboles.toLocaleString('es-CO') }} árboles · {{ resumen.mobiliario }} de mobiliario</span>
    <span v-if="entrega&&vacias">{{ entrega.viviendas.toLocaleString('es-CO') }} viviendas vacías · {{ entrega.sacados.toLocaleString('es-CO') }} muebles afuera · quedan {{ entrega.quedan.toLocaleString('es-CO') }} de baño y cocina</span>
    <span v-if="propResumen" :title="Object.entries(propResumen.por).map(([c,v])=>`${CLASE[c]}: ${v.n}, de ${plata(v.min)} a ${plata(v.max)}`).join(' · ')">{{ propResumen.n.toLocaleString('es-CO') }} propiedades · {{ propResumen.area.toLocaleString('es-CO') }} m² · {{ plata(propResumen.valor) }}</span>
    <span v-if="aparicion?.ok">aparece en x {{ aparicion.x }} · z {{ aparicion.z }} m{{ aparicion.cerca!=null?' · la persona más cercana, a '+aparicion.cerca+' m':'' }}</span>
    <span v-else-if="aparicion">{{ aparicion.razon }}</span>
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
   <div class="ficha-piso" :class="{colocando:objeto}"><canvas ref="piso" @pointermove="pisoMueve" @pointerdown="pisoClic" @pointerleave="fantasma=null;pintarPiso()"></canvas></div>
   <div class="colocar">
    <b>Colocar</b>
    <div class="paleta"><button v-for="(O,k) in OBJETOS" :key="k" :class="{on:objeto===k}" :title="O.modo==='pared'?`De pared · ${O.ancho} × ${O.alto} m`:`De piso · ${O.w} × ${O.d} m`" @click="objeto=objeto===k?null:k;fantasma=null;pintarPiso()">{{ O.nombre }}<small>{{ O.modo==='pared'?'pared':'piso' }}</small></button></div>
    <p v-if="objeto" class="guia" :class="{mal:fantasma&&!fantasma.ok,bien:fantasma&&fantasma.ok}">
     <template v-if="!fantasma">Mové el ratón sobre el plano: {{ OBJETOS[objeto].modo==='pared'?'se pega a la pared más cercana':'se acomoda a la grilla de 10 cm' }}.<template v-if="OBJETOS[objeto].modo==='piso'"> <kbd>R</kbd> lo gira.</template> <kbd>Esc</kbd> lo suelta.</template>
     <template v-else-if="fantasma.ok">Se puede: clic para dejarlo<template v-if="fantasma.modo==='pared'"> en la pared {{ {N:'norte',S:'sur',E:'este',W:'oeste'}[fantasma.lado] }}, de {{ fantasma.t0.toFixed(2) }} a {{ fantasma.t1.toFixed(2) }} m, a {{ fantasma.altura }} m de alto</template><template v-else> en x {{ fantasma.x.toFixed(2) }} · z {{ fantasma.z.toFixed(2) }} m</template>.</template>
     <template v-else>No se puede: {{ fantasma.razon }}</template></p>
    <ul v-if="deEstePiso.length" class="puestos"><li v-for="(o,i) in deEstePiso" :key="i"><span>{{ OBJETOS[o.tipo]?.nombre }}</span><small>{{ o.modo==='pared'?'pared '+({N:'norte',S:'sur',E:'este',W:'oeste'}[o.lado]):'x '+o.x.toFixed(2)+' · z '+o.z.toFixed(2) }}</small><button @click="quitarCol(i)" :aria-label="'Quitar '+OBJETOS[o.tipo]?.nombre">quitar</button></li></ul>
   </div>
   <div v-if="propsEdificio.length" class="props">
    <b>En venta acá · {{ propsEdificio.length }} {{ propsEdificio.length===1?'propiedad':'propiedades' }} · {{ plata(propsEdificio.reduce((a,p)=>a+p.precio,0)) }}</b>
    <ul><li v-for="p in propsEdificio" :key="p.id" :class="{on:p.piso===fichaNivel}" :title="`${p.id} · clase ×${p.factores.clase} · centro ×${p.factores.centro} · piso ×${p.factores.piso} · parque ×${p.factores.parque}`"><span>{{ p.nombre }}<small>{{ p.piso===0?'planta baja':'piso '+p.piso }}<template v-if="p.dormitorios"> · {{ p.dormitorios }} dorm.</template></small></span><i>{{ p.area.toFixed(1) }} m²</i><b>{{ plata(p.precio) }}</b></li></ul>
    <small v-if="propsEdificio[0].direccion">{{ propsEdificio[0].direccion }} · precio base: área × 1.000 × clase × centro × piso × parque</small>
   </div>
   <p class="nivel">{{ fichaNivel===0?'Planta baja':'Piso '+fichaNivel }}<template v-if="nivel>=elegido.floors"> (el último: el visor está en la azotea)</template></p>
   <dl v-if="medidas"><dt>Área</dt><dd>{{ medidas.area }} m²</dd><dt>Pasillo</dt><dd :class="{alerta:medidas.pasillo>30}">{{ medidas.pasillo }} %</dd><template v-if="medidas.ensanche"><dt>Ensanche</dt><dd :class="{alerta:medidas.ensanche>25}" title="El tramo sin luz de un piso de departamentos: es más pasillo, decorado, y no cuartos">{{ medidas.ensanche }} %</dd></template><dt>Muebles</dt><dd>{{ medidas.muebles }}</dd><dt>Puertas</dt><dd>{{ medidas.puertas }}</dd><dt>Ventanas</dt><dd>{{ medidas.ventanas }}</dd></dl>
   <ul class="cuartos"><li v-for="[t,n] in cuartos" :key="t"><span>{{ t }}</span><b>{{ n }}</b></li></ul>
   <div class="alzado-cab"><b>La fachada</b>
    <div class="lados" role="group" aria-label="Lado de la fachada"><button v-for="l in ladosAbiertos" :key="l" :class="{on:l===ladoAlzado}" @click="ladoAlzado=l">{{ LADO[l] }}<small v-if="l===elegido.front"> · frente</small></button></div></div>
   <div class="paquetes" role="group" aria-label="Paquete de texturas"><span>Texturas</span><button v-for="(P,k) in PAQUETES" :key="k" :class="{on:k===paquete}" :title="P.nota" @click="paquete=k">{{ P.nombre }}</button><small>{{ PAQUETES[paquete].nota }}</small></div>
   <div class="ficha-piso"><canvas ref="alzado"></canvas></div>
   <p class="alzado-mat">{{ {ladrillo:'Ladrillo',piedra:'Piedra',metal:'Metal y concreto'}[elegido.fachada?.familia]||'—' }} · pintura {{ elegido.fachada?.pintura||'natural' }} · moldura {{ elegido.fachada?.moldura||'—' }} · techo {{ elegido.fachada?.techo==='mansarda'?'de mansarda':'plano' }}<template v-if="elegido.fachada?.balcones"> · balcones</template><template v-if="elegido.fachada?.toldos&&elegido.fachada.toldos!=='no'"> · toldos {{ elegido.fachada.toldos }}</template></p>
   <p v-if="medidoAlzado?.textura" class="alzado-med">Muro de <b>{{ NOMBRE_TEX[medidoAlzado.textura]||medidoAlzado.textura }}</b> en el 3D<template v-if="medidoAlzado.hiladas"> · {{ medidoAlzado.hiladas }} hiladas por piso</template> · {{ medidoAlzado.modulos }} módulos de 2 m ·
    <template v-if="medidoAlzado.pintables.length"><b style="color:#48dba0">{{ medidoAlzado.pintables.length }} {{ medidoAlzado.pintables.length===1?'paño pintable':'paños pintables' }}</b> (en verde): {{ medidoAlzado.pintables.map(p=>p.ancho+' × '+p.alto+' m').join(', ') }}</template><template v-else>sin paños pintables de este lado</template></p>
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
   <p v-if="propCasa" class="precio-casa" :title="propCasa.id">En venta · <b>{{ plata(propCasa.precio) }}</b> · {{ propCasa.area.toFixed(0) }} m² · {{ propCasa.cuartos }} cuartos</p>
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
.barra label select{background:rgba(255,255,255,.08);border:1px solid var(--borde);border-radius:8px;color:var(--tx);padding:5px 8px;font:inherit}.barra label option{color:#1b2130}
.barra input[type=number]{width:74px;background:rgba(255,255,255,.08);border:1px solid var(--borde);border-radius:8px;color:var(--tx);padding:5px 8px}
.sel-paquete select{background:rgba(255,255,255,.08);border:1px solid var(--borde);border-radius:8px;color:var(--tx);padding:5px 8px;font:inherit}.sel-paquete option{color:#1b2130}
.barra button.techos.on{background:rgba(255,169,77,.18);border-color:rgba(255,169,77,.5)}
.catalogo{color:var(--tx);text-decoration:none;border:1px solid var(--borde);border-radius:8px;padding:6px 12px;background:rgba(255,255,255,.08);margin-left:auto}.catalogo+.jugar{margin-left:0}
.barra button,.jugar{background:rgba(255,255,255,.08);border:1px solid var(--borde);border-radius:8px;color:var(--tx);padding:6px 12px;font:inherit;text-decoration:none;cursor:pointer}
.barra button:hover:not(:disabled),.jugar:hover{background:rgba(255,255,255,.16)}
.barra button:disabled{opacity:.4;cursor:default}
.pisos{display:flex;align-items:center;gap:6px}.pisos span{min-width:88px;text-align:center;font-weight:600}
.pisos button{width:30px;padding:5px 0;font-weight:700}
.capas{display:flex;gap:6px;flex-wrap:wrap}
.gente{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:3px 8px;border:1px solid rgba(72,219,160,.35);border-radius:10px}
.gente span{color:var(--tx3);font-size:13px}.gente b{color:#ffd166}
.gente button{padding:5px 9px;border-radius:8px;border:1px solid var(--borde);background:transparent;color:var(--tx);cursor:pointer;font:inherit;font-size:13px}
.gente button:disabled{opacity:.4;cursor:default}
.props{margin:10px 0;padding:10px;border:1px solid rgba(255,209,102,.3);border-radius:10px;background:rgba(255,209,102,.05)}
.props>b{display:block;margin-bottom:6px;color:#ffd166;font-size:13px}
.props ul{list-style:none;margin:0;padding:0;max-height:210px;overflow:auto}
.props li{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:baseline;padding:3px 4px;border-radius:6px;font-size:13px}
.props li.on{background:rgba(255,255,255,.07)}
.props li small{color:var(--tx3);margin-left:6px}
.props li i{font-style:normal;color:var(--tx2)}
.props>small{display:block;margin-top:6px;color:var(--tx3);font-size:11px}
.precio-casa{color:var(--tx2)}.precio-casa b{color:#ffd166}
.capa-gente{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
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
.ficha dl{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:6px;margin:0 0 12px}
.ficha dt{font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:var(--tx3);grid-row:1}
.ficha dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums;grid-row:2}
.ficha dd.alerta{color:var(--ladron)}
.cuartos{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:4px 14px}
.ficha-piso.colocando canvas{cursor:crosshair}
.colocar{margin:10px 0 4px}.colocar>b{font:400 14px var(--t)}
.paleta{display:flex;gap:5px;flex-wrap:wrap;margin:6px 0}
.paleta button{background:rgba(255,255,255,.08);border:1px solid var(--borde);border-radius:8px;color:var(--tx2);padding:4px 9px;font:inherit;font-size:12px;cursor:pointer;display:flex;gap:6px;align-items:baseline}
.paleta button small{color:var(--tx3);font-size:10px;text-transform:uppercase;letter-spacing:.5px}.paleta button.on{background:rgba(255,169,77,.18);border-color:rgba(255,169,77,.55);color:var(--tx)}
.guia{margin:0 0 8px!important;font-size:12.5px;color:var(--tx2)!important}.guia.bien{color:#5fd68f!important}.guia.mal{color:#ff8a7a!important}
.guia kbd{background:#f5f2ea;color:#1b2130;border-radius:5px;padding:0 5px;font:600 11px/1.5 var(--c)}
.puestos{list-style:none;margin:0 0 8px;padding:0;display:grid;gap:3px;font-size:12px}.puestos li{display:flex;gap:8px;align-items:baseline}.puestos small{color:var(--tx3);flex:1}
.puestos button{background:none;border:0;color:var(--tx3);cursor:pointer;font:inherit;text-decoration:underline;padding:0}
.alzado-cab{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:16px 0 8px}.alzado-cab>b{font:400 14px var(--t)}
.lados{display:flex;gap:4px;flex-wrap:wrap}.lados button{background:rgba(255,255,255,.08);border:1px solid var(--borde);border-radius:8px;color:var(--tx2);padding:3px 9px;font:inherit;font-size:12px;cursor:pointer}
.lados button.on{background:rgba(255,169,77,.18);border-color:rgba(255,169,77,.5);color:var(--tx)}.lados small{color:var(--tx3)}
.paquetes{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin:0 0 8px;font-size:12px}.paquetes span{color:var(--tx3);text-transform:uppercase;letter-spacing:.7px;font-size:10px;margin-right:2px}
.paquetes button{background:rgba(255,255,255,.08);border:1px solid var(--borde);border-radius:8px;color:var(--tx2);padding:3px 10px;font:inherit;cursor:pointer}.paquetes button.on{background:rgba(255,169,77,.18);border-color:rgba(255,169,77,.5);color:var(--tx)}
.paquetes small{color:var(--tx3);flex-basis:100%}.alzado-mat{margin:6px 0 0!important;font-size:12px;color:var(--tx3)!important}
.alzado-med{margin-top:8px!important;font-size:12px}.alzado-med b.alerta{color:var(--ladron)}
.cuartos.uno{grid-template-columns:1fr}
.cuartos li{display:flex;justify-content:space-between;color:var(--tx2)}.cuartos b{color:var(--tx)}
.cerrar{position:absolute;right:10px;top:10px;width:28px;height:28px;border-radius:8px;border:1px solid var(--borde);background:rgba(255,255,255,.08);color:var(--tx);cursor:pointer;font-size:16px;line-height:1}
@media (max-width:820px){.plano{grid-template-columns:1fr}.ficha{position:absolute;right:0;top:0;bottom:0;width:min(360px,86vw);z-index:3}.pie .ayuda{display:none}}
</style>
