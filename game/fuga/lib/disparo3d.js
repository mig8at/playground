/* El tiro (2026-10-14): dónde pega, el impacto y el sonido.
   DÓNDE PEGA. Un rayo de three contra la escena cuesta 40–50 ms (4,6 M de triángulos en mallas juntadas: el rayo prueba
   cada triángulo), un tirón en cada tiro. En vez de eso se DIBUJA lo que hay en la dirección del tiro: una cámara con un
   FOV de una décima de grado, sobre un blanco de 3×3 píxeles en punto flotante. El recorte de la cámara deja afuera casi
   todo, así que cuesta lo que cuesta dibujar lo que cae en ese lápiz. Primera pasada: cada píxel guarda la posición en el
   mundo de lo que ve (con huesos e instancias, así que pega en la gente, los muebles y los autos tal como se ven); la
   normal sale de los vecinos. La gente se prueba aparte con un cilindro por persona (para saber A QUIÉN se le pegó).
   IMPACTO. Un agujero (disco oscuro pegado a la superficie, los últimos 64), polvo del color de la superficie y chispas.
   SONIDO. Sintetizado con WebAudio (no hay archivos): el estallido (crujido + cuerpo + golpe grave), el eco corto de la
   calle, el impacto que llega con la demora del sonido (343 m/s) y la vaina que cae rebotando. */
import * as THREE from 'three';

const POS_VS=`#include <common>
#include <skinning_pars_vertex>
varying vec3 vW;
void main(){
 #include <skinbase_vertex>
 #include <begin_vertex>
 #include <skinning_vertex>
 vec4 wp=vec4(transformed,1.);
 #ifdef USE_INSTANCING
 wp=instanceMatrix*wp;
 #endif
 wp=modelMatrix*wp;vW=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}`;
const POS_FS='varying vec3 vW;void main(){gl_FragColor=vec4(vW,1.);}';

