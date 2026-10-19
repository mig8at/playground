// Valida la ciudad con matemática, sin abrir el 3D (2026-10-15): paredes, puertas, ventanas, cuartos y huecos de
// cada edificio, piso por piso, con las medidas del catálogo (src/engine/medidas.js) y los volúmenes del plano
// (src/engine/volumenes.js).
// Uso: node scripts/validar-ciudad.mjs [ciudades=10] [semilla0=1] [--todo]   (--todo: lista todos los ejemplos)
import {generateBlueprint,USE_AT,ITEMS,anchoCalle,enCentro,maxPisos} from '../src/engine/blueprint.js';
import {MURO,PUERTA,MINIMO,PASILLO,CUERPO,ERGO,mm,VIDRIO,HABITABLE,JUEGO,ENCIERRO,ALTURA,INTERIOR,esVidriera} from '../src/engine/medidas.js';
import {volumesOf,spanOf} from '../src/engine/volumenes.js';

const args=process.argv.slice(2).filter(a=>!a.startsWith('--')),TODO=process.argv.includes('--todo');
const N=+(args[0]||10),S0=+(args[1]||1),E=1e-6;
const inRect=(r,x,y)=>x>r.x+E&&x<r.x+r.w-E&&y>r.y+E&&y<r.y+r.h-E;
const overlap=(a,b,m=0)=>a.x+m<b.x+b.w&&b.x+m<a.x+a.w&&a.y+m<b.y+b.h&&b.y+m<a.y+a.h;
const fallas=new Map(),lotesMalos=new Set();let edificios=0,pisos=0,puertas=0,paredes=0;
const falla=(k,info)=>{const f=fallas.get(k)||fallas.set(k,{n:0,lotes:new Set(),ej:[]}).get(k);f.n++;f.lotes.add(info.ciudad+':'+info.lote);lotesMalos.add(info.ciudad+':'+info.lote);if(TODO||f.ej.length<3)f.ej.push(info);};
// Los cuartos donde se vive o se trabaja: necesitan luz natural (los baños y cocinas pueden ventilar con extracción).
const avisos={};
const BANO=/bano|aseo/,SIN_MINIMO=/deposito|closet|bodega|despensa|lavanderia|escalera|vestier|cuarto_util|archivo/;

