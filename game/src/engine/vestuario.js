/* El vestuario: el catálogo de piezas, los modelos, los colores (puros datos, sin Three.js). Lo usan el vestidor 3D
   (src/lib/outfit3d.js), el probador y la simulación de /capas, que así describen a la gente con las mismas piezas. */
// El papel de cada parte (material) de cada modelo de calle: top (la prenda de arriba que más se ve), inner (la camisa
// de abajo), pants, belt, detail (corbata, tirantes, banda), hair, hat. topPants: la prenda de arriba incluye el
// pantalón (el traje es una sola parte). innerSleeves: las mangas son de la camisa de abajo (el obrero, con chaleco).
export const PARTS={
 // El cuerpo base del paquete: sólo piel y cara, completo (los demás no tienen piel debajo de la ropa). Se viste con piezas.
 BaseCharacter:{base:true},
 Casual_Male:{top:'Shirt',pants:'Pants',belt:'Belt',hair:'Hair'},Casual_Female:{top:'Shirt',pants:'Pants',belt:'Belt',hair:'Hair'},
 Casual2_Male:{top:'Shirt',pants:'Pants',belt:'Belt',hair:'Hair'},Casual2_Female:{top:'Shirt',pants:'Pants',belt:'Belt',hair:'Hair'},
 Casual3_Male:{top:'Shirt',pants:'Pants',belt:'Belt',hair:'Hair'},Casual3_Female:{top:'Shirt',pants:'Pants',belt:'Belt',hair:'Hair'},
 Casual_Bald:{top:'Shirt',pants:'Pants',belt:'Belt',hair:null},
 Suit_Male:{top:'Black',topPants:true,inner:'Shirt',belt:'Belt',detail:'Details',hair:'Hair'},Suit_Female:{top:'Black',topPants:true,inner:'Shirt',belt:'Belt',detail:'Details',hair:'Hair'},
 Worker_Male:{top:'Vest',inner:'Shirt',innerSleeves:true,pants:'Pants',hair:null,hat:'Hat'},Worker_Female:{top:'Vest',inner:'Shirt',innerSleeves:true,pants:'Pants',hair:'Hair',hat:'Hat'},
 OldClassy_Male:{top:'Shirt',pants:'Pants',belt:'Belt',detail:'Detail',hair:'Hair',hat:'Hat'},OldClassy_Female:{top:'Shirt',pants:'Pants',belt:'Belt',detail:'Detail',hair:'Hair',hat:'Hat'},
 Chef_Male:{top:'Clothes',pants:'DarkClothes',detail:'Band',hair:'Hair'},
 Doctor_Male_Young:{top:'Main',pants:'Brown',detail:'Black',hair:'Hair'},Doctor_Female_Old:{top:'Main',pants:'Brown',detail:'Black',hair:'Hair'}};
export const MODEL_LABEL={BaseCharacter:'Cuerpo base',Casual_Male:'Casual (h)',Casual_Female:'Casual (m)',Casual2_Male:'Casual 2 (h)',Casual2_Female:'Casual 2 (m)',Casual3_Male:'Casual 3 (h)',Casual3_Female:'Casual 3 (m)',Casual_Bald:'Casual pelado',
 Suit_Male:'Traje (h)',Suit_Female:'Traje (m)',Worker_Male:'Obrero',Worker_Female:'Obrera',OldClassy_Male:'Señor',OldClassy_Female:'Señora',Chef_Male:'Chef',Doctor_Male_Young:'Doctor',Doctor_Female_Old:'Doctora'};
