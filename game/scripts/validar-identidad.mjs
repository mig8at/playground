// Quién es quién (2026-10-18, Miguel: «que la policía no sepa el nombre del ladrón y sólo siga a los nombres»;
// engine/juego/identidad.js), en el 2D, en N ciudades:
//  · la identidad falsa de un ladrón tiene la misma forma que la de cualquiera —nombre y apellido (dos palabras, como el
//    censo), la edad de alguien que trabaja (entre la mínima y la máxima de los que trabajan) y un oficio del censo— y su
//    nombre NUNCA está en el censo (es lo que descubre «Pedir papeles»);
//  · se reparte como la gente: la edad media de las identidades falsas, a menos de EDAD_MAX años de la de los que trabajan,
//    y el oficio más común de las falsas es de los cinco más comunes del censo;
//  · el cartel sin papeles (cartelDe sin documentar) nunca trae el nombre, el oficio ni la edad, y para un ladrón y una
//    persona con el mismo aspecto es idéntico (el aspecto no recibe nada de la identidad);
//  · con los papeles pedidos, el cartel trae el nombre, el oficio y la edad —los del ladrón también, sin que falte nada—.
// Uso: node scripts/validar-identidad.mjs [ciudades=2] [semilla0=1]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {sociedadDe,enCenso} from '../src/engine/sociedad.js';
import {aspectoDe,cartelDe,identidadFalsa} from '../src/engine/juego/identidad.js';
import {rng} from '../src/engine/veredas.js';
const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||2),S0=+(A[1]||1),EDAD_MAX=3,M=400;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const PRENDAS={top:['camiseta','rayas','polo','camisa','sudadera','vestido'],outer:[null,null,'abrigo','chaleco'],bottom:['jean','pantalon','cargo','bermuda','pantaloneta','leggings','deportivo'],hat:[null,null,null,'gorra']};
const COLORES=['#f2f0ea','#2b2b2e','#c94f4f','#3a9a96','#3b6bb0','#e9c84a','#7a5236','#e49ab0','#4f8f5a'];
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),S=sociedadDe(bp),r=rng(s*7919+13),ej={semilla:s};
 const trab=S.personas.filter(p=>p.rol==='trabaja'),emin=Math.min(...trab.map(p=>p.edad)),emax=Math.max(...trab.map(p=>p.edad)),oficios=new Set(trab.map(p=>p.oficio));
 const falsas=Array.from({length:M},()=>identidadFalsa(S,r));
 for(const f of falsas){if(f.nombre.split(' ').length!==2)falla('nombre falso que no es nombre y apellido',{...ej,nombre:f.nombre});
  if(enCenso(S,f.nombre))falla('nombre falso que está en el censo',{...ej,nombre:f.nombre});
  if(!(f.edad>=emin&&f.edad<=emax))falla('edad falsa fuera de la de los que trabajan',{...ej,edad:f.edad,rango:[emin,emax]});
  if(!oficios.has(f.oficio))falla('oficio falso que nadie tiene',{...ej,oficio:f.oficio});
  if(Object.keys(f).sort().join()!=='edad,nombre,oficio')falla('la identidad falsa no tiene la forma de las otras',{...ej,claves:Object.keys(f)});}
 const prom=a=>a.reduce((x,y)=>x+y,0)/a.length,de=Math.abs(prom(falsas.map(f=>f.edad))-prom(trab.map(p=>p.edad)));if(de>EDAD_MAX)falla('las edades falsas no se reparten como las de verdad',{...ej,diferencia:+de.toFixed(1)});
 const cuenta=l=>{const m=new Map();for(const x of l)m.set(x,(m.get(x)||0)+1);return [...m].sort((a,b)=>b[1]-a[1]).map(x=>x[0]);};
 const top=cuenta(trab.map(p=>p.oficio)).slice(0,5);if(!top.includes(cuenta(falsas.map(f=>f.oficio))[0]))falla('el oficio falso más común no es de los comunes',{...ej,falso:cuenta(falsas.map(f=>f.oficio))[0],comunes:top});
 // los carteles
 const pick=a=>a[Math.floor(r()*a.length)];let carteles=0;
 for(let i=0;i<M;i++){const p=pick(S.personas.filter(q=>q.edad>=14)),f=falsas[i],look={modelo:pick(['Casual_Male','Casual_Female','Suit_Male','Worker_Female']),pelo:pick(['negro','castaño','rubio','canoso']),peinado:r()<.1?'rapado':undefined},
  outfit=Object.fromEntries(Object.entries(PRENDAS).map(([k,l])=>{const id=pick(l);return [k,id?{id,color:pick(COLORES)}:null];}));
  const asp=aspectoDe({look,outfit}),c1=cartelDe({aspecto:asp,identidad:{nombre:p.nombre,oficio:p.oficio,edad:p.edad}}),c2=cartelDe({aspecto:aspectoDe({look,outfit,...{nombre:f.nombre}}),identidad:f});carteles+=2;
  if(JSON.stringify(c1)!==JSON.stringify(c2))falla('sin papeles, el cartel del ladrón y el de la gente no son iguales',{...ej,gente:c1,ladron:c2});
  for(const [c,id] of [[c1,p],[c2,f]]){const txt=`${c.nombre} ${c.oficio}`;if(txt.includes(id.nombre)||txt.includes(id.nombre.split(' ')[1])||c.edad!=null)falla('sin papeles, el cartel dice el nombre o la edad',{...ej,cartel:c});
   if(id.oficio&&txt.toLowerCase().includes(id.oficio.toLowerCase()))falla('sin papeles, el cartel dice el oficio',{...ej,cartel:c,oficio:id.oficio});}
  const d2=cartelDe({aspecto:asp,identidad:f,documentado:true});if(d2.nombre!==f.nombre||d2.oficio!==f.oficio||d2.edad==null)falla('con papeles, al cartel del ladrón le falta algo',{...ej,cartel:d2});}
 const pol=aspectoDe({policia:true});if(pol.titulo!=='Agente de policía')falla('la policía no se reconoce por el uniforme',{...ej,pol});
 console.log(`identidad · ciudad ${s} · ${M} identidades falsas (edad media ${prom(falsas.map(f=>f.edad)).toFixed(1)} contra ${prom(trab.map(p=>p.edad)).toFixed(1)} de los que trabajan; ${new Set(falsas.map(f=>f.oficio)).size} oficios) · ${carteles} carteles sin papeles, ninguno con nombre, oficio ni edad · ej.: «${aspectoDe({look:{modelo:'Casual_Female',pelo:'castaño'},outfit:{top:{id:'camiseta',color:'#3a9a96'},bottom:{id:'jean',color:'#2b3d5c'},hat:{id:'gorra',color:'#2b2b2e'}}}).titulo}»`);}
let tot=0;for(const [k,f] of fallas){tot+=f.n;console.log(`  ${f.n}\t${k}`);for(const e of f.ej)console.log('     '+JSON.stringify(e).slice(0,240));}
console.log(`fallas: ${tot}`);
