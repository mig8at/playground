// Nivel 10 del probador: el allanamiento en el 3D de verdad (2026-10-18, REGLAS.md; ronda.js, partida.js, bots.js,
// persecucion3d.js), sin pantalla:
//  · de policía: en la puerta de una guarida delatada se ofrece cuánto falta para la orden y E no entra; con la orden,
//    «Allanar la guarida»: E incauta lo guardado (baja el botín de la banda) y la guarida queda cerrada;
//  · de ladrón: robar y guardar enseguida (con el rastro encendido) avisa que lo vieron y delata la guarida también en el
//    motor de los bots (la misma, por su índice); la policía bot va y, pasada la espera, la allana: la ronda del jugador
//    pierde lo guardado ahí y la guarida ya no ofrece guardar.
// Uso: node scripts/validar-allanar3d.mjs [ciudad=1] [carpeta=/tmp] (con el servidor en 5180)
import {abrirNavegador} from './navegador.mjs';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [ciudad=1,OUT='/tmp']=process.argv.slice(2);const base='http://localhost:5180';
const N=await abrirNavegador();const fallas=[];const res={};
const tecla=(P,c)=>P.evaluar(`(async()=>{window.dispatchEvent(new KeyboardEvent('keydown',{code:'${c}'}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'${c}'}));for(let k=0;k<6;k++)await new Promise(r=>requestAnimationFrame(r));return document.querySelector('.r-msg')?.textContent||null;})()`);
try{
 // ---- de policía ----
 let P=await N.abrir(`${base}/demo?papel=policia&jugadores=3&ciudad=${ciudad}`);
 await P.evaluar(`new Promise(r=>{const t=setInterval(()=>{const d=window.__demo;if(d?.world&&d.acciones&&d.persec?.listo&&d.avatar){clearInterval(t);const st=document.createElement('style');st.textContent='.card{display:none!important}';document.head.appendChild(st);r(1);}},300);})`,{tiempo:240000});
 // (una guarida con 3 de botín, delatada ahora; los bots quietos para que nadie se adelante)
 const ir=`async(x,z)=>{const d=window.__demo,w=d.world,p=d.player;const piso=(x,z)=>{const s=w.size;return x>=0&&z>=0&&x<=s.w&&z<=s.h?w.groundAt(x,z):d.island.ground(x,z);};
  for(let k=0;k<20;k++){Object.assign(p,{x,z,feet:piso(x,z),vy:0,ground:true,caidaDesde:null});await new Promise(r=>requestAnimationFrame(r));}return document.querySelector('.accion')?.innerText||'';}`;
 const prep=await P.evaluar(`(async()=>{const d=window.__demo,P=d.persec.P,L=P.guaridas[0];const [cx,cz]=P.C.comisaria.puntos[0];
  // (los bots quietos y lejos: un ladrón arranca parado en la puerta de su guarida y se ofrecería pedirle papeles)
  for(const a of P.agentes)if(!a.humano){a.decide=1e9;a.ruta=null;a.accion=null;a.x=cx;a.z=cz;}
  L.guardado+=3;P.botin+=3;L.delatada={desde:P.t,allanable:P.t+30,quien:'L1'};const [x,z]=L.puntos[0];const t=await (${ir})(x,z);return {t,botin:P.botin,nombre:L.nombre};})()`,{tiempo:60000});
 console.log('en la puerta, sin orden:',prep.t.replace(/\n/g,' '));res.sinOrden=prep.t;
 if(!/orden de allanamiento llega en/.test(prep.t))fallas.push('en la puerta de la guarida delatada no dice cuánto falta para la orden');
 const m0=await tecla(P,'KeyE');console.log('E sin orden:',m0);if(!/Todavía no hay orden/.test(m0||''))fallas.push('sin la orden, E no avisa que todavía no se puede');
 const con=await P.evaluar(`(async()=>{const d=window.__demo,P=d.persec.P,L=P.guaridas[0];L.delatada.allanable=P.t;const [x,z]=L.puntos[0];return await (${ir})(x,z);})()`,{tiempo:60000});
 console.log('con la orden:',con.replace(/\n/g,' '));if(!/Allanar la guarida/.test(con))fallas.push('con la orden no se ofrece «Allanar la guarida»');
 const m1=await tecla(P,'KeyE');console.log('allanar:',m1);writeFileSync(join(OUT,'allanar-policia.png'),Buffer.from(await P.captura(),'base64'));
 const fin=await P.evaluar(`(()=>{const P=window.__demo.persec.P,L=P.guaridas[0];return {botin:P.botin,cerrada:L.cerrada,guardado:L.guardado,incautado:P.stats.incautado}})()`);
 console.log('después:',JSON.stringify(fin));if(!/Allanaste/.test(m1||''))fallas.push('E con la orden no allana');if(!fin.cerrada||fin.guardado!==0||Math.abs(prep.botin-3-fin.botin)>1e-9)fallas.push('el allanamiento del policía no incautó lo guardado');
 res.policia=fin.incautado;
 // ---- de ladrón ----
 P=await N.abrir(`${base}/demo?jugadores=3&ciudad=${ciudad}`);
 await P.evaluar(`new Promise(r=>{const t=setInterval(()=>{const d=window.__demo;if(d?.world&&d.acciones&&d.ronda&&d.persec?.listo){clearInterval(t);r(1);}},300);})`,{tiempo:240000});
 const lad=await P.evaluar(`(async()=>{const d=window.__demo,R=d.ronda,M=d.persec.P;for(const a of M.agentes)if(a.equipo==='ladron'&&!a.humano)a.decide=1e9;
  const o=R.robables.find(o=>o.valor>0),g=R.guaridas[0];d.usarRonda({accion:'robar',id:o.id});await new Promise(r=>setTimeout(r,300));d.usarRonda({accion:'guardar',id:g.id});
  await new Promise(r=>setTimeout(r,200));const L=M.guaridas[0];return {msg:document.querySelector('.r-msg')?.textContent||'',ronda:{delatada:!!g.delatada,guardado:g.guardado,botin:R.botin},motor:{delatada:!!L.delatada,guardado:L.guardado,nombre:L.nombre,texto:g.texto},perseguido:typeof d.persec.perseguido};})()`,{tiempo:60000});
 console.log('ladrón guarda con el rastro:',JSON.stringify(lad));
 if(!/te vieron entrar/.test(lad.msg))fallas.push('al guardar con el rastro no avisa que lo vieron entrar');
 if(!lad.ronda.delatada)fallas.push('la ronda no delató la guarida');if(!lad.motor.delatada)fallas.push('el motor de los bots no se enteró de la guarida delatada');
 if(lad.motor.nombre!==lad.motor.texto)fallas.push('la guarida del motor no es la de la ronda');if(lad.perseguido!=='boolean')fallas.push('la persecución no dice si lo persiguen');
 // (la policía bot: se adelanta el motor hasta que la allana o pasan 300 s)
 const al=await P.evaluar(`(async()=>{const d=window.__demo,M=d.persec.P,L=M.guaridas[0],R=d.ronda,g=R.guaridas[0];let k=0;while(!L.cerrada&&k<1200&&!M.fin){d.persec.update(.25);k++;}
  await new Promise(r=>setTimeout(r,300));return {t:+(M.t-L.delatada.desde).toFixed(1),cerrada:L.cerrada,quien:M.agentes.find(a=>a.tarea==='allanar')?.id||null,ronda:{cerrada:g.cerrada,guardado:g.guardado,incautado:R.incautado,botin:R.botin},msg:document.querySelector('.r-msg')?.textContent||''};})()`,{tiempo:120000});
 console.log('la policía bot:',JSON.stringify(al));
 if(!al.cerrada)fallas.push('la policía bot no allanó la guarida delatada del jugador');
 else{if(al.t<30-1e-6)fallas.push('la policía bot allanó antes de la espera');if(!al.ronda.cerrada||al.ronda.guardado!==0||!(al.ronda.incautado>0))fallas.push('el allanamiento del motor no llegó a la ronda del jugador');
  const u=await P.evaluar(`(async()=>{const d=window.__demo,m=await import('/src/engine/juego/ronda.js'),R=d.ronda,g=R.guaridas[0];return m.usosRonda(R,g.lugar,g.caja.x,g.caja.z).find(u=>u.id===g.id)?.accion||null;})()`);
  if(u==='guardar')fallas.push('la guarida allanada sigue ofreciendo guardar');res.ladron=al.ronda.incautado;res.espera=al.t;}
 writeFileSync(join(OUT,'allanar-ladron.png'),Buffer.from(await P.captura(),'base64'));
 const e=(typeof P.errores==='function'?P.errores():P.errores)||[];for(const x of e.slice(0,3))fallas.push('error en la página: '+String(x).slice(0,160));}
catch(err){fallas.push('el validador se cortó: '+String(err?.message||err).slice(0,200));}
finally{console.log(`allanar · ciudad ${ciudad} · policía incautó ${res.policia??'—'} · la policía bot allanó al jugador a los ${res.espera??'—'} s e incautó ${res.ladron??'—'}`);console.log(`fallas: ${fallas.length}`);for(const f of fallas)console.log('  '+f);await N.cerrar();process.exit(0);}
