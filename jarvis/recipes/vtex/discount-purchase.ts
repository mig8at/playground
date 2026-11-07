// RECETA · una compra de prueba CON DESCUENTO pagada con Creditop, y ver qué monto le llega a CreditOp.
//
//   make jarvis-recipe APP=vtex RECIPE=discount-purchase                     todo: ~25 min (casi todo es espera)
//   make jarvis-recipe APP=vtex RECIPE=discount-purchase ARGS='--prepare'   sólo la promoción y el cupón
//   make jarvis-recipe APP=vtex RECIPE=discount-purchase ARGS='--code <cupón>'   compra con un cupón ya preparado
//
// 1. Una promoción REGULAR (10 % por defecto) sólo para el SKU de prueba (el 10, «Casco urbano Jarvis»), ligada a
//    un cupón propio por el mismo `utm_source`, que vence sola a las 2 h. Campos según el esquema oficial de VTEX
//    (`vtex/openapi-schemas`, «Promotions & Taxes API»: `type`, `origin`, `isActive`, `beginDateUtc` y
//    `percentualShippingDiscountValue` son obligatorios; `discountType: percentual`).
// 2. Espera a que el carrito la aplique, simulando con el cupón cada 30 s (hasta 40 min). MEDIDO el 2026-11-07: una
//    promoción nueva tardó ~11 min en llegar al carrito sin cupón y ~21 min con cupón; mientras tanto el checkout dice
//    «Cupón … expirado», que NO es cierto. Vencer es inmediato; archivar, no (siguió aplicando unos minutos).
// 3. Compra con el cupón (`placeVtexOrder` del harness, con el comprador de prueba de siempre): el pedido en VTEX y,
//    por el conector, la solicitud de payment-link en qa.
// 4. Lee en qa (`ecommerce_requests`, sólo lectura) el total y los productos que recibió CreditOp.
// 5. Deshace: cancela el pedido (sin aprobar, Creditop lo cancela solo, sin tarea manual), archiva promoción y cupón.
//
// ESCRIBE en VTEX (promoción, cupón y un pedido de la cuenta de pruebas) y en qa (la solicitud del pedido), como
// cualquier compra de `make harness-vtex`. `--keep` no deshace nada.
import '../args.ts';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { call, hosts, must } from './api.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { placeVtexOrder, cancelVtexOrder } = await import(path.join(ROOT, 'harness/pkg/vtex.ts'));
const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const KEEP = argv.includes('--keep');
const SKU = flag('sku') || '10';
const PCT = Number(flag('discount') || 10);
const say = (s: string) => console.log(`  ${s}`);
const money = (cents: number) => `$${(cents / 100).toLocaleString('es-CO')}`;
const base = `${hosts.store}/api/rnb`;

async function simulate(coupon?: string) {
    const r = await must<any>('simular el carrito', 'POST', `${hosts.store}/api/checkout/pub/orderForms/simulation?sc=1`,
        { items: [{ id: SKU, quantity: 1, seller: '1' }], country: 'COL', postalCode: '110111', ...(coupon ? { marketingData: { coupon } } : {}) });
    return { item: r.items?.[0], messages: (r.messages ?? []).map((m: any) => m.text) as string[] };
}

// ── 1 · promoción y cupón ──
let code = flag('code');
let promoId: string | undefined;
const list = (await simulate()).item;
const fullPrice: number = list?.sellingPrice;
if (!fullPrice) throw new Error(`el SKU ${SKU} no está disponible en la tienda`);
if (!code) {
    code = `jarvisdesc${Date.now().toString(36)}`;
    const now = new Date();
    const promo = await must<any>('crear la promoción', 'POST', `${base}/pvt/calculatorconfiguration`, {
        name: `Jarvis ${PCT}% SKU ${SKU} con cupón ${code}`, description: 'Prueba de Jarvis: se archiva al terminar.',
        beginDateUtc: now.toISOString(), endDateUtc: new Date(now.getTime() + 2 * 3600e3).toISOString(),
        isActive: true, type: 'regular', origin: 'marketplace', discountType: 'percentual',
        percentualDiscountValue: PCT, percentualShippingDiscountValue: 0,
        skus: [{ id: SKU, name: list.name ?? `SKU ${SKU}` }], skusAreInclusive: true,
        idsSalesChannel: ['1'], areSalesChannelIdsExclusive: false, utmSource: code,
    });
    promoId = promo.idCalculatorConfiguration;
    await must('crear el cupón', 'POST', `${base}/v1/pvt/coupon`, { couponCode: code, utmSource: code, utmCampaign: '', maxUsage: null, maxItemsPerClient: 0, expirationIntervalPerUse: '00:00:00' });
    say(`promoción ${promoId} (${PCT}% al SKU ${SKU}, vence en 2 h) · cupón ${code}`);
    if (argv.includes('--prepare')) {
        say(`lista. En ~20 min: make jarvis-recipe APP=vtex RECIPE=discount-purchase ARGS='--code ${code}'`);
        process.exit(0);
    }
}

