// TOMA · La persecución — una persecución real de la ronda (ciudad 2: el policía bot P3 tras el ladrón bot L3, del segundo
// 134 al 182 de juego, donde lo alcanza). Se adelanta la partida hasta T0 sin dibujar y se graba hasta T1 desde tres
// cámaras a la vez, cada una a su carpeta: frente (delante del ladrón, mirándolo venir), tras (por encima del hombro del
// policía, hacia el ladrón) y cara (delante del policía). La simulación es determinista: sale siempre la misma.
// El cuadro f de cada carpeta es el segundo T0 + f/30 de juego.
// SALE: persecucion/frente, persecucion/tras, persecucion/cara
import {abrirJuego,listo,dibujar,cuadro,errores,FPS,JUEGO} from '../../lib/arnes.mjs';
import {TOMAS} from '../rutas.mjs';
import {mkdirSync,writeFileSync,rmSync} from 'node:fs';
const T0=+(process.env.T0||128),T1=+(process.env.T1||182),EXPO=+(process.env.EXPO||2.2),RELLENO=+(process.env.RELLENO||12);
const BASE=process.env.BASE||`${TOMAS}/persecucion`,ANG=['frente','tras','cara'];
for(const a of ANG){rmSync(`${BASE}/${a}`,{recursive:true,force:true});mkdirSync(`${BASE}/${a}`,{recursive:true});}
const J=await abrirJuego(`${JUEGO}/juego?ciudad=2&jugadores=3`);
try{await listo(J,{ronda:true});
 console.log('adelantando la partida hasta el segundo',T0,'…');
 await J.evaluar(`(async()=>{for(let i=0;i<600&&!window.__demo.persec?.listo;i++){window.__tick(33);await new Promise(r=>setTimeout(r,5));}
  const d=window.__demo;window.__ang=0;window.__st={};
  // el par: el ladrón libre más cercano a un policía
  window.__par=()=>{const A=d.persec.P.agentes,pol=A.filter(a=>a.equipo==='policia'&&!a.humano),lad=A.filter(a=>a.equipo==='ladron'&&!a.humano&&(!a.estado||a.estado==='libre'));
   let b=null;for(const p of pol)for(const l of lad){const dd=Math.hypot(p.x-l.x,p.z-l.z);if(!b||dd<b.dd)b={p,l,dd};}return b;};
  const suelo=(x,z)=>{const g=d.world.groundAt?.(x,z);return Number.isFinite(g)?g:0;};
  window.__cam=(cam)=>{const S=window.__st;if(!S.l)return;const lx=S.l.x,lz=S.l.z,px=S.p.x,pz=S.p.z,gy=suelo(lx,lz),gp=suelo(px,pz);
   const dx=S.dx,dz=S.dz;let pos,mira,su;
   // (u: del policía al ladrón)
   let ux=lx-px,uz=lz-pz;const un=Math.hypot(ux,uz)||1;ux/=un;uz/=un;
   if(window.__ang===0){su=[lx,gy+1.2,lz];pos=[lx+dx*3.6,gy+1.35,lz+dz*3.6];mira=[lx-dx*1,gy+1.0,lz-dz*1];}
   else if(window.__ang===1){su=[px,gp+1.6,pz];pos=[px-ux*3.4+uz*1.1,gp+1.9,pz-uz*3.4-ux*1.1];mira=[lx,gy+1.0,lz];}
   else{su=[px,gp+1.4,pz];pos=[px+ux*3.6,gp+1.45,pz+uz*3.6];mira=[px,gp+1.05,pz];}
   // (sin atravesar paredes: si la cámara queda adentro de algo, se acerca al sujeto; si no hay lugar, más arriba)
   const libre=(x,y,z)=>!d.world.collide(x,z,.35,false,y-1.6)&&!d.world.dentro?.(x,z,y);
   let ok=libre(pos[0],pos[1],pos[2]);for(let f=.92;!ok&&f>.45;f-=.08){const q=[su[0]+(pos[0]-su[0])*f,su[1]+(pos[1]-su[1])*f,su[2]+(pos[2]-su[2])*f];if(libre(q[0],q[1],q[2])){pos=q;ok=true;}}
   if(!ok)pos=[pos[0],pos[1]+2.2,pos[2]];
   if(cam.fov!==50){cam.fov=50;cam.updateProjectionMatrix();}
   const k='c'+window.__ang,o=S[k]||(S[k]={p:pos,m:mira});const a=S.salto?1:.18;for(let i=0;i<3;i++){o.p[i]+=(pos[i]-o.p[i])*a;o.m[i]+=(mira[i]-o.m[i])*a;}
   cam.position.set(...o.p);cam.lookAt(...o.m);if(window.__relleno)window.__relleno.position.set(o.p[0],o.p[1]+1.5,o.p[2]);};
  // (luz de relleno que acompaña a la cámara: de noche los muñecos quedaban a contraluz)
  window.__relleno=new d.THREE.PointLight(0xfff0e0,${RELLENO},10,1.6);d.scene.add(window.__relleno);
  window.__norender=true;while(d.persec.P.t<${T0}){for(let k=0;k<30;k++)window.__tick(1000/30);await new Promise(r=>setTimeout(r,0));}window.__norender=false;
  d.renderer.toneMappingExposure=${EXPO};return d.persec.P.t;})()`,600000);
 // un cuadro: avanza el reloj y sigue al par (su rumbo, suave)
 const paso=`(()=>{const d=window.__demo,S=window.__st,b=window.__par();if(b&&(!S.l||b.l.id!==S.l.id&&b.dd<S.dd-3||S.dd>40)){S.salto=true;}
  if(b){S.p=b.p;S.l=b.l;S.dd=b.dd;}
  if(S.l){const vx=S.l.x-(S.lx??S.l.x),vz=S.l.z-(S.lz??S.l.z),v=Math.hypot(vx,vz);S.lx=S.l.x;S.lz=S.l.z;
   if(v>.01){const ux=vx/v,uz=vz/v;if(S.dx==null){S.dx=ux;S.dz=uz;}else{S.dx+=(ux-S.dx)*.08;S.dz+=(uz-S.dz)*.08;const n=Math.hypot(S.dx,S.dz)||1;S.dx/=n;S.dz/=n;}}
   if(S.dx==null){S.dx=S.p.x-S.l.x;S.dz=S.p.z-S.l.z;const n=Math.hypot(S.dx,S.dz)||1;S.dx/=-n;S.dz/=-n;}}
  window.__ang=0;window.__tick(${1000/FPS});return {t:+d.persec.P.t.toFixed(2),dd:S.dd&&+S.dd.toFixed(1),l:S.l?.id,p:S.p?.id};})()`;
 const n=Math.round((T1-T0)*FPS);let ult=null;
 for(let i=0;i<n;i++){ult=await J.evaluar(paso);
  // (cada cámara se dibuja justo antes de su captura)
  for(let a=0;a<3;a++){await J.evaluar(`window.__ang=${a};${dibujar}`);const f=`${BASE}/${ANG[a]}/${String(i).padStart(5,'0')}.jpg`;writeFileSync(f,await J.captura());if(a===0)cuadro(f);}
  await J.evaluar(`window.__st.salto=false`);
  if(i%300===0)console.log('cuadro',i,JSON.stringify(ult));}
 console.log('fin',JSON.stringify(ult));
}finally{const e=errores(J);if(e.length)console.log('errores de la página:\n'+e.slice(0,6).join('\n'));await J.cerrar();}
