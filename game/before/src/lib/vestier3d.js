// El vestier (2026-10-13): la ropa ES el cuerpo. No hay prendas encima de la piel: cada triángulo de la piel pasa a ser
// de la prenda de más afuera que lo cubre, se infla un poco por la normal suave (la holgura de esa prenda) y, donde dos
// holguras se encuentran (un ruedo, un puño, el borde de un chaleco), un escalón cierra la rendija. Así no queda piel
// debajo que se asome, las capas no se cruzan entre sí y la prenda hereda los pesos y la contextura del cuerpo.
// Los bordes salen de planos fijos en la pose de atado (pose T): cuello, cintura, mangas, ruedos. Lo que cuelga o
// sobresale del cuerpo (faldas, capuchas, cuellos levantados) queda para piezas sueltas, más adelante.
import * as THREE from 'three';
import {makePersona2,lowGeo} from './persona3d.js';
import {armContactProfile,installArmContact} from './armContact3d.js';
import {COLORS,CUERPO_UNICO} from '../engine/vestuario.js';
import {loadHair} from './pelosIA.js';
import {newSkin,shrinkSkin,projectDecal,followDisplacement} from './cuerpoIA.js';

// ---------- Medidas de la pose de atado (iguales en las cinco contexturas: sólo cambia la piel) ----------
// Hombro x .32 · codo x .85 · muñeca x 1.27 · cadera y 1.0 · rodilla y .55 · pie y .02 · cuello y 2.03.
// Los ruedos de arriba van sobre el pliegue entrepierna-panza (y 1.0–1.05 en la línea media: casi horizontal, un plano
// ahí lo corta en zigzag, sobre todo en el gordo) y no bajan de la entrepierna: debajo, la tela colgaría entre las
// piernas y como cuerpo sólo puede vestir cada muslo por separado. Lo más largo, en piezas sueltas.
export const CUT={neck:1.99,neckFront:1.93,scoop:1.86,waist:1.13,hemTee:1.09,hemLong:1.07,hemJacket:1.07,skirtTop:1.04,crotch:.82,boxer:.8,shorts:.7,bermuda:.5,capri:.32,ankle:.14,shoe:.17,sole:.04,
 sleeveless:.31,sleeveShort:.56,sleeveElbow:.8,sleeveLong:1.19};
const abs=Math.abs,HAIR_TUCK_Y=2.02,inHood=(x,z)=>Math.atan2(abs(x),z+.02)>1.0;
// El borde del cuello: a la altura del cuello en el centro y subiendo hacia los hombros (en la pose T, la cara de arriba
// del hombro y del brazo pasa la altura del cuello y es de la prenda).
// (2026-10-14) Antes era un plano que subía hacia los hombros con pendiente .7: en el robusto y el gordo el trapecio tiene
// casi esa pendiente, el plano corría paralelo a la piel y el escote salía en zigzag. Ahora, adelante y atrás, la altura
// del cuello (un plano horizontal cruza bien el pecho y la espalda); a los costados, un anillo alrededor del cuello
// (radio NECK_R), que cruza el trapecio de través. Entre los dos, una mezcla según el ángulo. Más que CUT.neck = afuera.
// (sobre la base del cuello vuelve a ser la altura: el anillo no debe rebanar la mandíbula ni la cabeza)
const NECK_R=.21,neckF=p=>{const x=p[0],z=p[2],r=Math.hypot(x,z),w=x*x/(x*x+z*z+1e-9)*(1-ss(p[1],2.06,2.14));return w*(CUT.neck-(r-NECK_R))+(1-w)*p[1];};
// (para oscurecer, relativo a la luminosidad: en un café oscuro, −0,1 fijo lo dejaba negro)
const shade=(hex,k)=>{const c=new THREE.Color(hex),hsl={};c.getHSL(hsl);const d=k<0?k*Math.min(1,hsl.l/.5):k;return '#'+new THREE.Color().setHSL(hsl.h,hsl.s,THREE.MathUtils.clamp(hsl.l+d,0,1)).getHexString();};

// Un corte: plano f(p) = k, sólo en los triángulos de esas clases (un plano horizontal no rebana los brazos en pose T).
// Las juntas en T que deja en el borde de la clase no abren rendija: la normal suave viaja interpolada con el vértice.
// (where: el corte sólo parte los triángulos cuyo centro cumple —un botón, un bolsillo—; no pega vértices, porque
// moverlos dentro de la zona y no fuera abriría rendijas)
const plane=(f,k,on,where)=>({f,k,on,where});
const atY=(k,on=['torso','leg'])=>plane(p=>p[1],k,on);
const atArm=k=>plane(p=>abs(p[0]),k,['arm','hand']);
// t = {c: centro (Vector3), n: normal, cls: clase del triángulo}
const inY=(t,lo,hi)=>t.c.y>=lo&&t.c.y<=hi;
const front=t=>t.c.z>0&&t.n.z>-.2;

// ---------- El catálogo ----------
// layer: quién gana donde dos prendas se pisan (más alto = más afuera). gap: la holgura, en unidades del modelo (≈ 0,54 m).
// covers(t): si la prenda tapa ese triángulo. paint(t, color): otro color para un detalle (ribete, botonadura, bolsillo).
// La sisa de lo que no tiene mangas: un corte que baja por el costado hasta la axila (y 1.72) y ahí se abre hacia afuera,
// para no rebanar los flancos del gordo. Sin él, la prenda termina donde la piel deja de ser tronco y sale en dientes.
const ARMHOLE=.34,armholeF=p=>abs(p[0])-4*Math.max(0,1.72-p[1]);
const atArmhole=()=>plane(armholeF,ARMHOLE,['torso','arm']);
const topCover=(hem,sleeve,{open=null,neck=CUT.neck,armless=false}={})=>t=>{
 // (y lo que el muslo comparte con el tronco por encima del ruedo: en el gordo y el robusto, la panza baja y el costado
 // de la cadera los mueve más el muslo; sin ellos el ruedo sale en escalera entre camisa y pantalón)
 if(t.cls!=='torso'&&t.cls!=='arm'&&!(t.cls==='leg'&&t.trunk>.04))return false;if(armless?(t.cls==='arm'||t.cls==='torso')&&armholeF(t.c.toArray())>ARMHOLE:t.cls==='arm'&&abs(t.c.x)>sleeve)return false;
 if(t.c.y<hem||(t.cls==='torso'||t.cls==='arm')&&neckF(t.c.toArray())>neck)return false;if(open&&open(t))return false;return true;};
// (tronco o muslo bajo la panza: la franja del ruedo pinta los dos, o sale en dientes)
const trunkish=t=>t.cls==='torso'||t.cls==='leg';
const collar=(t,band)=>(t.cls==='torso'||t.cls==='arm')&&neckF(t.c.toArray())>CUT.neck-band;
// (también el brazo: en el robusto y el gordo, unos triángulos del hombro junto al cuello los mueve el brazo; sin
// partirlos, el escote salía con dientes)
const atNeck=(d=0)=>plane(neckF,CUT.neck-d,['torso','head','arm']);
// (lo que mueve el muslo es del pantalón a cualquier altura: en la cadera del gordo sube por encima de la cintura)
const bottomCover=(hem,waist=CUT.waist)=>t=>t.cls==='leg'?t.c.y>=hem:t.cls==='torso'&&inY(t,hem,waist);
// (la parte alta del muslo también, con color de forro: sentada, lo que queda arriba del muslo se lee como la falda)
const skirtCover=t=>t.cls==='leg'?t.c.y>=CUT.crotch:t.cls==='torso'&&inY(t,CUT.crotch,CUT.waist);
const skirtLining=(t,c)=>t.c.y<CUT.skirtTop?'#'+new THREE.Color(c).multiplyScalar(.6).getHexString():null;
const cuffs=(sleeve,band)=>t=>t.cls==='arm'&&abs(t.c.x)>sleeve-band;
// Bandas con grosor (2026-10-14, de las sugerencias de la IA de imagen como director de arte): ruedos, puños, pretinas,
// botamangas y suelas no son sólo una franja pintada: van un poco más afuera que la prenda, y el escalón que se arma en
// su borde se lee como el doblez o el ribete. rim(holgura, extra, ...pruebas) → gapOf.
const rim=(gap,extra,...tests)=>t=>tests.some(f=>f(t))?gap+extra:gap;
const onPlacket=c=>abs(c[0])<.06&&c[2]>0;
// Un parche en el frente (botón, bolsillo, hebilla): cortes locales que sólo parten esa zona, y la prueba de si un
// triángulo está adentro. x0..x1 en |x| (los dos lados) o, con side, sólo de ese lado.
const patch=(x0,x1,y0,y1,{on=['torso','leg'],side=0}={})=>{const X=c=>side?c[0]*side:abs(c[0]),near=c=>c[2]>0&&X(c)>x0-.04&&X(c)<x1+.04&&c[1]>y0-.04&&c[1]<y1+.04;
 const fx=side?(p=>p[0]*side):(p=>abs(p[0]));
 return {cuts:[plane(fx,x0,on,near),plane(fx,x1,on,near),plane(p=>p[1],y0,on,near),plane(p=>p[1],y1,on,near)],
  in:t=>t.c.z>0&&t.n.z>-.2&&(side?t.c.x*side:abs(t.c.x))>x0&&(side?t.c.x*side:abs(t.c.x))<x1&&t.c.y>y0&&t.c.y<y1};};
// (los botones del abrigo, del lado izquierdo del muñeco, junto al borde de la abertura; los bolsillos de la chaqueta;
// la hebilla del cinturón)
const POLO_BUTTONS=[1.78,1.86].map(y=>patch(0,.02,y-.018,y+.018,{on:['torso']}));
const COAT_BUTTONS=[1.2,1.32,1.44].map(y=>patch(.1,.14,y-.02,y+.02,{side:1,on:['torso']}));
const JACKET_POCKETS=patch(.13,.25,1.17,1.29,{on:['torso']}),BUCKLE=patch(0,.035,CUT.waist-.05,CUT.waist+.003,{on:['torso']});
const BIB=c=>abs(c[0])<.32;
const STRIPES=[1.2,1.32,1.44,1.56,1.68,1.8];
const VEST_BUTTONS=[1.17,1.27,1.37],vestV=p=>abs(p[0])-.42*Math.max(0,p[1]-1.43);
const hemBand=(hem,band)=>t=>trunkish(t)&&t.c.y<hem+band;
const legBand=(lo,hi)=>t=>t.cls==='leg'&&inY(t,lo,hi);

// (el borde del gorro: sobre las cejas adelante, sobre las orejas a los costados, en la nuca atrás)
const beanieF=p=>{const u=Math.max(-1,Math.min(1,p[2]/.49));const S=THREE.MathUtils.smoothstep;return p[1]-(2.82+.06*S(u,.3,.9)-.2*S(-u,.2,.95));};
// (el borde de la gorra: más alto que el gorro de lana, sobre la frente adelante y sobre la nuca atrás)
const capF=p=>{const S=THREE.MathUtils.smoothstep,u=Math.max(-1,Math.min(1,p[2]/.49));return p[1]-(2.86+.04*S(u,.3,.9)-.16*S(-u,.2,.95));};
// La visera: medio óvalo plano que sale de la frente de la gorra, apenas inclinado hacia abajo, de dos caras. La lleva la
// cabeza.
function visor({tris,bones,color,gapScale},{reach=.4,half=.34,gap=.07,steps=8}={}){
 const Hd=bones.findIndex(b=>b.name==='Head');if(Hd<0)return [];let zf=0,yb=2.88;
 for(const q of tris)if(q.cls==='head')for(const v of q.v)if(abs(v.p[0])<.08&&abs(v.p[1]-yb)<.05)zf=Math.max(zf,v.p[2]);
 const c=new THREE.Color(color).multiplyScalar(.9),under=new THREE.Color(color).multiplyScalar(.6),out=[],V=(p,col)=>({p,n:[0,0,0],m:[0,0,0],j:[Hd,0,0,0],w:[1,0,0,0],col:[col.r,col.g,col.b]});
 const base=[],rim=[];for(let i=0;i<=steps;i++){const a=-Math.PI/2+Math.PI*i/steps,x=Math.sin(a)*half,zb=zf+gap*gapScale-.02-.3*(1-Math.cos(a))**1.5;
  base.push([x,yb,zb]);rim.push([x*1.15,yb-.1*Math.cos(a),zb+reach*Math.cos(a)]);}
 for(let i=0;i<steps;i++){const a=base[i],b=base[i+1],cc=rim[i+1],d=rim[i];
  out.push([V(a,c),V(d,c),V(cc,c)],[V(a,c),V(cc,c),V(b,c)]);
  const lo=p=>[p[0],p[1]-.04,p[2]];out.push([V(lo(a),under),V(lo(cc),under),V(lo(d),under)],[V(lo(a),under),V(lo(b),under),V(lo(cc),under)]);
  out.push([V(d,c),V(lo(d),c),V(lo(cc),c)],[V(d,c),V(lo(cc),c),V(cc,c)]);}
 return out;}
