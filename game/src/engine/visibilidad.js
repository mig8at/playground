// ======== Qué paredes se aclaran para ver adentro (2026-10-16, idea de Miguel: «si entro a un cuarto, que se ponga
// semitransparente la pared que acabo de atravesar, para ver todo adentro») ========
// El 2D decide; el 3D sólo trama (lib/cutaway3d.js). paredesAClarar(bp, jugador, camara, previo) da los tramos de pared
// del piso del jugador que se aclaran: los bordes de los espacios del plano (cuartos, pasillos, núcleo) que cruza la
// línea de la cámara a la cabeza del jugador o al centro de su cuarto —desde atrás, por la puerta que cruzó: ve el
// cuarto entero—. Nunca una medianera (mostraría al vecino), nunca otro piso, nunca otro edificio; con el jugador en la
// calle, nada. previo: lo de la vuelta anterior; una pared se queda aclarada mientras la línea pase a menos de
// VISIBILIDAD.histeresis de ella (así no titila al moverse cerca de su punta).
// Cada tramo, una caja del mundo {x0,z0,x1,z1, y0,y1 relativos al piso, lote, nivel, borde:'tabique'|'fachada', key}:
// a lo ancho, lo que ocupa la pared y lo que cuelga de ella (VISIBILIDAD.grosor), por la cara del cuarto y la de afuera.
// Puro.
import {ALTURA} from './medidas.js';
// (puerta: la hoja de cada puerta de una pared aclarada también se aclara —abierta, sale del muro hasta su ancho, hacia
// un lado u otro—: el cuadrado del ancho del vano a cada lado de la línea, hasta el alto de la hoja)
// (histeresis: 0,6 → 1 m el 2026-10-17: en la ciudad con parques —la que se juega— una pared volvía a prenderse a menos
// de 0,6 m en 3 de 200 caminatas; con 1 m, ninguna, y las paredes aclaradas no aumentan: mediana 1, p99 7)
export const VISIBILIDAD={maximo:16,histeresis:1,grosor:{tabique:.11,adentro:.34,afuera:.14},alto:ALTURA.piso,puerta:{alto:2.15,sobra:.05}};

const espaciosDe=lv=>[...lv.rooms,...(lv.corridor||[]),...(lv.core?[lv.core]:[])].map(q=>({x0:q.x,z0:q.y,x1:q.x+q.w,z1:q.y+q.h,q}));
export function loteEn(bp,x,z){for(const L of bp.lots)if((L.parts||[]).some(p=>x>p.x&&x<p.x+p.w&&z>p.y&&z<p.y+p.h))return L;return null;}
const dentroDe=(L,x,z)=>(L.parts||[]).some(p=>x>p.x-1e-6&&x<p.x+p.w+1e-6&&z>p.y-1e-6&&z<p.y+p.h+1e-6);
// ¿se cruzan los segmentos AB y CD? (en sentido propio)
function cruza(ax,az,bx,bz,cx,cz,dx,dz){const d=(bx-ax)*(dz-cz)-(bz-az)*(dx-cx);if(Math.abs(d)<1e-9)return false;const t=((cx-ax)*(dz-cz)-(cz-az)*(dx-cx))/d,u=((cx-ax)*(bz-az)-(cz-az)*(bx-ax))/d;return t>1e-6&&t<1-1e-6&&u>1e-6&&u<1-1e-6;}
// distancia entre dos segmentos (para la histéresis)
function dPS(px,pz,ax,az,bx,bz){const dx=bx-ax,dz=bz-az,L=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/L));return Math.hypot(ax+dx*t-px,az+dz*t-pz);}
const dSS=(a,b)=>cruza(...a,...b)?0:Math.min(dPS(a[0],a[1],...b),dPS(a[2],a[3],...b),dPS(b[0],b[1],...a),dPS(b[2],b[3],...a));
// Los bordes de los espacios de un piso: cada lado de cada espacio, con su lado de adentro (hacia el espacio) y si da
// a otro lote (medianera), a la calle (fachada) o a otro espacio (tabique). Se cachea por piso.
const cache=new WeakMap();
export function bordesDe(bp,L,lv){if(cache.has(lv))return cache.get(lv);const out=[],vistos=new Set();
 for(const e of espaciosDe(lv))for(const [h,at,a,b,adentro] of [[true,e.z0,e.x0,e.x1,1],[true,e.z1,e.x0,e.x1,-1],[false,e.x0,e.z0,e.z1,1],[false,e.x1,e.z0,e.z1,-1]]){
  const key=(h?'h':'v')+at.toFixed(2)+':'+a.toFixed(2)+':'+b.toFixed(2);if(vistos.has(key))continue;vistos.add(key);
  // (lo de afuera, 30 cm del medio del borde)
  const m=(a+b)/2,[ox,oz]=h?[m,at-adentro*.3]:[at-adentro*.3,m],fuera=!dentroDe(L,ox,oz),vecino=fuera&&!!loteEn(bp,ox,oz);
  out.push({h,at,a,b,adentro,borde:vecino?'medianera':fuera?'fachada':'tabique',key,seg:h?[a,at,b,at]:[at,a,at,b]});}
 cache.set(lv,out);return out;}
