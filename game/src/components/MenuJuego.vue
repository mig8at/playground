<script setup>
// El menú del juego (2026-10-17, Miguel: «más que celular es como si entrara a un menú: ahí se ve lo que roba, puede editar
// su vestimenta, puede ver el retrato que sale en las noticias»). Se abre encima del juego (Tab) y el mundo sigue: mientras
// se mira el menú, no se ve la calle. Cada papel tiene sus pestañas:
// · ladrón: Botín (la mochila, lo guardado contra la meta, las guaridas), Ropa (cambiarse con la ropa que lleva en la
//   mochila; la piel y el pelo no cambian), Noticias (el «Se busca»: lo que la policía sabe de él, si lo difundió, y los
//   titulares de la ronda) y Equipo (los compañeros);
// · policía: Avisos (los robos), Retratos (los sospechosos; «Difundir en las noticias» es lo que ve el ladrón), Censo
//   (buscar a alguien por nombre: quién es, dónde vive) y Equipo (los compañeros y las patrullas).
// · los dos: Mapa (2026-10-18, lo de /prototipo/menu con los datos de la partida: components/MapaJuego.vue), primero.
// Prototipo: los datos llegan por props (datos) y lo que hace el jugador sale por eventos (accion); el juego lo conecta
// después. props: papel ('ladron' | 'policia'), datos, abierto. Emite cerrar y accion ({tipo, …}).
import {ref,computed,watch} from 'vue';
import MunecoVista from './MunecoVista.vue';
import MapaJuego from './MapaJuego.vue';
import {PALETTE} from '../lib/vestier3d.js';

const props=defineProps({papel:{type:String,default:'ladron'},datos:{type:Object,required:true},abierto:{type:Boolean,default:true},plano:{type:Object,default:null}});
const emit=defineEmits(['cerrar','accion']);
const PESTANAS={ladron:[['mapa','Mapa'],['botin','Botín'],['ropa','Ropa'],['noticias','Noticias'],['equipo','Equipo']],policia:[['mapa','Mapa'],['avisos','Avisos'],['retratos','Retratos'],['censo','Censo'],['equipo','Equipo']]};
const pestanas=computed(()=>PESTANAS[props.papel]),tab=ref(PESTANAS[props.papel][0][0]);
watch(()=>props.papel,p=>{tab.value=PESTANAS[p][0][0];});
const D=computed(()=>props.datos);
const parte=(a,b)=>Math.min(100,Math.round(100*a/Math.max(1,b)));
// (la ropa: lo puesto y lo que lleva en la mochila, por parte del cuerpo)
const PARTES={top:'Arriba',outer:'Encima',bottom:'Abajo',shoes:'Calzado',hat:'Cabeza'};
const slotColor=ref(null);// (la prenda puesta a la que se le está eligiendo color)
const ropaPara=slot=>(D.value.ropa?.mochila||[]).filter(p=>p.slot===slot);
const censoQ=ref('');const censoR=computed(()=>{const q=censoQ.value.trim().toLowerCase();if(q.length<3)return [];return (D.value.censo||[]).filter(p=>p.nombre.toLowerCase().includes(q)).slice(0,8);});
const enCenso=computed(()=>censoQ.value.trim().length>=3&&!censoR.value.length);
// (Escape cierra; la Tab la maneja la página, que también lo abre)
function tecla(e){if(e.key==='Escape'){e.preventDefault();emit('cerrar');}}
</script>