export const COLORS={
 // (2026-10-12: más tonos de calle; los seis primeros son los de siempre)
 ropa:{roja:'#c4553d',azul:'#3f6fa8',verde:'#4f8a55',amarilla:'#e0b83a',negra:'#2f3133',blanca:'#f2f0ea',vinotinto:'#7a2e33',naranja:'#d9793a',morada:'#6b4a8a',rosada:'#d98aa0',
  gris:'#8a8e90',café:'#6e4e35',oliva:'#6b7340',azul_oscuro:'#2b3d5c',celeste:'#7fb2d6',turquesa:'#3a9a96'},
 pantalon:{jean:'#3d5370',negro:'#26282a',beige:'#c8b48f',gris:'#7d8284',marrón:'#5e4330',jean_claro:'#6f88a8',oliva:'#5c6340',azul_oscuro:'#2b3549'},
 pelo:{negro:'#2a2522',castaño:'#6b4326',rubio:'#e0bf57',canoso:'#c9c9c4',pelirrojo:'#b4532a'},
 // La piel del paquete viene casi negra (0,013): se pinta siempre con uno de estos tonos.
 piel:{clara:'#f1cfb2',media:'#d9a77f',trigueña:'#b07a52',oscura:'#6f4a32'},
 // Los ojos y las cejas son la misma parte («Face»): se pintan juntos. Blancos es como viene el paquete.
 ojos:{blancos:'#fffef0',negros:'#1f1d1b',cafés:'#5a3a22',azules:'#3f78c4',verdes:'#4f8a55'},
 gorra:{azul:'#2c3e50',roja:'#b8432f',negra:'#1f2123',blanca:'#ecebe6',verde:'#3f6b45'},
 gafas:{negras:'#1d2224',carey:'#7a4a28',doradas:'#c9a24a',rojas:'#a8352a'},
 mochila:{café:'#6b5a44',negra:'#2a2c2e',azul:'#34507a',roja:'#9c3b2c',verde:'#4b6b42'},
 cejas:{negras:'#1f1d1b',cafés:'#5a3a22',rubias:'#c9a24a',canosas:'#d6d4cc',blancas:'#fffef0'},
 zapatos:{negros:'#232425',cafés:'#5b3b25',blancos:'#ecebe6',rojos:'#a8352a',azules:'#34507a'},
 guantes:{negros:'#232425',blancos:'#ecebe6',cafés:'#6b4a2e',amarillos:'#d8b23c'},
 camisa:{blanca:'#f2f0ea',celeste:'#a9c9e0',rosada:'#e9b8b0',gris:'#b9bcbd',negra:'#2f3133'},
 detalle:{negro:'#232425',rojo:'#a8352a',azul:'#34507a',dorado:'#c9a24a',blanco:'#ecebe6'},
 cinturon:{negro:'#232425',café:'#5b3b25',gris:'#7d8284'}};
// Un color: el nombre de un tono de la lista o un «#rrggbb» libre.
export const colorOf=(cat,v,fallback)=>COLORS[cat]?.[v]??(typeof v==='string'&&v.startsWith('#')?v:COLORS[cat]?.[fallback]);

const ML={Casual_Male:'Casual (h)',Casual_Female:'Casual (m)',Casual2_Male:'Casual 2 (h)',Casual2_Female:'Casual 2 (m)',Casual3_Male:'Casual 3 (h)',Casual3_Female:'Casual 3 (m)',
 Suit_Male:'Traje (h)',Suit_Female:'Traje (m)',Worker_Male:'Obrero',Worker_Female:'Obrera',OldClassy_Male:'Señor',OldClassy_Female:'Señora',Chef_Male:'Chef',Chef_Female:'Chef (m)',Chef_Hat:'Chef con gorro',
 Doctor_Male_Young:'Doctor',Doctor_Male_Old:'Doctor mayor',Doctor_Female_Young:'Doctora joven',Doctor_Female_Old:'Doctora',Cowboy_Male:'Vaquero',Cowboy_Female:'Vaquera',Cowboy_Hair:'Vaquero (pelo)',
 Ninja_Female:'Ninja (m)',Ninja_Male_Hair:'Ninja (h)',Ninja_Sand_Female:'Ninja arena',Viking_Male:'Vikingo',Viking_Female:'Vikinga',VikingHelmet:'Vikingo con casco',Witch:'Bruja',Wizard:'Mago',Elf:'Elfo',
 Pirate_Female:'Pirata',Kimono_Female:'Kimono',Knight_Golden_Female:'Caballera',Goblin_Female:'Goblin',Zombie_Female:'Zombi',Soldier_Female:'Soldado (m)',Soldier_Male:'Soldado',BlueSoldier_Female:'Policía (m)',BlueSoldier_Male:'Policía'};
const HAIRS=['Casual_Male','Casual_Female','Casual2_Male','Casual2_Female','Casual3_Male','Casual3_Female','Suit_Male','Suit_Female','Worker_Female','OldClassy_Male','OldClassy_Female','Chef_Male','Chef_Female',
 'Doctor_Male_Young','Doctor_Male_Old','Doctor_Female_Young','Doctor_Female_Old','Cowboy_Male','Cowboy_Female','Cowboy_Hair','Ninja_Female','Ninja_Male_Hair','Ninja_Sand_Female','Viking_Male','Viking_Female',
 'VikingHelmet','Witch','Wizard','Pirate_Female','Kimono_Female','Knight_Golden_Female','Goblin_Female','Zombie_Female','Soldier_Female'];
