// db-safe.ts — ESCRIBIR Y BORRAR POR FUNCIÓN, NO POR SQL SUELTO.
//
// POR QUÉ EXISTE. Medido el 2026-09-15: `exec()` crudo se llamaba en 15 archivos, cada uno armando su
// propio `INSERT`/`UPDATE`/`DELETE`, y **nueve de ellos no nombraban la guarda nunca**. La guarda ya
// dejó de ser opcional (vive dentro de `exec`, ver `db.ts`), así que la seguridad de ambiente está
// resuelta. Lo que queda, y es lo que hay acá, son las otras dos cosas que el SQL suelto no da:
//
//   · un BORRADO que no se puede pasar de lo que pensabas. `DELETE FROM users WHERE cell_phone=?` es
//     correcto hasta el día en que el `WHERE` matchea 4.000 filas porque el parámetro llegó vacío. La
//     base compartida de dev/qa es de todo el equipo: un borrado de más no se nota hasta que le falta
//     a otro (la forma de CORE-431, donde lo que borró la base fue una herramienta de pruebas).
//   · un INSERT donde las columnas y los valores no se puedan desalinear. Las que había eran listas de
//     15 columnas y 15 `?` a mano, en cinco archivos distintos.
//
// QUÉ NO HACE. No reemplaza `exec()` ni lo esconde: el SQL con `JOIN`, `ON DUPLICATE KEY` o expresiones
// (`NOW()`, `COALESCE`) sigue yendo por ahí, y está bien — envolverlo en un builder sería cambiar SQL
// legible por una capa que hay que aprender. Esto cubre los dos casos donde el SQL a mano se equivoca
// caro, y deja el resto en paz.
import { assertWriteAllowed, withWritesLabel, isLocalDb, exec, scalar, TARGET } from './db.ts';

/** Identificadores: sólo nombres de tabla/columna reales. No vienen de afuera, pero un typo con
 *  backticks produce SQL raro y el error se lee lejos del origen. */
const ID_OK = /^[a-z0-9_]+$/i;
function ident(name: string, what: string): string {
      if (!ID_OK.test(name)) throw new Error(`${what} inválido: ${JSON.stringify(name)} (sólo letras, números y _)`);
      return `\`${name}\``;
}

/**
 * Agrupa un conjunto de escrituras bajo un nombre, y falla TEMPRANO si el ambiente no las permite.
 *
 * Los dos valores: (1) la guarda corre ANTES del trabajo, así que no te enterás a mitad de una siembra
 * de doce pasos; (2) todo lo que se escriba adentro queda etiquetado en el registro de `db.ts`, así que
 * el resumen final dice qué hizo cada cosa y no una lista plana de tablas.
 */
export async function withWrite<T>(name: string, fn: () => Promise<T>): Promise<T> {
      assertWriteAllowed(name);
      return withWritesLabel(name, fn);
}

export interface DeletionOpts {
      /** Cuántas filas se considera razonable borrar. Más que esto, se aborta sin borrar. Default 50. */
      maxFilas?: number;
      /** Para el mensaje de error y el registro: por qué se está borrando. */
      porque?: string;
      /** `true` = contar y reportar, SIN borrar. Para ver el alcance antes de decidir. */
      soloContar?: boolean;
}

export interface Deletion {
      tabla: string;
      contadas: number;
      borradas: number;
      seBorro: boolean;
      nota: string;
}

/**
 * BORRAR CON EL ALCANCE MEDIDO ANTES, no después.
 *
 * Tres cosas que un `DELETE` a mano no hace:
 *
 *   1. **Se niega a borrar sin `WHERE`.** Un `DELETE FROM users` sin condición no es un caso de uso
 *      del arnés; si alguna vez lo es, se escribe a mano y se ve en el diff.
 *   2. **Cuenta primero.** Si el `WHERE` matchea más de `maxFilas`, aborta SIN borrar y dice cuántas
 *      eran. Es la red para el parámetro que llegó vacío o `null`: `WHERE cell_phone = ''` puede
 *      matchear miles de filas y el `DELETE` no se queja.
 *   3. **Deja rastro**, porque pasa por `exec()` y el registro anota los DELETEs — que es justo lo que
 *      `dbops activity` admite que no puede ver (reconstruye mirando filas que existen; una fila
 *      borrada no está).
 *
 * Contra la base LOCAL el tope se relaja: es tu base y borrar de más ahí cuesta un `make fresh`. Contra
 * una base compartida el tope manda.
 */
