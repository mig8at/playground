import { expect, test, request as pwRequest } from '@playwright/test';
import http from 'node:http';
import { contratoParaSpec } from '../pkg/ecommerce';
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

/*
 * El contrato sale de `pkg/ecommerce.ts` (del repo), no de `generate_checkout_url.php`.
 *
 * Ese script tenía tres defectos que rompían este spec: vivía en una ruta ABSOLUTA fuera del repo
 * —se movió y el spec quedó apuntando a la nada—, pedía `php` instalado, y sobre todo usaba un
 * **`order_key` FIJO**, así que el `upsert` caía siempre en la MISMA fila de `ecommerce_requests`:
 * con `processed = 1` de una corrida vieja, la notificación al comercio ya no se disparaba y el
 * spec fallaba con ERS000 sin que el motivo estuviera a la vista.
 */
const LISTENER_PORT = Number(process.env.E2E_SHOP_PORT ?? 9099);


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
            .step('Crear ecommerce_request', 'contrato base64 del repo + process_url al listener', async (ctx) => {
                const api = await pwRequest.newContext({ baseURL: config.mockUrl });
                const c = await contratoParaSpec('amoblar');
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
                // La return_url sale de `E2E_RETURN_URL` (`.env.<target>` del harness). Sólo se exige
                // que HAYA una: fijar el dominio ataba el spec al valor de un `.env` de una máquina.
                expect(String(createBody.data.returnUrl ?? ''), 'el create debe devolver la return_url del comercio').toMatch(/^https?:\/\//);
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
