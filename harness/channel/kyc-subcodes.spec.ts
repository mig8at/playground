import { test, expect, request } from '@playwright/test';
import { config, expectedSubcodes, fakeScenarios } from '../pkg/config';
import { assertSubcode } from '../pkg/error-shape';
import { dictateBureauMode, dictateTusdatosVerdict, type TusdatosVerdict } from '../pkg/risk-lambda';
import { bureauSources, bureauSourceProblem, type BureauCentral } from '../pkg/loki';

/**
 * OBS-KYC-03 — el backend debe emitir cada sufijo de la familia ONB005 (personal-info) o el
 * subcódigo KYC anidado (TusDatos/Experian) según lo que contesten las centrales.
 *
 * Shape del backend real: HETEROGÉNEO (ver pkg/error-shape.ts). Para personal-info, el sufijo puede
 * llegar concatenado al error_code o en errors/data; en KYC (TusDatos/Experian) puede llegar como
 * `error.code` anidado. `assertSubcode` busca ambos markers como substrings en cualquier parte del body.
 *
 * LAS CENTRALES SE DICTAN AL LAMBDA (F-139). Hasta el 2026-11-03 estas pruebas pedían el veredicto con el
 * encabezado `X-Fake-Scenario` a los drivers «fake» del backend; el backend local ya consulta el lambda de
 * centrales (`*_MOCK_HOST`), así que el encabezado no hacía nada y las pruebas de TusDatos estaban en `fixme`.
 * Ahora cada prueba dicta la respuesta para SU cédula y, además, comprueba en el log que contestó el lambda
 * y no el fixture de respaldo (`bureauSourceProblem`): sin esa marca, un verde no prueba que se ejerció la
 * central. Sólo local (el dictado en qa puede caer en otra copia del lambda, F-245), y en fila: el log se
 * ancla por ventana de tiempo, porque sus líneas no traen la solicitud.
 *
 * El OTP sigue con su driver «fake» por decisión de F-139: no es una central.
 */
test.describe.configure({ mode: 'serial' });

/** Un comercio estándar: fuera del pipeline de KYC v2, sin Experian forzado. La cascada de identidad corre entera. */
const STANDARD_HASH = process.env.E2E_KYC_STANDARD_HASH || '802df3ce';   // Tu Colchón (112) en la base local
/** Un comercio que dispara Experian (`experian_trigger_allieds`): Pullman. */
const EXPERIAN_HASH = config.partnerHash;

