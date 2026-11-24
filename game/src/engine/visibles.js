// ======== Qué se puede ver desde adentro (2026-10-16, Miguel: «sólo dibujar lo que se ve, empezando por el caso de
// adentro») ========
// visiblesDesde(bp, lote, nivel): los lotes (y sus manzanas) que se pueden ver estando en ese piso de ese edificio. Desde
// adentro, lo de afuera sólo se ve por una abertura —ventana, vidriera, puerta de calle—: se tiran rayos desde puntos de
// cada abertura del piso hacia todo el medio espacio de afuera (si se ve por la abertura desde algún punto del cuarto,
// se ve desde algún punto de la abertura en esa dirección: así la lista es más grande que lo necesario, nunca más chica),
// y cada rayo recorre la grilla hasta el primer edificio que lo tapa —su lote se ve—, o sube más que todo, o se va del
// mapa. Las alturas que tapan, las mínimas (los pisos por 3 m, sin mansarda ni escalinata): tapan de menos, se ve de más.
// El propio lote, siempre. Se cachea por (lote, nivel). Lo comprueba validar-visibles con rayos al azar desde adentro.
import {CELL} from './veredas.js';
import {ALTURA} from './medidas.js';
export const VISIBLES={azimut:3,elevacion:[-50,60,6],ojos:[.2,1,1.8,2.6],puntos:4,alcance:420,techo:60,fino:.75,arbol:18,vecinos:true};
// (celdas: además de los lotes, las casillas de 6 m por donde pasa algún rayo por debajo de VISIBLES.arbol —lo más alto
// de un árbol—: los árboles, faroles y bancas de ahí se ven)

const cache=new WeakMap();
export function alturasDe(bp){if(cache.has(bp))return cache.get(bp);const {W,H}=bp.map,lote=new Int32Array(W*H).fill(-1),alto=new Float32Array(W*H);
 for(const L of bp.lots)for(const p of L.parts||[])for(let y=p.y/CELL;y<(p.y+p.h)/CELL-1e-6;y++)for(let x=p.x/CELL;x<(p.x+p.w)/CELL-1e-6;x++){const i=Math.floor(y)*W+Math.floor(x);lote[i]=L.id;alto[i]=(L.levels?.length||L.floors||1)*ALTURA.piso;}
 const r={W,H,lote,alto,pvs:new Map()};cache.set(bp,r);return r;}
// Un rayo desde (x, y, z) hacia (dx, dy, dz), unitario: el lote que lo tapa primero (o −1). Recorre la grilla de 6 m
// casilla por casilla (DDA) y en cada una mira la altura más baja del rayo adentro.
rayo.celdas=[];
export function rayo(A,x,y,z,dx,dy,dz,salvo=-1,alcance=VISIBLES.alcance){const {W,H,lote,alto}=A;rayo.celdas.length=0;
 // (2026-11-23: si arranca fuera de la grilla —la cámara en el monte o en la playa, mirando la ciudad—, avanza hasta donde
 // entra; antes devolvía «nada» en el primer paso y desde afuera no se veía ningún lote)
 let t00=0;if(x<0||z<0||x>=W*CELL||z>=H*CELL){let t0=0,t1=alcance;
  for(const [p,d,L] of [[x,dx,W*CELL],[z,dz,H*CELL]]){if(Math.abs(d)<1e-12){if(p<0||p>=L)return -1;continue;}let a=(0-p)/d,b=(L-p)/d;if(a>b)[a,b]=[b,a];t0=Math.max(t0,a);t1=Math.min(t1,b);}
  if(t0>=t1)return -1;t00=t0+1e-6;x+=dx*t00;y+=dy*t00;z+=dz*t00;alcance-=t00;if(y>VISIBLES.techo&&dy>=0)return -1;}
 const r=rayoAdentro(A,x,y,z,dx,dy,dz,salvo,alcance,W,H,lote,alto);if(r>=0)rayo.t+=t00;return r;}
function rayoAdentro(A,x,y,z,dx,dy,dz,salvo,alcance,W,H,lote,alto){let cx=Math.min(W-1,Math.max(0,Math.floor(x/CELL))),cz=Math.min(H-1,Math.max(0,Math.floor(z/CELL)));
 const sx=Math.sign(dx),sz=Math.sign(dz),tdx=dx?Math.abs(CELL/dx):1e9,tdz=dz?Math.abs(CELL/dz):1e9;let tx=dx?((sx>0?(cx+1)*CELL-x:x-cx*CELL)/Math.abs(dx)):1e9,tz=dz?((sz>0?(cz+1)*CELL-z:z-cz*CELL)/Math.abs(dz)):1e9,t0=0;
 for(let n=0;n<400;n++){const t1=Math.min(tx,tz,alcance);if(cx<0||cz<0||cx>=W||cz>=H)return -1;const i=cz*W+cx,l=lote[i];if(Math.min(y+dy*t0,y+dy*t1)<VISIBLES.arbol)rayo.celdas.push(i);
  if(l>=0&&l!==salvo){const ymin=Math.min(y+dy*t0,y+dy*t1);if(ymin<alto[i]){rayo.t=t0;rayo.x=x+dx*t0;rayo.z=z+dz*t0;return l;}}
  if(y+dy*t1>VISIBLES.techo&&dy>0||t1>=alcance)return -1;t0=t1;if(tx<tz){cx+=sx;tx+=tdx;}else{cz+=sz;tz+=tdz;}}
 return -1;}
