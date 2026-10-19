<script setup>
// El menú del juego como tablero de mando (2026-10-18, Miguel: «cómo un ladrón ve su menú: su aspecto al costado
// izquierdo, el listado de sospechosos —como La casa de papel o Rápido y furioso: la banda tiene acceso a la información
// policial todo el tiempo, sin hackeos que compliquen el juego—; y lo mismo la policía: su aspecto y la información para
// seguir trabajando, con el mapa de dónde hubo un robo»). PROTOTIPO: datos de ejemplo sobre la ciudad 1 de verdad (su
// plano, sus lugares); la forma de los datos (props del tablero: ver `datos`) es la que el juego le pasará al integrarlo.
// /prototipo/menu?papel=ladron|policia
import {ref,computed,onMounted,onBeforeUnmount,nextTick} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import MunecoVista from '../components/MunecoVista.vue';
import {planoDe} from '../lib/mapasGuardados.js';
import {drawWorldStage} from '../lib/drawPlan.js';
import {uniformeDe} from '../lib/characters3d.js';
import {aspectoDe} from '../engine/juego/identidad.js';
import {RASTRO,ALLANAMIENTO} from '../engine/medidas.js';
import '@fontsource/bungee/400.css';
import '@fontsource-variable/rubik';

const route=useRoute(),router=useRouter();
const papel=computed(()=>route.query.papel==='policia'?'policia':'ladron');
const cambiar=p=>router.replace({query:{...route.query,papel:p}});
const lienzo=ref(null),bp=ref(null),cargando=ref(true);
// (el muñeco: el del perfil de la cuenta, si hay; de policía, con el uniforme)
const cuenta=(()=>{try{return JSON.parse(sessionStorage.getItem('fuga:cuenta')||'null');}catch{return null;}})();
const cuerpo=cuenta?.cuerpo||{piel:'media',pelo:'castaño',peinado:'pelo:Casual2_Male',barba:''};
const ropaCalle={underwear:{id:'boxer',color:'#343d50'},top:{id:'sudadera',color:'#7a2e3a'},bottom:{id:'jean',color:'#2b3d5c'},shoes:{id:'tenis',color:'#f2f0ea'},hat:{id:'gorra',color:'#2b2b2e'}};
const ropa=computed(()=>papel.value==='policia'?uniformeDe({gorra:true}):cuenta?.ropa?.calle?{underwear:{id:'boxer',color:'#343d50'},...Object.fromEntries(Object.entries(cuenta.ropa.calle).filter(([,p])=>p))}:ropaCalle);

// ---------- los datos (2026-10-18, Miguel: «el mapa para ver dónde se guardan los robos y la banda; la policía, el lugar
// robado y los ladrones para buscarlos con los ojos; enfocado a los jugadores reales, sin los bots por ahora») ----------
// La forma que le dará la partida multijugador al menú (lo de acá son DATOS DE EJEMPLO repartidos por la ciudad 1):
//  · jugadores: [{id, nombre (el de la cuenta), bando, x, z, estado (libre | marcado | preso), mochila}] —cada uno ve los
//    de su bando EN VIVO; nunca la posición de los del otro bando—;
//  · guaridas: [{nombre, x, z, guardado, de}] (las de la banda: dónde está guardado el botín);
//  · robos: [{lugar, x, z, hace, valor, camara, revisada, alarma}];
//  · avistamientos (sólo la policía): [{sospechoso, x, z, hace (min), fuente: camara | vecino | papeles | agente}] —dónde
//    se vio por última vez a cada sospechoso; la zona donde puede estar crece con el tiempo (ZONA m por minuto)—.
// Los lugares (guaridas, robos, la comisaría) se marcan pintando EL EDIFICIO entero, no con un punto (Miguel, 2026-10-18:
// «más colorido, el área del edificio, sin tanto texto; zoom y clic para ver la información al costado derecho»). La
// zona de un avistamiento son los edificios que caen en ella, más tenues cuanto más lejos.
const {porMinuto:ZONA,min:ZONA_MIN,max:ZONA_MAX}=RASTRO.zona;// m por minuto (piso y tope en m): lo que alguien se aleja escondiéndose entre la gente, sin correr
const edificios=computed(()=>{if(!bp.value)return [];const I=bp.value.isla,E=[];
 for(const l of [...bp.value.lots,...(I.lots||[])])if(l.rect)E.push({id:'L'+l.id+(l.isla?'i':''),nombre:l.shopName||l.name||'Edificio',x:l.rect.x+l.rect.w/2,z:l.rect.y+l.rect.h/2,partes:l.parts});
 (I.casas||[]).forEach((c,i)=>E.push({id:'C'+i,nombre:'la casa de '+(c.direccion?.texto||'la loma'),x:c.x,z:c.z,casa:{w:c.w,d:c.d,ry:c.ry||0}}));
 return E;});
