// El store. Una sola fuente de estado para toda la app.
//
// REGLA QUE ORDENA ESTE ARCHIVO: acá NO se decide nada del negocio. El estado de una etapa, qué familia
// ganó, dónde se rompió — todo eso viene ya resuelto del server, que a su vez lo saca de `ensamblar()` en
// Go. Si el store recalculara alguna de esas cosas habría dos definiciones de «esta etapa falló» y en el
// primer cambio se contradirían. El store guarda, pide y expone; no interpreta.
import { defineStore } from 'pinia'
import { toRaw } from 'vue'
import { borrarBusqueda, borrarConsulta, guardarBusqueda, guardarConsulta, leerBusqueda, leerConsulta } from '../consultasCache'

const json = async (url) => {
  const r = await fetch(url)
  const cuerpo = await r.json().catch(() => ({ error: `respuesta no-JSON (${r.status})` }))
  if (!r.ok) throw new Error(cuerpo.error || `HTTP ${r.status}`)
  return cuerpo
}

const targetsValidos = new Set(['prod', 'staging', 'qa', 'dev', 'local'])

// La URL se puede leer sin Vue Router: identifica una PERSONA y, opcionalmente, la corrida abierta.
// Así `/traza/prod/38612965` carga toda su historia y `/traza/prod/38612965/562414/listado` abre además
// una estación concreta. Nunca se adivina qué tipo de número es: el servidor lo busca como solicitud,
// teléfono y documento, y la ruta se normaliza a la cédula que encontró.
function rutaTraza(target, documento, ureq, etapa) {
  const partes = ['traza', target]
  const identificador = String(documento || '').trim()
  if (identificador) partes.push(identificador)
  if (ureq) {
    partes.push(String(ureq))
    if (etapa) partes.push(etapa)
  }
  return '/' + partes.map(encodeURIComponent).join('/')
}

function rutaActual() {
  const partes = location.pathname.split('/').filter(Boolean).map((parte) => {
    try { return decodeURIComponent(parte) } catch { return '' }
  })
  if (partes[0] !== 'traza' || !targetsValidos.has(partes[1] || '')) return null
  const identificador = partes[2] || ''
  const cuartaParte = partes[3] || ''
  const esRutaAnterior = /^\d+$/.test(identificador) && /^[a-z0-9-]+$/i.test(cuartaParte) && !/^\d+$/.test(cuartaParte)
  // La ruta breve (`/traza/:env/:numero`) ya no se asume como uReq: es una consulta por cualquiera de
  // los tres identificadores. La variante antigua con etapa sí era inequívocamente una traza y se sigue
  // leyendo para que los enlaces pegados antes de este cambio continúen funcionando.
  const ureq = esRutaAnterior ? identificador : (/^\d+$/.test(cuartaParte) ? cuartaParte : '')
  const etapaCandidata = esRutaAnterior ? cuartaParte : (partes[4] || '')
  const etapa = ureq && /^[a-z0-9-]+$/i.test(etapaCandidata) ? etapaCandidata : ''
  return { target: partes[1], identificador, ureq, etapa }
}

// Un reciente es una consulta, no una solicitud suelta. Por ejemplo, buscar un teléfono guarda una
// entrada con todas sus solicitudes; abrir una fila sólo cambia la traza que se está viendo.
function claveReciente({ target, q, personaKey }) {
  return personaKey ? `${target}:persona:${personaKey}` : `${target}:consulta:${q}`
}

