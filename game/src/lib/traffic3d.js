/* Tráfico de /demo: carros, taxis, buses y motos. Es decorado (el motor no los conoce), pero respeta la ciudad:
   - las avenidas (dos casillas) tienen un carril por sentido y se maneja por la derecha;
   - las calles de una casilla son de doble vía: un carril por sentido, corrido a la derecha del centro;
   - en los cruces se sigue derecho o se dobla, siempre hacia un carril de su mano;
   - frenan ante el vehículo de adelante, la gente y el jugador (y prenden las luces de freno).
   Cada vehículo recorre su casilla por una curva (de borde de entrada a borde de salida), así los giros son suaves.
   El manejo (2026-10-18, Miguel: «que giren orgánicamente, que paren en los semáforos»; engine/transito.js, TRANSITO,
   probado en el 2D por validar-transito y en el 3D por validar-transito3d):
   - semáforos de verdad en los cruces con avenida (los del equipamiento): un ciclo para toda la ciudad, el eje este–oeste
     y después el norte–sur; con rojo se para en la línea de pare (antes de la cebra) y con amarillo decide: para si
     puede, sigue si alcanza a cruzar; las luces de cada semáforo se prenden con su eje;
   - se frena con tiempo: para una curva (a la velocidad que da TRANSITO.lateral de costado), para un cruce sin
     semáforo (TRANSITO.ceda) y para el rojo, con la frenada cómoda; la máxima, sólo para un susto;
   - la sombra, sólo de los de cerca (SOMBRA m del jugador): de lejos no se nota y cada uno es una llamada más. */
import * as THREE from 'three';
import {CELL} from './world3d.js';
import {grillaCarriles,CARRIL} from '../engine/carriles3d.js';
import {luz,curva,amarillo,objetivo,paso,PISA} from '../engine/transito.js';
import {TRANSITO} from '../engine/medidas.js';
import {crucesCiudad} from '../engine/veredas.js';
import {adMaterials} from './ads3d.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {MTLLoader} from 'three/addons/loaders/MTLLoader.js';

// Carros de Quaternius (CC0, public/models/carros, OBJ con colores en el .mtl): miden en metros y miran hacia +z,
// como los vehículos de acá. Se cargan una vez; si faltan, los carros quedan como antes (cajas).
const CAR_FILES={car:['NormalCar1','NormalCar2','SUV','SportsCar','SportsCar2'],taxi:['Taxi'],cop:['Cop']};
let carCache=null;
export function loadCars(){
 if(carCache)return carCache;const base='/models/carros/';
 carCache=Promise.all(Object.values(CAR_FILES).flat().map(n=>new MTLLoader().setPath(base).loadAsync(n+'.mtl')
  .then(m=>{m.preload();return new OBJLoader().setMaterials(m).setPath(base).loadAsync(n+'.obj');}).then(o=>[n,o]).catch(()=>null)))
  .then(list=>Object.fromEntries(list.filter(Boolean)));
 return carCache;
}
// Los materiales del modelo pasan a los de acá: faros y luces traseras se encienden de noche (y al frenar), las
// ventanas son vidrio, la sirena de la patrulla destella; el resto, con su color y el mismo acabado que la ciudad.
const converted=new Map();
const asStandard=m=>{if(!converted.has(m.uuid))converted.set(m.uuid,new THREE.MeshStandardMaterial({color:m.color,roughness:.45,metalness:.25}));return converted.get(m.uuid);};

const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
function rng(seed){let n=seed>>>0;return()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function hash(x,y,s=0){let h=Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(s|0,1274126177);h=Math.imul(h^h>>>13,1274126177);return((h^h>>>16)>>>0)/4294967296;}

const CAR_COLORS=['#c9ccd1','#1f2326','#f2f2ef','#8a1e1e','#24477a','#6f7478','#3e6b48','#b8a68a','#5a2d5e'];
const BUS_COLORS=['#1f5fa8','#3e8f4f','#b5372f','#e07b1a'];

// ---------- Modelos (miran hacia +z) ----------
let shared=null;
function sharedParts(){
 if(shared)return shared;
 const c=document.createElement('canvas');c.width=128;c.height=256;const g=c.getContext('2d');
 const gr=g.createLinearGradient(0,256,0,0);gr.addColorStop(0,'rgba(255,236,190,.32)');gr.addColorStop(1,'rgba(255,236,190,0)');g.fillStyle=gr;
 g.beginPath();g.moveTo(52,256);g.lineTo(76,256);g.lineTo(128,0);g.lineTo(0,0);g.closePath();g.fill();
 const cone=new THREE.CanvasTexture(c);cone.colorSpace=THREE.SRGBColorSpace;
 // Flecha de sentido pintada en el piso (blanca, sobre transparente; apunta hacia +y del canvas = hacia adelante).
 const ac=document.createElement('canvas');ac.width=64;ac.height=160;const ag=ac.getContext('2d');ag.fillStyle='rgba(245,245,238,.92)';
 ag.beginPath();ag.moveTo(32,0);ag.lineTo(62,52);ag.lineTo(42,52);ag.lineTo(42,160);ag.lineTo(22,160);ag.lineTo(22,52);ag.lineTo(2,52);ag.closePath();ag.fill();
 const arrow=new THREE.CanvasTexture(ac);arrow.colorSpace=THREE.SRGBColorSpace;arrow.anisotropy=8;
 shared={
  arrow:new THREE.MeshStandardMaterial({map:arrow,transparent:true,depthWrite:false,roughness:.8,polygonOffset:true,polygonOffsetFactor:-2}),
  glass:new THREE.MeshStandardMaterial({color:'#1b2730',roughness:.12,metalness:.6}),
  tire:new THREE.MeshStandardMaterial({color:'#1a1b1d',roughness:.9}),
  dark:new THREE.MeshStandardMaterial({color:'#2a2d30',roughness:.7}),
  head:new THREE.MeshStandardMaterial({color:'#fffaf0',emissive:'#fff3d6',emissiveIntensity:.2}),
  sign:new THREE.MeshStandardMaterial({color:'#fff6c8',emissive:'#ffd36b',emissiveIntensity:.3}),
  cone:new THREE.MeshBasicMaterial({map:cone,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}),
  siren:new THREE.MeshStandardMaterial({color:'#2a57d6',emissive:'#3f6fff',emissiveIntensity:.2}),
  paint:new Map(),
  geo:{
   wheel:new THREE.CylinderGeometry(.32,.32,.24,14).rotateZ(Math.PI/2),busWheel:new THREE.CylinderGeometry(.5,.5,.3,14).rotateZ(Math.PI/2),
   motoWheel:new THREE.CylinderGeometry(.3,.3,.1,14).rotateZ(Math.PI/2),arrow:new THREE.PlaneGeometry(.75,1.9).rotateX(-Math.PI/2),lamp:new THREE.BoxGeometry(.4,.13,.05),
   cone:new THREE.PlaneGeometry(3.4,7.5).rotateX(-Math.PI/2),smallCone:new THREE.PlaneGeometry(1.8,5).rotateX(-Math.PI/2),
  },
 };
 return shared;
}
const paint=c=>{const P=sharedParts().paint;if(!P.has(c))P.set(c,new THREE.MeshStandardMaterial({color:c,roughness:.35,metalness:.35}));return P.get(c);};

function box(w,h,d,m,x,y,z){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);o.castShadow=true;o.userData.own=true;return o;}
function shared3(g,m,x,y,z){const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.castShadow=true;return o;}

