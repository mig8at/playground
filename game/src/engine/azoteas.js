// Las azoteas (2026-10-18, FACHADAS.md mejora 3: «todas iguales, losa gris con un pretil»). En el 2D, sobre cada techo
// plano de la ciudad: el tanque de agua (el negro de polietileno de las azoteas colombianas, sobre su base), la antena, el
// tendedero con ropa, las materas junto al pretil y los equipos de aire de los edificios que los llevan (fachada.js
// aire; antes los ponía el 3D al azar). Todos chocan (el 3D los arma como cajas sólidas: town3d), así que se reparten
// con las reglas del juego —las azoteas son por donde se escapa el ladrón (validar-azoteas)—:
//  · nada a menos de AZOTEA.objetos.borde del borde del techo: la pista para tomar carrera y saltar queda libre (las
//    materas, bajas —se pasan por encima—, van junto al pretil);
//  · la salida del ascensor (el núcleo con ascensor) libre, con AZOTEA.objetos.salida de holgura;
//  · el piso libre de la azotea, conectado: se llega de la salida a todo el borde (validar-azoteas-objetos);
//  · lo que ocupan, a lo sumo AZOTEA.objetos.ocupa del techo.
// Cada objeto: {tipo, x, z (centro), w, d (medidas en planta, x y z), alto, giro (0 | 90)}. Determinista por semilla.
// Coordenadas del plano: metros, x a la derecha, z (= y del plano) hacia abajo.
import {AZOTEA} from './medidas.js';
import {rng,mix} from './veredas.js';

const O=()=>AZOTEA.objetos;
// el rectángulo libre de un objeto dentro de un techo (las partes del lote, en metros)
const dentro=(parts,x0,z0,x1,z1,m=0)=>parts.some(p=>x0>=p.x+m-1e-6&&x1<=p.x+p.w-m+1e-6&&z0>=p.y+m-1e-6&&z1<=p.y+p.h-m+1e-6);
const choca=(a,b,h=0)=>a.x0<b.x1+h&&a.x1>b.x0-h&&a.z0<b.z1+h&&a.z1>b.z0-h;
export const cajaDe=o=>({x0:o.x-o.w/2,x1:o.x+o.w/2,z0:o.z-o.d/2,z1:o.z+o.d/2});

export function amoblarAzoteas(bp){for(const [li,L] of bp.lots.entries()){delete L.azotea;if(!L.parts?.length||L.fachada?.techo==='mansarda'||(L.floors||0)<2)continue;
 const r=rng(mix(bp.seed,bp.team||0,li,7717)),B=O().borde,objs=[],libre=[];
 // la salida del ascensor, libre
 const core=L.levels?.find(l=>l.core?.lift)?.core;if(core)libre.push({x0:core.x-O().salida,x1:core.x+core.w+O().salida,z0:core.y-O().salida,z1:core.y+core.h+O().salida});
 const area=L.parts.reduce((a,p)=>a+p.w*p.h,0);let ocupa=0;
 const poner=(o,margen)=>{const c=cajaDe(o);if(!dentro(L.parts,c.x0,c.z0,c.x1,c.z1,margen))return false;if(libre.some(q=>choca(c,q))||objs.some(q=>choca(c,cajaDe(q),O().paso)))return false;
  if(ocupa+o.w*o.d>area*O().ocupa)return false;objs.push(o);ocupa+=o.w*o.d;return true;};
 // un punto al azar dentro de una parte, a margen de su borde
 const punto=m=>{const p=L.parts[Math.floor(r()*L.parts.length)];if(p.w<2*m||p.h<2*m)return null;return {x:p.x+m+r()*(p.w-2*m),z:p.y+m+r()*(p.h-2*m),p};};
 const intentar=(fn,n=24)=>{for(let k=0;k<n;k++)if(fn())return true;return false;};
 const T=O().tipos;
 // el tanque: casi todos los edificios de vivienda y la mitad de los demás (uno; dos en los grandes)
 const nt=(L.type==='vivienda'||L.type==='hotel'||r()<.5)?(area>300?2:1):0;
 for(let i=0;i<nt;i++)intentar(()=>{const q=punto(B+T.tanque.w/2);return q&&poner({tipo:'tanque',x:q.x,z:q.z,w:T.tanque.w,d:T.tanque.w,alto:T.tanque.alto,giro:0},B);});
 // la antena: en una esquina de una parte, a borde del pretil
 if(r()<.6)intentar(()=>{const p=L.parts[Math.floor(r()*L.parts.length)],sx=r()<.5,sz=r()<.5,m=B+T.antena.w/2;return poner({tipo:'antena',x:sx?p.x+m:p.x+p.w-m,z:sz?p.y+m:p.y+p.h-m,w:T.antena.w,d:T.antena.w,alto:T.antena.alto,giro:0},B);},8);
 // el tendedero (en las viviendas): largo a lo largo del lado más largo de una parte
 if(L.type==='vivienda'&&r()<.75)intentar(()=>{const q=punto(B+T.tendedero.w/2);if(!q)return false;const g=q.p.w>=q.p.h?0:90;
  return poner({tipo:'tendedero',x:q.x,z:q.z,w:g?T.tendedero.d:T.tendedero.w,d:g?T.tendedero.w:T.tendedero.d,alto:T.tendedero.alto,giro:g},B);});
 // los equipos de aire (los edificios que los llevan): dos o tres
 if(L.fachada?.aire)for(let i=0,n=2+Math.floor(r()*2);i<n;i++)intentar(()=>{const q=punto(B+T.aire.w/2);return q&&poner({tipo:'aire',x:q.x,z:q.z,w:T.aire.w,d:T.aire.d,alto:T.aire.alto,giro:0},B);});
 // las materas: junto al pretil (bajas: no estorban el salto), de a grupos en un lado de una parte
 if(L.type==='vivienda'||L.type==='hotel'||r()<.3){const p=L.parts[Math.floor(r()*L.parts.length)],lado=Math.floor(r()*4),m=T.matera.w/2+.05,n=3+Math.floor(r()*4);
  for(let i=0;i<n;i++){const t=(i+1)/(n+1),hor=lado<2,x=hor?p.x+1+t*(p.w-2):lado===2?p.x+m:p.x+p.w-m,z=hor?(lado===0?p.y+m:p.y+p.h-m):p.y+1+t*(p.h-2);poner({tipo:'matera',x,z,w:T.matera.w,d:T.matera.w,alto:T.matera.alto,giro:0},0);}}
 if(objs.length)L.azotea={objetos:objs};}}
