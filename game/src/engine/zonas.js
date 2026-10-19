// ======== Las zonas del mundo: qué hay en un punto (2026-10-16, idea de Miguel) ========
// Un solo clasificador para todo el mundo: dado un punto (x, z) del plano, el conjunto de zonas en que cae. Lo usan el
// validador de zonas (scripts/validar-zonas.mjs), con la tabla ZONAS de medidas.js (qué objeto no puede ir dónde), y lo
// pueden usar los generadores. Las zonas:
//  vacio (más allá del borde de la isla) · agua · franja_agua (a menos de VEGETACION.sombrilla.agua del agua) · playa
//  (casilla de playa con terreno de playa, VEGETACION.arena) · edificio (la planta de un lote, de un edificio del monte o
//  el cuerpo de una casa) · calzada · vereda · cebra (los pasos de cebra del equipamiento) · puerta (la franja delante
//  de una puerta de calle: de lo ancho de la puerta más ZONAS.puerta.lado a cada lado, y ZONAS.puerta.fondo hacia
//  afuera) · escalinata · mirador · pasaje (los de las manzanas del monte) · y lo que hay en la casilla: plaza, patio
//  (de la ciudad), parque, borde (el verde junto al muro), lote (los de las manzanas del monte: jardines), monte, pradera, paseo (la franja junto al muro, por fuera).
import {CALLE,VEGETACION as V,ZONAS} from './medidas.js';
import City from './ciudad.js';
import {CELL} from './veredas.js';
import {islaDe,mascaraRebaje,WATER} from './isla.js';
import {cuerpoCasa} from './circulacion.js';

const segDist=(x,z,a,b)=>{const dx=b.x-a.x,dz=b.z-a.z,L=dx*dx+dz*dz;let t=L?((x-a.x)*dx+(z-a.z)*dz)/L:0;t=Math.max(0,Math.min(1,t));return Math.hypot(x-a.x-t*dx,z-a.z-t*dz);};
// (una grilla de cubetas de 12 m para buscar rápido lo que está cerca de un punto)
const cubetas=(items,box)=>{const B=12,g=new Map();for(const it of items){const b=box(it);for(let i=Math.floor(b[0]/B);i<=Math.floor(b[2]/B);i++)for(let j=Math.floor(b[1]/B);j<=Math.floor(b[3]/B);j++){const k=i+','+j;(g.get(k)||g.set(k,[]).get(k)).push(it);}}
 return (x,z)=>g.get(Math.floor(x/B)+','+Math.floor(z/B))||[];};

