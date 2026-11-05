// TOMA · La ciudad de noche — el vuelo sobre el centro, un auto de cerca y un giro alrededor de un edificio alto.
// Salen vuelo/, auto/ y edificio/ en promo/.work/tomas.
// SALE: vuelo, auto, edificio
import {abrirJuego,listo,grabar,errores,JUEGO} from '../../lib/arnes.mjs';
import {TOMAS} from '../rutas.mjs';
const J=await abrirJuego(`${JUEGO}/juego?ciudad=2&jugadores=3`);
try{await listo(J);
 console.log(await J.evaluar(`(()=>{const d=window.__demo;d.renderer.toneMappingExposure=2.2;d.avatar&&(d.avatar.holder.visible=false);
  const W=d.world.size;window.__C={x:W.w/2,z:W.h/2};
  // (un edificio alto cerca del centro, para el giro)
  let best=null;for(const [id,L] of d.world.lots){const dd=Math.hypot(L.x-window.__C.x,L.z-window.__C.z);const sc=(L.floors||0)*10-dd*.3;if(!best||sc>best.sc)best={sc,L};}window.__EDI=best.L;
  return 'edificio en '+Math.round(best.L.x)+', '+Math.round(best.L.z)+' · '+best.L.floors+' pisos';})()`));
 const lerp=`const k=(i,n)=>{const t=i/(n-1);return t*t*(3-2*t);};const L=(a,b,t)=>a+(b-a)*t;`;
 // 1) el vuelo: baja de 58 a 36 m acercándose al centro
 console.log('vuelo',await grabar(J,`${TOMAS}/vuelo`,100,`${lerp}const C=window.__C,t=k(i,100);window.__cam=c=>{if(c.fov!==45){c.fov=45;c.updateProjectionMatrix();}
  c.position.set(L(C.x-95,C.x-45,t),L(58,36,t),L(C.z+95,C.z+45,t));c.lookAt(C.x+15,0,C.z-15);};`,{saltar:5}),'s');
 // 2) un auto de cerca: el más cercano al centro; la cámara baja, adelante y al costado, mirándolo
 console.log('auto',await grabar(J,`${TOMAS}/auto`,90,`const T=d.traffic,S=window.__S||(window.__S={});
  if(!S.v){const C=window.__C;S.v=T.vehicles.filter(v=>Math.hypot(v.x-C.x,v.z-C.z)<90).sort((a,b)=>Math.hypot(a.x-C.x,a.z-C.z)-Math.hypot(b.x-C.x,b.z-C.z))[0]||T.vehicles[0];S.px=S.v.x;S.pz=S.v.z;}
  const v=S.v,mx=v.x-S.px,mz=v.z-S.pz,m=Math.hypot(mx,mz);if(m>.01){const ux=mx/m,uz=mz/m;S.dx=S.dx==null?ux:S.dx+(ux-S.dx)*.1;S.dz=S.dz==null?uz:S.dz+(uz-S.dz)*.1;const n=Math.hypot(S.dx,S.dz);S.dx/=n;S.dz/=n;}S.px=v.x;S.pz=v.z;
  window.__cam=c=>{const dx=S.dx??1,dz=S.dz??0;if(c.fov!==40){c.fov=40;c.updateProjectionMatrix();}const p=[v.x+dx*7-dz*2.6,.9,v.z+dz*7+dx*2.6];S.cp=S.cp||p;for(let j=0;j<3;j++)S.cp[j]+=(p[j]-S.cp[j])*.25;
   c.position.set(...S.cp);c.lookAt(v.x+dx*1.5,.7,v.z+dz*1.5);};`,{saltar:20}),'s');
 // 3) el giro lento alrededor del edificio alto, con las ventanas encendidas
 console.log('edificio',await grabar(J,`${TOMAS}/edificio`,80,`${lerp}const E=window.__EDI,t=i/79,a=.6+t*.55,r=L(34,27,t),h=(E.floors||4)*3;
  window.__cam=c=>{if(c.fov!==45){c.fov=45;c.updateProjectionMatrix();}c.position.set(E.x+Math.sin(a)*r,L(4,9,t),E.z+Math.cos(a)*r);c.lookAt(E.x,h*.55,E.z);};`),'s');
}finally{const e=errores(J);if(e.length)console.log('errores de la página:\n'+e.slice(0,6).join('\n'));await J.cerrar();}
