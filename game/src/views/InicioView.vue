<script setup>
// El recorrido de entrada al juego, prototipo (2026-10-17, Miguel: «cómo alguien se loguea —Google o Steam simulado—, cae
// en un Home con las salas abiertas, puede crear un mundo, verlo, ponerle nombre y esperar a que la gente se una»).
// Todo simulado, para calibrar el diseño antes de hacerlo de verdad:
//  1. título: FUGA y «Entrar»;
//  2. entrar: con Steam (la principal: el juego va para Steam, donde no hay login —Steam ya sabe quién sos y FUGA pide
//     permiso una vez—) o con Google (para la versión web);
//  3. perfil (la primera vez): el nombre que ven los demás, el aspecto (piel, pelo, barba: lo que sale en un retrato) y
//     cómo se ve de cada bando —la partida lo pone de ladrón o de policía—: la ropa de calle (prenda y color por parte
//     del cuerpo) y el uniforme (con o sin gorra). El juego (/demo) sale con ese muñeco;
//  4. Home: las salas abiertas (mundo, jugadores por bando, estado), «Jugar rápido» y «Crear mundo»;
//  5. crear mundo: el nombre, el tamaño, la ciudad (el plano de verdad del generador, con «Otra ciudad») y si es pública;
//  6. la sala de espera: el mundo, los dos bandos con sus lugares, elegir bando, «Listo», el chat; la gente se va
//     uniendo (simulada) y, cuando todos están listos, una cuenta atrás lleva al juego (/demo con esa ciudad y ese papel).
// ?paso=titulo|home|crear|sala (para volver directo a una pantalla mientras se itera)
import {ref,reactive,computed,watch,nextTick,onMounted,onBeforeUnmount} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import MunecoVista from '../components/MunecoVista.vue';
import MiniMapa from '../components/MiniMapa.vue';
import '@fontsource/bungee/400.css';
import '@fontsource-variable/rubik';
import {generateBlueprint} from '../engine/blueprint.js';
import {drawWorldStage} from '../lib/drawPlan.js';
import {SIZES} from '../lib/core.js';
import {City} from '../engine/index.js';
import {JUEGO} from '../engine/medidas.js';
import {sociedadDe} from '../engine/sociedad.js';
import {COLORS} from '../engine/vestuario.js';
import {SECCIONES,CONTROLES,LO_BASICO} from '../lib/reglasJuego.js';
import {GARMENTS,PALETTE} from '../lib/vestier3d.js';
import {uniformeDe} from '../lib/characters3d.js';
import {precargar} from '../lib/mapasGuardados.js';

const route=useRoute(),router=useRouter();
const PASOS=['titulo','entrar','perfil','home','crear','sala','reglas'];
const seccion=ref('juego'),volverDe=ref('home');function verReglas(desde,s='juego'){volverDe.value=desde;seccion.value=s;paso.value='reglas';}
const paso=ref(PASOS.includes(route.query.paso)?route.query.paso:'titulo');
watch(paso,p=>router.replace({query:{...route.query,paso:p}}));
// ---------- la cuenta (simulada; se recuerda en esta pestaña) ----------
const guardado=(()=>{try{return JSON.parse(sessionStorage.getItem('fuga:cuenta')||'null');}catch{return null;}})();
const cuenta=reactive(guardado||{conectado:false,via:null,nombre:'',avatar:'',cuerpo:{piel:'media',pelo:'castaño',peinado:'pelo:Casual2_Male',barba:''}});
const guardar=()=>{try{sessionStorage.setItem('fuga:cuenta',JSON.stringify(cuenta));}catch{}};
// (la ropa de cada bando: la de calle se elige; el uniforme es fijo, salvo la gorra)
if(!cuenta.ropa)cuenta.ropa={calle:{top:{id:'camiseta',color:'#3a9a96'},bottom:{id:'jean',color:'#2b3d5c'},shoes:{id:'tenis',color:'#f2f0ea'},outer:null,hat:null},gorra:true};
if(['home','crear','sala','reglas'].includes(paso.value)&&!cuenta.conectado)Object.assign(cuenta,{conectado:true,via:'steam',nombre:'Miguel',avatar:'M'});
const conectando=ref(null);// (la ventana de permiso simulada: 'steam' | 'google')
function entrarCon(via){conectando.value=via;}
function autorizar(){const via=conectando.value;conectando.value=null;Object.assign(cuenta,{conectado:true,via,nombre:via==='steam'?'Miguel':'Miguel Ochoa',avatar:'M'});guardar();paso.value=guardado?.perfilListo?'home':'perfil';}
function salir(){Object.assign(cuenta,{conectado:false,via:null,perfilListo:false});guardar();paso.value='titulo';}
const PIELES=Object.keys(COLORS.piel),PELOS=Object.keys(COLORS.pelo),PEINADOS=[['pelo:Casual2_Male','Corto'],['pelo:Casual_Male','Despeinado'],['pelo:Casual3_Male','Ondulado'],['pelo:Casual_Female','Largo'],['pelo:Casual2_Female','Melena'],['','Rapado']];
const vistaPerfil=ref('calle'),slotSel=ref('top');
const PARTES_ROPA=[['top','Arriba'],['outer','Encima'],['bottom','Abajo'],['shoes','Calzado'],['hat','Cabeza']];
const prendasDe=slot=>GARMENTS.filter(g=>g.slot===slot&&g.id!=='delantal');
const ropaPerfil=computed(()=>vistaPerfil.value==='policia'?uniformeDe({gorra:cuenta.ropa.gorra}):{underwear:{id:'boxer',color:'#343d50'},...Object.fromEntries(Object.entries(cuenta.ropa.calle).filter(([,p])=>p))});
function elegirPrenda(slot,id){const r=cuenta.ropa.calle;if(!id){if(slot==='outer'||slot==='hat')r[slot]=null;return;}r[slot]={id,color:r[slot]?.color||PALETTE[3]};if(id==='vestido')r.bottom=null;}
function elegirColor(slot,c){const r=cuenta.ropa.calle;if(r[slot])r[slot]={...r[slot],color:c};}
watch(cuenta,guardar,{deep:true});// (el perfil se guarda al cambiarlo)
function perfilListo(){if(!cuenta.nombre.trim())return;cuenta.perfilListo=true;guardar();paso.value='home';}
// ---------- las salas abiertas (simuladas) ----------
const NOMBRES_SALA=['Atraco en el puerto','Noche en Montecarlo','Los de la colina','Patrulla nocturna','Sólo amigos','Fuga del mercado'];
const ALIAS=['LaSombra','Pirata77','Nico_FX','Vale.mp4','ElCapi','Juanchito','Rata_de_azotea','Sargento_Mora','Kami','Tavo','LunaRoja','Don_Pepe','Sofi_22','Dr.Fuga','Gato_negro','Mateo10'];
// (2026-10-17: el análisis de City no aprueba ninguna ciudad con parques —0 de 59—; /demo por eso cae siempre en la 1. Acá:
// se prueban unas pocas y, si ninguna pasa, una al azar)
const ciudadValida=t=>{for(let i=0;i<12;i++){const s=1+Math.floor(Math.random()*99999);if(City.analyze(City.generate({seed:s,team:t,parks:JUEGO.parques})).ok)return s;}return 1+Math.floor(Math.random()*99999);};
const r0=Math.random;
const salas=ref(NOMBRES_SALA.slice(0,5).map((nombre,i)=>{const n=[3,5,2,8,3][i],l=Math.min(n,Math.floor(r0()*(n+1))),p=Math.min(n,Math.floor(r0()*(n+1)));
 return {id:'s'+i,nombre,anfitrion:ALIAS[i*3%ALIAS.length],equipo:n,ladrones:l,policias:p,ciudad:1000+Math.floor(r0()*90000),estado:i===2?'en partida':'esperando',region:['Bogotá','Medellín','Lima','Ciudad de México','Bogotá'][i],ping:[24,41,88,120,30][i],privada:i===4};}));
