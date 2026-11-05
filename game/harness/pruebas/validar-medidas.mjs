// Nivel 0 del probador (2026-10-16): las medidas no se contradicen. Cada regla tiene una sola fuente (medidas.js) y las
// que salen de otras tienen que seguir cuadrando con ellas; si una cambia y otra no, todo lo de abajo falla por una causa
// que acá se ve en una línea:
//  · el alcance (ALCANCE) es el del salto más un escalón, y todo mueble pisable se alcanza (su alto ≤ ALCANCE);
//  · la ladera (LADERA) sube lo de un muro de terraza (TERRAZA.escalon) por manzana, y esa pendiente cabe en la de las
//    calles (TERRAZA.pendiente), que es la que usa el generador (CARRETERA.grilla.gradoMax);
//  · la grilla del generador corta y rellena lo que dice TERRAZA.mover;
//  · el aterrizaje del dron queda más lejos de la fachada que lo que sale un balcón (1 m);
//  · la pintura queda por debajo del cordón (CALLE: la vereda sube 15 cm) y las franjas de una cebra entran en su paso;
//  · la calle del monte: dos medias manzanas y su calle hacen el paso de la grilla.
// Uso: node scripts/validar-medidas.mjs
import {ALCANCE,CIRCULACION,CHOQUE_MUEBLE,LADERA,TERRAZA,ATERRIZAJE,PINTURA,EQUIPAMIENTO,UBICACION} from '../src/engine/medidas.js';
import {CARRETERA} from '../src/engine/blueprint.js';

const fallas=new Map();let n=0;const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const pide=(ok,k,ej)=>{n++;if(!ok)falla(k,ej);};
const S=CIRCULACION.peaton.salto,alc=+(S.velocidad**2/(2*S.gravedad)+CIRCULACION.peaton.escalon).toFixed(2);
pide(Math.abs(ALCANCE-alc)<1e-9,'ALCANCE no es el salto más un escalón',{ALCANCE,calculado:alc});
for(const [k,m] of Object.entries(CHOQUE_MUEBLE))if(m.choque==='pisable')pide(m.alto<=ALCANCE+1e-9,'mueble pisable que no se alcanza',{mueble:k,alto:m.alto,ALCANCE});
pide(Math.abs(LADERA.muro-TERRAZA.escalon)<1e-9,'el muro de la ladera no es el de TERRAZA',{LADERA:LADERA.muro,TERRAZA:TERRAZA.escalon});
pide(Math.abs(LADERA.pendiente-LADERA.sube/LADERA.paso)<1e-9,'la pendiente de la ladera no es lo que sube por manzana',{pendiente:LADERA.pendiente,sube:LADERA.sube,paso:LADERA.paso});
// (la calle sube el muro en lo que no es cruce: el paso menos medio ancho de calle en cada punta)
const sube=LADERA.sube/(LADERA.paso-LADERA.calle)*100;
pide(sube<=TERRAZA.pendiente+1e-9,'la ladera pide calles más empinadas que TERRAZA.pendiente (en lo que suben)',{calle:+sube.toFixed(2),max:TERRAZA.pendiente});
const grados=Math.atan(TERRAZA.pendiente/100)*180/Math.PI;
pide(Math.abs(CARRETERA.grilla.gradoMax-grados)<.01,'el generador no usa la pendiente de TERRAZA',{gradoMax:CARRETERA.grilla.gradoMax,deTERRAZA:+grados.toFixed(2)});
pide(CARRETERA.grilla.corte===TERRAZA.mover&&CARRETERA.grilla.rellenoMax===TERRAZA.mover,'el generador no corta lo que dice TERRAZA.mover',{corte:CARRETERA.grilla.corte,rellenoMax:CARRETERA.grilla.rellenoMax,mover:TERRAZA.mover});
pide(CARRETERA.grilla.paso===LADERA.paso,'el paso de la grilla no es el de la ladera',{grilla:CARRETERA.grilla.paso,ladera:LADERA.paso});
pide(LADERA.paso===LADERA.calle+2*LADERA.mitad,'el paso no es una calle y dos medias manzanas',{paso:LADERA.paso,calle:LADERA.calle,mitad:LADERA.mitad});
pide(ATERRIZAJE.fachada>1,'el aterrizaje queda a menos de lo que sale un balcón',{fachada:ATERRIZAJE.fachada,balcon:1});
pide(PINTURA.alto>0&&PINTURA.alto<.15,'la pintura no queda entre el asfalto y el cordón',{alto:PINTURA.alto,cordon:.15});
pide(PINTURA.cebra.franja<PINTURA.cebra.paso,'las franjas de la cebra se pisan',PINTURA.cebra);
pide(EQUIPAMIENTO.cebra.ancho>0,'la cebra sin ancho',EQUIPAMIENTO.cebra);
pide(UBICACION.banda>=0&&UBICACION.cerca>UBICACION.banda,'la ubicación: la vía cercana más cerca que la banda',UBICACION);
// (para probar el probador: PROBAR_FALLA_ADREDE=1 hace fallar esta prueba y el probador tiene que cortar en el nivel 0)
if(process.env.PROBAR_FALLA_ADREDE)pide(false,'falla a propósito (PROBAR_FALLA_ADREDE)',{x:1,z:2});
console.log(`medidas · ${n} reglas cruzadas · ALCANCE ${ALCANCE} m · ladera ${(LADERA.pendiente*100).toFixed(1)} % con muros de ${LADERA.muro} m · calles hasta ${TERRAZA.pendiente} %`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
