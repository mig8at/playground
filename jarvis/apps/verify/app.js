// Verificación: el ingreso de práctica con dos pasos que necesitan a la persona. Cada correo tiene su código
// (verify.code.<correo>), así varias sesiones de Jarvis pueden verificarse a la vez en pestañas distintas; el
// «celular» (celular.html) los muestra todos.
const P = 'verify.'
const $ = (s) => document.querySelector(s)
if (new URLSearchParams(location.search).has('reset')) {
  Object.keys(localStorage).filter((k) => k.startsWith(P)).forEach((k) => localStorage.removeItem(k))
  history.replaceState(null, '', '/')
}
let email = ''
function show(step) {
  for (const s of ['login', 'code', 'hold', 'done']) $('#step-' + s).hidden = s !== step
  $('#who').textContent = email
  document.title = { login: 'Verificación · Ingreso', code: 'Verificación · Código', hold: 'Verificación · ¿Sos humano?', done: 'Verificación · Listo' }[step]
}

$('#login-form').onsubmit = (e) => {
  e.preventDefault()
  email = $('#email').value.trim().toLowerCase()
  const code = String(Math.floor(100000 + Math.random() * 900000))
  localStorage.setItem(P + 'code.' + email, code)
  show('code')
  $('#code').focus()
}

$('#code-form').onsubmit = (e) => {
  e.preventDefault()
  if ($('#code').value.trim() !== localStorage.getItem(P + 'code.' + email)) {
    $('#code-error').textContent = 'Ese código no es. Miralo en el celular.'
    return
  }
  $('#code-error').textContent = ''
  show('hold')
}

// Mantener apretado: un clic (lo que hace una herramienta) no alcanza; hay que sostenerlo 2 s.
const HOLD_MS = 2000
let holdStart = 0
let holdTimer = 0
function release() {
  clearInterval(holdTimer)
  holdStart = 0
  $('#hold-bar').style.width = '0%'
}
$('#hold').addEventListener('pointerdown', () => {
  holdStart = Date.now()
  clearInterval(holdTimer)
  holdTimer = setInterval(() => {
    const p = Math.min(1, (Date.now() - holdStart) / HOLD_MS)
    $('#hold-bar').style.width = Math.round(p * 100) + '%'
    if (p >= 1) {
      release()
      localStorage.setItem(P + 'ok.' + email, new Date().toISOString())
      show('done')
    }
  }, 50)
})
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('#hold').addEventListener(ev, () => { if (holdStart) release() })
show('login')
