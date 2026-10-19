/* El plano de la ciudad por etapas (FUGA, 2026-10-10). La ciudad queda definida en los datos, de lo grande a lo chico,
   y cada etapa sale sólo de la semilla y de la etapa anterior: la misma semilla da siempre la misma ciudad.

     1. Ciudad      el tamaño según los jugadores (ciudad.js).
     2. Manzanas    calles, avenidas y callejones por subdivisión (ciudad.js); cada manzana con su uso.
     3. Edificios   cada manzana se parte en lotes con frente a la calle; cada lote con tipo y nombre.
     4. Pisos       cuántos según el tipo, el tamaño y si da a una avenida.
     5. Núcleo      escalera (y ascensor desde 4 pisos) y el pasillo que sale de ahí.
     6. Cuartos     las franjas a los lados del pasillo se parten según el programa del tipo de edificio.
     7. Aberturas   una puerta por cuarto (al pasillo o al vecino), la puerta de calle y las ventanas en la fachada.
     8. Muebles     según el cuarto, contra las paredes y sin tapar puertas; siempre hay un rincón con computador.

   Escala: la ciudad sigue en casillas de 6 m (las del motor); adentro de los edificios todo va en metros, en una rejilla
   de 1 m. Coordenadas del plano: x a la derecha, y hacia abajo, en metros desde la esquina del mapa (el 3D usa z = y).
   Las paredes son líneas (el 3D les da grosor). El motor del juego (reglas y bots) no usa esto todavía. */
import {marcarMansardas} from './techos.js';
import {amoblarAzoteas} from './azoteas.js';
import City from './ciudad.js';
import {JUEGO_PASO,PUERTA,ESCALERA,PASILLO,MURO,ERGO,mm,FRANJA,MINIMO,VIDRIO,VENTANAS_FAMILIA,RESIDENCIAL,esVidriera,VENTANAS_VIVIENDA,VIDRIO_ENTERO,HABITABLE,JUEGO,ENCIERRO,CALLE,ALTURA,INTERIOR,MANZANA,LADERA,ESCALINATA,CHOQUE_MUEBLE,CORTINA,CIRCULACION,TERRAZA} from './medidas.js';
import {USOS} from './usos.js';
import {islaDe,mascaraRebaje} from './isla.js';
import {randomHouse,planHouse} from './vivienda.js';
import {planHogar,HOGAR_PESO} from './hogar.js';
import {MINIMOS} from './cuartos-minimos.js';
import {plantar} from './vegetacion.js';
import {crucesCiudad} from './veredas.js';
import {repartir} from './botin.js';
import {pintar} from './color.js';
import {marcarHojas} from './puertas.js';
import {numerar} from './direcciones.js';
import {pinturaDe} from './pintura.js';
import {cerrarCortinas} from './cortinas.js';
import {equipar} from './equipamiento.js';
import {BARRIOS,randomFacade} from './fachada.js';

export const CELL=6;// metros por casilla
const K=City.K;
function rng(seed){let n=seed>>>0;return()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
// Barajar con la semilla (nunca r() dentro de un sort: cuántas veces se llama depende del navegador).
const shuffle=(a,r)=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const mix=(...v)=>v.reduce((a,b)=>Math.imul(a^(b>>>0),0x9E3779B1)>>>0,0x85EBCA6B);

export const STAGES=[
 {id:1,name:'Terreno',rule:'El tamaño de la ciudad sale de la cantidad de jugadores (~200 casillas de 6 m por jugador). Alrededor, la isla (isla.js): pradera, playa, agua baja y dos o tres macizos de montaña, más claros cuanto más altos.'},
 {id:2,name:'Calles y manzanas',rule:'Las calles salen de cortar el mapa en dos una y otra vez; los cortes largos son avenidas. Cada manzana recibe un uso: edificios, parque, plaza, patio o la comisaría. Afuera, las calles siguen por las salidas del muro como carreteras de montaña, en grilla, y entre ellas quedan las manzanas del monte, aplanadas en terrazas.'},
 {id:3,name:'Lotes',rule:'Cada manzana se parte en lotes que dan a la calle: las angostas en una o dos filas, las anchas en un anillo con un patio adentro. Los callejones quedan libres. Cada lote recibe un tipo y un nombre. En el monte, cada manzana se parte en dos mitades con casas armadas que dan a la carretera.'},
 {id:4,name:'Pisos',rule:'Los pisos dependen del tipo (vivienda 3–7, oficinas 4–9, comercio 2–4…) y suben 2 si el edificio da a una avenida. Un lote de una casilla de frente es casa o local de un piso; uno de dos, como mucho 3 pisos. La planta baja es distinta: locales, recepción o garaje.'},
 {id:5,name:'Núcleo',rule:'Escalera (y ascensor desde 4 pisos) en el fondo, nunca en la fachada, donde deja más franja para departamentos (casi siempre en una punta); de ahí sale un pasillo de 1,5 m paralelo al frente que deja una crujía de cuartos adelante (6 m) y otra franja atrás.'},
 {id:6,name:'Cuartos',rule:'Cada franja se parte en cuartos de medidas reales según el programa del tipo. En las viviendas, en departamentos: se entra por la sala y los demás cuartos se abren a ella; el baño queda adentro, del lado del pasillo. Los pisos de arriba repiten el plano; la planta baja tiene el suyo.'},
 {id:7,name:'Puertas y ventanas',rule:'Cada cuarto tiene una puerta al pasillo (o al vecino si no hay pasillo); en un departamento, sólo la sala da al pasillo; la planta baja, la puerta de calle y las vitrinas. Ventanas donde el cuarto toca la calle o el patio, nunca en una medianera.'},
 {id:8,name:'Muebles',rule:'Según el cuarto, contra las paredes: nada delante de una ventana ni de una puerta. Cada mueble se prueba antes de dejarlo: las puertas tienen que seguir conectadas y cada mueble tiene que poder usarse (el costado de la cama, el frente del armario, del inodoro, de la estufa); si un cuarto queda mal, se amuebla de nuevo (hasta 12 veces) y queda el mejor. Lo esencial (cama, inodoro, lavamanos, estufa) va aunque no haya otro lugar. Todo edificio tiene al menos un escritorio con computador; hay cajas para esconder el botín. Las casas del monte, con sus muebles (vivienda.js).'},
 {id:9,name:'Mundo',rule:'Todo junto, como se juega: la ciudad con sus edificios por dentro y la isla con sus caminos, el globo y el parapente. Desde la etapa 1 cada etapa ya muestra la isla: las etapas cuentan lo que suma cada una, afuera y adentro.'},
];

// ---------- Etapa 2: el uso de cada manzana ----------
function classify(map){
 const {W,kind}=map,parks=new Set((map.parks||[]).map(p=>p.x0+','+p.y0));
 return map.blocks.map((b,i)=>{let plaza=0,court=0;for(let y=b.y0;y<=b.y1;y++)for(let x=b.x0;x<=b.x1;x++){const k=kind[y*W+x];if(k===K.plaza||k===K.kiosk)plaza++;if(k===K.courtyard)court++;}
  const use=map.station?.block===b?'comisaria':parks.has(b.x0+','+b.y0)?'parque':plaza?'plaza':court?'patio':'edificios';
  return {id:i,x0:b.x0,y0:b.y0,x1:b.x1,y1:b.y1,w:b.w,h:b.h,use,site:map.sites.find(s=>s.block===b)?.name||null};});
}

// ---------- Etapa 3: lotes ----------
// Parte un tramo de n casillas en trozos de 1–3 (más seguido 2), saltando las casillas «gap» (callejones).
function splitRun(n,gap,r){const out=[];let a=0;
 while(a<n){if(gap(a)){a++;continue;}let end=a;while(end<n&&!gap(end))end++;// tramo libre [a,end)
  for(let u=a;u<end;){const left=end-u;let w=left<=3?left:r()<.25?1:r()<.6?2:3;if(left-w===1&&w>1)w--;// no dejar un trozo suelto de 1 si se puede evitar
   out.push([u,u+w-1]);u+=w;}a=end;}
 return out;}
const SIDES=['N','S','W','E'],OUT={N:[0,-1],S:[0,1],W:[-1,0],E:[1,0]};

function makeLots(map,blocks,r){
 const {W,H,kind}=map,lots=[],owner=new Int32Array(W*H).fill(-1),courts=[];
 const walkable=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&kind[y*W+x]<K.SOLID&&kind[y*W+x]!==K.courtyard;
 // Un lote es una o dos alas (rectángulos de casillas): las de las esquinas en L tienen dos, una por calle.
 const wingOf=(x0,y0,x1,y1,front,role)=>({x0,y0,x1,y1,w:x1-x0+1,h:y1-y0+1,front,role});
 const add=(x0,y0,x1,y1,bl,extra={})=>{const id=lots.length;lots.push({id,block:bl.id,x0,y0,x1,y1,w:x1-x0+1,h:y1-y0+1,wings:[wingOf(x0,y0,x1,y1,null,'main')],...extra});for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)owner[y*W+x]=id;};
 const addL=(A,B,fA,fB,bl)=>{const id=lots.length,x0=Math.min(A[0],B[0]),y0=Math.min(A[1],B[1]),x1=Math.max(A[2],B[2]),y1=Math.max(A[3],B[3]);
  lots.push({id,block:bl.id,x0,y0,x1,y1,w:x1-x0+1,h:y1-y0+1,shape:'L',wings:[wingOf(...A,fA,'main'),wingOf(...B,fB,'arm')]});
  for(const p of [A,B])for(let y=p[1];y<=p[3];y++)for(let x=p[0];x<=p[2];x++)owner[y*W+x]=id;};
 for(const bl of blocks){
  if(bl.use==='parque'||bl.use==='plaza')continue;
  const isAlley=(x,y)=>kind[y*W+x]===K.alley;
  // (2026-10-16, Miguel: «que uno pueda tener acceso a los patios del centro»: un pasaje —un zaguán, una casilla de callejón
  // de lado a lado del anillo— en el medio de un lado que da a la calle; sin él, 24 de 26 patios quedaban encerrados)
  const pasaje=(X0,Y0,X1,Y1,fondo)=>{const calleK=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&(kind[y*W+x]===K.street||kind[y*W+x]===K.avenue);
   const lados=[{x:Math.floor((X0+X1)/2),y:Y0,dx:0,dy:1,fx:0,fy:-1,L:X1-X0},{x:Math.floor((X0+X1)/2),y:Y1,dx:0,dy:-1,fx:0,fy:1,L:X1-X0},{x:X0,y:Math.floor((Y0+Y1)/2),dx:1,dy:0,fx:-1,fy:0,L:Y1-Y0},{x:X1,y:Math.floor((Y0+Y1)/2),dx:-1,dy:0,fx:1,fy:0,L:Y1-Y0}]
    .filter(l=>calleK(l.x+l.fx,l.y+l.fy)).sort((a,b)=>b.L-a.L);const l=lados[0];if(!l)return;
   for(let k=0;k<fondo;k++){const x=l.x+l.dx*k,y=l.y+l.dy*k;kind[y*W+x]=K.alley;if(map.grid?.[y])map.grid[y][x]=0;}};
  if(bl.use==='patio'){// anillo de una casilla alrededor del patio (como en el mapa del juego), con los pasajes libres
   if(!(()=>{for(let x=bl.x0;x<=bl.x1;x++)for(const y of [bl.y0,bl.y1])if(isAlley(x,y))return true;for(let y=bl.y0;y<=bl.y1;y++)for(const x of [bl.x0,bl.x1])if(isAlley(x,y))return true;return false;})())pasaje(bl.x0,bl.y0,bl.x1,bl.y1,1);
   const ring=(cells,horiz)=>{const n=cells.length;for(const [a,b] of splitRun(n,i=>isAlley(...cells[i]),r)){const p=cells[a],q=cells[b];add(Math.min(p[0],q[0]),Math.min(p[1],q[1]),Math.max(p[0],q[0]),Math.max(p[1],q[1]),bl);}};
   const top=[],bot=[],lef=[],rig=[];for(let x=bl.x0;x<=bl.x1;x++){top.push([x,bl.y0]);bot.push([x,bl.y1]);}for(let y=bl.y0+1;y<bl.y1;y++){lef.push([bl.x0,y]);rig.push([bl.x1,y]);}
   ring(top);ring(bot);ring(lef);ring(rig);courts.push({x0:bl.x0+1,y0:bl.y0+1,x1:bl.x1-1,y1:bl.y1-1,block:bl.id});continue;}
  // Edificios: los callejones que cruzan la manzana entera la parten en tramos; cada tramo, en filas o en anillo.
  const cutX=[],cutY=[];for(let x=bl.x0;x<=bl.x1;x++){let all=true;for(let y=bl.y0;y<=bl.y1;y++)if(!isAlley(x,y)){all=false;break;}if(all)cutX.push(x);}
  for(let y=bl.y0;y<=bl.y1;y++){let all=true;for(let x=bl.x0;x<=bl.x1;x++)if(!isAlley(x,y)){all=false;break;}if(all)cutY.push(y);}
  const spans=(a,b,cuts)=>{const out=[];let s=a;for(let v=a;v<=b;v++){if(cuts.includes(v)){if(v>s)out.push([s,v-1]);s=v+1;}}if(s<=b)out.push([s,b]);return out;};
  for(const [x0,x1] of spans(bl.x0,bl.x1,cutX))for(const [y0,y1] of spans(bl.y0,bl.y1,cutY)){
   const w=x1-x0+1,h=y1-y0+1,gap=(x,y)=>isAlley(x,y);
   if(Math.min(w,h)<=4){// filas: lotes de lado a lado (o dos filas espalda con espalda si hay fondo de 4)
    const horiz=w>=h,depth=horiz?h:w,rows=depth>=4?[[0,Math.floor(depth/2)-1],[Math.floor(depth/2),depth-1]]:[[0,depth-1]];
    for(const [d0,d1] of rows){const n=horiz?w:h;
     for(const [a,b] of splitRun(n,i=>{for(let d=d0;d<=d1;d++)if(horiz?gap(x0+i,y0+d):gap(x0+d,y0+i))return true;return false;},r))
      horiz?add(x0+a,y0+d0,x0+b,y0+d1,bl):add(x0+d0,y0+a,x0+d1,y0+b,bl);}
   }else{// anillo de 2 casillas de fondo y un patio de manzana adentro
    // Las esquinas, a veces en L (70 %): el cuadro de la esquina más un brazo de 1–2 casillas hacia cada calle. El ala
    // principal (con el núcleo) va por la franja de arriba o de abajo; el ala del costado, por la franja lateral.
    pasaje(x0,y0,x1,y1,2);// (el zaguán al patio de la manzana: antes de partir el anillo en lotes)
    const d=2,hs=h-2*d,free=(a,b,c,e)=>{for(let y=b;y<=e;y++)for(let x=a;x<=c;x++)if(gap(x,y))return false;return true;};
    const use={tl:0,tr:0,bl:0,br:0,lt:0,lb:0,rt:0,rb:0};// casillas que se lleva cada L de cada franja
    for(const c of ['TL','TR','BL','BR']){if(r()>=.7)continue;let a=r()<.5?2:1,b=r()<.5?2:1;const top=c[0]==='T',left=c[1]==='L';
     const band=top?(left?'tl':'tr'):(left?'bl':'br'),bandO=top?(left?'tr':'tl'):(left?'br':'bl'),side=left?(top?'lt':'lb'):(top?'rt':'rb'),sideO=left?(top?'lb':'lt'):(top?'rb':'rt');
     while(a>0&&w-(d+a)-use[bandO]<0)a--;while(b>0&&hs-b-use[sideO]<0)b--;if(a<1||b<1)continue;
     const A=top?(left?[x0,y0,x0+d+a-1,y0+d-1]:[x1-d-a+1,y0,x1,y0+d-1]):(left?[x0,y1-d+1,x0+d+a-1,y1]:[x1-d-a+1,y1-d+1,x1,y1]);
     const B=left?(top?[x0,y0+d,x0+d-1,y0+d+b-1]:[x0,y1-d-b+1,x0+d-1,y1-d]):(top?[x1-d+1,y0+d,x1,y0+d+b-1]:[x1-d+1,y1-d-b+1,x1,y1-d]);
     if(!free(...A)||!free(...B))continue;use[band]=d+a;use[side]=b;addL(A,B,top?'N':'S',left?'W':'E',bl);}
    // El resto de cada franja, en lotes rectos.
    for(const [ya,yb,l,q] of [[y0,y0+d-1,use.tl,use.tr],[y1-d+1,y1,use.bl,use.br]])for(const [a,b] of splitRun(w-l-q,i=>gap(x0+l+i,ya)||gap(x0+l+i,yb),r))add(x0+l+a,ya,x0+l+b,yb,bl);
    for(const [xa,xb,t,q] of [[x0,x0+d-1,use.lt,use.lb],[x1-d+1,x1,use.rt,use.rb]])for(const [a,b] of splitRun(hs-t-q,i=>gap(xa,y0+d+t+i)||gap(xb,y0+d+t+i),r))add(xa,y0+d+t+a,xb,y0+d+t+b,bl);
    courts.push({x0:x0+d,y0:y0+d,x1:x1-d,y1:y1-d,block:bl.id});
   }}
 }
 // La comisaría y los objetivos del juego: el lote más grande de su manzana (los que dan a una avenida primero); el
 // resto de la manzana son edificios comunes. Una manzana entera como un solo edificio deja cuartos de 30 m de fondo.
 const special=[];for(const bl of blocks)if(bl.use==='comisaria'||bl.site)special.push(bl);
 const courtAt=new Set();for(const c of courts)for(let y=c.y0;y<=c.y1;y++)for(let x=c.x0;x<=c.x1;x++)courtAt.add(y*W+x);
 // Qué hay en una casilla vista desde el lote id: calle, avenida, patio, medianera (otro lote), interior (el mismo lote,
 // la otra ala de una L) o nada. Las ventanas se deciden con esto, casilla por casilla.
 // (los lotes primero: en el mapa del motor los pisos y cuartos de los edificios también se caminan, y no son calle)
 const OPEN=new Set([K.street,K.avenue,K.alley,K.plaza,K.kiosk]);
 const statusAt=(x,y,id)=>x<0||y<0||x>=W||y>=H?'nada':owner[y*W+x]===id?'interior':owner[y*W+x]>=0?'medianera':courtAt.has(y*W+x)||kind[y*W+x]===K.courtyard?'patio':
  OPEN.has(kind[y*W+x])?(kind[y*W+x]===K.avenue?'avenida':'calle'):'nada';
 const pick=st=>['avenida','calle','patio','medianera','interior','nada'].find(k=>st.includes(k))||'nada';
 const sidesOf=(R,id)=>{const out={};for(const s of SIDES){const cells=[];
   if(s==='N'||s==='S'){const y=s==='N'?R.y0-1:R.y1+1;for(let x=R.x0;x<=R.x1;x++)cells.push([x,y]);}else{const x=s==='W'?R.x0-1:R.x1+1;for(let y=R.y0;y<=R.y1;y++)cells.push([x,y]);}
   out[s]=pick(cells.map(([x,y])=>statusAt(x,y,id)));}return out;};
 for(const L of lots){L.area=L.wings.reduce((a,g)=>a+g.w*g.h,0);
  if(L.shape==='L'){for(const g of L.wings)g.sides=sidesOf(g,L.id);L.front=L.wings[0].front;L.sides={};for(const s of SIDES)L.sides[s]=pick(L.wings.map(g=>g.sides[s]));continue;}
  L.sides=sidesOf(L,L.id);
  // El frente: el lado más largo que da a la calle (las avenidas primero).
  const rank=s=>(L.sides[s]==='avenida'?2:L.sides[s]==='calle'?1:L.sides[s]==='patio'?.3:0)*10+(s==='N'||s==='S'?L.w:L.h);
  L.front=[...SIDES].sort((a,b)=>rank(b)-rank(a))[0];L.wings[0].front=L.front;L.wings[0].sides=L.sides;
 }
 for(const bl of special){const best=lots.filter(L=>L.block===bl.id).sort((a,b)=>((frenteDe(b)>=2)-(frenteDe(a)>=2))*100+b.area+(Object.values(b.sides).includes('avenida')?.5:0)-a.area-(Object.values(a.sides).includes('avenida')?.5:0)||a.id-b.id)[0];
  if(best){best.forced=bl.use==='comisaria'?'comisaria':'objetivo';best.siteName=bl.site;}}
 return {lots,courts,statusAt,ownerAt:(x,y)=>x<0||y<0||x>=W||y>=H?-1:owner[y*W+x]};
}

// ---------- Etapa 3 (b) y 4: tipo, nombre y pisos ----------
const NAMES=['Las Palmas','El Prado','San Andrés','Bolívar','Santander','La Esperanza','Los Andes','El Dorado','Miramar','La Colina','Santa Fe','Caribe',
 'Monserrate','La Sabana','Los Almendros','El Retiro','Alameda','La Candelaria','El Faro','Mirador','Las Brisas','La Aurora','San Martín','Nariño','Granada',
 'Castilla','La Floresta','Porvenir','El Sol','Altamira','Buenavista','Los Pinos','Primavera','La Ceiba','El Bosque','Guadalupe','Victoria','Atlántico',
 'Cristal','Esmeralda','Las Acacias','El Lago','Los Cerezos','Montecarlo','La Estrella','Cordillera','San José','Colonial','Del Mar','La Fuente','Los Robles',
 'Paraíso','Real','La Palma','Oriente','Occidente','Central','Panorama','Las Gaviotas','Los Naranjos','El Refugio','Santa Clara','La Pradera','Las Margaritas'];
