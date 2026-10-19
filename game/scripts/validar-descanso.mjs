// El descanso de la gente (2026-10-18, Miguel: «que cada uno tenga libertad de caminar y cumplir sus tareas; que paren,
// se sienten en una banca o se queden parados, y eso los recargue: no ver a todos caminando sin parar»). En el 2D
// (rutina.js: el cansancio; medidas.js RUTINA.necesidades.energia, lugares banca y esquina), la semana de N ciudades:
//  · nadie sentado encima de otro: en cada banca y en cada esquina, nunca más de sus asientos a la vez, y cada asiento
//    con uno solo;
//  · el cansancio: nadie pasa de CANSANCIO_MAX en el día —el máximo de cada día, rutina.js; un turno de 8 h sube ~0,9 y
//    en el trabajo no se descansa: pasar de 2 es no haber descansado nunca—;
//  · en la calle a la salida (lunes a viernes, de 15 a 19), la parte quieta —sentada en una banca o parada en la
//    esquina— entre QUIETOS[0] y QUIETOS[1] de la gente en la calle (la meta de objetivos-rutina);
//  · lo que se ve (transeuntes, 30 s junto al colegio a las 16): los sentados, en el asiento de su banca y nunca dos en el
//    mismo punto.
// Uso: node scripts/validar-descanso.mjs [ciudades=2] [semilla0=1]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {sociedadDe} from '../src/engine/sociedad.js';
import {curvas} from '../src/engine/medirRutina.js';
import {mapaDeJuego} from '../src/engine/juego/mapa.js';
import {crearTranseuntes} from '../src/engine/juego/transeuntes.js';
import {RUTINA} from '../src/engine/medidas.js';
const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||2),S0=+(A[1]||1),CANSANCIO_MAX=2,QUIETOS=[.15,.3],H=3600;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),S=sociedadDe(bp),ej={semilla:s};let usos=0,maxC=0;const cmax=[];
 // los asientos
 const por=new Map();for(const p of S.personas)for(let d=0;d<7;d++)for(const r of p.semana[d]||[]){const l=S.lugares.get(r.donde);if(!l||r.acompana||(l.tipo!=='banca'&&!(l.tipo==='esquina'&&/^se queda parado/.test(r.que))))continue;usos++;
  const k=l.id+'|'+d;(por.get(k)||por.set(k,[]).get(k)).push({p:p.id,a:r.d,b:r.h,asiento:r.asiento,cupo:RUTINA.lugares[l.tipo].asientos});}
 for(const [k,L] of por){
  for(let i=0;i<L.length;i++)for(let j=i+1;j<L.length;j++){const x=L[i],y=L[j];if(x.a<y.b-1e-9&&y.a<x.b-1e-9&&x.asiento===y.asiento)falla('dos en el mismo asiento',{...ej,lugar:k,a:x.p,b:y.p});}
  // (cuántos a la vez, en el peor momento: barriendo las llegadas y las salidas)
  const ev=L.flatMap(o=>[[o.a,1],[o.b,-1]]).sort((p,q)=>p[0]-q[0]||p[1]-q[1]);let n=0,m=0;for(const [,e] of ev){n+=e;m=Math.max(m,n);}if(m>L[0].cupo)falla('más gente que asientos',{...ej,lugar:k,a:m});}
 // el cansancio
 for(const p of S.personas)for(const D of S.diario.get(p.id)||[]){if(!D)continue;const c=D.cansancioMax||0;cmax.push(c);if(c>maxC)maxC=c;if(c>CANSANCIO_MAX)falla('alguien termina exhausto (no descansó)',{...ej,persona:p.id,cansancio:+c.toFixed(2)});}
 cmax.sort((a,b)=>a-b);
 // la calle
 const C=curvas(S,{paso:1/4}),prom=a=>{let t=0;for(let h=15;h<=19;h++)t+=C.todos.lv[a][h];return t/5;},q=prom('descansa')/Math.max(1e-9,prom('descansa')+prom('calle'));
 if(q<QUIETOS[0]||q>QUIETOS[1])falla('la parte quieta de la calle, fuera de la meta',{...ej,parte:+q.toFixed(3),meta:QUIETOS});
 // lo que se ve
 const mapa=mapaDeJuego(bp),T=crearTranseuntes(S,mapa),col=[...S.lugares.values()].find(l=>l.tipo==='colegio');let sent=0,vistos=0;
 for(let t=0;t<30;t+=1){const L=T.cerca((24+16)*H,t,col.x,col.z,150,200);vistos+=L.length;const sn=L.filter(o=>o.sentado);sent+=sn.length;
  for(let i=0;i<sn.length;i++)for(let j=i+1;j<sn.length;j++)if(Math.hypot(sn[i].x-sn[j].x,sn[i].z-sn[j].z)<.5)falla('dos sentados en el mismo punto',{...ej,a:sn[i].id,b:sn[j].id});}
 console.log(`descanso · ciudad ${s} · ${usos} ratos en banca o esquina en la semana · cansancio del día: p50 ${cmax[cmax.length>>1].toFixed(2)}, p99 ${cmax[Math.floor(cmax.length*.99)].toFixed(2)}, máx ${maxC.toFixed(2)} · en la calle de 15 a 19, quieta ${(100*q).toFixed(0)} % (meta ${QUIETOS.map(v=>v*100).join('–')} %) · a las 16 junto al colegio, sentados ${(sent/30).toFixed(1)} de ${(vistos/30).toFixed(0)} a la vista`);}
let tot=0;for(const [k,f] of fallas){tot+=f.n;console.log(`  ${f.n}\t${k}`);for(const e of f.ej)console.log('     '+JSON.stringify(e));}
console.log(`fallas: ${tot}`);
