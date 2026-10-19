/* Los edificios de /demo dibujados desde el plano por etapas (engine/blueprint.js): la ciudad queda definida en los
   datos y acá sólo se dibuja. Por fuera, piezas del Downtown MegaKit en módulos de 2 m (el plano reparte la fachada en
   esos módulos): ventana donde el plano tiene ventana, puerta o portón donde tiene puerta de calle, vitrina en los
   locales, muro en el resto, la cornisa arriba y una columna en cada esquina. Por dentro, los tabiques del plano con sus
   vanos y marcos, el ascensor en el núcleo y los muebles del plano (modelos de los paquetes, o cajas de color para lo
   que no tiene modelo). Los tabiques y los muebles se dibujan sólo cerca de la cámara (world3d.updateInteriors); los
   choques están siempre. */
import * as THREE from 'three';
import {facadeStyle,LEGACY,WINDOWS,VIDRIO_PIEZA,VIDRIO_VENTANAL} from '../engine/fachada.js';
import {liftFor} from './sitting3d.js';
import {OBJETOS,placeParts,RUG_COUNT,kitModel,REEMPLAZOS} from './objetos3d.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {LOWPOLY} from './downtown3d.js';
import {PUERTA_DOBLE,MARQUESINA,VENTANAL} from './fachada3d.js';
import {pendienteEn} from '../engine/techos.js';
import {ALTURA,COLUMNA,CHOQUE_MUEBLE,CORTINA,AZOTEA,MANSARDA,esVidriera} from '../engine/medidas.js';
const CORTINA_CU=new Set(CORTINA.cuartos);
import {cuartoDeVentana,panioCerrado,cortinaAbierta,juntarCortinas,telaDe} from '../engine/cortinas.js';
import {piezasSinTitilar} from '../engine/titileo.js';

// Qué modelo usa cada mueble del plano (el primero que esté cargado) y, si no hay, una caja: [alto, color, desde].
export const MODEL={lampara:['C2_Lamp'],sillon:['C2_Sofa','Sofa_individual'],sofa:['C2_SofaDouble','Sofa2','Couch_Medium2'],cama:['C2_Bed','Bed_King','BedDouble'],comoda:['C2_Closet2','Drawer_1'],cama_s:['Bed_Single','BedTwin'],cama_h:['HospitalBed','BedTwin'],catre:['Bed_Single'],litera:['Bed_Bunk'],
 inodoro:['Bathroom_Toilet'],lavamanos:['Bathroom_Sink'],ducha:['Bathroom_Shower1'],tina:['Bathroom_Bathtub'],lavadora:['Bathroom_WashingMachine'],mesa_noche:['NightStand','NightStand_1'],
 armario:['C2_Closet','Closet','Drawer_1'],escritorio:['Desk'],estante:['C2_BookCaseBooks','Bookcase_Books','Shelf_2'],archivador:['ShortCloset','Drawer_2'],nevera:['Kitchen_Fridge'],
 meson:['Kitchen_2Drawers','Kitchen_Cabinet1'],estufa:['Kitchen_Oven'],mesa:['Table_RoundSmall'],mesa_centro:['C2_CoffeeTable','Table_RoundSmall'],mesa_reunion:['Table'],
 mesa_lectura:['Table'],planta:['Houseplant_8','Houseplant_6']};
// Lo que a la medida sale de otro objeto del catálogo (la mesa de la casa, rectangular —la de los locales sigue redonda—;
// el sofá y el armario, que en el paquete son de una sola medida; la cama sencilla, la misma cama más angosta).
// La variante de un objeto del catálogo (el pizarrón verde o blanco, el color de los casilleros): fija por su lugar.
const variante=(O,it)=>O.variantes?.[Math.floor((Math.abs(Math.sin(it.x*12.9898+it.y*78.233))*43758.5453)%1*O.variantes.length)];
const FIT_CAT={mesa:'mesa_comedor',sofa:'sofa',armario:'armario',cama_s:'cama',comoda:'comoda2'};
const BOX={horno:[1.05,'#a5583a'],plancha:[.9,'#7d858c'],repisa:[.05,'#a77b52'],vitrina:[.92,'#e9eef0'],cajon:[.62,'#b98a4f'],tv:[.55,'#2f3437',.45],inodoro:[.42,'#ffffff'],lavamanos:[.85,'#ffffff'],ducha:[.06,'#bfe0ec'],mostrador:[1.05,'#8d7360'],
 catre:[.45,'#8a8f96'],tina:[.6,'#ffffff'],litera:[1.6,'#8b6a4e'],lavadora:[.85,'#f2f2f2'],camilla:[.8,'#f4f4f4'],caja:[.8,'#b98a4f'],buzones:[1.3,'#9aa3a8',.3],caja_fuerte:[1.1,'#5d6266'],vehiculo:[1.5,'#c0392b'],
 sofa:[.8,'#b88b6a'],cama:[.55,'#9c86b8'],cama_s:[.55,'#9c86b8'],cama_h:[.6,'#ffffff'],mesa_noche:[.55,'#8b6a4e'],armario:[2,'#8b6a4e'],escritorio:[.76,'#a7825f'],
 estante:[1.9,'#8b6a4e'],archivador:[1.3,'#7d8790'],nevera:[1.8,'#e8eef2'],meson:[.9,'#c9c3b8'],estufa:[.9,'#4b4f53'],mesa:[.75,'#b0906c'],mesa_centro:[.45,'#b0906c'],
 lampara:[1.5,'#f3e2bf'],comoda:[1.1,'#8b6a4e'],sillon:[.8,'#7d8ea6'],mesa_reunion:[.75,'#9a7b5b'],mesa_lectura:[.75,'#a7825f'],planta:[.9,'#7fae74'],silla:[.9,'#5d6670']};
// WALL_T: lo que ocupa la fachada hacia adentro (la cara interior de las piezas del MegaKit está a 20 cm).
// Los letreros de los locales con giro: fondo y letra.
// Dónde va alfombra y dónde cuadro (los cuartos donde se vive o se atiende), y los muebles altos que tapan la pared.
const DECO_RUG=new Set(['sala','dormitorio','dormitorio_b','habitacion','estudio','sala_cocina','recepcion','oficina','reuniones','sala_prof','infantil','lectura','vestibulo']);
const DECO_ART=new Set(['sala','dormitorio','dormitorio_b','habitacion','habitacion_h','estudio','sala_cocina','comedor','recepcion','oficina','reuniones','sala_prof','consultorio','lectura','vestibulo','infantil','secretaria']);
// El reloj de pared y las cortinas, en qué cuartos.
const CLOCK=new Set(['cocina','cocineta','sala_cocina','comedor','oficina','abierta','reuniones','aula','sala_prof','recepcion','secretaria','consultorio','urgencias','prestamo']);
const CURTAIN=new Set(['sala','dormitorio','dormitorio_b','habitacion','habitacion_h','estudio','sala_cocina','comedor','infantil','consultorio','oficina','reuniones']);
const TALL=new Set(['perchero','estanteria_ropa','probador','espejo_pared','caminadora','casillero','armario','estante','nevera','archivador','repisa','vitrina','buzones','tablero','litera','caja_fuerte','horno','comoda','lavadora','ducha','tina','estufa','tv','meson','plancha']);
const SIGN={pizzeria:['#b8322a','#fff3d6'],hamburgueseria:['#f2b632','#3a2416'],panaderia:['#8a5a2b','#fbe9c9'],heladeria:['#f4b6c8','#5a2a3a'],
 fruteria:['#4f8a3a','#f4f1d0'],gimnasio:['#1f2a36','#f2c230'],ropa:['#2b2b2b','#f4e9dc'],sushi:['#1f2326','#e8463a']};
// Qué se ve en cada local con giro (piezas de Tienda, F_*): ver dress.
const SHOP={
 pizzeria:{counter:['F_Pizza','F_Plate:F_Pizza_Slice','F_Pizza','F_Soda','F_Soda'],plate:'F_Plate',dish:['F_Pizza_Slice'],center:['F_Pizza'],drink:'F_Soda'},
 hamburgueseria:{counter:['F_Cheeseburger','F_Fries','F_DoubleCheeseburger','F_Fries','F_KetchupMustard','F_Soda'],plate:'F_Plate',dish:['F_Cheeseburger','F_Burger'],side:'F_Fries',center:['F_KetchupMustard'],drink:'F_Soda'},
 panaderia:{counter:['F_Bread','F_Plate:F_Croissant','F_Cupcake','F_Plate:F_Donut2:F_Donut3','F_Bread','F_Pancakes_Stack'],plate:'F_Plate',dish:['F_Croissant','F_Donut1','F_Cupcake','F_Donut4'],center:['F_Bread'],
  shelf:[['F_Bread','F_Bread_Slice'],['F_Croissant','F_Bread'],['F_Donut1','F_Donut2','F_Donut3','F_Donut4'],['F_Cupcake','F_Waffle']]},
 heladeria:{counter:['F_IceCream_Cone','F_IceCream_1','F_IceCream_Cone2','F_IceCream_2','F_Popsicle_Multiple'],dish:['F_IceCream_1','F_IceCream_2','F_IceCream_3','F_IceCream_4','F_IceCream_Cone'],center:[],
  ice:'#dfe9ee',tubs:['#f6d2dc','#f3e6b3','#7a4a2e','#bfe3c4','#f7f3ea','#e8a0b4']},
 fruteria:{counter:['F_Banana','F_Apple','F_Orange','F_Coconut','F_Pumpkin'],dish:[],center:[]},
 sushi:{counter:['F_Plate_Square:F_Sushi_Nigiri1:F_Sushi_Roll1:F_Sushi_Nigiri2','F_SoySauce','F_Plate_Square:F_Sushi_NigiriOctopus:F_Sushi_Roll2','F_Bottle1'],plate:'F_Plate_Square',
  dish:['F_Sushi_Nigiri1','F_Sushi_Roll1','F_Sushi_Nigiri2'],all:true,side:'F_Chopsticks',center:['F_SoySauce'],ice:'#eef3f5',show:['F_Fish','F_Sashimi_Salmon','F_Sashimi_Salmon2','F_Fish']}};
// La fruta de los cajones y cuánto ocupa cada una (el paso de la grilla, m).
// (sólo las livianas, de 82 a 368 triángulos: el ají —808—, la zanahoria —864—, el nabo —976—, la lechuga y la manzana
// pesaban demasiado para ir de a decenas)
const FRUIT=['F_Orange','F_Banana','F_Tomato','F_Avocado','F_Eggplant','F_Broccoli','F_Coconut'];
const TIENDA_STEP={F_Apple:.09,F_Orange:.09,F_Banana:.15,F_Tomato:.08,F_Avocado:.1,F_Apple_Green:.09,F_Pepper_Red:.1,F_Pepper_Green:.1,F_Carrot:.12,F_Eggplant:.14,F_Broccoli:.15,F_Coconut:.15,F_Turnip:.11,F_Lettuce_Whole:.17};
const WALL_COLOR='#ece5d8',FRAME_COLOR='#8a6a4a',WALL_T=.2,THIN=.12;

/* Las paredes de adentro (2026-10-12): no todas blancas. Cada cuarto toma un color de los que se usan de verdad para su
   uso: baños de baldosa blanca o celeste, cocinas cálidas, dormitorios en pastel, oficinas en blanco hueso y gris
   claro, aulas en verde menta y amarillo pálido, el hospital en verde agua, la comisaría en gris azulado. El pasillo y
   la cara de adentro de la fachada, el color del edificio (HALL). */
const P_=(...c)=>c,ROOM_PAL={
 bano:P_('#f4f6f6','#dcebef','#e2efe6','#efe9df'),sanitario:P_('#eef3f3','#dcebef'),vestuario:P_('#e3ebef','#e9ece4'),
 cocina:P_('#f3e3b5','#f1dcc0','#e7ecce','#f6efe0'),cocineta:P_('#f3e3b5','#eef0e2'),sala_cocina:P_('#f1e2c6','#e8e6cf','#f0dccb'),comedor:P_('#f2e2c4','#e5ecd7'),
 sala:P_('#efe4d0','#e4dccc','#dfe3d4','#ecd8c4','#d8dfe6'),estudio:P_('#efe4d0','#dfe3d4','#e6dccd'),entrada:P_('#ece5d8'),hall:P_('#ece5d8','#e8e2d6'),ropas:P_('#eef3f3','#e4ecee'),
 dormitorio:P_('#dbe6f0','#eedfe5','#e1ead6','#f0e5cf','#e4def0'),dormitorio_b:P_('#dde3e0','#e3e0d4'),infantil:P_('#f6e2a4','#cbe6d8','#f2cfc2','#cadcf0'),
 habitacion:P_('#e9e0d1','#dcd4c5','#e5dccd','#d7dccd'),
 oficina:P_('#eceeef','#e4e6e6','#e9e6df','#dde3e7'),abierta:P_('#eceeef','#e9e6df'),reuniones:P_('#dfe4e8','#e6e1d6','#d6dfd9'),recepcion:P_('#ece7dd','#e3e6e8'),secretaria:P_('#e9e6df','#e2e9e1'),
 aula:P_('#e3eed3','#f3e9c9','#d6e9e2','#e3edf4'),sala_prof:P_('#ece6d4','#dce6e0'),
 habitacion_h:P_('#dcebe1','#ddeaf0','#eef1ee'),enfermeria:P_('#dcebe1','#e6efef'),urgencias:P_('#e2eff0','#dcebe1'),consultorio:P_('#e2eff0','#eef1ee'),
 celda:P_('#cfd4d4','#c8cfd3'),interrogatorio:P_('#c9d0d4','#d4d2c9'),evidencia:P_('#d6d8d3'),
 lectura:P_('#efe6d2','#e3dbc9','#e0e5da'),prestamo:P_('#ece3cf','#e2e6dc'),estanteria:P_('#e8dfcc','#e0dccf'),archivo:P_('#e2ded3'),
 local:P_('#ece7dd','#e2dfd8'),deposito:P_('#dedbd3','#d6d3cb'),garaje:P_('#d8d6d0'),boveda:P_('#c9ccc9'),vestibulo:P_('#ece5d8','#e4dccb')};
const HALL={vivienda:P_('#ece5d8','#e6ddcb','#e2e4dc'),casa:P_('#ece5d8'),comercio:P_('#ece5d8','#e6ddcb'),hotel:P_('#e3d7c3','#dcd2c2','#e6dccb'),
 oficinas:P_('#e7e8e6','#e2e4e6'),hospital:P_('#e0ede5','#e3eef0'),colegio:P_('#e8eed8','#f1ead0'),biblioteca:P_('#ece2cc','#e5dfcf'),
 comisaria:P_('#d0d9e1','#d6dcdf'),puesto:P_('#d0d9e1'),bomberos:P_('#eadfd0','#e6e2d8'),objetivo:P_('#d9dcdc')};
