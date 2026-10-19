/* Ciudadanos de /demo: gente que camina por la ciudad. Hacen lo mismo que los del motor (game.js, npcStep): van a un
   punto al azar o a un frente conocido (puertas de objetivos y de la comisaría, escondites), y al llegar se quedan
   1–4 s antes de elegir otro. En 3D, además, caminan por la vereda, cruzan por las cebras y se apartan de la gente.
   La cantidad la pone la regla del prototipo: «crowd» ciudadanos por jugador. */
import * as THREE from 'three';
import {makeCharacter,moveCharacter} from './characters3d.js';
import {seatStep,approachOf,lieStep,gridPath} from './sitting3d.js';

const DIRS8=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
const SHIRTS=['#c2412d','#3d6f8f','#e0b23c','#4f7d5a','#7b4e7e','#e9e2d3','#2f3437','#d6a88c','#6f9bc4','#a96553','#8fae7f','#f0c7b5'];
const PANTS=['#2b3a55','#3a3f43','#5b4a3a','#1f2326','#6b6e70','#8a7a5c','#34465e'];
const SKIN=['#f1c9a5','#e0ac83','#c68a62','#a8714c','#7d5236','#5e3d27'];
const HAIR=['#1f1a17','#3b2a20','#5a3d2a','#8a6b4a','#c9c2b8','#2a2522'];

// Una persona. Con los personajes animados cargados (templates), uno de ellos al azar; si no, la figura simple de
// cajas, con piernas y brazos que cuelgan de la cadera y del hombro. La usan los ciudadanos y la gente de la isla.
function personKit(group,owned,r,templates=[]){
 const mats=new Map(),mat=c=>{if(!mats.has(c)){const m=new THREE.MeshStandardMaterial({color:c,roughness:.85});mats.set(c,m);owned.push(m);}return mats.get(c);};
 const geo=g=>{owned.push(g);return g;};
 const G={leg:geo(new THREE.BoxGeometry(.15,.82,.17).translate(0,-.41,0)),shoe:geo(new THREE.BoxGeometry(.16,.09,.26).translate(0,-.82,.04)),
  torso:geo(new THREE.CapsuleGeometry(.19,.34,4,10).scale(1,1,.66)),arm:geo(new THREE.BoxGeometry(.1,.58,.12).translate(0,-.29,0)),
  head:geo(new THREE.SphereGeometry(.13,14,10)),hair:geo(new THREE.SphereGeometry(.14,14,8,0,Math.PI*2,0,Math.PI*.55)),cap:geo(new THREE.CylinderGeometry(.15,.15,.08,14))};
 const part=(g,m,x,y,z)=>{const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.castShadow=true;return o;};
 return function person(){
  if(templates.length){const t=templates[Math.floor(r()*templates.length)],c=makeCharacter(t,r);group.add(c.holder);return {body:c.holder,char:c,tpl:t};}
  const shirt=mat(SHIRTS[Math.floor(r()*SHIRTS.length)]),pants=mat(PANTS[Math.floor(r()*PANTS.length)]),skin=mat(SKIN[Math.floor(r()*SKIN.length)]),dark=mat('#26292b');
  const body=new THREE.Group(),legs=[],arms=[];
  for(const s of [-1,1]){const l=new THREE.Group();l.position.set(s*.09,.9,0);l.add(part(G.leg,pants,0,0,0),part(G.shoe,dark,0,0,0));body.add(l);legs.push(l);
   const a=new THREE.Group();a.position.set(s*.25,1.42,0);a.add(part(G.arm,shirt,0,0,0));a.rotation.z=s*.06;body.add(a);arms.push(a);}
  body.add(part(G.torso,shirt,0,1.19,0),part(G.head,skin,0,1.66,0));
  if(r()<.2)body.add(part(G.cap,mat(SHIRTS[Math.floor(r()*SHIRTS.length)]),0,1.76,0));
  else body.add(part(G.hair,mat(HAIR[Math.floor(r()*HAIR.length)]),0,1.68,-.01));
  r();group.add(body);return {body,legs,arms};// (todos del mismo alto —vestuario.js CUERPO_UNICO—; el número del alto se sigue sacando)
 };
}
// Balancear piernas y brazos según lo caminado; quieto, vuelven a su lugar.
function animate(p,moving,dt){
 if(p.char){moveCharacter(p.char,moving?(p.panic>0?'run':'walk'):'idle',p.speed*(p.panic>0?2.4:1),dt);return;}
 p.phase+=moving?p.speed*dt*4.2:0;const swing=moving?Math.sin(p.phase):0,k=moving?1:Math.max(0,1-dt*6);
 p.legs[0].rotation.x=swing*.55*k;p.legs[1].rotation.x=-swing*.55*k;p.arms[0].rotation.x=-swing*.45*k;p.arms[1].rotation.x=swing*.45*k;
}