// Cada pieza: el modelo de donde sale, sus partes (materiales) y cómo se pinta (paint: con qué color del vestido).
export const TOP=['ropa','hombros','manga_arriba','manga_abajo','camisa'],SLEEVES=['hombros','manga_arriba','manga_abajo'],BOTTOM=['pant_arriba','pant_abajo','cinturon','muslos'];
// El saco y el pantalón comparten material. makePersona2 separa sus islas;
// estos filtros se conservan para lectores anteriores del catálogo.
export const UPPER=['Abdomen','Torso','Neck','Shoulder','UpperArm','LowerArm','Fist'],LOWER=['Hips','Body','UpperLeg','LowerLeg','Foot'];
// Todos los huesos menos la cabeza.
export const BODY=['Hips','Body','Abdomen','Torso','Neck','Shoulder','UpperArm','LowerArm','Fist','UpperLeg','LowerLeg','Foot'];
export const PIECES={
 // El pelo se toma sin la zona de la barba (el vikingo y el mago la traen en la misma parte): la barba va aparte.
 pelo:HAIRS.filter(m=>m!=='Wizard').map(m=>({id:'pelo:'+m,m,parts:['Hair'],t:ML[m],paint:'pelo',region:'scalp'})),
 sombrero:[['OldClassy_Male',['Hat'],'Bombín'],['Worker_Male',['Hat'],'Casco de obra'],['Worker_Female',['Hat'],'Casco de obra (m)'],
  ['Chef_Hat',['Hat'],'Gorro de chef'],['Cowboy_Male',['HatBrown','HatLightBrown'],'Sombrero vaquero',['Head']],['Witch',['Hat'],'Sombrero de bruja',null,true],['Wizard',['Hat'],'Sombrero de mago',null,true],['Elf',['Hat'],'Gorro de elfo',null,true],
  ['Soldier_Male',['Helmet'],'Casco militar'],['BlueSoldier_Male',['Helmet'],'Casco de policía'],['VikingHelmet',['Helmet','Horns'],'Casco vikingo',null,true]].map(([m,parts,t,bones,disfraz])=>({id:'sombrero:'+m,m,parts,t,bones,disfraz})),
 bigote:[{id:'bigote:Chef_Hat',m:'Chef_Hat',parts:['Moustache'],t:'Bigote',paint:'pelo'},{id:'bigote:Viking_Male:corta',m:'Viking_Male',parts:['Hair'],t:'Barba corta',paint:'pelo',region:'beardShort'},
  {id:'bigote:Viking_Male',m:'Viking_Male',parts:['Hair'],t:'Barba vikinga',paint:'pelo',region:'beard'},{id:'bigote:Wizard',m:'Wizard',parts:['Hair'],t:'Barba larga',paint:'pelo',region:'beard'}],
 bufanda:[{id:'bufanda:Cowboy_Male',m:'Cowboy_Male',parts:['Scarf'],t:'Bufanda'}],
 // hides: las zonas propias que la prenda tapa (se esconden, así no asoman a través de ella).
 // bones: del modelo de origen sólo lo que mueven esos huesos (la faja del kimono y el cinturón de la bruja también
 // pasan por la cabeza: son la cinta del pelo y la del sombrero).
 encima:[['Cowboy_Male',['Jacket'],'Chaqueta de vaquero',[]],['Cowboy_Male',['Top'],'Camisa de vaquero',SLEEVES],['Worker_Male',['Vest'],'Chaleco de obra',[]],
  ['Doctor_Male_Young',['Main'],'Bata',[...TOP,'detalle']],['Pirate_Male',['Clothes'],'Abrigo de pirata',[...TOP,'detalle']],['Viking_Male',['Main'],'Túnica',[],null,true],
  ['Witch',['Clothes','Belt','Gold'],'Vestido',TOP,BODY],['Kimono_Female',['Clothes','Band'],'Kimono',[...TOP,...BOTTOM,'pantorrillas'],BODY]]
  .map(([m,parts,t,hides,bones,disfraz])=>({id:'encima:'+m+':'+parts[0],m,parts,t,hides,bones,disfraz,paint:'encima',paintParts:[parts[0]]})),
 // arriba: la ropa de arriba de cada modelo, con el papel de cada parte (se pinta por zonas como la propia).
 arriba:[['Casual_Male',['Shirt'],'Camiseta',{Shirt:'top'}],['Casual2_Male',['Shirt'],'Camiseta 2',{Shirt:'top'}],['Casual3_Male',['Shirt'],'Sin mangas',{Shirt:'top'}],
  ['Casual_Female',['Shirt'],'Blusa',{Shirt:'top'}],['OldClassy_Male',['Shirt','Detail'],'Camisa con tirantes',{Shirt:'top',Detail:'detail'}],
  ['Worker_Male',['Vest','Shirt'],'Camisa y chaleco de obra',{Vest:'top',Shirt:'inner'},null,true],['Suit_Male',['Black','Shirt','Details'],'Saco y corbata',{Black:'top',Shirt:'inner',Details:'detail'},UPPER],
  ['Suit_Female',['Black','Shirt','Details'],'Saco (m)',{Black:'top',Shirt:'inner',Details:'detail'},UPPER],['Doctor_Male_Young',['Main','Black'],'Bata',{Main:'top',Black:'detail'}],
  ['Chef_Male',['Clothes','Band'],'Chaqueta de chef',{Clothes:'top',Band:'detail'}],['Cowboy_Male',['Top','Jacket'],'Vaquero',{Top:'top',Jacket:'detail'}]]
  .map(([m,parts,t,roles,bones,innerSleeves])=>({id:'arriba:'+m+(m==='Cowboy_Male'?':Top':''),m,parts,t,roles,bones,innerSleeves})),
 // long: llega a la pantorrilla (si es corto, la parte de abajo del pantalón propio se pinta de piel, no se esconde).
 // El cinturón va con el pantalón (sin él, entre la camisa y el pantalón asoma la piel del cuerpo base).
 pantalon:[['Casual_Male',['Pants','Belt'],'Corto (casual)',false],['Casual2_Male',['Pants','Belt'],'Largo (casual 2)',true],['Worker_Male',['Pants'],'De obra',false],['Cowboy_Male',['Pants'],'Vaquero',true],
  ['OldClassy_Male',['Pants','Belt'],'De señor',true],['Doctor_Male_Young',['Brown'],'De doctor',true],['Chef_Male',['DarkClothes'],'De chef',true],['Suit_Male',['Black','Belt'],'De traje',true,LOWER]]
  .map(([m,parts,t,long,bones])=>({id:'pantalon:'+m,m,parts,t,long,bones,roles:{[parts[0]]:'pants',...(parts[1]?{[parts[1]]:'belt'}:{})}}))};
