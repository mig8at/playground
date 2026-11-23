/* La ropa como datos (2026-11-22, Miguel: «saca todos los muñecos anteriores… para dejar lo que vamos a dejar»). El catálogo
   de prendas del vestier viejo (before/src/lib/vestier3d.js GARMENTS) sin su geometría: el id, el nombre, el lugar, el color de
   fábrica y su CORTE. Los personajes nuevos (personajes3d.js) no se visten con piezas: el sombreador corta la tela en cada píxel
   (materialRopa) y una prenda es un puñado de números —el largo de la manga y del pantalón, el escote, la ombliguera, la
   abertura, las rayas— (2026-11-22, Miguel: «el cuello redondo o en V… mangas y pantalones bien lineales, como si fuera tela:
   ombliguera, short, calzones…»). Lo usan el menú de cambiarse de ropa, el perfil, el retrato y el uniforme de la policía.
   Las medidas: manga y largo en la escala del brazo y de la pierna (0 el hombro o la cadera, .5 el codo o la rodilla, 1 la
   muñeca o el tobillo); prof, ombligo, abierto y rayas en metros. */

// (id, nombre, lugar, color de fábrica, corte)
export const GARMENTS=[
 ['boxer','Bóxer','underwear','#343d50',{largo:.12}],
 ['calzon','Calzones','underwear','#e8e4dc',{largo:.06}],
 ['camiseta','Camiseta','top','#7fb2d6',{manga:.3,cuello:'redondo',prof:.045}],
 ['rayas','Camiseta a rayas','top','#f2f0ea',{manga:.3,cuello:'redondo',prof:.045,rayas:.05}],
 ['manga-larga','Manga larga','top','#c4553d',{manga:.98,cuello:'redondo',prof:.05}],
 ['tres-cuartos','Manga tres cuartos','top','#3a9a96',{manga:.72,cuello:'redondo',prof:.07}],
 ['sin-mangas','Sin mangas','top','#f2f0ea',{manga:0,cuello:'redondo',prof:.11}],
 ['ombliguera','Ombliguera','top','#d98aa0',{manga:.3,cuello:'redondo',prof:.08,ombligo:.13}],
 ['polo','Polo','top','#4f8a55',{manga:.3,cuello:'v',prof:.07}],
 ['camisa','Camisa de botones','top','#f2f0ea',{manga:.98,cuello:'v',prof:.11}],
 ['cuello-v','Camiseta cuello en V','top','#2f3133',{manga:.3,cuello:'v',prof:.13}],
 ['sudadera','Sudadera','top','#8a8e90',{manga:.98,cuello:'redondo',prof:.04}],
 ['sudadera-capucha','Sudadera con capucha','top','#6b4a8a',{manga:.98,cuello:'v',prof:.07}],
 ['cuello-alto','Cuello alto','top','#2b3d5c',{manga:.98,cuello:'alto'}],
 ['vestido','Vestido','top','#c4553d',{manga:.22,cuello:'redondo',prof:.09,largo:.42}],
 ['delantal','Delantal','outer','#c8b48f',{}],
 ['chaleco','Chaleco','outer','#6e5a3c',{cuello:'v',prof:.16}],
 ['chaqueta-abierta','Chaqueta abierta','outer','#3f566e',{manga:.98,abierto:.06}],
 ['abrigo','Abrigo largo','outer','#6e4e35',{manga:.98,cuello:'v',prof:.15}],
 ['chaqueta-cremallera','Chaqueta con cremallera','outer','#2b3d5c',{manga:.98,cuello:'alto'}],
 ['overol','Overol','bottom','#3f6fa8',{largo:1}],
 ['jean','Jean','bottom','#3d5370',{largo:1}],
 ['pantalon','Pantalón de tela','bottom','#26282a',{largo:1}],
 ['deportivo','Pantalón deportivo','bottom','#7d8284',{largo:1}],
 ['cargo','Cargo','bottom','#5c6340',{largo:1}],
 ['leggings','Leggings','bottom','#26282a',{largo:.96}],
 ['pescador','Pescador','bottom','#c8b48f',{largo:.75}],
 ['bermuda','Bermuda','bottom','#c8b48f',{largo:.45}],
 ['pantaloneta','Pantaloneta','bottom','#2b3549',{largo:.32}],
 ['short','Short','bottom','#3d5370',{largo:.2}],
 ['falda-corta','Falda corta','bottom','#7a2e33',{largo:.3}],
 ['falda-larga','Falda a la rodilla','bottom','#3f566e',{largo:.55}],
 ['bufanda','Bufanda','accessory','#b8443a',{}],['gorro-lana','Gorro de lana','hat','#3a6f8f',{}],['gorra','Gorra','hat','#c4553d',{}],
 ['tenis','Tenis','shoes','#34507a',{}],['botas','Botas','shoes','#5b3b25',{}],['zapatos','Zapatos','shoes','#232425',{}],
].map(([id,label,slot,color,corte])=>({id,label,slot,color,corte}));
export const SLOTS=[['top','Arriba'],['outer','Encima'],['bottom','Abajo'],['shoes','Calzado'],['hat','Cabeza'],['accessory','Cuello'],['underwear','Interior']];
export const PALETTE=['#f2f0ea','#c9c9c4','#8a8e90','#2f3133','#c4553d','#7a2e33','#d9793a','#e0b83a','#4f8a55','#6b7340','#3a9a96','#7fb2d6','#3f6fa8','#2b3d5c','#6b4a8a','#d98aa0','#6e4e35','#c8b48f'];
const POR_ID=new Map(GARMENTS.map(g=>[g.id,g]));
export const garmentById=id=>POR_ID.get(id);
const corteDe=p=>p?POR_ID.get(p.id)?.corte||{}:null;

// Un atuendo {lugar: {id, color}} en lo que pide materialRopa: los colores y los cortes.
//  - el tronco: lo de encima o lo de arriba, con su escote; la chaqueta abierta deja ver la de abajo por el centro;
//  - las mangas: las de lo de encima si las tiene; si no, las de arriba (el chaleco deja ver las de la camisa);
//  - la pierna: el pantalón con su largo; el vestido hace de falda; sin nada, el interior;
//  - sin nada arriba, el tronco es piel.
export function zonasDeRopa(o={},piel){const {top,outer,bottom,shoes,underwear}=o||{},cT=corteDe(top),cO=corteDe(outer),cB=corteDe(bottom),cU=corteDe(underwear);
 const conMangas=cO?.manga!=null,vestido=top?.id==='vestido';
 const camisa=outer?.color||top?.color||piel,antebrazo=conMangas?outer.color:top?.color||piel,manga=conMangas?cO.manga:cT?.manga??0;
 const escote=cO?.cuello?cO:cT||{cuello:'redondo',prof:.5};
 const pantalon=vestido?top.color:bottom?.color||underwear?.color||piel,largo=vestido?cT.largo:cB?.largo??cU?.largo??0;
 return {camisa,antebrazo,manga,pantalon,largo,pantaloneta:largo<.9,zapatos:shoes?.color||piel,cuello:escote.cuello||'redondo',prof:escote.prof??.05,
  ombligo:outer?0:cT?.ombligo||0,abierto:cO?.abierto||0,debajo:top?.color||piel,rayas:outer?0:cT?.rayas||0,raya:claro(top?.color)?'#2b3d5c':'#f2f0ea'};}
// (la raya contrasta con la prenda: oscura sobre una clara, blanca sobre una oscura)
const claro=h=>{if(!h)return false;const n=parseInt(String(h).slice(1,7),16);return .299*(n>>16&255)+.587*(n>>8&255)+.114*(n&255)>150;};
