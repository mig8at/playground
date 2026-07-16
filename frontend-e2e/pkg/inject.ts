// inject.ts — "KYC armado": inyecta identidad + summaries + field values + la fila Experian ENCRIPTADA
// directo en el user_request del wizard, para que /lenders ofrezca sin volver a llamar centrales.
// Port 1:1 de backend-mcp opSynthFill + deriveSynthReq + db.go (setSynthIdentity/injectSummary/
// injectIncomeFields/injectDatacredito/datacreditoData). frontend-e2e ya no shellea al mcp.
import { query, one, scalar, exec, appKey, assertWriteAllowed, TARGET } from './db.ts';
import { encryptLaravelString } from './laravel-crypt.ts';

export interface SynthReq {
    fields: Record<number, string>; // user_field_values (29 ocupación, 160 reportado, 87 ingreso, …)
    gender: string;                 // users.gender (M)
    age: number;                    // users.age dentro del rango de las group rules
    income: number;                 // ingreso (field 87) = mayor umbral `>=`
    score: number;                  // datacrédito score por encima del mayor min_score
}

export interface SynthFillResult {
    user_request_id: number;
    user_id: number;
    branch_hash: string;
    target_lender: string;
    doc: string;
    profile: { fields: Record<number, string>; gender: string; age: number; income: number; score: number };
    datacredito_forged: string;
    note: string;
}

const firstPipe = (s: string): string => (s.includes('|') ? s.slice(0, s.indexOf('|')) : s);

// datacreditoData: perfil que LenderUserCategoryService lee de `$user->datacredito->data`. Por defecto LIMPIO
// (0 negativos, 1 consulta, 1 TC activa con vector OK, deuda baja); negatives/consulted son configurables (panel).
function datacreditoData(negatives = 0, consulted = 1): Record<string, unknown> {
    return {
        agregatedInfo: {
            overview: {
                principals: {
                    currentNegativeCredits: negatives,
                    negativeHistoricalLast12Months: negatives,
                    consultedLast6Months: consulted,
                    maturationSince: '2015-01-01',
                },
                balances: { valueMonthlyPayment: 100, totalValueBalanceOverdue: 0 },
            },
        },
        creditCard: [
            {
                status: {
                    account: { businessAccountStatus: '00' },
                    payment: { businessBureauEvent: 1 },
                },
                creditCardAccount: { businessBehaviourVectorProduct: '111111111111111111111111' },
            },
        ],
        liabilities: [
            { liabilitiesAccount: { businessBehaviourVectorProduct: 'NNNNNNNNNNNNNNNNNNNNNNNN' } },
        ],
    };
}

// resolveLender: lender por id/nombre RESTRINGIDO a los que ofrece la sucursal (lenders_by_allied_branches).
async function resolveLender(branchHash: string, q: string): Promise<{ id: number; rt: number; name: string } | null> {
    const row = await one<{ id: number; response_type: number; name: string }>(
        `SELECT l.id, l.response_type, COALESCE(l.name,'') AS name FROM lenders l
         JOIN lenders_by_allied_branches lab ON lab.lender_id = l.id
         JOIN allied_branches ab ON ab.id = lab.allied_branch_id AND ab.hash = ?
         WHERE l.status = 1 AND (CAST(l.id AS CHAR) = ? OR l.name LIKE ?) ORDER BY l.id LIMIT 1`,
        [branchHash, q, '%' + q + '%'],
    );
    return row ? { id: row.id, rt: row.response_type, name: row.name } : null;
}

