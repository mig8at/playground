// ======== El pintado del mundo, desde el 2D (2026-10-16, idea de Miguel) ========
// Cada cuarto de cada edificio y casa, cada fachada, moldura y techo recibe un color de PALETA (medidas.js), por su
// función (FAMILIA_CUARTO) y de modo que dos cuartos que se tocan —en el mismo piso— no repitan color ni queden casi
// iguales (ΔE ≥ reglas.vecinos), y dos lotes vecinos tengan fachadas distintas (ΔE ≥ reglas.fachadas). Determinista por
// semilla. Deja en cada lote L.colores {fachada, moldura, techo, pasillo: {nivel: color}, cuartos: {'nivel:id': color}} y
// en cada casa h.colores {fachada, moldura, techo, puerta, cuartos: {'nivel:id': color}} —en el lote o la casa, no en el
// plano: los planos de las casas se comparten (planHogar los guarda)—. colorCuarto(dueño, nivel, cuarto) lo lee.
import {PALETA,FAMILIA_CUARTO} from './medidas.js';

const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255);
const lin=c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4;
export function lab(h){const [r,g,b]=hex(h).map(lin),X=(.4124*r+.3576*g+.1805*b)/.95047,Y=.2126*r+.7152*g+.0722*b,Z=(.0193*r+.1192*g+.9505*b)/1.08883,f=t=>t>.008856?Math.cbrt(t):7.787*t+16/116;
 return [116*f(Y)-16,500*(f(X)-f(Y)),200*(f(Y)-f(Z))];}
export const deltaE=(a,b)=>{const p=lab(a),q=lab(b);return Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2]);};
export const luminancia=h=>{const [r,g,b]=hex(h).map(lin);return .2126*r+.7152*g+.0722*b;};
export const contraste=(a,b)=>{const x=luminancia(a),y=luminancia(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
export const familiaDe=t=>FAMILIA_CUARTO[t]||'trabajo';

const rng=s=>{let n=s>>>0;return ()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};};
// el primero de la lista (barajada) que se aleja lo pedido de todos los vecinos ya pintados; si ninguno, el que más se aleja
const elegir=(lista,vecinos,min,r)=>{const L=[...lista].sort(()=>r()-.5);let mejor=null,md=-1;for(const c of L){const d=vecinos.length?Math.min(...vecinos.map(v=>deltaE(c,v))):1e9;if(d>=min)return c;if(d>md){md=d;mejor=c;}}return mejor;};
// dos rectángulos que se tocan (comparten un tramo de borde de más de 0,3 m)
const tocan=(a,b)=>{const ox=Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0),oz=Math.min(a.z1,b.z1)-Math.max(a.z0,b.z0),E=.02;return (Math.abs(ox)<=E&&oz>.3)||(Math.abs(oz)<=E&&ox>.3);};

// la misma tinta más oscura (k < 1) o más clara (k > 1), en sRGB
export const sombra=(h,k)=>'#'+hex(h).map(c=>Math.round(Math.max(0,Math.min(1,c*k))*255).toString(16).padStart(2,'0')).join('');
// ---- El esquema de cada edificio (2026-11-22, Miguel: «una mejor paleta de colores por edificio para puertas, ventanas,
// pared, detalles de columnas y techos») ----
// Un edificio lleva un esquema diseñado entero (PALETA.fachadas: pared, detalle, marco, puerta, zócalo, techo, culata) de
// los que caben en su barrio (PALETA.fachadasDe) y uno de los tonos de su pared. Entre vecinos, el que más se aleja: la
// pared y la puerta (distancia: ΔE de las paredes + la mitad del de las puertas) a lo menos reglas.fachadas; si ninguno
// alcanza, el que más se aleja. Las piezas no se mezclan entre esquemas: así combinan.
const coloresDe=(id,pared)=>{const E=PALETA.fachadas[id];return {fachada:pared,moldura:E.detalle,detalle:E.detalle,marco:E.marco,acento:E.puerta,puerta:E.puerta,zocalo:E.zocalo,techo:E.techo,culata:E.culata,esquema:id};};
export const distanciaFachadas=(a,b)=>deltaE(a.fachada,b.fachada)+.5*deltaE(a.acento,b.acento);
export function elegirEsquema(ids,vecinos,min,r){const ops=[...ids].sort(()=>r()-.5).flatMap(id=>[...PALETA.fachadas[id].pared].sort(()=>r()-.5).map(p=>coloresDe(id,p)));
 let mejor=null,md=-1;for(const c of ops){const d=vecinos.length?Math.min(...vecinos.map(v=>distanciaFachadas(c,v))):1e9;if(d>=min)return c;if(d>md){md=d;mejor=c;}}return mejor;}