// ---------- las salas de prueba (2026-10-18, Miguel: «mapas precargados donde en la sala lo único que falte sea un
// jugador: una sala a la que sólo le falta un policía y otra un ladrón») ----------
// Su ciudad se arma una vez, en segundo plano, y queda guardada en IndexedDB (mapasGuardados.js): al entrar, el juego no
// la vuelve a armar. Al unirse, el que entra ocupa el lugar que falta, todos están listos y la cuenta es corta.
const PRUEBAS=[{id:'p-policia',nombre:'Sala de prueba · falta un policía',prueba:'policia',ciudad:1,ladrones:3,policias:2},{id:'p-ladron',nombre:'Sala de prueba · falta un ladrón',prueba:'ladron',ciudad:2,ladrones:2,policias:3}]
 .map(s=>({...s,anfitrion:'FUGA',equipo:3,estado:'esperando',region:'en esta máquina',ping:0}));
salas.value.unshift(...PRUEBAS);
const mapaEstado=reactive({});// (ciudad → 'armando' | 'listo' | 'error')
let precargado=false;function precargarPruebas(){if(precargado)return;precargado=true;precargar(PRUEBAS.map(s=>({seed:s.ciudad,team:s.equipo,parks:true})),(a,e)=>{mapaEstado[a.seed]=e;});}
function armarPrueba(s){clearInterval(llegadas);clearInterval(cuentaT);sala.cuenta=null;sala.chat=[];sala.prueba=s.prueba;const usados=new Set(),alias=()=>{let a;do a=ALIAS[Math.floor(Math.random()*ALIAS.length)];while(usados.has(a));usados.add(a);return a;};
 sala.jugadores=[...Array.from({length:s.ladrones},()=>({nombre:alias(),bando:'ladron',listo:true})),...Array.from({length:s.policias},()=>({nombre:alias(),bando:'policia',listo:true}))];
 decir('FUGA',`Sala de prueba: faltabas vos de ${s.prueba==='policia'?'policía':'ladrón'}. Arranca en un momento.`);
 sala.jugadores.push({nombre:cuenta.nombre,bando:s.prueba,listo:true,yo:true});}
// (2026-10-18, el rediseño: la lista de salas con filtro —todas, con lugar o un tamaño— y orden —más llenas o menos
// ping—, como los navegadores de servidores; los cupos de cada bando en puntos y el ping en barras)
const filtro=ref('todas'),orden=ref('llenas');
const salasVista=computed(()=>{let L=[...salas.value];if(filtro.value==='lugar')L=L.filter(s=>s.estado==='esperando'&&!s.privada&&s.ladrones+s.policias<s.equipo*2);else if(filtro.value!=='todas')L=L.filter(s=>s.equipo===+filtro.value);
 const k=s=>s.prueba?0:s.estado==='esperando'&&!s.privada&&s.ladrones+s.policias<s.equipo*2?1:2;/* (las de prueba arriba; las que no se pueden unir, al final) */return L.sort((a,b)=>k(a)-k(b)||(orden.value==='ping'?a.ping-b.ping:(b.ladrones+b.policias)/b.equipo-(a.ladrones+a.policias)/a.equipo));});
const puntos=(n,de)=>Array.from({length:de},(_,i)=>i<n);
const barras=ms=>ms<=40?4:ms<=80?3:ms<=130?2:1;
const abiertas=computed(()=>salas.value.filter(s=>s.estado==='esperando'&&!s.privada));
function unirse(s){sala.nombre=s.nombre;sala.equipo=s.equipo;sala.ciudad=s.ciudad;sala.anfitrion=s.anfitrion;sala.mia=false;sala.publica=!s.privada;sala.prueba=null;if(s.prueba)armarPrueba(s);else armarSala(s.ladrones,s.policias);paso.value='sala';}
function jugarRapido(){const s=[...abiertas.value.filter(s=>!s.prueba)].sort((a,b)=>(b.ladrones+b.policias)/b.equipo-(a.ladrones+a.policias)/a.equipo)[0];if(s)unirse(s);}
// ---------- crear mundo ----------
const nuevo=reactive({nombre:'',equipo:3,ciudad:0,publica:true,cargando:false,datos:null});
const plano=ref(null);
async function otraCiudad(){nuevo.cargando=true;await nextTick();await new Promise(r=>setTimeout(r,30));nuevo.ciudad=ciudadValida(nuevo.equipo);await dibujarCiudad();nuevo.cargando=false;}
async function dibujarCiudad(){const bp=generateBlueprint({seed:nuevo.ciudad,team:nuevo.equipo});const S=sociedadDe(bp);
 nuevo.datos={edificios:bp.lots.length,casas:bp.isla?.casas?.length||0,habitantes:S.personas.length,hogares:S.hogares.size,lugares:[...S.lugares.values()].filter(l=>l.lote!=null).length,objetivos:(bp.botines||[]).length};
 await nextTick();if(plano.value)drawWorldStage(plano.value,bp,{cell:2,stage:3,fronts:false});}
watch(()=>nuevo.equipo,()=>{if(paso.value==='crear')otraCiudad();});
watch(paso,p=>{if(p==='crear'&&!nuevo.ciudad)otraCiudad();else if(p==='crear')nextTick(dibujarCiudad);if(p==='sala')nextTick(dibujarSala);});
function crearMundo(){sala.nombre=nuevo.nombre.trim()||`El mundo de ${cuenta.nombre}`;sala.equipo=nuevo.equipo;sala.ciudad=nuevo.ciudad;sala.anfitrion=cuenta.nombre;sala.mia=true;sala.publica=nuevo.publica;
 sala.codigo=nuevo.publica?'':Math.random().toString(36).slice(2,7).toUpperCase();armarSala(0,0);paso.value='sala';}
// ---------- la sala de espera ----------
const sala=reactive({prueba:null,nombre:'',equipo:3,ciudad:1,anfitrion:'',mia:false,publica:true,codigo:'',jugadores:[],chat:[],cuenta:null});
const planoSala=ref(null);let llegadas=0,cuentaT=0;
const yo=computed(()=>sala.jugadores.find(j=>j.yo));
const bando=b=>sala.jugadores.filter(j=>j.bando===b);
const lleno=b=>bando(b).length>=sala.equipo;
function armarSala(l,p){clearInterval(llegadas);clearInterval(cuentaT);sala.cuenta=null;sala.chat=[];const usados=new Set();const alias=()=>{let a;do a=ALIAS[Math.floor(Math.random()*ALIAS.length)];while(usados.has(a)&&usados.size<ALIAS.length);usados.add(a);return a;};
 sala.jugadores=[...Array.from({length:l},()=>({nombre:alias(),bando:'ladron',listo:Math.random()<.5})),...Array.from({length:p},()=>({nombre:alias(),bando:'policia',listo:Math.random()<.5}))];
 const lado=bando('ladron').length<=bando('policia').length?'ladron':'policia';sala.jugadores.push({nombre:cuenta.nombre,bando:lleno(lado)?(lado==='ladron'?'policia':'ladron'):lado,listo:false,yo:true,anfitrion:sala.mia});
 decir('FUGA',sala.mia?`Creaste «${sala.nombre}». ${sala.publica?'Sale en las salas abiertas':'Es privada: pasá el código '+sala.codigo}.`:`Te uniste a «${sala.nombre}».`);
 // (la gente se va uniendo: uno cada pocos segundos, al bando que tenga lugar; algunos dicen algo)
 llegadas=setInterval(()=>{const libres=['ladron','policia'].filter(b=>!lleno(b));if(!libres.length){clearInterval(llegadas);return;}const b=libres[Math.floor(Math.random()*libres.length)],n=alias();sala.jugadores.push({nombre:n,bando:b,listo:false});
  decir('FUGA',`${n} se unió a ${b==='ladron'?'los ladrones':'la policía'}.`);setTimeout(()=>{const j=sala.jugadores.find(j=>j.nombre===n);if(j)j.listo=true;},1500+Math.random()*4000);
  if(Math.random()<.4)setTimeout(()=>decir(n,['¿Quién va de policía?','Yo me sé las azoteas 😎','Esta ciudad tiene monte, ojo','Listo cuando quieran','Hagan bulla en la joyería, yo voy por el banco','No me roben la patrulla'][Math.floor(Math.random()*6)]),800);},2200);
 for(const j of sala.jugadores)if(!j.yo&&!j.listo)setTimeout(()=>{j.listo=true;},2000+Math.random()*5000);}
