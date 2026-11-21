// LOS MUROS QUE SE PUEDEN PINTAR (2026-11-21, Miguel: «una pared completa, sin ventanas ni puertas, tanto exteriores como
// interiores»).
//
// Un muro es una cara de pared vista de frente: {id, ancho, alto, huecos, y dónde queda en la ciudad}. Sale del plano:
//   · EXTERIOR: una fachada NO es un solo muro (2026-11-21, Miguel: «que no sea toda una fachada sino la pared divisoria,
//     tratarlas como independientes aunque se pueda pintar toda la fachada: así en la base de datos enumeramos las
//     paredes de un edificio y cargamos el pixel art por paredes»). Cada lado se parte en PAREDES: un piso de alto y, a lo
//     ancho, de un tabique al siguiente —el frente de cada cuarto, del pasillo o de la escalera—. Sus huecos son las
//     ventanas, las vidrieras y las puertas que le caen. id: «L<lote>-<lado>-P<piso>-T<tramo>» (el tramo, de izquierda a
//     derecha). La fachada entera (muroExterior) queda para verla y pintarla de corrido: lo pintado se guarda por pared.
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
import {GRAFITI,lienzoDe,vacio,aTexto,deTexto} from './grafiti.js';

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

// LAS PAREDES DE UNA FACHADA. Los cortes a lo ancho son los bordes de lo que hay detrás en ese piso (cuartos, pasillos,
// núcleo) que tocan la línea de la fachada, llevados a la grilla de píxeles —así cada pared tiene píxeles enteros y la
// fachada es exactamente la suma de sus paredes—; un tramo de menos de MIN_PARED se une al de al lado.
export const MIN_PARED=.5;
export function paredesDeFachada(L,lado){const F=muroExterior(L,lado),px=GRAFITI.px,r=L.rect,H=ALTURA.piso,sube=L.fachada?.escalinata?RAISE:0,horiz=lado==='N'||lado==='S',inv=lado==='N'||lado==='E';
 const linea=lado==='N'?r.y:lado==='S'?r.y+r.h:lado==='W'?r.x:r.x+r.w,out=[];
 for(let nivel=0;nivel<L.floors;nivel++){const lv=L.levels[nivel],cortes=new Set([0,F.ancho]);
  // lo que toca la fachada por detrás: sus dos bordes a lo largo de ella
  for(const q of [...(lv.rooms||[]),...(lv.corridor||[]),...(lv.core?[lv.core]:[])]){if(q.x==null||q.w==null)continue;const toca=horiz?(Math.abs(q.y-linea)<.3||Math.abs(q.y+q.h-linea)<.3):(Math.abs(q.x-linea)<.3||Math.abs(q.x+q.w-linea)<.3);if(!toca)continue;
   for(const t of horiz?[q.x-r.x,q.x+q.w-r.x]:[q.y-r.y,q.y+q.h-r.y]){const u=inv?F.ancho-t:t;if(u>0&&u<F.ancho)cortes.add(Math.round(u/px)*px);}}
  let us=[...cortes].map(r3).sort((a,b)=>a-b).filter((u,i,a)=>!i||u-a[i-1]>1e-6);
  // (los tramos angostos se unen al siguiente; el último, al anterior)
  for(let i=1;i<us.length-1;){if(us[i]-us[i-1]<MIN_PARED)us.splice(i,1);else i++;}if(us.length>2&&us[us.length-1]-us[us.length-2]<MIN_PARED)us.splice(us.length-2,1);
  const y0=nivel?r3(sube+nivel*H):0,y1=r3(sube+(nivel+1)*H);
  for(let k=0;k<us.length-1;k++){const u0=us[k],u1=us[k+1],a=puntoDe(F,u0),b=puntoDe(F,u1);
   const huecos=F.huecos.filter(h=>h.u1>u0+.001&&h.u0<u1-.001&&h.y1>y0+.001&&h.y0<y1-.001).map(h=>({u0:r3(Math.max(0,h.u0-u0)),u1:r3(Math.min(u1-u0,h.u1-u0)),y0:r3(Math.max(0,h.y0-y0)),y1:r3(Math.min(y1-y0,h.y1-y0)),clase:h.clase}));
   out.push({id:`L${L.id}-${lado}-P${nivel}-T${k}`,clase:'exterior',lote:L.id,lado,nivel,tramo:k,u0,u1,ancho:r3(u1-u0),alto:r3(y1-y0),huecos,c:{x:r3((a.x+b.x)/2),z:r3((a.z+b.z)/2)},n:F.n,y0,sale:SALE.exterior,color:F.color,nombre:`Pared ${k+1} del piso ${nivel}, fachada ${({N:'norte',S:'sur',E:'este',W:'oeste'})[lado]}`});}}
 return out;}
