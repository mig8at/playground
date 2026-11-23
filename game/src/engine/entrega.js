// LA VIVIENDA SE ENTREGA VACÍA (2026-11-21, Miguel: «que los apartamentos no tengan sofás ni televisor: limpios, para que
// el usuario sea el que los modifica a su gusto; el baño y la cocina, eso sí»).
//
// El generador amuebla cada vivienda como si alguien viviera ahí, y eso sigue sirviendo: es lo que comprueba que el cuarto
// tiene buen tamaño y que los muebles caben. Pero lo que se vende es el lugar vacío. Esto saca de un plano ya armado todo
// lo que es de quien vive —camas, sofás, mesas, televisores, armarios, plantas, y los aparatos que se compran— y deja lo que
// viene con la obra: el baño y el mesón de la cocina. (Hasta el 2026-11-22 no tocaba lo que no es vivienda; ahora vacía todo: ver entregaDe.)
// No cambia el plano que recibe: devuelve otro, y dice cuánto sacó.
// (2026-11-22, Miguel: «cuando hablamos de cocinas hablamos del mesón, no la nevera y la estufa: será decisión del usuario
// comprarlas o no; no debería haber estufas, neveras, etc., sólo lo que normalmente viene con la casa, como ducha, lavaplatos,
// inodoro». La casa viene con el baño —inodoro, lavamanos, ducha, tina— y el mesón de la cocina con su lavaplatos; la estufa,
// la nevera y la lavadora se compran. El plano sigue guardando su lugar —ver colocar.js—, pero no se entregan)
export const DE_OBRA=new Set(['inodoro','lavamanos','ducha','tina','meson']);
// (lo que tiene su lugar fijo en el plano: la obra y los aparatos que se compran —su toma, su desagüe—; nada se pone encima)
export const LUGAR_FIJO=new Set([...DE_OBRA,'estufa','nevera','lavadora']);
// (los modelos de las casas del monte que son de obra: el baño y la cocina)
export const modeloDeObra=m=>/^(Bathroom_|Kitchen_)/.test(m||'');

// ¿Este cuarto es de una vivienda? Los de un departamento (tienen `unit`) y todos los de una casa.
export const esVivienda=(L,q)=>q.unit!=null||L.type==='casa';

// (2026-11-22, Miguel: «sigo viendo muebles en la ciudad y no quiero eso: la idea es primero tener las calibraciones sólo
// con los baños y cocinas, como una casa lista a la venta sin inmobiliario adentro»): se vacía TODO edificio —locales,
// oficinas, hoteles, colegios, pasillos, los barrios del monte—, no sólo las viviendas; queda lo de obra, en cualquier cuarto.
export function entregaDe(bp){let sacados=0,quedan=0,viviendas=new Set();
 const vaciar=lotes=>lotes.map(L=>!L.levels?L:({...L,levels:L.levels.map((lv,i)=>{for(const q of lv.rooms)if(esVivienda(L,q))viviendas.add(L.id+':'+(q.unit!=null?i+':'+q.unit:'casa'));/* (el número de unidad se repite en cada piso) */
   const furniture=lv.furniture.filter(f=>{if(DE_OBRA.has(f.kind)){quedan++;return true;}sacados++;return false;});
   return {...lv,furniture};})}));
 const lots=vaciar(bp.lots),isla=bp.isla?.barrios?{...bp.isla,barrios:bp.isla.barrios.map(b=>b.lotes?{...b,lotes:vaciar(b.lotes)}:b)}:bp.isla;
 return {...bp,lots,isla,entrega:{sacados,quedan,viviendas:viviendas.size+(bp.isla?.casas||[]).filter(c=>c.spec).length}};}

// Lo mismo para una casa del monte (su `spec`, con el plano de hogar.js adentro): sin los muebles de quien vive.
export function entregaCasa(spec){const H=spec?.hogar;if(!H?.levels)return spec;return {...spec,hogar:{...H,levels:H.levels.map(lv=>({...lv,furniture:(lv.furniture||[]).filter(f=>DE_OBRA.has(f.kind))}))}};}
