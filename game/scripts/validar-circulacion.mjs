// Valida la circulación con matemática, sin el 3D (2026-10-15, circulacion.js). Peatones: la grilla de navegación —se
// llega caminando a cada puerta de calle, a la escalinata y al mirador; qué queda encerrado y por qué; el rodeo entre
// puertas (≤ CIRCULACION.peaton.rodeo)—. Vehículos: la red de carriles —una sola, sin carriles tapados, pendientes ≤ tope,
// calles sin salida, rodeo— y el radio de giro que dejan las esquinas.
// Uso: node scripts/validar-circulacion.mjs [ciudades=4] [semilla0=1] [jugadores=3]
import {generateBlueprint,CELL,CARRETERA} from '../src/engine/blueprint.js';
import {CIRCULACION as C,CALLE} from '../src/engine/medidas.js';
import {redVehicular,grillaPeatonal,caminar,cuerpoCasa} from '../src/engine/circulacion.js';
import {rng} from '../src/engine/veredas.js';
import City from '../src/engine/ciudad.js';

const N=+(process.argv[2]||4),S0=+(process.argv[3]||1),TEAM=+(process.argv[4]||3),K=City.K;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const avisos={},aviso=k=>avisos[k]=(avisos[k]||0)+1;
const med={alcance:[],bolsones:{},rodeoPie:[],rodeoAuto:[],puertas:[0,0],tramos:0,carriles:0,puntas:0,glorietas:0};
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.min(b.length-1,Math.floor(p*b.length))]:NaN;};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:TEAM}),m=bp.map,I=bp.isla,{W,H}=m,Wm=W*CELL,Hm=H*CELL,r=rng(s*7919);
 // ======== peatones ========
 const g=grillaPeatonal(bp);let libres=0;for(const v of g.libre)libres+=v;
 // la semilla: la primera casilla de calle
 let s0=0;for(let i=0;i<W*H;i++)if(m.kind[i]===K.street){s0=i;break;}
 const d0=caminar(g,(s0%W+.5)*CELL,(Math.floor(s0/W)+.5)*CELL);let alc=0;for(let k=0;k<d0.length;k++)if(d0[k]<Infinity)alc++;med.alcance.push(alc/libres);
 // los bolsones: celdas libres que no se alcanzan, por qué son (patio de manzana, lote del monte, monte, playa...)
 const cel=new Map(I.cells.map(c=>[c.x+','+c.y,c]));
 for(let k=0;k<d0.length;k++){if(!g.libre[k]||d0[k]<Infinity)continue;const x=g.X0+((k%g.nx)+.5)*g.celda,z=g.Z0+(Math.floor(k/g.nx)+.5)*g.celda;let t;
  if(x>=0&&z>=0&&x<Wm&&z<Hm){const kd=m.kind[Math.floor(z/CELL)*W+Math.floor(x/CELL)];t=kd===K.courtyard?'patio de manzana (se entra por los edificios)':kd===K.plaza?'plaza':calleK(kd)?'calle':'otro de la ciudad';}
  else{const c=cel.get(Math.floor(x/CELL)+','+Math.floor(z/CELL));t=c?.lote?'lote del monte':c?.zona==='montaña'?'monte natural':c?.zona||'?';}
  med.bolsones[t]=(med.bolsones[t]||0)+g.celda*g.celda;}
 function calleK(k){return k===K.street||k===K.avenue||k===K.kiosk;}
 // las puertas: las de calle de la ciudad y de los residenciales (a 0,6 m de la fachada, hacia afuera) y el frente de cada casa
 const puertas=[];
 for(const L of [...bp.lots,...(I.lots||[]).filter(L=>L.levels)])for(const d of L.levels?.[0]?.doors||[]){if(!d.street)continue;const mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2,h=Math.abs(d.y1-d.y0)<1e-6,p=L.parts.find(p=>mx>=p.x-1e-6&&mx<=p.x+p.w+1e-6&&mz>=p.y-1e-6&&mz<=p.y+p.h+1e-6)||L.parts[0];
  const cx=p.x+p.w/2,cz=p.y+p.h/2,sx=h?0:Math.sign(mx-cx),sz=h?Math.sign(mz-cz):0;puertas.push({x:mx+sx*(C.peaton.radio+.4),z:mz+sz*(C.peaton.radio+.4),de:L.type});}
 for(const h of I.casas||[]){const b=cuerpoCasa(h),o=C.peaton.radio+.4;puertas.push({x:b.puerta.x+b.afuera.x*o,z:b.puerta.z+b.afuera.z*o,de:'casa'});}
 for(const p of puertas){med.puertas[1]++;const k=g.idx(p.x,p.z);let ok=false;// (la celda o una vecina a ≤ 1 m)
  for(let dj=-2;dj<=2&&!ok;dj++)for(let di=-2;di<=2;di++){const kk=k+dj*g.nx+di;if(kk>=0&&kk<d0.length&&d0[kk]<Infinity){ok=true;break;}}
  if(ok)med.puertas[0]++;else falla('puerta a la que no se llega caminando',{semilla:s,de:p.de,x:+p.x.toFixed(1),z:+p.z.toFixed(1)});}
 const eje=I.grilla?.eje;if(eje){for(const [n,p] of [['escalinata',eje.escalinata[Math.floor(eje.escalinata.length/2)]],['mirador',eje.mirador]]){const k=g.idx(p.x,p.z);if(!(k>=0&&d0[k]<Infinity))falla(`no se llega caminando a${n==='mirador'?'l':' la'} ${n}`,{semilla:s});}}
 // el rodeo a pie: desde 6 puertas al azar, hasta todas las demás a más de 30 m en recta
 for(let t=0;t<6&&puertas.length;t++){const a=puertas[Math.floor(r()*puertas.length)],da=caminar(g,a.x,a.z);
  for(const b of puertas){const e=Math.hypot(b.x-a.x,b.z-a.z);if(e<30)continue;const k=g.idx(b.x,b.z);let best=Infinity;for(let dj=-2;dj<=2;dj++)for(let di=-2;di<=2;di++){const kk=k+dj*g.nx+di;if(kk>=0&&kk<da.length)best=Math.min(best,da[kk]);}
   if(best<Infinity){med.rodeoPie.push(best/e);if(best/e>C.peaton.rodeo)aviso('par de puertas con rodeo a pie > '+C.peaton.rodeo);}}}
 // ======== vehículos ========
 const red=redVehicular(bp),nd=new Map(red.nodos.map(v=>[v.id,v])),abiertas=new Set((I.gates||[]).filter(g=>g.calle).flatMap(g=>g.cells||[]).map(([x,y])=>y*W+x));med.tramos+=red.tramos.length;med.carriles+=red.carriles.length;
 // una sola red (todos los tramos son de doble mano: alcanza con la conexión sin sentido)
 {const ad=new Map(red.nodos.map(v=>[v.id,[]]));for(const t of red.tramos){ad.get(t.a).push(t.b);ad.get(t.b).push(t.a);}
  const vis=new Set([red.nodos[0].id]),qq=[red.nodos[0].id];for(let i=0;i<qq.length;i++)for(const b of ad.get(qq[i]))if(!vis.has(b)){vis.add(b);qq.push(b);}
  if(vis.size<red.nodos.length)falla('la red de calles no es una sola',{semilla:s,sueltos:red.nodos.length-vis.size});
  for(const v of red.nodos){if(ad.get(v.id).length===1){med.puntas++;}if(v.glorieta)med.glorietas++;}
  // el rodeo en auto: Dijkstra desde cada nodo
  const pesos=new Map(red.nodos.map(v=>[v.id,[]]));for(const t of red.tramos){let L=0;for(let i=1;i<t.puntos.length;i++)L+=Math.hypot(t.puntos[i].x-t.puntos[i-1].x,t.puntos[i].z-t.puntos[i-1].z);pesos.get(t.a).push([t.b,L]);pesos.get(t.b).push([t.a,L]);}
  for(const a of red.nodos.filter((_,i)=>i%4===0)){const dist=new Map([[a.id,0]]),abiertos=[[0,a.id]];while(abiertos.length){abiertos.sort((x,y)=>x[0]-y[0]);const [d,u]=abiertos.shift();if(d>dist.get(u))continue;for(const [v,w] of pesos.get(u)){const dd=d+w;if(dd<(dist.get(v)??Infinity)){dist.set(v,dd);abiertos.push([dd,v]);}}}
   for(const b of red.nodos){if(b===a)continue;const e=Math.hypot(b.x-a.x,b.z-a.z);if(e<50)continue;const d=dist.get(b.id);if(d!=null)med.rodeoAuto.push(d/e);}}}
 // pendientes y carriles tapados
 const tope=Math.tan(CARRETERA.grilla.gradoMax*Math.PI/180);
 for(const t of red.tramos)for(let i=1;i<t.puntos.length;i++){const a=t.puntos[i-1],b=t.puntos[i],L=Math.hypot(b.x-a.x,b.z-a.z);if(L>1e-6&&Math.abs(b.h-a.h)/L>tope+1e-6)falla('tramo más empinado que el tope de las calles',{semilla:s,pendiente:+(Math.abs(b.h-a.h)/L).toFixed(3)});}
 const cajas=red.nodos.filter(v=>v.glorieta);
 for(const l of red.carriles)for(let i=1;i<l.puntos.length;i++){const a=l.puntos[i-1],b=l.puntos[i],L=Math.hypot(b.x-a.x,b.z-a.z);for(let u=0;u<L;u+=1){const x=a.x+(b.x-a.x)*u/L,z=a.z+(b.z-a.z)*u/L;
   if(x>=0&&z>=0&&x<Wm&&z<Hm){const ci=Math.floor(z/CELL)*W+Math.floor(x/CELL),kd=m.kind[ci];if(calleK(kd)&&kd!==K.kiosk||abiertas.has(ci))continue;
    if(kd===K.kiosk&&cajas.some(v=>Math.hypot(v.x-x,v.z-z)<CELL*1.6)){aviso('carril que rodea la isla de una glorieta (m)');continue;}
    falla(kd===K.kiosk?'carril tapado por un remate':'carril que pasa por algo que no es calle',{semilla:s,x:+x.toFixed(0),z:+z.toFixed(0),casilla:kd});u=L;}
   else{const c=cel.get(Math.floor(x/CELL)+','+Math.floor(z/CELL));if(!c?.carretera&&!(c==null&&(x<0||z<0||x>Wm||z>Hm)&&Math.min(Math.abs(x),Math.abs(z),Math.abs(x-Wm),Math.abs(z-Hm))<CELL)){if(c&&!c.carretera){falla('carril del monte fuera de la calle',{semilla:s,x:+x.toFixed(0),z:+z.toFixed(0),zona:c.zona});u=L;}}}}}}