function decir(quien,texto){sala.chat.push({quien,texto,id:Math.random()});if(sala.chat.length>40)sala.chat.shift();}
const msj=ref('');function enviar(){const t=msj.value.trim();if(!t)return;decir(cuenta.nombre,t);msj.value='';}
function cambiarBando(b){if(!yo.value||yo.value.bando===b||lleno(b))return;yo.value.bando=b;yo.value.listo=false;}
function listo(){if(yo.value)yo.value.listo=!yo.value.listo;}
const todosListos=computed(()=>sala.jugadores.length===sala.equipo*2&&sala.jugadores.every(j=>j.listo));
watch(todosListos,v=>{clearInterval(cuentaT);if(!v){sala.cuenta=null;return;}sala.cuenta=sala.prueba?3:5;cuentaT=setInterval(()=>{sala.cuenta--;if(sala.cuenta<=0){clearInterval(cuentaT);entrar();}},1000);});
function entrar(){const q={ciudad:sala.ciudad,jugadores:sala.equipo};if(yo.value?.bando==='policia')q.papel='policia';router.push({path:'/juego',query:q});}
function dejarSala(){clearInterval(llegadas);clearInterval(cuentaT);paso.value='home';}
async function dibujarSala(){if(!planoSala.value)return;const bp=generateBlueprint({seed:sala.ciudad,team:sala.equipo});drawWorldStage(planoSala.value,bp,{cell:2,stage:3,fronts:false});}
if(paso.value==='sala'&&!sala.jugadores.length){const s=abiertas.value[0];if(s){unirse(s);}}
onMounted(()=>{precargarPruebas();if(paso.value==='crear')otraCiudad();if(paso.value==='sala')nextTick(dibujarSala);if(import.meta.env.DEV)window.__inicio={paso,cuenta,sala,salas,nuevo,mapaEstado,unirse,crearMundo,autorizar,entrarCon};});
onBeforeUnmount(()=>{clearInterval(llegadas);clearInterval(cuentaT);});
const fmt=n=>n.toLocaleString('es-CO');
</script>

