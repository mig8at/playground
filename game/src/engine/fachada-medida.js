// LA FACHADA, MEDIDA (2026-11-21, Miguel: «trabajá en el 2D para definir los espacios exactos, calculados
// matemáticamente, de las fachadas»).
//
// Una fachada es un rectángulo de `ancho` × `alto` metros. Esto dice, en metros y sin dibujar nada, qué hay en cada parte:
//   · los VANOS de cada piso (ventanas, vidrieras, puertas), con su antepecho y su dintel;
//   · los PAÑOS: el muro entre vano y vano, de piso a piso —lo que lleva la textura y, en la planta baja, lo que se
//     puede pintar (los grafitis)—;
//   · la TEXTURA del muro, la misma que usa el 3D: sale de la familia de la fachada y de su color, sin azar;
//   · cómo CUADRA esa textura: una baldosa mide MODULO.lado (2 m, lo que mide una pieza de fachada) y cada textura tiene
//     su hilada; un piso de 3 m tiene un número entero de hiladas de todas, así la junta cae justo en la línea del piso.
// El plano 2D (el alzado) y el 3D leen de acá: lo que se ve en uno es lo que se arma en el otro.
import {ALTURA} from './medidas.js';
import {RAISE} from './fachada.js';

export const MODULO={lado:2};
// (antepecho y dintel de cada clase de vano, en metros sobre su piso)
export const VANO={comun:[.9,2.2],ventanal:[.9,2.7],vidriera:[.35,2.6],puerta:[0,2.2]};
// Las texturas de muro de cada familia de fachada (lib/texturas3d.js las dibuja) y la hilada de cada una, en metros.
export const TEXTURA_MURO={ladrillo:['ladrillo','ladrillo','ladrillo_pintado','estuco'],piedra:['sillar','sillar','hormigon','estuco'],metal:['panel','hormigon','panel','tablilla']};
export const HILADA={ladrillo:.0625,ladrillo_pintado:.0625,sillar:.25,panel:1,hormigon:.25,tablilla:1/6,estuco:null};
export function texturaDeMuro(familia,color){const L=TEXTURA_MURO[familia]||TEXTURA_MURO.ladrillo;let h=2166136261;for(const ch of String(color||'').toLowerCase())h=Math.imul(h^ch.charCodeAt(0),16777619);return L[(h>>>0)%L.length];}
// Lo pintable de la planta baja: del zócalo al dintel de las vidrieras, y sólo paños de este ancho o más.
export const PINTABLE={y0:.8,y1:2.6,anchoMin:1};

const r3=v=>Math.round(v*1000)/1000;
// lado: 'N' | 'S' | 'E' | 'W'. u corre de izquierda a derecha mirando la fachada de frente.
// LOS TRAMOS DE FACHADA (2026-11-21, refinando: «los edificios que no son un rectángulo simple»). Un edificio en L no
// tiene cuatro fachadas: tiene seis rectas. Un TRAMO es una recta del contorno del edificio: casillas seguidas, en la
// misma línea y mirando hacia el mismo lado. Su código es el lado y su número —N0, N1, E0…—, ordenados por línea y por
// dónde empiezan; en un rectángulo son N0, E0, S0 y W0. Hasta acá cada lado se medía por el rectángulo que envuelve al
// edificio: en una L eso daba por fachada un tramo donde no hay edificio y se salteaba el rincón (medido: 26 de 75
// edificios de la ciudad chica son en L, y el 13 % de sus módulos de fachada quedaba afuera).
//   {codigo, lado, horiz, inv, linea, o (dónde empieza, en metros del plano), ancho}
const CASILLA=6,LADO_DE={'0,-1':'N','0,1':'S','1,0':'E','-1,0':'W'},tramosCache=new WeakMap();
export function tramosDe(L){let T=tramosCache.get(L);if(T)return T;const dentro=new Set();for(const p of L.parts||[])for(let y=p.y/CASILLA;y<(p.y+p.h)/CASILLA;y++)for(let x=p.x/CASILLA;x<(p.x+p.w)/CASILLA;x++)dentro.add(x+','+y);
 const porLinea=new Map();for(const k of dentro){const [x,y]=k.split(',').map(Number);for(const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0]]){if(dentro.has((x+dx)+','+(y+dy)))continue;const lado=LADO_DE[dx+','+dy],linea=dy?(y+.5+dy*.5)*CASILLA:(x+.5+dx*.5)*CASILLA,kk=lado+'|'+linea;(porLinea.get(kk)||porLinea.set(kk,[]).get(kk)).push(dy?x:y);}}
 T=[];for(const [kk,is] of porLinea){const [lado,linea]=kk.split('|');is.sort((a,b)=>a-b);let i0=is[0],prev=is[0];const cierra=()=>T.push({lado,linea:+linea,o:i0*CASILLA,ancho:(prev-i0+1)*CASILLA,horiz:lado==='N'||lado==='S',inv:lado==='N'||lado==='E'});for(const i of is.slice(1)){if(i!==prev+1){cierra();i0=i;}prev=i;}cierra();}
 const n={};T.sort((a,b)=>'NESW'.indexOf(a.lado)-'NESW'.indexOf(b.lado)||a.linea-b.linea||a.o-b.o);for(const t of T){t.recta=n[t.lado]=(n[t.lado]??-1)+1;t.codigo=t.lado+t.recta;}tramosCache.set(L,T);return T;}
