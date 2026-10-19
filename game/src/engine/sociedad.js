// ======== La sociedad (2026-10-17, etapa 1): familias, trabajos y horarios ========
// Miguel: «que cada npc tenga un comportamiento predefinido: trabaja de tal hora a tal hora, va al gim a tal hora, hace
// compras tal día, y los horarios de apertura y cierre de la ciudad»; «familias»; «niños que vayan a la escuela».
// Puro y determinista (por semilla de la ciudad, igual en todas las rondas). Reglas en medidas.js RELOJ y SOCIEDAD; lo
// mide validar-sociedad pasando varios días.
//  · sociedadDe(bp): los lugares (con su horario), los hogares (uno por vivienda: viviendas.js) y las personas: nombre,
//    edad, en qué trabaja y dónde, y su semana —por día, los ratos fuera de casa: en un lugar o caminando por la calle—.
//  · dondeEsta(S, persona, t): dónde está a la hora t (s del juego desde el lunes 00:00): su casa, un lugar o la calle.
//  · abierto(S, lugar, t), enCasaHogar(S, hogar, t): ¿abre?, ¿cuántos hay en casa?
//  · inicioRonda(semilla, ronda): el día y la hora en que empieza la ronda; tDeRonda(inicio, s reales) con RELOJ.escala.
//  · ocupacionSociedad(S, inicio, duracion): por vivienda, los tramos de la ronda con y sin gente (en s reales), para
//    enCasa de viviendas.js: la regla del visor y la llamada ya no es una tirada, sale de las familias.
import {RELOJ,SOCIEDAD as S0} from './medidas.js';
import {viviendasDe} from './viviendas.js';
import {planearSemana,paraderosDe} from './rutina.js';
import {rng,mix} from './veredas.js';

const CELL=6,H=3600;
export const DIAS=['lunes','martes','miércoles','jueves','viernes','sábado','domingo'];
const NOMBRES=['Andrés','Camila','Juan','Valentina','Santiago','Mariana','Felipe','Daniela','Carlos','Laura','Sebastián','Natalia','Diego','Paula',
 'Alejandro','Sofía','Mateo','Isabella','Nicolás','Gabriela','Julián','Carolina','David','Juliana','Miguel','Andrea','Jorge','Lucía','Luis','Manuela',
 'Óscar','Catalina','Esteban','Ana','Tomás','Sara','Ricardo','Diana','Samuel','Mónica','Emilio','Lina','Martín','Rosa','Hernán','Gloria'];
const APELLIDOS=['García','Rodríguez','Martínez','López','González','Hernández','Pérez','Sánchez','Ramírez','Torres','Flórez','Rivera','Gómez','Díaz',
 'Reyes','Morales','Ortiz','Castro','Jiménez','Ruiz','Vargas','Rojas','Muñoz','Cárdenas','Ospina','Restrepo','Zapata','Mejía','Arango','Quintero',
 'Duque','Salazar','Cifuentes','Londoño','Valencia','Bermúdez','Ochoa','Navarro','Peña','Cortés'];
const OFICIOS_CASA=['Diseñador','Programador','Contador','Costurero','Traductor','Ilustrador','Profesor particular','Fotógrafo'];
const hash=s=>{let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};

// el horario de un lugar un día (0 = lunes): [abre, cierra] en h, o null si cierra; «siempre», [0, 24]
export function horarioDia(tipo,dia){const h=S0.horarios[tipo];if(!h)return null;if(h.siempre)return [0,24];return (dia<5?h.lv:dia===5?h.sab:h.dom)||null;}
// los turnos de un lugar un día: los de 24 h, de S0.horarios.turnos h (el de la noche pasa al día siguiente); los largos, dos
function turnosDia(tipo,dia){const h=S0.horarios[tipo];if(h?.siempre){const T=S0.horarios.turnos,out=[];for(let a=6;a<30;a+=T)out.push([a,a+T]);return out;}
 const d=horarioDia(tipo,dia);if(!d)return [];const [a,b]=d;if(b-a<=S0.turnoLargo)return [[a,b]];const m=Math.round((a+b))/2;return [[a,m],[m,b]];}

