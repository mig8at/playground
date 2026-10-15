#!/usr/bin/env node
/**
 * ¿A LA BASE COMPARTIDA LE FALTA UNA TABLA QUE SUS MIGRACIONES DAN POR CREADA? La recrea, igual a producción.
 *
 *   make harness-table-restore TABLE=netco_signing_documents TARGET=qa            (sólo muestra)
 *   make harness-table-restore TABLE=netco_signing_documents TARGET=qa APPLY=1    (la crea)
 *
 * POR QUÉ EXISTE. El 2026-10-15 el pagaré de Credifamilia en qa moría con «Table
 * 'creditop.netco_signing_documents' doesn't exist», y sus cinco migraciones figuraban como corridas en
 * `migrations`. Con las migraciones registradas, `artisan migrate` contesta «Nothing to migrate» y no la
 * recrea: el camino de Laravel no sirve, y borrar filas de `migrations` para engañarlo toca más de lo
 * necesario. Esto crea SÓLO la tabla, con el DDL que ya tiene la base local (donde las migraciones sí
 * corrieron), después de comprobar que ese DDL es el de producción.
 *
 * Qué comprueba antes de escribir, y por qué cada cosa:
 *  1. que la tabla NO exista en el destino — si existe, no hay nada que restaurar (y un CREATE la pisaría);
 *  2. que alguna migración registrada en el destino la cree — si no, falta la migración entera y lo que
 *     corresponde es migrar, no copiar una tabla suelta;
 *  3. que columnas e índices de la local sean IDÉNTICOS a los de producción — la local es un dump de dev
 *     con migraciones de ramas sin mergear, y copiar de ahí sin comparar podría inventar una columna.
 *
 * ESCRIBE en la base compartida: el CREATE pasa por `exec()` de `pkg/db.ts`, cuya guarda exige
 * `I_KNOW_THIS_TOUCHES_SHARED_DEV=1` exportado a mano. Producción se lee por el conector (solo lectura,
 * VPN de prod); el destino `local` y `prod` se rechazan.
 */
import { execFileSync } from 'node:child_process';
import { close, exec, scalar, query } from '../pkg/db.ts';
import { TARGET } from '../pkg/env.ts';
import { runPg, lastLine } from '../pkg/pg.ts';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] ?? '' : ''; };
const flag = (n: string) => process.argv.includes(`--${n}`);

const TABLE = arg('table');
const APPLY = flag('apply');
const LOCAL_CONTAINER = process.env.LOCAL_MYSQL_CONTAINER || 'legacy-backend-mysql-1';

/** Columnas e índices, en una forma comparable entre bases: lo que define la tabla, sin contadores. */
const SHAPE_SQL = (schemaExpr: string, table: string) => `
SELECT 'col' AS k, CONCAT_WS('|', column_name, column_type, is_nullable, IFNULL(column_default,'∅'), extra) AS v, ordinal_position AS o
  FROM information_schema.columns WHERE table_schema=${schemaExpr} AND table_name='${table}'
UNION ALL
SELECT 'idx', CONCAT_WS('|', index_name, non_unique, GROUP_CONCAT(column_name ORDER BY seq_in_index)), 0
  FROM information_schema.statistics WHERE table_schema=${schemaExpr} AND table_name='${table}'
  GROUP BY index_name, non_unique
ORDER BY k, o, v`;

function shapeVia(target: string): string[] {
    const r = runPg(['sql', '--target', target, '--json', '--query', SHAPE_SQL('DATABASE()', TABLE)]);
    if (r.status !== 0) throw new Error(`no se pudo leer la forma de ${TABLE} en ${target}: ${lastLine(r.stderr || r.stdout)}`);
    return (JSON.parse(r.stdout).rows as Array<{ k: string; v: string }>).map(x => `${x.k} ${x.v}`);
}

