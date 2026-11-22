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
import {ALTURA,esVidriera} from './medidas.js';
import {fachadaMedida,VANO,ladosDeCalle,tramosDe} from './fachada-medida.js';
export {tramosDe};
export const ladosDeCalleDe=ladosDeCalle;
import {RAISE,facadeStyle,WINDOWS,VIDRIO_PIEZA,VIDRIO_VENTANAL} from './fachada.js';
import {paredesDe} from './colocar.js';
import {GRAFITI,lienzoDe,vacio,aTexto,deTexto} from './grafiti.js';
import {vanoDeModulo} from './fachada-piezas.js';

const r3=v=>Math.round(v*1000)/1000,NORMAL={N:[0,-1],S:[0,1],E:[1,0],W:[-1,0]};
export const SALE={exterior:.07,tabique:.075,medianera:.145,fachada:.265};// (m: el zócalo sale 5 cm; un tabique mide 12 de espesor y se ve la mitad; la medianera, 12 de este lado; la fachada, 25 hacia adentro)
// de u (a lo largo del muro) a un punto del plano
export const puntoDe=(m,u)=>{const ry=Math.atan2(m.n[0],m.n[1]),k=u-m.ancho/2;return {x:r3(m.c.x+Math.cos(ry)*k),z:r3(m.c.z-Math.sin(ry)*k)};};

// LO QUE NO ES PARED EN UNA FACHADA (2026-11-21, Miguel, al ver el 3D: «el pixel art está sobre puertas y ventanas: las
// paredes ya deben saber dónde están y sólo permitir pintar sobre pared»). El plano guarda de cada vano sólo su tramo;
// lo que el 3D pone ahí es una PIEZA más grande que ese tramo: el vidrio de cada modelo de ventana (fachada.js
// VIDRIO_PIEZA), su marco, su alféizar y su dintel; la puerta con su marco y su banderola, que ocupa el módulo entero; la
// vidriera con su toldo; el balcón; la ventana doble. Acá cada vano se agranda a lo que de verdad ocupa su pieza —y, donde
// el 3D elige entre varias, a la mayor—, y la franja del zócalo de la planta baja tampoco es pared. Así lo pintable es
// sólo muro liso, en el plano y en el 3D.
const MOD=2,CERCO=.16;// (m: el módulo de fachada; y lo que rodea al vidrio: marco de 8 cm, alféizar y dintel)
const estiloDe=L=>{try{return facadeStyle(L.fachada||{estilo:'casona'});}catch{return facadeStyle({estilo:'casona'});}};
// El vidrio de la pieza de una ventana del plano: [x0, x1, y0, y1] desde el centro de su módulo y desde su piso.
function vidrioDe(fs,w,nivel,len){if(w.pieza==='ventanal')return [VIDRIO_VENTANAL];const P=w.pieza&&WINDOWS[w.pieza]?[WINDOWS[w.pieza].p]:nivel<=1&&len>=1?[fs.win1,fs.win]:[fs.win,fs.win1];
 return P.map(p=>VIDRIO_PIEZA[p]).filter(Boolean);}
// Lo que ocupa un vano de fachada, alrededor de su centro c (a lo largo) y desde `base` (su piso): rectángulos en metros.
function ocupaVano(L,fs,v,nivel,base,sube,cercaDeCalle){const c=(v.u0+v.u1)/2,m0=Math.floor(c/MOD+1e-6)*MOD,m1=m0+MOD,out=[];
 if(v.clase==='puerta'){out.push({u0:Math.min(m0,v.u0-.2),u1:Math.max(m1,v.u1+.2),y0:0,y1:sube+3,clase:'puerta'});return out;}
 // (en la planta baja de lo que no es vivienda —oficinas, hoteles, lo público— toda ventana es una vidriera: medidas.js esVidriera)
 if(v.clase==='vidriera'||nivel===0&&esVidriera(L.type,{shop:false})){out.push({u0:m0,u1:m1,y0:0,y1:sube+3,clase:'vidriera'});return out;}
 for(const G of vidrioDe(fs,v,nivel,v.u1-v.u0))out.push({u0:c+G[0]-CERCO,u1:c+G[1]+CERCO,y0:base+G[2]-CERCO-.08,y1:base+G[3]+CERCO+.1,clase:'ventana'});
 if(!out.length)out.push({u0:v.u0-CERCO,u1:v.u1+CERCO,y0:base+.3,y1:base+2.8,clase:'ventana'});
 // (el balcón —de la segunda planta para arriba— es una puerta con su losa y sus barandas; la doble une dos módulos)
 if(fs.balconies&&nivel>=2)out.push({u0:m0-.1,u1:m1+.1,y0:base-.3,y1:base+3,clase:'balcon'});
 if(fs.double&&nivel>=1)out.push({u0:m0,u1:m1,y0:base,y1:base+2.65,clase:'doble'});
 return out;}
