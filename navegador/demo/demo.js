// Credidemo: lo común a todas las páginas. El encabezado, el estado de la solicitud (sessionStorage) y la sesión.
const NAV = [
  ['/', 'Inicio'], ['/productos.html', 'Productos'], ['/solicitud/datos.html', 'Solicitar crédito'],
  ['/ayuda.html', 'Ayuda'], ['/contacto.html', 'Contacto'],
]
export function header() {
  const logged = !!sessionStorage.getItem('demo.user')
  const h = document.createElement('header')
  h.className = 'site'
  h.innerHTML = `<a class="brand" href="/">Credidemo</a><nav aria-label="Principal">${NAV.map(([href, label]) =>
    `<a href="${href}" class="${location.pathname === href ? 'on' : ''}">${label}</a>`).join('')}</nav>
    ${logged ? '<a href="/cuenta.html" style="color:#fff">Mi cuenta</a> <button id="logout" class="secondary">Salir</button>' : '<a href="/ingresar.html" style="color:#fff">Ingresar</a>'}`
  document.body.prepend(h)
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