test.describe('OBS-KYC-03 — sufijos de ONB005 / KYC', () => {
    test.skip(String(process.env.E2E_TARGET || 'local') !== 'local', 'dicta al lambda local: sólo vale en local');

    const phoneUrl = `/api/onboarding/phone/register`;

    function uniquePhone(): string {
        return `300${Math.floor(Math.random() * 10_000_000).toString().padStart(7, '0')}`;
    }

    function uniqueDoc(): string {
        // El front valida `10000 < doc < 3_000_000_000`.
        return Math.floor(Math.random() * 2_899_999_999 + 100_000_000).toString();
    }

    /** El formulario de datos personales como lo manda hoy el asistente (con la fecha de nacimiento y el estrato,
     *  que el backend exige). Sin ellos el rechazo es `BIRTH_DATE_INVALID` y la prueba no llega a la central. */
    function personalInfo(doc: string, over: Record<string, unknown> = {}) {
        return {
            document_type: 'CC', document_number: doc, name: 'JUAN', surname: 'PEREZ',
            email: `juan${doc}@example.com`,
            expedition_day: 10, expedition_month: 5, expedition_year: 2019,
            birth_day: 10, birth_month: 5, birth_year: 2001, stratum: 3,
            ...over,
        };
    }

    /**
     * Avanza el estado hasta tener un user_request_id sobre el cual probar /personal-info.
     * `success:false` + `ONB002` (usuario temporal) es lo normal acá: «ir a /personal-info» con el id.
     */
    async function setupUserRequest(api: import('@playwright/test').APIRequestContext, phone: string,
        hash = config.partnerHash): Promise<number> {
        await api.post(phoneUrl, { data: { phone_number: phone, otp_length: 4, terms: true, policies: true } });
        const otpRes = await api.post(`/api/onboarding/loan-application/otp-validate/${hash}`, {
            data: { cell_phone: phone, otp_code: '0000', original_amount: 1_000_000, amount: 1_000_000 },
            headers: { 'X-Fake-Scenario': fakeScenarios.otp.success },
        });
        const body = await otpRes.json();
        const id = body?.payload?.user_request_id ?? body?.data?.user_request_id
            ?? body?.data?.payload?.user_request_id ?? body?.errors?.payload?.user_request_id;
        if (typeof id !== 'number') {
            throw new Error(`No pude extraer user_request_id — respuesta: ${JSON.stringify(body).slice(0, 400)}`);
        }
        return id;
    }

    /** Que la(s) central(es) contestaron desde el lambda entre `from` y ahora. Espera a que el log llegue a Loki. */
    async function expectAnsweredByLambda(from: number, centrals: BureauCentral[]): Promise<void> {
        await new Promise((r) => setTimeout(r, 4_000));
        const problem = bureauSourceProblem(await bureauSources(from - 1_000, Date.now() + 1_000), centrals);
        expect(problem, problem ?? '').toBeNull();
    }

    test('fecha imposible (31/02/2010) → ONB005 + EXPEDITION_DATE_INVALID', async () => {
        const api = await request.newContext({ baseURL: config.mockUrl });
        const userRequestId = await setupUserRequest(api, uniquePhone());
        const res = await api.post(
            `/api/onboarding/loan-application/personal-info/${config.partnerHash}/${userRequestId}`,
            { data: personalInfo(uniqueDoc(), { expedition_day: 31, expedition_month: 2, expedition_year: 2010 }) },
        );
        const body = await res.json();
        const r = assertSubcode(body, 'ONB005', expectedSubcodes.kyc.expeditionDateInvalid);
        expect(r.ok, r.debug).toBe(true);
    });

    test('documento ya registrado → ONB005 + DOCUMENT_DUPLICATE (o message "document number already in use")', async () => {
        const api = await request.newContext({ baseURL: config.mockUrl });
        const docNumber = uniqueDoc();

        // 1) Primer usuario reserva el documento.
        const firstUserRequestId = await setupUserRequest(api, uniquePhone());
        await api.post(
            `/api/onboarding/loan-application/personal-info/${config.partnerHash}/${firstUserRequestId}`,
            { data: personalInfo(docNumber, { name: 'PRIMERO', surname: 'USUARIO', email: `primero${docNumber}@example.com` }) },
        );

        // 2) Segundo usuario (otro celular) intenta el MISMO documento → rechazo por findByDocumentAndType.
        const secondUserRequestId = await setupUserRequest(api, uniquePhone());
        const res = await api.post(
            `/api/onboarding/loan-application/personal-info/${config.partnerHash}/${secondUserRequestId}`,
            { data: personalInfo(docNumber, { name: 'SEGUNDO', surname: 'USUARIO', email: `segundo${docNumber}@example.com` }) },
        );
        const body = await res.json();
        const r = assertSubcode(body, 'ONB005', expectedSubcodes.kyc.documentDuplicate);
        const messageMarker = typeof body?.message === 'string' && body.message.includes('document number already in use');
        expect(r.ok || messageMarker, `${r.debug} · message=${body?.message ?? ''}`).toBe(true);
    });

    // Los tres veredictos de TusDatos, en un comercio estándar: Ágil Data y Mareigua «sin información» para que la
    // cascada llegue a TusDatos, y TusDatos con la forma que espera el backend (`dictateTusdatosVerdict`).
    //
    // ⚠ «Documento inexistente» NO se puede ejercitar en el modo lambda: TusDatos lo devuelve como HTTP 404, y el
    // backend trata CUALQUIER respuesta no-2xx del lambda como caída y sigue con el fixture de respaldo (`Tusdatos.php`,
    // el `catch` de la llamada al lambda; log `Tusdatos: lambda mock failed, falling back to the local fixture`). Por el
    // camino de PRODUCCIÓN (`TUSDATOS_HOST` al lambda y `TUSDATOS_MOCK_HOST` vacío) sí sale ONB005 + DOCUMENT_NOT_FOUND
    // (medido el 2026-11-03). Queda en `fixme` mientras el backend local corra en el modo lambda.
    const TUSDATOS_CASES: Array<{ verdict: TusdatosVerdict; subcode: string; masked?: string }> = [
        { verdict: 'issue-date-mismatch', subcode: expectedSubcodes.kyc.expeditionDateMismatch },
        { verdict: 'document-not-found', subcode: expectedSubcodes.kyc.documentNotFound,
          masked: 'el backend cae al fixture ante el 404 del lambda: el veredicto no llega' },
        { verdict: 'name-mismatch', subcode: expectedSubcodes.kyc.kycValidationFailed },
    ];
    for (const { verdict, subcode, masked } of TUSDATOS_CASES) {
        (masked ? test.fixme : test)(`TusDatos ${verdict} (dictado al lambda) → ONB005 + ${subcode}`, async () => {
            const api = await request.newContext({ baseURL: config.mockUrl });
            const doc = uniqueDoc();
            expect(await dictateTusdatosVerdict(doc, verdict), 'el lambda local no tomó el dictado').toBe(true);
            const userRequestId = await setupUserRequest(api, uniquePhone(), STANDARD_HASH);

            const from = Date.now();
            const res = await api.post(
                `/api/onboarding/loan-application/personal-info/${STANDARD_HASH}/${userRequestId}`,
                { data: personalInfo(doc) },
            );
            const body = await res.json();
            // Primero de dónde salió la respuesta: si cayó al fixture, el subcódigo que falte se explica por eso.
            await expectAnsweredByLambda(from, ['tusdatos']);
            const r = assertSubcode(body, 'ONB005', subcode);
            expect(r.ok, r.debug).toBe(true);
        });
    }

    // ⚠ Igual que el 404 de TusDatos: ante un 500 del lambda, `Experian.php` cae al fixture de respaldo (log: «Lambda
    // mock failed, falling back to the local fixture», 2026-11-03). Y la EXPECTATIVA era la equivocada: corrido por el
    // camino de PRODUCCIÓN (con `EXPERIAN_HOST` al lambda y `EXPERIAN_MOCK_HOST` vacío), el 500 sí llega —«performRequest
    // failed», correo de error— y el formulario PASA igual: una caída de Experian no bloquea los datos personales. El
    // ONB030 sólo existía con el driver «fake». Para activarla: correr en ese modo y afirmar que pasa y que el error quedó.
    test.fixme('Experian falla (HTTP 500 dictado al lambda) → el formulario no pasa, y contestó el lambda', async () => {
        const api = await request.newContext({ baseURL: config.mockUrl });
        const doc = uniqueDoc();
        expect((await dictateBureauMode(doc, 'experian', 'fail')).ok, 'el lambda local no tomó el dictado').toBe(true);
        const userRequestId = await setupUserRequest(api, uniquePhone(), EXPERIAN_HASH);

        const from = Date.now();
        const res = await api.post(
            `/api/onboarding/loan-application/personal-info/${EXPERIAN_HASH}/${userRequestId}`,
            { data: personalInfo(doc) },
        );
        const body = await res.json();
        expect(body?.success, JSON.stringify(body).slice(0, 400)).toBe(false);
        await expectAnsweredByLambda(from, ['experian']);
    });
});
