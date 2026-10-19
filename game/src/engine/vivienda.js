/* Las casas armadas (FUGA, 2026-10-11): una casa se describe con unas pocas opciones (como un personaje con su
   vestuario: vestuario.js) y de ahí sale su plano exacto, en metros. Puros datos, sin Three.js: lo dibuja
   src/lib/vivienda3d.js y lo edita /casas (CasasView.vue).

   Todo se mide en módulos de 3 m: el ancho del frente y el fondo son 2 a 5 módulos; cada módulo del frente lleva una
   ventana o la puerta. Pisos de 2,8 m (el piso de la planta baja a 15 cm del suelo). Puertas y ventanas son las del
   paquete de la casa (public/models/Casa), estiradas a la medida exacta de su vano. La escalera es recta, de 14
   peldaños de 20 × 25 cm, contra la pared izquierda: sube hacia el fondo y arriba llega a un descanso de 1,2 m; por
   eso entra en un fondo de 6 m.

   Coordenadas de la casa: x a lo ancho del frente, z hacia el frente (el frente mira a +z), y hacia arriba; el origen
   es el centro de la huella entera (con garaje y porche) a nivel del suelo. */

import {OBJETOS,partsBoxes,RUG_COUNT} from '../lib/objetos3d.js';
import {sinTitilar} from './titileo.js';
import {CHOQUE_MUEBLE} from './medidas.js';

export const MOD=3,FH=2.8,T=.2,TI=.12,FLOOR0=.15;
// Los vanos de afuera (2026-10-18; validar-vanos): lo mínimo de pared entre dos vanos y entre un vano y la esquina.
export const VANO={hueco:.25,esquina:.3};
// La escalera (medidas reales, 2026-10-15; antes 1 m y 14 peldaños de 20 × 25 cm): 1,2 m de ancho, 16 peldaños de
// 17,5 cm de alto y 28 de huella (4,48 m); el descanso de arriba, 1,2 m. En una casa corta el tramo se acorta lo justo
// para dejar 1 m libre al pie (la huella baja hasta 22 cm): stairRun(D).
export const STAIR={w:1.2,steps:16,run:16*.28,landing:1.2};
export const stairRun=D=>Math.max(STAIR.steps*.22,Math.min(STAIR.run,D-2*T-STAIR.landing-1));
// Los colores de las paredes de adentro, por cuarto (los de costumbre), y las maderas de la escalera (body: el macizo y
// la contrahuella, pintados; tread: la huella; nose: la nariz; rail: pasamanos; post: barrotes).
const INNER_PAL={cocina:['#f3e3b5','#f1dcc0','#e7ecce','#f6efe0'],bano:['#f4f6f6','#dcebef','#e2efe6','#efe9df'],
 dormitorio:['#dbe6f0','#eedfe5','#e1ead6','#f0e5cf','#e4def0','#f3e6c4']};
const STAIR_WOOD=[{body:'#efe6d6',tread:'#a8794f',nose:'#7a5233',rail:'#6e4a2f',post:'#efe6d6'},{body:'#e9e2d3',tread:'#8f5f3a',nose:'#5f3d24',rail:'#5a3a22',post:'#5a3a22'},
 {body:'#f1ece2',tread:'#b98d5e',nose:'#8a6440',rail:'#8a6440',post:'#f1ece2'}];
export const GARAGE={w:3.6,d:6,door:{w:2.6,h:2.3}};
export const PORCH_D=2;
const EAVE=.35;// alero de los techos

// Ventanas: el modelo del paquete, el vano (ancho × alto) y el antepecho (desde el piso).
export const WINDOWS={
 grande:{m:'Window_Large1',t:'Grande',w:1.3,h:1.2,sill:.85},
 grande2:{m:'Window_Large2',t:'Grande en cruz',w:1.3,h:1.2,sill:.85},
 chica:{m:'Window_Small1',t:'Chica',w:.75,h:1,sill:1.05},
 chica2:{m:'Window_Small2',t:'Chica en cruz',w:.75,h:1,sill:1.05},
 chica3:{m:'Window_Small3',t:'Chica lisa',w:.75,h:1,sill:1.05},
 arco:{m:'Window_Round1',t:'De arco',w:.7,h:1.2,sill:.9},
 arco2:{m:'Window_Round2',t:'De arco en cruz',w:.7,h:1.2,sill:.9},
 arco3:{m:'Window_Round3',t:'De arco partida',w:.7,h:1.2,sill:.9}};
// Puertas del paquete (la hoja gira hacia adentro cuando alguien se acerca). La doble pide un vano de 1,9 m.
export const DOORS={Door_1:{t:'De tablero'},Door_2:{t:'De vidrio arriba'},Door_3:{t:'De cuadros'},Door_4:{t:'De vidrio alto'},
 Door_5:{t:'Con ventanita'},Door_6:{t:'De vidrios'},Door_7:{t:'Lisa'},Door_9:{t:'De tiras'},Door_Double:{t:'Doble',w:1.9}};
export const DOOR_W=1,DOOR_H=2.2,INNER_DOOR_W=.85,INNER_H=2.08;

export const HOUSE_COLORS={
 pared:{crema:'#efe2c4',blanca:'#f2efe6',celeste:'#b9d3dc',salvia:'#c3d3b0',durazno:'#efc4a6',amarilla:'#efd58a',gris:'#c8c5bd',madera:'#b8875a',ladrillo:'#b5654a'},
 techo:{anaranjado:'#d8743f',barro:'#c0643a',rojo:'#b5432e',cedro:'#8b6a4c',azul:'#3a4762',pizarra:'#4a4f57',beige:'#c9ad84',gris:'#5c6066',verde:'#4f6b4a'},
 marco:{blanco:'#f5f0e6',café:'#6e4a33',verde:'#3e6a4f',azul:'#3d5d8c',negro:'#2c2e30',rojo:'#9a3a2c'},
 puerta:{café:'#7a4b2f',roja:'#a23b2b',verde:'#3e6a4f',azul:'#3d5d8c',amarilla:'#d9a53a',negra:'#2c2e30',blanca:'#f2efe6'},
 zocalo:{piedra:'#8d8173',ladrillo:'#9c533b',gris:'#77797b',arena:'#bba98a'},
 interior:{crema:'#f1ead9',blanca:'#f6f4ef',celeste:'#d8e6ea',verde:'#dfe8d2',rosada:'#f2dcd2'},
 flores:{rojas:'#d8443a',rosadas:'#ec8fb0',amarillas:'#f1c93b',blancas:'#f6f2e8',moradas:'#8e5ac0',naranjas:'#f08a3c'}};
// Un color más oscuro (k < 1) o más claro.
export const shade=(hex,k)=>'#'+[1,3,5].map(i=>Math.max(0,Math.min(255,Math.round(parseInt(hex.slice(i,i+2),16)*k))).toString(16).padStart(2,'0')).join('');
export const houseColor=(cat,v)=>HOUSE_COLORS[cat]?.[v]??(typeof v==='string'&&v.startsWith('#')?v:Object.values(HOUSE_COLORS[cat])[0]);

// Las opciones de una casa y sus valores de partida.
export const BASE={estilo:null,ancho:3,fondo:2,pisos:2,arriba:'igual',garaje:'no',porche:false,techo:'dos_aguas',tejado:'barro',pendiente:.6,chimenea:true,
 puerta:'Door_1',puertaModulo:null,ventana:'grande',ventanaArriba:'chica',postigos:true,revestimiento:'tablas',
 pared:'crema',techoColor:'rojo',marco:'blanco',puertaColor:'verde',zocalo:'piedra',interior:'crema',maceteros:true,flores:'rojas',hastial:'ojo',canaletas:true};
// Estilos: puntos de partida (después cada opción se cambia suelta).
export const STYLES={
 cabana:{t:'Cabaña',tejado:'madera',ancho:2,fondo:2,pisos:1,porche:true,techo:'dos_aguas',pendiente:.8,garaje:'no',chimenea:true,revestimiento:'tablas',pared:'madera',techoColor:'cedro',marco:'café',puertaColor:'café',ventana:'chica2',postigos:false,zocalo:'piedra',puerta:'Door_9'},
 clasica:{t:'Clásica',hastial:'rejilla',tejado:'madera',ancho:3,fondo:2,pisos:2,arriba:'igual',techo:'dos_aguas',pendiente:.6,porche:false,garaje:'no',chimenea:true,revestimiento:'tablas',pared:'crema',techoColor:'rojo',marco:'blanco',puertaColor:'verde',ventana:'grande2',ventanaArriba:'grande2',postigos:true,puerta:'Door_1'},
 moderna:{t:'Moderna',maceteros:false,canaletas:false,tejado:'liso',ancho:3,fondo:3,pisos:2,arriba:'retirado',techo:'plano',porche:false,garaje:'der',chimenea:false,revestimiento:'liso',pared:'blanca',techoColor:'gris',marco:'negro',puertaColor:'negra',ventana:'grande',ventanaArriba:'grande',postigos:false,zocalo:'gris',puerta:'Door_7'},
 familiar:{t:'Familiar',tejado:'madera',ancho:4,fondo:2,pisos:2,arriba:'igual',techo:'cuatro_aguas',pendiente:.55,porche:true,garaje:'izq',chimenea:false,revestimiento:'tablas',pared:'celeste',techoColor:'azul',marco:'blanco',puertaColor:'roja',ventana:'grande2',ventanaArriba:'chica2',postigos:true,puerta:'Door_2'},
 chalet:{t:'Chalet',tejado:'barro',ancho:3,fondo:3,pisos:2,arriba:'retirado',techo:'dos_aguas',pendiente:.95,porche:false,garaje:'izq',chimenea:true,revestimiento:'liso',pared:'blanca',techoColor:'barro',marco:'café',puertaColor:'café',ventana:'arco2',ventanaArriba:'arco',postigos:true,zocalo:'piedra',puerta:'Door_3'},
 casita:{t:'Casita',tejado:'barro',ancho:2,fondo:2,pisos:1,techo:'cuatro_aguas',pendiente:.55,porche:false,garaje:'der',chimenea:false,revestimiento:'liso',pared:'durazno',techoColor:'anaranjado',marco:'blanco',puertaColor:'azul',ventana:'grande',postigos:true,zocalo:'arena',puerta:'Door_5'}};

// Las opciones de la casa, con sus valores (para el editor y para el azar).
export const OPTIONS={ancho:[2,3,4,5],fondo:[2,3],pisos:[1,2],arriba:['igual','retirado'],garaje:['no','izq','der'],techo:['dos_aguas','cuatro_aguas','plano'],
 revestimiento:['tablas','liso'],tejado:['barro','madera','liso'],hastial:['ojo','rejilla','nada']};
export const OPTION_LABEL={igual:'Igual que abajo',retirado:'Retirado (con terraza)',no:'Sin garaje',izq:'A la izquierda',der:'A la derecha',dos_aguas:'Dos aguas',cuatro_aguas:'Cuatro aguas',plano:'Plano',tablas:'Tablas',liso:'Liso',barro:'Teja de barro',madera:'Tejuela de madera',ojo:'Ojo de buey',rejilla:'Rejilla',nada:'Nada'};

// Las medidas de los muebles que estorban (ancho × fondo, en m, ya a escala; el frente mira a +z).
// Lo alto (su alto en m): no va contra una ventana. Y las camas.
const TALL_H={Kitchen_Fridge:1.72,C2_Closet:1.93,C2_Closet2:1.29,C2_BookCaseBooks:1.95,Bookshelf:1.9,Shelf_1:1.6,Drawer_1:.9,C2_Bed:.84,Bed_Single:.8,Bed_King:.9},BEDS=new Set(['C2_Bed','Bed_Single','Bed_King']);
export const FURN_SIZE={Kitchen_Fridge:[.67,.68],Kitchen_Sink:[.53,.58],Kitchen_Oven:[.53,.58],Kitchen_2Drawers:[.53,.58],Kitchen_Cabinet1:[.53,.56],Table_RoundSmall:[1.01,1.01],
 Couch_Small2:[1.1,1.04],Couch_Medium2:[2.35,1.04],Shelf_1:[.37,.34],Bookshelf:[1.21,.39],Bed_King:[1.59,2.06],Bed_Single:[1.03,2.05],NightStand_1:[.5,.5],Drawer_1:[1.45,.58],
 Bathroom_Toilet:[.62,.88],Bathroom_Sink:[.72,.42],Bathroom_Shower1:[.99,.98],
 // los de Casa2 (nature3d loadCasa2), ya en su escala
 C2_Bed:[1.31,2.1],C2_Lamp:[.37,.35],C2_Sofa:[1.09,.96],C2_SofaDouble:[1.77,.96],C2_CoffeeTable:[1.42,.82],C2_Closet:[.86,.46],C2_Closet2:[.9,.62],C2_BookCaseBooks:[.99,.59],C2_ChairCushioned:[.41,.42]};
