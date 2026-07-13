import { test, expect, request } from '@playwright/test';
import { config, expectedSubcodes, fakeScenarios } from '../pkg/config';
import { assertSubcode } from '../pkg/error-shape';

/**
 * OBS-OTP-02 — el backend debe emitir cada sufijo de la familia ONB001 cuando se le inyecta el
 * escenario correspondiente. Contract tests API-level (no levantan navegador).
 *
 * Shape del backend real: HETEROGÉNEO (ver docs/REFERENCIA-FLUJOS.md §13 y pkg/error-shape.ts).
 * Los markers (`"ONB001"`, `"CODE_INVALID"`, …) pueden venir concatenados al error_code, anidados en
 * `errors.*`, en `error.code`, o en `message`. `assertSubcode(body, code, sub)` busca ambos como
 * substrings en CUALQUIER parte del body — igual estrategia que backend-e2e::channel/negative.go.
 *
 * Estado tras la reescritura (backlog #2):
 *   - 2 activos (✅ evidencia VERDE en backend-e2e::negative.go): NO_PREVIOUS_OTP, CODE_INVALID.
 *   - 3 fixme con razón concreta: CODE_EXPIRED, PROVIDER_UNREACHABLE, PROVIDER_ERROR — los nombres
 *     de escenario "expired/provider-down/provider-5xx" eran del mock viejo :4000 y no están
 *     verificados en HttpFakeRegistrar del backend real. Cuando los confirmemos en
 *     ONBOARDING_DRIVER_OTP=fake, sacar el fixme. Ver `fakeScenarios.otp.*` en pkg/config.ts.
 */
test.describe('OBS-OTP-02 — sufijos de ONB001', () => {
    const validateOtpUrl = `/api/onboarding/loan-application/otp-validate/${config.partnerHash}`;
    const registerPhoneUrl = `/api/onboarding/phone/register`;

    /** Registra un teléfono en el backend para que exista OTP previo. */
    async function ensurePhoneRegistered(api: import('@playwright/test').APIRequestContext, phone: string) {
        await api.post(registerPhoneUrl, {
            data: { phone_number: phone, otp_length: 4, terms: true, policies: true },
        });
    }

    function uniquePhone(): string {
        return `300${Math.floor(Math.random() * 10_000_000).toString().padStart(7, '0')}`;
    }

    test('sin OTP previo → ONB001 + NO_PREVIOUS_OTP', async () => {
        const api = await request.newContext({ baseURL: config.mockUrl });
        const phone = uniquePhone();

        const res = await api.post(validateOtpUrl, {
            data: { cell_phone: phone, otp_code: '1234', original_amount: 1_000_000, amount: 1_000_000 },
        });
        const body = await res.json();
        const r = assertSubcode(body, 'ONB001', expectedSubcodes.otp.noPreviousOtp);
        expect(r.ok, r.debug).toBe(true);
    });

    test('X-Fake-Scenario: invalid-code → ONB001 + CODE_INVALID', async () => {
        const api = await request.newContext({ baseURL: config.mockUrl });
        const phone = uniquePhone();
        await ensurePhoneRegistered(api, phone);

        const res = await api.post(validateOtpUrl, {
            data: { cell_phone: phone, otp_code: '9876', original_amount: 1_000_000, amount: 1_000_000 },
            headers: { 'X-Fake-Scenario': fakeScenarios.otp.invalidCode },
        });
        const body = await res.json();
        const r = assertSubcode(body, 'ONB001', expectedSubcodes.otp.codeInvalid);
        expect(r.ok, r.debug).toBe(true);
    });

    test.fixme('X-Fake-Scenario: expired → ONB001 + CODE_EXPIRED', async () => {
        // ⏸️ Nombre de escenario `expired` no confirmado en HttpFakeRegistrar del backend real. El backend-e2e
        // no lo cubre. Activar este test cuando se verifique el nombre canonical (ver pkg/config.ts::fakeScenarios.otp).
        const api = await request.newContext({ baseURL: config.mockUrl });
        const phone = uniquePhone();
        await ensurePhoneRegistered(api, phone);

        const res = await api.post(validateOtpUrl, {
            data: { cell_phone: phone, otp_code: '1234', original_amount: 1_000_000, amount: 1_000_000 },
            headers: { 'X-Fake-Scenario': fakeScenarios.otp.expired },
        });
        const body = await res.json();
        const r = assertSubcode(body, 'ONB001', expectedSubcodes.otp.codeExpired);
        expect(r.ok, r.debug).toBe(true);
    });

    test.fixme('X-Fake-Scenario: provider-down → ONB001 + PROVIDER_UNREACHABLE', async () => {
        // ⏸️ Nombre de escenario `provider-down` heredado del mock :4000; no verificado en HttpFakeRegistrar.
        const api = await request.newContext({ baseURL: config.mockUrl });
        const phone = uniquePhone();
        await ensurePhoneRegistered(api, phone);

        const res = await api.post(validateOtpUrl, {
            data: { cell_phone: phone, otp_code: '1234', original_amount: 1_000_000, amount: 1_000_000 },
            headers: { 'X-Fake-Scenario': fakeScenarios.otp.providerDown },
        });
        const body = await res.json();
        const r = assertSubcode(body, 'ONB001', expectedSubcodes.otp.providerUnreachable);
        expect(r.ok, r.debug).toBe(true);
    });

    test.fixme('X-Fake-Scenario: provider-5xx → ONB001 + PROVIDER_ERROR', async () => {
        // ⏸️ Nombre de escenario `provider-5xx` heredado del mock :4000; no verificado en HttpFakeRegistrar.
        const api = await request.newContext({ baseURL: config.mockUrl });
        const phone = uniquePhone();
        await ensurePhoneRegistered(api, phone);

        const res = await api.post(validateOtpUrl, {
            data: { cell_phone: phone, otp_code: '1234', original_amount: 1_000_000, amount: 1_000_000 },
            headers: { 'X-Fake-Scenario': fakeScenarios.otp.providerError },
        });
        const body = await res.json();
        const r = assertSubcode(body, 'ONB001', expectedSubcodes.otp.providerError);
        expect(r.ok, r.debug).toBe(true);
    });
});
