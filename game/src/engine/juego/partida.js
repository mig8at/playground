/* Una partida del modo «Botín» (2026-10-17): el estado y sus reglas, paso a paso. Puro y determinista (semilla y ronda).
   Reglas en medidas.js MODO_BOTIN (y VIVIENDA, GUARIDA, BOTIN); los bots deciden en bots.js; lo mide medir-botin.
   · prepararCiudad(bp): lo que no cambia entre rondas —el mapa de rutas, la comisaría, los objetivos del botín y las
     viviendas con sus puertas y lo que tienen para robar—, y la caché de campos de distancia por lugar.
   · crearPartida(C, {equipo, ronda}): las guaridas de la ronda, quién está en casa, los ladrones (cada uno en una
     guarida) y los policías (en las puertas de la comisaría).
   · paso(P, dt): mueve a cada uno hacia su destino, avanza su acción, ve, reconoce, requisa, avisa y mira si alguien ganó.
   · la gente: personas que caminan por las calles y el monte (sin rumbo, por la grilla de rutas); entre ellas, el ladrón
     que no tiene retrato pasa por uno más: la policía sólo puede pedirle papeles a cualquiera (pedirPapeles). Mientras se
     los piden, el otro se queda quieto. Un ladrón con botín va a la cárcel; sin botín, su nombre no está en el censo
     (sociedad.js: el que dice no es de ninguna familia) y queda marcado: con retrato (2026-10-17).
   · (los drones de la policía —un policía sentado en un PC de la comisaría manejando uno— se sacaron el 2026-10-18:
     con el mapa del menú, el rastro y la zona de búsqueda sobraban, y un ojo permanente en el cielo le quitaba el
     sentido al rastro corto. El código quedó en before/dron/.)
   · el rastro y el allanamiento (2026-10-18; RASTRO y ALLANAMIENTO en medidas.js, REGLAS.md): robar enciende el rastro
     del ladrón (a.rastroHasta) y también huir de los papeles; mientras dura, o si la policía lo está viendo (P.vistos de
     hace un instante), guardar DELATA la guarida (L.delatada; un aviso 'delatada'). Cada guarida lleva lo suyo
     (L.guardado). allanar(P, c, L): un policía en su puerta, pasada la espera, incauta todo lo guardado (se descuenta de
     P.botin) y requisa a los de adentro; la guarida queda cerrada. sacar: la acción de un ladrón que se lleva lo guardado
     de una guarida delatada antes del allanamiento.
   Un lugar (guarida, objetivo, vivienda, comisaría) se usa desde sus puertas (sus puntos de afuera); adentro se cuenta el
   tiempo. Las viviendas y las guaridas son privadas (la policía no entra: el que está adentro no se ve ni se toca); un
   objetivo no (un policía en su puerta alcanza al que está adentro). */
import {MODO_BOTIN as M,VIVIENDA as V,RASTRO,ALLANAMIENTO} from '../medidas.js';
import {mapaDeJuego} from './mapa.js';
import {prepararGuaridas,guaridasDe,entradasLote,entradasCasa} from '../guaridas.js';
import {viviendasDe,enCasa} from '../viviendas.js';
import {sociedadDe,ocupacionSociedad,inicioRonda} from '../sociedad.js';
import {rng,mix} from '../veredas.js';

