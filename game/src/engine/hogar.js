/* Las casas desde la familia (FUGA, 2026-10-12): de adentro hacia afuera. Quién vive ahí da su programa (la lista de
   cuartos de blueprint PROGRAMS, cada uno con su juego de muebles); cada cuarto arranca de su medida mínima (minRoom,
   la compacta: proporción hasta 1:1,5) y la casa sale de juntarlos por zonas, como se diseña una vivienda:

   - adelante, la zona social (sala, comedor, cocina; el medio baño de las visitas), con la puerta de calle en la sala;
   - en el medio, el pasillo (1,1 m) que reparte: ningún cuarto se cruza para llegar a otro;
   - atrás (o arriba, en dos pisos), la zona privada: dormitorios y baños, cada uno con su puerta al pasillo.

   Cada franja pone sus cuartos uno al lado del otro; la casa toma el ancho de la franja más ancha y los cuartos de las
   otras crecen hasta llenarlo (nunca se achican por debajo de su mínimo). Con dos pisos, la escalera (recta, 1 × 4,6 m)
   va en la franja de atrás de abajo y en la misma huella arriba, junto al pasillo. Puertas a 10 cm de la esquina del
   borde que comparten; una ventana en el medio de cada borde que da afuera. Los muebles, con el mismo motor de la
   ciudad (furnishProgram), en el marco de la casa: u a lo ancho del frente, v hacia el fondo (el frente en v = 0).
   Puros datos; lo dibuja lib/drawPlan.js drawHogar. */
import {PROGRAMS,minRoom,furnishProgram} from './blueprint.js';
import {navHogar} from './nav-interior.js';
import {MINIMOS} from './cuartos-minimos.js';
import {JUEGO_PASO,MURO} from './medidas.js';

// Quién vive en la casa: su programa (cuartos) y cuántos pisos prefiere (si hay muchos cuartos, dos).
export const HOGARES={
 solo:{label:'Una persona',rooms:['sala_comedor','cocina_linea','dormitorio_doble','bano']},
 pareja:{label:'Pareja',rooms:['sala','comedor_4','cocina_completa','dormitorio_principal','bano','estudio']},
 familia:{label:'Familia con un hijo',rooms:['sala','comedor_4','cocina_completa','medio_bano','dormitorio_principal','dormitorio_sencillo','bano']},
 familia_grande:{label:'Familia con tres hijos',rooms:['sala','comedor_6','cocina_completa','medio_bano','dormitorio_principal','dormitorio_dos_camas','dormitorio_estudiante','bano','bano']},
 estudiantes:{label:'Tres estudiantes',rooms:['sala_comedor','cocina_linea','dormitorio_estudiante','dormitorio_estudiante','dormitorio_estudiante','bano','bano']},
 abuelos:{label:'Abuelos',rooms:['sala','comedor_4','cocina_completa','dormitorio_doble','bano_amplio','estudio']}};
const SOCIAL=new Set(['sala','comedor_4','comedor_6','sala_comedor','cocina_linea','cocina_completa','medio_bano','estudio']);
// El orden dentro de cada franja: la sala al medio del frente (con la puerta), el comedor junto a la cocina; los baños
// entre los dormitorios.
const ORDER={estudio:0,sala:1,sala_comedor:1,comedor_4:2,comedor_6:2,cocina_completa:3,cocina_linea:3,medio_bano:4,
 dormitorio_principal:0,bano:1,bano_amplio:1,dormitorio_doble:2,dormitorio_sencillo:3,dormitorio_dos_camas:3,dormitorio_estudiante:4};
