// Nivel 10 del probador (2026-10-17, REGLAS.md paso 2): saltar corriendo de un techo a otro en el 3D de verdad, en el
// navegador sin ventana. Del plano salen pares de techos enfrentados a través de un hueco que la regla dice que se salta
// (engine/juego/huida.js alcanceSalto, como validar-azoteas); para cada uno: el muñeco en el techo de un lado, a 6 m del
// borde (o lo que dé el fondo del edificio, sin pasar el muro de atrás) y mirando al otro; corre (Shift + W, como el
// jugador) y salta (Espacio) al llegar al borde; tiene que caer en el techo de enfrente (los pies a su altura —la del 3D:
// el realce del lote más los pisos—, del otro lado del hueco) y vivo. Captura del primero. El borde del techo frena al
// que camina (no se cae nadie sin querer); saltando se pasa.
// Uso: node scripts/validar-salto.mjs [ciudad=1] [pares=4] [carpeta=/tmp] (con el servidor en 5180)
import {abrirNavegador} from './navegador.mjs';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {generateBlueprint} from '../src/engine/blueprint.js';
import {alcanceSalto,danoDeCaida} from '../src/engine/juego/huida.js';
import {VIDA,CIRCULACION} from '../src/engine/medidas.js';
import {alturaMansarda} from '../src/engine/techos.js';
// (lo que sube el salto se cae también: el golpe es desde lo más alto, no desde el techo de partida)
const SUBE=CIRCULACION.peaton.salto.velocidad**2/(2*CIRCULACION.peaton.salto.gravedad);
const [ciudad=1,PARES=4,OUT='/tmp']=process.argv.slice(2);const fallas=[],med=[];
// los pares: techos con escalera, enfrentados ≥ 3 m a través de un hueco de 1,5 a 12 m, que se alcanza con 1 m de margen
// (el alto de verdad en cada punto: con mansarda, el de su pendiente —techos.js, 2026-10-18: al pie de la fachada es el del
// último piso y arriba MANSARDA.alto más—)
const bp=generateBlueprint({seed:+ciudad,team:3}),T=[],altoEn=(li,x,z)=>{const L=bp.lots[li];return L.floors*3+(L.mansarda?alturaMansarda(L.mansarda,x,z):0);};
bp.lots.forEach((L,li)=>{if(!L.parts?.length||!L.levels||L.floors<2)return;for(const p of L.parts)T.push({li,H:L.floors*3,x0:p.x,x1:p.x+p.w,z0:p.y,z1:p.y+p.h});});
const pares=[];for(const a of T)for(const b of T){if(a.li===b.li)continue;
 const ox=Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0),oz=Math.min(a.z1,b.z1)-Math.max(a.z0,b.z0);
 for(const [eje,sol,gap,dir] of [['z',ox,b.z0-a.z1,1],['z',ox,a.z0-b.z1,-1],['x',oz,b.x0-a.x1,1],['x',oz,a.x0-b.x1,-1]]){if(sol<3||gap<1.5||gap>12)continue;
  // (el desnivel: del borde de donde se salta —en una mansarda, el pie de su pendiente— a 1,5 m adentro del de llegada)
  const mm=eje==='z'?(Math.max(a.x0,b.x0)+Math.min(a.x1,b.x1))/2:(Math.max(a.z0,b.z0)+Math.min(a.z1,b.z1))/2,bA=eje==='z'?(dir>0?a.z1:a.z0):(dir>0?a.x1:a.x0),bB=bA+dir*gap;
  // (desde una mansarda con pendiente de ese lado, se salta desde la cresta —validar-azoteas—: el borde, retiro adentro)
  const P_=(v,u)=>eje==='z'?[mm,v]:[v,mm],LA_=bp.lots[a.li],cr=LA_.mansarda&&altoEn(a.li,...P_(bA-dir*.3))<LA_.floors*3+LA_.mansarda.alto-.01?LA_.mansarda.retiro:0;
  const Ha=altoEn(a.li,...P_(bA-dir*(cr+.3))),Hb=altoEn(b.li,...P_(bB+dir*1.5)),dh=Ha-Hb,gapS=gap+cr;if(dh<0||danoDeCaida(dh+SUBE)>=VIDA.max*.9||gapS+1>alcanceSalto(dh))continue;
  const R=eje==='z'?{x0:Math.max(a.x0,b.x0),x1:Math.min(a.x1,b.x1),z0:dir>0?a.z1:b.z1,z1:dir>0?b.z0:a.z0}:{z0:Math.max(a.z0,b.z0),z1:Math.min(a.z1,b.z1),x0:dir>0?a.x1:b.x1,x1:dir>0?b.x0:a.x0};
  if(T.some(t=>t!==a&&t!==b&&t.x0<R.x1-.05&&t.x1>R.x0+.05&&t.z0<R.z1-.05&&t.z1>R.z0+.05))continue;// (el hueco, vacío: en un lote en L lo llena su otra parte)
  const m=eje==='z'?(Math.max(a.x0,b.x0)+Math.min(a.x1,b.x1))/2:(Math.max(a.z0,b.z0)+Math.min(a.z1,b.z1))/2,borde=eje==='z'?(dir>0?a.z1:a.z0):(dir>0?a.x1:a.x0);
  const fondo=eje==='z'?a.z1-a.z0:a.x1-a.x0;pares.push({eje,dir,m,borde:borde-dir*cr,gap:gapS,dh:+dh.toFixed(2),cresta:cr>0,li:[a.li,b.li],carrera:Math.min(5,fondo-.8-2*cr)});}}
