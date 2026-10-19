/* El mapa del juego (2026-10-17): el motor nuevo del modo «Botín» juega sobre el mundo de verdad —la ciudad y el monte,
   en metros—, no sobre la grilla de 6 m del laboratorio (game.js, que sólo tenía la planta baja de la ciudad).
   Sobre la grilla peatonal fina (circulacion.js, celdas de medio metro con su altura y su paso: escalones, pendientes,
   muros del monte) arma una grilla de RUTAS de RUTA m: una celda gruesa es libre si lo es la mayoría de sus celdas finas, y
   dos vecinas se unen si en algún punto de su borde se pasa de una a otra (el paso fino). En ella se calculan los caminos
   de los bots (un campo de distancias por destino, en milisegundos) y la vista (lo que tapa un edificio).
   Los interiores no se recorren celda a celda: una vivienda, una guarida o un objetivo se usa desde sus puertas (sus
   puntos de afuera) y adentro se cuenta el tiempo. */
import {grillaPeatonal} from '../circulacion.js';
import {CALLE} from '../medidas.js';

export const RUTA=2;// m por celda de ruta (4 × 4 celdas finas de medio metro)
export const CALZADA=4;// (2026-10-17) cuánto más «cuesta» un metro de calzada que uno de vereda, para la gente de la sociedad:
// camina por la vereda y cruza por las cebras (los bots del modo «Botín» siguen con su campo en metros)