// Las aberturas de un piso: [x0,z0,x1,z1, nx,nz (hacia afuera)]
export function aberturasDe(L,lv){const out=[],dentro=(x,z)=>(L.parts||[]).some(p=>x>p.x&&x<p.x+p.w&&z>p.y&&z<p.y+p.h);
 for(const s of [...(lv.windows||[]),...(lv.doors||[]).filter(d=>d.street)]){const h=Math.abs(s.y1-s.y0)<1e-6,mx=(s.x0+s.x1)/2,mz=(s.y0+s.y1)/2;
  const nx=h?0:(dentro(mx+.3,mz)?-1:1),nz=h?(dentro(mx,mz+.3)?-1:1):0;out.push([s.x0,s.y0,s.x1,s.y1,nx,nz]);}
 return out;}
export function visiblesDesde(bp,loteId,nivel){const A=alturasDe(bp),k=loteId+':'+nivel;if(A.pvs.has(k))return A.pvs.get(k);
 // (un nivel que el edificio no tiene —la azotea— no es «desde adentro»: no se recorta nada)
 {const L0=bp.lots.find(l=>l.id===loteId);if(L0&&!L0.levels?.some(v=>v.level===nivel))return null;}
 const L=bp.lots.find(l=>l.id===loteId),lv=L?.levels?.find(l=>l.level===nivel),lotes=new Set([loteId]),celdas=new Set();
 const V=VISIBLES;
 if(lv){const y0=nivel*ALTURA.piso;
  for(const [ax,az,bx,bz,nx,nz] of aberturasDe(L,lv))for(let k2=0;k2<V.puntos;k2++){const t=(k2+.5)/V.puntos,px=ax+(bx-ax)*t+nx*.05,pz=az+(bz-az)*t+nz*.05,base=Math.atan2(nz,nx);
   for(const oj of V.ojos)abanico(A,px,y0+oj,pz,base,-88,88,V.elevacion,loteId,lotes,celdas);}}
 const r=cerrar(bp,A,lotes,celdas);A.pvs.set(k,r);return r;}

// EL ABANICO DE RAYOS (de visiblesDesde, 2026-11-23 aparte para usarlo también desde la calle): desde (px, py, pz), un rayo
// por dirección de la grilla —azimut desde `base` (rad) entre a0 y a1 grados, cada V.azimut; elevación según E =
// [desde, hasta, paso]— y, donde dos vecinos dan distinto —uno pasa por encima de un techo o por el costado y el otro pega—,
// rayos en el medio hasta V.fino grados, en los dos sentidos: lo que asoma entre los dos no se escapa. Lo que pega va a
// `lotes` (con lo que queda a su alrededor, por el hueco entre rayos), y las casillas que cruza bajo los árboles a `celdas`.
function abanico(A,px,py,pz,base,a0,a1,E,salvo,lotes,celdas,alcance=VISIBLES.alcance){const V=VISIBLES;
 const tira=(a,e)=>{const az2=base+a*Math.PI/180,el=e*Math.PI/180,c=Math.cos(el),l=rayo(A,px,py,pz,Math.cos(az2)*c,Math.sin(el),Math.sin(az2)*c,salvo,alcance);for(const ci of rayo.celdas)celdas.add(ci);if(l>=0){lotes.add(l);
   const hueco=1.5*rayo.t*Math.sin(V.fino*Math.PI/180)+2,c0=Math.floor((rayo.x-hueco)/CELL),c1=Math.floor((rayo.x+hueco)/CELL),r0=Math.floor((rayo.z-hueco)/CELL),r1=Math.floor((rayo.z+hueco)/CELL);
   for(let cz=r0;cz<=r1;cz++)for(let cx=c0;cx<=c1;cx++){if(cx<0||cz<0||cx>=A.W||cz>=A.H)continue;const m=A.lote[cz*A.W+cx];if(m>=0)lotes.add(m);}}
  return l;};
 const parteE=(a,e0,l0,e1,l1)=>{if(l0===l1||e1-e0<=V.fino)return;const em=(e0+e1)/2,lm=tira(a,em);parteE(a,e0,l0,em,lm);parteE(a,em,lm,e1,l1);};
 const parteA=(e,a0_,l0,a1_,l1)=>{if(l0===l1||a1_-a0_<=V.fino)return;const am=(a0_+a1_)/2,lm=tira(am,e);parteA(e,a0_,l0,am,lm);parteA(e,am,lm,a1_,l1);};
 const es=[];for(let e=E[0];e<=E[1];e+=E[2])es.push(e);let prev=null,ap=null;
 for(let a=a0;;a=Math.min(a1,a+V.azimut)){const fila=es.map(e=>tira(a,e));for(let k=1;k<es.length;k++)parteE(a,es[k-1],fila[k-1],es[k],fila[k]);
  if(prev)for(let k=0;k<es.length;k++)parteA(es[k],ap,prev[k],a,fila[k]);prev=fila;ap=a;if(a>=a1)break;}}
