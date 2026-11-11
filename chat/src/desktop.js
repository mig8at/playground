/* LA APP DE ESCRITORIO (chat/src-tauri): la misma interfaz, abierta por Tauri en vez del navegador. Tauri deja
   `window.__TAURI__` (withGlobalTauri) y con eso, sólo ahí:
   - los avisos: el WebView de macOS no trae `Notification`, así que se pone uno que los manda por el aviso nativo.
     El resto del chat no cambia: pide permiso, el servidor sabe que esta ventana puede avisar y le pasa los avisos;
   - el globito del Dock con los no leídos;
   - los enlaces a otros sitios se abren en tu navegador (en el WebView un `target="_blank"` no hace nada).
   En el navegador todo esto no hace nada. */
const tauri = typeof window !== 'undefined' ? window.__TAURI__ : undefined
export const isDesktop = !!tauri

// El Notification de la app: lo justo que usa el chat (permission, requestPermission, new Notification). Tocar el aviso
// trae la app al frente (en macOS el plugin no avisa del clic, así que no abre la conversación).
function installNotification(api) {
  class DesktopNotification {
    static permission = 'default'
    static async requestPermission() {
      DesktopNotification.permission = await api.requestPermission()
      return DesktopNotification.permission
    }
    constructor(title, options = {}) {
      this.onclick = null
      api.sendNotification({ title, body: options.body || '' })
    }
    close() {}
  }
  window.Notification = DesktopNotification
  return api.isPermissionGranted().then((granted) => { if (granted) DesktopNotification.permission = 'granted' })
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

// Antes de montar la app: el permiso de avisos tiene que estar sabido cuando el chat abre el stream.
export function setupDesktop() {
  if (!tauri) return Promise.resolve()
  if (tauri.opener) openLinksOutside(tauri.opener)
  return tauri.notification ? installNotification(tauri.notification).catch(() => {}) : Promise.resolve()
}

// El globito del Dock: los no leídos, o nada.
export function setBadge(count) {
  if (!tauri?.window) return
  tauri.window.getCurrentWindow().setBadgeCount(count > 0 ? count : undefined).catch(() => {})
}