// También lo usa la comisaría para sus patrullas estacionadas.
export function buildVehicle(type,r,models=null){return build(type,r,models);}
function build(type,r,models=null){
 const P=sharedParts(),G=new THREE.Group(),tail=new THREE.MeshStandardMaterial({color:'#7a1010',emissive:'#ff2a1a',emissiveIntensity:.15});
 // Carros, taxis y patrullas de modelo, si están cargados.
 const names=CAR_FILES[type],name=names?.[Math.floor(r()*names.length)];
 if(models&&name&&models[name]){
  const obj=models[name].clone(true),recolor=type==='car'&&!name.startsWith('Sports')?paint(CAR_COLORS[Math.floor(r()*CAR_COLORS.length)]):null;
  obj.traverse(o=>{if(!o.isMesh)return;o.castShadow=true;o.receiveShadow=true;
   const swap=m=>m.name==='Headlights'||m.name==='WhiteLights'?P.head:m.name==='TailLights'?tail:m.name==='Windows'?P.glass:m.name==='BlueLights'?P.siren:recolor&&!['Black','Grey'].includes(m.name)?recolor:asStandard(m);
   o.material=Array.isArray(o.material)?o.material.map(swap):swap(o.material);});
  G.add(obj);const b=new THREE.Box3().setFromObject(obj),len=b.max.z-b.min.z,wid=b.max.x-b.min.x;
  const cone=shared3(P.geo.cone,P.cone,0,.04,len/2+3.6);cone.castShadow=false;cone.visible=false;G.add(cone);
  return {group:G,len,wid,vmax:type==='cop'?8+r()*2:name.startsWith('Sports')?9+r()*2:7.5+r()*2.5,tail,cone};
 }
 const lamps=(len,y,xs)=>{for(const x of xs){G.add(shared3(P.geo.lamp,P.head,x,y,len/2+.01));G.add(shared3(P.geo.lamp,tail,x,y+.03,-len/2-.01));}};
 let len,wid,vmax,cone;
 if(type==='car'||type==='taxi'){
  const body=paint(type==='taxi'?'#f6c90e':CAR_COLORS[Math.floor(r()*CAR_COLORS.length)]);len=4.2;wid=1.76;vmax=7.5+r()*2.5;
  G.add(box(1.76,.62,4.2,body,0,.62,0),box(1.56,.5,2.1,P.glass,0,1.18,-.15),box(1.6,.07,1.9,body,0,1.46,-.15),box(1.7,.12,.3,P.dark,0,.4,2.12),box(1.7,.12,.3,P.dark,0,.4,-2.12));
  for(const [x,z] of [[.82,1.32],[-.82,1.32],[.82,-1.32],[-.82,-1.32]])G.add(shared3(P.geo.wheel,P.tire,x,.32,z));
  if(type==='taxi')G.add(box(.62,.2,.26,P.sign,0,1.6,-.3));
  lamps(len,.74,[.55,-.55]);cone=shared3(P.geo.cone,P.cone,0,.04,len/2+3.6);
 }else if(type==='bus'){
  const body=paint(BUS_COLORS[Math.floor(r()*BUS_COLORS.length)]),ads=adMaterials(),ad=ads[Math.floor(r()*ads.length)];len=8.5;wid=2.45;vmax=5.5+r()*1.2;
  G.add(box(2.45,2.6,8.5,body,0,1.65,0),box(2.48,.95,7.5,P.glass,0,2.28,-.15),box(2.25,1.35,.06,P.glass,0,2.05,4.26),box(1.6,.26,.07,P.sign,0,2.82,4.27),box(2.47,.1,8.52,P.dark,0,.4,0));
  for(const s of [1,-1]){const p=new THREE.Mesh(new THREE.PlaneGeometry(4.4,1.05),ad);p.userData.own=true;p.position.set(s*1.237,1.2,-.5);p.rotation.y=s*Math.PI/2;G.add(p);}
  for(const [x,z] of [[1.1,2.7],[-1.1,2.7],[1.1,-2.6],[-1.1,-2.6]])G.add(shared3(P.geo.busWheel,P.tire,x,.5,z));
  lamps(len,.8,[.85,-.85]);cone=shared3(P.geo.cone,P.cone,0,.04,len/2+3.6);cone.scale.set(1.2,1,1);
 }else{ // moto
  const body=paint(CAR_COLORS[Math.floor(r()*CAR_COLORS.length)]),jacket=paint(['#2b3a55','#1f2326','#7a1f1f','#3e6b48','#c96f1a'][Math.floor(r()*5)]);len=2;wid=.8;vmax=8.5+r()*2.5;
  G.add(shared3(P.geo.motoWheel,P.tire,0,.3,.68),shared3(P.geo.motoWheel,P.tire,0,.3,-.68),box(.32,.36,1.15,body,0,.62,0),box(.3,.12,.6,P.dark,0,.86,-.22));
  const torso=box(.42,.56,.3,jacket,0,1.2,-.12);torso.rotation.x=.3;G.add(torso);
  const helmet=new THREE.Mesh(new THREE.SphereGeometry(.17,12,10),paint(['#f2f2ef','#1f2326','#c2412d','#e0b23c'][Math.floor(r()*4)]));helmet.userData.own=true;helmet.position.set(0,1.62,.02);helmet.castShadow=true;G.add(helmet);
  G.add(box(.1,.1,.55,jacket,.22,1.22,.2),box(.1,.1,.55,jacket,-.22,1.22,.2),box(.12,.45,.14,paint('#2b3a55'),.15,.8,.05),box(.12,.45,.14,paint('#2b3a55'),-.15,.8,.05));
  G.add(shared3(P.geo.lamp,P.head,0,.86,.6));G.add(shared3(P.geo.lamp,tail,0,.82,-.6));cone=shared3(P.geo.smallCone,P.cone,0,.04,len/2+2.5);
 }
 cone.castShadow=false;cone.visible=false;G.add(cone);
 return {group:G,len,wid,vmax,tail,cone};
}

