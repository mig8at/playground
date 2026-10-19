/* Plantas de la isla de /demo: el «Ultimate Crops Pack» de Quaternius (CC0, public/models/Cultivos). Cada planta viene
   en cuatro etapas (_1 a _4: de brote a crecida) y el fruto cosechado (_Crop, que no se usa acá). Sin texturas: el color
   de cada parte va en su .mtl. Se cargan una vez y se dibujan con instancias (una malla por modelo y material). */
import * as THREE from 'three';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {REEMPLAZOS,kitModel} from './objetos3d.js';

const BASE='/models/Cultivos/';
// Sus colores, a pleno sol y con sombras, quedan algo oscuros (los troncos casi negros): se aclaran un poco.
const LIFT=1.3;
export const PLANTS=['PalmTree_3','PalmTree_4','Apple_4','Orange_4','BushBerries_4','Corn_3','Corn_4','Wheat_4','Lettuce_4','Carrot_4','Tomato_4',
 'Pumpkin_4','Watermelon_4','Flower_3','Flower_4','Grass_2','Grass_3'];

function mtlColors(text){const out={};let name=null;for(const line of text.split('\n')){const p=line.trim().split(/\s+/);
 if(p[0]==='newmtl')name=p[1];else if(p[0]==='Kd'&&name)out[name]=new THREE.Color().setRGB(+p[1],+p[2],+p[3],THREE.LinearSRGBColorSpace);}return out;}

// El paquete de naturaleza (public/models/Naturaleza): 4 árboles, 3 arbustos, 3 rocas y 3 matas de pasto, low poly.
export const NATURE=['Tree1','Tree2','Tree3','Tree4','Bush1','Bush2','Bush3','Rock1','Rock2','Rock3','Grass1','Grass2','Grass3'];
let natureCache=null;
export function loadNature(){
 if(natureCache)return natureCache;
 natureCache=loadSet('/models/Naturaleza/',NATURE,{lift:1.15,rock:'#9a948a'});
 return natureCache;
}
// Carga un grupo de OBJ con sus .mtl. Las rocas vienen una casi negra y otra blanca: se pintan del mismo gris piedra.
function loadSet(base,names,{lift=1,rock=null,scale=null}={}){const loader=new OBJLoader(),models={},text=u=>fetch(u).then(r=>r.ok?r.text():Promise.reject(u));
 return Promise.all(names.map(n=>Promise.all([text(base+n+'.obj'),text(base+n+'.mtl')]).then(([o,m])=>{
  const colors=mtlColors(m),obj=loader.parse(o.replace(/^l .*$/gm,'')),parts=[];obj.updateMatrixWorld(true);
  obj.traverse(c=>{if(!c.isMesh)return;const mats=(Array.isArray(c.material)?c.material:[c.material]).map(x=>{
   const col=rock&&/^Rock/.test(n)?new THREE.Color(rock):(colors[x.name]||new THREE.Color('#7a9a50')).clone().multiplyScalar(lift);
   const mm=new THREE.MeshStandardMaterial({color:col,roughness:.9,flatShading:true,side:THREE.DoubleSide});mm.name=x.name;return mm;});
   parts.push({geometry:c.geometry,materials:mats.length>1?mats:mats[0]});});
  models[n]={parts,box:new THREE.Box3().setFromObject(obj),scale:scale?.[n]??scale?.default};}).catch(()=>{}))).then(()=>Object.keys(models).length?models:null);}

// La naturaleza más detallada (public/models/Naturaleza2, «Ultimate Nature» de Quaternius): árboles de 1.350 a 2.950
// triángulos (los de Naturaleza, ~400), arbustos, flores, plantas, rocas con musgo. Vienen oscuros: se aclaran.
export const NATURE2=['CommonTree_1','CommonTree_2','CommonTree_3','CommonTree_4','CommonTree_5','BirchTree_1','BirchTree_2','BirchTree_3','BirchTree_5',
 'CommonTree_Autumn_3','CommonTree_Autumn_4','BirchTree_Autumn_2','Bush_1','Bush_2','BushBerries_1','BushBerries_2','Flowers','Plant_1','Plant_2','Plant_3','Plant_5',
 'Rock_Moss_1','Rock_Moss_2','Rock_Moss_3','TreeStump_Moss','Grass_Short'];