export const GARMENTS=[
 // Interior
 {id:'boxer',label:'Bóxer',slot:'underwear',layer:1,gap:.005,color:'#343d50',covers:bottomCover(CUT.boxer,1.1),cuts:[atY(CUT.boxer),atY(1.1)],
  paint:(t,c)=>t.c.y>1.06?shade(c,-.08):null,cutsExtra:[atY(1.06)]},
 // Arriba
 {id:'camiseta',label:'Camiseta',slot:'top',layer:3,gap:.024,color:'#7fb2d6',covers:topCover(CUT.hemTee,CUT.sleeveShort,{neck:CUT.neck}),
  cuts:[atY(CUT.hemTee),atY(CUT.waist),atNeck(),atNeck(.03),atArm(CUT.sleeveShort),atArm(CUT.sleeveShort-.045)],
  gapOf:rim(.024,.018,cuffs(CUT.sleeveShort,.045),hemBand(CUT.hemTee,CUT.waist-CUT.hemTee)),
  paint:(t,c)=>cuffs(CUT.sleeveShort,.045)(t)||hemBand(CUT.hemTee,CUT.waist-CUT.hemTee)(t)||collar(t,.03)?shade(c,-.05):null},
 // (las rayas, con cortes horizontales que pasan también por las mangas en pose T: en el brazo el plano corta el largo)
 {id:'rayas',label:'Camiseta a rayas',slot:'top',layer:3,gap:.024,color:'#f2f0ea',covers:topCover(CUT.hemTee,CUT.sleeveShort,{neck:CUT.neck}),
  cuts:[atY(CUT.hemTee),atNeck(),atArm(CUT.sleeveShort),...STRIPES.flatMap(y=>[atY(y,['torso']),atY(y+.045,['torso'])])],
  paint:(t,c)=>t.cls==='torso'&&STRIPES.some(y=>inY(t,y,y+.045))?'#2b3d5c':null},
 {id:'manga-larga',label:'Manga larga',slot:'top',layer:3,gap:.024,color:'#c4553d',covers:topCover(CUT.hemTee,CUT.sleeveLong),
  cuts:[atY(CUT.hemTee),atY(CUT.waist),atNeck(),atNeck(.035),atArm(CUT.sleeveLong),atArm(CUT.sleeveLong-.07)],gapOf:rim(.024,.016,cuffs(CUT.sleeveLong,.07),hemBand(CUT.hemTee,CUT.waist-CUT.hemTee)),
  paint:(t,c)=>cuffs(CUT.sleeveLong,.07)(t)||hemBand(CUT.hemTee,CUT.waist-CUT.hemTee)(t)||collar(t,.035)?shade(c,-.07):null},
 {id:'sin-mangas',label:'Sin mangas',slot:'top',layer:3,gap:.022,color:'#f2f0ea',covers:topCover(CUT.hemTee,0,{armless:true,neck:Infinity,open:t=>t.c.y>CUT.scoop&&abs(t.c.x)<.18&&(front(t)||t.c.y>CUT.scoop+.08)}),
  cuts:[atY(CUT.hemTee),atY(CUT.scoop),atY(CUT.scoop+.08),plane(p=>abs(p[0]),.18,['torso']),atArmhole(),plane(armholeF,ARMHOLE-.03,['torso','arm']),plane(p=>abs(p[0]),.21,['torso'])],
  // (ribete: la sisa y el borde de los tirantes, un poco más afuera y más oscuros)
  gapOf:rim(.022,.01,t=>armholeF(t.c.toArray())>ARMHOLE-.03,t=>t.c.y>CUT.scoop&&abs(t.c.x)<.21),
  paint:(t,c)=>armholeF(t.c.toArray())>ARMHOLE-.03||t.c.y>CUT.scoop&&abs(t.c.x)<.21?shade(c,-.06):null},
 {id:'polo',label:'Polo',slot:'top',layer:3,tuck:true,gap:.026,color:'#4f8a55',covers:topCover(CUT.hemTee,CUT.sleeveShort),gapOf:rim(.026,.012,cuffs(CUT.sleeveShort,.05),t=>collar(t,.05)),
  cuts:[atY(CUT.hemTee),atNeck(),atNeck(.05),atY(1.72),plane(p=>abs(p[0]),.035,['torso']),atArm(CUT.sleeveShort),atArm(CUT.sleeveShort-.05)],
  cutsExtra:POLO_BUTTONS.flatMap(b=>b.cuts),
  paint:(t,c)=>POLO_BUTTONS.some(b=>b.in(t))?'#f2f0ea':collar(t,.05)||cuffs(CUT.sleeveShort,.05)(t)?shade(c,-.1):t.cls==='torso'&&front(t)&&abs(t.c.x)<.035&&t.c.y>1.72?shade(c,-.05):null},
 {id:'camisa',label:'Camisa de botones',slot:'top',layer:3,tuck:true,gap:.028,color:'#f2f0ea',covers:topCover(CUT.hemLong,CUT.sleeveLong,{neck:CUT.neck}),gapOf:rim(.028,.014,cuffs(CUT.sleeveLong,.06),t=>collar(t,.06)),
  cuts:[atY(CUT.hemLong),atNeck(),atNeck(.06),plane(p=>abs(p[0]),.03,['torso','leg']),atArm(CUT.sleeveLong),atArm(CUT.sleeveLong-.06)],
  paint:(t,c)=>collar(t,.06)||cuffs(CUT.sleeveLong,.06)(t)?shade(c,-.06):trunkish(t)&&front(t)&&abs(t.c.x)<.03?shade(c,-.12):null,
  build:ctx=>collarPoints(ctx)},
 {id:'sudadera',label:'Sudadera',slot:'top',layer:3,gap:.042,color:'#8a8e90',covers:topCover(CUT.hemLong,CUT.sleeveLong),gapOf:rim(.042,.016,cuffs(CUT.sleeveLong,.08),hemBand(CUT.hemLong,.07),t=>t.cls==='torso'&&front(t)&&abs(t.c.x)<.2&&inY(t,1.17,1.37)),
  cuts:[atY(CUT.hemLong),atY(CUT.hemLong+.07),atNeck(),atNeck(.04),atArm(CUT.sleeveLong),atArm(CUT.sleeveLong-.08),atY(1.17),atY(1.37),plane(p=>abs(p[0]),.2,['torso'])],
  paint:(t,c)=>trunkish(t)&&t.c.y<CUT.hemLong+.07||collar(t,.04)||cuffs(CUT.sleeveLong,.08)(t)?shade(c,-.08):t.cls==='torso'&&front(t)&&abs(t.c.x)<.2&&inY(t,1.17,1.37)?shade(c,-.07):null},
 {id:'sudadera-capucha',label:'Sudadera con capucha',slot:'top',layer:3,gap:.042,color:'#6b4a8a',covers:topCover(CUT.hemLong,CUT.sleeveLong),gapOf:rim(.042,.016,cuffs(CUT.sleeveLong,.08),hemBand(CUT.hemLong,.07),t=>t.cls==='torso'&&front(t)&&abs(t.c.x)<.2&&inY(t,1.17,1.37)),
  cuts:[atY(CUT.hemLong),atY(CUT.hemLong+.07),atNeck(),atArm(CUT.sleeveLong),atArm(CUT.sleeveLong-.08),atY(1.17),atY(1.37),plane(p=>abs(p[0]),.2,['torso']),
   atY(1.7),plane(p=>abs(p[0]),.045,['torso']),plane(p=>abs(p[0]),.07,['torso'])],
  paint:(t,c)=>trunkish(t)&&t.c.y<CUT.hemLong+.07||cuffs(CUT.sleeveLong,.08)(t)?shade(c,-.08):t.cls==='torso'&&front(t)&&abs(t.c.x)<.2&&inY(t,1.17,1.37)?shade(c,-.07):
   t.cls==='torso'&&front(t)&&abs(t.c.x)>.045&&abs(t.c.x)<.07&&t.c.y>1.7?'#ecebe6':null,
  build:ctx=>hoodDown(ctx),tuckHair:true},
 // El vestido: arriba con tirantes (sin mangas, escote adelante y atrás entre los tirantes) y abajo la falda del mismo tubo; tapa la entrepierna
 // como la falda. Va en «Arriba»: con pantalón debajo, se ve el pantalón bajo el ruedo.
 {id:'vestido',label:'Vestido',slot:'top',layer:3,gap:.022,color:'#c4553d',
  covers:t=>skirtCover(t)||topCover(CUT.skirtTop,0,{armless:true,neck:Infinity,open:t=>t.c.y>CUT.scoop-.06&&abs(t.c.x)<.19&&(front(t)||t.c.y>CUT.scoop+.04)})(t),
  cuts:[atY(CUT.skirtTop),atY(CUT.crotch),atY(CUT.waist),atY(CUT.scoop-.06),atY(CUT.scoop+.04),plane(p=>abs(p[0]),.19,['torso']),atY(1.36),atY(1.42),atArmhole()],
  paint:(t,c)=>t.c.y<CUT.skirtTop?skirtLining(t,c):t.cls==='torso'&&inY(t,1.36,1.42)?shade(c,-.12):null,
  build:ctx=>skirtTube(ctx,{hem:CUT.bermuda-.06,flare:.12,gap:.045,lip:.024})},
 // El delantal: el peto y la cinta al cuello como cuerpo vestido adelante; la falda del delantal, sólo los gajos de
 // adelante del tubo, hasta la rodilla. Cinta de la cintura atrás, pintada.
 {id:'delantal',label:'Delantal',slot:'outer',layer:4,gap:.03,color:'#c8b48f',
  covers:t=>trunkish(t)&&front(t)&&abs(t.c.x)<.26&&inY(t,CUT.skirtTop,1.7)||t.cls==='torso'&&abs(abs(t.c.x)-.19)<.035&&t.c.y>=1.7&&neckF(t.c.toArray())<CUT.neck-.02||t.cls==='torso'&&inY(t,1.13,1.19),
  cuts:[atY(CUT.skirtTop),atY(1.7),atY(1.13),atY(1.19),plane(p=>abs(p[0]),.26,['torso','leg']),plane(p=>abs(p[0]),.155,['torso']),plane(p=>abs(p[0]),.225,['torso']),atNeck(.02)],
  paint:(t,c)=>inY(t,1.13,1.19)||t.c.y>=1.7?shade(c,-.15):null,
  build:ctx=>skirtTube(ctx,{hem:CUT.bermuda,flare:.02,gap:.05,only:.8,lip:.012})},
 // Encima (abiertas: el frente deja ver lo de abajo)
 // (con tirantes —sin mangas, vestido—: sin corte de cuello, el borde de adentro del tirante ya es el escote; el anillo
// del cuello lo mordía arriba del hombro)
// (cerrado en V bajo el pecho, con tres botones y un ribete en el escote y el ruedo: la sugerencia de la IA de imagen)
 {id:'chaleco',label:'Chaleco',slot:'outer',layer:4,gap:.05,color:'#6e5a3c',covers:topCover(CUT.hemLong,0,{armless:true,open:t=>front(t)&&vestV(t.c.toArray())<0}),
  cuts:[atY(CUT.hemLong),atY(CUT.hemLong+.03),atNeck(),plane(vestV,0,['torso']),plane(vestV,.03,['torso']),atArmhole(),plane(p=>abs(p[0]),.022,['torso','leg']),...VEST_BUTTONS.flatMap(y=>[plane(p=>p[1],y-.022,['torso','leg'],onPlacket),plane(p=>p[1],y+.022,['torso','leg'],onPlacket)])],
  gapOf:rim(.05,.012,t=>front(t)&&vestV(t.c.toArray())<.03,hemBand(CUT.hemLong,.03)),
  paint:(t,c)=>trunkish(t)&&front(t)&&abs(t.c.x)<.022&&VEST_BUTTONS.some(y=>abs(t.c.y-y)<.022)?'#2a2420':front(t)&&vestV(t.c.toArray())<.03||hemBand(CUT.hemLong,.03)(t)?shade(c,-.07):null},
 {id:'chaqueta-abierta',label:'Chaqueta abierta',slot:'outer',layer:4,gap:.058,color:'#3f566e',covers:topCover(CUT.hemJacket,CUT.sleeveLong-.02,{open:t=>front(t)&&abs(t.c.x)<.06+.25*Math.max(0,t.c.y-1.5)}),
  cuts:[atY(CUT.hemJacket),atNeck(),atArm(CUT.sleeveLong-.02),atArm(CUT.sleeveLong-.08),plane(p=>abs(p[0])-.25*Math.max(0,p[1]-1.5),.06,['torso'])],gapOf:rim(.058,.016,cuffs(CUT.sleeveLong-.02,.06),t=>JACKET_POCKETS.in(t)),
  cutsExtra:JACKET_POCKETS.cuts,paint:(t,c)=>cuffs(CUT.sleeveLong-.02,.06)(t)?shade(c,-.08):JACKET_POCKETS.in(t)?shade(c,-.1):null,build:ctx=>lapels(ctx,{edge:.06,gap:.058})},
 {id:'abrigo',label:'Abrigo largo',slot:'outer',layer:4,gap:.062,color:'#6e4e35',covers:topCover(CUT.skirtTop,CUT.sleeveLong-.02,{open:t=>front(t)&&abs(t.c.x)<.07+.25*Math.max(0,t.c.y-1.5)}),
  cuts:[atY(CUT.skirtTop),atNeck(),atNeck(.07),atArm(CUT.sleeveLong-.02),atArm(CUT.sleeveLong-.09),plane(p=>abs(p[0])-.25*Math.max(0,p[1]-1.5),.07,['torso'])],
  cutsExtra:COAT_BUTTONS.flatMap(b=>b.cuts),
  paint:(t,c)=>COAT_BUTTONS.some(b=>b.in(t))?'#2a2420':collar(t,.07)||cuffs(CUT.sleeveLong-.02,.07)(t)?shade(c,-.1):null,gapOf:rim(.062,.014,cuffs(CUT.sleeveLong-.02,.07),t=>collar(t,.07),t=>COAT_BUTTONS.some(b=>b.in(t))),
  build:ctx=>[...skirtTube(ctx,{hem:CUT.bermuda-.02,flare:.13,gap:.085,top:CUT.skirtTop+.035,open:.42,lip:.012}),...lapels(ctx,{edge:.07,gap:.062})]},
 {id:'chaqueta-cremallera',label:'Chaqueta con cremallera',slot:'outer',layer:4,gap:.058,color:'#2b3d5c',covers:topCover(CUT.hemJacket,CUT.sleeveLong-.02),
  gapOf:rim(.058,.012,cuffs(CUT.sleeveLong-.02,.06),hemBand(CUT.hemJacket,.06),t=>collar(t,.05)),
  cuts:[atY(CUT.hemJacket),atY(CUT.hemJacket+.06),atNeck(),atNeck(.05),atArm(CUT.sleeveLong-.02),atArm(CUT.sleeveLong-.08),plane(p=>abs(p[0]),.025,['torso','leg'])],
  paint:(t,c)=>trunkish(t)&&front(t)&&abs(t.c.x)<.025?'#c9c9c4':trunkish(t)&&t.c.y<CUT.hemJacket+.06||collar(t,.05)||cuffs(CUT.sleeveLong-.02,.06)(t)?shade(c,-.08):null},
 // Abajo
 // El overol: el pantalón y, por encima de la camiseta, el peto adelante y los tirantes que cruzan los hombros (layer 3.5:
 // gana a lo de arriba, pierde con lo de encima). Bolsillo del peto y hebillas pintados.
 {id:'overol',label:'Overol',slot:'bottom',layer:3.5,gap:.032,color:'#3f6fa8',
  covers:t=>bottomCover(CUT.ankle)(t)||trunkish(t)&&front(t)&&abs(t.c.x)<.24&&t.c.y<1.62||t.cls==='torso'&&abs(abs(t.c.x)-.17)<.045&&t.c.y>=1.62&&neckF(t.c.toArray())<CUT.neck-.02||t.cls==='torso'&&!front(t)&&abs(abs(t.c.x)-.14)<.045&&t.c.y>1.3,
  // (los cortes del peto y los tirantes, locales a la franja del medio del tronco: dar la vuelta al cuerpo costaba ~1.000 triángulos)
  cuts:[atY(CUT.ankle),atY(CUT.ankle+.06,['leg']),plane(p=>p[1],1.62,['torso'],BIB),plane(p=>p[1],1.3,['torso'],BIB),plane(p=>abs(p[0]),.24,['torso','leg'],c=>c[1]>CUT.waist-.1&&c[1]<1.66&&c[2]>0),
   ...[.125,.215,.095,.185].map(k=>plane(p=>abs(p[0]),k,['torso'],c=>c[1]>1.26)),atNeck(.02),
   plane(p=>p[1],1.4,['torso'],c=>abs(c[0])<.14&&c[2]>0),plane(p=>p[1],1.55,['torso'],c=>abs(c[0])<.14&&c[2]>0),plane(p=>abs(p[0]),.12,['torso'],c=>c[1]>1.38&&c[1]<1.57&&c[2]>0)],
  gapOf:rim(.032,.012,legBand(0,CUT.ankle+.06),t=>front(t)&&abs(t.c.x)<.12&&inY(t,1.4,1.55)),
  paint:(t,c)=>front(t)&&abs(t.c.x)<.12&&inY(t,1.4,1.55)?shade(c,-.06):t.cls==='torso'&&inY(t,1.56,1.64)&&abs(abs(t.c.x)-.17)<.045&&front(t)?'#c9b26a':legBand(0,CUT.ankle+.06)(t)?shade(c,.1):null},
 {id:'jean',label:'Jean',slot:'bottom',layer:2,gap:.02,color:'#3d5370',covers:bottomCover(CUT.ankle),gapOf:rim(.02,.016,legBand(0,CUT.ankle+.06)),
  cuts:[atY(CUT.ankle),atY(CUT.ankle+.06,['leg']),atY(CUT.waist),atY(CUT.waist-.05),atY(.92),plane(p=>abs(p[0]),.08,['torso']),plane(p=>abs(p[0]),.3,['torso'])],
  paint:(t,c)=>legBand(0,CUT.ankle+.06)(t)?shade(c,.12):t.cls==='torso'&&t.c.y>CUT.waist-.05?shade(c,-.1):t.cls==='torso'&&t.c.z<0&&t.n.z<-.3&&inY(t,.92,CUT.waist-.05)&&abs(t.c.x)>.08&&abs(t.c.x)<.3?shade(c,-.07):null},
 {id:'pantalon',label:'Pantalón de tela',slot:'bottom',layer:2,belt:true,gap:.024,color:'#26282a',covers:bottomCover(CUT.ankle),cuts:[atY(CUT.ankle),atY(CUT.waist),atY(CUT.waist-.05)],cutsExtra:BUCKLE.cuts,
  gapOf:rim(.024,.01,t=>t.cls==='torso'&&t.c.y>CUT.waist-.05),paint:(t,c)=>BUCKLE.in(t)?'#c9b26a':t.cls==='torso'&&t.c.y>CUT.waist-.05?'#3a2a20':null},
 {id:'deportivo',label:'Pantalón deportivo',slot:'bottom',layer:2,gap:.03,color:'#7d8284',covers:bottomCover(CUT.ankle),gapOf:rim(.03,.01,legBand(0,CUT.ankle+.06)),
  cuts:[atY(CUT.ankle),atY(CUT.ankle+.06),atY(CUT.waist),atY(CUT.waist-.06)],
  paint:(t,c)=>t.cls==='torso'&&t.c.y>CUT.waist-.06||t.cls==='leg'&&t.c.y<CUT.ankle+.06?shade(c,-.1):null},
 {id:'cargo',label:'Cargo',slot:'bottom',layer:2,gap:.03,color:'#5c6340',covers:bottomCover(CUT.ankle),gapOf:rim(.03,.014,t=>t.cls==='leg'&&inY(t,.5,.75)&&abs(t.c.x)>.36),
  cuts:[atY(CUT.ankle),atY(CUT.waist),atY(.5),atY(.75),plane(p=>abs(p[0]),.36,['leg','torso'])],
  paint:(t,c)=>t.cls==='leg'&&inY(t,.5,.75)&&abs(t.c.x)>.36?shade(c,-.08):null},
 {id:'leggings',label:'Leggings',slot:'bottom',layer:2,gap:.008,color:'#26282a',covers:bottomCover(CUT.ankle+.04),cuts:[atY(CUT.ankle+.04),atY(CUT.waist)]},
 {id:'bermuda',label:'Bermuda',slot:'bottom',layer:2,gap:.026,color:'#c8b48f',covers:bottomCover(CUT.bermuda),cuts:[atY(CUT.bermuda),atY(CUT.bermuda+.05,['leg']),atY(CUT.waist),atY(CUT.waist-.05)],
  gapOf:rim(.026,.014,legBand(0,CUT.bermuda+.05)),paint:(t,c)=>legBand(0,CUT.bermuda+.05)(t)?shade(c,-.06):t.cls==='torso'&&t.c.y>CUT.waist-.05?shade(c,-.1):null},
 {id:'pantaloneta',label:'Pantaloneta',slot:'bottom',layer:2,gap:.026,color:'#2b3549',covers:bottomCover(CUT.shorts),cuts:[atY(CUT.shorts),atY(CUT.shorts+.05),atY(CUT.waist)],
  paint:(t,c)=>t.cls==='leg'&&t.c.y<CUT.shorts+.05?'#f2f0ea':null},
 // Faldas: la pretina es cuerpo vestido (y la entrepierna, con color de forro: sentada, entre los muslos se ve la falda
 // y no el calzón); la falda, una pieza suelta (skirtTube) que mueven la cadera y los muslos.
 {id:'falda-corta',label:'Falda corta',slot:'bottom',layer:2,gap:.022,color:'#7a2e33',covers:skirtCover,paint:skirtLining,cuts:[atY(CUT.skirtTop),atY(CUT.waist),atY(CUT.crotch)],
  build:ctx=>skirtTube(ctx,{hem:CUT.shorts+.02,flare:.11,lip:.02})},
 {id:'falda-larga',label:'Falda a la rodilla',slot:'bottom',layer:2,gap:.022,color:'#3f566e',covers:skirtCover,paint:skirtLining,cuts:[atY(CUT.skirtTop),atY(CUT.waist),atY(CUT.crotch)],
  build:ctx=>skirtTube(ctx,{hem:CUT.bermuda-.04,flare:.13,lip:.022})},
 // Accesorios (piezas sueltas que no visten la piel)
 {id:'bufanda',label:'Bufanda',slot:'accessory',layer:7,gap:0,color:'#b8443a',covers:()=>false,build:ctx=>scarf(ctx)},
 // El gorro de lana: la cabeza vestida sobre una línea que pasa sobre las cejas y baja por la nuca, holgado para tapar el
 // volumen del pelo; un doblez acanalado en el borde y un pompón. El pelo de adentro se omite (hideHairAbove).
 {id:'gorro-lana',label:'Gorro de lana',slot:'hat',layer:8,color:'#3a6f8f',covers:t=>t.cls==='head'&&beanieF(t.c.toArray())>0,
  cuts:[plane(beanieF,0,['head']),plane(beanieF,.07,['head'])],gapOf:t=>beanieF(t.c.toArray())<.07?.11:.1,swell:p=>{const S=THREE.MathUtils.smoothstep,r=Math.hypot(p[0],p[2]+.02);return .05*S(p[1],2.9,3.1)+.09*S(p[1],3.0,3.13)*(1-S(r,.1,.42));},
  paint:(t,c)=>beanieF(t.c.toArray())<.07?shade(c,-.08):null,hairCut:p=>beanieF(p)-.03,
  build:ctx=>headPieces(ctx,()=>[{geo:new THREE.IcosahedronGeometry(1,0),pos:[0,3.36,-.02],dir:[0,1,0],scale:[.13,.12,.13],tone:.06}])},
 {id:'gorra',label:'Gorra',slot:'hat',layer:8,color:'#c4553d',covers:t=>t.cls==='head'&&capF(t.c.toArray())>0,
  cuts:[plane(capF,0,['head']),plane(capF,.035,['head'])],gapOf:t=>capF(t.c.toArray())<.035?.075:.07,
  swell:p=>.03*THREE.MathUtils.smoothstep(p[1],2.95,3.13),paint:(t,c)=>capF(t.c.toArray())<.035?shade(c,-.08):null,hairCut:p=>capF(p)-.025,
  build:ctx=>[...visor(ctx),...headPieces(ctx,()=>[{geo:new THREE.CylinderGeometry(1,1,1,6),pos:[0,3.2,-.02],dir:[0,1,0],scale:[.045,.04,.045],tone:-.1}])]},
 // Calzado (el pie inflado; la suela se pinta por triángulo, sin corte: el pie es denso y un corte lo rebana entero)
 {id:'tenis',label:'Tenis',slot:'shoes',layer:5,gap:.022,color:'#34507a',covers:t=>(t.cls==='foot'||t.cls==='leg')&&t.c.y<CUT.shoe,
  cuts:[atY(CUT.shoe,['leg','foot','torso'])],paint:(t,c)=>t.c.y<CUT.sole?'#f2f0ea':t.c.y>CUT.shoe-.035?'#f2f0ea':null},
 {id:'botas',label:'Botas',slot:'shoes',layer:5,gap:.03,color:'#5b3b25',covers:t=>(t.cls==='foot'||t.cls==='leg')&&t.c.y<CUT.capri,
  cuts:[atY(CUT.capri,['leg','foot','torso'])],gapOf:rim(.03,.014,t=>t.c.y<CUT.sole),paint:(t,c)=>t.c.y<CUT.sole?'#2a2522':null},
 {id:'zapatos',label:'Zapatos',slot:'shoes',layer:5,gap:.018,color:'#232425',covers:t=>(t.cls==='foot'||t.cls==='leg')&&t.c.y<CUT.shoe-.03,
  cuts:[atY(CUT.shoe-.03,['leg','foot','torso'])],paint:(t,c)=>t.c.y<CUT.sole-.01?shade(c,-.1):null},
];
export const SLOTS=[['top','Arriba'],['outer','Encima'],['bottom','Abajo'],['shoes','Calzado'],['hat','Cabeza'],['accessory','Cuello'],['underwear','Interior']];
export const PALETTE=['#f2f0ea','#c9c9c4','#8a8e90','#2f3133','#c4553d','#7a2e33','#d9793a','#e0b83a','#4f8a55','#6b7340','#3a9a96','#7fb2d6','#3f6fa8','#2b3d5c','#6b4a8a','#d98aa0','#6e4e35','#c8b48f'];

