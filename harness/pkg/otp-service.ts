// otp-service.ts — el CÓDIGO del OTP de un teléfono de prueba en la base compartida, leído del servicio de OTP.
//
// En dev, qa y staging el OTP no se bypassea: el servicio de OTP lo genera y `messaging-service`, en modo QA, lo publica
// en Slack (#qa-messages) en vez de mandarlo al operador. El código queda en el servicio, y el servicio lo expone en dos
// lecturas «de auditoría» (`otp-service`, `internal/infra/handlers/otp/module.go`): `POST /api/otp/latest` (el último
// del teléfono, con su `created_at` y el código cifrado) y `POST /api/otp/decrypt` (el código, por teléfono y
// `created_at`; cada llamada queda en los logs del servicio). Es lo mismo que una persona copia de Slack.
//
// ⚠ El bypass por teléfono (`qa_otp_bypass_phones`) es el mecanismo VIEJO y con él el código no llega al servicio: con un
// comercio del pipeline de KYC el OTP no pasa (F-243). Por eso el panel usa en la compartida teléfonos FUERA de esa lista.
// ⚠ Sólo se piden los códigos de los teléfonos del propio panel. Nunca de otro.
// ⚠ El servicio es interno: se llega con la VPN de dev (`otp-service.inertia-develop:8083`, medido el 2026-10-21).

const BASE = process.env.OTP_SERVICE_URL || 'http://otp-service.inertia-develop:8083';

export interface OtpRecord { createdAt: string; createdMs: number; status: string; template: string; codeLength: number }

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
    const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
    let json: any = null;
    try { json = await r.json(); } catch { /* cuerpo vacío */ }
    return { status: r.status, json };
}

/** El último OTP que el servicio generó para ese teléfono, sin el código. null si no tiene ninguno. */
export async function latestOtp(phone: string): Promise<OtpRecord | null> {
    const { status, json } = await post('/api/otp/latest', { identifier: phone });
    if (status === 404) return null;
    if (status !== 200 || !json?.created_at) throw new Error(`el servicio de OTP contestó ${status}${json?.message ? ': ' + json.message : ''}`);
    return { createdAt: String(json.created_at), createdMs: Date.parse(json.created_at), status: String(json.status || ''), template: String(json.template || ''), codeLength: Number(json.code_length) || 0 };
}

/** El código de UN OTP, por su teléfono y su `created_at` exacto (el de `latestOtp`). */
export async function revealOtp(phone: string, createdAt: string): Promise<string> {
    const { status, json } = await post('/api/otp/decrypt', { identifier: phone, created_at: createdAt });
    if (status !== 200 || !json?.code) throw new Error(`el servicio de OTP no reveló el código (${status}${json?.message ? ': ' + json.message : ''})`);
    return String(json.code);
}

/** Espera un OTP generado DESPUÉS de `sinceMs` para ese teléfono y devuelve su código. null si no llega a tiempo. */
export async function waitForOtp(phone: string, sinceMs: number, timeoutMs = 40_000): Promise<{ code: string; record: OtpRecord } | null> {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
        const rec = await latestOtp(phone).catch(() => null);
        if (rec && rec.createdMs > sinceMs) return { code: await revealOtp(phone, rec.createdAt), record: rec };
        await new Promise((r) => setTimeout(r, 1_500));
    }
    return null;
}
