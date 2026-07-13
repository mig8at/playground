import { reactive, watch } from 'vue'

// Preferencias de UI (persistidas aparte del escenario del grafo): tema + visibilidad.
// Por DEFECTO el grafo muestra SOLO el flujo de solicitud (lo que decide el listado/cupo + los costos
// del cliente que entran en la cuota). Un ÚNICO check revela lo que NO participa en la
// solicitud (ruido documental): revenue (.cfg-biz), servicing (.cfg-servicing), datos informativos
// del buró (.pv--info) y campos inertes del admin (.fld-dead + su encabezado .cfg-sub--extra).
//  · theme     → tema claro/oscuro (data-theme en <html>)
//  · showExtra → revela los campos fuera del flujo de solicitud (quita data-hide-extra)
// La visibilidad se resuelve por CSS global via atributos en <html> (sin tocar cada nodo).
function load() { try { return JSON.parse(localStorage.getItem('flow-settings')) || {} } catch { return {} } }
function legacyTheme() { try { return localStorage.getItem('flow-theme') } catch { return null } } // compat clave vieja
const s = load()

export const settings = reactive({
  theme: (s.theme || legacyTheme()) === 'light' ? 'light' : 'dark', // nace oscuro
  // compat: si venías con alguno de los 3 checks viejos prendidos, arranca revelando
  showExtra: !!(s.showExtra ?? (s.showUnused || s.showBusiness || s.showServicing)),
})

function apply() {
  const el = document.documentElement
  el.setAttribute('data-theme', settings.theme)
  el.toggleAttribute('data-hide-extra', !settings.showExtra) // presente por defecto = solo la solicitud
}
apply() // sincrónico al importar → sin parpadeo al cargar

watch(settings, () => {
  apply()
  try {
    localStorage.setItem('flow-settings', JSON.stringify({ theme: settings.theme, showExtra: settings.showExtra }))
  } catch {}
}, { deep: true })

export function toggleTheme() { settings.theme = settings.theme === 'dark' ? 'light' : 'dark' }