function normalizarReciente(valor) {
  const separador = typeof valor === 'string' ? valor.indexOf(':') : -1
  if (typeof valor === 'string' && separador < 1) return null
  const desdeClave = typeof valor === 'string'
    ? { target: valor.slice(0, separador), q: valor.slice(separador + 1) }
    : valor
  if (!desdeClave || typeof desdeClave !== 'object') return null
  const target = String(desdeClave.target || '').trim()
  const q = String(desdeClave.q || '').trim()
  if (!target || !q) return null
  const solicitudes = Array.isArray(desdeClave.solicitudes)
    ? [...new Set(desdeClave.solicitudes.map(String).map((ureq) => ureq.trim()).filter(Boolean))]
    : []
  const consultas = [...new Set([q, ...(Array.isArray(desdeClave.consultas)
    ? desdeClave.consultas.map(String).map((consulta) => consulta.trim()).filter(Boolean)
    : [])])]
  const total = Number.isInteger(desdeClave.total) && desdeClave.total >= 0
    ? desdeClave.total
    : (solicitudes.length || null)
  const tipo = typeof desdeClave.tipo === 'string' ? desdeClave.tipo.trim() : ''
  const personaKey = typeof desdeClave.personaKey === 'string' ? desdeClave.personaKey.trim() : ''
  const documento = typeof desdeClave.documento === 'string' ? desdeClave.documento.trim() : ''
  const telefono = typeof desdeClave.telefono === 'string' ? desdeClave.telefono.trim() : ''
  return { target, q, tipo, personaKey, documento, telefono, total, solicitudes, consultas }
}

// `localStorage` es una preferencia, no una fuente confiable: puede venir de una versión anterior,
// de una extensión o de una edición manual. También admite las claves de la versión previa para no
// perder las consultas ya guardadas al actualizar la herramienta.
function listaRecientes(valor) {
  if (!Array.isArray(valor)) return []
  const vistos = new Set()
  return valor.map(normalizarReciente).filter((reciente) => {
    if (!reciente) return false
    const clave = claveReciente(reciente)
    if (vistos.has(clave)) return false
    vistos.add(clave)
    return true
  }).slice(0, 8)
}

function leerRecientes() {
  try { return listaRecientes(JSON.parse(localStorage.getItem('trazador.recientes') || '[]')) }
  catch { return [] }
}

function persistirRecientes(recientes) {
  try { localStorage.setItem('trazador.recientes', JSON.stringify(recientes)) }
  catch { /* El historial visual no puede impedir usar el trazador. */ }
}

function solicitudesDe(resultados) {
  return [...new Set((resultados?.items || []).map((item) => String(item?.ureq || '').trim()).filter(Boolean))]
}

function personaDe(resultados) {
  const personas = Array.isArray(resultados?.personas) ? resultados.personas : []
  if (personas.length === 1 && typeof personas[0]?.personaKey === 'string' && personas[0].personaKey) {
    return {
      personaKey: personas[0].personaKey,
      documento: typeof personas[0].documento === 'string' ? personas[0].documento : '',
      telefono: typeof personas[0].telefono === 'string' ? personas[0].telefono : '',
    }
  }
  // Las búsquedas cacheadas por versiones anteriores no traen el resumen `personas`, pero las filas
  // nuevas sí llevan su clave. Se aprovecha si todas pertenecen a la misma persona; con más de una no
  // se colapsa nada para no mezclar casos ambiguos.
  const claves = [...new Set((resultados?.items || []).map((item) => item?.personaKey).filter(Boolean))]
  return claves.length === 1 ? { personaKey: claves[0], documento: '', telefono: '' } : null
}

function estaOculto(valor) {
  return typeof valor === 'string' && /[•*]/.test(valor)
}

function identidadOculta(valor) {
  return estaOculto(valor?.documento) || estaOculto(valor?.telefono)
}

function busquedaTienePersona(resultados) {
  // La propiedad existe incluso cuando la búsqueda no encuentra a nadie. Una identidad con asteriscos
  // es una caché heredada de cuando el API la ocultaba: se actualiza una vez al volver a abrirla para
  // que recientes, ficha y ruta tengan la cédula completa.
  return Array.isArray(resultados?.personas) && !resultados.personas.some(identidadOculta)
}

