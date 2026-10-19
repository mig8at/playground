<script setup>
// (?lab=1: los botones de prueba a la vista —el juego, sin ellos, como terminado—)
const LAB=new URLSearchParams(location.search).has('lab');
/* /demo: caminar la ciudad en primera persona. Por ahora es sólo lo visual (sin reglas ni otros jugadores): la misma
   ciudad que juega el motor, a escala de persona, como base para llevar el juego a multijugador.
   ?jugadores=3&ciudad=1234 */
import {ref,onMounted,onBeforeUnmount} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import * as THREE from 'three';
import {PointerLockControls} from 'three/addons/controls/PointerLockControls.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {createViewmodel,ViewmodelPass} from '../lib/viewmodel3d.js';
import {createShooting} from '../lib/disparo3d.js';
import {COLORS} from '../engine/vestuario.js';
import {EdgePass} from '../lib/edges3d.js';
import {City} from '../engine/index.js';
import {generateBlueprint} from '../engine/blueprint.js';
import {planoDe} from '../lib/mapasGuardados.js';
import {cartelDe} from '../engine/juego/identidad.js';
import {randomCity,SIZES,CORE_RULES} from '../lib/core.js';
import {createCitizens,createIslandFolk} from '../lib/citizens3d.js';
import {loadAnimals,createAnimals} from '../lib/animals3d.js';
import {createTraffic,loadCars,buildVehicle} from '../lib/traffic3d.js';
import {loadDowntown} from '../lib/downtown3d.js';
import {loadPlants,loadNature,loadNature2,loadHouseKit,loadOffice,loadCasa2,loadTienda} from '../lib/nature3d.js';
import {createHouses} from '../lib/vivienda3d.js';
import {buildIsland,loadIslandBuildings,ISLAND_MARGIN,CLIFF,ISLA3D} from '../lib/island3d.js';
import {dibujarPlano,revisarContrato,revisarSuelo,revisarAndenes} from '../lib/plano3d.js';
import {loadCharacters,loadPolice,LOD_CAM,makeCharacter,moveCharacter,vestirPlantilla,plantillaJugador,uniformeDe} from '../lib/characters3d.js';
import MenuJuego from '../components/MenuJuego.vue';
import {describirRopa,etiqueta} from '../lib/ropaTexto.js';
import {GARMENTS,PALETTE} from '../lib/vestier3d.js';
import {buildWorld,CELL,EYE,WORLD_TIMES} from '../lib/world3d.js';
import {createIndoor} from '../lib/indoor3d.js';
import {createBarrios} from '../lib/barrios3d.js';
import {createCasas} from '../lib/casas3d.js';
import {createCut} from '../lib/cutaway3d.js';
import {drawWorldStage} from '../lib/drawPlan.js';
import {CIRCULACION,ATERRIZAJE,ALCANCE,VIDA} from '../engine/medidas.js';
import {danoDeCaida} from '../engine/juego/huida.js';
import {ubicacionDe} from '../engine/direcciones.js';
import {crearNiebla} from '../lib/niebla3d.js';
import {paredesAClarar,VISIBILIDAD} from '../engine/visibilidad.js';
import {visiblesDesde} from '../engine/visibles.js';
import {createAclarado} from '../lib/aclarado3d.js';
import {createAcciones} from '../lib/acciones3d.js';
import {crearRonda,robar,guardar,sacar,incautar,perseguido,precio,gano,hayGente,empezarForzar,tickForzar,trancada,puertaTrancadaEn,robadoEn} from '../engine/juego/ronda.js';
import {placeParts,partsMesh,OBJETOS} from '../lib/objetos3d.js';
import {createPersecucion,rasgosDe} from '../lib/persecucion3d.js';
import {createSociedad3d} from '../lib/sociedad3d.js';
import {createPatrullas} from '../lib/patrulla3d.js';
import {sociedadDe,puertasDeLugares,abierto,horaTexto,ocupacionSociedad,direccionHogar} from '../engine/sociedad.js';
import {rng} from '../engine/veredas.js';
import {mapaDeJuego} from '../engine/juego/mapa.js';
import {RELOJ,MODO_BOTIN,PATRULLA} from '../engine/medidas.js';

// (el salto, el del 2D —CIRCULACION.peaton.salto—: de ahí sale ALCANCE, a qué muebles se sube; CHOQUE_MUEBLE)
const WALK=CIRCULACION.peaton.velocidad.camina,RUN=CIRCULACION.peaton.velocidad.corre,RADIUS=.26,GRAVITY=CIRCULACION.peaton.salto.gravedad,JUMP=CIRCULACION.peaton.salto.velocidad,MAP_CELL=2,STREET_LIGHTS=12;
const route=useRoute(),router=useRouter();
const team=ref(SIZES.includes(+route.query.jugadores)?+route.query.jugadores:3);
// La demo usa los parques repartidos (opción del generador en prueba); ?parques=0 muestra la ciudad de siempre.
const parks=route.query.parques!=='0';
const pickCity=t=>{if(!parks)return randomCity(t);for(let i=0;i<200;i++){const s=1+Math.floor(Math.random()*99999);if(City.analyze(City.generate({seed:s,team:t,parks})).ok)return s;}return 1;};
const seed=ref(+route.query.ciudad||pickCity(team.value));
// characters: los personajes animados (se cargan una vez al entrar); mientras tanto, «Cargando gente…».
let characters=[],carModels=null,buildings=null,downtown=null,plants=null,nature=null,nature2=null,casa2=null,tienda=null,furniture=null,policeTemplates=[],indoor=null,patrol=null,office=null;const loadingPeople=ref(true);
// La ronda jugable (2026-10-17, REGLAS.md): lo robado, lo guardado, la meta y las guaridas, para el panel de arriba.
// La vida (REGLAS.md paso 2): la barra, el golpe al caer y la muerte (huida.js; medidas.js VIDA).
const vidaVista=ref(VIDA.max),muerto=ref(false);let ultimoGolpe=-1e9;
const rondaVista=ref(null),rondaMsg=ref('');let ronda=null,rondaMsgT=0;
// El papel (REGLAS.md paso 3): ?papel=policia juega de policía contra los ladrones bots del motor (persecucion3d.js); si
// no, la ronda del ladrón.
const POLICIA=route.query.papel==='policia';let cerraduras=null;
// La sociedad (etapa 2, 2026-10-17): la hora de la ciudad (el reloj de la ronda), la gente de las familias en la calle
// (sociedad3d.js, en vez de la que caminaba sin rumbo) y los locales trancados mientras están cerrados. quienVista: el
// cartel con el nombre y el oficio del que está al lado.
let soc=null,cierres=null,cierresReloj=0,nocheAuto=null;
// Las patrullas (REGLAS.md paso 4, patrulla3d.js): estacionadas frente a la comisaría; sólo la policía se sube (E).
let patrullas=null;const velocidad=ref(null);
// El menú (Tab, 2026-10-17: components/MenuJuego.vue, el prototipo de /menu con los datos de la partida). menuDatos se
// arma cada medio segundo mientras está abierto. Del ladrón: la ropa de repuesto en la mochila, el retrato que le sacan
// las cámaras de los edificios (y que a RETRATO_DIFUNDE s sale en las noticias) y los titulares de la ronda.
const menuAbierto=ref(false),menuDatos=ref(null);let menuReloj=0,vistiendo=0,ropaMochila=[],retratoLadron=null,titulares=[],marcaPlano=null,censoMenu=null;
const RETRATO_DIFUNDE=45,VESTIR_S=4;
// el muñeco del perfil (/inicio): el mismo cuerpo, con la ropa de calle de ladrón o el uniforme de policía; mientras se
// arma (unos cientos de ms), el de una plantilla al azar
const cuentaPerfil=()=>{try{return JSON.parse(sessionStorage.getItem('fuga:cuenta')||'null');}catch{return null;}};
async function muñecoDelPerfil(){const c=cuentaPerfil();if(!c?.cuerpo||!c.ropa)return;const w0=world;
 const outfit=POLICIA?uniformeDe({gorra:c.ropa.gorra!==false}):{underwear:{id:'boxer',color:'#343d50'},...Object.fromEntries(Object.entries(c.ropa.calle||{}).filter(([,p])=>p))};
 try{const t=await plantillaJugador(c.cuerpo,outfit,POLICIA);if(world!==w0)return;makeAvatar(t);if(cut)cut.patchTree(avatar.holder);}catch(e){console.warn('el muñeco del perfil',e);}}
const nombreCuenta=()=>{try{return JSON.parse(sessionStorage.getItem('fuga:cuenta')||'null')?.nombre||'';}catch{return '';}};const horaVista=ref(''),quienVista=ref(null);// (las puertas de las viviendas: las de la ronda del ladrón, o de policía todas trancadas)
let persec=null,persecReloj=0,avisosVistos=0;const policiaVista=ref(null);
const accionTexto=ref(''),accionAlterna=ref(''),aiming=ref(false),hitMark=ref(0),host=ref(null),mini=ref(null),locked=ref(false),night=ref(false),showMap=ref(true),place=ref(''),drone=ref(false),lugar=ref(null);let niebla=null;
// Modo dron: la cámara vuela libre (sin choques) y el jugador se queda donde estaba, marcado desde arriba.
const DRONE_SPEED=22,DRONE_FAST=60,DRONE_MIN=-320,DRONE_MAX=260;
const dronePos={x:0,y:0,z:0};let marker;
// Tercera persona (2026-10-14, T alterna): el jugador es un muñeco del vestier (una plantilla de la gente) y la cámara va
// detrás, a CAM_DIST, mirando hacia donde apunta el mouse. Si una pared queda entre la cámara y el muñeco, la cámara se
// acerca; bajo techo no sube más que CAM_ROOF sobre los pies.
// Dos vistas, como un shooter (Miguel, 2026-10-15): detrás del muñeco (Fortnite, la de por defecto) y primera persona
// (Call of Duty). La vista desde arriba con los edificios cortados (cutaway3d.js) se retiró: daba muchas complicaciones
// —muebles flotando, medianeras, el techo—; su código sigue en thirdPerson pero no se entra (VIEWS no la tiene) y el
// corte no se crea. T y F alternan detrás ⇄ primera.
const VIEWS=['tercera','primera'],view=ref(VIEWS.includes(route.query.vista)?route.query.vista:'tercera'),third={get value(){return view.value!=='primera';}};
const TOP_DIST=8,TOP_PITCH=-.95,CUT_H=2.55,STUB=.8,CUT_T=.3;let aclarado=null,aclPrev=null,acciones=null,accionCerca=null,accionReloj=0,cut=null,cutA=0,lastBox=null,lastShared=null,lastFeet=0,topTurn=null,topZoom=8,topDist=8;
// ORIENTAR (2026-10-16, Miguel: «girar la cámara mientras camino se siente incómodo»): 'camara' —el cuerpo mira hacia la
// cámara y se desplaza de costado, como en Fortnite— o 'movimiento' —el cuerpo gira hacia donde camina: con A/D y la cámara
// girando, daba vueltas alrededor de ella—.
const ORIENTAR='camara';
const CAM_DIST=4,CAM_HEAD=1.75,CAM_LIFT=.55,CAM_ROOF=2.3,CAM_CAMBIO=.5,CAM_ALARGA=3,CAM_ACORTA=8,CAM_SOSTEN=.25;let camWay=0,camWayT=0,camDistS=CAM_DIST,camHeadY=null,camPosY=null;let avatar=null,avatarYaw=0;
// Ascensor: el aviso mientras se está en una cabina, y el fundido a negro al cambiar de piso.
const lift=ref(null),fading=ref(false);let lifting=false;
function ride(d){const at=world.elevatorAt(player.x,player.z,player.feet);if(!at||lifting)return;const to=at.floor+d;if(to<0||to>=at.floors)return;
 lifting=true;fading.value=true;setTimeout(()=>{player.feet=at.y?at.y(to):to*3+(at.raise||0);player.vy=0;fading.value=false;setTimeout(()=>{lifting=false;},250);},300);}

// La ciudad limpia (2026-10-15, decisión de Miguel): sin gente ni árboles mientras la ciudad se define con cálculos; el
// muñeco del jugador sí.
const CIUDAD_LIMPIA=true;
const tiempos={};let planoVista=null,shadowTick=0,animalKit=null,animals=null,casas=null,viviendas=null,barrios=null,edgePass=null,renderer,composer,bloom,scene,camera,controls,world,crowd,traffic,island,folk,city,plan=null,streetLights=[],lightClock=0,sky,stars,sun,hemi,frame=0,last=0,baseMap=null,mapOff={x:0,y:0};
const keys=new Set(),player={x:0,z:0,feet:0,vy:0,ground:true,bob:0};
const euler=new THREE.Euler(0,0,0,'YXZ');

