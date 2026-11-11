/* LA APP DE ESCRITORIO (chat/src-tauri): la misma interfaz, abierta por Tauri en vez del navegador. Tauri deja
   `window.__TAURI__` (withGlobalTauri) y con eso, sólo ahí:
   - los avisos NO salen de esta ventana: se le saca `Notification` y el servidor los manda por el avisador de macOS
     («Chat del playground», scripts/notifier.sh), que al tocarlo abre la conversación en la app
     (`creditop-chat://open/#/c/…`). El plugin de avisos de Tauri no mostraba nada en macOS (medido 2026-11-11);
   - el globito del Dock con los no leídos;
   - los enlaces a otros sitios se abren en tu navegador (en el WebView un `target="_blank"` no hace nada).
   En el navegador todo esto no hace nada. */
const tauri = typeof window !== 'undefined' ? window.__TAURI__ : undefined
export const isDesktop = !!tauri

// Al registro del servidor (~/Library/Logs/creditop-playground-chat.log, «app: …»): lo que pasa adentro de la ventana.
export function report(text) {
  if (!tauri) return
  fetch('/api/desktop/log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: String(text) }) }).catch(() => {})
}

function openLinksOutside(opener) {
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href]') : null
    if (!a || e.defaultPrevented) return
    const url = new URL(a.href, location.href)
    if (url.origin === location.origin || !/^(https?|mailto):$/.test(url.protocol)) return
    e.preventDefault()
    opener.openUrl(url.href)
  }, true)
}

// Antes de montar la app: el chat le dice al servidor si esta ventana puede avisar al abrir el stream.
export function setupDesktop() {
  if (!tauri) return Promise.resolve()
  try { delete window.Notification } catch { /* sigue abajo */ }
  if (typeof window.Notification !== 'undefined') window.Notification = undefined
  if (tauri.opener) openLinksOutside(tauri.opener)
  report(`arrancó · enlaces ${tauri.opener ? 'afuera' : 'sin opener'} · globito ${tauri.window ? 'sí' : 'no'}`)
  return Promise.resolve()
}

// El globito del Dock: los no leídos, o nada.
export function setBadge(count) {
  if (!tauri?.window) return
  tauri.window.getCurrentWindow().setBadgeCount(count > 0 ? count : undefined).catch((e) => report(`globito: ${e}`))
}