export async function safeDelete(
      table: string,
      where: string,
      params: any[] = [],
      opts: DeletionOpts = {},
): Promise<Deletion> {
      const t = ident(table, 'nombre de tabla');
      const cond = where.trim().replace(/^where\s+/i, '');
      if (!cond) {
            throw new Error(`borrarSeguro(${table}): sin WHERE no se borra. Un DELETE sin condición se escribe a mano, a propósito.`);
      }
      // `1`, `1=1`, `true`: un WHERE que no filtra es lo mismo que no tenerlo, y es el que se cuela por
      // accidente al construir la condición con un template.
      if (/^(1|1\s*=\s*1|true)$/i.test(cond)) {
            throw new Error(`borrarSeguro(${table}): el WHERE ${JSON.stringify(where)} no filtra nada — sería borrar la tabla.`);
      }

      const limit = opts.maxFilas ?? (isLocalDb() ? 5_000 : 50);
      const counted = Number(await scalar<number>(`SELECT COUNT(*) AS n FROM ${t} WHERE ${cond}`, params)) || 0;

      if (counted === 0) {
            return { tabla: table, contadas: 0, borradas: 0, seBorro: false, nota: 'no había nada que borrar' };
      }
      if (opts.soloContar) {
            return { tabla: table, contadas: counted, borradas: 0, seBorro: false, nota: `${counted} fila(s) coinciden (no se borró: soloContar)` };
      }
      if (counted > limit) {
            throw new Error(
                  `borrarSeguro(${table}): el WHERE matchea ${counted} fila(s) y el tope es ${limit} — NO se borró nada.`
                  + `\n  WHERE ${cond}  ·  params ${JSON.stringify(params)}`
                  + (opts.porque ? `\n  se pedía para: ${opts.porque}` : '')
                  + `\n  Si ${counted} es lo esperado, pasá maxFilas; si no, mirá los parámetros (uno vacío ensancha el WHERE).`
                  + (isLocalDb() ? '' : `\n  ⚠ Y ojo que la base de '${TARGET}' es COMPARTIDA.`),
            );
      }

      const res = await exec(`DELETE FROM ${t} WHERE ${cond}`, params);
      return {
            tabla: table, contadas: counted, borradas: res.affectedRows, seBorro: true,
            nota: `${res.affectedRows} de ${counted} fila(s)${opts.porque ? ` · ${opts.porque}` : ''}`,
      };
}

/**
 * INSERT desde un objeto: las columnas y los valores no se pueden desalinear porque salen del mismo
 * lugar. Reemplaza las listas de 15 columnas y 15 `?` escritas a mano.
 *
 * Los valores van parametrizados. Para una expresión SQL (`NOW()`, `UUID()`) usá `crudo()`.
 */
export type RawValue = { __sql: string };
export function raw(sql: string): RawValue {
      return { __sql: sql };
}

export async function insertRow(
      table: string,
      data: Record<string, any>,
      opts: { ignorarDuplicados?: boolean } = {},
): Promise<{ insertId: number; filas: number }> {
      const t = ident(table, 'nombre de tabla');
      const keys = Object.keys(data);
      if (!keys.length) throw new Error(`insertarFila(${table}): sin columnas`);
      const cols = keys.map((k) => ident(k, 'nombre de columna'));
      const marks: string[] = [];
      const params: any[] = [];
      for (const k of keys) {
            const v = data[k];
            if (v && typeof v === 'object' && '__sql' in v) marks.push((v as RawValue).__sql);
            else { marks.push('?'); params.push(v); }
      }
      const verb = opts.ignorarDuplicados ? 'INSERT IGNORE INTO' : 'INSERT INTO';
      const res = await exec(`${verb} ${t} (${cols.join(', ')}) VALUES (${marks.join(', ')})`, params);
      return { insertId: res.insertId, filas: res.affectedRows };
}

