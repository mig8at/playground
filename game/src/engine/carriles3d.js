// ======== Los carriles del tráfico sobre la grilla (2026-10-16, Miguel: «el movimiento de los carros está mal») ========
// El tráfico del 3D (lib/traffic3d.js) anda por casillas de 6 m; esto dice, para cada casilla de calzada, qué es (calle a
// lo ancho o a lo alto, cruce), en qué sentido se puede ir por ella y dónde va el auto a lo ancho: en el carril que el 2D
// le pone (circulacion.js): por la derecha, a CIRCULACION.vehiculo.carril/2 del eje —y 1,5 carriles el de afuera de
// una avenida—. Puro: lo usan el 3D y validar-trafico.
import {CIRCULACION,CALLE} from './medidas.js';
export const CARRIL=CIRCULACION.vehiculo.carril,AV=CALLE.avenida.casillas;
export function grillaCarriles(W,H,drive,S=6){
 // el largo del tramo de calzada que pasa por cada casilla, a lo ancho y a lo alto
 const hR=new Int16Array(W*H),vR=new Int16Array(W*H);
 for(let y=0;y<H;y++){let x=0;while(x<W){if(!drive(x,y)){x++;continue;}let e=x;while(e<W&&drive(e,y))e++;for(let i=x;i<e;i++)hR[y*W+i]=e-x;x=e;}}
 for(let x=0;x<W;x++){let y=0;while(y<H){if(!drive(x,y)){y++;continue;}let e=y;while(e<H&&drive(x,e))e++;for(let i=y;i<e;i++)vR[i*W+x]=e-y;y=e;}}
 // «calle» si el tramo a lo largo pasa de una avenida y a lo ancho no; cruce sólo donde los dos pasan (antes el corte
 // era 2 y una avenida —3 casillas— era un cruce en todo su largo: se cruzaba entera de una vez, cambiando de fila y en
 // contramano)
 const axis=(x,y)=>{const i=y*W+x,h=hR[i]>AV||hR[i]>2&&vR[i]<=2,v=vR[i]>AV||vR[i]>2&&hR[i]<=2;return h&&v?'j':h?'h':v?'v':'x';};
 // el sentido, por la derecha: en una calle de 2 filas, cada fila el suyo; en una avenida de 3, las de afuera el suyo y
 // la del medio los dos (un carril para cada lado)
 function sentido(x,y,dx,dy){const ax=axis(x,y),i=y*W+x;if(ax==='j'||ax==='x')return true;
  if(ax==='h'){if(dy)return false;if(vR[i]===2)return drive(x,y+1)?dx===-1:dx===1;if(vR[i]===3){const up=drive(x,y-1),dn=drive(x,y+1);if(up&&dn)return true;return dn?dx===-1:dx===1;}return true;}
  if(dx)return false;if(hR[i]===2)return drive(x+1,y)?dy===1:dy===-1;if(hR[i]===3){const l=drive(x-1,y),rr=drive(x+1,y);if(l&&rr)return true;return rr?dy===1:dy===-1;}return true;}
 // cuánto correrse a la derecha desde el centro de la casilla yendo hacia d para quedar en el carril del 2D (null en un
 // cruce de verdad o una plaza: la sección pasa de una avenida). En la avenida, la fila del medio va por el carril de
 // adentro y las de afuera por el de afuera.
 const laneOff=(cx,cy,d)=>{if(!drive(cx,cy))return null;const i=cy*W+cx,ancho=d[0]?vR[i]:hR[i];if(ancho>AV)return null;
  let p0,p1,c;if(d[0]){p0=cy;p1=cy;while(drive(cx,p0-1))p0--;while(drive(cx,p1+1))p1++;c=cy;}else{p0=cx;p1=cx;while(drive(p0-1,cy))p0--;while(drive(p1+1,cy))p1++;c=cx;}
  const a=(p0+p1+1)/2*S,cc=(c+.5)*S,Rs=d[0]?d[0]:-d[1],k=p1-p0+1>=3&&Math.abs(cc-a)>S/2?1:0;return (a+Rs*CARRIL*(k+.5)-cc)*Rs;};
 // la fila del medio de una avenida: un carril por sentido, cada uno su reserva
 const middle=(x,y)=>{const ax=axis(x,y),i=y*W+x;return ax==='h'?vR[i]===3&&drive(x,y-1)&&drive(x,y+1):ax==='v'?hR[i]===3&&drive(x-1,y)&&drive(x+1,y):false;};
 // el punto del carril de una casilla recta, yendo hacia d (la derecha de la marcha: (−dz, dx))
 const puntoDeCarril=(cx,cy,d)=>{const o=laneOff(cx,cy,d);if(o==null)return null;return {x:(cx+.5)*S-d[1]*o,z:(cy+.5)*S+d[0]*o};};
 return {hR,vR,axis,sentido,laneOff,middle,puntoDeCarril};}
// El giro de 90° de carril a carril (A, la entrada, y B, la salida, ya corridos a su carril; K, donde se cruzan): si los
// dos lados miden igual, un cuarto de círculo con centro en A + B − K. Devuelve {centro, radio} o null.
export function arcoDeGiro(din,dout,offIn,offOut,S=6){const A=[-din[0]*S/2-din[1]*offIn,-din[1]*S/2+din[0]*offIn],B=[dout[0]*S/2-dout[1]*offOut,dout[1]*S/2+dout[0]*offOut],K=din[0]?[B[0],A[1]]:[A[0],B[1]];
 const la=Math.hypot(K[0]-A[0],K[1]-A[1]),lb=Math.hypot(B[0]-K[0],B[1]-K[1]);return la>.1&&Math.abs(la-lb)<.05?{centro:[A[0]+B[0]-K[0],A[1]+B[1]-K[1]],radio:la}:null;}
