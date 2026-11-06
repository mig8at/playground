// Panel Andino: un admin de tienda ficticio con lo que hace difícil a uno real. Rutas por hash, cada página de
// configuración edita un BORRADOR (aparece la barra «Cambios sin guardar»; salir con cambios pregunta), activar un
// medio de pago pide confirmación, y la app Crédito Ya vive en un iframe (ahí están sus credenciales de pruebas).
const KEY = 'panel.estado'
const INICIAL = {
  general: { nombre: 'Tienda Andina', correo: 'hola@tiendaandina.test', moneda: 'COP', zona: 'America/Bogota' },
  pagos: [
    { id: 'pasarelax', nombre: 'PasarelaX · Tarjetas', activo: true, config: { modo: 'produccion', comercio: 'PX-88213' } },
    { id: 'contraentrega', nombre: 'Contra entrega', activo: false, config: {} },
  ],
  envios: {
    gratis: false, gratisDesde: 0,
    zonas: [{ nombre: 'Bogotá', tarifa: 8000, dias: '1 a 2' }, { nombre: 'Resto del país', tarifa: 15000, dias: '3 a 5' }],
    transportadoras: { servientrega: true, coordinadora: false, interrapidisimo: false },
  },
  impuestos: { incluidos: true, iva: 19 },
  usuarios: [{ nombre: 'Ana Prueba', correo: 'ana@tiendaandina.test', rol: 'Dueña' }, { nombre: 'Luis Prueba', correo: 'luis@tiendaandina.test', rol: 'Ventas' }],
  invitaciones: [],
  apps: { creditoya: { conectada: false } },
}
const PROVEEDORES = [
  { id: 'creditoya', nombre: 'Crédito Ya', desc: 'Pagos a cuotas: el cliente paga en 3, 6 o 12 cuotas y vos recibís el total.' },
  { id: 'transferpay', nombre: 'TransferPay', desc: 'Transferencia bancaria inmediata.' },
  { id: 'billeteraz', nombre: 'BilleteraZ', desc: 'Pago con billetera móvil.' },
]
if (new URLSearchParams(location.search).has('restaurar')) { localStorage.removeItem(KEY); history.replaceState(null, '', '/#/inicio') }
const leer = () => { try { return JSON.parse(localStorage.getItem(KEY)) || structuredClone(INICIAL) } catch { return structuredClone(INICIAL) } }
let estado = leer()
const persistir = () => localStorage.setItem(KEY, JSON.stringify(estado))
const $ = (s, r = document) => r.querySelector(s)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const pesos = (n) => '$' + Number(n || 0).toLocaleString('es-CO')

// ── el borrador de la página abierta y la barra de guardar ──
let borrador = null // { aplicar(): string|null (error), descartar() }
let sucio = false
function marcarSucio() { if (!sucio) { sucio = true; $('#guardar-barra').hidden = false } }
function limpiar() { sucio = false; $('#guardar-barra').hidden = true; $('#guardar-barra .err')?.remove() }
$('#descartar').onclick = () => { limpiar(); render() }
$('#guardar').onclick = () => {
  $('#guardar-barra .err')?.remove()
  const err = borrador?.aplicar()
  if (err) { $('#guardar-barra').insertAdjacentHTML('beforeend', `<span class="err" role="alert">${esc(err)}</span>`); return }
  persistir(); limpiar(); aviso('Cambios guardados')
  if (irA) { const d = irA; irA = null; location.hash = d } else render()
}
let irA = null // a dónde vuelve después de guardar (un medio de pago nuevo vuelve a la lista)
function aviso(t) {
  const d = document.createElement('div'); d.className = 'aviso'; d.setAttribute('role', 'status'); d.textContent = t
  document.body.append(d); setTimeout(() => d.remove(), 3500)
}
// Salir con cambios sin guardar pregunta, como en los paneles de verdad.
let ultimaRuta = location.hash || '#/inicio'
window.addEventListener('hashchange', () => {
  if (sucio && location.hash !== ultimaRuta) {
    const destino = location.hash
    history.replaceState(null, '', ultimaRuta)
    modal(`<h2>Tenés cambios sin guardar</h2><p>Si salís ahora, se pierden.</p>
      <div class="fila"><button type="button" class="sec" data-cerrar>Seguir editando</button><button type="button" class="peligro" id="salir">Salir sin guardar</button></div>`,
    (m) => { $('#salir', m).onclick = () => { m.close(); limpiar(); location.hash = destino } })
    return
  }
  render()
})
function modal(html, init) {
  const m = $('#modal'); m.innerHTML = html
  m.querySelectorAll('[data-cerrar]').forEach((b) => (b.onclick = () => m.close()))
  init?.(m); m.showModal()
}

