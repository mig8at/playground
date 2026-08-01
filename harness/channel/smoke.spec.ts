import { test, expect, request } from '@playwright/test';
import { config } from '../pkg/config';

/**
 * Smoke test del entorno antes que corra cualquier otro spec.
 *
 * Si esto falla, el resto va a fallar por las mismas razones, así que
 * sirve como diagnóstico rápido. NO valida nada del FE — solo confirma
 * que el mock está vivo y responde como esperamos.
 */
test.describe('Entorno', () => {
    test.fixme('mock-server responde en el endpoint /api/onboarding/loan-application/otp-validate', async () => {
        const api = await request.newContext({ baseURL: config.mockUrl });

        // Request inocua: phone que no registramos, debe responder con NO_PREVIOUS_OTP.
        // No nos importa el contenido exacto — solo que el mock esté vivo y
        // emita el contrato OBS-OTP-02 que esperamos.
        const res = await api.post(
            `/api/onboarding/loan-application/otp-validate/${config.partnerHash}`,
            {
                data: {
                    cell_phone: '3000000000',
                    otp_code: '1234',
                    original_amount: 1000000,
                    amount: 1000000,
                },
            },
        );

        expect(res.status()).toBe(200);

        const body = await res.json();
        // Si el mock no tiene OBS-OTP-02 aplicado, este test falla con un
        // mensaje claro que apunta a actualizar validation-driven/MOCK_SERVER.
        expect(
            body.error_subcode,
            'mock-server no emite error_subcode — verificar que validation-driven/MOCK_SERVER tenga OBS-OTP-02 aplicado',
        ).toBe('NO_PREVIOUS_OTP');
    });
});
