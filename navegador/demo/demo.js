// Credidemo: lo común a todas las páginas. El encabezado, el estado de la solicitud (sessionStorage) y la sesión.
const NAV = [
  ['/', 'Inicio'], ['/productos.html', 'Productos'], ['/solicitud/datos.html', 'Solicitar crédito'],
  ['/ayuda.html', 'Ayuda'], ['/contacto.html', 'Contacto'], ['/lab/', 'Laboratorio'],
]
export function header() {
  const logged = !!sessionStorage.getItem('demo.user')
  const h = document.createElement('header')
  h.className = 'site'
  // En el teléfono el menú se esconde detrás de ☰, como en la mayoría de los sitios: hay que abrirlo para navegar.
  h.innerHTML = `<a class="brand" href="/">Credidemo</a><button type="button" class="menu-btn" aria-label="Menú" aria-expanded="false" aria-controls="nav-principal">☰</button><nav id="nav-principal" aria-label="Principal">${NAV.map(([href, label]) =>
    `<a href="${href}" class="${location.pathname === href || (href !== '/' && location.pathname.startsWith(href)) ? 'on' : ''}">${label}</a>`).join('')}</nav>
    ${logged ? '<a href="/cuenta.html" style="color:#fff">Mi cuenta</a> <button id="logout" class="secondary">Salir</button>' : '<a href="/ingresar.html" style="color:#fff">Ingresar</a>'}`
  document.body.prepend(h)
  const menu = h.querySelector('.menu-btn')
  menu.addEventListener('click', () => {
    const open = h.classList.toggle('open')
    menu.setAttribute('aria-expanded', String(open))
  })
  h.querySelector('#logout')?.addEventListener('click', () => { sessionStorage.removeItem('demo.user'); location.href = '/' })
  const f = document.createElement('footer')
  f.className = 'site'
  f.textContent = 'Credidemo · sitio de práctica para navegador · nada de esto es real'
  document.body.append(f)
}
export const store = {
  get: () => JSON.parse(sessionStorage.getItem('demo.solicitud') || '{}'),
  set: (patch) => sessionStorage.setItem('demo.solicitud', JSON.stringify({ ...store.get(), ...patch })),
}
// Un paso exige el anterior: si se llega por URL sin completar, vuelve al que falta.
export function requireStep(key, back) { if (!store.get()[key]) location.replace(back) }

// Un aviso que aparece y se va solo (como los de muchas apps): quien lo quiera leer tiene que esperarlo a tiempo.
export function toast(text, ms = 3000) {
  let box = document.getElementById('toasts')
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.append(box) }
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = text
  box.append(t)
  setTimeout(() => t.remove(), ms)
}
