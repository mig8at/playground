/* LOS PERSONAJES DE LA OFICINA — los que creás en el creador (`#/personajes`).
 *
 * Cada uno es una forma del kit, cinco colores y un nombre. Se guardan en el navegador
 * (`localStorage`, `chat:characters:v1`), como el historial del chat. Si no hay ninguno, arranca con los cuatro
 * del kit con sus colores de siempre. La oficina lleva hasta `MAX_IN_OFFICE`.
 */
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { BASES, ORIGINAL_COLORS } from '../office/appearance.js'

const STORAGE_KEY = 'chat:characters:v1'
export const MAX_IN_OFFICE = 8

const newId = () => (globalThis.crypto?.randomUUID?.() || `c${Date.now()}${Math.random().toString(36).slice(2, 7)}`)

const DEFAULTS = [
  ['Character_Male_1', 'Mateo'], ['Character_Female_1', 'Ana'], ['Character_Male_2', 'Samuel'], ['Character_Female_2', 'Lucía'],
].map(([base, name]) => ({ id: newId(), name, base, colors: { ...ORIGINAL_COLORS[base] } }))

function readStored() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (Array.isArray(list) && list.every((c) => c && BASES[c.base] && c.colors)) return list
  } catch { /* sin almacenamiento o dañado: los de siempre */ }
  return null
}

export const useCharactersStore = defineStore('characters', () => {
  const characters = ref(readStored() || DEFAULTS)
  watch(characters, (value) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch { /* vive mientras la pestaña */ }
  }, { deep: true })

  function add(base = 'Character_Male_1') {
    const character = { id: newId(), name: `Personaje ${characters.value.length + 1}`, base, colors: { ...ORIGINAL_COLORS[base] } }
    characters.value.push(character)
    return character
  }
  function remove(id) {
    characters.value = characters.value.filter((c) => c.id !== id)
  }
  // Cambiar de forma conserva los colores elegidos: la paleta es la misma en las cuatro.
  function setBase(id, base) {
    const c = characters.value.find((x) => x.id === id)
    if (c && BASES[base]) c.base = base
  }
  function resetColors(id) {
    const c = characters.value.find((x) => x.id === id)
    if (c) c.colors = { ...ORIGINAL_COLORS[c.base] }
  }

  return { characters, add, remove, setBase, resetColors }
})
