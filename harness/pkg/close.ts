// close.ts — CIERRE de Creditop X (rt=2) hasta Estado 11 por la SECUENCIA BACKEND (port 1:1 de
// backend-e2e/lender/lender.go::creditopXSteps). NO usa la UI ni ADO: el authorize del backend no exige
// la validación de identidad (ADO es un gate del front). Fuerza el estado final cargando lo necesario en
// la DB + 3 llamadas API:
//   1. selección + perfil aprobado  → UPDATE user_requests (lender/rate/cuotas)  [el perfil ya lo sembró synthFill]
//   2. pagaré                        → GET  /loans/requests/promissory-note/{uReqID}
//   3. firma (OTP)                   → POST /loans/requests/promissory-note/validate/send-otp  +  forceOtp (DB)
//   4. autorización → Estado 11      → POST /loans/requests/promissory-note/validate/authorize {user_request_id, otp_id}
// Verifica user_request_status_id=11 (mismo criterio que backend-e2e). Tras esto el backend dispara el
// webhook a la tienda; se verifica aparte. Best-effort + logueado: cada paso reporta el HTTP/estado.
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { exec, scalar, one, env, assertWriteAllowed } from './db.ts';
import { requestEstado11 } from './inject.ts';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';
const apiBase = (): string => {
    // E2E_API_BASE_URL (dev) o, si no está (p.ej. .env.local solo trae E2E_MOCK_URL), {E2E_MOCK_URL}/api.
    const explicit = env('E2E_API_BASE_URL');
    const baseUrl = explicit || `${env('E2E_MOCK_URL', 'http://legacy-backend.inertia-develop').replace(/\/$/, '')}/api`;
    return baseUrl.replace(/\/$/, '');
};

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
    const res = await fetch(`${apiBase()}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
    return { status: res.status, json };
}

/** Dispara la notificación al comercio por la vía del backend (POST notify-store → processEcommerceTransaction,
 *  lender-agnóstica). Para lenders externos (rt=0/1) el webhook NO sale por el authorize in-platform. */
async function fireEcommerceWebhook(uReqID: number, status: string): Promise<{ erId: number | null; httpStatus: number | null; note?: string }> {
    const erId = (await scalar<number>('SELECT ecommerce_request_id FROM user_requests_by_ecommerce_request WHERE user_request_id=? ORDER BY id DESC LIMIT 1', [uReqID])) ?? null;
    if (!erId) return { erId: null, httpStatus: null, note: 'sin ecommerce_request linkeado al user_request' };
    const amount = (await scalar<number>('SELECT COALESCE(final_amount, amount, 0) FROM user_requests WHERE id=?', [uReqID])) ?? 0;
    const res = await api('POST', '/onboarding/ecommerce-request/notify-store', { ecommerceRequestId: erId, status, amount, userRequestId: uReqID });
    return { erId, httpStatus: res.status, note: res.status >= 400 ? JSON.stringify(res.json).slice(0, 200) : undefined };
}

export interface CloseResult { trace: string[]; statusId: number | null; sealed11: boolean; }

/** Cierra Creditop X (rt=2) hasta Estado 11 por la secuencia backend (sin UI/ADO). uReqID + lender objetivo. */
export async function closeCreditopX(uReqID: number, opts: { lender?: string } = {}): Promise<CloseResult> {
    const trace: string[] = [];
    const log = (m: string) => { trace.push(m); console.log(`      · ${m}`); };
    assertWriteAllowed();

    // El lender NO se hardcodea. Si lo pasan (modo `close` del sweep) se resuelve por id/nombre; si NO
    // (safety-net del guiado, `{}`) se usa el que YA tiene el user_request — el que el usuario eligió en
    // /lenders, leído de la BD. El default viejo (`credipullman`) pisaba el lender real de OTROS comercios
    // (ej. Motai) con uno ajeno: corrompía el flujo y el análisis por producto (Ábaco lee lender.product).
    const lender = opts.lender
        ? await one<{ id: number; rt: number }>(
            'SELECT id, response_type AS rt FROM lenders WHERE status=1 AND (CAST(id AS CHAR)=? OR name LIKE ?) ORDER BY id LIMIT 1',
            [opts.lender, '%' + opts.lender + '%'],
        )
        : await one<{ id: number; rt: number }>(
            'SELECT l.id, l.response_type AS rt FROM user_requests ur JOIN lenders l ON l.id = ur.lender_id WHERE ur.id = ?',
            [uReqID],
        );
    if (!lender?.id) {
        log(opts.lender
            ? `no resolví el lender ${JSON.stringify(opts.lender)}`
            : `el user_request ${uReqID} no tiene lender_id — no hardcodeo un default, no cierro`);
        return { trace, statusId: null, sealed11: false };
    }
    const lenderId = lender.id;
    // El cierre in-platform (pagaré→firma→authorize→Estado 11) es EXCLUSIVO de Creditop X (rt=2). Para rt=0
    // (estándar/UTM) y rt=1 (integración: la API externa del lender decide), el resultado NO se sella acá:
    // no tocamos la DB y reportamos el estado tal cual (el flujo externo del lender define el desenlace).
    if (lender.rt !== 2) {
        const st = await requestEstado11(uReqID);
        log(`lender #${lenderId} es rt=${lender.rt} (no Creditop X) → sin cierre in-platform; estado=${st.statusId ?? '?'} (lo define el flujo externo del lender)`);
        // lenders externos (rt=0/1): el webhook NO se dispara por el authorize in-platform. Si hay receptor
        // configurado (E2E_WEBHOOK_URL), lo disparamos por notify-store (lender-agnóstico) para PROBAR la entrega.
        if (process.env.E2E_WEBHOOK_URL) {
            const n = await fireEcommerceWebhook(uReqID, 'completed');
            log(`webhook notify-store: HTTP ${n.httpStatus ?? '?'} (ecommerce_request #${n.erId ?? '?'})${n.note ? ` ⚠ ${n.note}` : ''}`);
        }
        return { trace, statusId: st.statusId, sealed11: st.sealed11 };
    }

    const phone = (await scalar<string>(
        'SELECT u.cell_phone FROM user_requests ur JOIN users u ON u.id=ur.user_id WHERE ur.id=?',
        [uReqID],
    )) || (process.env.E2E_OTP_BYPASS_PHONE ?? '3131010101');

    // 1. selección de lender + perfil aprobado (el perfil/KYC ya lo sembró synthFill). Valores de #77 (rt=2).
    await exec('UPDATE user_requests SET lender_id=?, rate=2.1, fee_number=12, initial_fee=0, status=1 WHERE id=?', [lenderId, uReqID]);
    log(`lender #${lenderId} fijado (rate 2.1 · 12 cuotas · cuota inicial 0)`);

    // 2. pagaré (promissory-note) — el backend arma el PDF (PdfMapper).
    const pn = await api('GET', `/loans/requests/promissory-note/${uReqID}`);
    log(`pagaré: HTTP ${pn.status}${pn.status >= 400 ? ` ⚠ ${JSON.stringify(pn.json).slice(0, 200)}` : ''}`);

    // 3. firma: send-otp + forzar el OTP validado (saltar Twilio).
    const so = await api('POST', '/loans/requests/promissory-note/validate/send-otp', { user_request_id: uReqID });
    log(`send-otp: HTTP ${so.status}`);
    await exec('UPDATE otps SET validated=1 WHERE cell_phone=? ORDER BY id DESC LIMIT 1', [phone]);
    const otpId = (await scalar<number>('SELECT id FROM otps WHERE cell_phone=? ORDER BY id DESC LIMIT 1', [phone])) ?? 0;
    log(`otp #${otpId || '?'} forzado validado (tel ${phone})`);

    // 4. autorización → Estado 11.
    const az = await api('POST', '/loans/requests/promissory-note/validate/authorize', { user_request_id: uReqID, otp_id: otpId });
    log(`authorize: HTTP ${az.status}${az.status >= 400 ? ` ⚠ ${JSON.stringify(az.json).slice(0, 200)}` : ''}`);

    // 5. verificar Estado 11 (user_request_status_id=11, mismo criterio que backend-e2e).
    const st = await requestEstado11(uReqID);
    log(`estado final: user_request_status_id=${st.statusId ?? '?'}${st.sealed11 ? ' → Estado 11 ✓' : ''}`);
    return { trace, statusId: st.statusId, sealed11: st.sealed11 };
}

