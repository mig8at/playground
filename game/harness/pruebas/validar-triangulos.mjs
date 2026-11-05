// Nivel 6 del probador (2026-10-16, Miguel: «dónde quedan triángulos que nunca se ven, para borrarlos»): arma la isla
// del 3D sin pantalla y revisa cada triángulo de cada malla (también los de cada instancia):
//  · degenerado: sin área (no se ve nunca);
//  · repetido: los mismos tres vértices que otro (al milímetro): se dibuja dos veces y titila;
//  · enterrado: sus tres vértices y su centro, más de 5 cm debajo del suelo de otra malla (las «suelo:…» de island3d:
//    opacas, y por debajo no se llega): nunca se ve.
// Da, por malla, cuántos triángulos tiene y cuántos sobran. Fallan los degenerados, los repetidos y los enterrados de
// más que TOPE (una parte de las mallas grandes —el terreno— queda debajo de terrazas y calles por diseño; se mide).
// Uso: node scripts/validar-triangulos.mjs [ciudades=1] [semilla0=1] [--ver]
import {armarIsla,armarMundo} from './sin-pantalla.mjs';
import {indiceTriangulos} from './medir3d.mjs';
import * as THREE from 'three';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||1),S0=+(A[1]||1),VER=process.argv.includes('--ver'),MUNDO=process.argv.includes('--mundo');// (--mundo: el mundo entero —ciudad, barrios, casas, viviendas, plano—, no sólo la isla)
// (la fracción de enterrados que se tolera por malla de más de 200 triángulos: 5 %. Medido 2026-10-16 en la ciudad 1:
// el terreno tenía 14 % —5350 debajo de terrazas y calles— y se dejó de dibujar; hoy ninguna pasa del 3 %)
const TOPE=+(process.env.TOPE_ENTERRADOS??.05);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const por={};let total=0,deg=0,dup=0,ent=0,ocultas=0,degModelo=0,repModelo=0,pegadas=0;
for(let s=S0;s<S0+N;s++){const W0=MUNDO?await armarMundo(s):null,isla=MUNDO?{group:W0.grupo}:(await armarIsla(s)).isla,suelo=indiceTriangulos(isla.group,{saltar:o=>!o.name?.startsWith('suelo:'),arriba:true});
 const v=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()],c=new THREE.Vector3(),e1=new THREE.Vector3(),e2=new THREE.Vector3(),M=new THREE.Matrix4(),Im=new THREE.Matrix4(),vistos=new Map();
 isla.group.updateMatrixWorld(true);
 // (pieza: cada malla o cada instancia, para distinguir un defecto del modelo —una cara sin área o repetida dentro de la
 // misma pieza, que se copia en cada instancia— de dos piezas puestas en el mismo lugar)
 let pieza=0;const pares=new Set();
 const mira=(geo,mat,nombre,desde=0,cuantos=null,instancia=false)=>{const p=geo.attributes.position,ix=geo.index,n=cuantos??(ix?ix.count:p.count),R=por[nombre]||(por[nombre]={tri:0,enterrados:0,repetidos:0,degenerados:0,ocultas:0,repModelo:0,degModelo:0});
  const yo=++pieza;
  // una instancia con escala cero es una pieza escondida a propósito (la cortina abierta): no se dibuja nada de ella
  if(instancia&&Math.abs(mat.determinant())<1e-9){R.ocultas++;ocultas++;R.tri+=n/3;total+=n/3;return;}
  const sin=nombre.startsWith('suelo:')?suelo.nombres.indexOf(nombre):-1;
  for(let i=desde;i<desde+n;i+=3){for(let k=0;k<3;k++)v[k].fromBufferAttribute(p,ix?ix.getX(i+k):i+k).applyMatrix4(mat);R.tri++;total++;
   e1.subVectors(v[1],v[0]);e2.subVectors(v[2],v[0]);if(e1.cross(e2).length()/2<1e-6){if(instancia){R.degModelo++;degModelo++;}else{R.degenerados++;deg++;falla('triángulo sin área',{semilla:s,malla:nombre});}continue;}
   const k=v.map(q=>q.x.toFixed(3)+','+q.y.toFixed(3)+','+q.z.toFixed(3)).sort().join('|'),otro=vistos.get(k);
   // (la orientación de la cara: dos caras en el mismo lugar mirando a lados opuestos son dos piezas que se tocan —el canto
   // de dos hojas de una puerta doble en la junta—, escondidas entre sí; mirando al mismo lado, se pelean y titilan)
   const nrm=e1.clone().cross(e2).normalize(),ori=nrm.x*1e6+nrm.y*1e3+nrm.z;
   if(otro&&otro.yo!==yo&&Math.sign(otro.n.dot(nrm))<0){R.pegadas=(R.pegadas||0)+1;pegadas++;}
   else if(otro){if(otro.yo===yo){R.repModelo++;repModelo++;}else{R.repetidos++;dup++;const pk=Math.min(otro.yo,yo)+'-'+Math.max(otro.yo,yo);if(!pares.has(pk)){pares.add(pk);falla('dos piezas en el mismo lugar mirando al mismo lado (titilan)',{semilla:s,malla:nombre,con:otro.nombre,en:[+v[0].x.toFixed(2),+v[0].y.toFixed(2),+v[0].z.toFixed(2)]});}}}
   else vistos.set(k,{yo,nombre,n:nrm});
   // (una cara parada —un muro— se mira 10 cm hacia cada lado: lo que la tapa es el suelo de delante, no el de su borde)
   c.copy(v[0]).add(v[1]).add(v[2]).multiplyScalar(1/3);const parada=Math.abs(e1.subVectors(v[1],v[0]).cross(e2.subVectors(v[2],v[0])).normalize().y)<.5,nx=e1.x,nz=e1.z,nl=Math.hypot(nx,nz)||1;
   const lados=parada?[[nx/nl*.1,nz/nl*.1],[-nx/nl*.1,-nz/nl*.1]]:[[0,0]];let bajo=true;
   for(const [ox,oz] of lados){for(const q of [v[0],v[1],v[2],c]){const a=suelo.arriba(q.x+ox,q.z+oz,false,sin);if(!(a.y>q.y+.05)){bajo=false;break;}}if(!bajo)break;}
   if(bajo){R.enterrados++;ent++;if(process.env.VER_MALLA===nombre&&(R.ej=R.ej||[]).length<6)R.ej.push(v.map(q=>[+q.x.toFixed(2),+q.y.toFixed(2),+q.z.toFixed(2)]));}}};
 // (sin nombre: el material y cuántos vértices tiene el modelo, para saber de qué se trata)
 isla.group.traverse(o=>{if(!o.isMesh)return;const mt=[o.material].flat()[0],nombre=o.name||`(${mt?.name||'#'+(mt?.color?.getHexString?.()||'?')} · ${o.geometry?.attributes?.position?.count||0} v)`;if(o.isBatchedMesh){for(let i=0;i<o.instanceCount;i++){try{if(!o.getVisibleAt(i))continue;}catch{continue;}o.getMatrixAt(i,Im);M.multiplyMatrices(o.matrixWorld,Im);const r=o.getGeometryRangeAt(o.getGeometryIdAt(i));mira(o.geometry,M,nombre+' ·lote',r.start,r.count,true);}}else if(o.isInstancedMesh){for(let i=0;i<o.count;i++){o.getMatrixAt(i,Im);M.multiplyMatrices(o.matrixWorld,Im);mira(o.geometry,M,nombre+' ·inst',0,null,true);}}else mira(o.geometry,o.matrixWorld,nombre);});}