// ---------- El pelo como capa de la cabeza (2026-10-13) ----------
/* Como la ropa: los triángulos de la cabeza sobre la línea del pelo pasan a ser pelo, inflados; cada triángulo puede
   llevar otra holgura (gapOf) y donde cambia queda un escalón: las «terrazas» facetadas del pelo low poly. Lo que
   sobresale (tupé, moño, picos, rulos) son piezas de pocas caras pegadas al hueso de la cabeza.
   La cabeza (pose de atado): un cubo redondeado de ±.49, de y 2.07 a 3.13; ojos y cejas de y 2.47 a 2.76 al frente;
   orejas en x ±.43–.55, y 2.37–2.62. La línea del pelo: frente 2.96 (deja frente libre sobre las cejas), costados rectos a 2.64 (patillas hasta 2.49) y
   nuca 2.44. */
// (por la profundidad: alta en la frente, recta a los costados —sobre la oreja— y baja en la nuca; patillas delante de la oreja)
const ss=THREE.MathUtils.smoothstep;
const hairlineF=p=>{const u=Math.max(-1,Math.min(1,p[2]/.49)),burn=ss(abs(p[0]),.33,.42)*ss(p[2],-.06,.02)*(1-ss(p[2],.16,.24));return p[1]-(2.64+.32*ss(u,.64,.95)-.2*ss(-u,.35,.95)-.15*burn);};
const atHairline=(d=0)=>plane(hairlineF,d,['head']);
const onHair=t=>t.cls==='head'&&hairlineF(t.c.toArray())>0;
const atHead=k=>plane(p=>p[1],k,['head']);
// (rng con semilla: los picos y rulos salen siempre igual para el mismo peinado)
const seeded=seed=>()=>((seed=(seed*16807)%2147483647)-1)/2147483646;
function headPieces({tris,bones,color},place){
 const H=bones.findIndex(b=>b.name==='Head');if(H<0)return [];const seen=new Map();
 for(const q of tris)if(q.cls==='head')for(const v of q.v){const k=KEY(v.p);if(!seen.has(k))seen.set(k,{p:v.p,n:unitV(v.n)});}
 const pts=[...seen.values()].filter(v=>hairlineF(v.p)>.05).sort((a,b)=>b.p[1]-a.p[1]||a.p[0]-b.p[0]||a.p[2]-b.p[2]);
 const out=[],base=new THREE.Color(color);
 for(const {geo,pos,dir,scale=[1,1,1],tone=0} of place(pts)){const g=geo.index?geo.toNonIndexed():geo,P=g.attributes.position,m=new THREE.Matrix4().compose(new THREE.Vector3(...pos),new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(...dir).normalize()),new THREE.Vector3(...scale)),v=new THREE.Vector3();
  const c=base.clone().multiplyScalar(1+tone),col=[c.r,c.g,c.b];
  for(let i=0;i<P.count;i+=3){const tri=[];for(let k=0;k<3;k++){v.fromBufferAttribute(P,i+k).applyMatrix4(m);tri.push({p:v.toArray(),n:[0,0,0],m:[0,0,0],j:[H,0,0,0],w:[1,0,0,0],col});}out.push(tri);}
  g.dispose();}
 return out;}
