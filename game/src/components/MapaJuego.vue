<script setup>
// El mapa del menú del juego (2026-10-18, Miguel: «que el mapa sirva para ver dónde se guardan los robos y la banda; la
// policía, el lugar robado y los ladrones para buscarlos; los lugares pintando el edificio, sin tanto texto, zoom y clic
// para ver la información al costado»). Lo diseñado en /prototipo/menu, con los datos de la partida (persecucion3d
// mapa()): cada lugar pinta su edificio entero ('L'+lote o 'C'+casa), la gente es un punto que crece poco con el zoom,
// y lo que se toca abre su ficha a la derecha. De policía, el «?» en vivo del rastro (RASTRO) con su anillo que se vacía,
// la zona amarilla de dónde se vio a cada ladrón por última vez y la guarida delatada con la cuenta de la orden.
// props: plano (el plano de la ciudad), datos (persec.mapa()), yo ({cuerpo, ropa}: el muñeco del jugador).
import {ref,computed,onMounted,onBeforeUnmount,nextTick,watch} from 'vue';
import MunecoVista from './MunecoVista.vue';
import {drawWorldStage} from '../lib/drawPlan.js';
import {RASTRO,ALLANAMIENTO} from '../engine/medidas.js';
const props=defineProps({plano:{type:Object,required:true},datos:{type:Object,required:true},yo:{type:Object,default:null}});
const D=computed(()=>props.datos),papel=computed(()=>props.datos.papel);
const plata=v=>'$'+Math.round((v||0)*1e6).toLocaleString('es-CO');
const {porMinuto:ZONA,min:ZONA_MIN,max:ZONA_MAX}=RASTRO.zona;

// ---------- los edificios del plano (para pintarlos) ----------
const edificios=computed(()=>{const bp=props.plano,I=bp.isla||{},E=new Map();
 for(const l of [...bp.lots,...(I.lots||[])])if(l.rect)E.set('L'+l.id,{id:'L'+l.id,nombre:l.shopName||l.name||'Edificio',x:l.rect.x+l.rect.w/2,z:l.rect.y+l.rect.h/2,partes:l.parts});
 (I.casas||[]).forEach((c,i)=>E.set('C'+i,{id:'C'+i,nombre:'Casa · '+(c.direccion?.texto||''),x:c.x,z:c.z,casa:{w:c.w,d:c.d,ry:c.ry||0}}));return E;});
const lista=computed(()=>[...edificios.value.values()]);
const B=computed(()=>props.plano.isla.bounds);
const pct=(x,z)=>{const b=B.value;return [(x/6-b.x0)/(b.x1-b.x0)*100,(z/6-b.y0)/(b.y1-b.y0)*100];};
const pos=(x,z)=>{const [l,t]=pct(x,z);return {left:l+'%',top:t+'%'};};
const piezas=id=>{const e=edificios.value.get(id);if(!e)return [];const b=B.value,W=(b.x1-b.x0)*6,H=(b.y1-b.y0)*6;
 if(e.casa){const [l,t]=pct(e.x,e.z);return [{left:l+'%',top:t+'%',width:e.casa.w/W*100+'%',height:e.casa.d/H*100+'%',transform:`translate(-50%,-50%) rotate(${-e.casa.ry}rad)`}];}
 return e.partes.map(P=>{const [l,t]=pct(P.x,P.y);return {left:l+'%',top:t+'%',width:P.w/W*100+'%',height:P.h/H*100+'%'};});};
// (un lugar sin edificio —un aviso en la calle—: el edificio más cercano a menos de 14 m, o ninguno)
const cercano=(x,z)=>{let m=null,bd=14;for(const e of lista.value){const d=Math.hypot(e.x-x,e.z-z);if(d<bd){bd=d;m=e;}}return m?.id||null;};
const edifDe=o=>o.edificio&&edificios.value.has(o.edificio)?o.edificio:cercano(o.x,o.z);
const radio=v=>Math.min(ZONA_MAX,Math.max(ZONA_MIN,v.hace*ZONA));
const zonaDe=v=>{const r=radio(v);return lista.value.map(e=>({e,d:Math.hypot(e.x-v.x,e.z-v.z)})).filter(o=>o.d<=r).map(o=>({id:o.e.id,cerca:1-o.d/r}));};

