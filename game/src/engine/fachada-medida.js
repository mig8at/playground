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
export function fachadaMedida(L,lado=L.front){const r=L.rect,H=ALTURA.piso,horiz=lado==='N'||lado==='S',ancho=horiz?r.w:r.h,sube=L.fachada?.escalinata?RAISE:0;
 const linea=lado==='N'?r.y:lado==='S'?r.y+r.h:lado==='W'?r.x:r.x+r.w,enLado=w=>horiz?Math.abs(w.y0-linea)<.3&&Math.abs(w.y1-linea)<.3:Math.abs(w.x0-linea)<.3&&Math.abs(w.x1-linea)<.3;
 const inv=lado==='N'||lado==='E',tramo=w=>{const a=horiz?w.x0-r.x:w.y0-r.y,b=horiz?w.x1-r.x:w.y1-r.y,u0=Math.min(a,b),u1=Math.max(a,b);return inv?[r3(ancho-u1),r3(ancho-u0)]:[r3(u0),r3(u1)];};
 // de u (a lo largo de la fachada) a un punto del plano, para ubicar un paño en la ciudad
 const punto=u=>{const t=inv?ancho-u:u;return horiz?{x:r3(r.x+t),z:linea}:{x:linea,z:r3(r.y+t)};};
 const color=L.colores?.fachada||null,textura=texturaDeMuro(L.fachada?.familia,color),hilada=HILADA[textura],pisos=[];
 for(let i=0;i<L.floors;i++){const lv=L.levels[i],base=sube+i*H,vanos=[];
  for(const w of (lv.windows||[]).filter(enLado)){const clase=w.shop?'vidriera':w.pieza==='ventanal'?'ventanal':'comun',[u0,u1]=tramo(w),[p,q]=VANO[clase];vanos.push({clase,u0,u1,y0:r3(base+p),y1:r3(base+q)});}
  if(i===0)for(const d of (lv.doors||[]).filter(d=>d.street&&enLado(d))){const [u0,u1]=tramo(d);vanos.push({clase:'puerta',u0,u1,y0:r3(sube),y1:r3(sube+VANO.puerta[1])});}
  vanos.sort((a,b)=>a.u0-b.u0);
  // los paños: lo que queda del ancho entre vano y vano, de piso a piso
  const panios=[];let u=0;for(const v of vanos){if(v.u0-u>.001)panios.push({u0:r3(u),u1:v.u0,y0:r3(base),y1:r3(base+H)});u=Math.max(u,v.u1);}if(ancho-u>.001)panios.push({u0:r3(u),u1:ancho,y0:r3(base),y1:r3(base+H)});
  const vidrio=vanos.reduce((a,v)=>a+(v.u1-v.u0)*(v.y1-v.y0),0),ciego=panios.reduce((a,p)=>a+(p.u1-p.u0),0);
  pisos.push({nivel:i,base:r3(base),vanos,panios,vidrio:r3(vidrio/(ancho*H)),ciego:r3(ciego/ancho)});}
 return {lote:L.id,lado,ancho,alto:r3(L.floors*H+sube),sube,color,familia:L.fachada?.familia||null,textura,hilada,hiladasPorPiso:hilada?r3(H/hilada):null,modulos:r3(ancho/MODULO.lado),pisos,punto};}

// Los lados de un edificio que dan a la calle: los que tienen una puerta de calle o una vidriera en la planta baja.
export function ladosDeCalle(L){return ['N','S','E','W'].filter(l=>fachadaMedida(L,l).pisos[0]?.vanos.some(v=>v.clase==='puerta'||v.clase==='vidriera'));}

// Los paños pintables de una ciudad (los grafitis): en la planta baja de cada lado de calle, el muro entre vano y vano,
// del zócalo al dintel. Cada uno con su edificio, su lado, su tramo, su alto y dónde queda en el plano.
export function paniosPintables(bp){const out=[];for(const L of bp.lots){if(!L.levels?.length)continue;for(const lado of ladosDeCalle(L)){const F=fachadaMedida(L,lado);
  for(const p of F.pisos[0].panios){const w=p.u1-p.u0;if(w<PINTABLE.anchoMin)continue;const a=F.punto(p.u0),b=F.punto(p.u1),y0=r3(F.sube+PINTABLE.y0),y1=r3(F.sube+PINTABLE.y1);
   out.push({id:`L${L.id}-${lado}-${Math.round(p.u0*100)}`,lote:L.id,edificio:L.shopName||L.name||null,lado,u0:p.u0,u1:p.u1,y0,y1,ancho:r3(w),alto:r3(y1-y0),area:r3(w*(y1-y0)),x0:a.x,z0:a.z,x1:b.x,z1:b.z,textura:F.textura});}}}
 return out;}
