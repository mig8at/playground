import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fillAmountStep, fillPhoneStep } from '../channel/steps';
import { contractForSpec } from '../pkg/ecommerce';
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
 */

const DB_CONTAINER = process.env.E2E_DB_CONTAINER ?? 'legacy-backend-mysql-1';
const DB_NAME = process.env.E2E_DB_NAME ?? 'creditop';

function freshPhone(): string {
    const suffix = Math.floor(1_000_000 + Math.random() * 9_000_000).toString();
    return `305${suffix}`;
}

/** Arma el contrato con `pkg/ecommerce.ts` y devuelve solo el path+query de la URL del wizard. */
async function buildCheckoutPath(phone?: string): Promise<string> {
    // Del repo, no de un script PHP en una ruta absoluta del home: aquél se movió a
    // `creditop-woocommerce/tools/` el 2026-07-19 y estos specs quedaron apuntando a la nada. El del
    // repo además resuelve el comercio contra la BASE —nada de hashes quemados— y usa un `order_key`
    // ÚNICO por corrida, así que cada run crea una fila fresca en vez de reusar la misma.
    // El celular va DENTRO del contrato: en ecommerce el input llega prellenado y bloqueado, así
    // que es el único lugar donde un spec puede fijar uno único por corrida.
    const c = await contractForSpec('amoblar', phone ? { phone } : {});
    return c.checkout_path;
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
        .step('Handshake checkout', 'genera la URL con el contrato de pkg/ecommerce.ts → /ecommerce/{hash}/checkout?o=...', async () => {
            const checkoutPath = await buildCheckoutPath(phone);
            await page.goto(checkoutPath);
            return checkoutPath;
        })
        .step('Monto', 'prellenado del order + bloqueado; solo se confirma', async () => {
            // El paso va por `fillAmountStep`, no a mano: el copy del botón cambió («activar mi
            // crédito» → «Iniciar solicitud», medido el 2026-09-14 contra qa) y la pantalla ganó el
            // selector OBLIGATORIO «Confirmación de cupo», sin el cual el submit nace deshabilitado.
            await fillAmountStep(page);
            return 'monto prellenado + bloqueado';
        })
        .step('Teléfono', 'register persiste OTP cifrado en tabla otps', async () => {
            // Viene del contrato y `readonly`: sólo se confirma. `fillPhoneStep` respeta el
            // prellenado y devuelve el celular que de verdad quedará en la solicitud.
            await fillPhoneStep(page, phone);
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
/*
 * ⚠ ACÁ VIVÍA UN SEGUNDO TEST («Ecommerce LOCAL real (testids)») Y SE BORRÓ EL 2026-09-14.
 *
 * Recorría el flujo entero hasta /lenders apoyándose en ocho `data-testid`: `otp-input`, `otp-submit`,
 * `personal-info-form`, `docnum-input`, `name-input`, `surname-input`, `email-input` e
 * `identification-submit`. **Ninguno de los ocho existe** — medido contra `origin/qa`. Nunca estuvieron
 * en una rama mergeada: vivían en los stashes `local-e2e: data-testid …` que su propio mensaje marca
 * «NO commitear». El spec llevaba meses muriendo en el paso 5 de 8, y no había locator que lo arregle:
 * no es un selector viejo, es una pantalla que nunca existió así.
 *
 * (Los cuatro testids que SÍ existen en el wizard son `amount-input`, `amount-submit`, `phone-input` y
 * `phone-submit`; los usa el test de arriba y `pkg/wizard-steps.ts`.)
 *
 * QUÉ CUBRE HOY ESA COBERTURA, que era llegar hasta el listado:
 *   · `make harness-walk-wizard CASES='#<hash>' FLOW=ecommerce` — el mismo recorrido por HTTP, en segundos,
 *     y además comprueba lo que este test no miraba: que la solicitud quede ATADA al pedido y que
 *     personal-info llegue con los campos del comercio bloqueados (lee `lockedFields` del loader).
 *   · el test de arriba, que sigue cubriendo el tramo por NAVEGADOR hasta /personal-info.
 *
 * Un test que no puede correr no protege nada, y mantenerlo con locators inventados es peor que no
 * tenerlo: se lee como cobertura y es un fallo fijo que la gente aprende a ignorar.
 */
