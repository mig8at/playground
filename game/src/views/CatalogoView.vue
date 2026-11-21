<script setup>
// EL CATÁLOGO (2026-11-21, Miguel: «sólo veo el mapa y no logro ver qué arreglos hiciste en el resto: me gustaría ver las
// secciones de muebles, fachadas…»). Lo que el plano usa para armar la ciudad, de a una pieza y sin el mapa:
//   · MUEBLES: cada mueble con su símbolo, lo que el plano le reserva, lo que mide su modelo 3D y en qué cuartos va;
//   · FACHADAS: el alzado de todos los edificios de una ciudad, con el paquete de texturas que se elija;
//   · TEXTURAS: cada textura sobre varios colores, y qué pone cada paquete en cada parte.
// /catalogo?seccion=muebles|fachadas|texturas&ciudad=1. No carga el 3D.
import {ref,computed,onMounted,watch,nextTick} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import '@fontsource/bungee/400.css';
import '@fontsource-variable/rubik';
import {planoDe} from '../lib/mapasGuardados.js';
import {drawMueble,drawElevation,ROOM_LABEL} from '../lib/drawPlan.js';
import {ITEMS,SIZES,RECIPE} from '../engine/blueprint.js';
import {MUEBLES_MEDIDOS} from '../engine/muebles-medidos.js';
import {TEXTURAS,PAQUETES,baldosa} from '../lib/texturas2d.js';

const route=useRoute(),router=useRouter();
const SECCIONES={muebles:'Muebles',fachadas:'Fachadas',texturas:'Texturas'};
const seccion=ref(SECCIONES[route.query.seccion]?route.query.seccion:'muebles'),seed=ref(Math.max(1,Number(route.query.ciudad)||1));
const guardado=(()=>{try{return localStorage.getItem('fuga.paquete');}catch{return null;}})(),paquete=ref(PAQUETES[guardado]?guardado:'clasico');
watch(paquete,v=>{try{localStorage.setItem('fuga.paquete',v);}catch{}});
watch([seccion,seed],()=>router.replace({query:{seccion:seccion.value,ciudad:seed.value}}));

// ---------- muebles ----------
const NOMBRE={sofa:'Sofá',mesa_centro:'Mesa de centro',tv:'Televisor',planta:'Planta',cama:'Cama doble',cama_s:'Cama sencilla',litera:'Camarote',mesa_noche:'Mesa de noche',armario:'Armario',escritorio:'Escritorio',meson:'Mesón',
 nevera:'Nevera',estufa:'Estufa',mesa:'Mesa',inodoro:'Inodoro',lavamanos:'Lavamanos',ducha:'Ducha',tina:'Tina',lavadora:'Lavadora',archivador:'Archivador',mesa_reunion:'Mesa de reunión',cama_h:'Cama de hospital',mostrador:'Mostrador',
 pupitre:'Pupitre',tablero:'Tablero',casillero:'Casilleros',caminadora:'Caminadora',bicicleta:'Bicicleta fija',banco:'Banco de pesas',mancuernas:'Mancuernas',colchoneta:'Colchoneta',espejo_pared:'Espejo de pared',perchero:'Perchero',
 maniqui:'Maniquí',estanteria_ropa:'Estantería de ropa',probador:'Probador',estante:'Estante',mesa_lectura:'Mesa de lectura',lampara:'Lámpara',sillon:'Sillón',comoda:'Cómoda',catre:'Catre',vehiculo:'Vehículo',caja:'Caja',buzones:'Buzones',
 caja_fuerte:'Caja fuerte',camilla:'Camilla',horno:'Horno de leña',plancha:'Plancha',repisa:'Repisa',vitrina:'Vitrina',cajon:'Cajón',silla:'Silla'};
