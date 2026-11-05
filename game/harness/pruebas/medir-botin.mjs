// El equilibrio del modo «Botín» (2026-10-17): rondas de bots contra bots (engine/juego) por ciudad y tamaño de equipo;
// cuántas gana cada lado, por qué, en cuánto tiempo, y lo que pasó en ellas (robos, requisas, presos, rescates, alarmas,
// llamadas, cámaras). Con esto se calibra MODO_BOTIN (la meta, la duración…). Uso:
// node scripts/medir-botin.mjs [ciudades=2] [rondas=20] [equipos=2,3,5,8] [semilla0=1] [--metas=4,6,8] (la meta por ladrón a probar)
import {generateBlueprint} from '../src/engine/blueprint.js';
import {prepararCiudad,crearPartida,paso} from '../src/engine/juego/partida.js';
import {decidir} from '../src/engine/juego/bots.js';
import {MODO_BOTIN as M} from '../src/engine/medidas.js';
const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||2),R=+(A[1]||20),EQ=(A[2]||'2,3,5,8').split(',').map(Number),S0=+(A[3]||1);
const METAS=(process.argv.find(a=>a.startsWith('--metas='))?.slice(8)||String(M.meta)).split(',').map(Number),res={};const t0=Date.now();
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),C=prepararCiudad(bp);
 for(const meta of METAS)for(const eq of EQ)for(let ronda=0;ronda<R;ronda++){const P=crearPartida(C,{equipo:eq,ronda,meta});while(!P.fin){decidir(P);paso(P);}
  const k=meta+'|'+eq,o=res[k]||(res[k]={n:0,ladron:0,por:{},t:[],botin:[],st:{}});o.n++;if(P.fin.gana==='ladron')o.ladron++;o.por[P.fin.por]=(o.por[P.fin.por]||0)+1;o.t.push(P.fin.t);o.botin.push(P.botin/P.meta);
  for(const [k,v] of Object.entries(P.stats))o.st[k]=(o.st[k]||0)+(Array.isArray(v)?v.length:v);}}
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.min(b.length-1,Math.floor(p*b.length))];};
console.log(`botín · ${N} ciudades × ${R} rondas · metas por ladrón ${METAS.join('/')} · ${M.duracion} s · ${((Date.now()-t0)/1000).toFixed(0)} s`);
for(const [k,o] of Object.entries(res)){const [meta,eq]=k.split('|');console.log(`  meta ${meta} · ${eq} vs ${eq}: ladrones ${(o.ladron/o.n*100).toFixed(0)} % (${Object.entries(o.por).map(([k,v])=>k+' '+v).join(', ')}) · dura p50 ${q(o.t,.5).toFixed(0)} s · botín p50 ${(q(o.botin,.5)*100).toFixed(0)} % de la meta · por ronda: ${Object.entries(o.st).map(([k,v])=>k+' '+(v/o.n).toFixed(1)).join(', ')}`);}
