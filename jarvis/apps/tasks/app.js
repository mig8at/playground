// Demo · Tareas: crear, actualizar, completar y borrar tareas. Cada botón de una fila se llama con el título de su
// tarea («Editar Llamar al proveedor»): así un flujo llega a ESA tarea aunque la lista cambie de orden.
const KEY = 'tareas.estado'
const SAMPLE = [
  { id: 1, titulo: 'Llamar al proveedor', fecha: '2026-11-12', prioridad: 'media', notas: 'Confirmar el envío de la semana', hecha: false },
  { id: 2, titulo: 'Revisar inventario', fecha: '2026-11-15', prioridad: 'baja', notas: '', hecha: false },
  { id: 3, titulo: 'Pagar arriendo', fecha: '2026-11-30', prioridad: 'alta', notas: '', hecha: true },
]
if (new URLSearchParams(location.search).has('reset')) { localStorage.removeItem(KEY); history.replaceState(null, '', '/') }
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || structuredClone(SAMPLE) } catch { return structuredClone(SAMPLE) } }
let tasks = read()
const save = () => localStorage.setItem(KEY, JSON.stringify(tasks))
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
  if (editing) Object.assign(tasks.find((t) => t.id === editing), fields)
  else tasks.unshift({ id: Math.max(0, ...tasks.map((t) => t.id)) + 1, hecha: false, ...fields })
  save(); $('#editor').close(); render(); notice(editing ? 'Tarea actualizada' : 'Tarea creada')
}
$('#lista').onclick = (e) => {
  const ed = e.target.closest('[data-editar]'), el = e.target.closest('[data-eliminar]')
  if (ed) open(tasks.find((t) => t.id === +ed.dataset.editar))
  if (el) {
    const t = tasks.find((x) => x.id === +el.dataset.eliminar)
    if (!confirm(`¿Eliminar «${t.titulo}»? No se puede deshacer.`)) return
    tasks = tasks.filter((x) => x.id !== t.id); save(); render(); notice('Tarea eliminada')
  }
}
$('#lista').onchange = (e) => {
  const c = e.target.closest('[data-hecha]')
  if (!c) return
  tasks.find((t) => t.id === +c.dataset.hecha).hecha = c.checked; save(); render()
}
render()
