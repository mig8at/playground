// RECETA · una compra en Shopify pagada con Creditop, llevada AL DESENLACE de crédito por API, para ver cómo queda el
// pedido en Shopify sin recorrer el wizard a mano (~2 min). La hermana de `vtex/credit-outcome`.
//
//   make jarvis-recipe APP=shopify RECIPE=credit-outcome                          aprobada: la solicitud en 11
//   make jarvis-recipe APP=shopify RECIPE=credit-outcome ARGS='--outcome negada'  o cancelada
//   make jarvis-recipe APP=shopify RECIPE=credit-outcome ARGS='--outcome volver'  «Volver a la tienda» a mitad del wizard
//   (medido el 2026-11-09: pedido #1032 PAID, solicitud 504801 en 11, sin la vista previa de `shopify app dev`)
//
// 1. El checkout de `creditop-dev-store` en el Chrome de la persona (Jarvis): el carrito con la BMX (`--variant`), el
//    comprador sintético del harness, «Creditop» como medio de pago y «Pay now». Shopify llama a la app de Creditop
//    (`payments/session`), que pide el link a CreditOp (payment-link) y manda al wizard de qa.
// 2. El caminador del harness por HTTP, desde ESE link (`walk-wizard.ts --entry-url`), hasta el listado (~25 s).
// 3. El simulador de qa pone la solicitud en 11, 6 u 8. CreditOp avisa a la app por su webhook (la app desplegada en dev), la app
//    le pregunta el resultado y lo aplica en Shopify (`paymentSessionResolve` o `paymentSessionReject`).
// 4. Lo que aplicó la app (su registro) y el pedido por la Admin API: PAID con 11; con 6 u 8 no hay pedido.
// Medido el 2026-11-07: pedido #1025, solicitud 504733 en 11 → Shopify «Pagado».
// ⚠ Usa la app desplegada en dev (shopify-app.dev.creditop.com), la versión publicada: si la tienda manda a un
// `trycloudflare.com`, le quedó una vista previa de `shopify app dev` (se quita con `shopify app dev clean`). Y la
// contraseña de la tienda puesta una vez en el Chrome de la persona (la escribe ella).
// ESCRIBE en Shopify (un pedido de la tienda de pruebas) y en la base compartida de qa (el pedido, el cliente sintético
// y su solicitud), como cualquier compra de prueba.
import '../args.ts';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { openChrome } from '../recorder.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
// `volver`: el comprador toca «Volver a la tienda» en el wizard sin que el crédito tenga resultado (no hay simulador).
const STATUS: Record<string, number> = { aprobada: 11, negada: 6, cancelada: 8, volver: -1 };
const outcome = flag('outcome') || 'aprobada';
if (!(outcome in STATUS)) { console.error(`  ✗ --outcome ${outcome}: ${Object.keys(STATUS).join(', ')}`); process.exit(2); }
const variant = flag('variant') || '58721841053999'; // la BMX infantil, $800.000
const STORE = 'https://creditop-dev-store.myshopify.com';
const ADMIN = 'https://admin.shopify.com/store/creditop-dev-store';
const say = (s: string) => console.log(`  ${s}`);
const run = promisify(execFile);
const t0 = Date.now();
const secs = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;

// ── 0 · ¿contesta la app de pagos en dev? ──
// La versión publicada de la app apunta a dev (desde el 2026-11-09). La app local con el túnel se sacó del chat.
const DEV_APP = 'https://shopify-app.dev.creditop.com';
{
    const code = await fetch(DEV_APP, { redirect: 'manual' }).then((r) => r.status).catch(() => 0);
    if (code !== 200) { console.error(`  ✗ la app de pagos en dev no contesta (${DEV_APP} → ${code || 'sin respuesta'})`); process.exit(2); }
    say(`la app de pagos: la de dev (${DEV_APP})`);
}