// (en qué cuartos lo pone la receta de la ciudad)
const cuartosDe=k=>Object.entries(RECIPE).filter(([,r])=>r.some(e=>e.replace(/[?!]$/,'').split(':')[0]===k)).map(([t])=>ROOM_LABEL[t]||t.replace(/^local_/,'local: ').replace(/_/g,' '));
const muebles=computed(()=>{const ks=[...new Set([...Object.keys(ITEMS),'silla'])];return ks.map(k=>{const it=ITEMS[k]||[.5,.5],M=MUEBLES_MEDIDOS[k],mod=M?.modelo,girado=/girado/.test(M?.estado||''),
  mw=mod?(girado?mod.fondo:mod.ancho):null,md=mod?(girado?mod.ancho:mod.fondo):null,aMedida=!!SIZES[k];
  // (el veredicto: a la medida de su cuarto, exacto contra el modelo, o cuánto se pasa o le sobra)
  const dw=mw!=null?mw-it[0]*1000:null,dd=md!=null?md-it[1]*1000:null,peor=dw==null?null:Math.abs(dw)>Math.abs(dd)?dw:dd;
  const estado=/achica/.test(M?.estado||'')?'malo':aMedida?'medida':peor==null?'sin':Math.abs(peor)<=20?'exacto':peor>0?'malo':Math.abs(peor)>.15*Math.max(it[0],it[1])*1000?'sobra':'exacto';
  return {k,nombre:NOMBRE[k]||k,w:it[0],d:it[1],mw,md,alto:mod?.alto,aMedida,medidas:SIZES[k]||null,estado,nota:M?.estado||'',origen:M?.origen||'',cuartos:cuartosDe(k)};}).sort((a,b)=>a.nombre.localeCompare(b.nombre));});
const ESTADO={exacto:'a la medida de su modelo',medida:'se fabrica a medida',sobra:'el plano reserva de más',malo:'el modelo no cabe: se encoge',sin:'sin modelo medido'};
const filtro=ref('todos'),lienzosM=ref([]);
const mueblesVistos=computed(()=>muebles.value.filter(m=>filtro.value==='todos'||m.estado===filtro.value));
const cuentas=computed(()=>{const o={todos:muebles.value.length};for(const m of muebles.value)o[m.estado]=(o[m.estado]||0)+1;return o;});
async function pintarMuebles(){await nextTick();mueblesVistos.value.forEach((m,i)=>{const c=lienzosM.value[i];if(c)drawMueble(c,m.k,m.w,m.d,{lado:132,pc:m.k==='escritorio'});});}

// ---------- fachadas ----------
const lotes=ref([]),estado=ref(''),lienzosF=ref([]),tipo=ref('todos');
const TIPO={vivienda:'Vivienda',oficinas:'Oficinas',comercio:'Comercio',hotel:'Hotel',casa:'Casa',local:'Local',colegio:'Colegio',comisaria:'Comisaría',biblioteca:'Biblioteca',hospital:'Hospital',objetivo:'Objetivo'};
const FAMILIA={ladrillo:'Ladrillo',piedra:'Piedra',metal:'Metal y concreto'};
const lotesVistos=computed(()=>lotes.value.filter(L=>tipo.value==='todos'||L.type===tipo.value));
const tipos=computed(()=>{const o={};for(const L of lotes.value)o[L.type]=(o[L.type]||0)+1;return o;});
const medidos=ref({});
async function cargarFachadas(){estado.value='Armando el plano…';lotes.value=[];const r=await planoDe({seed:seed.value,team:3,parks:true});if(!r.plano){estado.value='No se pudo armar el plano.';return;}
 lotes.value=[...r.plano.lots].sort((a,b)=>b.floors-a.floors||a.id-b.id);estado.value='';pintarFachadas();}
async function pintarFachadas(){await nextTick();const o={};lotesVistos.value.forEach((L,i)=>{const c=lienzosF.value[i];if(c)o[L.id]=drawElevation(c,L,{width:c.parentElement.clientWidth,paquete:paquete.value});});medidos.value=o;}

