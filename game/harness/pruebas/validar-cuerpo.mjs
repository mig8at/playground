// Nivel 9 del probador (2026-10-17, Miguel: «solo con poder cambiarse la ropa y el pelo, barba… dejamos el cuerpo por
// defecto»): un solo cuerpo, el del muñeco del paquete (vestuario.js CUERPO_UNICO).
//  · la contextura única no deforma el muñeco (persona3d CONTEXTURAS: sin multiplicadores), la escala es 1 y la mujer
//    tampoco se deforma (sin el ajuste MUJER: shapeBody devuelve la misma geometría);
//  · cada look de la gente (characters3d lookFor, de todos los modelos con muchas semillas) sale con esa contextura;
//  · sin género (2026-10-17, Miguel: «quitemos lo de hombre y mujer»): ningún look lleva sexo; los de los modelos de
//    mujer llevan también peinados de hombre y barba, y los de hombre peinados de mujer; y la ropa (outfitFor) pone
//    vestidos y faldas en los de hombre y pantalones de hombre en los de mujer.
// Uso: node scripts/validar-cuerpo.mjs [semillas=2000]
import {CUERPO_UNICO} from '../src/engine/vestuario.js';
import {CONTEXTURAS,shapeBody} from '../src/lib/persona3d.js';
import * as THREE from 'three';
import {lookFor,outfitFor,CIVILS} from '../src/lib/characters3d.js';

const N=+(process.argv[2]||2000);const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const rng=s=>()=>(s=(s*16807)%2147483647)/2147483647;
const C=CONTEXTURAS[CUERPO_UNICO.contextura];
if(!C)falla('la contextura única no existe en persona3d',{contextura:CUERPO_UNICO.contextura});else if(Object.keys(C).length)falla('la contextura única deforma el muñeco',{contextura:CUERPO_UNICO.contextura,huesos:Object.keys(C)});
// (con un esqueleto vacío: si shapeBody intenta deformar, o devuelve otra geometría o revienta; las dos son falla)
{const g=new THREE.BufferGeometry();for(const sexo of ['h','m']){let otra;try{otra=shapeBody(g,{bones:[],boneInverses:[]},{contextura:CUERPO_UNICO.contextura,sexo})!==g;}catch{otra=true;}if(otra)falla('el cuerpo único deforma el muñeco',{sexo});}}
if(CUERPO_UNICO.escala!==1)falla('la escala del cuerpo no es la del muñeco',{escala:CUERPO_UNICO.escala});
const modelos=[...new Set(CIVILS)];let looks=0;const otras={};
const cruza={pelo:{h:new Set(),m:new Set()},barba:{h:0,m:0},ropa:{h:new Set(),m:new Set()}};
for(let s=1;s<=N;s++){const m=modelos[s%modelos.length],L=lookFor(m,rng(s*7919+1)),g=/Female/.test(m)?'m':'h';looks++;
 if('sexo' in L)falla('look con sexo',{modelo:m,semilla:s,sexo:L.sexo});
 if(L.pzPelo)cruza.pelo[g].add(/_Female/.test(L.pzPelo)?'m':'h');if(L.pzBigote||L.barba)cruza.barba[g]++;
 const o=outfitFor(L,rng(s*104729+3));for(const k of ['top','bottom'])if(o[k])cruza.ropa[g].add(o[k].id);if(L.contextura!==CUERPO_UNICO.contextura){otras[L.contextura]=(otras[L.contextura]||0)+1;falla('look con otra contextura',{modelo:m,semilla:s,contextura:L.contextura});}}
if(cruza.pelo.m.size<2||cruza.pelo.h.size<2)falla('el peinado depende del modelo (hombre o mujer)',{deMujer:[...cruza.pelo.m],deHombre:[...cruza.pelo.h]});
if(!cruza.barba.m||!cruza.barba.h)falla('la barba depende del modelo',cruza.barba);
for(const [g,ids] of [['h',['vestido','falda-corta','falda-larga']],['m',['cargo','pantaloneta']]])if(!ids.some(i=>cruza.ropa[g].has(i)))falla('la ropa depende del modelo',{modelo:g==='h'?'hombre':'mujer',falta:ids});
console.log(`cuerpo · sin género: peinados de hombre y de mujer en los dos (${[...cruza.pelo.h]}/${[...cruza.pelo.m]}), barba en ${cruza.barba.h}+${cruza.barba.m}, ${cruza.ropa.h.size}/${cruza.ropa.m.size} prendas`);
console.log(`cuerpo · un solo cuerpo: contextura «${CUERPO_UNICO.contextura}» (${C?Object.keys(C).length:'?'} huesos deformados), escala ${CUERPO_UNICO.escala}, mujer ${CUERPO_UNICO.ajusteMujer?'con':'sin'} ajuste · ${looks} looks de ${modelos.length} modelos, ${looks-Object.values(otras).reduce((a,b)=>a+b,0)} con el cuerpo único`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