export const TYPES={
 vivienda:{label:'Vivienda',floors:[3,7],ground:'locales',color:'#e7d7b8'},
 residencial:{label:'Residencial',floors:[3,5],ground:'recepcion',color:'#eadfc6'},// los edificios de las manzanas de la montaña
 oficinas:{label:'Oficinas',floors:[4,9],ground:'recepcion',color:'#c9d8e4'},
 comercio:{label:'Comercio',floors:[2,4],ground:'locales',color:'#efc9b4'},
 // (2026-10-15, decisión de Miguel: los lotes de una casilla de frente —6 m: no les cabe un departamento con alcoba al
 // lado de la escalera— son casas o locales de un piso, sin núcleo)
 casa:{label:'Casa',floors:[1,1],ground:'casa',color:'#dfe6c8'},
 local:{label:'Local',floors:[1,1],ground:'locales',color:'#f0d9b5'},
 hotel:{label:'Hotel',floors:[5,8],ground:'recepcion',color:'#e4cfe0'},
 hospital:{label:'Hospital',floors:[4,5],ground:'urgencias',color:'#f3dede'},
 colegio:{label:'Colegio',floors:[2,3],ground:'aulas',color:'#e9e2b8'},
 biblioteca:{label:'Biblioteca',floors:[2,2],ground:'lectura',color:'#d9cdb8'},
 bomberos:{label:'Bomberos',floors:[2,2],ground:'garaje',color:'#f0b9aa'},
 comisaria:{label:'Comisaría',floors:[3,3],ground:'recepcion',color:'#b9cfe6'},
 puesto:{label:'Puesto de policía',floors:[2,2],ground:'recepcion',color:'#9fbcdc'},
 objetivo:{label:'Objetivo',floors:[2,3],ground:'recepcion',color:'#f2e2a8'},
};
// El frente de un lote, en casillas: el largo de su lado que da a la calle (L.front).
export const frenteDe=L=>L.front==='N'||L.front==='S'?L.w:L.h;
// Y su fondo, en casillas.
export const fondoDe=L=>L.front==='N'||L.front==='S'?L.h:L.w;
// Los pisos que permite el encierro de la calle del frente de un lote (medidas.js ENCIERRO, CALLE).
export const anchoCalle=L=>(L.sides?.[L.front]==='avenida'?CALLE.avenida.casillas:CALLE.calle.casillas)*CELL;
export const enCentro=(L,map)=>{const cx=(L.x0+L.x1+1)/2,cy=(L.y0+L.y1+1)/2;return Math.hypot(cx-map.W/2,cy-map.H/2)<=ENCIERRO.radioCentro*Math.max(map.W,map.H)/2;};
export const maxPisos=(L,map)=>Math.max(1,Math.floor(anchoCalle(L)*(enCentro(L,map)?ENCIERRO.centro:ENCIERRO.max)/ALTURA.piso+1e-9));
function typeLots(lots,map,r,seed){
 const area=L=>L.area,center=L=>[(L.x0+L.x1)/2,(L.y0+L.y1)/2];
 // Los públicos van en los lotes más grandes, separados entre sí.
 const civic=['hospital','colegio','biblioteca','bomberos'].slice(0,map.team>=5?4:3),taken=[];
 for(const t of civic){const pool=lots.filter(L=>!L.forced&&!L.type&&area(L)>=4&&frenteDe(L)>=2&&fondoDe(L)>=2).map(L=>[L,area(L)+r()*3]).sort((a,b)=>b[1]-a[1]||a[0].id-b[0].id).map(x=>x[0]);
  const pick=pool.find(L=>taken.every(o=>{const [ax,ay]=center(L),[bx,by]=center(o);return Math.hypot(ax-bx,ay-by)>8;}))||pool[0];if(pick){pick.type=t;taken.push(pick);}}
 for(const L of lots){if(L.forced){L.type=L.forced;continue;}if(L.type)continue;
  const x=r();
  // Un lote de una casilla de frente es una casa o un local, de un piso y sin núcleo (ver TYPES.casa).
  // (un hotel pide 2 casillas de fondo: en una sola, sus habitaciones quedan detrás del pasillo, contra la medianera)
  L.type=frenteDe(L)===1?(x<.6?'casa':'local'):x<.5?'vivienda':x<.72?'oficinas':x<.92||fondoDe(L)<2?'comercio':'hotel';}
 // Pisos (etapa 4): rango del tipo, +2 si da a una avenida; nombres sin repetir.
 const nr=rng(mix(seed,77)),pool=[...NAMES];for(let i=pool.length-1;i>0;i--){const j=Math.floor(nr()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}let k=0;
 // (alturas, 2026-10-15: el rango del tipo daba casi todo 3–4 pisos. Ahora cada manzana tiene un PERFIL por semilla
 // —baja, media o alta: la fracción del tope del encierro que usa—, más alto cuanto más cerca del centro; las esquinas
 // suben un piso (marcan el cruce); nadie baja del encierro mínimo de su calle (ENCIERRO.min) y dos vecinos no se
 // separan más de ENCIERRO.salto pisos. Los públicos y las casas siguen con su rango fijo.)
 const hr=rng(mix(seed,91)),perfil=new Map(),FIJO=['casa','local','colegio','biblioteca','bomberos','comisaria','puesto','objetivo','hospital'];
 const perfilDe=L=>{if(!perfil.has(L.block)){const [cx,cy]=center(L),d=Math.min(1,Math.hypot(cx-map.W/2,cy-map.H/2)/(Math.max(map.W,map.H)/2)),x=hr()*(1-.3*d)+.3*(1-d);
  perfil.set(L.block,x<.33?ENCIERRO.perfiles[0]:x<.66?ENCIERRO.perfiles[1]:ENCIERRO.perfiles[2]);}return perfil.get(L.block);};
 const esquina=L=>Object.values(L.sides).filter(v=>v==='calle'||v==='avenida').length>=2;
 const tope=L=>Math.min(12,maxPisos(L,map),frenteDe(L)===2?3:12),piso=L=>Math.min(tope(L),Math.max(1,Math.ceil(anchoCalle(L)*ENCIERRO.min/ALTURA.piso-1e-9)));
 for(const L of lots){const T=TYPES[L.type],[a,b]=T.floors;
  if(FIJO.includes(L.type))L.floors=a+Math.floor(r()*(b-a+1));
  else L.floors=Math.max(piso(L),Math.round(tope(L)*perfilDe(L)+(hr()-.5))+(esquina(L)?1:0));
  // (2026-10-15, decisión de Miguel: un lote de 2 casillas de frente —12 m— no pasa de 3 pisos: sin ascensor, el núcleo es
  // la escalera sola, de 4 m, y al lado quedan 8 m de franja en vez de 6)
  // (el encierro de la calle, 2026-10-15: el alto no pasa el ancho de la calle a la que da el frente —ENCIERRO.max, y
  // ENCIERRO.centro en el centro de la ciudad—: con calles de 12 m, 4 pisos (6 en el centro); con avenidas de 18, 6 (9))
  L.floors=Math.min(L.floors,tope(L));}
 // el salto entre vecinos (lotes que se tocan, sin contar casas ni públicos: una casa al pie de una torre es ciudad):
 // se baja el más alto, sin pasar su mínimo
 {const own=new Map();for(const L of lots)for(let y=L.y0;y<=L.y1;y++)for(let x=L.x0;x<=L.x1;x++)own.set(y*map.W+x,L);
  const vec=new Map(lots.map(L=>[L,new Set()]));for(const [i,L] of own){for(const j of [i+1,i+map.W]){const M=own.get(j);if(M&&M!==L&&(j!==i+1||(i+1)%map.W)){vec.get(L).add(M);vec.get(M).add(L);}}}
  for(let it=0;it<6;it++){let n=0;for(const L of lots){if(FIJO.includes(L.type))continue;for(const M of vec.get(L))if(!FIJO.includes(M.type)&&L.floors-M.floors>ENCIERRO.salto){const f=Math.max(piso(L),M.floors+ENCIERRO.salto);if(f<L.floors){L.floors=f;n++;}}}if(!n)break;}}
 for(const L of lots){
  const nm=pool[k++%pool.length];
  L.name=L.type==='comisaria'?'Comisaría Central':L.type==='objetivo'?L.siteName:L.type==='hospital'?'Hospital '+nm:L.type==='colegio'?'Colegio '+nm:L.type==='biblioteca'?'Biblioteca '+nm:
   L.type==='bomberos'?'Estación de Bomberos':L.type==='hotel'?'Hotel '+nm:L.type==='casa'?'Casa '+nm:L.type==='local'?'Local '+nm:L.type==='oficinas'?(L.floors>=7?'Torre ':'Centro ')+nm:(L.floors>=6?'Torre ':r()<.5?'Edificio ':'Residencias ')+nm;}
}

// ---------- Una cuadra suelta (para el editor de edificios, /edificios) ----------
// Edificios en fila sobre una calle (de izquierda a derecha, pegados), cada uno {w, h (casillas), floors, type, fachada,
// name}; con su plano completo (buildLot: pisos, cuartos, escalera, muebles) como en la ciudad. Alrededor, plaza.
export function buildingRow(list,seed=1){const pad=2,Wc=list.reduce((a,b)=>a+b.w,0)+pad*2,Hc=Math.max(...list.map(b=>b.h))+pad*2,lots=[];let x=pad;
 for(const [i,b] of list.entries()){const x0=x,y0=pad,x1=x+b.w-1,y1=y0+b.h-1;x+=b.w;
  lots.push({id:i,block:0,x0,y0,x1,y1,w:b.w,h:b.h,wings:[{x0,y0,x1,y1,w:b.w,h:b.h,front:'S',role:'main'}],type:b.type||'vivienda',floors:b.floors||4,...(b.giro!==undefined?{giroWant:b.giro}:{}),name:b.name||'Edificio '+(i+1),fachada:b.fachada||null,area:b.w*b.h});}
 const owner=(cx,cy)=>lots.findIndex(L=>cx>=L.x0&&cx<=L.x1&&cy>=L.y0&&cy<=L.y1);
 for(const L of lots){const stat=(cx,cy,level)=>{const o=owner(cx,cy);if(o===L.id)return 'interior';if(o>=0)return level!=null&&lots[o].floors<=level?'alto':'medianera';return 'calle';};
  L.sides={};for(const sd of SIDES){const [dx,dy]=OUT[sd],cs=[];if(dx)for(let y=L.y0;y<=L.y1;y++)cs.push([dx>0?L.x1+1:L.x0-1,y]);else for(let xx=L.x0;xx<=L.x1;xx++)cs.push([xx,dy>0?L.y1+1:L.y0-1]);
   const st=cs.map(([cx,cy])=>owner(cx,cy)>=0?'medianera':'calle');L.sides[sd]=st.includes('calle')?'calle':'medianera';}
  L.front='S';L.wings[0].front='S';L.wings[0].sides=L.sides;buildLot(L,seed,stat);}
 const kind=new Uint8Array(Wc*Hc).fill(K.plaza);for(const L of lots)for(let y=L.y0;y<=L.y1;y++)for(let xx=L.x0;xx<=L.x1;xx++)kind[y*Wc+xx]=K.building;
 for(let xx=0;xx<Wc;xx++)kind[(Hc-1)*Wc+xx]=K.street;
 const map={W:Wc,H:Hc,seed,team:1,kind,blocks:[],sites:[],houses:[],hideouts:[],thiefSpawns:[],station:null,parks:[],names:null};
 return {map,plan:{lots,courts:[],isla:null,map}};}

// ---------- Las fachadas: variedad por barrio (2026-10-12) ----------
// La ciudad en una grilla de zonas de ~14 casillas; cada zona es un barrio con una familia de estilos (fachada.js:
// BARRIOS), y dos zonas vecinas en línea recta nunca tienen la misma. Cada lote: un estilo de su familia con una de sus
// pinturas (el del lote anterior de la misma manzana no se repite igual).
// La entrada principal del hospital (la de urgencias) y del hotel (2026-10-18, FACHADAS.md B5: no se reconocían desde la
// calle): la puerta de calle que no es del patio ni un portón y da a urgencias o, si no hay, la primera. El 3D le pone su
// marquesina (town3d, fachada3d MARQUESINA): sin letreros con texto, como se decidió con el low poly.
function marcarEntradas(bp){for(const L of bp.lots){if(L.type!=='hospital'&&L.type!=='hotel')continue;const lv=L.levels?.[0];if(!lv)continue;
 const ds=lv.doors.filter(d=>d.street&&!d.patio&&!d.bay),urg=ds.find(d=>lv.rooms.find(q=>q.id===d.a)?.type==='urgencias'),d=urg||ds[0];if(d)d.entrada=L.type==='hospital'?'urgencias':'hotel';}}
function facadeLots(lots,map,seed){const r=rng(mix(seed,555)),Z=Math.max(2,Math.round(Math.max(map.W,map.H)/14)),zw=map.W/Z,zh=map.H/Z,fams=Object.keys(BARRIOS),off=Math.floor(r()*fams.length);
 for(const L of lots){const zx=Math.floor((L.x0+L.x1+1)/2/zw),zy=Math.floor((L.y0+L.y1+1)/2/zh);L.barrio=fams[(zx+2*zy+off)%fams.length];L.zonaF=[zx,zy];
  const lr=rng(mix(seed,L.id,556)),prev=lots[L.id-1];let f=randomFacade(lr,{barrio:L.barrio});
  if(prev?.fachada&&prev.block===L.block&&prev.fachada.estilo===f.estilo&&prev.fachada.pintura===f.pintura)f=randomFacade(lr,{barrio:L.barrio});
  if(RESIDENCIAL.has(L.type)){if(VIDRIO_ENTERO.has(f.ventana1))f={...f,ventana1:'clave'};if(VIDRIO_ENTERO.has(f.ventana))f={...f,ventana:'piedra'};}// (A2: donde se vive, sin vidrio entero)
  L.fachada=f;}}

// ---------- Marco local de un lote ----------
// u corre a lo largo del frente, v desde la fachada hacia adentro. Lu × Lv son las medidas en ese marco.
// L es un ala (un rectángulo de casillas con su frente y sus lados); status(x,y) dice qué hay en la casilla de un punto.
function frame(L,status=()=>'nada'){const X0=L.x0*CELL,Y0=L.y0*CELL,Wm=L.w*CELL,Dm=L.h*CELL,f=L.front;
 const vertical=f==='W'||f==='E',Lu=vertical?Dm:Wm,Lv=vertical?Wm:Dm;
 const pt=(u,v)=>f==='N'?[X0+u,Y0+v]:f==='S'?[X0+Wm-u,Y0+Dm-v]:f==='W'?[X0+v,Y0+Dm-u]:[X0+Wm-v,Y0+u];
 const rect=(u0,v0,u1,v1)=>{const [ax,ay]=pt(u0,v0),[bx,by]=pt(u1,v1);return {x:Math.min(ax,bx),y:Math.min(ay,by),w:Math.abs(bx-ax),h:Math.abs(by-ay)};};
 // Lado del lote (N/S/W/E) que corresponde a cada lado local.
 const ROT={N:{front:'N',back:'S',left:'W',right:'E'},S:{front:'S',back:'N',left:'E',right:'W'},W:{front:'W',back:'E',left:'S',right:'N'},E:{front:'E',back:'W',left:'N',right:'S'}}[f];
 const local=(x,y)=>f==='N'?[x-X0,y-Y0]:f==='S'?[X0+Wm-x,Y0+Dm-y]:f==='W'?[Y0+Dm-y,x-X0]:[y-Y0,X0+Wm-x];
 // Qué hay justo afuera del lado «loc» en la posición t (u para adelante y atrás, v para los costados).
 const at=(loc,t,level)=>{const [x,y]=loc==='front'?pt(t,-.5):loc==='back'?pt(t,Lv+.5):loc==='left'?pt(-.5,t):pt(Lu+.5,t);return status(Math.floor(x/CELL),Math.floor(y/CELL),level);};
 return {Lu,Lv,pt,rect,local,at,side:loc=>L.sides[ROT[loc]]};}

// ---------- Etapas 5 y 6: núcleo, pasillo y cuartos (en el marco local) ----------
// Programa de cada tipo: qué cuartos van en la franja de adelante (con ventanas a la calle) y en la de atrás, con sus
// anchos posibles en metros. Se recorren en orden y se repiten.
const PROGRAM={
 vivienda:{front:[['sala',4,5],['dormitorio',3,4],['dormitorio',3,4]],back:[['cocina',3,3],['bano',2,2],['dormitorio',3,4]]},
 casa:{front:[['sala',4,5],['dormitorio',3,4]],back:[['cocina',3,3],['bano',2,2]]},
 oficinas:{front:[['oficina',3,4],['abierta',6,9],['oficina',3,4]],back:[['reuniones',4,5],['bano',2,2],['cocineta',2,3]]},
 comercio:{front:[['sala',4,5],['dormitorio',3,4]],back:[['cocina',3,3],['bano',2,2]]},
 hotel:{front:[['habitacion',4,4]],back:[['bano',2,2],['habitacion',4,4],['deposito',2,3]]},
 hospital:{front:[['habitacion_h',4,5]],back:[['enfermeria',4,5],['bano',2,2],['habitacion_h',4,5]]},
 colegio:{front:[['aula',7,8]],back:[['sanitario',3,3],['sala_prof',4,5],['aula',6,8]]},
 biblioteca:{front:[['lectura',8,12]],back:[['bano',2,2],['estanteria',4,6],['archivo',4,6],['estanteria',4,6]]},
 bomberos:{front:[['dormitorio_b',4,5],['sala',4,5]],back:[['cocina',3,4],['vestuario',3,4],['bano',2,2]]},
 comisaria:{front:[['oficina',3,4],['abierta',6,8]],back:[['celda',3,3],['celda',3,3],['interrogatorio',3,4],['bano',2,2],['evidencia',3,4]]},
 puesto:{front:[['oficina',3,4],['abierta',4,6]],back:[['celda',3,3],['bano',2,2],['dormitorio_b',3,4]]},
 objetivo:{front:[['oficina',3,4]],back:[['boveda',4,5],['bano',2,2]]},
};
// La planta baja: qué va en la franja de adelante (el vestíbulo siempre va frente al núcleo).
const GROUND={locales:[['local',5,8]],recepcion:[['recepcion',6,9],['oficina',3,4]],casa:[['sala',4,5],['cocina',3,3]],urgencias:[['urgencias',6,8],['consultorio',3,4]],
 aulas:[['secretaria',4,5],['aula',7,8]],lectura:[['prestamo',4,6],['lectura',8,12]],garaje:[['garaje',8,12]]};
const GROUND_BACK={locales:[['deposito',3,4],['bano',2,2]],recepcion:[['bano',2,2],['deposito',3,4]],casa:[['bano',2,2]],urgencias:[['bano',2,2],['consultorio',3,4]],
 aulas:[['comedor',6,8],['sanitario',3,3],['enfermeria',3,4]],lectura:[['bano',2,2],['estanteria',4,6],['infantil',4,6]],garaje:[['vestuario',3,4],['bano',2,2],['deposito',3,4]]};

// Parte [a,b] en cuartos según el programa (cíclico). Ningún cuarto queda de menos de 2 m: el sobrante va al último.
// Anchos pares: los tabiques caen en las juntas de los módulos de fachada de 2 m, así cada módulo es entero de un cuarto
// y lleva su ventana (un tabique a mitad de módulo dejaba ese módulo ciego).
const evenIn=(mn,mx,r)=>{const ev=[];for(let w=2*Math.ceil(mn/2);w<=mx;w+=2)ev.push(w);return ev.length?ev[Math.floor(r()*ev.length)]:2*Math.ceil(mn/2);};
// (depth: el fondo de la franja; un cuarto habitable no pasa de MINIMO.proporcion con sus lados libres: si le toca más
// largo, se parte en cuartos iguales del mismo tipo, 2026-10-15)
function fill(a,b,prog,r,start=0,depth=Infinity){const out=[];let u=a,i=start;
 // (si lo que sobra no alcanza para el cuarto que sigue —un dormitorio de 2 m no tiene dónde poner la cama—, se lo queda
 // este)
 // (2026-10-15: y si lo que sobra no llega al mínimo de este, no se hace un cuarto chico —una celda de 2 m, sin paso al
 // costado del catre—: lo suma el anterior)
 while(b-u>0){const [type,mn,mx]=prog[i%prog.length],nextMin=prog[(i+1)%prog.length][1];let w=evenIn(mn,mx,r);if(b-u-w<Math.max(2,nextMin))w=b-u;
  // (y si no hay anterior: el primer tipo del programa cuyo mínimo entra; si ninguno, un depósito)
  if(w<mn-1e-9){if(out.length){out[out.length-1].u1=b;break;}const alt=prog.find(p=>p[1]<=w+1e-9);out.push({type:alt?alt[0]:'deposito',u0:u,u1:u+w});u+=w;i++;continue;}
  const cap=HABITABLE.has(type)&&isFinite(depth)?2*Math.floor(((depth-MURO.tabique)*MINIMO.proporcion+MURO.tabique)/2+1e-9):Infinity;
  if(w>cap+1e-9){const k=Math.ceil(w/cap-1e-9),pw=2*Math.floor(w/k/2+1e-9);for(let j=0;j<k;j++){const w2=j<k-1?pw:w-pw*(k-1);out.push({type,u0:u,u1:u+w2});u+=w2;}i++;continue;}
  out.push({type,u0:u,u1:u+w});u+=w;i++;}
 return out;}

// Departamentos (vivienda y los pisos de arriba del comercio). Una franja [a,b] × [v0,v1] con el pasillo del lado
// «corr» ('v0' o 'v1') se parte en departamentos de 5–12 m de frente. Se entra por la sala (la única puerta al
// pasillo) y los demás cuartos se abren a la sala. El baño queda del lado del pasillo, sin ventana, como en un edificio
// de verdad; la cocina y los dormitorios, del lado de la fachada.
//   ≥10 m: dormitorio | sala | cocina sobre baño      7–9 m: sala con cocineta | dormitorio sobre baño
//   5–6 m: estudio | baño                             <5 m: depósito (al pasillo)
// El departamento de 6 m de fondo desde sus cuartos: los anchos de cada combinación (alcobas de mayor a menor, la sala, la
// cocina aparte si entra) y el reparto de lo que sobra. Devuelve null si ni una alcoba entra (va un estudio).
const G05=v=>Math.ceil(v*2-1e-6)/2;
const minW=(k,depth)=>{const M=MINIMOS[k];let best=null;for(const o of ['hondo','ancho']){const m=M?.[o];if(!m)continue;for(const [w,d] of [m,[m[1],m[0]]])if(d<=depth+1e-6&&(best==null||w<best))best=w;}return best==null?null:G05(best);};
const UNIT_COMBOS=[['dormitorio_principal','dormitorio_dos_camas','dormitorio_estudiante'],['dormitorio_principal','dormitorio_dos_camas'],['dormitorio_principal'],['dormitorio_doble']];
// (sep: la cocina aparte primero, aunque cueste una alcoba —el azar del departamento: uno de cada cuatro—)
// (2026-10-15, decisión de Miguel) Cada alcoba y la sala tienen que contener los módulos de ventana ENTEROS que pide su
// superficie para tener luz (MINIMO.luz) con la ventana más grande de la familia del edificio (gmax, m² de vidrio); D: el
// fondo de la sala, que va de punta a punta del departamento.
export function unitPlan(W,fd,u0,u1,mirror,sep=false,D=fd+FRANJA.interior,gmax=2){const bathW=G05(Math.max(2,minW('bano',2)||2.5)),cocMin=2.5;
 // (proporciones, 2026-10-15: ningún cuarto habitable más alargado que MINIMO.proporcion con sus lados libres: la sala,
 // que va de punta a punta del departamento, por lo menos D/2; cada alcoba, como mucho el doble de su fondo)
 const T=MURO.tabique,salaMin=Math.max(3,G05((D-T)/MINIMO.proporcion+T)),bedMax=Math.floor(((fd-T)*MINIMO.proporcion+T)*2+1e-9)/2;
 // (¿la ventana? una franja [x0, x1] tiene un módulo de 2 m entero adentro, en coordenadas del lote —con el espejo—)
 const real=(x0,x1)=>mirror?[u0+u1-x1,u0+u1-x0]:[x0,x1],mods=(x0,x1)=>{const [p,q]=real(x0,x1);return Math.max(0,Math.floor(q/2+1e-9)-Math.ceil(p/2-1e-9));};
 const need=area=>Math.max(1,Math.ceil(area*MINIMO.luz/gmax-1e-9)),hasMod=(x0,x1,area)=>mods(x0,x1)>=need(area);
 for(const coc of sep?[true,false]:[false,true])for(const combo of UNIT_COMBOS){const base=combo.map(k=>minW(k,fd));if(base.some(v=>v==null))continue;base[0]=Math.max(base[0],bathW+PASILLO.hall);// (el hall: lo que la primera alcoba pasa del baño)
  {const need=base.reduce((a,b)=>a+b,0)+salaMin+(coc?cocMin:0);if(need>W+1e-6)continue;
   // Lo que sobra (2026-10-15: búsqueda; antes un reparto fijo —primero la sala hasta 5 m, después las alcobas— que con
   // ladrillo daba alcoba en 10 y 14 m pero no en 12: la sala de 5,5 pedía 3 módulos de ventana y le caían 2). Se prueban
   // los anchos de sala (los más cerca de 5 m primero) y, para cada uno, lo que va a la primera alcoba (corre los tabiques);
   // el resto, a las alcobas sin pasar bedMax y lo que no les entra a la cocina (sin cocina, ese ancho de sala no sirve).
   // Gana la primera en que cada alcoba y la sala tienen los módulos de ventana que pide su superficie.
   const extra=W-need,salas=[];for(let sv=salaMin;sv<=salaMin+extra+1e-9;sv+=.5)salas.push(sv);salas.sort((a,b)=>Math.abs(a-5)-Math.abs(b-5)||b-a);
   for(const sala of salas)for(let shift=0;shift<=Math.min(extra-(sala-salaMin),3)+1e-9;shift+=.5){const beds=[...base];beds[0]+=shift;if(beds[0]>bedMax+1e-9)break;
    let left=extra-(sala-salaMin)-shift;for(let i=0,idle=0;left>1e-9&&idle<beds.length;i=(i+1)%beds.length){if(beds[i]+.5>bedMax+1e-9){idle++;continue;}idle=0;const d=Math.min(.5,left);beds[i]+=d;left-=d;}
    if(left>1e-9&&!coc)continue;
    let x=u0;const ok=beds.every(w=>{const r=hasMod(x,x+w,w*fd);x+=w;return r;})&&hasMod(x,x+sala,sala*D);
    if(ok)return {combo,w:{beds,salaW:sala,cocW:coc?W-beds.reduce((a,b)=>a+b,0)-sala:0,bathW}};}}}
 return null;}
// Los largos de departamento que dan 1, 2 y 3 alcobas en una franja de D m de fondo (inner: la franja interior): el menor
// largo con que unitPlan arma esa cantidad (con fachada de 3,5 m: 8, 12 y 15). En una franja de menos de 5 m de fondo
// —la de atrás de un lote de 12 m— la única variante con alcoba pide 10 m (ver abajo).
const UNIT_LEN=new Map();
export function unitLengths(D,inner,gmax=2){const k=D+'|'+inner+'|'+gmax;if(UNIT_LEN.has(k))return UNIT_LEN.get(k);let out=[];
 if(D>=5){const fd=D-inner;for(const n of [1,2,3])for(let w=5;w<=24;w+=.5){const P=unitPlan(w,fd,0,w,false,false,D,gmax);if(P&&P.combo.length>=n){if(!out.includes(w))out.push(w);break;}}}
 else if(D>=4)out=[10];
 UNIT_LEN.set(k,out);return out;}
function apartments(a,b,v0,v1,corr,r,band,units,gmax=2){
 const out=[],D=v1-v0,inner=FRANJA.interior,split=corr==='v1'?[v0,v1-inner,v1]:[v0,v0+inner,v1];// [fachada | pasillo] en profundidad
 const facade=corr==='v1'?[split[0],split[1]]:[split[1],split[2]],hallSide=corr==='v1'?[split[1],split[2]]:[split[0],split[1]];
 // El reparto (2026-10-15, decisión de Miguel): departamentos de los largos que dan 1, 2 o 3 alcobas en esta franja
 // (unitLengths, desde unitPlan), al azar entre los que entran; lo que sobra y no llega al más corto se suma al último
 // (antes: cortes de 8–12 m al azar, y el resto —a menudo 6 m— quedaba como un monoambiente).
 const widths=[],Ls=unitLengths(D,inner,gmax);let u=a;
 if(!Ls.length||b-a<Ls[0])widths.push(b-a);
 else while(b-u>1e-9){const fit=Ls.filter(l=>l<=b-u+1e-9);if(!fit.length){widths[widths.length-1]+=b-u;break;}const w=fit[Math.floor(r()*fit.length)];widths.push(w);u+=w;if(b-u>1e-9&&b-u<Ls[0]-1e-9){widths[widths.length-1]+=b-u;break;}}
 u=a;for(const W of widths){const u0=u,u1=u+W;u=u1;
  if(W<5){out.push({type:'deposito',u0,u1,v0,v1,band});continue;}
  const unit={u0,u1,v0,v1,n:units.length+1};units.push(unit);const mirror=r()<.5,col=(x0,x1)=>mirror?[u0+u1-x1,u0+u1-x0]:[x0,x1];
  const room=(type,x0,x1,va,vb,extra={})=>{const [p,q]=col(x0,x1);const o={type,u0:p,u1:q,v0:va,v1:vb,band,unit:unit.n,...extra};out.push(o);return o;};
  // Fondo de 6 m (2026-10-12, con las reglas de zonificación de la vivienda): la franja de fachada (4 m) lleva lo que
  // necesita ventana —alcobas y sala— y la de adentro (2 m, junto al pasillo) el hall de alcobas, los baños y la zona de
  // ropas. Zona social (sala, cocina) a la entrada; la privada (alcobas y su baño) detrás de un hall: ninguna alcoba ni
  // baño abre a la sala, y no se cruza un cuarto para llegar a otro. La cocina, en línea a todo el fondo (con la ventana
  // en la punta y la lavadora adentro), da a la sala. (Con una zona de ropas aparte, la cocina de 2×4 perdía 70 cm por la
  // puerta de ropas y 45 por la ventana: mesón, estufa y nevera no entraban en una de cada tres.)
  // 16 m: 3 alcobas, 12–14: 2 alcobas, 8–10: 1 alcoba.
  // De adentro hacia afuera (2026-10-12): los cuartos van en una grilla de 0,5 m, cada uno del ancho de su mínimo (la tabla
  // cuartos-minimos.js, con el fondo de la franja); el departamento toma la combinación más completa que le entra
  // (unitPlan) y lo que sobra agranda la sala y después las alcobas. Las ventanas siguen en módulos de 2 m (las piezas
  // de la fachada): un tabique en medio de un módulo lo deja sin ventana, así que el reparto busca que cada alcoba y la
  // sala tengan un módulo entero. Orden: [alcobas sobre (baño | hall)] [sala] [cocina], el hall llega hasta la sala.
  if(D>=5&&W>=7){const f=facade,h=hallSide,P=unitPlan(W,f[1]-f[0],u0,u1,mirror,r()<.25,D,gmax);
   if(P){const {beds,salaW,cocW,bathW}=P.w;let x=u0;const bedR=beds.map(w=>{const r0=[x,x+w];x+=w;return r0;}),uB=x;
    const sala=room(cocW?'sala':'sala_cocina',uB,uB+salaW,v0,v1,{entry:true}),hall=room('hall',u0+bathW,uB,h[0],h[1],{doorTo:sala});
    bedR.forEach(([x0,x1])=>room('dormitorio',x0,x1,f[0],f[1],{doorTo:hall}));room('bano',u0,u0+bathW,h[0],h[1],{doorTo:hall});
    if(cocW)room('cocina',uB+salaW,u1,v0,v1,{doorTo:sala});}
   else{const est=room('estudio',u0,u1-2,v0,v1,{entry:true});room('bano',u1-2,u1,v0,v1,{doorTo:est});}}
  // (la sala, como mucho MINIMO.proporcion veces su fondo libre —con pasillos de 2 m el fondo bajó a 4 y una sala de 8×4
  // quedaba alargada—; lo que sobra, al dormitorio)
  else if(W>=10&&D>=4){const sw=2,salaMax=Math.floor(((D-MURO.tabique)*MINIMO.proporcion+MURO.tabique)*2+1e-9)/2,salaW=Math.min(W-4-sw,salaMax),dw=W-sw-salaW;
   // (4 m de fondo: cocina abierta en la sala —una cocina aparte de 2×2 no tenía lugar para el mesón— y el baño a todo
   // el fondo; el hall no cabe: el dormitorio da a la sala)
   const sala=room('sala_cocina',u0+dw,u0+dw+salaW,v0,v1,{entry:true});room('dormitorio',u0,u0+dw,v0,v1,{doorTo:sala});
   room('bano',u0+dw+salaW,u1,v0,v1,{doorTo:sala});}
  // (con 4 m de fondo, el dormitorio de adelante quedaría de 2 m: ahí mejor un estudio con su baño)
  else if(W>=7&&D>=5){const sw=4;const sala=room('sala_cocina',u0,u1-sw,v0,v1,{entry:true});
   room('dormitorio',u1-sw,u1,facade[0],facade[1],{doorTo:sala});room('bano',u1-sw,u1,hallSide[0],hallSide[1],{doorTo:sala});}
  else{const est=room('estudio',u0,u1-2,v0,v1,{entry:true});room('bano',u1-2,u1,v0,v1,{doorTo:est});}}
 return out;}

// Habitaciones en suite (los pisos de hotel y de hospital): una franja [a,b] × [v0,v1] con el pasillo del lado «corr»
// se parte en habitaciones de 4 m de frente; cada una con su entrada desde el pasillo (2 × 2 m, del lado del pasillo),
// el baño al lado de la entrada (sin ventana, como en un hotel de verdad) y la habitación del lado de la fachada.
// Con menos de 5 m de fondo, otra forma (ver abajo).
// El baño de una suite de hotel u hospital: lo que pide la tabla de mínimos (el baño con ducha, con el cuerpo de la
// prueba), en la grilla de 0,5 m (2026-10-15: antes 2 m fijos, y con el paso de 800 el lavamanos y la ducha no se usaban).
const SUITE_BANO=()=>G05(Math.max(...(MINIMOS.bano?.hondo||[2,2])));
function suites(a,b,v0,v1,corr,r,band,type){const SB=SUITE_BANO(),out=[],D=v1-v0,hall=corr==='v1'?[v1-SB,v1]:[v0,v0+SB],face=corr==='v1'?[v0,v1-SB]:[v0+SB,v1];
 // Fondo corto (menos de 5 m): suites de 6 m de frente, la habitación de 4 m entra directo del pasillo y el baño ocupa
 // todo el fondo a un costado (2 m de ancho); la cama cabe a lo largo.
 if(D<5){let u=a;while(b-u>0){let W=6;if(b-u-W<5)W=b-u;const u0=u,u1=u+W;u=u1;
   if(W<5||D<3.5){out.push({type:'deposito',u0,u1,v0,v1,band});continue;}// donde no cabe una suite: el cuarto de servicio
   const mir=r()<.5,bx=mir?[u1-SB,u1]:[u0,u0+SB],rx=mir?[u0,u1-SB]:[u0+SB,u1],room={type,u0:rx[0],u1:rx[1],v0,v1,band};
   out.push(room,{type:'bano',u0:bx[0],u1:bx[1],v0,v1,band,doorTo:room});}
  return out;}
 let u=a;while(b-u>0){let W=4;if(b-u-W<3)W=b-u;const u0=u,u1=u+W;u=u1;
  if(W<4){out.push({type:'deposito',u0,u1,v0,v1,band});continue;}
  const mir=r()<.5,bx=mir?[u1-SB,u1]:[u0,u0+SB],ex=mir?[u0,u1-SB]:[u0+SB,u1];
  const ent={type:'entrada',u0:ex[0],u1:ex[1],v0:hall[0],v1:hall[1],band};
  out.push({type,u0,u1,v0:face[0],v1:face[1],band,doorTo:ent},ent,{type:'bano',u0:bx[0],u1:bx[1],v0:hall[0],v1:hall[1],band,doorTo:ent});}
 return out;}

// El ancho de la escalera del núcleo en un ala de Lu × Lv m (ver layoutFloor).
export const STAIR_W=ESCALERA.ancho;
export const stairWidth=(Lu,Lv)=>Lv<=8&&Lu-STAIR_W<4?ESCALERA.anchoAngosta:STAIR_W;
// La escalera en U: FR m de umbral, tramos de 9 peldaños de 28 cm de huella (y 16,7 cm de alto: 18 por piso de 3 m) y
// el descanso con lo que queda del fondo del núcleo (2026-10-15: antes 10 peldaños de 25 × 15 cm y descanso de 1 m).
export const STAIR_STEPS=ESCALERA.peldanos,STAIR_TREAD=ESCALERA.huella,STAIR_FR=ESCALERA.umbral;
// opt.noCore: el ala del costado de una L (sin núcleo: su pasillo sigue en el ala principal). opt.reserve: {u0,u1},
// un paso de 2 m en la franja de atrás del ala principal, donde llega el pasillo del ala del costado.
// Dónde empieza el pasillo en un ala de Lv m de fondo (de PASILLO.ancho): adelante queda una crujía de departamentos
// (FRANJA.fachada + FRANJA.interior = 6 m) mientras alcance; en las muy hondas, al medio. La usan layoutFloor y la L.
export const corridorAt=Lv=>Lv<=14?Lv-(FRANJA.fachada+FRANJA.interior):Math.min(FRANJA.maxLuz,(Lv-PASILLO.ancho)/2);
// El ancho del pasillo en un ala de Lv m de fondo: PASILLO.ancho, y en las muy hondas lo que dejan las dos franjas de
// FRANJA.maxLuz (2026-10-15: con lotes de 18 m las franjas de 8 y 8,5 m no se podían iluminar; ahora 7,5 + 3 + 7,5).
export const pasilloDe=Lv=>Lv<=14?PASILLO.ancho:Math.max(PASILLO.ancho,Lv-2*corridorAt(Lv));
function layoutFloor(L,F,level,r,opt={}){
 // Núcleo: la escalera (STAIR_W m: dos tramos de ~1,9 m, medidas reales y cómoda para jugar, 2026-10-15; antes 2 m,
 // tramos de 0,88 m) y, desde 4 pisos, el ascensor de 2 m al lado. Donde no cabe —un lote de 6 m de frente y una sola
 // fila de cuartos— la escalera vuelve a 2 m y sin ascensor, para que el piso tenga cuartos.
 const {Lu,Lv}=F,T=TYPES[L.type],sw=stairWidth(Lu,Lv),lift=L.floors>=4&&!(Lv<=8&&Lu-sw-2<4),cw=sw+(lift?2:0);
 const rooms=[],corr=[],units=[];let core;
 const homes=level>0&&(L.type==='vivienda'||L.type==='comercio'||L.type==='residencial');// pisos de departamentos
 const suite=level>0&&(L.type==='hotel'||L.type==='hospital')?(L.type==='hotel'?'habitacion':'habitacion_h'):null;// pisos de habitaciones en suite
 const ground=level===0;let prog=ground?{front:GROUND[T.ground]||GROUND.recepcion,back:GROUND_BACK[T.ground]||GROUND_BACK.recepcion}:PROGRAM[L.type==='comercio'&&level>0?'vivienda':L.type]||PROGRAM.vivienda;
 // Los locales también al patio (2026-10-17, Miguel: «entrar a los edificios desde el parque interior, como si fueran
 // tiendas también por ahí»): si la mayor parte de atrás da al patio de la manzana, la franja de atrás de la planta baja
 // es otro local —del mismo giro—, con su puerta y su vidriera al patio (y el baño y el depósito al lado).
 const patioAtras=ground&&T.ground==='locales'&&(()=>{const ms=modulesIn(0,Lu);return ms.length>=3&&ms.filter(m=>F.at('back',m+1,0)==='patio').length*2>ms.length;})();
 if(patioAtras)prog={...prog,back:[['local',5,8],['bano',2,2],['deposito',3,4]]};
 // La casa de un piso, sin núcleo (lotes de una casilla de frente, 2026-10-15): un programa de casa —se entra a la
 // sala-cocina desde la calle; atrás, el dormitorio y el baño—; en 6 m de fondo (una fila), monoambiente y baño.
 const casa1=ground&&L.type==='casa'&&L.floors<2;
 // (el vidrio de la ventana más grande que puede usar este edificio: para los módulos que pide cada cuarto)
 const gFam=Math.max(...(VENTANAS_FAMILIA[L.fachada?.familia]||VENTANAS_FAMILIA.ladrillo).map(k=>VIDRIO.ventana[k]||.55));
 // (donde se vive, a lo sumo la de VENTANAS_VIVIENDA: sin vidrio entero —FACHADAS.md A2—; sólo cambia en la familia de metal)
 const gmax=RESIDENCIAL.has(L.type)?Math.min(gFam,Math.max(...VENTANAS_VIVIENDA.map(k=>VIDRIO.ventana[k]))):gFam;
 if(casa1){prog.front=Lv<=8?[['estudio',4,4],['bano',2,2]]:[['sala_cocina',6,8]];prog.back=[['dormitorio',4,4],['bano',2,2]];}
 const res=opt.reserve,clash=p=>res&&p<res.u1&&p+cw>res.u0;
 // Dónde va el núcleo (2026-10-15, decisión de Miguel: antes centrado, partía la franja de atrás en dos pedazos de 6 m
 // que sólo daban monoambientes): en el lugar —en un metro par: la fachada va en módulos de 2 m y el vestíbulo, frente al
 // núcleo, tiene que tener uno entero— que deja más franja de atrás APROVECHABLE (tramos que llegan al largo de un
 // departamento con alcoba, unitLengths), sin chocar con el paso del ala del costado; a igual resultado, en una punta.
 const backD=Lv-corridorAt(Lv)-pasilloDe(Lv),Lmin=unitLengths(backD,FRANJA.interior)[0]??Infinity;
 const coreScore=p=>{const solid=[[p,p+cw],...(res?[[res.u0,res.u1]]:[])].sort((a,b)=>a[0]-b[0]);let u=0,ok=0,waste=0;
  for(const [a,b] of solid){if(a>u){const g=a-u;if(g>=Lmin-1e-9)ok+=g;else waste+=g;}u=Math.max(u,b);}if(Lu>u){const g=Lu-u;if(g>=Lmin-1e-9)ok+=g;else waste+=g;}
  // (y la escalera no a más de ESCALERA.pasilloMax de cada punta del pasillo: evacuación)
  const far=Math.max(p,Lu-(p+cw));return ok*100-waste+(p===0||p===Lu-cw?.5:0)-(far>ESCALERA.pasilloMax?(far-ESCALERA.pasilloMax)*1e4:0);};
 let coreU=null,bestS=-Infinity;for(let p=0;p<=Lu-cw+1e-9;p+=2){if(clash(p))continue;const sc=coreScore(p);if(sc>bestS+1e-9){bestS=sc;coreU=p;}}
 if(coreU===null)coreU=Math.max(0,Math.min(Lu-cw,2*Math.round((Lu-cw)/4)));
 if(Lv<=8){// lote de 6 m de fondo: una sola fila de cuartos, núcleo en un extremo y un descanso delante
  // (sin núcleo —un piso—: los cuartos de punta a punta, sin descanso)
  const cu=opt.noCore?Lu:Lu-cw;if(!opt.noCore){core={u0:cu,v0:Lv-4,u1:Lu,v1:Lv};corr.push({u0:cu,v0:0,u1:Lu,v1:Lv-4});}
  // Un solo departamento por piso: se entra por la sala (al lado del descanso); el dormitorio y el baño (detrás del
  // dormitorio) se abren a ella. Si no cabe, un estudio con su baño.
  if(homes){units.push({u0:0,u1:cu,v0:0,v1:Lv,n:1});
   if(cu>=7){const dw=Math.min(4,cu-4),sala={type:'sala_cocina',u0:dw,u1:cu,v0:0,v1:Lv,band:'front',unit:1};
    rooms.push({type:'dormitorio',u0:0,u1:dw,v0:0,v1:Lv-2,band:'front',unit:1,doorTo:sala},{type:'bano',u0:0,u1:dw,v0:Lv-2,v1:Lv,band:'front',unit:1,doorTo:sala},sala);}
   else{const est={type:'estudio',u0:2,u1:cu,v0:0,v1:Lv,band:'front',unit:1};rooms.push({type:'bano',u0:0,u1:2,v0:0,v1:Lv,band:'front',unit:1,doorTo:est},est);}}
  // Hotel u hospital: un pasillo de 2 m a lo largo del frente (sigue en el descanso del núcleo) y detrás, una tras otra,
  // la habitación de 4 m con su baño de 2 m al costado, cada una con su puerta al pasillo (2026-10-12: antes iban en
  // fila sin pasillo, habitación | baño | habitación…, y el baño de en medio dejaba las habitaciones sin salida).
  else if(suite){corr.push({u0:0,v0:0,u1:cu,v1:2,hall:true});let u=0;while(cu-u>0){let W=6;if(cu-u-W<5)W=cu-u;const u0=u,u1=u+W;u=u1;
    if(W<5){rooms.push({type:'deposito',u0,u1,v0:2,v1:Lv,band:'back',hall:true});continue;}
    const SB=SUITE_BANO(),room={type:suite,u0,u1:u1-SB,v0:2,v1:Lv,band:'back',hall:true};rooms.push(room,{type:'bano',u0:u1-SB,u1,v0:2,v1:Lv,band:'back',doorTo:room});}}
  else fill(0,cu,prog.front,r,0,Lv).forEach((q,i)=>rooms.push({...q,v0:0,v1:Lv,band:'front',chain:i}));
 }else{// pasillo de 2 m a lo largo del frente
  const c0=corridorAt(Lv),P=pasilloDe(Lv);corr.push({u0:0,v0:c0,u1:Lu,v1:c0+P});
  core=opt.noCore?null:{u0:coreU,v0:c0+P,u1:coreU+cw,v1:Lv};
  // (en una franja de atrás más honda que el núcleo —las de 7,5 m de los lotes hondos—, el núcleo va contra el fondo con su
  // medida y lo de delante es un vestíbulo de la escalera, parte del pasillo: si no, quedaba un sobrante encerrado)
  if(core&&Lv-core.v0>ESCALERA.fondoNucleo+.5){const v=Lv-ESCALERA.fondoNucleo;corr.push({u0:core.u0,v0:core.v0,u1:core.u1,v1:v});core.v0=v;}
  const pass=res?{u0:res.u0,v0:c0+P,u1:res.u1,v1:Lv}:null;if(pass)corr.push(pass);
  // Adelante: en planta baja, el vestíbulo frente al núcleo y la puerta de calle; arriba, cuartos de lado a lado.
  if(ground&&!core)fill(0,Lu,prog.front,r,0,c0).forEach(q=>rooms.push({...q,v0:0,v1:c0,band:'front',street:['local','garaje','recepcion','urgencias'].includes(q.type)||casa1&&q.type==='sala_cocina'}));
  else if(ground){rooms.push({type:'vestibulo',u0:coreU,u1:coreU+cw,v0:0,v1:c0,band:'front',street:true});
   const hall=rooms[0];// un sobrante de 1 m a un lado del vestíbulo se lo queda el vestíbulo
   for(const [a,b] of [[0,coreU],[coreU+cw,Lu]])if(b-a>=2)fill(a,b,prog.front,r,0,c0).forEach(q=>rooms.push({...q,v0:0,v1:c0,band:'front',street:['local','garaje','recepcion','urgencias'].includes(q.type)}));
    else if(b>a){if(a===0)hall.u0=0;else hall.u1=Lu;}}
  else if(homes)rooms.push(...apartments(0,Lu,0,c0,'v1',r,'front',units,gmax));
  else if(suite)rooms.push(...suites(0,Lu,0,c0,'v1',r,'front',suite));
  else fill(0,Lu,prog.front,r,0,c0).forEach(q=>rooms.push({...q,v0:0,v1:c0,band:'front'}));
  // Atrás: lo que dejan el núcleo y el paso. Un sobrante de 1 m se lo queda el vecino (el núcleo o el paso).
  const solid=[core,pass].filter(Boolean).sort((a,b)=>a.u0-b.u0),gaps=[];let u=0;for(const o of solid){if(o.u0>u)gaps.push([u,o.u0]);u=Math.max(u,o.u1);}if(u<Lu)gaps.push([u,Lu]);
  // (en el hospital, la primera franja de atrás empieza con la enfermería del piso)
  // (2026-10-15, decisión de Miguel) Un tramo de la franja de atrás que no tiene ningún módulo con luz —da a una
  // medianera: el lote de atrás— no lleva cuartos habitables (ni departamentos): sus servicios (lo no habitable del
  // programa del tipo) o depósitos y baños.
  const litBack=(a,b)=>modulesIn(a,b).some(m=>['calle','avenida','patio','alto'].includes(F.at('back',m+1,level)));
  const servicios=(prog.back||[]).filter(([t])=>!HABITABLE.has(t)),SERV=servicios.length?servicios:[['deposito',3,4],['bano',2,2]];
  // (y cada tramo se parte donde cambia: la parte con luz lleva su programa; la ciega, servicios —antes bastaba un módulo
  // con luz en la punta para llenar el tramo entero de departamentos, y la parte ciega quedaba con cuartos interiores—)
  const runs=[];for(const [a,b] of gaps){const ms=modulesIn(a,b);if(!ms.length){runs.push([a,b,false]);continue;}let s0=a,cur=null;
   for(const m of ms){const l=litBack(m,m+2);if(cur===null)cur=l;else if(l!==cur){runs.push([s0,m,cur]);s0=m;cur=l;}}runs.push([s0,b,cur]);}
  // (un pedazo con luz más corto que 2 m se lo queda el de al lado)
  for(let k=0;k<runs.length;k++)if(runs[k][2]&&runs[k][1]-runs[k][0]<2&&runs.length>1){const nb=runs[k+1]&&runs[k+1][0]===runs[k][1]?runs[k+1]:runs[k-1];if(nb){if(nb===runs[k+1])nb[0]=runs[k][0];else nb[1]=runs[k][1];runs.splice(k,1);k--;}}
  gaps.length=0;const dark=new Set();for(const [a,b,l] of runs){gaps.push([a,b]);if(!l)dark.add(a+'|'+b);}
  let i=0,nurse=suite==='habitacion_h';for(const [a,b] of gaps)if(b-a>=2&&dark.has(a+'|'+b))fill(a,b,SERV,r,i++,Lv-c0-P).forEach(q=>rooms.push({...q,v0:c0+P,v1:Lv,band:'back'}));
  else if(b-a>=2){if(homes)rooms.push(...apartments(a,b,c0+P,Lv,'v0',r,'back',units,gmax));
   else if(suite){let a2=a;if(nurse&&b-a>=6){rooms.push({type:'enfermeria',u0:a,u1:a+4,v0:c0+P,v1:Lv,band:'back'});a2=a+4;nurse=false;}if(b-a2>=2)rooms.push(...suites(a2,b,c0+P,Lv,'v0',r,'back',suite));}else fill(a,b,prog.back,r,i++,Lv-c0-P).forEach(q=>rooms.push({...q,v0:c0+P,v1:Lv,band:'back'}));}
   else{const right=solid.find(o=>o.u0===b),left=solid.find(o=>o.u1===a),to=[right,left].find(o=>o&&o===pass)||right||left;if(to===right)right.u0=a;else if(to)left.u1=b;}// (el resto, al paso si lo hay: el núcleo queda de la medida de la escalera)
 }
 for(const q of rooms){q.Lu=Lu;q.Lv=Lv;}// (para descontar el grosor de la fachada al amueblar)
 return {rooms,corr,core,lift,units,sw};}

// ---------- Etapa 7: puertas y ventanas (en el marco local) ----------
// Los módulos de fachada (de 2 m, desde la esquina del lote) que caen enteros dentro de [a,b].
const modulesIn=(a,b)=>{const out=[];for(let m=2*Math.ceil(a/2);m+2<=b+1e-9;m+=2)out.push(m);return out;};
function openings(L,F,plan,level,r){// (PC: el ancho de la puerta de calle de este lote —PUERTA.doble en los de sus tipos—)
 const pcDe=q=>PUERTA.doble.excepto.includes(L.type)?PUERTA.calle:PUERTA.doble.ancho;
 const doors=[],windows=[],{Lu,Lv}=F,{rooms,corr,core}=plan,c=corr[0];
 // Una puerta de 1 m en un borde [a,b] a lo largo de u (o de v), cerca de una punta (como en las casas de verdad).
 // (en una pared de 2 m —un baño, una cocineta— pegada a la esquina, con 10 cm de marco: a 40 cm partía el cuarto en dos y
 // la ducha no tenía rincón)
 // (2026-10-15) Si una punta del borde es el borde del lote, ahí está la fachada (MURO.fachada): la puerta se separa
 // FM —su cara más medio marco y 6 cm— y no 10 cm del eje, que la metía 15 cm en el muro. axis: hacia dónde corre el
 // borde ('u' o 'v'), para saber qué punta es borde. wd: el ancho real de la puerta.
 const FM=MURO.fachada+.1,edge=(axis,t)=>t<=1e-6||t>=(axis==='u'?Lu:Lv)-1e-6;
 const near=(a,b,wd=1,axis)=>{const len=b-a,rr=len>wd+.15?r():null,ea=!!axis&&edge(axis,a),eb=!!axis&&edge(axis,b),m=len<=2.2?.1:.4,ma=ea?Math.max(m,FM):m,mb=eb?Math.max(m,FM):m;
  if(rr===null||len<wd+ma+mb-1e-9){const lo=a+(ea?FM:.1),hi=b-(eb?FM:.1)-wd;return hi>=lo-1e-9?(lo+hi)/2:a+(len-wd)/2;}
  return rr<.5?a+ma:b-mb-wd;};
 rooms.forEach((q,i)=>{q.id=i;});
 rooms.forEach((q,i)=>{
  if(q.doorTo){// adentro del departamento: al cuarto que da (la sala), en el borde que comparten
   const o=q.doorTo;
   if(q.u1===o.u0||q.u0===o.u1){const at=q.u1===o.u0?q.u1:q.u0,a=Math.max(q.v0,o.v0),b=Math.min(q.v1,o.v1),wd=Math.min(1,b-a-.2);doors.push({axis:'v',at,from:near(a,b,wd,'v'),len:wd,a:i,b:o.id});}
   else{const at=q.v1===o.v0?q.v1:q.v0,a=Math.max(q.u0,o.u0),b=Math.min(q.u1,o.u1),wd=Math.min(1,b-a-.2);doors.push({axis:'u',at,from:near(a,b,wd,'u'),len:wd,a:i,b:o.id});}}
  else if(plan.corr.length&&Lv>8){// al pasillo
   const v=q.band==='front'?q.v1:q.v0,a=Math.max(q.u0,c.u0),b=Math.min(q.u1,c.u1);
   if(q.type==='vestibulo'){doors.push({axis:'u',at:v,from:q.u0+.5,len:q.u1-q.u0-1,a:i,b:'pasillo',wide:true});}
   else if(b-a>=1.4)doors.push({axis:'u',at:v,from:near(a,b,1,'u'),len:1,a:i,b:'pasillo'});}
  else if(q.hall){// detrás del pasillo del frente (las suites de un lote de 6 m): la puerta, a ese pasillo
   doors.push({axis:'u',at:q.v0,from:near(q.u0,q.u1,1,'u'),len:1,a:i,b:'pasillo'});}
  else{// sin pasillo: al cuarto siguiente (el último, al descanso del núcleo)
   // El último da al descanso, que ocupa los primeros Lv−4 m junto al núcleo (no a la escalera).
   const next=rooms.slice(i+1).find(o=>!o.doorTo);if(!next&&!core)return;// (sin núcleo no hay descanso: el último no abre a nada)
   doors.push({axis:'v',at:q.u1,from:next?near(Math.max(q.v0,next.v0),Math.min(q.v1,next.v1),1,'v'):near(q.v0,Math.min(q.v1,Lv-4),1,'v'),len:1,a:i,b:next?next.id:'pasillo'});}
  // Puerta de calle y vitrina en la planta baja.
  // La fachada va en módulos de 2 m: la puerta de calle ocupa uno (el garaje, dos) y en los locales los demás son vitrina.
  if(level===0&&q.street){const mods=modulesIn(q.u0,q.u1).filter(m=>['calle','avenida'].includes(F.at('front',m+1)));
   if(mods.length){const mid=(q.u0+q.u1)/2,byMid=[...mods].sort((a,b)=>Math.abs(a+1-mid)-Math.abs(b+1-mid)),garage=q.type==='garaje'&&mods.length>=2;
    const dm=garage?[byMid[0],mods.find(m=>Math.abs(m-byMid[0])===2)??byMid[1]].sort((a,b)=>a-b):[byMid[0]];
    doors.push(garage?{axis:'u',at:0,from:dm[0]+.2,len:dm[1]+2-dm[0]-.4,a:i,b:'calle',street:true,wide:true,bay:true}:{axis:'u',at:0,from:dm[0]+(2-pcDe(q))/2,len:pcDe(q),a:i,b:'calle',street:true});
    if(q.type==='local')for(const m of mods)if(!dm.includes(m))windows.push({axis:'u',at:0,from:m+.1,len:1.8,a:i,shop:true});}}
 });
 // Casa sin pasillo: la puerta de calle en el primer cuarto.
 if(level===0&&Lv<=8&&rooms.length){const m=modulesIn(rooms[0].u0,rooms[0].u1)[0];if(m!=null)doors.push({axis:'u',at:0,from:m+(2-pcDe(rooms[0]))/2,len:pcDe(rooms[0]),a:0,b:'calle',street:true});}
 // Un edificio que se roba tiene al menos JUEGO.puertasRobable puertas de calle (2026-10-15): las que faltan, primero en
 // un costado que da a otra calle (lote de esquina: dos calles distintas, mejores escapes) y si no en otro módulo del
 // frente; en un cuarto de planta baja, en un módulo entero sin otra puerta.
 if(level===0&&JUEGO.robables.includes(L.type)){const calle=(s,t)=>['calle','avenida'].includes(F.at(s,t,0));
  const libre=(axis,at,m)=>!doors.some(d=>d.axis===axis&&Math.abs(d.at-at)<1e-6&&d.from<m+2&&d.from+d.len>m);
  const cands=[];for(const q of rooms){if(q.type==='bano'||q.type==='boveda')continue;
   if(q.u0<=1e-6)for(const m of modulesIn(q.v0,q.v1))if(calle('left',m+1))cands.push({k:0,d:{axis:'v',at:0,from:m+(2-pcDe(q))/2,len:pcDe(q),a:q.id,b:'calle',street:true}});
   if(q.u1>=Lu-1e-6)for(const m of modulesIn(q.v0,q.v1))if(calle('right',m+1))cands.push({k:0,d:{axis:'v',at:Lu,from:m+(2-pcDe(q))/2,len:pcDe(q),a:q.id,b:'calle',street:true}});
   if(q.v0<=1e-6)for(const m of modulesIn(q.u0,q.u1))if(calle('front',m+1))cands.push({k:1,d:{axis:'u',at:0,from:m+(2-pcDe(q))/2,len:pcDe(q),a:q.id,b:'calle',street:true}});}
  // (también el pasillo o el descanso del núcleo, si da a la calle: una entrada al hall de la escalera)
  for(const c of corr)if(c.v0<=1e-6)for(const m of modulesIn(c.u0,c.u1))if(calle('front',m+1))cands.push({k:1,d:{axis:'u',at:0,from:m+(2-pcDe(null))/2,len:pcDe(null),a:'pasillo',b:'calle',street:true}});
  // (primero en cuartos que no necesitan la luz de esa vidriera —locales, depósitos—; y cada puerta en otra casilla de 6 m
  // o en otro lado: para el motor, dos puertas en la misma casilla son una sola salida)
  const hab=c=>typeof c.d.a==='number'&&HABITABLE.has(rooms[c.d.a]?.type)?1:0,celda=d=>d.axis+'|'+d.at+'|'+Math.floor((d.from+d.len/2)/CELL);
  cands.sort((x,y)=>hab(x)-hab(y)||x.k-y.k);const usadas=new Set(doors.filter(d=>d.street).map(celda));
  for(const c of cands){if(usadas.size>=JUEGO.puertasRobable)break;const m=c.d.from-.45;if(libre(c.d.axis,c.d.at,m)&&!usadas.has(celda(c.d))){doors.push(c.d);usadas.add(celda(c.d));}}}
 // Al patio de la manzana (2026-10-17): en la planta baja, el local de atrás abre al patio —puerta en el módulo del medio
 // y vidriera en los otros, como el de la calle—; y todo edificio que da al patio tiene al menos una puerta ahí, desde el
 // pasillo si llega atrás o, si no, desde un cuarto de atrás que no sea baño, bóveda ni celda. Son
 // puertas de afuera (street, como las de calle: el 3D las corta en la fachada y les pone hoja) que dan al patio (patio).
 if(level===0){const alPatio=t=>F.at('back',t,0)==='patio',libre=m=>!doors.some(d=>d.axis==='u'&&Math.abs(d.at-Lv)<1e-6&&d.from<m+2&&d.from+d.len>m);
  for(const q of rooms){if(q.type!=='local'||q.band!=='back'||q.v1<Lv-1e-6)continue;const mods=modulesIn(q.u0,q.u1).filter(m=>alPatio(m+.2)&&alPatio(m+1.8)&&libre(m));if(!mods.length)continue;
   const mid=(q.u0+q.u1)/2,dm=[...mods].sort((a,b)=>Math.abs(a+1-mid)-Math.abs(b+1-mid))[0];q.alPatio=true;
   doors.push({axis:'u',at:Lv,from:dm+(2-pcDe(q))/2,len:pcDe(q),a:q.id,b:'patio',street:true,patio:true});
   for(const m of mods)if(m!==dm)windows.push({axis:'u',at:Lv,from:m+.1,len:1.8,a:q.id,shop:true});}
  // (atrás o en un costado: en un lote de esquina el patio puede quedar al lado)
  if(!doors.some(d=>d.patio)){const cands=[],LADOS=[['back','u',Lv,(r)=>r.v1>=Lv-1e-6,r=>[r.u0,r.u1]],['left','v',0,r=>r.u0<=1e-6,r=>[r.v0,r.v1]],['right','v',Lu,r=>r.u1>=Lu-1e-6,r=>[r.v0,r.v1]]];
   const da=(s,t)=>F.at(s,t,0)==='patio',suelta=(ax,at,m)=>!doors.some(d=>d.axis===ax&&Math.abs(d.at-at)<1e-6&&d.from<m+2&&d.from+d.len>m);
   for(const [side,ax,at,toca,tramo] of LADOS){
    for(const c of corr)if(toca(c))for(const m of modulesIn(...tramo(c)))if(da(side,m+.2)&&da(side,m+1.8)&&suelta(ax,at,m))cands.push({k:0,m,ax,at,a:'pasillo',q:null});
    for(const q of rooms)if(toca(q)&&!['bano','boveda','celda','sanitario'].includes(q.type))for(const m of modulesIn(...tramo(q)))if(da(side,m+.2)&&da(side,m+1.8)&&suelta(ax,at,m))cands.push({k:1+(HABITABLE.has(q.type)?1:0),m,ax,at,a:q.id,q});}
   cands.sort((x,y)=>x.k-y.k||(x.ax==='u'?0:1)-(y.ax==='u'?0:1));const c=cands[0];
   if(c)doors.push({axis:c.ax,at:c.at,from:c.m+(2-pcDe(c.q))/2,len:pcDe(c.q),a:c.a,b:'patio',street:true,patio:true});}}
 // Ascensor y escalera dan al pasillo (o al descanso).
 // El núcleo: el ascensor ocupa sus primeros 2 m (si hay) y la escalera los 2 m siguientes; cada uno con su puerta al
 // pasillo (la de la escalera, un vano de 1,8 m frente a sus dos carriles).
 if(core){const sx0=plan.lift?core.u0+2:core.u0;
  // (contra el borde del lote, la fachada: FM, como en near)
  if(plan.lift)doors.push({axis:'u',at:core.v0,from:core.u0+(edge('u',core.u0)?FM:.3),len:1.4,a:'nucleo',b:'pasillo',core:true});
  const s0=sx0+(edge('u',sx0)?FM:.1),s1=sx0+plan.sw-(edge('u',sx0+plan.sw)?FM:.1);
  doors.push({axis:'u',at:core.v0,from:s0,len:s1-s0,a:'escalera',b:'pasillo',core:true,stair:true});}
 // Ventanas: en cada borde de cuarto que da a la calle o al patio (nunca a una medianera ni a la nada).
 // (se mira qué hay afuera en el lugar de cada ventana: un lado puede ser en parte calle y en parte el vecino)
 // 'alto': el muro que asoma por encima de un vecino más bajo (en ese piso, ya da afuera).
 const glazed=(s,t)=>['calle','avenida','patio','alto'].includes(F.at(s,t,level));
 for(const q of rooms){
  const edges=[];if(q.v0===0&&!(level===0&&q.type==='local'))edges.push({side:'front',axis:'u',at:0,a:q.u0,b:q.u1});
  if(q.v1===Lv&&!q.alPatio)edges.push({side:'back',axis:'u',at:Lv,a:q.u0,b:q.u1});// (el local al patio ya tiene su vidriera)
  if(q.u0===0)edges.push({side:'left',axis:'v',at:0,a:q.v0,b:q.v1});
  if(q.u1===Lu)edges.push({side:'right',axis:'v',at:Lu,a:q.v0,b:q.v1});
  // Una ventana por módulo de 2 m que cae entero en el borde del cuarto (los cortados por un tabique quedan de muro).
  // (en un módulo con puerta de calle no va ventana)
  const doorIn=(e,m)=>doors.some(d=>d.street&&d.axis===e.axis&&Math.abs(d.at-e.at)<1e-6&&d.from<m+2&&d.from+d.len>m);
  for(const e of edges){const wd=q.type==='bano'?.8:1.2;for(const m of modulesIn(e.a,e.b))if(!doorIn(e,m)&&glazed(e.side,m+.2)&&glazed(e.side,m+1.8))windows.push({axis:e.axis,at:e.at,from:m+1-wd/2,len:wd,a:q.id});}}
 // La pieza de cada ventana (2026-10-15, decisión de Miguel): la del estilo del edificio (primer piso ventana1, más
 // arriba ventana); si a un cuarto habitable no le alcanza para MINIMO.luz de su piso con el vidrio medido (VIDRIO), todas
 // sus ventanas suben a la pieza más chica de su familia que alcance (o a la más grande). El 3D dibuja w.pieza.
 {const fa=L.fachada||{},fam=RESIDENCIAL.has(L.type)?VENTANAS_VIVIENDA:VENTANAS_FAMILIA[fa.familia]||VENTANAS_FAMILIA.ladrillo,g=k=>VIDRIO.ventana[k]??.55;
  // (2026-10-18: también la planta baja —sus ventanas que no son vidriera: el 3D ya no dibuja vidriera fuera de un local—)
  for(const q of rooms){if(!HABITABLE.has(q.type))continue;const ws=windows.filter(w=>w.a===q.id&&!(level===0&&esVidriera(L.type,w)));if(!ws.length)continue;
   const need=(q.u1-q.u0)*(q.v1-q.v0)*MINIMO.luz,base=(level<=1&&ws[0].len>=1?fa.ventana1:fa.ventana)||'cuadrada';
   const opts=[...new Set([base,...fam])].filter(k=>g(k)>=g(base)-1e-9).sort((a,b)=>g(a)-g(b)),pick=opts.find(k=>g(k)*ws.length>=need-1e-9)||opts[opts.length-1];
   if(pick!==base)for(const w of ws)w.pieza=pick;}}
 // La escalera también tiene ventanas donde el núcleo da a la fachada (el pozo del ascensor no).
 if(core){const st0=plan.lift?core.u0+2:core.u0;if(core.v1===Lv)for(const m of modulesIn(st0,core.u1))if(glazed('back',m+.2)&&glazed('back',m+1.8))windows.push({axis:'u',at:Lv,from:m+.4,len:1.2,a:'nucleo'});}
 // El pasillo del frente de las suites angostas: una ventana por módulo, como los cuartos.
 for(const h of corr.filter(h=>h.hall))for(const m of modulesIn(h.u0,h.u1))if(glazed('front',m+.2)&&glazed('front',m+1.8))windows.push({axis:'u',at:0,from:m+.4,len:1.2,a:'pasillo'});
 // El pasillo, con una ventana en cada punta que da afuera.
 // (centrada en el pasillo y del largo que le entra: con 2 m era de 1,2 a 0,4 del borde; con el de 1,5 se pasaba al cuarto de atrás)
 if(Lv>8&&c.v0%2===0){const P=c.v1-c.v0,wl=Math.min(1.2,P-.3);for(const [s,u] of [['left',0],['right',Lu]])if(glazed(s,c.v0+P/2))windows.push({axis:'v',at:u,from:c.v0+(P-wl)/2,len:wl,a:'pasillo'});}
 return {doors,windows};}

// ---------- Etapa 8: muebles (en el marco local) ----------
// Medidas tomadas de los modelos que los dibujan en 3D (town3d.js), para que nada asome por paredes ni ventanas.
// [tipo, ancho a lo largo de la pared, fondo, alto?]: «alto» (más de ~85 cm) no va bajo una ventana. «c» = al centro.
export const ITEMS={sofa:[2.2,.9,0],mesa_centro:[1,1,0,'c'],tv:[1.4,.45,1],planta:[.5,.5],cama:[1.6,2.1],cama_s:[1.05,2.15],litera:[1.15,2.1,1],mesa_noche:[.56,.5],armario:[1.1,.6,1],
 escritorio:[1.56,.73],meson:[2,.6],nevera:[.7,.7,1],estufa:[.55,.6],mesa:[1.02,1.02,0,'c'],inodoro:[.55,.75,1],lavamanos:[.72,.45],ducha:[1,1,1],tina:[.85,2.05],lavadora:[.7,.7],
 archivador:[1.06,.63,1],mesa_reunion:[2.4,1.25,0,'c'],cama_h:[1.05,2.15],mostrador:[2.2,.7,1],pupitre:[.7,.5],tablero:[2.4,.12,1],casillero:[1.2,.45,1],
 caminadora:[.85,1.9,1],bicicleta:[.6,1.2,1],banco:[1.2,1.5,1],mancuernas:[1.5,.5],colchoneta:[1.8,.9],espejo_pared:[2.4,.06,1],// (el gimnasio, 2026-10-17)
 perchero:[1.2,.5,1],maniqui:[.5,.5],estanteria_ropa:[1.6,.45,1],probador:[1,1,1],// (la tienda de ropa, 2026-10-17)estante:[1.12,.42,1],
 mesa_lectura:[2.4,1.25,0,'c'],lampara:[.36,.36,1],sillon:[1.1,.98],comoda:[.95,.65,1],catre:[1.05,2.15],vehiculo:[2.2,5],caja:[.8,.8],buzones:[1.2,.3,1],caja_fuerte:[.8,.8,1],camilla:[.8,1.9],
 horno:[1.5,1.1,1],plancha:[1.6,.75,1],repisa:[1.4,.42,1],vitrina:[1.6,.75,1],cajon:[1.2,.7,0]};// (los de los locales con giro: el horno de leña de la pizzería y la plancha de la hamburguesería)
// ---- Muebles a la medida (2026-10-12, idea de Miguel) ----
// Lo que se fabrica a medida va con una lista de medidas [ancho, fondo], de la más grande a la más chica: el mueble prueba
// de la más grande que el azar del intento le da para arriba en la lista, y se queda con la primera que entra sin estorbar
// (así el mesón llena la pared que le queda, la cama es doble o sencilla según el dormitorio y la mesa del comedor es de
// dos, cuatro o seis puestos). La mesa (al centro) sólo en las casas; la de los locales sigue redonda.
const SIZES={meson:[[3,.6],[2.7,.6],[2.4,.6],[2.1,.6],[1.8,.6],[1.5,.6],[1.2,.6],[.9,.6]],escritorio:[[1.6,.73],[1.4,.7],[1.2,.65],[1,.6],[.9,.55]],
 estante:[[1.6,.42],[1.12,.42],[.9,.38],[.6,.35]],cama:[[1.6,2.05],[1.4,1.95],[1.2,1.95]],cama_s:[[1.05,2.1],[.9,1.95]],nevera:[[.9,.72],[.7,.7],[.6,.65]],
 sofa:[[2.4,.9],[2.1,.9],[1.8,.85],[1.5,.85],[1.25,.8]],armario:[[2.4,.6],[2,.6],[1.6,.6],[1.2,.6],[.9,.55]],comoda:[[1.4,.5],[1.1,.5],[.8,.45]],
 mostrador:[[3,.7],[2.6,.7],[2.2,.7],[1.8,.7],[1.4,.65]],tv:[[1.6,.45],[1.4,.45],[1.1,.4]],ducha:[[1,1],[.9,.9],[.8,.8]],tina:[[.85,2.05],[.8,1.7]],
 camilla:[[.8,1.9],[.7,1.8]],lavamanos:[[.72,.45],[.55,.4],[.45,.36]],tablero:[[2.4,.12],[1.8,.12],[1.2,.12]],casillero:[[1.8,.45],[1.2,.45],[.9,.45]],espejo_pared:[[3,.06],[2.4,.06],[1.8,.06],[1.2,.06]],mancuernas:[[1.8,.5],[1.5,.5],[1.2,.5],[.9,.45]],colchoneta:[[1.8,.9],[.9,.9]],perchero:[[1.5,.5],[1.2,.5],[.9,.5]],estanteria_ropa:[[2.4,.45],[1.6,.45],[1.2,.45],[.8,.42]],probador:[[1.2,1.2],[1,1]],
 // (los del centro: a lo largo del lado largo del cuarto)
 mesa_reunion:[[2.4,1.25],[2,1.1],[1.6,1],[1.2,.9]],mesa_lectura:[[2.4,1.25],[2,1.1],[1.6,1],[1.2,.9]],mesa_centro:[[1,1],[.9,.6],[.7,.5]],mesa:[[1.02,1.02],[.8,.8]]};
const SUELTO=new Set(['banco','bicicleta','colchoneta','perchero','maniqui']);
const TABLES=[[1.6,.9],[1.2,.8],[.9,.9],[.8,.8]],HOME=new Set(['cocina','sala_cocina','estudio','comedor_casa','sala']);
export const RECIPE={
 sala:['sofa','sillon?','tv','mesa_centro','planta','lampara?','escritorio?'],dormitorio:['cama','mesa_noche','armario','comoda?','lampara?','escritorio?'],cocina:['meson','nevera','estufa','lavadora?','mesa'],
 bano:['inodoro','banera','lavamanos'],oficina:['escritorio!','archivador','estante?','lampara?','planta'],abierta:['escritorios!','archivador','planta'],reuniones:['mesa_reunion','tv'],
 cocineta:['meson','nevera'],habitacion:['cama_hotel','mesa_noche','comoda?','sillon?','escritorio?','tv','lampara'],dormitorio_b:['litera','litera?','armario','mesa_noche'],habitacion_h:['cama_h','cama_h?','mesa_noche'],enfermeria:['mostrador','escritorio!','camilla'],
 aula:['tablero','escritorio!','casillero?','pupitres'],sala_prof:['mesa_reunion','escritorio!','casillero?'],lectura:['estante','estante','estante','estante','mesa_lectura','mesa_lectura','mesa_lectura','mesa_lectura?','escritorio!','lampara?','planta'],archivo:['estante','estante','caja','caja'],
 estudio:['cama','meson','estufa','nevera','sofa','escritorio?'],sala_cocina:['meson','estufa','nevera','sofa','sillon?','tv','mesa','escritorio?'],
 celda:['catre','inodoro'],boveda:['caja_fuerte','caja_fuerte','caja'],local:['estante','estante','mostrador','escritorio!','caja'],
 // Locales con giro (2026-10-12): el mostrador, la cocina a la vista y mesas con dos sillas.
 local_pizzeria:['horno','mostrador','mesa','mesa','mesa','mesa?','planta?'],local_hamburgueseria:['plancha','mostrador','nevera','mesa','mesa','mesa','mesa?'],
 local_panaderia:['repisa','repisa','mostrador','mesa','mesa?','planta?'],local_heladeria:['vitrina','mostrador','mesa','mesa','mesa?'],
 local_fruteria:['cajon','cajon','cajon','cajon','cajon?','cajon?','mostrador'],local_sushi:['vitrina','mostrador','mesa','mesa','mesa','planta?'],
 // (el gimnasio, 2026-10-17: el espejo y el mostrador primero, después una de cada máquina, la más grande primero —con
 // las caminadoras antes, el banco no entraba en un local con dos puertas a la calle—; las que sobran, si caben)
 // (la tienda de ropa, 2026-10-17: el mostrador, el probador y una estantería contra las paredes; los percheros y los
 // maniquíes, sueltos si contra la pared no entran)
 local_ropa:['mostrador','probador','estanteria_ropa','perchero','perchero','maniqui','estanteria_ropa?','perchero?','maniqui?'],
 local_gimnasio:['espejo_pared','mostrador','banco','mancuernas','caminadora','bicicleta','caminadora?','colchoneta?','bicicleta?','caminadora?'],recepcion:['mostrador','escritorio!','sofa','sillon','sillon?','mesa_centro?','lampara?','planta'],
 urgencias:['mostrador','escritorio!','camilla','camilla'],entrada:['armario?','planta?'],cocina_linea:['meson','estufa','nevera','lavadora?'],hall:['planta?'],ropas:['lavadora','estante?'],
 // (colegio, biblioteca, policía y bomberos: 2026-10-12)
 sanitario:['inodoro','inodoro','lavamanos','lavamanos'],secretaria:['mostrador','escritorio!','archivador','planta'],comedor:['meson','nevera','mesa','mesa','mesa'],// (el mesón y la nevera primero: puestos después, las mesas les tapaban el frente en un comedor de 4×4)

 prestamo:['mostrador','escritorio!','estante','planta'],estanteria:['estantes'],infantil:['estante','sofa','sillon?','mesa','planta'],
 interrogatorio:['mesa','archivador?'],evidencia:['estante','estante','archivador','caja','caja'],vestuario:['armario','armario','armario','armario','armario?'],consultorio:['escritorio!','camilla'],vestibulo:['buzones','planta','caja?'],garaje:['vehiculo','caja','caja'],deposito:['caja','caja','caja','estante']};

// Los nombres de los letreros (inventados).
const SHOP_NAMES={pizzeria:['Pizzería Napoli','La Fornace','Pizza Roma','Don Peppe','Horno de Leña','Pizzería Vesubio','Mamma Lucia'],
 hamburgueseria:['Burger Toro','Doble Carne','La Plancha','Burger Rex','El Carbón','Patty & Co.','Hamburguesas Brasa'],
 panaderia:['Panadería La Espiga','El Trigal','Pan de la Abuela','Horno Dorado','La Miga'],heladeria:['Heladería Polar','Copo de Nieve','Helados La Nona','Dulce Frío','Gelato Mío'],
 ropa:['Boutique Alma','Moda Urbana','La Percha','Estilo Libre','Vestirte','Trapos Finos'],
 gimnasio:['Gimnasio Titán','Body Fit','Hierro Gym','Fuerza Total','Energía Gym','Músculo'],
 fruteria:['Frutería El Huerto','La Cosecha','Frutas Doña Rosa','Verde Fresco','El Mercadito'],sushi:['Sushi Koi','Nami Sushi','Sakura','Rollo Feliz','Umi']};
// Cada cuarto se amuebla y, si algo quedó mal (una puerta sin conectar, un mueble que no se puede usar, una ventana
// tapada), se vuelve a intentar con otro azar, hasta 8 veces, y queda el mejor: primero las puertas, después lo que se
// usa, después las ventanas y, a igual, el que tiene más muebles (2026-10-12).
const TRIES=12;
// El triángulo de trabajo de una cocina (medidas.js INTERIOR.triangulo): del mesón —el lavaplatos— a la estufa y a la
// nevera, cada lado ≤ 2,7 m y los tres ≤ 7,9. Devuelve cuánto se pasa, en metros (0: en regla; sin los tres, 0).
function triangulo(its){const c=k=>{const it=its.find(i=>i.kind===k);return it&&[(it.u0+it.u1)/2,(it.v0+it.v1)/2];},m=c('meson'),e=c('estufa'),n=c('nevera');if(!m||!e||!n)return 0;
 const l=[[m,e],[e,n],[n,m]].map(([a,b])=>Math.hypot(a[0]-b[0],a[1]-b[1])),T=INTERIOR.triangulo;return l.reduce((a,x)=>a+Math.max(0,x-T.lado[1]),0)+Math.max(0,l[0]+l[1]+l[2]-T.total[1]);}
const quality=its=>{const Q=its.quality;return Q?(Q.doors-Q.doorsN)*1000-(Q.useN-Q.use)*20-((Q.ventN??0)-(Q.vent??0))*60-Q.win*5-Q.missing*8+its.length+Q.free*2+Q.fill*3-(Q.tri>0?30+10*Q.tri:0):its.length;};
// ---- El catálogo de distribuciones (2026-10-12) ----
// Los cuartos se repiten mucho (el piso tipo de cada lote se repite en todos sus pisos, y los lotes del mismo tipo y fondo
// salen iguales): en 4 ciudades, 16.990 cuartos y sólo 885 firmas distintas. La firma es todo lo que mira furnishRoom:
// tipo y giro (la receta), medidas, qué bordes son fachada o medianera (el grosor de la pared) y dónde caen sus puertas y
// ventanas, todo relativo a la esquina del cuarto. Por firma se intenta una sola vez (hasta tener VARIANTS intentos sin
// problemas; si sólo tapan una ventana, desde el sexto; y hasta CAT_TRIES si estorban) y quedan los VARIANTS mejores (los que
// no están muy por debajo del mejor): cada piso elige uno con su azar, así los pisos del mismo edificio no quedan iguales.
// El azar de cada variante sale de la firma, no del orden de generación: la misma firma da lo mismo en cualquier ciudad, y
// el catálogo puede quedar entre ciudades sin cambiar el resultado.
const VARIANTS=3,CAT_TRIES=40,CATALOG=new Map(),CATALOG_MAX=20000;
const hashStr=t=>{let h=0x811C9DC5;for(let i=0;i<t.length;i++)h=Math.imul(h^t.charCodeAt(i),0x01000193)>>>0;return h;};
function roomSig(q,open){const f=x=>Math.round(x*100),edge=(v,lim)=>v<=1e-6||Math.abs(v-lim)<=1e-6?1:0;
 const rel=o=>[o.axis,f(o.at-(o.axis==='u'?q.v0:q.u0)),f(o.from-(o.axis==='u'?q.u0:q.v0)),f(o.len)];
 return [q.type,q.giro||'',f(q.u1-q.u0),f(q.v1-q.v0),edge(q.u0,q.Lu),edge(q.u1,q.Lu),edge(q.v0,q.Lv),edge(q.v1,q.Lv),
  open.doors.filter(d=>d.a===q.id||d.b===q.id).map(rel).sort().join(';'),open.windows.filter(w=>w.a===q.id).map(rel).sort().join(';')].join('|');}
// Las distribuciones de una firma, relativas a la esquina del cuarto (u0,v0), con los computadores que suman.
function catalogFor(q,open,recipe,extra=''){const sig=roomSig(q,open)+extra;let C=CATALOG.get(sig);if(C)return C;const r=rng(mix(hashStr(sig),7)),all=[];let good=0,ok=0,okm=0;// (okm: en regla aunque falte algo de la receta: desde el intento 12, el cuarto no da para más)
 for(let k=0;k<CAT_TRIES;k++){const w2={need:true,pcs:0},its=furnishRoom(q,open,rng(Math.floor(r()*4294967296)),w2,recipe),Q=its.quality;all.push({sc:quality(its),pcs:w2.pcs,its});
  if(!Q)break;if(Q.doors===Q.doorsN&&Q.use===Q.useN){okm++;if(!Q.missing){ok++;if(!Q.win)good++;}}if(good>=VARIANTS||(k>=5&&ok>=VARIANTS)||(k>=11&&okm>=VARIANTS))break;}
 all.sort((x,y)=>y.sc-x.sc);
 C=all.slice(0,VARIANTS).filter((v,i)=>!i||v.sc>=all[0].sc-3).map(v=>({pcs:v.pcs,missing:v.its.quality?.missing||0,full:!!v.its.quality&&v.its.quality.use>=v.its.quality.useN&&v.its.quality.doors>=v.its.quality.doorsN&&(v.its.quality.vent??0)>=(v.its.quality.ventN??0),items:v.its.map(it=>({...it,u0:it.u0-q.u0,u1:it.u1-q.u0,v0:it.v0-q.v0,v1:it.v1-q.v0,room:undefined}))}));
 if(CATALOG.size>=CATALOG_MAX)CATALOG.clear();CATALOG.set(sig,C);return C;}
// ---- El programa de cada cuarto de departamento (2026-10-12: de adentro hacia afuera, en la ciudad) ----
// Cada cuarto toma el programa más completo que le cabe (la tabla de mínimos, cuartos-minimos.js, en cualquiera de sus
// dos giros): el dormitorio más grande del departamento, principal, doble o sencillo; los otros, de dos camas, con
// escritorio o sencillo; el baño, amplio, completo o medio baño; la cocina, completa o en línea. Si en el cuarto, con
// sus puertas y ventanas, no entran todos los muebles del programa, prueba el siguiente; sin ninguno, su receta de
// siempre. A la receta del programa se le suma lo opcional de la de siempre (plantas, lámparas…).
const PROG_BY={dormitorio:[['dormitorio_principal','dormitorio_doble','dormitorio_sencillo'],['dormitorio_dos_camas','dormitorio_estudiante','dormitorio_sencillo']],
 // ('*': la receta de siempre, con sus medidas más flexibles)
 bano:[['bano_amplio','bano','*','medio_bano']],cocina:[['cocina_completa','cocina_linea']],sala:[['sala']]};
// (la tabla sólo descarta lo que claramente no cabe —menos del 85 % del área mínima o un lado más corto que el lado corto
// del mínimo—: el mínimo se midió con la puerta en un lugar; con la puerta junto a la esquina a veces entra en menos)
// Lo que un cuarto de programa k (en un cuarto de tipo t) puede llevar además de su programa: los opcionales de la receta
// de su tipo que el programa no trae (la cómoda, la lámpara, el escritorio de la trama…). Salen al azar al amueblar.
// (sólo los programas que la ciudad amuebla así —PROG_BY—; las casas de la familia, hogar.js, usan el programa solo)
export const programExtras=(k,t=PROGRAMS[k].type)=>!Object.values(PROG_BY).flat(2).includes(k)?[]:(RECIPE[t]||[]).filter(e=>e.endsWith('?')&&!PROGRAMS[k].recipe.some(p=>p.split(':')[0]===e.slice(0,-1)));
// La receta con que se MIDE el mínimo de un programa (2026-10-15, decisión de Miguel: «el cuarto mínimo cuenta todo lo que
// se le pone»): el programa más todos sus opcionales, como obligatorios (el escritorio, con su computador).
export const fullRecipe=(k,t)=>[...PROGRAMS[k].recipe,...programExtras(k,t).map(e=>e.slice(0,-1)==='escritorio'?'escritorio!':e.slice(0,-1))];
const fitsMin=(q,k)=>{const w=q.u1-q.u0,d=q.v1-q.v0,M=MINIMOS[k];return !!M&&['hondo','ancho'].some(o=>M[o]&&w*d>=.85*M[o][0]*M[o][1]&&Math.min(w,d)>=Math.min(...M[o])-.3);};
function furnish(F,plan,open,r,want){const items=[];
 // (en cada departamento, el dormitorio más grande es el principal)
 const first=new Set();{const by={};for(const q of plan.rooms)if(q.unit&&q.type==='dormitorio')(by[q.unit]||(by[q.unit]=[])).push(q);
  for(const l of Object.values(by))first.add(l.sort((a,b)=>(b.u1-b.u0)*(b.v1-b.v0)-(a.u1-a.u0)*(a.v1-a.v0))[0]);}
 for(const q of plan.rooms){let recipe=RECIPE[q.giro?'local_'+q.giro:q.type]||[];if(!recipe.length)continue;
  // La cocina angosta (2 m): en línea, sin mesa, y la nevera al final: como no es esencial, va sólo si cabe sin
  // estorbar (con la fachada a lo largo no entran las tres cosas).
  if(q.type==='cocina'&&Math.min(q.u1-q.u0,q.v1-q.v0)<2.5)recipe=RECIPE.cocina_linea;
  let C=null,used=recipe;const lists=q.unit&&PROG_BY[q.type];
  if(lists)for(const k of (q.type==='dormitorio'&&!first.has(q)?lists[1]:lists[0])){if(k==='*'){const c=catalogFor(q,open,recipe);if(!c[0].missing){C=c;break;}continue;}if(!fitsMin(q,k))continue;
   const rec=[...PROGRAMS[k].recipe,...programExtras(k,q.type)];used=rec;
   const c=catalogFor(q,open,rec,'|'+k);if(!c[0].missing){C=c;q.prog=k;break;}used=recipe;}
  // (sin programa, la receta general; en una alcoba más chica que la doble de la norma —INTERIOR.alcobaDoble—, con cama
  // sencilla: la regla de las cortinas dejaba a veces sin programa a una de 8 m² y caía la cama de dos plazas)
  if(!C&&q.type==='dormitorio'){const a=q.u1-q.u0-MURO.tabique,b=q.v1-q.v0-MURO.tabique,N=INTERIOR.alcobaDoble;if(a*b<N.m2-1e-6||Math.min(a,b)<N.ancho-1e-6){recipe=recipe.map(e=>e==='cama'?'cama_s':e);used=recipe;}}
  if(!C)C=catalogFor(q,open,recipe);
  let V=C[Math.floor(r()*C.length)];
  // (si la distribución no es completa —un mueble sin uso, una puerta que no se alcanza—, se prueba sin los opcionales:
  // lo que no se puede usar no se pone; 2026-10-15)
  // (la caché de distribuciones es por firma del cuarto; si la elegida no anda EN ESTE cuarto —con la misma prueba de
  // movimiento—, se calcula una para él: dos cuartos con la misma firma podían necesitar muebles distintos y la ciudad
  // salía distinta según qué se había generado antes, 2026-10-15)
  if(V.full){const its=V.items.map(it=>({...it,u0:it.u0+q.u0,u1:it.u1+q.u0,v0:it.v0+q.v0,v1:it.v1+q.v0})),{flow,doorPts}=makeMovement(q,open),fl=flow(its);
   if(fl.doorsOk<doorPts.length||its.some(it=>USE_AT[it.kind]&&!fl.use.has(it))||fl.ventanas<(open.windows||[]).filter(w=>w.a===q.id&&!w.shop).length){const C2=catalogFor(q,open,used,'|aqui|'+[q.u0,q.v0,q.u1,q.v1,q.Lu,q.Lv].join(','));V=C2.find(v=>v.full)||C2[0];}}
  if(!V.full){const lean=used.filter(e=>!e.endsWith('?'));if(lean.length<used.length){const V2=catalogFor(q,open,lean,'|lean|'+lean.join(',')).find(v=>v.full&&!v.missing);if(V2)V=V2;}}
  want.pcs+=V.pcs;
  for(const it of sinInusables(q,open,V.items.map(it=>({...it,u0:it.u0+q.u0,u1:it.u1+q.u0,v0:it.v0+q.v0,v1:it.v1+q.v0})),used))items.push({...it,room:q.id});}
 return items;}
// Amuebla un cuarto con una receta; «existing» son los muebles que ya tiene (para agregar sin pisarlos).
// Lo que, sin ser alto en ITEMS, tapa una ventana igual (la cabecera de la cama, el espejo del lavamanos) y lo que no
// puede faltar aunque tape (si no hay otro lugar).
// El lugar de uso de cada mueble (ver furnishRoom flow): 'lados' (la cama: un costado libre) o delante.
// (la silla no: se corre, y que se pueda usar lo prueba validar-usos con la grilla del juego —con el radio de prueba de acá,
// 0,4 m, las de una mesa contra la pared salían sin uso—)
export const USE_AT={cama:'lados',cama_s:'lados',cama_h:'lados',litera:'lados',catre:'lados',camilla:'lados',armario:1,nevera:1,estante:1,archivador:1,comoda:1,inodoro:1,lavamanos:1,ducha:1,tina:1,
 meson:1,estufa:1,escritorio:1,sofa:1,sillon:1,mostrador:1,lavadora:1,buzones:1,repisa:1,vitrina:1,horno:1,plancha:1,cajon:1,caja_fuerte:1,tablero:1,casillero:1,caminadora:1,bicicleta:1,banco:1,mancuernas:1,perchero:1,estanteria_ropa:1,probador:1};
const WIN_TALL=new Set(['cama','cama_s','cama_h','lavamanos']),ESSENTIAL=new Set(['cama','cama_s','cama_h','litera','catre','lavamanos','inodoro','estufa','meson']);
const SIDEWAYS=new Set(['cama','cama_s','cama_h','litera','catre']);
// Lo usable de un cuarto: sin el grosor de las paredes (la fachada del MegaKit tiene su cara de adentro 20 cm hacia el
// interior; los tabiques, 6 cm de cada lado). Un borde en el límite del lote es fachada o medianera.
export function roomBox(q){const outer=(v,lim)=>v<=1e-6||Math.abs(v-lim)<=1e-6,inU=a=>outer(a,q.Lu)?.24:.08,inV=a=>outer(a,q.Lv)?.24:.08;
 return {u0:q.u0+inU(q.u0),v0:q.v0+inV(q.v0),u1:q.u1-inU(q.u1),v1:q.v1-inV(q.v1)};}
// ---- La prueba de movimiento (2026-10-12; sacada de furnishRoom el 2026-10-15 para que sea UNA: la usan el amueblado,
// el cálculo de los mínimos y el resultado final de cada cuarto que lee el validador) ----
// makeMovement(q, open, box): flow(list, all) dice, con el cuerpo de ERGO.radioPrueba, cuántas puertas del cuarto se
// alcanzan desde la primera y qué muebles de list se pueden usar (su lugar de uso libre y alcanzable).
export function makeMovement(q,open,box=roomBox(q),rb=null){const wins=(open.windows||[]).filter(w=>w.a===q.id&&!w.shop);
 const FG=Math.max(.15,Math.sqrt((box.u1-box.u0)*(box.v1-box.v0))/30),RB=rb??mm(ERGO.radioPrueba),fnu=Math.max(1,Math.round((box.u1-box.u0)/FG)),fnv=Math.max(1,Math.round((box.v1-box.v0)/FG));
 const doorPts=open.doors.filter(d=>d.a===q.id||d.b===q.id).map(d=>{const m=d.from+d.len/2;
  if(d.axis==='u'){const lo=Math.abs(d.at-q.v0)<.02;return [m,lo?box.v0+RB+.03:box.v1-RB-.03];}const lo=Math.abs(d.at-q.u0)<.02;return [lo?box.u0+RB+.03:box.u1-RB-.03,m];});
 const usePts=it=>{const u=it.kind==='silla'&&rb!=null?'cuatro':USE_AT[it.kind];if(!u)return null;const d=it.dir||[0,1],cu=(it.u0+it.u1)/2,cv=(it.v0+it.v1)/2,hu=(it.u1-it.u0)/2,hv=(it.v1-it.v0)/2;
  if(u==='lados'){const s=[d[1],d[0]],h=Math.abs(s[0])?hu:hv;return [[cu+s[0]*(h+RB+.05),cv+s[1]*(h+RB+.05)],[cu-s[0]*(h+RB+.05),cv-s[1]*(h+RB+.05)]];}
  if(u==='cuatro')return [[cu,cv+hv+RB+.05],[cu,cv-hv-RB-.05],[cu+hu+RB+.05,cv],[cu-hu-RB-.05,cv]];
  // (lo ancho —una ducha, un mesón, un sofá— se usa desde cualquier parte del frente: el centro y cerca de cada punta)
  const h=Math.abs(d[0])?hu:hv,wd=Math.abs(d[0])?hv:hu,p=[cu+d[0]*(h+RB+.05),cv+d[1]*(h+RB+.05)];if(wd<.45)return [p];
  const o=wd-.3;return [p,[p[0]+d[1]*o,p[1]+d[0]*o],[p[0]-d[1]*o,p[1]-d[0]*o]];};
 // (la grilla: lo que queda lejos de las paredes, y cada mueble tapa de una vez las casillas que alcanza)
 const base=new Uint8Array(fnu*fnv);for(let j=0;j<fnv;j++)for(let i=0;i<fnu;i++){const u=box.u0+(i+.5)*FG,v=box.v0+(j+.5)*FG;if(u>=box.u0+RB&&u<=box.u1-RB&&v>=box.v0+RB&&v<=box.v1-RB)base[j*fnu+i]=1;}
 const flow=(list,all=false)=>{const ok=base.slice();
  for(const b of list){if(b.kind==='silla')continue;const i0=Math.max(0,Math.ceil((b.u0-RB-box.u0)/FG-.5+1e-9)),i1=Math.min(fnu-1,Math.floor((b.u1+RB-box.u0)/FG-.5-1e-9)),j0=Math.max(0,Math.ceil((b.v0-RB-box.v0)/FG-.5+1e-9)),j1=Math.min(fnv-1,Math.floor((b.v1+RB-box.v0)/FG-.5-1e-9));
   for(let j=j0;j<=j1;j++)ok.fill(0,j*fnu+i0,j*fnu+i1+1);}
  const near=([u,v],rad,max2=1e9)=>{let best=-1,bd=1e9;const i0=Math.floor((u-box.u0)/FG),j0=Math.floor((v-box.v0)/FG),R=Math.ceil(rad/FG);
   for(let dj=-R;dj<=R;dj++)for(let di=-R;di<=R;di++){const i=i0+di,j=j0+dj;if(i<0||j<0||i>=fnu||j>=fnv||!ok[j*fnu+i])continue;const dd=di*di+dj*dj;if(max2<1e9&&(box.u0+(i+.5)*FG-u)**2+(box.v0+(j+.5)*FG-v)**2>max2)continue;if(dd<bd){bd=dd;best=j*fnu+i;}}return best;};
  // (el lugar de uso: el centro de una casilla libre a 15 cm como mucho del punto: la tolerancia de los medidores)
  // (sin puertas —el cuarto abierto al pasillo—, desde lo libre más cerca del centro)
  const starts=doorPts.map(p=>near(p,.35)),s0=doorPts.length?starts.find(k=>k>=0):near([(box.u0+box.u1)/2,(box.v0+box.v1)/2],3);const seen=new Uint8Array(fnu*fnv);
  if(s0!=null){const st=[s0];seen[s0]=1;while(st.length){const c=st.pop(),i=c%fnu,j=(c-i)/fnu;for(const [a,b] of [[i+1,j],[i-1,j],[i,j+1],[i,j-1]]){if(a<0||b<0||a>=fnu||b>=fnv)continue;const n=b*fnu+a;if(ok[n]&&!seen[n]){seen[n]=1;st.push(n);}}}}
  const doorsOk=starts.filter(k=>k>=0&&seen[k]).length,use=new Set();
  for(const it of list){const ps=usePts(it);if(ps&&ps.some(p=>{const k=near(p,.1,.15*.15+1e-6);return k>=0&&seen[k];}))use.add(it);}
  // Las cortinas (2026-10-16, usos.js): cada ventana del cuarto se alcanza si hay una casilla caminada delante desde donde
  // el brazo (USOS.cortina.brazo) llega a su borde; más lejos que USOS.cortina.antes, sólo por encima de lo que no pase de
  // USOS.cortina.bajo (la cama contra la ventana sí, el armario no). ventanas: cuántas se alcanzan.
  let ventanas=0;const C=USOS.cortina,alto=b=>{const r=CHOQUE_MUEBLE[b.kind];return r&&r.choque!=='ninguno'?r.alto:0;};
  for(const w of wins){const la=w.len/2,m=w.from+la,inn=w.axis==='u'?(Math.abs(w.at-q.v0)<.02?1:-1):(Math.abs(w.at-q.u0)<.02?1:-1);let ok=false;
   for(const dd of C.fondos){if(ok)break;for(let t=-la-C.costado;t<=la+C.costado+1e-6&&!ok;t+=C.paso){const tc=Math.max(-la,Math.min(la,t)),hu=w.axis==='u'?m+tc:w.at,hv=w.axis==='u'?w.at:m+tc,pu=w.axis==='u'?m+t:w.at+inn*dd,pv=w.axis==='u'?w.at+inn*dd:m+t,dist=Math.hypot(pu-hu,pv-hv);
    if(dist>C.brazo)continue;const k=near([pu,pv],.1,.15*.15+1e-6);if(k<0||!seen[k])continue;
    if(dist>C.antes+1e-6){let bajo=true;for(let f=.1;f<.95&&bajo;f+=.1){const x=pu+(hu-pu)*f,y=pv+(hv-pv)*f;for(const b of list)if(x>b.u0&&x<b.u1&&y>b.v0&&y<b.v1&&alto(b)>C.bajo){bajo=false;break;}}if(!bajo)continue;}ok=true;}}
   if(ok)ventanas++;}
  // (all: también cuánto del piso se camina, sólo para puntuar el intento terminado)
  let reach=0,cells=0;if(all)for(let k=0;k<seen.length;k++){if(seen[k])reach++;if(base[k])cells++;}
  return {doorsOk,use,reach,cells,ventanas};};
return {flow,doorPts};}

function furnishRoom(q,open,r,want,recipe,existing=[]){
 // DEPTH: lo que se deja libre delante de cada puerta (lo que barre la hoja; que el cuarto se pueda recorrer lo asegura flow)
 const items=[],DEPTH=.7;{
  // Lo usable del cuarto: sin el grosor de las paredes (la fachada del MegaKit tiene su cara de adentro 20 cm hacia el
  // interior; los tabiques, 6 cm de cada lado). Un borde en el límite del lote es fachada o medianera.
  const box=roomBox(q),placed=[...existing];
  // Delante de cada puerta del cuarto, 1 m libre.
  const keep=open.doors.filter(d=>d.a===q.id||d.b===q.id).map(d=>d.axis==='u'?{u0:d.from-.05,u1:d.from+d.len+.05,v0:d.at-DEPTH,v1:d.at+DEPTH}:{u0:d.at-DEPTH,u1:d.at+DEPTH,v0:d.from-.05,v1:d.from+d.len+.05});
  const glass=open.windows.filter(w=>w.a===q.id);
  const hit=(a,list)=>list.some(b=>a.u0<b.u1&&a.u1>b.u0&&a.v0<b.v1&&a.v1>b.v0);
  const inside=a=>a.u0>=box.u0+.05&&a.u1<=box.u1-.05&&a.v0>=box.v0+.05&&a.v1<=box.v1-.05;
  // ¿Tapa una ventana? Un mueble alto a menos de 45 cm de una ventana del cuarto, de frente o de costado (2026-10-12: antes
  // sólo se miraba la pared de atrás del mueble, y uno puesto de costado tapaba la ventana con su punta).
  const nearWin=a=>glass.some(w=>w.axis==='u'?a.u0<w.from+w.len+.1&&a.u1>w.from-.1&&Math.min(Math.abs(a.v0-w.at),Math.abs(a.v1-w.at))<.45:a.v0<w.from+w.len+.1&&a.v1>w.from-.1&&Math.min(Math.abs(a.u0-w.at),Math.abs(a.u1-w.at))<.45);
  const underWindow=(side,a)=>glass.some(w=>w.axis===(side==='n'||side==='s'?'u':'v')&&Math.abs(w.at-(side==='n'?q.v0:side==='s'?q.v1:side==='w'?q.u0:q.u1))<.01&&a[w.axis==='u'?'u0':'v0']<w.from+w.len&&a[w.axis==='u'?'u1':'v1']>w.from);
  // dir: hacia dónde mira el mueble (desde su pared hacia el cuarto), en el marco local.
  const DIR={n:[0,1],s:[0,-1],w:[1,0],e:[-1,0],c:[0,1]};
  const put=(kind,a,face,extra={})=>{placed.push(a);items.push({kind,...a,face,dir:DIR[face],room:q.id,...extra});return a;};
  // ---- El movimiento adentro (2026-10-12) ----
  // flow(list): con un cuerpo de 25 cm en una grilla de 15 cm, cuántas puertas del cuarto se alcanzan desde la primera y
  // cuántos muebles se pueden usar (su lugar de uso —delante, o a un costado en las camas— libre y alcanzable). Un lugar
  // para un mueble se acepta sólo si no rompe nada de lo que ya andaba y el mueble nuevo también se puede usar.
  // (el cuerpo, de 28 cm: 3 cm de holgura para no dejar pasos al filo —con muebles a la medida quedaban muchos—)
  // (la casilla crece con el cuarto: 15 cm en los chicos, donde cada centímetro cuenta; más gruesa en las salas grandes)
  const {flow,doorPts}=makeMovement(q,open,box);
  // ¿Se puede poner it sin romper nada? (doors: las mismas conectadas; use: todo lo que se usaba, y el nuevo)
  // (lo de antes no cambia hasta que se pone otro mueble: se calcula una vez por cantidad de muebles)
  // (con los muebles que el cuarto ya tenía —existing—: al agregar el escritorio de la trama no se miraban, y tapaba el
  // paso a ellos; 2026-10-15)
  let memo=null;const fits=it=>{if(!memo||memo.n!==items.length)memo={n:items.length,f:flow([...existing,...items])};const before=memo.f,after=flow([...existing,...items,it]);if(after.doorsOk<before.doorsOk)return false;
   for(const o of before.use)if(!after.use.has(o))return false;if(after.ventanas<before.ventanas)return false;return !USE_AT[it.kind]||after.use.has(it);};
  // Contra una pared: prueba las cuatro (en orden al azar) y posiciones cada 0,5 m.
  // Nada contra una ventana (las de los edificios bajan casi hasta el piso: tapa cualquier mueble); lo esencial —camas,
  // lavamanos— si no cabe en ningún lado, va igual.
  // side: la cama de costado (el lado largo contra la pared), para los cuartos angostos donde no entra de cabecera. Orden:
  // de cabecera sin tapar ventanas, de costado sin tapar, y lo esencial, como sea.
  // (any: 0 todo en regla; 1 puede tapar una ventana pero no estorbar el paso; 2 como sea)
  const wall=(kind,tall,any=0,side=false,size=null,esc=true)=>{const [w0,d0]=size||ITEMS[kind],[w,d]=side?[d0,w0]:[w0,d0];let sides=shuffle(['n','s','w','e'],r);
   // La mesa de noche, a un lado de la cabecera: primero la pared de la cama y, en ella, pegada a la cama.
   const bed=kind==='mesa_noche'?items.find(i=>/^cama/.test(i.kind)&&i.face!=='c'&&!(i.dir&&DIR[i.face]&&(i.dir[0]!==DIR[i.face][0]||i.dir[1]!==DIR[i.face][1]))):null;
   if(bed)sides=[bed.face,...sides.filter(x=>x!==bed.face)];
   // La estufa y la nevera, junto al mesón y en su misma pared (la cocina en línea: el triángulo de trabajo cerrado,
   // INTERIOR.triangulo; 2026-10-15): primero esa pared y, en ella, pegadas a una punta del mesón.
   const mes=kind==='estufa'||kind==='nevera'?items.find(i=>i.kind==='meson'&&i.face!=='c'):null;
   if(mes)sides=[mes.face,...sides.filter(x=>x!==mes.face)];
   // (con mesón: todos los lugares de las cuatro paredes, primero los que cierran el triángulo y, entre ellos, del más
   // cercano al mesón al más lejano —en línea, o en L doblando la esquina—, en vez de pared por pared)
   const cand=[];
   for(const s of sides){const along=s==='n'||s==='s',len=along?box.u1-box.u0:box.v1-box.v0;
    // Dónde probar a lo largo de la pared: pegado a cada punta, cada 25 cm y pegado a los muebles que ya están contra esa
    // pared, de un lado y del otro (así la estufa entra entre el mesón y la nevera, y el lavamanos junto al inodoro).
    const ts=[.05,len-w-.05];for(let t=.1;t+w<=len-.1;t+=.25)ts.push(t);
    for(const o of placed){const onWall=s==='n'?o.v0<=box.v0+.02:s==='s'?o.v1>=box.v1-.02:s==='w'?o.u0<=box.u0+.02:o.u1>=box.u1-.02;if(!onWall)continue;
     const [o0,o1]=along?[o.u0-box.u0,o.u1-box.u0]:[o.v0-box.v0,o.v1-box.v0];if(bed&&o.u0===bed.u0&&o.v0===bed.v0&&o.u1===bed.u1)ts.unshift(o1+.02,o0-w-.02);else if(mes&&o.u0===mes.u0&&o.v0===mes.v0&&o.u1===mes.u1)ts.unshift(o1+.01,o0-w-.01);else ts.push(o1+.01,o0-w-.01);}
    for(const t of ts){if(t<.05||t+w>len-.05)continue;const a=s==='n'?{u0:box.u0+t,u1:box.u0+t+w,v0:box.v0,v1:box.v0+d}:s==='s'?{u0:box.u0+t,u1:box.u0+t+w,v0:box.v1-d,v1:box.v1}:
      s==='w'?{u0:box.u0,u1:box.u0+d,v0:box.v0+t,v1:box.v0+t+w}:{u0:box.u1-d,u1:box.u1,v0:box.v0+t,v1:box.v0+t+w};
     const ok=()=>inside({...a,u0:a.u0+.06,u1:a.u1-.06,v0:a.v0+.06,v1:a.v1-.06})&&!hit(a,keep)&&!hit(a,placed)&&!(any<1&&nearWin(a))&&(any>=2||fits({kind,...a,dir:side?(along?[1,0]:[0,1]):DIR[s]}));
     const go=()=>put(kind,a,s,{...(side?{dir:along?[1,0]:[0,1]}:{}),...(size?{fit:true}:{})});
     if(mes){cand.push({d:100*triangulo([...items,{kind,...a}])+Math.hypot((a.u0+a.u1-mes.u0-mes.u1)/2,(a.v0+a.v1-mes.v0-mes.v1)/2),ok,go});continue;}
     if(ok())return go();}}
   if(mes){cand.sort((x,y)=>x.d-y.d);for(const c of cand)if(c.ok())return c.go();}
   if(!side&&SIDEWAYS.has(kind)){const b=wall(kind,tall,any,true,size,false);if(b)return b;}
   return esc&&any<2&&ESSENTIAL.has(kind)?wall(kind,tall,any+1,side,size):null;};
  // A la medida: de la medida que toca para abajo, todas en regla; si ninguna entra, la más chica como lo esencial.
  const pick=list=>{const k=Math.floor(r()*r()*list.length);return list.slice(k);};
  const wallFit=(kind,tall,fixed=null)=>{if(!SIZES[kind]&&!fixed)return wall(kind,tall);const L=fixed?[fixed]:pick(SIZES[kind]);
   for(const sz of L){const a=wall(kind,tall,0,false,sz,false);if(a)return a;}return wall(kind,tall,0,false,L[L.length-1]);};
  // Al centro: la medida que toca (a lo largo del lado largo del cuarto) y, de lo más cerca del centro para afuera, una
  // grilla de lugares de 35 cm en todo el cuarto (antes, siete lugares junto al centro: la segunda mesa de un local no
  // encontraba dónde ir); la prueba de movimiento, sólo en los 30 primeros que no chocan.
  const center=(kind,size=null)=>{const long=box.u1-box.u0>=box.v1-box.v0,list=size?[size]:SIZES[kind]?pick(SIZES[kind]).map(([w,d])=>long?[w,d]:[d,w]):[ITEMS[kind]],cu=(box.u0+box.u1)/2,cv=(box.v0+box.v1)/2;
   const U=[0],V=[0];for(let t=.35;t<=(box.u1-box.u0)/2;t+=.35)U.push(t,-t);for(let t=.35;t<=(box.v1-box.v0)/2;t+=.35)V.push(t,-t);const spots=U.flatMap(a=>V.map(b=>[a,b]));
   spots.sort((x,y)=>x[0]**2+x[1]**2-y[0]**2-y[1]**2);
   for(const [w,d] of list){let tries=0;for(const [ou,ov] of spots){const a={u0:cu+ou-w/2,u1:cu+ou+w/2,v0:cv+ov-d/2,v1:cv+ov+d/2};if(!inside(a)||hit(a,keep)||hit(a,placed))continue;if(++tries>30)break;
    if(fits({kind,...a,dir:[0,1]}))return put(kind,a,'c',size||SIZES[kind]?{fit:true}:{});}}return null;};
  // La mesa de la casa: a lo largo del lado largo del cuarto, de la medida que toca para abajo.
  const table=(fixed=null)=>{const long=box.u1-box.u0>=box.v1-box.v0;for(const [w,d] of fixed?[fixed]:pick(TABLES)){const a=center('mesa',long?[w,d]:[d,w]);if(a)return a;}return null;};
  // Escritorio con su silla delante (y computador encima si toca).
  // (el escritorio con computador cuenta como alto: el monitor tapa la ventana)
  const desk=pc=>{const a=wallFit('escritorio',pc);if(!a)return false;const it=items[items.length-1],s=it.face,cu=(a.u0+a.u1)/2,cv=(a.v0+a.v1)/2;if(pc){it.pc=true;want.pcs++;}
   const ch=s==='n'?{u0:cu-.25,u1:cu+.25,v0:a.v1,v1:a.v1+.5}:s==='s'?{u0:cu-.25,u1:cu+.25,v0:a.v0-.5,v1:a.v0}:s==='w'?{u0:a.u1,u1:a.u1+.5,v0:cv-.25,v1:cv+.25}:{u0:a.u0-.5,u1:a.u0,v0:cv-.25,v1:cv+.25};
   if(!hit(ch,keep)&&inside(ch)){put('silla',ch,s);const d=DIR[s];items[items.length-1].dir=[-d[0],-d[1]];}return true;};
  let missing=0;// lo obligatorio de la receta que no encontró lugar (para que el catálogo busque un intento completo)
  // La cama con sus mesas de noche, como un bloque: se busca lugar para todo junto (de cabecera contra la pared) y se
  // parte en la cama al medio y una mesa a cada lado (antes cada mesa iba a cualquier rincón, a veces a los pies).
  let skipNS=0;const NS=.56;
  const bedGroup=(kind,fixed)=>{const nn=Math.min(2,recipe.filter(e=>e==='mesa_noche').length);if(!nn)return null;
   for(const [bw,bd] of fixed?[fixed]:SIZES[kind]?pick(SIZES[kind]):[ITEMS[kind]]){const n0=items.length,a=wall(kind,true,0,false,[bw+nn*NS,bd],false);if(!a)continue;
    const it=items[items.length-1],s0=it.face,head=it.dir&&DIR[s0]&&it.dir[0]===DIR[s0][0]&&it.dir[1]===DIR[s0][1];
    items.length=n0;placed.pop();if(!head)continue;// (de costado no: ahí la cabecera no da a la pared)
    const along=s0==='n'||s0==='s',L0=along?a.u0:a.v0,first=nn===2||r()<.5,b0=L0+(first?NS:0),seg=(x0,x1)=>along?{u0:x0,u1:x1,v0:a.v0,v1:a.v0+(a.v1-a.v0)}:{u0:a.u0,u1:a.u1,v0:x0,v1:x1};
    const bedR=seg(b0,b0+bw),nsD=.5,nsR=x0=>{const r0=seg(x0,x0+NS);return s0==='n'?{...r0,v1:r0.v0+nsD}:s0==='s'?{...r0,v0:r0.v1-nsD}:s0==='w'?{...r0,u1:r0.u0+nsD}:{...r0,u0:r0.u1-nsD};};
    put(kind,bedR,s0,fixed||SIZES[kind]?{fit:true}:{});if(first)put('mesa_noche',nsR(L0),s0);if(nn===2||!first)put('mesa_noche',nsR(b0+bw),s0);
    skipNS=nn;return bedR;}
   return null;};
  // La cocina en línea, como un bloque (2026-10-15): el mesón con la estufa y la nevera a un lado, en ese orden —o el
  // espejo—, contra la misma pared; se busca lugar para todo junto y se parte. Así el triángulo de trabajo queda cerrado
  // (INTERIOR.triangulo: del lavaplatos a la estufa y a la nevera); si no entra junto, cada uno va por su lado.
  const skipK=new Set(),sz=k=>{const e=recipe.find(x=>x.replace(/[?!]$/,'').split(':')[0]===k);return e?(e.includes(':')?e.replace(/[?!]$/,'').split(':')[1].split('x').map(Number):ITEMS[k].slice(0,2)):null;};
  const kitchenLine=fixed=>{const E=sz('estufa'),N=sz('nevera');if(!E)return null;
   for(const [mw,md] of fixed?[fixed]:pick(SIZES.meson)){const D=Math.max(md,E[1],N?N[1]:0),n0=items.length,a=wall('meson',false,0,false,[mw+E[0]+(N?N[0]:0),D],false);if(!a)continue;
    const it=items[items.length-1],s0=it.face;items.length=n0;placed.pop();
    const along=s0==='n'||s0==='s',L0=along?a.u0:a.v0,mir=r()<.5,parts=[['meson',mw,md],['estufa',...E],...(N?[['nevera',...N]]:[])],seq=mir?parts.reverse():parts;
    const seg=(x0,x1,d)=>{const r0=along?{u0:x0,u1:x1,v0:a.v0,v1:a.v1}:{u0:a.u0,u1:a.u1,v0:x0,v1:x1};return s0==='n'?{...r0,v1:r0.v0+d}:s0==='s'?{...r0,v0:r0.v1-d}:s0==='w'?{...r0,u1:r0.u0+d}:{...r0,u0:r0.u1-d};};
    // (partido, cada pieza se tiene que poder usar —la prueba del bloque mira su frente entero, no el de cada una—)
    const before=flow([...existing,...items]),p0=items.length;let x=L0,m=null;for(const [k,w,d] of seq){const R=seg(x,x+w,d);put(k,R,s0,k==='meson'?{fit:true}:{});if(k==='meson')m=R;x+=w;}
    const after=flow([...existing,...items]);
    if(after.doorsOk<before.doorsOk||[...before.use].some(o=>!after.use.has(o))||items.slice(p0).some(i=>!after.use.has(i))){items.length=p0;placed.length-=seq.length;continue;}
    skipK.add('estufa');if(N)skipK.add('nevera');return m;}
   return null;};
  for(let entry of recipe){const opt=entry.endsWith('?'),must=entry.endsWith('!');entry=entry.replace(/[?!]$/,'');
   // (un hall: lo opcional —la planta— sólo si deja el paso libre del juego, JUEGO_PASO.casa)
   if(opt&&q.type==='hall'&&q.u1!=null&&Math.min(q.u1-q.u0,q.v1-q.v0)-MURO.tabique-.5<JUEGO_PASO.casa-1e-6)continue;
   if(skipK.has(entry.split(':')[0])){skipK.delete(entry.split(':')[0]);continue;}
   if(entry.split(':')[0]==='meson'&&!opt){const fx=entry.includes(':')?entry.split(':')[1].split('x').map(Number):null;if(kitchenLine(fx))continue;}
   // (una medida fija: 'cama:1.4x1.95' —los programas de minRoom—)
   let fixed=null;if(entry.includes(':')){const [n,sz]=entry.split(':');entry=n;fixed=sz.split('x').map(Number);}
   if(entry==='mesa_noche'&&skipNS>0){skipNS--;continue;}
   if((entry==='cama'||entry==='cama_s')&&!skipNS&&bedGroup(entry,fixed))continue;
   if(opt&&r()<.55&&!(entry==='escritorio'&&want.need&&r()<.7))continue;
   if(entry==='escritorio'){if(!desk(must||r()<.8)&&!opt)missing++;continue;}
   // El baño: tina si el cuarto es largo (a veces), si no ducha.
   // Hotel: la mitad de las habitaciones con camarote.
   if(entry==='cama_hotel')entry='cama';
   if(entry==='banera')entry=Math.max(box.u1-box.u0,box.v1-box.v0)>=3.2&&r()<.5?'tina':'ducha';
   if(entry==='escritorios'){// sala abierta: filas de escritorios espalda con espalda, cada uno con su computador
    const rows=Math.max(1,Math.floor((box.v1-box.v0-1.6)/2.4)),cols=Math.max(1,Math.floor((box.u1-box.u0-.2)/1.7));
    for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const u=box.u0+.1+i*1.7,v=box.v0+1.2+j*2.4,a={u0:u,u1:u+1.56,v0:v,v1:v+.73};if(inside(a)&&!hit(a,keep)&&!hit(a,placed)&&!nearWin(a)&&fits({kind:'escritorio',...a,dir:[0,1]})){put('escritorio',a,'n',{pc:true});want.pcs++;const ch={u0:u+.53,u1:u+1.03,v0:v+.73,v1:v+1.23};if(inside(ch)&&!hit(ch,keep)){put('silla',ch,'n');items[items.length-1].dir=[0,-1];}}}continue;}
   if(entry==='estantes'){// sala de estanterías: filas de libreros a lo ancho, con pasillos de 1,2 m
    for(let v=box.v0+1.1;v+.42<=box.v1-.2;v+=1.62)for(let u=box.u0+.15;u+1.12<=box.u1-.15;u+=1.17){const a={u0:u,u1:u+1.12,v0:v,v1:v+.42};if(inside(a)&&!hit(a,keep)&&!hit(a,placed)&&!nearWin(a)&&fits({kind:'estante',...a,dir:DIR[v-box.v0<(box.v1-box.v0)/2?'n':'s']}))put('estante',a,v-box.v0<(box.v1-box.v0)/2?'n':'s');}continue;}
   // El aula (2026-10-17, Miguel: «faltan buenas mesas»): pupitres con su silla detrás, en columnas con pasillo de 0,8 m
   // entre ellas y filas cada 1,65 m (con 0,65 m la prueba de movimiento, de radio 0,3 en grilla de 0,5, sacaba 1 de cada 5
   // sillas: medido 2026-10-17, 217 de 268; así quedan 246 de 248) y 0,8 m junto a las paredes; delante, 2 m
   // para el pizarrón y el escritorio del profesor. Tantas columnas y filas como entren, centradas.
   // Mirando al pizarrón, en la pared que le tocó (con s a lo largo de esa pared y t hacia adentro del cuarto).
   if(entry==='pupitres'){const tb=items.find(it=>it.kind==='tablero'&&it.room===q.id),d=tb?.dir||[0,1],fa=Object.keys(DIR).find(k=>k!=='c'&&DIR[k][0]===d[0]&&DIR[k][1]===d[1]),
     fb=Object.keys(DIR).find(k=>k!=='c'&&DIR[k][0]===-d[0]&&DIR[k][1]===-d[1]),porU=d[0]!==0,S0=porU?box.v0:box.u0,S1=porU?box.v1:box.u1,T=porU?box.u1-box.u0:box.v1-box.v0,
     R=(s0,s1,t0,t1)=>{const [a0,a1]=(d[0]||d[1])>0?[(porU?box.u0:box.v0)+t0,(porU?box.u0:box.v0)+t1]:[(porU?box.u1:box.v1)-t1,(porU?box.u1:box.v1)-t0];return porU?{u0:a0,u1:a1,v0:s0,v1:s1}:{u0:s0,u1:s1,v0:a0,v1:a1};};
    const CU=1.5,CV=1.65,cols=Math.max(1,Math.floor((S1-S0-1.6+.8)/CU)),s00=(S0+S1)/2-(cols*CU-.8)/2;
    for(let t=2;t+.95<=T-.6;t+=CV)for(let i=0;i<cols;i++){const s=s00+i*CU,a=R(s,s+.7,t,t+.5);if(inside(a)&&!hit(a,keep)&&!hit(a,placed)&&fits({kind:'pupitre',...a,dir:d})){put('pupitre',a,fa);// (con la prueba de movimiento: en un aula angosta tapaban el pizarrón)
     const ch=R(s+.1,s+.6,t+.5,t+.95);if(inside(ch)){put('silla',ch,fb);}}}continue;}
   const spec=ITEMS[entry];if(!spec)continue;
   if(spec[3]==='c'){const home=entry==='mesa'&&HOME.has(q.type),a=home?table(fixed):fixed?center(entry,(box.u1-box.u0>=box.v1-box.v0)?fixed:[fixed[1],fixed[0]]):center(entry);if(!a&&!opt)missing++;if(a&&entry==='mesa'){const cu=(a.u0+a.u1)/2,cv=(a.v0+a.v1)/2,W=a.u1-a.u0,D=a.v1-a.v0;
     // las sillas: en la de la casa, una por cada lado largo (dos desde 1,4 m) y una en cada punta desde 0,9 m: 2, 4 o 6
     // puestos; las otras, una a cada lado
     const U=(x,s0)=>[{u0:x-.25,u1:x+.25,v0:s0<0?a.v0-.55:a.v1+.05,v1:s0<0?a.v0-.05:a.v1+.55},[0,-s0]],V=(z,s0)=>[{u0:s0<0?a.u0-.55:a.u1+.05,u1:s0<0?a.u0-.05:a.u1+.55,v0:z-.25,v1:z+.25},[-s0,0]];
     const chs=[];if(!home)chs.push(V(cv,-1),V(cv,1));
     else{const longU=W>=D,L=longU?W:D,n=L>=1.4?2:1;for(let k=0;k<n;k++){const off=n===1?0:(k-.5)*L/2;for(const s0 of [-1,1])chs.push(longU?U(cu+off,s0):V(cv+off,s0));}
      if(L>=.9)for(const s0 of [-1,1])chs.push(longU?V(cv,s0):U(cu,s0));}
     for(const [ch,d] of chs)if(inside(ch)&&!hit(ch,keep)&&!hit(ch,placed)){put('silla',ch,'c');items[items.length-1].dir=d;}}continue;}
   // (lo que también va suelto en el medio, como en un gimnasio, si contra las paredes no entra)
   if(!wallFit(entry,!!spec[2]||WIN_TALL.has(entry),fixed)&&!(SUELTO.has(entry)&&center(entry,fixed))&&!opt)missing++;}
  // Cómo quedó: puertas conectadas, muebles que se pueden usar y cuántos tapan una ventana (para elegir el mejor intento).
  const fl=flow(items,true);items.quality={missing,fill:items.reduce((a,it)=>a+(it.fit?(it.u1-it.u0)*(it.v1-it.v0):0),0)/Math.max(1,(box.u1-box.u0)*(box.v1-box.v0)),free:fl.reach/Math.max(1,fl.cells),doors:fl.doorsOk,doorsN:doorPts.length,use:fl.use.size,useN:items.filter(it=>USE_AT[it.kind]).length,win:items.filter(it=>it.kind!=='silla'&&nearWin(it)).length,tri:triangulo(items),vent:fl.ventanas,ventN:glass.filter(w=>!w.shop).length};
 }
 return items;}

