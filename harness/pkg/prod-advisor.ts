import { spawnSync } from 'node:child_process';
import { runPg } from './pg.ts';

/**
 * ¿El asesor de prueba de un comercio de PRODUCCIÓN está bien armado para poder entrar al wizard? Responde SIN entrar: no abre navegador, no
 * usa ninguna clave y no escribe nada. Mira tres lugares, todos en solo lectura:
 *   1. la base de prod (por el conector `sql`, que impone el solo lectura): el asesor, su sucursal, `is_test` y `cognito_id`;
 *   2. el pool de Cognito de comercios de prod (`admin-get-user` con el perfil `prod` de solo lectura): si la cuenta existe, su estado y su `sub`;
 *   3. el login alojado al que manda el wizard de prod (un fetch sin sesión).
 *
 * Existe porque el 2026-10-08 el admin de prod creó asesores sin cuenta en el pool y nadie lo sabía hasta intentar entrar. Probar el login de
 * verdad en prod NO se hace: prod es solo lectura y el primer ingreso de un asesor puede completar su `cognito_id` en la base.
 *
 * ⚠ Lo puro (`buildChecks`, `verdictOf`, `hintsOf`) no toca red ni disco y es lo que se prueba; lo que sale a leer (`findAdvisor`, `poolAccount`)
 * es lo que se comprueba corriéndolo (`make harness-prod-advisor ALLIED=<id>`).
 */

/** El pool Merchants de producción (el que usa `login.creditop.com`), en la región de la app. Medido el 2026-10-05 contra la consola de prod. */
export const PROD_POOL_ID = process.env.PROD_MERCHANT_POOL_ID || 'us-east-2_3n9lxmKCe';
/** El login que el wizard de prod debe mostrar para ese pool. */
export const PROD_LOGIN_HOST = process.env.PROD_LOGIN_HOST || 'login.creditop.com';
export const PROD_FRONT = process.env.PROD_FRONT || 'https://originaciones.creditop.com';
/** El perfil de AWS de SOLO LECTURA de producción. */
export const PROD_AWS_PROFILE = 'prod';

export interface AdvisorRow {
    id: number;
    email: string;
    allied_id: number | null;
    allied_name: string | null;
    branch_id: number | null;
    branch_name: string | null;
    user_profile_id: number | null;
    is_test: number | null;
    test_reason: string | null;
    cognito_id: string | null;
    created_at: string | null;
}

export type PoolState =
    | { state: 'existe'; status: string; enabled: boolean; sub: string }
    | { state: 'no-existe' }
    | { state: 'sin-acceso'; motivo: string };

export interface HostedSeen { host: string; clientId: string }

/** `ok`: true bien · false mal · null no se pudo comprobar. */
export interface Check { label: string; ok: boolean | null; detalle: string }

const filled = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && v !== 'null';

