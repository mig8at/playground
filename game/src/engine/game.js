/* Copia en módulo ES de lab/game.js (FUGA, 2026-10-06); la lógica es la misma, sólo cambia cómo se exporta.
   Motor determinista compartido por el navegador y las pruebas sin interfaz. */
import CityModule from './ciudad.js';
import {planMap} from './plano.js';
const Lab=(function(City){
'use strict';
// Tamaño de los mapas fijos; cada mapa trae el suyo (map.W, map.H), y las ciudades son más grandes o más chicas.
const W=41,H=29,DT=1/30;
const DEFAULTS={duration:240,quota:3,copSpeed:3.05,thiefSpeed:3.2,carrySpeed:2.5,batRange:.85,windup:.4,recovery:1.3,miss:.4,stun:4,arrest:.7,vault:8,pickup:1.6,rescue:3,jail:30,grace:3,vision:8,hearing:0,stash:1,lockdown:0,lockdownDelay:0,decoy:0,force:0,sleep:0,sleepHold:1.5,crowd:0,drone:0,boss:0,heists:0};
// En una ciudad la policía pierde al ladrón en cada esquina: ahí se oye a quien corre o carga botín (ver perceive) y
// esconder el botín toma tiempo. Valores medidos con lotes de bots en ciudades de los cuatro tamaños (2026-10-06).
const CITY_DEFAULTS={hearing:10,stash:3};
// lockdown (prueba del núcleo, 2026-10-07): con un valor mayor que 0, la policía no puede entrar a un objetivo mientras su
// alarma no suene; lo cuida desde la calle, frente a sus puertas. La alarma suena cuando se abre la bóveda y cada vez
// que alguien saca una bolsa, y sigue sonando «lockdown» segundos después. Un policía que ya está adentro cuando la
// alarma se apaga puede moverse y salir, pero no volver a entrar. Sólo en ciudades. 0 = como siempre.
// decoy (prueba de la distracción, 2026-10-07): segundos que tarda un ladrón en forzar la puerta de un objetivo para
// hacer ruido (0 = no se puede). El ruido llama a la policía a las puertas de ese objetivo (como su alarma, pero sin
// abrirlo), la policía que lo oye puede ir a revisarlo (candidato 'investigate') y sabe dónde está quien lo hizo: distraer arriesga a ese ladrón. Cada ladrón puede
// hacerlo una vez cada DECOY_COOLDOWN segundos. Los bots: el ladrón de rol 1 se ubica en la puerta de OTRO objetivo y
// hace ruido cuando sus compañeros abren la bóveda del que roban o sacan sus bolsas (distraer en la entrada no sirve: con más puertas que
// policías siempre hay una libre; lo que pierde la ronda es la policía que llega con la alarma).
// force (prueba de «entrar no es gratis», 2026-10-07): las puertas de los objetivos están cerradas para los ladrones y
// forzar una toma «force» segundos, parado en la calle frente a ella. Al abrirse hace ruido, que oye la policía cercana
// (a 2 × hearing, 12 casillas como mínimo), y la puerta queda abierta el resto de la ronda. La policía tiene llave: no
// la frenan. Sólo en ciudades. 0 = puertas abiertas, como siempre.
// Medido en 3 contra 3 con lockdown 10 y demora 3 (240 rondas, ±6): con las puertas abiertas los ladrones ganan el 43 %;
// forzando 2 s, 26 %; en silencio (tuning.forceSilent), 25 %; si el forzado avisaba a toda la policía por la central,
// 16 %. «Hacer ruido» (decoy) no cambió el resultado en ninguno de los tres casos.
// sleep (prueba de «dormir a un policía», 2026-10-07): un ladrón que llega por la espalda de un policía (fuera de su
// frente: más de 100° de hacia dónde mira) y lo sujeta «sleepHold» segundos lo duerme «sleep» segundos. Si el policía
// se da vuelta, se corta. Con la regla encendida, el policía no ve a su espalda (visibleEnemies). Un compañero lo despierta en 1 s, y un policía dormido es una pista: la central avisa a los
// demás dónde está el ladrón. Vale en todos los mapas. 0 = no se puede.
// Medido en 3 contra 3 (240 rondas, ±6): en las ciudades de siempre, sleep 12 da 48 % (sin la regla, 45 %) y las rondas
// que terminan por tiempo bajan de 30 % a 13 %. En el modo puertas cerradas, sleep 10 da 57 / 50 / 52 / 57 % en 2, 3,
// 5 y 8 contra 8, y las rondas por tiempo bajan de 37 / 48 / 55 / 55 % a 32 / 41 / 47 / 43 %.
// crowd (prueba de «ladrones entre la gente», 2026-10-07): ciudadanos (NPC) por jugador. Caminan por la calle entre
// puntos al azar (y frentes de objetivos, escondites y plazas), a la velocidad de un ladrón caminando, con pausas.
// Con gente en la calle, la policía no distingue a un ladrón que camina tranquilo con algún ciudadano a menos de
// BLEND casillas. Lo identifica si lo ve correr, llevar una bolsa, trabajar (forzar, abrir, recoger, dormir, hacer
// ruido, rescatar, esconder) o andar solo; y lo sigue reconociendo mientras no lo pierda de vista (KEEP s). Los bots
// policía sólo actúan sobre ladrones identificados; una persona que golpea a un ciudadano queda suspendida
// INNOCENT_PENALTY s. La central ve desde arriba: cada 2 s marca a la policía dónde hay alguien delatándose (va a
// buscar ahí; al llegar tiene que identificarlo). Sólo en ciudades. 0 = sin gente.
// drone (2026-10-07): segundos de vista satelital (0 = sin ella). Cada jugador de los dos equipos la tiene; ver
// flyDrone. Con ella no hay central: la policía ve sólo lo que alcanzan sus vistas. Los bots: los ladrones miran un
// objetivo que nadie miró en 20 s (primero el de la banda) y eligen el objetivo con menos policías conocidos; la
// policía, el objetivo o escondite más lejos de sus compañeros. Uno por equipo a la vez.
// Medido con el modo completo (240 rondas por tamaño, ±6): 55 / 56 / 50 / 54 % de victorias de ladrones en 2, 3, 5 y
// 8 contra 8, con las bolsas de CROWD_QUOTA + DRONE_EXTRA_BAGS.
// boss (prueba de «los jefes», idea de Miguel, 2026-10-09; IDEAS.md 0b): cada equipo tiene un jefe y sólo los jefes
// vuelan el dron. El jefe de los ladrones no roba: se esconde entre la gente y vuela el dron (quieto mientras vuela).
// La policía gana si lo encarcela; los ladrones, con el botín; si se acaba el tiempo, la policía. Cada ladrón que cae
// preso da una pista verdadera sobre dónde está su jefe en ese momento: elige entre una vaga, una media y una precisa
// (los bots eligen la vaga; con tuning.clueChoice 'azar', una al azar, como quien no elige a tiempo). La policía busca
// en la zona que dejan las pistas recientes, y el jefe de policía la mira con el dron. 0 = como siempre.
// lockdownDelay: segundos entre que suena la alarma y que la policía puede entrar (ventaja de los ladrones). Con los
// ladrones eligiendo la puerta menos cuidada (entryDoor) y la salida (candidatos 'exit'), lockdown 10 y lockdownDelay 3
// con 2 puertas por objetivo dan 56 / 43 / 57 / 59 % en 2, 3, 5 y 8 contra 8 (240 rondas por tamaño, ±6).
// Medido en 3 contra 3 (240 rondas en 24 ciudades, ±6): si la alarma sonaba mientras se trabaja la bóveda, los ladrones
// ganaban el 3 %; sonando al abrirla, 16 %; y si no corren a entrar todos los policías (tuning.respond, 100), 26 % con
// 2 puertas por objetivo y 40 % con 3. Sin la regla: 45 % (2 puertas), 53 % (3) y 60 % (4).
// Bolsas y reloj por tamaño de equipo, con la cuota 3 y los 240 s por defecto (otros valores escalan en proporción).
// Medidos con lotes de bots, 240 rondas en 24 ciudades por tamaño (±6), con edificios con habitaciones y objetivos y
// comisaría con interior (2026-10-06). Con los interiores robar toma más (hay que llegar a la bóveda y abrirla desde el
// salón): con 10 bolsas en 5 contra 5 y 14 en 8 contra 8 los ladrones ganaban el 31 % y el 28 %; con 9 y 12 quedan en
// 50 % y 49 %. 2 y 3 contra 2 y 3 quedan en 46 % y 45 % sin cambios.
const CITY_QUOTA={2:4,3:6,5:9,8:12};
// Con puertas cerradas (force > 0) se roba más lento: menos bolsas. Con 2 puertas por objetivo, lockdown 10,
// lockdownDelay 3 y force 2, los bots quedan en 46 / 44 / 44 / 44 % de victorias de ladrones (240 rondas por tamaño, ±6;
// 2026-10-07). Con las bolsas de CITY_QUOTA, 3 contra 3 daba 26 %.
const LOCKED_QUOTA={2:4,3:5,5:8,8:10};
// Con gente en la calle (crowd > 0) los ladrones se escapan mejor y hacen falta más bolsas, sobre todo en las ciudades
// grandes. Con puertas cerradas, dormir 10, 3 ciudadanos por jugador y la central (2026-10-07; 240 rondas, ±6): con
// las bolsas de CITY_QUOTA, 55 / 50 / 74 / 85 %; con 11 en 5 contra 5, 55 %; con 15 en 8 contra 8, 59 %.
const CROWD_QUOTA={2:4,3:6,5:11,8:16};
// Con vista satelital para los dos equipos (sin central), 2 contra 2 necesita una bolsa más y 8 contra 8 una menos
// (con 16 daba 42 %; con 15, 54 %).
const DRONE_EXTRA_BAGS={2:1,3:0,5:0,8:-1};
const CITY_CLOCK={2:155,3:240,5:309,8:390};
const MAPS=[{id:'barrio',name:'Barrio · rutas dobles'},{id:'anillos',name:'Anillos · patios conectados'},{id:'pasillos',name:'Pasillos · más escondites'}];
const COP_NAMES=['Nube','Menta','Lila','Brisa','Coco','Lima','Perla','Tomi'],THIEF_NAMES=['Chispa','Mochi','Pipo','Bombón','Kiwi','Fideo','Gomi','Lulo'];
function rng(seed){let n=seed>>>0;return()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
// Gusto estable de cada bot por cada opción (panel, escape, bolsa, cruce…): la semilla cambia el plan de los dos equipos
// sin que el bot oscile entre decisiones, y no depende del orden en que se evalúan las opciones.
const WHIM=10;
function preference(g,a,optionId){let h=Math.imul(g.seed>>>0,0x9E3779B1)>>>0;for(const ch of a.id+'|'+optionId)h=Math.imul(h^ch.charCodeAt(0),0x01000193)>>>0;return (rng(h)()*2-1)*(g.tuning.whim??WHIM);}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),point=(x,y)=>({x:x+.5,y:y+.5});
const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];

// ---------- Mapas ----------
// Todos los mapas comparten un formato: tamaño, grilla, una lista de objetivos de robo (cada uno con sus paneles para
// abrirlo, sus bolsas, sus puntos de guardia y, si tiene, la puerta que queda cerrada hasta abrirlo), los lugares de
// entrega, la cárcel con sus paneles de rescate, las salidas de cada equipo y los puntos de patrulla.
// gen cambia cómo se genera una ciudad (gen.buildings: 'rooms', por defecto, 'entrances' o 'solid'); en el id, el sufijo
// «:entradas» pide edificios con tres entradas simples y «:macizos», edificios macizos; «:puertas3» o «:puertas4», más
// puertas en cada objetivo.
const PLANES=new Map();
function buildMap(id,gen={}){
 // «plan:<jugadores>:<semilla>»: la ciudad por etapas (blueprint.js), con paredes en los bordes de cada lote (plano.js).
 // (guardado: generarlo tarda ~1 s y las partidas lo leen sin cambiarlo, salvo el hangar de «Golpes», que se rehace)
 if(/^plan:\d+:\d+(:edificios)?$/.test(id)){if(!PLANES.has(id))PLANES.set(id,planMap(id));return PLANES.get(id);}
 if(/^city:\d+:\d+(:entradas|:macizos)?(:puertas\d)?(:parques)?$/.test(id))return cityMap(id,gen);
 const grid=Array.from({length:H},(_,y)=>Array.from({length:W},(_,x)=>x===0||y===0||x===W-1||y===H-1?1:0));
 const wall=(x,y)=>{if(x>0&&x<W-1&&y>0&&y<H-1)grid[y][x]=1;};
 const door=(x,y)=>grid[y][x]=0;
 const fill=(x,y,w,h)=>{for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)wall(xx,yy);};
 const box=(x,y,w,h,doors=[])=>{for(let xx=x;xx<x+w;xx++){wall(xx,y);wall(xx,y+h-1);}for(let yy=y;yy<y+h;yy++){wall(x,yy);wall(x+w-1,yy);}for(const d of doors)door(...d);};
 const v=(x,y1,y2,holes)=>{for(let y=y1;y<=y2;y++)if(!holes.includes(y))wall(x,y);};
 const h=(y,x1,x2,holes)=>{for(let x=x1;x<=x2;x++)if(!holes.includes(x))wall(x,y);};
 box(14,2,13,9,[[16,10],[24,10]]);box(18,3,5,4,[[20,6]]);
 box(2,13,8,7,[[9,16],[6,19]]);
 box(2,2,9,8,[[5,9],[10,6]]);box(30,2,9,8,[[35,9],[30,6]]);
 v(12,2,8,[5]);v(28,2,8,[5]);
 // «gen:<n>» genera el barrio de abajo a partir de n; banco, cárcel, escapes y salidas quedan donde están.
 const generated=/^gen:\d+$/.test(id);
 if(generated)generateDistrict(grid,wall,Number(id.slice(4)));
 else{
  v(11,14,24,[17,22]);v(21,12,25,[15,23]);v(30,14,24,[17,22]);
  h(22,2,9,[5]);h(23,13,19,[17]);h(20,23,29,[27]);h(22,32,38,[35]);
  if(id==='anillos'){
   // Dos anillos macizos con pasillo alrededor: el perseguido puede dar vueltas y cortar la línea de visión del bate.
   fill(15,15,4,5);fill(33,14,4,5);
  }else if(id==='pasillos'){
   v(15,13,21,[16,20]);v(18,15,22,[18]);v(25,12,18,[14,17]);v(35,12,20,[15,18]);
   h(24,2,10,[4,8]);h(25,13,19,[15,18]);h(24,32,38,[34,37]);
  }else{
   h(16,14,18,[16]);v(26,13,17,[15]);h(18,33,37,[35]);
  }
 }
 const vaultDoor=point(20,6),panels=[point(16,8),point(24,8)],bagSpawns=[point(19,4),point(20,4),point(21,4),point(19,5),point(21,5)];
 const allPatrol=[point(16,11),point(24,11),point(20,8),point(12,12),point(29,12),point(12,21),point(29,24),point(38,11),point(2,11),point(17,26),point(25,26)];
 const patrol=generated?allPatrol.filter(p=>!grid[Math.floor(p.y)][Math.floor(p.x)]):allPatrol;
 const lockAt=new Uint8Array(W*H);lockAt[6*W+20]=1;
 return {id,name:generated?'Generado #'+id.slice(4):MAPS.find(m=>m.id===id)?.name||MAPS[0].name,W,H,grid,team:3,lockAt,vaultDoor,panels,bagSpawns,
  sites:[{id:'banco',name:'Banco',panels,bagSpawns,lock:vaultDoor,center:vaultDoor,guards:[allPatrol[0],allPatrol[1]],alarmLabel:'ALARMA EN EL BANCO',
   panelLabels:['Abrir bóveda por vestíbulo','Abrir bóveda por oficinas'],guardLabels:['Vigilar entrada oeste del banco','Vigilar entrada este del banco'],
   openLog:'¡Bóveda abierta! Las bolsas ya se pueden sacar.',returnLog:'devolvió una bolsa al banco.'}],
  deliveries:[{...point(3,26),id:'oeste',name:'Escape oeste'},{...point(37,26),id:'este',name:'Escape este'}],deliveryLabel:'ESCAPE',
  rescuePanels:[{...point(10,16),exit:point(10,17),name:'Acceso lateral'},{...point(6,20),exit:point(6,21),name:'Acceso sur'}],
  jailCells:[point(4,15),point(6,15),point(4,17)],
  thiefSpawns:[point(6,26),point(20,26),point(34,26)],copSpawns:[point(12,11),point(28,11),point(20,16)],
  patrol,zones:[{x:14.2,y:2.2,w:12.6,h:8.6,label:'BANCO',kind:'bank'},{x:18.2,y:3.2,w:4.6,h:3.6,label:'BÓVEDA',kind:'vault'},{x:2.2,y:13.2,w:7.6,h:6.6,label:'CÁRCEL',kind:'jail'}]};
}
// Barrio generado: piezas al azar (manzanas, muros, esquinas en L y muros largos con huecos que lo parten en
// manzanas) en la mitad este, reflejadas al oeste para que
// los dos escapes queden parejos. Se respetan la calle bajo el banco, la cárcel y sus accesos, la calle de salida,
// los escapes y la salida central de la policía. Al final, todo bolsillo cerrado se rellena.
function generateDistrict(grid,wall,n){
 const r=rng((Math.imul(n,0x2C1B3C6D)^0x5BD1E995)>>>0);
 const keep=(x,y)=>y<=12||y>=26||(x<=11&&y<=21)||(Math.abs(x-3)<=2&&y>=24)||(Math.abs(x-37)<=2&&y>=24)||(Math.abs(x-20)<=1&&Math.abs(y-16)<=1);
 const put=(x,y)=>{for(const xx of [x,W-1-x])if(xx>0&&xx<W-1&&!keep(xx,y))wall(xx,y);};
 const pieces=6+Math.floor(r()*5);
 for(let i=0;i<pieces;i++){
  const x=20+Math.floor(r()*19),y=13+Math.floor(r()*13),kind=r();
  if(kind<.25){const w=2+Math.floor(r()*4),h=2+Math.floor(r()*3);for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)put(xx,yy);}
  else if(kind<.45){const len=3+Math.floor(r()*6);for(let xx=x;xx<x+len;xx++)put(xx,y);}
  else if(kind<.65){const len=3+Math.floor(r()*5);for(let yy=y;yy<y+len;yy++)put(x,yy);}
  else if(kind<.75){const a=3+Math.floor(r()*3),b=3+Math.floor(r()*2);for(let xx=x;xx<x+a;xx++)put(xx,y);for(let yy=y;yy<y+b;yy++)put(x,yy);}
  else{
   const vertical=r()<.5,len=7+Math.floor(r()*7),gaps=new Set([1+Math.floor(r()*(len-2))]);if(len>9)gaps.add(1+Math.floor(r()*(len-2)));
   for(let j=0;j<len;j++)if(!gaps.has(j))vertical?put(x,13+j):put(x+j-Math.floor(len/2),y);
  }
 }
 const seen=new Uint8Array(W*H),queue=[20+26*W];seen[queue[0]]=1;
 for(let i=0;i<queue.length;i++){const q=queue[i],x=q%W,y=(q-x)/W;for(const [dx,dy] of DIRS){const k=(y+dy)*W+x+dx;if(!seen[k]&&!grid[y+dy][x+dx]){seen[k]=1;queue.push(k);}}}
 for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++)if(!grid[y][x]&&!seen[y*W+x])grid[y][x]=1;
}
// «city:<jugadores por equipo>:<semilla>»: una ciudad de lab/ciudad.js puesta en el formato del motor. Cada objetivo
// se abre en su panel (adentro) y se vigila desde la calle frente a sus puertas; el botín se entrega en cualquier
// escondite; la cárcel está dentro de la comisaría y se rescata desde sus paneles de afuera.
function cityMap(id,gen={}){
 if(!City)throw new Error('Para jugar ciudades hace falta lab/ciudad.js.');
 const parts=id.split(':'),team=Number(parts[1]),seed=Number(parts[2]),buildings=gen.buildings||(parts.includes('macizos')?'solid':parts.includes('entradas')?'entrances':'rooms');
 // «:puertas3» (o tuning.cityGen.siteDoors): cuántas puertas a la calle tiene cada objetivo con interior (por defecto 2).
 const siteDoors=gen.siteDoors||Number((parts.find(p=>/^puertas\d$/.test(p))||'').slice(7))||undefined;
 // «:parques» (o tuning.cityGen.parks): parques repartidos por zonas en vez de plazas sorteadas (prueba del 2026-10-09).
 const parks=!!(gen.parks||parts.includes('parques'));
 const c=City.generate({seed,team,buildings,siteDoors,parks});
 const copy=p=>({x:p.x,y:p.y});
 const outside=(d,b)=>{const x=Math.floor(d.x),y=Math.floor(d.y);return point(x+(x===b.x0?-1:x===b.x1?1:0),y+(y===b.y0?-1:y===b.y1?1:0));};
 const sites=c.sites.map(s=>{
  // Con interior, los paneles son los del salón frente a la bóveda; si no, dos puntos del botín.
  const panels=(s.panels?.length?s.panels:[s.loot[0],s.loot[s.loot.length-1]]).filter((p,i,all)=>p&&all.indexOf(p)===i).map(copy),guards=s.doors.map(d=>outside(d,s.block));
  return {id:s.id,name:s.name,panels,bagSpawns:s.loot.map(copy),lock:null,center:{x:s.x,y:s.y},guards,alarmLabel:`ALARMA EN ${s.name.toUpperCase()}`,
   panelLabels:panels.map((_,i)=>`Abrir ${s.name} (panel ${i+1})`),guardLabels:guards.map((_,j)=>`Vigilar la puerta ${j+1} de ${s.name}`),
   openLog:`Se abrió ${s.name}. Ya se pueden sacar sus bolsas.`,returnLog:`devolvió una bolsa a ${s.name}.`};
 });
 const st=c.station,stationDoors=st.doors.map(d=>outside(d,st.block));
 const panels=st.rescuePanels.length?st.rescuePanels:stationDoors;
 const rescuePanels=panels.map((p,i)=>({x:p.x,y:p.y,exit:copy(p),name:i?'Acceso trasero':'Acceso lateral'}));
 const deliveries=c.hideouts.map(h=>({x:h.x,y:h.y,id:h.id,name:h.name}));
 const jail=st.jail.length?st.jail.map(copy):[{x:st.x,y:st.y}];
 const zone=(b,label,kind)=>({x:b.x0+.2,y:b.y0+.2,w:b.w-.4,h:b.h-.4,label,kind});
 const xs=jail.map(p=>p.x),ys=jail.map(p=>p.y);
 return {id,name:`Ciudad #${seed} · ${team} vs ${team}${buildings==='solid'?' · edificios macizos':buildings==='entrances'?' · tres entradas':''}${siteDoors?` · ${siteDoors} puertas por objetivo`:''}${parks?' · parques':''}`,buildings,W:c.W,H:c.H,grid:c.grid,kind:c.kind,K:City.K,houses:c.houses,names:c.names,blocks:c.blocks,team,city:true,lockAt:null,sites,deliveries,deliveryLabel:'ESCONDITE',
  rescuePanels,jailCells:jail,siteDoors:siteDoors||null,doorAt:(()=>{const at=new Int16Array(c.W*c.H);c.sites.forEach((s,i)=>s.doors.forEach((d,j)=>{at[Math.floor(d.y)*c.W+Math.floor(d.x)]=i*16+j+1;}));return at;})(),siteAt:(()=>{const at=new Int8Array(c.W*c.H);c.sites.forEach((s,i)=>{const b=s.block;for(let y=b.y0;y<=b.y1;y++)for(let x=b.x0;x<=b.x1;x++)at[y*c.W+x]=i+1;});return at;})(),thiefSpawns:c.thiefSpawns.map(copy),copSpawns:c.copSpawns.map(copy),
  patrol:[...sites.flatMap(s=>s.guards),...deliveries.map(copy),...rescuePanels.map(copy)],
  zones:[...c.sites.map(s=>zone(s.block,s.name.toUpperCase(),'site')),zone(st.block,'COMISARÍA','station'),
   {x:Math.min(...xs)-.45,y:Math.min(...ys)-.45,w:Math.max(...xs)-Math.min(...xs)+.9,h:Math.max(...ys)-Math.min(...ys)+.9,label:'',kind:'jail'}]};
}

