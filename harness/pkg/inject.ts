// inject.ts — "KYC armado": inyecta identidad + summaries + field values + la fila Experian ENCRIPTADA
// directo en el user_request del wizard, para que /lenders ofrezca sin volver a llamar centrales.
// Port 1:1 de backend-mcp opSynthFill + deriveSynthReq + db.go (setSynthIdentity/injectSummary/
// injectIncomeFields/injectDatacredito/datacreditoData). harness ya no shellea al mcp.
import { query, one, scalar, exec, appKey, withSeedScope, TARGET } from './db.ts';
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
        { permiso: 'credencial-de-entidad' },
    );
    return 'sembrada (copiada de plantilla)';
}

async function setSynthIdentity(userID: number, doc: string, email: string, gender: string, age: number, name?: string, documentType: string | null = 'CC', dobValue = '1990-01-01', expeditionDate = '2010-01-01'): Promise<void> {
    // name opcional (del panel): "Juan Perez" → first_name "Juan", surname "Perez". Default = SYNTH TEST USER.
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    const first = parts[0] ?? 'SYNTH';
    const surnameValue = parts.slice(1).join(' ') || 'TEST USER';
    // LAS DOS FOTOS DE LA CÉDULA. En un flujo real las deja la validación de identidad; el sintético la
    // saltea, así que quedan en NULL — y eso NO se ve hasta el final: la solicitud llega igual a estado
    // 11 y recién la FORMALIZACIÓN (mandarle el paquete al lender) muere con «faltan documentos
    // obligatorios: Cédula frontal, Cédula reverso». El runner mientras tanto reporta «CERRÓ en 11»,
    // así que el hueco se lee como si el flujo hubiera terminado entero.
    //
    // Un string cualquiera alcanza: la validación es sólo que la URL no esté vacía
    // (`CredifamiliaLegalizationDocumentService::isUsableUrl`) y el merge lo hace el pdf-mapper, que en
    // local es un mock y no descarga nada. Se les pone forma de URL de S3 para que se reconozcan como
    // sintéticas al mirarlas en la base.
    const idNumber = (face: string) => `https://mock-s3.local/front-web/users/documents/synth/${doc}/${face}.jpg`;
    // `documentType: null` = NO tocar la columna, dejar el que escribió el alta.
    //
    // ⚠ Existe porque este relleno adelantaba el reloj y tapaba un incidente de producción. En los
    // canales donde el cliente NO declara su tipo de documento antes de la preaprobación —autogestión,
    // que pide sólo teléfono y número—, escribirlo acá le da a la solicitud un dato que en el flujo real
    // todavía no tiene, y la compuerta del lender pasa a ver un tipo válido donde en producción ve el
    // centinela `-`. El recorrido cerraba en verde en local y se cancelaba en producción.
    const typeIsWritten = documentType !== null;
    await exec(
        `UPDATE users SET ${typeIsWritten ? 'document_type=?, ' : ''}document_number=?, first_name=?, surname=?,
         full_name=?, email=?, date_of_birth=?, expedition_date=?,
         age=?, gender=?, front_url=?, back_url=?, updated_at=NOW() WHERE id=?`,
        [...(typeIsWritten ? [documentType] : []), doc, first, surnameValue, `${first} ${surnameValue}`, email, dobValue, expeditionDate, age, gender,
         idNumber('frontal'), idNumber('reverso'), userID],
        { permiso: 'siembra', usuario: userID },
    );
}

async function injectSummary(userID: number, income: number, score: number, negatives = 0, consulted = 1, withBureau = true): Promise<void> {
    const agildata = JSON.stringify({
        employed: true, self_employed: false, retired: false,
        approximate_real_salary: income, last_payment_value: income, lowest_payment_value: income,
        continuity_3_months: true, continuity_6_months: true, continuity_12_months: true,
    });
    // withBureau=false (PEP): guardamos el ingreso (agildata) pero NO el bloque de datacrédito.
    const datacredito = withBureau
        ? JSON.stringify({ score, value_monthly_payment: Math.floor(income / 3), data: datacreditoData(negatives, consulted) })
        : null;
    const id = await scalar<number>('SELECT id FROM user_summaries WHERE user_id = ? LIMIT 1', [userID]);
    if (id && id > 0) {
        // El `AND user_id=?` es redundante para la lógica —`id` salió de buscar por `user_id`— y NO lo
        // es para la guarda: sin él, la sentencia no dice a quién le escribe y el permiso `siembra` no
        // tendría cómo comprobar que la fila es de esta corrida.
        await exec('UPDATE user_summaries SET agildata=?, datacredito=?, updated_at=NOW() WHERE id=? AND user_id=?',
                   [agildata, datacredito, id, userID], { permiso: 'siembra', usuario: userID });
    } else {
        await exec('INSERT INTO user_summaries (user_id, agildata, datacredito, created_at, updated_at) VALUES (?,?,?,NOW(),NOW())',
                   [userID, agildata, datacredito], { permiso: 'siembra', usuario: userID });
    }
}

