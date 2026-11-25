// Rutas por hash, para que una herramienta (o `bin/cockpit open flow '#/…'`) arme un escenario sin clics:
//   #/lender?name=Finandina&rt=4[&product=credito]   crea la entidad si no existe y la ELIGE en el listado
//                                                     (guarda la oferta, así el recorrido sigue después del recheck)
// La ruta se consume: después de aplicarla, el hash se limpia para que recargar no la repita.
import { nextTick } from 'vue'
import { customLenders, addCustomLender, selectOffer } from './store'

function applyRoute() {
  const m = location.hash.match(/^#\/lender\?(.*)$/)
  if (!m) return
  const q = new URLSearchParams(m[1])
  const name = (q.get('name') || '').trim()
  if (!name) return
  if (!customLenders.some(l => l.name === name)) addCustomLender(name, Number(q.get('rt') ?? 2), q.get('product') || 'credito')
  nextTick(() => {
    selectOffer(name)
    history.replaceState(null, '', location.pathname + location.search)
  })
}

export function startRoutes() {
  window.addEventListener('hashchange', applyRoute)
  setTimeout(applyRoute, 0)   // después de la rehidratación del escenario guardado
}
