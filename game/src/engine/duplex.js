// LOS DÚPLEX BAJO LA MANSARDA (2026-11-22, Miguel: «para este tipo de edificio, ¿vale la pena usarlo para hacer apartamentos
// dúplex aprovechando la altura? Serían los más caros» → «sí, empieza por el 2D»).
//
// La mansarda es un piso entero —MANSARDA.alto, 3 m— encima del último, con una pendiente de MANSARDA.retiro (1 m) desde
// cada borde y altura completa adentro; hasta ahora quedaba vacía. Cada departamento del último piso de un edificio con
// mansarda pasa a ser un dúplex: abajo, el departamento de siempre; arriba, la mansarda sobre su misma planta, unidos por
// una escalera privada.
//   · LA ESCALERA: recta —el caracol se quitó el mismo día: Miguel, «las escaleras en caracol son difíciles de subir»—, de
//     DUPLEX.escalera (1 × 4 m: 15 peldaños de 20 cm) o, donde no cabe, DUPLEX.corta (1 × 3 m: 12 de 25 cm), arrimada a un
//     muro de la sala —o de la sala con cocina, el estudio, el comedor; si no, de un dormitorio o el hall—, sin tapar una
//     ventana de ese muro ni de su punta alta, sin cerrar el paso de una puerta (DUPLEX.paso delante de cada una), sin pisar
//     un aparato de obra (la cocina) y con la cabeza bajo la mansarda al subir. Si no cabe, ese departamento no es dúplex.
//   · ABAJO (abrirAbajo): planta abierta —sólo el baño y el cuarto de ropas cerrados—.
//   · ARRIBA (arribaDe): un entrepiso abierto, sin cuartos, con la sala a doble altura y baranda en todo borde con un hueco. Las ventanas son las buhardillas: una por módulo de 2 m donde un cuarto da a una fachada.
// Todo en metros enteros. No cambia nada del plano de abajo más que anotar la escalera (lv.escalerasInternas); lo de
// arriba queda en L.duplex = {nivel, unidades: [{n, escalera, rooms, doors, windows, vacios, barandas, area}]}.
import {DE_OBRA} from './entrega.js';
import {alturaMansarda,pendienteEn} from './techos.js';
import {MANSARDA} from './medidas.js';
import {loteEn} from './fachada-piezas.js';
import {CELL} from './veredas.js';

export const DUPLEX={aire:2.1,cabeza:2,escalera:{ancho:1,largo:4,peldanos:15},corta:{ancho:1,largo:3,peldanos:12},cerrados:['bano','ropas'],pilar:.3,vacio:{lado:3,piso:6,max:.45},otros:['dormitorio','hall'],paso:1,cuartos:['sala_cocina','sala','estudio','comedor']};
const pisa=(a,b,t=.01)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>t&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>t;
const dentro=(a,b,t=.01)=>a.x>=b.x-t&&a.y>=b.y-t&&a.x+a.w<=b.x+b.w+t&&a.y+a.h<=b.y+b.h+t;

// ¿Qué hay del otro lado del borde de un lote en el punto (x, z)? (L.sides por el lado del rectángulo; null si es adentro)
function ladoDe(L,x,z){const r=L.rect,e=.05;if(Math.abs(z-r.y)<e)return L.sides?.N;if(Math.abs(z-r.y-r.h)<e)return L.sides?.S;if(Math.abs(x-r.x)<e)return L.sides?.W;if(Math.abs(x-r.x-r.w)<e)return L.sides?.E;return null;}
const FACHADA=new Set(['calle','avenida','patio']);

