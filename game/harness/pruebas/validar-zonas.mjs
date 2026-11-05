// Valida las zonas prohibidas (2026-10-16): cada árbol, palmera, sombrilla y pieza del equipamiento, con su huella
// (src/engine/zonas.js huella), contra la tabla ZONAS de medidas.js —en qué zonas no puede caer ninguna parte, y cuáles
// tiene que pisar su centro—. Una tabla para todo: agregar una regla es agregar una zona a la lista de un objeto.
// Uso: node scripts/validar-zonas.mjs [ciudades=4] [semilla0=1]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {ZONAS} from '../src/engine/medidas.js';
import {mapaDeZonas,huella,prohibidasDe} from '../src/engine/zonas.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||4),S0=+(A[1]||1);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
let total=0;const porTipo={},descartes={};
for(const t of Object.keys(ZONAS.objetos))if(!ZONAS.objetos[t].prohibidas)falla('objeto de la tabla sin zonas prohibidas',{tipo:t});
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),Z=mapaDeZonas(bp),V=bp.vegetacion;
 for(const D of [V.descartes||{},bp.equipamiento.descartes||{}])for(const [k,v] of Object.entries(D))descartes[k]=(descartes[k]||0)+v;
 const cosas=[...V.arboles.map(a=>({...a,tipo:'arbol',sub:a.tipo})),...V.palmeras.map(a=>({...a,tipo:'palmera',sub:a.tipo})),...V.sombrillas.map(a=>({...a,tipo:'sombrilla'})),...bp.equipamiento.map(e=>({...e,sub:e.peatonal?'peatonal':undefined})),...(bp.botines||[]).map(b=>({x:b.x,z:b.z,tipo:'botin',sub:b.objeto}))];
 for(const o of cosas){const R=ZONAS.objetos[o.tipo];if(!R){falla('objeto sin reglas de zona',{semilla:s,tipo:o.tipo});continue;}total++;porTipo[o.tipo]=(porTipo[o.tipo]||0)+1;
  const ej={semilla:s,tipo:o.tipo,...(o.sub?{sub:o.sub}:{}),x:+o.x.toFixed(2),z:+o.z.toFixed(2)};
  const pts=huella(o,o.largo&&o.fondo?0:R.r),vistas=new Set();
  for(const [x,z] of pts)for(const zz of Z.zonas(x,z))if(R.prohibidas.includes(zz))vistas.add(zz);
  for(const zz of vistas)falla(`${o.tipo} en zona prohibida: ${zz}`,ej);
  // su frente: lo que mira (ZONAS.frentes)
  const F=ZONAS.frentes[o.tipo];if(F){if(o.hacia==null)falla(`${o.tipo} sin frente (hacia)`,ej);else{const ux=Math.cos(o.hacia),uz=Math.sin(o.hacia);
   const hasta=sg=>{for(let t=.5;t<=F.ver;t+=.5)for(const q of Z.zonas(o.x+sg*ux*t,o.z+sg*uz*t))if(F.delante.includes(q))return t;return null;},da=hasta(1),db=hasta(-1);
   if(da==null)falla(`${o.tipo} que no mira a ${F.delante.join(' o ')} (a ≤ ${F.ver} m)`,ej);else if(db!=null&&db<da)falla(`${o.tipo} de espaldas a ${F.delante[0]}`,{...ej,delante:da,detras:db});}}
  const solo=R.donde?.[o.sub??'']??R.solo;if(solo){const c=Z.zonas(o.x,o.z);if(!solo.some(q=>c.has(q)))falla(`${o.tipo}${o.sub?':'+o.sub:''} fuera de su zona (${solo.join(' o ')})`,{...ej,zonas:[...c]});}}}
console.log(`${N} mundos · ${total} objetos revisados contra ${Object.keys(ZONAS.objetos).length} reglas de zona (${Object.entries(porTipo).map(([k,v])=>k+' '+v).join(', ')})`);
console.log(`descartados por los generadores (caían en zona prohibida): ${Object.entries(descartes).map(([k,v])=>k+' '+v).join(', ')||'ninguno'}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of [...fallas].sort((a,b)=>b[1].n-a[1].n))console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
