// La entrada del juego (2026-10-18; src/views/InicioView.vue), en el navegador sin ventana (con el servidor en 5180):
//  · cada pantalla abre sin errores en la página (título, entrar, perfil, home, crear, sala, cómo se juega);
//  · el home: las dos salas de prueba arriba, con su mapa guardado en IndexedDB (mapasGuardados.js) en menos de
//    PRECARGA_MAX s; el filtro «8 vs 8» deja sólo salas de 8 y «Con lugar» sólo las que se pueden unir;
//  · unirse a «falta un policía»: la sala queda con todos listos, la cuenta arranca y lleva a /juego de policía en la
//    ciudad 1, con el plano leído de IndexedDB (tiempos.planoGuardado).
// Uso: node scripts/validar-entrada.mjs
import {abrirNavegador} from './navegador.mjs';
const PRECARGA_MAX=90,fallas=[],med=[];
const N=await abrirNavegador();
try{
 for(const p of ['titulo','entrar','perfil','crear','sala','reglas']){const P=await N.abrir(`http://localhost:5180/?paso=${p}`);await new Promise(r=>setTimeout(r,p==='crear'||p==='sala'?6000:1500));
  const ok=await P.evaluar(`!!document.querySelector('.inicio section')`);if(!ok)fallas.push(`la pantalla «${p}» no se dibuja`);
  const e=(typeof P.errores==='function'?P.errores():P.errores)||[];for(const x of e.slice(0,2))fallas.push(`error en «${p}»: `+String(x).slice(0,160));}
 const P=await N.abrir('http://localhost:5180/?paso=home');const t0=Date.now();
 const pre=await P.evaluar(`new Promise(r=>{const t=setInterval(()=>{const i=window.__inicio;if(i&&i.mapaEstado[1]==='listo'&&i.mapaEstado[2]==='listo'){clearInterval(t);r(true);}},500);setTimeout(()=>{clearInterval(t);r(false);},${PRECARGA_MAX*1000});})`,{tiempo:(PRECARGA_MAX+10)*1000});
 med.push(`precarga de las salas de prueba: ${pre?((Date.now()-t0)/1000).toFixed(0)+' s':'no terminó'}`);if(!pre)fallas.push('las salas de prueba no guardaron su mapa a tiempo');
 const lista=await P.evaluar(`(async()=>{const filas=()=>[...document.querySelectorAll('.salas li:not(.vacia)')].map(li=>li.querySelector('.info b')?.textContent.trim());const todas=filas();
  const clic=t=>[...document.querySelectorAll('.filtros button')].find(b=>b.textContent.trim()===t)?.click();clic('8 vs 8');await new Promise(r=>setTimeout(r,200));const ocho=[...document.querySelectorAll('.salas li:not(.vacia) .info small')].map(s=>s.textContent);
  clic('Con lugar');await new Promise(r=>setTimeout(r,200));const lugar=[...document.querySelectorAll('.salas li:not(.vacia) button.cta')].map(b=>b.disabled);clic('Todas');return {todas,ocho,lugar};})()`);
 if(!/falta un policía/.test(lista.todas[0]||'')||!/falta un ladrón/.test(lista.todas[1]||''))fallas.push('las salas de prueba no van arriba: '+JSON.stringify(lista.todas.slice(0,3)));
 if(lista.ocho.some(t=>!/8 vs 8/.test(t)))fallas.push('el filtro «8 vs 8» deja otras salas');if(lista.lugar.some(Boolean))fallas.push('«Con lugar» deja salas que no se pueden unir');
 med.push(`salas: ${lista.todas.length} · con 8 vs 8: ${lista.ocho.length} · con lugar: ${lista.lugar.length}`);
 await P.evaluar(`(()=>{const i=window.__inicio;i.unirse(i.salas.value.find(s=>s.prueba==='policia'));})()`);
 await new Promise(r=>setTimeout(r,800));const sala=await P.evaluar(`(()=>{const i=window.__inicio;return {n:i.sala.jugadores.length,listos:i.sala.jugadores.every(j=>j.listo),yo:i.sala.jugadores.find(j=>j.yo)?.bando,cuenta:i.sala.cuenta};})()`);
 if(sala.n!==6||!sala.listos||sala.yo!=='policia'||sala.cuenta==null)fallas.push('la sala de prueba no queda lista con vos de policía: '+JSON.stringify(sala));
 let d=null;for(let k=0;k<60&&!d;k++){await new Promise(r=>setTimeout(r,2000));try{d=await P.evaluar(`(()=>{const d=window.__demo;return d?.world&&d.tiempos?.total?{url:location.pathname+location.search,guardado:d.tiempos.planoGuardado,total:d.tiempos.total}:null;})()`);}catch{}}
 if(!d)fallas.push('la partida no arrancó');else{med.push(`partida: ${d.url} · plano ${d.guardado?'de IndexedDB':'armado'} · lista en ${(d.total/1000).toFixed(1)} s`);
  if(!/^\/juego\?ciudad=1&jugadores=3&papel=policia/.test(d.url))fallas.push('la sala no lleva a /juego de policía en la ciudad 1: '+d.url);if(!d.guardado)fallas.push('la partida no usó el plano guardado');}
 const e=(typeof P.errores==='function'?P.errores():P.errores)||[];for(const x of e.slice(0,3))fallas.push('error en la página: '+String(x).slice(0,160));}
catch(err){fallas.push('el validador se cortó: '+String(err?.message||err).slice(0,200));}
finally{console.log(`entrada · las pantallas, las salas de prueba precargadas y entrar a jugar`);for(const m of med)console.log('  '+m);console.log(`fallas: ${fallas.length}`);for(const f of fallas)console.log('  '+f);await N.cerrar();process.exit(0);}