export const ZOCALO_ALTO=.8;
// LO QUE OCUPA CADA MÓDULO, EXACTO (2026-11-21): el plano ya trae qué va en cada módulo de cada fachada (L.modulos,
// engine/fachada-piezas.js: lo mismo que arma el 3D, comprobado por validar-fachada-piezas). De ahí sale cada hueco sin
// adivinar: el vidrio de ESA pieza con su cerco; el módulo entero si es puerta, vidriera o balcón; la doble, centrada en
// la junta de sus dos módulos. huecosDeLinea da los de una línea de fachada en un piso: {t0, t1 (a lo largo de la línea,
// en metros del plano), y0, y1 (desde ese piso), clase}.
const CELDA=6;
export function huecosDeLinea(L,horiz,linea,nivel){const out=[];for(const m of L.modulos||[]){if(m.f!==nivel||(m.dy!==0)!==horiz)continue;const ex=(m.x+.5+m.dx*.5)*CELDA,ez=(m.y+.5+m.dy*.5)*CELDA;if(Math.abs((horiz?ez:ex)-linea)>.01)continue;
  const tx=m.dy,tz=-m.dx,c=-CELDA/2+1+2*m.k,c0=horiz?ex+tx*c:ez+tz*c,sg=horiz?tx:tz,pon=(a,b,y0,y1,clase)=>out.push({t0:Math.min(a,b),t1:Math.max(a,b),y0,y1,clase});
  // (lo que ocupa: engine/fachada-piezas.js vanoDeModulo, la única cuenta; acá sólo se lleva a la línea de la fachada)
  const v=vanoDeModulo(m);if(v)pon(c0+v[0]*sg,c0+v[1]*sg,v[2],v[3],m.tipo==='puerta_doble'||m.tipo==='porton'?'puerta':m.tipo);}
 return out;}
function huecosDeFachada(L,F){const fs=estiloDe(L),out=[{u0:0,u1:F.ancho,y0:0,y1:F.sube+ZOCALO_ALTO,clase:'zocalo'}];
 if(L.modulos){const {horiz,inv,linea,o}=F.eje;
  for(const P of F.pisos)for(const q of huecosDeLinea(L,horiz,linea,P.nivel)){if(q.t1<=o+.01||q.t0>=o+F.ancho-.01)continue;/* (de otro tramo de la misma línea) */const a=q.t0-o,b=q.t1-o,suelo=P.nivel===0&&(q.clase==='puerta'||q.clase==='vidriera');out.push({u0:inv?F.ancho-b:a,u1:inv?F.ancho-a:b,y0:suelo?0:P.base+q.y0,y1:P.base+q.y1,clase:q.clase});}}
 // (un plano de antes, sin L.modulos: lo de siempre, tomando la pieza mayor)
 else for(const P of F.pisos)for(const v of P.vanos)out.push(...ocupaVano(L,fs,v,P.nivel,P.base,F.sube));
 return out.map(h=>({u0:r3(Math.max(0,h.u0)),u1:r3(Math.min(F.ancho,h.u1)),y0:r3(Math.max(0,h.y0)),y1:r3(Math.min(F.alto,h.y1)),clase:h.clase})).filter(h=>h.u1-h.u0>.01&&h.y1-h.y0>.01);}

export function muroExterior(L,lado){const F=fachadaMedida(L,lado),a=F.punto(0),b=F.punto(F.ancho),huecos=huecosDeFachada(L,F);
 return {id:`L${L.id}-${F.codigo}`,clase:'exterior',lote:L.id,lado:F.lado,codigo:F.codigo,recta:F.eje.recta,eje:F.eje,ancho:F.ancho,alto:F.alto,huecos,c:{x:r3((a.x+b.x)/2),z:r3((a.z+b.z)/2)},n:NORMAL[F.lado],y0:0,sale:SALE.exterior,color:L.colores?.fachada||null,nombre:`Fachada ${({N:'norte',S:'sur',E:'este',W:'oeste'})[F.lado]}${F.eje.recta?' '+(F.eje.recta+1):''}`};}

