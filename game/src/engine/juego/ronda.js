/* La ronda jugable en el 3D (2026-10-17, REGLAS.md): lo que el jugador ladrón puede robar y guardar, cuánto vale, y la
   cuenta del botín. Puro: el 3D (acciones3d, DemoView) le pregunta qué se puede hacer donde está el jugador y le avisa
   lo que hizo. Lo que se roba es lo del mundo: los objetivos del botín (bp.botines: la caja fuerte, las joyas, la
   escultura, el cuadro) y lo de las viviendas (viviendas.js: el televisor, el portátil, el joyero), cada uno en su
   piso; se guarda en la caja de una guarida de la ronda (guaridas.js).
   · crearRonda(bp, {equipo, ronda, prep}): la ronda (sus guaridas, lo robable, la meta).
   · usosRonda(R, piso, x, z): lo que se puede hacer al alcance, en el piso del jugador ({lot, nivel} o {casa, nivel}).
   · robar(R, id, t) / guardar(R, t): lo hace; robar deja un punto para la policía (R.avisos). R.enMochila: lo que lleva,
     una cosa por vez (nombre, valor, dónde, cuándo); guardar la vacía.
   · las puertas de las viviendas (R.puertas): trancadas para el ladrón salvo las de sus guaridas y las que ya forzó; en
     cada una, forzar la chapa (VIVIENDA.forzar.tiempo s) o mirar por el visor (si hay gente: R.ocup, quién está en casa
     según las familias y la hora de la ronda: sociedad.js; R.inicio, el día y la hora del juego en que empieza). Al forzar una con gente adentro, llaman a la policía.
   · el rastro y el allanamiento (RASTRO y ALLANAMIENTO en medidas.js; REGLAS.md): robar —o huir al pedirle los papeles:
     huirPapeles(R, t)— enciende el rastro (R.rastroHasta: la policía lo ve en vivo); perseguido(R, t, si) lo marca mientras
     un policía lo corre. Guardar con el rastro encendido o perseguido DELATA la guarida (g.delatada: desde cuándo, y desde
     cuándo se puede allanar). allanar(R, id, t): pasada la espera, la policía entra e incauta todo lo guardado ahí (se
     descuenta de R.botin y va a R.incautado); la guarida queda cerrada. sacar(R, id, t): antes de eso, la banda puede
     volver a llevarse lo guardado a la mochila. Cada guarida lleva lo suyo (g.guardado).
   · precio(valor): en pesos. */
import {MODO_BOTIN as M,VIVIENDA as V,RASTRO,ALLANAMIENTO} from '../medidas.js';
import {guaridasDe} from '../guaridas.js';
import {viviendasDe,enCasa} from '../viviendas.js';
import {sociedadDe,ocupacionSociedad,inicioRonda} from '../sociedad.js';

export const PESOS=1e6;// (un punto de valor del botín: un millón de pesos)
export const ALCANCE=1.6;// m al centro de lo que se usa
export const precio=v=>'$'+Math.round(v*PESOS).toLocaleString('es-CO');

export function crearRonda(bp,{equipo=3,ronda=0,prep=null}={}){
 const lugarLote=(lot,nivel)=>({lot,nivel}),lugarCasa=(casa,nivel)=>({casa,nivel});
 const guaridas=guaridasDe(bp,{policias:equipo,ronda,prep}).map(g=>({id:g.id,texto:g.texto,caja:{x:g.caja.x,z:g.caja.z,ang:g.caja.ang,largo:g.caja.largo,fondo:g.caja.fondo},
  lugar:g.tipo==='casa'?lugarCasa(g.casa,0):lugarLote(g.lote,g.caja.nivel),vivienda:g.tipo==='casa'?`C${g.casa}`:`L${g.lote}:${g.apto}`,guardado:0,delatada:null,cerrada:false}));
 const robables=[];
 for(const b of bp.botines||[])robables.push({id:'o:'+b.id,nombre:b.nombre,donde:b.lugar,valor:b.valor,x:b.x,z:b.z,lugar:b.casa!=null?lugarCasa(b.casa,0):lugarLote(b.lote,0),grande:true});
 const vs=viviendasDe(bp),suyas=new Set(guaridas.map(g=>g.vivienda));
 // las puertas de entrada de cada vivienda: el segmento (para trancarla), dónde se para el que la usa (el visor, afuera) y
 // en qué piso queda ese lugar (el pasillo del apartamento; la calle o el patio de la casa: afuera)
 const puertas=vs.flatMap(v=>v.puertas.map((d,k)=>({id:`${v.id}#${k}`,vivienda:v.id,tipo:v.tipo,...d.puerta,x:d.x,z:d.z,lugar:v.tipo==='apto'?lugarLote(v.lote,v.nivel):{afuera:true},casa:v.casa,lote:v.lote,nivel:v.nivel??0})));
 for(const v of vs)v.robables.forEach((r,i)=>robables.push({id:`v:${v.id}:${i}`,nombre:r.nombre,donde:v.tipo==='apto'?`${v.edificio} · apto ${v.apto}`:'una casa',valor:r.valor,x:r.x,z:r.z,
  lugar:v.lote!=null?lugarLote(v.lote,v.nivel??0):lugarCasa(v.casa,r.nivel??0),vivienda:v.id}));
 return {meta:M.meta*equipo,equipo,mochila:0,enMochila:[],botin:0,incautado:0,rastroHasta:-Infinity,persiguen:false,robados:new Set(),avisos:[],guaridas,robables,registro:[],puertas,abiertas:new Set(suyas),forzando:null,
  inicio:inicioRonda(bp.seed,ronda),ocup:ocupacionSociedad(sociedadDe(bp),inicioRonda(bp.seed,ronda),M.duracion)};}

