// Valida el pintado del mundo (2026-10-16, src/engine/color.js y PALETA de medidas.js):
//  · cada color es de la paleta, y el de un cuarto, de la familia de su función;
//  · dos cuartos que se tocan (en el mismo piso, con su pasillo) no quedan casi iguales: ΔE ≥ reglas.vecinos;
//  · cada ESQUEMA de edificio (2026-11-22, PALETA.fachadas; color.js elegirEsquema), bien armado: los marcos se ven contra
//    cada tono de la pared (contraste ≥ 1,3 o ΔE ≥ 20), la puerta y el techo se separan de ella (ΔE ≥ 20 y ≥ 12), el zócalo
//    (ΔE ≥ 10) y los detalles se notan (ΔE ≥ 6); cada barrio con sus esquemas;
//  · cada edificio y cada casa, un esquema entero —la pared, uno de sus tonos; las demás piezas, las del esquema, sin
//    mezclarse con otro—; dos vecinos que no se distinguen (color.js distanciaFachadas < reglas.fachadas) son a lo sumo el
//    10 % de los pares de vecinos;
//  · la ciudad: al menos 4 esquemas; ningún color de pared pasa del 25 %;
//  · el pintado es igual por semilla.
// Uso: node scripts/validar-color.mjs [ciudades=4] [semilla0=1]
import {generateBlueprint} from '../../src/engine/blueprint.js';
import {PALETA} from '../../src/engine/medidas.js';
import {deltaE,contraste,familiaDe,distanciaFachadas} from '../../src/engine/color.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||4),S0=+(A[1]||1),R=PALETA.reglas;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const tocan=(a,b)=>{const ox=Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0),oz=Math.min(a.z1,b.z1)-Math.max(a.z0,b.z0),E=.02;return (Math.abs(ox)<=E&&oz>.3)||(Math.abs(oz)<=E&&ox>.3);};
// la paleta: dentro de cada familia, colores separados (si no, dos cuartos vecinos de la misma función no pueden diferir)
for(const [k,l] of Object.entries(PALETA.cuarto))for(let i=0;i<l.length;i++)for(let j=i+1;j<l.length;j++)if(deltaE(l[i],l[j])<R.familia)falla('dos colores de una familia casi iguales',{familia:k,a:l[i],b:l[j]});
const med={cuartos:0,pares:0,iguales:0,dEmin:[],fachadas:{},n:0,esq:{},porCiudad:[],vecinos:0,parecidos:0};
// los esquemas, bien armados
for(const [id,E] of Object.entries(PALETA.fachadas))for(const p of E.pared){const ej={esquema:id,pared:p};
 if(contraste(E.marco,p)<1.3&&deltaE(E.marco,p)<20)falla('marcos que no se ven contra la pared',{...ej,marco:E.marco});
 if(deltaE(E.puerta,p)<20)falla('puerta que no se separa de la pared',{...ej,puerta:E.puerta});
 if(deltaE(E.techo,p)<12)falla('techo que no se separa de la pared',{...ej,techo:E.techo});
 if(deltaE(E.zocalo,p)<10)falla('zócalo que no se separa de la pared',{...ej,zocalo:E.zocalo});
 if(deltaE(E.detalle,p)<6)falla('detalles que no se notan',{...ej,detalle:E.detalle});}
