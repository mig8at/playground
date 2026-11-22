// QUÉ PIEZA VA EN CADA MÓDULO DE CADA FACHADA (2026-11-21, Miguel: «sigue con los planos: es lo único que matemáticamente
// nos puede ahorrar trabajo para el mapa completo», y «debemos tener cálculos exactos de grillas»).
//
// Hasta hoy esto lo decidía el 3D mientras armaba (lib/town3d.js) y el plano lo adivinaba. Ahora lo decide el plano, en
// su GRILLA, y el 3D lo lee:
//   · una casilla del mapa mide CELL (6 m) y cada lado suyo que da afuera tiene 3 MÓDULOS de 2 m (k = 0, 1, 2);
//   · cada módulo, en cada PISO (3 m), lleva UNA cosa: muro, ventana (con su modelo), ventanal, vidriera, puerta, puerta
//     doble, portón, balcón, o la mitad de una ventana doble (que ocupa dos módulos);
//   · de la pieza sale su vidrio exacto (fachada.js VIDRIO_PIEZA): un rectángulo dentro del módulo de 2 × 3 m.
// Las reglas, las mismas con las que el 3D armaba:
//   · contra un vecino igual de alto o más, ese lado no tiene fachada; contra uno más bajo, sólo de su techo para arriba;
//   · planta baja: la puerta de calle donde el plano la pone (doble si mide 1,6 m o más; portón si es de vehículos); la
//     vidriera donde hay una ventana de local —o cualquier ventana, si ahí no se vive—; si no, la ventana de su familia;
//   · arriba: la ventana que eligió el plano para ese cuarto (w.pieza) o, si no, la grande en el primer piso y la liviana
//     más arriba; el balcón, en el módulo del medio desde el segundo piso, sólo hacia afuera; la doble, en dos módulos
//     seguidos con ventana que no tengan un tabique en el medio (primero los dos de la izquierda).
// Puro: sale del plano, sin azar. modulosDeFachada(bp, L) da la lista; cada uno {lote, x, y, dx, dy, k, f, tipo, pieza}.
import {CELL} from './veredas.js';
import {ALTURA,esVidriera} from './medidas.js';
import {facadeStyle,LEGACY,WINDOWS,VIDRIO_PIEZA,VIDRIO_VENTANAL} from './fachada.js';

export const GRILLA_FACHADA={casilla:CELL,modulo:2,modulos:3,piso:ALTURA.piso};
export const PUBLICOS=new Set(['hospital','bomberos','colegio','mercado','biblioteca','cine','comisaria']);
// El estilo de fachada con el que se arma un edificio: el suyo o, en los públicos y los objetivos, el de siempre.
export const estiloDeLote=B=>B.fachada&&!PUBLICOS.has(B.type)&&B.type!=='objetivo'?facadeStyle(B.fachada):facadeStyle({estilo:LEGACY.ladrillo||'casona'});
export const VENTANAL='ventanal';// (la pieza propia del ventanal de vivienda: el 3D le pone su nombre según el material)

const celdas=new WeakMap();
// De qué edificio es cada casilla del mapa (−1: de ninguno).
function loteEn(bp){let M=celdas.get(bp);if(!M){const W=bp.map.W,H=bp.map.H,o=new Int32Array(W*H).fill(-1);for(const L of bp.lots)for(const p of L.parts||[])for(let y=p.y/CELL;y<(p.y+p.h)/CELL;y++)for(let x=p.x/CELL;x<(p.x+p.w)/CELL;x++)o[y*W+x]=L.id;M={o,W,H};celdas.set(bp,M);}
 return (x,y)=>x>=0&&y>=0&&x<M.W&&y<M.H?M.o[y*M.W+x]:-1;}
