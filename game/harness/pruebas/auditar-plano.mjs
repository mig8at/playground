// LA AUDITORÍA DEL PLANO (2026-11-20, Miguel: «el mapa debe ser muy estable, calibrá todo en el 2D, hacé una lista y andá
// mejorando uno a uno»). No es una prueba de pasa o no pasa —eso es el probador—: mide, en varias ciudades, lo que todavía
// se puede calibrar, y lo dice como una lista ordenada de más a menos casos. Cada renglón es una cuenta con sus ejemplos
// (ciudad, lote, piso, y qué), para ir a mirarlo en /plano.
//   · LOS MODELOS: lo que el plano reserva para cada mueble contra lo que mide el modelo que lo dibuja (muebles-medidos.js).
//   · EL PLANO: muebles que se pisan o se salen de su cuarto, cuartos vacíos, baños, ventanas, ensanches, casas del monte.
//   · AFUERA: mobiliario encimado o dentro de un edificio, troncos y copas contra los edificios, las azoteas.
//   · LA ESTABILIDAD: la misma semilla da el mismo plano, y cuánto cambia cada medida de una ciudad a otra.
// Uso: node harness/pruebas/auditar-plano.mjs [ciudades=4] [semilla0=1] [--equipo=3] [--json]
import {createHash} from 'node:crypto';
import {generateBlueprint,SIZES} from '../../src/engine/blueprint.js';
import {MUEBLES_MEDIDOS} from '../../src/engine/muebles-medidos.js';

const args=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=Number(args[0])||4,S0=Number(args[1])||1,JSON_OUT=process.argv.includes('--json'),TEAM=Number((process.argv.find(a=>a.startsWith('--equipo='))||'').split('=')[1])||3;// (--equipo=12: el tamaño de la ciudad)
const hallazgos=new Map();
const anota=(grupo,clave,ej)=>{const k=grupo+' · '+clave,h=hallazgos.get(k)||hallazgos.set(k,{grupo,clave,n:0,ej:[]}).get(k);h.n++;if(h.ej.length<4&&ej)h.ej.push(ej);};
const medidas={};const mide=(k,v)=>(medidas[k]||(medidas[k]=[])).push(v);

// ---------- 1. Los modelos contra el plano ----------
// (el modelo no puede pasar de lo que el plano le reserva —chocaría con el vecino o con la pared—; y si mide bastante
// menos, el plano está reservando un lugar que no se usa. Tolerancia: 20 mm de más, 15 % de menos.)
const modelos=[];
// (lo que se fabrica a medida —el mesón, el armario: SIZES en blueprint.js— cambia de tamaño en cada cuarto y el 3D estira
// su modelo: ahí no hay una medida que comparar. `estado` lo dice quien midió: «cabe», «cabe girado» —el modelo se midió
// con los ejes al revés— o «se achica al N %», que es un modelo más grande que su lugar: se ve encogido.)
for(const [k,m] of Object.entries(MUEBLES_MEDIDOS)){if(!m.plan||!m.modelo)continue;const girado=/girado/.test(m.estado||''),aMedida=!!SIZES[k];
 if(/achica/.test(m.estado||''))anota('modelos','un modelo más grande que su lugar: el 3D lo encoge',`${k}: ${m.estado} (plano ${m.plan.ancho} × ${m.plan.fondo} mm, modelo ${m.modelo.ancho} × ${m.modelo.fondo})`);
 for(const eje of ['ancho','fondo']){const p=m.plan[eje],q=m.modelo[girado?(eje==='ancho'?'fondo':'ancho'):eje];if(p==null||q==null)continue;const d=q-p;
  if(!aMedida&&d>20&&!/achica/.test(m.estado||''))anota('modelos','el modelo pasa de lo que reserva el plano',`${k} ${eje}: plano ${p} mm, modelo ${q} (+${d})`);
  else if(!aMedida&&d<-.15*p)anota('modelos','el plano reserva de más (el modelo es más chico)',`${k} ${eje}: plano ${p} mm, modelo ${q} (${d})`);
  modelos.push({k,eje,plan:p,modelo:q,dif:d,aMedida});}}

