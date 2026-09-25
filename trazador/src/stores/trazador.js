// El store. Una sola fuente de estado para toda la app.
//
// REGLA QUE ORDENA ESTE ARCHIVO: acá NO se decide nada del negocio. El estado de una etapa, qué familia
// ganó, dónde se rompió — todo eso viene ya resuelto del server, que a su vez lo saca de `ensamblar()` en
// Go. Si el store recalculara alguna de esas cosas habría dos definiciones de «esta etapa falló» y en el
// primer cambio se contradirían. El store guarda, pide y expone; no interpreta.
import { defineStore } from 'pinia'
import { toRaw } from 'vue'
import { readPref, savePref } from '../workbench.js'
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
  return { target: parts[1], identifier: identifier, ureq, stage: stage }
}

// Un reciente es una consulta, no una solicitud suelta. Por ejemplo, buscar un teléfono guarda una
// entrada con todas sus solicitudes; abrir una fila sólo cambia la traza que se está viendo.
function recentKey({ target, q, personKey: personKey }) {
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
  const loanRequests = Array.isArray(fromKey.requests)
    ? [...new Set(fromKey.requests.map(String).map((ureq) => ureq.trim()).filter(Boolean))]
    : []
  const queries = [...new Set([q, ...(Array.isArray(fromKey.queries)
    ? fromKey.queries.map(String).map((query) => query.trim()).filter(Boolean)
    : [])])]
  const total = Number.isInteger(fromKey.total) && fromKey.total >= 0
    ? fromKey.total
    : (loanRequests.length || null)
  const kind = typeof fromKey.kind === 'string' ? fromKey.kind.trim() : ''
  const personKey = typeof fromKey.personKey === 'string' ? fromKey.personKey.trim() : ''
  const documentNumber = typeof fromKey.document === 'string' ? fromKey.document.trim() : ''
  const phone = typeof fromKey.phone === 'string' ? fromKey.phone.trim() : ''
  return { target, q, kind: kind, personKey: personKey, document: documentNumber, phone: phone, total, requests: loanRequests, queries: queries }
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

// Con los helpers de la base: una falla del almacenamiento no impide usar el trazador.
function readRecent() {
  const saved = readPref('trazador.recent', [])
  return recentList(Array.isArray(saved) ? saved : [])
}

function persistRecent(recentItems) {
  savePref('trazador.recent', recentItems)
}

function loanRequestsOf(results) {
  return [...new Set((results?.items || []).map((item) => String(item?.ureq || '').trim()).filter(Boolean))]
}

function personOf(results) {
  const people = Array.isArray(results?.people) ? results.people : []
  if (people.length === 1 && typeof people[0]?.personKey === 'string' && people[0].personKey) {
    return {
      personKey: people[0].personKey,
      document: typeof people[0].document === 'string' ? people[0].document : '',
      phone: typeof people[0].phone === 'string' ? people[0].phone : '',
    }
  }
  // Las búsquedas cacheadas por versiones anteriores no traen el resumen `personas`, pero las filas
  // nuevas sí llevan su clave. Se aprovecha si todas pertenecen a la misma persona; con más de una no
  // se colapsa nada para no mezclar casos ambiguos.
  const keys = [...new Set((results?.items || []).map((item) => item?.personKey).filter(Boolean))]
  return keys.length === 1 ? { personKey: keys[0], document: '', phone: '' } : null
}

function isHidden(value) {
  return typeof value === 'string' && /[•*]/.test(value)
}

function hiddenIdentity(value) {
  return isHidden(value?.document) || isHidden(value?.phone)
}

function searchHasPerson(results) {
  // La propiedad existe incluso cuando la búsqueda no encuentra a nadie. Una identidad con asteriscos
  // es una caché heredada de cuando el API la ocultaba: se actualiza una vez al volver a abrirla para
  // que recientes, ficha y ruta tengan la cédula completa.
  return Array.isArray(results?.people) && !results.people.some(hiddenIdentity)
}

// Un resultado se guarda bajo sus equivalentes (uReq, cédula y teléfono), pero `directa` describe la
// llave original que pidió Redash. Al abrirlo por un alias se apaga esa marca: el operador ve el grupo
// completo y elige la corrida, en vez de que la caché seleccione una por una coincidencia de ayer.
function cacheResult(saved, q) {
  const results = saved?.results
  if (!results) return null
  const original = String(saved.originalQuery || saved.q || '').trim()
  if (!original || original === q) return results
  return {
    ...results,
    items: (results.items || []).map((item) => ({ ...item, direct: false })),
  }
}

function completeIdentity(trace, results) {
  if (!trace || !hiddenIdentity(trace)) return trace
  const person = personOf(results)
  if (!person || hiddenIdentity(person)) return trace
  if (trace.personKey && person.personKey && trace.personKey !== person.personKey) return trace
  const documentNumber = isHidden(trace.document) ? (person.document || trace.document) : trace.document
  const phone = isHidden(trace.phone) ? (person.phone || trace.phone) : trace.phone
  if (documentNumber === trace.document && phone === trace.phone) return trace
  return { ...trace, personKey: trace.personKey || person.personKey, document: documentNumber, phone: phone }
}

// El servidor prueba los tres identificadores y devuelve cómo coincidió. Ese dato es más confiable que
// inferir por longitud: una cédula puede tener diez dígitos y empezar por 3, igual que un celular.
function kindOf(results) {
  const matchesList = (results?.as || []).map((value) => String(value).split('→')[0].trim().toLowerCase())
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
    stageMap: null,
    target: 'prod',

    // La búsqueda
    q: '',
    searching: false,
    results: null,   // { como, items[] } · null = todavía no se buscó

    // La traza elegida
    loadingTrace: false,
    trace: null,
    selectedStage: null,
    error: '',

    // `fase` dice EN QUÉ va la carga, no sólo que está cargando. Contra prod son dos saltos que suman ~20 s
    // (búsqueda ~5 s + armado ~14 s, medido) porque Redash es asíncrono: un spinner mudo tanto tiempo se lee
    // como «se colgó». Decir cuál de los dos corre convierte la espera en información.
    phase: '',           // '' | 'buscando' | 'armando'

    // Las últimas búsquedas, en localStorage. En soporte se vuelve al mismo puñado de solicitudes todo el
    // día y volver a tipear el número es fricción pura.
    recentItems: readRecent(),
  }),

  getters: {
    // Las etapas SIEMPRE salen del mapa declarado, en el orden del flujo. Cuando hay traza se le pega su
    // estado; cuando no, quedan en gris. Así el árbol es el mismo objeto antes y después de consultar, y
    // no hay dos maneras de dibujarlo.
    stages(s) {
      if (!s.stageMap) return []
      const byID = Object.fromEntries((s.trace?.stages || []).map((e) => [e.id, e]))
      return s.stageMap.stages.map((d) => ({
        ...d,
        live: byID[d.id] || null,
        status: byID[d.id]?.status || 'pendiente',
      }))
    },
    activeStage(s) {
      const isIt = this.stages
      if (!isIt.length) return null
      const i = isIt.findIndex((e) => e.id === s.selectedStage)
      return i >= 0 ? isIt[i] : isIt[this.interestingIndex]
    },
    // Qué etapa abrir sola: la que rompió; si no rompió nada, la última con actividad. Es lo que uno
    // quiere ver al abrir un run fallido sin tener que buscarlo.
    interestingIndex(s) {
      const isIt = this.stages
      if (!isIt.length) return 0
      if (s.trace?.brokeAt) {
        const i = isIt.findIndex((e) => e.id === s.trace.brokeAt)
        if (i >= 0) return i
      }
      const f = isIt.findIndex((e) => e.status === 'fail' || e.status === 'warn')
      if (f >= 0) return f
      let u = 0
      isIt.forEach((e, i) => { if (e.live?.at) u = i })
      return u
    },
  },

  actions: {
    async loadMap() {
      try { this.stageMap = await json('/api/mapa') }
      catch (e) { this.error = 'no pude cargar el mapa: ' + e.message }
    },

    async search() {
      const q = this.q.trim()
      if (!q) return
      this.searching = true; this.phase = 'buscando'
      this.error = ''; this.results = null; this.trace = null
      try {
        const saved = await readSearch(this.target, q)
        const cached = cacheResult(saved, q)
        if (cached && searchHasPerson(cached)) this.results = cached
        else {
          try {
            this.results = await json(`/api/buscar?q=${encodeURIComponent(q)}&target=${this.target}`)
            await saveSearch({ target: this.target, q, results: toRaw(this.results) })
          } catch (e) {
            // Actualizar una caché de la versión anterior es una mejora, no una razón para ocultar una
            // consulta útil cuando la fuente remota está caída.
            if (saved?.results) this.results = saved.results
            else throw e
          }
        }
        this.remember(q, this.results)
        // Se abre sola la que se PIDIÓ, no «la única»: desde que el server expande a la persona, buscar un
        // número de solicitud devuelve toda su historia, y con la regla vieja (`items.length === 1`) dejaba
        // de abrir justo el caso más común — el ureq que llega por Jira. Con varias directas (una cédula
        // con 12 intentos) no se adivina: se eligen en los chips.
        const directOnes = (this.results.items || []).filter((i) => i.direct)
        if (directOnes.length === 1) await this.viewTrace(directOnes[0].ureq)
        // Cuando la consulta es cédula o celular no se abre arbitrariamente una solicitud, pero sí se
        // canoniza el link a la cédula. Una búsqueda por uReq termina arriba con su corrida seleccionada.
        this.aURL()
      } catch (e) { this.error = e.message }
      finally { this.searching = false; this.phase = '' }
    },

    async viewTrace(ureq) {
      const id = Number(ureq)
      // Elegir la fila que ya está abierta no es una carga: conserva la ficha y, sobre todo, no vuelve
      // a encender una barra que da a entender que se consultó la fuente.
      if (this.trace?.ureq === id) {
        this.aURL()
        return
      }
      this.loadingTrace = false; this.phase = ''
      this.error = ''; this.selectedStage = null
      try {
        const target = this.target
        const saved = await readQuery(target, id)
        // La corrida sólo llega a IndexedDB después de terminar. La ficha nueva de perfil de cupo no
        // puede derivarse sin riesgo de las líneas ya renderizadas de una caché vieja; una copia sin ese
        // campo se actualiza UNA vez. Luego queda completa en IndexedDB como cualquier otra corrida.
        const traceCache = completeIdentity(saved?.trace, this.results || saved?.results)
        if (traceCache && !hiddenIdentity(traceCache) && Array.isArray(traceCache.quotaProfiles)) {
          this.trace = traceCache
          // La búsqueda recién hecha tiene prioridad; al abrir desde la URL se recupera la historia
          // guardada con esta traza sin volver a pasar por `/api/buscar`.
          if (!this.results && saved.results) this.results = saved.results
          // Si la búsqueda abierta aportó la cédula completa, se corrige esta copia local sin pedir la
          // traza otra vez. Así un clic sobre una corrida heredada no vuelve a prender la barra.
          if (traceCache !== saved.trace) {
            await saveQuery({ target, trace: toRaw(traceCache), results: toRaw(this.results || saved.results) })
          }
        } else {
          // La barra representa exclusivamente trabajo remoto (BD + logs), nunca la lectura local.
          this.loadingTrace = true; this.phase = 'armando'
          const remote = await json(`/api/traza?ureq=${id}&target=${target}`)
          // Un servidor que todavía no se reinició tras agregar perfilesCupo no debe invalidar la misma
          // entrada para siempre: al migrarla se persiste `[]`, y la próxima recarga es totalmente local.
          this.trace = {
            ...remote,
            quotaProfiles: Array.isArray(remote.quotaProfiles) ? remote.quotaProfiles : [],
          }
          // Se espera sólo la escritura local: ya hay datos en pantalla y la caché nunca lanza. `toRaw`
          // es necesario porque IndexedDB no puede clonar los proxies reactivos de Pinia.
          await saveQuery({ target, trace: toRaw(this.trace), results: toRaw(this.results) })
        }
        this.selectedStage = this.stages[this.interestingIndex]?.id ?? null
        this.enrichRecent(this.trace)
        this.aURL()
      } catch (e) { this.error = e.message; this.trace = null }
      finally { this.loadingTrace = false; this.phase = '' }
    },

    select(id) {
      this.selectedStage = id
      this.aURL()
    },

    changeTarget() {
      // Una corrida de prod no puede seguir dibujada como si fuera de staging sólo porque cambió el
      // selector. Se conserva el texto de búsqueda para repetirlo en el nuevo ambiente, pero se limpia
      // todo lo que lleva evidencia del anterior antes de escribir la nueva ruta.
      this.trace = null
      this.results = null
      this.selectedStage = null
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
      const person = personOf(this.results)
      const documentNumber = this.trace?.document || person?.document || this.q.trim()
      history.replaceState(null, '', tracePath(this.target, documentNumber, this.trace?.ureq, this.selectedStage))
    },

    // desdeURL corre al arrancar. Devuelve true si había una traza que abrir, para que la vista no muestre
    // el árbol declarado un instante antes de reemplazarlo.
    async fromURL() {
      const path = currentPath()
      const p = new URLSearchParams(location.search)
      const target = path?.target || p.get('target')
      if (target && validTargets.has(target)) this.target = target
      // Una ruta breve siempre es una BÚSQUEDA. Es la única manera correcta de decidir si 36311543 es
      // cédula, teléfono o solicitud; y una solicitud se expande en el servidor a la persona completa.
      // En una ruta completa se pregunta por el uReq para mantener abierta exactamente esa corrida.
      const ureq = path?.ureq || p.get('ureq') || ''
      const query = ureq || path?.identifier || p.get('q') || ''
      if (!query || !/^\d+$/.test(query)) return false
      this.q = query
      await this.search()
      // `buscar` abre la directa cuando hay una sola. Se conserva este respaldo para una respuesta
      // cacheada muy vieja que no tuviera la bandera `directa`.
      if (ureq && this.trace?.ureq !== Number(ureq)) await this.viewTrace(Number(ureq))
      // La etapa va DESPUÉS de la traza: antes no existe el árbol contra el que validarla.
      //
      // Y hay que reescribir la URL al final: `verTraza` ya la pisó con la etapa que ELIGE sola (la que
      // rompió), así que sin este `aURL()` el link decía `etapa=registro` mientras la vista mostraba
      // `buro` — la URL dejaba de describir lo que se ve, que es justo lo que vino a arreglar.
      const stage = path?.stage || p.get('etapa')
      if (stage && this.stages.some((e) => e.id === stage)) this.selectedStage = stage
      this.aURL()
      return true
    },

    remember(q, results) {
      const person = personOf(results)
      const base = { target: this.target, q, personKey: person?.personKey || '' }
      const key = recentKey(base)
      const existing = recentList(this.recentItems).find((item) => recentKey(item) === key || item.q === q)
      const recent = {
        ...base,
        kind: kindOf(results) || existing?.kind || '',
        document: person?.document || existing?.document || '',
        phone: person?.phone || existing?.phone || '',
        total: Array.isArray(results?.items) ? results.items.length : 0,
        requests: loanRequestsOf(results),
        queries: [...new Set([q, ...(existing?.queries || [])])],
      }
      this.recentItems = [recent, ...recentList(this.recentItems)
        .filter((item) => recentKey(item) !== key && item.q !== q)].slice(0, 8)
      persistRecent(this.recentItems)
    },

    // Las trazas guardadas antes del resumen de persona ya tenían su identificación disponible. Al volver
    // a abrir una, se aprovecha para completar la entrada visual sin pedir de nuevo la búsqueda completa.
    enrichRecent(trace) {
      if (!trace?.ureq) return
      const ureq = String(trace.ureq)
      let change = false
      const recentItems = recentList(this.recentItems).map((recent) => {
        const belongs = recent.target === this.target && (recent.q === this.q || recent.requests.includes(ureq))
        if (!belongs) return recent
        const updated = {
          ...recent,
          personKey: trace.personKey || recent.personKey,
          document: trace.document || recent.document,
          phone: trace.phone || recent.phone,
        }
        if (updated.personKey !== recent.personKey || updated.document !== recent.document || updated.phone !== recent.phone) {
          change = true
        }
        return updated
      })
      if (!change) return
      this.recentItems = recentList(recentItems)
      persistRecent(this.recentItems)
    },

    async openRecent(value) {
      const recent = normalizeRecent(value)
      if (!recent) return
      this.target = recent.target
      this.q = recent.q
      await this.search()
    },

    async removeRecent(value) {
      const recent = normalizeRecent(value)
      if (!recent) return
      const key = recentKey(recent)
      this.recentItems = recentList(this.recentItems).filter((item) => recentKey(item) !== key)
      persistRecent(this.recentItems)
      // En las entradas heredadas sólo se conoce el texto de búsqueda. Se conserva ese intento de
      // limpieza para que borrar una solicitud directa de la versión anterior siga borrando su traza.
      const loanRequests = recent.requests.length
        ? recent.requests
        : (/^\d+$/.test(recent.q) ? [recent.q] : [])
      await Promise.all([
        ...recent.queries.map((query) => deleteSearch(recent.target, query)),
        ...loanRequests.map((ureq) => deleteQuery(recent.target, ureq)),
      ])
    },
  },
})
