// El store. Una sola fuente de estado para toda la app.
//
// REGLA QUE ORDENA ESTE ARCHIVO: acá NO se decide nada del negocio. El estado de una etapa, qué familia
// ganó, dónde se rompió — todo eso viene ya resuelto del server, que a su vez lo saca de `ensamblar()` en
// Go. Si el store recalculara alguna de esas cosas habría dos definiciones de «esta etapa falló» y en el
// primer cambio se contradirían. El store guarda, pide y expone; no interpreta.
import { defineStore } from 'pinia'
import { toRaw } from 'vue'
import { deleteSearch, deleteQuery, saveSearch, saveQuery, readSearch, readQuery } from '../queryCache'

const json = async (url) => {
  const r = await fetch(url)
  const body = await r.json().catch(() => ({ error: `respuesta no-JSON (${r.status})` }))
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
  return body
}

const validTargets = new Set(['prod', 'staging', 'qa', 'dev', 'local'])

// La URL se puede leer sin Vue Router: identifica una PERSONA y, opcionalmente, la corrida abierta.
// Así `/traza/prod/38612965` carga toda su historia y `/traza/prod/38612965/562414/listado` abre además
// una estación concreta. Nunca se adivina qué tipo de número es: el servidor lo busca como solicitud,
// teléfono y documento, y la ruta se normaliza a la cédula que encontró.
function tracePath(target, documentNumber, ureq, stage) {
  const parts = ['traza', target]
  const identifier = String(documentNumber || '').trim()
  if (identifier) parts.push(identifier)
  if (ureq) {
    parts.push(String(ureq))
    if (stage) parts.push(stage)
  }
  return '/' + parts.map(encodeURIComponent).join('/')
}

function currentPath() {
  const parts = location.pathname.split('/').filter(Boolean).map((part) => {
    try { return decodeURIComponent(part) } catch { return '' }
  })
  if (parts[0] !== 'traza' || !validTargets.has(parts[1] || '')) return null
  const identifier = parts[2] || ''
  const quarter = parts[3] || ''
  const isPreviousRoute = /^\d+$/.test(identifier) && /^[a-z0-9-]+$/i.test(quarter) && !/^\d+$/.test(quarter)
  // La ruta breve (`/traza/:env/:numero`) ya no se asume como uReq: es una consulta por cualquiera de
  // los tres identificadores. La variante antigua con etapa sí era inequívocamente una traza y se sigue
  // leyendo para que los enlaces pegados antes de este cambio continúen funcionando.
  const ureq = isPreviousRoute ? identifier : (/^\d+$/.test(quarter) ? quarter : '')
  const candidateStage = isPreviousRoute ? quarter : (parts[4] || '')
  const stage = ureq && /^[a-z0-9-]+$/i.test(candidateStage) ? candidateStage : ''
  return { target: parts[1], identificador: identifier, ureq, etapa: stage }
}

// Un reciente es una consulta, no una solicitud suelta. Por ejemplo, buscar un teléfono guarda una
// entrada con todas sus solicitudes; abrir una fila sólo cambia la traza que se está viendo.
function recentKey({ target, q, personaKey: personKey }) {
  return personKey ? `${target}:persona:${personKey}` : `${target}:consulta:${q}`
}

function normalizeRecent(value) {
  const separator = typeof value === 'string' ? value.indexOf(':') : -1
  if (typeof value === 'string' && separator < 1) return null
  const fromKey = typeof value === 'string'
    ? { target: value.slice(0, separator), q: value.slice(separator + 1) }
    : value
  if (!fromKey || typeof fromKey !== 'object') return null
  const target = String(fromKey.target || '').trim()
  const q = String(fromKey.q || '').trim()
  if (!target || !q) return null
  const loanRequests = Array.isArray(fromKey.solicitudes)
    ? [...new Set(fromKey.solicitudes.map(String).map((ureq) => ureq.trim()).filter(Boolean))]
    : []
  const queries = [...new Set([q, ...(Array.isArray(fromKey.consultas)
    ? fromKey.consultas.map(String).map((query) => query.trim()).filter(Boolean)
    : [])])]
  const total = Number.isInteger(fromKey.total) && fromKey.total >= 0
    ? fromKey.total
    : (loanRequests.length || null)
  const kind = typeof fromKey.tipo === 'string' ? fromKey.tipo.trim() : ''
  const personKey = typeof fromKey.personaKey === 'string' ? fromKey.personaKey.trim() : ''
  const documentNumber = typeof fromKey.documento === 'string' ? fromKey.documento.trim() : ''
  const phone = typeof fromKey.telefono === 'string' ? fromKey.telefono.trim() : ''
  return { target, q, tipo: kind, personaKey: personKey, documento: documentNumber, telefono: phone, total, solicitudes: loanRequests, consultas: queries }
}

