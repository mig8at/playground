// Experimento «botin» del calibrador (2026-10-18): la meta por ladrón (y la duración) del modo «Botín» para que los dos
// bandos ganen la mitad de las veces en cada tamaño de equipo (bots contra bots, engine/juego). Lento: pocas rondas.
import {generateBlueprint} from '../../src/engine/blueprint.js';
import {prepararCiudad,crearPartida,paso} from '../../src/engine/juego/partida.js';
import {decidir} from '../../src/engine/juego/bots.js';
import {MODO_BOTIN as M} from '../../src/engine/medidas.js';
export const nombre='botin';
export const descripcion='la meta por ladrón para que los ladrones ganen ~50 % en 2, 3, 5 y 8 por equipo';
export const parametros=[{ruta:'MODO_BOTIN.meta',min:5,max:12}];
const ciudades=new Map();
export async function evaluar({semillas=[1],rondas=8,equipos=[2,3,5,8]}={}){const det=[];let L=0;
 for(const eq of equipos){let g=0,n=0;
  for(const s of semillas){if(!ciudades.has(s))ciudades.set(s,prepararCiudad(generateBlueprint({seed:s,team:3})));const C=ciudades.get(s);
   for(let ronda=0;ronda<rondas;ronda++){const P=crearPartida(C,{equipo:eq,ronda,meta:M.meta});while(!P.fin){decidir(P);paso(P);}n++;if(P.fin.gana==='ladron')g++;}}
  const p=g/n,e=Math.max(0,Math.abs(p-.5)-.05);L+=(e/.1)**2;det.push({meta:`ladrones ganan con ${eq} por equipo`,valor:+p.toFixed(2),rango:[.45,.55],ok:e===0});}
 return {perdida:L,detalle:det};}
