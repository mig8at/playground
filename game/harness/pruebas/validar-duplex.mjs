// Valida los dúplex bajo la mansarda (2026-11-22, engine/duplex.js):
//  · la escalera: recta —sin caracol desde el mismo día—, adentro de un cuarto de su departamento abajo y de lo abierto
//    arriba; sin tapar una ventana más que en la punta del pie, sin pisar un aparato de obra ni el paso de una puerta; en
//    metros enteros;
//  · arriba: cada cuarto adentro de la planta del departamento y del edificio, ninguno pisa a otro, todos en metros
//    enteros; el dormitorio y el baño con su puerta a lo abierto (las buhardillas, una a una contra las del 3D, las
//    cruza validar-duplex-3d); la sala a doble altura sólo sobre lo abierto de abajo; baranda en cada borde entre el piso
//    de arriba y un hueco —el vacío o la escalera— menos la llegada;
//  · abajo, la planta abierta: sin dormitorios y sin tabiques más que los del baño y el cuarto de ropas;
//  · la escalera: arranca con 1 m libre delante y sube por la doble altura hasta el borde del entrepiso;
//  · la cocina con isla: un mesón de 2,4 × 0,9 m o más, a 1 m o más de muros, escalera y del lugar de los aparatos;
//  · el precio: el dúplex vale por metro más que cualquier otro departamento de su edificio.
// Uso: node harness/pruebas/validar-duplex.mjs [ciudades=2] [semilla0=1] [equipo=3]
import {generateBlueprint} from '../../src/engine/blueprint.js';
import {propiedadesDe} from '../../src/engine/propiedades.js';
import {LUGAR_FIJO as DE_OBRA} from '../../src/engine/entrega.js';// (la obra y el lugar de los aparatos que se compran)
import {modulosDeFachada} from '../../src/engine/fachada-piezas.js';
import {CELL} from '../../src/engine/veredas.js';
const N=+(process.argv[2]||2),S0=+(process.argv[3]||1),TEAM=+(process.argv[4]||3);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const e=v=>Math.abs(v-Math.round(v))<1e-6,dentro=(a,b,t=.01)=>a.x>=b.x-t&&a.y>=b.y-t&&a.x+a.w<=b.x+b.w+t&&a.y+a.h<=b.y+b.h+t,pisa=(a,b,t=.01)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>t&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>t;
const med={sueltas:0,enL:0,mansardas:0,terrazas:0,escaleraEnVacio:0,islas:0,dobleAltura:0,duplex:0,recta:0,corta:0,larga:0,edificios:0,unidadesArriba:0,areaArriba:0};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:TEAM}),P=propiedadesDe(bp);
 // (la mansarda, sólo con dúplex y entera: Miguel, «deberían ser todos los edificios que terminan con mansarda dúplex, y aprovechar
 // los espacios»; con el motor anterior quedaban 19 mansardas vacías —sin departamentos arriba— y 13 a medias)
 for(const L of bp.lots){if(!L.mansarda)continue;med.mansardas++;const top=L.levels[L.floors-1];
  if(!L.duplex){falla('una mansarda sin dúplex',{ciudad:s,lote:L.id,tipo:L.type});continue;}
  if((top.corridor||[]).length||top.rooms.some(q=>!L.duplex.unidades.some(u=>u.n===q.unit)))falla('una mansarda a medias: piso de abajo sin dúplex',{ciudad:s,lote:L.id});}
 // (el penthouse en L —Miguel: «haz el penthouse para los edificios en L»—: arriba, el entrepiso cubre la planta entera del
 // edificio —sus partes—, ni más ni menos)
 for(const L of bp.lots){if(!L.duplex?.penthouse||(L.parts||[]).length<2)continue;med.enL++;const u=L.duplex.unidades[0],planta=L.parts.reduce((t,p)=>t+p.w*p.h,0),arriba=u.rooms.reduce((t,q)=>t+q.w*q.h,0);
  if(Math.abs(planta-arriba)>.5)falla('el entrepiso del penthouse en L no cubre la planta',{ciudad:s,lote:L.id,planta,arriba});}
 for(const L of bp.lots){if(!L.duplex)continue;med.edificios++;
  // (el pie de la escalera no da a un balcón —Miguel: «la escalera debería estar al revés, no desde el balcón»—: los balcones
  // que arma la fachada en el último piso, contra el borde del pie de cada escalera)
  {const balc=modulosDeFachada(bp,L).filter(m=>m.tipo==='balcon'&&m.f===L.floors-1).map(m=>{const ex=(m.x+.5+m.dx*.5)*CELL,ez=(m.y+.5+m.dy*.5)*CELL,t=[m.dy,-m.dx];return [ex+t[0]*(m.k-1)*2,ez+t[1]*(m.k-1)*2];});
   for(const u of L.duplex.unidades){const E=u.escalera;if(balc.some(([x,z])=>Math.hypot(x-E.pie[0],z-E.pie[1])<.9))falla('la escalera arranca frente a un balcón',{ciudad:s,lote:L.id,n:u.n});}}const top=L.levels[L.floors-1],ej=x=>({ciudad:s,lote:L.id,...x});
  for(const u of L.duplex.unidades){med.duplex++;med[u.escalera.tipo]=(med[u.escalera.tipo]||0)+1;med[u.escalera.peldanos<15?'corta':'larga']++;if(u.escalera.tipo!=='recta')falla('una escalera que no es recta',ej({n:u.n,tipo:u.escalera.tipo}));med.areaArriba+=u.area;const E=u.escalera,U=top.units.find(v=>v.n===u.n);
   const q=top.rooms.find(r=>r.id===E.cuarto);if(!q||q.unit!==u.n||!dentro(E,q))falla('la escalera no está adentro de un cuarto de su departamento',ej({n:u.n}));
   if(![E.x,E.y,E.w,E.h].every(e))falla('la escalera fuera del metro entero',ej({n:u.n}));
   // (el arranque: 1 m de piso libre delante del pie, adentro de su cuarto —Miguel: «el inicio de la escalera contra la pared» no—)
   if(q){const d=[E.pie[0]-E.llegada[0],E.pie[1]-E.llegada[1]],l=Math.hypot(...d),x=E.pie[0]+d[0]/l,z=E.pie[1]+d[1]/l,dentroQ=x>q.x-.01&&x<q.x+q.w+.01&&z>q.y-.01&&z<q.y+q.h+.01;if(!dentroQ)falla('la escalera arranca contra un muro',ej({n:u.n}));}
   // (arrimada a un muro en todo su largo: el lado largo de la escalera que cae sobre un borde de su cuarto, sin ningún vano
   // abierto encima —Miguel: «la escalera no puede quedar así», suelta contra el paso entre la sala y el comedor—)
   if(q){const ax=E.eje==='x',lados=ax?[E.y,E.y+E.h].filter(f=>Math.abs(f-q.y)<.05||Math.abs(f-q.y-q.h)<.05):[E.x,E.x+E.w].filter(f=>Math.abs(f-q.x)<.05||Math.abs(f-q.x-q.w)<.05),a0=ax?E.x:E.y,a1=a0+(ax?E.w:E.h);
    const libre=f=>!top.doors.some(d=>d.wide&&(ax?Math.abs(d.y0-f)<.05&&Math.abs(d.y1-f)<.05&&Math.min(Math.max(d.x0,d.x1),a1)-Math.max(Math.min(d.x0,d.x1),a0)>.01:Math.abs(d.x0-f)<.05&&Math.abs(d.x1-f)<.05&&Math.min(Math.max(d.y0,d.y1),a1)-Math.max(Math.min(d.y0,d.y1),a0)>.01));
    // (suelta —sin muro al lado— sí, pero con su apoyo en el centro: Miguel, «si puede estar sin una pared, puede tener un apoyo
    // en el centro de la escalera»)
    if(!lados.some(libre)&&E.apoyo!=='centro')falla('la escalera suelta sin su apoyo en el centro',ej({n:u.n}));
    if(lados.some(libre)&&E.apoyo==='centro')falla('la escalera con apoyo en el centro estando contra un muro',ej({n:u.n}));
    if(E.objeto!=='escalera_flotante')falla('la escalera sin su objeto del catálogo',ej({n:u.n}));if(E.apoyo==='centro')med.sueltas++;}
   if(top.furniture.some(f=>DE_OBRA.has(f.kind)&&pisa(f,E)))falla('la escalera pisa un aparato de obra',ej({n:u.n}));
   for(const d of top.doors){const dh=Math.abs(d.y0-d.y1)<1e-6,x0=Math.min(d.x0,d.x1),x1=Math.max(d.x0,d.x1),y0=Math.min(d.y0,d.y1),y1=Math.max(d.y0,d.y1);
    if(d.wide){const z=dh?{x:x0,y:y0-.5,w:x1-x0,h:1}:{x:x0-.5,y:y0,w:1,h:y1-y0};if(pisa(z,E,.01)&&(dh?x1-x0-(Math.min(x1,E.x+E.w)-Math.max(x0,E.x)):y1-y0-(Math.min(y1,E.y+E.h)-Math.max(y0,E.y)))<1-1e-6){falla('la escalera deja menos de 1 m en un vano abierto',ej({n:u.n}));break;}continue;}
    if(pisa(dh?{x:x0,y:y0-.9,w:x1-x0,h:1.8}:{x:x0-.9,y:y0,w:1.8,h:y1-y0},E,.05)){falla('la escalera cierra el paso de una puerta',ej({n:u.n}));break;}}
   for(const w of top.windows){const wh=Math.abs(w.y0-w.y1)<1e-6,at=wh?w.y0:w.x0;const toca=wh?(Math.abs(at-E.y)<.05||Math.abs(at-E.y-E.h)<.05)&&Math.min(Math.max(w.x0,w.x1),E.x+E.w)-Math.max(Math.min(w.x0,w.x1),E.x)>.05:(Math.abs(at-E.x)<.05||Math.abs(at-E.x-E.w)<.05)&&Math.min(Math.max(w.y0,w.y1),E.y+E.h)-Math.max(Math.min(w.y0,w.y1),E.y)>.05;const enPie=wh?Math.abs(at-E.pie[1])<.05:Math.abs(at-E.pie[0])<.05;if(toca&&!enPie){falla('la escalera tapa una ventana',ej({n:u.n}));break;}}
   // (abajo, la planta abierta: ningún dormitorio, y entre dos cuartos que no son el baño ni el de ropas, toda pared compartida es vano abierto, hasta la cara del muro de al lado en cada punta, menos el muro que levanta la escalera)
   {const qs=top.rooms.filter(r=>r.unit===u.n),ab=qs.filter(r=>!['bano','ropas','deposito'].includes(r.type));if(qs.some(r=>r.type==='dormitorio'))falla('un dormitorio abajo en un dúplex',ej({n:u.n}));
    for(let i=0;i<ab.length;i++)for(let j=i+1;j<ab.length;j++){const a=ab[i],b=ab[j];for(const [h,fa,fb,a0,a1,b0,b1] of [[true,a.y+a.h,b.y,a.x,a.x+a.w,b.x,b.x+b.w],[true,b.y+b.h,a.y,a.x,a.x+a.w,b.x,b.x+b.w],[false,a.x+a.w,b.x,a.y,a.y+a.h,b.y,b.y+b.h],[false,b.x+b.w,a.x,a.y,a.y+a.h,b.y,b.y+b.h]]){
     if(Math.abs(fa-fb)>.05)continue;const p=Math.max(a0,b0),q=Math.min(a1,b1);if(q-p<.5)continue;const vano=top.doors.filter(d=>d.wide&&(h?Math.abs(d.y0-fa)<.05:Math.abs(d.x0-fa)<.05)).reduce((t,d)=>t+Math.max(0,Math.min(q,h?Math.max(d.x0,d.x1):Math.max(d.y0,d.y1))-Math.max(p,h?Math.min(d.x0,d.x1):Math.min(d.y0,d.y1))),0);
     const muroEsc=u.escalera.muroPropio&&(h?Math.abs(u.escalera.y-fa)<.05||Math.abs(u.escalera.y+u.escalera.h-fa)<.05:Math.abs(u.escalera.x-fa)<.05||Math.abs(u.escalera.x+u.escalera.w-fa)<.05)?Math.max(0,Math.min(q,(h?u.escalera.x+u.escalera.w:u.escalera.y+u.escalera.h)+.9)-Math.max(p,(h?u.escalera.x:u.escalera.y)-.9)):0;
     if(q-p>=1.9&&vano+muroEsc<q-p-.55)falla('un tabique en la planta abierta del dúplex',ej({n:u.n,entre:a.type+'/'+b.type}));}}}
   const alt=u.rooms.find(r=>r.abierto);if(!alt||!dentro(E,alt))falla('la escalera no llega a lo abierto de arriba',ej({n:u.n}));
   // (la sala a doble altura y las barandas, en la grilla de 1 m: el vacío sólo sobre cuartos abiertos de abajo; cada borde
   // entre el piso de arriba y un hueco —el vacío o la escalera— con baranda, menos la llegada; ninguna en la llegada)
   {const qsA=top.rooms.filter(r=>r.unit===u.n),cel=(x,z)=>{const p=[x+.5,z+.5],en=r=>p[0]>r.x&&p[0]<r.x+r.w&&p[1]>r.y&&p[1]<r.y+r.h;return en(E)?'hueco':(u.vacios||[]).some(en)?'vacio':alt&&en(alt)?'piso':'otro';};
    // (la escalera sube por la doble altura y llega al borde del entrepiso: el vacío la contiene; si el vacío va aparte, no la toca)
    for(const v of u.vacios||[]){const contiene=E.x>=v.x-.01&&E.y>=v.y-.01&&E.x+E.w<=v.x+v.w+.01&&E.y+E.h<=v.y+v.h+.01;if(v.conEscalera&&!contiene)falla('el vacío dice que contiene la escalera y no la contiene',ej({n:u.n}));if(contiene)med.escaleraEnVacio++;}
    for(const v of (u.vacios||[]).filter(v=>!v.conEscalera))if(Math.min(v.x+v.w,E.x+E.w)-Math.max(v.x,E.x)>-.01&&Math.min(v.y+v.h,E.y+E.h)-Math.max(v.y,E.y)>-.01&&!(Math.min(v.x+v.w,E.x+E.w)-Math.max(v.x,E.x)<.01&&Math.min(v.y+v.h,E.y+E.h)-Math.max(v.y,E.y)<.01))falla('el vacío de la doble altura pegado al hueco de la escalera',ej({n:u.n}));
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
   // (la cocina con isla —Miguel: «el mesón en el centro, y la estufa, y no contra la pared»—: el mesón y la estufa de la isla,
   // a 1 m o más de todo muro —el borde del departamento, un cuarto cerrado—, de la escalera, de la nevera y de los demás aparatos)
   if(u.isla){med.islas++;const I=u.isla,dist=(a,b)=>Math.hypot(Math.max(0,a.x-(b.x+b.w),b.x-(a.x+a.w)),Math.max(0,a.y-(b.y+b.h),b.y-(a.y+a.h)));
    const piezas=top.furniture.filter(f=>f.isla);if(piezas.length!==1||piezas[0].kind!=='meson'||Math.max(piezas[0].w,piezas[0].h)<2.4-1e-6||Math.min(piezas[0].w,piezas[0].h)<.9-1e-6)falla('la isla no es un mesón de 2,4 × 0,9 m o más',ej({n:u.n}));
    const borde=Math.min(I.x-U.x,U.x+U.w-I.x-I.w,I.y-U.y,U.y+U.h-I.y-I.h);if(borde<.99)falla('la isla contra un muro del departamento',ej({n:u.n,m:+borde.toFixed(2)}));
    for(const r of top.rooms.filter(r=>r.unit===u.n&&!r.abierto))if(dist(I,r)<.99)falla('la isla contra un cuarto cerrado',ej({n:u.n,cuarto:r.type,m:+dist(I,r).toFixed(2)}));
    if(dist(I,E)<.99)falla('la isla pegada a la escalera',ej({n:u.n}));
    for(const f of top.furniture)if(!f.isla&&DE_OBRA.has(f.kind)&&dist(I,f)<.99&&dist(f,U)===0&&f.x>=U.x&&f.x<=U.x+U.w&&f.y>=U.y&&f.y<=U.y+U.h)falla('la isla pegada a un aparato',ej({n:u.n,aparato:f.kind,m:+dist(I,f).toFixed(2)}));}
   // (abajo, a cada cuarto se llega desde la puerta de entrada, de puerta en puerta: el muro de la escalera no deja a nadie aislado)
   {const qsU=top.rooms.filter(r=>r.unit===u.n),ids=new Set(qsU.map(r=>r.id)),ady=new Map(qsU.map(r=>[r.id,[]])),vis=new Set(),cola=[];
    for(const d of top.doors){const a=ids.has(d.a),b=ids.has(d.b);if(a&&b){ady.get(d.a).push(d.b);ady.get(d.b).push(d.a);}else if(a!==b){const r=a?d.a:d.b;if(!vis.has(r)){vis.add(r);cola.push(r);}}}
    while(cola.length){const r=cola.pop();for(const o of ady.get(r))if(!vis.has(o)){vis.add(o);cola.push(o);}}
    for(const r of qsU)if(!vis.has(r.id))falla('un cuarto de abajo al que no se llega desde la entrada',ej({n:u.n,cuarto:r.type}));}
   // (las buhardillas, una a una contra las del 3D: validar-duplex-3d)
   }
  // (la terraza corrida —Miguel: «balcones más modernos y amplios», «en el piso de abajo»—: la casilla entera, sus tres módulos,
  // en el piso de abajo del dúplex)
  {const ts=modulosDeFachada(bp,L).filter(m=>m.tipo==='terraza'),porCasilla=new Map();for(const m of ts){if(m.f!==L.floors-1)falla('una terraza fuera del piso de abajo del dúplex',{ciudad:s,lote:L.id,f:m.f});const k=`${m.x},${m.y},${m.dx},${m.dy}`;porCasilla.set(k,(porCasilla.get(k)||0)+1);}
   for(const [k,n] of porCasilla)if(n!==3)falla('una terraza que no ocupa la casilla entera',{ciudad:s,lote:L.id,casilla:k,modulos:n});med.terrazas+=porCasilla.size;}
  // (el precio por metro)
  const ps=P.filter(p=>p.lote===L.id&&p.clase==='departamento'),otros=ps.filter(p=>!p.duplex);for(const p of ps.filter(p=>p.duplex))if(otros.some(o=>o.precio/o.area>=p.precio/p.area))falla('un dúplex que vale por metro menos que otro departamento',ej({id:p.id}));}}
console.log(`dúplex · ${N} ciudades de ${TEAM} por equipo · ${med.mansardas} mansardas, todas con dúplex entero (${med.enL} penthouses en L) · ${med.duplex} dúplex en ${med.edificios} edificios (escaleras rectas: ${med.larga} de 4 m, ${med.corta} de 3 m, ${med.sueltas} sueltas con apoyo central; ${med.dobleAltura} con la sala a doble altura; ${med.islas} con cocina de isla; ${med.escaleraEnVacio} con la escalera dentro de la doble altura; ${med.terrazas} terrazas corridas) · ${med.unidadesArriba} cuartos arriba, ${Math.round(med.areaArriba)} m² de mansarda que se usan`);
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size?1:0);
