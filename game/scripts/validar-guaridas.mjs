// Nivel 9 del probador (2026-10-17, Miguel: «que el sistema escoja las guaridas, en lugares estratégicos, que roten y
// consuman varios lugares del mapa para que no sea preferible cuál; a los ladrones se les dice el lugar exacto»).
// Por ciudad y por tamaño de equipo (2, 3, 5, 8 policías), GUARIDA.rotacion.rondas rondas (engine/guaridas.js), y por
// cada ronda, medido aparte del que las elige:
//  · cuántas: una por cada GUARIDA.porPolicias policías;
//  · cada una con ≥ GUARIDA.entradas puertas de afuera, a ≥ GUARIDA.comisaria m caminando de la comisaría;
//  · entre dos de la misma ronda, ≥ GUARIDA.entre m caminando; su acceso al botín, a ±GUARIDA.equidad entre ellas; con
//    dos o más, al menos una en la ciudad (un apartamento) y una en el monte (una casa);
//  · la caja: dentro de un cuarto del apartamento (o de la casa) y su frente alcanzable caminando desde la calle;
//  · la dirección: vía y número, y en un edificio, su nombre, piso y apartamento.
// Y la rotación, por ciudad y tamaño: ningún lugar es guarida en más de GUARIDA.rotacion.maxUso de las rondas; se
// cuenta cuántos lugares distintos se usan y cuántos de la ciudad y del monte.
// Uso: node scripts/validar-guaridas.mjs [ciudades=2] [semilla0=1]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {GUARIDA} from '../src/engine/medidas.js';
import {prepararGuaridas,guaridasDe,cuantasGuaridas} from '../src/engine/guaridas.js';
import {caminarDesde} from '../src/engine/circulacion.js';
import {navEdificio,navCasa} from '../src/engine/nav-interior.js';
import {casaAMundo} from '../src/engine/botin.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||2),S0=+(A[1]||1),R=GUARIDA.rotacion.rondas,EQUIPOS=[2,3,5,8];
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b.length?+b[Math.min(b.length-1,Math.floor(p*b.length))].toFixed(0):NaN;};
const med={rondas:0,guaridas:0,entre:[],spread:[],com:[],ciudad:0,monte:0,distintos:[],maxUso:[],ms:[]};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),prep=prepararGuaridas(bp),{g,en}=prep;
 const navs=new Map(),navDe=k=>navs.get(k)||navs.set(k,k[0]==='L'?navEdificio(bp.lots[+k.slice(1)]):navCasa(bp.isla.casas[+k.slice(1)])).get(k);
 for(const pol of EQUIPOS){const uso=new Map();
  for(let ronda=0;ronda<R;ronda++){const t=Date.now(),gs=guaridasDe(bp,{policias:pol,ronda,prep});med.ms.push(Date.now()-t);med.rondas++;const ej={semilla:s,policias:pol,ronda};
   if(gs.length!==cuantasGuaridas(pol))falla('no son las guaridas que tocan',{...ej,hay:gs.length,tocan:cuantasGuaridas(pol)});
   for(const x of gs){med.guaridas++;uso.set(x.lugar,(uso.get(x.lugar)||0)+1);x.tipo==='casa'?med.monte++:med.ciudad++;
    if(x.entradas.length<GUARIDA.entradas)falla('guarida con pocas entradas',{...ej,lugar:x.lugar,entradas:x.entradas.length});
    // (la distancia a la comisaría, medida de nuevo desde sus puertas)
    const est=bp.lots.find(L=>L.type==='comisaria');if(est){const lv=est.levels[0],dentro=(px,pz)=>est.parts.some(p=>px>p.x&&px<p.x+p.w&&pz>p.y&&pz<p.y+p.h);
     const pe=lv.doors.filter(d=>d.street).map(d=>{const mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2,h=Math.abs(d.y0-d.y1)<1e-6;return (h?[[mx,mz-.6],[mx,mz+.6]]:[[mx-.6,mz],[mx+.6,mz]]).find(([a,b])=>!dentro(a,b));}).filter(Boolean);
     const dC=x._dC||(prep._dC=prep._dC||caminarDesde(g,pe)),dc=Math.min(...x.entradas.map(e=>en(dC,e.x,e.z)));med.com.push(dc);if(dc<GUARIDA.comisaria-1)falla('guarida cerca de la comisaría',{...ej,lugar:x.lugar,m:+dc.toFixed(0)});}
    if(!x.direccion||!/#/.test(x.direccion))falla('guarida sin dirección',{...ej,lugar:x.lugar});
    if(x.tipo==='edificio'&&(x.piso==null||!x.apto||!x.nombre))falla('apartamento sin edificio, piso o número',{...ej,lugar:x.lugar});
    // la caja: en un cuarto de su apartamento (o de la casa) y con su frente alcanzable
    const c=x.caja;if(!c){falla('guarida sin caja',{...ej,lugar:x.lugar});continue;}
    if(x.tipo==='edificio'){const lv=bp.lots[x.lote].levels.find(l=>l.level===c.nivel),qq=lv?.rooms.find(r=>c.x>r.x&&c.x<r.x+r.w&&c.z>r.y&&c.z<r.y+r.h);
     if(!qq||qq.unit!==x.apto)falla('la caja no está en el apartamento',{...ej,lugar:x.lugar,apto:x.apto,cuarto:qq?.type,unidad:qq?.unit});
     const p=navDe(x.lugar).find(p=>p.nivel===c.nivel),k=p?.g.idx(c.frente.x,c.frente.z);let ok=false;if(k>=0)for(let dj=-2;dj<=2&&!ok;dj++)for(let di=-2;di<=2;di++){const kk=k+dj*p.g.nx+di;if(kk>=0&&p.dist[kk]>=0){ok=true;break;}}
     if(!ok)falla('a la caja no se llega caminando',{...ej,lugar:x.lugar});}
    else{const h=bp.isla.casas[x.casa],P=h.spec.hogar,lv=P.levels[0],aM=casaAMundo(h);
     const qq=lv.rooms.find(r=>{const [ax,az]=aM(r.u0,r.v0),[bx,bz]=aM(r.u1,r.v1);return c.x>Math.min(ax,bx)&&c.x<Math.max(ax,bx)&&c.z>Math.min(az,bz)&&c.z<Math.max(az,bz);});
     if(!qq)falla('la caja no está en un cuarto de la casa',{...ej,lugar:x.lugar});}}
   // entre las de la ronda: caminando y su acceso al botín
   for(let i=0;i<gs.length;i++){const di=caminarDesde(g,gs[i].entradas.map(e=>[e.x,e.z]));for(let j=i+1;j<gs.length;j++){const d=Math.min(...gs[j].entradas.map(e=>en(di,e.x,e.z)));med.entre.push(d);if(d<GUARIDA.entre-1)falla('dos guaridas cerca',{...ej,m:+d.toFixed(0)});}}
   if(gs.length>1&&!(gs.some(x=>x.tipo==='casa')&&gs.some(x=>x.tipo==='edificio')))falla('ronda sin guarida en la ciudad y en el monte',{...ej,tipos:gs.map(x=>x.tipo)});
   if(gs.length>1){const a=gs.map(x=>x.acceso),lo=Math.min(...a),hi=Math.max(...a),sp=(hi-lo)/((hi+lo)/2);med.spread.push(sp*100);if(sp>2*GUARIDA.equidad+1e-6)falla('una guarida mucho mejor ubicada que otra',{...ej,acceso:a});}}
  // la rotación: ningún lugar en más de maxUso de las rondas
  const mx=Math.max(...uso.values());med.distintos.push(uso.size);med.maxUso.push(mx/R);
  if(mx/R>GUARIDA.rotacion.maxUso+1e-9)falla('un lugar sale de guarida demasiadas rondas',{semilla:s,policias:pol,veces:mx,rondas:R});}}
console.log(`guaridas · ${N} ciudades × ${EQUIPOS.join('/')} policías × ${R} rondas = ${med.rondas} rondas, ${med.guaridas} guaridas (ciudad ${med.ciudad}, monte ${med.monte}) · entre guaridas p10/50: ${q(med.entre,.1)}/${q(med.entre,.5)} m · de la comisaría p10: ${q(med.com,.1)} m · diferencia de acceso p50/máx: ${q(med.spread,.5)}/${q(med.spread,1)} % · lugares distintos por ciudad y tamaño: ${med.distintos.join(', ')} · uso máximo de un lugar: ${Math.round(Math.max(...med.maxUso)*100)} % · ${q(med.ms,.5)} ms por ronda`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