// ── la búsqueda del panel ──
const INDICE = [
  ['Medios de pago', '#/config/pagos'], ['Agregar medio de pago', '#/config/pagos'], ['Envío gratis', '#/config/envios'],
  ['Tarifas de envío', '#/config/envios'], ['Transportadoras', '#/config/envios?tab=transportadoras'], ['IVA', '#/config/impuestos'],
  ['Moneda', '#/config/general'], ['Zona horaria', '#/config/general'], ['Nombre de la tienda', '#/config/general'],
  ['Invitar usuario', '#/config/usuarios'], ['Permisos', '#/config/usuarios'], ['Crédito Ya', '#/apps/creditoya'],
]
const buscar = $('#buscar'), sug = $('#sugerencias')
buscar.oninput = () => {
  const q = buscar.value.trim().toLowerCase()
  const hits = q ? INDICE.filter(([t]) => t.toLowerCase().includes(q)) : []
  sug.innerHTML = hits.map(([t, h]) => `<li role="option"><a href="${h}">${esc(t)}</a></li>`).join('')
  sug.hidden = !hits.length
}
sug.onclick = () => { sug.hidden = true; buscar.value = '' }

// ── el menú en el teléfono ──
$('.menu-btn').onclick = () => { const o = document.body.classList.toggle('menu-abierto'); $('.menu-btn').setAttribute('aria-expanded', String(o)) }

// ── las páginas ──
const PAGINAS = {
  '/inicio': () => `<h1>Hola, Ana</h1><div class="tarjetas">
    <div class="caja"><strong>Ventas de hoy</strong><p class="grande">${pesos(1284000)}</p></div>
    <div class="caja"><strong>Pedidos por despachar</strong><p class="grande">7</p></div>
    <div class="caja"><strong>Medios de pago activos</strong><p class="grande">${estado.pagos.filter((p) => p.activo).length}</p></div></div>
    <div class="caja"><strong>Sugerencia</strong><p>Ofrecé pagos a cuotas: agregá un medio de pago desde <a href="#/config/pagos">Configuración › Pagos</a>.</p></div>`,
  '/pedidos': () => `<h1>Pedidos</h1><table class="datos"><thead><tr><th>Pedido</th><th>Cliente</th><th>Total</th><th>Estado</th></tr></thead><tbody>
    ${[['#1042', 'Marta Prueba', 96000, 'Por despachar'], ['#1041', 'Juan Prueba', 182000, 'Enviado'], ['#1040', 'Sofía Prueba', 54000, 'Entregado']]
      .map(([n, c, t, e]) => `<tr><td>${n}</td><td>${c}</td><td>${pesos(t)}</td><td>${e}</td></tr>`).join('')}</tbody></table>`,
  '/productos': () => `<h1>Productos</h1><table class="datos"><thead><tr><th>Producto</th><th>Precio</th><th>Inventario</th></tr></thead><tbody>
    ${[['Café de altura 500 g', 32000, 41], ['Panela orgánica', 9000, 120], ['Chocolate de mesa', 14000, 0]].map(([n, p, i]) => `<tr><td>${n}</td><td>${pesos(p)}</td><td>${i || 'Agotado'}</td></tr>`).join('')}</tbody></table>`,
  '/clientes': () => `<h1>Clientes</h1><p class="muted">312 clientes. Los datos de esta página son ficticios.</p>`,
  '/config/general': paginaGeneral,
  '/config/pagos': paginaPagos,
  '/config/envios': paginaEnvios,
  '/config/impuestos': paginaImpuestos,
  '/config/usuarios': paginaUsuarios,
  '/apps/creditoya': () => `<h1>Crédito Ya</h1><p class="muted">La app de Crédito Ya, instalada en tu tienda. Sus credenciales y la conexión se manejan adentro.</p>
    <iframe src="/app-creditoya.html" title="App Crédito Ya" class="app-marco"></iframe>`,
}
function render() {
  borrador = null
  const [ruta, qs] = (location.hash.slice(1) || '/inicio').split('?')
  ultimaRuta = location.hash || '#/inicio'
  document.body.classList.remove('menu-abierto')
  const m = ruta.match(/^\/config\/pagos\/(nuevo\/)?([a-z]+)$/)
  const vista = $('#vista')
  vista.innerHTML = m ? paginaProveedor(m[2], !!m[1]) : (PAGINAS[ruta] || PAGINAS['/inicio'])(new URLSearchParams(qs))
  document.querySelectorAll('.lateral a').forEach((a) => a.classList.toggle('on', ruta.startsWith(a.getAttribute('href').slice(1))))
  $('#grupo-config').open = ruta.startsWith('/config')
  $('#grupo-apps').open = ruta.startsWith('/apps')
  vista.querySelectorAll('input, select, textarea').forEach((el) => { if (!el.dataset.inmediato) el.addEventListener('input', marcarSucio) })
  enlazar?.()
  enlazar = null
}
let enlazar = null

