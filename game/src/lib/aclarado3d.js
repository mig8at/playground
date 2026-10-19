/* Las paredes aclaradas (2026-10-16, Miguel: «si entro a un cuarto, que se ponga semitransparente la pared que acabo de
   atravesar, para ver todo adentro»). Qué paredes, lo decide el 2D (engine/visibilidad.js paredesAClarar); acá sólo se
   traman: dentro de cada caja del mundo (hasta MAX), de cada píxel queda una parte DEJA y el resto no se dibuja, con un
   ruido fijo de pantalla (no transparencia de verdad: los edificios van fundidos en pocas mallas y una transparencia se
   ordenaría mal y titilaría; el tramado no se ordena y cuesta lo mismo). Sólo lo que no tiene piel (la gente no se trama)
   y no en las sombras (el cuarto no se llena de luz). La vista desde arriba con el corte se retiró: esto no la usa. */
import * as THREE from 'three';
export function createAclarado({max=12,deja=.45}={}){
 const U={uAclN:{value:0},uAclK:{value:deja},uAclA:{value:Array.from({length:max},()=>new THREE.Vector4())},uAclB:{value:Array.from({length:max},()=>new THREE.Vector4())}};
 const VH='varying vec3 vAclW;\n',FH=`uniform float uAclN,uAclK;uniform vec4 uAclA[${max}];uniform vec4 uAclB[${max}];varying vec3 vAclW;\n`;
 const VB=`
  {vec4 aw=vec4(transformed,1.);
  #ifdef USE_INSTANCING
   aw=instanceMatrix*aw;
  #endif
  vAclW=(modelMatrix*aw).xyz;}`;
 const FB=`
 #if !defined(USE_SKINNING)&&!defined(DEPTH_PACKING)
 if(uAclN>.5){for(int i=0;i<${max};i++){if(float(i)>=uAclN)break;vec4 a=uAclA[i],b=uAclB[i];
  if(vAclW.x>a.x&&vAclW.x<a.z&&vAclW.z>a.y&&vAclW.z<a.w&&vAclW.y>b.x&&vAclW.y<b.y){
   float t=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))));if(t>uAclK)discard;break;}}}
 #endif
`;
 const done=new WeakSet();
 function patch(m){if(!m||done.has(m)||m.isShaderMaterial||m.isRawShaderMaterial||m.isPointsMaterial||m.isSpriteMaterial||m.isLineBasicMaterial)return;done.add(m);
  const prev=m.onBeforeCompile,key=m.customProgramCacheKey;
  m.onBeforeCompile=(sh,r)=>{prev?.call(m,sh,r);if(sh.vertexShader.includes('vAclW')||!sh.vertexShader.includes('#include <project_vertex>')||!sh.fragmentShader.includes('#include <clipping_planes_fragment>'))return;
   Object.assign(sh.uniforms,U);sh.vertexShader=VH+sh.vertexShader.replace('#include <project_vertex>','#include <project_vertex>'+VB);
   sh.fragmentShader=FH+sh.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>'+FB);};
  m.customProgramCacheKey=()=>(key?key.call(m):'')+'|acl';m.needsUpdate=true;}
 const isUnder=(o,s)=>{for(let p=o;p;p=p.parent)if(p===s)return true;return false;};
 function patchTree(root,skip=[]){root.traverse(o=>{if(!o.isMesh||o.isSkinnedMesh||skip.some(s=>isUnder(o,s)))return;(Array.isArray(o.material)?o.material:[o.material]).forEach(patch);});}
 // list: las cajas de paredesAClarar ({x0,z0,x1,z1,y0,y1}, y relativa al piso); base: la altura del piso en el mundo
 function set(list=[],base=0){const n=Math.min(max,list.length);U.uAclN.value=n;for(let i=0;i<n;i++){const p=list[i];U.uAclA.value[i].set(p.x0,p.z0,p.x1,p.z1);U.uAclB.value[i].set(base+p.y0-.05,base+p.y1-.02,0,0);}}
 // ¿un punto del mundo cae en una pared aclarada? (la cámara de tercera persona la atraviesa)
 // (con margen m: el choque de una pared es más grueso que lo que se trama —el de la escalera, 5 cm más por lado— y la
 // cámara pegaba a 15 cm de la línea aunque la pared estuviera aclarada)
 const dentro=(list,base,x,y,z,m=.2)=>(list||[]).some(p=>x>p.x0-m&&x<p.x1+m&&z>p.z0-m&&z<p.z1+m&&y>base+p.y0-.05&&y<base+p.y1);
 return {U,patch,patchTree,set,dentro};}