// (cebras: las del equipamiento que se está armando, si todavía no está en bp)
export function mapaDeZonas(bp,{cebras:cebras0=null}={}){const m=bp.map,I=bp.isla,{W,H}=m,K=City.K,Wm=W*CELL,Hm=H*CELL,E=1e-6;
 const T=islaDe(m);T.setMascara(mascaraRebaje(I?.huella||[]));
 const cel=new Map((I?.cells||[]).map(c=>[c.x+','+c.y,c])),at=(x,z)=>cel.get(Math.floor(x/CELL)+','+Math.floor(z/CELL));
 const kind=(x,z)=>{const cx=Math.floor(x/CELL),cy=Math.floor(z/CELL);return cx<0||cy<0||cx>=W||cy>=H?null:m.kind[cy*W+cx];},calle=k=>k===K.street||k===K.avenue;
 const enCiudad=(x,z)=>x>=0&&z>=0&&x<Wm&&z<Hm;
 // los edificios: lotes de la ciudad, edificios del monte y cuerpos de las casas
 const rects=[...bp.lots.flatMap(L=>L.parts||[]).map(p=>[p.x,p.y,p.x+p.w,p.y+p.h]),...(I?.lots||[]).filter(L=>L.parts).flatMap(L=>L.parts).map(p=>[p.x,p.y,p.x+p.w,p.y+p.h]),
  ...(I?.casas||[]).map(h=>{const c=cuerpoCasa(h);return [c.x0,c.z0,c.x1,c.z1];})],rectsEn=cubetas(rects,r=>r);
 // las calles del monte (y la escalinata): sus ejes con su ancho
 const ejes=(I?.carreteras||[]).filter(c=>c.puntos&&c.tipo==='grilla').flatMap(c=>c.puntos.slice(1).map((b,i)=>({a:c.puntos[i],b,an:c.ancho||12}))),ejesEn=cubetas(ejes,g=>[Math.min(g.a.x,g.b.x)-g.an,Math.min(g.a.z,g.b.z)-g.an,Math.max(g.a.x,g.b.x)+g.an,Math.max(g.a.z,g.b.z)+g.an]);
 // las puertas de calle: de los lotes de la ciudad (segmento en el borde del lote) y de las casas (su punto y hacia afuera)
 const P=ZONAS.puerta,puertas=[];
 for(const L of [...bp.lots,...(I?.lots||[]).filter(L=>L.levels)])for(const d of L.levels?.[0]?.doors||[]){if(!d.street)continue;const hz=Math.abs(d.y1-d.y0)<E,mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2,an=Math.hypot(d.x1-d.x0,d.y1-d.y0)/2;
  // hacia afuera: el lado donde no está el lote
  const dentro=(x,z)=>(L.parts||[]).some(p=>x>p.x&&x<p.x+p.w&&z>p.y&&z<p.y+p.h),nx=hz?0:(dentro(mx+.3,mz)?-1:1),nz=hz?(dentro(mx,mz+.3)?-1:1):0;puertas.push({x:mx,z:mz,nx,nz,an});}
 for(const h of I?.casas||[]){const c=cuerpoCasa(h);puertas.push({x:c.puerta.x,z:c.puerta.z,nx:c.afuera.x,nz:c.afuera.z,an:.5});}
 const puertasEn=cubetas(puertas,d=>[d.x-6,d.z-6,d.x+6,d.z+6]);
 // los pasos de cebra (rectángulos girados: largo a lo ancho de la calle)
 const cebras=(cebras0||bp.equipamiento||[]).filter(e=>e.tipo==='cebra'),cebrasEn=cubetas(cebras,e=>[e.x-e.largo,e.z-e.largo,e.x+e.largo,e.z+e.largo]);
 const pasajes=(I?.grilla?.pasajes||[]).map(p=>p.vert?[p.u0,p.d0,p.u1,p.d1]:[p.d0,p.u0,p.d1,p.u1]),pasajesEn=cubetas(pasajes,r=>r);
 const aguaC=c=>c&&(c.zona==='agua'||c.zona==='agua_honda');
 const aAgua=(x,z,d)=>{const i0=Math.floor((x-d)/CELL)-1,i1=Math.floor((x+d)/CELL)+1,j0=Math.floor((z-d)/CELL)-1,j1=Math.floor((z+d)/CELL)+1;
  for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){if(!aguaC(cel.get(i+','+j)))continue;if(Math.hypot(Math.max(i*CELL-x,0,x-(i+1)*CELL),Math.max(j*CELL-z,0,z-(j+1)*CELL))<d)return true;}return false;};

 function zonas(x,z){const out=new Set(),q=at(x,z);
  if(!enCiudad(x,z)){if(T.beyond(x,z)>0)out.add('vacio');const h=T.height(x,z);if(aguaC(q)||(!q&&h<WATER))out.add('agua');}
  if(!out.has('agua')&&aAgua(x,z,V.sombrilla.agua))out.add('franja_agua');
  if(q?.zona==='playa'&&!q.carretera&&!q.lote){const h=T.height(x,z);if(T.beyond(x,z)<=-V.arena.borde&&h>=V.arena.alto[0]&&h<=V.arena.alto[1])out.add('playa');}
  if(rectsEn(x,z).some(r=>x>r[0]+E&&x<r[2]-E&&z>r[1]+E&&z<r[3]-E))out.add('edificio');
  if(enCiudad(x,z)){const k=kind(x,z);if(calle(k)){const cx=Math.floor(x/CELL),cy=Math.floor(z/CELL),dd=[[z-cy*CELL,0,-1],[(cy+1)*CELL-z,0,1],[x-cx*CELL,-1,0],[(cx+1)*CELL-x,1,0]];
    out.add(dd.some(([d,dx,dy])=>d<=CALLE.vereda+E&&!calle(kind(x+dx*CELL,z+dy*CELL)))?'vereda':'calzada');}}
  else for(const g of ejesEn(x,z)){const d=segDist(x,z,g.a,g.b),cz=(g.an-2*CALLE.vereda)/2;if(d<cz-E){out.add('calzada');break;}if(d<g.an/2-E)out.add('vereda');}
  if(out.has('calzada'))out.delete('vereda');
  for(const e of cebrasEn(x,z)){const ca=Math.cos(e.ang||0),sa=Math.sin(e.ang||0),u=(x-e.x)*ca+(z-e.z)*sa,v=-(x-e.x)*sa+(z-e.z)*ca;if(Math.abs(u)<e.largo/2&&Math.abs(v)<e.fondo/2){out.add('cebra');break;}}
  for(const d of puertasEn(x,z)){const ax=x-d.x,az=z-d.z,fuera=ax*d.nx+az*d.nz,lado=Math.abs(ax*d.nz-az*d.nx);if(fuera>-.05&&fuera<P.fondo&&lado<d.an+P.lado){out.add('puerta');break;}}
  if(q?.escalinata)out.add('escalinata');if(q?.mirador)out.add('mirador');
  // (lo que hay en la casilla: para las zonas donde SÍ puede ir algo)
  if(enCiudad(x,z)){const k=kind(x,z);if(k===K.plaza)out.add('plaza');else if(k===K.courtyard)out.add('patio');}
  // (el paseo: la franja junto al muro, por fuera, a menos de una casilla de la ciudad)
  if(!enCiudad(x,z)&&Math.max(-x,x-Wm,-z,z-Hm)<CELL&&!out.has('agua'))out.add('paseo');
  else if(q){if(q.parque)out.add('parque');else if(q.borde)out.add('borde');else if(q.lote)out.add('lote');else if(!q.carretera&&q.zona==='montaña')out.add('monte');else if(!q.carretera&&q.zona==='pradera')out.add('pradera');}
  if(pasajesEn(x,z).some(r=>x>r[0]+E&&x<r[2]-E&&z>r[1]+E&&z<r[3]-E))out.add('pasaje');
  return out;}
 return {zonas};}

