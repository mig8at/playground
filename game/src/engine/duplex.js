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
import {LUGAR_FIJO} from './entrega.js';
import {alturaMansarda,pendienteEn} from './techos.js';
import {MANSARDA} from './medidas.js';
import {loteEn} from './fachada-piezas.js';
import {CELL} from './veredas.js';

export const DUPLEX={aire:2.1,cabeza:2,escalera:{ancho:1,largo:4,peldanos:15},corta:{ancho:1,largo:3,peldanos:12},cerrados:['bano'],cara:{fachada:.25,tabique:.07},pasoMin:1.3,penthouse:{max:450},isla:{paso:1.1,libre:1,largo:2.4,hondo:.9},ventana:'vidrio',arranque:1,vacio:{lado:3,piso:6,max:.45},otros:['dormitorio','hall'],paso:1,cuartos:['sala_cocina','sala','estudio','comedor']};
const pisa=(a,b,t=.01)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>t&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>t;
const dentro=(a,b,t=.01)=>a.x>=b.x-t&&a.y>=b.y-t&&a.x+a.w<=b.x+b.w+t&&a.y+a.h<=b.y+b.h+t;

// ¿Qué hay del otro lado del borde de un lote en el punto (x, z)? (L.sides por el lado del rectángulo; null si es adentro)
function ladoDe(L,x,z){const r=L.rect,e=.05;if(Math.abs(z-r.y)<e)return L.sides?.N;if(Math.abs(z-r.y-r.h)<e)return L.sides?.S;if(Math.abs(x-r.x)<e)return L.sides?.W;if(Math.abs(x-r.x-r.w)<e)return L.sides?.E;return null;}
const FACHADA=new Set(['calle','avenida','patio']);

// La escalera de un departamento: el primer lugar que sirve, o null.
// (2026-11-22, Miguel: «las escaleras en caracol son difíciles de subir»: sólo rectas. Primero la de 4 m —peldaños de 20 cm—
// en la sala, después en un dormitorio o el hall; si en ningún lado cabe, la corta de 3 m —de 25 cm, la de un altillo—)
function escaleraDe(L,lv,qs){for(const E of [DUPLEX.escalera,DUPLEX.corta].filter(Boolean))for(const cuartos of [DUPLEX.cuartos,DUPLEX.otros||[]]){const r=escaleraCon(L,lv,qs,E,cuartos);if(r)return r;}return null;}
function escaleraCon(L,lv,qs,E,cuartos){const UU={x:Math.min(...qs.map(q=>q.x)),y:Math.min(...qs.map(q=>q.y))};UU.w=Math.max(...qs.map(q=>q.x+q.w))-UU.x;UU.h=Math.max(...qs.map(q=>q.y+q.h))-UU.y;const obra=(lv.furniture||[]).filter(f=>LUGAR_FIJO.has(f.kind));
 const salas=qs.filter(q=>cuartos.includes(q.type)).sort((a,b)=>b.w*b.h-a.w*a.h);
 // (los candidatos de todos los cuartos juntos, y después el orden: si no, el muro de adentro del cuarto más grande ganaba a la
 // orilla de otro cuarto)
 const cands=[];
 for(const q of salas){
  for(const [lado,h] of [['N',true],['S',true],['W',false],['E',false]]){const largo=h?q.w:q.h,ancho=h?q.h:q.w;if(largo<E.largo-1e-6||ancho<E.ancho+2-1e-6)continue;
   const fija=lado==='N'?q.y:lado==='S'?q.y+q.h:lado==='W'?q.x:q.x+q.w,fachada=FACHADA.has(ladoDe(L,h?q.x+q.w/2:fija,h?fija:q.y+q.h/2));
   // (arrimada a un muro, primero —un muro que ya está—; si de ese lado hay un vano abierto de la planta abierta, la escalera
   // queda suelta con su apoyo en el centro —abajo—. Antes levantaba su propio muro en el vano)
   // (en la orilla —contra el borde del departamento: el vecino, el pasillo o la fachada—, mejor que contra un muro de adentro:
   // Miguel, 2026-11-22, «la escalera podría estar en la orilla para que se aproveche mejor el espacio arriba»)
   const orilla=h?Math.abs(fija-UU.y)<.05||Math.abs(fija-UU.y-UU.h)<.05:Math.abs(fija-UU.x)<.05||Math.abs(fija-UU.x-UU.w)<.05;
   const vanos=(lv.doors||[]).filter(d=>d.wide&&(h?Math.abs(d.y0-fija)<.05&&Math.abs(d.y1-fija)<.05:Math.abs(d.x0-fija)<.05&&Math.abs(d.x1-fija)<.05));
   for(let t=0;t+E.largo<=largo+1e-6;t++){const r=h?{x:q.x+t,y:lado==='N'?q.y:q.y+q.h-E.ancho,w:E.largo,h:E.ancho}:{x:lado==='W'?q.x:q.x+q.w-E.ancho,y:q.y+t,w:E.ancho,h:E.largo};
    const a0=h?r.x:r.y,a1=a0+E.largo,cortar=vanos.filter(d=>{const p=h?Math.min(d.x0,d.x1):Math.min(d.y0,d.y1),q2=h?Math.max(d.x0,d.x1):Math.max(d.y0,d.y1);return Math.min(q2,a1)-Math.max(p,a0)>.01;});
    cands.push({q,r,lado,h,fachada,cortar,a0,a1,orilla,fija});}}}
  cands.sort((a,b)=>(b.orilla?1:0)-(a.orilla?1:0)||(a.cortar.length?1:0)-(b.cortar.length?1:0)||a.fachada-b.fachada);
  for(const c of cands){const {q,r,h}=c;
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
   // (el arranque: delante del pie, DUPLEX.arranque de piso libre adentro del cuarto —Miguel: «el inicio de la escalera
   // contra la pared» no—)
   const arranca=(p,l)=>{const d=dir(l,p),x=p[0]+d[0]*DUPLEX.arranque,z=p[1]+d[1]*DUPLEX.arranque;return x>q.x-.01&&x<q.x+q.w+.01&&z>q.y-.01&&z<q.y+q.h+.01&&(x>q.x+.01&&x<q.x+q.w-.01||z>q.y+.01&&z<q.y+q.h-.01);};
   const sirve=(p,l)=>llegaBien(l,dir(p,l))&&cabe(p,l)&&ventanasBien(p)&&arranca(p,l);
   if(!sirve(pie,llegada)){if(!sirve(llegada,pie))continue;[pie,llegada]=[llegada,pie];}
   // (si de ese lado hay un vano abierto, la escalera queda suelta, con su apoyo en el centro —Miguel, 2026-11-22: «si puede
   // estar sin una pared, puede tener un apoyo en el centro de la escalera, como simulando el soporte»—: no se levanta muro;
   // el vano, con 1 m libre al lado —la regla de arriba—. El 3D la arma del catálogo: objetos3d escalera_flotante)
   return {...r,tipo:'recta',eje:h?'x':'z',pie,llegada,cuarto:q.id,peldanos:E.peldanos,objeto:'escalera_flotante',apoyo:c.cortar.length?'centro':'muro'};}
 return null;}