// ── 2 · esperar a que el carrito la aplique ──
const t0 = Date.now();
let discounted = 0;
let lastShown = -1;
while (Date.now() - t0 < 40 * 60e3) {
    const s = await simulate(code);
    if (s.item?.sellingPrice < fullPrice) { discounted = s.item.sellingPrice; break; }
    const min = Math.round((Date.now() - t0) / 60e3);
    if (min % 2 === 0 && min !== lastShown && (lastShown = min) >= 0) say(`+${min} min · el carrito todavía da ${money(s.item?.sellingPrice)}${s.messages.length ? ` («${s.messages[0]}»: es la espera, no el cupón)` : ''}`);
    await new Promise((r) => setTimeout(r, 30_000));
}
if (!discounted) throw new Error(`a los 40 min el cupón ${code} todavía no aplica: mirá el Promotion Simulator (botón Cartman del carrito)`);
say(`el carrito aplica el cupón a los ${Math.round((Date.now() - t0) / 60e3)} min: ${money(fullPrice)} → ${money(discounted)}`);

// ── 3 · la compra ──
const order = await placeVtexOrder({ tel: '3121520000', doc: '1650215200', firstName: 'CARLOS', lastName: 'RUIZ', email: 'vtex-1650215200@creditop.com' }, SKU, { coupon: code });
say(`pedido ${order.orderId} · total ${money(order.total)} · wizard ${order.redirectUrl}`);

// ── 4 · qué recibió CreditOp (qa, sólo lectura) ──
const run = promisify(execFile);
const vtexOrder = order.orderId.replace(/-\d+$/, '');
const { stdout } = await run(path.join(ROOT, 'bin/pg'), ['sql', '--target', 'qa', '-json', '--query',
    `SELECT id, origin, JSON_EXTRACT(data,'$.total') AS total, products FROM ecommerce_requests WHERE order_identifier = '${vtexOrder.replace(/\D/g, '')}' ORDER BY id DESC LIMIT 1`], { timeout: 90_000 });
const row = JSON.parse(stdout).rows?.[0];
if (!row) say('⚠ en qa no aparece la solicitud del pedido (ecommerce_requests): el conector no la creó o todavía no llegó');
else {
    const products = JSON.parse(row.products ?? '[]');
    const sum = products.reduce((a: number, p: any) => a + Number(p.price) * Number(p.quantity), 0);
    say(`qa recibió: solicitud ${row.id} (${row.origin}) · total $${Number(row.total).toLocaleString('es-CO')} · productos suman $${sum.toLocaleString('es-CO')}`);
    if (Math.round(Number(row.total)) === Math.round(order.total / 100)) say('✓ el TOTAL que recibe CreditOp es el del pedido con el descuento');
    else say(`✗ el total que recibe CreditOp ($${row.total}) no es el del pedido (${money(order.total)})`);
    if (sum > Number(row.total)) say(`⚠ los PRODUCTOS llegan con el precio sin descuento (suman $${sum.toLocaleString('es-CO')}, el total es $${Number(row.total).toLocaleString('es-CO')})`);
}

// ── 5 · deshacer ──
if (KEEP) { say(`--keep: quedan el pedido ${order.orderId}, la promoción y el cupón ${code}`); process.exit(0); }
await cancelVtexOrder(order.orderId);
say(`pedido ${order.orderId}: cancelación pedida`);
if (!promoId) {
    // Con --code, la promoción es la del cupón: se busca por su utm en el listado.
    const l = await must<any>('listar las promociones', 'GET', `${base}/pvt/benefits/calculatorconfiguration`);
    promoId = (l.items ?? []).find((p: any) => String(p.name).includes(code!))?.idCalculatorConfiguration;
}
if (promoId) { await must('archivar la promoción', 'POST', `${base}/pvt/archive/calculatorConfiguration/${promoId}`); say(`promoción ${promoId} archivada (puede seguir aplicando unos minutos: archivar tarda en llegar al carrito)`); }
await must('archivar el cupón', 'POST', `${base}/v1/pvt/archive/coupon/${code}`);
say(`cupón ${code} archivado`);
