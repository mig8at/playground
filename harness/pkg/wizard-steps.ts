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
    // Currency-masked input rejects `.fill()` intermittently. Type chars one
    // by one so the masking layer receives each keystroke event.
    await input.click();
    await input.pressSequentially(amount, { delay: 30 });
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
    await expect(page.getByTestId('phone-input')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('phone-input').fill(value);
    await page.getByTestId('phone-submit').click();
    return value;
}

export async function fillOtpStep(page: Page, code = '1234'): Promise<void> {
    await expect(page.getByTestId('otp-input')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('otp-input').click();
    await page.keyboard.type(code, { delay: 30 });
    await page.getByTestId('otp-submit').click();
}

export async function fillPersonalInfoIdentification(page: Page): Promise<void> {
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
    const { status = 'Empleado', monthlyIncome = '2500000' } = options;
    await expect(page.getByTestId('employment-info-form')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('employment-status-trigger').click();
    await page.getByTestId(`employment-status-option-${status}`).click();
    await page.getByTestId('monthly-income-input').click();
    await page.keyboard.type(monthlyIncome, { delay: 30 });
    await page.getByTestId('employment-submit').click();
}
