// Corridas con nombre (`runs.json`) en un celular de 420×900, despacio, con su video en .mp4 para compartir.
//
//   make harness-run                          la lista de corridas
//   make harness-run RUN=finandina            la corre sin ventana: sólo deja el video
//   make harness-run RUN=finandina,pullman    las dos a la vez, un video cada una
//   make harness-run RUN=finandina TARGET=local   en otro de sus ambientes (sin TARGET, el primero de `targets`)
//   make harness-run RUN=finandina HEADED=1 SLOW=1200 VIDEO=0
//
// El catálogo y qué es una corrida válida: `pkg/runs.ts` (el mismo que la vista «Corridas» del panel).
//
// Es el caminador con el motor de navegador (`dev/walk-wizard.ts --engine browser`), sobre el Chromium propio del
// harness: el de Jarvis maneja el Chrome de la persona, y Playwright no graba un contexto que no creó. Cada video queda
// en `.runs/videos/<fecha>/<corrida>.mp4` (fuera de git), la ruta sale al final y la grabación se anota en
// `.runs/recordings.json`, que el panel lista en «Grabaciones» (`pkg/recordings.ts`).
// VARIAS A LA VEZ: las que comparten ambiente y perillas van en UN proceso con sus casos en paralelo (`--parallel`):
// dos procesos contra qa se pisarían la lista de teléfonos del bypass de OTP, que cada uno escribe al arrancar. Las
// que no, en procesos separados al mismo tiempo; su salida sale con el nombre de la corrida adelante.
// ⚠ ESCRIBE en el ambiente de cada corrida, como el caminador: una solicitud nueva por corrida.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addRecordings, type Recording } from '../pkg/recordings.ts';
import { readRuns, runCase, CHANNELS, type NamedRun } from '../pkg/runs.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const { errors: runErrors, runs } = readRuns();
if (runErrors.length) {
    console.error(`  ✗ runs.json no es válido:\n    ${runErrors.join('\n    ')}`);
    process.exit(2);
}
type Run = NamedRun & { target: string; cases: string };
/** Los campos del caso que el caminador toma, con su argumento (los demás los genera él). */
const CASE_ARGS: Partial<Record<string, string>> = { amount: 'amount', income: 'income', score: 'score', occupation: 'occupation',
    document: 'doc', name: 'name', expedition: 'expedition', dob: 'birth' };
const wantTarget = (process.env.TARGET || '').trim();

