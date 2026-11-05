// Nivel 7 del probador (2026-10-16): el suelo de la CIUDAD —calles, veredas, plazas y cada piso de cada edificio— contra
// lo que se dibuja, sin pantalla (sin-pantalla.mjs armarMundo: la ciudad con sus modelos, como el demo). En cada punto:
//  · donde la física pone los pies (world3d floorAt) tiene que haber un piso dibujado (una cara que mira arriba a ≤ TOL):
//    si no, se camina sobre nada (o se ve más abajo: un hueco);
//  · ningún otro piso asoma entre TOL y 30 cm por encima (el pie se hunde en algo que se ve), salvo que ahí la física
//    frene (un estorbo: la base de un monumento).
// Afuera: 3×3 puntos por casilla abierta (calle, avenida, callejón, plaza). Adentro: 5 puntos por cuarto en cada piso,
// lejos de los muebles (sobre un mueble pisable la física sube a su tapa) y de las escaleras.
// Uso: node scripts/validar-pisos.mjs [ciudades=1] [semilla0=1]
import {armarMundo} from './sin-pantalla.mjs';
import {indiceTriangulos} from './medir3d.mjs';
import {CELL} from '../src/engine/veredas.js';
import City from '../src/engine/ciudad.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||1),S0=+(A[1]||1),TOL=.02,K=City.K,ABIERTA=new Set([K.street,K.avenue,K.alley,K.plaza,K.kiosk,K.courtyard]);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const med={afuera:0,adentro:0,sinPiso:{afuera:0,adentro:0},asoma:{afuera:0,adentro:0}},peor={};
for(let s=S0;s<S0+N;s++){const M=await armarMundo(s),{bp,world}=M,ix=indiceTriangulos(world.group,{arriba:true}),{W,H}=bp.map;
 const mira=(donde,x,z,feet,info)=>{const g=world.floorAt(x,z,feet),a=ix.arriba(x,z,true);med[donde]++;let cerca=Infinity,asoma=-Infinity;
  for(const y of a.todas){const d=y-g;if(Math.abs(d)<Math.abs(cerca))cerca=d;if(d>TOL&&d<=.3)asoma=Math.max(asoma,d);}
  if(process.env.VER_TIPOS&&asoma>-Infinity){const k=donde+' · '+(info.casilla?Object.entries(K).find(([,v])=>v===bp.map.kind[info.casilla[1]*W+info.casilla[0]])?.[0]:info.cuarto)+' · '+Math.round(asoma*1000)+' mm';med.tipos=med.tipos||{};med.tipos[k]=(med.tipos[k]||0)+1;}
  const ej={semilla:s,x:+x.toFixed(2),z:+z.toFixed(2),fisica:+g.toFixed(3),...info};
  if(Math.abs(cerca)>TOL){med.sinPiso[donde]++;falla(`${donde}: donde se pisa no hay piso dibujado`,{...ej,elMasCerca:Number.isFinite(cerca)?Math.round(cerca*1000)+' mm':'nada'});}
  // (lo que asoma y además frena —la base de un monumento, un macetero— es un estorbo, no un piso: no cuenta)
  if(asoma>-Infinity&&!world.collide(x,z,.05,true,feet)){med.asoma[donde]++;falla(`${donde}: un piso asoma sobre el que se pisa`,{...ej,mm:Math.round(asoma*1000)});}};
 for(let cy=0;cy<H;cy++)for(let cx=0;cx<W;cx++){if(!ABIERTA.has(bp.map.kind[cy*W+cx]))continue;for(const u of [.25,.5,.75])for(const v of [.25,.5,.75])mira('afuera',(cx+u)*CELL+.13,(cy+v)*CELL+.13,0,{casilla:[cx,cy]});}// (corridos 13 cm: la vereda va en cuadros de 1 m, y justo en su borde se ve el más alto de los dos)
 for(const [li,L] of bp.lots.entries())for(const lv of L.levels){const ms=(lv.furniture||[]).filter(f=>f.kind!=='alfombra');
  const libre=(x,z)=>!ms.some(f=>x>f.x-.35&&x<f.x+f.w+.35&&z>f.y-.35&&z<f.y+f.h+.35)&&!(lv.stairs||[]).some(st=>x>st.x-.3&&x<st.x+st.w+.3&&z>st.y-.3&&z<st.y+st.h+.3);
  const feet=lv.level*3+(world.lots.get(li)?.raise||0)+.1;
  for(const r of lv.rooms){if(r.w<1.2||r.h<1.2)continue;for(const [u,v] of [[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75]]){const x=r.x+r.w*u,z=r.y+r.h*v;if(libre(x,z))mira('adentro',x,z,feet,{lote:li,tipo:L.type,piso:lv.level,cuarto:r.type});}}}}
console.log(`pisos · ${N} ciudad(es) · afuera ${med.afuera} puntos (${med.sinPiso.afuera} sin piso dibujado, ${med.asoma.afuera} con un piso que asoma) · adentro ${med.adentro} (${med.sinPiso.adentro} sin piso, ${med.asoma.adentro} con uno que asoma)`);
if(med.tipos)console.log(med.tipos);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
process.exit(0);