function rng(seed){let n=seed>>>0;return()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}

// home: puntos a los que vuelven seguido (homeBias) y donde nacen algunos (startHome): los policías salen de la comisaría a
// patrullar y vuelven. speed: [mín, máx] en m/s.
// seats: las bancas (world.benchSeats); de vez en cuando alguien va a una libre cerca, se sienta un rato y sigue.
export function createCitizens(world,{count,seed=1,templates=[],home=null,homeBias=0,startHome=0,speed=[1.2,1.65],seats=[]}){
 const r=rng(seed*7919+count),{W,H,size,cells}=world.ped,group=new THREE.Group(),owned=[];
 const walkable=(sx,sy)=>sx>=0&&sy>=0&&sx<W&&sy<H&&cells[sy*W+sx]===1;
 const toSub=v=>Math.floor(v/size);

 // La red de peatones más grande: ahí nacen y a ahí van (alguna plaza encerrada no sirve).
 const comp=new Int32Array(W*H).fill(-1);let best=-1,bestSize=0;
 for(let i=0,id=0;i<W*H;i++){if(cells[i]!==1||comp[i]>=0)continue;const q=[i];comp[i]=id;
  for(let h=0;h<q.length;h++){const k=q[h],x=k%W,y=(k-x)/W;for(const [dx,dy] of DIRS8.slice(0,4)){const nx=x+dx,ny=y+dy;if(walkable(nx,ny)&&comp[ny*W+nx]<0){comp[ny*W+nx]=id;q.push(ny*W+nx);}}}
  if(q.length>bestSize){bestSize=q.length;best=id;}id++;}
 const spots=[];for(let i=0;i<W*H;i++)if(comp[i]===best)spots.push(i);
 const near=(p)=>{const sx=toSub(p.x),sy=toSub(p.z);let pick=-1,d=1e9;for(let y=sy-6;y<=sy+6;y++)for(let x=sx-6;x<=sx+6;x++){if(!walkable(x,y)||comp[y*W+x]!==best)continue;const e=(x-sx)**2+(y-sy)**2;if(e<d){d=e;pick=y*W+x;}}return pick;};
 const fronts=world.fronts.map(near).filter(i=>i>=0);
 const homes=(home||[]).map(near).filter(i=>i>=0);
 const target=()=>homes.length&&r()<homeBias?homes[Math.floor(r()*homes.length)]:r()<.3&&fronts.length?fronts[Math.floor(r()*fronts.length)]:spots[Math.floor(r()*spots.length)];

 // Camino en la grilla de cuartos de casilla, con diagonales sólo si no cortan una esquina.
 const dist=new Int32Array(W*H);
 function route(from,to){
  dist.fill(-1);const q=[to];dist[to]=0;
  for(let h=0;h<q.length&&dist[from]<0;h++){const k=q[h],x=k%W,y=(k-x)/W;
   for(const [dx,dy] of DIRS8){const nx=x+dx,ny=y+dy;if(!walkable(nx,ny)||dist[ny*W+nx]>=0)continue;if(dx&&dy&&(!walkable(x+dx,y)||!walkable(x,y+dy)))continue;dist[ny*W+nx]=dist[k]+1;q.push(ny*W+nx);}}
  if(dist[from]<0)return [];
  const out=[];let k=from,guard=W*H;
  while(k!==to&&guard--){const x=k%W,y=(k-x)/W;let next=-1;
   for(const [dx,dy] of DIRS8){const nx=x+dx,ny=y+dy;if(!walkable(nx,ny))continue;if(dx&&dy&&(!walkable(x+dx,y)||!walkable(x,y+dy)))continue;const nk=ny*W+nx;if(dist[nk]>=0&&dist[nk]<dist[k]){next=nk;break;}}
   if(next<0)break;k=next;out.push(k);}
  return out;
 }

 const person=personKit(group,owned,r,templates);
 for(const b of seats)b.y=world.groundAt(b.x,b.z);

 const people=[];
 for(let i=0;i<count;i++){
  const at=homes.length&&r()<startHome?homes[Math.floor(r()*homes.length)]:spots[Math.floor(r()*spots.length)],x=at%W,y=(at-x)/W;
  people.push({...person(),x:(x+.5)*size,z:(y+.5)*size,yaw:r()*Math.PI*2,speed:speed[0]+r()*(speed[1]-speed[0]),path:[],pause:r()*3,phase:r()*6,
   ox:(r()-.5)*.45,oz:(r()-.5)*.45,stuck:0});
 }

 // Por dónde se camina; para esquivar a alguien vale bajarse a la calzada (cualquier piso libre).
 const free=(x,z,player,detour=false)=>(detour?!world.collide(x,z,.22):walkable(toSub(x),toSub(z)))&&!(player&&(x-player.x)**2+(z-player.z)**2<.62**2);
 function update(dt,player){
  for(const p of people){
   if(p.seat&&p.sm&&seatStep(p,dt,{speed:p.speed,walk:m=>animate(p,m,dt),ground:world.groundAt}))continue;
   let moving=false;
   if(p.panic>0)p.panic-=dt;
   if(p.pause>0)p.pause-=dt;
   else{
    if(!p.path.length){const from=toSub(p.z)*W+toSub(p.x);const start=walkable(toSub(p.x),toSub(p.z))?from:near(p);
     // A veces, una banca libre a menos de 25 m: se camina hasta la vereda junto a ella.
     if(!p.seat&&p.char&&seats.length&&r()<.2){const s=seats.filter(b=>!b.by&&(b.x-p.x)**2+(b.z-p.z)**2<625).sort((a,b)=>(a.x-p.x)**2+(a.z-p.z)**2-(b.x-p.x)**2-(b.z-p.z)**2)[0];
      if(s){s.by=p;p.seat=s;p.sitTime=12+r()*35;}}
     // (asustado: el más lejano de seis destinos al azar, lejos de donde sonó el tiro)
     const goal=p.seat?near(approachOf(p.seat)):p.panic>0?[0,1,2,3,4,5].map(()=>target()).reduce((a,b)=>{const da=((a%W+.5)*size-p.fx)**2+((Math.floor(a/W)+.5)*size-p.fz)**2,db=((b%W+.5)*size-p.fx)**2+((Math.floor(b/W)+.5)*size-p.fz)**2;return db>da?b:a;}):target();
     p.path=start>=0&&goal>=0?route(start,goal):[];if(!p.path.length){p.pause=1;if(p.seat){p.seat.by=null;p.seat=null;}}}
    if(p.path.length){
     const k=p.path[0],tx=(k%W+.5)*size+p.ox,tz=(Math.floor(k/W)+.5)*size+p.oz,dx=tx-p.x,dz=tz-p.z,d=Math.hypot(dx,dz);
     // Un punto del camino que ocupa el jugador no hace falta tocarlo: se rodea y se sigue al siguiente.
     const taken=player&&p.path.length>1&&(tx-player.x)**2+(tz-player.z)**2<.9**2;
     if(d<.35||taken){p.path.shift();if(!p.path.length){if(p.seat)p.sm='final';else p.pause=1+Math.random()*3;}}
     else{
      const step=Math.min(d,p.speed*(p.panic>0?2.4:1)*dt);let ux=dx/d,uz=dz/d;
      // Si el jugador le cierra el paso, prueba a rodearlo; si no puede, espera.
      let ok=free(p.x+ux*step,p.z+uz*step,player,!walkable(toSub(p.x),toSub(p.z)));
      for(const turn of [.9,-.9,1.6,-1.6]){if(ok)break;const c=Math.cos(turn),s=Math.sin(turn),vx=ux*c-uz*s,vz=ux*s+uz*c;if(free(p.x+vx*step,p.z+vz*step,player,true)){ux=vx;uz=vz;ok=true;}}
      if(ok){p.x+=ux*step;p.z+=uz*step;moving=true;p.stuck=0;const want=Math.atan2(ux,uz);let dy=want-p.yaw;dy=Math.atan2(Math.sin(dy),Math.cos(dy));p.yaw+=dy*Math.min(1,dt*8);}
      else if((p.stuck+=dt)>2.5){p.path=[];p.stuck=0;}
     }
    }
   }
   animate(p,moving,dt);
   p.body.position.set(p.x,world.groundAt(p.x,p.z)+(moving&&!p.char?Math.abs(Math.cos(p.phase))*.03:0),p.z);p.body.rotation.y=p.yaw;
  }
  // Nadie atraviesa a nadie: los que se pisan se separan un poco, sin salirse de donde se camina.
  for(let i=0;i<people.length;i++)for(let j=i+1;j<people.length;j++){
   const a=people[i],b=people[j],dx=b.x-a.x,dz=b.z-a.z,d2=dx*dx+dz*dz;if(d2>.36||d2<1e-6||a.sm||b.sm)continue;
   const d=Math.sqrt(d2),push=(.6-d)/2,ux=dx/d*push,uz=dz/d*push;
   if(free(a.x-ux,a.z-uz))a.x-=ux,a.z-=uz;if(free(b.x+ux,b.z+uz))b.x+=ux,b.z+=uz;
  }
 }
 // El jugador tampoco los atraviesa.
 const blocks=(x,z,rad)=>people.some(p=>(p.x-x)**2+(p.z-z)**2<(rad+.25)**2);
 const positions=()=>people.map(p=>({x:p.x,z:p.z}));
 function dispose(){for(const o of owned)o.dispose();}
 // Un tiro: los que están a menos de rad (y no sentados) salen corriendo lejos de (x, z) unos segundos.
 function scare(x,z,rad=18){for(const p of people){if(p.sm||(p.x-x)**2+(p.z-z)**2>rad*rad)continue;p.panic=4+Math.random()*4;p.fx=x;p.fz=z;p.pause=0;p.path=[];if(p.seat){p.seat.by=null;p.seat=null;}}}
 return {group,update,blocks,positions,dispose,count,people,scare};
}

