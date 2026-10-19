<script setup>
import {ref,reactive,watch,onMounted,onBeforeUnmount} from 'vue';
import * as THREE from 'three';
import {loadCharacters,makeCharacter} from '../lib/characters3d.js';
import {dress,bake,PARTS,MODEL_LABEL,COLORS,colorOf,zonesOf,CITY_PIECES as PIECES,pieceById,loadPieceModel} from '../lib/outfit3d.js';

// El probador: un personaje del paquete vestido con los rasgos del retrato hablado, visto de cerca, desde una cámara de
// seguridad o desde el dron, y una fila de parecidos (misma ropa, gorra y mochila: lo que ve una cámara de espaldas).
// Cada modelo se separa en zonas (outfit3d.js): sólo se muestran las que tiene el modelo elegido.
const MODELS=Object.keys(PARTS);
const VIEWS=[['cerca','De cerca'],['camara','Cámara de seguridad'],['dron','Dron'],['fila','Fila de parecidos'],['galeria','Galería']];
const GALLERY=12,gallery=ref([]),tags=ref(null);
// Filas de colores por sección. need: la zona que tiene que tener el modelo. none: un botón extra (sin pelo, descalzo…).
const SECTIONS=[
 {title:'Cuerpo',rows:[{key:'piel',cat:'piel',label:'Piel'},{key:'ojos',cat:'ojos',label:'Ojos'},{key:'cejas',cat:'cejas',label:'Cejas',need:'cejas'},
  {key:'pelo',cat:'pelo',label:'Pelo',need:'pelo',none:{v:'no',t:'Sin pelo'}}]},
 {title:'Arriba',rows:[{key:'ropa',cat:'ropa',label:'Ropa'},{key:'mangas',seg:[['original','Como viene'],['sin','Sin'],['cortas','Cortas'],['largas','Largas']],label:'Mangas',need:'manga_arriba'},
  {key:'mangasColor',cat:'ropa',label:'Color de las mangas',need:'manga_arriba',none:{v:null,t:'Igual que la ropa'}},
  {key:'camisa',cat:'camisa',label:'Camisa de abajo',need:'camisa'},{key:'detalle',cat:'detalle',label:'Detalle (corbata, tirantes, banda)',need:'detalle'}]},
 {title:'Abajo',rows:[{key:'pantalon',cat:'pantalon',label:'Pantalón',need:'pant_arriba'},{key:'largo',seg:[['original','Como viene'],['corto','Corto'],['largo','Largo']],label:'Largo',need:'pant_arriba'},
  {key:'cinturon',cat:'cinturon',label:'Cinturón',need:'cinturon'},{key:'zapatos',cat:'zapatos',label:'Zapatos',none:{v:'no',t:'Descalzo'}}]}];
// Piezas de otros modelos (outfit3d.js: PIECES), una lista por tipo. null: la propia (o ninguna).
const PIECE_ROWS=[['pzPelo','pelo','Pelo','El propio'],['pzArriba','arriba','Ropa de arriba','La propia'],['pzSombrero','sombrero','Sombrero o casco','Ninguno'],['pzBigote','bigote','Barba o bigote','Nada'],['pzBufanda','bufanda','Bufanda','Sin bufanda'],
 ['pzEncima','encima','Encima','Nada'],['pzPantalon','pantalon','Pantalón','El propio']];
const loadingPieces=ref(false);
const ACCS=[{key:'guantes',label:'Guantes',cat:'guantes',flag:true},{key:'gorra',label:'Gorra',color:'gorraColor'},{key:'gafas',label:'Gafas',color:'gafasColor'},{key:'mochila',label:'Mochila',color:'mochilaColor'}];
const hex=(cat,v)=>colorOf(cat,v,Object.keys(COLORS[cat])[0])||'#888888';
const o=reactive({model:'BaseCharacter',pzArriba:'arriba:Casual_Male',piel:'media',ojos:'blancos',cejas:'negras',pelo:'castaño',ropa:'roja',mangas:'original',mangasColor:null,camisa:'blanca',detalle:'negro',
 pantalon:'jean',largo:'original',cinturon:'negro',pzPelo:'pelo:Casual_Male',pzSombrero:null,pzBigote:null,pzBufanda:null,pzEncima:null,pzPantalon:'pantalon:Casual2_Male',encimaColor:null,zapatos:'negros',guantes:null,sombrero:false,gorra:false,gorraColor:'azul',gafas:false,gafasColor:'negras',mochila:false,mochilaColor:'café'});
