// ======== Las direcciones, como en Bogotá (2026-10-16, idea de Miguel) ========
// Cada puerta de calle recibe su dirección: la vía donde da (Calle o Carrera, o Avenida Calle / Avenida Carrera), «#», el
// número de la vía cruzada anterior y los metros desde ella: «Cl 11 # 24-37». Los números crecen con las coordenadas
// —las calles con z, las carreras con x— y, como allá, un lado de la vía lleva los impares y el otro los pares (acá:
// impares del lado de menor coordenada —el norte de una calle, el oeste de una carrera—).
// Las vías: las de la ciudad con su nombre (map.names.lines); la avenida, con el número que le toca entre sus vecinas; las
// del monte —rectas, en los dos ejes—, con el que les toca por su posición siguiendo la numeración de la ciudad, y con
// letra (6A, 6B) si caen en un número que ya tiene otra.
// Deja d.direccion en cada puerta de calle de los lotes ({via, numero, letra, cruce, metros, texto, corto}) y h.direccion
// en cada casa. Determinista. Puro.
import {CELL} from './veredas.js';
import {cuerpoCasa} from './circulacion.js';
import {UBICACION} from './medidas.js';

const PRE={h:{via:'Calle',corto:'Cl',av:'Ac',avLargo:'Avenida Calle'},v:{via:'Carrera',corto:'Kr',av:'Ak',avLargo:'Avenida Carrera'}};
// el ajuste lineal número = a + b·coordenada de las vías con número de un eje
const ajuste=vs=>{const p=vs.filter(v=>v.numero!=null);if(p.length<2)return {a:p[0]?.numero??1,b:1/CELL};const n=p.length,mx=p.reduce((s,v)=>s+v.coord,0)/n,my=p.reduce((s,v)=>s+v.numero,0)/n;
 let sxy=0,sxx=0;for(const v of p){sxy+=(v.coord-mx)*(v.numero-my);sxx+=(v.coord-mx)**2;}const b=sxx?sxy/sxx:1/CELL;return {a:my-b*mx,b};};

export function viasDe(bp){const m=bp.map,lines=m.names?.lines||[],vias={h:[],v:[]};
 for(const l of lines){const coord=(l.at.reduce((s,a)=>s+a,0)/l.at.length+.5)*CELL,num=+(/(\d+)/.exec(l.name)?.[1]??NaN);
  vias[l.axis].push({eje:l.axis,coord,ancho:l.at.length*CELL,numero:Number.isFinite(num)?num:null,avenida:!!l.avenue,nombre:l.name,ciudad:true});}
 for(const e of ['h','v']){const A=ajuste(vias[e]);vias[e].ajuste=A;
  // la avenida sin número: el que le toca por su posición
  for(const v of vias[e])if(v.numero==null)v.numero=Math.round(A.a+A.b*v.coord);}
 // las del monte: cada línea recta de la grilla (z constante: calle; x constante: carrera), fuera de la ciudad
 const Wm=m.W*CELL,Hm=m.H*CELL,vistas={h:new Map(),v:new Map()};
 for(const c of bp.isla?.carreteras||[]){if(c.tipo!=='grilla'||!c.puntos)continue;
  for(let i=1;i<c.puntos.length;i++){const a=c.puntos[i-1],b=c.puntos[i],e=Math.abs(a.z-b.z)<.01?'h':Math.abs(a.x-b.x)<.01?'v':null;if(!e)continue;
   const coord=+(e==='h'?a.z:a.x).toFixed(1),k=coord,ya=vistas[e].get(k);
   const lo=e==='h'?Math.min(a.x,b.x):Math.min(a.z,b.z),hi=e==='h'?Math.max(a.x,b.x):Math.max(a.z,b.z);
   if(ya){ya.desde=Math.min(ya.desde,lo);ya.hasta=Math.max(ya.hasta,hi);continue;}
   // (dentro de la ciudad ya está la de la ciudad)
   if(vias[e].some(v=>Math.abs(v.coord-coord)<v.ancho/2+3))continue;
   const v={eje:e,coord,ancho:c.ancho||12,numero:null,avenida:(c.ancho||12)>12,monte:true,desde:lo,hasta:hi};vistas[e].set(k,v);}}
 for(const e of ['h','v']){const A=vias[e].ajuste,usados=new Map(vias[e].map(v=>[v.numero+'',1]));
  for(const v of [...vistas[e].values()].sort((p,q)=>p.coord-q.coord)){const n=Math.round(A.a+A.b*v.coord),base=Math.max(1,n);let letra='',k=0;
   while(usados.has(base+letra)){letra='ABCDEFGH'[k++];}usados.set(base+letra,1);v.numero=base;v.letra=letra;vias[e].push(v);}
  vias[e].sort((p,q)=>p.coord-q.coord);
  for(const v of vias[e]){const P=PRE[e];v.corto=(v.avenida?P.av:P.corto)+' '+v.numero+(v.letra||'');v.largo=(v.avenida?P.avLargo:P.via)+' '+v.numero+(v.letra||'');}}
 return vias;}

