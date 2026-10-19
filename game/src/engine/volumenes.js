/* Los volúmenes de un edificio, calculados del plano (2026-10-15): cada pared con su grosor real, cortada por sus
   vanos, piso por piso. Datos puros en metros (sin THREE): los usa el validador (scripts/validar-ciudad.mjs) y, más
   adelante, el 3D en lugar de su propio cálculo (town3d.js hace hoy lo mismo por su cuenta: OPEN, GLASS, rangos).

   Una pared: {x0,y0,x1,y1} su línea (horizontal: y0===y1), t su grosor, kind 'tabique' | 'vidrio' | 'reja' | 'fachada',
   y rect {x,y,w,h} lo que ocupa en planta. */
import {MURO} from './medidas.js';

// Cuartos sin tabique hacia el pasillo (abiertos) y con tabique de vidrio (copiado de town3d.js; pasará al catálogo).
export const SIN_TABIQUE=new Set(['abierta','recepcion','lectura','prestamo','comedor']);
export const TABIQUE_VIDRIO=new Set(['oficina','reuniones','sala_prof','consultorio','enfermeria','secretaria','interrogatorio']);
const KIND={2:'tabique',1.5:'reja',1:'vidrio'};
const E=1e-6;

const inRect=(r,x,y)=>x>r.x&&x<r.x+r.w&&y>r.y&&y<r.y+r.h;
// El tramo [a,b] de una puerta o ventana sobre su línea: horizontal (h) si corre en x.
export const spanOf=d=>{const h=Math.abs(d.y0-d.y1)<E;return {h,at:h?d.y0:d.x0,a:Math.min(h?d.x0:d.y0,h?d.x1:d.y1),b:Math.max(h?d.x0:d.y0,h?d.x1:d.y1)};};

export function volumesOf(L){
 const parts=L.parts||[],outside=(x,y)=>!parts.some(p=>inRect(p,x,y));
 return L.levels.map(lv=>{
  const inCorr=(x,y)=>lv.corridor.some(c=>inRect(c,x,y));
  const segs=new Map(),add=(h,at,a,b,rank)=>{const k=(h?'h:':'v:')+at.toFixed(3);(segs.get(k)||segs.set(k,{h,at,list:[]}).get(k)).list.push([a,b,rank]);};
  for(const q of lv.rooms)for(const [h,at,a,b,dir] of [[true,q.y,q.x,q.x+q.w,-1],[true,q.y+q.h,q.x,q.x+q.w,1],[false,q.x,q.y,q.y+q.h,-1],[false,q.x+q.w,q.y,q.y+q.h,1]]){
   const m=(a+b)/2,[px,py]=h?[m,at+dir*.15]:[at+dir*.15,m];
   add(h,at,a,b,SIN_TABIQUE.has(q.type)&&inCorr(px,py)?0:q.type==='celda'?(inCorr(px,py)?1.5:2):TABIQUE_VIDRIO.has(q.type)?1:2);}
  // El núcleo, un módulo cerrado: su contorno y, con ascensor, la caja del ascensor a todo el fondo.
  const rectW=r=>{add(true,r.y,r.x,r.x+r.w,2);add(true,r.y+r.h,r.x,r.x+r.w,2);add(false,r.x,r.y,r.y+r.h,2);add(false,r.x+r.w,r.y,r.y+r.h,2);};
  if(lv.core){rectW(lv.core);if(lv.liftRect){const C=lv.core,Q=lv.liftRect,ux=lv.stair?Math.abs(lv.stair.ux)>.5:Math.abs(Q.w-C.w)>.01;rectW(ux?{x:Q.x,y:C.y,w:Q.w,h:C.h}:{x:C.x,y:Q.y,w:C.w,h:Q.h});}}
  const openings=[...lv.doors.filter(d=>!d.street).map(d=>({...spanOf(d),d}))];
  const walls=[],ends=[...new Set(parts.flatMap(r=>[r.x,r.x+r.w,r.y,r.y+r.h]))];
  for(const {h,at,list} of segs.values()){
   // los tramos elementales con el rango más cerrado que los cubre, juntados por rango
   const pts=[...new Set(list.flatMap(([a,b])=>[a,b]))].sort((a,b)=>a-b),merged=[];
   for(let i=0;i+1<pts.length;i++){const a=pts[i],b=pts[i+1],m=(a+b)/2,cov=list.filter(([p,q])=>m>p&&m<q);if(!cov.length)continue;const rank=Math.max(...cov.map(c=>c[2])),l=merged[merged.length-1];
    if(l&&l[2]===rank&&Math.abs(l[1]-a)<E)l[1]=b;else merged.push([a,b,rank]);}
   const cuts=openings.filter(o=>o.h===h&&Math.abs(o.at-at)<E).map(o=>[o.a,o.b]).sort((x,y)=>x[0]-y[0]);
   for(const [a,b,rank] of merged){if(rank===0)continue;
    let pieces=[[a,b]];for(const [c0,c1] of cuts)pieces=pieces.flatMap(([p,q])=>c1<=p||c0>=q?[[p,q]]:[[p,c0],[c1,q]].filter(([u,v])=>v-u>E));
    // (partido donde empieza o termina una parte del edificio, como en town3d.js)
    const ee=ends.filter(e=>pieces.some(([p,q])=>e>p+.05&&e<q-.05));
    pieces=pieces.flatMap(([p,q])=>{const cs=[p,...ee.filter(e=>e>p+.05&&e<q-.05).sort((u,v)=>u-v),q];return cs.slice(1).map((e,i)=>[cs[i],e]);});
    for(let [p,q] of pieces){const m=(p+q)/2,[px,py]=h?[m,at]:[at,m];
     if(h?outside(px,py-.1)||outside(px,py+.1):outside(px-.1,py)||outside(px+.1,py))continue;// borde de afuera: es fachada
     // la punta que llega a una fachada se corta donde empieza la cara de adentro de la fachada
     const fa=MURO.fachada;if(h?outside(p-.05,at):outside(at,p-.05))p+=fa;if(h?outside(q+.05,at):outside(at,q+.05))q-=fa;
     const t=MURO.tabique,len=q-p;walls.push({h,at,a:p,b:q,t,kind:KIND[rank],len,rect:h?{x:p,y:at-t/2,w:len,h:t}:{x:at-t/2,y:p,w:t,h:len}});}}}
  // Las fachadas: los bordes de las partes que dan afuera, con su grosor hacia adentro.
  for(const r of parts)for(const [h,at,a,b,dir] of [[true,r.y,r.x,r.x+r.w,1],[true,r.y+r.h,r.x,r.x+r.w,-1],[false,r.x,r.y,r.y+r.h,1],[false,r.x+r.w,r.y,r.y+r.h,-1]]){
   // (sólo lo que de verdad da afuera: un borde compartido con otra parte no es fachada)
   const cs=[a,...ends.filter(e=>e>a+E&&e<b-E).sort((u,v)=>u-v),b];
   for(let i=0;i+1<cs.length;i++){const p=cs[i],q=cs[i+1],m=(p+q)/2,[ox,oy]=h?[m,at-dir*.1]:[at-dir*.1,m];if(!outside(ox,oy))continue;
    const t=MURO.fachada;walls.push({h,at,a:p,b:q,t,kind:'fachada',dir,len:q-p,rect:h?{x:p,y:dir>0?at:at-t,w:q-p,h:t}:{x:dir>0?at:at-t,y:p,w:t,h:q-p}});}}
  return {level:lv.level,walls,lv};});
}
