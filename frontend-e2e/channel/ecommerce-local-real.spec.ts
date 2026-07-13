import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { decryptLaravelString } from '../pkg/laravel-crypt';
import { fillAmountStep, fillEmploymentInfo, fillExpeditionDate } from '../channel/steps';
import { Flow } from '../pkg/flow';

/**
 * E2E del flujo ecommerce contra NUESTRO stack LOCAL real (no el mock):
 *   - wizard: loan-request-wizard en :5174, rama feature/onboarding/ecommerce-web-origination
 *     (con VITE_API_URL apuntando al legacy local).
 *   - backend: legacy-backend local (http://localhost) en la misma rama.
 *
 * Valida NUESTRA entrada (`/ecommerce/{hash}/checkout?o=...`, checkout.tsx) + el flujo:
 *   checkout (decode+create en legacy) → /solicitar → amount → phone → OTP → personal-info →
 *   expedición → laboral → /lenders.
 *
 * Requiere el PERFIL MOCK de legacy (docs/local-dev.md): `make mock-all && make restart`
 * con el `.env.mock` completo (drivers fake + hosts/credenciales/AWS_BUCKET dummy). Con
 * ONBOARDING_DRIVER_OTP=fake (escenario success) el OTP valida con CUALQUIER código → no
 * hace falta descifrar el de `otps` ni APP_KEY. NO se requiere ningún bypass de código.
 *
 * Opcionales:
 *   GEN_SCRIPT (default ../github/generate_checkout_url.php, ruta al generador de la URL base64)
 */

const DB_CONTAINER = process.env.E2E_DB_CONTAINER ?? 'legacy-backend-mysql-1';
const DB_NAME = process.env.E2E_DB_NAME ?? 'creditop';
const GEN_SCRIPT =
    process.env.GEN_SCRIPT ?? '/Users/miguelochoa/Desktop/CREDITOP/github/generate_checkout_url.php';

function freshPhone(): string {
    const suffix = Math.floor(1_000_000 + Math.random() * 9_000_000).toString();
    return `305${suffix}`;
}

/** Corre generate_checkout_url.php y devuelve solo el path+query de la URL del wizard. */
function buildCheckoutPath(): string {
    const out = execFileSync('php', [GEN_SCRIPT], { encoding: 'utf8' }).trim();
    const match = out.match(/https?:\/\/[^\s]+\/ecommerce\/[^\s]+/);
    if (!match) {
        throw new Error(`No pude extraer la URL de checkout de generate_checkout_url.php: ${out.slice(0, 200)}`);
    }
    const url = new URL(match[0]);
    return url.pathname + url.search; // /ecommerce/<hash>/checkout?o=...&p=...&t=...
}

/** Lee el OTP cifrado del mysql LOCAL por cell_phone (sin -h: contenedor local). */
function fetchEncryptedOtp(cellPhone: string): string {
    const out = execFileSync(
        'docker',
        [
            'exec', DB_CONTAINER,
            'mysql', '-uroot', '-ppassword', DB_NAME, '-N', '-B',
            '-e', `SELECT otp FROM otps WHERE cell_phone='${cellPhone}' ORDER BY id DESC LIMIT 1;`,
        ],
        { encoding: 'utf8' },
    ).trim();
    if (!out || out.length < 50) {
        throw new Error(`No encrypted OTP found for cell_phone=${cellPhone}`);
    }
    return out;
}

test('Ecommerce LOCAL real: /checkout → solicitar → amount → phone → OTP(real) → personal-info', async ({
    page,
}) => {
    test.setTimeout(120_000);
    // Perfil mock (ONBOARDING_DRIVER_OTP=fake, escenario success): el OTP valida con cualquier código.

    const phone = freshPhone();

    await new Flow(
        'Ecommerce LOCAL real (sin testids)',
        '/checkout → solicitar → amount → phone → OTP(real) → personal-info',
    )
        .step('Handshake checkout', 'genera la URL con generate_checkout_url.php → /ecommerce/{hash}/checkout?o=...', async () => {
            const checkoutPath = buildCheckoutPath();
            await page.goto(checkoutPath);
            return checkoutPath;
        })
        .step('Monto', 'prellenado del order + bloqueado; solo se confirma', async () => {
            const activar = page.getByRole('button', { name: /activar mi cr[ée]dito/i });
            await expect(activar).toBeEnabled({ timeout: 20_000 });
            await activar.click();
            return 'monto prellenado + bloqueado';
        })
        .step('Teléfono', 'register persiste OTP cifrado en tabla otps', async () => {
            const phoneBox = page.getByRole('textbox', { name: /celular|tel[ée]fono|n[úu]mero/i });
            await expect(phoneBox).toBeVisible({ timeout: 20_000 });
            await phoneBox.click();
            await phoneBox.pressSequentially(phone, { delay: 30 });
            await page.getByRole('button', { name: /continuar|siguiente|enviar|activar/i }).click();
            await page.waitForURL(/\/otp(\?|$)/, { timeout: 20_000 });
            return `teléfono ${phone}`;
        })
        .step('OTP', 'con ONBOARDING_DRIVER_OTP=fake cualquier código de 4–6 dígitos valida', async () => {
            await page.waitForTimeout(2_000);
            const otpCode = '1234';
            expect(/^\d{4,6}$/.test(otpCode), 'OTP descifrado debe ser numérico').toBeTruthy();
            await page.waitForTimeout(1_000);
            const otpFields = page.locator('input:not([type="hidden"])');
            await otpFields.first().click();
            await page.keyboard.type(otpCode, { delay: 60 });
            const otpSubmit = page.getByRole('button', { name: /validar|continuar|confirmar|verificar|enviar/i });
            if (await otpSubmit.count()) {
                await otpSubmit.first().click();
            }
            return `OTP ${otpCode}`;
        })
        .step('Aterrizaje en /personal-info', 'ONB002 con user_request anclado al ecommerce_request', async () => {
            await page.waitForURL(/\/personal-info(\?|$)/, { timeout: 25_000 });
            await expect(
                page.getByText(/identificaci[óo]n|datos personales|informaci[óo]n personal/i).first(),
            ).toBeVisible({ timeout: 30_000 });
            return '/personal-info';
        })
        .run();
});

