/* La ropa como datos (2026-11-22, Miguel: «saca todos los muñecos anteriores… para dejar lo que vamos a dejar»). El catálogo
   de prendas del vestier viejo (before/src/lib/vestier3d.js GARMENTS) sin su geometría: el id, el nombre, el lugar, el color de
   fábrica y su CORTE. Los personajes nuevos (personajes3d.js) no se visten con piezas: el sombreador corta la tela en cada píxel
   (materialRopa) y una prenda es un puñado de números —el largo de la manga y del pantalón, el escote, la ombliguera, la
   abertura, las rayas— (2026-11-22, Miguel: «el cuello redondo o en V… mangas y pantalones bien lineales, como si fuera tela:
   ombliguera, short, calzones…»). Lo usan la gente (characters3d outfitFor) y el muñeco del perfil (MunecoVista).
   Las medidas: manga y largo en la escala del brazo y de la pierna (0 el hombro o la cadera, .5 el codo o la rodilla, 1 la
   muñeca o el tobillo); prof, ombligo, abierto y rayas en metros. */

// Las articulaciones del maniquí, en esa escala (2026-11-22, Miguel: «usar las articulaciones del maniquí para dejar la ropa
// hasta esos puntos»): una prenda que llega a una articulación se escribe con su nombre —la bermuda, a la rodilla; la manga
// al codo; la larga, a la muñeca— y un poco antes (BORDE) para que el dobladillo caiga justo encima.
export const ARTICULACION={hombro:0,codo:.5,muneca:1,cadera:0,rodilla:.5,tobillo:1},BORDE=.02;
const A=ARTICULACION;
// El grueso de cada tela, en metros (2026-11-22, Miguel: «dale, arranca con el relieve y el grosor»): `grosor`, el canto que
// marca la luz en los bordes; `bulto`, cuánto abulta la prenda sobre el cuerpo. Lo que no está acá es tela fina (la camiseta).
const GRUESO={sudadera:{grosor:.004,bulto:.01},'sudadera-capucha':{grosor:.004,bulto:.011},'cuello-alto':{grosor:.003,bulto:.006},camisa:{grosor:.0025,bulto:.003},cuadros:{grosor:.003,bulto:.004},polo:{grosor:.0025,bulto:.002},
 delantal:{grosor:.003,bulto:.006},chaleco:{grosor:.004,bulto:.009},'chaqueta-abierta':{grosor:.005,bulto:.014},'chaqueta-cremallera':{grosor:.005,bulto:.014},abrigo:{grosor:.006,bulto:.02},
 jean:{grosor:.004,bulto:.005},pantalon:{grosor:.003,bulto:.004},cargo:{grosor:.004,bulto:.009},deportivo:{grosor:.004,bulto:.009},overol:{grosor:.004,bulto:.008},leggings:{grosor:.0015,bulto:.001},
 pescador:{grosor:.003,bulto:.004},bermuda:{grosor:.004,bulto:.007},pantaloneta:{grosor:.003,bulto:.007},short:{grosor:.004,bulto:.004},'falda-corta':{grosor:.003,bulto:.005},'falda-larga':{grosor:.003,bulto:.005},
 boxer:{grosor:.002,bulto:.001},calzon:{grosor:.002,bulto:.001},vestido:{grosor:.002,bulto:.003}};
// Los detalles de cada prenda pegada a la piel, que dibuja el sombreador: `botones` (1 la tira entera de la camisa, 2 la corta
// del polo), `ribete` (m: el ancho del puño, el ruedo y el cuello —el resorte de la sudadera—), `costuras` (las del jean: la
// lateral, el cierre y los bolsillos de atrás) y `elastico` (la pretina de resorte, más clara).
const DETALLE={camisa:{botones:1},cuadros:{botones:1},polo:{botones:2,ribete:.022},sudadera:{ribete:.045},'sudadera-capucha':{ribete:.045},'manga-larga':{ribete:.024},'tres-cuartos':{ribete:.02},'cuello-alto':{ribete:.03},
 jean:{costuras:1},short:{costuras:1},bermuda:{costuras:1},cargo:{costuras:1},pescador:{costuras:1},boxer:{elastico:1},calzon:{elastico:1},pantaloneta:{elastico:1},deportivo:{elastico:1},leggings:{elastico:1}};
