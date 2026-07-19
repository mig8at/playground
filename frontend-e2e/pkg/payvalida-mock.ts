import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';

/**
 * Cierra el círculo del lender rt=1 en LOCAL, junto con `mock-payvalida/server.mjs`.
 *
 * EL PROBLEMA:
 *   `App\Actions\Lenders\Payvalida` construye la URL de redirect como `'https://' . DATA.checkout`, o sea
 *   SIEMPRE https y siempre con el host que devuelve el proveedor. Un mock local por http nunca podría ser
 *   ese destino: el navegador iría a `https://localhost:<port>` y fallaría.
 *
 * LA SOLUCIÓN:
 *   El mock devuelve un host SENTINELA que no resuelve (`pay.mock-payvalida.local`) con los query params ya
 *   armados para el portal (`lender`, `monto`, `volver`, `comercio`). Acá interceptamos esa navegación y
 *   respondemos con el HTML de `mock-bank` — que lee esos params de su propio `location.search`, así que
 *   renderiza igual que si lo hubiéramos abierto directo. El "volver al comercio" usa `volver`.
 *
 *   Se intercepta por HOST sentinela, no por patrón amplio: no toca ningún otro tráfico.
 */

export const PAYVALIDA_SENTINEL = 'pay.mock-payvalida.local';

export async function mockPayvalidaCheckout(page: Page, mockBankDir = join(process.cwd(), 'mock-bank')): Promise<void> {
    let html = '';
    try { html = readFileSync(join(mockBankDir, 'index.html'), 'utf8'); } catch { return; /* sin portal, nada que servir */ }

    await page.route((url: URL) => url.hostname === PAYVALIDA_SENTINEL, async (route: Route) => {
        // Solo la navegación de documento; cualquier subrecurso del sentinela se corta.
        if (route.request().resourceType() !== 'document') {
            await route.fulfill({ status: 204, body: '' });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            headers: { 'cache-control': 'no-store' },
            body: html,
        });
    });
}
