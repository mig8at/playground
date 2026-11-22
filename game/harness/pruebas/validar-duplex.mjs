// Valida los dúplex bajo la mansarda (2026-11-22, engine/duplex.js):
//  · la escalera: recta —sin caracol desde el mismo día—, adentro de un cuarto de su departamento abajo y de lo abierto
//    arriba; sin tapar una ventana más que en la punta del pie, sin pisar un aparato de obra ni el paso de una puerta; en
//    metros enteros;
//  · arriba: cada cuarto adentro de la planta del departamento y del edificio, ninguno pisa a otro, todos en metros
//    enteros; el dormitorio y el baño con su puerta a lo abierto (las buhardillas, una a una contra las del 3D, las
//    cruza validar-duplex-3d); la sala a doble altura sólo sobre lo abierto de abajo; baranda en cada borde entre el piso
//    de arriba y un hueco —el vacío o la escalera— menos la llegada;
//  · abajo, la planta abierta: sin dormitorios y sin tabiques más que los del baño y el cuarto de ropas;
//  · el precio: el dúplex vale por metro más que cualquier otro departamento de su edificio.
// Uso: node harness/pruebas/validar-duplex.mjs [ciudades=2] [semilla0=1] [equipo=3]
import {generateBlueprint} from '../../src/engine/blueprint.js';
import {propiedadesDe} from '../../src/engine/propiedades.js';
import {DE_OBRA} from '../../src/engine/entrega.js';
import {modulosDeFachada} from '../../src/engine/fachada-piezas.js';
import {CELL} from '../../src/engine/veredas.js';
const N=+(process.argv[2]||2),S0=+(process.argv[3]||1),TEAM=+(process.argv[4]||3);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const e=v=>Math.abs(v-Math.round(v))<1e-6,dentro=(a,b,t=.01)=>a.x>=b.x-t&&a.y>=b.y-t&&a.x+a.w<=b.x+b.w+t&&a.y+a.h<=b.y+b.h+t,pisa=(a,b,t=.01)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>t&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>t;
const med={dobleAltura:0,duplex:0,recta:0,corta:0,larga:0,edificios:0,unidadesArriba:0,areaArriba:0};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:TEAM}),P=propiedadesDe(bp);
 for(const L of bp.lots){if(!L.duplex)continue;med.edificios++;
  // (el pie de la escalera no da a un balcón —Miguel: «la escalera debería estar al revés, no desde el balcón»—: los balcones
  // que arma la fachada en el último piso, contra el borde del pie de cada escalera)
  {const balc=modulosDeFachada(bp,L).filter(m=>m.tipo==='balcon'&&m.f===L.floors-1).map(m=>{const ex=(m.x+.5+m.dx*.5)*CELL,ez=(m.y+.5+m.dy*.5)*CELL,t=[m.dy,-m.dx];return [ex+t[0]*(m.k-1)*2,ez+t[1]*(m.k-1)*2];});
   for(const u of L.duplex.unidades){const E=u.escalera;if(balc.some(([x,z])=>Math.hypot(x-E.pie[0],z-E.pie[1])<.9))falla('la escalera arranca frente a un balcón',{ciudad:s,lote:L.id,n:u.n});}}const top=L.levels[L.floors-1],ej=x=>({ciudad:s,lote:L.id,...x});
  for(const u of L.duplex.unidades){med.duplex++;med[u.escalera.tipo]=(med[u.escalera.tipo]||0)+1;med[u.escalera.peldanos<15?'corta':'larga']++;if(u.escalera.tipo!=='recta')falla('una escalera que no es recta',ej({n:u.n,tipo:u.escalera.tipo}));med.areaArriba+=u.area;const E=u.escalera,U=top.units.find(v=>v.n===u.n);
   const q=top.rooms.find(r=>r.id===E.cuarto);if(!q||q.unit!==u.n||!dentro(E,q))falla('la escalera no está adentro de un cuarto de su departamento',ej({n:u.n}));
   if(![E.x,E.y,E.w,E.h].every(e))falla('la escalera fuera del metro entero',ej({n:u.n}));
   if(top.furniture.some(f=>DE_OBRA.has(f.kind)&&pisa(f,E)))falla('la escalera pisa un aparato de obra',ej({n:u.n}));
   for(const d of top.doors){const dh=Math.abs(d.y0-d.y1)<1e-6,x0=Math.min(d.x0,d.x1),x1=Math.max(d.x0,d.x1),y0=Math.min(d.y0,d.y1),y1=Math.max(d.y0,d.y1);
    if(d.wide){const z=dh?{x:x0,y:y0-.5,w:x1-x0,h:1}:{x:x0-.5,y:y0,w:1,h:y1-y0};if(pisa(z,E,.01)&&(dh?x1-x0-(Math.min(x1,E.x+E.w)-Math.max(x0,E.x)):y1-y0-(Math.min(y1,E.y+E.h)-Math.max(y0,E.y)))<1-1e-6){falla('la escalera deja menos de 1 m en un vano abierto',ej({n:u.n}));break;}continue;}
    if(pisa(dh?{x:x0,y:y0-.9,w:x1-x0,h:1.8}:{x:x0-.9,y:y0,w:1.8,h:y1-y0},E,.05)){falla('la escalera cierra el paso de una puerta',ej({n:u.n}));break;}}
   for(const w of top.windows){const wh=Math.abs(w.y0-w.y1)<1e-6,at=wh?w.y0:w.x0;const toca=wh?(Math.abs(at-E.y)<.05||Math.abs(at-E.y-E.h)<.05)&&Math.min(Math.max(w.x0,w.x1),E.x+E.w)-Math.max(Math.min(w.x0,w.x1),E.x)>.05:(Math.abs(at-E.x)<.05||Math.abs(at-E.x-E.w)<.05)&&Math.min(Math.max(w.y0,w.y1),E.y+E.h)-Math.max(Math.min(w.y0,w.y1),E.y)>.05;const enPie=wh?Math.abs(at-E.pie[1])<.05:Math.abs(at-E.pie[0])<.05;if(toca&&!enPie){falla('la escalera tapa una ventana',ej({n:u.n}));break;}}
   // (abajo, la planta abierta: ningún dormitorio, y entre dos cuartos que no son el baño ni el de ropas, toda pared compartida es vano abierto, menos 30 cm de pilar en cada punta)
   {const qs=top.rooms.filter(r=>r.unit===u.n),ab=qs.filter(r=>!['bano','ropas'].includes(r.type));if(qs.some(r=>r.type==='dormitorio'))falla('un dormitorio abajo en un dúplex',ej({n:u.n}));
    for(let i=0;i<ab.length;i++)for(let j=i+1;j<ab.length;j++){const a=ab[i],b=ab[j];for(const [h,fa,fb,a0,a1,b0,b1] of [[true,a.y+a.h,b.y,a.x,a.x+a.w,b.x,b.x+b.w],[true,b.y+b.h,a.y,a.x,a.x+a.w,b.x,b.x+b.w],[false,a.x+a.w,b.x,a.y,a.y+a.h,b.y,b.y+b.h],[false,b.x+b.w,a.x,a.y,a.y+a.h,b.y,b.y+b.h]]){
     if(Math.abs(fa-fb)>.05)continue;const p=Math.max(a0,b0),q=Math.min(a1,b1);if(q-p<.5)continue;const vano=top.doors.filter(d=>d.wide&&(h?Math.abs(d.y0-fa)<.05:Math.abs(d.x0-fa)<.05)).reduce((t,d)=>t+Math.max(0,Math.min(q,h?Math.max(d.x0,d.x1):Math.max(d.y0,d.y1))-Math.max(p,h?Math.min(d.x0,d.x1):Math.min(d.y0,d.y1))),0);
     if(q-p>=1.9&&vano<q-p-.65)falla('un tabique en la planta abierta del dúplex',ej({n:u.n,entre:a.type+'/'+b.type}));}}}
   const alt=u.rooms.find(r=>r.abierto);if(!alt||!dentro(E,alt))falla('la escalera no llega a lo abierto de arriba',ej({n:u.n}));
   // (la sala a doble altura y las barandas, en la grilla de 1 m: el vacío sólo sobre cuartos abiertos de abajo; cada borde
   // entre el piso de arriba y un hueco —el vacío o la escalera— con baranda, menos la llegada; ninguna en la llegada)
   {const qsA=top.rooms.filter(r=>r.unit===u.n),cel=(x,z)=>{const p=[x+.5,z+.5],en=r=>p[0]>r.x&&p[0]<r.x+r.w&&p[1]>r.y&&p[1]<r.y+r.h;return en(E)?'hueco':(u.vacios||[]).some(en)?'vacio':alt&&en(alt)?'piso':'otro';};
    for(const v of u.vacios||[])for(let z=v.y;z<v.y+v.h;z++)for(let x=v.x;x<v.x+v.w;x++){const q=qsA.find(r=>x+.5>r.x&&x+.5<r.x+r.w&&z+.5>r.y&&z+.5<r.y+r.h);if(!q?.abierto){falla('el vacío de la doble altura sobre un cuarto cerrado de abajo',ej({n:u.n,abajo:q?.type}));break;}}
    const dl=E.eje==='x'?[Math.sign(E.llegada[0]-E.pie[0]),0]:[0,Math.sign(E.llegada[1]-E.pie[1])],lc=E.eje==='x'?[dl[0]>0?E.x+E.w:E.x-1,E.y]:[E.x,dl[1]>0?E.y+E.h:E.y-1];
    const cubre=(x0,y0,x1,y1)=>(u.barandas||[]).some(b=>x0===x1?b.x0===x0&&b.x1===x0&&Math.min(b.y0,b.y1)<=y0+1e-6&&Math.max(b.y0,b.y1)>=y1-1e-6:b.y0===y0&&b.y1===y0&&Math.min(b.x0,b.x1)<=x0+1e-6&&Math.max(b.x0,b.x1)>=x1-1e-6);
    for(let z=U.y;z<U.y+U.h;z++)for(let x=U.x;x<U.x+U.w;x++)for(const [dx,dz] of [[1,0],[0,1]]){const nx=x+dx,nz=z+dz;if(nx>=U.x+U.w||nz>=U.y+U.h)continue;const a=cel(x,z),b=cel(nx,nz),abre=t=>t==='hueco'||t==='vacio';
     if(!((abre(a)&&b==='piso')||(abre(b)&&a==='piso')))continue;const pz=a==='piso'?[x,z]:[nx,nz],llegada=pz[0]===lc[0]&&pz[1]===lc[1]&&(a==='hueco'||b==='hueco');
     const seg=dx?[nx,z,nx,z+1]:[x,nz,x+1,nz];if(llegada){if(cubre(...seg))falla('baranda en la llegada de la escalera',ej({n:u.n}));}else if(!cubre(...seg))falla('un borde entre el piso de arriba y un hueco sin baranda',ej({n:u.n,en:seg.join(',')}));}
    if(u.vacios?.length)med.dobleAltura++;}
   for(const r of u.rooms){med.unidadesArriba++;if(!U||!dentro(r,U))falla('un cuarto de arriba se sale de su departamento',ej({n:u.n,cuarto:r.type}));if(!L.parts.some(p=>dentro(r,{x:p.x,y:p.y,w:p.w,h:p.h})))falla('un cuarto de arriba se sale del edificio',ej({n:u.n,cuarto:r.type}));
    if(![r.x,r.y,r.w,r.h].every(e))falla('un cuarto de arriba fuera del metro entero',ej({n:u.n,cuarto:r.type,medida:`${r.w}×${r.h}`}));
    if(!r.abierto&&!u.doors.some(d=>d.a===r.id&&d.b===alt?.id))falla('un cuarto de arriba sin puerta a lo abierto',ej({n:u.n,cuarto:r.type}));}
   for(let i=0;i<u.rooms.length;i++)for(let j=i+1;j<u.rooms.length;j++)if(pisa(u.rooms[i],u.rooms[j]))falla('dos cuartos de arriba se pisan',ej({n:u.n}));
   // (las buhardillas, una a una contra las del 3D: validar-duplex-3d)
   }
  // (el precio por metro)
  const ps=P.filter(p=>p.lote===L.id&&p.clase==='departamento'),otros=ps.filter(p=>!p.duplex);for(const p of ps.filter(p=>p.duplex))if(otros.some(o=>o.precio/o.area>=p.precio/p.area))falla('un dúplex que vale por metro menos que otro departamento',ej({id:p.id}));}}
console.log(`dúplex · ${N} ciudades de ${TEAM} por equipo · ${med.duplex} dúplex en ${med.edificios} edificios (escaleras rectas: ${med.larga} de 4 m, ${med.corta} de 3 m; ${med.dobleAltura} con la sala a doble altura) · ${med.unidadesArriba} cuartos arriba, ${Math.round(med.areaArriba)} m² de mansarda que se usan`);
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size?1:0);