export interface UiSelectResult { advanced: boolean; landing: string; note: string; }

/**
 * Paso VISUAL (preview/headed): maneja la UI real del marketplace como un humano — elige cuotas/plazo,
 * (cuota inicial si la pide) y clickea "Validar Pre aprobado" del lender. Dispara el selectLender real;
 * para Creditop X (rt=2) el backend responde standBy → el wizard redirige a /confirmation (FIX A).
 * Best-effort y nunca lanza: si algo de la UI no está, lo nota y el cierre por API toma el relevo.
 * Hasta acá se puede mostrar; lo que sigue (ADO/identidad) no es automatizable, lo sella el authorize.
 */
export async function driveLenderSelectionUI(page: Page, opts: { lender: string; shotDir?: string }): Promise<UiSelectResult> {
    const shot = async (n: string) => { if (opts.shotDir) await page.screenshot({ path: join(opts.shotDir, n), fullPage: true }).catch(() => {}); };
    const before = new URL(page.url()).pathname;
    const ctaRx = /validar pre.?aprobado|activar mi cr[eé]dito/i;
    // id + nombre DISPLAY del lender (para el testid del toggle Y para matchear el texto del marketplace).
    // El marketplace muestra el nombre CON acentos ("Sistecrédito"); armar el regex del slug sin acento
    // ("sistecredito") NO matchea (regex JS es accent-sensitive). El LIKE de MySQL sí es accent-insensitive
    // (collation) → resolvemos el nombre real y armamos el rx con \p{L} (unicode, flag u) para conservar la é.
    const lrow = await one<{ id: number; name: string }>('SELECT id, name FROM lenders WHERE status=1 AND (CAST(id AS CHAR)=? OR name LIKE ?) ORDER BY id LIMIT 1', [opts.lender, '%' + opts.lender + '%']).catch(() => null);
    const lid = lrow?.id ?? null;
    const rx = new RegExp((lrow?.name ?? opts.lender).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean).join('.*'), 'iu');
    await shot('ui-01-lenders.png');

    // 1. ubicar el lender OBJETIVO por nombre (puede NO ser el recomendado: estar más abajo y colapsado).
    const name = page.getByText(rx).first();
    if (!(await name.isVisible({ timeout: 8000 }).catch(() => false))) {
        await shot('ui-04-sincard.png');
        return { advanced: false, landing: before, note: `no encontré la tarjeta de "${opts.lender}" en el marketplace` };
    }
    await name.scrollIntoViewIfNeeded().catch(() => {});
    // tarjeta del lender objetivo = contenedor con SU nombre + un CTA (scope para NO tocar el recomendado).
    const cardOf = () => page.locator('div').filter({ hasText: rx }).filter({ has: page.getByRole('button', { name: ctaRx }) }).last();
    let cta = cardOf().getByRole('button', { name: ctaRx }).first();
    if (!(await cta.isVisible({ timeout: 1500 }).catch(() => false))) {
        // colapsado (ej. "Otras opciones disponibles") → expandir. Preferimos el data-testid del toggle
        // (lender-toggle-{id}); si no está (deploy sin el testid), fallback al header-button por texto.
        const byTestId = lid ? page.getByTestId(`lender-toggle-${lid}`).first() : null;
        const header = byTestId && (await byTestId.isVisible({ timeout: 2500 }).catch(() => false))
            ? byTestId
            : page.getByRole('button').filter({ hasText: rx }).first();
        await header.scrollIntoViewIfNeeded().catch(() => {});
        await header.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(900);
        cta = cardOf().getByRole('button', { name: ctaRx }).first();
        await cta.scrollIntoViewIfNeeded().catch(() => {});
    }
    await shot('ui-02-card.png');

    // 2. cuota inicial (solo si la pide y está vacía) — best-effort; los rt=0/rt=1 no la exigen.
    const fee = page.locator('#initial-fee-input');
    if (await fee.isVisible({ timeout: 1500 }).catch(() => false)) {
        const cur = await fee.inputValue().catch(() => '');
        if (!/\d/.test(cur)) {
            const minTxt = await page.getByText(/cuota inicial m[ií]nima/i).first().textContent({ timeout: 1500 }).catch(() => '');
            const minVal = (minTxt?.match(/(\d[\d.,]*)/)?.[1] ?? '90000').replace(/[.,]/g, '');
            await fee.click().catch(() => {});
            await fee.fill(minVal).catch(() => {});
        }
    }
    await shot('ui-03-seleccion.png');

    // 3. clickear el CTA DENTRO de la tarjeta del lender objetivo (dispara el selectLender real de ESE lender).
    if (!(await cta.isVisible({ timeout: 3000 }).catch(() => false))) {
        await shot('ui-04-sincta.png');
        return { advanced: false, landing: before, note: `no encontré el botón de selección de "${opts.lender}"` };
    }
    await cta.scrollIntoViewIfNeeded().catch(() => {});
    await cta.click({ timeout: 5000 }).catch(() => {});

    // 4. esperar la respuesta: navegación fuera de /lenders (→ /confirmation por FIX A, o externo) o modal.
    await Promise.race([
        page.waitForURL((u) => !u.pathname.includes('/lenders'), { timeout: 15000 }).catch(() => { }),
        page.getByRole('dialog').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => { }),
    ]);
    await page.waitForTimeout(1200);
    await shot('ui-05-tras-seleccion.png');

    const after = new URL(page.url()).pathname;
    const dialog = await page.getByRole('dialog').first().isVisible().catch(() => false);
    const advanced = after !== before || dialog;
    return { advanced, landing: dialog ? `${after} (modal)` : after, note: advanced ? 'selección enviada por UI' : 'el CTA no avanzó (sigue por API)' };
}

