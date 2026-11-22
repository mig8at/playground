// EL GRAFO DE MUROS (2026-11-22, Miguel: «que el motor de plano… tenga la capacidad de encontrar huecos de uniones y pueda ir
// refinando con lo que se espera —puertas, ventanas que no se encuentren en lugares adecuados—… hacer los cálculos en 2D exactos
// y al pasar al 3D ahorrar polígonos y permitir juntas exactas, que nos permitirá más adelante ahorrar mucho trabajo con la base
// de datos de encontrar cosas en el mapa» → «dale, arranca por donde recomiendas»).
//
// Un piso del plano como un grafo: las REGIONES son los cuartos, el pasillo y el núcleo; afuera es la calle (o el patio) o el
// lote vecino. En cada línea del plano, donde a un lado y al otro hay regiones distintas hay MURO; los pedazos seguidos de una
// misma clase se juntan en un TRAMO recto —una sola pieza para el 3D, no un pedazo por cuarto—. Los NODOS son las puntas de
// los tramos y los cruces (en L, en T, en cruz). Cada VANO —puerta, ventana, vano abierto— cuelga de su tramo con su lugar
// exacto. Todo con id estable («L<lote>-P<piso>-M<n>» para un tramo), para una base de datos de lo que hay en el mapa.
//
// Y lo que no encaja, dicho por su nombre (problemas): un vano sin muro, dos vanos que se pisan, un vano sobre una junta
// —un muro que llega de costado en medio del vano—, dos cuartos que se pisan, un hueco en la planta —un pedazo del edificio
// que no es de nadie— y una astilla —un tramo de muro tan corto entre dos vanos o juntas que no sirve—.
// Puros datos; no cambia el plano. El refinador —que corrige lo que se puede— viene después, regla por regla.

export const CLASE={fachada:'fachada',medianera:'medianera',tabique:'tabique',nucleo:'nucleo'};
export const GRAFO={eps:.005,astilla:.15,junta:.02,mocheta:.05};// (m: dos medidas iguales; lo que se ve de muro más corto que no es astilla; y hasta cuánto es la junta de un vano con el muro de al lado)
// (los espesores: el tabique de 12 cm, la medianera de 12 de cada lado, la fachada de 25 hacia adentro; el marco de una puerta, 8 cm)
export const ESPESOR={tabique:.12,medianera:.24,fachada:.25,marco:.08};
const E=GRAFO.eps,r3=v=>Math.round(v*1000)/1000;

// Las regiones de un piso: {id, x, y, w, h, tipo}. id: 'r<n>' un cuarto, 'pasillo' (todos sus rectángulos), 'nucleo'.
export function regionesDe(lv){const out=[];// (id: 'r<n>' un cuarto, 'pasillo', 'nucleo')
 for(const q of lv.rooms||[])out.push({id:'r'+q.id,x:q.x,y:q.y,w:q.w,h:q.h,tipo:q.type,unidad:q.unit,abierto:!!q.abierto});
 // (el pasillo es UNA región aunque el plano lo dé en varios rectángulos —el tramo largo, los ensanches—: entre ellos no hay muro)
 (lv.corridor||[]).forEach(c=>out.push({id:'pasillo',x:c.x,y:c.y,w:c.w,h:c.h,tipo:'pasillo'}));
 if(lv.core)out.push({id:'nucleo',x:lv.core.x,y:lv.core.y,w:lv.core.w,h:lv.core.h,tipo:'nucleo'});
 return out;}

