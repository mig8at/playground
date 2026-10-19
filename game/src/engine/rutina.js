// ======== La rutina: agenda y necesidades (2026-10-18) ========
// Miguel: «que tengan agenda y necesidades; si hay un trancón o un robo y el tiempo se descuadró, la necesidad debe
// priorizar: descartar unas cosas por otras para ponerse al día; que no se comporte raro después de un tiempo sino que
// se estabilice; calibrarlo en el 2D». Reglas en medidas.js RUTINA; lo mide validar-rutina; lo calibra calibrar.mjs.
// Puro y determinista (por semilla de la ciudad y los eventos que se le den).
//  · Lo obligatorio (la agenda, de sociedad.js: el trabajo, el colegio, llevar y recoger a los chicos, vender en la
//    esquina) tiene hora. En los ratos libres cada uno elige, entre los lugares abiertos que le quedan a tiempo, el que
//    mejor cubre sus necesidades (hambre, despensa del hogar, físico si es socio del gimnasio, ocio). La elección se
//    hace en el momento: si algo lo atrasa, lo que ya no cabe no se hace (lo opcional se cae primero; lo flexible se
//    acorta hasta su mínimo) y lo obligatorio se hace aunque sea tarde. Dormir reinicia el día; lo pendiente pasa al
//    otro con su necesidad más alta (y por eso más peso).
//  · El viaje: a pie hasta RUTINA.viaje.caminaHasta m; más lejos, el bus si llega antes (caminar al paradero, esperar
//    el próximo, ir en bus, caminar desde el paradero). Los paraderos: los de la ciudad (equipamiento «parada») y unos
//    a lo largo de las carreteras del monte.
//  · Los eventos (para probar): {dia, desde, hasta (h), tipo: 'trancon' (los buses tardan demora h), 'robo' (el que
//    camina cerca de x, z —a menos de r m— corre o da la vuelta: demora h), 'cierre' (el lugar no abre ese día)}.
//  · planearSemana(ctx, {eventos}) arma p.semana (de los que no van con quien los cuida) y devuelve el diario: por
//    persona y por día, cuántas veces comió, a qué llegó tarde, qué se perdió y qué necesidades quedaron pendientes.
import {RUTINA as R0,SOCIEDAD as S0} from './medidas.js';
import {rng,mix} from './veredas.js';