/**
 * UPDATE desde un objeto, con el mismo trato que el borrado: **sin `WHERE` no se actualiza**.
 *
 * Un `UPDATE` sin condición es tan destructivo como un `DELETE` —pisa toda la tabla— y no tiene la
 * señal de alarma que tiene la palabra «delete». Acá se trata igual.
 */
export async function updateRows(
      table: string,
      data: Record<string, any>,
      where: string,
      params: any[] = [],
      opts: { maxFilas?: number } = {},
): Promise<{ filas: number }> {
      const t = ident(table, 'nombre de tabla');
      const cond = where.trim().replace(/^where\s+/i, '');
      if (!cond) throw new Error(`actualizarFilas(${table}): sin WHERE no se actualiza — pisaría la tabla entera.`);
      if (/^(1|1\s*=\s*1|true)$/i.test(cond)) {
            throw new Error(`actualizarFilas(${table}): el WHERE ${JSON.stringify(where)} no filtra nada.`);
      }
      const keys = Object.keys(data);
      if (!keys.length) throw new Error(`actualizarFilas(${table}): sin columnas que cambiar`);

      const limit = opts.maxFilas ?? (isLocalDb() ? 5_000 : 50);
      const counted = Number(await scalar<number>(`SELECT COUNT(*) AS n FROM ${t} WHERE ${cond}`, params)) || 0;
      if (counted > limit) {
            throw new Error(
                  `actualizarFilas(${table}): el WHERE matchea ${counted} fila(s) y el tope es ${limit} — NO se actualizó nada.`
                  + `\n  WHERE ${cond}  ·  params ${JSON.stringify(params)}`,
            );
      }

      const sets: string[] = [];
      const values: any[] = [];
      for (const k of keys) {
            const v = data[k];
            if (v && typeof v === 'object' && '__sql' in v) sets.push(`${ident(k, 'nombre de columna')} = ${(v as RawValue).__sql}`);
            else { sets.push(`${ident(k, 'nombre de columna')} = ?`); values.push(v); }
      }
      const res = await exec(`UPDATE ${t} SET ${sets.join(', ')} WHERE ${cond}`, [...values, ...params]);
      return { filas: res.affectedRows };
}

/**
 * Clona una fila leída con `SELECT *`, aplicando cambios. Devuelve el id nuevo.
 *
 * Es lo que hacen los sembradores: leer una fila que YA funciona —una entidad, una sucursal, una regla—
 * y meter una igual con otro nombre. Estaba escrito dos veces (`mount-merchant.ts` y `mount-peru.ts`)
 * y las dos copias habían divergido en algo chico y real: una ponía `created_at`/`updated_at` en `NOW()`
 * y la otra **copiaba los de la fila original**, así que la fila nueva nacía diciendo que se creó hace
 * dos años. Acá se re-sellan siempre, y sólo si la fila original traía esas columnas.
 *
 * Y de paso hereda la validación de identificadores de `insertRow`: las dos copias interpolaban el
 * nombre de la tabla en el SQL sin mirarlo.
 *
 * ⚠ `id` se descarta salvo que venga en `cambios`: clonar conservando el id es chocar con el original.
 */
export async function cloneRow(
      table: string,
      row: Record<string, any>,
      changes: Record<string, any> = {},
): Promise<number> {
      const r: Record<string, any> = { ...row, ...changes };
      if (!('id' in changes)) delete r.id;

      // Se re-sellan sólo las que la fila original tenía: agregarlas a una tabla que no las declara
      // sería un error de columna desconocida, y quitarlas de una que sí las exige, un NOT NULL.
      for (const col of ['created_at', 'updated_at']) {
            if (col in r) r[col] = raw('NOW()');
      }

      // Un JSON leído de la base vuelve como objeto; si se manda así, el driver lo serializa como
      // `[object Object]`.
      for (const [k, v] of Object.entries(r)) {
            if (v !== null && typeof v === 'object' && !('__sql' in v) && !(v instanceof Date)) r[k] = JSON.stringify(v);
      }

      const { insertId } = await insertRow(table, r);
      return insertId;
}