let nature2Cache=null;
export function loadNature2(){if(!nature2Cache)nature2Cache=loadSet('/models/Naturaleza2/',NATURE2,{lift:1.85});return nature2Cache;}
// Muebles y objetos de las casas (public/models/Casa): sólo los que se usan. Escala del paquete: ×0,52 (una puerta de 2,2 m).
export const FURNITURE=['Door_1','Door_2','Door_4','Door_6','Couch_Small2','Table_RoundSmall','Chair_1','Chair_2','Carpet_1','Carpet_Round',
 'Kitchen_Fridge','Kitchen_Sink','Kitchen_Oven','Kitchen_2Drawers','Houseplant_3','Houseplant_6','Houseplant_8','Light_Ceiling1','Light_Ceiling3',
 'Light_Floor1','Shelf_1','NightStand_1','NightStand_2','Drawer_1','Couch_Medium2','Drawer_2','Shelf_2','Houseplant_1','Houseplant_7','Chair_3',
 'Kitchen_Cabinet1','Light_Floor3','Trashcan_Small1',
 // El baño, las camas y la repisa (del mismo paquete; se sumaron el 2026-10-10).
 'Bathroom_Toilet','Bathroom_Sink','Bathroom_Mirror1','Bathroom_Shower1','Bathroom_Bathtub','Bathroom_WashingMachine','Bed_King','Bed_Single','Bed_Bunk','Bookshelf'];
let furnitureCache=null;
export function loadFurniture(){if(!furnitureCache)furnitureCache=loadSet('/models/Casa/',FURNITURE,{scale:{default:.52}});return furnitureCache;}
// Las casas armadas (vivienda3d.js): los muebles, todas las puertas (menos la 8, de 2.600 triángulos) y las ventanas.
export const HOUSE_KIT=[...new Set([...FURNITURE,'Door_3','Door_5','Door_7','Door_9','Door_Double','Window_Large1','Window_Large2','Window_Small1','Window_Small2','Window_Small3',
 'Window_Round1','Window_Round2','Window_Round3','Kitchen_Cabinet1'])];
let houseKitCache=null;
// (los modelos pesados que reemplaza el catálogo de objetos —REEMPLAZOS— no se cargan: se arman de sus piezas)
const withCatalog=(names,models)=>{if(!models)return models;for(const n of names)if(REEMPLAZOS[n])models[n]=kitModel(...REEMPLAZOS[n]);return models;};
export function loadHouseKit(){if(!houseKitCache)houseKitCache=loadSet('/models/Casa/',HOUSE_KIT.filter(n=>!REEMPLAZOS[n]),{scale:{default:.52}}).then(m=>withCatalog(HOUSE_KIT,m));return houseKitCache;}

// Muebles de Casa2 (public/models/Casa2, 2026-10-12): libreros con libros, mesas de centro, lámparas de pie, sillones,
// sillas, camas, armarios, floreros. Vienen sin colores (el .mtl trae el mismo gris en todo y sin texturas: se
// perdieron al exportar) pero con nombres de material que dicen qué es cada parte: el color sale del nombre. Miran
// hacia +x (el respaldo y la cabecera en −x): se giran −90° para que miren hacia +z como los demás paquetes. Y vienen
// en proporciones chicas: cada uno con su escala (la cama, 2 m de largo; la silla, ~0,95 m de alto…). Se guardan
// como «C2_<nombre>» (Oficina tiene nombres iguales).
const CASA2_SCALE={Bed:1.47,BedKing:1.4,BookCase:1.3,BookCaseBooks:1.3,BookCaseLarge:1.3,BookCaseLargeBooks:1.3,Chair:.95,ChairCushioned:.95,ChairHandle:1.2,
 Closet:1.3,Closet2:1.3,CoffeeTable:1.4,CoffeeTable2:1.4,Lamp:1.5,Lamp2:1.5,Plant:2,Sofa:1.3,SofaDouble:1.3,SofaLong:1.3,Stool:1.3,Table:1.2,Vase:1.2,Vase2:1.2};
