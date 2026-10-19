/* Copia en módulo ES de lab/ciudad.js (FUGA, 2026-10-06); la lógica es la misma, sólo cambia cómo se exporta.
   Generador de ciudades: calles y edificios por subdivisión, con varios objetivos de robo, escondites de botín,
   comisaría con cárcel y salidas de cada equipo. El tamaño depende de los jugadores. Sirve en el navegador
   (FugaCity) y en Node (require). El motor (lab/game.js) la juega como «city:<jugadores>:<semilla>». */
const City=(function(){
'use strict';
// ~200 casillas por jugador, como el mapa actual de 41×29 para 3 contra 3.
const SIZES=[
 // (2026-10-15: un ~11 % más por lado, con las calles de 2 casillas y las avenidas de 3: la misma cantidad de manzanas)
 {team:2,W:37,H:28,sites:2,hideouts:3},
 {team:3,W:46,H:32,sites:2,hideouts:3},
 {team:5,W:59,H:41,sites:3,hideouts:4},
 {team:8,W:74,H:52,sites:4,hideouts:5}];
// Casillas: por debajo de SOLID se camina.
// Perillas de la ciudad. avenidas: los cortes largos son avenidas de dos casillas (con kioscos). Apagado (pedido de
// Miguel, 2026-10-11): todas las calles del mismo ancho, una casilla de doble sentido (un carril por lado).
// (2026-10-15, decisión de Miguel: calles amplias, medidas.js CALLE) calle: 2 casillas = 12 m (vereda 3 + dos carriles de
// 3 + vereda 3); avenida: 3 casillas = 18 m (cuatro carriles), en los cortes largos; sin kioscos (calles limpias).
const CIUDAD={avenidas:true,calle:2,avenida:3,kioscos:false};
const K={street:0,avenue:1,alley:2,plaza:3,floor:4,door:5,courtyard:6,room:7,hall:8,vault:9,SOLID:10,building:10,wall:11,border:12,kiosk:13};
const SITE_NAMES=['Banco','Joyería','Casa de cambio','Tienda de electrónica','Museo'];
const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
function rng(seed){let n=seed>>>0;return()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}

// buildings:
//  'rooms' (por defecto desde 2026-10-06): edificios de tamaños variados, cuadrados y rectangulares, cuyo interior depende
//    del tamaño: chico (un cuarto, 2 puertas), mediano (2–3 cuartos, 3 puertas), alargado (pasillo a lo largo y cuartos
//    de un lado, 3 puertas) y grande (pasillo central, cuartos a los dos lados y una trastienda, 4 puertas);
//  'entrances': cada edificio con tres entradas y piso adentro (con un tabique si es grande);
//  'solid': edificios macizos, las ciudades del principio.
// Con 'entrances' y 'solid' las ciudades son exactamente las de antes.
// parks (prueba del 2026-10-09): parques repartidos por zonas en vez de plazas sorteadas; ver el paso 3.
function generate({seed=1,team=3,buildings='rooms',siteDoors=null,parks=false}={}){
 const size=SIZES.find(s=>s.team===team)||SIZES[1],{W,H}=size;
 const r=rng((Math.imul(seed,0x9E3779B1)^Math.imul(team,0x85EBCA6B))>>>0),int=(a,b)=>a+Math.floor(r()*(b-a+1));
 const kind=new Uint8Array(W*H).fill(K.building),at=(x,y)=>kind[y*W+x],set=(x,y,k)=>{if(x>0&&y>0&&x<W-1&&y<H-1)kind[y*W+x]=k;};
 const walk=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&at(x,y)<K.SOLID;
 for(let x=0;x<W;x++){kind[x]=K.border;kind[(H-1)*W+x]=K.border;}for(let y=0;y<H;y++){kind[y*W]=K.border;kind[y*W+W-1]=K.border;}
 // Calle de circunvalación: todo el borde se recorre, así ninguna manzana queda encerrada.
 const C=CIUDAD.calle;for(let i=1;i<=C;i++){for(let x=1;x<W-1;x++){set(x,i,K.street);set(x,H-1-i,K.street);}for(let y=1;y<H-1;y++){set(i,y,K.street);set(W-1-i,y,K.street);}}

 // 1. Subdivisión: cada corte abre una calle. Las calles largas son avenidas de dos carriles.
 const blocks=[],avenues=[];
 const split=(x0,y0,x1,y1,depth)=>{
  const w=x1-x0+1,h=y1-y0+1,limit=buildings==='rooms'?int(7,11)+(r()<.45?int(3,5):0):int(6,9);
  if(w<=limit&&h<=limit){blocks.push({x0,y0,x1,y1});return;}
  // Con habitaciones, partes de al menos 5 (edificios con interior); si no, de 3 como siempre.
  const minPart=buildings==='rooms'?5:3,ancho=len=>CIUDAD.avenidas&&len>=.55*Math.max(W,H)?CIUDAD.avenida:CIUDAD.calle,fits=v=>(v?w:h)>=2*minPart+ancho(v?h:w);
  let vertical=w>h?r()<.85:w<h?r()<.15:r()<.5;
  // Si el corte elegido no cabe, se prueba el otro sentido: así no quedan manzanas largas y finas.
  if(!fits(vertical))vertical=!vertical;
  if(!fits(vertical)){blocks.push({x0,y0,x1,y1});return;}
  const span=vertical?w:h,length=vertical?h:w,width=ancho(length);
  // Con habitaciones el corte tiende al centro (promedio de dos tiradas): manzanas más cuadradas, no tiras finas.
  const room=span-2*minPart-width+1,cut=(vertical?x0:y0)+minPart+(buildings==='rooms'?Math.floor((r()+r())/2*room):Math.floor(r()*room));
  const street=width>CIUDAD.calle?K.avenue:K.street;
  for(let i=0;i<width;i++)for(let t=vertical?y0:x0;t<=(vertical?y1:x1);t++)vertical?set(cut+i,t,street):set(t,cut+i,street);
  if(width>CIUDAD.calle)avenues.push({vertical,cut,from:vertical?y0:x0,to:vertical?y1:x1});
  if(vertical){split(x0,y0,cut-1,y1,depth+1);split(cut+width,y0,x1,y1,depth+1);}
  else{split(x0,y0,x1,cut-1,depth+1);split(x0,cut+width,x1,y1,depth+1);}
 };
 split(1+C,1+C,W-2-C,H-2-C,0);
 // Kioscos alternados en los dos carriles de cada avenida: cortan la vista de punta a punta sin cortar el paso.
 // Nunca frente a un cruce, para no tapar la calle que llega.
 // Si el punto cae frente a un cruce, se prueba el otro carril y las casillas vecinas.
 for(const a of CIUDAD.kioscos?avenues:[]){
  let lane=int(0,1);
  for(let t=a.from+int(3,5);t<=a.to-3;t+=int(5,7)){
   const fits=(tt,ln)=>{const x=a.vertical?a.cut+ln:tt,y=a.vertical?tt:a.cut+ln,ox=a.vertical?(ln?x+1:x-1):x,oy=a.vertical?y:(ln?y+1:y-1);
    return tt>a.from&&tt<a.to&&![-1,0,1].some(s=>a.vertical?walk(ox,y+s):walk(x+s,oy))&&[x,y];};
   let spot=null;
   for(const off of [0,1,-1,2,-2,3]){for(const ln of [lane,1-lane]){const p=fits(t+off,ln);if(p){spot=[p,ln];break;}}if(spot)break;}
   if(spot){set(spot[0][0],spot[0][1],K.kiosk);lane=1-spot[1];}
  }
 }
 for(const b of blocks){b.w=b.x1-b.x0+1;b.h=b.y1-b.y0+1;b.cx=(b.x0+b.x1)/2+.5;b.cy=(b.y0+b.y1)/2+.5;}

 // 2. Lugares especiales. La comisaría va en la manzana apta más céntrica; los objetivos, lo más lejos posible
 // de ella y entre sí, para que la policía tenga que repartirse.
 // En una ciudad chica puede no haber manzanas de 5×5 para todos: entonces sirven las de 4×4.
 const big=blocks.filter(b=>b.w>=5&&b.h>=5).length>=size.sites+1,roomy=b=>big?b.w>=5&&b.h>=5:b.w>=4&&b.h>=4,used=new Set();
 const station=blocks.filter(roomy).sort((a,b)=>Math.hypot(a.cx-W/2,a.cy-H/2)-Math.hypot(b.cx-W/2,b.cy-H/2))[0];
 if(station)used.add(station);
 // Los objetivos van en un anillo alrededor de la comisaría (a distancias parecidas de ella) y separados entre sí.
 const sites=[],pool=blocks.filter(b=>roomy(b)&&b!==station);
 const fromStation=b=>station?Math.hypot(b.cx-station.cx,b.cy-station.cy):0;
 const radii=pool.map(fromStation).sort((a,b)=>a-b),ring=radii[Math.floor(radii.length*.6)]||0;
 while(sites.length<size.sites){
  const anchors=sites.map(s=>s.block);
  const pick=pool.filter(b=>!used.has(b)).map(b=>({b,score:(anchors.length?Math.min(...anchors.map(a=>Math.hypot(a.cx-b.cx,a.cy-b.cy))):0)-2*Math.abs(fromStation(b)-ring)+r()*2})).sort((a,b)=>b.score-a.score)[0];
  if(!pick)break;used.add(pick.b);sites.push({block:pick.b});
 }
 // Un edificio con interior: anillo de muro, piso adentro y dos puertas que dan a la calle, en lados distintos.
 const enterable=(b,floorKind)=>{
  for(let y=b.y0;y<=b.y1;y++)for(let x=b.x0;x<=b.x1;x++)set(x,y,(x===b.x0||x===b.x1||y===b.y0||y===b.y1)?K.wall:floorKind);
  const sides=[
   {cells:[],out:[0,-1]},{cells:[],out:[0,1]},{cells:[],out:[-1,0]},{cells:[],out:[1,0]}];
  for(let x=b.x0+1;x<b.x1;x++){sides[0].cells.push([x,b.y0]);sides[1].cells.push([x,b.y1]);}
  for(let y=b.y0+1;y<b.y1;y++){sides[2].cells.push([b.x0,y]);sides[3].cells.push([b.x1,y]);}
  const open=sides.map(s=>({...s,cells:s.cells.filter(([x,y])=>walk(x+s.out[0],y+s.out[1]))})).filter(s=>s.cells.length);
  // Lados opuestos primero, para que la segunda puerta sirva de verdad para escapar.
  const order=open.length>=2?[open[0],open.find(s=>s.out[0]===-open[0].out[0]&&s.out[1]===-open[0].out[1])||open[1]]:open;
  const doors=[];
  for(const s of order.slice(0,2)){const c=s.cells[Math.floor(r()*s.cells.length)];set(c[0],c[1],K.door);doors.push({x:c[0]+.5,y:c[1]+.5});}
  if(doors.length===1&&order[0].cells.length>2){const c=order[0].cells[order[0].cells.length-1];set(c[0],c[1],K.door);doors.push({x:c[0]+.5,y:c[1]+.5});}
  return doors;
 };
 // Interiores de los lugares especiales (sólo con habitaciones). Coordenadas propias: u a lo largo, v a lo ancho; «flip»
 // decide de qué punta queda el fondo. Devuelven null si el edificio es demasiado chico: entonces queda como antes.
 const special=(b,build)=>{
  const alongX=b.w>=b.h,Lu=alongX?b.w:b.h,Lv=alongX?b.h:b.w,iu=Lu-2,iv=Lv-2;
  if(iu<5||iv<3)return null;
  const flip=r()<.5,U=u=>flip?Lu-1-u:u;
  const xy=(u,v)=>{const uu=U(u);return alongX?[b.x0+uu,b.y0+v]:[b.x0+v,b.y0+uu];};
  const put=(u,v,k)=>{const [x,y]=xy(u,v);set(x,y,k);},get=(u,v)=>{const [x,y]=xy(u,v);return at(x,y);};
  const pt=(u,v)=>{const [x,y]=xy(u,v);return {x:x+.5,y:y+.5};};
  for(let u=0;u<Lu;u++)for(let v=0;v<Lv;v++)put(u,v,(u===0||v===0||u===Lu-1||v===Lv-1)?K.wall:K.floor);
  const doors=[],inner=[],side={u0:[0,0,-1,0],v0:[0,0,0,-1],v1:[0,Lv-1,0,1]};
  // Una puerta a la calle en la pared «name», entre from y to, si del otro lado hay calle y de este lado piso. Dos puertas
  // no pueden dar a la misma casilla de adentro ni a casillas vecinas (en una esquina serían, en la práctica, una sola).
  const door=(name,from,to)=>{
   const [u0,v0,du,dv]=side[name],cands=[];
   for(let t=Math.max(1,from);t<=Math.min(to,(du?Lv:Lu)-2);t++){const u=du?u0:t,v=du?t:v0,[ox,oy]=xy(u+du,v+dv),iu=u-du,iv=v-dv;
    if(get(u,v)===K.wall&&walk(ox,oy)&&get(iu,iv)===K.floor&&inner.every(([a,b])=>Math.abs(a-iu)+Math.abs(b-iv)>1))cands.push([u,v,iu,iv]);}
   if(!cands.length)return false;const [u,v,iu,iv]=cands[Math.floor(r()*cands.length)];put(u,v,K.door);doors.push(pt(u,v));inner.push([iu,iv]);return true;
  };
  // Una puerta más donde quede más lejos de las que ya hay (sin sorteo: no cambia el resto de la ciudad más que lo justo).
  // Lejos es por fuera, rodeando el edificio: un policía no puede cuidar dos a la vez.
  door.far=sides=>{
   let best=null;
   for(const name of sides){const [u0,v0,du,dv]=side[name];
    for(let t=1;t<=(du?Lv:Lu)-2;t++){const u=du?u0:t,v=du?t:v0,[ox,oy]=xy(u+du,v+dv),iu=u-du,iv=v-dv;
     if(!(get(u,v)===K.wall&&walk(ox,oy)&&get(iu,iv)===K.floor&&inner.every(([a,b])=>Math.abs(a-iu)+Math.abs(b-iv)>1)))continue;
     const p=pt(u,v),gap=Math.min(...doors.map(d=>Math.abs(d.x-p.x)+Math.abs(d.y-p.y)));if(!best||gap>best.gap)best={u,v,iu,iv,gap};}}
   if(!best)return false;put(best.u,best.v,K.door);doors.push(pt(best.u,best.v));inner.push([best.iu,best.iv]);return true;
  };
  return build({Lu,Lv,iu,iv,put,get,pt,door,doors});
 };
 // Objetivo: salón con las puertas a la calle (a veces una oficina al costado con la suya) y, al fondo, la bóveda con el
 // botín y sin salida a la calle. Se entra a la bóveda desde el salón por dos pasos —así no es una trampa de una sola
 // salida— y se abre trabajando en el salón, frente a ellos (los paneles).
 const siteInterior=b=>special(b,({Lu,Lv,iu,iv,put,get,pt,door,doors})=>{
  const depth=Math.min(3,Math.max(2,Math.floor(iu/3))),wu=Lu-2-depth;
  for(let u=wu+1;u<=Lu-2;u++)for(let v=1;v<=Lv-2;v++)put(u,v,K.vault);
  const mid=Math.floor(Lv/2),gaps=[int(1,Math.max(1,mid-1)),int(Math.min(Lv-2,mid+1),Lv-2)];
  for(let v=1;v<=Lv-2;v++)if(!gaps.includes(v))put(wu,v,K.wall);
  // La oficina no puede tapar ninguno de los dos pasos a la bóveda: su tabique va en otra fila.
  if(iv>=5&&wu-1>=4&&r()<.7){const rows=[];for(let v=2;v<=Lv-3;v++)if(!gaps.includes(v))rows.push(v);
   if(rows.length){const c=rows[Math.floor(r()*rows.length)],gap=int(1,wu-1);for(let u=1;u<wu;u++)if(u!==gap)put(u,c,K.wall);}}
  door('u0',1,Lv-2);
  for(const s of r()<.5?['v0','v1']:['v1','v0'])if(doors.length<2)door(s,1,wu-1);
  if(doors.length<2)door('u0',1,Lv-2);
  while(siteDoors&&doors.length<siteDoors&&door.far(['u0','v0','v1']));
  const panels=gaps.map(v=>get(wu-1,v)===K.floor?pt(wu-1,v):null).filter(Boolean);
  const loot=[];for(let u=Lu-2;u>wu&&loot.length<5;u--)for(let v=1;v<=Lv-2&&loot.length<5;v++)loot.push(pt(u,v));
  const c=pt(wu+1+Math.floor(depth/2),mid);
  return {doors,panels,loot,x:c.x,y:c.y};
 });
 // Comisaría: vestíbulo con las puertas (de ahí sale la policía), a veces una oficina, y al fondo el bloque de celdas,
 // al que se entra desde adentro por un solo paso. Los paneles de rescate están afuera, del lado de las celdas.
 const stationInterior=b=>special(b,({Lu,Lv,iu,iv,put,get,pt,door,doors})=>{
  const depth=2,wu=Lu-2-depth,gap=int(1,Lv-2),jail=[];
  for(let v=1;v<=Lv-2;v++)if(v!==gap)put(wu,v,K.wall);
  for(let u=wu+1;u<=Lu-2;u++)for(let v=1;v<=Lv-2;v++)jail.push(pt(u,v));
  if(iv>=5&&wu-1>=4&&r()<.6){const c=int(2,Lv-3),g=int(1,wu-1);for(let u=1;u<wu;u++)if(u!==g)put(u,c,K.wall);}
  // Puertas en lados opuestos del vestíbulo, para que la policía salga hacia los dos lados; si no se puede, al frente.
  door('v0',1,wu-1);door('v1',1,wu-1);
  if(doors.length<2)door('u0',1,Lv-2);
  const c=pt(Math.max(1,Math.floor(wu/2)),Math.floor(Lv/2));
  return {doors,jail,x:get(Math.max(1,Math.floor(wu/2)),Math.floor(Lv/2))===K.floor?c.x:pt(1,1).x,y:get(Math.max(1,Math.floor(wu/2)),Math.floor(Lv/2))===K.floor?c.y:pt(1,1).y};
 });
 const result={seed,team,buildings,size,W,H,kind,blocks,houses:[],sites:[],hideouts:[],station:null,thiefSpawns:[],copSpawns:[]};
 const inner=buildings==='rooms'&&station?stationInterior(station):null;
 if(inner)result.station={x:inner.x,y:inner.y,block:station,doors:inner.doors,jail:inner.jail,rescuePanels:[]};
 else if(station){
  const doors=enterable(station,K.floor);
  // La cárcel ocupa un rincón del interior; los paneles de rescate están afuera, junto al muro.
  const jail=[];for(let y=station.y0+1;y<Math.min(station.y1,station.y0+3);y++)for(let x=station.x0+1;x<Math.min(station.x1,station.x0+3);x++)jail.push({x:x+.5,y:y+.5});
  result.station={x:station.cx,y:station.cy,block:station,doors,jail,rescuePanels:[]};
 }
 sites.forEach((s,i)=>{
  const inside=buildings==='rooms'?siteInterior(s.block):null;
  if(inside){result.sites.push({id:'s'+i,name:SITE_NAMES[i%SITE_NAMES.length],x:inside.x,y:inside.y,block:s.block,doors:inside.doors,loot:inside.loot,panels:inside.panels});return;}
  const b=s.block,doors=enterable(b,K.floor),loot=[];
  for(let y=b.y0+1;y<b.y1;y++)for(let x=b.x0+1;x<b.x1;x++)if((x+y)%2===0&&loot.length<5)loot.push({x:x+.5,y:y+.5});
  result.sites.push({id:'s'+i,name:SITE_NAMES[i%SITE_NAMES.length],x:b.cx,y:b.cy,block:b,doors,loot});
 });

 // Un edificio con tres entradas: anillo de muro, piso adentro y una puerta en tres lados distintos que den a la calle,
 // para que nadie quede acorralado adentro. Si es grande, un tabique con un paso lo parte en dos cuartos.
 const enterBuilding=b=>{
  for(let y=b.y0;y<=b.y1;y++)for(let x=b.x0;x<=b.x1;x++)set(x,y,(x===b.x0||x===b.x1||y===b.y0||y===b.y1)?K.building:K.room);
  const iw=b.w-2,ih=b.h-2;
  if(iw>=5&&iw>=ih){const x=int(b.x0+2,b.x1-2),gap=int(b.y0+1,b.y1-1);for(let y=b.y0+1;y<b.y1;y++)if(y!==gap)set(x,y,K.building);}
  else if(ih>=5){const y=int(b.y0+2,b.y1-2),gap=int(b.x0+1,b.x1-1);for(let x=b.x0+1;x<b.x1;x++)if(x!==gap)set(x,y,K.building);}
  const sides=[[0,-1],[0,1],[-1,0],[1,0]].map(out=>{const cells=[];
   if(out[1])for(let x=b.x0+1;x<b.x1;x++)cells.push([x,out[1]<0?b.y0:b.y1]);else for(let y=b.y0+1;y<b.y1;y++)cells.push([out[0]<0?b.x0:b.x1,y]);
   return cells.filter(([x,y])=>walk(x+out[0],y+out[1])&&at(x-out[0],y-out[1])===K.room);}).filter(c=>c.length);
  for(let i=sides.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[sides[i],sides[j]]=[sides[j],sides[i]];}
  const doors=[];
  for(const cells of sides.slice(0,3)){const c=cells[Math.floor(r()*cells.length)];set(c[0],c[1],K.door);doors.push(c);}
  // Si sólo dos lados dan a la calle, la tercera puerta va en uno de ellos, lejos de la que ya tiene.
  for(const cells of sides)if(doors.length<3){const far=cells.filter(c=>doors.every(d=>Math.abs(d[0]-c[0])+Math.abs(d[1]-c[1])>2));if(far.length){const c=far[Math.floor(r()*far.length)];set(c[0],c[1],K.door);doors.push(c);}}
 };

 // Edificios con habitaciones. Una manzana larga se parte a veces en 2 o 3 edificios con callejones entre ellos; cada
 // edificio se arma en coordenadas propias: u a lo largo y v a lo ancho, con los muros en u=0, u=Lu-1, v=0 y v=Lv-1.
 const developBlock=b=>{
  const alongX=b.w>=b.h,L=alongX?b.w:b.h;
  let n=1;if(L>=10&&r()<.65)n=L>=15?int(2,3):2;
  const sizes=Array(n).fill(4);for(let left=L-(n-1)-4*n;left>0;left--)sizes[Math.floor(r()*n)]++;
  let at0=alongX?b.x0:b.y0;
  sizes.forEach((len,i)=>{
   const lot=alongX?{x0:at0,y0:b.y0,x1:at0+len-1,y1:b.y1}:{x0:b.x0,y0:at0,x1:b.x1,y1:at0+len-1};
   lot.w=lot.x1-lot.x0+1;lot.h=lot.y1-lot.y0+1;house(lot);at0+=len;
   if(i<n-1){for(let t=alongX?b.y0:b.x0;t<=(alongX?b.y1:b.x1);t++)alongX?set(at0,t,K.alley):set(t,at0,K.alley);at0++;}
  });
 };
 // Parte un tramo interior [a,b] en trozos de al menos «min» casillas, con una pared de una casilla entre trozo y trozo.
 const chunks=(a,b,count,min=2)=>{
  const total=b-a+1,n=Math.max(1,Math.min(count,Math.floor((total+1)/(min+1)))),sizes=Array(n).fill(min);
  for(let left=total-(n-1)-min*n;left>0;left--)sizes[Math.floor(r()*n)]++;
  const out=[];let s=a;for(const len of sizes){out.push([s,s+len-1]);s+=len+1;}return out;
 };
 const house=l=>{
  const alongX=l.w>=l.h,Lu=alongX?l.w:l.h,Lv=alongX?l.h:l.w,iu=Lu-2,iv=Lv-2;
  const xy=(u,v)=>alongX?[l.x0+u,l.y0+v]:[l.x0+v,l.y0+u];
  const put=(u,v,k)=>{const [x,y]=xy(u,v);set(x,y,k);},get=(u,v)=>{const [x,y]=xy(u,v);return at(x,y);};
  for(let u=0;u<Lu;u++)for(let v=0;v<Lv;v++)put(u,v,(u===0||v===0||u===Lu-1||v===Lv-1)?K.building:K.room);
  // Una puerta a la calle en la pared «side», entre las posiciones from y to, si del otro lado hay calle.
  const side={u0:[0,0,-1,0],u1:[Lu-1,0,1,0],v0:[0,0,0,-1],v1:[0,Lv-1,0,1]};
  const doors=[];
  const door=(name,from,to)=>{
   const [u0,v0,du,dv]=side[name],cands=[];
   for(let t=Math.max(1,from);t<=Math.min(to,(du?Lv:Lu)-2);t++){
    const u=du?u0:t,v=du?t:v0,[ox,oy]=xy(u+du,v+dv),inner=get(u-du,v-dv);
    if(get(u,v)===K.building&&walk(ox,oy)&&(inner===K.room||inner===K.hall))cands.push([u,v]);
   }
   if(!cands.length)return false;const [u,v]=cands[Math.floor(r()*cands.length)];put(u,v,K.door);doors.push([u,v]);return true;
  };
  const anyDoor=()=>{for(const s of ['v0','v1','u0','u1'].sort(()=>r()-.5))if(door(s,1,Math.max(Lu,Lv)))return true;return false;};
  // Un tabique a lo ancho (en u) o a lo largo (en v), con un paso en un lugar al azar (o ninguno, para una trastienda).
  const wallAcross=(u,v1,v2,gap=true)=>{const g=gap?int(v1,v2):-1;for(let v=v1;v<=v2;v++)if(v!==g)put(u,v,K.building);};
  const wallAlong=(v,u1,u2,gaps)=>{for(let u=u1;u<=u2;u++)if(!gaps.includes(u))put(u,v,K.building);};
  let type,rooms=1;
  if(iv>=7){
   // Grande: pasillo central a lo largo; cuartos a los dos lados, cada uno con su paso al pasillo y al vecino, salvo
   // una trastienda que sólo da al pasillo; puertas en las dos puntas del pasillo y una a cada lado.
   type='grande';const c=Math.floor(Lv/2);
   for(let u=1;u<=Lu-2;u++)put(u,c,K.hall);
   const top=chunks(1,Lu-2,Math.ceil(iu/3)),bottom=chunks(1,Lu-2,Math.ceil(iu/3)),back=int(0,top.length+bottom.length-1);
   let k=0;
   for(const [rows,wv,v1,v2] of [[top,c-1,1,c-2],[bottom,c+1,c+2,Lv-2]]){
    wallAlong(wv,1,Lu-2,rows.map(([a,b])=>int(a,b)));
    rows.forEach(([a,b],i)=>{if(i>0)wallAcross(a-1,v1,v2,k!==back&&k-1!==back);k++;});
   }
   rooms=top.length+bottom.length;
   door('u0',c,c);door('u1',c,c);door('v0',1,Lu-2);door('v1',1,Lu-2);
  }else if(iv>=4&&iu>=6){
   // Alargado: pasillo junto a una pared larga y cuartos del otro lado, unidos al pasillo y entre sí; puertas en las
   // dos puntas del pasillo y una al costado de los cuartos.
   type='alargado';const flip=r()<.5,hv=flip?Lv-2:1,wv=flip?Lv-3:2,v1=flip?1:3,v2=flip?Lv-4:Lv-2;
   for(let u=1;u<=Lu-2;u++)put(u,hv,K.hall);
   const rowRooms=chunks(1,Lu-2,Math.ceil(iu/3));
   wallAlong(wv,1,Lu-2,rowRooms.map(([a,b])=>int(a,b)));
   rowRooms.forEach(([a],i)=>{if(i>0)wallAcross(a-1,v1,v2);});
   rooms=rowRooms.length;
   door('u0',hv,hv);door('u1',hv,hv);door(flip?'v0':'v1',1,Lu-2);
  }else if(iu>=5&&iv>=2&&iu*iv>=10){
   // Mediano: 2 o 3 cuartos en fila, unidos por un paso; una puerta por cuarto donde dé a la calle, hasta 3.
   type='mediano';const parts=chunks(1,Lu-2,iu>=7?int(2,3):2);
   parts.forEach(([a],i)=>{if(i>0)wallAcross(a-1,1,Lv-2);});
   rooms=parts.length;
   for(const [a,b] of parts){const sides=r()<.5?['v0','v1']:['v1','v0'];if(!door(sides[0],a,b))door(sides[1],a,b);}
   if(!door('u0',1,Lv-2))door('u1',1,Lv-2);
   while(doors.length<3&&anyDoor());
  }else{
   // Chico: un cuarto y dos puertas, en lados opuestos si se puede.
   type='chico';
   const pairs=r()<.5?[['v0','v1'],['u0','u1']]:[['u0','u1'],['v0','v1']];
   for(const [a,b] of pairs){if(door(a,1,Math.max(Lu,Lv))){if(!door(b,1,Math.max(Lu,Lv)))anyDoor();break;}}
   if(!doors.length){anyDoor();anyDoor();}
  }
  result.houses.push({x0:l.x0,y0:l.y0,x1:l.x1,y1:l.y1,w:l.w,h:l.h,type,rooms,doors:doors.length});
 };

 // Parques repartidos (parks): la ciudad se divide en zonas (2, 4, 6 u 8 según el tamaño) y cada zona recibe un parque
 // en la manzana más alejada de los otros parques, de los objetivos y de la comisaría (nunca pegada a ellos). Con la
 // opción no se sortean plazas sueltas: así no quedan amontonadas en un rincón. Sin la opción, la ciudad es
 // exactamente la de siempre (las mismas tiradas, en el mismo orden).
 // Medido con bots (IDEAS.md 0a, 240 rondas por tamaño): 47 / 57 / 52 / 57 % de victorias de ladrones contra 55 / 57 /
 // 48 / 57 % sin parques; no mueve el equilibrio.
 const parkSet=new Set();
 if(parks){
  const Z={2:[2,1],3:[2,2],5:[3,2],8:[4,2]}[team]||[2,2],[zx,zy]=W>=H?Z:[Z[1],Z[0]];
  // Presupuesto: un 9 % de la ciudad. Las zonas se recorren en un orden al azar (de la semilla); si el mejor parque de
  // una zona no cabe en lo que queda, esa zona se queda sin parque. Se prefieren las manzanas chicas.
  const special=[...used].map(b=>({x:b.cx,y:b.cy})),free=blocks.filter(b=>!used.has(b)&&b.w>=5&&b.h>=5);
  let budget=Math.round(W*H*.09);
  const zones=[];for(let j=0;j<zy;j++)for(let i=0;i<zx;i++)zones.push([i,j]);
  for(let k=zones.length-1;k>0;k--){const m=Math.floor(r()*(k+1));[zones[k],zones[m]]=[zones[m],zones[k]];}
  for(const [i,j] of zones){
   const anchors=[...special,...[...parkSet].map(b=>({x:b.cx,y:b.cy}))];
   let best=null,score=-Infinity;
   for(const b of free){
    if(parkSet.has(b)||Math.min(zx-1,Math.floor(b.cx/W*zx))!==i||Math.min(zy-1,Math.floor(b.cy/H*zy))!==j)continue;
    if(special.some(a=>Math.hypot(a.x-b.cx,a.y-b.cy)<6))continue;
    if(b.w*b.h>budget)continue;
    const d=anchors.length?Math.min(...anchors.map(a=>Math.hypot(a.x-b.cx,a.y-b.cy))):0,sc=d-.25*b.w*b.h+r()*2;
    if(sc>score){score=sc;best=b;}
   }
   if(best){parkSet.add(best);budget-=best.w*best.h;}
  }
 }
 result.parks=[...parkSet].map(b=>({x0:b.x0,y0:b.y0,x1:b.x1,y1:b.y1,w:b.w,h:b.h,cx:b.cx,cy:b.cy}));

 // 3. El resto de las manzanas: plazas con kioscos, patios con dos entradas o edificios; los largos, con pasaje.
 for(const b of blocks){
  if(used.has(b))continue;
  const roll=r();
  // Con habitaciones, menos plazas y patios: la ciudad son sobre todo edificios por los que se puede entrar.
  // Con parques, los patios quedan en la misma proporción de siempre (la franja de las plazas sorteadas no se usa).
  const plaza0=buildings==='rooms'?.12:.22,patio0=buildings==='rooms'?.22:.45,plaza=parks?0:plaza0,patio=parks?patio0-plaza0:patio0;
  // Un parque es una plaza con arboledas (en el juego, kioscos: tapan la vista y no se pasa).
  if(parkSet.has(b)||(b.w>=5&&b.h>=5&&roll<plaza)){
   for(let y=b.y0;y<=b.y1;y++)for(let x=b.x0;x<=b.x1;x++)set(x,y,K.plaza);
   const n=parkSet.has(b)?int(2,4):int(1,3);for(let i=0;i<n;i++){const w=int(1,2),h=int(1,2),x=int(b.x0+1,b.x1-w),y=int(b.y0+1,b.y1-h);for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)set(xx,yy,K.kiosk);}
  }else if(b.w>=5&&b.h>=5&&roll<patio){
   for(let y=b.y0;y<=b.y1;y++)for(let x=b.x0;x<=b.x1;x++)set(x,y,(x===b.x0||x===b.x1||y===b.y0||y===b.y1)?K.building:K.courtyard);
   // Dos entradas en lados opuestos: un patio es escondite, no trampa.
   if(r()<.5){set(int(b.x0+1,b.x1-1),b.y0,K.alley);set(int(b.x0+1,b.x1-1),b.y1,K.alley);}
   else{set(b.x0,int(b.y0+1,b.y1-1),K.alley);set(b.x1,int(b.y0+1,b.y1-1),K.alley);}
  }else if(buildings==='rooms'){
   developBlock(b);
  }else if(buildings==='entrances'){
   enterBuilding(b);
  }else if(Math.max(b.w,b.h)>=7&&Math.min(b.w,b.h)>=3){
   if(b.w>=b.h){const x=int(b.x0+2,b.x1-2);for(let y=b.y0;y<=b.y1;y++)set(x,y,K.alley);}
   else{const y=int(b.y0+2,b.y1-2);for(let x=b.x0;x<=b.x1;x++)set(x,y,K.alley);}
  }
 }

 // 4. Todo bolsillo al que no se llega se vuelve edificio: lo caminable está conectado.
 const flood=starts=>{const d=new Int32Array(W*H).fill(-1),q=[];for(const [x,y] of starts)if(walk(x,y)&&d[y*W+x]<0){d[y*W+x]=0;q.push(y*W+x);}
  for(let i=0;i<q.length;i++){const k=q[i],x=k%W,y=(k-x)/W;for(const [dx,dy] of DIRS){const nx=x+dx,ny=y+dy;if(!walk(nx,ny)||d[ny*W+nx]>=0)continue;d[ny*W+nx]=d[k]+1;q.push(ny*W+nx);}}return d;};
 const reach=flood([[1,1]]);for(let i=0;i<W*H;i++)if(kind[i]<K.SOLID&&reach[i]<0)kind[i]=K.building;

 // 5. Paneles de rescate: dos casillas de calle pegadas al muro de la comisaría, en lados sin puerta si se puede.
 if(result.station){
  const b=result.station.block,ring=[];
  for(let x=b.x0+1;x<b.x1;x++){ring.push([x,b.y0-1]);ring.push([x,b.y1+1]);}for(let y=b.y0+1;y<b.y1;y++){ring.push([b.x0-1,y]);ring.push([b.x1+1,y]);}
  const near=(p,q)=>Math.abs(p[0]+.5-q.x)+Math.abs(p[1]+.5-q.y)<3;
  const options=ring.filter(p=>walk(...p)&&!result.station.doors.some(d=>near(p,d)));
  // Con habitaciones, del lado de las celdas: los paneles más cercanos al bloque de celdas primero.
  if(buildings==='rooms'&&result.station.jail.length){const j=result.station.jail,cx=j.reduce((s,p)=>s+p.x,0)/j.length,cy=j.reduce((s,p)=>s+p.y,0)/j.length;options.sort((a,b)=>Math.hypot(a[0]+.5-cx,a[1]+.5-cy)-Math.hypot(b[0]+.5-cx,b[1]+.5-cy));}
  for(const p of options.length?options:ring.filter(p=>walk(...p)))if(result.station.rescuePanels.every(q=>Math.hypot(q.x-p[0]-.5,q.y-p[1]-.5)>3)&&result.station.rescuePanels.length<2)result.station.rescuePanels.push({x:p[0]+.5,y:p[1]+.5});
  // La policía sale por las puertas de la comisaría.
  for(let i=0;i<team;i++){const d=result.station.doors[i%result.station.doors.length];result.copSpawns.push({x:d.x,y:d.y});}
 }

 // 6. Escondites y salidas de los ladrones: se eligen por distancia caminando, lo más lejos de lo ya puesto.
 const specials=[...(result.station?[result.station]:[]),...result.sites].map(s=>[Math.floor(s.x),Math.floor(s.y)]);
 const distTo=pts=>flood(pts.map(p=>[Math.floor(p.x??p[0]+.5),Math.floor(p.y??p[1]+.5)]));
 const farthest=(n,anchors,ok)=>{
  const chosen=[];let best=distTo(anchors.map(([x,y])=>({x,y})));
  for(let i=0;i<n;i++){
   let pick=-1,score=-1;
   for(let k=0;k<W*H;k++){if(best[k]<0||!ok(k%W,(k-k%W)/W))continue;const s=best[k]+r()*1.5;if(s>score){score=s;pick=k;}}
   if(pick<0)break;const x=pick%W,y=(pick-x)/W;chosen.push({x:x+.5,y:y+.5});
   const d=distTo([[x,y]]);for(let k=0;k<W*H;k++)if(d[k]>=0&&(best[k]<0||d[k]<best[k]))best[k]=d[k];
  }
  return chosen;
 };
 // Un escondite necesita al menos dos salidas a su alrededor y no puede estar en una puerta.
 const openAround=(x,y)=>DIRS.filter(([dx,dy])=>walk(x+dx,y+dy)).length;
 const hideable=(x,y)=>[K.street,K.alley,K.plaza,K.courtyard,K.avenue].includes(at(x,y))&&openAround(x,y)>=2;
 // Cada objetivo recibe un escondite a una distancia parecida: 0,3 × (ancho+alto); con más, en ciudades de muchos
 // objetivos no queda dónde ponerlos sin amontonarlos. Lo que cuenta para un ladrón es el escondite MÁS CERCANO,
 // así que ninguno puede quedar mucho más cerca de otro objetivo; además van separados entre sí y nunca en la
 // puerta de la comisaría. Los que sobran se reparten por donde haya menos cosas, con las mismas reglas.
 const target=Math.round((W+H)*.3),fromCops=result.station?distTo(result.station.doors):null;
 const copsFar=k=>!fromCops||fromCops[k]>=.4*target;
 const perSite=result.sites.map(s=>distTo([s]));
 const tooClose=k=>perSite.reduce((p,d)=>p+Math.max(0,.8*target-(d[k]<0?target:d[k])),0);
 const hideouts=[];
 for(const d of perSite){
  const others=hideouts.length?distTo(hideouts):null;let pick=-1,score=-Infinity;
  for(let k=0;k<W*H;k++){const x=k%W,y=(k-x)/W;if(d[k]<0||!hideable(x,y)||!copsFar(k))continue;
   const sc=-Math.abs(d[k]-target)*2-tooClose(k)*3+Math.min(12,fromCops?fromCops[k]:0)+1.5*Math.min(.6*target,others?others[k]:.6*target)+r();
   if(sc>score){score=sc;pick=k;}}
  if(pick>=0)hideouts.push({x:pick%W+.5,y:Math.floor(pick/W)+.5});
 }
 const anchors=[...specials,...hideouts.map(h=>[Math.floor(h.x),Math.floor(h.y)])],missing=size.hideouts-hideouts.length;
 let rest=farthest(missing,anchors,(x,y)=>hideable(x,y)&&copsFar(y*W+x)&&tooClose(y*W+x)===0);
 // Con muchos objetivos puede no quedar lugar lejos de todos: entonces vale cualquier lugar escondible.
 if(rest.length<missing)rest=[...rest,...farthest(missing-rest.length,[...anchors,...rest.map(h=>[Math.floor(h.x),Math.floor(h.y)])],(x,y)=>hideable(x,y)&&copsFar(y*W+x))];
 result.hideouts=[...hideouts,...rest].map((p,i)=>({...p,id:'h'+i,name:'Escondite '+(i+1)}));
 // Salidas de ladrones en la circunvalación, lejos de la comisaría y separadas entre sí.
 const stationAnchor=result.station?[[Math.floor(result.station.x),Math.floor(result.station.y)]]:[[W>>1,H>>1]];
 result.thiefSpawns=farthest(team,stationAnchor,(x,y)=>x===1||y===1||x===W-2||y===H-2);
 result.grid=Array.from({length:H},(_,y)=>Array.from({length:W},(_,x)=>at(x,y)>=K.SOLID?1:0));
 result.names=nameCity(result);
 return result;
}

// ---------- Nombres (2026-10-09): calles, carreras, avenidas, parques, plazas y edificios ----------
// Para las pistas de la policía y para orientarse. Al estilo colombiano: las calles corren de oeste a este y se numeran
// de norte a sur; las carreras corren de norte a sur y se numeran de oeste a este; las avenidas (dos casillas) tienen
// nombre propio. Usan su propio sorteo (no el de la ciudad): con o sin nombres, la ciudad es la misma.
const AVENUES=['Avenida Bolívar','Avenida Santander','Avenida del Mar','Avenida de las Américas','Avenida El Dorado','Avenida Boyacá','Avenida del Libertador','Avenida Colón','Avenida Las Palmas','Avenida Los Cerros'];
const PARKS=['Parque Santander','Parque de los Novios','Parque del Lago','Parque El Virrey','Parque de la Ceiba','Parque Los Almendros','Parque del Sol','Parque La Floresta'];
const PLAZAS=['Plaza de las Flores','Plaza Bolívar','Plaza de Mercado','Plaza de la Paz','Plaza del Reloj','Plaza San Felipe','Plaza Mayor','Plaza La Esperanza'];
const PLACES=['Los Andes','El Cedro','La Candelaria','Las Palmas','Monserrate','El Nogal','Santa Fe','La Ceiba','El Retiro','Los Almendros','San Felipe','La Macarena','El Prado','Altamira','Bellavista','Los Rosales','El Lago','La Esperanza','Mirador','El Bosque','Guadalupe','Las Acacias','San Martín','La Colina','El Recreo','Los Pinos','Primavera','Santa Lucía','La Aurora','El Paraíso'];
function nameCity(res){
 const {W,H,kind,blocks}=res,nr=rng((Math.imul(res.seed,0x2C1B3C6D)^Math.imul(res.team,0x297A2D39)^0x5BD1E995)>>>0);
 const shuffle=a=>{const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(nr()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b;};
 const road=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&[K.street,K.avenue,K.kiosk].includes(kind[y*W+x]);
 const avenue=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&[K.avenue,K.kiosk].includes(kind[y*W+x]);
 const hLine=new Int16Array(W*H).fill(-1),vLine=new Int16Array(W*H).fill(-1),lines=[],avenues=shuffle(AVENUES);
 // Una línea es una fila (o columna) con tramos de calle de 3 casillas o más; una avenida son dos filas juntas.
 const scan=(axis)=>{const along=axis==='h'?W:H,across=axis==='h'?H:W,cell=(a,b)=>axis==='h'?[a,b]:[b,a];let prev=null,number=2+Math.floor(nr()*30),lastNumbered=null;
  for(let b=0;b<across;b++){const runs=[];let a=0;
   // (desde 4 casillas: una avenida de 3 que cruza no es una línea; 2026-10-15)
   while(a<along){const [x,y]=cell(a,b);if(!road(x,y)){a++;continue;}let e=a;while(e<along&&road(...cell(e,b)))e++;if(e-a>=4)runs.push([a,e]);a=e;}
   if(!runs.length){prev=null;continue;}
   const cells=runs.flatMap(([a0,a1])=>Array.from({length:a1-a0},(_,i)=>cell(a0+i,b))),isAv=cells.filter(([x,y])=>avenue(x,y)).length>cells.length*.6;
   let line;
   // (las filas seguidas son la misma calle o avenida: las calles son de 2 casillas y las avenidas de 3)
   if(prev&&prev.avenue===isAv&&prev.last===b-1)line=prev;
   else{line={id:lines.length,axis,avenue:isAv,at:[]};
    if(isAv){line.name=avenues[lines.filter(l=>l.avenue).length%avenues.length];line.short=line.name.replace('Avenida','Av.');}
    else{if(lastNumbered!==null)number+=Math.max(1,Math.round((b-lastNumbered)/3));lastNumbered=b;line.name=`${axis==='h'?'Calle':'Carrera'} ${number}`;line.short=`${axis==='h'?'Cl.':'Cra.'} ${number}`;}
    lines.push(line);}
   line.at.push(b);line.last=b;for(const [x,y] of cells)(axis==='h'?hLine:vLine)[y*W+x]=line.id;prev=line;
  }};
 scan('h');scan('v');
 // Manzanas: parques y plazas por su nombre; los objetivos y la comisaría como ya se llaman; el resto, por tipo.
 const parks=new Set((res.parks||[]).map(b=>`${b.x0},${b.y0}`)),site=b=>res.sites.find(s=>s.block===b),pp=shuffle(PARKS),pl=shuffle(PLAZAS),places=shuffle(PLACES);let ip=0,il=0,ix=0;
 const blockNames=blocks.map(b=>{
  let open=0,total=0,court=0;for(let y=b.y0;y<=b.y1;y++)for(let x=b.x0;x<=b.x1;x++){total++;const k=kind[y*W+x];if(k===K.plaza||k===K.kiosk)open++;if(k===K.courtyard)court++;}
  if(open/total>.8)return parks.has(`${b.x0},${b.y0}`)?pp[ip++%pp.length]:pl[il++%pl.length];
  const s=site(b);if(s)return s.name;if(res.station?.block===b)return 'la comisaría';
  const house=res.houses.find(h=>h.x0===b.x0&&h.y0===b.y0),name=places[ix++%places.length];
  return court?`Conjunto ${name}`:house?.type==='chico'?`Casa ${name}`:house?.type==='grande'?`Torre ${name}`:`Edificio ${name}`;
 });
 return {lines:lines.map(({id,axis,avenue,name,short,at})=>({id,axis,avenue,name,short,at})),hLine,vLine,blocks:blockNames};
}
// El nombre de un lugar (en casillas): la esquina («Calle 5 con Carrera 8»), la calle, o la manzana donde está.
function placeName(map,x,y){
 const n=map.names;if(!n)return '';const {W,H}=map,cx=Math.floor(x),cy=Math.floor(y);if(cx<0||cy<0||cx>=W||cy>=H)return '';
 const i=cy*W+cx,h=n.hLine[i],v=n.vLine[i],L=id=>n.lines[id].name;
 if(h>=0&&v>=0)return `${L(h)} con ${L(v)}`;if(h>=0)return L(h);if(v>=0)return L(v);
 const b=map.blocks.findIndex(b=>cx>=b.x0&&cx<=b.x1&&cy>=b.y0&&cy<=b.y1);if(b>=0)return n.blocks[b];
 for(let r=1;r<=2;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const j=(cy+dy)*W+cx+dx;if(cx+dx<0||cy+dy<0||cx+dx>=W||cy+dy>=H)continue;const hh=n.hLine[j],vv=n.vLine[j];if(hh>=0)return L(hh);if(vv>=0)return L(vv);}
 return '';
}

// ---------- Mediciones y controles ----------
function flood(map,starts){const {W,H,grid}=map,d=new Int32Array(W*H).fill(-1),q=[];
 for(const p of starts){const x=Math.floor(p.x),y=Math.floor(p.y);if(!grid[y]?.[x]&&d[y*W+x]<0){d[y*W+x]=0;q.push(y*W+x);}}
 for(let i=0;i<q.length;i++){const k=q[i],x=k%W,y=(k-x)/W;for(const [dx,dy] of DIRS){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=W||ny>=H||grid[ny][nx]||d[ny*W+nx]>=0)continue;d[ny*W+nx]=d[k]+1;q.push(ny*W+nx);}}return d;}
// Caminos que no comparten casillas (flujo máximo con casillas de capacidad 1; los extremos no cuentan).
function disjointRoutes(map,from,to,cap=3){
 const {W,H,grid}=map,N=W*H,S=2*N,T=2*N+1,head=new Int32Array(2*N+2).fill(-1),next=[],dest=[],capa=[],BIG=99;
 const edge=(a,b,c)=>{for(const [u,v,k] of [[a,b,c],[b,a,0]]){dest.push(v);capa.push(k);next.push(head[u]);head[u]=dest.length-1;}};
 const free=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&!grid[y][x],cell=p=>[Math.floor(p.x),Math.floor(p.y)];
 const ends=new Set([...from,...to].map(p=>{const [x,y]=cell(p);return y*W+x;}));
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!free(x,y))continue;const k=y*W+x;edge(2*k,2*k+1,ends.has(k)?BIG:1);for(const [dx,dy] of DIRS)if(free(x+dx,y+dy))edge(2*k+1,2*((y+dy)*W+x+dx),BIG);}
 for(const p of from){const [x,y]=cell(p);if(free(x,y))edge(S,2*(y*W+x),BIG);}
 for(const p of to){const [x,y]=cell(p);if(free(x,y))edge(2*(y*W+x)+1,T,BIG);}
 let total=0;
 while(total<cap){const prev=new Int32Array(2*N+2).fill(-1),q=[S];prev[S]=-2;
  for(let i=0;i<q.length&&prev[T]<0;i++){const u=q[i];for(let e=head[u];e>=0;e=next[e])if(capa[e]>0&&prev[dest[e]]<0){prev[dest[e]]=e;q.push(dest[e]);}}
  if(prev[T]<0)break;for(let v=T;v!==S;){const e=prev[v];capa[e]--;capa[e^1]++;v=dest[e^1];}total++;}
 return total;
}
function analyze(map){
 const {W,H,grid,station,sites,hideouts,thiefSpawns,copSpawns,size}=map;
 const all=[...(station?[station,...station.doors,...station.rescuePanels]:[]),...sites.flatMap(s=>[s,...s.doors]),...hideouts,...thiefSpawns,...copSpawns];
 const base=flood(map,[{x:1.5,y:1.5}]),reachable=all.every(p=>base[Math.floor(p.y)*W+Math.floor(p.x)]>=0);
 const at=(d,p)=>d[Math.floor(p.y)*W+Math.floor(p.x)];
 // De cada objetivo, al escondite más cercano: si uno queda mucho más lejos, ese robo casi no conviene.
 const toHideout=sites.map(s=>{const d=flood(map,[s]);return Math.min(...hideouts.map(h=>at(d,h)).filter(v=>v>=0));});
 const fromStation=station?(()=>{const d=flood(map,station.doors);return sites.map(s=>at(d,s));})():[];
 const fromThieves=(()=>{const d=flood(map,thiefSpawns);return sites.map(s=>at(d,s));})();
 const copsToHideout=station?(()=>{const d=flood(map,station.doors);return Math.min(...hideouts.map(h=>at(d,h)));})():Infinity;
 const ratio=a=>a.length?+(Math.max(...a)/Math.max(1,Math.min(...a))).toFixed(2):1;
 const hideoutRoutes=Math.min(...hideouts.map(h=>disjointRoutes(map,sites,[h])));
 // Escondites juntos son, en la práctica, uno solo: la policía los cubre a todos desde el mismo lugar.
 const hideoutSpread=Math.min(...hideouts.map((h,i)=>{const d=flood(map,[h]);return Math.min(...hideouts.filter((_,j)=>j!==i).map(o=>at(d,o)));}));
 const siteRoutes=Math.min(...sites.map(s=>disjointRoutes(map,[s],hideouts)));
 let walls=0,cells=0,deadEnds=0,sight=0;
 for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++){cells++;if(grid[y][x]){walls++;continue;}if(DIRS.filter(([dx,dy])=>!grid[y+dy][x+dx]).length===1)deadEnds++;}
 // Línea de vista más larga, sin contar la circunvalación (es el borde del mapa).
 for(let y=2;y<H-2;y++){let run=0;for(let x=2;x<W-2;x++){run=grid[y][x]?0:run+1;sight=Math.max(sight,run);}}
 for(let x=2;x<W-2;x++){let run=0;for(let y=2;y<H-2;y++){run=grid[y][x]?0:run+1;sight=Math.max(sight,run);}}
 const m={reachable,siteRoutes,hideoutRoutes,hideoutSpread,copsToHideout,toHideout,fromStation,fromThieves,hideoutGap:ratio(toHideout),stationGap:ratio(fromStation),
  density:+(walls/cells).toFixed(2),deadEnds,sight,sightShare:+(sight/Math.max(W,H)).toFixed(2),blocks:map.blocks.length,
  perPlayer:Math.round(((W-2)*(H-2)-walls)/(2*size.team))};
 m.checks=[
  {ok:reachable,label:'Todo se alcanza caminando'},
  {ok:sites.length===size.sites&&hideouts.length===size.hideouts&&!!station,label:`${sites.length} objetivos, ${hideouts.length} escondites y comisaría`},
  {ok:siteRoutes>=2,label:'Cada objetivo tiene al menos dos salidas'},
  {ok:hideoutRoutes>=2,label:'A cada escondite se llega por dos caminos'},
  {ok:m.hideoutGap<=1.6,label:'Escondites a distancias parecidas de cada objetivo',detail:`más lejano / más cercano ${m.hideoutGap}`},
  {ok:hideoutSpread>=Math.round((W+H)*.12),label:'Escondites repartidos por la ciudad',detail:`los dos más cercanos, a ${hideoutSpread} pasos (mín. ${Math.round((W+H)*.12)})`},
  {ok:m.stationGap<=1.6,label:'La comisaría no queda encima de un objetivo',detail:`más lejano / más cercano ${m.stationGap}`},
  {ok:copsToHideout>=Math.round((W+H)*.12),label:'Ningún escondite junto a la comisaría',detail:`el más cercano, a ${copsToHideout} pasos (mín. ${Math.round((W+H)*.12)})`},
  {ok:m.deadEnds<=Math.round(W*H/150),label:'Pocos callejones sin salida',detail:`${deadEnds} (máx. ${Math.round(W*H/150)})`},
  {ok:m.sightShare<=.7,label:'Sin líneas de vista que crucen la ciudad',detail:`${sight} casillas`},
  {ok:m.density>=.3&&m.density<=.65,label:'Ni muy abierta ni muy cerrada',detail:`edificios ${Math.round(m.density*100)} %`}];
 m.ok=m.checks.every(c=>c.ok);
 return m;
}
return {SIZES,K,CIUDAD,generate,analyze,flood,disjointRoutes,placeName};
})();
export default City;
