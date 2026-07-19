// sweep — recorredor HEADLESS de flujos (sin navegador): imita las llamadas que hace el wizard
// pantalla por pantalla, contra el backend local, para mapear CONDUCTAS por comercio × entidad.
//
//   node dev/sweep.ts matrix <slug...>     → siembra un uReq FRESCO por entidad, la selecciona
//                                            (update-user-request, como la action de /lenders) y
//                                            clasifica el resultado por CONDUCTA:
//                                              standBy (in-platform) · modal (self-management) ·
//                                              redirect externo · otp-lender · ERROR (con causa)
//   node dev/sweep.ts close <slug> <lenderId> [monto]
//                                          → intenta el CIERRE rt=2 entero por API, siguiendo la
//                                            misma secuencia de endpoints que las pantallas del
//                                            wizard (continue → confirm → fecha → cronograma →
//                                            send-otp → verify-otp → authorize) y reporta cada
//                                            paso con su HTTP status. Imprime el estado final.
//
// Por qué existe: probar N comercios × M entidades por UI cuesta minutos por corrida; por API son
// segundos, y el LOG de cada paso es el insumo para documentar los flujos en context/ (Findings).
// Las conductas se clasifican por los MISMOS campos que mira el front (standBy/showModal/url/…).
//
// Gotchas que ya nos mordieron (ver Findings):
//   · UA de iPhone SIEMPRE (onlyMobileValidation → 403 con UA de escritorio).
//   · E2E_TARGET default es dev → acá se fuerza local salvo override explícito.
//   · El teléfono 3131010101 debe estar scrubbeado antes de cada register.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

process.env.E2E_TARGET ||= 'local';
process.env.CFE_TARGET ||= 'local';

const { one, exec, query, close } = await import('../pkg/db.ts');
const { synthFill } = await import('../pkg/inject.ts');

const API = process.env.E2E_MOCK_URL ?? 'http://localhost';
const PHONE = '3131010101';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';
const HDRS = { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA };

const flows = JSON.parse(readFileSync(new URL('../.flows.json', import.meta.url), 'utf8'));

function scrub(): void {
    spawnSync('node', ['bin/dbops.ts', 'scrubphone', PHONE], { cwd: new URL('..', import.meta.url).pathname });
}

async function http(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
    const r = await fetch(`${API}${path}`, {
        method, headers: HDRS, body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
    }).catch((e) => e as Error);
    if (r instanceof Error) return { status: 0, json: { message: String(r.message).slice(0, 120) } };
    const text = await r.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 160) }; }
    return { status: r.status, json };
}

/** register + INSERT del uReq + buró sintético. Devuelve el id, o '' si falló. */
async function seed(hash: string, amount: number): Promise<string> {
    scrub();
    const reg = await http('POST', '/api/onboarding/phone/register', {
        phone_number: PHONE, phoneNumber: PHONE, terms: true, policies: true,
        otp_length: 4, otpLength: 4, partner_branch_hash: hash, partnerBranchHash: hash,
    });
    const uid = reg.json?.data?.user?.id;
    if (!uid) return '';
    const br = await one<{ b: number; a: number }>('SELECT id AS b, allied_id AS a FROM allied_branches WHERE hash=?', [hash]);
    if (!br) return '';
    const ins = await exec(
        'INSERT INTO user_requests (user_id, allied_id, allied_branch_id, lender_id, amount, original_amount, user_request_status_id, credit_line_id, fee_number, fee_value, rate, created_at, updated_at) VALUES (?,?,?,NULL,?,?,1,1,0,0,0,NOW(),NOW())',
        [uid, br.a, br.b, amount, amount],
    ).catch(() => null);
    if (!ins?.insertId) return '';
    await synthFill(ins.insertId, { income: 2_500_000, score: 700 });
    return String(ins.insertId);
}

