// RECETA · una compra en Shopify pagada con Creditop, llevada AL DESENLACE de crédito por API, para ver cómo queda el
// pedido en Shopify sin recorrer el wizard a mano (~2 min). La hermana de `vtex/credit-outcome`.
//
//   make jarvis-recipe APP=shopify RECIPE=credit-outcome                          aprobada: la solicitud en 11
//   make jarvis-recipe APP=shopify RECIPE=credit-outcome ARGS='--outcome negada'  o cancelada
//   make jarvis-recipe APP=shopify RECIPE=credit-outcome ARGS='--app local'       con la app local del túnel (`shopify app dev`)
//   (medido el 2026-11-09: pedido #1032 PAID, solicitud 504801 en 11, sin la vista previa de `shopify app dev`)
//
// 1. El checkout de `creditop-dev-store` en el Chrome de la persona (Jarvis): el carrito con la BMX (`--variant`), el
//    comprador sintético del harness, «Creditop» como medio de pago y «Pay now». Shopify llama a la app de Creditop
//    (`payments/session`), que pide el link a CreditOp (payment-link) y manda al wizard de qa.
// 2. El caminador del harness por HTTP, desde ESE link (`walk-wizard.ts --entry-url`), hasta el listado (~25 s).
// 3. El simulador de qa pone la solicitud en 11, 6 u 8. CreditOp avisa a la app por su webhook (por el túnel), la app
//    le pregunta el resultado y lo aplica en Shopify (`paymentSessionResolve` o `paymentSessionReject`).
// 4. Lo que aplicó la app (su registro) y el pedido por la Admin API: PAID con 11; con 6 u 8 no hay pedido.
// Medido el 2026-11-07: pedido #1025, solicitud 504733 en 11 → Shopify «Pagado».
// ⚠ Necesita el servidor de la app de Shopify prendido y apuntado a la tienda: `make chat` → Servers → «Shopify · app de
// pagos» → Levantar (la app app-qa contra qa, el túnel y la extensión subida). Y la contraseña de la tienda puesta una
// vez en el Chrome de la persona (la escribe ella).
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
const STATUS: Record<string, number> = { aprobada: 11, negada: 6, cancelada: 8 };
const outcome = flag('outcome') || 'aprobada';
if (!STATUS[outcome]) { console.error(`  ✗ --outcome ${outcome}: ${Object.keys(STATUS).join(', ')}`); process.exit(2); }
const variant = flag('variant') || '58721841053999'; // la BMX infantil, $800.000
const STORE = 'https://creditop-dev-store.myshopify.com';
const ADMIN = 'https://admin.shopify.com/store/creditop-dev-store';
const say = (s: string) => console.log(`  ${s}`);
const run = promisify(execFile);
const t0 = Date.now();
const secs = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;

// ── 0 · ¿está la app de pagos? ──
// Por defecto, la app desplegada en dev (la versión publicada de la app; la tienda no tiene que tener la vista previa de
// `shopify app dev`). `--app local`: la app local del túnel, que la levanta el servidor del chat.
const DEV_APP = 'https://shopify-app.dev.creditop.com';
const useDev = flag('app') !== 'local';
if (useDev) {
    const code = await fetch(DEV_APP, { redirect: 'manual' }).then((r) => r.status).catch(() => 0);
    if (code !== 200) { console.error(`  ✗ la app de pagos en dev no contesta (${DEV_APP} → ${code || 'sin respuesta'})`); process.exit(2); }
    say(`la app de pagos: la de dev (${DEV_APP})`);
} else {
    const ready = await fetch('http://localhost:5184/api/servers').then((r) => r.json()).then((d: any) => d.servers?.find((s: any) => s.id === 'shopify')?.ready).catch(() => null);
    if (ready === false) { console.error('  ✗ la app de pagos de Shopify no está lista: make chat → Servers → «Shopify · app de pagos» → Levantar (o sin --app local, la desplegada en dev)'); process.exit(2); }
    if (ready === null) say('⚠ no pude preguntarle al chat si la app de pagos está lista (¿make chat apagado?): sigo igual');
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

// ── 3 · el desenlace, por el simulador de qa ──
const { env } = await import(path.join(ROOT, 'harness/pkg/env.ts'));
process.env.E2E_TARGET = 'qa';
const sim = String(env('E2E_API_BASE_URL')).replace(/\/api\/?$/, '') + '/simulator/aggregator-result';
const r = await fetch(sim, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ user_request_id: walked.ur, status: STATUS[outcome] }) });
if (!r.ok) { console.error(`  ✗ el simulador dio ${r.status}`); process.exit(1); }
say(`simulador: solicitud ${walked.ur} → ${STATUS[outcome]} (${outcome}) · ${secs()}`);

