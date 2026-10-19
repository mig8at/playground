/* Las piezas de fachada low poly propias (2026-10-16, Miguel: «ventanas y acabados low poly propios»): en lugar de las
   piezas del Downtown MegaKit (ladrillo en relieve, marcos tallados, molduras con textura), cajas de color plano con la
   MISMA huella —2 m de ancho, 3 de alto, la cara de afuera en z = 0 y la de adentro en z = −0,2— y el MISMO vidrio (el
   que el 2D usa para la luz de cada cuarto: VIDRIO de medidas.js sale de esas medidas). town3d.js las pide igual que
   antes, por nombre; downtown3d.js las cambia al cargar el paquete (LOWPOLY).
   Puro: piezaLowPoly(nombre, medidas) da cajas {x0,x1,y0,y1,z0,z1, mat}, con mat el material del paquete que les toca
   (así el tinte del edificio —pared, moldura— las pinta igual). medidas: {material: {min:[x,y,z], max:[x,y,z]}}, las de
   cada material de la pieza original (las mismas en el navegador y en el validador, que las lee de los .gltf). */

// Las piezas que se cambian: las de muro, ventana, vidriera, puerta, cornisa, columna y banda. Los accesorios (escaleras,
// barandas, aire acondicionado, mansarda, losas, hojas de puerta) siguen siendo del paquete, ya lisos.
import {COLUMNA} from '../engine/medidas.js';
export const ES_DE_FACHADA=n=>/(Window|FirstFloor|Plain|BottomTrim|TopTrim|Inset|Cornice_|Column|Ornament|DoorFrame)/.test(n)&&!/InteriorWall|Wall_Guard|SlateCornice/.test(n);
// Medidas del acabado (m): el marco alrededor del vidrio, lo que sobresale, el alféizar y el dintel.
export const ACABADO={marco:.08,saliente:.05,alfeizar:{alto:.06,sale:.1,sobra:.08},dintel:{alto:.12,sale:.06,sobra:.06},zocalo:.8,capa:.1};
// Los materiales propios de las zonas del esquema (color.js esquemaDe, 2026-10-18): los marcos de ventanas y puertas, y el
// zócalo de la planta baja (de .35 a .8 m: la franja de Guatapé, que se lee de lejos).
export const MARCO='MI_Marco',ZOCALO='MI_Zocalo';
export const PARED=['MI_RedBrick','MI_RedBrick_Pale','MI_Trim_MetalConcrete','MI_Concrete','MI_Trim'];

// La pared de la pieza: el material pintable más grande (el que lleva el color de la fachada)
const paredDe=M=>{let best=null,ba=-1;for(const k of PARED){const b=M[k];if(!b)continue;const a=(b.max[0]-b.min[0])*(b.max[1]-b.min[1]);if(a>ba){ba=a;best=k;}}return best||'MI_RedBrick';};
const caja=(x0,x1,y0,y1,z0,z1,mat)=>({x0:Math.min(x0,x1),x1:Math.max(x0,x1),y0:Math.min(y0,y1),y1:Math.max(y0,y1),z0:Math.min(z0,z1),z1:Math.max(z0,z1),mat});

// Un muro de [x0,x1]×[y0,y1] con un vano [vx0,vx1]×[vy0,vy1] (o sin vano): dos capas —afuera la pared, adentro el revoque
// interior— partidas alrededor del vano.
function muro(out,x0,x1,y0,y1,pared,vano){const A=ACABADO.capa;
 const M_=(...q)=>out.push({...caja(...q),muro:true});
 const capas=[[pared,-A,0],['MI_InteriorWall',-.2,-A]];
 for(const [m,z0,z1] of capas){if(!vano){M_(x0,x1,y0,y1,z0,z1,m);continue;}const [a,b,c,d]=vano;
  if(a>x0+1e-6)M_(x0,a,y0,y1,z0,z1,m);if(b<x1-1e-6)M_(b,x1,y0,y1,z0,z1,m);
  if(c>y0+1e-6)M_(a,b,y0,c,z0,z1,m);if(d<y1-1e-6)M_(a,b,d,y1,z0,z1,m);}}