// ---------- Todo junto ----------
// Etapas 5 a 8 de un lote: el marco de cada ala, el plano de cada piso, puertas, ventanas y muebles, y todo pasado al plano
// del mapa (metros). stat(x,y,level) dice qué hay en la casilla de al lado (calle, avenida, patio, medianera…).
function buildLot(L,seed,stat){
  // Un plano por ala. En una L, el pasillo del ala del costado sigue por un paso en la franja de atrás de la principal.
  const Fs=L.wings.map(g=>frame(g,stat)),opts=L.wings.map(()=>(L.floors<2?{noCore:true}:{}));
  if(L.shape==='L'){const [Fa,Fb]=Fs,c0=corridorAt(Fb.Lv),R=Fb.rect(0,c0,Fb.Lu,c0+pasilloDe(Fb.Lv)),p=Fa.local(R.x,R.y),q=Fa.local(R.x+R.w,R.y+R.h);
   opts[0].reserve={u0:Math.min(p[0],q[0]),u1:Math.max(p[0],q[0])};opts[1].noCore=true;}
  L.frame={Lu:Fs[0].Lu,Lv:Fs[0].Lv};L.levels=[];
  const want={need:true,pcs:0},key=(k,...v)=>k?mix(seed,L.id,...v,k):mix(seed,L.id,...v);
  // La planta baja y un piso tipo que se repite (los muebles cambian piso a piso).
  const typical=Fs.map((F,k)=>layoutFloor(L,F,1,rng(key(k,2)),opts[k])),groundP=Fs.map((F,k)=>layoutFloor(L,F,0,rng(key(k,1)),opts[k]));
  // El giro de los locales de la planta baja (2026-10-12): pizzería, hamburguesería o tienda sin giro, con su nombre para
  // el letrero. Con su propio azar: no cambia nada de lo demás del lote.
  {const gr=rng(mix(seed,L.id,77)),g=gr();L.giro=groundP.some(p=>p.rooms.some(q=>q.type==='local'))?(L.giroWant!==undefined?L.giroWant:g<.15?'pizzeria':g<.3?'hamburgueseria':g<.42?'panaderia':g<.52?'heladeria':g<.62?'fruteria':g<.7?'sushi':g<.78?'gimnasio':g<.86?'ropa':null):null;// (giroWant: lo pide el editor)
   if(L.giro){for(const p of groundP)for(const q of p.rooms)if(q.type==='local')q.giro=L.giro;const N=SHOP_NAMES[L.giro];L.shopName=N[Math.floor(gr()*N.length)];}}
  for(let f=0;f<L.floors;f++){const fr=rng(mix(seed,L.id,10+f));
   const parts=Fs.map((F,k)=>{const plan=f===0?groundP[k]:typical[k],open=openings(L,F,plan,f,rng(key(k,f===0?3:4)));return {plan,open,items:furnish(F,plan,open,fr,want)};});
   L.levels.push({level:f,parts});}
  // El rincón con computador: si ningún piso lo tiene, se agrega en el primer cuarto donde quepa.
  if(!want.pcs)search:for(const lv of L.levels)for(const pt of lv.parts)for(const q of pt.plan.rooms){if(!['sala','sala_cocina','estudio','dormitorio','oficina','recepcion','local','habitacion','vestibulo','consultorio','lectura'].includes(q.type))continue;
   const extra=furnishRoom(q,pt.open,rng(mix(seed,L.id,99)),want,['escritorio!'],pt.items.filter(it=>it.room===q.id));if(extra.length){pt.items.push(...extra);break search;}}
  L.pcs=want.pcs;
  // El resultado final de la prueba de movimiento en cada cuarto (con TODOS sus muebles, también los que se agregaron
  // después): lo lee el validador, así hay una sola prueba (2026-10-15).
  for(const lv of L.levels)for(const pt of lv.parts)for(const q of pt.plan.rooms){const mine=pt.items.filter(it=>it.room===q.id);if(!mine.length&&!pt.open.doors.some(d=>d.a===q.id||d.b===q.id))continue;
   const {flow,doorPts}=makeMovement(q,pt.open),f=flow(mine),used=mine.filter(it=>USE_AT[it.kind]);
   q.mov={puertas:f.doorsOk,puertasN:doorPts.length,uso:used.filter(it=>f.use.has(it)).length,usoN:used.length,sinUso:used.filter(it=>!f.use.has(it)).map(it=>it.kind)};}
  // Al plano del mapa (metros), juntando las alas: los números de cuarto y de departamento siguen de un ala a la otra.
  for(const lv of L.levels){Object.assign(lv,{rooms:[],corridor:[],core:null,units:[],doors:[],windows:[],furniture:[]});let off=0,uoff=0;
   lv.parts.forEach((pt,k)=>{const F=Fs[k],R=q=>F.rect(q.u0,q.v0,q.u1,q.v1),id=x=>typeof x==='number'?x+off:x,
     seg=s=>{const [ax,ay]=s.axis==='u'?F.pt(s.from,s.at):F.pt(s.at,s.from),[bx,by]=s.axis==='u'?F.pt(s.from+s.len,s.at):F.pt(s.at,s.from+s.len);return {x0:ax,y0:ay,x1:bx,y1:by};};
    for(const q of pt.plan.rooms)lv.rooms.push({id:q.id+off,type:q.type,...(q.mov?{mov:q.mov}:{}),...(q.giro?{giro:q.giro}:{}),...(q.prog?{prog:q.prog}:{}),...R(q),...(q.unit?{unit:lv.level*100+q.unit+uoff}:{})});
    lv.corridor.push(...pt.plan.corr.map(R));if(pt.plan.core)lv.core={...R(pt.plan.core),lift:pt.plan.lift};
    lv.units.push(...(pt.plan.units||[]).map(u=>({n:lv.level*100+u.n+uoff,...R(u)})));
    lv.doors.push(...pt.open.doors.map(d=>({...seg(d),a:id(d.a),b:id(d.b),street:!!d.street,core:!!d.core,wide:!!d.wide,bay:!!d.bay,stair:!!d.stair,...(d.patio?{patio:true}:{})})));
    // fr: el umbral de adelante; bk: el descanso del fondo (lo que dejan los tramos); steps: peldaños por tramo.
    // La escalera (en U): su esquina de adelante a la izquierda (p), hacia dónde van sus carriles (u, de w/2 m cada uno) y
    // hacia el fondo (v); w m de ancho (STAIR_W) y hasta 5 m de fondo. El ascensor, en los primeros 2 m del núcleo.
    if(pt.plan.core){const C=pt.plan.core,sx0=pt.plan.lift?C.u0+2:C.u0,[px,pz]=F.pt(sx0,C.v0),[ax,az]=F.pt(sx0+1,C.v0),[bx,bz]=F.pt(sx0,C.v0+1);
     const sw=pt.plan.sw||2,d=Math.min(C.v1-C.v0,5),run=STAIR_STEPS*STAIR_TREAD;
     lv.stair={x:px,z:pz,ux:ax-px,uz:az-pz,vx:bx-px,vz:bz-pz,w:sw,d,fr:STAIR_FR,bk:+(d-STAIR_FR-run).toFixed(3),steps:STAIR_STEPS};if(pt.plan.lift)lv.liftRect=R({u0:C.u0,u1:C.u0+2,v0:C.v0,v1:C.v0+2});}
    lv.windows.push(...pt.open.windows.map(w=>({...seg(w),shop:!!w.shop,...(w.pieza?{pieza:w.pieza}:{})})));
    // ry: el giro del modelo (su frente, +z, hacia donde mira el mueble).
    const ryOf=it=>{const cu=(it.u0+it.u1)/2,cv=(it.v0+it.v1)/2,d=it.dir||[0,1],[ax,ay]=F.pt(cu,cv),[bx,by]=F.pt(cu+d[0],cv+d[1]);return Math.atan2(bx-ax,by-ay);};
    lv.furniture.push(...pt.items.map(it=>({kind:it.kind,...F.rect(it.u0,it.v0,it.u1,it.v1),pc:!!it.pc,...(it.fit?{fit:true}:{}),ry:ryOf(it),rt:pt.plan.rooms[it.room]?.type,giro:pt.plan.rooms[it.room]?.giro})));// rt: el tipo del cuarto
    off+=pt.plan.rooms.length;uoff+=(pt.plan.units||[]).length;});
   delete lv.parts;}
  L.rect={x:L.x0*CELL,y:L.y0*CELL,w:L.w*CELL,h:L.h*CELL};
  L.parts=L.wings.map(g=>({x:g.x0*CELL,y:g.y0*CELL,w:g.w*CELL,h:g.h*CELL}));
}
function rematar(map){
 const {W,H,kind,names}=map,KC=City.K;if(!names?.hLine)return;const {hLine,vLine}=names,tramo=Math.round(CALLE.tramoMax/CELL);
 const libre=new Set([...(map.hideouts||[]),...(map.thiefSpawns||[]),...(map.copSpawns||[]),...(map.sites||[]).flatMap(s=>s.doors||[]),...(map.station?map.station.doors||[]:[])].map(p=>Math.floor(p.y)*W+Math.floor(p.x)));
 // (ni en la circunvalación: sus cruces son donde las calles de la ciudad salen al monte —las salidas del muro—, y un
 // remate ahí cerraba la salida; 2026-10-15)
 const C0=City.CIUDAD?.calle??2,anillo=i=>{const x=i%W,y=Math.floor(i/W);return x<=C0||y<=C0||x>=W-1-C0||y>=H-1-C0;};
 const via=i=>(kind[i]===KC.street||kind[i]===KC.avenue)&&!anillo(i),usado=new Set(),remates=[];
 // (2026-10-15, la circulación: un remate es una isla de 6 m; en un cruce de calles de 12 m no deja doblar a un auto
 // —medido: carriles tapados—. Va sólo como glorieta: en la casilla del medio de un cruce de avenida con avenida —18 × 18
 // m, con 6 m para circular alrededor—. Las vistas largas de las calles las cortan ahora las copas de sus árboles.)
 const glorieta=new Set();for(const c of crucesCiudad(map))if(c.x1-c.x0===2&&c.y1-c.y0===2)glorieta.add((c.y0+1)*W+c.x0+1);
 for(const axis of ['h','v']){const lineOf=axis==='h'?hLine:vLine,nA=axis==='h'?H:W,nB=axis==='h'?W:H;
  for(let a=0;a<nA;a++){let run=0;for(let b=0;b<nB;b++){const i=axis==='h'?a*W+b:b*W+a;
   if(lineOf[i]<0||!via(i)){run=0;continue;}run++;
   if(run>tramo&&glorieta.has(i)){const k=hLine[i]+'|'+vLine[i];if(usado.has(k)||libre.has(i))continue;
    usado.add(k);kind[i]=KC.kiosk;if(map.grid?.[Math.floor(i/W)])map.grid[Math.floor(i/W)][i%W]=1;remates.push({x:i%W,y:Math.floor(i/W)});run=0;}}}}
 map.remates=remates;}
