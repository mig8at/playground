// Valida el mundo fuera de la ciudad con matemática, sin el 3D (2026-10-15): las calles de la grilla del monte (ancho de
// una calle de la ciudad, pendiente ≤ CARRETERA.grilla.gradoMax, conectadas a la ciudad por una salida del muro) y las
// casas de cada media manzana (enteras en su lote, sin pisar la calle, sin encimarse, con el retiro y la separación de
// medidas.js MANZANA.monte).
// Uso: node scripts/validar-mundo.mjs [ciudades=12] [semilla0=1] [jugadores=3]
import {generateBlueprint,CELL,CARRETERA} from '../src/engine/blueprint.js';
import {CALLE,MANZANA,LADERA,ESCALINATA,TERRAZA}  from '../src/engine/medidas.js';

const N=+(process.argv[2]||12),S0=+(process.argv[3]||1),TEAM=+(process.argv[4]||3),E=1e-6;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
let manzanas=0,casas=0,calles=0,sinMonte=0,sinEje=0;const porSemilla=[],tramos={nivel:0,sube:0,entrada:0,otra:0},ejes=[];
const muro={};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:TEAM}),I=bp.isla,cells=new Map(I.cells.map(c=>[c.x+','+c.y,c])),at=(x,y)=>cells.get(x+','+y);
 const m=I.grilla?.manzanas||0;manzanas+=m;porSemilla.push(m);if(!m)sinMonte++;
 // ---- calles ----
 const grilla=(I.carreteras||[]).filter(c=>c.tipo==='grilla');calles+=grilla.length;
 for(const c of grilla){const ej={semilla:s,ancho:c.ancho};
  if(![CALLE.calle.casillas*CELL,CALLE.avenida.casillas*CELL].includes(c.ancho))falla('calle del monte de ancho raro',ej);
  // cada tramo: a nivel (un anillo, curva de nivel; o el tramo plano junto a un cruce), subiendo —lo que no es cruce sube
  // el muro de una terraza: más que LADERA.pendiente, que se mide de cruce a cruce—, o la entrada desde el muro (más suave).
  // (2026-10-16: con el tramo plano de los cruces en el plano, las que suben ya no van a LADERA.pendiente justa)
  for(let i=1;i<c.puntos.length;i++){const a=c.puntos[i-1],b=c.puntos[i],L=Math.hypot(b.x-a.x,b.z-a.z);if(L<E)continue;const sl=Math.abs(b.h-a.h)/L;
   tramos[sl<.005?'nivel':c.desde&&i===1?'entrada':sl>=LADERA.pendiente-.01&&sl<=TERRAZA.pendiente/100+1e-9?'sube':'otra']++;}
  for(let i=1;i<c.puntos.length;i++){const a=c.puntos[i-1],b=c.puntos[i],L=Math.hypot(b.x-a.x,b.z-a.z);if(L<E)continue;const g=Math.atan2(Math.abs(b.h-a.h),L)*180/Math.PI;
   if(g>CARRETERA.grilla.gradoMax+E)falla('calle del monte más empinada que el tope',{...ej,grados:+g.toFixed(1)});}}
 // conectadas: desde las salidas del muro, por los extremos de las cadenas, se llega a todas
 if(grilla.length){const key=p=>Math.round(p.x)+','+Math.round(p.z),adj=new Map(),add=(a,b)=>{(adj.get(a)||adj.set(a,new Set()).get(a)).add(b);(adj.get(b)||adj.set(b,new Set()).get(b)).add(a);};
  const ini=[];for(const c of grilla){const a=key(c.puntos[0]),b=key(c.puntos.at(-1));add(a,b);if(c.desde)ini.push(a,b);}
  const seen=new Set(ini),q=[...ini];for(let k=0;k<q.length;k++)for(const n of adj.get(q[k])||[])if(!seen.has(n)){seen.add(n);q.push(n);}
  for(const c of grilla)if(!seen.has(key(c.puntos[0])))falla('calle del monte que no llega a la ciudad',{semilla:s});}
 // ---- manzanas: lado corto ≥ dos medias manzanas (MANZANA.monte), lado largo ≤ MANZANA.max ----
 const mitad=Math.ceil((MANZANA.monte.retiro+MANZANA.monte.casaFondo+MANZANA.monte.patio)/CELL-E)*CELL,grupos=new Map();
 for(const c of I.cells)if(c.lote)(grupos.get(c.manzana)||grupos.set(c.manzana,[]).get(c.manzana)).push(c);
 for(const [k,cs] of grupos){if(k==='mirador')continue;
  // un solo muro de contención por manzana: entre sus dos medias manzanas, a lo sumo LADERA.muro
  {const t=cs.map(c=>c.terraza).filter(v=>v!=null);if(t.length&&Math.max(...t)-Math.min(...t)>LADERA.muro+.05)falla('muro de contención más alto que LADERA.muro',{semilla:s,manzana:k,m:+(Math.max(...t)-Math.min(...t)).toFixed(2)});}const w=(Math.max(...cs.map(c=>c.x))-Math.min(...cs.map(c=>c.x))+1)*CELL,d=(Math.max(...cs.map(c=>c.y))-Math.min(...cs.map(c=>c.y))+1)*CELL;
  // (las pegadas a la ciudad —clave m…— tienen una sola mitad: la otra, la que mira al muro, es borde verde)
  const mural=/^m[NSWE]/.test(k);if(Math.min(w,d)<(mural?1:2)*mitad-E)falla(mural?'manzana pegada a la ciudad angosta (< media manzana)':'manzana del monte angosta (< dos medias manzanas)',{semilla:s,manzana:k,medida:`${w}×${d}`});
  if(Math.max(w,d)>MANZANA.max+E)falla('manzana del monte larga (> MANZANA.max)',{semilla:s,manzana:k,medida:`${w}×${d}`});}
 // ---- el eje: la calle desde el muro, la escalinata (≤ ESCALINATA.pendiente por tramo, de la punta de la calle) y el mirador ----
 const eje=I.grilla?.eje;if(!eje)sinEje++;else{const e=eje.escalinata,top=eje.calle.at(-1);ejes.push(+(e.at(-1).h-e[0].h).toFixed(1));
  if(Math.hypot(e[0].x-top.x,e[0].z-top.z)>E||Math.abs(e[0].h-top.h)>.01)falla('la escalinata no arranca en la punta de la calle del eje',{semilla:s});
  // (las alturas del eje van al centímetro: la pendiente de un tramo de 6 m se mide con ±0,01/6)
  for(let i=1;i<e.length;i++){const sl=(e[i].h-e[i-1].h)/Math.hypot(e[i].x-e[i-1].x,e[i].z-e[i-1].z);if(sl>ESCALINATA.pendiente+.01/CELL+E||sl<-.01/CELL-E)falla('escalinata fuera de su pendiente',{semilla:s,pendiente:+sl.toFixed(3)});}
  const M=eje.mirador;if(M.cells.length!==ESCALINATA.mirador**2)falla('mirador incompleto',{semilla:s,casillas:M.cells.length});
  if(Math.abs(M.h-e.at(-1).h)>.01)falla('el mirador no está al nivel de la escalinata',{semilla:s});
  const ultima=e.at(-1),mc=at(Math.floor(ultima.x/CELL),Math.floor(ultima.z/CELL))||at(Math.floor((ultima.x-1e-3)/CELL),Math.floor((ultima.z-1e-3)/CELL));if(!mc?.mirador)falla('la escalinata no llega al mirador',{semilla:s});
  for(const [x,y] of M.cells){const c=at(x,y);if(!c?.mirador||c.terraza!==M.h)falla('casilla del mirador fuera de nivel',{semilla:s});}}
 // ---- lo que hay del otro lado del muro: cada casilla de tierra pegada a la ciudad es barrio, calle, parque o borde verde ----
 {const {W,H}=bp.map,frente=[];for(let x=0;x<W;x++)frente.push([x,-1],[x,H]);for(let y=0;y<H;y++)frente.push([-1,y],[W,y]);
  for(const [x,y] of frente){const c=at(x,y),k=!c?'vacío':c.carretera?'calle':c.lote?'barrio':c.parque?'parque':c.borde?'borde verde':c.zona==='playa'?'playa':c.zona.startsWith('agua')?'agua':'sin uso';
   muro[k]=(muro[k]||0)+1;if(k==='sin uso')falla('tierra sin uso pegada al muro',{semilla:s,x,y,zona:c.zona});}}
 // ---- los pasajes peatonales: ninguna casa encima; la escalera, a la pendiente de la escalinata ----
 for(const pj of I.grilla?.pasajes||[]){const R=pj.vert?{x0:pj.u0,x1:pj.u1,z0:pj.d0,z1:pj.d1}:{x0:pj.d0,x1:pj.d1,z0:pj.u0,z1:pj.u1};
  for(const h of I.casas||[]){const v=h.frente==='N'||h.frente==='S',w=v?h.w:h.d,d=v?h.d:h.w;if(h.x-w/2<R.x1-E&&h.x+w/2>R.x0+E&&h.z-d/2<R.z1-E&&h.z+d/2>R.z0+E)falla('casa encima de un pasaje peatonal',{semilla:s,manzana:pj.manzana});}
  if(pj.largo>1e-6&&Math.abs(pj.hB-pj.hA)/pj.largo>ESCALINATA.pendiente+1e-6)falla('escalera de pasaje más empinada que la escalinata',{semilla:s,manzana:pj.manzana});}
 // ---- casas ----
 const hs=I.casas||[];casas+=hs.length;
 const rect=h=>{const v=h.frente==='N'||h.frente==='S',w=v?h.w:h.d,d=v?h.d:h.w;return {x0:h.x-w/2,x1:h.x+w/2,z0:h.z-d/2,z1:h.z+d/2};};
 for(const h of hs){const R=rect(h),ej={semilla:s,manzana:h.manzana,frente:h.frente,w:h.w,d:h.d};
  // cada punto de la casa (de a 1 m) en una casilla de su lote, que no es calle
  for(let x=R.x0+.05;x<=R.x1-.05+E;x+=Math.min(1,R.x1-R.x0-.1))for(let z=R.z0+.05;z<=R.z1-.05+E;z+=Math.min(1,R.z1-R.z0-.1)){const c=at(Math.floor(x/CELL),Math.floor(z/CELL));
   if(!c||!c.lote||c.manzana!==h.manzana){falla('casa fuera de su lote',ej);x=1e9;break;}if(c.carretera){falla('casa sobre la calle',ej);x=1e9;break;}}
  // el retiro: la fachada a MANZANA.monte.retiro del borde del lote del lado de la calle
  const lado={N:R.z0,S:R.z1,W:R.x0,E:R.x1}[h.frente],paso={N:[0,-1],S:[0,1],W:[-1,0],E:[1,0]}[h.frente];
  let k=0;for(;k<40;k++){const x=(h.frente==='W'||h.frente==='E'?lado:h.x)+paso[0]*(k+.5),z=(h.frente==='N'||h.frente==='S'?lado:h.z)+paso[1]*(k+.5),c=at(Math.floor(x/CELL),Math.floor(z/CELL));if(!c||!c.lote||c.manzana!==h.manzana)break;}
  if(Math.abs(k-MANZANA.monte.retiro)>.6)falla('retiro distinto del de la norma',{...ej,retiro:k});
  // el frente da a una calle: la casilla siguiente al borde del lote, del lado del frente, es calle del monte
  {const x=(h.frente==='W'||h.frente==='E'?lado:h.x)+paso[0]*(k+.5),z=(h.frente==='N'||h.frente==='S'?lado:h.z)+paso[1]*(k+.5),c=at(Math.floor(x/CELL),Math.floor(z/CELL));
   if(!c?.carretera)falla(c?'casa que no da a una calle':'casa que da al muro de la ciudad',{...ej,afuera:c?(c.zona+(c.parque?'/parque':'')):'ciudad'});}}
 for(let i=0;i<hs.length;i++)for(let j=i+1;j<hs.length;j++){const a=rect(hs[i]),b=rect(hs[j]),sep=Math.max(b.x0-a.x1,a.x0-b.x1,b.z0-a.z1,a.z0-b.z1);
  if(sep<3-E)falla(sep<0?'casas encimadas':'casas a menos de 3 m',{semilla:s,m:+sep.toFixed(2)});}}
console.log(`${N} mundos (semillas ${S0}–${S0+N-1}) · manzanas del monte ${manzanas-(N-sinEje)} (por semilla: ${porSemilla.join(' ')}) · calles ${calles} · casas ${casas} · sin monte ${sinMonte}`);
console.log(`tramos de calle: ${JSON.stringify(tramos)} · eje en ${N-sinEje} de ${N} (la escalinata sube ${ejes.length?Math.min(...ejes)+'–'+Math.max(...ejes):'—'} m)`);
{const t=Object.values(muro).reduce((a,b)=>a+b,0);console.log('del otro lado del muro: '+Object.entries(muro).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${Math.round(100*v/t)} %`).join(' · '));}
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