// los lugares de la ciudad: los de trabajo y los que se visitan (por el giro o el tipo del lote) y los parques
function lugaresDe(bp){const out=new Map();
 bp.lots.forEach((L,li)=>{const r=L.rect,x=r?r.x+r.w/2:(L.x0+L.x1+1)/2*CELL,z=r?r.y+r.h/2:(L.y0+L.y1+1)/2*CELL;
  const tipo=L.giro&&S0.horarios[L.giro]?L.giro:L.type==='comercio'||L.type==='local'?'tienda':S0.horarios[L.type]?L.type:null;if(!tipo)return;
  out.set('L'+li,{id:'L'+li,tipo,nombre:L.shopName||L.name||tipo,x,z,pisos:L.floors||1,lote:li});});
 (bp.blocks||[]).forEach((b,i)=>{if(b.use!=='parque'&&b.use!=='plaza')return;out.set('P'+i,{id:'P'+i,tipo:'parque',nombre:b.use==='plaza'?'la plaza':'el parque',x:(b.x0+b.x1+1)/2*CELL,z:(b.y0+b.y1+1)/2*CELL});});
 // las esquinas: en la vereda junto a cada cebra (a los dos lados), donde venden los vendedores de la calle
 (bp.equipamiento||[]).filter(o=>o.tipo==='cebra').forEach((o,i)=>{const c=Math.cos(o.ang||0),s=Math.sin(o.ang||0),d=o.largo/2+S0.informal.vereda;
  for(const k of [1,-1])out.set(`E${i}${k>0?'a':'b'}`,{id:`E${i}${k>0?'a':'b'}`,tipo:'esquina',nombre:'la esquina',x:o.x+c*d*k,z:o.z+s*d*k});});
 // los paraderos de bus (rutina.js)
 for(const q of paraderosDe(bp))out.set(q.id,q);
 // las bancas de la calle y de los parques (equipamiento.js): para descansar (rutina.js, el cansancio). ry: hacia dónde
 // mira el que se sienta —el mismo giro con que la dibuja el 3D, contrato3d—
 (bp.equipamiento||[]).filter(o=>o.tipo==='banca').forEach((o,i)=>{out.set('K'+i,{id:'K'+i,tipo:'banca',nombre:'la banca',x:o.x,z:o.z,ry:o.hacia!=null?Math.atan2(Math.cos(o.hacia),Math.sin(o.hacia)):-(o.ang||0),largo:o.largo||1.7});});
 return out;}

