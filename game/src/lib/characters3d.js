/* Personajes animados para la gente de /demo: los muñecos propios (persona3d.js), vestidos con las piezas del
   «Ultimate Animated Character Pack» de Quaternius (CC0) ya desacopladas (public/models/partes y pelos). Se cargan una vez (sólo los de ropa de calle) y cada persona es una copia
   con su propio esqueleto y su mezclador de animaciones: quieta (Idle), caminando (Walk) o corriendo (Run). */
import {ANIM} from '../engine/medidas.js';
import * as THREE from 'three';
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js';

// La gente de la calle: ropa normal. Los de fantasía del paquete (magos, caballeros, zombies…) no se cargan.
export const CIVILS=['Casual_Male','Casual_Female','Casual2_Male','Casual2_Female','Casual3_Male','Casual3_Female','Casual_Bald',
 'Suit_Male','Suit_Female','Worker_Male','Worker_Female','OldClassy_Male','OldClassy_Female','Chef_Male','Doctor_Male_Young','Doctor_Female_Old'];
// (2026-10-12) Ya no se carga el paquete entero: la gente sale de NUESTRA galería (persona3d.js: el cuerpo base con la
// ropa, el pelo y las barbas desacoplados, ajustados al cuerpo). Se arma una plantilla por combinación (modelo de ropa
// + colores + pelo + barba + contextura) y cada persona es una copia que comparte la malla: un dibujo por persona.
import {makePersona2,followSkirt,lowGeo} from './persona3d.js';
import {installArmContact,armContactProfile} from './armContact3d.js';
import {installFeet} from './pies3d.js';
import {installSeatedCloth,extractPart} from './ropa3d.js';
import {COLORS,PIECES,PARTS,CUERPO_UNICO} from '../engine/vestuario.js';
import {makeDressable,PALETTE} from './vestier3d.js';
const SCALE=.52;
// Cuerpo clásico: el mismo del ropero y de la galería de cuerpos.
export const CUERPO='paquete';const CABEZA=1;
const rng=s=>()=>(s=(s*16807)%2147483647)/2147483647;
const FALDAS=PIECES.pantalon.filter(p=>p.falda).map(p=>p.id),FEM=PIECES.pelo.filter(p=>/Female/.test(p.m)).map(p=>p.m),ALL=PIECES.pelo.map(p=>p.m),NEUTROS=['jean','negro','beige','gris','jean_claro','azul_oscuro','marrón','oliva'];
// Los peinados de calle: los completos del paquete, de hombre y de mujer (las mezclas aleatorias creaban puntas y masas
// incompatibles).
const PEINADOS_CALLE=['Casual_Male','Casual2_Male','Casual3_Male','Suit_Male','OldClassy_Male','Doctor_Male_Young','Casual_Female','Casual2_Female','Casual3_Female','Suit_Female','Worker_Female','OldClassy_Female'];
// Un look de calle para el modelo m (las mismas reglas de combinar que la vista «Ropa» de /cuerpos).
export function lookFor(m,r){const pick=a=>a[Math.floor(r()*a.length)],mujer=/Female/.test(m),ropa=pick(Object.keys(COLORS.ropa));let pant=r()<.85?pick(NEUTROS):pick(Object.keys(COLORS.pantalon));
 while(pant===ropa||(pant.startsWith('azul')&&ropa.startsWith('azul')))pant=pick(NEUTROS);
 const L={cuerpo:CUERPO,cabeza:CABEZA,modelo:m,ropa,pantalon:pant,camisa:pick(['blanca','celeste','gris','negra']),piel:pick(Object.keys(COLORS.piel)),pelo:pick(Object.keys(COLORS.pelo)),zapatos:pick(['negros','negros','cafés','blancos']),
  contextura:(r(),CUERPO_UNICO.contextura),// (un solo cuerpo; el número que era la contextura se sigue sacando: así el resto del look no cambia)
 gastado:pant.startsWith('jean')&&r()<.5,bolsillos:r()<.4,
  estampado:pick(['','','','','rayas','rayas_finas','cuadros','franja']),estampadoColor:r()<.5?'blanca':null,cordones:r()<.3?'blancos':null};
 if(L.pelo==='canoso'&&r()<.5)L.pelo=pick(['negro','castaño']);
 // (del armado anterior, VESTIER=false: las faldas y el vestido son partes del modelo de mujer; con el vestier la ropa la
 // elige outfitFor, sin género)
 if(mujer&&!PARTS[m]?.topPants){const k=r();if(k<.45)L.pzPantalon=pick(FALDAS);if(k<.2){L.pzArriba='arriba:Casual_Female';L.pantalon=COLORS.ropa[ropa];L.estampado='';}}
 // Peinados completos de calle: las mezclas aleatorias creaban puntas y masas incompatibles.
 // (sin género, 2026-10-17: cualquiera lleva cualquier peinado —los de los muñecos de hombre y de mujer del paquete— o
 // va rapado o calvo, y cualquiera puede llevar barba)
 const q=r();Object.assign(L,q<.9?{pzPelo:'pelo:'+pick(PEINADOS_CALLE)}:{peinado:pick(['rapado','calvo'])});
 const v=r();L.entradas=v<.08;L.coronilla=v>.95;if(r()<.22)Object.assign(L,r()<.5?{barba:'tres_dias'}:{pzBigote:pick(PIECES.bigote.map(b=>b.id))});
 // Variedad de accesorios sin consumir la semilla del vestuario aprobado.
 let ah=2166136261;for(const ch of [m,L.ropa,L.pantalon,L.piel,L.contextura,L.pelo].join('|'))ah=Math.imul(ah^ch.charCodeAt(0),16777619);const roll=(ah>>>0)/4294967296;
 if(roll<(/^Suit_/.test(m)?.65:.28))L.reloj=/^Suit_/.test(m)?'metal':'cuero';
 if(((ah>>>8)%100)<12)L.gafas=/^OldClassy_/.test(m)?'carey':'negras';
 return L;}
