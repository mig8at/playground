/* La gente del juego (2026-11-22, Miguel: «saca todos los muñecos anteriores y mándalos a before para dejar lo que vamos a
   dejar»). Los personajes nuevos de personajes3d.js —los maniquíes con el esqueleto de las Universal Animation Library, el
   pelo amarrado a la cabeza, la ropa por zonas y la contextura— detrás de la MISMA puerta que tenían los muñecos viejos
   (before/src/lib/characters3d.js): loadCharacters, makeCharacter, moveCharacter, vestirPlantilla, plantillaJugador.
   (2026-11-22: sin la policía ni su uniforme, que eran del juego de policías y ladrones —before/fuga/—)
   - Una plantilla: un cuerpo armado (hombre o mujer con su peinado, compartido entre plantillas), su look (piel, pelo,
     contextura), su atuendo y su material (la paleta de las zonas). Cada persona es una copia con su esqueleto y su
     mezclador; comparte la malla y el material de la plantilla: un dibujo por persona.
   - La ropa: un atuendo {lugar: {id, color}} del catálogo de ropa.js se vuelve colores de zona (zonasDeRopa).
   - Las animaciones con los nombres de antes (Idle, Walk, Run, SitDown…) apuntan a las de las bibliotecas (ALIAS).
   - Los niveles de detalle: los cuatro de personajes3d (los de los árboles, NIVELES_PLANTA). */
import {ANIM,CUERPO as MEDIDA_CUERPO} from '../engine/medidas.js';
import {COLORS} from '../engine/vestuario.js';
import * as THREE from 'three';
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js';
import {NIVELES_PLANTA,VUELVE_PLANTA} from './nature3d.js';
import {PEINADOS,NIV,Z,materialRopa,armarCuerpo,cargarTodo,aplicarContextura,contexturaAlAzar} from './personajes3d.js';
import {zonasDeRopa,PALETTE} from './ropa.js';

// La gente de la calle: el modelo dice el estilo de la ropa (formal, de oficio, casual) y si es hombre o mujer.
export const CIVILS=['Casual_Male','Casual_Female','Casual2_Male','Casual2_Female','Casual3_Male','Casual3_Female','Casual_Bald',
 'Suit_Male','Suit_Female','Worker_Male','Worker_Female','OldClassy_Male','OldClassy_Female','Chef_Male','Doctor_Male_Young','Doctor_Female_Old'];
// (las animaciones con el nombre que usa el juego → la de las bibliotecas)
export const ALIAS={Idle:'Idle_Loop',Walk:'Walk_Loop',Run:'Jog_Fwd_Loop',SitDown:'Sitting_Enter',StandUp:'Sitting_Exit',Typing:'Sitting_Idle_Loop',
 Eat_Sitting:'Sitting_Talking_Loop',Phone:'Idle_TalkingPhone_Loop',Arrest:'Interact'};
const rng=s=>()=>(s=(s*16807)%2147483647)/2147483647;

// ---- La carga: una vez para todos ----
let todo=null;const cargarUnaVez=()=>todo||(todo=cargarTodo());
const cuerpos=new Map(),clipsCon=new Map(),altoDe={};
// (un cuerpo por combinación de cuerpo y peinado; con sus niveles de detalle)
function cuerpoDe(T,quien,pelos){const k=quien+'|'+pelos.join('+');if(!cuerpos.has(k)){const raiz=armarCuerpo(T.cuerpos[quien],pelos.map(p=>T.peloDe[p]),null,null,T.ajustes[quien]);
  /* (el alto: los vértices en la pose de origen —por la matriz de amarre de la malla—, sin el pelo) */
  if(!altoDe[quien]){let lo=Infinity,hi=-Infinity;const v=new THREE.Vector3();raiz.traverse(o=>{if(!o.isSkinnedMesh)return;const pa=o.geometry.attributes.position,zo=o.geometry.attributes.zona;
   for(let i=0;i<pa.count;i++){if(zo&&zo.getX(i)===Z.pelo)continue;v.fromBufferAttribute(pa,i).applyMatrix4(o.bindMatrix);lo=Math.min(lo,v.y);hi=Math.max(hi,v.y);}});altoDe[quien]=hi-lo;}
  cuerpos.set(k,raiz);}return cuerpos.get(k);}
function clipsDe(T,quien){if(!clipsCon.has(quien)){const cs=T.clipsDe[quien],por=n=>cs.find(c=>c.name===n);
  clipsCon.set(quien,[...cs,...Object.entries(ALIAS).filter(([,n])=>por(n)).map(([a,n])=>{const c=por(n);return new THREE.AnimationClip(a,c.duration,c.tracks);})]);}
 return clipsCon.get(quien);}

