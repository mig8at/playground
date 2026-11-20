// Inventario: la lista viene del servidor (GET /api/products), crear es POST y borrar es DELETE. Es lo que se aprende
// mirando la red de un flujo y se convierte en receta por API.
const $ = (s) => document.querySelector(s)
const API = '/api/products'
const pesos = (n) => '$' + Number(n || 0).toLocaleString('es-CO')
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
function notice(t) { const n = $('#notice'); n.textContent = t; n.hidden = false; clearTimeout(notice.t); notice.t = setTimeout(() => (n.hidden = true), 3000) }

async function load() {
  const list = await fetch(API).then((r) => r.json())
  $('#empty').hidden = list.length > 0
  $('#rows').innerHTML = list.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${pesos(p.price)}</td><td class="num">${esc(p.stock)}</td>
    <td class="num"><button type="button" class="danger" data-delete="${p.id}" aria-label="Eliminar ${esc(p.name)}">Eliminar</button></td></tr>`).join('')
}

$('#new').onclick = () => { $('#form').reset(); $('#error').textContent = ''; $('#editor').showModal(); $('#name').focus() }
$('#cancel').onclick = () => $('#editor').close()
$('#form').onsubmit = async (e) => {
  e.preventDefault()
  const body = { name: $('#name').value.trim(), price: Number($('#price').value), stock: Number($('#stock').value || 0) }
  const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) { $('#error').textContent = 'No se pudo guardar: ' + (await res.text()); return }
  $('#editor').close()
  notice('Producto creado')
  load()
}
$('#rows').onclick = async (e) => {
  const b = e.target.closest('[data-delete]')
  if (!b) return
  if (!confirm('¿Eliminar este producto? No se puede deshacer.')) return
  await fetch(`${API}/${b.dataset.delete}`, { method: 'DELETE' })
  notice('Producto eliminado')
  load()
}

;(async () => {
  if (new URLSearchParams(location.search).has('reset')) {
    await fetch(API, { method: 'DELETE' })
    history.replaceState(null, '', '/')
  }
  load()
})()