const datos=computed(()=>{if(!bp.value)return null;const B=bp.value.isla.bounds,E=edificios.value;
 // (un punto de la ciudad por fracción del ancho y alto de la isla —escogidos sobre las manzanas: el centro y los dos
 // barrios—; el edificio de un lugar, el más cercano a ese punto)
 const punto=(fx,fz)=>({x:(B.x0+fx*(B.x1-B.x0))*6,z:(B.y0+fz*(B.y1-B.y0))*6});
 const cerca=(x,z,L=E)=>{let m=null,bd=1e9;for(const e of L){const d=Math.hypot(e.x-x,e.z-z);if(d<bd){bd=d;m=e;}}return m;};
 const conNombre=E.filter(e=>!e.casa),nombreCerca=(x,z)=>cerca(x,z,conNombre)?.nombre||'la calle';
 const en=(fx,fz)=>{const p=punto(fx,fz);const n=nombreCerca(p.x,p.z);return {...p,nombre:n,cerca:n};};
 const edif=(fx,fz)=>{const p=punto(fx,fz),e=cerca(p.x,p.z);return {x:e.x,z:e.z,edificio:e.id,nombre:e.nombre};};
 const C=conNombre.find(e=>/comisar/i.test(e.nombre)),cai={x:C.x,z:C.z,edificio:C.id,nombre:'Comisaría'},yo=cuenta?.nombre||'Vos';
 const g1=edif(.34,.27),g2=edif(.6,.68);
 const comun={hora:'Jueves 16:42',resta:'3:18',meta:'$24.000.000',guardado:'$9.500.000',guardadoN:9.5,metaN:24,comisaria:cai,
  delatable:{...g1,id:'g1',texto:g1.nombre,valor:6,guardado:'$6.000.000'}};
 const r1=edif(.3,.6),r2=edif(.55,.22),r3=edif(.72,.8);
 const robos=[{...r1,id:'r1',lugar:r1.nombre,hace:'hace 2 min',valor:'$4.000.000',camara:true,revisada:false,alarma:true,llevaron:['Computador portátil','Caja menor']},
  {...r2,id:'r2',lugar:r2.nombre,hace:'hace 6 min',valor:'$3.200.000',camara:true,revisada:true,llevaron:['Reloj de oro','Celular','Efectivo']},
  {...r3,id:'r3',lugar:r3.nombre,hace:'hace 11 min',valor:'$2.300.000',llevaron:['Televisor','Joyas de la abuela']}];
 if(papel.value==='ladron'){const j=[{...en(.45,.5),id:'b1',nombre:yo,estado:'libre',mochila:'$2.800.000',yo:true,cuerpo,ropa:ropa.value,cubierta:{nombre:'Jorge Ramírez',oficio:'Panadero',edad:34},
    lleva:['Reloj de oro','Celular'],robo:[{lugar:r2.nombre,cosas:['Reloj de oro','Celular','Efectivo'],valor:'$3.200.000'}],saben:'su retrato salió en las noticias'},
   {...en(.76,.64),id:'b2',nombre:'LunaRoja',estado:'marcada',mochila:'$1.200.000',va:'a El apartamento 202',cuerpo:{piel:'clara',pelo:'negro',peinado:'pelo:Casual_Female',barba:''},
    ropa:{underwear:{id:'boxer',color:'#343d50'},top:{id:'camiseta',color:'#f2f0ea'},outer:{id:'abrigo',color:'#e9c84a'},bottom:{id:'leggings',color:'#2b2b2e'},shoes:{id:'tenis',color:'#f2f0ea'}},
    cubierta:{nombre:'Sandra Gómez',oficio:'Vendedora',edad:29},lleva:['Celulares (3)'],robo:[{lugar:r1.nombre,cosas:['Computador portátil','Caja menor'],valor:'$4.000.000'}],saben:'su nombre falso: no está en el censo'},
   {x:cai.x,z:cai.z,id:'b3',nombre:'Tavo',estado:'preso',mochila:'',cuerpo:{piel:'oscura',pelo:'negro',peinado:'',barba:'corta'},
    ropa:{underwear:{id:'boxer',color:'#343d50'},top:{id:'polo',color:'#4f8f5a'},bottom:{id:'cargo',color:'#7a5236'},shoes:{id:'botas',color:'#2b2b2e'},hat:{id:'gorra',color:'#c94f4f'}},
    cubierta:{nombre:'Óscar Pinzón',oficio:'Mecánico',edad:41},lleva:[],robo:[{lugar:r3.nombre,cosas:['Televisor','Joyas de la abuela'],valor:'$2.300.000'}],saben:'lo atraparon con el botín: le quitaron todo'}];
  return {...comun,robos,
   yo:{nombre:yo,cubierta:{nombre:'Jorge Ramírez',oficio:'Panadero',edad:34},estado:'libre',retrato:'en las noticias',mochila:'$2.800.000',cosas:['Reloj de oro','Celular']},
   banda:j.map(b=>({...b,viste:aspectoDe({look:{modelo:/Female/.test(b.cuerpo.peinado)?'Female':'',pelo:b.cuerpo.pelo,peinado:b.cuerpo.peinado?'':'rapado'},outfit:b.ropa}),donde:b.estado==='preso'?'en la Comisaría':'cerca de '+nombreCerca(b.x,b.z)})),
   guaridas:[{...g1,id:'g1',direccion:g1.nombre,nombre:'El taller',guardado:'$6.000.000',de:yo,tuya:true,cosas:['Reloj de oro','Collar de perlas','Computador portátil'],ultimo:'Vos · hace 4 min'},
    {...g2,id:'g2',direccion:g2.nombre,nombre:'El apartamento 202',guardado:'$3.500.000',de:'LunaRoja',cosas:['Celulares (3)','Efectivo'],ultimo:'LunaRoja · hace 9 min'}],
   patrullas:[{...en(.4,.62),id:'p1',nombre:'Unidad 1',visto:'hace 20 s',quien:'LunaRoja'},{...en(.7,.27),id:'p2',nombre:'Agente a pie',visto:'hace 40 s',quien:yo}],
   radio:[{t:'16:42',quien:'Central',texto:`Alarma en ${r1.nombre}. Unidad 1, vaya al lugar.`,urgente:true},{t:'16:41',quien:'Unidad 1',texto:'Recibido, voy en camino.'},
    {t:'16:39',quien:'Central',texto:'Difundimos el retrato del sospechoso de '+r2.nombre+': piel media, pelo castaño corto, sudadera vino.'},{t:'16:37',quien:'Agente 3',texto:'Le pedí papeles a una mujer cerca de '+r2.nombre+': no aparece en el censo. Queda marcada.'},{t:'16:35',quien:'Central',texto:`Robo en ${r2.nombre}.`}],
   saben:[{quien:yo,retrato:'piel media, pelo castaño corto, sudadera vino, gorra negra',fuente:'cámara de '+r2.nombre,difundido:true,teDescribe:true},{quien:'LunaRoja',nombreFalso:'Sandra Gómez',fuente:'papeles: no está en el censo',marcada:true},{quien:'Tavo',fuente:'atrapado con botín',preso:true}]};}
 const eq=[{...en(.5,.45),id:'e1',nombre:yo,estado:'en servicio',yo:true,unidad:'Unidad 3',anda:'a pie · la patrulla a 120 m',cuerpo,ropa:ropa.value,
   sigue:'Sospechoso 1 (cámara)',hizo:[{t:'16:37',que:'Pidió papeles a una mujer: no está en el censo (Sandra Gómez)'},{t:'16:20',que:'Revisó la cámara de '+r2.nombre}],presos:0,papeles:4},
  {...en(.33,.5),id:'e2',nombre:'Mora',estado:'en camino',va:'a '+r1.nombre+' (la alarma)',unidad:'Unidad 1',anda:'en la patrulla',cuerpo:{piel:'trigueña',pelo:'castaño',peinado:'pelo:Casual2_Female',barba:''},ropa:uniformeDe({gorra:false}),
   sigue:'—',hizo:[{t:'16:41',que:'Respondió a la alarma de '+r1.nombre},{t:'16:12',que:'Atrapó a Tavo con el botín'}],presos:1,papeles:2},
  {x:cai.x,z:cai.z,id:'e3',nombre:'Ríos',estado:'en la comisaría',unidad:'Unidad 2',anda:'a pie',cuerpo:{piel:'oscura',pelo:'negro',peinado:'pelo:Casual_Male',barba:'corta'},ropa:uniformeDe({gorra:true}),
   sigue:'—',hizo:[{t:'16:15',que:'Cuida a los presos para que no los rescaten'}],presos:0,papeles:1}];
 const a1=en(.24,.56),a2=en(.75,.7),a3=en(.6,.25);
 return {...comun,robos:robos.map((r,i)=>({...r,quien:['Sospechoso 2 (cámara sin revisar)','Sospechoso 1 (cámara)','Nadie lo vio'][i]})),
  yo:{nombre:'Agente '+yo,unidad:'Unidad 3',estado:'en servicio',patrulla:'a pie · la patrulla a 120 m'},
  equipo:eq.map(e=>({...e,donde:e.estado==='en la comisaría'?'en la Comisaría':'cerca de '+nombreCerca(e.x,e.z)})),
  avistamientos:[{id:'a1',sospechoso:'Sospechoso 2',...a1,hace:1,fuente:'vecino',detalle:'corría con una mochila'},{id:'a2',sospechoso:'Sandra Gómez (marcada)',...a2,hace:5,fuente:'papeles',detalle:'no está en el censo'},{id:'a3',sospechoso:'Sospechoso 1',...a3,hace:7,fuente:'camara',detalle:'sudadera vino, gorra negra'}],
  sospechosos:[{n:1,retrato:'piel media, pelo castaño corto',ropa:'sudadera vino, jean azul oscuro, gorra negra',visto:r2.nombre+' · 16:35 (cámara)',difundido:true},{n:2,retrato:'piel clara, pelo negro largo',ropa:'chaqueta amarilla',visto:r1.nombre+' · 16:42 (cámara: falta revisarla)',difundido:false}],
  marcados:[{nombreFalso:'Sandra Gómez',oficio:'Vendedora (falso)',donde:'cerca de '+a2.nombre,hace:'hace 5 min'}],
  presos:{n:1,de:3,nombres:['Tavo']},
  avisos:[{t:'16:42',texto:`Alarma: ${r1.nombre}`,tipo:'alarma'},{t:'16:41',texto:'Un vecino vio correr a alguien con una mochila',tipo:'vecino'},{t:'16:35',texto:`Robo en ${r2.nombre}`,tipo:'robo'},{t:'16:31',texto:`Robo en ${r3.nombre}`,tipo:'robo'}]};});
// las capas del mapa (se prenden y se apagan)
const CAPAS={ladron:[['banda','La banda'],['guaridas','Guaridas'],['robos','Robos'],['policia','Policía vista']],policia:[['robos','Robos'],['avistamientos','Sospechosos vistos'],['equipo','Tu equipo'],['comisaria','Comisaría']]};
const capas=ref({banda:true,guaridas:true,robos:true,policia:false,avistamientos:true,equipo:true,comisaria:true});
const FUENTE={camara:'cámara',vecino:'un vecino',papeles:'papeles',agente:'un agente',rastro:'el rastro del robo (se perdió)',huyo:'el rastro de la huida (se perdió)'};