// ---------- 2 a 4. Cada ciudad ----------
const dentroDe=(f,q,t=.01)=>f.x>=q.x-t&&f.y>=q.y-t&&f.x+f.w<=q.x+q.w+t&&f.y+f.h<=q.y+q.h+t;
const pisa=(a,b,t=.05)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,a.x>b.x?a.x:b.x)>t&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>t;
const VACIOS_OK=new Set(['hall','entrada','vestibulo']);// (de paso: pueden ir sin muebles)
const firma=bp=>createHash('sha1').update(JSON.stringify([bp.lots.map(L=>[L.id,L.type,L.floors,L.rect,L.levels.map(lv=>[lv.rooms.length,lv.furniture.map(f=>[f.kind,f.x,f.y,f.w,f.h]),lv.doors.length,lv.windows.length])]),bp.equipamiento?.length,bp.vegetacion?.arboles?.length])).digest('hex').slice(0,12);
const t00=Date.now();
for(let s=S0;s<S0+N;s++){const t0=Date.now(),bp=generateBlueprint({seed:s,team:TEAM}),ms=Date.now()-t0,en=(L,lv,x)=>`ciudad ${s} lote ${L.id} (${L.type}) piso ${lv.level}: ${x}`;
 mide('segundos por ciudad',+(ms/1000).toFixed(1));
 // la misma semilla, el mismo plano
 if(firma(generateBlueprint({seed:s,team:TEAM}))!==firma(bp))anota('estabilidad','la misma semilla dio dos planos distintos',`ciudad ${s}`);
 let cuartos=0,muebles=0,banos=0,pisosViv=0;
 for(const L of bp.lots){const huella=L.parts.reduce((a,P)=>a+P.w*P.h,0);
  for(const lv of L.levels.slice(0,L.floors)){
   for(const f of lv.furniture){muebles++;if(!lv.rooms.some(q=>dentroDe(f,q))&&!lv.corridor.some(q=>dentroDe(f,q)))anota('plano','un mueble se sale de su cuarto',en(L,lv,`${f.kind} en ${f.x.toFixed(2)},${f.y.toFixed(2)}`));}
   for(const q of lv.rooms){cuartos++;const fs=lv.furniture.filter(f=>dentroDe(f,q));
    if(!fs.length&&!VACIOS_OK.has(q.type))anota('plano','un cuarto sin ningún mueble',en(L,lv,`${q.type} de ${q.w}×${q.h} m`));
    // (una silla metida hasta 25 cm bajo su mesa no es pisarse: está arrimada)
    for(let i=0;i<fs.length;i++)for(let j=i+1;j<fs.length;j++){const a=fs[i],b=fs[j],ox=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x),oy=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);if(ox<=.05||oy<=.05)continue;
     const ks=[a.kind,b.kind],arrimada=ks.includes('silla')&&ks.some(k=>/^(mesa|escritorio|pupitre)/.test(k))&&Math.min(ox,oy)<=.25;if(!arrimada)anota('plano','dos muebles se pisan',en(L,lv,`${a.kind} y ${b.kind} en un ${q.type} (${ox.toFixed(2)} × ${oy.toFixed(2)} m)`));}
    if(q.mov?.sinUso?.length)anota('plano','un mueble que no se puede usar',en(L,lv,`${q.mov.sinUso.join(', ')} en un ${q.type}`));
    if(!lv.doors.some(d=>d.a===q.id||d.b===q.id))anota('plano','un cuarto sin puerta',en(L,lv,q.type));
    if(q.type==='bano'){banos++;const propio=q.unit||lv.doors.some(d=>{const o=d.a===q.id?d.b:d.b===q.id?d.a:null;return o!=null&&lv.rooms.some(r=>r.id===o);})||L.type==='casa';
     const aseo=fs.some(f=>f.kind==='ducha'||f.kind==='tina');
     if(propio&&!aseo)anota('plano','un baño de vivienda o habitación sin ducha',en(L,lv,`${q.w}×${q.h} m`));
     if(!fs.some(f=>f.kind==='inodoro'))anota('plano','un baño sin inodoro',en(L,lv,`${q.w}×${q.h} m`));
     // (un sanitario de varios puestos —dos inodoros o más— sí puede ser grande)
     if(q.w*q.h>10&&fs.filter(f=>f.kind==='inodoro').length<2)anota('plano','un baño de más de 10 m²',en(L,lv,`${q.w}×${q.h} m = ${q.w*q.h} m²`));}
    if(['dormitorio','habitacion','habitacion_h'].includes(q.type)&&!fs.some(f=>/^(cama|catre|litera)/.test(f.kind)))anota('plano','una alcoba sin cama',en(L,lv,`${q.type} de ${q.w}×${q.h} m`));}
   // el ensanche del pasillo
   if(L.type==='vivienda'&&lv.level>0){pisosViv++;const e=lv.corridor.filter(q=>q.ensanche).reduce((a,q)=>a+q.w*q.h,0);if(e/huella>.15)anota('plano','un ensanche de más del 15 % del piso',en(L,lv,`${Math.round(e/huella*100)} %`));}
   // las ventanas: en el eje del módulo, y sin pisar a medias a la de abajo
   if(lv.level>0){const B=[...L.levels[lv.level-1].windows,...L.levels[lv.level-1].doors.filter(d=>d.street)],h=w=>Math.abs(w.y0-w.y1)<1e-6,key=w=>h(w)?'h'+w.y0.toFixed(1):'v'+w.x0.toFixed(1),tr=w=>h(w)?[Math.min(w.x0,w.x1),Math.max(w.x0,w.x1)]:[Math.min(w.y0,w.y1),Math.max(w.y0,w.y1)];
    for(const w of lv.windows){const [a,b]=tr(w),c=(a+b)/2,o=((c-(h(w)?L.rect.x:L.rect.y))%2+2)%2;if(Math.abs(o-1)>.05)anota('plano','una ventana fuera del eje del módulo',en(L,lv,`centro a ${c.toFixed(2)} m`));
     const bajo=B.filter(v=>key(v)===key(w)).map(tr).filter(([p,q])=>Math.min(b,q)-Math.max(a,p)>.05);
     if(bajo.length&&!bajo.some(([p,q])=>Math.abs((p+q)/2-c)<.16||(lv.level===1&&c>p&&c<q)))anota('plano','una ventana corrida respecto de la de abajo',en(L,lv,`centro a ${c.toFixed(2)} m`));}}}
  // la azotea
  for(const o of L.azotea?.objetos||[])if(!L.parts.some(P=>o.x-o.w/2>=P.x-.01&&o.x+o.w/2<=P.x+P.w+.01&&o.z-o.d/2>=P.y-.01&&o.z+o.d/2<=P.y+P.h+.01))anota('afuera','un objeto de azotea fuera de la huella',`ciudad ${s} lote ${L.id}: ${o.tipo}`);}
 // las casas del monte (hogar.js anota lo que no le entró y los cuartos sin paso)
 for(const [i,c] of (bp.isla.casas||[]).entries()){const H=c.spec?.hogar;if(!H){anota('casas','una casa sin plano de hogar',`ciudad ${s} casa ${i}`);continue;}
  if(H.missing?.length)anota('casas','a una casa le faltó un mueble de su programa',`ciudad ${s} casa ${i} (${H.label}): ${[].concat(H.missing).join(', ')}`);
  if(H.sinPaso?.length)anota('casas','un cuarto de una casa sin paso libre',`ciudad ${s} casa ${i} (${H.label}): ${[].concat(H.sinPaso).join(', ')}`);
  for(const lv of H.levels)for(const q of lv.rooms){if(VACIOS_OK.has(q.type)||q.type==='escalera')continue;if(!lv.furniture.some(f=>f.room===q.id))anota('casas','un cuarto de una casa sin muebles',`ciudad ${s} casa ${i}: ${q.label||q.type}`);}}
 // afuera
 const lotes=[...bp.lots,...(bp.isla.lots||[])],enLote=(x,z,m=.1)=>lotes.some(L=>L.parts.some(P=>x>P.x+m&&x<P.x+P.w-m&&z>P.y+m&&z<P.y+P.h-m)),E=(bp.equipamiento||[]).filter(e=>e.tipo!=='cebra');
 for(let i=0;i<E.length;i++){if(enLote(E[i].x,E[i].z))anota('afuera','una pieza de mobiliario dentro de un edificio',`ciudad ${s}: ${E[i].tipo}`);
  for(let j=i+1;j<E.length;j++)if(Math.hypot(E[i].x-E[j].x,E[i].z-E[j].z)<.8)anota('afuera','dos piezas de mobiliario encimadas',`ciudad ${s}: ${E[i].tipo} y ${E[j].tipo}`);}
 const A=[...(bp.vegetacion?.arboles||[]),...(bp.vegetacion?.palmeras||[])];
 for(const a of A){if(enLote(a.x,a.z))anota('afuera','un tronco dentro de un edificio',`ciudad ${s}: ${a.tipo}`);if(a.tipo==='bosque')continue;
  const e=a.eje||0,ce=Math.cos(e),se=Math.sin(e);let toca=false;for(let k=0;k<32&&!toca;k++){const t=k/32*Math.PI*2,u=Math.cos(t)*a.r,v=Math.sin(t)*(a.ra??a.r);toca=enLote(a.x+u*ce-v*se,a.z+u*se+v*ce,.05);}
  if(toca)anota('afuera','una copa dentro de un edificio',`ciudad ${s}: ${a.tipo} en ${a.x},${a.z}`);
  for(const q of E)if(Math.hypot(a.x-q.x,a.z-q.z)<.6)anota('afuera','un tronco pegado a una pieza de mobiliario',`ciudad ${s}: ${a.tipo} y ${q.tipo}`);}
 mide('edificios',bp.lots.length);mide('cuartos',cuartos);mide('muebles',muebles);mide('muebles por cuarto',+(muebles/cuartos).toFixed(2));mide('baños',banos);mide('árboles urbanos',A.filter(a=>a.tipo!=='bosque').length);mide('mobiliario',E.length);mide('casas del monte',bp.isla.casas?.length||0);}