const memo=new WeakMap();
// (eventos: los de rutina.js, para probar cómo se acomoda la ciudad; con eventos no se guarda en la memoria)
export function sociedadDe(bp,{eventos=null}={}){if(!eventos&&memo.has(bp))return memo.get(bp);eventos=eventos||[];
 const lugares=lugaresDe(bp),vs=viviendasDe(bp),hogares=new Map(),personas=[],porId=new Map();
 const de=t=>[...lugares.values()].filter(l=>l.tipo===t),parques=de('parque'),colegio=de('colegio')[0]||null;
 const comprar=['panaderia','fruteria','tienda','tienda','ropa'].flatMap(de),paseos=[...parques,...parques,...de('biblioteca'),...de('ropa'),...de('heladeria')],comer=['pizzeria','hamburgueseria','sushi','heladeria'].flatMap(de),gimnasios=de('gimnasio');
 const S=r=>a=>a[Math.floor(r()*a.length)];
 // ---- las familias: una por vivienda ----
 for(const v of vs){const r=rng(mix(bp.seed,hash(v.id),77)),pick=S(r),T=S0.hogares,ent=(a,b)=>a+Math.floor(r()*(b-a+1));
  let tipo;{let x=r(),acc=0;for(const [k,p] of Object.entries(T.tipos)){acc+=p;if(x<acc){tipo=k;break;}}tipo??='solo';}
  if(v.tipo!=='apto'&&r()<T.casaFamilia)tipo='familia';
  const ap=pick(APELLIDOS),x=v.puertas[0]?.x??0,z=v.puertas[0]?.z??0,hog={id:v.id,tipo,x,z,miembros:[],apellido:ap,vivienda:v};hogares.set(v.id,hog);
  const nueva=edad=>{const p={id:`${v.id}#${hog.miembros.length}`,nombre:`${pick(NOMBRES)} ${edad<18||hog.miembros.length===0||r()<.5?ap:pick(APELLIDOS)}`,edad,hogar:v.id,oficio:null,trabajo:null,rol:null,semana:Array.from({length:7},()=>[])};
   hog.miembros.push(p.id);personas.push(p);porId.set(p.id,p);return p;};
  const [a0,a1]=T.edadAdulto,[m0,m1]=T.edadMayor;
  if(tipo==='solo')nueva(r()<.2?ent(m0,m1):ent(a0,a1));
  else if(tipo==='pareja'){const e=ent(a0,a1);nueva(e);nueva(Math.max(a0,e+ent(-4,4)));}
  else{const e=ent(Math.max(a0,26),a1);nueva(e);if(tipo!=='monoparental')nueva(Math.max(a0,e+ent(-4,4)));
   const n=tipo==='monoparental'?ent(1,2):ent(...T.hijos);for(let i=0;i<n;i++)nueva(ent(0,Math.min(17,e-20)));
   if(tipo==='abuelos')nueva(Math.max(m0,Math.min(m1,e+ent(24,30))));}}
 // ---- los papeles: niños, estudiantes, jubilados, quien cuida a los chicos y los que buscan trabajo ----
 const buscan=[],cuidanTrabajan=[];
 for(const hog of hogares.values()){const r=rng(mix(bp.seed,hash(hog.id),91)),M=hog.miembros.map(id=>porId.get(id));
  for(const p of M){if(p.edad<5){p.rol='pequeño';p.oficio='Niño pequeño';}else if(p.edad<18){p.rol='estudiante';p.oficio='Estudiante';}else if(p.edad>=S0.jubilacion){p.rol='jubilado';p.oficio='Jubilado';}}
  const chicos=M.filter(p=>p.edad<S0.cuidado.solos);
  if(chicos.length){let c=M.find(p=>p.rol==='jubilado');if(!c){const ad=M.filter(p=>!p.rol);c=ad[Math.floor(r()*ad.length)];
    // (la mayoría trabaja de lunes a viernes de día; el resto cuida la casa o trabaja en ella)
    if(r()<S0.cuidado.trabaja){c.rol='cuidaYTrabaja';cuidanTrabajan.push(c);}else{c.rol='cuida';c.oficio=r()<.5?'Cuida la casa':OFICIOS_CASA[Math.floor(r()*OFICIOS_CASA.length)]+' (en casa)';}}
   hog.cuidador=c.id;for(const k of chicos)k.cuidador=c.id;}
  for(const p of M)if(!p.rol){if(r()<S0.trabajan)buscan.push(p);else{p.rol='independiente';p.oficio=OFICIOS_CASA[Math.floor(r()*OFICIOS_CASA.length)]+' (en casa)';}}}
 // ---- los puestos: por lugar y turno, cuántos; se reparten entre los que buscan (al azar de la ciudad) ----
 const rp=rng(mix(bp.seed,4243)),puestos=[];
 for(const l of lugares.values()){const o=S0.oficios[l.tipo];if(!o)continue;const n=o[1]*(l.tipo==='oficinas'?l.pisos:1),nt=Math.max(...DIAS.map((_,d)=>turnosDia(l.tipo,d).length));
  for(let t=0;t<nt;t++)for(let k=0;k<n;k++)puestos.push({lugar:l.id,turno:t,k,n,oficio:o[0]});}
 for(let i=buscan.length-1;i>0;i--){const j=Math.floor(rp()*(i+1));[buscan[i],buscan[j]]=[buscan[j],buscan[i]];}
 // (primero un puesto de cada lugar y turno —k = 0—, así ninguno queda sin nadie si alcanza la gente)
 puestos.sort((a,b)=>a.k-b.k);const vacantes=[];
 // (los que cuidan a los chicos y trabajan: primero, en los puestos de lunes a viernes de día; si no queda, cuidan la casa)
 const deDia=q=>S0.cuidado.lugares.includes(lugares.get(q.lugar).tipo)&&DIAS.every((_,d)=>{const t=turnosDia(lugares.get(q.lugar).tipo,d)[q.turno];return d<5?!!t:!t;});
 for(const p of cuidanTrabajan){const i=puestos.findIndex(q=>!q.ocupado&&deDia(q));if(i<0){p.rol='cuida';p.oficio='Cuida la casa';continue;}const q=puestos[i];q.ocupado=true;p.rol='trabaja';p.cuida=true;p.oficio=q.oficio;p.trabajo=q;}
 for(const q of puestos){if(q.ocupado)continue;const p=buscan.pop();if(!p){vacantes.push(q);continue;}q.ocupado=true;p.rol='trabaja';p.oficio=q.oficio;p.trabajo=q;}
 // (los que no consiguieron puesto: la mayoría vende en la calle —en una esquina—; el resto, sin trabajo)
 const ri=rng(mix(bp.seed,4247)),esq=[...lugares.values()].filter(l=>l.tipo==='esquina');for(let i=esq.length-1;i>0;i--){const j=Math.floor(ri()*(i+1));[esq[i],esq[j]]=[esq[j],esq[i]];}let ke=0;
 for(const p of buscan){if(esq.length&&ri()<S0.informal.parte){p.rol='trabaja';p.oficio=S0.informal.oficio;p.informal=esq[ke++%esq.length].id;}else{p.rol='sinTrabajo';p.oficio='Sin trabajo';}}
 // ---- la semana de cada uno: los ratos fuera de casa (estancias), y de ahí el día con la calle de ida y vuelta ----
 const est=personas.map(()=>Array.from({length:7},()=>[])),idx=new Map(personas.map((p,i)=>[p.id,i]));
 const libre=(p,d,a,b)=>!est[idx.get(p.id)][d].some(e=>a<e.b+.25&&b>e.a-.25);
 const poner=(p,d,a,b,donde,que)=>{if(a<0||b>24||b<=a)return false;est[idx.get(p.id)][d].push({a,b,donde,que});return true;};
 // el trabajo: los días que abre su lugar, salvo el franco (repartido entre los del mismo puesto para que nunca falte uno)
 for(const p of personas){const q=p.trabajo;if(!q)continue;const l=lugares.get(q.lugar),abre=DIAS.map((_,d)=>d).filter(d=>turnosDia(l.tipo,d).length>q.turno);
  const fr=Math.max(0,abre.length-5),francos=new Set();for(let j=0;j<fr;j++)francos.add(abre[(q.k*fr+j+hash(l.id))%abre.length]);
  for(const d of abre){if(francos.has(d))continue;const [a,b]=turnosDia(l.tipo,d)[q.turno];if(b<=24)poner(p,d,a,b,l.id,'trabaja');else{poner(p,d,a,24,l.id,'trabaja');poner(p,(d+1)%7,0,b-24,l.id,'trabaja');}}}
 // los vendedores de la calle: de lunes a sábado en su esquina
 for(const p of personas){if(!p.informal)continue;const [a,b]=S0.informal.horas;for(let d=0;d<S0.informal.dias;d++)poner(p,d,a,b,p.informal,'vende');}
 // quien cuida: lleva y recoge a los del colegio
 for(const hog of hogares.values()){if(!hog.cuidador||!colegio)continue;const c=porId.get(hog.cuidador),esc=hog.miembros.map(id=>porId.get(id)).some(k=>k.rol==='estudiante'&&k.cuidador);if(!esc)continue;
  const [a,b]=S0.horarios.clases,ch=hog.miembros.map(id=>porId.get(id)).filter(k=>k.cuidador);hog.recoge=[];hog.deja=[];
  for(let d=0;d<5;d++){const w=est[idx.get(c.id)][d].find(e=>e.que==='trabaja');
   if(!w){if(!ch.some(k=>k.rol==='estudiante'))continue;poner(c,d,a,a+.25,colegio.id,'lleva a los niños al colegio');poner(c,d,b-.25,b,colegio.id,'recoge a los niños');hog.recoge[d]=b;continue;}
   // (trabaja: los deja antes de entrar —todos, los pequeños al jardín— y los recoge al salir; si trabaja en el colegio, van con él)
   if(w.donde===colegio.id){hog.recoge[d]=w.b;if(w.a<=a)hog.deja[d]=w.a;else{poner(c,d,S0.cuidado.dejar,S0.cuidado.dejar+.25,colegio.id,'deja a los niños en el colegio');hog.deja[d]=S0.cuidado.dejar;}continue;}
   poner(c,d,S0.cuidado.dejar,S0.cuidado.dejar+.25,colegio.id,'deja a los niños en el colegio');hog.deja[d]=S0.cuidado.dejar;
   const v=Math.hypot(lugares.get(w.donde).x-colegio.x,lugares.get(w.donde).z-colegio.z)/S0.rutinas.paso/H,t=Math.ceil((w.b+v)*4)/4;
   poner(c,d,t,t+.25,colegio.id,'recoge a los niños');hog.recoge[d]=t+.25;}}
 // los estudiantes: el colegio de lunes a viernes
 for(const p of personas)if(p.rol==='estudiante'&&colegio)for(let d=0;d<5;d++){const [a,b]=S0.horarios.clases;poner(p,d,a,b,colegio.id,'estudia');}
 // ---- el día de cada uno: la rutina (rutina.js) —lo obligatorio con hora y, en los ratos libres, lo que pidan sus
 // necesidades—, con el viaje a pie o en bus; los eventos (para probar) la atrasan y el resto del día se acomoda ----
 const {diario}=planearSemana({bp,personas,hogares,lugares,porId,est,idx,horarioDia},{eventos});
 // los chicos: con quien los cuida, salvo en el colegio
 for(const p of personas){if(!(p.cuidador&&p.edad<S0.cuidado.solos))continue;const c=porId.get(p.cuidador);p.oficio=p.rol==='pequeño'?'Niño pequeño':'Estudiante';
  const hog=hogares.get(p.hogar);
  for(let d=0;d<7;d++){const hasta=hog.recoge?.[d],esc=d<5&&colegio&&hasta&&(p.rol==='estudiante'||hog.deja[d]!=null)?[hog.deja[d]??S0.horarios.clases[0],hasta]:null,out=[];
   // (acompana: va con quien lo cuida —en una banca no ocupa asiento: se queda de pie al lado, transeuntes—)
   for(const s0 of c.semana[d]){const que=s0.donde==='calle'?'camina con '+c.nombre.split(' ')[0]:'con '+c.nombre.split(' ')[0],{asiento,...s}=s0;s.acompana=true;
    if(!esc||s.h<=esc[0]||s.d>=esc[1])out.push({...s,que});else{if(s.d<esc[0])out.push({...s,h:esc[0],que});if(s.h>esc[1])out.push({...s,d:esc[1],que});}}
   if(esc)out.push({d:esc[0],h:esc[1],donde:colegio.id,que:p.rol==='pequeño'?'en el jardín':'estudia'});p.semana[d]=out.sort((a,b)=>a.d-b.d);}}
 const res={bp,lugares,hogares,personas,porId,vacantes,puestos:puestos.length,diario,eventos};if(!eventos.length)memo.set(bp,res);return res;}

