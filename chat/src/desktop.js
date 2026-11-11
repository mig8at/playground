/* EL CHAT DENTRO DE COCKPIT (cockpit/): la misma interfaz, en un panel de la app de escritorio. Cockpit la abre con
   `?cockpit=1` dentro de un iframe, y se hablan por postMessage:
   - el chat le cuenta sus no leídos (`badge`): Cockpit los pone en su ícono de la barra y en el globito del Dock;
   - Cockpit le manda una ruta (`route`) al tocar un aviso: el chat abre esa conversación;
   - Cockpit le dice si está a la vista (`visible`): escondido detrás de otra app, el iframe se cree visible igual, así
     que acá se corrige `document.visibilityState` (y se avisa con `visibilitychange`). Así no marca leído lo que no ves.
   Los avisos no salen de esta ventana: los muestra el servidor con el avisador de macOS (server/notify.go). Los enlaces
   que abren ventana nueva los manda Cockpit a tu navegador.
   En el navegador (`make chat`, para desarrollar) todo esto no hace nada. */
const inCockpit = typeof window !== 'undefined' && window.parent !== window
  && new URLSearchParams(window.location.search).has('cockpit')
export const isDesktop = inCockpit

const toCockpit = (message) => window.parent.postMessage({ cockpit: true, ...message }, '*')

// Al registro del servidor (~/Library/Logs/creditop-playground-chat.log, «app: …»): lo que pasa adentro de la ventana.
export function report(text) {
  if (!inCockpit) return
  fetch('/api/desktop/log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: String(text) }) }).catch(() => {})
}

// Antes de montar la app.
export function setupDesktop() {
  if (!inCockpit) return Promise.resolve()
  let visible = false // hasta que Cockpit diga que está a la vista: cargado de fondo, no marca leído
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (visible ? 'visible' : 'hidden') })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible })
  window.addEventListener('message', (e) => {
    const d = e.data
    if (e.source !== window.parent || !d || d.cockpit !== true) return
    if (d.type === 'route' && typeof d.hash === 'string' && d.hash.startsWith('#/')) window.location.hash = d.hash
    if (d.type === 'visible' && visible !== !!d.visible) {
      visible = !!d.visible
      document.dispatchEvent(new Event('visibilitychange'))
    }
  })
  report('arrancó en Cockpit')
  return Promise.resolve()
}

// El numerito: los no leídos.
export function setBadge(count) {
  if (inCockpit) toCockpit({ type: 'badge', count })
}
