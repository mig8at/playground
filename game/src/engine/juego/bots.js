/* Los bots del modo «Botín» (2026-10-17): deciden más o menos cada segundo, con lo que su equipo puede saber. Sirven para
   medir el equilibrio de las reglas (medir-botin), no para ganar: simples y legibles.
   Ladrón: con la mochila llena (BOT.umbral), con policía cerca o con poco tiempo, va a guardar a la guarida más cercana;
   reconocido y con un policía cerca, se esconde en ella; con compañeros presos y sin nada encima, va a rescatarlos; si
   no, elige qué robar: valor sobre tiempo (camino + entrar + tomar), castigando lo que tiene un policía cerca. En una
   vivienda mira antes por el visor y, si hay gente, la deja (y se acuerda un rato).
   Policía: persigue al ladrón reconocido que vio hace poco; si no, va al aviso más nuevo que nadie atiende (alarma,
   llamada, cámara, ruido) y, ya ahí, le pide papeles a la gente de alrededor (de a uno, sin repetir); con presos, uno
   cuida la comisaría; los demás patrullan los objetivos de valor. (Los drones se sacaron el 2026-10-18: before/dron/.)
   El allanamiento (2026-10-18): el ladrón con la policía encima (seguido: el rastro o lo están viendo) no guarda —sigue
   de largo hasta perderla— y no usa guaridas cerradas; si una guarida con botín quedó delatada, el ladrón libre y sin
   nada encima más cercano va a sacarlo antes de la orden. La policía: el libre más cercano a una guarida delatada va a
   su puerta, la vigila y, con la orden, la allana. */
import {MODO_BOTIN as M} from '../medidas.js';
import {campoDe,empezar,irA,irAPunto,libres,pedirPapeles,seguido,allanar,puertaCerca} from './partida.js';

export const BOT={umbral:3,decide:1,amenaza:30,riesgo:50,ocupadaRecuerdo:60};
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const distA=(P,L,a)=>Math.min(...L.puntos.map(([x,z])=>Math.hypot(x-a.x,z-a.z)))>0?P.C.mapa.distEn(campoDe(P.C,L),a.x,a.z):0;
const masCerca=(P,a,lugares)=>{let b=null,bd=Infinity;for(const L of lugares){const d=P.C.mapa.distEn(campoDe(P.C,L),a.x,a.z);if(d<bd){bd=d;b=L;}}return b;};