// La escalera de un departamento: el primer lugar que sirve, o null.
// (2026-11-22, Miguel: «las escaleras en caracol son difíciles de subir»: sólo rectas. Primero la de 4 m —peldaños de 20 cm—
// en la sala, después en un dormitorio o el hall; si en ningún lado cabe, la corta de 3 m —de 25 cm, la de un altillo—)
function escaleraDe(L,lv,qs){for(const E of [DUPLEX.escalera,DUPLEX.corta].filter(Boolean))for(const cuartos of [DUPLEX.cuartos,DUPLEX.otros||[]]){const r=escaleraCon(L,lv,qs,E,cuartos);if(r)return r;}return null;}
function escaleraCon(L,lv,qs,E,cuartos){const obra=(lv.furniture||[]).filter(f=>DE_OBRA.has(f.kind));
 const salas=qs.filter(q=>cuartos.includes(q.type)).sort((a,b)=>b.w*b.h-a.w*a.h);
 for(const q of salas){const cands=[];
  for(const [lado,h] of [['N',true],['S',true],['W',false],['E',false]]){const largo=h?q.w:q.h,ancho=h?q.h:q.w;if(largo<E.largo-1e-6||ancho<E.ancho+2-1e-6)continue;
   const fija=lado==='N'?q.y:lado==='S'?q.y+q.h:lado==='W'?q.x:q.x+q.w,fachada=FACHADA.has(ladoDe(L,h?q.x+q.w/2:fija,h?fija:q.y+q.h/2));
   // (¿ese borde es un muro o un vano abierto de la planta abierta? Arrimada a un muro, mejor)
   const abierto=(lv.doors||[]).some(d=>d.wide&&(h?Math.abs(d.y0-fija)<.05&&Math.abs(d.y1-fija)<.05:Math.abs(d.x0-fija)<.05&&Math.abs(d.x1-fija)<.05));
   for(let t=0;t+E.largo<=largo+1e-6;t++){const r=h?{x:q.x+t,y:lado==='N'?q.y:q.y+q.h-E.ancho,w:E.largo,h:E.ancho}:{x:lado==='W'?q.x:q.x+q.w-E.ancho,y:q.y+t,w:E.ancho,h:E.largo};cands.push({r,lado,h,fachada,abierto});}}
  cands.sort((a,b)=>a.abierto-b.abierto||a.fachada-b.fachada);
  for(const c of cands){const {r,h}=c;
   // (ningún paso de puerta; ningún aparato de obra)
   // (las ventanas en sus bordes: N, S, W, E. Ninguna en el muro que tapa ni en la punta de arriba; en la punta del pie, sí
   // —2026-11-22, al dejar sólo la recta: el primer metro sube 75 cm y no llega al antepecho—, salvo la que puede ser balcón)
   // (2026-11-22, Miguel, con una captura: «la escalera debería estar al revés, no desde el balcón»: en la punta del pie no
   // va la ventana del módulo del medio de una casilla —ahí la fachada pone el balcón, fachada-piezas balconyAt—)
   const medio=w=>{const c=Math.abs(w.y0-w.y1)<1e-6?(w.x0+w.x1)/2:(w.y0+w.y1)/2,o=c-(Math.floor(c/CELL)+.5)*CELL;return Math.round(o/2)===0;},conBalcon=new Set();
   const bordes=new Set();for(const w of lv.windows||[]){const wh=Math.abs(w.y0-w.y1)<1e-6,at=wh?w.y0:w.x0,toca=[];
    if(wh){if(Math.min(Math.max(w.x0,w.x1),r.x+r.w)-Math.max(Math.min(w.x0,w.x1),r.x)<=.05)continue;if(Math.abs(at-r.y)<.05)toca.push('N');if(Math.abs(at-r.y-r.h)<.05)toca.push('S');}
    else{if(Math.min(Math.max(w.y0,w.y1),r.y+r.h)-Math.max(Math.min(w.y0,w.y1),r.y)<=.05)continue;if(Math.abs(at-r.x)<.05)toca.push('W');if(Math.abs(at-r.x-r.w)<.05)toca.push('E');}
    for(const b of toca){bordes.add(b);if(medio(w))conBalcon.add(b);}}
   const bordePie=p=>h?(Math.abs(p[0]-r.x)<.05?'W':'E'):(Math.abs(p[1]-r.y)<.05?'N':'S'),ventanasBien=p=>[...bordes].every(b=>b===bordePie(p))&&!conBalcon.has(bordePie(p));
   const puerta=(lv.doors||[]).some(d=>{const dh=Math.abs(d.y0-d.y1)<1e-6,x0=Math.min(d.x0,d.x1),x1=Math.max(d.x0,d.x1),y0=Math.min(d.y0,d.y1),y1=Math.max(d.y0,d.y1),P=DUPLEX.paso;
    // (un vano abierto de la planta abierta: la escalera puede arrimarse, pero tiene que quedar 1 m libre para pasar)
    if(d.wide){const z=dh?{x:x0,y:y0-.5,w:x1-x0,h:1}:{x:x0-.5,y:y0,w:1,h:y1-y0};if(!pisa(z,r))return false;const tapa=dh?Math.min(x1,r.x+r.w)-Math.max(x0,r.x):Math.min(y1,r.y+r.h)-Math.max(y0,r.y);return (dh?x1-x0:y1-y0)-tapa<1-1e-6;}
    const zona=dh?{x:x0-.2,y:y0-P,w:x1-x0+.4,h:2*P}:{x:x0-P,y:y0-.2,w:2*P,h:y1-y0+.4};return pisa(zona,r);});
   if(puerta)continue;if(obra.some(f=>pisa(f,r)))continue;
   // (2026-11-22, al subirla en 3D: arriba la mansarda baja a 0 en cada borde con pendiente —techos.js—, y una escalera
   // arrimada a la fachada llegaba donde no cabe una cabeza —una recta del lote 55 terminaba contra el muro—. Toda la
   // escalera, a DUPLEX.aire de altura libre o más —en metros enteros, a 1 m de la pendiente—; y la llegada —medio metro más
   // allá de la punta de arriba— adentro del departamento y con esa misma altura)
   const libre=(x,z)=>!L.mansarda||alturaMansarda(L.mansarda,x,z)>=DUPLEX.aire-1e-6,enUnidad=(x,z)=>qs.some(o=>x>o.x+.01&&x<o.x+o.w-.01&&z>o.y+.01&&z<o.y+o.h-.01);
   const llegaBien=(p,d)=>{const x=p[0]+d[0]*.5,z=p[1]+d[1]*.5;return enUnidad(x,z)&&libre(x,z);};
   // (la cabeza al subir: en cada punto de la escalera, a su altura h —de 0 a 3 m— más DUPLEX.cabeza, el techo de arriba
   // —la mansarda, 3 m más su pendiente— tiene que alcanzar; así una escalera que arranca en la fachada y sube hacia adentro
   // cabe, y una arrimada a la fachada no. Se mira el eje y los dos bordes, de a 25 cm)
   const cabe=(pie,lleg)=>{const n=16;for(let i=0;i<=n;i++){const t=i/n,h=MANSARDA.alto*t,x=pie[0]+(lleg[0]-pie[0])*t,z=pie[1]+(lleg[1]-pie[1])*t,lat=Math.abs(lleg[0]-pie[0])>Math.abs(lleg[1]-pie[1])?[0,1]:[1,0];
     for(const o of [-.4,0,.4]){const a=L.mansarda?alturaMansarda(L.mansarda,x+lat[0]*o,z+lat[1]*o):MANSARDA.alto;if(MANSARDA.alto+a<h+DUPLEX.cabeza-1e-6)return false;}}return true;};
   // (sube a lo largo del muro; la llegada, en la punta que queda más lejos del centro del cuarto en el otro eje no importa:
   // se sube hacia la punta más lejana de la puerta más cercana)
   const ds=(lv.doors||[]).filter(d=>d.a===q.id||d.b===q.id).map(d=>[(d.x0+d.x1)/2,(d.y0+d.y1)/2]),p0=h?[r.x,r.y+r.h/2]:[r.x+r.w/2,r.y],p1=h?[r.x+r.w,r.y+r.h/2]:[r.x+r.w/2,r.y+r.h];
   const lejos=p=>ds.length?Math.min(...ds.map(d=>Math.hypot(d[0]-p[0],d[1]-p[1]))):0;let [pie,llegada]=lejos(p0)<=lejos(p1)?[p0,p1]:[p1,p0];
   const dir=(a,b)=>{const l=Math.hypot(b[0]-a[0],b[1]-a[1]);return [(b[0]-a[0])/l,(b[1]-a[1])/l];};
   const sirve=(p,l)=>llegaBien(l,dir(p,l))&&cabe(p,l)&&ventanasBien(p);
   if(!sirve(pie,llegada)){if(!sirve(llegada,pie))continue;[pie,llegada]=[llegada,pie];}
   return {...r,tipo:'recta',eje:h?'x':'z',pie,llegada,cuarto:q.id,peldanos:E.peldanos};}}
 return null;}