export function generateBlueprint({seed=1,team=3,parks=JUEGO.parques}={}){
 // (la caché de distribuciones de muebles es por ciudad: compartida entre ciudades, una semilla daba ciudades distintas
 // según qué se había generado antes —y en el multijugador cada uno vería otra—; 2026-10-15)
 CATALOG.clear();
 const map=City.generate({seed,team,buildings:'rooms',parks}),r=rng(mix(seed,team,31));
 const blocks=classify(map),{lots,courts,statusAt,ownerAt}=makeLots(map,blocks,r);typeLots(lots,map,r,seed);facadeLots(lots,map,seed);
 // (el interior de cada manzana es un patio entero, 2026-10-15: algunos guardaban restos del generador viejo de
 // edificios —cuartos, paredes, bóvedas— que el motor veía como paredes sueltas)
 {const KC=City.K;for(const ct of courts)for(let y=ct.y0;y<=ct.y1;y++)for(let x=ct.x0;x<=ct.x1;x++){map.kind[y*map.W+x]=KC.courtyard;if(map.grid?.[y])map.grid[y][x]=0;}}
 // (remates, 2026-10-15: una calle recta se veía de punta a punta —108–136 m de vista media, la circunvalación entera—.
 // En los cruces que cierran un tramo de más de CALLE.tramoMax, una casilla del cruce se vuelve un remate —glorieta,
 // monumento—: corta la vista de ese carril y no quita frente a ningún lote; una sola por cruce, así el cruce sigue
 // conectado por las otras casillas)
 rematar(map);
 for(const L of lots){
  const stat=(x,y,level)=>{const st=statusAt(x,y,L.id);if(st==='medianera'&&level!=null&&lots[ownerAt(x,y)].floors<=level)return 'alto';return st;};
  buildLot(L,seed,stat);}
 const count=(fn)=>lots.reduce((a,L)=>a+L.levels.reduce((b,lv)=>b+fn(lv),0),0);
 const stats={blocks:blocks.length,byUse:blocks.reduce((a,b)=>(a[b.use]=(a[b.use]||0)+1,a),{}),lots:lots.length,byType:lots.reduce((a,L)=>(a[L.type]=(a[L.type]||0)+1,a),{}),
  floors:lots.reduce((a,L)=>a+L.floors,0),lifts:lots.filter(L=>L.floors>=4).length,corners:lots.filter(L=>L.shape==='L').length,units:count(lv=>(lv.units||[]).length),rooms:count(lv=>lv.rooms.length),doors:count(lv=>lv.doors.length),windows:count(lv=>lv.windows.length),
  items:count(lv=>lv.furniture.length),pcs:count(lv=>lv.furniture.filter(f=>f.pc).length),boxes:count(lv=>lv.furniture.filter(f=>f.kind==='caja').length),withPc:lots.filter(L=>L.pcs>0).length};
 const isla=islaStage(map,lots,seed);

 // (la vegetación y la playa, y el equipamiento urbano, 2026-10-15: vegetacion.js y equipamiento.js, cada uno con su
 // propio azar, sobre el plano ya armado)
 const bp={seed,team,map,blocks,lots,courts,stats,isla};bp.vegetacion=plantar(bp);bp.equipamiento=equipar(bp);bp.pintura=pinturaDe(bp);bp.botines=repartir(bp);pintar(bp);marcarEntradas(bp);marcarMansardas(bp);amoblarAzoteas(bp);marcarHojas(bp);numerar(bp);cerrarCortinas(bp);return bp;
}
// ---------- Etapa 9: la isla ----------
// Las casillas de 6 m de la isla (fuera de la ciudad) con su zona, su altura y lo disparejo que es el terreno; las
// casas (lotes de una casilla, con su plano como cualquier edificio: buildLot), el globo, el parapente, las salidas del
// muro y los senderos. Con su propio azar: la ciudad no cambia. Los lotes de la isla siguen la numeración de la ciudad
// (id desde lots.length) pero van aparte (isla.lots): el 3D de la ciudad sólo dibuja los de la grilla.
// Las carreteras de montaña (perillas): modo 'serpentina' (tramos en diagonal por la ladera y horquillas, como se
// construyen) o 'busqueda' (el camino más barato en la grilla); pendiente, la que busca cada tramo de la serpentina;
// horquilla, su radio (m: los tramos quedan a 2·radio, lugar para la carretera y sus franjas); corte, cuánto puede cortar
// o rellenar (m); banquina, el ancho de la franja de terreno aplanado a cada costado (para las casas), que no se hace de
// un lado si ese lado es más empinado que banquinaMax (40°); sinFranjaMax, lo más que sigue sin franja a ningún lado (m); separa, lo más cerca que pasan dos carreteras (m; separaPropia, dos tramos de la misma);
// lado, cuánto se puede apartar una carretera (rad) del rumbo de su puerta; cola, lo
// mínimo que tiene que seguir después de una horquilla (si no, se corta antes de ella: nada de caracoles); giro, lo más que gira en un tramo (grados); liso, en cuántas casillas a cada lado
// se alisa el terreno para medir la pendiente (0: el terreno tal cual).
// Qué se genera afuera de la ciudad (perillas): casas (pueblos, fincas, cabañas, casas sueltas) y senderos. Por ahora
// nada: la isla queda con su terreno y las vías (ver CARRETERA.modo 'anillo').
export const ISLA_GEN={casas:false,senderos:false,residencial:true,casasMonte:true,
 // casasArmadas: en las manzanas, casas armadas (vivienda.js: se entra, se sube, se ve por las ventanas) en lugar de
 // los modelos del pack.
 casasArmadas:true};
