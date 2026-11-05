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

// La operación del esquema para ese método y esa ruta (sin la consulta), con el ítem de su ruta; null si no está.
function operation(alias, method, path) {
  const paths = state[alias]?.info?.schema?.paths
  if (!paths) return null
  const bare = (path || '').split(/[?#]/)[0] || '/'
  const item = paths[bare] || Object.entries(paths).find(([p]) => p.includes('{') && pattern(p).test(bare))?.[1]
  const op = item?.[String(method).toLowerCase()]
  return op ? { item, op } : null
}

// `$ref` de un mismo documento (#/components/…).
export function deref(alias, node, depth = 0) {
  if (!node || depth > 8) return node
  const doc = state[alias]?.info?.schema
  if (node.$ref?.startsWith('#/')) return deref(alias, node.$ref.slice(2).split('/').reduce((o, k) => o?.[k], doc), depth + 1)
  return node
}

/* Los encabezados que el esquema declara para esa operación: sus parámetros `in: header` (los de la ruta y los de la
   operación) y, si lleva cuerpo, su Content-Type. Cada uno con `name`, `required`, `description` y `example`. */
export function headersFor(alias, method, path) {
  const found = operation(alias, method, path)
  if (!found) return []
  const { item, op } = found
  const byName = new Map()
  for (const raw of [...(item.parameters || []), ...(op.parameters || [])]) {
    const p = deref(alias, raw)
    if (p?.in !== 'header' || !p.name) continue
    byName.set(p.name.toLowerCase(), {
      name: p.name, required: !!p.required, description: p.description || '',
      example: String(p.example ?? p.schema?.example ?? p.schema?.default ?? ''),
    })
  }
  const types = Object.keys(deref(alias, op.requestBody)?.content || {})
  if (types.length && !byName.has('content-type')) {
    byName.set('content-type', { name: 'Content-Type', required: true, description: 'el tipo del cuerpo', example: types[0], value: types[0] })
  }
  return [...byName.values()]
}

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
