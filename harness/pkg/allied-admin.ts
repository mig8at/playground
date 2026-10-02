import { exec, query, withSeedScope } from './db.ts';
import { TEST_ADVISOR_EMAIL, findTestAdvisor, type TestAdvisor } from './login-probe.ts';
import { lastLine, runPg } from './pg.ts';

/**
 * El COMERCIO de prueba: crearlo (por el conector del admin), comprobar su asesor en la base y desarmarlo.
 *
 * Crear es del conector `admin` (`bin/pg admin allied-create`, en Go): el harness ya no tiene su propio cliente del admin, le pide
 * al conector, que es el único que lo sabe hablar y donde viven las credenciales. Lo que SÍ es del harness es lo que toca la base
 * con sus permisos angostos: verificar el asesor y borrar lo creado por id exacto.
 *
 * ⚠ EL ALTA ESCRIBE. En dev crea el comercio en la base COMPARTIDA con qa y staging, y sube una imagen al bucket del admin: es lo
 * mismo que hacer el alta a mano. Por eso lleva un prefijo propio en el nombre (`AUTO_PREFIX`), y es lo único que el borrado reconoce.
 */

/** El nombre de todo comercio que crea la automatización. El permiso angosto de borrado exige este prefijo. */
export const AUTO_PREFIX = 'PRUEBA AUTO';

/** Lo que el admin muestra tras el alta: el asesor de prueba y qué pasó con su cuenta de Cognito. */
export interface TestAdvisorFlash {
    created: boolean;
    existed: boolean;
    /** `created` · `already_exists` · `skipped` (ambiente sin pool) · `failed`. */
    cognito: 'created' | 'already_exists' | 'skipped' | 'failed' | string;
    email: string | null;
    /** `true` si la clave es la compartida del ambiente (no se muestra). */
    passwordFixed: boolean;
    branchName: string | null;
    notes: string[];
}

export interface CreatedAllied {
    id: number;
    name: string;
    /** Lo que el admin mostró del asesor de prueba. `null` si no mostró nada (versión sin la función). */
    flash: TestAdvisorFlash | null;
    ms: number;
    /** Con quién actuó el conector (lo dijo en su vista previa): «NOMBRE (correo)». */
    actingAs: string;
}

/** Convierte el JSON de `pg admin allied-create --json` (campos en snake_case) a lo que usa el harness. Pura. */
export function parseCreated(json: string, stderr = ''): CreatedAllied {
    const raw = JSON.parse(json) as Record<string, any>;
    if (typeof raw.id !== 'number') throw new Error('la respuesta del conector no trae el id del comercio');
    const f = raw.flash as Record<string, any> | null | undefined;
    return {
        id: raw.id,
        name: String(raw.name ?? ''),
        ms: Number(raw.elapsed_ms ?? 0),
        actingAs: /actúa como (.+)/.exec(stderr)?.[1]?.trim() ?? '',
        flash: f
            ? {
                created: !!f.created, existed: !!f.existed, cognito: String(f.cognito ?? ''), email: f.email ?? null,
                passwordFixed: !!f.password_fixed, branchName: f.branch_name ?? null, notes: Array.isArray(f.notes) ? f.notes.map(String) : [],
            }
            : null,
    };
}

export interface CreateOptions {
    name?: string;
}

/** La vista previa del alta: lee el formulario con la sesión guardada y dice con quién actuaría. NO escribe. */
export function previewAllied(target: string, opts: CreateOptions = {}): { ok: boolean; text: string } {
    const r = runPg(['admin', 'allied-create', '--target', target, ...(opts.name ? ['--name', opts.name] : [])]);
    return { ok: r.status === 0, text: r.status === 0 ? r.stdout : lastLine(r.stderr) || lastLine(r.stdout) };
}

/** Crea el comercio por el conector. Lanza si el admin no lo acepta, diciendo por qué. */
export function createAllied(target: string, opts: CreateOptions = {}): CreatedAllied {
    const r = runPg(['admin', 'allied-create', '--target', target, '--apply', '--json', ...(opts.name ? ['--name', opts.name] : [])]);
    if (r.status !== 0) throw new Error(lastLine(r.stderr) || `pg admin allied-create salió con código ${r.status}`);
    return parseCreated(r.stdout, r.stderr);
}