// LO DE ARRIBA de un departamento U (su rectángulo) con su escalera: un entrepiso abierto sobre toda la planta, sin cuartos
// (2026-11-22, Miguel: «que el piso dos del dúplex no tenga cuartos»; antes llevaba un dormitorio y un baño en las puntas).
// El vacío de la sala a doble altura y las barandas los pone vacioYBarandas.
function arribaDe(L,U,esc,n,esquina=()=>false){const rooms=[{id:0,type:'entrepiso',abierto:true,...U,unit:n}],doors=[],windows=[];
 // las buhardillas: una por módulo de 2 m entero en cada borde de un cuarto de arriba que da a una fachada (el baño, ciego),
 // menos en la punta de una esquina, donde el 3D pone la pieza de esquina de la mansarda, que no tiene ventana, y donde no
 // hay pendiente —contra un vecino más alto: muro derecho hasta la cubierta—
 for(const q of rooms){if(q.type==='bano')continue;for(const [h,fija,a0,a1] of [[true,q.y,q.x,q.x+q.w],[true,q.y+q.h,q.x,q.x+q.w],[false,q.x,q.y,q.y+q.h],[false,q.x+q.w,q.y,q.y+q.h]]){
  for(let m=Math.ceil(a0/2-1e-6)*2;m+2<=a1+1e-6;m+=2){const x=h?m+1:fija,z=h?fija:m+1;if(!FACHADA.has(ladoDe(L,x,z))||!pendienteEn(L.mansarda,x,z)||esquina(x,z))continue;windows.push(h?{x0:m+.4,y0:fija,x1:m+1.6,y1:fija,buhardilla:true,a:q.id}:{x0:fija,y0:m+.4,x1:fija,y1:m+1.6,buhardilla:true,a:q.id});}}}
 return {rooms,doors,windows,area:rooms.reduce((s,q)=>s+q.w*q.h,0)};}