const CASA2_COLOR=[[/^DarkWood/,'#6e4b33'],[/^Wood/,'#b98a5e'],[/^DarkBrown/,'#4f3727'],[/^Sheets/,'#efe9de'],[/^White/,'#f4f2ec'],[/^Green/,'#5f9147'],[/^Red/,'#b8432f'],
 [/^Metal/,'#3d4146'],[/^Top/,'#f3e2bf'],[/^Pages/,'#efe5cc'],[/^Cover2/,'#b8432f'],[/^Cover3/,'#3d6f9e'],[/^Cover4/,'#4f8a55'],[/^Sofa/,'#7d8ea6'],[/^Vase/,'#c9704a']];
let casa2Cache=null;
export function loadCasa2(){if(casa2Cache)return casa2Cache;const loader=new OBJLoader(),models={},rot=new THREE.Matrix4().makeRotationY(-Math.PI/2);
 // (las bibliotecas las arma el catálogo de objetos: no se cargan)
 casa2Cache=Promise.all(Object.keys(CASA2_SCALE).filter(n=>!REEMPLAZOS['C2_'+n]).map(n=>fetch('/models/Casa2/'+n+'.obj').then(r=>r.ok?r.text():Promise.reject(n)).then(o=>{
  const obj=loader.parse(o.replace(/^l .*$/gm,'')),parts=[];obj.updateMatrixWorld(true);
  obj.traverse(c=>{if(!c.isMesh)return;const geo=c.geometry.clone().applyMatrix4(rot);c.geometry=geo;const mats=(Array.isArray(c.material)?c.material:[c.material]).map(x=>{
    const col=(CASA2_COLOR.find(([re])=>re.test(x.name))||[0,'#9a8f84'])[1],mm=new THREE.MeshStandardMaterial({color:col,roughness:.85,flatShading:true,side:THREE.DoubleSide});mm.name=x.name;return mm;});
   parts.push({geometry:geo,materials:mats.length>1?mats:mats[0]});});
  models['C2_'+n]={parts,box:new THREE.Box3().setFromObject(obj),scale:CASA2_SCALE[n]};}).catch(()=>{}))).then(()=>Object.keys(models).length?withCatalog(Object.keys(CASA2_SCALE).map(n=>'C2_'+n),models):null);
 return casa2Cache;}

// La comida y la cocina (public/models/Tienda, 2026-10-12): frutas, pizzas, hamburguesas, platos, ollas… Vienen a
// escalas muy distintas (la pizza mide 3,4 unidades y el rollo de sushi 0,3): cada uno se lleva a su medida real (el
// lado más largo, en metros). Los colores salen de su .mtl (Kd, lineales). Se guardan como «F_<nombre>».
const TIENDA_SIZE={Pizza:.34,Pizza_Slice:.17,Pizza_Burned:.34,Plate:.26,Plate2:.26,Plate_Square:.24,Soda:.12,Burger:.11,BurgerLarge:.13,Cheeseburger:.11,
 DoubleCheeseburger:.13,Fries:.13,KetchupMustard:.19,KetchupBottle:.2,MustardBottle:.2,MayoBottle:.2,BurgerPatty_Cooked:.1,BurgerPatty_Raw:.1,Burger_Bread:.11,
 Cheese_Singles:.09,Hotdog:.18,Bottle1:.28,Bottle2:.28,Tomato:.07,Lettuce_Whole:.16,Mushroom:.05,Pepper_Red:.09,Pepper_Green:.09,Apple:.08,Banana:.18,
 Orange:.08,Bread:.28,Croissant:.13,Donut1:.1,Cupcake:.08,CookingPot:.3,FryingPan:.4,Jar_Large:.2,Steak:.2,Fish:.3,CookingPot_Soup:.28,
 Bread_Slice:.1,Donut2:.1,Donut3:.1,Donut4:.1,Pancakes_Stack:.16,Waffle:.14,IceCream_1:.11,IceCream_2:.11,IceCream_3:.11,IceCream_4:.11,IceCream_Cone:.17,
 IceCream_Cone2:.17,Popsicle_Chocolate:.15,Popsicle_Strawberry:.15,Popsicle_Multiple:.18,Apple_Green:.08,Avocado:.1,Coconut:.14,Carrot:.16,Broccoli:.14,Eggplant:.18,
 Pumpkin:.3,Turnip:.1,Sushi_Nigiri1:.07,Sushi_Nigiri2:.07,Sushi_NigiriOctopus:.07,Sushi_Roll1:.045,Sushi_Roll2:.045,Sashimi_Salmon:.08,Sashimi_Salmon2:.08,
 Chopsticks:.22,SoySauce:.1,Lettuce:.15};
