/* La circulación, por cálculo (FUGA, 2026-10-15): la red de carriles de los vehículos y la grilla de navegación de los
   peatones, sobre el plano ya armado (generateBlueprint, con su vegetación y su equipamiento), con las medidas de
   medidas.js CIRCULACION. Se calcula a pedido (no la arma generateBlueprint): la usan el validador, el plano 2D y, después,
   el 3D (el tráfico sigue los carriles; el personaje camina donde la grilla dice).
   Coordenadas del plano: metros, x a la derecha, z (= y del plano) hacia abajo. */
import {CIRCULACION as C,CALLE,EQUIPAMIENTO as Q} from './medidas.js';
import {CELL} from './veredas.js';
import {islaDe,mascaraRebaje} from './isla.js';
import City from './ciudad.js';

// ======== Vehículos: la red de carriles ========
// Nodos: los cruces de la ciudad (su centro), las puntas de las calles, los enganches de las salidas del muro sobre la
// circunvalación y los cruces del monte. Tramos: entre nodos seguidos de una misma calle, de doble mano, con sus carriles
// por sentido (uno en las calles, dos en las avenidas), su velocidad, su pendiente y la geometría de cada carril (a la
// derecha del eje, a carril/2 —y carril·1,5 el segundo— de él).
export function redVehicular(bp){const m=bp.map,I=bp.isla,{W,H}=m,K=City.K,n=m.names,nodos=new Map(),tramos=[];
 const nodo=(x,z,h=0,tipo='cruce')=>{const k=Math.round(x*2)/2+','+Math.round(z*2)/2;if(!nodos.has(k))nodos.set(k,{id:k,x,z,h,tipo,arcos:[]});return nodos.get(k);};
 const une=(a,b,{ancho,av,puntos,origen})=>{if(a===b)return;const t={a:a.id,b:b.id,ancho,av,carriles:av?2:1,velocidad:av?C.vehiculo.velocidad.avenida:C.vehiculo.velocidad.calle,puntos:puntos||[{x:a.x,z:a.z,h:a.h},{x:b.x,z:b.z,h:b.h}],origen};
  tramos.push(t);a.arcos.push(tramos.length-1);b.arcos.push(tramos.length-1);};
 // ---- la ciudad: cada calle con nombre, casilla por casilla a lo largo ----
 // por(t) = [lo, hi]: las casillas a lo ancho en la posición t. Una calle con nombre puede ser dos tramos en línea corridos
 // una casilla (el nombrador junta los que se tocan): su eje tiene ese quiebre. Y el nombrador deja huecos en algunos
 // cruces (las casillas del encuentro, sin el nombre de una de las dos): un hueco de hasta 3 casillas de calle se cubre.
 const calleK=k=>k===K.street||k===K.avenue||k===K.kiosk,lineas=[];
 // (y por piezas conectadas: el nombrador también junta dos calles paralelas separadas que tocan la misma calle —antes su
 // «ancho» abarcaba los edificios del medio—; cada pieza es una calle para la red)
 const piezas=[];for(const l of n?.lines||[]){const arr=l.axis==='h'?n.hLine:n.vLine,visto=new Uint8Array(W*H);
  for(let i0=0;i0<W*H;i0++){if(arr[i0]!==l.id||visto[i0])continue;const comp=[i0];visto[i0]=1;
   for(let k=0;k<comp.length;k++){const i=comp[k],x=i%W,y=(i-x)/W;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=W||yy>=H)continue;const j=yy*W+xx;if(arr[j]===l.id&&!visto[j]){visto[j]=1;comp.push(j);}}}
   piezas.push({l,celdas:comp,sub:piezas.filter(p=>p.l===l).length});}}
 for(const {l,celdas,sub} of piezas){const h=l.axis==='h',por=new Map();
  for(const i of celdas){const t=h?i%W:Math.floor(i/W),v=h?Math.floor(i/W):i%W,r=por.get(t);por.set(t,r?[Math.min(r[0],v),Math.max(r[1],v)]:[v,v]);}
  if(!por.size)continue;const ts=[...por.keys()].sort((p,q)=>p-q);
  for(let i=1;i<ts.length;i++){const g0=ts[i-1],g1=ts[i];if(g1-g0<2||g1-g0>4)continue;const r=por.get(g0),ok=[];for(let t=g0+1;t<g1;t++){let todo=true;for(let v=r[0];v<=r[1];v++){const cx=h?t:v,cy=h?v:t;if(!calleK(m.kind[cy*W+cx]))todo=false;}ok.push(todo);}
   if(ok.every(Boolean))for(let t=g0+1;t<g1;t++)por.set(t,[...r]);}
  const en=t=>{const c=Math.floor(t/CELL),r=por.get(c)||por.get(c-1)||por.get(c+1);return r?(r[0]+r[1]+1)/2*CELL:null;};
  lineas.push({l,h,key:l.axis+l.id+'#'+sub,por,en,av:!!l.avenue});}
 const porKey=new Map(lineas.map(L=>[L.key,L])),ocH=new Int16Array(W*H).fill(-1),ocV=new Int16Array(W*H).fill(-1);
 lineas.forEach((L,li)=>{for(const [t,[lo,hi]] of L.por)for(let v=lo;v<=hi;v++){const cx=L.h?t:v,cy=L.h?v:t;(L.h?ocH:ocV)[cy*W+cx]=li;}});
 const porLinea=new Map(),pon=(L,t,nd)=>(porLinea.get(L.key)||porLinea.set(L.key,[]).get(L.key)).push({t,nd});
 // los cruces: donde se superponen una calle horizontal y una vertical; el nodo, en la intersección de sus dos ejes
 {const cajas=new Map();for(let i=0;i<W*H;i++){if(ocH[i]<0||ocV[i]<0)continue;const k=ocH[i]+'|'+ocV[i],x=i%W,y=(i-x)/W,c=cajas.get(k)||cajas.set(k,{h:ocH[i],v:ocV[i],x0:x,x1:x,y0:y,y1:y,kiosk:false}).get(k);
   c.x0=Math.min(c.x0,x);c.x1=Math.max(c.x1,x);c.y0=Math.min(c.y0,y);c.y1=Math.max(c.y1,y);if(m.kind[i]===K.kiosk)c.kiosk=true;}
  for(const c of cajas.values()){const Lh=lineas[c.h],Lv=lineas[c.v],cx0=(c.x0+c.x1+1)/2*CELL,cz0=(c.y0+c.y1+1)/2*CELL,x=Lv.en(cz0)??cx0,z=Lh.en(cx0)??cz0,nd=nodo(x,z,0,'cruce');
   nd.av=Lh.av||Lv.av;nd.glorieta=c.kiosk;pon(Lh,x,nd);pon(Lv,z,nd);}}
 // las T: una calle que termina contra otra (la casilla que sigue a su punta es de la otra, sin superponerse), un cruce
 for(const L of lineas){const ts=[...L.por.keys()].sort((p,q)=>p-q),runs=[];for(const t of ts){const u=runs.at(-1);if(u&&t===u[1]+1)u[1]=t;else runs.push([t,t]);}L.runs=runs;
  for(const [c0,c1] of runs)for(const [ct,dir] of [[c0,-1],[c1,1]]){const [lo,hi]=L.por.get(ct),mid=Math.floor((lo+hi)/2);
   for(let k=1;k<=2;k++){const t=ct+dir*k,cx=L.h?t:mid,cy=L.h?mid:t;if(cx<0||cy<0||cx>=W||cy>=H)break;const oi=(L.h?ocV:ocH)[cy*W+cx];if(oi<0){if(calleK(m.kind[cy*W+cx]))continue;break;}
    const O=lineas[oi],miEje=L.en(ct*CELL+CELL/2),suEje=O.en(miEje);if(miEje==null||suEje==null)break;const x=L.h?suEje:miEje,z=L.h?miEje:suEje,nd=nodo(x,z,0,'cruce');nd.av=nd.av||L.av||O.av;
    pon(L,L.h?x:z,nd);pon(O,L.h?z:x,nd);break;}}}
 // las salidas del muro: un nodo sobre la calle que corre junto al muro (la circunvalación), frente a la salida
 for(const g of I?.gates||[]){if(!g.calle)continue;const vert=g.lado==='N'||g.lado==='S',fila=g.lado==='N'?1:g.lado==='S'?H-2:null,col=g.lado==='W'?1:g.lado==='E'?W-2:null;
  const [cx,cy]=vert?[Math.floor(g.eje/CELL),fila]:[col,Math.floor(g.eje/CELL)],li=(vert?ocH:ocV)[cy*W+cx];if(li==null||li<0)continue;const L=lineas[li],eje=L.en(vert?g.eje:g.eje);if(eje==null)continue;
  const x=vert?g.eje:eje,z=vert?eje:g.eje,nd=nodo(x,z,0,'salida');nd.salida=g.x+','+g.y;pon(L,vert?x:z,nd);}
 // los tramos: entre nodos seguidos de una misma calle, dentro de cada pedazo continuo; el eje, casilla por casilla
 for(const L of lineas){const todos=(porLinea.get(L.key)||[]).sort((p,q)=>p.t-q.t),ancho=(L.av?CALLE.avenida.casillas:CALLE.calle.casillas)*CELL,P=t=>L.h?{x:t,z:L.en(t),h:0}:{x:L.en(t),z:t,h:0};
  for(const [c0,c1] of L.runs){const t0=c0*CELL,t1=(c1+1)*CELL,pts=todos.filter(p=>p.t>=t0-2*CELL-1e-6&&p.t<=t1+2*CELL+1e-6);
   const dentro=pts.filter(p=>p.t>=t0-1e-6&&p.t<=t1+1e-6);if(!dentro.length&&!pts.length){}
   // (una punta, si la calle sigue más allá de su primer o último cruce por más de su propio ancho: en una T, la calle
   // empieza en el borde de la otra —a medio ancho de su eje— y eso no es una punta)
   // (las puntas se crean sólo si va a haber un tramo: un pedacito sin cruces dejaba un nodo suelto)
   const ini=!pts.length||pts[0].t-t0>ancho,fin=!pts.length?t1-t0>2*ancho:pts.at(-1).t<t1-ancho;if(pts.length+(ini?1:0)+(fin?1:0)<2)continue;
   if(ini){const t=t0+ancho/2,p=P(t);pts.unshift({t,nd:nodo(p.x,p.z,0,'punta')});}
   if(fin){const t=t1-ancho/2,p=P(t);pts.push({t,nd:nodo(p.x,p.z,0,'punta')});}
   for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i];if(a.nd===b.nd)continue;const camino=[{x:a.nd.x,z:a.nd.z,h:0}];
    for(let t=Math.floor(a.t/CELL)*CELL+CELL/2;t<b.t;t+=CELL){if(t<=a.t)continue;const p=P(t);if(p.x==null||p.z==null)continue;const u=camino.at(-1);if(Math.hypot(p.x-u.x,p.z-u.z)>1e-6)camino.push(p);}
    camino.push({x:b.nd.x,z:b.nd.z,h:0});
    const limpio=[camino[0]];for(let k=1;k<camino.length-1;k++){const o=limpio.at(-1),p=camino[k],q=camino[k+1];if(Math.abs((p.x-o.x)*(q.z-o.z)-(p.z-o.z)*(q.x-o.x))>1e-6)limpio.push(p);}limpio.push(camino.at(-1));
    une(a.nd,b.nd,{ancho,av:L.av,puntos:limpio,origen:'ciudad:'+L.l.name});}}}
 // ---- el monte: cada cadena de la grilla (con sus alturas); la que sale del muro se engancha a su nodo de salida ----
 const salidas=new Map([...nodos.values()].filter(v=>v.salida).map(v=>[v.salida,v]));
 for(const c of I?.carreteras||[]){if(c.tipo!=='grilla'||!c.puntos?.length)continue;const p0=c.puntos[0],p1=c.puntos.at(-1),av=(c.ancho||12)>=CALLE.avenida.casillas*CELL;
  let a=nodo(p0.x,p0.z,p0.h,'monte'),b=nodo(p1.x,p1.z,p1.h,'monte');
  if(c.desde){const s=salidas.get(c.desde.join(','));if(s)une(s,a,{ancho:c.ancho||12,av,origen:'salida'});}
  une(a,b,{ancho:c.ancho||12,av,puntos:c.puntos.map(p=>({x:p.x,z:p.z,h:p.h})),origen:'monte'});}
 // ---- la geometría de cada carril: a la derecha del sentido (por la derecha), a carril/2 del eje (y 1,5·carril el 2º) ----
 const carriles=[];
 for(const [ti,t] of tramos.entries())for(const sentido of [1,-1]){const P=sentido>0?t.puntos:[...t.puntos].reverse();
  for(let k=0;k<t.carriles;k++){const off=C.vehiculo.carril*(k+.5),pts=P.map((p,i)=>{const q=P[Math.min(i+1,P.length-1)],o=P[Math.max(i-1,0)],dx=q.x-o.x,dz=q.z-o.z,L=Math.hypot(dx,dz)||1;return {x:p.x-dz/L*off,z:p.z+dx/L*off,h:p.h};});
   carriles.push({tramo:ti,sentido,k,velocidad:t.velocidad,puntos:pts});}}
 return {nodos:[...nodos.values()],tramos,carriles};}

