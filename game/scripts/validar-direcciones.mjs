// Valida las direcciones al estilo Bogotá (2026-10-16, src/engine/direcciones.js):
//  · cada puerta de calle (lotes de la ciudad y del monte) y cada casa tiene la suya, con el formato «Cl 11 # 24-37» (o
//    «Cl 10 Bis # …» en un callejón);
//  · ninguna se repite en una ciudad;
//  · impares del lado de menor coordenada de la vía, pares del otro;
//  · la vía de la dirección está delante de la puerta (a ≤ 14 m de su eje, del lado al que mira);
//  · los metros, la distancia a la vía cruzada anterior (±3 m: se corren 2 si dos puertas caerían en el mismo número);
//  · a lo largo de cada vía y de cada lado, los números crecen.
// Uso: node scripts/validar-direcciones.mjs [ciudades=4] [semilla0=1]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {cuerpoCasa} from '../src/engine/circulacion.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||4),S0=+(A[1]||1);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const FORMATO=/^(Cl|Kr|Ac|Ak) \d+[A-H]?( Bis)? # \d+[A-H]?-\d+$/;let total=0;const porVia={};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),V=bp.vias,vistas=new Set(),puertas=[];
 const num=c=>{const m=/^(\d+)([A-H]?)$/.exec(c);return m?+m[1]+(m[2]?(m[2].charCodeAt(0)-64)/10:0):NaN;};
 const coordDe=(e,c)=>V[e==='h'?'v':'h'].find(v=>v.numero+(v.letra||'')===c)?.coord;
 const revisar=(dir,x,z,nx,nz,que)=>{total++;const ej={semilla:s,que,x:+x.toFixed(1),z:+z.toFixed(1)};if(!dir){falla('puerta sin dirección',ej);return;}
  if(!FORMATO.test(dir.texto))falla('dirección con otro formato',{...ej,texto:dir.texto});if(vistas.has(dir.texto))falla('dirección repetida',{...ej,texto:dir.texto});vistas.add(dir.texto);
  const e=dir.eje,sg=e==='h'?Math.sign(nz):Math.sign(nx),pos=e==='h'?z:x,along=e==='h'?x:z,dd=(dir.coordVia-pos)*sg;
  if(dd<-1||dd>14)falla('la vía de la dirección no está delante de la puerta',{...ej,texto:dir.texto,m:+dd.toFixed(1)});
  if((dir.metros%2===1)!==(sg>0))falla('par o impar del lado equivocado',{...ej,texto:dir.texto});
  const cc=coordDe(e,dir.cruce);if(cc!=null&&Math.abs(along-cc-dir.metros)>3+1e-6)falla('los metros no son la distancia a la cruzada',{...ej,texto:dir.texto,real:+(along-cc).toFixed(1)});
  puertas.push({k:dir.via+'|'+dir.lado,along,orden:num(dir.cruce)*1000+dir.metros,texto:dir.texto});porVia[dir.via]=(porVia[dir.via]||0)+1;};
 for(const L of [...bp.lots,...(bp.isla.lots||[]).filter(l=>l.levels)]){const lv=L.levels?.find(l=>l.level===0);if(!lv)continue;const dentro=(x,z)=>(L.parts||[]).some(p=>x>p.x&&x<p.x+p.w&&z>p.y&&z<p.y+p.h);
  for(const d of lv.doors||[]){if(!d.street)continue;const hz=Math.abs(d.y1-d.y0)<1e-6,mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2,nx=hz?0:(dentro(mx+.3,mz)?-1:1),nz=hz?(dentro(mx,mz+.3)?-1:1):0;revisar(d.direccion,mx,mz,nx,nz,L.type);}}
 for(const h of bp.isla.casas||[]){const c=cuerpoCasa(h);revisar(h.direccion,c.puerta.x,c.puerta.z,c.afuera.x,c.afuera.z,'casa');}
 // crecen a lo largo de cada vía y lado
 const grupos=new Map();for(const p of puertas)(grupos.get(p.k)||grupos.set(p.k,[]).get(p.k)).push(p);
 for(const [k,g] of grupos){g.sort((a,b)=>a.along-b.along);for(let i=1;i<g.length;i++)if(g[i].orden<g[i-1].orden&&g[i].along-g[i-1].along>3){falla('números que no crecen a lo largo de la vía',{semilla:s,via:k,a:g[i-1].texto,b:g[i].texto});break;}}}
console.log(`direcciones · ${total} puertas de ${N} ciudades · ${Object.keys(porVia).length} vías con números (las más: ${Object.entries(porVia).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>k+' '+v).join(', ')})`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