// El grafo de un piso. otroLote(x, z): ¿ese punto es de otro edificio? (para la medianera; si falta, afuera es fachada)
export function grafoDePiso(L,nivel,{otroLote=null}={}){const lv=L.levels[nivel],R=regionesDe(lv),problemas=[],P=(L.parts||[]);
 const dentroEdificio=(x,z)=>P.some(p=>x>p.x-E&&x<p.x+p.w+E&&z>p.y-E&&z<p.y+p.h+E);
 // (la región que cubre un punto, estrictamente adentro)
 const regionEn=(x,z)=>R.find(r=>x>r.x+E&&x<r.x+r.w-E&&z>r.y+E&&z<r.y+r.h-E)||null;
 // las líneas: cada lado de cada región, agrupado por su recta
 const lineas=new Map();const linea=(h,f)=>{const k=(h?'h':'v')+r3(f);return lineas.get(k)||lineas.set(k,{h,f:r3(f),cortes:new Set()}).get(k);};
 for(const r of R){for(const [h,f,a0,a1] of [[true,r.y,r.x,r.x+r.w],[true,r.y+r.h,r.x,r.x+r.w],[false,r.x,r.y,r.y+r.h],[false,r.x+r.w,r.y,r.y+r.h]]){const l=linea(h,f);l.cortes.add(r3(a0));l.cortes.add(r3(a1));}}
 for(const p of P)for(const [h,f,a0,a1] of [[true,p.y,p.x,p.x+p.w],[true,p.y+p.h,p.x,p.x+p.w],[false,p.x,p.y,p.y+p.h],[false,p.x+p.w,p.y,p.y+p.h]]){const l=linea(h,f);l.cortes.add(r3(a0));l.cortes.add(r3(a1));}
 // en cada línea, de corte en corte: qué hay a cada lado (a 1 cm), y si es muro, de qué clase
 const piezas=[];
 for(const l of lineas.values()){const cs=[...l.cortes].sort((a,b)=>a-b);
  for(let i=0;i+1<cs.length;i++){const a=cs[i],b=cs[i+1];if(b-a<E)continue;const m=(a+b)/2,pt=s=>l.h?[m,l.f+s*.01]:[l.f+s*.01,m];
   const ladoDe=s=>{const [x,z]=pt(s),r=regionEn(x,z);if(r)return r.id;if(dentroEdificio(x,z))return 'hueco';return otroLote?.(x,z)?'vecino':'afuera';};
   const A=ladoDe(-1),B=ladoDe(1);if(A===B)continue;
   if((A==='afuera'||A==='vecino')&&(B==='afuera'||B==='vecino'))continue;
   const clase=A==='afuera'||B==='afuera'?CLASE.fachada:A==='vecino'||B==='vecino'?CLASE.medianera:A==='nucleo'||B==='nucleo'?CLASE.nucleo:CLASE.tabique;
   piezas.push({h:l.h,f:l.f,a0:a,a1:b,clase,lados:[A,B]});}}
 // los huecos de la planta: un pedazo del edificio que no es de ninguna región (de a 25 cm)
 for(const p of P)for(let x=p.x+.125;x<p.x+p.w;x+=.25)for(let z=p.y+.125;z<p.y+p.h;z+=.25){if(!R.some(r=>x>r.x-E&&x<r.x+r.w+E&&z>r.y-E&&z<r.y+r.h+E)){problemas.push({tipo:'hueco en la planta',x:r3(x),z:r3(z)});x=p.x+p.w;break;}}
 // dos regiones que se pisan
 for(let i=0;i<R.length;i++)for(let j=i+1;j<R.length;j++){const a=R[i],b=R[j],ox=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x),oz=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);if(ox>E&&oz>E)problemas.push({tipo:'dos regiones que se pisan',a:a.id,b:b.id,m2:r3(ox*oz)});}
 // TRAMOS: las piezas seguidas de una misma clase en una misma línea, juntas
 const tramos=[];const porLinea=new Map();for(const p of piezas){const k=(p.h?'h':'v')+p.f;(porLinea.get(k)||porLinea.set(k,[]).get(k)).push(p);}
 for(const ps of porLinea.values()){ps.sort((a,b)=>a.a0-b.a0);let t=null;
  for(const p of ps){if(t&&t.clase===p.clase&&Math.abs(t.a1-p.a0)<E){t.a1=p.a1;t.lados.push({a0:p.a0,a1:p.a1,lados:p.lados});}else{t={h:p.h,f:p.f,a0:p.a0,a1:p.a1,clase:p.clase,lados:[{a0:p.a0,a1:p.a1,lados:p.lados}],vanos:[]};tramos.push(t);}}}
 tramos.sort((a,b)=>(a.h===b.h?0:a.h?-1:1)||a.f-b.f||a.a0-b.a0);tramos.forEach((t,i)=>t.id=`L${L.id}-P${nivel}-M${i}`);
 // NODOS: las puntas de cada tramo y donde un tramo toca a otro de costado
 const nodos=new Map();const nodo=(x,z)=>{const k=r3(x)+','+r3(z);return nodos.get(k)||nodos.set(k,{id:'',x:r3(x),z:r3(z),tramos:new Set()}).get(k);};
 const xz=(t,a)=>t.h?[a,t.f]:[t.f,a];
 for(const t of tramos){nodo(...xz(t,t.a0)).tramos.add(t.id);nodo(...xz(t,t.a1)).tramos.add(t.id);}
 for(const t of tramos)for(const o of tramos){if(t===o||t.h===o.h)continue;// (o, perpendicular, toca a t en el medio)
  if(o.f>t.a0+E&&o.f<t.a1-E&&(Math.abs(o.a0-t.f)<E||Math.abs(o.a1-t.f)<E||(o.a0<t.f-E&&o.a1>t.f+E))){const n=nodo(...xz(t,o.f));n.tramos.add(t.id);n.tramos.add(o.id);(t.juntas||(t.juntas=[])).push(o.f);}}
 [...nodos.values()].forEach((n,i)=>{n.id=`L${L.id}-P${nivel}-N${i}`;n.grado=n.tramos.size;n.tramos=[...n.tramos];});
 // VANOS: cada puerta y ventana, en el tramo de su línea que la contiene
 const vanos=[...(lv.doors||[]).map((d,i)=>({...d,clase:d.wide?'vano':d.street?'puerta de calle':d.core||d.stair?'núcleo':'puerta',ref:'d'+i})),...(lv.windows||[]).map((w,i)=>({...w,clase:w.shop?'vidriera':'ventana',ref:'w'+i}))];
 for(const v of vanos){const h=Math.abs(v.y0-v.y1)<E,f=r3(h?v.y0:v.x0),a=Math.min(h?v.x0:v.y0,h?v.x1:v.y1),b=Math.max(h?v.x0:v.y0,h?v.x1:v.y1);
  const t=tramos.find(t=>t.h===h&&Math.abs(t.f-f)<E&&a>t.a0-E&&b<t.a1+E);
  if(!t){problemas.push({tipo:'vano sin muro',vano:v.clase,linea:(h?'y=':'x=')+f,de:r3(a),a:r3(b)});continue;}
  const V={ref:v.ref,clase:v.clase,a0:r3(a),a1:r3(b),ancho:r3(b-a)};
  for(const o of t.vanos)if(Math.min(o.a1,V.a1)-Math.max(o.a0,V.a0)>E)problemas.push({tipo:'dos vanos que se pisan',tramo:t.id,a:o.clase,b:V.clase});
  // (un muro que llega de costado en medio del vano: el vano queda partido por la junta)
  for(const j of t.juntas||[])if(j>V.a0+E&&j<V.a1-E)problemas.push({tipo:'vano sobre una junta',tramo:t.id,vano:V.clase,en:r3(j)});
  t.vanos.push(V);}
 // ASTILLAS: lo que se VE de muro entre vanos y juntas —el largo en el eje, menos medio espesor del muro que llega en la junta
 // y el marco de la puerta de al lado—, si queda entre una junta (GRAFO.junta: el vano llega a la cara del muro) y GRAFO.astilla
 // (la medianera, como la fachada: según la altura del vecino el 3D la dibuja con el espesor de la fachada —la culata—)
 const medio=c=>c===CLASE.fachada||c===CLASE.medianera?ESPESOR.fachada:ESPESOR.tabique/2;
 const claseEn=(t,a)=>{const o=tramos.find(o=>o.h!==t.h&&Math.abs(o.f-a)<E&&t.f>o.a0-E&&t.f<o.a1+E);return o?.clase;};
 for(const t of tramos){if(t.clase===CLASE.fachada||t.clase===CLASE.medianera)continue;const cortes=[t.a0,t.a1,...(t.juntas||[])].sort((a,b)=>a-b),llenos=[];
  for(let i=0;i+1<cortes.length;i++){let ts=[[cortes[i],cortes[i+1]]];for(const v of t.vanos)ts=ts.flatMap(([u,w])=>[[u,Math.min(w,v.a0)],[Math.max(u,v.a1),w]].filter(([p,q])=>q-p>E));llenos.push(...ts);}
  for(const [u,w] of llenos){let ve=w-u,marco=false;const junto=[];for(const a of [u,w]){const c=claseEn(t,a);if(c)ve-=medio(c);const v=t.vanos.find(v=>Math.abs(v.a1-a)<E||Math.abs(v.a0-a)<E);if(v){junto.push({vano:v,punta:Math.abs(v.a1-a)<E?'a1':'a0'});if(v.clase==='puerta'||v.clase==='puerta de calle'){ve-=ESPESOR.marco;marco=true;}}}
   // (junto a una puerta con marco, la mocheta —5 a 10 cm de muro detrás del marco— es normal: astilla sólo por debajo de GRAFO.mocheta)
   if(ve>GRAFO.junta+E&&ve<(marco?GRAFO.mocheta:GRAFO.astilla)-E)problemas.push({tipo:'astilla de muro',tramo:t.id,largo:r3(w-u),seVe:r3(ve),en:r3(u),a:r3(w),junto});}}
 // (cuánto ahorra: lados de cuarto como los arma hoy el 3D —cuatro por región— contra tramos rectos)
 return {tramos,nodos:[...nodos.values()],vanos:tramos.reduce((t,x)=>t+x.vanos.length,0),problemas,lados:R.length*4};}