export function prepararCiudad(bp){const mapa=mapaDeJuego(bp),prep=prepararGuaridas(bp),est=bp.lots.find(L=>L.type==='comisaria');
 const pL=li=>entradasLote(bp.lots[li]),pC=ci=>entradasCasa(bp.isla.casas[ci]);
 // los objetivos del botín: la alarma suena en los de mucho valor (la caja fuerte, las joyas); las cámaras, en los edificios
 const edif=(lote,casa)=>casa!=null?'C'+casa:lote!=null?'L'+lote:null;// (el edificio del lugar, para pintarlo en el mapa del menú: 'L'+lote o 'C'+casa)
 const objetivos=(bp.botines||[]).map(b=>({id:'o:'+b.id,clase:'objetivo',edificio:edif(b.lote,b.casa),nombre:`${b.nombre} · ${b.lugar}`,valor:b.valor,tiempo:b.tiempo,alarma:b.valor>=4,camara:b.casa==null,privado:false,puntos:b.casa!=null?pC(b.casa):pL(b.lote),subir:0}));
 // las viviendas: lo robable suma su valor y su tiempo; al apartamento se sube (unos segundos por piso)
 const viviendas=viviendasDe(bp).filter(v=>v.puertas.length).map(v=>({id:'v:'+v.id,clase:'vivienda',tipo:v.tipo,edificio:edif(v.lote,v.casa),nombre:v.tipo==='apto'?`${v.edificio} · apto ${v.apto}`:`Casa ${v.direccion||v.id}`,
  valor:v.robables.reduce((a,r)=>a+r.valor,0),tiempo:v.robables.reduce((a,r)=>a+(V.robables[r.objeto]?.tiempo||3),0),camara:v.tipo==='apto',privado:true,puntos:v.lote!=null?pL(v.lote):pC(v.casa),subir:v.tipo==='apto'?3*v.nivel:0}));
 return {bp,mapa,prep,comisaria:{id:'comisaria',puntos:entradasLote(est),edificio:'L'+bp.lots.indexOf(est)},objetivos,viviendas,campos:new Map()};}

// el campo de distancias de un lugar (guardado: los lugares no se mueven)
export const campoDe=(C,L)=>C.campos.get(L.id)||C.campos.set(L.id,C.mapa.campo(L.puntos)).get(L.id);

export function crearPartida(C,{equipo=3,ronda=0,meta=M.meta}={}){const bp=C.bp,r=rng(mix(bp.seed,ronda,7919));
 const guaridas=guaridasDe(bp,{policias:equipo,ronda,prep:C.prep}).map(g=>({id:'g:'+g.lugar,clase:'guarida',nombre:g.texto,camara:g.tipo==='edificio',privado:true,puntos:g.entradas.map(e=>[e.x,e.z]),subir:g.tipo==='edificio'?3*g.piso:0,edificio:g.casa!=null?'C'+g.casa:'L'+g.lote,guardado:0,delatada:null,cerrada:false}));
 const inicio=inicioRonda(bp.seed,ronda),ocup=ocupacionSociedad(sociedadDe(bp),inicio,M.duracion);// (quién está en casa: las familias a la hora de la ronda)
 const agentes=[];
 for(let i=0;i<equipo;i++){const g=guaridas[i%guaridas.length],[x,z]=g.puntos[0];agentes.push({id:'L'+(i+1),equipo:'ladron',x,z,estado:'libre',mochila:0,retrato:false,expuestoHasta:-1,rastroHasta:-1,accion:null,ruta:null,lugar:null,hasta:0,decide:0});}
 for(let i=0;i<equipo;i++){const [x,z]=C.comisaria.puntos[i%C.comisaria.puntos.length];agentes.push({id:'P'+(i+1),equipo:'policia',x,z,estado:'libre',accion:null,ruta:null,decide:0});}
 // la gente: en celdas libres al azar de la ronda (más en la ciudad, que es donde hay más calle)
 const m=C.mapa,gente=[];for(let i=0,tries=0;i<M.gente.porJugador*2*equipo&&tries<1e5;tries++){const k=Math.floor(r()*m.nx*m.nz);if(!m.libre[k]||m.vecinos(k).length<3)continue;const c=m.centro(k);gente.push({x:c.x,z:c.z,k,prev:-1,sig:null});i++;}
 return {C,ronda,equipo,t:0,inicio,r,guaridas,ocup,agentes,gente,botin:0,meta:meta*equipo,tomados:new Set(),robadas:new Set(),avisos:[],vistos:new Map(),
  fin:null,stats:{requisas:0,presos:0,detenidos:0,rescates:0,guardado:[],perdido:0,alarmas:0,llamadas:0,camaras:0,papeles:0,papelesLadron:0,delatadas:0,allanadas:0,incautado:0,sacado:0,huidas:0}};}

const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const aviso=(P,tipo,x,z,extra={})=>{P.avisos.push({tipo,x,z,t:P.t,...extra});const k={alarma:'alarmas',llamada:'llamadas',camara:'camaras'}[tipo];if(k)P.stats[k]++;};
// ¿la policía lo tiene? (el rastro encendido, o lo está viendo ahora: P.vistos de hace un instante)
export const seguido=(P,a)=>a.rastroHasta>P.t||(P.vistos.get(a.id)?.t??-1e9)>=P.t-2*M.tick;
export const libres=(P,eq)=>P.agentes.filter(a=>a.equipo===eq&&a.estado==='libre');

