// restore-check.ts — ¿la base de dev/QA sigue teniendo lo que nuestras tareas necesitan?
//
//   node dev/restore-check.ts                                   # corre los chequeos y dice qué falta
//   node dev/restore-check.ts --snapshot                        # además guarda la FOTO en .runs/
//   node dev/restore-check.ts --compare .runs/qa-restore-….json # compara la base contra una foto
//
// PARA QUÉ: la base de dev/QA es compartida y a veces se RESTAURA desde un respaldo. Lo que se escribió
// después del punto de restauración desaparece sin avisar: una migración aplicada por el workflow, una
// setting, un comercio montado a mano. Esto guarda ANTES una foto de lo que importa y DESPUÉS dice qué
// se perdió, fila por fila, en vez de descubrirlo en la mitad de una prueba.
//
// Los chequeos viven en `suites/qa-restore.json`, uno por pieza que una tarea necesita. Cada uno es una
// consulta y, opcionalmente:
//   · `key`           → columnas que identifican la fila; al comparar se listan las que FALTAN y las que cambiaron
//   · `expect`        → `minRows` y `equals` (valores de la primera fila) que tienen que cumplirse siempre
//   · `compareValues` → la primera fila tiene que ser IGUAL a la de la foto (conteos de configuración)
//   · `info`          → se muestra pero no cuenta como falla (describe el estado, no un requisito)
//   · `codes`         → archivo de códigos de preaprobado: cada uno tiene que seguir canjeable
//
// ⚠ SOLO LEE, y por el conector (`bin/pg sql`), que rechaza cualquier sentencia que no sea SELECT/WITH.
// ⚠ La tabla `settings` guarda credenciales: la foto guarda el MD5 del valor, nunca el valor. La única
//   excepción son las claves que se piden por nombre en su propio chequeo, que no son secretas.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HARNESS = resolve(HERE, '..');
const ROOT = resolve(HARNESS, '..');
const PG = join(ROOT, 'bin', 'pg');

const arg = (n: string, d = ''): string => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string): boolean => process.argv.includes(`--${n}`);

type Row = Record<string, unknown>;
interface Check {
    task: string;
    name: string;
    sql?: string;
    key?: string[];
    expect?: { minRows?: number; equals?: Row };
    compareValues?: boolean;
    info?: boolean;
    codes?: string;
}
interface Code { id: string; code: string; comercio: string; hash: string; lender_id: number; user_id: number; expired_at: string }
interface Result { task: string; name: string; rows: Row[]; problems: string[]; info?: boolean; brokenCodes?: string[] }

