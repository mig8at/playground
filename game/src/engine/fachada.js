/* Las fachadas de los edificios (FUGA, 2026-10-12): como las casas (vivienda.js), un edificio se describe con unas
   pocas opciones y de ahí sale qué pieza del «Downtown City MegaKit» va en cada lugar. Puros datos: lo dibuja
   src/lib/town3d.js (la ciudad, desde el plano) y lo edita /edificios (EdificiosView.vue).

   La fachada se reparte en módulos de 2 m por piso (el plano dice dónde hay ventana, puerta o vidriera): las piezas de
   acá son todas de 2 m de ancho y 3 m de alto. La ventana vistosa va sólo en el primer piso (el que se ve de cerca desde
   la calle) y más arriba una liviana: con la vistosa en toda la fachada la ciudad pasaba de 4,5 millones de triángulos
   (medido el 2026-10-10). Triángulos de cada pieza (sin el interior falso): al lado de su nombre.

   Variedad por barrio: cada barrio de la ciudad toma una familia de estilos (BARRIOS) y cada edificio, uno de ellos
   con su color; así la ciudad sigue pareja de cerca y variada de lejos. */

// Las familias de pared: la vidriera y el muro de la planta baja, el muro ciego, la cornisa y qué materiales se pintan.
export const FAMILIES={
 ladrillo:{t:'Ladrillo',shop:'Metal_FirstFloor_Window',wall:'Brick_BottomTrim',plain:'Brick_Plain_3',paintOn:['MI_RedBrick','MI_RedBrick_Pale']},
 piedra:{t:'Piedra',shop:'Trim_FirstFloor_Window_001',wall:'Trim_FirstFloor_Wall',plain:'Trim_Plain_3',paintOn:['MI_Trim','MI_RedBrick','MI_RedBrick_Pale']},
 metal:{t:'Metal y concreto',shop:'Metal_FirstFloor_Window',wall:'Metal_FirstFloor_Wall',plain:'Metal_Plain_3',paintOn:['MI_Trim_Dark','MI_Trim_MetalConcrete']}};
// Ventanas de 2 m (la del primer piso y la de los de arriba se eligen aparte).
export const WINDOWS={
 clave:{p:'Brick_Window_Trim',t:'Con piedra clave',tris:650},
 moldura:{p:'Brick_Window_Trim_Single',t:'Con moldura',tris:424},
 cuadrada:{p:'Brick_Window_Square_Single',t:'Cuadrada',tris:188},
 piedra:{p:'Trim_Window',t:'De piedra',tris:572},
 vidrio:{p:'Metal_FullWindow',t:'De vidrio entero',tris:208},
 media:{p:'Metal_Window_Half',t:'Media de metal',tris:308}};
// Ventanas de 4 m: van donde dos módulos seguidos de un piso son ventana (una pieza en lugar de dos). Triángulos por
// pieza; por metro, varias salen más baratas que dos ventanas de 2 m con moldura.
export const DOUBLES={no:{p:null,t:'No',tris:0},rojaBlanca:{p:'Brick_RedWhite_DoubleWindow',t:'Doble roja y blanca',tris:792},arco:{p:'Brick_Window_CurvedDouble',t:'Doble de arco',tris:1135},
 recuadro:{p:'Brick_Inset_Window',t:'En recuadro',tris:486},recuadroArco:{p:'Brick_Inset_Window_Curved',t:'En recuadro con arco',tris:654},arcoChico:{p:'Brick_Inset_Window_Curved_Small',t:'De arco chico',tris:566},
 metal:{p:'Metal_Window',t:'De fábrica (metal)',tris:576}};