// Las cuatro paredes de un cuarto. dentroDelLote(x, z): para saber si del otro lado de la pared hay edificio (un tabique)
// o es la fachada (más gruesa hacia adentro).
// enOtroLote(x, z): si ese punto es de otro edificio (entonces la pared es una medianera, no la fachada).
export function murosDeCuarto(L,nivel,q,enOtroLote=null){const fs=estiloDe(L),sube=L.fachada?.escalinata?RAISE:0,lv=L.levels[nivel],dentro=(x,z)=>(L.parts||[]).some(p=>x>p.x&&x<p.x+p.w&&z>p.y&&z<p.y+p.h),H=ALTURA.cieloRaso,out=[];
 for(const P of paredesDe(q)){const ancho=r3(P.a1-P.a0),n=P.hacia,ry=Math.atan2(n[0],n[1]),dir=P.horiz?Math.cos(ry):-Math.sin(ry);// (dir: +1 si u crece con la coordenada a lo largo de la pared)
  const c=P.horiz?{x:r3((P.a0+P.a1)/2),z:P.fija}:{x:P.fija,z:r3((P.a0+P.a1)/2)},aU=t=>dir>0?t-P.a0:P.a1-t;
  // (los vanos de esta pared, con lo que de verdad ocupan: una puerta de adentro, su hoja y su marco; una puerta de
  // calle o una vidriera, su módulo entero; una ventana, el vidrio de su pieza —la misma cuenta que por afuera—)
  const crudos=[...(lv.doors||[]).map(d=>({d,puerta:true})),...(lv.windows||[]).map(d=>({d}))].filter(({d})=>P.horiz?Math.abs(d.y0-P.fija)<.2&&Math.abs(d.y1-P.fija)<.2:Math.abs(d.x0-P.fija)<.2&&Math.abs(d.x1-P.fija)<.2),huecos=[];
  // (si esta pared es de fachada y el plano trae sus módulos: los huecos exactos de esa línea; las puertas de adentro siguen)
  const deLinea=L.modulos?huecosDeLinea(L,P.horiz,P.fija,nivel).filter(q=>q.t1>P.a0+.01&&q.t0<P.a1-.01):[];
  for(const q of deLinea){const a=aU(Math.max(P.a0,q.t0)),b=aU(Math.min(P.a1,q.t1));huecos.push({u0:r3(Math.max(0,Math.min(a,b))),u1:r3(Math.min(ancho,Math.max(a,b))),y0:r3(Math.max(0,q.y0)),y1:r3(Math.min(H,q.y1)),clase:q.clase});}
  const esDeFachada=L.modulos&&(L.modulos.some(m=>(m.dy!==0)===P.horiz&&Math.abs((P.horiz?(m.y+.5+m.dy*.5):(m.x+.5+m.dx*.5))*CELDA-P.fija)<.01));
  for(const {d,puerta} of crudos){if(esDeFachada&&(!puerta||d.street))continue;const p=P.horiz?Math.min(d.x0,d.x1):Math.min(d.y0,d.y1),qq=P.horiz?Math.max(d.x0,d.x1):Math.max(d.y0,d.y1);if(qq<=P.a0+.01||p>=P.a1-.01)continue;const cu=aU((p+qq)/2),len=qq-p,pon=(a,b,y0,y1,clase)=>huecos.push({u0:r3(Math.max(0,a)),u1:r3(Math.min(ancho,b)),y0:r3(Math.max(0,y0)),y1:r3(Math.min(H,y1)),clase});
   if(puerta){if(d.street)pon(cu-Math.max(1,len/2+.2),cu+Math.max(1,len/2+.2),0,H,'puerta');else pon(cu-len/2-.1,cu+len/2+.1,0,2.3,'puerta');}
   else if(d.shop||nivel===0&&esVidriera(L.type,d))pon(cu-1,cu+1,0,H,'vidriera');
   else{const Gs=vidrioDe(fs,d,nivel,len);if(!Gs.length)pon(cu-len/2-CERCO,cu+len/2+CERCO,.3,2.8,'ventana');for(const G of Gs)pon(cu+G[0]-CERCO,cu+G[1]+CERCO,G[2]-CERCO-.08,G[3]+CERCO+.1,'ventana');if(fs.balconies&&nivel>=2||fs.double&&nivel>=1)pon(cu-1,cu+1,0,H,'ventana');}}
  for(let i=huecos.length-1;i>=0;i--)if(huecos[i].u1-huecos[i].u0<=.01||huecos[i].y1-huecos[i].y0<=.01)huecos.splice(i,1);
  const ox=c.x-n[0]*.3,oz=c.z-n[1]*.3,sale=dentro(ox,oz)?SALE.tabique:enOtroLote?.(ox,oz)?SALE.medianera:SALE.fachada;
  out.push({id:`L${L.id}-P${nivel}-C${q.id}-${P.lado}`,clase:'interior',tipo:q.type,lote:L.id,nivel,cuarto:q.id,lado:P.lado,ancho,alto:H,huecos,c,n,y0:r3(sube+nivel*ALTURA.piso+.02),sale,color:L.colores?.cuartos?.[nivel+':'+q.id]||null,nombre:`Pared ${({N:'norte',S:'sur',E:'este',W:'oeste'})[P.lado]}`});}
 return out;}

