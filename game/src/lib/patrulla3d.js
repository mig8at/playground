/* Las patrullas (2026-10-17, REGLAS.md paso 4): los autos de la policía, estacionados en la calle frente a la comisaría
   (PATRULLA.cuantas según el equipo). Sólo la policía se sube (E); se manejan con W/S (acelerar, frenar y reversa) y
   A/D (girar), como un auto: el giro de las ruedas da la vuelta según la distancia entre ejes, y a más velocidad gira
   menos. Choca con lo que choca el jugador (paredes, árboles, postes, escalones altos) en cinco puntos de su largo, y
   frena sola ante la gente. Al bajarse (E), queda estacionada donde se dejó.
   createPatrullas({scene, plan, models, equipo, suelo, bloquea, gente}) → {cars, cerca(x, z), subir(i), bajar(),
   manejar(dt, adelante, giro), manejando, posiciones(), dispose}
   · suelo(x, z, y): la altura del piso; bloquea(x, z, y): ¿choca ahí?; gente(): [{x, z}] a no atropellar. */
import * as THREE from 'three';
import {buildVehicle} from './traffic3d.js';
import {PATRULLA as PA} from '../engine/medidas.js';
import {entradasLote} from '../engine/guaridas.js';
import {rng} from '../engine/veredas.js';

export function createPatrullas({scene,plan,models,equipo=3,suelo,bloquea,gente=()=>[]}){
 const group=new THREE.Group();group.name='patrullas';scene.add(group);const r=rng(plan.seed*13+5),cars=[];let cur=null;
 // dónde chocaría el auto: el centro y cuatro puntos más a lo largo (no se mete en nada)
 const choca=(c,x,z,yaw,y)=>{const fx=Math.sin(yaw),fz=Math.cos(yaw),m=c.len/2-PA.radio*.7;for(const k of [-1,-.5,0,.5,1]){const px=x+fx*m*k,pz=z+fz*m*k;if(bloquea(px,pz,y))return true;const g=suelo(px,pz,y+.3);if(g>y+.45)return true;}return false;};
 // los lugares frente a la comisaría: desde cada puerta, hacia la calle (afuera de la vereda), alineados con la calle
 const est=plan.lots.find(L=>L.type==='comisaria');
 if(est){const cx=est.rect.x+est.rect.w/2,cz=est.rect.y+est.rect.h/2,lugares=[];
  for(const [px,pz] of entradasLote(est)){const dx=px-cx,dz=pz-cz,ax=Math.abs(dx)/est.rect.w>Math.abs(dz)/est.rect.h,nx=ax?Math.sign(dx):0,nz=ax?0:Math.sign(dz);
   for(const k of [0,-1,1,-2,2,-3,3])lugares.push({x:px+nx*5+(ax?0:k*PA.separa),z:pz+nz*5+(ax?k*PA.separa:0),yaw:ax?0:Math.PI/2});}
  for(const q of lugares){if(cars.length>=PA.cuantas(equipo))break;if(cars.some(c=>Math.hypot(c.x-q.x,c.z-q.z)<PA.separa-.5))continue;
   const v=buildVehicle('cop',r,models),c={...v,x:q.x,z:q.z,yaw:q.yaw,v:0,giro:0,y:0};c.y=suelo(q.x,q.z,0);if(choca(c,q.x,q.z,q.yaw,c.y)){continue;}
   c.group.position.set(c.x,c.y,c.z);c.group.rotation.y=c.yaw;group.add(c.group);cars.push(c);}}
 function cerca(x,z){let best=-1,bd=PA.subir;cars.forEach((c,i)=>{if(c===cur)return;const d=Math.hypot(c.x-x,c.z-z);if(d<bd){bd=d;best=i;}});return best<0?null:best;}
 function subir(i){cur=cars[i]||null;if(cur){cur.v=0;cur.giro=0;}return cur;}
 // bajarse: al lado de la puerta del conductor (la izquierda), si ahí no se choca; si no, del otro lado o por detrás
 function bajar(){const c=cur;if(!c)return null;cur=null;c.v=0;const fx=Math.sin(c.yaw),fz=Math.cos(c.yaw);
  for(const [a,b] of [[1,0],[-1,0],[0,-1]]){const lx=fz*a,lz=-fx*a,x=c.x+lx*(c.wid/2+.6)-fx*b*(c.len/2+.6),z=c.z+lz*(c.wid/2+.6)-fz*b*(c.len/2+.6);if(!bloquea(x,z,c.y))return {x,z,y:suelo(x,z,c.y+.3)};}
  return {x:c.x,z:c.z,y:c.y};}
 // manejar: adelante (-1..1) acelera o frena; giro (-1..1) dobla las ruedas
 function manejar(dt,adelante,giro){const c=cur;if(!c)return null;
  if(adelante>0)c.v=c.v<0?Math.min(0,c.v+PA.freno*dt):Math.min(PA.vmax,c.v+PA.acel*dt);
  else if(adelante<0)c.v=c.v>0?Math.max(0,c.v-PA.freno*dt):Math.max(-PA.reversa,c.v-PA.acel*.6*dt);
  else c.v=Math.sign(c.v)*Math.max(0,Math.abs(c.v)-PA.roce*dt);
  const meta=-giro*PA.giro*(1-Math.min(.6,Math.abs(c.v)/PA.vmax*.6));c.giro+=(meta-c.giro)*Math.min(1,dt*6);
  // (la gente adelante: frena sola)
  const fx=Math.sin(c.yaw),fz=Math.cos(c.yaw),s=Math.sign(c.v)||1;
  for(const p of gente()){const dx=p.x-c.x,dz=p.z-c.z,along=(dx*fx+dz*fz)*s,lat=Math.abs(dx*fz-dz*fx);if(along>0&&along<c.len/2+PA.gente&&lat<c.wid/2+.4){c.v=Math.sign(c.v)*Math.max(0,Math.abs(c.v)-PA.freno*2*dt);break;}}
  const yaw=c.yaw+c.v/PA.ejes*Math.tan(c.giro)*dt,x=c.x+Math.sin(yaw)*c.v*dt,z=c.z+Math.cos(yaw)*c.v*dt;
  if(Math.abs(c.v)>1e-3){if(choca(c,x,z,yaw,c.y)){c.v*=-.2;c.choco=(c.choco||0)+1;}else{c.x=x;c.z=z;c.yaw=yaw;c.y=suelo(x,z,c.y+.35);}}
  c.group.position.set(c.x,c.y,c.z);c.group.rotation.y=c.yaw;return c;}
 const posiciones=()=>cars.map(c=>({x:c.x,z:c.z,yaw:c.yaw,len:c.len,wid:c.wid,manejada:c===cur}));
 function dispose(){scene.remove(group);}
 return {cars,cerca,subir,bajar,manejar,posiciones,dispose,get manejando(){return cur;}};}