/** Selecciona la entidad como lo hace la action de /lenders y clasifica por CONDUCTA. */
async function select(ur: string, lenderId: number): Promise<string> {
    const r = await http('POST', `/api/onboarding/loan-application/update-user-request/${ur}`, {
        lender_id: lenderId, fee_number: 4, original_amount: 2_000_000, amount: 2_000_000,
        initial_fee: 0, rate: '0', transaction_data: null,
    });
    const d = r.json?.data;
    if (r.status !== 200 || r.json?.success === false || !d) {
        const msg = String(r.json?.message ?? r.json?.raw ?? `HTTP ${r.status}`).split('\n')[0];
        return `ERROR · ${msg.slice(0, 90)}`;
    }
    // ADITIVO, no primera-coincidencia: una entidad puede traer modal Y url a la vez (ej. Bancolombia vía
    // Payvalida: modal + transaction.url del checkout). El front decide por combinación; acá reportamos todo.
    const traits: string[] = [];
    if (d.standBy) traits.push('standBy (in-platform)');
    if (d.validateLenderOtp) traits.push('otp-lender');
    if (d.showModal) traits.push(`modal${d.isSelfManagement ? '·self-mgmt' : ''} "${String(d.modalMessage ?? '').slice(0, 40)}"`);
    // 2ª variante de modal: showModal=false pero openProcessModal=true (Lagobo/Davivienda/Meddipay) —
    // el "modal de proceso": seguí en el punto de venta / en la app del lender / en el celular del cliente.
    if (!d.showModal && d.openProcessModal) traits.push(`processModal "${String(d.modalMessage ?? '').slice(0, 40)}"`);
    if (d.qrUrl) traits.push('qr');
    const u = d.url || d.transaction?.url;
    if (u) { let h = u; try { h = new URL(u).host; } catch { /* */ } traits.push(`url→${h}`); }
    return traits.length ? traits.join(' + ') : 'sin conducta reconocible (revisar data)';
}

// ───────────────────────────── matrix ─────────────────────────────
async function matrix(slugs: string[]): Promise<void> {
    for (const slug of slugs) {
        const hash = flows.merchants[slug]?.branch_hash;
        if (!hash) { console.log(`\n■ ${slug}: sin branch_hash en .flows.json`); continue; }
        const lenders = await query<{ id: number; name: string; rt: number }>(
            'SELECT l.id, l.name, l.response_type rt FROM lenders_by_allied_branches lab JOIN allied_branches ab ON ab.id=lab.allied_branch_id JOIN lenders l ON l.id=lab.lender_id WHERE ab.hash=? AND l.status=1 ORDER BY l.response_type, l.id', [hash]);
        console.log(`\n■ ${slug} (${hash}) — ${lenders.length} entidades configuradas`);

        // listado (una vez): qué decide MOSTRAR el marketplace para este perfil
        const ur0 = await seed(hash, 2_000_000);
        const lv2 = ur0 ? await http('GET', `/api/onboarding/loan-application/lenders-v2/${ur0}`) : null;
        const listed = new Set<number>((lv2?.json?.data?.lenders ?? []).map((x: any) => Number(x.id ?? x.lender_id)));

        for (const l of lenders) {
            const ur = await seed(hash, 2_000_000);
            if (!ur) { console.log(`   #${l.id} ${l.name}: seed falló`); continue; }
            const out = await select(ur, l.id);
            const mark = listed.has(l.id) ? 'lista' : 'NO lista';
            console.log(`   rt${l.rt} #${String(l.id).padEnd(4)} ${l.name.slice(0, 30).padEnd(31)} [${mark.padEnd(8)}] → ${out}`);
        }
    }
}

// ───────────────────────────── close ─────────────────────────────
const trim = (j: any) => JSON.stringify(j?.data ?? j).slice(0, 150);

