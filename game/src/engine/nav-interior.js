/* La navegación dentro de los edificios y las casas (FUGA, 2026-10-15): por cada piso, una grilla fina donde se puede
   parar el personaje (medidas.js CIRCULACION.peaton.radio): los muros son los bordes entre espacios distintos (cuartos,
   pasillos, núcleo) y con la fachada, con su espesor más el radio; las puertas abren ese borde (el paso libre de una
   puerta queda en su ancho menos dos radios); los muebles y el ascensor estorban, también inflados por el radio. Se entra
   por las puertas de calle y se sube por la escalera (el núcleo en los edificios; el cuarto «escalera» en las casas).
   Devuelve, por piso, qué parte de cada cuarto se alcanza caminando desde la calle. */
import {CIRCULACION as C,MURO} from './medidas.js';

const RES=.1,R=C.peaton.radio,T=MURO.tabique;
// Los cuartos que se abren al pasillo sin tabique (los mismos que el validador de la ciudad: validar-ciudad ABIERTOS).
const ABIERTOS=new Set(['abierta','recepcion','lectura','prestamo','comedor']);

// Un piso genérico: espacios (rects con id y tipo), puertas (segmentos alineados con su par de espacios), estorbos (rects).
// Devuelve la grilla: dueño de cada celda (índice de espacio o -1), libre (Uint8), y funciones para sembrar y recorrer.
function grillaPiso({x0,z0,x1,z1},espacios,puertas,estorbos){
 const nx=Math.ceil((x1-x0)/RES),nz=Math.ceil((z1-z0)/RES),N=nx*nz,dueno=new Int16Array(N).fill(-1),libre=new Uint8Array(N);
 for(const [k,e] of espacios.entries()){const i0=Math.max(0,Math.round((e.x0-x0)/RES)),i1=Math.min(nx,Math.round((e.x1-x0)/RES)),j0=Math.max(0,Math.round((e.z0-z0)/RES)),j1=Math.min(nz,Math.round((e.z1-z0)/RES));
  for(let j=j0;j<j1;j++)for(let i=i0;i<i1;i++)dueno[j*nx+i]=k;}
 // los bordes: una celda cuyo vecino tiene otro dueño (o ninguno), salvo entre un cuarto abierto y un pasillo
 const abierto=(a,b)=>a>=0&&b>=0&&(espacios[a].abre&&espacios[b].tipo==='pasillo'||espacios[b].abre&&espacios[a].tipo==='pasillo'||espacios[a].grupo!=null&&espacios[a].grupo===espacios[b].grupo);
 const borde=new Uint8Array(N);
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const k=j*nx+i,a=dueno[k];if(a<0){borde[k]=1;continue;}
  for(const [di,dj] of [[1,0],[0,1],[-1,0],[0,-1]]){const ii=i+di,jj=j+dj,b=ii<0||jj<0||ii>=nx||jj>=nz?-1:dueno[jj*nx+ii];if(b!==a&&!abierto(a,b)){borde[k]=1;break;}}}
 // las puertas abren el borde: en su largo y a ambos lados de la línea
 for(const d of puertas){const h=Math.abs(d.z1-d.z0)<1e-6,a0=h?Math.min(d.x0,d.x1):Math.min(d.z0,d.z1),a1=h?Math.max(d.x0,d.x1):Math.max(d.z0,d.z1),at=h?d.z0:d.x0,e=T/2+RES*1.5;
  const [i0,i1,j0,j1]=h?[(a0-x0)/RES,(a1-x0)/RES,(at-e-z0)/RES,(at+e-z0)/RES]:[(at-e-x0)/RES,(at+e-x0)/RES,(a0-z0)/RES,(a1-z0)/RES];
  for(let j=Math.max(0,Math.floor(j0));j<Math.min(nz,Math.ceil(j1));j++)for(let i=Math.max(0,Math.floor(i0));i<Math.min(nx,Math.ceil(i1));i++)if(dueno[j*nx+i]>=0)borde[j*nx+i]=0;}
 // libre: con dueño y a más de (tabique/2 + radio) de un borde, y fuera de los estorbos inflados por el radio
 for(let k=0;k<N;k++)libre[k]=dueno[k]>=0?1:0;
 const rr=Math.ceil((T/2+R)/RES),disco=[];for(let dj=-rr;dj<=rr;dj++)for(let di=-rr;di<=rr;di++)if(Math.hypot(di,dj)*RES<=T/2+R+1e-9)disco.push([di,dj]);
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){if(!borde[j*nx+i])continue;for(const [di,dj] of disco){const ii=i+di,jj=j+dj;if(ii>=0&&jj>=0&&ii<nx&&jj<nz)libre[jj*nx+ii]=0;}}
 for(const e of estorbos){const i0=Math.max(0,Math.floor((e.x0-R-x0)/RES)),i1=Math.min(nx,Math.ceil((e.x1+R-x0)/RES)),j0=Math.max(0,Math.floor((e.z0-R-z0)/RES)),j1=Math.min(nz,Math.ceil((e.z1+R-z0)/RES));
  for(let j=j0;j<j1;j++)for(let i=i0;i<i1;i++){const cx=x0+(i+.5)*RES,cz=z0+(j+.5)*RES,dx=Math.max(e.x0-cx,0,cx-e.x1),dz=Math.max(e.z0-cz,0,cz-e.z1);if(Math.hypot(dx,dz)<R)libre[j*nx+i]=0;}}
 const idx=(x,z)=>{const i=Math.floor((x-x0)/RES),j=Math.floor((z-z0)/RES);return i<0||j<0||i>=nx||j>=nz?-1:j*nx+i;};
 return {nx,nz,x0,z0,dueno,libre,idx};}

