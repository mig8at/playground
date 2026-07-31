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
 * Espera a que la pantalla esté HIDRATADA (con el JS atado), usando el toggle de un checkbox como sonda.
 *
 * ⚠ Es la trampa que más tiempo cuesta en este canal: las pantallas llegan por SSR, así que los campos y
 * los checkboxes **están visibles desde el primer frame** y `waitFor({state:'visible'})` no prueba nada.
 * Si se escribe antes de que react-hook-form tome el control, el `fill()` REPORTA ÉXITO y React lo pisa con
 * sus defaults vacíos: el form queda inválido, el botón nunca se habilita y no aparece un solo mensaje de
 * error. La única señal confiable es que un click cambie `data-state` a `checked`, porque eso sólo pasa con
 * el JS ya montado. Como los checkboxes de este canal hay que marcarlos igual, la sonda no tiene costo.
 */
export async function esperarHidratacion(page: Page, timeout = 15_000): Promise<boolean> {
    const cajas = page.locator('button[role="checkbox"]');
    await cajas.first().waitFor({ state: 'visible', timeout }).catch(() => {});
    if (!(await cajas.count().catch(() => 0))) return true;   // pantalla sin checkboxes: no hay sonda posible
    const hasta = Date.now() + timeout;
    while (Date.now() < hasta) {
        await cajas.first().click({ timeout: 2_000 }).catch(() => {});
        if ((await cajas.first().getAttribute('data-state').catch(() => null)) === 'checked') return true;
        await page.waitForTimeout(250);
    }
    return false;
}

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
    const hidratado = await esperarHidratacion(page, t);
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// AUTORRELLENADO del canal QR — llena lo que haya en pantalla y NO toca ningún botón.
//
// POR QUÉ ASÍ Y NO UNA SECUENCIA FIJA: el recorrido del canal tiene 7 formularios distintos (registro,
// OTP, monto BNPL, monto+uso Consumo, términos, datos personales y el financiero del OfferEvaluation) y
// el orden depende del producto que resuelva el OTP. Una secuencia cableada se rompe con cada rama; esto
// mira QUÉ hay en la pantalla actual y llena sólo eso. Es idempotente: lo que ya tiene valor no se toca.
//
// **Nunca clickea Continuar / Validar / Aceptar.** Es a propósito: el usuario conduce, el harness escribe.
// Si además apretara los botones, dejaría de ser el camino VISUAL y sería el rápido con navegador.
//
// Los `name` salen de los schemas del módulo (`domain/schemas/**/*form.schema.ts`), no de inspeccionar el
// DOM. Pero ⚠ **el input VISIBLE no siempre tiene `name`**: react-hook-form lo controla por `Controller` y
// el único que lleva el atributo es el `<input type=hidden name=X>` espejo que el form publica al enviar.
// O sea es al revés de lo intuitivo — verificado en el registro, donde `[name=phoneNumber]` matchea SÓLO
// el hidden y llenarlo no cambia nada en pantalla. Por eso cada campo se busca primero por su ETIQUETA
// accesible y sólo después por `name` (excluyendo hidden), y por eso el helper devuelve qué llenó: si un
// campo nuevo no aparece en esa lista, es que no lo encontró — no que ya estuviera lleno.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export type DatosQr = {
    phone: string;
    document: string;
    amount?: number;
    firstName?: string;
    lastName?: string;
    email?: string;
    address?: string;
    income?: number;
    otp?: string;
};

/** Campos por ETIQUETA (preferida) y por `name` (fallback), con el valor que les corresponde. */
const CAMPOS_QR: Array<{ name: string; label?: RegExp; valor: (d: DatosQr) => string | undefined }> = [
    { name: 'phoneNumber', label: /Número celular/i, valor: (d) => d.phone },
    { name: 'documentNumber', label: /Número de documento/i, valor: (d) => d.document },
    { name: 'otp', valor: (d) => d.otp ?? otpDeTelefono(d.phone) },
    { name: 'loanAmount', label: /monto|valor.*compra|cuánto/i, valor: (d) => (d.amount ? String(d.amount) : undefined) },
    { name: 'firstName', label: /nombre/i, valor: (d) => d.firstName },
    { name: 'lastName', label: /apellido/i, valor: (d) => d.lastName },
    { name: 'email', label: /correo|email/i, valor: (d) => d.email },
    { name: 'billingAddress', label: /dirección/i, valor: (d) => d.address },
    // Financiero del OfferEvaluation (Consumo): sólo los numéricos con un valor razonable; los selects
    // los cubre la pasada genérica de abajo.
    { name: 'fixedIncome', label: /ingreso.*fij|salario/i, valor: (d) => (d.income ? String(d.income) : undefined) },
    { name: 'peopleInCharge', label: /personas a cargo/i, valor: () => '0' },
    { name: 'monthsContractStart', valor: () => '24' },
    { name: 'monthlyExpenses', label: /egresos|gastos/i, valor: (d) => (d.income ? String(Math.round(d.income / 3)) : undefined) },
    { name: 'totalAssets', label: /activos|patrimonio/i, valor: (d) => (d.income ? String(d.income * 12) : undefined) },
];

/**
 * Llena todo lo que reconozca en la pantalla actual. Devuelve la lista de campos que tocó (vacía si no
 * había nada que llenar, que es lo normal en las pantallas de sólo-lectura del recorrido).
 */