<template>
 <div class="inicio" :class="['p-'+paso]">
  <!-- el fondo: la ciudad del juego (capturas del 3D, public/fondos), con un velo para que el texto se lea -->
  <div class="fondo" :class="paso==='titulo'||paso==='entrar'?'noche':'costa'" aria-hidden="true"></div>
  <div class="velo-fondo" aria-hidden="true"></div>

  <!-- ============ 1. EL TÍTULO ============ -->
  <section v-if="paso==='titulo'" class="titulo">
   <div class="sirena" aria-hidden="true"><i class="r"></i><i class="a"></i></div>
   <div class="marca"><h1 aria-label="FUGA"><span>F</span><span>U</span><span>G</span><span>A</span></h1><p>Ladrones y policías en una ciudad que vive sola.</p></div>
   <div class="botones-titulo">
    <button class="cta" @click="paso=cuenta.conectado?'home':'entrar'">{{ cuenta.conectado?`Seguir como ${cuenta.nombre}`:'Entrar' }}<small v-if="cuenta.conectado">a las salas</small></button>
    <button class="fantasma" @click="verReglas('titulo')">Cómo se juega</button>
   </div>
   <small class="ver">prototipo · {{ new Date().getFullYear() }}</small>
  </section>

  <!-- ============ 2. ENTRAR ============ -->
  <section v-if="paso==='entrar'" class="panel entrar">
   <h2 class="titular">Entrar</h2>
   <p class="nota">Tu cuenta guarda tu nombre, tu aspecto y tus partidas.</p>
   <button class="cuenta steam" @click="entrarCon('steam')"><span class="ico">S</span>Continuar con Steam<small>recomendado</small></button>
   <button class="cuenta google" @click="entrarCon('google')"><span class="ico">G</span>Continuar con Google</button>
   <p class="nota chica">En Steam no vas a ver esta pantalla: el juego ya sabe quién sos. Esto es para la versión web.</p>
   <button class="link" @click="paso='titulo'">Volver</button>
  </section>
  <div v-if="conectando" class="velo" role="dialog" aria-modal="true" aria-label="Permiso de la cuenta">
   <div class="permiso" :class="conectando">
    <header><span class="ico">{{ conectando==='steam'?'S':'G' }}</span>{{ conectando==='steam'?'Steam':'Google' }}</header>
    <p><b>FUGA</b> quiere usar tu {{ conectando==='steam'?'nombre de Steam y tu lista de amigos':'nombre y tu foto de perfil' }}.</p>
    <div class="quien"><span class="avatar">M</span><div><b>{{ conectando==='steam'?'Miguel':'Miguel Ochoa' }}</b><small>{{ conectando==='steam'?'cuenta de Steam (simulada)':'cuenta de Google (simulada)' }}</small></div></div>
    <div class="botones"><button class="link" @click="conectando=null">Cancelar</button><button class="cta peq" @click="autorizar">Permitir</button></div>
   </div>
  </div>

  <!-- ============ barra de arriba (con cuenta) ============ -->
  <header v-if="['home','crear','sala','reglas','perfil'].includes(paso)&&cuenta.conectado&&(paso!=='perfil'||cuenta.perfilListo)" class="barra">
   <button class="logo" @click="paso='home'" aria-label="FUGA, a las salas">FUGA</button>
   <nav><button :class="{on:paso==='home'}" @click="paso='home'">Salas</button><button :class="{on:paso==='reglas'}" @click="verReglas(paso==='reglas'?volverDe:paso)">Cómo se juega</button><button :class="{on:paso==='perfil'}" @click="paso='perfil'">Perfil</button></nav>
   <div class="yo"><span class="avatar">{{ cuenta.nombre.slice(0,1) }}</span><div><b>{{ cuenta.nombre }}</b><small>{{ cuenta.via==='google'?'Google':'Steam' }}</small></div><button class="link" @click="salir">Salir</button></div>
  </header>

  <!-- ============ 3. EL PERFIL ============ -->
  <section v-if="paso==='perfil'" class="perfil">
   <div class="escenario">
    <div class="vista"><MunecoVista :cuerpo="cuenta.cuerpo" :ropa="ropaPerfil" /><div class="pedestal" aria-hidden="true"></div></div>
    <div class="selector-bando" role="group" aria-label="Cómo te ves"><button class="ladron" :class="{on:vistaPerfil==='calle'}" @click="vistaPerfil='calle'">De civil · ladrón</button><button class="policia" :class="{on:vistaPerfil==='policia'}" @click="vistaPerfil='policia'">De policía</button></div>
    <p class="nota chica">La partida te pone de ladrón o de policía: tu muñeco es el mismo, con la ropa de ese bando.</p>
   </div>
   <div class="panel opciones">
    <h2 class="titular">Tu perfil</h2>
    <label class="campo"><span>Cómo te ven los demás</span><input v-model="cuenta.nombre" maxlength="20" placeholder="Tu nombre" /></label>
    <p class="nota">Tu aspecto es el mismo en los dos bandos. La piel, el pelo y la barba no se cambian en la partida: son lo que sale en un retrato. La ropa sí.</p>
    <div class="grupo">
     <div class="fila"><span>Piel</span><div class="muestras"><button v-for="p in PIELES" :key="p" :aria-label="p" :class="{on:cuenta.cuerpo.piel===p}" :style="{background:COLORS.piel[p]}" @click="cuenta.cuerpo.piel=p"></button></div></div>
     <div class="fila"><span>Pelo</span><div class="muestras"><button v-for="p in PELOS" :key="p" :aria-label="p" :class="{on:cuenta.cuerpo.pelo===p}" :style="{background:COLORS.pelo[p]}" @click="cuenta.cuerpo.pelo=p"></button></div></div>
     <div class="fila"><span>Peinado</span><div class="chips"><button v-for="[id,l] in PEINADOS" :key="id" :class="{on:cuenta.cuerpo.peinado===id}" @click="cuenta.cuerpo.peinado=id">{{ l }}</button></div></div>
     <div class="fila"><span>Barba</span><div class="chips"><button :class="{on:!cuenta.cuerpo.barba}" @click="cuenta.cuerpo.barba=''">No</button><button :class="{on:!!cuenta.cuerpo.barba}" @click="cuenta.cuerpo.barba='bigote:Viking_Male:corta'">Sí</button></div></div>
    </div>
    <template v-if="vistaPerfil==='calle'">
     <h3 class="sep">Tu ropa de calle</h3>
     <div class="pestanas" role="tablist"><button v-for="[s,l] in PARTES_ROPA" :key="s" role="tab" :aria-selected="slotSel===s" :class="{on:slotSel===s}" @click="slotSel=s">{{ l }}</button></div>
     <div class="chips prendas"><button v-if="slotSel==='outer'||slotSel==='hat'" :class="{on:!cuenta.ropa.calle[slotSel]}" @click="elegirPrenda(slotSel,null)">Nada</button>
      <button v-for="g in prendasDe(slotSel)" :key="g.id" :class="{on:cuenta.ropa.calle[slotSel]?.id===g.id}" @click="elegirPrenda(slotSel,g.id)">{{ g.label }}</button></div>
     <div v-if="cuenta.ropa.calle[slotSel]" class="muestras paleta"><button v-for="c in PALETTE" :key="c" :aria-label="'color '+c" :class="{on:cuenta.ropa.calle[slotSel].color===c}" :style="{background:c}" @click="elegirColor(slotSel,c)"></button></div>
     <p class="nota chica">En la partida podés cambiarte con la ropa que llevás en la mochila.</p>
    </template>
    <template v-else>
     <h3 class="sep">Tu uniforme</h3>
     <p class="nota">La policía va uniformada: camisa y pantalón azul oscuro, chaleco reflectivo y botas. Se la reconoce de lejos.</p>
     <div class="fila"><span>Gorra</span><div class="chips"><button :class="{on:cuenta.ropa.gorra}" @click="cuenta.ropa.gorra=true">Con gorra</button><button :class="{on:!cuenta.ropa.gorra}" @click="cuenta.ropa.gorra=false">Sin gorra</button></div></div>
    </template>
    <div class="pie-panel"><button class="cta" :disabled="!cuenta.nombre.trim()" @click="perfilListo">{{ cuenta.perfilListo?'Guardar y volver':'Listo' }}</button></div>
   </div>
  </section>

  <!-- ============ CÓMO SE JUEGA ============ -->
  <section v-if="paso==='reglas'" class="reglas">
   <div class="cabeza"><h2 class="titular grande-t">Cómo se juega</h2><button class="fantasma peq" @click="paso=volverDe==='titulo'?'titulo':volverDe">Volver</button></div>
   <nav class="pestanas" role="tablist"><button v-for="sec in SECCIONES" :key="sec.id" role="tab" :aria-selected="seccion===sec.id" :class="[{on:seccion===sec.id},sec.id]" @click="seccion=sec.id">{{ sec.titulo }}</button><button role="tab" :aria-selected="seccion==='controles'" :class="{on:seccion==='controles'}" @click="seccion='controles'">Controles</button></nav>
   <template v-for="sec in SECCIONES" :key="sec.id"><div v-if="seccion===sec.id" class="panel hoja" :class="sec.id">
    <p class="lema">{{ sec.lema }}</p>
    <ul class="puntos"><li v-for="[t,d] in sec.items" :key="t"><b>{{ t }}</b><span>{{ d }}</span></li></ul>
   </div></template>
   <div v-if="seccion==='controles'" class="panel hoja"><p class="lema">Con teclado y ratón. En el juego, la tecla de cada cosa aparece al acercarte.</p>
    <dl class="teclas"><template v-for="[k,d] in CONTROLES" :key="k"><dt><kbd>{{ k }}</kbd></dt><dd>{{ d }}</dd></template></dl>
    <p class="nota">En la patrulla: W y S aceleran y frenan, A y D giran, E te baja.</p></div>
  </section>

  <!-- ============ 4. EL HOME ============ -->
  <section v-if="paso==='home'" class="home">
   <aside class="lateral">
    <div class="panel tu-muneco">
     <div class="vista chica"><MunecoVista :cuerpo="cuenta.cuerpo" :ropa="ropaPerfil" /><div class="pedestal" aria-hidden="true"></div></div>
     <b class="nombre">{{ cuenta.nombre }}</b>
     <div class="selector-bando mini" role="group" aria-label="Ver de"><button class="ladron" :class="{on:vistaPerfil==='calle'}" @click="vistaPerfil='calle'">Ladrón</button><button class="policia" :class="{on:vistaPerfil==='policia'}" @click="vistaPerfil='policia'">Policía</button></div>
     <button class="fantasma peq ancho" @click="paso='perfil'">Editar perfil</button>
    </div>
    <div class="panel aprende" role="note"><b>¿Primera vez?</b><span>Los ladrones juntan la meta en plata en sus guaridas; la policía los atrapa antes.</span><button class="link" @click="verReglas('home')">Cómo se juega →</button></div>
   </aside>
   <div class="principal">
    <div class="acciones">
     <button class="cta enorme" @click="jugarRapido"><span class="ico-play" aria-hidden="true"></span><span><b>Jugar rápido</b><small>a la sala más llena</small></span></button>
     <button class="vidrio enorme" @click="paso='crear'"><span class="ico-mas" aria-hidden="true"></span><span><b>Crear mundo</b><small>elegí la ciudad y esperá a los demás</small></span></button>
    </div>
    <div class="cabeza-salas">
     <h2 class="titular">Salas <small>{{ abiertas.length }} abiertas</small></h2>
     <div class="filtros" role="group" aria-label="Filtrar salas">
      <button v-for="[k,l] in [['todas','Todas'],['lugar','Con lugar'],['2','2 vs 2'],['3','3 vs 3'],['5','5 vs 5'],['8','8 vs 8']]" :key="k" :class="{on:filtro===k}" @click="filtro=k">{{ l }}</button>
     </div>
     <label class="orden"><span>Ordenar</span><select v-model="orden"><option value="llenas">Más llenas</option><option value="ping">Menos ping</option></select></label>
    </div>
    <ul class="salas">
     <li v-for="s in salasVista" :key="s.id" :class="{gris:s.estado!=='esperando'||s.privada,prueba:s.prueba}">
      <MiniMapa :ciudad="s.ciudad" :equipo="s.equipo" :real="!!s.prueba&&mapaEstado[s.ciudad]==='listo'" />
      <div class="info"><b>{{ s.nombre }}</b>
       <small v-if="s.prueba"><span class="etiqueta prueba">prueba</span> ciudad {{ s.ciudad }} · {{ s.equipo }} vs {{ s.equipo }} · <span class="estado-mapa" :class="mapaEstado[s.ciudad]">{{ {listo:'mapa guardado: entra al toque',armando:'guardando el mapa…',error:'no se pudo guardar el mapa'}[mapaEstado[s.ciudad]]||'revisando el mapa…' }}</span></small>
       <small v-else>de {{ s.anfitrion }} · {{ s.equipo }} vs {{ s.equipo }} · {{ s.region }}<span v-if="s.privada" class="etiqueta">privada</span><span v-else-if="s.estado!=='esperando'" class="etiqueta">en partida</span></small></div>
      <div class="cupos" :aria-label="`Ladrones ${s.ladrones} de ${s.equipo}, policía ${s.policias} de ${s.equipo}`">
       <div class="cupo ladron"><span class="rot">Ladrones</span><span class="pips"><i v-for="(ok,i) in puntos(s.ladrones,s.equipo)" :key="i" :class="{ok}"></i></span></div>
       <div class="cupo policia"><span class="rot">Policía</span><span class="pips"><i v-for="(ok,i) in puntos(s.policias,s.equipo)" :key="i" :class="{ok}"></i></span></div>
      </div>
      <div class="ping" :title="`${s.ping} ms`" :aria-label="`ping ${s.ping} milisegundos`"><i v-for="k in 4" :key="k" :class="{on:k<=barras(s.ping)}" :style="{height:(k*4+2)+'px'}"></i><small>{{ s.prueba?'local':s.ping+' ms' }}</small></div>
      <button class="cta peq" :disabled="s.estado!=='esperando'||s.privada||s.ladrones+s.policias>=s.equipo*2" @click="unirse(s)">{{ s.prueba?'Entrar':'Unirse' }}</button>
     </li>
     <li v-if="!salasVista.length" class="vacia">No hay salas con ese filtro. <button class="link" @click="filtro='todas'">Ver todas</button></li>
    </ul>
   </div>
  </section>

  <!-- ============ 5. CREAR MUNDO ============ -->
  <section v-if="paso==='crear'" class="crear">
   <div class="mapa panel"><canvas ref="plano" aria-label="El plano de la ciudad"></canvas><div v-if="nuevo.cargando" class="cargando"><span class="rueda" aria-hidden="true"></span>Armando la ciudad…</div>
    <div v-if="nuevo.datos&&!nuevo.cargando" class="datos"><span><b>{{ fmt(nuevo.datos.habitantes) }}</b> habitantes</span><span><b>{{ fmt(nuevo.datos.hogares) }}</b> hogares</span><span><b>{{ nuevo.datos.edificios }}</b> edificios</span><span><b>{{ nuevo.datos.casas }}</b> casas en el monte</span><span><b>{{ nuevo.datos.lugares }}</b> lugares</span><span><b>{{ nuevo.datos.objetivos }}</b> golpes grandes</span></div></div>
   <div class="panel form">
    <h2 class="titular">Crear mundo</h2>
    <label class="campo"><span>Nombre del mundo</span><input v-model="nuevo.nombre" maxlength="32" :placeholder="`El mundo de ${cuenta.nombre}`" /></label>
    <div class="fila"><span>Jugadores</span><div class="segmentado"><button v-for="n in SIZES" :key="n" :class="{on:nuevo.equipo===n}" @click="nuevo.equipo=n">{{ n }} vs {{ n }}</button></div></div>
    <div class="fila"><span>Ciudad</span><div class="chips"><b class="num">#{{ nuevo.ciudad||'…' }}</b><button :disabled="nuevo.cargando" @click="otraCiudad">↻ Otra ciudad</button></div></div>
    <div class="fila"><span>Quién entra</span><div class="segmentado"><button :class="{on:nuevo.publica}" @click="nuevo.publica=true">Pública</button><button :class="{on:!nuevo.publica}" @click="nuevo.publica=false">Con código</button></div></div>
    <p class="nota">El tamaño cambia la ciudad: más jugadores, más ciudad. La ronda dura 5 minutos (5 horas de la ciudad) y empieza a cualquier hora.</p>
    <div class="botones"><button class="link" @click="paso='home'">Cancelar</button><button class="cta" :disabled="nuevo.cargando||!nuevo.ciudad" @click="crearMundo">Crear y esperar</button></div>
   </div>
  </section>

  <!-- ============ 6. LA SALA DE ESPERA ============ -->
  <section v-if="paso==='sala'" class="sala">
   <div class="cab">
    <div><h2 class="titular grande-t">{{ sala.nombre }}</h2>
     <div class="meta"><span class="etiqueta">{{ sala.equipo }} vs {{ sala.equipo }}</span><span class="etiqueta">ciudad {{ sala.ciudad }}</span><span class="etiqueta">{{ sala.mia?'sos el anfitrión':'de '+sala.anfitrion }}</span><span v-if="sala.codigo" class="etiqueta codigo">código <b>{{ sala.codigo }}</b></span></div></div>
    <div v-if="sala.cuenta!=null" class="reloj" role="status" :aria-label="`Empieza en ${sala.cuenta}`"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" class="pista"/><circle cx="32" cy="32" r="28" class="avance" :style="{strokeDashoffset:176*(1-sala.cuenta/(sala.prueba?3:5))}"/></svg><b>{{ sala.cuenta }}</b><small>empieza</small></div>
    <div v-else class="espera"><span class="punto-vivo" aria-hidden="true"></span>{{ sala.equipo*2-sala.jugadores.length?`Esperando a ${sala.equipo*2-sala.jugadores.length} más`:'Esperando a que todos estén listos' }}</div>
   </div>
   <div class="cuerpo">
    <div class="panel mapa chico"><canvas ref="planoSala" aria-label="El plano de la ciudad"></canvas></div>
    <div class="equipos">
     <div v-for="b in ['ladron','policia']" :key="b" class="equipo" :class="b">
      <header><span class="emblema" aria-hidden="true"></span><h3>{{ b==='ladron'?'Ladrones':'Policía' }}</h3><small>{{ bando(b).length }}/{{ sala.equipo }}</small></header>
      <ul><li v-for="j in bando(b)" :key="j.nombre" :class="{yo:j.yo,listo:j.listo}"><span class="avatar">{{ j.nombre.slice(0,1) }}</span><b>{{ j.nombre }}<small v-if="j.yo"> (vos)</small></b><small v-if="j.anfitrion" class="etiqueta">anfitrión</small><span class="check" :aria-label="j.listo?'listo':'eligiendo'">{{ j.listo?'✓':'…' }}</span></li>
       <li v-for="k in Math.max(0,sala.equipo-bando(b).length)" :key="'v'+k" class="vacio"><span class="avatar"></span>esperando jugador…</li></ul>
      <button v-if="yo&&yo.bando!==b" class="fantasma peq" :disabled="lleno(b)" @click="cambiarBando(b)">Pasarme {{ b==='ladron'?'a los ladrones':'a la policía' }}</button>
     </div>
    </div>
    <div class="lado">
     <div v-if="yo" class="panel basico" :class="yo.bando"><h3>Vas {{ yo.bando==='ladron'?'de ladrón':'de policía' }}</h3><ol><li v-for="t in LO_BASICO[yo.bando]" :key="t">{{ t }}</li></ol><button class="link" @click="verReglas('sala',yo.bando)">Todas las reglas →</button></div>
     <div class="panel chat"><h3>Chat</h3><ul><li v-for="m in sala.chat" :key="m.id" :class="{sistema:m.quien==='FUGA'}"><b v-if="m.quien!=='FUGA'">{{ m.quien }}</b> {{ m.texto }}</li></ul>
      <form @submit.prevent="enviar"><input v-model="msj" placeholder="Escribí algo…" maxlength="120" aria-label="Mensaje" /><button class="fantasma peq">Enviar</button></form></div>
    </div>
   </div>
   <div class="pie"><button class="link" @click="dejarSala">← Salir de la sala</button><span class="nota">En el juego vas a hablar por voz con los de tu bando.</span>
    <button class="cta listo-btn" :class="{ok:yo?.listo}" @click="listo">{{ yo?.listo?'Listo ✓':'Estoy listo' }}</button><button v-if="sala.mia" class="link" @click="entrar">Empezar ya (prueba)</button></div>
  </section>
 </div>
