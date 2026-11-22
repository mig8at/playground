// Los dúplex en 3D se suben caminando (2026-11-22, Miguel: «sigue con el 3D del dúplex»). Sin pantalla, con el mundo 3D
// armado como el juego (sin-pantalla.mjs): en cada dúplex —engine/duplex.js— se camina con floorAt, de a 5 cm, desde el
// último piso por su escalera privada, recta, de punta a punta, y al final se sale del hueco hacia lo abierto de arriba. Falla si en algún paso hay que subir más de un escalón (45 cm), si al final los
// pies no quedan en el piso de la mansarda, o si lo abierto de arriba, lejos del hueco, no se pisa a esa altura.
// Uso: node harness/pruebas/validar-duplex-3d.mjs [ciudades=2] [semilla0=1]
import {armarMundo} from './sin-pantalla.mjs';
import {alturaMansarda} from '../../src/engine/techos.js';
const N=+(process.argv[2]||2),S0=+(process.argv[3]||1),FLOOR=3,ESCALON=.46;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
let probados=0,llegan=0,cortas=0,vacios=0,cajas=0,ventanas=0;const t0=Date.now();
for(let s=S0;s<S0+N;s++){const {world:w,bp}=await armarMundo(s,3);
 // (ninguna caja de baranda asoma por el tejado: en cada esquina de arriba, por debajo de la mansarda —Miguel: «evita que
 // las barandas salgan al tejado»—)
 for(const [id,dx] of w.duplexes||[]){const L=bp.lots.find(l=>l.id===id);for(const c of dx.cajasBaranda){cajas++;const top=c.y+c.sy;
  for(const [x,z] of [[c.x-c.sx/2,c.z-c.sz/2],[c.x+c.sx/2,c.z-c.sz/2],[c.x-c.sx/2,c.z+c.sz/2],[c.x+c.sx/2,c.z+c.sz/2]]){const techo=L.floors*FLOOR+(L.mansarda?alturaMansarda(L.mansarda,x,z):3);if(top>techo+.01){falla('una baranda asoma por el tejado',{ciudad:s,lote:id,x:+x.toFixed(2),z:+z.toFixed(2),arriba:+(top-techo).toFixed(2)});break;}}}}
 // (las buhardillas del 3D y las ventanas de arriba del plano, una a una: Miguel, «que las buhardillas coincidan con las
 // ventanas del altillo». Cada ventana de un dúplex con su buhardilla en el mismo módulo, y ninguna buhardilla de más sobre un dúplex)
 {const buh=w.mansardaArmada||[];
  for(const L of bp.lots){if(!L.duplex)continue;for(const u of L.duplex.unidades){const xs=u.rooms.flatMap(q=>[q.x,q.x+q.w]),zs=u.rooms.flatMap(q=>[q.y,q.y+q.h]),dentro=a=>a.mx>Math.min(...xs)-.05&&a.mx<Math.max(...xs)+.05&&a.mz>Math.min(...zs)-.05&&a.mz<Math.max(...zs)+.05;
   for(const v of u.windows){ventanas++;const c=[(v.x0+v.x1)/2,(v.y0+v.y1)/2];if(!buh.some(a=>a.lote===L.id&&a.tipo==='buhardilla'&&Math.hypot(a.mx-c[0],a.mz-c[1])<.6))falla('una ventana de arriba sin su buhardilla',{ciudad:s,lote:L.id,unidad:u.n,x:c[0],z:c[1]});}
   for(const a of buh)if(a.lote===L.id&&a.tipo==='buhardilla'&&dentro(a)&&!u.windows.some(v=>Math.hypot((v.x0+v.x1)/2-a.mx,(v.y0+v.y1)/2-a.mz)<.6))falla('una buhardilla sin ventana en el plano',{ciudad:s,lote:L.id,unidad:u.n,x:a.mx,z:a.mz});}}}
 for(const L of bp.lots){if(!L.duplex)continue;const R=w.lots.get(L.id)?.raise||0,arriba=L.floors*FLOOR+R;
  for(const u of L.duplex.unidades){const E=u.escalera,path=[];if(E.peldanos<15)cortas++;let feet=(L.floors-1)*FLOOR+R+.02,ok=true;
   {const ax=E.eje==='x',[px,pz]=E.pie,[lx,lz]=E.llegada,sg=ax?Math.sign(lx-px):Math.sign(lz-pz);const lg=ax?E.w:E.h;for(let t=.02;t<=lg+.6;t+=.05)path.push(ax?[px+sg*t,pz]:[px,pz+sg*t]);}
   for(const [x,z] of path){const g=w.floorAt(x,z,feet);if(g-feet>ESCALON){ok=false;falla('un paso más alto que un escalón',{ciudad:s,lote:L.id,unidad:u.n,tipo:E.tipo,x:+x.toFixed(2),z:+z.toFixed(2),pies:+feet.toFixed(2),piso:+g.toFixed(2)});break;}feet=g;}
   probados++;if(ok&&Math.abs(feet-arriba)<.1)llegan++;else if(ok)falla('la escalera no llega arriba',{ciudad:s,lote:L.id,unidad:u.n,tipo:E.tipo,pies:+feet.toFixed(2),altillo:arriba});
   // (arriba se pisa en la llegada —medio metro después de la punta de la escalera—; sobre el vacío de la sala a doble
   // altura no: se cae al piso de abajo —o al mesón de la cocina, si la doble altura queda sobre ella—)
   {const d=E.eje==='x'?[Math.sign(E.llegada[0]-E.pie[0]),0]:[0,Math.sign(E.llegada[1]-E.pie[1])],g=w.floorAt(E.llegada[0]+d[0]*.5,E.llegada[1]+d[1]*.5,arriba);if(Math.abs(g-arriba)>.05)falla('lo abierto de arriba no se pisa a su altura',{ciudad:s,lote:L.id,unidad:u.n,piso:+g.toFixed(2),arriba});
    for(const v of u.vacios||[]){let px=v.x+v.w/2,pz=v.y+v.h/2;for(let i=0;i<40&&px>E.x&&px<E.x+E.w&&pz>E.y&&pz<E.y+E.h;i++){px=v.x+.5+(i%Math.max(1,v.w-1));pz=v.y+.5+Math.floor(i/Math.max(1,v.w-1));}// (un punto del vacío fuera de la escalera)
     const g2=w.floorAt(px,pz,arriba),abajo=(L.floors-1)*FLOOR+R;if(g2>abajo+1.2||g2<abajo-.05)falla('sobre el vacío de la doble altura hay piso',{ciudad:s,lote:L.id,unidad:u.n,piso:+g2.toFixed(2),abajo});else vacios++;}}}}}
console.log(`dúplex en 3D · ${N} ciudades · ${probados} escaleras (${cortas} de 3 m), ${llegan} llegan caminando arriba, ${vacios} salas a doble altura sin piso arriba, ${cajas} cajas de baranda bajo el tejado, ${ventanas} ventanas de arriba con su buhardilla · ${Math.round((Date.now()-t0)/1000)} s`);
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size||!probados?1:0);
