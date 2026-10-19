/* La gente de la sociedad en la calle (2026-10-17, etapa 2). Puro: el 3D (sociedad3d.js) pregunta quién está afuera
   cerca del jugador y dónde; el 2D lo mide (validar-sociedad).
   · El reloj de la ciudad corre a RELOJ.escala (un minuto real, una hora), pero la gente camina a paso de persona
     (PASO_VISTO m/s): un rato «en la calle» de la semana (sociedad.js) empieza a su hora y desde ahí se lo ve caminar de
     la puerta de donde sale a la de donde va, por las calles (el campo de distancias de la grilla de rutas, mapa.js),
     hasta llegar, a su paso (CAMINAR). Así la calle se llena cuando la ciudad sale (a las 7, a las 15, a las 18) y de
     noche queda vacía. Nadie se encima: separar corre a los que quedan muy juntos, y al jugador lo esquivan.
   · Los caminos se calculan de a poco (un campo de distancias por destino, ~50 ms): cerca(…, presupuesto) no calcula más
     de lo que entra en el presupuesto (ms); el que todavía no tiene camino no se ve. calentar(ms, x, z) adelanta los de
     cerca en los ratos libres.
   · Los que están en un parque (su rato dice un parque) se ven ahí, quietos o paseando cerca del centro.
   · Los chicos que van con quien los cuida caminan a su lado, un poco atrás.
   crearTranseuntes(S, mapa) → {cerca(inicio, s, x, z, radio, max, presupuesto, obstáculos), ruta(de, a), separar}: cerca da
   [{id, persona, x, z, rumbo, v, camina, que}] a s reales de la ronda que empezó en inicio (s del juego). */
import {RELOJ} from '../medidas.js';
import {entradasLote,entradasCasa} from '../guaridas.js';

export const PASO_VISTO=1.4;// m/s: el paso medio (para quien lo necesite de referencia)
// el caminar (2026-10-17, Miguel: «corren de forma rara, no se chocan entre ellos»; antes, para que nadie tardara más de
// 90 s, los caminos largos se recorrían hasta a 8 m/s y todos los que salían de un lugar a la vez iban apilados):
//  · el paso de cada uno (m/s), por su edad y su id: niños, adultos, mayores; el chico va al paso de quien lo cuida;
//  · tramo: en un camino de más de 2 tramos se ve el primero y el último a pie y el medio va en bus (bus s, no se ve);
//  · demora: cada uno sale hasta esos s después de su hora (no salen todos a la vez); del colegio, hasta demoraColegio
//    (cientos de chicos no cruzan una puerta en un instante);
//  · carril: hasta esos m a un costado del camino (la vereda tiene 3 m); alLado y atras: el chico junto a quien lo cuida;
//  · separa: nadie a menos de esos m de otro (en pasadas de separar, sin salir de lo caminable).
export const CAMINAR={nino:[1.0,1.25],adulto:[1.2,1.65],mayor:[.95,1.2],tramo:140,bus:25,demora:18,demoraColegio:60,carril:.9,alLado:.75,atras:.35,separa:.65,pasadas:6,costado:1.1,
 // (2026-10-18, el caminar natural —validar-caminar, Miguel: «saltos bruscos»—: el camino de la grilla de 2 m va en 8
 // direcciones y doblaba 45° de golpe cada 2 m, y el carril y los desvíos cambiaban la velocidad de un cuadro a otro.
 // redondeo: pasadas de Chaikin a las esquinas del camino; cada uno sigue su punto con un resorte de suave rad/s
 // (críticamente amortiguado, con la velocidad del punto: no se queda atrás) y aceleración de a lo sumo acel m/s²;
 // mira hacia donde camina y la animación va a lo que avanza)
 redondeo:2,suave:5,acel:2,empuje:16,acelEmpuje:2.5,acelTope:2.8};// (acel: la del resorte; acelEmpuje: la del empuje de los vecinos, que se suma; acelTope: el total)// (costado: m/s a los que se corre de lado para esquivar, no de golpe)
const PARQUE_R=9;// m: cuánto se alejan del centro del parque

