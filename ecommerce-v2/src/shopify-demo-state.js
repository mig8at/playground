// El estado de la Shopify demo, compartido entre la tienda (el editor, ShopifyStore.vue) y lo que pasa por debajo (el
// panel derecho, ShopifyLog.vue). Todo lo decide el servidor (server/shopify_demo.go): acá se lee y se pide.
import { computed, reactive, ref } from 'vue'

// El catálogo de la tienda: de mentira, para armar un carrito con montos realistas.
export const PRODUCTS = [
  { id: 'cel', title: 'Celular Galaxy A15', price: 799900, tag: 'Celulares', icon: 'phone' },
  { id: 'aud', title: 'Audífonos inalámbricos', price: 189900, tag: 'Audio', icon: 'music' },
  { id: 'pc', title: 'Portátil 14″ Ryzen 5', price: 2499900, tag: 'Computadores', icon: 'monitor' },
  { id: 'reloj', title: 'Smartwatch deportivo', price: 349900, tag: 'Accesorios', icon: 'clock' },
  { id: 'parlante', title: 'Parlante bluetooth', price: 229900, tag: 'Audio', icon: 'volume' },
  { id: 'tablet', title: 'Tablet 10″ 128 GB', price: 1099900, tag: 'Tablets', icon: 'tablet' },
]

export const STATUS = {
  pending: ['Pendiente', 'off'], redirected: ['En Creditop', 'warn'], pending_payment: ['Pago pendiente', 'warn'],
  paid: ['Pagado', 'ok'], failed: ['Pago fallido', 'fail'], error: ['Error', 'fail'],
}
// Cómo puede terminar la solicitud: lo que «Avisar como Creditop» le manda a la app.
export const NOTIFY = [['completed', 'Aprobada'], ['failed', 'Negada'], ['cancelled', 'Cancelada'], ['pending', 'Pendiente']]

export const money = n => Number(n).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
export const clock = iso => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

export const demo = reactive({
  status: null, statusError: '', checking: false,
  orders: [], exchanges: [],
  cart: {}, // id del producto → cantidad
  customer: { email: 'duncan-test@creditop.com', phone: '+573001112233', firstName: 'Prueba', lastName: 'Demo' },
  selected: '', paying: false, message: '', busy: '',
})

export const cartItems = computed(() => PRODUCTS.filter(p => demo.cart[p.id]).map(p => ({ ...p, qty: demo.cart[p.id] })))
export const cartTotal = computed(() => cartItems.value.reduce((s, p) => s + p.price * p.qty, 0))
export const cartCount = computed(() => cartItems.value.reduce((s, p) => s + p.qty, 0))
export const allOk = computed(() => !!demo.status?.checks?.length && demo.status.checks.every(c => c.ok))
export const currentOrder = computed(() => demo.orders.find(o => o.id === demo.selected) ?? demo.orders.at(-1) ?? null)

export function addToCart(id, n = 1) {
  const q = (demo.cart[id] ?? 0) + n
  if (q <= 0) delete demo.cart[id]
  else demo.cart[id] = q
}

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

export async function checkConnections() {
  demo.checking = true
  try { demo.status = await api('/api/shopify-demo/status'); demo.statusError = '' }
  catch (e) { demo.statusError = e.message === 'Failed to fetch' ? 'No contesta la API de ecommerce (:5187)' : e.message }
  finally { demo.checking = false }
}

export async function refresh() {
  try {
    const [o, l] = await Promise.all([api('/api/shopify-demo/orders'), api('/api/shopify-demo/log')])
    demo.orders = o.orders
    demo.exchanges = l.exchanges
  } catch { /* el próximo intento */ }
}

// «Pagar con Creditop»: la sesión de pago, como la manda Shopify, y el comprador a la URL que devuelve el host.
export async function pay() {
  demo.paying = true
  demo.message = ''
  try {
    const r = await api('/api/shopify-demo/checkout', { method: 'POST', body: JSON.stringify({
      amount: String(cartTotal.value), ...demo.customer,
      items: cartItems.value.map(p => ({ title: p.title, qty: p.qty, price: p.price })),
    }) })
    demo.selected = r.order.id
    await refresh()
    if (r.order.redirectUrl) {
      demo.cart = {}
      window.open(r.order.redirectUrl, '_blank', 'noopener')
      return { ok: true }
    }
    demo.message = 'El host no devolvió la URL de Creditop: mirá la petición en el panel derecho.'
    return { ok: false }
  } catch (e) { demo.message = e.message; return { ok: false } }
  finally { demo.paying = false }
}

export async function notify(order, status) {
  demo.busy = `${order.id}:${status}`
  try { await api(`/api/shopify-demo/orders/${order.id}/notify`, { method: 'POST', body: JSON.stringify({ status }) }) }
  catch (e) { demo.message = e.message }
  finally { demo.busy = ''; await refresh() }
}

// Mientras la demo está abierta, los pedidos y las peticiones se releen solos.
let timer = null
const watchers = ref(0)
export function startPolling() {
  if (watchers.value++ === 0) {
    checkConnections()
    refresh()
    timer = setInterval(refresh, 3000)
  }
}
export function stopPolling() {
  if (--watchers.value <= 0) { watchers.value = 0; clearInterval(timer); timer = null }
}
