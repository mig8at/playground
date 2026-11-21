// LAS TEXTURAS DE LAS FACHADAS EN EL 3D (2026-11-21, Miguel: «las fachadas están muy planas, que tengan textura, más
// bonitas; hacé varias»).
//
// En octubre las fachadas pasaron a color plano (LOWPOLY: sin las fotos del paquete). Esto les devuelve material sin
// volver a las fotos: cada textura se DIBUJA acá, en un lienzo, y es sólo claro-oscuro —casi blanca, con las juntas y el
// grano más oscuros—. Al multiplicarse por el color del edificio, la pared conserva su color del plano y gana el dibujo
// del ladrillo, la piedra o la tablilla; la misma imagen sirve de relieve (las juntas hundidas) para que el sol las marque.
// Una baldosa mide LADO metros y se repite; las medidas son las de obra (un ladrillo de 24 × 6 cm, un sillar de 50 × 25).
import * as THREE from 'three';

export const TEXTURAS3D={on:true,LADO:2,PX:256};
const rnd=s=>()=>((s=(s*1664525+1013904223)>>>0)/4294967296);
const gris=v=>{const n=Math.max(0,Math.min(255,Math.round(v*255)));return `rgb(${n},${n},${n})`;};
// (el grano: puntitos apenas más claros o más oscuros, para que ninguna superficie sea un color exacto)
const grano=(g,P,r,n,d)=>{for(let i=0;i<n;i++){g.fillStyle=gris(.94+(r()-.5)*d);g.globalAlpha=.5;g.fillRect(r()*P,r()*P,1+r()*2,1+r()*2);}g.globalAlpha=1;};

const DIBUJOS={
 // ladrillo a la vista: hiladas de 6,25 cm, ladrillos de 25 cm trabados a media pieza, la junta hundida
 ladrillo(g,P,r){g.fillStyle=gris(.70);g.fillRect(0,0,P,P);const h=P/32,w=P/8;for(let j=0;j<32;j++)for(let i=-1;i<8;i++){const x=i*w+(j%2?w/2:0);g.fillStyle=gris(.86+r()*.14);g.fillRect(x+1,j*h+1,w-1,h-1);}grano(g,P,r,900,.12);},
 // ladrillo pintado: el mismo aparejo, casi tapado por la pintura
 ladrillo_pintado(g,P,r){g.fillStyle=gris(.88);g.fillRect(0,0,P,P);const h=P/32,w=P/8;for(let j=0;j<32;j++)for(let i=-1;i<8;i++){const x=i*w+(j%2?w/2:0);g.fillStyle=gris(.95+r()*.05);g.fillRect(x+1,j*h+1,w-1,h-1);}grano(g,P,r,500,.06);},
 // sillar: bloques de piedra de 50 × 25 cm, con la junta marcada y cada bloque de un tono
 sillar(g,P,r){g.fillStyle=gris(.79);g.fillRect(0,0,P,P);const h=P/8,w=P/4;for(let j=0;j<8;j++)for(let i=-1;i<4;i++){const x=i*w+(j%2?w/2:0);g.fillStyle=gris(.9+r()*.1);g.fillRect(x+1.5,j*h+1.5,w-3,h-3);g.fillStyle=gris(1);g.globalAlpha=.25;g.fillRect(x+1.5,j*h+1.5,w-3,2);g.globalAlpha=1;}grano(g,P,r,1400,.14);},
 // estuco: revoque fino, con manchas suaves y grano
 estuco(g,P,r){g.fillStyle=gris(.95);g.fillRect(0,0,P,P);for(let i=0;i<40;i++){const x=r()*P,y=r()*P,R=12+r()*30,G=g.createRadialGradient(x,y,0,x,y,R),v=.95+(r()-.5)*.1;G.addColorStop(0,gris(v));G.addColorStop(1,'rgba(242,242,242,0)');g.fillStyle=G;g.fillRect(x-R,y-R,2*R,2*R);}grano(g,P,r,2600,.12);},
 // panel: placas de 1 × 1 m con la junta abierta y un remache en cada esquina
 panel(g,P,r){g.fillStyle=gris(.66);g.fillRect(0,0,P,P);const w=P/2;for(let j=0;j<2;j++)for(let i=0;i<2;i++){g.fillStyle=gris(.92+r()*.08);g.fillRect(i*w+1.5,j*w+1.5,w-3,w-3);g.fillStyle=gris(.74);for(const [a,b] of [[.08,.08],[.92,.08],[.08,.92],[.92,.92]]){g.beginPath();g.arc(i*w+a*w,j*w+b*w,1.6,0,7);g.fill();}}grano(g,P,r,500,.05);},
 // hormigón a la vista: las tablas del encofrado cada 25 cm y los agujeros de los tensores
 hormigon(g,P,r){g.fillStyle=gris(.93);g.fillRect(0,0,P,P);const h=P/8;for(let j=0;j<8;j++){g.fillStyle=gris(.9+r()*.08);g.fillRect(0,j*h+1,P,h-1);g.fillStyle=gris(.8);g.fillRect(0,j*h,P,1);}g.fillStyle=gris(.7);for(const x of [.25,.75])for(const y of [.25,.75]){g.beginPath();g.arc(x*P,y*P,2.2,0,7);g.fill();}grano(g,P,r,1800,.1);},
 // tablilla: tablas horizontales de 16,7 cm solapadas; la de arriba le hace sombra a la de abajo
 tablilla(g,P,r){const h=P/12;for(let j=0;j<12;j++){const G=g.createLinearGradient(0,j*h,0,(j+1)*h),v=.93+r()*.06;G.addColorStop(0,gris(.72));G.addColorStop(.14,gris(v));G.addColorStop(1,gris(v-.05));g.fillStyle=G;g.fillRect(0,j*h,P,h);}grano(g,P,r,700,.06);},
};
export const NOMBRES_TEXTURA=Object.keys(DIBUJOS);