// LO DE ARRIBA de un departamento U (su rectángulo) con su escalera: un entrepiso abierto sobre toda la planta, sin cuartos
// (2026-11-22, Miguel: «que el piso dos del dúplex no tenga cuartos»; antes llevaba un dormitorio y un baño en las puntas).
// El vacío de la sala a doble altura y las barandas los pone vacioYBarandas.
// (en un edificio en L —2026-11-22, Miguel: «haz el penthouse para los edificios en L»— el entrepiso es un cuarto abierto por
// cada parte del edificio: partes; si no, uno sobre U)
function arribaDe(L,U,esc,n,esquina=()=>false,partes=[U]){const rooms=partes.map((p,i)=>({id:i,type:'entrepiso',abierto:true,x:p.x,y:p.y,w:p.w,h:p.h,unit:n})),doors=[],windows=[];
 // las buhardillas: una por casilla de 6 m —en su módulo del medio: con una por módulo de 2 m, la pendiente vista desde
 // adentro era un serrucho; Miguel, «reducimos polígonos»— en cada borde de un cuarto de arriba que da a una fachada,
 // menos en la punta de una esquina, donde el 3D pone la pieza de esquina de la mansarda, que no tiene ventana, y donde no
 // hay pendiente —contra un vecino más alto: muro derecho hasta la cubierta—
 for(const q of rooms){if(q.type==='bano')continue;for(const [h,fija,a0,a1] of [[true,q.y,q.x,q.x+q.w],[true,q.y+q.h,q.x,q.x+q.w],[false,q.x,q.y,q.y+q.h],[false,q.x+q.w,q.y,q.y+q.h]]){
  for(let m=Math.ceil(a0/2-1e-6)*2;m+2<=a1+1e-6;m+=2){const x=h?m+1:fija,z=h?fija:m+1;if(!FACHADA.has(ladoDe(L,x,z))||!pendienteEn(L.mansarda,x,z)||esquina(x,z)||!medioDeCasilla(h?x:z))continue;windows.push(h?{x0:m+.4,y0:fija,x1:m+1.6,y1:fija,buhardilla:true,a:q.id}:{x0:fija,y0:m+.4,x1:fija,y1:m+1.6,buhardilla:true,a:q.id});}}}
 return {rooms,doors,windows,area:rooms.reduce((s,q)=>s+q.w*q.h,0)};}