// ---------- texturas ----------
const COLORES=['#b5523b','#e8dcc0','#6f8fb5','#8fb5a5','#4a4f57','#d6a84a'],lienzosT=ref([]);
const texturas=computed(()=>Object.entries(TEXTURAS).map(([k,T])=>({k,nombre:T.nombre,w:T.w,h:T.h,usos:Object.entries(PAQUETES).filter(([,P])=>[...Object.values(P.muro),P.zocalo,P.mansarda,P.losa].includes(k)).map(([,P])=>P.nombre)})));
async function pintarTexturas(){await nextTick();texturas.value.forEach((T,i)=>{const c=lienzosT.value[i];if(!c)return;const dpr=window.devicePixelRatio||1,W=c.parentElement.clientWidth,H=150,m=44;// (44 px por metro: cada franja de color mide lo mismo)
  c.width=Math.round(W*dpr);c.height=Math.round(H*dpr);c.style.width=W+'px';c.style.height=H+'px';const g=c.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);
  const b=baldosa(T.k),p=g.createPattern(b,'repeat');p.setTransform(new DOMMatrix([m/120,0,0,m/120,0,0]));
  COLORES.forEach((col,j)=>{const x=j*W/COLORES.length;g.fillStyle=col;g.fillRect(x,0,W/COLORES.length+1,H);});g.fillStyle=p;g.fillRect(0,0,W,H);
  // (la regla de un metro)
  g.fillStyle='rgba(255,255,255,.9)';g.fillRect(8,H-14,m,3);g.font='10px system-ui,sans-serif';g.fillText('1 m',8,H-18);});}

const pintar=()=>seccion.value==='muebles'?pintarMuebles():seccion.value==='fachadas'?(lotes.value.length?pintarFachadas():cargarFachadas()):pintarTexturas();
watch([seccion,filtro,tipo,paquete],pintar);watch(seed,()=>{lotes.value=[];pintar();});
onMounted(pintar);
</script>