</template>

<style scoped>
/* ======== La entrada de FUGA (rediseño 2026-10-18) ========
   La ciudad del juego de fondo (public/fondos: capturas del 3D) con un velo; paneles de vidrio encima. Un color por bando
   en todas partes (ámbar los ladrones, azul la policía); el botón principal, ámbar. Títulos en Bungee (letrero de calle),
   el resto en Rubik (de trazo parejo: se lee chico y en movimiento). */
.inicio{--tx:#f5f2ea;--tx2:#c3cad6;--tx3:#8e97a6;--panel:rgba(14,20,33,.74);--panel2:rgba(255,255,255,.06);--borde:rgba(255,255,255,.11);--borde2:rgba(255,255,255,.2);
 --ladron:#ffa94d;--ladron2:#ff7a3d;--ladron-f:rgba(255,169,77,.14);--policia:#5aa9ff;--policia2:#3d7eff;--policia-f:rgba(90,169,255,.14);--ok:#45d483;--ok-f:rgba(69,212,131,.16);--foco:#ffd166;
 --t:'Bungee',Impact,system-ui,sans-serif;--c:'Rubik Variable','Rubik',system-ui,-apple-system,'Segoe UI',sans-serif;
 position:fixed;inset:0;overflow:auto;color:var(--tx);font:15px/1.5 var(--c);display:flex;flex-direction:column;align-items:center;background:#0b1020}
.fondo{position:fixed;inset:-4%;background:center/cover no-repeat;z-index:0;transition:filter .6s}
.fondo.noche{background-image:url('/fondos/noche.jpg');animation:acercar 40s ease-in-out infinite alternate}
.fondo.costa{background-image:url('/fondos/costa.jpg');filter:blur(6px) saturate(1.1) brightness(.75)}
.velo-fondo{position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse at 50% 30%,rgba(11,16,32,.15),rgba(11,16,32,.75) 70%),linear-gradient(180deg,rgba(11,16,32,.35),rgba(11,16,32,.85))}
.p-titulo .velo-fondo,.p-entrar .velo-fondo{background:radial-gradient(ellipse at 50% 45%,rgba(11,16,32,.2),rgba(11,16,32,.65) 75%),linear-gradient(180deg,rgba(11,16,32,0) 40%,rgba(11,16,32,.6))}
.p-home .velo-fondo,.p-sala .velo-fondo,.p-crear .velo-fondo,.p-perfil .velo-fondo,.p-reglas .velo-fondo{background:linear-gradient(180deg,rgba(11,16,32,.72),rgba(11,16,32,.9))}
@keyframes acercar{from{transform:scale(1)}to{transform:scale(1.08) translate(-1%,1%)}}
.inicio>section,.inicio>header,.inicio>.velo{position:relative;z-index:1}

