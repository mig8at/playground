/* LAS ABERTURAS Y LO QUE SE VE POR ELLAS (2026-11-22, Miguel: «¿por qué no lo aterrizas en el motor 2D, así también podemos
   calcular?»; antes: «mostrar el interior por donde apunta la cámara: si está abierta la puerta, debería verse lo de adentro,
   al igual que si está abierta una ventana, similar a lo que hace GTA»). Puro, sobre el plano: el 3D sólo lo consulta
   (world3d updateInteriors) y validar-portales lo mide sin pantalla.
   · aberturasDe(bp): cada ventana —su clave lote:piso:ventana, la misma del paño del 3D— y cada puerta de calle, con su
     lugar (x, z en el mundo; y0..y1 de alto), su ancho, su eje (h: corre a lo largo de x), hacia dónde mira
     afuera (nx, nz) y su lote;
   · vistaDesde(bp, camara, abiertas): de las aberturas ABIERTAS, cuáles están en el campo de visión de la cámara y a menos
     de LEJOS m, mirándolas desde su lado de afuera —una ventana de la cara de atrás no se ve— (vistas) y cuáles de esas tapa otro edificio (tapadas: el rayo de la cámara a la abertura, cada PASO m sobre
     la planta, pasa por otro lote por debajo de su techo). lotes: los que tienen una abertura vista —su interior se arma—.
     camara: {x, y, z, yaw, pitch, fov (vertical, grados), aspect} —el giro YXZ de three.js: yaw en y, pitch en x—;
     abiertas: {ventanas: [claves], puertas: [claves de engine/estadoMundo.js puertaClave —el lugar de la hoja—]}. */
import {VANO} from './fachada-medida.js';
import {RAISE} from './fachada.js';
import {cuartoDeVentana} from './cortinas.js';
import {modulosDeFachada,vidrioDeModulo,vanoDeModulo,GRILLA_FACHADA} from './fachada-piezas.js';

export const PORTALES={lejos:35,paso:.5,piso:3,margenPuerta:1};
const cache=new WeakMap();
const subida=L=>L.fachada?.escalinata?RAISE:0;
// Las aberturas del plano y la planta de los edificios (para el rayo), una vez por plano.
export function aberturasDe(bp){if(cache.has(bp))return cache.get(bp).aberturas;const out=[],F=PORTALES.piso;
 // (2026-11-22, Miguel: «apuntando también a las fachadas como se verán en el 3D»: una ventana del plano está donde la dibuja el
 // 3D —su módulo de fachada, fachada-piezas.js, y el vidrio de su pieza: vidrioDeModulo—, no en el centro de su tramo del
 // plano. En una ventana doble, la pieza ocupa dos módulos y su vidrio va centrado en la junta: las dos ventanas del plano son
 // ese vidrio. Sin vidrio medido —una vidriera, un balcón—, el vano del módulo; sin módulo, el tramo del plano)
 const S=GRILLA_FACHADA.casilla;
 for(const L of bp.lots||[]){const mods=new Map();for(const md of (L.modulos?.length?L.modulos:modulosDeFachada(bp,L)))mods.set(`${md.f}:${md.x}:${md.y}:${md.dx}:${md.dy}:${md.k}`,md);
  const centro=md=>{const c=-S/2+1+2*md.k;return {x:(md.x+.5+md.dx*.5)*S+md.dy*c,z:(md.y+.5+md.dy*.5)*S-md.dx*c,tx:md.dy,tz:-md.dx};};
  const moduloEn=(f,x,z)=>{for(const md of mods.values()){if(md.f!==f)continue;const p=centro(md);if(Math.abs(p.x-x)<.3&&Math.abs(p.z-z)<.3)return md;}return null;};
  for(const lv of L.levels||[]){const base=subida(L)+lv.level*F;
  (lv.windows||[]).forEach((w,wi)=>{const c=cuartoDeVentana(lv,w);if(!c)return;const m=(c.u+c.v)/2,wx=c.h?m:c.at,wz=c.h?c.at:m;
   let md=moduloEn(lv.level,wx,wz);if(md?.tipo==='doble2')md=mods.get(`${md.f}:${md.x}:${md.y}:${md.dx}:${md.dy}:${md.k-1}`)||md;
   const g=md&&(vidrioDeModulo(md)||vanoDeModulo(md)),p=md&&centro(md);
   const [x,z,ancho,a,b]=g?[p.x+p.tx*(g[0]+g[1])/2,p.z+p.tz*(g[0]+g[1])/2,g[1]-g[0],g[2],g[3]]:[wx,wz,c.v-c.u,...(w.shop?VANO.vidriera:VANO.comun)];
   out.push({tipo:'ventana',clave:`${L.id}:${lv.level}:${wi}`,lote:L.id,nivel:lv.level,h:c.h,x,z,nx:c.h?0:-c.edge,nz:c.h?-c.edge:0,y0:base+a,y1:base+b,ancho,modulo:md?.tipo||null});});/* (edge: hacia adentro del cuarto; afuera, al revés) */
  if(lv.level===0)(lv.doors||[]).forEach((d,di)=>{if(!d.street)return;const h=Math.abs(d.y0-d.y1)<1e-6,[a,b]=VANO.puerta,x=(d.x0+d.x1)/2,z=(d.y0+d.y1)/2;
   // (afuera: el lado de la puerta que no cae en el lote)
   const enL=(px,pz)=>(L.parts||[]).some(p=>px>p.x&&px<p.x+p.w&&pz>p.y&&pz<p.y+p.h),[nx,nz]=(h?[[0,1],[0,-1]]:[[1,0],[-1,0]]).find(([u,v])=>!enL(x+u*.6,z+v*.6))||[0,0];
   out.push({tipo:'puerta',clave:`${L.id}:puerta:${di}`,lote:L.id,nivel:0,h,x,z,nx,nz,y0:base+a,y1:base+b,ancho:Math.hypot(d.x1-d.x0,d.y1-d.y0)});});}}
 // (la planta: cada parte de cada edificio con su techo)
 const partes=[];for(const L of bp.lots||[])for(const p of L.parts||[])partes.push({lote:L.id,x0:p.x,x1:p.x+p.w,z0:p.y,z1:p.y+p.h,techo:subida(L)+(L.floors||1)*F});
 cache.set(bp,{aberturas:out,partes});return out;}
