// La medición de la rutina (2026-10-18): lo que el tester 2D (validar-rutina) y el calibrador (calibrar.mjs, experimento
// «rutina») comparan contra las metas (scripts/datos/objetivos-rutina.json). Puro.
//  · curvas(S, {dias, paso}): por hora (0-23), de lunes a viernes y el fin de semana, la parte de la gente (o de un
//    grupo) en cada actividad: casa, trabajo, estudio, comer (afuera), compras, ejercicio, ocio, calle, bus;
//  · indicadores(S): comidas por persona y día, idas al gimnasio de los socios por semana, llegadas tarde, cosas
//    perdidas, necesidades pendientes al final del día;
//  · perdida(medido, objetivos): cuánto se sale de los rangos de las metas (0 si está adentro): lo que minimiza el
//    calibrador.
import {RELOJ} from './medidas.js';
import {dondeEsta,sociedadDe} from './sociedad.js';

const H=3600;
export const ACTIVIDADES=['casa','trabajo','estudio','comer','compras','ejercicio','ocio','calle','bus','descansa'];
const COMER=/^(come |toma algo)/,COMPRAS=/^hace mercado/,EJERCICIO=/^hace ejercicio/,OCIO=/^(pasea|lee en|mira vitrinas|se toma un helado|juega en)/;
export function actividadDe(S,p,x){if(x.donde===p.hogar)return 'casa';if(x.donde==='calle')return 'calle';if(x.donde==='bus'||S.lugares.get(x.donde)?.tipo==='parada')return 'bus';{const tp=S.lugares.get(x.donde)?.tipo;if(tp==='banca'||(tp==='esquina'&&/^se queda parado/.test(x.que)))return 'descansa';}
 if(x.que==='trabaja'||x.que==='vende')return 'trabajo';if(x.que==='estudia'||x.que==='en el jardín')return 'estudio';if(COMER.test(x.que))return 'comer';if(COMPRAS.test(x.que))return 'compras';
 if(EJERCICIO.test(x.que))return 'ejercicio';if(OCIO.test(x.que))return 'ocio';if(/^con /.test(x.que))return 'acompaña';return 'otro';}
// grupos: todos, los adultos (18+), los que trabajan afuera, los estudiantes
const GRUPOS={todos:()=>true,adultos:p=>p.edad>=18,trabajan:p=>p.rol==='trabaja',estudiantes:p=>p.rol==='estudiante'};
export function curvas(S,{dias=7,paso=1/6}={}){const out={};
 for(const g of Object.keys(GRUPOS))out[g]={lv:{},fds:{}};
 const n={lv:Array(24).fill(0),fds:Array(24).fill(0)};
 for(const g of Object.keys(GRUPOS))for(const k of ['lv','fds'])for(const a of ACTIVIDADES)out[g][k][a]=Array(24).fill(0);
 const cuenta=Object.fromEntries(Object.keys(GRUPOS).map(g=>[g,S.personas.filter(GRUPOS[g]).length||1]));
 for(let t=0;t<dias*RELOJ.dia;t+=paso*H){const dia=Math.floor(t/RELOJ.dia)%7,h=Math.floor((t%RELOJ.dia)/H),k=dia>=5?'fds':'lv';n[k][h]++;
  for(const p of S.personas){const a=actividadDe(S,p,dondeEsta(S,p,t));const act=a==='acompaña'?'otro':a;if(!ACTIVIDADES.includes(act))continue;
   for(const g of Object.keys(GRUPOS))if(GRUPOS[g](p))out[g][k][act][h]+=1/cuenta[g];}}
 for(const g of Object.keys(GRUPOS))for(const k of ['lv','fds'])for(const a of ACTIVIDADES)out[g][k][a]=out[g][k][a].map((v,h)=>n[k][h]?+(v/n[k][h]).toFixed(4):0);
 return out;}
