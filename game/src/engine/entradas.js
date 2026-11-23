/* Las entradas de los lugares de la ciudad (2026-11-22: salieron de botin.js y guaridas.js —el juego de policías y
   ladrones, ahora en before/— porque las usa la ciudad: la gente que entra y sale de su casa —juego/transeuntes.js— y las
   viviendas del monte —viviendas.js—).
   · casaAMundo(h): el plano de una casa (hogar.js: u a lo ancho del frente, v desde el frente) llevado al mundo;
   · entradasLote(L): las puertas de afuera de un edificio (calle o patio), el punto a 0,6 m del lado de afuera;
   · entradasCasa(h): las de una casa del monte: la de calle y la de atrás, al patio. */
import {cuerpoCasa} from './circulacion.js';

export function casaAMundo(h){const P0=h.spec?.hogar,Wc=P0?.W??h.w,Dc=P0?.D??h.d,f=h.frente,dF=Dc-h.d/2;
 return (u,v)=>f==='S'?[h.x-Wc/2+u,h.z+dF-v]:f==='N'?[h.x+Wc/2-u,h.z-dF+v]:f==='W'?[h.x-dF+v,h.z-Wc/2+u]:[h.x+dF-v,h.z+Wc/2-u];}
export function entradasLote(L){const lv=L.levels?.find(l=>l.level===0);if(!lv)return [];const dentro=(x,z)=>L.parts.some(p=>x>p.x&&x<p.x+p.w&&z>p.y&&z<p.y+p.h);
 return lv.doors.filter(d=>d.street).map(d=>{const mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2,h=Math.abs(d.y0-d.y1)<1e-6;
  return (h?[[0,-.6],[0,.6]]:[[-.6,0],[.6,0]]).map(([a,b])=>[mx+a,mz+b]).find(([x,z])=>!dentro(x,z));}).filter(Boolean);}
export function entradasCasa(h){const c=cuerpoCasa(h),P=h.spec?.hogar,e=[[c.puerta.x+c.afuera.x*.6,c.puerta.z+c.afuera.z*.6]];if(!P)return e;
 const dp=P.levels[0].doors.find(d=>d.patio);if(dp){const q=P.levels[0].rooms.find(r=>r.id===dp.a)||{},out=Math.abs(dp.at-(q.v1??0))<.02?.6:-.6;e.push(casaAMundo(h)(dp.from+dp.len/2,dp.at+out));}
 return e;}
