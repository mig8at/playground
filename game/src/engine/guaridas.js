// ======== Las guaridas (2026-10-17, Miguel: «el sistema escoge las guaridas: en lugares estratégicos, que roten y
// consuman varios lugares del mapa, que no sea preferible cuál; a los ladrones se les dice el lugar exacto —calle,
// carrera, casa o edificio, piso, apartamento— y ahí está la caja de guardar lo robado») ========
// Reglas en medidas.js GUARIDA; lo mide validar-guaridas. Puro (determinista por semilla y ronda).
//  · prepararGuaridas(bp): las candidatas de la ciudad —cada edificio con apartamentos y cada casa del monte, con sus
//    puertas de afuera (calle o patio)— y, caminando desde ellas, la distancia a la comisaría y el acceso medio al
//    botín (de sus puertas a las del edificio o la casa de cada objetivo). Lo caro: se hace una vez por ciudad.
//  · guaridasDe(bp, {policias, ronda, prep}): las de una ronda —una por cada GUARIDA.porPolicias policías—: la primera
//    al azar de la ronda entre las que cumplen; las demás con el acceso a ±equidad de ella y lejos caminando de las
//    ya elegidas (≥ GUARIDA.entre), al azar de la ronda entre las que cumplen. Cada una con su lugar (apartamento o casa), su caja y su dirección.
import {GUARIDA} from './medidas.js';
import {grillaPeatonal,caminarDesde,cuerpoCasa} from './circulacion.js';
import {casaAMundo,pisoLote,pisoCasa,colocar,noEstorba} from './botin.js';
import {rng,mix} from './veredas.js';

// las puertas de afuera de un edificio (calle o patio): el punto a 0,6 m del lado de afuera
export function entradasLote(L){const lv=L.levels?.find(l=>l.level===0);if(!lv)return [];const dentro=(x,z)=>L.parts.some(p=>x>p.x&&x<p.x+p.w&&z>p.y&&z<p.y+p.h);
 return lv.doors.filter(d=>d.street).map(d=>{const mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2,h=Math.abs(d.y0-d.y1)<1e-6;
  return (h?[[0,-.6],[0,.6]]:[[-.6,0],[.6,0]]).map(([a,b])=>[mx+a,mz+b]).find(([x,z])=>!dentro(x,z));}).filter(Boolean);}
// las de una casa del monte: la de calle y la de atrás, al patio
export function entradasCasa(h){const c=cuerpoCasa(h),P=h.spec?.hogar,e=[[c.puerta.x+c.afuera.x*.6,c.puerta.z+c.afuera.z*.6]];if(!P)return e;
 const dp=P.levels[0].doors.find(d=>d.patio);if(dp){const q=P.levels[0].rooms.find(r=>r.id===dp.a)||{},out=Math.abs(dp.at-(q.v1??0))<.02?.6:-.6;e.push(casaAMundo(h)(dp.from+dp.len/2,dp.at+out));}
 return e;}

export function prepararGuaridas(bp){const g=grillaPeatonal(bp),cand=[];
 const en=(d,x,z)=>{const k=g.idx(x,z);let b=Infinity;if(k<0)return b;for(let dj=-3;dj<=3;dj++)for(let di=-3;di<=3;di++){const kk=k+dj*g.nx+di;if(kk>=0&&kk<d.length)b=Math.min(b,d[kk]);}return b;};
 bp.lots.forEach((L,li)=>{if(!L.levels||L.type==='comisaria')return;const uds=L.levels.filter(l=>l.level>0).flatMap(l=>(l.units||[]).map(u=>({nivel:l.level,n:u.n})));if(!uds.length)return;
  cand.push({id:'L'+li,tipo:'edificio',lote:li,nombre:L.name,ent:entradasLote(L),uds});});
 (bp.isla?.casas||[]).forEach((h,ci)=>{if(!h.spec?.hogar)return;cand.push({id:'C'+ci,tipo:'casa',casa:ci,nombre:'Casa',ent:entradasCasa(h),uds:[{nivel:0,n:null}]});});
 const est=bp.lots.find(L=>L.type==='comisaria'),dCom=est?caminarDesde(g,entradasLote(est)):null;
 const dB=(bp.botines||[]).map(b=>caminarDesde(g,b.casa!=null?entradasCasa(bp.isla.casas[b.casa]):entradasLote(bp.lots[b.lote])));
 for(const c of cand){c.comisaria=dCom?Math.min(...c.ent.map(([x,z])=>en(dCom,x,z))):Infinity;const ds=dB.map(d=>Math.min(...c.ent.map(([x,z])=>en(d,x,z))));c.acceso=ds.length?ds.reduce((a,b)=>a+b,0)/ds.length:0;}
 return {g,en,cand};}

