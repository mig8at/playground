// Valida el pintado del mundo (2026-10-16, src/engine/color.js y PALETA de medidas.js):
//  · cada color es de la paleta, y el de un cuarto, de la familia de su función;
//  · dos cuartos que se tocan (en el mismo piso, con su pasillo) no quedan casi iguales: ΔE ≥ reglas.vecinos;
//  · la fachada de afuera, según su TRADICIÓN (2026-10-18, PALETA.tradiciones; color.js esquemaDe): la pared, el
//    acento y el techo son de los de su tradición; dos fachadas vecinas se separan lo que pide su tradición (vecinos,
//    o reglas.fachadas); la moldura contrasta con la pared (salvo las que no llevan: «pared», o la del acento); el
//    acento se aleja de la pared (ΔE ≥ reglas.acento) y de la moldura y es más oscuro que la pared (salvo acentoClaro);
//    el zócalo, si lleva, se aleja de la pared; los marcos de acento nunca en una pared oscura (los apagan); cada
//    fachada lleva de 2 a 4 colores; en una tradición uniforme, las vecinas gemelas (misma pared, zócalo y acento) son
//    a lo sumo el 30 % de los pares de vecinas de esa tradición;
//  · la ciudad: cada zona de barrio, una sola tradición, y dos zonas vecinas, distintas; al menos 4 tradiciones por
//    ciudad; ningún color de pared pasa del 25 % de la ciudad y la moldura blanca no es la de todos (≤ 60 %);
//  · el pintado es igual por semilla.
// Uso: node scripts/validar-color.mjs [ciudades=4] [semilla0=1]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {PALETA} from '../src/engine/medidas.js';
import {deltaE,contraste,familiaDe,luminancia,sombra,TONOS} from '../src/engine/color.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||4),S0=+(A[1]||1),R=PALETA.reglas;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const tocan=(a,b)=>{const ox=Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0),oz=Math.min(a.z1,b.z1)-Math.max(a.z0,b.z0),E=.02;return (Math.abs(ox)<=E&&oz>.3)||(Math.abs(oz)<=E&&ox>.3);};
// la paleta: dentro de cada familia, colores separados (si no, dos cuartos vecinos de la misma función no pueden diferir)
for(const [k,l] of Object.entries(PALETA.cuarto))for(let i=0;i<l.length;i++)for(let j=i+1;j<l.length;j++)if(deltaE(l[i],l[j])<R.familia)falla('dos colores de una familia casi iguales',{familia:k,a:l[i],b:l[j]});
const med={cuartos:0,pares:0,iguales:0,dEmin:[],fachadas:{},ncol:{},n:0,trad:{},blanca:0,porCiudad:[],gemelas:0,paresU:0,tonos:0};
const revisarPiso=(cs,id)=>{for(let i=0;i<cs.length;i++)for(let j=i+1;j<cs.length;j++){if(!tocan(cs[i].rect,cs[j].rect)||(cs[i].tipo==='pasillo'&&cs[j].tipo==='pasillo'))continue;/* (los tramos de un pasillo: el mismo color, a propósito) */med.pares++;const d=deltaE(cs[i].color,cs[j].color);med.dEmin.push(d);if(d<R.vecinos)falla('cuartos vecinos casi del mismo color',{...id,a:cs[i].tipo,b:cs[j].tipo,dE:+d.toFixed(1)});}};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),id={semilla:s};
 const huella=o=>JSON.stringify(o.colores);if(JSON.stringify(generateBlueprint({seed:s,team:3}).lots.map(huella))!==JSON.stringify(bp.lots.map(huella)))falla('el pintado cambia entre dos corridas de la misma semilla',id);
 const lotes=[...bp.lots,...(bp.isla.lots||[]).filter(L=>L.parts)],caja=L=>{const p=L.parts;return {x0:Math.min(...p.map(q=>q.x)),x1:Math.max(...p.map(q=>q.x+q.w)),z0:Math.min(...p.map(q=>q.y)),z1:Math.max(...p.map(q=>q.y+q.h))};},cajas=lotes.map(caja);
 const TT=PALETA.tradiciones;
 const exterior=(o,donde)=>{const C=o.colores;if(!C){falla('sin pintar',{...id,donde});return;}const T=TT[C.tradicion];if(!T){falla('sin tradición',{...id,donde});return;}
  const ej={...id,donde,t:C.tradicion,f:C.fachada};med.n++;med.trad[C.tradicion]=(med.trad[C.tradicion]||0)+1;
  if(![...T.pared,...T.pared.flatMap(c=>TONOS.map(k=>sombra(c,k)))].includes(C.fachada))falla('pared fuera de su tradición',ej);if(!T.pared.includes(C.fachada))med.tonos++;if(!T.acento.includes(C.acento))falla('acento fuera de su tradición',ej);
  if(!(T.techo||PALETA.techo).includes(C.techo))falla('techo fuera de su tradición',ej);
  if(C.culata!=null&&C.culata!==C.fachada&&!PALETA.culata.includes(C.culata))falla('culata fuera de la paleta',ej);
  const lf=luminancia(C.fachada),sinMoldura=C.moldura===C.fachada||C.moldura===C.acento;
  if(!sinMoldura&&contraste(C.moldura,C.fachada)<R.contraste)falla('moldura sin contraste con su fachada',{...ej,c:+contraste(C.moldura,C.fachada).toFixed(2)});
  if(C.moldura===C.fachada&&!T.moldura.pared&&contraste(PALETA.moldura[0],C.fachada)>=R.contraste)falla('sin moldura en una tradición que la lleva',ej);
  if(deltaE(C.acento,C.fachada)<R.acento)falla('acento que no se separa de la pared',{...ej,a:C.acento});
  if(!sinMoldura&&deltaE(C.acento,C.moldura)<R.acentoMoldura)falla('acento que no se separa de la moldura',{...ej,m:C.moldura,a:C.acento});
  if(!T.acentoClaro&&luminancia(C.acento)>=lf)falla('acento más claro que la pared',{...ej,a:C.acento});
  if(C.zocalo!==C.fachada&&deltaE(C.zocalo,C.fachada)<R.zocalo)falla('zócalo que no se separa de la pared',{...ej,z:C.zocalo});
  if(lf<R.paredClara&&C.marco===C.acento&&C.acento!==C.moldura)falla('marcos de acento sobre una pared oscura',ej);
  if(![C.acento,C.moldura].includes(C.marco))falla('marco que no es del acento ni de la moldura',ej);
  const n=new Set([C.fachada,C.moldura,C.marco,C.zocalo,C.acento]).size;med.ncol[n]=(med.ncol[n]||0)+1;if(n<2||n>4)falla('fachada con menos de 2 o más de 4 colores',{...ej,n});
  if(C.moldura===PALETA.moldura.reduce((a,b)=>contraste(b,C.fachada)>contraste(a,C.fachada)?b:a))med.blanca++;
  med.fachadas[C.fachada]=(med.fachadas[C.fachada]||0)+1;};
 const vecMin=(a,b)=>Math.min(...[a,b].map(o=>{const T=TT[o.colores.tradicion];return T?.uniforme?0:T?.vecinos??R.fachadas;}));
 // (en una tradición uniforme, dos vecinas de la misma pared no son gemelas: se separan por el acento o el zócalo)
 const gemelas=(a,b,ej)=>{const A=a.colores,B=b.colores;if(A.tradicion===B.tradicion&&TT[A.tradicion]?.uniforme){med.paresU++;if(A.fachada===B.fachada&&A.zocalo===B.zocalo&&deltaE(A.acento,B.acento)<R.vecinos)med.gemelas++;}};
 // las zonas de la ciudad: una tradición cada una, distinta de las vecinas
 const zonas=new Map();for(const L of bp.lots)if(L.zonaF){const k=L.zonaF.join(','),t=L.colores.tradicion;if(zonas.has(k)&&zonas.get(k)!==t)falla('una zona con dos tradiciones',{...id,zona:k});zonas.set(k,t);}
 for(const [k,t] of zonas){const [x,y]=k.split(',').map(Number);for(const [dx,dy] of [[1,0],[0,1]])if(zonas.get((x+dx)+','+(y+dy))===t)falla('dos zonas vecinas con la misma tradición',{...id,zona:k,t});}
 const tc=new Set(bp.lots.map(L=>L.colores.tradicion));med.porCiudad.push(tc.size);if(tc.size<4)falla('la ciudad con menos de 4 tradiciones',{...id,n:tc.size});
 lotes.forEach((L,i)=>{exterior(L,L.type);
  for(let j=0;j<i;j++){const a=cajas[i],b=cajas[j];if(Math.max(a.x0-b.x1,b.x0-a.x1,a.z0-b.z1,b.z0-a.z1)>6.01)continue;const d=deltaE(L.colores.fachada,lotes[j].colores.fachada);gemelas(L,lotes[j]);if(d<vecMin(L,lotes[j]))falla('lotes vecinos con fachadas casi iguales',{...id,a:L.type,b:lotes[j].type,dE:+d.toFixed(1)});}
  for(const lv of L.levels||[]){const cs=lv.rooms.map(q=>({tipo:q.type,color:L.colores.cuartos[lv.level+':'+q.id],rect:{x0:q.x,x1:q.x+q.w,z0:q.y,z1:q.y+q.h}}));
   for(const c of cs){med.cuartos++;if(!c.color){falla('cuarto sin color',{...id,tipo:c.tipo});continue;}if(!PALETA.cuarto[familiaDe(c.tipo)].includes(c.color))falla('cuarto con un color de otra familia',{...id,tipo:c.tipo});}
   revisarPiso([...cs.filter(c=>c.color),...(lv.corridor||[]).map(k=>({tipo:'pasillo',color:L.colores.pasillo[lv.level],rect:{x0:k.x,x1:k.x+k.w,z0:k.y,z1:k.y+k.h}}))],{...id,lote:L.type,piso:lv.level});}});
 const casas=(bp.isla.casas||[]).filter(h=>h.spec);casas.forEach((h,i)=>{exterior(h,'casa');
  for(let j=0;j<i;j++)if(Math.hypot(casas[j].x-h.x,casas[j].z-h.z)<24){const d=deltaE(h.colores.fachada,casas[j].colores.fachada);gemelas(h,casas[j]);if(d<vecMin(h,casas[j]))falla('casas vecinas con fachadas casi iguales',{...id,dE:+d.toFixed(1)});}
  for(const lv of h.spec.hogar?.levels||[]){const cs=lv.rooms.map(q=>({tipo:q.type,color:h.colores.cuartos[lv.level+':'+q.id],rect:{x0:q.u0,x1:q.u1,z0:q.v0,z1:q.v1}}));for(const c of cs){med.cuartos++;if(!c.color)falla('cuarto de casa sin color',{...id,tipo:c.tipo});}revisarPiso(cs.filter(c=>c.color),{...id,casa:h.manzana,piso:lv.level});}});}
