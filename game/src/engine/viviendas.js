// ======== Las viviendas (2026-10-17): los apartamentos y las casas como lugares de la ciudad ========
// Lo que se compra (engine/propiedad.js) y donde vive cada familia (sociedad.js). Lo mide validar-viviendas. Puro y
// determinista. (2026-11-22: sin lo del juego de policías y ladrones —lo robable de cada vivienda y el visor para espiar—,
// que quedó en before/)
//  · viviendasDe(bp): cada vivienda con su(s) puerta(s) de entrada —la del apartamento al pasillo; las de afuera de la
//    casa— y el punto de afuera, frente a cada una (a AFUERA m), hacia la puerta;
//  · enCasa(tramos, t): ¿hay gente? Los tramos de cada vivienda salen de las familias (sociedad.js ocupacionSociedad;
//    hasta el 2026-10-17 eran una tirada al azar por ronda).
import {cuerpoCasa} from './circulacion.js';
import {casaAMundo} from './entradas.js';

const AFUERA=.35;
// una puerta (segmento en el mundo) y de qué lado está afuera: el punto de afuera, frente a ella, y hacia dónde mira
const puertaDe=(x0,z0,x1,z1,afuera)=>{const mx=(x0+x1)/2,mz=(z0+z1)/2,h=Math.abs(z1-z0)<1e-6,[nx,nz]=(h?[[0,-1],[0,1]]:[[-1,0],[1,0]]).find(([a,b])=>afuera(mx+a*.3,mz+b*.3))||[0,0];
 return {puerta:{x0,z0,x1,z1},x:+(mx+nx*AFUERA).toFixed(2),z:+(mz+nz*AFUERA).toFixed(2),mira:{x:-nx,z:-nz}};};

export function viviendasDe(bp){const out=[];
 // los apartamentos: por piso de arriba, cada unidad y su puerta al pasillo (o al núcleo)
 bp.lots.forEach((L,li)=>{for(const lv of L.levels||[]){if(lv.level===0||!lv.units?.length)continue;
  for(const u of lv.units){const cuartos=lv.rooms.filter(r=>r.unit===u.n);if(!cuartos.length)continue;const ids=new Set(cuartos.map(r=>r.id)),dentro=(x,z)=>cuartos.some(r=>x>r.x&&x<r.x+r.w&&z>r.y&&z<r.y+r.h);
   // (la del ascensor —un penthouse, engine/duplex.js: llega directo a la casa— también es entrada, pero se llega en ascensor)
   const puertas=lv.doors.filter(d=>ids.has(d.a)!==ids.has(d.b)).map(d=>({...puertaDe(d.x0,d.y0,d.x1,d.y1,(x,z)=>!dentro(x,z)),...(d.a==='nucleo'||d.b==='nucleo'?{ascensor:true}:{})}));
   out.push({id:`L${li}:${u.n}`,tipo:'apto',lote:li,nivel:lv.level,apto:u.n,edificio:L.name,puertas,cuartos:cuartos.length});}}});
 // las casas de la ciudad (lotes «casa», 2026-10-17: antes no eran viviendas y su puerta se abría para cualquiera): una
 // sola planta, sus puertas a la calle (y al patio)
 bp.lots.forEach((L,li)=>{if(L.type!=='casa')return;const lv=L.levels?.find(l=>l.level===0);if(!lv)return;const cs=lv.rooms,dentro=(x,z)=>cs.some(r=>x>r.x&&x<r.x+r.w&&z>r.y&&z<r.y+r.h);
  const puertas=lv.doors.filter(d=>d.street||d.b==='calle'||d.patio).map(d=>puertaDe(d.x0,d.y0,d.x1,d.y1,(x,z)=>!dentro(x,z)));
  const dir=lv.doors.find(d=>d.street&&d.direccion)?.direccion?.texto||null;
  out.push({id:`L${li}:casa`,tipo:'casaLote',lote:li,nivel:0,direccion:dir,puertas,cuartos:cs.length});});
 // las casas del monte: la puerta de calle y la del patio
 (bp.isla?.casas||[]).forEach((h,ci)=>{const P=h.spec?.hogar;if(!P)return;const aM=casaAMundo(h),c=cuerpoCasa(h),dentro=(x,z)=>x>c.x0&&x<c.x1&&z>c.z0&&z<c.z1,puertas=[];
  for(const lv of P.levels.filter(l=>l.level===0))for(const d of lv.doors.filter(d=>d.street||d.b==='calle'||d.patio)){const [ax,az]=aM(...(d.axis==='u'?[d.from,d.at]:[d.at,d.from])),[bx,bz]=aM(...(d.axis==='u'?[d.from+d.len,d.at]:[d.at,d.from+d.len]));puertas.push(puertaDe(ax,az,bx,bz,(x,z)=>!dentro(x,z)));}
  out.push({id:`C${ci}`,tipo:'casa',casa:ci,direccion:h.direccion?.texto||null,puertas,cuartos:P.levels.reduce((a,l)=>a+l.rooms.length,0)});});
 return out;}

// quién está en casa: los tramos [t0, t1, conGente] de una vivienda (sociedad.js ocupacionSociedad), en el segundo t
export const enCasa=(tramos,t)=>!!tramos?.find(([t0,t1])=>t>=t0&&t<t1)?.[2];