// la dirección: la de la puerta de calle del edificio (la que no da al patio) o la de la casa
const direccionDe=(bp,c)=>c.tipo==='casa'?bp.isla.casas[c.casa].direccion?.texto:(bp.lots[c.lote].levels[0].doors.find(d=>d.street&&!d.patio&&d.direccion)||bp.lots[c.lote].levels[0].doors.find(d=>d.direccion))?.direccion?.texto;

// la caja en un apartamento (o en la casa): contra una pared libre de uno de sus cuartos, alcanzable, sin estorbar
function cajaEn(bp,c,u){const P=c.tipo==='casa'?pisoCasa(bp.isla.casas[c.casa]):pisoLote(bp.lots[c.lote],u.nivel,u.n);if(!P||!P.cuartos.length)return null;
 const n=P.nav();if(!n)return null;const m=colocar(P,GUARIDA.caja,n);if(!m||!noEstorba(P,n,m.r))return null;
 const [x,z]=P.aMundo((m.r.x0+m.r.x1)/2,(m.r.z0+m.r.z1)/2),[fx,fz]=P.aMundo(...m.frente),[ax,az]=P.aMundo(m.frente[0]+m.normal[0],m.frente[1]+m.normal[1]);
 return {x:+x.toFixed(2),z:+z.toFixed(2),nivel:u.nivel,cuarto:m.c.tipo,ang:+Math.atan2(ax-fx,az-fz).toFixed(4),largo:GUARIDA.caja.largo,fondo:GUARIDA.caja.fondo,frente:{x:+fx.toFixed(2),z:+fz.toFixed(2)},
  local:{x0:+m.r.x0.toFixed(3),x1:+m.r.x1.toFixed(3),z0:+m.r.z0.toFixed(3),z1:+m.r.z1.toFixed(3)}};}

export const cuantasGuaridas=policias=>Math.max(1,Math.ceil(policias/GUARIDA.porPolicias));

