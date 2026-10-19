/* Sentarse y levantarse, para cualquier personaje de /demo (gente de los edificios, de la calle y de la isla). Usa las
   animaciones SitDown y StandUp del paquete y mueve al personaje entre el punto de llegada (detrás de la silla, o
   delante de la banca) y el asiento mientras dura cada una.

   Un asiento: {x, y, z, yaw, lift, ap, by}. (x,z) es el centro de la silla; yaw, hacia dónde mira el que se sienta;
   lift, cuánto se sube el personaje (la pose de SitDown deja la cadera a ~0,28 m del piso); ap, dónde se para antes de
   sentarse, a lo largo de yaw (negativo = detrás de la silla); by, quién lo ocupa (o lo tiene reservado). */
import * as THREE from 'three';

// La pose sentada deja la cadera 0,21 m detrás del origen: se corre hacia adelante para que caiga sobre el asiento.
export const FWD=.16;
export const ease=k=>k*k*(3-2*k);
// Alto del asiento de una silla de alto total h (las del paquete andan por la mitad) → lift del personaje.
export const liftFor=h=>Math.min(.55,Math.max(.42,h*.52))-.21;

// Dónde va el personaje: k=0 sentado, k=1 parado en el punto de llegada.
export function seatPoint(s,k){const fx=Math.sin(s.yaw),fz=Math.cos(s.yaw),off=FWD+((s.ap??-.55)-FWD)*k;return {x:s.x+fx*off,y:s.y+(s.lift??.29)*(1-k),z:s.z+fz*off};}
export const approachOf=s=>seatPoint(s,1);

// c: un personaje de makeCharacter; t: su plantilla (con las animaciones).
export function makeSitter(c,t){
 const mk=n=>{const cl=THREE.AnimationClip.findByName(t.clips,n);if(!cl)return null;const a=c.mixer.clipAction(cl);a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;return a;};
 const down=mk('SitDown'),up=mk('StandUp');let cur=null,time=0,dur=1;
 const go=(a,fade)=>{const from=cur||c.acts[c.state];a.reset().play();if(from&&from!==a){if(fade)from.crossFadeTo(a,fade,false);else from.stop();}cur=a;};
 return {ok:!!(down&&up),
  // Ya sentado, sin animar la bajada.
  sitNow(){c.holder.userData.sentado=true;c.mixer.stopAllAction();down.reset().play();down.time=down.getClip().duration-.001;cur=down;c.mixer.update(0);},
  begin(kind){c.holder.userData.sentado=true;const a=kind==='down'?down:up;time=0;dur=a.getClip().duration;go(a,kind==='down'?.2:0);},
  // Avanza la animación; devuelve el avance (0–1).
  step(dt){time+=dt;c.mixer.update(dt);return Math.min(1,time/dur);},
  // (sentado frente a un computador: después de sentarse, a teclear —Typing, de persona3d.js—)
  // (en una mesa de un local de comida —meal—, a comer: Eat_Sitting)
  hold(dt,pc,meal){const job=pc?c.acts.trabajar:meal?c.acts.comer:null;if(job&&cur===down&&down.time>=down.getClip().duration-.01){job.reset().setLoop(THREE.LoopRepeat).play();down.crossFadeTo(job,.4,false);cur=job;}c.mixer.update(dt);},
  // De vuelta a caminar/quieto (moveCharacter sigue desde Idle).
  release(){c.holder.userData.sentado=false;if(cur&&(cur===c.acts.trabajar||cur===c.acts.comer)){c.mixer.stopAllAction();cur=null;}const idle=c.acts.idle;idle.reset().play();if(cur&&cur!==idle)cur.crossFadeTo(idle,.25,false);c.state='idle';cur=null;}};
}

/* Lo que hace alguien con un asiento reservado (p.seat), paso a paso: llega derecho al punto de llegada ('final'), se
   sienta ('down'), se queda (p.sitTime) y se levanta ('up'). Devuelve true mientras esté ocupado con eso; al terminar
   libera el asiento y deja p.seat en null. ground: alto del piso donde camina (para el tramo final). */