const porLinea=list=>{const m=new Map();for(const s of list){const k=Math.abs(s.y0-s.y1)<1e-6?'h:'+s.y0.toFixed(2):'v:'+s.x0.toFixed(2);(m.get(k)||m.set(k,[]).get(k)).push(s);}return m;};
const aLoLargo=(s,h)=>h?[Math.min(s.x0,s.x1),Math.max(s.x0,s.x1)]:[Math.min(s.y0,s.y1),Math.max(s.y0,s.y1)];

export function modulosDeFachada(bp,B){const S=CELL,de=loteEn(bp),id=B.id,fs=estiloDeLote(B),out=[],floors=B.floors;if(!B.levels?.length)return out;
 const lines=B.levels.map(lv=>({w:porLinea(lv.windows||[]),d:porLinea((lv.doors||[]).filter(d=>d.street))}));
 const cells=[];for(const p of B.parts)for(let y=p.y/S;y<(p.y+p.h)/S;y++)for(let x=p.x/S;x<(p.x+p.w)/S;x++)cells.push([x,y]);
 for(const [x,y] of cells)for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(de(nx,ny)===id)continue;
  const ex=(x+.5+dx*.5)*S,ez=(y+.5+dy*.5)*S,tx=dy,tz=-dx,h=dy!==0,lineKey=h?'h:'+ez.toFixed(2):'v:'+ex.toFixed(2),other=de(nx,ny);
  let f0=0;if(other>=0){const O=bp.lots[other];if(O.floors>=floors)continue;f0=O.floors;}
  const hit=(list,coord)=>(list||[]).find(s=>{const [a,b]=aLoLargo(s,h);return coord>a-.01&&coord<b+.01;});
  const coordDe=k=>{const c=-S/2+1+2*k;return h?ex+tx*c:ez+tz*c;};
  const winMod=(k,f)=>f>0&&!!hit(lines[f].w.get(lineKey),coordDe(k));
  // los tabiques que llegan a esta fachada en el piso f: una ventana doble no se pone sobre uno
  const line=h?ez:ex,partsAt=f=>{const lv=B.levels[f],o=[];for(const q of [...lv.rooms,...lv.corridor,lv.core].filter(Boolean)){const toca=h?Math.abs(q.y-line)<.05||Math.abs(q.y+q.h-line)<.05:Math.abs(q.x-line)<.05||Math.abs(q.x+q.w-line)<.05;if(toca)o.push(...(h?[q.x,q.x+q.w]:[q.y,q.y+q.h]));}return o;};
  const freeEdge=(f,k)=>{const cb=-S/2+2+2*k,at=h?ex+tx*cb:ez+tz*cb;return !partsAt(f).some(p=>Math.abs(p-at)<.35);};
  const balconyAt=f=>fs.balconies&&f>=2&&other<0&&winMod(1,f);
  const pairOf=[];for(let f=0;f<floors;f++)pairOf[f]=fs.double&&f>=Math.max(1,f0)&&!balconyAt(f)?(winMod(0,f)&&winMod(1,f)&&freeEdge(f,0)?0:winMod(1,f)&&winMod(2,f)&&freeEdge(f,1)?1:-1):-1;
  for(let k=0;k<3;k++){const coord=coordDe(k);
   for(let f=f0;f<floors;f++){const win=hit(lines[f].w.get(lineKey),coord),door=f===0?hit(lines[f].d.get(lineKey),coord):null,pon=(tipo,pieza=null)=>out.push({lote:id,x,y,dx,dy,k,f,tipo,pieza});
    if(door&&door.bay){pon('porton');continue;}
    if(door){const dw=Math.hypot(door.x1-door.x0,door.y1-door.y0);if(dw>=1.6){pon('puerta_doble');out[out.length-1].ancho=+dw.toFixed(2);}else pon('puerta',fs.door);continue;}
    const vidriera=f===0&&!!win&&esVidriera(B.type,win),len=win?Math.hypot(win.x1-win.x0,win.y1-win.y0):0;
    const pieza=f===0&&!(win&&!vidriera)?(win?fs.shop:fs.wall):(win?(win.pieza==='ventanal'?VENTANAL:win.pieza&&WINDOWS[win.pieza]?WINDOWS[win.pieza].p:f<=1&&len>=1?fs.win1:fs.win):fs.plain);
    if(k===1&&balconyAt(f))pon('balcon',fs.door);
    else if(pairOf[f]===k)pon('doble',fs.double);
    else if(pairOf[f]<0||pairOf[f]!==k-1)pon(vidriera?'vidriera':win&&(f>0||!vidriera)&&pieza!==fs.plain&&pieza!==fs.wall?'ventana':'muro',pieza);
    else pon('doble2');}}}
 return out;}

