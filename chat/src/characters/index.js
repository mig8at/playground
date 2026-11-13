// LOS PERSONAJES DE LA VIDEOLLAMADA. Cada archivo .json de esta carpeta es un personaje; para sumar uno, se deja su
// JSON acá y aparece solo (Vite los junta con import.meta.glob). La forma de un archivo:
//
//   { "name": "Duncan", "handle": "duncan.estrada", "character": { ...piezas del personaje } }        una persona
//   { "name": "Rambo", "owner": "duncan.estrada", "agent": "rambo", "character": { ... } }            un agente
//
// Opcional: "voice": { "name": "Eddy", "lang": "es-MX", "pitch": 1, "rate": 1 }, la voz con que habla en la videollamada
// (una de las de macOS: `say -v '?' | grep es_`; el tono y la velocidad la vuelven propia). Con
// "gemini": { "voice": "Charon", "pitch": 0.86 } habla con esa voz de Gemini cuando la videollamada usa Gemini, y con
// "elevenlabs": { "voice": "Laura" } (nombre o id: `bin/pg elevenlabs voices`) cuando usa ElevenLabs.
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
 * Quiénes salen en la videollamada de una conversación: las personas que están en ella (y vos) y, de cada una, sus
 * agentes. keys son los participantes como los guarda el chat («correo» o «correo/agente»).
 */
export function cast(keys) {
  const users = new Set(keys.map((k) => userOf(String(k).split('/')[0])))
  const people = characters.filter((c) => c.handle && users.has(c.handle.toLowerCase()))
  const present = new Set(people.map((c) => c.handle.toLowerCase()))
  const agents = characters.filter((c) => c.owner && present.has(c.owner.toLowerCase()))
  // primero cada persona y después sus agentes, en el orden en que llegaron las personas
  // cada agente lleva el nombre de su persona, para la placa («agente de Duncan»)
  return people.flatMap((p) => [p, ...agents.filter((a) => a.owner.toLowerCase() === p.handle.toLowerCase()).map((a) => ({ ...a, ownerName: p.name }))])
}
