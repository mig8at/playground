// ======== Bajar del dron cayendo (2026-10-16, Miguel: «que caiga de la altura donde esté») ========
// Al soltar el dron, el jugador cae desde la altura del dron. La regla dice SOBRE DÓNDE: la columna del dron si ahí se
// camina (la grilla peatonal de circulacion.js: ni edificios, ni casas, ni el agua honda, ni el vacío) y desde ahí se
// llega a pie a la calle (a los puntos de salida de los equipos); si no —un techo, el mar, el borde—, el punto así más
// cercano, a menos de ATERRIZAJE.busca; y si tampoco hay (lejos sobre el mar), el más cercano de toda la isla.
// Así nunca se cae encerrado en un techo ni en el agua. Puro (la grilla se arma una vez: ~1 s).
import {grillaPeatonal,caminarDesde} from './circulacion.js';
import {CELL} from './veredas.js';
import {ATERRIZAJE} from './medidas.js';

export function zonaDeAterrizaje(bp){const g=grillaPeatonal(bp),m=bp.map;
 const desde=[...(m.thiefSpawns||[]),...(m.copSpawns||[])].map(p=>[(p.x+.5)*CELL,(p.y+.5)*CELL]);
 const dist=caminarDesde(g,desde),N=g.nx*g.nz,lejos=new Uint8Array(N).fill(1);
 // (a ATERRIZAJE.fachada de los edificios, como mínimo: lo que sale de la fachada —el balcón— no está en la grilla)
 const F=ATERRIZAJE.fachada,c=g.celda;
 for(const p of [...bp.lots.flatMap(L=>L.parts),...(bp.isla.lots||[]).flatMap(L=>L.parts||[])]){const i0=Math.max(0,Math.floor((p.x-F-g.X0)/c)),i1=Math.min(g.nx-1,Math.floor((p.x+p.w+F-g.X0)/c)),j0=Math.max(0,Math.floor((p.y-F-g.Z0)/c)),j1=Math.min(g.nz-1,Math.floor((p.y+p.h+F-g.Z0)/c));
  for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++)lejos[j*g.nx+i]=0;}
 const ok=k=>k>=0&&g.libre[k]&&lejos[k]&&dist[k]<Infinity;
 // (la muestra gruesa de toda la isla, cada 8 m, para cuando no hay nada cerca)
 const paso=Math.round(8/g.celda),gruesa=[];for(let j=0;j<g.nz;j+=paso)for(let i=0;i<g.nx;i+=paso){const k=j*g.nx+i;if(ok(k))gruesa.push(k);}
 const punto=k=>{const i=k%g.nx,j=(k-i)/g.nx;return {x:g.X0+(i+.5)*g.celda,z:g.Z0+(j+.5)*g.celda,alto:g.alto[k]};};
 return {g,dist,ok,gruesa,punto};}

// Sobre dónde cae quien suelta el dron en (x, z): {x, z, alto, corrido} (corrido: cuánto se corrió de la columna).
export function aterrizajeDe(Z,x,z){const {g,ok,punto}=Z,c=g.celda,k0=g.idx(x,z);
 if(ok(k0))return {x,z,alto:g.alto[k0],corrido:0};
 // (en anillos crecientes alrededor de la columna, dentro de la grilla, el más cercano de verdad: un anillo cuadrado de
 // radio r tiene puntos a r·c y a r·c·√2, así que se sigue hasta que el mejor encontrado no pueda mejorar)
 const ci=Math.floor((x-g.X0)/c),cj=Math.floor((z-g.Z0)/c),R=Math.ceil(ATERRIZAJE.busca/c);let best=null,bd=Infinity;
 for(let r=1;r<=R;r++){if(bd<=(r-1)*c)break;for(let dj=-r;dj<=r;dj++)for(let di=-r;di<=r;di++){if(Math.max(Math.abs(di),Math.abs(dj))!==r)continue;const i=ci+di,j=cj+dj;if(i<0||j<0||i>=g.nx||j>=g.nz)continue;const k=j*g.nx+i;if(!ok(k))continue;
  const p=punto(k),d=Math.hypot(p.x-x,p.z-z);if(d<bd){bd=d;best=p;}}}
 if(best&&bd<=ATERRIZAJE.busca)return {...best,corrido:+bd.toFixed(2)};
 for(const k of Z.gruesa){const p=punto(k),d=Math.hypot(p.x-x,p.z-z);if(d<bd){bd=d;best=p;}}
 return best&&{...best,corrido:+bd.toFixed(2)};}
