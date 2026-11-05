// Nivel 10 del probador (2026-10-16): el 3D de verdad, en un navegador sin ventana (navegador.mjs: Chrome for Testing, con
// la placa de video de la máquina). Lo que sólo sabe la placa: cuánto cuesta cada cuadro y qué sale en pantalla. En
// lugares fijos de la ciudad —los dice el plano de la semilla: la salida del jugador, el dron sobre el centro, una
// esquina del monte, adentro de un edificio, la playa—, y en cada uno:
//  · lo que dibuja un cuadro, en promedio (triángulos y llamadas, de renderer.info), contra su presupuesto (scripts/referencias/3d.json:
//    lo medido al fijarlo, más PRESUPUESTO): si sube de golpe, algo se dibuja de más;
//  · los cuadros por segundo (sólo se informan: dependen de la máquina);
//  · la captura: no puede salir vacía (un solo color en casi toda la pantalla) y se compara con la de referencia
//    (scripts/referencias/<lugar>.png): la fracción de píxeles que cambian. La gente, los autos y el agua se mueven, así
//    que un cambio chico es normal; uno grande, se avisa;
//  · ningún error de consola ni excepción en toda la corrida.
// Con --fijar (o si no hay referencias) guarda las capturas y el presupuesto actuales.
// Uso: node scripts/validar-3d.mjs [semilla=1] [--fijar] [--base=http://localhost:5180]
import {abrirNavegador} from './navegador.mjs';
import {spawn} from 'node:child_process';import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';import {dirname,join} from 'node:path';

const A=process.argv.slice(2),S=+(A.find(a=>!a.startsWith('--'))||1),FIJAR=A.includes('--fijar'),PRESUPUESTO=1.2,CAMBIO=.25;
const aqui=dirname(fileURLToPath(import.meta.url)),REF=join(aqui,'referencias'),PRES=join(REF,'3d.json');mkdirSync(REF,{recursive:true});
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
// el servidor: el que diga --base, el de desarrollo si está andando, o uno propio en 5199 (que se apaga al final)
let base=(A.find(a=>a.startsWith('--base='))||'').slice(7),propio=null;
const anda=async u=>{try{return (await fetch(u,{signal:AbortSignal.timeout(1500)})).ok;}catch{return false;}};
if(!base)base=await anda('http://localhost:5180/')?'http://localhost:5180':'';
if(!base){propio=spawn(process.execPath,[join(aqui,'../node_modules/vite/bin/vite.js'),'--port','5199','--strictPort'],{cwd:join(aqui,'..'),stdio:'ignore'});base='http://localhost:5199';
 for(let k=0;k<100&&!(await anda(base+'/'));k++)await new Promise(r=>setTimeout(r,200));}
const N=await abrirNavegador(),P=await N.abrir(`${base}/demo?jugadores=3&ciudad=${S}`);
const listo=await P.evaluar(`new Promise(r=>{const t0=Date.now(),t=setInterval(()=>{const d=window.__demo;if(d?.world&&d.planoVista&&d.acciones&&d.soc){clearInterval(t);/* (de día: la ronda empieza a cualquier hora y la noche cambia toda la imagen; las referencias son a mediodía) */d.fijarHora(2,12);const st=document.createElement('style');st.textContent='.card{display:none!important}';document.head.appendChild(st);r(Date.now()-t0);}},300);})`,{tiempo:240000});
// los lugares: posición y mirada, sacadas del plano (determinista por semilla)
const lugares=await P.evaluar(`(()=>{const d=window.__demo,p=d.plan,w=d.world,sz=w.size,I=p.isla;
 const lote=I.cells.find(c=>c.lote&&c.manzana&&c.manzana!=='mirador'),L=p.lots.find(l=>l.levels.length>=3),r0=L.levels[0].rooms.slice().sort((a,b)=>b.w*b.h-a.w*a.h)[0];
 const playa=I.cells.find(c=>c.zona==='playa'&&!c.lote&&!c.carretera);
 return [{n:'salida',modo:'pie',x:w.spawn.x,z:w.spawn.z,yaw:0,pitch:-.15},
  {n:'dron',modo:'dron',x:sz.w/2,z:sz.h/2+60,y:80,yaw:0,pitch:-.7},
  {n:'monte',modo:'pie',x:(lote.x+.5)*6,z:(lote.y+.5)*6,yaw:Math.atan2((lote.x+.5)*6-sz.w/2,(lote.y+.5)*6-sz.h/2),pitch:-.2},
  {n:'adentro',modo:'pie',x:r0.x+r0.w/2,z:r0.y+r0.h/2,yaw:Math.PI/4,pitch:-.1,feet:(w.lots.get(p.lots.indexOf(L))?.raise||0)+.02},
  {n:'azotea',modo:'pie',x:L.parts[0].x+L.parts[0].w/2,z:L.parts[0].y+L.parts[0].h/2,yaw:Math.PI/3,pitch:-.25,feet:w.floorAt(L.parts[0].x+L.parts[0].w/2,L.parts[0].y+L.parts[0].h/2,999)-.0001,afuera:true},
  {n:'playa',modo:'pie',x:(playa.x+.5)*6,z:(playa.y+.5)*6,yaw:Math.atan2(sz.w/2-(playa.x+.5)*6,sz.h/2-(playa.y+.5)*6)+Math.PI,pitch:-.1}];})()`);
