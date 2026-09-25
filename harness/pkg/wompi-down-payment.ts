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
}): Promise<DownPaymentResult> {
    const { feBase, loanRequestId, log = () => {} } = opts;
    const status = (opts.status || 'APPROVED').toUpperCase();
    const fail = (reason: string, extra: Partial<DownPaymentResult> = {}): DownPaymentResult =>
        ({ ok: false, status: null, reference: null, amountInCents: null, reason, ...extra });

    const alive = await fetch(`${WOMPI_MOCK}/`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false);
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

    const paid = await getJson(`${WOMPI_MOCK}/__mock/pay`, {
        method: 'POST',
        body: JSON.stringify({ reference, amount_in_cents: amountInCents, status }),
    });
    if (paid.status !== 200) return fail(`el mock no registró el pago: ${JSON.stringify(paid.body).slice(0, 160)}`, { reference, amountInCents });

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