// LAS PAREDES DE UNA FACHADA. Los cortes a lo ancho son los bordes de lo que hay detrás en ese piso (cuartos, pasillos,
// núcleo) que tocan la línea de la fachada, llevados a la grilla de píxeles —así cada pared tiene píxeles enteros y la
// fachada es exactamente la suma de sus paredes—; un tramo de menos de MIN_PARED se une al de al lado.
export const MIN_PARED=.5;
export function paredesDeFachada(L,lado){const F=muroExterior(L,lado),px=GRAFITI.px,H=ALTURA.piso,sube=L.fachada?.escalinata?RAISE:0,{horiz,inv,linea,o}=F.eje,r={x:o,y:o},out=[];lado=F.lado;
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
   out.push({id:`L${L.id}-${F.codigo}-P${nivel}-T${k}`,clase:'exterior',lote:L.id,lado,codigo:F.codigo,recta:F.eje.recta,nivel,tramo:k,u0,u1,ancho:r3(u1-u0),alto:r3(y1-y0),huecos,c:{x:r3((a.x+b.x)/2),z:r3((a.z+b.z)/2)},n:F.n,y0,sale:SALE.exterior,color:F.color,nombre:`Pared ${k+1} del piso ${nivel}, fachada ${({N:'norte',S:'sur',E:'este',W:'oeste'})[lado]}`});}}
 return out;}
// Todas las paredes de un edificio, enumeradas (lo que listaría una base de datos): las de sus cuatro fachadas y las
// cuatro caras de cada cuarto. Un tabique entre dos cuartos aparece dos veces: una cara por cuarto.
export function paredesDelEdificio(bp,L){const otro=otroLoteDe(bp,L),out=tramosDe(L).flatMap(t=>paredesDeFachada(L,t.codigo));L.levels.slice(0,L.floors).forEach((lv,nivel)=>{for(const q of lv.rooms)out.push(...murosDeCuarto(L,nivel,q,otro));});return out;}

// La fachada entera como UN lienzo armado con lo guardado en cada una de sus paredes, y al revés: lo pintado de corrido,
// repartido en sus paredes. guardados: {id: {cols, rows, t}}. componer devuelve null si no hay nada pintado.
const cajaDe=(F,Z,P)=>{const c0=Math.round(P.u0/Z.px),c1=Math.round(P.u1/Z.px),f0=Z.rows-Math.round((P.y0+P.alto)/Z.px),f1=Z.rows-Math.round(P.y0/Z.px);return {c0,c1,f0:Math.max(0,f0),f1:Math.min(Z.rows,f1)};};
export function componerFachada(L,lado,guardados,paredes=paredesDeFachada(L,lado)){const F=muroExterior(L,lado),Z=lienzoDe(F),g=vacio(Z.cols,Z.rows);let hay=false;
 for(const P of paredes){const s=guardados?.[P.numero||P.id];if(!s?.t)continue;const B=cajaDe(F,Z,P),w=B.c1-B.c0,h=B.f1-B.f0;if(s.cols!==w||s.rows!==h)continue;const p=deTexto(s.t,w,h);if(!p)continue;for(let f=0;f<h;f++)g.d.set(p.d.subarray(f*w,(f+1)*w),(B.f0+f)*Z.cols+B.c0);hay=true;}
 return hay?g:null;}
