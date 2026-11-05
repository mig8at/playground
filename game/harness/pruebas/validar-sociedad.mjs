// Nivel 9 del probador (2026-10-17, Miguel: «familias, trabajos y horarios; que todo lo podamos calibrar con el tester
// 2D pasando varios días»). La sociedad (engine/sociedad.js), pasando DIAS días cada PASO minutos del juego:
//  · cada hogar con al menos un adulto; cada niño chico (< SOCIEDAD.cuidado.solos) nunca solo: en casa con un adulto
//    del hogar, en el colegio, o en el mismo lugar que quien lo cuida;
//  · nadie en un lugar cerrado (ni trabajando ni de visita);
//  · cada lugar abierto con al menos uno de los que trabajan ahí (y los puestos sin cubrir, contados);
//  · a las 3 de la mañana, todos en casa salvo los del turno de la noche;
//  · los estudiantes en el colegio a las 10 de lunes a viernes; el sábado, nadie;
//  · el día de cada uno ordenado, sin encimarse, dentro de las 24 h; cada rato en la calle va de un lugar a otro;
//  · la misma ciudad da la misma sociedad;
//  · la ocupación de una ronda (ocupacionSociedad) cubre la ronda sin huecos y coincide con contar quién está en casa;
//  · la gente en la calle (transeuntes.js, en la primera ciudad): los caminos van por las veredas —por la calzada, a lo
//    sumo CALZADA_MAX del largo (la cebra no cuenta)—, y el que se ve está siempre en una celda caminable;
//  · el caminar (transeuntes CAMINAR): el paso mediano de una persona, casi nadie rápido, sin saltos de un cuadro a otro y
//    nadie encima de otro (tampoco al salir por una puerta), a las 11 y a la salida del colegio.
// Mide y muestra: personas por papel, los oficios, la parte de viviendas con gente y de gente en la calle por hora (de
// lunes a viernes y el fin de semana).
// Uso: node scripts/validar-sociedad.mjs [ciudades=2] [semilla0=1] [días=14]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {SOCIEDAD,RELOJ,MODO_BOTIN} from '../src/engine/medidas.js';
import {mapaDeJuego} from '../src/engine/juego/mapa.js';
import {crearTranseuntes} from '../src/engine/juego/transeuntes.js';
import {sociedadDe,dondeEsta,abierto,enCasaHogar,horarioDia,ocupacionSociedad,inicioRonda,tDeRonda,DIAS} from '../src/engine/sociedad.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||2),S0=+(A[1]||1),DIASN=+(A[2]||14),PASO=10*60,H=3600;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const med={personas:0,hogares:0,roles:{},oficios:{},vacantes:0,puestos:0,casa:{lv:Array(24).fill(0),fds:Array(24).fill(0)},calle:{lv:Array(24).fill(0),fds:Array(24).fill(0)},n:{lv:Array(24).fill(0),fds:Array(24).fill(0)},cubierto:0,abiertoN:0,ms:0};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});const t0=performance.now();const S=sociedadDe(bp);med.ms+=performance.now()-t0;
 const P=S.personas,pid=S.porId,ej={semilla:s};med.personas+=P.length;med.hogares+=S.hogares.size;med.vacantes+=S.vacantes.length;med.puestos+=S.puestos;
 for(const p of P){med.roles[p.rol]=(med.roles[p.rol]||0)+1;const o=p.oficio.replace(/ \(en casa\)/,' (en casa)');med.oficios[o]=(med.oficios[o]||0)+1;}
 // la misma ciudad, la misma sociedad
 {const bp2=generateBlueprint({seed:s,team:3}),S2=sociedadDe(bp2),f=X=>JSON.stringify(X.personas.map(p=>[p.nombre,p.edad,p.oficio,p.semana]));if(f(S)!==f(S2))falla('la misma ciudad da otra sociedad',ej);}
 for(const hog of S.hogares.values()){const M=hog.miembros.map(id=>pid.get(id));if(!M.some(p=>p.edad>=18))falla('hogar sin adultos',{...ej,hogar:hog.id});}
 // el día de cada uno
 for(const p of P)for(let d=0;d<7;d++){let t=0;for(const x of p.semana[d]){if(x.d<t-1e-9||x.h<x.d||x.h>24+1e-9||x.d<0)falla('día desordenado o encimado',{...ej,persona:p.id,dia:d,rato:x});t=x.h;
   if(x.donde==='calle'&&(!x.de||!x.a||x.de===x.a))falla('rato en la calle sin ir de un lugar a otro',{...ej,persona:p.id,dia:d});}}
 const trabajanEn=new Map();for(const p of P)if(p.trabajo)(trabajanEn.get(p.trabajo.lugar)||trabajanEn.set(p.trabajo.lugar,[]).get(p.trabajo.lugar)).push(p);
 for(let t=0;t<DIASN*RELOJ.dia;t+=PASO){const dia=Math.floor(t/RELOJ.dia)%7,h=(t%RELOJ.dia)/H,hh=Math.floor(h),fds=dia>=5?'fds':'lv',donde=new Map();
  for(const p of P)donde.set(p.id,dondeEsta(S,p,t));
  // nadie en un lugar cerrado
  for(const p of P){const x=donde.get(p.id);if(S.lugares.has(x.donde)&&!abierto(S,x.donde,t))falla('alguien en un lugar cerrado',{...ej,persona:p.id,lugar:x.donde,tipo:S.lugares.get(x.donde).tipo,cuando:`${DIAS[dia]} ${h.toFixed(2)}`,que:x.que});}
  // los chicos nunca solos
  for(const p of P){if(p.edad>=SOCIEDAD.cuidado.solos)continue;const x=donde.get(p.id);
   if(x.donde===p.hogar){if(!S.hogares.get(p.hogar).miembros.some(id=>pid.get(id).edad>=18&&donde.get(id).donde===p.hogar))falla('niño chico solo en casa',{...ej,persona:p.id,cuando:`${DIAS[dia]} ${h.toFixed(2)}`});}
   else if(x.que!=='estudia'&&x.que!=='en el jardín'){const c=donde.get(p.cuidador);if(!c||c.donde!==x.donde)falla('niño chico afuera sin quien lo cuida',{...ej,persona:p.id,cuando:`${DIAS[dia]} ${h.toFixed(2)}`,el:x.donde,cuida:c?.donde});}}
  // cada lugar abierto con alguien que trabaja ahí
  for(const l of S.lugares.values()){if(!SOCIEDAD.oficios[l.tipo]||!abierto(S,l.id,t))continue;med.abiertoN++;if((trabajanEn.get(l.id)||[]).some(p=>donde.get(p.id).donde===l.id))med.cubierto++;else falla('lugar abierto sin nadie trabajando',{...ej,lugar:l.id,tipo:l.tipo,cuando:`${DIAS[dia]} ${h.toFixed(2)}`});}
  // a las 3, en casa (salvo el turno de la noche)
  if(Math.abs(h-3)<1e-9)for(const p of P){const x=donde.get(p.id);if(x.donde!==p.hogar&&!(x.que==='trabaja'&&horarioDia(S.lugares.get(x.donde).tipo,dia)?.[1]===24))falla('fuera de casa a las 3 de la mañana',{...ej,persona:p.id,dia:DIAS[dia],donde:x.donde,que:x.que});}
  // el colegio a las 10
  if(Math.abs(h-10)<1e-9)for(const p of P){if(p.rol!=='estudiante')continue;const x=donde.get(p.id);if(dia<5&&x.que!=='estudia')falla('estudiante fuera del colegio a las 10 de un día de semana',{...ej,persona:p.id,dia:DIAS[dia],donde:x.donde});if(dia>=5&&x.que==='estudia')falla('colegio en fin de semana',{...ej,persona:p.id});}
  // lo que se mide: viviendas con gente y gente en la calle, por hora
  if(Math.abs(h-hh)<1e-9){med.n[fds][hh]++;let c=0;for(const hog of S.hogares.values())if(hog.miembros.some(id=>donde.get(id).donde===hog.id))c++;med.casa[fds][hh]+=c/S.hogares.size;
   let k=0;for(const p of P)if(donde.get(p.id).donde==='calle')k++;med.calle[fds][hh]+=k;}}
 // la ocupación de una ronda
 for(let ronda=0;ronda<3;ronda++){const ini=inicioRonda(s,ronda),O=ocupacionSociedad(S,ini,MODO_BOTIN.duracion);
  for(const [id,tr] of O){let t=0;for(const [a,b] of tr){if(Math.abs(a-t)>1e-9)falla('la ocupación de la ronda tiene huecos',{...ej,vivienda:id});t=b;}if(Math.abs(t-MODO_BOTIN.duracion)>1e-9)falla('la ocupación no cubre la ronda',{...ej,vivienda:id,hasta:t});
   for(const s2 of [0,77,150,299]){const g=enCasaHogar(S,id,tDeRonda(ini,s2))>0,tt=tr.find(([a,b])=>s2>=a&&s2<b);if(!tt||tt[2]!==g)falla('la ocupación de la ronda no coincide con quién está en casa',{...ej,vivienda:id,s:s2});}}}}
