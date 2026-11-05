// Nivel 10 del probador (2026-10-17, REGLAS.md paso 2: la barra de vida y las caídas), en el navegador sin ventana:
// suelta al muñeco en el aire sobre la calle desde varias alturas (como al salir corriendo de un techo) y mira la vida al
// aterrizar contra engine/juego/huida.js danoDeCaida: 3 m no duele, 6 m quita lo que dice la regla (±3), 12 m mata (la
// pantalla de muerte y lo que llevaba en la mochila, perdido); después de un golpe la vida vuelve de a poco; Enter lo
// devuelve a la guarida. Captura la caída mortal.
// Uso: node scripts/validar-caidas.mjs [ciudad=1] [carpeta=/tmp] (con el servidor en 5180)
import {abrirNavegador} from './navegador.mjs';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {danoDeCaida} from '../src/engine/juego/huida.js';
import {VIDA} from '../src/engine/medidas.js';
const [ciudad=1,OUT='/tmp']=process.argv.slice(2);const N=await abrirNavegador(),fallas=[],med=[];
try{const P=await N.abrir(`http://localhost:5180/demo?jugadores=3&ciudad=${ciudad}`);
 await P.evaluar(`new Promise(r=>{const t=setInterval(()=>{const d=window.__demo;if(d?.world&&d.ronda){clearInterval(t);const st=document.createElement('style');st.textContent='.card{display:none!important}';document.head.appendChild(st);r(1);}},300);})`,{tiempo:240000});
 // un punto de calle abierto (el punto de salida del mundo) y soltar desde h m sobre el suelo
 const soltar=h=>P.evaluar(`(async()=>{const d=window.__demo,w=d.world,cuadro=()=>new Promise(r=>requestAnimationFrame(r));
  if([...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Caminar'))d.toggleDrone();
  const x=w.spawn.x,z=w.spawn.z,g=w.groundAt(x,z);Object.assign(d.player,{x,z,feet:g+${h},vy:0,ground:true,caidaDesde:null,sinDano:false});
  const v0=d.vida;let k=0;while(k++<600){await cuadro();if(d.player.ground&&d.player.feet<=g+.05)break;}for(let i=0;i<5;i++)await cuadro();return {v0,v1:d.vida,muerto:d.muerto};})()`,{tiempo:60000});
 const revivir=()=>P.evaluar(`(async()=>{window.dispatchEvent(new KeyboardEvent('keydown',{code:'Enter'}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'Enter'}));for(let i=0;i<10;i++)await new Promise(r=>requestAnimationFrame(r));return {muerto:window.__demo.muerto,vida:window.__demo.vida};})()`);
 // 3 m: nada
 let r=await soltar(3);med.push(`3 m: ${Math.round(r.v0)}→${Math.round(r.v1)}`);if(r.v1<r.v0-.5)fallas.push(`una caída de 3 m dolió (${Math.round(r.v0-r.v1)})`);
 // 6 m: lo de la regla
 r=await soltar(6);const esp=danoDeCaida(6);med.push(`6 m: ${Math.round(r.v0)}→${Math.round(r.v1)} (regla −${Math.round(esp)})`);if(Math.abs((r.v0-r.v1)-esp)>3)fallas.push(`una caída de 6 m quitó ${Math.round(r.v0-r.v1)}, la regla dice ${Math.round(esp)}`);
 // la vida vuelve: VIDA.espera s después, VIDA.recupera por segundo
 const rec=await P.evaluar(`new Promise(r=>{const v=window.__demo.vida;setTimeout(()=>r({antes:v,despues:window.__demo.vida}),${(VIDA.espera+3)*1000});})`,{tiempo:(VIDA.espera+20)*1000});
 med.push(`recupera: ${Math.round(rec.antes)}→${Math.round(rec.despues)} en ${VIDA.espera+3} s`);if(!(rec.despues>rec.antes))fallas.push('la vida no vuelve después de un golpe');
 // 12 m con algo en la mochila: muere y lo pierde
 await P.evaluar(`(()=>{window.__demo.ronda.mochila=2;})()`);r=await soltar(12);const mochila=await P.evaluar(`window.__demo.ronda.mochila`);
 med.push(`12 m: ${r.muerto?'muere':'vive con '+Math.round(r.v1)}`);if(!r.muerto)fallas.push('una caída de 12 m no mata');if(mochila!==0)fallas.push('al morir no pierde lo que llevaba');
 const pant=await P.evaluar(`document.querySelector('.r-muerto')?.innerText||''`);if(!/Te mataste/.test(pant))fallas.push('no aparece la pantalla de muerte');
 writeFileSync(join(OUT,'caida-mortal.png'),Buffer.from(await P.captura(),'base64'));
 const rv=await revivir();med.push(`Enter: ${rv.muerto?'sigue muerto':'vuelve con '+Math.round(rv.vida)}`);if(rv.muerto||rv.vida<VIDA.max)fallas.push('Enter no lo devuelve a la guarida con la vida llena');
 const e=(typeof P.errores==='function'?P.errores():P.errores)||[];for(const x of e.slice(0,3))fallas.push('error en la página: '+String(x).slice(0,160));}
catch(err){fallas.push('el validador se cortó: '+String(err?.message||err).slice(0,200));}// (un error es una falla)
finally{console.log(`caídas · ciudad ${ciudad} · ${med.join(' · ')}`);console.log(`fallas: ${fallas.length}`);for(const f of fallas)console.log('  '+f);await N.cerrar();process.exit(0);}
