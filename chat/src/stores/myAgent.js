/* MI AGENTE — un yo que contesta por vos cuando no estás (PROTOTIPO).
 *
 * Tiene cara (uno de los muñecos del creador de personajes, con sus colores), nombre y el modelo que va a usar. El
 * interruptor del pie dice quién contesta: «yo» o «mi agente». Con el agente prendido, a cada mensaje que te llega
 * después de prenderlo le arma una PROPUESTA de respuesta; no manda nada solo: «Mandar» la manda a tu nombre y
 * «Descartar» la tira.
 *
 * Por ahora la respuesta sale de una plantilla con lo que se sabe de verdad —tu estado y tus tareas de cuadrilla— y
 * el modelo sólo se elige: conectarlo es el paso siguiente. Dos reglas que no cambian al conectarlo:
 *   - se presenta siempre como agente: nadie tiene que creer que eras vos;
 *   - no decide por vos: informa y toma recados, pero no aprueba, no promete fechas ni acepta pedidos.
 *
 * Todo vive en este navegador (`chat:mi-agente:v1`).
 */
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
const STORAGE_KEY = 'chat:mi-agente:v2'
const OLD_KEY = 'chat:mi-agente:v1'

/* Tu agente es SIEMPRE el muñeco «Copete» (`Character_Male_1`): la forma no se elige. Arranca pelirrojo, de ojos
   negros, chaqueta roja y pantalón azul; los colores sí se cambian. */
export const BASE = 'Character_Male_1'
export const DEFAULT_COLORS = { hair: '#b7472a', skin: '#cfa78b', eyes: '#1e1e22', shirt: '#c0392b', pants: '#2c5aa0' }

// Los modelos que puede usar. Sólo se elige: todavía no contesta con ninguno.
export const MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'el más capaz: entiende mejor el contexto, tarda un poco más' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'el equilibrio entre calidad y velocidad' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', note: 'el más rápido y barato, para respuestas cortas' },
]

export const RULES = [
  'Se presenta siempre como tu agente.',
  'Contesta con tu estado y tus tareas de cuadrilla.',
  'Toma recados y te los deja marcados.',
  'No aprueba, no promete fechas ni acepta pedidos por vos.',
]

const DEFAULT = () => ({
  name: 'Mi agente', base: BASE, colors: { ...DEFAULT_COLORS },
  model: MODELS[1].id, mode: 'yo', modeSince: '', avatar: '',
})

function readStored() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (v && typeof v === 'object' && v.colors) return { ...DEFAULT(), ...v, base: BASE }
    // El de antes de la forma fija: se queda con su nombre, su modelo y quién contesta, con la apariencia nueva.
    const old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null')
    if (old && typeof old === 'object') {
      const { name, model, mode, modeSince } = old
      return { ...DEFAULT(), ...(name ? { name } : {}), ...(model ? { model } : {}), ...(mode ? { mode, modeSince: modeSince || '' } : {}) }
    }
  } catch { /* sin almacenamiento o dañado */ }
  return DEFAULT()
}

const firstName = (s) => String(s || '').split(/[\s@.]+/)[0]

export const useMyAgentStore = defineStore('myAgent', () => {
  const agent = ref(readStored())
  watch(agent, (value) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch { /* vive mientras la pestaña */ }
  }, { deep: true })

  // Prender el agente marca desde cuándo: sólo contesta lo que llegue después, nunca el historial.
  function setMode(mode) {
    if (agent.value.mode === mode) return
    agent.value.mode = mode
    agent.value.modeSince = mode === 'agente' ? new Date().toISOString() : ''
  }
  // Volver a los colores de siempre: pelirrojo, ojos negros, chaqueta roja y pantalón azul.
  function resetColors() { agent.value.colors = { ...DEFAULT_COLORS } }

  /* La propuesta de respuesta, con lo que se sabe de verdad. `tasks` son tus tareas de cuadrilla (las del chat).
     Una pregunta («?») o un pedido no se contestan: se toman como recado. */
  function draftReply({ from, text, tasks = [], owner = '' }) {
    const who = firstName(from) || 'hola'
    const me = firstName(owner) || 'mi persona'
    const going = tasks.filter((t) => !t.hecha && !t.bloqueo).slice(0, 2).map((t) => `«${t.titulo}»`)
    const blocked = tasks.filter((t) => t.bloqueo).slice(0, 1)
    const parts = [`🤖 Hola ${who}, soy ${agent.value.name}, el agente de ${me}. ${me} no está mirando el chat ahora y lo va a ver después.`]
    if (going.length) parts.push(`Anda con ${going.join(' y ')}.`)
    if (blocked.length) parts.push(`«${blocked[0].titulo}» está trabada esperando a ${blocked[0].bloqueo.depende_de}.`)
    const asks = /\?|¿|pod[eé]s|necesito|aprob|revis/i.test(String(text || ''))
    parts.push(asks
      ? `Lo que me pedís no lo decido yo: se lo dejo marcado a ${me} para que te conteste.`
      : `Si es urgente, dejame el detalle y se lo paso.`)
    return parts.join(' ')
  }

  return { agent, setMode, resetColors, draftReply }
})
