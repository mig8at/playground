// LA VIVIENDA SE ENTREGA VACÍA (2026-11-21, Miguel: «que los apartamentos no tengan sofás ni televisor: limpios, para que
// el usuario sea el que los modifica a su gusto; el baño y la cocina, eso sí»).
//
// El generador amuebla cada vivienda como si alguien viviera ahí, y eso sigue sirviendo: es lo que comprueba que el cuarto
// tiene buen tamaño y que los muebles caben. Pero lo que se vende es el lugar vacío. Esto saca de un plano ya armado todo
// lo que es de quien vive —camas, sofás, mesas, televisores, armarios, plantas— y deja lo que viene con la obra: los
// aparatos del baño y la cocina. No toca lo que no es vivienda (locales, oficinas, hoteles, depósitos, vestíbulos).
// No cambia el plano que recibe: devuelve otro, y dice cuánto sacó.
export const DE_OBRA=new Set(['inodoro','lavamanos','ducha','tina','meson','estufa','nevera','lavadora']);
// (los modelos de las casas del monte que son de obra: el baño y la cocina)
export const modeloDeObra=m=>/^(Bathroom_|Kitchen_)/.test(m||'');
const dentro=(f,q)=>f.x+f.w/2>=q.x&&f.x+f.w/2<=q.x+q.w&&f.y+f.h/2>=q.y&&f.y+f.h/2<=q.y+q.h;

// ¿Este cuarto es de una vivienda? Los de un departamento (tienen `unit`) y todos los de una casa.
export const esVivienda=(L,q)=>q.unit!=null||L.type==='casa';

export function entregaDe(bp){let sacados=0,quedan=0,viviendas=new Set();
 const lots=bp.lots.map(L=>({...L,levels:L.levels.map((lv,i)=>{const cuartos=lv.rooms.filter(q=>esVivienda(L,q));if(!cuartos.length)return lv;for(const q of cuartos)viviendas.add(L.id+':'+(q.unit!=null?i+':'+q.unit:'casa'));/* (el número de unidad se repite en cada piso) */
   const furniture=lv.furniture.filter(f=>{const q=cuartos.find(q=>dentro(f,q));if(!q||DE_OBRA.has(f.kind)){if(q)quedan++;return true;}sacados++;return false;});
   return {...lv,furniture};})}));
 return {...bp,lots,entrega:{sacados,quedan,viviendas:viviendas.size+(bp.isla?.casas||[]).filter(c=>c.spec).length}};}

// Lo mismo para una casa del monte (su `spec`, con el plano de hogar.js adentro): sin los muebles de quien vive.
export function entregaCasa(spec){const H=spec?.hogar;if(!H?.levels)return spec;return {...spec,hogar:{...H,levels:H.levels.map(lv=>({...lv,furniture:(lv.furniture||[]).filter(f=>DE_OBRA.has(f.kind))}))}};}
