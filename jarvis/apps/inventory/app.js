// Inventario: la lista viene del servidor (GET /api/products), crear es POST y borrar es DELETE. Es lo que se aprende
// mirando la red de un flujo y se convierte en receta por API. Como en un admin real, hay pedidos que dependen de lo que
// devolvió otro: al crear un producto se le crea su SKU con el id que devolvió el POST (POST /api/skus {productId}), y
// «Publicar» lo cambia por su id (PUT /api/products/<id>). La receta tiene que encadenarlos, no dejar fijo el id de ese día.
const $ = (s) => document.querySelector(s)
const API = '/api/products'
const pesos = (n) => '$' + Number(n || 0).toLocaleString('es-CO')
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
function notice(t) { const n = $('#notice'); n.textContent = t; n.hidden = false; clearTimeout(notice.t); notice.t = setTimeout(() => (n.hidden = true), 3000) }

async function load() {
  const list = await fetch(API).then((r) => r.json())
  $('#empty').hidden = list.length > 0
  $('#rows').innerHTML = list.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${pesos(p.price)}</td><td class="num">${esc(p.stock)}</td>
    <td>${p.status === 'published' ? 'Publicado' : 'Borrador'}</td>
    <td class="num">${p.status === 'published' ? '' : `<button type="button" data-publish="${p.id}" aria-label="Publicar ${esc(p.name)}">Publicar</button> `}<button type="button" class="danger" data-delete="${p.id}" aria-label="Eliminar ${esc(p.name)}">Eliminar</button></td></tr>`).join('')
}

$('#new').onclick = () => { $('#form').reset(); $('#error').textContent = ''; $('#editor').showModal(); $('#name').focus() }
$('#cancel').onclick = () => $('#editor').close()
$('#form').onsubmit = async (e) => {
  e.preventDefault()
  const body = { name: $('#name').value.trim(), price: Number($('#price').value), stock: Number($('#stock').value || 0) }
  const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) { $('#error').textContent = 'No se pudo guardar: ' + (await res.text()); return }
  const created = await res.json()
  await fetch('/api/skus', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: created.id, code: 'SKU-' + created.id, stock: body.stock }) })
  $('#editor').close()
  notice('Producto creado')
  load()
}
$('#rows').onclick = async (e) => {
  const pub = e.target.closest('[data-publish]')
  if (pub) {
    const p = await fetch(`${API}/${pub.dataset.publish}`).then((r) => r.json())
    await fetch(`${API}/${p.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...p, status: 'published' }) })
    notice('Producto publicado')
    return load()
  }
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
    await fetch('/api/skus', { method: 'DELETE' })
    history.replaceState(null, '', '/')
  }
  load()
})()