const partesDe=bp=>{aberturasDe(bp);return cache.get(bp).partes;};
const loteEn=(P,x,z)=>{for(const p of P)if(x>p.x0&&x<p.x1&&z>p.z0&&z<p.z1)return p;return null;};

// ¿Está el punto (x, y, z), con su medio ancho r, en el campo de visión de la cámara?
export function enVista(c,x,y,z,r=0){const cy=Math.cos(c.yaw),sy=Math.sin(c.yaw),cp=Math.cos(c.pitch||0),sp=Math.sin(c.pitch||0);
 const dx=x-c.x,dy=y-c.y,dz=z-c.z,hondo=-dx*sy*cp+dy*sp-dz*cy*cp;if(hondo<=.05)return false;
 const lado=dx*cy-dz*sy,alto=dx*sy*sp+dy*cp+dz*cy*sp,tv=Math.tan((c.fov||75)*Math.PI/360),th=tv*(c.aspect||1);
 return Math.abs(lado)<=hondo*th+r&&Math.abs(alto)<=hondo*tv+r;}
// ¿Llega el rayo de la cámara a la abertura sin pasar por otro edificio por debajo de su techo?
export function libre(bp,c,a){const P=partesDe(bp),propios=new Set([loteEn(P,c.x,c.z)?.lote,a.lote]);
 const tx=a.x,ty=(a.y0+a.y1)/2,tz=a.z,dx=tx-c.x,dy=ty-c.y,dz=tz-c.z,L=Math.hypot(dx,dz);
 for(let t=PORTALES.paso;t<L-.6;t+=PORTALES.paso){const k=t/L,p=loteEn(P,c.x+dx*k,c.z+dz*k);if(p&&!propios.has(p.lote)&&c.y+dy*k<p.techo)return false;}
 return true;}

export function vistaDesde(bp,c,abiertas={}){const A=aberturasDe(bp),V=new Set(abiertas.ventanas||[]),Pu=(abiertas.puertas||[]).map(k=>k.split(',').map(Number));
 const abierta=a=>a.tipo==='ventana'?V.has(a.clave):Pu.some(([x,z,y])=>Math.hypot(x-a.x,z-a.z)<PORTALES.margenPuerta&&Math.abs(y-a.y0)<1.6);
 const vistas=[],tapadas=[],lotes=new Set();
 for(const a of A){if(Math.hypot(a.x-c.x,a.z-c.z)>PORTALES.lejos||!abierta(a))continue;if((c.x-a.x)*a.nx+(c.z-a.z)*a.nz<=0)continue;/* (desde atrás no se ve) */const ym=(a.y0+a.y1)/2;if(!enVista(c,a.x,ym,a.z,Math.max(a.ancho,a.y1-a.y0)/2))continue;
  if(libre(bp,c,a)){vistas.push(a);lotes.add(a.lote);}else tapadas.push(a);}
 return {lotes,vistas,tapadas};}