const IA_HAIR=new Map();
function iaPiece({bones,color},data){
 const H=bones.findIndex(b=>b.name==='Head');if(H<0||!data)return [];const base=new THREE.Color(color);
 return data.tris.map(t=>{const c=base.clone().multiplyScalar(Math.min(1.35,Math.max(.6,t.l))),col=[c.r,c.g,c.b];return t.p.map(p=>({p:p.slice(),n:[0,0,0],m:[0,0,0],j:[H,0,0,0],w:[1,0,0,0],col}));});}
const unitV=n=>{const l=Math.hypot(...n)||1;return [n[0]/l,n[1]/l,n[2]/l];};
const mix=(a,b,k)=>'#'+new THREE.Color(a).lerp(new THREE.Color(b),k).getHexString();
// (swell: volumen que crece hacia la coronilla; el escalón de la línea del pelo da el grosor del borde)
const crown=(k,from=2.72)=>p=>k*ss(p[1],from,3.06);
export const HAIRSTYLES_LAYER=[
 {id:'capa:rapado',label:'Rapado',slot:'hair',layer:6,gap:.014,covers:onHair,cuts:[atHairline()]},
 {id:'capa:clasico',label:'Corto clásico',slot:'hair',layer:6,gap:.035,swell:p=>crown(.08)(p)+.025*ss(p[2],.1,.45)*ss(p[1],2.8,2.95),covers:onHair,cuts:[atHairline()],
  // (mechones del flequillo: placas finas inclinadas hacia adelante, que rompen el «casco» como en la referencia)
  build:ctx=>headPieces(ctx,()=>{const r=seeded(3);return [-.3,-.15,0,.15,.3].map((x,i)=>({geo:new THREE.DodecahedronGeometry(1,0),pos:[x,3.13-abs(x)*.25,.3-abs(x)*.15],dir:[x*.6,.6,.8],scale:[.13,.07+r()*.03,.16],tone:(r()-.5)*.12}));})},
 {id:'capa:raya',label:'Raya al lado',slot:'hair',layer:6,gap:.035,swell:p=>crown(.07)(p)+(p[0]<.13?.03*ss(p[1],2.75,3.0):0),covers:onHair,
  cuts:[atHairline(),plane(p=>p[0],.12,['head']),plane(p=>p[0],.15,['head'])],
  paint:(t,c,skin)=>t.c.x>.12&&t.c.x<.15&&t.c.y>2.95&&t.c.z>-.25?skin:null},
 // (2026-10-14, a ojo contra la lámina: el copete ya no es un bloque encima; es la misma capa del pelo que crece hacia la
 // frente y arriba, con los costados cortos —como el undercut pero sin raya— y una fila de mechones en punta adelante
 // que se abren hacia atrás)
 {id:'capa:quiff',label:'Copete (quiff)',slot:'hair',layer:6,gap:.03,swell:crown(.06),covers:onHair,cuts:[atHairline()],
  // (el copete: un bloque ancho que sale de la frente hacia arriba y atrás, y otro más bajo que lo continúa)
  build:ctx=>headPieces(ctx,()=>[{geo:new THREE.DodecahedronGeometry(1,0),pos:[0,3.17,.3],dir:[0,.4,.92],scale:[.42,.36,.2]},{geo:new THREE.DodecahedronGeometry(1,0),pos:[0,3.16,.05],dir:[0,1,-.2],scale:[.4,.12,.3],tone:-.06}])},
 {id:'capa:undercut',label:'Undercut',slot:'hair',layer:6,covers:onHair,gapOf:t=>t.c.y>2.86?.03:.012,swell:p=>p[1]>2.86?crown(.13,2.86)(p)+.03*ss(p[2],.1,.45):0,cuts:[atHairline(),atHead(2.86)],
  paint:(t,c,skin)=>t.c.y<=2.86?mix(c,skin,.35):null},
 {id:'capa:despeinado',label:'Despeinado',slot:'hair',layer:6,gap:.03,swell:crown(.04),covers:onHair,cuts:[atHairline()],
  // (mechones gruesos de 3 caras, por toda la cabeza y torcidos al azar, más cortos a los costados)
  build:ctx=>headPieces(ctx,pts=>{const r=seeded(7);return pts.filter(v=>hairlineF(v.p)>.06).map(v=>({geo:new THREE.ConeGeometry(1,1,3),pos:v.p.map((x,c)=>x+v.n[c]*.07),
   dir:[v.n[0]+(r()-.5)*.9,v.n[1]+.35,v.n[2]+(r()-.5)*.9+.2],scale:[.12+r()*.04,(.1+r()*.08)*(v.p[1]>2.9?1.3:.8),.12+r()*.04],tone:(r()-.5)*.18}));})},
 {id:'capa:rizado',label:'Ondulado / rizado',slot:'hair',layer:6,gap:.06,swell:crown(.05),covers:onHair,cuts:[atHairline()],
  build:ctx=>headPieces(ctx,pts=>{const r=seeded(11);return pts.filter(v=>hairlineF(v.p)>.08).map(v=>({geo:new THREE.IcosahedronGeometry(1,0),pos:v.p.map((x,c)=>x+v.n[c]*.1),
   dir:[r()-.5,1,r()-.5],scale:[.14+r()*.04,.12+r()*.04,.14+r()*.04],tone:(r()-.5)*.2}));})},
 // (generados con IA desde la lámina —pelosIA.js—: una capa fina del color del pelo, por si la cabeza no calza
 // exacto, y encima la pieza generada, recoloreada con el color de pelo elegido y su sombreado relativo)
 {id:'ia:quiff',label:'Quiff · IA Meshy',slot:'hair',layer:6,gap:.012,covers:onHair,cuts:[atHairline()],build:ctx=>iaPiece(ctx,IA_HAIR.get('quiff'))},
 {id:'ia:quiff-h',label:'Quiff · IA Hunyuan',slot:'hair',layer:6,gap:.012,covers:onHair,cuts:[atHairline()],build:ctx=>iaPiece(ctx,IA_HAIR.get('quiff-h'))},
 // (las láminas de referencia de Miguel, 8 de hombre y 8 de mujer, generadas con Hunyuan desde sus 4 vistas)
 ...[['h1','Rapado'],['h2','Corto clásico'],['h3','Raya al lado'],['h4','Quiff'],['h5','Undercut'],['h6','Despeinado'],['h7','Rizado'],['h8','Moño'],
   ['m1','Bob corto'],['m2','Largo liso'],['m3','Flequillo'],['m4','Coleta alta'],['m5','Moño alto'],['m6','Trenza'],['m7','Ondulado'],['m8','Pixie']]
  .concat([['h4hq','Quiff HQ'],['m2hq','Largo liso HQ'],['h4tall','Quiff tallado'],['m2tall','Largo liso tallado'],['c3-hy31','Quiff · Hunyuan 3.1'],['c3-meshy','Quiff · Meshy 7.1'],['c3-recon','Quiff · ReconViaGen'],['c3-hy2','Quiff · Hunyuan 2'],['c3-trellis','Quiff · Trellis'],['lp-hy3','Quiff · Hunyuan v3 LowPoly'],['lp-meshy6','Quiff · Meshy 6 lowpoly'],['lp-lam','Quiff · LowPoly desde la lámina'],['lp-lam-plano','Quiff · LowPoly lámina, color plano'],['lp-fac-a','Quiff · LowPoly facetado'],['lp-fac-b','Quiff · LowPoly facetado + aristas']])
  .map(([k,label])=>({id:'ia:'+k,label:label+' · IA',sexo:k[0],slot:'hair',layer:6,gap:.012,covers:onHair,cuts:[atHairline()],build:ctx=>iaPiece(ctx,IA_HAIR.get(k))})),
 {id:'capa:mono',label:'Moño (man bun)',slot:'hair',layer:6,gap:.03,covers:onHair,cuts:[atHairline()],
  build:ctx=>headPieces(ctx,()=>[{geo:new THREE.IcosahedronGeometry(1,0),pos:[0,3.13,-.36],dir:[0,1,-.4],scale:[.16,.15,.16]},{geo:new THREE.CylinderGeometry(1,1,1,6),pos:[0,3.07,-.31],dir:[0,1,-.6],scale:[.1,.05,.1],tone:-.25}])},
];
const BY_ID=new Map([...GARMENTS,...HAIRSTYLES_LAYER].map(g=>[g.id,g]));