// El vidrio de cada pieza de ventana (simples y dobles): [x0, x1, y0, y1] en m, con la pieza en su origen —el centro del
// módulo, el piso del nivel—. MEDIDO en los .gltf del paquete (2026-10-16; validar-fachada3d lo compara): de acá salen
// las cortinas de cada ventana dibujada (town3d).
export const VIDRIO_PIEZA={Brick_Window_Trim:[-.5,.5,.31,2.32],Brick_Window_Trim_Single:[-.23,.23,.59,1.89],Brick_Window_Square_Single:[-.22,.22,.61,1.85],Trim_Window:[-.5,.49,1.15,2.21],
 Metal_FullWindow:[-.9,.9,.06,2.7],Metal_Window_Half:[-.9,.9,.06,2.7],Brick_RedWhite_DoubleWindow:[-.99,.99,.44,2.32],Brick_Window_CurvedDouble:[-1.15,1.15,.56,2.15],
 Brick_Inset_Window:[-.78,.78,.8,2.04],Brick_Inset_Window_Curved:[-.78,.78,.84,2.21],Brick_Inset_Window_Curved_Small:[-.38,.38,.68,1.83],Metal_Window:[-1.43,1.43,.04,2.43]};
// (el ventanal de vivienda —fachada3d VENTANAL, una pieza propia, sin modelo del paquete—: su vidrio, como los de arriba)
export const VIDRIO_VENTANAL=[-.75,.75,.9,2.7];
export const AWNINGS={no:null,rojo:'#c0392b',verde:'#2e7d32',azul:'#1f5f99',naranja:'#d98c1f',morado:'#7b3f8c',petróleo:'#2a7f7a',vino:'#7a2e3a'};
// La escalinata: la planta baja levantada (m) y, en cada puerta de calle, una escalera de concreto de 1 m de fondo (lo
// que mide la vereda) con barandas.
export const RAISE=.6;
export const CORNICES={ladrillo:{p:'Cornice_Brick_Center',t:'De ladrillo'},piedra:{p:'Cornice_Trim_Center',t:'De piedra'},metal:{p:'Cornice_Metal_Center',t:'De metal'}};
// Esquinas: una columna por piso (abajo, al medio y arriba). corner: la pieza va girada hacia adentro de la esquina.
export const CORNERS={
 piedra:{t:'Columna de piedra',bottom:'Trim_Column_Bottom',center:'Trim_Column_Center',top:'Trim_Column_Top'},
 metal:{t:'Columna de metal',bottom:'Metal_Column_Bottom',center:'Metal_Column_Center',top:'Metal_Column_Top'},
 fina:{t:'Columna fina',bottom:'Metal_Column_Small_Bottom',center:'Metal_Column_Small_Center',top:'Metal_Column_Small_Top'},
 ladrillo:{t:'Esquina de ladrillo',bottom:'Brick_CornerColumn_Bottom',center:'Brick_CornerColumn_Center',top:'Brick_CornerColumn_Top',corner:true}};
export const DOORS={madera:{p:'DoorFrame_Wooden',t:'Marco de madera'},piedra:{p:'DoorFrame_Trim',t:'Marco de piedra'},metal:{p:'DoorFrame_Metal_Single',t:'Marco de metal'}};
export const LEAVES={Door_1:'De tablero',Door_2:'De vidrio',Door_3:'De cuadros'};
export const ROOFS={plano:'Plano',mansarda:'Mansarda de pizarra'};
// Tres zonas de color por edificio (2026-10-12): la pared, las molduras (cornisas, contornos de ventana, columnas:
// el material de piedra clara) y la carpintería (marcos, puertas, vidrieras: los metales y el verde de los marcos). En
// la familia de piedra la pared ES la moldura (el mismo material): ahí se pinta la pared y la carpintería. null: el
// color natural del material. Los colores se tiñen sobre la textura en grises (downtown3d.js): salen limpios.
export const PAINTS={
 ladrillo:{natural:null,crema:'#e8dcc0',salvia:'#8fb5a5',azul:'#6f8fb5',lila:'#9d8fc4',mostaza:'#d6a84a',rosa:'#d99a92',oliva:'#8d9a5c',terracota:'#c0714a',gris:'#a9adb1',petróleo:'#4f8a8f',chocolate:'#6a4535',vino:'#7d3c3c',carbón:'#55585c'},
 piedra:{natural:null,crema:'#f1e4c8',vainilla:'#f0d9a0',arena:'#e5cdb2',blanca:'#efede6',menta:'#cfe3d4',lavanda:'#d8d1ea',celeste:'#c9dde8',salmón:'#efbca8',pistacho:'#cfe2b8',gris:'#cfcfcb'},
 metal:{natural:null,blanco:'#ecebe6',arena:'#cdbd9c',grafito:'#4a4f57',azul:'#3f5578',verde:'#5d7a6a',terracota:'#b06a4a'}};
