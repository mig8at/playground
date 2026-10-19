// ======== Qué puertas llevan hoja (2026-10-16, idea de Miguel) ========
// conHoja(tipoA, tipoB): la regla de PUERTA.hoja (medidas.js) para una puerta entre dos espacios —tipos de cuarto, o
// 'pasillo', 'nucleo', 'escalera', 'calle'—. marcarHojas(bp): la deja en cada puerta del plano (d.hoja), en los edificios
// y en las casas; el 3D sólo la lee.
import {PUERTA} from './medidas.js';
const H=PUERTA.hoja,PRIV=new Set(H.privados),COM=new Set(H.comunes),ABI=new Set(H.abiertos);
export function conHoja(a,b){if(a==='calle'||b==='calle')return true;if(PRIV.has(a)||PRIV.has(b))return true;
 // la puerta de una unidad: de lo común a un cuarto que no es común ni abierto
 const ca=COM.has(a),cb=COM.has(b);if(ca!==cb){const otro=ca?b:a;return !ABI.has(otro);}
 return false;}
const A=PUERTA.abierta,SIEMPRE=new Set(A.siempre);
// un sorteo fijo por puerta (de sus coordenadas)
const sorteo=(x,z)=>{let h=Math.imul((Math.round(x*100)|0)^0x9e3779b9,0x85ebca6b)^Math.imul((Math.round(z*100)|0)+12347,0xc2b2ae35);h^=h>>>13;h=Math.imul(h,0x27d4eb2f);return ((h^(h>>>16))>>>0)/4294967296;};
// ¿queda abierta la hoja de una puerta al cuarto de tipo t, con centro (x,z)? (sin mirar los muebles)
export const quiereAbierta=(t,x,z)=>SIEMPRE.has(t)||(A.aVeces[t]!=null&&sorteo(x,z)<A.aVeces[t]);
// El cuarto de giro de una hoja: el cuadrado del ancho del vano, hacia adentro del cuarto. vano: [u0,u1] a lo largo, at la
// línea, s el lado del cuarto (±1); devuelve {x0,x1,z0,z1} con el eje del vano en x (h) o en z.
export function giroDe(h,u0,u1,at,s){const w=u1-u0,a=Math.min(at,at+s*w),b=Math.max(at,at+s*w);return h?{x0:u0,x1:u1,z0:a,z1:b}:{x0:a,x1:b,z0:u0,z1:u1};}
const choca=(g,muebles)=>muebles.some(m=>Math.min(g.x1,m.x1)-Math.max(g.x0,m.x0)>.02&&Math.min(g.z1,m.z1)-Math.max(g.z0,m.z0)>.02);
export function marcarHojas(bp){let con=0,sin=0;
 for(const L of [...bp.lots,...(bp.isla?.lots||[]).filter(l=>l.levels)])for(const lv of L.levels){const T=id=>id==='pasillo'||id==='calle'?id:lv.rooms.find(r=>r.id===id)?.type||'pasillo';
  const muebles=(lv.furniture||[]).filter(f=>f.kind!=='alfombra').map(f=>({x0:f.x,x1:f.x+f.w,z0:f.y,z1:f.y+f.h}));
  for(const d of lv.doors||[]){d.hoja=d.street?true:d.core||d.stair?false:conHoja(T(d.a),T(d.b));d.hoja?con++:sin++;
   // (abierta: el cuarto es el del lado a, o el b si a es el pasillo —como lo abre town3d—)
   d.abierta=false;if(!d.hoja||d.street)continue;const q=lv.rooms.find(r=>r.id===d.a)||lv.rooms.find(r=>r.id===d.b);if(!q)continue;
   const h=Math.abs(d.y1-d.y0)<1e-6,mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2;if(!quiereAbierta(q.type,mx,mz))continue;
   const at=h?d.y0:d.x0,s=Math.sign(h?q.y+q.h/2-at:q.x+q.w/2-at)||1,g=giroDe(h,h?Math.min(d.x0,d.x1):Math.min(d.y0,d.y1),h?Math.max(d.x0,d.x1):Math.max(d.y0,d.y1),at,s);
   d.abierta=!choca(g,muebles);}}
 // (las casas: los planos se comparten —planHogar—; la marca depende sólo de los tipos, así que es la misma para todas)
 for(const h of bp.isla?.casas||[]){const P=h.spec?.hogar;if(!P)continue;for(const lv of P.levels){const T=id=>id==='calle'?'calle':lv.rooms.find(r=>r.id===id)?.type||'pasillo';
  // (adentro de una casa el hall es interno: la única puerta de la unidad es la de calle)
  const muebles=(lv.furniture||[]).filter(f=>f.kind!=='alfombra').map(f=>({x0:f.u0,x1:f.u1,z0:f.v0,z1:f.v1}));
  for(const d of lv.doors||[]){d.hoja=d.open||d.patio?false:conHoja(T(d.a),T(d.b));d.abierta=false;if(!d.hoja||d.street)continue;// (la de atrás, al patio, la dibuja vivienda3d como la de calle: sin hoja de adentro)
   // (el cuarto, el del lado a —como lo arma vivienda.js—; el vano, a lo largo de u en v = at, o al revés)
   const q=lv.rooms.find(r=>r.id===d.a);if(!q)continue;const h=d.axis==='u',c=d.from+d.len/2;if(!quiereAbierta(q.type,h?c:d.at,h?d.at:c))continue;
   const s=Math.sign(h?(q.v0+q.v1)/2-d.at:(q.u0+q.u1)/2-d.at)||1;d.abierta=!choca(giroDe(h,d.from,d.from+d.len,d.at,s),muebles);}}}
 return {con,sin};}