// ---- El look: cuerpo, peinado, piel, pelo y contextura ----
// (el peinado del perfil —los nombres de antes— al de los personajes nuevos; la barba va con el cuerpo de hombre)
const PEINADO_DE={'pelo:Casual_Female':['mujer','Hair_Long'],'pelo:Casual2_Female':['mujer','Hair_Buns'],'':['hombre','Hair_Buzzed']};
export function peinadoDe(peinado='',barba=''){let [quien,pelo]=PEINADO_DE[peinado]||(/Female/.test(peinado)?['mujer','Hair_Long']:/^Hair_/.test(peinado)?[/Long|Buns|Female/.test(peinado)?'mujer':'hombre',peinado]:['hombre','Hair_SimpleParted']);
 if(barba&&quien==='mujer'){quien='hombre';pelo='Hair_SimpleParted';}return {quien,pelos:[pelo,...(barba?['Hair_Beard']:[])]};}
// Un look de calle para el modelo m. pzPelo y peinado los lee el retrato (fuga/lib/persecucion3d.js rasgosDe).
export function lookFor(m,r){const pick=a=>a[Math.floor(r()*a.length)],quien=/Female/.test(m)?'mujer':'hombre',pelos=pick(PEINADOS[quien]);
 return {modelo:m,quien,pelos,piel:pick(Object.keys(COLORS.piel)),pelo:pick(Object.keys(COLORS.pelo)),pzPelo:pelos[0]||'',peinado:!pelos.length?'calvo':/Buzzed/.test(pelos[0])?'rapado':'',
  ...(pelos.includes('Hair_Beard')?{barba:'tres_dias'}:{}),forma:contexturaAlAzar(r,quien==='mujer')};}
// El atuendo de calle (sin género: una sola lista de prendas para todos).
const NEUTRAL=['#2f3133','#3d5370','#26282a','#5c6340','#7d8284','#c8b48f','#2b3d5c','#6e4e35'];
export function outfitFor(L,r){const pick=a=>a[Math.floor(r()*a.length)],oficio=/^(Chef|Worker)/.test(L.modelo||''),formal=/^(Suit|OldClassy|Doctor)/.test(L.modelo||'');
 const top=formal?pick(['camisa','camisa','polo','manga-larga']):pick(['camiseta','camiseta','manga-larga','polo','camisa','sudadera','sudadera-capucha','sin-mangas','rayas','cuadros','logo','franja','tres-cuartos','manga-codo','ombliguera','cuello-v','cuello-alto']);
 const bottom=formal?'pantalon':pick(['jean','jean','pantalon','cargo','deportivo','bermuda','pantaloneta','leggings','short','pescador',...(oficio?['overol','overol']:['overol'])]);
 // (2026-11-22: sólo prendas pegadas a la piel —ropa.js SUELTAS—: sin lo de encima, sin faldas ni vestido, sin gorras)
 const shoes=formal?'zapatos':pick(['tenis','tenis','botas','zapatos']),c1=pick(PALETTE);let c2=pick(NEUTRAL);while(c2===c1)c2=pick(NEUTRAL);
 const o={underwear:{id:'boxer'},top:{id:top,color:c1},bottom:{id:bottom,color:c2},shoes:{id:shoes,color:pick(['#232425','#34507a','#5b3b25','#f2f0ea'])}};
 return o;}

// ---- Las plantillas ----
// (el material: la paleta de las zonas, de la piel, el pelo y el atuendo)
export const materialDe=(L,outfit)=>{const piel=COLORS.piel[L.piel]||L.piel||'#d9a77f';return materialRopa(piel,{...zonasDeRopa(outfit,piel),pelo:COLORS.pelo[L.pelo]||L.pelo||'#2a2522'});};
async function plantilla(L,name,outfit){const T=await cargarUnaVez(),scene=cuerpoDe(T,L.quien,L.pelos);
 return {name,scene,clips:clipsDe(T,L.quien),look:L,outfit,material:materialDe(L,outfit),alto:altoDe[L.quien]};}
const caches=new Map();
// (per: plantillas por modelo; cada una cuesta un material, no una malla: las mallas son por cuerpo y peinado)
export function loadCharacters(names=CIVILS,{per=2,seed=7}={}){const key=[names.join(),per,seed].join('|');if(caches.has(key))return caches.get(key);
 const r=rng(seed*7919+1),vr=rng(31337),looks=[];for(const m of names)for(let i=0;i<per;i++)looks.push([lookFor(m,r),m]);
 const p=Promise.all(looks.map(([L,m])=>plantilla(L,m,outfitFor(L,vr)).catch(e=>{console.warn('persona',m,e);return null;}))).then(a=>a.filter(Boolean));caches.set(key,p);return p;}
