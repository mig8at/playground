// doctor.ts — ¿el ambiente LOCAL está listo para que una corrida diga la verdad?
//
//   make harness-doctor TARGET=local [JSON=1]
//
// POR QUÉ EXISTE. El 2026-11-02, en una sola tarde, cinco cosas del ambiente hicieron que una corrida fallara o
// dijera algo que no era del caso, y cada una se descubrió DESPUÉS de correr: mocks caídos (tres veces), el
// backend local en otra rama que main, migraciones pendientes, un módulo nuevo sin autoload, y el cupo de los
// perfiles agotado por las propias corridas. Esto las mira todas antes, en sólo lectura, y con cada problema
// dice el comando que lo arregla. No arregla nada solo.
//
// Salida: 0 si no hay nada que frene · 1 si algo frena (la corrida mentiría o no correría) · 2 si no es local.
// Con JSON=1, el texto va a stderr y stdout lleva un objeto `harness.doctor/v1`.
export {};
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const JSON_OUT = process.argv.includes('--json');
const say = (...a: unknown[]) => (JSON_OUT ? console.error : console.log)(...a);

const { TARGET, query, close } = await import('../pkg/db.ts');
const { MOCKS } = await import('../pkg/mock-registry.ts');

if (TARGET !== 'local') {
    say(`  ✗ harness-doctor mira el ambiente local; el target es ${TARGET}. Para un remoto: make harness-env-drift TARGET=${TARGET}`);
    process.exit(2);
}

type Check = { id: string; ok: boolean; frena: boolean; detalle: string; arreglo?: string };
const checks: Check[] = [];
const add = (c: Check) => checks.push(c);

const PLAYGROUND = resolve(import.meta.dirname, '../..');
const repos = JSON.parse(readFileSync(resolve(PLAYGROUND, 'tools/repos.json'), 'utf8'));
const repoPath = (alias: string) => String(repos.indexed?.[alias] ?? repos.citable_only?.[alias] ?? '').replace(/^~\//, homedir() + '/');
const git = (dir: string, ...args: string[]) => {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 15_000 });
    return r.status === 0 ? r.stdout.trim() : null;
};

// 1 · LAS RAMAS. Una corrida contra una rama que no es main prueba la rama, no lo vigente.
for (const alias of ['legacy-backend', 'frontend-monorepo']) {
    const dir = repoPath(alias);
    const head = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
    if (head === null) { add({ id: `rama:${alias}`, ok: false, frena: false, detalle: `no pude leer el clon (${dir})` }); continue; }
    const counts = git(dir, 'rev-list', '--left-right', '--count', 'HEAD...origin/main');
    const [ahead, behind] = (counts ?? '? ?').split(/\s+/);
    const dirty = (git(dir, 'status', '--porcelain') ?? '').split('\n').filter(Boolean).length;
    const onMain = ahead === '0' && behind === '0';
    add({
        id: `rama:${alias}`, ok: onMain, frena: false,
        detalle: `${head === 'HEAD' ? 'desacoplado' : head} · ${ahead} commit(s) propios, ${behind} detrás de origin/main`
            + (dirty ? ` · ${dirty} archivo(s) sin commitear` : ''),
        arreglo: onMain ? undefined : `lo que se mida es esa rama, no main. Para medir main: git -C ${dir} fetch && git -C ${dir} checkout --detach origin/main`
            + (alias === 'legacy-backend' ? ' (y después el autoload y las migraciones de abajo)' : ''),
    });
}

// 2 · EL BACKEND. No por su raíz, que da 404 aunque esté bien: por una ruta que siempre contesta JSON.
const api = process.env.E2E_API_BASE_URL?.replace(/\/api\/?$/, '') || 'http://localhost';
const ping = await fetch(`${api}/api/loans/lender/available-quota`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: '{}', signal: AbortSignal.timeout(10_000),
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })).catch((e) => ({ status: 0, json: null, err: String(e) }));
const backendUp = ping.status > 0 && ping.json !== null;
add({ id: 'backend', ok: backendUp, frena: !backendUp,
      detalle: backendUp ? `contesta JSON en ${api} (HTTP ${ping.status} a un pedido vacío, que es lo esperado)` : `no contesta JSON en ${api}`,
      arreglo: backendUp ? undefined : 'levantar el backend local (sail up) — skill harness-local' });

