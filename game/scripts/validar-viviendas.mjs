// Nivel 9 del probador (2026-10-17, Miguel: «la policía no entra a casas ni apartamentos; forzar una chapa para robar o
// guarecerse; en cada puerta, mirar por el visor si está llena o vacía»). Las viviendas (engine/viviendas.js), medido
// aparte:
//  · cada apartamento con una sola puerta de entrada (al pasillo) y cada casa del monte con dos (calle y patio);
//  · el lugar del visor, afuera de la vivienda y alcanzable caminando (el apartamento, desde la calle subiendo por la
//    escalera; la casa, por la grilla peatonal);
//  · quién está en casa (de las familias, sociedad.js; lo demás de la sociedad lo mide validar-sociedad): cada vivienda
//    con su familia y la ronda cubierta sin huecos; se muestra la parte del tiempo con gente;
//  · lo que se roba: adentro de la vivienda, y la parte de viviendas con algo para robar, ≥ 75 %.
// Uso: node scripts/validar-viviendas.mjs [ciudades=2] [semilla0=1]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {VIVIENDA} from '../src/engine/medidas.js';
import {viviendasDe} from '../src/engine/viviendas.js';
import {sociedadDe,ocupacionSociedad,inicioRonda} from '../src/engine/sociedad.js';
import {navEdificio} from '../src/engine/nav-interior.js';
import {grillaPeatonal,caminar,cuerpoCasa} from '../src/engine/circulacion.js';
import {MODO_BOTIN} from '../src/engine/medidas.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||2),S0=+(A[1]||1),DUR=MODO_BOTIN.duracion,RONDAS=4,MIN_ROBABLE=.75;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const med={aptos:0,casas:0,visores:0,conRobable:0,robables:{},gente:0,tiempo:0,cambian:[]};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),vs=viviendasDe(bp),g=grillaPeatonal(bp);
 let s0=0;for(let i=0;i<bp.map.W*bp.map.H;i++)if(bp.map.kind[i]===0){s0=i;break;}const dCalle=caminar(g,(s0%bp.map.W+.5)*6,(Math.floor(s0/bp.map.W)+.5)*6);
 const navs=new Map(),navL=li=>navs.get(li)||navs.set(li,navEdificio(bp.lots[li])).get(li);
 const llega=(p,x,z)=>{const k=p.g.idx(x,z);if(k<0)return false;for(let dj=-2;dj<=2;dj++)for(let di=-2;di<=2;di++){const kk=k+dj*p.g.nx+di;if(kk>=0&&kk<p.dist.length&&p.dist[kk]>=0)return true;}return false;};
 const afuera=(x,z)=>{const k=g.idx(x,z);if(k<0)return false;for(let dj=-3;dj<=3;dj++)for(let di=-3;di<=3;di++){const kk=k+dj*g.nx+di;if(kk>=0&&kk<dCalle.length&&isFinite(dCalle[kk]))return true;}return false;};
 for(const v of vs){const ej={semilla:s,vivienda:v.id};if(v.robables.length){med.conRobable++;for(const r of v.robables)med.robables[r.nombre]=(med.robables[r.nombre]||0)+1;}
  if(v.tipo==='apto'){med.aptos++;if(v.puertas.length!==1)falla('apartamento sin una sola puerta de entrada',{...ej,puertas:v.puertas.length});
   const lv=bp.lots[v.lote].levels.find(l=>l.level===v.nivel),cs=lv.rooms.filter(r=>r.unit===v.apto),en=(x,z)=>cs.some(r=>x>r.x&&x<r.x+r.w&&z>r.y&&z<r.y+r.h),p=navL(v.lote).find(p=>p.nivel===v.nivel);
   for(const d of v.puertas){med.visores++;if(en(d.x,d.z))falla('el visor queda adentro del apartamento',ej);if(!p||!llega(p,d.x,d.z))falla('al visor del apartamento no se llega caminando',ej);}
   for(const r of v.robables)if(!en(r.x,r.z))falla('lo robable queda fuera del apartamento',{...ej,objeto:r.objeto});}
  else if(v.tipo==='casaLote'){med.casas++;med.casasCiudad=(med.casasCiudad||0)+1;const cs=bp.lots[v.lote].levels.find(l=>l.level===0).rooms,en=(x,z)=>cs.some(r=>x>r.x&&x<r.x+r.w&&z>r.y&&z<r.y+r.h);
   if(!v.puertas.length)falla('casa de la ciudad sin puerta a la calle',ej);
   for(const d of v.puertas){med.visores++;if(en(d.x,d.z))falla('el visor queda adentro de la casa de la ciudad',ej);if(!afuera(d.x,d.z))falla('al visor de la casa de la ciudad no se llega caminando',{...ej,x:d.x,z:d.z});}
   for(const r of v.robables)if(!en(r.x,r.z))falla('lo robable queda fuera de la casa de la ciudad',{...ej,objeto:r.objeto});}
  else{med.casas++;if(v.puertas.length<2)falla('casa con menos de dos puertas (calle y patio)',{...ej,puertas:v.puertas.length});const c=cuerpoCasa(bp.isla.casas[v.casa]);
   for(const d of v.puertas){med.visores++;if(d.x>c.x0&&d.x<c.x1&&d.z>c.z0&&d.z<c.z1)falla('el visor queda adentro de la casa',ej);if(!afuera(d.x,d.z))falla('al visor de la casa no se llega caminando',{...ej,x:d.x,z:d.z});}
   for(const r of v.robables)if(!(r.x>c.x0-.01&&r.x<c.x1+.01&&r.z>c.z0-.01&&r.z<c.z1+.01))falla('lo robable queda fuera de la casa',{...ej,objeto:r.objeto});}}
 // quién está en casa
 // quién está en casa (de las familias: sociedad.js): cubre la ronda sin huecos, en RONDAS rondas
 const SO=sociedadDe(bp);for(let ronda=0;ronda<RONDAS;ronda++){const O=ocupacionSociedad(SO,inicioRonda(s,ronda),DUR);if(O.size!==vs.length)falla('viviendas sin familia',{semilla:s,familias:O.size,viviendas:vs.length});
  for(const [id,tr] of O){let t=0;for(const [t0,t1,gg] of tr){if(Math.abs(t0-t)>.11)falla('hueco o solape en quién está en casa',{semilla:s,vivienda:id,t,t0});t=t1;med.tiempo+=t1-t0;if(gg)med.gente+=t1-t0;}
   if(Math.abs(t-DUR)>.11)falla('la ocupación no cubre la ronda',{semilla:s,vivienda:id,hasta:t});}}}
const parte=med.gente/med.tiempo,conR=med.conRobable/(med.aptos+med.casas);
if(conR<MIN_ROBABLE)falla('pocas viviendas con algo para robar',{parte:+conR.toFixed(2)});
console.log(`viviendas · ${N} ciudades · ${med.aptos} apartamentos y ${med.casas} casas · ${med.visores} visores, todos afuera y alcanzables salvo fallas · con gente ${(parte*100).toFixed(1)} % del tiempo de ${RONDAS} rondas (de las familias) · con algo para robar ${(conR*100).toFixed(0)} % (${Object.entries(med.robables).map(([k,n])=>k+' '+n).join(', ')})`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