// (id, nombre, lugar, color de fábrica, corte; patron: 'rayas' o 'cuadros' cada `rayas` m; logo: 'circulo', 'rombo', 'franja', 'bolsillo')
const TODAS=[
 ['boxer','Bóxer','underwear','#343d50',{largo:.12}],
 ['calzon','Calzones','underwear','#e8e4dc',{largo:.06}],
 ['camiseta','Camiseta','top','#7fb2d6',{manga:.3,cuello:'redondo',prof:.045}],
 ['rayas','Camiseta a rayas','top','#f2f0ea',{manga:.3,cuello:'redondo',prof:.045,patron:'rayas',rayas:.05}],
 ['manga-larga','Manga larga','top','#c4553d',{manga:A.muneca-BORDE,cuello:'redondo',prof:.05}],
 ['tres-cuartos','Manga tres cuartos','top','#3a9a96',{manga:.72,cuello:'redondo',prof:.07}],
 ['manga-codo','Manga al codo','top','#e0b83a',{manga:A.codo-BORDE,cuello:'redondo',prof:.05}],
 ['cuadros','Camisa a cuadros','top','#c4553d',{manga:A.muneca-BORDE,cuello:'v',prof:.1,patron:'cuadros',rayas:.07}],
 ['logo','Camiseta con logo','top','#2f3133',{manga:.3,cuello:'redondo',prof:.045,logo:'circulo'}],
 ['rombo','Camiseta con rombo','top','#f2f0ea',{manga:.3,cuello:'redondo',prof:.045,logo:'rombo'}],
 ['franja','Camiseta con franja','top','#3f6fa8',{manga:.3,cuello:'redondo',prof:.045,logo:'franja'}],
 ['sin-mangas','Sin mangas','top','#f2f0ea',{manga:0,cuello:'redondo',prof:.11}],
 ['ombliguera','Ombliguera','top','#d98aa0',{manga:.3,cuello:'redondo',prof:.08,ombligo:.13}],
 ['polo','Polo','top','#4f8a55',{manga:.3,cuello:'v',prof:.07,logo:'bolsillo'}],
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
 ['leggings','Leggings','bottom','#26282a',{largo:A.tobillo-2*BORDE}],
 ['pescador','Pescador','bottom','#c8b48f',{largo:.75}],
 ['bermuda','Bermuda','bottom','#c8b48f',{largo:A.rodilla-BORDE}],
 ['pantaloneta','Pantaloneta','bottom','#2b3549',{largo:.32}],
 ['short','Short','bottom','#3d5370',{largo:.2}],
 ['falda-corta','Falda corta','bottom','#7a2e33',{largo:.3}],
 ['falda-larga','Falda a la rodilla','bottom','#3f566e',{largo:A.rodilla+BORDE}],
 ['bufanda','Bufanda','accessory','#b8443a',{}],['gorro-lana','Gorro de lana','hat','#3a6f8f',{}],['gorra','Gorra','hat','#c4553d',{}],
 ['tenis','Tenis','shoes','#34507a',{}],['botas','Botas','shoes','#5b3b25',{}],['zapatos','Zapatos','shoes','#232425',{}],
].map(([id,label,slot,color,corte])=>({id,label,slot,color,corte:{...corte,...GRUESO[id],...DETALLE[id]}}));
// Lo que se ofrece por ahora: sólo lo que va PEGADO a la piel (2026-11-22, Miguel: «mejora sólo los detalles de las prendas
// que normalmente están sobre la piel y no forzar por el momento faldas o chaquetas, que requieren estar despegadas de la
// piel»). Las sueltas —faldas, vestido, lo de encima— y lo que es una pieza aparte —gorras, bufanda— siguen en el catálogo
// entero (garmentById las conoce: un atuendo guardado que las lleve se sigue dibujando), pero no se
// ofrecen en los menús ni se le ponen a la gente.
export const SUELTAS=new Set(['vestido','falda-corta','falda-larga','delantal','chaleco','chaqueta-abierta','abrigo','chaqueta-cremallera','bufanda','gorro-lana','gorra']);
export const GARMENTS=TODAS.filter(g=>!SUELTAS.has(g.id));
export const SLOTS=[['top','Arriba'],['outer','Encima'],['bottom','Abajo'],['shoes','Calzado'],['hat','Cabeza'],['accessory','Cuello'],['underwear','Interior']];
export const PALETTE=['#f2f0ea','#c9c9c4','#8a8e90','#2f3133','#c4553d','#7a2e33','#d9793a','#e0b83a','#4f8a55','#6b7340','#3a9a96','#7fb2d6','#3f6fa8','#2b3d5c','#6b4a8a','#d98aa0','#6e4e35','#c8b48f'];
const POR_ID=new Map(TODAS.map(g=>[g.id,g]));
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
 const escote=cO?.cuello?cO:cT||(outer?{cuello:'redondo',prof:.05}:{cuello:'nada'});
 const pantalon=vestido?top.color:bottom?.color||underwear?.color||piel,largo=vestido?cT.largo:cB?.largo??cU?.largo??0;
 return {camisa,antebrazo,manga,pantalon,largo,pantaloneta:largo<.9,zapatos:shoes?.color||piel,cuello:escote.cuello||'redondo',prof:escote.prof??.05,
  ombligo:outer?0:cT?.ombligo||0,abierto:cO?.abierto||0,debajo:top?.color||piel,rayas:outer?0:cT?.rayas||0,botones:outer?0:cT?.botones||0,ribete:(cO||cT)?.ribete||0,costuras:cB?.costuras||0,elastico:vestido?0:(cB||cU)?.elastico||0,grosor:(cO||cT)?.grosor??.002,bulto:(cO||cT)?.bulto??0,grosorAbajo:vestido?cT.grosor:(cB||cU)?.grosor??.002,bultoAbajo:vestido?cT.bulto:(cB||cU)?.bulto??0,patron:outer?'liso':cT?.patron||'liso',logo:outer?'ninguno':cT?.logo||'ninguno',raya:claro(top?.color)?'#2b3d5c':'#f2f0ea'};}
// (la raya contrasta con la prenda: oscura sobre una clara, blanca sobre una oscura)
const claro=h=>{if(!h)return false;const n=parseInt(String(h).slice(1,7),16);return .299*(n>>16&255)+.587*(n>>8&255)+.114*(n&255)>150;};