<template>
 <div v-if="abierto" class="menu" :class="papel" role="dialog" aria-modal="true" :aria-label="papel==='ladron'?'Menú del ladrón':'Menú de la policía'" tabindex="-1" @keydown="tecla">
  <div class="panel" :class="{grande:tab==='mapa'}">
   <header>
    <div class="quien"><b>{{ D.nombre }}</b><span>{{ papel==='ladron'?'Ladrón':'Policía' }}<template v-if="D.alias"> · {{ D.alias }}</template></span></div>
    <div class="reloj"><span>{{ D.hora }}</span><small>quedan {{ D.resta }}</small></div>
    <button class="x" @click="emit('cerrar')" aria-label="Cerrar el menú (Tab)">Tab · volver</button>
   </header>
   <nav role="tablist"><button v-for="[id,label] in pestanas" :key="id" role="tab" :aria-selected="tab===id" :class="{on:tab===id}" @click="tab=id">{{ label }}<i v-if="id==='noticias'&&D.noticias?.retrato?.difundido" class="punto" aria-label="hay novedades"></i></button></nav>

   <!-- ================= EL MAPA (los dos) ================= -->
   <section v-if="tab==='mapa'" class="cuerpo mapa-tab">
    <MapaJuego v-if="D.mapa&&plano" :plano="plano" :datos="D.mapa" :yo="D.cuerpo?{cuerpo:D.cuerpo,ropa:D.ropaPuesta}:null" />
    <p v-else class="nota">El mapa aparece cuando empieza la ronda.</p>
   </section>

   <!-- ================= EL LADRÓN ================= -->
   <section v-if="papel==='ladron'&&tab==='botin'" class="cuerpo dos">
    <div>
     <h3>En la mochila <b>{{ D.mochilaTotal }}</b></h3>
     <p class="nota">Si te atrapan con esto encima, vas preso y se pierde. Guardalo en la caja de una guarida.</p>
     <ul class="lista"><li v-for="o in D.mochila" :key="o.nombre+o.hora"><span class="obj">{{ o.nombre }}</span><small>{{ o.donde }} · {{ o.hora }}</small><b>{{ o.precio }}</b></li>
      <li v-if="!D.mochila.length" class="vacio">La mochila está vacía.</li></ul>
    </div>
    <div>
     <h3>Guardado del equipo</h3>
     <div class="meta"><b>{{ D.guardado }}</b><span>de {{ D.meta }}</span></div>
     <div class="barra" role="progressbar" :aria-valuenow="parte(D.guardadoN,D.metaN)" aria-valuemin="0" aria-valuemax="100"><i :style="{width:parte(D.guardadoN,D.metaN)+'%'}"></i></div>
     <h3 class="sep">Guaridas de esta ronda</h3>
     <ul class="lista"><li v-for="g in D.guaridas" :key="g.texto"><span class="obj">{{ g.texto }}</span><small class="lejos">{{ g.lejos }}</small><em v-if="g.tuya" class="tag">la tuya</em></li></ul>
    </div>
   </section>

   <section v-if="papel==='ladron'&&tab==='ropa'" class="cuerpo ropa">
    <div class="vista"><MunecoVista :cuerpo="D.cuerpo" :ropa="D.ropa.puesto" /></div>
    <div>
     <h3>Cambiarte de ropa</h3>
     <p class="nota">Con lo que llevás en la mochila, o cambiándole el color a lo que tenés puesto (tocá la prenda). Toma {{ D.ropa.tiempo }} s quieto. La piel, el pelo y la barba no cambian: es lo que sale en el retrato.</p>
     <div v-for="(label,slot) in PARTES" :key="slot" class="parte">
      <span class="lbl">{{ label }}</span>
      <div class="prendas">
       <button v-if="D.ropa.puesto[slot]" class="prenda on" :class="{abierta:slotColor===slot}" :aria-expanded="slotColor===slot" :title="'Puesto: '+D.ropa.puesto[slot].label+' · tocá para cambiarle el color'" @click="slotColor=slotColor===slot?null:slot"><i :style="{background:D.ropa.puesto[slot].color}"></i>{{ D.ropa.puesto[slot].label }}<small>color</small></button>
       <span v-else class="prenda nada">nada</span>
       <button v-for="p in ropaPara(slot)" :key="p.id+p.color" class="prenda" @click="emit('accion',{tipo:'vestir',slot,prenda:p})"><i :style="{background:p.color}"></i>{{ p.label }}</button>
       <button v-if="D.ropa.puesto[slot]&&slot!=='top'&&slot!=='bottom'&&slot!=='shoes'" class="prenda quitar" @click="emit('accion',{tipo:'quitar',slot})">Quitar</button>
       <div v-if="slotColor===slot&&D.ropa.puesto[slot]" class="paleta" role="group" :aria-label="'Color de '+D.ropa.puesto[slot].label">
        <button v-for="c in PALETTE" :key="c" :aria-label="'color '+c" :class="{on:D.ropa.puesto[slot].color===c}" :style="{background:c}" @click="emit('accion',{tipo:'color',slot,color:c});slotColor=null"></button></div>
      </div>
     </div>
    </div>
   </section>

   <section v-if="papel==='ladron'&&tab==='noticias'" class="cuerpo dos">
    <div>
     <div v-if="D.noticias.retrato" class="cartel" :class="{difundido:D.noticias.retrato.difundido}">
      <span class="sello">{{ D.noticias.retrato.difundido?'SE BUSCA':'LA POLICÍA TIENE TU RETRATO' }}</span>
      <div class="foto"><MunecoVista :cuerpo="D.cuerpo" :ropa="D.noticias.retrato.ropaVista" :gira="false" fondo="#cfc6b4" /></div>
      <dl><dt>Rasgos</dt><dd>{{ D.noticias.retrato.rasgos }}</dd><dt>Vestía</dt><dd>{{ D.noticias.retrato.ropa }}</dd><dt>Visto</dt><dd>{{ D.noticias.retrato.visto }}</dd></dl>
      <p class="nota">{{ D.noticias.retrato.difundido?'Salió en las noticias: cualquiera que te vea puede avisar.':'Todavía no lo difundieron.' }} Cambiate de ropa: los rasgos no cambian, la ropa sí.</p>
     </div>
     <div v-else class="cartel limpio"><span class="sello">SIN RETRATO</span><p>La policía no tiene tu cara. Las cámaras graban al que sale con la mochila llena de un lugar con cámaras.</p></div>
    </div>
    <div>
     <h3>Titulares</h3>
     <ul class="titulares"><li v-for="t in D.noticias.titulares" :key="t.hora+t.texto"><small>{{ t.hora }}</small>{{ t.texto }}</li></ul>
    </div>
   </section>

   <section v-if="tab==='equipo'" class="cuerpo">
    <h3>{{ papel==='ladron'?'Tu banda':'Tus compañeros' }}</h3>
    <ul class="lista equipo"><li v-for="c in D.equipo" :key="c.nombre"><span class="obj">{{ c.nombre }}</span><small>{{ c.donde }}</small><em class="tag" :class="c.estado">{{ c.estado }}</em><b v-if="c.mochila">{{ c.mochila }}</b></li></ul>
    <p v-if="papel==='ladron'&&D.equipo.some(c=>c.estado==='preso')" class="nota">Un compañero libre puede rescatar a los presos en la puerta de la comisaría.</p>
    <template v-if="papel==='policia'">
     <h3 class="sep">Patrullas</h3>
     <ul class="lista"><li v-for="p in D.patrullas" :key="p.id"><span class="obj">{{ p.id }}</span><small>{{ p.donde }}</small><em class="tag" :class="p.estado">{{ p.estado }}</em></li></ul>
    </template>
   </section>

   <!-- ================= LA POLICÍA ================= -->
   <section v-if="papel==='policia'&&tab==='avisos'" class="cuerpo">
    <h3>Avisos de la ronda <b>{{ D.avisos.length }}</b></h3>
    <ul class="lista avisos"><li v-for="a in D.avisos" :key="a.hora+a.donde" :class="{visto:a.revisado}"><span class="tipo" :class="a.tipo.toLowerCase()">{{ a.tipo }}</span><span class="obj">{{ a.que }}</span><small>{{ a.donde }} · {{ a.hora }}</small>
     <em class="tag" :class="a.revisado?'libre':''">{{ a.revisado?'cámara revisada':'sin revisar' }}</em><button class="mini" @click="emit('accion',{tipo:'marcar',aviso:a})">En el plano</button></li></ul>
   </section>

   <section v-if="papel==='policia'&&tab==='retratos'" class="cuerpo">
    <h3>Sospechosos</h3>
    <p class="nota">De la cámara de un robo o del censo (el nombre que dio no es de ninguna familia). Difundirlo lo pone en las noticias: lo ve toda la ciudad, y también él.</p>
    <ul class="lista retratos"><li v-for="r in D.retratos" :key="r.id"><div><span class="obj">{{ r.rasgos }}</span><small>vestía {{ r.ropa }} · visto {{ r.visto }}</small><small v-if="r.dice">dice llamarse {{ r.dice }}</small></div>
     <em class="tag" :class="r.estado">{{ r.estado }}</em>
     <button class="mini" :disabled="r.difundido||r.estado!=='libre'" @click="emit('accion',{tipo:'difundir',retrato:r})">{{ r.difundido?'En las noticias':'Difundir' }}</button></li>
     <li v-if="!D.retratos.length" class="vacio">Todavía no hay retratos: revisá la cámara de un robo.</li></ul>
   </section>

   <section v-if="papel==='policia'&&tab==='censo'" class="cuerpo">
    <h3>Censo</h3>
    <label class="buscar"><span>Nombre</span><input v-model="censoQ" placeholder="por ejemplo, Juan Arango" autocomplete="off" /></label>
    <ul class="lista"><li v-for="p in censoR" :key="p.id"><span class="obj">{{ p.nombre }}</span><small>{{ p.edad }} años · {{ p.oficio }} · vive en {{ p.vive }}</small></li></ul>
    <p v-if="enCenso" class="nota alerta">No hay nadie con ese nombre en la ciudad. Si alguien te lo dio en los papeles, mintió.</p>
    <p v-else-if="censoQ.trim().length<3" class="nota">{{ D.censo.length }} personas en {{ D.hogares }} hogares. Escribí al menos tres letras.</p>
   </section>
  </div>
 </div>