// ---------- Partida ----------
function makeGame(options={}){
 const mapId=options.map||'pasillos',isCity=/^city:/.test(mapId);
 // tuning cambia, para una prueba, lo que normalmente es fijo: reglas propias de la ciudad (cityRules), las tablas de
 // cuota y reloj por tamaño (cityQuota, cityClock), cómo se genera la ciudad (cityGen) y el gusto de los bots (whim).
 // Sin tuning, todo queda como está.
 const tuning=options.tuning||{};
 const rules={...DEFAULTS,...(isCity?{...CITY_DEFAULTS,...tuning.cityRules}:{}),...options.rules};for(const k of Object.keys(DEFAULTS)){if(!Number.isFinite(rules[k]))rules[k]=DEFAULTS[k];}
 const limits={duration:[30,600],quota:[1,5],copSpeed:[1,6],thiefSpeed:[1,6],carrySpeed:[1,6],batRange:[.3,2],windup:[.15,1],recovery:[.5,3],miss:[0,2],stun:[.5,10],arrest:[.3,2],vault:[1,20],pickup:[.5,5],rescue:[.5,10],jail:[10,90],grace:[1,5],vision:[4,12],hearing:[0,15],stash:[.5,8],lockdown:[0,60],lockdownDelay:[0,20],decoy:[0,8],force:[0,8],sleep:[0,30],sleepHold:[.5,4],crowd:[0,8],drone:[0,20],boss:[0,1],heists:[0,5]};
 for(const [k,[min,max]]of Object.entries(limits))rules[k]=Math.max(min,Math.min(max,rules[k]));rules.quota=Math.round(rules.quota);
 const seed=Number(options.seed)||1,random=rng(seed),map=buildMap(mapId,tuning.cityGen),team=map.team||3;
 // Las reglas están pensadas para 3 contra 3 en 41×29. En una ciudad la cuota y el reloj crecen con el tamaño según
 // CITY_QUOTA y CITY_CLOCK (con la cuota 3 y los 240 s por defecto, esos mismos valores; otros escalan en proporción).
 if(map.city){const extra=k=>rules.drone>0&&!tuning.cityQuota?DRONE_EXTRA_BAGS[k]??0:0,quota={...Object.fromEntries(Object.entries(rules.crowd>0?CROWD_QUOTA:rules.force>0?LOCKED_QUOTA:CITY_QUOTA).map(([k,v])=>[k,v+extra(k)])),...tuning.cityQuota},clock={...CITY_CLOCK,...tuning.cityClock};
  rules.quota=Math.max(1,Math.round(rules.quota*(quota[team]??(5*team+2)/3)/3));rules.duration=Math.round(rules.duration*(clock[team]??240*(map.W+map.H)/(W+H))/240);}
 // El botín del mundo (plano con bp.botines): se gana por VALOR entregado, map.valorQuota (BOTIN.meta del valor en juego),
 // también en «Golpes» (sin botín, ahí la cuota es la cantidad de edificios: rules.heists).
 if(map.plan&&rules.heists>0){rules.quota=rules.heists;rules.boss=0;rules.drone=0;rules.lockdown=0;rules.force=0;rules.decoy=0;}
 if(map.valorQuota)rules.quota=map.valorQuota;
 // En «Golpes» el primer ladrón es el Profesor y el primer policía va en el dron: la persona juega con el segundo.
 const heist=map.plan&&rules.heists>0,humanId=options.humanId==='thief'?'a'+(heist?team+1:team):options.humanId==='cop'?(heist?'a1':'a0'):options.humanId??null;
 const game={rules,tuning,seed,random,map,time:0,remaining:rules.duration,phase:'ready',winner:null,reason:'',delivered:0,
  drones:[],sites:map.sites.map(s=>({open:false,progress:0,alarmUntil:0,hotFrom:0,hotUntil:0,noiseUntil:0,forced:s.guards.map(()=>false)})),vaultOpen:false,vaultProgress:0,alarmUntil:0,
  events:[],history:[],nextDecision:0,decisionRevision:0,humanId,
  stats:{captures:0,rescues:0,selfEscapes:0,stuns:0,recoveries:0,deliveries:0,knockoutsSaved:0,decisionsLocal:0,decisionsJev:0,decoys:0,forced:0,sleeps:0,wakes:0},
  agents:[],bags:[]};
 let n=0;map.sites.forEach((s,si)=>{for(const p of s.bagSpawns)game.bags.push({...p,home:{...p},id:'b'+(n++),site:si,state:'bank',carrier:null,valor:s.valor??1,carga:s.carga??1});});
 for(let i=0;i<2*team;i++){
  const isCop=i<team,k=isCop?i:i-team,spawns=isCop?map.copSpawns:map.thiefSpawns,spawn=spawns[k%spawns.length];
  // role reparte las tareas como en 3 contra 3: 0 banco/abrir, 1 rutas/rescates, 2 cárcel/robar por otra ruta.
  game.agents.push({id:'a'+i,name:(isCop?COP_NAMES:THIEF_NAMES)[k%8],team:isCop?'cop':'thief',role:k%3,...spawn,status:'active',bag:null,angle:isCop?Math.PI/2:-Math.PI/2,goal:null,route:[],repath:0,work:0,workKey:null,stunLeft:0,jailLeft:0,grace:0,batCd:0,attackLeft:0,attackTarget:null,stamina:2.4,sprinting:false,lastSeen:{},provider:'local',confidence:null,decisionText:'Esperando',lastJailDuration:0,jailedAt:0,patrolBias:random()});
 }
 // Los jefes: el primer ladrón y el primer policía.
 if(rules.boss>0){const tb=game.agents.find(a=>a.team==='thief'),cb=game.agents.find(a=>a.team==='cop');tb.boss=true;cb.chief=true;game.clues=[];
  log(game,`${tb.name} es el jefe de la banda; ${cb.name}, el jefe de policía.`,'system');}
 if(map.plan&&rules.heists>0)setupHeist(game,options);
 game.npcs=[];if(map.city&&rules.crowd>0){const n=Math.round(rules.crowd*2*team);for(let i=0;i<n;i++){const p=npcSpot(game);game.npcs.push({id:'n'+i,x:p.x,y:p.y,angle:random()*6.28,route:[],pause:random()*3,repath:0});}}
 log(game,team===3?'Ronda preparada. Tres policías, tres ladrones.':`Ronda preparada. ${team} policías, ${team} ladrones.`,'system');return game;
}
function log(g,text,type='event',agent=null){g.events.push({time:+g.time.toFixed(2),text,type,agent});if(g.events.length>220)g.events.shift();}
// Una casilla con candado (la puerta de la bóveda) bloquea hasta que su objetivo se abre.
// who: quien se mueve. Con lockdown, un policía que está afuera de un objetivo sin alarma no puede entrar.
function blocked(g,x,y,who=null){const {W,H,grid,lockAt,siteAt,doorAt}=g.map,ix=Math.floor(x),iy=Math.floor(y);if(ix<0||iy<0||ix>=W||iy>=H||grid[iy][ix])return true;
 if(g.rules.force>0&&doorAt&&who?.team!=='cop'){const d=doorAt[iy*W+ix];if(d&&!g.sites[(d-1)>>4].forced[(d-1)&15])return true;}
 if(who&&who.team==='cop'&&siteAt&&g.rules.lockdown>0){const si=siteAt[iy*W+ix];if(si&&!hot(g,si-1)&&siteAt[Math.floor(who.y)*W+Math.floor(who.x)]!==si)return true;}
 const lock=lockAt?lockAt[iy*W+ix]:0;if(!lock)return false;return g.sites?!g.sites[lock-1].open:!g.vaultOpen;}