// deriveSynthReq: lee group_rules (capa comercio) + min_score (capa lender) y arma el perfil mínimo.
async function deriveSynthReq(branchHash: string, lenderID: number, lenderRT: number): Promise<SynthReq> {
    const req: SynthReq = { fields: { 29: 'Empleado', 160: 'no' }, gender: 'M', age: 35, income: 2_500_000, score: 700 };
    const abID = (await scalar<number>('SELECT id FROM allied_branches WHERE hash = ? LIMIT 1', [branchHash])) ?? 0;

    let ageMin = 18, ageMax = 90;
    const rules = await query<{ field_id: number | null; specific_table: string; column: string; operator: string; value: string }>(
        'SELECT lr.field_id, COALESCE(lr.specific_table,\'\') AS specific_table, COALESCE(lr.`column`,\'\') AS `column`, lr.operator, lr.value ' +
        'FROM group_rules gr JOIN lender_rules lr ON lr.group_rule_id = gr.id ' +
        'WHERE gr.allied_branch_id = ? AND gr.id IN (SELECT group_rule_id FROM lender_rules WHERE lender_id = ?)',
        [abID, lenderID],
    );
    for (const r of rules) {
        const op = (r.operator || '').trim();
        const fid = r.field_id ?? 0;
        if (fid > 0) {
            if (fid === 87 && (op === '>=' || op === '>')) {
                const n = parseInt((r.value || '').trim(), 10);
                if (!Number.isNaN(n) && n > req.income) req.income = n;
            } else if (op === '=') {
                req.fields[fid] = firstPipe(r.value); // primer valor permitido de A|B|C
            }
        } else if (r.specific_table === 'users') {
            if (r.column === 'gender') {
                req.gender = firstPipe(r.value); // "M|F" → M
            } else if (r.column === 'age') {
                const n = parseInt((r.value || '').trim(), 10);
                if (!Number.isNaN(n)) {
                    if ((op === '>=' || op === '>') && n > ageMin) ageMin = n;
                    if ((op === '<=' || op === '<') && n < ageMax) ageMax = n;
                }
            }
        }
    }
    req.age = 35;
    if (req.age < ageMin) req.age = ageMin;
    if (req.age > ageMax) req.age = ageMax;
    req.fields[87] = String(req.income);

    // capa lender: mayor min_score
    const scoreSql = lenderRT === 2
        ? 'SELECT min_score AS s FROM lender_users_category_rules WHERE lender_id = ?'
        : 'SELECT score AS s FROM lender_datacredito_rules WHERE lender_id = ? AND (allied_branch_id = ? OR allied_branch_id IS NULL)';
    const scoreArgs = lenderRT === 2 ? [lenderID] : [lenderID, abID];
    const scoreRows = await query<{ s: number | null }>(scoreSql, scoreArgs);
    let maxMin = 0;
    for (const sr of scoreRows) {
        const s = sr.s ?? 0;
        if (s > maxMin) maxMin = s;
    }
    if (maxMin + 50 > req.score) req.score = maxMin + 50;
    return req;
}

// ensureLenderCredential: siembra lender_allied_credentials (allied, lender) si falta (lenders rt=1).
async function ensureLenderCredential(alliedID: number, lenderID: number): Promise<string> {
    const ex = await scalar<number>('SELECT id FROM lender_allied_credentials WHERE allied_id=? AND lender_id=? LIMIT 1', [alliedID, lenderID]);
    if (ex && ex > 0) return 'ya existía';
    const tpl = await one<{ allied_type: string | null; credential: string | null }>(
        'SELECT allied_type, credential FROM lender_allied_credentials WHERE lender_id=? LIMIT 1', [lenderID],
    );
    if (!tpl) return 'sin plantilla para copiar';
    await exec(
        'INSERT INTO lender_allied_credentials (lender_id, allied_type, allied_id, credential, created_at, updated_at) VALUES (?,?,?,?,NOW(),NOW())',
        [lenderID, tpl.allied_type, alliedID, tpl.credential],
    );
    return 'sembrada (copiada de plantilla)';
}

async function setSynthIdentity(userID: number, doc: string, email: string, gender: string, age: number, name?: string, documentType = 'CC'): Promise<void> {
    // name opcional (del panel): "Juan Perez" → first_name "Juan", surname "Perez". Default = SYNTH TEST USER.
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    const first = parts[0] ?? 'SYNTH';
    const surname = parts.slice(1).join(' ') || 'TEST USER';
    await exec(
        `UPDATE users SET document_type=?, document_number=?, first_name=?, surname=?,
         full_name=?, email=?, date_of_birth='1990-01-01', expedition_date='2010-01-01',
         age=?, gender=?, updated_at=NOW() WHERE id=?`,
        [documentType, doc, first, surname, `${first} ${surname}`, email, age, gender, userID],
    );
}

async function injectSummary(userID: number, income: number, score: number, negatives = 0, consulted = 1, withBuro = true): Promise<void> {
    const agildata = JSON.stringify({
        employed: true, self_employed: false, retired: false,
        approximate_real_salary: income, last_payment_value: income, lowest_payment_value: income,
        continuity_3_months: true, continuity_6_months: true, continuity_12_months: true,
    });
    // withBuro=false (PEP): guardamos el ingreso (agildata) pero NO el bloque de datacrédito.
    const datacredito = withBuro
        ? JSON.stringify({ score, value_monthly_payment: Math.floor(income / 3), data: datacreditoData(negatives, consulted) })
        : null;
    const id = await scalar<number>('SELECT id FROM user_summaries WHERE user_id = ? LIMIT 1', [userID]);
    if (id && id > 0) {
        await exec('UPDATE user_summaries SET agildata=?, datacredito=?, updated_at=NOW() WHERE id=?', [agildata, datacredito, id]);
    } else {
        await exec('INSERT INTO user_summaries (user_id, agildata, datacredito, created_at, updated_at) VALUES (?,?,?,NOW(),NOW())', [userID, agildata, datacredito]);
    }
}