function paginaGeneral() {
  const g = estado.general
  borrador = { aplicar() {
    const nombre = $('#g-nombre').value.trim()
    if (!nombre) return 'El nombre de la tienda no puede quedar vacío'
    estado.general = { nombre, correo: $('#g-correo').value.trim(), moneda: $('#g-moneda').value, zona: $('#g-zona').value }
  } }
  return `<h1>General</h1><div class="caja">
    <label for="g-nombre">Nombre de la tienda</label><input id="g-nombre" value="${esc(g.nombre)}">
    <label for="g-correo">Correo de contacto</label><input id="g-correo" type="email" value="${esc(g.correo)}">
    <label for="g-moneda">Moneda</label><select id="g-moneda">${['COP', 'USD', 'PEN'].map((m) => `<option ${m === g.moneda ? 'selected' : ''}>${m}</option>`).join('')}</select>
    <label for="g-zona">Zona horaria</label><select id="g-zona">${['America/Bogota', 'America/Lima', 'America/Mexico_City'].map((z) => `<option ${z === g.zona ? 'selected' : ''}>${z}</option>`).join('')}</select>
  </div>`
}

function paginaPagos() {
  enlazar = () => {
    $('#agregar-pago').onclick = () => modal(`<h2>Agregar medio de pago</h2>
      <input id="buscar-prov" type="search" placeholder="Buscar proveedor" aria-label="Buscar proveedor">
      <ul class="proveedores">${PROVEEDORES.map((p) => `<li data-nombre="${esc(p.nombre.toLowerCase())}"><div><strong>${esc(p.nombre)}</strong><p class="muted">${esc(p.desc)}</p></div>
        ${estado.pagos.some((x) => x.id === p.id) ? '<span class="muted">Ya agregado</span>' : `<button type="button" data-elegir="${p.id}" aria-label="Elegir ${esc(p.nombre)}">Elegir</button>`}</li>`).join('')}</ul>
      <div class="fila"><button type="button" class="sec" data-cerrar>Cancelar</button></div>`, (m) => {
      $('#buscar-prov', m).oninput = (e) => m.querySelectorAll('.proveedores li').forEach((li) => (li.hidden = !li.dataset.nombre.includes(e.target.value.toLowerCase())))
      m.querySelectorAll('[data-elegir]').forEach((b) => (b.onclick = () => { m.close(); location.hash = `#/config/pagos/nuevo/${b.dataset.elegir}` }))
    })
    document.querySelectorAll('[data-activar]').forEach((b) => (b.onclick = () => {
      const p = estado.pagos.find((x) => x.id === b.dataset.activar)
      const msg = p.activo ? `¿Desactivar ${p.nombre}? Deja de aparecer en el checkout.` : `¿Activar ${p.nombre}? Tus clientes lo van a ver en el checkout desde ya.`
      if (!confirm(msg)) return
      p.activo = !p.activo; persistir(); aviso(`${p.nombre} ${p.activo ? 'activado' : 'desactivado'}`); render()
    }))
  }
  return `<h1>Pagos</h1><p class="muted">Los medios de pago que ven tus clientes en el checkout.</p>
    ${estado.pagos.map((p) => `<div class="caja proveedor"><div><strong>${esc(p.nombre)}</strong>
      <span class="estado ${p.activo ? 'si' : 'no'}">${p.activo ? 'Activo' : 'Inactivo'}</span>
      ${p.config?.modo ? `<span class="muted"> · modo ${p.config.modo === 'pruebas' ? 'pruebas' : 'producción'}</span>` : ''}</div>
      <div class="fila"><a class="boton sec" href="#/config/pagos/${p.id}">Configurar</a>
      <button type="button" data-activar="${p.id}" class="${p.activo ? 'sec' : ''}">${p.activo ? 'Desactivar' : 'Activar'}</button></div></div>`).join('')}
    <button type="button" id="agregar-pago">Agregar medio de pago</button>`
}

