// Valida las piezas del juego sobre el mundo nuevo, con la navegación fina (2026-10-16): las que arma el motor
// (plano.js planMap: objetivos con su botín, la comisaría con su celda, las cajas, los puntos de aparición) tienen que
// alcanzarse caminando —por fuera, la grilla peatonal; por dentro, nav-interior— y estar a distancias que den juego:
// policía ↔ ladrones, comisaría → cada objetivo, cada objetivo → la salida al monte más cercana.
// Uso: node --max-old-space-size=8192 scripts/validar-juego.mjs [ciudades=4] [semilla0=1] [jugadores=3]
import {planMap} from '../src/engine/plano.js';
import {CELL} from '../src/engine/blueprint.js';
import {grillaPeatonal,caminar,caminarDesde} from '../src/engine/circulacion.js';
import {navEdificio,NAV_RES} from '../src/engine/nav-interior.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||4),S0=+(A[1]||1),TEAM=+(A[2]||3);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const med={objetivos:0,policiaAObjetivo:[],objetivoASalida:[],ladronAPolicia:[],botinAPuerta:[],cajas:[0,0]};
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.min(b.length-1,Math.floor(p*b.length))]:NaN;};
const m6=p=>({x:p.x*CELL,z:p.y*CELL});// (las piezas del motor van en casillas con decimales)
for(let s=S0;s<S0+N;s++){const mp=planMap(`plan:${TEAM}:${s}`),bp=mp.bp,g=grillaPeatonal(bp);
 // el valor de una distancia en la grilla, en el punto o en una vecina libre (a ≤ 1 m)
 const en=(d,x,z)=>{const k=g.idx(x,z);let best=Infinity;if(k<0)return best;for(let dj=-2;dj<=2;dj++)for(let di=-2;di<=2;di++){const kk=k+dj*g.nx+di;if(kk>=0&&kk<d.length)best=Math.min(best,d[kk]);}return best;};
 // desde la calle (la primera casilla de calle): qué se alcanza por fuera
 let s0=0;for(let i=0;i<bp.map.W*bp.map.H;i++)if(bp.map.kind[i]===0){s0=i;break;}const dCalle=caminar(g,(s0%bp.map.W+.5)*CELL,(Math.floor(s0/bp.map.W)+.5)*CELL);
 // la policía: sus puntos de aparición, afuera de las puertas de la comisaría
 for(const p of mp.copSpawns){const P=m6(p);if(en(dCalle,P.x,P.z)===Infinity)falla('policía que aparece donde no se camina',{semilla:s,...P});}
 const P0=m6(mp.copSpawns[0]),dPol=caminar(g,P0.x,P0.z);
 for(const p of mp.thiefSpawns){const P=m6(p),d=en(dPol,P.x,P.z);if(d===Infinity)falla('ladrón que aparece donde no se camina',{semilla:s,...P});else med.ladronAPolicia.push(d);}
 // las salidas al monte (las del muro): la distancia caminando desde cada objetivo a la más cercana
 const salidas=(bp.isla.gates||[]).filter(g0=>g0.calle).map(g0=>({x:(g0.x+.5)*CELL,z:(g0.y+.5)*CELL}));
 // (una sola pasada desde todas las salidas: la distancia a la más cercana, en todo el mapa)
 const dSal=salidas.length?caminarDesde(g,salidas.map(S2=>[S2.x,S2.z])):null;
 // la comisaría por dentro: la celda, desde sus puertas
 {const L=bp.lots[mp.station],pisos=navEdificio(L),p0=pisos.find(p=>p.nivel===0),J=m6(mp.jailCells[0]),k=p0.g.idx(J.x,J.z);
  let ok=false;for(let r=0;r<=8&&!ok;r++)for(let dj=-r;dj<=r&&!ok;dj++)for(let di=-r;di<=r;di++){const kk=k+dj*p0.g.nx+di;if(kk>=0&&kk<p0.dist.length&&p0.dist[kk]>=0){ok=true;break;}}
  if(!ok)falla('no se llega caminando a la celda de la comisaría',{semilla:s,...J});}
 // los objetivos: el botín se alcanza desde la calle por dentro; las distancias de juego
 for(const st of mp.sites){med.objetivos++;const L=bp.lots[st.lot],pisos=navEdificio(L),p0=pisos.find(p=>p.nivel===0),B=m6(st.panels[0]),k=p0.g.idx(B.x,B.z);
  let best=-1;for(let r=0;r<=10&&best<0;r++)for(let dj=-r;dj<=r;dj++)for(let di=-r;di<=r;di++){const kk=k+dj*p0.g.nx+di;if(kk>=0&&kk<p0.dist.length&&p0.dist[kk]>=0&&(best<0||p0.dist[kk]<best))best=p0.dist[kk];}
  if(best<0)falla('no se llega caminando al botín de un objetivo',{semilla:s,objetivo:st.name,tipo:L.type});else med.botinAPuerta.push(best*NAV_RES);
  const puertas=st.guards.map(m6),dp=Math.min(...puertas.map(P=>en(dPol,P.x,P.z)));if(dp===Infinity)falla('objetivo al que la policía no llega caminando',{semilla:s,objetivo:st.name});else med.policiaAObjetivo.push(dp);
  if(dSal){const d=Math.min(...puertas.map(P=>en(dSal,P.x,P.z)));if(d<Infinity)med.objetivoASalida.push(d);else falla('objetivo sin camino a una salida al monte',{semilla:s,objetivo:st.name});}}
 // las cajas (para esconder la bolsa): en planta baja, alcanzables por dentro
 const porLote=new Map();for(const c of mp.crates)(porLote.get(c.lot)||porLote.set(c.lot,[]).get(c.lot)).push(c);
 for(const [li,cs] of porLote){const p0=navEdificio(bp.lots[li]).find(p=>p.nivel===0);for(const c of cs){med.cajas[1]++;const C2=m6(c),k=p0.g.idx(C2.x,C2.z);let ok=false;
  for(let r=0;r<=8&&!ok;r++)for(let dj=-r;dj<=r&&!ok;dj++)for(let di=-r;di<=r;di++){const kk=k+dj*p0.g.nx+di;if(kk>=0&&kk<p0.dist.length&&p0.dist[kk]>=0){ok=true;break;}}
  if(ok)med.cajas[0]++;else falla('caja a la que no se llega caminando',{semilla:s,lote:li});}}}
const r=(a)=>a.length?`mediana ${q(a,.5).toFixed(0)} m · mín ${q(a,0).toFixed(0)} · máx ${q(a,1).toFixed(0)}`:'—';
console.log(`${N} ciudades · ${med.objetivos} objetivos · cajas alcanzables ${med.cajas[0]}/${med.cajas[1]}`);
console.log(`a pie: policía → objetivo ${r(med.policiaAObjetivo)} · objetivo → salida al monte ${r(med.objetivoASalida)} · ladrón ↔ policía al aparecer ${r(med.ladronAPolicia)} · botín ↔ puerta (adentro) ${r(med.botinAPuerta)}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
