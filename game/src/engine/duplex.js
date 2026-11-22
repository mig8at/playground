// LOS DÚPLEX BAJO LA MANSARDA (2026-11-22, Miguel: «para este tipo de edificio, ¿vale la pena usarlo para hacer apartamentos
// dúplex aprovechando la altura? Serían los más caros» → «sí, empieza por el 2D»).
//
// La mansarda es un piso entero —MANSARDA.alto, 3 m— encima del último, con una pendiente de MANSARDA.retiro (1 m) desde
// cada borde y altura completa adentro; hasta ahora quedaba vacía. Cada departamento del último piso de un edificio con
// mansarda pasa a ser un dúplex: abajo, el departamento de siempre; arriba, la mansarda sobre su misma planta, unidos por
// una escalera privada.
//   · LA ESCALERA: recta, de DUPLEX.escalera (1 × 4 m: 15 peldaños de 20 cm, 3 m de subida), arrimada a un muro de la sala
//     —o de la sala con cocina, el estudio, el comedor—, sin tapar una ventana de ese muro, sin cerrar el paso de una puerta
//     (DUPLEX.paso delante de cada una) y sin pisar un aparato de obra (la cocina); prefiere un muro de adentro a uno de
//     fachada. Donde no queda un muro libre de 4 m —una sala con cocina de 4 × 6, un estudio: 94 de 158 en la ciudad de
//     720 m—, una escalera de caracol de DUPLEX.caracol (2 × 2 m) en un rincón libre, con las mismas reglas. Si tampoco
//     cabe, ese departamento no es dúplex.
//   · ARRIBA: un altillo abierto sobre la planta del departamento. Si su lado largo da para dejarle DUPLEX.altilloMin, una
//     franja de 2 m en una punta lleva el baño (2 × 3 m) y un vestidor con el resto; la franja va en la punta lejos de la
//     escalera. Las ventanas son las buhardillas: una por módulo de 2 m donde el altillo da a una fachada (calle, avenida o
//     patio); el baño, ciego, como los demás.
// Todo en metros enteros. No cambia nada del plano de abajo más que anotar la escalera (lv.escalerasInternas); lo de
// arriba queda en L.duplex = {nivel, unidades: [{n, escalera, rooms, doors, windows, area}]}.
import {DE_OBRA} from './entrega.js';
import {alturaMansarda} from './techos.js';
import {MANSARDA} from './medidas.js';

export const DUPLEX={aire:2.1,escalera:{ancho:1,largo:4,peldanos:15},caracol:{lado:2,peldanos:14},paso:1,altilloMin:4,franja:2,bano:3,cuartos:['sala_cocina','sala','estudio','comedor']};
const pisa=(a,b,t=.01)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>t&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>t;
const dentro=(a,b,t=.01)=>a.x>=b.x-t&&a.y>=b.y-t&&a.x+a.w<=b.x+b.w+t&&a.y+a.h<=b.y+b.h+t;

// ¿Qué hay del otro lado del borde de un lote en el punto (x, z)? (L.sides por el lado del rectángulo; null si es adentro)
function ladoDe(L,x,z){const r=L.rect,e=.05;if(Math.abs(z-r.y)<e)return L.sides?.N;if(Math.abs(z-r.y-r.h)<e)return L.sides?.S;if(Math.abs(x-r.x)<e)return L.sides?.W;if(Math.abs(x-r.x-r.w)<e)return L.sides?.E;return null;}
const FACHADA=new Set(['calle','avenida','patio']);

