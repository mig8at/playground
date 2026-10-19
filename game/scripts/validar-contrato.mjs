// Valida el contrato del 2D con el 3D (2026-10-16, src/engine/contrato3d.js y src/lib/plano3d.js), en node:
//  · uno a uno: cada árbol, palmera, sombrilla, pieza del equipamiento y botín del plano tiene su entrada, y nada más;
//  · cada entrada tiene con qué dibujarse: el OBJ en public/models (y en la lista que carga el 3D) o el objeto del
//    catálogo (objetos3d.js);
//  · lo que dibujaría el 3D —ubicar(), con las cajas reales de los OBJ— coincide con el plano: lugar, giro, copa, alto,
//    ancho, fondo y tronco (revisarContrato, la misma revisión que corre el navegador);
//  · igual por semilla.
// Uso: node scripts/validar-contrato.mjs [ciudades=4] [semilla0=1]
import {readFileSync,existsSync} from 'node:fs';
import * as THREE from 'three';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {generateBlueprint} from '../src/engine/blueprint.js';
import {contrato,OBJETO_EQUIPO} from '../src/engine/contrato3d.js';
import {ubicar,revisarContrato} from '../src/lib/plano3d.js';
import {OBJETOS} from '../src/lib/objetos3d.js';
import {NATURE2,PLANTS} from '../src/lib/nature3d.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||4),S0=+(A[1]||1);
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
const KIT={nature2:{dir:'public/models/Naturaleza2/',lista:NATURE2},plants:{dir:'public/models/Cultivos/',lista:PLANTS}};
// los modelos de los OBJ, como los arma el 3D al cargarlos (sus partes con el nombre de cada material, y la caja)
const modelos={},loader=new OBJLoader();
const modelo=(kit,m)=>{if(m in modelos)return modelos[m];const f=KIT[kit].dir+m+'.obj';if(!existsSync(f))return modelos[m]=null;
 const o=loader.parse(readFileSync(f,'utf8').replace(/^l .*$/gm,''));o.updateMatrixWorld(true);const parts=[];o.traverse(c=>{if(c.isMesh)parts.push({geometry:c.geometry,materials:c.material});});
 return modelos[m]={parts,box:new THREE.Box3().setFromObject(o)};};
const med={entradas:0,porModelo:{},fallasRev:{}};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3}),E=contrato(bp),V=bp.vegetacion,id={semilla:s};med.entradas+=E.length;
 if(JSON.stringify(contrato(generateBlueprint({seed:s,team:3})))!==JSON.stringify(E))falla('el contrato cambia entre dos corridas de la misma semilla',id);
 const placas=[...bp.lots,...(bp.isla.lots||[]).filter(l=>l.levels)].reduce((n,L)=>n+(L.levels?.find(l=>l.level===0)?.doors||[]).filter(d=>d.street&&d.direccion).length,0)+(bp.isla.casas||[]).filter(h=>h.direccion).length;
 const n2d=V.arboles.length+V.palmeras.length+V.sombrillas.length+bp.equipamiento.length+(bp.botines||[]).length+placas;
 for(const e of bp.equipamiento)if(!OBJETO_EQUIPO[e.tipo])falla('pieza del equipamiento sin objeto en el 3D',{...id,tipo:e.tipo});
 if(E.length!==n2d)falla('el contrato no tiene una entrada por cada cosa del plano',{...id,plano:n2d,contrato:E.length});
 for(const e of E){med.porModelo[e.modelo]=(med.porModelo[e.modelo]||0)+1;
  if(e.kit==='placa'){if(!/^(Cl|Kr|Ac|Ak) /.test(e.texto||''))falla('placa sin dirección',{...id});}
  else if(e.kit==='objeto'){if(!OBJETOS[e.modelo])falla('objeto que no está en el catálogo',{...id,modelo:e.modelo});}
  else{if(!modelo(e.kit,e.modelo))falla('modelo sin su OBJ',{...id,modelo:e.modelo});if(!KIT[e.kit].lista.includes(e.modelo))falla('modelo que el 3D no carga',{...id,modelo:e.modelo,kit:e.kit});}}
 // lo que dibujaría el 3D (con el suelo en 0: la altura la da el 3D, se revisa en el navegador)
 const registro=E.map(e=>{const u=ubicar(e,modelos);if(!u)return {id:e.id,modelo:e.modelo,falta:true};
  if(e.kit==='placa')return {id:e.id,modelo:'placa',x:e.x,z:e.z,ry:e.ang,ancho:u.ancho,fondo:u.fondo,alto:u.alto,texto:e.texto};
  return e.kit==='objeto'?{id:e.id,modelo:e.modelo,x:e.x,z:e.z,ry:e.ang,ancho:u.ancho,fondo:u.fondo,alto:u.alto}:{id:e.id,modelo:e.modelo,x:u.tx,z:u.tz,ry:e.ang,ancho:u.ancho,fondo:u.fondo,alto:u.alto,tronco:u.tronco};});
 const rev=revisarContrato(E,registro);
 for(const f of rev.fallas){const e=E.find(q=>q.id===f.id);const k=`${f.que} (${e?.modelo})`;med.fallasRev[k]=(med.fallasRev[k]||0)+1;falla(`el 3D lo dibujaría ${f.que}`,{...id,...f,modelo:e?.modelo});}}
console.log(`${N} ciudades · ${med.entradas} entradas del contrato · modelos: ${Object.entries(med.porModelo).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+' '+v).join(', ')}`);
if(Object.keys(med.fallasRev).length)console.log('desvíos por modelo: '+Object.entries(med.fallasRev).map(([k,v])=>k+': '+v).join(' · '));
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