// Lo que se ve, con sus márgenes (de visiblesDesde).
function cerrar(bp,A,lotes,celdas){const V=VISIBLES;
 // (las celdas, con una de margen alrededor: el árbol de la casilla vecina asoma con su copa —y el hueco entre rayos—)
 const conMargen=new Set();for(const ci of celdas){const cx=ci%A.W,cz=(ci-cx)/A.W;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){const x=cx+dx,z=cz+dz;if(x>=0&&z>=0&&x<A.W&&z<A.H)conMargen.add(z*A.W+x);}}
 // (y los lotes que tocan una casilla que se ve: una rendija entre dos edificios, más angosta que lo que separa los puntos
 // de partida, deja ver un pedazo de lo de atrás desde un solo punto de la ventana —se escapaba un lote a 92 m—; si su
 // vereda se ve, el lote entra)
 if(V.vecinos)for(const ci of celdas){const m=A.lote[ci];if(m>=0)lotes.add(m);const cx=ci%A.W,cz=(ci-cx)/A.W;for(const [ex,ez] of [[1,0],[-1,0],[0,1],[0,-1]]){const x=cx+ex,z=cz+ez;if(x>=0&&z>=0&&x<A.W&&z<A.H){const n=A.lote[z*A.W+x];if(n>=0)lotes.add(n);}}}
 const manzanas=new Set([...lotes].map(id=>bp.lots.find(l=>l.id===id)?.block)); return {lotes,manzanas,celdas:conMargen,W:A.W,H:A.H};}

// ======== Qué se puede ver desde la CALLE (2026-11-23, Miguel: «calibrar el occlusion culling… que calcule todo sólo lo
// que tiene a la vista, más un desfase a los costados para aprovechar el movimiento de la cámara») ========
// visiblesCalle(bp, cam): los lotes que se pueden ver desde la cámara (afuera, o en el aire) en lo que abarca su ángulo de
// visión MÁS VISIBLES_CALLE.margen grados a cada lado, el mismo abanico de rayos de adentro desde el ojo de la cámara. Con
// las puertas y las ventanas cerradas la fachada es hermética: lo que está detrás de la primera fila no se ve (las alturas
// que tapan, las mínimas: se ve de más, nunca de menos). Los lotes a menos de VISIBLES_CALLE.cerca m entran siempre (la
// cámara de tercera persona, un giro brusco). cam: {x, y, z, yaw, fov (vertical, grados), aspect}; alcance: hasta dónde
// miran los rayos (m: el juego pasa la niebla —más allá no se ve nada—).
export const VISIBLES_CALLE={margen:35,cerca:14,elevacion:[-6,70,4]};
export function visiblesCalle(bp,cam,margen=VISIBLES_CALLE.margen,alcance=VISIBLES.alcance){const A=alturasDe(bp),lotes=new Set(),celdas=new Set(),C=VISIBLES_CALLE;
 const hf=Math.atan(Math.tan((cam.fov||72)*Math.PI/360)*(cam.aspect||1.6))*180/Math.PI,ancho=Math.min(180,hf+margen);
 // (three: la cámara mira hacia −z girada yaw; adelante = (−sin yaw, −cos yaw). El rayo va por (cos a, sin a) en (x, z))
 const base=Math.atan2(-Math.cos(cam.yaw),-Math.sin(cam.yaw));
 abanico(A,cam.x,cam.y,cam.z,base,-ancho,ancho,C.elevacion,-1,lotes,celdas,alcance);
 {const r=Math.ceil(C.cerca/CELL)+1,cx0=Math.floor(cam.x/CELL),cz0=Math.floor(cam.z/CELL);
  for(let cz=cz0-r;cz<=cz0+r;cz++)for(let cx=cx0-r;cx<=cx0+r;cx++){if(cx<0||cz<0||cx>=A.W||cz>=A.H)continue;const m=A.lote[cz*A.W+cx];
   if(m>=0&&Math.hypot(Math.max(cx*CELL-cam.x,0,cam.x-(cx+1)*CELL),Math.max(cz*CELL-cam.z,0,cam.z-(cz+1)*CELL))<C.cerca)lotes.add(m);}}
 return cerrar(bp,A,lotes,celdas);}