async function injectIncomeFields(userID: number, uReqID: number, fields: Record<number, string>): Promise<void> {
    for (const [fidStr, val] of Object.entries(fields)) {
        const fid = Number(fidStr);
        const ex = await scalar<number>('SELECT id FROM user_field_values WHERE user_id=? AND field_id=? AND form_id=1 LIMIT 1', [userID, fid]);
        if (ex && ex > 0) {
            await exec('UPDATE user_field_values SET value=?, user_request_id=?, updated_at=NOW() WHERE id=?', [val, uReqID, ex]);
        } else {
            await exec(
                'INSERT INTO user_field_values (field_id, user_id, user_request_id, form_id, value, status, created_at, updated_at) VALUES (?,?,?,1,?,1,NOW(),NOW())',
                [fid, userID, uReqID, val],
            );
        }
    }
}

// experianRiskCentralID: la central que `$user->datacredito` exige (Acierta+Quanto preferido, si no Acierta).
async function experianRiskCentralID(): Promise<number> {
    return (await scalar<number>(
        `SELECT id FROM risk_centrals WHERE name IN ('Experian - Acierta+Quanto','Experian - Acierta')
         ORDER BY FIELD(name,'Experian - Acierta+Quanto','Experian - Acierta') LIMIT 1`,
    )) ?? 0;
}

// injectDatacredito: FORJA la fila Experian (risk_central_user_data) — score plano + data ENCRIPTADA
// igual que el cast encrypted:collection de Laravel. Sin esto /lenders nunca ofrece los Creditop X.
async function injectDatacredito(userID: number, income: number, score: number, negatives = 0, consulted = 1): Promise<void> {
    const key = appKey();
    const rcID = await experianRiskCentralID();
    if (rcID === 0) throw new Error('no encontré risk_central Experian (Acierta/+Quanto)');
    const enc = encryptLaravelString(JSON.stringify(datacreditoData(negatives, consulted)), key);
    await exec('DELETE FROM risk_central_user_data WHERE user_id=? AND risk_central_id=?', [userID, rcID]);
    await exec(
        `INSERT INTO risk_central_user_data (uuid, user_id, risk_central_id, score, data, created_at, updated_at)
         VALUES (UUID(), ?, ?, ?, ?, NOW(), NOW())`,
        [userID, rcID, score, enc],
    );
}

export interface SynthFillOpts {
    lender?: string; income?: number; score?: number; name?: string;
    documentType?: string;   // 'CC' | 'CE' | 'PEP' — PEP (Permiso Especial de Permanencia) = migrante SIN buró
    document?: string;       // cédula; default = auto (2.9B + ur)
    gender?: string;         // 'M' | 'F'
    age?: number;
    negatives?: number;      // negativeHistoricalLast12Months del buró (default 0)
    consulted?: number;      // consultedLast6Months del buró (default 1)
}