// ABAJO, LA PLANTA ABIERTA (2026-11-22, Miguel, con una captura de la escalera entre tabiques: «elimina paredes y reordena
// los apartamentos dúplex, porque no le veo sentido»; la foto que mandó antes: abajo la sala abierta con la escalera
// arrimada a un muro, arriba el entrepiso). En el último piso del dúplex sólo quedan cerrados el baño y el cuarto de ropas
// (DUPLEX.cerrados); entre los demás cuartos del departamento, cada pared que comparten es un vano abierto de punta a punta
// —hasta la cara del muro de al lado en cada punta—
// —town3d lo dibuja sin muro, hasta el techo—, y los dormitorios de abajo pasan a ser comedor o sala. Devuelve cómo
// deshacerlo (si después no cabe la escalera).
function abrirAbajo(lv,qs,enContorno=()=>false,{retipar=true}={}){const antes={doors:lv.doors,furniture:lv.furniture,tipos:qs.map(q=>[q,q.type])},abiertos=qs.filter(q=>!DUPLEX.cerrados.includes(q.type)),ids=new Set(abiertos.map(q=>q.id));
 let comedor=qs.some(q=>q.type==='comedor');
 if(retipar)for(const q of abiertos)if(q.type==='dormitorio'){q.type=comedor?'sala':'comedor';comedor=true;}
 for(const q of abiertos)q.abierto=true;// (parte de la planta abierta; sus muebles, cuando vuelvan los muebles)
 // (las puertas entre dos abiertos se van; en su lugar, el vano de todo lo que comparten)
 const doors=lv.doors.filter(d=>!(ids.has(d.a)&&ids.has(d.b)));
 // primero, lo que comparte cada par de abiertos, de punta a punta
 const crudos=[];
 for(let i=0;i<abiertos.length;i++)for(let j=i+1;j<abiertos.length;j++){const a=abiertos[i],b=abiertos[j];
  for(const [h,fa,fb,a0,a1,b0,b1] of [[true,a.y+a.h,b.y,a.x,a.x+a.w,b.x,b.x+b.w],[true,b.y+b.h,a.y,a.x,a.x+a.w,b.x,b.x+b.w],[false,a.x+a.w,b.x,a.y,a.y+a.h,b.y,b.y+b.h],[false,b.x+b.w,a.x,a.y,a.y+a.h,b.y,b.y+b.h]]){
   if(Math.abs(fa-fb)>.05)continue;const p0=Math.max(a0,b0),q0=Math.min(a1,b1);if(q0-p0>.05)crudos.push({h,at:fa,p:p0,q:q0,a:a.id,b:b.id});}}
 // (cada punta del vano llega hasta donde hay muro, sin pilar —Miguel, 2026-11-22: «elimina las columnas de soporte, no aportan
 // en nada»—: contra la fachada, su grosor (DUPLEX.cara.fachada); contra un tabique de verdad, su mitad (DUPLEX.cara.tabique);
 // si ahí sigue otro vano en la misma línea, o el cruce también es abierto, hasta la punta: con 7 cm en cada lado quedaba un
 // poste de 14 cm en cada cruce de la planta abierta)
 let vigentes=crudos;// (los vanos que quedan: se recalcula hasta que no cambia —uno que se descarta por corto deja muro, y eso cambia sus vecinos—)
 const abre=(h,at,t)=>vigentes.some(c=>c.h===h&&Math.abs(c.at-at)<.05&&t>c.p-.005&&t<c.q+.005);
 const muroEn=(h,at,t)=>{// ¿un borde de cuarto (o del núcleo, o del pasillo) cruza la línea en t, y no está abierto ahí?
  const rs=[...lv.rooms,...(lv.core?[lv.core]:[]),...(lv.corridor||[])];
  for(const r of rs)for(const [hh,f,c0,c1] of [[!h,h?r.x:r.y,h?r.y:r.x,h?r.y+r.h:r.x+r.w],[!h,h?r.x+r.w:r.y+r.h,h?r.y:r.x,h?r.y+r.h:r.x+r.w]]){
   if(Math.abs(f-t)>.05||at<c0-.05||at>c1+.05)continue;// (el borde perpendicular pasa por la punta)
   for(const o of [-.02,.02]){const u=at+o;if(u<c0-.01||u>c1+.01)continue;if(!abre(hh,f,u))return true;}}// (a 2 cm: el resto de 7 cm que deja un tabique también es muro)
  return false;};
 const cara=(c,t)=>{const [x,z]=c.h?[t,c.at]:[c.at,t];if(enContorno(x,z))return DUPLEX.cara.fachada;return muroEn(c.h,c.at,t)?DUPLEX.cara.tabique:0;};
 const armar=()=>{
  const base=crudos.map(c=>({...c,p0:c.p,q0:c.q}));
  vigentes=base;
  for(let vuelta=0;vuelta<8;vuelta++){const nuevos=[];for(const c of base){const p=c.p0+cara(c,c.p0),q=c.q0-cara(c,c.q0);if(q-p>=DUPLEX.pasoMin-1e-6)nuevos.push({...c,p,q});}
   const igual=nuevos.length===vigentes.length&&nuevos.every((c,i)=>c===vigentes[i]||Math.abs(c.p-vigentes[i].p)<1e-6&&Math.abs(c.q-vigentes[i].q)<1e-6&&c.p0===vigentes[i].p0);vigentes=nuevos;if(igual)break;}
  lv.doors=[...doors,...vigentes.map(c=>c.h?{x0:c.p,y0:c.at,x1:c.q,y1:c.at,a:c.a,b:c.b,wide:true,hoja:false,abierta:true}:{x0:c.at,y0:c.p,x1:c.at,y1:c.q,a:c.a,b:c.b,wide:true,hoja:false,abierta:true})];};
 armar();
 // (los muebles de los que eran dormitorios —la cama, el armario— se van; los de obra quedan)
 const eran=new Set(retipar?antes.tipos.filter(([q,t])=>t==='dormitorio').map(([q])=>q.id):[]);
 lv.furniture=(lv.furniture||[]).filter(f=>LUGAR_FIJO.has(f.kind)||!qs.some(q=>eran.has(q.id)&&f.x>=q.x-.01&&f.y>=q.y-.01&&f.x+f.w<=q.x+q.w+.01&&f.y+f.h<=q.y+q.h+.01));
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
 const As=arriba.rooms.filter(q=>q.abierto),areaA=As.reduce((t,q)=>t+q.w*q.h,0),abajo=(x,y)=>qs.find(q=>en(q,U.x+x,U.y+y));
 // (lo que no es entrepiso —un cuarto cerrado de arriba, o afuera del edificio en L— es 'cuarto': ni piso ni vacío)
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const px=U.x+x,py=U.y+y;if(en(esc,px,py))cel[k(x,y)]='hueco';else if(!As.some(A=>en(A,px,py)))cel[k(x,y)]='cuarto';}
 // (la llegada: la casilla después de la punta de arriba de la escalera)
 const dl=esc.eje==='x'?[Math.sign(esc.llegada[0]-esc.pie[0]),0]:[0,Math.sign(esc.llegada[1]-esc.pie[1])];
 const llegCel=esc.eje==='x'?[dl[0]>0?X(esc.x+esc.w):X(esc.x)-1,Y(esc.y)]:[X(esc.x),dl[1]>0?Y(esc.y+esc.h):Y(esc.y)-1];
 // (las casillas delante de cada puerta de arriba, del lado de lo abierto)
 const frente=arriba.doors.map(d=>{const h=Math.abs(d.y0-d.y1)<1e-6,mx=(d.x0+d.x1)/2,my=(d.y0+d.y1)/2;return h?[[X(mx-.5),Y(my-.5)],[X(mx-.5),Y(my+.5)]]:[[X(mx-.5),Y(my-.5)],[X(mx+.5),Y(my-.5)]];}).map(ps=>ps.find(([x,y])=>x>=0&&y>=0&&x<W&&y<H&&cel[k(x,y)]==='piso')).filter(Boolean);
 const deUnaPieza=c=>{const piso=[];for(let i=0;i<c.length;i++)if(c[i]==='piso')piso.push(i);if(piso.length<V.piso)return false;const ini=k(...llegCel);if(c[ini]!=='piso')return false;
  const vis=new Set([ini]),cola=[ini];while(cola.length){const i=cola.pop(),x=i%W,y=(i-x)/W;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=W||ny>=H)continue;const j=k(nx,ny);if(c[j]==='piso'&&!vis.has(j)){vis.add(j);cola.push(j);}}}
  return vis.size===piso.length&&frente.every(([x,y])=>vis.has(k(x,y)));};
 // (2026-11-22, Miguel: «la idea es escaleras que suban a la parte de arriba desde la orilla, para que no se pierda espacio
 // arriba»: primero se busca el vacío que CONTIENE la escalera —sube por la doble altura y llega al borde del entrepiso,
 // como en la foto que mandó—; si no hay, uno aparte, con al menos una casilla de piso entre los dos)
 const huecos=[];for(let i=0;i<cel.length;i++)if(cel[i]==='hueco')huecos.push(i);
 const sala=[...qs].filter(q=>q.abierto).sort((a,b)=>b.w*b.h-a.w*a.h)[0];
 const buscar=conEscalera=>{let mejor=null;
  for(let y0=0;y0<H;y0++)for(let x0=0;x0<W;x0++)for(let y1=y0+V.lado;y1<=H;y1++)for(let x1=x0+V.lado;x1<=W;x1++){
   if(conEscalera&&!huecos.every(i=>{const x=i%W,y=(i-x)/W;return x>=x0&&x<x1&&y>=y0&&y<y1;}))continue;
   const pegado=(x,y)=>[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>{const nx=x+dx,ny=y+dy;return nx>=0&&ny>=0&&nx<W&&ny<H&&cel[k(nx,ny)]==='hueco';});
   let ok=true;for(let y=y0;y<y1&&ok;y++)for(let x=x0;x<x1&&ok;x++){const t=cel[k(x,y)],q=abajo(x,y);
    if(t==='hueco'&&conEscalera)continue;if(t!=='piso'||!q||!q.abierto||(x===llegCel[0]&&y===llegCel[1])||(!conEscalera&&pegado(x,y)))ok=false;}if(!ok)continue;
   const area=(x1-x0)*(y1-y0);if(area>V.max*areaA+1e-6||(mejor&&area<mejor.area))continue;
   const c=cel.slice();for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(c[k(x,y)]==='piso')c[k(x,y)]='vacio';if(!deUnaPieza(c))continue;
   // (de dos iguales, el que más cae sobre la sala —el cuarto abierto más grande de abajo—)
   const sobreSala=sala?Math.max(0,Math.min(x1,X(sala.x+sala.w))-Math.max(x0,X(sala.x)))*Math.max(0,Math.min(y1,Y(sala.y+sala.h))-Math.max(y0,Y(sala.y))):0;
   if(!mejor||area>mejor.area||sobreSala>mejor.sobreSala)mejor={x0,y0,x1,y1,area,sobreSala,c,conEscalera};}
  return mejor;};
 const mejor=buscar(true)||buscar(false);
 if(mejor)for(let i=0;i<cel.length;i++)cel[i]=mejor.c[i];
 const vacios=mejor?[{x:U.x+mejor.x0,y:U.y+mejor.y0,w:mejor.x1-mejor.x0,h:mejor.y1-mejor.y0,...(mejor.conEscalera?{conEscalera:true}:{})}]:[];
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
// EL BORDE de una unión de rectángulos que se tocan sin pisarse (las partes de un edificio en L, los cuartos de arriba de un
// dúplex): los tramos de sus lados que no comparte con otro, {h, fija, a0, a1, sg —hacia adentro—}
export function bordesDe(rs){const out=[];
 for(const r of rs)for(const [h,fija,a0,a1,sg] of [[true,r.y,r.x,r.x+r.w,1],[true,r.y+r.h,r.x,r.x+r.w,-1],[false,r.x,r.y,r.y+r.h,1],[false,r.x+r.w,r.y,r.y+r.h,-1]]){
  let ts=[[a0,a1]];for(const o of rs){if(o===r)continue;const [of,o0,o1]=h?[sg>0?o.y+o.h:o.y,o.x,o.x+o.w]:[sg>0?o.x+o.w:o.x,o.y,o.y+o.h];if(Math.abs(of-fija)>.01)continue;
   ts=ts.flatMap(([u,v])=>[[u,Math.min(v,o0)],[Math.max(u,o1),v]].filter(([p,q])=>q-p>.01));}
  for(const [u,v] of ts)out.push({h,fija,a0:u,a1:v,sg});}
 return out;}