// ABAJO, LA PLANTA ABIERTA (2026-11-22, Miguel, con una captura de la escalera entre tabiques: «elimina paredes y reordena
// los apartamentos dúplex, porque no le veo sentido»; la foto que mandó antes: abajo la sala abierta con la escalera
// arrimada a un muro, arriba el entrepiso). En el último piso del dúplex sólo quedan cerrados el baño y el cuarto de ropas
// (DUPLEX.cerrados); entre los demás cuartos del departamento, cada pared que comparten es un vano abierto de punta a punta
// —menos DUPLEX.pilar en cada una—
// —town3d lo dibuja sin muro, hasta el techo—, y los dormitorios de abajo pasan a ser comedor o sala. Devuelve cómo
// deshacerlo (si después no cabe la escalera).
function abrirAbajo(lv,qs){const antes={doors:lv.doors,furniture:lv.furniture,tipos:qs.map(q=>[q,q.type])},abiertos=qs.filter(q=>!DUPLEX.cerrados.includes(q.type)),ids=new Set(abiertos.map(q=>q.id));
 let comedor=qs.some(q=>q.type==='comedor');
 for(const q of abiertos)if(q.type==='dormitorio'){q.type=comedor?'sala':'comedor';comedor=true;}
 for(const q of abiertos)q.abierto=true;// (parte de la planta abierta; sus muebles, cuando vuelvan los muebles)
 // (las puertas entre dos abiertos se van; en su lugar, el vano de todo lo que comparten)
 const doors=lv.doors.filter(d=>!(ids.has(d.a)&&ids.has(d.b)));
 for(let i=0;i<abiertos.length;i++)for(let j=i+1;j<abiertos.length;j++){const a=abiertos[i],b=abiertos[j];
  for(const [h,fa,fb,a0,a1,b0,b1] of [[true,a.y+a.h,b.y,a.x,a.x+a.w,b.x,b.x+b.w],[true,b.y+b.h,a.y,a.x,a.x+a.w,b.x,b.x+b.w],[false,a.x+a.w,b.x,a.y,a.y+a.h,b.y,b.y+b.h],[false,b.x+b.w,a.x,a.y,a.y+a.h,b.y,b.y+b.h]]){
   // (30 cm de muro en cada punta —DUPLEX.pilar—: el vano no se mete en la fachada ni en el tabique de al lado)
   if(Math.abs(fa-fb)>.05)continue;const p=Math.max(a0,b0)+DUPLEX.pilar,q=Math.min(a1,b1)-DUPLEX.pilar;if(q-p<1.3)continue;
   doors.push(h?{x0:p,y0:fa,x1:q,y1:fa,a:a.id,b:b.id,wide:true,hoja:false,abierta:true}:{x0:fa,y0:p,x1:fa,y1:q,a:a.id,b:b.id,wide:true,hoja:false,abierta:true});}}
 lv.doors=doors;
 // (los muebles de los que eran dormitorios —la cama, el armario— se van; los de obra quedan)
 const eran=new Set(antes.tipos.filter(([q,t])=>t==='dormitorio').map(([q])=>q.id));
 lv.furniture=(lv.furniture||[]).filter(f=>DE_OBRA.has(f.kind)||!qs.some(q=>eran.has(q.id)&&f.x>=q.x-.01&&f.y>=q.y-.01&&f.x+f.w<=q.x+q.w+.01&&f.y+f.h<=q.y+q.h+.01));
 return {deshacer:()=>{lv.doors=antes.doors;lv.furniture=antes.furniture;for(const [q,t] of antes.tipos){q.type=t;delete q.abierto;}}};}