// ── 1 · el checkout, en el Chrome de la persona ──
let wizard = '';
let orderName = '';
{
    const { page, close } = await openChrome();
    try {
        await page.goto(`${STORE}/cart/${variant}:1`, { waitUntil: 'commit', timeout: 90_000 });
        // El checkout sale en el idioma de la tienda: español desde el 2026-11-07 (antes inglés). Se aceptan los dos.
        const email = page.getByRole('textbox', { name: /^(Email or mobile phone number|Email o número de teléfono móvil)$/ });
        await email.waitFor({ timeout: 60_000 }).catch(() => { throw new Error('no llegó al checkout: ¿la contraseña de la tienda está puesta en este Chrome?'); });
        await email.fill('shopify-1650215200@creditop.com');
        await page.getByRole('textbox', { name: /^(First name \(optional\)|Nombre \(opcional\))$/ }).first().fill('CARLOS');
        await page.getByRole('textbox', { name: /^(Last name|Apellidos)$/ }).first().fill('RUIZ');
        const address = /^(Address|Dirección)$/;
        await page.getByRole('combobox', { name: address }).first().fill('Calle 100 # 10-20', { timeout: 5_000 }).catch(async () => {
            await page.getByRole('textbox', { name: address }).first().fill('Calle 100 # 10-20');
        });
        await page.getByRole('textbox', { name: /^(City|Ciudad)$/ }).first().fill('Bogotá');
        await page.getByText('Creditop', { exact: true }).first().click();
        say(`checkout: comprador sintético y Creditop · ${secs()}`);
        await page.getByRole('button', { name: /^(Pay now|Pagar ahora)/ }).click();
        await page.waitForURL(/originaciones-qa\.dev\.creditop\.com\/ecommerce\//, { timeout: 90_000 });
        wizard = page.url();
        say(`Shopify mandó al wizard de qa: ${wizard} · ${secs()}`);
    } finally {
        await close();
    }
}

// ── 2 · el caminador desde ese link, hasta el listado ──
const hash = new URL(wizard).pathname.split('/')[2];
const resultFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shopify-outcome-')), 'walk.json');
await run('node', ['dev/walk-wizard.ts', '--flow', 'ecommerce', '--cases', `#${hash}`, '--entry-url', wizard, '--result-file', resultFile], {
    cwd: path.join(ROOT, 'harness'), env: { ...process.env, E2E_TARGET: 'qa' }, timeout: 5 * 60_000, maxBuffer: 10 << 20,
}).catch(() => { /* sale ≠ 0 si no llegó al listado: se mira el resultado */ });
const walked = JSON.parse(fs.readFileSync(resultFile, 'utf8'))[0];
if (!walked?.ur) { console.error(`  ✗ el caminador no llegó a la solicitud: ${walked?.motivo ?? '?'}`); process.exit(1); }
say(`solicitud ${walked.ur} (el caminador por HTTP) · ${secs()}`);

// ── 2b · «Volver a la tienda» a mitad del wizard ──
// El link del wizard lleva al `return_url` del pedido, que en Shopify es la ruta `payments/return/<sesión>` de la app:
// sin resultado todavía, la app pone la sesión en PENDIENTE en Shopify y manda al comprador a la confirmación del pedido.
// Se abre esa misma URL en el Chrome de la compra (es lo que hace el link) y se mira dónde cae y cómo quedó el pedido.
if (outcome === 'volver') {
    const erId = Number(new URL(wizard).searchParams.get('erId'));
    const { stdout } = await run(path.join(ROOT, 'bin/pg'), ['sql', '--target', 'qa', '-json', '--query',
        `SELECT return_url FROM ecommerce_requests WHERE id = ${erId}`], { timeout: 60_000 });
    const back = JSON.parse(stdout).rows?.[0]?.return_url;
    if (!back) { console.error(`  ✗ el pedido ${erId} no tiene return_url en qa: el wizard no muestra «Volver a la tienda»`); process.exit(1); }
    say(`«Volver a la tienda» → ${back}`);
    const { page, close } = await openChrome();
    try {
        await page.goto(back, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await page.waitForURL(/myshopify\.com|shopify\.com/, { timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(4_000);
        say(`el comprador cae en: ${page.url()} · ${secs()}`);
        say(`la página dice: ${(await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 220)}`);
    } finally { await close(); }
    const { graphql } = await import('./api.ts');
    const d = await graphql<any>(`{ orders(first: 5, sortKey: CREATED_AT, reverse: true) { nodes { name createdAt displayFinancialStatus paymentGatewayNames } } }`);
    const o = d.orders.nodes.find((x: any) => Date.parse(x.createdAt) >= t0 - 60_000 && x.paymentGatewayNames.some((g: string) => /creditop/i.test(g)));
    say(o ? `Shopify: pedido ${o.name} · ${o.displayFinancialStatus} · ${secs()}` : `Shopify: sin pedido nuevo con Creditop · ${secs()}`);
    say(`listo: solicitud ${walked.ur} sigue abierta (sin simulador) · ${secs()}`);
    process.exit(0);
}

// ── 3 · el desenlace, por el simulador de qa ──
const { env } = await import(path.join(ROOT, 'harness/pkg/env.ts'));
process.env.E2E_TARGET = 'qa';
const sim = String(env('E2E_API_BASE_URL')).replace(/\/api\/?$/, '') + '/simulator/aggregator-result';
const r = await fetch(sim, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ user_request_id: walked.ur, status: STATUS[outcome] }) });
if (!r.ok) { console.error(`  ✗ el simulador dio ${r.status}`); process.exit(1); }
say(`simulador: solicitud ${walked.ur} → ${STATUS[outcome]} (${outcome}) · ${secs()}`);

// ── 4 · qué aplicó la app en Shopify y, si aprobó, el pedido en el admin ──
// CreditOp avisa a la app y la app a Shopify: casi siempre en segundos. Si el aviso no llega, la app CONCILIA sola: cada
// `CREDITOP_RECONCILE_MINUTES` (10 por defecto, `app/settlement.server.ts` del repo shopify) le pregunta a CreditOp por
// las sesiones pendientes de más de 2 min y aplica el resultado.
// Los logs de la app de dev no van a Loki. Una aprobada se ve en Shopify: el pedido pagado. Una negada o cancelada no
// crea pedido: lo que se mide es el aviso de qa a la app en Loki (`ecommerce_store_notified` con `store_status` 200 = la
// app lo aceptó). Que la app rechazó la sesión en Shopify NO se ve desde acá.
let applied = '';
let creditopSaid = '?';
const readApp = async () => {
    if (outcome !== 'aprobada') {
        const erId = Number(new URL(wizard).searchParams.get('erId'));
        const { stdout } = await run(path.join(ROOT, 'bin/pg'), ['logs', '--target', 'qa', '--since', '30m', '--query',
            `{service_name=~".+"} |= "ecommerce_store_notified" |~ "\\"ecommerce_request_id\\":${erId}[,}]"`], { timeout: 90_000 }).catch(() => ({ stdout: '' }));
        const code = /"store_status":(\d+)/.exec(stdout)?.[1];
        if (code === '200') {
            applied = 'rejected';
            creditopSaid = /"status":"(\w+)"/.exec(stdout)?.[1] ?? '?';
        } else if (code) say(`⚠ qa avisó a la app y contestó ${code}`);
        return;
    }
    const { graphql } = await import('./api.ts');
    const d = await graphql<any>(`{ orders(first: 5, sortKey: CREATED_AT, reverse: true) { nodes { createdAt paymentGatewayNames } } }`);
    if (d.orders.nodes.some((x: any) => Date.parse(x.createdAt) >= t0 - 60_000 && x.paymentGatewayNames.some((g: string) => /creditop/i.test(g)))) applied = 'resolved';
};
const waitApp = async (limit: number) => {
    for (const end = Date.now() + limit; Date.now() < end && !applied;) {
        await new Promise((res) => setTimeout(res, 5_000));
        await readApp().catch((e) => say(`⚠ no pude leer el resultado: ${String((e as Error).message).split('\n')[0]}`));
    }
};
await waitApp(60_000);
if (!applied) {
    const erId = new URL(wizard).searchParams.get('erId');
    const { stdout } = await run(path.join(ROOT, 'bin/pg'), ['sql', '--target', 'qa', '-json', '--query',
        `SELECT processed FROM ecommerce_requests WHERE id = ${Number(erId)}`], { timeout: 60_000 }).catch(() => ({ stdout: '{}' }));
    const processed = JSON.parse(stdout).rows?.[0]?.processed;
    say(`⚠ en un minuto no se vio el resultado (pedido de la tienda ${erId}: processed = ${processed ?? '?'} en qa); espero la conciliación de la app (hasta 12 min) · ${secs()}`);
    await waitApp(12 * 60_000);
}
if (applied === 'rejected') say(`qa le avisó a la app «${creditopSaid}» y la app lo aceptó (200); que rechazó la sesión en Shopify no se ve desde acá · ${secs()}`);
else if (applied) say(`la app de Creditop resolvió el pago en Shopify · ${secs()}`);
else {
    say(`✗ no se vio el resultado: ni el pedido en Shopify ni el aviso de qa · ${secs()}`);
    process.exit(1);
}
if (applied === 'rejected') {
    say(`sin pedido en Shopify (un rechazo no lo crea) · solicitud ${walked.ur} en ${STATUS[outcome]} · ${secs()}`);
    process.exit(outcome === 'aprobada' ? 1 : 0);
}
// El pedido, por la Admin API (la app «Jarvis · Admin API (pruebas)», con acceso a pedidos desde la distribución
// personalizada): el más nuevo pagado con Creditop después de empezar esta corrida.
{
    const { graphql } = await import('./api.ts');
    const d = await graphql<any>(`{ orders(first: 5, sortKey: CREATED_AT, reverse: true) { nodes { name createdAt displayFinancialStatus
        paymentGatewayNames totalPriceSet { shopMoney { amount } } } } }`);
    const o = d.orders.nodes.find((x: any) => Date.parse(x.createdAt) >= t0 - 60_000 && x.paymentGatewayNames.some((g: string) => /creditop/i.test(g)));
    if (o) {
        orderName = o.name;
        say(`Shopify: pedido ${o.name} · $${Number(o.totalPriceSet.shopMoney.amount).toLocaleString('es-CO')} · ${o.paymentGatewayNames.join(', ')} · ${o.displayFinancialStatus} · ${secs()}`);
    } else say(`⚠ no aparece un pedido nuevo pagado con Creditop: miralo en ${ADMIN}/orders`);
}
say(`listo: pedido ${orderName || '?'} · solicitud ${walked.ur} en ${STATUS[outcome]} · ${secs()}`);
