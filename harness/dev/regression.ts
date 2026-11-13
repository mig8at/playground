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
// SALTEADAS. Una suite que declara `"ambientes"` sin `local` (p. ej. `credifamilia-materiales-qa.json`) no se
// corre: se cuenta como «salteada (vale en …)», no como rojo. Lo mismo una que no es de este runner (las de
// `dev/ecommerce.ts`, o una sin `casos`): antes se apartaban por prefijo de nombre. La decisión es
// `pkg/suite-scope.ts`, la misma que usa `case.ts`.
//
// Salida: 0 todas en pie · 1 alguna falla · 2 el ambiente frena o no es local.
export {};
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { suiteScope } from '../pkg/suite-scope.ts';

const HARNESS = resolve(import.meta.dirname, '..');
const LAST = resolve(HARNESS, '.runs/regression-last.json');
const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const say = (...a: unknown[]) => (JSON_OUT ? console.error : console.log)(...a);
// `live`: el stderr del hijo pasa directo a la terminal. Con `--json` el runner de casos escribe su texto en stderr y
// deja en stdout sólo el informe, así que se ve cada caso mientras corre (antes una suite de minutos era un renglón
// quieto hasta el final) y lo que se parsea sigue siendo el stdout capturado. Las suites siguen EN SERIE.
const node = (script: string, extra: string[], live = false) =>
    spawnSync('node', [script, ...extra], { cwd: HARNESS, env: process.env, encoding: 'utf8', maxBuffer: 64 << 20,
        stdio: live ? ['ignore', 'pipe', 'inherit'] : 'pipe' });
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

// 2 · Las suites del runner de casos que valen en este target. Las demás se saltean con su motivo. Un JSON
// que no parsea o un `ambientes` mal escrito NO se saltea: va a correr y `case.ts` lo da en rojo.
const skipped: Array<{ suite: string; motivo: string }> = [];
const suites = readdirSync(resolve(HARNESS, 'suites')).filter((f) => f.endsWith('.json')).sort()
    .filter((f) => !only || f.includes(only))
    .filter((f) => {
        let json: unknown;
        try { json = JSON.parse(readFileSync(resolve(HARNESS, 'suites', f), 'utf8')); } catch { return true; }
        let scope;
        try { scope = suiteScope(json, process.env.E2E_TARGET || ''); } catch { return true; }
        if (scope.kind === 'run') return true;
        skipped.push({ suite: f, motivo: scope.kind === 'not-for-target' ? `salteada (vale en ${scope.targets.join(', ')})` : `salteada (${scope.reason})` });
        return false;
    });

const previous: Record<string, { ok: boolean; casos: number; desvios: string[]; cuando: string }> =
    existsSync(LAST) ? (JSON.parse(readFileSync(LAST, 'utf8')).suites ?? {}) : {};
const now: typeof previous = {};
const started = new Date().toISOString();
say(`\n  REGRESIÓN · ${suites.length} suite(s) contra local${skipped.length ? ` · ${skipped.length} salteada(s)` : ''}\n`);
for (const f of suites) {
    process.stderr.write(`  ▸ ${f} …\n`);
    const t0 = Date.now();
    const run = node('dev/case.ts', ['--suite', `suites/${f}`, '--json'], true);
    const report = lastJson(run.stdout ?? '');
    const ok = !!report?.ok;
    // Sin informe no hay desvíos que mostrar: va la cola de lo que el hijo dejó en stdout y cómo salió. Su stderr ya
    // pasó por la terminal. Sin esto «sin informe JSON» no decía si fue un crash, un timeout o una salida a medias.
    if (!report) {
        const tail = (run.stdout ?? '').trimEnd().split('\n').slice(-15).map((l) => l.slice(0, 300)).join('\n');
        const how = run.error ? `no arrancó: ${run.error.message}` : run.signal ? `lo cortó ${run.signal}` : `salió con código ${run.status}`;
        process.stderr.write(`    ✗ ${f} no dejó informe JSON (${how})${tail ? `. Lo último que escribió en stdout:\n${tail.replace(/^/gm, '      │ ')}` : ', y no escribió nada en stdout'}\n`);
    }
    now[f] = { ok, casos: report?.casos?.length ?? 0, cuando: started,
               desvios: report ? (report.sinVeredicto ? [report.detalle] : report.desvios ?? []) : ['sin informe JSON'] };
    process.stderr.write(`  ${ok ? '✓' : '✗'} ${f} · ${Math.round((Date.now() - t0) / 1000)}s\n`);
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
for (const s of skipped) say(`  ⤼ ${s.suite.padEnd(34)} ${s.motivo}`);
const broken = suites.filter((f) => !now[f].ok);
say(`\n  ${suites.length - broken.length}/${suites.length} suites en pie`
    + (skipped.length ? ` · ${skipped.length} salteada(s)` : '')
    + (suites.filter((f) => previous[f]?.ok && !now[f].ok).length ? ` · ${suites.filter((f) => previous[f]?.ok && !now[f].ok).length} SE ROMPIERON` : '') + '\n');

// Se guarda la corrida entera (sin ONLY), para que la próxima compare contra algo completo.
if (!only) {
    mkdirSync(resolve(HARNESS, '.runs'), { recursive: true });
    writeFileSync(LAST, JSON.stringify({ cuando: started, ramas: notOnMain, suites: now }, null, 2));
}
if (JSON_OUT) process.stdout.write(JSON.stringify({ formato: 'harness.regression/v1', ok: broken.length === 0, ramas: notOnMain,
    suites: suites.map((f) => ({ suite: f, ...now[f], antes: previous[f]?.ok ?? null })), salteadas: skipped }) + '\n');
process.exit(broken.length ? 1 : 0);
