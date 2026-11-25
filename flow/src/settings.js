import { reactive, watch } from 'vue'

// Preferencias de UI (persistidas aparte del escenario del grafo). El TEMA ya no es de Flow: lo pone `workbench.js`
// —el claro/oscuro y la paleta que elija Cockpit, o el del sistema fuera de él— (2026-11-25).
// Por DEFECTO el grafo muestra SOLO el flujo de solicitud (lo que decide el listado/cupo + los costos
// del cliente que entran en la cuota). Un ÚNICO check revela lo que NO participa en la
// solicitud (ruido documental): revenue (.cfg-biz), servicing (.cfg-servicing), datos informativos
// del buró (.pv--info) y campos inertes del admin (.fld-dead + su encabezado .cfg-sub--extra).
// La visibilidad se resuelve por CSS global via un atributo en <html> (sin tocar cada nodo).
function load() { try { return JSON.parse(localStorage.getItem('flow-settings')) || {} } catch { return {} } }
const s = load()

export const settings = reactive({
  // compat: si venías con alguno de los 3 checks viejos prendidos, arranca revelando
  showExtra: !!(s.showExtra ?? (s.showUnused || s.showBusiness || s.showServicing)),
})

function apply() {
  document.documentElement.toggleAttribute('data-hide-extra', !settings.showExtra) // presente por defecto = solo la solicitud
}
apply() // sincrónico al importar → sin parpadeo al cargar

watch(settings, () => {
  apply()
  try { localStorage.setItem('flow-settings', JSON.stringify({ showExtra: settings.showExtra })) } catch {}
}, { deep: true })