// Sin caras que titilen (2026-10-16, Miguel: «mucho ruido al moverme, un parpadeo incómodo»): un acabado (zócalo,
// alféizar, dintel, jamba) que comparte un plano con el muro —la cara de adentro en z = −0,2, el borde del módulo, la
// base— y mira al mismo lado se pisa con él y la GPU los alterna al mover la cámara (z-fighting). Esa cara del acabado
// se retira SIN_TITILAR hacia adentro de sí mismo: queda metida en el muro (o a 3 mm de su vecino) y no se nota. Entre
// dos acabados, se retira la del más chico. Lo comprueba validar-fachada3d.
export const SIN_TITILAR=.003;
const vol=b=>(b.x1-b.x0)*(b.y1-b.y0)*(b.z1-b.z0);
function sinTitilar(C){const ejes=[['x','y','z'],['y','x','z'],['z','x','y']];
 for(let pasada=0;pasada<3;pasada++){let cambios=0;
  for(const a of C)for(const b of C){if(a===b||a.mat===b.mat)continue;
   // (se retira a: si b es muro y a no, o si son del mismo tipo y a es el más chico)
   if(a.muro&&!b.muro)continue;if(!!a.muro===!!b.muro&&(vol(a)>vol(b)||(vol(a)===vol(b)&&C.indexOf(a)<C.indexOf(b))))continue;
   for(const [k,u,v] of ejes)for(const [l,sg] of [['0',1],['1',-1]]){if(Math.abs(a[k+l]-b[k+l])>1e-4)continue;
    const ou=Math.min(a[u+'1'],b[u+'1'])-Math.max(a[u+'0'],b[u+'0']),ov=Math.min(a[v+'1'],b[v+'1'])-Math.max(a[v+'0'],b[v+'0']);
    if(ou>.002&&ov>.002&&a[k+'1']-a[k+'0']>3*SIN_TITILAR){a[k+l]+=sg*SIN_TITILAR;cambios++;}}}
  if(!cambios)break;}
 for(const c of C)delete c.muro;return C;}
