/* La isla de /demo: una isla flotando en el cielo, con la ciudad del generador en el centro. Desde el paseo del borde de
   la ciudad: una franja verde, la playa, agua baja hasta el borde de la isla, y por todo el borde el agua cae en
   cascada al vacío; donde hay montaña (uno o dos lados) la isla termina en acantilado. Pinos, árboles y palmeras; abajo,
   la roca que cuelga hasta una punta; alrededor, nubes. Se puede caminar por todo (playa, agua baja, praderas,
   montañas) menos el agua honda y el vacío. Todo sale de la semilla de la ciudad. Es sólo paisaje: para el juego, el
   borde de la ciudad sigue siendo una pared. */
import * as THREE from 'three';
import {CELL} from './world3d.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {plantInstances} from './nature3d.js';
import {liftFor} from './sitting3d.js';
import {islaDe,CLIFF,WATER,mascaraRebaje} from '../engine/isla.js';
import {CALLE,TERRAZA} from '../engine/medidas.js';
// (2026-10-16: los arreglos de los huecos junto a las terrazas —sin rampas, rellenos sólo hasta TERRAZA.acceso y el muro
// del andén hasta el lote—; en false, el dibujo de antes, para comparar: 70 huecos en 26 casillas de la ciudad 1)
const SIN_HUECOS=!globalThis.process?.env?.FUGA_CON_HUECOS;// (FUGA_CON_HUECOS=1 en node: el dibujo de antes, para probar el detector)
import {LOWPOLY} from './downtown3d.js';
// Perillas del 3D de la isla. arboles: pinos, árboles de copa, palmeras y la alameda.
// faroles: los de las carreteras de montaña armados acá; con el plano los pone su equipamiento (plano3d.js) y van apagados.
export const ISLA3D={arboles:false,faroles:true};

// Edificios del «Simple Buildings Pack» de Quaternius (CC0, public/models/edificios): cinco casas, hospital, un edificio
// de columnas, dos de departamentos y una tienda, todos con la misma disposición de colores en una paleta de 32×32
// (Textures/): la paleta elige el color de los techos y remates. Son sólo fachada (no tienen interior).
const BUILDING_MODELS=['House','House2','House3','House4','House5','Hospital','Bank','Flat','Flat2','Shop'];
const BUILDING_TEXTURES=['HouseTexture1','HouseTexture2','HouseTexture3','HouseTexture4','Hotel','Shop'];
// El hospital trae una arista suelta («l» en el .obj): con ella el cargador lo convierte entero en líneas, así que se
// quita del texto antes de leerlo.
const BUILDING_SCALE=5; // vienen chicos: una casa mide 1,2 × 1,7; así queda de unos 6 × 8,5 m
let buildingCache=null;
export function loadIslandBuildings(){
 if(buildingCache)return buildingCache;const base='/models/edificios/',models={},textures={},loader=new OBJLoader(),tl=new THREE.TextureLoader();
 buildingCache=Promise.all([...BUILDING_MODELS.map(n=>fetch(base+n+'.obj').then(x=>x.ok?x.text():Promise.reject()).then(t=>{models[n]=loader.parse(t.replace(/^l .*$/gm,''));}).catch(()=>{})),
  ...BUILDING_TEXTURES.map(n=>tl.loadAsync(base+'Textures/'+n+'.png').then(t=>{t.colorSpace=THREE.SRGBColorSpace;t.magFilter=t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;textures[n]=t;}).catch(()=>{}))])
  .then(()=>Object.keys(models).length&&Object.keys(textures).length?{models,textures}:null);
 return buildingCache;
}

