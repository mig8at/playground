// Valida lo que se ve desde la CALLE (2026-11-23, engine/visibles.js visiblesCalle: el occlusion culling de afuera) con rayos
// independientes de los de la regla: desde puntos al azar de la calle (a la altura de los ojos o de la cámara de tercera
// persona), con un giro al azar, rayos al azar dentro de lo que abarca la cámara MÁS el margen a los costados, a pasos de
// 25 cm. El primer edificio que tapa el rayo (sus pisos por 3 m) es un lote que se ve: TIENE que estar en la lista. Con
// puertas y ventanas herméticas, lo de detrás de la primera fachada no se ve; mide cuánto se deja de dibujar.
// Uso: node harness/pruebas/validar-calle.mjs [ciudades=2] [semilla0=1] [puntos=200] [rayos por punto=300]
import {generateBlueprint,CELL} from '../../src/engine/blueprint.js';
import {visiblesCalle,visibilidadFuera,alturasDe,VISIBLES_CALLE,VISIBLES} from '../../src/engine/visibles.js';
import {rng} from '../../src/engine/veredas.js';

const N=+(process.argv[2]||2),S0=+(process.argv[3]||1),P=+(process.argv[4]||200),R=+(process.argv[5]||300),PASO=.25,FOV=72,ASPECTO=16/9,ALCANCE=270;// (ALCANCE: la niebla a pie, 240 m, más 30 —como el juego—)
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const med={fuera:0,fueraTapados:0,afuera:0,puntos:0,rayos:0,pegan:0,lista:[],ms:[],total:0};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),A=alturasDe(bp),r=rng(s*131),{W,H,lote,alto}=A;
 // (uno de cada cuatro puntos, AFUERA de la grilla —hasta 80 m: el monte, la playa—, mirando hacia cualquier lado)
 for(let p=0;p<P;){const fuera=r()<.25,x=fuera?-80+r()*(W*CELL+160):r()*W*CELL,z=fuera?-80+r()*(H*CELL+160):r()*H*CELL,cx=Math.floor(x/CELL),cz=Math.floor(z/CELL);
  const dentro=cx>=0&&cz>=0&&cx<W&&cz<H;if(fuera&&dentro||dentro&&lote[cz*W+cx]>=0)continue;p++;med.puntos++;if(!dentro)med.afuera++;
  const cam={x,y:r()<.5?1.65:2.6,z,yaw:r()*Math.PI*2,fov:FOV,aspect:ASPECTO};
  const t0=performance.now(),V=visiblesCalle(bp,cam);med.ms.push(performance.now()-t0);med.lista.push(V.lotes.size/bp.lots.length);
  const hf=Math.atan(Math.tan(FOV*Math.PI/360)*ASPECTO)+VISIBLES_CALLE.margen*Math.PI/180,vf=FOV*Math.PI/360,fx=-Math.sin(cam.yaw),fz=-Math.cos(cam.yaw),base=Math.atan2(fz,fx);
  for(let k=0;k<R;k++){const az=base+(2*r()-1)*hf,el=(2*r()-1)*vf,c=Math.cos(el),dx=Math.cos(az)*c,dy=Math.sin(el),dz=Math.sin(az)*c;med.rayos++;
   let px=x,py=cam.y,pz=z,entro=false;
   for(let t=0;t<VISIBLES.alcance;t+=PASO){const nx=px+dx*PASO,ny=py+dy*PASO,nz=pz+dz*PASO,ix=Math.floor(nx/CELL),iz=Math.floor(nz/CELL);const sale=ix<0||iz<0||ix>=W||iz>=H;if(sale&&entro||ny>VISIBLES.techo)break;if(sale){px=nx;py=ny;pz=nz;continue;}entro=true;
    // (la esquina que cruza el paso cuando cambia de casilla en los dos ejes, como validar-visibles)
    {const ax=Math.floor(px/CELL),az2=Math.floor(pz/CELL);if(ax!==ix&&az2!==iz){const lx=(dx>0?ix:ax)*CELL,lz=(dz>0?iz:az2)*CELL,tx=(lx-px)/dx,tz=(lz-pz)/dz,[mx,mz]=tx<tz?[ix,az2]:[ax,iz],mi=mz*W+mx,ml=mx>=0&&mz>=0&&mx<W&&mz<H?lote[mi]:-1;
     if(ml>=0&&Math.min(py,ny)<alto[mi]){med.pegan++;if(!V.lotes.has(ml))falla('un lote que se ve desde la calle falta en la lista (no se dibujaría)',{semilla:s,cam:[+x.toFixed(1),cam.y,+z.toFixed(1),+cam.yaw.toFixed(3)],lote:ml,a:+t.toFixed(1)});break;}}}
    const i=iz*W+ix,l=lote[i];if(l>=0&&ny<alto[i]){med.pegan++;if(!V.lotes.has(l))falla('un lote que se ve desde la calle falta en la lista (no se dibujaría)',{semilla:s,cam:[+x.toFixed(1),cam.y,+z.toFixed(1),+cam.yaw.toFixed(3)],lote:l,a:+t.toFixed(1)});break;}
    px=nx;py=ny;pz=nz;}}
  // LO DE AFUERA (visibilidadFuera: las plantas de la isla, las casas del monte): puntos al azar fuera de la grilla, a menos de
  // 200 m de ella y entre 0 y 10 m de alto, en lo que abarca la cámara más el margen y antes de la niebla; si el rayo de la
  // cámara al punto llega sin pegar en un edificio, un objeto que llega hasta 0 a 8 m más arriba TIENE que darse por visible.
  const deFuera=visibilidadFuera(bp,cam,VISIBLES_CALLE.margen,ALCANCE);
  for(let k=0;k<R/3;k++){const qx=-200+r()*(W*CELL+400),qz=-200+r()*(H*CELL+400),qy=r()*10;if(qx>=0&&qz>=0&&qx<W*CELL&&qz<H*CELL)continue;
   const ex=qx-x,ey=qy-cam.y,ez=qz-z,d=Math.hypot(ex,ey,ez),dh=Math.hypot(ex,ez);if(dh>ALCANCE||dh<1)continue;
   const da=Math.abs(Math.atan2(Math.sin(Math.atan2(ez,ex)-base),Math.cos(Math.atan2(ez,ex)-base)));if(da>hf)continue;med.fuera++;
   let tapa=-1;for(let t=PASO;t<d;t+=PASO){const nx=x+ex/d*t,ny=cam.y+ey/d*t,nz=z+ez/d*t,ix=Math.floor(nx/CELL),iz=Math.floor(nz/CELL);if(ix<0||iz<0||ix>=W||iz>=H)continue;const i=iz*W+ix;if(lote[i]>=0&&ny<alto[i]){tapa=lote[i];break;}}
   if(tapa>=0){med.fueraTapados++;continue;}const top=qy+r()*8;if(!deFuera(qx,qz,top))falla('algo de afuera que se ve desde la calle se da por tapado (no se dibujaría)',{semilla:s,cam:[+x.toFixed(1),cam.y,+z.toFixed(1),+cam.yaw.toFixed(3)],punto:[+qx.toFixed(1),+qy.toFixed(1),+qz.toFixed(1)],alto:+top.toFixed(1)});}}
 med.total+=bp.lots.length;}
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.floor(p*(b.length-1))];};
console.log(`calle · ${N} ciudad(es) · ${med.puntos} puntos de calle (${med.afuera} fuera de la grilla), ${med.rayos} rayos en lo que abarca la cámara más ${VISIBLES_CALLE.margen}° a cada lado, ${med.pegan} dan contra un edificio · la lista: mediana ${(100*q(med.lista,.5)).toFixed(0)} % de los lotes (p90 ${(100*q(med.lista,.9)).toFixed(0)} %) · cálculo: mediana ${q(med.ms,.5).toFixed(2)} ms, p90 ${q(med.ms,.9).toFixed(2)} ms`);
console.log(`afuera · ${med.fuera} puntos fuera de la grilla en lo que abarca la cámara, ${med.fueraTapados} tapados por la ciudad`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
