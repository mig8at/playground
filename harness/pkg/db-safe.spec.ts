// Qué se fija acá: que escribir en una base COMPARTIDA no se pueda hacer por olvido, y que un borrado
// no se pueda pasar de lo que pensabas.
//
// El caso que lo motivó, medido el 2026-09-15: `exec()` crudo en 15 archivos y **nueve sin nombrar la
// guarda nunca** — entre ellos el `UPDATE settings` del bypass de OTP, que contra `qa` le cambia la
// lista de teléfonos a todo el equipo. La guarda existía desde F-53; lo que faltaba era que estuviera
// en el camino de la escritura y no a criterio de quien escribe.
//
// La mitad de DB corre SÓLO contra local, sobre una tabla propia que se crea y se borra acá. Contra una
// base compartida estas pruebas se saltan: probar la herramienta no es motivo para escribir allá.
import { expect, test } from '@playwright/test';
import { isLocalDb, runWrites, exec, blockReason, mutationOf, query, writesSummary } from './db.ts';
import { updateRows, safeDelete, raw, insertRow, withWrite } from './db-safe.ts';

const TABLE = 'harness_db_safe_probe';
/** La tabla de juego es POR WORKER. Playwright reparte los tests entre procesos y los dos corrían el
 *  `beforeAll`: el segundo moría con «Table already exists» y, peor, se habrían pisado las filas. */
let table = TABLE;

test.describe('¿esta sentencia muta?', () => {
      test('reconoce las que mutan, con su tabla', () => {
            expect(mutationOf('INSERT INTO users (a) VALUES (1)')).toEqual({ op: 'INSERT INTO', tabla: 'users' });
            expect(mutationOf('UPDATE  `user_requests` SET a=1')).toEqual({ op: 'UPDATE', tabla: 'user_requests' });
            expect(mutationOf('DELETE FROM settings WHERE x=1')).toEqual({ op: 'DELETE FROM', tabla: 'settings' });
            expect(mutationOf('insert ignore into otps (a) values (1)')?.tabla).toBe('otps');
            expect(mutationOf('TRUNCATE TABLE users')?.op).toContain('TRUNCATE');
      });

      // 🔴 Un chequeo que marca de más se aprende a ignorar. `SET FOREIGN_KEY_CHECKS=0` es una perilla
      // de sesión (la usan los seeders) y un SELECT que menciona «delete» no muta nada.
      // 🔴 `IF EXISTS` va ENTRE el verbo y la tabla. Sin contemplarlo el nombre que salia era
      // `if`, y lo vi en el propio log que este registro vino a hacer confiable. Un registro con
      // nombres inventados se lee como si fueran tablas reales: es peor que no tenerlo.
      test('IF [NOT] EXISTS no se confunde con el nombre de la tabla', () => {
            expect(mutationOf('DROP TABLE IF EXISTS harness_probe')).toEqual({ op: 'DROP TABLE', tabla: 'harness_probe' });
            expect(mutationOf('CREATE TABLE IF NOT EXISTS otps (a INT)')).toEqual({ op: 'CREATE TABLE', tabla: 'otps' });
      });

      test('NO marca lo que no muta', () => {
            expect(mutationOf('SELECT * FROM users WHERE motivo = "delete"')).toBeNull();
            expect(mutationOf('SET FOREIGN_KEY_CHECKS = 0')).toBeNull();
            expect(mutationOf('SHOW TABLES LIKE "users"')).toBeNull();
            expect(mutationOf('  \n SELECT 1')).toBeNull();
      });
});