export function seatStep(p,dt,{speed,walk,ground}){
 const s=p.seat;if(!p.sitter)p.sitter=makeSitter(p.char,p.tpl);
 if(!p.sitter.ok){s.by=null;p.seat=null;p.sm=null;return false;}
 let pos=null;
 if(p.sm==='final'){const ap=approachOf(s),dx=ap.x-p.x,dz=ap.z-p.z,d=Math.hypot(dx,dz);
  if(d<.08){p.x=ap.x;p.z=ap.z;p.yaw=s.yaw;p.sitter.begin('down');p.sm='down';}
  else{const st=Math.min(d,speed*dt);p.x+=dx/d*st;p.z+=dz/d*st;let dy=Math.atan2(dx,dz)-p.yaw;dy=Math.atan2(Math.sin(dy),Math.cos(dy));p.yaw+=dy*Math.min(1,dt*8);walk(true);}
  pos={x:p.x,y:ground(p.x,p.z),z:p.z};}
 else if(p.sm==='down'){const k=p.sitter.step(dt);pos=seatPoint(s,1-ease(k));p.yaw=s.yaw;if(k>=1){p.sm='sit';p.timer=p.sitTime;}}
 else if(p.sm==='sit'){p.sitter.hold(dt,s.pc,s.meal);pos=seatPoint(s,0);if((p.timer-=dt)<=0){p.sitter.begin('up');p.sm='up';}}
 else if(p.sm==='up'){const k=p.sitter.step(dt);pos=seatPoint(s,ease(k));if(k>=1){p.sitter.release();s.by=null;p.seat=null;p.sm=null;p.x=pos.x;p.z=pos.z;p.body.position.set(pos.x,pos.y,pos.z);return false;}}
 p.x=pos.x;p.z=pos.z;p.body.position.set(pos.x,pos.y,pos.z);p.body.rotation.y=p.yaw;return true;
}

/* Dormir en una cama: {x, z, top, yaw, by}. (x,z) es el centro del colchón, top su alto y yaw hacia dónde quedan los
   pies (la cabeza va a la almohada). El paquete no trae una animación de acostarse: el personaje llega al costado
   (p.side), se tiende boca arriba de a poco (gira 90° sobre su eje) y respira (Idle) un rato (p.sleepTime); después se
   incorpora al revés. Devuelve true mientras esté en eso; al terminar libera la cama y deja p.bed en null. */
const LIE=.9;// segundos para tenderse o levantarse
export function bedPose(b){return {x:b.x+Math.sin(b.yaw)*.85,y:b.top+.12,z:b.z+Math.cos(b.yaw)*.85};}
export function lieStep(p,dt,{speed,walk,ground}){
 const b=p.bed,sd=p.side;p.body.rotation.order='YXZ';
 if(p.lm==='final'){const dx=sd.x-p.x,dz=sd.z-p.z,d=Math.hypot(dx,dz);
  if(d<.08){p.x=sd.x;p.z=sd.z;p.lm='lie';p.lt=0;p.standYaw=Math.atan2(b.x-sd.x,b.z-sd.z);}
  else{const st=Math.min(d,speed*dt);p.x+=dx/d*st;p.z+=dz/d*st;let dy=Math.atan2(dx,dz)-p.yaw;dy=Math.atan2(Math.sin(dy),Math.cos(dy));p.yaw+=dy*Math.min(1,dt*8);walk(true);}
  p.body.position.set(p.x,ground(p.x,p.z),p.z);p.body.rotation.set(0,p.yaw,0);return true;}
 walk(false);
 if(p.lm==='sleep'){if((p.timer-=dt)<=0){p.lm='rise';p.lt=0;}}
 else{p.lt+=dt/LIE;const k=ease(Math.min(1,p.lt)),kk=p.lm==='lie'?k:1-k,a=bedPose(b),gy=ground(sd.x,sd.z);
  let dy=b.yaw-p.standYaw;dy=Math.atan2(Math.sin(dy),Math.cos(dy));p.yaw=p.standYaw+dy*kk;
  p.body.position.set(sd.x+(a.x-sd.x)*kk,gy+(a.y-gy)*Math.min(1,kk*1.6),sd.z+(a.z-sd.z)*kk);p.body.rotation.set(-Math.PI/2*kk,p.yaw,0);
  if(p.lt>=1){if(p.lm==='lie'){p.lm='sleep';p.timer=p.sleepTime;}
   else{b.by=null;p.bed=null;p.lm=null;p.x=sd.x;p.z=sd.z;p.yaw=p.standYaw+Math.PI;p.body.rotation.set(0,p.yaw,0);return false;}}
  return true;}
 const a=bedPose(b);p.body.position.set(a.x,a.y,a.z);p.body.rotation.set(-Math.PI/2,b.yaw,0);return true;
}