// ¿(x, z) está sobre el contorno del edificio? (a 5 cm, hacia algún lado, ya se sale de sus partes)
function contornoDe(L){const ps=L.parts||[],adentro=(x,z)=>ps.some(p=>x>=p.x&&x<=p.x+p.w&&z>=p.y&&z<=p.y+p.h);
 // (también en diagonal: la esquina de adentro de una L tiene afuera sólo en diagonal)
 return (x,z)=>adentro(x,z)&&[[.05,0],[-.05,0],[0,.05],[0,-.05],[.05,.05],[.05,-.05],[-.05,.05],[-.05,-.05]].some(([dx,dz])=>!adentro(x+dx,z+dz));}
// ¿el módulo de 2 m con centro c (a lo largo de la fachada) es el del medio de su casilla de CELL m?
const medioDeCasilla=c=>Math.round((c-(Math.floor(c/CELL)+.5)*CELL)/2)===0;
function esquinaDe(bp,L){const de=loteEn(bp),r=L.rect,W=bp.map.W,H=bp.map.H,lote=(x,y)=>x>=0&&y>=0&&x<W&&y<H?de(x,y):-1;
 return (x,z)=>{const n=Math.abs(z-r.y)<.05?[0,-1]:Math.abs(z-r.y-r.h)<.05?[0,1]:Math.abs(x-r.x)<.05?[-1,0]:[1,0],cx=Math.floor((x-n[0]*.1)/CELL),cy=Math.floor((z-n[1]*.1)/CELL),t=[n[1],-n[0]];
  const o=(x-(cx+.5)*CELL)*t[0]+(z-(cy+.5)*CELL)*t[1],k=Math.round(o/2)+1,endS=k===0?-1:k===2?1:0;return !!endS&&lote(cx+t[0]*endS,cy+t[1]*endS)<0;};}

