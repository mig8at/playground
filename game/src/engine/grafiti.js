// EL GRAFITI: PIXEL ART SOBRE UN PAÑO DE MURO (2026-11-21, Miguel: «que las personas puedan hacer pixel art en las
// fachadas», lo que había pedido al definir el rumbo: «cada quien va poniendo punticos y deja algo escrito o dibujado»).
//
// Un paño pintable (engine/fachada-medida.js paniosPintables) es un rectángulo de muro en metros. Acá se vuelve una
// GRILLA: píxeles de GRAFITI.px de lado (10 cm), los que entran enteros en el paño, centrados. Un grafiti es esa grilla
// con un color de la PALETA en cada píxel, o nada. No dibuja ni guarda: da las cuentas, para que el editor del plano 2D,
// el 3D y un servidor que reciba lo que pinta alguien usen exactamente lo mismo.
//   celdas: una letra por píxel, de izquierda a derecha y de ARRIBA hacia abajo; '0' es sin pintar y '1'…'f', el color
//   de ese lugar de la paleta. Una grilla de 48 × 18 son 864 letras.
export const GRAFITI={px:.1,paleta:[null,'#16181b','#ffffff','#e2433b','#f07f2c','#f2c230','#2f9e6b','#3fb6c4','#2f6fbf','#6a3fa0','#c2408a','#8a5a3a','#9aa3a8','#5d6266','#9ed27a','#f4c7c3']};
const HEX='0123456789abcdef';

// La grilla de un paño: cuántos píxeles tiene y dónde empieza (du, dy: lo que sobra a cada lado, en metros).
export function lienzoDe(p){const px=GRAFITI.px,cols=Math.floor(p.ancho/px+1e-6),rows=Math.floor(p.alto/px+1e-6);return {cols,rows,px,du:(p.ancho-cols*px)/2,dy:(p.alto-rows*px)/2};}
export const vacio=(cols,rows)=>({cols,rows,celdas:'0'.repeat(cols*rows)});
export const colorEn=(g,c,f)=>c<0||f<0||c>=g.cols||f>=g.rows?null:GRAFITI.paleta[HEX.indexOf(g.celdas[f*g.cols+c])]||null;
// Pinta un píxel (color: su lugar en la paleta; 0 borra). Devuelve OTRO grafiti: el que recibe no cambia.
export function pintar(g,c,f,color){if(c<0||f<0||c>=g.cols||f>=g.rows||!(color>=0&&color<GRAFITI.paleta.length))return g;const i=f*g.cols+c,l=HEX[color];if(g.celdas[i]===l)return g;return {...g,celdas:g.celdas.slice(0,i)+l+g.celdas.slice(i+1)};}
export const pintados=g=>{let n=0;for(const ch of g.celdas)if(ch!=='0')n++;return n;};
// ¿Este grafiti es de este paño? (lo que valida un servidor antes de aceptarlo)
export function valido(g,p){const L=lienzoDe(p);if(!g||g.cols!==L.cols||g.rows!==L.rows)return {ok:false,razon:`La grilla de este paño es de ${L.cols} × ${L.rows} píxeles.`};if(typeof g.celdas!=='string'||g.celdas.length!==L.cols*L.rows)return {ok:false,razon:'Faltan o sobran píxeles.'};
 for(const ch of g.celdas)if(!HEX.includes(ch))return {ok:false,razon:'Hay un color que no es de la paleta.'};return {ok:true};}
// De un punto del paño (u a lo largo desde su borde izquierdo, y hacia arriba desde su borde de abajo, en metros) a su
// píxel {c, f}; null si cae en el margen.
export function pixelEn(p,u,y){const L=lienzoDe(p),c=Math.floor((u-L.du)/L.px),f=L.rows-1-Math.floor((y-L.dy)/L.px);return c<0||f<0||c>=L.cols||f>=L.rows?null:{c,f};}
// La clave de una ciudad en lo guardado.
export const claveCiudad=(seed,team)=>seed+'|'+team;