function ladron(P,a){if(a.estado!=='libre')return;const m=P.C.mapa,A=a.accion;
 const cops=libres(P,'policia'),amenaza=cops.some(c=>dist(c,a)<BOT.amenaza&&m.ve(c,a));
 // (lo que ya está haciendo afuera: mirar terminado → robar o buscar otra)
 if(A?.fase==='hecho'&&A.tipo==='mirar'){if(A.lleno){(P.ocupadas||(P.ocupadas=new Map())).set(A.L.id,P.t+BOT.ocupadaRecuerdo);a.accion=null;}else{empezar(P,a,'robar',A.L);return;}}
 if(A&&['entrar','hacer','salir'].includes(A.fase))return;// (en medio de algo: termina primero)
 const abiertas=P.guaridas.filter(L=>!L.cerrada);if(!abiertas.length&&a.mochila>0)return;
 // (con la policía encima no guarda: delataría la guarida; sigue de largo —lejos de la guarida— hasta perderla)
 // (esconderse sí: no guarda nada; con un policía encima y reconocido, se mete igual —y el policía puede entrar persiguiendo—)
 if(a.mochila>0&&seguido(P,a)&&amenaza&&a.retrato&&abiertas.length){if(A?.tipo!=='esconder')empezar(P,a,'esconder',masCerca(P,a,abiertas),{quedarse:15});return;}
 if(a.mochila>0&&seguido(P,a)){if(A?.tipo==='guardar'){a.accion=null;a.ruta=null;}if(A?.tipo!=='esconder'&&!a.ruta){const c=cops.reduce((b,o)=>!b||dist(o,a)<dist(b,a)?o:b,null);
   const dx=c?a.x-c.x:1,dz=c?a.z-c.z:0,d=Math.hypot(dx,dz)||1;irAPunto(P,a,a.x+dx/d*25,a.z+dz/d*25);}return;}
 if(a.mochila>0&&(a.mochila>=BOT.umbral||amenaza||P.t>M.duracion-45)){if(A?.tipo!=='guardar')empezar(P,a,'guardar',masCerca(P,a,abiertas));return;}
 if(amenaza&&a.retrato&&abiertas.length){if(A?.tipo!=='esconder')empezar(P,a,'esconder',masCerca(P,a,abiertas),{quedarse:15});return;}
 // (una guarida delatada con botín, antes de la orden: el más cercano sin nada encima va a sacarlo)
 const del=P.guaridas.find(L=>L.delatada&&!L.cerrada&&L.guardado>0&&P.t<L.delatada.allanable-3&&!P.agentes.find(b=>b.id===L.delatada.quien)?.humano);// (la del jugador la saca él)
 if(del&&a.mochila===0&&!seguido(P,a)){const yo=libres(P,'ladron').filter(b=>b.mochila===0).reduce((b,o)=>!b||distA(P,del,o)<distA(P,del,b)?o:b,null);
  if(yo===a&&!P.agentes.some(b=>b!==a&&b.accion?.tipo==='sacar')){if(A?.tipo!=='sacar')empezar(P,a,'sacar',del);return;}}
 const presos=P.agentes.filter(b=>b.equipo==='ladron'&&b.estado==='preso').length;
 if(presos&&a.mochila===0){if(A?.tipo!=='rescatar')empezar(P,a,'rescatar',P.C.comisaria);return;}
 if(A&&A.fase==='llegar')return;// (sigue yendo a lo que eligió)
 // qué robar: desde donde está, un campo (una vez por elección) y el mejor valor por segundo
 const f=m.campo([[a.x,a.z]]),ocup=P.ocupadas||new Map(),v=M.velocidad.ladron;let best=null,bs=0;
 const cand=[...P.C.objetivos.filter(L=>!P.tomados.has(L.id)),...P.C.viviendas.filter(L=>L.valor>0&&!P.robadas.has(L.id)&&!(ocup.get(L.id)>P.t))];
 for(const L of cand){const d=Math.min(...L.puntos.map(([x,z])=>m.distEn(f,x,z)));if(!isFinite(d))continue;
  const t=d/v+M.entrar*2+(L.subir||0)+L.tiempo+(L.clase==='vivienda'?4:0);let s=L.valor/t;
  if(cops.some(c=>Math.min(...L.puntos.map(([x,z])=>Math.hypot(c.x-x,c.z-z)))<BOT.riesgo))s*=.35;
  if(P.agentes.some(b=>b!==a&&b.equipo==='ladron'&&b.accion?.L===L))s*=.1;// (no dos al mismo)
  if(s>bs){bs=s;best=L;}}
 if(best)empezar(P,a,best.clase==='vivienda'?'mirar':'tomar',best);}

// pedir papeles cerca de un aviso: a la persona más cercana que nadie revisó (de la gente o un ladrón sin retrato: el
// policía no sabe cuál es cuál)
function papeles(P,c,av){const Z=M.gente.zona,rev=av.revisados||(av.revisados=new Set());let b=null,bd=Infinity;
 P.gente.forEach((g,i)=>{if(rev.has('g'+i)||Math.hypot(g.x-av.x,g.z-av.z)>Z)return;const d=dist(c,g);if(d<bd){bd=d;b={key:'g'+i,x:g.x,z:g.z};}});
 for(const a of P.agentes){if(a.equipo!=='ladron'||a.estado!=='libre'||a.retrato||rev.has(a.id)||Math.hypot(a.x-av.x,a.z-av.z)>Z)continue;const d=dist(c,a);if(d<bd){bd=d;b={key:a.id,x:a.x,z:a.z,ladron:a.id};}}
 if(!b)return false;if(bd<=M.gente.papelesA){rev.add(b.key);pedirPapeles(P,c,b.ladron?{ladron:b.ladron}:{gente:b.key});}else irAPunto(P,c,b.x,b.z);return true;}

