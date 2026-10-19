// Nivel 10 del probador: las patrullas (2026-10-17, REGLAS.md paso 4), sin pantalla, apretando las teclas como el jugador:
// · de policía: frente a la comisaría están PATRULLA.cuantas(equipo), cada una sin chocar con nada;
// · junto a una, «Subir a la patrulla»; con E, adentro (el muñeco no se ve, el velocímetro sí);
// · con W avanza (más de 15 m en 3 s, sin quedar adentro de ningún edificio) y con D gira (cambia el rumbo);
// · contra un edificio se frena: no se mete;
// · con E se baja al lado y la patrulla queda estacionada donde se dejó; se puede volver a subir;
// · de ladrón: las patrullas están, pero no se ofrece subir.
// Captura manejando y estacionada.
// Uso: node scripts/validar-patrulla.mjs [ciudad=1] [carpeta=/tmp] (con el servidor en 5180)
import {abrirNavegador} from './navegador.mjs';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {PATRULLA} from '../src/engine/medidas.js';
const [ciudad=1,OUT='/tmp']=process.argv.slice(2);const base='http://localhost:5180';
const N=await abrirNavegador();const fallas=[];
const espera=`new Promise(r=>{const t=setInterval(()=>{const d=window.__demo;if(d?.world&&d.patrullas&&d.avatar&&(d.persec?.listo||d.ronda)){clearInterval(t);const st=document.createElement('style');st.textContent='.card{display:none!important}';document.head.appendChild(st);d.fijarHora?.(2,12);r(1);}},300);})`;
try{const P=await N.abrir(`${base}/demo?papel=policia&jugadores=3&ciudad=${ciudad}`);await P.evaluar(espera,{tiempo:240000});
 const captura=async n=>writeFileSync(join(OUT,n),Buffer.from(await P.captura(),'base64'));
 const tecla=(c,t)=>P.evaluar(`window.dispatchEvent(new KeyboardEvent('${t}',{code:'${c}'}))`);
 const cuadros=n=>P.evaluar(`(async()=>{for(let k=0;k<${n};k++)await new Promise(r=>requestAnimationFrame(r));})()`);
 const estado=()=>P.evaluar(`(()=>{const d=window.__demo,c=d.patrullas.manejando,w=d.world;return {manejando:!!c,x:c?.x,z:c?.z,yaw:c?.yaw,v:c?.v,adentro:c?!!w.dentro(c.x,c.z,c.y+1):null,vel:d.velocidad,avatar:d.avatar?.holder.visible,accion:document.querySelector('.accion')?.innerText||'',player:{x:d.player.x,z:d.player.z}}})()`);
 const n=await P.evaluar(`window.__demo.patrullas.cars.length`);console.log('patrullas:',n,'de',PATRULLA.cuantas(3));if(n!==PATRULLA.cuantas(3))fallas.push(`frente a la comisaría hay ${n} patrullas (la regla dice ${PATRULLA.cuantas(3)})`);
 if(n){// junto a la primera, mirándola
  const c0=await P.evaluar(`(async()=>{const d=window.__demo,c=d.patrullas.cars[0],fx=Math.sin(c.yaw),fz=Math.cos(c.yaw),lx=fz,lz=-fx,x=c.x+lx*(c.wid/2+.9),z=c.z+lz*(c.wid/2+.9);
   for(let k=0;k<20;k++){Object.assign(d.player,{x,z,feet:c.y,vy:0,ground:true});d.euler.set(-.2,Math.atan2(-(c.x-x),-(c.z-z)),0,'YXZ');d.camera.quaternion.setFromEuler(d.euler);await new Promise(r=>requestAnimationFrame(r));}
   return {x:c.x,z:c.z,yaw:c.yaw,accion:document.querySelector('.accion')?.innerText||''}})()`);
  console.log('junto a la patrulla:',c0.accion.replace(/\n/g,' '));if(!/Subir a la patrulla/.test(c0.accion))fallas.push('junto a la patrulla no se ofrece «Subir a la patrulla»');
  else{await tecla('KeyE','keydown');await tecla('KeyE','keyup');await cuadros(10);const e0=await estado();console.log('subido:',JSON.stringify({manejando:e0.manejando,avatar:e0.avatar,vel:e0.vel}));
   if(!e0.manejando)fallas.push('con E no se sube a la patrulla');else{if(e0.avatar)fallas.push('manejando, el muñeco se sigue viendo');if(e0.vel==null)fallas.push('manejando, no se ve el velocímetro');
    // D: girar
    const gi=await P.evaluar(`(async()=>{const d=window.__demo,c=d.patrullas.manejando,k=(x,t)=>window.dispatchEvent(new KeyboardEvent(t,{code:x}));const y0=c.yaw;k('KeyW','keydown');k('KeyD','keydown');await new Promise(r=>setTimeout(r,1500));k('KeyD','keyup');k('KeyW','keyup');
     k('KeyS','keydown');await new Promise(r=>setTimeout(r,1500));k('KeyS','keyup');return {giro:+(Math.atan2(Math.sin(c.yaw-y0),Math.cos(c.yaw-y0))).toFixed(2)};})()`,{tiempo:30000});
    console.log('con D:',JSON.stringify(gi));if(Math.abs(gi.giro)<.15)fallas.push('con D la patrulla no gira');
    // W: avanzar 3 s (registrando si en algún cuadro quedó adentro de un edificio)
    const av=await P.evaluar(`(async()=>{const d=window.__demo,w=d.world,c=d.patrullas.manejando,k=(x,t)=>window.dispatchEvent(new KeyboardEvent(t,{code:x}));const x0=c.x,z0=c.z;let adentro=0,vmax=0;k('KeyW','keydown');const t0=performance.now();
     while(performance.now()-t0<3000){await new Promise(r=>requestAnimationFrame(r));if(w.dentro(c.x,c.z,c.y+1))adentro++;vmax=Math.max(vmax,c.v);}k('KeyW','keyup');return {recorrido:+Math.hypot(c.x-x0,c.z-z0).toFixed(1),adentro,vmax:+vmax.toFixed(1),choco:c.choco||0};})()`,{tiempo:30000});
    console.log('con W 3 s:',JSON.stringify(av));await captura('patrulla-manejando.png');
    if(av.adentro)fallas.push('manejando, la patrulla quedó adentro de un edificio');if(av.recorrido<15&&!av.choco)fallas.push(`con W la patrulla casi no avanza (${av.recorrido} m)`);
    // contra un edificio: ponerla mirando a la pared más cercana y acelerar
    const pa=await P.evaluar(`(async()=>{const d=window.__demo,w=d.world,c=d.patrullas.manejando,k=(x,t)=>window.dispatchEvent(new KeyboardEvent(t,{code:x}));let best=null;
     for(let a=0;a<16;a++){const yaw=a*Math.PI/8;for(let s=4;s<30;s+=1){const x=c.x+Math.sin(yaw)*s,z=c.z+Math.cos(yaw)*s;if(w.dentro(x,z,c.y+1)){if(!best||s<best.s)best={yaw,s};break;}}}
     if(!best)return null;c.yaw=best.yaw;c.v=0;k('KeyW','keydown');let adentro=0;const t0=performance.now();while(performance.now()-t0<4000){await new Promise(r=>requestAnimationFrame(r));if(w.dentro(c.x,c.z,c.y+1))adentro++;}k('KeyW','keyup');
     k('KeyS','keydown');await new Promise(r=>setTimeout(r,600));k('KeyS','keyup');await new Promise(r=>setTimeout(r,800));return {pared:best.s,adentro,choco:c.choco||0}})()`,{tiempo:30000});
    console.log('contra un edificio:',JSON.stringify(pa));if(pa&&pa.adentro)fallas.push('contra un edificio, la patrulla se metió adentro');if(pa&&!pa.choco)fallas.push('contra un edificio, la patrulla no chocó');
    // bajarse: queda estacionada donde se dejó
    const antes=await estado();await tecla('KeyE','keydown');await tecla('KeyE','keyup');await cuadros(10);const e1=await estado();
    const quedo=await P.evaluar(`(()=>{const d=window.__demo,c=d.patrullas.cars[0];return {x:c.x,z:c.z,cerca:Math.hypot(c.x-d.player.x,c.z-d.player.z)}})()`);
    console.log('bajado:',JSON.stringify({manejando:e1.manejando,avatar:e1.avatar,quedo}));
    if(e1.manejando)fallas.push('con E no se baja de la patrulla');if(Math.hypot(quedo.x-antes.x,quedo.z-antes.z)>.3)fallas.push('la patrulla no quedó donde se dejó');if(quedo.cerca>5)fallas.push('al bajarse, el jugador no queda al lado de la patrulla');
    await cuadros(30);await captura('patrulla-estacionada.png');
    await cuadros(12);const otra=await P.evaluar(`document.querySelector('.accion')?.innerText||''`);if(!/Subir a la patrulla/.test(otra))fallas.push(`al lado de la patrulla estacionada no se ofrece volver a subir («${otra.replace(/\n/g,' ')}»)`);}}}
 const e=(typeof P.errores==='function'?P.errores():P.errores)||[];for(const x of e.slice(0,3))fallas.push('error en la página: '+String(x).slice(0,160));
 // de ladrón: no se sube
 const Q=await N.abrir(`${base}/demo?jugadores=3&ciudad=${ciudad}`);await Q.evaluar(espera,{tiempo:240000});
 const l=await Q.evaluar(`(async()=>{const d=window.__demo,c=d.patrullas.cars[0];if(!c)return null;const x=c.x+Math.cos(c.yaw)*(c.wid/2+.9),z=c.z-Math.sin(c.yaw)*(c.wid/2+.9);for(let k=0;k<20;k++){Object.assign(d.player,{x,z,feet:c.y,vy:0,ground:true});await new Promise(r=>requestAnimationFrame(r));}return document.querySelector('.accion')?.innerText||''})()`);
 console.log('de ladrón, junto a la patrulla:',JSON.stringify(l));if(l==null)fallas.push('de ladrón no hay patrullas en la comisaría');else if(/Subir a la patrulla/.test(l))fallas.push('de ladrón se ofrece subir a la patrulla');}
catch(err){fallas.push('el validador se cortó: '+String(err?.message||err).slice(0,200));}
finally{console.log(`patrulla · ciudad ${ciudad} · subir, manejar, chocar y estacionar: ${fallas.length?'con fallas':'todo'}`);console.log(`fallas: ${fallas.length}`);for(const f of fallas)console.log('  '+f);await N.cerrar();process.exit(0);}