// (la escalera de las casas de vivienda.js: recta, 1,2 m, 16 peldaños en 4,48 m y un descanso de 1,2 m arriba, contra
// la pared izquierda; a su lado, un paso de 1,3 m para llegar del descanso al pasillo de arriba. 2026-10-15: antes
// 1 m y 3,5 m, en un rectángulo de 2,3 × 4,9)
// (el pasillo: el ancho libre que pide el juego en una casa —JUEGO_PASO.casa, 1,3— más un tabique; hasta 2026-10-16, 1,1:
// 0,98 libres, menos que MINIMO.hall)
const HALL=Math.ceil((JUEGO_PASO.casa+MURO.tabique)*20-1e-9)/20,STAIR_RECT=[2.5,5.9],DOOR=.9;
const info=k=>k==='escalera'?{type:'escalera',label:'Escalera'}:k==='deposito'?{type:'deposito',label:'Depósito'}:{type:PROGRAMS[k].type,label:PROGRAMS[k].label};
// Las dos medidas mínimas de cada programa, [ancho, fondo] con la puerta en el lado de adelante: hondo (la puerta en el
// lado corto) y ancho (la puerta en el lado largo).
// (BUMP: lo que se le agrega a un programa que, ya puesto en la casa, no alcanzó a llevar todos sus muebles)
// (de la tabla generada —cuartos-minimos.js—; si falta un programa, se mide)
const MIN=new Map();let BUMP={};const minOf=(k,wide=false)=>{const key=k+(wide?'|w':'');if(!MIN.has(key)){const T=MINIMOS[k]?.[wide?'ancho':'hondo'];const R=T?{W:T[0],D:T[1]}:minRoom(k,{ratio:1.5,wide});MIN.set(key,R?[R.W,R.D]:[3,3]);}const [w,d]=MIN.get(key),b=BUMP[k]||0;return [w+b,d+b];};

// Una franja: sus cuartos de lado a lado, todos con la puerta hacia el pasillo. Cada uno puede ir hondo o ancho; se
// prueba cada fondo posible de la franja y queda el que da la franja de menor área (cada cuarto, en el giro más angosto
// que entra en ese fondo).
function band(keys){let best=null;const opts=keys.map(k=>[minOf(k),minOf(k,true)]);
 for(const Dc of [...new Set(opts.flat().map(o=>o[1]))]){const rooms=[];let ok=true;
  for(let i=0;i<keys.length;i++){const fit=opts[i].filter(o=>o[1]<=Dc+1e-6).sort((x,y)=>x[0]-y[0])[0];if(!fit){ok=false;break;}rooms.push({k:keys[i],w:fit[0],d:fit[1]});}
  if(!ok)continue;const W=rooms.reduce((a,r)=>a+r.w,0);if(!best||W*Dc<best.W*best.D)best={W,D:Dc,rooms};}
 return {D:best.D,rooms:best.rooms};}
// Las anchuras de una franja estiradas a W (lo que sobra, repartido en proporción).
function stretch(rooms,W){const sum=rooms.reduce((a,r)=>a+r.w,0),k=W/sum;let u=0;return rooms.map(r=>{const w=r.w*k,o={...r,u0:u,u1:u+w};u+=w;return o;});}

// Qué puede ir en cada franja: lo que sólo va adelante (la sala, con la puerta de calle), lo que sólo va atrás (lo
// privado en un piso; la escalera) y lo que puede ir en cualquiera (se reparte para que las dos franjas midan parecido:
// así ningún cuarto se estira de más).
const FRONT_ONLY=/^(sala|sala_comedor)$/,EITHER1=/^(comedor_4|comedor_6|cocina_linea|cocina_completa|estudio|medio_bano)$/;
const q25=v=>Math.ceil(v*4-1e-6)/4,GROW=1.3;
const widthOf=keys=>keys.length?band(keys).rooms.reduce((a,r)=>a+r.w,0)+(keys.includes('escalera')?STAIR_RECT[0]:0):0;
// Reparte «either» entre las dos franjas probando todas las combinaciones (son pocas).
// (la cocina y el comedor, en la misma franja: uno al lado del otro; y un dormitorio adelante —a la calle— sólo si
// ahorra: cada uno pesa como 3 m más de casa)
function balance(front,back,either){let best=null;const pair=k=>/^(cocina|comedor)/.test(k);
 for(let m=0;m<1<<either.length;m++){const f=[...front],b=[...back];either.forEach((k,i)=>(m>>i&1?b:f).push(k));
  if(f.some(pair)&&b.some(pair))continue;
  const wf=widthOf(f.filter(k=>k!=='escalera')),wb=widthOf(b.filter(k=>k!=='escalera'))+(b.includes('escalera')?STAIR_RECT[0]:0),sc=Math.max(wf,wb)*10+Math.abs(wf-wb)+30*f.filter(k=>/^dormitorio/.test(k)).length;
  if(!best||sc<best.sc)best={sc,f,b};}
 return [best.f,best.b];}