// 3 · ARTISAN Y MIGRACIONES. Un módulo nuevo sin autoload rompe artisan; una migración pendiente deja la base
// con otra forma que el código (una columna que falta da un 500 lejos de su causa).
const container = process.env.HARNESS_BACKEND_CONTAINER || 'legacy-backend-laravel.test-1';
const status = spawnSync('docker', ['exec', container, 'php', 'artisan', 'migrate:status'], { encoding: 'utf8', timeout: 120_000 });
const out = `${status.stdout ?? ''}${status.stderr ?? ''}`;
if (status.status !== 0 && /not found|Class "/.test(out)) {
    add({ id: 'artisan', ok: false, frena: true, detalle: `artisan no arranca: ${(out.match(/Class "[^"]+" not found/) ?? ['error al cargar'])[0]}`,
          arreglo: `docker exec ${container} composer dump-autoload` });
} else if (status.status !== 0) {
    add({ id: 'artisan', ok: false, frena: false, detalle: `no pude correr migrate:status en ${container}`,
          arreglo: 'revisar que el contenedor del backend esté arriba (docker ps)' });
} else {
    const pending = out.split('\n').filter((l) => /Pending/.test(l)).map((l) => l.trim().split(/\s+/)[0]);
    // Las de VISTAS de reportes no cambian ninguna tabla que lea un flujo, y la del 2026-10-22 falla a propósito
    // contra el volcado local (busca un texto exacto en una vista creada a mano en prod): avisan, no frenan.
    const tables = pending.filter((m) => !/view/i.test(m));
    add({ id: 'migraciones', ok: pending.length === 0, frena: tables.length > 0,
          detalle: pending.length ? `${pending.length} pendiente(s): ${pending.join(', ')}` : 'ninguna pendiente',
          arreglo: pending.length ? `docker exec ${container} php artisan migrate --path=database/migrations/<archivo>.php (de a una; NUNCA migrate:fresh)` : undefined });
}

// 4 · LOS MOCKS. Frenan los que exige el prevuelo de la consola (`dev/case.ts`): centrales y entidades. El resto
// es del wizard en el navegador o de un producto puntual (medido el 2026-11-02: con payvalida, forms y
// financial-health caídos, las suites por consola pasan), así que avisa con a quién le hace falta.
const BLOCKING = new Set(['bureaus', 'lenders']);
for (const m of MOCKS) {
    const up = await fetch(`http://127.0.0.1:${m.port}/`, { signal: AbortSignal.timeout(3_000) }).then(() => true).catch(() => false);
    if (up) continue;
    add({ id: `mock:${m.id}`, ok: false, frena: BLOCKING.has(m.id),
          detalle: `${m.label} (:${m.port}) caído · lo necesita: ${m.needs}`, arreglo: `harness/bin/mock-${m.id} start` });
}
if (!checks.some((c) => c.id.startsWith('mock:'))) add({ id: 'mocks', ok: true, frena: false, detalle: `los ${MOCKS.length} mocks contestan` });

// 5 · LOS PERFILES AGOTADOS. Las corridas que cierran suman al cupo del mes y en local nadie lo reinicia.
const exhausted = await query<{ lender: string; perfil: string; usado: number; tope: number }>(
    `SELECT l.name AS lender, c.name AS perfil, c.already_used_loan AS usado, COALESCE(c.period_loan_limit, c.loan_limit) AS tope
       FROM lender_users_categories c JOIN lenders l ON l.id = c.lender_id AND l.response_type IN (2, 3)
      WHERE COALESCE(c.period_loan_limit, c.loan_limit) > 0 AND c.already_used_loan >= COALESCE(c.period_loan_limit, c.loan_limit)
      ORDER BY l.name, c.name`).catch((e) => { add({ id: 'base', ok: false, frena: true, detalle: `la base local no contesta: ${e}` }); return null; });
if (exhausted) {
    add({ id: 'cupo', ok: exhausted.length === 0, frena: false,
          detalle: exhausted.length ? `${exhausted.length} perfil(es) CreditopX agotados (su cupo dará profile_quota_exhausted): `
              + exhausted.slice(0, 5).map((r) => `${r.lender} · ${r.perfil}`).join(', ') + (exhausted.length > 5 ? '…' : '')
              : 'ningún perfil agotado',
          arreglo: exhausted.length ? 'make harness-quota-reset TARGET=local APPLY=1' : undefined });
}
await close().catch(() => {});

const blocking = checks.filter((c) => !c.ok && c.frena);
say('\n  HARNESS DOCTOR · local\n');
for (const c of checks) {
    say(`  ${c.ok ? '✓' : c.frena ? '✗' : '⚠'} ${c.id.padEnd(28)} ${c.detalle}`);
    if (!c.ok && c.arreglo) say(`      → ${c.arreglo}`);
}
say(`\n  ${blocking.length ? `${blocking.length} cosa(s) FRENAN: una corrida ahora no correría o mentiría` : 'nada frena'}`
    + ` · ${checks.filter((c) => !c.ok && !c.frena).length} aviso(s)\n`);
if (JSON_OUT) process.stdout.write(JSON.stringify({ formato: 'harness.doctor/v1', target: TARGET, ok: blocking.length === 0, checks }) + '\n');
process.exit(blocking.length ? 1 : 0);
