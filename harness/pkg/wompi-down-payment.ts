// Pagar la cuota inicial contra el mock de Wompi (`mock-wompi/server.mjs`), como lo haría el comprador.
//
// Hace lo mismo que la pantalla `/down-payment` del wizard, que corre entera en el navegador
// (`routes/down-payment/confirm.tsx` → `processing.tsx`): pide el resumen del pago, crea el intento y
// consulta el estado cada 3 s hasta que sea terminal. Todo por el proxy del wizard
// (`/api/loans/payments/*`), igual que el cliente. Lo único que cambia es el widget: en vez de abrirlo,
// le dice al mock que el comprador pagó.
//
// ⚠ El backend no se entera en el momento: `PaymentStatusService` recién le pregunta a Wompi cuando la
// transacción tiene más de 20 s. Por eso una cuota aprobada tarda ~21 s en verse (medido 2026-09-25).

export const WOMPI_MOCK = process.env.MOCK_WOMPI_URL ?? 'http://localhost:8112';

const POLL_MS = 3000;
/** 20 s de gracia del backend + 15 s de ventana entre consultas a Wompi + margen. */
const TIMEOUT_MS = 60_000;
const TERMINAL = ['APPROVED', 'DECLINED', 'VOIDED', 'ERROR'];

export interface DownPaymentResult {
    ok: boolean;
    status: string | null;
    reference: string | null;
    amountInCents: number | null;
    reason: string;
}

