// copy-creditopx.ts — trae de PRODUCCIÓN a qa (o local) un comercio con su entidad CreditopX, en copia MÍNIMA: el
// comercio, UNA sucursal de ecommerce nueva y la configuración de la entidad. Nada de clientes, créditos ni historial.
//
//   cd harness && E2E_TARGET=qa node dev/copy-creditopx.ts --allied 350 --lender 200 --rules-branch 2326 \
//       --base-branch 2412 --name 'PRUEBA AUTO · Mario Hernández' --branch-name 'Tienda VTEX'          vista previa
//   … --apply   (con I_KNOW_THIS_TOUCHES_SHARED_DEV=1 si el target es la base compartida)                  escribe
//
// Por qué así:
//   · Lee producción por el conector (`bin/pg sql --target prod`, sólo lectura) y escribe en el target por pkg/db, con
//     la guarda de escrituras en CADA sentencia y todo en UNA transacción: o queda la copia entera o nada.
//   · Conserva el id del comercio y de la entidad (tienen que estar libres en el target): las tablas que los nombran
//     se copian sin reescribir nada. El resto de las filas toma ids nuevos.
//   · Copia sólo las columnas que existen en el target (una rama puede tener una columna más o una menos), y deja en
//     NULL las que huelen a secreto (token, secret, password, key, credential): un secreto de producción no baja.
//   · Las reglas duras se copian dos veces, como las deja el admin: la plantilla (group_rule_id nulo, la que lee el
//     cupo) y el grupo de UNA sucursal real (--rules-branch, el que lee el listado), reapuntado a la sucursal nueva.
//     Lo mismo la regla de buró: la fila sin sucursal y la de esa sucursal.
//   · La sucursal nueva sale de --base-branch (sus datos, con otro nombre y otro hash) y lleva una credencial de
//     ecommerce del mismo tipo que la de la sucursal de prueba VTEX del target (--ecommerce-like, por defecto
//     ecf9342be), y un token Sanctum de payment-link: en la base queda su hash, y el texto en harness/.env.<target>.
//   · Revisa las claves foráneas declaradas en el target: una fila que apunta a algo que el target no tiene se
//     informa antes de escribir.
// Deshacer: el script imprime y guarda (en .runs/copy-creditopx/) los DELETE de exactamente lo que creó.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TARGET, query, one, close, withConnection, assertWriteAllowed, mutationOf } from '../pkg/db.ts';

const argv = process.argv.slice(2);
const flag = (name: string, def = '') => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const APPLY = argv.includes('--apply');
// --complete: la entidad ya está en el target (de una copia anterior); agrega sólo lo que le falte del puntaje del rotativo.
const COMPLETE = argv.includes('--complete');
const ALLIED = Number(flag('allied'));
const LENDER = Number(flag('lender'));
const RULES_BRANCH = Number(flag('rules-branch'));
const BASE_BRANCH = Number(flag('base-branch'));
const NAME = flag('name');
const BRANCH_NAME = flag('branch-name', 'Tienda VTEX');
const ECOMMERCE_LIKE = flag('ecommerce-like', 'ecf9342be');

if (COMPLETE ? !LENDER : (!ALLIED || !LENDER || !RULES_BRANCH || !BASE_BRANCH || !NAME)) {
    console.error('uso: E2E_TARGET=qa node dev/copy-creditopx.ts --allied N --lender N --rules-branch N --base-branch N --name \'PRUEBA AUTO · …\' [--branch-name …] [--apply]');
    console.error('     E2E_TARGET=qa node dev/copy-creditopx.ts --complete --lender N [--apply]   agrega lo que le falte a una copia anterior');
    process.exit(2);
}
if (!process.env.E2E_TARGET || TARGET === 'prod') { console.error('✗ E2E_TARGET explícito y distinto de prod: este comando escribe'); process.exit(2); }

