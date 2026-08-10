// Un solo lugar que habla con el server. Devuelve el error del backend tal cual
// (el server ya manda `{"error": "..."}` legible), sin re-traducirlo acá — dos
// capas escribiendo el mismo mensaje es cómo se llega a mensajes que no coinciden.
export async function pedir(ruta, opciones = {}) {
  const res = await fetch(ruta, {
    ...opciones,
    headers: { 'Content-Type': 'application/json', ...(opciones.headers || {}) },
  })
  let cuerpo = null
  try {
    cuerpo = await res.json()
  } catch {
    cuerpo = {}
  }
  if (!res.ok) throw new Error(cuerpo.error || `HTTP ${res.status}`)
  return cuerpo
}

export const post = (ruta, datos) =>
  pedir(ruta, { method: 'POST', body: JSON.stringify(datos ?? {}) })