// El vidrio exacto de un módulo, dentro de su rectángulo de 2 × 3 m: [x0, x1, y0, y1] desde el centro del módulo y desde
// su piso; null si es muro. La doble va centrada en la junta con el módulo siguiente (su vidrio pasa a ese módulo).
// LO QUE OCUPA CADA MÓDULO, CON SU MARCO (2026-11-21): el rectángulo que no es muro, [x0, x1, y0, y1] desde el centro del
// módulo y desde su piso; null si el módulo es muro (o la segunda mitad de una doble).
//   · ventana: su vidrio más el CERCO (marco de 8 cm, alféizar y dintel), sin salirse de su módulo;
//   · doble: lo mismo, sobre sus dos módulos;
//   · puerta: el vano de su marco, con el marco y el dintel (PUERTA_VANO: medido de las tres piezas del paquete como las
//     arma fachada3d.js —la de madera ocupa el módulo entero; la de piedra y la de metal, menos—);
//   · puerta doble: el ancho que dice el plano más su marco, hasta 2,6 m (encima queda un paño de muro de 40 cm);
//   · vidriera, portón y balcón: el módulo entero (la losa del balcón sale delante del muro: no es vano).
export const CERCO={lado:.16,abajo:.24,arriba:.26};
export const PUERTA_VANO={DoorFrame_Wooden:[-1,1,0,3],DoorFrame_Trim:[-.68,.68,0,2.96],DoorFrame_Metal_Single:[-.57,.57,0,2.93]};
export const PUERTA_DOBLE_ALTO=2.6;
export function vanoDeModulo(m){const cl=(v,a,b)=>Math.max(a,Math.min(b,v));
 if(m.tipo==='ventana'||m.tipo==='doble'){const g=vidrioDeModulo(m),x1=m.tipo==='doble'?3:1;return g?[cl(g[0]-CERCO.lado,-1,x1),cl(g[1]+CERCO.lado,-1,x1),cl(g[2]-CERCO.abajo,0,3),cl(g[3]+CERCO.arriba,0,3)]:[-1,x1,.3,2.8];}
 if(m.tipo==='puerta')return PUERTA_VANO[m.pieza]||[-1,1,0,3];
 if(m.tipo==='puerta_doble'){const a=cl((m.ancho||1.8)/2+.16,0,1);return [-a,a,0,PUERTA_DOBLE_ALTO];}
 if(m.tipo==='vidriera'||m.tipo==='porton')return [-1,1,0,3];
 // (2026-11-22, Miguel: «esto debería ser lineal, sin sobreposiciones: ¿por qué el morado baja más de su planta?»: el
 // balcón ocupaba desde −0,15 —el canto de su losa— y se metía 15 cm en el piso de abajo. La losa sale hacia afuera, delante
 // del muro: en el plano de la fachada el vano es la puerta, de su piso al de arriba, como todo módulo)
 if(m.tipo==='balcon')return [-1,1,0,3];
 return null;}
export function vidrioDeModulo(m){if(m.tipo==='ventana')return m.pieza===VENTANAL?VIDRIO_VENTANAL:VIDRIO_PIEZA[m.pieza]||null;if(m.tipo==='doble'){const g=VIDRIO_PIEZA[m.pieza];return g?[g[0]+1,g[1]+1,g[2],g[3]]:null;}return null;}