export const TRIMS={natural:null,blanco:'#f5f3ee',crema:'#ece0c4',piedra:'#d3c6aa',gris:'#9ea3a8',grafito:'#3d4146',negro:'#26292c'};
export const JOINERY={natural:null,negro:'#232528',grafito:'#3d4146',verde:'#2f5242',azul:'#2d4566',vino:'#6d2633',blanco:'#f2f0ea',madera:'#7a5236',ocre:'#c08a3a'};
// Qué materiales son de cada zona, por familia.
const ZONES={ladrillo:{trim:['MI_Trim'],joinery:['MI_Trim_MetalConcrete','MI_Trim_Green','MI_Trim_Dark']},
 piedra:{trim:[],joinery:['MI_Trim_MetalConcrete','MI_Trim_Green','MI_Trim_Dark']},
 metal:{trim:['MI_Trim'],joinery:['MI_Trim_Green']}};
export const paintOf=(familia,v)=>v==null?null:PAINTS[familia]?.[v]??(typeof v==='string'&&v.startsWith('#')?v:null);
const named=(tbl,v)=>v==null?null:tbl[v]??(typeof v==='string'&&v.startsWith('#')?v:null);

// Los estilos de partida. combos: [pared, molduras, carpintería] que combinan (contraste entre pared y molduras, y una
// carpintería oscura o de color que acompaña); cada edificio toma uno al azar.
const S=(t,o,combos)=>({t,escalinata:false,doble:'no',balcones:false,toldos:'no',banda:false,techo:'plano',aire:false,columnas:false,...o,
 pintura:combos[0][0],moldura:combos[0][1],carpinteria:combos[0][2],combos});
