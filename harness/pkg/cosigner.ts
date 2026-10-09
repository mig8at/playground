import { one, exec, appKey, isLocalDb } from './db.ts';
import { synthFill, manualValidation } from './inject.ts';
import { encryptLaravelString } from './laravel-crypt.ts';
import { coSignerPhone } from './phones.ts';

/**
 * EL SUB-FLOW DEL CODEUDOR, compartido por los dos runners (`dev/case.ts` por API y `dev/walk-wizard.ts`
 * por las pantallas del front).
 *
 * Vivía dentro de `case.ts`. Se mudó acá cuando el caminador aprendió a llevar un crédito con codeudor,
 * porque las dos mitades del codeudor —el REGISTRO del teléfono y el resto— las hace distinta gente
 * según el runner: `case.ts` llama a todo por API, y el caminador deja que sea el front (la pantalla
 * `cosigner/phone`) quien registre al codeudor, y sólo hace por API lo que en la vida real hace OTRA
 * persona desde SU celular (aceptar la invitación, dar sus datos, firmar).
 *
 * POR QUÉ ES UN FLUJO APARTE Y NO SE HACE A MANO. Es el camino más frágil de rt=2 —de acá salieron
 * F-150, F-151 y F-153— y era el único que pedía manos: ocho endpoints, dos actores y un token que no
 * viaja por la respuesta.
 *
 * EL ORDEN NO ES NEGOCIABLE: el codeudor tiene que quedar `approved` y en etapa de firma ANTES de que el
 * titular firme, porque el juego de documentos que se genera depende de la política.
 *
 * ⚠ Dos cosas que sólo pasan en LOCAL, y por eso están detrás de `isLocalDb()`:
 *  · el token de invitación no vuelve en la respuesta (viaja por WhatsApp, que en local no sale): se lee
 *    de `cosigners.invitation_token`;
 *  · el AML no corre para nadie en local, y sin esa fila `evaluate-eligibility` devuelve
 *    `evaluated: false` para siempre. Se forja igual que en `dev/inject-aml.ts`, con el `data` CIFRADO
 *    como el cast de Laravel.
 *
 * ⚠ Y el buró del codeudor se inyecta con `userId`, no derivándolo de la solicitud: **comparte la
 * `user_request` del titular**, así que sin eso los datos irían al titular (F-153).
 */

/** Los dos verbos HTTP contra el backend, con el mismo forma que ya tenía `case.ts`. */
export interface CosignerApi {
    get(path: string, extra?: Record<string, string>): Promise<{ status: number; json: any }>;
    post(path: string, body: unknown, extra?: Record<string, string>): Promise<{ status: number; json: any }>;
}

/** Un cliente HTTP mínimo para los runners que no traen el suyo (el caminador). */
export function cosignerApi(base: string, userAgent: string): CosignerApi {
    const call = async (method: 'GET' | 'POST', path: string, body?: unknown, extra: Record<string, string> = {}) => {
        const r = await fetch(`${base}${path}`, {
            method,
            headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': userAgent, ...extra },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(method === 'POST' ? 150_000 : 90_000),
        }).catch((e) => e as Error);
        if (r instanceof Error) return { status: 0, json: { message: String(r.message).slice(0, 120) } };
        const t = await r.text();
        try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: { raw: t.slice(0, 200) } }; }
    };
    return { get: (p, e) => call('GET', p, undefined, e), post: (p, b, e) => call('POST', p, b, e) };
}

export type CosignerResult = { ok: boolean; motivo: string; token?: string; tel?: string };

/** El codeudor que quedó registrado para esta solicitud: su token de invitación. */
export async function invitationToken(ur: number): Promise<string | null> {
    const row = await one<{ t: string }>(
        'SELECT invitation_token t FROM cosigners WHERE user_request_id=? AND is_active=1 ORDER BY id DESC LIMIT 1',
        [ur]).catch(() => null);
    return row?.t ?? null;
}

/**
 * La mitad del codeudor que hace ÉL desde su celular, DESPUÉS de que el titular lo registró: aceptar la
 * invitación, dar sus datos, quedar elegible y entrar a la etapa de firma.
 */
