// db.ts — acceso a MySQL para que harness sea autosuficiente (sin shellear a backend-mcp).
// target = E2E_TARGET (default "dev"). Las credenciales (E2E_DB_HOST/PORT/NAME/USER/PASS + APP_KEY)
// son HECHOS del entorno y viven COMPARTIDAS en `playground/env/<target>.env`, junto con backend-e2e y
// backend-mcp. El `.env.<target>` propio de harness queda para sus perillas (Cognito, mocks…) y
// PISA lo compartido si redefine una clave. Prioridad: process.env > .env.<target> > env/<target>.env.
import mysql from 'mysql2/promise';
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
// La resolución por target (y la herencia entre targets) vive en `env.ts`. Se re-exporta para no romper
// a quien ya importaba `TARGET`/`env` desde acá.
import { TARGET, env } from './env.ts';

export { TARGET, env };

export function appKey(): string {
    const k = env('APP_KEY');
    if (!k) throw new Error(`APP_KEY ausente en .env.${TARGET} (necesario para encriptar la fila Experian)`);
    return k;
}

/** ¿La base de ESTE target vive en esta máquina? */
export function esBaseLocal(): boolean {
    const host = env('E2E_DB_HOST', '127.0.0.1');
    return TARGET === 'local' || host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/**
 * Guarda para escrituras: contra una base que NO es local exige I_KNOW_THIS_TOUCHES_SHARED_DEV=1.
 *
 * ⚠ YA NO HACE FALTA LLAMARLA A MANO: `exec()` la llama sola cuando la sentencia MUTA (ver abajo).
 * Se deja exportada porque hay código que la invoca al arrancar para fallar temprano, antes de hacer
 * trabajo que va a tirar igual — eso sigue siendo útil y no molesta (es idempotente).
 *
 * `queDispara` es sólo para el mensaje: sin eso, el error decía «escritura bloqueada» y no de dónde.
 */
export function assertWriteAllowed(queDispara = ''): void {
    if (esBaseLocal()) return;
    if (env('I_KNOW_THIS_TOUCHES_SHARED_DEV') === '1') return;
    const host = env('E2E_DB_HOST', '127.0.0.1');
    throw new Error(
        `escritura a DB COMPARTIDA bloqueada (target ${TARGET}, host ${host})`
        + (queDispara ? `\n  la disparó: ${queDispara}` : '')
        + `\n  Si de verdad querés escribir ahí, exportá I_KNOW_THIS_TOUCHES_SHARED_DEV=1 en la shell.`
        + `\n  Si NO querés, corré con E2E_TARGET=local (F-53).`,
    );
}

let _pool: Pool | null = null;

export function pool(): Pool {
    if (_pool) return _pool;
    _pool = mysql.createPool({
        host: env('E2E_DB_HOST', '127.0.0.1'),
        port: Number(env('E2E_DB_PORT', '3306')),
        user: env('E2E_DB_USER', 'root'),
        password: env('E2E_DB_PASS', ''),
        database: env('E2E_DB_NAME', ''),
        connectionLimit: 5,
        charset: 'utf8mb4',
        dateStrings: true,
    });
    return _pool;
}

/** SELECT → filas tipadas (loose). */
export async function query<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T[]> {
    const [rows] = await pool().query<RowDataPacket[]>(sql, params);
    return rows as unknown as T[];
}

/** Primera fila o null. */
export async function one<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await query<T>(sql, params);
    return rows.length ? rows[0] : null;
}

/** Primer valor de la primera fila (o null). */
export async function scalar<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const row = await one<Record<string, any>>(sql, params);
    if (!row) return null;
    const k = Object.keys(row)[0];
    return (row[k] ?? null) as T;
}

/**
 * ¿ESTA SENTENCIA MUTA DATOS? Devuelve la operación y la tabla, o `null` si no muta.
 *
 * Se mira la PRIMERA palabra, no si el texto contiene «delete»: un `SELECT … WHERE motivo='delete'`
 * no muta nada y marcarlo sería un falso positivo que enseña a ignorar la guarda. `SET` queda fuera a
 * propósito — `SET FOREIGN_KEY_CHECKS=0` es una perilla de sesión, no un cambio de datos.
 */
