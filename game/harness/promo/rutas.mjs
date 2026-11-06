// Dónde queda cada cosa de la promo. Lo que se graba y se arma (.work/) y los videos (out/) no van en git.
import {fileURLToPath} from 'node:url';import {dirname,join} from 'node:path';
export const PROMO=dirname(fileURLToPath(import.meta.url));
export const WORK=join(PROMO,'.work');
export const TOMAS=join(WORK,'tomas');
export const TEXTOS=join(WORK,'textos');
export const CORTES=join(WORK,'cortes');
export const BANDA=join(WORK,'banda.wav');
export const VIDEOS=join(PROMO,'videos');
export const OUT=join(PROMO,'out');
export const JUEGO_DIR=join(PROMO,'..','..');