// Una plantilla: la raíz del muñeco (con su malla y su esqueleto) y sus animaciones (incluye Typing).
// (con sus versiones de lejos: 35 % y 13 % de los triángulos —persona3d lowGeo—)
// (2026-10-14) La gente se viste con el VESTIER (vestier3d.js): el cuerpo, el pelo y la barba siguen saliendo del look;
// la ropa es un conjunto armado con su catálogo. VESTIER=false vuelve al armado anterior (makePersona2 con ropa).
export const VESTIER=true;
const NEUTRAL=['#2f3133','#3d5370','#26282a','#5c6340','#7d8284','#c8b48f','#2b3d5c','#6e4e35'];
// El uniforme de la policía (REGLAS.md: «uniformada: se la reconoce de lejos»; 2026-10-17): camisa y pantalón azul
// oscuro, chaleco reflectivo y gorra. Fijo, sin sacar números de r (así la ropa de la gente no cambia).
export const UNIFORME={top:{id:'camisa',color:'#24406b'},bottom:{id:'pantalon',color:'#1b2a40'},outer:{id:'chaleco',color:'#c6e83a'},shoes:{id:'botas',color:'#232425'},hat:{id:'gorra',color:'#1b2a40'}};
export function outfitFor(L,r){if(/^BlueSoldier/.test(L.modelo||''))return {underwear:{id:'boxer'},...structuredClone(UNIFORME)};const pick=a=>a[Math.floor(r()*a.length)],oficio=/^(Chef|Worker)/.test(L.modelo||''),formal=/^(Suit|OldClassy|Doctor)/.test(L.modelo||'');
 // (sin género: una sola lista de prendas para todos)
 const top=formal?pick(['camisa','camisa','polo','manga-larga']):pick(['camiseta','camiseta','manga-larga','polo','camisa','sudadera','sudadera-capucha','sin-mangas','rayas','vestido']);
 const bottom=top==='vestido'?null:formal?'pantalon':pick(['jean','jean','pantalon','cargo','deportivo','bermuda','pantaloneta','leggings','falda-corta','falda-larga',...(oficio?['overol','overol']:['overol'])]);
 const o0={};
 const outer=r()<(formal?.55:.28)?(formal?pick(['chaleco','chaqueta-abierta','abrigo']):pick(['chaqueta-abierta','chaqueta-cremallera','chaleco','abrigo'])):null;
 if(oficio&&!outer&&r()<.5&&bottom!=='overol')o0.outer={id:'delantal',color:pick(['#c8b48f','#f2f0ea','#2f3133'])};
 const shoes=formal?'zapatos':pick(['tenis','tenis','botas','zapatos']);
 const c1=pick(PALETTE);let c2=pick(NEUTRAL);while(c2===c1)c2=pick(NEUTRAL);
 const o={...o0,underwear:{id:'boxer'},top:{id:top,color:c1},bottom:bottom&&{id:bottom,color:c2},outer:o0.outer||outer&&{id:outer,color:pick(NEUTRAL)},shoes:{id:shoes,color:pick(['#232425','#34507a','#5b3b25','#f2f0ea'])}};
 if(r()<.12)o.accessory={id:'bufanda',color:pick(PALETTE)};if(r()<.15)o.hat={id:r()<.5?'gorra':'gorro-lana',color:pick(PALETTE)};return o;}
