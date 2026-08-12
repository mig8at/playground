/* El único lugar que habla con el server de épicas. Todas devuelven la épica completa después de
   escribir —no un `{ok:true}`— para que el front nunca tenga que adivinar cómo quedó: se reemplaza
   el objeto y listo. Adivinar el resultado de una escritura es como se desincronizan las UIs. */

async function pedir(url, opciones = {}){
  const r = await fetch(url, {
    ...opciones,
    headers: opciones.body ? { 'content-type': 'application/json' } : undefined,
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  })
  if (!r.ok) {
    const detalle = await r.json().catch(() => ({}))
    throw new Error(detalle.error ?? `error ${r.status}`)
  }
  return r.json()
}

const base = '/api/epicas'
const q = s => encodeURIComponent(s)

export const listar        = ()                 => pedir(base)
export const crear         = (nombre, devs, repos) => pedir(base, { method: 'POST', body: { nombre, devs, repos } })
export const renombrar     = (id, nombre)       => pedir(`${base}/${q(id)}`, { method: 'PATCH', body: { nombre } })
export const borrar        = (id)               => pedir(`${base}/${q(id)}`, { method: 'DELETE' })

export const sumarDev      = (id, quien)        => pedir(`${base}/${q(id)}/devs`, { method: 'POST', body: { quien } })
export const sacarDev      = (id, quien)        => pedir(`${base}/${q(id)}/devs/${q(quien)}`, { method: 'DELETE' })

export const sumarRepo     = (id, repo, base_)  => pedir(`${base}/${q(id)}/repos`, { method: 'POST', body: { repo, base: base_ } })
export const sacarRepo     = (id, repo)         => pedir(`${base}/${q(id)}/repos/${q(repo)}`, { method: 'DELETE' })

export const sumarRama     = (id, datos)        => pedir(`${base}/${q(id)}/ramas`, { method: 'POST', body: datos })
// El nombre de rama trae barras: va por query, no por ruta.
export const sacarRama     = (id, repo, rama)   => pedir(`${base}/${q(id)}/ramas?repo=${q(repo)}&rama=${q(rama)}`, { method: 'DELETE' })

export const escribirDoc   = (id, quien, doc)   => pedir(`${base}/${q(id)}/docs/${q(quien)}`, { method: 'PUT', body: doc })
