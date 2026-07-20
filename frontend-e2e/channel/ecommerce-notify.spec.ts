import { expect, test, request as pwRequest } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { config } from '../pkg/config';
import { Flow } from '../pkg/flow';

/**
 * Ecommerce E2E — NOTIFICACIÓN A LA TIENDA (process_url) + return_url.
 *
 * El cierre del crédito dispara `EcommerceRequestService::processEcommerceTransaction` → POST al `process_url`
 * de la tienda (WooCommerce: process_url + order_identifier, basic-auth, body {status}). Endpoint que lo
 * expone: POST /api/onboarding/ecommerce-request/notify-store.
 *
 * Validamos el mecanismo real: creamos un ecommerce_request con `process_url` apuntando a un LISTENER LOCAL
 * (vía host.docker.internal, alcanzable desde el contenedor backend), llamamos notify-store y aseveramos que
 * la tienda RECIBIÓ el POST con {status}. El contrato base64 EXACTO lo genera generate_checkout_url.php
 * (PHP-serializado; con placeholders el create da 500).
 */

// El script se movió al repo el 2026-07-19 (antes estaba suelto en ~/Desktop/CREDITOP/github/, sin
// control de versiones). Ruta relativa: sobrevive a que cambie el home o el nombre de la carpeta.
const GEN_SCRIPT = process.env.GEN_SCRIPT
    ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'creditop-woocommerce', 'tools', 'generate_checkout_url.php');
const LISTENER_PORT = Number(process.env.E2E_SHOP_PORT ?? 9099);

/** Genera el contrato base64 real (del script) y devuelve los params o,p,u,t,config + hash. */
function realContract(): { hash: string; o: string; p: string; u: string; t: string; config: string } {
    const out = execFileSync('php', [GEN_SCRIPT], { encoding: 'utf8' }).trim();
    const m = out.match(/https?:\/\/[^\s]+\/ecommerce\/[^\s]+/);
    if (!m) throw new Error(`generate_checkout_url.php no devolvió URL: ${out.slice(0, 200)}`);
    const url = new URL(m[0]);
    const hash = url.pathname.split('/')[2];
    const q = url.searchParams;
    return { hash, o: q.get('o')!, p: q.get('p')!, u: q.get('u')!, t: q.get('t')!, config: q.get('config')! };
}

test('Ecommerce: notify-store POSTea al process_url de la tienda con {status}', async () => {
    test.setTimeout(60_000);

    const received: Array<{ url: string; body: string }> = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
            received.push({ url: req.url ?? '', body });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
        });
    });

    try {
        await new Flow(
            'Ecommerce notify-store → tienda',
            'listener local · create · notify · verifica POST recibido',
        )
            .step('Levantar listener', `hace de "tienda" en localhost:${LISTENER_PORT}`, async () => {
                await new Promise<void>((r) => server.listen(LISTENER_PORT, r));
                return `escuchando en :${LISTENER_PORT}`;
            })
            .step('Crear ecommerce_request', 'contrato base64 real desde generate_checkout_url.php + process_url al listener', async (ctx) => {
                const api = await pwRequest.newContext({ baseURL: config.mockUrl });
                const c = realContract();
                // process_url → host.docker.internal:PORT (alcanzable desde el contenedor backend).
                const shopUrl = `http://host.docker.internal:${LISTENER_PORT}/`;
                const createRes = await api.post(`/api/onboarding/ecommerce-request/create/${c.hash}`, {
                    data: {
                        partnerId: c.hash,
                        order: c.o,
                        products: c.p,
                        token: c.t,
                        returnUrl: c.u,
                        processUrl: Buffer.from(shopUrl).toString('base64'),
                        config: c.config,
                    },
                });
                const createBody = await createRes.json();
                expect(createBody.success, `create falló: ${JSON.stringify(createBody)}`).toBe(true);
                expect(String(createBody.data.returnUrl)).toMatch(/tienda-prueba\.com/);
                ctx.set('api', api);
                ctx.set('ecommerceRequestId', createBody.data.ecommerceRequestId);
                return `ecommerceRequestId ${createBody.data.ecommerceRequestId}`;
            })
            .step(
                'Disparar notify-store',
                // notify-store retiene un worker PHP-FPM mientras hace el POST SALIENTE; bajo carga los demás workers
                // pueden agotar los FPM → ERS000. Reintento paciente (~21s) hasta liberar workers.
                'POST a notify-store con {status:"completed"}; reintenta si ERS000 (FPM saturados)',
                async (ctx) => {
                    const api = ctx.get('api') as Awaited<ReturnType<typeof pwRequest.newContext>>;
                    const ecommerceRequestId = ctx.get('ecommerceRequestId');
                    let notifyBody: any;
                    for (let attempt = 1; attempt <= 6; attempt++) {
                        const notifyRes = await api.post('/api/onboarding/ecommerce-request/notify-store', {
                            data: { ecommerceRequestId, status: 'completed', amount: 600000 },
                        });
                        notifyBody = await notifyRes.json();
                        if (notifyBody.success || notifyBody.code !== 'ERS000') break;
                        await new Promise((r) => setTimeout(r, 1000 * attempt));
                    }
                    expect(notifyBody.success, `notify-store falló: ${JSON.stringify(notifyBody)}`).toBe(true);
                    return 'notify OK';
                },
            )
            .step('Verificar POST en la tienda', 'el listener debe haber recibido {status:"completed"}', async () => {
                await expect.poll(() => received.length, { timeout: 10_000 }).toBeGreaterThan(0);
                expect(received[0].body).toContain('completed');
                console.log('SHOP_RECEIVED=' + JSON.stringify(received[0]));
                return `recibido: ${received[0].body}`;
            })
            .run();
    } finally {
        server.close();
    }
});
