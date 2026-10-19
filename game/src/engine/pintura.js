// ======== La pintura de la calle (2026-10-16) ========
// Cada franja pintada, en planta: {tipo:'cebra'|'discontinua'|'amarilla', x, z (centro), ang (hacia dónde va su largo:
// el ángulo de su eje largo desde +z, como ry en el 3D), largo, ancho, de (la cebra o la calle de la que sale)}.
//  · las cebras: las del equipamiento (equipamiento.js: una en cada brazo de cada cruce, de cordón a cordón), partidas en
//    franjas de PINTURA.cebra.franja cada PINTURA.cebra.paso a lo ancho de la calle;
//  · las calles del monte: la línea al medio —discontinua en las angostas, doble amarilla en las anchas—, desde el borde
//    de cada cruce (y de su cebra, si tiene) hasta el del siguiente.
// (Las líneas de la ciudad, planas, las pinta world3d por casilla.) Puro.
import {PINTURA as P,EQUIPAMIENTO} from './medidas.js';

export function pinturaDe(bp){const out=[],C=P.cebra;
 const cebras=(bp.equipamiento||[]).filter(o=>o.tipo==='cebra');
 for(const [i,o] of cebras.entries()){const n=Math.max(1,Math.floor(o.largo/C.paso)),ca=Math.cos(o.ang||0),sa=Math.sin(o.ang||0);
  // (en el marco de la cebra, u a lo largo —de cordón a cordón— y v a lo hondo: x = cx + u·cos, z = cz + u·sin)
  for(let k=0;k<n;k++){const u=-o.largo/2+(k+.5)*o.largo/n;out.push({tipo:'cebra',x:o.x+u*ca,z:o.z+u*sa,ang:Math.atan2(-sa,ca),largo:o.fondo,ancho:C.franja,de:'cebra'+i});}}
 // las calles del monte: los cruces (cuántas calles llegan, y la más ancha) y, en cada punta, hasta dónde no se pinta
 const I=bp.isla,nodos=new Map(),k=p=>Math.round(p.x)+','+Math.round(p.z);
 const calles=(I?.carreteras||[]).filter(c=>c.puntos?.length>1&&c.tipo!=='escalinata');// (la escalinata es peatonal: sin pintura)
 for(const c of calles)for(const e of c.extremos||[]){if(!e)continue;const n=nodos.get(k(e))||nodos.set(k(e),{n:0,ancho:0}).get(k(e));n.n++;n.ancho=Math.max(n.ancho,c.ancho||12);}
 for(const [ci,c] of calles.entries()){const pts=c.puntos,an=c.ancho||12,L=[0];for(let i=1;i<pts.length;i++)L.push(L[i-1]+Math.hypot(pts[i].x-pts[i-1].x,pts[i].z-pts[i-1].z));
  const libre=e=>{if(!e)return 0;const n=nodos.get(k(e));if(!n)return 0;return n.ancho/2+(n.n>=3?EQUIPAMIENTO.cebra.ancho:0)+P.margen;};
  const a0=libre(c.extremos?.[0]),a1=L.at(-1)-libre(c.extremos?.[1]);if(a1-a0<1)continue;
  const en=s=>{let i=1;while(i<L.length-1&&L[i]<s)i++;const t=(s-L[i-1])/((L[i]-L[i-1])||1),p=pts[i-1],q=pts[i];return {x:p.x+(q.x-p.x)*t,z:p.z+(q.z-p.z)*t,ang:Math.atan2(q.x-p.x,q.z-p.z)};};
  if(an>P.amarilla.desde){// la doble amarilla: de a tramos (cada tramo recto de la polilínea, recortado a [a0, a1])
   for(let i=1;i<pts.length;i++){const s0=Math.max(a0,L[i-1]),s1=Math.min(a1,L[i]);if(s1-s0<.05)continue;const m=en((s0+s1)/2),nx=Math.cos(m.ang),nz=-Math.sin(m.ang);
    for(const o of [-P.amarilla.separa/2,P.amarilla.separa/2])out.push({tipo:'amarilla',x:m.x+nx*o,z:m.z+nz*o,ang:m.ang,largo:s1-s0,ancho:P.amarilla.ancho,de:'calle'+ci});}}
  else{const D=P.discontinua;for(let s=a0+D.cada/2;s+D.largo/2<=a1;s+=D.cada){const m=en(s);out.push({tipo:'discontinua',x:m.x,z:m.z,ang:m.ang,largo:D.largo,ancho:D.ancho,de:'calle'+ci});}}}
 return out;}

// Las cuatro esquinas de una franja (en planta).
export function esquinasFranja(f){const ux=Math.sin(f.ang),uz=Math.cos(f.ang),vx=uz,vz=-ux,a=f.largo/2,b=f.ancho/2;
 return [[f.x-ux*a-vx*b,f.z-uz*a-vz*b],[f.x+ux*a-vx*b,f.z+uz*a-vz*b],[f.x+ux*a+vx*b,f.z+uz*a+vz*b],[f.x-ux*a+vx*b,f.z-uz*a+vz*b]];}
