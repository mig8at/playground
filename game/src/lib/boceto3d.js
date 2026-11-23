// EL BOCETO (2026-11-22, Miguel: «que las casas y edificios sean de un solo color blanco… así podemos centrarnos en las
// medidas antes de pasar a los colores y texturas»; y después: «la idea es eliminar todo el ruido… bórralos, no los
// dejes ahí»). El paseo se dibuja SIEMPRE así: todo lo que cuelga del mundo construido —edificios, casas, sus puertas y
// ventanas, lo que queda de baño y cocina, el mobiliario de la calle— va con un material blanco mate, y el vidrio con
// un gris transparente. El suelo conserva sus tonos (asfalto, vereda, pasto) para que se lea dónde está la calle, y lo
// pintado en las paredes se sigue viendo. No hay opción para volver a los colores.
// Se aplica en cada cuadro, antes de dibujar, y sólo a lo que todavía no lo tiene: así ni lo que se arma al acercarse
// llega a verse con color.
// (se probaron las aristas en negro con el paso de contornos —edges3d.js—: Miguel las sacó)
import * as THREE from 'three';

export const BOCETO={papel:'#ffffff',vidrio:'#cfd9de'};
const SALVO=o=>/^suelo:|^grafiti/.test(o.name||'')||o.name==='mapa-pintable';

export function createBoceto(){const hechos=new Map(),own=[];
 const blanco=m=>{if(!m||m.userData?.boceto)return m;let b=hechos.get(m);if(b)return b;
  // (un material propio —un sombreador a mano— no se toca: no se sabe qué dibuja)
  if(m.isShaderMaterial||m.isLineBasicMaterial||m.isPointsMaterial||m.isSpriteMaterial){hechos.set(m,m);return m;}
  const vidrio=m.transparent&&m.opacity<.95;
  b=new THREE.MeshStandardMaterial({color:vidrio?BOCETO.vidrio:BOCETO.papel,roughness:1,metalness:0,side:m.side,transparent:m.transparent,opacity:vidrio?Math.min(m.opacity,.45):m.opacity,depthWrite:m.depthWrite,depthTest:m.depthTest,
   polygonOffset:m.polygonOffset,polygonOffsetFactor:m.polygonOffsetFactor,polygonOffsetUnits:m.polygonOffsetUnits,visible:m.visible});
  b.userData.boceto=true;b.userData.original=m;hechos.set(m,b);own.push(b);return b;};
 const ir=o=>{if(SALVO(o))return 0;let n=0;
  if(o.isMesh&&!o.userData.boceto){o.userData.boceto=true;o.userData.material0=o.material;o.material=Array.isArray(o.material)?o.material.map(blanco):blanco(o.material);
   if(o.isInstancedMesh&&o.instanceColor){o.userData.color0=o.instanceColor;o.instanceColor=null;}n++;}
  else if(o.isMesh){const m=o.material;if(Array.isArray(m)?m.some(x=>!x.userData?.boceto&&hechos.get(x)!==x):!m.userData?.boceto&&hechos.get(m)!==m){o.material=Array.isArray(m)?m.map(blanco):blanco(m);n++;}
   if(o.isInstancedMesh&&o.instanceColor){o.userData.color0=o.instanceColor;o.instanceColor=null;}}
  for(const c of o.children)n+=ir(c);return n;};
 return {
  // Pasa a boceto lo que cuelga de `raiz` y todavía no lo está; devuelve cuántas mallas cambió.
  aplicar(raiz){let n=0;for(const c of raiz.children){if(SALVO(c))continue;n+=ir(c);}return n;},
  dispose(){for(const m of own)m.dispose();hechos.clear();}};}
