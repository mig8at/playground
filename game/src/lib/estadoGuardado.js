// El estado del mundo de una ciudad, guardado en el navegador (2026-11-22; engine/estadoMundo.js). Por ciudad —semilla y tamaño—:
// las puertas y ventanas abiertas siguen así al volver. Si el navegador no deja guardar (ventana privada, sin espacio), el
// juego sigue igual, sin recordar. (En multijugador, esto lo reemplaza el servidor: los mismos datos, de todos.)
import {crearEstado,leerEstado} from '../engine/estadoMundo.js';

const clave=(seed,team)=>`mycity.estado.${seed}.${team}`;
export function cargarEstado(seed,team){try{const t=localStorage.getItem(clave(seed,team));return t?leerEstado(JSON.parse(t)):crearEstado();}catch{return crearEstado();}}
export function guardarEstado(seed,team,E){try{localStorage.setItem(clave(seed,team),JSON.stringify(E));return true;}catch{return false;}}