// Una casa completa: los valores de partida, el estilo y lo que se pidió; lo que no cabe se corrige (el piso de arriba
// retirado pide 3 módulos de fondo).
export function houseSpec(input={}){const st=STYLES[input.estilo]||{},s={...BASE,...st,...input};
 s.ancho=Math.max(2,Math.min(5,s.ancho|0));s.fondo=Math.max(2,Math.min(3,s.fondo|0));s.pisos=s.pisos>1?2:1;
 if(s.pisos<2||s.fondo<3)s.arriba='igual';if(!DOORS[s.puerta])s.puerta='Door_1';if(!WINDOWS[s.ventana])s.ventana='grande';if(!WINDOWS[s.ventanaArriba])s.ventanaArriba='chica';
 const dw=DOORS[s.puerta].w||DOOR_W;if(dw>MOD-.8)s.puerta='Door_1';
 return s;}

// Una casa al azar (r: el azar a usar). base: lo que tiene que quedar fijo.
export function randomHouse(r=Math.random,base={}){const pick=a=>a[Math.floor(r()*a.length)],keys=c=>Object.keys(HOUSE_COLORS[c]);
 const estilo=pick(Object.keys(STYLES)),st=STYLES[estilo];
 return houseSpec({estilo,...st,
  ancho:r()<.6?st.ancho:pick(OPTIONS.ancho),pisos:r()<.75?st.pisos:pick(OPTIONS.pisos),garaje:r()<.6?st.garaje:pick(OPTIONS.garaje),porche:r()<.7?st.porche:!st.porche,
  pared:r()<.5?st.pared:pick(keys('pared')),techoColor:r()<.5?st.techoColor:pick(keys('techo')),puertaColor:r()<.5?st.puertaColor:pick(keys('puerta')),
  interior:pick(keys('interior')),flores:pick(keys('flores')),maceteros:r()<.7?(st.maceteros??true):r()<.5,chimenea:st.techo!=='plano'&&r()<.6,...base});}

