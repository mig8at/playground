/**
 * pkg/wizard-steps — helpers ATÓMICOS para cada pantalla del wizard self-service
 * (amount → phone → otp → personal-info → expedition-date → employment-info).
 *
 * Es un módulo "hoja" sin deps internas (solo Playwright). Lo consumen:
 *   - pkg/composer.ts        → arma flujos compuestos por presets
 *   - channel/steps.ts       → expone `runHappyPathUntilLenders` (wrapper sobre el composer)
 *   - specs que necesitan llamar pasos sueltos (ej. ecommerce-local-real con su propia entrada)
 *
 * Lo extrajimos de channel/steps.ts para EVITAR un import circular composer ↔ channel/steps
 * y para que el composer y el helper compartan EXACTAMENTE la misma implementación
 * (un único punto de cambio cuando cambia un selector).
 *
 * Convención de inputs con transformer:
 *   - `docnum-input` y `monthly-income-input` usan react-hook-form con `onChange` que
 *     reformatea el valor. `fill()` salta el transformer y pierde chars. Por eso usamos
 *     `pressSequentially` con delay 50ms.
 *
 * Convención de scroll:
 *   - Algunos botones quedan tapados por el dock móvil de Vite en local; `click()` ya hace
 *     scroll-into-view, no hace falta forzarlo.
 */
/*
 * ⚠⚠ MEDICIÓN 2026-09-14 · EN EL WIZARD SÓLO EXISTEN CUATRO `data-testid`, Y ESTE ARCHIVO USA 21.
 *
 * Contra `origin/qa`, buscando el ATRIBUTO (no el substring, que cuenta de más: `personal-info-form`
 * aparece como nombre de archivo en un `index.ts` y parece existir), los `data-testid` renderizados por
 * el wizard son SEIS en total: `amount-input`, `amount-submit`, `phone-input`, `phone-submit` —los que
 * usan los dos primeros helpers de abajo— más `cambiar-vista` y `lender-toggle-`, de otra pantalla.
 *
 * Los 17 restantes que este archivo y los specs nombran NO EXISTEN en ninguna rama mergeada: vivían en
 * los stashes `local-e2e: data-testid …`, cuyo propio mensaje dice «NO commitear». Por eso
 * `fillOtpStep`, `fillPersonalInfoIdentification`, `fillExpeditionDate` y `fillEmploymentInfo` fallan
 * SIEMPRE, y siempre en su primera línea, con un `toBeVisible() failed` que parece un problema de la
 * pantalla y es del locator.
 *
 * QUÉ USAR MIENTRAS TANTO: el recorrido por HTTP (`dev/caminar-wizard.ts`, `make harness-caminar`) no
 * depende de testids —postea los formularios que el front declara— y llega hasta `/lenders` y hasta el
 * cierre con `CERRAR=1`. Para el tramo por navegador, los dos primeros helpers sí sirven.
 *
 * ARREGLARLO de verdad es una de dos: reescribir los cuatro helpers por rol/label —que es lo que hizo
 * `fillAmountStep` con su fallback—, o agregar los testids al wizard en un PR. Lo segundo es más
 * estable, pero toca el repo del producto: no se hace desde acá sin pedirlo.
 */
import { expect, type Page } from '@playwright/test';

async function typeInto(page: Page, testId: string, value: string): Promise<void> {
    const locator = page.getByTestId(testId);
    await locator.click();
    await locator.pressSequentially(value, { delay: 50 });
}

