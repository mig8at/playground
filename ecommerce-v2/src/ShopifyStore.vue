<script setup>
/* Shopify · Store demo, en el editor: la tienda (productos, carrito, datos y pago con Creditop) y sus pedidos como los
 * vería el comercio. Lo que pasa por debajo —cada petición y cada aviso— lo muestra el panel derecho (ShopifyLog.vue).
 * El estado vive en shopify-demo-state.js, compartido entre los dos. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  PRODUCTS, STATUS, NOTIFY, money, clock, demo, cartItems, cartTotal, cartCount, allOk, currentOrder,
  addToCart, pay, notify, startPolling, stopPolling,
} from './shopify-demo-state.js'

const props = defineProps({ order: { type: String, default: '' } })
const emit = defineEmits(['close'])

const tab = ref(props.order ? 'orders' : 'store') // store · orders
const step = ref('cart') // cart · customer
watch(() => props.order, (id) => { if (id) { demo.selected = id; tab.value = 'orders' } }, { immediate: true })

const label = o => STATUS[o.status]?.[0] ?? o.status
const state = o => STATUS[o.status]?.[1] ?? 'off'
const sorted = computed(() => [...demo.orders].reverse())
const initial = t => t.slice(0, 1)

async function onPay() {
  const r = await pay()
  if (r.ok) { step.value = 'cart'; tab.value = 'orders' }
}

onMounted(startPolling)
onBeforeUnmount(stopPolling)
</script>

<template>
  <div class="region-head">
    <span>Shopify · Store demo</span>
    <div class="tabs" role="tablist">
      <button type="button" role="tab" class="tab" :aria-selected="tab === 'store'" @click="tab = 'store'">
        Tienda<span v-if="cartCount" class="count">{{ cartCount }}</span>
      </button>
      <button type="button" role="tab" class="tab" :aria-selected="tab === 'orders'" @click="tab = 'orders'">
        Pedidos<span class="count">{{ demo.orders.length }}</span>
      </button>
    </div>
    <div class="region-actions">
      <button type="button" class="region-action" title="Cerrar la tienda" aria-label="Cerrar la tienda" @click="emit('close')">
        <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
      </button>
    </div>
  </div>

  <div class="region-body">
    <!-- LA TIENDA: productos a la izquierda, carrito y checkout a la derecha -->
    <div v-if="tab === 'store'" class="shop">
      <section class="catalog" aria-label="Productos">
        <article v-for="p in PRODUCTS" :key="p.id" class="card">
          <div class="thumb" aria-hidden="true"><span>{{ initial(p.title) }}</span><small>{{ p.tag }}</small></div>
          <div class="card-body">
            <h3>{{ p.title }}</h3>
            <p class="price">{{ money(p.price) }}</p>
            <div v-if="demo.cart[p.id]" class="qty">
              <button type="button" class="btn btn-outline btn-xs btn-icon" :aria-label="`Uno menos de ${p.title}`" @click="addToCart(p.id, -1)">−</button>
              <span>{{ demo.cart[p.id] }}</span>
              <button type="button" class="btn btn-outline btn-xs btn-icon" :aria-label="`Uno más de ${p.title}`" @click="addToCart(p.id, 1)">+</button>
            </div>
            <button v-else type="button" class="btn btn-secondary btn-sm" @click="addToCart(p.id)">Agregar al carrito</button>
          </div>
        </article>
      </section>

      <aside class="checkout" aria-label="Carrito">
        <h3>{{ step === 'cart' ? 'Carrito' : 'Tus datos' }}</h3>
        <template v-if="step === 'cart'">
          <p v-if="!cartItems.length" class="muted">Todavía no agregaste nada.</p>
          <ul v-else class="lines">
            <li v-for="p in cartItems" :key="p.id"><span>{{ p.qty }} × {{ p.title }}</span><span>{{ money(p.price * p.qty) }}</span></li>
          </ul>
          <div class="total"><span>Total</span><b>{{ money(cartTotal) }}</b></div>
          <button type="button" class="btn" :disabled="!cartItems.length" @click="step = 'customer'">Continuar al pago</button>
        </template>
        <form v-else class="form" @submit.prevent="onPay">
          <label class="label" for="sd-email">Correo</label>
          <input id="sd-email" v-model="demo.customer.email" class="input input-sm" autocomplete="off" />
          <label class="label" for="sd-phone">Celular</label>
          <input id="sd-phone" v-model="demo.customer.phone" class="input input-sm" autocomplete="off" />
          <div class="two">
            <div><label class="label" for="sd-fn">Nombre</label><input id="sd-fn" v-model="demo.customer.firstName" class="input input-sm" /></div>
            <div><label class="label" for="sd-ln">Apellido</label><input id="sd-ln" v-model="demo.customer.lastName" class="input input-sm" /></div>
          </div>
          <div class="method">
            <span class="dot" data-state="ok" aria-hidden="true"></span>
            <div><b>Creditop</b><div class="muted small">Financia tu compra con Creditop</div></div>
          </div>
          <div class="total"><span>Total</span><b>{{ money(cartTotal) }}</b></div>
          <button type="submit" class="btn" :disabled="demo.paying || !allOk" :title="allOk ? '' : 'Primero tienen que estar en verde las conexiones (consola de abajo, pestaña Conexiones)'">
            {{ demo.paying ? 'Pidiendo la sesión de pago…' : 'Pagar con Creditop' }}
          </button>
          <button type="button" class="btn btn-ghost btn-sm" @click="step = 'cart'">Volver al carrito</button>
          <p v-if="!allOk" class="muted small">Las conexiones de la consola de abajo tienen que estar en verde.</p>
        </form>
        <p v-if="demo.message" class="hot small">{{ demo.message }}</p>
      </aside>
    </div>

    <!-- LOS PEDIDOS, como los ve el comercio en Shopify -->
    <div v-else class="orders">
      <p v-if="!demo.orders.length" class="muted pad">Todavía no hay pedidos: comprá en la pestaña Tienda.</p>
      <table v-else class="table">
        <thead><tr><th>Hora</th><th>Productos</th><th>Total</th><th>Estado</th></tr></thead>
        <tbody>
          <tr v-for="o in sorted" :key="o.id" :class="{ on: o.id === currentOrder?.id }" @click="demo.selected = o.id">
            <td>{{ clock(o.createdAt) }}</td>
            <td class="ellipsis">{{ (o.items || []).map(i => `${i.qty} × ${i.title}`).join(', ') || '—' }}</td>
            <td>{{ money(o.amount) }}</td>
            <td class="nowrap"><i class="dot" :data-state="state(o)" aria-hidden="true"></i> {{ label(o) }}</td>
          </tr>
        </tbody>
      </table>

      <section v-if="currentOrder" class="pad detail">
        <h3>Pedido {{ currentOrder.id }} · {{ label(currentOrder) }}</h3>
        <p class="muted small">{{ currentOrder.firstName }} {{ currentOrder.lastName }} · {{ currentOrder.email }} · {{ currentOrder.phone }}</p>
        <div class="label">Avisar como Creditop (la solicitud terminó así)</div>
        <div class="actions">
          <button v-for="[s, l] in NOTIFY" :key="s" type="button" class="btn btn-outline btn-xs"
                  :disabled="!currentOrder.redirectUrl || !!demo.busy" @click="notify(currentOrder, s)">{{ demo.busy === `${currentOrder.id}:${s}` ? '…' : l }}</button>
        </div>
        <p v-if="currentOrder.redirectUrl" class="small">Creditop: <a :href="currentOrder.redirectUrl" target="_blank" rel="noopener">abrir el wizard</a></p>
        <ol class="events">
          <li v-for="(e, i) in currentOrder.events" :key="i">
            <span class="mono">{{ clock(e.at) }}</span><span class="muted">{{ e.kind }}</span><span>{{ e.detail }}</span>
          </li>
        </ol>
      </section>
    </div>
  </div>
</template>

<style scoped>
.tabs { display: flex; gap: var(--space-1); margin-right: auto; margin-left: var(--space-3) }
.tab { height: 26px; padding: 0 var(--space-2); border: 0; border-radius: var(--radius); background: transparent; color: var(--fg-2);
       font: inherit; display: inline-flex; align-items: center; gap: var(--space-1); cursor: pointer }
.tab[aria-selected="true"] { background: var(--hover); color: var(--foreground) }
.tab .count { color: var(--fg-3) }
.shop { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: var(--space-4); padding: var(--space-3) var(--gutter); align-items: start }
.catalog { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: var(--space-3) }
.card { border: 1px solid var(--border); border-radius: var(--radius-lg, 10px); overflow: hidden; display: flex; flex-direction: column; background: var(--card, var(--background)) }
.thumb { aspect-ratio: 4 / 3; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-1);
         background: var(--hover); color: var(--fg-2) }
.thumb span { font-size: 32px; font-weight: 600; color: var(--foreground) }
.thumb small { font-size: var(--text-sm); color: var(--fg-3) }
.card-body { padding: var(--space-2) var(--space-3) var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); flex: 1 }
.card-body h3 { margin: 0; font-size: var(--text-base); font-weight: 600 }
.price { margin: 0; color: var(--fg-2) }
.card-body .btn { margin-top: auto }
.qty { margin-top: auto; display: flex; align-items: center; gap: var(--space-2) }
.checkout { position: sticky; top: 0; border: 1px solid var(--border); border-radius: var(--radius-lg, 10px); padding: var(--space-3);
            display: flex; flex-direction: column; gap: var(--space-2) }
.checkout h3, .detail h3 { margin: 0 0 var(--space-1); font-size: var(--text-body, 14px) }
.lines { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1) }
.lines li, .total { display: flex; justify-content: space-between; gap: var(--space-2) }
.total { padding-top: var(--space-2); border-top: 1px solid var(--border) }
.form { display: flex; flex-direction: column; gap: var(--space-2) }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2) }
.method { display: flex; gap: var(--space-2); align-items: center; padding: var(--space-2); border: 1px solid var(--ring, var(--border)); border-radius: var(--radius) }
.pad { padding: var(--space-3) var(--gutter) }
.muted { color: var(--fg-3) }
.small { font-size: var(--text-sm); margin: 0 }
.hot { color: var(--ecommerce-fail) }
.mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: var(--text-sm) }
.nowrap { white-space: nowrap }
.ellipsis { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.dot { display: inline-block; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--fg-3) }
.dot[data-state="ok"] { background: var(--ecommerce-ok) }
.dot[data-state="warn"] { background: var(--ecommerce-warn) }
.dot[data-state="fail"] { background: var(--ecommerce-fail) }
tbody tr { cursor: pointer }
tbody tr.on { background: var(--hover) }
.actions { display: flex; flex-wrap: wrap; gap: var(--space-1); margin: var(--space-1) 0 var(--space-2) }
.events { list-style: none; padding: 0; margin: var(--space-2) 0 0; display: flex; flex-direction: column; gap: var(--space-1) }
.events li { display: grid; grid-template-columns: 70px 80px 1fr; gap: var(--space-2) }
@media (max-width: 1100px) { .shop { grid-template-columns: minmax(0, 1fr) } .checkout { position: static } }
</style>