// (el menú del juego: la misma persona con otra ropa)
export const vestirPlantilla=(t,outfit)=>plantilla(t.look,t.name,outfit);
// (el perfil del jugador: su cuerpo —piel, pelo, peinado, barba— y su ropa)
export function plantillaJugador(cuerpo,outfit){const {quien,pelos}=peinadoDe(cuerpo.peinado,cuerpo.barba);
 const L={modelo:'Casual_Male',quien,pelos,piel:cuerpo.piel,pelo:cuerpo.pelo,pzPelo:cuerpo.peinado||'',peinado:cuerpo.peinado?'':'rapado',...(cuerpo.barba?{pzBigote:cuerpo.barba}:{}),forma:{}};
 return plantilla(L,L.modelo,outfit);}

// ---- Las personas ----
// Los niveles de detalle por distancia a la cámara (la demo copia acá la cámara en cada cuadro); se cambia la geometría de la
// misma malla (comparte esqueleto y animación).
export const ANIM_EVERY=[1,1,2,4,4];// (cada cuántos cuadros se anima, por nivel; el último, fuera de cámara)
export const LOD_CAM={x:0,y:0,z:0};
export function updateLod(c,cam){if(!c.lods?.length||!c.mesh)return;const p=c.holder.position,d=Math.hypot(p.x-cam.x,p.y-cam.y,p.z-cam.z);let k=c.lod;
 while(k+1<c.lods.length&&d>NIVELES_PLANTA[k+1].desde)k++;while(k>0&&d<NIVELES_PLANTA[k].desde*VUELVE_PLANTA)k--;
 if(c.lod!==k){c.lod=k;c.mesh.geometry=c.lods[k];}}
export function makeCharacter(t,rand){
 const root=cloneSkinned(t.scene);let mesh=null;root.traverse(o=>{if(o.isSkinnedMesh&&!mesh)mesh=o;});
 // (se descarta fuera de cámara con una esfera fija y holgada: la del esqueleto en reposo no sirve porque se mueve)
 root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.frustumCulled=true;if(o.isSkinnedMesh){o.material=t.material;o.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,.95,0),1.4);}}});
 // (la estatura: la del cuerpo de las medidas —medidas.js CUERPO.alto— por la de la persona)
 const holder=new THREE.Group();holder.add(root);rand();aplicarContextura(root,{...t.look.forma,estatura:(t.look.forma?.estatura||1)*MEDIDA_CUERPO.alto/1000/(t.alto||1.8)});
 const mixer=new THREE.AnimationMixer(root),clip=n=>THREE.AnimationClip.findByName(t.clips,n);
 const acts={idle:mixer.clipAction(clip('Idle')),walk:mixer.clipAction(clip('Walk')),run:mixer.clipAction(clip('Run'))};
 for(const [k,n] of [['trabajar','Typing'],['esposar','Arrest'],['celular','Phone'],['comer','Eat_Sitting']])if(clip(n))acts[k]=mixer.clipAction(clip(n));
 acts.idle.play();acts.idle.time=rand()*acts.idle.getClip().duration;
 // (los lejanos se animan menos seguido, con el tiempo acumulado; los que no se dibujaron en el último cuarto de segundo, uno
 // de cada 4 cuadros. Cada persona empieza en un cuadro distinto para repartir el trabajo. Y en cada update, el nivel)
 let seenAt=0;if(mesh)mesh.onBeforeRender=()=>{seenAt=performance.now();};
 const c={holder,mixer,acts,state:'idle',mesh,full:mesh?.geometry,lods:mesh?NIV[mesh.name]:[],lod:0,parts:null,extractPart:()=>null};
 const inner=mixer.update.bind(mixer);let acc=0,tick=Math.floor(rand()*6);
 mixer.update=dt=>{acc+=dt;const off=performance.now()-seenAt>250,k=ANIM_EVERY[off?4:c.lod||0];if(k>1&&(++tick)%k)return mixer;const d=acc;acc=0;const r=inner(d);updateLod(c,LOD_CAM);return r;};
 return c;}

// Cambiar de quieto a caminar (o correr) con un fundido corto; al caminar, el paso sigue a la velocidad.
export function moveCharacter(c,state,speed,dt){
 if(c.state!==state){const from=c.acts[c.state],to=c.acts[state];to.reset().setEffectiveWeight(1).play();from.crossFadeTo(to,.25,false);c.state=state;}
 // (el ritmo de la animación: a ritmo 1 avanza ANIM.paso m/s —medidas.js—)
 if(state==='walk')c.acts.walk.timeScale=Math.max(ANIM.min,Math.min(ANIM.max,speed/ANIM.paso));
 c.mixer.update(dt);}
