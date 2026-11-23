// La entrada de mycity (2026-11-22, src/views/InicioView.vue; Miguel: «al entrar seleccionamos un país —Colombia— y luego
// una ciudad —Bogotá— y ahí muestra el mapa para caminar»), en el navegador sin ventana (con el servidor en 5181):
//  · cada pantalla —el título, el país, la ciudad— abre sin errores en la página;
//  · «Entrar» lleva a los países, el país a sus ciudades y la ciudad a /ciudad?lugar=<ciudad>;
//  · la ciudad arma su mundo con la semilla de ese lugar (engine/lugares.js) y dice dónde se está («Bogotá, Colombia»).
// Uso: node harness/pruebas/validar-entrada.mjs
import {abrirNavegador} from './navegador.mjs';
import {PAISES} from '../../src/engine/lugares.js';
const fallas=[],med=[],base='http://localhost:5181',espera=ms=>new Promise(r=>setTimeout(r,ms));
const N=await abrirNavegador();
const errores=P=>(typeof P.errores==='function'?P.errores():P.errores)||[];
try{
 for(const p of ['titulo','pais','ciudad']){const P=await N.abrir(`${base}/?paso=${p}`);await espera(1500);
  if(!await P.evaluar(`!!document.querySelector('.inicio section')`))fallas.push(`la pantalla «${p}» no se dibuja`);
  for(const x of errores(P).slice(0,2))fallas.push(`error en «${p}»: `+String(x).slice(0,160));}
 const pais=PAISES[0],ciudad=pais.ciudades[0];
 const P=await N.abrir(`${base}/`);await espera(1200);
 const clic=sel=>P.evaluar(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true;})()`);
 if(!await clic('.titulo .cta'))fallas.push('el título no tiene «Entrar»');await espera(400);
 const paises=await P.evaluar(`[...document.querySelectorAll('.tarjeta b')].map(b=>b.textContent.trim())`);
 if(!paises.includes(pais.nombre))fallas.push(`los países no ofrecen ${pais.nombre}: `+JSON.stringify(paises));
 if(!await clic('.tarjeta'))fallas.push('no hay país para elegir');await espera(400);
 const ciudades=await P.evaluar(`[...document.querySelectorAll('.tarjeta.ciudad b')].map(b=>b.textContent.trim())`);
 if(!ciudades.includes(ciudad.nombre))fallas.push(`${pais.nombre} no ofrece ${ciudad.nombre}: `+JSON.stringify(ciudades));
 med.push(`${paises.length} país(es): ${paises.join(', ')} · ${pais.nombre}: ${ciudades.join(', ')}`);
 if(!await clic('.tarjeta.ciudad'))fallas.push('no hay ciudad para elegir');
 let d=null;for(let k=0;k<60&&!d;k++){await espera(2000);try{d=await P.evaluar(`(()=>{const d=window.__demo;return d?.world&&d.tiempos?.total?{url:location.pathname+location.search,semilla:d.plan?.seed,total:d.tiempos.total,donde:document.querySelector('.where small')?.textContent||''}:null;})()`);}catch{}}
 if(!d)fallas.push('la ciudad no arrancó');else{med.push(`ciudad: ${d.url} · semilla ${d.semilla} · lista en ${(d.total/1000).toFixed(1)} s · «${d.donde.split('·')[0].trim()}»`);
  if(!d.url.startsWith(`/ciudad?lugar=${ciudad.id}`))fallas.push('la ciudad no abre su lugar: '+d.url);
  if(d.semilla!==ciudad.semilla)fallas.push(`la ciudad no usa la semilla de ${ciudad.nombre}: ${d.semilla}`);
  if(!d.donde.includes(`${ciudad.nombre}, ${pais.nombre}`))fallas.push('la ciudad no dice dónde se está: '+d.donde);}
 for(const x of errores(P).slice(0,3))fallas.push('error en la página: '+String(x).slice(0,160));}
catch(err){fallas.push('el validador se cortó: '+String(err?.message||err).slice(0,200));}
finally{console.log(`entrada · el título, el país, la ciudad y entrar a caminarla`);for(const m of med)console.log('  '+m);console.log(`fallas: ${fallas.length}`);for(const f of fallas)console.log('  '+f);await N.cerrar();process.exit(0);}
