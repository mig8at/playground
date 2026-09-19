// Las trazas completas contienen logs y evidencia: caben mal en localStorage y no deben obligar a
// consultar Redash otra vez después de un F5. IndexedDB las conserva sólo en este navegador.
const NOMBRE_BD = 'trazador-consultas'
const VERSION_BD = 2
const ALMACEN_TRAZAS = 'trazas'
const ALMACEN_BUSQUEDAS = 'busquedas'
const MAX_CONSULTAS = 20
const MAX_BUSQUEDAS = 20

function clave(target, ureq) { return `${target}:${ureq}` }
function claveBusqueda(target, q) { return `${target}:${String(q).trim()}` }

function abrirBD() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolver) => {
    let solicitud
    try { solicitud = indexedDB.open(NOMBRE_BD, VERSION_BD) }
    catch { resolver(null); return }
    solicitud.onupgradeneeded = () => {
      const traza = solicitud.result.objectStoreNames.contains(ALMACEN_TRAZAS)
        ? solicitud.transaction.objectStore(ALMACEN_TRAZAS)
        : solicitud.result.createObjectStore(ALMACEN_TRAZAS, { keyPath: 'id' })
      if (!traza.indexNames.contains('guardadaEn')) traza.createIndex('guardadaEn', 'guardadaEn')
      const busqueda = solicitud.result.objectStoreNames.contains(ALMACEN_BUSQUEDAS)
        ? solicitud.transaction.objectStore(ALMACEN_BUSQUEDAS)
        : solicitud.result.createObjectStore(ALMACEN_BUSQUEDAS, { keyPath: 'id' })
      if (!busqueda.indexNames.contains('guardadaEn')) busqueda.createIndex('guardadaEn', 'guardadaEn')
    }
    solicitud.onsuccess = () => resolver(solicitud.result)
    solicitud.onerror = solicitud.onblocked = () => resolver(null)
  })
}

// Sólo una respuesta de `/api/traza` que ya terminó llega a este punto. Se guarda junto con los
// resultados de búsqueda, si existen, para recuperar también la historia de la persona tras recargar.
export async function guardarConsulta({ target, traza, resultados }) {
  try {
    if (!traza?.ureq) return
    const bd = await abrirBD()
    if (!bd) return
    await new Promise((resolver) => {
      const tx = bd.transaction(ALMACEN_TRAZAS, 'readwrite')
      const almacen = tx.objectStore(ALMACEN_TRAZAS)
      almacen.put({
        id: clave(target, traza.ureq), target, ureq: String(traza.ureq), guardadaEn: Date.now(), traza, resultados,
      })

      // Conserva un historial útil sin convertir el navegador en un archivo ilimitado de logs.
      let vistas = 0
      const cursor = almacen.index('guardadaEn').openCursor(null, 'prev')
      cursor.onsuccess = () => {
        const actual = cursor.result
        if (!actual) return
        vistas += 1
        if (vistas > MAX_CONSULTAS) actual.delete()
        actual.continue()
      }
      tx.oncomplete = tx.onabort = tx.onerror = () => { bd.close(); resolver() }
    })
  } catch { /* La caché es una mejora; nunca puede romper una consulta terminada. */ }
}

export async function leerConsulta(target, ureq) {
  try {
    const bd = await abrirBD()
    if (!bd) return null
    return await new Promise((resolver) => {
      const tx = bd.transaction(ALMACEN_TRAZAS, 'readonly')
      const solicitud = tx.objectStore(ALMACEN_TRAZAS).get(clave(target, ureq))
      solicitud.onsuccess = () => resolver(solicitud.result || null)
      solicitud.onerror = () => resolver(null)
      tx.oncomplete = tx.onabort = tx.onerror = () => bd.close()
    })
  } catch { return null }
}

// Borrar una corrida tiene que borrar también sus logs y resultados guardados. Sacarla sólo de la lista
// haría que un F5 con la URL todavía recuperara datos que el operador pidió quitar del navegador.
export async function borrarConsulta(target, ureq) {
  try {
    const bd = await abrirBD()
    if (!bd) return
    await new Promise((resolver) => {
      const tx = bd.transaction(ALMACEN_TRAZAS, 'readwrite')
      tx.objectStore(ALMACEN_TRAZAS).delete(clave(target, ureq))
      tx.oncomplete = tx.onabort = tx.onerror = () => { bd.close(); resolver() }
    })
  } catch { /* Borrar la entrada visual sigue siendo útil aunque IndexedDB no esté disponible. */ }
}

// La respuesta de búsqueda es la otra mitad de una consulta: contiene la persona, el comercio y toda
// su historia. Guardarla evita volver a pedirla al abrir una corrida desde Recientes.
export async function guardarBusqueda({ target, q, resultados }) {
  try {
    if (!q || !resultados) return
    const bd = await abrirBD()
    if (!bd) return
    await new Promise((resolver) => {
      const tx = bd.transaction(ALMACEN_BUSQUEDAS, 'readwrite')
      const almacen = tx.objectStore(ALMACEN_BUSQUEDAS)
      almacen.put({ id: claveBusqueda(target, q), target, q: String(q), guardadaEn: Date.now(), resultados })

      let vistas = 0
      const cursor = almacen.index('guardadaEn').openCursor(null, 'prev')
      cursor.onsuccess = () => {
        const actual = cursor.result
        if (!actual) return
        vistas += 1
        if (vistas > MAX_BUSQUEDAS) actual.delete()
        actual.continue()
      }
      tx.oncomplete = tx.onabort = tx.onerror = () => { bd.close(); resolver() }
    })
  } catch { /* La búsqueda remota sigue siendo el respaldo cuando no existe caché. */ }
}

export async function leerBusqueda(target, q) {
  try {
    const bd = await abrirBD()
    if (!bd) return null
    return await new Promise((resolver) => {
      const tx = bd.transaction(ALMACEN_BUSQUEDAS, 'readonly')
      const solicitud = tx.objectStore(ALMACEN_BUSQUEDAS).get(claveBusqueda(target, q))
      solicitud.onsuccess = () => resolver(solicitud.result || null)
      solicitud.onerror = () => resolver(null)
      tx.oncomplete = tx.onabort = tx.onerror = () => bd.close()
    })
  } catch { return null }
}

export async function borrarBusqueda(target, q) {
  try {
    const bd = await abrirBD()
    if (!bd) return
    await new Promise((resolver) => {
      const tx = bd.transaction(ALMACEN_BUSQUEDAS, 'readwrite')
      tx.objectStore(ALMACEN_BUSQUEDAS).delete(claveBusqueda(target, q))
      tx.oncomplete = tx.onabort = tx.onerror = () => { bd.close(); resolver() }
    })
  } catch { /* Borrar la entrada visual sigue siendo útil aunque IndexedDB no esté disponible. */ }
}