// EL PENTHOUSE (2026-11-22, Miguel: «apóyate de internet, ve apartamentos dúplex y si es el caso redimensiónalos, que sean
// más grandes: serían más costosos, o todo el piso»). Un dúplex de menos de ~100 m² casi no gana nada frente a un piso de una
// planta (consumer.es) y uno de lujo anda por los 215 m² en dos plantas (hola.com); aquí un departamento del último piso tiene
// 56 m² de mediana. Así que, donde se puede, TODO el último piso es un solo dúplex: en un edificio de una sola parte
// rectangular, con dos o más departamentos arriba y DUPLEX.penthouse.max m² o menos, el pasillo pasa a ser el hall de la
// casa —su puerta de entrada, una puerta de verdad hacia la escalera del edificio, es la que se tranca—, los departamentos
// se juntan en uno y queda una cocina: la más grande; las demás pasan a sala o comedor. Devuelve cómo deshacerlo.
function penthouse(L,top){const P=DUPLEX.penthouse,r=L.rect;
 // (también con un solo departamento y su pasillo, o con depósitos y el cuarto de ropas sin dueño: todo pasa a la casa —Miguel,
 // 2026-11-22: «sigo viendo mansardas vacías… deberían ser todos los edificios que terminan con mansarda dúplex»—)
 // (de una parte o de varias —en L—: lo que cuenta es la planta del edificio, sus partes)
 const area=q=>q.w*q.h,partes=(L.parts||[]).map(p=>({x:p.x,y:p.y,w:p.w,h:p.h})),planta=partes.reduce((t,p)=>t+area(p),0);
 if(!partes.length||!(top.units||[]).length||!(top.corridor||[]).length||!top.core||planta>P.max+1e-6)return null;
 const suma=top.rooms.reduce((t,q)=>t+area(q),0)+top.corridor.reduce((t,c)=>t+area(c),0)+area(top.core);if(Math.abs(suma-planta)>.5)return null;
 const antes={rooms:top.rooms.map(q=>({...q})),doors:top.doors.map(d=>({...d})),corridor:top.corridor,units:top.units,furniture:top.furniture};
 const n=Math.min(...top.units.map(u=>u.n));let id=Math.max(...top.rooms.map(q=>q.id))+1;
 for(const q of top.rooms)q.unit=n;
 // (el vestíbulo de la casa: ahí llega la escalera del edificio)
 const halls=top.corridor.map(c=>({id:id++,type:'vestibulo',x:c.x,y:c.y,w:c.w,h:c.h,unit:n}));top.rooms.push(...halls);
 const hallEn=(x,z)=>halls.find(h=>x>=h.x-.05&&x<=h.x+h.w+.05&&z>=h.y-.05&&z<=h.y+h.h+.05);
 // (las puertas de cada departamento al pasillo se van —ahora es la casa—; la del núcleo pasa a ser la puerta de entrada, de
 // 90 cm, al medio de su vano)
 const doors=[],cerrado=id=>DUPLEX.cerrados.includes(top.rooms.find(q=>q.id===id)?.type);
 for(const d of top.doors){const ap=d.a==='pasillo'||d.b==='pasillo';if(!ap){doors.push(d);continue;}
  // (la puerta de un cuarto cerrado —un depósito, el de ropas, un baño— al pasillo queda: ahora da al vestíbulo)
  const otro=d.a==='pasillo'?d.b:d.a;if(cerrado(otro)){const h=Math.abs(d.y0-d.y1)<1e-6,mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2,H=halls.find(q=>[[0,.2],[0,-.2],[.2,0],[-.2,0]].some(([a,b])=>mx+a>q.x&&mx+a<q.x+q.w&&mz+b>q.y&&mz+b<q.y+q.h));if(H){doors.push(d.a==='pasillo'?{...d,a:H.id}:{...d,b:H.id});continue;}}
  // (el ascensor —desde 6 pisos— llega directo al vestíbulo del penthouse: su vano queda como estaba, y también se tranca)
  if(d.a==='nucleo'||d.b==='nucleo'){const h=Math.abs(d.y0-d.y1)<1e-6,m=h?(d.x0+d.x1)/2:(d.y0+d.y1)/2,H=hallEn(h?m:d.x0,h?d.y0:m);if(!H)return deshacer(),null;doors.push(d.a==='pasillo'?{...d,a:H.id}:{...d,b:H.id});continue;}
  // (2026-11-22, Miguel: «la puerta de algunos dúplex, cuando suben la escalera, queda mal»: iba al medio del vano, justo entre
  // los dos tramos, y media puerta abría sobre el hueco del tramo que baja, detrás de su baranda. Va centrada en el tramo B,
  // el que llega a este piso —llegadaArriba—)
  if(d.core||d.a==='escalera'||d.b==='escalera'){const h=Math.abs(d.y0-d.y1)<1e-6,lle=llegadaArriba(top.stair),m=Math.round((lle?(h?lle[0]:lle[1]):h?(d.x0+d.x1)/2:(d.y0+d.y1)/2)*1000)/1000,H=hallEn(h?m:d.x0,h?d.y0:m);if(!H)return deshacer(),null;
   doors.push(h?{x0:m-.45,y0:d.y0,x1:m+.45,y1:d.y0,a:H.id,b:'escalera',street:false,core:false,wide:false,bay:false,stair:false,hoja:true,abierta:false,entrada:true}:{x0:d.x0,y0:m-.45,x1:d.x0,y1:m+.45,a:H.id,b:'escalera',street:false,core:false,wide:false,bay:false,stair:false,hoja:true,abierta:false,entrada:true});}}
 const x0=Math.min(...partes.map(p=>p.x)),y0=Math.min(...partes.map(p=>p.y)),x1=Math.max(...partes.map(p=>p.x+p.w)),y1=Math.max(...partes.map(p=>p.y+p.h));
 top.doors=doors;top.corridor=[];top.units=[{n,x:x0,y:y0,w:x1-x0,h:y1-y0,...(partes.length>1?{partes}:{})}];
 // una sola cocina: la más grande; de las demás se van los aparatos de obra y pasan a sala (o comedor)
 const COC=new Set(['cocina','sala_cocina','cocineta']),cocinas=top.rooms.filter(q=>COC.has(q.type)).sort((a,b)=>area(b)-area(a)),dentroDe=(f,q)=>f.x>=q.x-.01&&f.y>=q.y-.01&&f.x+f.w<=q.x+q.w+.01&&f.y+f.h<=q.y+q.h+.01;
 for(const q of cocinas.slice(1)){top.furniture=(top.furniture||[]).filter(f=>!(LUGAR_FIJO.has(f.kind)&&dentroDe(f,q)));q.type=q.type==='cocina'?'comedor':'sala';}
 // y un solo baño —el más grande—, como todo departamento (abrirDepartamentos)
 for(const q of top.rooms.filter(q=>q.type==='bano').sort((a,b)=>b.w*b.h-a.w*a.h).slice(1)){top.furniture=(top.furniture||[]).filter(f=>!(['inodoro','lavamanos','ducha','tina'].includes(f.kind)&&dentroDe(f,q)));q.type='estudio';}
 function deshacer(){top.rooms=antes.rooms;top.doors=antes.doors;top.corridor=antes.corridor;top.units=antes.units;top.furniture=antes.furniture;}
 return {deshacer};}