// La escalera de un departamento: el primer lugar que sirve, o null.
function escaleraDe(L,lv,qs){const E=DUPLEX.escalera,obra=(lv.furniture||[]).filter(f=>DE_OBRA.has(f.kind));
 const salas=qs.filter(q=>DUPLEX.cuartos.includes(q.type)).sort((a,b)=>b.w*b.h-a.w*a.h);
 for(const q of salas){const cands=[];
  for(const [lado,h] of [['N',true],['S',true],['W',false],['E',false]]){const largo=h?q.w:q.h,ancho=h?q.h:q.w;if(largo<E.largo-1e-6||ancho<E.ancho+2-1e-6)continue;
   const fija=lado==='N'?q.y:lado==='S'?q.y+q.h:lado==='W'?q.x:q.x+q.w,fachada=FACHADA.has(ladoDe(L,h?q.x+q.w/2:fija,h?fija:q.y+q.h/2));
   for(let t=0;t+E.largo<=largo+1e-6;t++){const r=h?{x:q.x+t,y:lado==='N'?q.y:q.y+q.h-E.ancho,w:E.largo,h:E.ancho}:{x:lado==='W'?q.x:q.x+q.w-E.ancho,y:q.y+t,w:E.ancho,h:E.largo};cands.push({r,lado,h,fachada});}}
  cands.sort((a,b)=>a.fachada-b.fachada);
  // (el caracol, después: en cada rincón del cuarto y a lo largo de cada muro, de a metro)
  const C=DUPLEX.caracol.lado;if(q.w>=C+1-1e-6&&q.h>=C+1-1e-6)for(let x=q.x;x+C<=q.x+q.w+1e-6;x++)for(let y=q.y;y+C<=q.y+q.h+1e-6;y++){const toca=[y===q.y&&'N',y+C>=q.y+q.h-1e-6&&'S',x===q.x&&'W',x+C>=q.x+q.w-1e-6&&'E'].filter(Boolean);if(!toca.length)continue;
   const rincon=toca.length>=2;cands.push({r:{x,y,w:C,h:C},lado:toca,h:null,fachada:toca.some(l=>FACHADA.has(ladoDe(L,l==='W'?q.x:l==='E'?q.x+q.w:x+1,l==='N'?q.y:l==='S'?q.y+q.h:y+1))),caracol:true,rincon});}
  cands.sort((a,b)=>(a.caracol?1:0)-(b.caracol?1:0)||a.fachada-b.fachada||(b.rincon?1:0)-(a.rincon?1:0));
  for(const c of cands){const {r,h}=c;
   // (ninguna ventana del muro que tapa; ningún paso de puerta; ningún aparato de obra)
   // (ninguna ventana en ninguno de sus cuatro bordes: la punta de una escalera recta también puede quedar contra la fachada)
   const ventana=(lv.windows||[]).some(w=>{const wh=Math.abs(w.y0-w.y1)<1e-6,at=wh?w.y0:w.x0;return wh?(Math.abs(at-r.y)<.05||Math.abs(at-r.y-r.h)<.05)&&Math.min(Math.max(w.x0,w.x1),r.x+r.w)-Math.max(Math.min(w.x0,w.x1),r.x)>.05:(Math.abs(at-r.x)<.05||Math.abs(at-r.x-r.w)<.05)&&Math.min(Math.max(w.y0,w.y1),r.y+r.h)-Math.max(Math.min(w.y0,w.y1),r.y)>.05;});
   if(ventana)continue;
   const puerta=(lv.doors||[]).some(d=>{const dh=Math.abs(d.y0-d.y1)<1e-6,x0=Math.min(d.x0,d.x1),x1=Math.max(d.x0,d.x1),y0=Math.min(d.y0,d.y1),y1=Math.max(d.y0,d.y1),P=DUPLEX.paso;
    const zona=dh?{x:x0-.2,y:y0-P,w:x1-x0+.4,h:2*P}:{x:x0-P,y:y0-.2,w:2*P,h:y1-y0+.4};return pisa(zona,r);});
   if(puerta)continue;if(obra.some(f=>pisa(f,r)))continue;
   // (2026-11-22, al subirla en 3D: arriba la mansarda baja a 0 en cada borde con pendiente —techos.js—, y una escalera
   // arrimada a la fachada llegaba donde no cabe una cabeza —una recta del lote 55 terminaba contra el muro—. Toda la
   // escalera, a DUPLEX.aire de altura libre o más —en metros enteros, a 1 m de la pendiente—; y la llegada —medio metro más
   // allá de la punta de arriba— adentro del departamento y con esa misma altura)
   const libre=(x,z)=>!L.mansarda||alturaMansarda(L.mansarda,x,z)>=DUPLEX.aire-1e-6,enUnidad=(x,z)=>qs.some(o=>x>o.x+.01&&x<o.x+o.w-.01&&z>o.y+.01&&z<o.y+o.h-.01);
   if(![[r.x,r.y],[r.x+r.w,r.y],[r.x,r.y+r.h],[r.x+r.w,r.y+r.h]].every(([x,z])=>libre(x,z)))continue;
   const llegaBien=(p,d)=>{const x=p[0]+d[0]*.5,z=p[1]+d[1]*.5;return enUnidad(x,z)&&libre(x,z);};
   // (sube a lo largo del muro; la llegada, en la punta que queda más lejos del centro del cuarto en el otro eje no importa:
   // se sube hacia la punta más lejana de la puerta más cercana)
   // (el caracol se sale por el medio de un borde —por la esquina se cae al piso de abajo—: el que deja más lugar en el cuarto)
   if(c.caracol){const m=[r.x+r.w/2,r.y+r.h/2],ops=[[[1,0],q.x+q.w-r.x-r.w],[[0,1],q.y+q.h-r.y-r.h],[[-1,0],r.x-q.x],[[0,-1],r.y-q.y]].map(([d,l])=>({d,l,p:[m[0]+d[0]*r.w/2,m[1]+d[1]*r.h/2]})).filter(o=>llegaBien(o.p,o.d)).sort((a,b)=>b.l-a.l);
    if(!ops.length)continue;return {...r,tipo:'caracol',eje:null,pie:m,llegada:ops[0].p,cuarto:q.id,peldanos:DUPLEX.caracol.peldanos};}
   const ds=(lv.doors||[]).filter(d=>d.a===q.id||d.b===q.id).map(d=>[(d.x0+d.x1)/2,(d.y0+d.y1)/2]),p0=h?[r.x,r.y+r.h/2]:[r.x+r.w/2,r.y],p1=h?[r.x+r.w,r.y+r.h/2]:[r.x+r.w/2,r.y+r.h];
   const lejos=p=>ds.length?Math.min(...ds.map(d=>Math.hypot(d[0]-p[0],d[1]-p[1]))):0;let [pie,llegada]=lejos(p0)<=lejos(p1)?[p0,p1]:[p1,p0];
   const dir=(a,b)=>{const l=Math.hypot(b[0]-a[0],b[1]-a[1]);return [(b[0]-a[0])/l,(b[1]-a[1])/l];};
   if(!llegaBien(llegada,dir(pie,llegada))){if(!llegaBien(pie,dir(llegada,pie)))continue;[pie,llegada]=[llegada,pie];}
   return {...r,tipo:'recta',eje:h?'x':'z',pie,llegada,cuarto:q.id,peldanos:E.peldanos};}}
 return null;}