export function piezaLowPoly(nombre,M){return sinTitilar(piezaBase(nombre,M));}
function piezaBase(nombre,M){const out=[],X=M.__x||[-1,1],Y=M.__y||[0,3],pared=paredDe(M),A=ACABADO,mol='MI_Trim',g=M.MI_Glass;
 const x0=X[0],x1=X[1],y0=Y[0],y1=Y[1];
 // (la caja de toda la pieza original, en z también)
 const Zs=Object.entries(M).filter(([k])=>!k.startsWith('__')).map(([,v])=>v),z0=Math.min(...Zs.map(v=>v.min[2])),z1=Math.max(...Zs.map(v=>v.max[2]));
 // la columna de esquina (COLUMNA): un pilar cuadrado centrado en el origen —town3d lo corre hacia afuera de la esquina—,
 // con base y capitel, del color del material más grande del original (la de ladrillo era una L de 1 m por lado que
 // tapaba media ventana)
 if(/Column_(Bottom|Center|Top)|CornerColumn/.test(nombre)){const m=Object.keys(M).filter(k=>!k.startsWith('__')).sort((a,b)=>{const A_=M[a],B_=M[b];return (B_.max[1]-B_.min[1])*(B_.max[0]-B_.min[0])-(A_.max[1]-A_.min[1])*(A_.max[0]-A_.min[0]);})[0]||mol,h=COLUMNA.lado/2,e=.03;
  out.push(caja(-h+e,h-e,y0,y1,-h+e,h-e,m),caja(-h,h,y0,y0+.2,-h,h,m),caja(-h,h,y1-.15,y1,-h,h,m));return out;}
 // la columna: un pilar liso con base y capitel, en la caja del original y del color de su material más grande
 if(/Column/.test(nombre)){const m=Object.keys(M).filter(k=>!k.startsWith('__')).sort((a,b)=>{const A_=M[a],B_=M[b];return (B_.max[1]-B_.min[1])*(B_.max[0]-B_.min[0])-(A_.max[1]-A_.min[1])*(A_.max[0]-A_.min[0]);})[0]||mol,e=.04;
  out.push(caja(x0+e,x1-e,y0,y1,z0+e,z1-e,m),caja(x0,x1,y0,y0+Math.min(.2,(y1-y0)/4),z0,z1,m),caja(x0,x1,y1-Math.min(.15,(y1-y0)/4),y1,z0,z1,m));return out;}
 // la cornisa: el friso, la saliente y la tapa, a la altura del original
 if(/Cornice_/.test(nombre)){const h=y1-y0,zi=Math.max(z0,-.2);
  out.push(caja(x0,x1,y0,y0+.55*h,zi,0,pared),caja(x0,x1,y0+.55*h,y0+.78*h,zi,Math.min(.22,z1+.22),mol),caja(x0,x1,y0+.78*h,y0+.9*h,zi,Math.min(.12,z1+.12),mol));return out;}
 // la banda: un listón horizontal
 if(/Ornament/.test(nombre)){out.push(caja(x0,x1,y0,y1,z0,z1+.03,mol));return out;}
 // con vidrio: el vano del vidrio, el marco, el alféizar y el dintel (o, en la planta baja, la vidriera con su zócalo)
 // (el vano: el vidrio más el marco, sin salirse de la pieza —en las vidrieras el vidrio llega casi al borde—)
 if(g){const gx0=g.min[0],gx1=g.max[0],gy0=g.min[1],gy1=g.max[1],F=A.marco,vano=[Math.max(x0,gx0-F),Math.min(x1,gx1+F),Math.max(y0,gy0-F),Math.min(y1,gy1+F)];
  const puerta=/DoorFrame/.test(nombre),vidriera=/FirstFloor/.test(nombre);
  if(puerta){// el marco de la puerta: el vano (de la moldura, como mínimo del ancho del vidrio más su marco, dentro de la
   // pieza) y, si el vidrio está arriba (una banderola), su travesaño; si no, el vidrio va en la hoja y no acá
   const t=M[mol]||{min:[-.57,0,-.2],max:[.57,2.81,0]},trans=gy0>1.9,dx0=Math.max(x0+F,Math.min(t.min[0]+F,trans?gx0-F:1e9)),dx1=Math.min(x1-F,Math.max(t.max[0]-F,trans?gx1+F:-1e9)),top=Math.min(y1-A.dintel.alto,trans?gy1+F:t.max[1]);
   muro(out,x0,x1,y0,y1,pared,[dx0,dx1,y0,top]);
   out.push(caja(dx0-F,dx0,y0,top,-.2,A.saliente,MARCO),caja(dx1,dx1+F,y0,top,-.2,A.saliente,MARCO),caja(dx0-F,dx1+F,top,top+A.dintel.alto,-.2,A.dintel.sale,mol));
   if(trans){out.push(caja(dx0,dx1,gy0-F,gy0,-.2,A.saliente,MARCO));out.push(caja(gx0,gx1,gy0,gy1,-.1,-.09,'MI_Glass'));}
   return out;}
  muro(out,x0,x1,y0,y1,pared,vano);
  // el marco (cuatro listones) y un parante al medio en las anchas
  out.push(caja(vano[0],vano[0]+F,vano[2],vano[3],-.2,A.saliente,MARCO),caja(vano[1]-F,vano[1],vano[2],vano[3],-.2,A.saliente,MARCO),caja(vano[0],vano[1],vano[3]-F,vano[3],-.2,A.saliente,MARCO),caja(vano[0],vano[1],vano[2],vano[2]+F,-.2,A.saliente,MARCO));
  if(gx1-gx0>=.9)out.push(caja((gx0+gx1)/2-.025,(gx0+gx1)/2+.025,gy0,gy1,-.12,-.06,MARCO));
  if(vidriera){// el zócalo bajo la vidriera
   if(vano[2]>y0+.05)out.push(caja(x0,x1,y0,Math.min(vano[2],A.zocalo),-.2,A.saliente,ZOCALO));}
  else{const S=A.alfeizar,D=A.dintel,cx=v=>Math.max(x0,Math.min(x1,v));// el alféizar y el dintel, un poco más anchos que el vano (dentro de la pieza)
   if(vano[2]-S.alto>=y0-1e-6)out.push(caja(cx(vano[0]-S.sobra),cx(vano[1]+S.sobra),vano[2]-S.alto,vano[2],-.2,S.sale,mol));
   if(vano[3]+D.alto<=y1+1e-6)out.push(caja(cx(vano[0]-D.sobra),cx(vano[1]+D.sobra),vano[3],vano[3]+D.alto,-.2,D.sale,mol));}
  out.push(caja(gx0,gx1,gy0,gy1,-.1,-.09,'MI_Glass'));return out;}
 // sin vidrio: el muro liso (con su zócalo en la planta baja, o el remate de arriba)
 muro(out,x0,x1,y0,y1,pared,null);
 if(/BottomTrim|FirstFloor_Wall/.test(nombre))out.push(caja(x0,x1,y0,A.zocalo,-.2,A.saliente,ZOCALO));
 if(/TopTrim/.test(nombre))out.push(caja(x0,x1,y1-.25,y1,-.2,A.saliente,mol));
 return out;}