/* ---- tipografía y piezas comunes ---- */
.titular{font:400 22px/1.15 var(--t);letter-spacing:.5px;margin:0 0 10px;color:var(--tx)}.titular small{font:500 13px var(--c);color:var(--tx3);margin-left:8px;letter-spacing:0}
.grande-t{font-size:30px}
h3{margin:0 0 8px;font:600 12px var(--c);text-transform:uppercase;letter-spacing:1.4px;color:var(--tx2)}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}
button:disabled{opacity:.4;cursor:not-allowed}
:focus-visible{outline:3px solid var(--foco);outline-offset:2px;border-radius:10px}
.panel{background:var(--panel);border:1px solid var(--borde);border-radius:18px;backdrop-filter:blur(16px) saturate(1.2);-webkit-backdrop-filter:blur(16px) saturate(1.2);box-shadow:0 20px 50px -20px rgba(0,0,0,.6)}
.cta{background:linear-gradient(180deg,var(--ladron),var(--ladron2));color:#1d1206;font-weight:700;border-radius:14px;padding:13px 26px;font-size:16px;display:inline-flex;flex-direction:column;align-items:center;gap:1px;
 box-shadow:0 8px 24px -8px rgba(255,122,61,.7),inset 0 1px 0 rgba(255,255,255,.4);transition:transform .12s,filter .12s,box-shadow .12s}