// ir a un lugar (por su campo) o a un punto suelto (sin campo: derecho si se ve, si no por un campo hecho en el momento)
export function irA(P,a,L){a.ruta={L};a.lugar=null;}
export function irAPunto(P,a,x,z){a.ruta={punto:{x,z}};}

function mover(P,a,dt,v){const R=a.ruta;if(!R)return false;if(!R.L&&!R.punto){a.ruta=null;return true;}// (un lugar que no hay: sin ruta)
const C=P.C,m=C.mapa;let paso=v*dt;
 if(R.L){const f=campoDe(C,R.L);while(paso>0){const nx=m.siguiente(f,a.x,a.z);if(!nx){a.ruta=null;return true;}const d=dist(a,nx),s=Math.min(paso,d);a.x+=(nx.x-a.x)/Math.max(d,1e-6)*s;a.z+=(nx.z-a.z)/Math.max(d,1e-6)*s;paso-=s;if(s<d)break;}return false;}
 const p=R.punto;if(dist(a,p)<=paso){a.x=p.x;a.z=p.z;a.ruta=null;return true;}
 if(m.ve(a,p)){const d=dist(a,p);a.x+=(p.x-a.x)/d*paso;a.z+=(p.z-a.z)/d*paso;return false;}
 // (sin vista: un campo desde el punto, guardado mientras el punto no se mueva más de 4 m)
 if(!R.f||dist(R.fp,p)>4){R.f=m.campo([[p.x,p.z]]);R.fp={...p};}
 while(paso>0){const nx=m.siguiente(R.f,a.x,a.z);if(!nx){a.ruta=null;return true;}const d=dist(a,nx),s=Math.min(paso,d);a.x+=(nx.x-a.x)/Math.max(d,1e-6)*s;a.z+=(nx.z-a.z)/Math.max(d,1e-6)*s;paso-=s;if(s<d)break;}return false;}

// lo que hace un ladrón en un lugar al llegar (la acción la pone el bot: {tipo, L, resta})
//  · tipos: 'guardar' (guarida), 'tomar' (objetivo), 'robar' (vivienda: forzar + robar), 'esconder' (vivienda o guarida:
//    forzar si no es suya + quedarse), 'rescatar' (puerta de la comisaría), 'mirar' (el visor de una vivienda)
export function empezar(P,a,tipo,L,extra={}){if(!L){a.accion=null;return;}// (sin lugar adonde ir —todas las guaridas allanadas o lejos de todo—: nada)
 a.accion={tipo,L,resta:0,fase:'llegar',...extra};irA(P,a,L);}