export function mutacionDe(sql: string): { op: string; tabla: string } | null {
    const t = sql.replace(/^[\s(]+/, '').replace(/^\/\*[\s\S]*?\*\//, '').trimStart();
    const m = /^(INSERT(?:\s+IGNORE)?(?:\s+INTO)?|REPLACE(?:\s+INTO)?|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|DROP\s+TABLE|ALTER\s+TABLE|CREATE\s+TABLE)\s+`?([a-z0-9_]+)`?/i.exec(t);
    if (!m) return null;
    return { op: m[1].replace(/\s+/g, ' ').toUpperCase(), tabla: m[2].toLowerCase() };
}

/** Lo que `exec` fue registrando en esta corrida, en orden. Sirve para decir QUÉ se tocó, DELETEs incluidos. */
export interface Escritura { op: string; tabla: string; filas: number; target: string; local: boolean; etiqueta: string; cuando: string }
const _escrituras: Escritura[] = [];
let _etiqueta = '';

/** Etiqueta con la que se registran las escrituras que vengan (la usa `withWrite`). */
export function etiquetarEscrituras(nombre: string): () => void {
    const previa = _etiqueta;
    _etiqueta = nombre;
    return () => { _etiqueta = previa; };
}

/** Todo lo que esta corrida escribió, en orden. Copia: nadie de afuera muta el registro. */
export function escriturasDeLaCorrida(): Escritura[] {
    return _escrituras.slice();
}

/** Resumen por tabla, para imprimir al cerrar una corrida. */
export function resumenDeEscrituras(): Array<{ tabla: string; ops: string; filas: number }> {
    const m = new Map<string, { ops: Set<string>; filas: number }>();
    for (const e of _escrituras) {
        const v = m.get(e.tabla) ?? { ops: new Set<string>(), filas: 0 };
        v.ops.add(e.op.split(' ')[0]);
        v.filas += e.filas;
        m.set(e.tabla, v);
    }
    return [...m.entries()].map(([tabla, v]) => ({ tabla, ops: [...v.ops].join('+'), filas: v.filas }));
}

/**
 * INSERT/UPDATE/DELETE → { affectedRows, insertId }.
 *
 * ⚠ GUARDA Y REGISTRO AUTOMÁTICOS, y eso es el punto. Antes `assertWriteAllowed()` se llamaba A MANO
 * y quedaba a criterio de cada quien: medido el 2026-09-15, **nueve archivos escribían sin nombrarla
 * nunca** — entre ellos el `UPDATE settings` del bypass de OTP de `caminar-wizard.ts` y `caso.ts`, que
 * contra `qa` le cambian la lista de teléfonos a TODO el equipo. Es la misma forma de F-53 (los specs
 * de `channel/` escribiendo en el compartido durante meses porque la guarda no estaba en el camino).
 * Ahora la guarda vive donde pasa la escritura, así que no se puede olvidar.
 *
 * Y de paso registra lo que se tocó. `dbops activity` reconstruye eso consultando la base después, y
 * su propio comentario admite que **no ve los DELETEs**; este registro sí, porque anota la sentencia
 * cuando corre.
 */
export async function exec(sql: string, params: any[] = []): Promise<{ affectedRows: number; insertId: number }> {
    const mut = mutacionDe(sql);
    if (mut) assertWriteAllowed(`${mut.op} ${mut.tabla}`);
    const [res] = await pool().query<ResultSetHeader>(sql, params);
    const out = { affectedRows: res.affectedRows ?? 0, insertId: res.insertId ?? 0 };
    if (mut) {
        _escrituras.push({
            op: mut.op, tabla: mut.tabla, filas: out.affectedRows, target: TARGET,
            local: esBaseLocal(), etiqueta: _etiqueta, cuando: new Date().toISOString(),
        });
    }
    return out;
}

/** Corre `fn` sobre UNA conexión dedicada (necesario para SET FOREIGN_KEY_CHECKS / sesiones). */
export async function withConnection<T>(fn: (c: PoolConnection) => Promise<T>): Promise<T> {
    const c = await pool().getConnection();
    try {
        return await fn(c);
    } finally {
        c.release();
    }
}

export async function close(): Promise<void> {
    if (_pool) {
        await _pool.end();
        _pool = null;
    }
}
