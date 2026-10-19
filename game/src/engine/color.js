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
// una opción según su parte (esquemas de PALETA: {opción: parte})
const sortear=(partes,r)=>{let x=r()*Object.values(partes).reduce((a,b)=>a+b,0);for(const [k,v] of Object.entries(partes)){x-=v;if(x<=0)return k;}return Object.keys(partes)[0];};
// El esquema de afuera de una fachada f según su tradición T (PALETA.tradiciones, 2026-10-18): {moldura, acento, marco,
// zocalo, esquema}. El acento: uno de T.acento que se aleja de la pared y de la moldura y es más oscuro que la pared
// (salvo T.acentoClaro) y, si se puede, de los acentos de evitar (los vecinos, en una tradición uniforme); si ninguno,
// el que más se aleja. La moldura y el zócalo tonales: la pared oscurecida. En una
// pared oscura (luminancia < reglas.paredClara) la moldura tonal pasa a crema, la oscura a clara y los marcos van de la
// moldura (medido en las fotos: los apagan).
export function esquemaDe(f,r,T=PALETA.tradiciones.caribe,evitar=[]){const P=PALETA,R=P.reglas,pick=a=>a[Math.floor(r()*a.length)];
 const lf=luminancia(f),clarita=lf>=R.paredClara;let em=sortear(T.moldura,r);if(!clarita)em=em==='tonal'?'crema':em==='oscura'?'clara':em;
 const clara=P.moldura.reduce((a,b)=>contraste(b,f)>contraste(a,f)?b:a),otras=T.pared.filter(c=>deltaE(c,f)>=25&&contraste(c,f)>=R.contraste);
 let moldura=em==='clara'?clara:em==='crema'?pick(P.molduraCrema):em==='oscura'?pick(P.molduraOscura):em==='tonal'?sombra(f,R.tonal):em==='contraste'?(otras.length?pick(otras):clara):f;
 if(!['pared','acento'].includes(em)&&contraste(moldura,f)<R.contraste)moldura=contraste(clara,f)>=R.contraste?clara:f;// (una crema o una blanca sobre una pared clara no se ve)
 const sin=moldura===f,ok=a=>deltaE(a,f)>=R.acento&&(sin||em==='acento'||deltaE(a,moldura)>=R.acentoMoldura)&&(T.acentoClaro||luminancia(a)<lf);
 const L=[...T.acento].sort(()=>r()-.5),lejos=a=>evitar.every(e=>deltaE(a,e)>=R.vecinos),acento=L.find(a=>ok(a)&&lejos(a))||L.find(ok)||L.reduce((a,b)=>deltaE(b,f)>deltaE(a,f)?b:a);
 if(em==='acento')moldura=acento;
 const mk=sortear(T.marco,r),marco=mk==='acento'&&(clarita||em==='acento')?acento:moldura;
 let ez=sortear(T.zocalo,r);
 const vivos=(T.vivos||[]).filter(c=>deltaE(c,acento)>=25&&deltaE(c,f)>=R.acento);
 let zocalo=ez==='acento'?acento:ez==='tonal'?sombra(f,R.tonalZocalo):ez==='piedra'?pick(T.piedra||P.zocalo):ez==='vivo'?(vivos.length?pick(vivos):acento):ez==='azulejo'?pick(T.azulejo):f;
 if(ez!=='ninguno'&&(deltaE(zocalo,f)<R.zocalo||(!['vivo','azulejo'].includes(ez)&&luminancia(zocalo)>=lf))){zocalo=acento;ez='acento';}
 if(ez==='vivo'&&zocalo===acento)ez='acento';
 return {moldura,acento,marco,zocalo,esquema:{moldura:em,marco:marco===acento&&marco!==moldura?'acento':'moldura',zocalo:ez}};}
// La tradición de cada zona de la ciudad (L.zonaF, la grilla de barrios de blueprint) y de cada manzana del monte:
// una de las que caben en su familia (PALETA.tradicionesDe), y dos zonas vecinas (en línea o en diagonal) no repiten.
function tradiciones(r){const D=PALETA.tradicionesDe,zona=new Map(),manz=new Map();
 const deZona=L=>{const z=L.zonaF.join(',');if(!zona.has(z)){const [x,y]=L.zonaF,vec=new Set();for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const t=zona.get((x+dx)+','+(y+dy));if(t)vec.add(t);}
  const ops=[...(D[L.barrio]||D.historico)].sort(()=>r()-.5);zona.set(z,ops.find(t=>!vec.has(t))||ops[0]);}return zona.get(z);};
 const deMonte=k=>{if(!manz.has(k)){const usadas=[...manz.values()].slice(-2),ops=[...D.monte].sort(()=>r()-.5);manz.set(k,ops.find(t=>!usadas.includes(t))||ops[0]);}return manz.get(k);};
 return {lote:L=>L.zonaF?deZona(L):deMonte('m'+(L.manzana??('l'+L.id))),casa:h=>deMonte('m'+(h.manzana??0))};}