// ---------- el mapa: el plano de la ciudad y, encima, los edificios pintados y la gente ----------
// (el plano está en casillas de 6 m desde isla.bounds: un punto en metros va a (x/6 − x0)/(x1 − x0) del ancho)
const pct=(x,z)=>{const B=bp.value.isla.bounds;return [(x/6-B.x0)/(B.x1-B.x0)*100,(z/6-B.y0)/(B.y1-B.y0)*100];};
const pos=(x,z)=>{if(!bp.value)return {};const [l,t]=pct(x,z);return {left:l+'%',top:t+'%'};};
// (las piezas de un edificio, en % del plano: las partes de un lote, o la casa girada en su centro)
const piezas=id=>{const e=edificios.value.find(e=>e.id===id);if(!e)return [];const B=bp.value.isla.bounds,W=(B.x1-B.x0)*6,H=(B.y1-B.y0)*6;
 if(e.casa){const [l,t]=pct(e.x,e.z);return [{left:l+'%',top:t+'%',width:e.casa.w/W*100+'%',height:e.casa.d/H*100+'%',transform:`translate(-50%,-50%) rotate(${-e.casa.ry}rad)`}];}
 return e.partes.map(P=>{const [l,t]=pct(P.x,P.y);return {left:l+'%',top:t+'%',width:P.w/W*100+'%',height:P.h/H*100+'%'};});};
// (la zona de un avistamiento: los edificios a menos de m × ZONA metros, con su cercanía de 0 a 1)
const radio=a=>Math.min(ZONA_MAX,Math.max(ZONA_MIN,a.hace*ZONA));
const zonaDe=a=>{const r=radio(a);return edificios.value.map(e=>({e,d:Math.hypot(e.x-a.x,e.z-a.z)})).filter(o=>o.d<=r).map(o=>({id:o.e.id,cerca:1-o.d/r}));};
// ---------- el rastro (RASTRO en medidas.js; REGLAS.md): apenas alguien roba, o huye cuando le piden los papeles, la
// policía lo ve EN VIVO como un «?» durante unos segundos; al acabarse queda donde se lo vio por última vez y su zona
// crece. Acá se simula (botones «Simular…»): el ladrón corre por una ruta corta desde donde empezó. ----------
const ahora=ref(Date.now()),rastros=ref([]);let reloj=0;
function simular(por){const D=datos.value;if(!D)return;const lad=papel.value==='ladron';
 const o=por==='robo'?D.robos[0]:(lad?D.banda[1]:D.avistamientos.find(a=>a.fuente==='papeles'));
 const ruta=[[0,0],[28,14],[52,6],[70,-22],[84,-44]].map(([dx,dz])=>({x:o.x+dx,z:o.z+dz}));
 rastros.value=[...rastros.value.filter(r=>r.por!==por),{id:'r-'+por,por,desde:Date.now(),dura:RASTRO[por==='robo'?'robo':'huyePapeles'],ruta,lugar:o.lugar||o.nombre,
  ladron:lad?(por==='robo'?'b1':'b2'):null,sospechoso:por==='robo'?'El que robó '+(o.lugar||o.nombre):'Sandra Gómez (huyó)',
  aspecto:por==='robo'?'Hombre de sudadera vino · jean azul oscuro · gorra negra':'Mujer de abrigo largo amarillo · leggings negro'}];}
// (dónde va y cuánto le queda: sobre la ruta, en proporción al tiempo; al acabarse, quieto en el último punto)
const enRuta=(R,f)=>{const n=R.length-1,u=Math.max(0,Math.min(n,f*n)),i=Math.min(n-1,Math.floor(u)),k=u-i;return {x:R[i].x+(R[i+1].x-R[i].x)*k,z:R[i].z+(R[i+1].z-R[i].z)*k};};
const rastrosVista=computed(()=>rastros.value.map(r=>{const t=(ahora.value-r.desde)/1000,quedan=Math.max(0,r.dura-t);
 return {...r,...enRuta(r.ruta,Math.min(1,t/r.dura)),quedan:Math.ceil(quedan),p:quedan/r.dura,vivo:quedan>0,hace:Math.max(0,(t-r.dura)/60)};}));
const vivos=computed(()=>rastrosVista.value.filter(r=>r.vivo));
// (los vistos por última vez: los del ejemplo y los rastros que ya se perdieron)
const lugarCerca=(x,z)=>{let m=null,bd=1e9;for(const e of edificios.value){if(e.casa)continue;const d=Math.hypot(e.x-x,e.z-z);if(d<bd){bd=d;m=e;}}return m?.nombre||'la calle';};
const haceTxt=m=>m<1?`${Math.round(m*60)} s`:`${Math.round(m)} min`;
const vistos=computed(()=>[...(datos.value?.avistamientos||[]),...rastrosVista.value.filter(r=>!r.vivo).map(r=>({...r,nombre:lugarCerca(r.x,r.z),fuente:r.por==='robo'?'rastro':'huyo',detalle:r.aspecto}))]);
// (la banda, con los que la policía está siguiendo donde va su rastro)
const bandaVista=computed(()=>(datos.value?.banda||[]).map(b=>{const r=rastrosVista.value.find(r=>r.ladron===b.id);return r?{...b,x:r.x,z:r.z,rastro:r}:b;}));
const avisosVista=computed(()=>[...vivos.value.map(r=>({t:'ahora',tipo:'alarma',texto:(r.por==='robo'?'Robo en '+r.lugar:'Huyó al pedirle los papeles')+`: lo vemos en el mapa ${r.quedan} s`})),...(datos.value?.avisos||[])]);
// ---------- el allanamiento (ALLANAMIENTO en medidas.js; REGLAS.md; engine/juego/ronda.js): guardar con la policía encima
// delata la guarida; pasada la espera, la policía puede entrar e incauta lo que haya. Se simula con «Simular guardar con
// la policía encima» (la guarida El taller). ----------
const allan=ref(null);// {desde, sacado, allanada, incautado}
const simularAllanamiento=()=>{allan.value={desde:Date.now(),sacado:false,allanada:false,incautado:0};};
const quedanAllan=computed(()=>allan.value?Math.max(0,Math.ceil(ALLANAMIENTO.espera-(ahora.value-allan.value.desde)/1000)):0);
const pAllan=computed(()=>allan.value?quedanAllan.value/ALLANAMIENTO.espera:0);
const plata=n=>'$'+Math.round(n*1e6).toLocaleString('es-CO');
function allanarYa(){const A=allan.value;if(!A||quedanAllan.value>0||A.allanada)return;A.allanada=true;A.incautado=A.sacado?0:datos.value.delatable.valor;}
function sacarYa(){const A=allan.value;if(!A||A.allanada)return;A.sacado=true;}
// (lo guardado por la banda, menos lo incautado)
const guardadoN=computed(()=>(datos.value?.guardadoN||0)-(allan.value?.incautado||0));
// lo que se toca: {tipo, id}; su ficha sale arriba a la derecha
const sel=ref(null);
const elegido=computed(()=>{const s=sel.value,D=datos.value;if(!s||!D)return null;
 const L={guarida:D.guaridas,robo:D.robos,banda:bandaVista.value,patrulla:D.patrullas,equipo:D.equipo,visto:vistos.value,rastro:vivos.value}[s.tipo];
 // (un rastro que se acaba sigue elegido, ya como «visto por última vez»)
 if(s.tipo==='rastro'){const r=rastrosVista.value.find(r=>r.id===s.id);if(!r)return null;return r.vivo?{tipo:'rastro',...r}:{tipo:'visto',...vistos.value.find(v=>v.id===s.id)};}
 if(s.tipo==='delatada')return allan.value?{tipo:'delatada',...D.delatable}:null;
 if(s.tipo==='comisaria')return {tipo:'comisaria',...D.comisaria};const o=L?.find(o=>o.id===s.id);return o?{tipo:s.tipo,...o}:null;});

// ---------- el zoom: rueda (o + y −) acerca hacia el puntero, arrastrar mueve, doble clic acerca ----------
const vp=ref(null),vista=ref({k:1,x:0,y:0}),base=ref({w:0,h:0}),suave=ref(false);let arr=null;
// (el tamaño en pantalla de los puntos: crece con el zoom pero menos que el mapa —de lejos la mitad, de cerca un poco
// más que el natural—, para que de lejos no tapen el lugar exacto ni se amontonen)
const tamPunto=computed(()=>Math.max(.42,Math.min(1.1,.42*vista.value.k**.6)));
function encuadrar(){const c=vp.value,B=bp.value?.isla?.bounds;if(!c||!B)return;const W=c.clientWidth,H=c.clientHeight,a=(B.x1-B.x0)/(B.y1-B.y0);
 const w=Math.min(W,H*a),h=w/a;base.value={w,h};
 // (arranca —y vuelve con ⤢— encuadrado en la ciudad: la caja de sus edificios con un margen)
 const E=edificios.value;if(!E.length){vista.value={k:1,x:(W-w)/2,y:(H-h)/2};return;}
 const xs=E.map(e=>pct(e.x,e.z)),x0=Math.min(...xs.map(p=>p[0]))-4,x1=Math.max(...xs.map(p=>p[0]))+4,y0=Math.min(...xs.map(p=>p[1]))-4,y1=Math.max(...xs.map(p=>p[1]))+4;
 const k=Math.max(1,Math.min(W/(w*(x1-x0)/100),H/(h*(y1-y0)/100)));vista.value={k,x:W/2-(x0+x1)/200*w*k,y:H/2-(y0+y1)/200*h*k};}
