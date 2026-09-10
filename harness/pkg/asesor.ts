// asesor.ts — asociar/desasociar un asesor (fila users por cognito_id) a la sucursal de un comercio,
// + scrub de clientes por teléfono. Port de backend-mcp asesor.go (+ deleteUsers/childTables de db.go).
// Reversible: assign guarda .asesor-snapshot.json y revoke lo restaura (o borra la fila si la creamos).
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { query, one, scalar, exec, withConnection, assertWriteAllowed, TARGET } from './db.ts';
import { resolveMerchant, ensureBranch } from './merchants.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = resolve(ROOT, '.asesor-snapshot.json');

// hash bcrypt placeholder (no se usa: el login es por header x-cognito-identity-id; columna NOT NULL).
const PLACEHOLDER_PASSWORD = '$2y$12$uBbVUxorF2lcsD0KsWA5J.vkzlV//OSy7wOx7WchEBMKRWxP4TnH.';

// childTables — filas hijas a borrar antes del user (por user_request_id y por user_id). De db.go.
const childTables = [
    'confirmation_email_logs', 'lender_transactions', 'user_request_products',
    'user_request_modes', 'user_request_device_infos', 'risk_central_user_data',
    'user_summaries', 'user_field_values', 'creditop_x_consents',
    'revolving_credits', 'promissory_notes', 'logs', 'twilio_logs',
    'creditop_x_user_requests_records', 'creditop_x_revolving_credits',
    'user_requests_by_ecommerce_request',
];

export interface AsesorRow {
    id: number;
    cognito_id: string;
    email: string;
    full_name: string;
    allied_id: number | null;
    allied_branch_id: number | null;
    allied_branch_hash: string;
    user_profile_id: number | null;
    status: number;
}

interface AsesorSnapshot {
    query: string;
    cognito_id: string;
    prev_cognito_id: string;
    existed: boolean;
    row_id: number;
    prev_allied_id: number | null;
    prev_allied_branch_id: number | null;
    prev_user_profile_id: number | null;
    merchant: string;
    new_allied_id: number;
    new_allied_branch_id: number;
}

const alnum = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const nullIfZero = (n: number): number | null => (n === 0 ? null : n);

/** uniquePhone — hash uint32 (con wraparound) del id → "3" + 9 dígitos. Réplica byte-exacta de Go. */
function uniquePhone(id: string): string {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
    return '3' + String(h % 1_000_000_000).padStart(9, '0');
}

/** Filas users por cognito_id EXACTO o email LIKE %q%. */
export async function findAsesorUsers(q: string): Promise<AsesorRow[]> {
    return query<AsesorRow>(
        `SELECT u.id, COALESCE(u.cognito_id,'') AS cognito_id, COALESCE(u.email,'') AS email,
                COALESCE(u.full_name,'') AS full_name, u.allied_id, u.allied_branch_id,
                COALESCE(ab.hash,'') AS allied_branch_hash, u.user_profile_id, COALESCE(u.status,0) AS status
         FROM users u LEFT JOIN allied_branches ab ON ab.id = u.allied_branch_id
         WHERE u.cognito_id = ? OR u.email LIKE ? ORDER BY u.id LIMIT 20`,
        [q, '%' + q + '%'],
    );
}

/** whois (read-only): filas users que matchean por cognito_id o email. */
export async function whois(q: string): Promise<{ query: string; count: number; matches: AsesorRow[] }> {
    if (!q.trim()) throw new Error('uso: whois <email|cognito_id>');
    const matches = await findAsesorUsers(q);
    return { query: q, count: matches.length, matches };
}

