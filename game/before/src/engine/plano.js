/* La ciudad por etapas (blueprint.js) puesta en el formato del motor (game.js), para jugar el modo «Golpes».
   El motor sigue en casillas de 6 m (lo calibrado no cambia): cada lote es un interior caminable y las paredes son
   BORDES entre casillas (edgeE: entre (x,y) y (x+1,y); edgeS: entre (x,y) y (x,y+1)), cerrados en todo el contorno
   del lote salvo donde el plano pone una puerta de calle en la planta baja. Los tabiques de adentro no cuentan: a
   esta escala un lote es uno o dos cuartos del motor. Sólo la planta baja.
   Del plano salen también las cajas (para esconder la bolsa), los computadores (donde se sienta el Profesor y la
   gente que lo disimula) y los edificios que se pueden robar. */
import City from './ciudad.js';
import {generateBlueprint,CELL as S} from './blueprint.js';

// Los edificios que se roban: los objetivos del plano, las oficinas y el comercio (cada uno con un botín).
import {JUEGO,BOTIN} from './medidas.js';
export const ROBBABLE=JUEGO.robables;
const pt=(x,y)=>({x:x+.5,y:y+.5});

export function planMap(id){
 const [,team,seed]=id.split(':').map(Number),edificios=id.split(':')[3]==='edificios',bp=generateBlueprint({seed,team}),c=bp.map,{W,H}=c,K=City.K;
 const grid=c.grid.map(r=>[...r]),kind=Uint8Array.from(c.kind),lotAt=new Int16Array(W*H).fill(-1);
 const cellsOf=L=>{const out=[];for(const p of L.parts)for(let y=p.y/S;y<(p.y+p.h)/S;y++)for(let x=p.x/S;x<(p.x+p.w)/S;x++)out.push([x,y]);return out;};
 bp.lots.forEach((L,i)=>{for(const [x,y] of cellsOf(L)){lotAt[y*W+x]=i;grid[y][x]=0;kind[y*W+x]=K.room;}});
 // Paredes: todo el borde entre un lote y lo que no es ese lote.
 const edgeE=new Uint8Array(W*H),edgeS=new Uint8Array(W*H);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;
  if(x+1<W&&(lotAt[i]>=0||lotAt[i+1]>=0)&&lotAt[i]!==lotAt[i+1])edgeE[i]=1;
  if(y+1<H&&(lotAt[i]>=0||lotAt[i+W]>=0)&&lotAt[i]!==lotAt[i+W])edgeS[i]=1;}
 // Las puertas de calle de la planta baja abren el borde de su casilla. Cada lote guarda las suyas: la casilla de
 // adentro y el punto de la calle frente a ella (donde se vigila).
 const doors=bp.lots.map(()=>[]);
 bp.lots.forEach((L,li)=>{for(const d of L.levels[0].doors){if(!d.street)continue;
  const mx=(d.x0+d.x1)/2,my=(d.y0+d.y1)/2,horizontal=Math.abs(d.y0-d.y1)<1e-6;let a,b;
  if(horizontal){const Y=Math.round(my/S),X=Math.floor(mx/S);a=[X,Y-1];b=[X,Y];if(Y<=0||Y>=H)continue;edgeS[(Y-1)*W+X]=0;}
  else{const X=Math.round(mx/S),Y=Math.floor(my/S);a=[X-1,Y];b=[X,Y];if(X<=0||X>=W)continue;edgeE[Y*W+X-1]=0;}
  const [inn,out]=lotAt[a[1]*W+a[0]]===li?[a,b]:[b,a];
  if(!doors[li].some(o=>o.out.x===out[0]+.5&&o.out.y===out[1]+.5))doors[li].push({in:pt(...inn),out:pt(...out)});}});
 // Una casilla del lote cerca del centro de un cuarto del tipo pedido (o la primera del lote).
 const cellIn=(L,types)=>{for(const t of types){const r=L.levels[0].rooms.find(r=>r.type===t);if(r)return pt(Math.floor((r.x+r.w/2)/S),Math.floor((r.y+r.h/2)/S));}const [x,y]=cellsOf(L)[0];return pt(x,y);};
 const center=L=>{const cs=cellsOf(L),n=cs.length;return {x:cs.reduce((s,[x])=>s+x+.5,0)/n,y:cs.reduce((s,[,y])=>s+y+.5,0)/n};};
 const lots=bp.lots.map((L,i)=>({id:i,name:L.name,type:L.type,center:center(L),doors:doors[i],cells:cellsOf(L).map(([x,y])=>pt(x,y))}));
 // Cajas y computadores de la planta baja, en casillas (con decimales: el punto exacto del mueble).
 const crates=[],seats=[];
 bp.lots.forEach((L,li)=>{if(!doors[li].length)return;for(const f of L.levels[0].furniture){const p={x:(f.x+f.w/2)/S,y:(f.y+f.h/2)/S,lot:li};
  if(f.kind==='caja')crates.push(p);else if(f.pc)seats.push(p);}});
 // Los que se roban (2026-10-16): el botín del mundo (bp.botines, botin.js) que cae en la ciudad: un objetivo por objeto,
 // con su valor, su tiempo de tomarlo y su carga (cuánto frena). Se abre/toma desde su frente; la bolsa es el objeto.
 // Los del monte quedan fuera: la grilla del motor es la de la ciudad. Con «plan:E:S:edificios», lo de antes: un botín
 // por edificio robable (JUEGO.robables), en la bóveda o el depósito.
 const sites=[],VERBO={caja_fuerte:'Abrir la caja fuerte',joyas:'Romper la vitrina de las joyas',escultura:'Levantar la escultura',cuadro:'Descolgar el cuadro'};
 const enMotor=edificios?[]:(bp.botines||[]).filter(b=>b.lote!=null&&doors[b.lote].length);
 for(const b of enMotor){const L=bp.lots[b.lote],li=b.lote,frente={x:b.frente.x/S,y:b.frente.z/S},obj={x:b.x/S,y:b.z/S},de=`${b.nombre.toLowerCase()} de ${b.lugar}`;
  sites.push({id:b.id,lot:li,name:`${b.nombre} · ${b.lugar}`,botin:b.objeto,valor:b.valor,carga:b.carga,openTime:b.tiempo,panels:[frente],bagSpawns:[obj],lock:null,center:lots[li].center,guards:doors[li].map(d=>d.out),alarmLabel:`ALARMA EN ${b.lugar.toUpperCase()}`,
   panelLabels:[`${VERBO[b.objeto]||'Tomar'} de ${b.lugar}`],guardLabels:doors[li].map((_,j)=>`Vigilar la puerta ${j+1} de ${b.lugar}`),openLog:`Se llevan ${de}.`,returnLog:`devolvió ${de}.`});}
 if(!enMotor.length)bp.lots.forEach((L,li)=>{if(!ROBBABLE.includes(L.type)||!doors[li].length)return;const loot=cellIn(L,['boveda','deposito','oficina','recepcion']);
  sites.push({id:'s'+li,lot:li,name:L.name,panels:[loot],bagSpawns:[loot],lock:null,center:lots[li].center,guards:doors[li].map(d=>d.out),alarmLabel:`ALARMA EN ${L.name.toUpperCase()}`,
   panelLabels:[`Abrir la caja fuerte de ${L.name}`],guardLabels:doors[li].map((_,j)=>`Vigilar la puerta ${j+1} de ${L.name}`),openLog:`Se abrió la caja fuerte de ${L.name}.`,returnLog:`devolvió el botín a ${L.name}.`});});
 // la meta en valor (BOTIN.meta del valor que el motor juega); sin botín, la cuota de siempre
 const valorQuota=enMotor.length?Math.ceil(BOTIN.meta*enMotor.reduce((a,b)=>a+b.valor,0)):null;
 const si=bp.lots.findIndex(L=>L.type==='comisaria'),station=lots[si],jail=[cellIn(bp.lots[si],['deposito','oficina','recepcion'])];
 const rescuePanels=station.doors.map((d,i)=>({x:d.out.x,y:d.out.y,exit:{...d.out},name:i?'Acceso trasero':'Acceso lateral'}));
 const walk=p=>!grid[Math.floor(p.y)][Math.floor(p.x)];
 const copSpawns=station.doors.map(d=>({...d.out}));
 const thiefSpawns=c.thiefSpawns.filter(walk).map(p=>({x:p.x,y:p.y}));
 const siteAt=new Int8Array(W*H);sites.forEach((s,k)=>{for(const p of lots[s.lot].cells)siteAt[Math.floor(p.y)*W+Math.floor(p.x)]=k+1;});
 return {id,name:`Ciudad #${seed} · ${team} vs ${team} · plano`,plan:true,bp,W,H,grid,kind,K,edgeE,edgeS,lotAt,lots,crates,seats,
  names:c.names,blocks:c.blocks,team,city:true,lockAt:null,sites,deliveries:[],deliveryLabel:'HANGAR',rescuePanels,jailCells:jail,station:si,
  siteAt,doorAt:null,valorQuota,botinFuera:(bp.botines||[]).filter(b=>!enMotor.includes(b)),thiefSpawns:thiefSpawns.length?thiefSpawns:[...c.thiefSpawns],copSpawns,
  patrol:[...sites.flatMap(s=>s.guards),...rescuePanels.map(p=>({x:p.x,y:p.y}))],
  zones:[{x:jail[0].x-.45,y:jail[0].y-.45,w:.9,h:.9,label:'',kind:'jail'}]};
}
