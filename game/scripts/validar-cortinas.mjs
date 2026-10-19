// Valida las cortinas cerradas (2026-10-16, src/engine/cortinas.js; Miguel: «cortinas cerradas en algunas casas y
// negocios, como decoración, y que tapen los interiores vacíos que se ven de lejos»):
//  · el reparto: la parte de unidades con la cortina cerrada, por tipo de edificio, cerca de CORTINA.cerradas (±8 puntos, o 3 desvíos si la muestra es chica);
//  · sólo en ventanas de cuartos de CORTINA.cuartos, nunca en vidrieras, y la misma tela en toda la unidad;
//  · el paño (panioCerrado, el mismo que dibuja town3d) tapa el vidrio: el más ancho y el más alto de las ventanas del
//    paquete (medidos en sus .gltf), dentro de la pared de su cuarto, y queda detrás del vidrio;
//  · en las casas: los cuartos cerrados son de CORTINA.cuartos y la casa armada (planHouse) lleva la tela corrida sobre
//    toda la ventana.
// Uso: node scripts/validar-cortinas.mjs [ciudades=4] [semilla0=1]
import {readFileSync} from 'node:fs';
import {generateBlueprint} from '../src/engine/blueprint.js';
import {cuartoDeVentana,panioCerrado} from '../src/engine/cortinas.js';
import {CORTINA,ALTURA} from '../src/engine/medidas.js';
import {WINDOWS} from '../src/engine/fachada.js';
import {planHouse} from '../src/engine/vivienda.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||4),S0=+(A[1]||1),FLOOR=ALTURA.piso;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
// el vidrio de las ventanas del paquete: la mitad del ancho más grande, la altura más baja y la más alta, la cara más adentro
const G={half:0,y0:9,y1:0,z:0};for(const {p} of Object.values(WINDOWS)){const g=JSON.parse(readFileSync('public/models/downtown/Exports/glTF (Godot)/'+p+'.gltf','utf8'));
 for(const m of g.meshes)for(const q of m.primitives){if(g.materials[q.material]?.name!=='MI_Glass')continue;const a=g.accessors[q.attributes.POSITION];G.half=Math.max(G.half,-a.min[0],a.max[0]);G.y0=Math.min(G.y0,a.min[1]);G.y1=Math.max(G.y1,a.max[1]);G.z=Math.max(G.z,-a.min[2]);}}
