// db.ts — acceso a MySQL para que harness sea autosuficiente (sin shellear a backend-mcp).
// target = E2E_TARGET (default "dev"). Las credenciales (E2E_DB_HOST/PORT/NAME/USER/PASS + APP_KEY)
// son HECHOS del entorno y viven COMPARTIDAS en `playground/env/<target>.env`, junto con backend-e2e y
// backend-mcp. El `.env.<target>` propio de harness queda para sus perillas (Cognito, mocks…) y
// PISA lo compartido si redefine una clave. Prioridad: process.env > .env.<target> > env/<target>.env.
import mysql from 'mysql2/promise';
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
// La resolución por target (y la herencia entre targets) vive en `env.ts`. Se re-exporta para no romper
// a quien ya importaba `TARGET`/`env` desde acá.
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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
 * PERMISOS ANGOSTOS: las únicas escrituras que NO piden `I_KNOW_THIS_TOUCHES_SHARED_DEV`.
 *
 * POR QUÉ EXISTEN. El permiso general es del tamaño equivocado para una perilla de pruebas: abre
 * CUALQUIER escritura contra la compartida durante toda la shell, y el 2026-09-17 el precio de no
 * exportarlo fueron **nueve casos muertos** dos pantallas más adelante, en el OTP, con el mensaje
 * genérico del front. O sea que la guarda empujaba justo hacia lo peligroso: para correr el arnés había
 * que abrirlo todo. Un permiso del tamaño de la tarea no tiene ese incentivo.
 *
 * ⚠ LA ETIQUETA NO ALCANZA, Y ESO ES EL PUNTO. El SQL tiene que MATCHEAR el patrón de su permiso, así
 * que `permiso: 'otp-bypass'` no se puede usar de contrabando para escribir otra cosa. Si la guarda
 * fuera «prometé que es angosta», sería una nota al margen y no una guarda — la misma razón por la que
 * el `datos` de canon exige que el SQL empiece con SELECT en vez de pedirle al modelo que no escriba.
 *
 * ⚠ HAY DOS NIVELES, Y NO SON INTERCAMBIABLES. `otp-bypass` toca una perilla de PRUEBAS —una lista de
 * teléfonos de mentira, cuyo peor caso es dejar un teléfono de más—, así que le alcanza con la
 * sentencia. `siembra` toca `users`, `user_summaries`, `user_field_values` y `risk_central_user_data`,
 * que son **tablas de personas**: ahí la sentencia NO alcanza, porque `UPDATE users … WHERE id=?` tiene
 * la misma forma para un cliente sintético que para alguien real. Por eso ese permiso exige además un
 * **ámbito por usuario** (ver `conAmbitoDeSiembra`). Para el que agregue el siguiente: si la tabla tiene
 * datos de personas, el patrón no es suficiente — hace falta acotar también las FILAS.
 *
 * ⚠ Y QUÉ SIGUE SIN CUBRIR, para no leer más de lo que dice: esto impide escribir fuera de estas
 * sentencias y fuera de esos usuarios. **No** impide que alguien abra el ámbito sobre el id de una
 * persona real a propósito — eso deja de ser un accidente y pasa a ser una decisión, que es justo la
 * línea que el permiso general no sabía trazar.
 */
interface PermisoAngosto {
    /** Las sentencias EXACTAS que concede. Una que no matchee se bloquea, y el error dice cuál era. */
    patrones: RegExp[];
    /** Si además exige un `usuario` dueño, dentro del ámbito abierto por `conAmbitoDeSiembra`. */
    porUsuario?: boolean;
}

