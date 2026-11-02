// knowledge-suites.ts — corre las suites que respaldan reglas de knowledge/ y dice cuál sigue en pie.
//
//   make harness-knowledge TARGET=local [TOPIC=lender-profile-rules] [LIST=1]
//
// POR QUÉ EXISTE. Un tema de knowledge/ está verificado LEYENDO main; `make knowledge-check` avisa cuando sus
// fuentes cambian, pero no dice si la regla sigue siendo cierta. Las reglas que tienen suite la citan en su
// prosa (`SUITE=harness/suites/<x>.json`): éste es el comando que las corre todas y contesta, por tema, si la
// regla sigue en pie CORRIENDO. Con LIST=1 no corre nada: dice qué temas tienen suite y cuáles sólo están leídos.
export {};
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const HARNESS = resolve(import.meta.dirname, '..');
const KNOWLEDGE = resolve(HARNESS, '../knowledge');
const args = process.argv.slice(2);
const onlyTopic = args.includes('--topic') ? args[args.indexOf('--topic') + 1] : null;
const listOnly = args.includes('--list');

// suite → temas que la citan, leído de la prosa: la cita es el contrato, no una lista aparte.
const bySuite = new Map<string, Set<string>>();
const withoutSuite: string[] = [];
for (const topic of readdirSync(KNOWLEDGE, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const rules = resolve(KNOWLEDGE, topic, 'rules.md');
    if (!existsSync(rules)) continue;
    const found = [...readFileSync(rules, 'utf8').matchAll(/SUITE=harness\/(suites\/[a-z0-9-]+\.json)/g)].map((m) => m[1]);
    if (!found.length) { withoutSuite.push(topic); continue; }
    for (const s of found) (bySuite.get(s) ?? bySuite.set(s, new Set()).get(s)!).add(topic);
}

const suites = [...bySuite.entries()].filter(([, topics]) => !onlyTopic || topics.has(onlyTopic));
console.log(`\n  KNOWLEDGE · ${bySuite.size} suite(s) citadas por ${new Set([...bySuite.values()].flatMap((t) => [...t])).size} tema(s)`
    + ` · ${withoutSuite.length} tema(s) sólo leídos en el código\n`);

if (listOnly) {
    for (const [s, topics] of suites) console.log(`  ${s}  ←  ${[...topics].join(', ')}`);
    console.log(`\n  sin suite: ${withoutSuite.join(', ')}\n`);
    process.exit(0);
}
if (!process.env.E2E_TARGET) {
    console.error('  ✗ falta el ambiente: make harness-knowledge TARGET=local');
    process.exit(2);
}

const results: Array<{ suite: string; topics: string[]; code: number; line: string }> = [];
for (const [suite, topics] of suites) {
    if (!existsSync(resolve(HARNESS, suite))) {
        results.push({ suite, topics: [...topics], code: 2, line: 'la suite citada no existe' });
        continue;
    }
    process.stdout.write(`  ▸ ${suite} …`);
    const run = spawnSync('node', ['dev/case.ts', '--suite', suite], { cwd: HARNESS, env: process.env, encoding: 'utf8' });
    const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const ok = out.match(/✓ (\d+) casos cumplieron lo que declaran/);
    const bad = out.match(/NO CUMPLIERON[^\n]*\n\n((?:\s+· [^\n]+\n?)+)/);
    const line = ok ? `${ok[1]} casos cumplen`
        : bad ? bad[1].trim().split('\n').map((l) => l.trim()).join(' | ')
        : (out.match(/PREVUELO[\s\S]*?· ([^\n]+)/)?.[1] ?? `salió ${run.status} sin veredicto legible`);
    results.push({ suite, topics: [...topics], code: run.status ?? 2, line });
    process.stdout.write(` ${run.status === 0 ? '✓' : '✗'}\n`);
}

console.log('\n  QUÉ REGLA SIGUE EN PIE\n');
for (const r of results) {
    console.log(`  ${r.code === 0 ? '✓' : '✗'} ${r.topics.join(', ')}  ·  ${r.suite}`);
    console.log(`      ${r.line}`);
}
const failed = results.filter((r) => r.code !== 0);
console.log(`\n  ${results.length - failed.length}/${results.length} suites en pie contra ${process.env.E2E_TARGET}\n`);
process.exit(failed.length ? 1 : 0);
