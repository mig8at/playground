import { test, expect, request } from '@playwright/test';
import { config, expectedSubcodes, fakeScenarios } from '../pkg/config';
import { assertSubcode } from '../pkg/error-shape';

/**
 * OBS-KYC-03 — el backend debe emitir cada sufijo de la familia ONB005 (personal-info) o el
 * subcódigo KYC anidado (TusDatos/Experian) cuando se le inyecta el escenario correspondiente
 * o cuando recibe input que viola el guard (fecha imposible, documento duplicado).
 *
 * Shape del backend real: HETEROGÉNEO (ver docs/REFERENCIA-FLUJOS.md [histórico: git show 159906a:docs/REFERENCIA-FLUJOS.md] §13 y pkg/error-shape.ts).
 * Para personal-info, el sufijo puede llegar concatenado al error_code o en errors/data; en KYC
 * (TusDatos/Experian) puede llegar como `error.code` anidado. `assertSubcode` busca ambos markers
 * como substrings en cualquier parte del body — misma estrategia que backend-e2e::negative.go.
 *
 * Estado tras la reescritura (backlog #2):
 *   - 2 activos (✅ evidencia VERDE en backend-e2e::negative.go):
 *     EXPEDITION_DATE_INVALID (31-feb · checkdate), DOCUMENT_DUPLICATE (segundo intento mismo doc).
 *   - 4 fixme con razón concreta: usan escenarios `kyc-*` del mock viejo :4000. Migrados a los
 *     nombres reales del backend (`issue-date-mismatch`, `document-not-found`, `name-mismatch`,
 *     `server-error`) vía pkg/config.ts::fakeScenarios.tusdatos, pero no verificados extremo a
 *     extremo: requieren TusDatos en modo fake (`ONBOARDING_DRIVER_TUSDATOS=fake`) +
 *     ONBOARDING_FAKES_ALLOW_HEADER=true. Activar cuando el setup local los confirme.
 */
