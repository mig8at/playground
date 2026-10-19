// ======== Las colisiones del mundo, desde el 2D (2026-10-16, idea de Miguel) ========
// Qué detiene a alguien y qué se atraviesa sale de COLISION (medidas.js): por cada entrada del contrato del 3D
// (contrato3d.js: los mismos ids, lugares y giros que dibuja el 3D), sus formas en el mundo —círculos y cajas giradas—
// con su alto. El 3D choca contra esto (plano3d.js); los validadores miden con esto el paso libre de las veredas, que
// nada se encime y que todo siga alcanzándose a pie. Puro (sin THREE).
import {COLISION,VEGETACION} from './medidas.js';
import {contrato} from './contrato3d.js';

// (las medidas del catálogo pueden ser expresiones de w, d y tronco: 'w/2-.08')
const EXPR=new Map(),val=(v,w,d,tronco)=>{if(typeof v==='number')return v;if(v==null)return 0;let f=EXPR.get(v);if(!f)EXPR.set(v,f=new Function('w','d','tronco','return '+v));return f(w,d,tronco);};
export const claveColision=e=>e.modelo==='farol_parque'?'farol_peatonal':e.tipo==='botin'?'botin_'+e.objeto:e.tipo;

// Las formas de una entrada del contrato, en el mundo. El marco: u va a (cos ry, −sin ry) y v a (sin ry, cos ry) —el
// mismo giro con que la dibuja el 3D—.
export function formasDe(e){const C=COLISION[claveColision(e)];if(!C||C.ninguna)return null;
 const w=e.o?.w??0,d=e.o?.d??0,tronco=(e.tronco??(e.copa?e.copa/VEGETACION.tronco.copaPorDap:.3))/2,c=Math.cos(e.ang||0),s=Math.sin(e.ang||0);
 const aMundo=(u,v)=>[e.x+u*c+v*s,e.z-u*s+v*c];
 return C.partes.map(p=>{const u=val(p.u,w,d,tronco),v=val(p.v,w,d,tronco),[x,z]=aMundo(u,v);
  return p.r!=null?{x,z,r:val(p.r,w,d,tronco)}:{x,z,ux:c,uz:-s,hl:val(p.largo,w,d,tronco)/2,hf:val(p.fondo,w,d,tronco)/2};});}

// Todas las colisiones del plano: [{id, tipo, clave, alto, formas}] y lo que no choca, con su motivo.
export function colisiones(bp){const out=[],sin={};
 for(const e of contrato(bp)){const k=claveColision(e),C=COLISION[k];if(!C){sin[k]='sin entrada en COLISION';continue;}if(C.ninguna){sin[k]=C.ninguna;continue;}
  out.push({id:e.id,tipo:e.tipo,clave:k,x:e.x,z:e.z,alto:C.alto,formas:formasDe(e)});}
 return {lista:out,sin};}

// Distancia de un punto a una forma (negativa adentro de una caja: sólo importa < r)
export function distForma(f,x,z){if(f.r!=null)return Math.hypot(x-f.x,z-f.z)-f.r;
 const dx=x-f.x,dz=z-f.z,u=dx*f.ux+dz*f.uz,v=-dx*f.uz+dz*f.ux,qu=Math.abs(u)-f.hl,qv=Math.abs(v)-f.hf;
 return Math.hypot(Math.max(qu,0),Math.max(qv,0))+Math.min(Math.max(qu,qv),0);}

// Un índice para preguntar rápido: choca(x, z, r, pies) —la colisión que toca un círculo de radio r, o null; pies: la
// altura de los pies sobre el suelo (por encima del alto de algo, se pasa por arriba: subido a una banca)—.
export function indiceColisiones(lista,B=6){const g=new Map();
 for(const c of lista)for(const f of c.formas){const R=(f.r??Math.hypot(f.hl,f.hf))+.5;for(let i=Math.floor((f.x-R)/B);i<=Math.floor((f.x+R)/B);i++)for(let j=Math.floor((f.z-R)/B);j<=Math.floor((f.z+R)/B);j++){const k=i+','+j;(g.get(k)||g.set(k,[]).get(k)).push([f,c]);}}
 const cerca=(x,z)=>g.get(Math.floor(x/B)+','+Math.floor(z/B))||[];
 return {cerca,choca(x,z,r,pies=0){for(const [f,c] of cerca(x,z)){if(pies>=c.alto)continue;if(distForma(f,x,z)<r)return c;}return null;}};}
