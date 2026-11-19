// Una corrida con nombre (`runs.json`) en una ventana de celular, despacio, y con su video en .mp4 para compartir.
//
//   make harness-run                       la lista de corridas
//   make harness-run RUN=finandina         la corre: ventana de celular, 600 ms por acción, video
//   make harness-run RUN=finandina SLOW=0 HEADED=0 VIDEO=0
//
// Es el caminador con el motor de navegador (`dev/walk-wizard.ts --engine browser`), sobre el Chromium propio del
// harness: el de Jarvis maneja el Chrome de la persona, y Playwright no graba un contexto que no creó. El video queda
// en `.runs/videos/<corrida>-<fecha>/` (fuera de git) y la ruta sale al final.
// ⚠ ESCRIBE en el ambiente de la corrida, como el caminador: una solicitud nueva por vez.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

interface Run {
    description: string; target: string; cases: string; flow?: string; amount?: number;
    lambda?: boolean; close?: boolean; manual?: boolean; measured?: string;
}
const { runs } = JSON.parse(fs.readFileSync(path.join(ROOT, 'runs.json'), 'utf8')) as { runs: Record<string, Run> };

const name = process.argv[2];
if (!name) {
    console.log('\n  CORRIDAS · make harness-run RUN=<nombre> [SLOW=600] [HEADED=1] [VIDEO=1] [BLOCK=<tarea>]\n');
    for (const [k, r] of Object.entries(runs)) console.log(`  ${k.padEnd(12)} ${r.target.padEnd(6)} ${r.description}${r.measured ? `\n  ${''.padEnd(19)}cerró: ${r.measured}` : ''}`);
    console.log('');
    process.exit(0);
}
const run = runs[name];
if (!run) {
    console.error(`  ✗ no hay una corrida «${name}» (hay: ${Object.keys(runs).join(', ')})`);
    process.exit(2);
}

const on = (v: string | undefined, def: boolean) => (v === undefined || v === '' ? def : v !== '0');
const video = on(process.env.VIDEO, true);
const headed = on(process.env.HEADED, true);
const slow = process.env.SLOW === undefined || process.env.SLOW === '' ? '600' : process.env.SLOW;
const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
const videoDir = path.join(ROOT, '.runs', 'videos', `${name}-${stamp}`);

const args = ['dev/walk-wizard.ts', '--engine', 'browser', '--cases', run.cases, '--flow', run.flow ?? 'self-service'];
if (run.amount) args.push('--amount', String(run.amount));
if (run.lambda) args.push('--lambda');
if (run.close) args.push('--close');
if (run.manual) args.push('--manual');
if (headed) args.push('--headed');

console.log(`\n  ▶ ${name} · ${run.description}\n    ${run.target} · ${headed ? 'ventana de celular' : 'sin ventana'} · ${slow} ms por acción${video ? ` · video en ${path.relative(ROOT, videoDir)}/` : ''}\n`);
if (video) fs.mkdirSync(videoDir, { recursive: true });
const r = spawnSync('node', args, {
    cwd: ROOT, stdio: 'inherit',
    env: { ...process.env, E2E_TARGET: run.target, HARNESS_SLOW: slow, ...(video ? { HARNESS_VIDEO: videoDir } : {}) },
});
if (video) {
    const files = fs.readdirSync(videoDir).filter((f) => /\.(mp4|webm)$/.test(f));
    if (files.length === 0) fs.rmSync(videoDir, { recursive: true, force: true });
    else {
        // Con un nombre que se entiende al compartirlo: la corrida y la fecha, no el id de Playwright.
        const named = files.map((f, i) => {
            const to = path.join(videoDir, `${name}-${stamp}${files.length > 1 ? `-${i + 1}` : ''}${path.extname(f)}`);
            fs.renameSync(path.join(videoDir, f), to);
            return to;
        });
        console.log(`\n  🎬 ${named.join('\n  🎬 ')}\n`);
    }
}
process.exit(r.status ?? 1);
