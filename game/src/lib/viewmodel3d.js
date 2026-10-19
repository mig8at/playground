/* Brazos y arma en primera persona (2026-10-14), como los shooters: una escena aparte con su propia cámara (FOV 54°, el
   de los «view models» de Source) que se dibuja ENCIMA del mundo, con la profundidad limpia antes: el arma nunca atraviesa
   una pared por más que se pegue a ella, y no se deforma con el FOV del mundo. Todo en el marco de la cámara: el origen
   es el ojo y adelante es −z.
   Movimiento (cada uno un resorte o un suavizado chico, para que no maree):
   - balanceo al caminar en ocho, en fase con el de la cámara; más al correr;
   - retraso al girar: el arma queda atrás del mouse y vuelve (sway);
   - correr: el arma baja y se gira hacia adentro;
   - apuntar (clic derecho): el arma al centro, alineada con la mira, y el mundo con menos FOV;
   - disparar (clic): retroceso hacia atrás y arriba, el martillo de la corredera y un fogonazo. */
import * as THREE from 'three';
import {Pass} from 'three/addons/postprocessing/Pass.js';

const HIP=new THREE.Vector3(.12,-.13,-.4),AIM=new THREE.Vector3(0,-.089,-.3),RUN_OFF=new THREE.Vector3(.07,-.1,.04);

// Un tramo de brazo de a hacia b: un prisma de 7 lados, más angosto en la punta (low-poly, caras planas).
function limb(a,b,r0,r1,mat){const d=new THREE.Vector3().subVectors(b,a),g=new THREE.CylinderGeometry(r1,r0,d.length(),7,1);g.translate(0,d.length()/2,0);
 const m=new THREE.Mesh(g,mat);m.position.copy(a);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return m;}
const box=(w,h,d,mat,x=0,y=0,z=0,rx=0)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.rotation.x=rx;return m;};