// ---------- Piezas sueltas ----------
/* La falda: un tubo de pocas caras alrededor de cadera y muslos, medido sobre el cuerpo ya formado (sirve para las cinco
   contexturas). Arriba la mueve la cadera; hacia el ruedo, cada costado su muslo y el centro los dos por mitades: al
   caminar se abre con las piernas y sentada el frente sube con los muslos (el regazo), en vez de colgar hasta el piso.
   Lleva forro (las mismas caras al revés, más oscuras) para que no se vea hueca desde abajo. El borde de arriba nace un
   poco por dentro de la superficie de su prenda (regionGap) y por encima de su borde: no queda rendija ni se ve el forro. */
// (top: altura del borde de arriba; gap: holgura del tubo —el abrigo va por fuera de la falda—; open: medio ángulo
// abierto adelante, para los abrigos)
const LINING=.008,SKIRT_W={front:.95,back:.2};
function skirtTube({tris,bones,color,gapScale,regionGap=0},{hem,flare,segments=14,rings=3,top=CUT.skirtTop+.035,gap=.03,open=0,lip=0,only=0}){
 const bi=n=>bones.findIndex(b=>b.name===n),H=bi('Hips'),L=bi('UpperLegL'),R=bi('UpperLegR');if(H<0||L<0||R<0)return [];
 gap*=gapScale;const pts=[];for(const q of tris)if(q.cls==='torso'||q.cls==='leg')for(const v of q.v)if(v.p[1]<=top+.03&&v.p[1]>=hem-.02)pts.push(v.p);
 const cz=pts.reduce((s,p)=>s+p[2],0)/(pts.length||1),seg=Math.PI*2/segments;
 // (el radio de cada gajo: lo más lejos que llega el cuerpo en esa dirección, arriba sólo a la altura de la pretina y
 // abajo en toda la columna —los dos muslos—, más la holgura y el vuelo)
 const reach=(lo,hi)=>{const r=new Array(segments).fill(0);for(const p of pts){if(p[1]<lo||p[1]>hi)continue;const a=Math.atan2(p[0],p[2]-cz),k=((Math.round(a/seg)%segments)+segments)%segments,d=Math.hypot(p[0],p[2]-cz);for(const dk of [-1,0,1]){const kk=(k+dk+segments)%segments;r[kk]=Math.max(r[kk],d*(dk?.97:1));}}return r;};
 const rTop=reach(top-.04,top+.03),rCol=reach(hem,top+.03),ring=[];
 // (con dobladillo: un anillo más, 3,5 cm sobre el ruedo; esa franja sale `lip` más afuera y es del color del ruedo)
 const ts=[...Array(rings+1).keys()].map(i=>i/rings);if(lip)ts.splice(rings,0,1-.035/(top-hem));const nR=ts.length-1;
 for(let i=0;i<=nR;i++){const t=ts[i],y=top+(hem-top)*t,row=[],L0=lip&&i>=nR-1?lip:0;
  for(let k=0;k<segments;k++){const a=k*seg,u=Math.min(1,t*3),r=Math.max(rTop[k]*(1-t)+rCol[k]*t,rTop[k])+regionGap*.85*(1-u)+gap*u+flare*t*t+L0,x=Math.sin(a)*r,z=cz+Math.cos(a)*r;
   // (el frente pasa enseguida al muslo, casi entero: con peso mezclado, el muslo levantado lo atravesaría; la espalda
   // queda con la cadera: si la llevara el muslo, sentada saldría para atrás como una cola)
   const hipsW=1-THREE.MathUtils.smoothstep(t,0,.4)*(SKIRT_W.back+(SKIRT_W.front-SKIRT_W.back)*(.5+.5*Math.cos(a))),side=Math.min(1,Math.max(0,.5+.7*Math.sin(a)*Math.min(1,t*3)));// (sentada —el morph «Sentado», que sube solo cuando los muslos van adelante—: la falda se recoge. Lo que llevan los
   // muslos pierde el vuelo y no pasa de la rodilla, o salía como un estante sobre las piernas; lo que lleva la cadera
   // sube hasta el asiento, o colgaba como una cortina a los costados)
   const yMin=hipsW*(CUT.crotch+.02)+(1-hipsW)*.5,dr=flare*t*t*(1-hipsW)*.6,m=[-Math.sin(a)*dr,Math.max(0,yMin-y),-Math.cos(a)*dr];
   row.push({p:[x,y,z],pin:[Math.sin(a)*(r-LINING),y,cz+Math.cos(a)*(r-LINING)],m,w:[hipsW,(1-hipsW)*side,(1-hipsW)*(1-side),0],j:[H,L,R,0]});}
  ring.push(row);}
 const outC=new THREE.Color(color),inC=outC.clone().multiplyScalar(.6),hemC=outC.clone().multiplyScalar(.85),out=[];
 const V=(r,col)=>({p:r.p.slice(),n:[0,0,0],m:(r.m||[0,0,0]).slice(),j:r.j.slice(),w:r.w.slice(),col:[col.r,col.g,col.b]});
rings=nR;
 for(let i=0;i<rings;i++)for(let k=0;k<segments;k++){if(open||only){const mid=Math.atan2(Math.sin((k+.5)*seg),Math.cos((k+.5)*seg));if(open&&abs(mid)<open||only&&abs(mid)>only)continue;}const a=ring[i][k],b=ring[i][(k+1)%segments],c=ring[i+1][(k+1)%segments],d=ring[i+1][k],col=(i===rings-1?hemC:outC).clone().multiplyScalar(k%2?.93:1.04);
  // (el forro, un poco por dentro: en el mismo lugar que la cara de afuera, con el material de dos caras, las dos
  // pelean en la profundidad y la falda se ve a manchas del color del forro)
  const I=r=>({...r,p:r.pin});out.push([V(a,col),V(d,col),V(c,col)],[V(a,col),V(c,col),V(b,col)],[V(I(a),inC),V(I(c),inC),V(I(d),inC)],[V(I(a),inC),V(I(b),inC),V(I(c),inC)]);}
 return out;}

/* Las puntas del cuello de la camisa (sugerencia de la IA de imagen): dos solapas triangulares que salen del escote y
   caen sobre el pecho, apoyadas en la camisa ya inflada. Cada esquina toma la posición, la normal y los pesos del vértice
   de la piel más cercano; son de dos caras (afuera el color de la camisa, adentro un poco más oscuro). */
function collarPoints({tris,color,gapScale},{lift=.06,drop=.12}={}){
 const vs=[];for(const q of tris)if(q.cls==='torso')for(const v of q.v)if(v.p[2]>0&&v.p[1]>1.6)vs.push(v);
 const near=(x,y)=>{let b=null,bd=Infinity;for(const v of vs){const d=(v.p[0]-x)**2+(v.p[1]-y)**2*1.5;if(d<bd||abs(d-bd)<1e-6&&v.p[2]>b.p[2]){bd=d;b=v;}}return b;};
 const top=CUT.neckFront,c=new THREE.Color(color).multiplyScalar(1.03),ci=new THREE.Color(color).multiplyScalar(.62),out=[];
 const at=(x,y,extra=0)=>{const v=near(x,y),n=unitV(v.n),g=(lift+extra)*gapScale;return {p:[x,v.p[1]+n[1]*g,v.p[2]+n[2]*g+0],n:[0,0,0],m:[0,0,0],j:v.j.slice(),w:v.w.slice()};};
 const col=(v,k)=>({...v,col:[k.r,k.g,k.b]});
 for(const sg of [-1,1]){
  const a=at(sg*.015,top+.03),b=at(sg*.14,top+.03),tip=at(sg*.065,top-drop,.012);
  let f=[a,b,tip];if(sg<0)f=[a,tip,b];
  out.push(f.map(v=>col(v,c)),[f[0],f[2],f[1]].map(v=>col({...v,p:[v.p[0],v.p[1],v.p[2]-.006]},ci)));}
 return out;}

/* Solapas de la chaqueta abierta y el abrigo (sugerencia de la IA de imagen): a cada lado, un triángulo doblado hacia
   afuera sobre el borde de la abertura, del cuello hasta abajo del pecho, apoyado sobre la prenda. */
function lapels({tris,color,gapScale},{edge,gap,slope=.25,from=1.5,width=.11}){
 const vs=[];for(const q of tris)if(q.cls==='torso')for(const v of q.v)if(v.p[2]>0&&v.p[1]>1.35)vs.push(v);
 const near=(x,y)=>{let b=null,bd=Infinity;for(const v of vs){const d=(v.p[0]-x)**2+(v.p[1]-y)**2*1.5;if(d<bd){bd=d;b=v;}}return b;};
 const lift=(gap+.016)*gapScale,c=new THREE.Color(shade('#'+new THREE.Color(color).getHexString(),.05)),ci=new THREE.Color(color).multiplyScalar(.7),out=[];
 const at=(x,y,extra=0)=>{const v=near(x,y),n=unitV(v.n);return {p:[x+n[0]*(lift+extra),v.p[1]+n[1]*(lift+extra),v.p[2]+n[2]*(lift+extra)],n:[0,0,0],m:[0,0,0],j:v.j.slice(),w:v.w.slice()};};
 const col=(v,k)=>({...v,col:[k.r,k.g,k.b]}),xe=y=>edge+slope*Math.max(0,y-from);
 for(const sg of [-1,1]){
  const yTop=CUT.neckFront-.02,a=at(sg*(xe(from)+.005),from),b=at(sg*(xe(yTop)+.005),yTop),tip=at(sg*(xe(1.78)+width),1.78,.006);
  let f=[a,tip,b];if(sg<0)f=[a,b,tip];
  out.push(f.map(v=>col(v,c)),[f[0],f[2],f[1]].map(v=>col({...v,p:[v.p[0],v.p[1],v.p[2]-.006]},ci)));}
 return out;}

/* La bufanda (2026-10-14): un rollo cerrado alrededor del cuello, medido sobre el cuello ya vestido, y una punta que
   cae adelante sobre el pecho. La lleva el tronco y un poco el cuello, como la capucha. */
function scarf({tris,bones,color,gapScale},{steps=14}={}){
 const bi=n=>bones.findIndex(b=>b.name===n),T=bi('Torso'),N=bi('Neck');if(T<0||N<0)return [];
 const y0=2.0,pts=[];for(const q of tris)if(q.cls==='torso'||q.cls==='head')for(const v of q.v)if(abs(v.p[1]-y0)<.06&&abs(v.p[0])<.3)pts.push(v.p);
 const cz=pts.reduce((s,p)=>s+p[2],0)/(pts.length||1),reach=a=>{let r=.12;for(const p of pts){const d=Math.atan2(p[0],p[2]-cz)-a;if(Math.cos(d)>.97)r=Math.max(r,Math.hypot(p[0],p[2]-cz));}return r;};
 const gap=.085*gapScale,prof=[[-.02,-.08],[.07,-.08],[.12,-.01],[.1,.07],[.02,.1]];   // (sección del rollo: [afuera, alto])
 const c=new THREE.Color(color),dark=c.clone().multiplyScalar(.8),out=[],V=(p,col,w=[.75,.25])=>({p,n:[0,0,0],m:[0,0,0],j:[T,N,0,0],w:[...w,0,0],col:[col.r,col.g,col.b]});
 const rows=[];for(let i=0;i<=steps;i++){const a=i/steps*Math.PI*2,r=reach(a)+gap,sx=Math.sin(a),sz=Math.cos(a);rows.push(prof.map(([o,u])=>[sx*(r+o),y0+u,cz+sz*(r+o)]));}
 for(let i=0;i<steps;i++)for(let k=0;k<prof.length-1;k++){const a=rows[i][k],b=rows[i+1][k],cc=rows[i+1][k+1],d=rows[i][k+1],col=i%2?c:dark.clone().lerp(c,.6);
  out.push([V(a,col),V(b,col),V(cc,col)],[V(a,col),V(cc,col),V(d,col)]);}
 // (la punta: una tira que sale del rollo adelante, a un costado, y cae sobre el pecho; el tronco la lleva entera)
 // (cada altura de la punta se apoya en lo más adelante del pecho ahí, más la holgura de un abrigo: no queda adentro)
 const x0=.06,w=.15,top=y0-.06,bot=1.62,seg=4,strip=[],chest=[];for(const q of tris)if(q.cls==='torso')for(const v of q.v)if(v.p[2]>0&&abs(v.p[0]-x0-w/2)<.12)chest.push(v.p);
 const zAt=y=>{let z=cz+reach(0);for(const p of chest)if(abs(p[1]-y)<.05)z=Math.max(z,p[2]);return z+.1*gapScale;};
 for(let i=0;i<=seg;i++){const t=i/seg,y=top+(bot-top)*t,z=Math.max(zAt(y),i?0:cz+reach(0)+gap+.08),dx=.025*t;strip.push([[x0-dx,y,z],[x0+w-dx,y,z]]);}
 for(let i=0;i<seg;i++){const [a,b]=strip[i],[d,cc]=strip[i+1],col=i===seg-1?dark:c;
  out.push([V(a,col,[1,0]),V(d,col,[1,0]),V(cc,col,[1,0])],[V(a,col,[1,0]),V(cc,col,[1,0]),V(b,col,[1,0])]);
  const back=v=>V([v[0],v[1],v[2]-.008],dark,[1,0]);out.push([back(a),back(cc),back(d)],[back(a),back(b),back(cc)]);}
 // (flecos: tres dientes al final de la punta)
 const [ba,bb]=strip[seg];for(let k=0;k<3;k++){const u0=k/3,u1=(k+1)/3,p0=[ba[0]+(bb[0]-ba[0])*u0,bot,ba[2]],p1=[ba[0]+(bb[0]-ba[0])*u1,bot,ba[2]],tip=[(p0[0]+p1[0])/2,bot-.035,ba[2]+.005];
  out.push([V(p0,dark,[1,0]),V(tip,dark,[1,0]),V(p1,dark,[1,0])],[V(p0,dark,[1,0]),V(p1,dark,[1,0]),V(tip,dark,[1,0])]);}
 return out;}