function localDDL(): string {
    // El conector sólo deja SELECT, y SHOW CREATE TABLE es la forma exacta en que MySQL la escribiría.
    const out = execFileSync('docker', ['exec', LOCAL_CONTAINER, 'sh', '-c',
        `mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -N -B -e 'SHOW CREATE TABLE \`${TABLE}\`' "$MYSQL_DATABASE" 2>/dev/null`], { encoding: 'utf8' });
    const ddl = out.split('\t').slice(1).join('\t').replace(/\\n/g, '\n').trim();
    if (!/^CREATE TABLE/.test(ddl)) throw new Error(`la base local no devolvió el DDL de ${TABLE}`);
    // El contador de la local no tiene nada que ver con el destino.
    return ddl.replace(/\s+AUTO_INCREMENT=\d+/, '');
}

function diff(a: string[], b: string[]): string[] {
    const sa = new Set(a), sb = new Set(b);
    return [...a.filter(x => !sb.has(x)).map(x => `  solo en local: ${x}`), ...b.filter(x => !sa.has(x)).map(x => `  solo en prod:  ${x}`)];
}

async function main(): Promise<number> {
    if (!/^[a-z0-9_]+$/.test(TABLE)) { console.error('  falta TABLE=<tabla> (minúsculas, números y _)'); return 2; }
    if (TARGET === 'local' || TARGET === 'prod') { console.error(`  TARGET=${TARGET}: esto es para la base compartida (dev · qa · staging)`); return 2; }

    console.log(`\n  RESTAURAR TABLA · ${TABLE} · destino ${TARGET}${APPLY ? '' : ' · sólo muestra (APPLY=1 para crearla)'}\n`);

    // 1. ¿Falta de verdad?
    const exists = Number(await scalar(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?`, [TABLE]));
    if (exists) { console.log(`  ✔ ${TABLE} ya existe en ${TARGET}: no hay nada que restaurar.`); return 0; }
    console.log(`  ✗ ${TABLE} no existe en ${TARGET}`);

    // 2. ¿Las migraciones la dan por creada?
    const migs = await query<{ migration: string; batch: number }>(
        `SELECT migration, batch FROM migrations WHERE migration LIKE ? ORDER BY id`, [`%${TABLE}%`]);
    if (!migs.some(m => m.migration.endsWith(`_create_${TABLE}_table`))) {
        console.log(`  ✗ ninguna migración registrada crea ${TABLE}: lo que falta es migrar, no restaurar la tabla.`);
        return 2;
    }
    for (const m of migs) console.log(`  · registrada: ${m.migration} (batch ${m.batch})`);

    // 3. ¿La local es igual a producción?
    const local = shapeVia('local');
    if (!local.length) { console.log(`  ✗ ${TABLE} tampoco existe en la base local: no hay de dónde copiarla.`); return 2; }
    let prod: string[];
    try { prod = shapeVia('prod'); } catch (e) {
        console.log(`  ✗ ${(e as Error).message}`);
        console.log('    Sin comparar con producción no se crea: la local puede traer columnas de ramas sin mergear. ¿VPN de prod?');
        return 2;
    }
    const d = diff(local, prod);
    if (d.length) { console.log(`  ✗ la local NO es igual a producción:\n${d.join('\n')}`); return 2; }
    const cols = local.filter(x => x.startsWith('col')).length, idx = local.length - cols;
    console.log(`  ✔ local = producción: ${cols} columnas y ${idx} índices idénticos\n`);

    const ddl = localDDL();
    console.log(ddl.split('\n').map(l => `    ${l}`).join('\n') + '\n');
    if (!APPLY) { console.log('  (sólo mostrado: APPLY=1 lo crea)'); return 0; }

    await exec(ddl);
    const after = shapeVia(TARGET);
    const d2 = diff(after, prod);
    if (d2.length) { console.log(`  ✗ creada, pero NO quedó igual a producción:\n${d2.join('\n')}`); return 1; }
    console.log(`  ✔ ${TABLE} creada en ${TARGET}, igual a producción (${cols} columnas, ${idx} índices)`);
    return 0;
}

main().then(async c => { await close(); process.exit(c); }).catch(async e => { console.error(`  ✗ ${e.message}`); await close().catch(() => {}); process.exit(1); });
