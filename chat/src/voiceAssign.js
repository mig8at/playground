/* LA VOZ DE CADA PERSONAJE (lo que se le cambió: el ♂/♀ de la videollamada o el selector de voz de tus agentes en el
   perfil). Vive en el servidor (voice-assign.json, chat/server/voice_assign.go) y acá hay una sola copia para toda la
   app: lo que se cambia en el perfil lo ve la videollamada al momento. Lo que no está asignado usa la voz de su JSON
   (chat/src/characters). La clave es la del personaje: «miguel» o «miguel/luigi». */
import { reactive } from 'vue'

export const voiceAssign = reactive({ map: {} })

fetch('/api/voice/assign').then((r) => r.json()).then((d) => { voiceAssign.map = d.assign || {} }).catch(() => {})

/** Asignarle una voz (vacío: vuelve a la de su JSON). */
export async function assignVoice(key, voice) {
  const res = await fetch('/api/voice/assign', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: String(key).toLowerCase(), voice: voice || '' }) })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
  voiceAssign.map = (await res.json()).assign || {}
}
