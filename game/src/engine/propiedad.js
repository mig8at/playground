// LA PROPIEDAD (2026-11-22, Miguel: «los apartamentos y casas son privados: nadie puede entrar hasta que compre la
// propiedad»; y «las que no estén vendidas —en este caso todas— con las ventanas cerradas»). Una vivienda sin dueño tiene
// su puerta de entrada trancada (frena al jugador y su hoja no se abre), las persianas cerradas y, como nadie ve adentro,
// el 3D no arma su interior. La lista de viviendas y sus puertas es la de siempre (viviendas.js viviendasDe), la misma que
// usa el modo partida para las cerraduras; acá `abiertas` son las viviendas con dueño (hoy ninguna: todavía no se compra).
import {viviendasDe} from './viviendas.js';
import {esVivienda} from './entrega.js';

// {puertas, abiertas}: la misma forma que las cerraduras de la ronda (fuga/engine/ronda.js), para usar las mismas cuentas.
export function cerradurasDe(bp,duenos=[]){const vs=viviendasDe(bp);
 const puertas=vs.flatMap(v=>v.puertas.map((d,k)=>({id:`${v.id}#${k}`,vivienda:v.id,tipo:v.tipo,...d.puerta,x:d.x,z:d.z,casa:v.casa,lote:v.lote,nivel:v.nivel??0})));
 return {puertas,abiertas:new Set(duenos),viviendas:vs.length};}
// ¿la hoja que el 3D dibuja en (x, z) a la altura y es de una puerta trancada? (para que no se abra sola)
export function puertaTrancadaEn(R,x,z,y){for(const p of R.puertas){if(p.y==null||R.abiertas.has(p.vivienda)||Math.abs((y??p.y)-p.y)>1.6)continue;if(Math.hypot((p.x0+p.x1)/2-x,(p.z0+p.z1)/2-z)<.9)return true;}return false;}
// ¿la puerta trancada tapa el paso en (x, z) a la altura F? (el 3D dice la altura de cada puerta: p.y)
export function trancada(R,x,z,r,F){for(const p of R.puertas){if(p.y==null||R.abiertas.has(p.vivienda)||Math.abs(F-p.y)>1.2)continue;
 const x0=Math.min(p.x0,p.x1),x1=Math.max(p.x0,p.x1),z0=Math.min(p.z0,p.z1),z1=Math.max(p.z0,p.z1);if(x<x0-r||x>x1+r||z<z0-r||z>z1+r)continue;
 const dx=Math.max(x0-x,0,x-x1),dz=Math.max(z0-z,0,z-z1);if(Math.hypot(dx,dz)<r)return true;}return false;}
// ¿el punto (x, z) del piso f del lote es de una vivienda cerrada? (estrictamente adentro de uno de sus cuartos: la hoja
// de la puerta de entrada, sobre el tabique, no lo es). Para no armar lo de adentro.
export function adentroCerrado(bp,R){const porLote=new Map();
 for(const L of bp.lots){if(!L.levels)continue;L.levels.forEach((lv,f)=>{for(const q of lv.rooms){if(!esVivienda(L,q))continue;const v=q.unit!=null?`L${L.id}:${q.unit}`:`L${L.id}:casa`;
   (porLote.get(L.id)||porLote.set(L.id,[]).get(L.id)).push({f,q,v});}});}
 return (lot,f,x,z)=>{for(const e of porLote.get(lot)||[]){if(e.f!==f)continue;const q=e.q;if(x>q.x+.05&&x<q.x+q.w-.05&&z>q.y+.05&&z<q.y+q.h-.05)return !R.abiertas.has(e.v);}return false;};}
