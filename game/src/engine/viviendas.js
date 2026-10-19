// ======== Las viviendas (2026-10-17): los apartamentos y las casas del monte como lugares del juego ========
// La policía no entra a ellas (sí a las zonas comunes de los edificios: vestíbulo, escalera, pasillos, azotea). El ladrón
// entra a las suyas (las guaridas) o fuerza la chapa de otra para esconderse o robar. Reglas en medidas.js VIVIENDA; lo
// mide validar-viviendas. Puro y determinista.
//  · viviendasDe(bp): cada vivienda con su(s) puerta(s) de entrada —la del apartamento al pasillo; las de afuera de la
//    casa—, dónde se para el que mira por el visor (afuera, frente a cada una) y lo que se puede robar adentro;
//  · enCasa(tramos, t): ¿hay gente? Los tramos de cada vivienda salen de las familias (sociedad.js ocupacionSociedad;
//    hasta el 2026-10-17 eran una tirada al azar por ronda).
import {VIVIENDA} from './medidas.js';
import {cuerpoCasa} from './circulacion.js';
import {casaAMundo} from './botin.js';

const R=VIVIENDA.robables;
// una puerta (segmento en el mundo) y de qué lado está afuera: el punto del visor y hacia dónde mira
const visorDe=(x0,z0,x1,z1,afuera)=>{const mx=(x0+x1)/2,mz=(z0+z1)/2,h=Math.abs(z1-z0)<1e-6,[nx,nz]=(h?[[0,-1],[0,1]]:[[-1,0],[1,0]]).find(([a,b])=>afuera(mx+a*.3,mz+b*.3))||[0,0];
 return {puerta:{x0,z0,x1,z1},x:+(mx+nx*VIVIENDA.visor.antes).toFixed(2),z:+(mz+nz*VIVIENDA.visor.antes).toFixed(2),mira:{x:-nx,z:-nz}};};

export function viviendasDe(bp){const out=[];
 // los apartamentos: por piso de arriba, cada unidad y su puerta al pasillo (o al núcleo)
 bp.lots.forEach((L,li)=>{for(const lv of L.levels||[]){if(lv.level===0||!lv.units?.length)continue;
  for(const u of lv.units){const cuartos=lv.rooms.filter(r=>r.unit===u.n);if(!cuartos.length)continue;const ids=new Set(cuartos.map(r=>r.id)),dentro=(x,z)=>cuartos.some(r=>x>r.x&&x<r.x+r.w&&z>r.y&&z<r.y+r.h);
   const puertas=lv.doors.filter(d=>ids.has(d.a)!==ids.has(d.b)).map(d=>visorDe(d.x0,d.y0,d.x1,d.y1,(x,z)=>!dentro(x,z)));
   const robables=(lv.furniture||[]).filter(f=>R[f.kind]&&dentro(f.x+f.w/2,f.y+f.h/2)).map(f=>({objeto:f.kind,nombre:R[f.kind].nombre,valor:R[f.kind].valor,x:+(f.x+f.w/2).toFixed(2),z:+(f.y+f.h/2).toFixed(2)}));
   out.push({id:`L${li}:${u.n}`,tipo:'apto',lote:li,nivel:lv.level,apto:u.n,edificio:L.name,puertas,robables,cuartos:cuartos.length});}}});
 // las casas de la ciudad (lotes «casa», 2026-10-17: antes no eran viviendas y su puerta se abría para cualquiera): una
 // sola planta, sus puertas a la calle (y al patio)
 bp.lots.forEach((L,li)=>{if(L.type!=='casa')return;const lv=L.levels?.find(l=>l.level===0);if(!lv)return;const cs=lv.rooms,dentro=(x,z)=>cs.some(r=>x>r.x&&x<r.x+r.w&&z>r.y&&z<r.y+r.h);
  const puertas=lv.doors.filter(d=>d.street||d.b==='calle'||d.patio).map(d=>visorDe(d.x0,d.y0,d.x1,d.y1,(x,z)=>!dentro(x,z)));
  const robables=(lv.furniture||[]).filter(f=>R[f.kind]&&dentro(f.x+f.w/2,f.y+f.h/2)).map(f=>({objeto:f.kind,nombre:R[f.kind].nombre,valor:R[f.kind].valor,x:+(f.x+f.w/2).toFixed(2),z:+(f.y+f.h/2).toFixed(2)}));
  const dir=lv.doors.find(d=>d.street&&d.direccion)?.direccion?.texto||null;
  out.push({id:`L${li}:casa`,tipo:'casaLote',lote:li,nivel:0,direccion:dir,puertas,robables,cuartos:cs.length});});
 // las casas del monte: la puerta de calle y la del patio
 (bp.isla?.casas||[]).forEach((h,ci)=>{const P=h.spec?.hogar;if(!P)return;const aM=casaAMundo(h),c=cuerpoCasa(h),dentro=(x,z)=>x>c.x0&&x<c.x1&&z>c.z0&&z<c.z1,puertas=[];
  for(const lv of P.levels.filter(l=>l.level===0))for(const d of lv.doors.filter(d=>d.street||d.b==='calle'||d.patio)){const [ax,az]=aM(...(d.axis==='u'?[d.from,d.at]:[d.at,d.from])),[bx,bz]=aM(...(d.axis==='u'?[d.from+d.len,d.at]:[d.at,d.from+d.len]));puertas.push(visorDe(ax,az,bx,bz,(x,z)=>!dentro(x,z)));}
  const robables=P.levels.flatMap(lv=>(lv.furniture||[]).filter(f=>R[f.kind]).map(f=>{const [x,z]=aM((f.u0+f.u1)/2,(f.v0+f.v1)/2);return {objeto:f.kind,nombre:R[f.kind].nombre,valor:R[f.kind].valor,nivel:lv.level,x:+x.toFixed(2),z:+z.toFixed(2)};}));
  out.push({id:`C${ci}`,tipo:'casa',casa:ci,direccion:h.direccion?.texto||null,puertas,robables,cuartos:P.levels.reduce((a,l)=>a+l.rooms.length,0)});});
 return out;}

// quién está en casa: los tramos [t0, t1, conGente] de una vivienda (sociedad.js ocupacionSociedad), en el segundo t
export const enCasa=(tramos,t)=>!!tramos?.find(([t0,t1])=>t>=t0&&t<t1)?.[2];
