// LOS CONTENEDORES DE BASURA, EN SU LUGAR EXACTO (2026-11-21, Miguel: «los de basura a veces los veo sobre la calle: eso
// tiene que estar sobre el andén o en un lugar específico, y se cuadra desde el mapa 2D»).
//
// El motor del juego elige en qué CASILLA va cada contenedor (map.hideouts: el centro de una casilla de calle). Una calle
// mide dos casillas, así que ese centro cae justo sobre el cordón, medio contenedor en el asfalto, y el 3D además lo
// giraba al azar. Acá el plano decide el lugar de verdad, en metros, dentro de esa misma casilla:
//   · sobre el andén, contra la fachada: su eje a `fachada + fondo/2` de la línea de edificación (CALLE.fachada: la franja
//     que se deja libre contra el muro), o sea que le quedan más de 1,2 m de paso libre hasta el cordón;
//   · paralelo a la fachada (el largo a lo largo de la calle), no girado al azar;
//   · corrido a lo largo de la fachada si cae frente a una puerta o una vidriera, o encima de un árbol o de una pieza de
//     mobiliario; si no hay lugar libre, se queda donde menos estorba y lo dice: `anteVidriera` (toda la fachada es
//     vidriera: no tiene dónde más) o `estorba` (encima de algo o frente a una puerta: eso sí es un defecto).
// Una casilla sin manzana al lado (el medio de un cruce) no tiene andén: el contenedor se corre al andén más cercano
// (`corrido`); si no hay ninguno a 3 casillas, se deja en el centro y se anota `sinAnden`, para que la auditoría lo cuente.
import {CELL} from './blueprint.js';
import {CALLE} from './medidas.js';

export const CONTENEDOR={largo:1.8,fondo:1.05};// (m: el del catálogo de objetos, objetos3d.js)
const K_VIA=new Set([0,1]);// street, avenue

export function contenedoresDe(bp){const M=bp.map,{W,H,kind}=M,via=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&K_VIA.has(kind[y*W+x]),dentro=(x,y)=>x>=0&&y>=0&&x<W&&y<H;
 // lo que hay que esquivar: los vanos de calle (puertas y vidrieras), los troncos y el mobiliario
 const vanos=[];for(const L of bp.lots){const lv=L.levels?.[0];if(!lv)continue;for(const d of lv.doors||[])if(d.street)vanos.push(d);for(const w of lv.windows||[])if(w.shop)vanos.push(w);}
 const puntos=[...(bp.vegetacion?.arboles||[]).filter(a=>a.tipo==='calle'||a.tipo==='avenida').map(a=>({x:a.x,z:a.z,r:.5})),...(bp.equipamiento||[]).filter(e=>e.tipo!=='cebra').map(e=>({x:e.x,z:e.z,r:.6}))];
 const out=[],d0=CALLE.fachada+CONTENEDOR.fondo/2;
 const ladoDe=(x,y)=>[[0,-1],[0,1],[-1,0],[1,0]].find(([dx,dy])=>dentro(x+dx,y+dy)&&!via(x+dx,y+dy));
 for(const h of M.hideouts||[]){let cx=Math.floor(h.x),cy=Math.floor(h.y),corrido=0;
  // el lado de la casilla que da a una manzana (lo que no es vía ni está fuera del mapa)
  let lado=ladoDe(cx,cy);
  // (en medio de un cruce no hay andén: se corre a la casilla de vía con andén más cercana, hasta 3 casillas, y se anota
  // cuánto —`corrido`, en metros—; el escondite del juego sigue en su casilla)
  if(!lado){let mejor=null;for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){const x=cx+dx,y=cy+dy;if(!via(x,y)||!ladoDe(x,y))continue;const d=Math.hypot(dx,dy);if(!mejor||d<mejor.d)mejor={x,y,d};}
   if(mejor){cx=mejor.x;cy=mejor.y;lado=ladoDe(cx,cy);corrido=+(mejor.d*CELL).toFixed(1);}}
  if(!lado){out.push({id:h.id,x:+(h.x*CELL).toFixed(2),z:+(h.y*CELL).toFixed(2),ang:0,sinAnden:true});continue;}
  const [dx,dy]=lado,horiz=dy!==0;// (horiz: la fachada corre a lo largo de x)
  // el eje del contenedor: a d0 de la línea de edificación
  const fijo=horiz?(dy<0?cy*CELL+d0:(cy+1)*CELL-d0):(dx<0?cx*CELL+d0:(cx+1)*CELL-d0),a0=(horiz?cx:cy)*CELL,L2=CONTENEDOR.largo/2,F2=CONTENEDOR.fondo/2;
  const linea=horiz?(dy<0?cy*CELL:(cy+1)*CELL):(dx<0?cx*CELL:(cx+1)*CELL);
  // cuánto estorba en el punto t (a lo largo de la fachada): un vano que se le superpone y está en su línea, o algo encima
  const estorbo=t=>{let e=0;for(const v of vanos){const enLinea=horiz?Math.abs(v.y0-linea)<.3&&Math.abs(v.y1-linea)<.3:Math.abs(v.x0-linea)<.3&&Math.abs(v.x1-linea)<.3;if(!enLinea)continue;
    const p=horiz?Math.min(v.x0,v.x1):Math.min(v.y0,v.y1),q=horiz?Math.max(v.x0,v.x1):Math.max(v.y0,v.y1);if(Math.min(t+L2,q)-Math.max(t-L2,p)>-.3)e+=v.shop?1:3;}
   for(const p of puntos){const u=horiz?p.x:p.z,w=horiz?p.z:p.x;if(Math.abs(u-t)<L2+p.r&&Math.abs(w-fijo)<F2+p.r)e+=2;}return e;};
  // de lo más cerca del centro de la casilla hacia las puntas, sin salir de ella
  // (y, si en su casilla no hay lugar libre, sigue por el mismo andén hasta 6 m más allá, mientras siga habiendo andén)
  const hayAnden=t=>{for(const u of [t-L2,t+L2]){const c=Math.floor(u/CELL),x=horiz?c:cx,y=horiz?cy:c;if(!via(x,y)||via(x+dx,y+dy)||!dentro(x+dx,y+dy))return false;}return true;};
  let mejor=null;busca:for(let k=0;k<=36;k++)for(const s of k?[1,-1]:[1]){const t=a0+CELL/2+s*k*.25;if(!hayAnden(t))continue;const e=estorbo(t)+(k>8?.5:0);if(!mejor||e<mejor.e)mejor={t,e};if(!e)break busca;}
  if(mejor&&mejor.e<1)mejor.e=0;
  const t=mejor?mejor.t:a0+CELL/2;
  out.push({id:h.id,x:+(horiz?t:fijo).toFixed(2),z:+(horiz?fijo:t).toFixed(2),ang:horiz?0:Math.PI/2,...(mejor?.e>=2?{estorba:mejor.e}:mejor?.e?{anteVidriera:true}:{}),...(corrido?{corrido}:{})});}
 return out;}
