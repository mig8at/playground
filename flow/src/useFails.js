import { failing } from './store'

// Reglas que hacen fallar al lender seleccionado (para resaltar cada valor en su proveedor).
// Lee el computed COMPARTIDO del store — no crea uno por componente (antes: ~20 duplicados).
export function useFails() {
  return { fails: failing, bad: (key) => failing.value.has(key) }
}
