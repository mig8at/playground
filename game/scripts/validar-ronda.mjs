// Nivel 10 del probador: la ronda jugable del ladrón en el 3D, sin pantalla (2026-10-17, REGLAS.md paso 1): abre /demo, espera la ronda, se
// para junto a algo robable de un apartamento, mira que se ofrezca «Robar … · precio», lo roba, va a la caja de la
// guarida, guarda, y revisa el panel (mochila, guardado, meta); todo apretando las teclas, como el jugador (E, R). Y en
// la puerta trancada de un apartamento ajeno: ofrece forzar y el visor, el visor contesta, la puerta frena el paso hasta
// forzarla y forzarla toma su tiempo. Captura en el robo, en la caja y en la puerta.
// Uso: node scripts/validar-ronda.mjs [ciudad=1] [carpeta=/tmp] (con el servidor en 5180)
import {abrirNavegador} from './navegador.mjs';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [ciudad=1,OUT='/tmp']=process.argv.slice(2);const base='http://localhost:5180';
const N=await abrirNavegador();const fallas=[];
try{const P=await N.abrir(`${base}/demo?jugadores=3&ciudad=${ciudad}`);
 await P.evaluar(`new Promise(r=>{const t=setInterval(()=>{const d=window.__demo;if(d?.world&&d.acciones&&d.ronda){clearInterval(t);const st=document.createElement('style');st.textContent='.card{display:none!important}';document.head.appendChild(st);r(1);}},300);})`,{tiempo:240000});
 const cuadro=`()=>new Promise(r=>requestAnimationFrame(r))`;
 // (apretar una tecla como el jugador y dejar pasar unos cuadros)
 const tecla=c=>P.evaluar(`(async()=>{window.dispatchEvent(new KeyboardEvent('keydown',{code:'${c}'}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'${c}'}));for(let k=0;k<10;k++)await new Promise(r=>requestAnimationFrame(r));return document.querySelector('.r-msg')?.textContent||null;})()`);
 // ponerse en un lugar del plano (piso de un edificio o casa) mirando a un punto, y dejar que se acomode
 const ir=async(L,x,z,mira)=>P.evaluar(`(async()=>{const d=window.__demo,w=d.world,L=${JSON.stringify(L)},cuadro=${cuadro};
  if([...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Caminar'))d.toggleDrone();
  let feet=0;if(L.lot!=null)feet=(w.lots.get(L.lot)?.raise||0)+L.nivel*3+.02;else{const con=d.plan.isla.casas.map((c,i)=>c.spec?i:-1).filter(i=>i>=0),h=d.viviendas?.houses?.[con.indexOf(L.casa)];if(h)feet=h.y+(L.nivel&&h.plan.H1?h.plan.H1:h.plan.FLOOR0||0);}
  Object.assign(d.player,{x:${x},z:${z},feet,vy:0,ground:true});const yaw=Math.atan2(-(${mira.x}-${x}),-(${mira.z}-${z}));
  for(let k=0;k<120;k++){d.euler.set(-.35,yaw,0,'YXZ');d.camera.quaternion.setFromEuler(d.euler);await cuadro();}
  const c=d.acciones.cerca();return {texto:c?.texto||null,ronda:!!c?.ronda};})()`,{tiempo:60000});
 const R=await P.evaluar(`(()=>{const R=window.__demo.ronda;return {guaridas:R.guaridas,robables:R.robables.filter(o=>o.lugar.lot!=null&&o.lugar.nivel>0).slice(0,40)}})()`);
 // algo robable de un apartamento: pararse a 0,9 m de su centro, por el lado donde se camina (se prueban los cuatro)
 let hecho=null;for(const o of R.robables){for(const [dx,dz] of [[.9,0],[-.9,0],[0,.9],[0,-.9]]){const r=await ir(o.lugar,o.x+dx,o.z+dz,{x:o.x,z:o.z});if(r.ronda&&/^Robar/.test(r.texto)){hecho={o,r};break;}}if(hecho)break;}
 if(!hecho)fallas.push('ningún robable de apartamento ofrece «Robar» al acercarse');
 else{console.log('ofrece:',hecho.r.texto);writeFileSync(join(OUT,'ronda-robar.png'),Buffer.from(await P.captura(),'base64'));
  await tecla('KeyE');const panel=await P.evaluar(`(()=>{const d=window.__demo;return {mochila:d.ronda.mochila,msg:document.querySelector('.r-msg')?.textContent,hud:document.querySelector('.ronda')?.innerText}})()`);
  console.log('robado:',JSON.stringify(panel));if(!(panel.mochila>0))fallas.push('robar no sumó a la mochila');
  // la caja de la guarida
  const g=R.guaridas[0];let ok=null;for(const [dx,dz] of [[0,.9],[0,-.9],[.9,0],[-.9,0]]){const r=await ir(g.lugar,g.caja.x+dx,g.caja.z+dz,{x:g.caja.x,z:g.caja.z});if(r.ronda&&/^Guardar/.test(r.texto)){ok=r;break;}}
  if(!ok)fallas.push('en la caja de la guarida no se ofrece «Guardar»');else{console.log('en la caja:',ok.texto);writeFileSync(join(OUT,'ronda-caja.png'),Buffer.from(await P.captura(),'base64'));
   await tecla('KeyE');const fin=await P.evaluar(`(()=>{const d=window.__demo;return {botin:d.ronda.botin,mochila:d.ronda.mochila,hud:document.querySelector('.ronda')?.innerText}})()`);
   console.log('guardado:',JSON.stringify(fin));if(!(fin.botin>0)||fin.mochila!==0)fallas.push('guardar no pasó la mochila al botín');}}
 // la puerta trancada de un apartamento ajeno (en un piso de arriba): pararse en el lugar del visor, mirando la puerta
 const pu=await P.evaluar(`(()=>{const R=window.__demo.ronda;return R.puertas.filter(p=>p.tipo==='apto'&&!R.abiertas.has(p.vivienda)).slice(0,30).map(p=>({id:p.id,vivienda:p.vivienda,lugar:p.lugar,x:p.x,z:p.z,mx:(p.x0+p.x1)/2,mz:(p.z0+p.z1)/2,y:p.y}))})()`);
 let door=null;for(const p of pu){const r=await ir(p.lugar,p.x,p.z,{x:p.mx,z:p.mz});if(r.ronda&&/^Forzar/.test(r.texto)){door=p;break;}}
 if(!door)fallas.push('en ninguna puerta de apartamento se ofrece forzar la chapa');
 else{const alt=await P.evaluar(`document.querySelector('.accion')?.innerText||''`);console.log('en la puerta:',alt.replace(/\n/g,' '));if(!/Mirar por el visor/.test(alt))fallas.push('en la puerta no se ofrece «R Mirar por el visor»');
  const visor=await tecla('KeyR');console.log('visor:',visor);if(!/Por el visor/.test(visor||''))fallas.push('R no mira por el visor');
  // la puerta trancada frena: el punto del vano, a la altura de la puerta
  const tr=await P.evaluar(`(async()=>{const m=await import('/src/engine/juego/ronda.js'),d=window.__demo;return m.trancada(d.ronda,${door.mx},${door.mz},.26,${door.y})&&m.puertaTrancadaEn(d.ronda,${door.mx},${door.mz},${door.y})})()`);if(!tr)fallas.push('la puerta trancada no frena el paso o su hoja se abriría sola');
  writeFileSync(join(OUT,'ronda-puerta.png'),Buffer.from(await P.captura(),'base64'));
  await tecla('KeyE');const msg1=await P.evaluar(`document.querySelector('.r-msg')?.textContent||''`);console.log('forzando:',msg1);
  const ab=await P.evaluar(`(async()=>{const d=window.__demo;const t0=performance.now();while(d.ronda.forzando&&performance.now()-t0<9000)await new Promise(r=>requestAnimationFrame(r));/* (por tiempo: forzar se cuenta en segundos) */await new Promise(r=>setTimeout(r,200));const m=await import('/src/engine/juego/ronda.js');return {abierta:d.ronda.abiertas.has(${JSON.stringify(door.vivienda)}),trancada:m.trancada(d.ronda,${door.mx},${door.mz},.26,${door.y}),msg:document.querySelector('.r-msg')?.textContent}})()`);
  console.log('forzada:',JSON.stringify(ab));if(!ab.abierta||ab.trancada)fallas.push('forzar no abrió la puerta');
  for(let k=0;k<60;k++)await P.evaluar(`new Promise(r=>requestAnimationFrame(r))`);writeFileSync(join(OUT,'ronda-forzada.png'),Buffer.from(await P.captura(),'base64'));}
 // el televisor robado deja de dibujarse: el mueble dibujado (lotFurniture, tv@…) en su punto y su piso pasa a «robado»
 const tv=await P.evaluar(`(async()=>{const d=window.__demo,m=await import('/src/engine/juego/ronda.js'),R=d.ronda,LF=d.world.lotFurniture;
  for(const o of R.robables){if(o.nombre!=='Televisor'||o.lugar.lot==null||R.robados.has(o.id))continue;const L=LF.get(o.lugar.lot);const it=L?.items.find(it=>/^tv@/.test(it.name)&&it.f===o.lugar.nivel&&Math.hypot(it.x-o.x,it.z-o.z)<.5);if(!it)continue;
   const antes=m.robadoEn(R,it.name,o.lugar.lot,it.f,it.x,it.z);m.robar(R,o.id,0);const despues=m.robadoEn(R,it.name,o.lugar.lot,it.f,it.x,it.z);return {tv:it.name,antes,despues};}return null;})()`);
 console.log('televisor:',JSON.stringify(tv));if(!tv)fallas.push('ningún televisor robable coincide con uno dibujado');else if(tv.antes||!tv.despues)fallas.push('el televisor robado se sigue dibujando');
 const e=(typeof P.errores==='function'?P.errores():P.errores)||[];for(const x of e.slice(0,3))fallas.push('error en la página: '+String(x).slice(0,160));}
catch(err){fallas.push('el validador se cortó: '+String(err?.message||err).slice(0,200));}// (sin esto, un error se iba en silencio y salía «0 fallas»)
finally{console.log(`ronda · ciudad ${ciudad} · robar y guardar en el 3D: ${fallas.length?'con fallas':'el ciclo completo'}`);console.log(`fallas: ${fallas.length}`);for(const f of fallas)console.log('  '+f);await N.cerrar();process.exit(0);}