// dónde está una persona a la hora t (s del juego desde el lunes 00:00)
export function dondeEsta(S,p,t){const dia=Math.floor(t/RELOJ.dia)%7,h=(t%RELOJ.dia)/H;for(const s of p.semana[dia])if(h>=s.d&&h<s.h)return s;return {donde:p.hogar,que:'en casa',d:0,h:24};}
export function abierto(S,lugar,t){const l=S.lugares.get(lugar);if(!l)return false;const dia=Math.floor(t/RELOJ.dia)%7,h=(t%RELOJ.dia)/H,o=horarioDia(l.tipo,dia);return !!o&&h>=o[0]&&h<o[1];}
export const enCasaHogar=(S,hog,t)=>S.hogares.get(hog)?.miembros.filter(id=>dondeEsta(S,S.porId.get(id),t).donde===hog).length||0;
// la hora de la ronda: un día y una hora al azar de la semana (en punto), por semilla y ronda
export function inicioRonda(semilla,ronda){const r=rng(mix(semilla,ronda,4241));return (Math.floor(r()*7)*24+Math.floor(r()*24))*H;}
export const tDeRonda=(inicio,s)=>inicio+s*RELOJ.escala;
export const horaTexto=t=>{const d=Math.floor(t/RELOJ.dia)%7,h=(t%RELOJ.dia)/H;return `${DIAS[d]} ${String(Math.floor(h)).padStart(2,'0')}:${String(Math.floor(h%1*60)).padStart(2,'0')}`;};
// por vivienda, los tramos de la ronda [t0, t1, conGente] en s reales (cada s real, un minuto del juego)
export function ocupacionSociedad(S,inicio,duracion,paso=1){const out=new Map();
 for(const hog of S.hogares.values()){const tr=[];let prev=null;for(let s=0;s<duracion;s+=paso){const g=enCasaHogar(S,hog.id,tDeRonda(inicio,s))>0;
   if(prev&&prev[2]===g)prev[1]=Math.min(duracion,s+paso);else{prev=[s,Math.min(duracion,s+paso),g];tr.push(prev);}}
  out.set(hog.id,tr);}
 return out;}
