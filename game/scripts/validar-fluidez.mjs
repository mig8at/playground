// Nivel 10 del probador: la gente de la calle se mueve parejo, en los dos papeles (2026-10-18, Miguel: «los npc siguen
// moviéndose entrecortado, como si se teletransportaran»). De policía, la gente se ubicaba con el reloj del motor de los
// bots, que salta de a MODO_BOTIN.tick s: en el 92 % de los cuadros no se movía y en el resto saltaba a 5–20 m/s. Abre
// /demo de ladrón y de policía, mira 240 cuadros y, de cada muñeco de la gente que se ve, lo que avanza de un cuadro al
// siguiente:
//  · los que caminan van a paso de gente: p50 entre 0,8 y 2 m/s, p99 ≤ 5 m/s (alcanzar a su grupo es trotar; a saltos, 19,5);
//  · casi ningún salto: a lo sumo el 0,2 % de las muestras avanza ≥ SALTO m en un solo cuadro (lo que se ve como un
//    salto: a saltos de 4 por segundo eran ~0,3 m; medido por velocidad —≥ 4 m/s— contaba pasitos de 4 a 8 cm en un
//    cuadro de 10 ms, que no se ven y cambian con la hora de la ronda: 0,01 a 0,4 %);
//  · de los que se mueven, a lo sumo el 40 % de los cuadros quietos en el medio (a saltos, el 92 %).
// Uso: node scripts/validar-fluidez.mjs [ciudad=1] (con el servidor en 5180)
import {abrirNavegador} from './navegador.mjs';
const [ciudad=1]=process.argv.slice(2),SALTO=.25;const fallas=[],res={};const N=await abrirNavegador();
try{for(const papel of ['ladron','policia']){const P=await N.abrir(`http://localhost:5180/demo?ciudad=${ciudad}&jugadores=3${papel==='policia'?'&papel=policia':''}`);
 await P.evaluar(`new Promise(r=>{const t=setInterval(()=>{const d=window.__demo;if(d?.world&&d.soc&&d.acciones){clearInterval(t);r(1);}},300);})`,{tiempo:240000});
 await P.evaluar(`new Promise(r=>setTimeout(r,4000))`);
 const r=await P.evaluar(`(async()=>{const d=window.__demo,soc=d.soc,cuadro=()=>new Promise(r=>requestAnimationFrame(r)),ant=new Map(),pasos=[],quietoEnMedio=[0,0];let t0=performance.now(),saltos=0;
  for(let k=0;k<240;k++){await cuadro();const t=performance.now(),dt=(t-t0)/1000;t0=t;
   for(const c of soc.grupo.children){if(!c.visible)continue;const p=c.position,a=ant.get(c);
    if(a){const v=Math.hypot(p.x-a.x,p.z-a.z)/dt;if(v<20){pasos.push(v);if(Math.hypot(p.x-a.x,p.z-a.z)>=${SALTO}&&Math.hypot(p.x-a.x,p.z-a.z)<6)saltos++;}
     // (quieto entre dos cuadros en que se movió: así se ve el que va a saltos)
     if(a.v!=null){const mov=a.v>.3;if(mov){quietoEnMedio[1]++;if(v<.05)quietoEnMedio[0]++;}}ant.set(c,{x:p.x,z:p.z,v});}else ant.set(c,{x:p.x,z:p.z,v:null});}}
  const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b.length?+b[Math.min(b.length-1,Math.floor(p*b.length))].toFixed(2):0;},mov=pasos.filter(v=>v>.3);
  return {muestras:pasos.length,p50:q(mov,.5),p99:q(mov,.99),saltos,parteSaltos:+(saltos/Math.max(1,pasos.length)).toFixed(4),quietos:+(quietoEnMedio[0]/Math.max(1,quietoEnMedio[1])).toFixed(3),personas:soc.grupo.children.filter(c=>c.visible).length};})()`,{tiempo:120000});
 res[papel]=r;console.log(papel,JSON.stringify(r));
 if(r.muestras<500)fallas.push(`${papel}: muy poca gente para medir (${r.muestras} muestras)`);
 if(r.p50<.8||r.p50>2)fallas.push(`${papel}: la gente camina a ${r.p50} m/s (p50), no a paso de gente`);
 if(r.p99>5)fallas.push(`${papel}: p99 ${r.p99} m/s: hay tirones`);
 if(r.parteSaltos>.002)fallas.push(`${papel}: ${(r.parteSaltos*100).toFixed(1)} % de saltos (≥ ${SALTO} m en un cuadro)`);
 if(r.quietos>.4)fallas.push(`${papel}: el ${(r.quietos*100).toFixed(0)} % de los cuadros quieta en medio de su paso: va a saltos`);
 const e=(typeof P.errores==='function'?P.errores():P.errores)||[];for(const x of e.slice(0,2))fallas.push(`${papel}: error en la página: `+String(x).slice(0,140));await P.cerrar();}}
catch(err){fallas.push('el validador se cortó: '+String(err?.message||err).slice(0,200));}
finally{const f=p=>res[p]?`${p} p50 ${res[p].p50} · p99 ${res[p].p99} m/s · saltos ${(res[p].parteSaltos*100).toFixed(2)} % · quietos en medio ${(res[p].quietos*100).toFixed(0)} %`:`${p} —`;
 console.log(`fluidez · ciudad ${ciudad} · ${f('ladron')} · ${f('policia')}`);console.log(`fallas: ${fallas.length}`);for(const x of fallas)console.log('  '+x);await N.cerrar();process.exit(0);}