const mismoPiso=(a,b)=>a?.afuera?!b:a&&b&&a.nivel===b.nivel&&(a.lot!=null?a.lot===b.lot:a.casa===b.casa);

export function usosRonda(R,piso,x,z,t=null){const out=[];
 for(const o of R.robables){if(R.robados.has(o.id)||!mismoPiso(o.lugar,piso))continue;const d=Math.hypot(o.x-x,o.z-z);if(d>ALCANCE)continue;
  out.push({accion:'robar',id:o.id,d,texto:`Robar ${o.nombre.toLowerCase()} · ${precio(o.valor)}`});}
 for(const g of R.guaridas){if(!mismoPiso(g.lugar,piso))continue;const d=Math.hypot(g.caja.x-x,g.caja.z-z);if(d>ALCANCE)continue;
  if(g.cerrada){out.push({accion:'nada',id:g.id,d,texto:'La policía allanó esta guarida: ya no sirve'});continue;}
  const ojo=t!=null&&seguido(R,t)&&R.mochila>0?' (te están siguiendo: la delatás)':'';
  out.push({accion:'guardar',id:g.id,d,texto:R.mochila>0?`Guardar en la caja · ${precio(R.mochila)}${ojo}`:g.guardado>0?`Caja de la guarida · ${precio(g.guardado)} adentro`:'Caja de la guarida (vacía la mochila)',
   alterna:g.guardado>0&&g.delatada?{accion:'sacar',id:g.id,texto:`Sacar lo guardado · ${precio(g.guardado)}`}:null});}
 // las puertas trancadas: E fuerza la chapa, R mira por el visor
 for(const p of R.puertas){if(R.abiertas.has(p.vivienda)||!mismoPiso(p.lugar,piso))continue;const d=Math.hypot(p.x-x,p.z-z);if(d>ALCANCE)continue;
  out.push({accion:'forzar',id:p.id,vivienda:p.vivienda,d:d+.2,texto:'Forzar la chapa',alterna:{accion:'visor',id:p.id,vivienda:p.vivienda,texto:'Mirar por el visor'}});}
 return out.sort((a,b)=>a.d-b.d);}
// ¿hay gente en la vivienda? (t: segundos de ronda)
export const hayGente=(R,vivienda,t)=>enCasa(R.ocup.get(vivienda),t);
// forzar: empieza (el jugador queda quieto cerca de la puerta); a los VIVIENDA.forzar.tiempo s, la puerta queda abierta;
// si hay gente, llaman a la policía (un punto como el de un robo)
export function empezarForzar(R,id,t){const p=R.puertas.find(p=>p.id===id);if(!p)return null;R.forzando={id,vivienda:p.vivienda,x:p.x,z:p.z,desde:t,hasta:t+V.forzar.tiempo};return R.forzando;}
export function tickForzar(R,x,z,t){const F=R.forzando;if(!F)return null;if(Math.hypot(F.x-x,F.z-z)>ALCANCE+.4){R.forzando=null;return {cancelado:true};}
 if(t<F.hasta)return {resta:F.hasta-t};R.forzando=null;R.abiertas.add(F.vivienda);const gente=hayGente(R,F.vivienda,t);
 if(gente)R.avisos.push({x:F.x,z:F.z,t,que:'Llamada de los vecinos',donde:F.vivienda,llamada:true});R.registro.push({t,que:'Forzaste una chapa'+(gente?' con gente adentro: llamaron a la policía':'')});return {abierta:true,gente};}