// el radio de giro que dejan las esquinas: a la derecha, desde el carril de la derecha hacia los dos carriles de la calle que
// recibe (el giro usa todo su ancho): el radio del eje ≈ esquina del cordón + media del desplazamiento de los dos carriles
const Ccar=C.vehiculo.carril,rGiro=C.vehiculo.esquina+(Ccar*.5+Ccar*1.5)/2;
const pc=([a,b])=>b?(100*a/b).toFixed(1)+' %':'—';
console.log(`${N} mundos`);
console.log(`peatones · se llega caminando al ${(100*Math.min(...med.alcance)).toFixed(1)}–${(100*Math.max(...med.alcance)).toFixed(1)} % de lo caminable · puertas alcanzadas ${pc(med.puertas)} · rodeo a pie: mediana ${q(med.rodeoPie,.5).toFixed(2)}, p90 ${q(med.rodeoPie,.9).toFixed(2)}, máx ${q(med.rodeoPie,1).toFixed(2)} (tope ${C.peaton.rodeo})`);
console.log(`  encerrado (m², todos los mundos): ${Object.entries(med.bolsones).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+' '+Math.round(v)).join(' · ')}`);
console.log(`vehículos · ${med.tramos} tramos, ${med.carriles} carriles · calles sin salida ${med.puntas} · glorietas ${med.glorietas} · rodeo en auto: mediana ${q(med.rodeoAuto,.5).toFixed(2)}, p90 ${q(med.rodeoAuto,.9).toFixed(2)}`);
console.log(`  radio de giro que dejan las esquinas (a la derecha, usando los dos carriles que recibe): ${rGiro.toFixed(1)} m · el auto de diseño pide ${C.vehiculo.radioGiro} m por el eje → el auto del juego, ≤ ${rGiro.toFixed(1)} m`);
console.log(`avisos: ${JSON.stringify(avisos)}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