pares.sort((p,q)=>p.dh-q.dh||p.gap-q.gap);const elegidos=[];/* (al menos uno desde la cresta de una mansarda, si hay: 2026-10-18) */const cr=pares.find(p=>p.cresta);if(cr)elegidos.push(cr);for(const p of pares){if(elegidos.some(e=>e.li.join()===p.li.join()))continue;elegidos.push(p);if(elegidos.length>=PARES)break;}
const N=await abrirNavegador(),T0=Date.now(),traza=m=>process.env.TRAZA&&console.log(`[${((Date.now()-T0)/1000).toFixed(1)} s] ${m}`);
try{traza('navegador abierto');const P=await N.abrir(`http://localhost:5180/demo?jugadores=3&ciudad=${ciudad}`);
 await P.evaluar(`new Promise(r=>{const t=setInterval(()=>{const d=window.__demo;if(d?.world&&d.ronda){clearInterval(t);const st=document.createElement('style');st.textContent='.card{display:none!important}';document.head.appendChild(st);r(1);}},300);})`,{tiempo:240000});
 traza('ronda lista');if(!elegidos.length)fallas.push('no hay pares de techos para probar el salto');
 for(const [i,p] of elegidos.entries()){traza(`par ${i}: ${JSON.stringify(p)}`);
  const r=await P.evaluar(`(async()=>{const d=window.__demo,w=d.world,p=${JSON.stringify(p)},cuadro=()=>new Promise(r=>requestAnimationFrame(r)),k=(c,t)=>window.dispatchEvent(new KeyboardEvent(t,{code:c}));
   if([...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Caminar'))d.toggleDrone();
   // el punto de partida: 6 m antes del borde, sobre el techo (la altura que da el 3D para ese techo)
   const ini=p.eje==='z'?{x:p.m,z:p.borde-p.dir*p.carrera}:{x:p.borde-p.dir*p.carrera,z:p.m},LA=w.lots.get(p.li[0]),LB=w.lots.get(p.li[1]),man=(li,x,z)=>{const M=d.plan.lots[li].mansarda;return M?(${alturaMansarda.toString()})(M,x,z):0;},techoA=(LA.raise||0)+LA.floors*3+man(p.li[0],ini.x,ini.z);let techoB=0;d.curar();
   const vida0=d.vida;/* (cada salto con la vida entera: las caídas de uno no cuentan en el siguiente) */Object.assign(d.player,{x:ini.x,z:ini.z,feet:techoA,vy:0,ground:true,caidaDesde:null,sinDano:false});
   const yaw=p.eje==='z'?(p.dir>0?Math.PI:0):(p.dir>0?-Math.PI/2:Math.PI/2);
   for(let j=0;j<30;j++){d.euler.set(-.15,yaw,0,'YXZ');d.camera.quaternion.setFromEuler(d.euler);await cuadro();}
   k('ShiftLeft','keydown');k('KeyW','keydown');let salto=false,t0=performance.now(),maxH=0,tq=performance.now(),dq=1/60;
   while(performance.now()-t0<4000){d.euler.set(-.15,yaw,0,'YXZ');d.camera.quaternion.setFromEuler(d.euler);await cuadro();const tn=performance.now();dq=(tn-tq)/1000;tq=tn;
    const pos=p.eje==='z'?d.player.z:d.player.x,falta=(p.borde-pos)*p.dir;
    // (salta a tiempo aunque vaya lento: lo que avanza en un cuadro, a la carrera —con la máquina cargada, el cuadro
    // es largo y apretaba tarde, ya pasado el borde—)
    if(!salto&&falta<.6+9.2*Math.min(dq,.1)){k('Space','keydown');salto=true;await cuadro();k('Space','keyup');}
    if(salto&&d.player.ground&&(p.eje==='z'?(d.player.z-p.borde)*p.dir:(d.player.x-p.borde)*p.dir)>p.gap)break;
    if(d.muerto)break;}
   k('KeyW','keyup');k('ShiftLeft','keyup');for(let j=0;j<20;j++)await cuadro();
   const pos=p.eje==='z'?d.player.z:d.player.x,pasado=(pos-p.borde)*p.dir;techoB=(LB.raise||0)+LB.floors*3+man(p.li[1],d.player.x,d.player.z);/* (la altura del techo donde cayó) */
   return {techoB:+techoB.toFixed(2),techoA:+techoA.toFixed(2),pies:+d.player.feet.toFixed(2),pasado:+pasado.toFixed(2),salto,muerto:d.muerto,vida:Math.round(d.vida),vida0:Math.round(vida0)};})()`,{tiempo:60000});
  const ok=r.salto&&!r.muerto&&r.pasado>p.gap&&Math.abs(r.pies-r.techoB)<.35;
  med.push(`hueco ${p.gap.toFixed(1)} m, desnivel ${p.dh} m: ${ok?'cae en el techo de enfrente':'NO'} (pies ${r.pies}, techo de partida ${r.techoA}, de llegada ${r.techoB}, pasó ${r.pasado} m del borde, vida ${r.vida0}→${r.vida})`);
  if(!ok)fallas.push(`el salto de un techo a otro no llega: ${JSON.stringify({...p,...r})}`);
  if(i===0)writeFileSync(join(OUT,'salto-techo.png'),Buffer.from(await P.captura(),'base64'));
  if(r.muerto)await P.evaluar(`(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{code:'Enter'}));})()`);}
 const e=(typeof P.errores==='function'?P.errores():P.errores)||[];for(const x of e.slice(0,3))fallas.push('error en la página: '+String(x).slice(0,160));}
catch(err){fallas.push('el validador se cortó: '+String(err?.message||err).slice(0,200));}
finally{console.log(`salto · ciudad ${ciudad} · ${elegidos.length} pares de techos`);for(const m of med)console.log('  '+m);console.log(`fallas: ${fallas.length}`);for(const f of fallas)console.log('  '+f.slice(0,400));await N.cerrar();process.exit(0);}
