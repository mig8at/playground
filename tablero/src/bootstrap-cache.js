// 2 desde la fase 4b (2026-09-23): las claves de la foto pasaron a inglés (`porSprint` → `bySprint`), y una
// foto vieja se descarta en vez de pintarse con campos vacíos. La clave de `localStorage` no cambia: se pisa.
const VERSION = 2;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const BOOTSTRAP_CACHE_KEY = 'tablero:bootstrap:v1';

// Esta caché no es una segunda fuente de verdad: sirve únicamente para pintar el último estado bueno
// mientras Jira responde. Cada apertura la revalida y reemplaza en segundo plano.
export function readBootstrapCache(storage = globalThis.localStorage, now = Date.now()) {
  try {
    const value = JSON.parse(storage?.getItem(BOOTSTRAP_CACHE_KEY) || 'null');
    if (value?.version !== VERSION || !value.sprint || !Array.isArray(value.issues)
      || !Array.isArray(value.sprints) || !Array.isArray(value.bySprint)) return null;
    const savedAt = Date.parse(value.savedAt || '');
    if (!Number.isFinite(savedAt) || now - savedAt > MAX_AGE_MS) return null;
    return value;
  } catch { return null; }
}

export function writeBootstrapCache(snapshot, storage = globalThis.localStorage, now = Date.now()) {
  try {
    storage?.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify({
      version: VERSION,
      savedAt: new Date(now).toISOString(),
      sprint: snapshot.sprint,
      sprints: snapshot.sprints || [],
      issues: snapshot.issues || [],
      bySprint: snapshot.bySprint || [],
      site: snapshot.site || '',
    }));
    return true;
  } catch { return false; }
}