// Recorre un piso desde unas semillas (índices de celda; cada una se corre a la libre más cercana a ≤ 0,6 m). Devuelve
// la distancia en celdas (Int32Array, -1 sin llegar).
function recorrer(g,semillas){const {nx,nz,libre}=g,dist=new Int32Array(nx*nz).fill(-1),q=new Int32Array(nx*nz);let h=0,t=0;
 for(const s of semillas){if(s<0)continue;let s0=-1;const si=s%nx,sj=(s-si)/nx;for(let r=0;r<=6&&s0<0;r++)for(let dj=-r;dj<=r&&s0<0;dj++)for(let di=-r;di<=r;di++){const ii=si+di,jj=sj+dj;if(ii<0||jj<0||ii>=nx||jj>=nz)continue;const k=jj*nx+ii;if(libre[k]){s0=k;break;}}
  if(s0>=0&&dist[s0]<0){dist[s0]=0;q[t++]=s0;}}
 while(h<t){const k=q[h++],i=k%nx,j=(k-i)/nx;for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){const ii=i+di,jj=j+dj;if(ii<0||jj<0||ii>=nx||jj>=nz)continue;const k2=jj*nx+ii;if(!libre[k2]||dist[k2]>=0)continue;dist[k2]=dist[k]+1;q[t++]=k2;}}
 return dist;}

// El resumen de un piso: por espacio, celdas libres y alcanzadas.
function resumen(g,dist,espacios){const tot=new Int32Array(espacios.length),alc=new Int32Array(espacios.length);let lejos=0;
 for(let k=0;k<g.dueno.length;k++){const a=g.dueno[k];if(a<0||!g.libre[k])continue;tot[a]++;if(dist[k]>=0){alc[a]++;lejos=Math.max(lejos,dist[k]);}}
 return espacios.map((e,k)=>({id:e.id,tipo:e.tipo,libres:tot[k]*RES*RES,alcanzado:alc[k]*RES*RES})).concat([]).map(o=>o)&&{espacios:espacios.map((e,k)=>({id:e.id,tipo:e.tipo,libres:+(tot[k]*RES*RES).toFixed(2),alcanzado:+(alc[k]*RES*RES).toFixed(2)})),lejos:lejos*RES};}