export function guaridasDe(bp,{policias=bp.team||3,ronda=0,prep=null}={}){prep=prep||prepararGuaridas(bp);const {g,en,cand}=prep,G=GUARIDA,N=cuantasGuaridas(policias);
 // (que roten de verdad, 2026-10-17: cada ronda evita los lugares de las anteriores si hay con qué reemplazarlos —en la ciudad
 // con parques, con 4 guaridas por ronda un lugar salía en 5 de 12—; la anterior se guarda en prep)
 const memo=prep.memo||(prep.memo=new Map()),mk=policias+'|'+ronda;if(memo.has(mk))return memo.get(mk);
 // (las de las últimas K rondas, con K de la regla: para salir en a lo más maxUso de las rondas, cada lugar descansa
 // ceil(1/maxUso) − 1 rondas —con sólo la anterior, un lugar alternaba y salía en la mitad—)
 const K=Math.ceil(1/G.rotacion.maxUso)-1,evitar=new Set();for(let k=1;k<=K&&ronda-k>=0;k++)for(const x of guaridasDe(bp,{policias,ronda:ronda-k,prep}))evitar.add(x.lugar);
 const todas=cand.filter(c=>c.ent.length>=G.entradas&&c.comisaria>=G.comisaria&&isFinite(c.comisaria)&&isFinite(c.acceso));if(!todas.length)return [];
 const sinRepetir=todas.filter(c=>!evitar.has(c.id));
 let out=elegir(sinRepetir.length?sinRepetir:todas);if(out.length<N&&sinRepetir.length<todas.length)out=elegir(todas);
 memo.set(mk,out);return out;
 function elegir(pool){const r=rng(mix(bp.seed,ronda,4241));
 const campo=new Map(),desde=c=>campo.get(c.id)||campo.set(c.id,caminarDesde(g,c.ent)).get(c.id),entre=(a,b)=>Math.min(...b.ent.map(([x,z])=>en(desde(a),x,z)));
 // el lugar exacto de una candidata: un apartamento al azar de la ronda (el primero donde entra la caja) o la casa; null
 // si en ninguno entra (entonces no es guarida: se descarta antes de elegirla, no después)
 const lugares=new Map(),lugarDe=c=>{if(lugares.has(c.id))return lugares.get(c.id);let L=null;
  for(const u of c.uds.map(u=>({u,k:r()})).sort((a,b)=>a.k-b.k).map(o=>o.u)){const caja=cajaEn(bp,c,u);if(caja){L={u,caja};break;}}lugares.set(c.id,L);return L;};
 let mejor=null;
 // (la primera al azar de la ronda; si con ella no se completan las N, otra: hasta 20 intentos, y queda la que más tuvo)
 // (ciudad y monte, 2026-10-17: la primera, de un tipo al azar de la ronda —apartamento o casa, mitad y mitad—; la
 // segunda, del otro tipo: en una ciudad salían 103 casas y 17 apartamentos, por haber más casas y más lejos de la comisaría)
 const deTipo=t=>pool.filter(c=>c.tipo===t),tipos=['edificio','casa'].filter(t=>deTipo(t).length);
 for(let t=0;t<20;t++){const t0=tipos[Math.floor(r()*tipos.length)],p0=deTipo(t0),c0=p0[Math.floor(r()*p0.length)];if(!lugarDe(c0))continue;const set=[c0];
  while(set.length<N){const lo=Math.min(...set.map(c=>c.acceso)),hi=Math.max(...set.map(c=>c.acceso));
   const falta=tipos.find(t=>!set.some(c=>c.tipo===t)),cands=[];for(const c of pool){if(set.includes(c)||lugares.get(c.id)===null||falta&&c.tipo!==falta)continue;const a=Math.min(lo,c.acceso),b=Math.max(hi,c.acceso);if((b-a)/((a+b)/2)>2*G.equidad+1e-9)continue;
    // (primero el descarte barato en línea recta: caminando nunca es menos)
    if(Math.min(...set.map(s=>Math.hypot(s.ent[0][0]-c.ent[0][0],s.ent[0][1]-c.ent[0][1])))<G.entre*.5)continue;
    const d=Math.min(...set.map(s=>entre(s,c)));if(d>=G.entre)cands.push([d,c]);}
   // (al azar de la ronda entre las que cumplen y tienen dónde poner la caja: con «la más lejos» salían siempre las mismas
   // esquinas del mapa —un lugar en 7 de 12 rondas con 5 y 8 policías—)
   let best=null;while(cands.length){const [,c]=cands.splice(Math.floor(r()*cands.length),1)[0];if(lugarDe(c)){best=c;break;}}
   if(!best)break;set.push(best);}
  if(!mejor||set.length>mejor.length)mejor=set;if(set.length>=N)break;}
 const out=[];for(const c of mejor||[]){const {u,caja}=lugarDe(c),dir=direccionDe(bp,c),piso=c.tipo==='casa'?null:u.nivel;
  out.push({id:'g'+(out.length+1),lugar:c.id,tipo:c.tipo,...(c.tipo==='casa'?{casa:c.casa}:{lote:c.lote,piso,apto:u.n}),nombre:c.nombre,direccion:dir||null,
   texto:[dir,c.tipo==='casa'?'casa':c.nombre,...(c.tipo==='casa'?[]:[`piso ${piso}`,`apto ${u.n}`])].filter(Boolean).join(' · '),
   entradas:c.ent.map(([x,z])=>({x:+x.toFixed(2),z:+z.toFixed(2)})),acceso:+c.acceso.toFixed(1),comisaria:+c.comisaria.toFixed(0),caja});}
 return out;}}