const H=3600;
const hashS=s=>{let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
// (el ruido de una decisión: de la persona, el día, el lugar y el cuarto de hora —no del orden en que se sacan los
// números—; si algo cambia un rato, las decisiones de después no cambian por eso: la ciudad vuelve a lo normal)
const ruido=(id,d,lugar,t)=>(hashS(`${id}|${d}|${lugar}|${Math.round(t*4)}`)%10000)/10000;
const NEC=['hambre','despensa','fisico','ocio','energia'];

// los paraderos: los de la ciudad y, en el monte, uno cada entreParadasMonte m a lo largo de las carreteras
export function paraderosDe(bp){const out=[],CELL=6,W=bp.map.W*CELL,Hh=bp.map.H*CELL;
 for(const o of bp.equipamiento||[])if(o.tipo==='parada')out.push({x:o.x,z:o.z});
 const d0=R0.viaje.bus.entreParadasMonte;
 for(const c of bp.isla?.carreteras||[])for(const p of c.puntos||[]){if(p.x>=0&&p.z>=0&&p.x<=W&&p.z<=Hh)continue;if(out.some(q=>Math.hypot(q.x-p.x,q.z-p.z)<d0))continue;out.push({x:p.x,z:p.z});}
 return out.map((q,i)=>({id:'B'+i,tipo:'parada',nombre:'el paradero',x:q.x,z:q.z}));}

export function planearSemana(ctx,{eventos=[]}={}){const {bp,personas,hogares,lugares,porId,est,idx,horarioDia}=ctx,R=R0,V=R.viaje;
 const pos=id=>lugares.get(id)||hogares.get(id);
 const dist=(a,b)=>{const A=pos(a),B=pos(b);return A&&B?Math.hypot(A.x-B.x,A.z-B.z)*1.25:0;};// (por las calles: un cuarto más que la recta)
 const aPie=m=>m/V.camina/H;
 const paradas=[...lugares.values()].filter(l=>l.tipo==='parada');
 const paradaCerca=id=>{const A=pos(id);let best=null,bd=1e9;for(const q of paradas){const d=Math.hypot(q.x-A.x,q.z-A.z);if(d<bd){bd=d;best=q;}}return best;};
 const evDe=d=>eventos.filter(e=>e.dia===d);
 // el viaje de a a b saliendo a la hora h del día d: a pie o en bus (con los eventos que lo atrasen)
 // (conEventos=false: el tiempo que uno espera que tarde —nadie sabe del trancón antes de salir—; true: el que tarda)
 function viaje(a,b,h,d,conEventos=true){if(a===b)return {dur:0,tramos:[]};const dm=dist(a,b),tw=aPie(dm),B=V.bus,ev=conEventos?evDe(d):[];
  // (un robo cerca del camino a pie: corre o da la vuelta)
  const robo=(x0,z0,x1,z1,t0,t1)=>{let extra=0;for(const e of ev){if(e.tipo!=='robo'||t1<e.desde||t0>e.hasta)continue;const vx=x1-x0,vz=z1-z0,L2=vx*vx+vz*vz||1,u=Math.max(0,Math.min(1,((e.x-x0)*vx+(e.z-z0)*vz)/L2));
   if(Math.hypot(x0+vx*u-e.x,z0+vz*u-e.z)<e.r)extra=Math.max(extra,e.demora);}return extra;};
  const A=pos(a),Bp=pos(b),pie={dur:tw,tramos:[{tipo:'camina',de:a,a:b,dur:tw}],extra:0};pie.extra=robo(A.x,A.z,Bp.x,Bp.z,h,h+tw);pie.dur+=pie.extra;pie.tramos[0].dur=pie.dur;
  if(dm<=V.caminaHasta||!paradas.length||h<B.desde||h>B.hasta-.25)return pie;
  const s1=paradaCerca(a),s2=paradaCerca(b);if(!s1||!s2||s1===s2)return pie;
  const w1=aPie(dist(a,s1.id)),llega=h+w1,sale=Math.max(B.desde,Math.ceil((llega-B.desde-1e-9)/B.frecuencia)*B.frecuencia+B.desde),espera=sale-llega;
  let anda=Math.hypot(s1.x-s2.x,s1.z-s2.z)*1.3/B.velocidad/H+B.parada*Math.ceil(Math.hypot(s1.x-s2.x,s1.z-s2.z)/300);
  let extra=0;for(const e of ev)if(e.tipo==='trancon'&&sale<e.hasta&&sale+anda>e.desde){anda+=e.demora;extra+=e.demora;}
  const w2=aPie(dist(s2.id,b)),dur=w1+espera+anda+w2;if(dur-(extra)>=pie.dur*B.aceptar)return pie;// (lejos, el bus aunque tarde un poco más; el trancón no lo hace cambiar: ya está en él)
  return {dur,extra,tramos:[{tipo:'camina',de:a,a:s1.id,dur:w1},{tipo:'espera',parada:s1.id,dur:espera},{tipo:'bus',de:s1.id,a:s2.id,dur:anda},{tipo:'camina',de:s2.id,a:b,dur:w2}]};}
 // los lugares que cubren cada necesidad (por tipo), para buscar los más cercanos
 const porTipo=new Map();for(const l of lugares.values()){if(!R.lugares[l.tipo])continue;(porTipo.get(l.tipo)||porTipo.set(l.tipo,[]).get(l.tipo)).push(l);}
 const cercanos=(tipo,id,n=3)=>{const A=pos(id),L=porTipo.get(tipo)||[];return [...L].sort((x,y)=>Math.hypot(x.x-A.x,x.z-A.z)-Math.hypot(y.x-A.x,y.z-A.z)).slice(0,n);};
 const cerrado=(id,d)=>evDe(d).some(e=>e.tipo==='cierre'&&e.lugar===id);
 const diario=new Map();
 // (las bancas: quién está sentado en cada asiento a qué hora, por día —se planea persona por persona, en orden: nadie se
 // sienta encima de otro—)
 const bancas=new Map(),asientoLibre=(id,d,a,b,n)=>{const L=bancas.get(id+'|'+d)||[];for(let k=0;k<n;k++)if(!L.some(o=>o.k===k&&o.a<b-1e-9&&o.b>a+1e-9))return k;return -1;},ocupar=(id,d,a,b,k)=>{const key=id+'|'+d;(bancas.get(key)||bancas.set(key,[]).get(key)).push({a,b,k});};
 // las necesidades al empezar (por persona y por hogar)
 for(const p of personas){const r=rng(mix(bp.seed,hashS(p.id),501));p.nec={};for(const n of ['hambre','fisico','ocio']){const [a,b]=R.necesidades[n].inicio;p.nec[n]=a+r()*(b-a);}
  p.nec.energia=0;p.socio=r()<R.necesidades.fisico.socios&&p.edad>=16&&p.edad<70;const [a0,a1]=R.sueño.acostarse,[h0,h1]=R.sueño.horas;p.acuesta=a0+r()*(a1-a0);p.duerme=h0+r()*(h1-h0);}
 for(const h of hogares.values()){const r=rng(mix(bp.seed,hashS(h.id),503)),[a,b]=R.necesidades.despensa.inicio;h.despensa=a+r()*(b-a);}
 const sigue=p=>!(p.cuidador&&p.edad<S0.cuidado.solos);
 // (cada noche: el hambre de la mañana es la de siempre de cada uno —el desayuno reinicia— y las necesidades que pasan
 // de un día a otro se redondean a RUTINA.redondeo: una diferencia mínima —un rato perdido ayer— desaparece en vez de
 // cambiar decisiones días después; así la ciudad vuelve a lo normal)
 const q=v=>Math.round(v/R.redondeo)*R.redondeo;
 for(const p of personas){const r=rng(mix(bp.seed,hashS(p.id),507)),[a,b]=R.necesidades.hambre.inicio;p.hambreDespierta=a+r()*(b-a);}// (los chicos van con quien los cuida: sociedad.js los copia)
 for(let d=0;d<7;d++){for(const h of hogares.values())h.despensa=q(h.despensa);for(const p of personas){p.nec.hambre=p.hambreDespierta;p.nec.fisico=q(p.nec.fisico);p.nec.ocio=q(p.nec.ocio);p.nec.energia=0;}// (cada mañana, descansado)
 for(const p of personas){if(!sigue(p))continue;const r=rng(mix(bp.seed,hashS(p.id),d*7+11)),hog=hogares.get(p.hogar),segs=[],D={comidas:0,tarde:[],perdidas:[],pospuestas:{},hechas:[],demora:0,bus:0};
  p.semana[d]=segs;(diario.get(p.id)||diario.set(p.id,[]).get(p.id))[d]=D;
  const finde=d>=5,adulto=p.edad>=18;
  const NE=R.necesidades.energia,crecer=dt=>{if(dt<=0)return;for(const n of ['hambre','fisico','ocio'])p.nec[n]+=R.necesidades[n].sube*dt;if(adulto)hog.despensa+=R.necesidades.despensa.sube*dt/Math.max(1,hog.miembros.length);
   p.nec.energia=Math.max(0,p.nec.energia+(loc===p.hogar?-NE.casa:NE.sube)*dt);D.cansancioMax=Math.max(D.cansancioMax||0,p.nec.energia);};// (el cansancio: baja en casa, sube afuera)
  const nivel=n=>n==='despensa'?(adulto?hog.despensa:0):n==='fisico'?(p.socio?p.nec.fisico:0):p.nec[n];
  const bajar=(n,v)=>{if(n==='despensa')hog.despensa=Math.max(0,hog.despensa-v);else p.nec[n]=Math.max(0,p.nec[n]-v);};
  const emitir=(t,tramos,que,v)=>{if(v){D.demora+=v.extra||0;if(tramos.some(s=>s.tipo==='bus'))D.bus++;}for(const s of tramos){if(s.dur<=1e-6)continue;
   if(s.tipo==='camina'){segs.push({d:t,h:t+s.dur,donde:'calle',de:s.de,a:s.a,que});p.nec.energia+=NE.camina*s.dur;D.cansancioMax=Math.max(D.cansancioMax||0,p.nec.energia);}else if(s.tipo==='espera')segs.push({d:t,h:t+s.dur,donde:s.parada,que:'espera el bus'});else segs.push({d:t,h:t+s.dur,donde:'bus',de:s.de,a:s.a,que:'va en bus'});t+=s.dur;}return t;};
  const obl=[...est[idx.get(p.id)][d]].sort((a,b)=>a.a-b.a);
  let t=0,loc=p.hogar;
  // (la noche: si el día arranca en un turno que viene de ayer, empieza ahí; si no, en casa, durmiendo)
  if(obl[0]&&obl[0].a<=1e-9){const e=obl.shift();segs.push({d:0,h:e.b,donde:e.donde,que:e.que});t=e.b;loc=e.donde;D.hechas.push(e.que);}
  // (se levanta: a su hora o antes, si lo obligatorio lo pide; después de un turno de noche, duerme de día)
  const prim=obl[0];let desp=Math.max(0,p.acuesta+p.duerme-24)+(finde?R.sueño.findeMas:0);
  if(t>0){const vv=viaje(loc,p.hogar,t,d);t=emitir(t,vv.tramos,'vuelve a casa',vv);loc=p.hogar;desp=Math.max(desp,t+p.duerme*.9);}
  if(prim){const llegar=prim.a-viaje(p.hogar,prim.donde,prim.a,d,false).dur-R.sueño.preparar-R.margen;desp=Math.min(desp,Math.max(t,llegar));}
  t=Math.max(t,Math.min(desp,20));
  // los ratos libres: hay que llegar a «siguiente» (un id) a la hora «llegar» (h)
  function libre(llegar,siguiente){let guard=0;
   while(t+viaje(loc,siguiente,t,d,false).dur<llegar-.05&&guard++<40){
    let best=null;
    for(const n of NEC){const N=R.necesidades[n],lv=nivel(n);if(lv<N.umbral)continue;
     const tipos=Object.entries(R.lugares).filter(([k,L])=>L.cubre===n&&k!=='comerCasa'&&k!=='descansaCasa').map(([k])=>k);
     const ops=[];if(n==='hambre')ops.push({casa:true,L:R.lugares.comerCasa,id:p.hogar});if(n==='energia')ops.push({casa:true,L:R.lugares.descansaCasa,id:p.hogar});for(const tp of tipos)for(const l of cercanos(tp,loc))ops.push({L:R.lugares[tp],id:l.id,tipo:tp});
     for(const o of ops){if(!o.casa&&cerrado(o.id,d))continue;const v1=viaje(loc,o.id,t,d),ini=t+v1.dur;let fin=Math.min(ini+o.L.horas,llegar);
      if(!o.casa){const hr=horarioDia(o.tipo,d);if(!hr||ini<hr[0]||ini>=hr[1])continue;fin=Math.min(fin,hr[1]);}
      const v2=viaje(o.id,siguiente,fin,d,false);fin=Math.min(fin,llegar-v2.dur);if(fin-ini<o.L.minimo-1e-9)continue;
      if(o.L.asientos&&asientoLibre(o.id,d,ini,fin,o.L.asientos)<0)continue;// (la banca o la esquina llena: otra)
      let u=lv*N.peso*(finde?R.finde?.[n]??1:1)-(v1.dur+v2.dur)*1.5+ruido(p.id,d,o.id,t)*.15;if(n==='hambre')u*=o.casa?1-R.afuera*(finde?2:1):R.afuera*(finde?2:1)*2;if(o.L.ocio)u+=o.L.ocio*nivel('ocio');
      if(!best||u>best.u)best={u,o,n,v1,ini,fin};}}
    if(best){const {o,n,v1,ini,fin}=best;if(!o.casa||loc!==p.hogar)t=emitir(t,v1.tramos,'camina',v1);t=Math.max(t,ini);
     if(!o.casa){const sg={d:ini,h:fin,donde:o.id,que:o.L.que};if(o.L.asientos){sg.asiento=asientoLibre(o.id,d,ini,fin,o.L.asientos);ocupar(o.id,d,ini,fin,sg.asiento);}segs.push(sg);}loc=o.casa?p.hogar:o.id;crecer(fin-t);t=fin;
     bajar(n,o.L.baja*Math.min(1,(fin-ini)/o.L.horas+.2));if(o.L.hambre)bajar('hambre',o.L.hambre);if(o.L.ocio)bajar('ocio',o.L.ocio);if(o.L.despensa&&adulto)bajar('despensa',o.L.despensa);
     if(n==='hambre')D.comidas++;D.hechas.push(o.L.que);continue;}
    // (nada que hacer —o nada que quepa—): a casa si da el tiempo; si no, se queda donde está hasta salir
    if(loc!==p.hogar){const vc=viaje(loc,p.hogar,t,d),vb=viaje(p.hogar,siguiente,t+vc.dur,d,false);
     if(siguiente===p.hogar||t+vc.dur+vb.dur+.25<llegar){t=emitir(t,vc.tramos,'vuelve a casa',vc);loc=p.hogar;continue;}break;}
    const dt=Math.min(R.espera,llegar-viaje(p.hogar,siguiente,t,d,false).dur-t);if(dt<=.01)break;crecer(dt);t+=dt;}}
  // la agenda del día: cada cosa obligatoria, con el rato libre antes
  for(const e of obl){libre(e.a-R.margen,e.donde);const est0=viaje(loc,e.donde,t,d,false).dur;
   const sale=Math.max(t,e.a-est0-R.margen),v=viaje(loc,e.donde,sale,d);crecer(sale-t);t=emitir(sale,v.tramos,'va a '+(e.que.split(' ')[0]),v);
   if(t>=e.b-.25){D.perdidas.push(e.que);continue;}// (llegó cuando ya no tenía sentido: se lo perdió)
   if(t>e.a+.05)D.tarde.push({que:e.que,min:Math.round((t-e.a)*60)});
   const a=Math.max(t,e.a);
   // (un turno largo: almuerza; en la oficina —R.almuerzoAfuera.lugares—, algunos días sale a un lugar cerca, a una hora
   // corrida por persona para que la oficina no quede vacía; si no, almuerza ahí)
   const lugarE=lugares.get(e.donde),AF=R.almuerzoAfuera;let salio=false;
   // (el primero de cada puesto —trabajo.k 0— no sale: el lugar nunca queda sin nadie)
   if(e.b-a>=R.almuerzo&&adulto&&e.que==='trabaja'&&AF&&AF.lugares.includes(lugarE?.tipo)&&p.trabajo?.k>0&&ruido(p.id,d,'almuerzo',0)<AF.parte){
    const mid=(a+e.b)/2+(ruido(p.id,d,'hora',0)-.5),cand=AF.tipos.flatMap(tp=>cercanos(tp,e.donde,2)).filter(l=>!cerrado(l.id,d)&&dist(e.donde,l.id)<=AF.hasta).filter(l=>{const hr=horarioDia(l.tipo,d);return hr&&mid>=hr[0]&&mid+AF.horas<=hr[1];});
    const l=cand.sort((x,y)=>dist(e.donde,x.id)-dist(e.donde,y.id))[Math.floor(ruido(p.id,d,'cual',0)*Math.min(2,cand.length))];
    if(l){const v1=viaje(e.donde,l.id,mid,d),v2=viaje(l.id,e.donde,mid+v1.dur+AF.horas,d),vuelve=mid+v1.dur+AF.horas+v2.dur;
     if(vuelve<e.b-.5){segs.push({d:a,h:mid,donde:e.donde,que:e.que});let tt=emitir(mid,v1.tramos,'sale a almorzar',v1);segs.push({d:tt,h:tt+AF.horas,donde:l.id,que:R.lugares[l.tipo]?.que||'almuerza'});tt=emitir(tt+AF.horas,v2.tramos,'vuelve al trabajo',v2);
      segs.push({d:tt,h:e.b,donde:e.donde,que:e.que});salio=true;}}}
   if(!salio)segs.push({d:a,h:e.b,donde:e.donde,que:e.que});crecer(e.b-t);t=e.b;loc=e.donde;D.hechas.push(e.que);
   if(e.b-a>=R.almuerzo){p.nec.hambre=Math.max(0,p.nec.hambre-1);D.comidas++;}}
  // la noche: si el último turno sigue mañana, se queda; si no, el rato libre hasta acostarse y a casa
  const ultimo=obl[obl.length-1];if(!(ultimo&&ultimo.b>=24-1e-9)){libre(Math.max(t,p.acuesta),p.hogar);
   if(loc!==p.hogar&&t<24){const v=viaje(loc,p.hogar,t,d);t=emitir(t,v.tramos,'vuelve a casa',v);loc=p.hogar;}}
  // (con hambre a la hora de dormir —llegó tarde—: come en casa igual, aunque se acueste un poco más tarde; hasta la
  // medianoche —2026-10-18: con el trancón algunos llegaban después de las 23:30 y se quedaban sin comer—)
  if(loc===p.hogar&&p.nec.hambre>=R.necesidades.hambre.umbral&&t<24){const fin=Math.max(t,Math.min(24,t+R.lugares.comerCasa.minimo));crecer(fin-t);t=fin;bajar('hambre',R.lugares.comerCasa.baja);D.comidas++;D.hechas.push('come en casa');}
  // lo que quedó pendiente (sobre su umbral al terminar el día), para medir qué se cae primero
  for(const n of NEC)if(nivel(n)>=R.necesidades[n].umbral)D.pospuestas[n]=+(nivel(n)).toFixed(2);
  // (no pasar de las 24: lo que se pasa se recorta)
  for(let i=segs.length-1;i>=0;i--){if(segs[i].d>=24)segs.splice(i,1);else if(segs[i].h>24)segs[i].h=24;}}}
 return {diario,paradas};}