const view=ref('cerca'),spin=ref(true),loading=ref(true),host=ref(null),avail=ref(new Set());
let renderer,scene,camera,templates=[],main=null,lineup=[],raf=0,last=0,seed=1;
const rand=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
const has=k=>k==='sombrero'?!!PARTS[o.model].hat:!k||avail.value.has(k);
const isFree=v=>typeof v==='string'&&v.startsWith('#');

// merge: cada persona en una sola malla (outfit3d.js: bake); se ve igual y es un dibujo por persona.
const merge=ref(true),calls=ref(0);
function person(model,outfit){const t=templates.find(t=>t.name===model)||templates[0],c=makeCharacter(t,()=>.5);scene.add(c.holder);c.holder.updateMatrixWorld(true);dress(c.holder.children[0],t.name,outfit);if(merge.value)bake(c.holder.children[0]);return c;}
function drop(c){if(c){scene.remove(c.holder);c.mixer.stopAllAction();}}
const pickR=(a,r=rand)=>a[Math.floor(r()*a.length)],keys=c=>Object.keys(COLORS[c]);
// Alguien al azar (con r: el azar a usar). base: lo que tiene que compartir.
function randomOutfit(r,base={}){const model=r()<.5?'BaseCharacter':pickR(MODELS,r),onBase=model==='BaseCharacter';return {model,piel:pickR(keys('piel'),r),ojos:pickR(keys('ojos'),r),cejas:pickR(keys('cejas'),r),pelo:pickR([...keys('pelo'),'no'],r),
 ropa:pickR(keys('ropa'),r),mangas:pickR(['original','original','sin','cortas','largas'],r),mangasColor:r()<.3?pickR(keys('ropa'),r):null,camisa:pickR(keys('camisa'),r),detalle:pickR(keys('detalle'),r),
 pantalon:pickR(keys('pantalon'),r),largo:pickR(['original','original','corto','largo'],r),cinturon:pickR(keys('cinturon'),r),zapatos:pickR([...keys('zapatos'),'no'],r),guantes:r()<.15?pickR(keys('guantes'),r):null,
 pzPelo:onBase?(r()<.88?pickR(PIECES.pelo,r).id:null):r()<.3?pickR(PIECES.pelo,r).id:null,pzArriba:onBase||r()<.15?pickR(PIECES.arriba,r).id:null,pzSombrero:r()<.15?pickR(PIECES.sombrero,r).id:null,pzBigote:r()<.2?pickR(PIECES.bigote,r).id:null,pzBufanda:r()<.1?PIECES.bufanda[0].id:null,
 pzEncima:r()<.2?pickR(PIECES.encima,r).id:null,pzPantalon:onBase||r()<.25?pickR(PIECES.pantalon,r).id:null,encimaColor:null,
 sombrero:r()<.4,gorra:r()<.3,gorraColor:pickR(keys('gorra'),r),gafas:r()<.3,gafasColor:pickR(keys('gafas'),r),mochila:r()<.3,mochilaColor:pickR(keys('mochila'),r),...base};}
