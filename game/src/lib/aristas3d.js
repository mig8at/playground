/* El modo «aristas» (2026-11-22, Miguel: «para que se te facilite la lectura de imagen, usa una textura que permita ver los
   vértices»). Una herramienta de depuración, no del juego: todo se dibuja con un solo material que
   - sombrea cada cara según hacia dónde mira (x, y y z, cada una con su tono): dos caras que se juntan se distinguen y
     las aristas se leen aunque todo sea del mismo color;
   - pinta una cuadrícula en el espacio del mundo, en las dos direcciones que corren por la cara: roja cada 1 m y azul cada
     10 cm (la de 10 cm se apaga de lejos). Así una captura dice dónde está cada cosa, cuánto mide y qué no calza.
   Se prende con ?aristas=1 en la URL o __demo.aristas(true). Funciona con mallas sueltas, instanciadas y por lotes: la
   posición en el mundo sale de la del ojo (mvPosition, que ya trae la instancia) y la inversa de la vista. */
import * as THREE from 'three';

export function materialAristas(){
 const m=new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide,fog:false});// (sin niebla: se mide también lo lejano)
 m.onBeforeCompile=sh=>{
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vWPos;')
   .replace('#include <project_vertex>','#include <project_vertex>\nvWPos=(inverse(viewMatrix)*mvPosition).xyz;');
  sh.fragmentShader=sh.fragmentShader.replace('#include <common>',`#include <common>
varying vec3 vWPos;
float linea(float x,float s){float c=x/s,w=fwidth(c);return (1.-smoothstep(0.,1.5*w,abs(fract(c-.5)-.5)))*(1.-smoothstep(.25,.5,w));}`)
   .replace('#include <dithering_fragment>',`#include <dithering_fragment>
{vec3 p=vWPos,n=normalize(cross(dFdx(p),dFdy(p))),an=abs(n);
 float tono=dot(an,vec3(.62,1.,.8));
 vec3 c=vec3(.93,.92,.9)*tono;
 vec3 lado=1.-an;// (las dos direcciones que corren por la cara)
 float m1=max(max(linea(p.x,1.)*lado.x,linea(p.y,1.)*lado.y),linea(p.z,1.)*lado.z);
 float m01=max(max(linea(p.x,.1)*lado.x,linea(p.y,.1)*lado.y),linea(p.z,.1)*lado.z);
 c=mix(c,vec3(.2,.4,.9),m01*.45);c=mix(c,vec3(.85,.18,.12),m1*.85);
 gl_FragColor=vec4(c,1.);}`);};
 return m;}
