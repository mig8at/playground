// Los techos de la ciudad (2026-10-18): la mansarda, en el 2D. Para cada lote con techo «mansarda» (fachada.js), los
// bordes de su pendiente —cada lado de casilla del techo que es fachada: el que no da a un lote igual de alto o más,
// la misma regla con que town3d pone las piezas de pizarra— con la normal hacia adentro, y la cubierta plana de arriba
// (cada parte del lote, retirada MANSARDA.cubierta de esos lados). alturaMansarda(M, x, z): cuánto sube el techo en
// (x, z) sobre el último piso —0 al pie de la pendiente, MANSARDA.alto arriba—; lo pisa la física (world3d floorAt) y
// lo mide validar-mansarda. Coordenadas del plano: metros, x a la derecha, z (= y del plano) hacia abajo.
import {MANSARDA} from './medidas.js';
const CELL=6;

export function marcarMansardas(bp){const own=new Map();
 bp.lots.forEach((L,i)=>{for(const p of L.parts||[])for(let y=p.y/CELL;y<(p.y+p.h)/CELL;y++)for(let x=p.x/CELL;x<(p.x+p.w)/CELL;x++)own.set(x+','+y,i);});
 bp.lots.forEach((L,i)=>{delete L.mansarda;if(L.fachada?.techo!=='mansarda'||!L.parts?.length)return;const bordes=[];
  for(const p of L.parts)for(let y=p.y/CELL;y<(p.y+p.h)/CELL;y++)for(let x=p.x/CELL;x<(p.x+p.w)/CELL;x++)
   for(const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]){const o=own.get((x+dx)+','+(y+dy));if(o===i||(o!=null&&bp.lots[o].floors>=L.floors))continue;
    // el lado de la casilla que da hacia (dx, dy), con la normal hacia adentro del techo
    if(dy)bordes.push({eje:'x',a0:x*CELL,a1:(x+1)*CELL,en:(dy<0?y:y+1)*CELL,n:-dy});else bordes.push({eje:'z',a0:y*CELL,a1:(y+1)*CELL,en:(dx<0?x:x+1)*CELL,n:-dx});}
  // (la caseta del ascensor: donde el núcleo con ascensor llega a menos de retiro de un borde, ese tramo no tiene pendiente
  // —el núcleo sube derecho hasta la cubierta, como en los edificios de verdad—: la parada del techo queda en lo plano)
  const core=L.levels?.find(l=>l.core?.lift)?.core,R=MANSARDA.retiro,toca=b=>core&&(b.eje==='x'?b.a1>core.x+1e-6&&b.a0<core.x+core.w-1e-6&&b.en>core.y-R-1e-6&&b.en<core.y+core.h+R+1e-6
   :b.a1>core.y+1e-6&&b.a0<core.y+core.h-1e-6&&b.en>core.x-R-1e-6&&b.en<core.x+core.w+R+1e-6);
  const pend=bordes.filter(b=>!toca(b));
  // la cubierta, casilla por casilla: cada una retirada MANSARDA.cubierta de sus lados con pendiente (por partes quedaban
  // huecos en los lotes en L: validar-mansarda)
  const C=MANSARDA.cubierta,es=(eje,en,a0,a1)=>pend.some(b=>b.eje===eje&&Math.abs(b.en-en)<1e-6&&Math.abs(b.a0-a0)<1e-6&&Math.abs(b.a1-a1)<1e-6),cubierta=[];
  for(const p of L.parts)for(let y=p.y/CELL;y<(p.y+p.h)/CELL;y++)for(let x=p.x/CELL;x<(p.x+p.w)/CELL;x++){const X0=x*CELL,X1=X0+CELL,Z0=y*CELL,Z1=Z0+CELL;
   const c={x0:X0+(es('z',X0,Z0,Z1)?C:0),x1:X1-(es('z',X1,Z0,Z1)?C:0),z0:Z0+(es('x',Z0,X0,X1)?C:0),z1:Z1-(es('x',Z1,X0,X1)?C:0)};if(c.x1-c.x0>.05&&c.z1-c.z0>.05)cubierta.push(c);}
  L.mansarda={alto:MANSARDA.alto,retiro:MANSARDA.retiro,bordes:pend,caseta:bordes.length-pend.length,cubierta};});}
// ¿hay pendiente de mansarda en el punto (x, z) de la fachada? (el 3D pone ahí la pieza de pizarra; si no, muro derecho)
export const pendienteEn=(M,x,z)=>!!M&&M.bordes.some(b=>{const a=b.eje==='x'?x:z,p=b.eje==='x'?z:x;return a>b.a0-1e-6&&a<b.a1+1e-6&&Math.abs(p-b.en)<.05;});

// cuánto sube la mansarda en (x, z) sobre el techo del último piso: la distancia al borde de pendiente más cercano
// (medida de frente, dentro de su tramo), por la pendiente, hasta alto
export function alturaMansarda(M,x,z){let d=Infinity;
 for(const b of M.bordes){const a=b.eje==='x'?x:z,p=b.eje==='x'?z:x;if(a<b.a0-1e-6||a>b.a1+1e-6)continue;const dd=(p-b.en)*b.n;if(dd>=-1e-6&&dd<d)d=dd;}
 return M.alto*Math.min(1,Math.max(0,d)/M.retiro);}