function paginaProveedor(id, nuevo) {
  const base = PROVEEDORES.find((p) => p.id === id)
  const existente = estado.pagos.find((p) => p.id === id)
  if (!existente && !base) return '<h1>No existe ese medio de pago</h1>'
  const nombre = existente?.nombre || base.nombre
  const c = existente?.config || {}
  const cuotas = c.cuotas || []
  if (nuevo) setTimeout(marcarSucio) // uno nuevo no existe hasta que se guarda
  enlazar = () => {
    const b = $('#eliminar-pago')
    if (b) b.onclick = () => {
      if (!confirm(`¿Eliminar ${nombre}? Se borra su configuración y deja de aparecer en el checkout.`)) return
      estado.pagos = estado.pagos.filter((p) => p.id !== id)
      persistir(); limpiar(); aviso(`${nombre} eliminado`); location.hash = '#/config/pagos'
    }
  }
  borrador = { aplicar() {
    const modo = $('#p-modo').value
    const comercio = $('#p-comercio').value.trim()
    const llave = $('#p-llave').value
    const min = Number($('#p-min').value), max = Number($('#p-max').value)
    const cs = [...document.querySelectorAll('[name=cuotas]:checked')].map((x) => Number(x.value))
    if (!comercio) return 'Falta el ID de comercio'
    if (modo === 'produccion' && !llave) return 'En producción hace falta la llave de API'
    if (min && max && min >= max) return 'El monto mínimo tiene que ser menor que el máximo'
    if (id === 'creditoya' && !cs.length) return 'Elegí al menos un plazo de cuotas'
    const config = { modo, comercio, llave: llave ? '•••' : '', min, max, cuotas: cs, etiqueta: $('#p-etiqueta').value.trim() }
    if (existente) existente.config = config
    else estado.pagos.push({ id, nombre, activo: false, config })
    irA = '#/config/pagos'
  } }
  return `<p><a href="#/config/pagos">‹ Pagos</a></p><h1>${esc(nombre)}${nuevo ? ' <span class="muted">(nuevo)</span>' : ''}</h1>
    <div class="caja">
      <label for="p-modo">Modo</label>
      <select id="p-modo"><option value="pruebas" ${c.modo !== 'produccion' ? 'selected' : ''}>Pruebas</option><option value="produccion" ${c.modo === 'produccion' ? 'selected' : ''}>Producción</option></select>
      <p class="ayuda">En <strong>Pruebas</strong> no se cobra nada y alcanza con el ID de comercio de pruebas. En <strong>Producción</strong> hace falta además la llave de API.</p>
      <label for="p-comercio">ID de comercio</label><input id="p-comercio" value="${esc(c.comercio || '')}" autocomplete="off">
      <p class="ayuda">${id === 'creditoya' ? 'Lo encontrás en <a href="#/apps/creditoya">Apps › Crédito Ya</a>, en «Credenciales».' : 'Te lo da el proveedor.'}</p>
      <label for="p-llave">Llave de API</label><input id="p-llave" type="password" autocomplete="off" placeholder="${c.llave ? 'guardada' : ''}">
    </div>
    <div class="caja"><h2>Condiciones de pago</h2>
      <p class="ayuda">El medio de pago aparece en el checkout sólo para compras dentro de este rango. Vacío: sin límite.</p>
      <div class="dos"><div><label for="p-min">Monto mínimo (COP)</label><input id="p-min" type="number" min="0" step="1000" value="${c.min || ''}"></div>
      <div><label for="p-max">Monto máximo (COP)</label><input id="p-max" type="number" min="0" step="1000" value="${c.max || ''}"></div></div>
      ${id === 'creditoya' ? `<fieldset><legend>Plazos que se ofrecen</legend>${[3, 6, 12].map((n) => `<label class="check"><input type="checkbox" name="cuotas" value="${n}" ${cuotas.includes(n) ? 'checked' : ''}> ${n} cuotas</label>`).join('')}</fieldset>` : ''}
      <label for="p-etiqueta">Cómo se muestra en el checkout</label><input id="p-etiqueta" value="${esc(c.etiqueta || (id === 'creditoya' ? 'Paga a cuotas con Crédito Ya' : nombre))}">
    </div>
    <p class="muted">Guardar no lo activa: después se activa desde Pagos.</p>
    ${existente ? '<div class="caja peligro-zona"><h2>Zona peligrosa</h2><p class="ayuda">Eliminarlo lo saca del checkout y borra su configuración. No se puede deshacer.</p><button type="button" class="peligro" id="eliminar-pago">Eliminar medio de pago</button></div>' : ''}`
}