export function indicadores(S){const D=S.diario,comidas=[],gym=[],tarde=[],perdidas=[],pend={hambre:0,despensa:0,fisico:0,ocio:0,energia:0};let pd=0,obl=0;
 for(const p of S.personas){const dias=D?.get(p.id);if(!dias)continue;let g=0;
  for(const d of dias){if(!d)continue;pd++;comidas.push(d.comidas);g+=d.hechas.filter(q=>q==='hace ejercicio').length;tarde.push(d.tarde.length);perdidas.push(d.perdidas.length);obl+=d.hechas.length;for(const k of Object.keys(d.pospuestas))pend[k]++;}
  if(p.socio)gym.push(g);}
 const prom=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0,parte=f=>comidas.length?comidas.filter(f).length/comidas.length:0;
 return {comidasProm:+prom(comidas).toFixed(2),comenMenosDe2:+parte(c=>c<2).toFixed(3),gymSocioSemana:+prom(gym).toFixed(2),tardePorDia:+prom(tarde).toFixed(3),perdidasPorDia:+prom(perdidas).toFixed(4),
  pendientes:Object.fromEntries(Object.entries(pend).map(([k,v])=>[k,+(v/Math.max(1,pd)).toFixed(3)]))};}
// la pérdida: por cada meta {grupo, dias (lv|fds), actividad, horas [h0,h1], rango [min,max]} o {indicador, rango}, lo que
// se sale del rango (al cuadrado, por su peso)
export function perdida(medido,objetivos){let L=0;const det=[];
 // (o una razón —2026-10-18—: {razon:[actividades de arriba], de:[actividades del total], grupo, dias, horas}: la parte de
 // las de «de» que son de «razon», en esas horas; p. ej. de la gente en la calle, la que está quieta)
 const prom=(g,k,a,hs)=>{let s=0;for(let h=hs[0];h<=hs[1];h++)s+=medido.curvas[g][k][a][h];return s/(hs[1]-hs[0]+1);};
 for(const o of objetivos){let v;if(o.indicador)v=medido.indicadores[o.indicador];else if(o.razon){const n=o.razon.reduce((a,x)=>a+prom(o.grupo,o.dias,x,o.horas),0),d=o.de.reduce((a,x)=>a+prom(o.grupo,o.dias,x,o.horas),0);v=d>0?n/d:0;}else{const c=medido.curvas[o.grupo][o.dias][o.actividad],hs=[];for(let h=o.horas[0];h<=o.horas[1];h++)hs.push(c[h]);v=hs.reduce((a,b)=>a+b,0)/hs.length;}
  const [a,b]=o.rango,fuera=v<a?a-v:v>b?v-b:0,e=(fuera/Math.max(1e-6,(b-a)||1))**2*(o.peso||1);L+=e;det.push({meta:o.nombre,valor:+v.toFixed(3),rango:o.rango,ok:fuera===0});}
 return {perdida:+L.toFixed(4),detalle:det};}
// la estabilidad: la misma ciudad con un martes de eventos (trancón, robo frente al colegio, una panadería cerrada) contra
// la semana normal B: la parte de la gente que hace exactamente lo mismo cada día de miércoles a domingo
export function eventosDePrueba(S){const col=[...S.lugares.values()].find(l=>l.tipo==='colegio'),pan=[...S.lugares.values()].filter(l=>l.tipo==='panaderia').sort((a,b)=>Math.hypot(a.x-col.x,a.z-col.z)-Math.hypot(b.x-col.x,b.z-col.z))[0];
 return [{dia:1,tipo:'trancon',desde:6.5,hasta:9,demora:.5},{dia:1,tipo:'robo',desde:14.75,hasta:15.5,x:col.x,z:col.z,r:120,demora:.25},...(pan?[{dia:1,tipo:'cierre',lugar:pan.id}]:[])];}
const huella=segs=>segs.map(s=>`${s.donde}|${s.que}|${s.d.toFixed(2)}`).join(';');
export function estabilidad(bp,B){const E=sociedadDe(bp,{eventos:eventosDePrueba(B)}),dias=[];
 for(const d of [2,3,4,5,6]){let ig=0;for(let i=0;i<E.personas.length;i++)if(huella(E.personas[i].semana[d])===huella(B.personas[i].semana[d]))ig++;dias.push(ig/E.personas.length);}
 return {dias,domingo:dias[4],E};}