const names = (process.argv[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (names.length === 0) {
    console.log('\n  CORRIDAS · make harness-run RUN=<nombre>[,<otra>…] [TARGET=…] [SLOW=600] [HEADED=1] [VIDEO=0] [BLOCK=<tarea>]\n');
    for (const [k, r] of Object.entries(runs)) console.log(`  ${k.padEnd(12)} ${r.targets.join(',').padEnd(10)} ${r.description}${r.measured ? `\n  ${''.padEnd(23)}cerró: ${r.measured}` : ''}`);
    console.log('\n  En el panel: la vista «Corridas» de la barra izquierda.\n');
    console.log('');
    process.exit(0);
}
const unknown = names.filter((n) => !runs[n]);
if (unknown.length) {
    console.error(`  ✗ no hay corrida «${unknown.join('», «')}» (hay: ${Object.keys(runs).join(', ')})`);
    process.exit(2);
}

// Cada corrida en su ambiente (TARGET= si es uno de los suyos; si no, el primero) y su caso del caminador.
const resolved: Record<string, Run> = {};
for (const n of names) {
    const r = runs[n];
    if (wantTarget && !r.targets.includes(wantTarget)) {
        console.error(`  ✗ «${n}» no corre en ${wantTarget} (corre en ${r.targets.join(', ')}): agregalo a sus \`targets\` cuando cierre ahí`);
        process.exit(2);
    }
    const target = wantTarget || r.targets[0];
    const cases = runCase(r, target);
    if (!cases) { console.error(`  ✗ «${n}»: su comercio «${r.merchant}» no tiene sucursal en ${target} (make harness-merchants A='associate …')`); process.exit(2); }
    resolved[n] = { ...r, target, cases };
}

// PANEL=1: no la corre, la deja ARMADA en el panel (Cockpit → Harness): su pestaña con el canal y el caso, lista para
// darle ▶ y avanzar tocando Continuar. Es la misma ruta que abre la vista «Corridas».
if (process.env.PANEL === '1') {
    if (names.length !== 1) { console.error('  ✗ PANEL=1 abre UNA corrida'); process.exit(2); }
    const r = resolved[names[0]];
    const route = `/${r.target}/${encodeURIComponent(r.merchant)}/${r.channel}?corrida=${encodeURIComponent(names[0])}`;
    const cockpit = path.resolve(ROOT, '..', 'bin', 'cockpit');
    const o = spawnSync(cockpit, ['open', 'harness', route], { encoding: 'utf8' });
    console.log(`\n  ▶ ${r.name} armada en el panel (${r.target}): http://localhost:5195${route}`);
    console.log(`    ▶ en el celular y Continuar en cada pantalla; en el listado elegí ${r.lenderName ?? `la entidad ${r.lender}`}.`);
    if (o.status !== 0) console.log(`    (Cockpit no la abrió: ${String(o.stderr || o.stdout).trim().split('\n')[0]}. Abrí la URL de arriba.)`);
    console.log('');
    process.exit(0);
}

const on = (v: string | undefined, def: boolean) => (v === undefined || v === '' ? def : v !== '0');
const video = on(process.env.VIDEO, true);
const headed = on(process.env.HEADED, false);
const slow = process.env.SLOW === undefined || process.env.SLOW === '' ? '600' : process.env.SLOW;
const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
const videoRoot = path.join(ROOT, '.runs', 'videos', stamp);

// Las que comparten ambiente y perillas, juntas: un proceso, sus casos en paralelo.
const knobs = (r: Run) => JSON.stringify([r.target, r.channel, r.case ?? {}, !!r.close]);
const groups = new Map<string, string[]>();
for (const n of names) groups.set(knobs(resolved[n]), [...(groups.get(knobs(resolved[n])) ?? []), n]);

console.log(`\n  ▶ ${names.join(' + ')} · ${headed ? 'con ventana' : 'sin ventana'} · ${slow} ms por acción${video ? ` · videos en ${path.relative(ROOT, videoRoot)}/` : ''}`);
for (const n of names) console.log(`    ${n.padEnd(12)} ${resolved[n].target.padEnd(6)} ${resolved[n].description}`);
console.log('');

/** Lo que el caminador dice de cada caso: la línea del caso (`✓ #c0fca632:149 · uReq 505169 · … · 12 pantallas · 230.2s`)
 *  y, antes, la del video que grabó (`🎬 video: …`). El video de un caso se escribe al cerrar su contexto, justo antes de
 *  su línea: así se sabe de qué caso es cada video también con varios en paralelo. */
interface CaseOut { mark: string; ureq?: number; screens?: number; seconds?: number; lender?: string; video?: string }

function runGroup(group: string[]): Promise<{ group: string[]; status: number; videos: string[]; recordings: Recording[] }> {
    const first = resolved[group[0]];
    const label = group.join('+');
    const dir = path.join(videoRoot, label);
    const args = ['dev/walk-wizard.ts', '--engine', 'browser', '--cases', group.map((n) => resolved[n].cases).join(';'), '--flow', CHANNELS[first.channel]];
    if (group.length > 1) args.push('--parallel');
    for (const [k, v] of Object.entries(first.case ?? {})) if (CASE_ARGS[k]) args.push(`--${CASE_ARGS[k]}`, String(v));
    // Hasta el desenlace: el buró se le dicta a la cédula, y la identidad se aprueba a mano (el celular no hace la selfie).
    if (first.close) args.push('--close', '--manual', '--lambda');
    if (headed) args.push('--headed');
    if (video) fs.mkdirSync(dir, { recursive: true });
    const child = spawn('node', args, {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, E2E_TARGET: first.target, HARNESS_SLOW: slow, ...(video ? { HARNESS_VIDEO: dir } : {}) },
    });
    const cases: CaseOut[] = [];
    const pending: string[] = [];
    const lenders = new Map<number, string>();
    const read = (l: string) => {
        const v = /🎬 video: (\S+\.(?:mp4|webm))/.exec(l);
        if (v) { pending.push(v[1]); return; }
        const c = /^\s*([✓✗⚠]) (#\S+)(?: · uReq (\d+))?/.exec(l);
        if (c) {
            const screens = /(\d+) pantallas/.exec(l), secs = / · ([\d.]+)s\s*$/.exec(l);
            cases.push({ mark: c[1], ureq: c[3] ? Number(c[3]) : undefined, screens: screens ? Number(screens[1]) : undefined,
                seconds: secs ? Math.round(Number(secs[1])) : undefined, video: pending.shift() });
            return;
        }
        const ln = /uReq (\d+) · lender (.+?) · estado/.exec(l);
        if (ln) lenders.set(Number(ln[1]), ln[2]);
    };
    // Con una sola, la salida tal cual; con varias, cada línea con su corrida adelante para que no se mezclen.
    const prefix = groups.size > 1 ? `[${label}] ` : '';
    for (const s of [child.stdout, child.stderr]) {
        let rest = '';
        s.on('data', (d: Buffer) => {
            const lines = (rest + d.toString()).split('\n');
            rest = lines.pop() ?? '';
            for (const l of lines) { read(l); process.stdout.write(`${prefix}${l}\n`); }
        });
        s.on('end', () => { if (rest) { read(rest); process.stdout.write(`${prefix}${rest}\n`); } });
    }
    return new Promise((resolve) => child.on('close', (code) => {
        const videos: string[] = [];
        const recordings: Recording[] = [];
        if (video) {
            // Cada caso, en el orden de `--cases`, es la corrida del mismo lugar del grupo.
            const used = new Map<string, number>();
            cases.forEach((c, i) => {
                const run = group[i] ?? group[0];
                if (!c.video || !fs.existsSync(c.video)) return;
                const n = (used.get(run) ?? 0) + 1; used.set(run, n);
                const id = `${run}-${stamp}${n > 1 ? `-${n}` : ''}`;
                const to = path.join(videoRoot, `${id}${path.extname(c.video)}`);
                fs.renameSync(c.video, to);
                videos.push(to);
                const r = resolved[run];
                recordings.push({
                    id, run, name: r.name ?? run, description: r.description, target: r.target, ureq: c.ureq,
                    lender: c.ureq ? lenders.get(c.ureq) : undefined, closed: c.mark === '✓', screens: c.screens, seconds: c.seconds,
                    at: new Date().toISOString(), video: path.relative(ROOT, to),
                });
            });
            // Lo que quedó sin caso (una corrida que se cayó antes de su línea) se conserva con el nombre del grupo.
            for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
                if (!/\.(mp4|webm)$/.test(f)) continue;
                const to = path.join(videoRoot, `${label}-${stamp}-orphan-${f}`);
                fs.renameSync(path.join(dir, f), to);
                videos.push(to);
            }
            fs.rmSync(dir, { recursive: true, force: true });
            addRecordings(recordings);
        }
        resolve({ group, status: code ?? 1, videos, recordings });
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