// LA SALA A DOBLE ALTURA (2026-11-22, Miguel: «aprovechar el dúplex para un diseño más bonito: que la sala sea de dos pisos,
// que aproveche la altura y se vea desde abajo la parte de arriba con barandas»). Arriba, sobre lo abierto de abajo, un
// vacío: el rectángulo más grande —de DUPLEX.vacio.lado por lado o más, y a lo sumo DUPLEX.vacio.max de lo abierto de arriba,
// para que el entrepiso siga siendo un piso— que cae sobre cuartos abiertos de abajo (nunca sobre
// el baño), no pisa la escalera, su llegada ni los cuartos de arriba, y deja el piso de arriba de una pieza: de la llegada se
// sigue caminando a cada puerta y a todo lo abierto, con DUPLEX.vacio.piso m² o más. Todo en una grilla de 1 m (los cuartos
// están en metros enteros). La baranda va en cada borde entre el piso de arriba y un hueco —el vacío o la escalera—, menos
// la llegada; contra un muro —el borde del departamento, un cuarto de arriba— no hace falta.
function vacioYBarandas(lv,qs,U,esc,arriba){const V=DUPLEX.vacio,W=Math.round(U.w),H=Math.round(U.h),k=(x,y)=>y*W+x,cel=new Array(W*H).fill('piso');
 const en=(r,x,y)=>x+.5>r.x&&x+.5<r.x+r.w&&y+.5>r.y&&y+.5<r.y+r.h,X=x=>Math.round(x-U.x),Y=y=>Math.round(y-U.y);
 const A=arriba.rooms[0],abajo=(x,y)=>qs.find(q=>en(q,U.x+x,U.y+y));
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const px=U.x+x,py=U.y+y;if(en(esc,px,py))cel[k(x,y)]='hueco';else if(!en(A,px,py))cel[k(x,y)]='cuarto';}
 // (la llegada: la casilla después de la punta de arriba de la escalera)
 const dl=esc.eje==='x'?[Math.sign(esc.llegada[0]-esc.pie[0]),0]:[0,Math.sign(esc.llegada[1]-esc.pie[1])];
 const llegCel=esc.eje==='x'?[dl[0]>0?X(esc.x+esc.w):X(esc.x)-1,Y(esc.y)]:[X(esc.x),dl[1]>0?Y(esc.y+esc.h):Y(esc.y)-1];
 // (las casillas delante de cada puerta de arriba, del lado de lo abierto)
 const frente=arriba.doors.map(d=>{const h=Math.abs(d.y0-d.y1)<1e-6,mx=(d.x0+d.x1)/2,my=(d.y0+d.y1)/2;return h?[[X(mx-.5),Y(my-.5)],[X(mx-.5),Y(my+.5)]]:[[X(mx-.5),Y(my-.5)],[X(mx+.5),Y(my-.5)]];}).map(ps=>ps.find(([x,y])=>x>=0&&y>=0&&x<W&&y<H&&cel[k(x,y)]==='piso')).filter(Boolean);
 const deUnaPieza=c=>{const piso=[];for(let i=0;i<c.length;i++)if(c[i]==='piso')piso.push(i);if(piso.length<V.piso)return false;const ini=k(...llegCel);if(c[ini]!=='piso')return false;
  const vis=new Set([ini]),cola=[ini];while(cola.length){const i=cola.pop(),x=i%W,y=(i-x)/W;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=W||ny>=H)continue;const j=k(nx,ny);if(c[j]==='piso'&&!vis.has(j)){vis.add(j);cola.push(j);}}}
  return vis.size===piso.length&&frente.every(([x,y])=>vis.has(k(x,y)));};
 let mejor=null;
 for(let y0=0;y0<H;y0++)for(let x0=0;x0<W;x0++)for(let y1=y0+V.lado;y1<=H;y1++)for(let x1=x0+V.lado;x1<=W;x1++){
  let ok=true;for(let y=y0;y<y1&&ok;y++)for(let x=x0;x<x1&&ok;x++){const q=abajo(x,y);if(cel[k(x,y)]!=='piso'||!q||!q.abierto||(x===llegCel[0]&&y===llegCel[1]))ok=false;}if(!ok)continue;
  const area=(x1-x0)*(y1-y0);if(area>V.max*A.w*A.h+1e-6||(mejor&&area<mejor.area))continue;
  // (de dos iguales, el que más cae sobre la sala —el cuarto abierto más grande de abajo—)
  const c=cel.slice();for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)c[k(x,y)]='vacio';if(!deUnaPieza(c))continue;
  const sala=[...qs].filter(q=>q.abierto).sort((a,b)=>b.w*b.h-a.w*a.h)[0],sobreSala=sala?Math.max(0,Math.min(x1,X(sala.x+sala.w))-Math.max(x0,X(sala.x)))*Math.max(0,Math.min(y1,Y(sala.y+sala.h))-Math.max(y0,Y(sala.y))):0;
  if(!mejor||area>mejor.area||sobreSala>mejor.sobreSala)mejor={x0,y0,x1,y1,area,sobreSala,c};}
 if(mejor)for(let i=0;i<cel.length;i++)cel[i]=mejor.c[i];
 const vacios=mejor?[{x:U.x+mejor.x0,y:U.y+mejor.y0,w:mejor.x1-mejor.x0,h:mejor.y1-mejor.y0}]:[];
 // las barandas: cada borde de casilla entre el piso y un hueco, menos la llegada; juntas las de una misma línea
 const segs=[],abre=t=>t==='hueco'||t==='vacio';
 for(let y=0;y<H;y++)for(let x=0;x<W;x++)for(const [dx,dy] of [[1,0],[0,1]]){const nx=x+dx,ny=y+dy;if(nx>=W||ny>=H)continue;const a=cel[k(x,y)],b=cel[k(nx,ny)];
  if(!((abre(a)&&b==='piso')||(abre(b)&&a==='piso')))continue;
  const pisoEn=a==='piso'?[x,y]:[nx,ny];if(pisoEn[0]===llegCel[0]&&pisoEn[1]===llegCel[1]&&(a==='hueco'||b==='hueco'))continue;
  segs.push(dx?{x0:U.x+nx,y0:U.y+y,x1:U.x+nx,y1:U.y+y+1}:{x0:U.x+x,y0:U.y+ny,x1:U.x+x+1,y1:U.y+ny});}
 const barandas=[];for(const s of segs.sort((a,b)=>a.x0-b.x0||a.y0-b.y0)){const v=s.x0===s.x1,u=barandas.find(b=>(b.x0===b.x1)===v&&(v?b.x0===s.x0&&b.y1===s.y0:b.y0===s.y0&&b.x1===s.x0));if(u){u.x1=s.x1;u.y1=s.y1;}else barandas.push({...s});}
 return {vacios,barandas};}