async function template(L,name,vestier=VESTIER){if(vestier)return vestierTemplate(L,name);const p=await makePersona2(L,Math.random,{scale:SCALE});let m=null;p.holder.traverse(o=>{if(o.isSkinnedMesh&&!m)m=o;});
 // (las versiones de lejos, después de arrancar, como las del vestier)
 const lods=[];if(m){const g=m.geometry,k=p.kinds;LOD_QUEUE.push(async()=>{lods.push(await lowGeo(g,.35,k),await lowGeo(g,.13,k));});drainLods();}
 return {name,scene:p.holder.children[0],clips:p.clips,look:L,lods,partSource:p.partSource,parts:p.parts};}
// La plantilla con el vestier: el personaje vestido y sus versiones de lejos (la cara entera, sin rellenos de articulación).
const vr=rng(31337);
// (outfit: la ropa —la que se elige al cambiarse; si no, la de outfitFor—; queda en la plantilla: el retrato la describe)
async function vestierTemplate(L,name,outfit=null){
 const body={contextura:L.contextura,piel:L.piel,pelo:L.pelo,peinado:L.pzPelo||'',barba:L.pzBigote||''},p=await makeDressable(body);
 outfit=outfit||outfitFor(L,vr);p.dress(JSON.parse(JSON.stringify(outfit)));p.mixer.stopAllAction();
 // (las versiones de lejos se arman después de arrancar, de a una por vez en los ratos libres: el MISMO arreglo lo comparten
 // las personas ya creadas, que las usan apenas existen. Al cargar cuestan ~60 ms por plantilla)
 const lods=[];LOD_QUEUE.push(async()=>{const L2=await p.lods([.35,.15]);lods.push(...L2);});drainLods();
 return {name,scene:p.holder.children[0],clips:p.clips,look:L,outfit,lods,partSource:p.mesh.geometry,parts:p.mesh.geometry.userData.wardrobeParts};}