export async function fillAmountStep(
    page: Page,
    amount = '1500000',
    confirmQuota: 'yes' | 'no' = 'no',
): Promise<void> {
    // En self-service el paso de monto NO usa `amount-form.tsx` (que sí lleva testid en el flujo
    // dinámico): usa otro componente sin testid. Por eso caemos a un selector semántico por label.
    const input = page
        .getByTestId('amount-input')
        .or(page.getByRole('textbox', { name: /monto/i }));
    await expect(input).toBeVisible({ timeout: 15_000 });
    // ⚠ El canal ECOMMERCE fija el monto desde el carrito: el input llega con valor y BLOQUEADO.
    // No se escribe, sólo se confirma.
    //
    // Y el bloqueo NO se ve con `isEnabled()` / `isEditable()`: medido el 2026-09-14 contra qa, tras
    // hidratar el input queda `disabled=false`, `readOnly=false` y **`pointer-events: none`**. Para
    // Playwright está «visible, enabled and stable», así que intenta el click — y el click se lo
    // come el `<div>` padre. El spec muere con un timeout de 10 s tras «done scrolling», que no se
    // parece en nada a su causa. Por eso la guarda mira el VALOR, que es además lo semántico:
    // si el monto ya vino, no hay nada que escribir.
    const yaTraeMonto = ((await input.inputValue().catch(() => '')) ?? '').trim() !== '';
    if (!yaTraeMonto) {
        // Currency-masked input rejects `.fill()` intermittently. Type chars one
        // by one so the masking layer receives each keystroke event.
        await input.click();
        await input.pressSequentially(amount, { delay: 30 });
    }
    // "Confirmación de cupo" (feature omit-Experian): selector OBLIGATORIO en comercios habilitados
    // (check-if-able-to-omit → RKV26000). Si está presente hay que elegir para habilitar el submit;
    // default 'no' = flujo estándar (preserva el comportamiento de los specs previos).
    const cupo = page.getByRole('radio', { name: confirmQuota === 'yes' ? 'Sí' : 'No', exact: true });
    if (await cupo.isVisible().catch(() => false)) {
        await cupo.click();
    }
    const submit = page
        .getByTestId('amount-submit')
        .or(page.getByRole('button', { name: /activar mi cr[ée]dito|iniciar solicitud|continuar/i }));
    // Wait until the submit button leaves the disabled state — the mask only
    // accepts the value after its internal state settles.
    await expect(submit).toBeEnabled({ timeout: 5_000 });
    await submit.click();
}

export async function fillPhoneStep(page: Page, phone?: string): Promise<string> {
    const value =
        phone ?? `300${Math.floor(Math.random() * 10_000_000).toString().padStart(7, '0')}`;
    const input = page.getByTestId('phone-input');
    await expect(input).toBeVisible({ timeout: 15_000 });
    // Igual que el monto: en ECOMMERCE el celular viene del contrato del carrito y el input llega
    // `readonly`. Escribir ahí no falla con un mensaje útil — se cuelga. Si ya trae valor se respeta
    // y se DEVUELVE ése, que es el que quedará en la solicitud.
    const yaTrae = ((await input.inputValue().catch(() => '')) ?? '').trim();
    if (yaTrae === '') await input.fill(value);
    await page.getByTestId('phone-submit').click();
    return yaTrae === '' ? value : yaTrae;
}