const suite = JSON.parse(readFileSync(resolve(HARNESS, arg('suite', 'suites/qa-restore.json')), 'utf8')) as { target: string; checks: Check[] };
const target = arg('target', suite.target);

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', B = '\x1b[1m', N = '\x1b[0m';

function sql(query: string): Row[] {
    const out = execFileSync(PG, ['sql', '--target', target, '--json', '--query', query], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return (JSON.parse(out) as { rows: Row[] | null }).rows ?? [];
}

// Los números vienen como número o como texto según la columna; se comparan como texto.
const same = (a: unknown, b: unknown): boolean => String(a) === String(b);
const keyOf = (r: Row, key: string[]): string => key.map((k) => String(r[k])).join('|');

function checkCodes(file: string): Result & { brokenCodes: string[] } {
    const path = resolve(ROOT, file);
    const res = { task: '', name: '', rows: [] as Row[], problems: [] as string[], brokenCodes: [] as string[] };
    if (!existsSync(path)) { res.problems.push(`no existe ${file}`); return res; }
    const codes = JSON.parse(readFileSync(path, 'utf8')) as Code[];
    const ids = [...new Set(codes.map((c) => Number(c.user_id)))];
    const hashes = [...new Set(codes.map((c) => c.hash))].map((h) => `'${h.replace(/[^0-9a-z]/gi, '')}'`);
    const users = new Set(sql(`SELECT id FROM users WHERE id IN (${ids.join(',')})`).map((r) => String(r.id)));
    const enabled = new Set(sql(
        `SELECT ab.hash, lab.lender_id FROM allied_branches ab JOIN lenders_by_allied_branches lab ON lab.allied_branch_id = ab.id
         WHERE lab.status = 1 AND ab.hash IN (${hashes.join(',')})`).map((r) => `${r.hash}|${r.lender_id}`));
    const byMerchant = new Map<string, { ok: number; noUser: number; noLender: number }>();
    for (const c of codes) {
        const m = byMerchant.get(c.comercio) ?? { ok: 0, noUser: 0, noLender: 0 };
        const hasUser = users.has(String(c.user_id));
        const hasLender = enabled.has(`${c.hash}|${c.lender_id}`);
        if (!hasUser) m.noUser++;
        if (!hasLender) m.noLender++;
        if (hasUser && hasLender) m.ok++; else res.brokenCodes.push(c.id);
        byMerchant.set(c.comercio, m);
    }
    res.rows = [...byMerchant].map(([comercio, m]) => ({ comercio, ...m }));
    if (res.brokenCodes.length) {
        res.problems.push(`${res.brokenCodes.length} de ${codes.length} códigos no se pueden canjear`
            + ` (sin usuario: ${codes.length - codes.filter((c) => users.has(String(c.user_id))).length}`
            + ` · sin la entidad activa en su sucursal: ${codes.filter((c) => !enabled.has(`${c.hash}|${c.lender_id}`)).length})`);
    }
    return res;
}

function run(c: Check): Result {
    if (c.codes) return { ...checkCodes(c.codes), task: c.task, name: c.name };
    const rows = sql(c.sql!);
    const problems: string[] = [];
    if (c.expect?.minRows !== undefined && rows.length < c.expect.minRows) problems.push(`${rows.length} fila(s), se esperaban ≥ ${c.expect.minRows}`);
    if (c.expect?.equals && rows[0]) {
        for (const [k, v] of Object.entries(c.expect.equals)) if (!same(rows[0][k], v)) problems.push(`${k} = ${rows[0][k]} (se esperaba ${v})`);
    } else if (c.expect?.equals && !rows[0]) problems.push('sin filas');
    return { task: c.task, name: c.name, rows, problems, info: c.info };
}

function compare(c: Check, now: Result, before: Result | undefined): string[] {
    if (!before) return ['no está en la foto'];
    const out: string[] = [];
    if (c.key) {
        const cur = new Map(now.rows.map((r) => [keyOf(r, c.key!), r]));
        const lost = before.rows.filter((r) => !cur.has(keyOf(r, c.key!)));
        const changed = before.rows.filter((r) => {
            const n = cur.get(keyOf(r, c.key!));
            return n && Object.keys(r).some((k) => !same(r[k], n[k]));
        });
        if (lost.length) out.push(`FALTAN ${lost.length}: ${lost.slice(0, 12).map((r) => Object.values(r).join(' · ')).join(' | ')}${lost.length > 12 ? ' …' : ''}`);
        if (changed.length) out.push(`CAMBIARON ${changed.length}: ${changed.slice(0, 8).map((r) => keyOf(r, c.key!) + (r.key ? ` (${r.key})` : '')).join(' | ')}`);
    }
    if (c.compareValues && before.rows[0]) {
        for (const [k, v] of Object.entries(before.rows[0])) if (!same(now.rows[0]?.[k], v)) out.push(`${k}: ${v} → ${now.rows[0]?.[k]}`);
    }
    if (c.codes) {
        const was = new Set(before.brokenCodes ?? []);
        const newly = (now.brokenCodes ?? []).filter((id) => !was.has(id));
        if (newly.length) out.push(`${newly.length} código(s) que antes servían ya no`);
    }
    return out;
}

const fmt = (rows: Row[]): string => rows.slice(0, 6).map((r) => Object.entries(r).map(([k, v]) => `${k}=${v}`).join(' ')).join(`\n        ${D}`);

const vsPath = arg('compare');
const before: Result[] | undefined = vsPath ? (JSON.parse(readFileSync(resolve(HARNESS, vsPath), 'utf8')) as { results: Result[] }).results : undefined;
console.log(`\n  ${B}LO QUE NUESTRAS TAREAS NECESITAN EN LA BASE${N} · target ${target}${vsPath ? ` · contra ${vsPath}` : ''}\n`);

const results: Result[] = [];
let failures = 0;
let task = '';
for (const c of suite.checks) {
    if (c.task !== task) { task = c.task; console.log(`  ${B}${task}${N}`); }
    let r: Result;
    try { r = run(c); } catch (e) { r = { task: c.task, name: c.name, rows: [], problems: [`la consulta falló: ${String((e as Error).message).split('\n')[0].slice(0, 160)}`] }; }
    results.push(r);
    const diff = before ? compare(c, r, before.find((b) => b.task === c.task && b.name === c.name)) : [];
    const bad = r.problems.length > 0 || diff.length > 0;
    if (bad && !c.info) failures++;
    const mark = !bad ? `${G}✓${N}` : c.info ? `${Y}·${N}` : `${R}✗${N}`;
    const detail = c.key && r.rows.length > 6 ? `${r.rows.length} filas` : fmt(r.rows);
    console.log(`    ${mark} ${c.name}${detail ? `\n        ${D}${detail}${N}` : ''}`);
    for (const p of [...r.problems, ...diff]) console.log(`        ${c.info ? Y : R}${p}${N}`);
}

if (flag('snapshot')) {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const out = join(HARNESS, '.runs', `qa-restore-${stamp}.json`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ target, takenAt: new Date().toISOString(), results }, null, 1));
    console.log(`\n  foto guardada: ${out.replace(HARNESS + '/', 'harness/')}`);
    console.log(`  después de restaurar: make harness-restauracion CONTRA=${out.replace(HARNESS + '/', '')}`);
}
console.log(failures ? `\n  ${R}${B}${failures} chequeo(s) no se cumplen${N}\n` : `\n  ${G}${B}todo lo que las tareas necesitan está${N}\n`);
process.exit(failures ? 1 : 0);