/** Las comprobaciones, en el orden en que se leen. Pura. */
export function buildChecks(advisor: AdvisorRow | null, pool: PoolState | null, hosted: HostedSeen | null): Check[] {
    const checks: Check[] = [];
    if (!advisor) {
        return [{ label: 'el asesor existe en la base', ok: false, detalle: 'no hay un asesor de prueba con ese dato' }];
    }
    checks.push({ label: 'el asesor existe en la base', ok: true, detalle: `${advisor.email} (usuario ${advisor.id})` });
    checks.push({
        label: 'está marcado como usuario de prueba', ok: Number(advisor.is_test) === 1,
        detalle: Number(advisor.is_test) === 1 ? `is_test = 1 (${advisor.test_reason ?? 'sin motivo'})` : 'is_test no es 1: NO parece un usuario de prueba, no lo trates como tal',
    });
    const branchOk = advisor.branch_id != null && Number(advisor.user_profile_id) === 4;
    checks.push({
        label: 'es Comercial y tiene sucursal', ok: branchOk,
        detalle: branchOk ? `sucursal ${advisor.branch_name ?? advisor.branch_id}${advisor.allied_name ? ` · comercio «${advisor.allied_name}»` : ''}` : `perfil ${advisor.user_profile_id ?? '—'}, sucursal ${advisor.branch_id ?? '—'}`,
    });
    checks.push({
        label: 'tiene cognito_id en la base', ok: filled(advisor.cognito_id),
        detalle: filled(advisor.cognito_id) ? advisor.cognito_id : 'vacío: la cuenta de Cognito no se creó o no se guardó',
    });

    if (!pool || pool.state === 'sin-acceso') {
        const motivo = pool && pool.state === 'sin-acceso' ? pool.motivo : 'no se consultó';
        checks.push({ label: 'la cuenta existe en el pool de prod', ok: null, detalle: `no se pudo comprobar: ${motivo}` });
    } else if (pool.state === 'no-existe') {
        checks.push({ label: 'la cuenta existe en el pool de prod', ok: false, detalle: `no existe en ${PROD_POOL_ID}` });
    } else {
        checks.push({ label: 'la cuenta existe en el pool de prod', ok: true, detalle: `${PROD_POOL_ID}` });
        const usable = pool.status === 'CONFIRMED' && pool.enabled;
        checks.push({
            label: 'está confirmada y habilitada', ok: usable,
            detalle: usable ? 'CONFIRMED y habilitada' : `estado ${pool.status}${pool.enabled ? '' : ', deshabilitada'}`,
        });
        if (filled(advisor.cognito_id)) {
            const same = pool.sub === advisor.cognito_id;
            checks.push({
                label: 'el sub del pool es el cognito_id de la base', ok: same,
                detalle: same ? 'coinciden' : `el pool dice ${pool.sub} y la base ${advisor.cognito_id}: el backend no reconocerá al asesor`,
            });
        }
    }

    if (!hosted) {
        checks.push({ label: 'el wizard de prod manda al login del pool', ok: null, detalle: 'no se pudo ver a dónde manda el wizard' });
    } else {
        const ok = hosted.host === PROD_LOGIN_HOST;
        checks.push({
            label: 'el wizard de prod manda al login del pool', ok,
            detalle: ok ? `${hosted.host}` : `manda a ${hosted.host} y se esperaba ${PROD_LOGIN_HOST}`,
        });
    }
    return checks;
}

export type Verdict = 'lista' | 'con-problemas' | 'sin-comprobar';

/** Todo bien → «lista»; algo mal → «con-problemas»; nada mal pero algo sin ver → «sin-comprobar». Pura. */
export function verdictOf(checks: Check[]): Verdict {
    if (checks.some((c) => c.ok === false)) return 'con-problemas';
    if (checks.some((c) => c.ok === null)) return 'sin-comprobar';
    return 'lista';
}

/** El código de salida: 0 lista · 1 con problemas · 2 sin comprobar. */
export const exitCodeOf = (v: Verdict): 0 | 1 | 2 => (v === 'lista' ? 0 : v === 'con-problemas' ? 1 : 2);

/** Qué hacer con lo que salió mal. Pura. */
export function hintsOf(advisor: AdvisorRow | null, pool: PoolState | null): string[] {
    if (!advisor) return ['Crear el asesor desde el admin: en el comercio, tarjeta «Usuario de prueba» (solo el rol Administrador la ve).'];
    const hints: string[] = [];
    const where = advisor.allied_id ? `el comercio ${advisor.allied_id}` : 'el comercio';
    if (!filled(advisor.cognito_id) && pool?.state === 'no-existe') {
        hints.push(`Sin cuenta en el pool: en ${where}, tarjeta «Usuario de prueba» → «Reintentar cuenta de Cognito» (como Administrador).`);
    }
    if (!filled(advisor.cognito_id) && pool?.state === 'existe') {
        hints.push('La cuenta sí existe en el pool pero la base no la tiene guardada: reintentar la cuenta de Cognito la reconcilia.');
    }
    if (pool?.state === 'existe' && filled(advisor.cognito_id) && pool.sub !== advisor.cognito_id) {
        hints.push('El cognito_id de la base no es el sub del pool: hay que corregir la base (un solo usuario, por id exacto) o recrear la cuenta.');
    }
    if (pool?.state === 'existe' && pool.status !== 'CONFIRMED') {
        hints.push(`La cuenta está en estado ${pool.status}: no entra con la clave compartida hasta que se confirme o se restablezca su clave.`);
    }
    if (pool?.state === 'sin-acceso') hints.push(`${pool.motivo}`);
    return hints;
}