// El tramo de un código («N0»); con sólo la letra («N», lo de antes), el más largo de ese lado.
export function ejeDe(L,codigo){const T=tramosDe(L),c=String(codigo||L.front||'S');return T.find(t=>t.codigo===c)||T.filter(t=>t.lado===c[0]).sort((a,b)=>b.ancho-a.ancho)[0]||T[0];}

export function fachadaMedida(L,lado=L.front){const E=ejeDe(L,lado),H=ALTURA.piso,{horiz,ancho,linea,inv,o}=E,sube=L.fachada?.escalinata?RAISE:0;lado=E.lado;
 // (un vano es de este tramo si está sobre su línea y su centro cae dentro de él)
 const enLado=w=>{const c=horiz?(w.x0+w.x1)/2:(w.y0+w.y1)/2;return c>o-.01&&c<o+ancho+.01&&(horiz?Math.abs(w.y0-linea)<.3&&Math.abs(w.y1-linea)<.3:Math.abs(w.x0-linea)<.3&&Math.abs(w.x1-linea)<.3);};
 const tramo=w=>{const a=(horiz?w.x0:w.y0)-o,b=(horiz?w.x1:w.y1)-o,u0=Math.max(0,Math.min(a,b)),u1=Math.min(ancho,Math.max(a,b));return inv?[r3(ancho-u1),r3(ancho-u0)]:[r3(u0),r3(u1)];};
 // de u (a lo largo de la fachada) a un punto del plano, para ubicar un paño en la ciudad
 const punto=u=>{const t=inv?ancho-u:u;return horiz?{x:r3(o+t),z:linea}:{x:linea,z:r3(o+t)};};
 const color=L.colores?.fachada||null,textura=texturaDeMuro(L.fachada?.familia,color),hilada=HILADA[textura],pisos=[];
 for(let i=0;i<L.floors;i++){const lv=L.levels[i],base=sube+i*H,vanos=[];
  for(const w of (lv.windows||[]).filter(enLado)){const clase=w.shop?'vidriera':w.pieza==='ventanal'?'ventanal':'comun',[u0,u1]=tramo(w),[p,q]=VANO[clase];vanos.push({clase,u0,u1,y0:r3(base+p),y1:r3(base+q)});}
  if(i===0)for(const d of (lv.doors||[]).filter(d=>d.street&&enLado(d))){const [u0,u1]=tramo(d);vanos.push({clase:'puerta',u0,u1,y0:r3(sube),y1:r3(sube+VANO.puerta[1])});}
  vanos.sort((a,b)=>a.u0-b.u0);
  // los paños: lo que queda del ancho entre vano y vano, de piso a piso
  const panios=[];let u=0;for(const v of vanos){if(v.u0-u>.001)panios.push({u0:r3(u),u1:v.u0,y0:r3(base),y1:r3(base+H)});u=Math.max(u,v.u1);}if(ancho-u>.001)panios.push({u0:r3(u),u1:ancho,y0:r3(base),y1:r3(base+H)});
  const vidrio=vanos.reduce((a,v)=>a+(v.u1-v.u0)*(v.y1-v.y0),0),ciego=panios.reduce((a,p)=>a+(p.u1-p.u0),0);
  pisos.push({nivel:i,base:r3(base),vanos,panios,vidrio:r3(vidrio/(ancho*H)),ciego:r3(ciego/ancho)});}
 return {lote:L.id,lado,codigo:E.codigo,eje:E,ancho,alto:r3(L.floors*H+sube),sube,color,familia:L.fachada?.familia||null,textura,hilada,hiladasPorPiso:hilada?r3(H/hilada):null,modulos:r3(ancho/MODULO.lado),pisos,punto};}

// Los lados de un edificio que dan a la calle: los que tienen una puerta de calle o una vidriera en la planta baja.
// (devuelve los CÓDIGOS de los tramos —N0, E1…—: los que tienen una puerta de calle o una vidriera en la planta baja)
export function ladosDeCalle(L){return tramosDe(L).map(t=>t.codigo).filter(l=>fachadaMedida(L,l).pisos[0]?.vanos.some(v=>v.clase==='puerta'||v.clase==='vidriera'));}

// Los paños pintables de una ciudad (los grafitis): en la planta baja de cada lado de calle, el muro entre vano y vano,
// del zócalo al dintel. Cada uno con su edificio, su lado, su tramo, su alto y dónde queda en el plano.
export function paniosPintables(bp){const out=[];for(const L of bp.lots){if(!L.levels?.length)continue;for(const lado of ladosDeCalle(L)){const F=fachadaMedida(L,lado);
  for(const p of F.pisos[0].panios){const w=p.u1-p.u0;if(w<PINTABLE.anchoMin)continue;const a=F.punto(p.u0),b=F.punto(p.u1),y0=r3(F.sube+PINTABLE.y0),y1=r3(F.sube+PINTABLE.y1);
   out.push({id:`L${L.id}-${lado}-${Math.round(p.u0*100)}`,lote:L.id,edificio:L.shopName||L.name||null,lado,u0:p.u0,u1:p.u1,y0,y1,ancho:r3(w),alto:r3(y1-y0),area:r3(w*(y1-y0)),x0:a.x,z0:a.z,x1:b.x,z1:b.z,textura:F.textura});}}}
 return out;}