/* La capucha bajada: un rollo en U por detrás del cuello (de hombro a hombro, abierto adelante), medido sobre el cuello
   ya formado. La llevan el tronco y, un poco, el cuello: al girar la cabeza no se dobla. */
function hoodDown({tris,bones,color,gapScale},{steps=12,from=.38*Math.PI,to=1.62*Math.PI,size=1.3}={}){
 const bi=n=>bones.findIndex(b=>b.name===n),T=bi('Torso'),N=bi('Neck');if(T<0||N<0)return [];
 const y0=1.9,pts=[];for(const q of tris)if(q.cls==='torso')for(const v of q.v)if(abs(v.p[1]-y0)<.05&&abs(v.p[0])<.3)pts.push(v.p);
 const cz=pts.reduce((s,p)=>s+p[2],0)/(pts.length||1),reach=a=>{let r=.12;for(const p of pts){const d=Math.atan2(p[0],p[2]-cz)-a,w=Math.cos(d);if(w>.97)r=Math.max(r,Math.hypot(p[0],p[2]-cz));}return r;};
 // (sección, de adentro hacia afuera: [cuánto se aleja del cuello, alto]; atrás la tela cae sobre la espalda —«fall»—
 // y a los costados queda como un rollo sobre el hombro)
 const gap=.04*gapScale,prof=[[0,-.01,0],[.05,.09,0],[.13,.11,.2],[.2,.02,.75],[.22,-.1,1],[.12,-.07,1]].map(([o,u,f])=>[o*size,u*size,f]);
 const rows=[];for(let i=0;i<=steps;i++){const a=from+(to-from)*i/steps,r=reach(a)+gap,back=Math.pow(Math.max(0,-Math.cos(a)),.8),sx=Math.sin(a),sz=Math.cos(a);
  rows.push(prof.map(([out,up,fall])=>{const o=out*(.55+.45*back),y=y0+up*(.6+.4*back)-fall*back*.16;return {p:[sx*(r+o),y,cz+sz*(r+o)],pin:[sx*(r+o-LINING),y-LINING*.5,cz+sz*(r+o-LINING)],j:[T,N,0,0],w:[.8,.2,0,0]};}));}
 const c=new THREE.Color(color),rim=c.clone().multiplyScalar(.72),out=[],V=(r,col)=>({p:r.p.slice(),n:[0,0,0],m:[0,0,0],j:r.j.slice(),w:r.w.slice(),col:[col.r,col.g,col.b]});
 for(let i=0;i<steps;i++)for(let k=0;k<prof.length-1;k++){const a=rows[i][k],b=rows[i+1][k],cc=rows[i+1][k+1],d=rows[i][k+1],col=k>=2?rim:c;
  // (de dos caras: afuera el color de la sudadera, adentro el del forro, apenas corrido hacia el cuello)
  const I=r=>({...r,p:r.pin});out.push([V(a,col),V(b,col),V(cc,col)],[V(a,col),V(cc,col),V(d,col)],[V(I(a),rim),V(I(cc),rim),V(I(b),rim)],[V(I(a),rim),V(I(d),rim),V(I(cc),rim)]);}
 // (las puntas, cerradas)
 for(const i of [0,steps]){const r=rows[i];for(let k=1;k<prof.length-1;k++){const tri=[V(r[0],rim),V(r[k],rim),V(r[k+1],rim)];out.push(tri,[tri[0],tri[2],tri[1]]);}}
 return out;}

// ---------- Geometría ----------
const CLASS_OF=name=>/^Head/.test(name)?'head':/^(Body|Hips|Abdomen|Torso|Neck|Shoulder)/.test(name)?'torso':/^(UpperArm|LowerArm)/.test(name)?'arm':/^Fist/.test(name)?'hand':/^(UpperLeg|LowerLeg|Skirt)/.test(name)?'leg':/^Foot/.test(name)?'foot':'torso';
const vtx=(g,i)=>({p:[0,1,2].map(c=>g.attributes.position.array[i*3+c]),col:[0,1,2].map(c=>g.attributes.color.array[i*3+c]),
 m:g.morphAttributes.position?.[0]?[0,1,2].map(c=>g.morphAttributes.position[0].array[i*3+c]):[0,0,0],
 j:[0,1,2,3].map(c=>g.attributes.skinIndex.array[i*4+c]),w:[0,1,2,3].map(c=>g.attributes.skinWeight.array[i*4+c])});
function lerpV(a,b,t){const map=new Map();for(let k=0;k<4;k++){if(a.w[k])map.set(a.j[k],(map.get(a.j[k])||0)+a.w[k]*(1-t));if(b.w[k])map.set(b.j[k],(map.get(b.j[k])||0)+b.w[k]*t);}
 const ws=[...map].sort((x,y)=>y[1]-x[1]).slice(0,4),sum=ws.reduce((s,x)=>s+x[1],0)||1;while(ws.length<4)ws.push([0,0]);
 const L=(x,y)=>x.map((v,c)=>v+(y[c]-v)*t);return {p:L(a.p,b.p),n:L(a.n,b.n),col:L(a.col,b.col),m:L(a.m,b.m),j:ws.map(x=>x[0]),w:ws.map(x=>x[1]/sum)};}
// (por triángulo: la clase que más peso suma en sus tres vértices)
function classify(tri,bones){const s={};for(const v of tri)for(let k=0;k<4;k++)if(v.w[k]){const c=CLASS_OF(bones[v.j[k]]?.name||'');s[c]=(s[c]||0)+v.w[k];}return Object.entries(s).sort((a,b)=>b[1]-a[1])[0]?.[0]||'torso';}
const trunkShare=(tri,bones)=>{let t=0,a=0;for(const v of tri)for(let k=0;k<4;k++)if(v.w[k]){a+=v.w[k];if(/^(Body|Hips|Abdomen)/.test(bones[v.j[k]]?.name||''))t+=v.w[k];}return a?t/a:0;};
// Antes de cortar, los vértices a menos de SNAP del plano se pegan a él (salvo los que ya quedaron sobre otro corte: dos
// cortes a menos de 2 cm —el ruedo a 1.07 y el elástico del bóxer a 1.06— se robaban los vértices y el primero salía en
// dientes): el borde aprovecha las aristas que ya hay y no
// parte en tres los triángulos que apenas lo rozan. Se hace en TODOS los triángulos (el vértice es el mismo para todos
// los que lo comparten: si se moviera sólo en algunos, se abriría una rendija).
const SNAP=.02;
function snapTo(tris,{f,k},pinned){const h=1e-4,seen=new Map();
 for(const q of tris)for(const v of q.v){const d=f(v.p)-k;if(d===0||abs(d)>=SNAP)continue;const key=KEY(v.p);if(pinned?.has(key))continue;let p=seen.get(key);
  if(!p){const g=[0,1,2].map(c=>{const a=v.p.slice(),b=v.p.slice();a[c]+=h;b[c]-=h;return (f(a)-f(b))/(2*h);}),gg=g[0]*g[0]+g[1]*g[1]+g[2]*g[2];if(gg<1e-9)continue;
   // (sólo donde el plano corta la superficie de costado: donde la superficie lo mira de frente —el bajo de la panza, la
   // entrepierna para un plano horizontal— pegar el vértice lo saca de la superficie y el ruedo sale arrugado)
   const n=v.n||[0,0,0];if(abs((n[0]*g[0]+n[1]*g[1]+n[2]*g[2])/Math.sqrt(gg))>.5){seen.set(key,v.p);continue;}
   p=v.p.map((x,c)=>x-d*g[c]/gg);if(abs(f(p)-k)>1e-6)p=v.p;seen.set(key,p);}
  v.p=p;}}
function splitBy(tris,{f,k,on,where}){const out=[];for(const q of tris){if(on&&!on.includes(q.cls)||where&&!where(q.v.map(v=>v.p).reduce((a,p)=>[a[0]+p[0]/3,a[1]+p[1]/3,a[2]+p[2]/3],[0,0,0]))){out.push(q);continue;}
  // (un vértice SOBRE el plano va a los dos lados y no crea punto nuevo; sólo se parte si hay vértices estrictamente
  // a uno y otro lado —con los vértices pegados al plano, si no, salían triángulos degenerados)
  const sv=q.v.map(v=>{const d=f(v.p)-k;return abs(d)<1e-7?0:d;});if(!sv.some(x=>x>0)||!sv.some(x=>x<0)){out.push(q);continue;}const pos=[],neg=[];
  for(let e=0;e<3;e++){const a=q.v[e],c=q.v[(e+1)%3],sa=sv[e],sc=sv[(e+1)%3];if(sa>=0)pos.push(a);if(sa<=0)neg.push(a);if(sa*sc<0){const m=lerpV(a,c,sa/(sa-sc));pos.push(m);neg.push(m);}}
  for(const poly of [pos,neg])for(let j=1;j+1<poly.length;j++)out.push({v:[poly[0],poly[j],poly[j+1]],cls:q.cls,src:q.src});}return out;}
const KEY=p=>p.map(x=>Math.round(x*1e4)).join(',');
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

/* Viste la piel. source: la geometría completa (partSource) de un personaje desnudo; skinRanges: los rangos que se
   visten (la piel y los rellenos de las articulaciones); outfit: {slot: {id, color}}. Devuelve una geometría nueva con
   la piel vestida primero y el resto (cara, pelo) igual, y userData.wardrobeParts con un rango por prenda. */