export async function joinAsCosigner(
    ur: number, hash: string, holderPhone: string, amount: number, api: CosignerApi, opts: { manual: boolean },
): Promise<CosignerResult> {
    const { get, post } = api;
    const tel = coSignerPhone(holderPhone);
    const doc = String(2_900_000_000 + ur);

    const token = await invitationToken(ur);
    if (!token) return { ok: false, motivo: 'el codeudor no quedó con token de invitación' };

    // A partir de acá TODO va con el token: es la credencial del codeudor, no hay sesión.
    const withToken = (extra: Record<string, string> = {}) => ({ 'X-Cosigner-Token': token, ...extra });

    const inv = await get(`/api/v1/user-request/cosigner/invitation/${token}`, withToken());
    if (inv.status !== 200) return { ok: false, motivo: `el token de invitación no resolvió (HTTP ${inv.status})` };

    await post('/api/onboarding/phone/register', {
        phone_number: tel, phoneNumber: tel, terms: true, policies: true,
        otp_length: 4, otpLength: 4, partner_branch_hash: hash, partnerBranchHash: hash }, withToken());

    // ⚠ Esto NO crea una solicitud nueva: con el token, el backend devuelve la del TITULAR. Es la
    // señal de que el codeudor se está uniendo y no abriendo su propio crédito.
    const otp = await post(`/api/onboarding/loan-application/otp-validate/${hash}`, {
        cell_phone: tel, otp_code: tel.slice(-4), original_amount: amount, amount }, withToken());
    const urCode = otp.json?.errors?.payload?.user_request_id ?? otp.json?.data?.payload?.user_request_id;
    if (Number(urCode) !== ur) {
        return { ok: false, motivo: `el codeudor abrió otra solicitud (${urCode ?? '—'}) en vez de unirse a ${ur}` };
    }

    const pi = await post(`/api/onboarding/loan-application/personal-info/${hash}/${ur}`, {
        document_type: 'CC', document_number: doc, name: 'ANA', surname: 'GOMEZ',
        email: `qa${doc}@gmail.com`,
        expedition_day: 10, expedition_month: 5, expedition_year: 2019,
        birth_day: 10, birth_month: 5, birth_year: 2001 }, withToken());
    if (pi.json?.success !== true) {
        return { ok: false, motivo: `personal-info del codeudor: ${String(pi.json?.message ?? '').slice(0, 60)}` };
    }

    const uid = await one<{ u: number }>(
        'SELECT cosigner_user_id u FROM cosigners WHERE user_request_id=? AND is_active=1', [ur]).catch(() => null);
    if (!uid?.u) return { ok: false, motivo: 'el codeudor no quedó linkeado a un usuario' };

    // Las dos inyecciones que local exige (ver la cabecera). En una base compartida NO se forja nada: el
    // AML corre de verdad ahí, y escribir en `risk_central_user_data` de otra base pediría el permiso general.
    if (isLocalDb()) {
        const rc = await one<{ id: number }>("SELECT id FROM risk_centrals WHERE name='TusDatos - AML' LIMIT 1").catch(() => null);
        if (rc) {
            await exec('DELETE FROM risk_central_user_data WHERE user_id=? AND risk_central_id=?', [uid.u, rc.id]);
            await exec('INSERT INTO risk_central_user_data (uuid, user_id, risk_central_id, score, data, created_at, updated_at) '
                + 'VALUES (UUID(), ?, ?, 0, ?, NOW(), NOW())',
                [uid.u, rc.id, encryptLaravelString(JSON.stringify({ estado: 'finalizado', hallazgos: [] }), appKey())]);
        }
    }
    await synthFill(ur, { userId: uid.u, income: 4_000_000, score: 780 });

    // El codeudor tiene su PROPIA identidad que resolver: la elegibilidad la evalúa por él, no por el
    // titular. Con `--manual` se le aprueba igual que al titular.
    if (opts.manual) await manualValidation(uid.u);

    const ele = await post(`/api/v1/user-request/${ur}/cosigner/evaluate-eligibility`, {}, withToken());
    const est = ele.json?.data ?? {};
    if (est.cosignerStatus !== 'approved') {
        return { ok: false, motivo: `el codeudor quedó ${est.cosignerStatus ?? '—'}`
            + (est.evaluated === false ? ' y NO se evaluó (¿le falta AML o identidad?)' : '') };
    }

    const stage = await post(`/api/v1/user-request/${ur}/cosigner/enter-signature-stage`, {}, withToken());
    if (stage.status !== 200) return { ok: false, motivo: `enter-signature-stage HTTP ${stage.status}` };

    return { ok: true, motivo: 'codeudor aprobado y en etapa de firma', token, tel };
}

/**
 * El codeudor por API completo: lo que el titular hace en `cosigner/phone` (arrancar el flujo y registrar
 * el celular) y después su mitad. Es lo que usa `case.ts`, que no pasa por el front.
 */
export async function resolveCoSigner(
    ur: number, hash: string, holderPhone: string, amount: number, api: CosignerApi, opts: { manual: boolean },
): Promise<CosignerResult> {
    const tel = coSignerPhone(holderPhone);
    const ini = await api.post(`/api/v1/user-request/${ur}/cosigner-flow/start`, {});
    if (ini.status !== 200) return { ok: false, motivo: `cosigner-flow/start HTTP ${ini.status}` };

    const reg = await api.post(`/api/v1/user-request/${ur}/cosigner`, { cellPhone: tel });
    if (reg.status !== 200) return { ok: false, motivo: `registrar codeudor HTTP ${reg.status}` };

    return joinAsCosigner(ur, hash, holderPhone, amount, api, opts);
}

/** La firma del codeudor, DESPUÉS de la del titular. Cierra el crédito de verdad. */
export async function coSignerSignature(token: string, api: CosignerApi): Promise<{ ok: boolean; motivo: string }> {
    const { get, post } = api;
    const withToken = { 'X-Cosigner-Token': token };
    const V = '/api/v1/user-request/cosigner/signature';

    await get(`${V}/context`, withToken);
    await get(`${V}/documents`, withToken);

    const env = await post(`${V}/otp`, {}, withToken);
    if (env.status !== 200) {
        return { ok: false, motivo: `el OTP de firma del codeudor falló (${env.json?.code ?? env.status})`
            + ' — si es URV25003, mirá `OTP_SERVICE_HOST` (F-151)' };
    }
    // ⚠ El campo se llama `otp`, no `code`: con `code` responde URV27002 «datos de entrada».
    const see = await post(`${V}/otp/verify`, { otp: '123456' }, withToken);
    if (see.json?.code !== 'URV27000') {
        return { ok: false, motivo: `verify del codeudor: ${see.json?.code ?? see.status} ${String(see.json?.message ?? '').slice(0, 50)}` };
    }
    return { ok: true, motivo: `firmado · ${see.json?.data?.cosignerStatus ?? ''}` };
}