// dónde vive (lo que dicen los papeles)
export function direccionHogar(S,id){const v=S.hogares.get(id)?.vivienda;if(!v)return '';return v.tipo==='apto'?`${v.edificio}, apto ${v.apto}`:v.direccion?`la casa de ${v.direccion}`:'una casa del monte';}
// ¿está en el censo? (alguien de una familia con ese nombre)
export const enCenso=(S,nombre)=>S.personas.some(p=>p.nombre===nombre);
// un nombre al azar (para los que no son de una familia: el ladrón de incógnito, el policía)
export const nombreAlAzar=r=>`${NOMBRES[Math.floor(r()*NOMBRES.length)]} ${APELLIDOS[Math.floor(r()*APELLIDOS.length)]}`;
export const apellidoAlAzar=r=>APELLIDOS[Math.floor(r()*APELLIDOS.length)];
// un oficio de verdad de la ciudad (de los adultos que trabajan afuera): lo que dice el ladrón si le preguntan
export function oficioAlAzar(S,r){const o=S.personas.filter(p=>p.rol==='trabaja');return o.length?o[Math.floor(r()*o.length)].oficio:'Sin trabajo';}
// Las puertas de calle que se trancan cuando su lugar cierra (2026-10-17, etapa 2): la de cada local (el cuarto con giro)
// y, en un lote sin viviendas que es un lugar (oficinas, colegio, biblioteca…), todas las de la calle. El portal de los
// edificios con viviendas nunca (los vecinos entran a cualquier hora). Los de 24 h no cierran.
export function puertasDeLugares(bp,S){const out=[],conViviendas=new Set();for(const h of S.hogares.values())if(h.vivienda.lote!=null)conViviendas.add(h.vivienda.lote);
 for(const l of S.lugares.values()){if(l.lote==null||S0.horarios[l.tipo]?.siempre)continue;const L=bp.lots[l.lote],lv=L.levels?.find(v=>v.level===0);if(!lv)continue;
  for(const d of lv.doors){if(!d.street)continue;const room=lv.rooms.find(r=>r.id===d.a);if(!(room?.giro||!conViviendas.has(l.lote)))continue;
   out.push({id:`${l.id}#${out.length}`,lugar:l.id,vivienda:l.id,lote:l.lote,x0:d.x0,z0:d.y0,x1:d.x1,z1:d.y1,nivel:0});}}
 return out;}