// Lo de arriba de un departamento U (su rectángulo) con su escalera: altillo, y si entra, la franja del baño y el vestidor.
function arribaDe(L,U,esc,n){const rooms=[],doors=[],windows=[],largoX=U.w>=U.h,largo=largoX?U.w:U.h,F=DUPLEX.franja;
 let franja=null;
 if(largo-F>=DUPLEX.altilloMin-1e-6&&(largoX?U.h:U.w)>=DUPLEX.bano+1-1e-6){
  // (las dos puntas; la que no pisa la escalera —con medio metro de aire—, y de las dos, la más lejos de su llegada)
  const puntas=(largoX?[{x:U.x,y:U.y,w:F,h:U.h},{x:U.x+U.w-F,y:U.y,w:F,h:U.h}]:[{x:U.x,y:U.y,w:U.w,h:F},{x:U.x,y:U.y+U.h-F,w:U.w,h:F}]).filter(p=>!pisa(p,{x:esc.x-.5,y:esc.y-.5,w:esc.w+1,h:esc.h+1}));
  franja=puntas.sort((a,b)=>Math.hypot(b.x+b.w/2-esc.llegada[0],b.y+b.h/2-esc.llegada[1])-Math.hypot(a.x+a.w/2-esc.llegada[0],a.y+a.h/2-esc.llegada[1]))[0]||null;}
 const alt=franja?(largoX?(franja.x===U.x?{x:U.x+F,y:U.y,w:U.w-F,h:U.h}:{x:U.x,y:U.y,w:U.w-F,h:U.h}):(franja.y===U.y?{x:U.x,y:U.y+F,w:U.w,h:U.h-F}:{x:U.x,y:U.y,w:U.w,h:U.h-F})):{...U};
 const id=()=>rooms.length;rooms.push({id:id(),type:'altillo',...alt,unit:n});
 if(franja){const B=DUPLEX.bano,ban=largoX?{x:franja.x,y:franja.y,w:F,h:B}:{x:franja.x,y:franja.y,w:B,h:F},ves=largoX?{x:franja.x,y:franja.y+B,w:F,h:franja.h-B}:{x:franja.x+B,y:franja.y,w:franja.w-B,h:F};
  const b=id();rooms.push({id:b,type:'bano',...ban,unit:n,doorTo:0});const v=ves.w*ves.h>=2-1e-6?id():null;if(v!=null)rooms.push({id:v,type:'vestidor',...ves,unit:n,doorTo:0});
  // (las puertas, en el borde que comparten con el altillo, a 30 cm de la esquina de adentro)
  for(const [k,q] of [[b,ban],[v,ves]]){if(k==null)continue;if(largoX){const xb=franja.x===U.x?q.x+q.w:q.x,y0=q.y+.3;doors.push({x0:xb,y0,x1:xb,y1:y0+.8,a:k,b:0});}else{const yb=franja.y===U.y?q.y+q.h:q.y,x0=q.x+.3;doors.push({x0,y0:yb,x1:x0+.8,y1:yb,a:k,b:0});}}}
 // las buhardillas: una por módulo de 2 m entero en cada borde del altillo que da a una fachada
 const A=rooms[0];for(const [h,fija,a0,a1] of [[true,A.y,A.x,A.x+A.w],[true,A.y+A.h,A.x,A.x+A.w],[false,A.x,A.y,A.y+A.h],[false,A.x+A.w,A.y,A.y+A.h]]){
  for(let m=Math.ceil(a0/2-1e-6)*2;m+2<=a1+1e-6;m+=2){const x=h?m+1:fija,z=h?fija:m+1;if(!FACHADA.has(ladoDe(L,x,z)))continue;windows.push(h?{x0:m+.4,y0:fija,x1:m+1.6,y1:fija,buhardilla:true,a:0}:{x0:fija,y0:m+.4,x1:fija,y1:m+1.6,buhardilla:true,a:0});}}
 return {rooms,doors,windows,area:rooms.reduce((s,q)=>s+q.w*q.h,0)};}

