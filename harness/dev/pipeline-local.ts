// pipeline-local.ts — el pipeline de KYC v2 (customer-profiling-service sobre Temporal) de punta a punta, en LOCAL.
//
// QUÉ CONTESTA. ¿Qué nombre queda guardado, y dónde se frena, cuando un cliente pasa por el camino nuevo de
// identidad? El camino v1 lo corre `harness-case`; éste es el otro: OTP v2 → datos personales v2 → el
// workflow del servicio recorre Ágil Data → Mareigua → TusDatos → Experian y el backend decide si adopta,
// completa o pide corregir el nombre. Lo levanta `bin/pipeline-local start` (Temporal, el servicio y
// kyc-gateway apuntando al mock de centrales); esto sólo siembra y corre casos.
//
// Uso:
//   node dev/pipeline-local.ts seed [allied]     deja la base local lista para el pipeline (idempotente)
//   node dev/pipeline-local.ts run [1,3,…]       corre los casos (todos si no se dice cuáles)
//   node dev/pipeline-local.ts cases             lista los casos
//
// SÓLO LOCAL, a propósito. En qa el servicio de perfilamiento es uno solo en el cluster de desarrollo y para
// identidad llama al backend de develop, no al de qa (medido el 2026-10-16): una corrida «en qa» mide el
// código de develop. Para qa, el re-chequeo del backend: POST /api/v2/risk/identity-check/{central}/{userId}.

process.env.E2E_TARGET ||= 'local';
export {};

/* Imports DINÁMICOS: `pkg/db.ts` resuelve el target al evaluarse (F-187). */
const { TARGET } = await import('../pkg/env.ts');
if (TARGET !== 'local') {
    console.log(`\n  ✗ el pipeline local sólo corre en local (target actual: ${TARGET})\n`);
    process.exit(2);
}
const { one, exec, close } = await import('../pkg/db.ts');
const { config } = await import('../pkg/config.ts');

const API = config.mockUrl;
const CPS = process.env.PIPELINE_CPS_URL ?? 'http://localhost:8082';
const MOCK = process.env.RISK_LAMBDA_URL ?? 'http://localhost:8105';
const ALLIED = Number(process.env.PIPELINE_ALLIED ?? 26);

async function http(method: string, url: string, body?: unknown, timeoutMs = 60_000): Promise<{ status: number; json: any }> {
    const r = await fetch(url, {
        method, signal: AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    }).catch((e: Error) => e);
    if (r instanceof Error) return { status: 0, json: { error: r.message } };
    const t = await r.text();
    try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: { raw: t.slice(0, 300) } }; }
}

// ── seed: lo que la base local necesita para que el pipeline corra ─────────────────────────────────────────
//
// Sin `experian_trigger_bypass_rules` y `kyc_document_not_found_bypass`, `GET kyc-requirements` lanza y da
// 500 (OBV27003): el workflow termina FAILED en su primer paso. Se siembran con el valor de qa (2026-10-16).
// Y el comercio tiene que estar en `kyc_pipeline_allieds`, que es lo que lo manda por el camino nuevo.
const SETTINGS: Array<{ key: string; serialized: number; value: unknown }> = [
    { key: 'experian_trigger_bypass_rules', serialized: 4, value: { allieds: [196, 189, 94], lenders: [12, 24] } },
    { key: 'kyc_document_not_found_bypass', serialized: 1, value: { allied_branch_hash: [], allied: [94], all: false } },
];

async function seed(allied: number): Promise<void> {
    for (const s of SETTINGS) {
        const row = await one<{ id: number }>("SELECT id FROM settings WHERE code='setting' AND `key`=? LIMIT 1", [s.key]);
        if (row) { console.log(`  ✓ ${s.key} ya existe (id ${row.id})`); continue; }
        await exec("INSERT INTO settings (code, `key`, value, serialized, country_id, created_at, updated_at) VALUES ('setting', ?, ?, ?, 1, NOW(), NOW())",
            [s.key, JSON.stringify(s.value), s.serialized]);
        console.log(`  ✓ sembrado ${s.key}`);
    }
    const flow = await one<{ id: number; value: string }>("SELECT id, value FROM settings WHERE code='setting' AND `key`='kyc_pipeline_allieds' LIMIT 1");
    const list: number[] = flow ? (JSON.parse(flow.value)?.allieds ?? []) : [];
    if (list.includes(allied)) {
        console.log(`  ✓ el comercio ${allied} ya va por el pipeline (${JSON.stringify(list)})`);
    } else if (flow) {
        await exec("UPDATE settings SET value=?, updated_at=NOW() WHERE id=?", [JSON.stringify({ allieds: [...list, allied] }), flow.id]);
        console.log(`  ✓ comercio ${allied} agregado a kyc_pipeline_allieds → ${JSON.stringify([...list, allied])}`);
    } else {
        await exec("INSERT INTO settings (code, `key`, value, serialized, country_id, created_at, updated_at) VALUES ('setting', 'kyc_pipeline_allieds', ?, 4, 1, NOW(), NOW())",
            [JSON.stringify({ allieds: [allied] })]);
        console.log(`  ✓ sembrado kyc_pipeline_allieds = [${allied}]`);
    }
}