for(const [b,ids] of Object.entries(PALETA.fachadasDe))for(const id of ids)if(!PALETA.fachadas[id])falla('un barrio con un esquema que no existe',{barrio:b,id});
const revisarPiso=(cs,id)=>{for(let i=0;i<cs.length;i++)for(let j=i+1;j<cs.length;j++){if(!tocan(cs[i].rect,cs[j].rect)||(cs[i].tipo==='pasillo'&&cs[j].tipo==='pasillo'))continue;/* (los tramos de un pasillo: el mismo color, a propósito) */med.pares++;const d=deltaE(cs[i].color,cs[j].color);med.dEmin.push(d);if(d<R.vecinos)falla('cuartos vecinos casi del mismo color',{...id,a:cs[i].tipo,b:cs[j].tipo,dE:+d.toFixed(1)});}};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),id={semilla:s};
 const huella=o=>JSON.stringify(o.colores);if(JSON.stringify(generateBlueprint({seed:s,team:3}).lots.map(huella))!==JSON.stringify(bp.lots.map(huella)))falla('el pintado cambia entre dos corridas de la misma semilla',id);
 const lotes=[...bp.lots,...(bp.isla.lots||[]).filter(L=>L.parts)],caja=L=>{const p=L.parts;return {x0:Math.min(...p.map(q=>q.x)),x1:Math.max(...p.map(q=>q.x+q.w)),z0:Math.min(...p.map(q=>q.y)),z1:Math.max(...p.map(q=>q.y+q.h))};},cajas=lotes.map(caja);
 const exterior=(o,donde,casa=false)=>{const C=o.colores;if(!C){falla('sin pintar',{...id,donde});return;}const E=PALETA.fachadas[C.esquema];if(!E){falla('sin esquema',{...id,donde});return;}
  const ej={...id,donde,esquema:C.esquema,f:C.fachada};med.n++;med.esq[C.esquema]=(med.esq[C.esquema]||0)+1;
  if(!E.pared.includes(C.fachada))falla('pared fuera de su esquema',ej);
  for(const [k,v] of [['moldura',casa?E.marco:E.detalle],['marco',E.marco],['acento',E.puerta],['zocalo',E.zocalo],['techo',E.techo],['culata',E.culata]])if(C[k]!==v)falla('una pieza de otro esquema',{...ej,pieza:k,es:C[k],deberia:v});
  med.fachadas[C.fachada]=(med.fachadas[C.fachada]||0)+1;};
 const vecinos=(a,b,ej)=>{med.vecinos++;if(distanciaFachadas(a.colores,b.colores)<R.fachadas){med.parecidos++;if(med.parecidos<=3)falla('vecinos que no se distinguen (ejemplo)',{...ej,a:a.colores.esquema,b:b.colores.esquema});}};
 const ec=new Set(bp.lots.map(L=>L.colores.esquema));med.porCiudad.push(ec.size);if(ec.size<4)falla('la ciudad con menos de 4 esquemas',{...id,n:ec.size});
 lotes.forEach((L,i)=>{exterior(L,L.type);
  for(let j=0;j<i;j++){const a=cajas[i],b=cajas[j];if(Math.max(a.x0-b.x1,b.x0-a.x1,a.z0-b.z1,b.z0-a.z1)>6.01)continue;vecinos(L,lotes[j],{...id,a:L.type,b:lotes[j].type});}
  for(const lv of L.levels||[]){const cs=lv.rooms.map(q=>({tipo:q.type,color:L.colores.cuartos[lv.level+':'+q.id],rect:{x0:q.x,x1:q.x+q.w,z0:q.y,z1:q.y+q.h}}));
   for(const c of cs){med.cuartos++;if(!c.color){falla('cuarto sin color',{...id,tipo:c.tipo});continue;}if(!PALETA.cuarto[familiaDe(c.tipo)].includes(c.color))falla('cuarto con un color de otra familia',{...id,tipo:c.tipo});}
   revisarPiso([...cs.filter(c=>c.color),...(lv.corridor||[]).map(k=>({tipo:'pasillo',color:L.colores.pasillo[lv.level],rect:{x0:k.x,x1:k.x+k.w,z0:k.y,z1:k.y+k.h}}))],{...id,lote:L.type,piso:lv.level});}});
 const casas=(bp.isla.casas||[]).filter(h=>h.spec);casas.forEach((h,i)=>{exterior(h,'casa',true);
  for(let j=0;j<i;j++)if(Math.hypot(casas[j].x-h.x,casas[j].z-h.z)<24)vecinos(h,casas[j],{...id,casa:true});
  for(const lv of h.spec.hogar?.levels||[]){const cs=lv.rooms.map(q=>({tipo:q.type,color:h.colores.cuartos[lv.level+':'+q.id],rect:{x0:q.u0,x1:q.u1,z0:q.v0,z1:q.v1}}));for(const c of cs){med.cuartos++;if(!c.color)falla('cuarto de casa sin color',{...id,tipo:c.tipo});}revisarPiso(cs.filter(c=>c.color),{...id,casa:h.manzana,piso:lv.level});}});}
const tot=Object.values(med.fachadas).reduce((a,b)=>a+b,0),max=Math.max(...Object.values(med.fachadas))/tot;if(max>.25)falla('un color de fachada domina (más del 25 %)',{parte:+max.toFixed(2)});
if(med.vecinos&&med.parecidos/med.vecinos>.1)falla('vecinos que no se distinguen (más del 10 % de los pares)',{parte:+(med.parecidos/med.vecinos).toFixed(2)});
// (los ejemplos de arriba no son falla si son pocos: se descuentan)
if(med.vecinos&&med.parecidos/med.vecinos<=.1)fallas.delete('vecinos que no se distinguen (ejemplo)');
console.log(`esquemas · ${med.n} fachadas y casas · por ciudad ${med.porCiudad.join(', ')} esquemas · ${Object.entries(med.esq).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+' '+Math.round(100*v/med.n)+' %').join(', ')} · vecinos parecidos ${med.parecidos} de ${med.vecinos} pares (${(100*med.parecidos/Math.max(1,med.vecinos)).toFixed(1)} %)`);
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.floor(p*(b.length-1))];};
console.log(`color · ${med.cuartos} cuartos · ${med.pares} pares de vecinos: ΔE p1 ${q(med.dEmin,.01).toFixed(1)}, mediana ${q(med.dEmin,.5).toFixed(1)} (mínimo ${R.vecinos}) · fachadas: ${Object.keys(med.fachadas).length} colores, el más usado ${(100*max).toFixed(0)} %`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
