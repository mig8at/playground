/* Jugar de policía contra los ladrones bots del motor (2026-10-17, REGLAS.md paso 3). El motor del modo «Botín»
   (engine/juego/partida.js + bots.js) corre adentro de la página sobre la misma ciudad, en metros: sus ladrones y sus
   otros policías son bots; el jugador es uno de sus policías (a.humano: el motor no lo decide ni lo mueve, el 3D le
   pasa su lugar). Lo que se ve: cada bot es un muñeco (ladrones con ropa de calle, policías de uniforme) en el lugar del
   motor; adentro de algo o preso, no se ve. Lo que hace el jugador:
   · cada robo (alarma, llamada, cámara, ruido) es un punto en su mapa (avisos);
   · en el lugar de un aviso, «Revisar la cámara»: el retrato del ladrón que lo hizo (sus rasgos: piel y pelo; la ropa
     puede cambiar, los rasgos no) y, desde ahí, cuando lo tiene a la vista, una marca roja sobre la cabeza;
   · junto a un ladrón: con retrato, «Atrapar» (la requisa: con botín, a la cárcel; sin nada, detenido por sospecha);
     sin retrato, «Pedir papeles» (los dos quietos 3 s: si lleva botín, a la cárcel; si no, el nombre que da no está en el
     censo —no es de ninguna familia— y queda marcado, con retrato);
   · entrar persiguiendo: si un ladrón se mete a su guarida mientras el policía lo persigue (lo vio hace poco y está
     cerca), esa puerta queda abierta para él; adentro, junto a la caja, «Registrar la guarida» requisa a los que estén;
   · allanar (2026-10-18, REGLAS.md): en la puerta de una guarida delatada (guardaron con la policía encima), con la
     orden (ALLANAMIENTO.espera s), «Allanar la guarida»: incauta lo guardado, requisa a los de adentro y la puerta queda
     abierta; antes, la puerta dice cuánto falta para la orden;
   · difundir un retrato (el menú, 2026-10-17): desde ahí, si alguien de la calle lo tiene a menos de
     PERSECUCION.reconoce m y a la vista, avisa (un aviso «Un vecino lo vio» donde está; uno cada cadaVecino s por ladrón);
   · junto a cualquiera de la calle (la sociedad), «Pedir papeles»: quién es, en qué trabaja y dónde vive (está en el
     censo).
   · de ladrón (papel 'ladron', 2026-10-17): el jugador es un ladrón del motor y la policía y los otros ladrones son bots.
     Lo que hace en la ronda (ronda.js) se le pasa al motor: robar lo deja a la vista y suena la alarma (robo), la cámara
     de un edificio da su retrato (retrato), los vecinos que llaman (llamada), guardar suma al botín del equipo (guardar)
     y su mochila es la de la ronda. Adentro de un edificio no se lo ve (adentro()). Si la policía lo alcanza, la requisa
     del motor: con botín, preso (un compañero bot puede rescatarlo); sin nada, detenido un rato; si le piden los
     papeles, quieto. onEstado(estado) avisa cada cambio.
   createPersecucion(...) → {iniciar, update(dt), cerca(), usar(c), estado(), quieto(), dispose}. */
import * as THREE from 'three';
import {prepararCiudad,crearPartida,paso,requisa,pedirPapeles,registrar,allanar,puertaCerca} from '../engine/juego/partida.js';
import {decidir} from '../engine/juego/bots.js';
import {MODO_BOTIN as M,ALLANAMIENTO,RASTRO} from '../engine/medidas.js';
import {makeCharacter,moveCharacter} from './characters3d.js';
import {rng} from '../engine/veredas.js';
import {sociedadDe,nombreAlAzar,apellidoAlAzar,oficioAlAzar,enCenso,direccionHogar,horaTexto} from '../engine/sociedad.js';
import {aspectoDe,cartelDe,identidadFalsa} from '../engine/juego/identidad.js';
import {describirRopa} from './ropaTexto.js';
import {RELOJ} from '../engine/medidas.js';

export const PERSECUCION={alcance:1.6,camara:8,vista:45,marca:2.35,persigue:30,reciente:4,caja:2.2,reconoce:12,cadaVecino:20};// m: para atrapar, para revisar la cámara de un aviso, para ver la marca; alto de la marca
// persigue, reciente: si el ladrón se mete a su guarida con el policía a menos de «persigue» m, que lo vio hace menos de
// «reciente» s, la puerta queda abierta para la policía (REGLAS.md: «si viene persiguiendo, sí puede entrar»); caja: a
// cuánto de la caja se ofrece «Registrar la guarida»

