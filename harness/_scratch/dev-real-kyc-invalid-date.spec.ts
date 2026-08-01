import { test, expect } from '@playwright/test';
import { fillAmountStep } from '../channel/steps';

/**
 * OBS-KYC-03 vivo contra develop:
 *   1. amount → phone con número REAL → OTP por Twilio (el operador digita el SMS)
 *   2. Apenas el wizard navega a /personal-info, capturamos el user_request_id
 *   3. POST directo al endpoint /personal-info/{hash}/{user_request_id} con
 *      expedition_date imposible "2010-02-31"
 *   4. Esperamos `error_code: ONB005` + `error_subcode: EXPEDITION_DATE_INVALID`
 *
 * Esto valida específicamente el guard checkdate() que la cascada agregó ANTES
 * de Carbon — sin él, Carbon roleaba 31/02/2010 → 03/03/2010 silenciosamente
 * y la fecha fallaba más adelante con un mensaje confuso.
 */

const PHONE = process.env.E2E_TWILIO_PHONE;
const PARTNER_HASH = process.env.E2E_PARTNER_HASH ?? 'e9409aff';
const OTP_WAIT_MS = 4 * 60 * 1000;

test('OBS-KYC-03 vivo: fecha imposible → EXPEDITION_DATE_INVALID', async ({ page, request }) => {
    test.skip(!PHONE, 'Define E2E_TWILIO_PHONE para correr este spec.');
    test.setTimeout(OTP_WAIT_MS + 90_000);

    // ---------- 1. amount → phone ----------
    await page.goto(`/self-service/${PARTNER_HASH}/solicitar`);
    await expect(page.getByTestId('amount-input')).toBeVisible({ timeout: 30_000 });
    await fillAmountStep(page, '1500000');

    await expect(page.getByTestId('phone-input')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('phone-input').click();
    await page.getByTestId('phone-input').pressSequentially(PHONE!, { delay: 30 });
    await expect(page.getByTestId('phone-submit')).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId('phone-submit').click();

    // ---------- 2. OTP (manual) ----------
    await expect(page.getByTestId('otp-input')).toBeVisible({ timeout: 20_000 });
    console.log(`\n📱 SMS enviado a ${PHONE}. Digitá el código en el browser cuando llegue.\n`);
    await page.waitForURL(/\/personal-info(\?|$)/, { timeout: OTP_WAIT_MS });

    // ---------- 3. Capturamos user_request_id de la URL ----------
    const currentUrl = new URL(page.url());
    const match = currentUrl.pathname.match(/\/self-service\/[^/]+\/(\d+)\/personal-info/);
    if (!match) {
        throw new Error(`No pude extraer user_request_id de la URL: ${currentUrl.pathname}`);
    }
    const userRequestId = match[1];
    console.log(`✅ user_request_id capturado: ${userRequestId}`);

    // ---------- 4. POST directo con fecha imposible ----------
    const endpoint = `http://legacy-backend.inertia-develop/api/onboarding/loan-application/personal-info/${PARTNER_HASH}/${userRequestId}`;
    const body = {
        document_type: 'CC',
        document_number: '1075313844',
        first_name: 'JUAN',
        surname: 'PEREZ',
        email: `test-kyc-${Date.now()}@creditop.com`,
        expedition_date: '2010-02-31', // ← fecha imposible
        date_of_birth: '1990-01-01',
        gender: 'M',
    };

    console.log(`\n🎯 POST → ${endpoint}`);
    console.log(`   expedition_date: ${body.expedition_date} (imposible)\n`);

    const apiRes = await request.post(endpoint, {
        data: body,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });

    const status = apiRes.status();
    const rawBody = await apiRes.text();
    let parsed: any = null;
    try {
        parsed = JSON.parse(rawBody);
    } catch {
        /* not JSON */
    }

    console.log(`\n📥 Response HTTP ${status}:`);
    console.log(JSON.stringify(parsed ?? rawBody, null, 2));

    // ---------- 5. Asserciones del subcódigo ----------
    // Soportamos los dos shapes posibles del envelope (root o envuelto en `errors`)
    const errorCode = parsed?.errors?.error_code ?? parsed?.error_code;
    const errorSubcode = parsed?.errors?.error_subcode ?? parsed?.error_subcode;

    expect(errorCode, `esperaba ONB005, body: ${rawBody}`).toBe('ONB005');
    expect(errorSubcode, `esperaba EXPEDITION_DATE_INVALID, body: ${rawBody}`).toBe(
        'EXPEDITION_DATE_INVALID',
    );

    console.log(`\n✅ Tu cascada OBS-KYC-03 funcionando contra dev:`);
    console.log(`   error_code: ${errorCode}`);
    console.log(`   error_subcode: ${errorSubcode}`);
});