.cta:hover:not(:disabled){transform:translateY(-1px);filter:brightness(1.06)}.cta:active:not(:disabled){transform:translateY(1px)}
.cta small{font-weight:500;font-size:12px;opacity:.75}.cta.peq{padding:8px 16px;font-size:14px;border-radius:11px}
.fantasma{border:1px solid var(--borde2);background:rgba(255,255,255,.05);border-radius:12px;padding:12px 22px;font-weight:600;transition:background .15s}.fantasma:hover:not(:disabled){background:rgba(255,255,255,.12)}
.fantasma.peq{padding:7px 14px;font-size:14px;border-radius:10px}.fantasma.ancho{width:100%}
.vidrio{background:rgba(255,255,255,.07);border:1px solid var(--borde2);border-radius:16px;transition:background .15s,transform .12s}.vidrio:hover{background:rgba(255,255,255,.12);transform:translateY(-1px)}
.link{color:var(--tx2);text-decoration:underline;text-underline-offset:3px;padding:6px}.link:hover{color:var(--tx)}
.nota{color:var(--tx2);font-size:13.5px;margin:6px 0 12px}.nota.chica{font-size:12.5px;color:var(--tx3)}
.etiqueta{display:inline-block;font-size:11px;font-weight:600;padding:2px 9px;border-radius:20px;background:rgba(255,255,255,.1);color:var(--tx2);margin-right:6px;white-space:nowrap}
.etiqueta.prueba{background:rgba(255,209,102,.18);color:var(--foco)}
.avatar{width:32px;height:32px;border-radius:50%;background:#5b8def;display:inline-grid;place-items:center;font-weight:700;font-size:14px;flex:none;color:#fff;box-shadow:inset 0 -2px 0 rgba(0,0,0,.2)}
input,select{background:rgba(0,0,0,.25);border:1px solid var(--borde2);border-radius:11px;color:inherit;padding:10px 12px;font:inherit}input::placeholder{color:var(--tx3)}
select{padding:7px 10px}
kbd{display:inline-block;min-width:24px;padding:2px 8px;border-radius:7px;background:#f2f0ea;color:#1d1f22;font:600 12px/1.6 ui-monospace,monospace;text-align:center;white-space:nowrap;box-shadow:inset 0 -2px 0 rgba(0,0,0,.2)}
.chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.chips button,.filtros button{border:1px solid var(--borde);background:var(--panel2);border-radius:10px;padding:6px 12px;font-size:14px;transition:background .15s}
.chips button:hover,.filtros button:hover{background:rgba(255,255,255,.12)}
.chips button.on,.filtros button.on{background:var(--tx);color:#141a26;border-color:var(--tx);font-weight:600}
.segmentado{display:inline-flex;padding:3px;border-radius:12px;background:rgba(0,0,0,.3);border:1px solid var(--borde);flex-wrap:wrap}
.segmentado button{padding:7px 14px;border-radius:9px;font-size:14px;color:var(--tx2)}.segmentado button.on{background:var(--tx);color:#141a26;font-weight:600}
.muestras{display:flex;gap:8px;flex-wrap:wrap}.muestras button{width:30px;height:30px;border-radius:50%;border:2px solid rgba(255,255,255,.25);transition:transform .12s}.muestras button:hover{transform:scale(1.1)}
.muestras button.on{border-color:#fff;box-shadow:0 0 0 3px var(--foco)}.muestras.paleta button{width:24px;height:24px}
.pestanas{display:flex;gap:2px;border-bottom:1px solid var(--borde);margin-bottom:12px;flex-wrap:wrap}
.pestanas button{padding:8px 14px;color:var(--tx3);font-weight:600;border-bottom:3px solid transparent;margin-bottom:-1px}.pestanas button.on{color:var(--tx);border-color:var(--foco)}
.pestanas button.ladron.on{border-color:var(--ladron)}.pestanas button.policia.on{border-color:var(--policia)}
.campo{display:flex;flex-direction:column;gap:5px;margin-bottom:8px}.campo span,.fila>span{font-size:12.5px;color:var(--tx3);font-weight:500}
.fila{display:grid;grid-template-columns:96px 1fr;gap:12px;align-items:center;padding:7px 0}
.num{font-variant-numeric:tabular-nums;font-weight:700;min-width:64px}
.botones{display:flex;justify-content:flex-end;align-items:center;gap:12px;margin-top:16px}

/* ---- 1. el título ---- */
.titulo{margin:auto;display:flex;flex-direction:column;align-items:center;gap:30px;text-align:center;padding:24px}
.marca h1{margin:0;font:400 min(24vw,168px)/1 var(--t);letter-spacing:4px;display:flex;gap:.02em;transform:rotate(-4deg)}
.marca h1 span{color:#fff6e6;text-shadow:0 6px 0 var(--ladron2),0 12px 0 #8a3416,0 22px 40px rgba(0,0,0,.6)}
.marca h1 span:nth-child(even){transform:translateY(-.06em)}
.marca p{margin:22px 0 0;color:var(--tx);font-size:19px;font-weight:500;text-shadow:0 2px 10px rgba(0,0,0,.7)}
.botones-titulo{display:flex;flex-direction:column;gap:12px;align-items:center}.botones-titulo .cta{min-width:240px;font-size:18px;padding:15px 30px}
.ver{color:var(--tx3);letter-spacing:1px;text-transform:uppercase;font-size:11px}
/* (las luces de la patrulla detrás del nombre: roja y azul, de a poco) */
.sirena{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:0}
.titulo>*:not(.sirena){position:relative;z-index:1}
.sirena i{position:absolute;top:22%;width:46vw;height:46vw;border-radius:50%;filter:blur(70px);opacity:.35;animation:sirena 3.2s ease-in-out infinite}
.sirena .r{left:8%;background:#ff3b3b}.sirena .a{right:8%;background:#2f7bff;animation-delay:1.6s}
@keyframes sirena{0%,100%{opacity:.12}50%{opacity:.42}}

/* ---- 2. entrar ---- */
.entrar{margin:auto;padding:26px;width:min(440px,calc(100% - 32px));display:flex;flex-direction:column;gap:10px}
.cuenta{display:flex;align-items:center;gap:12px;border:1px solid var(--borde2);border-radius:13px;padding:13px 15px;background:rgba(255,255,255,.06);font-weight:600;text-align:left;transition:transform .12s}
.cuenta:hover{transform:translateY(-1px)}.cuenta small{margin-left:auto;font-weight:600;font-size:11px;background:var(--ok-f);color:var(--ok);padding:2px 9px;border-radius:20px}
.cuenta.steam{background:linear-gradient(90deg,#1b2838,#2a475e)}.cuenta.google{background:#f5f5f5;color:#222}
.ico{font-family:var(--c);width:30px;height:30px;border-radius:8px;display:grid;place-items:center;font-weight:900;background:#66c0f4;color:#1b2838;flex:none}.google .ico{background:#4285f4;color:#fff}
.velo{position:fixed;inset:0;background:rgba(5,8,16,.6);backdrop-filter:blur(4px);display:grid;place-items:center;z-index:10;padding:16px}
.permiso{width:min(380px,100%);border-radius:14px;padding:18px;background:#1b2838;color:#c7d5e0;box-shadow:0 30px 60px rgba(0,0,0,.5)}.permiso.google{background:#fff;color:#202124}
.permiso header{display:flex;align-items:center;gap:10px;font-weight:800;font-size:16px;margin-bottom:10px}
.permiso .quien{display:flex;gap:10px;align-items:center;padding:10px;border-radius:10px;background:rgba(127,127,127,.15)}.permiso .quien div{display:flex;flex-direction:column}.permiso small{opacity:.7}

/* ---- la barra ---- */
.barra{position:sticky;top:0;width:100%;display:flex;align-items:center;gap:18px;padding:10px 20px;background:rgba(11,16,32,.72);backdrop-filter:blur(14px);border-bottom:1px solid var(--borde);z-index:5}
.logo{font:400 20px/1 var(--t);color:#fff6e6;text-shadow:0 2px 0 var(--ladron2);letter-spacing:1px;padding:4px 6px;transform:rotate(-3deg)}
.barra nav{display:flex;gap:4px}.barra nav button{padding:8px 14px;border-radius:10px;color:var(--tx2);font-weight:600}.barra nav button:hover{background:rgba(255,255,255,.07);color:var(--tx)}.barra nav button.on{color:var(--tx);background:rgba(255,255,255,.1)}
.barra .yo{margin-left:auto;display:flex;align-items:center;gap:10px}.barra .yo div{display:flex;flex-direction:column;line-height:1.15}.barra .yo small{color:var(--tx3);font-size:12px}

/* ---- 4. el home ---- */
.home{width:min(1180px,calc(100% - 40px));padding:24px 0 40px;display:grid;grid-template-columns:270px 1fr;gap:22px;align-items:start}
.lateral{display:flex;flex-direction:column;gap:14px;position:sticky;top:80px}
.tu-muneco{padding:14px;display:flex;flex-direction:column;align-items:center;gap:10px}.tu-muneco .nombre{font:400 18px var(--t);letter-spacing:.5px}
.vista{position:relative;border-radius:14px;overflow:hidden;background:radial-gradient(circle at 50% 30%,rgba(255,255,255,.14),rgba(255,255,255,0) 60%),linear-gradient(180deg,#26324a,#141b2b);min-height:360px;width:100%}
.vista.chica{min-height:250px;height:250px}
.pedestal{position:absolute;left:18%;right:18%;bottom:14px;height:16px;border-radius:50%;background:radial-gradient(ellipse,rgba(0,0,0,.55),transparent 70%);pointer-events:none}
.selector-bando{display:grid;grid-template-columns:1fr 1fr;gap:6px;width:100%}
.selector-bando button{padding:9px 10px;border-radius:11px;border:1px solid var(--borde);background:var(--panel2);font-weight:600;color:var(--tx2);font-size:14px}
.selector-bando button.ladron.on{background:var(--ladron-f);border-color:var(--ladron);color:var(--ladron)}.selector-bando button.policia.on{background:var(--policia-f);border-color:var(--policia);color:var(--policia)}
.selector-bando.mini button{padding:6px;font-size:13px}
.aprende{padding:14px;display:flex;flex-direction:column;gap:6px;font-size:14px}.aprende span{color:var(--tx2)}.aprende .link{align-self:flex-start;padding:0}
.acciones{display:grid;grid-template-columns:1.3fr 1fr;gap:14px;margin-bottom:26px}
.enorme{display:flex;flex-direction:row;justify-content:flex-start;gap:16px;padding:22px 24px;text-align:left;border-radius:18px;align-items:center}
.enorme b{display:block;font:400 22px/1.1 var(--t);letter-spacing:.5px}.enorme small{display:block;font-size:13.5px;margin-top:4px}
.vidrio.enorme small{color:var(--tx2)}
.ico-play{width:46px;height:46px;border-radius:50%;background:rgba(29,18,6,.18);flex:none;position:relative}.ico-play::after{content:'';position:absolute;left:18px;top:14px;border:9px solid transparent;border-left:14px solid #1d1206;border-right:0}
.ico-mas{width:46px;height:46px;border-radius:50%;background:rgba(255,255,255,.1);flex:none;position:relative}.ico-mas::before,.ico-mas::after{content:'';position:absolute;left:50%;top:50%;width:18px;height:3px;background:var(--tx);border-radius:2px;transform:translate(-50%,-50%)}.ico-mas::after{transform:translate(-50%,-50%) rotate(90deg)}
.cabeza-salas{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:12px}.cabeza-salas .titular{margin:0}
.filtros{display:flex;gap:6px;flex-wrap:wrap}.filtros button{padding:5px 11px;font-size:13px}
.orden{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:13px;color:var(--tx3)}
.salas{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.salas li{display:grid;grid-template-columns:96px 1fr auto auto auto;gap:18px;align-items:center;padding:10px 14px 10px 10px;border-radius:16px;background:var(--panel);border:1px solid var(--borde);backdrop-filter:blur(12px);transition:border-color .15s,transform .12s}
.salas li:hover{border-color:var(--borde2);transform:translateX(2px)}
.salas li.gris{opacity:.5}.salas li.gris:hover{transform:none}
.salas li.prueba{border-color:rgba(255,209,102,.45);background:linear-gradient(90deg,rgba(255,209,102,.12),var(--panel) 45%)}
.salas li.vacia{display:block;text-align:center;color:var(--tx2);padding:22px}
.salas .info{display:flex;flex-direction:column;gap:2px;min-width:0}.salas .info b{font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.salas .info small{color:var(--tx3)}
.estado-mapa{font-weight:600}.estado-mapa.listo{color:var(--ok)}.estado-mapa.armando{color:var(--ladron)}.estado-mapa.error{color:#ff6b6b}
.cupos{display:flex;flex-direction:column;gap:5px}
.cupo{display:flex;align-items:center;gap:8px;font-size:12px}.cupo .rot{width:62px;color:var(--tx3);text-align:right}
.pips{display:flex;gap:3px}.pips i{width:10px;height:10px;border-radius:3px;background:rgba(255,255,255,.12)}
.cupo.ladron .pips i.ok{background:var(--ladron)}.cupo.policia .pips i.ok{background:var(--policia)}
.ping{display:flex;align-items:flex-end;gap:2px;min-width:70px}.ping i{width:4px;border-radius:1px;background:rgba(255,255,255,.15)}.ping i.on{background:var(--ok)}.ping small{margin-left:6px;color:var(--tx3);font-size:12px;align-self:center}

/* ---- 3. el perfil ---- */
.perfil{width:min(980px,calc(100% - 40px));display:grid;grid-template-columns:minmax(260px,360px) 1fr;gap:22px;padding:24px 0 40px;align-items:start}
.escenario{display:flex;flex-direction:column;gap:10px;position:sticky;top:80px}.escenario .vista{min-height:360px;height:360px}
.opciones{padding:22px 24px}.grupo{border-top:1px solid var(--borde);border-bottom:1px solid var(--borde);margin:8px 0 14px;padding:6px 0}
h3.sep{margin-top:6px}.chips.prendas{margin-bottom:10px}.pie-panel{display:flex;justify-content:flex-end;margin-top:14px}

/* ---- cómo se juega ---- */
.reglas{width:min(960px,calc(100% - 40px));padding:24px 0 40px}
.reglas .cabeza{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.hoja{padding:22px 24px}.hoja.ladron{border-top:3px solid var(--ladron)}.hoja.policia{border-top:3px solid var(--policia)}
.lema{font-size:19px;font-weight:600;margin:0 0 16px}
.puntos{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.puntos li{display:flex;flex-direction:column;gap:4px;padding:14px;border-radius:13px;background:var(--panel2);border:1px solid var(--borde)}.puntos b{font-size:15px}.puntos span{color:var(--tx2);font-size:13.5px}
.teclas{display:grid;grid-template-columns:auto 1fr;gap:9px 18px;margin:0 0 12px;align-items:center}.teclas dd{margin:0;color:var(--tx2)}

/* ---- 5. crear mundo ---- */
.crear{width:min(1180px,calc(100% - 40px));display:grid;grid-template-columns:1.35fr 1fr;gap:22px;padding:24px 0 40px;align-items:start}
.mapa{position:relative;overflow:hidden;display:grid;place-items:center;min-height:420px;padding:14px;background:rgba(10,18,32,.8)}
.mapa canvas{max-width:100%;max-height:68vh;width:auto!important;height:auto!important;display:block;border-radius:10px}
.mapa.chico{min-height:240px;align-self:start}.mapa.chico canvas{max-height:320px}
.cargando{position:absolute;inset:0;display:grid;place-items:center;align-content:center;gap:10px;background:rgba(10,18,32,.7);font-weight:600}
.rueda{width:34px;height:34px;border-radius:50%;border:3px solid rgba(255,255,255,.2);border-top-color:var(--ladron);animation:girar .9s linear infinite}@keyframes girar{to{transform:rotate(360deg)}}
.datos{position:absolute;left:12px;right:12px;bottom:12px;display:flex;flex-wrap:wrap;gap:6px}.datos span{background:rgba(10,16,28,.85);padding:4px 10px;border-radius:9px;font-size:12.5px;color:var(--tx2);border:1px solid var(--borde)}.datos b{color:var(--tx)}
.form{padding:22px 24px}

/* ---- 6. la sala de espera ---- */
.sala{width:min(1200px,calc(100% - 40px));padding:20px 0 32px;display:flex;flex-direction:column;gap:16px}
.cab{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap}.meta{display:flex;flex-wrap:wrap;gap:4px}.codigo b{color:var(--foco)}
.reloj{position:relative;width:88px;height:88px;display:grid;place-items:center;align-content:center}.reloj svg{position:absolute;inset:0;transform:rotate(-90deg)}
.reloj circle{fill:none;stroke-width:5}.reloj .pista{stroke:rgba(255,255,255,.12)}.reloj .avance{stroke:var(--ok);stroke-dasharray:176;stroke-linecap:round;transition:stroke-dashoffset 1s linear}
.reloj b{font:400 30px/1 var(--t)}.reloj small{font-size:11px;color:var(--tx2)}
.espera{display:flex;align-items:center;gap:9px;padding:10px 16px;border-radius:12px;background:var(--panel);border:1px solid var(--borde);color:var(--tx2)}
.punto-vivo{width:9px;height:9px;border-radius:50%;background:var(--ladron);animation:latido 1.2s ease-in-out infinite}@keyframes latido{50%{opacity:.3;transform:scale(.7)}}
.sala .cuerpo{display:grid;grid-template-columns:270px 1fr 300px;gap:16px;align-items:start}
.equipos{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.equipo{border-radius:18px;padding:14px;display:flex;flex-direction:column;gap:10px;background:var(--panel);border:1px solid var(--borde);backdrop-filter:blur(14px)}
.equipo.ladron{background:linear-gradient(180deg,var(--ladron-f),var(--panel) 40%);border-color:rgba(255,169,77,.35)}
.equipo.policia{background:linear-gradient(180deg,var(--policia-f),var(--panel) 40%);border-color:rgba(90,169,255,.35)}
.equipo header{display:flex;align-items:center;gap:10px}.equipo header h3{margin:0;font:400 18px var(--t);letter-spacing:.5px;text-transform:none}.equipo header small{margin-left:auto;font-weight:700;color:var(--tx2)}
.equipo.ladron h3{color:var(--ladron)}.equipo.policia h3{color:var(--policia)}
.emblema{width:30px;height:30px;border-radius:9px;flex:none;position:relative}
.equipo.ladron .emblema{background:var(--ladron)}.equipo.ladron .emblema::after{content:'';position:absolute;left:5px;right:5px;top:11px;height:8px;border-radius:4px;background:#1d1206;box-shadow:inset 6px 0 0 #1d1206}
.equipo.policia .emblema{background:var(--policia);clip-path:polygon(50% 0,100% 20%,90% 75%,50% 100%,10% 75%,0 20%)}
.equipo ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px;flex:1}
.equipo li{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid transparent;transition:border-color .2s}
.equipo li b{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.equipo li b small{color:var(--tx3);font-weight:500}
.equipo li.yo{border-color:var(--foco);background:rgba(255,209,102,.08)}
.check{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:13px;font-weight:800;background:rgba(255,255,255,.1);color:var(--tx3);flex:none}
.equipo li.listo .check{background:var(--ok);color:#06210f}
.equipo li.vacio{color:var(--tx3);font-style:italic;background:transparent;border:1px dashed var(--borde2)}
.equipo li.vacio .avatar{background:rgba(255,255,255,.06);box-shadow:none;animation:latido 1.6s ease-in-out infinite}
.equipo.ladron .avatar{background:#c0662a}.equipo.policia .avatar{background:#2f6fb0}
.lado{display:flex;flex-direction:column;gap:14px}
.basico{padding:14px}.basico.ladron h3{color:var(--ladron)}.basico.policia h3{color:var(--policia)}
.basico ol{margin:0 0 6px;padding-left:18px;display:flex;flex-direction:column;gap:5px;font-size:13.5px;color:var(--tx2)}
.chat{padding:14px;display:flex;flex-direction:column;min-height:260px;max-height:400px}
.chat ul{list-style:none;margin:0;padding:0;flex:1;overflow:auto;display:flex;flex-direction:column;gap:6px;font-size:13.5px}.chat li b{color:var(--tx);margin-right:4px}.chat li{color:var(--tx2)}.chat li.sistema{color:var(--tx3);font-style:italic}
.chat form{display:flex;gap:6px;margin-top:10px}.chat input{flex:1;min-width:0;padding:8px 10px}
.pie{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.pie .nota{flex:1;margin:0}
.listo-btn{min-width:200px;font-size:17px}.listo-btn.ok{background:linear-gradient(180deg,#5fe39a,var(--ok));color:#06210f;box-shadow:0 8px 24px -8px rgba(69,212,131,.7)}

/* ---- pantallas angostas y menos movimiento ---- */
@media (max-width:980px){.home,.perfil,.crear{grid-template-columns:1fr}.lateral,.escenario{position:static}.sala .cuerpo{grid-template-columns:1fr}.acciones{grid-template-columns:1fr}
 .salas li{grid-template-columns:72px 1fr auto;row-gap:8px}.salas li .cupos{grid-column:2/4}.salas li .ping{grid-column:2}.barra nav{display:none}}
@media (max-width:600px){.equipos{grid-template-columns:1fr}.fila{grid-template-columns:1fr}.orden{margin-left:0}}
@media (prefers-reduced-motion:reduce){.fondo.noche,.sirena i,.punto-vivo,.rueda,.equipo li.vacio .avatar{animation:none}.cta,.vidrio,.salas li{transition:none}}
</style>
