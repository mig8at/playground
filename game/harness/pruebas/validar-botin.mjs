// Nivel 9 del probador (2026-10-17): el motor del modo «Botín» (engine/juego) cumple sus propias reglas, en rondas de
// bots (medido aparte de las reglas):
//  · determinista: la misma ciudad, equipo y ronda dan lo mismo;
//  · nadie se sale del mapa ni se para donde no se camina (la grilla de rutas);
//  · la policía nunca está adentro de una vivienda ni de una guarida, y nadie preso o detenido se mueve;
//  · el valor se conserva: lo guardado + lo perdido en requisas + lo incautado en allanamientos + lo que llevan en la
//    mochila = lo robado; el botín es lo guardado en cada guarida, y una guarida allanada no vuelve a recibir nada;
//  · la ronda termina a más tardar en MODO_BOTIN.duracion y, si ganan los ladrones, el botín llegó a la meta;
//  · la gente camina sólo por donde se camina; el que pide papeles no se mueve. (Los drones se sacaron el 2026-10-18.)
// Uso: node scripts/validar-botin.mjs [ciudades=1] [semilla0=1] [rondas=3]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {prepararCiudad,crearPartida,paso} from '../src/engine/juego/partida.js';
import {decidir} from '../src/engine/juego/bots.js';
import {MODO_BOTIN as M} from '../src/engine/medidas.js';
const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||1),S0=+(A[1]||1),R=+(A[2]||3);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const med={rondas:0,pasos:0,ladrones:0,robado:0};
const jugar=(C,eq,ronda,mirar)=>{const P=crearPartida(C,{equipo:eq,ronda});let robado=0;const tom=new Set(),rob=new Set();
 while(!P.fin){decidir(P);const antes=P.agentes.map(a=>({x:a.x,z:a.z,estado:a.estado,papeles:!!a.papeles}));paso(P);med.pasos++;
  for(const o of P.C.objetivos)if(P.tomados.has(o.id)&&!tom.has(o.id)){tom.add(o.id);robado+=o.valor;}
  for(const v of P.C.viviendas)if(P.robadas.has(v.id)&&!rob.has(v.id)){rob.add(v.id);robado+=v.valor;}
  if(mirar)P.agentes.forEach((a,i)=>{const ej={ronda,equipo:eq,agente:a.id,t:+P.t.toFixed(1)};const k=P.C.mapa.cerca(a.x,a.z);
   if(k<0)falla('alguien fuera del mapa o lejos de donde se camina',{...ej,x:+a.x.toFixed(1),z:+a.z.toFixed(1)});
   if(a.equipo==='policia'&&a.estado==='adentro'&&a.lugar!==P.C.comisaria)falla('un policía adentro de una vivienda o guarida',ej);
   if(['preso','detenido'].includes(antes[i].estado)&&a.estado===antes[i].estado&&(a.x!==antes[i].x||a.z!==antes[i].z))falla('un preso o detenido que se mueve',ej);
   if(antes[i].papeles&&(a.x!==antes[i].x||a.z!==antes[i].z))falla('se mueve el que pide papeles',ej);
   });
  if(mirar)for(const g of P.gente){const k=P.C.mapa.idx(g.x,g.z);if(k<0||!P.C.mapa.libre[k]&&!P.C.mapa.libre[g.k])falla('gente donde no se camina',{ronda,x:+g.x.toFixed(1),z:+g.z.toFixed(1)});}}
 const enMochila=P.agentes.reduce((s,a)=>s+(a.mochila||0),0);return {P,robado,enMochila};};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),C=prepararCiudad(bp);
 for(const eq of [2,3,5])for(let ronda=0;ronda<R;ronda++){med.rondas++;const {P,robado,enMochila}=jugar(C,eq,ronda,true),ej={semilla:s,equipo:eq,ronda};med.robado+=robado;
  const g=P.stats.guardado.reduce((a,b)=>a+b,0),inc=P.stats.incautado,sac=P.stats.sacado;
  if(Math.abs(P.botin+P.stats.perdido+inc+enMochila-robado)>1e-6)falla('el valor no se conserva',{...ej,robado,botin:P.botin,perdido:P.stats.perdido,incautado:inc,enMochila});
  if(Math.abs(g-sac-inc-P.botin)>1e-6)falla('el botín no es lo guardado (menos lo sacado y lo incautado)',{...ej,botin:P.botin,guardado:g,sacado:sac,incautado:inc});
  const enGuaridas=P.guaridas.reduce((a,L)=>a+L.guardado,0);if(Math.abs(enGuaridas-P.botin)>1e-6)falla('el botín no es lo que hay en las guaridas',{...ej,botin:P.botin,enGuaridas});
  if(P.guaridas.some(L=>L.cerrada&&L.guardado>0))falla('una guarida allanada con botín adentro',ej);
  for(const k of ['delatadas','allanadas','incautado','sacado','huidas'])med[k]=(med[k]||0)+P.stats[k];
  if(P.fin.t>M.duracion+M.tick)falla('la ronda pasa de su duración',{...ej,t:P.fin.t});
  if(P.fin.gana==='ladron'&&P.botin<P.meta)falla('ganan los ladrones sin llegar a la meta',{...ej,botin:P.botin,meta:P.meta});
  if(ronda===0){const {P:Q}=jugar(C,eq,ronda,false);if(JSON.stringify(Q.fin)!==JSON.stringify(P.fin)||Q.botin!==P.botin)falla('no es determinista',{...ej,a:P.fin,b:Q.fin});}}}
console.log(`motor · ${N} ciudades × 2/3/5 por equipo × ${R} rondas = ${med.rondas} rondas, ${med.pasos} pasos · valor robado ${med.robado.toFixed(1)} · guaridas delatadas ${med.delatadas}, allanadas ${med.allanadas} (incautado ${med.incautado.toFixed(1)}, sacado a tiempo ${med.sacado.toFixed(1)}) · huidas de papeles ${med.huidas}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