// (2026-10-17, el menú del juego: cambiarse de ropa) la misma persona —su look— con otra ropa
export const vestirPlantilla=(t,outfit)=>vestierTemplate(t.look,t.name,outfit);
// (2026-10-17, el perfil del jugador —/inicio—) la plantilla del jugador: su cuerpo (piel, pelo, peinado, barba) y la ropa
// de su bando —la de calle de ladrón; el uniforme (con o sin gorra) de policía—
export const uniformeDe=({gorra=true}={})=>{const u=JSON.parse(JSON.stringify(UNIFORME));if(!gorra)delete u.hat;return {underwear:{id:'boxer'},...u};};
export function plantillaJugador(cuerpo,outfit,policia=false){const L={cuerpo:CUERPO,cabeza:CABEZA,modelo:policia?'BlueSoldier_Male':'Casual_Male',contextura:CUERPO_UNICO.contextura,
 piel:cuerpo.piel,pelo:cuerpo.pelo,...(cuerpo.peinado?{pzPelo:cuerpo.peinado}:{peinado:'rapado'}),...(cuerpo.barba?{pzBigote:cuerpo.barba}:{})};return vestierTemplate(L,L.modelo,outfit);}
const LOD_QUEUE=[];let draining=false;
function drainLods(){if(draining)return;draining=true;const idle=f=>setTimeout(f,40);
 const step=()=>{const job=LOD_QUEUE.shift();if(!job){draining=false;return;}job().finally(()=>idle(step));};idle(step);}
// De cerca la malla entera; a más de LOD_D[0] m la media; a más de LOD_D[1] m la lejana. Se cambia la geometría de la
// misma malla (comparte esqueleto y animación: no cuesta nada más).
// (2026-10-18, Miguel: «saltos bruscos»: a media distancia la pose cambiaba cada 2 cuadros y la posición en cada uno —el
// muñeco se deslizaba y la pierna saltaba—; ahora cerca y a media distancia cada cuadro, lejos cada 2)
export const ANIM_EVERY=[1,1,2,4];// (cada cuántos cuadros se anima: cerca, media, lejos y fuera de cámara)
export const LOD_D=[14,32],LOD_CAM={x:0,y:0,z:0};// (la demo copia acá la cámara en cada cuadro)
export function updateLod(c,cam){if(!c.lods?.length||!c.mesh)return;const p=c.holder.position,d=Math.hypot(p.x-cam.x,p.y-cam.y,p.z-cam.z),k=d>LOD_D[1]?2:d>LOD_D[0]?1:0;
 if(c.lod!==k){c.lod=k;c.mesh.geometry=k?c.lods[k-1]:c.full;}}
const caches=new Map();
// (con el vestier, una plantilla por modelo: cada una arma una persona entera, ~170 ms; con dos, la carga se duplicaba)
const vestierPer=()=>VESTIER?1:2;
// per: plantillas por modelo de ropa (más plantillas = más variedad; cada una cuesta ~5k triángulos en memoria, no por persona).
// (vestier: armar con el vestier o con el armado anterior; la prueba de rendimiento compara los dos)
export function loadCharacters(names=CIVILS,{per=vestierPer(),seed=7,vestier=VESTIER}={}){
 const key=[names.join(),per,seed,vestier].join('|');if(caches.has(key))return caches.get(key);const r=rng(seed*7919+1);
 const looks=[];for(const m of names)for(let i=0;i<per;i++)looks.push([lookFor(m,r),m]);
 const p=(async()=>{
  // (con el vestier y en el navegador, en workers; en node —pruebas— o si falla, como siempre)
  if(vestier&&typeof Worker!=='undefined'){try{return await workerTemplates(looks);}catch(e){console.warn('gente: sin workers',e);}}
  const out=[];for(const [L,m] of looks){try{out.push(await template(L,m,vestier));}catch(e){console.warn('persona',m,e);}}return out;})();
 caches.set(key,p);return p;}