// Las piezas de otros modelos se cargan antes de vestir (cada modelo, una vez). token: sólo la última vestida cuenta.
let token=0;
async function build(custom=null){
 const my=++token,main0={...o},others=custom?custom:view.value==='fila'?Array.from({length:5},()=>randomOutfit(rand,{ropa:o.ropa,gorra:o.gorra,gorraColor:o.gorraColor,mochila:o.mochila,mochilaColor:o.mochilaColor}))
  :view.value==='galeria'?Array.from({length:GALLERY},()=>randomOutfit(Math.random)):[];
 const need=new Set();for(const x of [main0,...others])for(const [k] of PIECE_ROWS){const pc=x[k]&&pieceById(x[k]);if(pc)need.add(pc.m);}
 if(need.size){loadingPieces.value=true;await Promise.all([...need].map(loadPieceModel));loadingPieces.value=false;}
 if(my!==token)return;
 drop(main);for(const c of lineup)drop(c);lineup=[];
 main=person(o.model,main0);avail.value=zonesOf(main.holder.children[0]);
 if(view.value==='galeria'){
  // La galería: doce al azar en tres filas, numerados de izquierda a derecha y de adelante hacia atrás.
  main.holder.visible=false;lineup=others.map(x=>person(x.model,x));
  lineup.forEach((c,i)=>{c.holder.position.set((i%4-1.5)*1.5,0,-Math.floor(i/4)*2);c.holder.rotation.y=0;c.outfit=others[i];});
  gallery.value=others.map((x,i)=>({n:i+1,text:describe(x)}));place();return;}
 gallery.value=[];
 if(view.value==='fila'){
  // Cinco parecidos: la misma ropa, gorra y mochila (lo que ve una cámara de espaldas); el resto al azar.
  lineup=others.map(x=>person(x.model,x));
  const order=[main,...lineup].map(c=>[rand(),c]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
  order.forEach((c,i)=>{c.holder.position.set((i-2.5)*1.3,0,0);c.holder.rotation.y=0;});
 }
 for(const c of [main,...lineup])c.holder.updateMatrixWorld(true);
 place();
}
// Lo que lleva alguien, en una línea (para la lista de la galería).
function describe(x){const pc=k=>x[k]?pieceById(x[k])?.t:null,bits=[MODEL_LABEL[x.model],pc('pzPelo')&&'pelo '+pc('pzPelo'),pc('pzArriba'),pc('pzSombrero'),pc('pzBigote'),pc('pzBufanda'),pc('pzEncima'),pc('pzPantalon')&&'pantalón '+pc('pzPantalon'),
 x.mangas!=='original'&&'mangas '+x.mangas,x.largo!=='original'&&'pantalón '+x.largo,x.guantes&&'guantes',x.gorra&&'gorra',x.gafas&&'gafas',x.mochila&&'mochila',x.sombrero&&'su sombrero'];return bits.filter(Boolean).join(' · ');}
function place(){const v=view.value;
 if(v==='galeria'){camera.position.set(0,3.4,6.8);camera.lookAt(0,.6,-2);return;}
 if(v==='cerca'){camera.position.set(0,1.45,3.1);camera.lookAt(0,1.05,0);}
 if(v==='camara'){camera.position.set(1.2,2.8,4.6);camera.lookAt(0,.9,0);}
 if(v==='dron'){camera.position.set(0,26,9);camera.lookAt(0,0,0);}
 // La fila mide unos 8 m: la cámara se aleja lo que haga falta para que entre a lo ancho.
 if(v==='fila'){const half=Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*camera.aspect),z=Math.max(7.2,4.4/Math.tan(half));camera.position.set(0,1.5,z);camera.lookAt(0,1,0);}}
function frame(now){const dt=Math.min(.05,(now-(last||now))/1000);last=now;
 if(main&&spin.value&&view.value!=='fila'&&view.value!=='galeria')main.holder.rotation.y+=dt*.6;
 for(const c of [main,...lineup])c?.mixer.update(dt);
 renderer.render(scene,camera);calls.value=renderer.info.render.calls;
 // Los números de la galería, sobre la cabeza de cada uno.
 if(view.value==='galeria'&&tags.value){const w=host.value.clientWidth,h=host.value.clientHeight,v=new THREE.Vector3();[...tags.value.children].forEach((el,i)=>{const c=lineup[i];if(!c)return;
  v.set(c.holder.position.x,1.95,c.holder.position.z).project(camera);el.style.transform=`translate(${(v.x+1)/2*w}px,${(1-v.y)/2*h}px) translate(-50%,-100%)`;});}
 raf=requestAnimationFrame(frame);}
function resize(){const w=host.value.clientWidth,h=host.value.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();if(main)place();}
function shuffle(){Object.assign(o,randomOutfit(Math.random));}
watch(o,()=>{if(!loading.value)build();},{deep:true});
watch(view,()=>{if(!loading.value)build();});
watch(merge,()=>{if(!loading.value)build();});
let ro=null;
onMounted(async()=>{
 renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(2,devicePixelRatio));renderer.outputColorSpace=THREE.SRGBColorSpace;host.value.appendChild(renderer.domElement);
 scene=new THREE.Scene();scene.background=new THREE.Color('#e9ece4');camera=new THREE.PerspectiveCamera(40,1,.1,200);
 scene.add(new THREE.HemisphereLight('#ffffff','#9aa39a',1.6));const sun=new THREE.DirectionalLight('#fff4e0',2.2);sun.position.set(3,6,4);scene.add(sun);
 const floor=new THREE.Mesh(new THREE.CircleGeometry(30,48),new THREE.MeshStandardMaterial({color:'#d9dccf'}));floor.rotation.x=-Math.PI/2;scene.add(floor);
 const grid=new THREE.GridHelper(40,40,'#c3c7bb','#c3c7bb');grid.position.y=.002;scene.add(grid);
 ro=new ResizeObserver(resize);ro.observe(host.value);resize();
 templates=await loadCharacters(MODELS);loading.value=false;build();raf=requestAnimationFrame(frame);
 if(import.meta.env.DEV)window.__probador={o,view,build,merge,calls,get main(){return main;},get lineup(){return lineup;},renderer,scene,get camera(){return camera;}};
});
onBeforeUnmount(()=>{cancelAnimationFrame(raf);ro?.disconnect();renderer?.dispose();});
</script>