function zoomEn(px,py,k2){const v=vista.value,k=Math.max(1,Math.min(6,k2));vista.value={k,x:px-(px-v.x)*k/v.k,y:py-(py-v.y)*k/v.k};}
function rueda(ev){const r=vp.value.getBoundingClientRect();suave.value=false;zoomEn(ev.clientX-r.left,ev.clientY-r.top,vista.value.k*Math.exp(-ev.deltaY*.0015));}
const boton=f=>{suave.value=true;if(!f)return encuadrar();const c=vp.value;zoomEn(c.clientWidth/2,c.clientHeight/2,vista.value.k*f);};
function baja(ev){arr={x:ev.clientX,y:ev.clientY,vx:vista.value.x,vy:vista.value.y,movio:false};}
function mueve(ev){if(!arr)return;const dx=ev.clientX-arr.x,dy=ev.clientY-arr.y;if(Math.hypot(dx,dy)>4)arr.movio=true;if(arr.movio){suave.value=false;vista.value={...vista.value,x:arr.vx+dx,y:arr.vy+dy};}}
function suelta(){setTimeout(()=>{arr=null;},0);}
// (al tocar algo: su ficha, y el mapa se acerca a él)
function tocar(tipo,o){if(arr?.movio)return;sel.value={tipo,id:o.id};const c=vp.value,[l,t]=pct(o.x,o.z),k=Math.max(vista.value.k,2.6);
 suave.value=true;vista.value={k,x:c.clientWidth/2-l/100*base.value.w*k,y:c.clientHeight/2-t/100*base.value.h*k};}
function dobleClic(ev){const r=vp.value.getBoundingClientRect();suave.value=true;zoomEn(ev.clientX-r.left,ev.clientY-r.top,vista.value.k*1.8);}
onMounted(async()=>{const r=await planoDe({seed:1,team:3,parks:true});bp.value=r.plano;cargando.value=false;await nextTick();
 if(lienzo.value&&bp.value)drawWorldStage(lienzo.value,bp.value,{cell:16,stage:3,fronts:false,dim:false});encuadrar();addEventListener('resize',encuadrar);
 reloj=setInterval(()=>{ahora.value=Date.now();},250);simular(papel.value==='ladron'?'robo':'robo');});
onBeforeUnmount(()=>{removeEventListener('resize',encuadrar);clearInterval(reloj);});
const parte=computed(()=>datos.value?Math.round(100*guardadoN.value/datos.value.metaN):0);
const pestana=ref('todo');
</script>