function rng(seed){let n=seed>>>0;return()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
// Ruido de valores suave (y su fbm), con la semilla de la ciudad.
function valueNoise(seed){
 const h=(x,y)=>{let n=Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(seed|0,1274126177);n=Math.imul(n^n>>>13,1274126177);return((n^n>>>16)>>>0)/4294967296;};
 const s=t=>t*t*(3-2*t);
 const v=(x,y)=>{const xi=Math.floor(x),yi=Math.floor(y),xf=s(x-xi),yf=s(y-yi);const a=h(xi,yi),b=h(xi+1,yi),c=h(xi,yi+1),d=h(xi+1,yi+1);return a+(b-a)*xf+(c-a)*yf+(a-b-c+d)*xf*yf;};
 return (x,y,oct=4)=>{let sum=0,amp=.5,f=1,norm=0;for(let i=0;i<oct;i++){sum+=v(x*f,y*f)*amp;norm+=amp;amp*=.5;f*=2.03;}return sum/norm;};
}
const hash01=(x,y)=>{let h=Math.imul(Math.round(x*10)|0,374761393)+Math.imul(Math.round(y*10)|0,668265263);h=Math.imul(h^h>>>13,1274126177);return((h^h>>>16)>>>0)/4294967296;};
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

export const ISLAND_MARGIN=520;  // hasta dónde puede ir el dron más allá de la ciudad
export {CLIFF};

// El muro de contención de las terrazas: piedra en hiladas irregulares con juntas de mortero (textura de lienzo). La
// textura va en metros del mundo (3 m por repetición), así no se estira en un muro alto ni se encoge en uno bajo: el
// sombreador toma las coordenadas del lugar (x o z a lo largo, y hacia arriba) en vez de las de la caja.
let piedraTex=null;
function muroDePiedra(){
 if(!piedraTex){const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d'),r=rng(4242);
  g.fillStyle='#6f675c';g.fillRect(0,0,256,256);// el mortero
  const tonos=['#a39887','#958a7a','#ada290','#8c8273','#b3a996','#9c917f'];let y=0;
  while(y<256){const h=22+Math.floor(r()*16),off=r()*40;let x=-off;
   while(x<256){const w=30+Math.floor(r()*40);g.fillStyle=tonos[Math.floor(r()*tonos.length)];
    const pad=2.2;g.beginPath();g.moveTo(x+pad+r()*2,y+pad+r()*2);g.lineTo(x+w-pad-r()*2,y+pad+r()*2);g.lineTo(x+w-pad-r()*2,y+h-pad-r()*2);g.lineTo(x+pad+r()*2,y+h-pad-r()*2);g.closePath();g.fill();
    // un poco de relieve: luz arriba, sombra abajo
    g.fillStyle='rgba(255,255,255,.08)';g.fillRect(x+pad,y+pad,w-2*pad,3);g.fillStyle='rgba(0,0,0,.12)';g.fillRect(x+pad,y+h-pad-3,w-2*pad,3);
    for(let k=0;k<14;k++){g.fillStyle=r()<.5?'rgba(0,0,0,.07)':'rgba(255,255,255,.07)';g.fillRect(x+r()*w,y+r()*h,2,2);}
    x+=w;}
   y+=h;}
  // la fila de arriba toca la de abajo al repetir: se repinta una junta
  g.fillStyle='#6f675c';g.fillRect(0,254,256,2);
  piedraTex=new THREE.CanvasTexture(c);piedraTex.wrapS=piedraTex.wrapT=THREE.RepeatWrapping;piedraTex.colorSpace=THREE.SRGBColorSpace;piedraTex.anisotropy=4;}
 // (LOWPOLY: la piedra, un gris cálido liso con caras planas)
 const m=new THREE.MeshStandardMaterial(LOWPOLY.on?{color:'#b3a99a',roughness:.95,flatShading:true}:{map:piedraTex,roughness:.95});
 if(!LOWPOLY.on)m.onBeforeCompile=sh=>{
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vMuroP;varying vec3 vMuroN;')
   .replace('#include <begin_vertex>',`#include <begin_vertex>
    vec4 muroP=vec4(transformed,1.0);vec3 muroN=objectNormal;
    #ifdef USE_INSTANCING
     muroP=instanceMatrix*muroP;muroN=mat3(instanceMatrix)*muroN;
    #endif
    vMuroP=(modelMatrix*muroP).xyz;vMuroN=normalize(mat3(modelMatrix)*muroN);`);
  sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vMuroP;varying vec3 vMuroN;')
   .replace('#include <map_fragment>',`vec2 muroUV=abs(vMuroN.y)>.5?vMuroP.xz:vec2(abs(vMuroN.x)>abs(vMuroN.z)?vMuroP.z:vMuroP.x,vMuroP.y);
    vec4 sampledDiffuseColor=texture2D(map,muroUV/3.0);diffuseColor*=sampledDiffuseColor;`);};
 m.customProgramCacheKey=()=>'muro-piedra';
 return m;
}

export function buildIsland(map,{plan=null,buildings=null,plants=null,nature=null,furniture=null}={}){
 // La isla como datos (src/engine/isla.js): los macizos, el contorno y la altura de cada punto. El azar r sigue desde ahí.
 const I=islaDe(map),{S,Wm,Hm,cx,cz,r,fbm,sectors,angDiff,mountain,outside,rimOf,edgeAlong,rimAt,rimPoint,beyond}=I,group=new THREE.Group(),own=[];
 // El rebaje de la montaña, sólo junto a la grilla (la huella del plano): el resto, la montaña natural.
 if(plan?.isla?.huella)I.setMascara(mascaraRebaje(plan.isla.huella));
 // Con el plano, cada casa se asienta al nivel del suelo frente a su puerta, y el terreno se rebaja o se rellena alrededor
 // (desbaste): plano en la casa más PAD_M m, y empalma con la ladera en PAD_B m. Así se camina alrededor y se entra a
 // todas sin zócalo. Todo lo que mira la altura (el terreno, los árboles, los senderos, la gente) ve el terreno ya
 // desbastado. La casa mira a +z local (el frente).
 const land0=I.landH;// el terreno natural, sin desbastes (I se tapa más abajo con la isla del plano)
 const PAD_M=2.5,PAD_B=6,pads=[];
 if(plan?.isla)for(const L of plan.isla.lots){if(L.nivel!=null)continue;const q=L.rect,F=L.front,ry=F==='S'?0:F==='N'?Math.PI:F==='E'?Math.PI/2:-Math.PI/2,horiz=F==='N'||F==='S',w=(horiz?q.w:q.h)-.8,d=(horiz?q.h:q.w)-.8,x=q.x+q.w/2,z=q.y+q.h/2;
  const fx=x+Math.sin(ry)*(d/2+2),fz=z+Math.cos(ry)*(d/2+2);pads.push({x,z,ry,w,d,h:Math.max(I.landH(fx,fz),.25),R:Math.hypot(w,d)/2+PAD_M+PAD_B,id:L.id});}
 // (2026-10-16, medido sin pantalla —validar-oclusion—: los objetos de base plana del plano —banca, kiosco, parada,
 // salvavidas, papelera, hidrante— sobre el terreno natural, con su plataforma: la malla del terreno va en triángulos de
 // 2,6 m y en una ladera dejaba una esquina flotando o hundida hasta 21 cm aunque el 2D la viera pareja)
 for(const o of plan?.equipamiento||[]){if(!['banca','papelera','kiosco','parada','salvavidas','hidrante'].includes(o.tipo)||outside(o.x,o.z)<=0)continue;const w=o.largo||.6,d=o.fondo||.6;
  pads.push({x:o.x,z:o.z,ry:o.ang||0,w,d,h:null,obj:true,m:2.8,b:2.5,R:Math.hypot(w,d)/2+2.8+2.5});}// (m: un triángulo de la malla —2,6 m— de margen: si no, sus vértices quedaban afuera de la plataforma)
 // (las plataformas que se tocan van juntas, a una sola altura —la de la primera—: dos bancas a 4 m se torcían una a la otra)
 {const ob=pads.filter(p=>p.obj);for(const p of ob)p.grupo=p;const raiz=p=>{while(p.grupo!==p)p=p.grupo;return p;};
  for(let i=0;i<ob.length;i++)for(let j=i+1;j<ob.length;j++){const a=ob[i],b=ob[j];if(Math.hypot(a.x-b.x,a.z-b.z)<Math.hypot(a.w,a.d)/2+Math.hypot(b.w,b.d)/2+a.m+b.m){const ra=raiz(a),rb=raiz(b);if(ra!==rb)rb.grupo=ra;}}
  for(const p of ob)p.grupo=raiz(p);}
 // Las terrazas de los pueblos (etapa 9): cada casilla del pueblo es una meseta plana a su nivel; alrededor del pueblo el
 // terreno empalma en TER_B m. terrazaAt da el nivel de la casilla de un punto (o null).
 const TER_B=6,ter=new Map();if(plan?.isla)for(const c of plan.isla.cells)if(c.terraza!=null)ter.set(c.x+','+c.y,c.terraza);
 const terrazaAt=(x,z)=>ter.get(Math.floor(x/6)+','+Math.floor(z/6))??null;
 // Las casillas de lote al borde de una calle de la grilla que queda más baja que el lote: ahí va una rampa que sube
 // (island3d, junto a las calles) y su bloque se dibuja más bajo, a la altura más baja de la calle a lo largo de la casilla.
 // Se llena cuando ya están las calles (rampaTope); rampaArriba(cx, cy) dice si una casilla es así.
 const rampas=new Map(),rampaArriba=(cx,cy)=>rampas.has(cx+','+cy);
 const nearTerraza=(x,z)=>{const cx=Math.floor(x/6),cz=Math.floor(z/6);let best=Infinity,lv=null;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){const v=ter.get((cx+dx)+','+(cz+dz));if(v==null)continue;
   const qx=Math.max((cx+dx)*6,Math.min(x,(cx+dx+1)*6)),qz=Math.max((cz+dz)*6,Math.min(z,(cz+dz+1)*6)),d=Math.hypot(qx-x,qz-z);if(d<best){best=d;lv=v;}}return {d:best,lv};};
 // Las carreteras de montaña (etapa 9): el trazado por casillas se suaviza (Chaikin, dos pasadas) y su altura es la del
 // terreno promediada a lo largo (unos 30 m), con el nivel de la terraza en los pueblos. El terreno se corta o se rellena a
 // lo ancho (ROAD_W) y empalma en ROAD_B m. roadAt(x,z) da la carretera más cercana: {d, h} (d: distancia al eje).
 // La sección de una calle de la ciudad (world3d.js): 6 m, 4 de asfalto y 1 m de andén a cada lado, 15 cm arriba.
 const ROAD_W=6,ASF=4,CURB_H=.15,ROAD_B=6,roads=[],roadLights=[];// roadLights: los faroles de las carreteras (el demo les pone luz de noche)
 // Con el trazado de la serpentina (r.puntos: x, z y la altura de la carretera) se usa tal cual: ya es suave y su
 // perfil respeta la pendiente máxima; si no, el trazado por casillas se suaviza y la altura sale del terreno.
 if(plan?.isla?.carreteras)for(const r of plan.isla.carreteras){if(r.puntos){
   // La carretera empieza en el borde de afuera de la casilla del muro, que la ciudad ya dibuja como calle (world3d.js):
   // sigue la carrera sin costura. Al final, la mini rotonda (r.rotonda).
   // En cada cruce la calle es plana hasta el borde del cruce (ROAD_W/2): un punto ahí a la altura del cruce, así el
   // terreno, la calle dibujada y las rampas usan el mismo perfil.
   const pts=r.puntos.map(p=>({...p})),ini=r.extremos?.[0]||null,fin=r.extremos?.[1]||null,plano=(a,b)=>{const l=Math.hypot(b.x-a.x,b.z-a.z);return l>ROAD_W?{...a,x:a.x+(b.x-a.x)*ROAD_W/2/l,z:a.z+(b.z-a.z)*ROAD_W/2/l,h:a.h}:null;};
   if(ini&&pts.length>1){const q=plano(pts[0],pts[1]);if(q)pts.splice(1,0,q);}if(fin&&pts.length>1){const q=plano(pts.at(-1),pts.at(-2));if(q)pts.splice(pts.length-1,0,q);}
   roads.push({RW:r.ancho||ROAD_W,ini,fin,muro:!!r.desde,P:pts.map(p=>[p.x,p.z]),H:pts.map(p=>p.h),IZ:pts.map(p=>p.izq||0),DE:pts.map(p=>p.der||0),rot:r.rotonda||null});continue;}let P=r.map(([x,y])=>[(x+.5)*6,(y+.5)*6]);
  for(let it=0;it<2;it++){const Q=[P[0]];for(let i=0;i+1<P.length;i++){const [ax,az]=P[i],[bx,bz]=P[i+1];Q.push([ax*.75+bx*.25,az*.75+bz*.25],[ax*.25+bx*.75,az*.25+bz*.75]);}Q.push(P.at(-1));P=Q;}
  const raw=P.map(([x,z])=>terrazaAt(x,z)??I.landH(x,z)),acc=[0];for(let i=1;i<P.length;i++)acc.push(acc[i-1]+Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]));
  const H=P.map((_,i)=>{const tv=terrazaAt(...P[i]);if(tv!=null)return tv;let sw=0,sh=0;for(let j=0;j<P.length;j++){const d=Math.abs(acc[j]-acc[i]);if(d>15)continue;const w=1-d/16;sw+=w;sh+=w*raw[j];}return sh/sw;});
  roads.push({P,H});}
 const segGrid=new Map(),SG=12;for(const [ri,R] of roads.entries())for(let i=0;i+1<R.P.length;i++){const [ax,az]=R.P[i],[bx,bz]=R.P[i+1];const pad=(R.RW||ROAD_W)/2+ROAD_B;
  const pad2=pad+(R.IZ?Math.max(R.IZ[i],R.DE[i],R.IZ[i+1],R.DE[i+1]):0);
  for(let gz=Math.floor((Math.min(az,bz)-pad2)/SG);gz<=Math.floor((Math.max(az,bz)+pad2)/SG);gz++)for(let gx=Math.floor((Math.min(ax,bx)-pad2)/SG);gx<=Math.floor((Math.max(ax,bx)+pad2)/SG);gx++){const k=gx+','+gz;(segGrid.get(k)||segGrid.set(k,[]).get(k)).push([ri,i]);}}
 const roadAt=(x,z)=>{const L=segGrid.get(Math.floor(x/SG)+','+Math.floor(z/SG))||[];let best=null;for(const [ri,i] of L){const R=roads[ri],[ax,az]=R.P[i],[bx,bz]=R.P[i+1],dx=bx-ax,dz=bz-az,l2=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l2)),d=Math.max(0,Math.hypot(ax+dx*t-x,az+dz*t-z)-((R.RW||ROAD_W)-ROAD_W)/2);// una avenida: como una calle más ancha
   if(!best||d<best.d){const side=(x-ax)*(-dz)+(z-az)*dx>=0,w=R.IZ?(side?R.IZ[i]+(R.IZ[i+1]-R.IZ[i])*t:R.DE[i]+(R.DE[i+1]-R.DE[i])*t):0;best={d,h:R.H[i]+(R.H[i+1]-R.H[i])*t,w};}}
  // La rotonda cuenta como carretera: plana hasta su borde (R) y, afuera, empalma igual que una carretera.
  for(const R of roads){const o=R.rot;if(!o)continue;const d=Math.hypot(x-o.x,z-o.z)-o.R+ROAD_W/2;if(d<ROAD_W/2+ROAD_B+2&&(!best||d<best.d))best={d:Math.max(0,d),h:o.h,w:0};}return best;};
 // Lejos de la carretera y de sus franjas (1,5 m más allá del borde): ahí no van árboles, rocas ni arbustos.
 const offRoad=(x,z)=>{if(!roads.length)return true;const rd=roadAt(x,z);return !rd||rd.d>ROAD_W/2+rd.w+1.5;};
 if(plan?.isla&&roads.length)for(const c of plan.isla.cells){if(!c.lote)continue;const x=(c.x+.5)*6,z=(c.y+.5)*6,rd=roadAt(x,z);if(!rd||rd.d>ROAD_W/2+3.5)continue;
  let mn=Infinity;for(const [ox,oz] of [[-3,-3],[3,-3],[-3,3],[3,3]]){const r2=roadAt(x+ox,z+oz);if(r2&&r2.d<ROAD_W/2+.5)mn=Math.min(mn,r2.h);}
  // (2026-10-16, Miguel: «siguen habiendo huecos en los escalones»: sin rampas —cada mitad va a la altura de su calle y no
  // hacen falta—: la casilla con rampa no llevaba bloque y, donde la calle de al lado no la dibujaba, quedaba hueca hasta
  // abajo de la isla. El bloque de la terraza baja con su muro hasta el andén, como entre dos terrazas)
  if(mn<Infinity&&c.terraza>mn+.07+CURB_H+.05&&!SIN_HUECOS){rampas.set(c.x+','+c.y,{orig:c.terraza,low:mn-.1});ter.set(c.x+','+c.y,mn-.4);}}// el terreno, debajo de la rampa
 const padded=f=>pads.length||ter.size||roads.length?(x,z)=>{const h0=f(x,z);if(ter.size){const v=terrazaAt(x,z);if(v!=null)return v;}
  // La carretera y su franja de ese lado quedan planas a la altura de la carretera; afuera, empalma en ROAD_B m.
  // (las plataformas de los objetos —P.obj— se aplican encima de todo lo demás: una banca junto a una calle del monte quedaba
  // en el empalme con la calle y sin su plataforma; 2026-10-16, validar-oclusion)
  const conObj=h=>{let best=1,ph=h;for(const P of pads){if(!P.obj)continue;const dx=x-P.x,dz=z-P.z;if(dx*dx+dz*dz>P.R*P.R)continue;
    const lx=dx*Math.cos(P.ry)-dz*Math.sin(P.ry),lz=dx*Math.sin(P.ry)+dz*Math.cos(P.ry),e=Math.max(Math.abs(lx)-(P.w/2+P.m),0),g=Math.max(Math.abs(lz)-(P.d/2+P.m),0),t=smooth(0,P.b,Math.hypot(e,g));
    if(t<best){best=t;const G=P.grupo||P;ph=G.h??(G.h=sinObj(G.x,G.z));}}return best>=1?h:ph+(h-ph)*best;};
  const rd=roads.length?roadAt(x,z):null;if(rd){const flat=ROAD_W/2+rd.w;if(rd.d<flat+ROAD_B){const t=smooth(0,ROAD_B,rd.d-flat);return conObj(rd.h+(h0-rd.h)*t);}}
  if(ter.size){const n=nearTerraza(x,z);if(n.d<TER_B)return conObj(n.lv+(h0-n.lv)*smooth(0,TER_B,n.d));}let best=1,ph=h0;for(const P of pads){if(P.obj)continue;const dx=x-P.x,dz=z-P.z;if(dx*dx+dz*dz>P.R*P.R)continue;
   const lx=dx*Math.cos(P.ry)-dz*Math.sin(P.ry),lz=dx*Math.sin(P.ry)+dz*Math.cos(P.ry),e=Math.max(Math.abs(lx)-(P.w/2+PAD_M),0),g=Math.max(Math.abs(lz)-(P.d/2+PAD_M),0),t=smooth(0,PAD_B,Math.hypot(e,g));
   if(t<best){best=t;ph=P.h;}}return conObj(best>=1?h0:ph+(h0-ph)*best);}:f;
 // (la altura de la plataforma de un objeto: la del terreno con todo lo demás en su centro —sin las plataformas de objetos—)
 let sinObj=(x,z)=>0;
 const landH=padded(I.landH);{const sinP=pads.filter(p=>p.obj),guard=pads.slice();sinObj=(x,z)=>{const keep=pads.splice(0,pads.length,...guard.filter(p=>!p.obj));const h=landH(x,z);pads.splice(0,pads.length,...keep);return h;};}
 const height=(x,z)=>{if(outside(x,z)<0)return -.02;return beyond(x,z)>0?CLIFF:landH(x,z);};
 // La malla del terreno, bajo y junto a las terrazas, queda por debajo de la meseta más baja cercana (los bloques de las
 // terrazas dibujan el piso ahí): así no asoma una rampa entre dos mesetas.
 // los cruces de la grilla del monte (las puntas de sus calles): centro, altura y medio lado (la calle más ancha que llega)
 const nodosCruce=(()=>{const m=new Map();for(const r of plan?.isla?.carreteras||[])for(const e of r.extremos||[]){if(!e)continue;const k=e.id;const c=m.get(k)||m.set(k,{x:e.x,z:e.z,h:e.h,R:0}).get(k);c.R=Math.max(c.R,(r.ancho||ROAD_W)/2);}return [...m.values()];})();
 const meshH=(x,z)=>{let h=height(x,z);
  // Bajo la carretera (y un poco a los costados) la malla queda debajo del asfalto: la malla es más gruesa que la cinta.
  if(roads.length){const rd=roadAt(x,z);if(rd&&rd.d<ROAD_W/2+.5)h=Math.min(h,rd.h-.35);// sólo debajo (afuera, sin zanja)
   // (2026-10-16, medido sin pantalla —validar-suelo—: junto a la calle, la ladera queda a la altura del andén un paso de
   // la malla más allá de su borde y desde ahí sube como mucho a 45°: si no, el triángulo entre un vértice bajo la calle y
   // otro alto en la ladera pasaba por encima del andén —hasta 63 cm—)
   else if(rd&&rd.d<ROAD_W/2+rd.w+2*step)h=Math.min(h,rd.h+.07+CURB_H+Math.max(0,rd.d-ROAD_W/2-rd.w-step));}// (hasta dos pasos de malla: más lejos ningún triángulo cruza el andén, y pisaba las plataformas de las bancas)
  // (y en las esquinas de los cruces —el cuadro del cruce y sus andenes, Rw por lado—: el mismo talud desde su borde)
  for(const c of nodosCruce){const dch=Math.max(Math.abs(x-c.x),Math.abs(z-c.z))-c.R;if(dch<0)h=Math.min(h,c.h-.35);else if(dch<2*step)h=Math.min(h,c.h+.07+CURB_H+Math.max(0,dch-step));}// (adentro del cuadro, debajo del asfalto)
  if(!ter.size)return h;const cx=Math.floor(x/6),cz=Math.floor(z/6);let lo=Infinity;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){const v=ter.get((cx+dx)+','+(cz+dz));if(v==null)continue;
   const qx=Math.max((cx+dx)*6,Math.min(x,(cx+dx+1)*6)),qz=Math.max((cz+dz)*6,Math.min(z,(cz+dz+1)*6));if(Math.hypot(qx-x,qz-z)<4.5)lo=Math.min(lo,v);}return lo<Infinity?Math.min(h,lo-.4):h;};

 // ---------- Arriba: el terreno low-poly, con caras planas y color por altura y pendiente ----------
 const reach=Math.max(...Array.from({length:72},(_,i)=>{const a=i/72*Math.PI*2;return edgeAlong(a)+rimOf(a);}))+20;
 const step=Math.max(2.6,reach*2/240),x0=cx-reach,z0=cz-reach,n=Math.ceil(reach*2/step);
 // Los vértices que caen fuera de la isla se corren justo al borde: así la orilla sigue el contorno (sin escalones).
 const Hh=new Float32Array((n+1)*(n+1)),VX=new Float32Array((n+1)*(n+1)),VZ=new Float32Array((n+1)*(n+1));
 for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){let x=x0+i*step,z=z0+j*step;const k=j*(n+1)+i;
  if(beyond(x,z)>0){const a=Math.atan2(z-cz,x-cx),R=rimAt(a);x=cx+Math.cos(a)*R;z=cz+Math.sin(a)*R;Hh[k]=landH(x,z);}else Hh[k]=meshH(x,z);VX[k]=x;VZ[k]=z;}
 const pos=[],col=[],c=new THREE.Color(),peakMax=Math.max(...sectors.map(s=>s.peak));
 const SAND=new THREE.Color('#ead7a4'),WET=new THREE.Color('#cdb684'),GRASS=new THREE.Color('#86ad4f'),SUN=new THREE.Color('#c7c45a'),FOREST=new THREE.Color('#5a8a43'),ROCK=new THREE.Color('#8f8070'),SNOW=new THREE.Color('#f0f2ef'),EARTH=new THREE.Color('#7a5638'),EARTH2=new THREE.Color('#5a4030'),MUD=new THREE.Color('#6d7f5a');
 // La arena: del lado de la playa empieza en la orilla de la ciudad; junto a la montaña, lo bajo es pradera.
 const isSand=(x,z)=>mountain(Math.atan2(z-cz,x-cx))<=.25;
 // (2026-10-16, medido sin pantalla —validar-triangulos—: un triángulo del terreno que queda entero debajo de una terraza
 // —su meseta, sin rampa— o de una calle —asfalto y andenes, o el cuadro de un cruce— no se ve nunca: no se dibuja. Ni
 // los que no tienen área. La física del terreno sale de la grilla de alturas, no de estos triángulos)
 const tapado=(x,z)=>{const k=Math.floor(x/6)+','+Math.floor(z/6);if(ter.has(k)&&!rampas.has(k))return true;
  if(roads.length){const rd=roadAt(x,z);if(rd&&rd.d<ROAD_W/2+rd.w-.05)return true;}
  for(const c of nodosCruce)if(Math.max(Math.abs(x-c.x),Math.abs(z-c.z))<c.R-.05)return true;return false;};
 const tri=(a,b,d)=>{
  {const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=d[0]-a[0],vy=d[1]-a[1],vz=d[2]-a[2];if(Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)<2e-6)return;}
  if(tapado(a[0],a[2])&&tapado(b[0],b[2])&&tapado(d[0],d[2])&&tapado((a[0]+b[0]+d[0])/3,(a[2]+b[2]+d[2])/3))return;
  const hy=(a[1]+b[1]+d[1])/3,ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=d[0]-a[0],vy=d[1]-a[1],vz=d[2]-a[2];
  const nn=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx],len=Math.hypot(...nn)||1,slope=1-Math.abs(nn[1]/len),mx=(a[0]+b[0]+d[0])/3,mz=(a[2]+b[2]+d[2])/3;
  if(hy<-4)c.copy(EARTH).lerp(EARTH2,fbm(mx*.05,mz*.05,2));
  // Arena sólo donde la isla da al agua: junto a la montaña, lo bajo es pradera.
  else if(hy<1.6&&isSand(mx,mz))c.copy(hy<WATER?WET:SAND);
  else if(hy>peakMax*.72&&hy>55&&slope<.55)c.copy(SNOW);else if(slope>.62||hy>peakMax*.6)c.copy(ROCK);
  else c.copy(GRASS).lerp(SUN,smooth(.5,.75,fbm(mx*.015+20,mz*.015,2))*.8).lerp(FOREST,smooth(.5,.72,fbm(mx*.02,mz*.02,2))*.7);
  c.multiplyScalar(.93+.14*fbm(mx*.3,mz*.3,1));
  for(const p of [a,b,d]){pos.push(...p);col.push(c.r,c.g,c.b);}
 };
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){
  const X=x0+i*step,Z=z0+j*step;
  if(X>step&&Z>step&&X+step<Wm-step&&Z+step<Hm-step)continue;                              // bajo la ciudad no hace falta
  // bajo un lote (su bloque o su rampa lo tapan entero) tampoco: no queda terreno escondido debajo
  if(ter.size&&[[X,Z],[X+step,Z],[X,Z+step],[X+step,Z+step]].every(([x,z])=>ter.has(Math.floor(x/6)+','+Math.floor(z/6))))continue;
  if([[X,Z],[X+step,Z],[X,Z+step],[X+step,Z+step]].every(([x,z])=>beyond(x,z)>0))continue; // fuera de la isla
  const p=(ii,jj)=>{const k=jj*(n+1)+ii;return [VX[k],Hh[k],VZ[k]];};
  const a=p(i,j),b=p(i+1,j),d=p(i,j+1),e=p(i+1,j+1);
  if((i+j)%2){tri(a,d,b);tri(b,d,e);}else{tri(a,d,e);tri(a,e,b);}
 }

 // ---------- Abajo: la roca que cuelga, en anillos que se angostan hasta una punta, con vetas de tierra ----------
 const N=320,K=7,depth=150+60*r(),rings=[];
 for(let k=0;k<=K;k++){const t=k/K,y=CLIFF+2-depth*Math.pow(t,1.15),shrink=Math.pow(1-t,.85);
  rings.push(Array.from({length:N},(_,i)=>{const a=i/N*Math.PI*2,R=(edgeAlong(a)+rimOf(a))*(k?shrink*(.88+.24*fbm(i*.4+k*7,k*3.1,2)):1.02),off=k?(fbm(i*.2,k,2)-.5)*12:0;
   return [cx+Math.cos(a)*R+off,y+(k?(fbm(i*.7,k*2,2)-.5)*14:0),cz+Math.sin(a)*R+off];}));}
 const tip=[cx+(r()-.5)*30,CLIFF-depth-25,cz+(r()-.5)*30];
 const STRATA=['#8a6242','#7a5438','#6b4a33','#5d4030','#523a2c','#46342a','#3d2f27','#35291f'].map(h=>new THREE.Color(h));
 const triU=(a,b,d,k)=>{c.copy(STRATA[Math.min(STRATA.length-1,k)]).multiplyScalar(.85+.3*fbm(a[0]*.05,a[2]*.05,2));for(const p of [a,b,d]){pos.push(...p);col.push(c.r,c.g,c.b);}};
 for(let k=0;k<K;k++)for(let i=0;i<N;i++){const a=rings[k][i],b=rings[k][(i+1)%N],d=rings[k+1][i],e=rings[k+1][(i+1)%N];triU(a,d,b,k);triU(b,d,e,k);}
 for(let i=0;i<N;i++)triU(rings[K][i],tip,rings[K][(i+1)%N],K);

 // La pared del borde: desde lo alto de la orilla (o el nivel del agua) baja en estratos que se adelantan y se retraen,
 // con alturas irregulares, hasta la roca que cuelga. Así el barranco no es una pared lisa.
 const SK=[0,.1,.26,.44,.62,.8,1],WALLC=['#8a6646','#7a5638','#94704c','#6b4a33','#7f5a3a','#5d4030','#523a2c'].map(h=>new THREE.Color(h));
 const skirt=[];for(let i=0;i<N;i++){const a=i/N*Math.PI*2,R=rimAt(a),x=cx+Math.cos(a)*R,z=cz+Math.sin(a)*R,top=Math.max(landH(x,z),WATER);
  skirt.push(SK.map((t,ri)=>{if(ri===0)return [x,top,z];if(ri===SK.length-1)return rings[0][i];
   const y=top+(CLIFF+2-top)*t+(fbm(i*.35,ri*3.1,2)-.5)*4,jut=(fbm(i*.18+ri*5,ri*1.7,2)-.45)*7+(ri%2?1.6:-.4),rr=R*(1+.02*t)+Math.max(-1,jut);
   return [cx+Math.cos(a)*rr,y,cz+Math.sin(a)*rr];}));}
 for(let i=0;i<N;i++)for(let ri=0;ri<SK.length-1;ri++){const a=skirt[i][ri],b=skirt[(i+1)%N][ri],d=skirt[i][ri+1],e=skirt[(i+1)%N][ri+1];
  c.copy(WALLC[ri]).multiplyScalar(.85+.3*fbm(i*.4,ri*2,2));for(const v of [a,d,b,b,d,e]){pos.push(...v);col.push(c.r,c.g,c.b);}}
 const tg=new THREE.BufferGeometry();tg.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));tg.setAttribute('color',new THREE.Float32BufferAttribute(col,3));tg.computeVertexNormals();
 const terrain=new THREE.Mesh(tg,new THREE.MeshStandardMaterial({vertexColors:true,flatShading:true,roughness:.95,side:THREE.DoubleSide}));terrain.name='suelo:terreno';terrain.receiveShadow=true;terrain.castShadow=true;group.add(terrain);own.push(tg,terrain.material);

 // ---------- Casas: cabañas en la playa y casas campestres en las afueras (con la semilla) ----------
 // Cada una se asienta donde el terreno es casi plano, lejos del borde y de las otras; la de playa mira al agua, la de
 // las afueras a la ciudad. No se atraviesan (walkable) y no les crecen árboles encima.
 // Con el plano: plazas, senderos, salidas, el globo y el parapente quedan libres (ni árboles, ni rocas, ni huertas).
 const ways=new Set();if(plan?.isla){for(const c of plan.isla.cells)if(c.plaza!=null||c.sendero||c.carretera)ways.add(c.x+','+c.y);for(const g of plan.isla.gates)ways.add(g.x+','+g.y);for(const k of ['globo','parapente'])if(plan.isla[k])ways.add(plan.isla[k].cell.join(','));}
 const nearWay=(x,z,m)=>{if(!ways.size)return false;const S6=6,cx=Math.floor(x/S6),cz=Math.floor(z/S6),R=Math.ceil(m/S6);for(let dz=-R;dz<=R;dz++)for(let dx=-R;dx<=R;dx++){if(!ways.has((cx+dx)+','+(cz+dz)))continue;
  const qx=Math.max((cx+dx)*S6,Math.min(x,(cx+dx+1)*S6)),qz=Math.max((cz+dz)*S6,Math.min(z,(cz+dz+1)*S6));if(Math.hypot(qx-x,qz-z)<m)return true;}return false;};
 const FH=2.8,houses=[],modelHouses=[],nearHouse=(x,z,m)=>houses.some(h=>Math.hypot(h.x-x,h.z-z)<m)||modelHouses.some(h=>Math.hypot(h.x-x,h.z-z)<m+Math.max(h.w,h.d)/2)||nearWay(x,z,Math.min(m*.4,2.5))||!offRoad(x,z);
 const unevenness=(x,z,R)=>{const hs=[[R,0],[-R,0],[0,R],[0,-R],[0,0]].map(([a,b])=>height(x+a,z+b));return Math.max(...hs)-Math.min(...hs);};
 const BEACH_WALLS=['#9fd3c7','#f4c7a1','#f6e3a1','#c9b6e4','#a8c8e8','#f2b5b5'],FARM_WALLS=['#f3efe8','#e6d9bb','#cfe0d6','#e9c9a8','#d9c2c9'],FARM_ROOFS=['#b5523e','#8a3b3b','#5e6a72','#a8643f'];
 const place=(kind,max,ok,spacing)=>{for(let k=0;k<9000&&houses.filter(h=>h.kind===kind).length<max;k++){
  const x=x0+r()*reach*2,z=z0+r()*reach*2,h=height(x,z);if(!ok(x,z,h)||nearHouse(x,z,spacing))continue;
  // Pisos: las cabañas, uno; las fincas, uno o dos (con su propio azar, para no mover el resto). Las de dos, más hondas (la escalera).
  const beach=kind==='playa',floors=beach?1:(hash01(x,z+7)<.6?2:1),w=beach?5+r()*2:6.8+r()*2.2,dd=beach?4.5+r()*1.5:floors>1?6.6+r()*1.4:6+r()*2,ry=beach?Math.atan2(x-cx,z-cz):Math.atan2(cx-x,cz-z)+(r()-.5)*.6;
  const corners=[[-w/2,-dd/2],[w/2,-dd/2],[-w/2,dd/2],[w/2,dd/2],[0,dd/2+1.5]].map(([lx,lz])=>height(x+lx*Math.cos(ry)+lz*Math.sin(ry),z-lx*Math.sin(ry)+lz*Math.cos(ry))),lo=Math.min(...corners),base=Math.max(...corners)+.15;
  houses.push({kind,x,z,ry,w,d:dd,lo,base,door:-w*.18,floors,hw:beach?FH:(r(),floors*FH),wall:beach?BEACH_WALLS[Math.floor(r()*BEACH_WALLS.length)]:FARM_WALLS[Math.floor(r()*FARM_WALLS.length)],roof:beach?(r()<.5?'#efe8da':'#d9775f'):FARM_ROOFS[Math.floor(r()*FARM_ROOFS.length)]});}};
 // Más casas cuanto más grande es la isla.
 const scale=Math.max(1,reach/260);
 // Con el plano (etapa 9: blueprint.js), las casas son las de la isla del plano: el mismo lugar, el mismo tamaño y la
 // puerta del mismo lado (la casa mira a +z local: el frente). La de playa y la tienda, como cabaña de playa; las demás,
 // como finca; el puesto de policía en azul y la tienda en naranja. Sin plano, las de siempre (al azar).
 // Con plano, la isla es la del plano aunque no tenga casas (ninguna casa al azar).
 const fromPlan=!!plan?.isla;
 let superficie=null,charcos=null,lotesTri=null;// charcos: la luz de los faroles sobre la calle (de noche)
 let superficie_=null;// el suelo que se ve sobre el terreno (calles, andenes, rampas): ver sueloEn
 if(fromPlan){const KCOL={puesto:['#9fbcdc','#3b4a5a'],tienda:['#f0b98f','#b5523e']};
  for(const L of plan.isla.lots){const q=L.rect,F=L.front,ry=F==='S'?0:F==='N'?Math.PI:F==='E'?Math.PI/2:-Math.PI/2,horiz=F==='N'||F==='S';
   const w=(horiz?q.w:q.h)-.8,dd=(horiz?q.h:q.w)-.8,x=q.x+q.w/2,z=q.y+q.h/2,beachy=L.kind==='playa'||L.kind==='tienda',hs=hash01(x,z);
   const corners=[[-w/2,-dd/2],[w/2,-dd/2],[-w/2,dd/2],[w/2,dd/2],[0,dd/2+1.5]].map(([lx,lz])=>height(x+lx*Math.cos(ry)+lz*Math.sin(ry),z-lx*Math.sin(ry)+lz*Math.cos(ry)));
   const pad=L.nivel!=null?{h:L.nivel}:pads.find(P=>P.id===L.id);
   houses.push({kind:beachy?'playa':'afueras',planKind:L.kind,planName:L.name,x,z,ry,w,d:dd,lo:pad?pad.h:Math.min(...corners),base:pad?pad.h+.15:Math.max(...corners)+.15,door:-w*.18,floors:L.floors,hw:L.floors*FH,
    wall:KCOL[L.kind]?.[0]||(beachy?BEACH_WALLS[Math.floor(hs*BEACH_WALLS.length)]:FARM_WALLS[Math.floor(hs*FARM_WALLS.length)]),
    roof:KCOL[L.kind]?.[1]||(beachy?(hs<.5?'#efe8da':'#d9775f'):FARM_ROOFS[Math.floor(hash01(z,x)*FARM_ROOFS.length)])});}
  // Las casas de las manzanas de la montaña (plan.isla.casas, casas3d.js): afuera se ve el modelo; adentro, esta casa
  // armada (paredes con puertas y ventanas, uno o dos pisos según la casa, escalera y muebles), en el cuerpo de la casa
  // medido en el modelo (c.interior), 0,25 m más adentro por lado, con la puerta donde la del modelo. casaIdx: cuál de plan.isla.casas es (para ocultar su modelo con alguien adentro).
  (plan.isla.casas||[]).forEach((c,i)=>{if(c.spec)return;/* las armadas (vivienda3d.js) se arman solas */const I=c.interior||{dx:0,dz:0,w:c.w,d:c.d,puerta:0},w=I.w-.5,dd=I.d-.5,hs=hash01(c.x,c.z),cs=Math.cos(c.ry),sn=Math.sin(c.ry);
   // El interior va en el cuerpo de la casa (c.interior: medido en el modelo), girado con ella.
   houses.push({kind:'afueras',planKind:'casa',planName:'Casa',x:c.x+I.dx*cs+I.dz*sn,z:c.z-I.dx*sn+I.dz*cs,ry:c.ry,w,d:dd,lo:c.nivel+.05,base:c.nivel+.07,door:I.puerta,floors:c.pisos||1,hw:(c.pisos||1)*FH,
    wall:FARM_WALLS[Math.floor(hs*FARM_WALLS.length)],roof:FARM_ROOFS[Math.floor(hash01(c.z,c.x)*FARM_ROOFS.length)],casaIdx:i});});}
 else place('playa',Math.round(22*scale),(x,z,h)=>beyond(x,z)<-12&&outside(x,z)>10&&h>.18&&h<.72&&unevenness(x,z,4)<1.1,14);
 // Con los modelos cargados, las casas de las afueras son los del paquete (cerradas), y cerca de la ciudad aparecen el
 // hospital, la alcaldía, dos edificios de departamentos y una tienda. Sin modelos, las fincas de siempre.
 // Con plano, nada de edificios sueltos afuera (los hitos): lo que haya afuera lo decide el plano.
 if(buildings&&!fromPlan){
  const dims=n=>{const b=new THREE.Box3().setFromObject(buildings.models[n]),S2=BUILDING_SCALE;return {w:(b.max.x-b.min.x)*S2,d:(b.max.z-b.min.z)*S2,ox:(b.max.x+b.min.x)/2*S2,oz:(b.max.z+b.min.z)/2*S2};};
  const placeModel=(kind,pick,max,ok,spacing,name=null)=>{let placed=0;for(let k=0;k<6000&&placed<max;k++){
   const x=x0+r()*reach*2,z=z0+r()*reach*2,h=height(x,z),[model,tex]=pick(),D=dims(model),R=Math.max(D.w,D.d)/2;
   if(!buildings.models[model]||!buildings.textures[tex]||!ok(x,z,h,R)||nearHouse(x,z,spacing+R))continue;
   const ry=Math.atan2(cx-x,cz-z)+(r()-.5)*.5,cs=[[-1,-1],[1,-1],[-1,1],[1,1],[0,0]].map(([a,b])=>height(x+a*D.w/2*Math.cos(ry)+b*D.d/2*Math.sin(ry),z-a*D.w/2*Math.sin(ry)+b*D.d/2*Math.cos(ry)));
   modelHouses.push({kind,model,tex,x,z,ry,...D,base:Math.max(...cs)+.05,lo:Math.min(...cs),name});placed++;}};
  const flat=(x,z,h,R)=>beyond(x,z)<-R-10&&h>.95&&unevenness(x,z,Math.max(3,R*.7))<2.2;
  for(const [model,tex,name] of [['Hospital','Hotel','Clínica Costa Azul'],['Bank','HouseTexture2','Alcaldía'],['Flat','HouseTexture3','Edificio Mirador del Mar'],['Flat2','HouseTexture1','Edificio Las Brisas'],['Shop','Shop','Tienda La Esquina']])
   placeModel('hito',()=>[model,tex],1,(x,z,h,R)=>flat(x,z,h,R)&&h<10&&outside(x,z)>R+6&&outside(x,z)<R+70,10,name);
 }
 // Las fincas: casas armadas acá (se entra a todas; las de dos pisos tienen escalera).
 if(!fromPlan)place('afueras',Math.round(30*scale),(x,z,h)=>beyond(x,z)<-12&&outside(x,z)>12&&h>.95&&h<32&&unevenness(x,z,5)<2.4,17);
 // ---------- Huertas y frutales de las fincas (con las plantas del paquete de cultivos) ----------
 // Cada finca de las afueras tiene al costado una huerta de un solo cultivo en surcos, y del otro lado unos frutales.
 // Con su propio azar: así el resto de la isla (casas, árboles, nombres) queda igual que sin el paquete.
 const plots=[],crops={},fruit=[],bushes=[],pr=rng(map.seed*613+29);
 // Los lotes de la grilla (terrazas con c.lote) quedan libres para construir: ahí no van árboles, rocas ni arbustos.
 const lotes=new Set(fromPlan?plan.isla.cells.filter(c=>c.lote).map(c=>c.x+','+c.y):[]),enLote=(x,z)=>lotes.has(Math.floor(x/6)+','+Math.floor(z/6));
 const inPlot=(x,z,m=0)=>enLote(x,z)||plots.some(p=>{const [lx,lz]=localOf(p,x,z);return Math.abs(lx)<p.w/2+m&&Math.abs(lz)<p.d/2+m;});
 const localOf=(h,x,z)=>{const dx=x-h.x,dz=z-h.z;return [dx*Math.cos(h.ry)-dz*Math.sin(h.ry),dx*Math.sin(h.ry)+dz*Math.cos(h.ry)];};
 const toWorld=(h,lx,lz)=>[h.x+lx*Math.cos(h.ry)+lz*Math.sin(h.ry),h.z-lx*Math.sin(h.ry)+lz*Math.cos(h.ry)];
 // Cada cultivo: modelo, escala, distancia entre plantas y entre surcos (el trigo es un tallo solo: va tupido).
 const CROPS=[['Corn_4',1.05,1.1,1.5],['Wheat_4',1.3,.28,.5],['Lettuce_4',1.5,.9,1.5],['Carrot_4',1.4,.8,1.5],['Tomato_4',1.3,1,1.5],['Pumpkin_4',1.2,1.3,1.5],['Watermelon_4',1.2,1.2,1.5]];
 if(plants){
  const farms=[...modelHouses.filter(h=>h.kind==='afueras'),...houses.filter(h=>h.kind==='afueras'&&(!h.planKind||h.planKind==='finca'))];
  for(const f of farms){
   // Se prueba a un lado de la casa, al otro y detrás; sirve el primero que quede sobre terreno de pendiente suave.
   const first=pr()<.5?1:-1,w=9+pr()*4,d=6+pr()*3;let plot=null,side=first;
   for(const [sx,sz] of [[first,-1],[-first,-1],[0,-(f.d/2+d/2+2.5)]]){
    const [px,pz]=toWorld(f,sx*(f.w/2+w/2+2.5),sz),p={x:px,z:pz,ry:f.ry,w,d};
    const corners=[[-1,-1],[1,-1],[-1,1],[1,1],[0,0]].map(([a,b])=>toWorld(p,a*w/2,b*d/2)),hs=corners.map(([x,z])=>height(x,z));
    const clash=[...houses,...modelHouses].some(h=>h!==f&&Math.hypot(h.x-px,h.z-pz)<Math.max(w,d)/2+Math.max(h.w,h.d)/2+1);
    if(Math.min(...hs)<.95||Math.max(...hs)-Math.min(...hs)>3.4||corners.some(([x,z])=>beyond(x,z)>-4||outside(x,z)<4)||clash||inPlot(px,pz,Math.max(w,d)/2+1))continue;
    plot=p;side=sx||first;break;}
   if(!plot)continue;
   plots.push(plot);const [name,sc,gap,rowGap]=CROPS[Math.floor(pr()*CROPS.length)];plot.crop=name;
   for(let lz=-d/2+.8;lz<=d/2-.7;lz+=rowGap)for(let lx=-w/2+.7;lx<=w/2-.6;lx+=gap){const [x,z]=toWorld(plot,lx+(pr()-.5)*.15,lz);(crops[name]||(crops[name]=[])).push({x,y:height(x,z)+.05,z,ry:pr()*6.28,s:sc*(.85+pr()*.3)});}
   // Frutales del otro lado de la casa, en fila, y un par de arbustos de moras junto a la puerta.
   const kind=pr()<.5?'Apple_4':'Orange_4';
   for(let i=0;i<2+Math.floor(pr()*3);i++){const [x,z]=toWorld(f,-side*(f.w/2+3+i%2*3.5),-f.d/2+1+Math.floor(i/2)*4),h=height(x,z);if(h<.95||beyond(x,z)>-4||outside(x,z)<4)continue;fruit.push({x,y:h-.05,z,ry:pr()*6.28,s:1.6+pr()*.4,kind});}
   for(const sx of [-1,1]){if(pr()<.4)continue;const [x,z]=toWorld(f,sx*(f.w/2+.9),f.d/2+.9),h=height(x,z);if(h>.6)bushes.push({x,y:h-.05,z,ry:pr()*6.28,s:.9+pr()*.3});}
  }
  // La tierra de cada huerta: una malla que sigue el terreno, con surcos (franjas más oscuras).
  const sp=[],sc=[],soil=new THREE.Color('#7a5536'),furrow=new THREE.Color('#5e3f27');
  for(const p of plots){const nx=12,nz=10;for(let i=0;i<nx;i++)for(let j=0;j<nz;j++){
   const q=[[i,j],[i+1,j],[i+1,j+1],[i,j+1]].map(([a,b])=>{const [x,z]=toWorld(p,-p.w/2+a/nx*p.w,-p.d/2+b/nz*p.d);return [x,height(x,z)+.07,z];});
   const c=(j%2?furrow:soil);for(const v of [q[0],q[2],q[1],q[0],q[3],q[2]]){sp.push(...v);sc.push(c.r,c.g,c.b);}}}
  if(sp.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(sp,3));g.setAttribute('color',new THREE.Float32BufferAttribute(sc,3));g.computeVertexNormals();
   const m=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,flatShading:true,side:THREE.DoubleSide});const mesh=new THREE.Mesh(g,m);mesh.receiveShadow=true;group.add(mesh);own.push(g,m);}
  for(const [name,list] of Object.entries(crops))plantInstances(plants,name,list,group);
  plantInstances(plants,'Apple_4',fruit.filter(t=>t.kind==='Apple_4'),group);plantInstances(plants,'Orange_4',fruit.filter(t=>t.kind==='Orange_4'),group);
  plantInstances(plants,'BushBerries_4',bushes,group);
 }

 // ---------- Pinos, árboles redondos y palmeras ----------
 const pines=[],round=[],palms=[],fronds=[],span=reach*2;
 // Lejos de la carretera y de sus franjas (1,5 m más allá del borde); las franjas quedan libres para las casas.
 const okTree=(x,z,h)=>beyond(x,z)<-6&&outside(x,z)>5&&h>.9&&!nearHouse(x,z,8)&&!inPlot(x,z,3)&&offRoad(x,z);
 // La alameda: por el borde de afuera de cada franja, un árbol cada ~13 m (pinos arriba de 12 m, árboles de copa abajo),
 // alternando los lados; donde un lado no tiene franja, del borde de la carretera.
 const alameda=[];for(const R of roads){let acc=0,next=6;for(let i=1;i<R.P.length;i++){const [ax,az]=R.P[i-1],[bx,bz]=R.P[i],L=Math.hypot(bx-ax,bz-az);acc+=L;if(acc<next)continue;next=acc+11+r()*5;
  const nx=-(bz-az)/(L||1),nz=(bx-ax)/(L||1);for(const sgn of [1,-1]){if(r()<.25)continue;const w=R.IZ?(sgn>0?R.IZ[i]:R.DE[i]):0,o=(R.RW||ROAD_W)/2+(w?w+.8:1.6),x=bx+nx*sgn*o,z=bz+nz*sgn*o,h=height(x,z);
   if(beyond(x,z)>-4||outside(x,z)<3||roads.some(Q=>Q.rot&&Math.hypot(x-Q.rot.x,z-Q.rot.z)<Q.rot.R+4)||roadAt(x,z).d<ROAD_W/2+1||enLote(x,z))continue;/* ni sobre otra calle (en la grilla, la de al lado) */alameda.push({x,y:h,z,alta:R.H[i]>12});}}
  // Un árbol en la isla del medio de la rotonda.
  if(R.rot)alameda.push({x:R.rot.x,y:R.rot.h+.07+CURB_H,z:R.rot.z,alta:false});}
 for(const t of alameda){const s=.75+r()*.35;if(t.alta)pines.push({x:t.x,y:t.y-.2,z:t.z,sx:s,sy:s*(1+r()*.3),sz:s,color:['#3f6b3a','#4a7a42','#365f33'][Math.floor(r()*3)]});else round.push({x:t.x,y:t.y,z:t.z,s,color:['#7fa64a','#6b9a40','#8fb252'][Math.floor(r()*3)]});}
 for(let k=0;k<6000&&pines.length<1200;k++){const x=x0+r()*span,z=z0+r()*span,h=height(x,z);if(!okTree(x,z,h)||h<6||h>peakMax*.62)continue;
  const g=(height(x+2,z)-height(x-2,z))**2+(height(x,z+2)-height(x,z-2))**2;if(g>9||fbm(x*.02,z*.02,2)<.4)continue;
  const s=.8+r()*.9;pines.push({x,y:h-.2,z,sx:s,sy:s*(.9+r()*.5),sz:s,color:['#3f6b3a','#4a7a42','#365f33'][Math.floor(r()*3)]});}
 for(let k=0;k<6000&&round.length<260;k++){const x=x0+r()*span,z=z0+r()*span,h=height(x,z);if(!okTree(x,z,h)||h>6||fbm(x*.03+5,z*.03,2)<.45)continue;
  const s=.8+r()*.7;round.push({x,y:h,z,s,color:['#7fa64a','#6b9a40','#8fb252'][Math.floor(r()*3)]});}
 for(let k=0;k<8000&&palms.length<90;k++){const x=x0+r()*span,z=z0+r()*span,h=height(x,z);if(beyond(x,z)>-6||outside(x,z)<8||h<.15||h>1.6||nearHouse(x,z,6)||I.mountain(Math.atan2(z-cz,x-cx))>.25)continue;
  const s=.85+r()*.4,lean=(r()-.5)*.5,ry=r()*Math.PI*2;palms.push({x,y:h,z,sx:s,sy:s,sz:s,ry,lean});for(let f=0;f<6;f++)fronds.push({x:x+Math.sin(ry)*lean*7*s,y:h+7*s,z:z+Math.cos(ry)*lean*7*s,ry:f*Math.PI/3+ry,s});}
 // Sin árboles por ahora (ISLA3D.arboles), para validar el terreno, las calles y los lotes.
 if(!ISLA3D.arboles){pines.length=0;round.length=0;palms.length=0;fronds.length=0;}
 const inst=(geo,mat,items,build)=>{if(!items.length)return null;const m=new THREE.InstancedMesh(geo,mat,items.length),o=new THREE.Object3D(),cc=new THREE.Color();items.forEach((it,i)=>{o.rotation.set(0,0,0);o.scale.set(1,1,1);build(o,it);o.updateMatrix();m.setMatrixAt(i,o.matrix);if(it.color)m.setColorAt(i,cc.set(it.color));});m.castShadow=true;m.receiveShadow=true;group.add(m);own.push(geo,mat);return m;};
 const cone=new THREE.ConeGeometry(2.2,7,7);cone.translate(0,5.2,0);const trunk=new THREE.CylinderGeometry(.25,.35,2.2,6);trunk.translate(0,1.1,0);
 inst(cone,new THREE.MeshStandardMaterial({roughness:.9,flatShading:true}),pines,(o,p)=>{o.position.set(p.x,p.y,p.z);o.scale.set(p.sx,p.sy,p.sz);});
 // Con el paquete de naturaleza, los árboles de los prados son los suyos (los pinos siguen siendo los de acá).
 const roundHere=nature?[]:round;
 inst(trunk,new THREE.MeshStandardMaterial({color:'#5b4330',roughness:.9}),[...pines,...roundHere.map(t=>({...t,sx:t.s*1.2,sy:t.s*1.4,sz:t.s*1.2}))],(o,p)=>{o.position.set(p.x,p.y,p.z);o.scale.set(p.sx,p.sy,p.sz);});
 inst(new THREE.IcosahedronGeometry(2.4,0),new THREE.MeshStandardMaterial({roughness:.9,flatShading:true}),roundHere.flatMap((t,i)=>[0,1,2].map(k=>({x:t.x+(k-1)*1.3*t.s,y:t.y+(3.6+(k%2)*1.2)*t.s,z:t.z+((k*7+i)%3-1)*1.1*t.s,s:t.s*(1-.15*(k%2)),color:t.color}))),(o,p)=>{o.position.set(p.x,p.y,p.z);o.scale.setScalar(p.s);});
 // ---------- Naturaleza: árboles de los prados, arbustos, pasto y rocas (paquete de naturaleza, con su propio azar) ----------
 const rocks=[];
 if(nature){const nr=rng(map.seed*733+41),TREES=[['Tree1',4.1],['Tree2',4.98],['Tree3',4.08],['Tree4',6.85]],TINT=['#ffffff','#eef6dc','#f6f0cf','#dfeccb','#fff3d8','#e6f0c4'];
  const byModel=(list,names,mk)=>names.forEach((n,i)=>plantInstances(nature,Array.isArray(n)?n[0]:n,list.filter((t,k)=>k%names.length===i).map(t=>mk(t,n)),group));
  byModel(round,TREES,(t,[n,h])=>({x:t.x,y:t.y-.1,z:t.z,ry:hash01(t.x,t.z)*6.28,s:(5.5+2.5*t.s)/h,tint:TINT[Math.floor(hash01(t.z,t.x)*TINT.length)]}));
  // Arbustos y pasto en los prados (no en la playa ni en la montaña alta).
  const bushes=[],tufts=[];for(let k=0;k<12000&&(bushes.length<320||tufts.length<900);k++){const x=x0+nr()*span,z=z0+nr()*span,h=height(x,z);
   if(beyond(x,z)>-5||outside(x,z)<4||h<.9||h>9||nearHouse(x,z,5)||inPlot(x,z,1))continue;const it={x,y:h-.05,z,ry:nr()*6.28};
   if(nr()<.27){if(bushes.length<320)bushes.push({...it,s:1+nr()*.9});}else if(tufts.length<900)tufts.push({...it,s:2.6+nr()*1.6});}
  byModel(bushes,['Bush1','Bush2','Bush3'],t=>t);
  ['Grass1','Grass2','Grass3'].forEach((n,i)=>plantInstances(nature,n,tufts.filter((t,k)=>k%3===i),group,{shadow:false}));
  // Rocas: muchas en las laderas de los cerros (más grandes arriba) y unas pocas en la orilla de la playa. No se atraviesan.
  for(let k=0;k<9000&&rocks.length<260;k++){const x=x0+nr()*span,z=z0+nr()*span,h=height(x,z);if(beyond(x,z)>-3||outside(x,z)<6||nearHouse(x,z,9)||inPlot(x,z,2))continue; // lejos de las casas: ninguna roca frente a una puerta
   const beach=h>.08&&h<.6,slope=h>5;if(!(beach&&nr()<.18||slope&&nr()<.5))continue;const s=beach?.4+nr()*.6:.7+nr()*1.6*Math.min(1,h/30)+nr()*.5;
   rocks.push({x,y:h-.25*s,z,ry:nr()*6.28,s,r:1.05*s});}
  byModel(rocks,['Rock1','Rock2','Rock3'],t=>t);}
 // Con el paquete de cultivos, las palmeras son las suyas (dos tamaños); sin él, las de tronco y hojas.
 if(plants?.PalmTree_4){plantInstances(plants,'PalmTree_4',palms.filter((p,i)=>i%3).map(p=>({x:p.x,y:p.y-.05,z:p.z,ry:p.ry,s:2.3*p.sx})),group);
  plantInstances(plants,'PalmTree_3',palms.filter((p,i)=>!(i%3)).map(p=>({x:p.x,y:p.y-.05,z:p.z,ry:p.ry,s:2.6*p.sx})),group);palms.length=0;fronds.length=0;
  // Pasto alto y flores por los prados (no en la montaña ni en la playa).
  const tufts=[],flowers=[];for(let k=0;k<9000&&(tufts.length<900||flowers.length<380);k++){const x=x0+pr()*span,z=z0+pr()*span,h=height(x,z);
   if(beyond(x,z)>-6||outside(x,z)<5||h<1||h>7||nearHouse(x,z,4)||inPlot(x,z,1))continue;const it={x,y:h-.03,z,ry:pr()*6.28,s:1.3+pr()*.6};
   if(fbm(x*.05+9,z*.05,2)>.55){if(flowers.length<380)flowers.push(it);}else if(tufts.length<900)tufts.push(it);}
  plantInstances(plants,'Grass_3',tufts.filter((t,i)=>i%2),group,{shadow:false});plantInstances(plants,'Grass_2',tufts.filter((t,i)=>!(i%2)),group,{shadow:false});
  plantInstances(plants,'Flower_4',flowers.filter((t,i)=>i%2),group,{shadow:false});plantInstances(plants,'Flower_3',flowers.filter((t,i)=>!(i%2)),group,{shadow:false});}
 const palmTrunk=new THREE.CylinderGeometry(.18,.3,7.2,7);palmTrunk.translate(0,3.6,0);
 inst(palmTrunk,new THREE.MeshStandardMaterial({color:'#8a6c4c',roughness:.9,flatShading:true}),palms,(o,p)=>{o.position.set(p.x,p.y,p.z);o.rotation.set(Math.cos(p.ry)*p.lean,0,-Math.sin(p.ry)*p.lean);o.scale.set(p.sx,p.sy,p.sz);});
 const frond=new THREE.BoxGeometry(.7,.06,3.4);frond.translate(0,0,1.6);
 inst(frond,new THREE.MeshStandardMaterial({color:'#5f9a46',roughness:.8,flatShading:true}),fronds,(o,f)=>{o.position.set(f.x,f.y,f.z);o.rotation.set(.35,f.ry,0,'YXZ');o.scale.setScalar(f.s);});

 // Rocas salientes en la pared del borde.
 const crags=[];for(let k=0;k<90;k++){const i=Math.floor(r()*N),ri=1+Math.floor(r()*(SK.length-2)),[x,y,z]=skirt[i][ri],a=i/N*Math.PI*2;crags.push({x:x+Math.cos(a)*1.5,y,z:z+Math.sin(a)*1.5,s:2+r()*4,ry:r()*6,color:['#7a5638','#6b4a33','#8a6646'][Math.floor(r()*3)]});}
 inst(new THREE.DodecahedronGeometry(1,0),new THREE.MeshStandardMaterial({roughness:.95,flatShading:true}),crags,(o,c2)=>{o.position.set(c2.x,c2.y,c2.z);o.rotation.set(c2.ry,c2.ry*1.7,0);o.scale.set(c2.s*1.3,c2.s*.7,c2.s);});
 // Los modelos de las casas: paredes (con cimiento hacia abajo, para no flotar en una ladera), techo a dos aguas, puerta,
 // ventanas que se encienden de noche, terraza en las de playa y chimenea en las de afuera.
 const prism=new THREE.BufferGeometry();
 {const v=[[-.5,0,-.5],[.5,0,-.5],[0,1,-.5],[-.5,0,.5],[.5,0,.5],[0,1,.5]],f=[[0,2,1],[3,4,5],[0,3,5],[0,5,2],[1,2,5],[1,5,4]],p=[];for(const t of f)for(const i of t)p.push(...v[i]);
  prism.setAttribute('position',new THREE.Float32BufferAttribute(p,3));prism.computeVertexNormals();}
 const at=(h,lx,ly,lz)=>({x:h.x+lx*Math.cos(h.ry)+lz*Math.sin(h.ry),y:h.base+ly,z:h.z-lx*Math.sin(h.ry)+lz*Math.cos(h.ry),ry:h.ry});
 const box=new THREE.BoxGeometry(1,1,1),windowMat=new THREE.MeshStandardMaterial({color:'#3d5266',roughness:.2,emissive:'#ffd28a',emissiveIntensity:0});
 const lampMat=new THREE.MeshStandardMaterial({color:'#fff4dc',emissive:'#ffd9a0',emissiveIntensity:.3});
 const put=(o,p)=>{o.position.set(p.x,p.y,p.z);o.rotation.set(0,p.ry,0);o.scale.set(p.sx,p.sy,p.sz);};
 const piece=(h,lx,ly,lz,sx,sy,sz,color)=>({...at(h,lx,ly,lz),sx,sy,sz,color});
 // Paredes huecas (20 cm) con el vano de la puerta: atrás, costados, y adelante a los dos lados de la puerta y encima.
 // Las de dos pisos: losa intermedia con el hueco de la escalera (recta, contra la pared izquierda, sube hacia el frente).
 const seats=[],sleeps=[],screens=[],T=.2,DW=1.0,DH=2.2,FK=.52,walls=[],stone=[],wood=[],beds=[],pillows=[],steps=[],rails=[],ceilings=[],furn={},doorsH=[];
 // Medidas reales (2026-10-15): 1,2 m de ancho, 16 peldaños de 17,5 × 28 cm para los 2,8 m del piso (antes 0,95 m y 9
 // peldaños de 31 cm). El hueco de la losa empieza donde quedan 2,1 m libres sobre el peldaño (hz).
 // (en una casa corta el tramo se acorta lo justo para dejar 1 m libre arriba: la huella baja de 28 cm)
 const STAIR_W=1.2,STEPS=16,stairOf=h=>{const x0s=-h.w/2+T,z0=-h.d/2+T+.25,run=Math.max(STEPS*.22,Math.min(STEPS*.28,h.d-2*T-.25-1));return {x0:x0s,x1:x0s+STAIR_W,z0,z1:z0+run,run,hz:z0+run*Math.max(0,(FH-.16-2.1)/FH)};};
 const ROT={front:0,back:Math.PI,left:-Math.PI/2,right:Math.PI/2};
 // Un mueble del paquete: lo pone (instancias) y, si estorba, guarda su rectángulo para los choques (coordenadas de la casa).
 // center: (lx,lz) es el centro de su caja y no su origen. Cada silla queda como asiento para la gente que entra.
 const fur=(h,name,lx,ly,lz,rot,block=true,center=false)=>{const m=furniture?.[name];if(!m)return;const sc=m.scale||FK,b=m.box,c=Math.cos(rot),s2=Math.sin(rot),
   ox=center?(b.max.x+b.min.x)/2*sc:0,oz=center?(b.max.z+b.min.z)/2*sc:0,p=at(h,lx-(ox*c+oz*s2),ly,lz-(-ox*s2+oz*c));(furn[name]||(furn[name]=[])).push({x:p.x,y:p.y,z:p.z,ry:h.ry+rot,s:sc});
  if(/Chair/.test(name)){const q=at(h,lx,ly,lz);seats.push({x:q.x,y:q.y,z:q.z,yaw:h.ry+rot,lift:liftFor((b.max.y-b.min.y)*sc),ap:-.55,by:null,house:h});}
  if(!block)return;const bw=(b.max.x-b.min.x)*sc,bd=(b.max.z-b.min.z)*sc,turned=Math.abs(Math.sin(rot))>.5,hw2=(turned?bd:bw)/2,hd2=(turned?bw:bd)/2;
  h.obst.push({x0:lx-hw2,x1:lx+hw2,z0:lz-hd2,z1:lz+hd2,y0:ly,y1:ly+(b.max.y-b.min.y)*sc});};
 // Escritorio con computador contra la pared de adelante, a la derecha de la puerta (por la trama, en toda casa):
 // monitor mirando a la silla de oficina. Si no cabe, va el estante de siempre.
 const deskAt=(h,dx,xi1,zi1)=>{const m=furniture?.Desk;if(!m)return false;const sc=m.scale||FK,b=m.box,dw=(b.max.x-b.min.x)*sc,dd=(b.max.z-b.min.z)*sc,x=dx+DW/2+.3+dw/2,z=zi1-dd/2-.02;
  if(x+dw/2>xi1-.55)return false;fur(h,'Desk',x,.06,z,ROT.back,true,true);fur(h,'OfficeChair',x,.06,z-.85,0,false,true);
  const top=.06+b.max.y*sc,mz=z+.12;screens.push(piece(h,x,top+.01,mz,.24,.02,.16,'#2a2d30'),piece(h,x,top+.08,mz+.02,.05,.14,.04,'#2a2d30'),piece(h,x,top+.32,mz,.58,.36,.04,'#1c1f22'),piece(h,x,top+.32,mz-.022,.53,.31,.005,'#3d78a8'));return true;};
 // Cada cama de planta baja queda para dormir (citizens3d.js): pies hacia +z de la casa, costados libres a ±1,12 m.
 const bed=(h,lx,ly,lz,color)=>{if(ly===0){const q=at(h,lx,0,lz);sleeps.push({x:q.x,z:q.z,top:h.base+.45,yaw:h.ry,by:null,house:h,sides:[at(h,lx+1.12,0,lz),at(h,lx-1.12,0,lz)]});}beds.push(piece(h,lx,ly+.25,lz,1.5,.4,2.1,color));pillows.push(piece(h,lx,ly+.5,lz-.78,1.3,.14,.38,'#f3efe8'));wood.push(piece(h,lx,ly+.55,lz-1.06,1.6,1.1,.08,'#7a5a3a'));h.obst.push({x0:lx-.8,x1:lx+.8,z0:lz-1.1,z1:lz+1.05,y0:ly,y1:ly+1});};
 for(const h of houses){const W=h.w,D=h.d,H=h.hw,dx=h.door,c0=h.wall,two=h.floors>1,xi0=-W/2+T,xi1=W/2-T,zi0=-D/2+T,zi1=D/2-T;h.obst=[];
  walls.push(piece(h,0,H/2,-D/2+T/2,W,H,T,c0),piece(h,-W/2+T/2,H/2,0,T,H,D,c0),piece(h,W/2-T/2,H/2,0,T,H,D,c0));
  const l1=(dx-DW/2)+W/2,l2=W/2-(dx+DW/2);walls.push(piece(h,-W/2+l1/2,H/2,D/2-T/2,l1,H,T,c0),piece(h,W/2-l2/2,H/2,D/2-T/2,l2,H,T,c0),piece(h,dx,(DH+H)/2,D/2-T/2,DW,H-DH,T,c0));
  // Cimiento hasta el punto más bajo del terreno, y un escalón (o la terraza) frente a la puerta.
  // (Una casa dentro de un modelo, casaIdx: sólo el interior; el cimiento, el escalón, el techo y los adornos de afuera
  // son del modelo.)
  const drop=h.base-(h.lo-1.6);if(h.casaIdx==null)stone.push(piece(h,0,-drop/2,0,W,drop,D,'#8f8070'));
  const fd=h.base-(h.lo-.4);if(h.casaIdx!=null){}else if(h.kind==='playa')stone.push(piece(h,0,-.1-(fd-.2)/2,D/2+1.1,W,fd-.2,2.2,'#a08560'));else stone.push(piece(h,dx,-fd/2,D/2+.6,DW+.8,fd,1.2,'#8f8070'));
  wood.push(piece(h,0,.03,0,W-2*T,.06,D-2*T,'#b08a5e'));
  // Cielo raso del último piso (tapa el interior del techo) en revoque claro.
  ceilings.push(piece(h,0,H-.02,0,W-2*T,.04,D-2*T,'#efe8dc'));
  if(two){const st=stairOf(h),hz=st.hz;
   // Losa del primer piso alrededor del hueco (encima del tramo alto de la escalera).
   for(const [cx2,cz2,sx2,sz2] of [[(st.x1+xi1)/2,0,xi1-st.x1,D-2*T],[(st.x0+st.x1)/2,(zi0+hz)/2,STAIR_W,hz-zi0],[(st.x0+st.x1)/2,(st.z1+zi1)/2,STAIR_W,zi1-st.z1]]){
    wood.push(piece(h,cx2,FH-.08,cz2,sx2,.16,sz2,'#b08a5e'));ceilings.push(piece(h,cx2,FH-.17,cz2,sx2,.02,sz2,'#efe8dc'));}
   // Escalones (9, macizos), pasamanos del lado de adentro y baranda alrededor del hueco arriba.
   for(let k=0;k<STEPS;k++){const top=(k+1)*FH/STEPS;steps.push(piece(h,(st.x0+st.x1)/2,top/2,st.z0+(k+.5)*st.run/STEPS,STAIR_W,top,st.run/STEPS+.01));}
   for(let k=1;k<=4;k++){const zz=st.z0+k*st.run/4.2;rails.push(piece(h,st.x1-.05,(zz-st.z0)/st.run*FH+.45,zz,.05,.9,.05,'#3a3f43'));}
   rails.push({...piece(h,st.x1-.05,FH/2+.9,(st.z0+st.z1)/2,.06,.06,Math.hypot(st.run,FH),'#3a3f43'),tilt:Math.atan2(FH,st.run)});
   rails.push(piece(h,st.x1+.03,FH+.5,(hz+st.z1-.9)/2,.06,1,st.z1-.9-hz,'#3a3f43'),piece(h,(st.x0+st.x1)/2,FH+.5,hz-.03,STAIR_W,1,.06,'#3a3f43'));
   h.obst.push({x0:st.x1-.06,x1:st.x1+.06,z0:hz-.1,z1:st.z1,y0:-1,y1:1},{x0:st.x1-.04,x1:st.x1+.1,z0:hz,z1:st.z1-.9,y0:FH-.1,y1:FH+3},{x0:st.x0,x1:st.x1,z0:hz-.08,z1:hz+.04,y0:FH-.1,y1:FH+3});}
  // Muebles. Planta baja: cocina contra la pared de atrás (desde la esquina derecha), mesa con dos sillas sobre una
  // alfombra, sofá contra la pared derecha, estante, planta y lámpara de techo. Arriba (o, en las de un piso, al fondo
  // a la izquierda): la cama con mesas de noche, cómoda, alfombra, lámpara de pie y otra planta.
  const ceil0=two?FH-.16:H,kitchen=h.kind==='playa'?['Kitchen_Fridge','Kitchen_Sink','Kitchen_2Drawers']:['Kitchen_Fridge','Kitchen_Sink','Kitchen_Oven','Kitchen_2Drawers'];
  let kx=xi1-.05;for(const n of kitchen){const m=furniture?.[n];if(!m)continue;const kw=(m.box.max.x-m.box.min.x)*FK,kd=(m.box.max.z-m.box.min.z)*FK;fur(h,n,kx-kw/2,0,zi0+kd/2+.02,ROT.front);kx-=kw;}
  const tx=two?(xi0+STAIR_W+xi1)/2+.2:W*.12,tz=D*.1;fur(h,'Carpet_Round',tx,.07,tz,0,false);fur(h,'Table_RoundSmall',tx,.06,tz,0);fur(h,'Chair_1',tx-.85,.06,tz,ROT.right,false);fur(h,'Chair_2',tx+.85,.06,tz,ROT.left,false);
  if(W>6.2)fur(h,'Couch_Small2',xi1-.55,.06,Math.min(zi1-1.5,tz+1.6),ROT.left);
  if(!deskAt(h,dx,xi1,zi1))fur(h,'Shelf_1',Math.min(xi1-.4,dx+DW/2+.7),.06,zi1-.25,ROT.back);fur(h,'Houseplant_8',xi1-.3,.06,zi1-.3,0,false);fur(h,'Light_Ceiling3',tx,ceil0,tz,0,false);
  const bc=['#c2412d','#3d6f8f','#7b4e7e','#4f7d5a','#d9a23a'][Math.floor(hash01(h.x,h.z)*5)];
  if(two){const y=FH;bed(h,xi1-.85,y,zi0+1.15,bc);fur(h,'NightStand_1',xi1-1.9,y,zi0+.35,0);fur(h,'Drawer_1',xi1-.95,y,zi1-.33,ROT.back);fur(h,'Carpet_1',(xi0+STAIR_W+xi1)/2+.3,y+.02,0,ROT.left,false);
   fur(h,'Light_Floor1',xi0+STAIR_W+.35,y,zi1-.35,0,false);fur(h,'Houseplant_3',xi0+STAIR_W+.35,y,zi0+.35,0,false);fur(h,'Light_Ceiling1',(xi0+STAIR_W+xi1)/2,H,0,0,false);}
  else{bed(h,xi0+.85,0,zi0+1.15,bc);fur(h,'NightStand_2',xi0+1.9,.06,zi0+.35,0);fur(h,'Houseplant_6',xi0+.45,.06,zi1-.5,0,false);}
  doorsH.push(h);
 }
 // Paredes, cimientos y cielos rasos llevan el contorno gris (edges3d.js) sólo mientras la cámara está dentro de una
 // casa: la misma caja es la cara de afuera y la de adentro, y afuera no va línea. Los muebles nunca.
 const edgeMeshes=[],edge=m=>{if(m)edgeMeshes.push(m);return m;};
 // Las paredes con tablas horizontales (una textura de líneas en gris que se tiñe con el color de cada casa).
 const siding=(()=>{const c=document.createElement('canvas');c.width=64;c.height=256;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,64,256);
  for(let y=0;y<256;y+=21){g.fillStyle='rgba(0,0,0,.16)';g.fillRect(0,y,64,2);g.fillStyle='rgba(255,255,255,.5)';g.fillRect(0,y+2,64,1);}
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;})();own.push(siding);
 edge(inst(box,new THREE.MeshStandardMaterial({roughness:.85,flatShading:true,map:LOWPOLY.on?null:siding}),walls,put));
 edge(inst(box,new THREE.MeshStandardMaterial({roughness:.9}),stone,put));
 inst(box,new THREE.MeshStandardMaterial({roughness:.8}),wood,put);
 inst(box,new THREE.MeshStandardMaterial({roughness:.9}),beds,put);
 inst(box,new THREE.MeshStandardMaterial({roughness:.9}),pillows,put);
 inst(box,new THREE.MeshStandardMaterial({roughness:.6}),screens,put);
 inst(box,new THREE.MeshStandardMaterial({color:'#c39a6b',roughness:.8}),steps,put);
 edge(inst(box,new THREE.MeshStandardMaterial({roughness:.9,emissive:'#57524a'}),ceilings,put));
 inst(box,new THREE.MeshStandardMaterial({color:'#3a3f43',roughness:.5}),rails,(o,p)=>{o.position.set(p.x,p.y,p.z);o.rotation.set(p.tilt||0,p.ry,0,'YXZ');o.scale.set(p.sx,p.sy,p.sz);});
 for(const [name,list] of Object.entries(furn))plantInstances(furniture,name,list,group);
 // La puerta de cada casa (del paquete de muebles): gira hacia adentro cuando alguien se acerca. Sin el paquete, una tabla.
 const doorLeaves=[];
 for(const h of doorsH){const pivot=new THREE.Group(),hinge=at(h,h.door-DW/2,0,h.d/2-T/2);pivot.position.set(hinge.x,hinge.y,hinge.z);pivot.rotation.y=h.ry;group.add(pivot);
  const names=['Door_1','Door_2','Door_4','Door_6'],m=furniture?.[names[Math.floor(hash01(h.z,h.x+1)*names.length)]];
  if(m){const b=m.box,sx=DW*.98/(b.max.x-b.min.x),sy=DH/(b.max.y-b.min.y);for(const part of m.parts){const mesh=new THREE.Mesh(part.geometry,part.materials);mesh.scale.set(sx,sy,.45);mesh.position.set(-b.min.x*sx,0,-(b.min.z+b.max.z)/2*.45);mesh.castShadow=true;pivot.add(mesh);}}
  else{const g=new THREE.Mesh(box,new THREE.MeshStandardMaterial({color:'#5b4330'}));g.scale.set(DW-.04,DH-.04,.06);g.position.set(DW/2,DH/2,0);pivot.add(g);own.push(g.material);}
  const c=at(h,h.door,0,h.d/2);doorLeaves.push({h,pivot,cx:c.x,cz:c.z,a:0});}
 inst(prism,new THREE.MeshStandardMaterial({roughness:.8,flatShading:true,side:THREE.DoubleSide}),houses.filter(h=>h.casaIdx==null).map(h=>({...at(h,0,h.hw,0),sx:h.w+.7,sy:h.kind==='playa'?1.4:1.9,sz:h.d+.7,color:h.roof})),(o,p)=>{o.position.set(p.x,p.y,p.z);o.rotation.set(0,p.ry+Math.PI/2,0);o.scale.set(p.sz,p.sy,p.sx);});
 // Ventanas que atraviesan la pared: se ven de afuera y de adentro (y de noche se encienden).
 // Por piso: una al frente y una en cada costado (arriba, también sobre la puerta).
 const winsOf=h=>{const out=[];for(let f=0;f<h.floors;f++){const y=f*FH+1.45;out.push({p:at(h,h.w*.24,y,h.d/2-T/2),side:false});if(f)out.push({p:at(h,h.door,y,h.d/2-T/2),side:false});
  out.push({p:at(h,h.w/2-T/2,y,0),side:true},{p:at(h,-h.w/2+T/2,y,h.d*.2),side:true});}if(h.floors===1&&h.w>6)out.push({p:at(h,h.door,h.hw-.75,h.d/2-T/2),side:false});return out;};
 inst(box,windowMat,houses.flatMap(h=>winsOf(h).map(({p,side})=>({...p,sx:side?T+.06:.95,sy:.85,sz:side?.95:T+.06}))),put);
 inst(box,new THREE.MeshStandardMaterial({color:'#8f8070',roughness:.9}),houses.filter(h=>h.kind==='afueras'&&h.casaIdx==null).map(h=>({...at(h,h.w*.28,h.hw+1.4,-h.d*.15),sx:.6,sy:1.8,sz:.6})),put);
 // ---------- Detalles de las casas (todo con cajas, para que siga siendo low poly) ----------
 // Zócalo, esquineros y franja bajo el techo; marcos, alféizares y postigos en las ventanas; marco de la puerta, farol
 // al lado (de noche se enciende) y macetas; cumbrera oscura en el techo. Las de playa, además, un porche sobre la terraza.
 const trims=[],woodBits=[],lanterns=[],pots=[],leaves_=[],TRIM='#f4efe6',SHUT=['#2f6f73','#3f5f8f','#a8473a','#6b8f4e','#7a5a8a','#c08a3a'];
 const frontWin=(h,wx,wy,sh)=>{const z=h.d/2;trims.push(piece(h,wx,wy+.47,z+.04,1.1,.08,.06,TRIM),piece(h,wx,wy-.47,z+.07,1.22,.08,.16,TRIM),piece(h,wx-.51,wy,z+.04,.08,.94,.06,TRIM),piece(h,wx+.51,wy,z+.04,.08,.94,.06,TRIM));
  if(sh)trims.push(piece(h,wx-.8,wy,z+.05,.44,.98,.05,sh),piece(h,wx+.8,wy,z+.05,.44,.98,.05,sh));};
 const sideWin=(h,side,wz,wy,sh)=>{const x=side*h.w/2,o=side*.04;trims.push(piece(h,x+o,wy+.47,wz,.06,.08,1.1,TRIM),piece(h,x+side*.07,wy-.47,wz,.16,.08,1.22,TRIM),piece(h,x+o,wy,wz-.51,.06,.94,.08,TRIM),piece(h,x+o,wy,wz+.51,.06,.94,.08,TRIM));
  if(sh)trims.push(piece(h,x+side*.05,wy,wz-.8,.05,.98,.44,sh),piece(h,x+side*.05,wy,wz+.8,.05,.98,.44,sh));};
 for(const h of houses){if(h.casaIdx!=null)continue;const W=h.w,D=h.d,H=h.hw,dx=h.door,beach=h.kind==='playa',sh=SHUT[Math.floor(hash01(h.x+3,h.z)*SHUT.length)],plinth='#7d6a58';
  trims.push(piece(h,0,.18,D/2+.02,W+.04,.36,.05,plinth),piece(h,0,.18,-D/2-.02,W+.04,.36,.05,plinth),piece(h,W/2+.02,.18,0,.05,.36,D+.04,plinth),piece(h,-W/2-.02,.18,0,.05,.36,D+.04,plinth));
  for(const a of [-1,1])for(const b of [-1,1])trims.push(piece(h,a*W/2,H/2,b*D/2,.2,H,.2,TRIM));
  trims.push(piece(h,0,H-.09,D/2+.04,W+.12,.18,.08,TRIM),piece(h,0,H-.09,-D/2-.04,W+.12,.18,.08,TRIM));
  trims.push(piece(h,dx-DW/2-.06,1.1,D/2+.04,.12,2.2,.08,TRIM),piece(h,dx+DW/2+.06,1.1,D/2+.04,.12,2.2,.08,TRIM),piece(h,dx,2.28,D/2+.05,DW+.32,.16,.1,TRIM));
  for(let f=0;f<h.floors;f++){const y=f*FH+1.45;frontWin(h,W*.24,y,sh);if(f)frontWin(h,dx,y,sh);sideWin(h,1,0,y,sh);sideWin(h,-1,D*.2,y,sh);}if(h.floors===1&&W>6)frontWin(h,dx,H-.75,null);
  if(h.floors>1)trims.push(piece(h,0,FH,D/2+.04,W+.08,.14,.08,TRIM),piece(h,0,FH,-D/2-.04,W+.08,.14,.08,TRIM));
  trims.push(piece(h,0,H+(beach?1.4:1.9)+.03,0,W+.8,.14,.24,'#5e4a3a'));
  lanterns.push(piece(h,dx+DW/2+.4,2.05,D/2+.14,.16,.26,.16));
  for(const s2 of [-1,1]){const px=dx+s2*(DW/2+.6),pz=D/2+(beach?.45:.4);pots.push(piece(h,px,beach?-.1+.18:.18,pz,.34,.36,.34,'#b5643c'));leaves_.push({...at(h,px,(beach?-.1:0)+.55,pz),s:.28});}
  if(beach){const top=-.1,fz=D/2+2.15,wood='#c9a477',rail='#efe6d6';
   for(const a of [-1,1]){woodBits.push(piece(h,a*(W/2-.12),top+1.25,fz-.05,.16,2.5,.16,wood));woodBits.push(piece(h,a*(W/2-.08),top+.9,D/2+1.1,.08,.08,2.2,rail));
    for(let z=D/2+.4;z<fz;z+=.55)woodBits.push(piece(h,a*(W/2-.08),top+.45,z,.06,.9,.06,rail));}
   // Baranda del frente, con el hueco del escalón frente a la puerta.
   const gap=[dx-.8,dx+.8];for(const [x0,x1] of [[-W/2+.1,gap[0]],[gap[1],W/2-.1]]){if(x1-x0<.3)continue;woodBits.push(piece(h,(x0+x1)/2,top+.9,fz,x1-x0,.08,.08,rail));for(let x=x0+.25;x<x1;x+=.55)woodBits.push(piece(h,x,top+.45,fz,.06,.9,.06,rail));}
   // Techito del porche.
   trims.push(piece(h,0,top+2.55,D/2+1.15,W+.4,.1,2.5,h.roof));}
 }
 // Las fincas del paquete: camino de piedras hasta la puerta, farol, macetas y buzón.
 const stones=[];
 for(const h of houses.filter(k=>k.kind==='afueras'&&k.casaIdx==null)){const z0=h.d/2+1.3,sh=SHUT[Math.floor(hash01(h.x,h.z+5)*SHUT.length)];
  for(let i=0;i<6;i++){const p=at(h,h.door+(hash01(h.x+i,h.z)-.5)*.5,0,z0+i*1.1);stones.push({...p,y:height(p.x,p.z)+.03,sx:.75,sy:.08,sz:.6,ry:p.ry+i*.7});}
  const m=at(h,2.4,0,z0+6.2),mh=height(m.x,m.z);woodBits.push({...m,y:mh+.55,sx:.1,sy:1.1,sz:.1,color:'#6b4e36'},{...m,y:mh+1.15,sx:.3,sy:.25,sz:.45,color:sh});}
 inst(box,new THREE.MeshStandardMaterial({roughness:.75,flatShading:true}),[...trims,...pots],put);
 inst(box,new THREE.MeshStandardMaterial({roughness:.85}),woodBits.map(b=>({...b,color:b.color||'#c9a477'})),put);
 inst(box,lampMat,lanterns,put);
 inst(new THREE.DodecahedronGeometry(1,0),new THREE.MeshStandardMaterial({color:'#5f8f45',roughness:.9,flatShading:true}),leaves_,(o,p)=>{o.position.set(p.x,p.y,p.z);o.scale.setScalar(p.s);});
 inst(new THREE.CylinderGeometry(.5,.55,1,7),new THREE.MeshStandardMaterial({color:'#9c9488',roughness:.95,flatShading:true}),stones,put);
 own.push(prism,box,windowMat,lampMat);
 // Los edificios del paquete: cada uno con su paleta, apoyado en el punto más alto de su base y con un cimiento de
 // piedra hasta el más bajo (para no flotar en una ladera).
 if(buildings){const mats=new Map(),found=new THREE.MeshStandardMaterial({color:'#8f8070',roughness:.9}),
  // El de columnas (la alcaldía) viene sin coordenadas de textura: va en piedra clara, de un solo color.
  plain=new THREE.MeshStandardMaterial({color:'#e9dfcb',roughness:.8,flatShading:true});own.push(found,plain);
  for(const h of modelHouses){if(!mats.has(h.tex)){const m=new THREE.MeshStandardMaterial({map:buildings.textures[h.tex],roughness:.85});mats.set(h.tex,m);own.push(m);}
   const obj=buildings.models[h.model].clone(true);
obj.traverse(o=>{if(o.isMesh){o.material=o.geometry.attributes.uv?mats.get(h.tex):plain;o.castShadow=true;o.receiveShadow=true;}});
   obj.scale.setScalar(BUILDING_SCALE);obj.position.set(-h.ox,0,-h.oz);const g=new THREE.Group();g.add(obj);g.position.set(h.x,h.base,h.z);g.rotation.y=h.ry;group.add(g);
   const drop=h.base-(h.lo-1),f=new THREE.Mesh(box,found);f.scale.set(h.w*.97,drop,h.d*.97);f.position.set(h.x,h.base-drop/2,h.z);f.rotation.y=h.ry;f.receiveShadow=true;group.add(f);}}
 // Choques de las casas: las paredes bloquean (con un margen para el cuerpo), por la puerta se pasa, y adentro se camina.
 const local=(h,x,z)=>{const dx=x-h.x,dz=z-h.z;return [dx*Math.cos(h.ry)-dz*Math.sin(h.ry),dx*Math.sin(h.ry)+dz*Math.cos(h.ry)];};
 const inModel=(x,z)=>modelHouses.some(h=>{const [lx,lz]=local(h,x,z);return Math.abs(lx)<h.w/2+.35&&Math.abs(lz)<h.d/2+.35;});
 // feet: la altura de los pies (la del jugador). Sin ella (la gente de la isla) se camina sólo por la planta baja y sin
 // mirar muebles ni barandas.
 const inHouse=(x,z,feet)=>inModel(x,z)||houses.some(h=>{const [lx,lz]=local(h,x,z),R=.35,W=h.w/2,D=h.d/2,rel=feet===undefined?0:feet-h.base;
  if(!(Math.abs(lx)<W+R&&Math.abs(lz)<D+R))return false;              // afuera
  if(Math.abs(lx)<W-T-R&&Math.abs(lz)<D-T-R){                          // adentro: muebles, escalera y barandas
   if(feet===undefined)return false;return h.obst.some(o=>lx>o.x0-R&&lx<o.x1+R&&lz>o.z0-R&&lz<o.z1+R&&rel<o.y1-.3&&rel+1>o.y0);}
  if(lz>D-T-R-.05&&Math.abs(lx-h.door)<DW/2-R*.45&&rel<1.6)return false; // por la puerta (sólo en planta baja)
  return true;});
 // El piso dentro de una casa: planta baja, el primer piso (menos el hueco) o la escalera; el más alto a menos de 45 cm de los pies.
 const insideFloor=(h,lx,lz,feet)=>{const lim=(feet===undefined?h.base:feet)+.45;let best=h.base;if(h.floors<2)return best;const st=stairOf(h);
  const inStrip=lx>=st.x0-.02&&lx<=st.x1+.02,hole=inStrip&&lz>st.hz&&lz<st.z1;if(!hole&&h.base+FH<=lim)best=h.base+FH;
  if(inStrip&&lz>=st.z0&&lz<=st.z1+.05){const s2=h.base+Math.min(1,Math.max(0,(lz-st.z0)/st.run))*FH;if(s2<=lim&&s2>best)best=s2;}return best;};
 // El piso: adentro de una casa (o en su terraza o escalón), el de la casa.
 const houseFloor=(x,z)=>{for(const h of houses){const [lx,lz]=local(h,x,z);if(Math.abs(lx)<h.w/2&&Math.abs(lz)<h.d/2)return {h,inside:true};
  if(h.kind==='playa'?(Math.abs(lx)<h.w/2&&lz>=h.d/2&&lz<h.d/2+2.2):(Math.abs(lx-h.door)<(DW+.4)/2&&lz>=h.d/2&&lz<h.d/2+1.2))return {h,inside:false};}return null;};

 // ---------- Agua: la superficie hasta el borde, y el agua que cae por la orilla (low-poly, quieta) ----------
 // El mar: triángulos con caras planas en tonos turquesa, quietos (como en la referencia low-poly). El color de cada
 // cara lo pone la profundidad: más claro donde el agua es baja.
 const seaMat=new THREE.MeshStandardMaterial({vertexColors:true,flatShading:true,roughness:.25,metalness:.05,transparent:true,opacity:.86});
 // La cascada es geometría con caras planas (sin textura ni animación): blanca arriba, celeste abajo.
 const fallMat=new THREE.MeshStandardMaterial({vertexColors:true,flatShading:true,roughness:.35,metalness:.05,side:THREE.DoubleSide});
 own.push(seaMat,fallMat);
 const RN=160,rim=Array.from({length:RN},(_,i)=>{const a=i/RN*Math.PI*2,R=edgeAlong(a)+rimOf(a);return {a,R,x:cx+Math.cos(a)*R,z:cz+Math.sin(a)*R};});
 // El mar sigue el contorno de la isla: columnas por ángulo (las mismas que usan las cascadas) y anillos desde el borde
 // hacia la playa. El anillo de afuera queda justo en el borde y a nivel: ahí arrancan las cascadas, sin costura.
 const COLS=RN*2,rimR=a=>edgeAlong(a)+rimOf(a),RING=5;
 {const SH=new THREE.Color('#8fe3d2'),MD=new THREE.Color('#45bcc4'),DP=new THREE.Color('#2a8fb0'),cc=new THREE.Color(),p=[],col=[];
  const vert=(c,k)=>{const a=c/COLS*Math.PI*2,R=rimR(a)-k*RING,x=cx+Math.cos(a)*R,z=cz+Math.sin(a)*R;return [x,k?WATER+(fbm(x*.3+11,z*.3+5,1)-.5)*.12:WATER,z];};
  const maxK=Math.ceil(Math.max(...Array.from({length:COLS},(_,c)=>{const a=c/COLS*Math.PI*2;return rimOf(a);}))/RING)+1;
  for(let c=0;c<COLS;c++)for(let k=0;k<maxK;k++){
   const a=vert(c,k),b=vert(c+1,k),d=vert(c,k+1),e=vert(c+1,k+1);
   for(const t of [[a,d,b],[b,d,e]]){
    const mx=(t[0][0]+t[1][0]+t[2][0])/3,mz=(t[0][2]+t[1][2]+t[2][2])/3;
    // Sólo donde hay agua: fuera de la ciudad y donde el fondo queda bajo la superficie (o casi).
    if(outside(mx,mz)<4||I.landH(mx,mz)>WATER+.25)continue;// el mar, por el terreno natural (no el aplanado de calles y lotes)
    // (2026-10-16, medido sin pantalla —validar-triangulos—: el que queda entero debajo de la arena —sus tres puntas y su centro
    // 5 cm bajo el terreno dibujado— no se ve: no se dibuja; el 6,6 % del agua de la orilla)
    if([...t,[mx,0,mz]].every(v=>height(v[0],v[2])>WATER+.05))continue;
    const depthHere=Math.max(0,WATER-height(mx,mz));cc.copy(SH).lerp(MD,smooth(.1,1.2,depthHere)).lerp(DP,smooth(1.2,2.6,depthHere)).multiplyScalar(.9+.2*fbm(mx*.4,mz*.4,1));
    for(const v of t){p.push(...v);col.push(cc.r,cc.g,cc.b);}
   }}
  const seaGeo=new THREE.BufferGeometry();seaGeo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));seaGeo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));seaGeo.computeVertexNormals();
  const sea=new THREE.Mesh(seaGeo,seaMat);sea.name='agua:orilla';sea.receiveShadow=true;group.add(sea);own.push(seaGeo);}
 // Cortinas: en cada tramo del borde donde llega el agua (no en la montaña), el agua cae por fuera de la roca.
 // Cascadas: en los tramos del borde donde llega el agua (no en la montaña, y no en todos), el agua se curva al pasar
 // la orilla y cae en una cortina facetada con crestas verticales. Cada tramo seguido es una cascada.
 const isFall=i=>{const p=rim[(i+RN)%RN],q=rim[(i+1+RN)%RN],inside=k=>height(cx+Math.cos(k.a)*(k.R-4),cz+Math.sin(k.a)*(k.R-4));return inside(p)<WATER&&inside(q)<WATER&&fbm(((i+RN)%RN)*.3+2,7,2)>=.36;};
 const runs=[];{const on=Array.from({length:RN},(_,i)=>isFall(i));
  // Un hueco de un tramo entre dos cascadas se llena (es una sola), y no quedan chorros de uno o dos tramos.
  for(let i=0;i<RN;i++)if(!on[i]&&on[(i+RN-1)%RN]&&on[(i+1)%RN])on[i]=true;
  let start=-1;for(let i=0;i<=RN;i++){const v=i<RN&&on[i];if(v&&start<0)start=i;if(!v&&start>=0){if(i-start>=3)runs.push([start,i]);start=-1;}}}
 const fallH=60+depth*.18;
 // Perfil de la caída: [cuánto sale del borde, altura]. Arriba se curva sobre la orilla; después cae casi vertical.
 // Perfil de la caída: [cuánto sale del borde, altura]. Arranca en el borde del mar, se curva y cae casi vertical, por
 // fuera de la roca que cuelga (que sobresale un 2 % del borde).
 const PROFILE=[[0,WATER],[1.6,WATER+.14],[3.2,WATER-.5],[4.4,WATER-2],[5.2,-6],[5.8,-14],[6.4,-24],[7,-36],[7.6,-50],[8.2,-fallH*.8],[8.8,-fallH]];
 const TOP=new THREE.Color('#f2fbff'),MID=new THREE.Color('#bfe6f4'),LOW=new THREE.Color('#8fcbe3');
 const fp=[],fc=[],mist=[];
 for(const [i0,i1] of runs){
  const cols=[];for(let i=i0;i<=i1;i++)for(let k=0;k<(i<i1?2:1);k++){const a=(i+k/2)/RN*Math.PI*2,R=edgeAlong(a)+rimOf(a);cols.push({a,R,ridge:((i*2+k)%3===0?.9:0)+(fbm(i*.9+k,3,2)-.5)*1.2});}
  // Los costados se adelgazan: las últimas columnas salen menos y caen menos (un chorro que se angosta, no un corte).
  const nC=cols.length,grid=cols.map((col,ci)=>{const edge=Math.min(ci,nC-1-ci),taper=[.25,.5,.72,.9][edge]??1;
   return PROFILE.map(([off,y],ri)=>{const jr=ri<2?0:(fbm(ci*1.7,ri*2.3,2)-.5)*1.6,jy=ri<2?0:(fbm(ci*2.1+9,ri*1.3,2)-.5)*2.4,rr=col.R+(off+col.ridge*(ri>2?1:0)+jr)*(ri<2?1:taper)+col.R*.03*smooth(2,5,ri);
    return [cx+Math.cos(col.a)*rr,ri<2?y:ri<4?y+jy:y*(.35+.65*taper)+jy,cz+Math.sin(col.a)*rr];});});
  const color=ri=>ri<3?TOP:ri<6?TOP.clone().lerp(MID,(ri-2)/3):MID.clone().lerp(LOW,(ri-5)/(PROFILE.length-6));
  for(let ci=0;ci<nC-1;ci++)for(let ri=0;ri<PROFILE.length-1;ri++){
   const a=grid[ci][ri],b=grid[ci+1][ri],c2=grid[ci][ri+1],d2=grid[ci+1][ri+1],ca=color(ri),cb=color(ri+1);
   for(const [p,cc] of [[a,ca],[c2,cb],[b,ca],[b,ca],[c2,cb],[d2,cb]]){fp.push(...p);fc.push(cc.r,cc.g,cc.b);}
  }
  // Espuma al pie: un racimo de nubecitas blancas.
  const mid=cols[Math.floor(nC/2)],mr=mid.R*1.03+9;for(let k=0;k<4;k++)mist.push({x:cx+Math.cos(mid.a)*mr+(r()-.5)*nC*2,y:-fallH-4+(r()-.5)*5,z:cz+Math.sin(mid.a)*mr+(r()-.5)*nC*2,s:5+r()*5+nC*.4});
 }
 if(fp.length){const fg=new THREE.BufferGeometry();fg.setAttribute('position',new THREE.Float32BufferAttribute(fp,3));fg.setAttribute('color',new THREE.Float32BufferAttribute(fc,3));fg.computeVertexNormals();
  const fm=new THREE.Mesh(fg,fallMat);fm.castShadow=true;group.add(fm);own.push(fg);}
 const mistMat=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:1,flatShading:true,emissive:'#e8f4f8',emissiveIntensity:.25});own.push(mistMat);
 inst(new THREE.IcosahedronGeometry(1,1),mistMat,mist,(o,m)=>{o.position.set(m.x,m.y,m.z);o.scale.set(m.s,m.s*.6,m.s);});

 // ---------- Nubes: racimos low-poly alrededor y por debajo, que giran despacio ----------
 const clouds=new THREE.Group(),puff=new THREE.IcosahedronGeometry(1,1),cloudMat=new THREE.MeshStandardMaterial({color:'#fff6ea',roughness:1,flatShading:true,emissive:'#fff1e0',emissiveIntensity:.15});own.push(puff,cloudMat);
 const items=[];
 for(let i=0;i<46;i++){const a=r()*Math.PI*2,R=reach+60+r()*520,y=-260+r()*330,s=10+r()*16;
  for(let k=0;k<4+Math.floor(r()*3);k++)items.push({x:Math.cos(a)*R+(r()-.5)*s*2.4,y:y+(r()-.3)*s*.5,z:Math.sin(a)*R+(r()-.5)*s*1.4,sx:s*(.8+r()*.6),sy:s*(.45+r()*.25),sz:s*(.7+r()*.5)});}
 const cm=new THREE.InstancedMesh(puff,cloudMat,items.length),o=new THREE.Object3D();items.forEach((it,i)=>{o.position.set(it.x,it.y,it.z);o.scale.set(it.sx,it.sy,it.sz);o.updateMatrix();cm.setMatrixAt(i,o.matrix);});
 clouds.add(cm);clouds.position.set(cx,0,cz);group.add(clouds);

 // ---------- Nombres de la isla: playas, cerros y casas (con su propio sorteo: la isla no cambia de forma) ----------
 const nr=rng(map.seed*7907+3),shuffle=a=>{const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(nr()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b;};
 const CERROS=shuffle(['Cerro El Mirador','Cerro Las Nubes','Cerro La Cruz','Cerro del Cóndor','Cerro Guadalupe','Cerro El Volcán','Cerro Los Pinos','Cerro de la Vieja']);
 const PLAYAS=shuffle(['Playa Blanca','Playa del Sol','Playa Escondida','Playa Los Cocos','Playa La Ballena','Playa del Faro','Playa Bonita','Playa Las Gaviotas','Playa del Coral','Playa Tranquila']);
 const CABANAS=shuffle(['Las Gaviotas','El Faro','La Concha','Brisa Marina','El Coral','La Ola','Caracol','Arrecife','Marea Alta','El Velero','Mar Azul','La Estrella','Palmeras','El Delfín','La Perla','Atardecer','Bahía','El Ancla','Sal y Sol','La Caracola']);
 const FINCAS=shuffle(['La Esperanza','El Roble','Los Naranjos','La Pradera','El Refugio','San José','La Montaña','Villa Rosa','El Encanto','Las Brisas','La Arboleda','El Mirador','Santa Ana','Buenavista','El Cafetal','La Primavera','El Guadual']);
 sectors.forEach((sc,i)=>sc.name=CERROS[i%CERROS.length]);
 // Las playas son los arcos del contorno sin montaña; uno largo se parte en playas de 80° como mucho.
 const beaches=[];{const N=360,flat=i=>mountain(i/N*Math.PI*2)<.35;let start=-1;const first=[...Array(N).keys()].find(i=>!flat(i))??0;
  for(let k=0;k<=N;k++){const i=(first+k)%N,on=k<N&&flat(i);if(on&&start<0)start=k;if(!on&&start>=0){const len=k-start,parts=Math.max(1,Math.round(len/80));
   for(let p=0;p<parts;p++){const a0=(first+start+len*p/parts)/N*Math.PI*2,a1=(first+start+len*(p+1)/parts)/N*Math.PI*2;beaches.push({a0,a1,mid:(a0+a1)/2,name:PLAYAS[beaches.length%PLAYAS.length]});}start=-1;}}}
 const angNorm=a=>((a%(Math.PI*2))+Math.PI*2)%(Math.PI*2);
 const beachAt=ang=>{const a=angNorm(ang);return beaches.find(b=>{const lo=angNorm(b.a0),hi=angNorm(b.a1);return lo<=hi?a>=lo&&a<hi:a>=lo||a<hi;})||beaches.slice().sort((x,y)=>angDiff(x.mid,ang)-angDiff(y.mid,ang))[0];};
 const cerroAt=ang=>sectors.reduce((best,sc)=>{const w=smooth(sc.w/2,sc.w/2*.35,angDiff(ang,sc.a));return w>best.w?{w,name:sc.name}:best;},{w:0,name:sectors[0].name}).name;
 let ic=0,iff=0;for(const h of houses)h.name=h.planName||(h.kind==='playa'?`Cabaña ${CABANAS[ic++%CABANAS.length]}`:`Finca ${FINCAS[iff++%FINCAS.length]}`);
 for(const h of modelHouses)if(!h.name)h.name=`Finca ${FINCAS[iff++%FINCAS.length]}`;
 // Carteles: uno al empezar cada playa (bajando desde la pradera), uno al pie de cada cerro, y una placa en cada casa.
 const tex=(text,bg,fg,w=512,h=128)=>{const cv=document.createElement('canvas');cv.width=w;cv.height=h;const g=cv.getContext('2d');g.fillStyle=bg;g.fillRect(0,0,w,h);g.strokeStyle='rgba(255,255,255,.55)';g.lineWidth=h*.05;g.strokeRect(h*.07,h*.07,w-h*.14,h-h*.14);
  g.fillStyle=fg;g.font=`700 ${Math.round(h*.46)}px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`;g.textAlign='center';g.textBaseline='middle';g.fillText(text,w/2,h*.54,w*.9);const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;own.push(t);return t;};
 const signMats=[],board=(text,bg,fg,w,hgt,x,y,z,ry,legs)=>{const t=tex(text,bg,fg),m=new THREE.MeshStandardMaterial({map:t,emissiveMap:t,emissive:0x000000,roughness:.6});own.push(m);signMats.push(m);
  for(const side of [0,Math.PI]){const pl=new THREE.Mesh(new THREE.PlaneGeometry(w,hgt),m);own.push(pl.geometry);pl.position.set(x+Math.sin(ry+side)*.04,y,z+Math.cos(ry+side)*.04);pl.rotation.y=ry+side;group.add(pl);}
  if(legs){const lh=y+hgt/2-groundY;for(const s of [-1,1]){const l=new THREE.Mesh(new THREE.BoxGeometry(.14,lh,.14),postMat);own.push(l.geometry);l.position.set(x+Math.cos(ry)*s*(w/2-.15),groundY+lh/2,z-Math.sin(ry)*s*(w/2-.15));l.castShadow=true;group.add(l);}}};
 const postMat=new THREE.MeshStandardMaterial({color:'#6b4e36',roughness:.9});own.push(postMat);let groundY=0;
 const along=(ang,test)=>{const ux=Math.cos(ang),uz=Math.sin(ang),start=edgeAlong(ang);for(let d=4;d<rimAt(ang)-start;d+=1.5){const x=cx+ux*(start+d),z=cz+uz*(start+d);if(test(x,z))return {x,z};}return null;};
 // Los lugares destacados (hospital, alcaldía, edificios, tienda): un cartel adelante, del lado de la ciudad.
 for(const h of modelHouses.filter(k=>k.kind==='hito')){const fx=h.x+Math.sin(h.ry)*(h.d/2+3.5),fz=h.z+Math.cos(h.ry)*(h.d/2+3.5);groundY=landH(fx,fz);board(h.name,'#3a3229','#f1e3b5',3.4,.75,fx,groundY+1.9,fz,h.ry,true);}
 for(const b of beaches){const p=along(b.mid,(x,z)=>landH(x,z)<.75&&!houseFloor(x,z));if(!p)continue;groundY=landH(p.x,p.z);board(b.name,'#2f6f8f','#fff8e6',3.2,.75,p.x,groundY+1.9,p.z,b.mid+Math.PI/2,true);}
 for(const sc of sectors){const p=along(sc.a,(x,z)=>landH(x,z)>5&&!houseFloor(x,z));if(!p)continue;groundY=landH(p.x,p.z);board(sc.name,'#4f6b3a','#f6efd9',3.4,.8,p.x,groundY+1.9,p.z,sc.a+Math.PI/2,true);}
 for(const h of (LOWPOLY.on?[]:houses)){if(h.casaIdx!=null)continue;const P=(lx,ly,lz)=>({x:h.x+lx*Math.cos(h.ry)+lz*Math.sin(h.ry),y:h.base+ly,z:h.z-lx*Math.sin(h.ry)+lz*Math.cos(h.ry)});const q=P(h.door,DH+.35,h.d/2+.06);
  const t=tex(h.name,'#3a3229','#f1e3b5',384,80),m=new THREE.MeshStandardMaterial({map:t,emissiveMap:t,emissive:0x000000,roughness:.6});own.push(m);signMats.push(m);
  const pl=new THREE.Mesh(new THREE.PlaneGeometry(1.9,.4),m);own.push(pl.geometry);pl.position.set(q.x,q.y,q.z);pl.rotation.y=h.ry;group.add(pl);}

 function update(t){clouds.rotation.y=t*.004;}
 function setNight(on){if(charcos)charcos.visible=on;windowMat.emissiveIntensity=on?1.6:0;for(const m of signMats){m.emissive.set(on?0xffffff:0x000000);m.emissiveIntensity=on?.55:0;}lampMat.emissiveIntensity=on?3:.3;cloudMat.color.set(on?'#4a5368':'#fff6ea');cloudMat.emissive.set(on?'#1c2233':'#fff1e0');seaMat.color.set(on?'#3d5a73':'#ffffff');fallMat.color.set(on?'#5d7389':'#ffffff');mistMat.color.set(on?'#6a7a8e':'#ffffff');mistMat.emissiveIntensity=on?.05:.25;}
 function dispose(){for(const x of own)x.dispose?.();}
 // Para el dron: la altura del suelo, o -Infinity si el punto está fuera de la isla (ahí se puede bajar).
 // Se camina por todo menos el agua honda y el vacío (dentro de la ciudad manda la ciudad).
 const onRock=(x,z)=>rocks.some(r=>(x-r.x)**2+(z-r.z)**2<r.r*r.r);
 const walkable=(x,z,feet)=>outside(x,z)<0||(beyond(x,z)<-1.2&&height(x,z)>-1.4&&!inHouse(x,z,feet)&&!onRock(x,z));
 // Dónde se está, con nombre: la casa (adentro o en su puerta), el cerro, la playa (o su agua) o la pradera.
 const where=(x,z)=>{const h=height(x,z),hf=houseFloor(x,z),ang=Math.atan2(z-cz,x-cx);if(hf)return (hf.inside?'Dentro: ':'')+hf.h.name;
  const mh=modelHouses.find(k=>{const [lx,lz]=local(k,x,z);return Math.abs(lx)<k.w/2+3&&Math.abs(lz)<k.d/2+3;});if(mh)return mh.name;
  if(h<WATER)return `Agua · ${beachAt(ang)?.name||'la orilla'}`;if(h>7)return cerroAt(ang);if(h<.85&&outside(x,z)>3)return beachAt(ang)?.name||'Playa';return mountain(ang)>.5?`Faldas del ${cerroAt(ang)}`:'Pradera';};
 // Para la gente de la isla: un punto al azar de playa, monte o pradera, y el recorrido para entrar a una casa.
 // near: si viene, el punto se busca a menos de radius metros de ahí (para que los viajes sean cortos).
 const spot=(kind,rand,near=null,radius=140)=>{for(let k=0;k<300;k++){const x=near?near.x+(rand()*2-1)*radius:x0+rand()*reach*2,z=near?near.z+(rand()*2-1)*radius:z0+rand()*reach*2;if(outside(x,z)<4||!walkable(x,z)||houseFloor(x,z))continue;const h=height(x,z);
  if(kind==='playa'&&h>.1&&h<.8)return {x,z};if(kind==='monte'&&h>8&&h<55&&unevenness(x,z,3)<3)return {x,z};if(kind==='prado'&&h>.9&&h<8)return {x,z};}return null;};
 // (el mar: un punto con agua de al menos depth de hondo —para los animales de mar, animals3d.js—; near: cerca de él)
 const agua=(rand,depth=1.2,near=null,radius=60)=>{for(let k=0;k<400;k++){const x=near?near.x+(rand()*2-1)*radius:x0+rand()*reach*2,z=near?near.z+(rand()*2-1)*radius:z0+rand()*reach*2;
  if(beyond(x,z)>0)continue;const h=height(x,z);if(isFinite(h)&&h<WATER-depth&&h>WATER-depth-30)return {x,z,depth:WATER-h};}return null;};
 const doorPath=h=>{const P=(lx,lz)=>({x:h.x+lx*Math.cos(h.ry)+lz*Math.sin(h.ry),z:h.z-lx*Math.sin(h.ry)+lz*Math.cos(h.ry)});return {outside:P(h.door,h.d/2+1.8),door:P(h.door,h.d/2-.7),inside:P(h.door*.2,-h.d*.05)};};
 // Las puertas: se abren con alguien a menos de 2,2 m (gente: [{x,z}]) y se cierran solas.
 function updateDoors(dt,people){for(const d of doorLeaves){const near=people.some(o=>(o.x-d.cx)**2+(o.z-d.cz)**2<4.8),a=near?Math.min(1,d.a+dt*2.4):Math.max(0,d.a-dt*1.3);if(a!==d.a){d.a=a;d.pivot.rotation.y=d.h.ry+a*1.45;}}}
 // ---------- Del plano: senderos, plazas, el globo y el parapente ----------
 // Los senderos: losetas de tierra cada 1,2 m entre casillas de sendero vecinas (y hacia las plazas), sobre el terreno.
 // Las plazas: una loseta clara por casilla. El globo, inflado y atado en la arena; el parapente, desplegado al borde.
 if(fromPlan){const I=plan.isla,Cs=6,ck=(x,y)=>x+','+y,byK=new Map(I.cells.map(c=>[ck(c.x,c.y),c])),tiles=[],plz=[];
  // Cada loseta se apoya en el terreno: se inclina con la pendiente del lugar (e: a qué distancia se mide).
  const UP=new THREE.Vector3(0,1,0),tilt=(x,z,e)=>{const n=new THREE.Vector3(-(height(x+e,z)-height(x-e,z))/(2*e),1,-(height(x,z+e)-height(x,z-e))/(2*e)).normalize();return new THREE.Quaternion().setFromUnitVectors(UP,n);};
  for(const c of I.cells){if(c.terraza!=null)continue;if(c.plaza!=null){const x=(c.x+.5)*Cs,z=(c.y+.5)*Cs,hs=[[-2.5,-2.5],[2.5,-2.5],[-2.5,2.5],[2.5,2.5],[0,0]].map(([a,b])=>height(x+a,z+b));plz.push({x,y:hs.reduce((a,b)=>a+b,0)/hs.length+.06,z,q:tilt(x,z,2.5)});}
   if(!c.sendero||c.carretera)continue;for(const [dx,dy] of [[1,0],[0,1],[-1,0],[0,-1]]){const nb=byK.get(ck(c.x+dx,c.y+dy));if(!nb||!(nb.sendero||nb.plaza!=null)||nb.carretera)continue;if((dx<0||dy<0)&&nb.sendero)continue;
    const ax=(c.x+.5)*Cs,az=(c.y+.5)*Cs,bx=(nb.x+.5)*Cs,bz=(nb.y+.5)*Cs;for(let t=0;t<=1.0001;t+=.2){const x=ax+(bx-ax)*t,z=az+(bz-az)*t;tiles.push({x,y:height(x,z)+.04,z,q:tilt(x,z,.8)});}}}
  // Una loseta en cada salida del muro donde arranca un sendero (no en las de las avenidas: ahí la ciudad pone calle).
  const conSendero=I.cells.some(c=>c.sendero),deAvenida=new Set((I.carreteras||[]).filter(r=>r.desde).map(r=>r.desde.join(',')));
  if(conSendero)for(const g of I.gates){if(deAvenida.has(g.x+','+g.y))continue;const x=(g.x+.5)*Cs,z=(g.y+.5)*Cs;tiles.push({x,y:height(x,z)+.04,z,q:tilt(x,z,.8)});}
  const tileG=new THREE.BoxGeometry(1.5,.08,1.5),tileM=new THREE.MeshStandardMaterial({color:'#a8865c',roughness:1}),plazaG=new THREE.BoxGeometry(Cs+.4,.3,Cs+.4),plazaM=new THREE.MeshStandardMaterial({color:'#d9d2bf',roughness:.95});own.push(tileG,tileM,plazaG,plazaM);
  const im=(geo,mat,list)=>{if(!list.length)return;const M=new THREE.InstancedMesh(geo,mat,list.length),o=new THREE.Object3D();list.forEach((p,i)=>{o.position.set(p.x,p.y,p.z);if(p.q)o.quaternion.copy(p.q);else o.quaternion.identity();o.updateMatrix();M.setMatrixAt(i,o.matrix);});M.receiveShadow=true;group.add(M);};
  im(tileG,tileM,tiles);im(plazaG,plazaM,plz);
  // Las carreteras: una cinta de asfalto de ROAD_W m sobre el terreno ya cortado, la línea amarilla al medio y, del lado
  // del barranco (donde el terreno de afuera cae más de 1,5 m), postes y baranda.
  if(roads.length){const spos=[],tpos=[],tcol=[],yel=[],pos=[],uv=[],idx=[],dash=[],posts=[],rails=[],lamps=[],arms=[],heads=[],wpos=[],wuv=[],widx=[];
   const up=(arr,ix,a,b,c)=>{const A=arr.slice(a*3,a*3+3),B=arr.slice(b*3,b*3+3),C=arr.slice(c*3,c*3+3),ny=(B[2]-A[2])*(C[0]-A[0])-(B[0]-A[0])*(C[2]-A[2]);if(ny>=0)ix.push(a,b,c);else ix.push(a,c,b);};
   // Recorta una polilínea d m desde su comienzo (la punta queda a la altura de la punta original: el cruce es plano).
   const recorta=(P,H,d)=>{let acc=0;for(let i=1;i<P.length;i++){const l=Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]);if(acc+l>d+.01){const t=(d-acc)/l;
     return [[[P[i-1][0]+(P[i][0]-P[i-1][0])*t,P[i-1][1]+(P[i][1]-P[i-1][1])*t],...P.slice(i)],[H[0],...H.slice(i)]];}acc+=l;}return [P,H];};
   // Los cruces de la grilla (como los de la ciudad): un cuadro plano de ROAD_W por lado en cada punta que no es el muro;
   // cada calle que llega se recorta hasta su borde. cruces: id → {x, z, h, brazos (direcciones de las calles que llegan)}.
   const cruces=new Map(),anota=(e,q,w=ROAD_W)=>{if(!e)return;const c=cruces.get(e.id)||cruces.set(e.id,{x:e.x,z:e.z,h:e.h,brazos:[],w:0}).get(e.id);c.w=Math.max(c.w,w);const l=Math.hypot(q[0]-e.x,q[1]-e.z)||1;c.brazos.push({d:[Math.round((q[0]-e.x)/l),Math.round((q[1]-e.z)/l)],g:((q[2]??e.h)-e.h)/Math.max(1,l-ROAD_W/2)});};// la pendiente empieza en el borde del cruce
   const sideTop=(x0,z0,x1,z1,y)=>{const b=wpos.length/3;wpos.push(x0,y,z0,x1,y,z0,x0,y,z1,x1,y,z1);wuv.push(x0/6,z0/6,x1/6,z0/6,x0/6,z1/6,x1/6,z1/6);up(wpos,widx,b,b+1,b+2);up(wpos,widx,b+1,b+3,b+2);};
   const face=(ax,az,bx,bz,ylo,yhi)=>{const c=wpos.length/3;wpos.push(ax,yhi,az,ax,ylo,az,bx,yhi,bz,bx,ylo,bz);wuv.push(0,0,0,.03,1,0,1,.03);widx.push(c,c+1,c+2,c+1,c+3,c+2);};
   // (el asfalto: en las calles de la grilla —las de 12 m o más—, la calzada del 2D, ancho − 2·CALLE.vereda: andenes de 3 m
   // como los del plano, donde van sus árboles y faroles; hasta 2026-10-16 era ancho − 2, andenes de 1 m)
   const asfDe=w=>w>=12?w-2*CALLE.vereda:w-2;
   for(const R of roads){let {P,H}=R;const base0=pos.length/3,ROAD_W=R.RW,ASF=asfDe(ROAD_W),av=ROAD_W>6;
    if(R.ini){const k=P.length>2?2:1;anota(R.ini,[...P[k],H[k]],ROAD_W);[P,H]=recorta(P,H,ROAD_W/2);}
    if(R.fin){const k=P.length>2?-3:-2;anota(R.fin,[...P.at(k),H.at(k)],ROAD_W);const [Q,G]=recorta([...P].reverse(),[...H].reverse(),ROAD_W/2);P=Q.reverse();H=G.reverse();}
    R.D={P,H};const base=base0;let along=0;const walkL=[[],[]];
    for(let i=0;i<P.length;i++){
     // Normal con inglete: en un chaflán, el promedio de las normales de los dos tramos, alargado para que el ancho no cambie.
     const n1=i>0?[-(P[i][1]-P[i-1][1]),P[i][0]-P[i-1][0]]:null,n2=i+1<P.length?[-(P[i+1][1]-P[i][1]),P[i+1][0]-P[i][0]]:null,nl=v=>{const l=Math.hypot(...v)||1;return [v[0]/l,v[1]/l];};
     const u1=n1&&nl(n1),u2=n2&&nl(n2),m=nl(u1&&u2?[u1[0]+u2[0],u1[1]+u2[1]]:u1||u2),k=1/Math.max(.5,u1?m[0]*u1[0]+m[1]*u1[1]:1),nx=m[0]*k,nz=m[1]*k;
     if(i)along+=Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]);
     // Al pie del muro, al nivel de la calle de la ciudad (y=0 y el andén a CURB_H); más allá, 7 cm sobre el terreno.
     const lift=R.muro?.07*smooth(0,12,along):.07;
     pos.push(P[i][0]+nx*ASF/2,H[i]+lift,P[i][1]+nz*ASF/2,P[i][0]-nx*ASF/2,H[i]+lift,P[i][1]-nz*ASF/2);uv.push(0,along/12,ASF/12,along/12);
     // Los andenes: arriba de 2 a 3 m del eje, el cordón (la cara de 2 m) y, afuera, la cara que baja hasta el terreno.
     for(const sg of [1,-1]){const a2=[P[i][0]+nx*sg*ASF/2,P[i][1]+nz*sg*ASF/2],a3=[P[i][0]+nx*sg*ROAD_W/2,P[i][1]+nz*sg*ROAD_W/2],y0=H[i]+lift,y1=H[i]+lift+CURB_H;
      walkL[sg>0?0:1].push([a2[0],y1,a2[1],a3[0],y1,a3[1],a2[0],y0,a2[1],along,a3[0],H[i]-.45,a3[1]]);}
     if(i+1<P.length){const k=base+i*2;idx.push(k,k+1,k+2,k+1,k+3,k+2);}}
    for(const L of walkL)for(let i=1;i<L.length;i++){const a=L[i-1],b=L[i],k=wpos.length/3;
     wpos.push(a[0],a[1],a[2],a[3],a[4],a[5],b[0],b[1],b[2],b[3],b[4],b[5]);wuv.push(0,a[9]/6,1/6,a[9]/6,0,b[9]/6,1/6,b[9]/6);up(wpos,widx,k,k+1,k+2);up(wpos,widx,k+1,k+3,k+2);
     const c=wpos.length/3;wpos.push(a[0],a[1],a[2],a[6],a[7],a[8],b[0],b[1],b[2],b[6],b[7],b[8]);wuv.push(0,0,0,.03,1,0,1,.03);widx.push(c,c+1,c+2,c+1,c+3,c+2);
     const o=wpos.length/3;wpos.push(a[3],a[4],a[5],a[10],a[11],a[12],b[3],b[4],b[5],b[10],b[11],b[12]);wuv.push(0,0,0,.08,1,0,1,.08);widx.push(o,o+1,o+2,o+1,o+3,o+2);}
    // Las rampas a la manzana, a cada lado de la calle, casilla por casilla del borde:
    // - baja: el lote queda más bajo que la calle (la mitad de abajo junto a una calle que sube): un relleno con pasto
    //   baja desde el borde del andén hasta el lote (de 1,2 a 5,5 m de ancho según lo que baje: triangular);
    // - sube: el lote queda más alto (la mitad de arriba): el filo del lote se corta en rampa desde el andén hasta el
    //   nivel del lote, del mismo ancho; el resto de la casilla del borde queda plano al nivel del lote (esa casilla no
    //   lleva bloque: rampas).
    // Se decide por tramo (entre dos muestras, por la casilla de su punto medio) y las muestras caen en los bordes de las
    // casillas, así la rampa termina justo donde termina la casilla; en cada punta, la cara de tierra hasta el vecino.
    // (sobre la calle entera, sin recortar: la rampa sigue hasta la esquina de la manzana, junto al cruce)
    {const cl=h=>{const c=new THREE.Color(h);return [c.r,c.g,c.b];},GR=cl('#86ad4f'),EA=cl('#9a8f80');
     // La calle entera, con su tramo plano en cada cruce (el mismo perfil que se dibuja).
     const Q=R.P,HQ=R.H,plana=Math.max(...R.H)-Math.min(...R.H)<.3;
     const tri=(a,b,c,col)=>{{const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];if(Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)<2e-6)return;}/* (sin área: una punta a ras) */if((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])<0)[b,c]=[c,b];if(col===EA){spos.push(...a,...b,...c);return;}tpos.push(...a,...b,...c);for(let k=0;k<3;k++)tcol.push(...col);};// las caras de las puntas, de piedra (como el muro)
     const quad=(a,b,c,d,col)=>{tri(a,b,c,col);tri(a,c,d,col);};
     const gOf=(x,z)=>{const k=Math.floor(x/6)+','+Math.floor(z/6);return rampas.get(k)?.orig??terrazaAt(x,z);};
     for(const sg of [1,-1]){
      // Las muestras: en los bordes de casilla (a 3 m de los cruces y cada 6 m): entre dos, la rampa es plana.
      const S=[];for(let i=1;i<Q.length;i++){const [ax,az]=Q[i-1],[bx,bz]=Q[i],l=Math.hypot(bx-ax,bz-az);if(l<.01)continue;const nx=-(bz-az)/l*sg,nz=(bx-ax)/l*sg,n=Math.max(1,Math.round(l/6));
       for(let k=(S.length?1:0);k<=n;k++){const t=k/n,px=ax+(bx-ax)*t,pz=az+(bz-az)*t;S.push({x:px+nx*ROAD_W/2,z:pz+nz*ROAD_W/2,nx,nz,hr:HQ[i-1]+(HQ[i]-HQ[i-1])*t+.07+CURB_H});}}
      const modo=(a,b)=>{const mx=(a.x+b.x)/2+a.nx*1.2,mz=(a.z+b.z)/2+a.nz*1.2,k=Math.floor(mx/6)+','+Math.floor(mz/6),g=gOf(mx,mz),hr=(a.hr+b.hr)/2;
       if(g==null)return null;if(rampas.has(k))return plana?null:{m:'sube',g};/* la casilla con rampa la dibuja la calle que sube (la plana del cruce no) */if(g<hr-CURB_H-.07-.05&&(!SIN_HUECOS||hr-CURB_H-.07-g<=TERRAZA.acceso))return {m:'baja',g};return null;};// (más abajo que eso, la cara del andén baja hasta el lote: sin relleno)
      const prof=(p,M)=>{const q=[p.x,p.hr,p.z],at=w=>[p.x+p.nx*w,M.g+.06,p.z+p.nz*w];
       if(M.m==='baja'){const w=Math.min(5.5,Math.max(0,(p.hr-CURB_H-.07-M.g)*1.2));return {borde:[p.x,M.g+.06+Math.min(p.hr-M.g-.06,w/1.2+CURB_H+.07),p.z],filo:at(w)};}
       const w=Math.min(5.5,Math.max(0,(M.g-p.hr+CURB_H+.07)*1.2));return {borde:[p.x,Math.min(M.g,p.hr-CURB_H-.07)+.06,p.z],filo:at(w),fin:at(6)};};// a ras: sin ancho mínimo, la punta termina en cero
      // La cara de una punta: del perfil hacia abajo hasta piso (el vecino o la calle).
      const cara=(p,M,piso)=>{const f=prof(p,M),d=v=>[v[0],piso,v[2]];
       if(M.m==='baja')tri(f.borde,f.filo,[p.x,M.g+.06,p.z],EA);
       else{if(f.borde[1]>piso+.01||f.filo[1]>piso+.01)quad(f.borde,f.filo,d(f.filo),d(f.borde),EA);quad(f.filo,f.fin,d(f.fin),d(f.filo),EA);}};
      const ms=[];for(let i=1;i<S.length;i++)ms.push(modo(S[i-1],S[i]));
      for(let i=1;i<S.length;i++){const M=ms[i-1];if(!M)continue;const a=prof(S[i-1],M),b=prof(S[i],M);
       quad(a.borde,b.borde,b.filo,a.filo,GR);if(a.fin)quad(a.filo,b.filo,b.fin,a.fin,GR);
       // Puntas: donde el tramo de al lado no es del mismo modo.
       const piso=(N,p)=>Math.min(p.hr-CURB_H,N?N.g:p.hr-CURB_H)-.05;
       const A=ms[i-2],B=ms[i];if(!A||A.m!==M.m||A.g!==M.g)cara(S[i-1],M,piso(A,S[i-1]));if(!B||B.m!==M.m||B.g!==M.g)cara(S[i],M,piso(B,S[i]));}}}
    const FAROL=18,largo=P.reduce((a,q,i)=>i?a+Math.hypot(q[0]-P[i-1][0],q[1]-P[i-1][1]):0,0);
    let acc=0;for(let i=1;i<P.length;i++){const [ax,az]=P[i-1],[bx,bz]=P[i],l=Math.hypot(bx-ax,bz-az),ry=Math.atan2(bx-ax,bz-az);acc+=l;
     // (la línea del medio la dice el plano —engine/pintura.js— y la pega al asfalto plano3d con pintura3d.js)
     // Faroles como los de la ciudad: uno cada FAROL m (el primero a la mitad), alternando el lado, en el andén con el
     // brazo hacia la calle; a la altura de la calle en ese punto. No a menos de 2 m de las puntas (ahí está el cruce).
     for(let m=Math.ceil((acc-l-FAROL/2)/FAROL)*FAROL+FAROL/2;m<=acc;m+=FAROL){if(m<acc-l||m<2||m>largo-2)continue;const t=(m-(acc-l))/(l||1),cx0=ax+(bx-ax)*t,cz0=az+(bz-az)*t,hy=H[i-1]+(H[i]-H[i-1])*t;
      const sg=Math.round((m-FAROL/2)/FAROL)%2?1:-1,tl0=l||1,nx0=-(bz-az)/tl0*sg,nz0=(bx-ax)/tl0*sg,px=cx0+nx0*(ASF/2+.6),pz=cz0+nz0*(ASF/2+.6),py=hy+.07+CURB_H,ryl=Math.atan2(nz0,-nx0);// el eje x del brazo apunta hacia la calle
      if(ISLA3D.faroles){lamps.push({x:px,y:py,z:pz,ry:0});arms.push({x:px-nx0*.6,y:py+4.45,z:pz-nz0*.6,ry:ryl});heads.push({x:px-nx0*1.15,y:py+4.35,z:pz-nz0*1.15,ry:ryl});}}
     const tx=bx-ax,tz=bz-az,tl=l||1,nx=-tz/tl,nz=tx/tl;for(const sgn of [1,-1]){const ox=(ax+bx)/2+nx*sgn*(ROAD_W/2+3),oz=(az+bz)/2+nz*sgn*(ROAD_W/2+3);
      // Baranda sólo donde ese lado no tiene franja (con franja, el borde es plano).
      const wl=R.IZ?(sgn>0?Math.min(R.IZ[i-1],R.IZ[i]):Math.min(R.DE[i-1],R.DE[i])):0;
      if(!wl&&!R.ini&&!R.fin&&land0(ox,oz)<(H[i-1]+H[i])/2-1.5&&Math.floor(acc/4)!==Math.floor((acc-l)/4)){const px=(ax+bx)/2+nx*sgn*(ROAD_W/2+.3),pz=(az+bz)/2+nz*sgn*(ROAD_W/2+.3),py=(H[i-1]+H[i])/2;posts.push({x:px,y:py+.45,z:pz,ry});rails.push({x:px,y:py+.75,z:pz,ry});}}}}
   // Los cruces: el cuadro de asfalto a nivel; en cada esquina un andén de 1×1 m y, del lado donde no llega calle, el andén
   // que lo cierra (como en la ciudad). Las cebras de las calles que llegan las pone el plano.
   // (cada cruce con el ancho de sus calles —c.w, la más ancha que llega—: el cuadro y sus esquinas de andén de 3 m)
   for(const c of cruces.values()){const Rw=(c.w||ROAD_W)/2,y=c.h+.07,yt=y+CURB_H,yb=c.h-.45,b=pos.length/3,A=asfDe(c.w||ROAD_W)/2;
    for(const [dx,dz] of [[-Rw,-Rw],[Rw,-Rw],[-Rw,Rw],[Rw,Rw]]){pos.push(c.x+dx,y,c.z+dz);uv.push((c.x+dx)/12,(c.z+dz)/12);}up(pos,idx,b,b+1,b+2);up(pos,idx,b+1,b+3,b+2);
    // (2026-10-16, Miguel: «agrega acabados a las esquinas de los andenes, que se vea curvo»: cada esquina, un cuarto de
    // círculo de radio Rw − A con centro en la esquina de afuera —como la vereda de la ciudad—; el cordón sigue el arco)
    for(const sx of [-1,1])for(const sz of [-1,1]){const x0=c.x+sx*A,x1=c.x+sx*Rw,z0=c.z+sz*A,z1=c.z+sz*Rw,r=Rw-A,NA=10,P=k=>{const a=k/NA*Math.PI/2;return [x1-sx*r*Math.cos(a),z1-sz*r*Math.sin(a)];};
     for(let k=0;k<NA;k++){const [ax,az]=P(k),[bx,bz]=P(k+1),b=wpos.length/3;wpos.push(x1,yt,z1,ax,yt,az,bx,yt,bz);wuv.push(x1/6,z1/6,ax/6,az/6,bx/6,bz/6);up(wpos,widx,b,b+1,b+2);face(ax,az,bx,bz,y,yt);}
     face(x1,z0,x1,z1,yb,yt);face(x0,z1,x1,z1,yb,yt);}
    const tiene=(dx,dz)=>c.brazos.some(a=>a.d[0]===dx&&a.d[1]===dz);
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
     if(!tiene(dx,dz)){// el lado cerrado: andén de A a Rw, de una esquina a la otra
      const px=dz?1:0,pz=dx?1:0,x0=c.x+dx*A-px*A,x1=c.x+dx*Rw+px*A,z0=c.z+dz*A-pz*A,z1=c.z+dz*Rw+pz*A;sideTop(Math.min(x0,x1),Math.min(z0,z1),Math.max(x0,x1),Math.max(z0,z1),yt);
      face(c.x+dx*A-px*A,c.z+dz*A-pz*A,c.x+dx*A+px*A,c.z+dz*A+pz*A,y,yt);face(c.x+dx*Rw-px*A,c.z+dz*Rw-pz*A,c.x+dx*Rw+px*A,c.z+dz*Rw+pz*A,yb,yt);continue;}
     }}// (las cebras de los brazos: las del plano —equipamiento.js—, pintadas por pintura3d.js; antes había otras acá encima)
   if(tpos.length){const tg=new THREE.BufferGeometry();tg.setAttribute('position',new THREE.Float32BufferAttribute(tpos,3));tg.setAttribute('color',new THREE.Float32BufferAttribute(tcol,3));tg.computeVertexNormals();
    const tm=new THREE.MeshStandardMaterial({vertexColors:true,flatShading:true,roughness:1,side:THREE.DoubleSide});own.push(tg,tm);const tk=new THREE.Mesh(tg,tm);tk.name='suelo:rellenos';tk.receiveShadow=true;tk.castShadow=true;group.add(tk);}
   // La física del suelo sale de lo que se dibuja: los triángulos que miran hacia arriba del asfalto, de la cima de los
   // andenes y de las rampas y rellenos, en una grilla de 4 m (cada consulta mira sólo los de su cuadro).
   {const T=[],add=(a,b,c)=>{const ny=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]),ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
     const n=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx],l=Math.hypot(...n)||1;if(Math.abs(n[1]/l)<.5)return;T.push(...a,...b,...c);};
    const v3=(arr,i)=>[arr[i*3],arr[i*3+1],arr[i*3+2]];
    for(let i=0;i<idx.length;i+=3)add(v3(pos,idx[i]),v3(pos,idx[i+1]),v3(pos,idx[i+2]));
    for(let i=0;i<widx.length;i+=3)add(v3(wpos,widx[i]),v3(wpos,widx[i+1]),v3(wpos,widx[i+2]));
    for(let i=0;i<tpos.length;i+=9)add(tpos.slice(i,i+3),tpos.slice(i+3,i+6),tpos.slice(i+6,i+9));
    const SC=4,grid=new Map();for(let t=0;t<T.length;t+=9){const xs=[T[t],T[t+3],T[t+6]],zs=[T[t+2],T[t+5],T[t+8]];
     for(let gz=Math.floor(Math.min(...zs)/SC);gz<=Math.floor(Math.max(...zs)/SC);gz++)for(let gx=Math.floor(Math.min(...xs)/SC);gx<=Math.floor(Math.max(...xs)/SC);gx++){const k=gx+','+gz;(grid.get(k)||grid.set(k,[]).get(k)).push(t);}}
    superficie={T,grid,SC,tris:T.length/9};}
   if(spos.length){const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.Float32BufferAttribute(spos,3));sg.computeVertexNormals();const sm=muroDePiedra();sm.side=THREE.DoubleSide;own.push(sg,sm);const sk=new THREE.Mesh(sg,sm);sk.name='suelo:caras';sk.receiveShadow=true;sk.castShadow=true;group.add(sk);}
   // Las mini rotondas: un anillo de asfalto (de la isla del medio a o.asf), el andén de 1 m alrededor con su cordón
   // (abierto donde entra la avenida) y la isla del medio con pasto. Faroles en el andén, con el brazo hacia el centro.
   // up: agrega el triángulo con la cara hacia arriba (el mismo sentido que el resto de la malla).
   const islas=[];
   for(const R of roads){const o=R.rot;if(!o)continue;const ASF=asfDe(R.RW),NS=48,y=o.h+.07,e=R.P.at(-1),ul=Math.hypot(o.x-e[0],o.z-e[1])||1,ux=(o.x-e[0])/ul,uz=(o.z-e[1])/ul;
    let k0=pos.length/3;for(let k=0;k<=NS;k++){const a=k/NS*Math.PI*2,c=Math.cos(a),sn=Math.sin(a);for(const rr of [o.isla,o.asf]){const x=o.x+c*rr,z=o.z+sn*rr;pos.push(x,y,z);uv.push(x/12,z/12);}}
    for(let k=0;k<NS;k++){const a=k0+k*2;up(pos,idx,a,a+1,a+2);up(pos,idx,a+1,a+3,a+2);}
    // El andén: de o.asf a o.R, salvo donde llega el asfalto de la avenida.
    const inRoad=a=>{const px=Math.cos(a),pz=Math.sin(a);return px*ux+pz*uz<0&&Math.abs(px*uz-pz*ux)*o.asf<ASF/2+.05;};
    const yt=y+CURB_H;for(let k=0;k<NS;k++){const a0=k/NS*Math.PI*2,a1=(k+1)/NS*Math.PI*2;if(inRoad(a0)||inRoad(a1))continue;
     const P4=[[a0,o.asf],[a0,o.R],[a1,o.asf],[a1,o.R]].map(([a,rr])=>[o.x+Math.cos(a)*rr,o.z+Math.sin(a)*rr]),b=wpos.length/3;
     for(const [x,z] of P4){wpos.push(x,yt,z);wuv.push(x/6,z/6);}up(wpos,widx,b,b+1,b+2);up(wpos,widx,b+1,b+3,b+2);
     // El cordón: la cara de o.asf, de y a yt.
     const c=wpos.length/3;for(const [x,z] of [P4[0],P4[2]])wpos.push(x,yt,z,x,y,z);wuv.push(0,0,0,.03,1,0,1,.03);widx.push(c,c+1,c+2,c+1,c+3,c+2);}
    islas.push({x:o.x,y,z:o.z,r:o.isla});
    // Tres faroles en el andén, lejos de la entrada.
    const ae=Math.atan2(-uz,-ux);for(const da of [Math.PI*.55,Math.PI,-Math.PI*.55]){const a=ae+da,px=o.x+Math.cos(a)*(o.asf+.6),pz=o.z+Math.sin(a)*(o.asf+.6),nx0=-Math.cos(a),nz0=-Math.sin(a),py=yt,ryl=Math.atan2(-nz0,nx0);
     if(ISLA3D.faroles){lamps.push({x:px,y:py,z:pz,ry:0});arms.push({x:px+nx0*.6,y:py+4.45,z:pz+nz0*.6,ry:ryl});heads.push({x:px+nx0*1.15,y:py+4.35,z:pz+nz0*1.15,ry:ryl});}}}
   if(islas.length){const ig=new THREE.CylinderGeometry(1,1,1,32),im2=new THREE.MeshStandardMaterial({color:'#86ad4f',roughness:1}),cg=new THREE.CylinderGeometry(1,1,1,32,1,true),cm=new THREE.MeshStandardMaterial({color:'#c9c5bc',roughness:.9});own.push(ig,im2,cg,cm);
    for(const o of islas){const g=new THREE.Mesh(ig,im2);g.scale.set(o.r-.15,CURB_H+.12,o.r-.15);g.position.set(o.x,o.y+(CURB_H+.12)/2-.04,o.z);g.receiveShadow=true;group.add(g);
     const cb=new THREE.Mesh(cg,cm);cb.scale.set(o.r,CURB_H+.1,o.r);cb.position.set(o.x,o.y+(CURB_H+.1)/2-.02,o.z);cb.receiveShadow=true;group.add(cb);}}
   const rg=new THREE.BufferGeometry();rg.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));rg.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));rg.setIndex(idx);rg.computeVertexNormals();
   // El asfalto de la ciudad (world3d.js): el mismo gris con manchas y alguna grieta, una textura cada 12 m.
   const ac=document.createElement('canvas');ac.width=ac.height=256;{const g=ac.getContext('2d'),ar=rng(99);g.fillStyle='#55595c';g.fillRect(0,0,256,256);const cs=['#4a4e51','#62676a','#5c6063','#45494b'];
    for(let k=0;k<5000;k++){g.fillStyle=cs[Math.floor(ar()*cs.length)];g.fillRect(ar()*256,ar()*256,1+ar()*2,1+ar()*2);}g.strokeStyle='rgba(30,30,30,.35)';g.lineWidth=1.2;
    for(let k=0;k<4;k++){g.beginPath();let x=ar()*256,y=ar()*256;g.moveTo(x,y);for(let j=0;j<6;j++){x+=(ar()-.5)*40;y+=(ar()-.5)*40;g.lineTo(x,y);}g.stroke();}}
   const at=new THREE.CanvasTexture(ac);at.wrapS=at.wrapT=THREE.RepeatWrapping;at.colorSpace=THREE.SRGBColorSpace;own.push(at);
   const rm=new THREE.MeshStandardMaterial({...(LOWPOLY.on?{color:'#5d6266',flatShading:true}:{map:at}),roughness:.92,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});own.push(rg,rm);const road=new THREE.Mesh(rg,rm);road.name='suelo:asfalto';road.receiveShadow=true;group.add(road);
   const dG=new THREE.BoxGeometry(.18,.03,2.4),dM=new THREE.MeshStandardMaterial({color:'#f4f1ea',roughness:.7}),pG=new THREE.BoxGeometry(.15,.9,.15),pM=new THREE.MeshStandardMaterial({color:'#c9ccd0'}),lG=new THREE.BoxGeometry(.08,.22,4.2),lM=new THREE.MeshStandardMaterial({color:'#d8dbde',metalness:.3,roughness:.5});own.push(dG,dM,pG,pM,lG,lM);
   const imR=(geo,mat,list)=>{if(!list.length)return;const M=new THREE.InstancedMesh(geo,mat,list.length),o=new THREE.Object3D();list.forEach((p,i)=>{o.position.set(p.x,p.y,p.z);o.rotation.set(0,p.ry,0);o.updateMatrix();M.setMatrixAt(i,o.matrix);});M.castShadow=true;group.add(M);};
   imR(dG,dM,dash);imR(pG,pM,posts);imR(lG,lM,rails);
   if(yel.length){const yG=new THREE.BoxGeometry(.11,.03,1),yM=new THREE.MeshStandardMaterial({color:'#f2c640',roughness:.7}),M=new THREE.InstancedMesh(yG,yM,yel.length),o=new THREE.Object3D();own.push(yG,yM);
    yel.forEach((p,i)=>{o.position.set(p.x,p.y,p.z);o.rotation.set(0,p.ry,0);o.scale.set(1,1,p.len);o.updateMatrix();M.setMatrixAt(i,o.matrix);});group.add(M);}
   // El andén, con la textura de las veredas de la ciudad (losas grises con juntas).
   const sc=document.createElement('canvas');sc.width=sc.height=128;{const g=sc.getContext('2d'),sr=rng(7);g.fillStyle='#c9c5bc';g.fillRect(0,0,128,128);for(let k=0;k<900;k++){g.fillStyle=sr()<.5?'rgba(0,0,0,.07)':'rgba(255,255,255,.1)';g.fillRect(sr()*128,sr()*128,2,2);}
    g.fillStyle='rgba(0,0,0,.16)';for(let k=0;k<128;k+=32){g.fillRect(k,0,1.5,128);g.fillRect(0,k,128,1.5);}}
   const st=new THREE.CanvasTexture(sc);st.wrapS=st.wrapT=THREE.RepeatWrapping;st.colorSpace=THREE.SRGBColorSpace;own.push(st);
   if(wpos.length){const wg=new THREE.BufferGeometry();wg.setAttribute('position',new THREE.Float32BufferAttribute(wpos,3));wg.setAttribute('uv',new THREE.Float32BufferAttribute(wuv,2));wg.setIndex(widx);wg.computeVertexNormals();
    const wm=new THREE.MeshStandardMaterial({...(LOWPOLY.on?{color:'#d6d1c6',flatShading:true}:{map:st}),roughness:.92,side:THREE.DoubleSide});own.push(wg,wm);const wk=new THREE.Mesh(wg,wm);wk.name='suelo:andenes';wk.receiveShadow=true;wk.castShadow=true;group.add(wk);}
   const poleG=new THREE.CylinderGeometry(.07,.1,4.6,8);poleG.translate(0,2.3,0);const armG=new THREE.BoxGeometry(1.25,.08,.08),headG=new THREE.BoxGeometry(.55,.12,.28),poleM=new THREE.MeshStandardMaterial({color:'#3a3f43',metalness:.5,roughness:.5});own.push(poleG,armG,headG,poleM);
   imR(poleG,poleM,lamps);imR(armG,poleM,arms);imR(headG,lampMat,heads);roadLights.push(...heads.map(h=>({x:h.x,y:h.y-.15,z:h.z})));
   // Bajo cada farol, un charco de luz sobre el suelo (como en la ciudad): una malla chica que sigue la calle, el andén o
   // el lote, con un degradé que se suma a lo que hay debajo. Sólo de noche (setNight). No depende de cuántas luces
   // reales alcance a poner el demo: así toda la calle se ve iluminada.
   if(heads.length){const cp=[],cu=[],ci=[],N=4,RAD=5.2;
    const suelo=(x,z)=>{const rd=roadAt(x,z);let y=height(x,z);if(rd&&rd.d<ROAD_W/2)y=Math.max(y,rd.h+.07+(rd.d>ASF/2?CURB_H:0));return y+.04;};
    for(const h of heads){const b=cp.length/3;for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){const x=h.x+(i/N*2-1)*RAD,z=h.z+(j/N*2-1)*RAD;cp.push(x,suelo(x,z),z);cu.push(i/N,j/N);}
     for(let j=0;j<N;j++)for(let i=0;i<N;i++){const a=b+j*(N+1)+i;ci.push(a,a+N+1,a+1,a+1,a+N+1,a+N+2);}}
    const cc=document.createElement('canvas');cc.width=cc.height=128;{const g=cc.getContext('2d'),gr=g.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,'rgba(255,214,150,.6)');gr.addColorStop(.5,'rgba(255,200,120,.22)');gr.addColorStop(1,'rgba(255,190,110,0)');g.fillStyle=gr;g.fillRect(0,0,128,128);}
    const ct=new THREE.CanvasTexture(cc);ct.colorSpace=THREE.SRGBColorSpace;const cg=new THREE.BufferGeometry();cg.setAttribute('position',new THREE.Float32BufferAttribute(cp,3));cg.setAttribute('uv',new THREE.Float32BufferAttribute(cu,2));cg.setIndex(ci);
    const cm=new THREE.MeshBasicMaterial({map:ct,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4});own.push(ct,cg,cm);
    charcos=new THREE.Mesh(cg,cm);charcos.visible=false;charcos.renderOrder=2;group.add(charcos);}}
  // Las terrazas: un bloque de piedra por casilla (sus costados son el muro de contención) con la meseta encima: pasto,
  // plaza o sendero. Donde el sendero o la plaza pasan a una casilla más baja, una escalera de 0,3 m por peldaño.
  {const lotes_=[],tc=I.cells.filter(c=>c.terraza!=null),blocks=[],tops=[],steps=[],key=(x,y)=>x+','+y,byT=new Map(tc.map(c=>[key(c.x,c.y),c]));
   const GRASS='#86ad4f',PLAZA='#d9d2bf',DIRT='#a8865c';
   for(const c of tc){let lo=c.terraza;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const n=byT.get(key(c.x+dx,c.y+dy));const nb=n?n.terraza:landH((c.x+.5+dx*.7)*Cs,(c.y+.5+dy*.7)*Cs);lo=Math.min(lo,nb);}
    if(rampas.has(c.x+','+c.y))continue;// la casilla con rampa la dibujan las calles (rampa + plano), sin bloque
    if(c.lote){lotes_.push(c);continue;}// los lotes de la grilla se dibujan juntos (abajo): un rectángulo por escalón
    const bottom=Math.min(lo,c.terraza)-.8,x=(c.x+.5)*Cs,z=(c.y+.5)*Cs;blocks.push({x,y:(c.terraza+bottom)/2,z,sy:c.terraza-bottom});
    tops.push({x,y:c.terraza+.02,z,color:c.plaza!=null?PLAZA:c.sendero?DIRT:GRASS});
    if(c.sendero||c.plaza!=null)for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const n=byT.get(key(c.x+dx,c.y+dy));if(!n||!(n.sendero||n.plaza!=null)||n.terraza>=c.terraza-.5)continue;
     // Escalera en la casilla de abajo (n), pegada al muro, bajando desde c.
     const dh=c.terraza-n.terraza,k=Math.round(dh/.3),run=.4;for(let i=0;i<k;i++){const t=(i+.5)*run,ex=(n.x+.5)*Cs-dx*(Cs/2-t),ez=(n.y+.5)*Cs-dy*(Cs/2-t),top=c.terraza-(i+1)*dh/k;
      steps.push({x:ex,y:(top+n.terraza)/2,z:ez,sx:dx?run:2.2,sy:top-n.terraza+.02,sz:dy?run:2.2});}}}
   const boxG=new THREE.BoxGeometry(Cs,1,Cs),stoneM=muroDePiedra(),topG=new THREE.BoxGeometry(Cs,.06,Cs),topM=new THREE.MeshStandardMaterial({roughness:.95}),stepG=new THREE.BoxGeometry(1,1,1),stepM=new THREE.MeshStandardMaterial({color:'#b3a894',roughness:.9});own.push(boxG,stoneM,topG,topM,stepG,stepM);
   const im2=(geo,mat,list,colored,nombre='')=>{if(!list.length)return;const M=new THREE.InstancedMesh(geo,mat,list.length);M.name=nombre;const o=new THREE.Object3D(),cc=new THREE.Color();list.forEach((p,i)=>{o.position.set(p.x,p.y,p.z);o.scale.set(p.sx||1,p.sy||1,p.sz||1);o.quaternion.identity();o.updateMatrix();M.setMatrixAt(i,o.matrix);if(colored)M.setColorAt(i,cc.set(p.color));});M.receiveShadow=true;M.castShadow=true;group.add(M);};
   im2(boxG,stoneM,blocks,false,'muro:bloques');im2(topG,topM,tops,true,'suelo:mesetas');im2(stepG,stepM,steps,false,'suelo:peldaños');
   // Los lotes de la grilla, optimizados: cada escalón es un rectángulo de pasto (2 triángulos por rectángulo; las
   // casillas de un mismo escalón se juntan en rectángulos) y el muro va sólo donde el vecino queda más bajo, en tramos
   // largos (las aristas seguidas de un mismo muro, con la misma altura arriba y abajo, se juntan en un solo cuadro).
   if(lotes_.length){const tp=[],wp=[],grp=c=>(c.manzana||'')+'|'+c.terraza,byL=new Map(lotes_.map(c=>[key(c.x,c.y),c])),visto=new Set();
    const quadUp=(x0,z0,x1,z1,y)=>{tp.push(x0,y,z0,x0,y,z1,x1,y,z0,x1,y,z0,x0,y,z1,x1,y,z1);};
    for(const c of [...lotes_].sort((a,b)=>a.y-b.y||a.x-b.x)){if(visto.has(key(c.x,c.y)))continue;const g=grp(c),same=(x,y)=>{const n=byL.get(key(x,y));return n&&grp(n)===g&&!visto.has(key(x,y));};
     let x1=c.x;while(same(x1+1,c.y))x1++;let y1=c.y;for(;;){let ok=true;for(let x=c.x;x<=x1;x++)if(!same(x,y1+1)){ok=false;break;}if(!ok)break;y1++;}
     for(let y=c.y;y<=y1;y++)for(let x=c.x;x<=x1;x++)visto.add(key(x,y));quadUp(c.x*Cs,c.y*Cs,(x1+1)*Cs,(y1+1)*Cs,c.terraza+.05);}
    // Los muros: por arista de casilla, si lo de al lado queda más bajo (otro escalón, la calle o el terreno).
    const tramos=new Map();
    for(const c of lotes_){const top=c.terraza+.05;
     for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nk=key(c.x+dx,c.y+dy),n=byL.get(nk);if(n&&grp(n)===grp(c))continue;
      const mx=(c.x+.5+dx*.5)*Cs,mz=(c.y+.5+dy*.5)*Cs,ox=mx+dx*.6,oz=mz+dy*.6;let nb;
      if(n)nb=n.terraza+.05;else if(rampas.has(nk))nb=rampas.get(nk).orig+.05;else{const rd=roadAt(ox,oz);nb=rd&&rd.d<ROAD_W/2+.2?rd.h+.07+CURB_H:height(ox,oz);}
      // (la calle de al lado más alta que el lote —la mitad de abajo junto a una calle que sube—: el muro va del andén hasta
      // el lote, mirando al lote; antes no había nada y se veía el terreno bajado, «un hueco»)
      // (con el borde de arriba siguiendo al andén en las dos puntas de la arista —la calle sube—: plano, quedaba una franja
      // sin cubrir de hasta 25 cm —validar-empalmes, 2026-10-16—)
      // (contra una calle —el andén sube o baja a lo largo de la arista—: UNA cara que en cada punta va de lo más bajo a lo
      // más alto de las dos, el lote o el andén: plana, quedaba una franja sin cubrir de hasta 25 cm —validar-empalmes—)
      if(SIN_HUECOS&&!n&&!rampas.has(nk)){const rd=roadAt(ox,oz);if(rd&&rd.d<ROAD_W/2+.2){const v=(dx?(c.x+(dx>0?1:0)):(c.y+(dy>0?1:0)))*Cs,a0=(dx?c.y:c.x)*Cs,a1=a0+Cs,pt=a=>dx?[v,a]:[a,v],
        ar=a=>{const [px,pz]=pt(a),r=roadAt(px+dx*.6,pz+dy*.6);return r&&r.d<ROAD_W/2+.2?r.h+.07+CURB_H:nb;},sA=ar(a0+.001),sB=ar(a1-.001);
        if(Math.max(Math.abs(sA-top),Math.abs(sB-top))>.02){const [xa,za]=pt(a0),[xb,zb]=pt(a1),tA=Math.max(top,sA),tB=Math.max(top,sB),bA=Math.min(top,sA)-.2,bB=Math.min(top,sB)-.2;
         wp.push(xa,tA,za,xa,bA,za,xb,tB,zb,xb,tB,zb,xa,bA,za,xb,bB,zb);}continue;}}
      if(nb>top-.1)continue;const bot=nb-.2,lin=dx?'x'+(c.x+(dx>0?1:0)):'z'+(c.y+(dy>0?1:0)),k=lin+'|'+dx+','+dy+'|'+top.toFixed(2)+'|'+bot.toFixed(2);
      (tramos.get(k)||tramos.set(k,[]).get(k)).push(dx?c.y:c.x);}}
    for(const [k,list] of tramos){const [lin,d,topS,botS]=k.split('|'),[dx,dy]=d.split(',').map(Number),top=+topS,bot=+botS,v=+lin.slice(1)*Cs;list.sort((a,b)=>a-b);
     for(let i=0;i<list.length;){let j=i;while(j+1<list.length&&list[j+1]===list[j]+1)j++;const a=list[i]*Cs,b=(list[j]+1)*Cs;
      if(dx){wp.push(v,top,a,v,bot,a,v,top,b,v,top,b,v,bot,a,v,bot,b);}else{wp.push(a,top,v,a,bot,v,b,top,v,b,top,v,a,bot,v,b,bot,v);}i=j+1;}}
    const tg=new THREE.BufferGeometry();tg.setAttribute('position',new THREE.Float32BufferAttribute(tp,3));tg.computeVertexNormals();const tm=new THREE.MeshStandardMaterial({color:GRASS,roughness:.95,side:THREE.DoubleSide});
    const wg=new THREE.BufferGeometry();wg.setAttribute('position',new THREE.Float32BufferAttribute(wp,3));wg.computeVertexNormals();const wm=muroDePiedra();wm.side=THREE.DoubleSide;own.push(tg,tm,wg,wm);
    const tk=new THREE.Mesh(tg,tm),wk=new THREE.Mesh(wg,wm);tk.name='suelo:lotes';wk.name='muro:lotes';tk.receiveShadow=true;wk.receiveShadow=true;wk.castShadow=true;group.add(tk,wk);
    lotesTri={pasto:tp.length/9,muros:wp.length/9};}}
  if(I.globo){const {x,y:z}=I.globo,y0=height(x,z),gl=new THREE.Group(),mats=[new THREE.MeshStandardMaterial({color:'#e0503a',roughness:.7}),new THREE.MeshStandardMaterial({color:'#f2d06b',roughness:.7}),new THREE.MeshStandardMaterial({color:'#8a6a4c',roughness:.9}),new THREE.MeshStandardMaterial({color:'#3b3b3b'})];
   const env=new THREE.SphereGeometry(4,16,12),stripe=new THREE.SphereGeometry(4.05,16,12,0,Math.PI*2,Math.PI*.42,Math.PI*.16),basket=new THREE.BoxGeometry(1.6,1.1,1.6),rope=new THREE.CylinderGeometry(.03,.03,5.6,4);own.push(env,stripe,basket,rope,...mats);
   const e=new THREE.Mesh(env,mats[0]);e.scale.set(1,1.18,1);e.position.y=9.4;const sb=new THREE.Mesh(stripe,mats[1]);sb.scale.set(1,1.18,1);sb.position.y=9.4;const b=new THREE.Mesh(basket,mats[2]);b.position.y=.55;
   gl.add(e,sb,b);for(const [a,c] of [[1,1],[1,-1],[-1,1],[-1,-1]]){const rp=new THREE.Mesh(rope,mats[3]);rp.position.set(a*.9,3.6,c*.9);rp.rotation.set(c*.18,0,-a*.18);gl.add(rp);}
   gl.position.set(x,y0,z);gl.traverse(o=>{if(o.isMesh)o.castShadow=true;});group.add(gl);}
  if(I.parapente){const {x,y:z}=I.parapente,y0=height(x,z),pg=new THREE.Group(),wingM=new THREE.MeshStandardMaterial({color:'#4f7fa8',roughness:.6,side:THREE.DoubleSide}),postM=new THREE.MeshStandardMaterial({color:'#7a5a3a'});
   const wing=new THREE.SphereGeometry(3.4,18,8,0,Math.PI*2,0,Math.PI/2),post=new THREE.CylinderGeometry(.08,.08,2.2,6),flag=new THREE.BoxGeometry(.9,.5,.04);own.push(wing,post,flag,wingM,postM);
   // El ala tendida en el suelo, como una cúpula aplanada (ancha de lado a lado, angosta hacia el borde).
   const wm=new THREE.Mesh(wing,wingM);wm.scale.set(1,.22,.42);wm.position.set(0,.15,0);const pm=new THREE.Mesh(post,postM);pm.position.set(2.6,1.1,1.6);const fm=new THREE.Mesh(flag,wingM);fm.position.set(3.05,2,1.6);
   // Mirando al vacío y apoyado en la pendiente.
   // El ala, apoyada en la pendiente; el poste con el banderín, derecho (sólo gira hacia el vacío), clavado donde cae.
   const yaw=Math.atan2(x-cx,z-cz),post0=new THREE.Vector3(2.6,0,1.6).applyAxisAngle(UP,yaw),fx=x+post0.x,fz=z+post0.z,fy=height(fx,fz);
   pm.position.set(0,1.1,0);fm.position.set(.45,1.9,0);const flagG=new THREE.Group();flagG.add(pm,fm);flagG.position.set(fx,fy,fz);flagG.rotation.y=yaw;
   pg.add(wm);pg.position.set(x,y0,z);pg.quaternion.copy(tilt(x,z,2)).multiply(new THREE.Quaternion().setFromAxisAngle(UP,yaw));
   for(const G of [pg,flagG]){G.traverse(o=>{if(o.isMesh)o.castShadow=true;});group.add(G);}}}
 // El suelo de un punto: lo más alto que se dibuja ahí (asfalto, andén, rampa o relleno) o, si no hay nada, el terreno.
 // El terreno que se ve (2026-10-16, medido en el navegador: los pies flotaban o se hundían hasta ~1 m en el monte y junto a
 // las calles): la altura de la malla misma —los vértices de meshH, con la diagonal que usa cada cuadro—, no la de la
 // fórmula. Afuera de la grilla, la de siempre.
 // (con los vértices de verdad —VX, VZ: junto al borde se corren al contorno—: el punto se busca en los dos triángulos de
 // su cuadro y en los de los vecinos, por baricéntricas)
 const terrenoEn=(x,z)=>{const fi=(x-x0)/step,fj=(z-z0)/step,i0=Math.floor(fi),j0=Math.floor(fj);
  for(const [di,dj] of [[0,0],[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]){const i=i0+di,j=j0+dj;if(i<0||j<0||i>=n||j>=n)continue;
   const P=(ii,jj)=>{const k=jj*(n+1)+ii;return [VX[k],Hh[k],VZ[k]];},a=P(i,j),b=P(i+1,j),d=P(i,j+1),e=P(i+1,j+1);
   for(const [A,B,C] of (i+j)%2?[[a,d,b],[b,d,e]]:[[a,d,e],[a,e,b]]){const det=(B[2]-C[2])*(A[0]-C[0])+(C[0]-B[0])*(A[2]-C[2]);if(Math.abs(det)<1e-9)continue;
    const w1=((B[2]-C[2])*(x-C[0])+(C[0]-B[0])*(z-C[2]))/det,w2=((C[2]-A[2])*(x-C[0])+(A[0]-C[0])*(z-C[2]))/det,w3=1-w1-w2;
    if(w1>=-1e-6&&w2>=-1e-6&&w3>=-1e-6)return w1*A[1]+w2*B[1]+w3*C[1];}}
  return height(x,z);};
 // la terraza de un punto (sin las casillas con rampa: ahí manda la rampa dibujada): su nivel, y si es lote (meseta a 5 cm)
 const loteDe=new Set((plan?.isla?.cells||[]).filter(c=>c.lote).map(c=>c.x+','+c.y));
 const enTerraza=(x,z)=>{const k=Math.floor(x/6)+','+Math.floor(z/6);if(rampas.has(k))return null;const v=ter.get(k);if(v==null)return null;const o=new Number(v);o.lote=loteDe.has(k);return o;};
 const sueloEn=(x,z)=>{let best=-Infinity;if(superficie){const {T,grid,SC}=superficie,L=grid.get(Math.floor(x/SC)+','+Math.floor(z/SC));
   if(L)for(const t of L){const ax=T[t],az=T[t+2],bx=T[t+3],bz=T[t+5],cx_=T[t+6],cz_=T[t+8],d=(bz-cz_)*(ax-cx_)+(cx_-bx)*(az-cz_);if(Math.abs(d)<1e-9)continue;
    const w1=((bz-cz_)*(x-cx_)+(cx_-bx)*(z-cz_))/d,w2=((cz_-az)*(x-cx_)+(ax-cx_)*(z-cz_))/d,w3=1-w1-w2;if(w1<-1e-4||w2<-1e-4||w3<-1e-4)continue;
    const y=w1*T[t+1]+w2*T[t+4]+w3*T[t+7];if(y>best)best=y;}
   if(best>-Infinity&&!enTerraza(x,z))return best;}
  // (2026-10-16, Miguel: «la colisión de los pisos de los escalones se cae»: sobre una terraza se pisa la terraza —su
  // meseta dibujada—, no la malla del terreno, que debajo queda bajada hasta la terraza vecina más baja: con muros de 6 m
  // el jugador caía 6 m y quedaba debajo del pasto)
  const tv=enTerraza(x,z);if(tv!=null){const top=tv+(tv.lote?.05:.02);return superficie&&best>-Infinity?Math.max(best,top):top;}
  return terrenoEn(x,z);};
 return {lights:roadLights,superficie,lotesTri:()=>lotesTri,casaDentro:(x,z)=>{const hf=houseFloor(x,z);return hf?.inside&&hf.h.casaIdx!=null?hf.h.casaIdx:null;},rampaEn:(cx,cy)=>rampas.has(cx+','+cy),techo:(x,z)=>{const r=rampas.get(Math.floor(x/6)+','+Math.floor(z/6));return Math.max(sueloEn(x,z),r?r.orig:-Infinity);},group,seats,sleeps,insideHouse:(x,z)=>!!houseFloor(x,z)?.inside,setEdges(on){for(const m of edgeMeshes)m.userData.edges=on;},landmarks:modelHouses,plots,update,updateDoors,setNight,dispose,walkable,where,houses,spot,doorPath,names:{beaches:beaches.map(b=>b.name),cerros:sectors.map(s=>s.name)},ground:(x,z,feet)=>{const hf=houseFloor(x,z);if(!hf)return sueloEn(x,z);if(!hf.inside)return hf.h.base;const [lx,lz]=local(hf.h,x,z);return insideFloor(hf.h,lx,lz,feet);},height:(x,z)=>beyond(x,z)>0?-Infinity:sueloEn(x,z),agua,water:WATER};
}