// ---- El recorrido del edificio entero (2026-10-15) ----
// Un grafo: la calle, cada cuarto, cada tramo de pasillo, la escalera y el ascensor, piso por piso. Las puertas unen lo
// que tienen a cada lado (a 30 cm); los cuartos sin tabique hacia el pasillo se abren a él; los pasillos que se tocan se
// unen; la escalera une cada piso con el siguiente y el ascensor todos. Desde la calle se tiene que llegar a todo, y el
// punto más lejano de cada cuarto no puede quedar a más de MINIMO.evacuacion de la escalera (en planta baja, de la calle)
// caminando de puerta en puerta.
const ABIERTOS=new Set(['abierta','recepcion','lectura','prestamo','comedor']);
function recorrido(L,seed){const tag0={ciudad:seed,lote:L.id,tipo:L.type};const node=new Map(),adj=new Map(),key=(f,s)=>f+':'+s;
 const link=(a,b,w=0,pa=null,pb=null)=>{if(a===b)return;for(const [x,y] of [[a,b],[b,a]])(adj.get(x)||adj.set(x,[]).get(x)).push([y,w]);};
 const doorPts=[];// [nivel, x, y, espacioA, espacioB, esEscalera, esCalle]
 for(const lv of L.levels){const f=lv.level,inR2=(r,x,y)=>x>r.x+1e-6&&x<r.x+r.w-1e-6&&y>r.y+1e-6&&y<r.y+r.h-1e-6;
  const sp=(x,y)=>{const q=lv.rooms.find(q=>inR2(q,x,y));if(q)return 'r'+q.id;if(lv.core&&inR2(lv.core,x,y))return lv.liftRect&&inR2(lv.liftRect,x,y)?'nucleo':'escalera';const c=lv.corridor.findIndex(c=>inR2(c,x,y));if(c>=0)return 'c'+c;return L.parts.some(p=>inR2(p,x,y))?null:'calle';};
  for(const d of lv.doors){const {h,at,a,b}=spanOf(d),m=(a+b)/2,[x1,y1]=h?[m,at-.3]:[at-.3,m],[x2,y2]=h?[m,at+.3]:[at+.3,m],s1=sp(x1,y1),s2=sp(x2,y2);if(!s1||!s2)continue;
   const k1=s1==='calle'?'calle':key(f,s1),k2=s2==='calle'?'calle':key(f,s2);link(k1,k2);const [mx,my]=h?[m,at]:[at,m];doorPts.push([f,mx,my,k1,k2,!!d.stair,!!d.street]);}
  // cuartos abiertos al pasillo y pasillos que se tocan: se miran sus bordes desde afuera, cada 50 cm
  const edgeProbe=(r,fn)=>{for(let t=.25;t<r.w;t+=.5){fn(r.x+t,r.y-.2);fn(r.x+t,r.y+r.h+.2);}for(let t=.25;t<r.h;t+=.5){fn(r.x-.2,r.y+t);fn(r.x+r.w+.2,r.y+t);}};
  // (y un paso «virtual» donde se tocan, para medir distancias: el camino no es sólo de puerta en puerta)
  const virt=new Set(),open2=(a,b,x,y)=>{link(a,b);const pk=[a,b].sort().join('|');if(!virt.has(pk)){virt.add(pk);doorPts.push([f,x,y,a,b,false,false]);}};
  for(const q of lv.rooms)if(ABIERTOS.has(q.type))edgeProbe(q,(x,y)=>{const s=sp(x,y);if(s&&s[0]==='c')open2(key(f,'r'+q.id),key(f,s),x,y);});
  lv.corridor.forEach((c,i)=>edgeProbe(c,(x,y)=>{const s=sp(x,y);if(s&&s[0]==='c'&&s!=='c'+i)open2(key(f,'c'+i),key(f,s),x,y);}));
  for(const q of lv.rooms)node.set(key(f,'r'+q.id),{f,q});
  if(f>0&&lv.stair&&L.levels[f-1].stair)link(key(f,'escalera'),key(f-1,'escalera'));
  if(f>0&&lv.liftRect&&L.levels[f-1].liftRect)link(key(f,'nucleo'),key(f-1,'nucleo'));}
 // ¿se llega a todo desde la calle?
 const seen=new Set(['calle']),st=['calle'];while(st.length){const c=st.pop();for(const [n] of adj.get(c)||[])if(!seen.has(n)){seen.add(n);st.push(n);}}
 for(const [k,{f,q}] of node)if(!seen.has(k)&&!['deposito'].includes(q.type)||!seen.has(k)&&q.type==='deposito')falla('cuarto al que no se llega desde la calle',{...tag0,piso:f,cuarto:q.type});
 // evacuación: Dijkstra sobre las puertas (de una puerta a otra del mismo espacio, en línea recta)
 const dn=doorPts.map((d,i)=>i),dist=new Float64Array(doorPts.length).fill(Infinity),pq=[];
 for(let i=0;i<doorPts.length;i++){const [f,,, ,,stair,street]=doorPts[i];if(street||f>0&&stair){dist[i]=0;pq.push(i);}}
 const bySpace=new Map();doorPts.forEach((d,i)=>{for(const s of [d[3],d[4]])if(s!=='calle')(bySpace.get(s)||bySpace.set(s,[]).get(s)).push(i);});
 while(pq.length){let bi=0;for(let j=1;j<pq.length;j++)if(dist[pq[j]]<dist[pq[bi]])bi=j;const i=pq.splice(bi,1)[0],d=doorPts[i];
  for(const s of [d[3],d[4]]){if(s==='calle'||(d[5]&&d[0]>0&&s.endsWith(':escalera')))continue;for(const j of bySpace.get(s)||[]){const e=doorPts[j],w=Math.hypot(e[1]-d[1],e[2]-d[2]);if(dist[i]+w<dist[j]-1e-9){dist[j]=dist[i]+w;pq.push(j);}}}}
 for(const [k,{f,q}] of node){if(!seen.has(k))continue;let best=Infinity;
  for(const j of bySpace.get(k)||[]){const e=doorPts[j];if(!isFinite(dist[j]))continue;const far=Math.max(...[[q.x,q.y],[q.x+q.w,q.y],[q.x,q.y+q.h],[q.x+q.w,q.y+q.h]].map(([x,y])=>Math.hypot(x-e[1],y-e[2])));best=Math.min(best,dist[j]+far);}
  if(best>MINIMO.evacuacion&&isFinite(best))falla('cuarto lejos de la escalera (evacuación)',{...tag0,piso:f,cuarto:q.type,m:+best.toFixed(1)});
  else if(!isFinite(best))falla('cuarto sin camino a una salida',{...tag0,piso:f,cuarto:q.type});}}