export function partirFachada(L,lado,g,paredes=paredesDeFachada(L,lado)){const F=muroExterior(L,lado),Z=lienzoDe(F),out={};
 for(const P of paredes){const B=cajaDe(F,Z,P),w=B.c1-B.c0,h=B.f1-B.f0,p=vacio(w,h);let n=0;for(let f=0;f<h;f++){const fila=g.d.subarray((B.f0+f)*Z.cols+B.c0,(B.f0+f)*Z.cols+B.c1);p.d.set(fila,f*w);for(const v of fila)if(v)n++;}out[P.numero||P.id]=n?{cols:w,rows:h,t:aTexto(p)}:null;}
 return out;}

// El muro de un identificador (lo que guarda un grafiti), o null si esa ciudad no lo tiene.
export function muroDe(bp,id){if(/^\d{10}$/.test(String(id)))return paredDeNumero(bp,String(id));const m=/^L(\d+)-(?:([NSEW]\d*)(?:-P(\d+)-T(\d+))?|P(\d+)-C(\d+)-([NSEW]))$/.exec(id);if(!m)return null;const L=bp.lots[+m[1]];if(!L?.levels?.length)return null;
 if(m[2])return m[3]!=null?paredesDeFachada(L,m[2]).find(P=>P.nivel===+m[3]&&P.tramo===+m[4])||null:muroExterior(L,m[2]);m[3]=m[5];m[4]=m[6];m[5]=m[7];const nivel=+m[3],q=L.levels[nivel]?.rooms.find(q=>q.id===+m[4]);return q?murosDeCuarto(L,nivel,q,otroLoteDe(bp,L)).find(w=>w.lado===m[5])||null:null;}
// ¿Ese punto del plano es de otro edificio que no sea L?
export const otroLoteDe=(bp,L)=>(x,z)=>bp.lots.some(o=>o!==L&&o.id!==L.id&&(o.parts||[]).some(p=>x>p.x&&x<p.x+p.w&&z>p.y&&z<p.y+p.h));
// La pared de un cuarto más cercana a un punto del plano de ese piso (para elegirla con un clic).
export function muroCerca(L,nivel,q,x,z,enOtroLote=null){const P=paredesDe(q).map(P=>({P,d:Math.abs((P.horiz?z:x)-P.fija)})).sort((a,b)=>a.d-b.d)[0].P;return murosDeCuarto(L,nivel,q,enOtroLote).find(w=>w.lado===P.lado);}

