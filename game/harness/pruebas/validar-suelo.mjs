// Nivel 7 del probador (2026-10-16, Miguel: «la colisión de los pisos de los escalones se cae»): el suelo que pisa la
// física de la isla (island3d ground) contra lo que se dibuja, sin pantalla. En una grilla de puntos de la isla fuera de
// la ciudad —y en cada casilla de lote y cada calle del monte—, la altura de la física tiene que caer sobre una cara
// dibujada que se ve desde arriba (a ≤ TOL): si no, se camina sobre algo invisible (por encima) o se cae a través de lo
// que se ve (por debajo).
// Las casas, aparte (su piso lo dibujan y lo pisan sus propios módulos).
// Uso: node scripts/validar-suelo.mjs [ciudades=2] [semilla0=1]
import {armarIsla} from './sin-pantalla.mjs';
import {indiceTriangulos} from './medir3d.mjs';
import {CELL} from '../src/engine/veredas.js';
import {cuerpoCasa} from '../src/engine/circulacion.js';
import {islaDe} from '../src/engine/isla.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||2),S0=+(A[1]||1),TOL=.02;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<(process.env.EJ?+process.env.EJ:3))f.ej.push(ej);};
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.min(b.length-1,Math.floor(p*b.length))]:NaN;};
const med={lote:[],calle:[],tierra:[],borde:0},peor={};
for(let s=S0;s<S0+N;s++){const {bp,isla}=await armarIsla(s),I=bp.isla,ix=indiceTriangulos(isla.group,{saltar:o=>!o.name?.startsWith('suelo:')}),Wm=bp.map.W*CELL,Hm=bp.map.H*CELL;
 const T0=islaDe(bp.map),celda=new Set(I.cells.map(c=>c.x+','+c.y));// (la tierra: sólo las casillas de la isla —en el borde, la malla se corre al contorno—)
 const casas=(I.casas||[]).map(cuerpoCasa),enCasa=(x,z)=>casas.some(c=>x>c.x0-1&&x<c.x1+1&&z>c.z0-1&&z<c.z1+1)||isla.insideHouse(x,z);
 const mira=(k,x,z)=>{if(enCasa(x,z))return;const g=isla.ground(x,z,60),a=ix.arriba(x,z,true);if(!a.todas.length)return;
  // la cara de suelo que se ve desde arriba —las mallas que island3d nombra «suelo:…»: terreno, asfalto, andenes, lotes,
  // mesetas, rellenos y peldaños; no los techos, muros, postes ni faroles—: por encima de la física, se cae; por debajo, flota
  const cara=a.y,d=cara-g;med[k].push(Math.abs(d));
  if(!peor[k]||Math.abs(d)>Math.abs(peor[k].d))peor[k]={d,x,z,semilla:s,fisica:+g.toFixed(3),cara:+cara.toFixed(3)};
  if(Math.abs(d)>TOL)falla(d>0?'la física queda por debajo de lo que se ve (se cae)':'la física pisa algo que no se ve (flota)',{semilla:s,donde:k,x:+x.toFixed(1),z:+z.toFixed(1),fisica:+g.toFixed(3),cara:+cara.toFixed(3),mm:Math.round(d*1000),ve:a.de});};
 for(const c of I.cells){if(!c.lote||c.terraza==null)continue;for(const u of [.5,3,5.5])for(const v of [.5,3,5.5])mira('lote',c.x*CELL+u,c.y*CELL+v);}
 for(const r of I.carreteras||[]){if(!r.puntos||r.tipo!=='grilla')continue;for(let i=1;i<r.puntos.length;i++){const a=r.puntos[i-1],b=r.puntos[i],L=Math.hypot(b.x-a.x,b.z-a.z);if(L<1)continue;
  for(let t=.5;t<L;t+=2)for(const o of [-4.5,-1.5,1.5,4.5]){const ux=(b.x-a.x)/L,uz=(b.z-a.z)/L;mira('calle',a.x+ux*t-uz*o,a.z+uz*t+ux*o);}}}
 // (la grilla, corrida 0,37 m de los bordes de casilla: justo en el borde de dos terrazas se ve la más alta y la física
 // toma una de las dos —no es un hueco—)
 const b=I.bounds;for(let z=b.y0*CELL+.37;z<(b.y1+1)*CELL;z+=4)for(let x=b.x0*CELL+.37;x<(b.x1+1)*CELL;x+=4){if(x>=0&&z>=0&&x<=Wm&&z<=Hm)continue;if(!(isla.height(x,z)>-30)||!celda.has(Math.floor(x/CELL)+','+Math.floor(z/CELL)))continue;if(T0.beyond(x,z)>-3){med.borde++;continue;}mira('tierra',x,z);}}
const mm=a=>a.length?`mediana ${(q(a,.5)*1000).toFixed(0)}, p99 ${(q(a,.99)*1000).toFixed(0)}, máx ${(q(a,1)*1000).toFixed(0)} mm`:'—';
console.log(`suelo · ${N} ciudades · la física contra el suelo que se ve: terrazas ${med.lote.length} puntos (${mm(med.lote)}) · calles ${med.calle.length} (${mm(med.calle)}) · tierra ${med.tierra.length} (${mm(med.tierra)}; fuera, ${med.borde} a menos de 3 m del borde de la isla, donde la malla se corre al contorno)`);
for(const [k,p] of Object.entries(peor))console.log(`  el peor en ${k}: ${(p.d*1000).toFixed(0)} mm en (${p.x.toFixed(1)}, ${p.z.toFixed(1)}), semilla ${p.semilla} · física ${p.fisica}, cara ${p.cara}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
