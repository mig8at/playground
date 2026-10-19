/* El corte de lo de arriba (2026-10-14): con la cámara alta, adentro de un edificio no se ve nada por el techo. Como los
   edificios van fundidos en pocas mallas por material, no se puede esconder piso por piso: se corta al dibujar. Todo lo
   que quede más arriba que uCutY dentro del rectángulo del edificio del jugador (uBoxMin..uBoxMax) no se dibuja (tampoco en el
   mapa de sombras: el cuarto queda con el sol que entra por arriba, como una maqueta sin tejado). Se aplica parcheando los
   materiales (onBeforeCompile) con uniformes compartidos; uCutOn apaga el corte sin recompilar.
   - El canto: los materiales de edificios van de dos caras; adentro del cilindro, la cara de atrás (lo que se ve por el
     corte, el interior de la pared) se pinta oscura: el borde de arriba de la pared se lee como una franja sólida.
   - En las paredes de una cara (sin grosor) el canto no existe: se pinta una franja oscura justo debajo del corte.
   - Medianeras: en los lados del edificio pegados a otro, la pared no se corta y se pinta lisa (uWall): se ve la
     división y no el interior del vecino.
   - Ver a través: las paredes entre la cámara y el jugador (a menos de uSeeR de esa línea) no se dibujan. La gente sí. */
import * as THREE from 'three';

