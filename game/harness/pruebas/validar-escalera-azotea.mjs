// La escalera llega a la azotea (2026-11-22, Miguel: «que las escaleras lleguen a la terraza»). Sin pantalla, con el mundo
// 3D armado como el juego (sin-pantalla.mjs): en cada edificio de techo plano con escalera y dos pisos o más se camina,
// desde el vano del último piso, por el carril A hasta el descanso y de vuelta por el B, de a 5 cm, con floorAt —el piso
// que pisa el jugador—. Falla si en algún paso hay que subir más de un escalón (45 cm) o si al final los pies no quedan a
// la altura del techo. Los de mansarda no suben (su techo es inclinado) y no se cuentan.
// Uso: node harness/pruebas/validar-escalera-azotea.mjs [ciudades=1] [semilla0=1]
import {armarMundo} from './sin-pantalla.mjs';
const N=+(process.argv[2]||1),S0=+(process.argv[3]||1),FLOOR=3,ESCALON=.46;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
let probados=0,llegan=0,mansardas=0;const t0=Date.now();
for(let s=S0;s<S0+N;s++){const {world:w,bp}=await armarMundo(s,3);
 for(const L of bp.lots){const s0=L.levels?.[0]?.stair;if(!s0||L.floors<2)continue;if(L.mansarda){mansardas++;continue;}
  const R=w.lots.get(L.id)?.raise||0,P=(a,b)=>[s0.x+s0.ux*a+s0.vx*b,s0.z+s0.uz*a+s0.vz*b],W=s0.w||2,path=[];let feet=(L.floors-1)*FLOOR+R+.02,ok=true;
  for(let b=.3;b<=s0.d-.2;b+=.05)path.push(P(W*.25,b));for(let a=W*.25;a<=W*.75;a+=.05)path.push(P(a,s0.d-.25));for(let b=s0.d-.25;b>=.3;b-=.05)path.push(P(W*.75,b));
  for(const [x,z] of path){const g=w.floorAt(x,z,feet);if(g-feet>ESCALON){ok=false;falla('un paso más alto que un escalón',{ciudad:s,lote:L.id,pies:+feet.toFixed(2),piso:+g.toFixed(2)});break;}feet=g;}
  probados++;if(ok&&Math.abs(feet-(L.floors*FLOOR+R))<.15)llegan++;else if(ok)falla('la escalera no llega a la azotea',{ciudad:s,lote:L.id,pies:+feet.toFixed(2),techo:L.floors*FLOOR+R});}}
console.log(`escalera a la azotea · ${N} ciudades · ${probados} edificios de techo plano con escalera, ${llegan} llegan caminando a la azotea (${mansardas} de mansarda, sin subida) · ${Math.round((Date.now()-t0)/1000)} s`);
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size?1:0);
