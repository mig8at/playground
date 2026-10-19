// La mansarda en el 2D (2026-10-18, FACHADAS.md B3; engine/techos.js, medidas.js MANSARDA). En cada lote con techo
// «mansarda» de 4 ciudades:
//  · el perfil: al pie de cada borde de pendiente la altura es 0 (el techo del último piso) y a MANSARDA.retiro hacia
//    adentro ya es MANSARDA.alto; en el medio, la pendiente (la mitad a la mitad del retiro), como la pieza del paquete;
//  · la cubierta (la losa que dibuja el 3D): dentro del lote, toda a MANSARDA.alto y a ≥ MANSARDA.cubierta de cada borde
//    de pendiente;
//  · sin huecos: cada punto del techo (cada 0,5 m) está en la pendiente o en la franja de pizarra (a menos de
//    MANSARDA.cubierta de un borde) o bajo la cubierta; si no, desde arriba se vería adentro del edificio;
//  · la parada del ascensor en el techo (el núcleo con ascensor) cae en lo plano: ahí se sale a MANSARDA.alto.
// Uso: node scripts/validar-mansarda.mjs [ciudades=4] [semilla0=1]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {alturaMansarda} from '../src/engine/techos.js';
import {MANSARDA as M} from '../src/engine/medidas.js';
const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||4),S0=+(A[1]||1),E=1e-6;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const med={lotes:0,bordes:0,puntos:0,pendiente:0,franja:0,cubierta:0,ascensores:0};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});
 for(const [li,L] of bp.lots.entries()){if(L.fachada?.techo!=='mansarda')continue;const T=L.mansarda,ej={semilla:s,lote:li,tipo:L.type};if(!T){falla('mansarda sin su techo del 2D',ej);continue;}med.lotes++;
  const dentro=(x,z)=>L.parts.some(p=>x>p.x-E&&x<p.x+p.w+E&&z>p.y-E&&z<p.y+p.h+E);
  for(const b of T.bordes){med.bordes++;const a=(b.a0+b.a1)/2,pt=d=>b.eje==='x'?[a,b.en+b.n*d]:[b.en+b.n*d,a];
   const h0=alturaMansarda(T,...pt(.001)),hm=alturaMansarda(T,...pt(M.retiro/2)),h1=alturaMansarda(T,...pt(M.retiro+.01));
   if(h0>.01)falla('la pendiente no empieza en 0 al pie de la fachada',{...ej,h0:+h0.toFixed(3)});
   if(Math.abs(hm-M.alto/2)>.02&&hm<M.alto-.01)falla('la pendiente no es la de la pieza',{...ej,hm:+hm.toFixed(3)});
   if(Math.abs(h1-M.alto)>.01)falla('arriba de la pendiente no está la cubierta',{...ej,h1:+h1.toFixed(3)});}
  for(const c of T.cubierta){for(const [x,z] of [[c.x0+.01,c.z0+.01],[c.x1-.01,c.z0+.01],[c.x0+.01,c.z1-.01],[c.x1-.01,c.z1-.01],[(c.x0+c.x1)/2,(c.z0+c.z1)/2]]){
    if(!dentro(x,z))falla('cubierta fuera del lote',{...ej,x,z});if(Math.abs(alturaMansarda(T,x,z)-M.alto)>.01)falla('cubierta que no está arriba',{...ej,x,z});}}
  // sin huecos: la distancia al borde de pendiente más cercano decide qué hay
  const dist=(x,z)=>{let d=Infinity;for(const b of T.bordes){const a=b.eje==='x'?x:z,p=b.eje==='x'?z:x;if(a<b.a0-E||a>b.a1+E)continue;const dd=(p-b.en)*b.n;if(dd>=-E)d=Math.min(d,dd);}return d;};
  for(const p of L.parts)for(let x=p.x+.25;x<p.x+p.w;x+=.5)for(let z=p.y+.25;z<p.y+p.h;z+=.5){med.puntos++;const d=dist(x,z);
   if(d<M.retiro)med.pendiente++;else if(d<M.cubierta)med.franja++;else if(T.cubierta.some(c=>x>c.x0-E&&x<c.x1+E&&z>c.z0-E&&z<c.z1+E))med.cubierta++;
   else falla('techo sin dibujar (se ve adentro desde arriba)',{...ej,x:+x.toFixed(2),z:+z.toFixed(2),d:+d.toFixed(2)});}
  // la parada del ascensor
  const lv=L.levels?.find(l=>l.core?.lift);if(lv){med.ascensores++;const c=lv.core,ok=[[c.x+.5,c.y+.5],[c.x+c.w-.5,c.y+.5],[c.x+.5,c.y+c.h-.5],[c.x+c.w-.5,c.y+c.h-.5]].every(([x,z])=>Math.abs(alturaMansarda(T,x,z)-M.alto)<.01);
   if(!ok)falla('el ascensor sale a la pendiente de la mansarda',{...ej,core:c});}}}
console.log(`mansarda · ${N} ciudades · ${med.lotes} lotes con mansarda · ${med.bordes} bordes de pendiente · ${med.puntos} puntos del techo: pendiente ${med.pendiente}, franja de pizarra ${med.franja}, bajo la cubierta ${med.cubierta} · ascensores ${med.ascensores}`);
let tot=0;for(const [k,f] of fallas){tot+=f.n;console.log(`  ${f.n}\t${k}`);for(const e of f.ej)console.log('     '+JSON.stringify(e));}
console.log(`fallas: ${tot}`);
