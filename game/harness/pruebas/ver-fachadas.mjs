// Fotos de fachadas (2026-10-18, Miguel: «validá fachadas de casas y edificios»): en una ciudad, un edificio de cada
// combinación distinta (tipo, familia, techo, toldos; hasta MAX) y casas (del monte y de la ciudad), cada uno con tres
// fotos a mediodía —de frente desde la vereda de enfrente, en diagonal desde la esquina y desde arriba—, para revisarlas a
// ojo y anotar lo que falla. Guarda <carpeta>/<ciudad>-<lote>-<vista>.png y un índice (indice.json).
// Uso: node scripts/ver-fachadas.mjs [ciudad=1] [carpeta=/tmp/fachadas] [max=14]
import {abrirNavegador} from './navegador.mjs';
import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {generateBlueprint} from '../src/engine/blueprint.js';
import {viviendasDe} from '../src/engine/viviendas.js';
const [ciudad=1,OUT='/tmp/fachadas',MAX=14]=process.argv.slice(2);mkdirSync(OUT,{recursive:true});
const bp=generateBlueprint({seed:+ciudad,team:3}),vistas=[];
// edificios: uno por combinación, de los más altos primero (se ven más cosas)
const vistos=new Set();
// (la cámara nunca adentro de un lote: se acerca hasta quedar en la calle —en una calle angosta, 14 m caen en el de enfrente—)
const enLote=(x,z)=>bp.lots.some(L=>L.rect&&x>L.rect.x-.5&&x<L.rect.x+L.rect.w+.5&&z>L.rect.y-.5&&z<L.rect.y+L.rect.h+.5);
const enCalle=(fx,fz,nx,nz,d,lx=0,lz=0)=>{for(let k=d;k>2;k-=1){const x=fx+nx*k+lx,z=fz+nz*k+lz;if(!enLote(x,z))return {x,z};}return {x:fx+nx*3+lx,z:fz+nz*3+lz};};
for(const [li,L] of [...bp.lots.entries()].sort((a,b)=>(b[1].floors||0)-(a[1].floors||0))){if(!L.rect||!L.fachada)continue;const f=L.fachada,k=`${L.type}|${f.familia}|${f.techo}|${f.toldos}`;if(vistos.has(k))continue;vistos.add(k);
 const r=L.rect,n={N:[0,-1],S:[0,1],W:[-1,0],E:[1,0]}[L.front]||[0,-1],cx=r.x+r.w/2,cz=r.y+r.h/2,fx=n[0]?(n[0]<0?r.x:r.x+r.w):cx,fz=n[1]?(n[1]<0?r.y:r.y+r.h):cz,alto=(L.floors||1)*3,ancho=n[0]?r.h:r.w;
 const lado=n[0]?[0,1]:[1,0],mira={x:fx,z:fz,y:alto*.45};
 vistas.push({id:`L${li}`,que:`${L.type} · ${L.name||''} · ${f.familia} · techo ${f.techo} · toldos ${f.toldos} · ${L.floors} pisos`,fotos:[
  {v:'frente',...enCalle(fx,fz,n[0],n[1],Math.max(14,ancho*.9)),y:1.7,mira},
  {v:'esquina',...enCalle(fx,fz,n[0],n[1],14,lado[0]*(ancho/2+8),lado[1]*(ancho/2+8)),y:1.7,mira},
  {v:'arriba',x:fx+n[0]*22,z:fz+n[1]*22,y:alto+12,mira:{x:cx,z:cz,y:alto}}]});
 if(vistas.length>=+MAX)break;}
// casas: del monte (las que tienen plano) y de la ciudad, desde afuera de su puerta
const vs=viviendasDe(bp).sort((a,b)=>(a.tipo==="casa"?0:1)-(b.tipo==="casa"?0:1));let nc=0;
for(const v of vs){if(v.tipo==='apto'||!v.puertas.length)continue;if(v.tipo==='casa'&&nc>=6)continue;if(v.tipo!=='casa'&&nc>=9)continue;const p=v.puertas[0],m=p.mira;
 const atras={x:p.x-m.x*11,z:p.z-m.z*11},lado={x:-m.z,z:m.x};nc++;
 vistas.push({id:v.id,que:`${v.tipo==='casa'?'casa del monte':'casa de la ciudad'} ${v.direccion||''}`,casa:true,fotos:[
  {v:'frente',x:atras.x,z:atras.z,y:1.7,mira:{x:p.x+m.x*2,z:p.z+m.z*2,y:2.2},suelo:true},
  {v:'esquina',x:atras.x+lado.x*8,z:atras.z+lado.z*8,y:1.7,mira:{x:p.x+m.x*3,z:p.z+m.z*3,y:2.5},suelo:true},
  {v:'arriba',x:p.x-m.x*16,z:p.z-m.z*16,y:14,mira:{x:p.x+m.x*4,z:p.z+m.z*4,y:2},suelo:true}]});
 if(nc>=9)break;}
const N=await abrirNavegador();const indice=[];
try{const P=await N.abrir(`http://localhost:5180/demo?jugadores=3&ciudad=${ciudad}`);
 await P.evaluar(`new Promise(r=>{const t=setInterval(()=>{const d=window.__demo;if(d?.world&&d.soc&&d.avatar&&d.ronda){clearInterval(t);const st=document.createElement('style');st.textContent='.card,.hud,.mini,.accion,.quien,.r-msg,.ronda{display:none!important}';document.head.appendChild(st);d.fijarHora(2,12);r(1);}},300);})`,{tiempo:240000});
 // (el dron: la cámara libre; el muñeco no se ve)
 await P.evaluar(`(async()=>{const d=window.__demo;if(![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Caminar'))d.toggleDrone();for(let k=0;k<10;k++)await new Promise(r=>requestAnimationFrame(r));})()`);
 for(const V of vistas)for(const F of V.fotos){
  await P.evaluar(`(async()=>{const d=window.__demo,F=${JSON.stringify(F)};let y=F.y;if(F.suelo){const s=d.world.size;const g=F.x>=0&&F.z>=0&&F.x<=s.w&&F.z<=s.h?d.world.groundAt(F.x,F.z):d.island.ground(F.x,F.z);y=g+F.y;F.mira.y+=g;}
   const yaw=Math.atan2(-(F.mira.x-F.x),-(F.mira.z-F.z)),pitch=Math.atan2(F.mira.y-y,Math.hypot(F.mira.x-F.x,F.mira.z-F.z));
   for(let k=0;k<45;k++){d.fijarDron(F.x,y,F.z);d.euler.set(pitch,yaw,0,'YXZ');d.camera.quaternion.setFromEuler(d.euler);await new Promise(r=>requestAnimationFrame(r));}})()`,{tiempo:60000});
  const nombre=`${ciudad}-${V.id.replace(/[:#]/g,'_')}-${F.v}.png`;writeFileSync(join(OUT,nombre),Buffer.from(await P.captura(),'base64'));indice.push({archivo:nombre,id:V.id,que:V.que,vista:F.v});}
 const e=(typeof P.errores==='function'?P.errores():P.errores)||[];if(e.length)console.log('errores:',e.slice(0,3));}
finally{writeFileSync(join(OUT,'indice.json'),JSON.stringify(indice,null,1));console.log(`fachadas · ciudad ${ciudad} · ${vistas.length} edificios y casas, ${indice.length} fotos en ${OUT}`);await N.cerrar();process.exit(0);}