// Todos los pisos de un lote.
export function grafoDeLote(bp,L){const otro=(x,z)=>bp.lots.some(o=>o!==L&&(o.parts||[]).some(p=>x>p.x&&x<p.x+p.w&&z>p.y&&z<p.y+p.h));
 return (L.levels||[]).slice(0,L.floors||L.levels?.length||0).map((lv,f)=>grafoDePiso(L,f,{otroLote:otro}));}

// EL REFINADOR (2026-11-22): lo que el grafo encuentra y se puede corregir, se corrige en el plano —regla por regla, cada una
// con su prueba—. 1) Un vano sin marco —un vano abierto o el de la escalera del núcleo— que deja una astilla de muro hasta la
// junta se estira hasta la cara del muro de al lado (con 1 cm de junta): el muro que quedaba, de 4 a 13 cm, no servía para
// nada y en el 3D era una columnita. Devuelve cuántos corrigió.
export function refinarMuros(bp){let estirados=0;
 for(const L of bp.lots){if(!L.levels?.length)continue;const grafos=grafoDeLote(bp,L);
  grafos.forEach((g,f)=>{const lv=L.levels[f];
   for(const p of g.problemas){if(p.tipo!=='astilla de muro')continue;const t=g.tramos.find(t=>t.id===p.tramo);
    for(const {vano,punta} of p.junto||[]){if(vano.clase!=='vano'&&vano.clase!=='núcleo')continue;const d=lv.doors[+vano.ref.slice(1)];if(!d)continue;
     // la punta del vano va hasta la otra punta del pedazo de muro, menos lo que ocupa ahí la junta (medio muro y 1 cm)
     const otra=punta==='a1'?p.a:p.en,c=g.tramos.find(o=>o.h!==t.h&&Math.abs(o.f-otra)<E&&t.f>o.a0-E&&t.f<o.a1+E),hueco=c?(c.clase===CLASE.fachada||c.clase===CLASE.medianera?ESPESOR.fachada:ESPESOR.tabique/2)+.01:0;
     const nueva=punta==='a1'?otra-hueco:otra+hueco,h=t.h,k=h?['x0','x1']:['y0','y1'],lo=Math.min(d[k[0]],d[k[1]])===d[k[0]]?k[0]:k[1],hi=lo===k[0]?k[1]:k[0];
     if(punta==='a1'&&nueva>d[hi]+E){d[hi]=r3(nueva);estirados++;}else if(punta==='a0'&&nueva<d[lo]-E){d[lo]=r3(nueva);estirados++;}}}});}
 return {estirados};}