// LA COCINA CON ISLA (2026-11-22, Miguel: «para los dúplex, esas cocinas que tienen el mesón en el centro, y la estufa, y no
// contra la pared»). En la planta abierta, el mesón sale del muro a una isla paralela a él —con el lugar de la estufa encima—, a DUPLEX.isla.paso
// (1,1 m: el pasillo de quien cocina, que queda mirando a la sala); la nevera se queda contra el muro, y si la isla le queda
// enfrente, se corre hasta dejar DUPLEX.isla.libre delante de su puerta. La isla deja DUPLEX.isla.libre alrededor —las puntas y el lado de la sala— sin la escalera, sin el paso de una
// puerta y adentro de lo abierto; lo que estorbe de los muebles sueltos (la mesa, una silla) se va. Si no cabe, queda como estaba.
function islaDe(lv,qs,esc){const I=DUPLEX.isla,fs=lv.furniture||[],dentro=(f,q)=>f.x>=q.x-.01&&f.y>=q.y-.01&&f.x+f.w<=q.x+q.w+.01&&f.y+f.h<=q.y+q.h+.01;
 const K=qs.find(q=>q.abierto&&fs.some(f=>f.kind==='meson'&&dentro(f,q))&&fs.some(f=>f.kind==='estufa'&&dentro(f,q)));if(!K)return null;
 const m=fs.find(f=>f.kind==='meson'&&dentro(f,K)),e=fs.find(f=>f.kind==='estufa'&&dentro(f,K)),n=fs.find(f=>f.kind==='nevera'&&dentro(f,K));
 const ry=m.ry||0,fx=Math.round(Math.sin(ry)),fz=Math.round(Math.cos(ry)),eje=fx?'z':'x';// (el frente de los aparatos y el eje del muro)
 // (la isla: un mesón de DUPLEX.isla.largo × DUPLEX.isla.hondo o más —lo que medían el mesón y la estufa juntos—, con el lugar
 // de la estufa encima: se compra)
 const largo=f=>eje==='x'?f.w:f.h,hondo=f=>eje==='x'?f.h:f.w,Lr=Math.max(I.largo,largo(m)+largo(e)),D=I.hondo;
 // el muro: detrás del mesón
 const muro=fx?(fx<0?m.x+m.w:m.x):(fz<0?m.y+m.h:m.y),s=-(fx||fz);// (s: de los aparatos hacia el muro, sobre el eje del frente)
 // (la isla, entre cerca y lejos sobre el eje del frente; si queda frente a la nevera, a DUPLEX.isla.libre de su puerta)
 const banda=paso=>{const d0=muro-s*paso,d1=d0-s*D;return [Math.min(d0,d1),Math.max(d0,d1)];};
 const k0=eje==='x'?K.x:K.y,k1=k0+(eje==='x'?K.w:K.h),c0=(eje==='x'?(m.x+m.w/2+e.x+e.w/2)/2:(m.y+m.h/2+e.y+e.h/2)/2);
 const nev=n?(eje==='x'?[n.x,n.x+n.w]:[n.y,n.y+n.h]):null,ab=qs.filter(q=>q.abierto),enAbierto=r=>{for(let x=r.x+.05;x<r.x+r.w;x+=.25)for(let z=r.y+.05;z<r.y+r.h;z+=.25)if(!ab.some(q=>x>=q.x-.01&&x<=q.x+q.w+.01&&z>=q.y-.01&&z<=q.y+q.h+.01))return false;return true;};
 const pasoEn=t0=>nev&&Math.min(nev[1],t0+Lr)-Math.max(nev[0],t0)>-.1?Math.max(I.paso,hondo(n)+I.libre):I.paso;
 const rect=(t0)=>{const [cerca,lejos]=banda(pasoEn(t0));return eje==='x'?{x:t0,y:cerca,w:Lr,h:lejos-cerca}:{x:cerca,y:t0,w:lejos-cerca,h:Lr};};
 const crece=(r,a,b)=>eje==='x'?{x:r.x-b,y:r.y-a,w:r.w+2*b,h:r.h+2*a}:{x:r.x-a,y:r.y-b,w:r.w+2*a,h:r.h+2*b};
 const zonas=(lv.doors||[]).filter(d=>!d.wide&&(qs.some(q=>q.id===d.a||q.id===d.b))).map(d=>{const dh=Math.abs(d.y0-d.y1)<1e-6,x0=Math.min(d.x0,d.x1),x1=Math.max(d.x0,d.x1),y0=Math.min(d.y0,d.y1),y1=Math.max(d.y0,d.y1);return dh?{x:x0-.2,y:y0-1,w:x1-x0+.4,h:2}:{x:x0-1,y:y0-.2,w:2,h:y1-y0+.4};});
 // (a lo largo: lo más cerca del medio de donde estaban, en pasos de 10 cm)
 const opciones=[];for(let t=k0+I.libre;t+Lr<=k1-I.libre+1e-6;t+=.1)opciones.push(t);opciones.sort((a,b)=>Math.abs(a+Lr/2-c0)-Math.abs(b+Lr/2-c0));
 for(const t0 of opciones){const r=rect(t0),z=crece(r,I.libre,I.libre);
  if(!enAbierto(z)||pisa(z,esc)||zonas.some(o=>pisa(o,z)))continue;
  if(fs.some(f=>f!==m&&f!==e&&LUGAR_FIJO.has(f.kind)&&pisa(f,z)))continue;// (y el lugar de la nevera —se compra, pero el plano lo guarda—: a DUPLEX.isla.libre, de frente o de costado)
  // la isla: el mesón, de frente al muro —quien cocina queda en el pasillo, de cara a la sala—; la estufa, cuando se compre, va encima
  const ry2=ry+Math.PI,ne={...m,x:r.x,y:r.y,w:r.w,h:r.h,ry:ry2,isla:true};
  lv.furniture=fs.filter(f=>f!==m&&f!==e&&(LUGAR_FIJO.has(f.kind)||!pisa(f,z))).concat([ne]);
  return {x:r.x,y:r.y,w:r.w,h:r.h,cuarto:K.id};}
 return null;}