/** Un correo o un número de comercio que se puede interpolar en la consulta sin escapar nada. Lanza si no. */
export function safeEmail(email: string): string {
    if (!/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+$/.test(email)) throw new Error(`correo inválido: «${email}»`);
    return email;
}
export function safeId(raw: string): number {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`id inválido: «${raw}»`);
    return n;
}

/** La consulta (solo SELECT) del asesor de prueba, por comercio o por correo exacto. */
export function advisorQuery(by: { allied?: number; email?: string }): string {
    const cond = by.email
        ? `u.email = '${safeEmail(by.email)}'`
        : `u.allied_id = ${safeId(String(by.allied))} AND u.email LIKE 'c%-fake@%'`;
    return 'SELECT u.id, u.email, u.allied_id, a.name AS allied_name, u.allied_branch_id AS branch_id, b.name AS branch_name, '
        + 'u.user_profile_id, u.is_test, u.test_reason, u.cognito_id, u.created_at '
        + 'FROM users u LEFT JOIN allied_branches b ON b.id = u.allied_branch_id LEFT JOIN allieds a ON a.id = u.allied_id '
        + `WHERE ${cond} ORDER BY u.id DESC LIMIT 5`;
}

/** Lee el asesor en la base de prod (solo lectura). Con varios para un comercio, el más reciente y cuántos hay. */
export function findAdvisor(by: { allied?: number; email?: string }): { advisor: AdvisorRow | null; count: number; error?: string } {
    const r = runPg(['sql', '--target', 'prod', '--query', advisorQuery(by), '--json'], { timeoutMs: 120_000 });
    if (r.status !== 0) return { advisor: null, count: 0, error: (r.stderr || r.stdout).trim().split('\n').pop() ?? 'falló la consulta' };
    try {
        const rows = (JSON.parse(r.stdout).rows ?? []) as AdvisorRow[];
        return { advisor: rows[0] ?? null, count: rows.length };
    } catch {
        return { advisor: null, count: 0, error: 'la respuesta del conector no es JSON' };
    }
}

/** Lee la cuenta en el pool de prod con el perfil de solo lectura. Nunca escribe. */
export function poolAccount(email: string): PoolState {
    const region = PROD_POOL_ID.split('_')[0];
    const r = spawnSync('aws', ['cognito-idp', 'admin-get-user', '--user-pool-id', PROD_POOL_ID, '--region', region, '--username', email, '--output', 'json'],
        { encoding: 'utf8', timeout: 60_000, env: { ...process.env, AWS_PROFILE: PROD_AWS_PROFILE } });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    if (r.status === 0) {
        try {
            const d = JSON.parse(r.stdout);
            const sub = (d.UserAttributes ?? []).find((a: { Name: string }) => a.Name === 'sub')?.Value ?? '';
            return { state: 'existe', status: String(d.UserStatus ?? ''), enabled: d.Enabled !== false, sub };
        } catch { return { state: 'sin-acceso', motivo: 'la respuesta de AWS no es JSON' }; }
    }
    if (/UserNotFoundException/.test(out)) return { state: 'no-existe' };
    if (/ExpiredToken|Token has expired|sso login|Unable to locate credentials|SSO session/i.test(out)) {
        return { state: 'sin-acceso', motivo: `la sesión de AWS de prod venció: aws sso login --profile ${PROD_AWS_PROFILE}` };
    }
    return { state: 'sin-acceso', motivo: (out.trim().split('\n').filter(Boolean).pop() ?? 'falló la consulta al pool').slice(0, 200) };
}

const MARK: Record<string, string> = { true: '✔', false: '✖', null: '–' };

/** La tabla de comprobaciones, para la consola. Pura. */
export function renderChecks(checks: Check[]): string {
    return checks.map((c) => `  ${MARK[String(c.ok)]} ${c.label.padEnd(42)} ${c.detalle}`).join('\n');
}
