// Nivel 10 del probador (2026-10-17, Miguel: «asomarme a una ventana y poder ver a los lados»): asomarse por una ventana
// en el navegador sin ventana. Busca una ventana de un cuarto en el piso 1 de un edificio, se para donde dice el 2D
// (usos.js) y pide la acción; falla si:
//  · cerca de la ventana no ofrece «Asomarse» (y, si tiene cortina, «R» para correrla);
//  · tarda en quedar asomado más de TARDA s, o la cámara no queda en el ojo (a ≤ 1 cm de mirada());
//  · al pedirle girar más que el tope, pasa de VENTANA.giro (1,2 rad, con 0,02 de holgura);
//  · al volver, la acción no termina o el muñeco no se ve.
// Deja dos capturas (de frente y a un lado) en la carpeta.
// Uso: node scripts/validar-asomarse.mjs [semilla=1] [carpeta=/tmp]
import {abrirNavegador} from './navegador.mjs';
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),S=+(A[0]||1),OUT=A[1]||'/tmp',aqui=dirname(fileURLToPath(import.meta.url));
const anda=u=>fetch(u).then(r=>r.ok).catch(()=>false);let base=process.argv.find(a=>a.startsWith('--base='))?.slice(7),propio=null;
if(!base)base=await anda('http://localhost:5180/')?'http://localhost:5180':'';
if(!base){propio=spawn(process.execPath,[join(aqui,'../node_modules/vite/bin/vite.js'),'--port','5199','--strictPort'],{cwd:join(aqui,'..'),stdio:'ignore'});base='http://localhost:5199';for(let i=0;i<60&&!await anda(base+'/');i++)await new Promise(r=>setTimeout(r,500));}
const TARDA=1.5,GIRO=1.2;const fallas=[];const falla=(k,ej)=>fallas.push([k,ej]);
const N=await abrirNavegador();
try{const P=await N.abrir(`${base}/demo?jugadores=3&ciudad=${S}`);
 await P.evaluar(`new Promise(r=>{const t=setInterval(()=>{const d=window.__demo;if(d?.world&&d.planoVista&&d.acciones){clearInterval(t);const st=document.createElement('style');st.textContent='.card{display:none!important}';document.head.appendChild(st);r(1);}},300);})`,{tiempo:240000});
 const cuadro=`()=>new Promise(r=>requestAnimationFrame(r))`;
 const info=await P.evaluar(`(async()=>{const d=window.__demo,p=d.plan,w=d.world,A=d.acciones,cuadro=${cuadro};
  if([...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Caminar'))d.toggleDrone();
  for(const [li,L] of p.lots.entries()){const lv=L.levels?.find(l=>l.level===1);if(!lv)continue;const u=A.usosDe(li,1).find(u=>u.accion==='asomarse'&&!u.des[0].sobre);if(!u)continue;
   const raise=w.lots.get(li)?.raise||0;Object.assign(d.player,{x:u.de.x,z:u.de.z,feet:raise+3+.02,vy:0,ground:true});
   for(let k=0;k<30;k++)await cuadro();
   const c=A.cerca();if(!c||c.u.accion!=='asomarse')continue;
   A.empezar(c);const t0=performance.now();let n=0;while(A.fase!=='quieto'&&n++<400)await cuadro();const ms=performance.now()-t0;
   for(let k=0;k<20;k++)await cuadro();const cam=d.camera.position,m=A.mirada();
   return {lote:li,tipo:L.type,texto:c.texto,cortina:c.cortina?.texto||null,ms:Math.round(ms),ojo:+Math.hypot(cam.x-m.x,cam.z-m.z,cam.y-m.y).toFixed(3)};}
  return null;})()`,{tiempo:120000});
 if(!info){falla('ninguna ventana del piso 1 ofrece asomarse',{semilla:S});}
 else{if(info.texto!=='Asomarse')falla('cerca de la ventana no ofrece asomarse',info);if(info.ms>TARDA*1000)falla('tarda en asomarse',info);if(info.ojo>.01)falla('la cámara no quedó en el ojo',info);}
 if(info){
 writeFileSync(join(OUT,'asomarse-frente.png'),Buffer.from(await P.captura(),'base64'));
 // girar a un lado (más que el límite: tiene que quedar en VENTANA.giro)
 const giro=await P.evaluar(`(async()=>{const d=window.__demo,e=new d.THREE.Euler().setFromQuaternion(d.camera.quaternion,'YXZ'),y0=e.y;e.y+=2;d.camera.quaternion.setFromEuler(e);
  for(let k=0;k<10;k++)await new Promise(r=>requestAnimationFrame(r));const e2=new d.THREE.Euler().setFromQuaternion(d.camera.quaternion,'YXZ');let dy=e2.y-y0;dy=Math.atan2(Math.sin(dy),Math.cos(dy));return +dy.toFixed(3);})()`);
 if(Math.abs(giro)>GIRO+.02)falla('gira más que el tope',{giro});
 writeFileSync(join(OUT,'asomarse-lado.png'),Buffer.from(await P.captura(),'base64'));
 const vuelta=await P.evaluar(`(async()=>{const d=window.__demo;d.acciones.terminar();let n=0;while(d.acciones.activa&&n++<400)await new Promise(r=>requestAnimationFrame(r));for(let k=0;k<5;k++)await new Promise(r=>requestAnimationFrame(r));return {activa:d.acciones.activa,visible:d.avatar?.holder.visible};})()`);
 if(vuelta.activa||!vuelta.visible)falla('al volver no termina o no se ve el muñeco',vuelta);
 const err=(typeof P.errores==='function'?P.errores():P.errores)||[];for(const e of err.slice(0,3))falla('error en la página',{e:String(e).slice(0,200)});
 console.log(`asomarse · semilla ${S} · ${info.tipo}: «${info.texto}»${info.cortina?' · R «'+info.cortina+'»':''} · asomado en ${info.ms} ms · ojo a ${Math.round(info.ojo*1000)} mm · giro tope ${giro} rad · capturas en ${OUT}`);}
 console.log(`fallas: ${fallas.length}`);for(const [k,e] of fallas)console.log(`  1\t${k}\n        ${JSON.stringify(e)}`);}
catch(err){console.log('el validador se cortó: '+String(err?.message||err).slice(0,200));console.log('fallas: 1');process.exit(0);}// (sin esto, un error se iba en silencio)
finally{await N.cerrar?.();if(propio)propio.kill();process.exit(0);}
