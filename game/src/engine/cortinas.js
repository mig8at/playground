// ======== Las cortinas cerradas (2026-10-16, idea de Miguel) ========
// cerrarCortinas(bp): por unidad —un departamento, una oficina, un cuarto de hotel (los cuartos con el mismo q.unit, o
// cada cuarto si no tiene)— un sorteo fijo con la probabilidad del tipo del edificio (CORTINA.cerradas) decide si tiene
// las cortinas cerradas; si sí, cada ventana de sus cuartos de CORTINA.cuartos lleva w.cortina = la tela (un color por
// unidad). Las vidrieras de los locales, nunca. Las casas del monte: h.cortinas = {tela, cuartos: [ids]} en la casa —su
// plano se comparte entre casas (hogar.js)—. Determinista. Puro.
import {CORTINA} from './medidas.js';

const sorteo=(...k)=>{let h=0x811C9DC5;for(const v of k){const s=String(v);for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),0x01000193)>>>0;h=Math.imul(h^0x2c,0x01000193)>>>0;}h^=h>>>13;h=Math.imul(h,0x5bd1e995)>>>0;h^=h>>>15;return (h>>>0)/4294967296;};
const CUARTOS=new Set(CORTINA.cuartos);
// El cuarto de una ventana (la ventana en uno de sus bordes y dentro de él) y el lado: edge 1 si el cuarto está hacia +.
export function cuartoDeVentana(lv,w){const h=Math.abs(w.y0-w.y1)<1e-3,at=h?w.y0:w.x0,[u,v]=h?[Math.min(w.x0,w.x1),Math.max(w.x0,w.x1)]:[Math.min(w.y0,w.y1),Math.max(w.y0,w.y1)];
 for(const q of lv.rooms){const a=h?q.x:q.y,b=h?q.x+q.w:q.y+q.h,edge=h?(Math.abs(at-q.y)<.02?1:Math.abs(at-q.y-q.h)<.02?-1:0):(Math.abs(at-q.x)<.02?1:Math.abs(at-q.x-q.w)<.02?-1:0);
  if(edge&&u>=a-.01&&v<=b+.01)return {q,edge,h,at,u,v,a,b};}return null;}
export const pideCerrar=(tipo,...k)=>sorteo(...k)<(CORTINA.cerradas[tipo]??0);
export const telaDe=(...k)=>CORTINA.telas[Math.floor(sorteo('tela',...k)*CORTINA.telas.length)];

export function cerrarCortinas(bp){let unidades=0,cerradas=0,ventanas=0;
 for(const L of [...bp.lots,...(bp.isla?.lots||[]).filter(l=>l.levels)]){const tipo=bp.lots.includes(L)?L.type:'monte';
  for(const lv of L.levels||[]){const vistas=new Set();
   for(const w of lv.windows||[]){delete w.cortina;if(w.shop)continue;const c=cuartoDeVentana(lv,w);if(!c||!CUARTOS.has(c.q.type))continue;
    // (el dúplex —engine/duplex.js—, sin cortinas: Miguel, 2026-11-22, «haz que el dúplex no tenga cortinas»)
    if(L.duplex&&lv===L.levels[L.floors-1]&&L.duplex.unidades.some(x=>x.n===c.q.unit))continue;
    const u=c.q.unit??'c'+c.q.id,k=[bp.seed,L.id,lv.level,u];if(!vistas.has(u)){vistas.add(u);unidades++;if(pideCerrar(tipo,...k))cerradas++;}
    if(pideCerrar(tipo,...k)){w.cortina=telaDe(...k);ventanas++;}}}}
 for(const h of bp.isla?.casas||[]){delete h.cortinas;const P=h.spec?.hogar;if(!P)continue;unidades++;const k=[bp.seed,'casa',h.x.toFixed(1),h.z.toFixed(1)];if(!pideCerrar('casa',...k))continue;cerradas++;
  const cuartos=[];for(const lv of P.levels)for(const w of lv.windows||[]){const q=lv.rooms.find(r=>r.id===w.a);if(q&&CUARTOS.has(q.type)){cuartos.push(lv.level+':'+q.id);ventanas++;}}
  h.cortinas={tela:telaDe(...k),cuartos:[...new Set(cuartos)]};}
 return {unidades,cerradas,ventanas};}

// LA PELÍCULA DEL VIDRIO (2026-11-22, Miguel: «eliminamos las cortinas y hacemos que sean borrosas cuando no estén abiertas,
// como eso nuevo que una ventana se puede ver transparente u opaca con una película»; «que no se vea por dentro de los
// apartamentos, pero que al abrir se ponga transparente»). En vez del paño con sus pliegues y su barral (4 cajas, 48
// triángulos) y de los paños abiertos a los costados, una sola lámina lechosa pegada al vidrio por dentro (12 triángulos):
// opaca, tapa el cuarto; transparente, no se dibuja. Del ancho que tapaba el paño —hasta CORTINA.panio.ancho centrado en
// la ventana, sin pasar del cuarto (margen)— y de panio.bajo a panio.alto sobre el piso yb, a cara (m) de la línea de la
// fachada hacia adentro. Devuelve {cajas: [la lámina, {x,y,z,sx,sy,sz,color}], u0, u1, y0, y1}.
export const PELICULA={color:'#e3e9ec',espesor:.012};
export function peliculaCerrada(c,yb,cara){const P=CORTINA.panio,m=(c.u+c.v)/2,u0=Math.max(c.a+P.margen,m-P.ancho/2),u1=Math.min(c.b-P.margen,m+P.ancho/2),mu=(u0+u1)/2,L=u1-u0,at=c.at+c.edge*cara,y0=yb+P.bajo,y1=yb+P.alto;
 const caja=c.h?{x:mu,y:y0,z:at,sx:L,sy:y1-y0,sz:PELICULA.espesor,color:PELICULA.color}:{x:at,y:y0,z:mu,sx:PELICULA.espesor,sy:y1-y0,sz:L,color:PELICULA.color};
 return {cajas:[caja],u0,u1,y0,y1};}

// (LA PERSIANA CERRADA de las viviendas sin dueño —2026-11-22, «las casas y apartamentos que no estén vendidos, con las
// ventanas cerradas»— es ahora la misma película, opaca: peliculaCerrada)
