// Las casas del monte, dúplex modernas (2026-11-22, Miguel: «para las casas, pásalas a dúplex… valida arquitectura moderna
// y cómo la podemos encajar en el juego y el motor de construcción»). De lo que se repite en la arquitectura moderna, lo que
// el motor decide y se puede medir en el plano:
//  · el volumen: dos pisos, techo plano; con cuartos adelante arriba, el piso de arriba sale VOLADIZO m sobre la entrada
//    (hogar.js) y la puerta de calle queda debajo, cubierta, sin columnas;
//  · la planta abierta: entre dos cuartos que no son baño, el borde entero es un vano (abrirPlanta); el baño, con su puerta;
//  · la línea horizontal: los ventanales de cada piso con la cabeza a MODERNA_DINTEL de su piso (vivienda.js);
//  · la terraza (la logia de arriba, donde el piso de arriba no llena su frente): adelante, con su puerta al pasillo y
//    baranda donde da afuera;
//  · la envolvente cerrada: a lo largo del contorno de cada piso (vivienda.js bordesDe), a 5 cm del piso, un
//    muro en todo punto que no sea una puerta;
//  · el plano al milímetro: los bordes de los cuartos, en milímetros exactos;
//  · en las ventanas cerradas, la película y no cortinas (lo mide validar-cortinas).
// Uso: node harness/pruebas/validar-casas-modernas.mjs [ciudades=2] [semilla0=1]
import {generateBlueprint} from '../../src/engine/blueprint.js';
import {planHouse,MODERNA_DINTEL,FLOOR0,FH,TERRAZA_CASA,T as TM,bordesDe} from '../../src/engine/vivienda.js';
import {VOLADIZO} from '../../src/engine/hogar.js';
const N=+(process.argv[2]||2),S0=+(process.argv[3]||1);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
let casas=0,voladizos=0,abiertos=0,ventanas=0,terrazas=0;const t0=Date.now();const vistos=new Set();
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});
 for(const c of bp.isla?.casas||[]){if(!c.spec?.hogar)continue;casas++;const sp=c.spec,P=sp.hogar,ej={ciudad:s,casa:P.kind+'#'+P.variant};
  if(sp.estilo!=='moderna'||sp.techo!=='plano')falla('casa que no es moderna de techo plano',{...ej,estilo:sp.estilo,techo:sp.techo});
  if(P.floors!==2)falla('casa que no es de dos pisos',{...ej,pisos:P.floors});
  // (el plano, al milímetro: cada borde de cuarto en un número de milímetros exacto)
  for(const L of P.levels)for(const q of L.rooms)if([q.u0,q.u1,q.v0,q.v1].some(v=>Math.abs(v*1000-Math.round(v*1000))>1e-6)){falla('borde de cuarto fuera del milímetro',{...ej,cuarto:q.type,u0:q.u0,u1:q.u1});break;}
  const L0=P.levels[0],L1=P.levels[1];if(!L1)continue;
  const f0=Math.min(...L0.rooms.map(q=>q.v0)),f1=Math.min(...L1.rooms.map(q=>q.v0)),haciaCalle=f0-f1;
  const conFrente=L1.rooms.some(q=>q.band==='front');
  if(conFrente&&Math.abs(haciaCalle-VOLADIZO)>1e-6)falla('voladizo que no mide VOLADIZO',{...ej,mide:haciaCalle});
  if(!conFrente&&Math.abs(haciaCalle)>1e-6)falla('voladizo sin cuartos arriba adelante',{...ej,mide:haciaCalle});
  if(haciaCalle>0)voladizos++;
  // (la puerta de calle: en el frente de abajo y debajo del piso de arriba)
  const sd=L0.doors.find(d=>d.street);if(!sd)falla('casa sin puerta de calle',ej);
  else{if(Math.abs(sd.at-f0)>1e-6)falla('puerta de calle fuera del frente de abajo',{...ej,at:sd.at,frente:f0});
   // (cubierta: los cuartos del frente de arriba, juntos, tapan todo el ancho de la puerta)
   const arriba=L1.rooms.filter(q=>q.v0<=f1+1e-6).map(q=>[q.u0,q.u1]).sort((a,b)=>a[0]-b[0]);let hasta=sd.from;for(const [a,b] of arriba)if(a<=hasta+1e-6)hasta=Math.max(hasta,b);
   if(haciaCalle>0&&hasta<sd.from+sd.len-1e-6)falla('entrada sin cubrir por el voladizo',ej);}
  // (la terraza: en la franja de adelante de arriba, con una sola puerta, al pasillo, en el borde que comparten)
  for(const t of L1.rooms.filter(q=>q.type==='terraza')){terrazas++;if(t.band!=='front')falla('terraza fuera del frente de arriba',ej);
   const ds=L1.doors.filter(d=>d.a===t.id||d.b===t.id),hall=L1.rooms.find(q=>q.type==='hall');
   if(ds.length!==1||!ds[0].terraza||Math.abs(ds[0].at-t.v1)>1e-6||![ds[0].a,ds[0].b].includes(hall?.id))falla('terraza sin su puerta al pasillo',{...ej,puertas:ds.length});
   if(L1.windows.some(w=>w.a===t.id))falla('terraza con ventana',ej);}
  // (la planta abierta: cada borde entre dos cuartos que no son baño, un vano entero)
  for(const L of P.levels){const id=new Map(L.rooms.map(q=>[q.id,q]));
   for(const p of L.rooms)for(const o of L.rooms){if(p.id>=o.id||p.type==='bano'||o.type==='bano'||p.type==='terraza'||o.type==='terraza')continue;
    const vert=Math.abs(p.u1-o.u0)<1e-6||Math.abs(o.u1-p.u0)<1e-6,hor=Math.abs(p.v1-o.v0)<1e-6||Math.abs(o.v1-p.v0)<1e-6;
    const largo=vert?Math.min(p.v1,o.v1)-Math.max(p.v0,o.v0):hor?Math.min(p.u1,o.u1)-Math.max(p.u0,o.u0):0;if(largo<=.05)continue;
    const d=L.doors.find(d=>d.entero&&[d.a,d.b].includes(p.id)&&[d.a,d.b].includes(o.id));
    if(!d||Math.abs(d.len-largo)>1e-6)falla('borde entre cuartos abiertos que no es un vano entero',{...ej,nivel:L.level,a:p.prog,b:o.prog});else abiertos++;}
   for(const q of L.rooms)if(q.type==='bano'&&!L.doors.some(d=>!d.entero&&(d.a===q.id||d.b===q.id)))falla('baño sin su puerta',{...ej,nivel:L.level});}
  // (la línea horizontal: la cabeza de cada ventanal, la misma en su piso; una vez por plano de casa)
  const k=JSON.stringify([P.kind,P.variant,sp.ventana]);if(vistos.has(k))continue;vistos.add(k);
  const H=planHouse(sp);
  // (sin columnas: bajo el voladizo —la franja de la entrada, entre el frente de abajo y el de arriba— nada alto que llegue al suelo)
  if(P.voladizo){const z0=H.D-P.voladizo-H.oz,z1=H.D-H.oz;for(const b of H.boxes)if(b.solid!==undefined&&b.y0<.5&&b.y1>1.8&&b.z0>z0+.05&&b.z1<z1+.15&&b.z1>z0+.2)falla('columna bajo el voladizo',{...ej,x:+b.x0.toFixed(2),z:+b.z0.toFixed(2),cat:b.cat});}
  // (la baranda de la terraza: donde la terraza da a la calle, una caja de su largo y de TERRAZA_CASA.baranda de alto)
  for(const t of P.levels[1]?.rooms.filter(q=>q.type==='terraza')||[]){const zf=H.D-P.levels[1].rooms.reduce((m,q)=>Math.min(m,q.v0),9)-H.oz,x0=t.u0-H.ox,x1=t.u1-H.ox;
   if(Math.abs(t.v0-Math.min(...P.levels[1].rooms.map(q=>q.v0)))<1e-6&&!H.boxes.some(b=>b.cat==='marco'&&Math.abs(b.y1-b.y0-TERRAZA_CASA.baranda)<.01&&Math.abs(b.z1-zf)<.01&&Math.abs(b.x0-x0)<.01&&Math.abs(b.x1-x1)<.01))falla('terraza sin baranda adelante',ej);}
  // (la envolvente: a 5 cm del piso —debajo de todo antepecho: el ventanal de la sala baja hasta 10 cm—, de a 10 cm por cada borde, dentro del muro; salvo las puertas)
  for(const L of P.levels){const rs=L.rooms.filter(q=>q.type!=='terraza').map(q=>({x0:q.u0,x1:q.u1,z0:H.D-q.v1,z1:H.D-q.v0})),den=(x,z)=>rs.some(r=>x>r.x0&&x<r.x1&&z>r.z0&&z<r.z1),y=(L.level?FLOOR0+FH:FLOOR0)+.05;
   const puertas=H.openings.filter(o=>o.kind==='door'&&!o.inner&&Math.abs(o.y0-(L.level?FLOOR0+FH:FLOOR0))<.3);
   for(const B of bordesDe(rs,den))for(let u=B.a+.05;u<B.b-.04;u+=.1){const [x,z]=B.axis==='x'?[u,B.e+B.n*TM/2]:[B.e+B.n*TM/2,u],X=x-H.ox,Z=z-H.oz;
    if(puertas.some(o=>o.axis===B.axis&&Math.abs((B.axis==='x'?Z:X)-o.at)<.15&&Math.abs((B.axis==='x'?X:Z)-o.c)<o.w/2+.15))continue;
    if(!H.boxes.some(b=>b.solid&&X>b.x0-1e-3&&X<b.x1+1e-3&&Z>b.z0-1e-3&&Z<b.z1+1e-3&&y>b.y0&&y<b.y1)){falla('hueco en la envolvente',{...ej,nivel:L.level,eje:B.axis,x:+X.toFixed(2),z:+Z.toFixed(2)});break;}}}
  for(const o of H.openings){if(o.kind!=='window'||o.room==='bano')continue;ventanas++;const piso=o.y0>=FLOOR0+FH-.01?FLOOR0+FH:FLOOR0,cab=o.y0+o.h-piso;
   if(Math.abs(cab-MODERNA_DINTEL)>.005)falla('ventanal con la cabeza fuera de la línea',{...ej,cabeza:+cab.toFixed(3),cuarto:o.room});}}}
console.log(`casas modernas · ${N} ciudades · ${casas} casas · ${voladizos} con voladizo sobre la entrada · ${terrazas} terrazas · ${abiertos} bordes abiertos · ${ventanas} ventanales medidos · ${Math.round((Date.now()-t0)/1000)} s`);
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size?1:0);
