// Nivel 10 del probador: la sociedad en el 3D (2026-10-17, etapa 2), sin pantalla. Abre /demo (el ladrón) y revisa:
// · la hora de la ciudad en el panel (día y hora), y que corre: un minuto real es una hora;
// · un lunes a las 15 (salen del colegio) hay gente de las familias caminando cerca del colegio; a las 3 de la mañana
//   no hay nadie en la calle;
// · al lado de alguien, el cartel con lo que se ve de él (2026-10-18, identidad.js): su aspecto, nunca su nombre ni su
//   oficio —el nombre se sabe pidiendo papeles—;
// · la puerta de un local: a las 3 de la mañana está trancada (caminando hacia ella con W no se pasa) y a mediodía no.
// Captura a las 15 cerca del colegio, con el cartel, y frente al local cerrado.
// Uso: node scripts/validar-gente.mjs [ciudad=1] [carpeta=/tmp] (con el servidor en 5180)
import {abrirNavegador} from './navegador.mjs';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [ciudad=1,OUT='/tmp']=process.argv.slice(2);const base='http://localhost:5180';
const N=await abrirNavegador();const fallas=[];
try{const P=await N.abrir(`${base}/demo?jugadores=3&ciudad=${ciudad}`);
 await P.evaluar(`new Promise(r=>{const t=setInterval(()=>{const d=window.__demo;if(d?.world&&d.ronda&&d.soc&&d.cierres&&d.avatar){clearInterval(t);const st=document.createElement('style');st.textContent='.card{display:none!important}';document.head.appendChild(st);r(1);}},300);})`,{tiempo:240000});
 const captura=async n=>writeFileSync(join(OUT,n),Buffer.from(await P.captura(),'base64'));
 const espera=ms=>P.evaluar(`new Promise(r=>setTimeout(r,${ms}))`);
 // pararse en (x, z) mirando a (mx, mz)
 const ir=(x,z,mx,mz,n=20)=>P.evaluar(`(async()=>{const d=window.__demo,w=d.world,p=d.player;const piso=(x,z)=>{const s=w.size;return x>=0&&z>=0&&x<=s.w&&z<=s.h?w.groundAt(x,z):d.island.ground(x,z);};
  for(let k=0;k<${n};k++){Object.assign(p,{x:${x},z:${z},feet:piso(${x},${z}),vy:0,ground:true,caidaDesde:null});d.euler.set(-.25,Math.atan2(-(${mx}-${x}),-(${mz}-${z})),0,'YXZ');d.camera.quaternion.setFromEuler(d.euler);await new Promise(r=>requestAnimationFrame(r));}})()`,{tiempo:60000});
 // la hora
 const {h0,h1,dt}=await P.evaluar(`(async()=>{const d=window.__demo,t0=performance.now(),h0=d.hora;await new Promise(r=>setTimeout(r,4000));return {h0,h1:d.hora,dt:(performance.now()-t0)/1000}})()`);const hud=await P.evaluar(`document.querySelector('.ronda')?.innerText||''`);
 console.log('hora:',h0,'→',h1,`(${dt.toFixed(1)} s reales)`);if(!/^(lunes|martes|miércoles|jueves|viernes|sábado|domingo) \d\d:\d\d$/.test(h0||''))fallas.push(`la hora no se ve bien («${h0}»)`);
 if(!hud.includes('Hora'))fallas.push('el panel no muestra la hora');
 const min=t=>{const [a,b]=t.split(' ')[1].split(':').map(Number);return a*60+b;};if(h0&&h1&&Math.abs((min(h1)-min(h0)+1440)%1440-dt)>2)fallas.push(`la hora no corre a un minuto por segundo (${h0} → ${h1})`);
 // un lunes a las 15, cerca del colegio
 const col=await P.evaluar(`(()=>{const l=[...window.__demo.soc.S.lugares.values()].find(l=>l.tipo==='colegio');return {x:l.x,z:l.z}})()`);
 await P.evaluar(`window.__demo.fijarHora(0,15)`);
 // (pararse en la calle frente al colegio: el punto de afuera más cercano a su centro)
 const fuera=await P.evaluar(`(()=>{const d=window.__demo,S=d.soc.S,l=[...S.lugares.values()].find(l=>l.tipo==='colegio');const q=d.soc.T.puntos(l.id)[0];return {x:q[0],z:q[1]}})()`);
 await ir(fuera.x,fuera.z,col.x,col.z,90);
 const g15=await P.evaluar(`(()=>{const d=window.__demo;return {n:d.soc.personas().length,caminan:d.soc.personas().filter(p=>p.camina).length,dibujados:d.scene.getObjectByName('sociedad').children.filter(c=>c.visible).length,adentro:d.soc.adentroDe().length}})()`);
 console.log('lunes 15:00 junto al colegio:',JSON.stringify(g15));if(g15.n<5)fallas.push(`casi nadie en la calle a la salida del colegio (${g15.n})`);if(g15.dibujados!==g15.n+g15.adentro)fallas.push('no todos los de la calle están dibujados');
 // el caminar en el 3D (2026-10-17): durante 5 s, nadie encima de otro (salvo en el vano de una puerta) y nadie corre
 const cam=await P.evaluar(`(async()=>{const d=window.__demo,g=d.scene.getObjectByName('sociedad');let enc=0,muestras=0,corren=0,pers=0;
  for(let k=0;k<20;k++){await new Promise(r=>setTimeout(r,250));const L=[...g.children].filter(c=>c.visible).map(c=>c.position);pers+=L.length;muestras++;
   const A=d.soc.T?null:null;for(let i=0;i<L.length;i++)for(let j=i+1;j<L.length;j++)if(Math.hypot(L[i].x-L[j].x,L[i].z-L[j].z)<.4&&Math.abs(L[i].y-L[j].y)<1)enc++;}
  return {enc,pers,muestras}})()`,{tiempo:30000});
 console.log('caminar en el 3D:',JSON.stringify(cam));if(cam.enc/Math.max(1,cam.pers)>.08)fallas.push(`en el 3D hay gente encimada (${cam.enc} pares en ${cam.muestras} muestras)`);
 // el cartel: pegado a uno que camina
 const q=await P.evaluar(`(async()=>{const d=window.__demo,cuadro=()=>new Promise(r=>requestAnimationFrame(r));let o=null;
  for(let k=0;k<40;k++){const L=d.soc.personas();o=(o&&L.find(x=>x.id===o.id))||L.find(x=>x.camina)||L[0];if(!o)break;
   Object.assign(d.player,{x:o.x+1.2,z:o.z,vy:0,ground:true});d.euler.set(-.2,Math.PI/2,0,'YXZ');d.camera.quaternion.setFromEuler(d.euler);await cuadro();}
  await new Promise(r=>setTimeout(r,300));const cartel=document.querySelector('.quien')?.innerText||'';return {cartel,quien:d.quien&&JSON.parse(JSON.stringify(d.quien))}})()`,{tiempo:60000});
 console.log('cartel:',JSON.stringify(q.cartel));
 if(!q.quien)fallas.push('al lado de alguien no sale el cartel');
 else{const malo=await P.evaluar(`(()=>{const q=${JSON.stringify(q.quien)},txt=q.nombre+' '+q.oficio;return window.__demo.soc.S.personas.filter(p=>txt.includes(p.nombre)).length})()`);console.log('cartel (aspecto):',JSON.stringify(q.quien));
  if(malo||q.quien.edad!=null)fallas.push('el cartel dice el nombre o la edad de alguien sin pedirle los papeles');if(!/^(Hombre|Mujer|Niño|Niña|Agente)/.test(q.quien.nombre||''))fallas.push('el cartel no describe el aspecto: '+q.quien.nombre);
  await captura('gente-cartel.png');}
 await ir(fuera.x,fuera.z,col.x,col.z,30);await captura('gente-15h.png');
 // adentro de los lugares: un lunes a las 11, gente en el colegio (en su lote, a la altura de un piso)
 await P.evaluar(`window.__demo.fijarHora(0,11)`);await ir(fuera.x,fuera.z,col.x,col.z,40);
 const a11=await P.evaluar(`(()=>{const d=window.__demo,S=d.soc.S,L=d.plan.lots,A=d.soc.adentroDe();let fuera=0,piso=0;for(const o of A){const l=S.lugares.get(o.lugar),R=L[l.lote].rect;if(!(o.x>R.x&&o.x<R.x+R.w&&o.z>R.y&&o.z<R.y+R.h))fuera++;const raise=d.world.lots.get(l.lote)?.raise||0;if(Math.abs(((o.y-raise-.02)/3)-Math.round((o.y-raise-.02)/3))>.01)piso++;}
  const por={};for(const o of A){const t=S.lugares.get(o.lugar).tipo;por[t]=(por[t]||0)+1;}return {n:A.length,por,fuera,piso,ej:A.slice(0,2).map(o=>o.que)}})()`);
 console.log('lunes 11:00 adentro, cerca del colegio:',JSON.stringify(a11));if(!a11.por.colegio)fallas.push('un lunes a las 11 no se ve a nadie adentro del colegio');if(a11.fuera)fallas.push(`${a11.fuera} de los de adentro quedan fuera de su lote`);if(a11.piso)fallas.push(`${a11.piso} de los de adentro no están a la altura de un piso`);
 await captura('gente-adentro.png');
 // a las 3 de la mañana: nadie
 await P.evaluar(`window.__demo.fijarHora(1,3)`);await ir(fuera.x,fuera.z,col.x,col.z,30);
 await new Promise(r=>setTimeout(r,800));const g3=await P.evaluar(`({calle:window.__demo.soc.personas().length,adentro:window.__demo.soc.adentroDe().filter(o=>window.__demo.soc.S.lugares.get(o.lugar).tipo==='colegio').length})`);console.log('martes 03:00 junto al colegio:',JSON.stringify(g3));if(g3.calle>0)fallas.push(`hay ${g3.calle} en la calle a las 3 de la mañana`);if(g3.adentro>0)fallas.push(`hay ${g3.adentro} en el colegio a las 3 de la mañana`);
 // la puerta de un local: cerrada de madrugada, abierta a mediodía
 const pu=await P.evaluar(`(()=>{const d=window.__demo,S=d.soc.S;return d.cierres.todas.filter(p=>['panaderia','heladeria','pizzeria','fruteria'].includes(S.lugares.get(p.lugar).tipo)).slice(0,8).map(p=>({id:p.id,lugar:p.lugar,mx:(p.x0+p.x1)/2,mz:(p.z0+p.z1)/2,y:p.y,h:Math.abs(p.z1-p.z0)<1e-6}))})()`);
 const empujar=async(p,dia,h)=>{await P.evaluar(`window.__demo.fijarHora(${dia},${h})`);
  // (afuera: del lado de la calle; se prueba a .9 m de cada lado y se queda el que no está adentro de un lote)
  return P.evaluar(`(async()=>{const d=window.__demo,w=d.world,cuadro=()=>new Promise(r=>requestAnimationFrame(r)),p=${JSON.stringify(p)};
   const lados=p.h?[[0,.9],[0,-.9]]:[[.9,0],[-.9,0]];let s=null;for(const [a,b] of lados){const x=p.mx+a,z=p.mz+b;if(!d.plan.lots.some(L=>L.rect&&x>L.rect.x&&x<L.rect.x+L.rect.w&&z>L.rect.y&&z<L.rect.y+L.rect.h)){s={x,z,ux:-a,uz:-b};break;}}if(!s)return null;
   Object.assign(d.player,{x:s.x,z:s.z,feet:p.y,vy:0,ground:true,caidaDesde:null});d.euler.set(-.15,Math.atan2(-s.ux,-s.uz),0,'YXZ');d.camera.quaternion.setFromEuler(d.euler);for(let k=0;k<70;k++)await cuadro();
   d.keys.add('KeyW');const t0=performance.now();while(performance.now()-t0<1500)await cuadro();d.keys.delete('KeyW');
   const paso=((d.player.x-p.mx)*s.ux+(d.player.z-p.mz)*s.uz)/.9;return {paso:+paso.toFixed(2),cerrada:d.cierres.puertas.some(q=>q.id===p.id),hora:d.hora}})()`,{tiempo:60000});};
 let probada=null;for(const p of pu){const noche=await empujar(p,1,3);if(!noche)continue;await captura('gente-local-cerrado.png');const dia=await empujar(p,1,12.5);probada={p:p.lugar,noche,dia};break;}
 console.log('local:',JSON.stringify(probada));
 if(!probada)fallas.push('ningún local para probar su puerta');
 else{if(!probada.noche.cerrada||probada.noche.paso>.3)fallas.push('de madrugada la puerta del local no está trancada');if(probada.dia.cerrada||probada.dia.paso<.4)fallas.push('a mediodía la puerta del local no deja pasar');}
 const e=(typeof P.errores==='function'?P.errores():P.errores)||[];for(const x of e.slice(0,3))fallas.push('error en la página: '+String(x).slice(0,160));}
catch(err){fallas.push('el validador se cortó: '+String(err?.message||err).slice(0,200));}
finally{console.log(`gente · ciudad ${ciudad} · la hora, la gente de las familias, su cartel y los locales cerrados: ${fallas.length?'con fallas':'todo'}`);console.log(`fallas: ${fallas.length}`);for(const f of fallas)console.log('  '+f);await N.cerrar();process.exit(0);}