// El cuerpo de una casa del monte (sin el porche ni el jardín del frente: ahí se camina hasta la puerta): {x0,x1,z0,z1}
// y la puerta, en el medio de su frente.
export function cuerpoCasa(h){const Pl=h.spec?.hogar,Wc=Pl?.W??h.w,D=Pl?.D??h.d,dF=D-h.d/2,f=h.frente,v=f==='N'||f==='S';
 const cx=h.x+(f==='E'?dF-D/2:f==='W'?-(dF-D/2):0),cz=h.z+(f==='S'?dF-D/2:f==='N'?-(dF-D/2):0),w=v?Wc:D,d=v?D:Wc;
 return {x0:cx-w/2,x1:cx+w/2,z0:cz-d/2,z1:cz+d/2,puerta:{x:h.x+(f==='E'?dF:f==='W'?-dF:0),z:h.z+(f==='S'?dF:f==='N'?-dF:0)},afuera:{x:f==='E'?1:f==='W'?-1:0,z:f==='S'?1:f==='N'?-1:0}};}

// ======== Peatones: la grilla de navegación ========
// Cada celda de C.peaton.celda: su altura (la del suelo donde se para) y si se puede estar ahí (libre de obstáculos,
// inflados por el radio del personaje). Se pasa de una celda a la vecina si el desnivel cabe en un escalón o en la
// pendiente máxima. Se camina por todas partes: calzada, veredas, pasto, playa, agua baja, monte; no por edificios, casas,
// el muro de la ciudad (salvo por sus salidas), el agua honda, el acantilado, troncos y mobiliario.
export function grillaPeatonal(bp){const m=bp.map,I=bp.isla,{W,H}=m,K=City.K,Wm=W*CELL,Hm=H*CELL,R=C.peaton.radio,c=C.peaton.celda;
 const b=I.bounds,X0=b.x0*CELL,Z0=b.y0*CELL,nx=Math.ceil(((b.x1+1)*CELL-X0)/c),nz=Math.ceil(((b.y1+1)*CELL-Z0)/c);
 const T=islaDe(m);T.setMascara(mascaraRebaje(I.huella||[]));
 const alto=new Float32Array(nx*nz),libre=new Uint8Array(nx*nz);
 const celdas=new Map(I.cells.map(q=>[q.x+','+q.y,q])),at=(x,z)=>celdas.get(Math.floor(x/CELL)+','+Math.floor(z/CELL));
 const salidas=new Set((I.gates||[]).filter(g=>g.calle).flatMap(g=>g.cells||[[g.x,g.y]]).map(([x,y])=>x+','+y));
 // la altura de las calles y la escalinata del monte: la del punto más cercano de su eje
 const ejes=(I.carreteras||[]).filter(q=>q.puntos).flatMap(q=>q.puntos.slice(1).map((p,i)=>({a:q.puntos[i],b:p,an:(q.ancho||12)/2+.5})));
 const altoCalle=(x,z)=>{let best=null,bd=1e9;for(const {a,b,an} of ejes){if(x<Math.min(a.x,b.x)-an||x>Math.max(a.x,b.x)+an||z<Math.min(a.z,b.z)-an||z>Math.max(a.z,b.z)+an)continue;const dx=b.x-a.x,dz=b.z-a.z,L2=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/L2)),d=Math.hypot(x-a.x-t*dx,z-a.z-t*dz);if(d<bd){bd=d;best=a.h+(b.h-a.h)*t;}}return best;};
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const x=X0+(i+.5)*c,z=Z0+(j+.5)*c,k=j*nx+i;
  if(x>=0&&z>=0&&x<Wm&&z<Hm){const cx=Math.floor(x/CELL),cy=Math.floor(z/CELL),kd=m.kind[cy*W+cx];alto[k]=0;libre[k]=kd===K.border&&!salidas.has(cx+','+cy)?0:1;continue;}
  const q=at(x,z);if(!q||q.zona==='vacio'||q.zona==='agua_honda'||T.beyond(x,z)>0){libre[k]=0;continue;}
  libre[k]=1;if(q.carretera||q.escalinata){const h=altoCalle(x,z);alto[k]=h??T.height(x,z);}else if(q.terraza!=null&&(q.lote||q.mirador))alto[k]=q.terraza;else alto[k]=T.height(x,z);}
 // los pasajes peatonales del monte: se caminan, y su escalera sube el muro de contención (centrada en él, a lo largo de
 // su largo; el resto del pasaje, a la altura de cada mitad)
 for(const pj of I.grilla?.pasajes||[]){const [x0,x1,z0,z1]=pj.vert?[pj.u0,pj.u1,pj.d0,pj.d1]:[pj.d0,pj.d1,pj.u0,pj.u1];
  for(let j=Math.max(0,Math.floor((z0-Z0)/c));j<=Math.min(nz-1,Math.floor((z1-Z0)/c));j++)for(let i=Math.max(0,Math.floor((x0-X0)/c));i<=Math.min(nx-1,Math.floor((x1-X0)/c));i++){
   const x=X0+(i+.5)*c,z=Z0+(j+.5)*c;if(x<x0||x>x1||z<z0||z>z1)continue;const d=pj.vert?z:x,t=Math.max(0,Math.min(1,(d-(pj.muro-pj.largo/2))/Math.max(pj.largo,1e-6)));
   alto[j*nx+i]=pj.hA+(pj.hB-pj.hA)*t;libre[j*nx+i]=1;}}
 // los obstáculos, inflados por el radio del personaje
 const marca=(x0,z0,x1,z1)=>{const i0=Math.max(0,Math.floor((x0-R-X0)/c)),i1=Math.min(nx-1,Math.floor((x1+R-X0)/c)),j0=Math.max(0,Math.floor((z0-R-Z0)/c)),j1=Math.min(nz-1,Math.floor((z1+R-Z0)/c));
  for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++)libre[j*nx+i]=0;};
 const disco=(x,z,r)=>{const rr=r+R,i0=Math.max(0,Math.floor((x-rr-X0)/c)),i1=Math.min(nx-1,Math.floor((x+rr-X0)/c)),j0=Math.max(0,Math.floor((z-rr-Z0)/c)),j1=Math.min(nz-1,Math.floor((z+rr-Z0)/c));
  for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++)if(Math.hypot(X0+(i+.5)*c-x,Z0+(j+.5)*c-z)<rr)libre[j*nx+i]=0;};
 const caja=(o)=>{const ca=Math.abs(Math.cos(o.ang||0)),sa=Math.abs(Math.sin(o.ang||0)),hw=(o.largo*ca+o.fondo*sa)/2,hd=(o.largo*sa+o.fondo*ca)/2;marca(o.x-hw,o.z-hd,o.x+hw,o.z+hd);};
 for(const L of bp.lots)for(const p of L.parts)marca(p.x,p.y,p.x+p.w,p.y+p.h);
 for(const L of I.lots||[])for(const p of L.parts||[])marca(p.x,p.y,p.x+p.w,p.y+p.h);
 for(const h of I.casas||[]){const b=cuerpoCasa(h);marca(b.x0,b.z0,b.x1,b.z1);}// (el cuerpo: el porche y el jardín del frente se caminan)
 for(const q of m.remates||[])disco((q.x+.5)*CELL,(q.y+.5)*CELL,2.5);// (el remate: una isla de 5 m en su casilla)
 for(const a of [...(bp.vegetacion?.arboles||[]),...(bp.vegetacion?.palmeras||[])])disco(a.x,a.z,.25);// (el tronco)
 for(const o of bp.equipamiento||[]){if(o.tipo==='cebra')continue;if(o.largo)caja(o);else disco(o.x,o.z,o.tipo==='papelera'?.25:.15);}
 const paso=(k1,k2,d)=>libre[k1]&&libre[k2]&&Math.abs(alto[k1]-alto[k2])<=Math.max(C.peaton.escalon,Math.tan(C.peaton.pendiente*Math.PI/180)*d);
 const idx=(x,z)=>{const i=Math.floor((x-X0)/c),j=Math.floor((z-Z0)/c);return i<0||j<0||i>=nx||j>=nz?-1:j*nx+i;};
 return {X0,Z0,nx,nz,celda:c,alto,libre,paso,idx};}