/** Orquesta el KYC armado sobre un user_request existente. Port de opSynthFill. */
export async function synthFill(uReqID: number, opts: SynthFillOpts = {}): Promise<SynthFillResult> {
    if (!uReqID) throw new Error('uso: synthFill(uReqID, {lender?})');
    assertWriteAllowed();
    appKey(); // falla temprano si no hay APP_KEY

    const userID = (await scalar<number>('SELECT user_id FROM user_requests WHERE id = ?', [uReqID])) ?? 0;
    if (userID === 0) throw new Error(`no hay user_id para el request ${uReqID}`);
    const branchHash = (await scalar<string>(
        `SELECT COALESCE(ab.hash,'') AS h FROM user_requests ur JOIN allied_branches ab ON ab.id = ur.allied_branch_id WHERE ur.id = ? LIMIT 1`,
        [uReqID],
    )) ?? '';

    let req: SynthReq = { fields: { 29: 'Empleado', 160: 'no', 87: '2500000' }, gender: 'M', age: 35, income: 2_500_000, score: 700 };
    let target = '';
    if (opts.lender && branchHash) {
        const l = await resolveLender(branchHash, opts.lender);
        if (l) {
            req = await deriveSynthReq(branchHash, l.id, l.rt);
            target = `${l.name} #${l.id} (rt=${l.rt})`;
            if (l.rt !== 2 && l.rt !== 3) {
                const alliedID = (await scalar<number>('SELECT allied_id FROM allied_branches WHERE hash=? LIMIT 1', [branchHash])) ?? 0;
                await ensureLenderCredential(alliedID, l.id);
            }
        }
    }
    if (opts.income && opts.income > 0) { req.income = opts.income; req.fields[87] = String(opts.income); }
    if (opts.score && opts.score > 0) req.score = opts.score;
    if (opts.gender) req.gender = opts.gender;               // override del panel (ojo: puede no pasar group rules)
    if (opts.age && opts.age > 0) req.age = opts.age;

    const documentType = (opts.documentType || 'CC').toUpperCase();
    const hasBuro = documentType !== 'PEP';                  // PEP = migrante sin buró → se salta la consulta
    const negatives = opts.negatives ?? 0;
    const consulted = opts.consulted ?? 1;

    const doc = (opts.document && opts.document.trim()) || String(2_900_000_000 + uReqID);
    const email = `synth-${uReqID}@creditop.com`;
    await setSynthIdentity(userID, doc, email, req.gender, req.age, opts.name, documentType);
    await injectSummary(userID, req.income, req.score, negatives, consulted, hasBuro);
    await injectIncomeFields(userID, uReqID, req.fields);
    let dc: string;
    if (hasBuro) {
        try {
            await injectDatacredito(userID, req.income, req.score, negatives, consulted);
            dc = `ok (neg ${negatives} · consultas ${consulted})`;
        } catch (e) {
            dc = e instanceof Error ? e.message : String(e);
        }
    } else {
        dc = 'PEP: sin buró (no se inyecta la fila Experian)';
    }

    return {
        user_request_id: uReqID,
        user_id: userID,
        branch_hash: branchHash,
        target_lender: target,
        doc,
        profile: { fields: req.fields, gender: req.gender, age: req.age, income: req.income, score: req.score },
        datacredito_forged: dc,
        note: `KYC armado ${documentType}${hasBuro ? '' : ' · SIN buró'} inyectado (${TARGET}) → navegá a /lenders`,
    };
}

export interface RequestState {
    statusId: number | null;  // user_requests.user_request_status_id — 11 = Estado 11 (Autorizada)
    sealed11: boolean;        // statusId === 11
    creditopXRecords: number; // filas en creditop_x_user_requests_records (rastro del proceso CreditopX)
}

/** Estado del user_request con el MISMO criterio que backend-e2e (user_request_status_id=11 ⇒ Estado 11 /
 *  Autorizada — ver lender/lender.go). OJO: ese sello lo pone la AUTORIZACIÓN del cierre; reachear /lenders
 *  solo lista el marketplace, NO autoriza. Read-only. */
export async function requestEstado11(uReqID: number): Promise<RequestState> {
    const statusId = await scalar<number>('SELECT user_request_status_id FROM user_requests WHERE id=?', [uReqID]);
    const cx = await scalar<number>('SELECT COUNT(*) AS n FROM creditop_x_user_requests_records WHERE user_request_id=?', [uReqID]);
    return { statusId: statusId ?? null, sealed11: Number(statusId) === 11, creditopXRecords: Number(cx) || 0 };
}

/** Bypass del PAGO de cuota inicial (Wompi) en dev: fuerza la transacción a APPROVED (status_id=22 del
 *  lender Wompi #52) — equivalente dev de merchant/seed.ts::approvePaymentTransaction (que usa docker/SQL
 *  local). El down-payment-validation poll-ea check-status → is_approved → sigue el cierre in-platform. */
export async function approvePaymentTx(txId: number): Promise<number> {
    if (!txId) return 0;
    assertWriteAllowed();
    const res = await exec('UPDATE payment_gateway_transactions SET status_id=22 WHERE id=?', [txId]);
    return res.affectedRows;
}

/** Último user_request de un branch (por hash) con id > sinceId. Para el flujo dinámico: el forms-service
 *  crea el user_request al iniciar (sin exponer el uReqID en la URL); snapshot del MAX antes + esto después
 *  ⇒ capturamos el que recién creó el form (determinístico para una corrida). sinceId=0 = el más reciente. */
export async function latestUserRequestId(branchHash: string, sinceId = 0): Promise<number | null> {
    const id = await scalar<number>(
        `SELECT ur.id FROM user_requests ur JOIN allied_branches ab ON ab.id = ur.allied_branch_id
         WHERE ab.hash = ? AND ur.id > ? ORDER BY ur.id DESC LIMIT 1`,
        [branchHash, sinceId],
    );
    return id ?? null;
}