// ¿la hoja que el 3D dibuja en (x, z) a la altura y es de una puerta trancada? (para que no se abra sola)
export function puertaTrancadaEn(R,x,z,y){for(const p of R.puertas){if(p.y==null||R.abiertas.has(p.vivienda)||Math.abs((y??p.y)-p.y)>1.6)continue;if(Math.hypot((p.x0+p.x1)/2-x,(p.z0+p.z1)/2-z)<.9)return true;}return false;}
// ¿lo dibujado (un mueble de adentro: su nombre de modelo, su punto y su piso f) es algo ya robado? Por ahora el televisor:
// el portátil va junto con la geometría fija del piso y el joyero no se dibuja (es lo de adentro de la cómoda)
export function robadoEn(R,nombre,lot,f,x,z){if(!/^tv@/.test(nombre))return false;for(const id of R.robados){const o=R.robables.find(o=>o.id===id);if(o?.nombre==='Televisor'&&o.lugar.lot===lot&&o.lugar.nivel===f&&Math.hypot(o.x-x,o.z-z)<.5)return true;}return false;}
// ¿la puerta trancada tapa el paso en (x, z) a la altura F? (el 3D dice la altura de cada puerta: p.y)
export function trancada(R,x,z,r,F){for(const p of R.puertas){if(p.y==null||R.abiertas.has(p.vivienda)||Math.abs(F-p.y)>1.2)continue;
 const x0=Math.min(p.x0,p.x1),x1=Math.max(p.x0,p.x1),z0=Math.min(p.z0,p.z1),z1=Math.max(p.z0,p.z1);if(x<x0-r||x>x1+r||z<z0-r||z>z1+r)continue;
 const dx=Math.max(x0-x,0,x-x1),dz=Math.max(z0-z,0,z-z1);if(Math.hypot(dx,dz)<r)return true;}return false;}

export function robar(R,id,t=0){const o=R.robables.find(o=>o.id===id);if(!o||R.robados.has(id))return null;R.robados.add(id);R.mochila+=o.valor;R.rastroHasta=Math.max(R.rastroHasta,t+RASTRO.robo);R.enMochila.push({id,nombre:o.nombre,valor:o.valor,donde:o.donde,t});// (lo que lleva, una por una: el menú)
 R.avisos.push({x:o.x,z:o.z,t,que:o.nombre,donde:o.donde});R.registro.push({t,que:`Robaste ${o.nombre.toLowerCase()} (${precio(o.valor)})`});return o;}
// ¿la policía lo tiene? (el rastro encendido, o un policía corriéndolo)
export const seguido=(R,t)=>R.persiguen||t<R.rastroHasta;
export function huirPapeles(R,t=0){R.rastroHasta=Math.max(R.rastroHasta,t+RASTRO.huyePapeles);R.registro.push({t,que:'Huiste cuando te pidieron los papeles: te ven en el mapa'});}
export function perseguido(R,t,si){R.persiguen=!!si;}
// guardar en la caja de la guarida id (sin id, la primera: los llamados viejos); con la policía encima, la delata
export function guardar(R,t=0,id=null){const g=id!=null?R.guaridas.find(g=>g.id===id):R.guaridas[0];if(R.mochila<=0||!g||g.cerrada)return 0;const v=R.mochila;
 R.botin+=v;g.guardado+=v;R.mochila=0;R.enMochila=[];
 if(seguido(R,t)&&!g.delatada){g.delatada={desde:t,allanable:t+ALLANAMIENTO.espera};R.avisos.push({x:g.caja.x,z:g.caja.z,t,que:'Guardaron el botín con la policía encima',donde:g.texto,guarida:g.id,allanable:g.delatada.allanable});}
 R.registro.push({t,que:`Guardaste ${precio(v)} en la guarida`+(g.delatada?.desde===t?': te vieron entrar, la pueden allanar':'')});return v;}
// la policía entra: pasada la espera, incauta todo lo guardado ahí; devuelve lo incautado (null si todavía no puede)
export function allanar(R,id,t=0){const g=R.guaridas.find(g=>g.id===id);if(!g?.delatada||g.cerrada||t<g.delatada.allanable)return null;return incautar(R,id,t);}
// incautar: la policía ya entró (lo decidió el motor de los bots: la orden y la puerta); se lleva lo de esa guarida
export function incautar(R,id,t=0){const g=R.guaridas.find(g=>g.id===id);if(!g||g.cerrada)return 0;const v=g.guardado;R.botin-=v;R.incautado+=v;g.guardado=0;g.cerrada=true;
 R.registro.push({t,que:`La policía allanó ${g.texto}`+(v?` e incautó ${precio(v)}`:': no encontró nada')});return v;}
// la banda se lleva lo guardado (antes del allanamiento): vuelve a la mochila
export function sacar(R,id,t=0){const g=R.guaridas.find(g=>g.id===id);if(!g||g.cerrada||g.guardado<=0)return 0;const v=g.guardado;R.botin-=v;g.guardado=0;R.mochila+=v;
 R.enMochila.push({id:'g:'+g.id,nombre:'Lo guardado en la guarida',valor:v,donde:g.texto,t});R.registro.push({t,que:`Sacaste ${precio(v)} de la guarida`});return v;}
export const gano=R=>R.botin>=R.meta;