<template>
 <div class="cat">
  <header class="barra">
   <RouterLink to="/" class="logo" title="Volver al inicio">FUGA</RouterLink>
   <b class="titulo">El catálogo</b>
   <nav><button v-for="(n,k) in SECCIONES" :key="k" :class="{on:k===seccion}" @click="seccion=k">{{ n }}</button></nav>
   <label v-if="seccion!=='muebles'" class="sel">Texturas <select v-model="paquete"><option v-for="(P,k) in PAQUETES" :key="k" :value="k">{{ P.nombre }}</option></select></label>
   <label v-if="seccion==='fachadas'" class="sel">Ciudad <input type="number" min="1" v-model.number="seed"></label>
   <RouterLink class="ir" :to="{path:'/plano',query:{ciudad:seed,jugadores:3}}">Ver el plano</RouterLink>
  </header>

  <main v-if="seccion==='muebles'">
   <p class="intro">Los {{ muebles.length }} muebles que el plano sabe poner. Cada uno con su símbolo (el frente hacia abajo, sobre una rejilla de medio metro), lo que el plano le reserva y lo que mide el modelo 3D que lo dibuja.</p>
   <div class="filtros"><button :class="{on:filtro==='todos'}" @click="filtro='todos'">Todos <b>{{ cuentas.todos }}</b></button><button v-for="(t,k) in ESTADO" :key="k" v-show="cuentas[k]" :class="['e-'+k,{on:filtro===k}]" @click="filtro=k">{{ t }} <b>{{ cuentas[k] }}</b></button></div>
   <ul class="grilla muebles">
    <li v-for="(m,i) in mueblesVistos" :key="m.k" :class="'e-'+m.estado">
     <div class="dibujo"><canvas :ref="el=>lienzosM[i]=el"></canvas></div>
     <b>{{ m.nombre }}</b>
     <dl><dt>Plano</dt><dd>{{ m.w.toFixed(2) }} × {{ m.d.toFixed(2) }} m</dd>
      <template v-if="m.mw!=null"><dt>Modelo</dt><dd>{{ (m.mw/1000).toFixed(2) }} × {{ (m.md/1000).toFixed(2) }} m<template v-if="m.alto"> · alto {{ (m.alto/1000).toFixed(2) }}</template></dd></template>
      <template v-if="m.medidas"><dt>Medidas</dt><dd>{{ m.medidas.map(s=>s[0]+'×'+s[1]).join(' · ') }}</dd></template></dl>
     <span class="estado">{{ ESTADO[m.estado] }}<template v-if="m.nota&&m.estado==='malo'">: {{ m.nota }}</template></span>
     <small v-if="m.cuartos.length">{{ m.cuartos.slice(0,7).join(' · ') }}<template v-if="m.cuartos.length>7"> · y {{ m.cuartos.length-7 }} más</template></small>
     <small v-else class="nada">ninguna receta lo usa</small>
    </li>
   </ul>
  </main>

  <main v-else-if="seccion==='fachadas'">
   <p class="intro">La fachada del frente de los {{ lotes.length }} edificios de la ciudad {{ seed }}, de frente y a escala, con el paquete «{{ PAQUETES[paquete].nombre }}». {{ PAQUETES[paquete].nota }}</p>
   <div class="filtros"><button :class="{on:tipo==='todos'}" @click="tipo='todos'">Todos <b>{{ lotes.length }}</b></button><button v-for="(n,k) in tipos" :key="k" :class="{on:tipo===k}" @click="tipo=k">{{ TIPO[k]||k }} <b>{{ n }}</b></button></div>
   <p v-if="estado" class="estado-carga">{{ estado }}</p>
   <ul class="grilla fachadas">
    <li v-for="(L,i) in lotesVistos" :key="L.id">
     <div class="dibujo ancho"><canvas :ref="el=>lienzosF[i]=el"></canvas></div>
     <b>{{ L.shopName||L.name }}</b>
     <span class="estado">{{ TIPO[L.type]||L.type }} · {{ L.floors }} {{ L.floors===1?'piso':'pisos' }} · {{ FAMILIA[L.fachada?.familia]||'—' }}<template v-if="L.fachada?.techo==='mansarda'"> · mansarda</template><template v-if="L.fachada?.balcones"> · balcones</template></span>
     <small v-if="medidos[L.id]">vidrio por piso: {{ medidos[L.id].vano.map((v,j)=>(j?j:'PB')+' '+v+' %').join(' · ') }}<template v-if="medidos[L.id].corridas"> · <i class="alerta">{{ medidos[L.id].corridas }} ventanas corridas</i></template></small>
    </li>
   </ul>
  </main>

  <main v-else>
   <p class="intro">Las {{ texturas.length }} texturas, cada una sobre seis colores de pared: son transparentes (sólo juntas, sombras y brillos), así que toman el color de cada edificio. Todas a la misma escala; la regla blanca mide un metro.</p>
   <ul class="grilla texturas">
    <li v-for="(T,i) in texturas" :key="T.k">
     <div class="dibujo ancho"><canvas :ref="el=>lienzosT[i]=el"></canvas></div>
     <b>{{ T.nombre }}</b><span class="estado">la pieza se repite cada {{ T.w }} × {{ T.h }} m</span>
     <small v-if="T.usos.length">en los paquetes: {{ T.usos.join(' · ') }}</small><small v-else class="nada">ningún paquete la usa todavía</small>
    </li>
   </ul>
   <h3>Qué pone cada paquete</h3>
   <table class="paquetes"><thead><tr><th>Paquete</th><th>Muro de ladrillo</th><th>Muro de piedra</th><th>Muro de metal</th><th>Zócalo</th><th>Techo inclinado</th><th>Techo plano</th></tr></thead>
    <tbody><tr v-for="(P,k) in PAQUETES" :key="k" :class="{on:k===paquete}" @click="paquete=k"><th>{{ P.nombre }}</th><td v-for="t in [P.muro.ladrillo,P.muro.piedra,P.muro.metal,P.zocalo,P.mansarda,P.losa]">{{ TEXTURAS[t]?.nombre||'—' }}</td></tr></tbody></table>
  </main>
 </div>
</template>