// La policía puede entrar al objetivo si: suena su alarma y ya pasó la demora.
function hot(g,si){const s=g.sites[si];return g.time>=s.hotFrom&&g.time<s.hotUntil;}
function canStand(g,x,y,r=.24,who=null){if([[x-r,y-r],[x+r,y-r],[x-r,y+r],[x+r,y+r]].some(p=>blocked(g,...p,who)))return false;return !g.map.edgeE||!nearEdge(g.map,x,y,r);}
// Paredes en los bordes entre casillas (mapas del plano): ¿hay una entre la casilla (x,y) y su vecina (x+dx,y+dy)?
function edgeWall(m,x,y,dx,dy){if(!m.edgeE)return false;const {W,H}=m;if(dx===1)return x+1<W&&!!m.edgeE[y*W+x];if(dx===-1)return x>0&&!!m.edgeE[y*W+x-1];if(dy===1)return y+1<H&&!!m.edgeS[y*W+x];return y>0&&!!m.edgeS[(y-1)*W+x];}
// ¿Un cuadrado de medio lado r en (x,y) toca una pared de borde?
function nearEdge(m,x,y,r){const X=Math.round(x),Y=Math.round(y);
 if(Math.abs(x-X)<r)for(let ry=Math.floor(y-r);ry<=Math.floor(y+r);ry++)if(ry>=0&&ry<m.H&&X>0&&X<m.W&&m.edgeE[ry*m.W+X-1])return true;
 if(Math.abs(y-Y)<r)for(let rx=Math.floor(x-r);rx<=Math.floor(x+r);rx++)if(rx>=0&&rx<m.W&&Y>0&&Y<m.H&&m.edgeS[(Y-1)*m.W+rx])return true;
 return false;}
// ¿Pasar de la casilla (ax,ay) a la (bx,by), vecinas o en diagonal, cruza una pared de borde?
function crossesEdge(m,ax,ay,bx,by){const dx=bx-ax,dy=by-ay;if(!dx&&!dy)return false;if(!dx||!dy)return edgeWall(m,ax,ay,dx,dy);
 return (edgeWall(m,ax,ay,dx,0)||edgeWall(m,bx,ay,0,dy))&&(edgeWall(m,ax,ay,0,dy)||edgeWall(m,ax,by,dx,0));}
function lineOfSight(g,a,b){const d=distance(a,b),n=Math.ceil(d*8),m=g.map;let px=Math.floor(a.x),py=Math.floor(a.y);for(let i=1;i<=n;i++){const t=i/n,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;if(i<n&&blocked(g,x,y))return false;
 if(m.edgeE){const cx=Math.floor(x),cy=Math.floor(y);if(crossesEdge(m,px,py,cx,cy))return false;px=cx;py=cy;}}return true;}
function field(g,start,who=null){const {W,H}=g.map,dist=new Int16Array(W*H).fill(-1),queue=new Int16Array(W*H);const sx=Math.floor(start.x),sy=Math.floor(start.y);if(blocked(g,start.x,start.y,who))return dist;let head=0,tail=0;const initial=sy*W+sx;dist[initial]=0;queue[tail++]=initial;while(head<tail){const q=queue[head++],x=q%W,y=Math.floor(q/W);for(const [dx,dy] of DIRS){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=W||ny>=H)continue;const k=ny*W+nx;if(dist[k]!==-1||blocked(g,nx+.5,ny+.5,who)||edgeWall(g.map,x,y,dx,dy))continue;dist[k]=dist[q]+1;queue[tail++]=k;}}return dist;}
function path(g,a,b){const {W,H}=g.map,sx=Math.floor(a.x),sy=Math.floor(a.y),tx=Math.floor(b.x),ty=Math.floor(b.y);if(blocked(g,tx+.5,ty+.5,a))return [];const f=field(g,b,a),start=sy*W+sx;if(f[start]<0)return [];let x=sx,y=sy;const result=[];let guard=W*H;while((x!==tx||y!==ty)&&guard--){let next=null;for(const [dx,dy] of DIRS){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=W||ny>=H)continue;if(f[ny*W+nx]>=0&&f[ny*W+nx]<f[y*W+x]&&!edgeWall(g.map,x,y,dx,dy)){next={x:nx,y:ny};break;}}if(!next)return [];x=next.x;y=next.y;result.push(point(x,y));}result.push({x:b.x,y:b.y});return result;}
function move(g,a,dx,dy){const steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/.12));for(let i=0;i<steps;i++){if(canStand(g,a.x+dx/steps,a.y,.24,a))a.x+=dx/steps;if(canStand(g,a.x,a.y+dy/steps,.24,a))a.y+=dy/steps;}}
// Con «dormir a un policía», el policía no ve a su espalda (más de 100° de hacia dónde mira): por ahí se le acerca un
// ladrón sin ser visto. Lo sigue oyendo si corre o carga botín (perceive).
function visibleEnemies(g,a){return g.agents.filter(b=>b.team!==a.team&&b.status!=='jailed'&&distance(a,b)<=g.rules.vision&&!(g.rules.sleep>0&&a.team==='cop'&&behind(a,b))&&lineOfSight(g,a,b)&&(a.team!=='cop'||identified(g,a,b)));}
// ---------- Gente (NPC) ----------
const BLEND=4,KEEP=3,INNOCENT_PENALTY=5;
// ¿El policía a distingue al ladrón b? Sin gente, siempre. Con gente: si b se delata ahora, si anda solo o si a lo
// identificó hace poco y no lo perdió de vista (se renueva mientras lo ve).
function identified(g,a,b){
 if(b.prof)return false;
 if(!g.npcs?.length||b.status!=='active')return true;
 const known=a.ident?.[b.id]>g.time-KEEP,exposed=b.exposedUntil>g.time,alone=!g.npcs.some(n=>Math.abs(n.x-b.x)<BLEND&&Math.abs(n.y-b.y)<BLEND&&distance(n,b)<BLEND);
 if(known||exposed||alone){(a.ident||(a.ident={}))[b.id]=g.time;return true;}return false;
}
// Un lugar al azar en la calle (o un frente conocido) para un ciudadano.
function npcSpot(g){
 const {W,H,kind}=g.map,r=g.random;
 if(r()<.3){const poi=[...g.map.sites.flatMap(s=>s.guards),...g.map.deliveries,...g.map.copSpawns];const p=poi[Math.floor(r()*poi.length)];if(p&&!blocked(g,p.x,p.y))return {x:Math.floor(p.x)+.5,y:Math.floor(p.y)+.5};}
 for(let i=0;i<200;i++){const x=1+Math.floor(r()*(W-2)),y=1+Math.floor(r()*(H-2));if(!blocked(g,x+.5,y+.5,{team:'npc'})&&(!kind||kind[y*W+x]<=3))return {x:x+.5,y:y+.5};}
 return {x:g.map.thiefSpawns[0].x,y:g.map.thiefSpawns[0].y};
}
function npcStep(g,n,dt){
 if(n.pause>0){n.pause-=dt;return;}
 if(!n.route.length){const d=npcSpot(g);n.route=path(g,{...n,team:'npc'},d);if(!n.route.length){n.pause=1;return;}}
 const p=n.route[0],d=distance(n,p);if(d<.09){n.route.shift();if(!n.route.length)n.pause=1+g.random()*3;return;}
 const stepLen=Math.min(d,g.rules.thiefSpeed*dt);n.angle=Math.atan2(p.y-n.y,p.x-n.x);n.x+=(p.x-n.x)/d*stepLen;n.y+=(p.y-n.y)/d*stepLen;
}
// Lo que delata a un ladrón: correr, llevar bolsa o estar trabajando en algo.
const TELLING=['open','force','pickup','sleep','decoy','rescue','deliver','stash','unstash'];
// ¿Algún policía lo está persiguiendo? Con gente en la calle, un ladrón que no lo está actúa natural: no corre ni huye.
function chased(g,a){return g.agents.some(c=>c.team==='cop'&&c.status==='active'&&['chase','arrest'].includes(c.goal?.kind)&&c.goal.targetId===a.id);}
// Actúa natural sólo si de verdad está camuflado: no se está delatando y tiene gente cerca.
const calm=(g,a)=>g.npcs?.length>0&&a.team==='thief'&&!chased(g,a)&&!(a.exposedUntil>g.time)&&g.npcs.some(n=>distance(n,a)<BLEND);
function expose(g,a){if(a.team==='thief'&&a.status==='active'&&(a.sprinting||a.bag||(a.work>0&&TELLING.includes(a.goal?.kind))))a.exposedUntil=g.time+1.5;}
function perceive(g,a){for(const b of visibleEnemies(g,a))a.lastSeen[b.id]={id:b.id,x:b.x,y:b.y,status:b.status,carrying:!!b.bag,at:g.time};
 // Oído: quien corre o carga botín hace ruido y se oye a través de las paredes dentro de rules.hearing casillas.
 // No permite perseguirlo ni golpearlo (eso pide verlo), pero sí saber dónde buscar. 0 = apagado.
 if(g.rules.hearing>0)for(const b of g.agents)if(b.team!==a.team&&b.status==='active'&&(b.bag||b.sprinting)&&distance(a,b)<=g.rules.hearing)a.lastSeen[b.id]={id:b.id,x:b.x,y:b.y,status:b.status,carrying:!!b.bag,at:g.time};for(const [id,m]of Object.entries(a.lastSeen))if(g.time-m.at>6)delete a.lastSeen[id];}
