/* Las acciones del jugador (2026-10-16, Miguel: «abrir una cortina, sentarse en una silla, acostarse en una cama al
   acercarse»). Lo que se puede hacer y desde dónde lo dice el 2D (engine/usos.js usosDePiso, que validar-usos prueba: se
   llega caminando y cabe); acá sólo se anima. cerca(): el uso más cercano del piso del jugador (a ALCANCE de alguno de
   sus puntos para hacerlo) y su texto; empezar(): lo arranca; update(dt, quiereMoverse): mientras dure, mueve el muñeco
   y devuelve true (el jugador no camina); otra E o caminar lo termina (levantarse). */
import * as THREE from 'three';
import {usosDePiso} from '../engine/usos.js';
import {cuartoDeVentana} from '../engine/cortinas.js';
import {CHOQUE_MUEBLE} from '../engine/medidas.js';
import {makeSitter,liftFor,FWD,ease} from './sitting3d.js';
import {moveCharacter} from './characters3d.js';
// (2026-11-22, Miguel: «quita lo de asomarse y deja sólo abrir ventana: que se pueda abrir y cerrar una ventana y se guarde el
// estado, al igual que una puerta»): la ventana se abre y se cierra con E —world.cortina(clave)— y avisa alVentana(clave,
// abierta), que el 3D guarda —engine/estadoMundo.js—. Cerrada, su paño lechoso tapa el vidrio; abierta, se ve adentro.
export const ACCION={alcance:1,cortina:.5,asiento:{silla:.47,sillon:.45,sofa:.45,inodoro:.42,banca:.42,banco:.48},acostarse:1.1,camina:2.2,cuerpo:1.75};
export function createAcciones({plan,world,player,avatar,viviendas=()=>null,alVentana=()=>{}}){
 const cache=new Map();let cur=null,sitter=null;const esCasa=k=>/^c\d+:v\d+$/.test(String(k));
 // los usos de un piso, en el mundo: los muebles del plano y las ventanas (todas: cada una se abre y se cierra, con su clave)
 const usosDe=(lote,nivel)=>{const k=lote+':'+nivel;if(cache.has(k))return cache.get(k);const L=plan.lots.find(l=>l.id===lote),lv=L?.levels?.find(l=>l.level===nivel);if(!lv){cache.set(k,[]);return [];}
  const muebles=(lv.furniture||[]).map(f=>({kind:f.kind,x0:f.x,x1:f.x+f.w,z0:f.y,z1:f.y+f.h,fx:Math.sin(f.ry||0),fz:Math.cos(f.ry||0)}));
  const ventanas=[];lv.windows.forEach((w,wi)=>{const c=cuartoDeVentana(lv,w);if(!c)return;ventanas.push({...(c.h?{x0:c.u,x1:c.v,z0:c.at,z1:c.at,nx:0,nz:c.edge}:{x0:c.at,x1:c.at,z0:c.u,z1:c.v,nx:c.edge,nz:0}),key:lote+':'+nivel+':'+wi});});
  const u=usosDePiso(muebles,ventanas);cache.set(k,u);return u;};
 // Una casa del monte (vivienda3d): los usos del plano de hogar.js —en u, v, como los valida el 2D— pasados a la casa (x = u − ox,
 // z = D − v − oz) y al mundo (su lugar y su giro); sin cortinas (en las casas son parte de la malla)
 const usosDeCasa=(i,nivel)=>{const k='c'+i+':'+nivel;if(cache.has(k))return cache.get(k);const V=viviendas(),h=V?.houses?.[i],P=h?.plan,HG=P?.spec?.hogar,lv=HG?.levels?.find(l=>l.level===nivel);if(!lv){cache.set(k,[]);return [];}
  const aMundo=(u,v)=>{const lx=u-P.ox,lz=P.D-v-P.oz;return {x:h.x+lx*h.c+lz*h.s,z:h.z-lx*h.s+lz*h.c};},dirMundo=(fu,fv)=>{const lx=fu,lz=-fv;return [lx*h.c+lz*h.s,-lx*h.s+lz*h.c];};
  const muebles=(lv.furniture||[]).map(f=>({kind:f.kind,x0:f.u0,x1:f.u1,z0:f.v0,z1:f.v1,fx:(f.dir||[0,1])[0],fz:(f.dir||[0,1])[1]}));
  // (2026-11-22, Miguel: «sí, las casas»: sus ventanas también se abren y se cierran —vivienda3d setVentana, clave c<casa>:v<vano>—;
  // del plano de la casa —openings, en su marco— a u, v: u = x + ox, v = D − z − oz)
  const ventanas=[];P.openings.forEach((o,oi)=>{if(o.kind!=='window'||o.nivel!==nivel)return;const U=lx=>lx+P.ox,Vv=lz=>P.D-lz-P.oz;
   ventanas.push(o.axis==='x'?{x0:U(o.c-o.w/2),x1:U(o.c+o.w/2),z0:Vv(o.at),z1:Vv(o.at),nx:0,nz:-o.out,key:'c'+i+':v'+oi}:{x0:U(o.at),x1:U(o.at),z0:Math.min(Vv(o.c-o.w/2),Vv(o.c+o.w/2)),z1:Math.max(Vv(o.c-o.w/2),Vv(o.c+o.w/2)),nx:o.out,nz:0,key:'c'+i+':v'+oi});});
  const u=usosDePiso(muebles,ventanas).map(o=>{const [wx,wz]=dirMundo(Math.sin(o.pose.yaw),Math.cos(o.pose.yaw)),pp=aMundo(o.pose.x,o.pose.z);
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
 const texto=u=>u.accion==='sentarse'?'Sentarse':u.accion==='acostarse'?'Acostarse':(esCasa(u.objeto.key)?!viviendas()?.ventanaAbierta?.(u.objeto.key):world.cortinaCerrada?.(u.objeto.key))?'Abrir la ventana':'Cerrar la ventana';
 function cerca(){if(cur)return {texto:cur.fase==='quieto'?'Levantarse':null};const p=pisoDe();
  if(!p)return null;
  let mejor=null,bd=1e9;
  // (la cortina, con ACCION.cortina m de desventaja: su grilla de puntos llega cerca de todo lo que está junto a la ventana, y
  // parado delante del sofá se cerraba la cortina en vez de sentarse)
  for(const u of usosAqui(p)){if(u.accion!=='cortina'&&ocupado(u,p))continue;
   for(const d of u.des||[u.de]){const dd=Math.hypot(d.x-player.x,d.z-player.z);if(dd>ACCION.alcance)continue;
    const sc=dd+(u.accion==='cortina'?ACCION.cortina:0);if(sc<bd){bd=sc;mejor={u,de:d,piso:p};}}}
  return mejor&&{...mejor,texto:texto(mejor.u)};}
 function empezar(c){const av=avatar();if(!c||!av)return false;const {u,de,piso}=c;
  if(u.accion==='cortina'){const k=u.objeto.key;if(esCasa(k)){const V=viviendas(),ab=V?.setVentana?.(k,!V.ventanaAbierta(k));alVentana(k,!!ab);return false;}const cerrada=world.cortina?.(k);alVentana(k,!cerrada);return false;}
  if(ocupado(u,piso))return false;sitter=sitter||makeSitter(av,av.tpl);
  const lugar=lugarDe(u,piso);if(lugar)lugar.by='jugador';
  cur={u,de:{x:de.x,z:de.z},piso,fase:'ir',t:0,yaw0:av.holder.rotation.y,lugar};return true;}
 const soltar=()=>{if(cur?.lugar?.by==='jugador')cur.lugar.by=null;};
 // (acostado, la vuelta cuenta de 1 a 0: cur.t queda como estaba)
 function terminar(){if(cur&&cur.fase==='quieto'){cur.fase='subir';if(cur.u.accion==='sentarse'){cur.t=0;if(cur.u.accion==='sentarse'&&sitter?.ok)sitter.begin('up');}}}
 // la pose: sentado —el asiento a su alto, corrido FWD hacia adelante—, o acostado —la cadera al medio de la cama, a su alto—
 const sentado=u=>{const h=ACCION.asiento[u.objeto.kind]??.45,fx=Math.sin(u.pose.yaw),fz=Math.cos(u.pose.yaw);return {x:u.pose.x+fx*FWD,z:u.pose.z+fz*FWD,lift:liftFor(h/.52)};};
 function update(dt,quiere){if(!cur)return false;const av=avatar();if(!av){cur=null;return false;}const h=av.holder,{u}=cur,y0=cur.piso.y;
  if(cur.fase==='ir'){// (camina derecho hasta el punto para hacerlo)
   const dx=cur.de.x-player.x,dz=cur.de.z-player.z,d=Math.hypot(dx,dz);
   if(d<.06){cur.fase='bajar';cur.t=0;cur.yawIni=h.rotation.y;if(u.accion==='sentarse'&&sitter?.ok)sitter.begin('down');}
   else{const st=Math.min(d,ACCION.camina*dt);player.x+=dx/d*st;player.z+=dz/d*st;h.position.set(player.x,player.feet,player.z);let dy=Math.atan2(dx,dz)-h.rotation.y;dy=Math.atan2(Math.sin(dy),Math.cos(dy));h.rotation.y+=dy*Math.min(1,dt*8);moveCharacter(av,'walk',.6,dt);}
   if(quiere&&d>.3){soltar();cur=null;return false;}return true;}
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
 return {cerca,empezar,terminar,update,get activa(){return !!cur;},get fase(){return cur?.fase;},get accion(){return cur?.u.accion;},usosDe,usosDeCasa};}