// LOS DEPARTAMENTOS ABIERTOS (2026-11-22, Miguel: «en el juego no vale mucho la pena tener muchas habitaciones o varios baños,
// lo importante es la movilidad… lo mejor es dejar sólo el espacio del baño: que las habitaciones no existan, eso será decisión
// del usuario agregar divisiones… sólo deja los apartamentos abiertos, sólo el baño con paredes y el mesón… y todo calculado en
// el plano»). En cada departamento de la ciudad: un solo baño —el más grande; de los demás se sacan los aparatos y se abren—,
// una sola cocina —la más grande—, y entre todo lo demás ningún tabique: cada pared compartida es un vano abierto
// (abrirAbajo, sin pilares). La entrada, la de siempre: una puerta al pasillo. Cada zona conserva su nombre —el dormitorio, la
// sala, la cocina— porque de ahí salen las familias, el botín y las cortinas; los muebles del plano quedan para esas cuentas y
// no se entregan (entrega.js).
export function abrirDepartamentos(bp){let deptos=0,banos=0,cocinas=0;const COC=new Set(['cocina','sala_cocina','cocineta']);
 for(const L of bp.lots)for(const lv of L.levels||[])for(const u of lv.units||[]){const qs=lv.rooms.filter(q=>q.unit===u.n);if(qs.length<2)continue;
  const dentroDe=(f,q)=>f.x>=q.x-.01&&f.y>=q.y-.01&&f.x+f.w<=q.x+q.w+.01&&f.y+f.h<=q.y+q.h+.01,sacar=(q,kinds)=>{lv.furniture=(lv.furniture||[]).filter(f=>!(kinds.has(f.kind)&&dentroDe(f,q)));};
  // un baño: el más grande; los otros, sin aparatos, pasan a estudio (una zona más)
  for(const q of qs.filter(q=>q.type==='bano').sort((a,b)=>b.w*b.h-a.w*a.h).slice(1)){sacar(q,new Set(['inodoro','lavamanos','ducha','tina']));q.type='estudio';banos++;}
  // una cocina: la más grande con mesón; de las otras se van el mesón y los aparatos
  const conMeson=qs.filter(q=>COC.has(q.type)&&(lv.furniture||[]).some(f=>f.kind==='meson'&&dentroDe(f,q))).sort((a,b)=>b.w*b.h-a.w*a.h);
  for(const q of conMeson.slice(1)){sacar(q,new Set(['meson','estufa','nevera']));q.type=q.type==='cocina'?'comedor':'sala';cocinas++;}
  abrirAbajo(lv,qs,contornoDe(L),{retipar:false});deptos++;}
 return {deptos,banos,cocinas};}