const PERMISOS_ANGOSTOS: Record<string, PermisoAngosto> = {
    // Sumar y sacar teléfonos del bypass de OTP — `pkg/otp-bypass.ts`, el único que lo usa.
    'otp-bypass': {
        patrones: [/^UPDATE\s+settings\s+SET\s+value\s*=\s*JSON_(?:MERGE_PRESERVE|REMOVE)\([\s\S]+WHERE\s+`key`\s*=\s*\?[\s\S]*$/i],
    },
    // La credencial (comercio, entidad) que la siembra copia de una plantilla para los rt≠2. Va SIN
    // ámbito por usuario porque `lender_allied_credentials` es CONFIG: no hay datos de nadie ahí. Y sólo
    // INSERT — no hay forma de pisar ni de borrar una credencial existente con este permiso.
    'credencial-de-entidad': {
        patrones: [/^INSERT\s+INTO\s+lender_allied_credentials\s+\(lender_id,\s*allied_type,\s*allied_id,\s*credential,[\s\S]+$/i],
    },
    // La siembra del cliente sintético — `pkg/inject.ts`. Ver el bloque de arriba: acá la angostura NO
    // la da sólo la sentencia (estas tablas son de personas), la da el ÁMBITO por usuario.
    siembra: {
        porUsuario: true,
        patrones: [
            // `setSynthIdentity` arma la lista de columnas según si escribe el tipo de documento, así
            // que ésta es la más laxa del juego — y por eso el ámbito por usuario no es opcional acá.
            /^UPDATE\s+users\s+SET\s[\s\S]*\bWHERE\s+id\s*=\s*\?\s*$/i,
            /^UPDATE\s+users\s+SET\s+manual_validation\s*=\s*1,\s*last_validation\s*=\s*NOW\(\)\s+WHERE\s+id\s*=\s*\?\s*$/i,
            /^UPDATE\s+user_summaries\s+SET\s+agildata=\?,\s*datacredito=\?,\s*updated_at=NOW\(\)\s+WHERE\s+id=\?\s+AND\s+user_id=\?\s*$/i,
            /^INSERT\s+INTO\s+user_summaries\s+\(user_id,[\s\S]+$/i,
            /^UPDATE\s+user_field_values\s+SET\s+value=\?,\s*user_request_id=\?,\s*updated_at=NOW\(\)\s+WHERE\s+id=\?\s+AND\s+user_id=\?\s*$/i,
            /^INSERT\s+INTO\s+user_field_values\s+\(field_id,\s*user_id,[\s\S]+$/i,
            /^DELETE\s+FROM\s+risk_central_user_data\s+WHERE\s+user_id=\?\s+AND\s+risk_central_id=\?\s*$/i,
            /^INSERT\s+INTO\s+risk_central_user_data\s+\(uuid,\s*user_id,[\s\S]+$/i,
        ],
    },
};

/**
 * EL ÁMBITO DE LA SIEMBRA: qué usuarios puede tocar esta rama de ejecución.
 *
 * ⚠ ES LO QUE HACE ANGOSTO AL PERMISO `siembra`, porque la sentencia sola no alcanza: `UPDATE users …
 * WHERE id=?` tiene la misma forma para un cliente sintético que para una persona real. Con el ámbito,
 * la escritura sólo pasa si el `usuario` que declara está en la lista que abrió `synthFill` — o sea, el
 * dueño del `user_request` que la corrida vino a sembrar. Y no basta con declararlo: ese id tiene que
 * estar TAMBIÉN entre los parámetros, así que no se puede decir «soy el 5» y escribirle al 9.
 *
 * Va por `AsyncLocalStorage` y no en el módulo por lo mismo que las etiquetas de escritura: N casos en
 * paralelo comparten proceso, y un ámbito de módulo dejaría a cada corrida escribiendo dentro del
 * permiso de las otras.
 */
const _ambitoSiembra = new AsyncLocalStorage<Set<number>>();

/** Corre `fn` pudiendo sembrar SOBRE ESOS usuarios y ninguno más. */
export function conAmbitoDeSiembra<T>(userIds: number[], fn: () => T): T {
    const heredado = _ambitoSiembra.getStore();
    return _ambitoSiembra.run(new Set([...(heredado ?? []), ...userIds.filter((n) => n > 0)]), fn);
}

/**
 * Guarda para escrituras: contra una base que NO es local exige I_KNOW_THIS_TOUCHES_SHARED_DEV=1,
 * salvo que la sentencia traiga un permiso angosto Y coincida con su patrón (ver arriba).
 *
 * ⚠ YA NO HACE FALTA LLAMARLA A MANO: `exec()` la llama sola cuando la sentencia MUTA (ver abajo).
 * Se deja exportada porque hay código que la invoca al arrancar para fallar temprano, antes de hacer
 * trabajo que va a tirar igual — eso sigue siendo útil y no molesta (es idempotente).
 *
 * `queDispara` es sólo para el mensaje: sin eso, el error decía «escritura bloqueada» y no de dónde.
 */
/**
 * ¿POR QUÉ SE BLOQUEARÍA ESTA ESCRITURA, suponiendo que la base es compartida y no hay permiso general?
 * Devuelve el motivo, o `null` si pasa.
 *
 * Es una función PURA y por eso está separada de `assertWriteAllowed`: la decisión de los permisos
 * angostos se puede fijar con pruebas sin base y sin tocar variables de entorno. Una guarda sin pruebas
 * se pudre en silencio, y ésta es la que autoriza a escribir en la base del equipo.
 */
export function motivoDelBloqueo(sql: string, permiso: string, usuario: number, params: any[], ambito: Set<number> | undefined): string | null {
    if (!permiso) return null;                       // sin permiso angosto decide el llamador
    const p = PERMISOS_ANGOSTOS[permiso];
    if (!p) return `permiso angosto desconocido: «${permiso}» (los que hay: ${Object.keys(PERMISOS_ANGOSTOS).join(', ')})`;
    if (!p.patrones.some((r) => r.test(sql.trim()))) {
        return `el permiso angosto «${permiso}» NO cubre esta sentencia, así que se bloqueó`
            + `\n  O la sentencia cambió y hay que actualizar su patrón en PERMISOS_ANGOSTOS, o esta escritura no es la que el permiso autoriza.`;
    }
    if (!p.porUsuario) return null;

    // Tres condiciones, y las tres hacen falta. Sin ámbito, cualquiera abre el permiso; sin pertenencia,
    // se escribe sobre una persona que la corrida no creó; y sin el id entre los parámetros, se podría
    // declarar un dueño y escribirle a otro.
    if (!ambito) return `«${permiso}» necesita un ámbito abierto con conAmbitoDeSiembra(); sin eso la escritura podría caer sobre cualquier fila`;
    if (!usuario || !ambito.has(usuario)) {
        return `«${permiso}» sólo alcanza a los usuarios de esta corrida [${[...ambito].join(', ') || '—'}], y esta escritura declara ${usuario || 'ninguno'}`;
    }
    if (!params.some((v) => Number(v) === usuario)) {
        return `«${permiso}»: la sentencia declara al usuario ${usuario} pero ese id NO está entre sus parámetros, así que no es a quien le escribe`;
    }
    return null;
}

/**
 * Guarda para escrituras: contra una base que NO es local exige I_KNOW_THIS_TOUCHES_SHARED_DEV=1,
 * salvo que la sentencia traiga un permiso angosto Y pase `motivoDelBloqueo` (ver arriba).
 *
 * ⚠ YA NO HACE FALTA LLAMARLA A MANO: `exec()` la llama sola cuando la sentencia MUTA (ver abajo).
 * Se deja exportada porque hay código que la invoca al arrancar para fallar temprano, antes de hacer
 * trabajo que va a tirar igual — eso sigue siendo útil y no molesta (es idempotente).
 *
 * `queDispara` es sólo para el mensaje: sin eso, el error decía «escritura bloqueada» y no de dónde.
 */
export function assertWriteAllowed(queDispara = '', sql = '', permiso = '', usuario = 0, params: any[] = []): void {
    if (esBaseLocal()) return;
    if (env('I_KNOW_THIS_TOUCHES_SHARED_DEV') === '1') return;

    if (permiso) {
        const motivo = motivoDelBloqueo(sql, permiso, usuario, params, _ambitoSiembra.getStore());
        if (motivo === null) return;
        throw new Error(`${motivo}\n  la disparó: ${queDispara}\n  ${sql.trim().replace(/\s+/g, ' ').slice(0, 160)}`);
    }

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
    // ⚠ `IF EXISTS` / `IF NOT EXISTS` van ENTRE el verbo y la tabla, así que sin contemplarlas el
    // nombre que salía era `if`. Lo vi en el propio log que vine a hacer confiable: un
    // `DROP TABLE IF EXISTS x` se reportaba como la tabla «if». Un registro con nombres inventados es
    // peor que no tenerlo, porque se lee como si fueran tablas reales.
    const m = /^(INSERT(?:\s+IGNORE)?(?:\s+INTO)?|REPLACE(?:\s+INTO)?|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|DROP\s+TABLE|ALTER\s+TABLE|CREATE\s+TABLE)(?:\s+IF(?:\s+NOT)?\s+EXISTS)?\s+`?([a-z0-9_]+)`?/i.exec(t);
    if (!m) return null;
    return { op: m[1].replace(/\s+/g, ' ').toUpperCase(), tabla: m[2].toLowerCase() };
}

/** Lo que `exec` fue registrando en esta corrida, en orden. Sirve para decir QUÉ se tocó, DELETEs incluidos. */
export interface Escritura { op: string; tabla: string; filas: number; target: string; local: boolean; etiqueta: string; cuando: string }
const _escrituras: Escritura[] = [];

/**
 * LA ETIQUETA VA POR CONTEXTO ASÍNCRONO, no en el módulo.
 *
 * ⚠ La primera versión era un `let _etiqueta` de módulo, o sea **UNA por proceso** — correcto para
 * las escrituras de un caso, y roto para N casos a la vez: dos `withWrite` concurrentes se pisan la
 * etiqueta y el registro termina atribuyendo las escrituras de uno al otro. Es exactamente la trampa
 * que `pkg/trace.ts` ya había pagado (su estado vivía en el módulo y en paralelo mezclaba contadores
 * y alertas de todos los casos), y la volví a cometer. `AsyncLocalStorage` es el primitivo para esto:
 * cada cadena de `await` ve su propia etiqueta y las paralelas no se ven entre sí.
 */
const _etiquetas = new AsyncLocalStorage<string>();

/** Corre `fn` con las escrituras etiquetadas como `nombre` (la usa `withWrite`). */
export function conEtiquetaDeEscrituras<T>(nombre: string, fn: () => T): T {
    return _etiquetas.run(nombre, fn);
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
 * LO QUE ESTA CORRIDA ESCRIBIÓ, en líneas listas para imprimir. Vacío si no escribió nada.
 *
 * ⚠ No es lo mismo que `dbops activity`, y conviene no confundirlos: aquél **reconstruye** el rastro
 * consultando la base después de la corrida, y su propio comentario admite que **no ve los DELETEs**
 * (una fila borrada no está para ser vista) ni las tablas que no tiene en su lista. Esto anota la
 * sentencia cuando corre: ve los borrados, y ve cualquier tabla.
 */
export function lineasDeEscrituras(sangria = '  '): string[] {
    const r = resumenDeEscrituras();
    if (!r.length) return [];
    const compartida = !esBaseLocal();
    const ancho = Math.max(...r.map((x) => x.tabla.length));
    const out = [
        `${sangria}── LO QUE EL ARNÉS ESCRIBIÓ EN LA BASE · ${TARGET}${compartida ? ' ⚠ COMPARTIDA' : ''} ──`,
        // ⚠ EL ARNÉS, no el flujo. Lo que escribe el BACKEND cuando el runner le pega por la API
        // (la solicitud, sus records) NO pasa por acá y por eso no aparece: esto es la siembra y los
        // bypasses, o sea la parte que se puede repetir o revertir. Decirlo evita la lectura al revés
        // —«escribió 16 sentencias y no veo la solicitud»— y la peor: creer que esto es todo el rastro.
        `${sangria}   (la siembra y los bypasses; lo que escribe el backend por la API va aparte — \`dbops activity\`)`,
    ];
    for (const x of r.sort((a, b) => b.filas - a.filas)) {
        out.push(`${sangria}   ${x.tabla.padEnd(ancho)}  ${x.ops.padEnd(20)} ${x.filas} fila(s)`);
    }
    // El total en sentencias, no en filas: dos runners con el mismo total de filas pueden haber hecho
    // 3 sentencias o 300, y eso cambia qué tan invasiva fue la corrida.
    out.push(`${sangria}   ${_escrituras.length} sentencia(s) · incluye DELETEs, que \`dbops activity\` no puede ver`);
    return out;
}

/**
 * Vuelca el registro a un JSON, para que lo lea otro proceso (el panel corre el spec como hijo, así
 * que su registro vive en la memoria del hijo y de otra forma se pierde al terminar).
 * Best-effort: un fallo al escribir el forense no puede tumbar la corrida que vino a documentar.
 */
export function volcarEscrituras(ruta: string): boolean {
    try {
        mkdirSync(dirname(ruta), { recursive: true });
        writeFileSync(ruta, JSON.stringify({
            target: TARGET, local: esBaseLocal(), cuando: new Date().toISOString(),
            resumen: resumenDeEscrituras(), sentencias: _escrituras,
        }, null, 2));
        return true;
    } catch {
        return false;
    }
}

/**
 * INSERT/UPDATE/DELETE → { affectedRows, insertId }.
 *
 * ⚠ GUARDA Y REGISTRO AUTOMÁTICOS, y eso es el punto. Antes `assertWriteAllowed()` se llamaba A MANO
 * y quedaba a criterio de cada quien: medido el 2026-09-15, **nueve archivos escribían sin nombrarla
 * nunca** — entre ellos el `UPDATE settings` del bypass de OTP, que contra `qa` le cambia la lista de
 * teléfonos a TODO el equipo (hoy vive en `pkg/otp-bypass.ts`, con su permiso angosto). Es la misma forma de F-53 (los specs
 * de `channel/` escribiendo en el compartido durante meses porque la guarda no estaba en el camino).
 * Ahora la guarda vive donde pasa la escritura, así que no se puede olvidar.
 *
 * Y de paso registra lo que se tocó. `dbops activity` reconstruye eso consultando la base después, y
 * su propio comentario admite que **no ve los DELETEs**; este registro sí, porque anota la sentencia
 * cuando corre.
 */
export async function exec(sql: string, params: any[] = [], opciones: { permiso?: string; usuario?: number } = {}): Promise<{ affectedRows: number; insertId: number }> {
    const mut = mutacionDe(sql);
    if (mut) assertWriteAllowed(`${mut.op} ${mut.tabla}`, sql, opciones.permiso ?? '', opciones.usuario ?? 0, params);
    const [res] = await pool().query<ResultSetHeader>(sql, params);
    const out = { affectedRows: res.affectedRows ?? 0, insertId: res.insertId ?? 0 };
    if (mut) {
        _escrituras.push({
            op: mut.op, tabla: mut.tabla, filas: out.affectedRows, target: TARGET,
            local: esBaseLocal(), etiqueta: _etiquetas.getStore() ?? '', cuando: new Date().toISOString(),
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