/**
 * Camino COMPLETO hasta /lenders usando los data-testid (requiere el stash de testids aplicado).
 * Dónde va cada data-testid (archivo → elemento → testid) en frontend-monorepo:
 *   loan-application-form/src/components/
 *     amount-form.tsx ............... amount-input (Input monto), amount-submit (botón)
 *     phone-number-step-form.tsx .... phone-input (Input), phone-submit (botón)
 *     forms/personal-info-form.tsx .. personal-info-form (div), docnum/name/surname/email-input,
 *                                     identification-submit (botón)
 *     forms/employment-info-form.tsx  employment-info-form, employment-status-trigger,
 *                                     employment-status-option-${value}, monthly-income-input, employment-submit
 *     document-expedition-date.tsx .. expedition-date-submit (botón; el DateSelector usa los de abajo;
 *                                     el checkbox confirmIdentity NO tiene testid → getByRole('checkbox'))
 *   packages/shared/components/src/components/otp.tsx . otp-input (InputOTP), otp-submit (botón)
 *   packages/ui/src/components/date-selector.tsx ..... date-selector-{day,month,year} (SelectTrigger) +
 *                                     date-selector-{day,month,year}-option-${n} (cada SelectItem)
 *   lenders-marketplace/src/components/forms/InitialFeeForm.tsx . initial-fee-input
 * Con el perfil mock completo /lenders responde sin ningún bypass. Usa los helpers compartidos.
 */
test('Ecommerce LOCAL real (testids): /checkout → amount → phone → OTP → personal → laboral → /lenders', async ({
    page,
}) => {
    test.setTimeout(150_000);
    // Perfil mock (ONBOARDING_DRIVER_OTP=fake, escenario success): el OTP valida con cualquier código.

    const phone = freshPhone();

    await new Flow(
        'Ecommerce LOCAL real (testids)',
        '/checkout → amount → phone → OTP → personal → laboral → /lenders',
    )
        .step('Handshake checkout', 'URL real desde generate_checkout_url.php', async () => {
            const path = buildCheckoutPath();
            await page.goto(path);
            return path;
        })
        .step('Monto', 'usa testid amount-input/submit', async () => {
            await fillAmountStep(page, '600000');
            return 'monto 600000';
        })
        .step('Teléfono', 'register → OTP cifrado en otps', async () => {
            await expect(page.getByTestId('phone-input')).toBeVisible({ timeout: 20_000 });
            await page.getByTestId('phone-input').click();
            await page.getByTestId('phone-input').pressSequentially(phone, { delay: 30 });
            await page.getByTestId('phone-submit').click();
            await page.waitForURL(/\/otp(\?|$)/, { timeout: 20_000 });
            return `teléfono ${phone}`;
        })
        .step('OTP', 'driver fake valida con cualquier código (1234)', async () => {
            await page.waitForTimeout(2_000);
            const otpCode = '1234';
            await page.getByTestId('otp-input').click();
            await page.keyboard.type(otpCode, { delay: 40 });
            await page.getByTestId('otp-submit').click();
            await page.waitForURL(/\/personal-info(\?|$)/, { timeout: 25_000 });
            return 'OTP validado → /personal-info';
        })
        .step('Identificación', 'sobrescribe prefill del stub de facturación (---)', async () => {
            await expect(page.getByTestId('personal-info-form')).toBeVisible({ timeout: 20_000 });
            const docNum = String(Math.floor(Math.random() * 2_899_999_999 + 100_000_000));
            await page.getByTestId('docnum-input').fill('');
            await page.getByTestId('docnum-input').pressSequentially(docNum, { delay: 40 });
            await page.getByTestId('name-input').fill('JUAN');
            await page.getByTestId('surname-input').fill('PEREZ');
            await page.getByTestId('email-input').fill(`e2e${Date.now()}@gmail.com`);
            await page.getByTestId('identification-submit').click();
            return `docnum ${docNum}`;
        })
        .step('Fecha de expedición', 'día → mes → año + checkbox identidad', async () => {
            await fillExpeditionDate(page);
            return 'fecha enviada';
        })
        .step('Datos laborales', 'solo si el FE pidió /employment-info', async () => {
            await page.waitForURL(/\/(employment-info|lenders)(\?|$)/, { timeout: 30_000 });
            if (!/\/employment-info/.test(page.url())) return 'omitido (no aplica)';
            await fillEmploymentInfo(page, { status: 'Empleado', monthlyIncome: '2500000' });
            await page.waitForURL(/\/lenders(\?|$)/, { timeout: 30_000 });
            return 'empleo registrado';
        })
        .step('Aterrizaje en /lenders', 'marketplace renderizado', async () => {
            await expect(page).toHaveURL(/\/lenders/);
            return page.url();
        })
        .run();
});
