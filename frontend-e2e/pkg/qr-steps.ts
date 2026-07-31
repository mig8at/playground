// qr-steps.ts — PRELLENADO de las pantallas del canal QR (autogestión Bancolombia / Corbeta).
//
// POR QUÉ EXISTE APARTE de pkg/wizard-steps.ts:
//   `wizard-steps.ts` llena el tronco estándar (`/merchant/*`: monto, teléfono, OTP, personal-info,
//   employment). El canal QR **no pasa por ese tronco**: entra por
//   `bancolombia/self-service/{hash}/solicitar`, sigue a `{phone}/otp`, y de ahí el OTP decide el
//   producto y salta a `/bancolombia/{bnpl|consumo}/start/{encryptCode}`. Son otras pantallas, otro
//   formulario y otras validaciones — reusar los helpers del tronco no aplicaba.
//
// ⚠ EL MÓDULO NO TIENE UN SOLO `data-testid`.
//   Verificado: `git grep 'data-testid' modules/loan-request-wizard/bancolombia-origination` no
//   devuelve nada. Así que acá se selecciona por **rol y etiqueta accesible**, que es lo más estable que
//   hay sin tocar el front. Es más frágil que un testid: si cambia el copy de una etiqueta, esto se
//   rompe. La deuda real es agregar testids a ese módulo (habilitador del harness, no del producto);
//   mientras no estén, cada selector de acá va con el string exacto que hoy está en el código y con la
//   ruta del componente, para que el día que se rompa se sepa dónde mirar.
//
// CONTRATO DE LAS PANTALLAS (leído de origin/main, no de inspeccionar el DOM):
//   · `…/ui/components/onboarding/register/RegisterForm.tsx`
//       - `phoneNumber`      label «Número celular*»        (type=tel)
//       - `documentNumber`   label «Número de documento*»   (type=text)
//       - `acceptTerms` y `acceptPrivacyPolicy`: dos Checkbox, los DOS obligatorios
//         (`register-form.schema.ts` los refina con `.refine(val => val)`)
//       - submit: Button type=submit
//   · `…/ui/components/onboarding/otp-validation/OTPValidation.tsx`
//       - un `InputOTP` de `pinLength` slots, `name="otp"`; submit Button type=submit
//
// EL OTP EN PRUEBAS: son los **últimos 4 dígitos del teléfono**, y el teléfono tiene que estar en el
//   setting `qa_otp_bypass_phones`. Mismo mecanismo que el tronco (ver README §bypasses).

import type { Page } from '@playwright/test';

/** Los 4 últimos dígitos: el OTP de los teléfonos de bypass. */
export const otpDeTelefono = (phone: string) => phone.replace(/\D/g, '').slice(-4);

/**
 * Llena el registro del self-service (celular + documento + los dos checkboxes) y envía.
 * Devuelve `true` si la pantalla avanzó (la URL pasó a `/otp`).
 */