export function createViewmodel({skin='#d9a77f',sleeve='#3f6fa8'}={}){
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(54,1,.01,10);
 const hemi=new THREE.HemisphereLight('#e3eef8','#8a8170',1.25),sun=new THREE.DirectionalLight('#fff1dc',2.6);scene.add(hemi,sun,sun.target);
 const M={skin:new THREE.MeshStandardMaterial({color:skin,roughness:.8,flatShading:true}),sleeve:new THREE.MeshStandardMaterial({color:sleeve,roughness:.9,flatShading:true}),
  cuff:new THREE.MeshStandardMaterial({color:'#e8e4da',roughness:.9,flatShading:true}),
  metal:new THREE.MeshStandardMaterial({color:'#7d848c',roughness:.5,metalness:.15,flatShading:true}),dark:new THREE.MeshStandardMaterial({color:'#50565c',roughness:.6,metalness:.1,flatShading:true}),
  grip:new THREE.MeshStandardMaterial({color:'#3a2f28',roughness:.85,flatShading:true}),sight:new THREE.MeshBasicMaterial({color:'#e8d36a'}),
  flash:new THREE.MeshBasicMaterial({color:'#ffd27a',transparent:true,opacity:.95,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,fog:false})};
 // ---- La pistola (origen: la empuñadura, donde va la mano; el cañón hacia −z) ----
 const gun=new THREE.Group(),slide=new THREE.Group();gun.add(slide);
 slide.add(box(.034,.036,.2,M.metal,0,.058,-.07),box(.036,.006,.2,M.dark,0,.077,-.07),box(.012,.012,.012,M.dark,0,.084,-.165),box(.016,.01,.01,M.dark,0,.083,.025));
 slide.add(box(.004,.004,.004,M.sight,0,.091,-.165),box(.004,.004,.004,M.sight,-.005,.089,.025),box(.004,.004,.004,M.sight,.005,.089,.025));
 for(let i=0;i<5;i++)slide.add(box(.036,.03,.004,M.dark,0,.058,.005+i*.007));// (las estrías de la corredera)
 gun.add(box(.03,.024,.17,M.dark,0,.028,-.06),box(.014,.014,.03,M.dark,0,.06,-.175));// (el armazón y la boca)
 const gripM=box(.032,.1,.045,M.grip,0,-.025,.012,-.22);gun.add(gripM);gun.add(box(.034,.012,.048,M.dark,0,-.074,.024,-.22));
 gun.add(box(.006,.03,.006,M.dark,0,.006,-.03),box(.006,.004,.05,M.dark,0,-.008,-.05),box(.006,.026,.006,M.dark,0,.004,-.075));// (guardamonte)
 // El fogonazo: tres planos cruzados en la boca, aditivos; se ve 50 ms.
 const flash=new THREE.Group();for(let i=0;i<3;i++){const p=new THREE.Mesh(new THREE.PlaneGeometry(.09,.09),M.flash);p.rotation.set(i===0?0:Math.PI/2,i===2?Math.PI/2:0,i*.7);flash.add(p);}
 {const s=new THREE.Mesh(new THREE.ConeGeometry(.03,.12,6,1,true),M.flash);s.rotation.x=-Math.PI/2;s.position.z=-.05;flash.add(s);}
 flash.position.set(0,.06,-.215);flash.visible=false;gun.add(flash);
 // ---- Los brazos: del borde de abajo de la pantalla a las manos. La derecha toma la empuñadura; la izquierda la
 // envuelve desde abajo (agarre a dos manos). Coordenadas del marco de la pistola. ----
 const arms=new THREE.Group();
 const rHand=new THREE.Vector3(.005,-.02,.03),lHand=new THREE.Vector3(-.03,-.035,.0);
 // (los antebrazos entran por el borde de abajo de la pantalla; con la manga hasta cerca de la muñeca)
 const V=(x,y,z)=>new THREE.Vector3(x,y,z),rw=V(.022,-.05,.075),lw=V(-.045,-.07,.07);
 arms.add(limb(V(.1,-.26,.24),rw,.046,.036,M.sleeve),limb(V(.075,-.205,.2),V(.06,-.165,.17),.05,.05,M.cuff));
 arms.add(limb(rw,V(.008,-.03,.03),.03,.028,M.skin));
 arms.add(box(.044,.075,.055,M.skin,.004,-.028,.022,-.22));// mano derecha en la empuñadura
 arms.add(box(.012,.012,.042,M.skin,-.012,.004,-.032));// el índice junto al gatillo
 arms.add(limb(V(-.16,-.27,.22),lw,.046,.036,M.sleeve),limb(V(-.125,-.215,.18),V(-.11,-.18,.155),.05,.05,M.cuff));
 arms.add(limb(lw,V(-.025,-.045,.03),.03,.028,M.skin));
 arms.add(box(.05,.048,.068,M.skin,-.024,-.042,.012,-.15));// mano izquierda envolviendo
 arms.add(box(.012,.036,.05,M.skin,-.02,-.004,-.004));// pulgar izquierdo
 gun.add(arms);
 const rig=new THREE.Group();rig.add(gun);scene.add(rig);
 gun.traverse(o=>{if(o.isMesh)o.frustumCulled=false;});

 // ---- Estado ----
 const pos=HIP.clone(),rot=new THREE.Euler(),sway=new THREE.Vector2(),kick={z:0,v:0,r:0,rv:0},lastQ=new THREE.Quaternion();
 let aim=0,run=0,flashT=0,slideT=0,cool=0,first=true;
 const tmp=new THREE.Vector3(),qInv=new THREE.Quaternion();
 return {scene,camera,
  get aiming(){return aim;},
  setColors(s,c){if(s)M.skin.color.set(s);if(c)M.sleeve.color.set(c);},
  resize(aspect){camera.aspect=aspect;camera.updateProjectionMatrix();},
  // La luz de la escena del mundo, pasada al marco de la cámara (el sol desde la misma dirección que lo ve el jugador).
  light(worldCam,wSun,wHemi){qInv.copy(worldCam.quaternion).invert();const d=wSun.userData.dir||tmp.copy(wSun.position).sub(wSun.target.position).normalize();
   sun.position.copy(d).applyQuaternion(qInv).multiplyScalar(5);sun.target.position.set(0,0,0);sun.color.copy(wSun.color);sun.intensity=wSun.intensity;
   hemi.color.copy(wHemi.color);hemi.groundColor.copy(wHemi.groundColor);hemi.intensity=wHemi.intensity;},
  // dt; s: {cam (la del mundo), bob (fase), amp (0..1,4), running, aiming, dip, moving}
  update(dt,s){
   // el giro de la cámara en este cuadro (yaw y pitch), para el retraso del arma
   if(first){lastQ.copy(s.cam.quaternion);first=false;}
   const dq=lastQ.invert().multiply(s.cam.quaternion),de=new THREE.Euler().setFromQuaternion(dq,'YXZ');lastQ.copy(s.cam.quaternion);
   const want=s.aiming?1:0;aim+=(want-aim)*Math.min(1,dt*14);run+=((s.running&&!s.aiming?1:0)-run)*Math.min(1,dt*8);
   const k=1-aim*.85;// (apuntando, casi sin balanceo ni retraso)
   sway.x+=(Math.max(-.06,Math.min(.06,de.y*1.2))*k-sway.x)*Math.min(1,dt*10);sway.y+=(Math.max(-.05,Math.min(.05,-de.x*1.2))*k-sway.y)*Math.min(1,dt*10);
   // retroceso: dos resortes amortiguados (atrás y arriba)
   kick.v+=(-kick.z*260-kick.v*22)*dt;kick.z+=kick.v*dt;kick.rv+=(-kick.r*240-kick.rv*20)*dt;kick.r+=kick.rv*dt;
   const bx=Math.sin(s.bob*.5)*.012*s.amp*k,by=-Math.abs(Math.sin(s.bob))*.01*s.amp*k;
   pos.copy(HIP).lerp(AIM,aim).addScaledVector(RUN_OFF,run);pos.x+=bx+sway.x*.25;pos.y+=by+sway.y*.25+s.dip*.3;pos.z+=kick.z;
   rig.position.copy(pos);
   rot.set(kick.r+run*-.35+sway.y*1.2,.07*(1-aim)+run*.75+sway.x*1.5,-.04*(1-aim)+run*.25-bx*2,'YXZ');rig.rotation.copy(rot);
   camera.fov=54-aim*10;camera.updateProjectionMatrix();
   cool=Math.max(0,cool-dt);
   if(flashT>0){flashT-=dt;flash.visible=flashT>0;flash.rotation.z+=1.7;}
   if(slideT>0){slideT=Math.max(0,slideT-dt);const t=slideT/.08;slide.position.z=.035*Math.sin(t*Math.PI);}},
  // Dispara si puede (semiautomática: 0,15 s entre tiros; corriendo no). Devuelve true si salió el tiro.
  fire(){if(cool>0||run>.5)return false;cool=.15;kick.v+=.9;kick.rv+=5.5*(1-aim*.5);flashT=.05;slideT=.08;flash.visible=true;flash.scale.setScalar(.8+Math.random()*.5);return true;},
  dispose(){scene.traverse(o=>{if(o.isMesh)o.geometry.dispose();});for(const m of Object.values(M))m.dispose();}};
}

// La pasada del composer: sobre lo ya dibujado, limpia la profundidad y dibuja los brazos y el arma.
export class ViewmodelPass extends Pass{
 constructor(vm){super();this.vm=vm;this.needsSwap=false;this.enabled=false;}
 render(renderer,writeBuffer,readBuffer){const ac=renderer.autoClear;renderer.autoClear=false;renderer.setRenderTarget(this.renderToScreen?null:readBuffer);renderer.clearDepth();renderer.render(this.vm.scene,this.vm.camera);renderer.autoClear=ac;}
}
