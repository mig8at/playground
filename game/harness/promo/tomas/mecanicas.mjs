// TOMA · Las mecánicas (de día, en el edificio de prueba) — jugadas con las teclas del juego (W, Shift, E): la puerta de
// calle con E y la vista cenital al entrar, el ascensor, la azotea y una vuelta de cámara sobre el piso cortado.
// SOLO=<puerta|ascensor|azotea|orbita> graba una sola.
// SALE: puerta, ascensor, azotea, orbita
import {abrirJuego,listo,grabar,errores,JUEGO} from '../../lib/arnes.mjs';
import {TOMAS} from '../rutas.mjs';
const SOLO=process.env.SOLO;
const J=await abrirJuego(`${JUEGO}/juego?prueba=edificio`);
// (las teclas: E como el juego la recibe —keydown en window—; W/Shift en las teclas apretadas; la vista, con mira)
const T=`const E=()=>{window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE',key:'e'}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyE',key:'e'}));};
 const K=(c,on)=>on?d.keys.add(c):d.keys.delete(c);const mira=(yaw,pitch)=>{d.euler.set(pitch,yaw,0,'YXZ');d.camera.quaternion.setFromEuler(d.euler);};`;
try{await listo(J);
 await J.evaluar(`(()=>{const d=window.__demo;window.__cam=null;d.renderer.toneMappingExposure=1.05;const sp=d.world.spawn;window.__SP={x:sp.x,z:sp.z,yaw:sp.yaw};
  window.__R=d.world.lots.get(0)?.raise||0;return 1;})()`);
 const toma=async(nombre,n,js,saltar=0)=>{if(SOLO&&SOLO!==nombre)return;console.log(nombre,await grabar(J,`${TOMAS}/${nombre}`,n,`${T}${js}`,{saltar}),'s');};
 // 1) la puerta de calle: llega, la abre con E y entra (vista de arriba)
 await toma('puerta',80,`const S=window.__SP,fx=-Math.sin(S.yaw),fz=-Math.cos(S.yaw);
  if(i===-8){d.keys.clear();Object.assign(d.player,{x:S.x+fx*.9,z:S.z+fz*.9,vy:0,ground:true});d.player.feet=d.world.groundAt(d.player.x,d.player.z);}
  mira(S.yaw,-.9);if(i===0)K('KeyW',true);if(i===12)K('KeyW',false);if(i===18)E();if(i===30)K('KeyW',true);if(i===79)K('KeyW',false);`,8);
 // 2) el ascensor (su puerta, del plano): a 1,6 m en el pasillo del primer piso, entra y sube con E
 await toma('ascensor',100,`const R=window.__R;
  if(i===-10){const lv=d.plan.lots[0].levels[1],cd=lv.doors.find(q=>q.core&&!q.stair),C=lv.core,mx=(cd.x0+cd.x1)/2,mz=(cd.y0+cd.y1)/2,h=Math.abs(cd.y0-cd.y1)<1e-6;
   let nx=0,nz=0;if(h)nz=mz<C.y+C.h/2?-1:1;else nx=mx<C.x+C.w/2?-1:1;window.__AS={x:mx+nx*1.6,z:mz+nz*1.6,yaw:Math.atan2(nx,nz)};
   d.keys.clear();Object.assign(d.player,{x:window.__AS.x,z:window.__AS.z,feet:R+3.02,vy:0,ground:true});}
  mira(window.__AS.yaw+.25,-.85);if(i===8)K('KeyW',true);if(i===42)K('KeyW',false);if(i===54)E();`,10);
 // 3) la azotea: corre entre los tanques, con la ciudad atrás
 await toma('azotea',80,`const R=window.__R;
  if(i===-10){d.keys.clear();Object.assign(d.player,{x:84,z:171,feet:d.world.floorAt(84,171,R+13),vy:0,ground:true});}
  mira(-2.4,-.55);if(i===0){K('KeyW',true);K('ShiftLeft',true);}if(i===79){K('KeyW',false);K('ShiftLeft',false);}`,10);
 // 4) la vuelta de cámara sobre el piso cortado (piso 2), con el muñeco caminando por el pasillo
 await toma('orbita',90,`const R=window.__R;
  if(i===-10){d.keys.clear();Object.assign(d.player,{x:88,z:166.9,feet:R+6.02,vy:0,ground:true});}
  mira(-1.57+i*.004,-.8);if(i===0)K('KeyW',true);if(i===89)K('KeyW',false);
  window.__cam=c=>{const t=Math.max(0,i)/89,a=1.15+t*.75,r=17,P=d.player;c.position.set(P.x+Math.sin(a)*r,P.feet+13-t*2,P.z+Math.cos(a)*r);c.lookAt(P.x,P.feet,P.z);};
  if(i===89)window.__cam=null;`,10);
}finally{const e=errores(J);if(e.length)console.log('errores de la página:\n'+e.slice(0,6).join('\n'));await J.cerrar();}