async function closeRt2(slug: string, lenderId: number, amount: number): Promise<void> {
    const hash = flows.merchants[slug]?.branch_hash;
    if (!hash) { console.log(`✗ ${slug} sin branch_hash`); return; }
    const ur = await seed(hash, amount);
    if (!ur) { console.log('✗ seed falló'); return; }
    console.log(`■ cierre headless · ${slug} · lender #${lenderId} · uReq ${ur} · monto ${amount.toLocaleString('es-CO')}`);

    const step = async (name: string, method: string, path: string, body?: unknown) => {
        const r = await http(method, path, body);
        console.log(`  ${r.status === 200 ? '●' : '✗'} ${name.padEnd(24)} HTTP ${r.status} · ${trim(r.json)}`);
        return r;
    };

    const sel = await step('select', 'POST', `/api/onboarding/loan-application/update-user-request/${ur}`, { lender_id: lenderId, fee_number: 4, original_amount: amount, amount, initial_fee: 0, rate: '0', transaction_data: null });
    if (!sel.json?.data?.standBy) { console.log('  ⚠ la selección NO devolvió standBy — esto no es un cierre in-platform; corto acá.'); return; }

    await step('continue (index)', 'GET', `/api/loans/requests/${ur}`);
    await step('confirm', 'POST', '/api/loans/requests/confirm', { user_request_id: Number(ur) });

    // Las pantallas de fechas/cronograma viven BAJO el prefijo promissory-note (lo enseñó un 404).
    const PN = `/api/loans/requests/promissory-note`;
    const dates = await step('select-payment-date', 'GET', `${PN}/${ur}/select-payment-date`);
    // La forma real (aprendida corriendo): data = { view, nextPaymentDates: [{date, day}], selectedCycle, … }
    const dOpts = dates.json?.data?.nextPaymentDates ?? dates.json?.data?.dates ?? [];
    const firstDate = Array.isArray(dOpts) ? (dOpts[0]?.date ?? dOpts[0]) : null;
    await step('confirm-payment-date', 'POST', `${PN}/${ur}/confirm-payment-date`, { user_request_id: Number(ur), payment_date: firstDate, date: firstDate });

    const sim = await step('simulate-schedule', 'GET', `${PN}/${ur}/simulate-payment-schedule`);
    const cycles = sim.json?.data?.cycles ?? sim.json?.data?.simulations ?? sim.json?.data ?? [];
    const cyc = Array.isArray(cycles) ? cycles[0] : cycles;
    const urRow = await one<{ a: number }>('SELECT allied_id a FROM user_requests WHERE id=?', [ur]);
    await step('confirm-schedule', 'POST', `${PN}/${ur}/confirm-payment-schedule`, {
        user_request_id: Number(ur), amount, lender_id: lenderId, allied_id: urRow?.a,
        fee_number: cyc?.fee_number ?? cyc?.feeNumber ?? 4, selected_cycle: cyc ?? {},
    });

    // GENERAR los documentos antes de firmar: es el loader de sign-documents quien los crea (el show del
    // pagaré); sin esto, authorize muere con "PromissoryNote no encontrado".
    await step('promissory (show/gen)', 'GET', `${PN}/${ur}`);

    await step('send-otp (firma)', 'POST', '/api/loans/requests/promissory-note/validate/send-otp', { user_request_id: Number(ur) });
    await step('verify-otp', 'POST', '/api/loans/requests/promissory-note/validate/verify-otp', { user_request_id: Number(ur), otp: PHONE.slice(-6) });

    // ── Path IMEI (SmartPay): el desembolso NO pasa por `authorize`. ──
    // El asesor escanea el IMEI (device/register) y el cliente dispara device/{ur}/disburse, que autoriza
    // y desembolsa en un solo paso. Llamar a `authorize` acá ROMPE el flujo: falla, hace rollback y deja
    // el OTP consumido, con lo que el disburse posterior arranca con otp_id=null y muere en un null.
    const isImei = await one<{ n: number }>(
        "SELECT COUNT(*) n FROM lenders l JOIN paths p ON p.id = l.path_id WHERE l.id = ? AND p.name = 'IMEI'", [lenderId]);
    if (isImei?.n) {
        const imei = process.env.SWEEP_IMEI || '356938035643809';   // 15 dígitos (validación size:15)
        await step('device/register (IMEI)', 'POST', '/api/loans/requests/device/register', { imei, user_request_id: Number(ur) });
        await step('device/disburse', 'POST', `/api/loans/requests/device/${ur}/disburse`, {});
    } else {
        await step('authorize', 'POST', '/api/loans/requests/promissory-note/validate/authorize', { user_request_id: Number(ur) });
    }

    const fin = await one<{ st: number; rn: string | null }>('SELECT user_request_status_id st, request_number rn FROM user_requests WHERE id=?', [ur]);
    const stName = fin ? (await one<{ name: string }>('SELECT name FROM user_request_statuses WHERE id=?', [fin.st]))?.name : '?';
    console.log(`  ► estado final: ${fin?.st} · ${stName}${fin?.rn ? ` · request_number ${fin.rn}` : ''}`);
}

// ───────────────────────────── main ─────────────────────────────
const [, , mode, ...args] = process.argv;
if (mode === 'matrix') await matrix(args.length ? args : ['motai']);
else if (mode === 'close') await closeRt2(args[0], Number(args[1]), Number(args[2] ?? 2_000_000));
else console.log('uso: node dev/sweep.ts matrix <slug...> | close <slug> <lenderId> [monto]');
await close().catch(() => {});