/** Simula el webhook de finalización de un AGREGADOR (Bancolombia/Sistecrédito/…) vía el endpoint
 *  /simulator/aggregator-result de legacy: cambia el estado del user_request por Eloquent → dispara el
 *  UserRequestObserver (igual que el webhook real entrante). El endpoint vive en la RAÍZ (webhooks.php),
 *  NO bajo /api → trimeamos el sufijo /api del base. Lo usa el demo split-view (modo aggregator). */
export async function simulateAggregatorResult(uReqID: number, status: number): Promise<{ status: number; json: unknown }> {
    const root = apiBase().replace(/\/api$/, '');
    const res = await fetch(`${root}/simulator/aggregator-result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ user_request_id: uReqID, status }),
    });
    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
    return { status: res.status, json };
}

/** Setea el estado final del user_request de forma ROBUSTA para el demo (success/rejected/pending).
 *  Intenta primero el simulador de agregador (que dispara el observer → notifica al COMERCIO), pero ese
 *  endpoint EXIGE un ecommerce_request vinculado (EcommerceSimulatorController:48-51) y SOLO acepta estados
 *  FINALES [6,7,8,11]. En el flujo ASESOR no hay link (→ 422) y `pending` (10) no es final (→ 422 incluso en
 *  ecommerce). En cualquiera de esos casos caemos a un UPDATE directo por DB (sin observer; ok para el demo,
 *  porque B muestra el resultado por la URL del lender-result, no por el webhook). Devuelve la vía usada. */
export async function resolveRequestStatus(uReqID: number, statusId: number): Promise<{ via: 'simulator' | 'db'; httpStatus: number | null; statusId: number; note?: string }> {
    assertWriteAllowed();
    const FINAL = [6, 7, 8, 11];
    if (FINAL.includes(statusId)) {
        const sim = await simulateAggregatorResult(uReqID, statusId);
        if (sim.status >= 200 && sim.status < 300) return { via: 'simulator', httpStatus: sim.status, statusId };
        // 422 típico: user_request sin ecommerce_request (flujo asesor) → UPDATE directo.
        await exec('UPDATE user_requests SET user_request_status_id=? WHERE id=?', [statusId, uReqID]);
        return { via: 'db', httpStatus: sim.status, statusId, note: 'simulador rechazó (probable flujo asesor sin ecommerce_request) → UPDATE directo' };
    }
    // estado NO final (p.ej. 10 pendiente): el simulador siempre lo rechaza → UPDATE directo.
    await exec('UPDATE user_requests SET user_request_status_id=? WHERE id=?', [statusId, uReqID]);
    return { via: 'db', httpStatus: null, statusId, note: 'estado no-final → UPDATE directo (sin simulador)' };
}