export async function fillQrRegister(
    page: Page,
    opts: { phone: string; document: string; timeout?: number },
): Promise<boolean> {
    const t = opts.timeout ?? 15_000;

    // ⚠ HAY QUE ESPERAR LA HIDRATACIÓN ANTES DE ESCRIBIR. La pantalla llega por SSR y react-hook-form
    // toma el control al hidratar: si se llena antes, React monta con sus defaults vacíos, el form queda
    // inválido y **el botón nunca se habilita** — sin un solo mensaje de error en pantalla, que es el
    // síntoma más engañoso posible (parece un selector roto). Es el mismo pozo que el `fill()` perdido
    // del MoneyInput del monto.
    //
    // Y la visibilidad NO sirve como señal: los checkboxes vienen en el HTML del SSR, así que están
    // visibles desde el primer frame. La sonda real es **el toggle**: que un click cambie `data-state` a
    // `checked` sólo pasa si el JS ya está atado. Se insiste hasta que uno responda.
    const cajas = page.locator('button[role="checkbox"]');
    await cajas.first().waitFor({ state: 'visible', timeout: t }).catch(() => {});
    const hidratado = await (async () => {
        const hasta = Date.now() + t;
        while (Date.now() < hasta) {
            await cajas.first().click({ timeout: 2_000 }).catch(() => {});
            if ((await cajas.first().getAttribute('data-state').catch(() => null)) === 'checked') return true;
            await page.waitForTimeout(250);
        }
        return false;
    })();
    if (!hidratado) {
        console.log('  ⚠ fillQrRegister: la pantalla no respondió al click del checkbox → no hidrató (¿el wizard está compilando todavía?)');
        return false;
    }

    const tel = page.getByLabel(/Número celular/i);
    const cedula = page.getByLabel(/Número de documento/i);
    const escribir = async () => {
        await tel.fill(opts.phone, { timeout: t });
        await cedula.fill(opts.document, { timeout: t });
    };
    await escribir();

    // Los DOS checkboxes son obligatorios (términos + política de datos) y hay dos trampas verificadas:
    //   1. NO están dentro del `<form>` (`closest('form')` da null) → scopear al form encuentra CERO.
    //   2. En la página hay un tercer `role=checkbox` que es un `<input>` del overlay de React Router
    //      devtools, no del formulario.
    // El selector que los separa exacto es `button[role=checkbox]`: Radix los renderiza como BUTTON, y el
    // del overlay es un INPUT. Los ids (`_R_1j4j5_-form-item`) son generados, así que no sirven.
    // Se marcan por `data-state` en vez de `isChecked()` porque en un botón-checkbox de Radix el estado
    // vive en ese atributo.
    const form = page.locator('form').first();
    const checks = page.locator('button[role="checkbox"]');
    const n = await checks.count();
    for (let i = 0; i < n; i += 1) {
        const c = checks.nth(i);
        if ((await c.getAttribute('data-state').catch(() => null)) !== 'checked') {
            await c.click({ timeout: t }).catch(() => {});
        }
    }

    // ⚠ EL BOTÓN NACE `disabled` y se habilita cuando el form valida (react-hook-form + zod). Clickearlo
    // antes tira timeout de Playwright («element is not enabled») y se lee como si el selector estuviera
    // mal. Por eso se ESPERA a que se habilite: si no lo hace, el problema es la validación —algún campo
    // o checkbox no se llenó— y devolver false acá deja ese diagnóstico a la vista.
    const submit = form.getByRole('button', { name: /continuar|siguiente|enviar|registrar/i }).first();
    await submit.waitFor({ state: 'visible', timeout: t }).catch(() => {});
    const esperarHabilitado = async (ms: number) => {
        const hasta = Date.now() + ms;
        while (Date.now() < hasta) {
            if (await submit.isEnabled().catch(() => false)) return true;
            await page.waitForTimeout(200);
        }
        return false;
    };
    // Un reintento tras re-escribir: si la hidratación llegó justo después del primer fill, los valores
    // se perdieron y volver a escribirlos alcanza. Es el mismo patrón que ya usa el harness con el
    // MoneyInput del monto (ver findings: `fill()` perdido por hidratación).
    let habilitado = await esperarHabilitado(4_000);
    if (!habilitado) { await escribir(); habilitado = await esperarHabilitado(6_000); }
    if (!habilitado) {
        // Se distingue de "envió y no navegó": son dos causas distintas y confundirlas manda a mirar el
        // selector cuando el problema es el dato o la validación.
        console.log('  ⚠ fillQrRegister: el botón de envío nunca se habilitó → el form no valida (¿campos vacíos por hidratación, o checkboxes sin marcar?)');
        return false;
    }

    await submit.click({ timeout: t });
    const navego = await page.waitForURL(/\/otp(\/|$|\?)/, { timeout: t }).then(() => true).catch(() => false);
    if (!navego) console.log(`  ⚠ fillQrRegister: envió pero no navegó al OTP (quedó en ${page.url()}) → mirá los mensajes de la pantalla`);
    return navego;
}

/**
 * Llena el OTP del self-service y envía. Si no le pasás código, usa los últimos 4 del teléfono.
 *
 * Devuelve a dónde resolvió el OTP, que es EL PUNTO DE DECISIÓN del canal:
 *   · `bnpl` / `consumo` → aterrizó en `/bancolombia/{tipo}/start/{encryptCode}` (`otp.tsx:182`)
 *   · `no-preapproved`   → la sucursal no tiene cupo / lender habilitado (`otp.tsx:121`)
 *   · `otro`             → quedó en otra pantalla (mirá `page.url()`)
 */
export async function fillQrOtp(
    page: Page,
    opts: { phone: string; code?: string; timeout?: number },
): Promise<'bnpl' | 'consumo' | 'no-preapproved' | 'otro'> {
    const t = opts.timeout ?? 20_000;
    const code = opts.code ?? otpDeTelefono(opts.phone);

    // `InputOTP` reparte el valor en slots. Escribir en el contenedor con teclado es lo que funciona en
    // los dos casos (un input real oculto, o slots individuales): el componente propaga el input.
    const otp = page.locator('[name="otp"], input[autocomplete="one-time-code"]').first();
    if (await otp.count()) {
        await otp.fill(code, { timeout: t }).catch(async () => {
            await otp.click({ timeout: t });
            await page.keyboard.type(code, { delay: 40 });
        });
    } else {
        // Fallback: sin input localizable, se teclea sobre la pantalla (los slots capturan el keypress).
        await page.keyboard.type(code, { delay: 40 });
    }

    await page.getByRole('button', { name: /validar|continuar|verificar|enviar/i }).first()
        .click({ timeout: t })
        .catch(async () => { await page.locator('button[type=submit]').first().click({ timeout: t }).catch(() => {}); });

    await page.waitForURL(/\/bancolombia\/(bnpl|consumo)\/start\/|no-preapproved/, { timeout: t }).catch(() => {});
    const u = page.url();
    if (/\/bancolombia\/bnpl\/start\//.test(u)) return 'bnpl';
    if (/\/bancolombia\/consumo\/start\//.test(u)) return 'consumo';
    if (/no-preapproved/.test(u)) return 'no-preapproved';
    return 'otro';
}
