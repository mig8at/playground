// Las trazas completas contienen logs y evidencia: caben mal en localStorage y no deben obligar a
// consultar Redash otra vez después de un F5. IndexedDB las conserva sólo en este navegador.
// Desde el 2026-09-24 las claves de lo guardado están en inglés: una base con otro nombre deja atrás
// los registros viejos en vez de leerlos con las claves equivocadas.
const DB_NAME = 'trazador-queries'
const DB_VERSION = 2
const TRACE_STORE = 'trazas'
const SEARCH_STORE = 'busquedas'
const MAX_QUERIES = 20
// Una búsqueda de una persona queda disponible por solicitud, cédula y teléfono. Son hasta tres llaves
// para el mismo grupo, por eso el límite conserva el equivalente a unas veinte consultas completas.
const MAX_SEARCHES = 60

function key(target, ureq) { return `${target}:${ureq}` }
function searchKey(target, q) { return `${target}:${String(q).trim()}` }

function searchAlias(q, results) {
  const alias = new Set([String(q).trim()])
  const people = Array.isArray(results?.people) ? results.people : []
  // Sólo se indexa si el servidor resolvió UNA persona. Con una búsqueda ambigua, asociar una cédula al
  // grupo entero mezclaría historiales de dos clientes distintos — una caché rápida pero incorrecta.
  if (people.length === 1) {
    for (const value of [people[0]?.document, people[0]?.phone]) {
      const clean = typeof value === 'string' ? value.trim() : ''
      if (clean) alias.add(clean)
    }
  }
  return [...alias]
}

function openDB() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolver) => {
    let openRequest
    try { openRequest = indexedDB.open(DB_NAME, DB_VERSION) }
    catch { resolver(null); return }
    openRequest.onupgradeneeded = () => {
      const trace = openRequest.result.objectStoreNames.contains(TRACE_STORE)
        ? openRequest.transaction.objectStore(TRACE_STORE)
        : openRequest.result.createObjectStore(TRACE_STORE, { keyPath: 'id' })
      if (!trace.indexNames.contains('guardadaEn')) trace.createIndex('guardadaEn', 'guardadaEn')
      const search = openRequest.result.objectStoreNames.contains(SEARCH_STORE)
        ? openRequest.transaction.objectStore(SEARCH_STORE)
        : openRequest.result.createObjectStore(SEARCH_STORE, { keyPath: 'id' })
      if (!search.indexNames.contains('guardadaEn')) search.createIndex('guardadaEn', 'guardadaEn')
    }
    openRequest.onsuccess = () => resolver(openRequest.result)
    openRequest.onerror = openRequest.onblocked = () => resolver(null)
  })
}

// Sólo una respuesta de `/api/traza` que ya terminó llega a este punto. Se guarda junto con los
// resultados de búsqueda, si existen, para recuperar también la historia de la persona tras recargar.
export async function saveQuery({ target, trace: trace, results: results }) {
  try {
    if (!trace?.ureq) return
    const bd = await openDB()
    if (!bd) return
    await new Promise((resolver) => {
      const tx = bd.transaction(TRACE_STORE, 'readwrite')
      const store = tx.objectStore(TRACE_STORE)
      store.put({
        id: key(target, trace.ureq), target, ureq: String(trace.ureq), savedAt: Date.now(), trace: trace, results: results,
      })

      // Conserva un historial útil sin convertir el navegador en un archivo ilimitado de logs.
      let vistas = 0
      const cursor = store.index('guardadaEn').openCursor(null, 'prev')
      cursor.onsuccess = () => {
        const actual = cursor.result
        if (!actual) return
        vistas += 1
        if (vistas > MAX_QUERIES) actual.delete()
        actual.continue()
      }
      tx.oncomplete = tx.onabort = tx.onerror = () => { bd.close(); resolver() }
    })
  } catch { /* La caché es una mejora; nunca puede romper una consulta terminada. */ }
}

export async function readQuery(target, ureq) {
  try {
    const bd = await openDB()
    if (!bd) return null
    return await new Promise((resolver) => {
      const tx = bd.transaction(TRACE_STORE, 'readonly')
      const openRequest = tx.objectStore(TRACE_STORE).get(key(target, ureq))
      openRequest.onsuccess = () => resolver(openRequest.result || null)
      openRequest.onerror = () => resolver(null)
      tx.oncomplete = tx.onabort = tx.onerror = () => bd.close()
    })
  } catch { return null }
}

// Borrar una corrida tiene que borrar también sus logs y resultados guardados. Sacarla sólo de la lista
// haría que un F5 con la URL todavía recuperara datos que el operador pidió quitar del navegador.
export async function deleteQuery(target, ureq) {
  try {
    const bd = await openDB()
    if (!bd) return
    await new Promise((resolver) => {
      const tx = bd.transaction(TRACE_STORE, 'readwrite')
      tx.objectStore(TRACE_STORE).delete(key(target, ureq))
      tx.oncomplete = tx.onabort = tx.onerror = () => { bd.close(); resolver() }
    })
  } catch { /* Borrar la entrada visual sigue siendo útil aunque IndexedDB no esté disponible. */ }
}

// La respuesta de búsqueda es la otra mitad de una consulta: contiene la persona, el comercio y toda
// su historia. Guardarla evita volver a pedirla al abrir una corrida desde Recientes.
export async function saveSearch({ target, q, results: results }) {
  try {
    if (!q || !results) return
    const bd = await openDB()
    if (!bd) return
    await new Promise((resolver) => {
      const tx = bd.transaction(SEARCH_STORE, 'readwrite')
      const store = tx.objectStore(SEARCH_STORE)
      const savedAt = Date.now()
      for (const alias of searchAlias(q, results)) {
        store.put({
          id: searchKey(target, alias), target, q: alias, originalQuery: String(q), savedAt: savedAt, results: results,
        })
      }

      let vistas = 0
      const cursor = store.index('guardadaEn').openCursor(null, 'prev')
      cursor.onsuccess = () => {
        const actual = cursor.result
        if (!actual) return
        vistas += 1
        if (vistas > MAX_SEARCHES) actual.delete()
        actual.continue()
      }
      tx.oncomplete = tx.onabort = tx.onerror = () => { bd.close(); resolver() }
    })
  } catch { /* La búsqueda remota sigue siendo el respaldo cuando no existe caché. */ }
}

export async function readSearch(target, q) {
  try {
    const bd = await openDB()
    if (!bd) return null
    return await new Promise((resolver) => {
      const tx = bd.transaction(SEARCH_STORE, 'readonly')
      const openRequest = tx.objectStore(SEARCH_STORE).get(searchKey(target, q))
      openRequest.onsuccess = () => resolver(openRequest.result || null)
      openRequest.onerror = () => resolver(null)
      tx.oncomplete = tx.onabort = tx.onerror = () => bd.close()
    })
  } catch { return null }
}

export async function deleteSearch(target, q) {
  try {
    const bd = await openDB()
    if (!bd) return
    await new Promise((resolver) => {
      const tx = bd.transaction(SEARCH_STORE, 'readwrite')
      tx.objectStore(SEARCH_STORE).delete(searchKey(target, q))
      tx.oncomplete = tx.onabort = tx.onerror = () => { bd.close(); resolver() }
    })
  } catch { /* Borrar la entrada visual sigue siendo útil aunque IndexedDB no esté disponible. */ }
}