// LOS MUROS CON SU ESPESOR (2026-11-22, Miguel: «quiero enfocarme en medir muy bien en el 2D, el motor, antes de pasar al 3D»).
// Cada tramo del grafo como uno o más rectángulos en planta, con su espesor real —el tabique y el núcleo, ESPESOR.tabique
// centrado en su línea; la fachada y la medianera, ESPESOR.fachada hacia adentro— y sus puntas resueltas en cada nodo:
// - en un nodo, una LÍNEA pasa si tiene muro a los dos lados (un tramo de largo, o dos seguidos en la misma línea);
// - si pasa la línea de enfrente (una T), el tramo se corta en su cara; si pasan las dos (un cruce), manda la de más rango
//   —fachada y medianera, después núcleo, después tabique; a igual rango, la horizontal— y la otra se corta en su cara;
// - si pasa la suya y no la de enfrente, el tramo termina justo en el nodo, donde sigue el de al lado;
// - en una L, el horizontal sigue hasta la cara de afuera del vertical y el vertical se corta en la de adentro del
//   horizontal; una punta libre queda en su línea.
// Así no se pisan ni queda un hueco en el nodo (lo mide juntasDe). Devuelve [{id, clase, x, y, w, h}] (metros); el 3D lo levantará.
const RANGO={[CLASE.fachada]:3,[CLASE.medianera]:3,[CLASE.nucleo]:2,[CLASE.tabique]:1};
export function bandaDe(t){// [c0, c1]: lo que ocupa a lo ancho, alrededor de su línea
 if(t.clase===CLASE.fachada||t.clase===CLASE.medianera){const adentroMas=t.lados.some(l=>l.lados[1]!=='afuera'&&l.lados[1]!=='vecino');return adentroMas?[t.f,t.f+ESPESOR.fachada]:[t.f-ESPESOR.fachada,t.f];}
 return [t.f-ESPESOR.tabique/2,t.f+ESPESOR.tabique/2];}