function paginaEnvios(qs) {
  const e = estado.envios
  const tab = qs.get('tab') === 'transportadoras' ? 'transportadoras' : 'tarifas'
  borrador = { aplicar() {
    if (tab === 'tarifas') {
      const gratis = $('#e-gratis').checked, desde = Number($('#e-desde').value)
      if (gratis && !desde) return 'Poné desde qué monto el envío es gratis'
      estado.envios.gratis = gratis; estado.envios.gratisDesde = gratis ? desde : 0
      document.querySelectorAll('[data-zona]').forEach((inp) => { estado.envios.zonas[inp.dataset.zona].tarifa = Number(inp.value) })
    } else {
      document.querySelectorAll('[data-transp]').forEach((x) => { estado.envios.transportadoras[x.dataset.transp] = x.checked })
    }
  } }
  return `<h1>Envíos y entregas</h1>
    <div class="tabs" role="tablist"><a role="tab" aria-selected="${tab === 'tarifas'}" href="#/config/envios">Tarifas</a><a role="tab" aria-selected="${tab === 'transportadoras'}" href="#/config/envios?tab=transportadoras">Transportadoras</a></div>
    ${tab === 'tarifas' ? `<div class="caja"><label class="check"><input type="checkbox" id="e-gratis" ${e.gratis ? 'checked' : ''}> Ofrecer envío gratis</label>
      <label for="e-desde">Envío gratis para compras desde (COP)</label><input id="e-desde" type="number" min="0" step="1000" value="${e.gratisDesde || ''}">
      <p class="ayuda">Aplica a todas las zonas. Si no marcás «Ofrecer envío gratis», este monto no se usa.</p></div>
      <div class="caja"><h2>Tarifas por zona</h2><table class="datos"><thead><tr><th>Zona</th><th>Tarifa (COP)</th><th>Días</th></tr></thead><tbody>
      ${e.zonas.map((z, i) => `<tr><td>${esc(z.nombre)}</td><td><input type="number" step="500" data-zona="${i}" aria-label="Tarifa ${esc(z.nombre)}" value="${z.tarifa}"></td><td>${esc(z.dias)}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="caja">${Object.entries({ servientrega: 'Servientrega', coordinadora: 'Coordinadora', interrapidisimo: 'Interrapidísimo' })
        .map(([k, n]) => `<label class="check"><input type="checkbox" data-transp="${k}" ${e.transportadoras[k] ? 'checked' : ''}> ${n}</label>`).join('')}</div>`}`
}

function paginaImpuestos() {
  const t = estado.impuestos
  borrador = { aplicar() {
    const iva = Number($('#t-iva').value)
    if (iva < 0 || iva > 30) return 'El IVA tiene que estar entre 0 y 30'
    estado.impuestos = { incluidos: $('#t-incl').checked, iva }
  } }
  return `<h1>Impuestos</h1><div class="caja"><label class="check"><input type="checkbox" id="t-incl" ${t.incluidos ? 'checked' : ''}> Los precios ya incluyen IVA</label>
    <label for="t-iva">IVA (%)</label><input id="t-iva" type="number" min="0" max="30" value="${t.iva}"></div>`
}

function paginaUsuarios() {
  enlazar = () => {
    $('#invitar').onclick = () => modal(`<h2>Invitar usuario</h2><form id="f-inv">
      <label for="i-correo">Correo</label><input id="i-correo" type="email" required data-inmediato="1">
      <label for="i-rol">Rol</label><select id="i-rol" data-inmediato="1"><option>Ventas</option><option>Logística</option><option>Administrador</option></select>
      <div class="fila"><button type="button" class="sec" data-cerrar>Cancelar</button><button type="submit">Enviar invitación</button></div></form>`, (m) => {
      $('#f-inv', m).onsubmit = (ev) => {
        ev.preventDefault()
        estado.invitaciones.push({ correo: $('#i-correo', m).value, rol: $('#i-rol', m).value }); persistir(); m.close(); aviso('Invitación enviada'); render()
      }
    })
  }
  return `<h1>Usuarios y permisos</h1><table class="datos"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th></tr></thead><tbody>
    ${estado.usuarios.map((u) => `<tr><td>${esc(u.nombre)}</td><td>${esc(u.correo)}</td><td>${esc(u.rol)}</td></tr>`).join('')}
    ${estado.invitaciones.map((u) => `<tr><td class="muted">(invitado)</td><td>${esc(u.correo)}</td><td>${esc(u.rol)}</td></tr>`).join('')}</tbody></table>
    <button type="button" id="invitar">Invitar usuario</button>`
}

render()