export interface VerifiedAdvisor {
    advisor: TestAdvisor | null;
    /** Qué sigue mal, en cristiano. Vacío si todo está como debe. */
    problems: string[];
}

/**
 * ¿Quedó el asesor de prueba como debe, leído de la BASE y no de lo que dijo la pantalla?
 * `needsCognito`: en un ambiente con pool (todo menos local) la fila tiene que traer `cognito_id`.
 */
export async function verifyAdvisor(alliedId: number, needsCognito: boolean): Promise<VerifiedAdvisor> {
    const advisor = await findTestAdvisor(alliedId);
    const problems: string[] = [];
    if (!advisor) problems.push('el comercio no tiene asesor de prueba en la base');
    else {
        if (!advisor.branchHash) problems.push('el asesor no quedó ligado a una sucursal');
        if (needsCognito && !advisor.hasSub) problems.push('el asesor existe pero su fila no tiene cognito_id');
    }
    return { advisor, problems };
}

export interface CleanupResult {
    allied: number;
    /** Correos de las cuentas del pool que hay que borrar aparte (el pool no es la base). */
    emails: string[];
    deleted: { roles: number; users: number; branches: number; allieds: number };
}

/**
 * Borra el comercio de prueba, su sucursal y su asesor, por id exacto. NO toca nada que no sea de la prueba:
 *  · el comercio tiene que llevar el prefijo de la automatización (lo exigen también la sentencia y su permiso);
 *  · si tiene solicitudes, usuarios ajenos o más de una sucursal «normal», NO se borra y se dice por qué;
 *  · el borrado de personas va dentro del ámbito del asesor encontrado, como el resto del harness.
 */
export async function cleanupAllied(alliedId: number): Promise<CleanupResult> {
    const allied = (await query<{ id: number; name: string }>('SELECT id, name FROM allieds WHERE id = ?', [alliedId]))[0];
    if (!allied) throw new Error(`el comercio ${alliedId} no existe`);
    if (!allied.name.startsWith(AUTO_PREFIX)) throw new Error(`el comercio ${alliedId} («${allied.name}») no lo creó la automatización: no se borra`);

    const users = await query<{ id: number; email: string }>('SELECT id, email FROM users WHERE allied_id = ?', [alliedId]);
    const foreign = users.filter((u) => !TEST_ADVISOR_EMAIL.test(u.email));
    if (foreign.length) throw new Error(`el comercio ${alliedId} tiene usuarios que no son de prueba (${foreign.map((u) => u.id).join(', ')}): no se borra`);

    const requests = Number((await query<{ n: number }>('SELECT COUNT(*) AS n FROM user_requests WHERE allied_id = ?', [alliedId]))[0]?.n ?? 0);
    if (requests > 0) throw new Error(`el comercio ${alliedId} tiene ${requests} solicitud(es): no se borra`);

    const branches = await query<{ id: number; name: string }>('SELECT id, name FROM allied_branches WHERE allied_id = ?', [alliedId]);
    const odd = branches.filter((b) => !/^b.*-fake$/.test(b.name));
    if (odd.length) throw new Error(`el comercio ${alliedId} tiene sucursales que no son de prueba (${odd.map((b) => b.id).join(', ')}): no se borra`);

    const deleted = { roles: 0, users: 0, branches: 0, allieds: 0 };
    for (const u of users) {
        await withSeedScope([u.id], async () => {
            deleted.roles += (await exec("DELETE FROM model_has_roles WHERE model_type LIKE '%User' AND model_id = ?", [u.id], { permiso: 'prueba-asesor', usuario: u.id })).affectedRows;
            deleted.users += (await exec("DELETE FROM users WHERE id = ? AND allied_id = ? AND email LIKE 'c%-fake@%'", [u.id, alliedId], { permiso: 'prueba-asesor', usuario: u.id })).affectedRows;
        });
    }
    for (const b of branches) {
        deleted.branches += (await exec("DELETE FROM allied_branches WHERE id = ? AND allied_id = ? AND name LIKE 'b%-fake'", [b.id, alliedId], { permiso: 'prueba-comercio' })).affectedRows;
    }
    deleted.allieds += (await exec("DELETE FROM allieds WHERE id = ? AND name LIKE 'PRUEBA AUTO %'", [alliedId], { permiso: 'prueba-comercio' })).affectedRows;

    return { allied: alliedId, emails: users.map((u) => u.email), deleted };
}
