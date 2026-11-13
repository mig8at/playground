// LOS PERSONAJES DE LA VIDEOLLAMADA. Cada archivo .json de esta carpeta es un personaje; para sumar uno, se deja su
// JSON acá y aparece solo (Vite los junta con import.meta.glob). La forma de un archivo:
//
//   { "name": "Duncan", "handle": "duncan.estrada", "character": { ...piezas del personaje } }        una persona
//   { "name": "Rambo", "owner": "duncan.estrada", "agent": "rambo", "character": { ... } }            un agente
//
// Opcional: "voice": { "name": "Laura", "pitch": 1.04 }, la voz de ElevenLabs con que habla en la videollamada
// (nombre o id: `bin/pg elevenlabs voices`) y un toque de tono (más de 1, más agudo; menos, más grave).
//
// handle y owner son el usuario del chat (lo que va antes de @creditop.com). Las piezas de character son las del editor
// de Office (forma de cara, peinado, barba, especie…); lo que falte toma su valor por defecto. El dibujo y los gestos
// están en office-characters.js (el paquete de Office), que se regenera con
// `make office-package JS=chat/src/characters/office-characters.js`.
import './office-characters.js'

const files = import.meta.glob('./*.json', { eager: true, import: 'default' })
export const characters = Object.values(files)

const userOf = (key) => String(key || '').toLowerCase().split('@')[0]

/**
 * Quiénes salen en la videollamada de una conversación. keys son los participantes como los guarda el chat: «correo»
 * (una persona) o «correo/agente» (un agente). En una conversación directa no vienen agentes y salen las personas con
 * TODOS sus agentes; en un grupo vienen sus miembros exactos y salen ésos (un agente que no está en el grupo, no).
 */
export function cast(keys) {
  const people = new Set(keys.filter((k) => !String(k).includes('/')).map(userOf))
  const agents = new Set(keys.filter((k) => String(k).includes('/')).map((k) => {
    const [who, agent] = String(k).split('/')
    return `${userOf(who)}/${agent.toLowerCase()}`
  }))
  const persons = characters.filter((c) => c.handle && people.has(c.handle.toLowerCase()))
  const present = new Set(persons.map((c) => c.handle.toLowerCase()))
  const isIn = (a) => (agents.size ? agents.has(`${a.owner.toLowerCase()}/${a.agent.toLowerCase()}`) : present.has(a.owner.toLowerCase()))
  const team = characters.filter((c) => c.owner && isIn(c))
  // primero cada persona y después sus agentes, en el orden en que llegaron las personas; cada agente lleva el nombre
  // de su persona, para la placa («agente de Duncan»)
  return persons.flatMap((p) => [p, ...team.filter((a) => a.owner.toLowerCase() === p.handle.toLowerCase()).map((a) => ({ ...a, ownerName: p.name }))])
}