const pickOf=(list,r)=>list[Math.min(list.length-1,Math.floor(r*list.length))];

/* La escalera según el edificio (2026-10-12): de madera (huella de madera, contrahuella pintada, pasamanos de madera)
   en viviendas y casonas; de mármol con pasamanos de bronce en el hotel y las fachadas de piedra; de granito lavado con
   cinta antideslizante en los edificios públicos; de concreto pulido con baranda de acero en las oficinas y lo moderno;
   y de chapa de acero con nariz amarilla en lo industrial. body: el macizo del peldaño; tread: la huella; nose: la
   nariz; rail/post: pasamanos y barrotes. */
export const STAIRS={
 madera:[{body:'#efe6d6',tread:'#a8794f',nose:'#7a5233',rail:'#6e4a2f',post:'#efe6d6'},{body:'#e9e2d3',tread:'#8f5f3a',nose:'#5f3d24',rail:'#5a3a22',post:'#5a3a22'},{body:'#f1ece2',tread:'#b98d5e',nose:'#8a6440',rail:'#8a6440',post:'#f1ece2'}],
 marmol:[{body:'#d8d0c3',tread:'#ece7df',nose:'#bfb5a6',rail:'#b08a3e',post:'#b08a3e'},{body:'#cfc8bc',tread:'#e4ddd2',nose:'#a99f90',rail:'#3d3a36',post:'#3d3a36'}],
 granito:[{body:'#c9c4ba',tread:'#d9d4cb',nose:'#6b6f73',rail:'#5a6066',post:'#5a6066'},{body:'#c3c7c4',tread:'#cfd4d0',nose:'#4c6a5a',rail:'#4f5a60',post:'#4f5a60'}],
 concreto:[{body:'#a9a69f',tread:'#bdbab3',nose:'#3a3e43',rail:'#a9b2b8',post:'#a9b2b8'},{body:'#b3b0aa',tread:'#c6c3bc',nose:'#2f3337',rail:'#2f3337',post:'#2f3337'}],
 acero:[{body:'#4a4e52',tread:'#5c6166',nose:'#c99a2e',rail:'#2f3337',post:'#2f3337'}]};
export function stairKind(type,fs){const e=fs?.spec?.estilo,fam=fs?.spec?.familia;
 if(['hospital','colegio','biblioteca','comisaria','puesto','bomberos','objetivo'].includes(type))return 'granito';
 if(e==='industrial')return 'acero';
 if(type==='oficinas'||fam==='metal'||e==='vidrio')return 'concreto';
 if(type==='hotel'||fam==='piedra')return 'marmol';
 return 'madera';}

/* La escalera en U del núcleo (sd, del plano): un vano de adelante de sd.fr m (el piso de cada nivel, donde se entra), el
   carril A sube 1,5 m hacia el fondo, un descanso de sd.bk m de lado a lado, y el carril B sube los otros 1,5 m volviendo
   hacia adelante. Entre los dos carriles, una pared. Cada piso de arriba tiene un hueco en la losa sobre los tramos.
   El rincón (2026-10-16, Miguel: «en el primer piso queda un hueco tapado»): en planta baja el carril B era macizo hasta el
   suelo y desde el vano se veía una pared de 3 m. Ahora, donde por debajo de sus peldaños queda ALTURA.libre, el carril B
   es una losa en escalones y abajo queda un rincón abierto hacia el vano (nook: de FR a b1, con los peldaños desde i0);
   lo de atrás, más bajo, sigue macizo y su cara cierra el rincón (con un cuadro y una planta, stairBoxes). */
export const STAIR_SOFF=.18,STAIR_TH=.045;
// El canto de la losa en el hueco: de Y−0,13 a Y+0,03 (tapa el cielo raso en Y−0,1 y el muro de abajo, que llega a
// Y−0,12) y 4 cm de espesor detrás de la cara de cada pared. El cuadro del rincón: su borde de abajo a 1,2 m.
export const STAIR_CANTO={y0:-.13,y1:.03,e:.04},STAIR_CUADRO=1.2;
export function stairOf(sd,floors,FLOOR){
 const FR=sd.fr,BK=sd.bk,run=sd.d-FR-BK,W=sd.w||2,HW=W/2,P=(a,b)=>[sd.x+sd.ux*a+sd.vx*b,sd.z+sd.uz*a+sd.vz*b],local=(x,z)=>{const dx=x-sd.x,dz=z-sd.z;return [dx*sd.ux+dz*sd.uz,dx*sd.vx+dz*sd.vz];};
 const rect=(a0,b0,a1,b1)=>{const [x0,z0]=P(a0,b0),[x1,z1]=P(a1,b1);return {x:Math.min(x0,x1),z:Math.min(z0,z1),w:Math.abs(x1-x0),h:Math.abs(z1-z0)};};
 const N=sd.steps||Math.max(8,Math.round(run/.25)),rise0=1.5/N,tread0=run/N;
 // (el rincón: el primer peldaño i0 del carril B de planta baja cuyo fondo —su huella menos la nariz, el peldaño y la losa—
 // queda a ALTURA.libre o más; sin 60 cm de fondo, no hay rincón)
 let nook=null;{let i0=N;for(let i=N-1;i>=0;i--){if(.02+1.5+rise0*(i+1)-STAIR_TH-rise0-STAIR_SOFF>=ALTURA.libre)i0=i;else break;}const b1=FR+run-tread0*i0;if(i0<N&&b1-FR>=.6)nook={i0,b0:FR,b1};}
 return {sd,run,P,rect,floors,FR,BK,W,HW,N,nook,
  hole:f=>f>=1?rect(0,FR,W,sd.d):null,
  inHole(px,pz,f){if(f<1)return false;const [a,b]=local(px,pz);return a>0&&a<W&&b>FR&&b<sd.d;},
  // Lo macizo de la escalera en (px,pz): [y0,y1] por tramo y descanso (sin la planta baja levantada). Como lo arma
  // stairBoxes: la planta baja hasta el suelo; de ahí para arriba, una losa inclinada (peldaño + 18 cm) y el descanso de
  // 22 cm. Para la cámara, que no tiene que atravesar el tramo de arriba (2026-10-15).
  solids(px,pz){const [a,b]=local(px,pz),out=[];if(a<0||a>W||b<FR||b>sd.d)return out;const N=sd.steps||Math.max(8,Math.round(run/.25)),rise=1.5/N;
   for(let f=0;f<floors-1;f++){const base=f*FLOOR+.02,t=Math.min(1,Math.max(0,(b-FR)/run)),top=b>FR+run?base+1.5:a<HW?base+1.5*t:base+1.5+1.5*(1-t);
    const hueco=!f&&nook&&a>HW&&b<nook.b1;// (el rincón bajo el carril B de planta baja)
    out.push([f||hueco?Math.max(base,top-(b>FR+run?.23:rise+.23)):base,top]);}return out;},
  // La altura de la escalera bajo (px,pz): la más alta que quede a menos de 45 cm por encima de los pies (o null).
  surface(px,pz,feet){const [a,b]=local(px,pz);if(a<0||a>W||b<FR||b>sd.d)return null;let best=null;
   for(let f=0;f<floors-1;f++){const base=f*FLOOR,t=Math.min(1,Math.max(0,(b-FR)/run)),h=b>FR+run?base+1.5:a<HW?base+1.5*t:base+1.5+1.5*(1-t);
    if(h<=feet+.45&&(best===null||h>best))best=h;}return best;}};
}