export const STYLES={
 casona:S('Casona de ladrillo',{familia:'ladrillo',ventana1:'clave',ventana:'cuadrada',cornisa:'ladrillo',esquinas:'piedra',puerta:'madera',hoja:'Door_1',toldos:'verde'},
  [['natural','crema','verde'],['natural','blanco','negro'],['salvia','blanco','grafito'],['mostaza','crema','vino'],['rosa','blanco','azul'],['crema','piedra','verde']]),
 molduras:S('Ladrillo con molduras',{familia:'ladrillo',ventana1:'moldura',ventana:'cuadrada',cornisa:'piedra',esquinas:'piedra',puerta:'piedra',hoja:'Door_3',banda:true,toldos:'rojo'},
  [['natural','blanco','negro'],['azul','blanco','grafito'],['oliva','crema','vino'],['natural','crema','azul'],['gris','blanco','vino']]),
 almacen:S('Almacén',{familia:'ladrillo',ventana1:'cuadrada',ventana:'cuadrada',cornisa:'ladrillo',esquinas:'ladrillo',puerta:'metal',hoja:'Door_2',aire:true,toldos:'azul'},
  [['natural','natural','negro'],['carbón','gris','negro'],['petróleo','crema','negro'],['terracota','crema','grafito']]),
 brownstone:S('Brownstone',{familia:'ladrillo',escalinata:true,doble:'recuadroArco',ventana1:'clave',ventana:'cuadrada',cornisa:'piedra',esquinas:'ladrillo',puerta:'madera',hoja:'Door_3'},
  [['chocolate','crema','negro'],['vino','piedra','grafito'],['chocolate','piedra','verde'],['carbón','crema','vino']]),
 rojoblanco:S('Rojo y blanco',{familia:'ladrillo',doble:'rojaBlanca',ventana1:'moldura',ventana:'cuadrada',cornisa:'piedra',esquinas:'piedra',puerta:'piedra',hoja:'Door_1',toldos:'naranja'},
  [['natural','blanco','verde'],['natural','blanco','negro'],['terracota','blanco','azul']]),
 parisino:S('Parisino',{familia:'piedra',escalinata:true,balcones:true,ventana1:'piedra',ventana:'cuadrada',cornisa:'piedra',esquinas:'piedra',puerta:'piedra',hoja:'Door_3',banda:true,techo:'mansarda',columnas:true},
  [['crema',null,'grafito'],['vainilla',null,'verde'],['arena',null,'negro'],['blanca',null,'azul']]),
 hotel:S('Hotel clásico',{familia:'piedra',escalinata:true,balcones:true,ventana1:'piedra',ventana:'cuadrada',cornisa:'piedra',esquinas:'piedra',puerta:'piedra',hoja:'Door_2',banda:true,columnas:true,toldos:'vino'},
  [['salmón',null,'vino'],['menta',null,'verde'],['lavanda',null,'azul'],['celeste',null,'azul'],['crema',null,'vino']]),
 victoriano:S('Victoriano pintado',{familia:'ladrillo',escalinata:true,doble:'arcoChico',balcones:true,ventana1:'clave',ventana:'cuadrada',cornisa:'piedra',esquinas:'piedra',puerta:'madera',hoja:'Door_1',techo:'mansarda'},
  [['lila','blanco','vino'],['salvia','crema','vino'],['rosa','blanco','azul'],['mostaza','blanco','verde'],['azul','blanco','ocre'],['petróleo','crema','ocre']]),
 clasico:S('Clásico de piedra',{familia:'piedra',escalinata:true,ventana1:'piedra',ventana:'cuadrada',cornisa:'piedra',esquinas:'ladrillo',puerta:'piedra',hoja:'Door_3'},
  [['crema',null,'verde'],['blanca',null,'negro'],['pistacho',null,'grafito'],['gris',null,'vino']]),
 moderno:S('Moderno',{familia:'metal',ventana1:'vidrio',ventana:'vidrio',cornisa:'metal',esquinas:'metal',puerta:'metal',hoja:'Door_2',aire:true},
  [['terracota','crema','negro'],['blanco',null,'negro'],['grafito','blanco','negro'],['arena',null,'grafito']]),
 oficinas:S('Oficinas',{familia:'metal',ventana1:'media',ventana:'media',cornisa:'metal',esquinas:'fina',puerta:'metal',hoja:'Door_2',aire:true},
  [['arena',null,'grafito'],['blanco',null,'azul'],['azul','blanco','negro'],['verde','crema','negro']]),
 industrial:S('Industrial',{familia:'ladrillo',doble:'metal',ventana1:'media',ventana:'vidrio',cornisa:'metal',esquinas:'metal',puerta:'metal',hoja:'Door_2',aire:true},
  [['natural','grafito','negro'],['natural','natural','verde'],['carbón','gris','negro'],['terracota','grafito','negro']]),
 vidrio:S('Concreto y vidrio',{familia:'piedra',ventana1:'vidrio',ventana:'vidrio',cornisa:'metal',esquinas:'fina',puerta:'metal',hoja:'Door_2',aire:true},
  [['blanca',null,'negro'],['gris',null,'negro'],['crema',null,'grafito']])};
// Las familias de barrio: qué estilos se ven juntos.
export const BARRIOS={
 historico:{t:'Histórico',estilos:['casona','molduras','almacen','brownstone','rojoblanco']},
 elegante:{t:'Elegante',estilos:['parisino','hotel','victoriano','clasico']},
 moderno:{t:'Centro moderno',estilos:['moderno','oficinas','industrial','vidrio']}};