// La casa se arma, se revisa qué cuarto quedó sin algo de su receta (las ventanas de una esquina, las fachadas de dos
// lados, la puerta en otro lugar: el cuarto mínimo se midió suelto) y ese programa crece 25 cm; hasta que entre todo.
// (cada familia da siempre la misma casa: se calcula una vez)
// Cuatro versiones por familia (variant 0–3), para que las casas de la misma familia no sean iguales por dentro:
// bit 1, el orden de los cuartos de cada franja al revés; bit 2, un cuarto más (EXTRA: un estudio, un cuarto de
// huéspedes, un medio baño). La escalera queda siempre contra la pared izquierda.
export const EXTRA={solo:'estudio',pareja:'dormitorio_sencillo',familia:'estudio',familia_grande:'estudio',estudiantes:'medio_bano',abuelos:'dormitorio_sencillo'};
const PLANS=new Map();
export function planHogar(kind='familia',opts={}){const v=(opts.variant|0)&3,key=kind+'#'+v;if(!PLANS.has(key)){const P=buildHogar(kind,{...opts,variant:v});P.variant=v;PLANS.set(key,P);}return PLANS.get(key);}
// Con qué frecuencia vive cada una en el monte.
export const HOGAR_PESO={solo:1,pareja:2,familia:3,familia_grande:1.5,estudiantes:1,abuelos:1.5};
function buildHogar(kind='familia',{rounds=12,variant=0}={}){BUMP={};let P;const H=HOGARES[kind],list=variant&2&&EXTRA[kind]?[...H.rooms,EXTRA[kind]]:H.rooms,two=list.reduce((a,k)=>a+minOf(k)[0]*minOf(k)[1],0)>55;
 // (2026-10-16: y que se pueda recorrer caminando —nav-interior.js, con el radio del personaje—: un cuarto al que no se
 // llega desde la calle crece como el que no lleva sus muebles; si no se entra a la casa, crece el de la puerta de calle)
 for(let i=0;i<rounds;i++){P=layoutHogar(kind,two,list,variant&1);P.missing=missingOf(P);P.sinPaso=sinPasoDe(P);P.rounds=i+1;if(!P.missing.length&&!P.sinPaso.length)break;
  for(const m of [...P.missing,...P.sinPaso])BUMP[m.prog]=(BUMP[m.prog]||0)+.25;}
 P.bump={...BUMP};return P;}
function sinPasoDe(P){const out=[],nav=navHogar(P);
 for(const [k,p] of nav.entries()){const L=P.levels[k],porId=new Map(L.rooms.map(q=>['r'+q.id,q]));const malos=p.espacios.filter(e=>e.libres>.05&&e.alcanzado<=0);if(!malos.length)continue;
  // si no se entra a nada en planta baja: el cuarto de la puerta de calle
  if(k===0&&p.espacios.every(e=>e.alcanzado<=0)){const d=(L.doors||[]).find(d=>d.street||d.b==='calle'),q=d&&L.rooms.find(q=>q.id===d.a);if(q?.prog)out.push({level:L.level,prog:q.prog,label:q.label,kind:'paso'});continue;}
  for(const e of malos){const q=porId.get(e.id);if(q?.prog)out.push({level:L.level,prog:q.prog,label:q.label,kind:'paso'});}}
 return out;}
function missingOf(P){const out=[];for(const L of P.levels)for(const q of L.rooms){const P0=PROGRAMS[q.prog];if(!P0)continue;const have=L.furniture.filter(f=>f.room===q.id).map(f=>f.kind),need={};
  for(const e of P0.recipe){const n=e.split(':')[0];need[n]=(need[n]||0)+1;}for(const [n,c] of Object.entries(need))if(have.filter(x=>x===n).length<c){out.push({level:L.level,prog:q.prog,label:q.label,kind:n});break;}}
 return out;}
