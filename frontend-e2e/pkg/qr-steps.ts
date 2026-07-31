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

    // Los inputs son controlados y además hay hidden con el mismo `name`, así que seleccionar por
    // `[name=…]` daría dos matches. Por eso va por etiqueta accesible.
    await page.getByLabel(/Número celular/i).fill(opts.phone, { timeout: t });
    await page.getByLabel(/Número de documento/i).fill(opts.document, { timeout: t });

    // Los DOS checkboxes son obligatorios (términos + política de datos). Se marcan todos los que haya
    // en la pantalla en vez de nombrarlos: el copy de cada uno es largo y cambia más que su rol.
    const checks = page.getByRole('checkbox');
    const n = await checks.count();
    for (let i = 0; i < n; i += 1) {
        const c = checks.nth(i);
        if (!(await c.isChecked().catch(() => true))) await c.check({ timeout: t }).catch(() => {});
    }

    await page.getByRole('button', { name: /continuar|siguiente|enviar|registrar/i }).first()
        .click({ timeout: t })
        .catch(async () => { await page.locator('button[type=submit]').first().click({ timeout: t }); });

    return await page.waitForURL(/\/otp(\/|$|\?)/, { timeout: t }).then(() => true).catch(() => false);
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
