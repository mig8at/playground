/* La huida con el cuerpo (2026-10-17, REGLAS.md paso 2): cuánto se salta y cuánto duele caer. Puro; lo usan el 3D
   (DemoView: la barra de vida y el daño al aterrizar) y el 2D (validar-azoteas: qué techos se alcanzan desde cuáles).
   · alcanceSalto(desnivel, v): cuántos m se avanza saltando a v m/s (corriendo, por defecto) para caer «desnivel» m más
     abajo (negativo: más arriba; más alto que lo que se alcanza, no se llega). Es la parábola del salto del 3D.
   · danoDeCaida(altura): lo que quita una caída de «altura» m (VIDA.segura → 0; VIDA.mortal → todo). */
import {CIRCULACION as C,VIDA} from '../medidas.js';

const S=C.peaton.salto;
export function alcanceSalto(desnivel=0,v=C.peaton.velocidad.corre){const g=S.gravedad,vy=S.velocidad,apice=vy*vy/(2*g);
 if(desnivel<-apice)return 0;// (más alto que el ápice del salto: no se llega)
 const t=(vy+Math.sqrt(vy*vy+2*g*desnivel))/g;return v*t;}
export function danoDeCaida(altura){if(altura<=VIDA.segura)return 0;if(altura>=VIDA.mortal)return VIDA.max;return VIDA.max*(altura-VIDA.segura)/(VIDA.mortal-VIDA.segura);}
