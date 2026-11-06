// Los vanos de las casas (2026-10-18, Miguel: «las ventanas de las casas quedan juntas o incluso ocupando el mismo
// espacio de la puerta»): en cada pared de afuera de cada casa del monte (vivienda.js planHouse, con el plano de su
// familia), lo que ocupa cada ventana (con su marco, alféizar y postigos) y cada puerta (con su marco) a lo largo de la
// pared —opening.ext, medio ancho— no se pisa con lo de otra: entre dos vanos queda al menos HUECO_MIN de pared, y nada
// se sale de la pared ni llega a menos de ESQUINA_MIN de una esquina; y cada cuarto al que el plano le da ventana la tiene
// dibujada (en su pared o, si no cabe al lado de la puerta del patio, en la del costado).
// Y los ejes (2026-10-30): al menos EJES_MIN de las ventanas de arriba, sobre el eje de un vano de abajo de su pared.
// Uso: node harness/pruebas/validar-vanos.mjs [ciudades=3] [semilla0=1]
import {generateBlueprint} from '../../src/engine/blueprint.js';
import {planHouse} from '../../src/engine/vivienda.js';
const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||3),S0=+(A[1]||1),HUECO_MIN=.2,ESQUINA_MIN=.25,EJE=.1,EJES_MIN=.85;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<4)f.ej.push(ej);};
let ejesArriba=0,ejesAlineados=0,ejesPosibles=0,sinVentana=0,casas=0,paredes=0,vanos=0,pares=0,huecoMin=Infinity;const t0=performance.now();
for(let sd=S0;sd<S0+N;sd++){const bp=generateBlueprint({seed:sd,team:3});
 for(const [i,h] of (bp.isla.casas||[]).filter(h=>h.spec).entries()){const P=planHouse({...h.spec,...(h.colores?{colores2d:h.colores}:{})});casas++;
  for(const l of h.spec.hogar?.levels||[])for(const q of l.rooms)if(l.windows.some(w=>w.a===q.id)&&!P.openings.some(o=>o.kind==='window'&&o.cuarto===q.id&&o.nivel===l.level)){sinVentana++;falla('cuarto sin su ventana',{semilla:sd,casa:i,cuarto:q.type,nivel:l.level});}
  const g=new Map();for(const o of P.openings){if(o.ext==null)continue;const piso=o.y0>P.H1-.3?1:0,k=`${o.axis}:${o.at.toFixed(2)}:${piso}`;(g.get(k)||g.set(k,[]).get(k)).push(o);}
  for(const [k,l] of g){paredes++;vanos+=l.length;const [axis,at]=k.split(':'),o0=axis==='x'?-P.ox:-P.oz,largo=axis==='x'?P.W:P.D,ej={semilla:sd,casa:i,pared:k};
   l.sort((a,b)=>a.c-b.c);
   for(const o of l){const a=o.c-o.ext-o0,b=o.c+o.ext-o0;if(a<ESQUINA_MIN-1e-6||b>largo-ESQUINA_MIN+1e-6)falla('vano que se sale de la pared o llega a la esquina',{...ej,kind:o.kind,c:+o.c.toFixed(2),ext:+o.ext.toFixed(2),largo:+largo.toFixed(2)});}
   for(let j=1;j<l.length;j++){const p=l[j-1],q=l[j],hueco=(q.c-q.ext)-(p.c+p.ext);pares++;huecoMin=Math.min(huecoMin,hueco);
    if(hueco<HUECO_MIN-1e-6)falla(p.kind==='door'||q.kind==='door'?'ventana pegada a la puerta (o encima)':'ventanas pegadas (o encimadas)',{...ej,a:p.kind,b:q.kind,hueco:+hueco.toFixed(2)});}}
  // los ejes (2026-10-30): cada ventana de arriba, sobre el eje de un vano de abajo de su pared (a EJE m), si su tramo lo alcanza
  for(const [k,l] of g){if(!k.endsWith(':1'))continue;const abajo=g.get(k.slice(0,-1)+'0')||[];
   for(const o of l){if(o.kind!=='window')continue;ejesArriba++;if(!abajo.length)continue;ejesPosibles++;
    if(abajo.some(b=>Math.abs(b.c-o.c)<EJE))ejesAlineados++;}}}}
console.log(`vanos · ${casas} casas · ${paredes} paredes · ${vanos} vanos · ${pares} pares vecinos: el hueco más chico ${huecoMin.toFixed(2)} m (mínimo ${HUECO_MIN}) · ${((performance.now()-t0)/1000).toFixed(0)} s`);
if(ejesAlineados<EJES_MIN*ejesPosibles)falla('ventanas de arriba fuera de los ejes de abajo',{alineadas:ejesAlineados,de:ejesPosibles,minimo:EJES_MIN});
let tot=0;for(const [k,f] of fallas){tot+=f.n;console.log(`  ${f.n}\t${k}`);for(const e of f.ej)console.log('     '+JSON.stringify(e));}
console.log(`  ejes: ${ejesAlineados} de ${ejesPosibles} ventanas de arriba (en paredes con vanos abajo) sobre el eje de uno de abajo: ${(100*ejesAlineados/Math.max(1,ejesPosibles)).toFixed(0)} % · ${ejesArriba} ventanas de arriba`);
console.log(`fallas: ${tot}`);