// La altura del suelo en (x, z) fuera de la ciudad, como la ve la grilla peatonal: la terraza de un lote o un mirador, la
// calle o la escalinata por su eje, o el terreno. null adentro de la ciudad (plana) o fuera de la isla. (2026-10-16: para
// que un objeto de base plana —una banca, un kiosco— se ponga donde el suelo está parejo bajo sus esquinas)
export function altoSuelo(bp){const m=bp.map,I=bp.isla,{W,H}=m,Wm=W*CELL,Hm=H*CELL;const T=islaDe(m);T.setMascara(mascaraRebaje(I.huella||[]));
 const celdas=new Map(I.cells.map(q=>[q.x+','+q.y,q])),at=(x,z)=>celdas.get(Math.floor(x/CELL)+','+Math.floor(z/CELL));
 const ejes=(I.carreteras||[]).filter(q=>q.puntos).flatMap(q=>q.puntos.slice(1).map((p,i)=>({a:q.puntos[i],b:p,an:(q.ancho||12)/2+.5})));
 const altoCalle=(x,z)=>{let best=null,bd=1e9;for(const {a,b,an} of ejes){if(x<Math.min(a.x,b.x)-an||x>Math.max(a.x,b.x)+an||z<Math.min(a.z,b.z)-an||z>Math.max(a.z,b.z)+an)continue;const dx=b.x-a.x,dz=b.z-a.z,L2=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/L2)),d=Math.hypot(x-a.x-t*dx,z-a.z-t*dz);if(d<bd){bd=d;best=a.h+(b.h-a.h)*t;}}return best;};
 return (x,z)=>{if(x>=0&&z>=0&&x<Wm&&z<Hm)return null;const q=at(x,z);if(!q)return null;if(q.carretera||q.escalinata){const h=altoCalle(x,z);return h??T.height(x,z);}if(q.terraza!=null&&(q.lote||q.mirador))return q.terraza;return T.height(x,z);};}