export function createTraffic(world,{seed=1,density=1,models=null,plan=null}={}){
 const S=CELL,{W,H,at,road,K}=world.roads,r=rng(seed*31+7),group=new THREE.Group();
 // Las salidas de la isla (world.roads.exits): la casilla del muro es calle y, afuera, la avenida termina en una mini
 // rotonda. Un vehículo que sale por ahí hace un solo tramo «de paseo» (exc): la avenida por su carril, la vuelta a la
 // rotonda dejando la isla a la izquierda y el regreso por el otro carril hasta el muro. Uno por salida a la vez.
 const exitList=(world.roads.exits||[]).filter(e=>e.rot&&e.P.length>1),exitAt=new Map(exitList.map((e,i)=>[(e.gate[0]+e.dir[0])+','+(e.gate[1]+e.dir[1]),i]));
 const drive=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&road(x,y);
 // La grilla de carriles (engine/carriles3d.js): qué es cada casilla, su sentido y dónde va el auto a lo ancho.
 const GC=grillaCarriles(W,H,drive,S),{hR,vR,axis,laneOff,middle}=GC;
 // Calles angostas: tramos entre cruces (de doble vía). Un tramo sin salida (no termina en un cruce por los dos lados)
 // queda fuera del tráfico: ahí no hay dónde dar la vuelta.
 const single=(x,y)=>{const ax=axis(x,y),i=y*W+x;return ax==='h'&&vR[i]===1||ax==='v'&&hR[i]===1;};
 const segOf=new Int32Array(W*H).fill(-1),segs=[];
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  if(!drive(x,y)||!single(x,y)||segOf[y*W+x]>=0)continue;
  const ax=axis(x,y),[dx,dy]=ax==='h'?[1,0]:[0,1];let sx=x,sy=y;while(drive(sx-dx,sy-dy)&&single(sx-dx,sy-dy)&&axis(sx-dx,sy-dy)===ax)sx-=dx,sy-=dy;
  const cells=[];let ex=sx,ey=sy;while(drive(ex,ey)&&single(ex,ey)&&axis(ex,ey)===ax){cells.push([ex,ey]);segOf[ey*W+ex]=segs.length;ex+=dx;ey+=dy;}
  const a=[sx-dx,sy-dy],b=[ex,ey],isJ=([u,v])=>drive(u,v)&&axis(u,v)==='j'||exitAt.has(u+','+v);
  segs.push({ax,cells,a,b,dead:!isJ(a)||!isJ(b)});
 }
 const open=(x,y)=>drive(x,y)&&!(segOf[y*W+x]>=0&&segs[segOf[y*W+x]].dead);
 function allows(x,y,dx,dy){return open(x,y)&&GC.sentido(x,y,dx,dy);}
 // Los cruces: grupos de casillas de cruce (para armar el camino por dentro).
 const jid=new Int32Array(W*H).fill(-1),clusters=[];
 for(let i=0;i<W*H;i++){const x=i%W,y=(i-x)/W;if(jid[i]>=0||!drive(x,y)||axis(x,y)!=='j')continue;const q=[i];jid[i]=clusters.length;for(let h=0;h<q.length;h++){const k=q[h],kx=k%W,ky=(k-kx)/W;for(const [ddx,ddy] of DIRS){const nx=kx+ddx,ny=ky+ddy;if(drive(nx,ny)&&axis(nx,ny)==='j'&&jid[ny*W+nx]<0){jid[ny*W+nx]=clusters.length;q.push(ny*W+nx);}}}clusters.push(q);}

 // Los cruces con semáforo (los de la avenida: crucesCiudad, como el equipamiento): sus casillas, y de ahí sus grupos.
 const conSemaforo=new Set();
 if(plan?.map)for(const c of crucesCiudad(plan.map)){if(!c.av)continue;for(let y=c.y0;y<=c.y1;y++)for(let x=c.x0;x<=c.x1;x++)if(jid[y*W+x]>=0)conSemaforo.add(jid[y*W+x]);}
 const semaforo=(x,y)=>jid[y*W+x]>=0&&conSemaforo.has(jid[y*W+x]);
 // Las luces de los semáforos del equipamiento: tres por semáforo (rojo, ámbar, verde), en una malla instanciada por eje y
 // color (seis llamadas en total); cada cuadro se prende la de su eje. Un brazo N o S regula a los que vienen por el eje
 // norte–sur ('v'); E u O, el este–oeste ('h'). Mira a su brazo (contrato3d BRAZO): el frente (+z) girado por ry.
 const BRAZO={N:Math.PI,S:0,E:Math.PI/2,W:-Math.PI/2},COLOR={rojo:'#ff3b2f',amarillo:'#ffb21f',verde:'#3dff7a'},ALTO={rojo:3.15,amarillo:2.9,verde:2.65};
 const luces={};{const sem=(plan?.equipamiento||[]).filter(e=>e.tipo==='semaforo'&&BRAZO[e.brazo]!=null),geo=new THREE.CircleGeometry(.085,14),m4=new THREE.Matrix4(),q=new THREE.Quaternion(),e3=new THREE.Euler();
  for(const eje of ['h','v'])for(const c of ['rojo','amarillo','verde']){const L=sem.filter(e=>(e.brazo==='N'||e.brazo==='S'?'v':'h')===eje);if(!L.length)continue;
   const mat=new THREE.MeshBasicMaterial({color:COLOR[c],transparent:true,opacity:.12}),M=new THREE.InstancedMesh(geo,mat,L.length);M.userData.own=true;M.castShadow=false;M.frustumCulled=false;
   L.forEach((e,i)=>{const ry=BRAZO[e.brazo],y0=world.groundAt?.(e.x,e.z)??.15;e3.set(0,ry,0);q.setFromEuler(e3);const px=e.x+Math.sin(ry)*.275,pz=e.z+Math.cos(ry)*.275;m4.compose(new THREE.Vector3(px,y0+ALTO[c]+.09,pz),q,new THREE.Vector3(1,1,1));M.setMatrixAt(i,m4);});
   group.add(M);(luces[eje]||(luces[eje]={}))[c]=mat;}}
 let reloj=0;// (s de la ronda: el ciclo de los semáforos)
 // big: un bus (no entra a las calles de doble vía: no caben él y uno de frente; va por avenidas y cruces).
 function choose(x,y,[dx,dy],prevJunction,big=false){
  const okCell=(nx,ny)=>!(big&&lane(nx,ny));
  if(!big&&exitAt.has((x+dx)+','+(y+dy)))return [dx,dy]; // sale de la ciudad: sigue a la avenida de afuera
  const ax=axis(x,y),straight=open(x+dx,y+dy)&&okCell(x+dx,y+dy)&&(allows(x+dx,y+dy,dx,dy)||axis(x+dx,y+dy)==='j');
  if((ax==='h'||ax==='v'||prevJunction)&&straight)return [dx,dy];
  const opts=[];for(const o of DIRS){if(o[0]===-dx&&o[1]===-dy)continue;const nx=x+o[0],ny=y+o[1];if(open(nx,ny)&&okCell(nx,ny)&&(allows(nx,ny,o[0],o[1])||axis(nx,ny)==='j'))opts.push(o);}
  if(opts.length){const w=opts.map(o=>o[0]===dx&&o[1]===dy?3:1),tot=w.reduce((a,b)=>a+b,0);let p=r()*tot;for(let i=0;i<opts.length;i++){p-=w[i];if(p<=0)return opts[i];}return opts[0];}
  for(const o of DIRS)if(!(o[0]===-dx&&o[1]===-dy)&&open(x+o[0],y+o[1]))return o;
  return [-dx,-dy];
 }

 // ---------- Vehículos ----------
 // Cada uno lleva su ruta como una lista de tramos (una casilla cada uno, con su dirección de entrada y de salida) que
 // cubre su cuerpo, de la cola a la trompa. Las casillas de la ruta están RESERVADAS: nadie más entra ahí. Para
 // avanzar hay que reservar la casilla siguiente; para cruzar, el cruce entero y la salida de una vez (así no se arma
 // un anillo trancado).
 // Reservas: en una calle de doble vía, cada carril es su propia «casilla» (los de sentido contrario no se estorban); en
 // cruces y avenidas, la casilla entera.
 const N=W*H,owner=new Int32Array(N*3+exitList.length).fill(-1),lane=(x,y)=>drive(x,y)&&single(x,y)&&!(segOf[y*W+x]>=0&&segs[segOf[y*W+x]].dead);
 const LANE=1.05;
 // El carril del 2D (2026-10-16, Miguel: «el movimiento de los carros está mal»: iban por el centro de su casilla, a 3 m
 // del eje de una calle de 12 m —el borde del asfalto: el 45 % del tiempo, con la vereda debajo—). circulacion.js pone
 // cada carril a la derecha del sentido, a CIRCULACION.vehiculo.carril/2 del eje de la calle: laneOff es cuánto hay que
 // correrse a la derecha desde el centro de la casilla (cx, cy) yendo hacia d para quedar ahí. null en un cruce (ahí
 // se sigue el corrimiento que se traía y se toma el de la calle de salida).
 // (al sumar tramos a una ruta: lo que no tiene corrimiento propio sigue el del tramo anterior)
 // (y el largo de un giro de 90°, el de su curva: un cuarto de círculo de radio S/2 + el corrimiento —la velocidad se
 // reparte por el largo; con S·0,785 fijo el auto aceleraba o frenaba al doblar—)
 // (continuo: un tramo empieza donde terminó el anterior —donde la calle cambia de ancho, el carril se corre a lo largo
 // del tramo y no de golpe, de costado—)
 const link=(route,more)=>{let prev=route.at(-1);for(const g of more){if(g.offIn==null||(prev&&!prev.exc&&!g.exc&&Math.abs(g.offIn-prev.offOut)>.05))g.offIn=prev?prev.offOut:g.offIn??0;if(g.offOut==null)g.offOut=g.offIn;
  if(!g.exc&&g.din[0]*g.dout[0]+g.din[1]*g.dout[1]===0){const A=[-g.din[0]*S/2-g.din[1]*g.offIn,-g.din[1]*S/2+g.din[0]*g.offIn],B=[g.dout[0]*S/2-g.dout[1]*g.offOut,g.dout[1]*S/2+g.dout[0]*g.offOut],K=g.din[0]?[B[0],A[1]]:[A[0],B[1]];
   const la=Math.hypot(K[0]-A[0],K[1]-A[1]),lb=Math.hypot(B[0]-K[0],B[1]-K[1]);g.len=Math.abs(la-lb)<.05?Math.PI/2*la:(la+lb)*.82;if(g.len<.5)g.len=.5;g.radio=Math.abs(la-lb)<.05?la:Math.min(la,lb);}
  else if(!g.exc&&g.din[0]===-g.dout[0]&&g.din[1]===-g.dout[1])g.radio=S/2;// (la vuelta en U)
  prev=g;}return more;};
 const isTurn=g=>!(g.din[0]===g.dout[0]&&g.din[1]===g.dout[1]);
 const segLen=g=>!isTurn(g)?S:g.din[0]===-g.dout[0]&&g.din[1]===-g.dout[1]?S*1.2:S*.785;
 const seg=(cx,cy,din,dout)=>{const c=cy*W+cx,straight=din[0]===dout[0]&&din[1]===dout[1],key=(lane(cx,cy)||middle(cx,cy))&&straight?c+N*(din[0]+din[1]>0?1:2):c;
  // Corrimiento a la derecha al entrar y al salir de la casilla (en los bordes con una calle de doble vía).
  // (en una calle, el carril de esta casilla; en un cruce, el de la calle de donde viene y el de la de salida)
  const here=laneOff(cx,cy,din),g={cx,cy,din,dout,cells:[key],offIn:here??laneOff(cx-din[0],cy-din[1],din),offOut:here!=null&&straight?here:laneOff(cx+dout[0],cy+dout[1],dout)??(here!=null?laneOff(cx,cy,dout):null)};g.len=segLen(g);return g;};
 const free=(cells,id)=>cells.every(c=>owner[c]<0||owner[c]===id);
 const take=(cells,id)=>{for(const c of cells)owner[c]=id;};
 const drop=(cells,id)=>{for(const c of cells)if(owner[c]===id)owner[c]=-1;};
 const starts=[];for(let y=0;y<H;y++)for(let x=0;x<W;x++){const ax=axis(x,y);if((ax==='h'||ax==='v')&&road(x,y)&&open(x,y))starts.push([x,y]);}
 const count=Math.max(4,Math.min(44,Math.round(starts.length/16*density)));
 const vehicles=[];
 // Cruzar: de todas las salidas legales del cruce (calle o carril de su mano, sin volver por donde vino), una al azar
 // —seguir derecho pesa más—, y el camino por dentro del cruce hasta ella.
 const dirOf=(a,b)=>[b[0]-a[0],b[1]-a[1]];
 function junctionPath(x,y,din,big=false){
  const id=jid[y*W+x],from=[x-din[0],y-din[1]],prev=new Map([[y*W+x,-1]]),q=[y*W+x];
  for(let h=0;h<q.length;h++){const k=q[h],kx=k%W,ky=(k-kx)/W;for(const [dx,dy] of DIRS){const nx=kx+dx,ny=ky+dy,nk=ny*W+nx;if(nx<0||ny<0||nx>=W||ny>=H||jid[nk]!==id||prev.has(nk))continue;prev.set(nk,k);q.push(nk);}}
  const exits=[];
  for(const k of q){const kx=k%W,ky=(k-kx)/W;for(const [dx,dy] of DIRS){const nx=kx+dx,ny=ky+dy;if(nx===from[0]&&ny===from[1])continue;if(!open(nx,ny)||axis(nx,ny)==='j'||!allows(nx,ny,dx,dy)||big&&lane(nx,ny))continue;exits.push({k,exit:[nx,ny],d:[dx,dy],w:dx===din[0]&&dy===din[1]?3:1});}}
  if(!exits.length)return null;
  let pick=r()*exits.reduce((a,e)=>a+e.w,0),e=exits[0];for(const c of exits){pick-=c.w;if(pick<=0){e=c;break;}}
  const cells=[];for(let k=e.k;k>=0;k=prev.get(k))cells.unshift([k%W,Math.floor(k/W)]);cells.push(e.exit);return cells;
 }
 // El paseo de una salida: la polilínea (x, y, z) de ida, la vuelta a la rotonda y el regreso, por la derecha.
 const excPath=exitList.map(e=>{const {P,H,rot:o}=e,pts=[],sideOf=(i,sg)=>{const a=P[Math.max(0,i-1)],b=P[Math.min(P.length-1,i+1)],l=Math.hypot(b[0]-a[0],b[1]-a[1])||1;
   // derecha de la marcha (en x, z con y hacia arriba): (-tz, tx) mirando desde arriba con z hacia la pantalla
   // (a carril/2 del eje, como los carriles del 2D y los de las calles: con 1,05 el auto volvía a la calle de costado)
   return [P[i][0]-(b[1]-a[1])/l*CARRIL/2*sg,P[i][1]+(b[0]-a[0])/l*CARRIL/2*sg];};
  const lift=i=>H[i]+.07*Math.min(1,i/4);
  for(let i=0;i<P.length;i++){const [x,z]=sideOf(i,1);pts.push([x,lift(i),z]);}
  const e0=pts.at(-1),th0=Math.atan2(e0[2]-o.z,e0[0]-o.x),Rd=(o.isla+o.asf)/2,u=[o.x-P.at(-1)[0],o.z-P.at(-1)[1]];
  const back=[];for(let i=P.length-1;i>=0;i--){const [x,z]=sideOf(i,-1);back.push([x,lift(i),z]);}
  const th1=Math.atan2(back[0][2]-o.z,back[0][0]-o.x),far=Math.atan2(u[1],u[0]),norm=a=>Math.atan2(Math.sin(a),Math.cos(a));
  const sg=Math.sign(norm(far-th0))||1;let sweep=norm(th1-th0)*sg;if(sweep<=0)sweep+=Math.PI*2;
  for(let k=1;k<24;k++){const a=th0+sg*sweep*k/24;pts.push([o.x+Math.cos(a)*Rd,o.h+.07,o.z+Math.sin(a)*Rd]);}
  pts.push(...back);const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][2]-pts[i-1][2]));return {pts,cum};});
 // Los tramos que siguen a la trompa: uno, o todos los del cruce más la salida.
 function nextSegs(v){
  const g=v.route[v.route.length-1],cx=g.cx+g.dout[0],cy=g.cy+g.dout[1];
  const ei=exitAt.get(cx+','+cy);if(ei!=null&&!g.exc){const e=exitList[ei],X=excPath[ei];
   return [{cx,cy,din:e.dir,dout:[-e.dir[0],-e.dir[1]],cells:[N*3+ei],offIn:0,offOut:0,exc:X,len:X.cum.at(-1)}];}
  const big=v.type==='bus';
  if(axis(cx,cy)==='j'){const path=junctionPath(cx,cy,g.dout,big);if(path){
   const out=[];for(let i=0;i<path.length;i++){const din=i?dirOf(path[i-1],path[i]):g.dout,last=i===path.length-1;out.push(seg(path[i][0],path[i][1],din,last?choose(path[i][0],path[i][1],din,false,big):dirOf(path[i],path[i+1])));}return out;}}
  return [seg(cx,cy,g.dout,choose(cx,cy,g.dout,false,big))];
 }
 // Poner un vehículo en una calle: una casilla al azar con su sentido, y la ruta que cubre el cuerpo, toda libre.
 // far: lejos de ese punto (para reaparecer sin que el jugador lo vea).
 function place(v,far=null){
  for(let n=0;n<40;n++){
   const big=v.type==='bus',pool=big?starts.filter(([sx,sy])=>!lane(sx,sy)):starts;if(!pool.length)return false;
   const [x,y]=pool[Math.floor(r()*pool.length)],ok_=DIRS.filter(d=>allows(x,y,d[0],d[1])),din=ok_[Math.floor(r()*ok_.length)];if(!din)continue;
   if(far&&Math.hypot((x+.5)*S-far.x,(y+.5)*S-far.z)<45)continue;
   v.route=link([],[seg(x,y,din,choose(x,y,din,false,big))]);let total=v.route[0].len,ok=free(v.route[0].cells,v.id);
   while(ok&&total<v.len+.5){const more=nextSegs(v);if(!more.every(g=>free(g.cells,v.id))){ok=false;break;}v.route.push(...link(v.route,more));total+=more.reduce((a,g)=>a+g.len,0);}
   if(!ok||v.route.some(g=>axis(g.cx,g.cy)==='j'))continue;
   for(const g of v.route)take(g.cells,v.id);Object.assign(v,{s:v.len/2+.01,speed:0,pending:null,wait:0,jam:0,x:(x+.5)*S,z:(y+.5)*S,yaw:Math.atan2(din[0],din[1])});
   return true;
  }
  return false;
 }
 for(let n=0;n<count*3&&vehicles.length<count;n++){
  // Con los modelos cargados, de vez en cuando pasa una patrulla.
  const p=r(),type=p<.47?'car':p<.63?'taxi':p<.68&&models?.Cop?'cop':p<.9?'moto':'bus',m=build(type,r,models),v={...m,type,id:vehicles.length};
  if(!place(v)){for(const o of [m.group])o.traverse(c=>{if(c.userData.own)c.geometry.dispose();});m.tail.dispose();continue;}
  group.add(m.group);vehicles.push(v);
 }

 function pointAt(v,u){
  let acc=0;for(let i=0;i<v.route.length;i++){const g=v.route[i];if(u<=acc+g.len||i===v.route.length-1){
   if(g.exc){const {pts,cum}=g.exc,uu=Math.max(0,Math.min(g.len,u-acc));let j=1;while(j<pts.length-1&&cum[j]<uu)j++;const A=pts[j-1],B=pts[j],t=(uu-cum[j-1])/((cum[j]-cum[j-1])||1);
    return {x:A[0]+(B[0]-A[0])*t,y:A[1]+(B[1]-A[1])*t,z:A[2]+(B[2]-A[2])*t,yaw:Math.atan2(B[0]-A[0],B[2]-A[2]),g};}
   const t=Math.max(0,Math.min(1,(u-acc)/g.len)),q=1-t,c=[(g.cx+.5)*S,(g.cy+.5)*S],a=[c[0]-g.din[0]*S/2,c[1]-g.din[1]*S/2],b=[c[0]+g.dout[0]*S/2,c[1]+g.dout[1]*S/2];
   // (un giro de 90°, 2026-10-16: de carril a carril —la entrada y la salida ya corridas a su carril, y el vértice donde se
   // cruzan los dos—; antes la curva iba por el centro de la casilla y se corría de costado, y en las esquinas se abría
   // sobre la vereda)
   if(g.din[0]*g.dout[0]+g.din[1]*g.dout[1]===0){const A=[a[0]-g.din[1]*g.offIn,a[1]+g.din[0]*g.offIn],B=[b[0]-g.dout[1]*g.offOut,b[1]+g.dout[0]*g.offOut];
    // (el vértice: la línea del carril de entrada —A + s·din— con la de salida —B − r·dout—)
    const K=g.din[0]?[B[0],A[1]]:[A[0],B[1]];
    // (si los dos lados miden igual, un cuarto de círculo de verdad, con centro en A + B − K: a la derecha, la esquina
    // redondeada del cordón —2D: CIRCULACION.vehiculo.esquina—, y el auto va a carril/2 de ella todo el giro)
    const la=Math.hypot(K[0]-A[0],K[1]-A[1]),lb=Math.hypot(B[0]-K[0],B[1]-K[1]);
    if(la>.1&&Math.abs(la-lb)<.05){const O=[A[0]+B[0]-K[0],A[1]+B[1]-K[1]],a0=Math.atan2(A[1]-O[1],A[0]-O[0]),a1=Math.atan2(B[1]-O[1],B[0]-O[0]);let da=a1-a0;if(da>Math.PI)da-=2*Math.PI;if(da<-Math.PI)da+=2*Math.PI;
     const an=a0+da*t,x=O[0]+Math.cos(an)*la,z=O[1]+Math.sin(an)*la,sg=Math.sign(da);return {x,z,yaw:Math.atan2(-Math.sin(an)*sg,Math.cos(an)*sg),g};}
    const tx=2*q*(K[0]-A[0])+2*t*(B[0]-K[0]),tz=2*q*(K[1]-A[1])+2*t*(B[1]-K[1]);
    return {x:q*q*A[0]+2*q*t*K[0]+t*t*B[0],z:q*q*A[1]+2*q*t*K[1]+t*t*B[1],yaw:Math.atan2(tx,tz),g};}
   let tx=2*q*(c[0]-a[0])+2*t*(b[0]-c[0]),tz=2*q*(c[1]-a[1])+2*t*(b[1]-c[1]);if(Math.abs(tx)+Math.abs(tz)<1e-4){tx=g.dout[0];tz=g.dout[1];}
   // Por la derecha: corrido hacia la derecha del sentido de marcha (lo que diga el carril en cada borde).
   const off=g.offIn*(1-t)+g.offOut*t,n=Math.hypot(tx,tz)||1,fx=tx/n,fz=tz/n;
   // (si el corrimiento cambia en el tramo —de un carril a otro—, el auto mira hacia donde va, no de costado)
   const so=(g.offOut-g.offIn)/(g.len||S),hx=fx-fz*so,hz=fz+fx*so;
   return {x:q*q*a[0]+2*q*t*c[0]+t*t*b[0]-fz*off,z:q*q*a[1]+2*q*t*c[1]+t*t*b[1]+fx*off,yaw:Math.atan2(hx,hz),g};}
   acc+=g.len;}
 }
 const routeLen=v=>v.route.reduce((a,g)=>a+g.len,0);

 function update(dt,{player,people=[]}){
  // La sirena de las patrullas destella (más fuerte de noche).
  sharedParts().siren.emissiveIntensity=(night?2.6:.7)*(Math.sin(performance.now()/150)>0?1:.12);
  // los semáforos: el ciclo, y las luces de cada eje
  reloj+=dt;for(const eje of ['h','v']){const L=luz(reloj,eje).luz;for(const c in luces[eje]||{})luces[eje][c].opacity=c===L?1:.12;}
  for(const v of vehicles){
   // Reservar por delante lo que haría falta para frenar con la cómoda, más la línea de pare y un margen (así ve el
   // semáforo antes de tener que frenar).
   const reach=v.speed*v.speed/(2*TRANSITO.frena.comoda)+TRANSITO.linea+2;v.rojo=null;
   // (un cruce con semáforo ya reservado —se reserva de lejos— se vuelve a mirar hasta la línea de pare: si se puso en rojo,
   // o en amarillo y puede parar, suelta el cruce y lo que sigue y se para en la línea; con amarillo y sin poder parar se
   // compromete —v.cruza— y ya no lo mira más)
   {const front0=v.s+v.len/2;let acc=0;for(let i=0;i<v.route.length;i++){const g=v.route[i];
     if(!g.exc&&axis(g.cx,g.cy)==='j'&&semaforo(g.cx,g.cy)&&i>0&&!(axis(v.route[i-1].cx,v.route[i-1].cy)==='j')){const key=g.cx+','+g.cy,dLinea=acc-TRANSITO.linea-front0;
      if(acc>front0){const L=luz(reloj,g.din[0]?'h':'v'),frenaMax=v.speed*v.speed/(2*TRANSITO.frena.maxima);
       // (en rojo para siempre que le dé la frenada máxima: antes de la línea si todavía no llegó, si no en el borde del
       // cruce —sobre la cebra—, aunque se hubiera comprometido con el amarillo y el cruce ocupado lo demorara; con
       // amarillo, sólo antes de la línea)
       const para=L.luz==='rojo'&&frenaMax<=(dLinea>-.5?Math.max(0,dLinea)+PISA:acc-front0)||L.luz==='amarillo'&&dLinea>-.5&&v.cruza!==key&&amarillo(v.speed,Math.max(0,dLinea),L.resta)==='para';
       if(para){for(const h of v.route.splice(i))drop(h.cells,v.id);v.pending=null;}else if(L.luz==='amarillo'&&dLinea>-.5)v.cruza=key;}
      break;}
     acc+=g.len;}}
   let end=routeLen(v),blocked=false;
   while(v.s+v.len/2+reach>end){
    const more=v.pending||(v.pending=nextSegs(v));
    // (entrar a un cruce con semáforo: con rojo, o con amarillo si puede parar, se queda en la línea de pare; ya pasada
    // la línea —sobre la cebra—, sigue)
    const j=more[0];if(j&&!j.exc&&axis(j.cx,j.cy)==='j'&&semaforo(j.cx,j.cy)){const L=luz(reloj,j.din[0]?'h':'v'),dLinea=end-(v.s+v.len/2)-TRANSITO.linea;
     if(dLinea>-.5&&(L.luz==='rojo'||L.luz==='amarillo'&&amarillo(v.speed,Math.max(0,dLinea),L.resta)==='para')){v.rojo={linea:end-TRANSITO.linea};blocked=true;break;}
     // (ya sobre la cebra y en rojo: espera el verde en el borde del cruce —si le da la frenada—)
     if(dLinea<=-.5&&L.luz==='rojo'&&v.speed*v.speed/(2*TRANSITO.frena.maxima)<=end-(v.s+v.len/2)){v.rojo={linea:end};blocked=true;break;}
     if(L.luz==='amarillo')v.cruza=j.cx+','+j.cy;}
    if(!more.every(g=>free(g.cells,v.id))){blocked=true;break;}
    for(const g of more)take(g.cells,v.id);v.route.push(...link(v.route,more));v.pending=null;end+=more.reduce((a,g)=>a+g.len,0);
   }
   // Trabado mucho rato esperando lo mismo: probar otra salida.
   // A quién espera (los dueños de las casillas que le faltan). Esperar detrás de alguien que da paso a un peatón es una
   // fila, no un tranque; sólo cuenta si la espera vuelve sobre sí misma (A espera a B, que espera… a A).
   v.waitIds=blocked?[...new Set(v.pending.flatMap(g=>g.cells).map(c=>owner[c]).filter(o=>o>=0&&o!==v.id))]:[];
   const deadlock=()=>{const seen=new Set(),stack=[...v.waitIds];while(stack.length){const o=stack.pop();if(o===v.id)return true;if(seen.has(o))continue;seen.add(o);stack.push(...(vehicles[o].waitIds||[]));}return false;};
   if(blocked&&!v.rojo&&v.speed<.2){if((v.wait+=dt)>6){v.pending=null;v.wait=0;}if(deadlock())v.jam+=dt;else v.jam=0;}else{v.wait=0;v.jam=0;}// (esperar el verde no es un tranque)
   // Si igual se arma un anillo trancado, el que lleva mucho esperando se va y reaparece en otra calle, lejos del
   // jugador.
   if(v.jam>8){const keep=v.route;for(const g of keep)drop(g.cells,v.id);if(!place(v,player||{x:-1e9,z:-1e9})){v.route=keep;for(const g of keep)take(g.cells,v.id);v.jam=0;}continue;}
   // Velocidad: hasta el final de lo reservado, la gente (y el jugador) de adelante, y más despacio en las curvas.
   // (lo que limita, cada cosa a su distancia —objetivo: lo que deja llegar a ella frenando—: el final de lo reservado, la
   // línea de pare en rojo, cada curva por delante a su velocidad de giro, la entrada a un cruce sin semáforo y el paseo)
   const front=v.s+v.len/2,room=end-front,cola=v.s-v.len*.36,lim=[{d:room-.4,v:0}];if(v.rojo)lim.push({d:v.rojo.linea-front-.3,v:0});
   {let acc=0,prevJ=false;for(const g of v.route){const d=acc-front;if(acc+g.len>cola){// (mientras la curva esté bajo el cuerpo —hasta las ruedas de atrás—, a su velocidad)
     if(g.exc)lim.push({d,v:5.5});else if(isTurn(g))lim.push({d,v:curva(g.radio??S/2)});
     const enJ=!g.exc&&axis(g.cx,g.cy)==='j';if(enJ&&!prevJ&&!semaforo(g.cx,g.cy)&&d>-.5&&acc+g.len>front)lim.push({d,v:TRANSITO.ceda});}
    prevJ=!g.exc&&axis(g.cx,g.cy)==='j';acc+=g.len;}}
   let target=objetivo(v.speed,v.vmax,lim,dt);
   const here=pointAt(v,v.s),fx=Math.sin(here.yaw),fz=Math.cos(here.yaw);
   const look=(ox,oz,half,w2)=>{const rx=ox-v.x,rz=oz-v.z,along=rx*fx+rz*fz;if(along<=0||along>18)return;if(Math.abs(rx*fz-rz*fx)>v.wid/2+w2)return;const g=along-v.len/2-half;target=Math.min(target,g<1.2?0:v.vmax*(g-1.2)/9);};
   for(const p of people)look(p.x,p.z,.3,.55);if(player)look(player.x,player.z,.35,.6);
   v.speed=paso(v.speed,target,dt);
   v.s=Math.min(v.s+v.speed*dt,end-v.len/2);
   // Soltar lo que la cola ya dejó atrás.
   // (con 1,2 m de margen: al doblar, la cola de un vehículo largo se abre hacia atrás)
   while(v.route.length>1&&v.s-v.len/2-1.2>v.route[0].len){const g=v.route.shift();v.s-=g.len;drop(g.cells,v.id);}
   // Trompa y cola sobre el camino (como las ruedas de adelante y de atrás): al doblar, el cuerpo corta la curva como
   // un vehículo de verdad y no se sale de su carril.
   const fr=pointAt(v,v.s+v.len*.36),bk=pointAt(v,v.s-v.len*.36);
   v.x=(fr.x+bk.x)/2;v.z=(fr.z+bk.z)/2;v.yaw=Math.atan2(fr.x-bk.x,fr.z-bk.z);v.y=((fr.y||0)+(bk.y||0))/2;
   // En la avenida de afuera sube y baja con ella (cabecea con la pendiente).
   v.group.position.set(v.x,v.y,v.z);v.group.rotation.set(fr.y!=null||bk.y!=null?-Math.atan2((fr.y||0)-(bk.y||0),v.len*.72):0,v.yaw,0,'YXZ');
   if(player){const cerca=Math.hypot(v.x-player.x,v.z-player.z)<SOMBRA;if(v.sombra!==cerca){v.sombra=cerca;v.group.traverse(o=>{if(o.isMesh&&o!==v.cone)o.castShadow=cerca;});}}
   const braking=target<v.speed-.3||v.speed<.3;v.tail.emissiveIntensity=braking?(night?3.2:1.6):(night?1.2:.15);
  }
 }
 let night=false;
 const SOMBRA=70;// (m del jugador: hasta dónde un vehículo da sombra)
 function setNight(on){night=on;const P=sharedParts();P.head.emissiveIntensity=on?3.5:.2;P.sign.emissiveIntensity=on?1.4:.3;for(const v of vehicles)v.cone.visible=on;}
 // El jugador no atraviesa un vehículo: se mira en el marco del vehículo (a lo largo y de costado).
 function blocks(x,z,rad){for(const v of vehicles){const fx=Math.sin(v.yaw),fz=Math.cos(v.yaw),rx=x-v.x,rz=z-v.z;if(Math.abs(rx*fx+rz*fz)<v.len/2+rad&&Math.abs(rx*fz-rz*fx)<v.wid/2+rad)return true;}return false;}
 // Si un vehículo quedó encima del jugador (al doblar barre la vereda), lo corre hacia afuera por el lado más corto.
 function pushOut(x,z,rad){
  for(const v of vehicles){const fx=Math.sin(v.yaw),fz=Math.cos(v.yaw),rx=x-v.x,rz=z-v.z,al=rx*fx+rz*fz,lat=rx*fz-rz*fx,ea=v.len/2+rad-Math.abs(al),el=v.wid/2+rad-Math.abs(lat);
   if(ea<=0||el<=0)continue;
   if(el<ea){const d=(lat>=0?1:-1)*(el+.02);x+=fz*d;z+=-fx*d;}else{const d=(al>=0?1:-1)*(ea+.02);x+=fx*d;z+=fz*d;}}
  return {x,z};
 }
 const positions=()=>vehicles.map(v=>({x:v.x,z:v.z,yaw:v.yaw,len:v.len,wid:v.wid,type:v.type}));
 function dispose(){group.traverse(o=>{if(o.userData.own){o.geometry.dispose();}});for(const v of vehicles)v.tail.dispose();}
 return {group,update,setNight,blocks,pushOut,positions,dispose,vehicles,debug:{allows,axis,drive:open,choose,segs,owner,semaforo,get reloj(){return reloj;},luz:eje=>luz(reloj,eje).luz}};
}