// El catálogo de ciudad: sin lo marcado como disfraz (sombreros de mago, bruja, elfo, casco vikingo, túnica). Los
// disfraces siguen existiendo (pieceById los encuentra) pero no se ofrecen ni salen al azar.
// Faldas hechas en Blender a la medida de cada cuerpo (scripts/blender/faldas.py → partes*/Prendas.json): van en el
// lugar del pantalón; al caminar se mecen con la cadera y cada lado sigue un poco a su pierna (persona3d: keepWeights).
PIECES.pantalon.push(...[['FaldaCorta','Falda corta'],['FaldaRodilla','Falda a la rodilla'],['FaldaLarga','Falda larga']].map(([p,t])=>({id:'falda:'+p.slice(5).toLowerCase(),m:'Prendas',parts:[p],t,long:p!=='FaldaCorta',falda:true,roles:{[p]:'pants'}})));
export const CITY_PIECES=Object.fromEntries(Object.entries(PIECES).map(([k,l])=>[k,l.filter(p=>!p.disfraz)]));
export const pieceById=id=>Object.values(PIECES).flat().find(p=>p.id===id);
// Un solo cuerpo (2026-10-17, Miguel: «solo con poder cambiarse la ropa y el pelo, barba… es suficiente para la primera
// versión; aprovechamos las buenas medidas de los muñecos iniciales»): el cuerpo es el del muñeco del paquete tal cual
// —el de hombre o el de mujer—, con su alto (escala 1, medidas.js CUERPO) y la contextura «normal» (persona3d no lo
// deforma). Lo que se elige es la piel, el pelo, la barba y la ropa. Las otras contexturas siguen en persona3d, sin usarse.
// La mujer también es su muñeco tal cual (Miguel, 2026-10-17): sin el ajuste MUJER de persona3d (hombros, cadera).
// Y sin género (Miguel, 2026-10-17: «quitemos lo de hombre y mujer, que sea el pelo el que usen los jugadores y la ropa
// para armar el muñeco sin género»): sin el ajuste, el muñeco de mujer del paquete es el mismo cuerpo que el de hombre;
// todos son «muneco» y cualquiera lleva cualquier peinado, barba o prenda.
export const CUERPO_UNICO={contextura:'normal',escala:1,ajusteMujer:false,muneco:'Casual_Male'};