// Las casas de las manzanas de la montaña: las del «Simple Buildings Pack» (public/models/edificios, escala 5; el
// mismo que ya cargaba la isla). w: ancho del frente, d: fondo, en metros ya escalados; pisos: los del interior; el
// frente del modelo mira a +z. Cada casa con una de las cuatro paletas (el color del techo: anaranjado, rojo, azul
// oscuro o beige).
// interior: el cuerpo de la casa medido en el modelo (las paredes, cortadas a 1,2 y 1,8 m): su centro (dx, dz) desde el
// centro de la caja del modelo, sus medidas (w, d) y la puerta (desde el centro del interior, a lo largo del frente).
// La de porche (House) tiene el cuerpo 1 m atrás; la House5 es en L: el interior es el ala de la puerta (la otra es el
// garaje); en la House4 la puerta está 2 m a la derecha (a la izquierda, el garaje).
export const CASAS_MONTE=[
 {m:'House',w:6.1,d:8.6,pisos:1,interior:{dx:0,dz:-.97,w:5.42,d:5.76,puerta:0}},
 {m:'House2',w:6.3,d:7.2,pisos:1,interior:{dx:.02,dz:.04,w:5.46,d:6.38,puerta:-.02}},
 // La de dos pisos: el de arriba es más chico y está retirado (4,3 × 4,65 m), y la escalera de la casa armada caería
 // en el techo de abajo: por ahora sólo se entra a la planta baja.
 {m:'House3',w:6.3,d:7.2,pisos:1,interior:{dx:.02,dz:.05,w:5.46,d:6.38,puerta:-.02}},
 {m:'House4',w:10.8,d:7.2,pisos:1,interior:{dx:.02,dz:-.065,w:10,d:6.25,puerta:2.28}},
 {m:'House5',w:10.8,d:11,pisos:1,interior:{dx:2.3,dz:.06,w:5.43,d:9.85,puerta:-.1}},
 // La tienda (con su textura propia) y los dos edificios de departamentos (15,8 m): se entra a la planta baja. Flat2
 // tiene un porche de 4 m adelante. Puerta al centro en los tres. Pesan menos que las casas y va uno por mitad, como mucho.
 // (El templo, Bank, y el hospital, no por ahora.)
 {m:'Shop',w:12.4,d:9,pisos:1,otro:true,peso:1,paletas:['Shop'],interior:{dx:0,dz:.05,w:10,d:6.78,puerta:0}},
 {m:'Flat',w:10.9,d:10.8,pisos:1,otro:true,peso:1,interior:{dx:0,dz:-.63,w:9.86,d:8.6,puerta:0}},
 {m:'Flat2',w:10.9,d:9.5,pisos:1,otro:true,peso:1,interior:{dx:0,dz:-2.02,w:9.86,d:4.56,puerta:0}}];
export const CASAS_PALETAS=['HouseTexture1','HouseTexture2','HouseTexture3','HouseTexture4'];
export const CARRETERA={modo:'grilla',grilla:{paso:42,gradoMax:14,corte:5,chaflan:0,margen:8,rellenoMax:12},conAnillo:false,salidaMax:150,salidaCorte:3,anillo:[22,58],pendienteAnillo:.07,salidas:3,carreraMin:.3,monteMin:.35,rotonda:{R:8,asf:7,isla:2.5},rotondaAv:{R:12,asf:11,isla:4.5},giro:46,liso:0,pendiente:.09,horquilla:10,corte:6,banquina:8,banquinaMax:.84,sinFranjaMax:30,separa:22,separaPropia:16,lado:1.3,cola:45};
// (el paso de la grilla del monte, 2026-10-15: la calle de la ciudad + dos medias manzanas —MANZANA.monte: retiro, la
// casa más honda y el patio, en casillas—: 12 + 2·18 = 48 m; antes 42 a ojo)
// (desde la ladera en terrazas: medidas.js LADERA, la única cuenta)
const MITAD_MONTE=LADERA.mitad,CALLE_M=LADERA.calle;
CARRETERA.grilla.paso=LADERA.paso;
// (2026-10-16, las terrazas: la pendiente de las calles del monte, lo que se corta en un cruce o un tramo y lo que se
// mueve en una terraza, los de TERRAZA —antes 14°, 5 m y 12 m—)
CARRETERA.grilla.gradoMax=+(Math.atan(TERRAZA.pendiente/100)*180/Math.PI).toFixed(2);CARRETERA.grilla.corte=TERRAZA.mover;CARRETERA.grilla.rellenoMax=TERRAZA.mover;
const ISLA_NAMES=['Brisa','Coral','Las Gaviotas','El Faro','Arrecife','Bahía','Los Cocos','La Ensenada','Salinas','Marea','El Roble','Los Sauces',
 'La Pradera','El Trigal','San Isidro','Las Acacias','El Pinar','La Cumbre','El Mirador','Los Pinos','Peña Alta','El Cóndor','Nevado','Cerro Azul'];
function islaStage(map,lots,seed){const I=islaDe(map),{W,H}=map,r=rng(mix(seed,map.team||0,909)),n=Math.ceil(I.reach/CELL)+1;
 const x0=-n,y0=-n,x1=W+n,y1=H+n,cells=new Map(),key=(x,y)=>x+','+y,cen=(x,y)=>[(x+.5)*CELL,(y+.5)*CELL];
 const uneven=(x,y,R)=>{const hs=[[R,0],[-R,0],[0,R],[0,-R],[0,0]].map(([a,b])=>I.height(x+a,y+b));return Math.max(...hs)-Math.min(...hs);};
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){if(x>=0&&y>=0&&x<W&&y<H)continue;const [mx,my]=cen(x,y),z=I.zona(mx,my);if(z==='vacio'||z==='ciudad')continue;
  cells.set(key(x,y),{x,y,zona:z,h:I.height(mx,my),u:uneven(mx,my,3),out:I.outside(mx,my),edge:-I.beyond(mx,my)});}
 const at=(x,y)=>cells.get(key(x,y));const walk=c=>c&&c.zona!=='agua_honda';
 // Salidas: en el muro del borde de la ciudad, cada ~6 casillas, donde adentro hay calle y afuera se camina.
 const K_=City.K,street=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&!map.grid[y][x]&&map.kind[y*W+x]!==K_.border,gates=[];
 const tryGate=(gx,gy,ix,iy,ox,oy)=>{if(street(ix,iy)&&walk(at(ox,oy)))gates.push({x:gx,y:gy,in:[ix,iy],out:[ox,oy]});};
 for(let y=2;y<H-2;y+=6){tryGate(0,y,1,y,-1,y);tryGate(W-1,y,W-2,y,W,y);}for(let x=2;x<W-2;x+=6){tryGate(x,0,x,1,x,-1);tryGate(x,H-1,x,H-2,x,H);}
 // Las salidas de calle: donde una calle de la ciudad llega a la circunvalación (perpendicular al muro), el muro se abre
 // en su línea; una carretera que sale por ahí sigue la calle (dir: hacia afuera). En una calle ancha, la del medio.
 // Sólo calles y avenidas de verdad (no una puerta ni un callejón que da al borde). En una avenida (dos casillas), la
 // salida queda en la primera y ancho:2 (la avenida sigue afuera con su ancho).
 const via=(x,y)=>street(x,y)&&(map.kind[y*W+x]===K_.street||map.kind[y*W+x]===K_.avenue);
 // (2026-10-15, calles de 2 casillas y avenidas de 3, con la circunvalación de C casillas: una calle llega al muro donde,
 // justo adentro de la circunvalación —a C+1 casillas del muro—, hay calle; su ancho es lo que dura esa racha (2 o 3
 // casillas). La salida guarda su eje en metros (eje), su ancho en casillas y las casillas del muro que abre (cells).
 // Antes se miraban las casillas 1 y 2, que con la circunvalación de 2 casillas son la circunvalación misma: salían
 // sólo las esquinas y el monte quedaba sin calles.)
 const C0=City.CIUDAD?.calle??2,anchos=new Set([CALLE.calle.casillas,CALLE.avenida.casillas]);
 const calleGate=(lado,a,L)=>{if(!anchos.has(L))return;const t0=a,t1=a+L-1,cellsW=[],ok=[];
  for(let t=t0;t<=t1;t++){const [gx,gy,ix,iy,ox,oy]=lado==='W'?[0,t,1,t,-1,t]:lado==='E'?[W-1,t,W-2,t,W,t]:lado==='N'?[t,0,t,1,t,-1]:[t,H-1,t,H-2,t,H];
   cellsW.push([gx,gy]);ok.push(via(ix,iy)&&walk(at(ox,oy)));}
  if(!ok.every(Boolean))return;const dir={W:[-1,0],E:[1,0],N:[0,-1],S:[0,1]}[lado],m=t0,[gx,gy]=cellsW[0];
  const g={x:gx,y:gy,in:lado==='W'?[1,m]:lado==='E'?[W-2,m]:lado==='N'?[m,1]:[m,H-2],out:lado==='W'?[-1,m]:lado==='E'?[W,m]:lado==='N'?[m,-1]:[m,H],calle:true,dir,ancho:L,eje:(a+L/2)*CELL,cells:cellsW,lado};
  const prev=gates.findIndex(q=>q.x===gx&&q.y===gy);if(prev>=0)gates[prev]=g;else gates.push(g);};
 const runs=(n,f,lado)=>{let a=-1;for(let i=1;i<=n;i++){const on=i>C0&&i<n-1-C0&&f(i);if(on&&a<0)a=i;if(!on&&a>=0){calleGate(lado,a,i-a);a=-1;}}};
 runs(H,y=>via(C0+1,y),'W');runs(H,y=>via(W-2-C0,y),'E');runs(W,x=>via(x,C0+1),'N');runs(W,x=>via(x,H-2-C0),'S');
 // Los pueblos: uno o dos en la costa y uno o dos en la montaña, cada uno con una plaza (3×3 casillas) y casas de dos
 // pisos (hasta 10, de dos casillas) alrededor, separadas por una casilla, mirando a la plaza. El de montaña tiene un puesto de policía (dos
 // casillas) y el de la costa una o dos tiendas. Después, casas sueltas: de playa, fincas y cabañas.
 const scale=Math.max(1,I.reach/260),taken=[],far=(x,y,m)=>taken.every(t=>Math.max(Math.abs(t.x-x)-(t.w||1)+1,Math.abs(t.y-y)-(t.h||1)+1,0)>=m||Math.max(Math.abs(t.x-x),Math.abs(t.y-y))>=m+Math.max(t.w||1,t.h||1)-1);
 const pool=[...ISLA_NAMES];for(let i=pool.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}let nk=0;const nombre=()=>pool[nk++%pool.length];
 const isl=[],plazas=new Set(),pueblos=[];
 const lotOf=(c,K,w=1,h=1,toward=null)=>{const [mx,my]=cen(c.x,c.y),tx=toward?toward[0]:I.cx,ty=toward?toward[1]:I.cz,dx=tx-mx,dy=ty-my,toC=Math.abs(dx)>Math.abs(dy)?(dx>0?'E':'W'):(dy>0?'S':'N'),opp={N:'S',S:'N',E:'W',W:'E'}[toC];
  const front=K.mira==='afuera'?opp:toC,sides={N:'patio',S:'patio',W:'patio',E:'patio'};sides[front]='calle';
  const id=lots.length+isl.length,L={id,block:-1-id,x0:c.x,y0:c.y,x1:c.x+w-1,y1:c.y+h-1,w,h,area:w*h,shape:'rect',type:K.type||'casa',front,sides,zona:c.zona,kind:K.kind,isla:true,pueblo:K.pueblo??null,
   wings:[{x0:c.x,y0:c.y,x1:c.x+w-1,y1:c.y+h-1,w,h,front,sides,role:'main'}],floors:K.floors(),name:K.fullName||`${K.name} ${nombre()}`};
  taken.push({x:c.x,y:c.y,w,h});isl.push(L);return L;};
 // Una casa de dos casillas a lo largo del frente (12 × 6 m: en una sola casilla sólo entra la sala, con la escalera):
 // se prueba hacia un lado y hacia el otro.
 const frontOf=(c,K,toward)=>{const [mx,my]=cen(c.x,c.y),tx=toward?toward[0]:I.cx,ty=toward?toward[1]:I.cz,dx=tx-mx,dy=ty-my,toC=Math.abs(dx)>Math.abs(dy)?(dx>0?'E':'W'):(dy>0?'S':'N');return K.mira==='afuera'?{N:'S',S:'N',E:'W',W:'E'}[toC]:toC;};
 const casa2=(c,K,ok,sep,toward=null)=>{const f=frontOf(c,K,toward),horiz=f==='N'||f==='S';
  for(const s0 of [0,-1]){const x=horiz?c.x+s0:c.x,y=horiz?c.y:c.y+s0,a=at(x,y),b=at(horiz?x+1:x,horiz?y:y+1);
   if(!a||!b||!ok(a)||!ok(b)||a.carretera||b.carretera||a.corredor||b.corredor||plazas.has(key(a.x,a.y))||plazas.has(key(b.x,b.y))||!far(a.x,a.y,sep)||!far(b.x,b.y,sep))continue;
   return lotOf(a,K,horiz?2:1,horiz?1:2,toward);}return null;};
 const cand=[...cells.values()];for(let i=cand.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[cand[i],cand[j]]=[cand[j],cand[i]];}
 const flatAround=(c,R,ok)=>{let n=0;for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){const q=at(c.x+dx,c.y+dy);if(q&&ok(q))n++;}return n;};
 const PUEBLOS=[
  {kind:'costa',n:scale>1.25?2:1,ok:q=>(q.zona==='playa'||q.zona==='pradera')&&q.u<1.6&&q.edge>10&&q.out>8,casas:10,nombre:'Puerto',extra:'tienda'},
  {kind:'montaña',n:scale>1.25?2:1,ok:q=>(q.zona==='montaña'&&q.h<45||q.zona==='pradera'&&q.h>2)&&q.u<3.4&&q.edge>12,casas:10,nombre:'Alto',extra:'puesto',n0:true}];
 // 1) Los lugares: la plaza de cada pueblo (en el lugar más parejo) y el del refugio (lo más alto donde se puede).
 // Por ahora sin casas en la montaña (ni pueblos de montaña, ni refugio, ni cabañas): primero, que se pueda manejar.
 const SIN_MONTAÑA=true;
 for(const P of PUEBLOS)for(let k=0;k<(!ISLA_GEN.casas||SIN_MONTAÑA&&P.kind==='montaña'?0:P.n);k++){
  // Se miran hasta 300 lugares al azar (cand ya está barajado): el más parejo alrededor.
  const best=cand.filter(c=>P.ok(c)&&pueblos.every(o=>Math.hypot(o.x-c.x,o.y-c.y)>14)&&far(c.x,c.y,5)).slice(0,300).map(c=>[c,flatAround(c,4,P.ok)]).sort((a,b)=>b[1]-a[1])[0];
  if(!best||best[1]<20)continue;const c0=best[0],nm=`${P.nombre} ${nombre()}`,pb={id:pueblos.length,kind:P.kind,name:nm,x:c0.x,y:c0.y,lots:[],P};pueblos.push(pb);
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const q=at(c0.x+dx,c0.y+dy);if(q&&q.zona!=='agua_honda'){q.plaza=pb.id;plazas.add(key(q.x,q.y));}}
  taken.push({x:c0.x-1,y:c0.y-1,w:3,h:3});}
 const refC=SIN_MONTAÑA?null:cand.filter(c=>c.zona==='montaña'&&c.u<4.5&&c.edge>8&&!plazas.has(key(c.x,c.y))&&far(c.x,c.y,4)).sort((a,b)=>b.h-a.h)[0]||null;
 // 2) Las carreteras, hasta esos lugares.
 // Las carreteras de montaña (dos carriles, una casilla de ancho). Salen de varias puertas de la ciudad que miran a la
 // montaña (separadas entre sí) y suben hasta lo más alto que se alcanza SIN pasar la pendiente máxima: un tramo más
 // empinado que CARR_MAX no se construye (no se fuerza la carretera donde no da). El camino va en 8 direcciones
 // recordando de dónde viene; cada giro cuesta (más cuanto más cerrado) y lo que ya es carretera cuesta poco (se juntan).
 // En la ladera, la única forma de subir es cruzarla de lado: el zigzag sale solo. Termina donde ya no puede subir.
 const DMAXsal=140,CARR_MAX=.12,CARR_GIRO=Math.cos(CARRETERA.giro*Math.PI/180),CARR_LARGO=520,carreteras=[],house0=new Set();
 // 24 direcciones (pasos de 1, de caballo y de 3×1, 3×2): en una ladera de 40–50 % sólo un rumbo casi paralelo a las
 // curvas de nivel queda bajo 12 %, y con 8 direcciones no lo hay (medido: con 8 la carretera llegaba a 8–36 m, con 24
 // a la cima). Un paso largo exige que las casillas que cruza se puedan pisar; todas quedan marcadas como carretera.
 const D24=[];for(const [a,b] of [[1,0],[1,1],[2,1],[3,1],[3,2]])for(const [sx,sy] of [[1,1],[-1,1],[1,-1],[-1,-1]])for(const [dx,dy] of [[a*sx,b*sy],[b*sx,a*sy]])if(!D24.some(([p,q])=>p===dx&&q===dy))D24.push([dx,dy]);
 const crossed=(x,y,dx,dy)=>{const n=Math.max(Math.abs(dx),Math.abs(dy))*2,out=[];for(let i=1;i<n;i++){const q=at(x+Math.round(dx*i/n),y+Math.round(dy*i/n));if(q&&!out.includes(q))out.push(q);}return out;};
 const angOf=(x,y)=>{const [mx,my]=cen(x,y);return Math.atan2(my-I.cz,mx-I.cx);};
 const nCarr=Math.min(4,2+Math.floor((map.team||3)/3));
 const salidasM=gates.filter(g=>g.calle).map(g=>({g,m:I.mountain(angOf(...g.out))})).filter(o=>o.m>.35&&at(...o.g.out)).sort((a,b)=>b.m-a.m||a.g.x-b.g.x||a.g.y-b.g.y),usadas=[];
 for(const o of salidasM){if(usadas.length>=nCarr)break;if(usadas.some(u=>Math.hypot(u.x-o.g.x,u.y-o.g.y)<10))continue;usadas.push(o.g);}
 // La búsqueda, con arreglos (estado = casilla × rumbo de llegada): cada casilla de la isla tiene un número; para cada
 // rumbo, las casillas que cruza el paso (relativas) se calculan una vez.
 const CL=[...cells.values()],cid=new Map(CL.map((c,i)=>[c,i])),ND=D24.length,NS=CL.length*(ND+1);
 // Una grilla con el número de cada casilla (más rápida que buscar por clave de texto): -1 fuera de la isla.
 const GW=x1-x0,GH=y1-y0,grid=new Int32Array(GW*GH).fill(-1);CL.forEach((c,i)=>{grid[(c.y-y0)*GW+(c.x-x0)]=i;});