// ── 4 · qué aplicó la app en Shopify (su registro) y, si aprobó, el pedido en el admin ──
// Con un pago RECHAZADO Shopify no crea el pedido (el checkout vuelve a ofrecer pagar): lo que dice cómo terminó es la
// línea `creditop.webhook.applied` de la app, con `next: 'resolved' | 'rejected'`.
// CreditOp avisa a la app y la app a Shopify: casi siempre en ~15 s. Si el aviso no llega, la app CONCILIA sola: cada
// `CREDITOP_RECONCILE_MINUTES` (10 por defecto, `app/settlement.server.ts` del repo shopify) le pregunta a CreditOp por
// las sesiones pendientes de más de 2 min y aplica el resultado (`creditop.reconcile.applied`).
// ⚠ Medido el 2026-11-07: en 1 de 6 corridas el aviso de qa dio 502 en el túnel (`ecommerce_store_notify_failed` en
// Loki, el backend no reintenta) y la conciliación lo aplicó 3½ min después: pedido #1028 PAID. El chat abre ahora el
// túnel con `--proxy-keepalive-timeout 4s`, que era la causa del 502.
let applied = '';
let creditopSaid = '?';
let how = 'aviso';
const readApp = async () => {
    // Con la app de dev no hay un contenedor local que leer: lo que la app aplicó se ve en Shopify. Una aprobada crea el
    // pedido pagado; una rechazada no crea nada, así que con la app de dev no se distingue de un aviso que no llegó.
    if (useDev) {
        const { graphql } = await import('./api.ts');
        const d = await graphql<any>(`{ orders(first: 5, sortKey: CREATED_AT, reverse: true) { nodes { createdAt paymentGatewayNames } } }`);
        if (d.orders.nodes.some((x: any) => Date.parse(x.createdAt) >= t0 - 60_000 && x.paymentGatewayNames.some((g: string) => /creditop/i.test(g)))) {
            applied = 'resolved';
            how = 'pedido en Shopify';
        }
        return;
    }
    const { stdout, stderr } = await run('docker', ['logs', '--since', `${Math.ceil((Date.now() - t0) / 1000) + 5}s`, 'shopify-app-app-qa-1'], { maxBuffer: 20 << 20 });
    const log = stdout + stderr;
    for (const [marker, kind] of [['creditop.webhook.applied', 'aviso'], ['creditop.reconcile.applied', 'conciliación']] as const) {
        const last = log.split(marker).slice(1).pop();
        if (!last) continue;
        applied = /next:\s*'(\w+)'/.exec(last)?.[1] ?? '';
        creditopSaid = /creditop:\s*'(\w+)'/.exec(last)?.[1] ?? '?';
        how = kind;
        return;
    }
};
const waitApp = async (limit: number) => {
    for (const end = Date.now() + limit; Date.now() < end && !applied;) {
        await new Promise((res) => setTimeout(res, 5_000));
        try { await readApp(); } catch (e) {
            say(`⚠ no pude leer el registro de la app (docker): ${String((e as Error).message).split('\n')[0]}`);
            return false;
        }
    }
    return true;
};
if (await waitApp(60_000) && !applied) {
    const erId = new URL(wizard).searchParams.get('erId');
    const { stdout } = await run(path.join(ROOT, 'bin/pg'), ['sql', '--target', 'qa', '-json', '--query',
        `SELECT processed FROM ecommerce_requests WHERE id = ${Number(erId)}`], { timeout: 60_000 }).catch(() => ({ stdout: '{}' }));
    const processed = JSON.parse(stdout).rows?.[0]?.processed;
    say(`⚠ en un minuto el aviso de CreditOp no llegó a la app (pedido de la tienda ${erId}: processed = ${processed ?? '?'} en qa); espero la conciliación de la app (hasta 12 min) · ${secs()}`);
    await waitApp(12 * 60_000);
}
if (applied) say(`la app de Creditop (${how}): CreditOp dijo «${creditopSaid}» → en Shopify «${applied}» · ${secs()}`);
else {
    say(`✗ la app no aplicó nada: ni el aviso ni la conciliación · ${secs()}`);
    process.exit(1);
}
if (applied === 'rejected') {
    say(`Shopify rechazó el pago: no crea pedido · solicitud ${walked.ur} en ${STATUS[outcome]} · ${secs()}`);
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