async function getJson(url: string, init?: RequestInit): Promise<{ status: number; body: any }> {
    const r = await fetch(url, { ...init, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
    const text = await r.text();
    try { return { status: r.status, body: JSON.parse(text) }; } catch { return { status: r.status, body: text }; }
}

/**
 * La cuota inicial de una solicitud, de punta a punta.
 *
 * @param amountPesos lo que paga el comprador; sin él, el mínimo que exige la entidad.
 * @param status      lo que contesta Wompi: APPROVED (default) o DECLINED para probar el rechazo.
 */
export async function payDownPayment(opts: {
    feBase: string;
    loanRequestId: number;
    amountPesos?: number;
    status?: string;
    log?: (s: string) => void;
    /** Fuera de local: el celular de la prueba. En vez de pagar en el mock, se INSERTA el pago (`approveInitialFee`). */
    insertForPhone?: string;
}): Promise<DownPaymentResult> {
    const { feBase, loanRequestId, log = () => {} } = opts;
    const status = (opts.status || 'APPROVED').toUpperCase();
    const fail = (reason: string, extra: Partial<DownPaymentResult> = {}): DownPaymentResult =>
        ({ ok: false, status: null, reference: null, amountInCents: null, reason, ...extra });

    const alive = opts.insertForPhone ? true : await fetch(`${WOMPI_MOCK}/`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false);
    if (!alive) return fail(`el mock de Wompi no responde en ${WOMPI_MOCK} — levantalo con \`make harness-wompi\``);

    const preview = await getJson(`${feBase}/api/loans/payments/${loanRequestId}/preview?concept=down_payment`);
    const p = preview.body?.data;
    if (preview.status !== 200 || !p) return fail(`preview HTTP ${preview.status}: ${JSON.stringify(preview.body).slice(0, 160)}`);
    if (!p.payment_enabled) return fail('el comercio no tiene la pasarela habilitada (payment_enabled: false)');

    const amountInCents = opts.amountPesos && opts.amountPesos > 0 ? Math.round(opts.amountPesos * 100) : Number(p.min_amount_in_cents);
    const intent = await getJson(`${feBase}/api/loans/payments/intent`, {
        method: 'POST',
        body: JSON.stringify({ concept: 'down_payment', loan_request_id: loanRequestId, amount_in_cents: amountInCents }),
    });
    const reference: string | undefined = intent.body?.data?.reference;
    if (intent.status !== 200 || !reference) {
        return fail(`intent HTTP ${intent.status}: ${String(intent.body?.message ?? JSON.stringify(intent.body)).slice(0, 200)}`, { amountInCents });
    }
    log(`cuota inicial: intento ${reference} por $${(amountInCents / 100).toLocaleString('es-CO')} (mínimo $${(Number(p.min_amount_in_cents) / 100).toLocaleString('es-CO')})`);

    if (opts.insertForPhone) {
        if (status !== 'APPROVED') return fail('fuera de local la cuota sólo se inserta APROBADA', { reference, amountInCents });
        const ins = await approveInitialFee(reference, opts.insertForPhone);
        if (!ins.ok) return fail(`no se pudo insertar la cuota: ${ins.motivo}`, { reference, amountInCents });
        log(`cuota inicial: insertada como pagada en la solicitud ${ins.userRequestId} (sin pasar por Wompi)`);
    } else {
        const paid = await getJson(`${WOMPI_MOCK}/__mock/pay`, {
            method: 'POST',
            body: JSON.stringify({ reference, amount_in_cents: amountInCents, status }),
        });
        if (paid.status !== 200) return fail(`el mock no registró el pago: ${JSON.stringify(paid.body).slice(0, 160)}`, { reference, amountInCents });
    }

    const t0 = Date.now();
    let last: string | null = null;
    while (Date.now() - t0 < TIMEOUT_MS) {
        const st = await getJson(`${feBase}/api/loans/payments/${reference}/status`);
        last = st.body?.status ?? null;
        if (last && TERMINAL.includes(last)) {
            const secs = Math.round((Date.now() - t0) / 1000);
            log(`cuota inicial: Wompi contestó ${last} y el backend lo vio a los ${secs} s`);
            return last === 'APPROVED'
                ? { ok: true, status: last, reference, amountInCents, reason: `pagada (${secs} s)` }
                : fail(`el pago quedó ${last}`, { status: last, reference, amountInCents });
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return fail(`el estado siguió ${last ?? '—'} después de ${TIMEOUT_MS / 1000} s: ¿el backend tiene WOMPI_HOST apuntando al mock (http://host.docker.internal:8112/v1)?`, { status: last, reference, amountInCents });
}

/* ── LA CUOTA INICIAL FUERA DE LOCAL: insertar el pago y no tocar la pasarela ───────────────────────────────────
 * En dev/qa/staging el backend le pregunta a Wompi SANDBOX, y el celular del panel no puede pagar en el widget. En vez
 * de apuntar el ambiente a un Wompi falso (le cambiaría la pasarela a todo el equipo), se hace para ESTA solicitud lo
 * mismo que hace el backend cuando Wompi contesta APPROVED (`Wompi::updateStatus`, cuota inicial):
 *   1. la transacción pasa de PENDING a APPROVED;
 *   2. la solicitud se recalcula con lo pagado (`DownPaymentRecalculation::compute`): initial_fee, amount, final_amount.
 * Después `processing` lo ve sin consultar a Wompi: `PaymentStatusService` sólo reconcilia lo que sigue PENDING.
 * ⚠ Lo que NO hace: los mensajes de aviso de la cuota (`sendReturnInitialFeeMessages`) — el flujo no los necesita. Si
 * el backend cambia esa lógica, esto se queda atrás: es una copia, y lo dice. */
export async function approveInitialFee(reference: string, phone: string): Promise<{ ok: boolean; motivo?: string; userRequestId?: number; paid?: number; finalAmount?: number }> {
    const { one, exec, withSeedScope, TARGET } = await import('./db.ts');
    if (TARGET === 'prod') throw new Error('la cuota inicial nunca se inserta en prod');
    const t = await one<{ id: number; ur: number; user_id: number; phone: string | null; status: string; type: number | null; cents: number | null; original: number | null; lender_id: number; allied_id: number }>(
        `SELECT t.id, ur.id AS ur, ur.user_id, u.cell_phone AS phone, s.name AS status, t.creditop_x_payment_type_id AS type,
                JSON_EXTRACT(t.request, '$.amount_in_cents') AS cents, ur.original_amount AS original, ur.lender_id, ur.allied_id
         FROM payment_gateway_transactions t JOIN user_requests ur ON ur.id = t.user_request_id JOIN users u ON u.id = ur.user_id
         JOIN lender_transaction_statuses s ON s.id = t.status_id WHERE t.order_id = ? ORDER BY t.id DESC LIMIT 1`, [reference]);
    if (!t) return { ok: false, motivo: `no encontré el intento de pago ${reference}` };
    if (String(t.phone ?? '').replace(/\D/g, '') !== String(phone).replace(/\D/g, '')) return { ok: false, motivo: `el pago ${reference} no es del celular ${phone}: no se toca` };
    if (Number(t.type) !== 1) return { ok: false, motivo: `el pago ${reference} no es una cuota inicial` };
    if (t.status !== 'PENDING') return { ok: t.status === 'APPROVED', motivo: `el pago ya estaba ${t.status}`, userRequestId: t.ur };
    const paid = Number(t.cents) / 100;
    if (!(paid > 0) || !(Number(t.original) > 0)) return { ok: false, motivo: `falta el monto del pago o el original de la solicitud ${t.ur}` };
    const lba = await one<{ pct: number | null }>('SELECT administrative_costs_percentage AS pct FROM lenders_by_allieds WHERE lender_id = ? AND allied_id = ? LIMIT 1', [t.lender_id, t.allied_id]);
    const pending = await one<{ id: number }>("SELECT id FROM lender_transaction_statuses WHERE name = 'PENDING' AND lender_id = 52 LIMIT 1");
    const approved = await one<{ id: number }>("SELECT id FROM lender_transaction_statuses WHERE name = 'APPROVED' AND lender_id = 52 LIMIT 1");
    if (!pending || !approved) return { ok: false, motivo: 'no encontré los estados de Wompi (lender 52)' };
    // La misma fórmula que `DownPaymentRecalculation::compute`.
    const rest = Number(t.original) - paid;
    const finalAmount = rest + rest * (Number(lba?.pct ?? 0) / 100);
    const response = JSON.stringify({ data: [{ reference, status: 'APPROVED', amount_in_cents: Number(t.cents), harness: 'cuota inicial insertada por el panel' }] });
    await withSeedScope([t.user_id], async () => {
        await exec(`UPDATE payment_gateway_transactions t JOIN user_requests ur ON ur.id = t.user_request_id SET t.status_id = ?, t.response = ?, t.updated_at = NOW() WHERE t.id = ? AND t.status_id = ? AND ur.user_id = ?`,
            [approved.id, response, t.id, pending.id, t.user_id], { permiso: 'cuota-inicial', usuario: t.user_id });
        await exec(`UPDATE user_requests SET final_amount = ?, amount = ?, initial_fee = ?, updated_at = NOW() WHERE id = ? AND user_id = ?`,
            [finalAmount, finalAmount, paid, t.ur, t.user_id], { permiso: 'cuota-inicial', usuario: t.user_id });
    });
    return { ok: true, userRequestId: t.ur, paid, finalAmount };
}