// (lo que estorba al caminar: lo que choca según CHOQUE_MUEBLE —medidas.js—; lo pisable también: se rodea)
import {CHOQUE_MUEBLE} from './medidas.js';
const estorba=f=>(CHOQUE_MUEBLE[f.kind]?.choque??'solido')!=='ninguno';
// ---- Un edificio del plano (blueprint: L.levels con rooms, corridor, core, liftRect, doors, furniture) ----
export function navEdificio(L){const p0=L.parts,bx={x0:Math.min(...p0.map(p=>p.x))-.5,z0:Math.min(...p0.map(p=>p.y))-.5,x1:Math.max(...p0.map(p=>p.x+p.w))+.5,z1:Math.max(...p0.map(p=>p.y+p.h))+.5};
 const pisos=[];let semNucleo=null;
 for(const lv of [...L.levels].sort((a,b)=>a.level-b.level)){
  const espacios=[...lv.rooms.map(q=>({id:'r'+q.id,tipo:q.type,abre:ABIERTOS.has(q.type),x0:q.x,x1:q.x+q.w,z0:q.y,z1:q.y+q.h})),...(lv.corridor||[]).map((c,i)=>({id:'c'+i,tipo:'pasillo',grupo:'pasillo',x0:c.x,x1:c.x+c.w,z0:c.y,z1:c.y+c.h})),...(lv.core?[{id:'nucleo',tipo:'nucleo',x0:lv.core.x,x1:lv.core.x+lv.core.w,z0:lv.core.y,z1:lv.core.y+lv.core.h}]:[])];
  const puertas=(lv.doors||[]).map(d=>({x0:d.x0,z0:d.y0,x1:d.x1,z1:d.y1,calle:!!d.street}));
  const estorbos=[...(lv.furniture||[]).filter(estorba).map(f=>({x0:f.x,x1:f.x+f.w,z0:f.y,z1:f.y+f.h})),...(lv.liftRect?[{x0:lv.liftRect.x,x1:lv.liftRect.x+lv.liftRect.w,z0:lv.liftRect.y,z1:lv.liftRect.y+lv.liftRect.h}]:[])];
  const g=grillaPiso(bx,espacios,puertas,estorbos);
  // semillas: las puertas de calle (del lado de adentro) en planta baja; arriba, el núcleo alcanzado en el piso de abajo
  const sem=[];if(lv.level===0)for(const d of puertas.filter(d=>d.calle)){const mx=(d.x0+d.x1)/2,mz=(d.z0+d.z1)/2,h=Math.abs(d.z1-d.z0)<1e-6;for(const s of [-1,1]){const k=g.idx(h?mx:mx+s*.5,h?mz+s*.5:mz);if(k>=0&&g.dueno[k]>=0)sem.push(k);}}
  if(lv.level>0&&semNucleo)for(const [x,z] of semNucleo)sem.push(g.idx(x,z));
  const dist=recorrer(g,sem),res=resumen(g,dist,espacios);
  // el núcleo alcanzado: de ahí se sube (la escalera)
  semNucleo=[];for(let k=0;k<dist.length;k++)if(dist[k]>=0&&espacios[g.dueno[k]]?.tipo==='nucleo'){const i=k%g.nx,j=(k-i)/g.nx;semNucleo.push([g.x0+(i+.5)*RES,g.z0+(j+.5)*RES]);}
  pisos.push({nivel:lv.level,...res,puertas:puertas.map(d=>Math.hypot(d.x1-d.x0,d.z1-d.z0)),g,dist});}
 return pisos;}

// ---- Una casa del monte (hogar.js: niveles en u, v con rooms, doors, furniture; el cuarto «escalera» sube) ----
export function navCasa(h){return h.spec?.hogar?navHogar(h.spec.hogar):[];}
// (el plano de una casa —hogar.js—, en su marco: u, v)
export function navHogar(P){const bx={x0:-.5,z0:-.5,x1:P.W+.5,z1:P.D+.5},pisos=[];let semEsc=null;
 for(const lv of P.levels){
  const espacios=lv.rooms.map(q=>({id:'r'+q.id,tipo:q.type,x0:q.u0,x1:q.u1,z0:q.v0,z1:q.v1}));
  const puertas=(lv.doors||[]).map(d=>d.axis==='u'?{x0:d.from,x1:d.from+d.len,z0:d.at,z1:d.at,calle:d.b==='calle'||!!d.street}:{x0:d.at,x1:d.at,z0:d.from,z1:d.from+d.len,calle:d.b==='calle'||!!d.street});
  const estorbos=(lv.furniture||[]).filter(estorba).map(f=>({x0:f.u0,x1:f.u1,z0:f.v0,z1:f.v1}));
  const g=grillaPiso(bx,espacios,puertas,estorbos),sem=[];
  if(lv.level===0)for(const d of puertas.filter(d=>d.calle)){const mx=(d.x0+d.x1)/2,mz=(d.z0+d.z1)/2,hz=Math.abs(d.z1-d.z0)<1e-6;for(const s of [-1,1]){const k=g.idx(hz?mx:mx+s*.5,hz?mz+s*.5:mz);if(k>=0&&g.dueno[k]>=0)sem.push(k);}}
  if(lv.level>0&&semEsc)for(const [x,z] of semEsc)sem.push(g.idx(x,z));
  const dist=recorrer(g,sem),res=resumen(g,dist,espacios);
  semEsc=[];for(let k=0;k<dist.length;k++)if(dist[k]>=0&&espacios[g.dueno[k]]?.tipo==='escalera'){const i=k%g.nx,j=(k-i)/g.nx;semEsc.push([g.x0+(i+.5)*RES,g.z0+(j+.5)*RES]);}
  pisos.push({nivel:lv.level,...res,puertas:puertas.map(d=>Math.hypot(d.x1-d.x0,d.z1-d.z0)),g,dist});}
 return pisos;}
