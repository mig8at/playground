// Experimento «rutina» del calibrador (2026-10-18): las perillas de RUTINA (medidas.js) contra las metas de
// scripts/datos/objetivos-rutina.json, midiendo la semana de una o más ciudades (medirRutina.js).
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {generateBlueprint} from '../../src/engine/blueprint.js';
import {sociedadDe} from '../../src/engine/sociedad.js';
import {curvas,indicadores,perdida} from '../../src/engine/medirRutina.js';
import {estabilidad} from '../../src/engine/medirRutina.js';
export const nombre='rutina';
export const descripcion='las necesidades, comer afuera, el fin de semana y el viaje, contra las metas de un día de la ciudad';
export const parametros=[
 {ruta:'RUTINA.necesidades.hambre.sube',min:1/7,max:1/4},
 {ruta:'RUTINA.necesidades.hambre.umbral',min:.55,max:.95},
 {ruta:'RUTINA.afuera',min:.05,max:.5},
 {ruta:'RUTINA.necesidades.despensa.sube',min:1/140,max:1/40},
 {ruta:'RUTINA.necesidades.despensa.umbral',min:.4,max:.9},
 {ruta:'RUTINA.necesidades.ocio.sube',min:1/50,max:1/12},
 {ruta:'RUTINA.necesidades.ocio.umbral',min:.5,max:.95},
 {ruta:'RUTINA.necesidades.fisico.sube',min:1/70,max:1/25},
 {ruta:'RUTINA.finde.despensa',min:1,max:3},
 {ruta:'RUTINA.finde.ocio',min:1,max:3},
 {ruta:'RUTINA.almuerzoAfuera.parte',min:0,max:.7},
 // (el cansancio, 2026-10-18)
 {ruta:'RUTINA.necesidades.energia.sube',min:.02,max:.15},{ruta:'RUTINA.necesidades.energia.camina',min:.3,max:2.5},{ruta:'RUTINA.necesidades.energia.umbral',min:.2,max:.8},
 {ruta:'RUTINA.lugares.banca.horas',min:.15,max:.75},{ruta:'RUTINA.lugares.esquina.horas',min:.1,max:.5}];
const objetivos=JSON.parse(readFileSync(fileURLToPath(new URL('../datos/objetivos-rutina.json',import.meta.url)),'utf8')).metas;
const ciudades=new Map();
export async function evaluar({semillas=[1]}={}){let L=0;const det=[];
 for(const s of semillas){if(!ciudades.has(s))ciudades.set(s,generateBlueprint({seed:s,team:3}));
  const S=sociedadDe(ciudades.get(s),{eventos:[]});// (eventos vacíos: se arma de nuevo con las perillas de ahora)
  const r=perdida({curvas:curvas(S,{paso:1/4}),indicadores:indicadores(S)},objetivos);L+=r.perdida;det.push(...r.detalle);
  // (y que se estabilice: un martes con trancón, robo y cierre, el domingo casi todos hacen lo mismo que sin eventos)
  const e=estabilidad(ciudades.get(s),S),fuera=Math.max(0,.9-e.domingo);L+=(fuera/.1)**2*3;det.push({meta:'vuelve a lo normal el domingo',valor:+e.domingo.toFixed(3),rango:[.9,1],ok:fuera===0});}
 return {perdida:L/semillas.length,detalle:det.slice(0,objetivos.length+1)};}// (las metas y la estabilidad de la primera ciudad)