// Cielo: un domo con degradé y el sol (o la luna); no lo toca la niebla.
function makeSky(){
 const m=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,
  uniforms:{top:{value:new THREE.Color()},horizon:{value:new THREE.Color()},bottom:{value:new THREE.Color()},sunDir:{value:new THREE.Vector3()},sunColor:{value:new THREE.Color()}},
  vertexShader:'varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:`uniform vec3 top,horizon,bottom,sunColor;uniform vec3 sunDir;varying vec3 vDir;
   void main(){vec3 d=normalize(vDir);float h=d.y;vec3 c=h>0.0?mix(horizon,top,pow(h,.55)):mix(horizon,bottom,pow(-h,.35));
    float s=max(dot(d,normalize(sunDir)),0.0);c+=sunColor*(pow(s,900.0)*3.0+pow(s,10.0)*.18);gl_FragColor=vec4(c,1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`});
 return new THREE.Mesh(new THREE.SphereGeometry(700,32,16),m);
}
function makeStars(){
 const p=[];for(let i=0;i<1400;i++){const t=Math.random()*Math.PI*2,u=.05+Math.random()*.95,r=650;p.push(Math.cos(t)*Math.sqrt(1-u*u)*r,u*r,Math.sin(t)*Math.sqrt(1-u*u)*r);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
 return new THREE.Points(g,new THREE.PointsMaterial({color:0xffffff,size:1.6,sizeAttenuation:false,fog:false,transparent:true,opacity:.8}));
}

function applyLight(){
 const n=night.value,u=sky.material.uniforms;
 const dir=n?new THREE.Vector3(-.45,.6,-.5):new THREE.Vector3(.55,.72,.38);dir.normalize();
 // De noche el horizonte guarda el resplandor anaranjado de la ciudad.
 u.top.value.set(n?'#03050b':'#4f88c6');u.horizon.value.set(n?'#33293a':'#d4e3ec');u.bottom.value.set(n?'#141a2a':'#9fbfd8');
 u.sunDir.value.copy(dir);u.sunColor.value.set(n?'#9fb0d0':'#fff2d6');
 // Desde el dron se ve lejos: la niebla se corre para que entre la ciudad entera.
 scene.fog.color.set(n?'#1c1f2c':'#cad9e2');scene.fog.near=drone.value?(n?80:150):(n?22:45);scene.fog.far=drone.value?(n?480:720):(n?170:240);
 sun.color.set(n?'#8ea6e0':'#fff1dc');sun.intensity=n?.35:2.6;sun.userData.dir=dir;
 hemi.color.set(n?'#4a5a7a':'#e3eef8');hemi.groundColor.set(n?'#1a1410':'#8a8170');hemi.intensity=n?.3:1.25;
 renderer.toneMappingExposure=n?1.05:1;stars.visible=n;world?.setNight(n);traffic?.setNight(n);island?.setNight(n);barrios?.setNight(n);viviendas?.setNight(n);
 // El brillo (bloom) y las luces de los postes cercanos, sólo de noche: de día no se ven y cuestan.
 bloom.enabled=n;for(const l of streetLights)l.visible=n;
}

function load(ready=null){
 const L0=performance.now();let Lp=L0;const lap=n=>{const t=performance.now();(tiempos.mundo||(tiempos.mundo={}))[n]=Math.round(t-Lp);Lp=t;};
 shooting?.clear();if(world){scene.remove(world.group);world.dispose();barrios?.dispose();casas?.dispose();viviendas?.dispose();crowd.dispose();traffic.dispose();island.dispose();folk.dispose();planoVista?.dispose();indoor?.dispose();patrol?.dispose();animals?.dispose();}
 persec?.dispose();persec=null;finVista.value=null;presoVista.value=null;patrullas=null;velocidad.value=null;menuAbierto.value=false;menuDatos.value=null;retratoLadron=null;titulares=[];ropaMochila=[];censoMenu=null;marcaPlano=null;cerraduras=null;soc?.dispose();soc=null;cierres=null;horaVista.value='';quienVista.value=null;nocheAuto=null;policiaVista.value=null;avisosVistos=0;
 // La ciudad del plano por etapas (/generador): el 3D dibuja sus edificios tal cual.
 const want={seed:seed.value,team:team.value,parks};plan=ready&&ready.seed===want.seed&&ready.team===want.team?ready:generateBlueprint(want);city=plan.map;lap('plano');let vs=7;const vr=()=>((vs=(vs*9301+49297)%233280)/233280);
 world=buildWorld(city,{plan,downtown,nature,vehicle:type=>carModels?buildVehicle(type,vr,carModels):null,furniture:furniture||office?{...(furniture||{}),...(office||{})}:null,arboles:!CIUDAD_LIMPIA,mobiliario:!plan.equipamiento});lap('ciudad');
 // (con el plano, faroles, bancas, cebras, árboles… los pone su contrato —plano3d.js—: ni la ciudad, ni la isla ni los barrios los ponen por su cuenta)
 ISLA3D.faroles=!plan.equipamiento;
 // La gente de la calle: la misma cantidad que en el prototipo (crowd por jugador, los dos equipos).
 crowd=createCitizens(world,{count:0,/* (la gente de la calle es la de la sociedad: sociedad3d.js) */seed:seed.value,templates:characters,seats:world.benchSeats});world.group.add(crowd.group);lap('gente calle');
 traffic=createTraffic(world,{seed:seed.value,models:carModels,plan});world.group.add(traffic.group);lap('tráfico');
 // La isla alrededor: playa, montañas y mar; los pueblos, casas, senderos, globo y parapente salen del plano (etapa 9).
 island=buildIsland(city,{plan,buildings,plants,nature,furniture:furniture||office?{...(furniture||{}),...(office||{})}:null});world.group.add(island.group);lap('isla');
 // Los barrios residenciales de las manzanas de la montaña: edificios como los de la ciudad, con su parque alrededor.
 barrios=createBarrios(plan,{downtown,nature,furniture:furniture||office?{...(furniture||{}),...(office||{})}:null,ocultar:island.rampaEn,mobiliario:!plan.equipamiento});world.group.add(barrios.group);lap('barrios');
 // La gente de la isla rodea los edificios de los barrios (y los árboles y faroles de sus jardines).
 // Las casas de las manzanas de la montaña, con su jardín.
 casas=createCasas(plan,{nature,nature2,rampaEn:island.rampaEn});world.group.add(casas.group);lap('casas');
 // Las casas armadas (vivienda3d.js): se entra, se sube y se ve por las ventanas.
 viviendas=createHouses((plan.isla?.casas||[]).filter(c=>c.spec).map(c=>({spec:c.colores||c.cortinas?{...c.spec,...(c.colores?{colores2d:c.colores}:{}),...(c.cortinas?{cortinas2d:c.cortinas}:{})}:c.spec,x:c.x,y:c.nivel,z:c.z,ry:c.ry})),{kit:furniture||casa2?{...(furniture||{}),...(casa2||{}),...(tienda||{})}:null});world.group.add(viviendas.group);lap('viviendas');
 // (lo que queda entero detrás de la niebla no se dibuja: las casas del monte, por baldosas —niebla3d.js—)
 niebla=crearNiebla([viviendas.group]);// (el plano se suma al dibujarlo, más abajo)
 // La vegetación y el equipamiento del plano, por el contrato del 2D con el 3D (src/engine/contrato3d.js): cada cosa en
 // su lugar, con su giro y su medida, sobre el suelo del 3D. window.__contrato.revisar() compara lo dibujado con el plano.
 // (el suelo: el piso que hay justo encima del terreno —adentro de una casa del monte, su planta baja; afuera, el terreno—)
 const sueloPlano=(x,z)=>{const g=groundHere(x,z,0);return groundHere(x,z,g+1);};
 planoVista=dibujarPlano(plan,{kits:{nature2,plants},suelo:sueloPlano});world.group.add(planoVista.group);lap('plano 3d');niebla=crearNiebla([viviendas.group,planoVista.group]);
 {const pv=planoVista;window.__contrato={esperado:pv.esperado,registro:pv.registro,choques:pv.choques,collide:pv.collide,revisar:()=>revisarContrato(pv.esperado,pv.registro),
  // suelo(n): n puntos al azar (fijo) por zona caminable —calles del monte, playa, monte natural, veredas de la ciudad—
  suelo:(n=300)=>{let q=7;const rnd=()=>(q=(q*16807)%2147483647)/2147483647,cs=plan.isla.cells,pts=[],W=world.size;
   for(let i=0;i<n;i++){const c=cs[Math.floor(rnd()*cs.length)],x=(c.x+rnd())*CELL,z=(c.y+rnd())*CELL,t=c.carretera?'calle monte':c.zona==='playa'?'playa':c.zona==='montaña'&&!c.lote?'monte':c.zona==='pradera'&&!c.lote?'pradera':null;if(t)pts.push([t,x,z]);}
   const enLote=(x,z)=>plan.lots.some(L=>L.parts.some(p=>x>=p.x&&x<=p.x+p.w&&z>=p.y&&z<=p.y+p.h));// (plan.map.kind no marca los lotes)
   for(let i=0;i<n/3;i++){const x=rnd()*W.w,z=rnd()*W.h,k=city.kind[Math.floor(z/CELL)*city.W+Math.floor(x/CELL)];if((k===0||k===1)&&!enLote(x,z))pts.push(['ciudad',x,z]);}
   return revisarSuelo({scene,suelo:(x,z)=>groundHere(x,z,0),puntos:pts});},
  // andenes(): lo de la vereda, sobre el andén dibujado (no en el asfalto)
  andenes:()=>{const meshes=[];scene.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh&&o.visible&&!o.material?.transparent)meshes.push(o);});const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0),W=world.size;
   const arriba=(x,z)=>{const g=groundHere(x,z,0);ray.set(new THREE.Vector3(x,g+1.5,z),down);const h=ray.intersectObjects(meshes,false)[0];return h?h.point.y:null;};
   const ejes=(plan.isla?.carreteras||[]).filter(c=>c.tipo==='grilla'&&c.puntos).flatMap(c=>c.puntos.slice(1).map((b,i)=>({a:c.puntos[i],b})));
   return revisarAndenes({esperado:pv.esperado,plan,ejes,arriba,enCiudad:(x,z)=>x>=0&&z>=0&&x<=W.w&&z<=W.h,pisoCiudad:(x,z)=>world.floorAt(x,z,0)});}};}
 island.portal=casas.portal;// por la puerta de la cerca de los lotes
 island.jardin=casas.jardin;// los vecinos también visitan los jardines
 island.visita=viviendas.visita;// …y entran a las casas armadas a sentarse en el sofá o a acostarse en una cama
 island.sueloCasa=(x,z,feet)=>viviendas.floorAt(x,z,feet??island.ground(x,z)+.4);// el piso de adentro (feet: la planta en que está)
 island.bloqueo=(x,z)=>{const g=island.ground(x,z);return casas.collide(x,z,.3)||viviendas.dentro(x,z,g+1)||viviendas.collide(x,z,.3,true,g)||barrios.dentro(x,z,g+1)||barrios.collide(x,z,.3,true,g);};
 // Y nadie aparece ni va a un lugar adentro de uno.
 {const spot0=island.spot;island.spot=(...a)=>{for(let i=0;i<20;i++){const q=spot0(...a);if(!q||!island.bloqueo(q.x,q.z))return q;}return null;};}
 // Gente en la isla (playa, montaña, casas): para que afuera de la ciudad tampoco se delate nadie por estar solo.
 folk=createIslandFolk(world,island,{count:CIUDAD_LIMPIA?0:Math.min(40,8+4*team.value),seed:seed.value,templates:characters});world.group.add(folk.group);lap('gente isla');
 // (los animales: del monte, de granja, perros con la gente y los de mar; animals3d.js)
 animals=createAnimals(world,island,crowd,animalKit,{seed:seed.value});world.group.add(animals.group);lap('animales');
 // La gente de adentro de los edificios (policías en la comisaría): caminan y se sientan en las sillas libres.
 indoor=createIndoor(world,{civil:CIUDAD_LIMPIA?[]:characters,police:CIUDAD_LIMPIA?[]:policeTemplates,seed:seed.value});world.group.add(indoor.group);lap('adentro');
 // Y otros que salen a patrullar las veredas: nacen la mitad en la puerta de la comisaría y vuelven a ella de vez en cuando.
 patrol=createCitizens(world,{count:!CIUDAD_LIMPIA&&policeTemplates.length?4+team.value*2:0,seed:seed.value+101,templates:policeTemplates,home:world.station?.doors||null,homeBias:.25,startHome:.5,speed:[1.05,1.3],seats:world.benchSeats});world.group.add(patrol.group);lap('patrulla');
 scene.add(world.group);
 makeAvatar();lap('muñeco');muñecoDelPerfil();
 patrullas=createPatrullas({scene:world.group,plan,models:carModels,equipo:team.value,suelo:(x,z,y)=>groundHere(x,z,y??0),bloquea:bloqueaAuto,gente:()=>[...(soc?.personas()||[]),...patrol.positions(),...folk.positions(),...(persec?.P?.agentes.filter(a=>!a.humano&&a.estado==='libre')||[])]});lap('patrullas');
 if(cut){patchCut();for(const t of [...characters,...policeTemplates])cut.patchTree(t.scene);if(avatar)cut.patchTree(avatar.holder);lap('corte');}
 // (las paredes que se aclaran: los edificios y las casas, no la gente ni los autos)
 // (la casa del 3D y la del plano: el 3D sólo arma las que tienen plano de casa; la ronda cuenta en las del plano)
 const conPlano=(plan.isla?.casas||[]).map((c,i)=>c.spec?i:-1).filter(i=>i>=0);
 acciones=createAcciones({plan,world,player,avatar:()=>avatar,viviendas:()=>viviendas,ronda:()=>ronda,enRonda:usarRonda,casaPlan:i=>conPlano[i]});accionTexto.value='';
 ronda=null;rondaVista.value=null;setTimeout(()=>POLICIA?armarPolicia(conPlano):armarRonda(conPlano),400);// (después de mostrar el mundo: elegir las guaridas toma unos segundos)
 aclarado=createAclarado({max:VISIBILIDAD.maximo});aclarado.patchTree(world.group,[crowd,traffic,folk,animals,indoor,patrol].filter(Boolean).map(g=>g.group));aclPrev=null;
 // (compilar los shaders ya, en paralelo, en vez de a la primera vez que cada cosa aparece en cámara: eso eran los tirones
 // al girar o al entrar a un edificio)
 renderer.compileAsync?.(scene,camera).catch(()=>{}).then(()=>setTimeout(()=>shooting?.warm().catch(()=>{}),300));
 Object.assign(player,{x:world.spawn.x,z:world.spawn.z,feet:world.groundAt(world.spawn.x,world.spawn.z),vy:0});
 euler.set(view.value==='arriba'?TOP_PITCH:-.05,world.spawn.yaw,0);camera.quaternion.setFromEuler(euler);syncTop();cutA=0;lastBox=null;
 if(drone.value){Object.assign(dronePos,{x:world.spawn.x,y:30,z:world.spawn.z});euler.x=-.6;camera.quaternion.setFromEuler(euler);}
 world.setNight(night.value);traffic.setNight(night.value);island.setNight(night.value);barrios.setNight(night.value);viviendas.setNight(night.value);lightClock=0;
 // El minimapa: el mundo entero del plano (la isla, el monte con sus carreteras y casas, y la ciudad), el mismo de
 // /generador en la etapa de lotes. mapOff es la esquina de la isla, en casillas (queda negativa: la ciudad no es el origen).
 baseMap=document.createElement('canvas');const o=drawWorldStage(baseMap,plan,{cell:MAP_CELL,stage:3,fronts:false});mapOff={x:o.x0,y:o.y0};
 router.replace({query:{...route.query,jugadores:team.value,ciudad:seed.value}});
}
// El corte en todo lo que hay: edificios (con canto) y la gente, autos y animales (sin canto). Hay piezas que se arman
// después (instancias que aparecen al acercarse, la gente de adentro): se vuelve a pasar una vez por segundo; lo ya
// parcheado se saltea.
function patchCut(){if(!cut||!world)return;const people=[crowd,traffic,folk,animals,indoor,patrol].filter(Boolean).map(g=>g.group);
 cut.patchTree(world.group,[island.group,...people],{building:true});for(const g of people)cut.patchTree(g);}
// (la cámara de arriba toma el ángulo fijo más cercano a hacia donde mira)
function syncTop(){topTurn=null;}
// ---------- La ronda jugable (REGLAS.md, paso 1: el ladrón) ----------
// Sus guaridas con su caja dibujada (un baúl), lo que se roba en el mundo con su precio, y el panel de arriba.
function armarRonda(conPlano){if(!plan||!world)return;ronda=crearRonda(plan,{equipo:team.value,ronda:0});trancar(ronda,conPlano);
 // (la policía y los otros ladrones: bots del motor —persecucion3d.js, papel «ladrón»—; la sociedad usa su mapa de rutas)
 setTimeout(()=>{if(!ronda||persec)return;const w0=world;persec=createPersecucion({scene,plan,player,characters,policeTemplates,suelo:sueloBot,equipo:team.value,ronda:0,gente:()=>soc,papel:'ladron',
  adentro:()=>!!(world.dentro?.(player.x,player.z,player.feet+1)||viviendas?.dentro(player.x,player.z,player.feet+1)||barrios?.dentro(player.x,player.z,player.feet+1)),
  mochila:()=>ronda?.mochila||0,onEstado:estadoLadron,
  onAllanada:i=>{const g=ronda?.guaridas[i];if(!g)return;const v=incautar(ronda,g.id,rondaT());avisar(`La policía allanó ${g.texto}`+(v?`: incautó ${precio(v)}`:': no encontró nada'));verRonda();}});persec.iniciar();if(world!==w0)return;armarSociedad(persec.P.C.mapa);verRonda();},200);
 dibujarCajas(ronda,conPlano);ropaDeRepuesto();
 // (lo que el 3D dibuja: lo robado no se dibuja)
 world.setOcultos?.((it,lot)=>!!ronda&&robadoEn(ronda,it.name,lot,it.f,it.x,it.z));
 rondaT0=performance.now()/1000;verRonda();}
// Las puertas de las viviendas: la altura de cada una (el piso del apartamento o el de la casa) y las trancadas, que
// frenan al jugador a esa altura y cuyas hojas no se abren solas. Sólo abre el dueño (o el ladrón que fuerza la chapa).
function trancar(R,conPlano){cerraduras=R;
 for(const p of R.puertas){if(p.lote!=null)p.y=(world.lots.get(p.lote)?.raise||0)+(p.nivel||0)*3+.02;else{const h=viviendas?.houses?.[conPlano.indexOf(p.casa)];if(h)p.y=h.y+(h.plan.FLOOR0||0);}}
 const f=(x,z,y)=>!!cerraduras&&puertaTrancadaEn(cerraduras,x,z,y)||!!cierres&&puertaTrancadaEn(cierres,x,z,y);world.setTrancadas?.(f);viviendas?.setTrancadas?.(f);}
// las cajas de las guaridas (un baúl) a la altura de su piso; deja en cada guarida su y (caja.y)
function dibujarCajas(R,conPlano){const piezas=[];for(const g of R.guaridas){const L=g.lugar;let y=0;
  if(L.lot!=null)y=(world.lots.get(L.lot)?.raise||0)+L.nivel*3+.02;
  else{const h=viviendas?.houses?.[conPlano.indexOf(L.casa)];if(h)y=h.y+(L.nivel&&h.plan.H1?h.plan.H1:h.plan.FLOOR0||0);}
  g.caja.y=y;piezas.push(...placeParts(OBJETOS.baul.piezas({w:g.caja.largo,d:g.caja.fondo}),{x:g.caja.x,y,z:g.caja.z,ry:g.caja.ang}));}
 const cajas=partsMesh(piezas);cajas.name='ronda:cajas';world.group.add(cajas);}
const rondaT=()=>performance.now()/1000-rondaT0;let rondaT0=0;
// (de ladrón, lo guardado es el del equipo —el motor—; y el final de la ronda)
function verRonda(){if(!ronda)return;const P=persec?.P,bot=P?P.botin:ronda.botin,meta=P?P.meta:ronda.meta;if(P?.fin&&!finVista.value)verFin(P);
 rondaVista.value={mochila:precio(ronda.mochila),botin:precio(bot),meta:precio(meta),parte:Math.min(1,bot/meta),
 guaridas:ronda.guaridas.map(g=>g.texto),gano:gano(ronda),robos:ronda.avisos.length};}
function usarRonda(u){if(!ronda)return;const t=rondaT();
 if(u.accion==='visor'){avisar(hayGente(ronda,u.vivienda,t)?'Por el visor: hay gente adentro':'Por el visor: está vacía');return;}
 if(u.accion==='forzar'){empezarForzar(ronda,u.id,t);avisar('Forzando la chapa… quedate quieto');return;}
 if(u.accion==='robar'){const o=robar(ronda,u.id,t);if(o){avisar(`+${precio(o.valor)} · ${o.nombre} a la mochila`);world.refrescarInteriores?.();titular(`Roban ${o.nombre.toLowerCase()} en ${o.donde}`);grabar(o);persec?.robo(o.x,o.z,o.lugar?.casa!=null?'C'+o.lugar.casa:o.lugar?.lot!=null?'L'+o.lugar.lot:null,o.donde);}}
 else if(u.accion==='nada'){avisar(u.texto);return;}
 else if(u.accion==='sacar'){const v=sacar(ronda,u.id,t);persec?.sacarBotin(ronda.guaridas.findIndex(g=>g.id===u.id));avisar(v?`Sacaste ${precio(v)}: vuelve a la mochila`:'No hay nada guardado');}
 else{const v=guardar(ronda,t,u.id),g=ronda.guaridas.find(g=>g.id===u.id);persec?.guardarBotin(v,ronda.guaridas.indexOf(g),g?.delatada?.desde===t);
  avisar(!v?'La mochila está vacía':g?.delatada?.desde===t?`Guardaste ${precio(v)}, pero te vieron entrar: la policía puede allanarla en ${Math.round(g.delatada.allanable-t)} s`:`Guardaste ${precio(v)} en la guarida`);}
 verRonda();if(gano(ronda))avisar('¡Llegaron a la meta! Ganan los ladrones');}
// (cada cuadro: el forzado en curso; si el jugador se aleja, se corta)
function pasoRonda(){if(ronda&&persec)perseguido(ronda,rondaT(),persec.perseguido);// (la persecución del 3D marca la ronda: guardar perseguido delata)
 if(!ronda?.forzando)return;const r=tickForzar(ronda,player.x,player.z,rondaT());if(!r)return;
 if(r.cancelado)avisar('Dejaste de forzar la chapa');else if(r.abierta){avisar(r.gente?'Chapa abierta… pero hay gente: llamaron a la policía':'Chapa abierta');if(r.gente){titular('Los vecinos llaman a la policía: forzaron la chapa de un apartamento');persec?.llamada(player.x,player.z);}}else rondaMsg.value=`Forzando la chapa… ${Math.ceil(r.resta)} s`;}
// ---------- De ladrón contra la policía bot ----------
// preso (con botín: lo pierde; un compañero bot puede rescatarlo en la comisaría), detenido (sin nada: un rato), libre
const presoVista=ref(null);
function estadoLadron(e,yo){
 if(e==='preso'){if(ronda&&ronda.mochila>0){ronda.registro.push({t:rondaT(),que:`Perdiste ${precio(ronda.mochila)}: te atraparon`});ronda.mochila=0;ronda.enMochila=[];}
  presoVista.value={titulo:'Te atraparon con botín: estás preso',sub:'Perdiste lo que llevabas. Un compañero libre puede rescatarte en la puerta de la comisaría.'};titular('La policía atrapó a un ladrón con las manos llenas');}
 else if(e==='detenido')presoVista.value={titulo:'Detenido por sospecha',sub:'No llevabas nada encima: te sueltan en un rato.'};
 else if(e==='libre'){if(presoVista.value)avisar(presoVista.value.titulo.startsWith('Te atraparon')?'¡Te rescataron! Corré':'Te soltaron');presoVista.value=null;}
 // (preso o detenido: en la comisaría —donde lo dejó el motor—; libre otra vez: donde lo soltaron o lo rescataron)
 Object.assign(player,{x:yo.x,z:yo.z,feet:sueloBot(yo.x,yo.z),vy:0,ground:true,caidaDesde:null});verRonda();}
// el final de la ronda (los dos papeles): quién ganó, por qué y cómo quedó; «Otra ronda» u «Volver al inicio»
const finVista=ref(null);
function verFin(P){const L=P.agentes.filter(a=>a.equipo==='ladron'),gana=P.fin.gana,yoGano=(gana==='ladron')!==POLICIA;
 finVista.value={gana,yoGano,titulo:gana==='ladron'?'Los ladrones llegaron a la meta':P.fin.por==='presos'?'Todos los ladrones presos':'Se acabó el tiempo',
  sub:`${yoGano?'Ganaste':'Perdiste'} · presos ${L.filter(a=>a.estado==='preso').length} de ${L.length} · guardaron ${precio(P.botin)} de ${precio(P.meta)}`};
 keys.clear();controls?.unlock?.();}
function otraRonda(){location.reload();}
// ---------- El menú (Tab) ----------
const horaDe=(inicio,t)=>horaTexto(inicio+t*RELOJ.escala).split(' ')[1];
function titular(texto){const R=relojJuego();if(R)titulares.push({hora:horaDe(R.inicio,R.s),texto});if(titulares.length>30)titulares.shift();}
// el ladrón: la cámara de un edificio lo graba al robar ahí (con la ropa que tiene puesta); a RETRATO_DIFUNDE s, a las noticias
function grabar(o){if(o.lugar?.lot==null||!avatar?.tpl)return;const R=relojJuego();
 persec?.retrato();retratoLadron={rasgos:rasgosDe(avatar.look),ropa:describirRopa(avatar.tpl.outfit),ropaVista:JSON.parse(JSON.stringify(avatar.tpl.outfit||{})),visto:`${o.donde}, ${horaDe(R.inicio,R.s)} (cámara)`,difundido:false,t:R.s};
 titular(`Una cámara grabó al que robó en ${o.donde}`);}
function pasoNoticias(){if(retratoLadron&&!retratoLadron.difundido&&rondaT()-retratoLadron.t>=RETRATO_DIFUNDE){retratoLadron.difundido=true;
 titular(`SE BUSCA: ${retratoLadron.rasgos}; vestía ${retratoLadron.ropa}. Si lo ve, avise a la policía`);avisar('Tu retrato salió en las noticias: mirá el menú (Tab)');}}
// la ropa de repuesto que lleva en la mochila al empezar: una de arriba, una de encima, una de abajo y una para la cabeza
function ropaDeRepuesto(){const r=rng(seed.value*17+3),de=s=>GARMENTS.filter(g=>g.slot===s&&g.id!=='vestido'&&g.id!=='delantal'),pick=a=>a[Math.floor(r()*a.length)],color=()=>PALETTE[Math.floor(r()*PALETTE.length)];
 ropaMochila=['top','outer','bottom','hat'].map(s=>{const g=pick(de(s));return {slot:s,id:g.id,color:color(),label:g.label};});}
const conEtiquetas=o=>Object.fromEntries(Object.entries(o||{}).filter(([,p])=>p).map(([k,p])=>[k,{...p,label:etiqueta(p.id)}]));
function datosMenu(){const R=relojJuego();if(!R)return null;const resta=Math.max(0,MODO_BOTIN.duracion-R.s),reloj=`${Math.floor(resta/60)}:${String(Math.floor(resta%60)).padStart(2,'0')}`;
 if(!POLICIA&&ronda){const L=avatar?.look||{};
  return {nombre:nombreCuenta()||'Vos',alias:'',hora:horaVista.value,resta:reloj,
   mochila:ronda.enMochila.map(o=>({nombre:o.nombre,donde:o.donde,hora:horaDe(R.inicio,o.t),precio:precio(o.valor)})),mochilaTotal:precio(ronda.mochila),
   guardado:precio(ronda.botin),meta:precio(ronda.meta),guardadoN:ronda.botin,metaN:ronda.meta,
   guaridas:ronda.guaridas.map((g,i)=>({texto:g.texto,lejos:`a ${Math.round(Math.hypot(g.caja.x-player.x,g.caja.z-player.z))} m`,tuya:i===0})),
   cuerpo:{piel:L.piel||'media',pelo:L.pelo||'castaño',peinado:L.pzPelo||'',barba:L.pzBigote||''},
   ropa:{puesto:conEtiquetas(avatar?.tpl?.outfit),mochila:ropaMochila,tiempo:VESTIR_S},noticias:{retrato:retratoLadron,titulares:[...titulares].reverse()},
   mapa:persec?.mapa?.()||null,ropaPuesta:avatar?.tpl?.outfit||null,
   equipo:persec?.P?persec.banda().map(b=>({nombre:b.nombre,donde:b.donde,estado:b.estado,mochila:b.mochila?precio(b.mochila):''})):[{nombre:'Vos',donde:lugar.value?.titulo||'',estado:muerto.value?'preso':'libre',mochila:ronda.mochila?precio(ronda.mochila):''}]};}
 if(POLICIA&&persec?.P){const I=persec.info();
  if(!censoMenu&&soc)censoMenu=soc.S.personas.filter(p=>p.edad>=14).map(p=>({id:p.id,nombre:p.nombre,edad:p.edad,oficio:p.oficio,vive:direccionHogar(soc.S,p.hogar)}));
  const L=avatar?.look||{};
  return {mapa:persec.mapa?.()||null,cuerpo:{piel:L.piel||'media',pelo:L.pelo||'castaño',peinado:L.pzPelo||'',barba:L.pzBigote||''},ropaPuesta:avatar?.tpl?.outfit||null,nombre:nombreCuenta()?'Agente '+nombreCuenta():'Agente',alias:'Comisaría',hora:horaVista.value,resta:reloj,avisos:I.avisos,retratos:I.sospechosos,censo:censoMenu||[],hogares:soc?.S.hogares.size||0,
   equipo:I.companeros,patrullas:(patrullas?.posiciones()||[]).map((p,i)=>({id:`Patrulla ${i+1}`,donde:p.manejada?'la manejás vos':`a ${Math.round(Math.hypot(p.x-player.x,p.z-player.z))} m`,estado:p.manejada?'manejando':'estacionada'})),drones:I.drones};}
 return null;}
function abrirMenu(){menuDatos.value=datosMenu();if(!menuDatos.value)return;menuAbierto.value=true;keys.clear();controls?.unlock?.();menuReloj=.5;}
// (al cerrar, vuelve a capturar el ratón si lo pidió una tecla de verdad; si no —el navegador no lo deja—, «Clic para caminar»)
function cerrarMenu(){menuAbierto.value=false;if(navigator.userActivation?.isActive!==false)try{controls?.lock?.();}catch{}}
// lo que se hace en el menú
async function accionMenu(a){
 if(a.tipo==='vestir'||a.tipo==='quitar'||a.tipo==='color'){if(!avatar?.tpl||performance.now()<vistiendo)return;const outfit=JSON.parse(JSON.stringify(avatar.tpl.outfit||{})),viejo=a.tipo==='color'?null:outfit[a.slot];
  if(a.tipo==='color'){if(!outfit[a.slot]||outfit[a.slot].color===a.color)return;outfit[a.slot]={...outfit[a.slot],color:a.color};}
  else if(a.tipo==='vestir'){outfit[a.slot]={id:a.prenda.id,color:a.prenda.color};const i=ropaMochila.findIndex(p=>p.id===a.prenda.id&&p.color===a.prenda.color&&p.slot===a.slot);if(i>=0)ropaMochila.splice(i,1);}else outfit[a.slot]=null;
  if(viejo)ropaMochila.push({slot:a.slot,id:viejo.id,color:viejo.color,label:etiqueta(viejo.id)});
  // (el vestido va solo: ponérselo guarda lo de abajo; sacárselo sin nada abajo pone lo de abajo que lleva en la mochila,
  // o un pantalón)
  if(a.tipo==='vestir'&&a.prenda.id==='vestido'&&outfit.bottom){ropaMochila.push({slot:'bottom',id:outfit.bottom.id,color:outfit.bottom.color,label:etiqueta(outfit.bottom.id)});outfit.bottom=null;}
  if(outfit.top?.id!=='vestido'&&!outfit.bottom){const i=ropaMochila.findIndex(p=>p.slot==='bottom');const b=i>=0?ropaMochila.splice(i,1)[0]:{id:'pantalon',color:'#2f3133'};outfit.bottom={id:b.id,color:b.color};}
  vistiendo=performance.now()+VESTIR_S*1000;keys.clear();avisar(`Cambiándote de ropa… ${VESTIR_S} s`);
  const t=await vestirPlantilla(avatar.tpl,outfit);makeAvatar(t);if(cut)cut.patchTree(avatar.holder);menuDatos.value=datosMenu();return;}
 if(a.tipo==='difundir'&&persec){if(persec.difundir(a.retrato.id))avisar('Retrato difundido: si un vecino lo ve, avisa');menuDatos.value=datosMenu();return;}
 if(a.tipo==='marcar'){marcaPlano={x:a.aviso.x,z:a.aviso.z,hasta:performance.now()+20000};showMap.value=true;avisar(`Marcado en el plano: ${a.aviso.donde}`);}}
// ---------- De policía (REGLAS.md, paso 3) ----------
// El motor del modo «Botín» con sus ladrones bots; el jugador, uniformado, sale de la comisaría.
const sueloBot=(x,z,h)=>{const g=groundHere(x,z,0);return groundHere(x,z,Math.max(g,h??g)+1);};
function armarPolicia(conPlano){if(!plan||!world)return;
 // (de policía, las viviendas están todas trancadas: entra sólo a las zonas comunes)
 // (las guaridas de la ronda: las mismas del motor, en el mismo orden —guaridasDe—; su puerta se abre si el ladrón se
 // mete persiguiéndolo, y adentro está la caja)
 const R=crearRonda(plan,{equipo:team.value,ronda:0});R.abiertas=new Set();trancar(R,conPlano);dibujarCajas(R,conPlano);
 persec=createPersecucion({scene,plan,player,characters,policeTemplates,suelo:sueloBot,equipo:team.value,ronda:0,gente:()=>soc,
  guaridas3d:R.guaridas.map(g=>({vivienda:g.vivienda,texto:g.texto,x:g.caja.x,z:g.caja.z,y:g.caja.y})),abrir:v=>{R.abiertas.add(v);world.refrescarInteriores?.();}});persec.iniciar();
 const [x,z]=persec.P.C.comisaria.puntos[0];Object.assign(player,{x,z,feet:sueloBot(x,z),vy:0,ground:true,caidaDesde:null});verPolicia();
 avisar('Sos policía: cada robo aparece en el plano; andá a ver la cámara y atrapalo');armarSociedad(persec.P.C.mapa);}
// ---------- La sociedad en el 3D (etapa 2) ----------
// el reloj de la ciudad: cuándo empezó la ronda (s del juego desde el lunes) y los s reales que van
// (de policía, el reloj del motor, pero continuo —P.t más lo que va del paso—: con P.t solo, que salta de a M.tick, la
// gente de la calle, que se ubica por la hora, se movía a saltos de 4 por segundo —2026-10-18, Miguel: «se teletransportan»—)
function relojJuego(){if(POLICIA&&persec?.P)return {inicio:persec.P.inicio,s:persec.tiempo};if(ronda)return {inicio:ronda.inicio,s:rondaT()};return null;}
function armarSociedad(mapa){if(!plan||!world||soc)return;mapa??=mapaDeJuego(plan);
 soc=createSociedad3d({scene,plan,mapa,characters,suelo:sueloBot,reloj:()=>relojJuego()||{inicio:0,s:0},alturaPiso:(lote,nivel)=>(world.lots.get(lote)?.raise||0)+nivel*3+.02});
 // (los locales: sus puertas de calle, a la altura de la planta baja de su lote; trancadas mientras el lugar está cerrado)
 const P=puertasDeLugares(plan,soc.S);for(const p of P)p.y=(world.lots.get(p.lote)?.raise||0)+.02;cierres={puertas:[],todas:P,abiertas:new Set()};pasoCierres(true);}
// (cada segundo: qué locales están cerrados a esta hora —salvo el lote donde está el jugador, que siempre puede salir—)
function pasoCierres(ya,dt=0){if(!cierres||!soc)return;if(!ya&&(cierresReloj-=dt)>0)return;cierresReloj=1;const R=relojJuego();if(!R)return;const t=R.inicio+R.s*RELOJ.escala;
 const aqui=plan.lots.findIndex(L=>L.rect&&player.x>L.rect.x&&player.x<L.rect.x+L.rect.w&&player.z>L.rect.y&&player.z<L.rect.y+L.rect.h);
 cierres.puertas=cierres.todas.filter(p=>p.lote!==aqui&&!abierto(soc.S,p.lugar,t));
 horaVista.value=horaTexto(t);
 // (la noche: de 19 a 6; sólo cuando cambia, así N la sigue cambiando a mano)
 const h=(t%RELOJ.dia)/3600,n=h<6||h>=19;if(n!==nocheAuto){nocheAuto=n;if(night.value!==n){night.value=n;applyLight();}}}
// (dónde choca una patrulla: lo mismo que el jugador, con el ancho del auto, y los autos del tránsito)
const enAuto=(v,x,z,m)=>{const fx=Math.sin(v.yaw),fz=Math.cos(v.yaw),dx=x-v.x,dz=z-v.z;return Math.abs(dx*fx+dz*fz)<v.len/2+m&&Math.abs(dx*fz-dz*fx)<v.wid/2+m;};
const bloqueaAuto=(x,z,y)=>{const R=PATRULLA.radio;return world.collide(x,z,R,true,y)||!!world.dentro?.(x,z,y+1)||!island.walkable(x,z,y)||barrios.collide(x,z,R,true,y)||viviendas.collide(x,z,R,true,y)||casas.collide(x,z,R)||trancadoEn(x,z,R,y)||traffic.positions().some(v=>enAuto(v,x,z,.2))||!!patrullas?.cars.some(c=>c!==patrullas.manejando&&enAuto(c,x,z,.2));};
function subirPatrulla(i){const c=patrullas?.subir(i);if(!c)return;keys.clear();if(avatar)avatar.holder.visible=false;avisar('Al volante: W/S acelerar y frenar, A/D girar, E bajarse');}
function bajarPatrulla(){const b=patrullas?.bajar();if(!b)return;Object.assign(player,{x:b.x,z:b.z,feet:b.y,vy:0,ground:true,caidaDesde:null});velocidad.value=null;
 euler.setFromQuaternion(camera.quaternion,'YXZ');euler.x=-.1;euler.z=0;camera.quaternion.setFromEuler(euler);if(avatar)avatar.holder.visible=(third.value||fps.on)&&!drone.value;avisar('Estacionada');}
// manejar: el auto con W/S y A/D; el jugador va adentro (su lugar es el del auto, para el motor y el tránsito); la cámara,
// detrás y arriba, mirando adelante
function manejarStep(dt){const c=patrullas.manejando,k=x=>keys.has(x);
 patrullas.manejar(dt,(k('KeyW')||k('ArrowUp')?1:0)-(k('KeyS')||k('ArrowDown')?1:0),(k('KeyD')||k('ArrowRight')?1:0)-(k('KeyA')||k('ArrowLeft')?1:0));
 Object.assign(player,{x:c.x,z:c.z,feet:c.y,vy:0,ground:true});if(avatar)avatar.holder.visible=false;
 const fx=Math.sin(c.yaw),fz=Math.cos(c.yaw),want=new THREE.Vector3(c.x-fx*8.5,c.y+3.6,c.z-fz*8.5);camera.position.lerp(want,Math.min(1,dt*4));camera.lookAt(c.x+fx*3,c.y+1.2,c.z+fz*3);
 velocidad.value=Math.round(Math.abs(c.v)*3.6);accionTexto.value='Bajarse';accionAlterna.value='';followCamera();}
const trancadoEn=(x,z,r,F)=>!!cerraduras&&trancada(cerraduras,x,z,r,F)||!!cierres&&trancada(cierres,x,z,r,F);
// (para probar: llevar la ronda a un día y una hora —0 = lunes—)
function fijarHora(dia,h){const R=relojJuego();if(!R)return false;const ini=(dia*24+h)*3600-R.s*RELOJ.escala;if(persec?.P)persec.P.inicio=POLICIA?ini:ini+(rondaT()-persec.P.t)*RELOJ.escala;if(ronda){ronda.inicio=ini;ronda.ocup=ocupacionSociedad(soc?.S||sociedadDe(plan),ini,MODO_BOTIN.duracion);}pasoCierres(true);return horaVista.value;}
function verPolicia(){const e=persec?.estado();if(!e)return;for(const m of e.mensajes)avisar(m.texto);if(persec.P.fin&&!finVista.value)verFin(persec.P);
 if(e.avisos.length>avisosVistos){const a=e.avisos[e.avisos.length-1];avisar(`Aviso: ${a.tipo.toLowerCase()} · mirá el plano`);avisosVistos=e.avisos.length;}
 const mm=Math.floor(e.resta/60),ss=String(Math.floor(e.resta%60)).padStart(2,'0');
 policiaVista.value={reloj:`${mm}:${ss}`,botin:precio(e.botin),meta:precio(e.meta),parte:Math.min(1,e.botin/e.meta),presos:e.presos,ladrones:e.ladrones,avisos:e.avisos,retratos:e.retratos,
  fin:e.fin&&{gana:e.fin.gana,texto:e.fin.gana==='policia'?(e.fin.por==='presos'?'Todos los ladrones presos: gana la policía':'Se acabó el tiempo: gana la policía'):'Los ladrones llegaron a la meta: ganan ellos'}};}
function usarPolicia(u){const t=persec?.usar(u);if(t)avisar(t);verPolicia();}
// el golpe de una caída: baja la vida; en 0, muere (el ladrón queda fuera de la ronda y pierde lo que lleva)
function golpe(d,h){if(d<=0||muerto.value)return;vidaVista.value=Math.max(0,vidaVista.value-d);ultimoGolpe=performance.now()/1000;
 if(vidaVista.value<=0){muerto.value=true;keys.clear();if(ronda&&ronda.mochila>0){ronda.registro.push({t:rondaT(),que:`Perdiste ${precio(ronda.mochila)} en la caída`});ronda.mochila=0;ronda.enMochila=[];verRonda();}}
 else avisar(`Caída de ${h.toFixed(1)} m · −${Math.round(d)} de vida`);}
// (la vida vuelve de a poco, VIDA.espera s después del último golpe)
function pasoVida(dt){if(muerto.value||vidaVista.value>=VIDA.max)return;if(performance.now()/1000-ultimoGolpe>VIDA.espera)vidaVista.value=Math.min(VIDA.max,vidaVista.value+VIDA.recupera*dt);}
// (para probar: volver a la guarida con la vida llena; en una partida de verdad, el muerto queda fuera de la ronda)
function revivir(){if(!muerto.value)return;const g=ronda?.guaridas?.[0];muerto.value=false;vidaVista.value=VIDA.max;
 if(g){const L=g.lugar;Object.assign(player,{x:g.caja.x+Math.sin(g.caja.ang)*1.2,z:g.caja.z+Math.cos(g.caja.ang)*1.2,vy:0,ground:true,caidaDesde:null,feet:L.lot!=null?(world.lots.get(L.lot)?.raise||0)+L.nivel*3+.02:player.feet});}}
function avisar(t){rondaMsg.value=t;clearTimeout(rondaMsgT);rondaMsgT=setTimeout(()=>{rondaMsg.value='';},3200);}
// (tFijo: con esa plantilla —al cambiarse de ropa, la misma persona con otra ropa—; si no, una al azar)
function makeAvatar(tFijo=null){
 if(avatar){scene.remove(avatar.holder);avatar.mixer.stopAllAction();avatar=null;}
 const lista=POLICIA&&policeTemplates.length?policeTemplates:characters;if(!lista.length&&!tFijo)return;const t=tFijo||lista[Math.floor(Math.random()*lista.length)];avatar=makeCharacter(t,Math.random);avatar.lods=[];avatar.look=t.look;avatar.tpl=t;
 avatar.holder.visible=(third.value||fps.on)&&!drone.value;scene.add(avatar.holder);
 // La silueta: el mismo muñeco otra vez, de un color plano, dibujado sólo donde algo lo tapa (prueba de profundidad al
 // revés) y después de todo lo opaco. Así nunca se pierde detrás de una pared.
 // Pero la prueba al revés también da «tapado» contra el propio muñeco (la piel bajo la ropa, el casco bajo el pelo, las
 // caras de atrás) y la silueta salía a manchas encima de él. Por eso el muñeco se dibuja después de lo opaco y marca
 // en el stencil (1) los píxeles donde se ve; la silueta no se pinta ahí. Sus materiales son copias: los de la
 // plantilla los comparte la gente de la calle.
 avatar.holder.traverse(o=>{if(!o.isMesh||o.userData.silueta)return;o.renderOrder=998;avatar.fadeMats||(avatar.fadeMats=[]);
  o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();
  for(const m of [o.material].flat()){Object.assign(m,{stencilWrite:true,stencilRef:1,stencilFunc:THREE.AlwaysStencilFunc,stencilZPass:THREE.ReplaceStencilOp});avatar.fadeMats.push(m);}});
 avatar.holder.traverse(o=>{if(!o.isSkinnedMesh||o.userData.silueta)return;const m=new THREE.MeshBasicMaterial({color:'#f2c14e',transparent:true,opacity:.55,depthFunc:THREE.GreaterDepth,depthWrite:false,fog:false,stencilWrite:true,stencilRef:1,stencilFunc:THREE.NotEqualStencilFunc,stencilZPass:THREE.KeepStencilOp});
  (avatar.silMats||(avatar.silMats=[])).push(m);const sil=new THREE.SkinnedMesh(o.geometry,m);sil.bind(o.skeleton,o.bindMatrix);sil.userData.silueta=true;sil.renderOrder=999;sil.frustumCulled=false;sil.castShadow=false;sil.position.copy(o.position);sil.quaternion.copy(o.quaternion);sil.scale.copy(o.scale);o.parent.add(sil);
  sil.onBeforeRender=()=>{if(sil.geometry!==o.geometry)sil.geometry=o.geometry;};});
 if(view.value==='primera'){fps.on=true;fps.enter();}}
// (cambiar de papel recarga la página: el papel se elige al entrar)
function cambiarPapel(){const q=new URLSearchParams(location.search);if(POLICIA)q.delete('papel');else q.set('papel','policia');location.search=q.toString();}
function otherCity(){seed.value=pickCity(team.value);load();}
function setTeam(t){team.value=t;seed.value=pickCity(t);load();}

// El piso: el de la ciudad adentro (con sus veredas); afuera, el terreno de la isla.
// Dentro de la ciudad el piso depende de a qué altura se viene (planta baja, escalera o un piso de arriba).
const groundHere=(x,z,feet=0)=>{const sz=world.size;if(x>=0&&z>=0&&x<=sz.w&&z<=sz.h)return world.floorAt(x,z,feet);const b=barrios?.floorAt(x,z,feet)??viviendas?.floorAt(x,z,feet);return b??island.ground(x,z,feet);};
// ---------- Primera persona, como un shooter (2026-10-14) ----------
// Lo que hacen los FPS (Call of Duty y compañía): un FOV propio (75°) que se abre unos grados al correr, suave; el
// balanceo al caminar en ocho —arriba-abajo al paso y de lado a medio paso—, chico para no marear; la cámara se inclina
// apenas al moverse de costado; al caer de un salto, un golpe que se recupera con resorte. Y el cuerpo propio visible
// («full body awareness»): el muñeco va debajo de la cámara mirando hacia donde se mira, sin la cabeza (el hueso Head a
// escala 0 se lleva pelo y sombrero), así al mirar abajo se ven el pecho, las piernas y los pies caminando.
const FPS_FOV=75,FPS_RUN_FOV=83,FPS_AIM_FOV=60,FPS_NEAR=.05;
// Sin armas (2026-10-17, REGLAS.md: «simple como un juego de patio»): el arma en la mano (viewmodel3d) y el disparo
// (disparo3d) quedan apagados; en primera persona se ven los brazos del muñeco. ARMAS=true los vuelve a prender.
const ARMAS=false;
let vm=null,vmPass=null,shooting=null,hitTimer=0;
const fps={on:false,fov:FPS_FOV,roll:0,dip:0,dipV:0,amp:0,head:null,arms:[],sil:[],
 enter(){if(!avatar)return;avatar.holder.visible=true;this.head=null;this.sil=[];this.arms=[];avatar.holder.traverse(o=>{if(o.isBone&&/^Head$/.test(o.name))this.head=o;if(ARMAS&&o.isBone&&/^Shoulder[LR]$/.test(o.name))this.arms.push(o);if(o.userData.silueta){o.visible=false;this.sil.push(o);}});camera.near=FPS_NEAR;camera.updateProjectionMatrix();
  // (los brazos del arma con la piel y la manga del muñeco; los del cuerpo se esconden: los reemplazan)
  const L=avatar.look||{};vm?.setColors(COLORS.piel[L.piel],COLORS.ropa[L.ropa]);if(vmPass)vmPass.enabled=true;},
 leave(){if(this.head)this.head.scale.setScalar(1);for(const b of this.arms)b.scale.setScalar(1);this.arms=[];if(vmPass)vmPass.enabled=false;aiming.value=false;for(const o of this.sil)o.visible=true;this.sil=[];camera.near=.15;camera.fov=72;this.fov=FPS_FOV;camera.rotation.z=0;camera.updateProjectionMatrix();},
 step(dt,moving,landed){
  const run=moving&&player.run,e=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ');
  // (la amplitud del balanceo entra y sale con el movimiento, para que no salte al arrancar o frenar)
  this.amp+=((moving&&player.ground?(run?1.4:1):0)-this.amp)*Math.min(1,dt*8);
  const by=Math.abs(Math.sin(player.bob))*.05*this.amp,bx=Math.sin(player.bob*.5)*.035*this.amp*(run?1.2:1);
  // (el golpe al caer: un resorte amortiguado)
  if(landed)this.dipV-=landed*2.2;this.dipV+=(-this.dip*90-this.dipV*14)*dt;this.dip+=this.dipV*dt;
  // (inclinación de costado: A/D, como mucho 1,5°)
  const side=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);
  this.roll+=(-side*.026-this.roll)*Math.min(1,dt*6);
  // (apuntando, el mundo se acerca: 60°)
  const goal=(run?FPS_RUN_FOV:FPS_FOV)*(1-(vm?.aiming||0))+FPS_AIM_FOV*(vm?.aiming||0);this.fov+=(goal-this.fov)*Math.min(1,dt*10);if(Math.abs(camera.fov-this.fov)>.01){camera.fov=this.fov;camera.updateProjectionMatrix();}
  const fx=-Math.sin(e.y),fz=-Math.cos(e.y),rx=Math.cos(e.y),rz=-Math.sin(e.y);
  camera.position.set(player.x+rx*bx,player.feet+EYE-by+this.dip,player.z+rz*bx);
  camera.rotation.set(e.x,e.y,this.roll,'YXZ');
  // El cuerpo: debajo de la cámara, un poco atrás (la cámara queda a la altura de los ojos, delante del cuello) y mirando
  // hacia donde se mira.
  // (al mirar abajo el cuerpo se corre más atrás: si no, se ve el cuello desde arriba en vez del pecho y los pies)
  if(avatar){const h=avatar.holder,back=.14+.3*Math.max(0,-e.x-.3);h.visible=true;h.position.set(player.x-fx*back,player.feet,player.z-fz*back);h.rotation.y=e.y+Math.PI;
   moveCharacter(avatar,moving?(run?'run':'walk'):'idle',moving?(run?RUN:WALK)/3.5:0,dt);if(this.head)this.head.scale.setScalar(1e-4);for(const b of this.arms)b.scale.setScalar(1e-4);}
  if(vm){vm.light(camera,sun,hemi);vm.update(dt,{cam:camera,bob:player.bob,amp:this.amp,running:run,aiming:aiming.value,dip:this.dip});}},
 // El tiro: el arma retrocede (viewmodel3d.js) y la cámara sube un poco, como en los shooters.
 fire(){if(!vm?.fire())return;
  // (la dispersión, como en los shooters: casi nada apuntando; desde la cadera más, y más caminando)
  const moving=['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].some(k=>keys.has(k)),spread=aiming.value?.0015:.012+(moving?.014:0);
  crowd?.scare?.(player.x,player.z,22);
  shooting?.fire(spread).then(hit=>{if(!hit?.person)return;hitMark.value++;clearTimeout(hitTimer);hitTimer=setTimeout(()=>{hitMark.value=0;},140);crowd?.scare?.(hit.point.x,hit.point.z,4);});const e=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ');e.x=Math.min(1.4,e.x+.012+Math.random()*.006);e.y+=(Math.random()-.5)*.006;camera.quaternion.setFromEuler(e);}};
// Asomado a una ventana (acciones3d mirada, 2026-10-17, Miguel: «asomarme a una ventana y poder ver a los lados»): la
// cámara va de donde estaba al ojo junto al vidrio, girando hacia afuera; ya asomado, se mira a los lados hasta
// VENTANA.giro y arriba o abajo hasta VENTANA.arriba / VENTANA.abajo, como sacando la cabeza. El muñeco no se ve (la
// cámara queda delante de su cara).
const VENTANA={giro:1.2,arriba:.6,abajo:.8};let asomo=null;
function ventana(dt,m){const e=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ'),fuera=m.yaw+Math.PI,k=m.k;
 if(!asomo)asomo={x:camera.position.x,y:camera.position.y,z:camera.position.z};
 camera.position.set(asomo.x+(m.x-asomo.x)*k,asomo.y+(m.y-asomo.y)*k,asomo.z+(m.z-asomo.z)*k);
 let dy=e.y-fuera;dy=Math.atan2(Math.sin(dy),Math.cos(dy));
 // (mientras se asoma, la mirada va hacia afuera; ya asomado, el mouse la mueve dentro de los límites)
 if(acciones.fase==='bajar')dy*=1-Math.min(1,dt*8);dy=Math.max(-VENTANA.giro,Math.min(VENTANA.giro,dy));
 camera.rotation.set(Math.max(-VENTANA.abajo,Math.min(VENTANA.arriba,e.x)),fuera+dy,0,'YXZ');
 if(avatar)avatar.holder.visible=k<.5;}
function dejarVentana(){asomo=null;if(avatar)avatar.holder.visible=(third.value||fps.on)&&!drone.value;}
function step(dt){
 pasoRonda();pasoVida(dt);
 pasoCierres(false,dt);if(soc){soc.update(dt,player.x,player.z);}
 if(persec?.listo){persec.update(dt);if((persecReloj-=dt)<=0){persecReloj=.25;if(POLICIA)verPolicia();else verRonda();}}
 if(finVista.value)return;
 if(muerto.value)return;
 if(patrullas?.manejando){manejarStep(dt);return;}
 if(drone.value)return droneStep(dt);
 // Las acciones (acciones3d.js): mientras dura una, el jugador no camina —caminar o E la terminan—; si no, cada 0,15 s,
 // el uso más cercano y su tecla.
 const quiere=['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].some(k=>keys.has(k));
 if(acciones?.activa){acciones.update(dt,quiere);accionAlterna.value='';const m=acciones.mirada();accionTexto.value=acciones.fase==='quieto'?(acciones.accion==='asomarse'?'Volver':'Levantarse'):'';
  if(m){ventana(dt,m);return;}if(asomo)dejarVentana();if(third.value)thirdPerson(dt,false);else fps.step(dt,false,0);return;}
 if(asomo)dejarVentana();
 if(acciones&&(accionReloj-=dt)<=0){accionReloj=.15;quienVista.value=persec?.quien(player.x,player.z)||(q=>q&&cartelDe({aspecto:q.aspecto,identidad:q.identidad,documentado:!!persec?.documentado?.(q.id)}))(soc?.quien(player.x,player.z))||null;const pc0=persec?.cerca(),pt=POLICIA?patrullas?.cerca(player.x,player.z):null,pc=pc0&&(pt==null||pc0.accion==='atrapar'||pc0.accion==='papeles')?pc0:null;// (la patrulla gana, salvo atrapar o pedirle papeles a un ladrón)
  accionCerca=pc?{persec:pc,texto:pc.texto}:pt!=null?{patrulla:pt,texto:'Subir a la patrulla'}:pc0?{persec:pc0,texto:pc0.texto}:acciones.cerca();accionTexto.value=accionCerca?.texto||'';accionAlterna.value=(accionCerca?.cortina||accionCerca?.alterna)?.texto||'';}
 // (pidiendo papeles, el policía se queda quieto los MODO_BOTIN.gente.papeles s)
 if(menuAbierto.value&&(menuReloj-=dt)<=0){menuReloj=.5;menuDatos.value=datosMenu();}
 pasoNoticias();
 // (cambiándose de ropa: quieto VESTIR_S s)
 if(performance.now()<vistiendo){accionTexto.value='Cambiándote de ropa…';if(third.value)thirdPerson(dt,false);else fps.step(dt,false,0);return;}
 if(persec?.quieto()){accionTexto.value=POLICIA?'Pidiendo papeles…':persec.quietoPorPapeles()?'La policía te pide los papeles…':'';if(third.value)thirdPerson(dt,false);else fps.step(dt,false,0);return;}
 const f=new THREE.Vector3();camera.getWorldDirection(f);f.y=0;f.normalize();const r=new THREE.Vector3(-f.z,0,f.x);
 const fw=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0);
 const st=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);
 // (hacia dónde mira el cuerpo en tercera persona, ORIENTAR='camara': hacia la cámara, como en Fortnite; de costado o en
 // diagonal gira como mucho 45° hacia donde va, y para atrás camina de espaldas sin darse vuelta)
 {const cam=Math.atan2(f.x,f.z),rel=Math.atan2(st,fw);player.face=fw<0?cam:cam-Math.max(-Math.PI/4,Math.min(Math.PI/4,rel));}
 const move=f.multiplyScalar(fw).add(r.multiplyScalar(st)),moving=move.lengthSq()>0;
 if(moving){
  const speed=keys.has('ShiftLeft')||keys.has('ShiftRight')?RUN:WALK;move.normalize().multiplyScalar(speed*dt);
  // De a un eje por vez: así se resbala por las paredes en vez de quedar pegado.
  // Si ya está metido en algo (una persona, un contenedor, un vehículo), puede moverse libremente hasta salir: sólo
  // las paredes lo frenan. Si no, nada se atraviesa.
  // Afuera de la ciudad se camina por la isla: playa, agua baja, praderas y montañas (no el agua honda ni el vacío).
  const up=player.feet>1,F=player.feet;
  // (2026-10-16: lo que queda más alto que ALCANCE —el salto más un escalón, la misma regla que los muebles del 2D— no se
  // sube caminando: el muro de una terraza del monte frena; antes se subía cualquier altura de a poco)
  const alto=(x,z)=>groundHere(x,z,F)>F+ALCANCE;
  const blocked=(x,z)=>alto(x,z)||trancadoEn(x,z,RADIUS,F)||!!patrullas?.cars.some(c=>enAuto(c,x,z,RADIUS))||!island.walkable(x,z,F)||world.collide(x,z,RADIUS,true,F)||!!planoVista?.collide(x,z,RADIUS,F)||barrios.collide(x,z,RADIUS,true,F)||viviendas.collide(x,z,RADIUS,true,F)||casas.collide(x,z,RADIUS)||indoor.blocks(x,z,RADIUS,F)||!up&&patrol.blocks(x,z,RADIUS)||!up&&(crowd.blocks(x,z,RADIUS)||folk.blocks(x,z,RADIUS)||traffic.blocks(x,z,RADIUS));
  const hit=blocked(player.x,player.z)?(x,z)=>alto(x,z)||trancadoEn(x,z,RADIUS,F)||!island.walkable(x,z,F)||world.collide(x,z,RADIUS,false,F)||barrios.collide(x,z,RADIUS,false,F)||viviendas.collide(x,z,RADIUS,false,F)||casas.collide(x,z,RADIUS):blocked;
  player.dir=Math.atan2(move.x,move.z);player.run=speed>WALK;
  if(!hit(player.x+move.x,player.z))player.x+=move.x;
  if(!hit(player.x,player.z+move.z))player.z+=move.z;
  if(player.ground)player.bob+=dt*(speed>WALK?11:8);
 }
 // Un vehículo que lo alcanza lo empuja hacia afuera (sin meterlo en una pared).
 const out=player.feet>1?player:traffic.pushOut(player.x,player.z,RADIUS);if((out.x!==player.x||out.z!==player.z)&&!world.collide(out.x,out.z,RADIUS,false)){player.x=out.x;player.z=out.z;}
 const g=groundHere(player.x,player.z,player.feet);
 // (en el aire: al saltar o al salir de un borde —antes seguía «en el suelo» mientras caía—; desde dónde cae, para el golpe)
 if(player.ground&&player.feet>g+.12)player.ground=false;
 if(keys.has('Space')&&player.ground){player.vy=JUMP;player.ground=false;}
 if(!player.ground)player.caidaDesde=Math.max(player.caidaDesde??player.feet,player.feet);
 player.vy=Math.max(player.vy-GRAVITY*dt,-ATERRIZAJE.caida);player.feet+=player.vy*dt;// (con tope: la caída del dron se ve)
 let landed=0;if(player.feet<=g&&!player.ground){landed=Math.min(1,-player.vy/9);
  // el golpe: lo que cayó desde lo más alto del salto (no al bajar del dron ni al salir del ascensor)
  const h=(player.caidaDesde??g)-g;if(!player.sinDano&&!lifting)golpe(danoDeCaida(h),h);player.caidaDesde=null;player.sinDano=false;}
 if(player.feet<=g){player.feet=player.ground&&g>player.feet?player.feet+(g-player.feet)*Math.min(1,dt*18):g;player.feet=Math.max(player.feet,g-.0001);player.vy=0;player.ground=true;}
 if(third.value)thirdPerson(dt,moving);else{fadeTo=1;fadeAvatar(1);fps.step(dt,moving,landed);cut?.set(false);cut?.look(false);aclarado?.set([]);aclPrev=null;}
 actualizarVisibles();
 followCamera();
}
// El muñeco donde está el jugador, girando de a poco hacia donde camina, y la cámara detrás.
// El edificio donde está el muñeco, en planta: desde sus pies se recorre (de a medio metro, hasta 70 m) todo lo techado
// conectado a esa altura; su rectángulo, con medio metro de más para las paredes, es lo único que se corta. Se rehace
// sólo al cambiar de piso o al salir del rectángulo.
let cutBox=null;
function buildingBox(){
 // (en la ciudad, el lote exacto: sus casillas en planta)
 for(const [,L] of world.lots||[])if(L.cells?.some(c=>player.x>=c[0]&&player.x<=c[2]&&player.z>=c[1]&&player.z<=c[3])){
  const b=[Infinity,Infinity,-Infinity,-Infinity];for(const c of L.cells){b[0]=Math.min(b[0],c[0]);b[1]=Math.min(b[1],c[1]);b[2]=Math.max(b[2],c[2]);b[3]=Math.max(b[3],c[3]);}
  // (los lados pegados a otro lote: alguna casilla ajena toca ese borde)
  const touch=(c,i)=>i===0?Math.abs(c[2]-b[0])<.01&&c[3]>b[1]&&c[1]<b[3]:i===1?Math.abs(c[3]-b[1])<.01&&c[2]>b[0]&&c[0]<b[2]:i===2?Math.abs(c[0]-b[2])<.01&&c[3]>b[1]&&c[1]<b[3]:Math.abs(c[1]-b[3])<.01&&c[2]>b[0]&&c[0]<b[2];
  const shared=[0,1,2,3].map(i=>[...world.lots].some(([,o])=>o!==L&&o.cells?.some(c=>touch(c,i))));
  // (del lado de un vecino, el borde va justo en el límite del lote: la pared del vecino queda fuera y no se corta)
  const m=shared.map(v=>v?-.05:.4);
  return {box:[b[0]-m[0],b[1]-m[1],b[2]+m[2],b[3]+m[3]],shared,feet:Math.round(player.feet*2)/2};}
 const y=player.feet+1,S=.5,M=140,seen=new Set(),q=[[0,0]],roof=(x,z)=>!!(world.dentro?.(x,z,y)||barrios.dentro(x,z,y)||viviendas.dentro(x,z,y));
 let x0=0,z0=0,x1=0,z1=0;seen.add('0,0');
 for(let h=0;h<q.length&&q.length<12000;h++){const [i,j]=q[h];for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){const a=i+di,b=j+dj,k=a+','+b;if(seen.has(k)||Math.abs(a)>M||Math.abs(b)>M)continue;seen.add(k);
  // (no se cruzan paredes: a medio metro, el techado de dos edificios pegados se toca a través de la medianera)
  const px=player.x+(i+di*.5)*S,pz=player.z+(j+dj*.5)*S,F=player.feet;if(!roof(player.x+a*S,player.z+b*S)||world.collide(px,pz,.26,false,F)||barrios.collide(px,pz,.26,false,F)||viviendas.collide(px,pz,.26,false,F))continue;q.push([a,b]);x0=Math.min(x0,a);x1=Math.max(x1,a);z0=Math.min(z0,b);z1=Math.max(z1,b);}}
 // (fuera de la ciudad las casas tienen alero: el techo sale hasta dos metros de las paredes)
 return {box:[player.x+x0*S-2.2,player.z+z0*S-2.2,player.x+x1*S+2.2,player.z+z1*S+2.2],feet:Math.round(player.feet*2)/2};}
function cutBoxFor(){const f=Math.round(player.feet*2)/2,b=cutBox?.box;if(!cutBox||cutBox.feet!==f||player.x<b[0]||player.x>b[2]||player.z<b[1]||player.z>b[3])cutBox=buildingBox();return cutBox.box;}
const insideAny=(x,z,y)=>!!(world.dentro?.(x,z,y)||barrios.dentro(x,z,y)||viviendas.dentro(x,z,y)||world.collide(x,z,.05,false,y-1.2));
function thirdPerson(dt,moving){
 if(avatar&&!acciones?.activa){const h=avatar.holder;h.visible=true;h.position.set(player.x,player.feet,player.z);
  if(moving){const meta=ORIENTAR==='camara'?player.face:player.dir;let d=meta-avatarYaw;d=Math.atan2(Math.sin(d),Math.cos(d));avatarYaw+=d*Math.min(1,dt*12);}h.rotation.y=avatarYaw;
  moveCharacter(avatar,moving?(player.run?'run':'walk'):'idle',moving?(player.run?RUN:WALK)/3.5:0,dt);}
 const roofed=world.dentro?.(player.x,player.z,player.feet+1)||barrios.dentro(player.x,player.z,player.feet+1)||viviendas.dentro(player.x,player.z,player.feet+1);
 // (arriba: adentro de un edificio o casa, sólo el piso del jugador; afuera, todo entero. La inclinación se lee de la
 // cámara misma, que la mueven el mouse capturado o el arrastre, y se acota)
 // (arriba, como Los Sims: la cámara en 4 ángulos fijos a 45° —el mouse o Q/E la pasan al siguiente, con un giro
 // suave— y la inclinación fija. Adentro de un edificio, sólo su piso y las paredes del lado de la cámara bajas; el corte
 // entra y sale en CUT_T segundos)
 if(view.value==='arriba'){const g0=groundHere(player.x,player.z,-1e3);
  if(roofed){lastBox=cutBoxFor();lastShared=cutBox?.shared;lastFeet=player.feet;}else cutBox=null;
  cutA=Math.max(0,Math.min(1,cutA+(roofed?1:-1)*dt/CUT_T));const up=(1-cutA)*(1-cutA)*14,F=roofed?player.feet:lastFeet;
  cut?.set(cutA>0&&!!lastBox,player.x,player.z,F+CUT_H+up,F>g0+1.5&&cutA>.99?F-.35:-1e9,lastBox,g0+.25,lastShared);
  // (giro libre: el mouse capturado o el arrastre mueven la cámara a cualquier ángulo e inclinación —acotada—; Q/E giran
  // 90° con un giro suave; la rueda acerca o aleja)
  euler.setFromQuaternion(camera.quaternion,'YXZ');
  if(topTurn){let d=topTurn.goal-euler.y;d=Math.atan2(Math.sin(d),Math.cos(d));if(Math.abs(d)<.01)topTurn=null;else euler.y+=d*Math.min(1,dt*8);}
  euler.x=Math.max(-1.35,Math.min(-.45,euler.x));euler.z=0;camera.quaternion.setFromEuler(euler);
  topDist+=(topZoom-topDist)*Math.min(1,dt*10);const TOP=topDist;
  const f=new THREE.Vector3();camera.getWorldDirection(f);const head=new THREE.Vector3(player.x,player.feet+1,player.z);
  // (si la cámara queda metida en OTRO edificio —los vecinos no se cortan—, se acerca; el propio no cuenta: está cortado)
  const box=roofed?lastBox:null,own=(x,z)=>box&&x>=box[0]&&x<=box[2]&&z>=box[1]&&z<=box[3];
  let dist=TOP;for(let s=1.5;s<=TOP;s+=.25){const q=head.clone().addScaledVector(f,-s);if(!own(q.x,q.z)&&insideAny(q.x,q.z,q.y)){dist=Math.max(roofed?4.5:1.5,s-.4);break;}}
  camera.position.copy(head).addScaledVector(f,-dist);
  cut?.front(new THREE.Vector2(-f.x,-f.z).normalize(),F+STUB+up);cut?.look(false);return;}
 cut?.set(false);
 // (la cabeza que sigue la cámara, con la altura suavizada —en la escalera los pies suben de a peldaño—; un salto de más de
 // un metro —el ascensor, aparecer— se toma de una)
 const hy=player.feet+CAM_HEAD;camHeadY=camHeadY==null||Math.abs(hy-camHeadY)>1?hy:camHeadY+(hy-camHeadY)*Math.min(1,dt*14);
 const f=new THREE.Vector3();camera.getWorldDirection(f);const head=new THREE.Vector3(player.x,camHeadY,player.z);
 // (hacia atrás por la línea de mira, de a 20 cm, hasta la primera pared)
 // Como el «spring arm» de los juegos en tercera persona: de la cabeza hacia atrás, de a 15 cm, hasta lo primero que la
 // cámara tocaría —una pared, probada a la altura de ESE punto (no de los pies: en la escalera la cámara está un piso
 // más arriba), o una losa que cruce o le quede encima/debajo—; se queda 25 cm antes. Antes sólo miraba paredes a la
 // altura de los pies y nunca losas, y al subir la escalera la cámara pasaba al piso de arriba (2026-10-15).
 const wall=(x,z,y)=>{const sz=world.size,F=y-.5;return x>=0&&z>=0&&x<=sz.w&&z<=sz.h?world.collide(x,z,.15,false,y-.2,.4):barrios.collide(x,z,.15,false,F)||viviendas.collide(x,z,.15,false,F)||casas.collide(x,z,.15);};
 // (un poco más arriba que la cabeza: el muñeco queda abajo del centro y se ve hacia dónde camina)
 // Tres caminos: el normal (atrás y arriba), a la altura de la cabeza y un poco por debajo; gana el que llega más lejos
 // (en la escalera, atrás y arriba está el tramo del piso siguiente: bajando, la cámara se aleja del muñeco).
 const at=(s,k)=>{const q=head.clone().addScaledVector(f,-s);q.y=k===0?q.y+CAM_LIFT*s/CAM_DIST:k===1?head.y:head.y-.35*s/CAM_DIST;const gq=groundHere(q.x,q.z,player.feet);// (bajo techo, a CAM_ROOF del piso que hay DEBAJO DE LA CÁMARA: subiendo la escalera, el de los pies la metía en la losa del pasillo de atrás y se acercaba de un salto)
  // (y debajo del techo de verdad de ese punto —el tramo de arriba de la escalera—, 40 cm: la prueba de losas pide 30)
  if(roofed){q.y=Math.min(q.y,gq+CAM_ROOF);const tc=world.techoEn?.(q.x,q.z,gq+.5);if(tc!=null)q.y=Math.min(q.y,tc-.4);}q.y=Math.max(q.y,gq+.3);return q;};
 // (adentro de un edificio la cámara no sale de él: cada punto, con el grosor de la fachada de margen, en el mismo lote)
 const lot=world.lotAt(player.x,player.z),M=.35,outOf=(x,z)=>lot>=0&&[[0,0],[M,0],[-M,0],[0,M],[0,-M]].some(([dx,dz])=>world.lotAt(x+dx,z+dz)!==lot);
 // Las paredes que se aclaran (2026-10-16, engine/visibilidad.js: el 2D decide; aclarado3d trama): con la cámara donde
 // quedaría sin paredes —CAM_DIST atrás, sin salir del lote, como la prueba el validador—, y las aclaradas no la frenan.
 let acl=null,aclBase=0;
 if(aclarado&&lot>=0&&roofed){const R=world.lots.get(lot)?.raise||0,nivel=Math.max(0,Math.floor((player.feet-R+.3)/3)),hx=f.x,hz=f.z,hn=Math.hypot(hx,hz)||1;aclBase=R+nivel*3;
  let s=0;for(let t=.15;t<=CAM_DIST+1e-6;t+=.15){if(outOf(head.x-hx/hn*t,head.z-hz/hn*t))break;s=t;}
  acl=paredesAClarar(plan,{x:player.x,z:player.z,nivel},{x:head.x-hx/hn*s,z:head.z-hz/hn*s},aclPrev);}
 aclPrev=acl;aclarado?.set(acl||[],aclBase);
 const reach=k=>{let prev=head;for(let s=.3;s<=CAM_DIST+1e-6;s+=.15){const q=at(s,k);
  // (por qué se frena: lo guarda camDbg.por —para __demo.probarCamara—)
  const r_=outOf(q.x,q.z)?'lote':wall(q.x,q.z,q.y)&&!aclarado?.dentro(acl,aclBase,q.x,q.y,q.z)?'pared':world.slabAt(q.x,q.z,Math.min(prev.y,q.y)-.1,Math.max(prev.y,q.y)+.2)!=null?'losa':null;
  if(r_){camDbg.por[k]=[r_,+s.toFixed(2),+q.x.toFixed(2),+q.y.toFixed(2),+q.z.toFixed(2)];return Math.max(.3,s-.25);}prev=q;}return CAM_DIST;};
 // (2026-10-16, Miguel: «cuando subo escaleras o paso por debajo de puertas la cámara tiembla»: medido, en la escalera
 // cambiaba 14 veces de camino en 3 s —y con él de altura— y la distancia saltaba de 4 m a 0,3 y a 2,75 de un cuadro al
 // otro. Ahora el camino se cambia sólo si el otro llega CAM_CAMBIO más lejos, y la distancia se acorta de una —que no
 // atraviese lo que tapa— pero se alarga de a CAM_ALARGA m/s.)
 camDbg.por={};const ds=[reach(0),null,null];const best=k=>ds[k]??(ds[k]=reach(k));if(ds[0]<CAM_DIST){best(1);best(2);}
 // (el cambio de camino tiene que sostenerse CAM_SOSTEN s —en una puerta el de arriba quedaba libre un cuadro sí y otro
 // no—; si el actual se tapa casi del todo, de una)
 let cand=camWay;for(const w of [0,1,2])if(best(w)>best(cand)+CAM_CAMBIO||w===0&&cand!==0&&best(0)>=CAM_DIST)cand=w;
 if(cand!==camWay){camWayT+=dt;if(camWayT>=CAM_SOSTEN||best(camWay)<.6){camWay=cand;camWayT=0;}}else camWayT=0;
 // (si el camino de ahora se tapa de golpe —el dintel de una puerta, el tramo de arriba de la escalera— y otro sigue
 // casi tan lejos como estaba la cámara, se pasa a ése en el acto: baja por debajo en vez de acercarse de un salto)
 if(best(camWay)<camDistS-1)for(const w of [1,2,0])if(w!==camWay&&best(w)>=camDistS-.3){camWay=w;camWayT=0;break;}
 const way=camWay;
 // (la distancia: si lo que tapa aparece más de 1 m más cerca, de una —que no se meta en la pared—; si no, se acorta a
 // CAM_ACORTA m/s y se alarga a CAM_ALARGA)
 const target=best(way);camDistS=target<camDistS-1?target:target<camDistS?Math.max(target,camDistS-CAM_ACORTA*dt):Math.min(target,camDistS+CAM_ALARGA*dt);const dist=camDistS;
 camDbg.dist=dist;camDbg.way=way;camDbg.acl=acl?.length||0;
 // (y la altura, suave al pasar de un camino a otro)
 const pos=at(dist,way);camPosY=camPosY==null||Math.abs(pos.y-camPosY)>1.2?pos.y:camPosY+(pos.y-camPosY)*Math.min(1,dt*10);pos.y=camPosY;
 camera.position.copy(pos);
 // Con la cámara a menos de un metro de la cabeza (un pasillo, la escalera), el muñeco se desvanece, como en los juegos
 // en tercera persona: si no, la pantalla es la nuca. Entero desde 1 m, invisible a 45 cm; suave (2026-10-15).
 const k=Math.min(1,Math.max(0,(dist-.45)/.55));fadeTo+=(k*k*(3-2*k)-fadeTo)*Math.min(1,dt*12);fadeAvatar(fadeTo);}
// Sólo dibujar lo que se ve (2026-10-16, engine/visibles.js): adentro de un edificio, de las fachadas de la ciudad sólo
// los lotes que se pueden ver desde ese piso por sus aberturas; en la escalera, entre dos pisos, lo de los dos; afuera,
// todo (y three.js descarta por cámara cada lote). Se recalcula sólo al cambiar de lote o de piso.
let visKey='';
function actualizarVisibles(){const B=world?.buildings;if(!B?.setVisibles)return;const lot=world.lotAt(player.x,player.z);let key='afuera';
 // (en la azotea se está afuera: el último piso es floors−1; 2026-10-16, Miguel: «subí a la terraza y desaparecieron los
 // edificios» —los pies quedan 0,1 mm bajo el techo y dentro() decía que sí: se calculaba lo visible desde un piso que no
 // existe y se apagaba todo lo demás—)
 if(lot>=0&&!drone.value&&world.dentro?.(player.x,player.z,player.feet+1)){const Lw=world.lots.get(lot),R=Lw?.raise||0,f=Math.max(0,(player.feet-R)/3),n0=Math.floor(f+.05);if(n0<(Lw?.floors??99))key=lot+':'+n0+(f-n0>.15&&n0+1<(Lw?.floors??99)?'+':'');}
 if(key===visKey)return;visKey=key;if(key==='afuera'){B.setVisibles(null);world.setVisiblesCortinas?.(null);planoVista?.setCeldas?.(null);return;}
 const lote=+key.split(':')[0],n0=parseInt(key.split(':')[1]),uno=visiblesDesde(plan,lote,n0),dos=key.endsWith('+')?visiblesDesde(plan,lote,n0+1):null;if(!uno){B.setVisibles(null);world.setVisiblesCortinas?.(null);planoVista?.setCeldas?.(null);return;}
 {const ls=dos?new Set([...uno.lotes,...dos.lotes]):uno.lotes;B.setVisibles(ls);world.setVisiblesCortinas?.(ls);}planoVista?.setCeldas?.(dos?new Set([...uno.celdas,...dos.celdas]):uno.celdas,uno.W);}
const camDbg={};
// La prueba de la cámara (2026-10-16, Miguel: «cuando subo escaleras o paso por debajo de puertas, tiembla»): camina con
// la física del juego —W apretada, de a 1/60 s— por las escaleras y las puertas de los primeros edificios y mide, cuadro
// por cuadro: los sacudones (la segunda diferencia de la posición de la cámara, más de 5 cm), las idas y vueltas de su
// distancia a la cabeza, los cambios de camino y el salto más grande. Desde la consola: __demo.probarCamara().
function probarCamara({escaleras=4,puertas=8}={}){const w=world,out={escaleras:[],puertas:[]};
 // (medio segundo quieto antes de caminar: el salto de la cámara al aparecer no cuenta)
 const medir=(x,z,yaw,seg)=>{const feet=w.floorAt(x,z,-5);Object.assign(player,{x,z,feet,ground:true,vy:0});for(let k=0;k<30;k++){euler.set(-.15,yaw,0,'YXZ');camera.quaternion.setFromEuler(euler);step(1/60);}const log=[];keys.add('KeyW');
  for(let k=0;k<seg*60;k++){euler.set(-.15,yaw,0,'YXZ');camera.quaternion.setFromEuler(euler);step(1/60);const c=camera.position;log.push([c.x,c.y,c.z,camDbg.dist,camDbg.way]);}
  keys.delete('KeyW');let a=0,sac=0,vu=0,pr=0,cc=0;
  for(let i=1;i<log.length;i++){if(log[i][4]!==log[i-1][4])cc++;if(i<2)continue;const j=Math.hypot(log[i][0]-2*log[i-1][0]+log[i-2][0],log[i][1]-2*log[i-1][1]+log[i-2][1],log[i][2]-2*log[i-1][2]+log[i-2][2]);a=Math.max(a,j);if(j>.05)sac++;const dd=log[i][3]-log[i-1][3];if(Math.abs(dd)>.03){const sg=Math.sign(dd);if(pr&&sg!==pr)vu++;pr=sg;}}
  return {sacudones:sac,vueltas:vu,cambiosCamino:cc,saltoMax:+a.toFixed(2),segundos:seg};};
 for(const L of plan.lots){if(out.escaleras.length>=escaleras)break;const s=L.levels?.[0]?.stair;if(!s||L.levels.length<2)continue;const x=s.x+s.ux*.8+s.vx*(s.fr-.8),z=s.z+s.uz*.8+s.vz*(s.fr-.8);out.escaleras.push(medir(x,z,Math.atan2(-s.vx,-s.vz),3));}
 for(const B of plan.lots){if(out.puertas.length>=puertas)break;const lv=B.levels?.[0];for(const dr of lv?.doors||[]){if(dr.street||dr.core||dr.stair)continue;const q=lv.rooms.find(r=>r.id===dr.a)||lv.rooms.find(r=>r.id===dr.b),h=Math.abs(dr.y1-dr.y0)<1e-6;if(!q||(h?q.h:q.w)<3.5)continue;
  const mx=(dr.x0+dr.x1)/2,mz=(dr.y0+dr.y1)/2,sg=h?Math.sign(q.y+q.h/2-mz):Math.sign(q.x+q.w/2-mx),nx=h?0:sg,nz=h?sg:0,sx=mx-nx*2.2,sz=mz-nz*2.2;if(w.lotAt(sx,sz)!==B.id||w.collide(sx,sz,RADIUS,true,w.floorAt(sx,sz,-5)))continue;out.puertas.push(medir(sx,sz,Math.atan2(-nx,-nz),1.4));break;}}
 const suma=l=>({casos:l.length,sacudones:l.reduce((p,r)=>p+r.sacudones,0),vueltas:l.reduce((p,r)=>p+r.vueltas,0),cambiosCamino:l.reduce((p,r)=>p+r.cambiosCamino,0),saltoMax:Math.max(0,...l.map(r=>r.saltoMax))});
 return {escaleras:suma(out.escaleras),puertas:suma(out.puertas),detalle:out};}
let fadeTo=1;
function fadeAvatar(a){if(!avatar?.fadeMats)return;if(a>.995)a=1;if(a<=.04)avatar.holder.visible=false;if(avatar.fade===a)return;avatar.fade=a;
 // (sigue escribiendo profundidad: así sólo se mezcla la cara de afuera, no las capas de ropa de adentro)
 for(const m of avatar.fadeMats){const t=a<1;if(m.transparent!==t){m.transparent=t;m.needsUpdate=true;}m.opacity=a;m.depthWrite=true;}
 for(const m of avatar.silMats||[])m.opacity=.55*a;}
// T y F: detrás ⇄ primera persona.
let lastThird='tercera';
function toggleFirst(){setView(view.value==='primera'?lastThird:'primera');}
function toggleThird(){toggleFirst();}
function setView(v){if(v!=='primera')lastThird=v;view.value=v;fps.on=v==='primera';if(fps.on)fps.enter();else fps.leave();if(avatar)avatar.holder.visible=(third.value||fps.on)&&!drone.value;if(view.value==='arriba'){euler.x=TOP_PITCH;camera.quaternion.setFromEuler(euler);syncTop();}else if(euler.x<-.5){euler.x=-.1;camera.quaternion.setFromEuler(euler);}if(view.value==='primera')cut?.set(false);
 router.replace({query:{...route.query,vista:view.value==='tercera'?undefined:view.value}});}

// El cielo, las estrellas y la caja de sombras van con la cámara (camine o vuele).
function followCamera(){
 sky.position.copy(camera.position);stars.position.copy(camera.position);
 // La sombra sigue al jugador: una caja chica bien definida en vez de una enorme borrosa.
 const d=sun.userData.dir,cx=camera.position.x,cz=camera.position.z;sun.position.set(cx+d.x*90,d.y*90,cz+d.z*90);sun.target.position.set(cx,0,cz);sun.target.updateMatrixWorld();
}

function droneStep(dt){
 const f=new THREE.Vector3();camera.getWorldDirection(f);const flat=new THREE.Vector3(f.x,0,f.z).normalize(),r=new THREE.Vector3(-flat.z,0,flat.x);
 const fw=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0);
 const st=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);
 const up=(keys.has('Space')||keys.has('KeyE')?1:0)-(keys.has('KeyC')||keys.has('KeyQ')?1:0);
 // Adelante es hacia donde mira (si mira abajo, baja); Espacio/E sube y C/Q baja; Shift acelera.
 const move=f.multiplyScalar(fw).add(r.multiplyScalar(st)).add(new THREE.Vector3(0,up,0));
 // (el despegue: sube solo hasta 28 m sobre donde arrancó, salvo que se pida subir o bajar)
 if(despegue!=null){if(up||Math.abs(despegue-dronePos.y)<.3)despegue=null;else dronePos.y+=(despegue-dronePos.y)*Math.min(1,dt*2.5);}
 // (no entra a los edificios ni a las casas: el paso que lo metería se corta, eje por eje, para que resbale por la fachada)
 if(move.lengthSq()>0){move.normalize().multiplyScalar((keys.has('ShiftLeft')||keys.has('ShiftRight')?DRONE_FAST:DRONE_SPEED)*dt);
  for(const k of ['y','x','z']){const antes=dronePos[k];dronePos[k]+=move[k];if(dronAdentro(dronePos.x,dronePos.z,dronePos.y))dronePos[k]=antes;}}
 const sz=world.size,M=ISLAND_MARGIN;dronePos.x=Math.max(-M,Math.min(sz.w+M,dronePos.x));dronePos.z=Math.max(-M,Math.min(sz.h+M,dronePos.z));
 // Sobre la isla no se mete en el suelo ni en la montaña; por debajo del borde vuela libre (para ver la roca que cuelga).
 if(dronePos.y>CLIFF)dronePos.y=Math.max(dronePos.y,(island.techo||island.height)(dronePos.x,dronePos.z)+3);// nunca por dentro de un lote ni de una rampa
 // Cuanto más alto, más lejos se ve: la niebla se corre con la altura.
 {const n=night.value,sz=world.size,away=Math.hypot(dronePos.x-sz.w/2,dronePos.z-sz.h/2,dronePos.y);scene.fog.near=(n?120:220)+away*.5;scene.fog.far=(n?700:1000)+away*.6;}dronePos.y=Math.max(DRONE_MIN,Math.min(DRONE_MAX,dronePos.y));
 camera.position.set(dronePos.x,dronePos.y,dronePos.z);
 // El jugador sigue en la calle: si un vehículo lo alcanza, igual lo corre.
 const out=traffic.pushOut(player.x,player.z,RADIUS);if((out.x!==player.x||out.z!==player.z)&&!world.collide(out.x,out.z,RADIUS,false)){player.x=out.x;player.z=out.z;}
 // El marcador sobre el jugador crece con la altura, para que se vea desde lejos.
 const k=Math.max(1,(dronePos.y-player.feet)/22);marker.visible=true;marker.scale.setScalar(k);marker.position.set(player.x,player.feet+2.6*k+Math.sin(performance.now()/300)*.25*k,player.z);
 followCamera();
}
// El dron es sólo para mirar el mundo (Miguel, 2026-10-17): despega desde la cámara y sube 28 m de a poco; al soltarlo,
// la cámara vuelve al jugador, que sigue donde estaba. Ya no se baja donde está el dron: moverse con el dron no es una
// dinámica del juego. Desde el 2026-10-18 no es del juego: sólo el laboratorio (?lab=1, la tecla V y su botón) y las
// pruebas que miden la ciudad desde arriba (validar-3d). Tampoco entra a los edificios ni a
// las casas (dronAdentro). La regla del aterrizaje (aterrizaje.js) queda en el motor, sin uso en el 3D.
let zonaAterrizaje=null,despegue=null;
const CASA_ALTO=7;// m: las casas armadas como modelo (casas3d) no dicen su alto; el dron pasa por encima de eso
const dronAdentro=(x,z,y)=>insideAny(x,z,y)||world.collide(x,z,.4,false,y-1.2)||(casas.collide(x,z,.4)&&y<island.ground(x,z)+CASA_ALTO);
function toggleDrone(){
 if(acciones?.activa)return;// (sentado o acostado no se despega: primero hay que levantarse)
 drone.value=!drone.value;
 if(drone.value){Object.assign(dronePos,{x:camera.position.x,y:camera.position.y,z:camera.position.z});despegue=camera.position.y+28;euler.setFromQuaternion(camera.quaternion,'YXZ');euler.x=-.6;camera.quaternion.setFromEuler(euler);
  // (despegando desde adentro de algo, arranca sobre el techo)
  for(let k=0;k<300&&dronAdentro(dronePos.x,dronePos.z,dronePos.y);k++)dronePos.y+=1;despegue=Math.max(despegue,dronePos.y+3);}
 else{marker.visible=false;despegue=null;euler.setFromQuaternion(camera.quaternion,'YXZ');euler.x=0;camera.quaternion.setFromEuler(euler);}
 lightClock=0;applyLight();
}

function drawMini(){
 const c=mini.value;if(!c||!baseMap||!showMap.value)return;
 const B=plan.isla.bounds,Wp=(B.x1-B.x0)*MAP_CELL,Hp=(B.y1-B.y0)*MAP_CELL;
 if(c.width!==baseMap.width){c.width=baseMap.width;c.height=baseMap.height;c.style.width=`${Wp}px`;c.style.height=`${Hp}px`;}
 const g=c.getContext('2d'),dpr=baseMap.width/Wp;g.setTransform(1,0,0,1,0,0);g.drawImage(baseMap,0,0);g.setTransform(dpr,0,0,dpr,-mapOff.x*MAP_CELL*dpr,-mapOff.y*MAP_CELL*dpr);
 for(const v of traffic.positions()){g.save();g.translate(v.x/CELL*MAP_CELL,v.z/CELL*MAP_CELL);g.rotate(-v.yaw);g.fillStyle=v.type==='taxi'?'#f6c90e':v.type==='bus'?'#3d6f8f':v.type==='cop'?'#e8eef5':'#343c42';g.fillRect(-v.wid/CELL*MAP_CELL/2-.4,-v.len/CELL*MAP_CELL/2,v.wid/CELL*MAP_CELL+.8,v.len/CELL*MAP_CELL);g.restore();}
 g.fillStyle='#d9c7a0';g.strokeStyle='rgba(52,60,66,.8)';g.lineWidth=.8;
 for(const c of [...crowd.positions(),...(soc?.personas()||[])]){g.beginPath();g.arc(c.x/CELL*MAP_CELL,c.z/CELL*MAP_CELL,1.8,0,7);g.fill();g.stroke();}
 if(ronda){g.fillStyle='#3f7d55';for(const gu of ronda.guaridas){const x=gu.caja.x/CELL*MAP_CELL,y=gu.caja.z/CELL*MAP_CELL;g.fillRect(x-3,y-3,6,6);}
  // (el punto de cada robo: el que ve la policía)
  for(const av of ronda.avisos){const x=av.x/CELL*MAP_CELL,y=av.z/CELL*MAP_CELL;g.fillStyle='#c0392b';g.beginPath();g.arc(x,y-6,3.4,Math.PI,0);g.lineTo(x,y);g.closePath();g.fill();g.fillStyle='#fff';g.beginPath();g.arc(x,y-6,1.3,0,7);g.fill();}}
 // (de policía: el punto de cada aviso del motor; gris el que ya revisó)
 if(policiaVista.value)for(const av of policiaVista.value.avisos){const x=av.x/CELL*MAP_CELL,y=av.z/CELL*MAP_CELL;g.fillStyle=av.revisado?'#8a8f94':'#c0392b';g.beginPath();g.arc(x,y-6,3.4,Math.PI,0);g.lineTo(x,y);g.closePath();g.fill();g.fillStyle='#fff';g.beginPath();g.arc(x,y-6,1.3,0,7);g.fill();}
 // (lo marcado desde el menú: un anillo que late)
 if(marcaPlano&&performance.now()<marcaPlano.hasta){const x=marcaPlano.x/CELL*MAP_CELL,y=marcaPlano.z/CELL*MAP_CELL,k=(performance.now()/600)%1;g.strokeStyle=`rgba(255,214,90,${1-k})`;g.lineWidth=2;g.beginPath();g.arc(x,y,4+k*12,0,7);g.stroke();g.strokeStyle='#ffd65a';g.beginPath();g.arc(x,y,4,0,7);g.stroke();}
 if(patrullas)for(const v of patrullas.posiciones()){g.save();g.translate(v.x/CELL*MAP_CELL,v.z/CELL*MAP_CELL);g.rotate(-v.yaw);g.fillStyle=v.manejada?'#5b8def':'#e8eef5';g.strokeStyle='#1d2a4a';g.lineWidth=.6;g.fillRect(-v.wid/CELL*MAP_CELL/2-.6,-v.len/CELL*MAP_CELL/2,v.wid/CELL*MAP_CELL+1.2,v.len/CELL*MAP_CELL);g.strokeRect(-v.wid/CELL*MAP_CELL/2-.6,-v.len/CELL*MAP_CELL/2,v.wid/CELL*MAP_CELL+1.2,v.len/CELL*MAP_CELL);g.restore();}
 if(drone.value){g.fillStyle='#e3907c';g.strokeStyle='#343c42';g.lineWidth=1.2;g.beginPath();g.arc(player.x/CELL*MAP_CELL,player.z/CELL*MAP_CELL,3,0,7);g.fill();g.stroke();}
 const px=camera.position.x/CELL*MAP_CELL,py=camera.position.z/CELL*MAP_CELL;euler.setFromQuaternion(camera.quaternion,'YXZ');const a=euler.y;
 const fx=-Math.sin(a),fy=-Math.cos(a);
 g.fillStyle='rgba(227,144,124,.25)';g.beginPath();g.moveTo(px,py);g.arc(px,py,16,Math.atan2(fy,fx)-.5,Math.atan2(fy,fx)+.5);g.fill();
 g.fillStyle='#e3907c';g.strokeStyle='#343c42';g.lineWidth=1.2;g.beginPath();g.moveTo(px+fx*7,py+fy*7);g.lineTo(px-fy*4-fx*4,py+fx*4-fy*4);g.lineTo(px+fy*4-fx*4,py-fx*4-fy*4);g.closePath();g.fill();g.stroke();
}

// Las sombras del sol se rehacen un cuadro de cada dos: son ~350 llamadas y ~1,1 M de triángulos por vez, y la gente
// camina lento; un cuadro de atraso en la sombra no se ve. Pero si el sol todavía no tiene mapa (el primer cuadro, o
// __demo.render() con la pestaña oculta, donde el bucle no corre) se pide ya: sin mapa, three r186 ata en
// directionalShadowMap[0] una textura de profundidad vacía SIN modo de comparación (la ruta de arreglos de samplers no se
// lo pone) y cada dibujo que recibe sombra falla con GL_INVALID_OPERATION y no se pinta.
function renderFrame(){
 if((shadowTick=(shadowTick+1)%2)===0||!sun.shadow.map)renderer.shadowMap.needsUpdate=true;
 composer.render();}

function loop(t){
 frame=requestAnimationFrame(loop);const dt=Math.min(.05,(t-last)/1000||0);last=t;
 step(dt);actualizarVisibles();shooting?.update(dt);if(Math.floor(t/250)!==Math.floor((t-dt*1000)/250))patchCut();
 // (los interiores —tabiques, muebles— se arman al acercarse: una vez por segundo se parchean los nuevos para el aclarado)
 if(aclarado&&world&&Math.floor(t/1000)!==Math.floor((t-dt*1000)/1000))aclarado.patchTree(world.group,[crowd,traffic,folk,animals,indoor,patrol].filter(Boolean).map(g=>g.group));
 // (los interiores —muebles del piso, casa armada— se eligen por donde está el muñeco, no la cámara: desde arriba la
 // cámara queda dos pisos más alta)
 const eye=third.value&&!drone.value?{x:player.x,y:player.feet+1.7,z:player.z}:camera.position;island.update(t/1000);const people=[...crowd.positions(),...patrol.positions(),...(soc?.personas()||[])];crowd.update(dt,player);LOD_CAM.x=camera.position.x;LOD_CAM.y=camera.position.y;LOD_CAM.z=camera.position.z;folk.update(dt,player);animals?.update(dt,camera.position);indoor.update(dt,camera.position);const adentro=island.insideHouse(eye.x,eye.z);casas?.adentro(island.casaDentro?.(eye.x,eye.z)??null);island.setEdges(adentro);
 // Los contornos sólo delinean paredes interiores: afuera no se ven y el paso costaba más de la mitad del cuadro.
 if(edgePass)edgePass.enabled=adentro||!!world.dentro?.(camera.position.x,camera.position.z,camera.position.y)||barrios.dentro(camera.position.x,camera.position.z,camera.position.y)||viviendas.dentro(camera.position.x,camera.position.z,camera.position.y);patrol.update(dt,player);traffic.update(dt,{player,people});world.updateDoors(dt,[player,...people,...(indoor.positions?.()||[])]);island.updateDoors(dt,[player,...folk.positions()]);viviendas.updateDoors(dt,[player,...folk.positions()]);viviendas.update(eye.x,eye.z);casas.update(eye.x,eye.z,scene.fog.far);world.updateAds(t/1000);world.updateInteriors(eye.x,eye.z,dt,eye.y);barrios.updateInteriors(eye.x,eye.z,dt,eye.y);barrios.updateDoors(dt,[player,...folk.positions()]);world.updateElevators(dt,player);
 {const at=drone.value?null:world.elevatorAt(player.x,player.z,player.feet);lift.value=at?{floor:at.floor,floors:at.floors,roof:at.roof}:null;}
 // Las luces reales van a los postes más cercanos; se reparten de nuevo cada tanto, no en cada cuadro.
 if(night.value&&(lightClock-=dt)<=0){lightClock=.35;const cp=camera.position,near=[...world.lights,...(island?.lights||[]),...(barrios?.lights||[]),...(viviendas?.lights||[]),...(planoVista?.lights||[])].map(l=>({l,d:(l.x-cp.x)**2+(l.z-cp.z)**2})).sort((a,b)=>a.d-b.d);streetLights.forEach((s,i)=>{const n=near[i];if(n)s.position.set(n.l.x,n.l.y,n.l.z);s.intensity=n?6:0;});}
 renderFrame();drawMini();
 if(Math.floor(t/250)!==Math.floor((t-dt*1000)/250)){niebla?.actualizar(camera,scene.fog.far);
  // Dónde estoy (direcciones.js ubicacionDe, validada en validar-ubicacion): la calle y la carrera del punto donde está el
  // jugador o, en el dron, del punto de abajo; y el nombre del lugar (el edificio, el parque, la playa) si dice algo más.
  const px=drone.value?dronePos.x:player.x,pz=drone.value?dronePos.z:player.z;
  const nombre=px<4||pz<4||px>world.size.w-4||pz>world.size.h-4?island.where(px,pz):world.where(px,pz),u=plan.vias?ubicacionDe(plan.vias,px,pz):null;
  const otro=nombre&&!/^(Calle|Carrera|Avenida|Callejón)\b/.test(nombre)?nombre:null;
  place.value=drone.value?`Dron · ${Math.round(dronePos.y)} m`:'';
  lugar.value=u?{titulo:u.titulo,sub:[drone.value?place.value:null,u.detalle,otro].filter(Boolean).join(' · ')}:{titulo:drone.value?place.value:nombre,sub:drone.value?nombre:''};}
}

// Mirar: con el puntero capturado (clic) o, si el navegador no lo permite, arrastrando.
let drag=null;
function onShoot(e){if(!ARMAS||!locked.value||view.value!=='primera'||drone.value)return;if(e.type==='mousedown'){if(e.button===0)fps.fire();if(e.button===2)aiming.value=true;}else if(e.button===2)aiming.value=false;}
const noMenu=e=>{if(view.value==='primera')e.preventDefault();};
function onDown(e){if(locked.value)return;drag={x:e.clientX,y:e.clientY,moved:false};}
function onMove(e){if(!drag||locked.value)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>3)drag.moved=true;drag.x=e.clientX;drag.y=e.clientY;
 euler.setFromQuaternion(camera.quaternion,'YXZ');euler.y-=dx*.004;euler.x=Math.max(-1.45,Math.min(1.45,euler.x-dy*.004));camera.quaternion.setFromEuler(euler);}
function onUp(){if(drag&&!drag.moved)controls.lock();drag=null;}
function onKey(e){
 // (Tab: el menú, también desde adentro del menú; con el menú abierto, el juego no recibe teclas —Escape lo cierra—)
 if(e.type==='keydown'&&e.code==='Tab'){e.preventDefault();if(menuAbierto.value)cerrarMenu();else abrirMenu();return;}
 if(menuAbierto.value){if(e.type==='keydown'&&e.code==='Escape')cerrarMenu();return;}
 if(e.target.closest?.('button,input,select'))return;
 if(e.type==='keydown'){
  if(e.code==='KeyN'){night.value=!night.value;applyLight();}
  if(e.code==='Enter'&&muerto.value)revivir();
  if(e.code==='KeyM')showMap.value=!showMap.value;
  if(e.code==='KeyV'&&LAB)toggleDrone();// (la cámara libre: sólo en el laboratorio, ?lab=1 —2026-10-18: el dron salió del juego—)
  if(e.code==='KeyT')toggleThird();
  if(e.code==='KeyF')toggleFirst();
  // R: la acción alterna de lo que está cerca (correr la cortina de la ventana, mirar por el visor de una puerta)
  // (estaba adentro del «if» de E y Q: nunca llegaba; 2026-10-17, lo encontró validar-ronda al apretar la tecla)
  if(e.code==='KeyR'&&!acciones?.activa&&(accionCerca?.cortina||accionCerca?.alterna)){acciones.empezar(accionCerca.cortina||accionCerca.alterna);accionReloj=0;}
  if(e.code==='KeyE'||e.code==='KeyQ'){const d=e.code==='KeyE'?1:-1;if(e.code==='KeyE'&&patrullas?.manejando)bajarPatrulla();else if(e.code==='KeyE'&&accionCerca?.patrulla!=null&&!drone.value){subirPatrulla(accionCerca.patrulla);accionCerca=null;}else if(world.elevatorAt(player.x,player.z,player.feet))ride(d);
   else if(e.code==='KeyE'&&acciones?.activa)acciones.terminar();else if(e.code==='KeyE'&&!drone.value&&accionCerca?.persec){usarPolicia(accionCerca.persec);accionCerca=null;accionReloj=0;}else if(e.code==='KeyE'&&!drone.value&&((accionCerca=acciones?.cerca())?.u||accionCerca?.ronda)){acciones.empezar(accionCerca);accionReloj=0;}else if(view.value==='arriba'){const e=new THREE.Euler(0,0,0,'YXZ').setFromQuaternion(camera.quaternion);topTurn={goal:(topTurn?.goal??e.y)+d*Math.PI/2};}}
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
  keys.add(e.code);
 }else keys.delete(e.code);
}
function onBlur(){keys.clear();}
// (la rueda: acercar y alejar la cámara de arriba, entre 4 y 18 m)
function onWheel(e){if(view.value!=='arriba'||drone.value)return;e.preventDefault();topZoom=Math.max(4,Math.min(18,topZoom*(1+Math.sign(e.deltaY)*.12)));}

let resize;
onMounted(async()=>{
 renderer=new THREE.WebGLRenderer({antialias:true});renderer.localClippingEnabled=true;renderer.setPixelRatio(Math.min(1.5,window.devicePixelRatio));// 1,5 y no 2: en pantallas retina casi no se nota y dibuja ~44 % menos píxeles
 renderer.shadowMap.enabled=true;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;
 host.value.appendChild(renderer.domElement);
 scene=new THREE.Scene();scene.fog=new THREE.Fog(0xcad9e2,45,240);
 camera=new THREE.PerspectiveCamera(72,1,.15,2400);
 sky=makeSky();sky.renderOrder=-1;stars=makeStars();scene.add(sky,stars);
 hemi=new THREE.HemisphereLight(0xe3eef8,0x8a8170,1.25);scene.add(hemi);
 sun=new THREE.DirectionalLight(0xfff1dc,2.6);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
 Object.assign(sun.shadow.camera,{left:-55,right:55,top:55,bottom:-55,near:1,far:260});sun.shadow.bias=-.0004;sun.shadow.normalBias=.04;
 scene.add(sun,sun.target);
 for(let i=0;i<STREET_LIGHTS;i++){const l=new THREE.PointLight(0xffc98a,0,15,1.4);l.visible=false;scene.add(l);streetLights.push(l);}
 // Postproceso: el brillo de ventanas, avisos y faros de noche. Con MSAA en el buffer para no perder el antialias.
 composer=new EffectComposer(renderer,new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:4,stencilBuffer:true}));
 // Contornos grises en aristas y siluetas (antes del brillo nocturno).
 composer.addPass(new RenderPass(scene,camera));composer.addPass(edgePass=new EdgePass(scene,camera));
 if(ARMAS){vm=createViewmodel();vmPass=new ViewmodelPass(vm);composer.addPass(vmPass);}
 if(ARMAS)shooting=createShooting({renderer,scene,camera,hide:()=>[sky,stars,avatar?.holder],people:()=>[...(crowd?.people||[]),...(folk?.people||[]),...(patrol?.people||[])],colorOf:p=>COLORS.ropa[p.tpl?.look?.ropa]});
 bloom=new UnrealBloomPass(new THREE.Vector2(1,1),.55,.45,.92);composer.addPass(bloom);composer.addPass(new OutputPass());
 controls=new PointerLockControls(camera,renderer.domElement);
 controls.addEventListener('lock',()=>{locked.value=true;});controls.addEventListener('unlock',()=>{locked.value=false;keys.clear();});
 marker=new THREE.Mesh(new THREE.ConeGeometry(.7,1.5,4).rotateX(Math.PI),new THREE.MeshStandardMaterial({color:'#e3907c',emissive:'#e3907c',emissiveIntensity:.6}));marker.visible=false;scene.add(marker);
 // (tiempos de carga, para revisar desde la consola: __demo.tiempos)
 const t0=performance.now(),T=(n,pr)=>pr.then(v=>{tiempos[n]=Math.round(performance.now()-t0);return v;});
 // El plano, en un worker mientras bajan los modelos (si el worker falla, load() lo arma acá).
 // (el plano: el guardado en IndexedDB —mapasGuardados.js, las salas precargadas— o armado en un worker y guardado)
 const planReady=T('plano',planoDe({seed:seed.value,team:team.value,parks}).then(r=>{tiempos.planoGuardado=r.guardado;return r.plano;}));
 [characters,carModels,buildings,downtown,plants,nature,furniture,policeTemplates,office,nature2,casa2,tienda,animalKit]=await Promise.all([T('gente',loadCharacters().catch(()=>[])),T('autos',loadCars().catch(()=>null)),T('edificios',loadIslandBuildings().catch(()=>null)),T('centro',loadDowntown().catch(()=>null)),T('plantas',loadPlants().catch(()=>null)),T('naturaleza',loadNature().catch(()=>null)),T('muebles',loadHouseKit().catch(()=>null)),T('policía',loadPolice().catch(()=>[])),T('oficina',loadOffice().catch(()=>null)),T('naturaleza2',loadNature2().catch(()=>null)),T('casa2',loadCasa2().catch(()=>null)),T('tienda',loadTienda().catch(()=>null)),T('animales',loadAnimals().catch(()=>null))]);if(casa2)office={...(office||{}),...casa2};if(tienda)office={...(office||{}),...tienda};/* (y la comida de Tienda, F_*; los muebles de Casa2 van con los de oficina, C2_*) */loadingPeople.value=false;
 {const ready=await planReady,a=performance.now();load(ready);tiempos.armarMundo=Math.round(performance.now()-a);}tiempos.total=Math.round(performance.now()-t0);applyLight();
 // Para revisar desde la consola: mover al jugador y la cámara sin teclado.
 if(import.meta.env.DEV)window.__demo={usarRonda,rondaT,get finVista(){return finVista.value;},get presoVista(){return presoVista.value;},muñecoDelPerfil,abrirMenu,cerrarMenu,accionMenu,get menuAbierto(){return menuAbierto.value;},get menuDatos(){return menuDatos.value;},get retratoLadron(){return retratoLadron;},get patrullas(){return patrullas;},subirPatrulla,bajarPatrulla,get velocidad(){return velocidad.value;},curar(){muerto.value=false;vidaVista.value=VIDA.max;},get soc(){return soc;},get cierres(){return cierres;},fijarHora,get hora(){return horaVista.value;},get quien(){return quienVista.value;},get ronda(){return ronda;},get cerraduras(){return cerraduras;},get persec(){return persec;},get policia(){return policiaVista.value;},get vida(){return vidaVista.value;},get muerto(){return muerto.value;},tiempos,WORLD_TIMES,THREE,fps,aiming,get shooting(){return shooting;},get vm(){return vm;},get scene(){return scene;},player,camera,euler,get avatar(){return avatar;},view,get cut(){return cut;},get world(){return world;},get city(){return city;},get plan(){return plan;},get composer(){return composer;},get renderer(){return renderer;},get crowd(){return crowd;},get traffic(){return traffic;},get island(){return island;},get folk(){return folk;},get animals(){return animals;},get indoor(){return indoor;},get patrol(){return patrol;},get viviendas(){return viviendas;},get casas(){return casas;},keys,step,dronePos,render:renderFrame,get aclarado(){return aclarado;},get visKey(){return visKey;},get acciones(){return acciones;},get niebla(){return niebla;},get lugar(){return lugar.value;},fijarDron(x,y,z){Object.assign(dronePos,{x,y,z});despegue=null;},huecosTerrazas(){// (2026-10-16: rayos hacia abajo en 3×3 puntos de cada casilla de lote del monte: un hueco es ver más de 1 m bajo el lote y bajo la calle de al lado)
  const I=plan.isla,ray=new THREE.Raycaster(),out=[];let n=0;island.group.updateMatrixWorld(true);const objs=[];island.group.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh)objs.push(o);});
  const ejes=I.carreteras.filter(c=>c.puntos).flatMap(c=>c.puntos.slice(1).map((p,i)=>({a:c.puntos[i],b:p})));
  const calle=(x,z)=>{let best=null,bd=1e9;for(const {a,b} of ejes){const dx=b.x-a.x,dz=b.z-a.z,L2=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/L2)),dd=Math.hypot(x-a.x-t*dx,z-a.z-t*dz);if(dd<bd){bd=dd;best=a.h+(b.h-a.h)*t;}}return bd<14?best:null;};
  for(const c of I.cells){if(!c.lote||c.manzana==='mirador')continue;for(const u of [.1,.5,.9])for(const v of [.1,.5,.9]){const x=(c.x+u)*CELL,z=(c.y+v)*CELL;n++;ray.set(new THREE.Vector3(x,c.terraza+40,z),new THREE.Vector3(0,-1,0));const h=ray.intersectObjects(objs,false)[0];const ys=h?h.point.y:-99,cal=calle(x,z);if(ys<Math.min(c.terraza,cal??c.terraza)-1)out.push({c:[c.x,c.y],visto:+ys.toFixed(2),lote:c.terraza});}}
  return {muestras:n,huecos:out.length,ej:out.slice(0,5)};},get zonaAterrizaje(){return zonaAterrizaje;},toggleDrone,camDbg,probarCamara,get planoVista(){return planoVista;},parchearAclarado(){aclarado?.patchTree(world.group,[crowd,traffic,folk,animals,indoor,patrol].filter(Boolean).map(g=>g.group));},get acl(){return aclPrev;},setNight(v){night.value=v;applyLight();}};
 resize=new ResizeObserver(()=>{const w=host.value.clientWidth,h=host.value.clientHeight;renderer.setSize(w,h);composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();vm?.resize(w/h);});
 resize.observe(host.value);
 renderer.domElement.addEventListener('pointerdown',onDown);renderer.domElement.addEventListener('wheel',onWheel,{passive:false});window.addEventListener('pointermove',onMove);window.addEventListener('pointerup',onUp);
 window.addEventListener('keydown',onKey);window.addEventListener('keyup',onKey);document.addEventListener('mousedown',onShoot);document.addEventListener('mouseup',onShoot);window.addEventListener('contextmenu',noMenu);window.addEventListener('blur',onBlur);
 frame=requestAnimationFrame(loop);
});
onBeforeUnmount(()=>{
 cancelAnimationFrame(frame);resize?.disconnect();controls?.unlock();controls?.dispose();
 window.removeEventListener('pointermove',onMove);window.removeEventListener('pointerup',onUp);document.removeEventListener('mousedown',onShoot);document.removeEventListener('mouseup',onShoot);window.removeEventListener('contextmenu',noMenu);vm?.dispose();shooting?.dispose();
 window.removeEventListener('keydown',onKey);window.removeEventListener('keyup',onKey);window.removeEventListener('blur',onBlur);
 world?.dispose();crowd?.dispose();traffic?.dispose();island?.dispose();folk?.dispose();composer?.dispose();renderer?.dispose();
});
</script>

<template>
 <div class="demo">
  <div ref="host" class="view"></div>
  <div class="cross" v-if="locked&&view==='primera'&&!aiming" aria-hidden="true"></div>
  <div class="hitmark" v-if="hitMark" aria-hidden="true"></div>
  <div class="lift" v-if="lift">Ascensor · {{ lift.roof?'azotea':lift.floor===0?'planta baja':'piso '+lift.floor }}<span><kbd>E</kbd> subir · <kbd>Q</kbd> bajar</span></div>
  <div class="fade" :class="{on:fading}" aria-hidden="true"></div>

  <header class="hud">
   <RouterLink to="/?paso=home" class="back" title="Volver a las salas">FUGA</RouterLink>
   <div v-if="rondaVista" class="ronda" aria-live="polite">
    <div v-if="horaVista" class="r-fila"><span>Hora</span><b class="hora">{{ horaVista }}</b></div>
    <div class="r-fila"><span>Vida</span><b>{{ Math.round(vidaVista) }}</b></div>
    <div class="r-barra vida" role="progressbar" :aria-valuenow="Math.round(vidaVista)" aria-valuemin="0" :aria-valuemax="VIDA.max"><i :style="{width:vidaVista/VIDA.max*100+'%'}"></i></div>
    <div class="r-fila"><span>Mochila</span><b>{{ rondaVista.mochila }}</b></div>
    <div class="r-fila"><span>Guardado</span><b>{{ rondaVista.botin }} <small>de {{ rondaVista.meta }}</small></b></div>
    <div class="r-barra" role="progressbar" :aria-valuenow="Math.round(rondaVista.parte*100)" aria-valuemin="0" aria-valuemax="100"><i :style="{width:rondaVista.parte*100+'%'}"></i></div>
    <details><summary>Guaridas</summary><ol><li v-for="g in rondaVista.guaridas" :key="g">{{ g }}</li></ol></details>
   </div>
   <div v-if="policiaVista" class="ronda" aria-live="polite">
    <div class="r-fila"><span>Tiempo</span><b>{{ policiaVista.reloj }}</b></div>
    <div v-if="horaVista" class="r-fila"><span>Hora</span><b class="hora">{{ horaVista }}</b></div>
    <div class="r-fila"><span>Vida</span><b>{{ Math.round(vidaVista) }}</b></div>
    <div class="r-barra vida" role="progressbar" :aria-valuenow="Math.round(vidaVista)" aria-valuemin="0" :aria-valuemax="VIDA.max"><i :style="{width:vidaVista/VIDA.max*100+'%'}"></i></div>
    <div class="r-fila"><span>Guardado por ellos</span><b>{{ policiaVista.botin }} <small>de {{ policiaVista.meta }}</small></b></div>
    <div class="r-barra ladrones" role="progressbar" :aria-valuenow="Math.round(policiaVista.parte*100)" aria-valuemin="0" aria-valuemax="100"><i :style="{width:policiaVista.parte*100+'%'}"></i></div>
    <div class="r-fila"><span>Presos</span><b>{{ policiaVista.presos }} <small>de {{ policiaVista.ladrones }}</small></b></div>
    <div class="r-fila"><span>Avisos</span><b>{{ policiaVista.avisos.length }}</b></div>
    <div v-if="policiaVista.retratos.length" class="r-retratos"><span>Retratos de la cámara</span><ol><li v-for="r in policiaVista.retratos" :key="r.id" :class="r.estado">{{ r.txt }}<small v-if="r.estado!=='libre'"> · {{ r.estado }}</small></li></ol></div>
   </div>
   <div v-if="presoVista&&!finVista" class="r-muerto preso" role="alert"><b>{{ presoVista.titulo }}</b><span>{{ presoVista.sub }}</span></div>
   <div v-if="finVista" class="r-muerto fin" :class="finVista.gana" role="alert"><small class="quien-gana">{{ finVista.yoGano?'¡Ganaste!':'Perdiste' }}</small><b>{{ finVista.titulo }}</b><span>{{ finVista.sub }}</span>
    <div class="fin-botones"><button @click="otraRonda">Otra ronda</button><RouterLink to="/?paso=home" class="boton">Volver al inicio</RouterLink></div></div>
   <div v-if="rondaMsg" class="r-msg" role="status">{{ rondaMsg }}</div>
   <div v-if="muerto" class="r-muerto" role="alert"><b>Te mataste en la caída</b><span>Quedás fuera de la ronda y perdiste lo que llevabas.</span><small>Enter: volver a la guarida (sólo para probar)</small></div>
   <div v-if="velocidad!=null" class="velocimetro" aria-live="off"><b>{{ velocidad }}</b> km/h</div>
   <div v-if="quienVista" class="quien" role="status"><b>{{ quienVista.nombre }}</b><span>{{ quienVista.oficio }}<template v-if="quienVista.edad!=null"> · {{ quienVista.edad }} años</template></span></div>
   <div v-if="accionTexto" class="accion"><kbd>E</kbd> {{ accionTexto }}<template v-if="accionAlterna"> · <kbd>R</kbd> {{ accionAlterna }}</template></div>
   <div class="where"><b>{{ lugar?.titulo }}</b><span v-if="lugar?.sub" class="via">{{ lugar.sub }}</span><small><kbd class="tabk">Tab</kbd> menú<template v-if="LAB"> · Ciudad {{ seed }} · {{ team }} vs {{ team }}</template><template v-if="horaVista"> · {{ horaVista }}</template></small></div>
   <!-- (los botones de prueba —tamaño, papel, otra ciudad, vista, dron, día/noche—: sólo con ?lab=1; quedan en la página,
   ocultos, porque las pruebas de pantalla los usan) -->
   <div class="actions" v-show="LAB">
    <div class="sizes" role="group" aria-label="Tamaño de la ciudad">
     <button v-for="s in SIZES" :key="s" :class="{on:s===team}" @click="setTeam(s)">{{ s }}</button>
    </div>
    <button @click="cambiarPapel" :class="{on:POLICIA}" title="Jugar de ladrón o de policía (contra los bots del motor)">{{ POLICIA?'Papel: policía':'Papel: ladrón' }}</button>
    <button @click="otherCity">Otra ciudad</button>
    <button @click="toggleThird" :class="{on:view!=='primera'}" title="T cambia la vista · F primera persona">{{ {tercera:'Vista: detrás',primera:'Vista: primera persona'}[view] }}</button>
    <button @click="toggleDrone" :class="{on:drone}">{{ drone?'Caminar':'Dron' }}</button>
    <button @click="night=!night;applyLight()">{{ night?'Día':'Noche' }}</button>
   </div>
  </header>

  <canvas v-show="showMap" ref="mini" class="mini" aria-label="Plano de la ciudad"></canvas>

  <MenuJuego v-if="menuDatos" :papel="POLICIA?'policia':'ladron'" :datos="menuDatos" :abierto="menuAbierto" :plano="plan" @cerrar="cerrarMenu" @accion="accionMenu" />
  <div v-if="!locked&&!menuAbierto&&!finVista" class="start">
   <div class="card" @click="controls.lock()">
    <b>{{ loadingPeople?'Cargando gente…':'Clic para caminar' }}</b>
    <dl>
     <dt>WASD</dt><dd>moverse</dd><dt>Ratón</dt><dd>mirar</dd><dt>Shift</dt><dd>correr</dd><dt>Espacio</dt><dd>saltar</dd>
     <dt>N</dt><dd>día / noche</dd><dt>M</dt><dd>plano</dd><dt>T · F</dt><dd>vista: detrás · primera persona</dd><dt>E · Q</dt><dd>en un ascensor: subir · bajar</dd><template v-if="POLICIA"><dt>E</dt><dd>de policía: revisar la cámara de un aviso · atrapar · pedir papeles · subir y bajar de la patrulla</dd><dt>W/S · A/D</dt><dd>en la patrulla: acelerar y frenar · girar</dd></template><dt>E · R</dt><dd>usar lo de cerca (sentarse, asomarse…) · correr la cortina de la ventana</dd><dt>Esc</dt><dd>soltar el ratón</dd>
    </dl>
   </div>
  </div>
 </div>
</template>

<style scoped>
.demo{position:fixed;inset:0;background:#0b0f15;overflow:hidden;color:#f4f1ea;font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.view{position:absolute;inset:0}
.view :deep(canvas){display:block}
.hitmark{position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;pointer-events:none;background:linear-gradient(45deg,transparent 46%,#fff 46%,#fff 54%,transparent 54%),linear-gradient(-45deg,transparent 46%,#fff 46%,#fff 54%,transparent 54%);-webkit-mask:radial-gradient(circle,transparent 5px,#000 5.5px);mask:radial-gradient(circle,transparent 5px,#000 5.5px);filter:drop-shadow(0 0 1px rgba(0,0,0,.6))}
.cross{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:rgba(255,255,255,.85);box-shadow:0 0 0 1.5px rgba(0,0,0,.35);pointer-events:none}
.hud{position:absolute;left:16px;right:16px;top:14px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;pointer-events:none}
.hud>*{pointer-events:auto}
.back{width:42px;height:42px;border-radius:12px;background:#edb4a5;color:#343c42;display:grid;place-items:center;font-weight:900;font-size:11px;letter-spacing:.5px;text-decoration:none;transform:rotate(-4deg)}
.lift{position:absolute;left:50%;bottom:90px;transform:translateX(-50%);background:rgba(20,24,28,.72);color:#fff;padding:8px 14px;border-radius:10px;font-size:14px;display:flex;gap:12px;align-items:center;pointer-events:none;z-index:5}
.lift span{opacity:.8;font-size:12px}.lift kbd{background:rgba(255,255,255,.15);border-radius:4px;padding:1px 6px;font:11px ui-monospace,monospace}
.fade{position:absolute;inset:0;background:#000;opacity:0;transition:opacity .28s;pointer-events:none;z-index:6}.fade.on{opacity:1}
/* (la tecla de la acción cercana: abajo al centro, sin tapar la mira) */
.ronda{position:fixed;top:84px;left:14px;width:260px;background:rgba(20,24,28,.72);color:#fff;padding:10px 12px;border-radius:10px;font-size:13px;z-index:6;backdrop-filter:blur(6px)}
.ronda .r-fila{display:flex;justify-content:space-between;gap:8px;line-height:1.6}.ronda small{opacity:.7;font-weight:400}
.ronda .r-barra{height:6px;border-radius:3px;background:rgba(255,255,255,.18);overflow:hidden;margin:6px 0}.ronda .r-barra i{display:block;height:100%;background:#7fd19b}
.ronda details{margin-top:4px}.ronda summary{cursor:pointer;opacity:.85}.ronda ol{margin:6px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:3px;font-size:12px}
.ronda .r-barra.vida i{background:#e07a6a}.ronda .r-barra.ladrones i{background:#e0b25a}
.ronda .r-retratos{margin-top:6px;font-size:12px}.ronda .r-retratos span{opacity:.8}.ronda .r-retratos ol{margin:4px 0 0;padding-left:18px}.ronda .r-retratos li.preso{text-decoration:line-through;opacity:.6}
.where kbd.tabk{background:rgba(255,255,255,.18);border-radius:4px;padding:0 5px;font:inherit}
.velocimetro{position:fixed;right:16px;bottom:calc(16px + 30vh);background:rgba(20,24,28,.72);color:#fff;padding:6px 12px;border-radius:10px;font-size:13px;z-index:6;backdrop-filter:blur(6px)}.velocimetro b{font-size:22px;font-variant-numeric:tabular-nums}
.quien{position:fixed;left:50%;bottom:calc(20% + 52px);transform:translateX(-50%);background:rgba(20,24,28,.72);color:#fff;padding:6px 14px;border-radius:10px;font-size:14px;pointer-events:none;z-index:6;backdrop-filter:blur(6px);display:flex;flex-direction:column;align-items:center;line-height:1.3}
.quien span{font-size:12px;opacity:.85}.ronda .hora{text-transform:capitalize}
.r-muerto.fin{background:rgba(10,20,40,.7)}.r-muerto.preso{background:rgba(30,30,50,.55);pointer-events:none}.quien-gana{font-size:15px;letter-spacing:2px;text-transform:uppercase;opacity:.9}
.fin-botones{display:flex;gap:10px;margin-top:10px}.fin-botones button,.fin-botones .boton{border:0;border-radius:10px;padding:10px 18px;font:inherit;font-weight:700;cursor:pointer;background:#edb4a5;color:#2b3036;text-decoration:none}.fin-botones .boton{background:#e8eef5}.r-muerto.fin.ladron{background:rgba(40,30,10,.55)}
.r-muerto{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(40,10,10,.55);color:#fff;z-index:8;font-size:15px;text-align:center}
.r-muerto b{font-size:26px}.r-muerto small{opacity:.8}
.r-msg{position:fixed;left:50%;top:18%;transform:translateX(-50%);background:rgba(20,24,28,.8);color:#fff;padding:9px 16px;border-radius:10px;font-size:15px;z-index:7;pointer-events:none}
.accion{position:fixed;left:50%;bottom:20%;transform:translateX(-50%);background:rgba(20,24,28,.72);color:#fff;padding:8px 14px;border-radius:10px;font-size:15px;pointer-events:none;z-index:6;backdrop-filter:blur(6px)}
.accion kbd{display:inline-block;min-width:20px;padding:1px 6px;margin-right:6px;border-radius:5px;background:#f2f2ef;color:#1d1f22;font:600 13px/1.4 system-ui;text-align:center}
.where{background:rgba(20,24,28,.55);backdrop-filter:blur(8px);padding:6px 12px;border-radius:10px;min-width:150px}
.where b{display:block;font-size:15px}
.where .via{display:block;font-size:12px;opacity:.9;margin:1px 0 2px}
.where small{display:block;font:11px ui-monospace,SFMono-Regular,monospace;opacity:.7}
.actions{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
.actions button,.sizes button{border:1px solid rgba(255,255,255,.18);background:rgba(20,24,28,.55);backdrop-filter:blur(8px);color:inherit;border-radius:9px;padding:7px 12px;cursor:pointer;font:inherit}
.actions button:hover,.sizes button:hover{background:rgba(40,46,52,.75)}
.actions button.on{background:rgba(237,180,165,.9);color:#343c42;font-weight:700}
.sizes{display:flex;gap:2px;background:rgba(20,24,28,.35);border-radius:10px;padding:2px}
.sizes button{padding:5px 10px;border-color:transparent;background:transparent}
.sizes button.on{background:rgba(237,180,165,.9);color:#343c42;font-weight:700}
.mini{position:absolute;right:16px;bottom:16px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);opacity:.92;max-width:40vw;height:auto!important}
.start{position:absolute;inset:0;display:grid;place-items:center;background:rgba(8,10,14,.28);pointer-events:none}
.card{pointer-events:auto;cursor:pointer;background:rgba(20,24,28,.72);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:20px 26px;min-width:240px}
.card b{display:block;font-size:20px;margin-bottom:10px}
.card dl{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:0}
.card dt{font:12px ui-monospace,SFMono-Regular,monospace;background:rgba(255,255,255,.12);border-radius:5px;padding:1px 7px;justify-self:start}
.card dd{margin:0;opacity:.85}
@media (max-width:640px){.mini{max-width:44vw}.where{min-width:0}}
</style>