// `localStorage` es una preferencia, no una fuente confiable: puede venir de una versión anterior,
// de una extensión o de una edición manual. También admite las claves de la versión previa para no
// perder las consultas ya guardadas al actualizar la herramienta.
function recentList(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  return value.map(normalizeRecent).filter((recent) => {
    if (!recent) return false
    const key = recentKey(recent)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 8)
}

function readRecent() {
  try { return recentList(JSON.parse(localStorage.getItem('trazador.recientes') || '[]')) }
  catch { return [] }
}

function persistRecent(recentItems) {
  try { localStorage.setItem('trazador.recientes', JSON.stringify(recentItems)) }
  catch { /* El historial visual no puede impedir usar el trazador. */ }
}

function loanRequestsOf(results) {
  return [...new Set((results?.items || []).map((item) => String(item?.ureq || '').trim()).filter(Boolean))]
}

function personOf(results) {
  const people = Array.isArray(results?.personas) ? results.personas : []
  if (people.length === 1 && typeof people[0]?.personaKey === 'string' && people[0].personaKey) {
    return {
      personaKey: people[0].personaKey,
      documento: typeof people[0].documento === 'string' ? people[0].documento : '',
      telefono: typeof people[0].telefono === 'string' ? people[0].telefono : '',
    }
  }
  // Las búsquedas cacheadas por versiones anteriores no traen el resumen `personas`, pero las filas
  // nuevas sí llevan su clave. Se aprovecha si todas pertenecen a la misma persona; con más de una no
  // se colapsa nada para no mezclar casos ambiguos.
  const keys = [...new Set((results?.items || []).map((item) => item?.personaKey).filter(Boolean))]
  return keys.length === 1 ? { personaKey: keys[0], documento: '', telefono: '' } : null
}

function isHidden(value) {
  return typeof value === 'string' && /[•*]/.test(value)
}

function hiddenIdentity(value) {
  return isHidden(value?.documento) || isHidden(value?.telefono)
}

function searchHasPerson(results) {
  // La propiedad existe incluso cuando la búsqueda no encuentra a nadie. Una identidad con asteriscos
  // es una caché heredada de cuando el API la ocultaba: se actualiza una vez al volver a abrirla para
  // que recientes, ficha y ruta tengan la cédula completa.
  return Array.isArray(results?.personas) && !results.personas.some(hiddenIdentity)
}

// Un resultado se guarda bajo sus equivalentes (uReq, cédula y teléfono), pero `directa` describe la
// llave original que pidió Redash. Al abrirlo por un alias se apaga esa marca: el operador ve el grupo
// completo y elige la corrida, en vez de que la caché seleccione una por una coincidencia de ayer.
function cacheResult(saved, q) {
  const results = saved?.resultados
  if (!results) return null
  const original = String(saved.consultaOriginal || saved.q || '').trim()
  if (!original || original === q) return results
  return {
    ...results,
    items: (results.items || []).map((item) => ({ ...item, directa: false })),
  }
}

function completeIdentity(trace, results) {
  if (!trace || !hiddenIdentity(trace)) return trace
  const person = personOf(results)
  if (!person || hiddenIdentity(person)) return trace
  if (trace.personaKey && person.personaKey && trace.personaKey !== person.personaKey) return trace
  const documentNumber = isHidden(trace.documento) ? (person.documento || trace.documento) : trace.documento
  const phone = isHidden(trace.telefono) ? (person.telefono || trace.telefono) : trace.telefono
  if (documentNumber === trace.documento && phone === trace.telefono) return trace
  return { ...trace, personaKey: trace.personaKey || person.personaKey, documento: documentNumber, telefono: phone }
}

// El servidor prueba los tres identificadores y devuelve cómo coincidió. Ese dato es más confiable que
// inferir por longitud: una cédula puede tener diez dígitos y empezar por 3, igual que un celular.
function kindOf(results) {
  const matchesList = (results?.como || []).map((value) => String(value).split('→')[0].trim().toLowerCase())
  const kinds = [
    matchesList.some((kind) => kind.includes('teléfono')) && 'Teléfono',
    matchesList.some((kind) => kind.includes('documento')) && 'Cédula',
    matchesList.some((kind) => kind.includes('solicitud')) && 'Solicitud',
  ].filter(Boolean)
  return kinds.join(' y ')
}

export const useTrazador = defineStore('trazador', {
  state: () => ({
    // El árbol DECLARADO. Se pide una vez al arrancar y no toca ninguna fuente, así que la vista puede
    // dibujar las 8 etapas y sus 37 hitos en gris antes de que exista una consulta.
    mapa: null,
    target: 'prod',

    // La búsqueda
    q: '',
    buscando: false,
    resultados: null,   // { como, items[] } · null = todavía no se buscó

    // La traza elegida
    cargandoTraza: false,
    traza: null,
    etapaSel: null,
    error: '',

    // `fase` dice EN QUÉ va la carga, no sólo que está cargando. Contra prod son dos saltos que suman ~20 s
    // (búsqueda ~5 s + armado ~14 s, medido) porque Redash es asíncrono: un spinner mudo tanto tiempo se lee
    // como «se colgó». Decir cuál de los dos corre convierte la espera en información.
    fase: '',           // '' | 'buscando' | 'armando'

    // Las últimas búsquedas, en localStorage. En soporte se vuelve al mismo puñado de solicitudes todo el
    // día y volver a tipear el número es fricción pura.
    recientes: readRecent(),
  }),

  getters: {
    // Las etapas SIEMPRE salen del mapa declarado, en el orden del flujo. Cuando hay traza se le pega su
    // estado; cuando no, quedan en gris. Así el árbol es el mismo objeto antes y después de consultar, y
    // no hay dos maneras de dibujarlo.
    etapas(s) {
      if (!s.mapa) return []
      const byID = Object.fromEntries((s.traza?.etapas || []).map((e) => [e.id, e]))
      return s.mapa.etapas.map((d) => ({
        ...d,
        vivo: byID[d.id] || null,
        estado: byID[d.id]?.status || 'pendiente',
      }))
    },
    etapaActiva(s) {
      const isIt = this.etapas
      if (!isIt.length) return null
      const i = isIt.findIndex((e) => e.id === s.etapaSel)
      return i >= 0 ? isIt[i] : isIt[this.indiceInteresante]
    },
    // Qué etapa abrir sola: la que rompió; si no rompió nada, la última con actividad. Es lo que uno
    // quiere ver al abrir un run fallido sin tener que buscarlo.
    indiceInteresante(s) {
      const isIt = this.etapas
      if (!isIt.length) return 0
      if (s.traza?.brokeAt) {
        const i = isIt.findIndex((e) => e.id === s.traza.brokeAt)
        if (i >= 0) return i
      }
      const f = isIt.findIndex((e) => e.estado === 'fail' || e.estado === 'warn')
      if (f >= 0) return f
      let u = 0
      isIt.forEach((e, i) => { if (e.vivo?.at) u = i })
      return u
    },
  },

  actions: {
    async cargarMapa() {
      try { this.mapa = await json('/api/mapa') }
      catch (e) { this.error = 'no pude cargar el mapa: ' + e.message }
    },

    async buscar() {
      const q = this.q.trim()
      if (!q) return
      this.buscando = true; this.fase = 'buscando'
      this.error = ''; this.resultados = null; this.traza = null
      try {
        const saved = await readSearch(this.target, q)
        const cached = cacheResult(saved, q)
        if (cached && searchHasPerson(cached)) this.resultados = cached
        else {
          try {
            this.resultados = await json(`/api/buscar?q=${encodeURIComponent(q)}&target=${this.target}`)
            await saveSearch({ target: this.target, q, resultados: toRaw(this.resultados) })
          } catch (e) {
            // Actualizar una caché de la versión anterior es una mejora, no una razón para ocultar una
            // consulta útil cuando la fuente remota está caída.
            if (saved?.resultados) this.resultados = saved.resultados
            else throw e
          }
        }
        this.recordar(q, this.resultados)
        // Se abre sola la que se PIDIÓ, no «la única»: desde que el server expande a la persona, buscar un
        // número de solicitud devuelve toda su historia, y con la regla vieja (`items.length === 1`) dejaba
        // de abrir justo el caso más común — el ureq que llega por Jira. Con varias directas (una cédula
        // con 12 intentos) no se adivina: se eligen en los chips.
        const directOnes = (this.resultados.items || []).filter((i) => i.directa)
        if (directOnes.length === 1) await this.verTraza(directOnes[0].ureq)
        // Cuando la consulta es cédula o celular no se abre arbitrariamente una solicitud, pero sí se
        // canoniza el link a la cédula. Una búsqueda por uReq termina arriba con su corrida seleccionada.
        this.aURL()
      } catch (e) { this.error = e.message }
      finally { this.buscando = false; this.fase = '' }
    },

    async verTraza(ureq) {
      const id = Number(ureq)
      // Elegir la fila que ya está abierta no es una carga: conserva la ficha y, sobre todo, no vuelve
      // a encender una barra que da a entender que se consultó la fuente.
      if (this.traza?.ureq === id) {
        this.aURL()
        return
      }
      this.cargandoTraza = false; this.fase = ''
      this.error = ''; this.etapaSel = null
      try {
        const target = this.target
        const saved = await readQuery(target, id)
        // La corrida sólo llega a IndexedDB después de terminar. La ficha nueva de perfil de cupo no
        // puede derivarse sin riesgo de las líneas ya renderizadas de una caché vieja; una copia sin ese
        // campo se actualiza UNA vez. Luego queda completa en IndexedDB como cualquier otra corrida.
        const traceCache = completeIdentity(saved?.traza, this.resultados || saved?.resultados)
        if (traceCache && !hiddenIdentity(traceCache) && Array.isArray(traceCache.perfilesCupo)) {
          this.traza = traceCache
          // La búsqueda recién hecha tiene prioridad; al abrir desde la URL se recupera la historia
          // guardada con esta traza sin volver a pasar por `/api/buscar`.
          if (!this.resultados && saved.resultados) this.resultados = saved.resultados
          // Si la búsqueda abierta aportó la cédula completa, se corrige esta copia local sin pedir la
          // traza otra vez. Así un clic sobre una corrida heredada no vuelve a prender la barra.
          if (traceCache !== saved.traza) {
            await saveQuery({ target, traza: toRaw(traceCache), resultados: toRaw(this.resultados || saved.resultados) })
          }
        } else {
          // La barra representa exclusivamente trabajo remoto (BD + logs), nunca la lectura local.
          this.cargandoTraza = true; this.fase = 'armando'
          const remote = await json(`/api/traza?ureq=${id}&target=${target}`)
          // Un servidor que todavía no se reinició tras agregar perfilesCupo no debe invalidar la misma
          // entrada para siempre: al migrarla se persiste `[]`, y la próxima recarga es totalmente local.
          this.traza = {
            ...remote,
            perfilesCupo: Array.isArray(remote.perfilesCupo) ? remote.perfilesCupo : [],
          }
          // Se espera sólo la escritura local: ya hay datos en pantalla y la caché nunca lanza. `toRaw`
          // es necesario porque IndexedDB no puede clonar los proxies reactivos de Pinia.
          await saveQuery({ target, traza: toRaw(this.traza), resultados: toRaw(this.resultados) })
        }
        this.etapaSel = this.etapas[this.indiceInteresante]?.id ?? null
        this.enriquecerReciente(this.traza)
        this.aURL()
      } catch (e) { this.error = e.message; this.traza = null }
      finally { this.cargandoTraza = false; this.fase = '' }
    },

    seleccionar(id) {
      this.etapaSel = id
      this.aURL()
    },

    cambiarTarget() {
      // Una corrida de prod no puede seguir dibujada como si fuera de staging sólo porque cambió el
      // selector. Se conserva el texto de búsqueda para repetirlo en el nuevo ambiente, pero se limpia
      // todo lo que lleva evidencia del anterior antes de escribir la nueva ruta.
      this.traza = null
      this.resultados = null
      this.etapaSel = null
      this.error = ''
      this.aURL()
    },

    // ─── LA URL ES EL ESTADO ───────────────────────────────────────────────────────────────────────
    //
    // Sin esto, un F5 pierde 20 segundos de consulta a Redash y una traza no se puede pasar a nadie: había
    // que decir «buscá 519245 en prod», que es exactamente la fricción que esta herramienta existe para
    // quitar. Con la URL, una traza se pega en un ticket junto al texto del botón copiar.
    //
    // Va con `replaceState` y no `pushState`: elegir una etapa no es navegar, y llenar el historial del
    // navegador con 10 entradas por traza hace que el botón «atrás» deje de servir para volver.
    aURL() {
      const person = personOf(this.resultados)
      const documentNumber = this.traza?.documento || person?.documento || this.q.trim()
      history.replaceState(null, '', tracePath(this.target, documentNumber, this.traza?.ureq, this.etapaSel))
    },

    // desdeURL corre al arrancar. Devuelve true si había una traza que abrir, para que la vista no muestre
    // el árbol declarado un instante antes de reemplazarlo.
    async desdeURL() {
      const path = currentPath()
      const p = new URLSearchParams(location.search)
      const target = path?.target || p.get('target')
      if (target && validTargets.has(target)) this.target = target
      // Una ruta breve siempre es una BÚSQUEDA. Es la única manera correcta de decidir si 36311543 es
      // cédula, teléfono o solicitud; y una solicitud se expande en el servidor a la persona completa.
      // En una ruta completa se pregunta por el uReq para mantener abierta exactamente esa corrida.
      const ureq = path?.ureq || p.get('ureq') || ''
      const query = ureq || path?.identificador || p.get('q') || ''
      if (!query || !/^\d+$/.test(query)) return false
      this.q = query
      await this.buscar()
      // `buscar` abre la directa cuando hay una sola. Se conserva este respaldo para una respuesta
      // cacheada muy vieja que no tuviera la bandera `directa`.
      if (ureq && this.traza?.ureq !== Number(ureq)) await this.verTraza(Number(ureq))
      // La etapa va DESPUÉS de la traza: antes no existe el árbol contra el que validarla.
      //
      // Y hay que reescribir la URL al final: `verTraza` ya la pisó con la etapa que ELIGE sola (la que
      // rompió), así que sin este `aURL()` el link decía `etapa=registro` mientras la vista mostraba
      // `buro` — la URL dejaba de describir lo que se ve, que es justo lo que vino a arreglar.
      const stage = path?.etapa || p.get('etapa')
      if (stage && this.etapas.some((e) => e.id === stage)) this.etapaSel = stage
      this.aURL()
      return true
    },

    recordar(q, results) {
      const person = personOf(results)
      const base = { target: this.target, q, personaKey: person?.personaKey || '' }
      const key = recentKey(base)
      const existing = recentList(this.recientes).find((item) => recentKey(item) === key || item.q === q)
      const recent = {
        ...base,
        tipo: kindOf(results) || existing?.tipo || '',
        documento: person?.documento || existing?.documento || '',
        telefono: person?.telefono || existing?.telefono || '',
        total: Array.isArray(results?.items) ? results.items.length : 0,
        solicitudes: loanRequestsOf(results),
        consultas: [...new Set([q, ...(existing?.consultas || [])])],
      }
      this.recientes = [recent, ...recentList(this.recientes)
        .filter((item) => recentKey(item) !== key && item.q !== q)].slice(0, 8)
      persistRecent(this.recientes)
    },

    // Las trazas guardadas antes del resumen de persona ya tenían su identificación disponible. Al volver
    // a abrir una, se aprovecha para completar la entrada visual sin pedir de nuevo la búsqueda completa.
    enriquecerReciente(trace) {
      if (!trace?.ureq) return
      const ureq = String(trace.ureq)
      let change = false
      const recentItems = recentList(this.recientes).map((recent) => {
        const belongs = recent.target === this.target && (recent.q === this.q || recent.solicitudes.includes(ureq))
        if (!belongs) return recent
        const updated = {
          ...recent,
          personaKey: trace.personaKey || recent.personaKey,
          documento: trace.documento || recent.documento,
          telefono: trace.telefono || recent.telefono,
        }
        if (updated.personaKey !== recent.personaKey || updated.documento !== recent.documento || updated.telefono !== recent.telefono) {
          change = true
        }
        return updated
      })
      if (!change) return
      this.recientes = recentList(recentItems)
      persistRecent(this.recientes)
    },

    async abrirReciente(value) {
      const recent = normalizeRecent(value)
      if (!recent) return
      this.target = recent.target
      this.q = recent.q
      await this.buscar()
    },

    async eliminarReciente(value) {
      const recent = normalizeRecent(value)
      if (!recent) return
      const key = recentKey(recent)
      this.recientes = recentList(this.recientes).filter((item) => recentKey(item) !== key)
      persistRecent(this.recientes)
      // En las entradas heredadas sólo se conoce el texto de búsqueda. Se conserva ese intento de
      // limpieza para que borrar una solicitud directa de la versión anterior siga borrando su traza.
      const loanRequests = recent.solicitudes.length
        ? recent.solicitudes
        : (/^\d+$/.test(recent.q) ? [recent.q] : [])
      await Promise.all([
        ...recent.consultas.map((query) => deleteSearch(recent.target, query)),
        ...loanRequests.map((ureq) => deleteQuery(recent.target, ureq)),
      ])
    },
  },
})
