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
import { esBaseLocal, escriturasDeLaCorrida, exec, mutacionDe, query, resumenDeEscrituras } from './db.ts';
import { actualizarFilas, borrarSeguro, crudo, insertarFila, withWrite } from './db-safe.ts';

const TABLA = 'harness_db_safe_probe';
/** La tabla de juego es POR WORKER. Playwright reparte los tests entre procesos y los dos corrían el
 *  `beforeAll`: el segundo moría con «Table already exists» y, peor, se habrían pisado las filas. */
let tabla = TABLA;

test.describe('¿esta sentencia muta?', () => {
      test('reconoce las que mutan, con su tabla', () => {
            expect(mutacionDe('INSERT INTO users (a) VALUES (1)')).toEqual({ op: 'INSERT INTO', tabla: 'users' });
            expect(mutacionDe('UPDATE  `user_requests` SET a=1')).toEqual({ op: 'UPDATE', tabla: 'user_requests' });
            expect(mutacionDe('DELETE FROM settings WHERE x=1')).toEqual({ op: 'DELETE FROM', tabla: 'settings' });
            expect(mutacionDe('insert ignore into otps (a) values (1)')?.tabla).toBe('otps');
            expect(mutacionDe('TRUNCATE TABLE users')?.op).toContain('TRUNCATE');
      });

      // 🔴 Un chequeo que marca de más se aprende a ignorar. `SET FOREIGN_KEY_CHECKS=0` es una perilla
      // de sesión (la usan los seeders) y un SELECT que menciona «delete» no muta nada.
      test('NO marca lo que no muta', () => {
            expect(mutacionDe('SELECT * FROM users WHERE motivo = "delete"')).toBeNull();
            expect(mutacionDe('SET FOREIGN_KEY_CHECKS = 0')).toBeNull();
            expect(mutacionDe('SHOW TABLES LIKE "users"')).toBeNull();
            expect(mutacionDe('  \n SELECT 1')).toBeNull();
      });
});

test.describe('lo que se niega a hacer, sin tocar la base', () => {
      test('borrar sin WHERE', async () => {
            await expect(borrarSeguro(TABLA, '')).rejects.toThrow(/sin WHERE no se borra/);
      });

      // El WHERE que no filtra es el que se cuela armando la condición con un template.
      test('borrar con un WHERE que no filtra', async () => {
            await expect(borrarSeguro(TABLA, '1=1')).rejects.toThrow(/no filtra nada/);
            await expect(borrarSeguro(TABLA, 'TRUE')).rejects.toThrow(/no filtra nada/);
      });

      // Un UPDATE sin WHERE pisa la tabla entera y no tiene la señal de alarma que tiene «delete».
      test('actualizar sin WHERE', async () => {
            await expect(actualizarFilas(TABLA, { a: 1 }, '')).rejects.toThrow(/sin WHERE no se actualiza/);
      });

      test('un nombre de tabla que no es un identificador', async () => {
            await expect(borrarSeguro('users; DROP TABLE x', 'id=1')).rejects.toThrow(/inválido/);
            await expect(insertarFila('ok', { 'a b': 1 })).rejects.toThrow(/inválido/);
      });
});

// ── la mitad que necesita base: SÓLO LOCAL ─────────────────────────────────────────────────────────
test.describe('contra la base local', () => {
      // EN SERIE, y no por prolijidad: estos tests se pasan estado (uno siembra 6 filas y el siguiente
      // cuenta que sean 6). En paralelo se cuentan entre ellos y el fallo no se parece a la causa.
      test.describe.configure({ mode: 'serial' });
      test.skip(!esBaseLocal(), 'la base de este target es compartida: no se escribe ahí para probar la herramienta');

      test.beforeAll(async ({}, info) => {
            tabla = `${TABLA}_${info.workerIndex}`;   // desde la CONSTANTE, no desde `tabla`: si no, una segunda pasada la concatena otra vez
            await exec(`DROP TABLE IF EXISTS ${tabla}`);
            await exec(`CREATE TABLE ${tabla} (id INT AUTO_INCREMENT PRIMARY KEY, tel VARCHAR(32), nota VARCHAR(64))`);
      });

      test.afterAll(async () => {
            await exec(`DROP TABLE IF EXISTS ${tabla}`);
      });

      test('insertar desde un objeto: columnas y valores no se pueden desalinear', async () => {
            const r = await insertarFila(tabla, { tel: '3131010101', nota: crudo("CONCAT('hecho ', 'acá')") });
            expect(r.insertId).toBeGreaterThan(0);
            const fila = await query<{ tel: string; nota: string }>(`SELECT tel, nota FROM ${tabla} WHERE id=?`, [r.insertId]);
            expect(fila[0].tel).toBe('3131010101');
            expect(fila[0].nota).toBe('hecho acá');   // el valor crudo se evaluó como SQL, no se guardó literal
      });

      // 🔴 LA RED QUE IMPORTA: el parámetro que llegó vacío ensancha el WHERE y el DELETE no se queja.
      test('un borrado que matchea más de lo esperado ABORTA sin borrar', async () => {
            for (let i = 0; i < 6; i++) await insertarFila(tabla, { tel: '', nota: `masivo-${i}` });
            const antes = Number((await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${tabla}`))[0].n);

            await expect(borrarSeguro(tabla, 'tel = ?', [''], { maxFilas: 3, porque: 'scrub del cliente' }))
                  .rejects.toThrow(/matchea 6 fila\(s\) y el tope es 3 — NO se borró nada/);

            const despues = Number((await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${tabla}`))[0].n);
            expect(despues).toBe(antes);   // y de verdad no borró: el conteo no se movió
      });

      test('soloContar dice el alcance sin borrar', async () => {
            const r = await borrarSeguro(tabla, 'tel = ?', [''], { soloContar: true });
            expect(r.seBorro).toBe(false);
            expect(r.contadas).toBe(6);
      });

      test('dentro del tope, borra y dice cuántas', async () => {
            const r = await borrarSeguro(tabla, 'tel = ?', [''], { maxFilas: 10 });
            expect(r.seBorro).toBe(true);
            expect(r.borradas).toBe(6);
            expect(Number((await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${tabla} WHERE tel=''`))[0].n)).toBe(0);
      });

      test('actualizar respeta el tope igual que borrar', async () => {
            for (let i = 0; i < 4; i++) await insertarFila(tabla, { tel: 'x', nota: `u-${i}` });
            await expect(actualizarFilas(tabla, { nota: 'pisado' }, 'tel = ?', ['x'], { maxFilas: 2 }))
                  .rejects.toThrow(/matchea 4 fila\(s\) y el tope es 2/);
            const r = await actualizarFilas(tabla, { nota: 'pisado' }, 'tel = ?', ['x'], { maxFilas: 10 });
            expect(r.filas).toBe(4);
      });

      // El registro es lo que `dbops activity` no puede dar: éste anota la sentencia cuando corre, así
      // que el DELETE queda — reconstruirlo mirando filas que existen no lo ve, porque ya no están.
      test('el registro ve los DELETEs, y withWrite los etiqueta', async () => {
            await withWrite('prueba-del-registro', async () => {
                  const { insertId } = await insertarFila(tabla, { tel: '3009999999' });
                  await borrarSeguro(tabla, 'id = ?', [insertId]);
            });
            const etiquetadas = escriturasDeLaCorrida().filter((e) => e.etiqueta === 'prueba-del-registro');
            expect(etiquetadas.map((e) => e.op.split(' ')[0])).toEqual(['INSERT', 'DELETE']);
            expect(resumenDeEscrituras().some((r) => r.tabla === tabla)).toBe(true);
      });
});
