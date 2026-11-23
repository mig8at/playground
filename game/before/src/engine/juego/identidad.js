// Quién es quién en la calle (2026-10-18, Miguel: «me preocupa que la policía sepa el nombre del ladrón y sólo siga a
// los nombres»). Puro: lo usan el 3D (persecucion3d, DemoView) y lo prueba validar-identidad.
//  · aspectoDe: lo que se VE de alguien —hombre o mujer (o niño), la prenda de encima con su color, el pantalón, el pelo
//    y la gorra—; la gente y los ladrones salen de las mismas plantillas de muñeco, así que por el aspecto no se los
//    distingue. La policía se reconoce por el uniforme.
//  · cartelDe: el cartel que sale al acercarse. Sin pedir papeles, sólo el aspecto: ni el nombre ni el oficio (antes salía
//    el nombre, y el del ladrón —inventado, nunca está en el censo— se buscaba en el censo del menú sin arriesgar nada).
//    Con los papeles pedidos (o si es de tu bando), el nombre, el oficio y la edad.
//  · identidadFalsa: la del ladrón, igual de forma que la de cualquiera —nombre y apellido, la edad y el oficio de alguien
//    que trabaja en la ciudad— pero con un nombre que no está en el censo (lo que descubre «Pedir papeles»).
import {nombreAlAzar,enCenso} from '../sociedad.js';

const PRENDA={camiseta:'camiseta',rayas:'camiseta a rayas',polo:'polo',camisa:'camisa',sudadera:'sudadera',vestido:'vestido',abrigo:'abrigo largo',chaleco:'chaleco',
 bufanda:'bufanda',deportivo:'pantalón deportivo',delantal:'delantal',overol:'overol',jean:'jean',pantalon:'pantalón',cargo:'pantalón cargo',bermuda:'bermuda',
 pantaloneta:'pantaloneta',leggings:'leggings',falda:'falda',gorra:'gorra',tenis:'tenis',botas:'botas',zapatos:'zapatos'};
// (el color de una prenda, por el más cercano de una lista de nombres que cualquiera usaría)
const COLOR=[['blanco','#f2f0ea'],['gris','#9aa0a6'],['negro','#2b2b2e'],['rojo','#c94f4f'],['vino','#7a2e3a'],['naranja','#e8823a'],['amarillo','#e9c84a'],['verde','#4f8f5a'],
 ['verde oliva','#7d8a4a'],['turquesa','#3a9a96'],['celeste','#8fbfe6'],['azul','#3b6bb0'],['azul oscuro','#2b3d5c'],['morado','#7a55a0'],['rosado','#e49ab0'],['café','#7a5236'],['beige','#d8c49a']];
const rgb=h=>[1,3,5].map(i=>parseInt(String(h||'#888888').slice(i,i+2),16)||0);
export const nombreColor=h=>{const a=rgb(h);let best=COLOR[0][0],bd=Infinity;for(const [n,c] of COLOR){const b=rgb(c),d=(a[0]-b[0])**2*.3+(a[1]-b[1])**2*.59+(a[2]-b[2])**2*.11;if(d<bd){bd=d;best=n;}}return best;};
const PELO={negro:'negro',castaño:'castaño',rubio:'rubio',canoso:'canoso',pelirrojo:'pelirrojo',cafe:'castaño',blanco:'canoso'};
const prenda=p=>p&&PRENDA[p.id]?`${PRENDA[p.id]} ${nombreColor(p.color)}`:null;

// lo que se ve: {titulo, detalle}
export function aspectoDe({look={},outfit={},nino=false,policia=false}={}){
 if(policia)return {titulo:'Agente de policía',detalle:'de uniforme'};
 const mujer=/Female/.test(look.modelo||look.pzPelo||''),quien=nino?(mujer?'Niña':'Niño'):(mujer?'Mujer':'Hombre');
 const arriba=prenda(outfit.outer)||prenda(outfit.top),abajo=outfit.top?.id==='vestido'?null:prenda(outfit.bottom);
 const calvo=look.peinado==='calvo'||look.peinado==='rapado',pelo=calvo?(look.peinado==='calvo'?'calvo':'rapado'):`pelo ${PELO[look.pelo]||look.pelo||'castaño'}`;
 return {titulo:arriba?`${quien} de ${arriba}`:quien,detalle:[abajo,pelo,prenda(outfit.hat)].filter(Boolean).join(' · ')};}

// el cartel: {nombre, oficio, edad} (lo que DemoView muestra: en negrita y debajo)
export function cartelDe({aspecto,identidad,documentado=false}){
 if(documentado&&identidad)return {nombre:identidad.nombre,oficio:identidad.oficio,edad:identidad.edad??null,documentado:true};
 return {nombre:aspecto.titulo,oficio:aspecto.detalle,edad:null,documentado:false};}

// la identidad falsa del ladrón: {nombre, oficio, edad}
export function identidadFalsa(S,r){let nombre=nombreAlAzar(r);for(let k=0;k<50&&enCenso(S,nombre);k++)nombre=nombreAlAzar(r);
 const trab=S.personas.filter(p=>p.rol==='trabaja'),w=trab.length?trab[Math.floor(r()*trab.length)]:null;
 return {nombre,oficio:w?w.oficio:'Sin trabajo',edad:w?Math.max(22,Math.min(64,w.edad+Math.round((r()-.5)*6))):30};}