// Los PERMISOS ANGOSTOS: lo que deja escribir en la compartida sin abrir el permiso general. Se prueban
// con `blockReason`, que es pura — sin base y sin variables de entorno, así que estas pruebas
// corren en cualquier target y no escriben en ningún lado.
//
// Se fijan acá porque esta es la función que autoriza a escribir en la base del EQUIPO: si un patrón se
// afloja de más, nadie lo nota hasta que algo pisó datos que no eran de la corrida.
test.describe('permisos angostos', () => {
      const SEED = 'UPDATE users SET document_number=?, updated_at=NOW() WHERE id=?';
      const scope = (...ids: number[]) => new Set(ids);

      test('sin permiso no opina: decide el llamador', () => {
            expect(blockReason('DELETE FROM users', '', 0, [], undefined)).toBeNull();
      });

      test('un permiso que no existe se rechaza nombrando los que hay', () => {
            expect(blockReason(SEED, 'inventado', 7, [7], scope(7))).toMatch(/desconocido/);
      });

      // 🔴 El punto de todo el mecanismo: la ETIQUETA no autoriza, la SENTENCIA sí. Si esto se afloja,
      // cualquier escritura puede pasar poniéndose el nombre de un permiso que existe.
      test('la etiqueta NO sirve de contrabando para otra sentencia', () => {
            expect(blockReason('DELETE FROM users WHERE id=?', 'siembra', 7, [7], scope(7))).toMatch(/NO cubre esta sentencia/);
            expect(blockReason('UPDATE users SET a=1 WHERE id=?', 'otp-bypass', 0, [1], undefined)).toMatch(/NO cubre esta sentencia/);
            expect(blockReason('DROP TABLE users', 'siembra', 7, [7], scope(7))).toMatch(/NO cubre esta sentencia/);
      });

      test('el bypass de OTP no necesita ámbito: no hay datos de personas en esa lista', () => {
            const sum = "UPDATE settings SET value = JSON_MERGE_PRESERVE(value, CAST(? AS JSON)) WHERE `key`=? AND JSON_CONTAINS(value, '\"*\"') = 0";
            expect(blockReason(sum, 'otp-bypass', 0, ['[]', 'qa_otp_bypass_phones'], undefined)).toBeNull();
      });

      // 🔴 Las tres condiciones de `siembra`. Cada una tapa un agujero distinto, y sacando cualquiera de
      // las tres la escritura puede caer sobre una fila que la corrida no creó.
      test('sembrar sin ámbito abierto se bloquea', () => {
            expect(blockReason(SEED, 'siembra', 7, ['x', 7], undefined)).toMatch(/necesita un ámbito/);
      });

      test('sembrar sobre un usuario que no está en el ámbito se bloquea', () => {
            expect(blockReason(SEED, 'siembra', 9, ['x', 9], scope(7))).toMatch(/sólo alcanza a los usuarios de esta corrida/);
            expect(blockReason(SEED, 'siembra', 0, ['x', 7], scope(7))).toMatch(/sólo alcanza a los usuarios de esta corrida/);
      });

      test('declarar un dueño y escribirle a OTRO se bloquea', () => {
            // El id declarado está en el ámbito, pero la sentencia le escribe al 9: sin este chequeo
            // el ámbito no serviría de nada, porque el dueño sería una promesa y no un hecho.
            expect(blockReason(SEED, 'siembra', 7, ['x', 9], scope(7))).toMatch(/NO está entre sus parámetros/);
      });

      test('y con las tres puestas, pasa', () => {
            expect(blockReason(SEED, 'siembra', 7, ['x', 7], scope(7, 8))).toBeNull();
      });

      // 🔴 Los dos UPDATE que van por id de fila llevan `AND user_id=?` justamente para que el dueño sea
      // comprobable. Si alguien los "simplifica" sacándolo, el patrón deja de matchear y la guarda frena
      // — que es lo que se quiere, y esta prueba lo deja dicho.
      test('los UPDATE por id de fila exigen el `AND user_id=?`', () => {
            const withValue = 'UPDATE user_summaries SET agildata=?, datacredito=?, updated_at=NOW() WHERE id=? AND user_id=?';
            const without = 'UPDATE user_summaries SET agildata=?, datacredito=?, updated_at=NOW() WHERE id=?';
            expect(blockReason(withValue, 'siembra', 7, ['a', 'b', 3, 7], scope(7))).toBeNull();
            expect(blockReason(without, 'siembra', 7, ['a', 'b', 3], scope(7))).toMatch(/NO cubre esta sentencia/);
      });
});

test.describe('lo que se niega a hacer, sin tocar la base', () => {
      test('borrar sin WHERE', async () => {
            await expect(safeDelete(TABLE, '')).rejects.toThrow(/sin WHERE no se borra/);
      });

      // El WHERE que no filtra es el que se cuela armando la condición con un template.
      test('borrar con un WHERE que no filtra', async () => {
            await expect(safeDelete(TABLE, '1=1')).rejects.toThrow(/no filtra nada/);
            await expect(safeDelete(TABLE, 'TRUE')).rejects.toThrow(/no filtra nada/);
      });

      // Un UPDATE sin WHERE pisa la tabla entera y no tiene la señal de alarma que tiene «delete».
      test('actualizar sin WHERE', async () => {
            await expect(updateRows(TABLE, { a: 1 }, '')).rejects.toThrow(/sin WHERE no se actualiza/);
      });

      test('un nombre de tabla que no es un identificador', async () => {
            await expect(safeDelete('users; DROP TABLE x', 'id=1')).rejects.toThrow(/inválido/);
            await expect(insertRow('ok', { 'a b': 1 })).rejects.toThrow(/inválido/);
      });
});

