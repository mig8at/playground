/* EL ESTADO DEL MUNDO (2026-11-22, Miguel: «que se pueda abrir y cerrar una ventana y se guarde el estado, al igual que una
   puerta; eso va a servir luego en el modo multijugador»). Lo que cambia un jugador y tiene que quedar —y, en multijugador,
   verlo los demás—, como DATOS: un mapa por tipo, de una clave fija a su valor. Puro: no sabe del 3D ni de dónde se guarda
   (lib/estadoGuardado.js lo guarda en el navegador; un servidor repartiría estos mismos cambios entre jugadores).
   · puertas: clave de la puerta (su lugar: puertaClave) → true si está abierta (las cerradas no se anotan: es lo de fábrica);
   · ventanas: clave de la ventana (lote:piso:ventana, la del paño —town3d—) → true si está abierta (de fábrica, cerradas).
   cambiar(estado, tipo, clave, valor) devuelve el cambio {tipo, clave, valor, t} —lo que se mandaría por la red— o null si
   no cambió nada. */
export const TIPOS=['puertas','ventanas'];
export const crearEstado=()=>Object.fromEntries(TIPOS.map(t=>[t,{}]));
// (la clave de una puerta: su lugar al centímetro —el centro de la hoja y la altura del piso—; el mismo plano da la misma)
export const puertaClave=p=>`${p.cx.toFixed(2)},${p.cz.toFixed(2)},${p.cy.toFixed(1)}`;
export function cambiar(E,tipo,clave,valor){if(!E[tipo])throw Error('tipo de estado desconocido: '+tipo);const antes=!!E[tipo][clave];if(antes===!!valor)return null;
 if(valor)E[tipo][clave]=true;else delete E[tipo][clave];return {tipo,clave,valor:!!valor,t:Date.now()};}
export const abiertas=(E,tipo)=>Object.keys(E?.[tipo]||{});
// (lo que llega de afuera —lo guardado, otro jugador— se acepta sólo si tiene la forma: tipos conocidos y valores true)
export function leerEstado(o){const E=crearEstado();for(const t of TIPOS)for(const [k,v] of Object.entries(o?.[t]||{}))if(v===true&&typeof k==='string'&&k.length<80)E[t][k]=true;return E;}
