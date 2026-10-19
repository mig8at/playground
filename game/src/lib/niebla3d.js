/* Lo que queda entero detrás de la niebla no se dibuja (2026-10-16, medido en el navegador sin ventana —validar-3d—). La
   niebla del demo es lineal y a pie se cierra a scene.fog.far (240 m): más allá, todo sale del color de la niebla. Una
   malla cuya esfera envolvente queda entera más lejos que eso no aporta nada a la imagen; se esconde, y se vuelve a
   mostrar cuando se acerca. Sólo se tocan las mallas que esconde esto (las que esconde otra cosa, no). El terreno no:
   es una sola malla que llega hasta la cámara, y su silueta lejana sí se ve.
   crearNiebla(grupos) → actualizar(camara, lejos): cuántas escondió. */
import * as THREE from 'three';

export function crearNiebla(grupos){const mallas=[],c=new THREE.Vector3(),s=new THREE.Sphere();let escondidas=new Set();
 // (una BatchedMesh se descarta por instancia —su geometría es la de todas—: no acá)
 const junta=()=>{mallas.length=0;for(const g of grupos.filter(Boolean))g.traverse(o=>{if((o.isMesh||o.isInstancedMesh)&&!o.isBatchedMesh&&o.geometry)mallas.push(o);});};junta();
 function actualizar(camara,lejos){let n=0;for(const m of mallas){const g=m.geometry;if(m.isInstancedMesh){if(!m.boundingSphere)m.computeBoundingSphere();s.copy(m.boundingSphere);}else{if(!g.boundingSphere)g.computeBoundingSphere();s.copy(g.boundingSphere);}
   s.applyMatrix4(m.matrixWorld);const fuera=s.center.distanceTo(camara.position)-s.radius>lejos;
   if(fuera&&m.visible){m.visible=false;escondidas.add(m);}else if(!fuera&&escondidas.has(m)){m.visible=true;escondidas.delete(m);}if(!m.visible&&escondidas.has(m))n++;}return n;}
 return {actualizar,junta,get escondidas(){return escondidas.size;}};}