// ---------- las capas ----------
const CAPAS={ladron:[['banda','La banda'],['guaridas','Guaridas'],['robos','Robos'],['policia','Policía vista']],policia:[['vivos','En vivo'],['vistos','Vistos'],['robos','Robos'],['equipo','Tu equipo'],['delatadas','Guaridas']]};
const capas=ref({banda:true,guaridas:true,robos:true,policia:true,vivos:true,vistos:true,equipo:true,delatadas:true});

// ---------- lo que se toca: su ficha ----------
const sel=ref(null);
const elegido=computed(()=>{const s=sel.value,d=D.value;if(!s)return null;
 const L={banda:d.banda,guarida:d.guaridas,robo:d.robos,policia:d.policia,equipo:d.equipo,vivo:d.vivos,visto:d.vistos,delatada:d.delatadas}[s.tipo];
 if(s.tipo==='comisaria')return {tipo:'comisaria',...d.comisaria,id:'cai'};const o=L?.find(o=>o.id===s.id);return o?{tipo:s.tipo,...o}:null;});

// ---------- el zoom: rueda, + y −, arrastrar, doble clic; al tocar algo se acerca ----------
const vp=ref(null),lienzo=ref(null),vista=ref({k:1,x:0,y:0}),base=ref({w:0,h:0}),suave=ref(false);let arr=null;
const tamPunto=computed(()=>Math.max(.42,Math.min(1.1,.42*vista.value.k**.6)));
function encuadrar(){const c=vp.value,b=B.value;if(!c)return;const W=c.clientWidth,H=c.clientHeight,a=(b.x1-b.x0)/(b.y1-b.y0),w=Math.min(W,H*a),h=w/a;base.value={w,h};
 const E=props.plano.lots.filter(l=>l.rect).map(l=>pct(l.rect.x+l.rect.w/2,l.rect.y+l.rect.h/2)).concat((props.plano.isla?.casas||[]).map(c=>pct(c.x,c.z)));
 if(!E.length){vista.value={k:1,x:(W-w)/2,y:(H-h)/2};return;}
 const x0=Math.min(...E.map(p=>p[0]))-4,x1=Math.max(...E.map(p=>p[0]))+4,y0=Math.min(...E.map(p=>p[1]))-4,y1=Math.max(...E.map(p=>p[1]))+4;
 const k=Math.max(1,Math.min(W/(w*(x1-x0)/100),H/(h*(y1-y0)/100)));vista.value={k,x:W/2-(x0+x1)/200*w*k,y:H/2-(y0+y1)/200*h*k};}
function zoomEn(px,py,k2){const v=vista.value,k=Math.max(1,Math.min(6,k2));vista.value={k,x:px-(px-v.x)*k/v.k,y:py-(py-v.y)*k/v.k};}
function rueda(ev){const r=vp.value.getBoundingClientRect();suave.value=false;zoomEn(ev.clientX-r.left,ev.clientY-r.top,vista.value.k*Math.exp(-ev.deltaY*.0015));}
const boton=f=>{suave.value=true;if(!f)return encuadrar();const c=vp.value;zoomEn(c.clientWidth/2,c.clientHeight/2,vista.value.k*f);};
function baja(ev){arr={x:ev.clientX,y:ev.clientY,vx:vista.value.x,vy:vista.value.y,movio:false};}
function mueve(ev){if(!arr)return;const dx=ev.clientX-arr.x,dy=ev.clientY-arr.y;if(Math.hypot(dx,dy)>4)arr.movio=true;if(arr.movio){suave.value=false;vista.value={...vista.value,x:arr.vx+dx,y:arr.vy+dy};}}
function suelta(){setTimeout(()=>{arr=null;},0);}
function tocar(tipo,o){if(arr?.movio)return;sel.value={tipo,id:o.id};const c=vp.value,[l,t]=pct(o.x,o.z),k=Math.max(vista.value.k,2.6);
 suave.value=true;vista.value={k,x:c.clientWidth/2-l/100*base.value.w*k,y:c.clientHeight/2-t/100*base.value.h*k};}