export function crearTranseuntes(S,mapa){const bp=S.bp,H=3600;
 // los ratos en la calle de la semana, por hora de inicio (s del juego desde el lunes)
 const ratos=[];for(const p of S.personas)for(let d=0;d<7;d++)for(const s of p.semana[d])if(s.donde==='calle')ratos.push({p,g0:(d*24+s.d)*H,de:s.de,a:s.a});
 ratos.sort((a,b)=>a.g0-b.g0);
 // los puntos de afuera de un lugar o un hogar
 const pts=new Map();const puntos=id=>{if(pts.has(id))return pts.get(id);let P=null;const l=S.lugares.get(id),h=S.hogares.get(id);
  if(l)P=l.lote!=null?entradasLote(bp.lots[l.lote]):[[l.x,l.z]];else if(h){const v=h.vivienda;P=v.lote!=null?entradasLote(bp.lots[v.lote]):entradasCasa(bp.isla.casas[v.casa]);}
  pts.set(id,P?.length?P:[[h?.x??l?.x??0,h?.z??l?.z??0]]);return pts.get(id);};
 const campos=new Map(),campo=id=>campos.get(id)||campos.set(id,mapa.campo(puntos(id),mapa.veredas?.())).get(id);// (por las veredas: mapa.js CALZADA)
 // la ruta de un lugar a otro: la polilínea por la grilla y su largo acumulado (guardada por pareja)
 const rutas=new Map();function ruta(de,a,hasta=Infinity){const k=de+'>'+a;if(rutas.has(k))return rutas.get(k);if(!campos.has(a)&&performance.now()>hasta)return null;const C=campo(a);
  let best=null,bd=Infinity;for(const [x,z] of puntos(de)){const d=mapa.distEn(C,x,z);if(d<bd){bd=d;best=[x,z];}}
  const pl=[];if(best&&isFinite(bd)){let x=best[0],z=best[1];pl.push([x,z]);for(let i=0;i<4000;i++){const n=mapa.siguiente(C,x,z);if(!n)break;x=n.x;z=n.z;pl.push([x,z]);}
   const fin=puntos(a).reduce((m,q)=>Math.hypot(q[0]-x,q[1]-z)<Math.hypot(m[0]-x,m[1]-z)?q:m,puntos(a)[0]);pl.push(fin);}
  // (las esquinas, redondeadas: cada pasada cambia cada esquina por dos puntos a un cuarto de sus tramos, si caen en lo
  // caminable)
  for(let it=0;it<CAMINAR.redondeo&&pl.length>2;it++){const nv=[pl[0]];for(let i=0;i<pl.length-1;i++){const a=pl[i],b=pl[i+1],P=[.75*a[0]+.25*b[0],.75*a[1]+.25*b[1]],Q=[.25*a[0]+.75*b[0],.25*a[1]+.75*b[1]];
    if(i>0)nv.push(libreEn(P[0],P[1])?P:a);if(i<pl.length-2)nv.push(libreEn(Q[0],Q[1])?Q:b);}nv.push(pl[pl.length-1]);pl.length=0;pl.push(...nv);}
  const L=[0];for(let i=1;i<pl.length;i++)L.push(L[i-1]+Math.hypot(pl[i][0]-pl[i-1][0],pl[i][1]-pl[i-1][1]));
  const r={pl,L,largo:L[L.length-1]||0};rutas.set(k,r);return r;}
 const en=(r,m)=>{if(!r.pl.length)return null;if(m>=r.largo){const q=r.pl[r.pl.length-1];return {x:q[0],z:q[1],rumbo:0};}let i=1;while(i<r.L.length-1&&r.L[i]<m)i++;
  const a=r.pl[i-1],b=r.pl[i],t=(m-r.L[i-1])/Math.max(1e-6,r.L[i]-r.L[i-1]);return {x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,rumbo:Math.atan2(b[0]-a[0],b[1]-a[1])};};
 const pos=id=>S.lugares.get(id)||S.hogares.get(id);
 const semana=7*RELOJ.dia;
 // (2026-10-17, el caminar natural) el paso de cada uno, su demora en salir y su carril, por su id: siempre los mismos
 const hashS=s=>{let k=2166136261;for(const c of s)k=Math.imul(k^c.charCodeAt(0),16777619);return k>>>0;};
 const pasoDe=p=>{const u=(hashS(p.id)%1000)/1000;return p.edad<12?CAMINAR.nino[0]+u*(CAMINAR.nino[1]-CAMINAR.nino[0]):p.edad>=65?CAMINAR.mayor[0]+u*(CAMINAR.mayor[1]-CAMINAR.mayor[0]):CAMINAR.adulto[0]+u*(CAMINAR.adulto[1]-CAMINAR.adulto[0]);};
 const guia=p=>p.cuidador&&p.edad<12?S.porId.get(p.cuidador)||p:p;// (el chico va al paso de quien lo cuida)
 const libreEn=(x,z)=>{const k=mapa.idx(x,z);return k>=0&&!!mapa.libre[k];};
 const MAX_REAL=2*CAMINAR.tramo/CAMINAR.mayor[0]+CAMINAR.bus+Math.max(CAMINAR.demora,CAMINAR.demoraColegio)+5;
 function cerca(inicio,s,x,z,radio=120,max=60,presupuesto=Infinity,obst=[]){const g=inicio+s*RELOJ.escala,out=[],hasta=performance.now()+presupuesto,dtC=Math.max(0,Math.min(.5,s-(ultimoS??s)));
  // los que salieron hace a lo sumo MAX_REAL s reales (la semana se repite: también los de la semana anterior)
  const desde=g-MAX_REAL*RELOJ.escala;
  for(const off of [0,-semana,semana]){let lo=0,hi=ratos.length;const g0=desde-off;while(lo<hi){const m=(lo+hi)>>1;if(ratos[m].g0<g0)lo=m+1;else hi=m;}
   for(let i=lo;i<ratos.length&&ratos[i].g0+off<=g;i++){const R=ratos[i],A=pos(R.de),B=pos(R.a);if(!A||!B)continue;
    const gu=guia(R.p),hg=hashS(gu.id+'@'+R.g0),v=pasoDe(gu),dem=S.lugares.get(R.de)?.tipo==='colegio'?CAMINAR.demoraColegio:CAMINAR.demora,e=(g-(R.g0+off))/RELOJ.escala-(hg%1000)/1000*dem;if(e<0)continue;
    // (descarte barato: la recta queda lejos)
    const dr=Math.hypot(A.x-B.x,A.z-B.z);if(Math.min(Math.hypot(A.x-x,A.z-z),Math.hypot(B.x-x,B.z-z))>radio+dr*.7+40)continue;
    const r=ruta(R.de,R.a,hasta);if(!r)continue;const Lr=r.largo,T=CAMINAR.tramo;let mm;
    // (corto: entero a su paso; largo: el primer tramo a pie, el medio en bus —no se ve— y el último a pie)
    if(Lr<=2*T){mm=e*v;if(mm>=Lr)continue;}else{const t1=T/v,t2=t1+CAMINAR.bus,t3=t2+T/v;if(e<t1)mm=e*v;else if(e<t2)continue;else if(e<t3)mm=Lr-T+(e-t2)*v;else continue;}
    const q=en(r,mm);if(!q||Math.hypot(q.x-x,q.z-z)>radio)continue;
    // el carril: a un costado del camino (por la vereda), siempre el mismo en el viaje; el chico, al lado de quien lo cuida
    // y un poco atrás
    // (el costado, con el rumbo promediado en ±2 m del camino: en una esquina gira de a poco, no de golpe)
    const qa=en(r,Math.max(0,mm-2)),qb=en(r,Math.min(Lr,mm+2)),hr=qa&&qb&&Math.hypot(qb.x-qa.x,qb.z-qa.z)>.1?Math.atan2(qb.x-qa.x,qb.z-qa.z):q.rumbo;
    const rx=Math.cos(hr),rz=-Math.sin(hr),fx=Math.sin(hr),fz=Math.cos(hr);
    let lat=((hg>>>10)%1000/1000-.5)*2*CAMINAR.carril,atras=0;if(gu!==R.p){lat+=CAMINAR.alLado*(hashS(R.p.id)%2?1:-1);atras=CAMINAR.atras;}
    // (cuánto del carril: si se sale de lo caminable, menos; cambia de a poco —carriles—, no de golpe)
    const id=R.p.id+'@'+(R.g0+off),cercaPuerta=mm<3||Lr-mm<3;let kq=0;if(!cercaPuerta)for(const k of [1,.5,0]){if(libreEn(q.x+rx*lat*k-fx*atras*k,q.z+rz*lat*k-fz*atras*k)){kq=k;break;}}
    const k0=carriles.get(id)??kq,kk=k0+Math.max(-.8*dtC,Math.min(.8*dtC,kq-k0));carriles.set(id,kk);vistosC.add(id);
    out.push({id,persona:R.p,x:q.x+rx*lat*kk-fx*atras*kk,z:q.z+rz*lat*kk-fz*atras*kk,rumbo:q.rumbo,v,camina:true,puerta:mm<1.5||Lr-mm<1.5,que:R.p.cuidador?'camina con '+S.porId.get(R.p.cuidador).nombre.split(' ')[0]:'camina'});}}
  // los quietos, a esa hora de la semana: los del parque; el vendedor en su esquina (a medio metro); y —2026-10-18, el
  // cansancio de rutina.js— los que descansan sentados en una banca (en su asiento, mirando al frente de la banca), los
  // que se quedan parados en la esquina (en corrillo, mirando al centro) y los que esperan el bus en la parada
  const gs=((g%semana)+semana)%semana,dia=Math.floor(gs/RELOJ.dia),h=(gs%RELOJ.dia)/H;
  for(const l of S.lugares.values()){if(!QUIETOS.has(l.tipo)||Math.hypot(l.x-x,l.z-z)>radio+PARQUE_R)continue;
   for(const {p,r} of quietosDe(dia).get(l.id)||[]){if(!(h>=r.d&&h<r.h))continue;const k=hashS(p.id);
    if(l.tipo==='banca'&&r.acompana){const c=Math.cos(l.ry),sn=Math.sin(l.ry),f=.75+(k%3)*.15,lx=((k>>>3)%3-1)*.5;// (el chico que acompaña: de pie, delante de la banca)
     out.push({id:p.id+'@Q',persona:p,x:l.x+Math.sin(l.ry)*f+c*lx,z:l.z+Math.cos(l.ry)*f-sn*lx,rumbo:l.ry+Math.PI,v:0,camina:false,que:r.que});continue;}
    if(l.tipo==='banca'){const sx=((r.asiento||0)-.5)*(l.largo||1.7)*.48,c=Math.cos(l.ry),sn=Math.sin(l.ry);
     out.push({id:p.id+'@Q',persona:p,x:l.x+c*sx,z:l.z-sn*sx,rumbo:l.ry,v:0,camina:false,sentado:true,que:r.que});continue;}
    if(l.tipo==='parada'||(l.tipo==='esquina'&&/^se queda parado/.test(r.que))){const a=((r.asiento??k%6)/6)*Math.PI*2+(k%7)*.05,d=l.tipo==='parada'?.9+(k>>>4)%5*.15:.7;
     out.push({id:p.id+'@Q',persona:p,x:l.x+Math.cos(a)*d,z:l.z+Math.sin(a)*d,rumbo:l.tipo==='esquina'?Math.atan2(-Math.cos(a),-Math.sin(a)):(k%8)*Math.PI/4,v:0,camina:false,que:r.que});continue;}
    const R0=l.tipo==='esquina'?.6:PARQUE_R,a=(k%360)*Math.PI/180,d=R0<2?R0*((k>>>8)%100)/100:2+((k>>>8)%100)/100*(R0-2),w=Math.sin(s*.15+a)*.8;
    out.push({id:p.id+'@P',persona:p,x:l.x+Math.cos(a+w*.1)*d,z:l.z+Math.sin(a+w*.1)*d,rumbo:a+Math.PI/2,v:0,camina:false,que:r.que});}}
  out.sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z));const lista=out.slice(0,max);
  // esquivar de a poco: separar da adónde debería estar cada uno; su desvío (lo que se corre de su carril) va hacia ahí a
  // CAMINAR.costado m/s, como quien se hace a un lado caminando, y se guarda entre una llamada y otra
  for(const id of carriles.keys())if(!vistosC.has(id))carriles.delete(id);vistosC.clear();
  const dt=dtC;ultimoS=s;const base=lista.map(o=>{const d=desvios.get(o.id)||{x:0,z:0};return {x:o.x,z:o.z,dx:d.x,dz:d.z};});
  for(const [i,o] of lista.entries()){o.x+=base[i].dx;o.z+=base[i].dz;}separar(lista,obst);const vivos=new Set();
  for(const [i,o] of lista.entries()){const b=base[i],qx=o.x-b.x,qz=o.z-b.z,ex=qx-b.dx,ez=qz-b.dz,e=Math.hypot(ex,ez),pmax=CAMINAR.costado*dt,k=e>pmax&&dt>0?pmax/e:1;
   let nx=b.dx+ex*k,nz=b.dz+ez*k;
   // (si el desvío lo saca de lo caminable, no se aplica: vuelve hacia su carril de a poco —antes volvía a cero de golpe—;
   // en el vano de una puerta no se mira: ahí siempre hay pared cerca)
   if(!o.puerta&&!libreEn(b.x+nx,b.z+nz)){const f=Math.max(0,1-pmax/Math.max(1e-6,Math.hypot(b.dx,b.dz)));nx=b.dx*f;nz=b.dz*f;}
   o.x=b.x+nx;o.z=b.z+nz;desvios.set(o.id,{x:nx,z:nz});vivos.add(o.id);}
  for(const id of desvios.keys())if(!vivos.has(id))desvios.delete(id);
  // el seguidor: cada uno va hacia su punto (o.x, o.z) con un resorte con la velocidad del punto, sin pasar de acel m/s²
  // ni de 1,15 veces su paso; si el punto salta lejos —sale de una puerta, baja del bus— o pasó mucho entre dos llamadas,
  // aparece ahí. Mira hacia donde camina (vAnim: lo que avanza, para la animación)
  const w=CAMINAR.suave,amax=CAMINAR.acel,SEP=CAMINAR.separa,KR=CAMINAR.empuje;
  // (los vecinos demasiado cerca se empujan —una fuerza dentro del resorte, con la misma aceleración tope—: sin esto, el
  // resorte dejaba encimarse a los de una vereda llena; un empujón de posición, en cambio, era un salto)
  const prev=[...seguir.values()];
  for(const o of lista){if(!o.camina){seguir.delete(o.id);continue;}let f=seguir.get(o.id);const tx=o.x,tz=o.z;
   // (la velocidad del punto, filtrada: en una vereda llena, separar lo sacude de un cuadro a otro y el resorte se quedaba
   // atrás; el que queda atrás apura el paso —hasta 1,5 veces el suyo— en vez de aparecer más adelante, salvo un salto de
   // verdad: más de 6 m, al bajar del bus)
   if(!f||!(dt>0)||dt>.25||Math.hypot(tx-f.x,tz-f.z)>6){f={x:tx,z:tz,vx:Math.sin(o.rumbo)*o.v,vz:Math.cos(o.rumbo)*o.v,tx,tz,tvx:Math.sin(o.rumbo)*o.v,tvz:Math.cos(o.rumbo)*o.v,r:o.rumbo};}
   else{const kf=1-Math.exp(-dt*6);f.tvx+=((tx-f.tx)/dt-f.tvx)*kf;f.tvz+=((tz-f.tz)/dt-f.tvz)*kf;let ax=w*w*(tx-f.x)+2*w*(f.tvx-f.vx),az=w*w*(tz-f.z)+2*w*(f.tvz-f.vz);const am=Math.hypot(ax,az);if(am>amax){ax*=amax/am;az*=amax/am;}
    let rx=0,rz=0;for(const g of prev){if(g===f)continue;const dx=f.x-g.x,dz=f.z-g.z,d=Math.hypot(dx,dz);if(d>=SEP||d<1e-4)continue;const k=KR*(SEP-d)/SEP/d;rx+=dx*k;rz+=dz*k;}
    const rm=Math.hypot(rx,rz);if(rm>CAMINAR.acelEmpuje){rx*=CAMINAR.acelEmpuje/rm;rz*=CAMINAR.acelEmpuje/rm;}ax+=rx;az+=rz;const at=Math.hypot(ax,az),atop=CAMINAR.acelTope;if(at>atop){ax*=atop/at;az*=atop/at;}
    const atras=Math.hypot(tx-f.x,tz-f.z);f.vx+=ax*dt;f.vz+=az*dt;const sp=Math.hypot(f.vx,f.vz),vm=o.v*(1.15+.35*Math.min(1,Math.max(0,atras-1)/2));if(sp>vm){f.vx*=vm/sp;f.vz*=vm/sp;}f.x+=f.vx*dt;f.z+=f.vz*dt;f.tx=tx;f.tz=tz;
    if(Math.hypot(f.vx,f.vz)>.25)f.r=Math.atan2(f.vx,f.vz);}
   seguir.set(o.id,f);o.x=f.x;o.z=f.z;o.rumbo=f.r;o.vAnim=Math.hypot(f.vx,f.vz);}
  for(const id of seguir.keys())if(!lista.some(o=>o.id===id))seguir.delete(id);
  return lista;}
 const desvios=new Map(),carriles=new Map(),vistosC=new Set(),seguir=new Map();let ultimoS=null;
 // (quién está quieto en cada lugar de los que se ven desde la calle, por día de la semana: se arma una vez por día)
 const QUIETOS=new Set(['parque','esquina','banca','parada']),qPorDia=new Map();
 const quietosDe=d=>{if(qPorDia.has(d))return qPorDia.get(d);const m=new Map();for(const p of S.personas)for(const r of p.semana[d]||[]){const l=S.lugares.get(r.donde);if(!l||!QUIETOS.has(l.tipo))continue;(m.get(l.id)||m.set(l.id,[]).get(l.id)).push({p,r});}qPorDia.set(d,m);return m;};
 // que nadie se encime: los que quedan a menos de CAMINAR.separa m se corren, cada uno la mitad, por la recta que los une
 // (si están en el mismo punto, de costado, a la derecha de cada uno), sin salir de lo caminable; y se apartan de los
 // obstáculos (el jugador). Unas pocas pasadas: alcanza para una vereda llena.
 function separar(L,obst=[]){const SEP=CAMINAR.separa;
  for(let it=0;it<CAMINAR.pasadas;it++){let movio=false;
   for(let i=0;i<L.length;i++)for(let j=i+1;j<L.length;j++){const a=L[i],b=L[j];
    let dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz);if(d>=SEP)continue;
    if(d<1e-3){dx=Math.cos(a.rumbo);dz=-Math.sin(a.rumbo);d=1;if(hashS(a.id)%2){dx=-dx;dz=-dz;}}else{dx/=d;dz/=d;}const em=(SEP-Math.min(d,SEP))/2;
    // (en el vano de una puerta no se mira la pared: ahí se abren en abanico al salir o entrar)
    if(a.puerta||libreEn(a.x-dx*em,a.z-dz*em)){a.x-=dx*em;a.z-=dz*em;}if(b.puerta||libreEn(b.x+dx*em,b.z+dz*em)){b.x+=dx*em;b.z+=dz*em;}movio=true;}
   for(const o of obst)for(const a of L){let dx=a.x-o.x,dz=a.z-o.z,d=Math.hypot(dx,dz);const R=(o.r||.3)+.35;if(d>=R)continue;if(d<1e-3){dx=1;dz=0;d=1;}else{dx/=d;dz/=d;}
    const em=R-Math.min(d,R);if(libreEn(a.x+dx*em,a.z+dz*em)){a.x+=dx*em;a.z+=dz*em;}movio=true;}
   if(!movio)break;}
  return L;}
 // adelantar caminos: los campos de los destinos más cerca de (x, z) que falten, hasta gastar ms
 const destinos=[...new Set(ratos.flatMap(R=>[R.a]))];
 function calentar(ms,x=0,z=0){const hasta=performance.now()+ms;let n=0;const fal=destinos.filter(d=>!campos.has(d)).sort((a,b)=>{const A=pos(a),B=pos(b);return Math.hypot(A.x-x,A.z-z)-Math.hypot(B.x-x,B.z-z);});
  for(const d of fal){if(performance.now()>hasta)break;campo(d);n++;}return {hechos:n,faltan:fal.length-n};}
 return {cerca,ruta,ratos,puntos,calentar,separar};}
