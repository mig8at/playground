// RECETA · una compra en Shopify pagada con Creditop, llevada AL DESENLACE de crédito por API, para ver cómo queda el
// pedido en Shopify sin recorrer el wizard a mano (~2 min). La hermana de `vtex/credit-outcome`.
//
//   make jarvis-recipe APP=shopify RECIPE=credit-outcome                          aprobada: la solicitud en 11
//   make jarvis-recipe APP=shopify RECIPE=credit-outcome ARGS='--outcome negada'  o cancelada
//
// 1. El checkout de `creditop-dev-store` en el Chrome de la persona (Jarvis): el carrito con la BMX (`--variant`), el
//    comprador sintético del harness, «Creditop» como medio de pago y «Pay now». Shopify llama a la app de Creditop
//    (`payments/session`), que pide el link a CreditOp (payment-link) y manda al wizard de qa.
// 2. El caminador del harness por HTTP, desde ESE link (`walk-wizard.ts --entry-url`), hasta el listado (~25 s).
// 3. El simulador de qa pone la solicitud en 11, 6 u 8. CreditOp avisa a la app por su webhook (por el túnel), la app
//    le pregunta el resultado y lo aplica en Shopify (`paymentSessionResolve` o `paymentSessionReject`).
// 4. Mira el pedido en el admin: «Pagado» con 11.
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

// ── 0 · ¿está la app de pagos? (el servidor del chat) ──
const ready = await fetch('http://localhost:5184/api/servers').then((r) => r.json()).then((d: any) => d.servers?.find((s: any) => s.id === 'shopify')?.ready).catch(() => null);
if (ready === false) { console.error('  ✗ la app de pagos de Shopify no está lista: make chat → Servers → «Shopify · app de pagos» → Levantar'); process.exit(2); }
if (ready === null) say('⚠ no pude preguntarle al chat si la app de pagos está lista (¿make chat apagado?): sigo igual');

// ── 1 · el checkout, en el Chrome de la persona ──
let wizard = '';
let orderName = '';
{
    const { page, close } = await openChrome();
    try {
        await page.goto(`${STORE}/cart/${variant}:1`, { waitUntil: 'commit', timeout: 90_000 });
        const email = page.getByRole('textbox', { name: 'Email or mobile phone number' });
        await email.waitFor({ timeout: 60_000 }).catch(() => { throw new Error('no llegó al checkout: ¿la contraseña de la tienda está puesta en este Chrome?'); });
        await email.fill('shopify-1650215200@creditop.com');
        await page.getByRole('textbox', { name: 'First name (optional)' }).first().fill('CARLOS');
        await page.getByRole('textbox', { name: 'Last name', exact: true }).first().fill('RUIZ');
        await page.getByRole('combobox', { name: 'Address' }).first().fill('Calle 100 # 10-20').catch(async () => {
            await page.getByRole('textbox', { name: 'Address', exact: true }).first().fill('Calle 100 # 10-20');
        });
        await page.getByRole('textbox', { name: 'City' }).first().fill('Bogotá');
        await page.getByText('Creditop', { exact: true }).first().click();
        say(`checkout: comprador sintético y Creditop · ${secs()}`);
        await page.getByRole('button', { name: /^Pay now/ }).click();
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
await new Promise((res) => setTimeout(res, 15_000)); // CreditOp avisa a la app y la app a Shopify
let applied = '';
try {
    const { stdout, stderr } = await run('docker', ['logs', '--since', `${Math.ceil((Date.now() - t0) / 1000) + 5}s`, 'shopify-app-app-qa-1'], { maxBuffer: 20 << 20 });
    const blocks = (stdout + stderr).split('creditop.webhook.applied').slice(1);
    const last = blocks.pop() ?? '';
    applied = /next:\s*'(\w+)'/.exec(last)?.[1] ?? '';
    const creditop = /creditop:\s*'(\w+)'/.exec(last)?.[1] ?? '?';
    say(applied ? `la app de Creditop: CreditOp dijo «${creditop}» → en Shopify «${applied}» · ${secs()}` : `⚠ la app todavía no aplicó el resultado (docker logs shopify-app-app-qa-1) · ${secs()}`);
} catch (e) {
    say(`⚠ no pude leer el registro de la app (docker): ${String((e as Error).message).split('\n')[0]}`);
}
if (applied === 'rejected') {
    say(`Shopify rechazó el pago: no crea pedido · solicitud ${walked.ur} en ${STATUS[outcome]} · ${secs()}`);
    process.exit(outcome === 'aprobada' ? 1 : 0);
}
{
    const { page, close } = await openChrome();
    try {
        await page.goto(`${ADMIN}/orders`, { waitUntil: 'commit', timeout: 60_000 });
        await page.waitForTimeout(10_000);
        let text = '';
        for (const f of page.frames()) text += '\n' + await f.evaluate(() => document.body?.innerText ?? '').catch(() => '');
        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
        const i = lines.findIndex((l) => /^#\d{4}$/.test(l));
        if (i >= 0) {
            orderName = lines[i];
            say(`Shopify: ${lines.slice(i, i + 7).join(' · ')} · ${secs()}`);
        } else say('⚠ no pude leer el último pedido en el admin: miralo en ' + `${ADMIN}/orders`);
    } finally {
        await close();
    }
}
say(`listo: pedido ${orderName || '?'} · solicitud ${walked.ur} en ${STATUS[outcome]} · ${secs()}`);
