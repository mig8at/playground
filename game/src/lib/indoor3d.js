/* La gente de adentro de los edificios de /demo: en la comisaría, policías; en el hospital, médicos; en el resto, gente
   de oficina o vecinos. Cada uno vive en un piso de su edificio: camina de un lado a otro (entre cuartos, por los vanos)
   y, de vez en cuando, si ve una silla libre cerca, va, se sienta un rato y se vuelve a levantar a caminar.

   Para caminar, cada piso tiene su grilla de 30 cm (lo libre según world.collide: paredes y muebles grandes; las sillas
   no estorban) y se busca el camino a lo ancho. Sólo se mueve y se dibuja la gente del piso de la cámara en los edificios
   cercanos (hasta `max`); el resto queda quieto donde estaba hasta que la cámara vuelve. Cada piso se arma la primera
   vez que hace falta. */
import * as THREE from 'three';
import {makeCharacter,moveCharacter} from './characters3d.js';
import {FLOOR} from './world3d.js';
import {seatStep,approachOf,seatPoint,makeSitter,lieStep} from './sitting3d.js';

const RES=.3,DIRS=[[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,1.41],[1,-1,1.41],[-1,1,1.41],[-1,-1,1.41]];
function rng(seed){let n=seed>>>0;return()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}

export function createIndoor(world,{civil=[],police=[],seed=1,max=36}={}){
 const group=new THREE.Group(),r=rng(seed*71+5),floors=new Map(),active=[];let clock=0;
 const none={group,update(){},blocks:()=>false,dispose(){},count:0};
 if(!civil.length||!world.lots)return none;
 const between=(a,b)=>a+r()*(b-a);
 const pool=who=>{const l=who==='police'&&police.length?police:who==='doctor'?civil.filter(t=>/Doctor/.test(t.name)):civil.filter(t=>/Suit|Casual/.test(t.name));return l.length?l:civil;};

 // ---------- La grilla de un piso ----------
 function grid(L,f){
  const xs=L.cells.flatMap(c=>[c[0],c[2]]),zs=L.cells.flatMap(c=>[c[1],c[3]]),x0=Math.min(...xs),z0=Math.min(...zs),nx=Math.ceil((Math.max(...xs)-x0)/RES),nz=Math.ceil((Math.max(...zs)-z0)/RES);
  const ok=new Uint8Array(nx*nz),feet=f*FLOOR+(L.raise||0),inLot=(x,z)=>L.cells.some(c=>x>c[0]&&x<c[2]&&z>c[1]&&z<c[3])&&!(L.noWalk||[]).some(q=>x>q.x&&x<q.x+q.w&&z>q.z&&z<q.z+q.h);// las paredes (de afuera y entre cuartos) las pone world.collide
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const x=x0+(i+.5)*RES,z=z0+(j+.5)*RES;ok[j*nx+i]=inLot(x,z)&&!world.collide(x,z,.24,true,feet)?1:0;}
  const idx=(x,z)=>{const i=Math.floor((x-x0)/RES),j=Math.floor((z-z0)/RES);return i<0||j<0||i>=nx||j>=nz?-1:j*nx+i;};
  const pos=k=>({x:x0+(k%nx+.5)*RES,z:z0+(Math.floor(k/nx)+.5)*RES});
  const free=k=>k>=0&&ok[k]===1;
  // A lo ancho desde k: distancia (en pasos) a cada casilla alcanzable, y de dónde se llegó.
  const dist=new Float32Array(nx*nz),prev=new Int32Array(nx*nz);
  function flood(k,limit=1e9){dist.fill(-1);if(!free(k))return;dist[k]=0;prev[k]=-1;const q=[k];
   for(let h=0;h<q.length;h++){const c=q[h],i=c%nx,j=(c-i)/nx;if(dist[c]>limit)continue;
    for(const [di,dj,w] of DIRS){const a=i+di,b=j+dj;if(a<0||b<0||a>=nx||b>=nz)continue;const n=b*nx+a;if(!ok[n]||dist[n]>=0)continue;if(di&&dj&&(!ok[j*nx+a]||!ok[b*nx+i]))continue;dist[n]=dist[c]+w;prev[n]=c;q.push(n);}}}
  // ¿Se va en línea recta de a a b sin pisar nada ocupado?
  const sees=(a,b)=>{const n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/(RES*.4));for(let s=1;s<n;s++){if(!free(idx(a.x+(b.x-a.x)*s/n,a.z+(b.z-a.z)*s/n)))return false;}return true;};
  // Camino a k (después de flood): las casillas y, de ahí, sólo las esquinas que hacen falta.
  function path(from,k){const out=[];for(let c=k;c>=0&&prev[c]!==-1;c=prev[c])out.push(pos(c));out.reverse();
   const slim=[];let at=from;for(let i=0;i<out.length;i++){if(i===out.length-1||!sees(at,out[i+1])){slim.push(out[i]);at=out[i];}}return slim;}
  return {ok,nx,nz,idx,pos,free,dist,flood,path,sees,cells:[...ok.keys()].filter(k=>ok[k])};
 }

 // ---------- Un piso: su grilla, sus asientos y su gente ----------
 function floorOf(L,f){const key=L.id+':'+f;if(floors.has(key))return floors.get(key);
  const g=grid(L,f),fr=rng(seed*977+L.id*31+f),y=f*FLOOR+.06+(L.raise||0),seats=L.seats.filter(s=>s.f===f&&g.free(g.idx(approachOf(s).x,approachOf(s).z)));
  let n=L.who==='police'?(f?6:10):Math.max(1,Math.round(seats.length*.6));const people=[],beds=(L.sleeps||[]).filter(b=>b.f===f).map(b=>({b,sides:b.sides.filter(q=>g.free(g.idx(q.x,q.z)))})).filter(o=>o.sides.length),fl={L,f,g,y,seats,beds,people,dist:0};
  // Un local con giro (sillas de comer): más gente, casi toda sentada a comer, y su personal en su puesto (quieto,
  // mirando a lo suyo). El personal no cuenta en n.
  const meal=seats.some(s=>s.meal);if(meal)n=Math.max(n,Math.round(seats.length*.9));fl.meal=meal;
  for(const w of (L.staff||[]).filter(w=>w.f===f&&g.free(g.idx(w.x,w.z)))){const t=pool('civil')[Math.floor(fr()*pool('civil').length)];people.push({fl,tpl:t,char:null,body:null,x:w.x,z:w.z,yaw:w.yaw,yaw0:w.yaw,speed:1,path:[],mode:'staff',timer:0,seat:null,sm:null,stuck:0,staff:true});}
  const order=[...seats].sort(()=>fr()-.5);
  for(let i=0;i<n&&g.cells.length;i++){const t=pool(L.who)[Math.floor(fr()*pool(L.who).length)],p={fl,tpl:t,char:null,body:null,yaw:fr()*6.28,speed:between(.95,1.3),path:[],mode:'pause',timer:fr()*4,seat:null,sm:null,stuck:0};
   // Al empezar, más de la mitad está sentada.
   const s=i<n*(meal?.8:.6)?order.find(s2=>!s2.by):null;
   if(s){s.by=p;p.seat=s;p.sm='sit';p.sitTime=s.meal?between(40,110):between(8,45);p.timer=p.sitTime*fr();const q=seatPoint(s,0);p.x=q.x;p.z=q.z;p.yaw=s.yaw;}
   else{const q=g.pos(g.cells[Math.floor(fr()*g.cells.length)]);p.x=q.x;p.z=q.z;}
   people.push(p);}
  floors.set(key,fl);return fl;}

 function body(p){if(p.char)return;p.char=makeCharacter(p.tpl,r);p.body=p.char.holder;group.add(p.body);
  if(p.seat&&p.sm==='sit'){p.sitter=makeSitter(p.char,p.tpl);if(p.sitter.ok)p.sitter.sitNow();const q=seatPoint(p.seat,0);p.body.position.set(q.x,q.y,q.z);}else p.body.position.set(p.x,p.fl.y,p.z);
  p.body.rotation.y=p.yaw;}

 // Qué hace al terminar una pausa: ir a una silla libre que vea cerca, o a otro punto del piso.
 function decide(p){const {g,seats}=p.fl,from=g.idx(p.x,p.z);g.flood(from,30/RES);
  // A veces, a dormir un rato en una cama libre que tenga cerca (sólo donde hay camas: los departamentos).
  if(p.fl.beds.length&&r()<.15){const near=p.fl.beds.filter(o=>!o.b.by).flatMap(o=>o.sides.map(q=>({o,q,d:g.dist[g.idx(q.x,q.z)]}))).filter(o=>o.d>=0&&o.d*RES<9).sort((a,b)=>a.d-b.d).slice(0,2);
   if(near.length){const o=near[Math.floor(r()*near.length)];o.o.b.by=p;p.bed=o.o.b;p.side=o.q;p.sleepTime=between(20,60);p.path=g.path(p,g.idx(o.q.x,o.q.z));p.mode='goBed';return;}}
  // En un local: casi siempre, a una mesa libre (aunque esté lejos), y a comer un buen rato.
  if(p.fl.meal&&r()<.8){const near=seats.filter(s=>s.meal&&!s.by).map(s=>{const a=approachOf(s);return {s,a,d:g.dist[g.idx(a.x,a.z)]};}).filter(o=>o.d>=0).sort((a,b)=>a.d-b.d).slice(0,4);
   if(near.length){const o=near[Math.floor(r()*near.length)];o.s.by=p;p.seat=o.s;p.sitTime=between(40,110);p.path=g.path(p,g.idx(o.a.x,o.a.z));p.mode='go';return;}}
  const sitChance=p.fl.L.who==='police'?.35:.55;
  if(r()<sitChance){const near=seats.filter(s=>!s.by).map(s=>{const a=approachOf(s);return {s,a,d:g.dist[g.idx(a.x,a.z)]};}).filter(o=>o.d>=0&&o.d*RES<7).sort((a,b)=>a.d-b.d).slice(0,3);
   if(near.length){const o=near[Math.floor(r()*near.length)];o.s.by=p;p.seat=o.s;p.sitTime=p.fl.L.who==='police'?between(8,30):between(15,50);p.path=g.path(p,g.idx(o.a.x,o.a.z));p.mode='go';return;}}
  const reach=g.cells.filter(k=>g.dist[k]>4/RES*.6);if(reach.length){const k=reach[Math.floor(r()*reach.length)];p.path=g.path(p,k);p.mode='walk';return;}
  p.mode='pause';p.timer=1+r()*2;}

 function step(p,dt,cam,others){
  if(p.bed&&p.lm){if(lieStep(p,dt,{speed:p.speed,walk:m=>moveCharacter(p.char,m?'walk':'idle',p.speed,dt),ground:()=>p.fl.y}))return;p.mode='pause';p.timer=1+r()*3;}
  if(p.seat&&p.sm){if(seatStep(p,dt,{speed:p.speed,walk:m=>moveCharacter(p.char,m?'walk':'idle',p.speed,dt),ground:()=>p.fl.y}))return;p.mode='pause';p.timer=1+r()*3;}
  let moving=false;
  // El personal: en su puesto, mirando a lo suyo y de vez en cuando hacia el salón.
  if(p.staff){p.timer-=dt;if(p.timer<=0){p.timer=3+r()*6;p.look=r()<.3?(r()-.5)*1.6:0;}let dy=p.yaw0+(p.look||0)-p.yaw;dy=Math.atan2(Math.sin(dy),Math.cos(dy));p.yaw+=dy*Math.min(1,dt*3);moveCharacter(p.char,'idle',1,dt);p.body.position.set(p.x,p.fl.y,p.z);p.body.rotation.y=p.yaw;return;}
  if(p.mode==='pause'){if((p.timer-=dt)<=0)decide(p);}
  else if(p.path.length){const t=p.path[0],dx=t.x-p.x,dz=t.z-p.z,d=Math.hypot(dx,dz);
   if(d<.12){p.path.shift();}
   else{const st=Math.min(d,p.speed*dt),nx=p.x+dx/d*st,nz=p.z+dz/d*st;
    // No atraviesa a nadie (gente sentada o caminando, ni al jugador): espera y, si sigue tapado, cambia de plan.
    const blocked=others.some(o=>o!==p&&(o.x-nx)**2+(o.z-nz)**2<.3&&(o.x-nx)**2+(o.z-nz)**2<(o.x-p.x)**2+(o.z-p.z)**2)||Math.abs(cam.y-1.7-p.fl.y)<1&&(cam.x-nx)**2+(cam.z-nz)**2<.4;
    if(blocked){if((p.stuck+=dt)>1.5){p.stuck=0;p.path=[];if(p.seat){p.seat.by=null;p.seat=null;}if(p.bed){p.bed.by=null;p.bed=null;}p.mode='pause';p.timer=.5+r();}}
    else{p.stuck=0;p.x=nx;p.z=nz;moving=true;let dy=Math.atan2(dx,dz)-p.yaw;dy=Math.atan2(Math.sin(dy),Math.cos(dy));p.yaw+=dy*Math.min(1,dt*8);}}}
  else if(p.mode==='go'&&p.seat){p.sm='final';}
  else if(p.mode==='goBed'&&p.bed){p.lm='final';}
  else{p.mode='pause';p.timer=1+r()*4;}
  moveCharacter(p.char,moving?'walk':'idle',p.speed,dt);p.body.position.set(p.x,p.fl.y,p.z);p.body.rotation.y=p.yaw;}

 function update(dt,cam){
  if((clock-=dt)<=0){clock=.5;
   // Los pisos de la cámara en los edificios cercanos, del más cercano al más lejano, hasta `max` personas.
   const cf=Math.floor(Math.max(0,cam.y-.5)/FLOOR),list=[];
   // Distancia al cuarto más cercano del edificio (no a su centro: la comisaría es grande).
   for(const L of world.lots.values()){if(cf>=L.floors||!L.cells.length)continue;const d=Math.min(...L.cells.map(c=>Math.hypot(Math.max(c[0]-cam.x,0,cam.x-c[2]),Math.max(c[1]-cam.z,0,cam.z-c[3]))));if(d<15)list.push([d,L]);}
   list.sort((a,b)=>a[0]-b[0]);for(const p of active)p.body.visible=false;active.length=0;
   for(const [,L] of list){const fl=floorOf(L,cf);for(const p of fl.people){if(active.length>=max)break;body(p);p.body.visible=true;active.push(p);}}}
  for(const p of active)step(p,dt,cam,active);}
 const blocks=(x,z,rad,feet=0)=>active.some(p=>Math.abs(p.fl.y-.06-feet)<1&&(p.x-x)**2+(p.z-z)**2<(rad+.28)**2);
 // (dónde está cada uno: para abrir las puertas de los cuartos al pasar)
 return {group,update,blocks,dispose(){},positions:()=>active.map(p=>({x:p.x,z:p.z,feet:p.fl.y})),get count(){return active.length;},get seated(){return active.filter(p=>p.sm==='sit').length;},get sleeping(){return active.filter(p=>p.lm==='sleep').length;},floors};
}