// El punto del frente de la escalera en U del núcleo (lv.stair, blueprint) donde llega el tramo que sube a ese piso: el
// carril B —de HW a W, menos medio muro del medio—, en su centro y en el borde de adelante. null sin escalera.
export function llegadaArriba(st){if(!st)return null;const HW=st.w/2,a=(HW+.05+st.w)/2;return [st.x+st.ux*a,st.z+st.uz*a];}
export function duplexDe(bp){let n=0,no=0,penthouses=0,incompletos=0;
 for(const L of bp.lots){delete L.duplex;if(!L.mansarda||(L.floors||0)<2)continue;const top=L.levels[L.floors-1];if(!top?.units?.length)continue;delete top.escalerasInternas;
  // (cada departamento del piso, su dúplex si cabe la escalera)
  const armar=()=>{const unidades=[];let sin=0;
   for(const u of top.units){const qs=top.rooms.filter(q=>q.unit===u.n),U={x:u.x,y:u.y,w:u.w,h:u.h};if(!qs.length)continue;
    const ab=abrirAbajo(top,qs,contornoDe(L)),esc=escaleraDe(L,top,qs);
    if(!esc){ab.deshacer();sin++;continue;}
    const arriba=arribaDe(L,U,esc,u.n,esquinaDe(bp,L),u.partes||[U]);
    // (la escalera llega a lo abierto: su hueco, adentro de uno de sus cuartos)
    if(!arriba.rooms.some(q=>dentro(esc,q))){ab.deshacer();sin++;continue;}
    const isla=islaDe(top,qs,esc);if(isla)arriba.isla=isla;
    const vb=vacioYBarandas(top,qs,U,esc,arriba);arriba.area-=vb.vacios.reduce((t,v)=>t+v.w*v.h,0);
    // (sobre el vacío de la doble altura no hay buhardilla: no hay piso desde donde asomarse, y desde abajo se veía por dentro)
    arriba.windows=arriba.windows.filter(w=>!vb.vacios.some(v=>{const x=(w.x0+w.x1)/2,z=(w.y0+w.y1)/2;return x>v.x-.05&&x<v.x+v.w+.05&&z>v.y-.05&&z<v.y+v.h+.05;}));
    (top.escalerasInternas||(top.escalerasInternas=[])).push({...esc,unit:u.n});unidades.push({n:u.n,escalera:esc,...arriba,...vb});}
   return {unidades,sin};};
  const foto={rooms:top.rooms.map(q=>({...q})),doors:top.doors.map(d=>({...d})),corridor:top.corridor,units:top.units,furniture:top.furniture};
  // primero, todo el piso en uno; si no cabe su escalera, como antes: un dúplex por departamento
  let ph=penthouse(L,top),r=armar();
  if(ph&&!r.unidades.length){ph.deshacer();ph=null;delete top.escalerasInternas;r=armar();}else if(ph)penthouses++;
  // (la mansarda entera o nada —Miguel: «deberían ser todos los edificios que terminan con mansarda dúplex, y aprovechar los
  // espacios»—: si queda piso de la mansarda sin dúplex —un pasillo, un departamento sin escalera, un cuarto sin dueño—, se
  // deshace y el edificio pasa a techo plano —abajo—. El penthouse de un edificio en L queda para después)
  const entero=!!ph||(!(top.corridor||[]).length&&top.units.every(u=>r.unidades.some(d=>d.n===u.n))&&!top.rooms.some(q=>q.unit==null));
  if(r.unidades.length&&!entero){top.rooms=foto.rooms;top.doors=foto.doors;top.corridor=foto.corridor;top.units=foto.units;top.furniture=foto.furniture;delete top.escalerasInternas;incompletos++;r={unidades:[],sin:r.sin};}
  n+=r.unidades.length;no+=r.sin;
  if(r.unidades.length)L.duplex={nivel:L.floors,unidades:r.unidades,penthouse:!!ph&&r.unidades.length===1&&top.units.length===1};
  // (las ventanas modernas —Miguel, 2026-11-22: «ventanas más modernas en los dúplex, para que se vea más bonito y moderno»—:
  // si todo el piso de abajo es dúplex, sus ventanas son paños de vidrio casi de piso a techo —la pieza «vidrio», 1,81 × 2,64 m—;
  // con otros departamentos en el piso no, para que la fachada siga pareja)
  // (todas, también la del baño —con vidrio esmerilado: un detalle de material que acá no se dibuja—: un piso de la fachada
  // lleva sus ventanas a una misma altura —auditar-plano, coherencia—)
  if(r.unidades.length&&top.units.every(u=>r.unidades.some(d=>d.n===u.n)))for(const w of top.windows||[])if(!w.shop&&!w.escalera)w.pieza=DUPLEX.ventana;}
  // (LA MANSARDA, SÓLO CON DÚPLEX —Miguel, 2026-11-22: «veo mansardas sin acceso, lo cual indica que el piso de abajo no la
 // está aprovechando»—: un edificio con mansarda que quedó sin dúplex —oficinas, un hotel, la comisaría, una casa de un piso,
 // o uno donde no cupo la escalera— pasa a techo plano: sin el piso vacío encima, y su escalera llega a la azotea)
 let aplanados=0;for(const L of bp.lots)if(L.mansarda&&!L.duplex){delete L.mansarda;L.fachada={...L.fachada,techo:'plano'};aplanados++;}
 return {duplex:n,sinLugar:no,penthouses,aplanados,incompletos};}

// El nivel de la mansarda como un piso más (para dibujarlo y medirlo igual que los demás): los cuartos de todos los dúplex
// del edificio con su número de unidad, sus puertas y buhardillas, y los huecos de sus escaleras.
export function nivelMansarda(L){if(!L?.duplex)return null;const rooms=[],doors=[],windows=[],units=[],huecos=[],barandas=[],vacios=[];
 for(const u of L.duplex.unidades){const off=rooms.length;for(const q of u.rooms)rooms.push({...q,id:off+q.id});
  for(const d of u.doors)doors.push({...d,a:off+d.a,b:off+d.b});for(const w of u.windows)windows.push({...w,a:off+(w.a||0)});
  const xs=u.rooms.flatMap(q=>[q.x,q.x+q.w]),ys=u.rooms.flatMap(q=>[q.y,q.y+q.h]);units.push({n:u.n,x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys),...(u.rooms.length>1?{partes:u.rooms.map(q=>({x:q.x,y:q.y,w:q.w,h:q.h}))}:{})});
  huecos.push({...u.escalera,unit:u.n});for(const b of u.barandas||[])barandas.push({...b,unit:u.n});for(const v of u.vacios||[])vacios.push({...v,unit:u.n});}
 return {level:L.duplex.nivel,mansarda:true,rooms,doors,windows,units,corridor:[],core:null,furniture:[],huecos,barandas,vacios};}
// El piso f de un edificio: uno de los suyos, o la mansarda de los dúplex (f = L.floors).
export const nivelDe=(L,f)=>f<(L.floors||0)?L.levels[f]:nivelMansarda(L)||L.levels[Math.min(f,(L.floors||1)-1)];
