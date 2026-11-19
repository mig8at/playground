// Corridas con nombre (`runs.json`) en un celular de 420×900, despacio, con su video en .mp4 para compartir.
//
//   make harness-run                          la lista de corridas
//   make harness-run RUN=finandina            la corre sin ventana: sólo deja el video
//   make harness-run RUN=finandina,pullman    las dos a la vez, un video cada una
//   make harness-run RUN=finandina HEADED=1 SLOW=1200 VIDEO=0
//
// Es el caminador con el motor de navegador (`dev/walk-wizard.ts --engine browser`), sobre el Chromium propio del
// harness: el de Jarvis maneja el Chrome de la persona, y Playwright no graba un contexto que no creó. Cada video queda
// en `.runs/videos/<fecha>/<corrida>.mp4` (fuera de git) y la ruta sale al final.
// VARIAS A LA VEZ: las que comparten ambiente y perillas van en UN proceso con sus casos en paralelo (`--parallel`):
// dos procesos contra qa se pisarían la lista de teléfonos del bypass de OTP, que cada uno escribe al arrancar. Las
// que no, en procesos separados al mismo tiempo; su salida sale con el nombre de la corrida adelante.
// ⚠ ESCRIBE en el ambiente de cada corrida, como el caminador: una solicitud nueva por corrida.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

interface Run {
    description: string; target: string; cases: string; flow?: string; amount?: number;
    lambda?: boolean; close?: boolean; manual?: boolean; measured?: string;
}
const { runs } = JSON.parse(fs.readFileSync(path.join(ROOT, 'runs.json'), 'utf8')) as { runs: Record<string, Run> };

const names = (process.argv[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (names.length === 0) {
    console.log('\n  CORRIDAS · make harness-run RUN=<nombre>[,<otra>…] [SLOW=600] [HEADED=1] [VIDEO=0] [BLOCK=<tarea>]\n');
    for (const [k, r] of Object.entries(runs)) console.log(`  ${k.padEnd(12)} ${r.target.padEnd(6)} ${r.description}${r.measured ? `\n  ${''.padEnd(19)}cerró: ${r.measured}` : ''}`);
    console.log('');
    process.exit(0);
}
const unknown = names.filter((n) => !runs[n]);
if (unknown.length) {
    console.error(`  ✗ no hay corrida «${unknown.join('», «')}» (hay: ${Object.keys(runs).join(', ')})`);
    process.exit(2);
}

const on = (v: string | undefined, def: boolean) => (v === undefined || v === '' ? def : v !== '0');
const video = on(process.env.VIDEO, true);
const headed = on(process.env.HEADED, false);
const slow = process.env.SLOW === undefined || process.env.SLOW === '' ? '600' : process.env.SLOW;
const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
const videoRoot = path.join(ROOT, '.runs', 'videos', stamp);

// Las que comparten ambiente y perillas, juntas: un proceso, sus casos en paralelo.
const knobs = (r: Run) => JSON.stringify([r.target, r.flow ?? 'self-service', r.amount ?? null, !!r.lambda, !!r.close, !!r.manual]);
const groups = new Map<string, string[]>();
for (const n of names) groups.set(knobs(runs[n]), [...(groups.get(knobs(runs[n])) ?? []), n]);

console.log(`\n  ▶ ${names.join(' + ')} · ${headed ? 'con ventana' : 'sin ventana'} · ${slow} ms por acción${video ? ` · videos en ${path.relative(ROOT, videoRoot)}/` : ''}`);
for (const n of names) console.log(`    ${n.padEnd(12)} ${runs[n].target.padEnd(6)} ${runs[n].description}`);
console.log('');

function runGroup(group: string[]): Promise<{ group: string[]; status: number; videos: string[] }> {
    const first = runs[group[0]];
    const label = group.join('+');
    const dir = path.join(videoRoot, label);
    const args = ['dev/walk-wizard.ts', '--engine', 'browser', '--cases', group.map((n) => runs[n].cases).join(';'), '--flow', first.flow ?? 'self-service'];
    if (group.length > 1) args.push('--parallel');
    if (first.amount) args.push('--amount', String(first.amount));
    if (first.lambda) args.push('--lambda');
    if (first.close) args.push('--close');
    if (first.manual) args.push('--manual');
    if (headed) args.push('--headed');
    if (video) fs.mkdirSync(dir, { recursive: true });
    const child = spawn('node', args, {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, E2E_TARGET: first.target, HARNESS_SLOW: slow, ...(video ? { HARNESS_VIDEO: dir } : {}) },
    });
    // Con una sola, la salida tal cual; con varias, cada línea con su corrida adelante para que no se mezclen.
    const prefix = groups.size > 1 ? `[${label}] ` : '';
    for (const s of [child.stdout, child.stderr]) {
        let rest = '';
        s.on('data', (d: Buffer) => {
            const lines = (rest + d.toString()).split('\n');
            rest = lines.pop() ?? '';
            for (const l of lines) process.stdout.write(`${prefix}${l}\n`);
        });
        s.on('end', () => { if (rest) process.stdout.write(`${prefix}${rest}\n`); });
    }
    return new Promise((resolve) => child.on('close', (code) => {
        let videos: string[] = [];
        if (video) {
            // Playwright los nombra por la página, no por el caso: en un grupo no se sabe cuál es cuál, así que van
            // numerados en el orden en que se cerraron (y el nombre del grupo dice qué corridas hay adentro).
            const files = fs.readdirSync(dir).filter((f) => /\.(mp4|webm)$/.test(f))
                .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => a.t - b.t);
            videos = files.map(({ f }, i) => {
                const to = path.join(videoRoot, `${files.length > 1 ? `${label}-${i + 1}` : label}-${stamp}${path.extname(f)}`);
                fs.renameSync(path.join(dir, f), to);
                return to;
            });
            fs.rmSync(dir, { recursive: true, force: true });
        }
        resolve({ group, status: code ?? 1, videos });
    }));
}

const results = await Promise.all([...groups.values()].map(runGroup));
console.log('');
for (const r of results) {
    console.log(`  ${r.status === 0 ? '✓' : '✗'} ${r.group.join(' + ')} · ${r.status === 0 ? 'cerró' : `salió ${r.status}`}`);
    for (const v of r.videos) console.log(`    🎬 ${v}`);
}
if (video && fs.existsSync(videoRoot) && fs.readdirSync(videoRoot).length === 0) fs.rmSync(videoRoot, { recursive: true, force: true });
console.log('');
process.exit(results.some((r) => r.status !== 0) ? 1 : 0);