/** assign (WRITE): asocia el asesor a la sucursal del comercio. UPDATE si hay fila, INSERT si q es un sub. */
export async function assign(q: string, merchantQ: string, branchHash = '', realSub = ''): Promise<Record<string, unknown>> {
    if (!q.trim() || !merchantQ.trim()) throw new Error('uso: assign <email|cognito_id> <merchant> [branchHash] [realSub]');
    assertWriteAllowed();

    // resolver allied + sucursal ACTIVA
    let alliedID = 0, branchID = 0, merchantLabel = '';
    let resolved = false;
    if (branchHash) {
        const r = await one<{ allied_id: number; id: number }>(
            'SELECT allied_id, id FROM allied_branches WHERE hash=? AND status=1 LIMIT 1', [branchHash],
        );
        if (r) { alliedID = r.allied_id; branchID = r.id; merchantLabel = 'branch:' + branchHash; resolved = true; }
    }
    if (!resolved) {
        const m = await resolveMerchant(merchantQ);
        const br = await ensureBranch(m.alliedId, branchHash);
        alliedID = m.alliedId; branchID = br.id; merchantLabel = m.slug;
    }
    const resolvedHash = (await scalar<string>("SELECT COALESCE(hash,'') AS h FROM allied_branches WHERE id=? LIMIT 1", [branchID])) ?? '';
    const profileID = (await scalar<number>('SELECT id FROM user_profiles WHERE name=? LIMIT 1', ['Comercial'])) ?? 0;

    const rows = await findAsesorUsers(q);
    let target: AsesorRow | null = rows.find((r) => r.cognito_id === q) ?? null;
    if (!target && rows.length === 1) target = rows[0];
    if (!target && rows.length > 1) throw new Error(`${JSON.stringify(q)} matchea ${rows.length} usuarios; pasá el cognito_id exacto`);

    const snap: AsesorSnapshot = {
        query: q, cognito_id: '', prev_cognito_id: '', existed: false, row_id: 0,
        prev_allied_id: null, prev_allied_branch_id: null, prev_user_profile_id: null,
        merchant: merchantLabel, new_allied_id: alliedID, new_allied_branch_id: branchID,
    };
    let createdNew = false;

    if (target) {
        const newCognito = realSub || target.cognito_id; // el sub REAL del login web corrige un cognito_id viejo
        snap.existed = true; snap.row_id = target.id;
        snap.prev_cognito_id = target.cognito_id; snap.cognito_id = newCognito;
        snap.prev_allied_id = target.allied_id; snap.prev_allied_branch_id = target.allied_branch_id; snap.prev_user_profile_id = target.user_profile_id;
        await exec(
            'UPDATE users SET cognito_id=?, allied_id=?, allied_branch_id=?, user_profile_id=?, status=1, updated_at=NOW() WHERE id=?',
            [newCognito, alliedID, branchID, nullIfZero(profileID), target.id],
        );
    } else {
        const cognitoForRow = realSub || q;
        if (cognitoForRow.includes('@')) throw new Error(`no hay usuario para ${JSON.stringify(q)} (es un email) — pasá el cognito_id (sub) para crear la fila`);
        createdNew = true;
        snap.existed = false; snap.cognito_id = cognitoForRow;
        const clean = alnum(cognitoForRow).slice(0, 12);
        const email = 'asesor-' + clean + '@creditop.com';
        const doc = ('TA' + clean).toUpperCase().slice(0, 20);
        const res = await exec(
            'INSERT INTO users (cognito_id, first_name, surname, full_name, email, cell_phone, document_number, ' +
            'document_type, country_id, allied_id, allied_branch_id, user_profile_id, status, password, created_at, updated_at) ' +
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,NOW(),NOW())',
            [cognitoForRow, 'ASESOR', 'PRUEBA', 'ASESOR PRUEBA', email, uniquePhone(cognitoForRow), doc, 'CC', 1, alliedID, branchID, nullIfZero(profileID), PLACEHOLDER_PASSWORD],
        );
        snap.row_id = res.insertId;
    }

    writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 2), { mode: 0o600 });
    const after = await findAsesorUsers(snap.cognito_id);
    return {
        assigned: true, merchant: merchantLabel, allied_id: alliedID, allied_branch_id: branchID,
        allied_branch_hash: resolvedHash, cognito_id: snap.cognito_id, created_new_row: createdNew,
        snapshot: SNAPSHOT, after, revert: 'node bin/dbops.ts revoke',
    };
}

