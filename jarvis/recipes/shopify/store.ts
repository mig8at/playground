// RECETA DE SÓLO LECTURA · cómo está la tienda de pruebas de Shopify: la tienda, sus últimos productos y sus últimos
// pedidos con la pasarela con que se pagó cada uno (ahí aparecen los de Creditop) y su estado de pago.
//
//   make jarvis-recipe APP=shopify RECIPE=store
//   make jarvis-recipe APP=shopify RECIPE=store ARGS='--last 20'
//
// Por la Admin GraphQL API (`shop`, `products`, `orders`), con la app «Jarvis · Admin API (pruebas)» (recipes/shopify/api.ts).
// En el admin son tres pantallas: Inicio, Productos y Pedidos.
import '../args.ts';
import { admin, graphql, store } from './api.ts';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const n = Math.min(Number(flag('last') || 10), 50);
const JSON_OUT = argv.includes('--json');

const d = await graphql<any>(`query Store($n: Int!) {
  shop { name myshopifyDomain currencyCode plan { displayName } }
  productsCount { count }
  products(first: 5, sortKey: UPDATED_AT, reverse: true) { nodes { title status totalInventory variants(first: 1) { nodes { price } } } }
  orders(first: $n, sortKey: CREATED_AT, reverse: true) {
    nodes { name createdAt displayFinancialStatus displayFulfillmentStatus cancelledAt paymentGatewayNames
            totalPriceSet { shopMoney { amount currencyCode } } }
  }
}`, { n });

if (JSON_OUT) { console.log(JSON.stringify(d)); process.exit(0); }
const out = (s = '') => console.log(s ? `  ${s}` : '');
out(`${d.shop.name} (${d.shop.myshopifyDomain}) · ${d.shop.currencyCode} · plan ${d.shop.plan?.displayName ?? '?'}`);
out(`${d.productsCount.count} productos · los últimos tocados:`);
for (const p of d.products.nodes) out(`  ${p.status.padEnd(8)} ${p.title} · $${Number(p.variants.nodes[0]?.price ?? 0).toLocaleString('es-CO')} · stock ${p.totalInventory ?? '—'}`);
out();
out(`los últimos ${d.orders.nodes.length} pedidos:`);
for (const o of d.orders.nodes) {
    const total = `$${Number(o.totalPriceSet.shopMoney.amount).toLocaleString('es-CO')}`;
    out(`  ${o.name.padEnd(6)} ${o.createdAt.slice(0, 16).replace('T', ' ')}  ${total.padStart(14)}  ${(o.paymentGatewayNames.join(', ') || '—').padEnd(18)} ${o.displayFinancialStatus}${o.cancelledAt ? ' · cancelado' : ''} · ${o.displayFulfillmentStatus}`);
}
out();
out(`admin: ${admin}/orders`);
void store;