/* La gente de la isla: camina por la playa, sube a la montaña, se para a mirar, y entra y sale de las casas (llega a la
   puerta, entra, se queda un rato adentro y vuelve a salir). Rodea las casas y no se mete al agua honda (island.walkable).
   Así un ladrón en la playa o en la montaña no se delata por estar ahí. */
export function createIslandFolk(world,island,{count,seed=1,templates=[]}){
 const r=rng(seed*131+5),group=new THREE.Group(),owned=[],person=personKit(group,owned,r,templates),folk=[];
 // Nadie sube ni baja de golpe más de SALTO m (un cordón sí; un muro de contención no): para eso están las rampas.
 const SALTO=.35,salto=(ax,az,bx,bz)=>Math.abs(island.ground(bx,bz)-island.ground(ax,az))>SALTO;
 // El camino hasta un destino: A* en una grilla de 2 m alrededor de los dos puntos; un paso entre dos casillas vale si
 // se camina todo el tramo sin saltos (muestras cada 0,3 m). Después se acorta: de cada punto, al más lejano que se ve
 // sin saltos. Así para llegar al escalón de arriba se da la vuelta por la rampa.
 // island.bloqueo (opcional, lo pone el demo): lo que la isla no sabe que estorba, como los edificios de los barrios.
 const pisable=(x,z)=>island.walkable(x,z)&&island.ground(x,z)>-.3&&!island.bloqueo?.(x,z);
 const tramoOk=(a,b)=>{const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.3));let px=a.x,pz=a.z;for(let k=1;k<=n;k++){const x=a.x+(b.x-a.x)*k/n,z=a.z+(b.z-a.z)*k/n;if(!pisable(x,z)||salto(px,pz,x,z))return false;px=x;pz=z;}return true;};
 // island.portal (opcional, lo pone el demo): si el destino está del otro lado de una cerca con paso (los lotes de las
 // casas armadas), los puntos de afuera y de adentro del paso; el camino se arma tramo a tramo pasando por ellos.
 function ruta(from,to){const via=island.portal?.(from,to);if(!via?.length)return rutaGrid(from,to);
  const out=[];let cur=from;for(const w of [...via,to]){const leg=rutaGrid(cur,w);if(!leg)return null;out.push(...leg);cur=w;}return out;}
 function rutaGrid(from,to){
  if(tramoOk(from,to))return [{x:to.x,z:to.z}];
  const R=2,pad=30,x0=Math.min(from.x,to.x)-pad,z0=Math.min(from.z,to.z)-pad,nx=Math.ceil((Math.max(from.x,to.x)+pad-x0)/R),nz=Math.ceil((Math.max(from.z,to.z)+pad-z0)/R);
  if(nx*nz>40000)return null;
  const pos=k=>({x:x0+(k%nx+.5)*R,z:z0+(Math.floor(k/nx)+.5)*R}),cel=(x,z)=>{const i=Math.floor((x-x0)/R),j=Math.floor((z-z0)/R);return i<0||j<0||i>=nx||j>=nz?-1:j*nx+i;};
  const start=cel(from.x,from.z),goal=cel(to.x,to.z);if(start<0||goal<0)return null;
  const g=new Float32Array(nx*nz).fill(Infinity),prev=new Int32Array(nx*nz).fill(-1),done=new Uint8Array(nx*nz);g[start]=0;
  const h=k=>{const q=pos(k);return Math.hypot(q.x-to.x,q.z-to.z);};
  // La lista abierta, un montículo binario por g+h.
  const H=[],F=[],push=(k,f)=>{H.push(k);F.push(f);let i=H.length-1;while(i){const u=(i-1)>>1;if(F[u]<=F[i])break;[H[u],H[i]]=[H[i],H[u]];[F[u],F[i]]=[F[i],F[u]];i=u;}};
  const pop=()=>{const top=H[0],lk=H.pop(),lf=F.pop();if(H.length){H[0]=lk;F[0]=lf;let i=0;for(;;){const a=2*i+1,b=a+1;let m=i;if(a<H.length&&F[a]<F[m])m=a;if(b<H.length&&F[b]<F[m])m=b;if(m===i)break;[H[m],H[i]]=[H[i],H[m]];[F[m],F[i]]=[F[i],F[m]];i=m;}}return top;};
  push(start,h(start));const open={get length(){return H.length;}};
  while(open.length){const c=pop();
   if(done[c])continue;done[c]=1;if(c===goal)break;const ci=c%nx,cj=(c-ci)/nx,cp=pos(c);
   for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){const a=ci+di,b=cj+dj;if(a<0||b<0||a>=nx||b>=nz)continue;const n=b*nx+a;if(done[n])continue;
    const np=pos(n),cost=g[c]+Math.hypot(di,dj)*R;if(cost>=g[n]||!tramoOk(c===start?from:cp,np))continue;g[n]=cost;prev[n]=c;push(n,cost+h(n));}}
  if(!done[goal])return null;
  const raw=[];for(let c=goal;c!==start&&c>=0;c=prev[c])raw.push(pos(c));raw.reverse();raw.push({x:to.x,z:to.z});
  const out=[];let cur=from;for(let i=0;i<raw.length;){let j=raw.length-1;while(j>i&&!tramoOk(cur,raw[j]))j--;out.push(raw[j]);cur=raw[j];i=j+1;}
  return out;}
 const plan=p=>{
  const roll=r(),houses=island.houses;
  // Destinos cerca: una de las cuatro casas más cercanas, o un punto de playa, monte o pradera a menos de 140 m.
  if(roll<.4&&houses.length){const near=[...houses].sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z)).slice(0,4).filter(h=>Math.hypot(h.x-p.x,h.z-p.z)<180);
   if(near.length){const h=near[Math.floor(r()*near.length)],w=island.doorPath(h);p.route=[w.outside,w.door,w.inside,{wait:5+r()*9,house:h,back:w.inside},w.door,w.outside];return;}}
  // A veces (20 %), visitar el jardín de una casa armada cercana (island.jardin, lo pone el demo): entra por el paso de
  // la cerca y se queda un rato.
  // Otras veces (15 %), entrar a una casa armada a sentarse en el sofá (island.sofa, lo pone el demo): llega a la puerta
  // por el paso de la cerca, entra, va hasta el sofá por entre los muebles, se sienta un rato y sale por donde entró.
  // Adentro camina con v.walk (el piso de la casa y sus muebles), no con lo de la isla, que ahí ve una pared.
  // (o, con island.visita, a acostarse un rato en una cama: si es la de arriba, sube la escalera)
  if(roll>=.6&&roll<.75&&(island.visita||island.sofa)&&p.char){const v=(island.visita||island.sofa)(r,p),c=v&&ruta(p,v.outside);
   if(c){const w=v.entra||v.walk;p.route=[...c,{x:v.outside.x,z:v.outside.z,tight:true,casa:w},{x:v.door.x,z:v.door.z,tight:true,casa:w},{x:v.inside.x,z:v.inside.z,tight:true,casa:w},{visita:v,wait:8+r()*14},
    {x:v.door.x,z:v.door.z,tight:true,casa:w},{x:v.outside.x,z:v.outside.z,tight:true,casa:w}];return;}}
  if(roll>=.4&&roll<.6&&island.jardin){const j=island.jardin(r,p),c=j&&ruta(p,j);if(c){p.route=[...c,{wait:4+r()*8}];return;}}
  const s=island.spot(roll<.68?'playa':roll<.88?'monte':'prado',r,p)||island.spot('prado',r,p);const camino=s&&ruta(p,s);
  p.route=camino?[...camino,{wait:2+r()*6}]:[{wait:2+r()*3}];
 };
 for(let i=0;i<count;i++){const k=r(),s=island.spot(k<.45?'playa':k<.75?'prado':'monte',r);if(!s)continue;
  folk.push({...person(),x:s.x,z:s.z,yaw:r()*Math.PI*2,speed:1.1+r()*.45,route:[],pause:r()*3,phase:r()*6,stuck:0});}
 // Qué hacer adentro de la casa h: una cama libre (35 %) o una silla libre, con el camino desde donde está.
 const inHouse=(x,z)=>island.walkable(x,z);
 function houseVisit(p,h){
  if(r()<.35)for(const b of island.sleeps.filter(b=>b.house===h&&!b.by))for(const side of b.sides){const path=gridPath(inHouse,p,side);if(path)return {bed:b,side,path};}
  for(const s of island.seats.filter(s=>s.house===h&&!s.by).sort(()=>r()-.5)){const path=gridPath(inHouse,p,approachOf(s));if(path)return {seat:s,path};}
  return null;}
 // El piso donde se para: el de adentro de una casa armada (island.sueloCasa) o el terreno.
 // (feet: dónde tiene los pies, para no confundir la planta baja con la de arriba)
 const suelo=(x,z,feet)=>island.sueloCasa?.(x,z,feet)??island.ground(x,z);
 const others=(x,z,player,self)=>!(player&&(x-player.x)**2+(z-player.z)**2<.62**2)&&!folk.some(o=>o!==self&&(o.x-x)**2+(o.z-z)**2<.36);
 const free=(x,z,player,self)=>island.walkable(x,z)&&island.ground(x,z)>-.3&&!island.bloqueo?.(x,z)&&!(player&&(x-player.x)**2+(z-player.z)**2<.62**2)&&!folk.some(o=>o!==self&&(o.x-x)**2+(o.z-z)**2<.36);
 function update(dt,player){
  for(const p of folk){
   const gr=(x,z)=>suelo(x,z,p.feet);
   if(p.seat&&p.sm&&seatStep(p,dt,{speed:p.speed,walk:m=>animate(p,m,dt),ground:gr}))continue;
   if(p.bed&&p.lm&&lieStep(p,dt,{speed:p.speed,walk:m=>animate(p,m,dt),ground:gr}))continue;
   let moving=false;
   if(p.pause>0)p.pause-=dt;
   else{
    if(!p.route.length)plan(p);
    const t=p.route[0];
    // Adentro de una casa, el rato que iba a quedarse: a veces se acuesta en la cama y, si no, se sienta en una silla
    // libre (la mesa, el escritorio). Va y vuelve por un camino entre los muebles (sin rozar la mesa).
    // Ya adentro, junto a la puerta: el camino hasta el sofá (si el asiento sigue libre), sentarse y volver.
    if(t.visita){const v=t.visita,g=v.plan(p);p.route.shift();
     if(g){g.take(p);const pts=g.pts.map(q=>({x:q.x,z:q.z,tight:true,casa:q.casa}));
      // (de vuelta, cada tramo se camina con lo de su punto de llegada: el de antes en la ida)
      const back=pts.slice(0,-1).reverse().map((q,i,a)=>({...q,casa:pts[pts.length-1-i]?.casa||q.casa}));
      p.route.unshift(...pts,{act:g.act,wait:t.wait},...back,{x:v.inside.x,z:v.inside.z,tight:true,casa:v.walk});}
     continue;}
    const visit=t.house&&p.char?houseVisit(p,t.house):null;
    if(visit){if(visit.bed){visit.bed.by=p;}else visit.seat.by=p;p.route.shift();const pts=visit.path.map(q=>({x:q.x,z:q.z,tight:true}));
     p.route.unshift(...pts,{act:visit,wait:t.wait},...pts.slice(0,-1).reverse(),{x:t.back.x,z:t.back.z,tight:true});}
    else if(t.act){const a=t.act;if(a.bed){p.bed=a.bed;p.side=a.side;p.sleepTime=t.wait*2;p.lm='final';}else{p.seat=a.seat;p.sitTime=t.wait;p.sm='final';}p.route.shift();}
    else if(t.wait!=null){p.pause=t.wait;p.route.shift();}
    else{const dx=t.x-p.x,dz=t.z-p.z,d=Math.hypot(dx,dz);
     if(d<(t.tight?.12:.4)){p.route.shift();p.stuck=0;}
     else{
      // Cuesta arriba se camina más lento.
      const ahead=island.ground(p.x+dx/d,p.z+dz/d)-island.ground(p.x,p.z),step=Math.min(d,p.speed*dt*(t.casa?.7:ahead>.3?.6:1));let ux=dx/d,uz=dz/d;
      // (en la casa, por su piso y entre sus muebles; afuera, por la isla)
      const can=(x,z)=>t.casa?(t.casa(x,z)||Math.hypot(x-t.x,z-t.z)<.3)&&others(x,z,player,p):free(x,z,player,p)&&!salto(p.x,p.z,x,z);
      let ok=can(p.x+ux*step,p.z+uz*step);
      for(const turn of [.6,-.6,1.2,-1.2,1.9,-1.9]){if(ok)break;const c=Math.cos(turn),s=Math.sin(turn),vx=ux*c-uz*s,vz=ux*s+uz*c;if(can(p.x+vx*step,p.z+vz*step)){ux=vx;uz=vz;ok=true;}}
      if(ok){p.x+=ux*step;p.z+=uz*step;moving=true;p.stuck=0;let dy=Math.atan2(ux,uz)-p.yaw;dy=Math.atan2(Math.sin(dy),Math.cos(dy));p.yaw+=dy*Math.min(1,dt*8);}
      // Trabado: afuera, a otra cosa; en la casa, derecho al punto (los tramos de adentro son cortos y ya probados).
      else if((p.stuck+=dt)>4){if(t.casa){p.x=t.x;p.z=t.z;p.route.shift();}else p.route=[];p.stuck=0;}
     }
    }
   }
   animate(p,moving,dt);
   p.feet=suelo(p.x,p.z,p.feet);
   p.body.position.set(p.x,p.feet+(moving&&!p.char?Math.abs(Math.cos(p.phase))*.03:0),p.z);p.body.rotation.y=p.yaw;
  }
 }
 const blocks=(x,z,rad)=>folk.some(p=>(p.x-x)**2+(p.z-z)**2<(rad+.25)**2);
 const positions=()=>folk.map(p=>({x:p.x,z:p.z}));
 function dispose(){for(const o of owned)o.dispose();}
 return {group,update,blocks,positions,dispose,count:folk.length,people:folk,ruta};
}