/** revoke (WRITE): revierte el último assign usando el snapshot. */
export async function revoke(): Promise<Record<string, unknown>> {
    if (!existsSync(SNAPSHOT)) throw new Error(`no hay snapshot (${SNAPSHOT}) — nada que revertir`);
    assertWriteAllowed();
    const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as AsesorSnapshot;
    const out: Record<string, unknown> = { cognito_id: snap.cognito_id, merchant: snap.merchant, row_id: snap.row_id };
    if (snap.existed) {
        if (snap.prev_cognito_id) {
            await exec(
                'UPDATE users SET cognito_id=?, allied_id=?, allied_branch_id=?, user_profile_id=?, updated_at=NOW() WHERE id=?',
                [snap.prev_cognito_id, snap.prev_allied_id, snap.prev_allied_branch_id, snap.prev_user_profile_id, snap.row_id],
            );
        } else {
            await exec(
                'UPDATE users SET allied_id=?, allied_branch_id=?, user_profile_id=?, updated_at=NOW() WHERE id=?',
                [snap.prev_allied_id, snap.prev_allied_branch_id, snap.prev_user_profile_id, snap.row_id],
            );
        }
        out.restored = 'estado previo (cognito_id/allied/branch/profile) restaurado';
    } else {
        await exec('DELETE FROM users WHERE id=? AND cognito_id=?', [snap.row_id, snap.cognito_id]);
        out.deleted = 'fila de prueba creada por assign borrada';
    }
    rmSync(SNAPSHOT, { force: true });
    return out;
}

/** deleteUsers — borra users + user_requests + filas hijas, por id, en UNA conexión (FK checks off). */
async function deleteUsers(userIDs: number[]): Promise<number> {
    if (userIDs.length === 0) return 0;
    await withConnection(async (c) => {
        const [reqRows] = await c.query<any[]>('SELECT id FROM user_requests WHERE user_id IN (?)', [userIDs]);
        const reqIDs = (reqRows as Array<{ id: number }>).map((r) => r.id);
        // best-effort por tabla (igual que el db.Exec sin chequeo del Go): varias childTables solo tienen
        // user_request_id y NO user_id (o viceversa) → el DELETE por la columna ausente tira "Unknown column"
        // y NO debe abortar el scrub. Tragamos el error por statement.
        const tryQ = async (sql: string, params: unknown[]) => {
            try { await c.query(sql, params); } catch { /* tabla sin esa columna: se omite */ }
        };
        await c.query('SET FOREIGN_KEY_CHECKS=0');
        for (const t of childTables) {
            if (reqIDs.length > 0) await tryQ(`DELETE FROM ${t} WHERE user_request_id IN (?)`, [reqIDs]);
            await tryQ(`DELETE FROM ${t} WHERE user_id IN (?)`, [userIDs]);
        }
        await tryQ('DELETE FROM user_requests WHERE user_id IN (?)', [userIDs]);
        await tryQ('DELETE FROM model_has_roles WHERE model_id IN (?)', [userIDs]);
        await tryQ('DELETE FROM users WHERE id IN (?)', [userIDs]);
        await c.query('SET FOREIGN_KEY_CHECKS=1');
    });
    return userIDs.length;
}

/**
 * Vuelca a `.runs/` lo que está por borrarse. F-52: como cada corrida arranca scrubbeando, la corrida
 * N destruye la evidencia de la N-1 — y `user_requests` desaparece mientras `user_request_records`
 * queda huérfano, así que consultar por el id que imprimió una corrida vieja devuelve vacío y se lee
 * como "nunca existió". Con esto la forense deja de depender de acordarse de mirar ANTES.
 */