// La caja del mundo de un borde (sin el alto: y0, y1 relativos al piso del nivel)
export function cajaDeBorde(e){const G=VISIBILIDAD.grosor,[lo,hi]=e.borde==='tabique'?[-G.tabique,G.tabique]:e.adentro>0?[-G.afuera,G.adentro]:[-G.adentro,G.afuera];
 return e.h?{x0:e.a,x1:e.b,z0:e.at+lo,z1:e.at+hi}:{x0:e.at+lo,x1:e.at+hi,z0:e.a,z1:e.b};}

// jugador: {x, z, nivel}; camara: {x, z}; previo: el resultado anterior (o null)
export function paredesAClarar(bp,jugador,camara,previo=null){
 const L=loteEn(bp,jugador.x,jugador.z);if(!L)return [];const lv=L.levels?.find(l=>l.level===jugador.nivel);if(!lv)return [];
 const esp=espaciosDe(lv).find(e=>jugador.x>e.x0&&jugador.x<e.x1&&jugador.z>e.z0&&jugador.z<e.z1);
 const objetivos=[[jugador.x,jugador.z],...(esp?[[(esp.x0+esp.x1)/2,(esp.z0+esp.z1)/2]]:[])],lineas=objetivos.map(([tx,tz])=>[camara.x,camara.z,tx,tz]);
 const B=bordesDe(bp,L,lv),antes=new Set((previo||[]).filter(p=>p.lote===L.id&&p.nivel===jugador.nivel).map(p=>p.key)),out=[];
 for(const e of B){if(e.borde==='medianera')continue;
  const si=lineas.some(l=>cruza(...l,...e.seg))||antes.has(e.key)&&lineas.some(l=>dSS(l,e.seg)<VISIBILIDAD.histeresis);
  if(si)out.push({...cajaDeBorde(e),y0:0,y1:VISIBILIDAD.alto,lote:L.id,nivel:jugador.nivel,borde:e.borde,key:e.key,seg:e.seg});}
 // las hojas de las puertas de esas paredes (2026-10-16, Miguel: «que también se tornen semitransparentes las puertas»)
 const P=VISIBILIDAD.puerta,paredes=[...out];
 for(const d of lv.doors||[]){if(d.street||d.core||d.stair||d.hoja===false)continue;const h=Math.abs(d.y1-d.y0)<1e-6,at=h?d.y0:d.x0,u0=h?Math.min(d.x0,d.x1):Math.min(d.y0,d.y1),u1=h?Math.max(d.x0,d.x1):Math.max(d.y0,d.y1),w=u1-u0+P.sobra;
  // (sólo las que pueden tapar: a menos de su ancho y medio metro de la línea de la cámara —un pasillo largo aclarado
  // sumaba todas sus puertas y pasaba del máximo—)
  const sg=h?[u0,at,u1,at]:[at,u0,at,u1];const kd='p'+(h?'h':'v')+at.toFixed(2)+':'+u0.toFixed(2),mg=w+.5+(antes.has(kd)?VISIBILIDAD.histeresis:0);if(!lineas.some(l=>dSS(l,sg)<mg))continue;
  const e=paredes.find(p=>p.seg[0]===p.seg[2]?!h&&Math.abs(p.seg[0]-at)<.02&&u0>=Math.min(p.seg[1],p.seg[3])-.01&&u1<=Math.max(p.seg[1],p.seg[3])+.01:h&&Math.abs(p.seg[1]-at)<.02&&u0>=Math.min(p.seg[0],p.seg[2])-.01&&u1<=Math.max(p.seg[0],p.seg[2])+.01);if(!e)continue;
  out.push({...(h?{x0:u0-P.sobra,x1:u1+P.sobra,z0:at-w,z1:at+w}:{x0:at-w,x1:at+w,z0:u0-P.sobra,z1:u1+P.sobra}),y0:0,y1:P.alto,lote:L.id,nivel:jugador.nivel,borde:'puerta',key:kd,seg:sg,pared:e.key});}
 // (si pasan del máximo que acepta el 3D, las más cerca del jugador)
 if(out.length>VISIBILIDAD.maximo)out.sort((p,q)=>dPS(jugador.x,jugador.z,...p.seg)-dPS(jugador.x,jugador.z,...q.seg)).length=VISIBILIDAD.maximo;
 return out;}