function avanzarAccion(P,a,dt){const A=a.accion;if(!A)return;const L=A.L;
 if(A.fase==='llegar'){if(a.ruta)return;// (llegó a una puerta)
  if(A.tipo==='rescatar'){A.fase='hacer';A.resta=M.rescate;return;}
  if(A.tipo==='mirar'){A.fase='hacer';A.resta=V.visor.mira;return;}
  // entrar: a lo suyo directo; a una vivienda ajena, forzando (se oye); con la mochila llena, la cámara del edificio
  const ajena=L.clase==='vivienda';A.fase='entrar';A.resta=M.entrar+(ajena?V.forzar.tiempo:0)+(L.subir||0);
  if(ajena)for(const c of libres(P,'policia'))if(dist(c,a)<=V.forzar.ruido){aviso(P,'ruido',a.x,a.z,{lugar:L.id,quien:a.id});a.expuestoHasta=P.t+M.expuesto;break;}
  if(L.camara&&a.mochila>0){a.retrato=true;aviso(P,'camara',a.x,a.z,{lugar:L.id,quien:a.id});}
  return;}
 A.resta-=dt;if(A.resta>0)return;
 if(A.fase==='entrar'){a.estado='adentro';a.lugar=L;
  // con gente en casa: a los pocos segundos llaman a la policía (sabe en qué vivienda)
  if(L.clase==='vivienda'&&enCasa(P.ocup.get(L.id),P.t))A.llamada=P.t+V.llamada.demora;A.quien=a.id;
  A.fase='hacer';A.resta=A.tipo==='guardar'?.5:A.tipo==='tomar'?L.tiempo:A.tipo==='robar'?L.tiempo:(A.quedarse||10);return;}
 if(A.fase==='hacer'){
  if(A.tipo==='mirar'){A.lleno=enCasa(P.ocup.get(L.id),P.t);a.accion={...A,fase:'hecho'};return;}
  if(A.tipo==='rescatar'){const presos=P.agentes.filter(b=>b.equipo==='ladron'&&b.estado==='preso');if(presos.length){P.stats.rescates++;for(const b of presos){b.estado='libre';b.x=a.x;b.z=a.z;b.accion=null;b.ruta=null;}}a.expuestoHasta=P.t+M.expuesto;a.accion=null;return;}
  if(A.tipo==='guardar'){if(a.mochila>0&&!L.cerrada){P.botin+=a.mochila;L.guardado+=a.mochila;P.stats.guardado.push(a.mochila);a.mochila=0;
    if(seguido(P,a)&&!L.delatada){L.delatada={desde:P.t,allanable:P.t+ALLANAMIENTO.espera,quien:a.id};P.stats.delatadas++;const [x,z]=L.puntos[0];aviso(P,'delatada',x,z,{lugar:L.id,allanable:L.delatada.allanable});}}}
  else if(A.tipo==='sacar'){if(!L.cerrada&&L.guardado>0){a.mochila+=L.guardado;P.botin-=L.guardado;P.stats.sacado+=L.guardado;L.guardado=0;}}
  else if(A.tipo==='tomar'&&!P.tomados.has(L.id)){P.tomados.add(L.id);a.mochila+=L.valor;a.expuestoHasta=P.t+M.expuesto;a.rastroHasta=P.t+RASTRO.robo;aviso(P,L.alarma?'alarma':'robo',a.x,a.z,{lugar:L.id,quien:a.id});/* (sin alarma también: «cada robo pone un punto en su mapa» —REGLAS.md—; la alarma es la que suena) */}
  else if(A.tipo==='robar'&&!P.robadas.has(L.id)){P.robadas.add(L.id);a.mochila+=L.valor;a.expuestoHasta=P.t+M.expuesto;a.rastroHasta=P.t+RASTRO.robo;aviso(P,'alarma',a.x,a.z,{lugar:L.id,quien:a.id});}
  A.fase='salir';A.resta=M.entrar;return;}
 if(A.fase==='salir'){a.estado='libre';a.lugar=null;a.accion=null;}}

// pedir papeles: el policía se queda quieto M.gente.papeles s frente a alguien (una persona de la gente o un ladrón sin
// retrato: no sabe cuál); al terminar, si era un ladrón y sigue ahí con botín encima, a la cárcel
export function pedirPapeles(P,c,blanco){if(c.papeles||c.estado!=='libre')return false;c.papeles={blanco,resta:M.gente.papeles};c.ruta=null;P.stats.papeles++;
 const l=blanco?.ladron&&P.agentes.find(x=>x.id===blanco.ladron);if(l)l.quieto=P.t+M.gente.papeles;return true;}
// registrar una guarida (2026-10-17): el policía que entró persiguiendo requisa a todos los que estén adentro
export function registrar(P,c,L){const ad=P.agentes.filter(a=>a.equipo==='ladron'&&a.estado==='adentro'&&a.lugar===L);for(const a of ad)requisa(P,c,a);return ad;}
// allanar (2026-10-18): un policía en la puerta de una guarida delatada, pasada la espera, entra: incauta lo guardado y
// requisa a los que estén adentro; la guarida queda cerrada. Devuelve {incautado, adentro} o null (no puede todavía)
export const puertaCerca=(L,c,r=3)=>L.puntos.some(([x,z])=>Math.hypot(x-c.x,z-c.z)<=r);
export function allanar(P,c,L){if(!L?.delatada||L.cerrada||P.t<L.delatada.allanable)return null;const v=L.guardado;
 P.botin-=v;P.stats.incautado+=v;P.stats.allanadas++;L.guardado=0;L.cerrada=true;const adentro=registrar(P,c,L);return {incautado:v,adentro};}