function assignments(g,a,targetKey){return g.agents.filter(b=>b.id!==a.id&&b.team===a.team&&b.status==='active'&&b.goal?.id===targetKey).length;}
const DECOY_COOLDOWN=15,DRONE_RADIUS=6,DRONE_COOLDOWN=25,DRONE_SPEED=12;
// Al aire libre: calle, avenida, callejón, plaza o patio (la vista satelital no ve dentro de los edificios).
function outdoors(g,p){const {kind,K,W}=g.map;if(!kind)return true;const k=kind[Math.floor(p.y)*W+Math.floor(p.x)];return k<=K.plaza||k===K.courtyard;}
// ---------- Vista satelital (los dos equipos) ----------
// (En el código sigue llamándose «drone».) No es un aparato: nadie la ve ni la detecta. Cada jugador puede mirar desde
// arriba un círculo de DRONE_RADIUS casillas que mueve por toda la ciudad; mientras mira, su personaje se queda quieto.
// Ve sólo al aire libre, tiene tiempo limitado (rules.drone) y lo que ve lo sabe todo su equipo:
// - la de los ladrones ve a los policías (llevan uniforme): sirve para planear el robo;
// - la de la policía ve gente: con ciudadanos en la calle, sólo marca a los que se están delatando (sospechosos).
function flyDrone(g,a,target,dt,from=null){
 let d=g.drones.find(d=>d.owner===a.id);
 // Arranca donde está quien mira, o en «from» (un satélite puede mirar cualquier punto de entrada).
 if(!d){d={owner:a.id,team:a.team,x:(from||a).x,y:(from||a).y,used:0};g.drones.push(d);g.stats.drones=(g.stats.drones||0)+1;}
 if(target){const far=distance(d,target);if(far>.05){const step=Math.min(far,DRONE_SPEED*dt);d.x+=(target.x-d.x)/far*step;d.y+=(target.y-d.y)/far*step;}}
 d.x=Math.max(.5,Math.min(g.map.W-.5,d.x));d.y=Math.max(.5,Math.min(g.map.H-.5,d.y));d.tick=g.time;d.used+=dt;
 const mark=(team,b,p=b)=>{for(const o of g.agents)if(o.team===team&&o.status==='active')o.lastSeen[b.id]={id:b.id,x:p.x,y:p.y,status:b.status,carrying:!!b.bag,at:g.time};};
 if(a.team==='thief'){for(const c of g.agents)if(c.team==='cop'&&c.status==='active'&&distance(c,d)<=DRONE_RADIUS&&outdoors(g,c)){mark('thief',c);}}
 else for(const t of g.agents)if(t.team==='thief'&&t.status==='active'&&distance(t,d)<=DRONE_RADIUS&&outdoors(g,t)&&(!g.npcs?.length||t.exposedUntil>g.time))mark('cop',t);
 return d;
}
function endDrone(g,a,cooldown){g.drones=g.drones.filter(d=>d.owner!==a.id);a.droneReady=g.time+cooldown;}
// ¿Está b a la espalda de a? Fuera de su frente: más de 100° de hacia dónde mira.
function behind(a,b){return Math.cos(Math.atan2(b.y-a.y,b.x-a.x)-a.angle)<-.17;}
// Punto a la espalda del policía, donde se para quien lo va a dormir.
function backOf(c){return {x:c.x-Math.cos(c.angle)*.6,y:c.y-Math.sin(c.angle)*.6};}
// El objetivo que la banda está robando: el de la mayoría de los compañeros que van a abrir o a recoger bolsas.
function bandTarget(g,a){const votes=new Map();for(const b of g.agents){if(b.team!=='thief'||b.id===a.id||b.status!=='active'||!b.goal)continue;
 const si=['open','force'].includes(b.goal.kind)?b.goal.targetId:b.goal.kind==='pickup'?g.bags.find(x=>x.id===b.goal.targetId)?.site:undefined;if(si!==undefined&&si!==null)votes.set(si,(votes.get(si)||0)+1);}
 let best=null;for(const [si,n] of votes)if(best===null||n>votes.get(best))best=si;return best;}
// Los policías que la banda conoce: lo que vio u oyó hace poco cualquiera de los ladrones (se pasan la voz).
function teamCops(g,a){const out=new Map();for(const b of g.agents)if(b.team==='thief'&&b.status==='active')for(const m of Object.values(b.lastSeen))if(m.status==='active'&&g.agents.find(c=>c.id===m.id)?.team==='cop'&&(!out.has(m.id)||out.get(m.id).at<m.at))out.set(m.id,m);return [...out.values()];}
// ---------- Jefes: el interrogatorio y la zona donde buscar ----------
// Tres pistas verdaderas sobre dónde está el jefe ahora: vaga (una mitad), media (un cuadrante) y precisa (cerca de un
// lugar conocido). El preso elige; los bots, la vaga. Con tuning.clueChoice 'azar' (o un preso humano, que todavía no
// tiene pantalla para elegir), una al azar.
// El artículo de un lugar: «el Banco», «la Joyería», «el Parque Santander», «la Torre Santa Fe»…
const FEMININE=/^(Joyería|Casa|Tienda|Plaza|Torre)/;
const withArticle=name=>/^(el|la|los|las) /i.test(name)?name:(FEMININE.test(name)?'la ':'el ')+name;
const de=name=>{const a=withArticle(name);return a.startsWith('el ')?'del '+a.slice(3):'de '+a;};
const al=name=>{const a=withArticle(name);return a.startsWith('el ')?'al '+a.slice(3):'a '+a;};
function bossClue(g,prisoner){
 const boss=g.agents.find(a=>a.boss);if(!boss||boss.status==='jailed')return null;
 const options=zoneClues(g,{x:boss.x,y:boss.y}),choice=g.tuning.clueChoice==='azar'||prisoner.id===g.humanId?Math.floor(g.random()*3):0,c=options[choice];
 g.clues.push({...c,level:choice,at:g.time,by:prisoner.id});g.stats.clues=(g.stats.clues||0)+1;g.clueCache=null;
 log(g,`Interrogatorio: ${prisoner.name} dice que el jefe está ${c.text}.`,'clue',prisoner.id);return c;
}
// Tres pistas verdaderas sobre el punto b: vaga (una mitad), media (cuadrante, calle o entre cuáles calles) y precisa
// (la manzana, la esquina o frente a qué está).
function zoneClues(g,b){
 const {W,H}=g.map,north=b.y<H/2,west=b.x<W/2,n=g.map.names;
 const half=g.random()<.5?{text:`en la mitad ${north?'norte':'sur'}`,test:p=>(p.y<H/2)===north}:{text:`en la mitad ${west?'oeste':'este'}`,test:p=>(p.x<W/2)===west};
 let medium={text:`en el cuadrante ${north?'nor':'sur'}${west?'oeste':'este'}`,test:p=>(p.y<H/2)===north&&(p.x<W/2)===west};
 const marks=[...g.map.sites.map(s=>({name:s.name||'el objetivo',p:s.center||s.panels[0]})),...(g.heist?[]:g.map.deliveries.map(d=>({name:d.name.toLowerCase(),p:d}))),{name:'la comisaría',p:g.map.jailCells[0]}];
 const m=marks.map(m=>({...m,d:distance(m.p,b)})).sort((x,y)=>x.d-y.d)[0],radius=Math.max(7,Math.ceil(m.d)+1);
 let precise={text:`a menos de ${radius} casillas ${de(m.name)}`,test:p=>distance(p,m.p)<=radius};
 // Con nombres (ciudades): la media es la calle o la carrera (o entre cuáles calles está), y la precisa, la manzana
 // (edificio, parque, plaza) o la esquina.
 if(n){
  const cx=Math.floor(b.x),cy=Math.floor(b.y),i=cy*W+cx,hl=n.hLine[i],vl=n.vLine[i],line=id=>n.lines[id];
  const onLine=(id,p)=>{const x=Math.floor(p.x),y=Math.floor(p.y);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const j=(y+dy)*W+x+dx;if(x+dx<0||y+dy<0||x+dx>=W||y+dy>=H)continue;if(n.hLine[j]===id||n.vLine[j]===id)return true;}return false;};
  if(hl>=0||vl>=0){const id=hl>=0&&(vl<0||g.random()<.5)?hl:vl;medium={text:`sobre la ${line(id).name}`,test:p=>onLine(id,p)};}
  else{const calles=n.lines.filter(l=>l.axis==='h'),above=calles.filter(l=>Math.max(...l.at)<=cy).at(-1),below=calles.find(l=>Math.min(...l.at)>=cy);
   if(above&&below){const y0=Math.min(...above.at),y1=Math.max(...below.at);medium={text:`entre la ${above.name} y la ${below.name}`,test:p=>p.y>=y0&&p.y<=y1+1};}}
  const blk=g.map.blocks.findIndex(k=>cx>=k.x0&&cx<=k.x1&&cy>=k.y0&&cy<=k.y1);
  const near=(k,m)=>({test:p=>p.x>=k.x0-m&&p.x<=k.x1+1+m&&p.y>=k.y0-m&&p.y<=k.y1+1+m});
  if(blk>=0){const k=g.map.blocks[blk];precise={text:`en ${withArticle(n.blocks[blk])}`,...near(k,1)};}
  else if(hl>=0&&vl>=0)precise={text:`en la ${line(hl).name} con ${line(vl).name}`,test:p=>Math.abs(p.x-b.x)<=3&&Math.abs(p.y-b.y)<=3};
  else{const f=g.map.blocks.map((k,ix)=>({k,ix,d:Math.max(k.x0-b.x,b.x-k.x1-1,0)+Math.max(k.y0-b.y,b.y-k.y1-1,0)})).sort((x,y)=>x.d-y.d)[0];
   if(f&&f.d<=2)precise={text:`frente ${al(n.blocks[f.ix])}`,...near(f.k,3)};}
 }
 return [half,medium,precise];
}

// Las casillas al aire libre donde puede estar el jefe según las pistas de los últimos 90 s (si no coinciden todas,
// la última). Se recalcula sólo cuando llega una pista nueva o cambia el conjunto de pistas recientes.
function clueSpots(g){
 const recent=(g.clues||[]).filter(c=>g.time-c.at<=90);if(!recent.length)return [];
 const key=recent.map(c=>c.at).join(',');if(g.clueCache?.key===key)return g.clueCache.spots;
 const {W,H,grid}=g.map,cells=[];for(let y=0;y<H;y++)for(let x=0;x<W;x++){const p=point(x,y);if(!grid[y][x]&&outdoors(g,p))cells.push(p);}
 let spots=cells.filter(p=>recent.every(c=>c.test(p)));if(!spots.length)spots=cells.filter(p=>recent.at(-1).test(p));
 g.clueCache={key,spots};return spots;
}
// Dónde esconderse: puntos al aire libre con gente cerca, lejos de la policía conocida y de los objetivos.
function hideSpots(g,a){
 const {W,H,grid}=g.map,cops=teamCops(g,a),out=[];
 for(let i=0;i<40&&out.length<6;i++){const x=1+Math.floor(g.random()*(W-2)),y=1+Math.floor(g.random()*(H-2)),p=point(x,y);if(grid[y][x]||!outdoors(g,p))continue;
  const crowd=Math.min(3,(g.npcs||[]).filter(n=>distance(n,p)<4).length),far=Math.min(10,...cops.map(c=>distance(c,p)),10),site=Math.min(8,...g.map.sites.map(s=>distance(s.center||s.panels[0],p)));
  out.push({...p,score:crowd*4+far+site*.5});}
 return out;
}