export function murosConEspesor(g){const out=[];const T=g.tramos;
 // (la línea de orientación h en la coordenada f, en el punto a de su eje: sus muros, si pasa, su rango y su banda)
 const linea=(h,f,a,sin)=>{const ms=T.filter(o=>o!==sin&&o.h===h&&Math.abs(o.f-f)<E&&a>o.a0-E&&a<o.a1+E);
  const antes=ms.some(o=>o.a0<a-E),despues=ms.some(o=>o.a1>a+E);
  const bs=ms.map(bandaDe);return {ms,pasa:antes&&despues,rango:Math.max(0,...ms.map(o=>RANGO[o.clase])),c0:Math.min(...bs.map(b=>b[0])),c1:Math.max(...bs.map(b=>b[1]))};};
 const gana=(r1,h1,r2)=>r1>r2||(r1===r2&&h1);// (¿la línea de rango r1, horizontal si h1, le gana a la otra?)
 for(const t of T){const [c0,c1]=bandaDe(t);
  const propia=a=>linea(t.h,t.f,a,null);
  // (cada punta, por franjas a lo ancho del tramo: si la línea de enfrente la forman muros de distinta banda —una fachada que
  // sigue como tabique—, cada franja se corta en la cara del muro que tiene delante. Si no, una sola franja)
  const puntas=[[0,t.a0],[1,t.a1]].map(([lado,a])=>{const fr=linea(!t.h,a,t.f,null);if(!fr.ms.length)return [{c0,c1,a}];// (punta libre: en su línea)
   const mia=propia(a);
   if(fr.pasa&&(!mia.pasa||!gana(mia.rango,t.h,fr.rango))){// T, o un cruce que pierde
    const bs=[...new Set([c0,c1,...fr.ms.flatMap(o=>[o.a0,o.a1]).filter(v=>v>c0+E&&v<c1-E)])].sort((x,y)=>x-y);
    return bs.slice(1).map((b,k)=>{const m=(bs[k]+b)/2,ws=fr.ms.filter(o=>m>o.a0&&m<o.a1).map(bandaDe);
     return {c0:bs[k],c1:b,a:ws.length?(lado===0?Math.max(...ws.map(w=>w[1])):Math.min(...ws.map(w=>w[0]))):(lado===0?fr.c1:fr.c0)};});}
   if(mia.pasa)return [{c0,c1,a}];// sigue el de al lado
   return [{c0,c1,a:t.h?(lado===0?fr.c0:fr.c1):(lado===0?fr.c1:fr.c0)}];});// L
  // (los cruces a mitad del tramo: si pierde, se corta en la cara del que pasa)
  const cortes=T.filter(o=>o.h!==t.h&&o.f>t.a0+E&&o.f<t.a1-E&&t.f>o.a0+E&&t.f<o.a1-E).map(o=>linea(o.h,o.f,t.f,null)).filter(fr=>!gana(propia(fr.ms[0].f).rango,t.h,fr.rango)).map(fr=>[fr.c0,fr.c1]).sort((x,y)=>x[0]-y[0]);
  const bs=[...new Set([c0,c1,...puntas.flat().flatMap(p=>[p.c0,p.c1])])].sort((x,y)=>x-y);let k=0;
  for(let q=1;q<bs.length;q++){const s0=bs[q-1],s1=bs[q],m=(s0+s1)/2,en=ps=>ps.find(p=>m>p.c0-1e-9&&m<p.c1+1e-9).a;
   const a0=en(puntas[0]),a1=en(puntas[1]);let desde=a0;const tramos=[];for(const [x0,x1] of cortes){tramos.push([desde,x0]);desde=x1;}tramos.push([desde,a1]);
   for(const [p0,p1] of tramos){if(p1-p0<=E)continue;const id=k++?t.id+'#'+k:t.id;
    out.push(t.h?{id,tramo:t.id,clase:t.clase,x:r3(p0),y:r3(s0),w:r3(p1-p0),h:r3(s1-s0)}:{id,tramo:t.id,clase:t.clase,x:r3(s0),y:r3(p0),w:r3(s1-s0),h:r3(p1-p0)});}}}
 return out;}

