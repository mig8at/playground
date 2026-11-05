// El 3D sin pantalla (2026-10-16): lo mínimo para armar las mallas en node, sin WebGL ni navegador, y medirlas. Las
// texturas que se pintan en un lienzo (piedra, asfalto, letreros) reciben uno de mentira que no dibuja nada: la
// geometría —lo que se mide— no depende de ellas. Se importa ANTES que cualquier módulo de src/lib.
// Después: armarIsla(semilla) da {bp, isla} con la isla del 3D (island3d buildIsland) tal como la arma el demo.
const nada=()=>{},gradiente={addColorStop:nada};
const contexto=new Proxy({},{get:(o,k)=>k in o?o[k]:(k==='createLinearGradient'||k==='createRadialGradient'||k==='createPattern')?()=>gradiente:k==='measureText'?()=>({width:0}):k==='getImageData'?(x,y,w,h)=>({data:new Uint8ClampedArray(4*w*h),width:w,height:h}):nada,set:(o,k,v)=>{o[k]=v;return true;}});
const lienzo=()=>({width:1,height:1,style:{},getContext:()=>contexto,toDataURL:()=>'',addEventListener:nada});
// (las imágenes —las texturas de los modelos— «cargan» enseguida: three espera su evento load; vacías, de 1×1)
const imagen=()=>{const ev={};return {width:1,height:1,style:{},addEventListener(t,f){ev[t]=f;},removeEventListener(t){delete ev[t];},set src(v){this._src=v;setTimeout(()=>ev.load?.call(this,{}),0);},get src(){return this._src;}};};
const elemento=t=>t==='canvas'?lienzo():t==='img'?imagen():{style:{},appendChild:nada,addEventListener:nada};
if(!globalThis.document)globalThis.document={createElement:elemento,createElementNS:(ns,t)=>elemento(t),body:{appendChild:nada}};
if(!globalThis.window)globalThis.window=globalThis;
if(!globalThis.self)globalThis.self=globalThis;
if(!globalThis.navigator)globalThis.navigator={userAgent:'node'};

export async function armarIsla(semilla,team=3){const {generateBlueprint}=await import('../src/engine/blueprint.js'),{buildIsland}=await import('../src/lib/island3d.js');
 const bp=generateBlueprint({seed:semilla,team});return {bp,isla:buildIsland(bp.map,{plan:bp})};}

// El mundo entero como lo arma el demo (DemoView load): la ciudad con sus modelos, la isla, los barrios y las casas del
// monte, las viviendas por dentro y lo que el plano pone afuera (plano3d). Los modelos se leen de public/ con
// node-model-env (sin red); un juego que no carga queda en null, como en el demo. Devuelve {bp, partes:{nombre: grupo},
// grupo (todo junto), world, isla, viviendas, plano, kits}.
export async function armarMundo(semilla,team=3){await import('./node-model-env.mjs');
 const {generateBlueprint}=await import('../src/engine/blueprint.js'),THREE=await import('three');
 const {buildWorld}=await import('../src/lib/world3d.js'),{buildIsland}=await import('../src/lib/island3d.js'),{createBarrios}=await import('../src/lib/barrios3d.js'),{createCasas}=await import('../src/lib/casas3d.js'),{createHouses}=await import('../src/lib/vivienda3d.js'),{dibujarPlano}=await import('../src/lib/plano3d.js');
 const {loadDowntown}=await import('../src/lib/downtown3d.js'),N3=await import('../src/lib/nature3d.js');
 const kit=async f=>{try{return await f();}catch{return null;}};
 const [downtown,nature,nature2,plants,houseKit,office0,casa2,tienda]=await Promise.all([kit(loadDowntown),kit(N3.loadNature),kit(N3.loadNature2),kit(N3.loadPlants),kit(N3.loadHouseKit),kit(N3.loadOffice),kit(N3.loadCasa2),kit(N3.loadTienda)]);
 const office={...(office0||{}),...(casa2||{}),...(tienda||{})},furniture={...(houseKit||{}),...office};
 const bp=generateBlueprint({seed:semilla,team}),plan=bp,city=bp.map;
 const world=buildWorld(city,{plan,downtown,nature,furniture,arboles:true,mobiliario:!plan.equipamiento});
 const isla=buildIsland(city,{plan,buildings:null,plants,nature,furniture});
 const barrios=createBarrios(plan,{downtown,nature,furniture,ocultar:isla.rampaEn,mobiliario:!plan.equipamiento});
 const casas=createCasas(plan,{nature,nature2,rampaEn:isla.rampaEn});
 const viviendas=createHouses((plan.isla?.casas||[]).filter(c=>c.spec).map(c=>({spec:c.colores||c.cortinas?{...c.spec,...(c.colores?{colores2d:c.colores}:{}),...(c.cortinas?{cortinas2d:c.cortinas}:{})}:c.spec,x:c.x,y:c.nivel,z:c.z,ry:c.ry})),{kit:{...(houseKit||{}),...(casa2||{}),...(tienda||{})}});
 // el suelo del demo (DemoView groundHere): la ciudad, los barrios, las viviendas o la isla
 const sz=world.size,suelo=(x,z,feet=0)=>{if(x>=0&&z>=0&&x<=sz.w&&z<=sz.h)return world.floorAt(x,z,feet);const b=barrios?.floorAt?.(x,z,feet)??viviendas?.floorAt?.(x,z,feet);return b??isla.ground(x,z,feet);};
 const plano=dibujarPlano(plan,{kits:{nature2,plants},suelo:(x,z)=>{const g=suelo(x,z,0);return suelo(x,z,g+1);}});
 const partes={ciudad:world.group,isla:isla.group,barrios:barrios.group,casas:casas.group,viviendas:viviendas.group,plano:plano.group},grupo=new THREE.Group();
 for(const g of Object.values(partes))grupo.add(g);grupo.updateMatrixWorld(true);
 return {bp,partes,grupo,world,isla,barrios,viviendas,plano,suelo,kits:{downtown:!!downtown,nature:!!nature,nature2:!!nature2,plants:!!plants,houseKit:!!houseKit,office:!!office0,casa2:!!casa2,tienda:!!tienda}};}