export const NAV_RES=RES;

// El ancho efectivo de los pasos (2026-10-16, Miguel: «los pasillos en algunos lugares son muy estrechos»): en la grilla de
// un piso, la distancia de cada celda libre a la más cercana que no lo es (las paredes y los muebles ya inflados por el
// radio); el ancho libre de una sección es 2·(radio + esa distancia en su centro). Por espacio de paso (pasillo, hall),
// a lo largo de su eje —a más de bordes m de sus puntas—, el más angosto: {id, tipo, ancho, x, z}.
export function anchosDePaso(piso,espacios,{tipos=['pasillo','hall'],bordes=.6}={}){const g=piso.g,{nx,nz,libre}=g,N=nx*nz,dt=new Int32Array(N).fill(1e9),q=new Int32Array(N);let h=0,t=0;
 for(let k=0;k<N;k++)if(!libre[k]){dt[k]=0;q[t++]=k;}
 while(h<t){const k=q[h++],i=k%nx,j=(k-i)/nx;for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){const ii=i+di,jj=j+dj;if(ii<0||jj<0||ii>=nx||jj>=nz)continue;const k2=jj*nx+ii;if(dt[k2]>dt[k]+1){dt[k2]=dt[k]+1;q[t++]=k2;}}}
 const out=[];
 espacios.forEach((e,ei)=>{if(!tipos.includes(e.tipo))return;const largoX=e.x1-e.x0>=e.z1-e.z0,L0=largoX?e.x0:e.z0,L1=largoX?e.x1:e.z1,A0=largoX?e.z0:e.x0,A1=largoX?e.z1:e.x1;let peor=null;
  for(let u=L0+bordes;u<=L1-bordes;u+=RES){let mx=0,ma=null;for(let a=A0;a<=A1;a+=RES){const k=g.idx(largoX?u:a,largoX?a:u);if(k<0||g.dueno[k]!==ei||!libre[k])continue;if(dt[k]>mx){mx=dt[k];ma=a;}}
   if(ma==null)continue;const ancho=2*(R+(mx-.5)*RES);if(!peor||ancho<peor.ancho)peor={id:e.id,tipo:e.tipo,ancho:+ancho.toFixed(2),x:+(largoX?u:ma).toFixed(2),z:+(largoX?ma:u).toFixed(2)};}
  if(peor)out.push(peor);});
 return out;}
export function espaciosDeLote(L,nivel=0){const lv=L.levels.find(l=>l.level===nivel);return [...lv.rooms.map(q=>({id:'r'+q.id,tipo:q.type,x0:q.x,x1:q.x+q.w,z0:q.y,z1:q.y+q.h})),...(lv.corridor||[]).map((c,i)=>({id:'c'+i,tipo:'pasillo',x0:c.x,x1:c.x+c.w,z0:c.y,z1:c.y+c.h})),...(lv.core?[{id:'nucleo',tipo:'nucleo',x0:lv.core.x,x1:lv.core.x+lv.core.w,z0:lv.core.y,z1:lv.core.y+lv.core.h}]:[])];}
export function espaciosDeHogar(P,nivel=0){const lv=P.levels.find(l=>l.level===nivel);return lv.rooms.map(q=>({id:'r'+q.id,tipo:q.type,x0:q.u0,x1:q.u1,z0:q.v0,z1:q.v1}));}