// LAS PAREDES QUE SE PINTAN, CON SU NÚMERO (2026-11-21, Miguel: «la que vale la pena es sólo la pared que no tiene
// puertas ni ventanas», «sin baños», y «un identificador número de varias cifras: la cuadra, el edificio o casa, el piso
// y las paredes»).
//   Pintable: una pared sin ningún vano (el zócalo de la planta baja no cuenta: se pinta de ahí para arriba), que no es
//   la cara de adentro de un baño ni una pared de fachada tapada por el edificio de al lado.
//   El número, de 10 cifras: CCC EE PP WWW
//     CCC la cuadra (1…: las manzanas de la ciudad que tienen edificios, en su orden);
//     EE  el edificio dentro de su cuadra (1…, en el orden de sus lotes);
//     PP  el piso (00 la planta baja);
//     WWW la pared dentro de ese piso (1…): primero las de fachada —norte, este, sur, oeste, de izquierda a derecha— y
//         después las caras de cada cuarto, por cuarto y en ese mismo orden de lados.
//   Sale sólo del plano, siempre en el mismo orden: la misma ciudad da los mismos números. Si cambia el generador, la
//   ciudad cambia y sus paredes se renumeran: lo guardado tiene que llevar de qué versión de la ciudad es.
//   Medido en la ciudad de 720 m: 83 cuadras, hasta 22 edificios por cuadra, 8 pisos y 82 paredes pintables por piso.
// Las casas del monte todavía no entran (sus manzanas irían después de las de la ciudad).
export const BANOS=new Set(['bano','sanitario']),ORDEN_LADO={N:0,E:1,S:2,W:3};
export const esPintable=w=>!(w.huecos||[]).some(h=>h.clase!=='zocalo')&&!(w.clase==='interior'&&BANOS.has(w.tipo));
const cuadras=new WeakMap();
const cuadraDe=(bp,L)=>{let M=cuadras.get(bp);if(!M){const ids=[...new Set(bp.lots.filter(o=>o.levels?.length).map(o=>o.block))].sort((a,b)=>a-b);M={c:new Map(ids.map((b,i)=>[b,i+1])),e:new Map()};for(const b of ids)bp.lots.filter(o=>o.block===b&&o.levels?.length).sort((x,y)=>x.id-y.id).forEach((o,i)=>M.e.set(o.id,i+1));cuadras.set(bp,M);}return {cuadra:M.c.get(L.block),edificio:M.e.get(L.id),M};};
const dos=(n,k)=>String(n).padStart(k,'0');
// Las paredes pintables de un edificio, cada una con su `numero` (y cuadra, edificio, piso, pared, por separado).
export function paredesPintables(bp,L){const {cuadra,edificio}=cuadraDe(bp,L);if(!cuadra)return [];const out=[],porPiso=new Map();
 // (una pared de fachada pegada a otro edificio que llega a ese piso —una medianera— no se ve: no cuenta; la que asoma
 // por encima de un vecino más bajo, sí)
 const tapada=w=>{if(w.clase!=='exterior')return false;const x=w.c.x+w.n[0]*.3,z=w.c.z+w.n[1]*.3;return bp.lots.some(o=>o.id!==L.id&&o.floors>w.nivel&&(o.parts||[]).some(p=>x>p.x&&x<p.x+p.w&&z>p.y&&z<p.y+p.h));};
 for(const w of paredesDelEdificio(bp,L)){if(!esPintable(w)||tapada(w))continue;(porPiso.get(w.nivel)||porPiso.set(w.nivel,[]).get(w.nivel)).push(w);}
 for(const [nivel,ws] of [...porPiso].sort((a,b)=>a[0]-b[0])){ws.sort((a,b)=>(a.clase==='exterior'?0:1)-(b.clase==='exterior'?0:1)||(a.clase==='exterior'?ORDEN_LADO[a.lado]-ORDEN_LADO[b.lado]||a.recta-b.recta||a.tramo-b.tramo:a.cuarto-b.cuarto||ORDEN_LADO[a.lado]-ORDEN_LADO[b.lado]));
  ws.forEach((w,i)=>out.push({...w,cuadra,edificio,piso:nivel,pared:i+1,numero:dos(cuadra,3)+dos(edificio,2)+dos(nivel,2)+dos(i+1,3)}));}
 return out;}
// De un número a su pared (o null): se busca el edificio por su cuadra y su lugar, y la pared entre las suyas.
export function paredDeNumero(bp,numero){const t=String(numero);if(!/^\d{10}$/.test(t))return null;const c=+t.slice(0,3),e=+t.slice(3,5);cuadraDe(bp,bp.lots.find(o=>o.levels?.length)||bp.lots[0]);const M=cuadras.get(bp);if(!M)return null;
 const L=bp.lots.find(o=>o.levels?.length&&M.c.get(o.block)===c&&M.e.get(o.id)===e);return L?paredesPintables(bp,L).find(w=>w.numero===t)||null:null;}
// Las de una ciudad entera.
export const paredesDeLaCiudad=bp=>bp.lots.filter(L=>L.levels?.length).flatMap(L=>paredesPintables(bp,L));

// LA FACHADA, CON LO QUE SE PINTA Y LO QUE NO (2026-11-21, Miguel: «quiero ver cómo queda una fachada con las paredes que
// se pintan de un color: blanco lo que sí, gris lo que no»). Devuelve el muro entero de ese lado con, como huecos, todo lo
// que no se pinta —los vanos, el zócalo y las paredes enteras que tienen algún vano o están tapadas— y la lista de sus
// paredes pintables con su número. mascaraDe(muro) da el mapa píxel por píxel (1: se pinta).
export function fachadaPintable(bp,L,lado){const M=muroExterior(L,lado),paredes=paredesPintables(bp,L).filter(w=>w.clase==='exterior'&&w.codigo===M.codigo),ids=new Set(paredes.map(w=>w.id));
 return {...M,huecos:[...M.huecos,...paredesDeFachada(L,lado).filter(w=>!ids.has(w.id)).map(w=>({u0:w.u0,u1:w.u1,y0:w.y0,y1:r3(w.y0+w.alto),clase:'con vanos'}))],paredes};}