// La cruzada anterior de un punto de una vía del eje e (pos: su coordenada a través de la vía; along: a lo largo): la
// de mayor coordenada que no pasa del punto (si no hay, la que dice el ajuste), los metros desde ella y la siguiente.
const visible=(v,pos)=>!v.monte||(pos>=v.desde-14&&pos<=v.hasta+14);
function cruceDe(vias,e,pos,along){const o=e==='h'?'v':'h',P=PRE[o],cs=vias[o].filter(v=>visible(v,pos)),i=cs.findLastIndex(v=>v.coord<=along+1e-6),cr=cs[i]||null,sig=cs[i+1]||null;
 if(cr)return {cruce:cr.numero+(cr.letra||''),metros:along-cr.coord,anterior:cr.corto,siguiente:sig?.corto||null};
 const A=vias[o].ajuste,n=Math.floor(A.a+A.b*along);return {cruce:Math.max(1,n)+'',metros:along-(n-A.a)/A.b,anterior:`${P.corto} ${Math.max(1,n)}`,siguiente:sig?.corto||null};}

// Dónde está un punto (x, z), para decírselo al jugador (UBICACION de medidas.js):
//  · en un cruce —sobre una calle y una carrera a la vez—: «Calle 11 con Carrera 24»;
//  · sobre una vía: la vía, entre qué cruzadas y su número como en una dirección: «Calle 11», «entre Kr 24 y Kr 25»,
//    «# 24-37»;
//  · fuera de las vías (adentro de una manzana, en un parque, en el monte): la dirección del punto sobre la vía más
//    cercana, a menos de UBICACION.cerca: «cerca de Cl 11 # 24-37»;
//  · lejos de toda vía: null.
// Devuelve {tipo:'cruce'|'via'|'cerca', titulo, detalle, calle, carrera, via, cruce, metros}. Puro.
export function ubicacionDe(vias,x,z){const B=UBICACION.banda;
 const sobre=e=>{const pos=e==='h'?z:x,along=e==='h'?x:z;let best=null,bd=1e9;
  for(const v of vias[e]){if(v.monte&&(along<v.desde-B||along>v.hasta+B))continue;const d=Math.abs(v.coord-pos);if(d<=v.ancho/2+B&&d<bd){bd=d;best=v;}}return best;};
 const H=sobre('h'),V=sobre('v');
 if(H&&V)return {tipo:'cruce',titulo:`${H.largo} con ${V.largo}`,detalle:`${H.corto} con ${V.corto}`,calle:H.corto,carrera:V.corto,via:null};
 // (las cruzadas que se ven, según el eje de la vía y no según el punto: así no cambian de un lado al otro de ella)
 const deVia=(v,e)=>{const along=e==='h'?x:z,c=cruceDe(vias,e,v.coord,along),mt=Math.max(1,Math.round(c.metros));
  return {via:v.corto,largo:v.largo,cruce:c.cruce,metros:mt,numero:`# ${c.cruce}-${mt}`,entre:c.siguiente?`entre ${c.anterior} y ${c.siguiente}`:`desde ${c.anterior}`};};
 const S=H||V;if(S){const e=H?'h':'v',d=deVia(S,e);
  return {tipo:'via',titulo:S.largo,detalle:`${d.entre} · ${d.numero}`,calle:H?.corto||null,carrera:V?.corto||null,via:d.via,cruce:d.cruce,metros:d.metros};}
 // (fuera de las vías: la más cercana de los dos ejes, con su dirección)
 let best=null,bd=UBICACION.cerca;
 for(const e of ['h','v']){const pos=e==='h'?z:x,along=e==='h'?x:z;for(const v of vias[e]){if(v.monte&&(along<v.desde||along>v.hasta))continue;const d=Math.abs(v.coord-pos)-v.ancho/2;if(d<bd){bd=d;best={v,e};}}}
 if(!best)return null;const d=deVia(best.v,best.e);
 return {tipo:'cerca',titulo:`cerca de ${best.v.largo}`,detalle:`${d.via} ${d.numero}`,calle:best.e==='h'?d.via:null,carrera:best.e==='v'?d.via:null,via:d.via,cruce:d.cruce,metros:d.metros,distancia:+bd.toFixed(1)};}