// (el tope, para la geometría propia —mallas armadas por el 3D—; un modelo instanciado —un árbol en la ladera, con la base
// del tronco y alguna rama metidas en la tierra— se mide pero no falla)
for(const [k,r] of Object.entries(por))if(r.tri>200&&!/·(inst|lote)$/.test(k)&&r.enterrados/r.tri>TOPE)falla('malla con más triángulos enterrados que el tope',{malla:k,enterrados:r.enterrados,de:r.tri,pct:+(100*r.enterrados/r.tri).toFixed(1)});
console.log(`triángulos · ${MUNDO?'mundo entero':'isla'} · ${N} ciudad(es) · ${Math.round(total)} triángulos: ${ent} enterrados (${(100*ent/total).toFixed(1)} %), ${dup} de piezas en el mismo lugar que titilan, ${pegadas} caras pegadas entre dos piezas (escondidas entre sí), ${deg} sin área · de los modelos (se copian en cada instancia): ${degModelo} sin área, ${repModelo} repetidas · ${ocultas} instancias escondidas con escala cero`);
for(const [k,r] of Object.entries(por).sort((a,b)=>b[1].enterrados-a[1].enterrados).slice(0,VER?99:8))console.log(`  ${k.padEnd(26)} ${String(Math.round(r.tri)).padStart(7)} · enterrados ${String(r.enterrados).padStart(6)} (${(100*r.enterrados/r.tri).toFixed(0).padStart(3)} %) · puestas dos veces ${r.repetidos} · sin área ${r.degenerados} · del modelo: sin área ${r.degModelo}, repetidas ${r.repModelo} · escondidas ${r.ocultas}`);
for(const [k,r] of Object.entries(por))if(r.ej)console.log(`  ejemplos de ${k}: ${JSON.stringify(r.ej)}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