// ---------- El plano ----------
// Sale de una casa (houseSpec) y devuelve, en metros y en coordenadas de la casa:
//  boxes:    cajas (x0..x1, y0..y1, z0..z1) con su material (cat) y color; solid: estorba al caminar.
//  quads:    caras inclinadas de los techos y los hastiales (4 puntos; un triángulo repite el último).
//  floors:   superficies que se pisan (rectángulos a una altura).
//  ramps:    la escalera, como rampa para caminar (la altura sube a lo largo de z).
//  openings: ventanas y puertas (el modelo del paquete, el centro de abajo del vano, ancho, alto y hacia dónde mira).
//  furniture: muebles del paquete (centro de su caja en x y z, piso, giro: 0 mira a +z).
//  rooms:    los cuerpos (para saber si se está adentro) y lights: las lámparas del techo (para la noche).
export function planHouse(input){
 const s=houseSpec(input),col=(cat,v)=>houseColor(cat,v);
 // (spec.hogar: una casa desde la familia —engine/hogar.js—: sus medidas, sus cuartos, sus vanos y sus muebles)
 const HG=s.hogar||null,W=HG?HG.W:s.ancho*MOD,D=HG?HG.D:s.fondo*MOD,two=HG?HG.floors>1:s.pisos>1,setback=!HG&&two&&s.arriba==='retirado',Du=setback?D-MOD:D;
 const H1=FLOOR0+FH,H2=FLOOR0+2*FH,top=two?H2:H1,stRun=stairRun(Du);
// (s.colores2d —los del 2D, color.js: la casa del plan—: la fachada, el techo, la moldura, la puerta y cada cuarto; sin
 // ellos, los de siempre)
 const C2=s.colores2d||null;
 const cWall=C2?.fachada||col('pared',s.pared),cIn=col('interior',s.interior),cRoof=C2?.techo||col('techo',s.techoColor),cTrim=C2?.moldura||col('marco',s.marco),cDoor=C2?.puerta||col('puerta',s.puertaColor),cBase=C2?.zocalo||col('zocalo',s.zocalo);
 const wallCat=s.revestimiento==='tablas'?'tablas':'liso',WOOD='#b08a5e',CEIL='#f4f1ea',DECK='#a88462';
 // Los colores de adentro por cuarto (2026-10-12): la sala y el pasillo, el de la casa (s.interior); la pared de la
 // cocina, cálida; el baño, de baldosa blanca o celeste; cada dormitorio, un pastel distinto. Fijos por casa (salen de
 // sus opciones). La escalera, de una de tres maderas.
 const hsKey=JSON.stringify({...s,hogar:s.hogar?.kind,cortinas2d:undefined}),hs=k=>{let h=2166136261;for(const ch of hsKey+k)h=Math.imul(h^ch.charCodeAt(0),16777619);return ((h>>>0)%10007)/10007;},pick=(l,k)=>l[Math.floor(hs(k)*l.length)];
 const cKit=pick(INNER_PAL.cocina,'k'),cBath=pick(INNER_PAL.bano,'b'),i1=Math.floor(hs('d')*INNER_PAL.dormitorio.length),cBed1=INNER_PAL.dormitorio[i1],
  cBed2=INNER_PAL.dormitorio[(i1+1+Math.floor(hs('e')*(INNER_PAL.dormitorio.length-1)))%INNER_PAL.dormitorio.length],SM=pick(STAIR_WOOD,'s');
 const gar=HG?null:s.garaje==='izq'?{x0:-GARAGE.w,x1:0}:s.garaje==='der'?{x0:W,x1:W+GARAGE.w}:null;if(gar){gar.d=Math.min(D,GARAGE.d);gar.z0=D-gar.d;gar.z1=D;}
 const boxes=[],quads=[],floors=[],ramps=[],openings=[],furniture=[],rooms=[],lights=[];
 const box=(cat,x0,y0,z0,x1,y1,z1,color,solid=true)=>{boxes.push({cat,x0:Math.min(x0,x1),x1:Math.max(x0,x1),y0:Math.min(y0,y1),y1:Math.max(y0,y1),z0:Math.min(z0,z1),z1:Math.max(z0,z1),color,solid});};
 const floor=(x0,z0,x1,z1,y)=>floors.push({x0:Math.min(x0,x1),x1:Math.max(x0,x1),z0:Math.min(z0,z1),z1:Math.max(z0,z1),y});
 const quad=(cat,a,b,c,d,color)=>quads.push({cat,p:[a,b,c,d],color});
 // Una pared recta a lo largo de x (axis 'x', en z = at) o de z (axis 'z', en x = at), de a0 a a1 y de y0 a y1, con sus
 // vanos ({c: centro a lo largo, w, y0, y1}). layers: [[grosor, desplazamiento del centro, cat, color]] (por fuera, la
 // pintura de afuera; por dentro, la de adentro).
 const wall=(axis,at,a0,a1,y0,y1,layers,holes=[])=>{const hs=holes.map(h=>({a:h.c-h.w/2,b:h.c+h.w/2,y0:h.y0,y1:h.y1})).sort((p,q)=>p.a-q.a);
  // (color puede ser una función de la posición a lo largo: la capa se parte en «cuts», donde cambia el cuarto)
  const seg=(u0,u1,v0,v1)=>{if(u1-u0<.005||v1-v0<.005)return;for(const [th,off,cat,color,cuts=[]] of layers){const c=at+off,fn=typeof color==='function',pts=fn?[u0,...cuts.filter(x=>x>u0+.005&&x<u1-.005),u1]:[u0,u1];
   for(let i=0;i+1<pts.length;i++){const p=pts[i],q=pts[i+1],cc=fn?color((p+q)/2):color;if(axis==='x')box(cat,p,v0,c-th/2,q,v1,c+th/2,cc);else box(cat,c-th/2,v0,p,c+th/2,v1,q,cc);}}};
  let u=a0;for(const h of hs){seg(u,h.a,y0,y1);seg(h.a,h.b,y0,h.y0);seg(h.a,h.b,h.y1,y1);u=h.b;}seg(u,a1,y0,y1);};
 // Pared de afuera: la cara de afuera (60 %) con el color de la casa y la de adentro (40 %) con el de adentro. out: hacia
 // dónde queda afuera (+1 / −1 en el eje perpendicular).
 const outer=(axis,at,out,a0,a1,y0,y1,holes,inside=cIn,cuts=[])=>wall(axis,at,a0,a1,y0,y1,[[T*.6,out*T*.2,wallCat,cWall],[T*.4,-out*T*.3,'interior',inside,cuts]],holes);
 // Tabique: dos caras, cada una del color del cuarto de su lado (cNeg: hacia −x / −z).
 const inner=(axis,at,a0,a1,y0,y1,holes,cNeg=cIn,cPos=cIn)=>wall(axis,at,a0,a1,y0,y1,[[TI/2,-TI/4,'interior',cNeg],[TI/2,TI/4,'interior',cPos]],holes);
 // Un vano en una pared de afuera: la ventana o la puerta del paquete, y lo que lo rodea (alféizar, dintel, postigos).
 const win=(axis,at,out,c,yFloor,type)=>{const k=WINDOWS[type],y0=yFloor+k.sill,y1=y0+k.h;openings.push({kind:'window',m:k.m,axis,at,out,c,w:k.w,y0,h:k.h,ext:s.postigos?k.w/2+.08+k.w*.45:k.w/2+.08});
  const o=out*(T/2+.03);// el marco sobresale un poco de la pared
  if(axis==='x'){box('marco',c-k.w/2-.08,y0-.08,at+o-.05,c+k.w/2+.08,y0,at+o+.05+out*.04,cTrim);box('marco',c-k.w/2-.06,y1,at+o-.03,c+k.w/2+.06,y1+.1,at+o+.03,cTrim);
   if(s.postigos)for(const sg of [-1,1])box('marco',c+sg*(k.w/2+.08),y0,at+o-.02,c+sg*(k.w/2+.08+k.w*.45),y1,at+o+.02,cDoor);}
  else{box('marco',at+o-.05,y0-.08,c-k.w/2-.08,at+o+.05+out*.04,y0,c+k.w/2+.08,cTrim);box('marco',at+o-.03,y1,c-k.w/2-.06,at+o+.03,y1+.1,c+k.w/2+.06,cTrim);
   if(s.postigos)for(const sg of [-1,1])box('marco',at+o-.02,y0,c+sg*(k.w/2+.08),at+o+.02,y1,c+sg*(k.w/2+.08+k.w*.45),cDoor);}
  return {c,w:k.w,y0,y1};};
 // Un macetero bajo una ventana del frente (zFace: la cara de afuera de la pared): la caja del color de los postigos,
 // la mata y unas flores (cubitos de dos tonos), todo en cajas: no suma llamadas de dibujo.
 const cFlor=col('flores',s.flores),cFlor2=shade(cFlor,1.18),LEAF='#4f7d3f',LEAF2='#5f9149';
 const planter=(zFace,c,w,ySill)=>{const y1=ySill-.1,x0=c-w/2-.06,x1=c+w/2+.06;
  box('liso',x0,y1-.2,zFace,x1,y1,zFace+.24,cDoor,false);box('liso',x0-.02,y1-.02,zFace-.01,x1+.02,y1+.01,zFace+.26,shade(cDoor,.8),false);
  box('liso',x0+.04,y1,zFace+.04,x1-.04,y1+.1,zFace+.2,LEAF,false);
  const n=Math.max(3,Math.round((x1-x0)/.17));for(let i=0;i<n;i++){const x=x0+.1+(x1-x0-.2)*(i+.5)/n,z=zFace+(i%2?.16:.08),hh=.1+((i*7)%3)*.035;
   box('liso',x-.05,y1+.06,z-.04,x+.05,y1+.06+hh,z+.04,i%3===1?LEAF2:LEAF,false);box('liso',x-.045,y1+.06+hh,z-.045,x+.045,y1+.13+hh,z+.045,i%2?cFlor:cFlor2,false);}};
 const door=(axis,at,out,c,yFloor,m,w=DOOR_W,h=DOOR_H)=>{openings.push({kind:'door',m,axis,at,out,c,w,y0:yFloor,h,ext:w/2+.12});/* (ext: lo que ocupa a lo largo de la pared, con el marco) */const o=out*(T/2+.02);
  if(axis==='x'){for(const sg of [-1,1])box('marco',c+sg*(w/2+.06)-.06,yFloor,at+o-.04,c+sg*(w/2+.06)+.06,yFloor+h+.08,at+o+.04,cTrim);box('marco',c-w/2-.12,yFloor+h,at+o-.05,c+w/2+.12,yFloor+h+.16,at+o+.05,cTrim);}
  else{for(const sg of [-1,1])box('marco',at+o-.04,yFloor,c+sg*(w/2+.06)-.06,at+o+.04,yFloor+h+.08,c+sg*(w/2+.06)+.06,cTrim);box('marco',at+o-.05,yFloor+h,c-w/2-.12,at+o+.05,yFloor+h+.16,c+w/2+.12,cTrim);}
  return {c,w,y0:yFloor-.2,y1:yFloor+h};};
 // Zonas que quedan libres (el paso de las puertas, el pie y el descanso de la escalera): un mueble que estorba prueba
 // sus otros lugares (alts: [[x, z], …]) y, si ninguno sirve, no va.
 const clear=[],keep=(x0,z0,x1,z1,y)=>clear.push({x0:Math.min(x0,x1),x1:Math.max(x0,x1),z0:Math.min(z0,z1),z1:Math.max(z0,z1),y});
 // (win: además, lo alto —TALL_H, su alto— no va contra una ventana: a menos de 50 cm de su pared, cruzándola)
 const free=(m,x,z,y,rot,win=true)=>{const sz=FURN_SIZE[m];if(!sz)return true;const turned=Math.abs(Math.sin(rot))>.5,hw=(turned?sz[1]:sz[0])/2,hd=(turned?sz[0]:sz[1])/2;
  if(clear.some(c=>Math.abs(c.y-y)<1&&x+hw>c.x0&&x-hw<c.x1&&z+hd>c.z0&&z-hd<c.z1))return false;
  const H=TALL_H[m];if(!win||!H)return true;
  return !openings.some(o=>{if(o.kind!=='window'||o.y0>y+2.6||o.y0<y-.2||y+H<=o.y0+.05)return false;const ax=o.axis==='x',[a,b]=ax?[x-hw,x+hw]:[z-hd,z+hd],d=ax?Math.min(Math.abs(z-hd-o.at),Math.abs(z+hd-o.at)):Math.min(Math.abs(x-hw-o.at),Math.abs(x+hw-o.at));
   return d<.5&&Math.min(b,o.c+o.w/2)-Math.max(a,o.c-o.w/2)>.05;});};
 // Faroles (yTop: de dónde cuelga) y focos: el vidrio va en 'farol', el material que brilla de noche.
 const LAMP_DARK='#2b2d2f',lantern=(x,yTop,z)=>{box('marco',x-.13,yTop-.05,z-.13,x+.13,yTop,z+.13,LAMP_DARK,false);box('farol',x-.09,yTop-.33,z-.09,x+.09,yTop-.05,z+.09,'#f3e3bf',false);
  box('marco',x-.11,yTop-.37,z-.11,x+.11,yTop-.33,z+.11,LAMP_DARK,false);for(const [dx,dz] of [[-1,-1],[1,-1],[-1,1],[1,1]])box('marco',x+dx*.09-.012,yTop-.33,z+dz*.09-.012,x+dx*.09+.012,yTop-.05,z+dz*.09+.012,LAMP_DARK,false);};
 const bulb=(x,y,z)=>box('farol',x-.06,y-.06,z-.06,x+.06,y+.06,z+.06,'#f8ecd0',false);
 // Alfombras y cuadros del catálogo de objetos (lib/objetos3d.js), en cajas planas: la alfombra apoyada en y; el cuadro
 // colgado de la pared (axis/at: la pared, como las de openings) en (x, z) y corrido a lo largo hasta no tapar una
 // ventana ni una puerta (si no hay lugar, no va).
 const rug=(x,y,z,ry,w,d,k)=>{for(const b of partsBoxes(OBJETOS.alfombra.piezas({w,d,variante:['persa','rayas','moderna'][Math.floor(hs('r'+k)*3)],paleta:Math.floor(hs('p'+k)*RUG_COUNT)}),{x,y:y+.004,z,ry}))box('liso',b.x0,b.y0,b.z0,b.x1,b.y1,b.z1,b.color,false);};
 const art=(x,y,z,ry,axis,at,yFloor,k)=>{const W=.9,H=.62;
  for(const sh of [0,.6,-.6,1.1,-1.1]){const c=(axis==='x'?x:z)+sh;
   if(openings.some(o=>o.axis===axis&&Math.abs(o.at-at)<.25&&o.y0<yFloor+2.4&&o.y0+o.h>yFloor+.6&&Math.abs(o.c-c)<o.w/2+W/2+.12))continue;
   for(const b of partsBoxes(OBJETOS.cuadro.piezas({w:W,h:H,variante:['paisaje','mar','abstracto','flores'][Math.floor(hs('c'+k)*4)],marco:Math.floor(hs('m'+k)*4)}),{x:axis==='x'?c:x,y,z:axis==='x'?z:c,ry}))box('liso',b.x0,b.y0,b.z0,b.x1,b.y1,b.z1,b.color,false);
   return true;}
  return false;};
 // Un objeto del catálogo en cajas planas (decoración: no estorba al caminar).
 const deco=(id,o,x,y,z,ry)=>{for(const b of partsBoxes(OBJETOS[id].piezas(o),{x,y,z,ry}))box('liso',b.x0,b.y0,b.z0,b.x1,b.y1,b.z1,b.color,false);};
 // (las camas, si no hay lugar sin ventana, van igual: un dormitorio sin cama es peor)
 const fur=(m,x,y,z,rot=0,solid=true,alts=[])=>{for(const win of BEDS.has(m)?[true,false]:[true])for(const [ax,az] of [[x,z],...alts])if(!solid||free(m,ax,az,y,rot,win)){const it={m,x:ax,y,z:az,rot,solid};furniture.push(it);
   // lo que estorba también ocupa: lo que venga después no se le encima
   if(solid&&FURN_SIZE[m]){const t=Math.abs(Math.sin(rot))>.5,[sw,sd]=FURN_SIZE[m],hw=(t?sd:sw)/2,hd=(t?sw:sd)/2;keep(ax-hw+.02,az-hd+.02,ax+hw-.02,az+hd-.02,y);}return it;}return null;};

 // La puerta de un cuarto (2026-10-12): la hoja del catálogo (estilo: tablero, lisa, vidrio o rejilla), a la medida del
 // vano, que abre hacia el lado contrario de out (como la de calle: out es el pasillo, la hoja va hacia el cuarto), y el
 // marco por las dos caras del tabique.
 const innerLeaf=(axis,at,c,w,yF,out,style,abierta=false)=>{openings.push({kind:'door',inner:true,m:'Leaf_'+style,axis,at,out,c,w,y0:yF,h:INNER_H,abierta});
  for(const sg of [-1,1]){const o=sg*(TI/2+.012);
   if(axis==='x'){for(const e of [-1,1])box('marco',c+e*(w/2+.04)-.04,yF,at+o-.012,c+e*(w/2+.04)+.04,yF+INNER_H+.06,at+o+.012,cTrim,false);box('marco',c-w/2-.08,yF+INNER_H,at+o-.012,c+w/2+.08,yF+INNER_H+.08,at+o+.012,cTrim,false);}
   else{for(const e of [-1,1])box('marco',at+o-.012,yF,c+e*(w/2+.04)-.04,at+o+.012,yF+INNER_H+.06,c+e*(w/2+.04)+.04,cTrim,false);box('marco',at+o-.012,yF+INNER_H,c-w/2-.08,at+o+.012,yF+INNER_H+.08,c+w/2+.08,cTrim,false);}}};
 // La ventana de un cuarto (2026-10-12; las casas de la familia): la del catálogo (objetos3d ventana) a la medida, con el
 // vidrio aparte (cat 'vidrio': transparente y con luz de noche), los postigos si la casa los lleva y una apertura sin
 // modelo (para las cortinas y para los muebles que no tapan ventanas). Cada cuarto, la suya: el baño chica y alta
 // (esmerilada), la cocina ancha sobre el mesón, el dormitorio de dos hojas, la sala de tres paños y más baja.
 const conPostigos=(K,w,sin=false)=>!sin&&s.postigos&&K.v!=='bano'&&w<=1.5;
 const ROOM_WIN={bano:{v:'bano',h:.6,sill:1.5,maxW:.7},cocina:{v:'cocina',h:.95,sill:1.1,maxW:1.4},dormitorio:{v:'dos_hojas',h:1.3,sill:.9,maxW:1.5},
  sala:{v:'tres_panos',h:1.5,sill:.6,maxW:2.1},oficina:{v:'simple',h:1.2,sill:.9,maxW:1.1},otro:{v:'dos_hojas',h:1.2,sill:.9,maxW:1.3}};
 const roomWin=(axis,at,out,c,yF,K,w,tela=null,sinPostigos=false)=>{const y0=yF+K.sill,h=K.h,ry=axis==='x'?(out>0?0:Math.PI):(out>0?Math.PI/2:-Math.PI/2);
  openings.push({kind:'window',m:null,axis,at,out,c,w,y0,h,room:K.v,tela,ext:conPostigos(K,w,sinPostigos)?w+.06:w/2+.08});
  for(const b of partsBoxes(OBJETOS.ventana.piezas({w,h,variante:K.v,color:cTrim}),{x:axis==='x'?c:at,y:y0,z:axis==='x'?at:c,ry}))box(b.color?'marco':'vidrio',b.x0,b.y0,b.z0,b.x1,b.y1,b.z1,b.color||'#cfe4ee',false);
  // (el alféizar y el dintel —2026-10-16, los acabados low poly, como los de los edificios: fachada3d.js ACABADO—: un poco
  // más anchos que la ventana, del color de la moldura, saliendo de la cara de afuera)
  {const f0=at+out*T/2,sa=(lo,hi,y,yy,sal)=>axis==='x'?box('marco',c-lo,y,f0,c+hi,yy,f0+out*sal,cTrim,false):box('marco',f0,y,c-lo,f0+out*sal,yy,c+hi,cTrim,false);
   sa(w/2+.08,w/2+.08,y0-.06,y0,.1);sa(w/2+.06,w/2+.06,y0+h,y0+h+.1,.06);}
  // (los postigos: media ventana cada uno; los ventanales y el baño, sin)
  if(conPostigos(K,w,sinPostigos)){const o=out*(T/2+.05),pw=w/2;for(const sg of [-1,1]){if(axis==='x')box('marco',c+sg*(w/2+.06),y0,at+o-.02,c+sg*(w/2+.06+pw),y0+h,at+o+.02,cDoor);else box('marco',at+o-.02,y0,c+sg*(w/2+.06),at+o+.02,y0+h,c+sg*(w/2+.06+pw),cDoor);}}
  return {c,w,y0,y1:y0+h};};
 // ---- Las casas desde la familia (spec.hogar, 2026-10-12) ----
 // El plano de hogar.js está en (u a lo ancho, v desde el frente): acá x = u y z = D − v (el frente mira a +z).
 // hogarWalls(nivel): las paredes de afuera con las ventanas y la puerta de ese piso, y un tabique en cada borde entre
 // cuartos (con el vano de cada puerta; la escalera, abierta al pasillo), cada cara del color del cuarto de su lado.
 const solids=[],pisables=[],bedSpots=[],seatSpots=[];
 const hgColOf=(q,nivel)=>(q&&C2?.cuartos?.[nivel+':'+q.id])||(!q?cIn:q.type==='cocina'?cKit:q.type==='bano'?cBath:q.type==='dormitorio'?(q.id%2?cBed2:cBed1):cIn);
 const hgAt=(L,x,z)=>L.rooms.find(q=>x>q.u0-1e-6&&x<q.u1+1e-6&&D-z>q.v0-1e-6&&D-z<q.v1+1e-6&&q.type!=='hall')||L.rooms.find(q=>x>q.u0&&x<q.u1&&D-z>q.v0&&D-z<q.v1);
 const hgCol=(L,x,z)=>hgColOf(hgAt(L,x,z),L.level);
 function hogarWalls(lv){const L=HG.levels[lv],yF=lv?H1:FLOOR0,y0w=lv?H1:0,yTop=lv?H2:H1,front=[],back=[],left=[],right=[],big=lv?s.ventanaArriba:s.ventana;
  // (cada ventana, la de su cuarto: roomWin; el ancho, lo que da la pared del cuarto hasta el máximo de su tipo)
  // (s.cortinas2d —engine/cortinas.js, de la casa—: los cuartos con la cortina cerrada y su tela)
  // (2026-10-16, Miguel: «la ventana y la puerta se solapan»: el ancho de la ventana, además, el que cabe en la pared entre
  // las puertas —con 15 cm de marco— y las otras ventanas de esa pared; si no cabe medio metro, no va. Antes, el del cuarto)
  const enPared=(a,b)=>a.axis===b.axis&&Math.abs(a.at-b.at)<.01;
  const cabe=(w,c)=>{let half=Infinity;const tramo=(lo,hi)=>{if(c>lo&&c<hi)half=0;else half=Math.min(half,c<=lo?lo-c:c-hi);};
   for(const d of L.doors||[])if(enPared(d,w))tramo(d.from-.15,d.from+d.len+.15);for(const o of L.windows)if(o!==w&&enPared(o,w))tramo(o.from-.1,o.from+o.len+.1);return half;};
  // (2026-10-18, Miguel: «las ventanas quedan juntas o incluso ocupando el mismo espacio de la puerta»: el ancho de antes
  // no contaba los postigos —media ventana de cada lado— ni la puerta tal como se dibuja —la doble, de 1,9 m— ni las
  // esquinas; validar-vanos midió 169 ventanas encima o pegadas a la puerta en dos ciudades. Ahora cada ventana va en su
  // tramo: el de su cuarto a lo largo de la pared, sin la puerta dibujada con su marco, a VANO.esquina de las esquinas y
  // VANO.hueco/2 de la pared del cuarto vecino; ahí cabe con postigos, o sin ellos, o más angosta, o no va.)
  const largoDe=w=>w.axis==='u'?W:D,puertasDe=w=>(L.doors||[]).filter(d=>(d.street||d.patio)&&enPared(d,w)).map(d=>{const c=d.from+d.len/2,e=(d.patio?DOOR_W:doorW)/2+.12;return [c-e,c+e];});
  const tramoDe=(w,q)=>{const r0=w.axis==='u'?q.u0:q.v0,r1=w.axis==='u'?q.u1:q.v1,lo=Math.max(r0+VANO.hueco/2,VANO.esquina),hi=Math.min(r1-VANO.hueco/2,largoDe(w)-VANO.esquina);
   let piezas=[[lo,hi]];for(const [a,b] of puertasDe(w))piezas=piezas.flatMap(([x,y])=>[[x,Math.min(y,a-VANO.hueco)],[Math.max(x,b+VANO.hueco),y]]).filter(([x,y])=>y-x>.05);
   const c=w.from+w.len/2;return piezas.find(([x,y])=>c>=x&&c<=y)||piezas.sort((p,q2)=>(q2[1]-q2[0])-(p[1]-p[0]))[0]||null;};
  // (si en su pared no cabe —la cocina chica con la puerta del patio—, la del costado de la casa, si el cuarto llega)
  const ubicar=(w,q,K)=>{const tr=tramoDe(w,q);if(!tr)return null;const edge=w.axis==='u'?q.u1-q.u0:q.v1-q.v0,medio=(tr[1]-tr[0])/2;let ww=Math.min(K.maxW,edge-.7,w.len-.1),sinP=false;
   if(conPostigos(K,ww)&&ww+.06>medio)sinP=true;if(sinP||!conPostigos(K,ww))ww=Math.min(ww,2*(medio-.08));if(ww<.5)return null;
   const ext=conPostigos(K,ww,sinP)?ww+.06:ww/2+.08;return {w,ww,sinP,c:Math.min(Math.max(w.from+w.len/2,tr[0]+ext),tr[1]-ext)};};
  for(const w0 of L.windows){const q=L.rooms.find(r=>r.id===w0.a),K=ROOM_WIN[q?.type]||ROOM_WIN.otro;if(!q)continue;
   const unica=L.windows.filter(o=>o.a===q.id).length===1,costados=unica&&w0.axis==='u'?[q.u0<.01?{axis:'v',at:0}:null,Math.abs(q.u1-W)<.01?{axis:'v',at:W}:null].filter(Boolean).map(o=>({...o,from:q.v0+.3,len:q.v1-q.v0-.6,a:q.id})):[];
   const u=[w0,...costados].reduce((r,w)=>r||ubicar(w,q,K),null);if(!u)continue;const {w,ww,sinP,c}=u;
   const n0=openings.length;
   const tl=q&&s.cortinas2d?.cuartos?.includes(L.level+':'+q.id)?s.cortinas2d.tela:null;
   if(w.axis==='u'){if(w.at<.01){front.push(roomWin('x',D-T/2,1,c,yF,K,ww,tl,sinP));if(!lv&&s.maceteros&&K.sill<1)planter(D,c,ww,yF+K.sill);}else back.push(roomWin('x',T/2,-1,c,yF,K,ww,tl,sinP));}
   else{const cz=D-c;if(w.at<.01)left.push(roomWin('z',T/2,-1,cz,yF,K,ww,tl,sinP));else right.push(roomWin('z',W-T/2,1,cz,yF,K,ww,tl,sinP));}
   if(openings[n0])Object.assign(openings[n0],{cuarto:q.id,nivel:L.level});}
  const sd=L.doors.find(d=>d.street);if(sd)front.push(door('x',D-T/2,1,sd.from+sd.len/2,yF,s.puerta,doorW));
  // (la de atrás, al patio —hogar.js—: como la de calle, en la pared del fondo)
  const pd=L.doors.find(d=>d.patio);if(pd)back.push(door('x',T/2,-1,pd.from+pd.len/2,yF,s.puerta==='Door_Double'?'Door_1':s.puerta,DOOR_W));// (sencilla siempre: la doble, de 1,9 m, no cabe al lado de la ventana)
  // (por dentro, el color del cuarto que está detrás de cada tramo)
  const us=[...new Set(L.rooms.flatMap(q=>[q.u0,q.u1]))].sort((a,b)=>a-b),zs=[...new Set(L.rooms.flatMap(q=>[D-q.v0,D-q.v1]))].sort((a,b)=>a-b);
  outer('x',D-T/2,1,0,W,y0w,yTop,front,x=>hgCol(L,x,D-.3),us);outer('x',T/2,-1,0,W,y0w,yTop,back,x=>hgCol(L,x,.3),us);
  outer('z',T/2,-1,T,D-T,y0w,yTop,left,z=>hgCol(L,.3,z),zs);outer('z',W-T/2,1,T,D-T,y0w,yTop,right,z=>hgCol(L,W-.3,z),zs);
  // Tabiques: cada borde entre cuartos, una vez (juntando los tramos de los dos lados), partido donde cambia el cuarto.
  const lines=new Map(),addE=(axis,at,a,b)=>{const k=axis+':'+at.toFixed(3);(lines.get(k)||lines.set(k,{axis,at,iv:[]}).get(k)).iv.push([a,b]);};
  for(const q of L.rooms){const x0=q.u0,x1=q.u1,z0=D-q.v1,z1=D-q.v0;if(z1<D-.01)addE('x',z1,x0,x1);if(z0>.01)addE('x',z0,x0,x1);if(x0>.01)addE('z',x0,z0,z1);if(x1<W-.01)addE('z',x1,z0,z1);}
  const yHi=yTop-(lv===0&&two?.2:.02);
  for(const {axis,at,iv} of lines.values()){iv.sort((p,q)=>p[0]-q[0]);const merged=[];for(const [a,b] of iv){const l=merged[merged.length-1];if(l&&a<=l[1]+1e-6)l[1]=Math.max(l[1],b);else merged.push([a,b]);}
   const holes=L.doors.filter(d=>!d.street&&(axis==='x'?d.axis==='u'&&Math.abs(D-d.at-at)<.01:d.axis==='v'&&Math.abs(d.at-at)<.01)).map(d=>{const stair=[d.a,d.b].some(id=>L.rooms[id]?.type==='escalera');
    return {c:axis==='x'?d.from+d.len/2:D-(d.from+d.len/2),w:d.len,y0:0,y1:stair||d.open?(stair?yTop+1:yF+DOOR_H):yF+INNER_H+.02};});
   const cutsAlong=(axis==='x'?us:zs);
   for(let [a,b] of merged){a=Math.max(a,T);b=Math.min(b,axis==='x'?W-T:D-T);if(b-a<.05)continue;const pts=[a,...cutsAlong.filter(c=>c>a+.05&&c<b-.05),b];
    for(let i=0;i+1<pts.length;i++){const p0=pts[i],p1=pts[i+1],m=(p0+p1)/2,cN=axis==='x'?hgCol(L,m,at-.2):hgCol(L,at-.2,m),cP=axis==='x'?hgCol(L,m,at+.2):hgCol(L,at+.2,m);
     inner(axis,at,p0,p1,yF,yHi,holes.filter(h=>h.c+h.w/2>p0&&h.c-h.w/2<p1),cN,cP);}}}
  // Las puertas de los cuartos (2026-10-12): el marco por las dos caras del tabique y la hoja (del catálogo, a la medida
  // del vano) que abre hacia adentro del cuarto; de tablero en los dormitorios, con rejilla en el baño, con vidrio en la
  // cocina y lisa en lo demás. Los vanos abiertos (sala-comedor, la escalera) y la de calle no llevan.
  // (y sólo las que el plano marca con hoja —d.hoja, engine/puertas.js—: dormitorios, baños, oficina, depósito; la cocina
  // y la sala, vano abierto)
  for(const d of L.doors){if(d.street||d.patio||d.open||d.hoja===false)continue;const q=L.rooms.find(r=>r.id===d.a);if(!q)continue;
   const style=q.type==='dormitorio'?'tablero':q.type==='bano'?'rejilla':q.type==='cocina'?'vidrio':'lisa',c0=d.from+d.len/2,w=d.len;
   // (out: hacia el pasillo —la hoja gira hacia el otro lado, como la de calle, que abre hacia adentro—)
   let axis,at,c,out;if(d.axis==='u'){axis='x';at=D-d.at;c=c0;out=(q.v0+q.v1)/2>d.at?1:-1;}else{axis='z';at=d.at;c=D-c0;out=(q.u0+q.u1)/2>d.at?-1:1;}
   innerLeaf(axis,at,c,w,yF,out,style,!!d.abierta);}// (abierta: del todo y quieta, engine/puertas.js)
  // una lámpara de techo por cuarto
  for(const q of L.rooms){if(q.type==='escalera')continue;const x=(q.u0+q.u1)/2,z=D-(q.v0+q.v1)/2,yb=lv?H2-.42:two?H1-.5:H1-.34;bulb(x,yb,z);lights.push({x,y:yb-.1,z});}}
 // hogarFurniture: los muebles del plano. Los del catálogo (objetos3d.js), en cajas y a la medida; los del paquete (la
 // estufa, el sillón, las sillas, la lavadora, las plantas), como modelos; el mesón, en módulos de cocina a lo largo.
 // Cada uno estorba al caminar con su huella (solids) y las camas y los sofás quedan para las visitas.
 const CAT_ID={cama:'cama',cama_s:'cama',armario:'armario',sofa:'sofa',comoda:'comoda2',escritorio:'escritorio',estante:'biblioteca',nevera:'nevera',mesa:'mesa_comedor',
  mesa_noche:'mesa_noche',inodoro:'inodoro',lavamanos:'lavamanos',ducha:'ducha',tv:'tv',archivador:'archivador',mesa_centro:'mesa_centro'};
 const KIT_M={estufa:'Kitchen_Oven',sillon:'C2_Sofa',silla:'C2_ChairCushioned',lavadora:'Bathroom_WashingMachine',tina:'Bathroom_Bathtub',planta:'Houseplant_8',lampara:'C2_Lamp'};
 function hogarFurniture(){for(const L of HG.levels){const y=L.level?H1:FLOOR0;
  for(const f of L.furniture){const d=f.dir||[0,1],rot=Math.atan2(d[0],-d[1]),along=Math.abs(d[1])>.5,w=along?f.u1-f.u0:f.v1-f.v0,dd=along?f.v1-f.v0:f.u1-f.u0,x=(f.u0+f.u1)/2,z=D-(f.v0+f.v1)/2;
   // (el choque, el de CHOQUE_MUEBLE —medidas.js—: lo pisable, además, es una superficie donde pararse; lo que no
   // choca, nada)
   const foot=()=>{const r=CHOQUE_MUEBLE[f.kind]||{choque:'solido',alto:.9};if(r.choque==='ninguno')return;const b={x0:f.u0,x1:f.u1,z0:D-f.v1,z1:D-f.v0,y0:y,y1:y+r.alto};solids.push(b);if(r.choque==='pisable')pisables.push({...b,y:y+r.alto});};
   if(f.kind==='meson'){const n=Math.max(1,Math.floor((w+.02)/.53)),cx=Math.cos(rot),cz=-Math.sin(rot);
    for(let k=0;k<n;k++){const off=(k-(n-1)/2)*.53,m=k===Math.floor(n/2)?'Kitchen_Sink':k%2?'Kitchen_Cabinet1':'Kitchen_2Drawers';furniture.push({m,x:x+cx*off,y,z:z+cz*off,rot,solid:false});}foot();continue;}
   // (las sillas no estorban: se corren, como en la prueba de movimiento de los cuartos)
   if(KIT_M[f.kind]){furniture.push({m:KIT_M[f.kind],x,y,z,rot,solid:false});foot();
    if(f.kind==='sillon')seatSpots.push({x,y,z,rot,n:1});continue;}
   const id=CAT_ID[f.kind],O=id&&OBJETOS[id];if(!O)continue;
   for(const b of partsBoxes(O.piezas({w,d:dd}),{x,y,z,ry:rot}))if(b.color)box('liso',b.x0,b.y0,b.z0,b.x1,b.y1,b.z1,b.color,false);
   if(f.kind==='ducha'){for(const b of partsBoxes(OBJETOS.mampara.piezas({w,d:dd}),{x,y,z,ry:rot}))if(b.color)box('liso',b.x0,b.y0,b.z0,b.x1,b.y1,b.z1,b.color,false);foot();continue;}
   foot();
   // (los costados de la cama: a 35 cm del borde y dentro de su cuarto —no del otro lado de un tabique—)
   if(f.kind==='cama'||f.kind==='cama_s'){const q=L.rooms.find(r=>r.id===f.room),ux=Math.cos(rot),uz=-Math.sin(rot),hw=w/2+.35;
    const inRoom=p=>q&&p.x>q.u0+.25&&p.x<q.u1-.25&&D-p.z>q.v0+.25&&D-p.z<q.v1-.25;
    const sides=[{x:x+ux*hw,y:0,z:z+uz*hw},{x:x-ux*hw,y:0,z:z-uz*hw}].filter(inRoom);if(sides.length)bedSpots.push({x,y,z,rot,w,top:.5,sides});}
   if(f.kind==='sofa')seatSpots.push({x,y,z,rot,n:Math.max(1,Math.round((w-.32)/.62)),w});}}}
 // ---- Dónde va cada cosa adentro ----
 const sx0=T,sx1=T+STAIR.w;                                   // la franja de la escalera, contra la pared izquierda
 const stTop=T+STAIR.landing,stBot=stTop+stRun;           // la escalera sube del frente (stBot) hacia el fondo (stTop)
 const holeZ1=stBot-stRun*Math.max(0,(FH-.2-2.1)/FH);          // el hueco de arriba: de stTop a holeZ1 (más allá quedan 2,1 m libres)
 const bath=!HG&&s.ancho>=3?{x0:W-T-2,x1:W-T,z0:T,z1:T+2}:null;     // el baño de la planta baja, en la esquina de atrás a la derecha
 const doorMod=s.puertaModulo!=null?Math.max(0,Math.min(s.ancho-1,s.puertaModulo)):Math.floor(s.ancho/2);
 const doorW=DOORS[s.puerta].w||DOOR_W,hgDoor=HG?.levels[0].doors.find(d=>d.street),doorX=hgDoor?hgDoor.from+hgDoor.len/2:doorMod*MOD+MOD/2;

 // ---- Cimiento, pisos y cielos rasos ----
 box('zocalo',-.04,-.6,-.04,W+.04,FLOOR0,D+.04,cBase,false);floor(0,0,W,D,FLOOR0);
 box('madera',T,FLOOR0-.02,T,W-T,FLOOR0+.005,D-T,WOOD,false);
 const ceil=(x0,z0,x1,z1,y)=>box('cielo',x0,y-.04,z0,x1,y,z1,CEIL,false);
 if(two){// la losa del primer piso, con el hueco de la escalera
  const slab=(x0,z0,x1,z1)=>{box('madera',x0,H1-.2,z0,x1,H1,z1,WOOD,false);ceil(x0,z0,x1,z1,H1-.2);floor(x0,z0,x1,z1,H1);};
  slab(sx1,T,W-T,Du-T);slab(sx0,T,sx1,stTop);slab(sx0,holeZ1,sx1,Du-T);
  if(setback)ceil(T,Du-T,W-T,D-T,H1-.2);// abajo sigue la planta entera (encima, la terraza)
  ceil(T,T,W-T,Du-T,H2-.02);
  // Peldaños (2026-10-12): el macizo pintado, la huella de madera con su nariz que asoma 3 cm hacia el frente; y su
  // rampa para caminar.
  const rise=FH/STAIR.steps,tread=stRun/STAIR.steps,TH=.045,NO=.03;
  for(let i=0;i<STAIR.steps;i++){const y=FLOOR0+(i+1)*rise,zb=stBot-(i+1)*tread,zf=stBot-i*tread;
   box('liso',sx0,FLOOR0,zb,sx1,y-TH,zf,SM.body,false);box('madera',sx0,y-TH,zb,sx1+.01,y,zf+NO-.035,SM.tread,false);box('madera',sx0,y-TH-.004,zf+NO-.035,sx1+.01,y,zf+NO,SM.nose,false);}// (la nariz al lado de la huella, no encima: si comparten la cara de arriba, titilan)
  ramps.push({x0:sx0,x1:sx1,z0:stTop,z1:stBot,zLow:stBot,yLow:FLOOR0,zHigh:stTop,yHigh:H1});
  // Pasamanos inclinado (un prisma de cuatro caras) a 90 cm sobre las narices: (x, z0→z1, y0→y1).
  const slope=(x,z0,y0,z1,y1,w=.06,color=SM.rail)=>{const a=[x-w/2,y0,z0],b=[x+w/2,y0,z0],c=[x+w/2,y1,z1],d=[x-w/2,y1,z1],up=v=>[v[0],v[1]+w,v[2]];
   quad('madera',up(a),up(b),up(c),up(d),color);quad('madera',a,b,c,d,color);quad('madera',a,d,up(d),up(a),color);quad('madera',b,c,up(c),up(b),color);};
  const yAt=z=>FLOOR0+FH*(stBot-z)/stRun;
  // Del lado abierto (hacia la sala): un barrote por peldaño, el pasamanos y el poste de arranque; contra la pared, el
  // pasamanos con tres ménsulas.
  const xo=sx1-.04;for(let i=0;i<STAIR.steps;i++){const zc=stBot-(i+.5)*tread,y=FLOOR0+(i+1)*rise;box('marco',xo-.015,y,zc-.015,xo+.015,yAt(zc)+.9,zc+.015,SM.post,false);}
  slope(xo,stBot,FLOOR0+.9,stTop+.05,H1+.9);box('madera',xo-.05,FLOOR0,stBot-.12,xo+.05,FLOOR0+1.05,stBot-.02,SM.rail,false);
  const xw=sx0+.07;slope(xw,stBot+.2,FLOOR0+.85,stTop-.1,H1+.95);for(const t of [.15,.5,.85]){const z=stBot-stRun*t;box('marco',sx0,yAt(z)+.82,z-.02,xw,yAt(z)+.88,z+.02,SM.rail,false);}
  // Baranda al borde del hueco (del lado del frente): pasamanos (estorba al caminar), zócalo y barrotes cada 12 cm.
  box('madera',sx0,H1+.94,holeZ1-.03,sx1,H1+1,holeZ1+.03,SM.rail);box('liso',sx0,H1,holeZ1-.025,sx1,H1+.08,holeZ1+.025,SM.post,false);
  for(let x=sx0+.12;x<sx1-.04;x+=.12)box('marco',x-.013,H1+.08,holeZ1-.013,x+.013,H1+.94,holeZ1+.013,SM.post,false);
 }else ceil(T,T,W-T,D-T,H1-.02);

 // ---- Paredes de afuera de la planta baja ----
 if(HG)hogarWalls(0);else{
 const yw0=0;
 {const front=[],back=[],left=[],right=[];
  front.push(door('x',D-T/2,1,doorX,FLOOR0,s.puerta,doorW));
  for(let i=0;i<s.ancho;i++)if(i!==doorMod){front.push(win('x',D-T/2,1,i*MOD+MOD/2,FLOOR0,s.ventana));if(s.maceteros)planter(D,i*MOD+MOD/2,WINDOWS[s.ventana].w,FLOOR0+WINDOWS[s.ventana].sill);}
  for(let i=0;i<s.ancho;i++){const c=i*MOD+MOD/2,inBath=bath&&c>bath.x0-.3;back.push(win('x',T/2,-1,c,FLOOR0,'chica'));// atrás, chicas: van sobre la cocina y el baño
  void inBath;}
  for(let j=0;j<s.fondo;j++){const c=j*MOD+MOD/2;
   const nearStair=two&&c>stTop-.7&&c<stBot+.6,inGarL=gar&&s.garaje==='izq'&&c>gar.z0-.6,inGarR=gar&&s.garaje==='der'&&c>gar.z0-.6;
   if(!nearStair&&!inGarL)left.push(win('z',T/2,-1,c,FLOOR0,s.ventana));
   if(!inGarR)right.push(win('z',W-T/2,1,c,FLOOR0,bath&&c<bath.z1+.3?'chica':s.ventana));}
  // La puerta del garaje a la casa: en la pared del costado, cerca del frente.
  if(gar){const dz=D-T-.55,h={c:dz,w:INNER_DOOR_W,y0:FLOOR0-.2,y1:FLOOR0+DOOR_H};(s.garaje==='izq'?left:right).push(h);}
  outer('x',D-T/2,1,0,W,yw0,H1,front);outer('x',T/2,-1,0,W,yw0,H1,back,bath?u=>u>bath.x0-TI/2?cBath:cKit:cKit,bath?[bath.x0-TI/2]:[]);
  outer('z',T/2,-1,T,D-T,yw0,H1,left);outer('z',W-T/2,1,T,D-T,yw0,H1,right,bath?u=>u<bath.z1+TI/2?cBath:cIn:cIn,bath?[bath.z1+TI/2]:[]);}
 // Tabiques de la planta baja: el baño (con su puerta hacia el frente).
 if(bath){inner('z',bath.x0-TI/2,T,bath.z1+TI,FLOOR0,H1-.2,[],cIn,cBath);inner('x',bath.z1+TI/2,bath.x0-TI,W-T,FLOOR0,H1-.2,[{c:(bath.x0+bath.x1)/2,w:INNER_DOOR_W,y0:0,y1:FLOOR0+INNER_H+.02}],cBath,cIn);innerLeaf('x',bath.z1+TI/2,(bath.x0+bath.x1)/2,INNER_DOOR_W,FLOOR0,1,'rejilla');}}
 rooms.push({x0:T,x1:W-T,z0:T,z1:D-T,y0:FLOOR0,y1:two?H2:H1});

 // ---- El piso de arriba ----
 let roomsUp=[];
 if(!HG&&two){const front=[],back=[],left=[],right=[];
  // Cuartos: el pasillo es la franja de la escalera; a la derecha, uno o dos dormitorios.
  const rx0=sx1+TI,rw=W-T-rx0,split=rw>=6,xm=split?rx0+Math.round(rw/2*2)/2:null;
  roomsUp=split?[{x0:rx0,x1:xm-TI/2},{x0:xm+TI/2,x1:W-T}]:[{x0:rx0,x1:W-T}];
  // La puerta a la terraza (retirado): en el frente de arriba, en el último módulo.
  const terr=setback?s.ancho-1:-1;
  // Ningún tabique en medio de una ventana: la que cae sobre uno se corre al lado donde entra entera (2026-10-12).
  const cuts=[sx1+TI/2,...(split?[xm]:[])],wk=WINDOWS[s.ventanaArriba].w;
  const winAt=(c,w=wk)=>{for(const q of cuts)if(Math.abs(c-q)<w/2+TI/2+.08){const l=q-TI/2-.1-w/2,r=q+TI/2+.1+w/2,ok=v=>v-w/2>T+.08&&v+w/2<W-T-.08&&cuts.every(o=>Math.abs(v-o)>=w/2+TI/2+.08);
    return [l,r].filter(ok).sort((a,b)=>Math.abs(a-c)-Math.abs(b-c))[0]??null;}return c;};
  for(let i=0;i<s.ancho;i++){const c0=i*MOD+MOD/2,c=winAt(c0,i===terr?DOOR_W:wk);if(c==null)continue;if(i===terr)front.push(door('x',Du-T/2,1,c,H1,'Door_6'));else{front.push(win('x',Du-T/2,1,c,H1,s.ventanaArriba));if(s.maceteros)planter(Du,c,WINDOWS[s.ventanaArriba].w,H1+WINDOWS[s.ventanaArriba].sill);}}
  for(let i=0;i<s.ancho;i++){const c=winAt(i*MOD+MOD/2);if(c!=null)back.push(win('x',T/2,-1,c,H1,s.ventanaArriba));}
  for(let j=0;j<Du/MOD;j++){const c=j*MOD+MOD/2;left.push(win('z',T/2,-1,c,H1,s.ventanaArriba));right.push(win('z',W-T/2,1,c,H1,s.ventanaArriba));}
  // (arriba: el pasillo del color de la casa y cada dormitorio el suyo)
  const xh=sx1+TI/2,upC=u=>u<xh?cIn:split&&u>xm?cBed2:cBed1,upCuts=split?[xh,xm]:[xh];
  outer('x',Du-T/2,1,0,W,H1,H2,front,upC,upCuts);outer('x',T/2,-1,0,W,H1,H2,back,upC,upCuts);outer('z',T/2,-1,T,Du-T,H1,H2,left);outer('z',W-T/2,1,T,Du-T,H1,H2,right,split?cBed2:cBed1);
  // Tabique del pasillo, con la puerta al descanso; y el que parte los dos dormitorios, con su puerta adelante.
  inner('z',sx1+TI/2,T,Du-T,H1,H2-.02,[{c:T+STAIR.landing/2,w:INNER_DOOR_W,y0:0,y1:H1+INNER_H+.02}],cIn,cBed1);innerLeaf('z',sx1+TI/2,T+STAIR.landing/2,INNER_DOOR_W,H1,-1,'tablero');
  if(split){inner('z',xm,T,Du-T,H1,H2-.02,[{c:Du-T-.7,w:INNER_DOOR_W,y0:0,y1:H1+INNER_H+.02}],cBed1,cBed2);innerLeaf('z',xm,Du-T-.7,INNER_DOOR_W,H1,-1,'tablero');}
  // Franja entre pisos (afuera) y la terraza del retirado, con baranda.
  box('marco',-.04,H1-.08,-.04,W+.04,H1+.06,-.02,cTrim,false);box('marco',-.04,H1-.08,D+.02,W+.04,H1+.06,D+.04,cTrim,false);
  if(setback){box('techo',0,H1-.2,Du-T,W,H1,D,'#b9b2a6',false);floor(0,Du-T,W,D,H1);
   const rail=(x0,z0,x1,z1)=>{box('marco',x0,H1,z0,x1,H1+1,z1,cTrim);};rail(0,D-.08,W,D);rail(0,Du,.08,D);rail(W-.08,Du,W,D);}
  rooms.push({x0:T,x1:W-T,z0:T,z1:Du-T,y0:H1,y1:H2});}
 if(HG&&two){hogarWalls(1);rooms.push({x0:T,x1:W-T,z0:T,z1:D-T,y0:H1,y1:H2});}

 // ---- Techos ----
 const pitch=s.pendiente;
 // Un techo sobre el rectángulo (x0..x1, z0..z1) que apoya en y: dos aguas (cumbrera a lo largo de ridge: 'x' o 'z'),
 // cuatro aguas o plano (con pretil). Hastiales del color de la pared.
 // El tejado en hileras: cada agua (a, b: el alero; d, c: arriba, sobre a y b) se parte en hileras de ~40 cm, cada una
 // con un labio de 4,5 cm en su borde de abajo (así se ven las líneas de las tejas con caras planas). uv: u a lo largo
 // del alero (en m), v de 0 (abajo) a 1 (arriba) en cada hilera; en las tejuelas de madera cada hilera va corrida.
 const roofCat=s.tejado==='barro'?'teja_barro':s.tejado==='madera'?'teja_madera':'techo',ROW=s.tejado==='barro'?.36:.42,LIP=.045;
 const V3={sub:(p,q)=>[p[0]-q[0],p[1]-q[1],p[2]-q[2]],add:(p,q)=>[p[0]+q[0],p[1]+q[1],p[2]+q[2]],mul:(p,k)=>[p[0]*k,p[1]*k,p[2]*k],dot:(p,q)=>p[0]*q[0]+p[1]*q[1]+p[2]*q[2],
  cross:(p,q)=>[p[1]*q[2]-p[2]*q[1],p[2]*q[0]-p[0]*q[2],p[0]*q[1]-p[1]*q[0]],lerp:(p,q,t)=>[p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t,p[2]+(q[2]-p[2])*t]};
 const norm=v=>{const l=Math.hypot(...v)||1;return V3.mul(v,1/l);};
 const tiled=(a,b,c,d)=>{if(roofCat==='techo'){quads.push({cat:'techo',p:[a,b,c,d],color:cRoof});return;}
  let n=norm(V3.cross(V3.sub(b,a),V3.sub(d,a)));const flip=n[1]<0;if(flip)n=V3.mul(n,-1);
  const e1=norm(V3.sub(b,a)),len=Math.hypot(...V3.sub(V3.lerp(a,b,.5),V3.lerp(d,c,.5))),rows=Math.max(2,Math.round(len/ROW));
  for(let k=0;k<rows;k++){const t0=k/rows,t1=(k+1)/rows,L0=V3.lerp(a,d,t0),R0=V3.lerp(b,c,t0),L1=V3.lerp(a,d,t1),R1=V3.lerp(b,c,t1),lift=V3.mul(n,LIP),L0u=V3.add(L0,lift),R0u=V3.add(R0,lift);
   const off=s.tejado==='madera'?(k*.37)%1:0,u=p=>V3.dot(V3.sub(p,a),e1)+off;
   const pts=[L0u,R0u,R1,L1],uv=[[u(L0u),0],[u(R0u),0],[u(R1),1],[u(L1),1]];
   quads.push(flip?{cat:roofCat,p:[pts[1],pts[0],pts[3],pts[2]],uv:[uv[1],uv[0],uv[3],uv[2]],color:cRoof,one:true}:{cat:roofCat,p:pts,uv,color:cRoof,one:true});
   quads.push({cat:roofCat,p:[L0,R0,R0u,L0u],uv:[[u(L0),.02],[u(R0),.02],[u(R0u),.02],[u(L0u),.02]],color:cRoof});}};
 // Lo de abajo del alero, en un tono claro (como tablas pintadas).
 const SOFFIT='#d8cfc0',soffit=(a,b,c,d)=>quads.push({cat:'liso',p:[a,b,c,d],color:SOFFIT});
 // Una tira vertical (tapacán, fascia) bajo la línea p→q, de alto hh, del color de los marcos.
 const strip=(p,q,hh=.2)=>quad('marco',p,q,[q[0],q[1]-hh,q[2]],[p[0],p[1]-hh,p[2]],cTrim);
 const ridgeCol=shade(cRoof,.72);
 // El adorno del hastial (axis: el eje de su normal; at: el plano de la pared; out: hacia afuera), centrado en (cu, cy):
 // ojo de buey (un octógono con su vidrio y su cruz) o rejilla (un marco con cuatro tablillas).
 const GLASS='#33404b';
 const gableDeco=(axis,at,out,cu,cy,r)=>{const P=(u,v,k)=>axis==='x'?[at+out*k,v,u]:[u,v,at+out*k];
  if(s.hastial==='ojo'){const ri=r*.74,pt=(rr,i,k)=>{const a=(i+.5)/8*Math.PI*2;return P(cu+Math.cos(a)*rr,cy+Math.sin(a)*rr,k);};
   for(let i=0;i<8;i++){quad('marco',pt(r,i,.05),pt(r,i+1,.05),pt(ri,i+1,.05),pt(ri,i,.05),cTrim);quad('liso',P(cu,cy,.035),pt(ri,i,.035),pt(ri,i+1,.035),pt(ri,i+1,.035),GLASS);}
   const m=.025;quad('marco',P(cu-ri,cy-m,.055),P(cu+ri,cy-m,.055),P(cu+ri,cy+m,.055),P(cu-ri,cy+m,.055),cTrim);quad('marco',P(cu-m,cy-ri,.055),P(cu+m,cy-ri,.055),P(cu+m,cy+ri,.055),P(cu-m,cy+ri,.055),cTrim);}
  else if(s.hastial==='rejilla'){const w=r*1.5,h=r*1.1,f=.06,R=(u0,v0,u1,v1,k,c)=>quad(c==='g'?'liso':'marco',P(u0,v0,k),P(u1,v0,k),P(u1,v1,k),P(u0,v1,k),c==='g'?GLASS:cTrim);
   R(cu-w/2,cy-h/2,cu+w/2,cy+h/2,.03,'g');R(cu-w/2-f,cy+h/2,cu+w/2+f,cy+h/2+f,.05);R(cu-w/2-f,cy-h/2-f,cu+w/2+f,cy-h/2,.05);R(cu-w/2-f,cy-h/2,cu-w/2,cy+h/2,.05);R(cu+w/2,cy-h/2,cu+w/2+f,cy+h/2,.05);
   for(let i=1;i<=4;i++){const v=cy-h/2+h*i/5;R(cu-w/2,v-.035,cu+w/2,v+.02,.06);}}};
 // Canaleta a lo largo de un alero (de p a q, a la altura del alero y un poco afuera: dir) y bajantes en sus dos puntas,
 // pegadas a la pared (wall: dónde está la cara de la pared en ese eje), hasta yBot (si queda más abajo).
 const lum=h=>[1,3,5].reduce((t,i)=>t+parseInt(h.slice(i,i+2),16),0)/765,GUT=lum(cTrim)>.7?'#8e959a':shade(cTrim,.8);// chapa gris (o el marco, más oscuro)
 const gutter=(axis,at,dir,a0,a1,low,wall,yBot,downs=true)=>{if(!s.canaletas)return;const z0=at+dir*.02,z1=at+dir*.2,yy=low-.03;
  if(axis==='x')box('marco',a0,yy-.12,Math.min(z0,z1),a1,yy,Math.max(z0,z1),GUT,false);else box('marco',Math.min(z0,z1),yy-.12,a0,Math.max(z0,z1),yy,a1,GUT,false);
  if(!downs||yBot>yy-.6)return;const wf=wall+dir*.1;
  for(const a of [a0+.6,a1-.6]){const u0=a-.065,u1=a+.065;
   if(axis==='x'){box('marco',u0,yy-.22,Math.min(at+dir*.1,wf),u1,yy-.1,Math.max(at+dir*.1,wf),GUT,false);box('marco',u0,yBot,Math.min(wf,wf+dir*.1),u1,yy-.12,Math.max(wf,wf+dir*.1),GUT,false);}
   else{box('marco',Math.min(at+dir*.1,wf),yy-.22,u0,Math.max(at+dir*.1,wf),yy-.1,u1,GUT,false);box('marco',Math.min(wf,wf+dir*.1),yBot,u0,Math.max(wf,wf+dir*.1),yy-.12,u1,GUT,false);}}};
 const roof=(x0,z0,x1,z1,y,kind,ridge,chimney=false,frontBot=0,noGutter=null)=>{const e=EAVE,w=x1-x0,d=z1-z0;
  if(kind==='plano'){for(const [a,b,c,dd] of [[x0,z0,x1,z0+T],[x0,z1-T,x1,z1],[x0,z0,x0+T,z1],[x1-T,z0,x1,z1]])box(wallCat,a,y,b,c,y+.45,dd,cWall);
   box('techo',x0+T,y-.01,z0+T,x1-T,y+.08,z1-T,cRoof,false);box('marco',x0-.04,y+.45,z0-.04,x1+.04,y+.53,z1+.04,cTrim,false);return y+.53;}
  const th=.14,P=(x,yy,z)=>[x,yy,z];
  if(kind==='dos_aguas'){const alongX=ridge==='x',half=(alongX?d:w)/2,hR=half*pitch,low=y-e*pitch,hi=y+hR,eps=.01;
   if(alongX){const zm=(z0+z1)/2;
    for(const [za,zb] of [[z0-e,zm],[z1+e,zm]]){tiled(P(x0-e,low,za),P(x1+e,low,za),P(x1+e,hi,zb),P(x0-e,hi,zb));soffit(P(x0-e,low-th,za),P(x1+e,low-th,za),P(x1+e,hi-th,zb),P(x0-e,hi-th,zb));
     strip(P(x0-e,low+.05,za),P(x1+e,low+.05,za),.22);for(const x of [x0-e-.02,x1+e+.02])strip(P(x,low+.08,za),P(x,hi+.08,zb),.24);}
    for(const x of [x0+eps,x1-eps])quad(wallCat,P(x,y,z0),P(x,y,z1),P(x,hi-.05,zm),P(x,hi-.05,zm),cWall);
    box('techo',x0-e,hi-.02,zm-.12,x1+e,hi+.12,zm+.12,ridgeCol,false);
    if(hR>1)for(const [x,o] of [[x0,-1],[x1,1]])gableDeco('x',x,o,zm,y+hR*.42,Math.min(.38,hR*.22));
    gutter('x',z0-e,-1,x0-e,x1+e,low,z0,0);gutter('x',z1+e,1,x0-e,x1+e,low,z1,frontBot);}
   else{const xm=(x0+x1)/2;
    for(const [xa,xb] of [[x0-e,xm],[x1+e,xm]]){tiled(P(xa,low,z1+e),P(xa,low,z0-e),P(xb,hi,z0-e),P(xb,hi,z1+e));soffit(P(xa,low-th,z0-e),P(xa,low-th,z1+e),P(xb,hi-th,z1+e),P(xb,hi-th,z0-e));
     strip(P(xa,low+.05,z0-e),P(xa,low+.05,z1+e),.22);for(const z of [z0-e-.02,z1+e+.02])strip(P(xa,low+.08,z),P(xb,hi+.08,z),.24);}
    for(const z of [z0+eps,z1-eps])quad(wallCat,P(x0,y,z),P(x1,y,z),P(xm,hi-.05,z),P(xm,hi-.05,z),cWall);
    box('techo',xm-.12,hi-.02,z0-e,xm+.12,hi+.12,z1+e,ridgeCol,false);
    if(hR>1)for(const [z,o] of [[z0,-1],[z1,1]])gableDeco('z',z,o,xm,y+hR*.42,Math.min(.38,hR*.22));
    if(noGutter!=='x0')gutter('z',x0-e,-1,z0-e,z1+e,low,x0,0);if(noGutter!=='x1')gutter('z',x1+e,1,z0-e,z1+e,low,x1,0);}
   if(chimney){const cx=alongX?x0+w*.78:x0+w*.3,cz=alongX?z0+d*.3:z0+d*.78;box('zocalo',cx-.35,y,cz-.35,cx+.35,hi+.7,cz+.35,cBase);box('marco',cx-.42,hi+.7,cz-.42,cx+.42,hi+.82,cz+.42,'#5e5a55');}
   return hi;}
  // Cuatro aguas: cumbrera a lo largo del lado más largo (o punta, si es cuadrado).
  const alongX=w>=d,half=(alongX?d:w)/2,hR=half*pitch,low=y-e*pitch,hi=y+hR;
  const a=P(x0-e,low,z0-e),b=P(x1+e,low,z0-e),c=P(x1+e,low,z1+e),dd=P(x0-e,low,z1+e);
  const r0=alongX?P(x0+half,hi,(z0+z1)/2):P((x0+x1)/2,hi,z0+half),r1=alongX?P(x1-half,hi,(z0+z1)/2):P((x0+x1)/2,hi,z1-half);
  const faces=alongX?[[a,b,r1,r0],[c,dd,r0,r1],[dd,a,r0,r0],[b,c,r1,r1]]:[[b,c,r1,r0],[dd,a,r0,r1],[a,b,r0,r0],[c,dd,r1,r1]];
  for(const f of faces){tiled(...f);soffit(...f.map(p=>[p[0],p[1]-th,p[2]]));strip(V3.add(f[0],[0,.05,0]),V3.add(f[1],[0,.05,0]),.22);}
  gutter('x',z0-e,-1,x0-e,x1+e,low,z0,0);gutter('x',z1+e,1,x0-e,x1+e,low,z1,frontBot);gutter('z',x0-e,-1,z0-e,z1+e,low,x0,0,false);gutter('z',x1+e,1,z0-e,z1+e,low,x1,0,false);
  // Las limatesas y la cumbrera, con su caballete.
  const cap=(p,q)=>{const sd=V3.mul(norm(V3.cross(V3.sub(q,p),[0,1,0])),.12),up=[0,.09,0],pt=V3.add(p,up),qt=V3.add(q,up);
   quads.push({cat:'techo',p:[V3.add(p,sd),V3.add(q,sd),qt,pt],color:ridgeCol,one:false},{cat:'techo',p:[pt,qt,V3.sub(q,sd),V3.sub(p,sd)],color:ridgeCol,one:false});};
  for(const [p,q] of [[a,r0],[dd,r0],[b,r1],[c,r1],[r0,r1]])if(Math.hypot(...V3.sub(p,q))>.05)cap(p,q);
  if(chimney){const cx=x0+w*.75,cz=z0+d*.35;box('zocalo',cx-.35,y,cz-.35,cx+.35,hi+.5,cz+.35,cBase);box('marco',cx-.42,hi+.5,cz-.42,cx+.42,hi+.62,cz+.42,'#5e5a55');}
  return hi;};
 const kind=s.techo,mainTop=roof(0,0,W,Du,top,kind,'x',s.chimenea&&kind!=='plano',setback?H1:s.porche?(two?H1+.05:H1-.08):0);
 // Las vigas bajo el alero, a la vista: una franja de marco al pie de las paredes del techo.
 if(kind!=='plano'){box('marco',-.04,top-.3,-.04,W+.04,top-.18,0,cTrim,false);box('marco',-.04,top-.3,Du,W+.04,top-.18,Du+.04,cTrim,false);}

 // ---- Garaje ----
 if(gar){const {x0,x1,z0,z1}=gar,out=s.garaje==='izq'?-1:1,xo=out<0?x0+T/2:x1-T/2;
  box('zocalo',x0-.04,-.6,z0-.04,x1+.04,.05,z1+.04,cBase,false);box('liso',x0+T,.04,z0+T,x1-T,.06,z1-T,'#9a958c',false);floor(x0,z0,x1,z1,.05);
  const gw=GARAGE.door.w,gc=(x0+x1)/2;openings.push({kind:'garage',axis:'x',at:z1-T/2,out:1,c:gc,w:gw,y0:.05,h:GARAGE.door.h,color:cDoor});
  outer('x',z1-T/2,1,x0,x1,0,H1,[{c:gc,w:gw,y0:0,y1:.05+GARAGE.door.h}]);outer('x',z0+T/2,-1,x0,x1,0,H1,[]);
  outer('z',xo,out,z0+T,z1-T,0,H1,gar.d>=6?[win('z',xo,out,(z0+z1)/2,.05,'chica3')]:[]);
  box('marco',gc-gw/2-.12,.05+GARAGE.door.h,z1+.02,gc+gw/2+.12,.05+GARAGE.door.h+.16,z1+.1,cTrim,false);
  ceil(x0+T,z0+T,x1-T,z1-T,H1-.02);
  roof(x0,z0,x1,z1,H1,kind==='plano'?'plano':'dos_aguas','z',false,0,s.garaje==='izq'?'x1':'x0');
  rooms.push({x0:x0+T,x1:x1-T,z0:z0+T,z1:z1-T,y0:.05,y1:H1,garage:true});
  fur('Shelf_1',x0+T+.25,.05,z0+T+.25,0);fur('Trashcan_Small1',x1-T-.3,.05,z0+T+.2,0,false);}

 // ---- Porche, o el escalón de la puerta ----
 if(s.porche){const z1=D+PORCH_D,yTop=two?H1+.05:H1-.08,yLow=yTop-.45;
  box('madera',0,-.5,D,W,FLOOR0,z1,DECK,false);floor(0,D,W,z1,FLOOR0);
  for(let i=0;i<=s.ancho;i++){const x=Math.min(W-.12,Math.max(.12,i*MOD));box('marco',x-.09,FLOOR0,z1-.27,x+.09,yLow,z1-.09,cTrim);}
  tiled([-.15,yLow,z1+.2],[W+.15,yLow,z1+.2],[W+.15,yTop,D],[-.15,yTop,D]);soffit([-.15,yTop-.1,D],[W+.15,yTop-.1,D],[W+.15,yLow-.1,z1+.2],[-.15,yLow-.1,z1+.2]);strip([-.15,yLow+.05,z1+.2],[W+.15,yLow+.05,z1+.2],.18);
  // Baranda adelante y a los costados, con el paso frente a la puerta.
  const rail=(x0,z0,x1,z1)=>box('marco',x0,FLOOR0+.85,z0,x1,FLOOR0+.95,z1,cTrim);
  rail(0,D,.06,z1);rail(W-.06,D,W,z1);if(doorX-doorW/2-.6>.1)rail(.1,z1-.2,doorX-doorW/2-.6,z1-.14);if(doorX+doorW/2+.6<W-.1)rail(doorX+doorW/2+.6,z1-.2,W-.1,z1-.14);
  {const lx=doorX+doorW/2+.55,lz=D+.45,yr=yTop-(yTop-yLow)*(.45/2.2)-.1;box('marco',lx-.015,yr-.35,lz-.015,lx+.015,yr,lz+.015,LAMP_DARK,false);lantern(lx,yr-.35,lz);lights.push({x:lx,y:yr-.55,z:lz,porch:true});}}
 else{box('zocalo',doorX-doorW/2-.4,-.4,D,doorX+doorW/2+.4,FLOOR0,D+.8,cBase,false);floor(doorX-doorW/2-.4,D,doorX+doorW/2+.4,D+.8,FLOOR0);
  {const lx=doorX+doorW/2+.4,y=FLOOR0+2.25;box('marco',lx-.03,y-.04,D,lx+.03,y+.02,D+.2,LAMP_DARK,false);lantern(lx,y,D+.2);lights.push({x:lx,y:y-.2,z:D+.3,porch:true});}}
 // Esquineros.
 for(const [x,z] of [[0,0],[W,0],[0,D],[W,D]])box('marco',x-.1,0,z-.1,x+.1,z===D&&setback?H1:top,z+.1,cTrim,false);

 if(HG)hogarFurniture();else{
 // ---- Muebles ----
 keep(doorX-.8,D-T-1.8,doorX+.8,D-T,FLOOR0);// entrar por la puerta
 if(two){keep(sx0,stBot,sx1+.7,stBot+1.1,FLOOR0);keep(sx1,T,sx1+1.1,stTop+.2,H1);}// el pie de la escalera y la puerta del descanso
 if(bath)keep((bath.x0+bath.x1)/2-.6,bath.z1,(bath.x0+bath.x1)/2+.6,bath.z1+1.1,FLOOR0);
 if(gar){const xw=s.garaje==='izq'?T:W-T;keep(xw-1.1,D-T-1.2,xw+1.1,D-T,FLOOR0);}
 if(two&&roomsUp[1]){const xm=roomsUp[1].x0;keep(xm-1.1,Du-T-1.4,xm+1.1,Du-T,H1);}
 if(setback)keep((s.ancho-1)*MOD+MOD/2-.8,Du-T-1.4,(s.ancho-1)*MOD+MOD/2+.8,Du-T,H1);
 // Planta baja: cocina contra la pared de atrás (de derecha a izquierda, hasta la escalera o la pared), la mesa con
 // dos sillas sobre una alfombra, el sofá contra la pared derecha y una planta junto a la puerta.
 const kEnd=bath?bath.x0-TI-.02:W-T-.02,kStart=two?sx1+.35:T+(two?0:1.8);
 {let kx=kEnd;for(const [m,w] of [['Kitchen_Fridge',.67],['Kitchen_Sink',.53],['Kitchen_Oven',.53],['Kitchen_2Drawers',.53],['Kitchen_Cabinet1',.53],['Kitchen_2Drawers',.53]]){if(kx-w<kStart)break;fur(m,kx-w/2,FLOOR0,T+.32,0);if(m==='Kitchen_Oven'){fur('F_CookingPot_Soup',kx-w/2-.1,FLOOR0+.84,T+.3,0,false);fur('F_FryingPan',kx-w/2+.13,FLOOR0+.84,T+.36,.5,false);}kx-=w;}}// (en la estufa, una olla y una sartén)
 const tx=two?(sx1+W-T)/2:W/2+.4,tz=Math.min(D-T-1.6,T+2.6);
 {const alts=[[tx-1,tz],[tx+1,tz],[tx,tz+1]];let k=-1;for(const [i,[ax,az]] of [[tx,tz],...alts].entries())if(free('Table_RoundSmall',ax,az,FLOOR0,0)&&free('Table_RoundSmall',ax-.8,az,FLOOR0,0)&&free('Table_RoundSmall',ax+.8,az,FLOOR0,0)){k=i;break;}
  if(k>=0){const [ax,az]=[[tx,tz],...alts][k];fur('Carpet_Round',ax,FLOOR0,az,0,false);fur('Table_RoundSmall',ax,FLOOR0,az,0);deco('florero',{variante:['rojas','amarillas','lilas'][Math.floor(hs('f')*3)],paleta:Math.floor(hs('g')*3)},ax,FLOOR0+.6,az,0);fur('C2_ChairCushioned',ax-.8,FLOOR0,az,Math.PI/2,false);fur('C2_ChairCushioned',ax+.8,FLOOR0,az,-Math.PI/2,false);}}
 fur('Light_Ceiling3',tx,(two?H1-.2:H1-.04),tz,0,false);lights.push({x:tx,y:(two?H1-.6:H1-.45),z:tz});bulb(tx,(two?H1-.5:H1-.34),tz);
 // La sala (Casa2): el sofá contra una pared, la mesa de centro delante y una lámpara de pie al lado. Primero contra la
 // pared derecha (donde iba siempre); si ahí no cabe (en las casitas con garaje, el baño y el paso del garaje se comen
 // esa pared), se recorre la pared derecha entera, después la del frente (el sofá es más bajo que el antepecho) y, en
 // las de una planta, la izquierda; y el doble, si no entra en ningún lado, deja lugar al individual.
 if(W-T-tx>2){const big=s.ancho>=4,zMin=bath?bath.z1+1.3:T+1.4,len=big?1.2:.6,xs=W-T-.5,zf=D-T-.5,R=-Math.PI/2;
  const scan=(a,b)=>{const out=[];for(let v=a;a<b?v<=b:v>=b;v+=a<b?.1:-.1)out.push(+v.toFixed(2));return out;};
  // (la pared derecha, sólo hasta el tabique del baño)
  // [x, z, giro]: el giro dice hacia dónde mira el sofá (−π/2: hacia −x; π: hacia atrás; π/2: hacia +x)
  const spots=l=>[[xs,Math.max(zMin,D-T-1.4),R],[xs,Math.max(zMin,D-T-1.4-l-1.2),R],[xs,zMin,R],
   ...scan(D-T-1,bath?bath.z1+TI+.6:T+.6).map(z=>[xs,z,R]),...scan(W-T-1,T+1).map(x=>[x,zf,Math.PI]),...(two?[]:scan(D-T-1,T+.6).map(z=>[T+.5,z,Math.PI/2]))];
  let so=null;for(const m of big?['C2_SofaDouble','C2_Sofa']:['C2_Sofa']){for(const [x,z,r] of spots(m==='C2_Sofa'?.6:len))if((so=fur(m,x,FLOOR0,z,r)))break;if(so)break;}
  if(so){const hl=FURN_SIZE[so.m][0]/2;// la mesa, delante: hacia (sin giro, cos giro)
   const ct=fur('C2_CoffeeTable',so.x+Math.sin(so.rot)*1.3,FLOOR0,so.z+Math.cos(so.rot)*1.3,so.rot);if(ct)deco('florero',{variante:['lilas','rojas','amarillas'][Math.floor(hs('h')*3)],paleta:Math.floor(hs('i')*3)+1},ct.x,FLOOR0+.39,ct.z,0);// (con paso para sentarse)
   // la lámpara a un costado, contra la misma pared (el que esté libre)
   const sx=Math.cos(so.rot),sz=-Math.sin(so.rot),bx=so.x-Math.sin(so.rot)*.25,bz=so.z-Math.cos(so.rot)*.25;
   fur('C2_Lamp',bx+sx*(hl+.25),FLOOR0,bz+sz*(hl+.25),0,true,[[bx-sx*(hl+.25),bz-sz*(hl+.25)]]);
   // la alfombra entre el sofá y la mesa de centro, y un cuadro en la pared de atrás del sofá
   rug(so.x+Math.sin(so.rot)*.85,FLOOR0,so.z+Math.cos(so.rot)*.85,so.rot,Math.max(1.6,hl*2+.4),1.5,'sala');
   const fx=Math.round(Math.sin(so.rot)),fz=Math.round(Math.cos(so.rot)),wx=fx<0?W-T:fx>0?T:so.x,wz=fz<0?D-T:fz>0?T:so.z;
   art(wx,FLOOR0+1.25,wz,so.rot,fx?'z':'x',fx<0?W-T/2:fx>0?T/2:fz<0?D-T/2:T/2,FLOOR0,'sala');}}
 fur('Houseplant_8',doorX+doorW/2+.35,FLOOR0,D-T-.3,0,false);
 if(bath){fur('Bathroom_Shower1',bath.x1-.5,FLOOR0,bath.z0+.5,0);fur('Bathroom_Toilet',bath.x0+.45,FLOOR0,bath.z0+.45,0);fur('Bathroom_Sink',bath.x1-.24,FLOOR0,bath.z1-.55,-Math.PI/2);
  // el espejo con su repisa sobre el lavamanos, si ahí no hay una ventana
  {const z=bath.z1-.55;if(!openings.some(o=>o.axis==='z'&&Math.abs(o.at-(W-T/2))<.25&&Math.abs(o.c-z)<o.w/2+.42&&o.y0<FLOOR0+1.9))deco('espejo',{w:.6},W-T,FLOOR0+1.0,z,-Math.PI/2);}
  // el reloj en el tabique del baño, del lado de la sala (lejos de la puerta)
  deco('reloj',{paleta:Math.floor(hs('k')*3)},bath.x0+.35,FLOOR0+1.95,bath.z1+TI,0);}
 if(!two){// una sola planta: la cama al fondo a la izquierda
  fur('C2_Bed',T+.85,FLOOR0,T+1.15,0);fur('NightStand_1',T+1.85,FLOOR0,T+.3,0);fur('C2_Lamp',T+.25,FLOOR0,T+2.5,0,false);
  art(T+.85,FLOOR0+1.15,T,0,'x',T/2,FLOOR0,'cama');rug(T+.85,FLOOR0,T+2.75,0,1.6,1.0,'cama');}// (sobre la cabecera y al pie de la cama)
 else{// arriba: el dormitorio grande y, si hay, el chico
  // (Casa2: la cama doble, el armario contra el tabique del pasillo y la cómoda al frente, si no tapa una ventana)
  const A=roomsUp[0],ax=(A.x0+A.x1)/2;{const spots=[[ax,T+1.15],[ax+.4,T+1.15],[ax+.7,T+1.15],[ax-.4,T+1.15]],at=spots.find(([x,z])=>free('C2_Bed',x,z,H1,0))||spots.find(([x,z])=>free('C2_Bed',x,z,H1,0,false));if(at){const [bx]=at;fur('C2_Bed',bx,H1,T+1.15,0);fur('NightStand_1',bx+.95,H1,T+.3,0);fur('NightStand_1',bx-.95,H1,T+.3,0);art(bx,H1+1.15,T,0,'x',T/2,H1,'cama');rug(bx,H1,T+2.75,0,1.8,1.1,'cama');}}// (sobre la cabecera y al pie)
  fur('C2_Closet',A.x0+.25,H1,Du-T-.7,Math.PI/2,true,[[A.x0+.25,Du-T-1.7],[A.x0+.25,T+2.6]]);
  if(Du-T-.3>T+3.3){const winAt=c=>Array.from({length:s.ancho},(_,i)=>i*MOD+MOD/2).some(w=>Math.abs(w-c)<.45+WINDOWS[s.ventanaArriba].w/2+.05);
   const cx=[ax,ax-1.3,ax+1.3,ax-.8,ax+.8].find(c=>c-.5>A.x0&&c+.5<A.x1&&!winAt(c)&&free('C2_Closet2',c,Du-T-.33,H1,Math.PI));
   if(cx!=null)fur('C2_Closet2',cx,H1,Du-T-.33,Math.PI);else fur('Drawer_1',ax,H1,Du-T-.32,Math.PI);}fur('Light_Ceiling1',ax,H2-.02,(T+Du-T)/2,0,false);lights.push({x:ax,y:H2-.45,z:Du/2});bulb(ax,H2-.42,(T+Du-T)/2);
  const B=roomsUp[1];if(B){const bx=(B.x0+B.x1)/2;fur('Bed_Single',bx,H1,T+1.1,0);fur('C2_BookCaseBooks',B.x1-.3,H1,T+2.6,-Math.PI/2);fur('C2_Closet',B.x0+.25,H1,T+2.6,Math.PI/2,true,[[B.x0+.25,T+3.5]]);fur('Houseplant_3',B.x0+.3,H1,T+.3,0,false);fur('Light_Ceiling1',bx,H2-.02,Du/2,0,false);}
  fur('Houseplant_1',sx0+.3,H1,T+.3,0,false);}
}
 // ---- Cortinas (2026-10-12): en cada ventana, del lado de adentro, menos en el baño; si un tabique llega a la ventana,
 // no van (los paños tocarían el tabique) ----
 {const tone=['crema','azul','verde','terracota'][Math.floor(hs('t')*4)],parts=boxes.filter(b=>b.cat==='interior'&&Math.min(b.x1-b.x0,b.z1-b.z0)<.065);
  for(const o of openings){if(o.kind!=='window'||o.h<.7)continue;const ax=o.axis==='x',face=o.at-o.out*T/2,ry=ax?(o.out>0?Math.PI:0):(o.out>0?-Math.PI/2:Math.PI/2);
   const x=ax?o.c:face,z=ax?face:o.c;if(bath&&x>bath.x0-.05&&z<bath.z1+.05&&o.y0<H1)continue;
   const list=partsBoxes(OBJETOS.cortina.piezas({w:o.w,h:o.y0+o.h+.14,bajo:Math.max(o.y0-.3,(o.y0>H1?H1:FLOOR0)+.08),variante:tone,cerrada:o.tela||null}),{x,y:0,z,ry});
   if(list.some(c=>parts.some(b=>c.x0<b.x1&&c.x1>b.x0&&c.z0<b.z1&&c.z1>b.z0&&c.y0<b.y1&&c.y1>b.y0)))continue;
   for(const b of list)box('liso',b.x0,b.y0,b.z0,b.x1,b.y1,b.z1,b.color,false);}}

 // ---- Sin caras que titilen (2026-10-16): dos cajas de distinto color con una cara en el mismo plano se alternan al
 // mover la cámara; la de la más chica se retira 3 mm (engine/titileo.js) ----
 for(const b of boxes)b.mat=b.color||b.cat;sinTitilar(boxes);for(const b of boxes)delete b.mat;
 // ---- Centrar: el origen va al centro de la huella entera ----
 const hx0=gar?Math.min(0,gar.x0):0,hx1=gar?Math.max(W,gar.x1):W,hz1=D+(s.porche?PORCH_D:.8),ox=(hx0+hx1)/2,oz=hz1/2;
 const sh=o=>{for(const k of ['x0','x1','x','zLow','zHigh','z0','z1','z'])if(o[k]!=null)o[k]=k.startsWith('x')?o[k]-ox:o[k]-oz;return o;};
 boxes.forEach(sh);floors.forEach(sh);ramps.forEach(sh);furniture.forEach(sh);rooms.forEach(sh);lights.forEach(sh);solids.forEach(sh);pisables.forEach(sh);bedSpots.forEach(b=>{sh(b);b.sides?.forEach(sh);});seatSpots.forEach(sh);
 for(const q of quads)q.p=q.p.map(([x,y,z])=>[x-ox,y,z-oz]);
 for(const o of openings){if(o.axis==='x'){o.at-=oz;o.c-=ox;}else{o.at-=ox;o.c-=oz;}}
 // (ox, oz: el centrado —el plano de hogar.js está en u, v: x = u − ox, z = D − v − oz—; H1, FLOOR0: los pisos. Para las
 // acciones del jugador, que pasan los usos del plano a la casa)
 return {spec:s,w:hx1-hx0,d:hz1,h:mainTop,W,D,ox,oz,H1,FLOOR0,front:{x:doorX-ox,z:D-oz},boxes,quads,floors,ramps,openings,furniture,rooms,lights,solids,pisables,bedSpots,seatSpots,
  // la caja de la casa sin porche ni escalón (para no plantar árboles encima)
  body:{x0:hx0-ox,x1:hx1-ox,z0:-oz,z1:D-oz}};
}