async function dumpAntesDeBorrar(phone: string, userIDs: number[]): Promise<string | null> {
    if (userIDs.length === 0) return null;
    try {
        const reqs = await query<Record<string, unknown>>(
            `SELECT ur.id, ur.user_request_status_id, s.name AS estado, ur.lender_id, l.name AS lender,
                    ur.user_id, ur.allied_branch_id, ur.amount, ur.created_at, ur.updated_at
               FROM user_requests ur
               LEFT JOIN user_request_statuses s ON s.id = ur.user_request_status_id
               LEFT JOIN lenders l ON l.id = ur.lender_id
              WHERE ur.user_id IN (?) ORDER BY ur.id`, [userIDs]);
        if (reqs.length === 0) return null;
        const ids = reqs.map((r) => r.id as number);
        const recs = await query<Record<string, unknown>>(
            `SELECT user_request_id, user_request_status_id, comment, created_at
               FROM user_request_records WHERE user_request_id IN (?) ORDER BY id`, [ids]);

        const dir = resolve(ROOT, '.runs');
        mkdirSync(dir, { recursive: true });
        // sin Date.now() en el nombre: el id de la última solicitud alcanza y es estable/rastreable
        const file = resolve(dir, `ureq-${ids[ids.length - 1]}.json`);
        writeFileSync(file, JSON.stringify({ phone, borrado_en: new Date().toISOString(), user_ids: userIDs, solicitudes: reqs, records: recs }, null, 2));
        return file;
    } catch {
        return null;   // la forense es un extra: si falla, el scrub NO se frena
    }
}

/**
 * LOS MARCADORES CON QUE EL ARNÉS FIRMA SUS PROPIOS USUARIOS.
 *
 * No es «cualquier usuario de prueba»: son las tres formas en que este repo crea identidades, y por
 * eso se pueden borrar sin adivinar de quién son. `synthFill` pone el correo `synth-<ur>@creditop.com`
 * y el nombre `SYNTH TEST USER`; los caminadores derivan `qa<documento>@gmail.com`.
 *
 * ⚠ LOS TEMPORALES (`document_number LIKE 'TEMP-%'`) NO ESTÁN ACÁ, Y ES A PROPÓSITO. Son 16.248 en
 * local y 16.124 en la base compartida —medido el 2026-09-10, sobre tablas de ~229.000 usuarios— y
 * los crea el paso de registro de teléfono: cualquier registro ABANDONADO deja uno, así que no son
 * del arnés. Y sobre todo: **no llevan identidad**, que es lo único que rompe una corrida (F-195).
 * Borrarlos sería una limpieza masiva sin ningún efecto sobre la prueba.
 */
const MARCADORES_DEL_ARNES = [
    "email LIKE 'synth-%@creditop.com'",
    "(first_name = 'SYNTH' AND surname = 'TEST USER')",
    "email REGEXP '^qa[0-9]+@gmail\\.com$'",
];

/**
 * scrubHarnessIdentities (WRITE, SÓLO LOCAL): borra los usuarios con identidad que dejó el arnés, para
 * que una corrida no pueda reusar la de otra.
 *
 * POR QUÉ HACE FALTA además del scrub por teléfono: aquél limpia el teléfono de ESTA corrida, y con
 * eso alcanza para que ESTA corrida esté limpia. Lo que no cubre es la acumulación — medido el
 * 2026-09-10 en local, **1.296** usuarios del caminador y ~45 de `synthFill`—, y cada uno es una
 * trampa latente: el día que un teléfono o un documento se repita, la corrida nueva reusa esa
 * identidad y el flujo se salta la pantalla de datos personales sin avisar. Es exactamente F-195,
 * esperando.
 *
 * ⚠ SE NIEGA FUERA DE LOCAL, y no por prudencia genérica: en la base COMPARTIDA (dev = qa = staging)
 * puede haber una corrida de otra persona EN VUELO, y borrarle su usuario sintético a mitad le rompe
 * la prueba sin que entienda por qué. Y allá no hace falta: los usuarios con identidad del arnés eran
 * **3** el 2026-09-10, contra 1.296 en local. Lo que sí corre en la compartida es el scrub por
 * teléfono, que es acotado a la corrida.
 */
