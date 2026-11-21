// Los grafitis en el 3D (2026-11-21): cada pixel art guardado es un plano pegado a su paño de muro —2 cm por delante de
// la fachada—, con una textura de un píxel por píxel del grafiti, sin suavizar (se ve la cuadrícula, como se pintó).
// Dónde va sale del plano (engine/fachada-medida.js paniosPintables) y la grilla, de engine/grafiti.js.
import * as THREE from 'three';
import {paniosPintables} from '../engine/fachada-medida.js';
import {GRAFITI,lienzoDe,valido} from '../engine/grafiti.js';

const AFUERA={N:[0,-1,Math.PI],S:[0,1,0],E:[1,0,Math.PI/2],W:[-1,0,-Math.PI/2]};
export function createGrafitis(plan,guardados={}){const group=new THREE.Group(),own=[];group.name='grafitis';let n=0;
 if(!guardados||!Object.keys(guardados).length)return {group,n,dispose(){}};
 for(const p of paniosPintables(plan)){const g=guardados[p.id];if(!g||!valido(g,p).ok)continue;const L=lienzoDe(p),c=document.createElement('canvas');c.width=L.cols;c.height=L.rows;const x=c.getContext('2d');let hay=false;
  for(let f=0;f<L.rows;f++)for(let i=0;i<L.cols;i++){const col=GRAFITI.paleta[parseInt(g.celdas[f*L.cols+i],16)];if(!col)continue;x.fillStyle=col;x.fillRect(i,f,1,1);hay=true;}
  if(!hay)continue;
  const t=new THREE.CanvasTexture(c);t.magFilter=THREE.NearestFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;
  const geo=new THREE.PlaneGeometry(L.cols*L.px,L.rows*L.px),mat=new THREE.MeshStandardMaterial({map:t,transparent:true,alphaTest:.5,roughness:.95}),m=new THREE.Mesh(geo,mat),[nx,nz,ry]=AFUERA[p.lado];
  // (por delante del muro y del zócalo, que sale 5 cm: a 7 cm de la línea de la fachada)
  m.position.set((p.x0+p.x1)/2+nx*.07,(p.y0+p.y1)/2,(p.z0+p.z1)/2+nz*.07);m.rotation.y=ry;m.receiveShadow=true;m.name='grafiti:'+p.id;group.add(m);own.push(t,geo,mat);n++;}
 return {group,n,dispose(){for(const o of own)o.dispose();}};}