const angC=CL.map(c=>angOf(c.x,c.y));
 const gi=(x,y)=>x<x0||y<y0||x>=x1||y>=y1?-1:grid[(y-y0)*GW+(x-x0)],honda=CL.map(c=>c.zona==='agua_honda');
 // La altura de la carretera: el terreno alisado en (2·liso+1)² casillas (las irregularidades las absorbe el corte y el
 // relleno, como en una carretera real). c.hc queda en cada casilla para el 3D y la simulación.
 const R_=CARRETERA.liso;for(const c of CL){let sh=0,n=0;for(let dy=-R_;dy<=R_;dy++)for(let dx=-R_;dx<=R_;dx++){const qi=gi(c.x+dx,c.y+dy);if(qi>=0&&!honda[qi]){sh+=CL[qi].h;n++;}}c.hc=n?sh/n:c.h;}
 const cruza=D24.map(([dx,dy])=>{const n=Math.max(Math.abs(dx),Math.abs(dy))*2,o=[];for(let i=1;i<n;i++){const p=[Math.round(dx*i/n),Math.round(dy*i/n)];if(!o.some(q=>q[0]===p[0]&&q[1]===p[1])&&!(p[0]===dx&&p[1]===dy))o.push(p);}return o;});
 const lenD=D24.map(([dx,dy])=>Math.hypot(dx,dy)),cosD=D24.map(([ax,ay],i)=>D24.map(([bx,by],j)=>(ax*bx+ay*by)/(lenD[i]*lenD[j])));
 // La serpentina (modo 'serpentina'): como se construye una carretera de montaña. Tramos en diagonal por la ladera: el
 // rumbo se calcula para subir CARRETERA.pendiente (si la ladera es más empinada, casi a lo largo de las curvas de
 // nivel), y no gira más de 10° cada 3 m. La altura de la carretera sigue al terreno pero nunca cambia más de CARR_MAX
 // por metro: donde el terreno se aparta, se corta o se rellena (hasta CARRETERA.corte m). Al final de cada tramo (largo
 // al azar, o donde se acaba la ladera de su lado, el agua o el acantilado), una horquilla: media vuelta de
 // CARRETERA.horquilla m de radio hacia arriba, casi plana (una explanada), y sigue en sentido contrario. Termina cerca de
 // la cima de su lado, o cuando dos tramos seguidos no suben, o donde no se puede seguir sin cortar de más.
 // Los puntos de carretera ya trazados (de todas), en una grilla de 10 m: una carretera no pasa a menos de 10 m de otra
 // (ahí termina: empalma) ni de un tramo propio de más atrás (ahí hace la horquilla antes).
 const ocup=new Map(),okey=(x,z)=>Math.floor(x/10)+','+Math.floor(z/10),marca=(p,id,n)=>{const k=okey(p.x,p.z);(ocup.get(k)||ocup.set(k,[]).get(k)).push({...p,id,n});};
 const cerca=(x,z,id,n)=>{const SEP=CARRETERA.separa,cx=Math.floor(x/10),cz=Math.floor(z/10),R=Math.ceil(SEP/10);for(let dz=-R;dz<=R;dz++)for(let dx=-R;dx<=R;dx++)for(const q of ocup.get((cx+dx)+','+(cz+dz))||[]){if(q.id===id&&n-q.n<9)continue;const dd=Math.hypot(q.x-x,q.z-z);if(q.id===id?dd<CARRETERA.separaPropia:dd<SEP)return q.id===id?'propia':'otra';}return null;};
 let nSerp=0;
 const serpentina=(g)=>{const PASO=3,id=nSerp++,GO=CARRETERA.pendiente,RH=CARRETERA.horquilla,CORTE=CARRETERA.corte,land=(x,z)=>I.landH(x,z);
  const ok=(x,z)=>{const zz=I.zona(x,z);return zz!=='vacio'&&zz!=='ciudad'&&zz!=='agua_honda'&&I.beyond(x,z)<-8;};
  const grad=(x,z)=>{const e=6;return [(land(x+e,z)-land(x-e,z))/(2*e),(land(x,z+e)-land(x,z-e))/(2*e)];};
  const ag=angOf(...g.out),cima=Math.max(...CL.filter((c,i)=>I.angDiff(angC[i],ag)<.7).map(c=>c.h)),fuera=(x,z)=>I.angDiff(Math.atan2(z-I.cz,x-I.cx),ag)>CARRETERA.lado;
  let [x,z]=cen(...g.out),hr=land(x,z),d=g.dir?[...g.dir]:[Math.cos(ag),Math.sin(ag)],sg=r()<.5?1:-1,leg=0,LMAX=120+r()*110,hLeg=hr,flojos=0;const pts=[{x,z,h:hr}];
  const rot=(v,a)=>[v[0]*Math.cos(a)-v[1]*Math.sin(a),v[0]*Math.sin(a)+v[1]*Math.cos(a)];let motivo='pasos',extra=0,arco0=-1,sinF=0;const arcos=[];
  // Las franjas a los costados: a cada lado, si el terreno natural hasta el borde de la franja no es más empinado que
  // banquinaMax, se aplana a la altura de la carretera (ancho banquina); si no, ese lado queda sin franja.
  const BQ=CARRETERA.banquina,franjas=(px,pz,dv,h)=>{const n=[-dv[1],dv[0]],out=[];for(const sgn of [1,-1]){const off=3.5+BQ,hx=land(px+n[0]*sgn*off,pz+n[1]*sgn*off);out.push(Math.abs(hx-h)/off<=CARRETERA.banquinaMax?BQ:0);}return out;};
  for(let it=0;it<1200;it++){if(hr>=cima-4){motivo='cima';break;}
   const [gx,gz]=grad(x,z),sl=Math.hypot(gx,gz);let want=d;
   // El rumbo sube lo que pide la pendiente, corregido para seguir pegado al terreno: si la carretera va quedando
   // por debajo (corte), el tramo se acuesta sobre las curvas de nivel; si va por encima (relleno), sube un poco más.
   const off=land(x,z)-hr,gt=Math.max(-.04,Math.min(GO+.02,GO-.04*off));
   if(sl>.02){const u=[gx/sl,gz/sl],c=[-u[1]*sg,u[0]*sg],sa=Math.max(-1,Math.min(1,gt/sl)),ca=Math.sqrt(1-sa*sa);want=[c[0]*ca+u[0]*sa,c[1]*ca+u[1]*sa];}
   // No más de 10° por paso.
   const da=Math.atan2(d[0]*want[1]-d[1]*want[0],d[0]*want[0]+d[1]*want[1]),lim=10*Math.PI/180;d=rot(d,Math.max(-lim,Math.min(lim,da)));
   const nx=x+d[0]*PASO,nz=z+d[1]*PASO,th=land(nx,nz),nh=Math.max(hr-PASO*CARR_MAX,Math.min(hr+PASO*CARR_MAX,th));
   const choca=cerca(nx,nz,id,pts.length);if(choca==='otra'){pts.push({x:nx,z:nz,h:nh});motivo='empalma';break;}
   // Sin franja a ningún lado (ladera demasiado empinada a los dos costados): ahí no sigue el tramo.
   const [fi,fd]=franjas(nx,nz,d,nh);sinF=fi||fd?0:sinF+PASO;const sinLugar=it>3&&sinF>CARRETERA.sinFranjaMax;
   if(ok(nx,nz)&&!fuera(nx,nz)&&leg<LMAX&&!choca&&!sinLugar&&Math.abs(th-nh)<=CORTE){x=nx;z=nz;hr=nh;leg+=PASO;pts.push({x,z,h:hr,izq:fi,der:fd});marca(pts.at(-1),id,pts.length);continue;}
   const porque=!ok(nx,nz)?'borde':fuera(nx,nz)?'fuera de su lado':choca?'se cruza':sinLugar?'sin lugar a los costados':leg>=LMAX?'largo':'corte';
   // Si después de una horquilla el tramo no arranca, la horquilla sobra (quedaría un rulo al final): se saca.
   if(leg<12){motivo='tramo corto ('+porque+')';if(arco0>0)pts.length=arco0;break;}
   // La horquilla: media vuelta hacia el lado de arriba (subiendo hasta 10 %). Se busca dónde ponerla en los últimos 60
   // m del tramo y con radio de 9 o 12 m: la que pida menos corte (donde la ladera afloja, en un lomo). El tramo se corta
   // ahí.
   const arcAt=(i,R)=>{const P0=pts[i],P1=pts[Math.max(0,i-1)],dd=[(P0.x-P1.x)||d[0],(P0.z-P1.z)||d[1]],dl=Math.hypot(...dd);const dv=[dd[0]/dl,dd[1]/dl];
    const [ux,uz]=grad(P0.x,P0.z),n1=[-dv[1],dv[0]],side=(n1[0]*ux+n1[1]*uz)>=0?1:-1,cxh=P0.x+n1[0]*side*R,czh=P0.z+n1[1]*side*R,a0=Math.atan2(P0.z-czh,P0.x-cxh),steps=Math.ceil(Math.PI*R/PASO),arc=[];let h2=P0.h,peor=0;
    for(let k=1;k<=steps;k++){const a=a0+side*k*Math.PI/steps,ax=cxh+Math.cos(a)*R,az=czh+Math.sin(a)*R;if(!ok(ax,az)||cerca(ax,az,id,i+k+1))return null;const th2=land(ax,az),nh2=Math.max(h2-PASO*.10,Math.min(h2+PASO*.10,th2));peor=Math.max(peor,Math.abs(th2-nh2));h2=nh2;arc.push({x:ax,z:az,h:h2});}
    // Cómo deja la salida: lo enterrada (o colgada) que queda la carretera al terminar la curva cuenta como el corte.
    const fin=arc.at(-1),salida=Math.abs(land(fin.x,fin.z)-fin.h);return {arc,peor:Math.max(peor,salida*1.25),i,dv};};
   let mejor=null;for(let i=pts.length-1;i>=Math.max(1,pts.length-20)&&i>=pts.length-1-Math.floor(leg/PASO)+3;i--)for(const R of [RH,RH*1.35]){const t=arcAt(i,R);if(t&&(!mejor||t.peor<mejor.peor))mejor=t;}
   const bad=!mejor||mejor.peor>CORTE*1.4;let arc=null;if(!bad){pts.length=mejor.i+1;arc=mejor.arc;d=mejor.dv;}
   // Sin lugar para la horquilla al final de un tramo largo: se sigue un poco más (hasta tres veces) buscando un lomo.
   if(bad&&porque==='largo'&&(extra=(extra||0)+1)<=3){LMAX+=45;continue;}
   if(bad){motivo='horquilla ('+porque+')';break;}extra=0;arco0=pts.length;arcos.push(arco0);pts.push(...arc);for(let k=pts.length-arc.length;k<pts.length;k++)marca(pts[k],id,k+1);const L2=arc.at(-1);x=L2.x;z=L2.z;hr=L2.h;d=[-d[0],-d[1]];sg=-sg;leg=0;LMAX=120+r()*110;
   if(hr-hLeg<2){if(++flojos>=2){motivo='no sube';break;}}else flojos=0;hLeg=hr;}
  // Nada de caracoles: si después de la última horquilla quedan menos de cola m, se corta antes de esa horquilla (y así
  // hacia atrás).
  while(arcos.length){const a0=arcos.at(-1),stepsArc=Math.ceil(Math.PI*RH/PASO),tail=(pts.length-(a0+stepsArc))*PASO;if(tail>=CARRETERA.cola)break;pts.length=a0;arcos.pop();motivo+=' (sin la última horquilla)';}
  // Las franjas de cada punto (las de la horquilla también).
  for(let i=0;i<pts.length;i++){const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)],dl=Math.hypot(b.x-a.x,b.z-a.z)||1;if(pts[i].izq==null){const [fi,fd]=franjas(pts[i].x,pts[i].z,[(b.x-a.x)/dl,(b.z-a.z)/dl],pts[i].h);pts[i].izq=fi;pts[i].der=fd;}}
  pts.motivo=motivo;pts.cimaLado=cima;return pts;};
 // El anillo (modo 'anillo'), como se planea alrededor de una ciudad: una vía de circunvalación a una distancia del muro
 // que varía suave con la semilla (entre anillo[0] y anillo[1] m), con curvas amplias (en las esquinas de la ciudad, un
 // arco), por la pradera y la playa y apoyada en el pie de la montaña; donde ahí no hay tierra firme (agua, acantilado,
 // ladera muy empinada) busca más cerca o más lejos, y si no hay, el anillo se corta en tramos. Su altura es la del
 // terreno promediada a lo largo y nunca cambia más de pendienteAnillo (corte y relleno). Las salidas son avenidas: las
 // carreras rectas de la ciudad (una calle que entra derecha desde el muro al menos carreraMin de la ciudad) siguen
 // derechas desde el muro hasta el anillo, donde empalman en T.
 const anilloGen=()=>{const Wm=W*CELL,Hm=H*CELL,[DMIN,DMAX]=CARRETERA.anillo,land=(x,z)=>I.landH(x,z);
  // La base: el contorno de la ciudad, con su normal hacia afuera; en las esquinas, un abanico de normales.
  const base=[];const edge=(ax,az,bx,bz,nx,nz)=>{const L=Math.hypot(bx-ax,bz-az),n=Math.max(1,Math.round(L/3));for(let i=0;i<n;i++){const t=i/n;base.push({x:ax+(bx-ax)*t,z:az+(bz-az)*t,nx,nz});}};
  const corner=(cx,cz,a0)=>{for(let k=0;k<12;k++){const a=a0+k*(Math.PI/2)/12;base.push({x:cx,z:cz,nx:Math.cos(a),nz:Math.sin(a)});}};
  edge(0,0,Wm,0,0,-1);corner(Wm,0,-Math.PI/2);edge(Wm,0,Wm,Hm,1,0);corner(Wm,Hm,0);edge(Wm,Hm,0,Hm,0,1);corner(0,Hm,Math.PI/2);edge(0,Hm,0,0,-1,0);corner(0,0,Math.PI);
  const N=base.length,fb=I.fbm,s0=r()*10,want=base.map((b,i)=>DMIN+(DMAX-DMIN)*fb(Math.cos(i/N*Math.PI*2)*1.3+s0,Math.sin(i/N*Math.PI*2)*1.3+s0,2));
  const firme=(x,z)=>{const zz=I.zona(x,z);if(zz==='vacio'||zz==='agua_honda'||zz==='agua'||zz==='ciudad'||I.beyond(x,z)>-12)return false;const e=4,sl=Math.hypot(land(x+e,z)-land(x-e,z),land(x,z+e)-land(x,z-e))/(2*e);return sl<.35;};
  // La distancia de cada punto: la que pide la semilla, o la más cercana a ella con tierra firme.
  let dist=base.map((b,i)=>{for(let k=0;k<=24;k++){for(const sg of k?[-1,1]:[1]){const d=want[i]+sg*k*2;if(d<8||d>DMAX+30)continue;if(firme(b.x+b.nx*d,b.z+b.nz*d))return d;}}return null;});
  // Suave (curvas amplias): promedio circular de ±6 puntos, sin los huecos.
  for(let it=0;it<3;it++)dist=dist.map((d,i)=>{if(d==null)return null;let s=0,n=0;for(let k=-6;k<=6;k++){const q=dist[(i+k+N)%N];if(q!=null){s+=q;n++;}}return s/n;});
  const ok=dist.map((d,i)=>d!=null&&firme(base[i].x+base[i].nx*d,base[i].z+base[i].nz*d));
  // Puentes: un corte de menos de 45 m sobre agua (no el acantilado) se cruza, a la distancia de sus dos orillas.
  const puente=new Array(N).fill(false);
  if(!ok.every(Boolean)&&ok.some(Boolean)){let i0=ok.findIndex(o=>o);for(let k=0;k<N;k++){const i=(i0+k)%N;if(ok[i]||!ok[(i-1+N)%N])continue;let j=i;while(!ok[j%N])j++;const len=j-i;
    if(len*3<=45){const a=(i-1+N)%N,b=j%N,da=dist[a],db=dist[b];let cruza=true;const vals=[];for(let q=0;q<len;q++){const ii=(i+q)%N,d=da+(db-da)*(q+1)/(len+1),x=base[ii].x+base[ii].nx*d,z=base[ii].z+base[ii].nz*d,zz=I.zona(x,z);if(zz==='vacio'||zz==='ciudad'||I.beyond(x,z)>-4){cruza=false;break;}vals.push([ii,d]);}
     if(cruza)for(const [ii,d] of vals){dist[ii]=d;ok[ii]=true;puente[ii]=true;}}}}
  // Tramos: corridas de puntos firmes (dando la vuelta); los de menos de 60 m no van.
  const tramos=[];if(ok.every(Boolean))tramos.push([...Array(N).keys(),0]);else{let s1=ok.findIndex(o=>!o);for(let k=1;k<=N;k++){const i=(s1+k)%N;if(ok[i]&&!ok[(i-1+N)%N])tramos.push([]);if(ok[i])tramos.at(-1)?.push(i);}}
  const out=[];for(const T of tramos){if(T.length*3<60)continue;const P=T.map(i=>({x:base[i].x+base[i].nx*dist[i],z:base[i].z+base[i].nz*dist[i]}));
   // Altura: terreno promediado en ±20 m y, en dos pasadas, nunca más de pendienteAnillo por metro.
   const acc=[0];for(let i=1;i<P.length;i++)acc.push(acc[i-1]+Math.hypot(P[i].x-P[i-1].x,P[i].z-P[i-1].z));const raw=P.map(p=>land(p.x,p.z));
   let h=P.map((_,i)=>{let s=0,n=0;for(let j=0;j<P.length;j++){const d=Math.abs(acc[j]-acc[i]);if(d<=20){s+=raw[j];n++;}}return s/n;});
   const G=CARRETERA.pendienteAnillo;for(let i=1;i<P.length;i++){const L=acc[i]-acc[i-1];h[i]=Math.max(h[i-1]-G*L,Math.min(h[i-1]+G*L,h[i]));}for(let i=P.length-2;i>=0;i--){const L=acc[i+1]-acc[i];h[i]=Math.max(h[i+1]-G*L,Math.min(h[i+1]+G*L,h[i]));}
   // Sobre un puente, la altura no baja de la de sus orillas (va recto entre ellas).
   for(let k=0;k<T.length;k++)if(puente[T[k]]){let a=k,b=k;while(a>0&&puente[T[a]])a--;while(b<T.length-1&&puente[T[b]])b++;h[k]=Math.max(h[k],h[a]+(h[b]-h[a])*(k-a)/((b-a)||1));}
   out.push(P.map((p,i)=>({...p,h:h[i],...(puente[T[i]]?{puente:true}:{})})));}
  return out;};
 const franjasDe=(P)=>{const BQ=CARRETERA.banquina;for(let i=0;i<P.length;i++){const a=P[Math.max(0,i-1)],b=P[Math.min(P.length-1,i+1)],L=Math.hypot(b.x-a.x,b.z-a.z)||1,n=[-(b.z-a.z)/L,(b.x-a.x)/L];
   const w=[];for(const sgn of [1,-1]){const off=3.5+BQ,x=P[i].x+n[0]*sgn*off,z=P[i].z+n[1]*sgn*off,zz=I.zona(x,z),hx=I.landH(x,z);w.push(zz!=='ciudad'&&zz!=='vacio'&&zz!=='agua_honda'&&Math.abs(hx-P[i].h)/off<=CARRETERA.banquinaMax?BQ:0);}P[i].izq=w[0];P[i].der=w[1];}return P;};
 const aCasillas=(pts)=>{const cs=[];for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],L=Math.hypot(b.x-a.x,b.z-a.z)||1;for(let t=0;t<=L;t+=1){const c=at(Math.floor((a.x+(b.x-a.x)*t/L)/CELL),Math.floor((a.z+(b.z-a.z)*t/L)/CELL));if(c&&c.zona!=='agua_honda'&&cs.at(-1)!==c)cs.push(c);}}
  const ok4=c=>c&&c.zona!=='agua_honda';for(let i=1;i<cs.length;i++){const p=cs[i-1],q=cs[i];if(p.x!==q.x&&p.y!==q.y){const k1=at(q.x,p.y),k2=at(p.x,q.y),k=ok4(k1)?k1:ok4(k2)?k2:null;if(k)k.carretera=true;}}for(const c of cs)c.carretera=true;return cs;};
 // La grilla de la montaña (modo 'grilla'): las calles de la ciudad siguen afuera como una grilla de manzanas (sin casas
 // por ahora), sólo del lado de la montaña. Las líneas son las calles que llegan al muro y, más allá del ancho de la
 // ciudad, una cada grilla.paso m. Cada tramo entre dos cruces se construye sólo si su pendiente no pasa de gradoMax y
 // el terreno a lo largo no se aparta más de grilla.corte m de la recta (corte o relleno); lo que no, queda en
 // grilla.rechazos (el 2D lo marca). Sólo queda lo que se alcanza desde la ciudad. Los tramos se juntan en cadenas y en
 // cada esquina (un giro de 90° sin cruce) la curva es recta: un chaflán a 45°, como una pista de circuito impreso.
 let grilla=null,huella=null,eje=null,parques=0;const casas=[];
 // Las casillas que cubre una carretera de ancho an (m): las que tienen el centro a menos de an/2 de su eje.
 const conAncho=(cs,pts,an)=>{const out=[...cs],seen=new Set(cs);for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],L2=(b.x-a.x)**2+(b.z-a.z)**2||1;
  for(let cy=Math.floor((Math.min(a.z,b.z)-an)/CELL);cy<=Math.floor((Math.max(a.z,b.z)+an)/CELL);cy++)for(let cx=Math.floor((Math.min(a.x,b.x)-an)/CELL);cx<=Math.floor((Math.max(a.x,b.x)+an)/CELL);cx++){
   const x=(cx+.5)*CELL,z=(cy+.5)*CELL,t=Math.max(0,Math.min(1,((x-a.x)*(b.x-a.x)+(z-a.z)*(b.z-a.z))/L2));if(Math.hypot(x-a.x-t*(b.x-a.x),z-a.z-t*(b.z-a.z))>=an/2-1e-6)continue;
   const c=at(cx,cy);if(c&&c.zona!=='agua_honda'&&!seen.has(c)){seen.add(c);c.carretera=true;out.push(c);}}}return out;};
 if(CARRETERA.modo==='grilla'){const G=CARRETERA.grilla,Wm=W*CELL,Hm=H*CELL,tanMax=Math.tan(G.gradoMax*Math.PI/180),cg=gates.filter(g=>g.calle);
  // Sólo las calles que salen hacia la montaña dan línea; dos líneas a menos de un paso se funden (no quedan dos calles
  // pegadas): se queda la primera.
  const haciaM=g=>{const x=(g.in[0]+.5)*CELL+g.dir[0]*40,z=(g.in[1]+.5)*CELL+g.dir[1]*40;return I.mountain(Math.atan2(z-I.cz,x-I.cx))>CARRETERA.monteMin;};
  // (2026-10-15: las líneas van en el borde de las casillas, como las calles de la ciudad —de 2 casillas—, y cada una
  // con su ancho: el de la calle de la ciudad de la que sale, o el de una calle —CALLE.calle—)
  const anchoL=new Map(),anchoDe=(eje,v)=>anchoL.get(eje+v)??CALLE_M;
  for(const g of cg)anchoL.set((g.dir[1]?'x':'z')+g.eje,g.ancho*CELL);
  const lineas=eje=>{const L=eje==='x'?Wm:Hm,base=[],out=[],sep=(a,b)=>2*MITAD_MONTE+(anchoDe(eje,a)+anchoDe(eje,b))/2;// (entre dos ejes: dos medias manzanas y medio ancho de cada calle)
   for(const v of [...new Set(cg.filter(g=>(eje==='x'?g.dir[1]:g.dir[0])&&haciaM(g)).map(g=>g.eje))].sort((a,b)=>a-b))if(!base.length||v-base.at(-1)>=sep(base.at(-1),v)-1e-6)base.push(v);// (2026-10-15: a un paso entero —antes 0,6—: más cerca quedaban manzanas de 24–30 m, sin lugar para dos medias manzanas)
   // (2026-10-15: también antes de la primera y después de la última, cada paso m, a más de medio paso de las esquinas:
   // de ahí salen las calles de la circunvalación hacia el monte —ver salidas de la circunvalación—; sin ninguna, una al medio)
   if(!base.length)base.push(Math.round(L/2/CELL)*CELL);
   for(let v=base[0]-sep(base[0],-1);v>G.paso/2;v-=G.paso)base.unshift(Math.floor(v/CELL)*CELL);for(let v=base.at(-1)+sep(base.at(-1),-1);v<L-G.paso/2;v+=G.paso)base.push(Math.ceil(v/CELL)*CELL);
   for(let i=0;i<base.length;i++){out.push(base[i]);const nx=base[i+1];if(nx!=null){const k=Math.max(0,Math.floor((nx-base[i]-(sep(base[i],nx)-G.paso))/(G.paso+CELL))-1);// (cada tramo ≥ paso aun redondeado a casillas: antes, gap/(1,4·paso) dejaba tramos de 45 m)
    for(let j=1;j<=k;j++)out.push(Math.round((base[i]+(nx-base[i])*j/(k+1))/CELL)*CELL);}}
      // Afuera del ancho de la ciudad, ninguna línea pegada al muro (sería una calle al lado de la circunvalación).
   // Desde el muro, cada paso m hacia afuera.
   const v0=LADERA.primero;for(let v=-v0;v>-I.reach;v-=G.paso)out.unshift(v);for(let v=L+v0;v<L+I.reach;v+=G.paso)out.push(v);return out;};// en el centro de una casilla (la calle ocupa su casilla)
  const X=lineas('x'),Z=lineas('z');
  // Las salidas de la circunvalación (2026-10-15): del lado de la montaña, cada línea de la grilla que cae a lo largo de
  // la ciudad sale de la circunvalación —que corre por todo el muro— aunque ninguna calle de la ciudad llegue ahí: una
  // calle de CALLE.calle, en las dos casillas del muro a cada lado de la línea. Antes sólo salían las que continuaban una
  // calle de la ciudad, y un macizo frente a un lado sin calles quedaba sin manzanas.
  for(const [lado,eje,L,n] of [['N','x',X,W],['S','x',X,W],['W','z',Z,H],['E','z',Z,H]])for(const v of L){
   const k=Math.round(v/CELL);if(Math.abs(k*CELL-v)>1e-6||k-1<=C0||k>=n-1-C0)continue;
   if(cg.some(g=>g.lado===lado&&Math.abs(g.eje-v)<1.5*CELL))continue;
   const dir={W:[-1,0],E:[1,0],N:[0,-1],S:[0,1]}[lado],cellsW=[],ok=[];
   for(const t of [k-1,k]){const [gx,gy,ix,iy,ox,oy]=lado==='W'?[0,t,1,t,-1,t]:lado==='E'?[W-1,t,W-2,t,W,t]:lado==='N'?[t,0,t,1,t,-1]:[t,H-1,t,H-2,t,H];cellsW.push([gx,gy]);ok.push(via(ix,iy)&&walk(at(ox,oy)));}
   if(!ok.every(Boolean))continue;const [gx,gy]=cellsW[0];
   const g={x:gx,y:gy,in:lado==='W'?[1,k-1]:lado==='E'?[W-2,k-1]:lado==='N'?[k-1,1]:[k-1,H-2],out:lado==='W'?[-1,k-1]:lado==='E'?[W,k-1]:lado==='N'?[k-1,-1]:[k-1,H],calle:true,dir,ancho:CALLE.calle.casillas,eje:v,cells:cellsW,lado,anillo:true};
   const px=lado==='W'?0:lado==='E'?Wm:v,pz=lado==='N'?0:lado==='S'?Hm:v;if(I.mountain(Math.atan2(pz+dir[1]*40-I.cz,px+dir[0]*40-I.cx))<=CARRETERA.monteMin)continue;
   gates.push(g);cg.push(g);}
  const suelo=(x,z)=>{const zz=I.zona(x,z);return zz!=='agua'&&zz!=='agua_honda'&&zz!=='vacio'&&zz!=='playa'&&zz!=='ciudad'&&I.beyond(x,z)<-6;};
  const enMonte=(x,z)=>I.mountain(Math.atan2(z-I.cz,x-I.cx))>CARRETERA.monteMin;
  // Los nodos: los cruces de la grilla afuera de la ciudad (a más de margen m del muro), en tierra y del lado de la montaña.
  const nodes=new Map(),nk=(i,j)=>i+','+j;
  // (sólo en la ladera urbanizable: hasta el último anillo, LADERA.fin; más arriba la montaña es natural y pasa del 30 %)
  X.forEach((x,i)=>Z.forEach((z,j)=>{if(I.outside(x,z)<G.margen||I.chebyshev(x,z)>LADERA.fin||!suelo(x,z)||!enMonte(x,z))return;
   // (cada cruce, a la altura de diseño de la ladera —I.ladera—; donde el terreno se aparta más de lo que se corta, no hay cruce)
   const hd=I.ladera(x,z);if(Math.abs(I.landH(x,z)-hd)>G.corte)return;nodes.set(nk(i,j),{id:nk(i,j),x,z,h:hd,adj:[]});}));
  // Un tramo: pendiente y apartamiento del terreno.
  // (la pendiente, en lo que sube: sin el tramo plano de cada cruce —medio ancho de su calle más ancha en cada punta;
  // en la entrada desde el muro, ninguno—)
  const rechazos=[],tramo=(a,b)=>{const L=Math.hypot(b.x-a.x,b.z-a.z),dh=Math.abs(b.h-a.h);const pl=n=>n.gate?0:Math.max(anchoDe('x',n.x),anchoDe('z',n.z))/2;if(dh/Math.max(1,L-pl(a)-pl(b))>tanMax)return 'pendiente';
   // (ningún tramo cruza la ciudad: antes se salteaban esos puntos y un tramo unía el monte de arriba con el de abajo
   // por encima de la ciudad)
   for(let t=3;t<L;t+=3){const x=a.x+(b.x-a.x)*t/L,z=a.z+(b.z-a.z)*t/L;if(I.outside(x,z)<0)return 'suelo';if(!suelo(x,z))return 'suelo';if(Math.abs(I.landH(x,z)-(a.h+(b.h-a.h)*t/L))>G.corte)return 'corte';}return null;};
  const link=(a,b)=>{const why=tramo(a,b);if(why){if(why!=='suelo')rechazos.push({a:[a.x,a.z],b:[b.x,b.z],porque:why,grados:+(Math.atan2(Math.abs(b.h-a.h),Math.hypot(b.x-a.x,b.z-a.z))*180/Math.PI).toFixed(1)});return;}a.adj.push(b);b.adj.push(a);};
  // Las calles que cruzan la ladera van a nivel: son los anillos, curvas de nivel de la ladera diseñada. Los tramos a
  // nivel seguidos de una misma línea forman un anillo: una sola altura, mientras el terreno a lo largo no se aparte más
  // de corte m de ella; donde se aparta, ese tramo no se hace (rechazo 'nivel'). Los tramos que suben la ladera llevan la
  // pendiente entre las alturas de sus cruces (LADERA.pendiente).
  // (2026-10-15: en la ladera diseñada, un tramo es curva de nivel si sus dos cruces tienen la misma altura de diseño —antes
  // se miraba hacia dónde caía el terreno en su punto medio, y en un valle un tramo que sube pasaba por curva de nivel y
  // subía un anillo entero de nivel)
  const transversal=(a,b)=>Math.abs(I.ladera(a.x,a.z)-I.ladera(b.x,b.z))<.01;
  const muestras=(a,b)=>{const L=Math.hypot(b.x-a.x,b.z-a.z),out=[a.h,b.h];for(let t=3;t<L;t+=3){const x=a.x+(b.x-a.x)*t/L,z=a.z+(b.z-a.z)*t/L;if(I.outside(x,z)>=0)out.push(I.landH(x,z));}return out;};
  const okSuelo=(a,b)=>{const L=Math.hypot(b.x-a.x,b.z-a.z);for(let t=3;t<L;t+=3){const x=a.x+(b.x-a.x)*t/L,z=a.z+(b.z-a.z)*t/L;if(I.outside(x,z)<0||!suelo(x,z))return false;}return true;};
  const nivel=new Set(),ek0=(a,b)=>a.id<b.id?a.id+'|'+b.id:b.id+'|'+a.id;
  const linea=[];X.forEach((_,i)=>linea.push(Z.map((_,j)=>nodes.get(nk(i,j))||null)));Z.forEach((_,j)=>linea.push(X.map((_,i)=>nodes.get(nk(i,j))||null)));
  for(const L of linea){let run=null;
   const cierra=()=>{if(!run)return;const lv=run.fijo??(run.lo+run.hi)/2;for(const n of run.nodos)if(n.lv==null)n.lv=lv;for(const [a,b] of run.tramos){nivel.add(ek0(a,b));a.adj.push(b);b.adj.push(a);}run=null;};
   for(let k=0;k+1<L.length;k++){const a=L[k],b=L[k+1];if(!a||!b||!transversal(a,b)||!okSuelo(a,b)){cierra();continue;}
    // (el nivel de un anillo es el de su primer cruce —la altura de diseño de la ladera—, no el promedio de todo el tramo:
    // un anillo que llegaba al borde del macizo subía entero hasta 1,3 m; 2026-10-15)
    if(!run)run={fijo:a.lv??a.h,lo:a.h,hi:a.h,nodos:[a],tramos:[]};
    const ms=muestras(a,b),lo=Math.min(run.lo,...ms),hi=Math.max(run.hi,...ms);let fijo=run.fijo;if(fijo==null&&b.lv!=null)fijo=b.lv;
    const ok=fijo!=null?(b.lv==null||Math.abs(b.lv-fijo)<.01)&&lo>=fijo-G.corte&&hi<=fijo+G.corte:hi-lo<=2*G.corte;
    if(!ok){rechazos.push({a:[a.x,a.z],b:[b.x,b.z],porque:'nivel'});cierra();continue;}
    Object.assign(run,{fijo,lo,hi});run.nodos.push(b);run.tramos.push([a,b]);}
   cierra();}
  for(const n of nodes.values()){if(n.lv==null)n.lv=n.h;n.h=n.lv;}
  // Los que suben: entre cruces vecinos, lo que no quedó a nivel.
  for(const n of nodes.values()){const [i,j]=n.id.split(',').map(Number);for(const [di,dj] of [[1,0],[0,1]]){const m=nodes.get(nk(i+di,j+dj));if(m&&!nivel.has(ek0(n,m))&&!transversal(n,m))link(n,m);}}
  // Las entradas: cada calle que llega al muro del lado de la montaña se une al primer cruce hacia afuera.
  const starts=[];for(const g of cg){const vert=!!g.dir[1],v=g.eje,i=vert?X.indexOf(v):Z.indexOf(v);if(i<0)continue;
   const s={id:'g'+g.x+','+g.y,x:vert?v:g.dir[0]<0?0:Wm,z:vert?(g.dir[1]<0?0:Hm):v,h:.02,adj:[],gate:g};
   let first=null;if(vert){const js=Z.map((z,j)=>j).filter(j=>g.dir[1]<0?Z[j]<0:Z[j]>Hm);const j=g.dir[1]<0?js.at(-1):js[0];first=j!=null&&nodes.get(nk(i,j));}
   else{const is=X.map((x,k)=>k).filter(k=>g.dir[0]<0?X[k]<0:X[k]>Wm);const k=g.dir[0]<0?is.at(-1):is[0];first=k!=null&&nodes.get(nk(k,i));}
   if(!first)continue;const n0=s.adj.length;link(s,first);if(s.adj.length>n0)starts.push(s);}
  // (la grilla antes de quedarse con las manzanas completas: todos los cruces y tramos, para el plano 2D)
  const bruto={nodos:[...nodes.values(),...starts].map(n=>({x:n.x,z:n.z,id:n.id})),tramos:[...nodes.values(),...starts].flatMap(n=>n.adj.map(m=>[n.x,n.z,m.x,m.z]))};
  // Sólo lo que se alcanza desde la ciudad.
  // Sólo las calles que cierran manzanas: una manzana está completa con calle en sus cuatro lados (o, pegada a la ciudad,
  // en sus tres lados de afuera, con las dos entradas desde el muro). Las calles que no son lado de ninguna manzana
  // completa se descartan, y lo que queda sin llegar a la ciudad también; se repite hasta que no cambia nada.
  const pk=(a,b)=>a.id<b.id?a.id+'|'+b.id:b.id+'|'+a.id,jT0=Z.findLastIndex(z=>z<0),jB0=Z.findIndex(z=>z>Hm),iL0=X.findLastIndex(x=>x<0),iR0=X.findIndex(x=>x>Wm);
  const entrada=new Map();for(const s0 of starts){const g=s0.gate;entrada.set(g.dir.join(',')+'@'+(g.dir[1]?s0.x:s0.z),s0);}
  const N0=(i,j)=>nodes.get(nk(i,j));
  const murales=()=>{const out=[];
   for(const [lado,eje,fija] of [['0,-1','x',jT0],['0,1','x',jB0],['-1,0','z',iL0],['1,0','z',iR0]]){if(fija<0)continue;const L=eje==='x'?X:Z;
    const es=L.map((v,k)=>[k,entrada.get(lado+'@'+v)]).filter(([,e])=>e);
    for(let k=0;k+1<es.length;k++){const [ia,A]=es[k],[ib,B]=es[k+1],nd=t=>eje==='x'?N0(t,fija):N0(fija,t),lados=[[A,nd(ia)],[B,nd(ib)]];for(let t=ia;t<ib;t++)lados.push([nd(t),nd(t+1)]);
     out.push({lado,ia,ib,A,B,a:nd(ia),b:nd(ib),lados});}}return out;};
  let vivo;
  for(let vuelta=0;vuelta<20;vuelta++){
   vivo=new Set();const q=[...starts];for(const s of q)vivo.add(s);for(let k=0;k<q.length;k++)for(const m of q[k].adj)if(!vivo.has(m)){vivo.add(m);q.push(m);}
   const hay=(a,b)=>a&&b&&vivo.has(a)&&vivo.has(b)&&a.adj.includes(b),lados=[],N=(i,j)=>nodes.get(nk(i,j));
   for(let i=0;i+1<X.length;i++)for(let j=0;j+1<Z.length;j++)lados.push([[N(i,j),N(i+1,j)],[N(i,j+1),N(i+1,j+1)],[N(i,j),N(i,j+1)],[N(i+1,j),N(i+1,j+1)]]);
   // Pegadas a la ciudad: de una entrada a la siguiente del mismo lado (puede haber líneas de la grilla en el medio que
   // no llegan al muro): las dos entradas y la calle de afuera entera entre ellas.
   for(const b of murales())lados.push(b.lados);
   const keep=new Set();for(const L of lados)if(L.every(([a,b])=>hay(a,b)))for(const [a,b] of L)keep.add(pk(a,b));
   // (2026-10-15: y la entrada desde el muro hasta el primer cruce, si ese cruce es esquina de una manzana que queda —con
   // las calles de 12 m la primera línea queda a 42 m del muro, y esa entrada no es lado de ninguna manzana: se podaba y
   // el monte entero quedaba sin llegar a la ciudad—)
   const enKeep=new Set([...keep].flatMap(k=>k.split('|')));for(const s0 of starts)for(const m of s0.adj)if(enKeep.has(m.id))keep.add(pk(s0,m));
   let quitadas=0;for(const n of [...nodes.values(),...starts]){const antes=n.adj.length;n.adj=n.adj.filter(m=>keep.has(pk(n,m)));quitadas+=antes-n.adj.length;}
   if(!quitadas)break;}
  // Cadenas: de un nodo que no es de paso (cruce, punta o entrada) al siguiente.
  const deg=n=>n.adj.filter(m=>vivo.has(m)).length,recto=n=>{const [a,b]=n.adj.filter(m=>vivo.has(m));return Math.abs((a.x-n.x)*(b.z-n.z)-(a.z-n.z)*(b.x-n.x))<1e-6;},paso=n=>!n.gate&&deg(n)===2&&(G.chaflan>0||recto(n)),usados=new Set(),ek=(a,b)=>a.id<b.id?a.id+'|'+b.id:b.id+'|'+a.id,cadenas=[];
  const andar=(a,b)=>{const c=[a,b];usados.add(ek(a,b));let p=a,n=b;while(paso(n)){const m=n.adj.find(m=>vivo.has(m)&&m!==p&&!usados.has(ek(n,m)));if(!m)break;usados.add(ek(n,m));c.push(m);p=n;n=m;}return c;};
  for(const n of [...starts,...[...vivo].filter(n=>!paso(n)&&!n.gate)])for(const m of n.adj)if(vivo.has(m)&&!usados.has(ek(n,m)))cadenas.push(andar(n,m));
  for(const n of vivo)for(const m of n.adj)if(vivo.has(m)&&!usados.has(ek(n,m)))cadenas.push(andar(n,m)); // anillos sueltos
  // El chaflán: en cada giro, la esquina se corta a 45° (G.chaflan m hacia cada lado, sin pasar la mitad del tramo).
  for(const c of cadenas){const pts=[{x:c[0].x,z:c[0].z,h:c[0].h}];
   for(let i=1;i<c.length;i++){const a=c[i-1],b=c[i],d=c[i+1];
    if(d&&(b.x-a.x)*(d.x-b.x)+(b.z-a.z)*(d.z-b.z)<1e-6){const L1=Math.hypot(b.x-a.x,b.z-a.z),L2=Math.hypot(d.x-b.x,d.z-b.z),k=Math.min(G.chaflan,L1/2,L2/2);
     pts.push({x:b.x+(a.x-b.x)*k/L1,z:b.z+(a.z-b.z)*k/L1,h:b.h+(a.h-b.h)*k/L1},{x:b.x+(d.x-b.x)*k/L2,z:b.z+(d.z-b.z)*k/L2,h:b.h+(d.h-b.h)*k/L2});}
    else pts.push({x:b.x,z:b.z,h:b.h});}
   for(const p of pts){p.izq=0;p.der=0;}
   // extremos: el cruce de cada punta (el 3D arma ahí el cruce como en la ciudad); null en la entrada desde el muro.
   const g=c[0].gate||c.at(-1).gate,rev=c.at(-1).gate&&!c[0].gate;if(rev)pts.reverse();const ends=[c[0],c.at(-1)].map(n=>n.gate?null:{id:n.id,x:n.x,z:n.z,h:n.h});if(rev)ends.reverse();
   const an=Math.max(...c.slice(1).map((n,k)=>{const p=c[k];return Math.abs(n.x-p.x)<1e-6?anchoDe('x',n.x):anchoDe('z',n.z);}));
   carreteras.push(Object.assign(conAncho(aCasillas(pts),pts,an).map(q=>[q.x,q.y]),{tipo:'grilla',ancho:an,puntos:pts,extremos:ends,...(g?{desde:[g.x,g.y]}:{}),cima:Math.max(...pts.map(p=>p.h)),llega:false}));}
  // (2026-10-16, medido sin pantalla —validar-huecos—: el 3D deja cada cruce plano hasta su borde y el 2D no lo sabía:
  // las calles subían más de lo que decía el plano —16,7 % en vez de 12,5— y el asfalto quedaba hasta 1 m más abajo que
  // el 2D. Ahora el plano lleva el tramo plano: en cada punta que es un cruce, un punto a medio ancho del cruce —la calle
  // más ancha que llega— a la altura del cruce; la pendiente se mide en lo que sube)
  {const anchoNodo=new Map();for(const r of carreteras)if(r.tipo==='grilla')for(const e of r.extremos||[])if(e)anchoNodo.set(e.id,Math.max(anchoNodo.get(e.id)||0,r.ancho));
   for(const r of carreteras){if(r.tipo!=='grilla'||!r.puntos||r.puntos.length<2)continue;const P=r.puntos;
    for(const [k,e] of [[0,r.extremos?.[0]],[1,r.extremos?.[1]]]){if(!e)continue;const w=anchoNodo.get(e.id)/2,a=k?P.at(-1):P[0],b=k?P.at(-2):P[1],L=Math.hypot(b.x-a.x,b.z-a.z);if(L<=w+.5)continue;
     const q={x:a.x+(b.x-a.x)*w/L,z:a.z+(b.z-a.z)*w/L,h:a.h,izq:0,der:0,plano:true};if(k)P.splice(P.length-1,0,q);else P.splice(1,0,q);}
    r.cima=Math.max(...P.map(p=>p.h));}}
  // Los lotes (sin casas todavía): cada manzana (entre dos líneas y dos líneas, con sus cuatro esquinas en la grilla) se parte en dos mitades de través a la pendiente, cada una un escalón plano (c.terraza, c.lote): una
  // para casas arriba y otra para casas abajo. Si una mitad pediría mover más de rellenoMax m, esa mitad no se hace. El
  // 3D las dibuja como las terrazas (muro de contención entre niveles) y no les pone árboles.
  const hecho=new Set();for(const n of vivo)for(const m of n.adj)if(vivo.has(m))hecho.add(n.id+'|'+m.id);
  const tiene=(a,b)=>a&&b&&(hecho.has(a.id+'|'+b.id)||hecho.has(b.id+'|'+a.id));let manzanas=0;
  // Una manzana: esquinas n00 (x0,z0), n10 (x1,z0), n01 (x0,z1), n11 (x1,z1); m: cuánto se aparta del borde (3 m en una
  // calle, 0 contra el muro de la ciudad) en cada lado [x0, x1, z0, z1].
  const mitadesR=[];
  const manzana=(n00,n10,n01,n11,x0,x1,z0,z1,m,key,libre=false)=>{
   if(!n00||!n10||!n01||!n11||![n00,n10,n01,n11].every(n=>vivo.has(n)))return;
   // completa: calle en los cuatro lados (pegada a la ciudad, el lado del muro no lleva calle)
   const lados=[tiene(n00,n10),tiene(n01,n11),tiene(n00,n01),tiene(n10,n11)].filter(Boolean).length;if(!libre&&lados<4)return;// (las pegadas a la ciudad ya vienen comprobadas)
   const gx=(n10.h+n11.h-n00.h-n01.h)/2,gz=(n01.h+n11.h-n00.h-n10.h)/2,porZ=Math.abs(gz)>=Math.abs(gx);
   // Las dos mitades: en z (norte y sur) o en x (oeste y este). Cada una, al nivel de la calle a la que da (la de abajo y
   // la de arriba): el escalón queda entre las dos mitades.
   // (cada mitad a la altura de la calle a la que da: el escalón —TERRAZA.escalon, LADERA.muro— queda entre las dos.
   // 2026-10-16: se probó dejarlas a TERRAZA.acceso de su calle hacia la otra y la de arriba quedaba hundida, «como un hueco»)
   const s1=porZ?(n00.h+n10.h)/2:(n00.h+n01.h)/2,s2=porZ?(n01.h+n11.h)/2:(n10.h+n11.h)/2,lv1=s1,lv2=s2;
   // (el corte, en el medio de lo edificable —sin las calles—: contra el muro no hay calle, y el medio de la manzana dejaba
   // una mitad de 12 m y otra de 24)
   const mz0=(z0+m[2]+z1-m[3])/2,mx0=(x0+m[0]+x1-m[1])/2;
   const mitades=porZ?[{lv:lv1,calle:s1,front:'N',dentro:(x,z)=>z<mz0},{lv:lv2,calle:s2,front:'S',dentro:(x,z)=>z>=mz0}]:[{lv:lv1,calle:s1,front:'W',dentro:(x,z)=>x<mx0},{lv:lv2,calle:s2,front:'E',dentro:(x,z)=>x>=mx0}];
   const cs=[];for(let cy=Math.floor(z0/CELL)-1;cy<=Math.floor(z1/CELL)+1;cy++)for(let cx=Math.floor(x0/CELL)-1;cx<=Math.floor(x1/CELL)+1;cx++){const x=(cx+.5)*CELL,z=(cy+.5)*CELL;
    if(x<=x0+m[0]||x>=x1-m[1]||z<=z0+m[2]||z>=z1-m[3])continue;const c=at(cx,cy);if(c&&!c.carretera&&c.zona!=='agua'&&c.zona!=='agua_honda'&&c.zona!=='vacio'&&c.zona!=='ciudad')cs.push(c);}
   // (2026-10-15: en una manzana pegada a la ciudad, la mitad que mira al muro no tiene calle —el muro sólo se cruza por
   // las salidas—: es borde verde, una alameda a lo largo del muro; antes llevaba casas de cara al muro, sin entrada)
   const muroLado=libre&&m.includes(0)?['W','E','N','S'][m.indexOf(0)]:null;
   let alguna=false;for(const M of mitades){const mine=cs.filter(c=>M.dentro((c.x+.5)*CELL,(c.y+.5)*CELL));
    if(M.front===muroLado){for(const c of mine)c.borde=true;continue;}if(!mine.length||mine.some(c=>Math.abs(I.landH((c.x+.5)*CELL,(c.y+.5)*CELL)-M.lv)>G.rellenoMax))continue;
    for(const c of mine){c.terraza=+M.lv.toFixed(2);c.lote=true;c.manzana=key;c.frente=M.front;c.nivelCalle=+M.calle.toFixed(2);}alguna=true;mitadesR.push({key,lv:+M.lv.toFixed(2),cells:mine,front:M.front});}if(alguna)manzanas++;};
  // (m: medio ancho de la calle de cada lado; contra el muro de la ciudad, 0)
  const mx=v=>anchoDe('x',v)/2,mz=v=>anchoDe('z',v)/2;
  for(let i=0;i+1<X.length;i++)for(let j=0;j+1<Z.length;j++)manzana(nodes.get(nk(i,j)),nodes.get(nk(i+1,j)),nodes.get(nk(i,j+1)),nodes.get(nk(i+1,j+1)),X[i],X[i+1],Z[j],Z[j+1],[mx(X[i]),mx(X[i+1]),mz(Z[j]),mz(Z[j+1])],nk(i,j));
  // Las manzanas pegadas a la ciudad: entre el muro y la primera línea de afuera, de una calle que sale a la siguiente.
  // Sus esquinas del lado de la ciudad son las entradas desde el muro (al nivel de la ciudad).
  // Del lado de la ciudad, la esquina es la entrada desde el muro si la hay y, si no (una línea que no llega al muro),
  // el muro mismo, al nivel de la ciudad. Basta con que la calle de afuera (entre los dos cruces) esté hecha.
  const deLado=new Map();for(const s0 of starts){const g=s0.gate;deLado.set(g.dir.join(',')+'@'+(g.dir[1]?s0.x:s0.z),s0);}
  const muro=(lado,v,x,z)=>deLado.get(lado+'@'+v)||null;// sólo manzanas completas: la esquina del muro es una entrada
  // Donde la esquina del muro no tiene calle, la franja de esa línea (sin calle hasta el muro) es parte de la manzana.
  const mg=(n,base)=>n?.virtual?-.1:base;
  const jT=Z.findLastIndex(z=>z<0),jB=Z.findIndex(z=>z>Hm),iL=X.findLastIndex(x=>x<0),iR=X.findIndex(x=>x>Wm);
  for(const M of murales()){const {lado,ia,ib,A,B,a,b}=M;if(![[A,a],[B,b]].every(([u,w])=>tiene(u,w))||!M.lados.every(([u,w])=>tiene(u,w)))continue;
   if(lado==='0,-1')manzana(a,b,A,B,X[ia],X[ib],Z[jT],0,[mx(X[ia]),mx(X[ib]),mz(Z[jT]),0],'mN'+ia,true);
   else if(lado==='0,1')manzana(A,B,a,b,X[ia],X[ib],Hm,Z[jB],[mx(X[ia]),mx(X[ib]),0,mz(Z[jB])],'mS'+ia,true);
   else if(lado==='-1,0')manzana(a,A,b,B,X[iL],0,Z[ia],Z[ib],[mx(X[iL]),0,mz(Z[ia]),mz(Z[ib])],'mW'+ia,true);
   else manzana(A,a,B,b,Wm,X[iR],Z[ia],Z[ib],[0,mx(X[iR]),mz(Z[ia]),mz(Z[ib])],'mE'+ia,true);}
  // La huella de la grilla (calles y lotes): el rebaje de la montaña queda sólo ahí y alrededor (mascaraRebaje); el resto
  // de la montaña vuelve a su forma natural, sin la franja rebajada ni su barranco.
  // Los edificios residenciales (ISLA_GEN.residencial): uno por mitad de manzana, de frente a su calle (la del nivel de la
  // mitad), dos casillas de fondo y una casilla libre a cada costado y atrás (el parque chico alrededor). 3 a 5 pisos, el
  // tipo 'residencial' (departamentos arriba y vestíbulo abajo), al nivel de la mitad (L.nivel). Lo demás de la mitad es
  // parque (c.parque).
  // (2026-10-15, la densidad baja de la ciudad al monte: en la primera fila —las medias manzanas entre el muro y el
  // primer anillo, LADERA.primero— edificios residenciales; más arriba, casas. Su alto: el perfil «bajo» de las manzanas
  // de la ciudad —ENCIERRO.perfiles[0] del tope del encierro de la calle de 12 m—, 2 o 3 pisos: por debajo del borde de la
  // ciudad y por encima de las casas.)
  const fila0=M=>{const cx=M.cells.reduce((a,c)=>a+c.x+.5,0)/M.cells.length*CELL,cz=M.cells.reduce((a,c)=>a+c.y+.5,0)/M.cells.length*CELL;return I.chebyshev(cx,cz)<LADERA.primero;};
  const pisosMax=Math.floor(CALLE_M*ENCIERRO.max/ALTURA.piso+1e-9);
  if(ISLA_GEN.residencial)for(const M of mitadesR){if(!fila0(M))continue;const xs=M.cells.map(c=>c.x),ys=M.cells.map(c=>c.y),cx0=Math.min(...xs),cx1=Math.max(...xs),cy0=Math.min(...ys),cy1=Math.max(...ys);
   const vert=M.front==='N'||M.front==='S',ancho=(vert?cx1-cx0:cy1-cy0)+1,fondo=(vert?cy1-cy0:cx1-cx0)+1;if(ancho<4||fondo<2)continue;
   const a0=(vert?cx0:cy0)+1,a1=(vert?cx1:cy1)-1,f0=M.front==='N'?cy0:M.front==='S'?cy1-1:M.front==='W'?cx0:cx1-1,f1=f0+1;
   // (2026-10-15: edificios de 3 casillas de frente —18 m, como los lotes de la ciudad— con una casilla de patio entre uno
   // y otro; si sobran 2 casillas, uno de 2. Antes, uno solo de punta a punta de la mitad: hasta 60 m de frente con un
   // núcleo, salas de 12 × 4,5 y cuartos a más de 45 m de la escalera)
   const set=new Set(M.cells.map(c=>c.x+','+c.y)),n=a1-a0+1,anchos=[];let k=Math.floor((n+1)/4),resto=n-(4*k-1);for(let i=0;i<k;i++)anchos.push(3);if(resto>=3){anchos.push(2);resto-=3;}
   let t=a0+Math.floor(Math.max(0,resto)/2);
   for(const wa of anchos){const b0=t,b1=t+wa-1;t+=wa+1;
    const x0=vert?b0:f0,x1=vert?b1:f1,y0=vert?f0:b0,y1=vert?f1:b1,w=x1-x0+1,h=y1-y0+1;
    let ok=true;for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(!set.has(x+','+y))ok=false;if(!ok)continue;
    const sides={N:'patio',S:'patio',W:'patio',E:'patio'};sides[M.front]='calle';const r2=rng(mix(seed,x0,y0,991)),T=TYPES.residencial;
    const id=lots.length+isl.length,L={id,block:-1-id,x0,y0,x1,y1,w,h,area:w*h,shape:'rect',type:'residencial',front:M.front,sides,zona:'montaña',kind:'residencial',isla:true,pueblo:null,
     wings:[{x0,y0,x1,y1,w,h,front:M.front,sides,role:'main'}],floors:Math.max(2,Math.min(pisosMax,Math.round(pisosMax*ENCIERRO.perfiles[0])+(r2()<.5?1:0))),name:`Residencias ${nombre()}`,nivel:M.lv,manzana:M.key};M.residencial=true;
    isl.push(L);for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const c=at(x,y);if(c)c.edificio=id;}}
   for(const c of M.cells)if(c.edificio==null)c.parque=true;}
  // Las casas (ISLA_GEN.casasMonte): en cada mitad de manzana, de 1 a 4 casas a lo largo de su calle (la del nivel de la
  // mitad), con el frente a 2,5 m del borde y 3 m entre una y otra; sin tocar la primera y la última casilla de los
  // costados (ahí van las rampas). El resto de la mitad es jardín. Cada casa: modelo, centro (x, z), giro, nivel, medidas.
  // ---- Los pasajes peatonales (2026-10-15, la circulación): en cada manzana del monte con sus dos mitades, en el medio de
  // su largo, un pasaje de PASAJE m que la cruza de calle a calle, con una escalera que sube el muro de contención a la
  // pendiente de la escalinata (ESCALINATA.pendiente). Sin él, dos casas espalda con espalda a 30 m quedaban a 120 m
  // caminando (rodeo de 4; el tope, CIRCULACION.peaton.rodeo, es 2). Las casas se reparten a los dos lados.
  const PASAJE=3,pasajes=[],pasajeDe=new Map();
  {const porM=new Map();for(const M of mitadesR)(porM.get(M.key)||porM.set(M.key,[]).get(M.key)).push(M);
   for(const [key,Ms] of porM){if(Ms.length!==2)continue;const [A,B]=Ms,vert=A.front==='N'||A.front==='S';if(vert!==(B.front==='N'||B.front==='S'))continue;
    const cs=[...A.cells,...B.cells],al=cs.map(c=>vert?c.x:c.y),de=cs.map(c=>vert?c.y:c.x),u0=Math.min(...al)*CELL,u1=(Math.max(...al)+1)*CELL;
    const lo=A.front==='N'||A.front==='W'?A:B,hi=lo===A?B:A,muro=(Math.max(...lo.cells.map(c=>vert?c.y:c.x))+1)*CELL;
    // (uno cada LADERA.paso m como mucho, repartidos: una manzana larga lleva dos —con uno solo en el medio, las casas de
    // las puntas quedaban a 2,5 veces la recta de sus vecinas de atrás—)
    const n=Math.max(1,Math.ceil((u1-u0)/LADERA.paso)),lista=[];
    for(let i=0;i<n;i++){const pc=u0+(u1-u0)*(i+.5)/n;const P0={manzana:key,vert,u0:pc-PASAJE/2,u1:pc+PASAJE/2,d0:Math.min(...de)*CELL,d1:(Math.max(...de)+1)*CELL,muro,hA:lo.lv,hB:hi.lv,largo:Math.abs(hi.lv-lo.lv)/ESCALINATA.pendiente};pasajes.push(P0);lista.push(P0);}
    pasajeDe.set(key,lista);}}
  if(ISLA_GEN.casasMonte)for(const M of mitadesR){if(M.residencial)continue;const xs=M.cells.map(c=>c.x),ys=M.cells.map(c=>c.y),cx0=Math.min(...xs),cx1=Math.max(...xs),cy0=Math.min(...ys),cy1=Math.max(...ys);
   const vert=M.front==='N'||M.front==='S',a0=((vert?cx0:cy0)+1)*CELL,a1=(vert?cx1:cy1)*CELL,fondo=((vert?cy1-cy0:cx1-cx0)+1)*CELL;if(a1-a0<9||fondo<8)continue;
   const r3=rng(mix(seed,cx0,cy0,7717)),gap=3;
   const borde=M.front==='N'?cy0*CELL:M.front==='S'?(cy1+1)*CELL:M.front==='W'?cx0*CELL:(cx1+1)*CELL,hacia=M.front==='N'||M.front==='W'?1:-1,ry={N:Math.PI,S:0,W:-Math.PI/2,E:Math.PI/2}[M.front];
   // Casas armadas: para cada lugar, unas casas al azar y la primera que quepa.
   // (2026-10-12: desde la familia —hogar.js—: se sortea quién vive ahí y su casa sale de sus cuartos; el estilo, al azar)
   const familia=()=>{let t=r3()*Object.values(HOGAR_PESO).reduce((a,b)=>a+b,0);for(const [k,p] of Object.entries(HOGAR_PESO)){t-=p;if(t<0)return k;}return 'familia';};
   // los tramos donde van casas: toda la mitad, o los dos lados del pasaje
   const pjs=pasajeDe.get(M.key)||[],tramos=[];let ini=a0;for(const pj of pjs){tramos.push([ini,pj.u0-gap/2]);ini=pj.u1+gap/2;}tramos.push([ini,a1]);
   // (de fondo: el retiro de 2,5 m al frente y, atrás, media separación —la casa de la otra mitad, espalda con espalda,
   // deja la otra mitad—; con «fondo − 3», dos casas de 14,25 m quedaban a 2,5 m: validar-mundo, 2026-10-17)
   const fondoMax=fondo-2.5-gap/2;
   for(const [s0,s1] of tramos){if(s1-s0<7)continue;const elegidas=[];let libre=s1-s0;
    if(ISLA_GEN.casasArmadas){for(let k=0;k<4;k++){let c=null;for(let t=0;t<10&&!c;t++){const sp=randomHouse(r3,{hogar:planHogar(familia(),{variant:Math.floor(r3()*4)}),garaje:'no'}),pl=planHouse(sp);if(pl.w<=libre-(elegidas.length?3:0)&&pl.d<=fondoMax)c={spec:pl.spec,w:pl.w,d:pl.d};}
      if(!c)break;elegidas.push(c);libre-=c.w+(elegidas.length>1?3:0);if(r3()<.15)break;}}
    else for(let k=0;k<4;k++){const caben=CASAS_MONTE.filter(c=>c.w<=libre-(elegidas.length?3:0)&&c.d<=fondoMax&&!(c.otro&&elegidas.some(e=>e.otro)));if(!caben.length)break;let tiro=r3()*caben.reduce((a,c)=>a+(c.peso??3),0),c=caben[0];for(const k of caben){tiro-=k.peso??3;if(tiro<0){c=k;break;}}elegidas.push(c);libre-=c.w+(elegidas.length>1?3:0);if(r3()<.15)break;}
    if(!elegidas.length)continue;const total=elegidas.reduce((a,c)=>a+c.w,0)+gap*(elegidas.length-1);let u=s0+(s1-s0-total)/2;
    for(const c of elegidas){const along=u+c.w/2,depth=borde+hacia*(2.5+c.d/2);casas.push(c.spec?{spec:c.spec,x:vert?along:depth,z:vert?depth:along,ry,nivel:M.lv,w:c.w,d:c.d,manzana:M.key,frente:M.front}:{modelo:c.m,interior:c.interior,paleta:(c.paletas||CASAS_PALETAS)[Math.floor(r3()*(c.paletas||CASAS_PALETAS).length)],pisos:c.pisos,x:vert?along:depth,z:vert?depth:along,ry,nivel:M.lv,w:c.w,d:c.d,manzana:M.key,frente:M.front});u+=c.w+gap;}}}
  // ---- El eje que sube (2026-10-15) ----
  // De las calles que salen de la ciudad hacia el monte, la que sube más anillos de la ladera (a igualdad, una avenida, y
  // la más centrada en su lado del muro) es el eje: sigue más arriba de la ladera urbanizada como escalinata
  // (ESCALINATA), por la montaña natural, mientras el monte no pase de su pendiente, y termina en un mirador (una plaza de
  // ESCALINATA.mirador casillas por lado, a nivel). Una sola por ciudad: la calle que une la ciudad con lo más alto.
  {const cand=[];
   for(const s0 of starts){if(!vivo.has(s0))continue;const g=s0.gate,vert=!!g.dir[1],[dx,dz]=g.dir;const camino=[s0];let n=s0,m;
    while((m=n.adj.find(q=>vivo.has(q)&&!camino.includes(q)&&(vert?Math.abs(q.x-n.x)<1e-6&&(q.z-n.z)*dz>0:Math.abs(q.z-n.z)<1e-6&&(q.x-n.x)*dx>0)))){camino.push(m);n=m;}
    const lado=vert?Wm:Hm,centro=Math.abs((vert?s0.x:s0.z)-lado/2);cand.push({g,camino,anillos:camino.length-1,centro});}
   cand.sort((a,b)=>b.anillos-a.anillos||b.g.ancho-a.g.ancho||a.centro-b.centro);
   // (de las que suben más anillos, la que más sube después por la escalinata: en algunas, pasando la ladera, el monte
   // baja —un valle— o se empina de golpe, y la escalinata no arranca)
   const subida=c0=>{const top=c0.camino.at(-1),[dx,dz]=c0.g.dir,pts=[{x:top.x,z:top.z,h:top.h}];
    for(let t=CELL;t<I.reach;t+=CELL){const x=top.x+dx*t,z=top.z+dz*t;if(I.beyond(x,z)>-(ESCALINATA.mirador+1)*CELL||!suelo(x,z))break;const h=I.landH(x,z),p=pts.at(-1),sl=(h-p.h)/CELL;if(sl>ESCALINATA.pendiente+1e-6||sl<0)break;pts.push({x,z,h});}
    // el mirador: centrado en la punta, las casillas libres; si no hay lugar, la escalinata retrocede
    let mir=null,cs=[];while(pts.length>=3&&!mir){const e=pts.at(-1),cx0=Math.floor(e.x/CELL),cy0=Math.floor(e.z/CELL),k=ESCALINATA.mirador,o=Math.floor(k/2);cs=[];
     for(let y=cy0-o;y<cy0-o+k;y++)for(let x=cx0-o;x<cx0-o+k;x++){const c=at(x,y);if(c&&!c.lote&&!c.carretera&&suelo((x+.5)*CELL,(y+.5)*CELL))cs.push(c);}
     // (2026-10-16: y sin mover la montaña más de TERRAZA.mover en ninguna de sus casillas; si no, retrocede)
     if(cs.length===k*k&&cs.every(c=>Math.abs(I.landH((c.x+.5)*CELL,(c.y+.5)*CELL)-e.h)<=TERRAZA.mover))mir={x:(cx0-o+k/2)*CELL,z:(cy0-o+k/2)*CELL,h:+e.h.toFixed(2),cells:cs.map(c=>[c.x,c.y])};else pts.pop();}
    return mir&&{c0,pts,mir,cs,sube:mir.h-top.h};};
   const max=cand[0]?.anillos||0,ops=cand.filter(c=>c.anillos===max&&max>=1).map(subida).filter(Boolean).sort((a,b)=>b.sube-a.sube);
   const E0=ops[0];
   if(E0){const {c0,pts,mir,cs}=E0;for(const c of cs){c.mirador=true;c.lote=true;c.terraza=mir.h;c.manzana='mirador';}
    {const esc=conAncho(aCasillas(pts),pts,ESCALINATA.ancho+.02).filter(c=>!c.mirador);for(const c of esc)c.escalinata=true;
     carreteras.push(Object.assign(esc.map(q=>[q.x,q.y]),{tipo:'escalinata',ancho:ESCALINATA.ancho,puntos:pts,cima:mir.h,llega:true}));
     eje={desde:[c0.g.x,c0.g.y],lado:c0.g.lado,calle:c0.camino.map(n=>({x:n.x,z:n.z,h:+n.h.toFixed(2)})),escalinata:pts.map(p=>({x:p.x,z:p.z,h:+p.h.toFixed(2)})),mirador:mir,anillos:c0.anillos};}}}
  // ---- El borde verde (2026-10-15): la alameda a lo largo del muro de la ciudad, LADERA.mitad de ancho, en la tierra
  // libre (pradera o monte; la playa queda playa). Junto con las mitades que miran al muro (manzana()), la ciudad queda
  // rodeada de verde donde no la toca un barrio, y el monte no empieza pegado a la circunvalación.
  for(const c of cells.values()){if(c.lote||c.carretera||c.borde||(c.zona!=='pradera'&&c.zona!=='montaña'))continue;
   if(I.chebyshev((c.x+.5)*CELL,(c.y+.5)*CELL)<=LADERA.mitad)c.borde=true;}
  // ---- Los parques de barrio (2026-10-15): el terreno libre que queda encerrado entre calles, lotes y la ciudad (sin
  // llegar al agua, a la playa ni a la montaña abierta: a lo sumo PARQUE_MAX casillas) es un parque. Sobre todo las
  // esquinas de la ciudad: la manzana que contiene la esquina del muro, en L, que ninguna regla arma.
  {const PARQUE_MAX=4*(LADERA.paso/CELL)**2,libre=c=>c&&!c.lote&&!c.carretera&&!c.borde&&(c.zona==='pradera'||c.zona==='montaña'),visto=new Set();let n=0;
   for(const c0 of cells.values()){if(visto.has(c0)||!libre(c0))continue;const comp=[c0];visto.add(c0);let abierto=false;
    for(let k=0;k<comp.length;k++){const c=comp[k];for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const x=c.x+dx,y=c.y+dy;if(x>=0&&y>=0&&x<W&&y<H)continue;// la ciudad: borde
      const o=at(x,y);if(!o||o.zona==='agua'||o.zona==='agua_honda'||o.zona==='playa'||o.zona==='vacio'){abierto=true;continue;}if(libre(o)&&!visto.has(o)){visto.add(o);comp.push(o);}}
     if(comp.length>PARQUE_MAX)abierto=true;}
    if(!abierto&&comp.length>=4){n++;for(const c of comp){c.parque=true;c.terraza=null;}}}
   parques=n;}
  huella=[...cells.values()].filter(c=>c.lote||c.carretera||c.parque||c.borde).map(c=>[c.x,c.y]);I.setMascara(mascaraRebaje(huella));
  grilla={manzanas,parques,pasajes,bruto,eje,lineas:{x:X,z:Z},nodos:[...vivo].filter(n=>!n.gate).map(n=>({x:n.x,z:n.z,h:+n.h.toFixed(1),grado:deg(n)})),rechazos,tramos:[...usados].length};}
 // Por ahora sin anillo (conAnillo): sólo las avenidas que salen de la ciudad.
 if(CARRETERA.modo==='anillo'){const anillos=CARRETERA.conAnillo?anilloGen():[];for(const P of anillos){franjasDe(P);carreteras.push(Object.assign(aCasillas(P).map(c=>[c.x,c.y]),{tipo:'anillo',puntos:P,cima:Math.max(...P.map(p=>p.h))}));}
  // Las salidas: carreras rectas (la calle entra derecha desde el muro al menos carreraMin del largo de la ciudad), las
  // más largas primero, separadas entre sí (al menos un cuarto del lado) y que den a tierra firme.
  const runIn=g=>{const [dx,dy]=g.dir,n0=[-dx,-dy];let n=0;while(via(g.in[0]+n0[0]*n,g.in[1]+n0[1]*n))n++;return n/((dx?W:H)-4);};
  // Sólo hacia la montaña: la playa queda sin avenidas (se mira el ángulo a 40 m del muro, por donde iría la avenida).
  const mid=g=>{const e=(g.ancho||1)-1;return [(g.in[0]+.5+(g.dir[0]?0:e*.5))*CELL,(g.in[1]+.5+(g.dir[0]?e*.5:0))*CELL];};// el eje de la calle o avenida
  const haciaMonte=g=>{const [mx,mz]=mid(g);return I.mountain(Math.atan2(mz+g.dir[1]*40-I.cz,mx+g.dir[0]*40-I.cx))>CARRETERA.monteMin;};
  const cands=gates.filter(g=>g.calle&&haciaMonte(g)).map(g=>({g,run:runIn(g)})).filter(o=>o.run>=CARRETERA.carreraMin)
   // Las calles que cruzan la ciudad por el medio: cuanto más centrada en su lado y más larga hacia adentro, mejor (y una
   // avenida, si las hay, primero).
   .map(o=>{const t=o.g.dir[0]?o.g.y/(H-1):o.g.x/(W-1);return {...o,score:(o.g.ancho===2?2:0)+(1-Math.abs(2*t-1))+o.run};}).sort((a,b)=>b.score-a.score||a.g.x-b.g.x||a.g.y-b.g.y),sal=[];
  const ringPts=anillos.flat();
  // Se prueba cada puerta en orden; la que no da avenida con rotonda no gasta cupo.
  for(const o of cands){const g=o.g;if(sal.length>=CARRETERA.salidas)break;if(sal.some(q=>Math.hypot(q.x-g.x,q.y-g.y)<Math.min(W,H)/4))continue;const [dx,dy]=g.dir,[x0,z0]=mid(g),av=g.ancho===2,pts=[];let hit=null;
   // Sin anillo, la avenida sigue derecha hasta el agua, el acantilado, salidaMax m, o donde mantener la pendiente pediría
   // cortar o rellenar más de salidaCorte m.
   const Gs=CARRETERA.pendienteAnillo;let hPrev=.02;
   for(let t=CELL*1.5;t<=(anillos.length?DMAXsal:CARRETERA.salidaMax);t+=3){const x=x0+dx*t,z=z0+dy*t;const zz=I.zona(x,z);if(zz==='agua_honda'||zz==='vacio'||zz==='agua'||I.beyond(x,z)>-8)break;
    if(!anillos.length&&zz!=='ciudad'&&I.mountain(Math.atan2(z-I.cz,x-I.cx))<=CARRETERA.monteMin+.15)break;// no se mete al lado de la playa
    const th=zz==='ciudad'?.02:I.landH(x,z),nh=Math.max(hPrev-Gs*3,Math.min(hPrev+Gs*3,th));if(!anillos.length&&zz!=='ciudad'&&Math.abs(th-nh)>CARRETERA.salidaCorte)break;hPrev=nh;pts.push({x,z,h:th});
    const nr=ringPts.reduce((b,q)=>{const d=Math.hypot(q.x-x,q.z-z);return d<b.d?{d,q}:b;},{d:1e9,q:null});if(nr.d<3.5&&t>CELL*2){hit=nr.q;pts.push({x:hit.x,z:hit.z,h:hit.h});break;}}
   if(pts.length<3)continue;
   // Altura: del nivel de la calle hasta la del anillo, sin pasar la pendiente del anillo.
   const G=CARRETERA.pendienteAnillo;for(let i=1;i<pts.length;i++){const L=Math.hypot(pts[i].x-pts[i-1].x,pts[i].z-pts[i-1].z);pts[i].h=Math.max(pts[i-1].h-G*L,Math.min(pts[i-1].h+G*L,pts[i].h));}
   if(hit){for(let i=pts.length-2;i>=0;i--){const L=Math.hypot(pts[i+1].x-pts[i].x,pts[i+1].z-pts[i].z);pts[i].h=Math.max(pts[i+1].h-G*L,Math.min(pts[i+1].h+G*L,pts[i].h));}}
   // Al final, una mini rotonda (para que los carros de la ciudad den la vuelta): un círculo de rotonda.R m que cabe
   // entero en tierra; la avenida llega hasta su asfalto (radio rotonda.asf) y la rotonda queda a la altura de ese punto.
   let rot=null;if(!hit){const RO=av?CARRETERA.rotondaAv:CARRETERA.rotonda,firme=(x,z)=>{const zz=I.zona(x,z);return zz!=='agua'&&zz!=='agua_honda'&&zz!=='vacio'&&zz!=='ciudad'&&zz!=='playa'&&I.beyond(x,z)<-4;};
    const tOf=p=>(p.x-x0)*dx+(p.z-z0)*dy;let tc=tOf(pts.at(-1))-RO.R;
    for(;tc>=CELL+RO.R+4;tc-=3){const cx=x0+dx*tc,cz=z0+dy*tc;let ok=true;for(let a=0;a<12&&ok;a++)ok=firme(cx+Math.cos(a/12*Math.PI*2)*RO.R,cz+Math.sin(a/12*Math.PI*2)*RO.R);if(ok)break;}
    if(tc>=CELL+RO.R+4){while(pts.length>2&&tOf(pts.at(-1))>tc-RO.asf)pts.pop();const e=pts.at(-1),h=e.h;
     pts.push({x:x0+dx*(tc-RO.asf),z:z0+dy*(tc-RO.asf),h});rot={x:x0+dx*tc,z:z0+dy*tc,h,R:RO.R,asf:RO.asf,isla:RO.isla};}
    if(!rot)continue;} // sin lugar para la rotonda, no hay avenida (sería un muñón)
   franjasDe(pts);const inside=pts.findIndex(p=>I.zona(p.x,p.z)!=='ciudad');const out=pts.slice(Math.max(0,inside));
   const cel=aCasillas(out);if(rot)for(let y=Math.floor((rot.z-rot.R)/CELL);y<=Math.floor((rot.z+rot.R)/CELL);y++)for(let x=Math.floor((rot.x-rot.R)/CELL);x<=Math.floor((rot.x+rot.R)/CELL);x++){
    const c=at(x,y);if(c&&Math.hypot((x+.5)*CELL-rot.x,(y+.5)*CELL-rot.z)<rot.R+2&&!c.carretera){c.carretera=true;cel.push(c);}}
   sal.push(g);carreteras.push(Object.assign(cel.map(c=>[c.x,c.y]),{tipo:'salida',ancho:av?12:6,puntos:out,desde:[g.x,g.y],cima:Math.max(...out.map(p=>p.h)),llega:!!hit,rotonda:rot}));}}
 if(CARRETERA.modo==='serpentina')for(const g of usadas){const pts=serpentina(g);if(pts.length<6)continue;
  // A casillas: cada metro del trazado marca su casilla; entre dos casillas seguidas en diagonal, la de la esquina.
  const cs=[];for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],L=Math.hypot(b.x-a.x,b.z-a.z);for(let t=0;t<=L;t+=1){const c=at(Math.floor((a.x+(b.x-a.x)*t/L)/CELL),Math.floor((a.z+(b.z-a.z)*t/L)/CELL));if(c&&c.zona!=='agua_honda'&&cs.at(-1)!==c)cs.push(c);}}
  const ok4=c=>c&&c.zona!=='agua_honda';for(let i=1;i<cs.length;i++){const p=cs[i-1],q=cs[i];if(p.x!==q.x&&p.y!==q.y){const k1=at(q.x,p.y),k2=at(p.x,q.y),k=ok4(k1)?k1:ok4(k2)?k2:null;if(k)k.carretera=true;}}
  for(const c of cs)c.carretera=true;carreteras.push(Object.assign(cs.map(c=>[c.x,c.y]),{cima:pts.at(-1).h,cimaLado:pts.cimaLado,motivo:pts.motivo,desde:[g.x,g.y],puntos:pts}));}
 if(CARRETERA.modo==='busqueda')for(const g of usadas){const dist=new Float64Array(NS).fill(Infinity),prev=new Int32Array(NS).fill(-1),HQ=[];
  const push=(k,d)=>{dist[k]=d;HQ.push([d,k]);let i=HQ.length-1;while(i>0){const p=(i-1)>>1;if(HQ[p][0]<=HQ[i][0])break;[HQ[p],HQ[i]]=[HQ[i],HQ[p]];i=p;}},
   pop=()=>{const top=HQ[0],last=HQ.pop();if(HQ.length){HQ[0]=last;let i=0;for(;;){const l=2*i+1,rr=l+1;let m=i;if(l<HQ.length&&HQ[l][0]<HQ[m][0])m=l;if(rr<HQ.length&&HQ[rr][0]<HQ[m][0])m=rr;if(m===i)break;[HQ[m],HQ[i]]=[HQ[i],HQ[m]];i=m;}}return top;};
  // Cada una sube su lado: la cima que cuenta es la de las casillas a menos de 0,7 rad del rumbo de su puerta.
  const c0=at(...g.out),ag=angOf(...g.out);push(cid.get(c0)*(ND+1)+ND,0);let best=null;
  while(HQ.length){const [d,k]=pop();if(d>dist[k])continue;const ci=Math.floor(k/(ND+1)),dir=k%(ND+1),c=CL[ci],x=c.x,y=c.y;
   // Lo más alto alcanzado (a igual altura, lo más corto).
   if((!best||c.hc>best.h+.01)&&I.angDiff(angC[ci],ag)<.7)best={h:c.hc,k};if(d>CARR_LARGO)continue;
   for(let nd=0;nd<ND;nd++){const [dx,dy]=D24[nd],ni=gi(x+dx,y+dy);if(ni<0||honda[ni])continue;const n=CL[ni];
    const len=lenD[nd],grade=Math.abs(n.hc-c.hc)/(len*CELL);if(grade>CARR_MAX)continue;
    let paso=true;for(const [ox,oy] of cruza[nd]){const qi=gi(x+ox,y+oy);if(qi<0||honda[qi]){paso=false;break;}}if(!paso)continue;
    // Un carro no gira más de CARR_GIRO por tramo: una horquilla se arma con varios tramos seguidos (radio de unos 8 m).
    // El giro cuesta según el ángulo entre el rumbo anterior y el nuevo.
    if(dir!==ND&&cosD[dir][nd]<CARR_GIRO)continue;
    const turn=dir===ND?0:4*(1-cosD[dir][nd]);
    const w=len*(n.carretera?.35:n.zona==='agua'?3:1)+turn,nk=ni*(ND+1)+nd,nd2=d+w;if(nd2<dist[nk]){prev[nk]=k;push(nk,nd2);}}}
  if(!best)continue;const path=[];for(let k=best.k;k>=0;k=prev[k])path.push(CL[Math.floor(k/(ND+1))]);path.reverse();
  // Sólo el tramo propio: desde la puerta hasta donde se junta con una carretera que ya había (si se junta).
  const i1=path.findIndex(c=>c.carretera),tramo=i1>=0?path.slice(0,i1+1):path;for(const c of tramo)c.carretera=true;
  if(tramo.length>1)carreteras.push(Object.assign(tramo.map(c=>[c.x,c.y]),{cima:best.h,desde:[g.x,g.y]}));
  // Las casillas que cruza cada tramo también son carretera; en un paso en diagonal se suma la de la esquina: la
  // carretera queda unida por los lados (la red de la simulación une casillas vecinas por sus lados).
  const ok=c=>c&&c.zona!=='agua_honda';
  for(let i=1;i<tramo.length;i++){const a=tramo[i-1],b=tramo[i],seq=[a,...crossed(a.x,a.y,b.x-a.x,b.y-a.y),b];for(const q of seq)q.carretera=true;
   for(let j=1;j<seq.length;j++){const p=seq[j-1],q=seq[j];if(p.x===q.x||p.y===q.y)continue;const k1=at(q.x,p.y),k2=at(p.x,q.y);
    const k=ok(k1)&&(!ok(k2)||Math.abs(k1.h-p.h)<=Math.abs(k2.h-p.h))?k1:ok(k2)?k2:null;if(k)k.carretera=true;}}}
 // El corredor de cada carretera (la carretera y sus franjas): queda reservado, ahí no se ponen casas (las franjas son
 // para las casas que vengan a lo largo de la carretera, no para las de los pueblos ni las sueltas).
 for(const r of carreteras){const P=r.puntos;if(!P)continue;for(let i=0;i<P.length;i++){const a=P[Math.max(0,i-1)],b=P[Math.min(P.length-1,i+1)],L=Math.hypot(b.x-a.x,b.z-a.z)||1,nx=-(b.z-a.z)/L,nz=(b.x-a.x)/L;
  for(const [sgn,w] of [[1,P[i].izq||0],[-1,P[i].der||0]])for(let o=0;o<=3.5+w+1;o+=2){const c=at(Math.floor((P[i].x+nx*sgn*o)/CELL),Math.floor((P[i].z+nz*sgn*o)/CELL));if(c)c.corredor=true;}}}
 // 3) Las casas de cada pueblo alrededor de su plaza (no sobre la carretera ni su corredor).
 const libreDeCalle=ok=>c=>ok(c)&&!c.carretera&&!c.corredor;
 for(const pb of pueblos){const P=pb.P,c0=at(pb.x,pb.y),nm=pb.name,okP=libreDeCalle(P.ok);
  const ring=[];for(let dy=-6;dy<=6;dy++)for(let dx=-6;dx<=6;dx++){const q=at(c0.x+dx,c0.y+dy);if(q&&okP(q)&&!plazas.has(key(q.x,q.y)))ring.push(q);}
  ring.sort((a,b)=>Math.hypot(a.x-c0.x,a.y-c0.y)-Math.hypot(b.x-c0.x,b.y-c0.y));const toward=cen(c0.x,c0.y);
  // Primero lo especial (el puesto ocupa dos casillas), al lado de la plaza.
  if(P.extra==='puesto')for(const q of ring){const q2=at(q.x+1,q.y);if(!q2||!okP(q2)||plazas.has(key(q2.x,q2.y))||!far(q.x,q.y,2)||!far(q2.x,q2.y,2))continue;
   pb.lots.push(lotOf(q,{kind:'puesto',type:'puesto',pueblo:pb.id,floors:()=>2,fullName:`Puesto de policía ${nm}`,mira:'pueblo'},2,1,toward).id);break;}
  for(let t=0;t<(P.extra==='tienda'?(scale>1.25?2:1):0);t++)for(const q of ring){if(!far(q.x,q.y,2)||q.corredor)continue;pb.lots.push(lotOf(q,{kind:'tienda',type:'comercio',pueblo:pb.id,floors:()=>1,name:'Tienda',mira:'pueblo'},1,1,toward).id);break;}
  let nC=0;for(const q of ring){if(nC>=P.casas)break;const L=casa2(q,{kind:P.kind==='costa'?'playa':'cabana',pueblo:pb.id,floors:()=>2,name:'Casa',mira:'pueblo'},okP,2,toward);if(L){pb.lots.push(L.id);nC++;}}}
 // 4) El refugio, junto al final de su carretera, mirándola.
 if(refC){const okR=libreDeCalle(c=>c.zona==='montaña'&&c.u<5),toward=cen(refC.x,refC.y);let done=null;
  for(const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0],[1,1],[-1,-1],[1,-1],[-1,1]]){const q=at(refC.x+dx,refC.y+dy);if(q&&okR(q)&&(done=casa2(q,{kind:'refugio',floors:()=>2,name:'Refugio',mira:'pueblo'},okR,2,toward)))break;}
  if(!done&&!refC.carretera)lotOf(refC,{kind:'refugio',floors:()=>2,name:'Refugio',mira:'ciudad'});}
 // 5) Casas a lo largo de las carreteras: cada CALLE_PASO casillas se prueba a cada lado una casa de dos casillas pegada
 // a la carretera, con la puerta hacia ella (cabaña en la montaña, finca en la pradera, de playa en la arena), dejando
 // una casilla entre casas. Así la carretera serpentea entre casas, como un camino de montaña con su caserío.
 const CALLE_PASO=3,okCalle=libreDeCalle(c=>(!SIN_MONTAÑA&&c.zona==='montaña'||c.zona==='pradera'||c.zona==='playa')&&c.u<4.2&&c.edge>6&&!plazas.has(key(c.x,c.y)));
 if(ISLA_GEN.casas)for(const ruta of carreteras)for(let i=2;i<ruta.length-1;i+=CALLE_PASO){const [rx,ry]=ruta[i],[px,py]=ruta[i-1],tx=rx-px,ty=ry-py;
  for(const sgn of [1,-1]){if(r()<.25)continue;const nx=-ty*sgn,ny=tx*sgn;if(nx&&ny)continue;const q=at(rx+nx,ry+ny);if(!q||!okCalle(q))continue;
   const K=q.zona==='montaña'?{kind:'cabana',floors:()=>r()<.5?2:1,name:'Cabaña',mira:'pueblo'}:q.zona==='pradera'?{kind:'finca',floors:()=>2,name:'Finca',mira:'pueblo'}:{kind:'playa',floors:()=>r()<.5?2:1,name:'Casa de playa',mira:'pueblo'};
   casa2(q,K,okCalle,2,cen(rx,ry));}}
 // 6) Casas sueltas (no sobre la carretera).
 const KINDS=[
  {kind:'playa',max:Math.round(3*scale),sep:3,ok:c=>c.zona==='playa'&&c.h>.18&&c.h<.72&&c.u<1.1&&c.edge>12&&c.out>10,floors:()=>r()<.5?2:1,name:'Casa de playa',mira:'afuera'},
  {kind:'finca',max:Math.round(4*scale),sep:4,ok:c=>(c.zona==='pradera'||!SIN_MONTAÑA&&c.zona==='montaña'&&c.h<10)&&c.h>.95&&c.u<2.4&&c.edge>12&&c.out>12,floors:()=>2,name:'Finca',mira:'ciudad'},
  {kind:'cabana',max:SIN_MONTAÑA?0:Math.round(3*scale),sep:4,ok:c=>c.zona==='montaña'&&c.h>=10&&c.u<3.2&&c.edge>10,floors:()=>r()<.5?2:1,name:'Cabaña',mira:'ciudad'}];
 if(ISLA_GEN.casas)for(const K of KINDS){let k=0;for(const c of cand){if(k>=K.max)break;if(!K.ok(c)||c.carretera||c.corredor||plazas.has(key(c.x,c.y))||!far(c.x,c.y,K.sep))continue;if(casa2(c,K,K.ok,K.sep))k++;}}
 // El globo: en la arena más lejos de la ciudad, libre; el parapente: lo más alto a menos de 14 m del acantilado.
 const libre=c=>walk(c)&&!plazas.has(key(c.x,c.y))&&far(c.x,c.y,2);
 const globo=cand.filter(c=>c.zona==='playa'&&c.u<1.2&&c.edge>6&&libre(c)).sort((a,b)=>b.out-a.out)[0]||null;
 const parapente=cand.filter(c=>c.zona==='montaña'&&c.edge>3&&c.edge<14&&libre(c)).sort((a,b)=>b.h-a.h)[0]||null;
 // El plano de cada casa: el de afuera de la puerta es calle (sendero), lo demás patio (con ventanas).
 for(const L of isl){const F=L.front,mid=[Math.floor((L.x0+L.x1)/2),Math.floor((L.y0+L.y1)/2)],door=F==='N'?[mid[0],L.y0-1]:F==='S'?[mid[0],L.y1+1]:F==='W'?[L.x0-1,mid[1]]:[L.x1+1,mid[1]];L.door=door;
  const inL=(x,y)=>x>=L.x0&&x<=L.x1&&y>=L.y0&&y<=L.y1,frontRow=(x,y)=>F==='N'?y===L.y0-1&&x>=L.x0&&x<=L.x1:F==='S'?y===L.y1+1&&x>=L.x0&&x<=L.x1:F==='W'?x===L.x0-1&&y>=L.y0&&y<=L.y1:x===L.x1+1&&y>=L.y0&&y<=L.y1;
  buildLot(L,seed,(x,y)=>frontRow(x,y)?'calle':inL(x,y)?'nada':'patio');}

 // Los barrios residenciales, para el 3D: los edificios de un mismo nivel se arman juntos con el mismo código de los
 // edificios de la ciudad (world3d), que trabaja en una grilla desde (0, 0) con el piso en y = 0. Por eso cada barrio va
 // en su marco local: origen (ox, oy) en casillas, su alto (nivel) y sus lotes copiados con coordenadas locales y su
 // plano rehecho ahí (ids 0..n). Las casillas de parque del barrio van como plazas (parques: un rectángulo por mitad).
 const barrios=[];
 {const porNivel=new Map();for(const L of isl)if(L.type==='residencial')(porNivel.get(L.nivel)||porNivel.set(L.nivel,[]).get(L.nivel)).push(L);
  for(const [nivel,Ls] of porNivel){const mitades=[...new Set(Ls.map(L=>L.manzana))],celdas=[...cells.values()].filter(c=>c.lote&&c.terraza===nivel&&mitades.includes(c.manzana));
   const xs=celdas.map(c=>c.x),ys=celdas.map(c=>c.y),ox=Math.min(...xs)-1,oy=Math.min(...ys)-1,W=Math.max(...xs)-ox+2,H=Math.max(...ys)-oy+2;
   const lotes=Ls.map((L,k)=>{const C={...L,id:k,block:-1-k,x0:L.x0-ox,x1:L.x1-ox,y0:L.y0-oy,y1:L.y1-oy,wings:L.wings.map(g=>({...g,x0:g.x0-ox,x1:g.x1-ox,y0:g.y0-oy,y1:g.y1-oy})),global:L.id};
    const F=C.front,inL=(x,y)=>x>=C.x0&&x<=C.x1&&y>=C.y0&&y<=C.y1,frontRow=(x,y)=>F==='N'?y===C.y0-1&&x>=C.x0&&x<=C.x1:F==='S'?y===C.y1+1&&x>=C.x0&&x<=C.x1:F==='W'?x===C.x0-1&&y>=C.y0&&y<=C.y1:x===C.x1+1&&y>=C.y0&&y<=C.y1;
    delete C.levels;delete C.parts;buildLot(C,seed,(x,y)=>frontRow(x,y)?'calle':inL(x,y)?'nada':'patio');return C;});
   const parques=mitades.map(k=>{const cs=celdas.filter(c=>c.manzana===k);return {x0:Math.min(...cs.map(c=>c.x))-ox,y0:Math.min(...cs.map(c=>c.y))-oy,x1:Math.max(...cs.map(c=>c.x))-ox,y1:Math.max(...cs.map(c=>c.y))-oy};});
   barrios.push({nivel,ox,oy,W,H,lotes,parques,celdas:celdas.map(c=>[c.x-ox,c.y-oy])});}}
 // Las terrazas de cada pueblo: las casillas a menos de TER_R de la plaza toman un nivel plano, la altura del terreno
 // redondeada a escalones de TER m desde la plaza (las mesetas de un pueblo en ladera). La plaza va al nivel de la plaza;
 // cada casa y la casilla de su puerta, al nivel de la casa (así la puerta da al piso). Entre casillas de distinto nivel
 // el 3D pone un muro de contención (y una escalera donde pasa el sendero); afuera del pueblo, el terreno empalma.
 const TER=3,TER_R=7;
 for(const pb of pueblos){const pl=[...cells.values()].filter(c=>c.plaza===pb.id),base=pl.reduce((a,c)=>a+c.h,0)/(pl.length||1),q=h=>base+Math.round((h-base)/TER)*TER;pb.base=base;
  // Dónde hay pueblo: la plaza, las casas y la puerta de cada una, y una casilla alrededor.
  const core=[...pl];for(const id of pb.lots){const L=isl.find(l=>l.id===id);if(!L)continue;for(let y=L.y0;y<=L.y1;y++)for(let x=L.x0;x<=L.x1;x++){const c=at(x,y);if(c)core.push(c);}const d=at(...L.door);if(d)core.push(d);}
  const foot=new Set();for(const c of core)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const n=at(c.x+dx,c.y+dy);if(n&&n.zona!=='agua_honda'&&Math.max(Math.abs(n.x-pb.x),Math.abs(n.y-pb.y))<=TER_R)foot.add(n);}
  for(const c of foot){c.terraza=c.plaza===pb.id?base:q(c.h);c.pueblo=pb.id;}
  for(const id of pb.lots){const L=isl.find(l=>l.id===id);if(!L)continue;const cs=[];for(let y=L.y0;y<=L.y1;y++)for(let x=L.x0;x<=L.x1;x++){const c=at(x,y);if(c)cs.push(c);}
   const lv=q(cs.reduce((a,c)=>a+c.h,0)/(cs.length||1));L.nivel=lv;for(const c of cs)c.terraza=lv;const d=at(...L.door);if(d&&d.plaza==null)d.terraza=lv;}}
 // Los senderos: desde las salidas (y lo que ya es sendero) hasta la puerta de cada casa, el globo y el parapente, por
 // el camino más barato: la pradera cuesta 1, la arena 1,3, el agua baja 3, la montaña 1,5 más la subida; lo que ya es
 // sendero, 0,4 (los caminos se juntan). Las casas no se cruzan.
 const house=new Set();for(const L of isl)for(let y=L.y0;y<=L.y1;y++)for(let x=L.x0;x<=L.x1;x++)house.add(key(x,y));for(const c of cells.values())c.sendero=false;
 const cost=(a,b)=>{if(!walk(b)||house.has(key(b.x,b.y)))return Infinity;if(b.sendero||b.plaza!=null||b.carretera)return .4;const base=b.zona==='pradera'?1:b.zona==='playa'?1.3:b.zona==='agua'?3:1.5;return base+(b.zona==='montaña'?Math.abs(b.h-a.h)*.6:0);};
 const targets=!ISLA_GEN.senderos?[]:[...pueblos.map(p=>[p.x,p.y]),...isl.map(L=>L.door),...(globo?[[globo.x,globo.y]]:[]),...(parapente?[[parapente.x,parapente.y]]:[])].filter(([x,y])=>walk(at(x,y)));
 for(const [tx,ty] of targets){const dist=new Map(),prev=new Map();
  const H_=[],push=(k,d)=>{dist.set(k,d);H_.push([d,k]);let i=H_.length-1;while(i>0){const p=(i-1)>>1;if(H_[p][0]<=H_[i][0])break;[H_[p],H_[i]]=[H_[i],H_[p]];i=p;}},
   pop=()=>{const top=H_[0],last=H_.pop();if(H_.length){H_[0]=last;let i=0;for(;;){const l=2*i+1,rr=l+1;let m=i;if(l<H_.length&&H_[l][0]<H_[m][0])m=l;if(rr<H_.length&&H_[rr][0]<H_[m][0])m=rr;if(m===i)break;[H_[m],H_[i]]=[H_[i],H_[m]];i=m;}}return top;};
  for(const g of gates)push(key(...g.out),0);for(const c of cells.values())if(c.sendero||c.plaza!=null&&c.conectada)push(key(c.x,c.y),0);
  let found=null;while(H_.length){const [d,k]=pop();if(d>dist.get(k))continue;
   const c=cells.get(k);if(c.x===tx&&c.y===ty){found=k;break;}
   for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nb=at(c.x+dx,c.y+dy);if(!nb)continue;const w=cost(c,nb);if(w===Infinity)continue;const nk2=key(nb.x,nb.y),nd=d+w;if(nd<(dist.get(nk2)??Infinity)){prev.set(nk2,k);push(nk2,nd);}}}
  for(let k=found;k;k=prev.get(k)){const q=cells.get(k);if(q.plaza==null)q.sendero=true;}
  // Una plaza alcanzada queda unida: sus casillas sirven de origen para las casas del pueblo.
  const tq=at(tx,ty);if(found&&tq?.plaza!=null)for(const q of cells.values())if(q.plaza===tq.plaza)q.conectada=true;}
 // Los bordes: lo que ocupa la isla (más una casilla), no el cuadrado de búsqueda.
 const cs=[...cells.values()],bx0=Math.min(0,...cs.map(c=>c.x))-1,by0=Math.min(0,...cs.map(c=>c.y))-1,bx1=Math.max(W,...cs.map(c=>c.x+1))+1,by1=Math.max(H,...cs.map(c=>c.y+1))+1;
 return {lots:isl,pueblos,carreteras,grilla,huella,barrios,casas,cells:cs,bounds:{x0:bx0,y0:by0,x1:bx1,y1:by1},gates,globo:globo&&{x:(globo.x+.5)*CELL,y:(globo.y+.5)*CELL,cell:[globo.x,globo.y]},
  parapente:parapente&&{x:(parapente.x+.5)*CELL,y:(parapente.y+.5)*CELL,cell:[parapente.x,parapente.y]},sectors:I.sectors,reach:I.reach};}