// ---------- Golpes (IDEAS.md §00, 2026-10-10): tres golpes, el hangar del Profesor, cajas y pistas ----------
// Sólo en los mapas del plano (plan:…) con rules.heists > 0. Los ladrones ganan si llevan al hangar el botín de
// «heists» edificios distintos (cada edificio robable tiene uno, en su caja fuerte). La policía gana si arresta al
// Profesor, si encarcela a todos los que roban o si se acaba el tiempo.
// - El Profesor (el primer ladrón) elige al empezar un edificio con computador: el hangar. Ahí se queda sentado frente
//   a un computador, y ahí se entrega el botín. Hay gente sentada frente a computadores en muchos edificios, con rasgos
//   (pelo, bigote, gafas): a simple vista nadie lo distingue.
// - El jefe de policía (el primer policía) va todo el tiempo en el dron: no está en la calle; mira desde arriba y
//   avisa a sus compañeros dónde ve a alguien delatándose (con una bolsa, corriendo, trabajando).
// - Abrir la caja fuerte de un edificio hace sonar su alarma: la central avisa a toda la policía.
// - El que lleva la bolsa puede dejarla en cualquier caja (los depósitos y locales del plano tienen muchas) y volver
//   por ella después. La policía revisa las cajas cerca de donde vio la bolsa por última vez.
// - Cada ladrón arrestado da una pista más precisa que la anterior sobre dónde está el Profesor y uno de sus rasgos.
//   Con las pistas, la policía revisa a la gente sentada que coincide; arrestar a un inocente la suspende unos segundos.
//   Si un policía ve entregar el botín, sabe cuál es el hangar.
const TRAITS=[['pelo',['negro','castaño','rubio','canoso']],['bigote',[true,false]],['gafas',[true,false]]];
const traitText=(k,v)=>k==='pelo'?`tiene el pelo ${v}`:k==='bigote'?(v?'tiene bigote':'no tiene bigote'):(v?'usa gafas':'no usa gafas');
const CRATE_TIME=1.5,HEIST_SITTERS=1,INSPECT_MIN=2,WRONG_ARREST=5;
function setupHeist(g,options){
 const m=g.map,r=g.random,prof=g.agents.find(a=>a.team==='thief'),chief=g.agents.find(a=>a.team==='cop'),station=m.lots[m.station].center;
 prof.prof=true;prof.boss=true;chief.chief=true;chief.status='drone';
 const traits=()=>Object.fromEntries(TRAITS.map(([k,vs])=>[k,vs[Math.floor(r()*vs.length)]]));
 // El hangar: un edificio con computador que no se roba ni es la comisaría. Los bots eligen al azar entre la mitad
 // más lejana de la comisaría; options.hangar fija el lote (para probar o para quien juega de Profesor).
 const robbable=new Set(m.sites.map(s=>s.lot)),withSeat=new Set(m.seats.map(s=>s.lot));
 const eligible=m.lots.filter(L=>withSeat.has(L.id)&&!robbable.has(L.id)&&L.id!==m.station&&L.doors.length).sort((a,b)=>distance(b.center,station)-distance(a.center,station));
 const lot=eligible.find(L=>L.id===options.hangar)||eligible[Math.floor(r()*Math.ceil(eligible.length*.5))];
 const mine=m.seats.filter(s=>s.lot===lot.id),seat=mine[Math.floor(r()*mine.length)];
 Object.assign(prof,{x:seat.x,y:seat.y,angle:0});
 m.deliveries=[{x:seat.x,y:seat.y,id:'hangar',name:'Hangar · '+lot.name,lot:lot.id}];
 // Gente sentada: HEIST_SITTERS por edificio con computador (además del Profesor), en un computador al azar.
 const sitters=[{id:'p',x:seat.x,y:seat.y,lot:lot.id,traits:traits(),prof:true}];
 for(const L of m.lots){const ss=m.seats.filter(s=>s.lot===L.id&&s!==seat);for(let k=0;k<HEIST_SITTERS&&ss.length;k++){const s=ss.splice(Math.floor(r()*ss.length),1)[0];sitters.push({id:'q'+sitters.length,x:s.x,y:s.y,lot:L.id,traits:traits()});}}
 const order=TRAITS.map(([k])=>k);for(let i=order.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
 g.heist={hangar:lot.id,sitters,order,known:{},revealed:false,suspects:[],robbed:[],droneTarget:null,droneAt:0};
 g.crates=m.crates.map(c=>({x:c.x,y:c.y,lot:c.lot,bag:null,checked:-1e9}));g.clues=[];
 // Un botín por edificio robable (ya lo pone makeGame con bagSpawns).
 log(g,`${prof.name} es el Profesor: eligió su hangar. ${chief.name}, el jefe de policía, vuela el dron.`,'system');
}
// Con tuning.serial (prueba: un robo a la vez), el edificio que se está robando: el que se empezó a abrir y cuyo botín
// todavía no llegó al hangar. Mientras haya uno, no se puede empezar otro. -1 = ninguno (o la regla apagada).
function heistBusy(g){if(!g.heist||!g.tuning.serial)return -1;for(let si=0;si<g.sites.length;si++){const st=g.sites[si];if((st.open||st.progress>0)&&g.bags.some(b=>b.site===si&&b.state!=='delivered'))return si;}return -1;}
function heistAlarm(g,si,a){const s=g.sites[si];s.noiseUntil=g.time+20;s.noiseAt={...g.map.sites[si].center};log(g,`ALARMA EN ${g.map.sites[si].name.toUpperCase()}.`,'alarm',a.id);
 for(const c of g.agents)if(c.team==='cop'&&c.status==='active')c.lastSeen[a.id]={id:a.id,x:a.x,y:a.y,status:a.status,carrying:false,at:g.time};}
// La pista del preso n.º k: la zona (vaga, media, precisa) y el rasgo k del Profesor.
function heistClue(g,prisoner){
 const h=g.heist,level=Math.min(2,g.clues.length),prof=h.sitters[0],zone=zoneClues(g,prof)[level],k=h.order[Math.min(level,h.order.length-1)],v=prof.traits[k];
 h.known[k]=v;g.clues.push({...zone,level,at:g.time,by:prisoner.id});g.stats.clues=(g.stats.clues||0)+1;
 log(g,`Interrogatorio: ${prisoner.name} dice que el Profesor está ${zone.text} y ${traitText(k,v)}.`,'clue',prisoner.id);
}
// La gente sentada que la policía todavía no descartó: coincide con los rasgos y las pistas (o está en el hangar, si
// lo vieron).
function suspects(g){const h=g.heist;if(!h.revealed&&g.clues.length<(g.tuning.inspectMin??INSPECT_MIN))return [];
 return h.sitters.filter(s=>!s.cleared&&(h.revealed?s.lot===h.hangar:g.clues.every(c=>c.test(s)))&&Object.entries(h.known).every(([k,v])=>s.traits[k]===v));}
// El dron del jefe de policía: sigue la bolsa que alguien vio hace poco; si no, va a la alarma, a las cajas
// sospechosas o a la zona de las pistas; si no hay nada, recorre los edificios robables.
function chiefDrone(g,dt){
 const c=g.agents.find(a=>a.chief&&a.status==='drone'),h=g.heist;if(!c)return;
 if(g.time>=h.droneAt){h.droneAt=g.time+1;let t=null,best=-1;
  for(const o of g.agents)if(o.team==='cop')for(const m of Object.values(o.lastSeen))if(m.carrying&&g.time-m.at<6&&m.at>best){best=m.at;t={x:m.x,y:m.y};}
  if(!t){const si=g.sites.findIndex(s=>s.noiseUntil>g.time);if(si>=0)t=g.map.sites[si].center;}
  if(!t&&h.suspects.length)t=h.suspects.at(-1);
  if(!t){const sp=suspects(g);if(sp.length&&g.clues.length)t=sp[Math.floor(g.time/8)%sp.length];}
  if(!t&&(!h.droneTarget||distance(g.drones.find(d=>d.owner===c.id)||c,h.droneTarget)<1)){const s=g.map.sites[Math.floor(g.random()*g.map.sites.length)];t=s.center;}
  if(t)h.droneTarget={x:t.x,y:t.y};}
 flyDrone(g,c,h.droneTarget,dt,g.map.jailCells[0]);
}

function candidates(g,a){
 if(a.status!=='active'||a.prof)return [];
 const W=g.map.W,f=field(g,a,a),enemies=visibleEnemies(g,a),out=[],multi=g.map.sites.length>1;
 const add=(id,kind,target,label,base,targetId=null)=>{const steps=f[Math.floor(target.y)*W+Math.floor(target.x)];if(steps<0)return;const danger=enemies.filter(e=>e.status==='active').reduce((n,e)=>n+Math.max(0,5-distance(e,target)),0);const utility=base-steps*.85-assignments(g,a,id)*24-(a.team==='thief'?danger*8:0)+preference(g,a,id);out.push({id,kind,target:{x:target.x,y:target.y},targetId,label,steps,utility:+utility.toFixed(2),danger:+danger.toFixed(1)});};
 if(a.team==='thief'){
  const boss=g.rules.boss>0&&a.boss;
  if(a.bag){for(const d of g.map.deliveries)add('deliver:'+d.id,'deliver',d,'Entregar bolsa: '+d.name,145);
   // Golpes: con policía detrás hace poco y nadie encima, dejar la bolsa en una caja cercana.
   if(g.heist){const near=Object.values(a.lastSeen).filter(m=>m.status==='active'&&g.time-m.at<8&&distance(m,a)<10&&g.agents.find(b=>b.id===m.id)?.team==='cop');
    if(near.length&&!enemies.some(e=>e.status==='active'&&distance(e,a)<3))g.crates.map((c,ci)=>({c,ci,d:distance(a,c)})).filter(o=>!o.c.bag&&o.d<4).sort((x,y)=>x.d-y.d).slice(0,3).forEach(o=>add('stash:'+o.ci,'stash',o.c,'Esconder la bolsa en una caja',150,o.ci));}}
  else if(!boss){
   const busy=heistBusy(g);g.map.sites.forEach((s,si)=>{if(!g.sites[si].open&&(busy<0||busy===si))s.panels.forEach((p,i)=>add('open:'+(multi?si+':':'')+i,'open',p,s.panelLabels[i],88+(s.valor?4*(s.valor-3):0),si));});
   // Con puertas cerradas: forzar una de un objetivo al que todavía no se puede entrar, la menos cuidada.
   if(g.rules.force>0&&g.map.doorAt){const cops=teamCops(g,a);g.map.sites.forEach((s,si)=>{const st=g.sites[si];if(st.forced.some(Boolean)||!g.bags.some(b=>b.site===si&&b.state==='bank'))return;
    s.guards.forEach((p,j)=>add('force:'+si+':'+j,'force',p,`Forzar la puerta ${j+1} de ${s.name}`,92-cops.reduce((n,m)=>n+Math.max(0,6-distance(m,p))*4,0),si));});}
   for(const b of g.bags.filter(b=>(b.state==='bank'&&g.sites[b.site].open)||b.state==='dropped'))add('pickup:'+b.id,'pickup',b,'Recoger bolsa '+(Number(b.id.slice(1))+1)+(b.state==='dropped'?' caída':multi?' de '+g.map.sites[b.site].name:''),95,b.id);
   for(const prisoner of g.agents.filter(b=>b.team==='thief'&&b.status==='jailed'))g.map.rescuePanels.forEach((p,i)=>add('rescue:'+prisoner.id+':'+i,'rescue',p,'Rescatar a '+prisoner.name+' por '+p.name.toLowerCase(),98+(g.agents.filter(b=>b.status==='jailed').length-1)*20,prisoner.id));
   for(const b of g.agents.filter(b=>b.team==='thief'&&b.status==='stunned'&&distance(a,b)<7))add('wake:'+b.id,'wake',b,'Despertar a '+b.name,122,b.id);
   // Golpes: volver por una bolsa escondida cuando no se sabe de policía cerca de su caja.
   if(g.heist){const cops=teamCops(g,a);g.crates.forEach((c,ci)=>{if(c.bag&&!cops.some(m=>distance(m,c)<6))add('unstash:'+c.bag,'unstash',c,'Sacar la bolsa de una caja',100,ci);});}
  }
  // Con lockdown, un ladrón adentro de un objetivo planea la salida: la puerta con menos policía cerca (de lo que vio u
  // oyó hace poco). Sale si lleva botín, o sin botín si suena la alarma y vio policía adentro.
  const here=g.rules.lockdown>0&&g.map.siteAt?g.map.siteAt[Math.floor(a.y)*W+Math.floor(a.x)]:0;
  if(here){
   const si=here-1,cops=Object.values(a.lastSeen).filter(m=>m.status==='active'&&g.agents.find(b=>b.id===m.id)?.team==='cop');
   const copsInside=cops.some(m=>g.map.siteAt[Math.floor(m.y)*W+Math.floor(m.x)]===here);
   const base=a.bag?170:hot(g,si)&&copsInside?140:0;
   if(base)g.map.sites[si].guards.forEach((p,j)=>add('exit:'+si+':'+j,'exit',p,`Salir de ${g.map.sites[si].name} por la puerta ${j+1}`,base-cops.reduce((n,m)=>n+Math.max(0,6-distance(m,p))*4,0)));
  }
  // Quien ya está volando el dron sigue teniendo esa opción hasta que se le acabe la batería.
  const flying=a.goal?.kind==='drone'&&g.drones.some(d=>d.owner===a.id);
  if(!a.bag&&g.rules.drone>0&&(!(g.rules.boss>0)||boss)&&(flying||(g.time>=(a.droneReady??0)&&g.time-(g.bandDroneAt??-1e9)>15&&!g.drones.some(d=>d.team==='thief')&&!g.agents.some(b=>b!==a&&b.team==='thief'&&b.goal?.kind==='drone')))){
   const band=bandTarget(g,a);
   g.map.sites.forEach((s,si)=>{const st=g.sites[si],mine=flying&&a.goal.targetId===si;if(flying&&!mine)return;if(!mine&&(st.open||st.progress||st.forced?.some(Boolean)||g.time-(st.scanAt??-1e9)<20))return;
    add('drone:'+si,'drone',{x:a.x,y:a.y},`Mirar ${s.name} con el dron`,si===band?118:112,si);const o=out.find(o=>o.id==='drone:'+si);if(o)o.view={x:s.center.x,y:s.center.y};});
  }
  if(!a.bag&&!boss&&g.rules.decoy>0&&a.role===1&&g.map.sites.length>1&&g.time-(a.decoyAt??-1e9)>DECOY_COOLDOWN){
   const target=bandTarget(g,a);
   if(target!==null){
    // Se ubica antes en la puerta de otro objetivo y espera ahí el momento (ver interactGoal).
    const cops=teamCops(g,a),near=p=>cops.filter(m=>distance(m,p)<5).length;
    g.map.sites.forEach((s,si)=>{if(si!==target)s.guards.forEach((p,j)=>{add('decoy:'+si+':'+j,'decoy',p,`Hacer ruido en ${s.name} (puerta ${j+1})`,105-near(p)*15,si);const o=out.find(o=>o.id==='decoy:'+si+':'+j);if(o)o.band=target;});});
   }
  }
  // Dormir a un policía que está de espaldas y cerca. El peligro de ese mismo policía no cuenta: es a quien se busca.
  // Golpes con un robo a la vez: dormir policías sólo cerca del edificio que se roba (para cubrir al que roba).
  const cover=heistBusy(g)>=0&&g.tuning.cover?g.map.sites[heistBusy(g)].center:null;
  if(g.rules.sleep>0&&!a.bag&&!boss)for(const c of enemies.filter(e=>e.status==='active'&&distance(a,e)<6&&behind(e,a)&&(!cover||distance(e,cover)<8))){
   const others=enemies.filter(e=>e!==c&&e.status==='active'&&distance(e,c)<5).length;if(others)continue;
   add('sleep:'+c.id,'sleep',backOf(c),'Dormir a '+c.name,(distance(a,c)<2.8?215:150),c.id);const o=out.at(-1);if(o?.id==='sleep:'+c.id)o.utility+=8*Math.max(0,5-distance(c,o.target));
  }
  // El jefe se esconde: va a un punto con gente, lejos de la policía, y se queda un rato.
  if(boss){if(a.hideUntil>g.time&&a.hideAt)add('hide:here','hide',a.hideAt,'Quedarse escondido',100);
   else for(const p of hideSpots(g,a))add('hide:'+Math.floor(p.x)+':'+Math.floor(p.y),'hide',p,'Esconderse entre la gente',92+p.score);}
  // Golpes con un robo a la vez: los que no hacen falta en el robo esperan entre la gente, lejos de la policía.
  else if(g.heist&&g.tuning.serial&&!a.bag){const base=g.tuning.lurk??55;if(a.hideUntil>g.time&&a.hideAt)add('hide:here','hide',a.hideAt,'Esperar escondido',base+8);
   else for(const p of hideSpots(g,a))add('hide:'+Math.floor(p.x)+':'+Math.floor(p.y),'hide',p,'Esperar entre la gente',base+p.score);}
  const threat=enemies.filter(e=>e.status==='active').sort((x,y)=>distance(a,x)-distance(a,y))[0];
  if(threat&&distance(a,threat)<4.5&&!calm(g,a)){
   // Salidas cortas visibles: no elegir una esquina lejana cuya ruta empieza hacia el perseguidor.
   const exits=[];for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
    const p=point(Math.floor(a.x)+dx,Math.floor(a.y)+dy),walk=f[Math.floor(p.y)*W+Math.floor(p.x)];
    if(walk>0&&walk<=5&&canStand(g,p.x,p.y)&&distance(a,p)>=1.5&&lineOfSight(g,a,p)&&distance(threat,p)>distance(a,threat)+1)exits.push(p);
   }
   exits.sort((x,y)=>(distance(threat,y)-distance(a,y)*.35)-(distance(threat,x)-distance(a,x)*.35));
   const separated=[];for(const p of exits)if(separated.every(q=>distance(q,p)>1.5)){separated.push(p);if(separated.length===3)break;}
   for(const [i,p]of separated.entries())add('flee:'+Math.floor(p.x)+':'+Math.floor(p.y),'flee',p,'Escapar por la ruta '+(i+1),distance(a,threat)<2.8?190:110);
  }
 }else{
  for(const e of enemies){if(e.status==='stunned')add('arrest:'+e.id,'arrest',e,'Arrestar a '+e.name,190,e.id);else if(e.grace<=0)add('chase:'+e.id,'chase',e,'Perseguir a '+e.name+(e.bag?' con botín':''),e.bag?153:128,e.id);}
  for(const m of Object.values(a.lastSeen))if(!enemies.some(e=>e.id===m.id))add('search:'+m.id,'search',m,'Buscar en la última posición vista',90-(g.time-m.at)*6,m.id);
  for(const b of g.bags.filter(b=>b.state==='dropped'))add('recover:'+b.id,'recover',b,'Recuperar bolsa caída',122,b.id);
  for(const b of g.agents.filter(b=>b.team==='cop'&&b.status==='asleep'&&distance(a,b)<8&&lineOfSight(g,a,b)))add('wakecop:'+b.id,'wakecop',b,'Despertar a '+b.name,140,b.id);
  // Vista satelital de la policía. Uno a la vez.
  // - Si hay un robo en curso (bóveda abierta con bolsas, o alarma en los últimos 20 s), busca a los que llevan bolsa:
  //   arranca sobre ese objetivo y barre hacia el escondite más cercano que no se miró en 10 s.
  // - Si no, mira el objetivo o escondite más lejos de los demás policías.
  const spots=g.rules.boss>0?clueSpots(g):[];
  if(g.rules.drone>0&&!enemies.length&&(!(g.rules.boss>0)||a.chief)){const flying=a.goal?.kind==='drone'&&g.drones.some(d=>d.owner===a.id);
   if(flying||(g.time>=(a.droneReady??0)&&g.time-(g.copDroneAt??-1e9)>10&&!g.drones.some(d=>d.team==='cop')&&!g.agents.some(b=>b!==a&&b.team==='cop'&&b.goal?.kind==='drone'))){
    const robbed=g.tuning.noHunt?null:g.map.sites.map((s,si)=>({s,si})).filter(({si})=>{const st=g.sites[si];return (st.open&&g.bags.some(b=>b.site===si&&b.state!=='delivered'))||st.hotUntil>g.time-20;})
     .sort((x,y)=>distance(a,x.s.center)-distance(a,y.s.center))[0];
    let view=null,from=null,hunt=false;
    if(flying){view=a.goal.view;from=a.goal.from;hunt=a.goal.hunt;}
    // Con pistas, el jefe de policía mira la zona donde puede estar el jefe de la banda.
    else if(spots.length){const c=spots.reduce((s,p)=>({x:s.x+p.x/spots.length,y:s.y+p.y/spots.length}),{x:0,y:0});view=spots.sort((x,y)=>distance(x,c)-distance(y,c))[0];hunt='boss';}
    else if(robbed){const c=robbed.s.center,scan=g.hideoutScan||(g.hideoutScan={});
     const h=[...g.map.deliveries].sort((x,y)=>distance(c,x)-distance(c,y)).find(d=>g.time-(scan[d.id]??-1e9)>10)||g.map.deliveries[0];
     view={x:h.x,y:h.y};from={x:c.x,y:c.y};hunt=h.id;}
    else{const others=g.agents.filter(c=>c.team==='cop'&&c.status==='active'&&c!==a),spots=[...g.map.sites.map(s=>s.center),...g.map.deliveries];
     view=spots.map(p=>({p,gap:Math.min(99,...others.map(c=>distance(c,p)))})).sort((x,y)=>y.gap-x.gap)[0]?.p;}
    if(view){add('drone:cop','drone',{x:a.x,y:a.y},hunt==='boss'?'Buscar al jefe con el dron':hunt?'Buscar bolsas con la vista satelital':'Mirar con la vista satelital',hunt==='boss'?128:hunt?(a.role===1?130:105):(a.role===1?112:96));
     const o=out.find(o=>o.id==='drone:cop');if(o){o.view={x:view.x,y:view.y};o.from=from;o.hunt=hunt;}}}}
  // Con pistas, cada policía tiene un punto de la zona para revisar (cambia cada 12 s).
  if(spots.length){let h=0;for(const ch of a.id+Math.floor(g.time/12))h=Math.imul(h^ch.charCodeAt(0),0x01000193)>>>0;const p=spots[h%spots.length];add('hunt:'+a.id,'hunt',p,'Buscar al jefe en la zona de las pistas',a.role===1?112:a.role===2?100:88);}
  const jailed=g.agents.filter(b=>b.team==='thief'&&b.status==='jailed').length,anyOpen=g.sites.some(s=>s.open);
  // Golpes: revisar las cajas cerca de donde se vio la bolsa por última vez, y a la gente sentada que coincide con las pistas.
  if(g.heist){const h=g.heist;h.suspects=h.suspects.filter(p=>p.until>g.time);
   for(const p of h.suspects)g.crates.map((c,ci)=>({c,ci,d:distance(p,c)})).filter(o=>o.d<3&&g.time-o.c.checked>60).sort((x,y)=>x.d-y.d).slice(0,4).forEach(o=>add('crate:'+o.ci,'opencrate',o.c,'Revisar una caja',118,o.ci));
   for(const p of suspects(g))add('inspect:'+p.id,'inspect',p,h.revealed?'Arrestar a quien está en el computador del hangar':'Revisar a quien está en un computador',h.revealed?200:110+g.clues.length*12,p.id);}
  // Un ruido en la puerta de un objetivo: la central avisa a toda la policía, y cada uno decide si va a revisarlo.
  // Cuánto le conviene depende de qué tan lejos le queda y de cuántos compañeros ya van: uno va y los demás se quedan.
  g.map.sites.forEach((s,si)=>{const st=g.sites[si];if(st.noiseUntil>g.time&&st.noiseAt)add('noise:'+si,'investigate',st.noiseAt,`Revisar el ruido en ${s.name}`,g.tuning.investigate??120);});
  if(g.rules.lockdown>0&&g.map.siteAt)g.map.sites.forEach((s,si)=>{if(hot(g,si))s.panels.forEach((p,i)=>add('respond:'+si+':'+i,'respond',p,`Entrar a ${s.name}: suena la alarma`,g.tuning.respond??100));});
  g.map.sites.forEach((s,si)=>{const alarm=g.sites[si].alarmUntil>g.time||g.sites[si].hotUntil>g.time||g.sites[si].noiseUntil>g.time;s.guards.forEach((p,j)=>add(multi?'guard:s'+si+':'+j:'guard:bank'+j,'guard',p,s.guardLabels[j],(a.role===0?85:35)+(alarm?35:0)));});
  g.map.rescuePanels.forEach((p,i)=>add('guard:jail'+i,'guard',p,'Vigilar acceso '+(i?'sur':'lateral')+' de la cárcel',(a.role===2?78:42)+jailed*10));
  for(const d of (g.heist&&!g.heist.revealed?[]:g.map.deliveries))add('guard:'+d.id,'guard',d,'Vigilar '+d.name.toLowerCase(),a.role===1?(anyOpen?90:70):(anyOpen?62:25));
  const patrol=g.map.patrol[Math.floor(g.time/12+a.patrolBias*11)%g.map.patrol.length];add('patrol:'+Math.floor(patrol.x)+':'+Math.floor(patrol.y),'patrol',patrol,'Patrullar cruces del barrio',a.role===1?95:anyOpen?72:57);
 }
 // Con dron, la banda elige el banco con lo que sabe: cada policía conocido cerca de un objetivo lo hace menos atractivo.
 if(a.team==='thief'&&g.rules.drone>0){const known=teamCops(g,a);if(known.length)for(const o of out){
  const si=['open','force'].includes(o.kind)?o.targetId:o.kind==='pickup'?g.bags.find(b=>b.id===o.targetId)?.site:null;if(si===null||si===undefined)continue;
  const n=known.filter(m=>distance(m,g.map.sites[si].center)<=DRONE_RADIUS+2).length;if(n){o.utility=+(o.utility-14*n).toFixed(2);}}}
 return out.sort((x,y)=>y.utility-x.utility).slice(0,12);
}
// Con lockdown, un ladrón que va desde la calle a algo que está adentro de un objetivo entra por la puerta con menos
// policía cerca (de lo que vio u oyó hace poco), no por la más cercana: via es el punto de la calle frente a esa puerta.
function entryDoor(g,a,goal){
 const {siteAt,W}=g.map;if(a.team!=='thief'||!(g.rules.lockdown>0)||!siteAt||!['open','pickup'].includes(goal.kind))return null;
 const si=siteAt[Math.floor(goal.target.y)*W+Math.floor(goal.target.x)];if(!si||siteAt[Math.floor(a.y)*W+Math.floor(a.x)]===si)return null;
 const cops=Object.values(a.lastSeen).filter(m=>m.status==='active'&&g.agents.find(b=>b.id===m.id)?.team==='cop'),f=field(g,a,a);
 let best=null;for(const p of g.map.sites[si-1].guards){const steps=f[Math.floor(p.y)*W+Math.floor(p.x)];if(steps<0)continue;
  const score=steps*.85+cops.reduce((n,m)=>n+Math.max(0,6-distance(m,p))*8,0);if(!best||score<best.score)best={score,p};}
 return best?{x:best.p.x,y:best.p.y,site:si}:null;
}
function setGoal(g,a,choice,provider='local',confidence=null){if(!choice)return false;const fresh=candidates(g,a).find(c=>c.id===choice.id);if(!fresh)return false;const changed=a.goal?.id!==fresh.id;if(!changed&&a.goal?.via)fresh.via=a.goal.via;else if(changed){const via=entryDoor(g,a,fresh);if(via)fresh.via=via;}a.goal=fresh;a.provider=provider;a.confidence=confidence;a.decisionText=fresh.label;if(changed){a.route=[];a.repath=0;a.work=0;a.workKey=null;log(g,a.name+': '+fresh.label,provider==='jev'?'jev':'decision',a.id);}g.stats[provider==='jev'?'decisionsJev':'decisionsLocal']++;return true;}
function decideLocal(g,a){const opts=candidates(g,a);if(opts.length)setGoal(g,a,opts[0]);}
function localTurn(g,force=false){for(const a of g.agents){if(a.id===g.humanId||a.status!=='active')continue;if(force||!a.goal||a.provider!=='jev'||g.time-(a.jevAt??-100)>8)decideLocal(g,a);}}
const DUTIES={cop:['Vigilar banco; perseguir si detecta ladrones','Patrullar e interceptar rutas de entrega','Vigilar cárcel y apoyar a compañeros'],thief:['Abrir banco y robar','Apoyar rescates si hay presos; robar si no','Robar por una ruta distinta a los compañeros']};
function observe(g,a){const opts=candidates(g,a);return {id:a.id,name:a.name,team:a.team,status:a.status,position:{x:+a.x.toFixed(1),y:+a.y.toFixed(1)},carrying:!!a.bag,remaining:+g.remaining.toFixed(1),delivered:g.delivered,quota:g.rules.quota,vaultOpen:g.vaultOpen,alarm:g.alarmUntil>g.time,previous:a.goal?.id||null,
  suggestedTeamDuty:DUTIES[a.team][a.role],
  visibleEnemies:visibleEnemies(g,a).map(e=>({id:e.id,status:e.status,carrying:!!e.bag,distance:+distance(a,e).toFixed(1)})),
  teammates:g.agents.filter(b=>b.team===a.team&&b.id!==a.id).map(b=>({name:b.name,status:b.status,goal:b.goal?.label||'ninguna',carrying:!!b.bag})),
  options:opts.map(o=>({id:o.id,description:o.label,walkDistance:o.steps,danger:o.danger,teammatesAssigned:assignments(g,a,o.id)}))};}
