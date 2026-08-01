import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fillAmountStep } from '../channel/steps';
import { decryptLaravelString } from '../pkg/laravel-crypt';

/**
 * E2E real contra develop sin Twilio:
 *   1. Genera teléfono random (user fresco)
 *   2. POST /phone/register al backend dev → persiste OTP encriptado en RDS
 *   3. Lee el OTP encriptado vía docker exec mysql
 *   4. Desencripta in-process con node:crypto (no PHP, no tinker)
 *   5. Tipea el OTP en el wizard
 *
 * Variables de entorno requeridas (no se persisten en código):
 *   APP_KEY                  APP_KEY del backend dev (mismo formato base64:...)
 *   E2E_DB_HOST              host de la RDS de dev
 *   E2E_DB_USER              usuario mysql
 *   E2E_DB_PASS              password mysql
 *   E2E_DB_NAME              nombre de schema (default: creditop)
 *   E2E_PARTNER_HASH         hash del aliado (default: e9409aff)
 *
 * El OTP desencriptado NUNCA se imprime a stdout.
 */

const PARTNER_HASH = process.env.E2E_PARTNER_HASH ?? 'e9409aff';

function freshPhone(): string {
    const suffix = Math.floor(1_000_000 + Math.random() * 9_000_000).toString();
    return `305${suffix}`;
}

function fetchEncryptedOtp(userId: number): string {
    const host = process.env.E2E_DB_HOST;
    const user = process.env.E2E_DB_USER;
    const password = process.env.E2E_DB_PASS;
    const db = process.env.E2E_DB_NAME ?? 'creditop';
    if (!host || !user || !password) {
        throw new Error('Missing E2E_DB_* env vars to reach the dev RDS.');
    }

    // execFile passes args literally (no shell interpolation) → safe for
    // passwords with $, *, ", etc.
    const out = execFileSync(
        'docker',
        [
            'exec',
            '-e', `MYSQL_PWD=${password}`,
            'legacy-backend-mysql-1',
            'mysql',
            '-h', host,
            '-u', user,
            '-D', db,
            '-N', '-B',
            '-e', `SELECT otp FROM otps WHERE user_id = ${userId} AND validated = 0 ORDER BY id DESC LIMIT 1;`,
        ],
        { encoding: 'utf8' },
    ).trim();

    if (!out || out.length < 50) {
        throw new Error(`No encrypted OTP found for user_id=${userId}`);
    }
    return out;
}

test('Real OTP flow contra develop (read+decrypt from RDS, no Twilio)', async ({ page, request }) => {
    test.setTimeout(120_000);

    const appKey = process.env.APP_KEY;
    test.skip(!appKey, 'Define APP_KEY antes de correr este spec.');

    const phone = freshPhone();

    // 1. Disparamos /phone/register contra dev — persiste user + OTP
    const registerRes = await request.post(
        'http://legacy-backend.inertia-develop/api/onboarding/phone/register',
        {
            data: {
                phone_number: phone,
                terms: true,
                policies: true,
                otp_length: 4,
                partner_branch_hash: PARTNER_HASH,
                dialCode: '+57',
            },
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        },
    );
    const registerBody = await registerRes.json();
    const userId: number | undefined = registerBody?.data?.user?.id;
    expect(userId, `register response: ${JSON.stringify(registerBody)}`).toBeTruthy();

    // 2. Esperamos a que el otp_record esté en BD
    await page.waitForTimeout(2_000);

    // 3. Leer encrypted, desencriptar in-memory (jamás se logea el plain)
    const encrypted = fetchEncryptedOtp(userId!);
    const otpCode = decryptLaravelString(encrypted, appKey!);
    if (!/^\d{4,6}$/.test(otpCode)) {
        throw new Error(`Decrypted OTP is not a numeric code (length ${otpCode.length}).`);
    }

    // 4. Flow UI normal con el OTP que ya conocemos
    await page.goto(`/self-service/${PARTNER_HASH}/solicitar`);
    await expect(page.getByTestId('amount-input')).toBeVisible({ timeout: 30_000 });
    await fillAmountStep(page, '1500000');

    await expect(page.getByTestId('phone-input')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('phone-input').click();
    await page.getByTestId('phone-input').pressSequentially(phone, { delay: 30 });
    await expect(page.getByTestId('phone-submit')).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId('phone-submit').click();

    await expect(page.getByTestId('otp-input')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('otp-input').click();
    await page.keyboard.type(otpCode, { delay: 40 });
    await page.getByTestId('otp-submit').click();

    // 5. ONB002 → /personal-info
    await page.waitForURL(/\/personal-info(\?|$)/, { timeout: 20_000 });
    await expect(page.getByTestId('personal-info-form')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_500);
});