/* Un camino a pie en una grilla de 25 cm alrededor de dos puntos, para tramos cortos entre muebles (adentro de una
   casa): walk(x,z) dice si se puede estar ahí. Devuelve los puntos (sólo las esquinas que hacen falta, terminando en
   `to`) o null si no se llega. */
// (R: el lado de la casilla; en las casas de la familia, 15 cm: los pasos de ~50 cm entre el sillón y la mesa de centro)
export function gridPath(walk,from,to,pad=3,R=.25){
 const x0=Math.min(from.x,to.x)-pad,z0=Math.min(from.z,to.z)-pad,nx=Math.ceil((Math.max(from.x,to.x)+pad-x0)/R),nz=Math.ceil((Math.max(from.z,to.z)+pad-z0)/R);
 const cell=(x,z)=>{const i=Math.floor((x-x0)/R),j=Math.floor((z-z0)/R);return i<0||j<0||i>=nx||j>=nz?-1:j*nx+i;},pos=k=>({x:x0+(k%nx+.5)*R,z:z0+(Math.floor(k/nx)+.5)*R});
 const okm=new Int8Array(nx*nz).fill(-1),ok=k=>{if(okm[k]<0){const q=pos(k);okm[k]=walk(q.x,q.z)?1:0;}return okm[k]===1;};
 const goal=cell(to.x,to.z);if(goal<0||!walk(to.x,to.z))return null;
 // Desde la casilla más cercana a `from` que esté libre.
 let start=cell(from.x,from.z);if(start<0)return null;if(!ok(start)){let best=-1,bd=1e9;for(let dj=-3;dj<=3;dj++)for(let di=-3;di<=3;di++){const k=start+dj*nx+di;if(k>=0&&k<nx*nz&&ok(k)&&di*di+dj*dj<bd){bd=di*di+dj*dj;best=k;}}if(best<0)return null;start=best;}
 const prev=new Int32Array(nx*nz).fill(-2);prev[start]=-1;const q=[start];
 for(let h=0;h<q.length&&prev[goal]===-2;h++){const c=q[h],i=c%nx,j=(c-i)/nx;
  for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){const a=i+di,b=j+dj;if(a<0||b<0||a>=nx||b>=nz)continue;const n=b*nx+a;if(prev[n]!==-2||!ok(n))continue;if(di&&dj&&(!ok(j*nx+a)||!ok(b*nx+i)))continue;prev[n]=c;q.push(n);}}
 if(prev[goal]===-2)return null;
 const raw=[];for(let c=goal;c!==-1;c=prev[c])raw.push(pos(c));raw.reverse();raw[raw.length-1]={x:to.x,z:to.z};
 const sees=(a,b)=>{const n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/(R*.4));for(let s=1;s<n;s++)if(!walk(a.x+(b.x-a.x)*s/n,a.z+(b.z-a.z)*s/n))return false;return true;};
 const out=[];let at=from;for(let i=0;i<raw.length;i++)if(i===raw.length-1||!sees(at,raw[i+1])){out.push(raw[i]);at=raw[i];}
 return out;
}
