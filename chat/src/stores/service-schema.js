/* LO QUE UN SERVICIO DICE DE SÍ MISMO: su `/openapi.json` y su `/health`, leídos por el servidor del chat
   (GET /api/services/{alias}/schema). Lo comparten el sidebar derecho (ServiceSide.vue, que lista las rutas) y la ficha
   (ServicePanel.vue, donde el esquema fija el método de cada ruta). */
import { reactive } from 'vue'

const METHODS = ['get', 'post', 'put', 'patch', 'delete']
const state = reactive({})

export function schemaState(alias) {
  if (!(alias in state)) state[alias] = { info: null, loading: false }
  return state[alias]
}

export async function loadSchema(alias) {
  const s = schemaState(alias)
  s.loading = true
  try { s.info = await (await fetch(`/api/services/${encodeURIComponent(alias)}/schema`)).json() } catch (e) {
    s.info = { schemaError: e.message, healthError: e.message }
  } finally { s.loading = false }
}

// Una ruta del esquema como expresión: `/personas/{id}` acepta `/personas/7`.
const pattern = (path) => new RegExp('^' + path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^/}]+\}/g, '[^/]+') + '/?$')

/* Los métodos que el esquema declara para esa ruta (sin la consulta), en mayúsculas. `null` si no hay esquema (todo
   vale); `[]` si hay esquema y la ruta no está en él. */
export function methodsFor(alias, path) {
  const paths = state[alias]?.info?.schema?.paths
  if (!paths) return null
  const bare = (path || '').split(/[?#]/)[0] || '/'
  const exact = paths[bare]
  const item = exact || Object.entries(paths).find(([p]) => p.includes('{') && pattern(p).test(bare))?.[1]
  return item ? METHODS.filter((m) => item[m]).map((m) => m.toUpperCase()) : []
}