// ¿El módulo de fachada con centro (x, z) en el borde de L es la punta de una esquina? La misma cuenta que town3d: el módulo
// k (0, 1, 2) de su casilla de CELL m a lo largo de la fachada; en una punta (k 0 o 2), si la casilla siguiente a lo largo
// no es de ningún lote, ahí va la pieza de esquina de la mansarda (Roof_SlateCornice_Corner), sin ventana.
function esquinaDe(bp,L){const de=loteEn(bp),r=L.rect,W=bp.map.W,H=bp.map.H,lote=(x,y)=>x>=0&&y>=0&&x<W&&y<H?de(x,y):-1;
 return (x,z)=>{const n=Math.abs(z-r.y)<.05?[0,-1]:Math.abs(z-r.y-r.h)<.05?[0,1]:Math.abs(x-r.x)<.05?[-1,0]:[1,0],cx=Math.floor((x-n[0]*.1)/CELL),cy=Math.floor((z-n[1]*.1)/CELL),t=[n[1],-n[0]];
  const o=(x-(cx+.5)*CELL)*t[0]+(z-(cy+.5)*CELL)*t[1],k=Math.round(o/2)+1,endS=k===0?-1:k===2?1:0;return !!endS&&lote(cx+t[0]*endS,cy+t[1]*endS)<0;};}