// ── la mitad que necesita base: SÓLO LOCAL ─────────────────────────────────────────────────────────
test.describe('contra la base local', () => {
      // EN SERIE, y no por prolijidad: estos tests se pasan estado (uno siembra 6 filas y el siguiente
      // cuenta que sean 6). En paralelo se cuentan entre ellos y el fallo no se parece a la causa.
      test.describe.configure({ mode: 'serial' });
      test.skip(!isLocalDb(), 'la base de este target es compartida: no se escribe ahí para probar la herramienta');

      test.beforeAll(async ({}, info) => {
            table = `${TABLE}_${info.workerIndex}`;   // desde la CONSTANTE, no desde `tabla`: si no, una segunda pasada la concatena otra vez
            await exec(`DROP TABLE IF EXISTS ${table}`);
            await exec(`CREATE TABLE ${table} (id INT AUTO_INCREMENT PRIMARY KEY, tel VARCHAR(32), nota VARCHAR(64))`);
      });

      test.afterAll(async () => {
            await exec(`DROP TABLE IF EXISTS ${table}`);
      });

      test('insertar desde un objeto: columnas y valores no se pueden desalinear', async () => {
            const r = await insertRow(table, { tel: '3131010101', nota: raw("CONCAT('hecho ', 'acá')") });
            expect(r.insertId).toBeGreaterThan(0);
            const row = await query<{ tel: string; nota: string }>(`SELECT tel, nota FROM ${table} WHERE id=?`, [r.insertId]);
            expect(row[0].tel).toBe('3131010101');
            expect(row[0].nota).toBe('hecho acá');   // el valor crudo se evaluó como SQL, no se guardó literal
      });

      // 🔴 LA RED QUE IMPORTA: el parámetro que llegó vacío ensancha el WHERE y el DELETE no se queja.
      test('un borrado que matchea más de lo esperado ABORTA sin borrar', async () => {
            for (let i = 0; i < 6; i++) await insertRow(table, { tel: '', nota: `masivo-${i}` });
            const before = Number((await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))[0].n);

            await expect(safeDelete(table, 'tel = ?', [''], { maxFilas: 3, porque: 'scrub del cliente' }))
                  .rejects.toThrow(/matchea 6 fila\(s\) y el tope es 3 — NO se borró nada/);

            const after = Number((await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))[0].n);
            expect(after).toBe(before);   // y de verdad no borró: el conteo no se movió
      });

      test('soloContar dice el alcance sin borrar', async () => {
            const r = await safeDelete(table, 'tel = ?', [''], { soloContar: true });
            expect(r.seBorro).toBe(false);
            expect(r.contadas).toBe(6);
      });

      test('dentro del tope, borra y dice cuántas', async () => {
            const r = await safeDelete(table, 'tel = ?', [''], { maxFilas: 10 });
            expect(r.seBorro).toBe(true);
            expect(r.borradas).toBe(6);
            expect(Number((await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE tel=''`))[0].n)).toBe(0);
      });

      test('actualizar respeta el tope igual que borrar', async () => {
            for (let i = 0; i < 4; i++) await insertRow(table, { tel: 'x', nota: `u-${i}` });
            await expect(updateRows(table, { nota: 'pisado' }, 'tel = ?', ['x'], { maxFilas: 2 }))
                  .rejects.toThrow(/matchea 4 fila\(s\) y el tope es 2/);
            const r = await updateRows(table, { nota: 'pisado' }, 'tel = ?', ['x'], { maxFilas: 10 });
            expect(r.filas).toBe(4);
      });

      // 🔴 LA QUE HABRÍA CAZADO EL BUG DE LA ETIQUETA. La primera versión guardaba la etiqueta en un
      // `let` de MÓDULO —una por proceso—, así que dos `withWrite` concurrentes se la pisaban y el
      // registro atribuía las escrituras de uno al otro. Es la misma trampa que `pkg/trace.ts` ya
      // había pagado, y correr en PARALELO es lo único que la muestra.
      test('dos withWrite CONCURRENTES no se pisan la etiqueta', async () => {
            const [a, b] = await Promise.all([
                  withWrite('caso-A', async () => (await insertRow(table, { tel: 'A' })).insertId),
                  withWrite('caso-B', async () => (await insertRow(table, { tel: 'B' })).insertId),
            ]);
            expect(a).toBeGreaterThan(0);
            expect(b).toBeGreaterThan(0);
            const byLabel = (e: string) => runWrites().filter((x) => x.etiqueta === e);
            expect(byLabel('caso-A')).toHaveLength(1);
            expect(byLabel('caso-B')).toHaveLength(1);
      });

      // El registro es lo que `dbops activity` no puede dar: éste anota la sentencia cuando corre, así
      // que el DELETE queda — reconstruirlo mirando filas que existen no lo ve, porque ya no están.
      test('el registro ve los DELETEs, y withWrite los etiqueta', async () => {
            await withWrite('prueba-del-registro', async () => {
                  const { insertId } = await insertRow(table, { tel: '3009999999' });
                  await safeDelete(table, 'id = ?', [insertId]);
            });
            const labeled = runWrites().filter((e) => e.etiqueta === 'prueba-del-registro');
            expect(labeled.map((e) => e.op.split(' ')[0])).toEqual(['INSERT', 'DELETE']);
            expect(writesSummary().some((r) => r.tabla === table)).toBe(true);
      });
});