</template>

<style scoped>
.menu{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:16px;background:rgba(8,10,14,.5);backdrop-filter:blur(6px);color:#f3f1ec;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.panel{width:min(980px,100%);height:min(640px,100%);display:grid;grid-template-rows:auto auto 1fr;background:rgba(22,26,31,.88);border:1px solid rgba(255,255,255,.1);border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.45)}
header{display:flex;align-items:center;gap:16px;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.08)}
.quien b{display:block;font-size:17px}.quien span{font-size:12px;opacity:.75}
.menu.ladron .quien span{color:#f0b38a}.menu.policia .quien span{color:#9cc3ef}
.reloj{margin-left:auto;text-align:right}.reloj span{display:block;font-weight:700;text-transform:capitalize}.reloj small{opacity:.7}
.x{border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit;border-radius:9px;padding:6px 10px;cursor:pointer;font:inherit;font-size:12px}
nav{display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.08);overflow-x:auto}
nav button{position:relative;border:0;background:transparent;color:inherit;opacity:.7;padding:8px 14px;border-radius:9px;cursor:pointer;font:inherit;font-weight:600;white-space:nowrap}
nav button.on{opacity:1;background:rgba(255,255,255,.1)}
.punto{position:absolute;top:6px;right:5px;width:7px;height:7px;border-radius:50%;background:#e0453a}
.cuerpo{padding:16px 18px;overflow:auto}
.panel.grande{width:min(1320px,100%);height:min(860px,100%)}.mapa-tab{padding:12px;overflow:hidden;min-height:0}
.cuerpo.dos{display:grid;grid-template-columns:1fr 1fr;gap:22px}
.cuerpo.ropa{display:grid;grid-template-columns:minmax(200px,300px) 1fr;gap:20px}
h3{margin:0 0 8px;font-size:13px;letter-spacing:.3px;text-transform:uppercase;opacity:.8;display:flex;gap:8px;align-items:baseline}h3 b{text-transform:none;font-size:16px;opacity:1;color:#e3c46a}
h3.sep{margin-top:18px}
.nota{font-size:12.5px;opacity:.75;margin:0 0 10px}.nota.alerta{color:#f29b8f;opacity:1}
.lista{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.lista li{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.05)}
.lista li>div{flex:1;display:flex;flex-direction:column}
.lista .obj{font-weight:600}.lista small{opacity:.7;flex:1;font-size:12px}.lista small.lejos{flex:none;white-space:nowrap}.lista b{color:#e3c46a;font-variant-numeric:tabular-nums}
.lista .vacio{opacity:.6;justify-content:center}
.tag{font-style:normal;font-size:11px;padding:2px 8px;border-radius:20px;background:rgba(255,255,255,.12);white-space:nowrap}
.tag.libre{background:#2f5a3c}.tag.preso{background:#6a2c2c}.tag.detenido{background:#6a5a2c}.tag.estacionada{background:#2c4a6a}.tag.manejando{background:#3d6fb0}
.meta{display:flex;align-items:baseline;gap:8px}.meta b{font-size:22px;color:#e3c46a}.meta span{opacity:.7}
.barra{height:8px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden;margin:8px 0}.barra i{display:block;height:100%;background:#e3c46a}
.vista{border-radius:12px;background:radial-gradient(circle at 50% 35%,#3a4350,#1d2228);min-height:300px;overflow:hidden}
.parte{display:grid;grid-template-columns:70px 1fr;gap:10px;align-items:start;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.parte .lbl{font-size:12px;opacity:.7;padding-top:6px}
.prendas{display:flex;flex-wrap:wrap;gap:6px}
.prenda{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:inherit;border-radius:8px;padding:5px 9px;cursor:pointer;font:inherit;font-size:12.5px}
.prenda i{width:12px;height:12px;border-radius:3px;border:1px solid rgba(0,0,0,.3)}
.prenda.on{border-color:#e3c46a;background:rgba(227,196,106,.14)}.prenda.on small{opacity:.6;font-size:10.5px;margin-left:2px}.prenda.abierta{box-shadow:0 0 0 2px #e3c46a}
.paleta{flex-basis:100%;display:flex;flex-wrap:wrap;gap:6px;padding:6px 0 2px}.paleta button{width:22px;height:22px;border-radius:50%;border:2px solid rgba(255,255,255,.25);cursor:pointer}.paleta button.on{border-color:#e3c46a;box-shadow:0 0 0 2px #e3c46a}.prenda.nada{opacity:.5;cursor:default}.prenda.quitar{opacity:.75}
.cartel{border-radius:12px;padding:12px;background:#efe6d2;color:#2c2620;display:grid;grid-template-columns:150px 1fr;gap:10px;position:relative}
.cartel .sello{grid-column:1/-1;font-weight:900;letter-spacing:2px;font-size:15px;color:#8b2c1f}
.cartel.difundido .sello{font-size:22px}
.cartel .foto{height:190px;border-radius:8px;overflow:hidden;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.2)}
.cartel dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:4px 10px;align-content:start;font-size:13px}.cartel dt{font-weight:700}.cartel dd{margin:0}
.cartel .nota{grid-column:1/-1;color:#5a4c3c;opacity:1;margin:0}
.cartel.limpio{display:block;background:#dfe8de}.cartel.limpio .sello{color:#2f5a3c}
.titulares{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.titulares li{padding:8px 10px;border-left:3px solid #e3c46a;background:rgba(255,255,255,.04);border-radius:0 8px 8px 0}.titulares small{display:block;opacity:.6;font-size:11px}
.avisos .tipo{font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;background:#6a2c2c}.avisos .tipo.cámara{background:#2c4a6a}.avisos .tipo.llamada{background:#6a5a2c}
.avisos li.visto{opacity:.7}
.mini{border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:inherit;border-radius:8px;padding:4px 9px;cursor:pointer;font:inherit;font-size:12px;white-space:nowrap}
.mini:disabled{opacity:.5;cursor:default}
.buscar{display:flex;flex-direction:column;gap:4px;margin-bottom:10px;max-width:420px}.buscar span{font-size:12px;opacity:.7}
.buscar input{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);border-radius:9px;color:inherit;padding:8px 10px;font:inherit}
@media (max-width:720px){.cuerpo.dos,.cuerpo.ropa{grid-template-columns:1fr}.cartel{grid-template-columns:110px 1fr}.cartel .foto{height:150px}header{flex-wrap:wrap}}
</style>