// Distancias caminando desde un punto (Dijkstra en 8 vecinos sobre la grilla peatonal): Float32Array, Infinity si no se llega.
export function caminar(g,x,z){return caminarDesde(g,[[x,z]]);}
// Lo mismo desde varios puntos a la vez: la distancia al más cercano de ellos (una sola pasada).
export function caminarDesde(g,puntos){const {nx,nz,celda:c}=g,dist=new Float32Array(nx*nz).fill(Infinity),inicios=[];
 for(const [x,z] of puntos){const s=g.idx(x,z);if(s<0)continue;let s0=-1;for(let r=0;r<6&&s0<0;r++)for(let dj=-r;dj<=r&&s0<0;dj++)for(let di=-r;di<=r;di++){const k=s+dj*nx+di;if(k>=0&&k<nx*nz&&g.libre[k]){s0=k;break;}}if(s0>=0)inicios.push(s0);}
 if(!inicios.length)return dist;
 // (un montículo indexado sobre arreglos tipados: cada celda está una sola vez y baja de lugar cuando mejora su distancia;
 // con un montículo de pares —uno por mejora— una grilla de 2 millones de celdas se quedaba sin memoria)
 const N=nx*nz,heap=new Int32Array(N),pos=new Int32Array(N).fill(-1);let n=0;
 const sube=i=>{const k=heap[i],d=dist[k];while(i>0){const p=(i-1)>>1;if(dist[heap[p]]<=d)break;heap[i]=heap[p];pos[heap[i]]=i;i=p;}heap[i]=k;pos[k]=i;};
 const baja=i=>{const k=heap[i],d=dist[k];for(;;){const l=2*i+1,r=l+1;let s=i,ds=d;if(l<n&&dist[heap[l]]<ds){s=l;ds=dist[heap[l]];}if(r<n&&dist[heap[r]]<ds){s=r;}if(s===i)break;heap[i]=heap[s];pos[heap[i]]=i;i=s;}heap[i]=k;pos[k]=i;};
 const D=[[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,Math.SQRT2],[1,-1,Math.SQRT2],[-1,1,Math.SQRT2],[-1,-1,Math.SQRT2]];for(const s0 of inicios){if(dist[s0]===0)continue;dist[s0]=0;heap[n]=s0;pos[s0]=n;n++;sube(n-1);}
 while(n){const k=heap[0];pos[k]=-2;n--;if(n){heap[0]=heap[n];pos[heap[0]]=0;baja(0);}const d=dist[k],i=k%nx,j=(k-i)/nx;
  for(const [di,dj,w] of D){const ii=i+di,jj=j+dj;if(ii<0||jj<0||ii>=nx||jj>=nz)continue;const k2=jj*nx+ii;if(pos[k2]===-2)continue;const dd=d+w*c;if(dd>=dist[k2])continue;
   if(di&&dj&&!(g.libre[j*nx+ii]&&g.libre[jj*nx+i]))continue;// (en diagonal, sin cortar esquinas)
   if(!g.paso(k,k2,w*c))continue;dist[k2]=dd;if(pos[k2]<0){heap[n]=k2;pos[k2]=n;n++;sube(n-1);}else sube(pos[k2]);}}
 return dist;}