export function buildTown(bp,ctx){
 const {S,FLOOR,CEIL,W,H,lots,lotOf,hash,seed,blank,addWall,furniture,clearance,CIVIC,group,own,instanced,base}=ctx;
 const roofProps=[],items=[],leaves=[],doorFronts=[],plaques=[],lotFurniture=new Map(),civics=[],civicFronts=[],awnings=[],stoops=[],balconies=[],cortinas=[],superficies=[],panios=[];let stationInfo=null;
 const columns=new Set(),stairs=new Map();
 // Un rectángulo menos otro (los dos alineados a los ejes): hasta cuatro pedazos.
 const minus=(R,Hh)=>{const x0=Math.max(R.x,Hh.x),z0=Math.max(R.z,Hh.z),x1=Math.min(R.x+R.w,Hh.x+Hh.w),z1=Math.min(R.z+R.h,Hh.z+Hh.h);if(x1<=x0+1e-6||z1<=z0+1e-6)return [R];
  return [{x:R.x,z:R.z,w:R.w,h:z0-R.z},{x:R.x,z:z1,w:R.w,h:R.z+R.h-z1},{x:R.x,z:z0,w:x0-R.x,h:z1-z0},{x:x1,z:z0,w:R.x+R.w-x1,h:z1-z0}].filter(q=>q.w>.01&&q.h>.01);};
 const P=bp.lots;// el plano (mismo índice que lots)
 const sameLot=(x,y,id)=>x>=0&&y>=0&&x<W&&y<H&&lotOf[y*W+x]===id,lotAtCell=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&lotOf[y*W+x]>=0?lotOf[y*W+x]:-1;
 // Paredes de choque que pueden cruzar varias casillas.
 // (wallLift: la planta baja levantada del lote que se está armando: sube los tramos de altura finita)
 let wallLift=0;
 const wallAny=(ax,az,bx,bz,y0=-1e3,y1=1e3)=>{const x0=Math.min(ax,bx),x1=Math.max(ax,bx),z0=Math.min(az,bz),z1=Math.max(az,bz);if(y0>-999)y0+=wallLift;if(y1<999)y1+=wallLift;
  for(let cy=Math.floor(z0/S);cy<=Math.floor((z1-1e-6)/S);cy++)for(let cx=Math.floor(x0/S);cx<=Math.floor((x1-1e-6)/S);cx++)if(cx>=0&&cy>=0&&cx<W&&cy<H)addWall(cx,cy,x0,z0,x1,z1,y0,y1);};
 // Los segmentos (puertas y ventanas) de un piso, por la línea en que están: «h:z» o «v:x».
 const byLine=list=>{const m=new Map();for(const s of list){const k=Math.abs(s.y0-s.y1)<1e-6?'h:'+s.y0.toFixed(2):'v:'+s.x0.toFixed(2);(m.get(k)||m.set(k,[]).get(k)).push(s);}return m;};
 const along=(s,h)=>h?[Math.min(s.x0,s.x1),Math.max(s.x0,s.x1)]:[Math.min(s.y0,s.y1),Math.max(s.y0,s.y1)];

 for(const B of P){const L=lots[B.id],id=B.id,y0f=f=>f*FLOOR;
  // La fachada (engine/fachada.js): la del lote o, en los que traen un estilo viejo (los públicos), su equivalente.
  const fs=L.fs||facadeStyle({estilo:LEGACY[L.style]||'casona'}),tint0=L.fs?fs.tint:L.paint?{zones:[[L.paint,fs.paintOn]]}:null;
  // (los colores del 2D —color.js, B.colores—: la pared de la fachada y la moldura de este lote; el pasillo y cada cuarto,
  // abajo. Sin ellos —un mapa sin plan—, los de antes)
  const C2=B.colores;
  const tint0b=C2?{zones:[[C2.fachada,(tint0?.zones?.[0]?.[1])||fs.paintOn||[]],[C2.moldura,(tint0?.zones?.[1]?.[1])||[]],tint0?.zones?.[2]||[null,[]]]}:tint0;
  // La cara de adentro de la fachada (MI_InteriorWall), del color del pasillo de este edificio.
  const hallC=C2?.pasillo?.[0]||pickOf(HALL[B.type]||[WALL_COLOR],hash(id*11,3,seed+131)),Z0=[null,[]],tz=tint0b?.zones||[];
  // (el esquema del 2D —color.js esquemaDe—: el acento en la carpintería —puertas, barandas—, y los marcos y el zócalo
  // en sus materiales propios —fachada3d MARCO y ZOCALO—; sin él, los marcos de la moldura)
  const tzC=C2?.acento?[C2.acento,(tz[2]?.[1]?.length?tz[2][1]:['MI_Trim_MetalConcrete','MI_Trim_Green','MI_Trim_Dark'])]:tz[2];
  const tint={zones:[tz[0]||Z0,tz[1]||Z0,tzC||Z0,[hallC,['MI_InteriorWall']],[C2?.marco||tz[1]?.[0]||null,['MI_Marco']],[C2?.zocalo||null,['MI_Zocalo']],[C2?.techo||null,['MI_Roof_Slate']]]};
  // (la culata —el muro ciego sobre el vecino más bajo—: del color de C2.culata, ladrillo a la vista; FACHADAS.md mejora 2)
  const tintCul=C2?.culata?{zones:[[C2.culata,(tz[0]?.[1])||fs.paintOn||[]],...tint.zones.slice(1)]}:tint;
  // La planta baja levantada (escalinata, fachada.js): todo lo del lote se arma a nivel y al final sube R; el zócalo, las
  // escalinatas y el muro que asoma junto a un vecino más bajo (fixed) van a su altura de verdad.
  const R=L.raise||0,i0=items.length,l0=leaves.length,p0=plaques.length,a0=awnings.length,k0=cortinas.length,s0=superficies.length,fixed=[];wallLift=R;
  // Ventanas: la alta con marco y piedra clave en los cuartos; la chica (de la misma familia) en los baños.
  // Ventanas: la alta con piedra clave (650 triángulos) sólo en el primer piso, el que se ve de cerca desde la calle; más
  // arriba y en los baños, la de la misma familia con marco simple (188). Con la alta en toda la fachada la ciudad pasaba
  // de 4,5 millones de triángulos y el juego se arrastraba (medido el 2026-10-10).
  const winBig=fs.win1,winLight=fs.win;
  const lines=B.levels.map(lv=>({w:byLine(lv.windows),d:byLine(lv.doors.filter(d=>d.street))}));
  const lit=f=>hash(id*7+f,f*3+1,seed+67)<(f?.5:.8)?0:-1;
  // (la mansarda del 2D —techos.js—: su cubierta plana, a MANSARDA.alto, en los rectángulos que da el plano; la física la
  // lee de L.mansarda —world3d floorAt—)
  L.mansarda=B.mansarda||null;if(fs.mansard&&B.mansarda)for(const c of B.mansarda.cubierta)items.push({piece:'Roof_4x4',x:(c.x0+c.x1)/2,y:L.h+MANSARDA.alto+.2,z:(c.z0+c.z1)/2,sx:(c.x1-c.x0)/4,sz:(c.z1-c.z0)/4});
  let plaqueDone=false;const signAt=[];const streetDoors=[],vidrios=[];
  const cells=[];for(const p of B.parts)for(let y=p.y/S;y<(p.y+p.h)/S;y++)for(let x=p.x/S;x<(p.x+p.w)/S;x++)cells.push([x,y]);
  const ST=B.levels[0].stair&&L.floors>=2?stairOf(B.levels[0].stair,L.floors,FLOOR):null;if(ST)stairs.set(id,ST);
  // ---------- Pisos, cielo raso y techo (por casilla) ----------
  for(const [x,y] of cells){const cx=(x+.5)*S,cz=(y+.5)*S,fs4=S/4;
   for(let f=0;f<L.floors;f++){const hole=ST?.hole(f),C={x:x*S,z:y*S,w:S,h:S};
    // La losa de cada piso, menos el hueco de la escalera (en rectángulos: la pieza de piso del paquete se estira).
    for(const q of hole?minus(C,hole):[C])items.push({piece:'Floor_4x4',x:q.x+q.w/2,y:f?f*FLOOR:.02,z:q.z+q.h/2,sx:q.w/4,sz:q.h/4});}
   items.push({piece:'Floor_4x4',x:cx,y:L.h-.03,z:cz,sx:fs4,sz:fs4});if(!fs.mansard)items.push({piece:'Roof_4x4',x:cx,y:L.h+.2,z:cz,sx:fs4,sz:fs4});
   // (la mansarda: su cubierta, abajo, sólo donde el 2D la pone —techos.js—; antes la losa iba en toda la casilla y tapaba la pizarra)
  }
  // Lo de la azotea (engine/azoteas.js —el 2D lo reparte con la pista del borde libre—): el tanque, la antena, el tendedero y
  // las materas, del catálogo (world3d los dibuja juntos: roofProps), y los equipos de aire, del paquete; todo choca hasta
  // su alto. (Antes el 3D ponía equipos de aire al azar, sin choque.)
  for(const o of B.azotea?.objetos||[]){const ry=o.giro?Math.PI/2:0,w=o.giro?o.d:o.w;wallAny(o.x-o.w/2,o.z-o.d/2,o.x+o.w/2,o.z+o.d/2,L.h,L.h+o.alto);
   if(o.tipo==='aire')items.push({piece:'Prop_ACUnit',x:o.x,y:L.h+.25,z:o.z,ry});
   else roofProps.push({modelo:o.tipo==='tanque'?'tanque_agua':o.tipo==='matera'?'matera_azotea':o.tipo,x:o.x,y:L.h+R,z:o.z,ry,o:{w,paleta:Math.floor(hash(id,Math.round(o.x*7),seed+311)*8)}});}
  // ---------- Fachadas: cada lado de casilla que da afuera, en tres módulos de 2 m ----------
  for(const [x,y] of cells)for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(sameLot(nx,ny,id))continue;
   const ex=(x+.5+dx*.5)*S,ez=(y+.5+dy*.5)*S,tx=dy,tz=-dx,ry=Math.atan2(dx,dy),h=dy!==0,lineKey=h?'h:'+ez.toFixed(2):'v:'+ex.toFixed(2);
   const other=lotAtCell(nx,ny);
   // Medianera: la pared de choque la pone cada uno de su lado; por encima del vecino más bajo, el muro que asoma es
   // fachada (con las ventanas que el plano le pone en esos pisos).
   // (con mansarda: frente a un vecino igual de alto o más, el muro llega a su cubierta; si no, ahí hay pendiente y es pretil)
   let f0=0;if(other>=0){const O=lots[other];wallAny(ex-tx*S/2,ez-tz*S/2,ex+tx*S/2-dx*THIN,ez+tz*S/2-dy*THIN,-1e3,L.h+(fs.mansard&&O.floors>=L.floors?MANSARDA.alto:AZOTEA.pretil));
    {const top=O.h+(O.raise||0),from=Math.min(O.floors,L.floors)*FLOOR+R;// entre el techo del vecino y donde empieza lo nuestro
     if(from-top>.02&&O.floors<=L.floors)for(let k=0;k<3;k++){const c=-S/2+1+2*k;fixed.push({piece:fs.plain,x:ex+tx*c,y:top,z:ez+tz*c,ry,sy:(from-top)/3,tint:tintCul});}}
    if(O.floors>=L.floors){// con mansarda, por encima del vecino asoma el muro de la mansarda (3 m)
     if(fs.mansard&&O.floors===L.floors&&!(O.fs?.mansard))for(let k=0;k<3;k++){const c=-S/2+1+2*k;items.push({piece:fs.plain,x:ex+tx*c,y:L.h,z:ez+tz*c,ry,tint});}
     continue;}f0=O.floors;}
   // Ventanas de 4 m (fs.double): en cada piso de arriba, si dos módulos seguidos son ventana, una sola pieza doble
   // centrada entre los dos (primero los de la izquierda).
   const winMod=(k,f)=>{const c=-S/2+1+2*k,coord=h?ex+tx*c:ez+tz*c,hit=list=>(list||[]).some(s=>{const [a,b]=along(s,h);return coord>a-.01&&coord<b+.01;});
    return f>0&&hit(lines[f].w.get(lineKey))&&!blank.has(`${x},${y},${dx},${dy},${f}`);};
   // Los tabiques que llegan a esta fachada en el piso f (su coordenada a lo largo): una ventana doble no se pone sobre
   // uno (quedaría con la pared divisoria en el medio).
   const line=h?ez:ex,partsAt=f=>{const lv=B.levels[f],out=[];for(const q of [...lv.rooms,...lv.corridor,lv.core].filter(Boolean)){
     const touch=h?Math.abs(q.y-line)<.05||Math.abs(q.y+q.h-line)<.05:Math.abs(q.x-line)<.05||Math.abs(q.x+q.w-line)<.05;if(touch)out.push(...(h?[q.x,q.x+q.w]:[q.y,q.y+q.h]));}return out;};
   const freeEdge=(f,k)=>{const cb=-S/2+2+2*k,at=h?ex+tx*cb:ez+tz*cb;return !partsAt(f).some(p=>Math.abs(p-at)<.35);};
   // Balcón (fs.balconies): frente a la ventana del medio, del segundo piso para arriba y sólo hacia afuera; ese módulo
   // pasa a ser una puerta (y en ese piso no hay ventana doble).
   const balconyAt=f=>fs.balconies&&f>=2&&other<0&&winMod(1,f);
   const pairOf=[];for(let f=0;f<L.floors;f++)pairOf[f]=fs.double&&f>=Math.max(1,f0)&&!balconyAt(f)?(winMod(0,f)&&winMod(1,f)&&freeEdge(f,0)?0:winMod(1,f)&&winMod(2,f)&&freeEdge(f,1)?1:-1):-1;
   for(let k=0;k<3;k++){const c=-S/2+1+2*k,mx=ex+tx*c,mz=ez+tz*c,m0=c-1,m1=c+1,coord=h?mx:mz;
    const hitSeg=list=>(list||[]).find(s=>{const [a,b]=along(s,h);return coord>a-.01&&coord<b+.01;});
    // Choques del módulo: muro entero, salvo la puerta o el portón (libres abajo, pared desde 2,5 m).
    // (hasta el techo y el pretil, no infinito: de la azotea se sale saltando —medidas.js AZOTEA—)
    // (hasta el pretil de la azotea; con mansarda, hasta su techo —3 m—: 2026-10-17, validar-salto caía adentro de una mansarda)
    // (2026-10-18: con la mansarda de pendiente —techos.js—, el muro de la fachada es el pretil a su pie, como en la azotea)
    const wseg=(a,b,y0=-1e3,y1=L.h+AZOTEA.pretil)=>wallAny(ex+tx*a,ez+tz*a,ex+tx*b-dx*WALL_T,ez+tz*b-dy*WALL_T,y0,y1);
    // Los vanos del módulo (alturas libres en su metro y pico del medio: la puerta de calle, las de los balcones).
    const gaps=[];let hg=.6;// (hg: medio ancho del hueco del módulo —el de la puerta: .6, o el de la doble—)
    // (cada ventana que se dibuja, con su vidrio —VIDRIO_PIEZA—, para las cortinas: el vidrio a lo largo de la fachada,
    // en la coordenada de la línea; la pieza mira hacia afuera y su x local va hacia (tx, tz))
    const vidrio=(pz,px_,pz_,cur)=>{const g=VIDRIO_PIEZA[pz]||(pz.startsWith('LP_Ventanal_')?VIDRIO_VENTANAL:null);if(!g)return;const c=h?px_:pz_,sg=h?tx:tz;vidrios.push({f:cur,h,at:h?ez:ex,c,x0:Math.min(g[0]*sg,g[1]*sg),x1:Math.max(g[0]*sg,g[1]*sg),y0:g[2],y1:g[3],pieza:pz});};
    for(let f=f0;f<L.floors;f++){const yb=f*FLOOR,lv=lines[f],win=hitSeg(lv.w.get(lineKey)),door=f===0?hitSeg(lv.d.get(lineKey)):null;
     if(door&&door.bay){// portón: dos columnas, sin pared (el vehículo lo pone civic3d)
      items.push({piece:fs.column,x:ex+tx*m0,y:0,z:ez+tz*m0,tint},{piece:fs.column,x:ex+tx*m1,y:0,z:ez+tz*m1,tint});wseg(m0,m1,2.5);
      if(!streetDoors.some(d=>d.bay&&Math.hypot(d.x-((door.x0+door.x1)/2),d.z-((door.y0+door.y1)/2))<.1))streetDoors.push({x:(door.x0+door.x1)/2,z:(door.y0+door.y1)/2,nx:dx,nz:dy,bay:true,len:Math.hypot(door.x1-door.x0,door.y1-door.y0)});
      doorFronts.push({x:mx,z:mz,nx:dx,nz:dy,half:1.2});continue;}
     if(door&&R){fixed.push({piece:'Stairs_Entrance_Concrete',x:mx,y:0,z:mz,ry,sy:R,sz:.5},{piece:'Stairs_Rails_Metal',x:mx,y:0,z:mz,ry,sy:.8,sz:.5,tint:tint&&{zones:[tint.zones?.[2]||[null,[]]]}});
      stoops.push({x:mx,z:mz,nx:dx,nz:dy,w:2,d:1,h:R});}
     // (la puerta doble —el plano la pone de PUERTA.doble.ancho en los comercios, los locales y lo público—: su marco propio
     // y dos hojas de la mitad, espejadas; las de los locales y comercios, de vidrio)
     const dw=door?Math.hypot(door.x1-door.x0,door.y1-door.y0):0,doble=door&&LOWPOLY.on&&dw>=1.6;
     // (la marquesina de la entrada principal del hospital y del hotel —blueprint marcarEntradas—, sobre la puerta)
     if(door?.entrada)items.push({piece:MARQUESINA(door.entrada),x:mx,y:0,z:mz,ry,tint});
     if(door&&doble){const tienda=['comercio','local'].includes(B.type)||B.levels[0].rooms.some(q=>q.type==='local'&&q.id===door.a),hoja=tienda?'Door_2':fs.leaf,h2=dw/2;
      items.push({piece:PUERTA_DOBLE((fs.paintOn||[])[0]||'MI_RedBrick'),x:mx,y:0,z:mz,ry,tint,lit:lit(0)});
      leaves.push({piece:hoja,x:mx+tx*h2-dx*.12,y:0,z:mz+tz*h2-dy*.12,ry,sx:h2,cx:mx,cz:mz,tint},{piece:hoja,x:mx-tx*h2-dx*.12,y:0,z:mz-tz*h2-dy*.12,ry:ry+Math.PI,sx:h2,dir:-1,cx:mx,cz:mz,tint});
      gaps.push([-1e3,2.5]);hg=h2+.02;doorFronts.push({x:mx,z:mz,nx:dx,nz:dy,half:h2+.4});streetDoors.push({x:mx,z:mz,nx:dx,nz:dy,w:dw});
      if(!plaqueDone){plaques.push({x:mx+dx*.08,z:mz+dy*.08,ry,name:L.bname});plaqueDone=true;}continue;}
     if(door){items.push({piece:fs.door,x:mx,y:0,z:mz,ry,tint,lit:lit(0)});
      leaves.push({piece:fs.leaf,x:mx+tx*.5-dx*.12,y:0,z:mz+tz*.5-dy*.12,ry,cx:mx,cz:mz,tint});
      gaps.push([-1e3,2.5]);doorFronts.push({x:mx,z:mz,nx:dx,nz:dy,half:1});streetDoors.push({x:mx,z:mz,nx:dx,nz:dy});
      if(!plaqueDone){plaques.push({x:mx+dx*.08,z:mz+dy*.08,ry,name:L.bname});plaqueDone=true;}continue;}
     if(f===0&&R)fixed.push({piece:fs.plain,x:mx,y:0,z:mz,ry,sy:R/3,tint});// el zócalo bajo la planta baja
     const bl=f>0&&blank.has(`${x},${y},${dx},${dy},${f}`);
     // Las vidrieras de la planta baja: una lleva el letrero del local con giro (la más cerca de la puerta de calle).
     // (2026-10-18, FACHADAS.md A1: la vidriera, sólo donde el plano dice local —win.shop—; en la planta baja de una casa,
     // una oficina o un hotel, la ventana de su familia: antes toda ventana de planta baja era vidriera y desde la calle se
     // veían el dormitorio y la cocina)
     const vidriera=f===0&&win&&esVidriera(B.type,win);
     if(vidriera&&B.giro)signAt.push({x:mx+dx*.12,z:mz+dy*.12,ry});
     const len=win?Math.hypot(win.x1-win.x0,win.y1-win.y0):0,piece=f===0&&!(win&&!vidriera)?(win?fs.shop:fs.wall):(win&&!bl?(win.pieza==='ventanal'?VENTANAL((fs.paintOn||[])[0]||'MI_RedBrick'):win.pieza&&WINDOWS[win.pieza]?WINDOWS[win.pieza].p:f<=1&&len>=1?winBig:winLight):fs.plain);// (win.pieza: la que eligió el plano para que el cuarto tenga luz)
     const bal=k===1&&balconyAt(f);
     if(bal){// el balcón: puerta (marco y hoja de la de calle, que se abre al acercarse en ese piso), la losa de concreto (la
      // entrada del paquete, de 15 cm), las barandas de los costados (las de una escalera recta) y adelante la baranda baja.
      // Se pisa (balconies) y sus barandas frenan (paredes de 1,1 m).
      items.push({piece:fs.door,x:mx,y:yb,z:mz,ry,tint,lit:lit(f)});leaves.push({piece:fs.leaf,x:mx+tx*.5-dx*.12,y:yb,z:mz+tz*.5-dy*.12,ry,cx:mx,cz:mz,cy:yb,tint});
      items.push({piece:'Entrance_Concrete_2x1',x:mx,y:yb-.15,z:mz,ry,sy:.15},{piece:'Stairs_Rails_Metal_Straight_1',x:mx,y:yb-.97,z:mz,ry,tint:tint&&{zones:[tint.zones?.[2]||[null,[]]]}},{piece:'Trim_Wall_Guard',x:mx+dx*.88,y:yb,z:mz+dy*.88,ry,sy:1.5,tint:tint&&{zones:[tint.zones?.[2]||[null,[]]]}});
      gaps.push([yb-.3,yb+2.5]);balconies.push({x:mx,z:mz,nx:dx,nz:dy,w:2,d:1,y:yb+R});
      const bw=(a0,b0,a1,b1)=>wallAny(Math.min(a0,a1),Math.min(b0,b1),Math.max(a0,a1),Math.max(b0,b1),yb,yb+1.1);
      bw(mx-tx*1+dx*.9,mz-tz*1+dy*.9,mx+tx*1+dx*1,mz+tz*1+dy*1);bw(mx-tx*1,mz-tz*1,mx-tx*.9+dx*1,mz-tz*.9+dy*1);bw(mx+tx*.9,mz+tz*.9,mx+tx*1+dx*1,mz+tz*1+dy*1);}
     else if(pairOf[f]===k){items.push({piece:fs.double,x:mx+tx,y:yb,z:mz+tz,ry,tint,lit:lit(f)});vidrio(fs.double,mx+tx,mz+tz,f);}// la doble, entre este módulo y el siguiente
     else if(pairOf[f]<0||pairOf[f]!==k-1){items.push({piece,x:mx,y:yb,z:mz,ry,tint:other>=0&&!win&&f>0?tintCul:tint,lit:win?lit(f):-1});if((f>0||!vidriera)&&win&&!bl)vidrio(piece,mx,mz,f);}
     // Toldo (fs.awnings) sobre la vidriera de la planta baja.
     if(fs.awnings&&vidriera&&other<0)awnings.push({x:mx+dx*.02,y:2.97,z:mz+dy*.02,ry,color:fs.awningColor});// arriba de la vidriera (el vidrio llega a 2,94 m)
     // Las columnas de la vidriera (planta baja) y la banda sobre la planta baja.
     if(vidriera&&fs.shopColumns)items.push({piece:'Trim_FirstFloor_Window_Columns',x:mx,y:0,z:mz,ry,tint});
     if(f===1&&fs.band)items.push({piece:fs.band,x:mx,y:FLOOR,z:mz,ry,tint});}
    // muro entero en los módulos sin puerta (todos los pisos)
    // (con vanos: los costados enteros y, en el medio, pared salvo en los vanos)
    if(!f0){if(!gaps.length)wseg(m0,m1);else{wseg(m0,c-hg);wseg(c+hg,m1);gaps.sort((p,q)=>p[0]-q[0]);let y0=-1e3;
     for(const [g0,g1] of gaps){if(g0>y0)wseg(c-hg,c+hg,y0,g0);y0=Math.max(y0,g1);}wseg(c-hg,c+hg,y0);}}
    if(!fs.mansard)items.push({piece:fs.cornice,x:mx,y:L.h,z:mz,ry,tint});
    // (la caseta del ascensor —techos.js: sin pendiente en ese tramo—: muro derecho hasta la cubierta, y choca hasta ahí)
    else if(B.mansarda&&!pendienteEn(B.mansarda,mx,mz)){items.push({piece:fs.plain,x:mx,y:L.h,z:mz,ry,tint});wseg(m0,m1,L.h-.1,L.h+MANSARDA.alto);}
    else{const endS=k===0?-1:k===2?1:0,outer=endS&&lotAtCell(x+tx*endS,y+tz*endS)<0;// en la punta de una esquina, la pieza de esquina
     if(!outer)items.push({piece:k===1&&hash(x*3+k,y*5+id,seed+97)<.75?'Roof_SlateCornice_Window_1':'Roof_SlateCornice_Center',x:mx,y:L.h,z:mz,ry,tint});
     else{// La pieza de esquina ocupa el cuadro de 2 × 2 m del módulo de la punta y cae hacia su −x: en la punta izquierda
      // va tal cual; en la derecha, girada 90° sobre el centro del cuadro. Las dos fachadas de la esquina la piden: va una vez.
      const cxq=mx-dx,czq=mz-dy,key='m'+cxq.toFixed(2)+','+czq.toFixed(2);
      if(!columns.has(key)){columns.add(key);const r2=endS<0?ry:ry+Math.PI/2,ox=-Math.sin(r2),oz=-Math.cos(r2);// R(r2)·(0,−1)
       items.push({piece:'Roof_SlateCornice_Corner',x:cxq-ox,y:L.h,z:czq-oz,ry:r2,tint});}}}}
   // Esquinas hacia afuera: una columna por piso donde la fachada dobla.
   // (si la casilla vecina a lo largo de la fachada no es de un edificio, la fachada dobla ahí)
   if(!f0)for(const s of [-1,1]){const ax=x+tx*s,ay=y+tz*s;if(lotAtCell(ax,ay)>=0)continue;const px=ex+tx*s*S/2,pz=ez+tz*s*S/2,key=px.toFixed(2)+','+pz.toFixed(2);
    if(columns.has(key))continue;columns.add(key);
    // De abajo, del medio y de arriba; la de ladrillo, girada hacia adentro de la esquina (su pieza crece hacia −x, −z).
    const ox=Math.sign(dx+tx*s),oz=Math.sign(dy+tz*s),cry=ox>0?(oz>0?0:Math.PI/2):(oz<0?Math.PI:-Math.PI/2);
    // (LOWPOLY: el pilar de COLUMNA, corrido hacia afuera de la esquina: se mete sólo COLUMNA.dentro en cada fachada)
    const lp=LOWPOLY.on,co=COLUMNA.lado/2-COLUMNA.dentro,hl=COLUMNA.lado/2;if(lp)wallAny(px+ox*co-hl,pz+oz*co-hl,px+ox*co+hl,pz+oz*co+hl);// (y su choque: sale a la vereda)
    for(let f=0;f<L.floors;f++)items.push({piece:f===0?fs.columnBottom:f===L.floors-1?fs.columnTop:fs.column,x:px+(lp?ox*co:0),y:f*FLOOR,z:pz+(lp?oz*co:0),ry:lp?0:fs.cornerColumn?cry:0,tint});
   }
  }
  // El letrero del local con giro (encima del toldo), sobre la vidriera más cerca de la puerta de calle.
  if(signAt.length){const d=streetDoors.find(q=>!q.bay)||streetDoors[0],G=SIGN[B.giro],s0=d?signAt.sort((a,b)=>Math.hypot(a.x-d.x,a.z-d.z)-Math.hypot(b.x-d.x,b.z-d.z))[0]:signAt[0];
   plaques.push({...s0,name:B.shopName,bg:G[0],fg:G[1],w:2.6,h:.5,dy:.26});}
  // ---------- Adentro: tabiques, marcos, ascensor y muebles (por piso) ----------
  const outside=(px,pz)=>!B.parts.some(p=>px>p.x&&px<p.x+p.w&&pz>p.y&&pz<p.y+p.h);
  // Una pared interior [p,q] sobre la línea «at»: cada punta que da a una fachada (más allá no hay ningún edificio) se
  // recorta lo que ocupa la pared de afuera.
  const facadeAt=(x,z)=>lotAtCell(Math.floor(x/S),Math.floor(z/S))<0,FACE=WALL_T+.05;
  const trim=(p,q,h,at)=>{if(h?facadeAt(p-.05,at):facadeAt(at,p-.05))p+=FACE;if(h?facadeAt(q+.05,at):facadeAt(at,q+.05))q-=FACE;return [p,q];};
  // staff: dónde trabaja la gente de los locales con giro (el cocinero frente al horno o la plancha, el cajero junto al
  // mostrador): {x, z, yaw, f}.
  const pcs=[],staff=[],boxes=[],models=[],seats=[],sleeps=[],innerLeaves=[],cortinasLote=[],who=B.type==='comisaria'?'police':B.type==='hospital'?'doctor':'civil';
  const box=(x,y,z,sx,sy,sz,color,f,ry=0)=>boxes.push({x,y,z,sx,sy,sz,color,f,ry});
  // Una pieza de Tienda (F_*) apoyada en (x, y, z): centrada por su caja, con la base en y.
  const food=(name,x,y,z,ry,f)=>{const m=furniture?.[name];if(!m)return;const sc=m.scale||1,b=m.box,ox=(b.max.x+b.min.x)/2*sc,oz=(b.max.z+b.min.z)/2*sc,c2=Math.cos(ry),s2=Math.sin(ry);
   models.push({name,x:x-(ox*c2+oz*s2),y:y-b.min.y*sc,z:z-(-ox*s2+oz*c2),ry,s:sc,f});};
  // Los locales con giro (2026-10-12): la comida a la vista. it: el mueble; y: el alto de su cara de arriba; yb: el piso;
  // list: los muebles del piso (para las sillas de cada mesa). SHOP dice qué va en el mostrador («A:B:C»: A con B y C
  // encima), qué se sirve en cada mesa (plato, lo de encima —todo, con all—, lo del lado) y qué va en el medio.
  const dress=(it,cx,cz,wAlong,dIn,y,f,list,yb)=>{const tX=Math.cos(it.ry),tZ=-Math.sin(it.ry),fX=Math.sin(it.ry),fZ=Math.cos(it.ry),at=(u,v=0)=>[cx+tX*u+fX*v,cz+tZ*u+fZ*v],S=SHOP[it.giro],k=hash(Math.round(cx*7),Math.round(cz*7),seed+151);
   if(!S)return;
   if(it.kind==='mostrador'){const row=S.counter,n=row.length,step=Math.min(.4,(wAlong-.3)/n);
    row.forEach((e,i)=>{const [base,...on]=e.split(':'),[x,z]=at((i-(n-1)/2)*step,.05);food(base,x,y,z,it.ry+i*.7,f);
     on.forEach((nm,j)=>{const [ux,uz]=[tX*(j-(on.length-1)/2)*.07,tZ*(j-(on.length-1)/2)*.07];food(nm,x+ux,y+.015,z+uz,it.ry,f);});});}
   else if(it.kind==='mesa'){// lo de cada silla y lo del medio
    let i=0;for(const c of list){if(c.kind!=='silla')continue;const sx=c.x+c.w/2,sz=c.y+c.h/2,d=Math.hypot(sx-cx,sz-cz);if(d>1.2||d<.2)continue;const ux=(sx-cx)/d,uz=(sz-cz)/d,px=cx+ux*.3,qz=cz+uz*.3,ry=Math.atan2(ux,uz),lift=S.plate?.015:0;
     if(S.plate)food(S.plate,px,y,qz,ry,f);
     if(S.all)S.dish.forEach((nm,j)=>food(nm,px+uz*(j-(S.dish.length-1)/2)*.06,y+lift,qz-ux*(j-(S.dish.length-1)/2)*.06,ry,f));
     else food(S.dish[Math.floor((k+i++*.37)%1*S.dish.length)],px,y+lift,qz,ry,f);
     if(S.side)food(S.side,px+uz*.15,y,qz-ux*.15,ry,f);}
    S.center.forEach((nm,j)=>food(nm,cx+j*.12,y,cz,it.ry,f));if(S.drink)food(S.drink,cx+.14,y,cz+.12,0,f);}
   else if(it.kind==='horno'){const [mx,mz]=at(0,dIn/2+.01);
    box(mx,y-.75,mz,.6,.4,.04,'#2a1a12',f,it.ry);box(mx+fX*.022,y-.74,mz+fZ*.022,.46,.1,.02,'#e8742c',f,it.ry);box(mx+fX*.022,y-.64,mz+fZ*.022,.3,.06,.02,'#f2b04a',f,it.ry);// la boca y el fuego
    box(cx,y,cz,it.w*.7,.22,it.h*.7,'#97482f',f);{const [px,qz]=at(-.3,0);food('F_Pizza',px,y+.22,qz,0,f);}}// la cúpula, y una pizza esperando
   else if(it.kind==='plancha'){box(cx,y,cz,it.w-.1,.03,it.h-.1,'#2b2d2f',f);// la plancha
    for(let i=0;i<4;i++){const [x,z]=at(-.5+i*.24,0);food('F_BurgerPatty_Cooked',x,y+.03,z,i,f);}
    {const [x,z]=at(.45,-.1);food('F_Burger_Bread',x,y+.03,z,0,f);}{const [x,z]=at(.45,.12);food('F_Cheese_Singles',x,y+.03,z,0,f);}}
   else if(it.kind==='repisa'){// la repisa de los panes: fondo, costados y tres tablas más, con una fila de pan en cada una
    const W=wAlong,D=dIn,C='#a77b52';{const [x,z]=at(0,-D/2+.015);box(x,yb,z,W,1.75,.03,'#8d6440',f,it.ry);}
    for(const s of [-1,1]){const [x,z]=at(s*(W/2-.015),0);box(x,yb,z,.03,1.75,D,C,f,it.ry);}
    [.05,.55,1.05,1.55].forEach((h,lv)=>{if(lv){const [x,z]=at(0,0);box(x,yb+h-.03,z,W-.06,.03,D,C,f,it.ry);}
     const row=S.shelf[lv%S.shelf.length],n=Math.max(1,Math.floor((W-.2)/.22));for(let i=0;i<n;i++){const [x,z]=at(-(W-.2)/2+(i+.5)*(W-.2)/n,.02);food(row[i%row.length],x,yb+h,z,it.ry+i*.9,f);}});}
   else if(it.kind==='vitrina'){// la vitrina fría: el hueco de arriba y lo que se ve adentro (los helados en sus potes, o el pescado en hielo)
    box(cx,y-.02,cz,it.w-.12,.025,it.h-.12,S.ice||'#3a3f44',f);
    if(S.tubs){const n=Math.max(3,Math.floor((wAlong-.2)/.3));for(let i=0;i<n;i++){const [x,z]=at(-(wAlong-.2)/2+(i+.5)*(wAlong-.2)/n,0);box(x,y,z,.24,.06,.3,S.tubs[i%S.tubs.length],f,it.ry);}}
    if(S.show){const n=S.show.length;S.show.forEach((nm,i)=>{const [x,z]=at((i-(n-1)/2)*Math.min(.4,(wAlong-.3)/n),0);food(nm,x,y+.005,z,it.ry+Math.PI/2,f);});}}
   else if(it.kind==='cajon'){// el cajón de la frutería: listones y una capa de fruta (la que le toca), con algunas encima
    const fr=FRUIT[Math.floor(k*FRUIT.length+(Math.round(cx)+Math.round(cz))*.37)%FRUIT.length],m=furniture?.[fr];
    for(const s of [-1,1]){const [x,z]=at(0,s*(dIn/2-.02));box(x,y,z,wAlong,.08,.04,'#8a6440',f,it.ry);const [x2,z2]=at(s*(wAlong/2-.02),0);box(x2,y,z2,.04,.08,dIn,'#8a6440',f,it.ry);}
    // (a lo sumo unas 30 por cajón: el paso crece si el cajón es grande)
    if(m){const sz=Math.max(TIENDA_STEP[fr]||.1,Math.sqrt((wAlong-.1)*(dIn-.1)/30)),nu=Math.max(1,Math.floor((wAlong-.1)/sz)),nv=Math.max(1,Math.floor((dIn-.1)/sz));
     for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){const [x,z]=at(-(nu-1)/2*sz+i*sz,-(nv-1)/2*sz+j*sz);food(fr,x,y,z,(i*7+j*3)%6,f);
      if((i+j)%3===0&&i>0&&j>0&&i<nu-1&&j<nv-1)food(fr,x+sz*.3,y+sz*.55,z+sz*.2,i+j,f);}}}};
  // Los paños de vidrio de los tabiques (aparte: se dibujan con un material transparente).
  const glass=[],glassBox=(x,y,z,sx,sy,sz,f)=>glass.push({x,y,z,sx,sy,sz,f});
  let cab=null;
  B.levels.forEach((lv,f)=>{const yb=f*FLOOR+.02;
   // El choque de los muebles (2026-10-16, CHOQUE_MUEBLE de medidas.js): los que chocan, una pared hasta su alto —el
   // personaje la pasa si sus pies quedan a menos de un escalón de arriba: así se sube saltando—; los pisables, además,
   // una superficie donde pararse (world3d floorAt). Las sillas, la lámpara de pie y lo de la pared, nada.
   for(const it of lv.furniture||[]){const r=CHOQUE_MUEBLE[it.kind];if(!r||r.choque==='ninguno')continue;
    wallAny(it.x,it.y,it.x+it.w,it.y+it.h,yb,yb+r.alto);if(r.choque==='pisable')superficies.push({x0:it.x,z0:it.y,x1:it.x+it.w,z1:it.y+it.h,y:yb+r.alto});}
   // Los bordes de cuartos y núcleo, juntados por línea; sin lo que es fachada o medianera (eso ya es pared de afuera).
   // Cada tramo de tabique según los cuartos que separa (2026-10-12): abierto (0: la planta de oficinas, el lobby y la
   // sala de lectura hacia el pasillo), de vidrio (1: oficinas privadas, reuniones, sala de profesores, consultorios) o
   // macizo (2: el resto). Si dos cuartos comparten un tramo, gana el más cerrado.
   const OPEN=new Set(['abierta','recepcion','lectura','prestamo','comedor']),GLASS=new Set(['oficina','reuniones','sala_prof','consultorio','enfermeria','secretaria','interrogatorio']);
   const inCorr=(px,pz)=>lv.corridor.some(c=>px>c.x&&px<c.x+c.w&&pz>c.y&&pz<c.y+c.h);
   // El color de la pared que mira a un punto: el del cuarto que lo contiene (uno de su paleta, fijo por cuarto) o, en el
   // pasillo y el núcleo, el del edificio.
   const roomC=new Map(),wallAt=(px,pz)=>{const i=lv.rooms.findIndex(q=>px>q.x&&px<q.x+q.w&&pz>q.y&&pz<q.y+q.h);if(i<0)return hallC;
    if(!roomC.has(i))roomC.set(i,C2?.cuartos?.[lv.level+':'+lv.rooms[i].id]||pickOf(ROOM_PAL[lv.rooms[i].type]||[WALL_COLOR],hash(id*13+i,f*7+3,seed+137)));return roomC.get(i);};
   // Una cara de pared [p,q] sobre la línea «at» (h: corre en x) del lado «side» (±1), de grosor th y centrada en c;
   // partida donde cambia el cuarto de ese lado. Un tabique macizo son dos caras, cada una del color de su cuarto.
   const edges=h=>[...lv.rooms,...lv.corridor,lv.core].filter(Boolean).flatMap(r=>h?[r.x,r.x+r.w]:[r.y,r.y+r.h]);
   const face=(h,at,p,q,side,y,hh,th,c=at+side*th/2)=>{const cs=[p,...edges(h).filter(e=>e>p+.01&&e<q-.01).sort((a,b)=>a-b),q];let s0=p,col=null;
    const flush=e=>{if(e-s0<.01)return;const m=(s0+e)/2;if(h)box(m,y,c,e-s0,hh,th,col,f);else box(c,y,m,th,hh,e-s0,col,f);};
    for(let i=0;i+1<cs.length;i++){const m=(cs[i]+cs[i+1])/2,cc=h?wallAt(m,at+side*.25):wallAt(at+side*.25,m);if(col!==null&&cc!==col){flush(cs[i]);s0=cs[i];}col=cc;}flush(q);};
   const solid=(h,at,p,q,y,hh)=>{face(h,at,p,q,-1,y,hh,THIN/2);face(h,at,p,q,1,y,hh,THIN/2);};
   const segs=new Map(),add=(k,a,b,rank)=>{(segs.get(k)||segs.set(k,[]).get(k)).push([a,b,rank]);};
   for(const q of lv.rooms){for(const [k,a,b,h,at,dir] of [['h:'+q.y.toFixed(2),q.x,q.x+q.w,true,q.y,-1],['h:'+(q.y+q.h).toFixed(2),q.x,q.x+q.w,true,q.y+q.h,1],['v:'+q.x.toFixed(2),q.y,q.y+q.h,false,q.x,-1],['v:'+(q.x+q.w).toFixed(2),q.y,q.y+q.h,false,q.x+q.w,1]]){
     // (las celdas: rejas hacia el pasillo, rango 1,5; entre celdas, pared)
     const m=(a+b)/2,[px,pz]=h?[m,at+dir*.15]:[at+dir*.15,m],rank=OPEN.has(q.type)&&inCorr(px,pz)?0:q.type==='celda'?(inCorr(px,pz)?1.5:2):GLASS.has(q.type)?1:2;add(k,a,b,rank);}}
   // El núcleo es un módulo cerrado (2026-10-12): su contorno y, si hay ascensor, la caja del ascensor entera —el tabique
   // entre el hueco del ascensor y la escalera iba sin hacer: se veían uno al otro y el pasamanos del carril de ese lado
   // quedaba frente a la nada—. La escalera queda entre ese tabique, el contorno y su pared del medio (stairBoxes).
   const rectWalls=q=>{add('h:'+q.y.toFixed(2),q.x,q.x+q.w,2);add('h:'+(q.y+q.h).toFixed(2),q.x,q.x+q.w,2);add('v:'+q.x.toFixed(2),q.y,q.y+q.h,2);add('v:'+(q.x+q.w).toFixed(2),q.y,q.y+q.h,2);};
   if(lv.core)rectWalls(lv.core);if(lv.core&&lv.liftRect){const C=lv.core,Q=lv.liftRect;// (el hueco: los 2 m del ascensor por todo el fondo del núcleo)
    // (a lo ancho, según hacia dónde corren los carriles de la escalera: comparar anchos fallaba en un núcleo cuadrado
    // de 4 × 4 con los carriles a lo largo de z, y el tabique cruzaba la escalera a media subida)
    const ux=lv.stair?Math.abs(lv.stair.ux)>.5:Math.abs(Q.w-C.w)>.01;
    rectWalls(ux?{x:Q.x,y:C.y,w:Q.w,h:C.h}:{x:C.x,y:Q.y,w:C.w,h:Q.h});}
   const doorsBy=byLine(lv.doors.filter(d=>!d.street));
   const GLASS_C='#bcd6e2',MULL='#3a3e43';
   for(const [k,list] of segs){const h=k[0]==='h',at=+k.slice(2);
    // Los tramos elementales (entre todas las puntas) con el rango más cerrado que los cubre, y juntados por rango.
    const pts=[...new Set(list.flatMap(([a,b])=>[a,b]))].sort((a,b)=>a-b),merged=[];
    for(let i=0;i+1<pts.length;i++){const a=pts[i],b=pts[i+1],m=(a+b)/2,cov=list.filter(([p,q])=>m>p&&m<q);if(!cov.length)continue;const rank=Math.max(...cov.map(c=>c[2])),l=merged[merged.length-1];
     if(l&&l[2]===rank&&Math.abs(l[1]-a)<1e-6)l[1]=b;else merged.push([a,b,rank]);}
    const cuts=(doorsBy.get(k)||[]).map(d=>along(d,h)).sort((a,b)=>a[0]-b[0]);
    for(const [a,b,rank] of merged){if(rank===0)continue;// abierto: sin tabique
     let pieces=[[a,b]];for(const [c0,c1] of cuts)pieces=pieces.flatMap(([p,q])=>c1<=p||c0>=q?[[p,q]]:[[p,c0],[c1,q]].filter(([u,v])=>v-u>.05));
     // (partido también donde empieza o termina una parte del edificio: un tramo puede seguir de un tabique de adentro
     // a un borde de afuera en la misma línea, y mirando sólo su punto medio se perdía entero —el fondo del descanso de
     // la escalera, contra el patio, quedaba sin pared y se seguía derecho hasta caer a la planta baja—)
     const ends=[...new Set(B.parts.flatMap(r=>h?[r.x,r.x+r.w]:[r.y,r.y+r.h]))];
     pieces=pieces.flatMap(([p,q])=>{const cs=[p,...ends.filter(e=>e>p+.05&&e<q-.05).sort((u,v)=>u-v),q];return cs.slice(1).map((e,i)=>[cs[i],e]);});
     for(let [p,q] of pieces){const m=(p+q)/2,[px,pz]=h?[m,at]:[at,m],side=h?[outside(px,pz-.1),outside(px,pz+.1)]:[outside(px-.1,pz),outside(px+.1,pz)];if(side[0]||side[1])continue;// borde de afuera
      // La punta que llega a una fachada se corta donde empieza su pared (si no, asoma por el ladrillo como una raya).
      [p,q]=trim(p,q,h,at);const len=q-p,m2=(p+q)/2;
      if(rank===2)solid(h,at,p,q,yb,CEIL-.02);
      else if(rank===1.5){// rejas: riel abajo y arriba, y un barrote cada 15 cm
       const strip=(y,hh)=>{if(h)box(m2,y,at,len,hh,.08,MULL,f);else box(at,y,m2,.08,hh,len,MULL,f);};strip(yb,.08);strip(yb+CEIL-.12,.1);strip(yb+1.1,.05);
       const n=Math.max(2,Math.round(len/.15));for(let i=0;i<=n;i++){const t=p+len*i/n;if(h)box(t,yb,at,.035,CEIL-.02,.035,MULL,f);else box(at,yb,t,.035,CEIL-.02,.035,MULL,f);}}
      else{// vidrio: zócalo y remate oscuros, el paño y un parante cada ~1,2 m
       const strip=(y,hh)=>{if(h)box(m2,y,at,len,hh,THIN,MULL,f);else box(at,y,m2,THIN,hh,len,MULL,f);};strip(yb,.1);strip(yb+CEIL-.12,.1);
       if(h)glassBox(m2,yb+.1,at,len,CEIL-.22,.04,f);else glassBox(at,yb+.1,m2,.04,CEIL-.22,len,f);
       const n=Math.max(1,Math.round(len/1.2));for(let i=0;i<=n;i++){const t=p+len*i/n;if(h)box(t,yb,at,.05,CEIL-.02,THIN,MULL,f);else box(at,yb,t,THIN,CEIL-.02,.05,MULL,f);}}
      if(h)wallAny(p,at-THIN/2,q,at+THIN/2,f*FLOOR-.05,f*FLOOR+FLOOR-.05);else wallAny(at-THIN/2,p,at+THIN/2,q,f*FLOOR-.05,f*FLOOR+FLOOR-.05);}
     // Sobre cada vano, el dintel; alrededor, un marco de madera (no en el ascensor: lo pone la cabina). En el vidrio, el
     // dintel es vidrio y el marco oscuro.
     for(const [c0,c1] of cuts){if(c1<=a||c0>=b)continue;const m=(c0+c1)/2,len=c1-c0,FC=rank<2?MULL:FRAME_COLOR;
      if(rank===2)solid(h,at,c0,c1,yb+2.1,CEIL-2.12);
      // (el dintel también choca, de 2,1 m para arriba: a quien camina no lo toca —los choques miran pies + 1 m—, pero la
      // cámara de tercera persona pasaba por encima de la puerta, a través de él, al pasillo; 2026-10-15)
      if(rank>=1){const y0=f*FLOOR+2.1,y1=f*FLOOR+FLOOR-.05;if(h)wallAny(Math.max(a,c0),at-THIN/2,Math.min(b,c1),at+THIN/2,y0,y1);else wallAny(at-THIN/2,Math.max(a,c0),at+THIN/2,Math.min(b,c1),y0,y1);}
      else if(rank===1){if(h)glassBox(m,yb+2.1,at,len,CEIL-2.22,.04,f);else glassBox(at,yb+2.1,m,.04,CEIL-2.22,len,f);}
      else{if(h)box(m,yb+2.1,at,len,.08,.08,MULL,f);else box(at,yb+2.1,m,.08,.08,len,MULL,f);for(let t=c0+.15;t<c1;t+=.15){if(h)box(t,yb+2.1,at,.035,CEIL-2.12,.035,MULL,f);else box(at,yb+2.1,t,.035,CEIL-2.12,.035,MULL,f);}}
      const core=(doorsBy.get(k)||[]).find(d=>{const [u,v]=along(d,h);return Math.abs(u-c0)<1e-6&&d.core;});if(core)continue;
      for(const e of [c0,c1]){if(h)box(e,yb,at,.08,2.1,THIN+.06,FC,f);else box(at,yb,e,THIN+.06,2.1,.08,FC,f);}
      if(h)box(m,yb+2.06,at,len+.16,.08,THIN+.06,FC,f);else box(at,yb+2.06,m,THIN+.06,.08,len+.16,FC,f);}}}
   // Medianeras por dentro: la cara de revoque de la pared con el vecino, en los pisos que comparten (más arriba es
   // fachada, con sus ventanas).
   for(const [x,y] of cells)for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const o=lotAtCell(x+dx,y+dy);if(sameLot(x+dx,y+dy,id)||o<0||f>=lots[o].floors)continue;
    const ex=(x+.5+dx*.5)*S-dx*THIN/2,ez=(y+.5+dy*.5)*S-dy*THIN/2,h=dy!==0,c0=(h?ex:ez)-S/2,[p,q]=trim(c0,c0+S,h,h?ez:ex);
    face(h,h?ez:ex,p,q,h?-dy:-dx,yb,CEIL-.02,THIN,h?ez:ex);}
   // Las hojas de las puertas de los cuartos (2026-10-12): la bisagra en una punta del vano, cerrada a lo largo de él;
   // abre hacia adentro del cuarto (sgn) hasta ~85°. De tablero en dormitorios y habitaciones, con rejilla en baños, con
   // vidrio en cocinas y oficinas, lisa en lo demás. No llevan: la de calle, el núcleo, los portones anchos, los cuartos
   // abiertos y los vanos de más de 1,2 m. world3d las dibuja con los muebles y las mueve (updateDoors).
   // (2026-10-16: lleva hoja lo que el plano marca —d.hoja, engine/puertas.js: cuartos privados, la puerta de cada unidad—;
   // entre espacios sociales, vano abierto. Abre hacia el cuarto del lado a, o del b si a es el pasillo)
   for(const d of lv.doors){if(d.street||d.core||d.stair||d.wide||d.bay||d.hoja===false)continue;const q=lv.rooms.find(r=>r.id===d.a)||lv.rooms.find(r=>r.id===d.b);if(!q||OPEN.has(q.type))continue;// (del hall a la sala, un vano: una hoja ahí tapaba las puertas del hall)
    const dx=d.x1-d.x0,dz=d.y1-d.y0,len=Math.hypot(dx,dz);if(len>1.25||len<.6)continue;const ux=dx/len,uz=dz/len,cx=(d.x0+d.x1)/2,cz=(d.y0+d.y1)/2;
    const nx=q.x+q.w/2-cx,nz=q.y+q.h/2-cz,th0=Math.atan2(-uz,ux),sgn=Math.sign((-Math.sin(th0))*nx+(-Math.cos(th0))*nz)||1;
    const style=/dormitorio|habitacion|infantil/.test(q.type)?'tablero':/bano|sanitario|vestuario/.test(q.type)?'rejilla':/cocina|oficina|consultorio/.test(q.type)?'vidrio':'lisa';
    innerLeaves.push({style,f,x:d.x0,y:yb,z:d.y0,th0,sgn,w:len,h:2.06,cx,cz,cy:yb,a:d.abierta?1:0,fija:!!d.abierta});}// (abierta: del todo y quieta, engine/puertas.js)
   // El ascensor: junto a la puerta del núcleo, mirando al pasillo.
   const cd=lv.liftRect?lv.doors.find(d=>d.core&&!d.stair):null;if(cd&&lv.core&&!cab){const mx=(cd.x0+cd.x1)/2,mz=(cd.y0+cd.y1)/2,C=lv.core,h=Math.abs(cd.y0-cd.y1)<1e-6;
    let nx=0,nz=0;if(h)nz=mz<C.y+C.h/2?1:-1;else nx=mx<C.x+C.w/2?1:-1;cab={cx:mx+nx*.95,cz:mz+nz*.95,fx:-nx,fz:-nz};}
   // Una lámpara de techo por cuarto.
   const lamp=['Light_Ceiling1','Light_Ceiling3'].filter(n=>furniture?.[n]);
   if(lamp.length)for(const q of lv.rooms)if(q.w*q.h>=4)models.push({name:lamp[(q.id+id)%lamp.length],x:q.x+q.w/2,y:yb+2.78,z:q.y+q.h/2,ry:0,s:furniture[lamp[0]].scale||.52,f});
   // Los muebles.
   for(const it of lv.furniture){const cx=it.x+it.w/2,cz=it.y+it.h/2,turned=Math.abs(Math.sin(it.ry))>.5,wAlong=turned?it.h:it.w,dIn=turned?it.w:it.h;
    // La silla: de oficina junto a un escritorio; acolchada en comedores, cocinas y salas de reuniones; de madera en
    // el resto (las de Casa2, y si no están, las de Oficina o del paquete de la casa).
    // (en el aula, la silla escolar del catálogo: la del pupitre)
    const kind=it.kind==='silla'&&it.rt==='aula'?'silla_escolar':it.kind;
    let name=null;if(kind==='silla_escolar');else if(it.kind==='silla'){const desk=lv.furniture.some(o=>o.kind==='escritorio'&&Math.hypot(o.x+o.w/2-cx,o.y+o.h/2-cz)<1.2);
     name=desk?'OfficeChair':['comedor','cocina','sala_cocina','reuniones','sala_prof','estudio','infantil'].includes(it.rt)?(furniture?.C2_ChairCushioned?'C2_ChairCushioned':'Chair'):(furniture?.C2_Chair?'C2_Chair':'Chair');}
    else name=(MODEL[it.kind]||[]).find(n=>furniture?.[n]);
    if(kind==='silla'&&!furniture?.[name])name=['Chair_1','Chair_3'].find(n=>furniture?.[n]);
    // A la medida (it.fit, 2026-10-12): el objeto del catálogo armado con el ancho y el fondo del plano, uno por medida
    // (se guarda con el resto de los modelos: los muebles de la misma medida van en la misma instancia).
    if(it.fit&&furniture&&it.kind!=='meson'){const cid=FIT_CAT[it.kind]||furniture[name]?.catalogo||(OBJETOS[it.kind]?it.kind:null);
     if(cid&&OBJETOS[cid]){const va=OBJETOS[cid].variantes&&!REEMPLAZOS[name]?variante(OBJETOS[cid],it):null,key=cid+'@'+wAlong.toFixed(2)+'x'+dIn.toFixed(2)+(va?'@'+va:'');if(!furniture[key])furniture[key]=kitModel(cid,{...(REEMPLAZOS[name]?.[1]||{}),w:wAlong,d:dIn,...(va?{variante:va}:{})});name=key;}}
    let top=.75;
    // El mesón: varios muebles de cocina en fila a lo largo de su lugar (el lavaplatos al medio).
    if(it.kind==='meson'&&furniture?.Kitchen_2Drawers){const parts=['Kitchen_2Drawers','Kitchen_Sink','Kitchen_Cabinet1'].filter(n=>furniture[n]),m0=furniture[parts[0]],sc=m0.scale||.52,mw=(m0.box.max.x-m0.box.min.x)*sc;
     const n=Math.max(1,Math.floor((wAlong+.02)/mw)),tX=Math.cos(it.ry),tZ=-Math.sin(it.ry);
     for(let k=0;k<n;k++){const nm=k===Math.floor(n/2)&&furniture.Kitchen_Sink?'Kitchen_Sink':parts[k%parts.length]==='Kitchen_Sink'?parts[0]:parts[k%parts.length],m=furniture[nm],b=m.box,ox=(b.max.x+b.min.x)/2*sc,oz=(b.max.z+b.min.z)/2*sc,c2=Math.cos(it.ry),s2=Math.sin(it.ry);
      const off=(k-(n-1)/2)*mw,px=cx+tX*off,pz=cz+tZ*off;models.push({name:nm,x:px-(ox*c2+oz*s2),y:yb+.04,z:pz-(-ox*s2+oz*c2),ry:it.ry,s:sc,f});}top=m0.box.max.y*sc;}
    else if(name&&furniture?.[name]){const m=furniture[name],b=m.box;let sc=m.scale||.52,ry=it.ry;
     // Si el modelo no cabe en su lugar del plano, primero se gira 90° (algunos vienen con el lado largo cruzado) y, si
     // aun así no entra, se achica lo justo (nunca más de un 35 %): nada asoma por paredes ni ventanas.
     const mw=(b.max.x-b.min.x)*sc,md=(b.max.z-b.min.z)*sc,fits=(a,c)=>a<=wAlong+.04&&c<=dIn+.04;
     if(!fits(mw,md)&&fits(md,mw))ry+=Math.PI/2;
     else if(!fits(mw,md)){const k=Math.max(.65,Math.min(wAlong/mw,dIn/md));sc*=k;}
     const ox=(b.max.x+b.min.x)/2*sc,oz=(b.max.z+b.min.z)/2*sc,c2=Math.cos(ry),s2=Math.sin(ry);
     // (los del catálogo saben dónde queda su cara de arriba —la cama, el colchón y no la cabecera—)
     models.push({name,x:cx-(ox*c2+oz*s2),y:yb+.04,z:cz-(-ox*s2+oz*c2),ry,s:sc,f});top=m.catalogo?OBJETOS[m.catalogo].alto({}):b.max.y*sc;}
    // Lo que no tiene modelo: el del catálogo de objetos (objetos3d.js), y si no está, una caja.
    else if(OBJETOS[kind]){const O=OBJETOS[kind],o={w:wAlong,d:dIn,variante:variante(O,it)};boxes.push(...placeParts(O.piezas(o),{x:cx,y:yb,z:cz,ry:it.ry},{f}));top=O.alto(o);}
    else{const [hh,col,from=0]=BOX[it.kind]||[.8,'#999'];box(cx,yb+from,cz,it.w,hh,it.h,col,f);top=from+hh;}
    // La comida y la cocina de los locales con giro.
    if(it.giro&&furniture?.F_Plate)dress(it,cx,cz,wAlong,dIn,yb+top+(name&&furniture?.[name]?.04:0),f,lv.furniture,yb);
    // Decoración 2 (2026-10-12, del catálogo de objetos). tX: a lo ancho del mueble; fX: hacia su frente.
    {const tX=Math.cos(it.ry),tZ=-Math.sin(it.ry),fX=Math.sin(it.ry),fZ=Math.cos(it.ry),k=hash(Math.round(cx*9),Math.round(cz*9),seed+181),sy=yb+top+(name&&furniture?.[name]?.04:0);
     // sobre el lavamanos, el espejo con su repisa (la espalda contra la pared de atrás)
     // (si en esa pared hay una ventana, el espejo no va: la taparía)
     if(it.kind==='lavamanos'){const mx=cx-fX*dIn/2,mz=cz-fZ*dIn/2,win=lv.windows.some(w=>{const h=Math.abs(w.y0-w.y1)<1e-3,[u0,u1]=h?[Math.min(w.x0,w.x1),Math.max(w.x0,w.x1)]:[Math.min(w.y0,w.y1),Math.max(w.y0,w.y1)],line=h?w.y0:w.x0,along=h?mx:mz,off=h?Math.abs(mz-line):Math.abs(mx-line);return off<.4&&along+wAlong/2>u0-.1&&along-wAlong/2<u1+.1;});
      if(!win)boxes.push(...placeParts(OBJETOS.espejo.piezas({w:wAlong}),{x:mx,y:yb+1.0,z:mz,ry:it.ry},{f}));}
     // en la ducha, la mampara (el vidrio va con los paños de vidrio de los tabiques)
     if(it.kind==='ducha')for(const q of placeParts(OBJETOS.mampara.piezas({w:wAlong,d:dIn}),{x:cx,y:yb,z:cz,ry:it.ry},{f})){if(!q.vidrio){boxes.push(q);continue;}const t=Math.abs(Math.sin(q.ry))>.5;glassBox(q.x,q.y,q.z,t?q.sz:q.sx,q.sy,t?q.sx:q.sz,f);}
     // un teléfono en algunos escritorios (al costado de la cajonera) y en el de la recepción
     if(it.kind==='escritorio'&&(k<.45||it.rt==='recepcion'||it.rt==='secretaria'))boxes.push(...placeParts(OBJETOS.telefono.piezas(),{x:cx+tX*.52+fX*.1,y:sy,z:cz+tZ*.52+fZ*.1,ry:it.ry},{f}));
     // un florero en las mesas de la casa, la de centro y las de reunión o de lectura (no en las de los locales)
     if(!it.giro&&['mesa','mesa_centro','mesa_reunion','mesa_lectura'].includes(it.kind)&&k<.75)boxes.push(...placeParts(OBJETOS.florero.piezas({variante:['rojas','amarillas','lilas'][Math.floor(k*30)%3],paleta:Math.floor(k*70)}),{x:cx,y:sy,z:cz,ry:k*6},{f}));
     // en la estufa, una olla y una sartén
     if(it.kind==='estufa'&&furniture?.F_CookingPot_Soup){food('F_CookingPot_Soup',cx-tX*.12,sy,cz-tZ*.12,it.ry,f);food('F_FryingPan',cx+tX*.13,sy,cz+tZ*.13,it.ry+.5,f);}}
    // Computador sobre el escritorio: base, pie, monitor y pantalla, mirando a la silla.
    // (el del catálogo de objetos: monitor, teclado y mouse, mirando a la silla)
    if(it.pc)pcs.push({x:cx,z:cz,f});
    if(it.pc)boxes.push(...placeParts(OBJETOS.computador.piezas(),{x:cx,y:yb+top,z:cz,ry:it.ry},{f}));
    // Para la gente (indoor3d.js): cada silla es un asiento y cada cama, un lugar para dormir.
    // (meal: la silla de una mesa de un local con giro: ahí se viene a comer)
    if(it.giro&&(it.kind==='horno'||it.kind==='plancha'))staff.push({x:cx+Math.sin(it.ry)*(dIn/2+.42),z:cz+Math.cos(it.ry)*(dIn/2+.42),yaw:it.ry+Math.PI,f});
    if(it.giro&&it.kind==='mostrador')staff.push({x:cx+Math.cos(it.ry)*(wAlong/2+.38)+Math.sin(it.ry)*.15,z:cz-Math.sin(it.ry)*(wAlong/2+.38)+Math.cos(it.ry)*.15,yaw:it.ry,f});
    if(it.kind==='silla')seats.push({meal:!!it.giro,x:cx,y:yb,z:cz,yaw:it.ry,f,lot:id,who,lift:liftFor(name&&furniture?.[name]?(furniture[name].box.max.y-furniture[name].box.min.y)*(furniture[name].scale||.52):.9),ap:-.55,by:null});
    // (en el camarote se acuesta en la cama de abajo)
    if(it.kind==='litera')top=.45;
    if(/^cama|^litera/.test(it.kind)){const tX=Math.cos(it.ry),tZ=-Math.sin(it.ry),hw=wAlong/2+.55;
     sleeps.push({x:cx,z:cz,top:yb+top,yaw:it.ry,f,by:null,sides:[{x:cx+tX*hw,z:cz+tZ*hw},{x:cx-tX*hw,z:cz-tZ*hw}]});}}
   // ---------- Alfombras y cuadros (2026-10-12, del catálogo de objetos) ----------
   // La alfombra, centrada en el cuarto y a lo largo de su lado largo (los muebles quedan encima, como en una casa).
   // El cuadro, en la pared libre más larga: una pared de verdad (fachada, medianera o tabique macizo: no la de vidrio
   // ni la abierta al pasillo), sin ventana, puerta ni mueble alto delante; a 1,55 m de alto su centro.
   for(const [qi,q] of lv.rooms.entries()){const r=hash(id*31+qi,f*13+5,seed+171),r2=hash(id*7+qi,f*5+9,seed+173);
    if(DECO_RUG.has(q.type)&&Math.min(q.w,q.h)>=2.6){const long=q.w>=q.h,W=Math.min(Math.max(q.w,q.h)-1.2,3),D=Math.min(Math.min(q.w,q.h)-1.2,2);
     if(W>1.2&&D>.9)boxes.push(...placeParts(OBJETOS.alfombra.piezas({w:W,d:D,variante:['persa','rayas','moderna'][Math.floor(r*3)],paleta:Math.floor(r2*RUG_COUNT)}),{x:q.x+q.w/2,y:yb+.004,z:q.y+q.h/2,ry:long?0:Math.PI/2},{f}));}
    if(!DECO_ART.has(q.type)&&!(q.type==='local'&&q.giro))continue;
    const cands=[];
    for(const [h,at,a,b,dir] of [[true,q.y,q.x,q.x+q.w,1],[true,q.y+q.h,q.x,q.x+q.w,-1],[false,q.x,q.y,q.y+q.h,1],[false,q.x+q.w,q.y,q.y+q.h,-1]]){
     const m=(a+b)/2,[ox,oz]=h?[m,at-dir*.2]:[at-dir*.2,m],o=lotAtCell(Math.floor(ox/S),Math.floor(oz/S));
     let off;if(o<0||(o!==id&&f>=lots[o].floors))off=FACE;else if(o!==id)off=THIN+.01;
     else{if(inCorr(ox,oz)&&(OPEN.has(q.type)||GLASS.has(q.type)))continue;if(GLASS.has(q.type))continue;off=THIN/2+.01;}
     // lo que tapa: ventanas y puertas de esa línea, y los muebles altos pegados a ella
     const on=s=>h?Math.abs(s.y0-at)<.02&&Math.abs(s.y1-at)<.02:Math.abs(s.x0-at)<.02&&Math.abs(s.x1-at)<.02,span=s=>h?[Math.min(s.x0,s.x1),Math.max(s.x0,s.x1)]:[Math.min(s.y0,s.y1),Math.max(s.y0,s.y1)];
     // (las ventanas con más margen: a sus lados cuelgan las cortinas)
     const bl=[...lv.windows.filter(on).map(span).map(([u,v])=>[u-.45,v+.45]),...lv.doors.filter(on).map(span).map(([u,v])=>[u-.25,v+.25])];
     for(const it of lv.furniture){if(!TALL.has(it.kind))continue;const near=h?Math.abs((dir>0?it.y:it.y+it.h)-at)<.7:Math.abs((dir>0?it.x:it.x+it.w)-at)<.7;if(near)bl.push(h?[it.x-.1,it.x+it.w+.1]:[it.y-.1,it.y+it.h+.1]);}
     const cuts=[[a+.3,b-.3]];for(const [u,v] of bl)for(let i=cuts.length-1;i>=0;i--){const [c0,c1]=cuts[i];if(v<=c0||u>=c1)continue;cuts.splice(i,1,...[[c0,u],[v,c1]].filter(([x0,x1])=>x1-x0>.05));}
     for(const [c0,c1] of cuts)if(c1-c0>=.8)cands.push({h,at,dir,off,len:c1-c0,m:(c0+c1)/2,c1});}
    cands.sort((a,b)=>b.len-a.len);const best=cands[0];
    if(best){const W=Math.min(1.2,best.len-.2),H=+(W*.7).toFixed(2),[px,pz]=best.h?[best.m,best.at+best.dir*best.off]:[best.at+best.dir*best.off,best.m],ry=best.h?(best.dir>0?0:Math.PI):(best.dir>0?Math.PI/2:-Math.PI/2);
     boxes.push(...placeParts(OBJETOS.cuadro.piezas({w:W,h:H,variante:['paisaje','mar','abstracto','flores'][Math.floor(r2*4)],marco:Math.floor(r*4)}),{x:px,y:yb+1.55-H/2,z:pz,ry},{f}));}
    // El reloj de pared (cocinas, oficinas, aulas, recepción…): en otra pared libre o, si no hay, al final de la del cuadro.
    if(CLOCK.has(q.type)&&best){const o=cands.find(c=>c!==best&&!(c.h===best.h&&Math.abs(c.at-best.at)<.01))||(best.len>=2.4?{...best,m:best.c1-.35}:null);
     if(o){const [px,pz]=o.h?[o.m,o.at+o.dir*o.off]:[o.at+o.dir*o.off,o.m];boxes.push(...placeParts(OBJETOS.reloj.piezas({paleta:Math.floor(r*9)}),{x:px,y:yb+2.0,z:pz,ry:o.h?(o.dir>0?0:Math.PI):(o.dir>0?Math.PI/2:-Math.PI/2)},{f}));}}
    // Las cortinas, en las ventanas de fachada de los cuartos donde se vive (no en las vidrieras de los locales).
    if(CURTAIN.has(q.type)){const tone=['crema','azul','verde','terracota'][Math.floor(r2*4)];
     // (2026-10-16: una por ventana DIBUJADA —vidrios: la doble es una sola— y a la medida de su vidrio, engine/cortinas.js
     // cortinaAbierta; las de cortina cerrada, no: esas tienen su paño)
     const paredes=new Map();for(const v of vidrios){if(v.f!==f)continue;const h=v.h,at=v.at,a=h?q.x:q.y,b=h?q.x+q.w:q.y+q.h,gm=v.c+(v.x0+v.x1)/2;
      const edge=h?(Math.abs(at-q.y)<.02?1:Math.abs(at-q.y-q.h)<.02?-1:0):(Math.abs(at-q.x)<.02?1:Math.abs(at-q.x-q.w)<.02?-1:0);if(!edge||gm<a||gm>b)continue;
      if(lv.windows.some(w=>w.cortina&&(Math.abs(w.y0-w.y1)<1e-3)===h&&Math.abs((h?w.y0:w.x0)-at)<.02&&Math.abs((h?(w.x0+w.x1):(w.y0+w.y1))/2-gm)<v.x1-v.x0))continue;
      const K=cortinaAbierta(v,a,b);const reg={f,h,at,vidrio:[v.c+v.x0,v.c+v.x1,v.y1],cortina:null,cuarto:[a,b],pieza:v.pieza};cortinasLote.push(reg);if(!K)continue;
      const key=(h?'h':'v')+at.toFixed(2)+':'+edge;(paredes.get(key)||paredes.set(key,{h,at,edge,ks:[]}).get(key)).ks.push({...K,reg});}
     // (las de una misma pared que se pisarían, un solo juego)
     for(const {h,at,edge,ks} of paredes.values())for(const K of juntarCortinas(ks.sort((p,r)=>p.u0-r.u0))){
      for(const k of ks)if(k.u0>=K.u0-1e-6&&k.u1<=K.u1+1e-6)k.reg.cortina={u0:K.u0,u1:K.u1,paño:K.paño,h:K.h,solapa:!!k.solapa};
      const [px,pz]=h?[K.m,at+edge*(FACE+.02)]:[at+edge*(FACE+.02),K.m];
      boxes.push(...placeParts(OBJETOS.cortina.piezas({w:K.w,h:K.h,bajo:K.bajo,variante:tone,pliegues:K.pliegues}),{x:px,y:yb,z:pz,ry:h?(edge>0?0:Math.PI):(edge>0?Math.PI/2:-Math.PI/2)},{f}));}}}
   // Las cortinas cerradas (engine/cortinas.js, w.cortina): un paño de lado a lado detrás del vidrio. No van con los
   // muebles (que sólo se dibujan de cerca): se ven de lejos y tapan el cuarto vacío (world3d las dibuja siempre).
   // (2026-10-16, las acciones: el paño va en TODAS las ventanas de los cuartos que llevan cortina —CORTINA.cuartos—, cada una
   // con su clave lote:piso:ventana y cerrado o no según el plano; el jugador lo abre o lo cierra —world3d cortina()—)
   lv.windows.forEach((w,wi)=>{if(w.shop)return;const c=cuartoDeVentana(lv,w);if(!c||!CORTINA_CU.has(c.q.type))return;const tela=w.cortina||telaDe(id,f,wi);
    const cj=panioCerrado(c,tela,yb,FACE+.02).cajas;panios.push({key:id+':'+f+':'+wi,i0:cortinas.length,n:cj.length,cerrada:!!w.cortina});cortinas.push(...cj);});
  });
  // ---------- La escalera: peldaños con huella y nariz, descanso, pared del medio, pasamanos y la baranda del último piso ----------
  // El material según el edificio (STAIRS, stairKind): madera, mármol, granito, concreto o acero.
  if(ST){const {sd,run,P,FR}=ST;
   const K=STAIRS[stairKind(B.type,fs)],M=pickOf(K,hash(id*17,5,seed+141));
   // El ancho libre de cada carril (2026-10-12): entre la cara de la pared de afuera y la del muro del medio (10 cm).
   // La de afuera puede ser un tabique del núcleo (6 cm de este lado), una medianera (12 cm) o la fachada (25 cm): se
   // mira qué hay del otro lado. Peldaños, descanso, pasamanos y ménsulas van dentro de ese ancho (antes las huellas
   // se metían 4 cm en el muro del medio y los pasamanos rozaban la pared).
   const side=(a,b=FR+run/2)=>{const [x,z]=P(a,b),o=lotAtCell(Math.floor(x/S),Math.floor(z/S));return o<0?FACE:o!==id?THIN+.01:THIN/2+.01;};
   const W=ST.W,A0=side(-.15),A1=W-side(W+.15),BD=sd.d-side(W/2,sd.d+.15);
   stairBoxes(ST,M,{floors:L.floors,FLOOR,hallC,A0,A1,BD,box,boxes,wallAny,deco:Math.floor(hash(id*19,7,seed+143)*16)});}
  // ---------- Sin caras que titilen (2026-10-16): las cajas del lote —muebles, marcos, escalera, decoración— con una
  // cara en el mismo plano que otra de otro color se alternan al mover la cámara; la más chica se retira 3 mm ----------
  {const ok=piezasSinTitilar(boxes,{suelos:Array.from({length:L.floors+1},(_,f)=>[f*FLOOR,f*FLOOR+.02]).flat()});for(let i=0;i<ok.length;i++)boxes[i]=ok[i];}
  // ---------- La cabina del ascensor, una por piso ----------
  // (roof: la parada de la azotea, sobre el techo plano o sobre la mansarda; la cabina asoma como una caseta)
  if(cab&&L.floors>=2)ctx.elevators.push({lot:id,...cab,raise:R,floors:L.floors,roof:L.h+(fs.mansard?MANSARDA.alto:0),open:new Float32Array(L.floors+1)});
  // ---------- Para los vecinos y la vista ----------
  const cx=B.parts.reduce((a,p)=>a+(p.x+p.w/2)*p.w*p.h,0)/B.parts.reduce((a,p)=>a+p.w*p.h,0),cz=B.parts.reduce((a,p)=>a+(p.y+p.h/2)*p.w*p.h,0)/B.parts.reduce((a,p)=>a+p.w*p.h,0);
  // noWalk: la escalera entera (la gente de adentro no la usa: vive en su piso).
  if(R){for(let i=i0;i<items.length;i++)items[i].y=(items[i].y||0)+R;for(let i=l0;i<leaves.length;i++){leaves[i].y=(leaves[i].y||0)+R;if(leaves[i].cy!=null)leaves[i].cy+=R;}for(let i=a0;i<awnings.length;i++)awnings[i].y+=R;for(let i=k0;i<cortinas.length;i++)cortinas[i].y+=R;for(let i=s0;i<superficies.length;i++)superficies[i].y+=R;
   // (la silla con un computador a menos de 1,1 m en el mismo piso es de trabajo: ahí se teclea —persona3d.js Typing—)
   for(const st of seats)st.pc=pcs.some(q=>q.f===st.f&&Math.hypot(q.x-st.x,q.z-st.z)<1.1);
   for(const o of [...boxes,...glass,...models,...seats])o.y+=R;for(const o of innerLeaves){o.y+=R;o.cy+=R;}for(const o of sleeps){if(o.top!=null)o.top+=R;if(o.y!=null)o.y+=R;}for(let i=p0;i<plaques.length;i++)plaques[i].y=R;}
  items.push(...fixed);wallLift=0;
  // (cada pieza, con su lote: downtown3d las junta por lote para poder apagar lo que no se ve —engine/visibles.js—)
  for(let i=i0;i<items.length;i++)items[i].lote=id;for(let i=k0;i<cortinas.length;i++)cortinas[i].lote=id;// (y las cortinas: world3d las apaga con su lote)
  lotFurniture.set(id,{id,raise:R,leaves:innerLeaves,cortinas:cortinasLote,glass,who,floors:L.floors,cells:cells.map(([x,y])=>[x*S,y*S,(x+1)*S,(y+1)*S]),items:models,beds:boxes,seats,sleeps,staff,x:cx,z:cz,r:Math.sqrt(cells.length)*S,noWalk:ST?[ST.rect(-.2,-.2,ST.W+.2,ST.sd.d+.2)]:[]});
  // ---------- Edificios públicos: letrero, portones, cruz, bandera ----------
  const civicType={hospital:'hospital',colegio:'colegio',biblioteca:'biblioteca',bomberos:'bomberos',comisaria:'comisaria'}[B.type];
  const out=streetDoors.filter(d=>!d.bay).map(d=>({x:d.x+d.nx*1.5,z:d.z+d.nz*1.5}));
  if(B.type==='comisaria')stationInfo={floors:L.floors,cells:cells.map(([x,y])=>[x*S,y*S,(x+1)*S,(y+1)*S]),doors:out};
  if(civicType&&CIVIC[civicType]){const g=B.wings[0],front={N:[0,-1],S:[0,1],W:[-1,0],E:[1,0]}[g.front],ry=Math.atan2(front[0],front[1]);
   const fx=front[0],fz=front[1],len=(fx?g.h:g.w)*S,mx=(fx?(fx>0?(g.x1+1)*S:g.x0*S):(g.x0*S+g.x1*S+S)/2),mz=(fz?(fz>0?(g.y1+1)*S:g.y0*S):(g.y0*S+g.y1*S+S)/2);
   const c={id,type:civicType,name:L.bname,bay:[]};const w=Math.min(len-.8,9);
   c.sign={x:mx-fx*.8,z:mz-fz*.8,ry,w:Math.min(w*1.15,11),roof:L.h};c.sign.y0=Math.max(L.h+1.35,clearance(c.sign.x,c.sign.z,fz,-fx,c.sign.w/2,fx,fz)+.6);
   if(civicType==='hospital')c.roof={x:cx,y:L.h,z:cz};
   if(CIVIC[civicType].flag&&streetDoors.length){const d=streetDoors[0];c.flag={x:d.x+d.nx*1.2+d.nz*1.8,z:d.z+d.nz*1.2-d.nx*1.8};}
   for(const d of streetDoors.filter(d=>d.bay))c.bay.push({kind:CIVIC[civicType].bay||'camion',x:d.x,z:d.z,ry:Math.atan2(d.nx,d.nz),len:CIVIC[civicType].bay==='patrulla'?4.5:6.4});
   civics.push(c);civicFronts.push(...out);}
 }
 // Los toldos: la lona inclinada (2 × 1,15 m, cae hacia afuera desde la pared) y su faldón, a rayas (el color de cada
 // edificio por instancia, sobre rayas blancas y grises).
 if(awnings.length){const c=document.createElement('canvas');c.width=64;c.height=4;const g=c.getContext('2d');for(let i=0;i<8;i++){g.fillStyle=i%2?'#ffffff':'#9a9a9a';g.fillRect(i*8,0,8,4);}
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.magFilter=THREE.NearestFilter;
  const top=new THREE.BoxGeometry(2,.04,1.15);top.translate(0,0,.575);top.rotateX(.42);const fy=-1.15*Math.sin(.42),fz=1.15*Math.cos(.42);
  const val=new THREE.BoxGeometry(2,.24,.03);val.translate(0,fy-.1,fz);const geo=mergeGeometries([top,val]);top.dispose();val.dispose();
  // (LOWPOLY: la lona lisa, del color de su edificio —sin las rayas pintadas—)
  const mat=new THREE.MeshStandardMaterial(LOWPOLY.on?{roughness:.9,flatShading:true}:{map:tex,roughness:.9});own.push(geo,mat,tex);ctx.instanced(group,geo,mat,awnings);}
 return {roofProps,items,leaves,doorFronts,plaques,lotFurniture,civics,civicFronts,stationInfo,stairs,stoops,balconies,cortinas,superficies,panios};
}

