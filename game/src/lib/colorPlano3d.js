// EL COLOR PLANO (2026-11-22, Miguel: «aplicar color a todo coherentemente desde el motor 2D hasta el 3D; por ahora no
// apliquemos texturas a nada, sólo color armónico a todo, coherente a lo que es cada cosa: color plano»). Reemplaza al
// boceto blanco (before/src/lib/boceto3d.js). Todo lo que cuelga del mundo se dibuja con un material de UN color, mate, sin
// textura, sin relieve, sin brillo de metal:
//  · el suelo, por lo que es (las mallas suelo:asphalt, suelo:grass…): engine/colores.js COLOR.suelo;
//  · un material de un modelo con nombre que dice qué es («Wood», «Leaves», «Glass»…): engine/colores.js colorDeNombre;
//  · lo demás, su propio color —el que puso el motor: las fachadas, los cuartos y los techos de color.js; los árboles con el
//    tinte de su especie (por instancia, se conserva)—; si su color venía de una textura (un aviso, una placa), el promedio
//    de la textura. Pasado por engine/colores.js armonizar: lo del motor no cambia; los colores puros de los modelos, sí;
//  · el vidrio (lo que era transparente), COLOR.material.vidrio y OPACO (2026-11-22, Miguel: «las ventanas están
//    transparentes y por defecto deben ser opacas, para no cargar el interior de los edificios»): desde la calle no se ve
//    adentro, y el mundo arma lo de adentro sólo desde adentro —world3d updateInteriors—.
// Lo pintado en las paredes (los grafitis, el mapa de lo pintable) no se toca: es de los jugadores. Se aplica en cada cuadro
// y sólo a lo que todavía no lo tiene: lo que se arma al acercarse tampoco llega a verse con textura.
import * as THREE from 'three';
import {COLOR,colorDeNombre,armonizar} from '../engine/colores.js';

const SALVO=o=>/^grafiti/.test(o.name||'')||o.name==='mapa-pintable';
const SUELO={asphalt:'asfalto',sidewalk:'anden',paving:'adoquin',grass:'pasto',court:'cancha'};
// (el promedio de una textura: dibujada en un lienzo de 1 × 1)
const promedios=new WeakMap();
function promedio(t){if(promedios.has(t))return promedios.get(t);let c=null;const img=t?.image;
 try{if(img&&(img.width||img.videoWidth)){const cv=document.createElement('canvas');cv.width=cv.height=1;const g=cv.getContext('2d');g.drawImage(img,0,0,1,1);const d=g.getImageData(0,0,1,1).data;c='#'+[d[0],d[1],d[2]].map(v=>v.toString(16).padStart(2,'0')).join('');}}catch{}
 promedios.set(t,c);return c;}

// El color de un material, en la malla o donde esté.
export function colorPlanoDe(m,o){const s=/^suelo:(\w+)/.exec(o?.name||'');if(s&&SUELO[s[1]])return COLOR.suelo[SUELO[s[1]]];
 const n=colorDeNombre(m.name);if(n)return n;
 let c=m.color?'#'+m.color.getHexString():COLOR.material.blanco;if(m.map&&c==='#ffffff')c=promedio(m.map)||c;
 return armonizar(c);}

export function createColorPlano(){const hechos=new Map(),own=[];
 const plano=(m,o)=>{if(!m||m.userData?.plano)return m;const clave=m.uuid+'|'+(/^suelo:/.test(o.name||'')?o.name:'');let p=hechos.get(clave);if(p)return p;
  // (un material propio —un sombreador a mano, líneas, puntos— no se toca: no se sabe qué dibuja)
  if(m.isShaderMaterial||m.isLineBasicMaterial||m.isPointsMaterial||m.isSpriteMaterial||m.customProgramCacheKey?.()==='ropa-cortes'){hechos.set(clave,m);return m;}
  const vidrio=m.transparent&&m.opacity<.95;
  p=new THREE.MeshStandardMaterial({color:vidrio?COLOR.material.vidrio:colorPlanoDe(m,o),roughness:vidrio?.6:.92,metalness:0,side:m.side,vertexColors:!!m.vertexColors,
   transparent:vidrio?false:m.transparent,opacity:vidrio?1:m.opacity,depthWrite:vidrio?true:m.depthWrite,depthTest:m.depthTest,alphaTest:m.alphaTest||0,
   emissive:m.emissive||0x000000,emissiveIntensity:m.emissiveIntensity??1,polygonOffset:m.polygonOffset,polygonOffsetFactor:m.polygonOffsetFactor,polygonOffsetUnits:m.polygonOffsetUnits,visible:m.visible});
  p.userData.plano=true;p.userData.original=m;hechos.set(clave,p);own.push(p);return p;};
 const ir=o=>{if(SALVO(o))return 0;let n=0;
  if(o.isMesh){const m=o.material,falta=Array.isArray(m)?m.some(x=>!x?.userData?.plano&&hechos.get(x.uuid+'|')!==x):!m?.userData?.plano&&hechos.get(m?.uuid+'|')!==m;
   if(falta){if(!o.userData.material0)o.userData.material0=m;o.material=Array.isArray(m)?m.map(x=>plano(x,o)):plano(m,o);n++;}}
  for(const c of o.children)n+=ir(c);return n;};
 return {
  // Pasa a color plano lo que cuelga de `raiz` y todavía no lo está; devuelve cuántas mallas cambió.
  aplicar(raiz){let n=0;for(const c of raiz.children){if(SALVO(c))continue;n+=ir(c);}return n;},
  dispose(){for(const m of own)m.dispose();hechos.clear();}};}