export function duplexDe(bp){let n=0,no=0;
 for(const L of bp.lots){delete L.duplex;if(!L.mansarda||(L.floors||0)<2)continue;const top=L.levels[L.floors-1];if(!top?.units?.length)continue;delete top.escalerasInternas;
  const unidades=[];
  for(const u of top.units){const qs=top.rooms.filter(q=>q.unit===u.n),U={x:u.x,y:u.y,w:u.w,h:u.h};if(!qs.length)continue;
   const esc=escaleraDe(L,top,qs);if(!esc){no++;continue;}
   const arriba=arribaDe(L,U,esc,u.n);
   // (la escalera llega al altillo: su hueco, adentro de él)
   if(!dentro(esc,arriba.rooms[0])){no++;continue;}
   (top.escalerasInternas||(top.escalerasInternas=[])).push({...esc,unit:u.n});unidades.push({n:u.n,escalera:esc,...arriba});n++;}
  if(unidades.length)L.duplex={nivel:L.floors,unidades};}
 return {duplex:n,sinLugar:no};}

// El nivel de la mansarda como un piso más (para dibujarlo y medirlo igual que los demás): los cuartos de todos los dúplex
// del edificio con su número de unidad, sus puertas y buhardillas, y los huecos de sus escaleras.
export function nivelMansarda(L){if(!L?.duplex)return null;const rooms=[],doors=[],windows=[],units=[],huecos=[];
 for(const u of L.duplex.unidades){const off=rooms.length;for(const q of u.rooms)rooms.push({...q,id:off+q.id});
  for(const d of u.doors)doors.push({...d,a:off+d.a,b:off+d.b});for(const w of u.windows)windows.push({...w,a:off+(w.a||0)});
  const xs=u.rooms.flatMap(q=>[q.x,q.x+q.w]),ys=u.rooms.flatMap(q=>[q.y,q.y+q.h]);units.push({n:u.n,x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)});
  huecos.push({...u.escalera,unit:u.n});}
 return {level:L.duplex.nivel,mansarda:true,rooms,doors,windows,units,corridor:[],core:null,furniture:[],huecos};}
// El piso f de un edificio: uno de los suyos, o la mansarda de los dúplex (f = L.floors).
export const nivelDe=(L,f)=>f<(L.floors||0)?L.levels[f]:nivelMansarda(L)||L.levels[Math.min(f,(L.floors||1)-1)];