const hechas=new Map();
export function texturaPared(nombre){if(hechas.has(nombre))return hechas.get(nombre);const P=TEXTURAS3D.PX,c=document.createElement('canvas');c.width=c.height=P;const g=c.getContext('2d');(DIBUJOS[nombre]||DIBUJOS.estuco)(g,P,rnd(NOMBRES_TEXTURA.indexOf(nombre)*7919+13));
 const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;hechas.set(nombre,t);return t;}

// Qué textura le toca a una pared: sale de su material (la familia de la fachada: ladrillo, piedra, metal) y de su color,
// para que dos edificios de la misma familia no sean siempre iguales. Sin azar: el mismo edificio, la misma textura.
const POR_MATERIAL={MI_RedBrick:['ladrillo','ladrillo','ladrillo_pintado','estuco'],MI_RedBrick_Pale:['ladrillo','estuco','tablilla','ladrillo_pintado'],MI_Concrete:['sillar','sillar','hormigon','estuco'],MI_Trim_MetalConcrete:['panel','hormigon','panel','tablilla'],MI_Trim:['estuco','sillar','ladrillo_pintado']};
export function texturaDe(material,color){const L=POR_MATERIAL[material];if(!L)return null;let h=2166136261;for(const ch of String(color||''))h=Math.imul(h^ch.charCodeAt(0),16777619);return L[(h>>>0)%L.length];}

// Las coordenadas de textura de una malla ya puesta en su lugar: por metros del mundo. En una pared, a lo largo de ella y
// hacia arriba; en una cara horizontal, en planta. Así el dibujo no se estira y sigue de una pieza a la de al lado.
export function uvDelMundo(geo){const p=geo.attributes.position.array,n=geo.attributes.normal.array,u=geo.attributes.uv.array,k=1/TEXTURAS3D.LADO,c=geo.attributes.position.count;
 for(let i=0;i<c;i++){const x=p[i*3],y=p[i*3+1],z=p[i*3+2],nx=Math.abs(n[i*3]),ny=Math.abs(n[i*3+1]),nz=Math.abs(n[i*3+2]);
  if(ny>nx&&ny>nz){u[i*2]=x*k;u[i*2+1]=z*k;}else if(nx>nz){u[i*2]=z*k;u[i*2+1]=y*k;}else{u[i*2]=x*k;u[i*2+1]=y*k;}}
 geo.attributes.uv.needsUpdate=true;return geo;}