export function createCut({radius=24,see=1.3,cap='#3a3532',band=.17}={}){
 const BAND=band;
 const U={uCutOn:{value:0},uCutY:{value:0},uCutLow:{value:-1e9},uGround:{value:-1e9},uShared:{value:new THREE.Vector4()},uWall:{value:new THREE.Color('#d8d3ca')},uFront:{value:new THREE.Vector2()},uStub:{value:-1e9},uCutC:{value:new THREE.Vector2()},uCutR:{value:radius},uBoxMin:{value:new THREE.Vector2(-1e9,-1e9)},uBoxMax:{value:new THREE.Vector2(1e9,1e9)},
  uSeeOn:{value:0},uCam:{value:new THREE.Vector3()},uSee:{value:new THREE.Vector3()},uSeeR:{value:see},uCap:{value:new THREE.Color(cap)}};
 const VERT_HEAD='varying vec3 vCutW;\n',FRAG_HEAD='uniform vec4 uShared;uniform vec3 uWall;uniform vec2 uFront;uniform float uStub;uniform float uCutOn,uCutY,uCutLow,uGround,uCutR,uSeeOn,uSeeR;uniform vec2 uCutC,uBoxMin,uBoxMax;uniform vec3 uCam,uSee,uCap;varying vec3 vCutW;\n';
 // (la posición del mundo, con la piel y las instancias ya aplicadas: `transformed` después de skinning)
 const VERT_BODY=`
  {vec4 cw=vec4(transformed,1.);
  #ifdef USE_INSTANCING
   cw=instanceMatrix*cw;
  #endif
  vCutW=(modelMatrix*cw).xyz;}`;
 // (y en un piso alto, también lo de abajo del piso: sólo queda la planta del jugador; el suelo de la calle, nunca)
 const CUT=`
 bool inCut=uCutOn>.5&&distance(vCutW.xz,uCutC)<uCutR&&all(greaterThan(vCutW.xz,uBoxMin))&&all(lessThan(vCutW.xz,uBoxMax));
 bool party=false;
 #ifdef CUT_CAP
 party=inCut&&vCutW.y>uCutY&&abs(normalize(cross(dFdx(vCutW),dFdy(vCutW))).y)<.5&&(uShared.x>.5&&vCutW.x<uBoxMin.x+.75||uShared.y>.5&&vCutW.z<uBoxMin.y+.75||uShared.z>.5&&vCutW.x>uBoxMax.x-.75||uShared.w>.5&&vCutW.z>uBoxMax.y-.75);
 #endif
 bool front=false;
 #ifdef CUT_CAP
 // (como Los Sims: las paredes del lado de la cámara —más allá de medio metro del jugador hacia ella— quedan en un
 // muñón de uStub; las del fondo, enteras hasta el corte)
 front=inCut&&dot(vCutW.xz-uCutC,uFront)>.6&&abs(normalize(cross(dFdx(vCutW),dFdy(vCutW))).y)<.5;
 #endif
 if(inCut&&!party&&(vCutW.y>uCutY||front&&vCutW.y>uStub||vCutW.y<uCutLow&&vCutW.y>uGround))discard;
`;
 // (ver a través: lo que queda a menos de uSeeR de la línea cámara→jugador y por encima de sus pies no se dibuja: en su
 // edificio, sólo las paredes; en los vecinos —que no se cortan y la cámara puede quedar adentro—, también sus losas)
 const SEE=`
 #ifndef USE_SKINNING
 if(uSeeOn>.5&&vCutW.y>uSee.y-.9){vec3 ab=uSee-uCam;float t=clamp(dot(vCutW-uCam,ab)/max(dot(ab,ab),1e-4),0.,1.);
  if(t<.97&&distance(vCutW,uCam+ab*t)<uSeeR){vec3 nv=normalize(cross(dFdx(vCutW),dFdy(vCutW)));bool own=all(greaterThan(vCutW.xz,uBoxMin))&&all(lessThan(vCutW.xz,uBoxMax));if(abs(nv.y)<.6||!own)discard;}}
 #endif
`;
 // (y en las paredes de una sola cara —sin grosor, no tienen interior que mostrar— una franja oscura de BAND arriba del
 // corte: en las paredes verticales, por la normal del mundo sacada de las derivadas)
 const CAP=`
 if(party){vec3 nw2=normalize(cross(dFdx(vCutW),dFdy(vCutW)));gl_FragColor=vec4(uWall*(.82+.18*abs(nw2.x+nw2.z)),1.);}
 else if(inCut){vec3 nw=normalize(cross(dFdx(vCutW),dFdy(vCutW)));
  if(!gl_FrontFacing||(abs(nw.y)<.35&&(vCutW.y>uCutY-${BAND.toFixed(3)}||front&&vCutW.y>uStub-${BAND.toFixed(3)})))gl_FragColor=vec4(uCap,1.);}
`;
 const mats=new Set(),done=new WeakSet();
 // opts.see: tramar lo que tapa; opts.cap: el canto oscuro (y dos caras)
 function patch(m,{see=true,cap=false}={}){
  // (la marca va en un WeakSet y no en userData: un material copiado con clone() se lleva userData pero no el
  // onBeforeCompile, y quedaba marcado como cortado sin estarlo —los muebles de los pisos se arman con copias—)
  if(!m||done.has(m)||m.isShaderMaterial||m.isRawShaderMaterial||m.isPointsMaterial||m.isSpriteMaterial||m.isLineBasicMaterial)return m;
  done.add(m);m.userData.cut=true;const prev=m.onBeforeCompile,key=m.customProgramCacheKey,tag='|cut'+(see?'s':'')+(cap?'c':'');
  if(cap&&m.side===THREE.FrontSide){m.side=THREE.DoubleSide;m.shadowSide=THREE.FrontSide;}
  m.onBeforeCompile=(sh,r)=>{prev?.call(m,sh,r);if(sh.vertexShader.includes('vCutW')||!sh.vertexShader.includes('#include <project_vertex>')||!sh.fragmentShader.includes('#include <clipping_planes_fragment>'))return;
   Object.assign(sh.uniforms,U);
   sh.vertexShader=VERT_HEAD+sh.vertexShader.replace('#include <project_vertex>','#include <project_vertex>'+VERT_BODY);
   let f=(cap?'#define CUT_CAP\n':'')+FRAG_HEAD+sh.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>'+CUT+(see?SEE:''));
   if(cap&&f.includes('#include <dithering_fragment>'))f=f.replace('#include <dithering_fragment>','#include <dithering_fragment>'+CAP);
   sh.fragmentShader=f;};
  m.customProgramCacheKey=()=>(key?key.call(m):'')+tag;m.needsUpdate=true;mats.add(m);return m;}
 const depth=patch(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking}),{see:false});
 const isUnder=(o,s)=>{for(let p=o;p;p=p.parent)if(p===s)return true;return false;};
 // Todo lo que cuelga de root, menos lo que cuelga de algo en skip (la isla: el terreno y las montañas).
 // building: edificios (canto oscuro); la gente y los muebles sueltos, sin canto.
 function patchTree(root,skip=[],{building=false,see=true}={}){root.traverse(o=>{if(skip.some(s=>s!==root&&isUnder(o,s)))return;if(!o.isMesh)return;
  const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>patch(m,{see,cap:building&&!o.isSkinnedMesh&&!o.isInstancedMesh}));
  if(o.castShadow&&!o.customDepthMaterial&&!ms.some(m=>m.alphaTest>0||m.transparent))o.customDepthMaterial=depth;});}
 // low: la altura debajo de la cual tampoco se dibuja (en planta baja, ninguna)
 // box: el rectángulo del edificio en planta [x0,z0,x1,z1] (sólo ése se corta; los demás quedan enteros)
 // shared: [x0,z0,x1,z1] lados del rectángulo pegados a otro edificio (la medianera queda en pie, lisa)
 function set(on,x=0,z=0,y=0,low=-1e9,box=null,ground=-1e9,shared=null){U.uCutOn.value=on?1:0;U.uGround.value=ground;U.uShared.value.set(...(shared||[0,0,0,0]).map(v=>v?1:0));U.uCutC.value.set(x,z);U.uCutY.value=y;U.uCutLow.value=low;
  if(box){U.uBoxMin.value.set(box[0],box[1]);U.uBoxMax.value.set(box[2],box[3]);}else{U.uBoxMin.value.set(-1e9,-1e9);U.uBoxMax.value.set(1e9,1e9);}}
 // la línea de la cámara al jugador (sin ella, nada se trama)
 // front: dirección horizontal del jugador hacia la cámara (unitaria); stub: alto del muñón de las paredes de adelante
 function front(dir,stub){U.uFront.value.copy(dir);U.uStub.value=stub;}
 function look(on,cam,target){U.uSeeOn.value=on?1:0;if(on){U.uCam.value.copy(cam);U.uSee.value.copy(target);}}
 return {U,patch,patchTree,set,look,front};}