// los rasgos de un muñeco para el retrato (lo que no cambia con la ropa)
const PELO={negro:'negro',castaño:'castaño',rubio:'rubio',canoso:'canoso',rojizo:'rojizo'};
export function rasgosDe(look={}){const p=look.pzPelo||'',largo=/Female/.test(p),calvo=look.peinado==='calvo'||look.peinado==='rapado';
 return `piel ${look.piel||'media'}, ${calvo?(look.peinado==='calvo'?'calvo':'rapado'):`pelo ${PELO[look.pelo]||look.pelo||'castaño'} ${largo?'largo':'corto'}`}${look.pzBigote||look.barba?', con barba':''}`;}

export function createPersecucion({scene,plan,player,characters,policeTemplates,suelo,equipo=3,ronda=0,gente=()=>null,guaridas3d=[],abrir=()=>{},papel='policia',adentro=()=>false,mochila=()=>0,onEstado=()=>{},onAllanada=()=>{}}){
 const LADRON=papel==='ladron';let estadoYo='libre';
 let C=null,P=null,yo=null,acum=0,listo=false;const muñecos=new Map(),grupo=new THREE.Group();grupo.name='persecucion';scene.add(grupo);
 const retratos=new Map(),revisados=new Set(),mensajes=[],avisadas=new Set(),ultimoRastro=new Map(),policiaVista=new Map();let papelesDe=null,vecino=null;const vistosPapeles=new Set(),difundidos=new Set(),censados=new Map(),avisoVecino=new Map(),ultimaVista=new Map(),visto=new Map(),antes=new Map(),abiertas=new Set();// (cuándo vio el jugador a cada ladrón; su estado anterior; las guaridas abiertas)// (a quién ya se le vieron los papeles: no se le vuelven a pedir)
 const marcaGeo=new THREE.ConeGeometry(.16,.32,4).rotateX(Math.PI),marcaMat=new THREE.MeshBasicMaterial({color:'#e0453a',depthTest:false});
 function iniciar(){C=prepararCiudad(plan);P=crearPartida(C,{equipo,ronda});yo=P.agentes.find(a=>a.equipo===(LADRON?'ladron':'policia'));yo.humano=true;yo.x=player.x;yo.z=player.z;
  const r=rng(plan.seed*31+ronda);
  for(const a of P.agentes){if(a===yo)continue;const lista=a.equipo==='ladron'?characters:policeTemplates;if(!lista?.length)continue;const t=lista[Math.floor(r()*lista.length)];
   const c=makeCharacter(t,r);c.holder.position.set(a.x,suelo(a.x,a.z,0),a.z);grupo.add(c.holder);const marca=new THREE.Mesh(marcaGeo,marcaMat);marca.renderOrder=10;marca.visible=false;c.holder.add(marca);marca.position.y=PERSECUCION.marca/(c.holder.scale.y||1);
   // (quién dice que es si se le pregunta: el ladrón, un nombre y un oficio de verdad de la ciudad; el policía, agente)
   // (la identidad del ladrón: falsa —su nombre nunca es de alguien del censo— pero con la forma de cualquiera: nombre y
   // apellido, edad y oficio de alguien que trabaja en la ciudad; engine/juego/identidad.js)
   const yoSoy=a.equipo==='ladron'?identidadFalsa(sociedadDe(plan),r):{nombre:'Agente '+apellidoAlAzar(r),oficio:'Policía',edad:null};
   muñecos.set(a.id,{c,a,look:t.look||{},ropa:t.outfit||null,y:suelo(a.x,a.z,0),marca,yoSoy});}
  listo=true;}
 // un paso del 3D: el policía del jugador en su lugar, el motor a su paso fijo, los muñecos donde dice el motor
 function update(dt){if(!listo||!P)return;if(!P.fin){
   if(LADRON){// (el ladrón del jugador: su lugar y su mochila, salvo preso o detenido —ahí manda el motor—)
    if(yo.estado==='libre'||yo.estado==='adentro'){yo.x=player.x;yo.z=player.z;const dn=adentro();yo.estado=dn?'adentro':'libre';yo.lugar=dn?{id:'escondite',clase:'escondite',privado:true}:null;}
    yo.mochila=mochila();}
   else{yo.x=player.x;yo.z=player.z;if(!yo.papeles)yo.estado='libre';}
   // (el motor da pasos de M.tick s; antes de cada uno se guarda dónde estaba cada agente, para dibujarlo entre ese punto y
   // el nuevo según lo que va del paso siguiente —acum/M.tick—: se mueve parejo y no a saltos de 4 por segundo)
   acum+=dt;while(acum>=M.tick&&!P.fin){for(const a of P.agentes){a.px=a.x;a.pz=a.z;}decidir(P);paso(P);acum-=M.tick;}
   // (para el mapa del menú: dónde iba cada ladrón mientras la policía lo veía en vivo —el rastro— y, de ladrón, dónde vio
   // a cada policía por última vez)
   for(const a of P.agentes){if(a.equipo==='ladron'&&a.rastroHasta>P.t&&a.estado!=='preso')ultimoRastro.set(a.id,{x:a.x,z:a.z,t:P.t,por:a.rastroDe||'robo'});
    if(LADRON&&a.equipo==='policia'&&Math.hypot(a.x-player.x,a.z-player.z)<PERSECUCION.vista&&P.C.mapa.ve(yo,a))policiaVista.set(a.id,{x:a.x,z:a.z,t:P.t});}
   // (las guaridas delatadas y las allanadas: un mensaje cada una, para los dos papeles)
   for(const L of P.guaridas){if(L.delatada&&!avisadas.has(L.id)){avisadas.add(L.id);mensajes.push({t:P.t,texto:LADRON?`Te vieron guardar en ${L.nombre}: la pueden allanar en ${ALLANAMIENTO.espera} s`:`Guardaron botín en ${L.nombre} con la policía encima: la orden de allanamiento llega en ${ALLANAMIENTO.espera} s`});}
    if(L.cerrada&&!avisadas.has(L.id+'#')){avisadas.add(L.id+'#');mensajes.push({t:P.t,texto:`La policía allanó ${L.nombre}`});if(LADRON)onAllanada(P.guaridas.indexOf(L));}}
   if(LADRON){const e=yo.estado==='adentro'?'libre':yo.estado;if(e!==estadoYo){estadoYo=e;onEstado(e,yo);}}
   if(!LADRON){
   // entrar persiguiendo: el que se metió recién a su guarida con el policía encima
   for(const a of P.agentes){if(a.equipo!=='ladron')continue;const d=Math.hypot(a.x-yo.x,a.z-yo.z);if((a.estado==='libre'||a.accion?.fase==='entrar')&&d<PERSECUCION.vista&&P.C.mapa.ve(yo,a))visto.set(a.id,P.t);
    const prev=antes.get(a.id);antes.set(a.id,a.estado);if(a.estado!=='adentro'||prev==='adentro'||a.lugar?.clase!=='guarida')continue;
    const i=P.guaridas.indexOf(a.lugar),g=guaridas3d[i];if(!g||abiertas.has(i))continue;
    if(d<=PERSECUCION.persigue&&P.t-(visto.get(a.id)??-1e9)<=PERSECUCION.reciente){abiertas.add(i);abrir(g.vivienda);a.retrato=true;retratos.set(a.id,rasgosDe(muñecos.get(a.id)?.look));
     mensajes.push({t:P.t,texto:`¡Se metió a su guarida! (${g.texto}) Lo venías siguiendo: la puerta quedó abierta`});}}
   if(papelesDe&&!yo.papeles){const l=P.agentes.find(b=>b.id===papelesDe),m=muñecos.get(papelesDe);
    if(l?.estado==='preso')mensajes.push({t:P.t,texto:'Llevaba botín encima: a la cárcel'});
    else if(l?.retrato){retratos.set(l.id,rasgosDe(m?.look));censados.set(l.id,`${m?.yoSoy.nombre} (${m?.yoSoy.oficio})`);mensajes.push({t:P.t,texto:`Dice llamarse ${m?.yoSoy.nombre} (${m?.yoSoy.oficio}): no aparece en el censo. Queda marcado`});}
    else mensajes.push({t:P.t,texto:'Se fue antes de mostrar los papeles'});papelesDe=null;}
   // los vecinos que reconocen a un difundido
   for(const id of difundidos){const a=P.agentes.find(b=>b.id===id);if(!a||a.estado!=='libre'||P.t-(avisoVecino.get(id)??-1e9)<PERSECUCION.cadaVecino)continue;
    const g=(gente()?.personas()||[]).find(p=>Math.hypot(p.x-a.x,p.z-a.z)<PERSECUCION.reconoce&&P.C.mapa.ve(p,a));if(!g)continue;
    avisoVecino.set(id,P.t);P.avisos.push({tipo:'vecino',x:a.x,z:a.z,t:P.t,quien:id});mensajes.push({t:P.t,texto:'Un vecino reconoció a un buscado: mirá el plano'});}
   for(const a of P.agentes)if(a.equipo==='ladron'&&a.retrato&&(a.estado==='libre')&&Math.hypot(a.x-yo.x,a.z-yo.z)<PERSECUCION.vista&&P.C.mapa.ve(yo,a))ultimaVista.set(a.id,{t:P.t,x:a.x,z:a.z});
   if(vecino&&P.t>=vecino.hasta){const p=vecino.persona;mensajes.push({t:P.t,texto:`Papeles en orden: ${p.nombre}, ${p.edad} años · ${p.oficio} · vive en ${direccionHogar(sociedadDe(plan),p.hogar)}`});vecino=null;}}}
  for(const m of muñecos.values()){const {c,a}=m,ver=a.estado==='libre'||a.accion?.fase==='llegar';c.holder.visible=ver;if(!ver)continue;
   // (entre el paso anterior del motor y el actual; si saltó lejos —sale de un lugar, lo requisan—, aparece ahí. Gira de a
   // poco hacia donde va y la animación va a lo que de verdad avanza en el cuadro —2026-10-18: seguía al motor con un
   // resorte y la velocidad salía de lo que le faltaba, a tirones y a veces «corriendo»—)
   const h=c.holder,f=Math.min(1,acum/M.tick),px=a.px??a.x,pz=a.pz??a.z,salto=Math.hypot(a.x-px,a.z-pz)>4;
   const tx=salto?a.x:px+(a.x-px)*f,tz=salto?a.z:pz+(a.z-pz)*f,dx=tx-h.position.x,dz=tz-h.position.z,d=Math.hypot(dx,dz);
   h.position.x=tx;h.position.z=tz;m.y=suelo(tx,tz,m.y+.6);h.position.y=m.y;
   if(d>.005&&d<4){let da=Math.atan2(dx,dz)-h.rotation.y;da=Math.atan2(Math.sin(da),Math.cos(da));h.rotation.y+=da*Math.min(1,dt*8);}
   const v=d<4?d/Math.max(dt,1e-3):0;moveCharacter(c,v>4?'run':v>.3?'walk':'idle',v,dt);
   // la marca: ladrón con retrato, a la vista del jugador
   m.marca.visible=!LADRON&&a.equipo==='ladron'&&a.retrato&&Math.hypot(a.x-player.x,a.z-player.z)<PERSECUCION.vista&&P.C.mapa.ve(yo,a);}}
 // lo que se puede hacer cerca: revisar la cámara de un aviso, atrapar o pedir papeles
 function cerca(){if(!listo||LADRON||P.fin||yo.papeles||vecino)return null;let best=null,bd=1e9;
  for(const m of muñecos.values()){const a=m.a;if(a.equipo!=='ladron'||a.estado!=='libre')continue;const d=Math.hypot(a.x-player.x,a.z-player.z);if(d<PERSECUCION.alcance&&d<bd){bd=d;best={accion:a.retrato?'atrapar':'papeles',id:a.id,texto:a.retrato?'Atrapar':'Pedir papeles'};}}
  if(best)return best;
  // (en la puerta de una guarida delatada: allanarla con la orden; antes, cuánto falta)
  for(const [i,L] of P.guaridas.entries()){if(!L.delatada||L.cerrada||!puertaCerca(L,player,PERSECUCION.alcance+1))continue;const resta=Math.ceil(L.delatada.allanable-P.t);
   return resta>0?{accion:'orden',i,texto:`Guarida delatada · la orden de allanamiento llega en ${resta} s`}:{accion:'allanar',i,texto:'Allanar la guarida'};}
  // (adentro de una guarida abierta, junto a la caja)
  for(const i of abiertas){const g=guaridas3d[i];if(Math.hypot(g.x-player.x,g.z-player.z)<PERSECUCION.caja&&Math.abs((player.feet??g.y)-g.y)<1.5)return {accion:'registrar',i,texto:'Registrar la guarida'};}
  // (cualquiera de la calle: sus papeles)
  const g=gente()?.cercano(player.x,player.z,PERSECUCION.alcance);if(g&&g.persona.edad>=14&&!vistosPapeles.has(g.persona.id))return {accion:'papelesVecino',persona:g.persona,texto:'Pedir papeles'};
  for(const [i,av] of P.avisos.entries()){if(!av.quien||av.tipo==='vecino'||revisados.has(i))continue;const d=Math.hypot(av.x-player.x,av.z-player.z);if(d<PERSECUCION.camara&&d<bd){bd=d;best={accion:'camara',i,texto:'Revisar la cámara del lugar'};}}
  return best;}
 function usar(u){if(!u||!P)return null;const a=u.id&&P.agentes.find(b=>b.id===u.id);
  if(u.accion==='atrapar'&&a){const lleva=a.mochila;requisa(P,yo,a);return lleva>0?`¡Atrapado con botín encima! Va a la cárcel`:'Atrapado sin nada encima: detenido un rato por sospecha';}
  if(u.accion==='orden')return 'Todavía no hay orden: vigilá la puerta para que no saquen el botín';
  if(u.accion==='allanar'){const L=P.guaridas[u.i];avisadas.add(L.id+'#');const r=allanar(P,yo,L);if(!r)avisadas.delete(L.id+'#');if(!r)return 'Todavía no hay orden';const g=guaridas3d[u.i];if(g){abiertas.add(u.i);abrir(g.vivienda);}
   const pre=r.adentro.map(a=>`${muñecos.get(a.id)?.yoSoy.nombre||a.id}: ${a.estado==='preso'?'a la cárcel':'detenido'}`).join(' · ');
   return `Allanaste ${L.nombre}: ${r.incautado?`incautaste $${Math.round(r.incautado*1e6).toLocaleString('es-CO')}`:'no había nada (ya lo habían sacado)'}`+(pre?` · ${pre}`:'');}
  if(u.accion==='registrar'){const ad=registrar(P,yo,P.guaridas[u.i]);if(!ad.length)return 'La guarida está vacía (lo guardado en la caja ya no se puede sacar)';
   return ad.map(a=>`${muñecos.get(a.id)?.yoSoy.nombre||a.id}: ${a.estado==='preso'?'con botín, a la cárcel':'sin nada encima, detenido'}`).join(' · ');}
  if(u.accion==='papelesVecino'){vecino={persona:u.persona,hasta:P.t+M.gente.papeles};vistosPapeles.add(u.persona.id);gente()?.detener(u.persona.id,M.gente.papeles+.3);return 'Pidiendo papeles…';}
  if(u.accion==='papeles'&&a){pedirPapeles(P,yo,{ladron:a.id});papelesDe=a.id;return 'Pidiendo papeles…';}
  if(u.accion==='camara'){const av=P.avisos[u.i];revisados.add(u.i);const l=P.agentes.find(b=>b.id===av.quien);if(!l)return 'La cámara no muestra a nadie';l.retrato=true;
   const look=muñecos.get(l.id)?.look||{};retratos.set(l.id,rasgosDe(look));return `La cámara lo grabó: ${rasgosDe(look)}`;}
  return null;}
 const NOMBRE={robo:'Robo',alarma:'Alarma',llamada:'Llamada',camara:'Cámara',ruido:'Ruido',vecino:'Un vecino lo vio',delatada:'Guarida delatada'};
 function estado(){if(!P)return null;const L=P.agentes.filter(a=>a.equipo==='ladron');
  return {t:P.t,resta:Math.max(0,M.duracion-P.t),botin:P.botin,meta:P.meta,fin:P.fin,presos:L.filter(a=>a.estado==='preso').length,ladrones:L.length,
   avisos:P.avisos.map((av,i)=>({i,tipo:NOMBRE[av.tipo]||av.tipo,x:av.x,z:av.z,t:av.t,revisado:revisados.has(i),conCamara:!!av.quien})),
   retratos:[...retratos].map(([id,txt])=>({id,txt,estado:P.agentes.find(a=>a.id===id)?.estado})),mensajes:mensajes.splice(0)};}
// lo que muestra el menú de la policía: los avisos (con su lugar y hora), los sospechosos (los ladrones con retrato: sus
 // rasgos, la ropa con que los vio la cámara —la de su muñeco—, cuándo y dónde se los vio, el nombre que dieron), los
 // compañeros
 const lugarDe=id=>P.guaridas.find(g=>g.id===id)?.nombre||P.C.objetivos.find(o=>o.id===id)?.nombre||P.C.viviendas.find(v=>v.id===id)?.nombre||'';
 const horaDe=t=>horaTexto(P.inicio+t*RELOJ.escala).split(' ')[1];
 function info(){if(!P)return null;
  const avisos=P.avisos.map((av,i)=>({i,tipo:NOMBRE[av.tipo]||av.tipo,que:av.tipo==='robo'?'Robaron (sin alarma)':av.tipo==='delatada'?(P.guaridas.find(g=>g.id===av.lugar)?.cerrada?'Guarida allanada':`Guardaron botín con la policía encima: orden en ${Math.max(0,Math.ceil(av.allanable-P.t))} s`):av.tipo==='vecino'?'Reconocieron a un buscado':av.tipo==='camara'?'La cámara grabó a alguien con botín':av.tipo==='llamada'?'Los vecinos llaman: entraron a una casa':av.tipo==='ruido'?'Se oyó forzar una chapa':'Sonó la alarma',
   donde:lugarDe(av.lugar)||'en la calle',hora:horaDe(av.t),revisado:revisados.has(i)||!av.quien,x:av.x,z:av.z})).reverse();
  const sospechosos=P.agentes.filter(a=>a.equipo==='ladron'&&a.retrato).map(a=>{const m=muñecos.get(a.id),v=ultimaVista.get(a.id),av=[...P.avisos].reverse().find(x=>x.quien===a.id);
   return {id:a.id,rasgos:retratos.get(a.id)||rasgosDe(m?.look),ropa:describirRopa(m?.ropa),visto:v?`a las ${horaDe(v.t)}`:av?`${lugarDe(av.lugar)||'en la calle'}, ${horaDe(av.t)}`:'—',dice:censados.get(a.id)||'',estado:a.estado,difundido:difundidos.has(a.id)};});
  const companeros=P.agentes.filter(a=>a.equipo==='policia').map(a=>({nombre:a===yo?'Vos':muñecos.get(a.id)?.yoSoy.nombre||a.id,estado:a.estado==='libre'?'libre':a.estado,donde:a===yo?'acá':`a ${Math.round(Math.hypot(a.x-yo.x,a.z-yo.z))} m`}));
  return {avisos,sospechosos,companeros};}
 function difundir(id){if(!P.agentes.some(a=>a.id===id&&a.retrato))return false;difundidos.add(id);return true;}
 const quieto=()=>LADRON?!!yo&&(yo.estado==='preso'||yo.estado==='detenido'||yo.quieto>P.t):!!yo?.papeles||!!vecino;
 // lo que hace el ladrón del jugador, para el motor
 function robo(x,z,edificio=null,que=''){if(!LADRON||!P)return;yo.expuestoHasta=P.t+M.expuesto;yo.rastroHasta=P.t+RASTRO.robo;P.avisos.push({tipo:'alarma',x,z,t:P.t,quien:yo.id,edificio,que});P.stats.alarmas++;}
 function retrato(){if(LADRON&&P)yo.retrato=true;}
 function llamada(x,z){if(LADRON&&P){P.avisos.push({tipo:'llamada',x,z,t:P.t,quien:yo.id});P.stats.llamadas++;}}
 // guardar del jugador ladrón (ronda.js) en la guarida i (el mismo orden que las del motor: guaridasDe); delatada: si la
 // ronda la delató (guardó con la policía encima), el motor también, para que la policía bot la allane
 function guardarBotin(v,i=0,delatada=false){if(!LADRON||!P||v<=0)return;const L=P.guaridas[i]||P.guaridas[0];P.botin+=v;L.guardado+=v;P.stats.guardado.push(v);
  if(delatada&&!L.delatada){L.delatada={desde:P.t,allanable:P.t+ALLANAMIENTO.espera,quien:yo.id};P.stats.delatadas++;const [x,z]=L.puntos[0];P.avisos.push({tipo:'delatada',x,z,t:P.t,lugar:L.id,allanable:L.delatada.allanable});}}
 // sacar del jugador ladrón: lo de la guarida i vuelve a su mochila (la ronda ya lo sumó)
 function sacarBotin(i){if(!LADRON||!P)return 0;const L=P.guaridas[i];if(!L||L.cerrada)return 0;const v=L.guardado;P.botin-=v;P.stats.sacado+=v;L.guardado=0;return v;}
 // la banda (de ladrón): cada uno con su estado, lo que lleva y dónde anda
 function banda(){if(!P)return [];return P.agentes.filter(a=>a.equipo==='ladron').map(a=>({id:a.id,nombre:a===yo?'Vos':muñecos.get(a.id)?.yoSoy.nombre||a.id,estado:a.estado==='adentro'?'libre':a.estado,mochila:a.mochila,
  donde:a===yo?'acá':a.estado==='preso'?'comisaría':a.estado==='adentro'?'adentro de algún lugar':`a ${Math.round(Math.hypot(a.x-player.x,a.z-player.z))} m`}));}
 // ---------- el mapa del menú (2026-10-18; el prototipo era /prototipo/menu): lo que cada bando ve en el plano ----------
 // Los lugares van con su edificio ('L'+lote o 'C'+casa: se pinta entero); la gente, con su punto. De ladrón: la banda en
 // vivo (con su muñeco: cuerpo y ropa), sus guaridas con lo guardado (y si quedaron delatadas), los robos y la policía
 // que vio (dónde y hace cuánto). De policía: el equipo en vivo, los robos y avisos, la comisaría, el «?» de cada ladrón
 // con el rastro encendido (en vivo, con lo que le queda), dónde se vio por última vez a cada uno (el rastro que se
 // perdió y los reconocidos) y las guaridas delatadas con la cuenta de la orden. Nunca la posición en vivo del otro
 // bando fuera de eso.
 const cuerpoDe=look=>({piel:look?.piel||'media',pelo:look?.pelo||'castaño',peinado:look?.pzPelo||'',barba:look?.pzBigote||''});
 const lugarAviso=av=>av.edificio||P.C.objetivos.find(o=>o.id===av.lugar)?.edificio||P.C.viviendas.find(v=>v.id===av.lugar)?.edificio||null;
 const nombreAviso=av=>av.que||lugarDe(av.lugar)||'en la calle';
 function mapa(){if(!P)return null;const t=P.t,hace=s=>s<60?`hace ${Math.round(s)} s`:`hace ${Math.round(s/60)} min`;
  const robos=P.avisos.map((av,i)=>({i,av})).filter(({av})=>av.tipo==='alarma'||av.tipo==='llamada'||av.tipo==='robo').map(({i,av})=>({id:'r'+i,edificio:lugarAviso(av),x:av.x,z:av.z,lugar:nombreAviso(av),hace:hace(t-av.t),reciente:t-av.t<40,aviso:av.tipo}));
  if(LADRON){
   const banda=P.agentes.filter(a=>a.equipo==='ladron').map(a=>{const m=muñecos.get(a.id),esYo=a===yo,x=esYo?player.x:a.x,z=esYo?player.z:a.z;
    return {id:a.id,yo:esYo,nombre:esYo?'Vos':m?.yoSoy.nombre||a.id,x,z,estado:a.estado==='adentro'?'escondido':a.estado,mochila:a.mochila,
     cuerpo:esYo?null:cuerpoDe(m?.look),ropa:esYo?null:m?.ropa||null,aspecto:aspectoDe({look:m?.look||{},outfit:m?.ropa||{}}),cubierta:m?.yoSoy||null,
     rastro:a.rastroHasta>t?Math.ceil(a.rastroHasta-t):0,retrato:!!a.retrato,difundido:difundidos.has(a.id)};});
   const guaridas=P.guaridas.map((L,i)=>({id:L.id,i,edificio:L.edificio,nombre:L.nombre,x:L.puntos[0][0],z:L.puntos[0][1],guardado:L.guardado,cerrada:L.cerrada,
    delatada:L.delatada&&!L.cerrada?Math.max(0,Math.ceil(L.delatada.allanable-t)):null}));
   const policia=[...policiaVista].filter(([,v])=>t-v.t<120).map(([id,v])=>({id,x:v.x,z:v.z,hace:hace(t-v.t),vivo:t-v.t<1}));
   return {papel:'ladron',banda,guaridas,robos,policia};}
  const equipo=P.agentes.filter(a=>a.equipo==='policia').map(a=>{const m=muñecos.get(a.id),esYo=a===yo;return {id:a.id,yo:esYo,nombre:esYo?'Vos':m?.yoSoy.nombre||a.id,x:esYo?player.x:a.x,z:esYo?player.z:a.z,
   estado:a.estado,tarea:a.tarea||'',cuerpo:esYo?null:cuerpoDe(m?.look),ropa:esYo?null:m?.ropa||null};});
  const vivos=P.agentes.filter(a=>a.equipo==='ladron'&&a.rastroHasta>t&&a.estado!=='preso').map(a=>({id:'v'+a.id,x:a.x,z:a.z,quedan:Math.ceil(a.rastroHasta-t),total:RASTRO.robo,retrato:retratos.get(a.id)||null}));
  const vistos=[];for(const a of P.agentes){if(a.equipo!=='ladron'||a.estado==='preso'||a.rastroHasta>t)continue;const r=ultimoRastro.get(a.id),v=P.vistos.get(a.id),u=[r,v].filter(Boolean).sort((p,q)=>q.t-p.t)[0];
   if(u&&t-u.t<300)vistos.push({id:'u'+a.id,x:u.x,z:u.z,hace:(t-u.t)/60,haceTxt:hace(t-u.t),fuente:u===r?'rastro':'visto',retrato:retratos.get(a.id)||null});}
  const delatadas=P.guaridas.filter(L=>L.delatada&&!L.cerrada).map(L=>({id:L.id,edificio:L.edificio,nombre:L.nombre,x:L.puntos[0][0],z:L.puntos[0][1],quedan:Math.max(0,Math.ceil(L.delatada.allanable-t))}));
  const allanadas=P.guaridas.filter(L=>L.cerrada).map(L=>({id:L.id,edificio:L.edificio,nombre:L.nombre}));
  return {papel:'policia',equipo,robos,vivos,vistos,delatadas,allanadas,comisaria:{edificio:P.C.comisaria.edificio,x:P.C.comisaria.puntos[0][0],z:P.C.comisaria.puntos[0][1]}};}
 const quietoPorPapeles=()=>LADRON&&!!yo&&yo.quieto>P.t;
 // (el que está a menos de d m, a la vista: su nombre y su oficio)
 // el cartel de alguien de la partida al acercarse (2026-10-18, identidad.js): sólo lo que se ve; el nombre, si es de tu
 // bando o si ya le pediste los papeles (censados)
 function quien(x,z,d=2.6){let best=null,bd=d;for(const m of muñecos.values()){if(!m.c.holder.visible)continue;const e=Math.hypot(m.a.x-x,m.a.z-z);if(e<bd){bd=e;best=m;}}if(!best)return null;
  const mio=(best.a.equipo==='ladron')===LADRON,policia=best.a.equipo==='policia';
  return {...cartelDe({aspecto:aspectoDe({look:best.look,outfit:best.ropa||{},policia}),identidad:best.yoSoy,documentado:mio||censados.has(best.a.id)}),que:policia?'patrulla':'camina'};}
 // ¿ya le pidió los papeles a esta persona de la calle? (el cartel de la gente muestra su nombre)
 const documentado=personaId=>vistosPapeles.has(personaId);
 function dispose(){scene.remove(grupo);for(const m of muñecos.values())m.c.mixer.stopAllAction();muñecos.clear();marcaGeo.dispose();marcaMat.dispose();}
 return {get tiempo(){return P?P.t+Math.min(acum,M.tick):0;},mapa,robo,retrato,llamada,guardarBotin,sacarBotin,get perseguido(){return !!P&&!!yo&&(P.vistos.get(yo.id)?.t??-1e9)>=P.t-.5;},banda,quietoPorPapeles,get yo(){return yo;},info,difundir,difundidos,get _diag(){return {visto:[...visto],antes:[...antes],t:P?.t,yo:yo&&{x:yo.x,z:yo.z,estado:yo.estado}};},abiertas,iniciar,update,cerca,usar,estado,quieto,quien,documentado,dispose,get P(){return P;},get listo(){return listo;}};}
