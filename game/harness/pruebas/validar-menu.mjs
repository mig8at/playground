// Nivel 10 del probador: el menú del juego (Tab) con los datos de la partida (2026-10-17), sin pantalla, apretando las teclas:
// · de ladrón: Tab lo abre y lo cierra; después de robar en un apartamento, el Botín muestra la cosa con su precio y la
//   cámara del edificio lo grabó (Noticias: «la policía tiene tu retrato»); a los RETRATO_DIFUNDE s sale en las noticias
//   («SE BUSCA»); en Ropa, ponerse una prenda de la mochila cambia la ropa del muñeco del jugador (y lo deja quieto unos
//   segundos) y el retrato guarda la ropa vieja;
// · de policía: los Avisos son los del motor; un ladrón con retrato sale en Retratos; «Difundir» lo difunde y un vecino
//   que lo ve avisa; el Censo encuentra a alguien de verdad y dice «mintió» con un nombre falso.
// Uso: node scripts/validar-menu.mjs [ciudad=1] [carpeta=/tmp] (con el servidor en 5180)
import {abrirNavegador} from './navegador.mjs';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [ciudad=1,OUT='/tmp']=process.argv.slice(2);const base='http://localhost:5180';
const N=await abrirNavegador();const fallas=[];
const listo=c=>`new Promise(r=>{const t=setInterval(()=>{const d=window.__demo;if(d?.world&&d.avatar&&d.soc&&(${c})){clearInterval(t);const st=document.createElement('style');st.textContent='.card{display:none!important}';document.head.appendChild(st);d.fijarHora(2,12);r(1);}},300);})`;
const tecla=c=>`(async()=>{window.dispatchEvent(new KeyboardEvent('keydown',{code:'${c}'}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'${c}'}));for(let k=0;k<8;k++)await new Promise(r=>requestAnimationFrame(r));})()`;
const pestaña=t=>`(async()=>{const b=[...document.querySelectorAll('.menu nav button')].find(b=>b.textContent.trim().startsWith('${t}'));b?.click();for(let k=0;k<6;k++)await new Promise(r=>requestAnimationFrame(r));return !!b;})()`;
try{
 // ===== de ladrón =====
 {const P=await N.abrir(`${base}/demo?jugadores=3&ciudad=${ciudad}`);await P.evaluar(listo('d.ronda'),{tiempo:240000});
  const captura=async n=>writeFileSync(join(OUT,n),Buffer.from(await P.captura(),'base64'));
  await P.evaluar(tecla('Tab'));for(let k=0;k<3;k++)await P.evaluar(`new Promise(r=>setTimeout(r,400))`);
  const a1=await P.evaluar(`({abierto:window.__demo.menuAbierto,vis:!!document.querySelector('.menu .panel'),tabs:[...document.querySelectorAll('.menu nav button')].map(b=>b.textContent.trim()),
   mapa:!!document.querySelector('.menu .mapa-juego canvas'),banda:document.querySelectorAll('.menu .punto.banda').length,guaridas:document.querySelectorAll('.menu .edif.guarida').length,
   motor:{banda:window.__demo.persec.P.agentes.filter(a=>a.equipo==='ladron').length,guaridas:window.__demo.persec.P.guaridas.length}})`);
  console.log('Tab:',JSON.stringify(a1));if(!a1.abierto||!a1.vis)fallas.push('de ladrón, Tab no abre el menú');if(a1.tabs.join()!=='Mapa,Botín,Ropa,Noticias,Equipo')fallas.push(`las pestañas del ladrón no son las del prototipo (${a1.tabs.join()})`);
  // (el mapa —2026-10-18—: abre primero, con un punto por cada uno de la banda y cada guarida pintada)
  if(!a1.mapa)fallas.push('de ladrón, el menú no abre en el mapa');if(a1.banda!==a1.motor.banda)fallas.push(`el mapa muestra ${a1.banda} de la banda y el motor tiene ${a1.motor.banda}`);if(!a1.guaridas)fallas.push('el mapa no pinta las guaridas');
  await P.evaluar(tecla('Tab'));if(await P.evaluar(`window.__demo.menuAbierto`))fallas.push('Tab no cierra el menú');
  // robar algo de un apartamento (como validar-ronda: pararse al lado y apretar E)
  const rob=await P.evaluar(`(async()=>{const d=window.__demo,w=d.world,R=d.ronda,cuadro=()=>new Promise(r=>requestAnimationFrame(r));
   for(const o of R.robables.filter(o=>o.lugar.lot!=null&&o.lugar.nivel>0).slice(0,30))for(const [dx,dz] of [[.9,0],[-.9,0],[0,.9],[0,-.9]]){const feet=(w.lots.get(o.lugar.lot)?.raise||0)+o.lugar.nivel*3+.02;
    for(let k=0;k<20;k++){Object.assign(d.player,{x:o.x+dx,z:o.z+dz,feet,vy:0,ground:true});d.euler.set(-.35,Math.atan2(-(o.x-o.x-dx),-(o.z-o.z-dz)),0,'YXZ');d.camera.quaternion.setFromEuler(d.euler);await cuadro();}
    const c=d.acciones.cerca();if(c?.ronda&&/^Robar/.test(c.texto)){window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE'}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyE'}));for(let k=0;k<8;k++)await cuadro();return {nombre:R.enMochila.at(-1)?.nombre,mochila:R.mochila};}}
   return null;})()`,{tiempo:120000});
  console.log('robado:',JSON.stringify(rob));if(!rob||!(rob.mochila>0))fallas.push('no se pudo robar en un apartamento');
  else{await P.evaluar(tecla('Tab'));await P.evaluar(pestaña('Botín'));const bot=await P.evaluar(`document.querySelector('.menu .lista')?.innerText||''`);console.log('Botín:',bot.replace(/\n/g,' · '));
   if(!bot.includes(rob.nombre))fallas.push('el Botín del menú no muestra lo robado');
   await P.evaluar(pestaña('Noticias'));const not1=await P.evaluar(`document.querySelector('.menu .cartel')?.innerText||''`);console.log('Noticias:',not1.replace(/\n/g,' · ').slice(0,160));
   if(!/RETRATO/.test(not1))fallas.push('robando en un edificio con cámara, el menú no dice que la policía tiene el retrato');
   // el tiempo pasa: a las noticias
   await P.evaluar(`(async()=>{const d=window.__demo;d.retratoLadron.t-=100;for(let k=0;k<40;k++)await new Promise(r=>requestAnimationFrame(r));})()`);
   const not2=await P.evaluar(`document.querySelector('.menu .cartel')?.innerText||''`);const tit=await P.evaluar(`document.querySelector('.menu .titulares')?.innerText||''`);
   console.log('después:',not2.split('\n')[0],'·',tit.split('\n').slice(0,2).join(' '));if(!/SE BUSCA/.test(not2)||!/SE BUSCA/.test(tit))fallas.push('el retrato no sale en las noticias');
   await new Promise(r=>setTimeout(r,2500));await captura('menu-noticias.png');
   // la ropa: ponerse la primera prenda de la mochila
   await P.evaluar(pestaña('Ropa'));const antes=await P.evaluar(`JSON.stringify(window.__demo.avatar.tpl.outfit)`);
   const pr=await P.evaluar(`(()=>{const b=[...document.querySelectorAll('.menu .prenda:not(.on):not(.nada):not(.quitar)')][0];if(!b)return null;const t=b.textContent.trim();b.click();return t;})()`);
   const ves=await P.evaluar(`(async()=>{const d=window.__demo,t0=performance.now();let q=false;while(performance.now()-t0<15000){await new Promise(r=>setTimeout(r,200));if(document.querySelector('.accion')?.innerText.includes('Cambiándote'))q=true;if(JSON.stringify(d.avatar.tpl.outfit)!==${JSON.stringify(antes)})break;}return {cambio:JSON.stringify(d.avatar.tpl.outfit)!==${JSON.stringify(antes)},quieto:q,retrato:d.retratoLadron.ropa,ahora:d.menuDatos?.ropa?.puesto}})()`,{tiempo:30000});
   console.log('se puso:',pr,'→',JSON.stringify({cambio:ves.cambio,quieto:ves.quieto,retrato:ves.retrato}));
   if(!pr)fallas.push('en Ropa no hay prendas en la mochila');else{if(!ves.cambio)fallas.push('ponerse una prenda no cambia la ropa del muñeco del jugador');if(!ves.quieto)fallas.push('cambiándose de ropa, no queda quieto');}
   // el color de lo puesto: tocar la prenda de arriba y elegir otro color
   await new Promise(r=>setTimeout(r,4500));
   const col=await P.evaluar(`(async()=>{const d=window.__demo,c0=d.avatar.tpl.outfit.top?.color;const b=[...document.querySelectorAll('.menu .parte')][0]?.querySelector('.prenda.on');if(!b)return null;b.click();for(let k=0;k<6;k++)await new Promise(r=>requestAnimationFrame(r));
    const sw=[...document.querySelectorAll('.menu .paleta button')].find(x=>!x.classList.contains('on'));if(!sw)return {sinPaleta:true};const quiero=sw.getAttribute('aria-label').replace('color ','');sw.click();
    const t0=performance.now();while(performance.now()-t0<15000){await new Promise(r=>setTimeout(r,200));if(d.avatar.tpl.outfit.top?.color===quiero)break;}return {antes:c0,quiero,ahora:d.avatar.tpl.outfit.top?.color}})()`,{tiempo:30000});
   console.log('color:',JSON.stringify(col));if(!col||col.sinPaleta)fallas.push('tocar la prenda puesta no abre la paleta de colores');else if(col.ahora!==col.quiero)fallas.push('elegir un color no tiñe la prenda del muñeco del jugador');
   await new Promise(r=>setTimeout(r,2500));await captura('menu-ropa.png');}
  const e=(typeof P.errores==='function'?P.errores():P.errores)||[];for(const x of e.slice(0,3))fallas.push('error en la página (ladrón): '+String(x).slice(0,160));}
 // ===== de policía =====
 {const P=await N.abrir(`${base}/demo?papel=policia&jugadores=3&ciudad=${ciudad}`);await P.evaluar(listo('d.persec?.listo'),{tiempo:240000});
  const captura=async n=>writeFileSync(join(OUT,n),Buffer.from(await P.captura(),'base64'));
  // adelantar el motor hasta que haya avisos, y marcar a un ladrón libre
  const pre=await P.evaluar(`(()=>{const d=window.__demo,P=d.persec.P;let k=0;while(P.avisos.length<2&&k<1200&&!P.fin){d.persec.update(.25);k++;}const a=P.agentes.find(a=>a.equipo==='ladron'&&a.estado==='libre');if(a)a.retrato=true;return {avisos:P.avisos.length,ladron:a?.id}})()`);
  await P.evaluar(tecla('Tab'));for(let k=0;k<3;k++)await P.evaluar(`new Promise(r=>setTimeout(r,400))`);
  const mp=await P.evaluar(`({mapa:!!document.querySelector('.menu .mapa-juego canvas'),equipo:document.querySelectorAll('.menu .punto.poli').length,motor:window.__demo.persec.P.agentes.filter(a=>a.equipo==='policia').length,
   vivos:document.querySelectorAll('.menu .punto.visto.vivo').length,motorVivos:window.__demo.persec.mapa().vivos.length})`);
  console.log('policía, mapa:',JSON.stringify(mp));if(!mp.mapa)fallas.push('de policía, el menú no abre en el mapa');if(mp.equipo!==mp.motor)fallas.push(`el mapa muestra ${mp.equipo} policías y el motor tiene ${mp.motor}`);
  if(mp.vivos!==mp.motorVivos)fallas.push(`el mapa muestra ${mp.vivos} «?» en vivo y el motor tiene ${mp.motorVivos}`);
  await P.evaluar(pestaña('Avisos'));const av=await P.evaluar(`({n:document.querySelectorAll('.menu .avisos li').length,tabs:[...document.querySelectorAll('.menu nav button')].map(b=>b.textContent.trim())})`);
  console.log('policía, Tab:',JSON.stringify({...av,motor:pre.avisos}));if(av.tabs.join()!=='Mapa,Avisos,Retratos,Censo,Equipo')fallas.push('las pestañas de la policía no son las del prototipo');if(av.n!==pre.avisos)fallas.push(`Avisos muestra ${av.n} y el motor tiene ${pre.avisos}`);
  await P.evaluar(pestaña('Retratos'));const rt=await P.evaluar(`document.querySelector('.menu .retratos')?.innerText||''`);console.log('Retratos:',rt.replace(/\n/g,' · ').slice(0,200));
  if(!/piel/.test(rt))fallas.push('el ladrón con retrato no sale en Retratos');
  const dif=await P.evaluar(`(async()=>{const b=[...document.querySelectorAll('.menu .retratos button')].find(b=>b.textContent.trim()==='Difundir'&&!b.disabled);if(!b)return null;b.click();for(let k=0;k<6;k++)await new Promise(r=>requestAnimationFrame(r));return {dif:[...window.__demo.persec.difundidos],btn:document.querySelector('.menu .retratos button')?.textContent.trim()}})()`);
  console.log('difundir:',JSON.stringify(dif));if(!dif?.dif.length)fallas.push('«Difundir» no difunde el retrato');
  await captura('menu-policia.png');
  // un vecino lo ve: el ladrón al lado de alguien de la calle
  if(dif?.dif.length){await P.evaluar(tecla('Tab'));await P.evaluar(`window.__demo.fijarHora(0,15)`);
   const vec=await P.evaluar(`(async()=>{const d=window.__demo,P=d.persec.P,a=P.agentes.find(b=>b.id===${JSON.stringify(dif.dif[0])}),cuadro=()=>new Promise(r=>requestAnimationFrame(r));
    const l=[...d.soc.S.lugares.values()].find(l=>l.tipo==='colegio'),q=d.soc.T.puntos(l.id)[0];Object.assign(d.player,{x:q[0],z:q[1],vy:0,ground:true});for(let k=0;k<60;k++)await cuadro();
    const n0=P.avisos.filter(x=>x.tipo==='vecino').length;for(let k=0;k<60;k++){const g=d.soc.personas()[0];if(g&&a.estado==='libre'){a.x=g.x+2;a.z=g.z;a.decide=Infinity;a.accion=null;a.ruta=null;}await cuadro();if(P.avisos.filter(x=>x.tipo==='vecino').length>n0)break;}
    a.decide=0;return {vecino:P.avisos.filter(x=>x.tipo==='vecino').length-n0,gente:d.soc.personas().length}})()`,{tiempo:60000});
   console.log('vecino:',JSON.stringify(vec));if(!(vec.vecino>0))fallas.push('un vecino que ve a un difundido no avisa');await P.evaluar(tecla('Tab'));}
  // el censo
  await P.evaluar(pestaña('Censo'));const real=await P.evaluar(`window.__demo.soc.S.personas.find(p=>p.edad>30).nombre`);
  const c1=await P.evaluar(`(async()=>{const i=document.querySelector('.menu .buscar input');i.value=${JSON.stringify(real)};i.dispatchEvent(new Event('input'));for(let k=0;k<6;k++)await new Promise(r=>requestAnimationFrame(r));const a=document.querySelector('.menu .cuerpo')?.innerText||'';
   i.value='Zzyx Qwerty';i.dispatchEvent(new Event('input'));for(let k=0;k<6;k++)await new Promise(r=>requestAnimationFrame(r));return {real:a.includes('vive en'),falso:/mintió/.test(document.querySelector('.menu .cuerpo')?.innerText||'')}})()`);
  console.log('censo:',real,JSON.stringify(c1));if(!c1.real)fallas.push('el Censo no encuentra a una persona de verdad');if(!c1.falso)fallas.push('el Censo no avisa que un nombre falso no existe');
  const e=(typeof P.errores==='function'?P.errores():P.errores)||[];for(const x of e.slice(0,3))fallas.push('error en la página (policía): '+String(x).slice(0,160));}}
catch(err){fallas.push('el validador se cortó: '+String(err?.message||err).slice(0,200));}
finally{console.log(`menú · ciudad ${ciudad} · Tab, botín, noticias, ropa, avisos, retratos, difundir y censo: ${fallas.length?'con fallas':'todo'}`);console.log(`fallas: ${fallas.length}`);for(const f of fallas)console.log('  '+f);await N.cerrar();process.exit(0);}
