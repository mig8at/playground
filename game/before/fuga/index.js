// FUGA · el juego de policías y ladrones (mudado acá el 2026-11-21).
// Miguel cambió el rumbo: el juego pasa a ser una ciudad donde se compran propiedades (tarea Game #136 del tablero), y
// todo lo de la persecución se sacó de src/ para que la ciudad quede sola. No está borrado: la pantalla de la ciudad lo
// carga desde acá sólo si se pide (/juego?fuga=1, o /demo, la ruta de sus pruebas de pantalla).
// Esto es todo lo que esa pantalla necesita del juego viejo, en un solo lugar.
export {createViewmodel,ViewmodelPass} from './lib/viewmodel3d.js';
export {createShooting} from './lib/disparo3d.js';
export {crearRonda,robar,guardar,sacar,incautar,perseguido,precio,gano,hayGente,empezarForzar,tickForzar,trancada,puertaTrancadaEn,robadoEn,usosRonda} from './engine/ronda.js';
export {createPersecucion,rasgosDe} from './lib/persecucion3d.js';
export {createPatrullas} from './lib/patrulla3d.js';