function layoutHogar(kind,two,list,rev){const H=HOGARES[kind],keys=[...list];
 const soc=keys.filter(k=>SOCIAL.has(k)),priv=keys.filter(k=>!SOCIAL.has(k)),area=keys.reduce((a,k)=>a+minOf(k)[0]*minOf(k)[1],0);// (con la medida honda)
 const byOrder=l=>[...l].sort((a,b)=>(ORDER[a]??9)-(ORDER[b]??9));
 let floors;
 if(!two)floors=[balance(soc.filter(k=>FRONT_ONLY.test(k)),priv.filter(k=>!/^dormitorio/.test(k)),[...soc.filter(k=>!FRONT_ONLY.test(k)),...priv.filter(k=>/^dormitorio/.test(k))])];
 else floors=[balance(soc.filter(k=>FRONT_ONLY.test(k)),['escalera'],soc.filter(k=>!FRONT_ONLY.test(k))),balance([],['escalera'],priv)];
 floors=floors.map(([f,b])=>[byOrder(f),byOrder(b)]).map(([f,b])=>rev?[f.reverse(),b.filter(k=>k!=='escalera').reverse().concat(b.includes('escalera')?['escalera']:[])]:[f,b]);
 // Medidas: cada franja con su fondo; el ancho de la casa, el de la franja más ancha (de todos los pisos). Lo que a una
 // franja le falta para llegar: sus cuartos crecen hasta un 30 % y, si aún falta más de 1,2 m, un depósito.
 const mk=list=>{const ks=list.filter(k=>k!=='escalera'),B=ks.length?band(ks):{D:0,rooms:[]};if(list.includes('escalera')){B.rooms.push({k:'escalera',w:STAIR_RECT[0],d:STAIR_RECT[1]});B.D=Math.max(B.D,STAIR_RECT[1]);}return B;};
 const F=floors.map(([f,b])=>[mk(f),mk(b)]),W=q25(Math.max(...F.flat().map(B=>B.rooms.reduce((a,r)=>a+r.w,0))));
 for(const B of F.flat()){const sum=B.rooms.reduce((a,r)=>a+r.w,0),flex=B.rooms.filter(r=>r.k!=='escalera').reduce((a,r)=>a+r.w,0);
  if(W-sum>flex*(GROW-1)+1e-6&&W-sum-flex*(GROW-1)>=1.2)B.rooms.push({k:'deposito',w:W-sum-flex*(GROW-1),d:B.D||2});}
 const Df=Math.max(...F.map(p=>p[0].D)),Db=Math.max(...F.map(p=>p[1].D)),D=q25(Df+HALL+Db);
 const levels=F.map(([fr,bk],level)=>{const rooms=[],doors=[],windows=[];let id=0;
  // la escalera, a la derecha de la franja de atrás en los dos pisos (en la misma huella)
  const order=list=>list.some(r=>r.k==='escalera')?[...list.filter(r=>r.k!=='escalera'),list.find(r=>r.k==='escalera')]:list;
  const place=(list,v0,v1,band)=>stretch(order(list),W).forEach(r=>rooms.push({id:id++,prog:r.k,...info(r.k),band,u0:r.u0,u1:r.u1,v0,v1,Lu:W,Lv:D}));
  // (la escalera conserva su ancho: los demás cuartos de su franja se reparten lo que queda)
  if(fr.rooms.length)place(fr.rooms,0,Df,'front');
  const hall={id:id++,prog:'pasillo',type:'hall',label:'Pasillo',band:'hall',u0:0,u1:W,v0:Df,v1:Df+HALL,Lu:W,Lv:D};rooms.push(hall);
  if(bk.rooms.length){const st=bk.rooms.find(r=>r.k==='escalera'),rest=bk.rooms.filter(r=>r.k!=='escalera'),Wr=st?W-st.w:W;
   // (la escalera, en el extremo izquierdo de la franja de atrás: contra la pared izquierda, como en vivienda.js)
   const sw=st?st.w:0;stretch(rest,Wr).forEach(r=>rooms.push({id:id++,prog:r.k,...info(r.k),band:'back',u0:r.u0+sw,u1:r.u1+sw,v0:Df+HALL,v1:D,Lu:W,Lv:D}));
   if(st)rooms.push({id:id++,prog:'escalera',type:'escalera',label:'Escalera',band:'back',u0:0,u1:sw,v0:Df+HALL,v1:D,Lu:W,Lv:D});}
  // Puertas: cada cuarto al pasillo (en el borde que comparten, a 10 cm de la esquina); la puerta de calle en la sala.
  for(const q of rooms){if(q===hall)continue;const at=q.band==='front'?q.v1:q.v0,a=q.u0,b=q.u1;
   if(q.type==='escalera'){doors.push({axis:'u',at,from:a+.05,len:b-a-.1,a:q.id,b:hall.id,open:true});continue;}
   const left=(q.u0+q.u1)/2<W/2;doors.push({axis:'u',at,from:left?b-.1-DOOR:a+.1,len:DOOR,a:q.id,b:hall.id});}
  // Entre la sala, el comedor y la cocina vecinos (en la misma franja), un vano de 1,2 m en la pared que comparten: se
  // pasa de uno al otro sin salir al pasillo.
  const SOC=/^(sala|sala_comedor|comedor_4|comedor_6|cocina_linea|cocina_completa)$/;
  for(const p of rooms)for(const o of rooms)if(p.id<o.id&&p.band===o.band&&SOC.test(p.prog)&&SOC.test(o.prog)&&Math.abs(p.u1-o.u0)<1e-6){
   const a=Math.max(p.v0,o.v0),b=Math.min(p.v1,o.v1),len=Math.min(1.2,b-a-.4),from=p.band==='front'?a+.2:b-.2-len;// (lejos del pasillo: el vano y la puerta no se juntan)
   doors.push({axis:'v',at:p.u1,from,len,a:p.id,b:o.id,open:true});}
  const sala=rooms.find(q=>/^sala/.test(q.prog)&&q.band==='front');
  if(level===0&&sala)doors.push({axis:'u',at:0,from:(sala.u0+sala.u1)/2-.5,len:1,a:sala.id,b:'calle',street:true});
  // (2026-10-16, Miguel: «que uno pueda tener acceso a los patios»: la puerta de atrás, al patio, desde un cuarto de la franja
  // de atrás que llega a la pared del fondo —la cocina, si no el comedor o la sala, si no cualquiera que no sea baño ni
  // escalera, el dormitorio al final—, en el medio de su pared)
  if(level===0){const atras=rooms.filter(q=>q.band==='back'&&Math.abs(q.v1-q.Lv)<1e-6&&q.u1-q.u0>=1.3&&!['bano','escalera'].includes(q.type)),pref=q=>/cocina/.test(q.prog)?0:/comedor/.test(q.prog)?1:/sala/.test(q.prog)?2:q.type==='dormitorio'?4:3;
   const q=atras.sort((a,b)=>pref(a)-pref(b))[0];
   // (corrida hacia un extremo de la pared —2026-10-18, validar-vanos—: centrada, ocupaba el lugar de la ventana del cuarto)
   if(q)doors.push({axis:'u',at:q.v1,from:Math.max(q.u0+.35,q.u1-(Math.abs(q.u1-q.Lu)<.01?1.35:1.2)),len:.9,a:q.id,b:'patio',patio:true});}
  // Ventanas: en el medio de cada borde que da afuera (las de los baños, chicas), menos donde va la puerta de calle.
  for(const q of rooms){if(q.type==='escalera'||q===hall)continue;const bano=q.type==='bano',wl=bano?.6:Math.min(1.2,(q.u1-q.u0)-.6);
   const add=(axis,at,c0,c1,len)=>{if(len<.5)return;windows.push({axis,at,from:(c0+c1)/2-len/2,len,a:q.id,small:bano});};
   // (una sola ventana por cuarto: la de adelante o la de atrás; la del costado, si no tiene otra)
   const n0=windows.length;if(q.v0===0&&!(level===0&&q===sala))add('u',0,q.u0,q.u1,wl);
   if(Math.abs(q.v1-D)<1e-6)add('u',D,q.u0,q.u1,wl);
   if(windows.length===n0&&q.u0===0)add('v',0,q.v0,q.v1,bano?.6:Math.min(1.2,(q.v1-q.v0)-.6));
   if(windows.length===n0&&Math.abs(q.u1-W)<1e-6)add('v',W,q.v0,q.v1,bano?.6:Math.min(1.2,(q.v1-q.v0)-.6));
   if(level===0&&q===sala){const c=(sala.u0+sala.u1)/2,side=(sala.u1-sala.u0)/2;if(side>1.6)add('u',0,c+.6,sala.u1,Math.min(1.2,side-.9));}}
  // Los muebles de cada cuarto (con sus puertas y ventanas), con el motor de la ciudad.
  const furniture=[];for(const q of rooms){if(!PROGRAMS[q.prog])continue;const open={doors:doors.filter(d=>d.a===q.id||d.b===q.id),windows:windows.filter(w=>w.a===q.id)};
   furniture.push(...furnishProgram(q,open,PROGRAMS[q.prog].recipe));}
  return {level,rooms,doors,windows,furniture};});

 const used=keys.reduce((a,k)=>a+minOf(k)[0]*minOf(k)[1],0);
 return {kind,label:H.label,W,D,floors:levels.length,levels,area:+(W*D*levels.length).toFixed(1),minArea:+used.toFixed(1)};}
