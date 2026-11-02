// regression.ts — corre TODAS las suites del runner de casos y dice qué cambió desde la última corrida.
//
//   make harness-regression TARGET=local [RESET=1] [ONLY=cupo] [JSON=1]
//
// POR QUÉ EXISTE. La certeza de que un cambio no rompió otro flujo salía de lanzar las suites a mano desde la
// consola. Esto las corre todas, en serie (comparten la base local: el cupo, los teléfonos de bypass), y
// compara cada una con la corrida anterior guardada en `.runs/regression-last.json`: «antes 4/4, ahora la
// cascada falla» es lo que importa, no un verde suelto. Antes corre `harness-doctor`: si algo del ambiente
// frena, no corre nada, porque el resultado mentiría.
//
// RESET=1 reinicia antes el cupo de los perfiles en la base local (`dev/quota-reset.ts --apply`): las suites
// que cierran lo van agotando y la siguiente corrida saldría `profile_quota_exhausted` por la base.
//
// Salida: 0 todas en pie · 1 alguna falla · 2 el ambiente frena o no es local.
export {};
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const HARNESS = resolve(import.meta.dirname, '..');
const LAST = resolve(HARNESS, '.runs/regression-last.json');
const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const say = (...a: unknown[]) => (JSON_OUT ? console.error : console.log)(...a);
const node = (script: string, extra: string[]) =>
    spawnSync('node', [script, ...extra], { cwd: HARNESS, env: process.env, encoding: 'utf8', maxBuffer: 64 << 20 });
const lastJson = (out: string) => { try { return JSON.parse(out.trim().split('\n').pop() || 'null'); } catch { return null; } };

if ((process.env.E2E_TARGET || '') !== 'local') {
    say('  ✗ la regresión corre contra local: make harness-regression TARGET=local');
    process.exit(2);
}

// 1 · El ambiente. Si algo frena, cualquier resultado sería del ambiente y no del código.
const doctor = lastJson(node('dev/doctor.ts', ['--json']).stdout ?? '');
if (!doctor?.ok) {
    say('  ✗ el ambiente FRENA (make harness-doctor TARGET=local):');
    for (const c of doctor?.checks ?? []) if (!c.ok && c.frena) say(`      · ${c.id}: ${c.detalle}${c.arreglo ? `  → ${c.arreglo}` : ''}`);
    if (JSON_OUT) process.stdout.write(JSON.stringify({ formato: 'harness.regression/v1', ok: false, sinVeredicto: true, doctor }) + '\n');
    process.exit(2);
}
const notOnMain = (doctor.checks ?? []).filter((c: any) => c.id.startsWith('rama:') && !c.ok).map((c: any) => `${c.id.slice(5)}: ${c.detalle}`);
if (notOnMain.length) say(`  ⚠ no es main lo que se mide — ${notOnMain.join(' · ')}`);
if (args.includes('--reset')) say(`  ${node('dev/quota-reset.ts', ['--apply']).stdout.trim().split('\n').pop()}`);

// 2 · Las suites del runner de casos: las que tienen `casos` y no son de otro runner (ecommerce las corre
// `dev/ecommerce.ts`, con su propia forma).
const suites = readdirSync(resolve(HARNESS, 'suites')).filter((f) => f.endsWith('.json')).sort()
    .filter((f) => !f.startsWith('ecommerce'))
    .filter((f) => { try { return Array.isArray(JSON.parse(readFileSync(resolve(HARNESS, 'suites', f), 'utf8')).casos); } catch { return false; } })
    .filter((f) => !only || f.includes(only));

const previous: Record<string, { ok: boolean; casos: number; desvios: string[]; cuando: string }> =
    existsSync(LAST) ? (JSON.parse(readFileSync(LAST, 'utf8')).suites ?? {}) : {};
const now: typeof previous = {};
const started = new Date().toISOString();
say(`\n  REGRESIÓN · ${suites.length} suite(s) contra local\n`);
for (const f of suites) {
    process.stderr.write(`  ▸ ${f} …`);
    const t0 = Date.now();
    const report = lastJson(node('dev/case.ts', ['--suite', `suites/${f}`, '--json']).stdout ?? '');
    const ok = !!report?.ok;
    now[f] = { ok, casos: report?.casos?.length ?? 0, cuando: started,
               desvios: report ? (report.sinVeredicto ? [report.detalle] : report.desvios ?? []) : ['sin informe JSON'] };
    process.stderr.write(` ${ok ? '✓' : '✗'} ${Math.round((Date.now() - t0) / 1000)}s\n`);
}

// 3 · Qué cambió. Lo nuevo y lo que se rompió van primero: es lo que hay que mirar.
const lines: string[] = [];
for (const f of suites) {
    const n = now[f], p = previous[f];
    const tag = !p ? 'NUEVA' : p.ok && !n.ok ? 'SE ROMPIÓ' : !p.ok && n.ok ? 'SE ARREGLÓ' : n.ok ? 'igual' : 'sigue rota';
    lines.push(`  ${n.ok ? '✓' : '✗'} ${f.padEnd(34)} ${String(n.casos).padStart(2)} caso(s) · ${tag}`);
    if (!n.ok) for (const d of n.desvios.slice(0, 4)) lines.push(`      · ${d}`);
}
say('\n  QUÉ CAMBIÓ DESDE LA CORRIDA ANTERIOR' + (Object.keys(previous).length ? '' : ' (no había una: ésta es la base)') + '\n');
for (const l of lines) say(l);
const broken = suites.filter((f) => !now[f].ok);
say(`\n  ${suites.length - broken.length}/${suites.length} suites en pie`
    + (suites.filter((f) => previous[f]?.ok && !now[f].ok).length ? ` · ${suites.filter((f) => previous[f]?.ok && !now[f].ok).length} SE ROMPIERON` : '') + '\n');

// Se guarda la corrida entera (sin ONLY), para que la próxima compare contra algo completo.
if (!only) {
    mkdirSync(resolve(HARNESS, '.runs'), { recursive: true });
    writeFileSync(LAST, JSON.stringify({ cuando: started, ramas: notOnMain, suites: now }, null, 2));
}
if (JSON_OUT) process.stdout.write(JSON.stringify({ formato: 'harness.regression/v1', ok: broken.length === 0, ramas: notOnMain,
    suites: suites.map((f) => ({ suite: f, ...now[f], antes: previous[f]?.ok ?? null })) }) + '\n');
process.exit(broken.length ? 1 : 0);
