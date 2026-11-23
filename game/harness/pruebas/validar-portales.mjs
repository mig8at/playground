// Las aberturas y lo que se ve por ellas (2026-11-22, Miguel: «aterrízalo en el motor 2D, así también podemos calcular»;
// engine/portales.js), en node, sobre las puertas de calle de N ciudades:
//  · de frente, a 6 m y con la puerta abierta, se la ve y su lote arma su interior;
//  · de espaldas, no; con la puerta cerrada, no; a más de PORTALES.lejos m, no; desde el otro lado del edificio —mirando
//    hacia la puerta, pero por detrás de su fachada—, no;
//  · tapada por otro edificio: desde un punto de la calle cuyo camino a la puerta cruza otro lote (medido exacto, por
//    intersección de segmento y rectángulo, a la altura del ojo y bajo su techo), la da por tapada; y donde el camino no
//    cruza nada, por libre (el rayo de pasos de PORTALES.paso m contra el cálculo exacto: coinciden en ≥ 98 %);
//  · lo que vale la pena: de frente a 6 m, más de PORTALES.pxMin px y su cuarto en cuartos; a 30 m en 200 px, chica; y
//    cada ventana, con el cuarto de detrás;
//  · las casas del monte (aberturasDeCasas): cada ventana con su vidrio y su cuarto; de frente y abierta se ve con su cuarto,
//    cerrada no.
// Uso: node harness/pruebas/validar-portales.mjs [ciudades=2] [semilla0=1]
import {generateBlueprint} from '../../src/engine/blueprint.js';
import {aberturasDe,aberturasDeCasas,vistaDesde,libre,PORTALES} from '../../src/engine/portales.js';
import {planHouse} from '../../src/engine/vivienda.js';
import {entregaCasa} from '../../src/engine/entrega.js';
const A0=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A0[0]||2),S0=+(A0[1]||1);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const med={puertas:0,frente:0,acuerdo:0,casos:0,tapadas:0,conCuarto:0,chicas:0,ventanas:0,ventanasConCuarto:0,casaVentanas:0,casaVistas:0};
const mirar=(c,x,z)=>({...c,yaw:Math.atan2(-(x-c.x),-(z-c.z)),pitch:0,fov:75,aspect:1.5});
const clave=a=>`${a.x.toFixed(2)},${a.z.toFixed(2)},${a.y0.toFixed(1)}`;
// (el cruce exacto de un segmento con un rectángulo —Liang-Barsky—: cuánto de él queda adentro)
const cruce=(x0,z0,x1,z1,r)=>{let t0=0,t1=1;const dx=x1-x0,dz=z1-z0;for(const [p,q] of [[-dx,x0-r.x0],[dx,r.x1-x0],[-dz,z0-r.z0],[dz,r.z1-z0]]){if(Math.abs(p)<1e-12){if(q<0)return 0;continue;}const t=q/p;if(p<0){if(t>t1)return 0;if(t>t0)t0=t;}else{if(t<t0)return 0;if(t<t1)t1=t;}}return Math.max(0,t1-t0)*Math.hypot(dx,dz);};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3,parks:true}),A=aberturasDe(bp),partes=bp.lots.flatMap(L=>(L.parts||[]).map(p=>({lote:L.id,x0:p.x,x1:p.x+p.w,z0:p.y,z1:p.y+p.h,techo:(L.floors||1)*PORTALES.piso})));
 const dentro=(x,z)=>partes.some(p=>x>p.x0&&x<p.x1&&z>p.z0&&z<p.z1);
 // (las casas del monte: cada ventana con su vidrio —el plano lo marca— y su cuarto; de frente a 4 m y abierta, se ve con su
 // cuarto; cerrada, no)
 {const cs=(bp.isla?.casas||[]).filter(c=>c.spec).map((c,i)=>{const ry=c.ry||0;return {i,plan:planHouse(entregaCasa(c.spec)),x:c.x,y:c.nivel||0,z:c.z,c:Math.cos(ry),s:Math.sin(ry)};});
  const AC=aberturasDeCasas(cs);for(const a of AC.filter(a=>a.tipo==='ventana')){med.casaVentanas++;const ej={semilla:s,ventana:a.clave},oi=+a.clave.split(':v')[1],P=cs[a.casa].plan;
   if(!P.boxes.some(b=>b.ventana===oi))falla('ventana de casa sin su vidrio',ej);if(!a.cuarto){falla('ventana de casa sin su cuarto',ej);continue;}
   const c=mirar({x:a.x+a.nx*4,y:(a.y0+a.y1)/2,z:a.z+a.nz*4},a.x,a.z),v=vistaDesde(bp,c,{ventanas:[a.clave]},AC);
   if(v.vistas.some(x=>x.clave===a.clave)){med.casaVistas++;if(!v.cuartos.get(a.lote)?.has(a.cuarto.id))falla('ventana de casa vista, sin su cuarto',ej);}
   if(vistaDesde(bp,c,{},AC).vistas.some(x=>x.clave===a.clave))falla('ventana de casa cerrada, se ve',ej);}}
 for(const a of A.filter(a=>a.tipo==='ventana')){med.ventanas++;if(a.cuarto)med.ventanasConCuarto++;else falla('ventana sin su cuarto',{semilla:s,ventana:a.clave});}
 for(const a of A.filter(a=>a.tipo==='puerta')){med.puertas++;const ej={semilla:s,puerta:a.clave};
  // (afuera: el lado de la calle, a 6 m sobre la normal de la puerta)
  const n=a.h?[[0,1],[0,-1]]:[[1,0],[-1,0]],[nx,nz]=n.find(([x,z])=>!dentro(a.x+x*.8,a.z+z*.8))||n[0],ojo=a.y0+1.7;
  const c=mirar({x:a.x+nx*6,y:ojo,z:a.z+nz*6},a.x,a.z),abiertas={puertas:[clave(a)]};
  if(dentro(c.x,c.z))continue;med.frente++;
  const v=vistaDesde(bp,c,abiertas);if(!v.lotes.has(a.lote))falla('de frente y abierta, no se ve',ej);
  // (lo que vale la pena: de frente a 6 m mide más de pxMin y su cuarto —el de detrás de la puerta— va en cuartos; a 30 m en una
  // pantalla de 200 px de alto, es chica: no se arma)
  {const vv=v.vistas.find(x=>x.clave===a.clave);if(vv&&vv.px<PORTALES.pxMin)falla('de frente a 6 m, chica',{...ej,px:vv.px});if(vv&&a.cuarto){med.conCuarto++;if(!v.cuartos.get(a.lote)?.has(a.cuarto.id))falla('vista, sin su cuarto en cuartos',ej);}
   const c30=mirar({x:a.x+nx*30,y:ojo,z:a.z+nz*30,alto:200},a.x,a.z),v30=vistaDesde(bp,c30,abiertas);if(v30.vistas.some(x=>x.clave===a.clave))falla('a 30 m en 200 px, vale la pena',ej);if(v30.chicas.some(x=>x.clave===a.clave))med.chicas++;}
  if(vistaDesde(bp,{...c,yaw:c.yaw+Math.PI},abiertas).vistas.some(x=>x.clave===a.clave))falla('de espaldas, se ve',ej);
  if(vistaDesde(bp,c,{}).vistas.some(x=>x.clave===a.clave))falla('cerrada, se ve',ej);
  {const atras=mirar({x:a.x-nx*8,y:ojo,z:a.z-nz*8},a.x,a.z);if(vistaDesde(bp,atras,abiertas).vistas.some(x=>x.clave===a.clave))falla('desde atrás de la fachada, se ve',ej);}
  const lejos=mirar({x:a.x+nx*(PORTALES.lejos+5),y:ojo,z:a.z+nz*(PORTALES.lejos+5)},a.x,a.z);if(vistaDesde(bp,lejos,abiertas).vistas.some(x=>x.clave===a.clave))falla('demasiado lejos, se ve',ej);
  // (el rayo contra el cálculo exacto, desde puntos de la calle alrededor, a 20 m)
  for(let k=0;k<12;k++){const ang=k/12*Math.PI*2,cx=a.x+Math.cos(ang)*20,cz=a.z+Math.sin(ang)*20;if(dentro(cx,cz))continue;const cam={x:cx,y:ojo,z:cz};
   const propio=new Set([a.lote]),exacto=!partes.some(p=>!propio.has(p.lote)&&ojo<p.techo&&cruce(cx,cz,a.x,a.z,{x0:p.x0+.05,x1:p.x1-.05,z0:p.z0+.05,z1:p.z1-.05})>PORTALES.paso*1.5)/* (por dentro: rozar el borde de un edificio no lo tapa) */,rayo=libre(bp,cam,a);
   med.casos++;if(exacto===rayo)med.acuerdo++;else if(!exacto&&rayo)falla('tapada por otro edificio, la da por libre',{...ej,desde:[+cx.toFixed(1),+cz.toFixed(1)]});if(!rayo)med.tapadas++;}}}
const acuerdo=med.acuerdo/Math.max(1,med.casos);if(acuerdo<.98)falla('el rayo y el cálculo exacto no coinciden',{parte:+acuerdo.toFixed(3)});
// (los «tapada, la da por libre» de arriba son fallas sólo si son más del 2 %: el rayo de pasos se salta esquinas finas)
if(acuerdo>=.98)fallas.delete('tapada por otro edificio, la da por libre');
console.log(`portales · ${N} ciudades · ${med.puertas} puertas de calle, ${med.frente} vistas de frente · el rayo contra el exacto: ${(100*acuerdo).toFixed(1)} % de ${med.casos} casos (${med.tapadas} tapadas) · ${med.conCuarto} vistas con su cuarto, ${med.chicas} chicas a 30 m · ${med.ventanasConCuarto} de ${med.ventanas} ventanas con su cuarto · casas del monte: ${med.casaVentanas} ventanas, ${med.casaVistas} vistas de frente con su cuarto`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
process.exit(fallas.size?1:0);
