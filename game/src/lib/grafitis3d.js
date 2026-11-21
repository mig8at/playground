// Los grafitis en el 3D (2026-11-21): cada muro pintado —una fachada entera o la pared de un cuarto— es un plano pegado a
// esa pared, apenas por delante, con una textura de un píxel por píxel del grafiti, sin suavizar (se ve la cuadrícula,
// como se pintó). Lo que no está pintado es transparente: se sigue viendo el muro, sus ventanas y sus puertas.
// Dónde va cada uno sale del plano (engine/muros.js muroDe) y la grilla, de engine/grafiti.js.
import * as THREE from 'three';
import {muroDe} from '../engine/muros.js';
import {GRAFITI,lienzoDe,deTexto,mascaraDe} from '../engine/grafiti.js';

const RGB=GRAFITI.paleta.map(c=>c?[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)]:null);
export function createGrafitis(plan,guardados={}){const group=new THREE.Group(),own=[];group.name='grafitis';let n=0;
 for(const [id,s] of Object.entries(guardados||{})){const M=muroDe(plan,id);if(!M||!s?.t)continue;const L=lienzoDe(M),g=s.cols===L.cols&&s.rows===L.rows?deTexto(s.t,L.cols,L.rows):null;if(!g)continue;
  // (sólo sobre pared: lo que haya quedado guardado encima de una ventana o de una puerta no se dibuja)
  const mk=mascaraDe(M);for(let i=0;i<g.d.length;i++)if(!mk[i])g.d[i]=0;
  const c=document.createElement('canvas');c.width=L.cols;c.height=L.rows;const x=c.getContext('2d'),I=x.createImageData(L.cols,L.rows);let hay=false;
  for(let i=0;i<g.d.length;i++){const k=RGB[g.d[i]];if(!k)continue;I.data[i*4]=k[0];I.data[i*4+1]=k[1];I.data[i*4+2]=k[2];I.data[i*4+3]=255;hay=true;}
  if(!hay)continue;x.putImageData(I,0,0);
  const t=new THREE.CanvasTexture(c);t.magFilter=THREE.NearestFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;
  const geo=new THREE.PlaneGeometry(L.cols*L.px,L.rows*L.px),mat=new THREE.MeshStandardMaterial({map:t,transparent:true,alphaTest:.5,roughness:.95}),m=new THREE.Mesh(geo,mat);
  // (adentro no hay lámparas: lo pintado brilla apenas con su propio color, como las paredes de los cuartos, o sale apagado)
  if(M.clase==='interior'){mat.emissive=new THREE.Color('#ffffff');mat.emissiveMap=t;mat.emissiveIntensity=.45;}
  m.position.set(M.c.x+M.n[0]*M.sale,M.y0+M.alto/2,M.c.z+M.n[1]*M.sale);m.rotation.y=Math.atan2(M.n[0],M.n[1]);m.receiveShadow=true;m.name='grafiti:'+id;group.add(m);own.push(t,geo,mat);n++;}
 return {group,n,dispose(){for(const o of own)o.dispose();}};}
