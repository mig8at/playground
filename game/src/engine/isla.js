/* La isla flotante alrededor de la ciudad, como datos (FUGA, 2026-10-11). Antes vivía sólo en el 3D (src/lib/island3d.js,
   que ahora la dibuja desde acá): las mismas cuentas, sin THREE, para que la usen también el plano (blueprint.js:
   las casas, el globo, el parapente y los senderos de la isla) y la simulación (capas.js: por dónde se camina).

   Alrededor de la ciudad: una franja verde, la playa que baja hasta el agua y el agua baja hasta el borde, donde cae en
   cascada al vacío. Dos o tres macizos de montaña cubren entre la mitad y dos tercios del contorno y terminan en
   acantilado. Todo sale de la semilla de la ciudad. Coordenadas del plano: metros, x a la derecha, y hacia abajo (el 3D
   usa z = y); la ciudad ocupa [0, W·CELL] × [0, H·CELL]. */
const CELL=6;// metros por casilla (el mismo CELL de blueprint.js; no se importa para no hacer un ciclo)
import {LADERA} from './medidas.js';

function rng(seed){let n=seed>>>0;return()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
// Ruido de valores suave (y su fbm), con la semilla de la ciudad.
export function valueNoise(seed){
 const h=(x,y)=>{let n=Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(seed|0,1274126177);n=Math.imul(n^n>>>13,1274126177);return((n^n>>>16)>>>0)/4294967296;};
 const s=t=>t*t*(3-2*t);
 const v=(x,y)=>{const xi=Math.floor(x),yi=Math.floor(y),xf=s(x-xi),yf=s(y-yi);const a=h(xi,yi),b=h(xi+1,yi),c=h(xi,yi+1),d=h(xi+1,yi+1);return a+(b-a)*xf+(c-a)*yf+(a-b-c+d)*xf*yf;};
 return (x,y,oct=4)=>{let sum=0,amp=.5,f=1,norm=0;for(let i=0;i<oct;i++){sum+=v(x*f,y*f)*amp;norm+=amp;amp*=.5;f*=2.03;}return sum/norm;};
}
export const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export const CLIFF=-34;  // a qué altura cae el borde (desde ahí cuelga la roca)
export const WATER=-.1;  // la superficie del agua
export const DEEP=-1.2;  // desde acá el agua es honda: no se camina
// La forma de la montaña (perillas): subida, hasta dónde sube desde el pie (en m desde el paseo; 'borde' = hasta el
// acantilado, menos 20 m); pico, cuánto de la altura del macizo; detalle, cuánto pesa el relieve fino. Una montaña
// más tendida se puede subir en carretera (ver blueprint.js). Medido (2026-10-11, tres ciudades): con subida 120 m la
// mediana de la pendiente de la montaña es 55–71 %; hasta el borde, 42–53 %, y una carretera de 12 % llega a la cima.
export const MONTE={subida:'borde',pico:1,detalle:.6,
 // ladera: la franja del monte junto a la ciudad se arma en terrazas (medidas.js LADERA, 2026-10-15): ahí la altura
 // depende sólo de la distancia al muro medida en paralelo a él (la de Chebyshev: el mayor de los dos apartamientos), y
 // sube a LADERA.pendiente desde LADERA.desde. Así cada línea paralela al muro es una curva de nivel exacta: las calles de
 // la ladera —las líneas de la grilla del plano, que siguen las de la ciudad— quedan a nivel, y las que suben, a la
 // pendiente. Hasta LADERA.fin; después, un talud a la pendiente de la escalinata hasta la montaña natural. Corta y rellena (es diseño, no ajuste).
 // (Reemplaza el rebaje de 3° y el piedemonte de 8°: con ellos las curvas de nivel no seguían a las calles.)
 ladera:true};

// La isla de una ciudad (map: W, H, seed). r es el azar de la isla ya usado para los macizos: el 3D lo sigue usando.
export function islaDe(map){
// mascara: (ya no recorta el pie de monte desde 2026-10-16; queda por compatibilidad de setMascara) dónde valía el rebaje; con
 // ella (setMascara, desde la huella de la grilla), sólo junto a las calles y los lotes: el resto es la montaña natural.
 let mascara=null;
 const S=CELL,Wm=map.W*S,Hm=map.H*S,cx=Wm/2,cz=Hm/2,r=rng(map.seed*977+13),fbm=valueNoise(map.seed*31+7);
 // Dos o tres macizos que cubren entre la mitad y dos tercios del contorno; la playa queda en el resto.
 const a0=r()*Math.PI*2,sectors=[{a:a0,w:2+r()*.5,peak:80+r()*50},{a:a0+Math.PI*(.62+r()*.25),w:1.3+r()*.5,peak:50+r()*30}];
 if(r()<.45)sectors.push({a:a0-Math.PI*(.55+r()*.2),w:.9+r()*.3,peak:35+r()*20});
 const angDiff=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
 const mountain=ang=>Math.max(0,...sectors.map(s=>smooth(s.w/2,s.w/2*.35,angDiff(ang,s.a))));
 // Distancia con signo al rectángulo de la ciudad (afuera, positiva) y el borde de la isla según el ángulo: más lejos
 // donde hay montaña, y siempre irregular.
 // La distancia al muro medida en paralelo a él (Chebyshev; afuera, positiva): la de las curvas de nivel de la ladera.
 const chebyshev=(x,z)=>Math.max(-x,x-Wm,-z,z-Hm);
 const outside=(x,z)=>{const dx=Math.max(-x,x-Wm),dz=Math.max(-z,z-Hm);return dx>0||dz>0?Math.hypot(Math.max(dx,0),Math.max(dz,0)):Math.max(dx,dz);};
 const rimOf=ang=>48+70*fbm(Math.cos(ang)*2.2+4,Math.sin(ang)*2.2+4,3)+175*mountain(ang)+10*fbm(Math.cos(ang)*9+1,Math.sin(ang)*9+1,2);
 const edgeAlong=ang=>Math.min(Math.abs((Wm/2)/(Math.cos(ang)||1e-9)),Math.abs((Hm/2)/(Math.sin(ang)||1e-9)));
 const rimAt=a=>edgeAlong(a)+rimOf(a);
 const rimPoint=ang=>{const R=rimAt(ang);return {x:cx+Math.cos(ang)*R,z:cz+Math.sin(ang)*R};};
 const beyond=(x,z)=>{const ang=Math.atan2(z-cz,x-cx);return Math.hypot(x-cx,z-cz)-rimAt(ang);};
 // El terreno de arriba, sin cortar en el borde (landH); height lo corta: fuera de la isla, el vacío.
 function landH(x,z){
  const d=outside(x,z);if(d<0)return -.02;// bajo la ciudad: justo debajo del paseo (y=0), para que la orilla empalme sin hundirse
  const ang=Math.atan2(z-cz,x-cx),na=(f,o)=>fbm(Math.cos(ang)*f+o,Math.sin(ang)*f+o,3);
  // Desde el paseo: franja verde, playa que baja hasta el agua, y el fondo del agua baja hasta el borde.
  const green=4+20*na(2.7,3),beach=12+26*na(3.4,11);
  let h;
  if(d<green)h=.02+.65*smooth(0,green,d)+.45*fbm(x*.04,z*.04,2)*smooth(0,green,d);
  else if(d<green+beach){const t=(d-green)/beach;h=.7*(1-t)-.4*t;}
  else h=-.4-Math.min(2.2,(d-green-beach)*.07);
  // Donde hay montaña no hay playa ni bajada al agua: la pradera sigue y sube suave hasta el pie del macizo (la playa
  // queda sólo donde la isla da al agua).
  const wm=mountain(ang);if(wm>0){const prado=.02+.65*smooth(0,green,d)+.45*fbm(x*.04,z*.04,2)*smooth(0,green,d)+Math.max(0,d-green)*.02;h=h*(1-wm)+prado*wm;}
  for(const s of sectors){
   const wa=smooth(s.w/2,s.w/2*.35,angDiff(ang,s.a));if(wa<=0)continue;
   const sub=MONTE.subida==='borde'?Math.max(120,rimOf(ang)-20):MONTE.subida,radial=smooth(16,sub,d)*(1-smooth(rimOf(ang)-35,rimOf(ang)+5,d)*.65);
   const ridge=1-Math.abs(fbm(x*.006+3,z*.006+7,4)*2-1);
   h+=s.peak*MONTE.pico*wa*radial*(.35+.65*ridge)*(1.2-MONTE.detalle+MONTE.detalle*fbm(x*.012,z*.012,3));
  }
  // la ladera en terrazas (MONTE.ladera, medidas.js LADERA)
  // (entera donde la montaña ya domina —su peso desde 0,5—, y se suelta hasta 0,2: a medias, los anillos no quedaban a nivel)
  // (2026-10-16, Miguel: «no desbastar la montaña sino escalonarla»: el pie de monte ES la montaña, no un rebaje junto a
  // las calles —la máscara ya no lo recorta, y no quedan bordes cortados—, con una ondulación de ±LADERA.ondula m para que
  // no sea un plano. Pasando LADERA.fin la montaña natural vuelve de a poco, en LADERA.talud m: antes, un talud cortado al
  // 35 % hasta encontrarla.)
  if(MONTE.ladera&&wm>0){const L=LADERA,dch=chebyshev(x,z),w=smooth(.2,.5,wm),tope=.7+L.pendiente*(L.fin-L.desde);
   const onda=L.ondula*(2*fbm(x*.018+5,z*.018+9,2)-1)*smooth(L.desde*.5,L.desde,dch);
   if(dch<=L.fin){const base=(dch<L.desde?.02+.68*smooth(0,L.desde,dch):.7+L.pendiente*(dch-L.desde))+onda;h=h*(1-w)+base*w;}
   else{const vuelve=smooth(L.fin,L.fin+L.talud,dch),pie=tope+onda;h=h*(1-w)+(pie+(h-pie)*vuelve)*w;}}
  return h;
 }
 function height(x,z){if(outside(x,z)<0)return -.02;return beyond(x,z)>0?CLIFF:landH(x,z);}
 // La zona de un punto: ciudad, vacío, agua honda, agua (baja: se camina), playa, pradera o montaña. La montaña es donde
 // el macizo pesa y el terreno ya subió; la playa, la arena entre la franja verde y el agua.
 function zona(x,z){const d=outside(x,z);if(d<0)return 'ciudad';if(beyond(x,z)>0)return 'vacio';
  const h=landH(x,z),ang=Math.atan2(z-cz,x-cx);
  if(mountain(ang)>.25&&h>3)return 'montaña';if(h<DEEP)return 'agua_honda';if(h<WATER)return 'agua';
  return mountain(ang)>.25?'pradera':'playa';}// del lado del agua, arena desde la orilla de la ciudad
 // La pendiente en un punto (subida por metro, la mayor entre x y z).
 const slope=(x,z,e=3)=>Math.max(Math.abs(height(x+e,z)-height(x-e,z)),Math.abs(height(x,z+e)-height(x,z-e)))/(2*e);
 const reach=Math.max(...Array.from({length:72},(_,i)=>{const a=i/72*Math.PI*2;return rimAt(a);}))+20;
 // La altura de diseño de la ladera en un punto (la de las terrazas, sin mezclar con la natural): de ahí salen los cruces.
 const ladera=(x,z)=>{const L=LADERA,d=chebyshev(x,z);return d<L.desde?.02+.68*smooth(0,L.desde,d):.7+L.pendiente*(d-L.desde);};
 return {S,Wm,Hm,cx,cz,r,fbm,sectors,angDiff,mountain,outside,chebyshev,ladera,rimOf,edgeAlong,rimAt,rimPoint,beyond,landH,height,zona,slope,reach,setMascara:f=>{mascara=f;}};
}

// La máscara del rebaje desde la huella de la grilla (casillas [x, y] de calles y lotes): 1 sobre la huella y hasta
// una casilla afuera, y baja suave a 0 a las `hasta` casillas (unos 30 m): ahí la montaña vuelve a ser la natural.
export function mascaraRebaje(huella,hasta=5){
 const key=(x,y)=>x+','+y,d=new Map(),q=[];for(const [x,y] of huella){if(!d.has(key(x,y))){d.set(key(x,y),0);q.push([x,y]);}}
 for(let k=0;k<q.length;k++){const [x,y]=q[k],v=d.get(key(x,y));if(v>=hasta)continue;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){const n=key(x+dx,y+dy);if(d.has(n))continue;d.set(n,v+(dx&&dy?1.41:1));q.push([x+dx,y+dy]);}}
 const at=(cx,cy)=>d.get(key(cx,cy))??hasta+1;
 // Distancia (en casillas) interpolada entre los centros de casilla, y de ahí el peso.
 return (x,z)=>{const fx=x/CELL-.5,fz=z/CELL-.5,x0=Math.floor(fx),z0=Math.floor(fz),tx=fx-x0,tz=fz-z0;
  const v=at(x0,z0)*(1-tx)*(1-tz)+at(x0+1,z0)*tx*(1-tz)+at(x0,z0+1)*(1-tx)*tz+at(x0+1,z0+1)*tx*tz;return 1-smooth(1,hasta,v);};
}