function decisionBatch(g){for(const a of g.agents)perceive(g,a);return g.agents.filter(a=>a.id!==g.humanId&&a.status==='active').map(a=>observe(g,a)).filter(o=>o.options.length);}
function applyDecisions(g,answers){let applied=0;for(const [id,result]of Object.entries(answers||{})){const a=g.agents.find(a=>a.id===id);if(!a||a.id===g.humanId||a.status!=='active')continue;const option=candidates(g,a).find(c=>c.id===result.choice);if(option&&setGoal(g,a,option,'jev',result.confidence)){a.jevAt=g.time;applied++;}}return applied;}
// cuánto frena lo que se carga (el botín del mundo: BOTIN.objetos[].carga; una bolsa, 1)
function carga(g,a){return g.bags.find(b=>b.id===a.bag)?.carga??1;}
function dropBag(g,a){if(!a.bag)return false;const b=g.bags.find(b=>b.id===a.bag);if(b){Object.assign(b,{x:a.x,y:a.y,state:'dropped',carrier:null});log(g,a.name+' soltó una bolsa.','loot',a.id);}a.bag=null;return true;}
function startBat(g,a,target){if(a.team!=='cop'||a.status!=='active'||a.batCd>0||a.attackLeft>0||!target||target.status!=='active'||target.grace>0)return false;if(distance(a,target)>g.rules.batRange+.3||!lineOfSight(g,a,target))return false;a.attackLeft=g.rules.windup;a.attackTarget=target.id;a.angle=Math.atan2(target.y-a.y,target.x-a.x);a.batCd=g.rules.windup+g.rules.recovery;return true;}
function knockOut(g,cop,thief){if(thief.status!=='active'||thief.grace>0)return false;dropBag(g,thief);thief.status='stunned';thief.stunLeft=g.rules.stun;thief.work=0;thief.route=[];g.stats.stuns++;log(g,cop.name+' noqueó a '+thief.name+'. Falta arrestarlo.','stun',thief.id);return true;}
function arrest(g,cop,thief){if(thief.status!=='stunned'||distance(cop,thief)>1.05||!lineOfSight(g,cop,thief))return false;const cells=g.map.jailCells,cell=cells[(Number(thief.id.slice(1))-g.map.team)%cells.length];Object.assign(thief,cell,{status:'jailed',jailLeft:g.rules.jail,jailedAt:g.time,goal:null,route:[],work:0,workKey:null,stunLeft:0});g.stats.captures++;log(g,cop.name+' envió a '+thief.name+' a la cárcel.','capture',thief.id);
 if(g.rules.boss>0){if(thief.boss){finish(g,'cop','Atraparon al jefe de la banda');return true;}bossClue(g,thief);}
 if(g.heist)heistClue(g,thief);
 checkWin(g);return true;}
