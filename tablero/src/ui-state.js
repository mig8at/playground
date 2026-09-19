// Preferencias locales: una falla de almacenamiento nunca impide abrir el tablero.
export function readPreference(key, fallback) {
  try { return JSON.parse(localStorage.getItem(`tablero:${key}`)) ?? fallback; }
  catch { return fallback; }
}

export function savePreference(key, value) {
  try { localStorage.setItem(`tablero:${key}`, JSON.stringify(value)); }
  catch { /* memoria disponible durante esta visita */ }
}

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
