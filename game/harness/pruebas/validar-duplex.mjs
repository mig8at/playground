// Valida los dúplex bajo la mansarda (2026-11-22, engine/duplex.js):
//  · la escalera: adentro de un cuarto de su departamento abajo y del altillo arriba; sin tapar una ventana del muro al
//    que se arrima, sin pisar un aparato de obra ni el paso de una puerta; en metros enteros;
//  · arriba: cada cuarto adentro de la planta del departamento y del edificio, ninguno pisa a otro, todos en metros
//    enteros; el baño y el vestidor con su puerta al altillo; el altillo con al menos una buhardilla si toca una fachada;
//  · el precio: el dúplex vale por metro más que cualquier otro departamento de su edificio.
// Uso: node harness/pruebas/validar-duplex.mjs [ciudades=2] [semilla0=1] [equipo=3]
import {generateBlueprint} from '../../src/engine/blueprint.js';
import {propiedadesDe} from '../../src/engine/propiedades.js';
import {DE_OBRA} from '../../src/engine/entrega.js';
const N=+(process.argv[2]||2),S0=+(process.argv[3]||1),TEAM=+(process.argv[4]||3);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const e=v=>Math.abs(v-Math.round(v))<1e-6,dentro=(a,b,t=.01)=>a.x>=b.x-t&&a.y>=b.y-t&&a.x+a.w<=b.x+b.w+t&&a.y+a.h<=b.y+b.h+t,pisa=(a,b,t=.01)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>t&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>t;
const med={duplex:0,recta:0,caracol:0,edificios:0,unidadesArriba:0,areaArriba:0};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:TEAM}),P=propiedadesDe(bp);
 for(const L of bp.lots){if(!L.duplex)continue;med.edificios++;const top=L.levels[L.floors-1],ej=x=>({ciudad:s,lote:L.id,...x});
  for(const u of L.duplex.unidades){med.duplex++;med[u.escalera.tipo]++;med.areaArriba+=u.area;const E=u.escalera,U=top.units.find(v=>v.n===u.n);
   const q=top.rooms.find(r=>r.id===E.cuarto);if(!q||q.unit!==u.n||!dentro(E,q))falla('la escalera no está adentro de un cuarto de su departamento',ej({n:u.n}));
   if(![E.x,E.y,E.w,E.h].every(e))falla('la escalera fuera del metro entero',ej({n:u.n}));
   if(top.furniture.some(f=>DE_OBRA.has(f.kind)&&pisa(f,E)))falla('la escalera pisa un aparato de obra',ej({n:u.n}));
   for(const d of top.doors){const dh=Math.abs(d.y0-d.y1)<1e-6,x0=Math.min(d.x0,d.x1),x1=Math.max(d.x0,d.x1),y0=Math.min(d.y0,d.y1),y1=Math.max(d.y0,d.y1);if(pisa(dh?{x:x0,y:y0-.9,w:x1-x0,h:1.8}:{x:x0-.9,y:y0,w:1.8,h:y1-y0},E,.05)){falla('la escalera cierra el paso de una puerta',ej({n:u.n}));break;}}
   for(const w of top.windows){const wh=Math.abs(w.y0-w.y1)<1e-6,at=wh?w.y0:w.x0;const toca=wh?(Math.abs(at-E.y)<.05||Math.abs(at-E.y-E.h)<.05)&&Math.min(Math.max(w.x0,w.x1),E.x+E.w)-Math.max(Math.min(w.x0,w.x1),E.x)>.05:(Math.abs(at-E.x)<.05||Math.abs(at-E.x-E.w)<.05)&&Math.min(Math.max(w.y0,w.y1),E.y+E.h)-Math.max(Math.min(w.y0,w.y1),E.y)>.05;if(toca){falla('la escalera tapa una ventana',ej({n:u.n}));break;}}
   const alt=u.rooms.find(r=>r.type==='altillo');if(!alt||!dentro(E,alt))falla('la escalera no llega al altillo',ej({n:u.n}));
   for(const r of u.rooms){med.unidadesArriba++;if(!U||!dentro(r,U))falla('un cuarto de arriba se sale de su departamento',ej({n:u.n,cuarto:r.type}));if(!L.parts.some(p=>dentro(r,{x:p.x,y:p.y,w:p.w,h:p.h})))falla('un cuarto de arriba se sale del edificio',ej({n:u.n,cuarto:r.type}));
    if(![r.x,r.y,r.w,r.h].every(e))falla('un cuarto de arriba fuera del metro entero',ej({n:u.n,cuarto:r.type,medida:`${r.w}×${r.h}`}));
    if(r.type!=='altillo'&&!u.doors.some(d=>d.a===r.id&&d.b===alt?.id))falla('un cuarto de arriba sin puerta al altillo',ej({n:u.n,cuarto:r.type}));}
   for(let i=0;i<u.rooms.length;i++)for(let j=i+1;j<u.rooms.length;j++)if(pisa(u.rooms[i],u.rooms[j]))falla('dos cuartos de arriba se pisan',ej({n:u.n}));
   const fachada=['N','S','W','E'].some(l=>['calle','avenida','patio'].includes(L.sides?.[l])&&(l==='N'?Math.abs(alt.y-L.rect.y)<.05:l==='S'?Math.abs(alt.y+alt.h-L.rect.y-L.rect.h)<.05:l==='W'?Math.abs(alt.x-L.rect.x)<.05:Math.abs(alt.x+alt.w-L.rect.x-L.rect.w)<.05));
   if(fachada&&!u.windows.length)falla('un altillo que da a la fachada sin buhardilla',ej({n:u.n}));}
  // (el precio por metro)
  const ps=P.filter(p=>p.lote===L.id&&p.clase==='departamento'),otros=ps.filter(p=>!p.duplex);for(const p of ps.filter(p=>p.duplex))if(otros.some(o=>o.precio/o.area>=p.precio/p.area))falla('un dúplex que vale por metro menos que otro departamento',ej({id:p.id}));}}
console.log(`dúplex · ${N} ciudades de ${TEAM} por equipo · ${med.duplex} dúplex en ${med.edificios} edificios (escalera recta ${med.recta}, caracol ${med.caracol}) · ${med.unidadesArriba} cuartos arriba, ${Math.round(med.areaArriba)} m² de mansarda que se usan`);
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size?1:0);