// la gente en la calle (la primera ciudad): los caminos por las veredas
{const CALZADA_MAX=.05,bp=generateBlueprint({seed:S0,team:3}),S=sociedadDe(bp),mapa=mapaDeJuego(bp),T=crearTranseuntes(S,mapa),cv=mapa.veredas();let tot=0,cal=0,n=0,afuera=0,vistos=0;
 for(const R of T.ratos.filter((_,i)=>i%60===0)){const r=T.ruta(R.de,R.a);if(!r.pl.length){falla('rato en la calle sin camino',{de:R.de,a:R.a});continue;}n++;
  for(let i=1;i<r.pl.length;i++){const a=r.pl[i-1],b=r.pl[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]),k=mapa.idx((a[0]+b[0])/2,(a[1]+b[1])/2);tot+=L;if(k>=0&&cv[k]>1)cal+=L;}}
 const col=[...S.lugares.values()].find(l=>l.tipo==='colegio');for(const h of [7,11,15,18]){const ini=(24+h)*H;for(const o of T.cerca(ini,0,col.x,col.z,200,400)){vistos++;const k=mapa.cerca(o.x,o.z);if(k<0||Math.hypot(mapa.centro(k).x-o.x,mapa.centro(k).z-o.z)>2.5)afuera++;}}
 // las esquinas de los vendedores: en la vereda (caminable y no calzada)
 const usadas=new Set(S.personas.filter(p=>p.informal).map(p=>p.informal));let malas=0;for(const id of usadas){const l=S.lugares.get(id),k=mapa.idx(l.x,l.z);if(k<0||!mapa.libre[k]||cv[k]>1){malas++;if(malas<=3)falla('vendedor en una esquina que no es vereda',{esquina:id,x:+l.x.toFixed(1),z:+l.z.toFixed(1),libre:k>=0&&!!mapa.libre[k],calzada:k>=0&&cv[k]>1});}}
 console.log(`esquinas: ${usadas.size} con vendedor, ${malas} fuera de la vereda`);
 // el caminar (2026-10-17): 30 s reales a 30 cuadros por segundo junto al colegio, a las 11 y a la salida (15): el paso de
 // cada uno, sin saltos, y nadie encima de otro (tampoco en las puertas)
 for(const [h,MAXP] of [[11,.03],[15,.06]]){const T2=crearTranseuntes(S,mapa),ini=(24+h)*H;let prev=new Map(),vels=[],enc=0,pers=0;
  for(let s2=0;s2<30;s2+=1/30){const L=T2.cerca(ini,s2,col.x,col.z,90,120);for(const o of L){const p=prev.get(o.id);if(p&&o.camina)vels.push(Math.hypot(o.x-p.x,o.z-p.z)*30);}
   prev=new Map(L.map(o=>[o.id,{x:o.x,z:o.z}]));pers+=L.length;for(let i=0;i<L.length;i++)for(let j=i+1;j<L.length;j++)if(Math.hypot(L[i].x-L[j].x,L[i].z-L[j].z)<.5)enc++;}
  vels.sort((a,b)=>a-b);const q=f=>vels[Math.floor(f*(vels.length-1))]||0,parte=enc/Math.max(1,pers);
  console.log(`caminar a las ${h}: paso mediano ${q(.5).toFixed(2)} m/s, el 99 % a menos de ${q(.99).toFixed(2)}, el más rápido ${q(1).toFixed(2)} · encimados ${(100*parte).toFixed(1)} % de la gente por cuadro`);
  if(q(.5)<1.1||q(.5)>1.5)falla('el paso mediano no es el de una persona',{hora:h,paso:+q(.5).toFixed(2)});if(q(.99)>2.6)falla('demasiada gente camina rápido',{hora:h,p99:+q(.99).toFixed(2)});
  if(q(1)>3.5)falla('alguien salta (más de 3,5 m/s de un cuadro a otro)',{hora:h,max:+q(1).toFixed(2)});if(parte>MAXP)falla('la gente se encima',{hora:h,parte:+parte.toFixed(3),max:MAXP});}
 med.calzada=cal/tot;med.caminos=n;console.log(`calle: ${n} caminos, por la calzada ${(100*cal/tot).toFixed(1)} % del largo · ${vistos} vistos a las 7, 11, 15 y 18 cerca del colegio, ${afuera} fuera de lo caminable`);
 if(cal/tot>CALZADA_MAX)falla('la gente camina por la calzada',{parte:+(cal/tot).toFixed(3),max:CALZADA_MAX});if(afuera)falla('gente fuera de lo caminable',{afuera,vistos});}