// LAS JUNTAS, al milímetro: dos muros que se pisan (área en común) y una junta abierta —un pedazo de la banda de un tramo, sobre su
// propia línea, que no cubre ningún muro: lo que se le cortó en un nodo y nadie tapó—. Devuelve {pisan, abiertas}.
export function juntasDe(g,muros=murosConEspesor(g)){const pisan=[],abiertas=[];
 for(let i=0;i<muros.length;i++)for(let j=i+1;j<muros.length;j++){const a=muros[i],b=muros[j],ox=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x),oz=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
  if(ox>.001&&oz>.001)pisan.push({a:a.id,b:b.id,cm2:Math.round(ox*oz*1e4)});}
 const en=(x,z)=>muros.some(m=>x>m.x-1e-4&&x<m.x+m.w+1e-4&&z>m.y-1e-4&&z<m.y+m.h+1e-4);
 // (cada tramo tiene que quedar sellado a lo largo de su propia línea, de a0 a a1 y con todo su espesor: lo que se le cortó en
 // un nodo lo tiene que cubrir otro muro. Se recorre de a 1 cm cerca de cada nodo —las puntas y los cruces—, que es donde se corta)
 const nodosEn=t=>[t.a0,t.a1,...g.tramos.filter(o=>o.h!==t.h&&o.f>t.a0+E&&o.f<t.a1-E&&t.f>o.a0-E&&t.f<o.a1+E).map(o=>o.f)];
 for(const t of g.tramos){const [c0,c1]=bandaDe(t),R=ESPESOR.fachada+.02;let hueco=null;
  fuera:for(const a of nodosEn(t))for(let u=Math.max(t.a0,a-R)+.004;u<Math.min(t.a1,a+R);u+=.01)for(let c=c0+.004;c<c1;c+=.01){const [x,z]=t.h?[u,c]:[c,u];if(!en(x,z)){hueco={x:r3(x),z:r3(z)};break fuera;}}
  if(hueco){let ancho=0;for(let u=t.a0+.005;u<t.a1;u+=.01)for(let c=c0+.005;c<c1;c+=.01){const [x,z]=t.h?[u,c]:[c,u];if(!en(x,z))ancho++;}abiertas.push({tramo:t.id,...hueco,cm2:ancho});}}
 return {pisan,abiertas};}