// requisa: con botín encima, a la cárcel (se pierde lo que llevaba); sin nada, detenido un rato por sospecha
export function requisa(P,c,a){P.stats.requisas++;const [x,z]=P.C.comisaria.puntos[0];a.accion=null;a.ruta=null;a.lugar=null;a.x=x;a.z=z;
 if(a.mochila>0){P.stats.perdido+=a.mochila;a.mochila=0;a.estado='preso';P.stats.presos++;}else{a.estado='detenido';a.hasta=P.t+M.sospecha;P.stats.detenidos++;}}

export function paso(P,dt=M.tick){if(P.fin)return;P.t+=dt;
 // la gente camina: de celda en celda, sin volver atrás si puede
 const m=P.C.mapa,vg=M.gente.velocidad*dt;
 for(const p of P.gente){if(!p.sig){const vs=m.vecinos(p.k).map(([k])=>k).filter(k=>k!==p.prev),k=(vs.length?vs:[p.prev])[Math.floor(P.r()*(vs.length||1))];if(k==null||k<0)continue;p.sig=k;}
  const c=m.centro(p.sig),d=Math.hypot(c.x-p.x,c.z-p.z);if(d<=vg){p.x=c.x;p.z=c.z;p.prev=p.k;p.k=p.sig;p.sig=null;}else{p.x+=(c.x-p.x)/d*vg;p.z+=(c.z-p.z)/d*vg;}}
 for(const a of P.agentes){
  if(a.estado==='detenido'&&P.t>=a.hasta){a.estado='libre';a.decide=0;}
  if(a.estado==='preso'||a.estado==='detenido')continue;
  if(a.accion?.llamada&&P.t>=a.accion.llamada){aviso(P,'llamada',a.x,a.z,{lugar:a.accion.L.id,quien:a.id});a.accion.llamada=null;}
  // (quieto: el que pide papeles)
  if(a.papeles){a.papeles.resta-=dt;if(a.papeles.resta<=0){const b=a.papeles.blanco,l=b.ladron&&P.agentes.find(x=>x.id===b.ladron);a.papeles=null;
    if(l&&l.estado==='libre'&&Math.hypot(l.x-a.x,l.z-a.z)<=M.gente.papelesA+1.5){P.stats.papelesLadron++;if(l.mochila>0)requisa(P,a,l);else{l.retrato=true;P.stats.censo=(P.stats.censo||0)+1;}}
    else if(l&&l.estado==='libre'){l.rastroHasta=Math.max(l.rastroHasta,P.t+RASTRO.huyePapeles);P.stats.huidas++;}}continue;}// (se fue: huyó de los papeles)
  if(a.estado==='libre'&&!(a.quieto>P.t))mover(P,a,dt,M.velocidad[a.equipo]);// (quieto: le están pidiendo los papeles)
  if(a.equipo==='ladron'&&!(a.quieto>P.t))avanzarAccion(P,a,dt);}
 // la vista de la policía: a un ladrón afuera (o adentro de un objetivo, desde su puerta) lo ve si está a la vista; si está
 // llamativo o ya tiene retrato, lo reconoce: sabe dónde está; a menos de M.requisa, lo requisa
 for(const c of libres(P,'policia'))for(const a of P.agentes){if(a.equipo!=='ladron'||a.estado==='preso'||a.estado==='detenido')continue;
  if(c.humano)continue;// (el policía del 3D ve con sus ojos y atrapa con E)
  const afuera=a.estado==='libre'||a.accion?.fase==='llegar',enObjetivo=a.estado==='adentro'&&a.lugar&&!a.lugar.privado;
  if(!afuera&&!enObjetivo)continue;const d=dist(c,a);if(d>M.vista)continue;if(afuera&&!P.C.mapa.ve(c,a))continue;
  if(a.expuestoHasta>P.t)a.retrato=true;if(!a.retrato)continue;P.vistos.set(a.id,{x:a.x,z:a.z,t:P.t});
  if(d<=M.requisa||enObjetivo&&d<=3)requisa(P,c,a);}
 // fin: la meta, todos presos o el tiempo
 const L=P.agentes.filter(a=>a.equipo==='ladron');
 if(P.botin>=P.meta)P.fin={gana:'ladron',por:'meta',t:P.t};
 else if(L.every(a=>a.estado==='preso'))P.fin={gana:'policia',por:'presos',t:P.t};
 else if(P.t>=M.duracion)P.fin={gana:'policia',por:'tiempo',t:P.t};}
