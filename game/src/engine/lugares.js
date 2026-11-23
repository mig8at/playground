/* Los lugares de mycity (2026-11-22, Miguel: «al entrar seleccionamos un país, que por ahora será Colombia, y luego una
   ciudad, que por ahora será Bogotá, y ahí muestra el mapa para caminar»). Cada país con sus ciudades; cada ciudad, la
   que arma el generador del plano (blueprint.js) con su semilla y su tamaño. La entrada (InicioView) los ofrece y la ciudad
   (/ciudad?lugar=bogota) la dibuja. Agregar una ciudad es agregar una línea acá.
   (tamano: el del generador —engine/ciudad.js: 2, 3, 5 u 8 en la ciudad chica; 12 y 16, las grandes—) */
import {City} from './index.js';

export const PAISES=[
 {id:'colombia',nombre:'Colombia',ciudades:[
  {id:'bogota',nombre:'Bogotá',lema:'La capital, a 2.600 metros',semilla:1,tamano:3}]}];
export const TAMANOS=[2,3,5,8];
export const ciudadDe=id=>{for(const p of PAISES)for(const c of p.ciudades)if(c.id===id)return {...c,pais:p};return null;};
// Una ciudad al azar que pasa los controles del generador (para el laboratorio: «otra ciudad»).
export function ciudadAlAzar(tamano){
 for(let i=0;i<200;i++){const seed=1+Math.floor(Math.random()*99999);if(City.analyze(City.generate({seed,team:tamano})).ok)return seed;}
 return 1;}
