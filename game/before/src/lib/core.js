// Las reglas del prototipo: el núcleo al que se llegó el 2026-10-07 (IDEAS.md, sección 0). Más puertas que policías,
// puertas cerradas que hay que forzar, la policía entra a un banco sólo con su alarma (y 3 s después), ruido para
// distraer, dormir a un policía por la espalda, gente en la calle y una vista satelital por jugador en los dos equipos
// (un círculo que se mueve por la ciudad; el resto, nublado; nadie la ve). Las bolsas y el reloj por tamaño los pone el
// motor (CROWD_QUOTA, DRONE_EXTRA_BAGS, CITY_CLOCK). Con bots: 55 / 56 / 50 / 54 % de victorias de ladrones en 2, 3, 5
// y 8 contra 8 (240 rondas por tamaño, ±6).
import {City} from '../engine/index.js';

export const CORE_RULES={lockdown:10,lockdownDelay:3,force:2,decoy:2,sleep:10,sleepHold:1.5,crowd:3,drone:8};
export const SIZES=[2,3,5,8];
// «Golpes» (IDEAS.md §00), sobre la ciudad por etapas: tres botines de edificios distintos al hangar del Profesor, el
// jefe de policía en el dron, cajas para esconder la bolsa y pistas progresivas. Con bots (48 rondas por tamaño):
// 27 / 52 / 50 / 44 % de victorias de ladrones en 2, 3, 5 y 8 contra 8.
export const HEIST_RULES={sleep:10,sleepHold:1.5,crowd:3,heists:3};

// Una ciudad al azar que pasa los controles del generador.
export function randomCity(team){
 for(let i=0;i<200;i++){const seed=1+Math.floor(Math.random()*99999);if(City.analyze(City.generate({seed,team})).ok)return seed;}
 return 1;
}