// Las cabinas de los ascensores: paredes de metal, techo con luz y botonera, puertas corredizas (se abren cuando el
// jugador está cerca, en ese piso). Mira hacia (fx,fz); para los choques, sus paredes con el hueco de la puerta.

/* La escalera en U armada en cajas (2026-10-12, sacada de buildTown para que la use también el taller /objetos): ST
   (stairOf), M (un material de STAIRS), floors pisos de FLOOR m, hallC (el color del muro del medio), A0/A1 (las caras
   de las paredes de afuera de los carriles, en el eje a) y BD (la de la pared del fondo, en b). box(x,y,z,sx,sy,sz,
   color,f) y boxes reciben las cajas; wallAny(x0,z0,x1,z1,y0,y1), los choques (en el taller, nada). */
export function stairBoxes(ST,M,{floors,FLOOR,hallC,A0=.07,A1,BD,box,boxes,wallAny=()=>{},deco=0}){
   const {sd,run,P,FR,BK,W,HW,N}=ST;if(A1==null)A1=W-.07;const rise=1.5/N,tread=run/N,alongX=Math.abs(sd.ux)>.5,TH=.045,NO=.03;if(BD==null)BD=sd.d-.07;
   // Una caja en coordenadas de la escalera: centro (a,b), ancho da (a lo ancho de los carriles) y fondo db.
   const sbox=(a,b,y,da,db,hh,color,f)=>{const [x,z]=P(a,b);box(x,y,z,alongX?da:db,hh,alongX?db:da,color,f);};
   const swall=(a0,b0,a1,b1,y0,y1)=>{const [x0,z0]=P(a0,b0),[x1,z1]=P(a1,b1);wallAny(Math.min(x0,x1)-.05,Math.min(z0,z1)-.05,Math.max(x0,x1)+.05,Math.max(z0,z1)+.05,y0,y1);};
   // Un pasamanos inclinado sobre el carril a, de (b0,y0) a (b1,y1): una caja larga girada (rx o rz, según hacia dónde
   // corre b en el mundo; la caja gira sobre el centro de su base).
   const slope=(a,b0,y0,b1,y1,f,w=.05,color=M.rail)=>{const [x,z]=P(a,(b0+b1)/2),len=Math.hypot(b1-b0,y1-y0),t=Math.atan2(y1-y0,b1-b0);
    if(alongX)boxes.push({x,y:(y0+y1)/2-w/2,z,sx:w,sy:w,sz:len,color,f,ry:0,rx:-t*Math.sign(sd.vz||1)});
    else boxes.push({x,y:(y0+y1)/2-w/2,z,sx:len,sy:w,sz:w,color,f,ry:0,rz:t*Math.sign(sd.vx||1)});};
   const M0=HW-.05,M1=HW+.05,cA=(A0+M0)/2,cB=(M1+A1)/2,wA=M0-A0,wB=A1-M1;
   // Del primer piso para arriba los tramos no son macizos hasta la losa: debajo pasa el tramo del piso de abajo (2026-10-15:
   // un bloque desde el suelo dejaba 1,5 m sobre los pies en el carril A y en el descanso, y la cabeza se metía en él).
   // Cada peldaño baja sólo SOFF por debajo de su contrahuella (una losa inclinada en escalones) y el descanso es una losa.
   const SOFF=.18,bot=(f,base,top)=>f?Math.max(base,top-rise-SOFF):base;
   for(let f=0;f<floors-1;f++){const base=f*FLOOR+.02;
    for(let i=0;i<N;i++){const yA=base+rise*(i+1),yB=base+1.5+rise*(i+1),fA=FR+tread*i,fB=FR+run-tread*i;
     // carril A (sube hacia el fondo; la nariz mira hacia adelante) y carril B (vuelve; la nariz mira al fondo). La
     // huella y la nariz no se pisan: la nariz es la franja de adelante (si compartieran la cara de arriba, titilan).
     const bA=bot(f,base,yA-TH),bB=!f&&ST.nook&&i>=ST.nook.i0?Math.max(base,yB-TH-rise-SOFF):bot(f,base,yB-TH);
     sbox(cA,fA+tread/2,bA,wA-.01,tread+.005,yA-TH-bA,M.body,f);sbox(cA,fA+(tread+.036-NO)/2,yA-TH,wA,tread-.036+NO,TH,M.tread,f);sbox(cA,fA-NO+.018,yA-TH-.006,wA,.036,TH+.006,M.nose,f);
     sbox(cB,fB-tread/2,bB,wB-.01,tread+.005,yB-TH-bB,M.body,f);sbox(cB,fB-(tread+.036-NO)/2,yB-TH,wB,tread-.036+NO,TH,M.tread,f);sbox(cB,fB+NO-.018,yB-TH-.006,wB,.036,TH+.006,M.nose,f);}
    // (el descanso, hasta la cara de la pared del fondo)
    const bD=f?base+1.5-TH-SOFF:base;sbox((A0+A1)/2,(FR+run+BD)/2,bD,A1-A0,BD-FR-run,base+1.5-TH-bD,M.body,f);sbox((A0+A1)/2,(FR+run+BD)/2,base+1.5-TH,A1-A0,BD-FR-run,TH,M.tread,f);
    // (la pared del medio, de losa a losa: con 7 cm menos quedaba una ranura entre la de un piso y la del siguiente)
    sbox(HW,FR+run/2,base,.1,run,FLOOR,hallC,f);swall(HW,FR,HW,FR+run,f*FLOOR-.05,f*FLOOR+FLOOR-.05);
    // Pasamanos a 90 cm sobre las narices, a 4 cm de cada pared (contra la del medio y contra la de afuera, en los dos
    // carriles), con tres ménsulas que llegan hasta la pared.
    for(const [a,wa] of [[M0-.065,M0],[A0+.065,A0],[M1+.065,M1],[A1-.065,A1]]){const up=a<HW,b0=up?FR:FR+run,b1=up?FR+run:FR,y0=base+(up?0:1.5)+.9,y1=y0+1.5;
     slope(a,b0-(up?.15:-.15),y0-.1,b1+(up?.15:-.15),y1+.1,f);
     for(const t of [.15,.5,.85]){const bb=b0+(b1-b0)*t;sbox((a+wa)/2,bb,y0+1.5*t-.06,Math.abs(wa-a),.03,.06,M.rail,f);}}}
   // El canto de la losa alrededor del hueco (2026-10-16, Miguel: «la división entre pisos se ve un corte cuando subo»):
   // la losa del paquete son dos planos —el piso en Y y el cielo raso en Y−0,1— y los muros de abajo llegan a Y−0,12, así
   // que en el hueco, de canto, se veía entre los dos planos hasta el cuarto de al lado. Una franja de STAIR_CANTO, del
   // color de la escalera (hallC), a ras de las caras de las paredes (A0, A1, BD) y del borde del vano (FR), la cierra.
   const CA=STAIR_CANTO;
   for(let f=1;f<floors;f++){const y=f*FLOOR+CA.y0,hh=CA.y1-CA.y0,mb=(FR+BD)/2,lb=BD-FR,ma=(A0+A1)/2,la=A1-A0+2*CA.e;
    sbox(A0-CA.e/2,mb,y,CA.e,lb,hh,hallC,f-1);sbox(A1+CA.e/2,mb,y,CA.e,lb,hh,hallC,f-1);
    sbox(ma,BD+CA.e/2,y,la,CA.e,hh,hallC,f-1);sbox(ma,FR-CA.e/2,y,la,CA.e,hh,hallC,f-1);}
   // El rincón bajo el carril B de planta baja (ST.nook): la cara de lo macizo que lo cierra, un cuadro colgado en ella y
   // una planta en la esquina de afuera. El choque, en la cara (nadie camina por debajo de lo bajo) y alrededor de la planta.
   if(ST.nook){const nb=ST.nook.b1,[fx,fz]=[-sd.vx,-sd.vz],ry=Math.atan2(fx,fz),cw=Math.min(.7,wB-.24),[qx,qz]=P(cB,nb-.005);
    boxes.push(...placeParts(OBJETOS.cuadro.piezas({w:cw,h:.5,variante:OBJETOS.cuadro.variantes[deco%4],marco:deco>>2}),{x:qx,y:STAIR_CUADRO,z:qz,ry},{f:0}));
    const pa=A1-.22,pb=nb-.22,[mx,mz]=P(pa,pb);boxes.push(...placeParts(OBJETOS.maceta.piezas(),{x:mx,y:.02,z:mz,ry:deco*.7},{f:0}));
    swall(M1,nb,A1,nb,-.05,2);swall(pa-.16,pb-.16,pa+.16,pb+.16,-.05,1);}
   // Arriba, una baranda alrededor del hueco: pasamanos, zócalo y barrotes cada 12 cm (de pared a pared).
   const top=floors-1,tb=top*FLOOR+.02;
   const balus=(a0,b0,a1,b1)=>{const len=Math.hypot(a1-a0,b1-b0),am=(a0+a1)/2,bm=(b0+b1)/2,ga=Math.abs(a1-a0)>.01;
    sbox(am,bm,tb+.95,ga?len:.06,ga?.06:len,.06,M.rail,top);sbox(am,bm,tb,ga?len:.05,ga?.05:len,.08,M.post,top);
    const n=Math.max(2,Math.round(len/.12));for(let i=1;i<n;i++){const t=i/n;sbox(a0+(a1-a0)*t,b0+(b1-b0)*t,tb+.08,.025,.025,.87,M.post,top);}};
   // (la del medio, sólo sobre los carriles: sobre el descanso del último tramo quedaba a la altura de la cabeza; el choque
   // de ese borde sí sigue hasta el fondo, para que nadie camine por encima del hueco)
   balus(A0,FR,M0,FR);balus(HW,FR,HW,FR+run);
   swall(0,FR,HW,FR,top*FLOOR-.05,top*FLOOR+FLOOR-.05);swall(HW,FR,HW,sd.d,top*FLOOR-.05,top*FLOOR+FLOOR-.05);}

