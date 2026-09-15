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
import type { PoolConnection } from 'mysql2/promise';
import { assertWriteAllowed, conEtiquetaDeEscrituras, esBaseLocal, exec, scalar, TARGET, withConnection } from './db.ts';

/** Identificadores: sólo nombres de tabla/columna reales. No vienen de afuera, pero un typo con
 *  backticks produce SQL raro y el error se lee lejos del origen. */
const ID_OK = /^[a-z0-9_]+$/i;
function ident(nombre: string, que: string): string {
      if (!ID_OK.test(nombre)) throw new Error(`${que} inválido: ${JSON.stringify(nombre)} (sólo letras, números y _)`);
      return `\`${nombre}\``;
}

/**
 * Agrupa un conjunto de escrituras bajo un nombre, y falla TEMPRANO si el ambiente no las permite.
 *
 * Los dos valores: (1) la guarda corre ANTES del trabajo, así que no te enterás a mitad de una siembra
 * de doce pasos; (2) todo lo que se escriba adentro queda etiquetado en el registro de `db.ts`, así que
 * el resumen final dice qué hizo cada cosa y no una lista plana de tablas.
 */
export async function withWrite<T>(nombre: string, fn: () => Promise<T>): Promise<T> {
      assertWriteAllowed(nombre);
      return conEtiquetaDeEscrituras(nombre, fn);
}

/**
 * Igual, pero TODO O NADA: corre sobre una conexión dedicada, con transacción.
 *
 * ⚠ Es para código NUEVO. El `exec()` del módulo usa el pool, así que una escritura que llame a `exec`
 * adentro de esto **no entra en la transacción** — iría por otra conexión. Por eso el callback recibe
 * la conexión: lo que tiene que ser atómico se escribe con ella (`c.query(...)`). Prometer atomicidad
 * y no darla sería peor que no tenerla.
 */
export async function withWriteTx<T>(nombre: string, fn: (c: PoolConnection) => Promise<T>): Promise<T> {
      assertWriteAllowed(nombre);
      return conEtiquetaDeEscrituras(nombre, async () => {
            return withConnection(async (c) => {
                  await c.beginTransaction();
                  try {
                        const out = await fn(c);
                        await c.commit();
                        return out;
                  } catch (e) {
                        await c.rollback().catch(() => {});
                        throw e;
                  }
            });
      });
}

export interface BorradoOpts {
      /** Cuántas filas se considera razonable borrar. Más que esto, se aborta sin borrar. Default 50. */
      maxFilas?: number;
      /** Para el mensaje de error y el registro: por qué se está borrando. */
      porque?: string;
      /** `true` = contar y reportar, SIN borrar. Para ver el alcance antes de decidir. */
      soloContar?: boolean;
}

