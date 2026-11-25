// Caché de fotografías importadas. IndexedDB evita repetir consultas a producción al recargar;
// no se guardan solicitudes ni datos de personas, sólo configuración de comercios/entidades.
const DB = 'flow-production-snapshots', STORE = 'snapshots'
function db() { return new Promise((resolve, reject) => { const req = indexedDB.open(DB, 1); req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' }); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) }) }
export async function saveSnapshot(key, value) { const d = await db(); return new Promise((resolve, reject) => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put({ key, value, savedAt: new Date().toISOString() }); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) }) }
export async function getSnapshot(key) { const d = await db(); return new Promise((resolve, reject) => { const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key); req.onsuccess = () => resolve(req.result?.value || null); req.onerror = () => reject(req.error) }) }
export async function api(path) {
  try {
    const res = await fetch('/api/flow/' + path)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || (res.status >= 500 ? 'Falta el servidor local del Trazador (:5199). Ejecutá «cd trazador && npm run dev:server».' : 'No se pudo consultar producción'))
    return body
  } catch (err) {
    // Vite devuelve una respuesta de proxy sin JSON cuando el backend local no está arriba.
    if (err instanceof TypeError || /failed to fetch|proxy/i.test(err.message || '')) {
      throw new Error('Falta el servidor local del Trazador (:5199). Ejecutá «cd trazador && npm run dev:server».')
    }
    throw err
  }
}