let tiendaCache=null;
export function loadTienda(){if(tiendaCache)return tiendaCache;const loader=new OBJLoader(),models={};
 const kd=t=>{const m={};let cur=null;for(const l of t.split('\n')){const w=l.trim().split(/\s+/);if(w[0]==='newmtl')cur=w[1];else if(w[0]==='Kd'&&cur)m[cur]=new THREE.Color().setRGB(+w[1],+w[2],+w[3]);}return m;};
 tiendaCache=Promise.all(Object.keys(TIENDA_SIZE).map(n=>Promise.all(['.obj','.mtl'].map(e=>fetch('/models/Tienda/'+n+e).then(r=>r.ok?r.text():Promise.reject(n)))).then(([o,mtl])=>{
  const obj=loader.parse(o.replace(/^l .*$/gm,'')),cols=kd(mtl),parts=[];obj.updateMatrixWorld(true);
  obj.traverse(c=>{if(!c.isMesh)return;const mats=(Array.isArray(c.material)?c.material:[c.material]).map(x=>{const mm=new THREE.MeshStandardMaterial({color:cols[x.name]||new THREE.Color('#b0a090'),roughness:.7,flatShading:true});mm.name=x.name;return mm;});
   parts.push({geometry:c.geometry,materials:mats.length>1?mats:mats[0]});});
  const box=new THREE.Box3().setFromObject(obj),sz=box.getSize(new THREE.Vector3());
  models['F_'+n]={parts,box,scale:TIENDA_SIZE[n]/Math.max(sz.x,sz.y,sz.z)};}).catch(()=>{}))).then(()=>Object.keys(models).length?models:null);
 return tiendaCache;}

// Muebles de oficina (public/models/Oficina): más detallados. Cada uno con su escala (vienen a tamaños distintos). Además,
// 'HospitalBed': la cama individual repintada de blanco y gris claro, para el hospital.
const OFFICE_SCALE={Desk:.85,Chair:.85,OfficeChair:.85,Table:.85,Table2:.85,Stool:.85,Bookcase:.6,Bookcase_Books:.6,Closet:.68,ShortCloset:.68,
 NightStand:.95,BedDouble:.5,BedTwin:.5,Sofa:.55,Sofa2:.55,Sofa3:.55,Sofa_individual:.55};
let officeCache=null;
export function loadOffice(){
 if(officeCache)return officeCache;
 // (2026-10-12: el escritorio, la silla de oficina, el archivador, la mesa de noche y la cama de hospital son los del
 // catálogo de objetos, de 120 a 400 triángulos en vez de 2.000 a 4.700; la cama gemela —3.684— tampoco se carga: sólo
 // era el respaldo de cama_s y la base de la de hospital)
 const names=[...Object.keys(OFFICE_SCALE),'HospitalBed'];
 officeCache=loadSet('/models/Oficina/',Object.keys(OFFICE_SCALE).filter(n=>!REEMPLAZOS[n]&&n!=='BedTwin'),{scale:OFFICE_SCALE,lift:1.15}).then(m=>withCatalog(names,m));
 return officeCache;
}

let cache=null;
export function loadPlants(){
 if(cache)return cache;const loader=new OBJLoader(),models={};
 const text=u=>fetch(u).then(r=>r.ok?r.text():Promise.reject(u));
 cache=Promise.all(PLANTS.map(n=>Promise.all([text(BASE+n+'.obj'),text(BASE+n+'.mtl')]).then(([o,m])=>{
  const colors=mtlColors(m),obj=loader.parse(o.replace(/^l .*$/gm,'')),parts=[];obj.updateMatrixWorld(true);
  obj.traverse(c=>{if(!c.isMesh)return;const mats=(Array.isArray(c.material)?c.material:[c.material]).map(x=>
   Object.assign(new THREE.MeshStandardMaterial({color:(colors[x.name]||new THREE.Color('#7a9a50')).clone().multiplyScalar(LIFT),roughness:.85,flatShading:true,side:THREE.DoubleSide}),{name:x.name}));
   parts.push({geometry:c.geometry,materials:mats.length>1?mats:mats[0]});});
  models[n]={parts,box:new THREE.Box3().setFromObject(obj)};}).catch(()=>{})))
  .then(()=>Object.keys(models).length?models:null);
 return cache;
}