// el resumen
const pc=x=>(100*x).toFixed(0)+'%',fila=(a,n,f)=>a.map((v,i)=>n[i]?f(v/n[i]):'-');
console.log(`roles: ${Object.entries(med.roles).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${v}`).join(', ')}`);
console.log(`oficios: ${Object.entries(med.oficios).sort((a,b)=>b[1]-a[1]).slice(0,14).map(([k,v])=>`${k} ${v}`).join(', ')}`);
console.log(`viviendas con gente, lunes a viernes, de 0 a 23 h: ${fila(med.casa.lv,med.n.lv,pc).join(' ')}`);
console.log(`viviendas con gente, fin de semana:               ${fila(med.casa.fds,med.n.fds,pc).join(' ')}`);
console.log(`gente en la calle por ciudad, lunes a viernes:     ${fila(med.calle.lv,med.n.lv,v=>Math.round(v)).join(' ')}`);
console.log(`gente en la calle por ciudad, fin de semana:       ${fila(med.calle.fds,med.n.fds,v=>Math.round(v)).join(' ')}`);
console.log(`lugares abiertos con alguien trabajando: ${pc(med.cubierto/Math.max(1,med.abiertoN))} · puestos sin cubrir ${med.vacantes} de ${med.puestos}`);
let total=0;for(const [k,f] of fallas){total+=f.n;console.log(`  ${f.n}\t${k}`);for(const e of f.ej)console.log('     '+JSON.stringify(e).slice(0,260));}
console.log(`sociedad · ${N} ciudades · ${med.hogares} hogares, ${med.personas} personas, ${DIASN} días cada ${PASO/60} min · se arma en ${Math.round(med.ms/N)} ms por ciudad`);
console.log(`fallas: ${total}`);