<template>
 <div class="tablero" :class="papel">
  <div class="fondo" aria-hidden="true"></div>
  <header class="arriba">
   <div class="marca"><b>{{ papel==='ladron'?'La banda':'Central de policía' }}</b><span>{{ papel==='ladron'?'lo que pasa en la ciudad, en vivo':'los avisos, los sospechosos y el mapa' }}</span></div>
   <div v-if="datos" class="reloj"><span>{{ datos.hora }}</span><b>{{ datos.resta }}</b><small>quedan</small></div>
   <div class="botin" v-if="datos"><div class="fila"><span>{{ papel==='ladron'?'Guardado por la banda':'Guardado por ellos' }}</span><b>{{ plata(guardadoN) }} <small>de {{ datos.meta }}</small><em v-if="allan?.incautado" class="incautado"> −{{ plata(allan.incautado) }} incautado</em></b></div><div class="barra"><i :style="{width:parte+'%'}"></i></div></div>
   <div class="papel" role="group" aria-label="Ver el menú de"><button :class="{on:papel==='ladron'}" @click="cambiar('ladron')">Ladrón</button><button :class="{on:papel==='policia'}" @click="cambiar('policia')">Policía</button></div>
   <span class="tecla"><kbd>Tab</kbd> volver a la calle</span>
  </header>

  <div v-if="datos" class="cuerpo">
   <!-- ===== izquierda: vos ===== -->
   <aside class="vos panel">
    <div class="vista"><MunecoVista :cuerpo="cuerpo" :ropa="ropa" /><div class="pedestal" aria-hidden="true"></div>
     <span v-if="papel==='ladron'&&datos.yo.retrato" class="sello">SE BUSCA</span></div>
    <template v-if="papel==='ladron'">
     <div class="cubierta"><small>Te hacés pasar por</small><b>{{ datos.yo.cubierta.nombre }}</b><span>{{ datos.yo.cubierta.oficio }} · {{ datos.yo.cubierta.edad }} años</span></div>
     <ul class="estado"><li><span>Estado</span><b class="ok">{{ datos.yo.estado }}</b></li><li><span>Tu retrato</span><b class="mal">{{ datos.yo.retrato }}</b></li><li><span>Mochila</span><b>{{ datos.yo.mochila }}</b></li></ul>
     <div class="mochila"><span v-for="c in datos.yo.cosas" :key="c">{{ c }}</span></div>
     <button class="boton">Cambiarte de ropa</button>
    </template>
    <template v-else>
     <div class="cubierta"><small>{{ datos.yo.unidad }}</small><b>{{ datos.yo.nombre }}</b><span>{{ datos.yo.patrulla }}</span></div>
     <ul class="estado"><li><span>Estado</span><b class="ok">{{ datos.yo.estado }}</b></li><li><span>Presos</span><b>{{ datos.presos.n }} de {{ datos.presos.de }}</b></li><li><span>Marcados</span><b>{{ datos.marcados.length }}</b></li></ul>
     <button class="boton">Censo · buscar a alguien</button>
    </template>
   </aside>

   <!-- ===== centro: el mapa ===== -->
   <section class="mapa panel">
    <div ref="vp" class="lienzo" @wheel.prevent="rueda" @pointerdown="baja" @pointermove="mueve" @pointerup="suelta" @pointerleave="suelta" @dblclick="dobleClic">
     <div class="marco" :class="{suave,lejos:tamPunto<.65}" :style="{width:base.w+'px',height:base.h+'px','--k':vista.k,'--pk':tamPunto/vista.k,transform:`translate(${vista.x}px,${vista.y}px) scale(${vista.k})`}">
      <canvas ref="lienzo" aria-label="El plano de la ciudad"></canvas>
      <template v-if="papel==='ladron'">
       <template v-if="capas.robos"><template v-for="r in datos.robos" :key="r.id"><span v-for="(p,i) in piezas(r.edificio)" :key="i" class="edif robo" :class="{vivo:r.alarma,sel:sel?.id===r.id}" :style="p" @click="tocar('robo',r)"></span></template></template>
       <template v-if="capas.guaridas"><template v-for="g in datos.guaridas" :key="g.id"><span v-for="(p,i) in piezas(g.edificio)" :key="i" class="edif guarida" :class="{tuya:g.tuya,sel:sel?.id===g.id,delatada:allan&&g.id==='g1'&&!allan.allanada&&!allan.sacado,allanada:allan?.allanada&&g.id==='g1'}" :style="p" @click="tocar('guarida',g)"></span>
        <span class="signo guarida" :style="pos(g.x,g.z)" @click="tocar('guarida',g)"><i>$</i></span></template></template>
       <template v-if="capas.policia"><span v-for="p in datos.patrullas" :key="p.id" class="punto poli" :class="{sel:sel?.id===p.id}" :style="pos(p.x,p.z)" @click="tocar('patrulla',p)"><i></i></span></template>
       <template v-if="capas.banda"><span v-for="b in bandaVista" :key="b.id" class="punto banda" :class="[b.estado,{yo:b.yo,sel:sel?.id===b.id,rastreado:b.rastro?.vivo}]" :style="{...pos(b.x,b.z),'--p':b.rastro?.p??0}" @click="tocar('banda',b)"><i>{{ b.nombre.slice(0,1) }}</i></span></template>
      </template>
      <template v-else>
       <template v-if="capas.avistamientos"><template v-for="a in vistos" :key="a.id"><template v-for="z in zonaDe(a)" :key="z.id"><span v-for="(p,i) in piezas(z.id)" :key="i" class="edif zona" :class="{sel:sel?.id===a.id}" :style="{...p,'--c':z.cerca}" @click="tocar('visto',a)"></span></template></template></template>
       <template v-if="allan"><span v-for="(p,i) in piezas(datos.delatable.edificio)" :key="'d'+i" class="edif delatada" :class="{lista:quedanAllan<=0,allanada:allan.allanada,sel:sel?.tipo==='delatada'}" :style="p" @click="tocar('delatada',datos.delatable)"></span></template>
       <template v-if="capas.robos"><template v-for="r in datos.robos" :key="r.id"><span v-for="(p,i) in piezas(r.edificio)" :key="i" class="edif robo" :class="{vivo:r.alarma,sel:sel?.id===r.id}" :style="p" @click="tocar('robo',r)"></span></template></template>
       <template v-if="capas.comisaria"><span v-for="(p,i) in piezas(datos.comisaria.edificio)" :key="'c'+i" class="edif cai" :class="{sel:sel?.tipo==='comisaria'}" :style="p" @click="tocar('comisaria',{id:'cai',...datos.comisaria})"></span></template>
       <template v-if="capas.avistamientos"><span v-for="a in vistos" :key="'v'+a.id" class="punto visto" :class="{sel:sel?.id===a.id}" :style="pos(a.x,a.z)" @click="tocar('visto',a)"><i>?</i></span></template>
       <span v-for="r in vivos" :key="r.id" class="punto visto vivo" :class="{sel:sel?.id===r.id}" :style="{...pos(r.x,r.z),'--p':r.p}" @click="tocar('rastro',r)"><i>?</i></span>
       <template v-if="capas.equipo"><span v-for="e in datos.equipo" :key="e.id" class="punto poli" :class="{yo:e.yo,sel:sel?.id===e.id}" :style="pos(e.x,e.z)" @click="tocar('equipo',e)"><i>{{ e.nombre.slice(0,1) }}</i></span></template>
      </template>
     </div>
     <div v-for="r in (papel==='ladron'?vivos.filter(r=>r.ladron):vivos)" :key="'a'+r.id" class="alerta-rastro" @pointerdown.stop @click="tocar(papel==='ladron'?'banda':'rastro',papel==='ladron'?bandaVista.find(b=>b.id===r.ladron):r)">
      <b>{{ r.quedan }}</b><span v-if="papel==='ladron'">{{ r.ladron==='b1'?'La policía te ve en su mapa':'La policía ve a '+bandaVista.find(b=>b.id===r.ladron)?.nombre }} · perdete antes de que se acabe</span><span v-else>{{ r.sospechoso }}: lo vemos en vivo · alcanzalo antes de perder el rastro</span></div>
     <div v-if="allan&&!allan.allanada&&!(papel==='ladron'&&allan.sacado)" class="alerta-rastro allan" :style="{top:(10+52*vivos.filter(r=>papel!=='ladron'||r.ladron).length)+'px'}" @pointerdown.stop @click="papel==='ladron'?tocar('guarida',datos.guaridas[0]):tocar('delatada',datos.delatable)">
      <b>{{ quedanAllan||'¡Ya!' }}</b><span v-if="papel==='ladron'">{{ quedanAllan?'Te vieron guardar en El taller: la pueden allanar · sacá el botín':'La policía ya puede allanar El taller' }}</span><span v-else>{{ quedanAllan?'Guardaron botín en '+datos.delatable.texto+': la orden de allanamiento llega en '+quedanAllan+' s':'Orden lista: entrá a '+datos.delatable.texto+' y allanala' }}</span></div>
     <div class="zoom" @pointerdown.stop @dblclick.stop><button aria-label="Acercar" @click="boton(1.6)">+</button><button aria-label="Alejar" @click="boton(1/1.6)">−</button><button aria-label="Ver toda la ciudad" @click="boton(0)">⤢</button></div>
    </div>
    <div class="capas" role="group" aria-label="Capas del mapa"><button v-for="[k,l] in CAPAS[papel]" :key="k" :class="[k,{on:capas[k]}]" :aria-pressed="capas[k]" @click="capas[k]=!capas[k]"><i></i>{{ l }}</button>
     <span class="prueba"><small>Prueba</small><button @click="simular('robo')">Simular robo</button><button @click="simular('papeles')">Simular huida de papeles</button><button @click="simularAllanamiento">Simular guardar con la policía encima</button></span></div>
   </section>

   <!-- ===== derecha: la información ===== -->
   <aside class="info">
    <div class="panel bloque ficha" :class="elegido?.tipo">
     <template v-if="!elegido"><p class="pista">Tocá un edificio pintado o a alguien en el mapa para ver qué pasa ahí. La rueda acerca y aleja; arrastrá para moverte.</p></template>
     <template v-else>
      <button class="cerrar" aria-label="Cerrar" @click="sel=null">×</button>
      <template v-if="elegido.tipo==='guarida'"><small class="tipo">Guarida{{ elegido.tuya?' · la tuya':'' }}</small><b class="titulo">{{ elegido.nombre }}</b><span class="donde">{{ elegido.direccion }}</span>
       <div v-if="allan&&elegido.id==='g1'" class="aviso-rastro allan-txt">
        <template v-if="allan.allanada">La policía la allanó: incautó {{ plata(allan.incautado) }}. Ya no sirve.</template>
        <template v-else-if="allan.sacado">Sacaste el botín: si la allanan, no encuentran nada. Ahora lo llevás encima.</template>
        <template v-else>Te vieron guardar con la policía encima: {{ quedanAllan?'la pueden allanar en '+quedanAllan+' s':'ya la pueden allanar' }}.</template></div>
       <button v-if="allan&&elegido.id==='g1'&&!allan.allanada&&!allan.sacado" class="boton peligro" @click="sacarYa">Sacar lo guardado ({{ elegido.guardado }})</button>
       <dl><dt>Guardado</dt><dd class="plata">{{ allan&&elegido.id==='g1'&&(allan.sacado||allan.allanada)?'$0':elegido.guardado }}</dd><dt>De</dt><dd>{{ elegido.de }}</dd><dt>Último en entrar</dt><dd>{{ elegido.ultimo }}</dd></dl>
       <div class="mochila"><span v-for="c in elegido.cosas" :key="c">{{ c }}</span></div></template>
      <template v-else-if="elegido.tipo==='robo'"><small class="tipo">{{ elegido.alarma?'Robo · la alarma sigue sonando':'Robo' }}</small><b class="titulo">{{ elegido.lugar }}</b><span class="donde">{{ elegido.hace }}</span>
       <dl><dt>Valor</dt><dd class="plata">{{ elegido.valor }}</dd><dt>Cámara</dt><dd>{{ elegido.camara?(elegido.revisada?'la revisaron':'sin revisar'):'no hay' }}</dd><template v-if="elegido.quien"><dt>Quién fue</dt><dd>{{ elegido.quien }}</dd></template></dl>
       <div class="mochila robado"><span v-for="c in elegido.llevaron" :key="c">{{ c }}</span></div></template>
      <template v-else-if="elegido.tipo==='banda'"><small class="tipo">La banda{{ elegido.yo?' · vos':'' }}</small><b class="titulo">{{ elegido.nombre }}</b><span class="donde">{{ elegido.donde }}</span>
       <div v-if="elegido.rastro?.vivo" class="aviso-rastro">La policía lo ve en su mapa: {{ elegido.rastro.quedan }} s para perderse</div>
       <div class="retrato" :class="elegido.estado"><MunecoVista :key="elegido.id" :cuerpo="elegido.cuerpo" :ropa="elegido.ropa" /><span class="estado-tag">{{ elegido.estado }}</span></div>
       <div class="viste"><small>Cómo se ve</small><b>{{ elegido.viste.titulo }}</b><span>{{ elegido.viste.detalle }}</span></div>
       <dl><dt>Se hace pasar por</dt><dd>{{ elegido.cubierta.nombre }} · {{ elegido.cubierta.oficio }}</dd><dt>La policía sabe</dt><dd>{{ elegido.saben }}</dd>
        <template v-if="elegido.va"><dt>Va</dt><dd>{{ elegido.va }}</dd></template><dt>Lleva encima</dt><dd class="plata">{{ elegido.mochila||'nada' }}</dd></dl>
       <div v-if="elegido.lleva.length" class="mochila"><span v-for="c in elegido.lleva" :key="c">{{ c }}</span></div>
       <div class="lo-robado"><small>Lo que robó</small><div v-for="r in elegido.robo" :key="r.lugar" class="robo-item"><b>{{ r.lugar }}</b><span class="plata">{{ r.valor }}</span><div class="mochila robado"><span v-for="c in r.cosas" :key="c">{{ c }}</span></div></div></div></template>
      <template v-else-if="elegido.tipo==='patrulla'"><small class="tipo">Policía vista</small><b class="titulo">{{ elegido.nombre }}</b><span class="donde">cerca de {{ elegido.cerca }} · {{ elegido.visto }}</span>
       <dl><dt>La vio</dt><dd>{{ elegido.quien }}</dd></dl></template>
      <template v-else-if="elegido.tipo==='visto'"><small class="tipo">Visto por última vez</small><b class="titulo con-cerrar">{{ elegido.sospechoso }}</b><span class="donde">cerca de {{ elegido.nombre }} · hace {{ haceTxt(elegido.hace) }}</span>
       <dl><dt>Lo vio</dt><dd>{{ FUENTE[elegido.fuente] }}</dd><dt>Detalle</dt><dd>{{ elegido.detalle }}</dd><dt>Puede estar</dt><dd>hasta {{ radio(elegido) }} m (lo amarillo)</dd></dl></template>
      <template v-else-if="elegido.tipo==='rastro'"><small class="tipo vivo-rojo">● En vivo · quedan {{ elegido.quedan }} s</small><b class="titulo con-cerrar">{{ elegido.sospechoso }}</b><span class="donde">{{ elegido.por==='robo'?'acaba de robar '+elegido.lugar:'huyó cuando le pidieron los papeles' }}</span>
       <div class="cuenta"><i :style="{width:elegido.p*100+'%'}"></i></div>
       <dl><dt>Cómo se ve</dt><dd>{{ elegido.aspecto }}</dd><dt>Después</dt><dd>queda donde se lo vio por última vez</dd></dl></template>
      <template v-else-if="elegido.tipo==='delatada'"><small class="tipo allan-tipo">Guarida delatada</small><b class="titulo">{{ elegido.texto }}</b><span class="donde">guardaron botín con la policía encima</span>
       <template v-if="!allan.allanada"><div class="cuenta"><i class="morado" :style="{width:(1-pAllan)*100+'%'}"></i></div>
        <p class="pista">{{ quedanAllan?'La orden de allanamiento llega en '+quedanAllan+' s. Mientras, vigilá la puerta.':'La orden llegó: entrá y llevate lo que haya, aunque no esté el ladrón.' }}</p>
        <button class="boton" :disabled="quedanAllan>0" @click="allanarYa">{{ quedanAllan?'Allanar ('+quedanAllan+' s)':'Allanar la guarida' }}</button></template>
       <dl v-else><dt>Allanada</dt><dd>sí</dd><dt>Incautado</dt><dd class="plata">{{ allan.incautado?plata(allan.incautado):'nada: ya lo habían sacado' }}</dd></dl></template>
      <template v-else-if="elegido.tipo==='equipo'"><small class="tipo">Tu equipo · {{ elegido.unidad }}{{ elegido.yo?' · vos':'' }}</small><b class="titulo">{{ elegido.yo?'Vos':'Agente '+elegido.nombre }}</b><span class="donde">{{ elegido.donde }}</span>
       <div class="retrato poli"><MunecoVista :key="elegido.id" :cuerpo="elegido.cuerpo" :ropa="elegido.ropa" /><span class="estado-tag">{{ elegido.estado }}</span></div>
       <dl><dt>Anda</dt><dd>{{ elegido.anda }}</dd><template v-if="elegido.va"><dt>Va</dt><dd>{{ elegido.va }}</dd></template><dt>Sigue a</dt><dd>{{ elegido.sigue }}</dd>
        <dt>Presos</dt><dd>{{ elegido.presos }}</dd><dt>Papeles pedidos</dt><dd>{{ elegido.papeles }}</dd></dl>
       <div class="lo-robado"><small>Lo último que hizo</small><div v-for="h in elegido.hizo" :key="h.t" class="robo-item"><span>{{ h.que }}</span><time class="hora">{{ h.t }}</time></div></div></template>
      <template v-else-if="elegido.tipo==='comisaria'"><small class="tipo">Comisaría</small><b class="titulo">{{ elegido.nombre }}</b>
       <dl><dt>Presos</dt><dd>{{ datos.presos.nombres.join(', ') }} ({{ datos.presos.n }} de {{ datos.presos.de }})</dd></dl></template>
     </template>
    </div>
    <template v-if="papel==='ladron'">
     <div class="panel bloque radio"><h3><span class="onda" aria-hidden="true"></span>Frecuencia policial</h3>
      <ul><li v-for="m in datos.radio" :key="m.t+m.texto" :class="{urgente:m.urgente}"><time>{{ m.t }}</time><b>{{ m.quien }}</b><span>{{ m.texto }}</span></li></ul></div>
     <div class="panel bloque"><h3>Lo que saben de la banda</h3>
      <ul class="saben"><li v-for="s in datos.saben" :key="s.quien" :class="{alerta:s.teDescribe,preso:s.preso}"><b>{{ s.quien }}</b>
       <span v-if="s.retrato">Retrato: {{ s.retrato }}</span><span v-if="s.nombreFalso">Saben su nombre falso: «{{ s.nombreFalso }}»</span><small>{{ s.fuente }}<template v-if="s.difundido"> · salió en las noticias</template></small>
       <em v-if="s.teDescribe" class="aviso">Te describe a vos: cambiate de ropa</em><em v-else-if="s.marcada" class="aviso">Marcada: que no la vean con botín</em><em v-else-if="s.preso" class="aviso">Preso: se lo puede rescatar en la comisaría</em></li></ul></div>
     <div class="panel bloque"><h3>La banda <small class="vivo-tag">en vivo</small></h3><ul class="gente"><li v-for="b in datos.banda" :key="b.nombre" :class="b.estado"><span class="avatar">{{ b.nombre.slice(0,1) }}</span><b>{{ b.nombre }}</b><small>{{ b.donde }}</small><em>{{ b.estado }}</em></li></ul></div>
    </template>
    <template v-else>
     <div class="panel bloque radio"><h3><span class="onda" aria-hidden="true"></span>Avisos</h3>
      <ul><li v-for="a in avisosVista" :key="a.t+a.texto.slice(0,20)" :class="{urgente:a.tipo==='alarma'}"><time>{{ a.t }}</time><b>{{ {alarma:'Alarma',vecino:'Vecino',robo:'Robo'}[a.tipo] }}</b><span>{{ a.texto }}</span></li></ul></div>
     <div class="panel bloque"><h3>Sospechosos</h3>
      <ul class="saben"><li v-for="s in datos.sospechosos" :key="s.n"><b>Sospechoso {{ s.n }}</b><span>{{ s.retrato }}</span><span>Vestía: {{ s.ropa }}</span><small>{{ s.visto }}</small>
       <button class="boton chico">{{ s.difundido?'En las noticias':'Difundir en las noticias' }}</button></li></ul></div>
     <div class="panel bloque"><h3>Nombres falsos descubiertos</h3><ul class="gente"><li v-for="m in datos.marcados" :key="m.nombreFalso" class="marcada"><span class="avatar">?</span><b>{{ m.nombreFalso }}</b><small>{{ m.donde }} · {{ m.hace }}</small><em>no está en el censo</em></li></ul></div>
    </template>
   </aside>
  </div>
  <div v-else class="cargando">Armando la ciudad…</div>
 </div>