const PG = join(import.meta.dirname, '..', '..', 'bin', 'pg');
type Row = Record<string, any>;
function prod(sql: string): Row[] {
    const out = execFileSync(PG, ['sql', '--target', 'prod', '--json', '--query', sql], { encoding: 'utf8', maxBuffer: 64 << 20 });
    return JSON.parse(out).rows ?? [];
}

const SECRET = /secret|password|token|api_?key|credential|private/i;
// Datos de personas de producción (el contacto de una sucursal, un correo o un teléfono): no bajan a qa.
const PERSONAL = /^(contact|.*e_?mail.*|.*phone.*|.*celular.*|document_number|.*representative.*|legal_.*)$/i;
const personalNulled: string[] = [];
const NOW = new Date().toISOString().slice(0, 19).replace('T', ' ');
const sqlDate = (v: any) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v) ? v.slice(0, 19).replace('T', ' ') : v);

// ── las columnas del target, por tabla ──
const cols = new Map<string, Set<string>>();
async function targetCols(table: string): Promise<Set<string>> {
    if (!cols.has(table)) {
        const r = await query<{ c: string }>('SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [table]);
        cols.set(table, new Set(r.map((x) => x.c)));
    }
    return cols.get(table)!;
}

// ── el plan: filas a insertar, con referencias simbólicas a lo que se crea en la misma corrida ──
type Ref = { ref: string };
type Planned = { table: string; row: Record<string, any>; key?: string; note?: string };
const plan: Planned[] = [];
const dropped: string[] = [];
const secretsNulled: string[] = [];

async function shape(table: string, src: Row, overrides: Record<string, any> = {}, keepId = false): Promise<Record<string, any>> {
    const tc = await targetCols(table);
    const row: Record<string, any> = {};
    for (const [k, v] of Object.entries(src)) {
        if (!tc.has(k)) { if (!dropped.includes(`${table}.${k}`)) dropped.push(`${table}.${k}`); continue; }
        if (k === 'id' && !keepId) continue;
        if (SECRET.test(k) && v !== null && !(k in overrides)) { row[k] = null; secretsNulled.push(`${table}.${k}`); continue; }
        if (PERSONAL.test(k) && v !== null && !(k in overrides)) { row[k] = null; personalNulled.push(`${table}.${k}`); continue; }
        row[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : sqlDate(v);
    }
    if (tc.has('created_at')) row.created_at = NOW;
    if (tc.has('updated_at')) row.updated_at = NOW;
    return { ...row, ...overrides };
}

async function build() {
    // Precondiciones en el target
    if (await one('SELECT id FROM allieds WHERE id = ?', [ALLIED])) throw new Error(`el comercio ${ALLIED} ya existe en ${TARGET}`);
    if (await one('SELECT id FROM lenders WHERE id = ?', [LENDER])) throw new Error(`la entidad ${LENDER} ya existe en ${TARGET}`);

    const allied = prod(`SELECT * FROM allieds WHERE id = ${ALLIED}`)[0];
    const lender = prod(`SELECT * FROM lenders WHERE id = ${LENDER}`)[0];
    if (!allied || !lender) throw new Error('el comercio o la entidad no existen en producción');
    plan.push({ table: 'allieds', row: await shape('allieds', allied, { name: NAME }, true), note: `«${allied.name}» → «${NAME}»` });
    plan.push({ table: 'lenders', row: await shape('lenders', lender, {}, true), note: `«${lender.name}», response_type ${lender.response_type}` });

    for (const t of ['lenders_by_allieds']) {
        for (const r of prod(`SELECT * FROM ${t} WHERE allied_id = ${ALLIED} AND lender_id = ${LENDER}`)) plan.push({ table: t, row: await shape(t, r, { confirmation_emails: '[]' }), note: 'sin los correos de confirmación de prod' });
    }
    for (const t of ['credit_line_by_lenders', 'payment_methods_by_lender', 'lender_identity_validation_types', 'creditop_x_revolving_lender_settings',
        'creditop_x_revolving_fixed_expense_rules', 'creditop_x_profiling_down_payment_FGA']) {
        for (const r of prod(`SELECT * FROM ${t} WHERE lender_id = ${LENDER}`)) plan.push({ table: t, row: await shape(t, r) });
    }
    await planRevolvingScoring(new Map());
    for (const r of prod(`SELECT * FROM datacredito_frequencies WHERE allied_id = ${ALLIED}`)) plan.push({ table: 'datacredito_frequencies', row: await shape('datacredito_frequencies', r) });
    // El contador de consultas a Experian del comercio es uso de producción, no configuración: arranca en 0.
    for (const r of prod(`SELECT * FROM datacredito_query_by_allieds WHERE allied_id = ${ALLIED}`)) plan.push({ table: 'datacredito_query_by_allieds', row: await shape('datacredito_query_by_allieds', r, { count: 0 }), note: `en prod ${r.count}` });

    // La sucursal nueva, a partir de --base-branch
    const base = prod(`SELECT * FROM allied_branches WHERE id = ${BASE_BRANCH} AND allied_id = ${ALLIED}`)[0];
    if (!base) throw new Error(`la sucursal ${BASE_BRANCH} no es del comercio ${ALLIED}`);
    let hash = '';
    do { hash = randomBytes(4).toString('hex').slice(0, 8); } while (await one('SELECT id FROM allied_branches WHERE hash = ?', [hash]));
    plan.push({ table: 'allied_branches', key: 'branch', row: await shape('allied_branches', base, { name: BRANCH_NAME, hash, qr_image: null, address: `${BRANCH_NAME} (prueba), Bogotá D.C.` }), note: `desde «${base.name}» (${BASE_BRANCH}) · hash ${hash}` });

    // Asignación de la entidad a la sucursal: la de la sucursal de reglas
    for (const r of prod(`SELECT * FROM lenders_by_allied_branches WHERE lender_id = ${LENDER} AND allied_branch_id = ${RULES_BRANCH}`)) {
        plan.push({ table: 'lenders_by_allied_branches', row: await shape('lenders_by_allied_branches', r, { allied_branch_id: { ref: 'branch' } as Ref }) });
    }

    // Reglas: la plantilla y el grupo de la sucursal de reglas
    for (const r of prod(`SELECT * FROM lender_rules WHERE lender_id = ${LENDER} AND group_rule_id IS NULL ORDER BY id`)) {
        plan.push({ table: 'lender_rules', row: await shape('lender_rules', r), note: 'plantilla' });
    }
    const groups = prod(`SELECT DISTINCT gr.* FROM group_rules gr JOIN lender_rules lr ON lr.group_rule_id = gr.id WHERE lr.lender_id = ${LENDER} AND gr.allied_branch_id = ${RULES_BRANCH}`);
    for (const [i, g] of groups.entries()) {
        const key = `group${i}`;
        plan.push({ table: 'group_rules', key, row: await shape('group_rules', g, { allied_branch_id: { ref: 'branch' } as Ref }), note: `copia del grupo ${g.id} de la sucursal ${RULES_BRANCH}` });
        for (const r of prod(`SELECT * FROM lender_rules WHERE group_rule_id = ${g.id} ORDER BY id`)) {
            plan.push({ table: 'lender_rules', row: await shape('lender_rules', r, { group_rule_id: { ref: key } as Ref }), note: `del grupo ${g.id}` });
        }
    }
    for (const r of prod(`SELECT * FROM lender_datacredito_rules WHERE lender_id = ${LENDER} AND (allied_branch_id IS NULL OR allied_branch_id = ${RULES_BRANCH}) ORDER BY allied_branch_id IS NULL DESC`)) {
        const over = r.allied_branch_id === null ? {} : { allied_branch_id: { ref: 'branch' } as Ref };
        plan.push({ table: 'lender_datacredito_rules', row: await shape('lender_datacredito_rules', r, over), note: r.allied_branch_id === null ? 'plantilla' : `de la sucursal ${RULES_BRANCH}` });
    }

    // Credencial de ecommerce y token, como los de la sucursal de prueba VTEX del target
    // customer_key/customer_secret/headers son la llave de la TIENDA VTEX (cifradas con la APP_KEY del target): con ellas
    // el backend le avisa a VTEX el desenlace (VtexNotifier). Sin ellas el aviso falla con «The payload is invalid» y el
    // pedido queda en Authorizing (2026-11-06). Es la misma tienda de pruebas: se copian cifradas, sin leerlas.
    const like = await one<Row>('SELECT aec.ecommerce_type_id, aec.customer_key, aec.customer_secret, aec.headers FROM allied_ecommerce_credentials aec JOIN allied_branches b ON b.id = aec.allied_branch_id WHERE b.hash = ?', [ECOMMERCE_LIKE]);
    if (!like) throw new Error(`la sucursal ${ECOMMERCE_LIKE} no tiene credencial de ecommerce en ${TARGET}`);
    const tok = await one<Row>("SELECT tokenable_type FROM personal_access_tokens WHERE name = 'ecommerce-payment-link' LIMIT 1");
    if (!tok) throw new Error(`no hay tokens de payment-link en ${TARGET} para copiar su forma`);
    const credential = randomBytes(20).toString('hex');
    const plainToken = randomBytes(30).toString('base64url').slice(0, 40);
    plan.push({ table: 'allied_ecommerce_credentials', key: 'credential', row: { allied_id: ALLIED, allied_branch_id: { ref: 'branch' }, credential, ecommerce_type_id: like.ecommerce_type_id, customer_key: like.customer_key, customer_secret: like.customer_secret, headers: like.headers, created_at: NOW, updated_at: NOW }, note: `tipo ${like.ecommerce_type_id} y las llaves de la tienda (cifradas) de ${ECOMMERCE_LIKE}; la credencial es nueva (no se muestra)` });
    plan.push({ table: 'personal_access_tokens', key: 'token', row: { tokenable_type: tok.tokenable_type, tokenable_id: { ref: 'branch' }, name: 'ecommerce-payment-link', token: createHash('sha256').update(plainToken).digest('hex'), abilities: '["ecommerce"]', created_at: NOW, updated_at: NOW }, note: 'el texto queda en harness/.env.' + TARGET });
    return { hash, credential, plainToken };
}

// ── el puntaje del rotativo ──
// Las variables del multiplicador tienen sus RANGOS en otra tabla, colgados de la variable y no de la entidad (sin
// ellos cada variable puntúa 0, el multiplicador da 0 y el cupo rotativo sale en 0: la entidad no aparece en el
// listado; pasó en la primera copia de Mario, 2026-11-06). `existing` trae las variables que el target ya tiene, por
// nombre: a ésas sólo se les agregan los rangos que les falten. Va también la última foto de condiciones (la que
// muestra el editor del backoffice), sin quién la cambió.
async function planRevolvingScoring(existing: Map<string, { id: number; ranges: number }>) {
    const vars = prod(`SELECT * FROM creditop_x_revolving_multiplier_variables WHERE lender_id = ${LENDER} ORDER BY id`);
    for (const v of vars) {
        const have = existing.get(v.name);
        let varRef: number | Ref;
        if (have) {
            varRef = have.id;
            if (have.ranges > 0) continue;
        } else {
            plan.push({ table: 'creditop_x_revolving_multiplier_variables', key: `var:${v.name}`, row: await shape('creditop_x_revolving_multiplier_variables', v) });
            varRef = { ref: `var:${v.name}` };
        }
        for (const r of prod(`SELECT * FROM creditop_x_revolving_multiplier_ranges WHERE multiplier_variable_id = ${v.id} ORDER BY min_range`)) {
            plan.push({ table: 'creditop_x_revolving_multiplier_ranges', row: await shape('creditop_x_revolving_multiplier_ranges', r, { multiplier_variable_id: varRef }), note: v.name });
        }
    }
    const hasSnapshot = existing.size > 0 && await one('SELECT id FROM creditop_x_revolving_conditions_snapshots WHERE lender_id = ? LIMIT 1', [LENDER]);
    const snap = prod(`SELECT * FROM creditop_x_revolving_conditions_snapshots WHERE lender_id = ${LENDER} ORDER BY version DESC LIMIT 1`)[0];
    if (snap && !hasSnapshot) {
        plan.push({ table: 'creditop_x_revolving_conditions_snapshots', row: await shape('creditop_x_revolving_conditions_snapshots', snap, { changed_by_email: null, changed_by_name: null, changed_by_user_id: null }), note: `versión ${snap.version}, sin quién la cambió` });
    }
}

async function buildComplete() {
    if (!(await one('SELECT id FROM lenders WHERE id = ?', [LENDER]))) throw new Error(`la entidad ${LENDER} no está en ${TARGET}: corré la copia completa`);
    const rows = await query<{ id: number; name: string; ranges: number }>(
        `SELECT v.id, v.name, (SELECT COUNT(*) FROM creditop_x_revolving_multiplier_ranges r WHERE r.multiplier_variable_id = v.id) ranges
         FROM creditop_x_revolving_multiplier_variables v WHERE v.lender_id = ?`, [LENDER]);
    await planRevolvingScoring(new Map(rows.map((r) => [r.name, { id: r.id, ranges: Number(r.ranges) }])));
    return null;
}

// ── claves foráneas declaradas en el target ──
async function foreignKeyProblems(): Promise<string[]> {
    const tables = [...new Set(plan.map((p) => p.table))];
    const fks = await query<{ t: string; c: string; rt: string; rc: string }>(
        `SELECT TABLE_NAME t, COLUMN_NAME c, REFERENCED_TABLE_NAME rt, REFERENCED_COLUMN_NAME rc FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL AND TABLE_NAME IN (${tables.map(() => '?').join(',')})`, tables);
    const created = new Map<string, Set<any>>([['allieds', new Set([ALLIED])], ['lenders', new Set([LENDER])]]);
    const problems: string[] = [];
    for (const p of plan) for (const fk of fks.filter((f) => f.t === p.table)) {
        const v = p.row[fk.c];
        if (v === null || v === undefined || typeof v === 'object') continue;
        if (created.get(fk.rt)?.has(Number(v))) continue;
        const ok = await one(`SELECT 1 FROM \`${fk.rt}\` WHERE \`${fk.rc}\` = ? LIMIT 1`, [v]);
        if (!ok) problems.push(`${p.table}.${fk.c} = ${v} → ${fk.rt}.${fk.rc} no existe en ${TARGET}`);
    }
    return problems;
}

const show = (v: any) => (v && typeof v === 'object' && 'ref' in v ? `<${v.ref} nuevo>` : v === null ? 'NULL' : String(v).length > 60 ? JSON.stringify(String(v).slice(0, 57) + '…') : JSON.stringify(v));

try {
    const made = COMPLETE ? await buildComplete() : await build();
    const problems = await foreignKeyProblems();
    console.log(made ? `\n  copia mínima prod → ${TARGET}: comercio ${ALLIED} + entidad ${LENDER} · sucursal nueva «${BRANCH_NAME}» (${made.hash}) · reglas de la sucursal ${RULES_BRANCH}\n` : `\n  completar la entidad ${LENDER} en ${TARGET} con lo que le falte de prod\n`);
    if (!plan.length) console.log('  nada que agregar: ya tiene todo');
    const byTable = new Map<string, Planned[]>();
    for (const p of plan) byTable.set(p.table, [...(byTable.get(p.table) ?? []), p]);
    for (const [t, ps] of byTable) {
        console.log(`  ── ${t} · ${ps.length} fila(s)`);
        for (const p of ps) {
            const shown = Object.entries(p.row).filter(([k]) => !['created_at', 'updated_at'].includes(k) && !(t === 'allied_ecommerce_credentials' && ['credential', 'customer_key', 'customer_secret', 'headers'].includes(k)) && !(t === 'personal_access_tokens' && k === 'token'));
            console.log(`     ${p.note ? `(${p.note}) ` : ''}${shown.map(([k, v]) => `${k}=${show(v)}`).join(' · ')}`);
        }
    }
    if (dropped.length) console.log(`\n  columnas de prod que el target no tiene (no se copian): ${dropped.join(', ')}`);
    if (personalNulled.length) console.log(`  columnas con datos de personas (quedan en NULL): ${[...new Set(personalNulled)].join(', ')}`);
    if (secretsNulled.length) console.log(`  columnas que parecen secretos (quedan en NULL): ${[...new Set(secretsNulled)].join(', ')}`);
    console.log(problems.length ? `\n  ✗ claves foráneas sin destino en ${TARGET}:\n    ${problems.join('\n    ')}` : `\n  ✓ claves foráneas: todas apuntan a algo que ${TARGET} tiene`);

    if (!APPLY) {
        console.log('\n  (vista previa: no se escribió nada · repetí con --apply)');
    } else if (problems.length) {
        console.log('\n  ✗ no se escribe: hay claves foráneas sin destino');
        process.exitCode = 1;
    } else {
        const ids = new Map<string, number>();
        const undo: string[] = [];
        await withConnection(async (c) => {
            await c.beginTransaction();
            try {
                for (const p of plan) {
                    const row = Object.fromEntries(Object.entries(p.row).map(([k, v]) => [k, v && typeof v === 'object' && 'ref' in v ? ids.get(v.ref) : v]));
                    const keys = Object.keys(row);
                    const sql = `INSERT INTO \`${p.table}\` (${keys.map((k) => `\`${k}\``).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
                    const m = mutationOf(sql);
                    assertWriteAllowed(`${m?.op} ${m?.tabla}`, sql);
                    const [res]: any = await c.query(sql, keys.map((k) => row[k]));
                    const id = row.id ?? res.insertId;
                    if (p.key) ids.set(p.key, id);
                    undo.unshift(`DELETE FROM \`${p.table}\` WHERE id = ${Number(id)};`);
                }
                await c.commit();
            } catch (e) {
                await c.rollback();
                throw e;
            }
        });
        const dir = join(import.meta.dirname, '..', '.runs', 'copy-creditopx');
        mkdirSync(dir, { recursive: true });
        const undoFile = join(dir, `${TARGET}-${COMPLETE ? `lender${LENDER}-completar` : ALLIED}-${new Date().toISOString().replace(/[:.]/g, '-')}-deshacer.sql`);
        writeFileSync(undoFile, undo.join('\n') + '\n');
        if (made) {
        const tokenLine = `${ids.get('token')}|${made.plainToken}`;
        appendFileSync(join(import.meta.dirname, '..', `.env.${TARGET}`), `\n# copy-creditopx ${NOW}: sucursal ${made.hash} del comercio ${ALLIED}\nCOPY_${ALLIED}_BRANCH_HASH=${made.hash}\nCOPY_${ALLIED}_PAYMENT_LINK_TOKEN=${tokenLine}\n`);
        console.log(`\n  ✓ escrito en una transacción: ${plan.length} filas · sucursal ${ids.get('branch')} (${made.hash})`);
        console.log(`  el token (y el hash) quedaron en harness/.env.${TARGET} como COPY_${ALLIED}_*`);
        } else {
            console.log(`\n  ✓ escrito en una transacción: ${plan.length} filas`);
        }
        console.log(`  deshacer: ${undoFile}`);
    }
} catch (e) {
    console.error('  ✗ ' + (e as Error).message);
    process.exitCode = 1;
} finally {
    await close();
}