// ── los casos ──────────────────────────────────────────────────────────────────────────────────────────────
type Answer = (doc: string) => Promise<unknown> | unknown;

async function agildata(doc: string, name: string): Promise<unknown> {
    const { json } = await http('GET', `${MOCK}/agildata/agildata-services/rest/afiliado/historicoDetalladoEmpleo/CC/${doc}`);
    json.respuesta.datosBasicos.nombre = name;
    json.respuesta.datosBasicos.numeroId = doc;
    return json;
}
async function mareigua(doc: string, n1: string, n2: string, a1: string, a2: string): Promise<unknown> {
    const { json } = await http('POST', `${MOCK}/mareigua/consultas`, { NumeroEmpleado_id: doc });
    return { ...json, primer_nombre_persona_natural: n1, segundo_nombre_persona_natural: n2,
        primer_apellido_persona_natural: a1, segundo_apellido_persona_natural: a2, numero_identificacion_persona_natural: doc };
}
// La respuesta REAL de «sin información» de Ágil Data (codRespuesta 02), y una caída (HTTP 500 del mock).
const AGIL_EMPTY = { usuario: null, respuesta: null, codConsulta: '10000000000000000', codRespuesta: '02', observaciones: 'No se encontró información del afiliado.' };
const FAIL = { __http_status: 500, __body: { error: 'falla simulada' } };

interface Case { label: string; name: string; surname: string; agil?: Answer; mareigua?: Answer; expect: string }
const CASES: Record<string, Case> = {
    1: { label: 'Ñ que la central omite', name: 'LUIS', surname: 'MUÑOZ', agil: (d) => agildata(d, 'LUIS MUNOZ'), expect: 'LUIS / MUÑOZ' },
    2: { label: 'Ñ que la central trae', name: 'LUIS', surname: 'MUÑOZ', agil: (d) => agildata(d, 'LUIS MUÑOZ'), expect: 'LUIS / MUÑOZ' },
    3: { label: 'completa el 2º apellido', name: 'JUAN CARLOS', surname: 'PEREZ', agil: (d) => agildata(d, 'JUAN CARLOS PEREZ GOMEZ'), expect: 'JUAN CARLOS / PEREZ GOMEZ' },
    4: { label: 'completa 1+1 contra 4', name: 'ANA', surname: 'PEREZ', agil: (d) => agildata(d, 'ANA MARIA PEREZ GOMEZ'), expect: 'ANA MARIA / PEREZ GOMEZ' },
    5: { label: 'ambiguo: pide corregir', name: 'ANA', surname: 'PEREZ GOMEZ', agil: (d) => agildata(d, 'ANA MARIA PEREZ GOMEZ'), expect: 'pide corregir' },
    6: { label: 'Ágil vacía → Mareigua sin Ñ', name: 'LUIS', surname: 'MUÑOZ', agil: AGIL_EMPTY as any, mareigua: (d) => mareigua(d, 'LUIS', '', 'MUNOZ', 'PEREZ'), expect: 'LUIS / MUÑOZ PEREZ' },
    7: { label: 'Ágil caída → Mareigua', name: 'JUAN', surname: 'PEREZ', agil: FAIL as any, mareigua: (d) => mareigua(d, 'JUAN', 'CARLOS', 'PEREZ', 'GOMEZ'), expect: 'JUAN CARLOS / PEREZ GOMEZ' },
};

async function dictate(central: string, doc: string, answer: Answer | undefined): Promise<void> {
    if (answer === undefined) return;
    const value = typeof answer === 'function' ? await answer(doc) : answer;
    await http('POST', `${MOCK}/mockoon-admin/global-vars`, { key: `${central}_${doc}`, value: JSON.stringify(value) });
}

const rnd = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

async function branchOf(allied: number): Promise<string> {
    const b = await one<{ hash: string }>('SELECT hash FROM allied_branches WHERE allied_id=? AND status=1 ORDER BY id LIMIT 1', [allied]);
    if (!b) throw new Error(`el comercio ${allied} no tiene sucursales activas en local`);
    return b.hash;
}