// ---------- la lista ----------
const lista=[...hallazgos.values()].sort((a,b)=>b.n-a.n);
if(JSON_OUT){console.log(JSON.stringify({ciudades:N,desde:S0,lista,medidas,modelos},null,1));process.exit(0);}
console.log(`\nAUDITORÍA DEL PLANO · ${N} ciudades de ${TEAM} por equipo desde la semilla ${S0} · ${Math.round((Date.now()-t00)/1000)} s\n`);
if(!lista.length)console.log('  Nada que calibrar: ningún renglón.');
for(const g of ['modelos','plano','casas','afuera','estabilidad']){const ls=lista.filter(h=>h.grupo===g);if(!ls.length)continue;console.log(`  ${g.toUpperCase()}`);
 for(const h of ls){console.log(`   ${String(h.n).padStart(5)}  ${h.clave}`);for(const e of h.ej)console.log(`          · ${e}`);}console.log('');}
console.log('  DE UNA CIUDAD A OTRA (mínimo · mediana · máximo)');
for(const [k,v] of Object.entries(medidas)){const o=[...v].sort((a,b)=>a-b);console.log(`   ${k.padEnd(22)} ${o[0]} · ${o[o.length>>1]} · ${o.at(-1)}`);}
console.log(`\n  ${lista.reduce((a,h)=>a+h.n,0)} casos en ${lista.length} renglones.`);
