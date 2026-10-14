/**
 * payment-link.ts — hace en la base lo que hará `POST /api/ecommerce/payment-link` (la API con que la tienda le pide a
 * Creditop la URL de checkout): guarda el pedido en `ecommerce_requests` con `origin = 'payment_link'`, una referencia
 * aleatoria y su vencimiento, y devuelve la URL que sólo lleva `?ref=`. Sirve para probar el lado del wizard (abrir el
 * pedido por referencia y entrar sin OTP) antes de que exista la API, y para repetir la prueba en cualquier momento.
 *
 * El contrato (los nombres de las columnas y del pedido) es el de la propuesta acordada con quien hace la API:
 *   origin = 'payment_link' · checkout_reference (UUID) · reference_expires_at · reference_used_at
 *   data = el pedido en JSON, con termAccepted y policyAccepted en la raíz y billing.phone
 *
 * ESCRIBE en la base: el ambiente va explícito (E2E_TARGET) y fuera de local la guarda de siempre pide
 * I_KNOW_THIS_TOUCHES_SHARED_DEV=1 a mano.
 *
 * USO: E2E_TARGET=local node dev/payment-link.ts [--hash c390eed9] [--sin-aceptacion] [--sin-expedicion]
 *        [--vencida] [--json]
 */
import { randomInt, randomUUID } from 'node:crypto';
import { close, exec, one, TARGET } from '../pkg/db.ts';
import { env } from '../pkg/db.ts';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const value = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

if (!process.env.E2E_TARGET) {
    console.error('✗ falta E2E_TARGET: este script ESCRIBE en la base y no adivina el ambiente (E2E_TARGET=local)');
    process.exit(2);
}
if (TARGET === 'prod') {
    console.error('✗ en producción no: ahí los pedidos los crea la API de verdad');
    process.exit(2);
}

const hash = value('hash') || 'c390eed9';
try {
    const branch = await one<{ id: number; allied_id: number; name: string }>(
        'SELECT id, allied_id, name FROM allied_branches WHERE hash = ?', [hash]);
    if (!branch) throw new Error(`no hay sucursal ${hash} en ${TARGET}`);

    // Un comprador nuevo en cada corrida (como el resto del harness): documento, correo y celular sin usar.
    const doc = String(1_000_000_000 + randomInt(0, 899_999_999));
    const phone = '31' + String(randomInt(10_000_000, 99_999_999));
    const reference = randomUUID();
    const orderKey = randomUUID();
    const acceptedAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const order: Record<string, unknown> = {
        id: String(randomInt(10_000, 99_999)),
        order_key: orderKey,
        total: Number(value('total') || 1_500_000),
        billing: {
            first_name: 'MARIO', last_name: 'BROS', email: `qa${doc.slice(-6)}@creditop.com`, phone,
            document_type: 'CC', document_number: doc, birth_date: '1990-05-14',
            ...(flag('sin-expedicion') ? {} : { document_expedition_date: '2012-09-10' }),
        },
        ...(flag('sin-aceptacion') ? {} : { termAccepted: acceptedAt, policyAccepted: acceptedAt }),
    };

    await exec(
        `INSERT INTO ecommerce_requests (order_key, order_identifier, allied_id, allied_branch_id, ecommerce_id, data,
           products, return_url, process_url, processed, origin, checkout_reference, reference_expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 2, ?, '[]', ?, ?, 0, 'payment_link', ?, ${flag('vencida') ? 'NOW() - INTERVAL 1 MINUTE' : 'NOW() + INTERVAL 1 HOUR'}, NOW(), NOW())`,
        [orderKey, order.id, branch.allied_id, branch.id, JSON.stringify(order),
            'https://tienda-de-prueba.test/gracias', 'https://webhook.site/76e550fc-99ee-4c31-be5e-ec246a8808b4/', reference],
    );

    const url = `${env('E2E_BASE_URL', 'http://localhost:5174').replace(/\/$/, '')}/ecommerce/${hash}/checkout?ref=${reference}`;
    const out = { target: TARGET, sucursal: `${branch.name} (${hash})`, reference, order_key: orderKey, phone, document: doc,
        sin_aceptacion: flag('sin-aceptacion'), sin_expedicion: flag('sin-expedicion'), vencida: flag('vencida'), url };
    if (flag('json')) console.log(JSON.stringify(out));
    else {
        console.log(`\n  pedido creado como lo haría payment-link · ${out.sucursal} · ${TARGET}`);
        console.log(`  comprador: CC ${doc} · celular ${phone}`
            + (out.sin_aceptacion ? ' · SIN aceptación (debe pedir el código)' : '')
            + (out.sin_expedicion ? ' · SIN fecha de expedición (debe ir al formulario)' : '')
            + (out.vencida ? ' · referencia VENCIDA (debe pedir el código)' : ''));
        console.log(`\n  ${url}\n`);
    }
} catch (e) {
    console.error('✗', (e as Error).message);
    process.exitCode = 1;
} finally {
    await close();
}
