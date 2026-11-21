// LOS MUROS QUE SE PUEDEN PINTAR (2026-11-21, Miguel: «una pared completa, sin ventanas ni puertas, tanto exteriores como
// interiores»).
//
// Un muro es una cara de pared vista de frente: {id, ancho, alto, huecos, y dónde queda en la ciudad}. Sale del plano:
//   · EXTERIOR: cada lado de un edificio, entero, de la vereda a la cornisa; sus huecos son las ventanas, las vidrieras y
//     las puertas de todos los pisos (engine/fachada-medida.js). id: «L<lote>-<lado>».
//   · INTERIOR: cada una de las cuatro paredes de un cuarto, del piso al cielo raso; sus huecos son las puertas y las
//     ventanas que caen sobre ella (engine/colocar.js). id: «L<lote>-P<piso>-C<cuarto>-<lado>».
// u corre de izquierda a derecha mirando el muro de frente (de afuera el exterior, de adentro el interior); y, del pie
// del muro hacia arriba. Para el 3D: c (el centro, en el plano), n (hacia quien lo mira), y0 (la altura del pie, sin la
// del edificio) y sale (cuánto por delante de la línea del muro va lo pintado, para no quedar metido en la pared).
// Las casas del monte todavía no: su plano está en otras coordenadas (hogar.js).
import {ALTURA} from './medidas.js';
import {fachadaMedida,VANO} from './fachada-medida.js';
import {RAISE} from './fachada.js';
import {paredesDe,vanosDe} from './colocar.js';

const r3=v=>Math.round(v*1000)/1000,NORMAL={N:[0,-1],S:[0,1],E:[1,0],W:[-1,0]};
export const SALE={exterior:.07,tabique:.075,medianera:.145,fachada:.265};// (m: el zócalo sale 5 cm; un tabique mide 12 de espesor y se ve la mitad; la medianera, 12 de este lado; la fachada, 25 hacia adentro)
// de u (a lo largo del muro) a un punto del plano
export const puntoDe=(m,u)=>{const ry=Math.atan2(m.n[0],m.n[1]),k=u-m.ancho/2;return {x:r3(m.c.x+Math.cos(ry)*k),z:r3(m.c.z-Math.sin(ry)*k)};};

export function muroExterior(L,lado){const F=fachadaMedida(L,lado),a=F.punto(0),b=F.punto(F.ancho),huecos=F.pisos.flatMap(P=>P.vanos.map(v=>({u0:v.u0,u1:v.u1,y0:v.y0,y1:v.y1,clase:v.clase})));
 return {id:`L${L.id}-${lado}`,clase:'exterior',lote:L.id,lado,ancho:F.ancho,alto:F.alto,huecos,c:{x:r3((a.x+b.x)/2),z:r3((a.z+b.z)/2)},n:NORMAL[lado],y0:0,sale:SALE.exterior,color:L.colores?.fachada||null,nombre:`Fachada ${({N:'norte',S:'sur',E:'este',W:'oeste'})[lado]}`};}

// Las cuatro paredes de un cuarto. dentroDelLote(x, z): para saber si del otro lado de la pared hay edificio (un tabique)
// o es la fachada (más gruesa hacia adentro).
// enOtroLote(x, z): si ese punto es de otro edificio (entonces la pared es una medianera, no la fachada).
export function murosDeCuarto(L,nivel,q,enOtroLote=null){const sube=L.fachada?.escalinata?RAISE:0,lv=L.levels[nivel],dentro=(x,z)=>(L.parts||[]).some(p=>x>p.x&&x<p.x+p.w&&z>p.y&&z<p.y+p.h),H=ALTURA.cieloRaso,out=[];
 for(const P of paredesDe(q)){const ancho=r3(P.a1-P.a0),n=P.hacia,ry=Math.atan2(n[0],n[1]),dir=P.horiz?Math.cos(ry):-Math.sin(ry);// (dir: +1 si u crece con la coordenada a lo largo de la pared)
  const c=P.horiz?{x:r3((P.a0+P.a1)/2),z:P.fija}:{x:P.fija,z:r3((P.a0+P.a1)/2)},aU=t=>dir>0?t-P.a0:P.a1-t;
  const huecos=vanosDe(lv,P).map(v=>{const p=Math.max(P.a0,v.p),qq=Math.min(P.a1,v.q),u0=r3(Math.min(aU(p),aU(qq))),u1=r3(Math.max(aU(p),aU(qq))),[y0,y1]=v.clase==='puerta'?VANO.puerta:VANO.comun;return {u0,u1,y0,y1:v.clase==='puerta'?y1:Math.min(H,y1+.4),clase:v.clase};}).filter(h=>h.u1-h.u0>.01);
  // (la ventana, generosa hacia arriba: adentro el vano de una vidriera o de un ventanal llega más alto que el de una común)
  const ox=c.x-n[0]*.3,oz=c.z-n[1]*.3,sale=dentro(ox,oz)?SALE.tabique:enOtroLote?.(ox,oz)?SALE.medianera:SALE.fachada;
  out.push({id:`L${L.id}-P${nivel}-C${q.id}-${P.lado}`,clase:'interior',lote:L.id,nivel,cuarto:q.id,lado:P.lado,ancho,alto:H,huecos,c,n,y0:r3(sube+nivel*ALTURA.piso+.02),sale,color:L.colores?.cuartos?.[nivel+':'+q.id]||null,nombre:`Pared ${({N:'norte',S:'sur',E:'este',W:'oeste'})[P.lado]}`});}
 return out;}

// El muro de un identificador (lo que guarda un grafiti), o null si esa ciudad no lo tiene.
export function muroDe(bp,id){const m=/^L(\d+)-(?:([NSEW])|P(\d+)-C(\d+)-([NSEW]))$/.exec(id);if(!m)return null;const L=bp.lots[+m[1]];if(!L?.levels?.length)return null;
 if(m[2])return muroExterior(L,m[2]);const nivel=+m[3],q=L.levels[nivel]?.rooms.find(q=>q.id===+m[4]);return q?murosDeCuarto(L,nivel,q,otroLoteDe(bp,L)).find(w=>w.lado===m[5])||null:null;}
// ¿Ese punto del plano es de otro edificio que no sea L?
export const otroLoteDe=(bp,L)=>(x,z)=>bp.lots.some(o=>o!==L&&o.id!==L.id&&(o.parts||[]).some(p=>x>p.x&&x<p.x+p.w&&z>p.y&&z<p.y+p.h));
// La pared de un cuarto más cercana a un punto del plano de ese piso (para elegirla con un clic).
export function muroCerca(L,nivel,q,x,z,enOtroLote=null){const P=paredesDe(q).map(P=>({P,d:Math.abs((P.horiz?z:x)-P.fija)})).sort((a,b)=>a.d-b.d)[0].P;return murosDeCuarto(L,nivel,q,enOtroLote).find(w=>w.lado===P.lado);}
