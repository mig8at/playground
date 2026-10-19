/* Contornos para /demo: una línea gris en las aristas y esquinas de las PAREDES (edificios y casas), para que las formas
   low poly se lean bien. Muebles, gente, carros, árboles y postes no se delinean. Es un paso de postproceso: dibuja la
   escena una vez más con normales (a menor resolución) y compara cada pixel con sus vecinos. Lo que se delinea es lo que
   cuelga de un objeto con `userData.edges=true`; el resto se dibuja igual (tapa lo de atrás) pero marcado para no contar.
   Se atenúa con la distancia para no ensuciar lo lejano. */
import * as THREE from 'three';
import {Pass,FullScreenQuad} from 'three/addons/postprocessing/Pass.js';

const VERT=`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
// Alfa del pixel de normales: 1 = pared, 0 = otra cosa (o cielo). Sólo un pixel de pared lleva línea, y un vecino que
// no es pared y está DELANTE (un mueble contra la pared) no cuenta: así no se dibuja su silueta.
const FRAG=`
uniform sampler2D tDiffuse,tNormal,tDepth;uniform vec2 res;uniform float near,far,strength;uniform vec3 color;varying vec2 vUv;
float lin(float d){float z=d*2.-1.;return 2.*near*far/(far+near-z*(far-near));}
void main(){
 vec4 base=texture2D(tDiffuse,vUv);vec2 px=1./res;
 float raw=texture2D(tDepth,vUv).x;vec4 c0=texture2D(tNormal,vUv);
 if(raw>.99999||c0.a<.5){gl_FragColor=base;return;}
 float d0=lin(raw);vec3 n0=c0.xyz*2.-1.;
 float dd=0.,nd=0.;
 for(int i=0;i<4;i++){
  vec2 o=i==0?vec2(px.x,0.):i==1?vec2(-px.x,0.):i==2?vec2(0.,px.y):vec2(0.,-px.y);
  vec4 c=texture2D(tNormal,vUv+o);float d=lin(texture2D(tDepth,vUv+o).x);
  if(c.a<.5&&d<d0*.98)continue;
  dd=max(dd,abs(d-d0)/max(min(d,d0),.05));nd=max(nd,1.-dot(c.xyz*2.-1.,n0));
 }
 float e=max(smoothstep(.035,.11,dd),smoothstep(.12,.4,nd));
 e*=1.-smoothstep(45.,180.,d0);
 gl_FragColor=vec4(mix(base.rgb,color,e*strength),base.a);
}`;

const WALLS=7;// (capa de las paredes delineadas)
export class EdgePass extends Pass{
 constructor(scene,camera,{scale=.5,color='#4f5458',strength=.6}={}){
  super();this.scene=scene;this.camera=camera;this.scale=scale;
  // Sin interpolar: un pixel en el borde entre pared y mueble no debe mezclar las dos marcas.
  this.target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthTexture:new THREE.DepthTexture(1,1)});
  // Doble cara: muchas paredes del paquete son de una sola cara y, vistas de atrás, no taparían lo que hay detrás.
  this.wall=new THREE.MeshNormalMaterial({side:THREE.DoubleSide});
  // (opaco y con alfa 0 escrito a mano: transparente, three.js ordena y cambia de estado objeto por objeto —medido: 10 ms
  // contra 3 para la misma escena—)
  this.other=new THREE.MeshNormalMaterial({side:THREE.DoubleSide});
  this.other.onBeforeCompile=sh=>{sh.fragmentShader=sh.fragmentShader.replace('gl_FragColor.a = 1.0;','gl_FragColor.a = 0.0;');};this.other.customProgramCacheKey=()=>'edge-other';
  this.material=new THREE.ShaderMaterial({vertexShader:VERT,fragmentShader:FRAG,depthTest:false,depthWrite:false,uniforms:{
   tDiffuse:{value:null},tNormal:{value:this.target.texture},tDepth:{value:this.target.depthTexture},res:{value:new THREE.Vector2(1,1)},
   near:{value:camera.near},far:{value:camera.far},color:{value:new THREE.Color(color)},strength:{value:strength}}});
  this.quad=new FullScreenQuad(this.material);this.swapped=[];this.hidden=[];
 }
 setSize(w,h){const W=Math.max(1,Math.floor(w*this.scale)),H=Math.max(1,Math.floor(h*this.scale));this.target.setSize(W,H);this.material.uniforms.res.value.set(W,H);}
 // La capa de paredes para lo que cuelga de algo marcado, y la lista de puntos, líneas y sprites (no se dibujan aquí).
 layer(o,wall){const w=wall||o.userData.edges===true;if(o.isMesh){if(w)o.layers.enable(WALLS);else o.layers.disable(WALLS);}else if(o.isSprite||o.isLine||o.isPoints){if(o.visible)this.flat.push(o);}
  for(const c of o.children)this.layer(c,w);}
 // Cada malla visible toma el material de pared o el de «otra cosa» según cuelgue (o no) de algo marcado.
 mark(o,wall){if(!o.visible)return;const w=wall||o.userData.edges===true;
  if(o.isMesh){this.swapped.push(o,o.material);o.material=w?this.wall:this.other;}
  else if(o.isSprite||o.isLine||o.isPoints){this.hidden.push(o);o.visible=false;}
  for(const c of o.children)this.mark(c,w);}
 render(renderer,writeBuffer,readBuffer){
  // Normales y profundidad de la escena (sin fondo ni niebla).
  // Rendimiento (medido el 2026-10-10: este paso costaba ~12 de 16 ms por cuadro): la escena se vuelve a dibujar sólo un
  // cuadro de cada dos (las líneas del anterior sirven: un cuadro de atraso no se nota) y sin recalcular el mapa de
  // sombras del sol, que three.js rehace en cada render si no se lo impide.
  // (2026-10-14: cambiar el material objeto por objeto costaba ~13 ms; con un material para toda la escena, ~3. Se dibuja
  // dos veces con overrideMaterial: todo como «otra cosa» —tapa, alfa 0— y encima sólo lo que va en la capa de paredes,
  // con alfa 1. La capa se pone una vez por segundo a lo que cuelga de algo marcado con userData.edges)
  if((this.tick=(this.tick||0)+1)%2===1){
   const s=this.scene,bg=s.background,fog=s.fog,cc=renderer.getClearColor(new THREE.Color()),ca=renderer.getClearAlpha(),au=renderer.shadowMap.autoUpdate,cam=this.camera,mask=cam.layers.mask;
   const now=performance.now();if(!this.layered||now-this.layered>1000){this.layered=now;this.flat=[];this.layer(s,false);}
   for(const o of this.flat)o.visible=false;
   s.background=null;s.fog=null;renderer.shadowMap.autoUpdate=false;renderer.setRenderTarget(this.target);renderer.setClearColor(0x8080ff,0);renderer.clear();
   s.overrideMaterial=this.other;renderer.render(s,cam);
   s.overrideMaterial=this.wall;cam.layers.set(WALLS);const ac=renderer.autoClear;renderer.autoClear=false;renderer.render(s,cam);renderer.autoClear=ac;cam.layers.mask=mask;
   s.overrideMaterial=null;for(const o of this.flat)o.visible=true;
   s.background=bg;s.fog=fog;renderer.shadowMap.autoUpdate=au;renderer.setClearColor(cc,ca);}
  const u=this.material.uniforms;u.tDiffuse.value=readBuffer.texture;u.near.value=this.camera.near;u.far.value=this.camera.far;
  renderer.setRenderTarget(this.renderToScreen?null:writeBuffer);this.quad.render(renderer);
 }
 dispose(){this.target.dispose();this.wall.dispose();this.other.dispose();this.material.dispose();this.quad.dispose();}
}
