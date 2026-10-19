/* Las acciones del jugador (2026-10-16, Miguel: «abrir una cortina, sentarse en una silla, acostarse en una cama al
   acercarse»). Lo que se puede hacer y desde dónde lo dice el 2D (engine/usos.js usosDePiso, que validar-usos prueba: se
   llega caminando y cabe); acá sólo se anima. cerca(): el uso más cercano del piso del jugador (a ALCANCE de alguno de
   sus puntos para hacerlo) y su texto; empezar(): lo arranca; update(dt, quiereMoverse): mientras dure, mueve el muñeco
   y devuelve true (el jugador no camina); otra E o caminar lo termina (levantarse). */
import * as THREE from 'three';
import {usosDePiso,miradoresDePiso,miradoresDeCasa,USOS} from '../engine/usos.js';
import {cuartoDeVentana} from '../engine/cortinas.js';
import {usosRonda} from '../engine/juego/ronda.js';
import {CHOQUE_MUEBLE,CORTINA} from '../engine/medidas.js';
import {makeSitter,liftFor,FWD,ease} from './sitting3d.js';
import {moveCharacter} from './characters3d.js';
// asomarse: con ACCION.asomarse m de desventaja (como la cortina: sus puntos llegan cerca de lo que está junto a la ventana);
// se asoma en ACCION.asoma s; el ojo, a la altura de los ojos (CUERPO.ojos).
// (asomado, la cabeza sale ACCION.afuera m más allá del vidrio: desde adentro, al mirar a un lado se veía el muro)
export const ACCION={alcance:1,cortina:.5,asomarse:.3,asoma:.6,ojos:1.75,afuera:.35,asiento:{silla:.47,sillon:.45,sofa:.45,inodoro:.42,banca:.42,banco:.48},acostarse:1.1,camina:2.2,cuerpo:1.75};
const CU=new Set(CORTINA.cuartos);
// ronda (2026-10-17, REGLAS.md): la ronda jugable (engine/juego/ronda.js), si hay: robar lo que está al alcance y guardar
// en la caja de la guarida; enRonda(uso) lo hace (el 3D lleva la cuenta y lo muestra).
// casaPlan: el índice en el plano (plan.isla.casas) de la casa i del 3D (que sólo arma las que tienen plano de casa).
export function createAcciones({plan,world,player,avatar,viviendas=()=>null,ronda=()=>null,enRonda=()=>{},casaPlan=i=>i}){
 const cache=new Map();let cur=null,sitter=null;
 // los usos de un piso, en el mundo: los muebles del plano y las ventanas de los cuartos con cortina (con su clave)
 const usosDe=(lote,nivel)=>{const k=lote+':'+nivel;if(cache.has(k))return cache.get(k);const L=plan.lots.find(l=>l.id===lote),lv=L?.levels?.find(l=>l.level===nivel);if(!lv){cache.set(k,[]);return [];}
  const muebles=(lv.furniture||[]).map(f=>({kind:f.kind,x0:f.x,x1:f.x+f.w,z0:f.y,z1:f.y+f.h,fx:Math.sin(f.ry||0),fz:Math.cos(f.ry||0)}));
  const ventanas=[];lv.windows.forEach((w,wi)=>{if(w.shop)return;const c=cuartoDeVentana(lv,w);if(!c||!CU.has(c.q.type))return;ventanas.push({...(c.h?{x0:c.u,x1:c.v,z0:c.at,z1:c.at,nx:0,nz:c.edge}:{x0:c.at,x1:c.at,z0:c.u,z1:c.v,nx:c.edge,nz:0}),key:lote+':'+nivel+':'+wi});});
  const miradores=miradoresDePiso(lv).map(m=>({...m,key:lote+':'+nivel+':'+m.wi}));
  const u=usosDePiso(muebles,ventanas,miradores);cache.set(k,u);return u;};
 // Una casa del monte (vivienda3d): los usos del plano de hogar.js —en u, v, como los valida el 2D— pasados a la casa (x = u − ox,
 // z = D − v − oz) y al mundo (su lugar y su giro); sin cortinas (en las casas son parte de la malla)
 const usosDeCasa=(i,nivel)=>{const k='c'+i+':'+nivel;if(cache.has(k))return cache.get(k);const V=viviendas(),h=V?.houses?.[i],P=h?.plan,HG=P?.spec?.hogar,lv=HG?.levels?.find(l=>l.level===nivel);if(!lv){cache.set(k,[]);return [];}
  const aMundo=(u,v)=>{const lx=u-P.ox,lz=P.D-v-P.oz;return {x:h.x+lx*h.c+lz*h.s,z:h.z-lx*h.s+lz*h.c};},dirMundo=(fu,fv)=>{const lx=fu,lz=-fv;return [lx*h.c+lz*h.s,-lx*h.s+lz*h.c];};
  const muebles=(lv.furniture||[]).map(f=>({kind:f.kind,x0:f.u0,x1:f.u1,z0:f.v0,z1:f.v1,fx:(f.dir||[0,1])[0],fz:(f.dir||[0,1])[1]}));
  const u=usosDePiso(muebles,[],miradoresDeCasa(lv)).map(o=>{const [wx,wz]=dirMundo(Math.sin(o.pose.yaw),Math.cos(o.pose.yaw)),pp=aMundo(o.pose.x,o.pose.z);
   return {...o,objeto:{...o.objeto,casa:i},pose:{x:pp.x,z:pp.z,yaw:Math.atan2(wx,wz)},des:(o.des||[o.de]).map(d=>({...d,...aMundo(d.x,d.z)})),de:aMundo(o.de.x,o.de.z)};});
  cache.set(k,u);return u;};
 const pisoDe=()=>{const lot=world.lotAt(player.x,player.z);
  if(lot>=0&&world.dentro?.(player.x,player.z,player.feet+1)){const R=world.lots.get(lot)?.raise||0,f=(player.feet-R)/3,n=Math.round(f);if(Math.abs(f-n)>.08)return null;return {lot,nivel:n,y:R+n*3+.02};}
  const V=viviendas(),i=V?.houseAt?.(player.x,player.z);if(i==null)return null;const h=V.houses[i],P=h.plan,fe=player.feet-h.y,n=P.H1&&fe>P.H1-.4?1:0,y=h.y+(n?P.H1:P.FLOOR0);if(Math.abs(player.feet-y)>.12)return null;return {casa:i,nivel:n,y};};
 const usosAqui=p=>p.casa!=null?usosDeCasa(p.casa,p.nivel):usosDe(p.lot,p.nivel);
 // (el asiento o la cama de la gente del edificio que corresponde a un uso: para no sentarse encima de alguien, y para que
 // nadie venga a sentarse donde está el jugador)
 const lugarDe=(u,p)=>{if(p.lot==null)return null;const L=world.lots.get(p.lot);if(!L)return null;const list=u.accion==='sentarse'?L.seats:u.accion==='acostarse'?L.sleeps:null;let best=null,bd=u.accion==='sentarse'?.45:1;
  for(const s of list||[]){if(s.f!=null&&s.f!==p.nivel)continue;const d=Math.hypot(s.x-u.pose.x,s.z-u.pose.z);if(d<bd){bd=d;best=s;}}return best;};
 const ocupado=(u,p)=>{const s=lugarDe(u,p);return !!(s&&s.by&&s.by!=='jugador');};
 const texto=u=>u.accion==='sentarse'?'Sentarse':u.accion==='acostarse'?'Acostarse':u.accion==='asomarse'?'Asomarse':world.cortinaCerrada?.(u.objeto.key)?'Abrir la cortina':'Cerrar la cortina';
 // (lo de la ronda como acción: con su alterna —R—, si tiene)
 const deRonda=(ur,p)=>({ronda:ur,texto:ur.texto,piso:p,...(ur.alterna?{alterna:{ronda:ur.alterna,texto:ur.alterna.texto}}:{})});
 function cerca(){if(cur)return {texto:cur.fase==='quieto'?'Levantarse':null};const p=pisoDe();
  // (afuera: sólo lo de la ronda —las puertas de las casas del monte dan a la calle o al patio—)
  if(!p){const R=ronda(),ur=R?usosRonda(R,null,player.x,player.z)[0]:null;return ur?deRonda(ur,null):null;}
  let mejor=null,bd=1e9;
  // (la cortina, con ACCION.cortina m de desventaja: su grilla de puntos llega cerca de todo lo que está junto a la ventana, y
  // parado delante del sofá se cerraba la cortina en vez de sentarse)
  // (asomarse por una ventana con la cortina cerrada, no: primero se abre)
  const cortinas=[];
  for(const u of usosAqui(p)){if(u.accion==='asomarse'&&u.objeto.key&&world.cortinaCerrada?.(u.objeto.key))continue;if(u.accion!=='cortina'&&u.accion!=='asomarse'&&ocupado(u,p))continue;
   for(const d of u.des||[u.de]){const dd=Math.hypot(d.x-player.x,d.z-player.z);if(dd>ACCION.alcance)continue;if(u.accion==='cortina')cortinas.push({u,de:d,piso:p,dd});
    const sc=dd+(u.accion==='cortina'?ACCION.cortina:u.accion==='asomarse'?ACCION.asomarse:0);if(sc<bd){bd=sc;mejor={u,de:d,piso:p};}}}
  // (frente a una ventana con cortina, E se asoma y R corre la cortina: la de la misma ventana)
  if(mejor?.u.accion==='asomarse'){const c=cortinas.filter(c=>c.u.objeto.key===mejor.u.objeto.key).sort((a,b)=>a.dd-b.dd)[0];if(c)mejor.cortina={u:c.u,de:c.de,piso:p,texto:texto(c.u)};}
  // (la ronda: robar o guardar le gana a lo demás si está igual de cerca —lo robable suele estar junto a un sofá o una cama—)
  const R=ronda(),ur=R?usosRonda(R,p.casa!=null?{...p,casa:casaPlan(p.casa)}:p,player.x,player.z)[0]:null;
  if(ur&&(!mejor||ur.d<=bd+.4))return deRonda(ur,p);
  return mejor&&{...mejor,texto:texto(mejor.u)};}
 function empezar(c){const av=avatar();if(!c||!av)return false;if(c.ronda){enRonda(c.ronda);return false;}const {u,de,piso}=c;
  if(u.accion==='cortina'){world.cortina?.(u.objeto.key);return false;}
  if(u.accion==='asomarse'){cur={u,de:{x:de.x,z:de.z},piso,fase:'ir',t:0,yaw0:av.holder.rotation.y};return true;}
  if(ocupado(u,piso))return false;sitter=sitter||makeSitter(av,av.tpl);
  const lugar=lugarDe(u,piso);if(lugar)lugar.by='jugador';
  cur={u,de:{x:de.x,z:de.z},piso,fase:'ir',t:0,yaw0:av.holder.rotation.y,lugar};return true;}
 const soltar=()=>{if(cur?.lugar?.by==='jugador')cur.lugar.by=null;};
 // (acostado, la vuelta cuenta de 1 a 0: cur.t queda como estaba)
 function terminar(){if(cur&&cur.fase==='quieto'){cur.fase='subir';if(cur.u.accion==='sentarse'||cur.u.accion==='asomarse'){cur.t=0;if(cur.u.accion==='sentarse'&&sitter?.ok)sitter.begin('up');}}}
 // la pose: sentado —el asiento a su alto, corrido FWD hacia adelante—, o acostado —la cadera al medio de la cama, a su alto—
 const sentado=u=>{const h=ACCION.asiento[u.objeto.kind]??.45,fx=Math.sin(u.pose.yaw),fz=Math.cos(u.pose.yaw);return {x:u.pose.x+fx*FWD,z:u.pose.z+fz*FWD,lift:liftFor(h/.52)};};
 function update(dt,quiere){if(!cur)return false;const av=avatar();if(!av){cur=null;return false;}const h=av.holder,{u}=cur,y0=cur.piso.y;
  if(cur.fase==='ir'){// (camina derecho hasta el punto para hacerlo)
   const dx=cur.de.x-player.x,dz=cur.de.z-player.z,d=Math.hypot(dx,dz);
   if(d<.06){cur.fase='bajar';cur.t=0;cur.yawIni=h.rotation.y;if(u.accion==='sentarse'&&sitter?.ok)sitter.begin('down');}
   else{const st=Math.min(d,ACCION.camina*dt);player.x+=dx/d*st;player.z+=dz/d*st;h.position.set(player.x,player.feet,player.z);let dy=Math.atan2(dx,dz)-h.rotation.y;dy=Math.atan2(Math.sin(dy),Math.cos(dy));h.rotation.y+=dy*Math.min(1,dt*8);moveCharacter(av,'walk',.6,dt);}
   if(quiere&&d>.3){soltar();cur=null;return false;}return true;}
  // asomarse: de cara a la ventana; la cámara la pone DemoView (mirada): del lugar del muñeco al ojo junto al vidrio
  if(u.accion==='asomarse'){let dy=u.pose.yaw-h.rotation.y;dy=Math.atan2(Math.sin(dy),Math.cos(dy));h.rotation.y+=dy*Math.min(1,dt*8);moveCharacter(av,'idle',0,dt);
   if(cur.fase==='bajar'){cur.t=Math.min(1,cur.t+dt/ACCION.asoma);if(cur.t>=1)cur.fase='quieto';}
   else if(cur.fase==='quieto'){cur.t=1;if(quiere)terminar();}
   else if(cur.fase==='subir'){cur.t=Math.min(1,cur.t+dt/ACCION.asoma);if(cur.t>=1){cur=null;return false;}}
   return true;}
  if(u.accion==='sentarse'){const S=sentado(u);let k=0;
   if(cur.fase==='bajar'){k=sitter?.ok?sitter.step(dt):Math.min(1,(cur.t+=dt)/.8);if(k>=1)cur.fase='quieto';}
   else if(cur.fase==='quieto'){k=1;sitter?.hold(dt,false,false);if(quiere)terminar();}
   else if(cur.fase==='subir'){k=1-(sitter?.ok?sitter.step(dt):Math.min(1,(cur.t+=dt)/.8));if(k<=0){sitter?.release();player.x=cur.de.x;player.z=cur.de.z;soltar();cur=null;h.position.set(player.x,player.feet,player.z);return false;}}
   const e=ease(k);h.position.set(cur.de.x+(S.x-cur.de.x)*e,y0+S.lift*e,cur.de.z+(S.z-cur.de.z)*e);let dy=u.pose.yaw-cur.yawIni;dy=Math.atan2(Math.sin(dy),Math.cos(dy));h.rotation.y=cur.yawIni+dy*Math.min(1,e*1.5);return true;}
  // acostarse: del costado a la cama, girando el cuerpo hasta quedar boca arriba (la cabeza hacia el respaldo)
  // (girado YXZ: −90° en x deja la cabeza hacia el −z del muñeco; con yaw, hacia (−sen, −cos): hacia la cabecera, que es lo
  // contrario del frente de la cama —usos.js pose.yaw ya es el frente más π—)
  const top=y0+(CHOQUE_MUEBLE[u.objeto.kind]?.alto??.55),yaw=u.pose.yaw+Math.PI,hx=-Math.sin(yaw),hz=-Math.cos(yaw),c={x:u.pose.x-hx*ACCION.cuerpo/2,z:u.pose.z-hz*ACCION.cuerpo/2};
  if(cur.fase==='bajar'){cur.t+=dt/ACCION.acostarse;if(cur.t>=1){cur.t=1;cur.fase='quieto';}}
  else if(cur.fase==='quieto'){if(quiere)terminar();}
  else if(cur.fase==='subir'){cur.t-=dt/ACCION.acostarse;if(cur.t<=0){h.rotation.set(0,cur.yawIni,0);player.x=cur.de.x;player.z=cur.de.z;h.position.set(player.x,player.feet,player.z);soltar();cur=null;return false;}}
  const e=ease(Math.max(0,Math.min(1,cur.t)));h.rotation.order='YXZ';let dy=yaw-cur.yawIni;dy=Math.atan2(Math.sin(dy),Math.cos(dy));
  h.rotation.set(-Math.PI/2*e,cur.yawIni+dy*e,0);h.position.set(cur.de.x+(c.x-cur.de.x)*e,y0+(top+.02-y0)*Math.min(1,e*1.6),cur.de.z+(c.z-cur.de.z)*e);moveCharacter(av,'idle',0,dt);return true;}
 // La mirada por la ventana mientras uno se asoma: el ojo (la cabeza afuera del vidrio, a la altura de los ojos), hacia dónde mira la
 // ventana (yaw del cuerpo de cara a ella) y k, cuánto se asomó (0 → 1 al asomarse, 1 → 0 al volver).
 const mirada=()=>{if(!cur||cur.u.accion!=='asomarse'||cur.fase==='ir')return null;const e=ease(cur.t),k=cur.fase==='subir'?1-e:e;
  const fx=Math.sin(cur.u.pose.yaw),fz=Math.cos(cur.u.pose.yaw),a=ACCION.afuera+USOS.asomarse.ojo;
  return {x:cur.u.pose.x+fx*a,z:cur.u.pose.z+fz*a,y:cur.piso.y+ACCION.ojos,yaw:cur.u.pose.yaw,k};};
 return {cerca,empezar,terminar,update,mirada,get activa(){return !!cur;},get fase(){return cur?.fase;},get accion(){return cur?.u.accion;},usosDe,usosDeCasa};}