export async function fillOtpStep(page: Page, code = '1234'): Promise<void> {
    // Falla con la CAUSA, no con un `toBeVisible() failed` a los 15 s: `otp-input` no existe en ninguna
    // rama mergeada (ver la medición de la cabecera). Sin esto, el spec culpa a la pantalla.
    if (!(await page.getByTestId('otp-input').count())) {
        throw new Error(
            '`fillOtpStep` no puede correr: el wizard NO tiene el testid `otp-input` (medido contra qa el '
            + '2026-09-14; sólo existen amount-input/amount-submit/phone-input/phone-submit). Este helper escribe el código del OTP. '
            + 'Usá el recorrido por HTTP: make harness-caminar, que no depende de testids.',
        );
    }
    await expect(page.getByTestId('otp-input')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('otp-input').click();
    await page.keyboard.type(code, { delay: 30 });
    await page.getByTestId('otp-submit').click();
}

export async function fillPersonalInfoIdentification(page: Page): Promise<void> {
    // Falla con la CAUSA, no con un `toBeVisible() failed` a los 15 s: `docnum-input` no existe en ninguna
    // rama mergeada (ver la medición de la cabecera). Sin esto, el spec culpa a la pantalla.
    if (!(await page.getByTestId('docnum-input').count())) {
        throw new Error(
            '`fillPersonalInfoIdentification` no puede correr: el wizard NO tiene el testid `docnum-input` (medido contra qa el '
            + '2026-09-14; sólo existen amount-input/amount-submit/phone-input/phone-submit). Este helper llena la identificación. '
            + 'Usá el recorrido por HTTP: make harness-caminar, que no depende de testids.',
        );
    }
    await expect(page.getByTestId('personal-info-form')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('docnum-input')).toBeVisible({ timeout: 15_000 });
    // FE validates `10000 < doc < 3_000_000_000`. Constrain generation so we never
    // sample outside that range (previous range used 1B–10B and flaked ~66%).
    const docNum = Math.floor(Math.random() * 2_899_999_999 + 100_000_000).toString();
    await typeInto(page, 'docnum-input', docNum);
    await typeInto(page, 'name-input', 'JUAN');
    await typeInto(page, 'surname-input', 'PEREZ');
    await typeInto(page, 'email-input', `juan${Date.now()}@example.com`);
    await page.getByTestId('identification-submit').click();
}

export async function fillExpeditionDate(page: Page): Promise<void> {
    // Falla con la CAUSA, no con un `toBeVisible() failed` a los 15 s: `date-selector-day` no existe en ninguna
    // rama mergeada (ver la medición de la cabecera). Sin esto, el spec culpa a la pantalla.
    if (!(await page.getByTestId('date-selector-day').count())) {
        throw new Error(
            '`fillExpeditionDate` no puede correr: el wizard NO tiene el testid `date-selector-day` (medido contra qa el '
            + '2026-09-14; sólo existen amount-input/amount-submit/phone-input/phone-submit). Este helper elige la fecha de expedición. '
            + 'Usá el recorrido por HTTP: make harness-caminar, que no depende de testids.',
        );
    }
    await expect(page.getByTestId('date-selector-day')).toBeVisible({ timeout: 15_000 });
    // Orden DÍA → MES → AÑO: mes y año están disabled hasta tener día.
    await page.getByTestId('date-selector-day').click();
    await page.getByTestId('date-selector-day-option-15').click();
    await page.getByTestId('date-selector-month').click();
    await page.getByTestId('date-selector-month-option-6').click();
    await page.getByTestId('date-selector-year').click();
    await page.getByTestId('date-selector-year-option-2010').click();
    // Checkbox de confirmación de identidad — sin testid en el componente actual.
    await page.getByRole('checkbox').first().check({ force: true });
    await page.getByTestId('expedition-date-submit').click();
}

export async function fillEmploymentInfo(
    page: Page,
    options: { status?: string; monthlyIncome?: string } = {},
): Promise<void> {
    // Falla con la CAUSA, no con un `toBeVisible() failed` a los 15 s: `employment-status-trigger` no existe en ninguna
    // rama mergeada (ver la medición de la cabecera). Sin esto, el spec culpa a la pantalla.
    if (!(await page.getByTestId('employment-status-trigger').count())) {
        throw new Error(
            '`fillEmploymentInfo` no puede correr: el wizard NO tiene el testid `employment-status-trigger` (medido contra qa el '
            + '2026-09-14; sólo existen amount-input/amount-submit/phone-input/phone-submit). Este helper llena los datos laborales. '
            + 'Usá el recorrido por HTTP: make harness-caminar, que no depende de testids.',
        );
    }
    const { status = 'Empleado', monthlyIncome = '2500000' } = options;
    await expect(page.getByTestId('employment-info-form')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('employment-status-trigger').click();
    await page.getByTestId(`employment-status-option-${status}`).click();
    await page.getByTestId('monthly-income-input').click();
    await page.keyboard.type(monthlyIncome, { delay: 30 });
    await page.getByTestId('employment-submit').click();
}