// Un resultado se guarda bajo sus equivalentes (uReq, cédula y teléfono), pero `directa` describe la
// llave original que pidió Redash. Al abrirlo por un alias se apaga esa marca: el operador ve el grupo
// completo y elige la corrida, en vez de que la caché seleccione una por una coincidencia de ayer.
function resultadoDeCache(guardada, q) {
  const resultados = guardada?.resultados
  if (!resultados) return null
  const original = String(guardada.consultaOriginal || guardada.q || '').trim()
  if (!original || original === q) return resultados
  return {
    ...resultados,
    items: (resultados.items || []).map((item) => ({ ...item, directa: false })),
  }
}

function completarIdentidad(traza, resultados) {
  if (!traza || !identidadOculta(traza)) return traza
  const persona = personaDe(resultados)
  if (!persona || identidadOculta(persona)) return traza
  if (traza.personaKey && persona.personaKey && traza.personaKey !== persona.personaKey) return traza
  const documento = estaOculto(traza.documento) ? (persona.documento || traza.documento) : traza.documento
  const telefono = estaOculto(traza.telefono) ? (persona.telefono || traza.telefono) : traza.telefono
  if (documento === traza.documento && telefono === traza.telefono) return traza
  return { ...traza, personaKey: traza.personaKey || persona.personaKey, documento, telefono }
}