export function mapaDeJuego(bp,g=grillaPeatonal(bp)){const f=Math.round(RUTA/g.celda),nx=Math.ceil(g.nx/f),nz=Math.ceil(g.nz/f),N=nx*nz,X0=g.X0,Z0=g.Z0;
 const libre=new Uint8Array(N),alto=new Float32Array(N);
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){let n=0,t=0,h=0;for(let b=0;b<f;b++)for(let a=0;a<f;a++){const I=i*f+a,J=j*f+b;if(I>=g.nx||J>=g.nz)continue;t++;const k=J*g.nx+I;if(g.libre[k]){n++;h+=g.alto[k];}}
  const k=j*nx+i;libre[k]=n*2>t?1:0;alto[k]=n?h/n:0;}
 // los pasos: E (i→i+1) y S (j→j+1); hay paso si alguna pareja de celdas finas del borde se pasa
 const pE=new Uint8Array(N),pS=new Uint8Array(N);
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const k=j*nx+i;if(!libre[k])continue;
  if(i+1<nx&&libre[k+1]){const I=i*f+f-1;if(I+1<g.nx)for(let b=0;b<f;b++){const J=j*f+b;if(J>=g.nz)break;const a=J*g.nx+I;if(g.paso(a,a+1,g.celda)){pE[k]=1;break;}}}
  if(j+1<nz&&libre[k+nx]){const J=j*f+f-1;if(J+1<g.nz)for(let a=0;a<f;a++){const I=i*f+a;if(I>=g.nx)break;const q=J*g.nx+I;if(g.paso(q,q+g.nx,g.celda)){pS[k]=1;break;}}}}
 const idx=(x,z)=>{const i=Math.floor((x-X0)/RUTA),j=Math.floor((z-Z0)/RUTA);return i<0||j<0||i>=nx||j>=nz?-1:j*nx+i;};
 const centro=k=>{const i=k%nx,j=(k-i)/nx;return {x:X0+(i+.5)*RUTA,z:Z0+(j+.5)*RUTA};};
 // los vecinos de una celda (8, en diagonal sólo si las dos rectas pasan): [vecino, largo]
 const vecinos=k=>{const i=k%nx,out=[];const e=i+1<nx&&pE[k],w=i>0&&pE[k-1],s=k+nx<N&&pS[k],n=k-nx>=0&&pS[k-nx];
  if(e)out.push([k+1,RUTA]);if(w)out.push([k-1,RUTA]);if(s)out.push([k+nx,RUTA]);if(n)out.push([k-nx,RUTA]);
  const D=RUTA*Math.SQRT2;
  if(e&&s&&pS[k+1]&&pE[k+nx])out.push([k+nx+1,D]);if(w&&s&&pS[k-1]&&pE[k+nx-1])out.push([k+nx-1,D]);
  if(e&&n&&pS[k-nx+1]&&pE[k-nx])out.push([k-nx+1,D]);if(w&&n&&pS[k-nx-1]&&pE[k-nx-1])out.push([k-nx-1,D]);return out;};
 // la celda libre más cercana a un punto (las puertas quedan junto a la pared: su celda gruesa puede ser del edificio)
 const cerca=(x,z)=>{const k0=idx(x,z);if(k0<0)return -1;if(libre[k0])return k0;const i0=k0%nx,j0=(k0-i0)/nx;let best=-1,bd=1e9;
  for(let r=1;r<=3;r++){for(let j=j0-r;j<=j0+r;j++)for(let i=i0-r;i<=i0+r;i++){if(i<0||j<0||i>=nx||j>=nz)continue;const k=j*nx+i;if(!libre[k])continue;const c=centro(k),d=Math.hypot(c.x-x,c.z-z);if(d<bd){bd=d;best=k;}}if(best>=0)return best;}return -1;};
 // un campo de distancias (m) desde varios puntos: Dijkstra con un montículo sobre arreglos tipados
 function campo(puntos,costo=null){const dist=new Float32Array(N).fill(Infinity),heap=new Int32Array(N),pos=new Int32Array(N).fill(-1);let n=0;
  const sube=i=>{const k=heap[i],d=dist[k];while(i>0){const p=(i-1)>>1;if(dist[heap[p]]<=d)break;heap[i]=heap[p];pos[heap[i]]=i;i=p;}heap[i]=k;pos[k]=i;};
  const baja=i=>{const k=heap[i],d=dist[k];for(;;){const l=2*i+1,r=l+1;let s=i,ds=d;if(l<n&&dist[heap[l]]<ds){s=l;ds=dist[heap[l]];}if(r<n&&dist[heap[r]]<ds)s=r;if(s===i)break;heap[i]=heap[s];pos[heap[i]]=i;i=s;}heap[i]=k;pos[k]=i;};
  for(const [x,z] of puntos){const k=cerca(x,z);if(k<0||dist[k]===0)continue;dist[k]=0;heap[n]=k;pos[k]=n;n++;sube(n-1);}
  while(n){const k=heap[0];pos[k]=-2;n--;if(n){heap[0]=heap[n];pos[heap[0]]=0;baja(0);}const d=dist[k];
   for(const [k2,w] of vecinos(k)){if(pos[k2]===-2)continue;const dd=d+(costo?w*(costo[k]+costo[k2])/2:w);if(dd>=dist[k2])continue;dist[k2]=dd;if(pos[k2]<0){heap[n]=k2;pos[k2]=n;n++;sube(n-1);}else sube(pos[k2]);}}
  return dist;}
 // el paso siguiente desde (x, z) bajando por un campo: la vecina con menos distancia (o null si ya llegó o no hay camino)
 const siguiente=(dist,x,z)=>{const k=cerca(x,z);if(k<0||!isFinite(dist[k]))return null;if(dist[k]===0)return null;let best=null,bd=dist[k];for(const [k2] of vecinos(k))if(dist[k2]<bd){bd=dist[k2];best=k2;}return best==null?null:centro(best);};
 const distEn=(dist,x,z)=>{const k=cerca(x,z);return k<0?Infinity:dist[k];};
 // la vista: de a medio paso por la recta, ninguna celda tapada (un edificio, una casa, el monte que no es calle)
 const ve=(a,b)=>{const d=Math.hypot(b.x-a.x,b.z-a.z),n=Math.ceil(d/(RUTA/2));for(let s=1;s<n;s++){const t=s/n,k=idx(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t);if(k<0||!libre[k])return false;}return true;};
 // el costo de caminar cada celda para la gente (veredas): la calzada —la calle o la avenida de la ciudad a más de
 // CALLE.vereda de la manzana— cuesta CALZADA; la cebra y todo lo demás, 1. Se arma la primera vez que se pide.
 let costoV=null;const veredas=()=>{if(costoV)return costoV;costoV=new Float32Array(N).fill(1);const m=bp.map,C6=6,v=CALLE.vereda-.1,kd=(x,z)=>{const cx=Math.floor(x/C6),cy=Math.floor(z/C6);return cx<0||cy<0||cx>=m.W||cy>=m.H?-1:m.kind[cy*m.W+cx];};
  const calle=k=>k===0||k===1,cebras=(bp.equipamiento||[]).filter(o=>o.tipo==='cebra');
  for(let k=0;k<N;k++){if(!libre[k])continue;const {x,z}=centro(k);if(!calle(kd(x,z)))continue;let vereda=false;
   for(const [a,b] of [[v,0],[-v,0],[0,v],[0,-v],[v*.7,v*.7],[-v*.7,v*.7],[v*.7,-v*.7],[-v*.7,-v*.7]]){const q=kd(x+a,z+b);if(q>=0&&!calle(q)){vereda=true;break;}}
   if(vereda)continue;if(cebras.some(o=>{const c=Math.cos(o.ang||0),s=Math.sin(o.ang||0),dx=x-o.x,dz=z-o.z,u=dx*c+dz*s,w=-dx*s+dz*c;return Math.abs(u)<=o.largo/2+.5&&Math.abs(w)<=o.fondo/2+.5;}))continue;costoV[k]=CALZADA;}
  return costoV;};
 return {nx,nz,X0,Z0,RUTA,libre,alto,idx,centro,cerca,vecinos,campo,siguiente,distEn,ve,g,veredas};}