export function createShooting({renderer,scene,camera,hide=()=>[],people=()=>[],colorOf=()=>null}){
 const mk=()=>new THREE.WebGLRenderTarget(3,3,{type:THREE.FloatType,format:THREE.RGBAFormat,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true});
 const rtPos=mk();
 const posMat=new THREE.ShaderMaterial({vertexShader:POS_VS,fragmentShader:POS_FS,side:THREE.DoubleSide});
 const probe=new THREE.PerspectiveCamera(.1,1,.05,150),clear=new THREE.Color();
 // (lo que no se ve no se pega: las cajas que sólo proyectan sombra —colorWrite false— y lo invisible)
 const ghost=o=>{const m=o.material;return o.isMesh&&m&&!Array.isArray(m)&&(m.colorWrite===false||m.visible===false||(m.transparent&&m.opacity===0));};

 // Lo que hay en la dirección dir desde from: {point, normal, color, dist} o null. Dibuja ahora (las dos pasadas) y
 // lee después, sin frenar a la GPU (la lectura llega uno o dos cuadros más tarde: el viaje de la bala).
 async function look(from,dir){
  probe.position.copy(from);probe.lookAt(from.x+dir.x,from.y+dir.y,from.z+dir.z);probe.updateMatrixWorld();
  const hidden=[...hide(),fx].filter(o=>o&&o.visible);scene.traverseVisible(o=>{if(ghost(o))hidden.push(o);});for(const o of hidden)o.visible=false;
  const prevRT=renderer.getRenderTarget(),prevOv=scene.overrideMaterial,prevBg=scene.background,prevFog=scene.fog,ac=renderer.getClearAlpha();renderer.getClearColor(clear);
  try{
   scene.background=null;scene.fog=null;renderer.setClearColor(0x000000,0);
   scene.overrideMaterial=posMat;renderer.setRenderTarget(rtPos);renderer.clear();renderer.render(scene,probe);
  }finally{scene.overrideMaterial=prevOv;scene.background=prevBg;scene.fog=prevFog;renderer.setRenderTarget(prevRT);renderer.setClearColor(clear,ac);for(const o of hidden)o.visible=true;}
  const bp=new Float32Array(36);await renderer.readRenderTargetPixelsAsync(rtPos,0,0,3,3,bp);
  const P=i=>bp[i*4+3]>.5?new THREE.Vector3(bp[i*4],bp[i*4+1],bp[i*4+2]):null,c=P(4);if(!c)return null;
  // la normal, de los vecinos (izquierda-derecha y abajo-arriba), hacia la cámara
  const l=P(3)||c,r=P(5)||c,d=P(1)||c,u=P(7)||c,n=new THREE.Vector3().crossVectors(r.clone().sub(l),u.clone().sub(d));
  if(n.lengthSq()<1e-12)n.copy(dir).negate();n.normalize();if(n.dot(dir)>0)n.negate();
  // (el polvo: del piso, tierra gris; de una pared o un techo, revoque claro. Leer el color de verdad pedía dibujar la
  // escena con sus materiales fuera del composer, y ahí los materiales con luz no dibujan: WebGL da INVALID_OPERATION)
  return {point:c,normal:n,dist:c.distanceTo(from),color:new THREE.Color(n.y>.7?'#5e574d':'#8d8478')};}

 // La persona más cercana que cruza el rayo (cilindro de 28 cm × 1,75 m), hasta maxD.
 function personHit(from,dir,maxD){let best=null;const w=new THREE.Vector3();
  for(const p of people()){const b=p.body;if(!b||!b.visible)continue;b.getWorldPosition(w);const R=.28,ox=from.x-w.x,oz=from.z-w.z,a=dir.x*dir.x+dir.z*dir.z;if(a<1e-9)continue;
   const bb=2*(ox*dir.x+oz*dir.z),cc=ox*ox+oz*oz-R*R,disc=bb*bb-4*a*cc;if(disc<0)continue;const t=(-bb-Math.sqrt(disc))/(2*a);if(t<.2||t>maxD)continue;
   const y=from.y+dir.y*t;if(y<w.y||y>w.y+1.75*(b.scale.y||1))continue;if(!best||t<best.t)best={t,p,point:from.clone().addScaledVector(dir,t)};}
  return best;}

 // ---------- Impactos ----------
 const fx=new THREE.Group();scene.add(fx);
 const HOLES=64,holeMat=new THREE.MeshBasicMaterial({color:'#1b1714',transparent:true,opacity:.85,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4});
 const holes=new THREE.InstancedMesh(new THREE.CircleGeometry(.032,7),holeMat,HOLES);holes.count=0;holes.frustumCulled=false;fx.add(holes);let holeN=0;
 const BITS=240,bitMat=new THREE.MeshBasicMaterial({color:'#ffffff'}),bitsMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),bitMat,BITS);
 bitsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);bitsMesh.count=0;bitsMesh.frustumCulled=false;fx.add(bitsMesh);
 const bits=[],m4=new THREE.Matrix4(),q=new THREE.Quaternion(),Z=new THREE.Vector3(0,0,1),s3=new THREE.Vector3(),tmpC=new THREE.Color();
 function addHole(point,normal){q.setFromUnitVectors(Z,normal);const r=new THREE.Quaternion().setFromAxisAngle(normal,Math.random()*6);m4.compose(point.clone().addScaledVector(normal,.006),r.multiply(q),s3.setScalar(.8+Math.random()*.5));
  holes.setMatrixAt(holeN%HOLES,m4);holeN++;holes.count=Math.min(HOLES,holeN);holes.instanceMatrix.needsUpdate=true;}
 function burst(point,normal,color,{n=12,speed=2.2,size=.024,sparks=4}={}){
  for(let i=0;i<n+sparks;i++){if(bits.length>=BITS)bits.shift();const spark=i>=n,v=new THREE.Vector3(Math.random()-.5,Math.random()-.5,Math.random()-.5).multiplyScalar(spark?3:1.4).addScaledVector(normal,spark?2.5:1.2+Math.random()).normalize().multiplyScalar(speed*(spark?2.2:.5+Math.random()));
   const c=spark?new THREE.Color('#ffd27a'):color.clone().multiplyScalar(.8+Math.random()*.4);
   bits.push({p:point.clone().addScaledVector(normal,.02),v,c,life:spark?.12+Math.random()*.1:.45+Math.random()*.45,age:0,size:spark?.012:size*(.6+Math.random()*.8),spin:Math.random()*6,drag:spark?.5:3});}}
 function update(dt){
  let k=0;for(let i=bits.length-1;i>=0;i--){const b=bits[i];b.age+=dt;if(b.age>=b.life){bits.splice(i,1);continue;}}
  for(const b of bits){b.v.y-=9.8*dt*(b.drag>1?.35:1);b.v.multiplyScalar(Math.max(0,1-b.drag*dt));b.p.addScaledVector(b.v,dt);const s=b.size*(1-b.age/b.life*.7);
   m4.compose(b.p,q.setFromAxisAngle(Z,b.spin+b.age*8),s3.setScalar(s));bitsMesh.setMatrixAt(k,m4);bitsMesh.setColorAt(k,b.c);k++;}
  bitsMesh.count=k;bitsMesh.instanceMatrix.needsUpdate=true;if(bitsMesh.instanceColor)bitsMesh.instanceColor.needsUpdate=true;}

 // ---------- Sonido ----------
 let ac=null,master=null,noise=null,echo=null;
 function audio(){if(ac)return ac;const C=window.AudioContext||window.webkitAudioContext;if(!C)return null;ac=new C();master=ac.createGain();master.gain.value=.55;master.connect(ac.destination);
  noise=ac.createBuffer(1,ac.sampleRate*.6,ac.sampleRate);const d=noise.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
  // el eco de la calle: dos rebotes cortos y apagados
  const inE=ac.createGain(),dl=ac.createDelay(1),fb=ac.createGain(),lp=ac.createBiquadFilter();dl.delayTime.value=.13;fb.gain.value=.32;lp.type='lowpass';lp.frequency.value=1400;
  inE.connect(dl);dl.connect(lp);lp.connect(fb);fb.connect(dl);lp.connect(master);echo=inE;return ac;}
 const env=(g,t,a,peak,dec)=>{g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(peak,t+a);g.gain.exponentialRampToValueAtTime(.0008,t+a+dec);};
 function noiseHit(t,{type='bandpass',f=2500,Q=.7,peak=1,dec=.08,to=master,rate=1}){const s=ac.createBufferSource();s.buffer=noise;s.playbackRate.value=rate;const fl=ac.createBiquadFilter();fl.type=type;fl.frequency.value=f;fl.Q.value=Q;const g=ac.createGain();env(g,t,.002,peak,dec);s.connect(fl);fl.connect(g);g.connect(to);if(to===master&&echo)g.connect(echo);s.start(t);s.stop(t+dec+.05);}
 function tone(t,f0,f1,peak,dec,type='sine'){const o=ac.createOscillator(),g=ac.createGain();o.type=type;o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(f1,t+dec);env(g,t,.002,peak,dec);o.connect(g);g.connect(master);o.start(t);o.stop(t+dec+.05);}
 function shotSound(){if(!audio())return;if(ac.state==='suspended')ac.resume();const t=ac.currentTime+.005;
  noiseHit(t,{f:2600,Q:.6,peak:.9,dec:.07});noiseHit(t,{type:'lowpass',f:900,Q:.5,peak:.8,dec:.22});tone(t,150,42,.9,.16);
  // la vaina: dos piques metálicos al caer
  const c=t+.38+Math.random()*.08;tone(c,4300,4100,.05,.05,'triangle');tone(c+.004,6100,5900,.03,.04,'triangle');tone(c+.15,4500,4300,.025,.04,'triangle');}
 function impactSound(dist,person){if(!ac)return;const t=ac.currentTime+dist/343,v=1/(1+dist/6);
  if(person)noiseHit(t,{type:'lowpass',f:420,Q:.8,peak:.7*v,dec:.07});
  else{noiseHit(t,{type:'highpass',f:1800,Q:.5,peak:.55*v,dec:.035});noiseHit(t,{f:700,Q:1,peak:.35*v,dec:.06});}}

 return {look,personHit,update,
  // Dispara desde la cámara: spread en radianes. Devuelve {point, person} (o null si no pegó en nada a 150 m).
  async fire(spread=0){
   const from=camera.getWorldPosition(new THREE.Vector3()),dir=camera.getWorldDirection(new THREE.Vector3());
   if(spread>0){const a=Math.random()*Math.PI*2,r=spread*Math.sqrt(Math.random()),up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion),rt2=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion);dir.addScaledVector(rt2,Math.cos(a)*r).addScaledVector(up,Math.sin(a)*r).normalize();}
   shotSound();
   const surf=await look(from,dir),ph=personHit(from,dir,surf?surf.dist+.3:150);
   if(ph){const col=new THREE.Color(colorOf(ph.p)||'#8a8e90');
    burst(ph.point,dir.clone().negate(),col,{n:9,speed:1.6,size:.03,sparks:0});impactSound(ph.t,true);return {point:ph.point,person:ph.p};}
   if(!surf)return null;addHole(surf.point,surf.normal);burst(surf.point,surf.normal,surf.color);impactSound(surf.dist,false);return {point:surf.point,normal:surf.normal};},
  clear(){holeN=0;holes.count=0;bits.length=0;bitsMesh.count=0;},
  // (la primera vez se compilan los sombreadores de la sonda: se hace al cargar, no en el primer tiro)
  warm(){return look(camera.getWorldPosition(new THREE.Vector3()),camera.getWorldDirection(new THREE.Vector3()));},
  dispose(){rtPos.dispose();posMat.dispose();holeMat.dispose();bitMat.dispose();holes.geometry.dispose();bitsMesh.geometry.dispose();scene.remove(fx);ac?.close();}};
}
