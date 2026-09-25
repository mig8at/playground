// autorelleno-probe — ¿el autorelleno se instala y de verdad escribe donde React escucha?
//
// Es una SONDA, no una prueba de negocio: no valida el flujo, valida la ayuda de tipeo. Existe porque
// el autorelleno se apoya en dos cosas que el front puede mover sin avisar —que el campo del monto siga
// siendo un `input` y que su pista siga diciendo «monto»/«valor»— y porque su modo de falla es
// silencioso: si deja de escribir, no hay error; simplemente hay que volver a tipear todo a mano y uno
// piensa que se apagó solo.
//
// Entra por el lado del CUSTOMER (`/self-service/…`) y no por el del asesor, para no depender de la
// sesión de Cognito: lo que se prueba es la instalación y la escritura, que son iguales en las dos.
//
//   E2E_TARGET=local npx playwright test dev/autofill-probe.spec.ts --project=chromium --headed
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openA } from '../pkg/windows.ts';
import { config } from '../pkg/config.ts';

const MERCHANT = process.env.E2E_PROBE_MERCHANT || process.env.E2E_COMERCIO || 'alta';   // el viejo sigue andando

test('el autorelleno se instala y llena el monto', async ({ browser }) => {
    test.setTimeout(120_000);

    const flows = JSON.parse(readFileSync(new URL('../.flows.json', import.meta.url), 'utf8'));
    const hash = flows?.merchants?.[MERCHANT]?.branch_hash;
    test.skip(!hash, `«${MERCHANT}» no está en .flows.json — corré \`make harness-merchant MERCHANT=${MERCHANT}\``);

    const { page } = await openA(browser, { baseURL: config.feBaseUrl });
    await page.goto(`/self-service/${hash}/solicitar`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    // 1 · LA CHAPITA. Es lo que hace visible la ayuda; si no está, el init script no corrió y nada más
    //     de lo de abajo significa algo.
    const chip = page.locator('#__autorelleno_chip');
    await expect(chip, 'la chapita del autorelleno no apareció: el addInitScript no llegó a la página')
        .toBeVisible({ timeout: 20_000 });

    // 2 · QUE ESCRIBA DONDE REACT ESCUCHA. El campo del monto es el caso difícil a propósito: es el
    //     `MoneyInput`, el que pierde un `fill()` de Playwright si React todavía no ató su onChange, y
    //     el que delata si el evento se despachó mal. Un valor visible acá es la prueba de que el
    //     setter nativo + el `input` burbujeando funcionaron.
    const amount = page.locator('input').first();
    await expect
        .poll(async () => (await amount.inputValue().catch(() => '')).replace(/\D/g, ''), {
            message: 'el monto quedó vacío: o la pista del campo cambió, o el evento no llegó a React',
            timeout: 25_000,
        })
        .not.toBe('');

    // 3 · Y QUE NO HAYA AVANZADO SOLO. La regla que separa «me ahorra el tipeo» de «se me fue solo»:
    //     seguimos en la misma pantalla, esperando que el humano dé Continuar.
    expect(page.url(), 'el autorelleno navegó por su cuenta — no debe apretar botones de avanzar')
        .toContain('/solicitar');
});