<template>
 <section class="probador">
  <div class="viewer">
   <div ref="host" class="host"></div>
   <p v-if="loading" class="loading">Cargando personajes…</p>
   <div v-if="view==='galeria'" ref="tags" class="tags"><span v-for="g in gallery" :key="g.n">{{ g.n }}</span></div>
   <button v-if="view==='galeria'" class="again" @click="build()">Otros doce</button>
   <p class="calls">{{ calls }} dibujos por cuadro</p>
   <div class="views" role="group" aria-label="Vista"><button v-for="[k,l] in VIEWS" :key="k" :class="{on:view===k}" @click="view=k">{{ l }}</button></div>
  </div>
  <aside>
   <ol v-if="view==='galeria'" class="gallery"><li v-for="g in gallery" :key="g.n">{{ g.text }}</li></ol>
   <label class="row">Modelo <select v-model="o.model"><option v-for="m in MODELS" :key="m" :value="m">{{ MODEL_LABEL[m] }}</option></select></label>
   <section v-for="S in SECTIONS" :key="S.title" class="sec"><h4>{{ S.title }}</h4>
    <template v-for="R in S.rows" :key="R.key"><div v-if="has(R.need)" class="row"><span>{{ R.label }}</span>
     <div v-if="R.seg" class="seg"><button v-for="[v,t] in R.seg" :key="v" :class="{on:o[R.key]===v}" @click="o[R.key]=v">{{ t }}</button></div>
     <div v-else class="sw"><button v-for="(c,k) in COLORS[R.cat]" :key="k" :title="k" :class="{on:o[R.key]===k}" :style="{background:c}" @click="o[R.key]=k"></button>
      <label class="pick" :class="{on:isFree(o[R.key])}" title="Otro color"><input type="color" :value="hex(R.cat,o[R.key])" @input="o[R.key]=$event.target.value"></label>
      <button v-if="R.none" class="none" :class="{on:o[R.key]===R.none.v}" @click="o[R.key]=R.none.v">{{ R.none.t }}</button></div></div></template>
   </section>
   <section class="sec"><h4>Piezas de otros modelos <small v-if="loadingPieces">cargando…</small></h4>
    <label v-for="[k,cat,label,none] in PIECE_ROWS" :key="k" class="row">{{ label }}
     <select v-model="o[k]"><option :value="null">{{ none }}</option><option v-for="pc in PIECES[cat]" :key="pc.id" :value="pc.id">{{ pc.t }}</option></select></label>
    <div v-if="o.pzEncima" class="row"><span>Color de lo de encima</span><div class="sw"><button v-for="(c,k) in COLORS.ropa" :key="k" :title="k" :class="{on:o.encimaColor===k}" :style="{background:c}" @click="o.encimaColor=k"></button>
     <label class="pick" :class="{on:isFree(o.encimaColor)}" title="Otro color"><input type="color" :value="hex('ropa',o.encimaColor)" @input="o.encimaColor=$event.target.value"></label>
     <button class="none" :class="{on:o.encimaColor===null}" @click="o.encimaColor=null">Como viene</button></div></div>
   </section>
   <section class="sec"><h4>Accesorios</h4>
    <label v-if="has('sombrero')" class="check"><input v-model="o.sombrero" type="checkbox"> Su sombrero</label>
    <div v-for="A in ACCS" :key="A.key" class="row acc">
     <label class="check"><input type="checkbox" :checked="A.flag?!!o[A.key]:o[A.key]" @change="A.flag?(o[A.key]=$event.target.checked?keys(A.cat)[0]:null):(o[A.key]=$event.target.checked)"> {{ A.label }}</label>
     <div v-if="o[A.key]" class="sw"><template v-for="cat in [A.cat||A.key]" :key="cat"><button v-for="(c,k) in COLORS[cat]" :key="k" :title="k" :class="{on:o[A.color||A.key]===k}" :style="{background:c}" @click="o[A.color||A.key]=k"></button>
      <label class="pick" :class="{on:isFree(o[A.color||A.key])}" title="Otro color"><input type="color" :value="hex(cat,o[A.color||A.key])" @input="o[A.color||A.key]=$event.target.value"></label></template></div></div>
   </section>
   <div class="actions"><button @click="shuffle">Al azar</button><button v-if="view==='fila'" @click="build">Otros parecidos</button><label class="check"><input v-model="spin" type="checkbox"> Girar</label><label class="check"><input v-model="merge" type="checkbox"> Una malla por persona</label></div>
   <p class="hint" v-if="view==='fila'">Los seis tienen la misma ropa, gorra y mochila (lo que ve una cámara de espaldas). ¿Se distingue cuál es?</p>
  </aside>
 </section>