// Las plantillas armadas en workers (gente.worker.js): el hilo principal arma una persona base (el esqueleto y las
// animaciones son iguales para todos) y cada plantilla es una copia de su escena con la geometría que llega del worker.
// Se reparten los trabajos en hasta 3 workers; las versiones de lejos vienen hechas.
async function workerTemplates(looks){
 const base=await makeDressable({contextura:'normal',piel:'media',pelo:'castaño',peinado:'',barba:''});base.dress({});base.mixer.stopAllAction();
 const jobs=looks.map(([L,m],id)=>({id,body:{contextura:L.contextura,piel:L.piel,pelo:L.pelo,peinado:L.pzPelo||'',barba:L.pzBigote||''},outfit:outfitFor(L,vr),lods:[.35,.15]}));
 const n=Math.max(1,Math.min(3,(navigator.hardwareConcurrency||4)-1,jobs.length)),out=new Array(jobs.length);
 const unpack=d=>{const g=new THREE.BufferGeometry();for(const [k,a] of Object.entries(d.attrs))g.setAttribute(k,new THREE.BufferAttribute(a.array,a.itemSize));
  if(d.morph){g.morphAttributes.position=[new THREE.BufferAttribute(d.morph.array,3)];g.morphAttributes.position[0].name=d.morph.name||'Sentado';g.morphTargetsRelative=true;}
  g.userData={...d.userData};g.computeBoundingSphere();return g;};
 await Promise.all([...Array(n)].map((_,w)=>new Promise((ok,fail)=>{const mine=jobs.filter((_,i)=>i%n===w);if(!mine.length)return ok();
  const worker=new Worker(new URL('./gente.worker.js',import.meta.url),{type:'module'});
  worker.onerror=e=>{worker.terminate();fail(e);};
  worker.onmessage=e=>{const d=e.data;if(d.done){worker.terminate();return ok();}if(d.error){console.warn('persona (worker)',d.error);return;}
   const [L,m]=looks[d.id],scene=cloneSkinned(base.holder.children[0]);let mesh=null;scene.traverse(o=>{if(o.isSkinnedMesh&&!mesh)mesh=o;});
   mesh.geometry=unpack(d.full);mesh.updateMorphTargets();armContactProfile(mesh,null);
   const lods=d.lods.map(unpack);for(const l of lods)l.userData.armContact=mesh.geometry.userData.armContact;
   out[d.id]={name:m,scene,clips:base.clips,look:L,outfit:jobs[d.id].outfit,lods,partSource:mesh.geometry,parts:mesh.geometry.userData.wardrobeParts};};
  worker.postMessage({jobs:mine});})));
 return out.filter(Boolean);}
// Los policías de la comisaría: el uniforme azul (BlueSoldier), con pelo corto y casco propio a veces.
let policeCache=null;
export function loadPolice(){if(!policeCache){const r=rng(4242);policeCache=(async()=>{const out=[];for(const m of ['BlueSoldier_Male','BlueSoldier_Male','BlueSoldier_Female','BlueSoldier_Female']){
  // (sin género: el pelo largo o corto, a cualquiera)
  const L={optimizarRopa:false,cuerpo:CUERPO,cabeza:CABEZA,modelo:m,piel:['clara','media','trigueña','oscura'][Math.floor(r()*4)],pelo:['negro','castaño'][Math.floor(r()*2)],sombreroPropio:r()<.5,
   ...(r()<.5?{pzPelo:'pelo:'+FEM[Math.floor(r()*FEM.length)]}:{pzPelo:'pelo:Casual2_Female',corte:.4})};try{out.push(await template(L,m));}catch(e){console.warn('policía',e);}}return out;})();}
 return policeCache;}