// Los puntos que ocupa un objeto en el piso (para ver en qué zonas cae): su centro y su borde (un círculo de radio r, o
// el rectángulo largo × fondo girado por ang —el largo va a (cos ang, sin ang)—).
export function huella(o,r){if(o.largo&&o.fondo){const ca=Math.cos(o.ang||0),sa=Math.sin(o.ang||0),pts=[[0,0]];for(const u of [-.5,0,.5])for(const v of [-.5,0,.5])if(u||v)pts.push([u*o.largo,v*o.fondo]);
  return pts.map(([u,v])=>[o.x+u*ca-v*sa,o.z+u*sa+v*ca]);}
 return [[o.x,o.z],...(r?[0,1,2,3,4,5,6,7].map(i=>[o.x+r*Math.cos(i*Math.PI/4),o.z+r*Math.sin(i*Math.PI/4)]):[])];}

// Las zonas prohibidas en que cae un objeto (y 'fuera de su zona' si su centro no pisa ninguna de las suyas), según
// ZONAS.objetos[tipo]. Vacío: está permitido. Lo usan los generadores (no ponen lo que cae mal) y el validador.
// (sub: el subtipo —el tipo de árbol, el farol peatonal—: R.donde[sub] dice dónde SÍ puede ir)
export function prohibidasDe(Z,o,tipo=o.tipo,sub=o.sub){const R=ZONAS.objetos[tipo];if(!R)return ['sin reglas'];const out=new Set();
 for(const [x,z] of huella(o,o.largo&&o.fondo?0:R.r))for(const q of Z.zonas(x,z))if(R.prohibidas.includes(q))out.add(q);
 const solo=R.donde?.[sub??'']??R.solo;if(solo){const c=Z.zonas(o.x,o.z);if(!solo.some(q=>c.has(q)))out.add('fuera de su zona');}
 return [...out];}