export function dressGeometry(source,skinRanges,keepRanges,bones,outfit,{gapScale=1}={}){
 const skinHex=outfit?.skinColor||'#d9a77f',worn=Object.entries(outfit||{}).filter(([k,o])=>k!=='skinColor'&&o).map(([,o])=>o).map(o=>({...BY_ID.get(o.id),color:o.color||BY_ID.get(o.id)?.color})).filter(g=>g.id).sort((a,b)=>b.layer-a.layer);
 // 1. Los triángulos de la piel (cada superficie aparte: los rellenos no se cosen con la piel)
 let tris=[];skinRanges.forEach((r,src)=>{for(let i=r.start;i<r.start+r.count;i+=3)tris.push({v:[vtx(source,i),vtx(source,i+1),vtx(source,i+2)],src});});
 for(const q of tris)q.cls=classify(q.v,bones);
 // 2. Normal suave por posición (promedio por área de las caras que la tocan), en la malla ORIGINAL y dentro de cada
 // superficie; viaja con el vértice en los cortes (sin normalizar: así el punto inflado cae justo sobre la arista inflada)
 const normals=new Map();for(const q of tris){const fn=cross(sub(q.v[1].p,q.v[0].p),sub(q.v[2].p,q.v[0].p));for(const v of q.v){const k=q.src+'|'+KEY(v.p),n=normals.get(k)||[0,0,0];n[0]+=fn[0];n[1]+=fn[1];n[2]+=fn[2];normals.set(k,n);}}
 for(const n of normals.values()){const l=Math.hypot(...n)||1;n[0]/=l;n[1]/=l;n[2]/=l;}
 for(const q of tris)q.v=q.v.map(v=>({...v,n:normals.get(q.src+'|'+KEY(v.p))}));
 // 3. Los cortes de todas las prendas puestas (bordes limpios, sin dientes)
 // (los cortes de lo que queda tapado entero no se hacen: el bóxer bajo un pantalón, una falda o el vestido sólo partiría
 // triángulos en tiras de 1 cm contra el ruedo de arriba)
 // (camisa o polo con pantalón de cinturón: va metida, y el ruedo pasa a la cintura para que se vea el cinturón)
 if(worn.some(g=>g.belt))for(const g of worn)if(g.tuck){const c=g.covers;g.covers=t=>c(t)&&!(trunkish(t)&&t.c.y<CUT.waist);}
 // (dos cortes iguales de prendas distintas —atY(1.13) de la camiseta y del pantalón— son funciones distintas: se
 // comparan por su texto, su altura y sus clases)
 const sameCut=(a,b)=>a.k===b.k&&!a.where&&!b.where&&(a.f===b.f||a.f.toString()===b.f.toString())&&String(a.on)===String(b.on);
 const hidden=g=>g.slot==='underwear'&&worn.some(o=>o.slot==='bottom'||o.id==='vestido');
 const cuts=[];for(const g of worn)if(!hidden(g))for(const c of [...(g.cuts||[]),...(g.cutsExtra||[])])if(!cuts.some(x=>sameCut(x,c)))cuts.push(c);
 const pinned=new Set();for(const c of cuts){if(!c.where)snapTo(tris,c,pinned);tris=splitBy(tris,c);for(const q of tris)if(!c.on||c.on.includes(q.cls))for(const v of q.v)if(abs(c.f(v.p)-c.k)<1e-6)pinned.add(KEY(v.p));}
 // 4. Cada triángulo: la prenda de más afuera que lo tapa
 const cen=new THREE.Vector3(),nrm=new THREE.Vector3(),gaps=new Map([[null,0]]);
 for(const q of tris){const [a,b,c]=q.v.map(v=>v.p);cen.set((a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3,(a[2]+b[2]+c[2])/3);nrm.fromArray(cross(sub(b,a),sub(c,a))).normalize();
  const t={c:cen,n:nrm,cls:q.cls,trunk:trunkShare(q.v,bones)},g=worn.find(g=>g.covers(t));q.owner=g?.id||null;q.layer=g?.layer||0;q.gap=((g?.gapOf?.(t)??g?.gap)||0)*(g?.slot==='hair'?1:gapScale);gaps.set(q.owner,q.gap);
  if(g){const col=new THREE.Color(g.paint?.(t,g.color,skinHex)||g.color);q.v=q.v.map(v=>({...v,col:[col.r,col.g,col.b]}));}}
 const edges=new Map();tris.forEach((q,ti)=>{for(let e=0;e<3;e++){const a=q.v[e],b=q.v[(e+1)%3],ka=KEY(a.p),kb=KEY(b.p);const key=q.src+'|'+(ka<kb?ka+'#'+kb:kb+'#'+ka);const l=edges.get(key);if(l)l.push([ti,e]);else edges.set(key,[[ti,e]]);}});
 // 5. Inflar. La normal se vuelve a promediar en la malla ya cortada: la interpolada deja el ruedo en diente de sierra
 // donde la superficie gira (la panza del gordo). Sólo en las juntas en T (aristas con un solo triángulo) se usa la
 // interpolada, para que el punto caiga sobre la arista del vecino.
 const VK=(q,v)=>q.src+'|'+KEY(v.p),finalN=new Map(),tee=new Set();
 for(const q of tris){const fn=cross(sub(q.v[1].p,q.v[0].p),sub(q.v[2].p,q.v[0].p));for(const v of q.v){const k=VK(q,v),n=finalN.get(k)||[0,0,0];n[0]+=fn[0];n[1]+=fn[1];n[2]+=fn[2];finalN.set(k,n);}}
 for(const [key,list] of edges)if(list.length===1){const [ti,e]=list[0],q=tris[ti];tee.add(VK(q,q.v[e]));tee.add(VK(q,q.v[(e+1)%3]));}
 const unit=n=>{const l=Math.hypot(...n)||1;return [n[0]/l,n[1]/l,n[2]/l];};
 // (swell: una holgura que varía por punto —el pelo, más alto en la coronilla—; entra en la clave para no mezclarse con
 // la misma holgura de otra prenda)
 const SW=owner=>BY_ID.get(owner)?.swell,KG=q=>q.gap+'|'+(SW(q.owner)?q.owner:'');
 const lifted=new Map(),normalOf=new Map(),posOf=(q,v)=>{const k=VK(q,v)+'|'+KG(q);let p=lifted.get(k);if(!p){const n=hang(q,unit(tee.has(VK(q,v))?v.n:finalN.get(VK(q,v)))),sw=SW(q.owner),gap=q.gap+(sw?sw(v.p):0);p=[v.p[0]+n[0]*gap,v.p[1]+n[1]*gap,v.p[2]+n[2]*gap];lifted.set(k,p);normalOf.set(k,n);}return p;};
 const raised=q=>q.gap||SW(q.owner);
 // (la tela cuelga: bajo la panza o el pecho no se infla hacia abajo, sale de costado. Si siguiera la normal, el ruedo
 // que cae en esa cara casi horizontal se abriría en púas hacia abajo)
 const hang=(q,n)=>{if(!q.owner||SW(q.owner)||BY_ID.get(q.owner)?.slot==='hair'||n[1]>=0)return n;const m=[n[0],n[1]*.3,n[2]],l=Math.hypot(...m)||1;return [m[0]/l,m[1]/l,m[2]/l];};
 for(const q of tris)if(raised(q))for(const v of q.v)posOf(q,v);
 // (planchar: dos pasadas de suavizado dentro de cada prenda, sin mover sus bordes; la tela no copia cada faceta del
 // cuerpo —el gordo sale de una piel muy facetada— y se lee como una superficie)
 const ring=new Map(),fixed=new Set();
 for(const [,list] of edges){const qs=list.map(([ti])=>tris[ti]),[ti,e]=list[0],q=tris[ti];if(!raised(q))continue;const ka=VK(q,q.v[e])+'|'+KG(q),kb=VK(q,q.v[(e+1)%3])+'|'+KG(q);
  if(list.length!==2||qs.some(x=>KG(x)!==KG(q))){fixed.add(ka);fixed.add(kb);continue;}
  (ring.get(ka)||ring.set(ka,new Set()).get(ka)).add(kb);(ring.get(kb)||ring.set(kb,new Set()).get(kb)).add(ka);}
 const kgs=new Set(tris.map(KG));for(const k of tee)for(const g of kgs)fixed.add(k+'|'+g);
 for(let it=0;it<2;it++){const next=new Map();for(const [k,ns] of ring){if(fixed.has(k)||ns.size<3)continue;const p=lifted.get(k),m=[0,0,0];for(const n of ns){const q=lifted.get(n);m[0]+=q[0];m[1]+=q[1];m[2]+=q[2];}
   // (sólo a lo largo de la normal: de costado, el suavizado torcería las franjas pintadas y los cortes)
   const n=normalOf.get(k),d=((m[0]/ns.size-p[0])*n[0]+(m[1]/ns.size-p[1])*n[1]+(m[2]/ns.size-p[2])*n[2])*.5;next.set(k,[p[0]+n[0]*d,p[1]+n[1]*d,p[2]+n[2]*d]);}
  for(const [k,p] of next)lifted.set(k,p);}
 const lift=(v,q)=>raised(q)?{...v,p:posOf(q,v)}:v;
 // 6. Escalones donde cambia la holgura: el ruedo, el puño, el canto del chaleco. (La piel es cerrada: una arista con
 // un solo triángulo es una junta en T de un corte, no un borde, y no lleva escalón.)
 const center=q=>[0,1,2].map(c=>(q.v[0].p[c]+q.v[1].p[c]+q.v[2].p[c])/3);
 const steps=[];
 for(const list of edges.values()){
  if(list.length!==2)continue;const [[ta,ea],[tb,eb]]=list,A=tris[ta],B=tris[tb];if(KG(A)===KG(B))continue;
  const aHi=A.gap!==B.gap?A.gap>B.gap:!!SW(A.owner);const [hi,he,lo]=aHi?[A,ea,B]:[B,eb,A];steps.push({hi,e:he,lo,away:center(hi),toward:center(lo)});}
 const quads=[];for(const s of steps){const a=s.hi.v[s.e],b=s.hi.v[(s.e+1)%3],ha=lift(a,s.hi),hb=lift(b,s.hi),la=lift(a,s.lo),lb=lift(b,s.lo);
  // (el canto, apenas más oscuro que la prenda: marca el borde sin geometría extra)
  const col=s.hi.owner?(()=>{const c=new THREE.Color().fromArray(s.hi.v[0].col).multiplyScalar(.9);return [c.r,c.g,c.b];})():a.col;
  let poly=[la,lb,hb,ha].map(v=>({...v,col}));
  // (que mire hacia el lado bajo: el escalón se ve desde afuera de la prenda)
  const n=cross(sub(poly[1].p,poly[0].p),sub(poly[2].p,poly[0].p)),mid=[0,1,2].map(c=>(a.p[c]+b.p[c])/2),dir=s.toward?sub(s.toward,s.away):sub(mid,s.away);
  if(n[0]*dir[0]+n[1]*dir[1]+n[2]*dir[2]<0)poly=poly.reverse();
  quads.push({v:[poly[0],poly[1],poly[2]],owner:s.hi.owner},{v:[poly[0],poly[2],poly[3]],owner:s.hi.owner});}
 // 7. Armar: piel desnuda primero, después cada prenda (rangos contiguos para extraerlas), y el resto igual
 // (joint: el triángulo es del relleno de un codo o una rodilla —una esfera chica—; las versiones de lejos lo sacan)
 const out=tris.map(q=>({v:q.v.map(v=>lift(v,q)),owner:q.owner,joint:!!skinRanges[q.src]?.joint})).concat(quads);
 for(const g of worn)if(g.build)for(const v of g.build({tris,bones,color:g.color,gapScale,regionGap:g.gap*gapScale}))out.push({v,owner:g.id});
 const order=[null,...worn.map(g=>g.id).reverse()];out.sort((a,b)=>order.indexOf(a.owner)-order.indexOf(b.owner));
 // (con capucha, el pelo que cae por la espalda y por los costados —donde va el rollo de la capucha, a más de ~57° del
 // frente— se mete adentro: se omiten sus triángulos bajo la nuca; los mechones que enmarcan la cara quedan)
 // (con gorro, el pelo se corta en el borde del gorro —hairCut(p) > 0 es adentro—: los triángulos que lo cruzan se
 // parten ahí y queda la parte de afuera, pegada al doblez; así no queda una franja de cabeza sin pelo bajo el gorro)
 const hat=worn.find(g=>g.hairCut),tuck=worn.some(g=>g.tuckHair),SP=source.attributes.position.array,keepTri=(r,k)=>{if(!(tuck||hat)||r.role!=='hair')return true;let x=0,y=0,z=0;for(let q=0;q<3;q++){x+=SP[(k+q)*3]/3;y+=SP[(k+q)*3+1]/3;z+=SP[(k+q)*3+2]/3;}
  return !(tuck&&y<HAIR_TUCK_Y&&inHood(x,z));};
 const kept=keepRanges.map(r=>{const ids=[],extra=[];for(let k=r.start;k<r.start+r.count;k+=3){if(!keepTri(r,k))continue;
  if(hat&&r.role==='hair'){const f=[0,1,2].map(q=>hat.hairCut([SP[(k+q)*3],SP[(k+q)*3+1],SP[(k+q)*3+2]]));if(f.every(x=>x>0))continue;
   if(f.some(x=>x>0)){const q={v:[0,1,2].map(d=>({...vtx(source,k+d),n:[0,0,0]})),cls:'hair'};for(const t of splitBy([q],{f:hat.hairCut,k:0}))if(t.v.every(v=>hat.hairCut(v.p)<=1e-6))extra.push(t.v);continue;}}
  ids.push(k);}return {r,ids,extra};});
 const keepCount=kept.reduce((s,x)=>s+(x.ids.length+x.extra.length)*3,0),n=out.length*3+keepCount;
 const P=new Float32Array(n*3),C=new Float32Array(n*3),M=new Float32Array(n*3),J=new Uint16Array(n*4),W=new Float32Array(n*4),parts=[];let i=0;
 const jointTris=[];
 for(const q of out){if(q.joint)jointTris.push(i);const last=parts[parts.length-1];if(!last||last.id!==(q.owner||'body'))parts.push({id:q.owner||'body',slot:q.owner?BY_ID.get(q.owner).slot:'body',role:q.owner?'cloth':'skin',start:i,count:0});
  for(const v of q.v){P.set(v.p,i*3);C.set(v.col,i*3);M.set(v.m,i*3);J.set(v.j,i*4);W.set(v.w,i*4);i++;}parts[parts.length-1].count+=3;}
 const SM=source.morphAttributes.position?.[0];
 for(const {r,ids,extra} of kept){parts.push({...r,start:i,count:(ids.length+extra.length)*3});for(const t of ids)for(let k=t;k<t+3;k++){for(let c=0;c<3;c++){P[i*3+c]=SP[k*3+c];C[i*3+c]=source.attributes.color.array[k*3+c];M[i*3+c]=SM?SM.array[k*3+c]:0;}
  for(let c=0;c<4;c++){J[i*4+c]=source.attributes.skinIndex.array[k*4+c];W[i*4+c]=source.attributes.skinWeight.array[k*4+c];}
  // (y lo que queda del mechón —un triángulo largo con el centro arriba del corte— se recoge hasta el borde de la capucha)
  if(tuck&&r.role==='hair'&&inHood(P[i*3],P[i*3+2])&&P[i*3+1]<HAIR_TUCK_Y)P[i*3+1]=HAIR_TUCK_Y;i++;}
  for(const tri of extra)for(const v of tri){P.set(v.p,i*3);C.set(v.col,i*3);M.set(v.m,i*3);J.set(v.j,i*4);W.set(v.w,i*4);i++;}}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(P,3));g.setAttribute('color',new THREE.BufferAttribute(C,3));
 g.setAttribute('skinIndex',new THREE.BufferAttribute(J,4));g.setAttribute('skinWeight',new THREE.BufferAttribute(W,4));
 g.morphAttributes.position=[new THREE.BufferAttribute(M,3)];g.morphAttributes.position[0].name='Sentado';g.morphTargetsRelative=true;
 g.userData={jointTris,wardrobeParts:parts,dressed:{triangles:n/3,cloth:out.length-quads.length,steps:quads.length,cuts:cuts.length,open:[...edges.values()].filter(l=>l.length===1).length}};
 g.computeBoundingBox();g.computeBoundingSphere();return g;}

