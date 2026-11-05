// Demo · Tareas: crear, actualizar, completar y borrar tareas. Cada botón de una fila se llama con el título de su
// tarea («Editar Llamar al proveedor»): así un flujo llega a ESA tarea aunque la lista cambie de orden.
const KEY = 'tareas.estado'
const EJEMPLO = [
  { id: 1, titulo: 'Llamar al proveedor', fecha: '2026-11-12', prioridad: 'media', notas: 'Confirmar el envío de la semana', hecha: false },
  { id: 2, titulo: 'Revisar inventario', fecha: '2026-11-15', prioridad: 'baja', notas: '', hecha: false },
  { id: 3, titulo: 'Pagar arriendo', fecha: '2026-11-30', prioridad: 'alta', notas: '', hecha: true },
]
if (new URLSearchParams(location.search).has('restaurar')) { localStorage.removeItem(KEY); history.replaceState(null, '', '/') }
const leer = () => { try { return JSON.parse(localStorage.getItem(KEY)) || structuredClone(EJEMPLO) } catch { return structuredClone(EJEMPLO) } }
let tareas = leer()
const guardar = () => localStorage.setItem(KEY, JSON.stringify(tareas))
const $ = (s) => document.querySelector(s)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const fecha = (f) => (f ? new Date(f + 'T12:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) : 'sin fecha')
function aviso(t) { const a = $('#aviso'); a.textContent = t; a.hidden = false; clearTimeout(aviso.t); aviso.t = setTimeout(() => (a.hidden = true), 3500) }

function pintar() {
  const q = $('#buscar').value.trim().toLowerCase()
  const vis = tareas.filter((t) => !q || t.titulo.toLowerCase().includes(q))
  $('#vacio').hidden = tareas.length > 0
  $('#lista').innerHTML = vis.map((t) => `<li class="tarea${t.hecha ? ' hecha' : ''}">
    <input type="checkbox" ${t.hecha ? 'checked' : ''} data-hecha="${t.id}" aria-label="Completada: ${esc(t.titulo)}">
    <div class="cuerpo"><strong>${esc(t.titulo)}</strong>
      <span class="muted">${fecha(t.fecha)} · <span class="prio ${t.prioridad}">${t.prioridad}</span>${t.notas ? ' · ' + esc(t.notas) : ''}</span></div>
    <button type="button" class="sec" data-editar="${t.id}" aria-label="Editar ${esc(t.titulo)}">Editar</button>
    <button type="button" class="peligro" data-eliminar="${t.id}" aria-label="Eliminar ${esc(t.titulo)}">Eliminar</button>
  </li>`).join('')
}

let editando = null
function abrir(t) {
  editando = t ? t.id : null
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
$('#nueva').onclick = () => abrir(null)
$('#cancelar').onclick = () => $('#editor').close()
$('#buscar').oninput = pintar
$('#form').onsubmit = (e) => {
  e.preventDefault()
  const titulo = $('#f-titulo').value.trim()
  if (!titulo) { $('#f-error').textContent = 'El título no puede quedar vacío'; return }
  const datos = { titulo, fecha: $('#f-fecha').value, prioridad: $('#f-prioridad').value, notas: $('#f-notas').value.trim() }
  if (editando) Object.assign(tareas.find((t) => t.id === editando), datos)
  else tareas.unshift({ id: Math.max(0, ...tareas.map((t) => t.id)) + 1, hecha: false, ...datos })
  guardar(); $('#editor').close(); pintar(); aviso(editando ? 'Tarea actualizada' : 'Tarea creada')
}
$('#lista').onclick = (e) => {
  const ed = e.target.closest('[data-editar]'), el = e.target.closest('[data-eliminar]')
  if (ed) abrir(tareas.find((t) => t.id === +ed.dataset.editar))
  if (el) {
    const t = tareas.find((x) => x.id === +el.dataset.eliminar)
    if (!confirm(`¿Eliminar «${t.titulo}»? No se puede deshacer.`)) return
    tareas = tareas.filter((x) => x.id !== t.id); guardar(); pintar(); aviso('Tarea eliminada')
  }
}
$('#lista').onchange = (e) => {
  const c = e.target.closest('[data-hecha]')
  if (!c) return
  tareas.find((t) => t.id === +c.dataset.hecha).hecha = c.checked; guardar(); pintar()
}
pintar()