// Los nombres viejos de estilo (los edificios públicos, civic3d.js) a un estilo de acá.
export const LEGACY={ladrillo:'casona',claro:'molduras',piedra:'clasico',metal:'moderno'};
export const OPTIONS={doble:Object.keys(DOUBLES),toldos:Object.keys(AWNINGS),familia:Object.keys(FAMILIES),ventana1:Object.keys(WINDOWS),ventana:Object.keys(WINDOWS),cornisa:Object.keys(CORNICES),esquinas:Object.keys(CORNERS),
 puerta:Object.keys(DOORS),hoja:Object.keys(LEAVES),techo:Object.keys(ROOFS)};

// Una fachada completa: el estilo y lo que se pidió encima.
export function facadeSpec(input={}){const st=STYLES[input.estilo]||STYLES.casona,s={...st,...input};delete s.t;delete s.combos;
 for(const [k,vals] of Object.entries(OPTIONS))if(!vals.includes(s[k]))s[k]=st[k];return s;}
// Una fachada al azar de un estilo (o de un barrio): el estilo con una de sus pinturas.
export function randomFacade(r=Math.random,{estilo=null,barrio=null}={}){const pick=a=>a[Math.floor(r()*a.length)];
 const e=estilo||pick(barrio?BARRIOS[barrio].estilos:Object.keys(STYLES)),st=STYLES[e],[pintura,moldura,carpinteria]=pick(st.combos);return facadeSpec({estilo:e,pintura,moldura,carpinteria});}

// Las piezas que pide una fachada (lo que usa town3d.js).
export function facadeStyle(input){const s=facadeSpec(input),F=FAMILIES[s.familia],C=CORNERS[s.esquinas];
 return {spec:s,shop:F.shop,wall:F.wall,plain:F.plain,win1:WINDOWS[s.ventana1].p,win:WINDOWS[s.ventana].p,cornice:CORNICES[s.cornisa].p,
  column:C.center,columnBottom:C.bottom,columnTop:C.top,cornerColumn:!!C.corner,door:DOORS[s.puerta].p,leaf:s.hoja,
  band:s.banda?'Brick_Ornament_Horizontal':null,mansard:s.techo==='mansarda',ac:!!s.aire,shopColumns:!!s.columnas,
  double:DOUBLES[s.doble]?.p||null,raise:s.escalinata?RAISE:0,balconies:!!s.balcones,awnings:!!AWNINGS[s.toldos],awningColor:AWNINGS[s.toldos],
  paint:paintOf(s.familia,s.pintura),paintOn:F.paintOn,
  // las tres zonas de color (downtown3d.tintOf): pared, molduras y carpintería
  tint:{zones:[[paintOf(s.familia,s.pintura),F.paintOn],[named(TRIMS,s.moldura),ZONES[s.familia].trim],[named(JOINERY,s.carpinteria),ZONES[s.familia].joinery]]}};}

// Todas las piezas que puede pedir una fachada (downtown3d.js las carga).
export const FACADE_PIECES=[...new Set([...Object.values(FAMILIES).flatMap(f=>[f.shop,f.wall,f.plain]),...Object.values(WINDOWS).map(w=>w.p),...Object.values(CORNICES).map(c=>c.p),
 ...Object.values(CORNERS).flatMap(c=>[c.bottom,c.center,c.top]),...Object.values(DOORS).map(d=>d.p),...Object.keys(LEAVES),
 ...Object.values(DOUBLES).map(d=>d.p).filter(Boolean),'Stairs_Entrance_Concrete','Stairs_Rails_Metal','Entrance_Concrete_2x1','Stairs_Rails_Metal_Straight_1','Trim_Wall_Guard',
 'Brick_Ornament_Horizontal','Roof_SlateCornice_Center','Roof_SlateCornice_Window_1','Roof_SlateCornice_Corner','Roof_Slate_Center','Prop_ACUnit','Trim_FirstFloor_Window_Columns'])];
