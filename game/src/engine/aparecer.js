// DÓNDE APARECE QUIEN ENTRA (2026-11-21, Miguel: «podés colocar punticos en la ciudad, y donde esté menos poblado, ahí
// aparece la persona; va a terminar teniendo un límite de población»).
//
// Todavía no hay personajes: una persona es un punto {x, z} en metros. Esto contesta tres cosas, sólo con el plano:
//   · SITIOS: los lugares donde alguien puede aparecer. Uno por cada casilla de vía que tiene una manzana al lado, sobre
//     el andén, en la franja de paso (a CALLE.fachada + CALLE.paso/2 de la línea de edificación: ni pegado al muro ni
//     sobre el cordón), y que no cae encima de un árbol, una pieza de mobiliario o un contenedor.
//   · CUÁNTA GENTE hay en un sitio: cada persona a menos de RADIO pesa (1 − d/RADIO)², o sea 1 si está encima y 0 a RADIO.
//     Es un número parejo (no salta cuando alguien cruza un borde) y sale de una cuenta, sin azar.
//   · DÓNDE APARECE: el sitio donde ese número es menor. Si empatan (pasa siempre que hay barrios vacíos: todos dan 0),
//     gana el que tiene a la persona más cercana MÁS LEJOS; y con la ciudad vacía, el más cercano al centro. Así el
//     primero cae en el medio y los que siguen se van repartiendo solos.
// EL CUPO: una ciudad admite una persona por vivienda (cada quien compra un lugar). Llena, no entra nadie más: se abre
// otro mundo. Es la propuesta de partida, un solo número para cambiar (POR_VIVIENDA).
import {CELL} from './blueprint.js';
import {CALLE} from './medidas.js';

export const RADIO=30;// (m: hasta dónde alguien «puebla» un lugar; media cuadra larga)
export const POR_VIVIENDA=1;
const K_VIA=new Set([0,1]),K_BORDE=12;// street, avenue · la muralla

export function sitiosDe(bp){const {W,H,kind}=bp.map,dentro=(x,y)=>x>=0&&y>=0&&x<W&&y<H,via=(x,y)=>dentro(x,y)&&K_VIA.has(kind[y*W+x]);
 const estorbos=[...(bp.vegetacion?.arboles||[]).filter(a=>a.tipo==='calle'||a.tipo==='avenida').map(a=>({x:a.x,z:a.z,r:.9})),...(bp.equipamiento||[]).filter(e=>e.tipo!=='cebra').map(e=>({x:e.x,z:e.z,r:1.2})),...(bp.contenedores||[]).map(c=>({x:c.x,z:c.z,r:1.4}))];
 const d0=CALLE.fachada+CALLE.paso/2,out=[];
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!via(x,y))continue;
  for(const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]){if(!dentro(x+dx,y+dy)||via(x+dx,y+dy)||kind[(y+dy)*W+x+dx]===K_BORDE)continue;
   // sobre el andén de ese lado: a d0 de la línea de edificación, en el medio de la casilla a lo largo
   const px=dx?(dx<0?x*CELL+d0:(x+1)*CELL-d0):(x+.5)*CELL,pz=dy?(dy<0?y*CELL+d0:(y+1)*CELL-d0):(y+.5)*CELL;
   if(estorbos.some(e=>Math.hypot(e.x-px,e.z-pz)<e.r))continue;
   out.push({x:+px.toFixed(2),z:+pz.toFixed(2),cx:x,cy:y});}}
 return out;}

// Cuánta gente hay alrededor de un punto, y a qué distancia está la más cercana.
export function poblacionEn(p,gente,radio=RADIO){let n=0,cerca=Infinity;for(const q of gente){const d=Math.hypot(q.x-p.x,q.z-p.z);if(d<cerca)cerca=d;if(d<radio){const u=1-d/radio;n+=u*u;}}return {n,cerca};}

export function cupoDe(bp){let viviendas=0;for(const L of bp.lots){const u=new Set();L.levels.slice(0,L.floors).forEach((lv,i)=>{for(const q of lv.rooms)if(q.unit!=null)u.add(i+':'+q.unit);});/* (el número de unidad se repite en cada piso) */viviendas+=u.size;if(L.type==='casa')viviendas++;}
 viviendas+=(bp.isla?.casas||[]).filter(c=>c.spec).length;return {viviendas,cupo:Math.floor(viviendas*POR_VIVIENDA)};}

// El sitio donde aparece el próximo. sitios: los de sitiosDe (se pasan para no recalcularlos en cada entrada).
// Devuelve {ok, x, z, n (cuánta gente hay ahí), cerca (m a la persona más cercana), razon}.
export function aparecerEn(bp,gente=[],{sitios=sitiosDe(bp),cupo=cupoDe(bp).cupo,radio=RADIO}={}){
 if(gente.length>=cupo)return {ok:false,razon:`La ciudad está llena: ${cupo} personas.`};
 if(!sitios.length)return {ok:false,razon:'La ciudad no tiene andenes donde aparecer.'};
 const cx=bp.map.W*CELL/2,cz=bp.map.H*CELL/2;let mejor=null;
 for(const s of sitios){const P=poblacionEn(s,gente,radio),n=P.n,cerca=Math.min(P.cerca,1e9),/* (sin nadie, la distancia es infinita y no se puede comparar) */centro=Math.hypot(s.x-cx,s.z-cz);
  // menos gente; a igual gente (con 1e-9 de tolerancia), más lejos de la más cercana; a igual, más cerca del centro
  if(!mejor||n<mejor.n-1e-9||Math.abs(n-mejor.n)<=1e-9&&(cerca>mejor.cerca+1e-6||Math.abs(cerca-mejor.cerca)<=1e-6&&centro<mejor.centro))mejor={s,n,cerca,centro};}
 return {ok:true,x:mejor.s.x,z:mejor.s.z,n:+mejor.n.toFixed(3),cerca:mejor.cerca<1e9?+mejor.cerca.toFixed(1):null};}

// GENTE DE PRUEBA: n puntos sobre los andenes, amontonados alrededor de unos pocos focos (como pasa de verdad: la gente
// se junta), para que «lo menos poblado» signifique algo. La misma semilla da siempre la misma gente.
export function poblar(bp,n,semilla=1,sitios=sitiosDe(bp)){let a=(semilla*2654435761)>>>0;const r=()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
 if(!sitios.length||n<=0)return [];const focos=Array.from({length:Math.max(2,Math.round(sitios.length/400))},()=>sitios[Math.floor(r()*sitios.length)]),out=[];
 for(let i=0;i<n;i++){const f=focos[Math.floor(r()*focos.length)];let s=null;
  // un sitio cerca de su foco: de 12 al azar, el más cercano (así se amontona sin quedar todos en el mismo punto)
  for(let k=0;k<12;k++){const c=sitios[Math.floor(r()*sitios.length)],d=Math.hypot(c.x-f.x,c.z-f.z);if(!s||d<s.d)s={c,d};}
  out.push({x:+(s.c.x+(r()-.5)*1.2).toFixed(2),z:+(s.c.z+(r()-.5)*1.2).toFixed(2)});}
 return out;}