const pres=existsSync(PRES)?JSON.parse(readFileSync(PRES,'utf8')):{},nuevo={},med=[];
for(const L of lugares){
 // ponerse en el lugar, dejar que se acomode (cámara, lo visible, el aclarado) y medir 60 cuadros
 const m=await P.evaluar(`(async()=>{const d=window.__demo,L=${JSON.stringify(L)},esDron=[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Caminar');
  if((L.modo==='dron')!==esDron)d.toggleDrone();
  if(L.modo==='dron')d.fijarDron(L.x,L.y,L.z);else{const f=L.feet??d.world.floorAt?.(L.x,L.z,0)??0;Object.assign(d.player,{x:L.x,z:L.z,feet:L.modo==='pie'&&L.x>=0&&L.z>=0&&L.x<=d.world.size.w&&L.z<=d.world.size.h?f:d.island.ground(L.x,L.z,60),vy:0,ground:true});}
  d.euler.set(L.pitch,L.yaw,0,'YXZ');d.camera.quaternion.setFromEuler(d.euler);
  const cuadro=()=>new Promise(r=>requestAnimationFrame(r));// (200 cuadros para acomodarse: la cámara de atrás alarga y acorta su distancia de a poco —CAM_ALARGA— y trae la del lugar
  // anterior; con 40, el lugar «adentro» medía 4 o 6 millones según de dónde venía)
  for(let k=0;k<200;k++){if(L.modo==="dron")d.fijarDron(L.x,L.y,L.z);d.euler.set(L.pitch,L.yaw,0,'YXZ');d.camera.quaternion.setFromEuler(d.euler);await cuadro();}
  const R=d.renderer;R.info.autoReset=false;const hs=[];let t0=performance.now();
  for(let k=0;k<61;k++){R.info.reset();await cuadro();if(k)hs.push({tri:R.info.render.triangles,calls:R.info.render.calls});}
  const ms=(performance.now()-t0)/61;R.info.autoReset=true;const md=a=>a.sort((x,y)=>x-y)[a.length>>1];
  // (el promedio por cuadro: las sombras se rehacen un cuadro de cada dos —DemoView shadowTick— y cómo se reparte el costo
  // entre esos dos cuadros cambia de una carga a otra —4,0 + 4,4 o 2,2 + 6,2 millones—; la suma de los dos, no: 8,4)
  const prom=k=>Math.round(hs.reduce((a,h)=>a+h[k],0)/hs.length);
  return {tri:prom('tri'),calls:prom('calls'),fps:+(1000/ms).toFixed(1),geom:R.info.memory.geometries,tex:R.info.memory.textures,partes:(()=>{const out={};const cuenta=(o)=>{let n=0,t=0;o.traverseVisible(m=>{if(m.isMesh&&m.geometry){n++;const g=m.geometry,c=(g.index?g.index.count:g.attributes.position?.count||0)/3;t+=c*(m.isInstancedMesh?m.count:1);}});return [n,Math.round(t/1e3)];};d.world.group.children.forEach((c,i)=>{const r=cuenta(c);if(r[1]>50)out[(c.name||c.type)+i]=r;});return out;})(),gente:(()=>{let n=0,t=0;d.scene.traverseVisible(o=>{if(o.isSkinnedMesh){n++;const g=o.geometry;t+=(g.index?g.index.count:g.attributes.position.count)/3;}});return n+' mallas de gente, '+Math.round(t/1e3)+' mil tri';})(),acl:d.acl?.length??null,cam:d.camera.position.toArray().map(v=>+v.toFixed(2)),vis:d.visKey,pies:[+d.player.x.toFixed(2),+d.player.feet.toFixed(2),+d.player.z.toFixed(2)]};})()`,{tiempo:120000});
 const png=await P.captura(),ruta=join(REF,`${L.n}.png`),hay=existsSync(ruta);
 // en la página: qué fracción de la captura es de un solo color y cuánto cambió contra la referencia
 const cmp=await P.evaluar(`(async()=>{const carga=src=>new Promise((ok,mal)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=mal;i.src=src;});
  const px=async src=>{const i=await carga(src),c=document.createElement('canvas');c.width=i.width;c.height=i.height;const g=c.getContext('2d');g.drawImage(i,0,0);return g.getImageData(0,0,c.width,c.height).data;};
  const a=await px('data:image/png;base64,${png}'),cuenta=new Map();for(let i=0;i<a.length;i+=16){const k=(a[i]>>4)+','+(a[i+1]>>4)+','+(a[i+2]>>4);cuenta.set(k,(cuenta.get(k)||0)+1);}
  const unColor=Math.max(...cuenta.values())/(a.length/16);let cambio=null;
  ${hay&&!FIJAR?`const b=await px('data:image/png;base64,${readFileSync(ruta).toString('base64')}');if(b.length===a.length){let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>60)n++;cambio=n/(a.length/4);}`:''}
  return {unColor,cambio};})()`);
 if(FIJAR||!hay)writeFileSync(ruta,Buffer.from(png,'base64'));
 nuevo[L.n]={tri:m.tri,calls:m.calls};const tope=pres[L.n];
 const ej={lugar:L.n,triangulos:m.tri,llamadas:m.calls};
 // (2026-10-16, Miguel: «subí a la terraza y desaparecieron los edificios»: en la azotea se está afuera)
 if(L.afuera&&m.vis!=='afuera')falla('en la azotea el juego cree que se está adentro (apaga lo que no se ve desde adentro)',{...ej,vis:m.vis});
 if(cmp.unColor>.95)falla('captura vacía (un solo color en casi toda la pantalla)',{...ej,unColor:+cmp.unColor.toFixed(2)});
 if(tope&&!FIJAR){if(m.tri>tope.tri*PRESUPUESTO)falla('dibuja más triángulos que su presupuesto',{...ej,presupuesto:Math.round(tope.tri*PRESUPUESTO)});if(m.calls>tope.calls*PRESUPUESTO)falla('hace más llamadas de dibujo que su presupuesto',{...ej,presupuesto:Math.round(tope.calls*PRESUPUESTO)});}
 if(cmp.cambio!=null&&cmp.cambio>CAMBIO){const otra=join(REF,`${L.n}.actual.png`);writeFileSync(otra,Buffer.from(png,'base64'));falla('la captura cambió mucho contra la de referencia',{...ej,cambio:+(cmp.cambio*100).toFixed(1)+' %',actual:otra.split('/').slice(-2).join('/')});}
 med.push({...L,...m,...cmp});}
if(FIJAR||!existsSync(PRES))writeFileSync(PRES,JSON.stringify({semilla:S,fijado:new Date().toISOString().slice(0,10),...nuevo},null,1));
for(const e of [...new Set(P.errores)])falla('error en la consola del navegador',{error:e.slice(0,200)});
await N.cerrar();if(propio)propio.kill();
console.log(`3d · semilla ${S} · cargó en ${(listo/1000).toFixed(1)} s · ${med.map(m=>`${m.n}${process.env.VER3D?` [${m.vis} cámara ${m.cam} · ${m.gente} · aclaradas ${m.acl}]`:''}: ${(m.tri/1e3).toFixed(0)} mil triángulos, ${m.calls} llamadas, ${m.fps} cuadros/s${m.cambio!=null?`, cambió ${(m.cambio*100).toFixed(1)} %`:''}`).join(' · ')}${FIJAR?' · (referencias fijadas)':''}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
process.exit(0);
