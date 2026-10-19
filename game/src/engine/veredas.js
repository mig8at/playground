/* Lo que comparten la vegetación y el equipamiento urbano (FUGA, 2026-10-15): las veredas de la ciudad (tramos seguidos
   de vereda a lo largo de una manzana, con su calle), los ejes de las calles del monte, los cruces, y las cuentas de
   siempre (azar con semilla, posiciones a lo largo de un tramo, búsqueda de vecinos). Coordenadas del plano: metros. */
import {CALLE} from './medidas.js';
import City from './ciudad.js';

export const CELL=6;
export function rng(seed){let n=seed>>>0;return()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
export const mix=(...v)=>v.reduce((a,b)=>Math.imul(a^(b>>>0),0x9E3779B1)>>>0,0x85EBCA6B);
// Una grilla de búsqueda para «¿hay algo a menos de d?»
export function vecinos(tam=8){const g=new Map(),k=(x,z)=>Math.floor(x/tam)+','+Math.floor(z/tam);
 return {add(p){const q=k(p.x,p.z);(g.get(q)||g.set(q,[]).get(q)).push(p);},
  cerca(x,z,d,filtro=null){const i0=Math.floor((x-d)/tam),i1=Math.floor((x+d)/tam),j0=Math.floor((z-d)/tam),j1=Math.floor((z+d)/tam);
   for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++)for(const p of g.get(i+','+j)||[])if(Math.hypot(p.x-x,p.z-z)<d&&(!filtro||filtro(p)))return p;return null;}};}
// Posiciones a lo largo de un tramo de largo L: a ≥ margen de cada punta, cada «paso» o un poco más, centradas.
export const aLoLargo=(L,margen,paso)=>{const libre=L-2*margen;if(libre<0)return [];const n=Math.floor(libre/paso+1e-9)+1,sobra=libre-(n-1)*paso;return Array.from({length:n},(_,i)=>margen+sobra/2+i*paso);};

// Las veredas de la ciudad: por cada lado de una casilla de calle que da a algo que no es calle, ni remate, ni el muro,
// tramos seguidos. Cada tramo: lado (de la calle hacia el lote: N, S, W, E), a (fila o columna), b0..b1 (casillas a lo
// largo), av (es avenida), grupo (la calle, por su nombre), y en(u, d): el punto a u m a lo largo desde b0 y a d m del
// borde del lote, hacia la calle (d = 0 es la fachada; CALLE.vereda, el cordón).
export function veredasCiudad(m){const {W,H}=m,K=City.K,kindAt=(x,y)=>x<0||y<0||x>=W||y>=H?-1:m.kind[y*W+x],calleK=k=>k===K.street||k===K.avenue,tramos=[];
 for(const [lado,dx,dy] of [['N',0,-1],['S',0,1],['W',-1,0],['E',1,0]]){const horiz=dy!==0,nA=horiz?H:W,nB=horiz?W:H;
  for(let a=0;a<nA;a++){let ini=-1,av=false;
   const cierra=b=>{if(ini<0)return;const x=horiz?ini:a,y=horiz?a:ini,id=(horiz?m.names?.hLine:m.names?.vLine)?.[y*W+x];
    const borde=lado==='N'?a*CELL:lado==='S'?(a+1)*CELL:lado==='W'?a*CELL:(a+1)*CELL,s=lado==='N'||lado==='W'?1:-1,b0=ini;
    tramos.push({lado,a,b0:ini,b1:b,av,horiz,L:(b-ini)*CELL,grupo:'c'+(horiz?'h':'v')+(id??(lado+a)),en:(u,d)=>{const v=b0*CELL+u,l=borde+s*d;return horiz?{x:v,z:l}:{x:l,z:v};}});ini=-1;av=false;};
   for(let b=0;b<=nB;b++){const x=horiz?b:a,y=horiz?a:b,k=b<nB?kindAt(x,y):-1,o=b<nB?kindAt(x+dx,y+dy):-1;
    const ok=calleK(k)&&o>=0&&!calleK(o)&&o!==K.kiosk&&o!==K.border;if(ok){if(ini<0)ini=b;if(k===K.avenue)av=true;}else cierra(b);}}}
 return tramos;}

// Los ejes de las calles del monte: un tramo por segmento de cada cadena, con su ancho y la cadena a la que pertenece.
export const ejesMonte=I=>(I?.carreteras||[]).flatMap((c,ci)=>c.tipo==='grilla'&&c.puntos?c.puntos.slice(1).map((b,i)=>({a:c.puntos[i],b,an:c.ancho||12,cadena:ci})):[]);
export const distSeg=(x,z,a,b)=>{const dx=b.x-a.x,dz=b.z-a.z,L2=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/L2));return Math.hypot(x-a.x-t*dx,z-a.z-t*dz);};

// Los cruces de la ciudad: cada par calle/carrera con nombre que se cortan, con la caja de sus casillas (m), sus brazos
// (los lados por donde sigue una calle) y si alguna de las dos es avenida.
export function crucesCiudad(m){const {W,H}=m,K=City.K,n=m.names;if(!n?.hLine)return [];const cajas=new Map();
 for(let i=0;i<W*H;i++){const h=n.hLine[i],v=n.vLine[i];if(h<0||v<0)continue;const k=h+'|'+v,x=i%W,y=(i-x)/W,c=cajas.get(k)||cajas.set(k,{h,v,x0:x,x1:x,y0:y,y1:y,av:false}).get(k);
  c.x0=Math.min(c.x0,x);c.x1=Math.max(c.x1,x);c.y0=Math.min(c.y0,y);c.y1=Math.max(c.y1,y);if(m.kind[i]===K.avenue)c.av=true;}
 const calle=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&(m.kind[y*W+x]===K.street||m.kind[y*W+x]===K.avenue||m.kind[y*W+x]===K.kiosk);
 return [...cajas.values()].map(c=>{const brazos=[];
  // (un brazo, si todo el borde del cruce de ese lado sigue siendo calle: mirando una sola casilla, en una T con una calle
  // más angosta aparecía un brazo que no existía)
  const fila=(y,a,b)=>{for(let x=a;x<=b;x++)if(!calle(x,y))return false;return true;},col=(x,a,b)=>{for(let y=a;y<=b;y++)if(!calle(x,y))return false;return true;};
  if(fila(c.y0-1,c.x0,c.x1))brazos.push('N');if(fila(c.y1+1,c.x0,c.x1))brazos.push('S');if(col(c.x0-1,c.y0,c.y1))brazos.push('W');if(col(c.x1+1,c.y0,c.y1))brazos.push('E');
  return {...c,brazos,caja:{x0:c.x0*CELL,x1:(c.x1+1)*CELL,z0:c.y0*CELL,z1:(c.y1+1)*CELL}};});}
export const VEREDA=CALLE.vereda;