// Las medidas de una pieza original, por material, desde sus partes {geo, mat} (en el navegador) o sus accesores (node)
export function medidasDePartes(parts){const M={};let X=[1e9,-1e9],Y=[1e9,-1e9];for(const p of parts){const b=p.box;const k=p.mat;const m=M[k]||(M[k]={min:[1e9,1e9,1e9],max:[-1e9,-1e9,-1e9]});
 for(let i=0;i<3;i++){m.min[i]=Math.min(m.min[i],b.min[i]);m.max[i]=Math.max(m.max[i],b.max[i]);}X=[Math.min(X[0],b.min[0]),Math.max(X[1],b.max[0])];Y=[Math.min(Y[0],b.min[1]),Math.max(Y[1],b.max[1])];}
 M.__x=X;M.__y=Y;return M;}

// La puerta de calle doble (PUERTA.doble de medidas.js): un módulo de 2 m con el vano de ancho m (de 0 a 2,48), jambas,
// dintel y una banderola de vidrio arriba de las hojas (las hojas, aparte: town3d pone dos de ancho/2, espejadas). pared:
// el material del muro (el de la fachada de su familia, para que la pinte su tinte).
export const PUERTA_DOBLE=pared=>'LP_PuertaDoble_'+pared;
export function puertaDobleLowPoly(pared,ancho){const a=ancho/2;
 return piezaLowPoly('DoorFrame_Doble',{[pared]:{min:[-1,0,-.1],max:[1,3,0]},MI_Trim:{min:[-a-.08,0,-.2],max:[a+.08,2.45,0]},MI_Glass:{min:[-a+.04,2.3,-.1],max:[a-.04,2.4,-.1]},__x:[-1,1],__y:[0,3]});}

// La marquesina de la entrada principal (2026-10-18, FACHADAS.md B5): una losa delgada que sale 1,5 m sobre la puerta, a
// 2,7 m, con su frente; la del hospital, blanca con la cruz roja en el frente (urgencias), la del hotel, del acento
// (MI_Trim_Dark: la carpintería, que el esquema pinta del acento). Sin texto: el low poly no lleva letreros.
export const MARQUESINA=tipo=>'LP_Marquesina_'+tipo;
export function marquesinaLowPoly(tipo){const m=tipo==='urgencias'?'MI_Blanco':'MI_Trim_Dark',a=1.7,z1=1.5,out=[
 caja(-a,a,2.72,2.84,0,z1,m),caja(-a,a,2.5,3.05,z1-.1,z1,m),caja(-a,-a+.06,2.5,2.84,0,z1,m),caja(a-.06,a,2.5,2.84,0,z1,m)];
 if(tipo==='urgencias')out.push(caja(-.32,.32,2.71,2.84,z1,z1+.02,'MI_Cruz'),caja(-.1,.1,2.55,3.0,z1,z1+.02,'MI_Cruz'));
 return out;}

// El ventanal de vivienda (2026-10-18, FACHADAS.md A2; medidas.js VENTANAS_VIVIENDA): 1,5 m de ancho, antepecho de 0,9 m
// y vidrio hasta 2,7 (VIDRIO_VENTANAL de fachada.js), con el marco, el alféizar y el dintel de cualquier ventana. Uno por
// material de muro, como la puerta doble (town3d lo pide con el de su fachada).
export const VENTANAL=pared=>'LP_Ventanal_'+pared;
export function ventanalLowPoly(pared,g){return piezaLowPoly('Window_Ventanal',{[pared]:{min:[-1,0,-.2],max:[1,3,0]},MI_Glass:{min:[g[0],g[2],-.1],max:[g[1],g[3],-.1]},__x:[-1,1],__y:[0,3]});}
