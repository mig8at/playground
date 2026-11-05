// Valida cuánto se mueve la montaña para urbanizarla (2026-10-16, Miguel: «que las manzanas de la montaña no desbasten
// tanto la montaña sino que la escalonen, con un máximo, y las calles con una pendiente máxima»), contra TERRAZA de
// medidas.js. Compara el terreno de la isla (la montaña con su pie de monte suave, isla.js landH) con lo que queda:
//  · cada casilla de lote: su terraza contra el natural (corte o relleno) ≤ TERRAZA.mover;
//  · entre dos casillas de lote vecinas, el muro (la diferencia de sus terrazas: el de entre las dos mitades de una
//    manzana, cada una a la altura de su calle) ≤ TERRAZA.escalon;
//  · una terraza y la calle a la que da: ≤ TERRAZA.acceso (se sube con unos peldaños); y contra cualquier calle que
//    pasa al lado: ≤ un muro y un acceso;
//  · cada calle: contra el natural ≤ TERRAZA.mover, y su pendiente ≤ TERRAZA.pendiente;
//  · el resto del rebaje (lo que la máscara aplana fuera de lotes y calles): contra el natural ≤ TERRAZA.mover.
// Uso: node scripts/validar-terrazas.mjs [ciudades=4] [semilla0=1] [--medir] (con --medir: sólo mide, sin fallas)
import {generateBlueprint} from '../src/engine/blueprint.js';
import {islaDe} from '../src/engine/isla.js';
import {CELL} from '../src/engine/veredas.js';
import {TERRAZA} from '../src/engine/medidas.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||4),S0=+(A[1]||1),MEDIR=process.argv.includes('--medir');
const fallas=new Map();const falla=(k,ej)=>{if(MEDIR)return;const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.min(b.length-1,Math.floor(p*b.length))]:NaN;};
const med={lote:[],muro:[],acceso:[],lado:[],calle:[],pend:[],resto:[],vol:{lote:0,resto:0,calle:0},manzanas:0};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),I=bp.isla,T=islaDe(bp.map);
 const natural=(x,z)=>T.landH(x,z);// (el terreno: la montaña con su pie de monte, isla.js; nada lo recorta)
 const celdas=new Map(I.cells.map(c=>[c.x+','+c.y,c])),lote=c=>c&&c.lote&&c.terraza!=null;med.manzanas+=new Set(I.cells.filter(lote).map(c=>c.manzana)).size;
 // las calles: su eje, con su altura (para el acceso de los lotes y el resto)
 const ejes=(I.carreteras||[]).filter(c=>c.puntos&&c.tipo==='grilla').flatMap(c=>c.puntos.slice(1).map((p,i)=>({a:c.puntos[i],b:p,an:(c.ancho||12)/2})));
 const calleEn=(x,z,extra=0)=>{let best=null,bd=1e9;for(const {a,b,an} of ejes){const dx=b.x-a.x,dz=b.z-a.z,L2=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/L2)),d=Math.hypot(x-a.x-t*dx,z-a.z-t*dz);if(d<an+extra&&d<bd){bd=d;best=a.h+(b.h-a.h)*t;}}return best;};
 for(const c of I.cells){const x=(c.x+.5)*CELL,z=(c.y+.5)*CELL,ej={semilla:s,x,z};
  if(lote(c)){const d=c.terraza-natural(x,z);med.lote.push(Math.abs(d));med.vol.lote+=Math.abs(d)*CELL*CELL;if(Math.abs(d)>TERRAZA.mover)falla('terraza que mueve la montaña más de TERRAZA.mover',{...ej,m:+d.toFixed(1)});
   for(const [dx,dy] of [[1,0],[0,1]]){const n=celdas.get((c.x+dx)+','+(c.y+dy));if(!lote(n))continue;const w=Math.abs(n.terraza-c.terraza);if(w>.01)med.muro.push(w);if(w>TERRAZA.escalon+1e-6)falla('muro entre terrazas más alto que TERRAZA.escalon',{...ej,m:+w.toFixed(2)});}
   // el acceso: contra la calle a la que da (c.nivelCalle, la de su frente); a los costados, contra la calle que pasa al
   // lado, un muro de a lo sumo TERRAZA.escalon
   if(c.nivelCalle!=null){const w=Math.abs(c.terraza-c.nivelCalle);med.acceso.push(w);if(w>TERRAZA.acceso+1e-3)falla('terraza más alta o más baja que su calle que TERRAZA.acceso',{...ej,m:+w.toFixed(2)});}
   const h=calleEn(x,z,CELL);if(h!=null){const w=Math.abs(c.terraza-h);med.lado.push(w);if(w>TERRAZA.escalon+TERRAZA.acceso+1e-3)falla('terraza que queda sobre o bajo la calle de al lado más que un muro y un acceso',{...ej,m:+w.toFixed(2)});}}
  else if(!c.carretera&&c.zona!=='agua'&&c.zona!=='agua_honda'){const d=Math.abs(T.landH(x,z)-natural(x,z));if(d>.05){med.resto.push(d);med.vol.resto+=d*CELL*CELL;if(d>TERRAZA.mover+1e-6)falla('rebaje fuera de lotes y calles que mueve más de TERRAZA.mover',{...ej,m:+d.toFixed(1)});}}}
 for(const {a,b} of ejes){const L=Math.hypot(b.x-a.x,b.z-a.z);if(L<.5)continue;const g=Math.abs(b.h-a.h)/L*100;med.pend.push(g);if(g>TERRAZA.pendiente+1e-6)falla('calle más empinada que TERRAZA.pendiente',{semilla:s,x:+a.x.toFixed(0),z:+a.z.toFixed(0),pct:+g.toFixed(1)});
  for(let t=0;t<=L;t+=3){const x=a.x+(b.x-a.x)*t/L,z=a.z+(b.z-a.z)*t/L,h=a.h+(b.h-a.h)*t/L,d=Math.abs(h-natural(x,z));med.calle.push(d);med.vol.calle+=d*3*12;if(d>TERRAZA.mover+1e-6)falla('calle que mueve la montaña más de TERRAZA.mover',{semilla:s,x:+x.toFixed(0),z:+z.toFixed(0),m:+d.toFixed(1)});}}}
const r=(a,u='m')=>a.length?`p50 ${q(a,.5).toFixed(1)}, p90 ${q(a,.9).toFixed(1)}, máx ${q(a,1).toFixed(1)} ${u}`:'—';
console.log(`terrazas · ${med.manzanas} manzanas del monte · terraza contra el natural: ${r(med.lote)} · muros entre terrazas: ${r(med.muro)} · al acceso de su calle: ${r(med.acceso)} · a la calle más cercana: ${r(med.lado)} · calles contra el natural: ${r(med.calle)} · pendiente de las calles: ${r(med.pend,'%')} · rebaje del resto: ${r(med.resto)} · volumen movido: lotes ${(med.vol.lote/1e3/N).toFixed(0)}, calles ${(med.vol.calle/1e3/N).toFixed(0)}, resto ${(med.vol.resto/1e3/N).toFixed(0)} mil m³ por ciudad`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