export interface Borrado {
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
export async function borrarSeguro(
      tabla: string,
      where: string,
      params: any[] = [],
      opts: BorradoOpts = {},
): Promise<Borrado> {
      const t = ident(tabla, 'nombre de tabla');
      const cond = where.trim().replace(/^where\s+/i, '');
      if (!cond) {
            throw new Error(`borrarSeguro(${tabla}): sin WHERE no se borra. Un DELETE sin condición se escribe a mano, a propósito.`);
      }
      // `1`, `1=1`, `true`: un WHERE que no filtra es lo mismo que no tenerlo, y es el que se cuela por
      // accidente al construir la condición con un template.
      if (/^(1|1\s*=\s*1|true)$/i.test(cond)) {
            throw new Error(`borrarSeguro(${tabla}): el WHERE ${JSON.stringify(where)} no filtra nada — sería borrar la tabla.`);
      }

      const tope = opts.maxFilas ?? (esBaseLocal() ? 5_000 : 50);
      const contadas = Number(await scalar<number>(`SELECT COUNT(*) AS n FROM ${t} WHERE ${cond}`, params)) || 0;

      if (contadas === 0) {
            return { tabla, contadas: 0, borradas: 0, seBorro: false, nota: 'no había nada que borrar' };
      }
      if (opts.soloContar) {
            return { tabla, contadas, borradas: 0, seBorro: false, nota: `${contadas} fila(s) coinciden (no se borró: soloContar)` };
      }
      if (contadas > tope) {
            throw new Error(
                  `borrarSeguro(${tabla}): el WHERE matchea ${contadas} fila(s) y el tope es ${tope} — NO se borró nada.`
                  + `\n  WHERE ${cond}  ·  params ${JSON.stringify(params)}`
                  + (opts.porque ? `\n  se pedía para: ${opts.porque}` : '')
                  + `\n  Si ${contadas} es lo esperado, pasá maxFilas; si no, mirá los parámetros (uno vacío ensancha el WHERE).`
                  + (esBaseLocal() ? '' : `\n  ⚠ Y ojo que la base de '${TARGET}' es COMPARTIDA.`),
            );
      }

      const res = await exec(`DELETE FROM ${t} WHERE ${cond}`, params);
      return {
            tabla, contadas, borradas: res.affectedRows, seBorro: true,
            nota: `${res.affectedRows} de ${contadas} fila(s)${opts.porque ? ` · ${opts.porque}` : ''}`,
      };
}

/**
 * INSERT desde un objeto: las columnas y los valores no se pueden desalinear porque salen del mismo
 * lugar. Reemplaza las listas de 15 columnas y 15 `?` escritas a mano.
 *
 * Los valores van parametrizados. Para una expresión SQL (`NOW()`, `UUID()`) usá `crudo()`.
 */
export type ValorCrudo = { __sql: string };
export function crudo(sql: string): ValorCrudo {
      return { __sql: sql };
}

export async function insertarFila(
      tabla: string,
      datos: Record<string, any>,
      opts: { ignorarDuplicados?: boolean } = {},
): Promise<{ insertId: number; filas: number }> {
      const t = ident(tabla, 'nombre de tabla');
      const claves = Object.keys(datos);
      if (!claves.length) throw new Error(`insertarFila(${tabla}): sin columnas`);
      const cols = claves.map((k) => ident(k, 'nombre de columna'));
      const marcas: string[] = [];
      const params: any[] = [];
      for (const k of claves) {
            const v = datos[k];
            if (v && typeof v === 'object' && '__sql' in v) marcas.push((v as ValorCrudo).__sql);
            else { marcas.push('?'); params.push(v); }
      }
      const verbo = opts.ignorarDuplicados ? 'INSERT IGNORE INTO' : 'INSERT INTO';
      const res = await exec(`${verbo} ${t} (${cols.join(', ')}) VALUES (${marcas.join(', ')})`, params);
      return { insertId: res.insertId, filas: res.affectedRows };
}

/**
 * UPDATE desde un objeto, con el mismo trato que el borrado: **sin `WHERE` no se actualiza**.
 *
 * Un `UPDATE` sin condición es tan destructivo como un `DELETE` —pisa toda la tabla— y no tiene la
 * señal de alarma que tiene la palabra «delete». Acá se trata igual.
 */
export async function actualizarFilas(
      tabla: string,
      datos: Record<string, any>,
      where: string,
      params: any[] = [],
      opts: { maxFilas?: number } = {},
): Promise<{ filas: number }> {
      const t = ident(tabla, 'nombre de tabla');
      const cond = where.trim().replace(/^where\s+/i, '');
      if (!cond) throw new Error(`actualizarFilas(${tabla}): sin WHERE no se actualiza — pisaría la tabla entera.`);
      if (/^(1|1\s*=\s*1|true)$/i.test(cond)) {
            throw new Error(`actualizarFilas(${tabla}): el WHERE ${JSON.stringify(where)} no filtra nada.`);
      }
      const claves = Object.keys(datos);
      if (!claves.length) throw new Error(`actualizarFilas(${tabla}): sin columnas que cambiar`);

      const tope = opts.maxFilas ?? (esBaseLocal() ? 5_000 : 50);
      const contadas = Number(await scalar<number>(`SELECT COUNT(*) AS n FROM ${t} WHERE ${cond}`, params)) || 0;
      if (contadas > tope) {
            throw new Error(
                  `actualizarFilas(${tabla}): el WHERE matchea ${contadas} fila(s) y el tope es ${tope} — NO se actualizó nada.`
                  + `\n  WHERE ${cond}  ·  params ${JSON.stringify(params)}`,
            );
      }

      const sets: string[] = [];
      const valores: any[] = [];
      for (const k of claves) {
            const v = datos[k];
            if (v && typeof v === 'object' && '__sql' in v) sets.push(`${ident(k, 'nombre de columna')} = ${(v as ValorCrudo).__sql}`);
            else { sets.push(`${ident(k, 'nombre de columna')} = ?`); valores.push(v); }
      }
      const res = await exec(`UPDATE ${t} SET ${sets.join(', ')} WHERE ${cond}`, [...valores, ...params]);
      return { filas: res.affectedRows };
}