export async function scrubHarnessIdentities(): Promise<Record<string, unknown>> {
    assertWriteAllowed();
    if (TARGET !== 'local') {
        throw new Error(
            `scrub de identidades sólo en local (target=${TARGET}). En la base compartida puede haber `
            + 'una corrida de otra persona en vuelo; allá el scrub por teléfono ya acota a la corrida.',
        );
    }
    const donde = `(${MARCADORES_DEL_ARNES.join(' OR ')}) AND (cognito_id IS NULL OR cognito_id = '')`;
    const rows = await query<{ id: number }>(`SELECT id FROM users WHERE ${donde}`);
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return { users_deleted: 0, note: 'no había identidades del arnés que borrar' };

    const dump = await dumpAntesDeBorrar('(identidades del arnés)', ids);

    /* EN TANDAS: `deleteUsers` expande `IN (?)` con todos los ids y recorre ~20 tablas hijas, así que
       1.300 de una vez arma statements enormes. En tandas el trabajo es el mismo y cada uno entra. */
    const TANDA = 200;
    let borrados = 0;
    for (let i = 0; i < ids.length; i += TANDA) borrados += await deleteUsers(ids.slice(i, i + TANDA));

    return {
        users_deleted: borrados, tandas: Math.ceil(ids.length / TANDA),
        forense: dump ?? '(sin solicitudes previas que volcar)',
        note: 'los TEMPORAL USER quedan: no llevan identidad, así que no afectan una corrida',
    };
}

/** scrubphone (WRITE): borra los users CLIENTE (cognito_id NULL) de un teléfono → próximo register = TEMPORAL USER.
 *
 * ⚠ COMPARA POR LOS ÚLTIMOS 10 DÍGITOS, no por igualdad, y eso es un ARREGLO — no una comodidad.
 * El mismo teléfono se guarda en formatos distintos según por dónde entró: medido el 2026-09-10 en la
 * base compartida, `3131010101` convivía como `+573131010101` (un TEMPORAL USER) y como
 * `+13131010101` — un número colombiano con prefijo de Estados Unidos, y ése es el que rompía todo.
 *
 * Con `cell_phone = '3131010101'` el scrub no encontraba ninguno de los dos, así que el usuario
 * sobrevivía CON SU IDENTIDAD PUESTA: el user 1827430 venía de junio y arrastraba el nombre, el
 * documento y el correo de una corrida del 3 de septiembre. La solicitud nueva lo reusaba por
 * teléfono, el backend veía la información personal ya cargada —hay una rama escrita para ese caso en
 * `validateOtpCodeAndRedirectOrchestrator`— y **se saltaba la pantalla de personal-info**. O sea que
 * el síntoma no era «el arnés inyecta demasiado» sino «el arnés no limpia»: las corridas dejaban de
 * estar aisladas y el flujo aparecía incompleto sin que nada avisara.
 *
 * ⚠ Lo que NO se amplía, a propósito: el guard `cognito_id IS NULL OR ''`. Eso es lo que mantiene el
 * borrado del lado de los usuarios CLIENTE y lejos de las cuentas de asesor. Y para un móvil
 * colombiano los últimos 10 dígitos SON el número entero, así que ensanchar de «igual» a «termina
 * igual» no agrega candidatos reales: sólo alcanza las variantes con prefijo del mismo número.
 */
export async function scrubphone(phone: string): Promise<Record<string, unknown>> {
    const p = phone.trim();
    if (!p) throw new Error('uso: scrubphone <telefono>');
    assertWriteAllowed();
    const rows = await query<{ id: number; cell_phone: string }>(
        `SELECT id, cell_phone FROM users
          WHERE RIGHT(REPLACE(REPLACE(REPLACE(cell_phone,'+',''),' ',''),'-',''), 10) = RIGHT(?, 10)
            AND (cognito_id IS NULL OR cognito_id = '')`,
        [p.replace(/[^0-9]/g, '')],
    );
    const ids = rows.map((r) => r.id);
    // Los formatos que se encontraron se REPORTAN: si mañana aparece otro (un `+1` fue el que costó
    // esta vuelta), tiene que verse en el rastro de la corrida y no descubrirse depurando.
    const formatos = [...new Set(rows.map((r) => r.cell_phone))];
    const dump = await dumpAntesDeBorrar(p, ids);
    const n = await deleteUsers(ids);
    return {
        phone: p, users_deleted: n, user_ids: ids, formatos_encontrados: formatos,
        forense: dump ?? '(sin solicitudes previas que volcar)',
        note: 'el próximo register de ese teléfono crea un TEMPORAL USER → /personal-info',
    };
}