// ---------- De adentro hacia afuera, paso 1 (2026-10-12): el cuarto mínimo de cada programa ----------
// Un programa es un tipo de cuarto con su juego de muebles (todo obligatorio; la medida fija con 'mueble:ancho×fondo').
// minRoom busca, de menor a mayor área, el cuarto más chico donde todo entra, se usa, deja pasar y no tapa la ventana:
// la puerta (0,9 m) en un lado corto pegada a la esquina, y una ventana de hasta 1,2 m en el medio de la pared de
// enfrente, que es fachada. Lo prueba con el mismo furnishRoom de la ciudad (hasta `tries` intentos por medida).
export const PROGRAMS={
 dormitorio_sencillo:{type:'dormitorio',label:'Dormitorio sencillo',recipe:['cama_s:0.9x1.95','mesa_noche','armario:0.9x0.55']},
 dormitorio_estudiante:{type:'dormitorio',label:'Dormitorio con escritorio',recipe:['cama_s:0.9x1.95','armario:0.9x0.55','escritorio:1x0.6']},
 dormitorio_doble:{type:'dormitorio',label:'Dormitorio doble',recipe:['cama:1.4x1.95','mesa_noche','mesa_noche','armario:1.2x0.6']},
 dormitorio_principal:{type:'dormitorio',label:'Dormitorio principal',recipe:['cama:1.6x2.05','mesa_noche','mesa_noche','armario:1.6x0.6','comoda:1.1x0.5']},
 dormitorio_dos_camas:{type:'dormitorio',label:'Dormitorio de dos camas',recipe:['cama_s:0.9x1.95','cama_s:0.9x1.95','mesa_noche','armario:1.2x0.6']},
 medio_bano:{type:'bano',label:'Medio baño',recipe:['inodoro','lavamanos:0.45x0.36']},
 bano:{type:'bano',label:'Baño',recipe:['inodoro','ducha:0.8x0.8','lavamanos']},
 bano_amplio:{type:'bano',label:'Baño amplio',recipe:['inodoro','ducha:0.9x0.9','lavamanos']},
 cocina_linea:{type:'cocina',label:'Cocina en línea',recipe:['meson:1.5x0.6','estufa','nevera:0.7x0.7']},
 cocina_completa:{type:'cocina',label:'Cocina completa',recipe:['meson:2.1x0.6','estufa','nevera:0.9x0.72','lavadora']},
 sala:{type:'sala',label:'Sala',recipe:['sofa:1.8x0.85','sillon','tv:1.1x0.4','mesa_centro:0.9x0.6']},
 comedor_4:{type:'sala',label:'Comedor de 4',recipe:['mesa:1.2x0.8']},
 comedor_6:{type:'sala',label:'Comedor de 6',recipe:['mesa:1.6x0.9']},
 sala_comedor:{type:'sala',label:'Sala comedor',recipe:['sofa:1.8x0.85','tv:1.1x0.4','mesa:1.2x0.8']},
 estudio:{type:'oficina',label:'Estudio',recipe:['escritorio:1.2x0.65','estante:0.9x0.38']}};
