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

// Un reciente es una consulta, no una solicitud suelta. Por ejemplo, buscar un teléfono guarda una
// entrada con todas sus solicitudes; abrir una fila sólo cambia la traza que se está viendo.
function claveReciente({ target, q }) { return `${target}:${q}` }

function normalizarReciente(valor) {
  const separador = typeof valor === 'string' ? valor.indexOf(':') : -1
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
  const total = Number.isInteger(desdeClave.total) && desdeClave.total >= 0
    ? desdeClave.total
    : (solicitudes.length || null)
  return { target, q, total, solicitudes }
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
        if (guardada?.resultados) this.resultados = guardada.resultados
        else {
          this.resultados = await json(`/api/buscar?q=${encodeURIComponent(q)}&target=${this.target}`)
          await guardarBusqueda({ target: this.target, q, resultados: toRaw(this.resultados) })
        }
        this.recordar(q, this.resultados)
        // Se abre sola la que se PIDIÓ, no «la única»: desde que el server expande a la persona, buscar un
        // número de solicitud devuelve toda su historia, y con la regla vieja (`items.length === 1`) dejaba
        // de abrir justo el caso más común — el ureq que llega por Jira. Con varias directas (una cédula
        // con 12 intentos) no se adivina: se eligen en los chips.
        const directas = (this.resultados.items || []).filter((i) => i.directa)
        if (directas.length === 1) await this.verTraza(directas[0].ureq)
      } catch (e) { this.error = e.message }
      finally { this.buscando = false; this.fase = '' }
    },

    async verTraza(ureq) {
      this.cargandoTraza = true; this.fase = 'armando'
      this.error = ''; this.etapaSel = null
      try {
        const target = this.target
        const guardada = await leerConsulta(target, ureq)
        if (guardada?.traza) {
          this.traza = guardada.traza
          // La búsqueda recién hecha tiene prioridad; al abrir desde la URL se recupera la historia
          // guardada con esta traza sin volver a pasar por `/api/buscar`.
          if (!this.resultados && guardada.resultados) this.resultados = guardada.resultados
        } else {
          this.traza = await json(`/api/traza?ureq=${ureq}&target=${target}`)
          // Se espera sólo la escritura local: ya hay datos en pantalla y la caché nunca lanza. `toRaw`
          // es necesario porque IndexedDB no puede clonar los proxies reactivos de Pinia.
          await guardarConsulta({ target, traza: toRaw(this.traza), resultados: toRaw(this.resultados) })
        }
        this.etapaSel = this.etapas[this.indiceInteresante]?.id ?? null
        this.aURL()
      } catch (e) { this.error = e.message; this.traza = null }
      finally { this.cargandoTraza = false; this.fase = '' }
    },

    seleccionar(id) {
      this.etapaSel = id
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
      const p = new URLSearchParams()
      p.set('target', this.target)
      if (this.traza?.ureq) p.set('ureq', this.traza.ureq)
      if (this.etapaSel) p.set('etapa', this.etapaSel)
      history.replaceState(null, '', p.toString() ? '?' + p : location.pathname)
    },

    // desdeURL corre al arrancar. Devuelve true si había una traza que abrir, para que la vista no muestre
    // el árbol declarado un instante antes de reemplazarlo.
    async desdeURL() {
      const p = new URLSearchParams(location.search)
      const target = p.get('target')
      if (target && ['prod', 'staging', 'dev', 'local'].includes(target)) this.target = target
      const ureq = p.get('ureq')
      if (!ureq || !/^\d+$/.test(ureq)) return false
      this.q = ureq
      await this.verTraza(Number(ureq))
      // La etapa va DESPUÉS de la traza: antes no existe el árbol contra el que validarla.
      //
      // Y hay que reescribir la URL al final: `verTraza` ya la pisó con la etapa que ELIGE sola (la que
      // rompió), así que sin este `aURL()` el link decía `etapa=registro` mientras la vista mostraba
      // `buro` — la URL dejaba de describir lo que se ve, que es justo lo que vino a arreglar.
      const etapa = p.get('etapa')
      if (etapa && this.etapas.some((e) => e.id === etapa)) this.etapaSel = etapa
      this.aURL()
      return true
    },

    recordar(q, resultados) {
      const reciente = {
        target: this.target,
        q,
        total: Array.isArray(resultados?.items) ? resultados.items.length : 0,
        solicitudes: solicitudesDe(resultados),
      }
      const clave = claveReciente(reciente)
      this.recientes = [reciente, ...listaRecientes(this.recientes).filter((item) => claveReciente(item) !== clave)].slice(0, 8)
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
        borrarBusqueda(reciente.target, reciente.q),
        ...solicitudes.map((ureq) => borrarConsulta(reciente.target, ureq)),
      ])
    },
  },
})