export function makeCharacter(t,rand){
 const root=cloneSkinned(t.scene);let mesh=null;root.traverse(o=>{if(o.isSkinnedMesh&&!mesh)mesh=o;});
 // El esqueleto se mueve: el volumen de la pose base no sirve para descartar lo que está fuera de cámara.
 // (2026-10-14) Se descarta lo que está fuera de cámara con una esfera FIJA y holgada en el espacio del muñeco (centro a
 // media altura, radio que cubre brazos abiertos, sentado y saltando): la del esqueleto en reposo no sirve porque se
 // mueve, y calcularla por cuadro cuesta más de lo que ahorra.
 root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.frustumCulled=true;if(o.isSkinnedMesh)o.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,1.6,0),2.4);}});
 const holder=new THREE.Group();holder.add(root);rand();root.scale.setScalar(SCALE*CUERPO_UNICO.escala);// (todos del mismo alto: el del muñeco; el número del alto se sigue sacando)
 const mixer=new THREE.AnimationMixer(root),clip=n=>THREE.AnimationClip.findByName(t.clips,n);
 const acts={idle:mixer.clipAction(clip('Idle')),walk:mixer.clipAction(clip('Walk')),run:mixer.clipAction(clip('Run')||clip('Walk'))};for(const [k,n] of [['trabajar','Typing'],['esposar','Arrest'],['esposado','Cuffed'],['esposadoCamina','Walk_Cuffed'],['celular','Phone'],['celularCamina','Walk_Phone'],['comer','Eat_Sitting']])if(clip(n))acts[k]=mixer.clipAction(clip(n));
 // (cada update del mezclador elige también la versión según la distancia a la cámara)
 {const up1=mixer.update.bind(mixer);let cc=null;mixer.update=dt=>{const r=up1(dt);if(cc)updateLod(cc,LOD_CAM);return r;};queueMicrotask(()=>{});mixer.__setChar=c=>{cc=c;};}
 installFeet(root,mixer,holder,t.look?.piernas||1);
 // (la falda sigue al muslo: persona3d.js followSkirt)
 {const fs=followSkirt(root);if(fs){const up0=mixer.update.bind(mixer);mixer.update=dt=>{const r=up0(dt);fs();return r;};}}
 // (uno de cada siete camina hablando por celular)
 if(acts.celularCamina&&rand()<.14)acts.walk=acts.celularCamina;
 acts.idle.play();acts.idle.time=rand()*acts.idle.getClip().duration;
 installArmContact(root,mixer,mesh);installSeatedCloth(root,mixer,mesh);
 // (2026-10-14) Los lejanos se animan menos seguido: a media distancia uno de cada 2 cuadros, lejos uno de cada 3, con el
 // tiempo acumulado (no se atrasan). Cada persona empieza en un cuadro distinto para repartir el trabajo.
 // (y los que no se dibujaron en el último cuarto de segundo —fuera de cámara— se animan uno de cada 4 cuadros; al
 // volver a cámara recuperan el ritmo en el cuadro siguiente)
 let cc2=null,seenAt=0;if(mesh)mesh.onBeforeRender=()=>{seenAt=performance.now();};
 {const inner=mixer.update.bind(mixer);let acc=0,tick=Math.floor(rand()*6);mixer.update=dt=>{acc+=dt;const off=performance.now()-seenAt>250,k=ANIM_EVERY[off?3:cc2?.lod||0];if(k>1&&(++tick)%k)return;const d=acc;acc=0;return inner(d);};}
 const c={holder,mixer,acts,state:'idle',mesh,full:mesh?.geometry,lods:t.lods,lod:0,parts:t.parts,extractPart:id=>extractPart(t.partSource,id)};mixer.__setChar?.(c);cc2=c;return c;
}

// Cambiar de quieto a caminar (o correr) con un fundido corto; al caminar, el paso sigue a la velocidad.
export function moveCharacter(c,state,speed,dt){
 if(c.state!==state){const from=c.acts[c.state],to=c.acts[state];to.reset().setEffectiveWeight(1).play();from.crossFadeTo(to,.25,false);c.state=state;}
 // (el ritmo de la animación: a ritmo 1 avanza ANIM.paso m/s —medidas.js; validar-caminar mide que los pies no patinen—)
 if(state==='walk')c.acts.walk.timeScale=Math.max(ANIM.min,Math.min(ANIM.max,speed/ANIM.paso));
 c.mixer.update(dt);
}