const SEATS=([w,d])=>{const L=Math.max(w,d),n=L>=1.4?2:1;return 2*n+(L>=.9?2:0);};
// (ratio: lo más alargado que se acepta, fondo/ancho; con 1,5 sale la medida «de arquitecto», sin cuartos-pasillo)
// (wide: la puerta en el lado largo —el cuarto ancho y poco hondo, como queda en una franja de casa—)
export function minRoom(prog,{step=.25,minW=1.5,maxW=6,maxD=8,tries=24,ratio=99,wide=false}={}){const P=typeof prog==='string'?PROGRAMS[prog]:prog,cands=[];
 for(let a=minW;a<=maxW+1e-9;a+=step)for(let b=a;b<=Math.min(maxD,a*ratio)+1e-9;b+=step)cands.push(wide?[+b.toFixed(2),+a.toFixed(2)]:[+a.toFixed(2),+b.toFixed(2)]);
 cands.sort((a,b)=>a[0]*a[1]-b[0]*b[1]||(b[0]/b[1])-(a[0]/a[1]));// a igual área, lo más cuadrado primero
 const mesa=P.recipe.find(e=>e.startsWith('mesa:')),seats=mesa?SEATS(mesa.split(':')[1].split('x').map(Number)):0;
 for(const [W,D] of cands){const q={u0:1,v0:1,u1:1+W,v1:1+D,Lu:99,Lv:1+D,id:0,type:P.type},wl=Math.min(1.2,W-.4);
  const open={doors:[{axis:'u',at:1,from:1.1,len:.9,a:0,b:'pasillo'}],windows:wl>=.6?[{axis:'u',at:1+D,from:1+W/2-wl/2,len:wl,a:0}]:[]};
  const r=rng(mix(hashStr(P.label),W*100,D*100));
  for(let k=0;k<tries;k++){const its=furnishRoom(q,open,rng(Math.floor(r()*4294967296)),{need:false,pcs:0},P.recipe),Q=its.quality;
   if(!Q||Q.missing||Q.win||Q.doors<Q.doorsN||Q.use<Q.useN)continue;if(seats&&its.filter(i=>i.kind==='silla').length<seats)continue;
   // (cada mesa de noche, pegada a una cama y contra la misma pared)
   const beds=its.filter(i=>/^cama/.test(i.kind)),touch=(a,b)=>Math.max(a.u0-b.u1,b.u0-a.u1,a.v0-b.v1,b.v0-a.v1)<.06;
   if(its.some(n=>n.kind==='mesa_noche'&&!beds.some(b=>b.face===n.face&&touch(b,n))))continue;
   return {W,D,area:+(W*D).toFixed(2),items:its.map(it=>({kind:it.kind,u0:+(it.u0-1).toFixed(2),v0:+(it.v0-1).toFixed(2),u1:+(it.u1-1).toFixed(2),v1:+(it.v1-1).toFixed(2),dir:it.dir}))};}}
 return null;}

// Un cuarto de programa amueblado (las casas desde la familia, hogar.js): q en el marco de la casa (u0..v1, Lu/Lv: el
// borde que es fachada), open con sus puertas y ventanas; la mejor distribución del catálogo, en el marco de la casa.
export function furnishProgram(q,open,recipe){const C=catalogFor(q,open,recipe,'|'+recipe.join(',')),V=C[0];
 return sinInusables(q,open,V.items.map(it=>({...it,u0:it.u0+q.u0,u1:it.u1+q.u0,v0:it.v0+q.v0,v1:it.v1+q.v0,room:q.id})),recipe);}
// Lo que no se puede usar no se pone (2026-10-16, validar-usos): con la prueba de movimiento de ESTE cuarto, los muebles
// opcionales de la receta (los «x?») que quedaron sin poder usarse —o que dejan otro sin uso, o una cortina sin alcanzar—
// se sacan, de a uno, el que más arregla primero. Lo imprescindible queda.
export function sinInusables(q,open,its,recipe){const opt=new Set(recipe.filter(e=>e.endsWith('?')).map(e=>e.slice(0,-1).split(':')[0])),fijo=new Set(recipe.filter(e=>!e.endsWith('?')).map(e=>e.split(':')[0]));
 const {flow}=makeMovement(q,open),malos=l=>{const f=flow(l);return l.filter(it=>USE_AT[it.kind]&&!f.use.has(it)).length*10+((open.windows||[]).filter(w=>w.a===q.id&&!w.shop).length-f.ventanas);};
 let list=[...its];
 // (las sillas: con el radio del personaje —CIRCULACION.peaton.radio, el de la grilla del juego y de validar-usos— y por
 // cualquiera de sus cuatro lados —se corren—; la que no se alcanza, no va)
 {const {flow:fs}=makeMovement(q,open,roomBox(q),CIRCULACION.peaton.radio);let f=fs(list);for(const it of list.filter(o=>o.kind==='silla'))if(!f.use.has(it)){
  // (la del pupitre se va con él —el aula los pone de a par, primero el pupitre—: un pupitre sin silla no sirve)
  const k=list.indexOf(it),pu=list[k-1]?.kind==='pupitre'?list[k-1]:null;list=list.filter(o=>o!==it&&o!==pu);f=fs(list);}}
 let m=malos(list);
 while(m>0){let mejor=null,mm2=m;for(const it of list){if(!opt.has(it.kind)||fijo.has(it.kind)&&list.filter(o=>o.kind===it.kind).length<=recipe.filter(e=>e.split(':')[0]===it.kind).length-recipe.filter(e=>e.endsWith('?')&&e.slice(0,-1).split(':')[0]===it.kind).length)continue;
   const l2=list.filter(o=>o!==it),m2=malos(l2);if(m2<mm2){mm2=m2;mejor=l2;}}
  if(!mejor)break;list=mejor;m=mm2;}
 return list;}