export const colorCuarto=(dueno,nivel,q)=>dueno?.colores?.cuartos?.[nivel+':'+q.id]??null;
// pinta un piso: cs = [{id, tipo, rect}], fijos = vecinos ya pintados (los pasillos); devuelve {id: color}
function pintarPiso(cs,fijos,r){const R=PALETA.reglas,out={};for(const c of cs){const vec=[...fijos,...cs].filter(o=>o!==c&&o.color&&tocan(o.rect,c.rect)).map(o=>o.color);c.color=elegir(PALETA.cuarto[familiaDe(c.tipo)],vec,R.vecinos,r);out[c.id]=c.color;}return out;}

export function pintar(bp){const r=rng((bp.seed*7919+(bp.team||0)*104729)>>>0),R=PALETA.reglas;
 // (el esquema, con su propio azar: los cuartos quedan como estaban)
 const rf=rng((bp.seed*1543+(bp.team||0)*911+3)>>>0);// (rf: el azar de afuera; r queda para los cuartos)
 // las fachadas: lotes vecinos (sus rectángulos de casillas se tocan o están a una casilla) distintos
 const lotes=[...bp.lots,...(bp.isla?.lots||[]).filter(L=>L.parts)],caja=L=>{const p=L.parts;return {x0:Math.min(...p.map(q=>q.x)),x1:Math.max(...p.map(q=>q.x+q.w)),z0:Math.min(...p.map(q=>q.y)),z1:Math.max(...p.map(q=>q.y+q.h))};};
 const cajas=lotes.map(caja),cerca=(a,b)=>Math.max(a.x0-b.x1,b.x0-a.x1,a.z0-b.z1,b.z0-a.z1)<=6.01;
 // (cada lote, un esquema de los de su barrio —los del monte, del monte—, el que más se aleja de los vecinos ya pintados)
 lotes.forEach((L,i)=>{const vec=lotes.slice(0,i).filter((o,j)=>cerca(cajas[i],cajas[j])).map(o=>o.colores);
  L.colores={...elegirEsquema(PALETA.fachadasDe[L.barrio]||PALETA.fachadasDe.monte,vec,R.fachadas,rf),pasillo:{},cuartos:{}};
  for(const lv of L.levels||[]){const cp=PALETA.cuarto.paso[Math.floor(r()*PALETA.cuarto.paso.length)];L.colores.pasillo[lv.level]=cp;
   // (los pasillos cuentan como vecinos de los cuartos que dan a ellos)
   const pas=(lv.corridor||[]).map(c=>({color:cp,rect:{x0:c.x,x1:c.x+c.w,z0:c.y,z1:c.y+c.h}})),cs=lv.rooms.map(q=>({id:q.id,tipo:q.type,rect:{x0:q.x,x1:q.x+q.w,z0:q.y,z1:q.y+q.h}}));
   for(const [id,c] of Object.entries(pintarPiso(cs,pas,r)))L.colores.cuartos[lv.level+':'+id]=c;}});
 // las casas del monte
 const casas=(bp.isla?.casas||[]).filter(h=>h.spec);
 // (las casas, como los lotes: un esquema del monte; su moldura son sus marcos —vivienda.js: los marcos de la casa—)
 casas.forEach((h,i)=>{const vec=casas.slice(0,i).filter(o=>Math.hypot(o.x-h.x,o.z-h.z)<24).map(o=>o.colores);const E=elegirEsquema(PALETA.fachadasDe.monte,vec,R.fachadas,rf);
  h.colores={...E,moldura:E.marco,cuartos:{}};
  for(const lv of h.spec.hogar?.levels||[]){const cs=lv.rooms.map(q=>({id:q.id,tipo:q.type,rect:{x0:q.u0,x1:q.u1,z0:q.v0,z1:q.v1}}));
   for(const [id,c] of Object.entries(pintarPiso(cs,[],r)))h.colores.cuartos[lv.level+':'+id]=c;}});
 return {lotes:lotes.length,casas:casas.length};}