export function duplexDe(bp){let n=0,no=0;
 for(const L of bp.lots){delete L.duplex;if(!L.mansarda||(L.floors||0)<2)continue;const top=L.levels[L.floors-1];if(!top?.units?.length)continue;delete top.escalerasInternas;
  const unidades=[];
  for(const u of top.units){const qs=top.rooms.filter(q=>q.unit===u.n),U={x:u.x,y:u.y,w:u.w,h:u.h};if(!qs.length)continue;
   const ab=abrirAbajo(top,qs),esc=escaleraDe(L,top,qs);if(!esc){ab.deshacer();no++;continue;}
   const arriba=arribaDe(L,U,esc,u.n,esquinaDe(bp,L));
   // (la escalera llega a lo abierto: su hueco, adentro de él)
   if(!dentro(esc,arriba.rooms[0])){ab.deshacer();no++;continue;}
   const vb=vacioYBarandas(top,qs,U,esc,arriba);arriba.area-=vb.vacios.reduce((t,v)=>t+v.w*v.h,0);
   // (sobre el vacío de la doble altura no hay buhardilla: no hay piso desde donde asomarse, y desde abajo se veía por dentro)
   arriba.windows=arriba.windows.filter(w=>!vb.vacios.some(v=>{const x=(w.x0+w.x1)/2,z=(w.y0+w.y1)/2;return x>v.x-.05&&x<v.x+v.w+.05&&z>v.y-.05&&z<v.y+v.h+.05;}));
   (top.escalerasInternas||(top.escalerasInternas=[])).push({...esc,unit:u.n});unidades.push({n:u.n,escalera:esc,...arriba,...vb});n++;}
  if(unidades.length)L.duplex={nivel:L.floors,unidades};}
 return {duplex:n,sinLugar:no};}

// El nivel de la mansarda como un piso más (para dibujarlo y medirlo igual que los demás): los cuartos de todos los dúplex
// del edificio con su número de unidad, sus puertas y buhardillas, y los huecos de sus escaleras.
export function nivelMansarda(L){if(!L?.duplex)return null;const rooms=[],doors=[],windows=[],units=[],huecos=[],barandas=[],vacios=[];
 for(const u of L.duplex.unidades){const off=rooms.length;for(const q of u.rooms)rooms.push({...q,id:off+q.id});
  for(const d of u.doors)doors.push({...d,a:off+d.a,b:off+d.b});for(const w of u.windows)windows.push({...w,a:off+(w.a||0)});
  const xs=u.rooms.flatMap(q=>[q.x,q.x+q.w]),ys=u.rooms.flatMap(q=>[q.y,q.y+q.h]);units.push({n:u.n,x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)});
  huecos.push({...u.escalera,unit:u.n});for(const b of u.barandas||[])barandas.push({...b,unit:u.n});for(const v of u.vacios||[])vacios.push({...v,unit:u.n});}
 return {level:L.duplex.nivel,mansarda:true,rooms,doors,windows,units,corridor:[],core:null,furniture:[],huecos,barandas,vacios};}
// El piso f de un edificio: uno de los suyos, o la mansarda de los dúplex (f = L.floors).
export const nivelDe=(L,f)=>f<(L.floors||0)?L.levels[f]:nivelMansarda(L)||L.levels[Math.min(f,(L.floors||1)-1)];