</template>

<style scoped>
.probador{max-width:1200px;margin:18px auto 0;display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:12px}
.viewer{position:relative;border:1px solid var(--line);border-radius:13px;overflow:hidden;background:#e9ece4;height:min(70vh,640px)}
.host{position:absolute;inset:0}.host :deep(canvas){width:100%;height:100%;display:block}
.tags{position:absolute;inset:0;pointer-events:none}.tags span{position:absolute;left:0;top:0;background:#2f3a36;color:#fff;font:600 11px var(--mono);padding:2px 6px;border-radius:6px}
.calls{position:absolute;left:10px;bottom:10px;margin:0;background:#fffefae6;color:#2f3a36;border:1px solid #cfd3c8;border-radius:8px;padding:4px 8px;font:12px var(--mono)}
.again{position:absolute;right:10px;bottom:10px;background:#fffefae6;color:#2f3a36;border:1px solid #cfd3c8;padding:6px 10px}
.gallery{margin:0;padding-left:22px;font-size:12px;display:flex;flex-direction:column;gap:3px;color:var(--ink)}
.loading{position:absolute;inset:0;display:grid;place-items:center;margin:0;color:#59665e}
.views{position:absolute;left:10px;top:10px;display:flex;gap:6px;flex-wrap:wrap}
.views button{padding:6px 10px;background:#fffefae6;color:#2f3a36;border:1px solid #cfd3c8}
.views button.on{background:#2f3a36;color:#fff}
aside{background:var(--paper);border:1px solid var(--line);border-radius:13px;padding:12px;display:flex;flex-direction:column;gap:12px;font-size:13px}
.row{display:flex;flex-direction:column;gap:6px}.row.off,.check.off{opacity:.45}
.sw{display:flex;flex-wrap:wrap;gap:6px}
.sw button{width:26px;height:26px;min-height:0;padding:0;border-radius:7px;border:2px solid transparent;box-shadow:inset 0 0 0 1px #0002}
.sw button.on{border-color:var(--ink)}
.sw button.none{background:var(--paper);color:var(--muted)}
.check{display:flex;gap:8px;align-items:center}
.pick{position:relative;width:26px;height:26px;border-radius:7px;border:2px solid transparent;box-shadow:inset 0 0 0 1px #0002;background:conic-gradient(#e05a4a,#e0c04a,#5ab05a,#4a8ae0,#a05ae0,#e05a4a);cursor:pointer;overflow:hidden}
.pick.on{border-color:var(--ink)}.pick input{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer;border:0;padding:0}
.acc{gap:6px}
.sec{display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--line);padding-top:10px}
.sec h4{margin:0;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.seg{display:inline-flex;flex-wrap:wrap;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.seg button{border:0;border-radius:0;padding:5px 9px;font-size:12px;min-height:0}.seg button+button{border-left:1px solid var(--line)}
.seg button.on{background:var(--ink);color:var(--paper)}
.sw button.none{width:auto;padding:0 8px;font-size:11px;font-weight:600}
.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.hint{margin:0;color:var(--muted);font-size:12px}
aside{max-height:min(70vh,640px);overflow-y:auto}
@media(max-width:800px){.probador{grid-template-columns:1fr}aside{max-height:none}}
</style>