// Piezas independientes para el ropero. El tipo de cuerpo se elige al vestirlas;
// el identificador de la prenda no depende de sexo, contextura ni proporciones.
export const CLOTHING_SLOTS={top:'Prenda de arriba',inner:'Camisa bajo la chaqueta',pants:'Pantalón o falda',belt:'Cinturón',detail:'Corbata o tirantes',outer:'Chaqueta o abrigo'};
PIECES.prenda=[];
for(const [model,map] of Object.entries(PARTS))for(const slot of ['top','inner','pants','belt','detail']){
 const part=map[slot];if(!part)continue;
 PIECES.prenda.push({id:`prenda:${model}:${part}:${slot}`,m:model,parts:[part],t:`${CLOTHING_SLOTS[slot]} · ${MODEL_LABEL[model]||model}`,slot,roles:{[part]:slot},section:map.topPants&&slot==='top'?'top':slot==='detail'&&/^Suit_/.test(model)?'detail':null});
 if(map.topPants&&slot==='top')PIECES.prenda.push({id:`prenda:${model}:${part}:pants`,m:model,parts:[part],t:`Pantalón · ${MODEL_LABEL[model]}`,slot:'pants',roles:{[part]:'pants'},section:'pants'});
}
// Variantes independientes: comparten patrón base, no identidad de prenda.
for(const [style,t] of [['bermuda','Bermuda'],['deportivo','Pantalón deportivo'],['leggings','Leggings'],['cargo','Pantalón cargo']])PIECES.prenda.push({id:'ropero:'+style,m:'Casual2_Male',parts:['Pants'],t,slot:'pants',roles:{Pants:'pants'},bottomStyle:style});
PIECES.prenda.push({id:'ropero:camiseta-manga-larga',m:'Casual_Male',parts:['Shirt'],t:'Camiseta de manga larga',slot:'top',roles:{Shirt:'top'}});
PIECES.prenda.push({id:'ropero:camiseta-sin-mangas',m:'Casual_Male',parts:['Shirt'],t:'Camiseta sin mangas',slot:'top',roles:{Shirt:'top'}});
PIECES.prenda.push({id:'ropero:camisa-botones',m:'Casual_Male',parts:['Shirt'],t:'Camisa con botones y cuello',slot:'top',roles:{Shirt:'top'}});
PIECES.prenda.push({id:'ropero:chaqueta-abierta',m:'Casual_Male',parts:['Shirt'],t:'Chaqueta ligera abierta',slot:'outer',roles:{Shirt:'top'}});
PIECES.prenda.push({id:'ropero:sudadera',m:'Casual_Male',parts:['Shirt'],t:'Sudadera sin capucha',slot:'top',roles:{Shirt:'top'}});
PIECES.prenda.push({id:'ropero:sudadera-capucha',m:'Casual_Male',parts:['Shirt'],t:'Sudadera con capucha',slot:'top',roles:{Shirt:'top'}});
PIECES.prenda.push({id:'ropero:chaleco-abierto',m:'Casual_Male',parts:['Shirt'],t:'Chaleco abierto',slot:'outer',roles:{Shirt:'top'}});
for(const [id,t] of [['polo','Polo de manga corta'],['camisa-manga-larga','Camisa de manga larga']])PIECES.prenda.push({id:'ropero:'+id,m:'Casual_Male',parts:['Shirt'],t,slot:'top',roles:{Shirt:'top'}});
for(const [id,t] of [['chaqueta-cerrada','Chaqueta con cremallera']])PIECES.prenda.push({id:'ropero:'+id,m:'Casual_Male',parts:['Shirt'],t,slot:'outer',roles:{Shirt:'top'}});
export const WARDROBE=Object.fromEntries(Object.keys(CLOTHING_SLOTS).map(slot=>[slot,[...PIECES.prenda.filter(p=>p.slot===slot),...(slot==='pants'?PIECES.pantalon.filter(p=>p.falda):slot==='outer'?CITY_PIECES.encima:[])]]));
export function withGarment(look,slot,id){if(!Object.hasOwn(CLOTHING_SLOTS,slot))throw new Error('Parte de ropa desconocida: '+slot);if(id&&!WARDROBE[slot].some(p=>p.id===id))throw new Error('Prenda no disponible para '+slot+': '+id);return {...look,prendas:{...look.prendas,[slot]:id||null}};}