async function injectIncomeFields(userID: number, uReqID: number, fields: Record<number, string>): Promise<void> {
    // Upserts EN PARALELO: cada campo es una fila EAV distinta (user_id, field_id) — no se pisan entre sí.
    // Contra dev cada query paga ~100ms de round-trip remoto; en serie esto era la mitad del "sembrando"
    // (2 queries × N campos). El pool (connectionLimit 5) encola lo que exceda.
    await Promise.all(Object.entries(fields).map(async ([fidStr, val]) => {
        const fid = Number(fidStr);
        const ex = await scalar<number>('SELECT id FROM user_field_values WHERE user_id=? AND field_id=? AND form_id=1 LIMIT 1', [userID, fid]);
        if (ex && ex > 0) {
            // Mismo motivo que en `injectSummary`: el `AND user_id=?` es para la guarda.
            await exec('UPDATE user_field_values SET value=?, user_request_id=?, updated_at=NOW() WHERE id=? AND user_id=?',
                       [val, uReqID, ex, userID], { permiso: 'siembra', usuario: userID });
        } else {
            await exec(
                'INSERT INTO user_field_values (field_id, user_id, user_request_id, form_id, value, status, created_at, updated_at) VALUES (?,?,?,1,?,1,NOW(),NOW())',
                [fid, userID, uReqID, val],
                { permiso: 'siembra', usuario: userID },
            );
        }
    }));
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
    await exec('DELETE FROM risk_central_user_data WHERE user_id=? AND risk_central_id=?', [userID, rcID],
               { permiso: 'siembra', usuario: userID });
    await exec(
        `INSERT INTO risk_central_user_data (uuid, user_id, risk_central_id, score, data, created_at, updated_at)
         VALUES (UUID(), ?, ?, ?, ?, NOW(), NOW())`,
        [userID, rcID, score, enc],
        { permiso: 'siembra', usuario: userID },
    );
}

export interface SynthFillOpts {
    /** A QUÉ USUARIO inyectarle, si NO es el dueño de la solicitud.
     *
     *  Existe por el CODEUDOR: comparte la `user_request` del titular, así que derivar el usuario de
     *  la solicitud —lo que se hace por defecto— le inyectaría los datos al titular y dejaría al
     *  codeudor sin buró. Y sin buró su elegibilidad no evalúa: falla LEYENDO, no decidiendo (F-153). */
    userId?: number;
    lender?: string; income?: number; score?: number; name?: string;
    documentType?: string;   // 'CC' | 'CE' | 'PEP' — PEP (Permiso Especial de Permanencia) = migrante SIN buró
    /** No tocar `users.document_type`: dejar el que escribió el alta.
     *
     *  Para los canales donde el cliente NO declara su tipo antes de la preaprobación (autogestión pide
     *  teléfono y número, sin tipo). Sin esto el relleno adelanta el reloj y la compuerta del lender ve
     *  un tipo válido donde en producción ve el centinela. Ver `setSynthIdentity`. */
    keepDocumentType?: boolean;
    document?: string;       // cédula; default = auto (2.9B + ur)
    gender?: string;         // 'M' | 'F'
    age?: number;
    negatives?: number;      // negativeHistoricalLast12Months del buró (default 0)
    consulted?: number;      // consultedLast6Months del buró (default 1)
    occupation?: string;     // field 29 (Empleado | Independiente | Pensionado) — default Empleado
    dob?: string;            // date_of_birth (YYYY-MM-DD) — default 1990-01-01
    expeditionDate?: string; // expedition_date (YYYY-MM-DD) — default 2010-01-01
    email?: string;          // default auto (synth-<ur>@creditop.com)
    skipIdentity?: boolean;  // MANUAL: NO escribir identidad (name/doc/dob/email) → personal-info lo llena el usuario; solo inyecta el buró
    // NO forjar la fila Experian. Para el flujo `already-confirmed-pre-approval` (flow_id 2), donde el
    // backend NO consulta el buró: inyectarla contradice el escenario que se quiere probar y, peor,
    // vuelve el resultado ininterpretable — con una fila puesta por nosotros, "hay buró" deja de
    // distinguir si el backend consultó o no. Sin inyectar, "no hay fila" vuelve a significar algo.
    skipBuro?: boolean;
}