const tot=Object.values(med.fachadas).reduce((a,b)=>a+b,0),max=Math.max(...Object.values(med.fachadas))/tot;if(max>.25)falla('un color de fachada domina (más del 25 %)',{parte:+max.toFixed(2)});
if(med.paresU&&med.gemelas/med.paresU>.3)falla('vecinas gemelas en una tradición uniforme (más del 30 %)',{parte:+(med.gemelas/med.paresU).toFixed(2)});
if(med.blanca/med.n>.6)falla('la moldura blanca de siempre en más del 60 %',{parte:+(med.blanca/med.n).toFixed(2)});
console.log(`tradiciones · ${med.n} fachadas y casas · por ciudad ${med.porCiudad.join(', ')} · ${Object.entries(med.trad).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+' '+Math.round(100*v/med.n)+' %').join(', ')} · colores por fachada ${JSON.stringify(med.ncol)} · moldura blanca ${Math.round(100*med.blanca/med.n)} % · gemelas ${med.gemelas} de ${med.paresU} pares uniformes · paredes en otro tono ${med.tonos}`);
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.floor(p*(b.length-1))];};
console.log(`color · ${med.cuartos} cuartos · ${med.pares} pares de vecinos: ΔE p1 ${q(med.dEmin,.01).toFixed(1)}, mediana ${q(med.dEmin,.5).toFixed(1)} (mínimo ${R.vecinos}) · fachadas: ${Object.keys(med.fachadas).length} colores, el más usado ${(100*max).toFixed(0)} %`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
