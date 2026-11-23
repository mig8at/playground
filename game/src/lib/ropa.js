/* La ropa como datos (2026-11-22, Miguel: «saca todos los muñecos anteriores… para dejar lo que vamos a dejar»). El catálogo
   de prendas del vestier viejo (before/src/lib/vestier3d.js GARMENTS) sin su geometría: el id, el nombre, el lugar y el
   color de cada una. Los personajes nuevos (personajes3d.js) no se visten con piezas: cada vértice tiene su zona —camisa,
   antebrazo, pantalón, pantorrilla, zapatos— y un atuendo se vuelve la paleta de esas zonas (zonasDeRopa). Lo usan el menú
   de cambiarse de ropa, el perfil, el retrato («sudadera con capucha roja, jean azul») y el uniforme de la policía. */

// (id, nombre, lugar, color de fábrica)
export const GARMENTS=[
 ['boxer','Bóxer','underwear','#343d50'],
 ['camiseta','Camiseta','top','#7fb2d6'],['rayas','Camiseta a rayas','top','#f2f0ea'],['manga-larga','Manga larga','top','#c4553d'],
 ['sin-mangas','Sin mangas','top','#f2f0ea'],['polo','Polo','top','#4f8a55'],['camisa','Camisa de botones','top','#f2f0ea'],
 ['sudadera','Sudadera','top','#8a8e90'],['sudadera-capucha','Sudadera con capucha','top','#6b4a8a'],['vestido','Vestido','top','#c4553d'],
 ['delantal','Delantal','outer','#c8b48f'],['chaleco','Chaleco','outer','#6e5a3c'],['chaqueta-abierta','Chaqueta abierta','outer','#3f566e'],
 ['abrigo','Abrigo largo','outer','#6e4e35'],['chaqueta-cremallera','Chaqueta con cremallera','outer','#2b3d5c'],
 ['overol','Overol','bottom','#3f6fa8'],['jean','Jean','bottom','#3d5370'],['pantalon','Pantalón de tela','bottom','#26282a'],
 ['deportivo','Pantalón deportivo','bottom','#7d8284'],['cargo','Cargo','bottom','#5c6340'],['leggings','Leggings','bottom','#26282a'],
 ['bermuda','Bermuda','bottom','#c8b48f'],['pantaloneta','Pantaloneta','bottom','#2b3549'],['falda-corta','Falda corta','bottom','#7a2e33'],
 ['falda-larga','Falda a la rodilla','bottom','#3f566e'],
 ['bufanda','Bufanda','accessory','#b8443a'],['gorro-lana','Gorro de lana','hat','#3a6f8f'],['gorra','Gorra','hat','#c4553d'],
 ['tenis','Tenis','shoes','#34507a'],['botas','Botas','shoes','#5b3b25'],['zapatos','Zapatos','shoes','#232425'],
].map(([id,label,slot,color])=>({id,label,slot,color}));
export const SLOTS=[['top','Arriba'],['outer','Encima'],['bottom','Abajo'],['shoes','Calzado'],['hat','Cabeza'],['accessory','Cuello'],['underwear','Interior']];
export const PALETTE=['#f2f0ea','#c9c9c4','#8a8e90','#2f3133','#c4553d','#7a2e33','#d9793a','#e0b83a','#4f8a55','#6b7340','#3a9a96','#7fb2d6','#3f6fa8','#2b3d5c','#6b4a8a','#d98aa0','#6e4e35','#c8b48f'];
export const garmentById=id=>GARMENTS.find(g=>g.id===id);

// (las de manga larga; las chaquetas y el abrigo tapan las mangas; los pantalones que llegan al tobillo)
const MANGA_LARGA=new Set(['manga-larga','camisa','sudadera','sudadera-capucha']),TAPA_MANGAS=new Set(['chaqueta-abierta','chaqueta-cremallera','abrigo']);
const LARGO=new Set(['jean','pantalon','deportivo','cargo','leggings','overol']);
// Un atuendo {lugar: {id, color}} en la paleta de las zonas de materialRopa: lo de encima pinta el tronco; las mangas, de la
// prenda de arriba (o de la chaqueta, si las tapa); sin mangas largas, el antebrazo es piel; el vestido pinta el tronco y la
// falda; sin pantalón largo, la pantorrilla es piel.
export function zonasDeRopa(o={},piel){const {top,outer,bottom,shoes,underwear}=o||{};
 const camisa=outer?.color||top?.color||piel;
 const antebrazo=outer&&TAPA_MANGAS.has(outer.id)?outer.color:top&&MANGA_LARGA.has(top.id)?top.color:piel;
 const vestido=top?.id==='vestido',pantalon=vestido?top.color:bottom?.color||underwear?.color||piel;
 return {camisa,antebrazo,pantalon,pantaloneta:vestido||!bottom||!LARGO.has(bottom.id),zapatos:shoes?.color||piel};}