export async function autorrellenarQr(page: Page, d: DatosQr): Promise<string[]> {
    const hechos: string[] = [];
    const t = 3_000;

    // Sin esto el `fill()` reporta éxito y React lo pisa al hidratar — ver `esperarHidratacion`.
    await esperarHidratacion(page, 10_000);

    for (const c of CAMPOS_QR) {
        const v = c.valor(d);
        if (!v) continue;
        // Primero por etiqueta (el input controlado suele NO tener `name`); después por `name`, siempre
        // excluyendo el hidden espejo.
        let loc = c.label ? page.getByLabel(c.label).first() : null;
        if (!loc || !(await loc.count().catch(() => 0))) {
            loc = page.locator(`input[name="${c.name}"]:not([type=hidden]), textarea[name="${c.name}"]`).first();
        }
        if (!(await loc.count().catch(() => 0))) continue;
        if (!(await loc.isVisible().catch(() => false))) continue;
        if ((await loc.inputValue().catch(() => ''))) continue;      // ya tenía valor: no se pisa
        await loc.fill(v, { timeout: t }).catch(() => {});
        // VERIFICAR que quedó: un `fill()` exitoso no garantiza que el valor sobreviva (hidratación, o un
        // input con máscara que rechaza el formato). Si no quedó, se reintenta una vez y si tampoco, se
        // reporta con `?` para que se vea en el log en vez de dar por hecho que se llenó.
        let quedo = (await loc.inputValue().catch(() => '')) !== '';
        if (!quedo) { await page.waitForTimeout(400); await loc.fill(v, { timeout: t }).catch(() => {}); quedo = (await loc.inputValue().catch(() => '')) !== ''; }
        hechos.push(`${c.name}=${v}${quedo ? '' : ' ⚠no quedó'}`);
    }

    // Selects sin elegir → primera opción real (la 0 suele ser el placeholder «Selecciona…»).
    const selects = page.locator('select:visible');
    for (let i = 0; i < (await selects.count().catch(() => 0)); i += 1) {
        const s = selects.nth(i);
        if (await s.inputValue().catch(() => '')) continue;
        const opciones = await s.locator('option').evaluateAll((els) =>
            els.map((e) => (e as HTMLOptionElement).value).filter((v) => v && v !== '0')).catch(() => []);
        if (opciones.length) await s.selectOption(opciones[0]).then(() => hechos.push(`select→${opciones[0]}`)).catch(() => {});
    }

    // SELECTS DE RADIX (`Select`/`SelectTrigger` del UI kit) — no son `<select>` y el bloque de arriba no
    // los ve. Es el muro de `consumo/loan-summary`: «Duración del crédito» y «¿Qué día quieres pagar?» son
    // los dos de este tipo, quedan vacíos, el form no valida y **el botón Continuar nunca se habilita**, sin
    // un mensaje de error. El trigger es un `button[role=combobox]` y las opciones se renderizan en un
    // PORTAL (fuera del form) como `[role=option]`, así que hay que abrir y clickear, no `selectOption`.
    const combos = page.locator('button[role="combobox"]:visible');
    for (let i = 0; i < (await combos.count().catch(() => 0)); i += 1) {
        const cb = combos.nth(i);
        // Con valor elegido, Radix pone `data-placeholder` sólo cuando está VACÍO: es la señal de "sin elegir".
        const vacio = (await cb.getAttribute('data-placeholder').catch(() => null)) !== null
            || !(await cb.textContent().catch(() => ''))?.trim();
        if (!vacio) continue;
        await cb.click({ timeout: t }).catch(() => {});
        const opcion = page.locator('[role="option"]:visible').first();
        if (await opcion.count().catch(() => 0)) {
            const etiqueta = (await opcion.textContent().catch(() => '')) ?? '';
            await opcion.click({ timeout: t })
                .then(() => hechos.push(`combo→${etiqueta.trim().slice(0, 18)}`))
                .catch(() => {});
        } else {
            await page.keyboard.press('Escape').catch(() => {});   // no dejar el listbox abierto tapando el resto
        }
    }

    // Radios: el primero de cada grupo.
    const grupos = new Set(await page.locator('input[type=radio]:visible').evaluateAll((els) =>
        els.map((e) => (e as HTMLInputElement).name).filter(Boolean)).catch(() => []));
    for (const g of grupos) {
        const r = page.locator(`input[type=radio][name="${g}"]:visible`).first();
        if (!(await r.isChecked().catch(() => true))) await r.check({ timeout: t }).then(() => hechos.push(`radio ${g}`)).catch(() => {});
    }

    // Checkboxes de Radix (términos, políticas, «acepto»). Ver la trampa documentada arriba: son BUTTON,
    // viven fuera del `<form>`, y su estado está en `data-state`.
    const cajas = page.locator('button[role="checkbox"]');
    for (let i = 0; i < (await cajas.count().catch(() => 0)); i += 1) {
        const c = cajas.nth(i);
        if ((await c.getAttribute('data-state').catch(() => null)) !== 'checked') {
            await c.click({ timeout: t }).then(() => hechos.push('checkbox')).catch(() => {});
        }
    }
    return hechos;
}