const CU=new Set(CORTINA.cuartos),rep={},sum=k=>rep[k]||(rep[k]={u:0,c:0});let paños=0,cruzan=0,casas=0,casasC=0;
const FACE=.27;// (town3d: FACE + .02 = WALL_T + .05 + .02)
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});
 for(const L of [...bp.lots,...(bp.isla.lots||[]).filter(l=>l.levels)]){const tipo=bp.lots.includes(L)?L.type:'monte';
  for(const lv of L.levels){const telas=new Map(),abiertas=new Set(),yb=lv.level*FLOOR+.02;
   for(const w of lv.windows||[]){const c=cuartoDeVentana(lv,w),ej={semilla:s,tipo,piso:lv.level,cuarto:c?.q.type};
    if(w.cortina&&w.shop)falla('cortina cerrada en una vidriera',ej);
    if(!c||!CU.has(c.q.type)){if(w.cortina)falla('cortina cerrada en un cuarto que no lleva',ej);continue;}
    const u=c.q.unit??'c'+c.q.id;if(!w.cortina){abiertas.add(u);continue;}
    if(telas.has(u)&&telas.get(u)!==w.cortina)falla('dos telas en la misma unidad',ej);telas.set(u,w.cortina);
    // el paño contra el vidrio
    paños++;const P=panioCerrado(c,w.cortina,yb,FACE),m=(c.u+c.v)/2,g0=Math.max(c.a,m-G.half),g1=Math.min(c.b,m+G.half);if(m-G.half<c.a-1e-6||m+G.half>c.b+1e-6)cruzan++;
    if(P.u0>g0+CORTINA.panio.margen+1e-6||P.u1<g1-CORTINA.panio.margen-1e-6)falla('el paño no tapa el ancho del vidrio',{...ej,panio:[+P.u0.toFixed(2),+P.u1.toFixed(2)],vidrio:[+g0.toFixed(2),+g1.toFixed(2)]});
    if(P.u0<c.a-1e-6||P.u1>c.b+1e-6)falla('el paño se sale de la pared de su cuarto',ej);
    if(P.y0>lv.level*FLOOR+G.y0+1e-6||P.y1<lv.level*FLOOR+G.y1-1e-6)falla('el paño no tapa el alto del vidrio',{...ej,panio:[P.y0,P.y1],vidrio:[G.y0,G.y1]});
    if(FACE<=G.z)falla('el paño no queda detrás del vidrio',ej);}
   for(const u of telas.keys())if(abiertas.has(u))falla('unidad con unas ventanas cerradas y otras no',{semilla:s,tipo,piso:lv.level});
   const R=sum(tipo);for(const u of new Set([...telas.keys(),...abiertas])){R.u++;if(telas.has(u))R.c++;}}}
 for(const h of bp.isla.casas||[]){const P=h.spec?.hogar;if(!P)continue;casas++;const R=sum('casa');R.u++;if(!h.cortinas)continue;R.c++;casasC++;
  for(const k of h.cortinas.cuartos){const [lvl,id]=k.split(':').map(Number),q=P.levels[lvl]?.rooms.find(r=>r.id===id);if(!q||!CU.has(q.type))falla('casa con cortina cerrada en un cuarto que no lleva',{semilla:s,cuarto:q?.type});}
  // (la casa armada, como la dibuja el 3D: cada ventana de esos cuartos con su tela corrida, más ancha y más alta que la ventana)
  if(casasC<=12){const H=planHouse({...h.spec,colores2d:h.colores,cortinas2d:h.cortinas}),ws=H.openings.filter(o=>o.kind==='window'&&o.tela);
   if(!ws.length&&h.cortinas.cuartos.length)falla('casa con cortinas cerradas que no se dibujan',{semilla:s});
   for(const o of ws){const tela=H.boxes.filter(b=>b.color===o.tela&&b.y1-b.y0>o.h);if(!tela.length)falla('ventana de casa sin su tela corrida',{semilla:s});
    else if(!tela.some(b=>Math.max(b.x1-b.x0,b.z1-b.z0)>=o.w+.2&&b.y0<=o.y0&&b.y1>=o.y0+o.h))falla('la tela de la casa no tapa la ventana',{semilla:s,w:o.w});}}}}
console.log(`cortinas cerradas · ${paños} ventanas de edificios (${cruzan} con un vidrio más ancho que la pared del cuarto) · casas ${casasC}/${casas}`);
console.log('reparto · '+Object.entries(rep).filter(([,v])=>v.u).map(([k,v])=>`${k} ${v.c}/${v.u} (${Math.round(100*v.c/v.u)} %, meta ${Math.round(100*(CORTINA.cerradas[k]??0))})`).join(' · '));
// (la tolerancia: 8 puntos, o 3 desvíos de la binomial si la muestra es chica —con 98 casas de una ciudad, 41 % contra
// 30 era azar: con 4 ciudades, 32 %—)
const tol=(p,n)=>Math.max(.08,3*Math.sqrt(p*(1-p)/n));
for(const [k,v] of Object.entries(rep))if(v.u>=50&&Math.abs(v.c/v.u-(CORTINA.cerradas[k]??0))>tol(CORTINA.cerradas[k]??0,v.u))falla('reparto lejos de CORTINA.cerradas',{tipo:k,parte:+(v.c/v.u).toFixed(2),meta:CORTINA.cerradas[k]??0});
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
