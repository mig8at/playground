// Valida dónde aparece quien entra (2026-11-21, engine/aparecer.js). Por otro camino que el motor se comprueba que:
//  · cada sitio está sobre una casilla de vía, del lado de una manzana, sin tocar árbol, mobiliario ni contenedor;
//  · el sitio elegido es de verdad el menos poblado: ningún otro sitio tiene menos gente (contada acá de nuevo);
//  · entrando de a uno hasta el cupo, la gente queda más repartida que al azar (distancia media al vecino más cercano);
//  · con la ciudad llena no entra nadie, y lo dice.
// Uso: node harness/pruebas/validar-aparecer.mjs [ciudades=2] [semilla0=1]
import {generateBlueprint,CELL} from '../../src/engine/blueprint.js';
import {sitiosDe,aparecerEn,cupoDe,poblar,RADIO} from '../../src/engine/aparecer.js';
const N=+(process.argv[2]||2),S0=+(process.argv[3]||1);const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const vecino=g=>{let s=0;for(let i=0;i<g.length;i++){let m=Infinity;for(let j=0;j<g.length;j++)if(i!==j)m=Math.min(m,Math.hypot(g[i].x-g[j].x,g[i].z-g[j].z));s+=m;}return s/g.length;};
let sitiosT=0,entradas=0,resumen=[];
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),{W,H,kind}=bp.map,sitios=sitiosDe(bp),{cupo,viviendas}=cupoDe(bp);sitiosT+=sitios.length;
 if(sitios.length<50)falla('la ciudad casi no tiene sitios',{ciudad:s,sitios:sitios.length});
 const cosas=[...(bp.vegetacion?.arboles||[]).filter(a=>a.tipo==='calle'||a.tipo==='avenida'),...(bp.equipamiento||[]).filter(e=>e.tipo!=='cebra'),...(bp.contenedores||[])];
 for(const p of sitios){const cx=Math.floor(p.x/CELL),cy=Math.floor(p.z/CELL),k=kind[cy*W+cx];
  if(k!==0&&k!==1)falla('un sitio no está sobre una vía',{ciudad:s,p,k});
  // del borde de su casilla que da a una manzana tiene que quedar a más de 0,6 m (no pegado al muro) y a menos de 3 (sobre el andén)
  const u=p.x-cx*CELL,v=p.z-cy*CELL,alBorde=Math.min(u,CELL-u,v,CELL-v);if(alBorde<.6||alBorde>3)falla('un sitio no está en la franja de paso del andén',{ciudad:s,p,alBorde:+alBorde.toFixed(2)});
  for(const c of cosas)if(Math.hypot(c.x-p.x,c.z-p.z)<.5){falla('un sitio cae encima de algo',{ciudad:s,p,cosa:c.tipo||'contenedor'});break;}}
 // el elegido es el menos poblado, con tres poblaciones distintas
 const cuenta=(p,g)=>g.reduce((a,q)=>{const d=Math.sqrt((q.x-p.x)**2+(q.z-p.z)**2);return d<RADIO?a+(1-d/RADIO)**2:a;},0);
 for(const n of [0,40,Math.min(200,cupo-1)]){const g=poblar(bp,n,s*7+n,sitios),r=aparecerEn(bp,g,{sitios,cupo});entradas++;
  if(!r.ok){falla('no deja entrar con lugar',{ciudad:s,n,razon:r.razon});continue;}
  const mio=cuenta(r,g),menor=Math.min(...sitios.map(p=>cuenta(p,g)));if(mio>menor+1e-6)falla('había un sitio menos poblado',{ciudad:s,n,elegido:+mio.toFixed(3),menor:+menor.toFixed(3)});}
 // llenar de a uno: queda más repartido que al azar
 const lleno=[],hasta=Math.min(cupo,150);for(let i=0;i<hasta;i++){const r=aparecerEn(bp,lleno,{sitios,cupo});if(!r.ok){falla('se negó antes del cupo',{ciudad:s,i,razon:r.razon});break;}lleno.push({x:r.x,z:r.z});entradas++;}
 const azar=poblar(bp,lleno.length,s+99,sitios),dR=vecino(lleno),dA=vecino(azar);if(dR<=dA)falla('entrando de a uno no queda más repartido que al azar',{ciudad:s,repartido:+dR.toFixed(1),azar:+dA.toFixed(1)});
 // llena: no entra nadie
 const tope=aparecerEn(bp,Array.from({length:cupo},()=>({x:0,z:0})),{sitios,cupo});if(tope.ok||!tope.razon)falla('dejó entrar con la ciudad llena',{ciudad:s,cupo});
 resumen.push(`ciudad ${s}: ${sitios.length} sitios, ${viviendas} viviendas, cupo ${cupo}; ${lleno.length} entrando de a uno quedan a ${dR.toFixed(1)} m del vecino (al azar ${dA.toFixed(1)})`);}
console.log(`aparecer · ${N} ciudades · ${sitiosT} sitios, ${entradas} entradas`);for(const l of resumen)console.log('  '+l);
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size?1:0);