</template>

<style scoped>
.tablero{--tx:#f5f2ea;--tx2:#c3cad6;--tx3:#8e97a6;--panel:rgba(12,18,30,.82);--borde:rgba(255,255,255,.11);--ladron:#ffa94d;--ladron2:#ff7a3d;--policia:#5aa9ff;--ok:#45d483;--mal:#ff6b5b;--foco:#ffd166;
 --acento:var(--ladron);--t:'Bungee',Impact,sans-serif;--c:'Rubik Variable',system-ui,sans-serif;
 position:fixed;inset:0;overflow:auto;color:var(--tx);font:14px/1.45 var(--c);background:#0b1020;display:flex;flex-direction:column}
.tablero.policia{--acento:var(--policia)}
.fondo{position:fixed;inset:-3%;background:url('/fondos/calle.jpg') center/cover;filter:blur(10px) brightness(.45) saturate(1.1);z-index:0}
.tablero>*:not(.fondo){position:relative;z-index:1}
.panel{background:var(--panel);border:1px solid var(--borde);border-radius:16px;backdrop-filter:blur(14px)}
h3{margin:0 0 10px;font:600 12px var(--c);letter-spacing:1.4px;text-transform:uppercase;color:var(--tx2);display:flex;align-items:center;gap:8px}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}
kbd{padding:2px 7px;border-radius:6px;background:#f2f0ea;color:#1d1f22;font:600 12px ui-monospace,monospace}
.avatar{width:28px;height:28px;border-radius:50%;display:inline-grid;place-items:center;font-weight:700;font-size:13px;background:#5b8def;color:#fff;flex:none}
.boton{border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);border-radius:11px;padding:9px 12px;font-weight:600;width:100%}.boton:hover{background:rgba(255,255,255,.12)}
.boton.chico{width:auto;padding:5px 10px;font-size:12.5px;margin-top:6px;align-self:flex-start}
/* arriba */
.arriba{display:flex;align-items:center;gap:20px;padding:12px 20px;border-bottom:1px solid var(--borde);background:rgba(11,16,32,.7);backdrop-filter:blur(12px);flex-wrap:wrap}
.marca{display:flex;flex-direction:column}.marca b{font:400 22px/1.1 var(--t);color:var(--acento);letter-spacing:.5px}.marca span{color:var(--tx3);font-size:12.5px}
.reloj{display:flex;flex-direction:column;align-items:center;line-height:1.1}.reloj span{font-size:12px;color:var(--tx2)}.reloj b{font:400 24px var(--t)}.reloj small{color:var(--tx3);font-size:11px}
.botin{flex:1;min-width:220px;max-width:420px}.botin .fila{display:flex;justify-content:space-between;font-size:12.5px;color:var(--tx2)}.botin b{color:var(--tx)}.botin small{color:var(--tx3);font-weight:500}
.barra{height:8px;border-radius:4px;background:rgba(255,255,255,.1);margin-top:5px;overflow:hidden}.barra i{display:block;height:100%;background:linear-gradient(90deg,var(--ladron),var(--ladron2))}
.papel{display:flex;padding:3px;border-radius:11px;background:rgba(0,0,0,.35);border:1px solid var(--borde)}.papel button{padding:6px 12px;border-radius:8px;color:var(--tx2);font-weight:600}.papel button.on{background:var(--acento);color:#141a26}
.tecla{color:var(--tx3);font-size:12.5px;margin-left:auto}
/* el cuerpo: tres columnas */
.cuerpo{flex:1;display:grid;grid-template-columns:280px minmax(0,1fr) 340px;gap:16px;padding:16px 20px 20px;min-height:0}
.vos{padding:14px;display:flex;flex-direction:column;gap:12px;align-self:start}
.vista{position:relative;height:300px;border-radius:13px;overflow:hidden;background:radial-gradient(circle at 50% 30%,rgba(255,255,255,.12),transparent 60%),linear-gradient(180deg,#26324a,#131a29)}
.pedestal{position:absolute;left:20%;right:20%;bottom:12px;height:14px;border-radius:50%;background:radial-gradient(ellipse,rgba(0,0,0,.5),transparent 70%)}
.sello{position:absolute;top:12px;left:-6px;transform:rotate(-8deg);background:var(--mal);color:#fff;font:400 15px var(--t);padding:4px 14px;letter-spacing:1px;box-shadow:0 6px 16px rgba(0,0,0,.4)}
.cubierta{display:flex;flex-direction:column;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.05);border-left:3px solid var(--acento)}.cubierta small{color:var(--tx3);font-size:11.5px;text-transform:uppercase;letter-spacing:1px}.cubierta b{font:400 17px var(--t);margin:2px 0}.cubierta span{color:var(--tx2);font-size:13px}
.estado{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}.estado li{display:flex;justify-content:space-between;font-size:13px}.estado span{color:var(--tx3)}.estado .ok{color:var(--ok)}.estado .mal{color:var(--mal)}
.mochila{display:flex;flex-wrap:wrap;gap:5px}.mochila span{font-size:12px;padding:3px 9px;border-radius:20px;background:rgba(255,169,77,.15);color:var(--ladron)}
/* el mapa */
.mapa{padding:12px;display:flex;flex-direction:column;gap:8px;min-height:0}
/* la información */
.info{display:flex;flex-direction:column;gap:14px;min-height:0}
.bloque{padding:14px}
.radio ul,.saben,.gente{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.radio{border-color:color-mix(in srgb,var(--acento) 35%,transparent)}
.radio li{display:grid;grid-template-columns:42px 1fr;column-gap:8px;font-size:13px;padding-left:8px;border-left:2px solid rgba(255,255,255,.12)}
.radio li time{grid-row:span 2;color:var(--tx3);font-variant-numeric:tabular-nums}.radio li b{color:var(--policia);font-size:12px}.radio li span{color:var(--tx2)}
.radio li.urgente{border-color:var(--mal)}.radio li.urgente b{color:var(--mal)}.radio li.urgente span{color:var(--tx)}
.onda{width:9px;height:9px;border-radius:50%;background:var(--mal);animation:onda 1.4s ease-in-out infinite}@keyframes onda{50%{opacity:.25}}
.saben li{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.05);font-size:13px}.saben li span{color:var(--tx2)}.saben li small{color:var(--tx3);font-size:12px}
.saben li.alerta{background:rgba(255,107,91,.12);box-shadow:inset 3px 0 0 var(--mal)}.saben li.preso{opacity:.75}
.aviso{font-style:normal;font-weight:600;color:var(--foco);font-size:12.5px;margin-top:2px}.saben li.alerta .aviso{color:var(--mal)}
.gente li{display:grid;grid-template-columns:auto 1fr auto;column-gap:10px;align-items:center;padding:7px 10px;border-radius:11px;background:rgba(255,255,255,.05)}
.gente li small{grid-column:2;color:var(--tx3);font-size:12px}.gente li b{grid-column:2}.gente li .avatar{grid-row:span 2;background:#c0662a}.gente li em{grid-row:span 2;grid-column:3;font-style:normal;font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:20px;background:rgba(69,212,131,.15);color:var(--ok)}
.gente li.marcada em,.gente li.marcada .avatar{background:rgba(255,209,102,.18);color:var(--foco)}.gente li.preso em{background:rgba(255,255,255,.1);color:var(--tx3)}
.cargando{margin:auto;color:var(--tx2)}
.capas{display:flex;flex-wrap:wrap;gap:6px}.capas button{display:flex;align-items:center;gap:6px;padding:5px 11px;border-radius:20px;border:1px solid var(--borde);font-size:12.5px;color:var(--tx3)}
.capas button.on{color:var(--tx);background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.25)}.capas button i{width:10px;height:10px;border-radius:50%;background:#777}
.capas .banda.on i{background:var(--ladron)}.capas .guaridas.on i{background:transparent;border:2px solid var(--ladron);border-radius:3px}.capas .robos.on i{background:var(--mal)}.capas .policia.on i,.capas .equipo.on i{background:var(--policia);border-radius:3px}
.capas .avistamientos.on i{background:var(--foco)}.capas .comisaria.on i{background:#fff;border:2px solid var(--policia);border-radius:3px}
.vivo-tag{margin-left:auto;font:700 10px var(--c);letter-spacing:1px;color:var(--ok);background:rgba(69,212,131,.15);padding:2px 7px;border-radius:20px}
.lienzo{position:relative;flex:1;min-height:420px;overflow:hidden;border-radius:10px;background:#2b3a44;cursor:grab;touch-action:none;user-select:none}.lienzo:active{cursor:grabbing}
.marco{position:absolute;left:0;top:0;transform-origin:0 0;line-height:0}.marco.suave{transition:transform .35s cubic-bezier(.2,.7,.2,1)}
.marco canvas{width:100%;height:100%;display:block}
/* los edificios pintados: el área entera del lugar, sólo el relleno (2026-10-18, Miguel: el borde se veía feo) */
.edif{position:absolute;cursor:pointer;z-index:1;transition:filter .15s}
.edif:hover{filter:brightness(1.25)}
.edif.robo{background:rgba(255,92,72,.82)}
.edif.robo.vivo{animation:alarma 1s ease-in-out infinite}
@keyframes alarma{50%{background:rgba(255,190,80,.9)}}
.edif.guarida{background:repeating-linear-gradient(45deg,rgba(255,169,77,.95) 0 3px,rgba(255,122,61,.85) 3px 6px)}
.edif.guarida.tuya{background:#ffb347}
.edif.cai{background:rgba(90,169,255,.9)}
.edif.zona{background:rgba(255,200,60,calc(.35 + var(--c)*.55));z-index:0}
.edif.sel{filter:brightness(1.18) saturate(1.25);z-index:2}
/* la gente y las marcas: chicas de lejos y más grandes al acercarse (tamPunto); de lejos, sin la letra */
.marco.lejos .punto i,.marco.lejos .signo i{color:transparent}
.punto,.signo{position:absolute;width:0;height:0;z-index:3;cursor:pointer;line-height:1}
.punto i,.signo i{position:absolute;left:0;top:0;transform:translate(-50%,-50%) scale(var(--pk));display:grid;place-items:center;font:700 11px var(--c);font-style:normal;border-radius:50%;width:20px;height:20px;box-shadow:0 0 0 3px rgba(11,16,32,.75)}
.punto.sel i{box-shadow:0 0 0 3px #fff,0 0 0 6px rgba(11,16,32,.6)}
.punto.banda i{background:var(--ladron);color:#1d1206}.punto.banda.yo i{width:24px;height:24px;border:2px solid #fff}.punto.banda.marcada i{background:var(--foco)}.punto.banda.preso i{background:#888;color:#222}
.punto.poli i{background:var(--policia);border-radius:5px;width:19px;height:19px}.punto.poli.yo i{width:23px;height:23px;border:2px solid #fff}
.punto.visto i{background:var(--foco);color:#1d1206;font-weight:800}
.signo.guarida i{background:#1d1206;color:var(--ladron);border-radius:6px;width:18px;height:18px;font-size:11px;box-shadow:0 0 0 2px var(--ladron);transform:translate(-50%,-50%) scale(var(--pk)) translateY(-16px)}
.zoom{position:absolute;right:10px;top:10px;display:flex;flex-direction:column;gap:4px;z-index:5}.zoom button{width:32px;height:32px;border-radius:9px;background:rgba(11,16,32,.85);border:1px solid var(--borde);font-size:17px;font-weight:700}.zoom button:hover{background:rgba(40,50,70,.95)}
/* la ficha de lo tocado */
.ficha{position:relative;display:flex;flex-direction:column;gap:4px;border-color:color-mix(in srgb,var(--acento) 45%,transparent)}
.ficha .pista{margin:0;color:var(--tx3);font-size:13px}
.ficha .tipo{font:600 11.5px var(--c);letter-spacing:1.2px;text-transform:uppercase;color:var(--tx3)}
.ficha .titulo{font:400 19px/1.2 var(--t);color:var(--tx)}.ficha .donde{color:var(--tx2);font-size:13px}
.ficha.guarida .tipo,.ficha.banda .tipo{color:var(--ladron)}.ficha.robo .tipo{color:var(--mal)}.ficha.visto .tipo{color:var(--foco)}.ficha.equipo .tipo,.ficha.comisaria .tipo,.ficha.patrulla .tipo{color:var(--policia)}
.ficha dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:8px 0 4px;font-size:13px}.ficha dt{color:var(--tx3)}.ficha dd{margin:0;text-align:right}.ficha .plata{color:var(--ok);font-weight:700}
.mochila.robado span{background:rgba(255,107,91,.15);color:var(--mal)}
.ficha .titulo{padding-right:22px}.cerrar{position:absolute;right:10px;top:8px;font-size:20px;color:var(--tx3)}.cerrar:hover{color:var(--tx)}
.retrato{position:relative;height:210px;margin:8px 0 4px;border-radius:12px;overflow:hidden;background:radial-gradient(circle at 50% 30%,rgba(255,255,255,.12),transparent 60%),linear-gradient(180deg,#26324a,#131a29)}
.retrato.preso{filter:grayscale(.7)}.retrato .estado-tag{position:absolute;left:10px;top:10px;font:700 11px var(--c);letter-spacing:1px;text-transform:uppercase;padding:3px 9px;border-radius:20px;background:rgba(69,212,131,.2);color:var(--ok)}
.retrato.marcada .estado-tag{background:rgba(255,209,102,.2);color:var(--foco)}.retrato.preso .estado-tag{background:rgba(255,255,255,.15);color:var(--tx2)}
.viste,.lo-robado{display:flex;flex-direction:column;gap:2px;font-size:13px}.viste small,.lo-robado>small{color:var(--tx3);font-size:11.5px;text-transform:uppercase;letter-spacing:1px}.viste span{color:var(--tx2)}
.lo-robado{margin-top:8px;gap:6px}.robo-item{display:grid;grid-template-columns:1fr auto;gap:4px 8px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.05)}.robo-item .mochila{grid-column:1/-1}
.retrato.poli .estado-tag{background:rgba(90,169,255,.2);color:var(--policia)}.hora{color:var(--tx3);font-variant-numeric:tabular-nums}
.punto.poli i{color:#0b1a2e}
/* el rastro: el «?» en vivo con un anillo que se vacía; el de la banda seguido, con el anillo rojo */
.punto.visto.vivo i{background:#fff;color:#c0392b;animation:rastro 1s ease-in-out infinite}
.punto.visto.vivo i::before,.punto.banda.rastreado i::before{content:'';position:absolute;inset:-7px;border-radius:50%;background:conic-gradient(var(--mal) calc(var(--p)*1turn),rgba(255,255,255,.15) 0);-webkit-mask:radial-gradient(circle,transparent 58%,#000 61%);mask:radial-gradient(circle,transparent 58%,#000 61%)}
@keyframes rastro{50%{box-shadow:0 0 0 6px rgba(255,107,91,.35)}}
.alerta-rastro{position:absolute;left:10px;top:10px;z-index:6;display:flex;align-items:center;gap:10px;max-width:70%;padding:8px 12px;border-radius:12px;background:rgba(120,20,20,.88);border:1px solid rgba(255,107,91,.7);font-size:13px;cursor:pointer;line-height:1.3}
.alerta-rastro+.alerta-rastro{top:62px}.alerta-rastro b{font:400 22px var(--t);color:#fff;min-width:28px;text-align:center}
.prueba{margin-left:auto;display:flex;align-items:center;gap:6px}.prueba small{color:var(--tx3);font-size:11px;text-transform:uppercase;letter-spacing:1px}.prueba button{padding:5px 10px;border-radius:9px;border:1px dashed rgba(255,255,255,.3);font-size:12px;color:var(--tx2)}.prueba button:hover{color:var(--tx);border-style:solid}
.vivo-rojo{color:var(--mal)!important}.cuenta{height:6px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden;margin:6px 0}.cuenta i{display:block;height:100%;background:var(--mal);transition:width .25s linear}
.aviso-rastro{margin-top:6px;padding:7px 10px;border-radius:10px;background:rgba(255,107,91,.15);color:var(--mal);font-weight:600;font-size:13px}
/* el allanamiento: la guarida delatada en morado que late; lista para entrar, fija; allanada, gris */
.edif.delatada{background:repeating-linear-gradient(45deg,rgba(176,108,255,.95) 0 3px,rgba(255,122,61,.85) 3px 6px)!important;animation:delatada 1.2s ease-in-out infinite}
@keyframes delatada{50%{opacity:.55}}
.edif.delatada.lista{animation:none;background:rgba(176,108,255,.95)!important}.edif.delatada.allanada,.edif.guarida.allanada{animation:none;background:rgba(120,120,130,.8)!important}
.alerta-rastro.allan{background:rgba(70,30,120,.9);border-color:rgba(176,108,255,.8)}
.allan-tipo{color:#c49bff!important}.allan-txt{background:rgba(176,108,255,.15);color:#d6bbff}.cuenta i.morado{background:#b06cff}
.boton.peligro{border-color:rgba(176,108,255,.6);color:#d6bbff;margin-top:6px}.boton:disabled{opacity:.5;cursor:default}
.incautado{font-style:normal;color:var(--mal);font-weight:600;margin-left:6px;font-size:12px}
@media (max-width:1100px){.cuerpo{grid-template-columns:240px 1fr}.info{grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}}
@media (max-width:760px){.cuerpo{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.edif.robo.vivo,.onda{animation:none}.marco.suave{transition:none}}
</style>