/** Orquesta el KYC armado sobre un user_request existente. Port de opSynthFill. */
export async function synthFill(uReqID: number, opts: SynthFillOpts = {}): Promise<SynthFillResult> {
    if (!uReqID) throw new Error('uso: synthFill(uReqID, {lender?})');
    // ⚠ ACÁ HABÍA UN `assertWriteAllowed()` PELADO, y sacarlo es el punto de todo esto: pedía el permiso
    // GENERAL al entrar, así que bloqueaba antes de que cualquier permiso angosto pudiera aplicar.
    // La guarda no se fue: se movió a cada escritura, con el ámbito por usuario que se abre más abajo —
    // una vez que se sabe SOBRE QUIÉN se va a sembrar, que es lo que acá arriba todavía no se sabe.
    appKey(); // falla temprano si no hay APP_KEY

    // Los dos SELECT de contexto son independientes → en paralelo (round-trips remotos, ver injectIncomeFields).
    const [userID, branchHash] = await Promise.all([
        opts.userId
            ? Promise.resolve(opts.userId)
            : scalar<number>('SELECT user_id FROM user_requests WHERE id = ?', [uReqID]).then((v) => v ?? 0),
        scalar<string>(
            `SELECT COALESCE(ab.hash,'') AS h FROM user_requests ur JOIN allied_branches ab ON ab.id = ur.allied_branch_id WHERE ur.id = ? LIMIT 1`,
            [uReqID],
        ).then((v) => v ?? ''),
    ]);
    if (userID === 0) throw new Error(`no hay user_id para el request ${uReqID}`);

    // DESDE ACÁ, y hasta que termine, esta rama puede sembrar sobre ESTE usuario y ninguno más. Es la
    // guarda que reemplaza al permiso general: acota las FILAS, que es lo que la forma de la sentencia
    // no puede acotar cuando la tabla es `users`.
    return withSeedScope([userID], () => seedOver(uReqID, userID, branchHash, opts));
}

/** El cuerpo de `synthFill`, ya con el usuario resuelto y el ámbito abierto. */
async function seedOver(uReqID: number, userID: number, branchHash: string, opts: SynthFillOpts): Promise<SynthFillResult> {
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
    if (opts.occupation) req.fields[29] = opts.occupation;   // ocupación editable (field 29)

    const documentType = (opts.documentType || 'CC').toUpperCase();
    const hasBureau = documentType !== 'PEP';                  // PEP = migrante sin buró → se salta la consulta
    const negatives = opts.negatives ?? 0;
    const consulted = opts.consulted ?? 1;

    const doc = (opts.document && opts.document.trim()) || String(2_900_000_000 + uReqID);
    const email = (opts.email && opts.email.trim()) || `synth-${uReqID}@creditop.com`;
    const dobValue = opts.dob || '1990-01-01';
    const expeditionDate = opts.expeditionDate || '2010-01-01';
    // Los cuatro bloques escriben tablas DISTINTAS (users · user_summaries · user_field_values ·
    // risk_central_user_data) y no dependen entre sí → EN PARALELO. En serie eran ~14 round-trips a dev
    // (~1.5s solo de latencia); en paralelo, el peor bloque (~3 queries encadenadas) marca el total.
    // skipIdentity (manual): no pisamos la identidad → personal-info lo llena el usuario. Igual inyectamos el buró.
    const bureauDone: Promise<string> = (hasBureau && opts.skipBuro)
        ? Promise.resolve('OMITIDO a propósito (flujo already-confirmed-pre-approval): sin fila forjada, "no hay buró" es evidencia')
        : hasBureau
            ? injectDatacredito(userID, req.income, req.score, negatives, consulted)
                .then(() => `ok (neg ${negatives} · consultas ${consulted})`)
                .catch((e) => (e instanceof Error ? e.message : String(e)))
            : Promise.resolve('PEP: sin buró (no se inyecta la fila Experian)');
    const [, , , dc] = await Promise.all([
        opts.skipIdentity ? Promise.resolve() : setSynthIdentity(userID, doc, email, req.gender, req.age, opts.name, opts.keepDocumentType ? null : documentType, dobValue, expeditionDate),
        injectSummary(userID, req.income, req.score, negatives, consulted, hasBureau),
        injectIncomeFields(userID, uReqID, req.fields),
        bureauDone,
    ]);

    return {
        user_request_id: uReqID,
        user_id: userID,
        branch_hash: branchHash,
        target_lender: target,
        doc,
        profile: { fields: req.fields, gender: req.gender, age: req.age, income: req.income, score: req.score },
        datacredito_forged: dc,
        note: `KYC armado ${documentType}${hasBureau ? '' : ' · SIN buró'} inyectado (${TARGET}) → navegá a /lenders`,
    };
}