function dobleClic(ev){const r=vp.value.getBoundingClientRect();suave.value=true;zoomEn(ev.clientX-r.left,ev.clientY-r.top,vista.value.k*1.8);}
// (el plano se dibuja una vez por ciudad y se guarda: abrir el menú no lo vuelve a dibujar)
const dibujados=new WeakMap();
function dibujar(){const c=lienzo.value;if(!c)return;let img=dibujados.get(props.plano);
 if(!img){img=document.createElement('canvas');drawWorldStage(img,props.plano,{cell:14,stage:3,fronts:false,dim:false});dibujados.set(props.plano,img);}
 c.width=img.width;c.height=img.height;c.getContext('2d').drawImage(img,0,0);}
onMounted(async()=>{await nextTick();dibujar();encuadrar();addEventListener('resize',encuadrar);});
onBeforeUnmount(()=>removeEventListener('resize',encuadrar));
watch(()=>props.plano,()=>{dibujar();encuadrar();});
// lo que avisa arriba del mapa: de ladrón, si la policía ve a alguien de la banda en vivo o una guarida quedó delatada;
// de policía, cada «?» en vivo y cada guarida delatada
const alertas=computed(()=>{const d=D.value,out=[];
 if(papel.value==='ladron'){for(const b of d.banda)if(b.rastro)out.push({k:'r'+b.id,n:b.rastro,txt:b.yo?'La policía te ve en su mapa · perdete antes de que se acabe':`La policía ve a ${b.nombre} en su mapa`,tipo:'banda',o:b});
  for(const g of d.guaridas)if(g.delatada!=null)out.push({k:'g'+g.id,n:g.delatada||'¡Ya!',txt:g.delatada?`Te vieron guardar: pueden allanar la guarida · sacá el botín`:'La policía ya puede allanar la guarida',tipo:'guarida',o:g,allan:true});}
 else{for(const v of d.vivos)out.push({k:v.id,n:v.quedan,txt:'Un ladrón en vivo: alcanzalo antes de perder el rastro',tipo:'vivo',o:v});
  for(const g of d.delatadas)out.push({k:'d'+g.id,n:g.quedan||'¡Ya!',txt:g.quedan?'Guardaron botín con la policía encima: la orden llega pronto':'Orden lista: andá a la puerta y allanala',tipo:'delatada',o:g,allan:true});}
 return out.slice(0,3);});
</script>

