// Los dúplex en 3D se suben caminando (2026-11-22, Miguel: «sigue con el 3D del dúplex»). Sin pantalla, con el mundo 3D
// armado como el juego (sin-pantalla.mjs): en cada dúplex —engine/duplex.js— se camina con floorAt, de a 5 cm, desde el
// último piso por su escalera privada —la recta de punta a punta; el caracol por el medio de los peldaños, en abanico— y al
// final se sale del hueco hacia el altillo. Falla si en algún paso hay que subir más de un escalón (45 cm), si al final los
// pies no quedan en el piso de la mansarda, o si el altillo, en su centro, no se pisa a esa altura.
// Uso: node harness/pruebas/validar-duplex-3d.mjs [ciudades=2] [semilla0=1]
import {armarMundo} from './sin-pantalla.mjs';
import {DUPLEX3D} from '../../src/lib/duplex3d.js';
const N=+(process.argv[2]||2),S0=+(process.argv[3]||1),FLOOR=3,ESCALON=.46;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
let probados=0,llegan=0,caracoles=0;const t0=Date.now();
for(let s=S0;s<S0+N;s++){const {world:w,bp}=await armarMundo(s,3);
 for(const L of bp.lots){if(!L.duplex)continue;const R=w.lots.get(L.id)?.raise||0,arriba=L.floors*FLOOR+R;
  for(const u of L.duplex.unidades){const E=u.escalera,path=[];let feet=(L.floors-1)*FLOOR+R+.02,ok=true;
   if(E.tipo==='caracol'){caracoles++;const cx=E.x+E.w/2,cz=E.y+E.h/2,xs=u.rooms.flatMap(q=>[q.x,q.x+q.w]),zs=u.rooms.flatMap(q=>[q.y,q.y+q.h]),U={x:Math.min(...xs),y:Math.min(...zs),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...zs)-Math.min(...zs)};
    const lugar=Math.atan2(E.llegada[1]-cz,E.llegada[0]-cx),n=E.peldanos,da=DUPLEX3D.vuelta/n,a0=lugar-da*(n-.5),ml=(DUPLEX3D.radio+DUPLEX3D.poste)/2;
    // (se entra por los 45° libres, desde afuera del hueco; se sube en abanico; se sale derecho por el eje de la llegada)
    const ae=a0-.35;for(let r=1.4;r>=ml;r-=.05)path.push([cx+Math.cos(ae)*r,cz+Math.sin(ae)*r]);
    for(let a=ae;a<=lugar;a+=.05/ml)path.push([cx+Math.cos(a)*ml,cz+Math.sin(a)*ml]);for(let r=ml;r<=1.6;r+=.05)path.push([cx+Math.cos(lugar)*r,cz+Math.sin(lugar)*r]);}
   else{const ax=E.eje==='x',[px,pz]=E.pie,[lx,lz]=E.llegada,sg=ax?Math.sign(lx-px):Math.sign(lz-pz);for(let t=.02;t<=4.5;t+=.05)path.push(ax?[px+sg*t,pz]:[px,pz+sg*t]);}
   for(const [x,z] of path){const g=w.floorAt(x,z,feet);if(g-feet>ESCALON){ok=false;falla('un paso más alto que un escalón',{ciudad:s,lote:L.id,unidad:u.n,tipo:E.tipo,x:+x.toFixed(2),z:+z.toFixed(2),pies:+feet.toFixed(2),piso:+g.toFixed(2)});break;}feet=g;}
   probados++;if(ok&&Math.abs(feet-arriba)<.1)llegan++;else if(ok)falla('la escalera no llega al altillo',{ciudad:s,lote:L.id,unidad:u.n,tipo:E.tipo,pies:+feet.toFixed(2),altillo:arriba});
   // (un punto del altillo lejos del hueco: el centro de su mitad más lejana de la escalera)
   const alt=u.rooms.find(q=>q.type==='altillo');if(alt){const ex=E.x+E.w/2,ez=E.y+E.h/2,qx=alt.w>=alt.h?(ex<alt.x+alt.w/2?alt.x+alt.w*.75:alt.x+alt.w*.25):alt.x+alt.w/2,qz=alt.w>=alt.h?alt.y+alt.h/2:(ez<alt.y+alt.h/2?alt.y+alt.h*.75:alt.y+alt.h*.25);const g=w.floorAt(qx,qz,arriba);if(Math.abs(g-arriba)>.05)falla('el altillo no se pisa a su altura',{ciudad:s,lote:L.id,unidad:u.n,piso:+g.toFixed(2),altillo:arriba});}}}}
console.log(`dúplex en 3D · ${N} ciudades · ${probados} escaleras (${caracoles} de caracol), ${llegan} llegan caminando al altillo · ${Math.round((Date.now()-t0)/1000)} s`);
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size||!probados?1:0);
