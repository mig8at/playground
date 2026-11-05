// Nivel 9 del probador: la rutina (2026-10-18, engine/rutina.js), en el 2D, una semana de la ciudad.
//  · La semana normal contra las metas (scripts/datos/objetivos-rutina.json, medirRutina.js): las de peso 3 son reglas
//    (de madrugada en casa, los estudiantes en el colegio, nadie se pierde lo obligatorio) y si no se cumplen es falla;
//    las otras son metas de calibración (provisorias) y se muestran, para calibrar.mjs.
//  · Perturbaciones el martes: un trancón (los buses de 6:30 a 9 tardan media hora más), un robo frente al colegio a la
//    salida (el que pasa a menos de 120 m de 14:45 a 15:30 corre o da la vuelta: 15 min) y el cierre de la panadería
//    más cercana al colegio. Se compara con la semana normal:
//     – lo obligatorio casi no se pierde (a lo sumo PERDIDAS_MAX de lo obligatorio del martes) y los eventos sí atrasan
//       a alguien (llegadas tarde);
//     – lo que se cae primero es lo opcional (ocio, ejercicio): crece más que la comida pendiente, y nadie deja de comer;
//     – nadie va al lugar cerrado;
//     – la ciudad vuelve a ser la misma: el miércoles a las 3 todos en casa, la parte de la gente que hace exactamente lo
//       mismo que en la semana normal no baja de un día a otro y el domingo es al menos IGUAL_MIN (el gimnasio y el
//       mercado tienen ciclos de varios días: la diferencia tarda un ciclo en irse).
//  · La misma ciudad con los mismos eventos da la misma semana.
// Uso: node scripts/validar-rutina.mjs [ciudades=2] [semilla0=1]
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {generateBlueprint} from '../src/engine/blueprint.js';
import {sociedadDe,dondeEsta,horarioDia} from '../src/engine/sociedad.js';
import {curvas,indicadores,perdida} from '../src/engine/medirRutina.js';
import {RELOJ} from '../src/engine/medidas.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||2),S0=+(A[1]||1),PERDIDAS_MAX=.01,IGUAL_MIN=.9;
const O=JSON.parse(readFileSync(fileURLToPath(new URL('./datos/objetivos-rutina.json',import.meta.url)),'utf8')).metas;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const huella=segs=>segs.map(s=>`${s.donde}|${s.que}|${s.d.toFixed(2)}`).join(';');
const H=3600,t0=performance.now();
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),ej={semilla:s};
 // ---- la semana normal ----
 const B=sociedadDe(bp,{eventos:[]}),med={curvas:curvas(B),indicadores:indicadores(B)},L=perdida(med,O);
 console.log(`ciudad ${s} · semana normal: ${L.detalle.filter(d=>d.ok).length} de ${L.detalle.length} metas (pérdida ${L.perdida}) · ${JSON.stringify(med.indicadores)}`);
 for(const [i,d] of L.detalle.entries()){const o=O[i];if(!d.ok){if((o.peso||1)>=3)falla(`regla: ${d.meta}`,{...ej,valor:d.valor,rango:d.rango});else console.log(`   fuera de la meta (calibrar): ${d.meta} = ${d.valor} ${JSON.stringify(d.rango)}`);}}
 // ---- el martes con eventos ----
 const col=[...B.lugares.values()].find(l=>l.tipo==='colegio'),pan=[...B.lugares.values()].filter(l=>l.tipo==='panaderia').sort((a,b)=>Math.hypot(a.x-col.x,a.z-col.z)-Math.hypot(b.x-col.x,b.z-col.z))[0];
 const ev=[{dia:1,tipo:'trancon',desde:6.5,hasta:9,demora:.5},{dia:1,tipo:'robo',desde:14.75,hasta:15.5,x:col.x,z:col.z,r:120,demora:.25},...(pan?[{dia:1,tipo:'cierre',lugar:pan.id}]:[])];
 const E=sociedadDe(bp,{eventos:ev}),E2=sociedadDe(bp,{eventos:ev});
 if(E.personas.some((p,i)=>huella(p.semana.flat())!==huella(E2.personas[i].semana.flat())))falla('la misma ciudad con los mismos eventos da otra semana',ej);
 const DB=B.diario,DE=E.diario;let obl=0,perd=0,tarde=0,tardeB=0,dem=0,atras=0,bus=0;const pos={B:{},E:{}};let comB=0,comE=0,n=0;
 for(const p of E.personas){const e=DE.get(p.id)?.[1],b=DB.get(p.id)?.[1];if(!e||!b)continue;n++;
  obl+=e.hechas.length+e.perdidas.length;dem+=e.demora;if(e.demora>0)atras++;bus+=e.bus;perd+=e.perdidas.length;tarde+=e.tarde.length;tardeB+=b.tarde.length;comB+=b.comidas;comE+=e.comidas;
  for(const k of Object.keys(b.pospuestas))pos.B[k]=(pos.B[k]||0)+1;for(const k of Object.keys(e.pospuestas))pos.E[k]=(pos.E[k]||0)+1;}
 const d=k=>(pos.E[k]||0)-(pos.B[k]||0),opcional=d('ocio')+d('fisico'),comida=d('hambre');
 console.log(`   martes con eventos: ${atras} personas atrasadas (${Math.round(dem*60)} min en total; ${bus} viajes en bus) · llegadas tarde ${tarde} (normal ${tardeB}) · perdidas ${perd} de ${obl} · pendientes: ocio ${d('ocio')>=0?'+':''}${d('ocio')}, ejercicio ${d('fisico')>=0?'+':''}${d('fisico')}, comida ${comida>=0?'+':''}${comida}, mercado ${d('despensa')>=0?'+':''}${d('despensa')} · comidas por persona ${(comE/n).toFixed(2)} (normal ${(comB/n).toFixed(2)})`);
 if(perd/Math.max(1,obl)>PERDIDAS_MAX)falla('con eventos se pierde lo obligatorio',{...ej,perdidas:perd,de:obl});
 if(!(dem>0))falla('los eventos no atrasan a nadie',{...ej,atrasadas:atras});
 if(comida>Math.max(2,opcional))falla('con apuro se deja de comer antes que lo opcional',{...ej,opcional,comida});
 if(comE/n<comB/n-.3)falla('con eventos la gente come mucho menos',{...ej,normal:+(comB/n).toFixed(2),eventos:+(comE/n).toFixed(2)});
 if(pan)for(const p of E.personas)for(const sg of p.semana[1])if(sg.donde===pan.id&&sg.que!=='trabaja'){falla('alguien va al lugar cerrado',{...ej,persona:p.id,lugar:pan.id});break;}
 // ---- vuelve a ser la misma ----
 const a3=(2*24+3)*H;let fuera=0;for(const p of E.personas){const x=dondeEsta(E,p,a3);if(x.donde!==p.hogar&&!(x.que==='trabaja'&&horarioDia(E.lugares.get(x.donde)?.tipo,2)?.[1]===24))fuera++;}
 if(fuera)falla('el miércoles a las 3, no todos en casa después de los eventos',{...ej,fuera});
 const igual=[];for(const dia of [2,3,4,5,6]){let ig=0;for(let i=0;i<E.personas.length;i++)if(huella(E.personas[i].semana[dia])===huella(B.personas[i].semana[dia]))ig++;igual.push(ig/E.personas.length);}
 let dh=0;for(let i=0;i<E.personas.length;i++)dh+=Math.abs(E.personas[i].nec.hambre-B.personas[i].nec.hambre);dh/=E.personas.length;
 console.log(`   después: el miércoles a las 3, ${fuera} fuera de casa · iguales a la semana normal, de miércoles a domingo: ${igual.map(v=>(100*v).toFixed(1)+' %').join(', ')} · diferencia de hambre al final ${dh.toFixed(3)}`);
 if(igual[4]<IGUAL_MIN)falla('la ciudad no vuelve a ser la misma después de los eventos',{...ej,domingo:+igual[4].toFixed(3)});
 if(igual[4]+.01<igual[0])falla('la diferencia crece con los días (no se estabiliza)',{...ej,miercoles:+igual[0].toFixed(3),domingo:+igual[4].toFixed(3)});}
let total=0;for(const [k,f] of fallas){total+=f.n;console.log(`  ${f.n}\t${k}`);for(const e of f.ej)console.log('     '+JSON.stringify(e).slice(0,240));}
console.log(`rutina · ${N} ciudades · la semana contra las metas, un martes con trancón, robo y cierre, y la vuelta a lo normal · ${((performance.now()-t0)/1000).toFixed(0)} s`);
console.log(`fallas: ${total}`);
