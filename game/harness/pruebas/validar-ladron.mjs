// Nivel 10 del probador: de ladrón contra la policía bot del motor (2026-10-17), sin pantalla:
// · los bots (la policía y los otros ladrones) están dibujados: un muñeco por bot;
// · robar en el 3D deja al ladrón del jugador a la vista en el motor y un aviso de alarma suyo;
// · adentro de un edificio, el motor lo da por escondido;
// · un policía bot que lo alcanza con botín encima: preso, pierde la mochila, el cartel, y queda en la comisaría;
// · un compañero bot lo rescata: libre otra vez, sin cartel;
// · sin botín: detenido un rato (y después libre);
// · al llegar a la meta: el cartel del final («Ganaste») y «Volver al inicio» lleva a las salas (/?paso=home).
// Uso: node scripts/validar-ladron.mjs [ciudad=1] [carpeta=/tmp] (con el servidor en 5180)
import {abrirNavegador} from './navegador.mjs';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [ciudad=1,OUT='/tmp']=process.argv.slice(2);const base='http://localhost:5180';
const N=await abrirNavegador();const fallas=[];
try{const P=await N.abrir(`${base}/demo?jugadores=3&ciudad=${ciudad}`);
 await P.evaluar(`new Promise(r=>{const t=setInterval(()=>{const d=window.__demo;if(d?.world&&d.ronda&&d.persec?.listo&&d.avatar){clearInterval(t);const st=document.createElement('style');st.textContent='.card{display:none!important}';document.head.appendChild(st);d.fijarHora(2,12);r(1);}},300);})`,{tiempo:240000});
 const captura=async n=>writeFileSync(join(OUT,n),Buffer.from(await P.captura(),'base64'));
 const cuadros=n=>P.evaluar(`(async()=>{for(let k=0;k<${n};k++)await new Promise(r=>requestAnimationFrame(r));})()`);
 const ini=await P.evaluar(`(()=>{const d=window.__demo,P=d.persec.P,g=d.scene.getObjectByName('persecucion');return {bots:P.agentes.filter(a=>!a.humano).length,muñecos:g?.children.length,yo:d.persec.yo.id,equipo:d.persec.yo.equipo}})()`);
 console.log('al empezar:',JSON.stringify(ini));if(ini.equipo!=='ladron')fallas.push('el jugador no es un ladrón del motor');if(ini.muñecos!==ini.bots)fallas.push(`hay ${ini.muñecos} muñecos para ${ini.bots} bots`);
 // robar (como validar-ronda) y que el motor lo sepa
 const rob=await P.evaluar(`(async()=>{const d=window.__demo,w=d.world,R=d.ronda,cuadro=()=>new Promise(r=>requestAnimationFrame(r));
  for(const o of R.robables.filter(o=>o.lugar.lot!=null&&o.lugar.nivel>0).slice(0,30))for(const [dx,dz] of [[.9,0],[-.9,0],[0,.9],[0,-.9]]){const feet=(w.lots.get(o.lugar.lot)?.raise||0)+o.lugar.nivel*3+.02;
   for(let k=0;k<15;k++){Object.assign(d.player,{x:o.x+dx,z:o.z+dz,feet,vy:0,ground:true});await cuadro();}
   const c=d.acciones.cerca();if(c?.ronda&&/^Robar/.test(c.texto)){window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE'}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyE'}));for(let k=0;k<8;k++)await cuadro();
    const P=d.persec.P,yo=d.persec.yo;return {mochila:R.mochila,expuesto:yo.expuestoHasta>P.t,alarma:P.avisos.some(a=>a.quien===yo.id&&a.tipo==='alarma'),retrato:yo.retrato,adentro:yo.estado};}}
  return null;})()`,{tiempo:120000});
 console.log('robo:',JSON.stringify(rob));if(!rob)fallas.push('no se pudo robar');else{if(!rob.expuesto||!rob.alarma)fallas.push('robar no llega al motor (a la vista y alarma)');if(rob.adentro!=='adentro')fallas.push('adentro del edificio, el motor no lo da por escondido');}
 // atrapado con botín: un policía bot al lado, en la calle
 const pre=await P.evaluar(`(async()=>{const d=window.__demo,P=d.persec.P,yo=d.persec.yo,cuadro=()=>new Promise(r=>requestAnimationFrame(r));
  const q=P.C.comisaria.puntos[0],e0=P.C.objetivos[0].puntos[0],k0=P.C.mapa.cerca(e0[0],e0[1]),cc=P.C.mapa.centro(k0);/* (en la calle: la puerta de un objetivo) */Object.assign(d.player,{x:cc.x,z:cc.z,feet:d.world.groundAt?.(cc.x,cc.z)??0,vy:0,ground:false});for(let k=0;k<20;k++)await cuadro();
  d.ronda.mochila=Math.max(d.ronda.mochila,1);yo.expuestoHasta=P.t+20;const c=P.agentes.find(a=>a.equipo==='policia'&&a.estado==='libre');
  let k=0;while(yo.estado!=='preso'&&k<200){c.x=yo.x+.5;c.z=yo.z;c.decide=Infinity;c.ruta=null;d.persec.update(.25);await cuadro();k++;}c.decide=0;
  for(let j=0;j<10;j++)await cuadro();return {estado:yo.estado,mochila:d.ronda.mochila,cartel:document.querySelector('.r-muerto.preso')?.innerText||'',lejos:+Math.hypot(d.player.x-q[0],d.player.z-q[1]).toFixed(1)}})()`,{tiempo:60000});
 console.log('atrapado:',JSON.stringify(pre));if(pre.estado!=='preso')fallas.push(`un policía al lado con botín no lo atrapa (${pre.estado})`);else{if(pre.mochila!==0)fallas.push('preso, no pierde la mochila');if(!/preso/.test(pre.cartel))fallas.push('preso, no sale el cartel');if(pre.lejos>8)fallas.push('preso, no queda en la comisaría');await captura('ladron-preso.png');}
 // el rescate: un compañero bot en la puerta de la comisaría
 if(pre.estado==='preso'){const res=await P.evaluar(`(async()=>{const d=window.__demo,P=d.persec.P,yo=d.persec.yo,m=await import('/src/engine/juego/partida.js'),cuadro=()=>new Promise(r=>requestAnimationFrame(r));
   const a=P.agentes.find(b=>b.equipo==='ladron'&&!b.humano);a.estado='libre';a.lugar=null;const q=P.C.comisaria.puntos[0];a.x=q[0]+1;a.z=q[1];a.retrato=false;a.expuestoHasta=-1;m.empezar(P,a,'rescatar',P.C.comisaria);a.decide=Infinity;
   for(const c of P.agentes)if(c.equipo==='policia'){c.x=q[0]+80;c.z=q[1]+80;c.decide=Infinity;c.ruta=null;}
   let k=0;while(yo.estado==='preso'&&k<120){d.persec.update(.25);await cuadro();k++;}for(const c of P.agentes)c.decide=0;for(let j=0;j<10;j++)await cuadro();
   return {estado:yo.estado,cartel:!!document.querySelector('.r-muerto.preso')}})()`,{tiempo:60000});
  console.log('rescate:',JSON.stringify(res));if(res.estado!=='libre')fallas.push(`un compañero en la puerta de la comisaría no lo rescata (${res.estado})`);else if(res.cartel)fallas.push('rescatado, el cartel de preso no se va');}
 // sin botín: detenido
 const det=await P.evaluar(`(async()=>{const d=window.__demo,P=d.persec.P,yo=d.persec.yo,cuadro=()=>new Promise(r=>requestAnimationFrame(r));
  const e0=P.C.objetivos[0].puntos[0],cc=P.C.mapa.centro(P.C.mapa.cerca(e0[0],e0[1]));Object.assign(d.player,{x:cc.x,z:cc.z,feet:d.world.groundAt?.(cc.x,cc.z)??0,vy:0,ground:false});for(let k=0;k<20;k++)await cuadro();
  d.ronda.mochila=0;d.ronda.enMochila=[];yo.expuestoHasta=P.t+20;const c=P.agentes.find(a=>a.equipo==='policia'&&a.estado==='libre');
  let k=0;while(yo.estado!=='detenido'&&k<200){c.x=yo.x+.5;c.z=yo.z;c.decide=Infinity;c.ruta=null;d.persec.update(.25);await cuadro();k++;}c.decide=0;const e1=yo.estado,cart=document.querySelector('.r-muerto.preso')?.innerText||'';
  for(let j=0;j<120&&yo.estado==='detenido';j++){d.persec.update(.25);await cuadro();}return {e1,cart,e2:yo.estado}})()`,{tiempo:60000});
 console.log('sin botín:',JSON.stringify(det));if(det.e1!=='detenido')fallas.push(`sin botín no lo detienen (${det.e1})`);else{if(!/Detenido/.test(det.cart))fallas.push('detenido, no sale el cartel');if(det.e2!=='libre')fallas.push('detenido, no lo sueltan');}
 // el final: la meta
 const fin=await P.evaluar(`(async()=>{const d=window.__demo,P=d.persec.P;P.botin=P.meta;for(let k=0;k<5;k++){d.persec.update(.25);await new Promise(r=>requestAnimationFrame(r));}await new Promise(r=>setTimeout(r,600));
  const c=document.querySelector('.r-muerto.fin');return {fin:P.fin,cartel:c?.innerText||'',volver:!!c?.querySelector('a[href*="paso=home"]')}})()`,{tiempo:30000});
 console.log('final:',JSON.stringify(fin));if(fin.fin?.gana!=='ladron'||!/Ganaste/i.test(fin.cartel))fallas.push('al llegar a la meta no sale «Ganaste»');if(!fin.volver)fallas.push('el final no tiene «Volver al inicio»');
 await captura('ladron-fin.png');
 if(fin.volver){await P.evaluar(`(async()=>{document.querySelector('.r-muerto.fin a').click();await new Promise(r=>setTimeout(r,1500));})()`);const url=await P.evaluar('location.pathname+location.search');console.log('volver:',url);if(!/^\/\?paso=home/.test(url))fallas.push('«Volver al inicio» no lleva a las salas (/?paso=home)');}
 const e=(typeof P.errores==='function'?P.errores():P.errores)||[];for(const x of e.slice(0,3))fallas.push('error en la página: '+String(x).slice(0,160));}
catch(err){fallas.push('el validador se cortó: '+String(err?.message||err).slice(0,200));}
finally{console.log(`ladrón · ciudad ${ciudad} · contra la policía bot: robar, preso, rescate, detenido y final: ${fallas.length?'con fallas':'todo'}`);console.log(`fallas: ${fallas.length}`);for(const f of fallas)console.log('  '+f);await N.cerrar();process.exit(0);}
