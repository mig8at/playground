// Rutas por hash, para que una herramienta (o `bin/cockpit open flow '#/…'`) arme un escenario sin clics:
//   #/lender?name=Finandina&rt=4[&product=credito]   crea la entidad si no existe y la ELIGE en el listado
//                                                     (guarda la oferta, así el recorrido sigue después del recheck)
//   para una delegada (rt=4), además, su ficha: engine=1|0 (la evalúa el motor de cupo, o su API) · radica=1|0 ·
//   days=2,16 (días de pago). Se aplican aunque la entidad ya exista.
//   select=0                                         la crea sin elegirla (para armar varias de una vez)
// La ruta se consume: después de aplicarla, el hash se limpia para que recargar no la repita.
import { nextTick } from 'vue'
import { customLenders, addCustomLender, selectOffer, findLenderDef, setDelegated } from './store'

function applyRoute() {
  const m = location.hash.match(/^#\/lender\?(.*)$/)
  if (!m) return
  const q = new URLSearchParams(m[1])
  const name = (q.get('name') || '').trim()
  if (!name) return
  if (!customLenders.some(l => l.name === name)) addCustomLender(name, Number(q.get('rt') ?? 2), q.get('product') || 'credito')
  const l = findLenderDef(name)
  if (l && l.rt === 4) {
    if (q.has('engine')) setDelegated(l, 'usesQuotaEngine', q.get('engine') === '1')
    if (q.has('radica')) setDelegated(l, 'formalization', q.get('radica') === '1')
    if (q.has('days')) {
      const days = q.get('days').split(',').map(Number).filter(n => n >= 1 && n <= 31)
      if (days.length) setDelegated(l, 'paymentDays', days)
    }
  }
  nextTick(() => {
    if (q.get('select') !== '0') selectOffer(name)
    history.replaceState(null, '', location.pathname + location.search)
  })
}

export function startRoutes() {
  window.addEventListener('hashchange', applyRoute)
  setTimeout(applyRoute, 0)   // después de la rehidratación del escenario guardado
}
