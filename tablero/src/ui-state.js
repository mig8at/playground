import { readPref, savePref } from './workbench.js';

// Preferencias locales, con los helpers de la base (`readPref`/`savePref`: JSON, y una falla del
// almacenamiento nunca impide abrir el tablero). Se conserva el prefijo `tablero:` que ya usaban las
// claves guardadas: cambiarlo al `tablero.` de la base las perdería todas en la próxima recarga.
export const readPreference = (key, fallback) => readPref(`tablero:${key}`, fallback);
export const savePreference = (key, value) => savePref(`tablero:${key}`, value);

export const TASK_GROUPS = [
  { id: 'iniciada', title: 'En curso' },
  { id: 'bloqueada', title: 'Bloqueadas' },
  { id: 'pruebas', title: 'En pruebas' },
  { id: 'sin-iniciar', title: 'Por empezar' },
  { id: 'terminada', title: 'Terminadas' },
];

export function groupTasks(tasks, bucket) {
  return TASK_GROUPS.map(group => ({ ...group, tasks: tasks.filter(task => bucket(task) === group.id) }))
    .filter(group => group.tasks.length);
}