// La dirección de una puerta en (x, z) que mira hacia (nx, nz) —hacia la calle—. null si no hay vía delante.
export function direccionDe(vias,x,z,nx,nz){
 // la vía de la puerta: la del eje perpendicular a su normal, delante de ella (a ≤ 14 m del eje)
 const e=Math.abs(nz)>Math.abs(nx)?'h':'v',pos=e==='h'?z:x,s=e==='h'?Math.sign(nz):Math.sign(nx),along=e==='h'?x:z;
 let via=null,bd=1e9;for(const v of vias[e]){const dd=(v.coord-pos)*s;if(dd<-1||dd>14)continue;if(v.monte&&(along<v.desde-6||along>v.hasta+6))continue;if(dd<bd){bd=dd;via=v;}}
 // (sin vía con nombre delante —un callejón—: la «Bis» de la anterior, como en Bogotá: entre la Calle 10 y la 11, la 10 Bis)
 if(!via){const A=vias[e].ajuste,c=pos+s*3,n=Math.max(1,Math.floor(A.a+A.b*c)),P=PRE[e];via={corto:`${P.corto} ${n} Bis`,largo:`${P.via} ${n} Bis`,coord:c,bis:true};}
 const {cruce,metros}=cruceDe(vias,e,via.coord,along);// (por el eje de la vía, como ubicacionDe: la placa y el letrero dicen lo mismo)
 // los metros: enteros, impares del lado de menor coordenada (la puerta mira a +: está antes de la vía) y pares del otro
 let mt=Math.max(1,Math.round(metros));const impar=s>0;if((mt%2===1)!==impar)mt+=1;
 return {via:via.corto,viaLarga:via.largo,eje:e,cruce,metros:mt,lado:impar?'impar':'par',texto:`${via.corto} # ${cruce}-${mt}`,coordVia:via.coord};}

export function numerar(bp){const vias=viasDe(bp),usadas=new Map(),todas=[];
 const pon=(dir,obj)=>{if(!dir)return;let k=dir.texto;while(usadas.has(k)){dir.metros+=2;dir.texto=`${dir.via} # ${dir.cruce}-${dir.metros}`;k=dir.texto;}usadas.set(k,1);obj.direccion=dir;todas.push(dir);};
 for(const L of [...bp.lots,...(bp.isla?.lots||[]).filter(l=>l.levels)]){const lv=L.levels?.find(l=>l.level===0);if(!lv)continue;
  const dentro=(x,z)=>(L.parts||[]).some(p=>x>p.x&&x<p.x+p.w&&z>p.y&&z<p.y+p.h);
  for(const d of lv.doors||[]){if(!d.street)continue;const hz=Math.abs(d.y1-d.y0)<1e-6,mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2,nx=hz?0:(dentro(mx+.3,mz)?-1:1),nz=hz?(dentro(mx,mz+.3)?-1:1):0;
   pon(direccionDe(vias,mx,mz,nx,nz),d);}}
 for(const h of bp.isla?.casas||[]){const c=cuerpoCasa(h);pon(direccionDe(vias,c.puerta.x,c.puerta.z,c.afuera.x,c.afuera.z),h);}
 bp.vias=vias;return {vias,direcciones:todas.length};}
