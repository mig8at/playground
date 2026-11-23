/* LOS COLORES DEL MUNDO (2026-11-22, Miguel: «aplicar color a todo coherentemente desde el motor 2D hasta el 3D; por ahora no
   apliquemos texturas a nada, sólo color armónico a todo, coherente a lo que es cada cosa: color plano»).
   El motor decide el color de cada cosa y el 3D sólo lo dibuja, plano, sin texturas:
   · los edificios y las casas: color.js (cada fachada, moldura, techo y cuarto, con PALETA de medidas.js);
   · los árboles: su especie (medidas.js VEGETACION.especies: el follaje y la flor; contrato3d tinte);
   · todo lo demás —el suelo, el agua, la madera, el metal, el vidrio, los muebles, los autos, los animales—: esta tabla.
   Una sola familia de tonos para que todo combine: la de Bogotá —ladrillo, cremas, grises cálidos, verdes apagados—; ningún
   color puro (ni blanco ni negro del todo) y la saturación contenida.
   · COLOR: la tabla, por lo que es cada cosa;
   · colorDeNombre(nombre): el color de un material de un modelo por su nombre («Wood», «Leaves», «Glass»…), o null;
   · armonizar(hex): un color cualquiera llevado a la familia (el croma y la luz dentro de ARMONIA), con su tono. */

export const COLOR={
 suelo:{asfalto:'#55585b',anden:'#bfb8aa',adoquin:'#b07b5a',pasto:'#7c9a54',cancha:'#8fa56b',tierra:'#a48b68',arena:'#e0cd9e',
  pradera:'#93ad66',roca:'#8d867a',concreto:'#b4ada0',patio:'#cdbf9f'},
 agua:{baja:'#6aa9bf',honda:'#3f7c9a'},
 vegetacion:{follaje:'#6f9150',tronco:'#6e5139',flor:'#e3a3b6'},
 material:{madera:'#8c6342',maderaClara:'#c19a6b',metal:'#5d636a',metalClaro:'#9aa1a6',blanco:'#ece7dc',negro:'#2c2b29',
  vidrio:'#a9c3cc',tela:'#8f8576',ceramica:'#e4dfd4',piedra:'#9b9388',ladrillo:'#a5573c',goma:'#33312e',luz:'#fff1c9'},
 vehiculo:['#c9c2b4','#5b6169','#2f3a4a','#8e3b2f','#3e5a46','#d8b04a','#7b8794','#ece7dc'],
 animal:{pelaje:'#a07c5a',claro:'#d9ccb4',oscuro:'#3b332c',rosa:'#d8a39a'}};

// (el nombre del material de un modelo —en inglés, como vienen los paquetes— a lo que es)
const POR_NOMBRE=[
 [/leaf|leaves|foliage|bush|green|grass|hoja/i,COLOR.vegetacion.follaje],[/trunk|bark|tronco/i,COLOR.vegetacion.tronco],[/^tree/i,COLOR.vegetacion.tronco],
 [/glass|window|vidrio/i,COLOR.material.vidrio],[/wood|plank|madera|kitchen$/i,COLOR.material.madera],[/kitchentop|counter|marble/i,COLOR.material.ceramica],
 [/metal|steel|iron|chrome|silver/i,COLOR.material.metal],[/tire|wheel|rubber/i,COLOR.material.goma],[/fabric|cloth|cushion|sofa|tela/i,COLOR.material.tela],
 [/stone|rock|piedra/i,COLOR.material.piedra],[/brick/i,COLOR.material.ladrillo],[/light|lamp|bulb/i,COLOR.material.luz],
 [/^white|blanco/i,COLOR.material.blanco],[/^black|eye_black/i,COLOR.material.negro],[/eye_white/i,COLOR.material.blanco],[/water|agua/i,COLOR.agua.baja]];
export function colorDeNombre(nombre=''){for(const [re,c] of POR_NOMBRE)if(re.test(nombre))return c;return null;}

// La familia: el croma (lo vivo de un color: máximo menos mínimo de sus canales) hasta cromaMax y la luz entre luzMin y
// luzMax. El tope está por encima de todo lo que decide el motor (los acentos de PALETA y las flores de las especies llegan a
// 0,88, medido —validar-colores—): eso no cambia; lo que se recorta son los colores puros de los modelos (un rojo o un
// amarillo de fábrica, croma 1) y el blanco y el negro absolutos.
export const ARMONIA={cromaMax:.9,luzMin:.14,luzMax:.94};
const aHsl=h=>{const n=parseInt(h.slice(1,7),16),r=(n>>16&255)/255,g=(n>>8&255)/255,b=(n&255)/255,M=Math.max(r,g,b),m=Math.min(r,g,b),l=(M+m)/2,d=M-m;
 if(!d)return [0,0,l];const s=d/(1-Math.abs(2*l-1)),hh=M===r?((g-b)/d+6)%6:M===g?(b-r)/d+2:(r-g)/d+4;return [hh*60,s,l];};
const aHex=(h,s,l)=>{const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2,[r,g,b]=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
 return '#'+[r,g,b].map(v=>Math.round(Math.max(0,Math.min(1,v+m))*255).toString(16).padStart(2,'0')).join('');};
export function armonizar(hex){if(!/^#[0-9a-f]{6}$/i.test(hex||''))return COLOR.material.blanco;const [h,s,l0]=aHsl(hex),A=ARMONIA,l=Math.max(A.luzMin,Math.min(A.luzMax,l0)),k=1-Math.abs(2*l-1);
 const c=Math.min(s*k,A.cromaMax);return aHex(h,k?c/k:0,l);}
export const saturacion=hex=>aHsl(hex)[1],luz=hex=>aHsl(hex)[2];
