// LAS PROPIEDADES DE UNA CIUDAD (2026-11-21, Miguel: «un mundo donde la gente compra propiedades: su casa, su departamento,
// y se lo puede vender a otro»).
//
// El plano ya tiene cada unidad medida; esto la vuelve una PROPIEDAD: algo con un identificador que no cambia, una
// dirección, un área y un precio base. Sale sólo del plano, sin azar: la misma ciudad da siempre el mismo listado, que
// es lo que necesita un servidor para saber qué se vende y de quién es. No guarda dueños ni cobra nada.
//
// QUÉ ES UNA PROPIEDAD
//   · departamento: una unidad de un edificio (los cuartos con el mismo número en un piso);
//   · local: cada cuarto de comercio a la calle;
//   · casa: un lote de casa dentro de la ciudad, entero;
//   · casa del monte: cada casa de afuera de la muralla.
// Oficinas, hoteles y edificios públicos no se venden por ahora.
//
// EL PRECIO BASE (una propuesta de partida: todo sale de PRECIO, para cambiarlo en un lugar)
//   área × PRECIO.m2 × clase × centro × piso × parque, redondeado a PRECIO.redondeo.
//   · clase: un local vale más por metro que una vivienda (da a la calle y produce); una casa, más que un departamento;
//   · centro: de 1 en el borde de la ciudad a 1 + PRECIO.centro en el centro (la casa del monte no lo lleva);
//   · piso: + PRECIO.porPiso por cada piso de altura, hasta PRECIO.pisoMax (vista y menos ruido);
//   · parque: + PRECIO.parque si el edificio está a menos de PRECIO.cercaParque metros de un parque.
import {CELL} from './blueprint.js';

// (duplex, 2026-11-22: el departamento del último piso con su mansarda —engine/duplex.js— suma el área de los dos niveles y
// vale PRECIO.duplex más por metro: dos niveles, el piso más alto y la escalera propia. Miguel: «serían los más caros»)
export const PRECIO={m2:1000,redondeo:100,clase:{departamento:1,local:1.6,casa:1.25,casa_monte:1.1},centro:.5,porPiso:.03,pisoMax:.24,parque:.1,cercaParque:12,duplex:.25};
export const CLASE={departamento:'Departamento',local:'Local',casa:'Casa',casa_monte:'Casa del monte'};
const r2=v=>Math.round(v*100)/100;

export function precioDe({clase,area,centro=0,piso=0,parque=false,duplex=false}){const f={clase:PRECIO.clase[clase]||1,centro:1+PRECIO.centro*centro,piso:1+Math.min(PRECIO.pisoMax,PRECIO.porPiso*piso),parque:parque?1+PRECIO.parque:1,duplex:duplex?1+PRECIO.duplex:1};
 return {precio:Math.round(area*PRECIO.m2*f.clase*f.centro*f.piso*f.parque*f.duplex/PRECIO.redondeo)*PRECIO.redondeo,factores:{clase:f.clase,centro:r2(f.centro),piso:r2(f.piso),parque:f.parque,duplex:f.duplex}};}

export function propiedadesDe(bp){const {W,H}=bp.map,cx=W*CELL/2,cz=H*CELL/2,dmax=Math.hypot(cx,cz),out=[];
 // (cerca de un parque: la huella del lote a menos de cercaParque del rectángulo del parque, en metros)
 const parques=(bp.map.parks||[]).map(p=>({x0:p.x0*CELL,z0:p.y0*CELL,x1:(p.x1+1)*CELL,z1:(p.y1+1)*CELL}));
 const cercaParque=R=>parques.some(p=>Math.hypot(Math.max(p.x0-(R.x+R.w),R.x-p.x1,0),Math.max(p.z0-(R.y+R.h),R.y-p.z1,0))<PRECIO.cercaParque);
 const area=qs=>r2(qs.reduce((a,q)=>a+q.w*q.h,0));
 for(const L of bp.lots){const R=L.rect,centro=r2(Math.max(0,1-Math.hypot(R.x+R.w/2-cx,R.y+R.h/2-cz)/dmax)),parque=cercaParque(R);
  const puerta=L.levels?.[0]?.doors?.find(d=>d.street&&d.direccion),dir=puerta?.direccion?.texto||null,base={lote:L.id,edificio:L.shopName||L.name||null,direccion:dir,centro,parque};
  const pon=(p)=>out.push({...base,...p,...precioDe({...p,centro,parque})});
  if(L.type==='casa'){const qs=L.levels.slice(0,L.floors).flatMap(lv=>lv.rooms);pon({id:`L${L.id}-CASA`,clase:'casa',piso:0,unidad:null,area:area(qs),cuartos:qs.length,nombre:L.name||'Casa'});continue;}
  L.levels.slice(0,L.floors).forEach((lv,piso)=>{
   // los departamentos: los cuartos de cada número de unidad
   const porUnidad=new Map();for(const q of lv.rooms)if(q.unit!=null)(porUnidad.get(q.unit)||porUnidad.set(q.unit,[]).get(q.unit)).push(q);
   // (el dúplex: el departamento del último piso con su mansarda; suma los cuartos y el área de arriba)
   for(const [n,qs] of [...porUnidad].sort((a,b)=>a[0]-b[0])){const dx=piso===L.floors-1?L.duplex?.unidades.find(u=>u.n===n):null;
    pon({id:`L${L.id}-${n}`,clase:'departamento',piso,unidad:n,area:r2(area(qs)+(dx?.area||0)),cuartos:qs.length+(dx?dx.rooms.length:0),dormitorios:qs.filter(q=>q.type==='dormitorio').length+(dx?dx.rooms.filter(q=>q.type==='dormitorio').length:0),nombre:dx?`Dúplex ${n}`:`Apto ${n}`,...(dx?{duplex:true,niveles:2,areaArriba:dx.area}:{})});}
   // los locales: cada cuarto de comercio, numerados de izquierda a derecha y de arriba abajo
   lv.rooms.filter(q=>q.type==='local'&&q.unit==null).sort((a,b)=>a.y-b.y||a.x-b.x).forEach((q,i)=>pon({id:`L${L.id}-P${piso}-LOC${i+1}`,clase:'local',piso,unidad:i+1,area:area([q]),cuartos:1,nombre:`Local ${i+1}`}));});}
 (bp.isla?.casas||[]).forEach((c,i)=>{const HG=c.spec?.hogar;if(!HG)return;const p={id:`M${i}`,clase:'casa_monte',piso:0,unidad:null,area:r2(HG.area),cuartos:HG.levels.reduce((a,lv)=>a+lv.rooms.length,0),nombre:HG.label||'Casa',lote:null,edificio:null,direccion:c.direccion?.texto||null,centro:0,parque:false,casa:i};
  out.push({...p,...precioDe(p)});});
 return out;}

// El resumen de un listado: cuántas hay de cada clase, con su área y su valor.
export function resumenDe(props){const por={};let valor=0,area=0;for(const p of props){const c=por[p.clase]||(por[p.clase]={n:0,area:0,valor:0,min:Infinity,max:0});c.n++;c.area+=p.area;c.valor+=p.precio;c.min=Math.min(c.min,p.precio);c.max=Math.max(c.max,p.precio);valor+=p.precio;area+=p.area;}
 return {n:props.length,area:Math.round(area),valor,por};}
