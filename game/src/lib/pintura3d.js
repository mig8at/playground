/* La pintura de la calle en 3D (2026-10-16): las franjas que dice el plano (engine/pintura.js, validadas en
   validar-pintura), pegadas al asfalto que se dibujó. Nada se decide acá: cada franja se parte en trozos de a lo sumo
   TROZO m a lo largo y cada punta de cada trozo toma la altura del suelo del 3D (suelo(x, z)) más PINTURA.alto, así en
   una calle en pendiente la pintura sigue la pendiente en vez de quedar plana y flotando de un lado. Sin sombra propia
   (una franja de 1,5 cm no la da) y con desplazamiento de polígono: no titila contra el asfalto. */
import * as THREE from 'three';
import {PINTURA} from '../engine/medidas.js';

const TROZO=2,COLOR={cebra:'#f2f2ec',discontinua:'#f2f2ec',amarilla:'#f2c640'};

export function dibujarPintura(franjas,suelo){
 const pos=[],col=[],idx=[],c=new THREE.Color();
 for(const f of franjas){c.set(COLOR[f.tipo]||'#f2f2ec');const ux=Math.sin(f.ang),uz=Math.cos(f.ang),vx=uz,vz=-ux,b=f.ancho/2,n=Math.max(1,Math.ceil(f.largo/TROZO));
  // (la altura de cada punta: la del eje de la franja, 5 cm hacia adentro en las de los extremos —en el borde de una
  // cebra está el cordón—; el ancho de una franja es tan chico que no hace falta mirar sus dos bordes)
  const y=t=>{const s=Math.max(-f.largo/2+.05,Math.min(f.largo/2-.05,t));return suelo(f.x+ux*s,f.z+uz*s)+PINTURA.alto;};
  let prev=null;for(let i=0;i<=n;i++){const t=-f.largo/2+f.largo*i/n,cx=f.x+ux*t,cz=f.z+uz*t,h=y(t),k=pos.length/3;
   pos.push(cx-vx*b,h,cz-vz*b,cx+vx*b,h,cz+vz*b);col.push(c.r,c.g,c.b,c.r,c.g,c.b);
   if(prev!=null)idx.push(prev,prev+1,k,prev+1,k+1,k);prev=k;}}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setIndex(idx);g.computeVertexNormals();
 // (las caras miran hacia arriba sin importar el orden: doble cara)
 const m=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.7,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4});
 const mesh=new THREE.Mesh(g,m);mesh.receiveShadow=true;mesh.castShadow=false;mesh.name='pintura';
 return {mesh,dispose(){g.dispose();m.dispose();}};}
