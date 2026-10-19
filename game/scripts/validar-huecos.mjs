// Nivel 6 del probador (2026-10-16, Miguel: «dónde quedan huecos»): arma la isla del 3D sin pantalla (sin-pantalla.mjs)
// y mide, en una grilla de puntos, lo que se ve desde arriba (medir3d.mjs) contra la superficie que dice el 2D:
//  · en cada casilla de lote del monte (a 30 cm de sus bordes, donde van los muros): su terraza;
//  · en cada calle del monte: el asfalto (su altura del 2D + 7 cm) y, en los andenes, 15 cm más;
//  · en toda la tierra de la isla: que haya algo dibujado (ver a través de la isla es un hueco).
// Un hueco es ver más de TOL por debajo de lo que dice el 2D (lo de más arriba —casas, cercas, árboles— no cuenta).
// Da la diferencia en milímetros por tipo de superficie y dónde está la peor.
// Uso: node scripts/validar-huecos.mjs [ciudades=2] [semilla0=1]   (FUGA_CON_HUECOS=1: el dibujo de antes, que tenía)
import {armarIsla} from './sin-pantalla.mjs';
import {indiceTriangulos} from './medir3d.mjs';
import {CELL} from '../src/engine/veredas.js';
import {CALLE} from '../src/engine/medidas.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||2),S0=+(A[1]||1),TOL=.05;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.min(b.length-1,Math.floor(p*b.length))]:NaN;};
const med={lote:[],asfalto:[],anden:[],tierra:0,vacia:0},peor={};const anota=(k,d,ej)=>{med[k].push(d);if(!peor[k]||d<peor[k].d)peor[k]={d,...ej};};
for(let s=S0;s<S0+N;s++){const {bp,isla}=await armarIsla(s),I=bp.isla,ix=indiceTriangulos(isla.group),Wm=bp.map.W*CELL,Hm=bp.map.H*CELL;
 // las terrazas: 5×5 puntos por casilla, a 30 cm de sus bordes
 for(const c of I.cells){if(!c.lote||c.terraza==null)continue;for(const u of [.3,1.65,3,4.35,5.7])for(const v of [.3,1.65,3,4.35,5.7]){const x=c.x*CELL+u,z=c.y*CELL+v,a=ix.arriba(x,z),d=a.y-(c.terraza+.05);
  anota('lote',d,{semilla:s,x,z,casilla:[c.x,c.y],ve:a.de});if(d<-TOL)falla('hueco en una terraza (se ve más abajo que el lote)',{semilla:s,x:+x.toFixed(1),z:+z.toFixed(1),lote:c.terraza,ve:+a.y.toFixed(2),de:a.de});}}
 // las calles del monte: cada 1,5 m a lo largo, a lo ancho por el asfalto y por los andenes (lejos de las puntas: los cruces)
 for(const r of I.carreteras||[]){if(!r.puntos||r.tipo!=='grilla')continue;const an=(r.ancho||12)/2,asf=an-CALLE.vereda;
  // (desde el muro de la ciudad, el asfalto sube de a poco sus 7 cm en los primeros 12 m —empalma con la calle de la
  // ciudad—; la cinta lo toma en cada punto de la calle y entre dos, recto)
  const lift=d=>r.desde?.07*Math.min(1,Math.max(0,d/12))**2*(3-2*Math.min(1,Math.max(0,d/12))):.07;let ac=0;
  for(let i=1;i<r.puntos.length;i++){const a=r.puntos[i-1],b=r.puntos[i],L=Math.hypot(b.x-a.x,b.z-a.z);ac+=L;if(L<1)continue;const ux=(b.x-a.x)/L,uz=(b.z-a.z)/L;
   for(let t=an+1;t<L-an-1;t+=1.5){const h=a.h+(b.h-a.h)*t/L,cx=a.x+ux*t,cz=a.z+uz*t;
    for(const o of [-asf+.3,0,asf-.3,-(asf+an)/2,(asf+an)/2]){const x=cx-uz*o,z=cz+ux*o,anden=Math.abs(o)>asf,e=h+(lift(ac-L)+(lift(ac)-lift(ac-L))*t/L)+(anden?.15:0),A2=ix.arriba(x,z),d=A2.y-e;
     anota(anden?'anden':'asfalto',d,{semilla:s,x,z,ve:A2.de});if(d<-TOL)falla(anden?'hueco en un andén':'hueco en el asfalto',{semilla:s,x:+x.toFixed(1),z:+z.toFixed(1),espera:+e.toFixed(2),ve:+A2.y.toFixed(2),de:A2.de});}}}}
 // la tierra: cada 3 m sobre la isla, fuera de la ciudad, que haya algo dibujado
 const b=I.bounds;for(let z=b.y0*CELL;z<(b.y1+1)*CELL;z+=3)for(let x=b.x0*CELL;x<(b.x1+1)*CELL;x+=3){if(x>=0&&z>=0&&x<=Wm&&z<=Hm)continue;const h=isla.height(x,z);if(!(h>-30))continue;med.tierra++;
  const a=ix.arriba(x,z);if(a.y===-Infinity||a.y<h-5){med.vacia++;falla('se ve a través de la isla (tierra sin nada dibujado arriba)',{semilla:s,x,z,suelo:+h.toFixed(2),ve:a.y===-Infinity?'nada':+a.y.toFixed(2)});}}}
const mm=a=>a.length?`p1 ${(q(a,.01)*1000).toFixed(0)}, mediana ${(q(a,.5)*1000).toFixed(0)}, mín ${(q(a,0)*1000).toFixed(0)} mm`:'—';
console.log(`huecos · ${N} ciudades · lo que se ve menos lo que dice el 2D: terrazas ${med.lote.length} puntos (${mm(med.lote)}) · asfalto ${med.asfalto.length} (${mm(med.asfalto)}) · andenes ${med.anden.length} (${mm(med.anden)}) · tierra ${med.tierra} puntos, ${med.vacia} sin nada arriba`);
for(const [k,p] of Object.entries(peor))console.log(`  el más bajo en ${k}: ${(p.d*1000).toFixed(0)} mm en (${p.x.toFixed(1)}, ${p.z.toFixed(1)}), semilla ${p.semilla}, se ve ${p.ve}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