/**
 * ¿SIGUE EN PIE EL EMPLEO QUE INYECTAMOS? — y si no, reponerlo.
 *
 * POR QUÉ EXISTE. La inyección corre cuando CARGA `personal-info`; **Agildata corre cuando se ENVÍA**.
 * Y `AgildataService::…` cierra con `storeLaboralInformation(user, uReq, approximate_real_salary,
 * employed ? 'Empleado' : (self_employed ? 'Independiente' : 'Desempleado'), continuity)` y además
 * pisa `user_summaries.agildata`. O sea que la respuesta del proveedor **reemplaza** ocupación (29),
 * ingreso (87) y continuidad (161): lo que sembramos antes no sobrevive.
 *
 * Medido el 2026-09-15 contra `qa` (Pullman, solicitud 502341): la inyección escribió
 * `Empleado · 2.500.000` a las 18:36:57 y a las 18:37:03 los campos decían `Desempleado · 0`, con el
 * log diciendo «Agildata: lambda mock responded». Seis segundos. Y el listado, tres segundos después,
 * evaluó esos valores: las tres entidades de la sucursal exigen ocupación ∈ {Empleado, Pensionado,
 * Independiente} —y las dos rt=2, ingreso ≥ 1.000.000—, así que las tres fueron rechazadas y el
 * cliente vio UNA (la rt=0, que rechazada igual se muestra). Parecía un filtro del canal ecommerce.
 *
 * ⚠ En local/dev/qa/staging las centrales las atiende el **lambda de mocks** de la empresa, no el
 * proveedor: su respuesta por defecto para una cédula desconocida es una persona sin empleo y sin
 * ingreso. Se le puede DICTAR la respuesta por cédula, y ése es el arreglo de fondo — esto es la red
 * para cuando no se dictó.
 *
 * Devuelve qué encontró y qué repuso, para que quien llama lo diga en el rastro. No decide: informa y
 * corrige los tres campos, nada más.
 */
export interface EmploymentRestored {
      pisado: boolean;
      ocupacionAntes: string;
      ingresoAntes: string;
      ocupacion: string;
      ingreso: string;
}

export async function restoreEmployment(
      uReqID: number,
      opts: { income?: number; occupation?: string } = {},
): Promise<EmploymentRestored | null> {
      const userID = (await scalar<number>('SELECT user_id FROM user_requests WHERE id = ? LIMIT 1', [uReqID])) ?? 0;
      if (!userID) return null;

      const read = async (fid: number): Promise<string> =>
            (await scalar<string>(
                  'SELECT value FROM user_field_values WHERE user_id=? AND field_id=? AND form_id=1 LIMIT 1',
                  [userID, fid],
            )) ?? '';

      const occupationBefore = await read(29);
      const incomeBefore = await read(87);
      const occupation = opts.occupation || 'Empleado';
      const incomeValue = String(opts.income && opts.income > 0 ? opts.income : 2_500_000);

      // Sólo se repone lo que NO coincide: una escritura que no cambia nada es ruido en el registro.
      const overwritten = occupationBefore !== occupation || incomeBefore !== incomeValue;
      if (overwritten) {
            await injectIncomeFields(userID, uReqID, { 29: occupation, 87: incomeValue });
      }
      return { pisado: overwritten, ocupacionAntes: occupationBefore, ingresoAntes: incomeBefore, ocupacion: occupation, ingreso: incomeValue };
}