// Todas las paredes de un edificio, enumeradas (lo que listaría una base de datos): las de sus cuatro fachadas y las
// cuatro caras de cada cuarto. Un tabique entre dos cuartos aparece dos veces: una cara por cuarto.
export function paredesDelEdificio(bp,L){const otro=otroLoteDe(bp,L),out=['N','S','E','W'].flatMap(l=>paredesDeFachada(L,l));L.levels.slice(0,L.floors).forEach((lv,nivel)=>{for(const q of lv.rooms)out.push(...murosDeCuarto(L,nivel,q,otro));});return out;}

// La fachada entera como UN lienzo armado con lo guardado en cada una de sus paredes, y al revés: lo pintado de corrido,
// repartido en sus paredes. guardados: {id: {cols, rows, t}}. componer devuelve null si no hay nada pintado.
const cajaDe=(F,Z,P)=>{const c0=Math.round(P.u0/Z.px),c1=Math.round(P.u1/Z.px),f0=Z.rows-Math.round((P.y0+P.alto)/Z.px),f1=Z.rows-Math.round(P.y0/Z.px);return {c0,c1,f0:Math.max(0,f0),f1:Math.min(Z.rows,f1)};};
export function componerFachada(L,lado,guardados){const F=muroExterior(L,lado),Z=lienzoDe(F),g=vacio(Z.cols,Z.rows);let hay=false;
 for(const P of paredesDeFachada(L,lado)){const s=guardados?.[P.id];if(!s?.t)continue;const B=cajaDe(F,Z,P),w=B.c1-B.c0,h=B.f1-B.f0;if(s.cols!==w||s.rows!==h)continue;const p=deTexto(s.t,w,h);if(!p)continue;for(let f=0;f<h;f++)g.d.set(p.d.subarray(f*w,(f+1)*w),(B.f0+f)*Z.cols+B.c0);hay=true;}
 return hay?g:null;}
export function partirFachada(L,lado,g){const F=muroExterior(L,lado),Z=lienzoDe(F),out={};
 for(const P of paredesDeFachada(L,lado)){const B=cajaDe(F,Z,P),w=B.c1-B.c0,h=B.f1-B.f0,p=vacio(w,h);let n=0;for(let f=0;f<h;f++){const fila=g.d.subarray((B.f0+f)*Z.cols+B.c0,(B.f0+f)*Z.cols+B.c1);p.d.set(fila,f*w);for(const v of fila)if(v)n++;}out[P.id]=n?{cols:w,rows:h,t:aTexto(p)}:null;}
 return out;}

// El muro de un identificador (lo que guarda un grafiti), o null si esa ciudad no lo tiene.
export function muroDe(bp,id){const m=/^L(\d+)-(?:([NSEW])(?:-P(\d+)-T(\d+))?|P(\d+)-C(\d+)-([NSEW]))$/.exec(id);if(!m)return null;const L=bp.lots[+m[1]];if(!L?.levels?.length)return null;
 if(m[2])return m[3]!=null?paredesDeFachada(L,m[2]).find(P=>P.nivel===+m[3]&&P.tramo===+m[4])||null:muroExterior(L,m[2]);m[3]=m[5];m[4]=m[6];m[5]=m[7];const nivel=+m[3],q=L.levels[nivel]?.rooms.find(q=>q.id===+m[4]);return q?murosDeCuarto(L,nivel,q,otroLoteDe(bp,L)).find(w=>w.lado===m[5])||null:null;}
// ¿Ese punto del plano es de otro edificio que no sea L?
export const otroLoteDe=(bp,L)=>(x,z)=>bp.lots.some(o=>o!==L&&o.id!==L.id&&(o.parts||[]).some(p=>x>p.x&&x<p.x+p.w&&z>p.y&&z<p.y+p.h));
// La pared de un cuarto más cercana a un punto del plano de ese piso (para elegirla con un clic).
export function muroCerca(L,nivel,q,x,z,enOtroLote=null){const P=paredesDe(q).map(P=>({P,d:Math.abs((P.horiz?z:x)-P.fija)})).sort((a,b)=>a.d-b.d)[0].P;return murosDeCuarto(L,nivel,q,enOtroLote).find(w=>w.lado===P.lado);}