// El servidor prueba los tres identificadores y devuelve cómo coincidió. Ese dato es más confiable que
// inferir por longitud: una cédula puede tener diez dígitos y empezar por 3, igual que un celular.
function tipoDe(resultados) {
  const coincidencias = (resultados?.como || []).map((valor) => String(valor).split('→')[0].trim().toLowerCase())
  const tipos = [
    coincidencias.some((tipo) => tipo.includes('teléfono')) && 'Teléfono',
    coincidencias.some((tipo) => tipo.includes('documento')) && 'Cédula',
    coincidencias.some((tipo) => tipo.includes('solicitud')) && 'Solicitud',
  ].filter(Boolean)
  return tipos.join(' y ')
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
    recientes: leerRecientes(),
  }),

  getters: {
    // Las etapas SIEMPRE salen del mapa declarado, en el orden del flujo. Cuando hay traza se le pega su
    // estado; cuando no, quedan en gris. Así el árbol es el mismo objeto antes y después de consultar, y
    // no hay dos maneras de dibujarlo.
    etapas(s) {
      if (!s.mapa) return []
      const porID = Object.fromEntries((s.traza?.etapas || []).map((e) => [e.id, e]))
      return s.mapa.etapas.map((d) => ({
        ...d,
        vivo: porID[d.id] || null,
        estado: porID[d.id]?.status || 'pendiente',
      }))
    },
    etapaActiva(s) {
      const es = this.etapas
      if (!es.length) return null
      const i = es.findIndex((e) => e.id === s.etapaSel)
      return i >= 0 ? es[i] : es[this.indiceInteresante]
    },
    // Qué etapa abrir sola: la que rompió; si no rompió nada, la última con actividad. Es lo que uno
    // quiere ver al abrir un run fallido sin tener que buscarlo.
    indiceInteresante(s) {
      const es = this.etapas
      if (!es.length) return 0
      if (s.traza?.brokeAt) {
        const i = es.findIndex((e) => e.id === s.traza.brokeAt)
        if (i >= 0) return i
      }
      const f = es.findIndex((e) => e.estado === 'fail' || e.estado === 'warn')
      if (f >= 0) return f
      let u = 0
      es.forEach((e, i) => { if (e.vivo?.at) u = i })
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
        const guardada = await leerBusqueda(this.target, q)
        const cacheada = resultadoDeCache(guardada, q)
        if (cacheada && busquedaTienePersona(cacheada)) this.resultados = cacheada
        else {
          try {
            this.resultados = await json(`/api/buscar?q=${encodeURIComponent(q)}&target=${this.target}`)
            await guardarBusqueda({ target: this.target, q, resultados: toRaw(this.resultados) })
          } catch (e) {
            // Actualizar una caché de la versión anterior es una mejora, no una razón para ocultar una
            // consulta útil cuando la fuente remota está caída.
            if (guardada?.resultados) this.resultados = guardada.resultados
            else throw e
          }
        }
        this.recordar(q, this.resultados)
        // Se abre sola la que se PIDIÓ, no «la única»: desde que el server expande a la persona, buscar un
        // número de solicitud devuelve toda su historia, y con la regla vieja (`items.length === 1`) dejaba
        // de abrir justo el caso más común — el ureq que llega por Jira. Con varias directas (una cédula
        // con 12 intentos) no se adivina: se eligen en los chips.
        const directas = (this.resultados.items || []).filter((i) => i.directa)
        if (directas.length === 1) await this.verTraza(directas[0].ureq)
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
        const guardada = await leerConsulta(target, id)
        // La corrida sólo llega a IndexedDB después de terminar. La ficha nueva de perfil de cupo no
        // puede derivarse sin riesgo de las líneas ya renderizadas de una caché vieja; una copia sin ese
        // campo se actualiza UNA vez. Luego queda completa en IndexedDB como cualquier otra corrida.
        const trazaCache = completarIdentidad(guardada?.traza, this.resultados || guardada?.resultados)
        if (trazaCache && !identidadOculta(trazaCache) && Array.isArray(trazaCache.perfilesCupo)) {
          this.traza = trazaCache
          // La búsqueda recién hecha tiene prioridad; al abrir desde la URL se recupera la historia
          // guardada con esta traza sin volver a pasar por `/api/buscar`.
          if (!this.resultados && guardada.resultados) this.resultados = guardada.resultados
          // Si la búsqueda abierta aportó la cédula completa, se corrige esta copia local sin pedir la
          // traza otra vez. Así un clic sobre una corrida heredada no vuelve a prender la barra.
          if (trazaCache !== guardada.traza) {
            await guardarConsulta({ target, traza: toRaw(trazaCache), resultados: toRaw(this.resultados || guardada.resultados) })
          }
        } else {
          // La barra representa exclusivamente trabajo remoto (BD + logs), nunca la lectura local.
          this.cargandoTraza = true; this.fase = 'armando'
          const remota = await json(`/api/traza?ureq=${id}&target=${target}`)
          // Un servidor que todavía no se reinició tras agregar perfilesCupo no debe invalidar la misma
          // entrada para siempre: al migrarla se persiste `[]`, y la próxima recarga es totalmente local.
          this.traza = {
            ...remota,
            perfilesCupo: Array.isArray(remota.perfilesCupo) ? remota.perfilesCupo : [],
          }
          // Se espera sólo la escritura local: ya hay datos en pantalla y la caché nunca lanza. `toRaw`
          // es necesario porque IndexedDB no puede clonar los proxies reactivos de Pinia.
          await guardarConsulta({ target, traza: toRaw(this.traza), resultados: toRaw(this.resultados) })
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
      const persona = personaDe(this.resultados)
      const documento = this.traza?.documento || persona?.documento || this.q.trim()
      history.replaceState(null, '', rutaTraza(this.target, documento, this.traza?.ureq, this.etapaSel))
    },

    // desdeURL corre al arrancar. Devuelve true si había una traza que abrir, para que la vista no muestre
    // el árbol declarado un instante antes de reemplazarlo.
    async desdeURL() {
      const ruta = rutaActual()
      const p = new URLSearchParams(location.search)
      const target = ruta?.target || p.get('target')
      if (target && targetsValidos.has(target)) this.target = target
      // Una ruta breve siempre es una BÚSQUEDA. Es la única manera correcta de decidir si 36311543 es
      // cédula, teléfono o solicitud; y una solicitud se expande en el servidor a la persona completa.
      // En una ruta completa se pregunta por el uReq para mantener abierta exactamente esa corrida.
      const ureq = ruta?.ureq || p.get('ureq') || ''
      const consulta = ureq || ruta?.identificador || p.get('q') || ''
      if (!consulta || !/^\d+$/.test(consulta)) return false
      this.q = consulta
      await this.buscar()
      // `buscar` abre la directa cuando hay una sola. Se conserva este respaldo para una respuesta
      // cacheada muy vieja que no tuviera la bandera `directa`.
      if (ureq && this.traza?.ureq !== Number(ureq)) await this.verTraza(Number(ureq))
      // La etapa va DESPUÉS de la traza: antes no existe el árbol contra el que validarla.
      //
      // Y hay que reescribir la URL al final: `verTraza` ya la pisó con la etapa que ELIGE sola (la que
      // rompió), así que sin este `aURL()` el link decía `etapa=registro` mientras la vista mostraba
      // `buro` — la URL dejaba de describir lo que se ve, que es justo lo que vino a arreglar.
      const etapa = ruta?.etapa || p.get('etapa')
      if (etapa && this.etapas.some((e) => e.id === etapa)) this.etapaSel = etapa
      this.aURL()
      return true
    },

    recordar(q, resultados) {
      const persona = personaDe(resultados)
      const base = { target: this.target, q, personaKey: persona?.personaKey || '' }
      const clave = claveReciente(base)
      const existente = listaRecientes(this.recientes).find((item) => claveReciente(item) === clave || item.q === q)
      const reciente = {
        ...base,
        tipo: tipoDe(resultados) || existente?.tipo || '',
        documento: persona?.documento || existente?.documento || '',
        telefono: persona?.telefono || existente?.telefono || '',
        total: Array.isArray(resultados?.items) ? resultados.items.length : 0,
        solicitudes: solicitudesDe(resultados),
        consultas: [...new Set([q, ...(existente?.consultas || [])])],
      }
      this.recientes = [reciente, ...listaRecientes(this.recientes)
        .filter((item) => claveReciente(item) !== clave && item.q !== q)].slice(0, 8)
      persistirRecientes(this.recientes)
    },

    // Las trazas guardadas antes del resumen de persona ya tenían su identificación disponible. Al volver
    // a abrir una, se aprovecha para completar la entrada visual sin pedir de nuevo la búsqueda completa.
    enriquecerReciente(traza) {
      if (!traza?.ureq) return
      const ureq = String(traza.ureq)
      let cambio = false
      const recientes = listaRecientes(this.recientes).map((reciente) => {
        const corresponde = reciente.target === this.target && (reciente.q === this.q || reciente.solicitudes.includes(ureq))
        if (!corresponde) return reciente
        const actualizado = {
          ...reciente,
          personaKey: traza.personaKey || reciente.personaKey,
          documento: traza.documento || reciente.documento,
          telefono: traza.telefono || reciente.telefono,
        }
        if (actualizado.personaKey !== reciente.personaKey || actualizado.documento !== reciente.documento || actualizado.telefono !== reciente.telefono) {
          cambio = true
        }
        return actualizado
      })
      if (!cambio) return
      this.recientes = listaRecientes(recientes)
      persistirRecientes(this.recientes)
    },

    async abrirReciente(valor) {
      const reciente = normalizarReciente(valor)
      if (!reciente) return
      this.target = reciente.target
      this.q = reciente.q
      await this.buscar()
    },

    async eliminarReciente(valor) {
      const reciente = normalizarReciente(valor)
      if (!reciente) return
      const clave = claveReciente(reciente)
      this.recientes = listaRecientes(this.recientes).filter((item) => claveReciente(item) !== clave)
      persistirRecientes(this.recientes)
      // En las entradas heredadas sólo se conoce el texto de búsqueda. Se conserva ese intento de
      // limpieza para que borrar una solicitud directa de la versión anterior siga borrando su traza.
      const solicitudes = reciente.solicitudes.length
        ? reciente.solicitudes
        : (/^\d+$/.test(reciente.q) ? [reciente.q] : [])
      await Promise.all([
        ...reciente.consultas.map((consulta) => borrarBusqueda(reciente.target, consulta)),
        ...solicitudes.map((ureq) => borrarConsulta(reciente.target, ureq)),
      ])
    },
  },
})