/** El aviso, en líneas listas para imprimir. Vacío cuando el empleo sobrevivió. */
export function overwrittenEmploymentNotice(r: EmploymentRestored | null): string[] {
      if (!r || !r.pisado) return [];
      return [
            `⚠ EL EMPLEO QUE SE INYECTÓ NO SOBREVIVIÓ: la respuesta de Agildata lo reemplazó.`,
            `    ocupación  ${r.ocupacionAntes || '(vacía)'} → repuesta a ${r.ocupacion}`,
            `    ingreso    ${r.ingresoAntes || '(vacío)'} → repuesto a ${r.ingreso}`,
            `  Pasa porque la inyección corre al CARGAR personal-info y Agildata contesta al ENVIARLO,`,
            `  y su respuesta escribe esos campos. En este ambiente contesta el lambda de mocks, y para`,
            `  una cédula que no le dictaste devuelve una persona sin empleo y sin ingreso. Las reglas`,
            `  duras evalúan ESTO, así que sin reponerlo el listado sale corto y parece un filtro del canal.`,
      ];
}

export interface RequestState {
    statusId: number | null;  // user_requests.user_request_status_id — 11 = Estado 11 (Autorizada)
    sealed11: boolean;        // statusId === 11
    creditopXRecords: number; // filas en creditop_x_user_requests_records (rastro del proceso CreditopX)
}

/** Estado del user_request con el MISMO criterio que backend-e2e (user_request_status_id=11 ⇒ Estado 11 /
 *  Autorizada — ver lender/lender.go). OJO: ese sello lo pone la AUTORIZACIÓN del cierre; reachear /lenders
 *  solo lista el marketplace, NO autoriza. Read-only. */
export async function requestStatus11(uReqID: number): Promise<RequestState> {
    const statusId = await scalar<number>('SELECT user_request_status_id FROM user_requests WHERE id=?', [uReqID]);
    const cx = await scalar<number>('SELECT COUNT(*) AS n FROM creditop_x_user_requests_records WHERE user_request_id=?', [uReqID]);
    return { statusId: statusId ?? null, sealed11: Number(statusId) === 11, creditopXRecords: Number(cx) || 0 };
}

/** LA VALIDACIÓN MANUAL DE IDENTIDAD, que es lo que un humano aprieta en el admin cuando mira los
 *  documentos del cliente. Con esto puesto, el backend NO manda a validar identidad: devuelve
 *  `next_step: continue_flow` con `type: no_validation_required` y el flujo sigue al plan de pagos.
 *
 *  DOS COLUMNAS, NO UNA TABLE. No hay veredicto guardado en ningún lado: la condición que salta la
 *  identidad es `manual_validation = 1` **y** `last_validation` con menos de 24 h
 *  (`CreditopXFlowService::getIdentityNextStepData`, que cruza `calculateValidationTime` con
 *  `$user->manual_validation`). Por eso `NOW()` no es decorativo: con una fecha vieja, la columna en 1
 *  no hace nada. Y es POR USUARIO, no por solicitud — si el cliente tiene dos, las dos quedan.
 *
 *  POR QUÉ ACÁ Y NO POR LA API. El gemelo existe y está abierto en legacy-backend
 *  (`PATCH /api/loans/admin/users/{id}/manual-validation`, sólo middleware `api`: sin token ni
 *  sesión), pero además de estas dos columnas **manda un WhatsApp al celular del cliente** con el
 *  enlace para continuar (`NotificationService::sendManualValidationResponse`). Los teléfonos que
 *  deriva este runner tienen forma de celular colombiano válido, así que ese mensaje puede llegarle a
 *  una persona. Acá se escribe sólo lo que el flujo necesita. Si algún día hay que probar que el
 *  mensaje llega, ESE caso va por la API.
 *
 *  Y de paso saltea el candado de 24 h del endpoint (revalidar dentro de la ventana responde 422 «ya
 *  tiene una validación manual activa»), que para repetir un caso es a favor.
 *
 *  ⚠ Lo que ESTO no prueba: que el humano habría aprobado. Es un bypass, igual que el buró sintético.
 */
export async function manualValidation(userId: number): Promise<number> {
    if (!userId) return 0;
    // Abre su propio ámbito: se la llama SUELTA desde los runners, después de `synthFill`, así que no
    // hereda ninguno. Es el mismo usuario y la misma corrida.
    return withSeedScope([userId], async () => {
        const res = await exec('UPDATE users SET manual_validation=1, last_validation=NOW() WHERE id=?', [userId],
                               { permiso: 'siembra', usuario: userId });
        return res.affectedRows;
    });
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