<template>
 <div class="mapa-juego" :class="papel">
  <section class="plano">
   <div ref="vp" class="lienzo" @wheel.prevent="rueda" @pointerdown="baja" @pointermove="mueve" @pointerup="suelta" @pointerleave="suelta" @dblclick="dobleClic">
    <div class="marco" :class="{suave,lejos:tamPunto<.65}" :style="{width:base.w+'px',height:base.h+'px','--k':vista.k,'--pk':tamPunto/vista.k,transform:`translate(${vista.x}px,${vista.y}px) scale(${vista.k})`}">
     <canvas ref="lienzo" aria-label="El plano de la ciudad"></canvas>
     <template v-if="papel==='ladron'">
      <template v-if="capas.robos"><template v-for="r in D.robos" :key="r.id"><span v-for="(p,i) in piezas(edifDe(r))" :key="i" class="edif robo" :class="{vivo:r.reciente,sel:sel?.id===r.id}" :style="p" @click="tocar('robo',r)"></span></template></template>
      <template v-if="capas.guaridas"><template v-for="g in D.guaridas" :key="g.id"><span v-for="(p,i) in piezas(g.edificio)" :key="i" class="edif guarida" :class="{delatada:g.delatada!=null,allanada:g.cerrada,sel:sel?.id===g.id}" :style="p" @click="tocar('guarida',g)"></span>
       <span class="signo guarida" :style="pos(edificios.get(g.edificio)?.x??g.x,edificios.get(g.edificio)?.z??g.z)" @click="tocar('guarida',g)"><i>$</i></span></template></template>
      <template v-if="capas.policia"><span v-for="c in D.policia" :key="c.id" class="punto poli" :class="{vista:!c.vivo,sel:sel?.id===c.id}" :style="pos(c.x,c.z)" @click="tocar('policia',c)"><i></i></span></template>
      <template v-if="capas.banda"><span v-for="b in D.banda" :key="b.id" class="punto banda" :class="[b.estado,{yo:b.yo,rastreado:b.rastro,sel:sel?.id===b.id}]" :style="{...pos(b.x,b.z),'--p':b.rastro/RASTRO.robo}" @click="tocar('banda',b)"><i>{{ b.nombre.slice(0,1) }}</i></span></template>
     </template>
     <template v-else>
      <template v-if="capas.vistos"><template v-for="v in D.vistos" :key="v.id"><template v-for="z in zonaDe(v)" :key="z.id"><span v-for="(p,i) in piezas(z.id)" :key="i" class="edif zona" :class="{sel:sel?.id===v.id}" :style="{...p,'--c':z.cerca}" @click="tocar('visto',v)"></span></template></template></template>
      <template v-if="capas.robos"><template v-for="r in D.robos" :key="r.id"><span v-for="(p,i) in piezas(edifDe(r))" :key="i" class="edif robo" :class="{vivo:r.reciente,sel:sel?.id===r.id}" :style="p" @click="tocar('robo',r)"></span></template></template>
      <template v-if="capas.delatadas"><template v-for="g in D.delatadas" :key="g.id"><span v-for="(p,i) in piezas(g.edificio)" :key="i" class="edif delatada" :class="{lista:!g.quedan,sel:sel?.id===g.id}" :style="p" @click="tocar('delatada',g)"></span></template>
       <template v-for="g in D.allanadas" :key="'a'+g.id"><span v-for="(p,i) in piezas(g.edificio)" :key="i" class="edif allanada" :style="p"></span></template></template>
      <span v-for="(p,i) in piezas(D.comisaria.edificio)" :key="'c'+i" class="edif cai" :class="{sel:sel?.tipo==='comisaria'}" :style="p" @click="tocar('comisaria',{id:'cai',...D.comisaria})"></span>
      <template v-if="capas.vistos"><span v-for="v in D.vistos" :key="'p'+v.id" class="punto visto" :class="{sel:sel?.id===v.id}" :style="pos(v.x,v.z)" @click="tocar('visto',v)"><i>?</i></span></template>
      <template v-if="capas.vivos"><span v-for="v in D.vivos" :key="v.id" class="punto visto vivo" :class="{sel:sel?.id===v.id}" :style="{...pos(v.x,v.z),'--p':v.quedan/v.total}" @click="tocar('vivo',v)"><i>?</i></span></template>
      <template v-if="capas.equipo"><span v-for="e in D.equipo" :key="e.id" class="punto poli" :class="{yo:e.yo,sel:sel?.id===e.id}" :style="pos(e.x,e.z)" @click="tocar('equipo',e)"><i>{{ e.nombre.replace('Agente ','').slice(0,1) }}</i></span></template>
     </template>
    </div>
    <div v-for="(a,i) in alertas" :key="a.k" class="alerta" :class="{allan:a.allan}" :style="{top:(10+52*i)+'px'}" @pointerdown.stop @click="tocar(a.tipo,a.o)"><b>{{ a.n }}</b><span>{{ a.txt }}</span></div>
    <div class="zoom" @pointerdown.stop @dblclick.stop><button aria-label="Acercar" @click="boton(1.6)">+</button><button aria-label="Alejar" @click="boton(1/1.6)">−</button><button aria-label="Ver toda la ciudad" @click="boton(0)">⤢</button></div>
   </div>
   <div class="capas" role="group" aria-label="Capas del mapa"><button v-for="[k,l] in CAPAS[papel]" :key="k" :class="[k,{on:capas[k]}]" :aria-pressed="capas[k]" @click="capas[k]=!capas[k]"><i></i>{{ l }}</button></div>
  </section>

  <aside class="ficha" :class="elegido?.tipo">
   <p v-if="!elegido" class="pista">Tocá un edificio pintado o a alguien para ver qué pasa ahí. La rueda acerca y aleja; arrastrá para moverte.</p>
   <template v-else>
    <button class="cerrar" aria-label="Cerrar la ficha" @click="sel=null">×</button>
    <template v-if="elegido.tipo==='banda'"><small class="tipo">La banda{{ elegido.yo?' · vos':'' }}</small><b class="titulo">{{ elegido.nombre }}</b>
     <div v-if="elegido.rastro" class="aviso-rastro">La policía lo ve en su mapa: {{ elegido.rastro }} s para perderse</div>
     <div class="retrato" :class="elegido.estado"><MunecoVista v-if="elegido.cuerpo||yo" :key="elegido.id" :cuerpo="elegido.cuerpo||yo.cuerpo" :ropa="elegido.ropa||yo.ropa" /><span class="estado-tag">{{ elegido.estado }}</span></div>
     <div class="viste"><small>Cómo se ve</small><b>{{ elegido.aspecto.titulo }}</b><span>{{ elegido.aspecto.detalle }}</span></div>
     <dl><template v-if="elegido.cubierta"><dt>Se hace pasar por</dt><dd>{{ elegido.cubierta.nombre }} · {{ elegido.cubierta.oficio }}</dd></template>
      <dt>La policía sabe</dt><dd>{{ elegido.difundido?'su retrato salió en las noticias':elegido.retrato?'tiene su retrato':'nada' }}</dd>
      <dt>Lleva encima</dt><dd class="plata">{{ elegido.mochila?plata(elegido.mochila):'nada' }}</dd></dl></template>
    <template v-else-if="elegido.tipo==='guarida'"><small class="tipo">Guarida</small><b class="titulo">{{ elegido.nombre }}</b>
     <div v-if="elegido.cerrada" class="aviso-rastro allan-txt">La policía la allanó: ya no sirve.</div>
     <div v-else-if="elegido.delatada!=null" class="aviso-rastro allan-txt">Te vieron guardar con la policía encima: {{ elegido.delatada?'la pueden allanar en '+elegido.delatada+' s. Sacá el botín en la caja.':'ya la pueden allanar.' }}</div>
     <dl><dt>Guardado</dt><dd class="plata">{{ plata(elegido.guardado) }}</dd></dl></template>
    <template v-else-if="elegido.tipo==='robo'"><small class="tipo">{{ elegido.reciente?'Robo · recién':'Robo' }}</small><b class="titulo">{{ elegido.lugar }}</b><span class="donde">{{ elegido.hace }}</span>
     <dl><dt>Aviso</dt><dd>{{ elegido.aviso==='llamada'?'llamaron los vecinos':elegido.aviso==='robo'?'se robó sin alarma':'sonó la alarma' }}</dd></dl></template>
    <template v-else-if="elegido.tipo==='policia'"><small class="tipo">Policía vista</small><b class="titulo">{{ elegido.vivo?'Ahora':'La viste '+elegido.hace }}</b><span class="donde">{{ elegido.vivo?'la tenés a la vista':'puede haberse movido' }}</span></template>
    <template v-else-if="elegido.tipo==='equipo'"><small class="tipo">Tu equipo{{ elegido.yo?' · vos':'' }}</small><b class="titulo">{{ elegido.yo?'Vos':elegido.nombre }}</b>
     <div class="retrato poli"><MunecoVista v-if="elegido.cuerpo||yo" :key="elegido.id" :cuerpo="elegido.cuerpo||yo.cuerpo" :ropa="elegido.ropa||yo.ropa" /><span class="estado-tag">{{ elegido.estado }}</span></div>
     <dl v-if="elegido.tarea"><dt>Ahora</dt><dd>{{ {perseguir:'persigue a alguien',aviso:'va a un aviso',papeles:'pide papeles',cuidar:'cuida a los presos',patrullar:'patrulla',allanar:'va a allanar una guarida'}[elegido.tarea]||elegido.tarea }}</dd></dl></template>
    <template v-else-if="elegido.tipo==='vivo'"><small class="tipo vivo-rojo">● En vivo · quedan {{ elegido.quedan }} s</small><b class="titulo">Un ladrón</b><span class="donde">acaba de robar o de huir: lo vemos mientras dure el rastro</span>
     <div class="cuenta"><i :style="{width:elegido.quedan/elegido.total*100+'%'}"></i></div>
     <dl v-if="elegido.retrato"><dt>Su retrato</dt><dd>{{ elegido.retrato }}</dd></dl></template>
    <template v-else-if="elegido.tipo==='visto'"><small class="tipo">Visto por última vez</small><b class="titulo">{{ elegido.fuente==='rastro'?'Se perdió el rastro':'Un ladrón reconocido' }}</b><span class="donde">{{ elegido.haceTxt }}</span>
     <dl><dt>Puede estar</dt><dd>hasta {{ radio(elegido) }} m (lo amarillo)</dd><template v-if="elegido.retrato"><dt>Su retrato</dt><dd>{{ elegido.retrato }}</dd></template></dl></template>
    <template v-else-if="elegido.tipo==='delatada'"><small class="tipo allan-tipo">Guarida delatada</small><b class="titulo">{{ elegido.nombre }}</b>
     <div class="cuenta"><i class="morado" :style="{width:(1-elegido.quedan/ALLANAMIENTO.espera)*100+'%'}"></i></div>
     <p class="pista">{{ elegido.quedan?'La orden llega en '+elegido.quedan+' s: vigilá la puerta para que no saquen el botín.':'La orden llegó: en la puerta, E «Allanar la guarida».' }}</p></template>
    <template v-else-if="elegido.tipo==='comisaria'"><small class="tipo">Comisaría</small><b class="titulo">Comisaría</b><span class="donde">acá van los presos; sus compañeros pueden venir a rescatarlos</span></template>
   </template>
  </aside>
 </div>