export function buildCabins(elevators,{FLOOR,group,own,instanced,base,addWall,S,W,H}){
 const cab=[],light=[],E=.85,T=.07,DOOR=.5;
 const wallAny=(ax,az,bx,bz)=>{const x0=Math.min(ax,bx),x1=Math.max(ax,bx),z0=Math.min(az,bz),z1=Math.max(az,bz);
  for(let cy=Math.floor(z0/S);cy<=Math.floor(z1/S);cy++)for(let cx=Math.floor(x0/S);cx<=Math.floor(x1/S);cx++)if(cx>=0&&cy>=0&&cx<W&&cy<H)addWall(cx,cy,x0,z0,x1,z1);};
 // Un punto del marco de la cabina: n a lo largo del frente, t a lo ancho.
 const P=(e,n,t)=>[e.cx+e.fx*n-e.fz*t,e.cz+e.fz*n+e.fx*t];
 const B=(e,n,t,y,sn,sy,st,color,list=cab)=>{const [x,z]=P(e,n,t),ax=Math.abs(e.fx)>.5;list.push({x,y,z,sx:ax?sn:st,sy,sz:ax?st:sn,color});};
 for(const e of elevators){
  for(let f=0;f<=e.floors;f++){const y0=(f<e.floors?f*FLOOR:e.roof)+.02+(e.raise||0);
   // (la cabina del catálogo de objetos: su frente, +z, es la puerta; lo que brilla va con la luz)
   for(const q of placeParts(OBJETOS.ascensor.piezas(),{x:e.cx,y:y0,z:e.cz,ry:Math.atan2(e.fx,e.fz)}))(q.luz?light:cab).push(q);}
  const seg=(n0,t0,n1,t1)=>{const [ax,az]=P(e,n0,t0),[bx,bz]=P(e,n1,t1);wallAny(ax,az,bx,bz);};
  seg(-E-.05,-E,-E+.05,E);seg(-E,-E-.05,E,-E+.05);seg(-E,E-.05,E,E+.05);seg(E-.05,-E,E+.05,-DOOR);seg(E-.05,DOOR,E+.05,E);}
 if(cab.length){const sm=new THREE.MeshStandardMaterial({roughness:.45,metalness:.12});own.push(sm);instanced(group,base(new THREE.BoxGeometry(1,1,1)),sm,cab);
  const lm=new THREE.MeshStandardMaterial({color:'#fff8e8',emissive:'#fff1d6',emissiveIntensity:1.1});own.push(lm);instanced(group,base(new THREE.BoxGeometry(1,1,1)),lm,light,{cast:false});}
 const list=[];for(const e of elevators)for(let f=0;f<=e.floors;f++)for(const s of [-1,1])list.push({e,f,s});
 let mesh=null;if(list.length){const dm=new THREE.MeshStandardMaterial({color:'#c3c9cd',roughness:.3,metalness:.2});own.push(dm);mesh=new THREE.InstancedMesh(base(new THREE.BoxGeometry(1,1,1)),dm,list.length);mesh.frustumCulled=false;mesh.castShadow=true;group.add(mesh);}
 const o3=new THREE.Object3D();
 const setDoors=()=>{if(!mesh)return;list.forEach((d,i)=>{const a=d.e.open[d.f],[x,z]=P(d.e,E+.02,d.s*(DOOR/2+a*DOOR*.9)),ax=Math.abs(d.e.fx)>.5;o3.position.set(x,(d.f<d.e.floors?d.f*FLOOR:d.e.roof)+.02+(d.e.raise||0),z);o3.scale.set(ax?.04:DOOR,2.2,ax?DOOR:.04);o3.updateMatrix();mesh.setMatrixAt(i,o3.matrix);});mesh.instanceMatrix.needsUpdate=true;};
 setDoors();return setDoors;
}