function policia(P,c){
 if(c.estado!=='libre'||c.papeles)return;
 // perseguir: el reconocido visto hace poco, el más cercano
 let pr=null,pd=Infinity;for(const [id,s] of P.vistos){if(P.t-s.t>6)continue;const a=P.agentes.find(b=>b.id===id);if(!a||a.estado==='preso'||a.estado==='detenido')continue;const d=dist(c,s);if(d<pd){pd=d;pr=s;}}
 if(pr){irAPunto(P,c,pr.x,pr.z);c.tarea='perseguir';return;}
 // allanar: el libre más cercano a una guarida delatada va a su puerta, la vigila y, con la orden, entra
 const del=P.guaridas.find(L=>L.delatada&&!L.cerrada);
 if(del){const cops0=libres(P,'policia').filter(o=>!o.papeles&&o.tarea!=='perseguir');const yo=cops0.find(o=>o.tarea==='allanar')||cops0.reduce((b,o)=>!b||distA(P,del,o)<distA(P,del,b)?o:b,null);
  if(yo===c){c.tarea='allanar';if(puertaCerca(del,c)){c.ruta=null;allanar(P,c,del);}else if(!c.ruta)irA(P,c,del);return;}}
 // un aviso nuevo: si soy el policía libre más cercano a él
 const cops=libres(P,'policia').filter(o=>o.tarea!=='perseguir');
 // (ya en el aviso: papeles a la gente de alrededor)
 if(c.aviso&&P.t-c.aviso.t<=M.aviso&&dist(c,c.aviso)<=M.gente.zona){if(papeles(P,c,c.aviso)){c.tarea='papeles';return;}c.aviso=null;}
 for(const av of [...P.avisos].reverse()){if(P.t-av.t>M.aviso)break;if(av.revisados&&c.aviso!==av&&cops.some(o=>o!==c&&o.aviso===av))continue;const yo=cops.reduce((b,o)=>!b||dist(o,av)<dist(b,av)?o:b,null);if(yo===c&&!cops.some(o=>o!==c&&o.aviso===av)){c.aviso=av;irAPunto(P,c,av.x,av.z);c.tarea='aviso';return;}}
 // con presos: el más cercano cuida la comisaría
 if(P.agentes.some(b=>b.equipo==='ladron'&&b.estado==='preso')){const g=cops.reduce((b,o)=>!b||dist(o,P.C.comisaria.puntos[0]?{x:P.C.comisaria.puntos[0][0],z:P.C.comisaria.puntos[0][1]}:o)<dist(b,{x:P.C.comisaria.puntos[0][0],z:P.C.comisaria.puntos[0][1]})?o:b,null);
  if(g===c){if(c.tarea!=='cuidar'){irA(P,c,P.C.comisaria);c.tarea='cuidar';}return;}}
 // patrullar: un objetivo de valor que siga ahí, al azar de la ronda
 if(!c.ruta||c.tarea!=='patrullar'){const os=P.C.objetivos.filter(L=>!P.tomados.has(L.id)&&L.valor>=3);const L=os.length?os[Math.floor(P.r()*os.length)]:P.C.objetivos[Math.floor(P.r()*P.C.objetivos.length)];if(L){irA(P,c,L);c.tarea='patrullar';}}}

// (el agente que maneja una persona —a.humano, 2026-10-17: el policía del 3D— no lo decide nadie: el 3D lo mueve)
export function decidir(P){for(const a of P.agentes){if(a.humano||P.t<a.decide)continue;a.decide=P.t+BOT.decide;if(a.equipo==='ladron')ladron(P,a);else policia(P,a);}}