// La pared de una fachada en su tradición: la de su lista que se aleja de las vecinas; si ninguna alcanza (una tradición
// de pocos colores con muchas vecinas), la misma lista un poco más oscura o más clara (TONOS: lo que varía la misma
// pintura de una casa a otra en una cuadra).
export const TONOS=[.8,.9,1.12,1.25];
const paredDe=(T,vec,min,r)=>{let f=elegir(T.pared,vec,min,r);if(vec.length&&Math.min(...vec.map(v=>deltaE(f,v)))<min)f=elegir([...T.pared,...T.pared.flatMap(c=>TONOS.map(k=>sombra(c,k)))],vec,min,r);return f;};
export const colorCuarto=(dueno,nivel,q)=>dueno?.colores?.cuartos?.[nivel+':'+q.id]??null;
// pinta un piso: cs = [{id, tipo, rect}], fijos = vecinos ya pintados (los pasillos); devuelve {id: color}
function pintarPiso(cs,fijos,r){const R=PALETA.reglas,out={};for(const c of cs){const vec=[...fijos,...cs].filter(o=>o!==c&&o.color&&tocan(o.rect,c.rect)).map(o=>o.color);c.color=elegir(PALETA.cuarto[familiaDe(c.tipo)],vec,R.vecinos,r);out[c.id]=c.color;}return out;}

export function pintar(bp){const r=rng((bp.seed*7919+(bp.team||0)*104729)>>>0),R=PALETA.reglas;
 // (el esquema, con su propio azar: los cuartos quedan como estaban)
 const re=rng((bp.seed*6271+(bp.team||0)*7907+17)>>>0),TR=tradiciones(rng((bp.seed*4421+(bp.team||0)*331+5)>>>0)),TT=PALETA.tradiciones,rf=rng((bp.seed*1543+(bp.team||0)*911+3)>>>0);// (rf: el azar de afuera; r queda para los cuartos)
 // las fachadas: lotes vecinos (sus rectángulos de casillas se tocan o están a una casilla) distintos
 const lotes=[...bp.lots,...(bp.isla?.lots||[]).filter(L=>L.parts)],caja=L=>{const p=L.parts;return {x0:Math.min(...p.map(q=>q.x)),x1:Math.max(...p.map(q=>q.x+q.w)),z0:Math.min(...p.map(q=>q.y)),z1:Math.max(...p.map(q=>q.y+q.h))};};
 const cajas=lotes.map(caja),cerca=(a,b)=>Math.max(a.x0-b.x1,b.x0-a.x1,a.z0-b.z1,b.z0-a.z1)<=6.01;
 // (cada lote, de la tradición de su barrio: su pared, su esquema y, si la tradición lo trae, su techo)
 lotes.forEach((L,i)=>{const t=TR.lote(L),T=TT[t],vec=lotes.slice(0,i).filter((o,j)=>cerca(cajas[i],cajas[j])).map(o=>o.colores.fachada);const f=paredDe(T,vec,T.uniforme?0:T.vecinos??R.fachadas,rf);
  const ev=T.uniforme?lotes.slice(0,i).filter((o,j)=>cerca(cajas[i],cajas[j])&&o.colores.fachada===f).map(o=>o.colores.acento):[];
  L.colores={fachada:f,...esquemaDe(f,re,T,ev),culata:T.uniforme&&t!=='moderno'&&t!=='haussmann'?f:PALETA.culata[Math.floor(rf()*PALETA.culata.length)],tradicion:t,techo:(T.techo||PALETA.techo)[Math.floor(rf()*(T.techo||PALETA.techo).length)],pasillo:{},cuartos:{}};
  for(const lv of L.levels||[]){const cp=PALETA.cuarto.paso[Math.floor(r()*PALETA.cuarto.paso.length)];L.colores.pasillo[lv.level]=cp;
   // (los pasillos cuentan como vecinos de los cuartos que dan a ellos)
   const pas=(lv.corridor||[]).map(c=>({color:cp,rect:{x0:c.x,x1:c.x+c.w,z0:c.y,z1:c.y+c.h}})),cs=lv.rooms.map(q=>({id:q.id,tipo:q.type,rect:{x0:q.x,x1:q.x+q.w,z0:q.y,z1:q.y+q.h}}));
   for(const [id,c] of Object.entries(pintarPiso(cs,pas,r)))L.colores.cuartos[lv.level+':'+id]=c;}});
 // las casas del monte
 const casas=(bp.isla?.casas||[]).filter(h=>h.spec);
 // (las casas, como los lotes: la tradición de su manzana; la moldura de la casa son sus marcos, la puerta va del acento)
 casas.forEach((h,i)=>{const t=TR.casa(h),T=TT[t],vec=casas.slice(0,i).filter(o=>Math.hypot(o.x-h.x,o.z-h.z)<24).map(o=>o.colores.fachada);const f=paredDe(T,vec,T.uniforme?0:T.vecinos??R.fachadas,rf);
  const E=esquemaDe(f,re,T,T.uniforme?casas.slice(0,i).filter(o=>Math.hypot(o.x-h.x,o.z-h.z)<24&&o.colores.fachada===f).map(o=>o.colores.acento):[]);h.colores={fachada:f,...E,moldura:E.marco,puerta:E.acento,tradicion:t,techo:(T.techo||PALETA.techo)[Math.floor(rf()*(T.techo||PALETA.techo).length)],cuartos:{}};
  for(const lv of h.spec.hogar?.levels||[]){const cs=lv.rooms.map(q=>({id:q.id,tipo:q.type,rect:{x0:q.u0,x1:q.u1,z0:q.v0,z1:q.v1}}));
   for(const [id,c] of Object.entries(pintarPiso(cs,[],r)))h.colores.cuartos[lv.level+':'+id]=c;}});
 return {lotes:lotes.length,casas:casas.length};}