// items: {x,y,z,ry,s}. Una InstancedMesh por pieza del modelo (con sus materiales por grupo).
// tint (opcional): un tono por instancia que multiplica el color del modelo (para que no salgan todos iguales).
export function plantInstances(kit,name,items,group,{shadow=true}={}){
 const m=kit?.[name];if(!m||!items.length)return 0;const o=new THREE.Object3D();
 for(const p of m.parts){const im=new THREE.InstancedMesh(p.geometry,p.materials,items.length);
  const c=new THREE.Color();items.forEach((it,i)=>{o.position.set(it.x,it.y,it.z);o.rotation.set(0,it.ry||0,0);o.scale.set(it.sx??it.s??1,it.sy??it.s??1,it.sz??it.sx??it.s??1);o.updateMatrix();im.setMatrixAt(i,o.matrix);if(it.tint)im.setColorAt(i,c.set(it.tint));});
  im.castShadow=shadow;im.receiveShadow=true;im.computeBoundingSphere();group.add(im);}
 return items.length;
}

// Lo mismo, pero cada planta se puede descartar sola (2026-10-16, «sólo dibujar lo que se ve»): con una InstancedMesh por
// pieza, la esfera que la envuelve es la ciudad entera y el motor nunca descarta nada —eran dos tercios de lo que se
// dibujaba—. Una BatchedMesh por pieza y por material (no acepta varios materiales): three.js descarta por cámara cada
// planta, y setCeldas apaga las de las casillas que no se ven (engine/visibles.js, desde adentro de un edificio).
// Devuelve {setCeldas(celdas|null, W, S), n}.
export function plantBatched(kit,name,items,group,{shadow=true}={}){
 const m=kit?.[name];if(!m||!items.length)return null;const o=new THREE.Object3D(),c=new THREE.Color(),todas=[];
 for(const p of m.parts){const g=p.geometry,mats=Array.isArray(p.materials)?p.materials:[p.materials],grupos=g.groups?.length?g.groups:[{start:0,count:g.index?g.index.count:g.attributes.position.count,materialIndex:0}];
  for(const gr of grupos){const mat=mats[gr.materialIndex??0]||mats[0];if(!mat)continue;
   // (la parte de la geometría de ese material, con todos sus vértices y sólo sus triángulos)
   const sub=new THREE.BufferGeometry();for(const [k,a] of Object.entries(g.attributes))sub.setAttribute(k,a);
   const idx=g.index?g.index.array.slice(gr.start,gr.start+gr.count):Uint32Array.from({length:gr.count},(_,i)=>gr.start+i);sub.setIndex(new THREE.BufferAttribute(idx,1));
   const bm=new THREE.BatchedMesh(items.length,g.attributes.position.count,idx.length,mat);bm.sortObjects=!!mat.transparent;const gid=bm.addGeometry(sub),ids=[];
   items.forEach(it=>{const iid=bm.addInstance(gid);o.position.set(it.x,it.y,it.z);o.rotation.set(0,it.ry||0,0);o.scale.set(it.sx??it.s??1,it.sy??it.s??1,it.sz??it.sx??it.s??1);o.updateMatrix();bm.setMatrixAt(iid,o.matrix);if(it.tint)bm.setColorAt(iid,c.set(it.tint));ids.push(iid);});
   bm.castShadow=shadow;bm.receiveShadow=true;group.add(bm);todas.push({bm,ids});}}
 let antes=null;
 const setCeldas=(celdas,W,S=6)=>{if(celdas===antes)return;antes=celdas;for(const {bm,ids} of todas)items.forEach((it,i)=>bm.setVisibleAt(ids[i],!celdas||celdas.has(Math.floor(it.z/S)*W+Math.floor(it.x/S))));};
 return {setCeldas,n:items.length};}
