<script setup>
/* Shopify demo · una tienda Shopify de mentira que paga con la app de Creditop (el host de temp-shopify).
 *
 * A la izquierda, si se llega a todo (el playground, el host de la app y este Shopify falso por su canal) y el
 * checkout. A la derecha, los pedidos como los vería el comercio en Shopify, con lo que pasó en cada uno. Todo lo
 * calcula el servidor (server/shopify_demo.go): acá sólo se pinta. */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const STATUS = {
  pending: ['Pendiente', 'off'], redirected: ['En Creditop', 'warn'], pending_payment: ['Pago pendiente', 'warn'],
  paid: ['Pagado', 'ok'], failed: ['Pago fallido', 'fail'], error: ['Error', 'fail'],
}
const NOTIFY = [['completed', 'Aprobada'], ['failed', 'Negada'], ['cancelled', 'Cancelada'], ['pending', 'Pendiente']]

const status = ref(null)
const statusError = ref('')
const checking = ref(false)
const orders = ref([])
const form = ref({ amount: '450000', email: 'duncan-test@creditop.com', phone: '+573001112233', firstName: 'Prueba', lastName: 'Demo' })
const buying = ref(false)
const message = ref('')
const busy = ref('')
const selected = ref(location.hash.match(/#\/order\/(\w+)/)?.[1] ?? '')

const allOk = computed(() => status.value?.checks?.every(c => c.ok))
// El pedido elegido; sin elegir, el más nuevo.
const current = computed(() => orders.value.find(o => o.id === selected.value) ?? orders.value.at(-1) ?? null)
const sorted = computed(() => [...orders.value].reverse())

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}
async function check() {
  checking.value = true
  try { status.value = await api('/api/shopify-demo/status'); statusError.value = '' }
  catch (e) { statusError.value = e.message === 'Failed to fetch' ? 'No contesta la API de ecommerce (:5187)' : e.message }
  finally { checking.value = false }
}
async function loadOrders() {
  try { orders.value = (await api('/api/shopify-demo/orders')).orders } catch { /* el próximo intento */ }
}
async function buy() {
  buying.value = true
  message.value = ''
  try {
    const r = await api('/api/shopify-demo/checkout', { method: 'POST', body: JSON.stringify(form.value) })
    await loadOrders()
    selected.value = r.order.id
    if (r.order.redirectUrl) {
      message.value = 'El host devolvió la URL de Creditop: se abrió en otra pestaña.'
      window.open(r.order.redirectUrl, '_blank', 'noopener')
    } else message.value = 'El host no devolvió la URL de Creditop: mirá lo que pasó en el pedido.'
  } catch (e) { message.value = e.message }
  finally { buying.value = false }
}
async function notify(o, s) {
  busy.value = `${o.id}:${s}`
  try { await api(`/api/shopify-demo/orders/${o.id}/notify`, { method: 'POST', body: JSON.stringify({ status: s }) }) }
  catch (e) { message.value = e.message }
  finally { busy.value = ''; await loadOrders() }
}
const label = o => STATUS[o.status]?.[0] ?? o.status
const state = o => STATUS[o.status]?.[1] ?? 'off'
const time = iso => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const money = n => Number(n).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

let timer
function onHash() { selected.value = location.hash.match(/#\/order\/(\w+)/)?.[1] ?? selected.value }
onMounted(() => {
  check(); loadOrders()
  timer = setInterval(loadOrders, 3000)
  window.addEventListener('hashchange', onHash)
})
onBeforeUnmount(() => { clearInterval(timer); window.removeEventListener('hashchange', onHash) })
</script>

<template>
  <div class="workbench demo" style="--sidebar-w: 340px">
    <aside class="sidebar" aria-label="Conexiones y checkout">
      <section class="view open">
        <div class="region-head">
          <span>Conexiones</span>
          <div class="region-actions">
            <button type="button" class="region-action" :disabled="checking" title="Volver a comprobar" aria-label="Volver a comprobar" @click="check">
              <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <div class="region-body pad">
          <p v-if="statusError" class="note fail">{{ statusError }}</p>
          <p v-else-if="!status" class="note">Comprobando…</p>
          <div v-for="c in status?.checks ?? []" :key="c.name" class="check">
            <i class="dot" :data-state="c.ok ? 'ok' : 'fail'" aria-hidden="true"></i>
            <div>
              <div class="check-name">{{ c.name }}</div>
              <div class="check-detail">{{ c.detail }}</div>
              <div v-if="c.url" class="check-url">{{ c.url }}</div>
            </div>
          </div>
          <p v-if="status" class="note">Tienda <b>{{ status.config.shop }}</b> · el aviso de Creditop se busca en <b>{{ status.config.target }}</b></p>
        </div>
      </section>

      <section class="view open">
        <div class="region-head"><span>Checkout</span></div>
        <form class="region-body pad form" @submit.prevent="buy">
          <label class="label" for="amount">Total (COP)</label>
          <input id="amount" v-model="form.amount" class="input" inputmode="numeric" />
          <label class="label" for="email">Correo</label>
          <input id="email" v-model="form.email" class="input" />
          <label class="label" for="phone">Celular</label>
          <input id="phone" v-model="form.phone" class="input" />
          <div class="two">
            <div><label class="label" for="fn">Nombre</label><input id="fn" v-model="form.firstName" class="input" /></div>
            <div><label class="label" for="ln">Apellido</label><input id="ln" v-model="form.lastName" class="input" /></div>
          </div>
          <button type="submit" class="btn" :disabled="buying || !allOk" :title="allOk ? '' : 'Primero tienen que estar en verde las conexiones'">
            {{ buying ? 'Pidiendo la sesión…' : 'Pagar con Creditop' }}
          </button>
          <p v-if="message" class="note">{{ message }}</p>
        </form>
      </section>
    </aside>

    <main class="editor">
      <div class="region-head"><span>Pedidos</span><span class="count">{{ orders.length }}</span></div>
      <div class="region-body">
        <p v-if="!orders.length" class="note pad">Todavía no hay pedidos: comprá con «Pagar con Creditop».</p>
        <table v-else class="table">
          <thead><tr><th>Hora</th><th>Total</th><th>Estado</th><th>Pedido</th></tr></thead>
          <tbody>
            <tr v-for="o in sorted" :key="o.id" :class="{ on: o.id === current?.id }" @click="selected = o.id">
              <td>{{ time(o.createdAt) }}</td>
              <td>{{ money(o.amount) }}</td>
              <td class="nowrap"><i class="dot" :data-state="state(o)" aria-hidden="true"></i> {{ label(o) }}</td>
              <td class="mono muted">…{{ o.id.slice(-6) }}</td>
            </tr>
          </tbody>
        </table>

        <section v-if="current" class="pad detail">
          <h3>Pedido {{ current.id }} · {{ label(current) }}</h3>
          <div class="label">Avisar como Creditop (la solicitud terminó así)</div>
          <div class="actions">
            <button v-for="[s, l] in NOTIFY" :key="s" type="button" class="btn btn-outline btn-xs"
                    :disabled="!current.redirectUrl || !!busy" @click="notify(current, s)">{{ busy === `${current.id}:${s}` ? '…' : l }}</button>
          </div>
          <p v-if="current.redirectUrl" class="note">Creditop: <a :href="current.redirectUrl" target="_blank" rel="noopener">{{ current.redirectUrl }}</a></p>
          <ol class="events">
            <li v-for="(e, i) in current.events" :key="i">
              <span class="mono">{{ time(e.at) }}</span>
              <span class="kind" :data-kind="e.kind">{{ e.kind }}</span>
              <span>{{ e.detail }}</span>
            </li>
          </ol>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* Angosta (una pestaña al costado, un teléfono): las dos regiones una arriba de la otra, y la página scrollea. */
@media (max-width: 900px) {
  .workbench.demo { height: auto; min-height: 100dvh; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto;
                    grid-template-areas: "sidebar" "editor" }
  .workbench.demo > .sidebar { width: auto }
  .workbench.demo > .sidebar, .workbench.demo > .editor { height: auto; min-height: auto; overflow: visible }
  .workbench.demo .view, .workbench.demo .region-body { flex: none; overflow: visible }
}
.pad { padding: var(--space-3) var(--gutter) }
.form { display: flex; flex-direction: column; gap: var(--space-2) }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2) }
.check { display: flex; gap: var(--space-2); align-items: flex-start; padding: var(--space-2) 0 }
.check .dot { margin-top: 5px }
.check-name { font-weight: 600 }
.check-detail { color: var(--fg-2) }
.check-url { color: var(--fg-3); font-size: var(--text-sm); word-break: break-all }
.note { color: var(--fg-2); margin: var(--space-2) 0 }
.note.fail { color: var(--ecommerce-fail) }
.dot { display: inline-block; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--fg-3) }
.dot[data-state="ok"] { background: var(--ecommerce-ok) }
.dot[data-state="warn"] { background: var(--ecommerce-warn) }
.dot[data-state="fail"] { background: var(--ecommerce-fail) }
.mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: var(--text-sm) }
.actions { display: flex; flex-wrap: wrap; gap: var(--space-1); align-items: center; margin: var(--space-1) 0 var(--space-2) }
.nowrap { white-space: nowrap }
.muted { color: var(--fg-3) }
.note a { word-break: break-all }
tbody tr { cursor: pointer }
tbody tr.on { background: var(--hover) }
.detail h3 { margin: var(--space-3) 0 var(--space-2) }
.events { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-1) }
.events li { display: grid; grid-template-columns: 70px 80px 1fr; gap: var(--space-2) }
.kind { color: var(--fg-3) }
.count { color: var(--fg-3) }
</style>