</template>

<style scoped>
.mapa-juego{--tx:#f5f2ea;--tx2:#c3cad6;--tx3:#8e97a6;--borde:rgba(255,255,255,.11);--ladron:#ffa94d;--ladron2:#ff7a3d;--policia:#5aa9ff;--ok:#45d483;--mal:#ff6b5b;--foco:#ffd166;
 --t:'Bungee',Impact,sans-serif;--c:'Rubik Variable',system-ui,sans-serif;--acento:var(--ladron);
 display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;height:100%;min-height:0;color:var(--tx)}
.mapa-juego.policia{--acento:var(--policia)}
.plano{display:flex;flex-direction:column;gap:8px;min-height:0}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}
.ficha{background:rgba(255,255,255,.04);border:1px solid var(--borde);border-radius:14px;padding:14px;overflow:auto}
.donde{color:var(--tx2);font-size:13px}.plata{color:var(--ok);font-weight:700}
.mochila{display:flex;flex-wrap:wrap;gap:5px}.mochila span{font-size:12px;padding:3px 9px;border-radius:20px;background:rgba(255,169,77,.15);color:var(--ladron)}
.edif.allanada{background:rgba(120,120,130,.8)}
.punto.poli.vista i{opacity:.55}
.capas .vivos.on i{background:#fff;box-shadow:0 0 0 2px var(--mal)}.capas .vistos.on i{background:var(--foco)}.capas .delatadas.on i{background:#b06cff;border-radius:3px}
.capas{display:flex;flex-wrap:wrap;gap:6px}.capas button{display:flex;align-items:center;gap:6px;padding:5px 11px;border-radius:20px;border:1px solid var(--borde);font-size:12.5px;color:var(--tx3)}
.capas button.on{color:var(--tx);background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.25)}.capas button i{width:10px;height:10px;border-radius:50%;background:#777}
.capas .banda.on i{background:var(--ladron)}.capas .guaridas.on i{background:transparent;border:2px solid var(--ladron);border-radius:3px}.capas .robos.on i{background:var(--mal)}.capas .policia.on i,.capas .equipo.on i{background:var(--policia);border-radius:3px}
.capas .avistamientos.on i{background:var(--foco)}.capas .comisaria.on i{background:#fff;border:2px solid var(--policia);border-radius:3px}
.vivo-tag{margin-left:auto;font:700 10px var(--c);letter-spacing:1px;color:var(--ok);background:rgba(69,212,131,.15);padding:2px 7px;border-radius:20px}
.lienzo{position:relative;flex:1;min-height:420px;overflow:hidden;border-radius:10px;background:#2b3a44;cursor:grab;touch-action:none;user-select:none}.lienzo:active{cursor:grabbing}
.marco{position:absolute;left:0;top:0;transform-origin:0 0;line-height:0}.marco.suave{transition:transform .35s cubic-bezier(.2,.7,.2,1)}
.marco canvas{width:100%;height:100%;display:block}
/* los edificios pintados: el área entera del lugar, sólo el relleno (2026-10-18, Miguel: el borde se veía feo) */
.edif{position:absolute;cursor:pointer;z-index:1;transition:filter .15s}
.edif:hover{filter:brightness(1.25)}
.edif.robo{background:rgba(255,92,72,.82)}
.edif.robo.vivo{animation:alarma 1s ease-in-out infinite}
@keyframes alarma{50%{background:rgba(255,190,80,.9)}}
.edif.guarida{background:repeating-linear-gradient(45deg,rgba(255,169,77,.95) 0 3px,rgba(255,122,61,.85) 3px 6px)}
.edif.guarida.tuya{background:#ffb347}
.edif.cai{background:rgba(90,169,255,.9)}
.edif.zona{background:rgba(255,200,60,calc(.35 + var(--c)*.55));z-index:0}
.edif.sel{filter:brightness(1.18) saturate(1.25);z-index:2}
/* la gente y las marcas: chicas de lejos y más grandes al acercarse (tamPunto); de lejos, sin la letra */
.marco.lejos .punto i,.marco.lejos .signo i{color:transparent}
.punto,.signo{position:absolute;width:0;height:0;z-index:3;cursor:pointer;line-height:1}
.punto i,.signo i{position:absolute;left:0;top:0;transform:translate(-50%,-50%) scale(var(--pk));display:grid;place-items:center;font:700 11px var(--c);font-style:normal;border-radius:50%;width:20px;height:20px;box-shadow:0 0 0 3px rgba(11,16,32,.75)}
.punto.sel i{box-shadow:0 0 0 3px #fff,0 0 0 6px rgba(11,16,32,.6)}
.punto.banda i{background:var(--ladron);color:#1d1206}.punto.banda.yo i{width:24px;height:24px;border:2px solid #fff}.punto.banda.marcada i{background:var(--foco)}.punto.banda.preso i{background:#888;color:#222}
.punto.poli i{background:var(--policia);border-radius:5px;width:19px;height:19px}.punto.poli.yo i{width:23px;height:23px;border:2px solid #fff}
.punto.visto i{background:var(--foco);color:#1d1206;font-weight:800}
.signo.guarida i{background:#1d1206;color:var(--ladron);border-radius:6px;width:18px;height:18px;font-size:11px;box-shadow:0 0 0 2px var(--ladron);transform:translate(-50%,-50%) scale(var(--pk)) translateY(-16px)}
.zoom{position:absolute;right:10px;top:10px;display:flex;flex-direction:column;gap:4px;z-index:5}.zoom button{width:32px;height:32px;border-radius:9px;background:rgba(11,16,32,.85);border:1px solid var(--borde);font-size:17px;font-weight:700}.zoom button:hover{background:rgba(40,50,70,.95)}
/* la ficha de lo tocado */
.ficha{position:relative;display:flex;flex-direction:column;gap:4px;border-color:color-mix(in srgb,var(--acento) 45%,transparent)}
.ficha .pista{margin:0;color:var(--tx3);font-size:13px}
.ficha .tipo{font:600 11.5px var(--c);letter-spacing:1.2px;text-transform:uppercase;color:var(--tx3)}
.ficha .titulo{font:400 19px/1.2 var(--t);color:var(--tx)}.ficha .donde{color:var(--tx2);font-size:13px}
.ficha.guarida .tipo,.ficha.banda .tipo{color:var(--ladron)}.ficha.robo .tipo{color:var(--mal)}.ficha.visto .tipo{color:var(--foco)}.ficha.equipo .tipo,.ficha.comisaria .tipo,.ficha.patrulla .tipo{color:var(--policia)}
.ficha dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:8px 0 4px;font-size:13px}.ficha dt{color:var(--tx3)}.ficha dd{margin:0;text-align:right}.ficha .plata{color:var(--ok);font-weight:700}
.mochila.robado span{background:rgba(255,107,91,.15);color:var(--mal)}
.ficha .titulo{padding-right:22px}.cerrar{position:absolute;right:10px;top:8px;font-size:20px;color:var(--tx3)}.cerrar:hover{color:var(--tx)}
.retrato{position:relative;height:210px;margin:8px 0 4px;border-radius:12px;overflow:hidden;background:radial-gradient(circle at 50% 30%,rgba(255,255,255,.12),transparent 60%),linear-gradient(180deg,#26324a,#131a29)}
.retrato.preso{filter:grayscale(.7)}.retrato .estado-tag{position:absolute;left:10px;top:10px;font:700 11px var(--c);letter-spacing:1px;text-transform:uppercase;padding:3px 9px;border-radius:20px;background:rgba(69,212,131,.2);color:var(--ok)}
.retrato.marcada .estado-tag{background:rgba(255,209,102,.2);color:var(--foco)}.retrato.preso .estado-tag{background:rgba(255,255,255,.15);color:var(--tx2)}
.viste,.lo-robado{display:flex;flex-direction:column;gap:2px;font-size:13px}.viste small,.lo-robado>small{color:var(--tx3);font-size:11.5px;text-transform:uppercase;letter-spacing:1px}.viste span{color:var(--tx2)}
.lo-robado{margin-top:8px;gap:6px}.robo-item{display:grid;grid-template-columns:1fr auto;gap:4px 8px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.05)}.robo-item .mochila{grid-column:1/-1}
.retrato.poli .estado-tag{background:rgba(90,169,255,.2);color:var(--policia)}.hora{color:var(--tx3);font-variant-numeric:tabular-nums}
.punto.poli i{color:#0b1a2e}
/* el rastro: el «?» en vivo con un anillo que se vacía; el de la banda seguido, con el anillo rojo */
.punto.visto.vivo i{background:#fff;color:#c0392b;animation:rastro 1s ease-in-out infinite}
.punto.visto.vivo i::before,.punto.banda.rastreado i::before{content:'';position:absolute;inset:-7px;border-radius:50%;background:conic-gradient(var(--mal) calc(var(--p)*1turn),rgba(255,255,255,.15) 0);-webkit-mask:radial-gradient(circle,transparent 58%,#000 61%);mask:radial-gradient(circle,transparent 58%,#000 61%)}
@keyframes rastro{50%{box-shadow:0 0 0 6px rgba(255,107,91,.35)}}
.alerta{position:absolute;left:10px;top:10px;z-index:6;display:flex;align-items:center;gap:10px;max-width:70%;padding:8px 12px;border-radius:12px;background:rgba(120,20,20,.88);border:1px solid rgba(255,107,91,.7);font-size:13px;cursor:pointer;line-height:1.3}
.alerta+.alerta{top:62px}.alerta b{font:400 22px var(--t);color:#fff;min-width:28px;text-align:center}
.prueba{margin-left:auto;display:flex;align-items:center;gap:6px}.prueba small{color:var(--tx3);font-size:11px;text-transform:uppercase;letter-spacing:1px}.prueba button{padding:5px 10px;border-radius:9px;border:1px dashed rgba(255,255,255,.3);font-size:12px;color:var(--tx2)}.prueba button:hover{color:var(--tx);border-style:solid}
.vivo-rojo{color:var(--mal)!important}.cuenta{height:6px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden;margin:6px 0}.cuenta i{display:block;height:100%;background:var(--mal);transition:width .25s linear}
.aviso-rastro{margin-top:6px;padding:7px 10px;border-radius:10px;background:rgba(255,107,91,.15);color:var(--mal);font-weight:600;font-size:13px}
/* el allanamiento: la guarida delatada en morado que late; lista para entrar, fija; allanada, gris */
.edif.delatada{background:repeating-linear-gradient(45deg,rgba(176,108,255,.95) 0 3px,rgba(255,122,61,.85) 3px 6px)!important;animation:delatada 1.2s ease-in-out infinite}
@keyframes delatada{50%{opacity:.55}}
.edif.delatada.lista{animation:none;background:rgba(176,108,255,.95)!important}.edif.delatada.allanada,.edif.guarida.allanada{animation:none;background:rgba(120,120,130,.8)!important}
.alerta.allan{background:rgba(70,30,120,.9);border-color:rgba(176,108,255,.8)}
.allan-tipo{color:#c49bff!important}.allan-txt{background:rgba(176,108,255,.15);color:#d6bbff}.cuenta i.morado{background:#b06cff}

@media (max-width:900px){.mapa-juego{grid-template-columns:1fr}.ficha{max-height:40vh}}
</style>