function release(g,prisoner,panel,self=false){if(prisoner.status!=='jailed')return false;prisoner.lastJailDuration=g.time-prisoner.jailedAt;Object.assign(prisoner,panel.exit,{status:'active',grace:g.rules.grace,jailLeft:0,goal:null,route:[],work:0,workKey:null});g.stats[self?'selfEscapes':'rescues']++;log(g,prisoner.name+(self?' terminó su fuga individual.':' fue rescatado. ¡Puede volver al robo!'),'rescue',prisoner.id);return true;}
function wake(g,a,b){if(b.status!=='stunned')return false;b.status='active';b.stunLeft=0;b.grace=2;b.goal=null;g.stats.knockoutsSaved++;log(g,a.name+' despertó a '+b.name+'.','rescue',b.id);return true;}
function finish(g,winner,reason){if(g.phase==='finished')return;g.winner=winner;g.reason=reason;g.phase='finished';log(g,(winner==='thief'?'GANAN LOS LADRONES':'GANAN LOS POLICÍAS')+' · '+reason,'finish');}
function checkWin(g){if(g.delivered>=g.rules.quota)finish(g,'thief','Botín entregado');else if(g.agents.filter(a=>a.team==='thief'&&!a.prof).every(a=>a.status==='jailed'))finish(g,'cop','Todos los ladrones están en la cárcel');else if(g.remaining<=0)finish(g,'cop','Se acabó el tiempo');}
// Con lockdown, la alarma de un objetivo deja entrar a la policía «lockdown» segundos.
function ring(g,si){if(g.rules.lockdown>0&&g.map.siteAt){const s=g.sites[si];if(s.hotUntil<=g.time){s.hotFrom=g.time+g.rules.lockdownDelay;log(g,`${g.map.sites[si].alarmLabel}: la policía puede entrar${g.rules.lockdownDelay?` en ${g.rules.lockdownDelay} s`:''}.`,'alarm');}s.hotUntil=Math.max(s.hotFrom,g.time)+g.rules.lockdown;}}
function interactGoal(g,a,dt){
 const goal=a.goal;if(!goal||a.grace>0)return false;
 let target=goal.target;
 if(goal.targetId&&['pickup','recover'].includes(goal.kind)){const b=g.bags.find(b=>b.id===goal.targetId);if(!b||!['bank','dropped'].includes(b.state)){a.goal=null;return false;}target=b;}
 if(goal.targetId&&['arrest','wake'].includes(goal.kind)){const b=g.agents.find(b=>b.id===goal.targetId);if(!b||b.status!=='stunned'){a.goal=null;return false;}target=b;}
 if(goal.kind==='wakecop'){const b=g.agents.find(b=>b.id===goal.targetId);if(!b||b.status!=='asleep'){a.goal=null;return false;}target=b;}
 // Dormir: hay que seguir a su espalda todo el tiempo; si se da vuelta o se aleja, se empieza de nuevo.
 if(goal.kind==='sleep'){const c=g.agents.find(b=>b.id===goal.targetId);if(!c||c.status!=='active'){a.goal=null;return false;}
  if(distance(a,c)>.95||!behind(c,a)||!lineOfSight(g,a,c)){a.work=0;a.workKey=null;return false;}target=a;}
 if(goal.kind==='rescue'&&!g.agents.some(b=>b.id===goal.targetId&&b.status==='jailed')){a.goal=null;return false;}
 if((goal.kind==='stash'&&(!a.bag||g.crates[goal.targetId].bag))||(goal.kind==='unstash'&&(a.bag||!g.crates[goal.targetId].bag))||(goal.kind==='inspect'&&g.heist.sitters.find(x=>x.id===goal.targetId)?.cleared)){a.goal=null;return false;}
 if(distance(a,target)>.78||!lineOfSight(g,a,target)){a.work=0;a.workKey=null;return false;}
 // El ruido se hace en el momento en que la policía va a venir: mientras los compañeros abren la bóveda o sacan bolsas.
 // Antes, quien va a distraer espera en la puerta. Una persona lo hace cuando quiere.
 if(goal.kind==='decoy'&&a.id!==g.humanId){const st=g.sites[goal.band??0],forcing=g.agents.some(b=>b.team==='thief'&&b.status==='active'&&b.goal?.kind==='force'&&b.goal.targetId===goal.band&&b.work>0);if(goal.band===undefined||!(forcing||(st.progress>0&&!st.open)||st.hotUntil>g.time)){a.work=0;a.workKey=null;return true;}}
 const durations={stash:CRATE_TIME,unstash:CRATE_TIME,opencrate:CRATE_TIME,inspect:g.rules.arrest,drone:g.rules.drone,sleep:g.rules.sleepHold,wakecop:1,force:g.rules.force,decoy:g.rules.decoy,open:g.rules.vault,pickup:g.rules.pickup,deliver:g.rules.stash,rescue:g.rules.rescue,arrest:g.rules.arrest,wake:1,recover:2};
 if(!durations[goal.kind])return false;
 if(a.workKey!==goal.id){a.work=0;a.workKey=goal.id;}a.work+=dt;
 if(goal.kind==='drone'){if(a.work===dt){if(a.team==='thief')g.bandDroneAt=g.time;else g.copDroneAt=g.time;}if(a.team==='thief'&&goal.targetId!=null)g.sites[goal.targetId].scanAt=g.time;
  if(goal.hunt&&a.team==='cop')(g.hideoutScan||(g.hideoutScan={}))[goal.hunt]=g.time;
  flyDrone(g,a,goal.view,dt,goal.from);if(a.work<durations.drone)return true;endDrone(g,a,DRONE_COOLDOWN);a.goal=null;a.work=0;a.workKey=null;return true;}
 if(goal.kind==='open'){
  // El progreso es del objetivo, no del ladrón: se conserva y lo pueden sumar varios.
  const si=goal.targetId??0,s=g.sites[si],busy=heistBusy(g);
  if(s.open||(busy>=0&&busy!==si)){a.goal=null;return false;}
  // Golpes: la alarma suena apenas se empieza a abrir y la policía tiene el tiempo de abrir para llegar (con tuning.alarmAt 'open', al terminar: los ladrones ganaban el 63 % en 3 contra 3).
  if(g.heist&&g.tuning.alarmAt!=='open'&&!s.progress)heistAlarm(g,si,a);
  // (cada objeto del botín, su tiempo: map.sites[].openTime; si no, el de abrir del motor)
  const T=g.map.sites[si].openTime??g.rules.vault;s.progress=Math.min(T,s.progress+dt);s.alarmUntil=g.time+5;g.alarmUntil=Math.max(g.alarmUntil,s.alarmUntil);g.vaultProgress=g.sites[0].progress;
  if(s.progress<T)return true;
  s.open=true;g.vaultOpen=true;ring(g,si);log(g,g.map.sites[si].openLog,'alarm',a.id);
  // Golpes: la alarma del edificio avisa a toda la policía por la central.
  if(g.heist&&g.tuning.alarmAt==='open')heistAlarm(g,si,a);
 }else if(a.work<durations[goal.kind])return true;
 else if(goal.kind==='pickup'){
  const b=g.bags.find(b=>b.id===goal.targetId);if(!a.bag&&b&&['bank','dropped'].includes(b.state)){if(b.state==='bank')ring(g,b.site);b.state='carried';b.carrier=a.id;a.bag=b.id;log(g,a.name+' lleva una bolsa. Ahora debe entregarla.','loot',a.id);}
 }else if(goal.kind==='deliver'){
  const b=g.bags.find(b=>b.id===a.bag);
  if(b&&g.heist&&!g.heist.revealed&&g.agents.some(c=>c.team==='cop'&&c.status==='active'&&distance(c,a)<=g.rules.vision&&lineOfSight(g,c,a))){g.heist.revealed=true;g.stats.revealed=1;log(g,`La policía vio entregar el botín: el hangar está en ${g.map.lots[g.heist.hangar].name}.`,'clue',a.id);}
  if(b){b.state='delivered';b.carrier=null;a.bag=null;g.delivered+=g.map.valorQuota?b.valor:1;g.stats.deliveries++;log(g,a.name+' entregó botín ('+g.delivered+'/'+g.rules.quota+').','delivery',a.id);checkWin(g);}
 }else if(goal.kind==='force'){
  const si=goal.targetId,j=Number(goal.id.split(':')[2]),s=g.sites[si];
  if(!s.forced[j]){s.forced[j]=true;g.stats.forced++;log(g,`${a.name} forzó la puerta ${j+1} de ${g.map.sites[si].name}.`,'alarm',a.id);
   if(!g.tuning.forceSilent)for(const c of g.agents)if(c.team==='cop'&&c.status==='active'&&distance(c,a)<=Math.max(12,2*g.rules.hearing))c.lastSeen[a.id]={id:a.id,x:a.x,y:a.y,status:a.status,carrying:false,at:g.time};}
 }else if(goal.kind==='sleep'){
  const c=g.agents.find(b=>b.id===goal.targetId);
  if(c&&c.status==='active'){Object.assign(c,{status:'asleep',sleepLeft:g.rules.sleep,goal:null,route:[],work:0,workKey:null,attackLeft:0,attackTarget:null});g.stats.sleeps++;
   log(g,`${a.name} durmió a ${c.name}.`,'stun',c.id);
   // Un policía dormido es una pista: la central avisa dónde está el ladrón.
   for(const o of g.agents)if(o.team==='cop'&&o.status==='active')o.lastSeen[a.id]={id:a.id,x:a.x,y:a.y,status:a.status,carrying:!!a.bag,at:g.time};}
 }else if(goal.kind==='wakecop'){
  const c=g.agents.find(b=>b.id===goal.targetId);if(c?.status==='asleep'){c.status='active';c.sleepLeft=0;g.stats.wakes++;log(g,`${a.name} despertó a ${c.name}.`,'rescue',c.id);}
 }else if(goal.kind==='decoy'){
  const si=goal.targetId,s=g.sites[si];s.noiseUntil=g.time+10;s.noiseAt={x:goal.target.x,y:goal.target.y};a.decoyAt=g.time;g.stats.decoys++;
  log(g,`${a.name} hace ruido en ${g.map.sites[si].name}.`,'alarm',a.id);
  // Quien lo oye sabe dónde está el que hizo el ruido.
  for(const c of g.agents)if(c.team==='cop'&&c.status==='active'&&distance(c,a)<=Math.max(12,2*g.rules.hearing))c.lastSeen[a.id]={id:a.id,x:a.x,y:a.y,status:a.status,carrying:false,at:g.time};
 }else if(goal.kind==='stash'){
  const c=g.crates[goal.targetId],b=g.bags.find(b=>b.id===a.bag);
  if(b&&!c.bag){Object.assign(b,{state:'crate',crate:goal.targetId,carrier:null,x:c.x,y:c.y});c.bag=b.id;a.bag=null;g.stats.stashes=(g.stats.stashes||0)+1;log(g,`${a.name} escondió la bolsa en una caja.`,'loot',a.id);
   // La policía que lo vio con la bolsa hace poco sabe más o menos dónde dejó de llevarla.
   for(const o of g.agents)if(o.team==='cop'){const m=o.lastSeen[a.id];if(m?.carrying&&g.time-m.at<10){g.heist.suspects.push({x:m.x,y:m.y,until:g.time+60});break;}}}
 }else if(goal.kind==='unstash'){
  const c=g.crates[goal.targetId],b=c&&g.bags.find(b=>b.id===c.bag);if(b&&!a.bag){Object.assign(b,{state:'carried',carrier:a.id,crate:null});c.bag=null;a.bag=b.id;log(g,`${a.name} sacó la bolsa de una caja.`,'loot',a.id);}
 }else if(goal.kind==='opencrate'){
  const c=g.crates[goal.targetId];c.checked=g.time;const b=c.bag&&g.bags.find(b=>b.id===c.bag);
  if(b){Object.assign(b,b.home,{state:'bank',carrier:null,crate:null});c.bag=null;g.stats.recoveries++;g.stats.crateFinds=(g.stats.crateFinds||0)+1;g.heist.suspects=g.heist.suspects.filter(p=>distance(p,c)>=3);log(g,`${a.name} encontró una bolsa en una caja y la devolvió.`,'loot',a.id);}
 }else if(goal.kind==='inspect'){
  const s=g.heist.sitters.find(x=>x.id===goal.targetId);
  if(s&&!s.cleared){if(s.prof){const p=g.agents.find(b=>b.prof);p.status='jailed';g.stats.captures++;log(g,`${a.name} arrestó al Profesor.`,'capture',p.id);finish(g,'cop',`Atraparon al Profesor en ${g.map.lots[s.lot].name}`);}
   else{const t=g.tuning.wrongArrest??WRONG_ARREST;s.cleared=true;a.staggerLeft=t;g.stats.innocents=(g.stats.innocents||0)+1;log(g,`${a.name} arrestó a un inocente: suspendido ${t} s.`,'stun',a.id);}}
 }else if(goal.kind==='arrest')arrest(g,a,g.agents.find(b=>b.id===goal.targetId));
 else if(goal.kind==='wake')wake(g,a,g.agents.find(b=>b.id===goal.targetId));
 else if(goal.kind==='rescue'){const p=g.map.rescuePanels.reduce((x,y)=>distance(a,x)<distance(a,y)?x:y);release(g,g.agents.find(b=>b.id===goal.targetId),p);}
 else if(goal.kind==='recover'){
  const b=g.bags.find(b=>b.id===goal.targetId);if(b?.state==='dropped'){Object.assign(b,b.home,{state:'bank',carrier:null});g.stats.recoveries++;log(g,a.name+' '+g.map.sites[b.site].returnLog,'loot',a.id);}
 }
 a.goal=null;a.work=0;a.workKey=null;return true;
}
function walkTo(g,a,target,dt,sprint=false){
 if(!target)return;
 a.repath-=dt;if(a.repath<=0||!a.route.length){a.route=path(g,a,target);a.repath=.65;}
 while(a.route.length&&distance(a,a.route[0])<.09)a.route.shift();const p=a.route[0];if(!p)return;
 const d=distance(a,p);let speed=a.team==='cop'?g.rules.copSpeed:a.bag?g.rules.carrySpeed*carga(g,a):g.rules.thiefSpeed;
 a.sprinting=sprint&&a.stamina>.05;if(a.sprinting){speed*=1.45;a.stamina=Math.max(0,a.stamina-dt*1.8);}else a.stamina=Math.min(2.4,a.stamina+dt*.65);
 const step=Math.min(d,speed*dt);a.angle=Math.atan2(p.y-a.y,p.x-a.x);move(g,a,(p.x-a.x)/d*step,(p.y-a.y)/d*step);
}
function updateBot(g,a,dt){
 const enemies=visibleEnemies(g,a),near=enemies.filter(e=>e.status==='active'&&e.grace<=0).sort((x,y)=>distance(a,x)-distance(a,y))[0];
 if(a.team==='cop'){
  const stunned=enemies.filter(e=>e.status==='stunned').sort((x,y)=>distance(a,x)-distance(a,y))[0];
  if(stunned&&distance(a,stunned)<2.5){const temp={id:'arrest:'+stunned.id,kind:'arrest',target:stunned,targetId:stunned.id,label:'Arrestar a '+stunned.name};if(a.goal?.id!==temp.id){a.provider='local';a.confidence=null;g.stats.decisionsLocal++;log(g,a.name+': arresto cercano de '+stunned.name+' (reflejo local).','decision',a.id);}a.goal=temp;a.decisionText=temp.label;}
  if(near&&distance(a,near)<=g.rules.batRange+.2)startBat(g,a,near);
 }else{
  // Reflejo del ladrón: como una persona, corre apenas ve a un policía cerca, sin esperar al turno de decisión,
  // y al llegar a su salida elige la siguiente en vez de quedarse quieto con el policía detrás.
  const threatened=near&&distance(a,near)<4.5&&a.goal?.kind!=='flee'&&!calm(g,a),arrived=['flee','exit'].includes(a.goal?.kind)&&distance(a,a.goal.target)<.4;
  if((threatened||arrived)&&g.time-(a.reflexAt??-1)>.4){a.reflexAt=g.time;decideLocal(g,a);}
 }
 if(!a.goal)decideLocal(g,a);if(!a.goal)return;
 let target=a.goal.target;
 // Con el oído encendido, quien busca sigue el último ruido (lastSeen se renueva al oír), no el punto donde lo oyó primero.
 if(a.goal.kind==='search'&&g.rules.hearing>0){const m=a.lastSeen[a.goal.targetId];if(m){target={x:m.x,y:m.y};a.goal.target=target;}}
 if(a.goal.kind==='sleep'){const c=g.agents.find(b=>b.id===a.goal.targetId);if(!c||c.status!=='active'){a.goal=null;return;}target=backOf(c);if(!canStand(g,target.x,target.y))target={x:c.x,y:c.y};a.goal.target=target;}
 if(['chase','arrest','wake','wakecop'].includes(a.goal.kind)){
  const e=g.agents.find(b=>b.id===a.goal.targetId);
  if(!e||e.status==='jailed'){a.goal=null;return;}
  if(a.goal.kind==='chase'&&!enemies.includes(e)){a.goal=null;decideLocal(g,a);return;}
  target={x:e.x,y:e.y};a.goal.target=target;
 }
 if(a.goal.via){const v=a.goal.via;if(distance(a,v)<.5||g.map.siteAt[Math.floor(a.y)*g.map.W+Math.floor(a.x)]===v.site)a.goal.via=null;else target=v;}
 if(a.goal.kind==='hide'&&a.goal.id!=='hide:here'&&distance(a,target)<.5){a.hideAt={x:target.x,y:target.y};a.hideUntil=g.time+10+g.random()*8;a.goal=null;return;}
 if(a.staggerLeft>0)return;
 if(a.attackLeft>0){const t=g.agents.find(b=>b.id===a.attackTarget);if(t)walkTo(g,a,t,dt,true);return;}
 if(!interactGoal(g,a,dt))walkTo(g,a,target,dt,!calm(g,a)&&(['flee','exit'].includes(a.goal?.kind)||(a.goal?.kind==='chase'&&distance(a,target)<5)||(a.bag&&enemies.some(e=>distance(a,e)<5))));
}
function updateHuman(g,a,dt,input){
 // F: mientras se mantiene, se mira desde el satélite y las teclas de mover mueven el círculo; el personaje queda
 // quieto. Al soltar, la recarga es proporcional al tiempo usado.
 const mine=g.drones.find(x=>x.owner===a.id);
 if(input.drone&&g.rules.drone>0&&(!(g.rules.boss>0)||a.boss||a.chief)&&!a.bag&&g.time>=(a.droneReady??0)){
  const dx=(input.right?1:0)-(input.left?1:0),dy=(input.down?1:0)-(input.up?1:0),from=mine||a;
  const d=flyDrone(g,a,dx||dy?{x:from.x+dx*10,y:from.y+dy*10}:null,dt);a.sprinting=false;a.goal=null;a.work=0;a.workKey=null;
  if(d.used>=g.rules.drone)endDrone(g,a,DRONE_COOLDOWN);return;
 }
 if(mine)endDrone(g,a,DRONE_COOLDOWN*Math.min(1,mine.used/g.rules.drone));
 const dx=(input.right?1:0)-(input.left?1:0),dy=(input.down?1:0)-(input.up?1:0),d=Math.hypot(dx,dy);
 if(d){a.work=0;a.workKey=null;a.goal=null;let speed=a.team==='cop'?g.rules.copSpeed:a.bag?g.rules.carrySpeed*carga(g,a):g.rules.thiefSpeed;a.sprinting=!!input.sprint&&a.stamina>.05;if(a.sprinting){speed*=1.45;a.stamina=Math.max(0,a.stamina-dt*1.8);}else a.stamina=Math.min(2.4,a.stamina+dt*.65);a.angle=Math.atan2(dy,dx);if(!a.staggerLeft)move(g,a,dx/d*speed*dt,dy/d*speed*dt);}else{a.sprinting=false;a.stamina=Math.min(2.4,a.stamina+dt*.65);}
 if(input.drop)dropBag(g,a);
 if(input.attack&&a.team==='cop'){const e=visibleEnemies(g,a).filter(e=>e.status==='active').sort((x,y)=>distance(a,x)-distance(a,y))[0];
  if(e)startBat(g,a,e);
  else if(g.npcs?.length&&a.batCd<=0){
   // Sin causa probable: golpea a la figura más cercana. Si es un ciudadano, queda suspendido.
   const figures=[...g.npcs.map(n=>({n,d:distance(a,n)})),...g.agents.filter(b=>b.team==='thief'&&b.status==='active').map(b=>({b,d:distance(a,b)}))].filter(f=>f.d<=g.rules.batRange+.3&&lineOfSight(g,a,f.n||f.b)).sort((x,y)=>x.d-y.d)[0];
   if(figures?.b)startBat(g,a,figures.b);
   else if(figures?.n){a.batCd=g.rules.recovery;a.staggerLeft=INNOCENT_PENALTY;g.stats.innocents=(g.stats.innocents||0)+1;log(g,a.name+' golpeó a un ciudadano: suspendido '+INNOCENT_PENALTY+' s.','stun',a.id);}
  }}
 if(input.interact&&!d){const opts=candidates(g,a).filter(c=>['open','pickup','rescue','deliver','arrest','wake','recover','decoy','force','sleep','wakecop','stash','unstash','opencrate','inspect'].includes(c.kind)&&distance(a,c.target)<.78);const option=opts[0];if(option){if(a.goal?.id!==option.id){a.goal=option;a.work=0;a.workKey=null;}interactGoal(g,a,dt);}}else if(!d){a.work=0;a.workKey=null;}
}
function step(g,dt=DT,input={}){
 if(g.phase!=='playing')return;dt=Math.min(.1,Math.max(0,dt));g.time+=dt;g.remaining=Math.max(0,g.rules.duration-g.time);
 if(g.drones?.length)g.drones=g.drones.filter(d=>{const o=g.agents.find(a=>a.id===d.owner);const alive=d.tick>g.time-.2&&(o?.status==='active'||o?.status==='drone');if(!alive&&o)o.droneReady=g.time+DRONE_COOLDOWN;return alive;});
 if(g.heist)chiefDrone(g,dt);
 if(g.npcs?.length){for(const n of g.npcs)npcStep(g,n,dt);for(const a of g.agents)expose(g,a);
  // La central ve la ciudad desde arriba: cada 2 s marca a toda la policía dónde hay alguien delatándose (no quién es).
  // Con dron, no hay central: la policía ve sólo lo que alcanzan sus drones.
  if(!(g.rules.drone>0)&&g.time>=(g.centralAt??0)){g.centralAt=g.time+2;for(const b of g.agents)if(b.team==='thief'&&b.status==='active'&&b.exposedUntil>g.time){g.stats.marks=(g.stats.marks||0)+1;
   for(const c of g.agents)if(c.team==='cop'&&c.status==='active')c.lastSeen[b.id]={id:b.id,x:b.x,y:b.y,status:b.status,carrying:!!b.bag,at:g.time};}}}
 for(const a of g.agents){
  a.grace=Math.max(0,a.grace-dt);a.batCd=Math.max(0,a.batCd-dt);a.staggerLeft=Math.max(0,(a.staggerLeft||0)-dt);
  // El policía sigue corriendo mientras levanta el bate; si el golpe no conecta, trastabilla (miss) y el ladrón gana distancia.
  if(a.attackLeft>0){a.attackLeft-=dt;if(a.attackLeft<=0){const b=g.agents.find(b=>b.id===a.attackTarget);const hit=b&&distance(a,b)<=g.rules.batRange&&lineOfSight(g,a,b)&&Math.cos(Math.atan2(b.y-a.y,b.x-a.x)-a.angle)>.2&&knockOut(g,a,b);if(!hit)a.staggerLeft=g.rules.miss;a.attackTarget=null;}}
  if(a.status==='asleep'){a.sleepLeft-=dt;if(a.sleepLeft<=0){a.status='active';a.goal=null;log(g,a.name+' se despertó.','rescue',a.id);}}
  else if(a.status==='stunned'){a.stunLeft-=dt;if(a.stunLeft<=0){a.status='active';a.grace=2;a.goal=null;log(g,a.name+' se levantó antes del arresto.','rescue',a.id);}}
  else if(a.status==='jailed'){
   // La fuga automática acota la espera; si todos están presos la ronda termina antes.
   a.jailLeft-=dt;if(a.jailLeft<=0){const panels=g.map.rescuePanels,p=panels[Number(a.id.slice(1))%panels.length];release(g,a,p,true);}
  }
  if(a.status==='active')perceive(g,a);
 }
 if(g.time>=g.nextDecision){localTurn(g);g.nextDecision=g.time+2;g.decisionRevision++;}
 for(const a of g.agents){if(g.phase!=='playing')break;if(a.status!=='active')continue;if(a.id===g.humanId)updateHuman(g,a,dt,input);else updateBot(g,a,dt);}
 // Memoria de cada equipo: dónde vio (u oyó) por última vez a cada rival, de lo que cualquiera de sus integrantes anotó
 // en este paso. Sólo la usa la pantalla (la marca «visto acá»); los bots usan su propio lastSeen.
 const memory=g.memory||(g.memory={cop:{},thief:{}});
 for(const a of g.agents)for(const m of Object.values(a.lastSeen))if(m.at===g.time)memory[a.team][m.id]={x:m.x,y:m.y,at:m.at,carrying:m.carrying};
 for(const b of g.bags.filter(b=>b.state==='carried')){const a=g.agents.find(a=>a.id===b.carrier);if(a){b.x=a.x;b.y=a.y;}}
 checkWin(g);
}
function start(g){if(g.phase==='ready'){g.phase='playing';localTurn(g);log(g,'Comienza el atraco.','system');}return g;}
function run(options={}){const g=start(makeGame(options));while(g.phase==='playing')step(g,DT);return g;}
function summary(g){return {seed:g.seed,map:g.map.id,team:g.map.team,humanId:g.humanId,winner:g.winner,reason:g.reason,seconds:+g.time.toFixed(1),delivered:g.delivered,...g.stats,rules:{...g.rules}};}
return {DRONE_RADIUS,suspects,clueSpots,outdoors,visibleEnemies,identified,W,H,DT,DEFAULTS,CITY_DEFAULTS,CITY_QUOTA,LOCKED_QUOTA,CROWD_QUOTA,CITY_CLOCK,WHIM,MAPS,makeGame,buildMap,start,step,run,summary,blocked,canStand,lineOfSight,path,field,distance,candidates,decisionBatch,applyDecisions,decideLocal,startBat,knockOut,arrest,release,dropBag,interactGoal,log};
})(CityModule);
export default Lab;