<style scoped>
.cat{--tx:#f5f2ea;--tx2:#c3cad6;--tx3:#8e97a6;--panel:rgba(14,20,33,.86);--panel2:rgba(255,255,255,.05);--borde:rgba(255,255,255,.12);--ladron:#ffa94d;--ladron2:#ff7a3d;--ok:#45d483;
 --t:'Bungee',Impact,system-ui,sans-serif;--c:'Rubik Variable','Rubik',system-ui,-apple-system,'Segoe UI',sans-serif;
 position:fixed;inset:0;overflow:auto;background:#1b2530;color:var(--tx);font:13px/1.45 var(--c)}
.barra{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:10px 16px;background:var(--panel);border-bottom:1px solid var(--borde);backdrop-filter:blur(10px)}
.logo{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;font:400 11px var(--t);text-decoration:none;color:#2a1705;background:linear-gradient(135deg,var(--ladron),var(--ladron2));transform:rotate(-4deg)}
.titulo{font:400 16px var(--t);letter-spacing:.5px}
nav{display:flex;gap:4px}
button{font:inherit;color:var(--tx2);background:rgba(255,255,255,.07);border:1px solid var(--borde);border-radius:8px;padding:6px 12px;cursor:pointer}
button:hover{background:rgba(255,255,255,.14)}button.on{background:rgba(255,169,77,.18);border-color:rgba(255,169,77,.55);color:var(--tx)}
button b{font-weight:600;color:var(--tx3);margin-left:4px}
.sel{display:flex;align-items:center;gap:6px;color:var(--tx2)}
.sel select,.sel input{background:rgba(255,255,255,.08);border:1px solid var(--borde);border-radius:8px;color:var(--tx);padding:5px 8px;font:inherit}.sel input{width:70px}.sel option{color:#1b2130}
.ir{margin-left:auto;color:var(--tx);text-decoration:none;border:1px solid var(--borde);border-radius:8px;padding:6px 12px;background:rgba(255,255,255,.07)}
main{max-width:1500px;margin:0 auto;padding:18px 16px 60px}
.intro{margin:0 0 12px;color:var(--tx2);max-width:900px}
.filtros{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}
.grilla{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.grilla.muebles{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}
.grilla.fachadas{grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}
.grilla.texturas{grid-template-columns:repeat(auto-fill,minmax(360px,1fr))}
.grilla li{background:var(--panel2);border:1px solid var(--borde);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:5px;min-width:0}
.dibujo{background:#fbfaf6;border-radius:10px;display:grid;place-items:center;overflow:hidden;min-height:132px}
.dibujo.ancho{display:block;min-height:0}.dibujo.ancho canvas{display:block;width:100%}
.grilla li>b{font:400 14px var(--t);letter-spacing:.3px;margin-top:4px}
.grilla dl{display:grid;grid-template-columns:auto 1fr;gap:1px 8px;margin:0;font-variant-numeric:tabular-nums}
.grilla dt{color:var(--tx3);font-size:11px;text-transform:uppercase;letter-spacing:.5px}.grilla dd{margin:0;color:var(--tx2)}
.estado{font-size:12px;color:var(--tx2)}
.grilla small{color:var(--tx3);font-size:11.5px;line-height:1.4}.grilla small.nada{font-style:italic}
li.e-exacto .estado,button.e-exacto.on{color:var(--ok)}li.e-medida .estado{color:#8fb8ff}li.e-sobra .estado{color:var(--ladron)}li.e-malo .estado{color:#ff8a7a}li.e-malo{border-color:rgba(255,138,122,.45)}li.e-sin .estado{color:var(--tx3)}
i.alerta{color:var(--ladron);font-style:normal}
.estado-carga{font:400 16px var(--t);color:var(--tx2);padding:40px 0;text-align:center}
h3{font:400 15px var(--t);margin:26px 0 10px}
table.paquetes{border-collapse:collapse;width:100%;font-size:12.5px}
table.paquetes th,table.paquetes td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--borde);color:var(--tx2)}
table.paquetes thead th{color:var(--tx3);font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;font-weight:500}
table.paquetes tbody th{color:var(--tx);font-weight:600}table.paquetes tbody tr{cursor:pointer}table.paquetes tbody tr:hover{background:rgba(255,255,255,.05)}table.paquetes tr.on{background:rgba(255,169,77,.12)}
@media (max-width:640px){.ir{margin-left:0}table.paquetes{display:block;overflow-x:auto}}
</style>
