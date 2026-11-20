// Demo · Tareas: crear, actualizar, completar y borrar tareas. Cada botón de una fila se llama con el título de su
// tarea («Editar Llamar al proveedor»): así un flujo llega a ESA tarea aunque la lista cambie de orden.
// Cada tarea vive en SU clave del localStorage (tareas.t.<id>). Varias pestañas de la app a la vez (varias sesiones de
// Jarvis en paralelo) lo comparten, y Chrome no hace atómico «leer, cambiar, escribir» entre pestañas: cada una lee de
// su copia y lo que escribe otra le llega unos milisegundos después. Con la lista entera en una sola clave, la última
// pestaña en guardar borraba lo que habían creado las otras (medido el 2026-11-20: 4 sesiones a la vez, quedaba 1; y
// releer antes de escribir no alcanzó). Con una clave por tarea, crear es agregar una clave nueva y nunca se pisan.
const PREFIX = 'tareas.t.'
const STARTED = 'tareas.iniciada' // ya se sembraron las de ejemplo (borrarlas todas deja la lista vacía, no la resiembra)
const OLD = 'tareas.estado' // el formato de antes: la lista entera en una clave; se migra al cargar
const SAMPLE = [
  { id: 1, pos: 1, titulo: 'Llamar al proveedor', fecha: '2026-11-12', prioridad: 'media', notas: 'Confirmar el envío de la semana', hecha: false },
  { id: 2, pos: 2, titulo: 'Revisar inventario', fecha: '2026-11-15', prioridad: 'baja', notas: '', hecha: false },
  { id: 3, pos: 3, titulo: 'Pagar arriendo', fecha: '2026-11-30', prioridad: 'alta', notas: '', hecha: true },
]
const keys = () => Object.keys(localStorage).filter((k) => k.startsWith(PREFIX))
const put = (t) => localStorage.setItem(PREFIX + t.id, JSON.stringify(t))
const get = (id) => { try { return JSON.parse(localStorage.getItem(PREFIX + id)) } catch { return null } }
const newId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000)
if (new URLSearchParams(location.search).has('reset')) {
  Object.keys(localStorage).filter((k) => k.startsWith('tareas.')).forEach((k) => localStorage.removeItem(k))
  history.replaceState(null, '', '/')
}
try { // migrar la lista vieja (una sola clave) a una clave por tarea
  const old = JSON.parse(localStorage.getItem(OLD))
  if (Array.isArray(old)) { old.forEach((t, i) => put({ pos: i, ...t })); localStorage.setItem(STARTED, '1') }
} catch { /* nada que migrar */ }
localStorage.removeItem(OLD)
if (!localStorage.getItem(STARTED)) { SAMPLE.forEach(put); localStorage.setItem(STARTED, '1') }
// Las nuevas arriba (pos negativa: la hora en que se crearon), después las de ejemplo en su orden.
const read = () => keys().map((k) => { try { return JSON.parse(localStorage.getItem(k)) } catch { return null } }).filter(Boolean)
  .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
let tasks = read()
const refresh = () => { tasks = read(); render() }
window.addEventListener('storage', (e) => { if (e.key === null || e.key.startsWith('tareas.')) refresh() })
const $ = (s) => document.querySelector(s)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const formatDate = (f) => (f ? new Date(f + 'T12:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) : 'sin fecha')
function notice(t) { const a = $('#aviso'); a.textContent = t; a.hidden = false; clearTimeout(notice.t); notice.t = setTimeout(() => (a.hidden = true), 3500) }

function render() {
  const q = $('#buscar').value.trim().toLowerCase()
  const vis = tasks.filter((t) => !q || t.titulo.toLowerCase().includes(q))
  $('#vacio').hidden = tasks.length > 0
  $('#lista').innerHTML = vis.map((t) => `<li class="tarea${t.hecha ? ' hecha' : ''}">
    <input type="checkbox" ${t.hecha ? 'checked' : ''} data-hecha="${t.id}" aria-label="Completada: ${esc(t.titulo)}">
    <div class="cuerpo"><strong>${esc(t.titulo)}</strong>
      <span class="muted">${formatDate(t.fecha)} · <span class="prio ${t.prioridad}">${t.prioridad}</span>${t.notas ? ' · ' + esc(t.notas) : ''}</span></div>
    <button type="button" class="sec" data-editar="${t.id}" aria-label="Editar ${esc(t.titulo)}">Editar</button>
    <button type="button" class="peligro" data-eliminar="${t.id}" aria-label="Eliminar ${esc(t.titulo)}">Eliminar</button>
  </li>`).join('')
}

let editing = null
function open(t) {
  editing = t ? t.id : null
  $('#editor-titulo').textContent = t ? 'Editar tarea' : 'Nueva tarea'
  $('#enviar').textContent = t ? 'Guardar cambios' : 'Crear tarea'
  $('#f-titulo').value = t?.titulo || ''
  $('#f-fecha').value = t?.fecha || ''
  $('#f-prioridad').value = t?.prioridad || 'media'
  $('#f-notas').value = t?.notas || ''
  $('#f-error').textContent = ''
  $('#editor').showModal()
  $('#f-titulo').focus()
}
$('#nueva').onclick = () => open(null)
$('#cancelar').onclick = () => $('#editor').close()
$('#buscar').oninput = render
$('#form').onsubmit = (e) => {
  e.preventDefault()
  const title = $('#f-titulo').value.trim()
  if (!title) { $('#f-error').textContent = 'El título no puede quedar vacío'; return }
  const fields = { titulo: title, fecha: $('#f-fecha').value, prioridad: $('#f-prioridad').value, notas: $('#f-notas').value.trim() }
  const id = editing
  const cur = id && get(id)
  if (cur) put({ ...cur, ...fields })
  else put({ id: newId(), pos: -Date.now(), hecha: false, ...fields }) // si otra pestaña la borró mientras se editaba, vuelve como nueva
  refresh(); $('#editor').close(); notice(id ? 'Tarea actualizada' : 'Tarea creada')
}
$('#lista').onclick = (e) => {
  const ed = e.target.closest('[data-editar]'), el = e.target.closest('[data-eliminar]')
  if (ed) open(tasks.find((t) => t.id === +ed.dataset.editar))
  if (el) {
    const t = tasks.find((x) => x.id === +el.dataset.eliminar)
    if (!confirm(`¿Eliminar «${t.titulo}»? No se puede deshacer.`)) return
    localStorage.removeItem(PREFIX + t.id); refresh(); notice('Tarea eliminada')
  }
}
$('#lista').onchange = (e) => {
  const c = e.target.closest('[data-hecha]')
  if (!c) return
  const t = get(+c.dataset.hecha)
  if (t) put({ ...t, hecha: c.checked })
  refresh()
}
render()
