// Nivel 10 del probador: de policía contra los ladrones bots del motor, en el 3D, sin pantalla (2026-10-17, REGLAS.md
// paso 3). Abre /demo?papel=policia y revisa, apretando las teclas como el jugador:
// · el jugador sale uniformado de la comisaría y los bots del motor están dibujados (un muñeco por bot);
// · el motor corre: adelantándolo, hay un robo con su punto (aviso) y el que lo hizo;
// · en el lugar del aviso se ofrece «Revisar la cámara»; con E, el retrato (los rasgos) en el panel;
// · junto a ese ladrón se ofrece «Atrapar»; con E, preso (si llevaba botín) o detenido;
// · junto a un ladrón sin retrato se ofrece «Pedir papeles»; con E, el policía queda quieto y después contesta;
// · al llegar los ladrones a la meta, el cartel del final.
// Captura en la cámara, al atrapar y en el final.
// Uso: node scripts/validar-policia.mjs [ciudad=1] [carpeta=/tmp] (con el servidor en 5180)
import {abrirNavegador} from './navegador.mjs';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [ciudad=1,OUT='/tmp']=process.argv.slice(2);const base='http://localhost:5180';
const N=await abrirNavegador();const fallas=[];
try{const P=await N.abrir(`${base}/demo?papel=policia&jugadores=3&ciudad=${ciudad}`);
 await P.evaluar(`new Promise(r=>{const t=setInterval(()=>{const d=window.__demo;if(d?.world&&d.acciones&&d.persec?.listo&&d.avatar){clearInterval(t);const st=document.createElement('style');st.textContent='.card{display:none!important}';document.head.appendChild(st);r(1);}},300);})`,{tiempo:240000});
 const cuadros=n=>P.evaluar(`(async()=>{for(let k=0;k<${n};k++)await new Promise(r=>requestAnimationFrame(r));})()`);
 const tecla=c=>P.evaluar(`(async()=>{window.dispatchEvent(new KeyboardEvent('keydown',{code:'${c}'}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'${c}'}));for(let k=0;k<6;k++)await new Promise(r=>requestAnimationFrame(r));return document.querySelector('.r-msg')?.textContent||null;})()`);
 const captura=async n=>writeFileSync(join(OUT,n),Buffer.from(await P.captura(),'base64'));
 // pararse en (x, z) en la calle, mirando a (mx, mz); «seguir»: el id de un bot al que se le pega cada cuadro
 const ir=(x,z,mx,mz,seguir='')=>P.evaluar(`(async()=>{const d=window.__demo,w=d.world,p=d.player;let x=${x},z=${z};
  const piso=(x,z)=>{const s=w.size;return x>=0&&z>=0&&x<=s.w&&z<=s.h?w.groundAt(x,z):d.island.ground(x,z);};
  for(let k=0;k<24;k++){const a=${JSON.stringify(seguir)}&&d.persec.P.agentes.find(b=>b.id===${JSON.stringify(seguir)});if(a){x=a.x+.4;z=a.z;}
   Object.assign(p,{x,z,feet:piso(x,z),vy:0,ground:true,caidaDesde:null});d.euler.set(-.3,Math.atan2(-(${mx}-x),-(${mz}-z)),0,'YXZ');d.camera.quaternion.setFromEuler(d.euler);await new Promise(r=>requestAnimationFrame(r));}
  return document.querySelector('.accion')?.innerText||'';})()`,{tiempo:60000});
 // adelantar el motor (como si pasara el tiempo) hasta que se cumpla una condición sobre P
 const adelantar=(cond,max=300)=>P.evaluar(`(()=>{const d=window.__demo,P=d.persec.P;let k=0;while(!(${cond})&&k<${max}*4&&!P.fin){d.persec.update(.25);k++;}return {t:P.t,ok:!!(${cond})};})()`);
 const ini=await P.evaluar(`(()=>{const d=window.__demo,g=d.scene.getObjectByName('persecucion'),P=d.persec.P;return {avatar:d.avatar.tpl?.name,muñecos:g?.children.length,bots:P.agentes.filter(a=>!a.humano).length,humano:P.agentes.filter(a=>a.humano).map(a=>a.id),hud:document.querySelectorAll('.ronda').length}})()`);
 console.log('al empezar:',JSON.stringify(ini));
 if(!/BlueSoldier/.test(ini.avatar||''))fallas.push(`el jugador no va uniformado (${ini.avatar})`);
 if(ini.muñecos!==ini.bots)fallas.push(`hay ${ini.muñecos} muñecos para ${ini.bots} bots`);
 if(ini.humano.length!==1)fallas.push('el motor no tiene un policía humano');
 if(!ini.hud)fallas.push('no hay panel de la policía');
 // un robo con su autor
 const r1=await adelantar(`P.avisos.some(a=>a.quien&&P.agentes.find(b=>b.id===a.quien)?.estado==='libre')`);
 console.log('primer aviso a los',r1.t,'s');
 if(!r1.ok)fallas.push('el motor no dio ningún aviso con autor libre en la ronda');
 else{const av=await P.evaluar(`(()=>{const P=window.__demo.persec.P,i=P.avisos.findIndex(a=>a.quien&&P.agentes.find(b=>b.id===a.quien)?.estado==='libre');const a=P.avisos[i];return {i,x:a.x,z:a.z,tipo:a.tipo,quien:a.quien}})()`);
  await P.evaluar(`new Promise(r=>setTimeout(r,600))`);const mapa=await P.evaluar(`window.__demo.policia.avisos.length`);if(!(mapa>0))fallas.push('el aviso no llega al panel ni al plano');
  // en el lugar del aviso: «Revisar la cámara» (desde un poco al costado, que puede ser adentro de algo)
  let txt='';for(const [dx,dz] of [[0,0],[3,0],[-3,0],[0,3],[0,-3]]){txt=await ir(av.x+dx,av.z+dz,av.x,av.z);if(/Revisar la cámara/.test(txt))break;}
  console.log(`en el aviso (${av.tipo}):`,txt.replace(/\n/g,' '));if(!/Revisar la cámara/.test(txt))fallas.push('en el lugar del aviso no se ofrece «Revisar la cámara»');
  else{const m=await tecla('KeyE');console.log('cámara:',m);await cuadros(20);
   const ret=await P.evaluar(`(()=>{const d=window.__demo;return {retrato:d.persec.P.agentes.find(a=>a.id===${JSON.stringify(av.quien)}).retrato,panel:document.querySelector('.r-retratos')?.innerText||''}})()`);
   console.log('retrato:',JSON.stringify(ret));if(!ret.retrato||!/piel/.test(ret.panel))fallas.push('revisar la cámara no dio el retrato en el panel');await captura('policia-camara.png');
   // atrapar al del retrato: pegado a él (si está adentro de algo, se espera a que salga)
   // (hasta 3 intentos: con la máquina cargada, el ladrón alcanza a meterse a un lugar mientras se lo sigue)
   let t2='';for(let k=0;k<3&&!/Atrapar/.test(t2);k++){await adelantar(`P.agentes.find(b=>b.id===${JSON.stringify(av.quien)}).estado==='libre'`,60);t2=await ir(0,0,0,0,av.quien);}console.log('junto al ladrón:',t2.replace(/\n/g,' '));
   if(!/Atrapar/.test(t2))fallas.push('junto al ladrón con retrato no se ofrece «Atrapar»');
   else{const lleva=await P.evaluar(`window.__demo.persec.P.agentes.find(b=>b.id===${JSON.stringify(av.quien)}).mochila`);const m2=await tecla('KeyE');
    const est=await P.evaluar(`window.__demo.persec.P.agentes.find(b=>b.id===${JSON.stringify(av.quien)}).estado`);console.log('atrapar:',m2,'→',est,'(llevaba',lleva,')');
    if(est!==(lleva>0?'preso':'detenido'))fallas.push(`atrapar dejó al ladrón «${est}» (llevaba ${lleva})`);await cuadros(10);await captura('policia-atrapar.png');}}}
 // pedir papeles a un ladrón sin retrato
 // entrar persiguiendo: un ladrón se mete a su guarida con el policía en la puerta → la puerta queda abierta; adentro,
 // junto a la caja, «Registrar la guarida» lo requisa
 {const g=await P.evaluar(`(async()=>{const d=window.__demo,P=d.persec.P,m=await import('/src/engine/juego/partida.js');
   const a=P.agentes.find(a=>a.equipo==='ladron'&&a.estado!=='preso')||P.agentes.find(a=>a.equipo==='ladron');a.estado='libre';a.lugar=null;a.retrato=false;
   /* (una guarida sin delatar: en una delatada la policía bot vigila la puerta y, con la orden, allana y requisa al que entra —2026-10-18—) */
   const i=Math.max(0,P.guaridas.findIndex(L=>!L.delatada)),L=P.guaridas[i];L.delatada=null;L.cerrada=false;const [px,pz]=L.puntos[0];
   for(const c of P.agentes)if(c.equipo==='policia'&&!c.humano){const [cx,cz]=P.C.comisaria.puntos[0];Object.assign(c,{tarea:null,ruta:null,x:cx,z:cz,decide:Infinity});}/* (los policías bot, quietos en la comisaría: uno que patrulla o vigila esa puerta lo atrapaba antes de entrar —según el azar de la ronda—; acá se prueba al jugador) */a.x=px+2;a.z=pz;m.empezar(P,a,'esconder',L,{quedarse:60});a.decide=Infinity;/* (que el bot no le cambie la orden mientras dura la prueba) */
   Object.assign(d.player,{x:px,z:pz,vy:0,ground:true});const fin0=P.fin,t0=P.t;let k=0;while(a.estado!=='adentro'&&k<200){d.persec.update(.25);d.player.x=px;d.player.z=pz;k++;}
   await new Promise(r=>setTimeout(r,400));const gg=d.cerraduras.guaridas[i];return {diag:d.persec._diag,fin0,t0,fin:P.fin,px,pz,ax:a.x,az:a.z,id:a.id,adentro:a.estado==='adentro',abierta:d.persec.abiertas.has(i),puerta:d.cerraduras.abiertas.has(gg.vivienda),caja:gg.caja,lugar:gg.lugar,msg:document.querySelector('.r-msg')?.textContent||''}})()`,{tiempo:60000});
  console.log('entrar persiguiendo:',JSON.stringify({...g,caja:undefined}));
  if(!g.adentro)fallas.push('el ladrón no llegó a meterse a su guarida');else if(!g.abierta||!g.puerta)fallas.push('el ladrón se metió a su guarida con el policía encima y la puerta no quedó abierta');
  else{const r=await P.evaluar(`(async()=>{const d=window.__demo,c=${JSON.stringify(g.caja)},cuadro=()=>new Promise(r=>requestAnimationFrame(r));let txt='';
    for(const [dx,dz] of [[.9,0],[-.9,0],[0,.9],[0,-.9]]){Object.assign(d.player,{x:c.x+dx,z:c.z+dz,feet:c.y,vy:0,ground:true,caidaDesde:null});for(let k=0;k<15;k++)await cuadro();txt=document.querySelector('.accion')?.innerText||'';if(/Registrar/.test(txt))break;}
    if(!/Registrar/.test(txt))return {txt};window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE'}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyE'}));for(let k=0;k<6;k++)await cuadro();
    return {txt,msg:document.querySelector('.r-msg')?.textContent||'',estado:d.persec.P.agentes.find(a=>a.id===${JSON.stringify(g.id)}).estado}})()`,{tiempo:60000});
   await P.evaluar(`(()=>{const a=window.__demo.persec.P.agentes.find(a=>a.id===${JSON.stringify(g.id)});a.decide=0;for(const c of window.__demo.persec.P.agentes)if(c.equipo==='policia'&&!c.humano)c.decide=0;})()`);
   console.log('registrar:',JSON.stringify(r));if(!/Registrar/.test(r.txt))fallas.push('junto a la caja de la guarida abierta no se ofrece «Registrar la guarida»');
   else{if(!['preso','detenido'].includes(r.estado))fallas.push(`registrar la guarida no atrapó al de adentro (${r.estado})`);await captura('policia-guarida.png');}}}
 await adelantar(`P.agentes.some(a=>a.equipo==='ladron'&&a.estado==='libre')`,90);
 const otro=await P.evaluar(`(()=>{const P=window.__demo.persec.P;const a=P.agentes.find(a=>a.equipo==='ladron'&&a.estado==='libre');if(a){a.retrato=false;a.mochila=0;}/* (sin marca ni botín: así se prueba el censo; los policías bots ya pueden haberlo marcado) */return a?.id||null})()`);
 if(!otro)console.log('papeles: no hay ladrón libre sin retrato (no se prueba)');
 else{const t3=await ir(0,0,0,0,otro);console.log('junto a otro ladrón:',t3.replace(/\n/g,' '));
  if(!/Pedir papeles/.test(t3))fallas.push('junto a un ladrón sin retrato no se ofrece «Pedir papeles»');
  else{await tecla('KeyE');const q=await P.evaluar(`window.__demo.persec.quieto()`);
   const fin=await P.evaluar(`(async()=>{const d=window.__demo,t0=performance.now();let msg='';while(d.persec.quieto()&&performance.now()-t0<8000)await new Promise(r=>requestAnimationFrame(r));for(let k=0;k<20;k++){await new Promise(r=>requestAnimationFrame(r));msg=document.querySelector('.r-msg')?.textContent||msg;if(/censo|botín|Se fue/.test(msg))break;}return {quieto:d.persec.quieto(),msg,marcado:d.persec.P.agentes.find(a=>a.id===${JSON.stringify(otro)}).retrato}})()`,{tiempo:20000});
   console.log('papeles:',q?'quieto':'NO quieto','→',JSON.stringify(fin));if(!q)fallas.push('pedir papeles no deja al policía quieto');if(fin.quieto||!/no aparece en el censo|botín/.test(fin.msg))fallas.push('pedir papeles al ladrón no lo delata (ni el censo ni el botín)');else if(/censo/.test(fin.msg)&&!fin.marcado)fallas.push('el ladrón que no está en el censo no queda marcado');}}
 // pedir papeles a uno de la calle (la sociedad): quién es, en qué trabaja y dónde vive
 {await P.evaluar(`window.__demo.fijarHora(0,15)`);const col=await P.evaluar(`(()=>{const d=window.__demo,l=[...d.soc.S.lugares.values()].find(l=>l.tipo==='colegio'),q=d.soc.T.puntos(l.id)[0];return {x:q[0],z:q[1]}})()`);
  await ir(col.x,col.z,col.x+1,col.z);await cuadros(60);
  const v=await P.evaluar(`(async()=>{const d=window.__demo,cuadro=()=>new Promise(r=>requestAnimationFrame(r));let o=null,txt='';
   for(let k=0;k<60;k++){const L=d.soc.personas();o=(o&&L.find(x=>x.id===o.id))||L.find(x=>x.camina);if(!o)break;Object.assign(d.player,{x:o.x+.8,z:o.z,vy:0,ground:true});await cuadro();txt=document.querySelector('.accion')?.innerText||'';
    if(/Pedir papeles/.test(txt)&&!d.persec.P.agentes.some(a=>!a.humano&&Math.hypot(a.x-d.player.x,a.z-d.player.z)<2))break;}
   if(!/Pedir papeles/.test(txt))return {txt};window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE'}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyE'}));
   for(let k=0;k<5;k++)await cuadro();const q=d.persec.quieto();const t0=performance.now();let msg='';while(performance.now()-t0<8000){await cuadro();msg=document.querySelector('.r-msg')?.textContent||msg;if(/vive en/.test(msg))break;}
   return {txt,quieto:q,msg};})()`,{tiempo:60000});
  console.log('papeles a un vecino:',JSON.stringify(v));if(!/Pedir papeles/.test(v.txt||''))fallas.push('junto a uno de la calle no se ofrece «Pedir papeles»');else{if(!v.quieto)fallas.push('pidiendo papeles al vecino, el policía no queda quieto');if(!/Papeles en orden: .+ · vive en .+/.test(v.msg))fallas.push('los papeles del vecino no dicen quién es y dónde vive');else await captura('policia-papeles-vecino.png');}}
 // las viviendas trancadas: parado en el pasillo frente a la puerta de un apartamento, caminando hacia ella con W, no pasa
 const pu=await P.evaluar(`(async()=>{const d=window.__demo,R=d.cerraduras,w=d.world,cuadro=()=>new Promise(r=>requestAnimationFrame(r)),out=[];if(!R)return null;
  for(const p of R.puertas.filter(p=>p.tipo==='apto'&&p.y!=null).slice(0,6)){const mx=(p.x0+p.x1)/2,mz=(p.z0+p.z1)/2,ux=mx-p.x,uz=mz-p.z,L=Math.hypot(ux,uz)||1;
   Object.assign(d.player,{x:p.x,z:p.z,feet:p.y,vy:0,ground:true,caidaDesde:null});d.euler.set(-.2,Math.atan2(-ux,-uz),0,'YXZ');d.camera.quaternion.setFromEuler(d.euler);
   for(let k=0;k<5;k++)await cuadro();d.keys.add('KeyW');const t0=performance.now();while(performance.now()-t0<1500)await cuadro();d.keys.delete('KeyW');
   out.push({id:p.id,paso:+(((d.player.x-mx)*ux+(d.player.z-mz)*uz)/L).toFixed(2),alto:+(d.player.feet-p.y).toFixed(2)});}
  return out;})()`,{tiempo:60000});
 console.log('puertas de apartamento:',JSON.stringify(pu));
 if(!pu?.length)fallas.push('de policía no hay puertas trancadas');
 else{const val=pu.filter(q=>Math.abs(q.alto)<1);const pasa=val.filter(q=>q.paso>.3);if(!val.length)fallas.push('ninguna prueba de puerta quedó en su piso');if(pasa.length)fallas.push(`la policía entró a ${pasa.length} de ${val.length} apartamentos`);}
 await captura('policia-puerta.png');
 // el final: los ladrones llegan a la meta
 const f=await P.evaluar(`(async()=>{const d=window.__demo,P=d.persec.P;P.botin=P.meta;d.persec.update(.3);for(let k=0;k<30;k++)await new Promise(r=>requestAnimationFrame(r));return {fin:P.fin,cartel:document.querySelector('.r-muerto.fin')?.innerText||''}})()`);
 console.log('final:',JSON.stringify(f));if(f.fin?.gana!=='ladron'||!/meta/.test(f.cartel))fallas.push('al llegar a la meta no aparece el final');await captura('policia-fin.png');
 const e=(typeof P.errores==='function'?P.errores():P.errores)||[];for(const x of e.slice(0,3))fallas.push('error en la página: '+String(x).slice(0,160));}
catch(err){fallas.push('el validador se cortó: '+String(err?.message||err).slice(0,200));}
finally{console.log(`policía · ciudad ${ciudad} · cámara, atrapar, papeles y final en el 3D: ${fallas.length?'con fallas':'todo'}`);console.log(`fallas: ${fallas.length}`);for(const f of fallas)console.log('  '+f);await N.cerrar();process.exit(0);}
