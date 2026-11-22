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
import {muroExterior,tramosDe,paredesDelEdificio,esPintable,accesoDe} from '../../src/engine/muros.js';
import {fachadaMedida} from '../../src/engine/fachada-medida.js';
import {esVidriera} from '../../src/engine/medidas.js';

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
const VACIOS_OK=new Set(['hall','entrada','vestibulo']);
// ¿la puerta da a la calle o a la avenida? (la casilla de afuera, a 0,6 m de la puerta, es vía: contenedores.js K_VIA)
const aLaCalle=(d,L)=>{const M=bpActual.map,h=Math.abs(d.y0-d.y1)<1e-6,mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2;for(const sg of [1,-1]){const x=mx+(h?0:sg*.6),z=mz+(h?sg*.6:0);if(L.parts.some(P=>x>P.x&&x<P.x+P.w&&z>P.y&&z<P.y+P.h))continue;const cx=Math.floor(x/6),cy=Math.floor(z/6);if(cx>=0&&cy>=0&&cx<M.W&&cy<M.H&&[0,1].includes(M.kind[cy*M.W+cx]))return true;}return false;};
let bpActual=null;
const HAB_BALCON=new Set(['dormitorio','sala','sala_cocina','estudio','habitacion','habitacion_h','oficina','abierta','reuniones','comedor']);// (de paso: pueden ir sin muebles)
const firma=bp=>createHash('sha1').update(JSON.stringify([bp.lots.map(L=>[L.id,L.type,L.floors,L.rect,L.levels.map(lv=>[lv.rooms.length,lv.furniture.map(f=>[f.kind,f.x,f.y,f.w,f.h]),lv.doors.length,lv.windows.length])]),bp.equipamiento?.length,bp.vegetacion?.arboles?.length])).digest('hex').slice(0,12);
const t00=Date.now();
for(let s=S0;s<S0+N;s++){const t0=Date.now(),bp=bpActual=generateBlueprint({seed:s,team:TEAM}),ms=Date.now()-t0,en=(L,lv,x)=>`ciudad ${s} lote ${L.id} (${L.type}) piso ${lv.level}: ${x}`;
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
  // ---------- LA COHERENCIA (2026-11-22, Miguel: «un listado del deber ser y de los posibles absurdos, e ir iterando
  // poco a poco hasta que todo el render sea coherente») ----------
  // EN PLANTA: cada cuarto en metro entero, dentro del edificio y sin pisar a otro; cada departamento con baño y cocina;
  // ningún baño de paso; ninguna puerta pegada a un rincón si el borde daba para más.
  for(const lv of L.levels.slice(0,L.floors)){const e=v=>Math.abs(v-Math.round(v))<1e-6;
   for(const q of lv.rooms){if(!e(q.w)||!e(q.h))anota('coherencia','planta · un cuarto fuera del metro entero',en(L,lv,`${q.type} de ${q.w}×${q.h} m`));
    if(!L.parts.some(P=>dentroDe(q,P,.02)))anota('coherencia','planta · un cuarto que se sale del edificio',en(L,lv,q.type));}
   for(let i=0;i<lv.rooms.length;i++)for(let j=i+1;j<lv.rooms.length;j++)if(pisa(lv.rooms[i],lv.rooms[j]))anota('coherencia','planta · dos cuartos se pisan',en(L,lv,`${lv.rooms[i].type} y ${lv.rooms[j].type}`));
   const us=new Map();for(const q of lv.rooms)if(q.unit!=null)(us.get(q.unit)||us.set(q.unit,[]).get(q.unit)).push(q.type);
   for(const [u,ts] of us){if(!ts.includes('bano'))anota('coherencia','planta · un departamento sin baño',en(L,lv,`apto ${u}: ${ts.join(', ')}`));if(!ts.some(t=>/cocina|cocineta|estudio/.test(t)))anota('coherencia','planta · un departamento sin cocina',en(L,lv,`apto ${u}: ${ts.join(', ')}`));}
   for(const q of lv.rooms.filter(q=>q.type==='bano')){const ps=lv.doors.filter(d=>d.a===q.id||d.b===q.id);if(ps.length>1)anota('coherencia','planta · un baño de paso (con dos puertas)',en(L,lv,`${q.w}×${q.h} m`));}
   // (los cuartos que se abren entre sí: un baño no se abre a una cocina; un cuarto donde se está no se abre sólo a un baño;
   // la puerta de calle no da a un baño, un depósito ni una alcoba; a un departamento se entra desde lo común —el pasillo,
   // el descanso—, no a través de otro)
   const R=id=>lv.rooms.find(q=>q.id===id),HABIT=new Set(['dormitorio','sala','sala_cocina','estudio','oficina','abierta','reuniones','habitacion','habitacion_h','comedor']);
   for(const d of lv.doors){const A=R(d.a),B=typeof d.b==='number'?R(d.b):null;
    if(A&&B&&[A.type,B.type].includes('bano')&&[A.type,B.type].some(t=>t==='cocina'||t==='cocineta'))anota('coherencia','planta · un baño que se abre a la cocina',en(L,lv,`${A.type} y ${B.type}`));
    // (la que da a la calle o a la avenida: la del patio, a una bodega o a la alcoba de una casa, es de servicio y existe)
    if(d.street&&A&&['bano','sanitario','deposito','dormitorio','habitacion','habitacion_h'].includes(A.type)&&aLaCalle(d,L))anota('coherencia','planta · una puerta de calle a un baño, un depósito o una alcoba',en(L,lv,A.type));}
   for(const q of lv.rooms){if(!HABIT.has(q.type))continue;const ps=lv.doors.filter(d=>d.a===q.id||d.b===q.id);if(ps.length&&ps.every(d=>{const o=d.a===q.id?d.b:d.a;return typeof o==='number'&&R(o)?.type==='bano';}))anota('coherencia','planta · un cuarto que sólo se abre a un baño',en(L,lv,q.type));}
   for(const [u] of us){const ids=new Set(lv.rooms.filter(q=>q.unit===u).map(q=>q.id));const afuera=lv.doors.some(d=>(ids.has(d.a)&&!ids.has(d.b))||(typeof d.b==='number'&&ids.has(d.b)&&!ids.has(d.a)));
    const ajena=lv.doors.some(d=>{const a=R(d.a),b=typeof d.b==='number'?R(d.b):null;return a&&b&&a.unit!=null&&b.unit!=null&&a.unit!==b.unit&&(ids.has(a.id)||ids.has(b.id));});
    if(!afuera)anota('coherencia','planta · un departamento sin puerta a lo común',en(L,lv,`apto ${u}`));if(ajena)anota('coherencia','planta · un departamento que se abre a otro',en(L,lv,`apto ${u}`));}
   for(const d of lv.doors.filter(d=>d.street)){const h=Math.abs(d.y0-d.y1)<1e-6,mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2;for(const sg of [1,-1]){const x=mx+(h?0:sg*.6),z=mz+(h?sg*.6:0);const dentroL=L.parts.some(P=>x>P.x&&x<P.x+P.w&&z>P.y&&z<P.y+P.h);if(dentroL)continue;
     if(bp.lots.some(o=>o.id!==L.id&&(o.parts||[]).some(P=>x>P.x&&x<P.x+P.w&&z>P.y&&z<P.y+P.h)))anota('coherencia','planta · una puerta de calle que da contra otro edificio',en(L,lv,`en ${mx.toFixed(1)},${mz.toFixed(1)}`));}}
   // (al abrir: la hoja barre un cuarto de círculo desde su bisagra —(x0, y0), como la arma el 3D, town3d innerLeaves— hacia
   // el cuarto al que abre —el del lado a, o el del b si a es el pasillo—; dos barridos que se pisan son dos puertas que se
   // golpean, y uno que pisa un aparato de obra es una puerta que no abre entera. Se mira con puntos cada 5 cm)
   const barrido=d=>{if(d.street||d.core||d.stair||d.wide||d.bay||d.hoja===false||d.abierta)return null;const q=R(d.a)||(typeof d.b==='number'?R(d.b):null);if(!q)return null;
    const len=Math.hypot(d.x1-d.x0,d.y1-d.y0);if(len>1.25||len<.6)return null;const ux=(d.x1-d.x0)/len,uz=(d.y1-d.y0)/len;let nx=-uz,nz=ux;if((q.x+q.w/2-d.x0)*nx+(q.y+q.h/2-d.y0)*nz<0){nx=-nx;nz=-nz;}if(d.abreAfuera){nx=-nx;nz=-nz;}
    return {q:q.type,d,adentro:(x,z)=>{const px=x-d.x0,pz=z-d.y0;return px*px+pz*pz<(len-.03)**2&&px*ux+pz*uz>.02&&px*nx+pz*nz>.02;},caja:{x:Math.min(d.x0,d.x0+nx*len,d.x1),y:Math.min(d.y0,d.y0+nz*len,d.y1),w:len,h:len}};};
   const toca=(b,f)=>{for(let x=f.x+.025;x<f.x+f.w;x+=.05)for(let z=f.y+.025;z<f.y+f.h;z+=.05)if(b.adentro(x,z))return true;return false;};
   const bs=lv.doors.map(barrido).filter(Boolean);
   for(let i=0;i<bs.length;i++)for(let j=i+1;j<bs.length;j++){const A=bs[i],B=bs[j];if(!pisa(A.caja,B.caja,.02))continue;let choca=false;const c=A.caja;for(let x=c.x+.025;x<c.x+c.w&&!choca;x+=.05)for(let z=c.y+.025;z<c.y+c.h&&!choca;z+=.05)if(A.adentro(x,z)&&B.adentro(x,z))choca=true;
    if(choca)anota('coherencia','planta · dos puertas que se golpean al abrir',en(L,lv,`${A.q} y ${B.q}`));}
   const OBRA=new Set(['inodoro','lavamanos','ducha','tina','meson','estufa','nevera','lavadora']);
   for(const b of bs)for(const f of lv.furniture)if(OBRA.has(f.kind)&&pisa(b.caja,f,.01)&&toca(b,f)){anota('coherencia','planta · una puerta que al abrir pega contra un aparato',en(L,lv,`${f.kind} en un ${b.q}`));break;}
   // (la puerta a menos de 30 cm del rincón —el tabique de al lado inflado por el cuerpo cierra la entrada—, cuando el borde
   // que comparte con el otro cuarto le dejaba poner 40 cm de aire de cada lado)
   for(const d of lv.doors){if(d.street||d.core||d.wide||typeof d.b!=='number')continue;const A=lv.rooms.find(q=>q.id===d.a),B=lv.rooms.find(q=>q.id===d.b);if(!A||!B)continue;const h=Math.abs(d.y0-d.y1)<1e-6,p0=h?Math.min(d.x0,d.x1):Math.min(d.y0,d.y1),p1=h?Math.max(d.x0,d.x1):Math.max(d.y0,d.y1);
    const a=Math.max(h?A.x:A.y,h?B.x:B.y),b=Math.min(h?A.x+A.w:A.y+A.h,h?B.x+B.w:B.y+B.h);if(b-a<(p1-p0)+.8-1e-6)continue;if(Math.min(p0-a,b-p1)<.3-1e-6)anota('coherencia','planta · una puerta pegada al rincón',en(L,lv,`entre ${A.type} y ${B.type}, a ${Math.min(p0-a,b-p1).toFixed(2)} m`));}}
  // EN FACHADA: cada vano adentro de su módulo y de su piso, sin pisar a otro; la puerta de calle sólo en planta baja; la
  // vidriera sólo en un local; el balcón con un cuarto habitable detrás; las ventanas de un piso, todas a la misma altura;
  // la culata ciega (las ventanas que quedan en el lindero, contadas).
  for(const t of tramosDe(L)){const M=muroExterior(L,t.codigo),F=fachadaMedida(L,t.codigo),V=M.huecos.filter(h=>h.clase!=='zocalo'),lineas=F.pisos.map(p=>p.base).filter(b=>b>F.sube+1e-6);
   const ef=x=>`ciudad ${s} lote ${L.id} (${L.type}) fachada ${t.codigo}: ${x}`;
   for(let i=0;i<V.length;i++){const a=V[i];for(const y of lineas)if(a.y0<y-.005&&a.y1>y+.005)anota('coherencia','fachada · un vano que cruza la línea de un piso',ef(`${a.clase} de ${a.y0} a ${a.y1}`));
    const m0=Math.floor((a.u0+.001)/2),m1=Math.ceil((a.u1-.001)/2);if(m1-m0>(a.clase==='doble'?2:1))anota('coherencia','fachada · un vano que pasa de su módulo',ef(`${a.clase} de ${a.u0} a ${a.u1}`));
    for(let j=i+1;j<V.length;j++){const b=V[j];if(Math.min(a.u1,b.u1)-Math.max(a.u0,b.u0)>.005&&Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0)>.005)anota('coherencia','fachada · dos vanos se pisan',ef(`${a.clase} y ${b.clase}`));}}
   // (una fachada a la calle, de 6 m o más, sin ninguna ventana en un piso de arriba —y que no es culata—: en una ciudad no pasa)
   // (a la calle de verdad: la casilla de delante del medio del tramo es vía; delante de un patio, un muro ciego vale)
   {const pm=F.punto(F.ancho/2),nn=F.eje.horiz?[0,F.eje.lado==='N'?-1:1]:[F.eje.lado==='W'?-1:1,0],cx=Math.floor((pm.x+nn[0]*1)/6),cy=Math.floor((pm.z+nn[1]*1)/6),M=bp.map,aCalle=cx>=0&&cy>=0&&cx<M.W&&cy<M.H&&[0,1].includes(M.kind[cy*M.W+cx]);
    if(aCalle&&F.ancho>=6)for(const P of F.pisos){if(P.nivel===0)continue;const hay=V.some(h=>h.y0>=P.base-.01&&h.y1<=P.base+3.01);
     const x=F.punto(F.ancho/2),n=F.eje.horiz?[0,F.eje.lado==='N'?-1:1]:[F.eje.lado==='W'?-1:1,0],px=x.x+n[0]*.6,pz=x.z+n[1]*.6,vecino=bp.lots.some(o=>o.id!==L.id&&(o.parts||[]).some(Q=>px>Q.x&&px<Q.x+Q.w&&pz>Q.y&&pz<Q.y+Q.h));
     if(!hay&&!vecino)anota('coherencia','fachada · una fachada a la calle sin ninguna ventana en un piso',ef(`piso ${P.nivel}, ${F.ancho} m`));}}
   for(const P of F.pisos){const alt=new Set(V.filter(h=>h.clase==='ventana'&&h.y0>=P.base-.01&&h.y1<=P.base+3.01).map(h=>h.y0.toFixed(2)+'-'+h.y1.toFixed(2)));if(alt.size>1)anota('coherencia','fachada · ventanas de un mismo piso a distinta altura',ef(`piso ${P.nivel}: ${[...alt].join(' · ')}`));}}
  // PARA PINTAR: toda pared sin vanos y a la vista tiene cómo alcanzarse (muros.js accesoDe: su cuarto, la escalera de mano
  // o colgado desde la azotea); la que no, no se cuenta como pintable y acá se anota
  for(const w of paredesDelEdificio(bp,L)){if(w.clase!=='exterior'||!esPintable(w))continue;const x=w.c.x+w.n[0]*.3,z=w.c.z+w.n[1]*.3;if(bp.lots.some(o=>o.id!==L.id&&o.floors>w.nivel&&(o.parts||[]).some(p=>x>p.x&&x<p.x+p.w&&z>p.y&&z<p.y+p.h)))continue;
   if(!accesoDe(bp,L,w))anota('coherencia','pintar · una pared lisa a la que no se llega',`ciudad ${s} lote ${L.id} (${L.type}) piso ${w.nivel}: fachada ${w.codigo}`);}
  // (delante de una puerta de calle, a menos de 1,2 m de su centro: un tronco, un poste, una banca)
  {const lv0=L.levels[0],cosas=[...(bp.vegetacion?.arboles||[]).filter(a=>a.tipo!=='bosque').map(a=>({x:a.x,z:a.z,t:'árbol'})),...(bp.equipamiento||[]).filter(e=>e.tipo!=='cebra').map(e=>({x:e.x,z:e.z,t:e.tipo}))];
   for(const d of (lv0?.doors||[]).filter(d=>d.street)){const h=Math.abs(d.y0-d.y1)<1e-6,mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2;for(const sg of [1,-1]){const x=mx+(h?0:sg*1),z=mz+(h?sg*1:0);if(L.parts.some(P=>x>P.x&&x<P.x+P.w&&z>P.y&&z<P.y+P.h))continue;
     const c=cosas.find(c=>Math.hypot(c.x-x,c.z-z)<.9);if(c)anota('coherencia','afuera · algo delante de una puerta de calle',en(L,lv0,`${c.t} a ${Math.hypot(c.x-mx,c.z-mz).toFixed(2)} m de la puerta`));}}}
  for(const m of L.modulos||[]){const lv=L.levels[m.f];if(!lv)continue;
   if(m.f>0&&m.tipo==='vidriera')anota('coherencia','fachada · una vidriera arriba de la planta baja',en(L,lv,'vidriera'));
   if(m.f>0&&(m.tipo==='puerta'||m.tipo==='puerta_doble'||m.tipo==='porton'))anota('coherencia','fachada · una puerta de calle fuera de la planta baja',en(L,lv,m.tipo));
   // (lo que hay detrás del módulo: el cuarto que contiene un punto 30 cm adentro de su centro)
   const ex=(m.x+.5+m.dx*.5)*6,ez=(m.y+.5+m.dy*.5)*6,c=-2+2*m.k,px=ex+m.dy*c-m.dx*.3,pz=ez-m.dx*c-m.dy*.3,q=lv.rooms.find(q=>px>q.x&&px<q.x+q.w&&pz>q.y&&pz<q.y+q.h);
   // (la planta baja de lo que no es vivienda va toda en vidrio —medidas.js esVidriera, regla acordada—: eso no cuenta)
   if(m.tipo==='vidriera'&&q&&q.type!=='local'&&!q.giro&&!esVidriera(L.type,{shop:false}))anota('coherencia','fachada · una vidriera que no es de un local',en(L,lv,`delante de un ${q.type}`));
   if(m.tipo==='balcon'&&(!q||!HAB_BALCON.has(q.type)))anota('coherencia','fachada · un balcón sin un cuarto habitable detrás',en(L,lv,`delante de ${q?q.type:'nada (pasillo o núcleo)'}`));}
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
 for(const c of bp.contenedores||[]){if(c.sinAnden)anota('afuera','un contenedor de basura sin andén (en la calle)',`ciudad ${s}: ${c.id} en ${c.x},${c.z}`);if(c.estorba)anota('afuera','un contenedor encima de un árbol, una pieza o frente a un vano',`ciudad ${s}: ${c.id} en ${c.x},${c.z}`);}
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
for(const g of ['coherencia','modelos','plano','casas','afuera','estabilidad']){const ls=lista.filter(h=>h.grupo===g);if(!ls.length)continue;console.log(`  ${g.toUpperCase()}`);
 for(const h of ls){console.log(`   ${String(h.n).padStart(5)}  ${h.clave}`);for(const e of h.ej)console.log(`          · ${e}`);}console.log('');}
console.log('  DE UNA CIUDAD A OTRA (mínimo · mediana · máximo)');
for(const [k,v] of Object.entries(medidas)){const o=[...v].sort((a,b)=>a-b);console.log(`   ${k.padEnd(22)} ${o[0]} · ${o[o.length>>1]} · ${o.at(-1)}`);}
console.log(`\n  ${lista.reduce((a,h)=>a+h.n,0)} casos en ${lista.length} renglones.`);
