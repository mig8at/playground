// Lo pintado, entre el navegador y la base (servidor/pintura.mjs, 2026-11-21). El plano y el paseo 3D leen y guardan por
// acá. La base manda; 'fuga.grafitis' del navegador queda como copia: es lo que se usa si el servidor no está (la versión
// compilada, sin /api) y lo que se sube la primera vez (lo pintado antes de que hubiera base).
import {conciliar,versionDeParedes,claveCiudad} from '../engine/grafiti.js';

const LOCAL='fuga.grafitis';
export const leerLocal=()=>{try{const o=JSON.parse(localStorage.getItem(LOCAL)||'{}');for(const k of Object.keys(o))for(const id of Object.keys(o[k]||{}))if(!o[k][id]?.t)delete o[k][id];return o;}catch{return {};}};
export const guardarLocal=o=>{try{localStorage.setItem(LOCAL,JSON.stringify(o));}catch{}};
const pedir=async(metodo,cuerpo,clave)=>{try{const r=await fetch('/api/pintura'+(metodo==='GET'?'?ciudad='+encodeURIComponent(clave):''),metodo==='GET'?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(cuerpo)});
  if(!/json/.test(r.headers.get('content-type')||''))return null;return await r.json();}catch{return null;}};

// Trae lo pintado de una ciudad y lo pone de acuerdo con sus paredes de HOY (engine/grafiti.js conciliar): lo vigente, lo
// que se mudó de número y lo que quedó huérfano; y deja la base igual. paredes: paredesDeLaCiudad(plano).
// Devuelve {vigentes, mudadas, huerfanas (cuántas, contando las ya apartadas), base (si contestó), version}.
export async function sincronizar(seed,team,paredes){const clave=claveCiudad(seed,team),todo=leerLocal(),local=todo[clave]||{},V=versionDeParedes(paredes),S=await pedir('GET',null,clave),hay=!!S&&!S.error;
 // (lo del navegador que la base no tiene: se sube; si están los dos, gana la base)
 const C=conciliar(paredes,hay?{...local,...S.paredes}:local);
 if(hay){const cambios={};for(const [n,s] of Object.entries(C.vigentes)){const b=S.paredes[n];if(!b||b.h!==s.h||b.t!==s.t)cambios[n]=s;}
  const mudadas=C.mudadas.filter(m=>S.paredes[m.de]),huerfanas=Object.keys(C.huerfanas).filter(n=>S.paredes[n]);
  if(Object.keys(cambios).length||mudadas.length||huerfanas.length||S.version!==V.version)await pedir('POST',{ciudad:clave,version:V.version,total:V.paredes,cambios,mudadas,huerfanas});}
 // (las huérfanas no se pierden: la base aparta las suyas, y las que sólo estaban en este navegador quedan en
 // 'fuga.grafitis.huerfanas', por ciudad)
 if(Object.keys(C.huerfanas).length)try{const H=JSON.parse(localStorage.getItem(LOCAL+'.huerfanas')||'{}');H[clave]={...(H[clave]||{}),...C.huerfanas};localStorage.setItem(LOCAL+'.huerfanas',JSON.stringify(H));}catch{}
 todo[clave]=C.vigentes;guardarLocal(todo);
 return {vigentes:C.vigentes,mudadas:C.mudadas,huerfanas:Object.keys(C.huerfanas).length+(hay?S.huerfanas:0),base:hay,version:V.version};}

// Guarda (o borra, con null) paredes recién pintadas. cambios: {numero: {h, cols, rows, t} | null}.
export async function guardarPintura(seed,team,cambios){if(!Object.keys(cambios).length)return {ok:true};const r=await pedir('POST',{ciudad:claveCiudad(seed,team),cambios});return r||{ok:false,razon:'La base no contestó: quedó sólo en este navegador.'};}