// ---------- El cuerpo con IA ----------
const GEN=new Map();
async function generated(url){if(!GEN.has(url))GEN.set(url,(async()=>{const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js'),{mergeGeometries}=await import('three/addons/utils/BufferGeometryUtils.js');
 const gltf=await new GLTFLoader().loadAsync(url),parts=[];gltf.scene.updateWorldMatrix(true,true);
 gltf.scene.traverse(o=>{if(!o.isMesh)return;let G=o.geometry.clone();G.applyMatrix4(o.matrixWorld);if(G.index)G=G.toNonIndexed();for(const k of Object.keys(G.attributes))if(k!=='position')G.deleteAttribute(k);parts.push(G);});
 return parts.length>1?mergeGeometries(parts):parts[0];})());return GEN.get(url);}
const sliceTris=(g,r)=>{const out=new THREE.BufferGeometry();for(const [k,a] of Object.entries(g.attributes))out.setAttribute(k,new THREE.BufferAttribute(a.array.slice(r.start*a.itemSize,(r.start+r.count)*a.itemSize),a.itemSize));const M=g.morphAttributes.position?.[0];if(M)out.morphAttributes.position=[new THREE.BufferAttribute(M.array.slice(r.start*3,(r.start+r.count)*3),3)];return out;};
function joinParts(list){// [{g, range:{...}}] → una geometría con rangos contiguos
 const n=list.reduce((s,x)=>s+x.g.attributes.position.count,0),P=new Float32Array(n*3),C=new Float32Array(n*3),M=new Float32Array(n*3),J=new Uint16Array(n*4),W=new Float32Array(n*4),parts=[];let i=0;
 for(const {g,range} of list){const c=g.attributes.position.count;P.set(g.attributes.position.array,i*3);C.set(g.attributes.color.array,i*3);if(g.morphAttributes.position?.[0])M.set(g.morphAttributes.position[0].array,i*3);J.set(g.attributes.skinIndex.array,i*4);W.set(g.attributes.skinWeight.array,i*4);parts.push({...range,start:i,count:c});i+=c;}
 const out=new THREE.BufferGeometry();out.setAttribute('position',new THREE.BufferAttribute(P,3));out.setAttribute('color',new THREE.BufferAttribute(C,3));out.setAttribute('skinIndex',new THREE.BufferAttribute(J,4));out.setAttribute('skinWeight',new THREE.BufferAttribute(W,4));
 out.morphAttributes.position=[new THREE.BufferAttribute(M,3)];out.morphTargetsRelative=true;out.userData={wardrobeParts:parts};return out;}
async function iaBody(kind,source,ranges){
 const skinR=ranges.find(r=>r.role==='skin'),ourSkin=sliceTris(source,skinR),skinCol=[...source.attributes.color.array.slice(skinR.start*3,skinR.start*3+3)];
 if(kind==='ia-a'){
  const {geometry:g}=newSkin(await generated('/models/pelos-ia/cuerpo-F-smart.glb'),ourSkin),c=g.attributes.position.count,col=new Float32Array(c*3);for(let i=0;i<c;i++)col.set(skinCol,i*3);g.setAttribute('color',new THREE.BufferAttribute(col,3));
  // (la piel generada trae sus orejas, pies y articulaciones: fuera los rellenos y las orejas de la nuestra; quedan cara y pelo)
  const keep=ranges.filter(r=>r!==skinR&&r.role!=='body'&&r.id!=='body');
  // (la cara —ojos y cejas— se apoya sobre la cabeza nueva)
  const parts=keep.map(r=>({g:sliceTris(source,r),range:r}));for(const x of parts)if(x.range.role==='face')projectDecal(x.g,g,.008);
  const out=joinParts([{g,range:skinR},...parts]);return {source:out,ranges:out.userData.wardrobeParts};}
 const {positions}=shrinkSkin(ourSkin,await generated('/models/pelos-ia/cuerpo-F-h.glb'),1),out=source.clone();out.attributes.position.array.set(positions,skinR.start*3);
 // (lo que va pegado a la piel —cara, orejas, rellenos— se mueve como el vértice de piel más cercano)
 for(const r of ranges)if(r!==skinR&&r.role!=='hair'){const g=sliceTris(source,r);followDisplacement(g,ourSkin.attributes.position.array,positions);out.attributes.position.array.set(g.attributes.position.array,r.start*3);}
 out.attributes.position.needsUpdate=true;out.userData={...source.userData};
 return {source:out,ranges};}

// ---------- El personaje del vestier ----------
// body: {contextura, piel, pelo (color), peinado (id del catálogo o ''), barba (id o '')} —sin sexo: un solo muñeco—. El cuerpo se arma una vez
// (desnudo, sin calzones del ropero); cambiar de ropa sólo rehace la geometría (milisegundos) con dress().
export async function makeDressable(body){
 // (un peinado «capa:» no es una pieza del catálogo: se viste sobre la cabeza calva, como la ropa)
 const layerHair=/^(capa|ia):/.test(body.peinado||'')?body.peinado:null;if(layerHair?.startsWith('ia:')){const name=layerHair.slice(3);IA_HAIR.set(name,await loadHair(name));}
 const hairColor=COLORS.pelo[body.pelo]||body.pelo||COLORS.pelo.castaño,skinColor=COLORS.piel[body.piel]||COLORS.piel.media;
 const p=await makePersona2({modelo:CUERPO_UNICO.muneco,sexo:'h',cuerpo:'paquete',// (el muñeco sin género: vestuario.js CUERPO_UNICO)
 contextura:body.contextura,cabeza:1,desnudo:true,ropaInterior:false,zapatos:'no',optimizarRopa:false,
  piel:body.piel,pelo:body.pelo,ojos:'negros',...(body.peinado&&!layerHair?{pzPelo:body.peinado}:{peinado:'calvo'}),...(body.barba?{pzBigote:body.barba}:{})},()=>0);
 let source=p.partSource,ranges=source.userData.wardrobeParts||p.parts;const bones=p.mesh.skeleton.bones;
 // (el cuerpo con IA —cuerpoIA.js—: «ia-a» cambia la piel por la malla generada; «ia-b» encoge la nuestra sobre ella)
 if(body.cuerpo==='ia-a'||body.cuerpo==='ia-b')({source,ranges}=await iaBody(body.cuerpo,source,ranges));
 // (optimizarRopa:false: va desnudo, la optimización del ropero viejo no tiene nada que hacer y costaba ~20 ms por persona)
 // (la piel, los pies y los rellenos de codos y rodillas se visten; la cara, las orejas y el pelo se copian)
 const headOnly=r=>{const J=source.attributes.skinIndex.array,W=source.attributes.skinWeight.array;for(let i=r.start;i<r.start+r.count;i++){let best=0,bj=0;for(let k=0;k<4;k++)if(W[i*4+k]>best){best=W[i*4+k];bj=J[i*4+k];}if(!/^Head/.test(bones[bj]?.name||''))return false;}return true;};
 // (sin los rellenos de codos y rodillas —esferas chicas en la articulación—: en la piel desnuda y en la versión de lejos
 // asomaban como círculos; Miguel los pidió fuera, 2026-10-14)
 ranges=ranges.filter(r=>!r.joint);
 const skinRanges=ranges.filter(r=>r.role==='skin'||r.id==='body'&&!headOnly(r)),keepRanges=ranges.filter(r=>!skinRanges.includes(r));
 const root=p.holder.children[0],baseUpdate=p.mixer.update,baseContact=p.mixer.armContact;
 // (gordo y robusto: la piel pulida es más ancha; la holgura igual en unidades, se ve parecida)
 const gapScale=body.contextura==='gordo'?1.15:body.contextura==='robusto'?1.08:1;
 function dress(outfit){
  const g=dressGeometry(source,skinRanges,keepRanges,bones,{...outfit,skinColor,...(layerHair?{hair:{id:layerHair,color:hairColor}}:{})},{gapScale}),old=p.mesh.geometry;
  p.mesh.geometry=g;p.mesh.updateMorphTargets();if(old!==source&&old!==full)old.dispose();if(full&&full!==source)full.dispose();lodCache?.then(L=>L.forEach(x=>x.dispose()));
  // (el contacto de los brazos se vuelve a medir con la ropa puesta: el tronco vestido es más ancho)
  p.mixer.update=baseUpdate;if(baseContact)baseContact.enabled=false;armContactProfile(p.mesh,null);installArmContact(root,p.mixer,p.mesh);
  p.tris=g.attributes.position.count/3;p.dressed=g.userData.dressed;lodCache=null;full=g;return g;}
 // Versiones de lejos (como characters3d.js: la misma malla con otra geometría, comparte esqueleto y animación). Se
 // simplifica el personaje YA vestido: la ropa no deja piel debajo, así que no hay que tapar nada. ratios: fracción de
 // triángulos que queda (.35 a media distancia, .15 lejos).
 let lodCache=null,full=null;
 // (la cara —ojos, cejas— no se simplifica: lejos se perdía un ojo; se separa, se simplifica el resto y se vuelve a juntar)
 async function lodOf(g,r){const parts=g.userData.wardrobeParts||[],face=parts.filter(x=>x.role==='face'),keep=[],rest=[];
  const joints=new Set(g.userData.jointTris||[]);
  // (los rellenos de codos y rodillas se sacan: al simplificar el brazo se angosta y la esfera asomaba como un círculo)
  for(let t=0;t<g.attributes.position.count;t+=3){if(joints.has(t))continue;(face.some(x=>t>=x.start&&t<x.start+x.count)?keep:rest).push(t);}
  const pick=ts=>{const out=new THREE.BufferGeometry();for(const [k,a] of Object.entries(g.attributes)){const A=new a.array.constructor(ts.length*3*a.itemSize);ts.forEach((t,i)=>{for(let q=0;q<3;q++)A.set(a.array.subarray((t+q)*a.itemSize,(t+q+1)*a.itemSize),(i*3+q)*a.itemSize);});out.setAttribute(k,new THREE.BufferAttribute(A,a.itemSize));}
   const M=g.morphAttributes.position?.[0];if(M){const A=new Float32Array(ts.length*9);ts.forEach((t,i)=>A.set(M.array.subarray(t*3,t*3+9),i*9));out.morphAttributes.position=[new THREE.BufferAttribute(A,3)];out.morphAttributes.position[0].name='Sentado';out.morphTargetsRelative=true;}return out;};
  const low=await lowGeo(pick(rest),r),f=pick(keep),out=new THREE.BufferGeometry();
  for(const k of ['position','color','skinIndex','skinWeight']){const a=low.attributes[k],b=f.attributes[k],A=new a.array.constructor(a.array.length+b.array.length);A.set(a.array);A.set(b.array,a.array.length);out.setAttribute(k,new THREE.BufferAttribute(A,a.itemSize));}
  const ma=low.morphAttributes.position?.[0],mb=f.morphAttributes.position?.[0],n=out.attributes.position.count,M=new Float32Array(n*3);if(ma)M.set(ma.array);if(mb)M.set(mb.array,low.attributes.position.count*3);
  out.morphAttributes.position=[new THREE.BufferAttribute(M,3)];out.morphAttributes.position[0].name='Sentado';out.morphTargetsRelative=true;out.computeBoundingSphere();low.dispose();f.dispose();return out;}
 async function lods(ratios=[.35,.15]){if(!full)return [];if(!lodCache){const g=full;lodCache=Promise.all(ratios.map(r=>lodOf(g,r)));}return lodCache;}
 // k: 0 cerca (la vestida entera), 1 media, 2 lejos
 async function showLod(k){const L=k?(await lods())[k-1]:full;if(L&&p.mesh.geometry!==L){p.mesh.geometry=L;p.mesh.updateMorphTargets();}return L;}
 return {...p,dress,lods,showLod,release(){p.mixer.stopAllAction();p.mixer.uncacheRoot(root);p.holder.removeFromParent();p.mesh.geometry.dispose();source.dispose();p.mesh.skeleton.dispose();}};
}
export const garmentById=id=>BY_ID.get(id);