let bpMap=null;
for(let seed=S0;seed<S0+N;seed++){const bp=generateBlueprint({seed,team:3});bpMap=bp.map;
 // (2026-10-15: también los edificios residenciales del monte, que salen del mismo plano —buildLot—)
 for(const L of [...bp.lots,...(bp.isla?.lots||[]).filter(L=>L.type==='residencial')]){if(!L.levels?.length||!L.parts)continue;edificios++;
  for(const {level:f,walls,lv} of volumesOf(L)){pisos++;paredes+=walls.length;const tag={ciudad:seed,lote:L.id,tipo:L.type,piso:f};
   const spaces=[...lv.rooms.map(q=>({r:q,id:q.id,t:q.type})),...lv.corridor.map(c=>({r:c,id:'pasillo',t:'pasillo'})),...(lv.core?[{r:lv.core,id:'nucleo',t:'nucleo'}]:[])];
   const spaceAt=(x,y)=>{const s=spaces.filter(s=>inRect(s.r,x,y));if(!s.length)return L.parts.some(p=>inRect(p,x,y))?null:'calle';
    const room=s.find(s=>typeof s.id==='number');if(room)return room.id;if(s.some(s=>s.id==='nucleo')){const Q=lv.liftRect;return Q&&inRect(Q,x,y)?'nucleo':'escalera';}return 'pasillo';};
   // ---- Puertas ----
   const doors=lv.doors.map(d=>({d,...spanOf(d)}));
   for(const o of doors){puertas++;const {d,h,at,a,b}=o,len=b-a,luz=len-PUERTA.marco;
    if(luz<(d.street?MINIMO.luzPuertaCalle:MINIMO.luzPuerta)-E)falla('puerta angosta',{...tag,luz:+luz.toFixed(2),entre:[d.a,d.b]});
    // ¿une lo que dice unir? (a 30 cm de cada lado del centro del vano)
    const m=(a+b)/2,[x1,y1]=h?[m,at-.3]:[at-.3,m],[x2,y2]=h?[m,at+.3]:[at+.3,m],got=[spaceAt(x1,y1),spaceAt(x2,y2)].map(String).sort(),want=[d.a,d.b].map(x=>x==='patio'?'calle':String(x)).sort();// (la del patio da afuera del edificio, como la de calle: que sea patio y se llegue a pie lo mira validar-patios)
    const ok=got.join()===want.join()||want.includes('pasillo')&&got.includes('pasillo')&&got.some(g=>want.includes(g)&&g!=='pasillo')||want.join()===['pasillo','pasillo'].join();
    if(!ok)falla('puerta que no une lo que dice',{...tag,dice:want,une:got});
    // ¿hay pared donde está el vano? (si no hay nada que cortar, el vano está en el aire)
    if(!d.street){const line=walls.filter(w=>w.h===h&&Math.abs(w.at-at)<E);const covered=lv.rooms.concat(lv.core?[lv.core]:[]).some(q=>h?(Math.abs(q.y-at)<E||Math.abs(q.y+q.h-at)<E)&&q.x<=a+E&&q.x+q.w>=b-E:(Math.abs(q.x-at)<E||Math.abs(q.x+q.w-at)<E)&&q.y<=a+E&&q.y+q.h>=b-E);
     if(!covered&&!line.length)falla('vano sin pared',{...tag,entre:[d.a,d.b]});}
    // paredes de otra línea que tocan la línea del vano: si su grosor cae dentro del vano, la pared lo atraviesa; si
    // queda a menos de MINIMO.aPuerta de una punta, el marco (de PUERTA.marco) se mete en ella. gap: de la punta del
    // vano a la cara de la pared.
    for(const w of walls){if(w.h===h&&Math.abs(w.at-at)<E)continue;if(w.kind==='fachada'&&d.street)continue;
     const R=w.rect,[c0,c1]=h?[R.y,R.y+R.h]:[R.x,R.x+R.w];if(c1<at-.04||c0>at+.04)continue;// no toca la línea del vano
     const [wa,wb]=h?[R.x,R.x+R.w]:[R.y,R.y+R.h];
     if(wa<b-.005&&wb>a+.005){falla(w.kind==='fachada'?'vano metido en la fachada':'tabique dentro de un vano',{...tag,pared:w.kind,entre:[d.a,d.b],vano:[+a.toFixed(2),+b.toFixed(2)],pared_en:[+wa.toFixed(2),+wb.toFixed(2)],linea:(h?'y=':'x=')+at.toFixed(2)});continue;}
     const gap=wa>=b?wa-b:a-wb;if(gap<MINIMO.aPuerta-1e-3)falla('marco metido en una pared',{...tag,pared:w.kind,entre:[d.a,d.b],gap:+gap.toFixed(3)});}}
   // dos vanos en la misma línea que se pisan
   for(let i=0;i<doors.length;i++)for(let j=i+1;j<doors.length;j++){const p=doors[i],q=doors[j];if(p.h===q.h&&Math.abs(p.at-q.at)<E&&p.a<q.b-E&&q.a<p.b-E)falla('dos vanos encimados',{...tag,entre:[[p.d.a,p.d.b],[q.d.a,q.d.b]]});}
   // ---- Paredes ----
   // (una astilla: un trozo corto que NO es la jamba de una puerta —entre la punta de un vano y una esquina o la
   // fachada—; el que queda en negativo es el vano metido en la fachada, ya contado arriba)
   const doorEnd=(w,e)=>doors.some(o=>o.h===w.h&&Math.abs(o.at-w.at)<E&&(Math.abs(o.a-e)<1e-3||Math.abs(o.b-e)<1e-3));
   // (una esquina: otra pared que llega de costado; o la misma pared que sigue en su línea —el corte donde empieza una
   // parte del edificio es sólo un corte, no una punta—)
   const corner=(w,e)=>walls.some(v=>v!==w&&(v.h!==w.h&&Math.abs(v.at-e)<MURO.fachada+1e-3&&v.a<=w.at+.2&&v.b>=w.at-.2||v.h===w.h&&Math.abs(v.at-w.at)<E&&(Math.abs(v.a-e)<1e-3||Math.abs(v.b-e)<1e-3)));
   for(const w of walls)if(w.kind!=='fachada'&&w.len>0&&w.len<MINIMO.resto-1e-3&&!((doorEnd(w,w.a)&&corner(w,w.b))||(corner(w,w.a)&&doorEnd(w,w.b))))
    falla('astilla de pared',{...tag,largo:+w.len.toFixed(3),pared:w.kind,linea:(w.h?'y=':'x=')+w.at.toFixed(2),de:+w.a.toFixed(2),a:+w.b.toFixed(2)});
   // tabiques que llegan a la fachada en medio de una ventana
   for(const win of lv.windows){const {h,at,a,b}=spanOf(win),band=h?{x:a,y:at-MURO.fachada-.06,w:b-a,h:2*MURO.fachada+.12}:{x:at-MURO.fachada-.06,y:a,w:2*MURO.fachada+.12,h:b-a};
    for(const w of walls)if(w.kind!=='fachada'&&w.h!==h&&overlap(w.rect,band,.005))falla('tabique contra una ventana',{...tag,pared:w.kind});}
   // ---- Cuartos ----
   for(const q of lv.rooms){if(SIN_MINIMO.test(q.type))continue;const lado=Math.min(q.w,q.h)-MURO.tabique,min=q.type==='hall'||q.type==='entrada'?MINIMO.hall:BANO.test(q.type)?MINIMO.bano:MINIMO.cuarto;
    if(lado<min-E)falla('cuarto angosto',{...tag,cuarto:q.type,lado:+lado.toFixed(2),min});}
   for(const c of lv.corridor){const lado=Math.min(c.w,c.h)-MURO.tabique;if(lado<MINIMO.pasillo-E)falla('pasillo angosto',{...tag,lado:+lado.toFixed(2)});}
   // ---- Muebles (nivel 2 contra el nivel 1) ----
   // Por cuarto: la planta libre (lejos de paredes —con su grosor— y de cada mueble, a la distancia del cuerpo) y, desde
   // las puertas, ¿se llega al lugar de uso de cada mueble? (delante, o a los costados en las camas; como el flow() del
   // plano). Se prueba con varios cuerpos (CUERPOS): el que usa hoy el plano, el real y el real con holgura.
   const items=lv.furniture||[];
   for(const q of lv.rooms){const mine=items.filter(it=>overlap(it,q,-1e-3)&&inRect(q,it.x+it.w/2,it.y+it.h/2));if(!mine.length)continue;
    const inset=side=>side?MURO.fachada:MURO.tabique/2,onEdge=(x,y)=>!L.parts.some(p=>inRect(p,x,y));
    const box={x0:q.x+inset(onEdge(q.x-.05,q.y+q.h/2)),x1:q.x+q.w-inset(onEdge(q.x+q.w+.05,q.y+q.h/2)),y0:q.y+inset(onEdge(q.x+q.w/2,q.y-.05)),y1:q.y+q.h-inset(onEdge(q.x+q.w/2,q.y+q.h+.05))};
    // muebles encimados (las sillas van bajo la mesa; las alfombras no cuentan)
    for(let i=0;i<mine.length;i++)for(let j=i+1;j<mine.length;j++){const a=mine[i],b=mine[j];if([a,b].some(o=>o.kind==='silla'||o.kind==='alfombra'))continue;if(overlap(a,b,.01))falla('muebles encimados',{...tag,cuarto:q.type,a:a.kind,b:b.kind});}
    // mueble metido en el grosor de la pared
    for(const it of mine)if(it.x<box.x0-.02||it.x+it.w>box.x1+.02||it.y<box.y0-.02||it.y+it.h>box.y1+.02)falla('mueble metido en la pared',{...tag,cuarto:q.type,mueble:it.kind,cm:Math.round(100*Math.max(box.x0-it.x,it.x+it.w-box.x1,box.y0-it.y,it.y+it.h-box.y1))});
    // mueble alto delante de una ventana
    for(const it of mine){if(!ITEMS[it.kind]?.[2])continue;for(const win of lv.windows){const {h,at,a,b}=spanOf(win);const band=h?{x:a,y:at-MURO.fachada-.1,w:b-a,h:2*MURO.fachada+.2}:{x:at-MURO.fachada-.1,y:a,w:2*MURO.fachada+.2,h:b-a};if(overlap(it,band,.01))falla('mueble alto delante de una ventana',{...tag,cuarto:q.type,mueble:it.kind});}}
    }
   // ¿se entra y se usa cada mueble? Con LA prueba del plano (makeMovement en blueprint.js), sobre los muebles finales de
   // cada cuarto: el plano deja el resultado en room.mov (una sola implementación; cuerpo de ERGO.radioPrueba).
   for(const q of lv.rooms){const m=q.mov;if(!m)continue;
    if(m.puertasN&&!m.puertas)falla('no se entra al cuarto',{...tag,cuarto:q.type,prog:q.prog});
    else if(m.puertas<m.puertasN)falla('puerta del cuarto que no se alcanza',{...tag,cuarto:q.type,puertas:`${m.puertas}/${m.puertasN}`});
    if(m.puertas||!m.puertasN)for(const k of m.sinUso)falla('mueble que no se puede usar',{...tag,cuarto:q.type,mueble:k});}
   // ---- Luz (2026-10-15): cada cuarto habitable con ventana, y vidrio ≥ MINIMO.luz de su piso (vidrio medido: VIDRIO) ----
   const winOf=q=>lv.windows.filter(w=>{const {h,at,a,b}=spanOf(w),m=(a+b)/2;return [-.3,.3].some(o=>h?inRect(q,m,at+o):inRect(q,at+o,m));});
   // (el vidrio de cada ventana: el de la pieza que dibuja el 3D en ese piso, según el estilo del edificio)
   const fa=L.fachada||{},vidrioDe=w=>{const {a,b}=spanOf(w);return f===0&&esVidriera(L.type,w)?(VIDRIO.vidriera[fa.familia]??4.2):(VIDRIO.ventana[w.pieza||(f<=1&&b-a>=1?fa.ventana1:fa.ventana)]??.55);};// (2026-10-18: la vidriera sólo en un local, como la dibuja el 3D)
   for(const q of lv.rooms){const ws=winOf(q),vid=ws.reduce((t,w)=>t+vidrioDe(w),0),piso=q.w*q.h;
    if(HABITABLE.has(q.type)){if(!ws.length)falla('cuarto habitable sin ventana',{...tag,cuarto:q.type,m2:+piso.toFixed(1)});else if(vid<piso*MINIMO.luz-1e-6)falla('ventana chica para el cuarto',{...tag,cuarto:q.type,vidrio:+vid.toFixed(2),necesita:+(piso*MINIMO.luz).toFixed(2)});}
    else if(/bano|cocina|cocineta/.test(q.type)&&!ws.length)avisos[q.type]=(avisos[q.type]||0)+1;}
   // ---- Proporciones (2026-10-15): ningún cuarto habitable más alargado que MINIMO.proporcion (lados libres, sin los
   // tabiques), y en cada departamento la sala no más chica que la alcoba más grande ----
   for(const q of lv.rooms){if(!HABITABLE.has(q.type))continue;const a=q.w-MURO.tabique,b=q.h-MURO.tabique,p=Math.max(a,b)/Math.min(a,b);
    if(p>MINIMO.proporcion+1e-6)falla('cuarto alargado',{...tag,cuarto:q.type,medida:`${q.w}×${q.h}`,proporcion:+p.toFixed(2)});}
   for(const u of lv.units||[]){const rs=lv.rooms.filter(q=>q.unit===u.n),sala=rs.find(q=>q.type==='sala'||q.type==='sala_cocina'),alc=rs.filter(q=>q.type==='dormitorio');
    if(sala&&alc.length){const mx=Math.max(...alc.map(q=>q.w*q.h));if(sala.w*sala.h<mx-1e-6)falla('sala más chica que una alcoba',{...tag,sala:+(sala.w*sala.h).toFixed(1),alcoba:+mx.toFixed(1)});}}
   // ---- Interiores (2026-10-15, medidas.js INTERIOR) ----
   // Alcobas: la superficie y el ancho libres de la norma inglesa (NDSS): simple 7,5 m² y 2,15; doble —cama de dos
   // plazas, dos camas o camarote— 11,5 m² y 2,55. Cocinas de las viviendas: con estufa, y el triángulo de trabajo
   // (mesón–estufa–nevera) dentro de sus lados (aviso: queda alguno en cuartos que no dan para más).
   for(const q of lv.rooms){const mine=items.filter(it=>overlap(it,q,-1e-3)&&inRect(q,it.x+it.w/2,it.y+it.h/2)),k=mine.map(i=>i.kind);
    if(q.type==='dormitorio'){const doble=k.includes('cama')||k.includes('litera')||k.filter(x=>x==='cama_s').length>=2,N=doble?INTERIOR.alcobaDoble:INTERIOR.alcobaSimple;
     const a=q.w-MURO.tabique,b=q.h-MURO.tabique;if(a*b<N.m2-1e-6||Math.min(a,b)<N.ancho-1e-6)falla(`alcoba ${doble?'doble':'simple'} bajo la norma`,{...tag,m2:+(a*b).toFixed(2),ancho:+Math.min(a,b).toFixed(2)});}
    if(['cocina','sala_cocina','estudio'].includes(q.type)&&k.includes('meson')&&['vivienda','casa','comercio'].includes(L.type)){
     if(!k.includes('estufa'))falla('cocina sin estufa',{...tag,cuarto:q.type});
     else if(!k.includes('nevera'))avisos['cocina sin nevera']=(avisos['cocina sin nevera']||0)+1;
     else{const c=n=>{const i=mine.find(i=>i.kind===n);return [i.x+i.w/2,i.y+i.h/2];},P=['meson','estufa','nevera'].map(c),l=[0,1,2].map(i=>Math.hypot(P[i][0]-P[(i+1)%3][0],P[i][1]-P[(i+1)%3][1]));
      if(Math.max(...l)>INTERIOR.triangulo.lado[1]+1e-6||l[0]+l[1]+l[2]>INTERIOR.triangulo.total[1]+1e-6)avisos['triángulo de cocina abierto']=(avisos['triángulo de cocina abierto']||0)+1;}}}
   // ---- Superpuestos y huecos (cada punto de la planta, de a 25 cm, tiene que tener un solo dueño) ----
   let solo=0,sin=0;
   for(const p of L.parts)for(let y=p.y+.125;y<p.y+p.h;y+=.25)for(let x=p.x+.125;x<p.x+p.w;x+=.25){
    const owners=spaces.filter(s=>inRect(s.r,x,y)),solid=owners.filter(o=>o.id!=='pasillo').length;
    if(!owners.length)sin++;else if(solid>1||solid===1&&owners.length>1)solo++;}
   if(solo)falla('cuartos superpuestos',{...tag,m2:+(solo*.0625).toFixed(2)});
   if(sin)falla('planta sin dueño (ni cuarto, ni pasillo, ni núcleo)',{...tag,m2:+(sin*.0625).toFixed(2)});
  }
  recorrido(L,seed);
  // (el encierro de la calle: alto / ancho de la calle del frente entre ENCIERRO.min y el máximo —ENCIERRO.centro en el
  // centro—; quedarse corto es aviso: una casa de un piso en una calle de 12 m)
  if(L.floors&&bpMap){const alto=L.floors*ALTURA.piso,ancho=anchoCalle(L);if(L.floors>maxPisos(L,bpMap))falla('edificio más alto que lo que permite su calle',{ciudad:seed,lote:L.id,tipo:L.type,pisos:L.floors,calle:ancho});
   else if(alto/ancho<ENCIERRO.min-1e-9)avisos['encierro bajo (alto < ancho/3)']=(avisos['encierro bajo (alto < ancho/3)']||0)+1;}
  // (el juego: un robable con al menos JUEGO.puertasRobable puertas de calle)
  if(JUEGO.robables.includes(L.type)){const n=new Set(L.levels[0].doors.filter(d=>d.street).map(d=>{const h=Math.abs(d.y0-d.y1)<1e-6,m=h?(d.x0+d.x1)/2:(d.y0+d.y1)/2;return (h?'h':'v')+(h?d.y0:d.x0)+'|'+Math.floor(m/6);})).size;// (salidas distintas: casillas de 6 m)
if(n<JUEGO.puertasRobable)falla('robable con pocas puertas de calle',{ciudad:seed,lote:L.id,tipo:L.type,puertas:n});}
 }}
console.log(`${N} ciudades (semillas ${S0}–${S0+N-1}) · ${edificios} edificios · ${pisos} pisos · ${puertas} vanos · ${paredes} paredes`);
console.log(`edificios con alguna falla: ${lotesMalos.size} de ${edificios}`);
for(const [k,f] of [...fallas].sort((a,b)=>b[1].n-a[1].n)){console.log(`\n  ${f.n}\t${k}   (${f.lotes.size} edificios)`);for(const e of f.ej)console.log('        '+JSON.stringify(e));}
if(Object.keys(avisos).length)console.log('\n(aviso, no es falla) sin ventana, ventilan con extracción:',JSON.stringify(avisos));
process.exitCode=lotesMalos.size?1:0;