async function runCase(key: string, c: Case, branch: string): Promise<Record<string, unknown>> {
    const doc = String(rnd(1_090_000_000, 1_099_999_999));
    const tel = '31' + String(rnd(10_000_000, 99_999_999));
    await dictate('agildata', doc, c.agil);
    await dictate('mareigua', doc, c.mareigua);

    await http('POST', `${API}/api/onboarding/phone/register`, { phone_number: tel, phoneNumber: tel, terms: true, policies: true,
        otp_length: 4, otpLength: 4, partner_branch_hash: branch, partnerBranchHash: branch });
    const otp = await http('POST', `${API}/api/v2/onboarding/otp-auth/validate/${branch}`,
        { cellPhone: tel, otpCode: tel.slice(-4), originalAmount: 2_000_000, amount: 2_000_000 });
    const p = otp.json?.data?.payload ?? otp.json?.errors?.payload ?? otp.json?.payload ?? {};
    const ur = p.userRequestId ?? p.user_request_id;
    if (!ur) return { caso: key, error: `OTP v2 sin solicitud: HTTP ${otp.status} ${JSON.stringify(otp.json).slice(0, 160)}` };

    const pi = await http('POST', `${API}/api/v2/onboarding/personal-info/${branch}/${ur}`, {
        document: { type: 'CC', number: doc, expedition: { year: 2015, month: 5, day: 10 } },
        email: `qa${doc}@gmail.com`, name: c.name, surname: c.surname, birth: { year: 1995, month: 5, day: 10 }, stratum: 3 });
    if (pi.status >= 300) return { caso: key, ur, error: `datos personales v2 HTTP ${pi.status} ${JSON.stringify(pi.json).slice(0, 160)}` };

    const start = await http('POST', `${CPS}/api/v1/loan-requests/${ur}/legacy-kyc-pipeline`, { partner_id: ALLIED, country_code: 'CO' });
    const wf = start.json?.workflow_id ?? start.json?.workflowId;
    if (!wf) return { caso: key, ur, error: `arranque del pipeline HTTP ${start.status} ${JSON.stringify(start.json).slice(0, 160)}` };

    let st: any = {};
    for (let i = 0; i < 90; i++) {
        st = (await http('GET', `${CPS}/api/v1/loan-requests/${ur}/legacy-kyc-pipeline/${wf}`)).json ?? {};
        const pending = Object.entries(st).some(([k, v]) => k.toLowerCase().includes('pending') && v);
        if (st.status !== 'RUNNING' || pending) break;
        await new Promise((r) => setTimeout(r, 1000));
    }
    const u = await one<{ first_name: string; surname: string; full_name: string }>(
        'SELECT u.first_name, u.surname, u.full_name FROM users u JOIN user_requests r ON r.user_id=u.id WHERE r.id=?', [ur]);
    const saved = `${u?.first_name ?? ''} / ${u?.surname ?? ''}`;
    const asks = st.pending_reason ? `pide ${st.pending_form} (${st.pending_reason})` : null;
    const ok = c.expect === 'pide corregir' ? st.pending_reason === 'identity_mismatch' : (st.status === 'COMPLETED' && saved === c.expect);
    return {
        caso: `${key} ${c.label}`, ok, escrito: `${c.name} / ${c.surname}`, ur, workflow: wf, estado: st.status,
        centrales: (st.provider_outcomes ?? []).map((o: any) => `${o.provider}=${o.result}`), ...(asks ? { pide: asks } : {}),
        guardado: saved, full_name: u?.full_name, esperado: c.expect,
    };
}

const [, , cmd = 'run', arg] = process.argv;
try {
    if (cmd === 'seed') {
        await seed(arg ? Number(arg) : ALLIED);
    } else if (cmd === 'cases') {
        for (const [k, c] of Object.entries(CASES)) console.log(`  ${k}  ${c.label.padEnd(30)} escribe ${c.name} / ${c.surname} → ${c.expect}`);
    } else if (cmd === 'run') {
        const keys = arg ? arg.split(',').map((s) => s.trim()).filter(Boolean) : Object.keys(CASES);
        const unknown = keys.filter((k) => !CASES[k]);
        if (unknown.length) throw new Error(`casos desconocidos: ${unknown.join(', ')} (ver: node dev/pipeline-local.ts cases)`);
        const health = await http('GET', `${CPS}/health`, undefined, 5_000);
        if (health.status !== 200) throw new Error(`el servicio no responde en ${CPS}: levantalo con \`make harness-pipeline\``);
        const branch = await branchOf(ALLIED);
        let bad = 0;
        for (const k of keys) {
            const r = await runCase(k, CASES[k], branch);
            if (r.ok !== true) bad++;
            console.log(JSON.stringify(r));
        }
        console.log(`\n  ${keys.length - bad}/${keys.length} como se esperaba · comercio ${ALLIED} · sucursal ${branch}`);
        process.exitCode = bad ? 1 : 0;
    } else {
        throw new Error(`no conozco «${cmd}»: seed | cases | run`);
    }
} catch (e) {
    console.log(`\n  ✗ ${(e as Error).message}\n`);
    process.exitCode = 2;
} finally {
    await close();
}
