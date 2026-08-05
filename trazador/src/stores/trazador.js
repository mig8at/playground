// El store. Una sola fuente de estado para toda la app.
//
// REGLA QUE ORDENA ESTE ARCHIVO: acá NO se decide nada del negocio. El estado de una etapa, qué familia
// ganó, dónde se rompió — todo eso viene ya resuelto del server, que a su vez lo saca de `ensamblar()` en
// Go. Si el store recalculara alguna de esas cosas habría dos definiciones de «esta etapa falló» y en el
// primer cambio se contradirían. El store guarda, pide y expone; no interpreta.
import { defineStore } from 'pinia'

const json = async (url) => {
  const r = await fetch(url)
  const cuerpo = await r.json().catch(() => ({ error: `respuesta no-JSON (${r.status})` }))
  if (!r.ok) throw new Error(cuerpo.error || `HTTP ${r.status}`)
  return cuerpo
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
      this.buscando = true; this.error = ''; this.resultados = null; this.traza = null
      try {
        this.resultados = await json(`/api/buscar?q=${encodeURIComponent(q)}&target=${this.target}`)
        // Un solo resultado: se abre directo. Con varios hay que elegir, porque un cliente puede tener
        // hasta 228 intentos y adivinar cuál quería sería peor que preguntar.
        if (this.resultados.items?.length === 1) await this.verTraza(this.resultados.items[0].ureq)
      } catch (e) { this.error = e.message }
      finally { this.buscando = false }
    },

    async verTraza(ureq) {
      this.cargandoTraza = true; this.error = ''; this.etapaSel = null
      try {
        this.traza = await json(`/api/traza?ureq=${ureq}&target=${this.target}`)
        this.etapaSel = this.etapas[this.indiceInteresante]?.id ?? null
      } catch (e) { this.error = e.message; this.traza = null }
      finally { this.cargandoTraza = false }
    },

    seleccionar(id) { this.etapaSel = id },
  },
})
