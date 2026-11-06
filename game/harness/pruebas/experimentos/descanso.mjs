// Experimento «descanso» del calibrador (2026-10-18): sólo las perillas del cansancio (RUTINA.necesidades.energia y los
// lugares de descanso), contra las mismas metas de la rutina —que la calle tenga gente quieta sin mover lo demás—.
import * as R from './rutina.mjs';
export const nombre='descanso';
export const descripcion='el cansancio y el descanso (bancas y esquinas), contra las metas de la rutina';
export const parametros=[
 {ruta:'RUTINA.necesidades.energia.sube',min:.05,max:.16},{ruta:'RUTINA.necesidades.energia.camina',min:1,max:2.6},{ruta:'RUTINA.necesidades.energia.umbral',min:.15,max:.4},
 {ruta:'RUTINA.lugares.banca.horas',min:.15,max:.5},{ruta:'RUTINA.lugares.esquina.horas',min:.1,max:.4},{ruta:'RUTINA.lugares.esquina.baja',min:.2,max:.6}];
export const evaluar=R.evaluar;