test.describe('OBS-KYC-03 — sufijos de ONB005 / KYC', () => {
    const phoneUrl = `/api/onboarding/phone/register`;
    const validateOtpUrl = `/api/onboarding/loan-application/otp-validate/${config.partnerHash}`;

    function uniquePhone(): string {
        return `300${Math.floor(Math.random() * 10_000_000).toString().padStart(7, '0')}`;
    }

    function uniqueDoc(): string {
        // FE validates `10000 < doc < 3_000_000_000`. Constrain generation a ese rango.
        return Math.floor(Math.random() * 2_899_999_999 + 100_000_000).toString();
    }

    /**
     * Avanza el estado hasta tener un user_request_id válido sobre el cual probar /personal-info.
     *
     * Shape observado en el backend real (heterogéneo según código):
     *   - `success: true` (no-temporal) → `data.payload.user_request_id` (o similar).
     *   - `success: false` + `error_code: "ONB002"` (temporal, normal en este flujo) →
     *     `errors.payload.user_request_id`. ONB002 ≠ fallo: indica "ir a /personal-info" con el id.
     * Buscamos en todos los lugares conocidos antes de fallar.
     */
    async function setupUserRequest(
        api: import('@playwright/test').APIRequestContext,
        phone: string,
    ): Promise<number> {
        await api.post(phoneUrl, {
            data: { phone_number: phone, otp_length: 4, terms: true, policies: true },
        });
        const otpRes = await api.post(validateOtpUrl, {
            data: { cell_phone: phone, otp_code: '0000', original_amount: 1_000_000, amount: 1_000_000 },
            headers: { 'X-Fake-Scenario': fakeScenarios.otp.success },
        });
        const body = await otpRes.json();
        const id =
            body?.payload?.user_request_id ??
            body?.data?.user_request_id ??
            body?.data?.payload?.user_request_id ??
            body?.errors?.payload?.user_request_id;
        if (typeof id !== 'number') {
            throw new Error(`No pude extraer user_request_id — respuesta: ${JSON.stringify(body).slice(0, 400)}`);
        }
        return id;
    }

    test('fecha imposible (31/02/2010) → ONB005 + EXPEDITION_DATE_INVALID', async () => {
        const api = await request.newContext({ baseURL: config.mockUrl });
        const phone = uniquePhone();
        const userRequestId = await setupUserRequest(api, phone);

        const res = await api.post(
            `/api/onboarding/loan-application/personal-info/${config.partnerHash}/${userRequestId}`,
            {
                data: {
                    document_type: 'CC',
                    document_number: uniqueDoc(),
                    name: 'JUAN',
                    surname: 'PEREZ',
                    email: `juan${Date.now()}@example.com`,
                    expedition_day: 31,
                    expedition_month: 2, // febrero no tiene 31 → checkdate() rechaza
                    expedition_year: 2010,
                },
            },
        );
        const body = await res.json();
        const r = assertSubcode(body, 'ONB005', expectedSubcodes.kyc.expeditionDateInvalid);
        expect(r.ok, r.debug).toBe(true);
    });

    test('documento ya registrado → ONB005 + DOCUMENT_DUPLICATE (o message "document number already in use")', async () => {
        const api = await request.newContext({ baseURL: config.mockUrl });
        const docNumber = uniqueDoc();

        // 1) Primer usuario reserva el documento sin problema (escenario success).
        const firstPhone = uniquePhone();
        const firstUserRequestId = await setupUserRequest(api, firstPhone);
        await api.post(
            `/api/onboarding/loan-application/personal-info/${config.partnerHash}/${firstUserRequestId}`,
            {
                data: {
                    document_type: 'CC', document_number: docNumber,
                    name: 'PRIMERO', surname: 'USUARIO', email: `primero${Date.now()}@example.com`,
                    expedition_day: 1, expedition_month: 1, expedition_year: 2010,
                },
                headers: { 'X-Fake-Scenario': fakeScenarios.tusdatos.success },
            },
        );

        // 2) Segundo usuario (otro celular) intenta el MISMO documento → rechazo por findByDocumentAndType.
        const secondPhone = uniquePhone();
        const secondUserRequestId = await setupUserRequest(api, secondPhone);
        const res = await api.post(
            `/api/onboarding/loan-application/personal-info/${config.partnerHash}/${secondUserRequestId}`,
            {
                data: {
                    document_type: 'CC', document_number: docNumber,
                    name: 'SEGUNDO', surname: 'USUARIO', email: `segundo${Date.now()}@example.com`,
                    expedition_day: 1, expedition_month: 1, expedition_year: 2010,
                },
            },
        );
        const body = await res.json();
        // El backend real puede emitir el marker como sufijo O como mensaje "document number already in use"
        // — `assertSubcode` busca el sufijo como substring en cualquier parte; también vale el message.
        const r = assertSubcode(body, 'ONB005', expectedSubcodes.kyc.documentDuplicate);
        const messageMarker = typeof body?.message === 'string' && body.message.includes('document number already in use');
        expect(r.ok || messageMarker, `${r.debug} · message=${body?.message ?? ''}`).toBe(true);
    });

    test('X-Fake-Scenario: server-error (Experian) → ONB030 internal server error', async () => {
        // Hallazgo en validación E2E: el escenario `server-error` (driver Experian) produce
        // ONB030 ("internal server error") en personal-info — NO ONB005. ONB030 es un code NUEVO
        // (no estaba en docs antes); también aparece con `timeout` y `no-hit`. Ver REFERENCIA-FLUJOS.md §13.
        const api = await request.newContext({ baseURL: config.mockUrl });
        const phone = uniquePhone();
        const userRequestId = await setupUserRequest(api, phone);

        const res = await api.post(
            `/api/onboarding/loan-application/personal-info/${config.partnerHash}/${userRequestId}`,
            {
                data: {
                    document_type: 'CC', document_number: uniqueDoc(),
                    name: 'JUAN', surname: 'PEREZ', email: `juan${Date.now()}@example.com`,
                    expedition_day: 1, expedition_month: 1, expedition_year: 2010,
                },
                headers: { 'X-Fake-Scenario': fakeScenarios.experian.serverError },
            },
        );
        const body = await res.json();
        const r = assertSubcode(body, 'ONB030', 'internal server error');
        expect(r.ok, r.debug).toBe(true);
    });

    test.fixme('X-Fake-Scenario: issue-date-mismatch → ONB005 + EXPEDITION_DATE_MISMATCH', async () => {
        // ⏸️ El partner por defecto (3e67eade = Pullman, allied 94) ejecuta Experian Quanto,
        // no TusDatos — los escenarios `issue-date-mismatch`/`name-mismatch`/etc. devuelven
        // success:true (no aplican). Para activar: usar un partner_hash ESTÁNDAR (no
        // Pullman/Corbeta/Motai) + ONBOARDING_DRIVER_TUSDATOS=fake + ONBOARDING_FAKES_ALLOW_HEADER=true.
        const api = await request.newContext({ baseURL: config.mockUrl });
        const phone = uniquePhone();
        const userRequestId = await setupUserRequest(api, phone);

        const res = await api.post(
            `/api/onboarding/loan-application/personal-info/${config.partnerHash}/${userRequestId}`,
            {
                data: {
                    document_type: 'CC', document_number: uniqueDoc(),
                    name: 'JUAN', surname: 'PEREZ', email: `juan${Date.now()}@example.com`,
                    expedition_day: 1, expedition_month: 1, expedition_year: 2010,
                },
                headers: { 'X-Fake-Scenario': fakeScenarios.tusdatos.issueDateMismatch },
            },
        );
        const body = await res.json();
        const r = assertSubcode(body, 'ONB005', expectedSubcodes.kyc.expeditionDateMismatch);
        expect(r.ok, r.debug).toBe(true);
    });

    test.fixme('X-Fake-Scenario: document-not-found → DOCUMENT_NOT_FOUND', async () => {
        // ⏸️ Pullman usa Experian, no TusDatos — escenario no aplica. Ver fixme anterior.
        const api = await request.newContext({ baseURL: config.mockUrl });
        const phone = uniquePhone();
        const userRequestId = await setupUserRequest(api, phone);

        const res = await api.post(
            `/api/onboarding/loan-application/personal-info/${config.partnerHash}/${userRequestId}`,
            {
                data: {
                    document_type: 'CC', document_number: uniqueDoc(),
                    name: 'JUAN', surname: 'PEREZ', email: `juan${Date.now()}@example.com`,
                    expedition_day: 1, expedition_month: 1, expedition_year: 2010,
                },
                headers: { 'X-Fake-Scenario': fakeScenarios.tusdatos.documentNotFound },
            },
        );
        const body = await res.json();
        // En KYC el sufijo puede llegar como `error.code` anidado — la búsqueda tolerante lo cubre.
        const r = assertSubcode(body, 'ONB005', expectedSubcodes.kyc.documentNotFound);
        expect(r.ok, r.debug).toBe(true);
    });

    test.fixme('X-Fake-Scenario: name-mismatch → KYC_VALIDATION_FAILED', async () => {
        // ⏸️ Pullman usa Experian, no TusDatos — escenario no aplica.
        const api = await request.newContext({ baseURL: config.mockUrl });
        const phone = uniquePhone();
        const userRequestId = await setupUserRequest(api, phone);

        const res = await api.post(
            `/api/onboarding/loan-application/personal-info/${config.partnerHash}/${userRequestId}`,
            {
                data: {
                    document_type: 'CC', document_number: uniqueDoc(),
                    name: 'JUAN', surname: 'PEREZ', email: `juan${Date.now()}@example.com`,
                    expedition_day: 1, expedition_month: 1, expedition_year: 2010,
                },
                headers: { 'X-Fake-Scenario': fakeScenarios.tusdatos.nameMismatch },
            },
        );
        const body = await res.json();
        const r = assertSubcode(body, 'ONB005', expectedSubcodes.kyc.kycValidationFailed);
        expect(r.ok, r.debug).toBe(true);
    });

    // (eliminado: el test antiguo "server-error → ONB005 + PROVIDER_ERROR" no aplica al backend
    // real — `server-error` produce ONB030, no un sufijo de ONB005. Reemplazado por el test
    // ACTIVO de arriba que valida ONB030.)
});
